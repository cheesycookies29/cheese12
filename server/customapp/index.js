// CUSTOM APP (MOD-10, 0.71): CORE's module for client-specific apps, kept behind one registry so a
// second app is a new entry, not a new module. Its first app is a generic event-registration engine
// ("events"): events, guests, tables, check-in and seating, with a client's party the first event
// loaded into it as data. Everything is keyed by event; no client's names are in this code.
//
// Tier 0 (released dark, 1 Dec 2026): staff-only seating. Tier 1 (0.72, 3 Dec): the guest page
// (/event/<code>: verify, status token, presence key), delegated queues (My queue), recommendations,
// live sync by short poll, the room plan, and the safety nets (5-minute copies, 60 s rules check).
// Tier 2 (0.73, 5 Dec): group arrivals, walk-ins and substitutes for the Super Administrator to
// decide, the email outbox (outbox.js), the Event control dashboard with the exceptions inbox, and
// the printed offline pack with paper reconciliation through commit() (the council design, A11, U4,
// U7). 0.74: personal invitations by email (a link, a button and a QR code), the guest's Yes or No on
// that link with the seat reserved at once on Yes, and the door check-in by the same link (invite.js).
// 0.75: Scan QR, staff scanning a guest's invitation QR inside CORE to open their sheet (scan.js).
import { createCommitContext } from './events/commit.js';
import { registerEventRoutes } from './events/routes.js';
import { registerPublicRoutes, createPublicGate } from './events/public.js';
import { createSafety } from './events/safety.js';
import { eventsOf } from './events/model.js';
import { createOutbox, memoryVault } from './events/outbox.js';
import { registerInviteRoutes } from './events/invite.js';
import { registerScanRoutes } from './events/scan.js';

export const APPS = Object.freeze([
  Object.freeze({ id: 'events', name: 'Events', glyph: 'party', status: 'live', description: 'Guest lists, check-in at the desk and seating by table and chair, for one event at a time.' }),
]);

// How long before an event's doors the venue allowances start (staff sign in from one network
// address; switching the module off needs the Super Administrator).
export const WINDOW_LEAD_MS = 6 * 3600000;

// Whether an event is live and inside its window (from WINDOW_LEAD_MS before it opens until it
// closes; a day after opening when no closing time is set).
export function windowOpen(ev, nowMs = Date.now()) {
  if (ev.status !== 'live' || !ev.window?.opensAt) return false;
  const opens = Date.parse(ev.window.opensAt);
  const closes = ev.window.closesAt ? Date.parse(ev.window.closesAt) : opens + 24 * 3600000;
  return nowMs >= opens - WINDOW_LEAD_MS && nowMs <= closes;
}

// opts: { audit, requirePassword(user, password), limits, monitor, clock () → ms, safetyTimers,
// transport (CORE's outgoing mail, server/mail/transport.js), outbox: { send, backoffMs, saveEveryMs, timers },
// secrets (server/secrets.js: seals the invitation links while their email waits) }
export function registerCustomApp(route, db, { audit = null, requirePassword, limits, monitor = null, clock = () => Date.now(), safetyTimers = true, transport = null, outbox: outboxOpts = {}, secrets = null } = {}) {
  const vault = secrets ? { seal: (s) => secrets.seal(s), open: (s) => secrets.open(s) } : memoryVault();
  const outbox = createOutbox(db, { transport, now: clock, vault, ...outboxOpts });
  const ctx = createCommitContext(db, { audit, now: () => new Date(clock()).toISOString(), afterCommit: outbox.afterCommit });
  if (outboxOpts.timers !== false) outbox.start();
  // 429s on an event's routes in the last 15 minutes, per event (the health strip).
  const tooMany = new Map(); // eventId or code → [ms]
  const note429 = (pathname) => {
    const m = String(pathname || '').match(/^\/api\/(?:customapp\/events|public\/event)\/([^/]+)/);
    if (!m) return;
    const ev = eventsOf(db).find((e) => e.id === m[1] || e.code === m[1]);
    if (!ev) return;
    const t = clock();
    const list = (tooMany.get(ev.id) || []).filter((x) => t - x < 15 * 60000);
    list.push(t);
    tooMany.set(ev.id, list.slice(-5000));
  };
  const count429 = (eventId) => (tooMany.get(eventId) || []).filter((x) => clock() - x < 15 * 60000).length;
  const gate = createPublicGate({ now: clock, limits, audit });
  const safety = createSafety(db, { now: clock, audit });
  if (safetyTimers) safety.start();
  monitor?.check('customapp-events', () => safety.monitorCheck());
  route('GET', '/api/customapp/apps', 'customapp.use', () => ({ apps: APPS }));
  registerEventRoutes(route, db, { ctx, audit, requirePassword, limits, gate, safety, clock, outbox, count429 });
  registerPublicRoutes(route, db, { ctx, gate, limits, clock });
  registerInviteRoutes(route, db, { ctx, gate, limits, clock, vault: outbox.vault, outbox, audit, ...(outboxOpts.send ? { send: outboxOpts.send } : {}) });
  registerScanRoutes(route, db, { limits });
  const openEvents = () => eventsOf(db).filter((ev) => windowOpen(ev, clock()));
  return {
    ctx, gate, safety, outbox, note429, count429,
    // For the rate limits (server/api.js): true while any event's window is open.
    eventWindowOpen: () => openEvents().length > 0,
    openEvents,
    liveEvents: () => eventsOf(db).filter((ev) => ev.status === 'live' && !ev.demo),
  };
}
