// CUSTOM APP → events: the rules that must hold for an event at every moment (design A3), checked
// by one function everywhere: by commit() on the state a change would produce (before it is
// applied), after every step of the fuzz test, by GET …/invariants, and later by the self-check.
// Returns [] when all hold, or [{ rule, ids, detail }] for each break.
//
//   I1  claimsAt(t) <= t.capacity <= hardLimit, whatever the seat status
//   I2  a guest holds at most one seat (one seat field, an object or nothing)
//   I3  (tableId, seatNo) is unique among claims
//   I4  each guest and table has at most one owner, and that owner is active event staff
//   I5  exactly one Super Administrator
//   I6  a substitute and the invitee they replace never both hold a seat
//   I7  a guest is checked in only once (a known arrival state; one record per invitee)
//   I8  a table with claims is never inactive, nor smaller than its claims
//   I9  a reserved seat never expires (only known statuses, no hold or expiry fields)
//   I10 the actor wrote only guests and tables they own (the Super Administrator writes any)
import { SEAT_STATUSES, ARRIVAL, HARD_LIMIT } from './statuses.js';
import { claimsByTable, knownSeatStatus } from './seating.js';

const plainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// state: { event, tables, guests }; opts.write: { actor: { id, role }, guests: [{ id, ownerUserId }],
// tables: [{ id, ownerUserId }] }, the records a change writes as they were before it (for I10).
export function checkInvariants(state, { write = null } = {}) {
  const out = [];
  const bad = (rule, ids, detail) => out.push({ rule, ids: ids.filter(Boolean), detail });
  const ev = state.event || {};
  const tables = state.tables || [];
  const guests = state.guests || [];
  const hardLimit = Math.min(Number(ev.settings?.hardLimit) || HARD_LIMIT, HARD_LIMIT);
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const counts = claimsByTable(guests.filter((g) => plainObject(g.seat)));
  const staff = new Set((ev.staff || []).filter((s) => s.active !== false).map((s) => s.userId));
  if (ev.superAdminUserId) staff.add(ev.superAdminUserId);

  // I5: exactly one Super Administrator, by construction one field holding one account.
  if (typeof ev.superAdminUserId !== 'string' || !ev.superAdminUserId) bad('I5', [ev.id], 'The event has no Super Administrator.');

  for (const t of tables) {
    const n = counts.get(t.id) || 0;
    if (!(t.capacity >= 1 && t.capacity <= hardLimit)) bad('I1', [t.id], `Table ${t.number} has capacity ${t.capacity}; the limit is 1 to ${hardLimit}.`);
    if (n > t.capacity) bad('I1', [t.id], `Table ${t.number} has ${n} claims for ${t.capacity} chairs.`);
    if (n > 0 && t.active === false) bad('I8', [t.id], `Table ${t.number} is not in use but holds ${n} claims.`);
    if (t.ownerUserId != null && (typeof t.ownerUserId !== 'string' || !staff.has(t.ownerUserId))) bad('I4', [t.id, String(t.ownerUserId)], `Table ${t.number}'s owner is not active event staff.`);
  }

  const seatAt = new Map(); // `${tableId}:${seatNo}` → guest id
  const byKey = new Map();
  const byId = new Map(guests.map((g) => [g.id, g]));
  for (const g of guests) {
    // I2: one seat, as one object (or none).
    if (g.seat != null && !plainObject(g.seat)) {
      bad('I2', [g.id], `${g.ref || g.id} holds more than one seat.`);
      continue;
    }
    if (g.seat) {
      if (!tableById.has(g.seat.tableId)) bad('I1', [g.id, g.seat.tableId], `${g.ref || g.id} is seated at a table that does not exist.`);
      // I9: a claim is reserved or confirmed, never a hold that runs out.
      if (!knownSeatStatus(g.seat) || 'expiresAt' in g.seat || 'holdUntil' in g.seat) bad('I9', [g.id], `${g.ref || g.id} has a seat with status ${g.seat.status}; only ${SEAT_STATUSES.join(' and ')} exist and none expires.`);
      if (g.seat.seatNo != null) {
        const k = `${g.seat.tableId}:${g.seat.seatNo}`;
        const t = tableById.get(g.seat.tableId);
        if (seatAt.has(k)) bad('I3', [seatAt.get(k), g.id], `Two guests hold table ${t?.number ?? '?'}, seat ${g.seat.seatNo}.`);
        else seatAt.set(k, g.id);
        if (t && !(Number.isInteger(g.seat.seatNo) && g.seat.seatNo >= 1 && g.seat.seatNo <= t.capacity)) bad('I3', [g.id], `Seat ${g.seat.seatNo} is not a chair of table ${t.number}.`);
      }
    }
    if (g.ownerUserId != null && (typeof g.ownerUserId !== 'string' || !staff.has(g.ownerUserId))) bad('I4', [g.id, String(g.ownerUserId)], `${g.ref || g.id}'s owner is not active event staff.`);
    // I6: an invitee and their substitute never both hold a seat.
    if (g.substituteFor && g.seat && byId.get(g.substituteFor)?.seat) bad('I6', [g.id, g.substituteFor], `${g.ref || g.id} and the invitee they replace both hold a seat.`);
    // I7: a known arrival state, a time for a check-in, and one record per invitee.
    const a = g.arrival || {};
    if (!ARRIVAL.includes(a.state) || (a.state === 'checked_in' && !a.at)) bad('I7', [g.id], `${g.ref || g.id} has an arrival record that is not valid.`);
    if (g.externalKey && g.active !== false) {
      if (byKey.has(g.externalKey)) bad('I7', [byKey.get(g.externalKey), g.id], `Two records for the same invitee (${g.externalKey}).`);
      else byKey.set(g.externalKey, g.id);
    }
  }

  // I10: what this change wrote was the actor's own (re-read from the state before it).
  if (write && write.actor?.role !== 'super') {
    for (const r of [...(write.guests || []), ...(write.tables || [])]) if (r.ownerUserId !== write.actor?.id) bad('I10', [r.id], 'The change touches a guest or table that is not the actor\'s.');
  }
  return out;
}
