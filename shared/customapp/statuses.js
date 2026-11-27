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
// How often each screen asks for changes (design A9), from the one pollMs switch (the staff
// interval): staff boards at pollMs (2 s), a guest page waiting for a table at twice that (4 s), a
// seated guest's page at five times (10 s). Raising the switch to 4000 gives staff 4 s and waiting
// guests 8 s on their next reply, with no deploy. Each reply adds up to 10% jitter, so a ballroom of
// phones does not ask in step.
export const POLL_FACTOR = Object.freeze({ staff: 1, pending: 2, seated: 5 });
export const POLL_JITTER = 0.1;
export function pollFor(flags, kind = 'staff', rand = Math.random) {
  const base = Math.min(POLL_MS.max * POLL_FACTOR.seated, Math.max(POLL_MS.min, Number(flags?.pollMs) || POLL_MS.staff) * (POLL_FACTOR[kind] || 1));
  return Math.round(base * (1 + POLL_JITTER * rand()));
}
// The flags on a guest record for the Super Administrator to look at.
export const GUEST_FLAGS = Object.freeze({ reverified_other_device: 'Verified again from another device', referred_group: 'Sent to the Super Administrator to seat with their group' });

// Email to a guest (Tier 2, US-023): a guest's notify.state, tracked apart from their check-in and
// seat (a failed email never changes either). none: nothing sent yet; not_applicable: no address.
export const NOTIFY = Object.freeze(['none', 'not_applicable', 'queued', 'sending', 'sent', 'failed']);
export const NOTIFY_LABELS = Object.freeze({ none: 'No email yet', not_applicable: 'No email address', queued: 'Email waiting to go', sending: 'Email sending', sent: 'Email sent', failed: 'Email failed' });
export const OUTBOX_KINDS = Object.freeze(['assignment', 'update', 'resend']);
export const OUTBOX_STATES = Object.freeze(['queued', 'sending', 'sent', 'failed']);

// Every kind of change recorded in caChanges (the history, the sync cursor and the idempotency
// store). A closed set, so a later push transport can reuse the records as they are.
export const CHANGE_TYPES = Object.freeze([
  'event.create', 'event.update', 'room.set', 'setSuperAdmin', 'setFlag', 'importAck', 'import',
  'table.add', 'table.update', 'table.relocate', 'guest.update',
  'checkIn', 'undoCheckIn', 'selfCheckIn', 'assign', 'transfer', 'swap', 'unseat', 'reserve', 'release',
  // Tier 1 (0.72): delegation, the guest page's status tokens and the QR presence key.
  'delegateGuests', 'delegateTables', 'revokeTokens', 'setQrKey',
  // Tier 2 (0.73): walk-ins and substitutes for the Super Administrator to decide, a group sent to
  // the Super Administrator, and a manual email resend (paper reconciliation reuses the commands
  // above, with via: 'reconcile').
  'createUnlisted', 'approve', 'reject', 'substitute', 'refer', 'notify',
]);

// The hard limit per table (spec s.1): a table's capacity is 1 to this, whatever an event says.
export const HARD_LIMIT = 10;
