// CUSTOM APP → events: the client's acceptance scenarios (spec section 07), one named test each, the
// evidence pack for the 5 Dec demo. Tier 0 (1 Dec) rows: preferred guest / no-show, manual
// alternative / all tables full, duplicate / simultaneous check-in, last available seat, and
// transfer / swap / release. The other seven rows land with Tier 1 and Tier 2.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { company, eventWith } from './support/customapp-kit.js';

const counts = async (c, e) => Object.fromEntries((await c.as.lead('GET', e.base)).tables.map((t) => [t.number, { claims: t.claims, confirmed: t.confirmed, reserved: t.reserved, free: t.free }]));
const clean = async (c, e) => assert.deepEqual((await c.as.lead('GET', `${e.base}/invariants`)).violations, []);

describe('US-013: Tier 0 proof suite: fuzz, race and the Tier 0 acceptance rows', () => {
  test('GIVEN a preferred guest with a reservation WHEN they arrive, when they do not arrive, and when they arrive after a manual release THEN the reservation is retrieved, stays blocked until released, and the late arrival is referred', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: [
      ['P1', 'Maria', 'Santos', 'Bank', '', 'p1@example.com', '0917 000 0001', 'preferred', 'sam', '1', '4'],
      ['P2', 'Jose', 'Reyes', 'Bank', '', 'p2@example.com', '0917 000 0002', 'preferred', 'sam', '1', '5'],
      ['P3', 'Ana', 'Cruz', 'Bank', '', 'p3@example.com', '0917 000 0003', 'preferred', 'sam', '1', '6'],
    ] });
    // Arrives: the existing assignment is retrieved.
    const r = await e.cmd('tess', { type: 'checkIn', guestId: e.guest('P1').id });
    assert.deepEqual([r.route, r.seat.number, r.seat.seatNo], ['seated', 1, 4]);
    assert.equal(e.guest('P1').seat.status, 'confirmed');
    // Does not arrive: the chair stays blocked; nobody else gets it, and no time releases it.
    await e.cmd('lead', { type: 'table.update', tableId: e.tables[1], ownerUserId: c.ids.sam });
    const x = (await c.as.lead('POST', `${e.base}/import`, { format: 'csv', data: 'Ref,First name,Surname,Classification\nP9,Late,Comer,preferred' })).jobId;
    await c.as.lead('POST', `${e.base}/import/${x}/apply`, {});
    await e.cmd('lead', { type: 'checkIn', guestId: e.guest('P9').id });
    assert.equal((await e.cmd('lead', { type: 'assign', guestId: e.guest('P9').id, tableId: e.tables[1], seatNo: 5 })).code, 'seat_taken');
    assert.equal(e.guest('P2').seat.status, 'reserved');
    assert.equal((await e.cmd('sam', { type: 'release', guestId: e.guest('P2').id, reason: 'No-show' })).code, 'needs_super_admin', 'released only by the Super Administrator (releaseDelegable is off)');
    // A manual release by the Super Administrator, then the late arrival is referred.
    assert.ok((await e.cmd('lead', { type: 'release', guestId: e.guest('P2').id, reason: 'No-show at 8 PM' })).ok);
    const late = await e.cmd('sam', { type: 'checkIn', guestId: e.guest('P2').id });
    assert.equal(late.route, 'super_admin');
    assert.equal((await e.cmd('sam', { type: 'assign', guestId: e.guest('P2').id, tableId: e.tables[1], seatNo: 7 })).code, 'needs_super_admin');
    assert.ok((await c.as.sam('GET', `${e.base}/guests/${e.guest('P2').id}`)).releasedNeedsSuper);
    assert.ok((await e.cmd('lead', { type: 'assign', guestId: e.guest('P2').id, tableId: e.tables[1], seatNo: 7 })).ok);
    await clean(c, e);
  });

  test('GIVEN a staffer choosing a non-recommended eligible table and an event with every eligible table full WHEN they assign THEN the alternative succeeds within authority and capacity and the full case allocates nothing and refers to the Super Administrator', async () => {
    const c = await company();
    const e = await eventWith(c, { room: { rows: 1, cols: 5, chairsPerTable: 2, stageSide: 'right' }, rows: [
      ['A', 'Ann', 'One', 'X', '', 'a@example.com', '0917 000 0001', 'regular', 'sam', '', ''],
      ['B', 'Ben', 'Two', 'X', '', 'b@example.com', '0917 000 0002', 'regular', 'sam', '', ''],
      ['C', 'Cy', 'Three', 'X', '', 'c@example.com', '0917 000 0003', 'regular', 'sam', '', ''],
      ['D', 'Di', 'Four', 'X', '', 'd@example.com', '0917 000 0004', 'regular', 'sam', '', ''],
      ['F', 'Fe', 'Five', 'X', '', 'f@example.com', '0917 000 0005', 'regular', 'sam', '', ''],
    ] });
    for (const r of ['A', 'B', 'C', 'D', 'F']) await e.cmd('sam', { type: 'checkIn', guestId: e.guest(r).id });
    // Sam owns tables 3 and 4 (regular); either is a valid choice, whatever a ranking would say.
    assert.ok((await e.cmd('sam', { type: 'assign', guestId: e.guest('A').id, tableId: e.tables[4], seatNo: 2 })).ok, 'a non-first table, a non-first chair');
    assert.equal((await e.cmd('sam', { type: 'assign', guestId: e.guest('B').id, tableId: e.tables[5], seatNo: 1 })).code, 'out_of_scope', 'within authority only');
    await e.cmd('sam', { type: 'assign', guestId: e.guest('B').id, tableId: e.tables[4], seatNo: 1 });
    await e.cmd('sam', { type: 'assign', guestId: e.guest('C').id, tableId: e.tables[3], seatNo: 1 });
    await e.cmd('sam', { type: 'assign', guestId: e.guest('D').id, tableId: e.tables[3], seatNo: 2 });
    // Every regular chair in the event is taken: nothing is allocated, the staffer is told to refer.
    const before = JSON.stringify(c.db.data.caGuests);
    const r = await e.cmd('sam', { type: 'assign', guestId: e.guest('F').id, tableId: e.tables[3], seatNo: 1 });
    assert.equal(r.code, 'no_eligible_seat');
    assert.deepEqual(r.fresh.options, []);
    assert.equal(JSON.stringify(c.db.data.caGuests), before, 'nothing allocated');
    await clean(c, e);
  });

  test('GIVEN one guest WHEN two devices check them in and seat them at the same time THEN there is one registration and one allocation', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: [['A', 'Ann', 'One', 'X', '', 'a@example.com', '0917 000 0001', 'regular', 'sam', '', '']] });
    const id = e.guest('A').id;
    const ins = await Promise.all([e.cmd('sam', { type: 'checkIn', guestId: id }), e.cmd('tess', { type: 'checkIn', guestId: id }), e.cmd('lead', { type: 'checkIn', guestId: id })]);
    assert.equal(ins.filter((r) => r.ok).length, 1);
    assert.ok(ins.filter((r) => !r.ok).every((r) => r.code === 'already_checked_in'));
    const seats = await Promise.all([e.cmd('sam', { type: 'assign', guestId: id, tableId: e.tables[3], seatNo: 1 }), e.cmd('lead', { type: 'assign', guestId: id, tableId: e.tables[4], seatNo: 2 })]);
    assert.equal(seats.filter((r) => r.ok).length, 1);
    assert.equal(seats.find((r) => !r.ok).code, 'guest_moved');
    assert.equal(c.db.data.caChanges.filter((x) => x.type === 'checkIn' && x.guestIds.includes(id)).length, 1, 'one registration');
    assert.equal(c.db.data.caGuests.filter((g) => g.seat && g.id === id).length, 1, 'one allocation');
    await clean(c, e);
  });

  test('GIVEN one seat left WHEN two staff assign different guests at once THEN one succeeds and the other gets 409 table_full with fresh options', async () => {
    const c = await company();
    const holders = Array.from({ length: 9 }, (_, i) => [`H${i}`, 'Held', `Holder${i}`, 'X', '', '', `0917 000 ${1000 + i}`, 'regular', '', '3', String(i + 1)]);
    const e = await eventWith(c, { rows: [...holders, ['S', 'Sam', 'Guest', 'X', '', 's@example.com', '0918 000 0001', 'regular', 'sam', '', ''], ['L', 'Lea', 'Guest', 'X', '', 'l@example.com', '0918 000 0002', 'regular', '', '', '']] });
    // Table 3 is Sam's; the Super Administrator can seat anyone anywhere. One chair left there.
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('S').id });
    await e.cmd('lead', { type: 'checkIn', guestId: e.guest('L').id });
    const both = await Promise.all([
      e.cmd('sam', { type: 'assign', guestId: e.guest('S').id, tableId: e.tables[3], seatNo: 10 }),
      e.cmd('lead', { type: 'assign', guestId: e.guest('L').id, tableId: e.tables[3], seatNo: 10 }),
    ]);
    assert.equal(both.filter((r) => r.ok).length, 1);
    const lost = both.find((r) => !r.ok);
    assert.equal(lost.status, 409);
    assert.equal(lost.code, 'table_full');
    assert.ok(lost.fresh.options.length > 0 && lost.fresh.options.every((o) => o.free > 0), 'fresh options: tables with room');
    assert.equal(lost.fresh.tables.find((t) => t.id === e.tables[3]).free, 0);
    assert.equal((await counts(c, e))[3].claims, 10);
    await clean(c, e);
  });

  test('GIVEN seated and reserved guests WHEN transfer, swap and release run THEN every affected count is right, nothing is overbooked and no assignment is lost', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: [
      ['P1', 'Pia', 'One', 'X', '', 'p1@example.com', '0917 000 0001', 'preferred', '', '1', '1'],
      ['P2', 'Pio', 'Two', 'X', '', 'p2@example.com', '0917 000 0002', 'preferred', '', '2', '1'],
      ['R1', 'Ria', 'Three', 'X', '', 'r1@example.com', '0917 000 0003', 'regular', '', '3', '1'],
      ['R2', 'Rio', 'Four', 'X', '', 'r2@example.com', '0917 000 0004', 'regular', '', '', ''],
    ] });
    await e.cmd('lead', { type: 'checkIn', guestId: e.guest('P1').id });
    await e.cmd('lead', { type: 'checkIn', guestId: e.guest('R2').id });
    await e.cmd('lead', { type: 'assign', guestId: e.guest('R2').id, tableId: e.tables[4], seatNo: 3 });
    let n = await counts(c, e);
    assert.deepEqual([n[1].confirmed, n[2].reserved, n[3].reserved, n[4].confirmed], [1, 1, 1, 1]);
    // Transfer: R2 from table 4 to table 3; both counts move together.
    await e.cmd('lead', { type: 'transfer', guestId: e.guest('R2').id, tableId: e.tables[3], seatNo: 2 });
    n = await counts(c, e);
    assert.deepEqual([n[3].claims, n[4].claims], [2, 0]);
    // Swap: P1 (seated) and P2 (reserved) change tables; statuses go with the guests.
    await e.cmd('lead', { type: 'swap', guestIds: [e.guest('P1').id, e.guest('P2').id] });
    n = await counts(c, e);
    assert.deepEqual([n[1].reserved, n[1].confirmed, n[2].confirmed, n[2].reserved], [1, 0, 1, 0]);
    assert.deepEqual([e.guest('P1').seat.tableId, e.guest('P2').seat.tableId], [e.tables[2], e.tables[1]]);
    // A transfer to a full table fails and keeps the old seat (no lost assignment).
    await e.cmd('lead', { type: 'table.update', tableId: e.tables[4], capacity: 1 });
    await e.cmd('lead', { type: 'reserve', guestId: e.guest('R1').id, tableId: e.tables[4], seatNo: 1 }).then((r) => assert.equal(r.code, 'guest_moved', 'R1 already holds a seat'));
    const r = await e.cmd('lead', { type: 'transfer', guestId: e.guest('R1').id, tableId: e.tables[3], seatNo: 2 });
    assert.equal(r.code, 'seat_taken');
    assert.equal(e.guest('R1').seat.tableId, e.tables[3]);
    // Release: the reservation goes, the count drops by one, nothing else moves.
    await e.cmd('lead', { type: 'release', guestId: e.guest('P2').id, reason: 'Sent regrets' });
    n = await counts(c, e);
    assert.deepEqual([n[1].claims, n[1].free, n[2].claims, n[3].claims], [0, 10, 1, 2]);
    const all = Object.values(n);
    assert.ok(all.every((t) => t.claims <= t.claims + t.free), 'never overbooked');
    assert.equal(c.db.data.caGuests.filter((g) => g.seat).length, 3, 'P1, R1, R2 still seated');
    await clean(c, e);
  });
});

// Tier 1 (3 Dec) rows: regular guest / no match, unauthorised cross-scope action, ownership
// reallocation / staff absent.
describe('US-017 and US-018: Tier 1 acceptance rows', () => {
  const ROWS = [
    ['B1', 'Ana', 'Cruz', 'Northbay Bank', 'Banking', 'b1@example.com', '0917 000 0001', 'regular', 'sam', '', ''],
    ['B2', 'Ben', 'Lim', 'Isla Savings', 'Banking', 'b2@example.com', '0917 000 0002', 'regular', 'sam', '', ''],
    ['I1', 'Cora', 'Tan', 'Harbor Life', 'Insurance', 'i1@example.com', '0917 000 0003', 'regular', 'sam', '', ''],
    ['X1', 'Dan', 'Uy', 'Palengke', 'Retail', 'x1@example.com', '0917 000 0004', 'regular', 'tess', '', ''],
    ['T1', 'Eva', 'Go', 'Palengke', 'Retail', 't1@example.com', '0917 000 0005', 'regular', 'tess', '', ''],
  ];
  test('GIVEN a regular guest from Banking with and without Banking guests seated WHEN recommendations are requested THEN several eligible industry-ranked tables are offered, and other eligible tables when nothing matches', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS, room: { rows: 2, cols: 4, chairsPerTable: 10, stageSide: 'right' } });
    for (const r of ['B1', 'B2', 'I1']) await e.cmd('sam', { type: 'checkIn', guestId: e.guest(r).id });
    // No Banking guest seated anywhere: every eligible table is offered, in a stable order.
    const before = await c.as.lead('GET', `${e.base}/recommend?guestIds=${e.guest('B2').id}`);
    assert.ok(before.mine.length >= 3, 'several eligible tables');
    assert.ok(before.mine.every((r) => r.tier === 3), 'no industry match yet: the other eligible tables');
    // Seat a Banking guest at 4 and an Insurance guest (related) at 3: the ranking follows.
    await e.cmd('sam', { type: 'assign', guestId: e.guest('B1').id, tableId: e.tables[4], seatNo: 1 });
    await e.cmd('sam', { type: 'assign', guestId: e.guest('I1').id, tableId: e.tables[3], seatNo: 1 });
    const after = await c.as.lead('GET', `${e.base}/recommend?guestIds=${e.guest('B2').id}`);
    assert.deepEqual(after.mine.slice(0, 2).map((r) => [r.number, r.tier]), [[4, 1], [3, 2]]);
    assert.ok(after.mine.length > 2, 'other eligible tables are still offered');
    await clean(c, e);
  });

  test('GIVEN a staffer acting on a guest and a table outside their scope WHEN they assign THEN it is rejected, the Super Administrator can act or delegate, and no guest or table ever has two owners', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    await e.cmd('tess', { type: 'checkIn', guestId: e.guest('X1').id });
    const bad = await e.cmd('sam', { type: 'assign', guestId: e.guest('X1').id, tableId: e.tables[3], seatNo: 1 });
    assert.deepEqual([bad.status, bad.code], [403, 'out_of_scope']);
    const bad2 = await e.cmd('sam', { type: 'assign', guestId: e.guest('B1').id, tableId: e.tables[5], seatNo: 1 });
    assert.equal(bad2.code, 'not_eligible', 'B1 is not checked in');
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('B1').id });
    assert.equal((await e.cmd('sam', { type: 'assign', guestId: e.guest('B1').id, tableId: e.tables[5], seatNo: 1 })).code, 'out_of_scope', 'Tess\'s table');
    // The Super Administrator can act…
    assert.ok((await e.cmd('lead', { type: 'assign', guestId: e.guest('X1').id, tableId: e.tables[3], seatNo: 1 })).ok);
    // …or delegate: then the staffer can.
    await e.cmd('lead', { type: 'delegateTables', ids: [e.tables[5]], ownerUserId: c.ids.sam });
    assert.ok((await e.cmd('sam', { type: 'assign', guestId: e.guest('B1').id, tableId: e.tables[5], seatNo: 1 })).ok);
    const owners = [...c.db.data.caGuests, ...c.db.data.caTables].map((r) => r.ownerUserId);
    assert.ok(owners.every((o) => o === null || typeof o === 'string'), 'one owner field per guest and table');
    await clean(c, e);
  });

  test('GIVEN staffer A is absent with pending guests and confirmed seats WHEN the Super Administrator reallocates A\'s scope to B THEN B receives the pending queue, A loses write access and confirmed assignments are intact', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    for (const r of ['B1', 'B2', 'I1']) await e.cmd('sam', { type: 'checkIn', guestId: e.guest(r).id });
    await e.cmd('sam', { type: 'assign', guestId: e.guest('B1').id, tableId: e.tables[3], seatNo: 1 });
    const seat = JSON.stringify(e.guest('B1').seat);
    await e.cmd('lead', { type: 'delegateGuests', fromUserId: c.ids.sam, ownerUserId: c.ids.tess, reason: 'Sam is absent' });
    await e.cmd('lead', { type: 'delegateTables', fromUserId: c.ids.sam, ownerUserId: c.ids.tess, reason: 'Sam is absent' });
    const tq = (await c.as.tess('GET', `${e.base}/changes`)).board;
    assert.deepEqual(tq.waiting.map((g) => g.ref).sort(), [e.guest('B2').ref, e.guest('I1').ref].sort(), 'B receives the pending queue');
    assert.deepEqual((await c.as.sam('GET', `${e.base}/changes`)).board.waiting, []);
    assert.equal((await e.cmd('sam', { type: 'assign', guestId: e.guest('B2').id, tableId: e.tables[3], seatNo: 2 })).code, 'out_of_scope', 'A loses write access');
    assert.ok((await e.cmd('tess', { type: 'assign', guestId: e.guest('B2').id, tableId: e.tables[3], seatNo: 2 })).ok);
    assert.equal(JSON.stringify(e.guest('B1').seat), seat, 'the confirmed assignment is intact');
    await clean(c, e);
  });
});
