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

// A table tag "no:<tag>" keeps guests tagged <tag> away from it (for example "no:press").
export function excluded(tableTags, guestTags) {
  const tags = new Set(guestTags || []);
  return (tableTags || []).some((t) => typeof t === 'string' && t.startsWith('no:') && tags.has(t.slice(3)));
}

// Why a table cannot take these guests now, or null when it can: 'inactive', 'class', 'excluded'
// or 'full'. The one rule, used by commit() as a constraint (engine.js) and by recommend() below.
// `group`: the guests to seat together (one or more); `others`: the guests whose claims count.
export function whyNot(table, group, event, others) {
  const list = Array.isArray(group) ? group : [group];
  if (!table || !table.active) return 'inactive';
  if (!list.every((g) => classOK(table.classification, g, event?.settings?.mixedTables))) return 'class';
  if (list.some((g) => excluded(table.tags, g.tags))) return 'excluded';
  if (table.capacity - claimsAt(table.id, others) < list.length) return 'full';
  return null;
}

// Whether a table can take `size` more of these guests now: in use, the right type, not excluded by
// a tag, and room left. `exclude`: guest ids whose own claims do not count (a guest moving within
// the same table).
export function eligible(table, guest, event, guests, { size = 1, exclude = null } = {}) {
  const others = exclude ? guests.filter((g) => !exclude.has(g.id)) : guests;
  const group = Array.isArray(guest) ? guest : Array.from({ length: size }, () => guest);
  return whyNot(table, group, event, others) === null;
}

// The ranking (design A10, US-018): every eligible table for these guests, best first.
//   tier 1: a guest of the same industry already sits there; tier 2: a related industry; tier 3: any
//   other eligible table. Within a tier: fits the whole group, then more same-industry (or related)
//   companions, then fewer seats left after placing them (fills gaps without filling tables in
//   order), then the table number (so the order is always the same).
// Each result says why, in words: "Same industry: Banking, 3 of 6 seated", "Related: Insurance",
// "4 seats left". Advisory only: commit() accepts any eligible table in scope.
export function recommend(group, event, tables, guests) {
  const list = (Array.isArray(group) ? group : [group]).filter(Boolean);
  if (!list.length) return [];
  const ids = new Set(list.map((g) => g.id));
  const others = guests.filter((g) => !ids.has(g.id));
  const industries = new Map((event?.industries || []).map((i) => [i.id, i]));
  const mine = new Set(list.map((g) => g.industryId).filter(Boolean));
  const related = new Set();
  for (const id of mine) for (const r of industries.get(id)?.related || []) if (!mine.has(r)) related.add(r);
  const out = [];
  for (const t of tables) {
    if (whyNot(t, list, event, others) !== null) continue;
    const at = others.filter((g) => g.seat?.tableId === t.id);
    const same = at.filter((g) => g.industryId && mine.has(g.industryId)).length;
    const rel = at.filter((g) => g.industryId && related.has(g.industryId)).length;
    const counts = tableCounts(t, others);
    const left = counts.free - list.length;
    const tier = same ? 1 : rel ? 2 : 3;
    const name = (id) => industries.get(id)?.name || '';
    const reasons = [];
    if (same) reasons.push(`Same industry: ${[...mine].map(name).filter(Boolean).join(', ')}, ${same} of ${counts.claims} seated`);
    if (rel) reasons.push(`Related: ${[...new Set(at.filter((g) => related.has(g.industryId)).map((g) => name(g.industryId)))].filter(Boolean).join(', ')}`);
    if (!same && !rel) reasons.push(at.length ? 'No industry match' : 'Empty table');
    reasons.push(`${left} seat${left === 1 ? '' : 's'} left`);
    out.push({ tableId: t.id, number: t.number, classification: t.classification, ownerUserId: t.ownerUserId || null, tier, same, related: rel, fits: true, left, ...counts, reasons });
  }
  return out.sort((a, b) => a.tier - b.tier || Number(b.fits) - Number(a.fits) || (b.same + b.related) - (a.same + a.related) || a.left - b.left || a.number - b.number);
}

// Tables a guest could be seated at, best first, with their counts: the "options" a refusal carries.
export function optionsFor(guest, event, tables, guests) {
  return recommend([guest], event, tables, guests).map(({ tableId, number, claims, confirmed, reserved, free, ownerUserId, tier, reasons }) => ({ tableId, number, claims, confirmed, reserved, free, ownerUserId, tier, reasons }));
}

// Whether a seat number must be chosen for this guest (spec s.22: always for preferred guests).
export function seatNoRequired(event, guest) {
  if (guest.classification === 'preferred') return true;
  return (event?.settings?.seatNumbers || 'preferred') === 'all';
}
