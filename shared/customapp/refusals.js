// CUSTOM APP → events: the one catalogue of refusals (design A6), shared by the server, which sends
// { error, code, fresh }, and the browser, which shows a recovery screen for the code. Frozen:
// tests assert these codes (never the wording), and test/customapp-api.test.js fails when a code
// here is not produced by at least one test.
//   409: the state changed or does not allow it (the reply's `fresh` holds the state as it is now)
//   403: the account has no authority over that guest, table or setting
//   503: the change was not saved (the server could not write its data file; nothing changed)
const R = (status, message) => Object.freeze({ status, message });

export const REFUSALS = Object.freeze({
  stale: R(409, 'This changed on another device since you opened it. Here it is as it is now.'),
  table_full: R(409, 'That table just filled up. Choose another table.'),
  seat_taken: R(409, 'That seat was just taken. Choose another seat.'),
  not_eligible: R(409, 'That table is not for this guest (its type, or it is not in use).'),
  no_eligible_seat: R(409, 'No eligible seat is left for this guest. Refer them to the Super Administrator.'),
  already_checked_in: R(409, 'This guest is already checked in.'),
  guest_moved: R(409, 'This guest was seated or moved on another device. Here is where they are now.'),
  table_has_claims: R(409, 'This table has guests. Move them to another table first.'),
  op_replay_mismatch: R(409, 'This request was already used for a different change. Reload and try again.'),
  read_only: R(409, 'The event is read only for now. The Super Administrator turns this off.'),
  registration_closed: R(409, 'Self check-in is closed. Please see the registration desk.'),
  rsvp_closed: R(409, 'Replies to the invitation are closed. Please contact the organisers.'),
  out_of_scope: R(403, 'This guest or table is not yours. Ask its owner or the Super Administrator.'),
  needs_super_admin: R(403, 'Only the event\'s Super Administrator can do this.'),
  not_saved: R(503, 'Not saved. Nothing changed; try again.'),
});

export const REFUSAL_CODES = Object.freeze(Object.keys(REFUSALS));
export const refusalStatus = (code) => REFUSALS[code]?.status || 409;
export const refusalMessage = (code) => REFUSALS[code]?.message || 'This was refused.';
