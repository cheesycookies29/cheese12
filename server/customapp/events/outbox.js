// CUSTOM APP → events: the email outbox (US-023, design A11). A guest with an email address gets
// their table and seat when it is confirmed, and again when it changes. The email is a convenience:
// the seat and the check-in are already saved by commit() before anything here runs, and nothing
// here ever touches them (spec s.6: a failed email never invalidates check-in or seating).
//
//  - afterCommit (called by commit() after its save, synchronously): for each guest whose seat was
//    just confirmed or changed, a message is queued in caOutbox, its body rendered from the seat as
//    it is now (message.js). A guest with no address is marked "not applicable".
//  - drain(): a capacity-1 FIFO, outside commit(): one message at a time, oldest first: sending →
//    await sendMail(mailTransport) → sent or failed, with guest.notify kept in step. A transient
//    failure (no answer, a 4xx reply) is tried again three times, waiting longer each time; a 5xx
//    reply fails at once. Status writes are saved at most once every 2 s (any commit saves them too).
//  - emailPaused (the event's switch): messages are queued and wait; nothing is sent.
//  - A restart: a message left in "sending" for more than 2 minutes is queued again (a rare
//    duplicate email rather than a lost one).
//  - Resend is the notify command (engine.js): a new message, a new attempt.
//  - Invitations (0.74): the invite command queues one per guest, and a Yes queues its reply (rsvp),
//    each with the guest's personal link token sealed (CORE's secrets, AES-256-GCM; the token itself
//    is never stored). Here the seal is opened only to put the link in the email (text, a button and
//    an inline QR code picture, multipart/related), and removed once the message is sent or has
//    failed for good. A message whose token is no longer the guest's (sent again, or revoked, before
//    it went) is not sent. guest.invite.state follows the invitation's delivery, as guest.notify
//    follows the seat email's.
// Messages are from the event's own From and Reply-To (settings.emailFrom, settings.replyTo), never
// the helpdesk mailbox. Names are encoded words (server/mail/compose.js).
import { randomUUID } from 'node:crypto';
import { sendMail as smtpSend } from '../../mail/smtp.js';
import { composeMessage, newMessageId, newContentId } from '../../mail/compose.js';
import { isConfirmed, isReserved } from '../../../shared/customapp/seating.js';
import { coll, inviteHashOf, inviteLink } from './model.js';
import { seatMessage, rsvpMessage, textWithLink, messageHtml, withoutLink } from './message.js';
import { qrPng } from '../qr.js';

// Where sealed tokens are opened: CORE's secrets (server/secrets.js) in the app; tests without them
// get one that keeps the tokens in memory only.
export function memoryVault() {
  const m = new Map();
  return {
    seal(plain) {
      const k = `mem:${randomUUID()}`;
      m.set(k, String(plain));
      return k;
    },
    open: (sealed) => m.get(String(sealed || '')) ?? null,
  };
}

export const OUTBOX = Object.freeze({ retries: 3, backoffMs: Object.freeze([5000, 30000, 120000]), staleSendingMs: 120000, saveEveryMs: 2000, tickMs: 5000 });
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A failure worth trying again: no connection, no answer, or a 4xx reply. A 5xx reply is final.
export function isTransient(err) {
  const m = String(err?.message || '').match(/failed: (\d)\d\d\b/);
  return m ? m[1] !== '5' : true;
}

// transport: server/mail/transport.js (the helpdesk's own); send: sendMail (tests use a fake SMTP
// server, or a function); now () → ms.
export function createOutbox(db, { transport, send = smtpSend, now = () => Date.now(), backoffMs = OUTBOX.backoffMs, saveEveryMs = OUTBOX.saveEveryMs, staleSendingMs = OUTBOX.staleSendingMs, vault = memoryVault() } = {}) {
  const msgs = () => coll(db, 'caOutbox');
  const iso = () => new Date(now()).toISOString();
  const eventOf = (id) => coll(db, 'caEvents').find((e) => e.id === id) || null;
  let running = null;
  let inFlight = null;
  let saveTimer = null;
  let timer = null;
  const stats = { saves: 0, sent: 0, failed: 0 };

  // Status writes: one save at most every saveEveryMs (a commit in between saves them anyway).
  function markDirty() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        db.save();
        stats.saves++;
      } catch (err) {
        console.error('CUSTOM APP outbox: status not saved:', err.message);
      }
    }, saveEveryMs);
    saveTimer.unref?.();
  }
  const flush = () => {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      db.save();
      stats.saves++;
    } catch {}
  };
  // Replace a record (never edited in place: commit() keeps copies of the arrays it replaced).
  const setMsg = (id, patch) => {
    const arr = msgs();
    const i = arr.findIndex((m) => m.id === id);
    if (i < 0) return null;
    arr[i] = { ...arr[i], ...patch };
    return arr[i];
  };
  // guest.notify is the delivery status, kept apart from the seat: no rev and no seq change, so a
  // screen's revisions never go stale because an email went out.
  const setNotify = (guestId, patch) => {
    const arr = coll(db, 'caGuests');
    const i = arr.findIndex((g) => g.id === guestId);
    if (i >= 0) arr[i] = { ...arr[i], notify: { ...(arr[i].notify || {}), ...patch } };
  };
  // The invitation's delivery on the guest (only for their latest invitation; an older one that was
  // replaced says nothing about the link that works now).
  const setInvite = (m, patch) => {
    const arr = coll(db, 'caGuests');
    const i = arr.findIndex((g) => g.id === m.guestId);
    if (i >= 0 && arr[i].invite?.messageId === m.id) arr[i] = { ...arr[i], invite: { ...arr[i].invite, ...patch } };
  };
  // Delivery status for a message: an invitation's on guest.invite, any other on guest.notify.
  const status = (m, patch) => (m.kind === 'invitation' ? setInvite(m, { state: patch.state, ...(patch.state === 'sent' ? { sentAt: patch.lastAt, lastError: null } : {}), ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}) }) : setNotify(m.guestId, patch));

  // ----- Queue (synchronous, after commit()'s save) -----
  function queueFor(ev, g, kind) {
    const t = coll(db, 'caTables').find((x) => x.id === g.seat?.tableId);
    if (!g.email) {
      setNotify(g.id, { state: 'not_applicable', lastAt: iso() });
      return null;
    }
    const m = { id: randomUUID(), eventId: ev.id, ...seatMessage(ev, g, t, kind), state: 'queued', attempts: 0, lastError: null, createdAt: iso(), sentAt: null };
    msgs().push(m);
    setNotify(g.id, { state: 'queued', lastAt: m.createdAt, messageId: m.id });
    return m;
  }
  const sameSeat = (a, b) => Boolean(a && b) && a.tableId === b.tableId && (a.seatNo ?? null) === (b.seatNo ?? null) && a.status === b.status;
  const samePlace = (a, b) => Boolean(a && b) && a.tableId === b.tableId && (a.seatNo ?? null) === (b.seatNo ?? null);
  // A guest who said Yes and whose reserved seat staff then gave or moved: the reply email with the
  // new table (no personal link: CORE has no copy of it; it tells them to show their invitation's
  // QR code at the door).
  function queueRsvp(ev, g, update) {
    if (!g.email) return null;
    const t = coll(db, 'caTables').find((x) => x.id === g.seat?.tableId);
    const m = { id: randomUUID(), eventId: ev.id, ...rsvpMessage(ev, g, t, { update }), state: 'queued', attempts: 0, lastError: null, createdAt: iso(), sentAt: null };
    msgs().push(m);
    setNotify(g.id, { state: 'queued', lastAt: m.createdAt, messageId: m.id });
    return m;
  }
  // plan: the change commit() made; before: guestId → the seat before it.
  function afterCommit(ev, plan, before) {
    // These commands queued their own messages.
    if (['notify', 'invite', 'rsvp'].includes(plan.type)) return kick();
    let n = 0;
    for (const id of plan.guestIds || []) {
      const g = coll(db, 'caGuests').find((x) => x.id === id);
      if (g && isReserved(g.seat) && g.rsvpReply?.answer === 'yes' && !samePlace(before.get(id), g.seat)) {
        if (queueRsvp(ev, g, Boolean(before.get(id)))) n++;
        continue;
      }
      if (!g || !isConfirmed(g.seat) || sameSeat(before.get(id), g.seat)) continue;
      const had = isConfirmed(before.get(id)) || msgs().some((m) => m.guestId === id && m.state === 'sent' && !['invitation', 'rsvp'].includes(m.kind));
      if (queueFor(ev, g, had ? 'update' : 'assignment') || !g.email) n++;
    }
    if (n) {
      markDirty();
      kick();
    }
  }

  // ----- Drain (outside commit()) -----
  const ready = (m) => m.state === 'queued' && (!m.nextAt || m.nextAt <= iso());
  function next() {
    for (const m of msgs()) {
      if (!ready(m)) continue;
      const ev = eventOf(m.eventId);
      if (!ev || ev.flags?.emailPaused) continue;
      return m;
    }
    return null;
  }
  function fail(m, error) {
    setMsg(m.id, { state: 'failed', lastError: String(error).slice(0, 300), failedAt: iso(), tokenSealed: null });
    status(m, { state: 'failed', lastAt: iso(), lastError: String(error).slice(0, 200) });
    stats.failed++;
    markDirty();
  }
  // The personal link of a message, from its sealed token: null when it has none; an Error when it
  // cannot be used (the seal is from another server, or the guest's link changed since).
  function linkOf(m, ev, g) {
    if (!m.tokenSealed) return m.kind === 'invitation' ? new Error('The invitation has no link to send. Send it again.') : null;
    const token = vault.open(m.tokenSealed);
    if (!token) return new Error('The link could not be read (it was sealed on another server). Send the invitation again.');
    if (!g?.invite?.hash || inviteHashOf(token) !== g.invite.hash) return new Error('Not sent: the guest\'s invitation link was sent again or revoked before this message went.');
    return inviteLink(m.linkBase || g.invite.base, ev.code, token);
  }
  async function sendOne(m) {
    const ev = eventOf(m.eventId);
    const from = String(ev?.settings?.emailFrom || '').toLowerCase();
    if (!transport?.canSendEvents()) return fail(m, 'Outgoing email is not set up for events (IT Service Desk → Settings → Sending email → Use for CUSTOM APP event emails).');
    if (!EMAIL_RE.test(from)) return fail(m, 'The event has no From address (Setup → Event → Email from).');
    if (from === transport.mailboxAddress()) return fail(m, 'The event\'s From address is the IT Service Desk mailbox; use the event\'s own address.');
    const attempts = (m.attempts || 0) + 1;
    const g = coll(db, 'caGuests').find((x) => x.id === m.guestId);
    const personal = m.kind === 'invitation' || m.kind === 'rsvp';
    let link = personal ? linkOf(m, ev, g) : null;
    // An invitation is its link; a reply email still goes without it (it points to the invitation).
    if (link instanceof Error) {
      if (m.kind !== 'rsvp') return fail(m, link.message);
      link = null;
    }
    setMsg(m.id, { state: 'sending', attempts, sendingAt: iso(), nextAt: null });
    status(m, { state: 'sending', lastAt: iso(), attempts });
    inFlight = m.id;
    markDirty();
    const replyTo = String(ev.settings?.replyTo || '');
    let body = { text: m.body };
    if (personal) {
      // The link in the text, and an HTML version with a button and the QR code as a picture in the
      // message itself (cid:), never a data: address (Gmail and Outlook do not show those).
      const cid = link ? newContentId('qr', from) : '';
      body = {
        text: textWithLink(m.body, link),
        html: messageHtml(ev, link ? m.body : withoutLink(m.body), { link, qrCid: cid, button: m.kind === 'invitation' ? 'Reply to the invitation' : 'Open my invitation' }),
        ...(link ? { inline: [{ cid, type: 'image/png', name: 'qr-code.png', data: qrPng(link, { scale: 6 }) }] } : {}),
      };
    }
    const raw = composeMessage({
      from: { name: ev.name, email: from }, to: [{ name: g?.name?.display || '', email: m.to }],
      ...(EMAIL_RE.test(replyTo) ? { replyTo: { name: ev.name, email: replyTo } } : {}),
      subject: m.subject, ...body, messageId: newMessageId(from), auto: 'generated',
    });
    try {
      await send(transport.options(), { from, to: [m.to], raw });
      setMsg(m.id, { state: 'sent', sentAt: iso(), lastError: null, tokenSealed: null });
      status(m, { state: 'sent', lastAt: iso(), attempts, lastError: null });
      stats.sent++;
      markDirty();
    } catch (err) {
      if (isTransient(err) && attempts <= OUTBOX.retries) {
        setMsg(m.id, { state: 'queued', lastError: String(err.message).slice(0, 300), nextAt: new Date(now() + (backoffMs[attempts - 1] ?? backoffMs.at(-1))).toISOString() });
        status(m, { state: 'queued', lastAt: iso(), attempts, lastError: String(err.message).slice(0, 200) });
        markDirty();
      } else fail(m, err.message);
    } finally {
      inFlight = null;
    }
  }
  // One at a time, in order; a second call while it runs joins the same run.
  function drain() {
    if (running) return running;
    const run = (async () => {
      await null; // so that `running` is set before the loop can finish
      try {
        for (let m = next(); m; m = next()) await sendOne(m);
      } finally {
        running = null;
      }
    })();
    running = run;
    return run;
  }
  function kick() {
    setImmediate(() => drain().catch((err) => console.error('CUSTOM APP outbox:', err.message)));
  }
  // A message left in "sending" (the process stopped mid-send) for longer than staleSendingMs.
  function requeueStale() {
    const cutoff = new Date(now() - staleSendingMs).toISOString();
    let n = 0;
    for (const m of [...msgs()]) {
      if (m.state !== 'sending' || m.id === inFlight || (m.sendingAt && m.sendingAt > cutoff)) continue;
      setMsg(m.id, { state: 'queued', lastError: 'Interrupted while sending; queued again.', nextAt: null });
      status(m, { state: 'queued', lastAt: iso() });
      n++;
    }
    if (n) markDirty();
    return n;
  }

  // What the health strip shows for one event (kind: only messages of that kind).
  function depth(eventId, kind = null) {
    const mine = msgs().filter((m) => m.eventId === eventId && (!kind || m.kind === kind));
    const c = (s) => mine.filter((m) => m.state === s).length;
    return { queued: c('queued'), sending: c('sending'), sent: c('sent'), failed: c('failed') };
  }

  return {
    transport, vault, afterCommit, drain, kick, requeueStale, depth, flush, stats, queueFor,
    start({ tickMs = OUTBOX.tickMs } = {}) {
      requeueStale();
      timer = setInterval(() => {
        requeueStale();
        drain().catch(() => {});
      }, tickMs);
      timer.unref?.();
      kick();
    },
    stop() {
      clearInterval(timer);
      flush();
    },
  };
}
