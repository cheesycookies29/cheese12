// CUSTOM APP → events, the engine through commit() on an event held in memory (no disk): setup
// rules (US-006), the unit of work (US-007) and the seat commands (US-009). Tests assert refusal
// codes, never wording.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, newCtx, commitAs, codeOf, USERS } from './support/customapp-kit.js';
import { newEventCode } from '../server/customapp/events/model.js';
import { cleanIndustries } from '../server/customapp/events/engine.js';
import { createEvent } from '../server/customapp/events/commit.js';
import { toUtc, fmtManila, toManilaInput } from '../shared/customapp/time.js';
import { claimsAt } from '../shared/customapp/seating.js';
import { checkInvariants } from '../shared/customapp/invariants.js';

const run = (db) => {
  const ctx = newCtx(db);
  const as = (who) => (cmd) => commitAs(ctx, 'ev1', USERS[who], cmd);
  return { ctx, lead: as('lead'), sam: as('sam'), tess: as('tess'), ada: as('ada'), g: (ref) => db.data.caGuests.find((x) => x.ref === ref), t: (n) => db.data.caTables.find((x) => x.number === n) };
};
const clean = (db) => assert.deepEqual(checkInvariants({ event: db.data.caEvents[0], tables: db.data.caTables, guests: db.data.caGuests }), []);

describe('US-006: Event, table and industry setup', () => {
  test('GIVEN a new event WHEN it is created THEN its code is a slug with a random suffix such as yep26-k3f9', () => {
    const a = newEventCode('Year-End Party 2026');
    assert.match(a, /^year-end-party-2026-[a-z2-9]{4}$/);
    assert.notEqual(a, newEventCode('Year-End Party 2026'), 'the suffix is random');
    assert.match(newEventCode('Peñafrancia Gala!'), /^penafrancia-gala-[a-z2-9]{4}$/);
  });
  test('GIVEN industries A and B WHEN A is saved with B in related THEN B lists A in related too, and removing it removes both', () => {
    const list = cleanIndustries([{ name: 'Banking', related: ['Insurance'] }, { name: 'Insurance' }, { name: 'Retail' }]);
    const [bank, ins, retail] = list;
    assert.deepEqual(bank.related, [ins.id]);
    assert.deepEqual(ins.related, [bank.id], 'kept both ways');
    assert.deepEqual(retail.related, []);
    const after = cleanIndustries([{ ...bank, related: [] }, { ...ins }, retail], list);
    assert.deepEqual(after[1].related, [], 'removing from one side removes it from both');
  });
  test('GIVEN an event with hardLimit 10 WHEN table.add or table.update sets capacity 0 or 11 THEN the command is refused and capacity 1..10 is accepted', () => {
    const db = fixture({ tables: [{ n: 1 }] });
    const { lead, t } = run(db);
    for (const cap of [0, 11, 2.5]) {
      assert.equal(codeOf(() => lead({ type: 'table.add', number: 9, capacity: cap })), 'http400');
      assert.equal(codeOf(() => lead({ type: 'table.update', tableId: 't1', capacity: cap })), 'http400');
    }
    lead({ type: 'table.add', number: 9, capacity: 1 });
    lead({ type: 'table.update', tableId: 't1', capacity: 10, classification: 'mixed' });
    assert.equal(t(9).capacity, 1);
    assert.equal(codeOf(() => lead({ type: 'table.update', tableId: 't1', classification: 'vip' })), 'http400', 'preferred, regular, employee or mixed');
    assert.equal(codeOf(() => lead({ type: 'table.update', tableId: 't1', ownerUserId: 'nobody' })), 'http400', 'one owner, who is event staff');
    clean(db);
  });
  test('GIVEN a table holding 6 claims WHEN table.update shrinks it to 5 or deactivates it THEN 409 table_has_claims, unless a table.relocate in the same commit empties it', () => {
    const guests = Array.from({ length: 6 }, (_, i) => ({ ref: `R${i}`, arrived: i % 2 === 0, seat: [1, i + 1] }));
    const db = fixture({ tables: [{ n: 1 }, { n: 2 }], guests });
    const { lead, t } = run(db);
    assert.equal(codeOf(() => lead({ type: 'table.update', tableId: 't1', capacity: 5 })), 'table_has_claims');
    assert.equal(codeOf(() => lead({ type: 'table.update', tableId: 't1', active: false })), 'table_has_claims');
    lead({ type: 'table.update', tableId: 't1', capacity: 6 });
    lead({ type: 'table.relocate', fromTableId: 't1', toTableId: 't2', deactivate: true });
    assert.equal(t(1).active, false);
    assert.equal(claimsAt('t2', db.data.caGuests), 6);
    assert.deepEqual(db.data.caGuests.map((g) => g.seat.seatNo), [1, 2, 3, 4, 5, 6], 'chair numbers kept');
    clean(db);
  });
  test('GIVEN window.opensAt entered as 6:00 PM Asia/Manila WHEN it is stored and read back THEN it is a UTC instant and displays as 6:00 PM in Asia/Manila', () => {
    const db = fixture();
    const { lead } = run(db);
    lead({ type: 'event.update', window: { opensAt: '2026-12-09T18:00', closesAt: '2026-12-09T23:30' } });
    const w = db.data.caEvents[0].window;
    assert.equal(w.opensAt, '2026-12-09T10:00:00.000Z');
    assert.match(fmtManila(w.opensAt), /6:00\s?PM/);
    assert.equal(toManilaInput(w.closesAt), '2026-12-09T23:30');
    assert.equal(toUtc('2026-12-09T10:00:00Z'), '2026-12-09T10:00:00.000Z', 'a time with its own zone is taken as it is');
    assert.equal(codeOf(() => lead({ type: 'event.update', window: { opensAt: '2026-12-09T18:00', closesAt: '2026-12-09T17:00' } })), 'http400');
  });
});

describe('US-031 (room data): the room is event data and the tables come from it', () => {
  test('GIVEN room {5,5,10,right,left} WHEN the event is set up THEN tables 1-25 exist with derived positions (AC-205)', () => {
    const db = fixture();
    db.data.caEvents = [];
    db.data.caTables = [];
    const ev = createEvent(newCtx(db), { ...USERS.ada }, { name: 'Big Night', room: { rows: 5, cols: 5, chairsPerTable: 10, stageSide: 'right', boothSide: 'left' } });
    const tables = db.data.caTables.filter((t) => t.eventId === ev.id);
    assert.deepEqual(ev.room, { rows: 5, cols: 5, chairsPerTable: 10, stageSide: 'right', boothSide: 'left', numbering: 'from-stage' });
    assert.equal(tables.length, 25);
    assert.deepEqual(tables.map((t) => t.number).sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));
    assert.ok(tables.every((t) => t.capacity === 10 && t.active));
    assert.equal(new Set(tables.map((t) => `${t.row}:${t.col}`)).size, 25, 'one table per position');
    assert.equal(ev.seq, 1);
    // Another room needs no code: 3 x 4 tables of 8, stage at the top.
    const other = createEvent(newCtx(db), { ...USERS.ada }, { name: 'Small Lunch', room: { rows: 3, cols: 4, chairsPerTable: 8, stageSide: 'top' } });
    assert.equal(db.data.caTables.filter((t) => t.eventId === other.id).length, 12);
  });
  test('GIVEN the room WHEN numbered THEN tables run from the stage and chairs 1-10 clockwise from the stage side (AC-206)', async () => {
    const { roomTables, chairAngle } = await import('../shared/customapp/room.js');
    const room = { rows: 5, cols: 5, chairsPerTable: 10, stageSide: 'right', boothSide: 'left' };
    const at = new Map(roomTables(room).map((t) => [t.number, t]));
    // The column nearest the stage (the rightmost) holds 1-5, top to bottom; the next one 6-10.
    assert.deepEqual([1, 2, 3, 4, 5].map((n) => [at.get(n).row, at.get(n).col]), [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
    assert.deepEqual([at.get(6).col, at.get(6).row, at.get(25).col, at.get(25).row], [3, 0, 0, 4]);
    // Chair 1 faces the stage (to the right, 0°); the chairs run clockwise on the plan, 36° apart.
    assert.equal(chairAngle(room, 1), 0);
    assert.equal(chairAngle(room, 2), 36);
    assert.equal(chairAngle(room, 4), 108, 'below-right of the table: clockwise with y pointing down');
    assert.equal(chairAngle({ ...room, stageSide: 'left' }, 1), 180);
    const top = roomTables({ rows: 2, cols: 3, chairsPerTable: 10, stageSide: 'top' });
    assert.deepEqual(top.slice(0, 3).map((t) => [t.row, t.col]), [[0, 0], [0, 1], [0, 2]], 'stage at the top: the first row, left to right');
  });
  test('GIVEN tables made from a room WHEN room.set lays it out again THEN it works only while no guest has a seat', () => {
    const db = fixture({ tables: [{ n: 1, cls: 'preferred' }, { n: 2 }], guests: [{ ref: 'A' }] });
    const { lead, t } = run(db);
    lead({ type: 'room.set', room: { rows: 2, cols: 3, chairsPerTable: 8, stageSide: 'left' } });
    assert.equal(db.data.caTables.length, 6);
    assert.equal(t(1).classification, 'preferred', 'a table of the same number keeps its type');
    assert.equal(t(1).capacity, 8);
    lead({ type: 'reserve', guestId: 'g-A', tableId: t(2).id, seatNo: 1 });
    assert.equal(codeOf(() => lead({ type: 'room.set', room: { rows: 1, cols: 1, chairsPerTable: 10, stageSide: 'left' } })), 'table_has_claims');
    assert.equal(codeOf(() => lead({ type: 'room.set', room: { rows: 1, cols: 1, chairsPerTable: 11, stageSide: 'left' } })), 'http400');
  });
});

describe('US-007: commit() unit of work, claimsAt(), invariants and typed refusals', () => {
  test('GIVEN a table of 10 with 8 confirmed and 2 reserved seats WHEN another guest is assigned to it THEN it is refused with 409 table_full', () => {
    const guests = Array.from({ length: 10 }, (_, i) => ({ ref: `S${i}`, arrived: i < 8, seat: [1, i + 1] }));
    const db = fixture({ tables: [{ n: 1 }, { n: 2 }], guests: [...guests, { ref: 'NEW', arrived: true }] });
    const { lead, t } = run(db);
    assert.equal(claimsAt('t1', db.data.caGuests), 10, 'reserved seats count');
    let err;
    try {
      lead({ type: 'assign', guestId: 'g-NEW', tableId: 't1', seatNo: 1 });
    } catch (e) {
      err = e;
    }
    assert.equal(err.code, 'table_full');
    assert.equal(err.status, 409);
    assert.deepEqual(err.fresh.options.map((o) => o.number), [2], 'fresh options: the table with room');
    // With no other table left, the same request is referred to the Super Administrator.
    lead({ type: 'table.update', tableId: t(2).id, active: false });
    assert.equal(codeOf(() => lead({ type: 'assign', guestId: 'g-NEW', tableId: 't1', seatNo: 1 })), 'no_eligible_seat');
    clean(db);
  });
  test('GIVEN an event at seq n WHEN a command commits THEN one compact caChanges entry is appended with seq n+1, the type, opId, guestIds, tableIds and diff, and each touched record\'s rev is incremented', () => {
    const db = fixture({ tables: [{ n: 1 }], guests: [{ ref: 'A', arrived: true }] });
    const { lead, g, t } = run(db);
    db.data.caEvents[0].seq = 41;
    const r = lead({ type: 'assign', guestId: 'g-A', tableId: 't1', seatNo: 3, opId: 'op-1' });
    assert.equal(r.seq, 42);
    assert.equal(db.data.caEvents[0].seq, 42);
    assert.equal(db.data.caChanges.length, 1);
    const c = db.data.caChanges[0];
    assert.deepEqual([c.seq, c.eventId, c.type, c.opId, c.guestIds, c.tableIds, c.actorId, c.via], [42, 'ev1', 'assign', 'op-1', ['g-A'], ['t1'], USERS.lead.id, 'staff']);
    assert.deepEqual(c.diff, [{ id: 'g-A', f: 'seat', from: null, to: { t: 't1', s: 3, st: 'confirmed' } }]);
    assert.ok(JSON.stringify(c).length < 600, 'compact');
    assert.equal(g('A').rev, 1);
    assert.equal(t(1).rev, 0, 'a table whose record did not change keeps its rev');
    assert.equal(r.revs['g-A'], 1);
  });
  test('GIVEN a guest at rev 3 WHEN a command expects rev 2 THEN 409 stale with fresh holding the current guest state and re-ranked options', () => {
    const db = fixture({ tables: [{ n: 1 }, { n: 2 }], guests: [{ ref: 'A', arrived: true }] });
    const { lead, g } = run(db);
    g('A').rev = 3;
    let err;
    try {
      lead({ type: 'assign', guestId: 'g-A', tableId: 't1', seatNo: 1, expect: { 'g-A': 2 } });
    } catch (e) {
      err = e;
    }
    assert.equal(err.code, 'stale');
    assert.equal(err.fresh.guests[0].rev, 3);
    assert.deepEqual(err.fresh.options.map((o) => o.number), [1, 2]);
    assert.equal(g('A').seat, null, 'nothing written');
    assert.equal(db.data.caChanges.length, 0);
    lead({ type: 'assign', guestId: 'g-A', tableId: 't1', seatNo: 1, expect: { 'g-A': 3 } });
    assert.equal(g('A').seat.tableId, 't1');
  });
});

describe('US-009: Seat commands: check-in, preferred retrieval, reservations, assign, transfer and swap', () => {
  test('GIVEN an expected guest WHEN checkIn is committed twice with different opIds THEN arrival is checked_in once with at, by and via and the second gets 409 already_checked_in', () => {
    const db = fixture({ guests: [{ ref: 'A', owner: 'sam' }] });
    const { tess, g } = run(db);
    tess({ type: 'checkIn', guestId: 'g-A', opId: 'a' });
    assert.deepEqual(g('A').arrival, { state: 'checked_in', at: '2026-12-09T11:00:00.000Z', by: USERS.tess.id, via: 'desk' }, 'any staffer checks in, whoever owns the guest');
    assert.equal(codeOf(() => tess({ type: 'checkIn', guestId: 'g-A', opId: 'b' })), 'already_checked_in');
    assert.equal(db.data.caChanges.length, 1);
  });
  test('GIVEN a checked-in guest WHEN undoCheckIn is committed THEN arrival returns to expected and the change is in caChanges', () => {
    const db = fixture({ tables: [{ n: 1, owner: 'sam' }], guests: [{ ref: 'A', owner: 'sam', arrived: true, seat: [1, 2] }] });
    const { sam, tess, g } = run(db);
    assert.equal(codeOf(() => tess({ type: 'undoCheckIn', guestId: 'g-A' })), 'out_of_scope', 'a correction is the owner\'s');
    sam({ type: 'undoCheckIn', guestId: 'g-A', reason: 'Wrong person' });
    assert.equal(g('A').arrival.state, 'expected');
    assert.equal(g('A').seat.status, 'reserved', 'the chair stays theirs, as a reservation');
    assert.equal(db.data.caChanges.at(-1).type, 'undoCheckIn');
    assert.equal(db.data.caChanges.at(-1).reason, 'Wrong person');
    clean(db);
  });
  test('GIVEN a preferred guest with a reserved seat at table 3 seat 4 WHEN checkIn is committed THEN the seat becomes confirmed at table 3 seat 4', () => {
    const db = fixture({ tables: [{ n: 3, cls: 'preferred' }], guests: [{ ref: 'P', cls: 'preferred', seat: [3, 4, 'reserved'] }] });
    const { sam, g } = run(db);
    const r = sam({ type: 'checkIn', guestId: 'g-P' });
    assert.deepEqual([g('P').seat.tableId, g('P').seat.seatNo, g('P').seat.status], ['t3', 4, 'confirmed']);
    assert.equal(r.route, 'seated');
    assert.deepEqual(r.seat, { tableId: 't3', number: 3, seatNo: 4 });
  });
  test('GIVEN a reserved seat WHEN release is attempted by a non-owner, by the owner without releaseDelegable, without a reason, and by the Super Administrator with a reason THEN only the authorised actor with a reason succeeds and no timer ever clears a seat', () => {
    const db = fixture({ tables: [{ n: 1, cls: 'preferred', owner: 'sam' }], guests: [{ ref: 'P', cls: 'preferred', owner: 'sam', seat: [1, 1, 'reserved'] }] });
    const { lead, sam, tess, ada, g } = run(db);
    assert.equal(codeOf(() => tess({ type: 'release', guestId: 'g-P', reason: 'No-show' })), 'needs_super_admin');
    assert.equal(codeOf(() => sam({ type: 'release', guestId: 'g-P', reason: 'No-show' })), 'needs_super_admin', 'the owner, while releaseDelegable is false');
    assert.equal(codeOf(() => ada({ type: 'release', guestId: 'g-P', reason: 'No-show' })), 'out_of_scope', 'a CORE administrator has no seat authority');
    assert.equal(codeOf(() => lead({ type: 'release', guestId: 'g-P' })), 'http400', 'a reason is required');
    assert.equal(g('P').seat.status, 'reserved');
    lead({ type: 'release', guestId: 'g-P', reason: 'No-show by 8 PM' });
    assert.equal(g('P').seat, null);
    assert.equal(g('P').released.reason, 'No-show by 8 PM');
    // With releaseDelegable on, the owner may reserve and release within their scope.
    const db2 = fixture({ settings: { releaseDelegable: true }, tables: [{ n: 1, cls: 'preferred', owner: 'sam' }], guests: [{ ref: 'P', cls: 'preferred', owner: 'sam', seat: [1, 1, 'reserved'] }] });
    const r2 = run(db2);
    r2.sam({ type: 'release', guestId: 'g-P', reason: 'No-show' });
    r2.sam({ type: 'reserve', guestId: 'g-P', tableId: 't1', seatNo: 2 });
    assert.equal(r2.g('P').seat.seatNo, 2);
    // No timer, no expiry: nothing in the engine or the commit reads a clock to clear a seat.
    for (const f of ['server/customapp/events/engine.js', 'server/customapp/events/commit.js']) assert.doesNotMatch(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /setTimeout|setInterval|expiresAt|holdUntil/, f);
  });
  test('GIVEN a preferred guest whose reservation was released WHEN they arrive and check in THEN they are routed to the Super Administrator queue for reassignment', () => {
    const db = fixture({ tables: [{ n: 1, cls: 'preferred', owner: 'sam' }], guests: [{ ref: 'P', cls: 'preferred', owner: 'sam', seat: [1, 1, 'reserved'] }] });
    const { lead, sam, g } = run(db);
    lead({ type: 'release', guestId: 'g-P', reason: 'No-show' });
    const r = sam({ type: 'checkIn', guestId: 'g-P' });
    assert.equal(r.route, 'super_admin');
    assert.equal(codeOf(() => sam({ type: 'assign', guestId: 'g-P', tableId: 't1', seatNo: 2 })), 'needs_super_admin', 'the owner cannot seat a released preferred guest');
    lead({ type: 'assign', guestId: 'g-P', tableId: 't1', seatNo: 2 });
    assert.equal(g('P').seat.status, 'confirmed');
  });
  test('GIVEN an occupied seat, a table of the wrong class and an event with no free eligible seat WHEN assign is committed for each THEN the replies are seat_taken, not_eligible and no_eligible_seat', () => {
    const db = fixture({ tables: [{ n: 1, cap: 2 }, { n: 2, cls: 'employee' }], guests: [{ ref: 'A', arrived: true, seat: [1, 1] }, { ref: 'B', arrived: true }, { ref: 'C', arrived: true }, { ref: 'D', arrived: true }, { ref: 'X' }] });
    const { lead } = run(db);
    assert.equal(codeOf(() => lead({ type: 'assign', guestId: 'g-B', tableId: 't1', seatNo: 1 })), 'seat_taken');
    assert.equal(codeOf(() => lead({ type: 'assign', guestId: 'g-B', tableId: 't2', seatNo: 1 })), 'not_eligible');
    assert.equal(codeOf(() => lead({ type: 'assign', guestId: 'g-X', tableId: 't1', seatNo: 2 })), 'not_eligible', 'check in before seating');
    lead({ type: 'assign', guestId: 'g-B', tableId: 't1', seatNo: 2 });
    assert.equal(codeOf(() => lead({ type: 'assign', guestId: 'g-C', tableId: 't1', seatNo: 2 })), 'no_eligible_seat');
    assert.equal(codeOf(() => lead({ type: 'assign', guestId: 'g-B', tableId: 't1', seatNo: 2 })), 'guest_moved', 'a guest seated meanwhile');
    clean(db);
  });
  test('GIVEN settings.seatNumbers preferred WHEN a preferred guest is assigned without a seatNo and a regular guest is assigned without one THEN the preferred assign is refused and the regular one succeeds', () => {
    const db = fixture({ settings: { seatNumbers: 'preferred' }, tables: [{ n: 1, cls: 'preferred' }, { n: 2 }], guests: [{ ref: 'P', cls: 'preferred', arrived: true }, { ref: 'R', arrived: true }] });
    const { lead, g } = run(db);
    assert.equal(codeOf(() => lead({ type: 'assign', guestId: 'g-P', tableId: 't1' })), 'http400');
    lead({ type: 'assign', guestId: 'g-R', tableId: 't2' });
    assert.equal(g('R').seat.seatNo, null);
    // With 'all' (YEP: every chair is numbered), everyone needs one.
    const db2 = fixture({ settings: { seatNumbers: 'all' }, tables: [{ n: 2 }], guests: [{ ref: 'R', arrived: true }] });
    assert.equal(codeOf(() => run(db2).lead({ type: 'assign', guestId: 'g-R', tableId: 't2' })), 'http400');
  });
  test('GIVEN a seated guest WHEN transfer targets a full table and when swap exchanges two guests THEN the failed transfer leaves the old seat in place and the swap moves both or neither, with counts correct', () => {
    const full = Array.from({ length: 2 }, (_, i) => ({ ref: `F${i}`, arrived: true, seat: [2, i + 1] }));
    const db = fixture({ tables: [{ n: 1 }, { n: 2, cap: 2 }, { n: 3, cls: 'employee' }], guests: [{ ref: 'A', arrived: true, seat: [1, 5] }, ...full, { ref: 'E', cls: 'employee', arrived: true, seat: [3, 1] }] });
    const { lead, g } = run(db);
    assert.equal(codeOf(() => lead({ type: 'transfer', guestId: 'g-A', tableId: 't2', seatNo: 1 })), 'table_full');
    assert.deepEqual([g('A').seat.tableId, g('A').seat.seatNo], ['t1', 5], 'the old seat is kept');
    lead({ type: 'transfer', guestId: 'g-A', tableId: 't1', seatNo: 6 });
    assert.equal(g('A').seat.seatNo, 6, 'a move within a table');
    lead({ type: 'swap', guestIds: ['g-A', 'g-F0'] });
    assert.deepEqual([g('A').seat.tableId, g('A').seat.seatNo, g('F0').seat.tableId, g('F0').seat.seatNo], ['t2', 1, 't1', 6]);
    assert.equal(claimsAt('t1', db.data.caGuests), 1);
    assert.equal(claimsAt('t2', db.data.caGuests), 2);
    // A swap one side of which is not allowed moves neither.
    assert.equal(codeOf(() => lead({ type: 'swap', guestIds: ['g-A', 'g-E'] })), 'not_eligible');
    assert.deepEqual([g('A').seat.tableId, g('E').seat.tableId], ['t2', 't3']);
    // Unseat sends a seated guest back to waiting.
    lead({ type: 'unseat', guestId: 'g-F1' });
    assert.equal(g('F1').seat, null);
    assert.equal(g('F1').arrival.state, 'checked_in');
    clean(db);
  });
  test('the guest page check-in (Tier 1) uses the same commit and is refused while self check-in is closed', () => {
    const db = fixture({ guests: [{ ref: 'A' }] });
    const ctx = newCtx(db);
    const self = (cmd) => commitAs(ctx, 'ev1', { synthetic: 'self' }, cmd);
    assert.equal(codeOf(() => self({ type: 'selfCheckIn', guestId: 'g-A' })), 'registration_closed');
    db.data.caEvents[0].flags.registrationOpen = true;
    self({ type: 'selfCheckIn', guestId: 'g-A' });
    assert.equal(db.data.caGuests[0].arrival.via, 'qr');
    assert.equal(self({ type: 'selfCheckIn', guestId: 'g-A' }).unchanged, true, 'a second check-in from a phone changes nothing');
    assert.equal(codeOf(() => self({ type: 'assign', guestId: 'g-A', tableId: 't1' })), 'http400', 'the guest page can only check in');
  });
});
