// CUSTOM APP → events: who may sit where, and how full each table is. Pure functions, shared by the
// server (authoritative: commit() uses them as constraints) and the browser (display only).
//
// This is the ONLY file that counts or compares seats by their status (a source test checks it).
// A table's count is claimsAt(): every guest whose seat is at that table, whatever the status, so a
// reserved seat for a guest who has not arrived blocks the chair exactly as a confirmed one does
// (spec s.8: "count all confirmed assignments and active reservations toward the 10-person limit").
import { SEAT_STATUSES } from './statuses.js';

// How each seat status is counted. Every status must be here: a status that is not a claim would be
// a chair nobody counts. test/customapp-invariants.test.js fails if SEAT_STATUSES and this differ.
export const SEAT_STATUS_CLASS = Object.freeze({ reserved: 'claim', confirmed: 'claim' });

export const isReserved = (seat) => Boolean(seat) && seat.status === 'reserved';
export const isConfirmed = (seat) => Boolean(seat) && seat.status === 'confirmed';
export const knownSeatStatus = (seat) => !seat || SEAT_STATUSES.includes(seat.status);
// The status a seat takes when it is given: confirmed once the guest is here, reserved before.
export const seatStatusFor = (guest) => (guest?.arrival?.state === 'checked_in' ? 'confirmed' : 'reserved');

// Claims at a table: every guest whose seat is there, whatever its status.
export function claimsAt(tableId, guests) {
  let n = 0;
  for (const g of guests) if (g.seat && g.seat.tableId === tableId) n++;
  return n;
}

// tableId → claims, for drawing many tables at once (the same rule as claimsAt).
export function claimsByTable(guests) {
  const m = new Map();
  for (const g of guests) if (g.seat?.tableId) m.set(g.seat.tableId, (m.get(g.seat.tableId) || 0) + 1);
  return m;
}

// What a table's meter shows: "6 seated · 2 reserved · 2 free".
export function tableCounts(table, guests) {
  let confirmed = 0;
  let reserved = 0;
  let other = 0;
  for (const g of guests) {
    if (!g.seat || g.seat.tableId !== table.id) continue;
    if (isConfirmed(g.seat)) confirmed++;
    else if (isReserved(g.seat)) reserved++;
    else other++; // never expected: still a claim, so it still takes a chair
  }
  const claims = confirmed + reserved + other;
  return { claims, confirmed, reserved, free: Math.max(0, (table.capacity || 0) - claims) };
}

// The chairs taken at a table, by number.
export function takenSeats(tableId, guests) {
  const out = new Set();
  for (const g of guests) if (g.seat && g.seat.tableId === tableId && g.seat.seatNo) out.add(g.seat.seatNo);
  return out;
}
export function firstFreeSeat(table, guests) {
  const taken = takenSeats(table.id, guests);
  for (let n = 1; n <= table.capacity; n++) if (!taken.has(n)) return n;
  return null;
}

// Which table types a guest may sit at. Mixed tables seat anyone, but only once the Super
// Administrator has turned mixed tables on (spec s.8). An unlisted guest sits by the class the
// Super Administrator approved them as (Tier 2); until then, nowhere.
export function classOK(tableClass, guest, mixedTables = false) {
  const cls = guest.classification === 'unlisted' ? guest.approval?.classification : guest.classification;
  if (!cls || cls === 'unlisted') return false;
  if (tableClass === 'mixed') return Boolean(mixedTables);
  return tableClass === cls;
}

// Whether a table can take `size` more of these guests now: in use, the right type, and room left.
// `exclude`: guest ids whose own claims do not count (a guest moving within the same table).
export function eligible(table, guest, event, guests, { size = 1, exclude = null } = {}) {
  if (!table || !table.active) return false;
  if (!classOK(table.classification, guest, event?.settings?.mixedTables)) return false;
  const others = exclude ? guests.filter((g) => !exclude.has(g.id)) : guests;
  return table.capacity - claimsAt(table.id, others) >= size;
}

// Tables a guest could be seated at, by number, with their counts: the "options" a refusal carries
// (Tier 0 lists them in table order; Tier 1 ranks them by industry).
export function optionsFor(guest, event, tables, guests) {
  return tables
    .filter((t) => t.active && classOK(t.classification, guest, event?.settings?.mixedTables))
    .map((t) => ({ tableId: t.id, number: t.number, ...tableCounts(t, guests), ownerUserId: t.ownerUserId || null }))
    .filter((o) => o.free > 0)
    .sort((a, b) => a.number - b.number);
}

// Whether a seat number must be chosen for this guest (spec s.22: always for preferred guests).
export function seatNoRequired(event, guest) {
  if (guest.classification === 'preferred') return true;
  return (event?.settings?.seatNumbers || 'preferred') === 'all';
}
