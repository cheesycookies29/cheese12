// CUSTOM APP → events: what each command would change, decided from the state alone. Pure and
// synchronous: no I/O, no clock (the time comes in as `now`), no await (a test reads this file).
// commit.js runs the plan; nothing here writes.
//
// plan(state, cmd, actor, now) → {
//   type, changes: [{ op: 'set', coll, id, patch } | { op: 'add', coll, record } | { op: 'remove', coll, id }],
//   guestIds, tableIds, diff?, reason, write (what a non-Super-Administrator wrote, for I10),
//   audit: { action, entityId, label, note }, result, noop? }
// state: { event, tables, guests, users: [{ id, name, active, canUse }] }
// actor: { id, name, role: 'super' | 'staff' | 'manager' | 'self' | null, canManage }
// Refusals come only from shared/customapp/refusals.js (model.refusal); 400s are input mistakes.
import { randomUUID } from 'node:crypto';
import { refusal, bad, cleanText, lookupOf, guestLabel } from './model.js';
import { seatMessage } from './message.js';
import { TABLE_CLASSES, GUEST_CLASSES, SEAT_NUMBERS, FLAGS, POLL_MS, HARD_LIMIT, EVENT_STATUSES } from '../../../shared/customapp/statuses.js';
import { classOK, takenSeats, tableCounts, optionsFor, seatNoRequired, seatStatusFor, isReserved, isConfirmed, whyNot } from '../../../shared/customapp/seating.js';
import { cleanRoom, roomTables } from '../../../shared/customapp/room.js';
import { toUtc } from '../../../shared/customapp/time.js';
import { importIssues } from './io.js';

// ----- Small helpers -----
const guestOf = (state, id) => state.guests.find((g) => g.id === String(id || '')) || null;
const tableOf = (state, id) => state.tables.find((t) => t.id === String(id || '')) || null;
const isStaff = (actor) => actor.role === 'super' || actor.role === 'staff';

// Event authority (design R1, US-017): what an account may do in this event comes from the event's
// own data, its Super Administrator and its delegations, read again on every command (a change of
// owner applies to the very next request). A CORE administrator's '*' is not part of it.
//   'checkIn'  any active staff member, for any guest (spec s.4: assisted check-in)
//   'write'    seat, move, unseat a guest; use a table: its owner, or the Super Administrator
//   anything else (delegate, release unless the event allows owners, setup, switches): the Super
//   Administrator only
export function eventCan(actor, action, target = null) {
  if (actor?.role === 'super') return true;
  if (actor?.role !== 'staff') return false;
  if (action === 'checkIn' || action === 'view') return true;
  if (action === 'write') return Boolean(target) && target.ownerUserId === actor.id;
  return false;
}
const owns = (actor, rec) => eventCan(actor, 'write', rec);
const seatText = (state, seat) => (seat ? `Table ${tableOf(state, seat.tableId)?.number ?? '?'}${seat.seatNo ? `, seat ${seat.seatNo}` : ''}` : 'no seat');
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// The state as it is now, for a refusal: the guests and tables involved (no contact details) and
// the tables this guest could still take, so the screen redraws without asking again.
export function freshFor(state, guestIds = [], tableIds = []) {
  const guests = guestIds.map((id) => guestOf(state, id)).filter(Boolean);
  const ids = new Set([...tableIds, ...guests.map((g) => g.seat?.tableId).filter(Boolean)]);
  return {
    seq: state.event.seq || 0,
    guests: guests.map((g) => ({ id: g.id, rev: g.rev, arrival: { state: g.arrival?.state }, seat: g.seat ? { ...pick(g.seat, ['tableId', 'seatNo', 'status']), number: tableOf(state, g.seat.tableId)?.number ?? null } : null, ownerUserId: g.ownerUserId || null })),
    tables: [...ids].map((id) => tableOf(state, id)).filter(Boolean).map((t) => ({ id: t.id, number: t.number, rev: t.rev, ...tableCounts(t, state.guests), taken: [...takenSeats(t.id, state.guests)].sort((a, b) => a - b) })),
    options: guests[0] ? optionsFor(guests[0], state.event, state.tables, state.guests) : [],
  };
}
const refuse = (code, state, guestIds = [], tableIds = [], message) => refusal(code, freshFor(state, guestIds, tableIds), message);

function mustGuest(state, id) {
  const g = guestOf(state, id);
  if (!g || g.active === false) throw bad('That guest is not on this event\'s list.');
  return g;
}
function mustTable(state, id) {
  const t = tableOf(state, id);
  if (!t) throw bad('That table is not in this event.');
  return t;
}
const needStaff = (actor, state, gid) => {
  if (!isStaff(actor)) throw refuse('out_of_scope', state, gid ? [gid] : []);
};
const needSuper = (actor, state, gid) => {
  if (actor.role !== 'super') throw refuse('needs_super_admin', state, gid ? [gid] : []);
};
// Seating writes: eventCan on every guest and every table the plan touches (spec s.12); one
// element out of scope refuses the whole plan. Re-read on every command.
function needScope(actor, state, guests, tables) {
  if (!isStaff(actor)) throw refuse('out_of_scope', state, guests.map((g) => g.id), tables.map((t) => t.id));
  for (const r of [...guests, ...tables]) if (!eventCan(actor, 'write', r)) throw refuse('out_of_scope', state, guests.map((g) => g.id), tables.map((t) => t.id));
}
const writeOf = (actor, guests, tables) => ({ actor: { id: actor.id, role: actor.role }, guests: guests.map((g) => ({ id: g.id, ownerUserId: g.ownerUserId || null })), tables: tables.map((t) => ({ id: t.id, ownerUserId: t.ownerUserId || null })) });

// A seat number for this guest at this table: required for preferred guests (and for everyone when
// the event numbers every chair), within the table's chairs, and free. `taken` already excludes the
// guest's own chair when they move within a table.
function seatNoFor(state, guest, table, input, taken) {
  const ev = state.event;
  if (input === undefined || input === null || input === '') {
    if (seatNoRequired(ev, guest)) throw bad('Choose a seat at the table.');
    return null;
  }
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1 || n > table.capacity) throw bad(`Seats at table ${table.number} are 1 to ${table.capacity}.`);
  if (ev.settings?.seatNumbers === 'none' && guest.classification !== 'preferred') return null;
  if (taken.has(n)) throw refuse('seat_taken', state, [guest.id], [table.id]);
  return n;
}

// Whether a guest can sit at a table right now; the refusal says why not. `others`: the guests that
// count (the guest's own claim left out when they move within the table, earlier placements in).
// The same rule as the recommendations (shared/customapp/seating.js whyNot), as a constraint.
function checkFit(state, guest, table, others) {
  const why = whyNot(table, [guest], state.event, others);
  if (!why) return;
  if (why !== 'full') throw refuse('not_eligible', state, [guest.id], [table.id]);
  // Full: another eligible table with room means "choose another"; none anywhere means refer.
  const anyRoom = state.tables.some((t) => t.id !== table.id && !whyNot(t, [guest], state.event, others));
  throw refuse(anyRoom ? 'table_full' : 'no_eligible_seat', state, [guest.id], [table.id]);
}

const seatRecord = (table, seatNo, status, actor, now) => ({ tableId: table.id, seatNo, status, at: now, by: actor.id });
const setGuest = (g, patch) => ({ op: 'set', coll: 'caGuests', id: g.id, patch });
const setTable = (t, patch) => ({ op: 'set', coll: 'caTables', id: t.id, patch });
const setEvent = (ev, patch) => ({ op: 'set', coll: 'caEvents', id: ev.id, patch });

// ----- Commands -----
const COMMANDS = {
  // Any staffer checks a guest in (spec s.4: assisted check-in); seating is separate. A preferred
  // guest's reserved seat becomes confirmed: their table and seat are retrieved (spec s.5).
  checkIn(state, cmd, actor, now) {
    const g = mustGuest(state, cmd.guestId);
    needStaff(actor, state, g.id);
    if (g.arrival?.state === 'checked_in') throw refuse('already_checked_in', state, [g.id]);
    // A walk-in or substitute is admitted only by the Super Administrator's approval (spec s.4); an
    // invitee whose substitute was approved is not coming (their seat changed hands).
    if (g.classification === 'unlisted' && g.approval?.state !== 'approved') throw refuse('needs_super_admin', state, [g.id], [], 'A walk-in or substitute is checked in when the Super Administrator approves them.');
    if (g.substitutedBy) throw refuse('guest_moved', state, [g.id], [], 'A substitute took this invitee\'s place. Refer them to the Super Administrator.');
    const via = cmd.via === 'reconcile' ? 'reconcile' : 'desk';
    const patch = { arrival: { state: 'checked_in', at: cmd.via === 'reconcile' && cmd.occurredAt ? String(cmd.occurredAt) : now, by: actor.id, via } };
    if (isReserved(g.seat)) patch.seat = { ...g.seat, status: 'confirmed' };
    return arrivalPlan(state, g, patch, 'checkIn', actor);
  },

  // The guest page (Tier 1) checks a guest in through the same commit, as a synthetic actor that can
  // do nothing else; refused while self check-in is closed or outside the event's window. It also
  // keeps the device's status token (its SHA-256 only; at most 5 per guest, the oldest dropped).
  // Verifying again (another phone) never checks in twice: the status is the same, the new device's
  // token is kept, and staff see "verified again from another device".
  selfCheckIn(state, cmd, actor, now) {
    const ev = state.event;
    const g = mustGuest(state, cmd.guestId);
    const w = ev.window || {};
    const open = ev.status === 'live' && ev.flags?.registrationOpen && (!w.opensAt || now >= w.opensAt) && (!w.closesAt || now <= w.closesAt);
    if (!open) throw refusal('registration_closed', undefined);
    if (!/^[0-9a-f]{64}$/.test(String(cmd.tokenHash || ''))) throw bad('The guest page sends a status token.');
    const statusTokens = [...(g.statusTokens || []), { hash: cmd.tokenHash, issuedAt: now }].slice(-STATUS_TOKENS_MAX);
    if (g.arrival?.state === 'checked_in') {
      const patch = { statusTokens };
      if ((g.statusTokens || []).length) patch.flags = [...(g.flags || []), { kind: 'reverified_other_device', at: now }].slice(-10);
      return {
        type: 'selfCheckIn', changes: [setGuest(g, patch)], guestIds: [g.id], tableIds: [], diff: [{ id: g.id, f: 'statusTokens', from: (g.statusTokens || []).length, to: statusTokens.length }],
        audit: { action: 'reverify', entityId: g.id, label: guestLabel(g), note: patch.flags ? 'Verified again on another device' : 'Verified on the guest page (already checked in)' },
        result: { guestId: g.id, already: true },
      };
    }
    const patch = { arrival: { state: 'checked_in', at: now, by: null, via: 'qr' }, statusTokens };
    if (isReserved(g.seat)) patch.seat = { ...g.seat, status: 'confirmed' };
    return arrivalPlan(state, g, patch, 'selfCheckIn', actor);
  },

  // A check-in made by mistake: the guest is expected again; a confirmed seat goes back to reserved
  // (the chair stays theirs; releasing it is a separate decision).
  undoCheckIn(state, cmd, actor) {
    const g = mustGuest(state, cmd.guestId);
    needScope(actor, state, [g], []);
    if (g.arrival?.state !== 'checked_in') throw refuse('stale', state, [g.id]);
    const patch = { arrival: { state: 'expected', at: null, by: null, via: null } };
    if (isConfirmed(g.seat)) patch.seat = { ...g.seat, status: 'reserved' };
    const plan = arrivalPlan(state, g, patch, 'undoCheckIn', actor);
    plan.reason = cleanText(cmd.reason, 200);
    plan.write = writeOf(actor, [g], []);
    return plan;
  },

  // Seat checked-in guests: one placement, or a group all or nothing (one commit). Constraints, not
  // the ranking: any eligible table in scope is accepted (spec s.9). A group (US-021, spec s.10):
  //  - members with different owners are seated only by the Super Administrator (needs_super_admin;
  //    a staffer sends the group to them with refer);
  //  - a group placed at more than one table is a split, which needs allowSplit: true (the screen's
  //    explicit "Split group" confirm); without it nothing is seated;
  //  - each member keeps their own check-in and seat; the group is remembered as groupId.
  assign(state, cmd, actor, now) {
    const placements = Array.isArray(cmd.placements) ? cmd.placements : [{ guestId: cmd.guestId, tableId: cmd.tableId, seatNo: cmd.seatNo }];
    if (!placements.length || placements.length > 50) throw bad('Send one to 50 guests to seat.');
    if (new Set(placements.map((p) => p.guestId)).size !== placements.length) throw bad('A guest is in the list twice.');
    const group = placements.length > 1;
    if (group) {
      const members = placements.map((p) => mustGuest(state, p.guestId));
      const owners = new Set(members.map((g) => g.ownerUserId || null));
      if (actor.role !== 'super' && owners.size > 1) throw refuse('needs_super_admin', state, members.map((g) => g.id), [], 'These guests have different owners: the Super Administrator seats the group (Send group to Super Administrator).');
      if (new Set(placements.map((p) => String(p.tableId))).size > 1 && cmd.allowSplit !== true) throw bad('The group would sit at more than one table. Confirm Split group to seat it that way.');
    }
    const groupId = group ? cleanText(cmd.groupId, 60) || randomUUID() : null;
    const changes = [];
    const guests = [];
    const tables = [];
    let others = state.guests;
    for (const p of placements) {
      const g = mustGuest(state, p.guestId);
      const t = mustTable(state, p.tableId);
      if (g.seat) throw refuse('guest_moved', state, [g.id], [t.id]);
      if (g.arrival?.state !== 'checked_in') throw refuse('not_eligible', state, [g.id], [t.id], 'Check the guest in first, then seat them.');
      // A preferred guest whose reservation was released is referred (spec s.10).
      if (g.released && g.classification === 'preferred' && actor.role !== 'super') throw refuse('needs_super_admin', state, [g.id], [t.id], 'This guest\'s reservation was released. The Super Administrator seats them.');
      needScope(actor, state, [g], [t]);
      checkFit(state, g, t, others);
      const seatNo = seatNoFor(state, g, t, p.seatNo, takenSeats(t.id, others));
      const seat = seatRecord(t, seatNo, 'confirmed', actor, now);
      others = others.map((x) => (x.id === g.id ? { ...x, seat } : x));
      const patch = { seat };
      if (groupId) patch.groupId = groupId;
      // Seated: a "send to the Super Administrator" flag has done its job.
      if ((g.flags || []).some((f) => f.kind === 'referred_group')) patch.flags = g.flags.filter((f) => f.kind !== 'referred_group');
      changes.push(setGuest(g, patch));
      guests.push(g);
      if (!tables.includes(t)) tables.push(t);
    }
    const one = guests.length === 1;
    return {
      type: 'assign', changes, guestIds: guests.map((g) => g.id), tableIds: tables.map((t) => t.id),
      write: writeOf(actor, guests, tables), reason: group && tables.length > 1 ? `Group split over tables ${tables.map((t) => t.number).join(', ')}` : '',
      audit: { action: 'seat', entityId: guests[0].id, label: one ? guestLabel(guests[0]) : `${guests.length} guests${tables.length > 1 ? ' (group split)' : ' (group)'}`, note: placements.map((p) => `${guestLabel(guestOf(state, p.guestId))}: ${seatText(state, { tableId: p.tableId, seatNo: changes.find((c) => c.id === p.guestId).patch.seat.seatNo })}`).join('; ').slice(0, 480) },
      result: { seats: changes.map((c) => ({ guestId: c.id, tableId: c.patch.seat.tableId, seatNo: c.patch.seat.seatNo })), ...(groupId ? { groupId, split: tables.length > 1 } : {}) },
    };
  },

  // Move a seated guest. The old seat is kept until the new one is checked (one commit: there is no
  // moment without a seat, and a refused move leaves the guest where they were). Status stays.
  transfer(state, cmd, actor, now) {
    const g = mustGuest(state, cmd.guestId);
    const to = mustTable(state, cmd.tableId);
    if (!g.seat) throw refuse('guest_moved', state, [g.id], [to.id]);
    const from = mustTable(state, g.seat.tableId);
    needScope(actor, state, [g], from === to ? [to] : [from, to]);
    const others = state.guests.filter((x) => x.id !== g.id);
    checkFit(state, g, to, others);
    const seatNo = seatNoFor(state, g, to, cmd.seatNo, takenSeats(to.id, others));
    if (to.id === from.id && seatNo === g.seat.seatNo) throw bad('That is the seat the guest already has.');
    const seat = { ...seatRecord(to, seatNo, g.seat.status, actor, now) };
    return {
      type: 'transfer', changes: [setGuest(g, { seat })], guestIds: [g.id], tableIds: [...new Set([from.id, to.id])],
      write: writeOf(actor, [g], from === to ? [to] : [from, to]), reason: cleanText(cmd.reason, 200),
      audit: { action: 'transfer', entityId: g.id, label: guestLabel(g), note: `${seatText(state, g.seat)} → ${seatText(state, seat)}` },
      result: { seats: [{ guestId: g.id, tableId: to.id, seatNo }] },
    };
  },

  // Two seated guests exchange seats, both or neither (spec s.16).
  swap(state, cmd, actor, now) {
    const [ida, idb] = Array.isArray(cmd.guestIds) ? cmd.guestIds : [cmd.guestA, cmd.guestB];
    const a = mustGuest(state, ida);
    const b = mustGuest(state, idb);
    if (a.id === b.id) throw bad('Choose two different guests.');
    if (!a.seat || !b.seat) throw refuse('guest_moved', state, [a.id, b.id]);
    const ta = mustTable(state, a.seat.tableId);
    const tb = mustTable(state, b.seat.tableId);
    needScope(actor, state, [a, b], ta === tb ? [ta] : [ta, tb]);
    const mixed = state.event.settings?.mixedTables;
    if (!classOK(tb.classification, a, mixed) || !classOK(ta.classification, b, mixed) || !ta.active || !tb.active) throw refuse('not_eligible', state, [a.id, b.id], [ta.id, tb.id]);
    if (seatNoRequired(state.event, a) && !b.seat.seatNo) throw bad(`${guestLabel(a)} needs a numbered seat.`);
    if (seatNoRequired(state.event, b) && !a.seat.seatNo) throw bad(`${guestLabel(b)} needs a numbered seat.`);
    const sa = { ...a.seat, tableId: tb.id, seatNo: b.seat.seatNo ?? null, at: now, by: actor.id };
    const sb = { ...b.seat, tableId: ta.id, seatNo: a.seat.seatNo ?? null, at: now, by: actor.id };
    return {
      type: 'swap', changes: [setGuest(a, { seat: sa }), setGuest(b, { seat: sb })], guestIds: [a.id, b.id], tableIds: [...new Set([ta.id, tb.id])],
      write: writeOf(actor, [a, b], ta === tb ? [ta] : [ta, tb]), reason: cleanText(cmd.reason, 200),
      audit: { action: 'swap', entityId: a.id, label: `${guestLabel(a)} ⇄ ${guestLabel(b)}`, note: `${seatText(state, a.seat)} ⇄ ${seatText(state, b.seat)}` },
      result: { seats: [{ guestId: a.id, tableId: sa.tableId, seatNo: sa.seatNo }, { guestId: b.id, tableId: sb.tableId, seatNo: sb.seatNo }] },
    };
  },

  // Send a seated guest back to waiting. A reservation is released instead (its own authority).
  unseat(state, cmd, actor, now) {
    const g = mustGuest(state, cmd.guestId);
    if (!g.seat) throw refuse('guest_moved', state, [g.id]);
    if (isReserved(g.seat)) return COMMANDS.release(state, cmd, actor, now);
    const t = mustTable(state, g.seat.tableId);
    needScope(actor, state, [g], [t]);
    return {
      type: 'unseat', changes: [setGuest(g, { seat: null })], guestIds: [g.id], tableIds: [t.id], write: writeOf(actor, [g], [t]), reason: cleanText(cmd.reason, 200),
      audit: { action: 'unseat', entityId: g.id, label: guestLabel(g), note: `Was at ${seatText(state, g.seat)}` },
      result: { guestId: g.id },
    };
  },

  // A reservation made ahead of arrival (preferred guests' preassigned seats). The Super
  // Administrator, or the owner of guest and table when the event lets owners release (spec s.22).
  reserve(state, cmd, actor, now) {
    const g = mustGuest(state, cmd.guestId);
    const t = mustTable(state, cmd.tableId);
    needReleaser(actor, state, g, t);
    if (g.seat) throw refuse('guest_moved', state, [g.id], [t.id]);
    checkFit(state, g, t, state.guests);
    const seatNo = seatNoFor(state, g, t, cmd.seatNo, takenSeats(t.id, state.guests));
    const seat = seatRecord(t, seatNo, seatStatusFor(g), actor, now);
    return {
      type: 'reserve', changes: [setGuest(g, { seat, released: null })], guestIds: [g.id], tableIds: [t.id], write: writeOf(actor, [g], [t]), reason: cleanText(cmd.reason, 200),
      audit: { action: 'reserve', entityId: g.id, label: guestLabel(g), note: seatText(state, seat) },
      result: { seats: [{ guestId: g.id, tableId: t.id, seatNo }] },
    };
  },

  // Releasing a reservation: never automatic (no timer touches a seat, I9), always with a reason.
  release(state, cmd, actor, now) {
    const g = mustGuest(state, cmd.guestId);
    if (!g.seat) throw refuse('guest_moved', state, [g.id]);
    const t = mustTable(state, g.seat.tableId);
    needReleaser(actor, state, g, t);
    if (!isReserved(g.seat)) throw refuse('stale', state, [g.id], [t.id], 'This guest has arrived and is seated: send them back to waiting instead.');
    const reason = cleanText(cmd.reason, 200);
    if (!reason) throw bad('Say why the reservation is released.');
    return {
      type: 'release', changes: [setGuest(g, { seat: null, released: { at: now, by: actor.id, reason, tableId: t.id, seatNo: g.seat.seatNo ?? null } })],
      guestIds: [g.id], tableIds: [t.id], write: writeOf(actor, [g], [t]), reason,
      audit: { action: 'release', entityId: g.id, label: guestLabel(g), note: `${seatText(state, g.seat)}. ${reason}`.slice(0, 400) },
      result: { guestId: g.id },
    };
  },

  // ----- Delegation (US-017): the Super Administrator gives guests and tables to staff -----
  // Only the owner changes: seats, reservations and check-ins stay exactly as they are, so a
  // reallocation never disturbs a confirmed seat. `ids`, or everything one person owns (`from`);
  // `ownerUserId` null gives them back to the Super Administrator's queue.
  delegateGuests(state, cmd, actor) {
    return delegate(state, cmd, actor, 'caGuests');
  },
  delegateTables(state, cmd, actor) {
    return delegate(state, cmd, actor, 'caTables');
  },

  // The guest page's status tokens for one guest end (a lost phone): the page asks at the desk.
  revokeTokens(state, cmd, actor) {
    const g = mustGuest(state, cmd.guestId);
    if (!eventCan(actor, 'write', g)) throw refuse(isStaff(actor) ? 'out_of_scope' : 'needs_super_admin', state, [g.id]);
    const n = (g.statusTokens || []).length;
    if (!n) throw bad('This guest has no guest page open on any device.');
    return {
      type: 'revokeTokens', changes: [setGuest(g, { statusTokens: [] })], guestIds: [g.id], tableIds: [], diff: [{ id: g.id, f: 'statusTokens', from: n, to: 0 }], write: writeOf(actor, [g], []),
      audit: { action: 'tokens', entityId: g.id, label: guestLabel(g), note: `Guest page ended on ${n} device${n === 1 ? '' : 's'}` }, result: { guestId: g.id, revoked: n },
    };
  },

  // The zero-typing presence key on the reception QR (US-016, off by default): only its SHA-256 is
  // kept; the route makes the key and shows it once, for the QR sheet. keyHash null turns it off.
  setQrKey(state, cmd, actor) {
    needSuper(actor, state);
    const hash = cmd.keyHash == null ? null : String(cmd.keyHash);
    if (hash !== null && !/^[0-9a-f]{64}$/.test(hash)) throw bad('Send the key\'s hash.');
    return {
      type: 'setQrKey', changes: [setEvent(state.event, { qrKeyHash: hash })], guestIds: [], tableIds: [], diff: [{ id: state.event.id, f: 'qrKeyHash', from: Boolean(state.event.qrKeyHash), to: Boolean(hash) }],
      audit: { action: 'qr-key', entityId: state.event.id, label: state.event.name, note: hash ? 'Presence key on the reception QR: on (new key)' : 'Presence key on the reception QR: off' }, result: { qrKey: Boolean(hash) },
    };
  },

  // ----- Walk-ins and substitutes (US-022, spec s.4, s.5, s.7) -----
  // Anyone on the staff records a guest who is not on the list. They are not admitted: they wait,
  // not checked in, in the Super Administrator's inbox, and sit nowhere until approved (classOK).
  createUnlisted(state, cmd, actor, now) {
    needStaff(actor, state);
    const record = newGuest(state, cmd.guest || cmd, actor, now, 'walkin', cmd.note);
    return {
      type: 'createUnlisted', changes: [{ op: 'add', coll: 'caGuests', record }], guestIds: [record.id], tableIds: [], reason: record.approval.note,
      diff: [{ id: record.id, f: 'approval', from: null, to: 'pending' }],
      audit: { action: 'walkin', entityId: record.id, label: guestLabel(record), note: `Walk-in recorded for approval${record.company ? ` (${record.company})` : ''}` },
      result: { guestId: record.id, ref: record.ref, approval: 'pending' },
    };
  },

  // A representative for an invitee who is not coming. A staffer records it for the Super
  // Administrator to approve; the Super Administrator records it already approved. On approval the
  // invitee's seat changes hands in the same commit (or is released, as decided), so the two never
  // both hold a seat (I6); the records link both ways (substituteFor, substitutedBy).
  substitute(state, cmd, actor, now) {
    needStaff(actor, state);
    const o = mustGuest(state, cmd.originalId);
    if (o.substitutedBy || (o.classification === 'unlisted' && o.approval?.state !== 'approved')) throw refuse('guest_moved', state, [o.id], [], 'This invitee already has a substitute, or is not approved yet.');
    if (o.arrival?.state === 'checked_in') throw refuse('already_checked_in', state, [o.id], [], 'The invitee is already checked in: they are here.');
    if (state.guests.some((g) => g.substituteFor === o.id && g.approval?.state === 'pending')) throw refuse('guest_moved', state, [o.id], [], 'A substitute for this invitee is already waiting for approval.');
    const record = newGuest(state, cmd.newGuest || cmd.guest || {}, actor, now, 'substitute', cmd.note, o);
    const add = { op: 'add', coll: 'caGuests', record };
    const audit = { action: 'substitute', entityId: o.id, label: `${guestLabel(record)} for ${guestLabel(o)}` };
    if (actor.role !== 'super') {
      return {
        type: 'substitute', changes: [add], guestIds: [record.id, o.id], tableIds: [], reason: record.approval.note,
        diff: [{ id: record.id, f: 'substituteFor', from: null, to: o.ref }, { id: record.id, f: 'approval', from: null, to: 'pending' }],
        audit: { ...audit, note: `Substitute recorded for approval${o.seat ? ` (${seatText(state, o.seat)})` : ''}` },
        result: { guestId: record.id, ref: record.ref, approval: 'pending', originalId: o.id },
      };
    }
    // The Super Administrator: recorded and approved at once.
    const p = approvePlan(state, record, o, cmd, actor, now);
    return { ...p, type: 'substitute', changes: [add, ...p.changes], audit: { ...audit, note: p.audit.note } };
  },

  // The Super Administrator's decision on a walk-in or a substitute: identity, classification and
  // industry recorded with who, when and why ({ state, by, at, note }). An approved walk-in is
  // checked in (they are at the desk) and waits for a table; an approved substitute takes the
  // invitee's seat (seat: 'transfer', the default) or the seat is released ('release').
  approve(state, cmd, actor, now) {
    needSuper(actor, state);
    const g = mustGuest(state, cmd.guestId);
    if (g.classification !== 'unlisted' || g.approval?.state !== 'pending') throw refuse('stale', state, [g.id], [], 'This guest is not waiting for approval.');
    const o = g.substituteFor ? mustGuest(state, g.substituteFor) : null;
    return approvePlan(state, g, o, cmd, actor, now);
  },
  reject(state, cmd, actor, now) {
    needSuper(actor, state);
    const g = mustGuest(state, cmd.guestId);
    if (g.classification !== 'unlisted' || g.approval?.state !== 'pending') throw refuse('stale', state, [g.id], [], 'This guest is not waiting for approval.');
    const note = cleanText(cmd.note, 300);
    if (!note) throw bad('Say why the guest is not admitted.');
    return {
      type: 'reject', changes: [setGuest(g, { approval: { ...g.approval, state: 'rejected', by: actor.id, at: now, note }, arrival: { state: 'cancelled', at: null, by: null, via: null } })],
      guestIds: [g.id, ...(g.substituteFor ? [g.substituteFor] : [])], tableIds: [], reason: note,
      diff: [{ id: g.id, f: 'approval', from: 'pending', to: 'rejected' }],
      audit: { action: 'reject', entityId: g.id, label: guestLabel(g), note: `${g.substituteFor ? 'Substitute' : 'Walk-in'} not admitted. ${note}`.slice(0, 400) },
      result: { guestId: g.id, approval: 'rejected' },
    };
  },

  // A group whose members have different owners (or tables of no one owner) goes to the Super
  // Administrator to seat together: a flag on each member, nothing else changes. Any staffer.
  refer(state, cmd, actor, now) {
    needStaff(actor, state);
    const ids = Array.isArray(cmd.guestIds) ? [...new Set(cmd.guestIds.map(String))] : [];
    if (ids.length < 1 || ids.length > 50) throw bad('Choose the guests to send.');
    const list = ids.map((id) => mustGuest(state, id));
    const reason = cleanText(cmd.reason, 200) || 'Seat together';
    const key = list.map((g) => g.id).sort()[0];
    const changes = list.filter((g) => !(g.flags || []).some((f) => f.kind === 'referred_group' && f.group === key)).map((g) => setGuest(g, { flags: [...(g.flags || []), { kind: 'referred_group', at: now, by: actor.id, group: key, size: list.length, note: reason }].slice(-10) }));
    if (!changes.length) return { type: 'refer', noop: true, changes: [], guestIds: [], tableIds: [], result: { sent: 0 } };
    return {
      type: 'refer', changes, guestIds: list.map((g) => g.id), tableIds: [], reason,
      diff: list.map((g) => ({ id: g.id, f: 'flags', from: null, to: 'referred_group' })),
      audit: { action: 'refer', entityId: list[0].id, label: `${list.length} guests`, note: `Sent to the Super Administrator to seat together: ${list.map(guestLabel).join(', ')}`.slice(0, 400) },
      result: { sent: list.length },
    };
  },

  // ----- Email (US-023) -----
  // Resend a guest's table and seat by email: a new message (a new attempt) in the outbox, whatever
  // happened to the last one. The guest's owner or the Super Administrator. The outbox sends it
  // outside commit(); a failure never touches the seat or the check-in.
  notify(state, cmd, actor, now) {
    const g = mustGuest(state, cmd.guestId);
    if (!eventCan(actor, 'write', g)) throw refuse(isStaff(actor) ? 'out_of_scope' : 'needs_super_admin', state, [g.id]);
    if (!isConfirmed(g.seat)) throw refuse('guest_moved', state, [g.id], [], 'The guest has no confirmed seat to send.');
    if (!g.email) throw bad('This guest has no email address: tell them their table, or show them this screen.');
    const t = tableOf(state, g.seat.tableId);
    const record = { id: randomUUID(), eventId: state.event.id, ...seatMessage(state.event, g, t, 'resend'), state: 'queued', attempts: 0, lastError: null, createdAt: now, sentAt: null, by: actor.id };
    return {
      type: 'notify', changes: [{ op: 'add', coll: 'caOutbox', record }, setGuest(g, { notify: { ...(g.notify || {}), state: 'queued', lastAt: now, messageId: record.id } })],
      guestIds: [g.id], tableIds: [t?.id].filter(Boolean), diff: [{ id: g.id, f: 'notify', from: g.notify?.state || 'none', to: 'queued' }],
      audit: { action: 'notify', entityId: g.id, label: guestLabel(g), note: `Seat email sent again (${seatText(state, g.seat)})` },
      result: { guestId: g.id, messageId: record.id },
    };
  },

  // ----- Tables and the room (Super Administrator) -----
  'table.add'(state, cmd, actor) {
    needSuper(actor, state);
    const t = tableFields(state, cmd, null);
    const record = { id: randomUUID(), eventId: state.event.id, number: t.number, classification: t.classification || 'regular', capacity: t.capacity ?? Math.min(state.event.room?.chairsPerTable || HARD_LIMIT, HARD_LIMIT), ownerUserId: t.ownerUserId ?? null, tags: [], active: true, row: null, col: null, rev: 0 };
    return { type: 'table.add', changes: [{ op: 'add', coll: 'caTables', record }], guestIds: [], tableIds: [record.id], audit: { action: 'table', entityId: record.id, label: `Table ${record.number}`, note: 'Added' }, result: { tableId: record.id } };
  },
  'table.update'(state, cmd, actor) {
    needSuper(actor, state);
    const t = mustTable(state, cmd.tableId);
    const patch = tableFields(state, cmd, t);
    if (cmd.active !== undefined) patch.active = Boolean(cmd.active);
    const seated = state.guests.filter((g) => g.seat?.tableId === t.id);
    // A table with guests keeps them: it cannot shrink below them, stop being used, or change to a
    // type they may not sit at, until they are moved (spec s.15; I8).
    if ((patch.capacity !== undefined && patch.capacity < seated.length) || (patch.active === false && seated.length)) throw refuse('table_has_claims', state, [], [t.id]);
    if (patch.capacity !== undefined && seated.some((g) => g.seat.seatNo > patch.capacity)) throw refuse('table_has_claims', state, [], [t.id], 'A guest sits in a chair the smaller table would not have. Move them first.');
    if (patch.classification && seated.some((g) => !classOK(patch.classification, g, state.event.settings?.mixedTables))) throw refuse('table_has_claims', state, [], [t.id], 'Guests at this table could not sit at a table of that type. Move them first.');
    if (!Object.keys(patch).length) throw bad('Nothing to change.');
    return { type: 'table.update', changes: [setTable(t, patch)], guestIds: [], tableIds: [t.id], audit: { action: 'table', entityId: t.id, label: `Table ${t.number}`, note: Object.keys(patch).join(', ') }, result: { tableId: t.id } };
  },
  // Every guest at one table moves to another in one commit (keeping their chair number where it is
  // free), optionally taking the emptied table out of use in the same commit.
  'table.relocate'(state, cmd, actor, now) {
    needSuper(actor, state);
    const from = mustTable(state, cmd.fromTableId);
    const to = mustTable(state, cmd.toTableId);
    if (from.id === to.id) throw bad('Choose another table to move the guests to.');
    const moving = state.guests.filter((g) => g.seat?.tableId === from.id);
    if (!moving.length) throw bad(`Table ${from.number} has no guests.`);
    let others = state.guests.filter((g) => g.seat?.tableId !== from.id);
    const changes = [];
    for (const g of moving) {
      checkFit(state, g, to, others);
      const taken = takenSeats(to.id, others);
      let seatNo = g.seat.seatNo && !taken.has(g.seat.seatNo) && g.seat.seatNo <= to.capacity ? g.seat.seatNo : null;
      if (seatNo === null && (g.seat.seatNo || seatNoRequired(state.event, g))) for (let n = 1; n <= to.capacity; n++) if (!taken.has(n)) { seatNo = n; break; }
      const seat = { ...g.seat, tableId: to.id, seatNo, at: now, by: actor.id };
      others = [...others, { ...g, seat }];
      changes.push(setGuest(g, { seat }));
    }
    if (cmd.deactivate) changes.push(setTable(from, { active: false }));
    return { type: 'table.relocate', changes, guestIds: moving.map((g) => g.id), tableIds: [from.id, to.id], reason: cleanText(cmd.reason, 200), audit: { action: 'table', entityId: from.id, label: `Table ${from.number} → table ${to.number}`, note: `${moving.length} guests moved${cmd.deactivate ? `; table ${from.number} no longer in use` : ''}` }, result: { moved: moving.length } };
  },
  // The room (US-031): its tables are made from it, numbered from the stage. Only while no guest has
  // a seat; tables of the same number keep their type and owner.
  'room.set'(state, cmd, actor) {
    needSuper(actor, state);
    let room;
    try {
      room = cleanRoom(cmd.room);
    } catch (err) {
      throw bad(err.message);
    }
    if (state.guests.some((g) => g.seat)) throw refuse('table_has_claims', state, [], [], 'Guests already have seats, so the room cannot be laid out again. Change single tables instead.');
    const changes = [setEvent(state.event, { room })];
    const byNumber = new Map(state.tables.map((t) => [t.number, t]));
    const made = roomTables(room);
    for (const p of made) {
      const old = byNumber.get(p.number);
      if (old) changes.push(setTable(old, { row: p.row, col: p.col, capacity: room.chairsPerTable, active: true }));
      else changes.push({ op: 'add', coll: 'caTables', record: { id: randomUUID(), eventId: state.event.id, number: p.number, classification: 'regular', capacity: room.chairsPerTable, ownerUserId: null, tags: [], active: true, row: p.row, col: p.col, rev: 0 } });
    }
    for (const t of state.tables) if (t.number > made.length) changes.push({ op: 'remove', coll: 'caTables', id: t.id });
    return { type: 'room.set', changes, guestIds: [], tableIds: [], audit: { action: 'room', entityId: state.event.id, label: state.event.name, note: `${room.rows} × ${room.cols} tables of ${room.chairsPerTable}, stage ${room.stageSide}` }, result: { tables: made.length } };
  },

  // ----- The event (Super Administrator) -----
  setFlag(state, cmd, actor) {
    needSuper(actor, state);
    const flag = String(cmd.flag || '');
    if (!FLAGS.includes(flag)) throw bad(`There is no switch "${flag.slice(0, 40)}".`);
    let value = cmd.value;
    if (flag === 'pollMs') {
      value = Number(value);
      if (!Number.isInteger(value) || value < POLL_MS.min || value > POLL_MS.max) throw bad(`The refresh interval is ${POLL_MS.min} to ${POLL_MS.max} ms.`);
    } else value = Boolean(value);
    // Self check-in opens only once the import check is clear, or its issues are acknowledged.
    if (flag === 'registrationOpen' && value) {
      const open = importIssues(state).total;
      if (open > (state.event.importAck?.count ?? -1) && open > 0) throw bad(`${open} import issue${open === 1 ? '' : 's'} to resolve first (Setup → Import check), or acknowledge them.`);
    }
    const before = state.event.flags?.[flag];
    return { type: 'setFlag', changes: [setEvent(state.event, { flags: { ...state.event.flags, [flag]: value } })], guestIds: [], tableIds: [], diff: [{ id: state.event.id, f: `flags.${flag}`, from: before, to: value }], audit: { action: 'flag', entityId: state.event.id, label: state.event.name, note: `${flag}: ${before} → ${value}` }, result: { flags: { ...state.event.flags, [flag]: value } } };
  },
  importAck(state, cmd, actor, now) {
    needSuper(actor, state);
    const count = importIssues(state).total;
    return { type: 'importAck', changes: [setEvent(state.event, { importAck: { count, at: now, by: actor.id } })], guestIds: [], tableIds: [], audit: { action: 'import', entityId: state.event.id, label: state.event.name, note: `${count} import issues acknowledged` }, result: { count } };
  },
  'event.update'(state, cmd, actor) {
    needSuper(actor, state);
    const ev = state.event;
    const patch = {};
    if (cmd.name !== undefined) patch.name = cleanText(cmd.name, 120) || (() => { throw bad('Give the event a name.'); })();
    if (cmd.venue !== undefined) patch.venue = cleanText(cmd.venue, 160);
    if (cmd.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(cmd.date))) throw bad('Write the date as YYYY-MM-DD.');
      patch.date = String(cmd.date);
    }
    if (cmd.status !== undefined) {
      if (!EVENT_STATUSES.includes(cmd.status)) throw bad('An event is draft, live, closed or archived.');
      patch.status = cmd.status;
    }
    if (cmd.window !== undefined) {
      try {
        const w = { opensAt: toUtc(cmd.window?.opensAt), closesAt: toUtc(cmd.window?.closesAt) };
        if (w.opensAt && w.closesAt && w.closesAt <= w.opensAt) throw new Error('The window must close after it opens.');
        patch.window = w;
      } catch (err) {
        throw bad(err.message);
      }
    }
    if (cmd.settings !== undefined) {
      const s = cmd.settings || {};
      const next = { ...ev.settings };
      if (s.seatNumbers !== undefined) next.seatNumbers = SEAT_NUMBERS.includes(s.seatNumbers) ? s.seatNumbers : (() => { throw bad('Seat numbers are for all guests, preferred guests or none.'); })();
      for (const k of ['mixedTables', 'releaseDelegable']) if (s[k] !== undefined) next[k] = Boolean(s[k]);
      // The event's own sender and reply address (US-023): never the IT Service Desk's mailbox, or a
      // guest's reply would become a helpdesk ticket.
      for (const k of ['emailFrom', 'replyTo']) {
        if (s[k] === undefined) continue;
        const v = cleanText(s[k], 254).toLowerCase();
        if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw bad(`The ${k === 'emailFrom' ? 'From' : 'Reply-To'} address is not a valid email address.`);
        if (v && state.helpdeskAddress && v === state.helpdeskAddress) throw bad('Use the event\'s own address, not the IT Service Desk mailbox: guests\' replies would become helpdesk tickets.');
        next[k] = v;
      }
      if (ev.settings?.mixedTables && !next.mixedTables && state.guests.some((g) => g.seat && tableOf(state, g.seat.tableId)?.classification === 'mixed')) throw refuse('table_has_claims', state, [], [], 'Guests sit at mixed tables. Move them before turning mixed tables off.');
      patch.settings = next;
    }
    if (cmd.industries !== undefined) patch.industries = cleanIndustries(cmd.industries, ev.industries || []);
    if (cmd.staff !== undefined) patch.staff = cleanStaff(state, cmd.staff);
    if (!Object.keys(patch).length) throw bad('Nothing to change.');
    return { type: 'event.update', changes: [setEvent(ev, patch)], guestIds: [], tableIds: [], diff: Object.keys(patch).map((f) => ({ id: ev.id, f, from: f === 'staff' || f === 'industries' ? (ev[f] || []).length : ev[f], to: f === 'staff' || f === 'industries' ? patch[f].length : patch[f] })), audit: { action: 'event', entityId: ev.id, label: patch.name || ev.name, note: `Changed: ${Object.keys(patch).join(', ')}` }, result: { eventId: ev.id } };
  },
  // Handing over the Super Administrator (CORE's customapp.manage, with the password asked again in
  // the route): the old holder loses every power in the same commit; what they owned goes to the
  // Super Administrator's queue. Always exactly one (I5).
  setSuperAdmin(state, cmd, actor) {
    if (!actor.canManage) throw refuse('needs_super_admin', state, [], [], 'Only an administrator with CUSTOM APP management can hand over the Super Administrator.');
    const reason = cleanText(cmd.reason, 300);
    if (!reason) throw bad('Say why the Super Administrator changes.');
    const u = (state.users || []).find((x) => x.id === String(cmd.userId || ''));
    if (!u || !u.active || !u.canUse) throw bad('Choose an active account that can use CUSTOM APP.');
    const ev = state.event;
    if (u.id === ev.superAdminUserId) throw bad('That account is already the Super Administrator.');
    const old = ev.superAdminUserId;
    const changes = [setEvent(ev, { superAdminUserId: u.id, staff: (ev.staff || []).filter((s) => s.userId !== u.id && s.userId !== old) })];
    for (const g of state.guests) if (old && g.ownerUserId === old) changes.push(setGuest(g, { ownerUserId: null }));
    for (const t of state.tables) if (old && t.ownerUserId === old) changes.push(setTable(t, { ownerUserId: null }));
    return { type: 'setSuperAdmin', changes, guestIds: [], tableIds: [], reason, diff: [{ id: ev.id, f: 'superAdminUserId', from: old, to: u.id }], audit: { action: 'super-admin', entityId: ev.id, label: ev.name, note: `${(state.users || []).find((x) => x.id === old)?.name || 'Nobody'} → ${u.name}. ${reason}`.slice(0, 400) }, result: { superAdminUserId: u.id } };
  },
  // Contact details, class, industry, owner and "desk only" (the import check's fixes).
  'guest.update'(state, cmd, actor) {
    needSuper(actor, state);
    const g = mustGuest(state, cmd.guestId);
    const patch = {};
    if (cmd.email !== undefined) {
      const e = cleanText(cmd.email, 254).toLowerCase();
      if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw bad('That email address is not valid.');
      patch.email = e;
    }
    if (cmd.mobile !== undefined) patch.mobile = cleanText(cmd.mobile, 40);
    if (cmd.deskOnly !== undefined) patch.deskOnly = Boolean(cmd.deskOnly);
    if (cmd.designation !== undefined) patch.designation = cleanText(cmd.designation, 120);
    if (cmd.company !== undefined) patch.company = cleanText(cmd.company, 160);
    if (cmd.altSurnames !== undefined) patch.altSurnames = (Array.isArray(cmd.altSurnames) ? cmd.altSurnames : String(cmd.altSurnames).split(/[;,]/)).map((s) => cleanText(s, 80)).filter(Boolean).slice(0, 5);
    if (cmd.classification !== undefined) {
      if (!GUEST_CLASSES.includes(cmd.classification)) throw bad('A guest is preferred, regular, employee or unlisted.');
      patch.classification = cmd.classification;
      const t = g.seat && tableOf(state, g.seat.tableId);
      if (t && !classOK(t.classification, { ...g, ...patch }, state.event.settings?.mixedTables)) throw refuse('not_eligible', state, [g.id], [t.id], 'The guest\'s table is not for that class. Move them first.');
    }
    if (cmd.industryId !== undefined) {
      if (cmd.industryId && !(state.event.industries || []).some((i) => i.id === cmd.industryId)) throw bad('Choose an industry of this event.');
      patch.industryId = cmd.industryId || null;
    }
    if (cmd.ownerUserId !== undefined) {
      const owner = cmd.ownerUserId || null;
      if (owner && !activeStaffIds(state.event).has(owner)) throw bad('The owner must be active event staff.');
      patch.ownerUserId = owner;
    }
    if (cmd.active !== undefined) {
      if (!cmd.active && g.seat) throw refuse('table_has_claims', state, [g.id], [], 'Release or move the guest\'s seat first.');
      patch.active = Boolean(cmd.active);
    }
    if (cmd.clearFlags && (g.flags || []).length) patch.flags = [];
    if (!Object.keys(patch).length) throw bad('Nothing to change.');
    if (patch.mobile !== undefined || patch.altSurnames !== undefined) patch.lookup = lookupOf({ ...g, ...patch });
    return { type: 'guest.update', changes: [setGuest(g, patch)], guestIds: [g.id], tableIds: [], audit: { action: 'guest', entityId: g.id, label: guestLabel(g), note: `Changed: ${Object.keys(patch).filter((k) => k !== 'lookup').join(', ')}` }, result: { guestId: g.id } };
  },
  // A guest list, read and checked by io.js (the preview), applied in one commit. New guests are
  // added; existing ones (matched by their key) get their details. Once the event is live, an
  // import never changes anyone's arrival, seat or owner.
  import(state, cmd, actor) {
    needSuper(actor, state);
    const { adds = [], updates = [], capacity } = cmd;
    const active = state.guests.filter((g) => g.active !== false).length + adds.length;
    if (capacity != null && active > capacity) throw bad(`This list would make ${active} guests, more than the ${capacity} seats in the room. Shorten the list first.`);
    const changes = [];
    for (const rec of adds) changes.push({ op: 'add', coll: 'caGuests', record: { ...rec, eventId: state.event.id, rev: 0 } });
    for (const u of updates) {
      const g = guestOf(state, u.id);
      if (!g) continue;
      const patch = { ...u.patch };
      if (state.event.status !== 'draft' || g.arrival?.state === 'checked_in') for (const k of ['arrival', 'seat', 'ownerUserId', 'released']) delete patch[k];
      if (Object.keys(patch).length) changes.push(setGuest(g, patch));
    }
    if (!changes.length) return { type: 'import', noop: true, changes: [], guestIds: [], tableIds: [], result: { added: 0, updated: 0 } };
    return { type: 'import', changes, guestIds: [], tableIds: [], diff: [{ id: state.event.id, f: 'guests', from: null, to: { added: adds.length, updated: changes.length - adds.length } }], audit: { action: 'import', entityId: state.event.id, label: state.event.name, note: `${adds.length} guests added, ${changes.length - adds.length} updated` }, result: { added: adds.length, updated: changes.length - adds.length } };
  },
};

function arrivalPlan(state, g, patch, type, actor) {
  const route = patch.seat ? 'seated' : g.seat ? 'seated' : g.released && g.classification === 'preferred' ? 'super_admin' : g.ownerUserId ? 'owner' : 'super_admin';
  const label = { checkIn: 'Checked in', selfCheckIn: 'Checked in on their phone', undoCheckIn: 'Check-in undone' }[type];
  return {
    type, changes: [setGuest(g, patch)], guestIds: [g.id], tableIds: g.seat ? [g.seat.tableId] : [],
    audit: { action: type === 'undoCheckIn' ? 'undo-check-in' : 'check-in', entityId: g.id, label: guestLabel(g), note: `${label}${patch.seat ? `; ${seatText(state, patch.seat)} retrieved` : ''}` },
    result: { guestId: g.id, route, seat: patch.seat ? { tableId: patch.seat.tableId, number: tableOf(state, patch.seat.tableId)?.number, seatNo: patch.seat.seatNo } : null, by: actor.id },
  };
}

function needReleaser(actor, state, g, t) {
  if (actor.role === 'super') return;
  if (!isStaff(actor)) throw refuse('out_of_scope', state, [g.id], [t.id]);
  if (!state.event.settings?.releaseDelegable) throw refuse('needs_super_admin', state, [g.id], [t.id]);
  needScope(actor, state, [g], [t]);
}


// A guest who is not on the imported list (a walk-in, or a substitute for `original`), waiting for
// the Super Administrator: not checked in, classification 'unlisted', approval pending. Desk only
// (the guest page refers them), so they never count in the import check.
function newGuest(state, input, actor, now, kind, note, original = null) {
  const first = cleanText(input.first ?? input.firstName, 80);
  const last = cleanText(input.last ?? input.surname ?? input.lastName, 80);
  if (!last) throw bad('Write the guest\'s surname.');
  const email = cleanText(input.email, 254).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('That email address is not valid.');
  const industryId = input.industryId ? String(input.industryId) : original?.industryId || null;
  if (industryId && !(state.event.industries || []).some((i) => i.id === industryId)) throw bad('Choose an industry of this event.');
  const n = state.guests.filter((g) => g.classification === 'unlisted').length + 1;
  const prefix = state.event.refPrefix || 'G';
  let ref = `${prefix}-${kind === 'substitute' ? 'S' : 'W'}${String(n).padStart(3, '0')}`;
  for (let k = n + 1; state.guests.some((g) => g.ref === ref); k++) ref = `${prefix}-${kind === 'substitute' ? 'S' : 'W'}${String(k).padStart(3, '0')}`;
  const rec = {
    id: randomUUID(), eventId: state.event.id, ref, externalKey: null,
    name: { first, last, display: `${first} ${last}`.trim() }, designation: cleanText(input.designation, 120),
    company: cleanText(input.company, 160) || original?.company || '', industryId, industryText: '',
    email, mobile: cleanText(input.mobile, 40), classification: 'unlisted', tags: [], rsvp: '',
    ownerUserId: original ? original.ownerUserId || null : null,
    arrival: { state: 'expected', at: null, by: null, via: null },
    approval: { state: 'pending', kind, requestedBy: actor.id, requestedAt: now, note: cleanText(note, 300) },
    ...(original ? { substituteFor: original.id } : {}),
    seat: null, statusTokens: [], flags: [], notify: { state: 'none' }, deskOnly: true, altSurnames: [], active: true, rev: 0,
  };
  rec.lookup = lookupOf(rec);
  return rec;
}

// Approving g (a walk-in, or the substitute for o): one plan, used by approve and by the Super
// Administrator's own substitute (where g is added in the same commit).
function approvePlan(state, g, o, cmd, actor, now) {
  const ev = state.event;
  const note = cleanText(cmd.note, 300);
  const seatClass = o ? (o.classification === 'unlisted' ? o.approval?.classification : o.classification) : cmd.classification;
  if (!['preferred', 'regular', 'employee'].includes(seatClass)) throw bad('Choose the class the guest sits as: preferred, regular or employee.');
  const industryId = cmd.industryId !== undefined ? cmd.industryId || null : g.industryId || o?.industryId || null;
  if (industryId && !(ev.industries || []).some((i) => i.id === industryId)) throw bad('Choose an industry of this event.');
  const owner = cmd.ownerUserId !== undefined ? cmd.ownerUserId || null : g.ownerUserId || o?.ownerUserId || null;
  if (owner && !activeStaffIds(ev).has(owner)) throw bad('The owner must be active event staff.');
  const patch = {
    approval: { ...(g.approval || {}), state: 'approved', by: actor.id, at: now, note, classification: seatClass, industryId, identity: { name: g.name?.display || '', company: g.company || '' } },
    arrival: { state: 'checked_in', at: now, by: actor.id, via: cmd.via === 'reconcile' ? 'reconcile' : 'desk' }, industryId, ownerUserId: owner,
  };
  if (cmd.company !== undefined) patch.company = cleanText(cmd.company, 160);
  const changes = [];
  const tableIds = [];
  let note2 = '';
  if (o) {
    if (o.arrival?.state === 'checked_in') throw refuse('already_checked_in', state, [o.id, g.id], [], 'The invitee checked in meanwhile: they are here, so there is no substitute.');
    if (o.substitutedBy && o.substitutedBy !== g.id) throw refuse('guest_moved', state, [o.id, g.id]);
    const oPatch = { substitutedBy: g.id, arrival: { state: 'cancelled', at: null, by: null, via: null } };
    if (o.seat) {
      const t = tableOf(state, o.seat.tableId);
      tableIds.push(o.seat.tableId);
      if (cmd.seat === 'release') {
        oPatch.seat = null;
        oPatch.released = { at: now, by: actor.id, reason: `Substitute ${g.name?.display || ''} approved; the seat is released`.trim(), tableId: o.seat.tableId, seatNo: o.seat.seatNo ?? null };
        note2 = `; ${seatText(state, o.seat)} released`;
      } else {
        // The seat changes hands: the substitute is here, so it is confirmed.
        oPatch.seat = null;
        patch.seat = { ...o.seat, status: 'confirmed', at: now, by: actor.id };
        note2 = `; ${seatText(state, o.seat)} now theirs`;
        if (!t) throw bad('The invitee\'s table is not in this event.');
      }
    }
    changes.push(setGuest(o, oPatch));
  }
  changes.unshift(setGuest(g, patch));
  return {
    type: 'approve', changes, guestIds: [g.id, ...(o ? [o.id] : [])], tableIds, reason: note,
    diff: [{ id: g.id, f: 'approval', from: 'pending', to: 'approved' }, { id: g.id, f: 'classification', from: 'unlisted', to: seatClass }, ...(o ? [{ id: o.id, f: 'substitutedBy', from: null, to: g.ref }, ...(o.seat ? [{ id: o.id, f: 'seat', from: { t: o.seat.tableId, s: o.seat.seatNo ?? null, st: o.seat.status }, to: null }, ...(patch.seat ? [{ id: g.id, f: 'seat', from: null, to: { t: patch.seat.tableId, s: patch.seat.seatNo ?? null, st: 'confirmed' } }] : [])] : [])] : [])],
    audit: { action: 'approve', entityId: g.id, label: guestLabel(g), note: `${o ? `Substitute for ${guestLabel(o)}` : 'Walk-in'} approved as ${seatClass}${note2}${note ? `. ${note}` : ''}`.slice(0, 400) },
    result: { guestId: g.id, approval: 'approved', classification: seatClass, ...(o ? { originalId: o.id, seat: patch.seat ? { tableId: patch.seat.tableId, seatNo: patch.seat.seatNo ?? null } : null } : {}) },
  };
}

// Who owns what: guests or tables (coll) given to one active staff member, or back to nobody.
function delegate(state, cmd, actor, coll) {
  needSuper(actor, state);
  const isGuests = coll === 'caGuests';
  const all = isGuests ? state.guests : state.tables;
  const owner = cmd.ownerUserId || null;
  if (owner && !activeStaffIds(state.event).has(owner)) throw bad('Give them to an active member of the event\'s staff.');
  let list;
  if (cmd.fromUserId !== undefined) list = all.filter((r) => (r.ownerUserId || null) === (cmd.fromUserId || null) && r.active !== false);
  else {
    const ids = Array.isArray(cmd.ids) ? cmd.ids.map(String) : [];
    if (!ids.length || ids.length > 500) throw bad(`Choose the ${isGuests ? 'guests' : 'tables'} to give.`);
    list = ids.map((id) => all.find((r) => r.id === id) || (() => { throw bad(`That ${isGuests ? 'guest' : 'table'} is not in this event.`); })());
  }
  list = list.filter((r) => (r.ownerUserId || null) !== owner);
  if (!list.length) throw bad('Nothing to move: they already belong there.');
  const name = (id) => (state.users || []).find((u) => u.id === id)?.name || 'the Super Administrator\'s queue';
  const what = isGuests ? `${list.length} guest${list.length === 1 ? '' : 's'}` : `table${list.length === 1 ? '' : 's'} ${list.map((t) => t.number).sort((a, b) => a - b).join(', ')}`;
  return {
    type: isGuests ? 'delegateGuests' : 'delegateTables',
    changes: list.map((r) => ({ op: 'set', coll, id: r.id, patch: { ownerUserId: owner } })),
    guestIds: isGuests ? list.map((r) => r.id) : [], tableIds: isGuests ? [] : list.map((r) => r.id), reason: cleanText(cmd.reason, 200),
    audit: { action: 'delegate', entityId: state.event.id, label: state.event.name, note: `${what} → ${owner ? name(owner) : 'the Super Administrator'}`.slice(0, 400) },
    result: { moved: list.length, ownerUserId: owner },
  };
}

export const STATUS_TOKENS_MAX = 5;

const activeStaffIds = (ev) => new Set([ev.superAdminUserId, ...(ev.staff || []).filter((s) => s.active !== false).map((s) => s.userId)].filter(Boolean));

function tableFields(state, cmd, t) {
  const out = {};
  const hard = Math.min(Number(state.event.settings?.hardLimit) || HARD_LIMIT, HARD_LIMIT);
  if (cmd.number !== undefined || !t) {
    const n = Number(cmd.number);
    if (!Number.isInteger(n) || n < 1 || n > 999) throw bad('A table number is a whole number from 1 to 999.');
    if (state.tables.some((x) => x.number === n && x.id !== t?.id)) throw bad(`There is already a table ${n}.`);
    out.number = n;
  }
  if (cmd.capacity !== undefined) {
    const c = Number(cmd.capacity);
    if (!Number.isInteger(c) || c < 1 || c > hard) throw bad(`A table seats 1 to ${hard}.`);
    out.capacity = c;
  }
  if (cmd.classification !== undefined) {
    if (!TABLE_CLASSES.includes(cmd.classification)) throw bad('A table is preferred, regular, employee or mixed.');
    out.classification = cmd.classification;
  }
  if (cmd.ownerUserId !== undefined) {
    const owner = cmd.ownerUserId || null;
    if (owner && !activeStaffIds(state.event).has(owner)) throw bad('The owner must be active event staff.');
    out.ownerUserId = owner;
  }
  return out;
}

// Industries with their related ones kept symmetric: A related to B means B related to A, and
// removing it from one removes it from both (design A2).
export function cleanIndustries(input, existing = []) {
  if (!Array.isArray(input) || input.length > 200) throw bad('Send the industries as a list (at most 200).');
  const list = input.map((x) => {
    const name = cleanText(x?.name, 80);
    if (!name) throw bad('Every industry needs a name.');
    const id = typeof x.id === 'string' && x.id ? x.id : existing.find((e) => e.name.toLowerCase() === name.toLowerCase())?.id || randomUUID();
    return { id, name, related: Array.isArray(x.related) ? x.related.map(String) : [], active: x.active !== false };
  });
  if (new Set(list.map((i) => i.name.toLowerCase())).size !== list.length) throw bad('Two industries have the same name.');
  const byKey = new Map();
  for (const i of list) {
    byKey.set(i.id, i);
    byKey.set(i.name.toLowerCase(), i);
  }
  // A link that was there before stays only while both sides still list it (taking it off either
  // side takes it off both); a new link on either side is added to both.
  const before = new Set();
  for (const e of existing) for (const r of e.related || []) before.add([e.id, r].sort().join('|'));
  const said = new Map(); // pair → how many sides list it
  for (const i of list) {
    for (const r of new Set(i.related)) {
      const other = byKey.get(r) || byKey.get(String(r).toLowerCase());
      if (!other || other === i) continue;
      const k = [i.id, other.id].sort().join('|');
      said.set(k, (said.get(k) || 0) + 1);
    }
  }
  const links = new Set([...said].filter(([k, n]) => (before.has(k) ? n >= 2 : n >= 1)).map(([k]) => k));
  for (const i of list) i.related = [];
  for (const l of links) {
    const [a, b] = l.split('|');
    byKey.get(a).related.push(b);
    byKey.get(b).related.push(a);
  }
  for (const i of list) i.related.sort();
  return list;
}

// The event's staff: accounts that can use CUSTOM APP; someone who still owns guests or tables
// cannot be taken off until those are given to someone else (I4).
function cleanStaff(state, input) {
  if (!Array.isArray(input) || input.length > 200) throw bad('Send the staff as a list.');
  const users = new Map((state.users || []).map((u) => [u.id, u]));
  const seen = new Set();
  const out = [];
  for (const s of input) {
    const id = String(s?.userId || '');
    const u = users.get(id);
    if (!u || !u.canUse) throw bad('Every staff member must be an account that can use CUSTOM APP.');
    if (id === state.event.superAdminUserId || seen.has(id)) continue;
    seen.add(id);
    out.push({ userId: id, role: 'staff', active: s.active !== false && u.active });
  }
  const active = new Set([state.event.superAdminUserId, ...out.filter((s) => s.active).map((s) => s.userId)]);
  const stranded = [...state.guests, ...state.tables].find((r) => r.ownerUserId && !active.has(r.ownerUserId));
  if (stranded) throw bad(`${users.get(stranded.ownerUserId)?.name || 'Someone'} still owns guests or tables. Give them to someone else first.`);
  return out;
}

export const COMMAND_TYPES = Object.freeze(Object.keys(COMMANDS));

export function plan(state, cmd, actor, now) {
  const fn = Object.hasOwn(COMMANDS, cmd?.type) ? COMMANDS[cmd.type] : null;
  if (!fn) throw bad(`Unknown command "${String(cmd?.type).slice(0, 40)}".`);
  return fn(state, cmd, actor, now);
}
