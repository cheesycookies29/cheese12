// CUSTOM APP → events: the closed sets of states an event, a guest, a seat and a table can be in.
// Shared by the server (the engine and its invariants) and the browser (labels). Every set is
// frozen: adding a value is a design change, and test/customapp-invariants.test.js fails until the
// new value is classified (a seat status that nothing counts would let a table be overbooked).

// A seat claim lives on the guest (guest.seat). There is no third status: a released seat is
// seat = null plus a history entry, and there are no holds that expire (spec s.10, invariant I9).
export const SEAT_STATUSES = Object.freeze(['reserved', 'confirmed']);
export const SEAT_LABELS = Object.freeze({ reserved: 'Reserved', confirmed: 'Seated' });

export const EVENT_STATUSES = Object.freeze(['draft', 'live', 'closed', 'archived']);
export const ARRIVAL = Object.freeze(['expected', 'checked_in', 'cancelled']);
export const ARRIVAL_VIA = Object.freeze(['desk', 'qr', 'reconcile']);
export const APPROVAL = Object.freeze(['none', 'pending', 'approved', 'rejected']);
export const GUEST_CLASSES = Object.freeze(['preferred', 'regular', 'employee', 'unlisted']);
export const TABLE_CLASSES = Object.freeze(['preferred', 'regular', 'employee', 'mixed']);
export const CLASS_LABELS = Object.freeze({ preferred: 'Preferred', regular: 'Regular', employee: 'Employee', unlisted: 'Unlisted', mixed: 'Mixed' });
export const SEAT_NUMBERS = Object.freeze(['all', 'preferred', 'none']);
export const STAGE_SIDES = Object.freeze(['left', 'right', 'top', 'bottom']);

// The runtime switches (design O3): changed by the event's Super Administrator, with no deploy.
export const FLAGS = Object.freeze(['registrationOpen', 'emailPaused', 'readOnly', 'pollMs']);
export const FLAG_LABELS = Object.freeze({
  registrationOpen: 'Self check-in open',
  emailPaused: 'Email paused',
  readOnly: 'Read only',
  pollMs: 'Refresh interval (ms)',
});
export const POLL_MS = Object.freeze({ min: 1000, max: 30000, staff: 2000 });

// Every kind of change recorded in caChanges (the history, the sync cursor and the idempotency
// store). A closed set, so a later push transport can reuse the records as they are.
export const CHANGE_TYPES = Object.freeze([
  'event.create', 'event.update', 'room.set', 'setSuperAdmin', 'setFlag', 'importAck', 'import',
  'table.add', 'table.update', 'table.relocate', 'guest.update',
  'checkIn', 'undoCheckIn', 'selfCheckIn', 'assign', 'transfer', 'swap', 'unseat', 'reserve', 'release',
]);

// The hard limit per table (spec s.1): a table's capacity is 1 to this, whatever an event says.
export const HARD_LIMIT = 10;
