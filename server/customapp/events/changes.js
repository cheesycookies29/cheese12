// CUSTOM APP → events: reading the change log (caChanges). Every commit appends one entry with the
// event's next seq; the log is the approval and change history the spec asks for (s.7, s.13), the
// opId store (commit.js) and, from Tier 1, the live-sync cursor (changes?since=<seq>).
import { changesOf } from './model.js';
import { RSVP_ACTOR } from '../../../shared/customapp/statuses.js';

// What happened to one guest, newest first: who, when, what (the diff is already safe to show).
export function historyOf(db, eventId, guestId, { users = [], limit = 30 } = {}) {
  const name = (id) => users.find((u) => u.id === id)?.name || (id === RSVP_ACTOR ? 'The guest\'s invitation link' : id ? 'Former account' : 'Guest page');
  return changesOf(db, eventId)
    .filter((c) => (c.guestIds || []).includes(guestId))
    .slice(-limit)
    .reverse()
    .map((c) => ({ seq: c.seq, at: c.at, occurredAt: c.occurredAt || null, type: c.type, by: name(c.actorId), via: c.via, reason: c.reason || '', diff: (c.diff || []).filter((x) => x.id === guestId) }));
}

// Changes after `since` (the sync cursor of Tier 1): { seq, changes } or { seq, unchanged: true }.
export function changesSince(db, ev, since) {
  const seq = ev.seq || 0;
  const s = Number(since);
  if (Number.isFinite(s) && s === seq) return { seq, unchanged: true };
  return { seq, changes: changesOf(db, ev.id).filter((c) => !Number.isFinite(s) || s > seq || c.seq > s) };
}
