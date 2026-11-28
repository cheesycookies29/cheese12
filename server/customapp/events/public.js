// CUSTOM APP → events: the guest page's API (US-014, US-015, US-016), the only code here that answers
// signed-out requests. /api/public/event/:code/* answers only for a live event, is exempt from CORE's
// signed-out limits (server/api.js gives it the event-ip bucket) and uses the event buckets here.
//
//   GET  /api/public/event/:code          { name, date, state: closed | open, opensAt } and nothing else
//   POST /api/public/event/:code/verify   { surname, last4 | email, k?, website, elapsedMs }
//        one exact match → commit(selfCheckIn) → { state, token, title, firstName, table, seat, seq, pollMs }
//        anything else  → the referral reply, the same status and the same bytes apart from its code
//   GET  /api/public/event/:code/status   header X-Event-Token, ?since=seq
//        { seq, pollMs, state: pending | seated | see_desk, title, firstName, table, seat } or { seq, pollMs, unchanged }
//
// Rules (design R1, R2):
//  - Check order: the limiter, then the window (live, self check-in open, not read only, the presence
//    key when the event has one), then the input, then the soft cap, then the match.
//  - Exact match on the normalised surname (shared with the import), plus the last 4 digits of the
//    mobile or the full email. No fuzzy match, no candidate list, no first-name fallback.
//  - Every failure gets the same reply (status 200, the same body but for a random referral code
//    R-1234 from one pool); staff read the real reason by the code (GET …/referral/:code).
//  - Every reply, success or failure, is padded to the same time, so timing tells nothing.
//  - Failed attempts never write to disk: the caps, the failure counts and the referral codes live in
//    bounded maps in memory (3 hours, 5,000 entries), lost on a restart (that fails toward the guest).
//  - Soft cap: 8 different wrong last-4 values (or emails) for one surname in 15 minutes; a value
//    typed again counts once; it clears after 15 minutes or with one tap at the desk. No lockout for
//    anyone else; more than 30 failures in 5 minutes raises an alarm for the Super Administrator.
//  - The status token: 32 random bytes, kept only as its SHA-256 on the guest (at most 5 devices),
//    read only from the X-Event-Token header (the page keeps it in the URL fragment, which browsers
//    never send). Replies are never cached and send no referrer.
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../util.js';
import { pollFor } from '../../../shared/customapp/statuses.js';
import { isConfirmed } from '../../../shared/customapp/seating.js';
import { commit } from './commit.js';
import { eventsOf, guestsOf, tablesOf, canonSurname, cleanText, maskEmail } from './model.js';
import { moduleName } from '../../../shared/modules.js';
// The module's name as people see it (shared/modules.js), never written into the engine.
const APP_NAME = moduleName('customapp');

export const PUBLIC_LIMITS = Object.freeze({
  capValues: 8, capWindowMs: 15 * 60000, alarmFailures: 30, alarmWindowMs: 5 * 60000,
  ttlMs: 3 * 3600000, maxEntries: 5000, minFillMs: 1500, bodyBytes: 1024, surnameMax: 80, emailMax: 254,
});
// Programs that are not a guest's phone (the support form's idea, without a dependency).
const UA_DENY = /(bot|crawler|spider|curl\/|wget|python-requests|python-urllib|go-http-client|libwww|scrapy|httpie|java\/|okhttp)/i;
export const REASONS = Object.freeze({
  busy: 'Too many attempts for this event in the last minute (the event limit). Ask the guest to try again, or check them in here.',
  not_live: 'The event is not live.',
  window: 'Outside the self check-in window (before it opens or after it closes).',
  registration_closed: 'Self check-in is closed (the Super Administrator\'s switch).',
  read_only: 'The event is read only.',
  presence_key: 'The page was not opened from the reception QR code (the presence key was missing or wrong).',
  malformed: 'What was sent could not be read (a surname of 1 to 80 letters, and 4 digits or a full email).',
  bot: 'It looked like a program, not a person (a hidden field was filled in, or the browser is a known program).',
  too_fast: 'The form was sent faster than a person types.',
  capped: 'Too many different wrong numbers for this surname in 15 minutes (the soft cap). Clear the cap and check the guest in here.',
  ambiguous: 'Two guests on the list have this surname and these last 4 digits. Check the guest in here.',
  no_match: 'The surname is on the list, but not with those digits or that email.',
  not_listed: 'No guest on the list has this surname.',
  desk_only: 'This guest is marked desk only (checked in here).',
  unlisted: 'This guest is unlisted and waits for the Super Administrator\'s approval.',
  substituted: 'A substitute took this invitee\'s place (approved by the Super Administrator). Refer them to the Super Administrator.',
  not_saved: 'The check-in could not be saved at that moment. Check the guest in here.',
  // The personal invitation link (0.74, invite.js).
  invite_invalid: 'The invitation link is not one that works: it was revoked, or sent again (only the newest link works), or it was copied wrongly. Find the guest by name and check them in here, or send their invitation again.',
});

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
export const tokenHashOf = (token) => sha256(`customapp-status:${token}`);
export const qrKeyHashOf = (key) => sha256(`customapp-qr:${key}`);
const sameHash = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };

// A map that forgets: entries older than ttl go, and at most max are kept (the oldest dropped).
function boundedMap(max, ttl, now) {
  const m = new Map();
  const prune = () => {
    const t = now();
    for (const [k, v] of m) if (t - v.at > ttl) m.delete(k);
    while (m.size > max) m.delete(m.keys().next().value);
  };
  return { m, get: (k) => m.get(k), set(k, v) { m.delete(k); m.set(k, v); if (m.size > max) prune(); }, delete: (k) => m.delete(k), prune, get size() { return m.size; } };
}

// The gate's in-memory state, kept per CORE (one per registerCustomApp).
export function createPublicGate({ now = () => Date.now(), limits = { hit() {} }, audit = null } = {}) {
  const referrals = boundedMap(PUBLIC_LIMITS.maxEntries, PUBLIC_LIMITS.ttlMs, now); // code → { at, eventId, reason, typed, surnameKey }
  const caps = boundedMap(PUBLIC_LIMITS.maxEntries, PUBLIC_LIMITS.capWindowMs, now); // event|surname → { at, values: Map(value → at) }
  const failures = new Map(); // eventId → [ms] (the last 5 minutes)
  const alarms = new Map(); // eventId → { at, count, auditedAt }
  const timer = setInterval(() => {
    referrals.prune();
    caps.prune();
  }, 60000);
  timer.unref?.();

  // A fresh referral code, R- and four digits, not one in use.
  const newCode = () => {
    for (let i = 0; i < 20; i++) {
      const c = `R-${randomInt(1000, 10000)}`;
      if (!referrals.get(c)) return c;
    }
    return `R-${randomInt(1000, 10000)}`;
  };
  const capKey = (eventId, surnameKey) => `${eventId}|${surnameKey}`;
  const capOf = (eventId, surnameKey) => {
    const c = caps.get(capKey(eventId, surnameKey));
    if (!c) return null;
    const t = now();
    for (const [v, at] of c.values) if (t - at > PUBLIC_LIMITS.capWindowMs) c.values.delete(v);
    return c;
  };
  const isCapped = (eventId, surnameKey) => (capOf(eventId, surnameKey)?.values.size || 0) >= PUBLIC_LIMITS.capValues;

  function countFailure(ev) {
    const t = now();
    const list = (failures.get(ev.id) || []).filter((x) => t - x <= PUBLIC_LIMITS.alarmWindowMs);
    list.push(t);
    if (list.length > 2000) list.splice(0, list.length - 2000);
    failures.set(ev.id, list);
    if (list.length > PUBLIC_LIMITS.alarmFailures) {
      const a = alarms.get(ev.id) || { auditedAt: 0 };
      alarms.set(ev.id, { ...a, at: t, count: list.length });
      // Once per 5 minutes in the audit log (its own file, not the data file).
      if (audit && t - a.auditedAt > PUBLIC_LIMITS.alarmWindowMs) {
        alarms.get(ev.id).auditedAt = t;
        try {
          audit.record('customapp.alarm', { entity: 'caEvent', entityId: ev.id, label: ev.name, note: `${list.length} failed guest page checks in 5 minutes. Nobody is locked out; check the referral codes at the desk.` });
        } catch {}
      }
    }
  }
  // The alarm for the Super Administrator: more than 30 failures in the last 5 minutes.
  function alarmOf(eventId) {
    const t = now();
    const n = (failures.get(eventId) || []).filter((x) => t - x <= PUBLIC_LIMITS.alarmWindowMs).length;
    return n > PUBLIC_LIMITS.alarmFailures ? { failures: n, since: new Date(t - PUBLIC_LIMITS.alarmWindowMs).toISOString(), at: new Date(alarms.get(eventId)?.at || t).toISOString() } : null;
  }

  // The one reply every failure gets: the same status and bytes, apart from the code.
  function refer(ev, reason, typed = {}, surnameKey = '') {
    const code = newCode();
    referrals.set(code, { at: now(), eventId: ev?.id || null, reason, typed, surnameKey });
    if (ev && reason !== 'busy') countFailure(ev);
    return { data: { state: 'referred', referral: code, message: 'Please see the registration desk and show this code.' }, headers: NO_STORE };
  }

  // The surnames whose guest page is paused now (the Super Administrator's exceptions inbox).
  function cappedOf(eventId) {
    const out = [];
    for (const k of [...caps.m.keys()]) {
      if (!k.startsWith(`${eventId}|`)) continue;
      const s = k.slice(eventId.length + 1);
      if (isCapped(eventId, s)) out.push({ surnameKey: s, values: capOf(eventId, s).values.size, at: new Date(capOf(eventId, s).at).toISOString() });
    }
    return out;
  }

  return {
    referrals, caps, isCapped, alarmOf, refer, capOf, cappedOf,
    // What the guest typed, as staff may see it: the surname, the digits masked but the last two.
    typedOf(body) {
      const last4 = typeof body?.last4 === 'string' ? body.last4.slice(0, 8) : '';
      const email = typeof body?.email === 'string' ? body.email.slice(0, 254) : '';
      return { surname: cleanText(body?.surname, 80), last4: last4 ? `••${last4.slice(-2)}` : '', email: email ? maskEmail(email) : '' };
    },
    // A wrong value for a surname (each different value once).
    addWrong(eventId, surnameKey, value) {
      const k = capKey(eventId, surnameKey);
      const c = capOf(eventId, surnameKey) || { at: now(), values: new Map() };
      if (!c.values.has(value)) c.values.set(value, now());
      c.at = now();
      caps.set(k, c);
    },
    // Staff clear the cap at the desk (one tap).
    clearCap(eventId, surnameKeys) {
      let n = 0;
      for (const s of surnameKeys) if (caps.delete(capKey(eventId, s))) n++;
      return n;
    },
    stop: () => clearInterval(timer),
  };
}

// The status a guest's page shows, from their record: pending (checked in, no table yet), seated
// (a confirmed seat) or see_desk (anything else: the check-in was undone, a released preferred guest).
function statusOf(ev, g, tables) {
  const t = g.seat ? tables.find((x) => x.id === g.seat.tableId) : null;
  const here = g.arrival?.state === 'checked_in';
  const state = here && isConfirmed(g.seat) ? 'seated' : here && !g.seat && !(g.released && g.classification === 'preferred') ? 'pending' : 'see_desk';
  return {
    seq: ev.seq || 0, pollMs: pollFor(ev.flags, state === 'seated' ? 'seated' : 'pending'), state,
    title: g.name?.title ? `${g.name.title} ${g.name.last}` : '', firstName: g.name?.first || '',
    table: state === 'seated' ? t?.number ?? null : null, seat: state === 'seated' ? g.seat.seatNo ?? null : null,
    checkedInAt: here ? g.arrival.at : null,
    // The "we have emailed this to you" line, only while email is on (if email is cut, the page says
    // "Screenshot this screen" instead, and staff screens hide their email parts).
    emailed: state === 'seated' && !ev.flags?.emailPaused && Boolean(g.email) && ['queued', 'sending', 'sent'].includes(g.notify?.state),
  };
}

// Whether the event takes guest page check-ins right now, or why not.
function closedWhy(ev, nowIso) {
  if (ev.status !== 'live') return 'not_live';
  const w = ev.window || {};
  if ((w.opensAt && nowIso < w.opensAt) || (w.closesAt && nowIso > w.closesAt)) return 'window';
  if (!ev.flags?.registrationOpen) return 'registration_closed';
  if (ev.flags?.readOnly) return 'read_only';
  return null;
}

// Every reply waits until the same moment after the request came in (plus a little noise), so a
// failure cannot be told from a success by its timing. padMs: CUSTOMAPP_VERIFY_PAD_MS, default 350.
const padMsDefault = () => {
  const v = Number(process.env.CUSTOMAPP_VERIFY_PAD_MS);
  return Number.isFinite(v) && v >= 0 ? v : 350;
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// opts: { ctx (commit context), gate, limits, clock () → ms, padMs }
export function registerPublicRoutes(route, db, { ctx, gate, limits = { hit() {} }, clock = () => Date.now(), padMs = padMsDefault() }) {
  const byCode = (code) => eventsOf(db).find((e) => e.code === String(code || '').toLowerCase().slice(0, 60)) || null;
  const liveOr404 = (code) => {
    const ev = byCode(code);
    if (!ev || ev.status !== 'live') throw Object.assign(new HttpError(404, 'Not found.'), { headers: NO_STORE });
    return ev;
  };

  route('GET', '/api/public/event/:code', 'public', ({ params }) => {
    const ev = liveOr404(params.code);
    const open = !closedWhy(ev, new Date(clock()).toISOString());
    return { data: { name: ev.name, date: ev.date, state: open ? 'open' : 'closed', opensAt: ev.window?.opensAt || null }, headers: NO_STORE };
  });

  // The check itself, synchronous from the first look to commit(): nothing is awaited before the
  // write (the same rule as every event write).
  function verifyNow({ params, body, client, headers }) {
    const ev = byCode(params.code);
    if (!ev) return gate.refer(null, 'not_live', gate.typedOf(body));
    const typed = gate.typedOf(body);
    // 1. The limiter: the event's own bucket (a ballroom shares one address, so not per address).
    try {
      limits.hit('event-verify', ev.id);
    } catch {
      return gate.refer(ev, 'busy', typed);
    }
    // 2. The window, the switches and the presence key.
    const nowIso = new Date(clock()).toISOString();
    const why = closedWhy(ev, nowIso);
    if (why) return gate.refer(ev, why, typed);
    if (ev.qrKeyHash) {
      const k = typeof body?.k === 'string' ? body.k.slice(0, 100) : '';
      if (!k || !sameHash(qrKeyHashOf(k), ev.qrKeyHash)) return gate.refer(ev, 'presence_key', typed);
    }
    // 3. What was sent.
    if (!body || body.__malformed || typeof body !== 'object') return gate.refer(ev, 'malformed', typed);
    if (body.website) return gate.refer(ev, 'bot', typed);
    if (UA_DENY.test(String(client?.ua || headers?.['user-agent'] || ''))) return gate.refer(ev, 'bot', typed);
    if (!(Number(body.elapsedMs) >= PUBLIC_LIMITS.minFillMs)) return gate.refer(ev, 'too_fast', typed);
    const rawSurname = typeof body.surname === 'string' ? body.surname : '';
    const surnameKey = canonSurname(rawSurname);
    if (!surnameKey || cleanText(rawSurname, 200).length > PUBLIC_LIMITS.surnameMax || surnameKey.length > PUBLIC_LIMITS.surnameMax) return gate.refer(ev, 'malformed', typed);
    let value;
    let match;
    if (body.last4 !== undefined && body.last4 !== '') {
      if (typeof body.last4 !== 'string' || !/^\d{4}$/.test(body.last4)) return gate.refer(ev, 'malformed', typed, surnameKey);
      value = `m:${body.last4}`;
      match = (g) => g.lookup?.m4 === body.last4;
    } else {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email || email.length > PUBLIC_LIMITS.emailMax || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return gate.refer(ev, 'malformed', typed, surnameKey);
      value = `e:${email}`;
      match = (g) => Boolean(g.email) && g.email.toLowerCase() === email;
    }
    // 4. The soft cap for this surname.
    if (gate.isCapped(ev.id, surnameKey)) return gate.refer(ev, 'capped', typed, surnameKey);
    // 5. The match: exactly one guest.
    const named = guestsOf(db, ev.id).filter((g) => g.active !== false && (g.lookup?.surnames || []).includes(surnameKey));
    const hits = named.filter(match);
    if (hits.length !== 1) {
      gate.addWrong(ev.id, surnameKey, value);
      return gate.refer(ev, hits.length > 1 ? 'ambiguous' : named.length ? 'no_match' : 'not_listed', typed, surnameKey);
    }
    const g = hits[0];
    if (g.deskOnly) return gate.refer(ev, 'desk_only', typed, surnameKey);
    if (g.classification === 'unlisted' && g.approval?.state !== 'approved') return gate.refer(ev, 'unlisted', typed, surnameKey);
    if (g.substitutedBy) return gate.refer(ev, 'substituted', typed, surnameKey);
    const token = randomBytes(32).toString('base64url');
    try {
      commit(ctx, ev.id, { synthetic: 'self' }, { type: 'selfCheckIn', guestId: g.id, tokenHash: tokenHashOf(token) });
    } catch (err) {
      // The window closed between the look and the write, or the save failed: the same reply.
      return gate.refer(ev, err.code === 'registration_closed' ? 'window' : err.code === 'read_only' ? 'read_only' : 'not_saved', typed, surnameKey);
    }
    const now = eventsOf(db).find((e) => e.id === ev.id);
    const fresh = guestsOf(db, ev.id).find((x) => x.id === g.id);
    return { data: { ...statusOf(now, fresh, tablesOf(db, ev.id)), token }, headers: NO_STORE };
  }

  route('POST', '/api/public/event/:code/verify', 'public', async (req) => {
    const started = clock();
    let out;
    try {
      out = verifyNow(req);
    } catch (err) {
      console.error(`${APP_NAME} guest page:`, err.message);
      out = gate.refer(byCode(req.params.code), 'not_saved', gate.typedOf(req.body));
    }
    const wait = padMs ? padMs + Math.floor(Math.random() * padMs * 0.15) - (clock() - started) : 0;
    if (wait > 0) await pause(wait);
    return out;
  });

  // The guest's own status, by the token in the header (never the address or the query).
  route('GET', '/api/public/event/:code/status', 'public', ({ params, query, headers }) => {
    const ev = liveOr404(params.code);
    const token = String(headers?.['x-event-token'] || '');
    const seeDesk = { seq: 0, pollMs: pollFor(ev.flags, 'seated'), state: 'see_desk', title: '', firstName: '', table: null, seat: null };
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { data: seeDesk, headers: NO_STORE };
    const hash = tokenHashOf(token);
    // A phone asking far too often (a stuck page) is answered without any work, never refused.
    try {
      limits.hit('event-token', hash.slice(0, 32));
    } catch {
      return { data: { seq: ev.seq || 0, pollMs: pollFor(ev.flags, 'seated'), unchanged: true }, headers: NO_STORE };
    }
    const g = guestsOf(db, ev.id).find((x) => (x.statusTokens || []).some((t) => t.hash === hash));
    if (!g) return { data: seeDesk, headers: NO_STORE };
    const st = statusOf(ev, g, tablesOf(db, ev.id));
    if (query.since !== undefined && Number(query.since) === st.seq) return { data: { seq: st.seq, pollMs: st.pollMs, unchanged: true }, headers: NO_STORE };
    return { data: st, headers: NO_STORE };
  });
}

// For staff: the referral behind a code, and the guests it could be (by the surname typed).
export function referralFor(gate, db, ev, code) {
  const r = gate.referrals.get(String(code || '').toUpperCase().trim());
  if (!r || r.eventId !== ev.id) return null;
  const guests = r.surnameKey ? guestsOf(db, ev.id).filter((g) => g.active !== false && (g.lookup?.surnames || []).includes(r.surnameKey)) : [];
  return { code: String(code).toUpperCase().trim(), at: new Date(r.at).toISOString(), reason: r.reason, reasonText: REASONS[r.reason] || r.reason, typed: r.typed, capped: Boolean(r.surnameKey) && gate.isCapped(ev.id, r.surnameKey), guests, surnameKey: r.surnameKey };
}
export const guestCapKeys = (g) => g.lookup?.surnames || [];
