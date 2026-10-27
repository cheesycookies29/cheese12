// IT Service Desk. Tickets come from the portal (any signed-in user), from agents, and
// from a mailbox the helpdesk reads over IMAP. Agents reply publicly or add internal
// notes; replies can go out by email over SMTP and come back threaded on the ticket.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { can } from '../shared/roles.js';
import {
  TICKET_STATUS, TICKET_PRIORITY, UNRESOLVED_TICKET, DEFAULT_CATEGORIES, DEFAULT_SLA, ticketRef, REF_RE, slaDue, slaState,
} from '../shared/helpdesk.js';
import { parseMessage, isAutomated, stripQuoted, REPLY_MARKER } from './mail/mime.js';
import { withImap } from './mail/imap.js';
import { sendMail } from './mail/smtp.js';
import { composeMessage, newMessageId } from './mail/compose.js';
import { parseUpload, uploadFromBuffer } from './attachments.js';

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY = 20000;
const MAX_FILES = 5;
const SEEN_KEEP = 2000;
const POLL_BATCH = 25;
const NEW_TICKETS_PER_SENDER_PER_HOUR = 20;
const VIEWER_WINDOW_MS = 60000;
const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

export function emptyHelpdesk() {
  return {
    seq: 0,
    categories: [...DEFAULT_CATEGORIES],
    sla: structuredClone(DEFAULT_SLA),
    canned: [],
    autoCloseDays: 7,
    autoAcknowledge: true,
    ackTemplate: 'Hello {name},\n\nWe have received your request and logged it as {ref}. Our IT team will get back to you.\n\nTo add information, reply to this email and keep {ref} in the subject.',
    // The address the helpdesk receives at, and how to read it.
    mailbox: { enabled: false, address: '', displayName: 'IT Service Desk', host: '', port: 993, security: 'tls', user: '', passwordSealed: null, folder: 'INBOX', pollMinutes: 2, allowedSenders: 'anyone', allowedDomains: [], defaultCategory: 'Other', defaultPriority: 'normal' },
    // How replies and acknowledgements are sent (from the mailbox address).
    outgoing: { enabled: false, host: '', port: 587, security: 'starttls', user: '', passwordSealed: null, sameLogin: true },
    mailState: { lastPollAt: null, lastOkAt: null, lastError: null, lastImported: 0, totalImported: 0, lastSkipped: [] },
    seenMessageIds: [],
  };
}

// Demo data and "erase all data" start from an empty template; the mail setup and
// helpdesk settings are configuration, so they are kept unless a backup brings its own.
export function keepHelpdeskConfig(current, next) {
  const base = { ...emptyHelpdesk(), ...(current || {}) };
  if (!next || !next.mailbox?.address) return { ...base, seq: next?.seq ?? 0 };
  return { ...emptyHelpdesk(), ...next };
}

export function migrateHelpdesk(db) {
  let changed = false;
  if (!db.data.helpdesk) (db.data.helpdesk = emptyHelpdesk()), (changed = true);
  else for (const [k, v] of Object.entries(emptyHelpdesk())) if (!(k in db.data.helpdesk)) (db.data.helpdesk[k] = v), (changed = true);
  if (!Array.isArray(db.data.tickets)) (db.data.tickets = []), (changed = true);
  return changed;
}

const isAgent = (user) => Boolean(user) && can(user.role, 'helpdesk.agent');

export function registerHelpdeskRoutes(route, db, { files, secrets, linkedEmployee }) {
  const hd = () => db.data.helpdesk;
  const tickets = () => db.data.tickets;
  const viewers = new Map(); // ticketId -> Map(userId -> { name, at })
  const now = () => new Date().toISOString();

  // ----- People -----
  const employeeEmail = (user) => {
    const emp = user?.employeeId && db.data.employees.find((e) => e.id === user.employeeId);
    return emp?.email ? emp.email.toLowerCase() : null;
  };
  const userByEmail = (email) => {
    const emp = db.data.employees.find((e) => e.email && e.email.toLowerCase() === email);
    return emp ? db.data.users.find((u) => u.employeeId === emp.id && u.active) || null : null;
  };
  const agents = () => db.data.users.filter((u) => u.active && can(u.role, 'helpdesk.agent'));
  const requesterOf = (user) => ({ userId: user.id, name: user.name, email: employeeEmail(user) });
  const ownsTicket = (user, t) => t.requester.userId === user.id || (employeeEmail(user) && t.requester.email === employeeEmail(user));

  const findTicket = (id) => {
    const t = tickets().find((x) => x.id === id);
    if (!t) throw new HttpError(404, 'Ticket not found.');
    return t;
  };
  const ownTicket = (user, id) => {
    const t = findTicket(id);
    if (!ownsTicket(user, t)) throw new HttpError(404, 'Ticket not found.');
    return t;
  };

  // ----- Views of a ticket -----
  const assetLabel = (id) => {
    const a = id && db.data.assets.find((x) => x.id === id);
    return a ? { id: a.id, tag: a.assetTag, name: a.name } : null;
  };
  const summary = (t) => {
    const last = [...t.messages].reverse().find((m) => m.kind !== 'event');
    const assignee = t.assigneeId && db.data.users.find((u) => u.id === t.assigneeId);
    return {
      id: t.id, ref: t.ref, subject: t.subject, status: t.status, priority: t.priority, category: t.category, channel: t.channel,
      requester: t.requester, assignee: assignee ? { id: assignee.id, name: assignee.name } : null, asset: assetLabel(t.assetId),
      createdAt: t.createdAt, updatedAt: t.updatedAt, firstResponseDue: t.firstResponseDue, resolutionDue: t.resolutionDue,
      firstResponseAt: t.firstResponseAt, resolvedAt: t.resolvedAt, sla: slaState(t),
      replies: t.messages.filter((m) => m.kind === 'reply').length, lastActivity: last ? { at: last.at, by: last.author.name, role: last.author.role } : null,
      awaitingAgent: last?.author.role === 'requester',
    };
  };
  const full = (t, { forRequester = false } = {}) => {
    const s = summary(t);
    const visible = (m) => !forRequester || m.kind === 'reply' || (m.kind === 'event' && m.public);
    const messages = t.messages.filter(visible).map(({ emailMessageId, email, ...m }) => (forRequester ? m : { ...m, email }));
    return { ...s, ccs: forRequester ? [] : t.ccs, messages };
  };

  // ----- Creating and updating -----
  const nextNumber = () => ++hd().seq;
  function newTicket({ subject, body, requester, channel, priority, category, assigneeId = null, assetId = null, ccs = [], author, attachments = [], emailMessageId = null }) {
    const at = now();
    const number = nextNumber();
    const pr = TICKET_PRIORITY[priority] ? priority : 'normal';
    const t = {
      id: randomUUID(), number, ref: ticketRef(number), subject: str(subject, 200) || '(no subject)', status: 'new', priority: pr,
      category: hd().categories.includes(category) ? category : hd().categories.at(-1) || 'Other', channel,
      requester, assigneeId, assetId, ccs, createdAt: at, updatedAt: at, firstResponseAt: null, resolvedAt: null, closedAt: null,
      ...slaDue(at, pr, hd().sla), messages: [], emailIds: emailMessageId ? [emailMessageId] : [],
    };
    t.messages.push({ id: randomUUID(), kind: 'reply', author: author || { ...requester, role: 'requester' }, body: str(body, MAX_BODY), at, via: channel === 'email' ? 'email' : 'web', attachments, emailMessageId });
    tickets().push(t);
    return t;
  }
  // Ticket history line. Public ones (status changes) are shown to the requester too.
  const event = (t, user, text, { isPublic = false } = {}) => t.messages.push({ id: randomUUID(), kind: 'event', public: isPublic, author: { userId: user?.id || null, name: user?.name || 'System', role: user ? 'agent' : 'system' }, body: text, at: now(), attachments: [] });
  function setStatus(t, status, user) {
    if (!TICKET_STATUS[status] || status === t.status) return;
    event(t, user, `Status changed from ${TICKET_STATUS[t.status]} to ${TICKET_STATUS[status]}`, { isPublic: true });
    t.status = status;
    if (status === 'resolved') t.resolvedAt = now();
    if (status === 'closed') t.closedAt = now();
    if (UNRESOLVED_TICKET.includes(status)) (t.resolvedAt = null), (t.closedAt = null);
  }
  const saveFiles = (list, { fromEmail = false } = {}) => {
    const saved = [];
    const skipped = [];
    for (const f of list.slice(0, MAX_FILES)) {
      try {
        const up = fromEmail ? uploadFromBuffer(f.filename, f.data) : parseUpload(f);
        saved.push(files.save(up));
      } catch (err) {
        if (!fromEmail) throw err;
        skipped.push(`${f.filename} (${err.message.replace(/\.$/, '')})`);
      }
    }
    if (list.length > MAX_FILES) skipped.push(`${list.length - MAX_FILES} more file(s): at most ${MAX_FILES} per message`);
    return { saved, skipped };
  };
  const validCategory = (c) => {
    if (!hd().categories.includes(c)) throw new HttpError(400, 'Pick a category.');
    return c;
  };
  const validAgent = (id) => {
    if (!id) return null;
    if (!agents().some((u) => u.id === id)) throw new HttpError(400, 'That person is not a helpdesk agent.');
    return id;
  };

  // ----- Outgoing email -----
  let smtpTls; // test hooks only: trust a self-signed test server
  let imapTls;
  const loginFor = (kind) => {
    const cfg = hd()[kind];
    if (kind === 'outgoing' && cfg.sameLogin) return { user: hd().mailbox.user, password: secrets.open(hd().mailbox.passwordSealed) };
    return { user: cfg.user, password: secrets.open(cfg.passwordSealed) };
  };
  const smtpOptions = () => {
    const o = hd().outgoing;
    return { host: o.host, port: o.port, secure: o.security === 'tls', starttls: o.security === 'starttls', ...loginFor('outgoing'), tlsOptions: smtpTls };
  };
  const canEmail = () => hd().outgoing.enabled && hd().outgoing.host && EMAIL_RE.test(hd().mailbox.address);

  async function emailRequester(t, text, { auto = false, subjectPrefix = 'Re: ' } = {}) {
    if (!canEmail() || !t.requester.email) return { status: 'not_sent', reason: !t.requester.email ? 'The requester has no email address.' : 'Outgoing email is not set up.' };
    const from = { name: hd().mailbox.displayName || 'IT Service Desk', email: hd().mailbox.address };
    const messageId = newMessageId(from.email);
    const refs = t.emailIds.slice(-10);
    const raw = composeMessage({
      from, to: [{ name: t.requester.name, email: t.requester.email }], subject: `${subjectPrefix}[${t.ref}] ${t.subject}`,
      text: `${REPLY_MARKER}\n\n${text}\n\n--\n${from.name}\nTicket ${t.ref}: ${t.subject}`, messageId, inReplyTo: refs.at(-1), references: refs, auto,
    });
    try {
      await sendMail(smtpOptions(), { from: from.email, to: [t.requester.email, ...t.ccs].slice(0, 10), raw });
      t.emailIds.push(messageId.toLowerCase());
      return { status: 'sent', at: now() };
    } catch (err) {
      return { status: 'failed', reason: err.message };
    }
  }

  // ----- Inbound email -----
  // Decides what one raw email does: append to a ticket, open a new one, or nothing (with a reason).
  async function ingest(raw) {
    const box = hd().mailbox;
    if (raw.length > MAX_EMAIL_BYTES) return { action: 'skipped', reason: `a message of ${(raw.length / 1048576).toFixed(0)} MB is over the ${MAX_EMAIL_BYTES / 1048576} MB limit` };
    const msg = parseMessage(raw);
    const sender = msg.replyTo && !msg.from ? msg.replyTo : msg.from;
    if (!sender) return { action: 'skipped', reason: 'no sender address' };
    if (sender.email === box.address.toLowerCase()) return { action: 'skipped', reason: 'sent by the helpdesk itself' };
    if (isAutomated(msg)) return { action: 'skipped', reason: `automatic message from ${sender.email}` };
    if (msg.messageId && hd().seenMessageIds.includes(msg.messageId)) return { action: 'skipped', reason: 'already imported' };
    const remember = () => {
      if (!msg.messageId) return;
      hd().seenMessageIds.push(msg.messageId);
      if (hd().seenMessageIds.length > SEEN_KEEP) hd().seenMessageIds.splice(0, hd().seenMessageIds.length - SEEN_KEEP);
    };
    const domain = sender.email.split('@')[1];
    const known = userByEmail(sender.email);
    if (box.allowedSenders === 'domains' && !box.allowedDomains.includes(domain)) return remember(), { action: 'skipped', reason: `${sender.email} is not from an allowed domain` };
    if (box.allowedSenders === 'known' && !known) return remember(), { action: 'skipped', reason: `${sender.email} does not match an employee email` };

    const author = { userId: known?.id || null, name: sender.name || known?.name || sender.email, email: sender.email, role: 'requester' };
    // Threading: ticket number in the subject, or a reply to an email the helpdesk sent or received.
    const ref = msg.subject.match(REF_RE);
    const threadIds = [...msg.inReplyTo, ...msg.references];
    const participant = (t) => t.requester.email === sender.email || t.ccs.includes(sender.email);
    const existing = tickets().find((t) => participant(t) && ((ref && t.number === Number(ref[1])) || t.emailIds.some((id) => threadIds.includes(id))));
    const stored = saveFiles(msg.attachments, { fromEmail: true });
    const note = stored.skipped.length ? `\n\n[Not imported: ${stored.skipped.join('; ')}]` : '';

    if (existing && existing.status !== 'closed') {
      const body = stripQuoted(msg.text) || msg.text.trim() || '(empty message)';
      existing.messages.push({ id: randomUUID(), kind: 'reply', author, body: str(body + note, MAX_BODY), at: now(), via: 'email', attachments: stored.saved, emailMessageId: msg.messageId });
      if (msg.messageId) existing.emailIds.push(msg.messageId);
      if (['pending', 'resolved'].includes(existing.status)) setStatus(existing, 'open', null);
      existing.updatedAt = now();
      remember();
      return { action: 'replied', ticket: existing.ref };
    }
    const recent = tickets().filter((t) => t.requester.email === sender.email && Date.now() - new Date(t.createdAt) < 3600000).length;
    if (recent >= NEW_TICKETS_PER_SENDER_PER_HOUR) return remember(), { action: 'skipped', reason: `too many new tickets from ${sender.email} in the last hour` };
    const ccs = [...msg.to, ...msg.cc].map((a) => a.email).filter((e) => e !== box.address.toLowerCase() && e !== sender.email).slice(0, 10);
    const body = (msg.text.trim() || '(empty message)') + (existing ? `\n\n[Follow-up to closed ticket ${existing.ref}]` : '') + note;
    const t = newTicket({
      subject: msg.subject.replace(/^(\s*(re|fw|fwd|aw)\s*:\s*)+/i, '') || '(no subject)', body, channel: 'email', requester: { userId: author.userId, name: author.name, email: sender.email },
      priority: box.defaultPriority, category: box.defaultCategory, ccs, author, attachments: stored.saved, emailMessageId: msg.messageId,
    });
    remember();
    if (hd().autoAcknowledge) {
      const text = hd().ackTemplate.replaceAll('{name}', t.requester.name.split(' ')[0] || 'there').replaceAll('{ref}', t.ref).replaceAll('{subject}', t.subject);
      const sent = await emailRequester(t, text, { auto: true, subjectPrefix: '' });
      if (sent.status !== 'not_sent') event(t, null, sent.status === 'sent' ? 'Acknowledgement emailed to the requester' : `Acknowledgement email failed: ${sent.reason}`);
    }
    return { action: 'created', ticket: t.ref };
  }

  const imapOptions = () => {
    const b = hd().mailbox;
    return { host: b.host, port: b.port, secure: b.security === 'tls', starttls: b.security === 'starttls', ...loginFor('mailbox'), folder: b.folder || 'INBOX', tlsOptions: imapTls };
  };
  let polling = null;
  // Reads unread mail once. Each message is marked read after it is handled, imported or not.
  function pollOnce() {
    if (polling) return polling;
    const state = hd().mailState;
    polling = (async () => {
      state.lastPollAt = now();
      const results = [];
      try {
        if (!hd().mailbox.host || !hd().mailbox.address) throw new Error('The mailbox is not set up.');
        await withImap(imapOptions(), async (client) => {
          const uids = (await client.searchUnseen()).slice(0, POLL_BATCH);
          for (const uid of uids) {
            const raw = await client.fetch(uid);
            let result;
            try {
              result = raw ? await ingest(raw) : { action: 'skipped', reason: 'empty message' };
            } catch (err) {
              result = { action: 'skipped', reason: `could not be read (${err.message})` };
            }
            results.push(result);
            db.save();
            await client.markSeen(uid);
          }
        });
        const imported = results.filter((r) => r.action !== 'skipped').length;
        Object.assign(state, { lastOkAt: now(), lastError: null, lastImported: imported, totalImported: state.totalImported + imported, lastSkipped: results.filter((r) => r.action === 'skipped').map((r) => r.reason).slice(0, 10) });
      } catch (err) {
        state.lastError = err.message;
      } finally {
        db.save();
        polling = null;
      }
      return { results, error: state.lastError };
    })();
    return polling;
  }

  // Resolved tickets close after the set number of days without a reply.
  function autoClose() {
    const days = Number(hd().autoCloseDays) || 0;
    if (!days) return false;
    const cutoff = Date.now() - days * 86400000;
    let changed = false;
    for (const t of tickets()) {
      if (t.status === 'resolved' && t.resolvedAt && new Date(t.resolvedAt).getTime() < cutoff) {
        setStatus(t, 'closed', null);
        t.updatedAt = now();
        changed = true;
      }
    }
    return changed;
  }

  // Background work: poll the mailbox when due, and close old resolved tickets.
  const timer = setInterval(() => {
    const b = hd().mailbox;
    if (autoClose()) db.save();
    const last = hd().mailState.lastPollAt ? new Date(hd().mailState.lastPollAt).getTime() : 0;
    if (b.enabled && b.host && Date.now() - last >= (Number(b.pollMinutes) || 2) * 60000) pollOnce();
  }, 30000);
  timer.unref();

  // ===== Routes: everyone (portal) =====
  route('GET', '/api/helpdesk/info', 'auth', ({ user }) => {
    const emp = user.employeeId && db.data.employees.find((e) => e.id === user.employeeId);
    return {
      categories: hd().categories,
      mailboxAddress: hd().mailbox.enabled && hd().mailbox.address ? hd().mailbox.address : null,
      myEmail: emp?.email || null,
      myAssets: emp ? db.data.assets.filter((a) => a.assignedTo?.type === 'employee' && a.assignedTo.id === emp.id).map((a) => ({ id: a.id, tag: a.assetTag, name: a.name })) : [],
    };
  });
  route('GET', '/api/helpdesk/mine', 'auth', ({ user }) =>
    tickets().filter((t) => ownsTicket(user, t)).reverse().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary));
  route('POST', '/api/helpdesk/mine', 'auth', ({ user, body }) => {
    const subject = str(body.subject, 200);
    const text = str(body.body, MAX_BODY);
    if (!subject) throw new HttpError(400, 'Add a short subject.');
    if (text.length < 10) throw new HttpError(400, 'Describe the problem in a sentence or two.');
    const mine = tickets().filter((t) => t.requester.userId === user.id && Date.now() - new Date(t.createdAt) < 3600000).length;
    if (mine >= NEW_TICKETS_PER_SENDER_PER_HOUR) throw new HttpError(429, 'You have opened many tickets in the last hour. Please add to an existing ticket instead.');
    const assetId = body.assetId && db.data.assets.some((a) => a.id === body.assetId) ? body.assetId : null;
    const { saved } = saveFiles(Array.isArray(body.attachments) ? body.attachments : []);
    const t = newTicket({ subject, body: text, requester: requesterOf(user), channel: 'portal', priority: body.priority, category: validCategory(body.category), assetId, attachments: saved });
    db.save();
    return full(t, { forRequester: true });
  });
  route('GET', '/api/helpdesk/mine/:id', 'auth', ({ user, params }) => full(ownTicket(user, params.id), { forRequester: true }));
  route('POST', '/api/helpdesk/mine/:id/messages', 'auth', ({ user, params, body }) => {
    const t = ownTicket(user, params.id);
    if (t.status === 'closed') throw new HttpError(400, 'This ticket is closed. Open a new ticket and mention its number.');
    const text = str(body.body, MAX_BODY);
    if (!text) throw new HttpError(400, 'Write a message.');
    const { saved } = saveFiles(Array.isArray(body.attachments) ? body.attachments : []);
    t.messages.push({ id: randomUUID(), kind: 'reply', author: { ...requesterOf(user), role: 'requester' }, body: text, at: now(), via: 'web', attachments: saved });
    if (['pending', 'resolved'].includes(t.status)) setStatus(t, 'open', null);
    t.updatedAt = now();
    db.save();
    return full(t, { forRequester: true });
  });
  // The requester confirms the problem is solved.
  route('POST', '/api/helpdesk/mine/:id/resolve', 'auth', ({ user, params }) => {
    const t = ownTicket(user, params.id);
    if (!UNRESOLVED_TICKET.includes(t.status)) throw new HttpError(400, `This ticket is already ${TICKET_STATUS[t.status].toLowerCase()}.`);
    event(t, null, `${user.name} marked the ticket as solved`, { isPublic: true });
    setStatus(t, 'resolved', null);
    t.updatedAt = now();
    db.save();
    return full(t, { forRequester: true });
  });
  route('GET', '/api/helpdesk/files/:ticketId/:fileId', 'auth', ({ user, params }) => {
    const t = findTicket(params.ticketId);
    const msg = t.messages.find((m) => m.attachments?.some((a) => a.id === params.fileId));
    if (!msg || !(isAgent(user) || (ownsTicket(user, t) && msg.kind !== 'note'))) throw new HttpError(404, 'File not found.');
    return files.read(msg.attachments.find((a) => a.id === params.fileId));
  });

  // ===== Routes: agents =====
  route('GET', '/api/helpdesk/summary', 'helpdesk.agent', ({ user }) => {
    const open = tickets().filter((t) => UNRESOLVED_TICKET.includes(t.status));
    return {
      new: open.filter((t) => t.status === 'new').length,
      unassigned: open.filter((t) => !t.assigneeId).length,
      mine: open.filter((t) => t.assigneeId === user.id).length,
      overdue: open.filter((t) => slaState(t) === 'breached').length,
      awaiting: open.filter((t) => summary(t).awaitingAgent).length,
      open: open.length,
    };
  });
  route('GET', '/api/helpdesk/agents', 'helpdesk.agent', () => agents().map((u) => ({ id: u.id, name: u.name, role: u.role })));
  route('GET', '/api/helpdesk/tickets', 'helpdesk.agent', ({ query, user }) => {
    const q = str(query.q, 100).toLowerCase();
    const list = tickets().filter((t) => {
      const v = query.view || 'open';
      if (v === 'open' && !UNRESOLVED_TICKET.includes(t.status)) return false;
      if (v === 'mine' && (t.assigneeId !== user.id || !UNRESOLVED_TICKET.includes(t.status))) return false;
      if (v === 'unassigned' && (t.assigneeId || !UNRESOLVED_TICKET.includes(t.status))) return false;
      if (v === 'overdue' && slaState(t) !== 'breached') return false;
      if (v === 'resolved' && !['resolved', 'closed'].includes(t.status)) return false;
      if (query.status && t.status !== query.status) return false;
      if (query.priority && t.priority !== query.priority) return false;
      if (query.category && t.category !== query.category) return false;
      if (query.assignee && t.assigneeId !== query.assignee) return false;
      return !q || [t.ref, t.subject, t.requester.name, t.requester.email || '', ...t.messages.map((m) => m.body)].join(' ').toLowerCase().includes(q);
    });
    const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
    // Overdue first, then by priority, then most recently updated.
    return list.map(summary).sort((a, b) => (b.sla === 'breached') - (a.sla === 'breached') || rank[a.priority] - rank[b.priority] || b.updatedAt.localeCompare(a.updatedAt));
  });
  route('POST', '/api/helpdesk/tickets', 'helpdesk.agent', ({ user, body }) => {
    const subject = str(body.subject, 200);
    const text = str(body.body, MAX_BODY);
    if (!subject) throw new HttpError(400, 'Add a short subject.');
    if (!text) throw new HttpError(400, 'Describe the request.');
    let requester;
    if (body.requesterUserId) {
      const u = db.data.users.find((x) => x.id === body.requesterUserId);
      if (!u) throw new HttpError(400, 'Pick the requester.');
      requester = requesterOf(u);
    } else {
      const email = str(body.requesterEmail, 200).toLowerCase();
      const name = str(body.requesterName, 120);
      if (!name) throw new HttpError(400, 'Enter the requester’s name, or pick a user.');
      if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address for the requester.');
      requester = { userId: (email && userByEmail(email)?.id) || null, name, email: email || null };
    }
    const assetId = body.assetId && db.data.assets.some((a) => a.id === body.assetId) ? body.assetId : null;
    const { saved } = saveFiles(Array.isArray(body.attachments) ? body.attachments : []);
    const t = newTicket({
      subject, body: text, requester, channel: 'agent', priority: body.priority, category: validCategory(body.category),
      assigneeId: validAgent(body.assigneeId), assetId, author: { userId: user.id, name: user.name, email: null, role: 'agent' }, attachments: saved,
    });
    event(t, user, `Logged by ${user.name} on behalf of ${requester.name}`);
    db.save();
    return full(t);
  });
  route('GET', '/api/helpdesk/tickets/:id', 'helpdesk.agent', ({ user, params }) => {
    const t = findTicket(params.id);
    const seen = viewers.get(t.id) || new Map();
    seen.set(user.id, { name: user.name, at: Date.now() });
    viewers.set(t.id, seen);
    const others = [...seen.entries()].filter(([id, v]) => id !== user.id && Date.now() - v.at < VIEWER_WINDOW_MS).map(([, v]) => v.name);
    return { ...full(t), viewers: others };
  });
  route('PUT', '/api/helpdesk/tickets/:id', 'helpdesk.agent', ({ user, params, body }) => {
    const t = findTicket(params.id);
    if ('status' in body && TICKET_STATUS[body.status]) setStatus(t, body.status, user);
    if ('priority' in body && TICKET_PRIORITY[body.priority] && body.priority !== t.priority) {
      event(t, user, `Priority changed from ${TICKET_PRIORITY[t.priority]} to ${TICKET_PRIORITY[body.priority]}`);
      t.priority = body.priority;
      Object.assign(t, slaDue(t.createdAt, t.priority, hd().sla));
    }
    if ('category' in body && body.category !== t.category) {
      event(t, user, `Category changed from ${t.category} to ${validCategory(body.category)}`);
      t.category = body.category;
    }
    if ('assigneeId' in body && (body.assigneeId || null) !== t.assigneeId) {
      const id = validAgent(body.assigneeId);
      event(t, user, id ? `Assigned to ${agents().find((u) => u.id === id).name}` : 'Unassigned');
      t.assigneeId = id;
      if (id && t.status === 'new') setStatus(t, 'open', user);
    }
    if ('assetId' in body && (body.assetId || null) !== t.assetId) {
      t.assetId = body.assetId && db.data.assets.some((a) => a.id === body.assetId) ? body.assetId : null;
      event(t, user, t.assetId ? `Linked to asset ${assetLabel(t.assetId).tag}` : 'Asset link removed');
    }
    if ('subject' in body && str(body.subject, 200) && str(body.subject, 200) !== t.subject) {
      event(t, user, `Subject changed from “${t.subject}”`);
      t.subject = str(body.subject, 200);
    }
    t.updatedAt = now();
    db.save();
    return full(t);
  });
  route('POST', '/api/helpdesk/tickets/:id/messages', 'helpdesk.agent', async ({ user, params, body }) => {
    const t = findTicket(params.id);
    const kind = body.kind === 'note' ? 'note' : 'reply';
    const text = str(body.body, MAX_BODY);
    if (!text) throw new HttpError(400, kind === 'note' ? 'Write the note.' : 'Write the reply.');
    const { saved } = saveFiles(Array.isArray(body.attachments) ? body.attachments : []);
    const msg = { id: randomUUID(), kind, author: { userId: user.id, name: user.name, email: null, role: 'agent' }, body: text, at: now(), via: 'web', attachments: saved };
    t.messages.push(msg);
    if (kind === 'reply') {
      if (!t.firstResponseAt) t.firstResponseAt = msg.at;
      if (!t.assigneeId && agents().some((u) => u.id === user.id)) (t.assigneeId = user.id), event(t, user, `Assigned to ${user.name}`);
    }
    const next = TICKET_STATUS[body.status] ? body.status : kind === 'reply' && ['new', 'open'].includes(t.status) ? 'pending' : t.status === 'new' ? 'open' : null;
    if (next) setStatus(t, next, user);
    t.updatedAt = now();
    db.save();
    if (kind === 'reply' && body.email !== false) {
      msg.email = await emailRequester(t, text + (saved.length ? `\n\n(${saved.length} attachment(s) on the ticket: sign in to view.)` : ''));
      db.save();
    }
    return full(t);
  });
  route('DELETE', '/api/helpdesk/tickets/:id', 'helpdesk.manage', ({ params }) => {
    const t = findTicket(params.id);
    for (const m of t.messages) for (const a of m.attachments || []) files.remove(a);
    db.data.tickets = tickets().filter((x) => x.id !== t.id);
    db.save();
    return { ok: true };
  });
  route('GET', '/api/helpdesk/canned', 'helpdesk.agent', () => hd().canned);

  // ===== Routes: settings (administrators) =====
  const publicSettings = () => {
    const strip = ({ passwordSealed, ...rest }) => ({ ...rest, hasPassword: Boolean(secrets.open(passwordSealed)) });
    return {
      mailbox: strip(hd().mailbox), outgoing: strip(hd().outgoing), mailState: hd().mailState,
      categories: hd().categories, sla: hd().sla, canned: hd().canned, autoCloseDays: hd().autoCloseDays, autoAcknowledge: hd().autoAcknowledge, ackTemplate: hd().ackTemplate,
    };
  };
  const port = (v, label) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new HttpError(400, `${label} port must be a number from 1 to 65535.`);
    return n;
  };
  const host = (v, label) => {
    const h = str(v, 253).toLowerCase();
    if (h && !/^[a-z0-9.-]+$/.test(h)) throw new HttpError(400, `${label} server must be a host name like imap.gmail.com.`);
    return h;
  };
  const security = (v) => (['tls', 'starttls', 'none'].includes(v) ? v : 'tls');

  route('GET', '/api/helpdesk/settings', 'helpdesk.manage', publicSettings);
  // The address the helpdesk receives at, and how to read it. A blank password keeps the saved one.
  route('PUT', '/api/helpdesk/settings/mailbox', 'helpdesk.manage', ({ body }) => {
    const b = hd().mailbox;
    const address = str(body.address, 200).toLowerCase();
    if (address && !EMAIL_RE.test(address)) throw new HttpError(400, 'Enter the helpdesk email address, e.g. helpdesk@company.com.');
    const next = {
      ...b, address, displayName: str(body.displayName, 80) || 'IT Service Desk', host: host(body.host, 'Incoming mail'), port: port(body.port ?? 993, 'Incoming mail'),
      security: security(body.security), user: str(body.user, 200), folder: str(body.folder, 100) || 'INBOX',
      pollMinutes: Math.min(60, Math.max(1, Math.round(Number(body.pollMinutes) || 2))),
      allowedSenders: ['anyone', 'domains', 'known'].includes(body.allowedSenders) ? body.allowedSenders : 'anyone',
      allowedDomains: String(body.allowedDomains || '').split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 20),
      defaultCategory: hd().categories.includes(body.defaultCategory) ? body.defaultCategory : b.defaultCategory,
      defaultPriority: TICKET_PRIORITY[body.defaultPriority] ? body.defaultPriority : 'normal',
      enabled: Boolean(body.enabled),
    };
    if (body.password) next.passwordSealed = secrets.seal(String(body.password));
    if (body.clearPassword) next.passwordSealed = null;
    if (next.enabled && (!next.address || !next.host || !next.user)) throw new HttpError(400, 'To receive email, enter the address, the incoming mail server and the sign-in name.');
    if (next.enabled && !secrets.open(next.passwordSealed)) throw new HttpError(400, 'Enter the mailbox password (or app password) to receive email.');
    if (next.allowedSenders === 'domains' && !next.allowedDomains.length) throw new HttpError(400, 'List at least one allowed domain, e.g. company.com.');
    hd().mailbox = next;
    db.save();
    return publicSettings();
  });
  route('PUT', '/api/helpdesk/settings/outgoing', 'helpdesk.manage', ({ body }) => {
    const o = hd().outgoing;
    const next = {
      ...o, enabled: Boolean(body.enabled), host: host(body.host, 'Outgoing mail'), port: port(body.port ?? 587, 'Outgoing mail'), security: security(body.security),
      sameLogin: body.sameLogin !== false, user: str(body.user, 200),
    };
    if (body.password) next.passwordSealed = secrets.seal(String(body.password));
    if (body.clearPassword) next.passwordSealed = null;
    if (next.enabled && !next.host) throw new HttpError(400, 'Enter the outgoing mail (SMTP) server.');
    if (next.enabled && !EMAIL_RE.test(hd().mailbox.address)) throw new HttpError(400, 'Set the helpdesk email address first; replies are sent from it.');
    hd().outgoing = next;
    db.save();
    return publicSettings();
  });
  // Connects with the saved settings and reports what it found, without importing anything.
  route('POST', '/api/helpdesk/settings/mailbox/test', 'helpdesk.manage', async () => {
    const b = hd().mailbox;
    if (!b.host || !b.user) throw new HttpError(400, 'Save the incoming mail server and sign-in first.');
    try {
      const unread = await withImap(imapOptions(), (c) => c.searchUnseen());
      return { ok: true, message: `Connected to ${b.host} and opened ${b.folder}. ${unread.length} unread message(s) waiting.` };
    } catch (err) {
      throw new HttpError(400, `Could not read the mailbox: ${err.message}`);
    }
  });
  route('POST', '/api/helpdesk/settings/mailbox/poll', 'helpdesk.manage', async () => {
    const res = await pollOnce();
    return { ...res, settings: publicSettings() };
  });
  route('POST', '/api/helpdesk/settings/outgoing/test', 'helpdesk.manage', async ({ body, user }) => {
    const to = str(body.to, 200).toLowerCase();
    if (!EMAIL_RE.test(to)) throw new HttpError(400, 'Enter the address to send the test to.');
    if (!hd().outgoing.host) throw new HttpError(400, 'Save the outgoing mail server first.');
    const from = { name: hd().mailbox.displayName, email: hd().mailbox.address };
    if (!EMAIL_RE.test(from.email)) throw new HttpError(400, 'Set the helpdesk email address first.');
    try {
      await sendMail(smtpOptions(), { from: from.email, to: [to], raw: composeMessage({ from, to: [{ name: '', email: to }], subject: 'Helpdesk test email', text: `This is a test from the IT Service Desk, sent by ${user.name}. Outgoing email works.`, messageId: newMessageId(from.email) }) });
      return { ok: true, message: `Test email sent to ${to}.` };
    } catch (err) {
      throw new HttpError(400, `Could not send: ${err.message}`);
    }
  });
  route('PUT', '/api/helpdesk/settings/general', 'helpdesk.manage', ({ body }) => {
    const cats = [...new Set((Array.isArray(body.categories) ? body.categories : String(body.categories || '').split('\n')).map((c) => str(c, 60)).filter(Boolean))].slice(0, 30);
    if (!cats.length) throw new HttpError(400, 'Keep at least one category.');
    const sla = {};
    for (const p of Object.keys(TICKET_PRIORITY)) {
      const fr = Number(body.sla?.[p]?.firstResponse);
      const rs = Number(body.sla?.[p]?.resolution);
      if (!(fr > 0 && rs > 0 && fr <= 720 && rs <= 2160)) throw new HttpError(400, `Enter SLA hours for ${TICKET_PRIORITY[p]} priority.`);
      if (rs < fr) throw new HttpError(400, `${TICKET_PRIORITY[p]}: the resolution target can't be shorter than the first response target.`);
      sla[p] = { firstResponse: fr, resolution: rs };
    }
    const template = str(body.ackTemplate, 2000);
    Object.assign(hd(), {
      categories: cats, sla, autoCloseDays: Math.min(90, Math.max(0, Math.round(Number(body.autoCloseDays) || 0))),
      autoAcknowledge: Boolean(body.autoAcknowledge), ackTemplate: template || emptyHelpdesk().ackTemplate,
    });
    if (!cats.includes(hd().mailbox.defaultCategory)) hd().mailbox.defaultCategory = cats.at(-1);
    db.save();
    return publicSettings();
  });
  route('POST', '/api/helpdesk/canned', 'helpdesk.manage', ({ body }) => {
    const c = { id: randomUUID(), title: str(body.title, 80), body: str(body.body, 4000) };
    if (!c.title || !c.body) throw new HttpError(400, 'Give the saved reply a title and text.');
    hd().canned.push(c);
    db.save();
    return publicSettings();
  });
  route('PUT', '/api/helpdesk/canned/:id', 'helpdesk.manage', ({ params, body }) => {
    const c = hd().canned.find((x) => x.id === params.id);
    if (!c) throw new HttpError(404, 'Saved reply not found.');
    Object.assign(c, { title: str(body.title, 80) || c.title, body: str(body.body, 4000) || c.body });
    db.save();
    return publicSettings();
  });
  route('DELETE', '/api/helpdesk/canned/:id', 'helpdesk.manage', ({ params }) => {
    hd().canned = hd().canned.filter((x) => x.id !== params.id);
    db.save();
    return publicSettings();
  });

  // For tests: run the poller now, trust self-signed test certificates.
  return { pollOnce, ingest, autoClose, setTlsForTests: (o) => ((smtpTls = o), (imapTls = o)) };
}
