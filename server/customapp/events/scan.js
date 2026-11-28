// CUSTOM APP → events: Scan QR (0.75). Staff point their phone at the QR code in a guest's
// invitation (https://<host>/event/<code>#i=<token>, invite.js) inside CORE, and the guest's sheet
// opens: no personal page in the usher's browser, no link left in its history.
//
//   POST /api/customapp/events/:id/scan { text } → { found: true, guestId, guest, notice? }
//                                                 | { found: false, code, message }
//
// The event's staff and its Super Administrator only (a CORE administrator who is not on the staff
// is refused, someone with no part in the event gets 404), rate limited per person (event-scan).
// The text is read here, never trusted: only a link of this site (the address CORE is used on, the
// event's public address, or the address its invitations went out on) to this same event counts,
// or a bare token. The token is hashed at once and looked up among this event's guests; it is never
// returned, logged or audited (a lookup, like Find guest, writes nothing). A link that was replaced
// or revoked, another event's link, the reception QR, another site and anything else get a plain
// message that names no guest. Checking in stays the ordinary checkIn command on the sheet.
import { fmtManila } from '../../../shared/customapp/time.js';
import { userCan } from '../../../shared/roles.js';
import { HttpError } from '../../util.js';
import { mustEvent, roleOf, refusal, stateOf, guestView, INVITE_TOKEN_RE, inviteHashOf, earlierKey } from './model.js';

export const SCAN_MESSAGES = Object.freeze({
  not_invitation: 'Not an invitation for this event. Scan the QR code in the guest\'s invitation email, or use Find guest.',
  other_event: 'Not an invitation for this event: that QR code is for another event. Use Find guest.',
  reception: 'That is the reception QR; scan the guest\'s invitation QR, or use Find guest.',
  replaced: 'This invitation link was replaced (a newer one was sent). Ask the guest for the newest invitation email, or use Find guest.',
  revoked: 'This invitation link was revoked. Use Find guest, or refer the guest to the Super Administrator.',
  empty: 'Nothing was read. Hold the QR code inside the square, or use Find guest.',
});

// What a scanned text is, without looking anything up:
//   { kind: 'token', token }                 a bare invitation token (43 characters, base64url)
//   { kind: 'invite', host, code, token }    an event link with #i=<token>
//   { kind: 'reception', host, code }        an event link without #i= (the reception QR, maybe #k=)
//   { kind: 'bad_link', host, code }         an event link whose #i= is not a token
//   { kind: 'other_link', host }             any other web address
//   { kind: 'empty' } | { kind: 'garbage' }  nothing, or not a web address at all
export function parseScan(text) {
  const s = String(text ?? '').trim();
  if (!s) return { kind: 'empty' };
  if (s.length > 2000) return { kind: 'garbage' };
  if (INVITE_TOKEN_RE.test(s)) return { kind: 'token', token: s };
  let u;
  try {
    u = new URL(s);
  } catch {
    return { kind: 'garbage' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { kind: 'garbage' };
  const host = u.host.toLowerCase();
  const m = u.pathname.match(/^\/event\/([A-Za-z0-9-]{1,60})\/?$/);
  if (!m || u.username || u.password) return { kind: 'other_link', host };
  const code = m[1].toLowerCase();
  const frag = new URLSearchParams(u.hash.replace(/^#/, ''));
  if (!frag.has('i')) return { kind: 'reception', host, code };
  const token = frag.get('i');
  return INVITE_TOKEN_RE.test(token) ? { kind: 'invite', host, code, token } : { kind: 'bad_link', host, code };
}

// The hosts an event's links can be on: where CORE is being used now, the event's public address
// (invitation settings), and the address each guest's invitation went out on.
export function eventHosts(ev, guests, origin) {
  const hosts = new Set();
  const add = (v) => {
    try {
      if (v) hosts.add(new URL(String(v)).host.toLowerCase());
    } catch {}
  };
  add(origin);
  add(ev.settings?.invitation?.publicUrl);
  for (const g of guests) add(g.invite?.base);
  return hosts;
}

// opts: { limits } (server/ratelimit.js; the bucket event-scan is per person)
export function registerScanRoutes(route, db, { limits = { hit() {} } } = {}) {
  const nameOf = (id) => (db.data.users || []).find((u) => u.id === id)?.name || '';
  route('POST', '/api/customapp/events/:id/scan', 'customapp.use', ({ user, params, body, origin }) => {
    const ev = mustEvent(db, params.id);
    const role = roleOf(ev, user, userCan(user, 'customapp.manage'));
    if (!role) throw new HttpError(404, 'That event is not there, or you do not have access to it.');
    if (role !== 'staff' && role !== 'super') throw refusal('out_of_scope', undefined, 'Scan QR is for the event\'s staff.');
    limits.hit('event-scan', user.id, 'Too many scans in a minute. Wait a moment, or use Find guest.');
    const no = (code) => ({ found: false, code, message: SCAN_MESSAGES[code] });
    const p = parseScan(body?.text);
    if (p.kind === 'empty') return no('empty');
    if (p.kind === 'garbage' || p.kind === 'other_link') return no('not_invitation');
    const state = stateOf(db, ev);
    if (p.host && !eventHosts(ev, state.guests, origin).has(p.host)) return no('not_invitation');
    if (p.code && p.code !== ev.code) return no('other_event');
    if (p.kind === 'reception') return no('reception');
    if (p.kind === 'bad_link') return no('not_invitation');
    const hash = inviteHashOf(p.token);
    const g = state.guests.find((x) => x.active !== false && x.invite?.hash === hash);
    if (!g) {
      // An earlier link of a guest still on the list: say what happened to it, and nothing about whose.
      const key = earlierKey(hash);
      const old = state.guests.filter((x) => x.active !== false).flatMap((x) => x.invite?.earlier || []).find((e) => e.h === key);
      return no(old?.why === 'revoked' ? 'revoked' : old ? 'replaced' : 'not_invitation');
    }
    const guest = guestView(g, { role, userId: user.id, tables: state.tables, industries: ev.industries });
    const out = { found: true, guestId: g.id, guest };
    if (g.arrival?.state === 'checked_in') {
      const who = g.arrival.by ? `by ${nameOf(g.arrival.by) || 'staff'}` : 'by the guest on their phone';
      out.notice = { code: 'already_checked_in', text: `Already checked in at ${fmtManila(g.arrival.at, { date: false })} ${who}.` };
    } else if (g.substitutedBy) {
      const sub = state.guests.find((x) => x.id === g.substitutedBy);
      out.notice = { code: 'substituted', text: `Walk-in or substitute: ${sub?.name?.display || 'a substitute'} came in this guest's place (approved). Check the substitute in on their own sheet.` };
    } else if (state.guests.some((x) => x.substituteFor === g.id && x.approval?.state === 'pending')) {
      const sub = state.guests.find((x) => x.substituteFor === g.id && x.approval?.state === 'pending');
      out.notice = { code: 'substitute_pending', text: `Walk-in or substitute: ${sub.name?.display || 'a substitute'} is waiting for the Super Administrator's approval to come in this guest's place. If the invitee is here after all, check them in.` };
    } else if (g.classification === 'unlisted' && g.approval?.state !== 'approved') {
      out.notice = { code: 'unlisted', text: 'Walk-in or substitute: waiting for the Super Administrator\'s approval before check-in.' };
    }
    return out;
  });
}
