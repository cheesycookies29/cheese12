// CUSTOM APP → events: personal invitations, the guest's reply, and the door check-in by the same
// link (0.74). Each guest gets an email with their own link (https://<host>/event/<code>#i=<token>)
// as a button, as plain text and as a QR code. On their link they answer Yes or No (and may change
// it until replies close); a Yes reserves a seat at once (engine.js rsvp, through commit(), as the
// system actor 'system:rsvp') and the reply email gives the table and chair. On the night the same
// link (or its QR code, scanned at the door) offers Check in: the token proves who it is.
//
// The token: 32 random bytes, made here, kept on the guest only as its SHA-256 (model.js
// inviteHashOf). Sending again makes a new token (the earlier link stops working): CORE keeps no copy
// of a token, so it cannot send the same one twice. While its email waits in the outbox the token is
// sealed there (CORE's secrets); the outbox removes it once the email has gone.
//
// Signed out (the guest page, /api/public/event/:code/…, header X-Event-Invite: <token>):
//   GET  …/invite    the guest's invitation: name, the event, their answer, their seat, what they can do
//   POST …/rsvp      { answer: yes | no } → the same, after commit(rsvp)
//   POST …/checkin   during self check-in, commit(selfCheckIn by the link) → the same, with the seat
// Every failure (no such link, a revoked or replaced one, too many requests, the event not live) gets
// the guest page's one referral reply (public.js gate.refer: the same status and bytes, but for its
// R-1234 code), and every reply is padded to the same time. The limits are the event's own buckets:
// event-verify per event for every request, event-token per link.
//
// Signed in (the event's Super Administrator; Event control → Invitations):
//   GET  /api/customapp/events/:id/invitations           settings, warnings, counts, guests, no email
//   POST /api/customapp/events/:id/invitations/preview   the email as a guest gets it (a sample link)
//   POST /api/customapp/events/:id/invitations/send      { guestIds? } → commit(invite): new links, queued
//   POST /api/customapp/events/:id/invitations/test      { to } a sample from the event's From, sent now
import { HttpError } from '../../util.js';
import { pollFor, RSVP_LABELS } from '../../../shared/customapp/statuses.js';
import { isConfirmed } from '../../../shared/customapp/seating.js';
import { userCan } from '../../../shared/roles.js';
import { commit } from './commit.js';
import { eventsOf, guestsOf, tablesOf, stateOf, mustEvent, roleOf, refusal, bad, INVITE_TOKEN_RE, inviteHashOf, newInviteToken, inviteLink, rsvpStatusOf, maskEmail, seatsOnYes } from './model.js';
import { invitationMessage, eventDetails, rsvpClosesAt, textWithLink, messageHtml } from './message.js';
import { invitationCounts } from './counts.js';
import { mutation } from './routes.js';
import { qrPng, qrSvg } from '../qr.js';
import { composeMessage, newMessageId, newContentId } from '../../mail/compose.js';
import { sendMail as smtpSend } from '../../mail/smtp.js';
import { moduleName } from '../../../shared/modules.js';
// The module's name as people see it (shared/modules.js), never written into the engine.
const APP_NAME = moduleName('customapp');

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const padMsDefault = () => {
  const v = Number(process.env.CUSTOMAPP_VERIFY_PAD_MS);
  return Number.isFinite(v) && v >= 0 ? v : 350;
};

// Whether the door is open for a check-in by the link now (the same rule as selfCheckIn).
function doorOpen(ev, nowIso) {
  const w = ev.window || {};
  return ev.status === 'live' && Boolean(ev.flags?.registrationOpen) && !ev.flags?.readOnly && (!w.opensAt || nowIso >= w.opensAt) && (!w.closesAt || nowIso <= w.closesAt);
}

// What the guest's page shows: only this guest's own name, answer and seat, and the event.
export function inviteView(ev, g, tables, nowIso, notice = '') {
  const inv = ev.settings?.invitation || {};
  const closes = rsvpClosesAt(ev);
  const here = g.arrival?.state === 'checked_in';
  const answer = g.rsvpReply?.answer || null;
  const t = g.seat ? tables.find((x) => x.id === g.seat.tableId) : null;
  // The seat is shown once it is theirs to know: after a Yes, or once they are checked in.
  const showSeat = Boolean(g.seat) && (answer === 'yes' || here);
  return {
    state: 'invite', seq: ev.seq || 0, pollMs: pollFor(ev.flags, here && !g.seat ? 'pending' : 'seated'),
    event: { name: ev.name, date: ev.date || '', details: eventDetails(ev), intro: inv.intro || '', rsvpClosesAt: closes },
    guest: { name: g.name?.title ? `${g.name.title} ${g.name.last}` : g.name?.display || `${g.name?.first || ''} ${g.name?.last || ''}`.trim(), firstName: g.name?.first || '' },
    rsvp: answer, rsvpAt: g.rsvpReply?.at || null,
    canAnswer: !here && !ev.flags?.readOnly && !(closes && nowIso > closes),
    seat: showSeat ? { table: t?.number ?? null, seat: g.seat.seatNo ?? null, status: isConfirmed(g.seat) ? 'seated' : 'reserved' } : null,
    waitingTable: answer === 'yes' && !g.seat && !here,
    door: { open: doorOpen(ev, nowIso) && !here, checkedIn: here, checkedInAt: here ? g.arrival.at : null },
    emailed: answer === 'yes' && Boolean(g.email) && !ev.flags?.emailPaused,
    notice,
  };
}

// opts: { ctx, gate, limits, clock () → ms, padMs, vault }
export function registerInviteRoutes(route, db, { ctx, gate, limits = { hit() {} }, clock = () => Date.now(), padMs = padMsDefault(), vault, outbox = null, audit = null, send = smtpSend }) {
  const byCode = (code) => eventsOf(db).find((e) => e.code === String(code || '').toLowerCase().slice(0, 60)) || null;
  const nowIso = () => new Date(clock()).toISOString();
  const fresh = (ev, g) => ({ ev: eventsOf(db).find((e) => e.id === ev.id), g: guestsOf(db, ev.id).find((x) => x.id === g.id) });
  const view = (ev, g, notice = '') => {
    const f = fresh(ev, g);
    return { data: inviteView(f.ev, f.g, tablesOf(db, ev.id), nowIso(), notice), headers: NO_STORE };
  };

  // The link's guest, or the referral reply. Synchronous, so the answer that follows is made from
  // the state as it is in this same moment.
  function lookup({ params, headers }) {
    const ev = byCode(params.code);
    if (!ev) return { out: gate.refer(null, 'not_live') };
    try {
      limits.hit('event-verify', ev.id);
    } catch {
      return { out: gate.refer(ev, 'busy') };
    }
    if (ev.status !== 'live') return { out: gate.refer(ev, 'not_live') };
    const token = String(headers?.['x-event-invite'] || '');
    if (!INVITE_TOKEN_RE.test(token)) return { out: gate.refer(ev, 'invite_invalid') };
    const hash = inviteHashOf(token);
    try {
      limits.hit('event-token', `i:${hash.slice(0, 32)}`);
    } catch {
      return { out: gate.refer(ev, 'busy') };
    }
    const g = guestsOf(db, ev.id).find((x) => x.active !== false && x.invite?.hash === hash);
    if (!g) return { out: gate.refer(ev, 'invite_invalid') };
    if (g.substitutedBy) return { out: gate.refer(ev, 'substituted') };
    return { ev, g, token, hash };
  }

  // Every reply waits until the same moment after the request came in (plus a little noise).
  const padded = (fn) => async (req) => {
    const started = clock();
    let out;
    try {
      out = fn(req);
    } catch (err) {
      console.error(`${APP_NAME} invitation page:`, err.message);
      out = gate.refer(byCode(req.params.code), 'not_saved');
    }
    const wait = padMs ? padMs + Math.floor(Math.random() * padMs * 0.15) - (clock() - started) : 0;
    if (wait > 0) await pause(wait);
    return out;
  };

  route('GET', '/api/public/event/:code/invite', 'public', padded((req) => {
    const x = lookup(req);
    if (x.out) return x.out;
    // The first time the link is opened: "Opened" on the staff screens. A refusal (read only) only
    // means it is not recorded.
    if (!x.g.invite.openedAt) {
      try {
        commit(ctx, x.ev.id, { synthetic: 'rsvp' }, { type: 'inviteOpened', guestId: x.g.id, inviteHash: x.hash });
      } catch {}
    }
    return view(x.ev, x.g);
  }));

  route('POST', '/api/public/event/:code/rsvp', 'public', padded((req) => {
    const x = lookup(req);
    if (x.out) return x.out;
    const answer = req.body?.answer;
    if (answer !== 'yes' && answer !== 'no') return gate.refer(x.ev, 'malformed');
    // The token sealed for the reply email (its QR code), only when an email will go.
    const tokenSealed = answer === 'yes' && x.g.email && vault ? vault.seal(x.token) : undefined;
    try {
      commit(ctx, x.ev.id, { synthetic: 'rsvp' }, { type: 'rsvp', guestId: x.g.id, answer, inviteHash: x.hash, ...(tokenSealed ? { tokenSealed } : {}) });
    } catch (err) {
      if (err.code === 'rsvp_closed') return view(x.ev, x.g, 'closed');
      if (err.code === 'already_checked_in') return view(x.ev, x.g, 'checked_in');
      return gate.refer(x.ev, err.code === 'read_only' ? 'read_only' : 'not_saved');
    }
    return view(x.ev, x.g);
  }));

  route('POST', '/api/public/event/:code/checkin', 'public', padded((req) => {
    const x = lookup(req);
    if (x.out) return x.out;
    if (x.g.deskOnly) return gate.refer(x.ev, 'desk_only');
    try {
      commit(ctx, x.ev.id, { synthetic: 'self' }, { type: 'selfCheckIn', guestId: x.g.id, inviteHash: x.hash });
    } catch (err) {
      if (err.code === 'registration_closed') return view(x.ev, x.g, 'door_closed');
      return gate.refer(x.ev, err.code === 'read_only' ? 'read_only' : 'not_saved');
    }
    return view(x.ev, x.g);
  }));

  // ----- The Super Administrator's side -----
  const base = '/api/customapp/events/:id/invitations';
  const superOf = (user, id) => {
    const ev = mustEvent(db, id);
    const role = roleOf(ev, user, userCan(user, 'customapp.manage'));
    if (!role) throw new HttpError(404, 'That event is not there, or you do not have access to it.');
    if (role !== 'super') throw refusal('needs_super_admin');
    return ev;
  };
  // The address the links use: the event's public address when set, else the one the Super
  // Administrator is using CORE on (https://ltdc-core.com in production).
  const linkBaseOf = (ev, origin) => String(ev.settings?.invitation?.publicUrl || origin || '').replace(/\/+$/, '');
  const helpdeskAddress = () => String(db.data.helpdesk?.mailbox?.address || '').toLowerCase();

  // What may stop or spoil the invitations: block (Send is refused), warn, info.
  function warningsOf(ev, linkBase) {
    const out = [];
    const from = String(ev.settings?.emailFrom || '').toLowerCase();
    const add = (code, level, text) => out.push({ code, level, text });
    if (ev.status !== 'live') add('not_live', 'block', 'The event is not Live yet: its links would not answer. Set Status to Live under Setup → Event.');
    if (!from) add('no_from', 'block', 'The event has no From address. Set one on the verified domain (for example events@ltdc-core.com) under Setup → Event → Email from.');
    else if (from === helpdeskAddress()) add('from_helpdesk', 'block', 'The From address is the IT Service Desk mailbox: guests\' replies would become tickets. Use the event\'s own address.');
    let host = '';
    try {
      host = new URL(linkBase).hostname.toLowerCase();
    } catch {}
    const domain = from.split('@')[1] || '';
    if (from && host && domain && !(host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`))) add('other_domain', 'warn', `The From address (${from}) is not on the site's domain (${host}). Send from an address on the domain you verified for email, or mail may go to spam.`);
    if (!host || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(host) || /^http:/.test(linkBase)) add('local_link', 'warn', `The links would point to ${linkBase || 'nowhere'}, which guests cannot open. Open CORE at its public address (https://…) to send, or set the public address below.`);
    if (!outbox?.transport?.canSendEvents()) add('no_transport', ev.flags?.emailPaused ? 'warn' : 'block', `Outgoing email is not set up for events (IT Service Desk → Settings → Sending email → Use for ${APP_NAME} event emails). Invitations can be queued while email is paused, and go when it is set up and turned on.`);
    if (ev.flags?.emailPaused) add('paused', 'info', 'Email is paused (Event control → Switches): invitations wait in the outbox until you turn it on.');
    if (!seatsOnYes(ev)) add('no_auto_seat', 'info', 'Seat on Yes is off: guests who say Yes wait in the exceptions inbox for you to reserve their seat.');
    return out;
  }
  const invitable = (g) => g.active !== false && g.classification !== 'unlisted' && !g.substitutedBy;
  const tableNo = (state, g) => (g.seat ? state.tables.find((t) => t.id === g.seat.tableId)?.number ?? null : null);

  route('GET', base, 'customapp.use', ({ user, params, origin }) => {
    const ev = superOf(user, params.id);
    const state = stateOf(db, ev);
    const linkBase = linkBaseOf(ev, origin);
    const list = state.guests.filter(invitable).sort((a, b) => (a.name?.last || '').localeCompare(b.name?.last || '') || (a.name?.first || '').localeCompare(b.name?.first || ''));
    return {
      settings: { ...(ev.settings?.invitation || {}), autoSeatOnConfirm: seatsOnYes(ev) }, venue: ev.venue || '', date: ev.date || '',
      from: ev.settings?.emailFrom || '', replyTo: ev.settings?.replyTo || '', linkBase, origin: origin || '', rsvpClosesAt: rsvpClosesAt(ev),
      warnings: warningsOf(ev, linkBase), counts: invitationCounts(state), outbox: outbox ? outbox.depth(ev.id, 'invitation') : null,
      emailPaused: Boolean(ev.flags?.emailPaused), canEmail: Boolean(outbox?.transport?.canSendEvents()), rev: ev.rev || 0,
      guests: list.map((g) => ({
        id: g.id, ref: g.ref, name: g.name?.display || '', company: g.company || '', classification: g.classification, hasEmail: Boolean(g.email), email: maskEmail(g.email),
        rsvpStatus: rsvpStatusOf(g), rsvpLabel: RSVP_LABELS[rsvpStatusOf(g)], listRsvp: g.rsvpReply ? '' : g.rsvp || '', rsvpAt: g.rsvpReply?.at || null,
        invite: { state: g.invite?.state || 'none', sentAt: g.invite?.sentAt || null, openedAt: g.invite?.openedAt || null, count: g.invite?.count || 0, lastError: g.invite?.lastError || '' },
        seat: g.seat ? { number: tableNo(state, g), seatNo: g.seat.seatNo ?? null, status: g.seat.status, auto: g.seat.via === 'rsvp' } : null, rev: g.rev || 0,
      })),
    };
  });

  // The email exactly as a guest gets it, for one guest (or the first on the list), with a sample
  // link that does not work. The QR code is shown on screen as a picture of its own.
  route('POST', `${base}/preview`, 'customapp.use', ({ user, params, body, origin }) => {
    const ev = superOf(user, params.id);
    const state = stateOf(db, ev);
    const g = state.guests.find((x) => x.id === body?.guestId) || state.guests.find((x) => invitable(x) && x.email) || { id: 'sample', name: { first: 'Maria', last: 'Santos', display: 'Maria Santos' }, email: 'guest@example.com' };
    const msg = invitationMessage(ev, g);
    const link = inviteLink(linkBaseOf(ev, origin), ev.code, 'SAMPLE-LINK-FOR-THE-PREVIEW-ONLY-xxxxxxxxxx');
    return {
      from: ev.settings?.emailFrom || '', replyTo: ev.settings?.replyTo || '', to: g.email ? maskEmail(g.email) : '', guest: g.name?.display || '', subject: msg.subject, text: textWithLink(msg.body, link),
      html: messageHtml(ev, msg.body, { link, qrCid: 'preview-qr' }), qrSvg: qrSvg(link, { scale: 4, label: 'QR code of the personal link (sample)' }), link,
    };
  });

  // Send: every guest with an address who has no invitation yet (or whose link was revoked), or the
  // guests chosen (again: a new link each, the earlier one stops working). One commit for all.
  route('POST', `${base}/send`, 'customapp.use', mutation(({ user, params, body, origin }) => {
    const ev = superOf(user, params.id);
    const state = stateOf(db, ev);
    const linkBase = linkBaseOf(ev, origin);
    const blocking = warningsOf(ev, linkBase).filter((w) => w.level === 'block');
    if (blocking.length) throw bad(blocking[0].text);
    if (!vault) throw bad('Invitations cannot be sent from here (no key to seal the links).');
    let targets;
    if (Array.isArray(body?.guestIds)) {
      const ids = [...new Set(body.guestIds.map(String))].slice(0, 501);
      targets = ids.map((id) => state.guests.find((g) => g.id === id) || (() => { throw bad('That guest is not on this event\'s list.'); })());
      const noMail = targets.find((g) => !g.email);
      if (noMail) throw bad(`${noMail.name?.display || noMail.ref} has no email address.`);
    } else targets = state.guests.filter((g) => invitable(g) && g.email && (!g.invite?.state || g.invite.state === 'none' || g.invite.state === 'revoked'));
    if (!targets.length) throw bad('Every guest with an email address has an invitation already. Choose a guest to send theirs again.');
    const issues = targets.map((g) => {
      const token = newInviteToken();
      return { guestId: g.id, hash: inviteHashOf(token), sealed: vault.seal(token) };
    });
    const r = commit(ctx, ev.id, user, { type: 'invite', issues, base: linkBase, opId: body?.opId });
    return { ok: true, queued: r.queued ?? issues.length, again: r.again ?? 0, seq: r.seq, counts: invitationCounts(stateOf(db, mustEvent(db, ev.id))) };
  }));

  // A sample invitation to any address, from the event's own From, sent now (not through the
  // outbox): to try Gmail, Outlook and Yahoo before inviting the guests. Its link does not work.
  route('POST', `${base}/test`, 'customapp.use', async ({ user, params, body, origin }) => {
    const ev = superOf(user, params.id);
    const to = String(body?.to || '').trim().toLowerCase().slice(0, 254);
    if (!EMAIL_RE.test(to)) throw bad('Enter the address to send the test to.');
    const from = String(ev.settings?.emailFrom || '').toLowerCase();
    if (!EMAIL_RE.test(from)) throw bad('Set the event\'s From address first (Setup → Event → Email from).');
    if (from === helpdeskAddress()) throw bad('The From address is the IT Service Desk mailbox. Use the event\'s own address.');
    if (!outbox?.transport?.canSendEvents()) throw bad(`Outgoing email is not set up for events (IT Service Desk → Settings → Sending email → Use for ${APP_NAME} event emails).`);
    limits.hit('sensitive', user.id, 'Too many test emails. Wait a minute.');
    const msg = invitationMessage(ev, { id: 'test', name: { first: user.name, last: '', display: user.name }, email: to });
    const link = inviteLink(linkBaseOf(ev, origin), ev.code, 'TEST-LINK-FROM-EVENT-CONTROL-does-not-answer');
    const cid = newContentId('qr', from);
    const replyTo = String(ev.settings?.replyTo || '');
    const raw = composeMessage({
      from: { name: ev.name, email: from }, to: [{ name: '', email: to }], ...(EMAIL_RE.test(replyTo) ? { replyTo: { name: ev.name, email: replyTo } } : {}),
      subject: `[Test] ${msg.subject}`, text: textWithLink(msg.body, link), html: messageHtml(ev, msg.body, { link, qrCid: cid }),
      inline: [{ cid, type: 'image/png', name: 'qr-code.png', data: qrPng(link, { scale: 6 }) }], messageId: newMessageId(from), auto: 'generated',
    });
    try {
      await send(outbox.transport.options(), { from, to: [to], raw });
    } catch (err) {
      throw bad(`Could not send: ${err.message}`);
    }
    audit?.record('customapp.invite-test', { entity: 'caEvent', entityId: ev.id, label: ev.name, note: `Test invitation sent to ${maskEmail(to)} from ${from}` });
    return { ok: true, message: `Test invitation sent to ${to} from ${from}. Check that it arrived in the inbox (not spam), with the QR code showing.` };
  });
}
