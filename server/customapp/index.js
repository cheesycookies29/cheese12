// CUSTOM APP (MOD-10, 0.71): CORE's module for client-specific apps, kept behind one registry so a
// second app is a new entry, not a new module. Its first app is a generic event-registration engine
// ("events"): events, guests, tables, check-in and seating, with the a client's year-end party the first event
// loaded into it as data. Everything is keyed by event; no client's names are in this code.
//
// Tier 0 (released dark, 1 Dec 2026): staff-only seating. The guest QR page, delegated queues,
// recommendations, live sync, the room plan, groups, email and the dashboard are later tiers; the
// data is shaped for them (design.md, council session custom-app-yep-2026-registration-20261127-0748).
import { createCommitContext } from './events/commit.js';
import { registerEventRoutes } from './events/routes.js';
import { eventsOf } from './events/model.js';

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

// opts: { audit, requirePassword(user, password), limits, clock () → ms }
export function registerCustomApp(route, db, { audit = null, requirePassword, limits, clock = () => Date.now() } = {}) {
  const ctx = createCommitContext(db, { audit, now: () => new Date(clock()).toISOString() });
  route('GET', '/api/customapp/apps', 'customapp.use', () => ({ apps: APPS }));
  registerEventRoutes(route, db, { ctx, audit, requirePassword, limits });
  const openEvents = () => eventsOf(db).filter((ev) => windowOpen(ev, clock()));
  return {
    ctx,
    // For the rate limits (server/api.js): true while any event's window is open.
    eventWindowOpen: () => openEvents().length > 0,
    openEvents,
    liveEvents: () => eventsOf(db).filter((ev) => ev.status === 'live' && !ev.demo),
  };
}
