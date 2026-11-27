// CUSTOM APP → events: the room plan's server side (US-031): GET …/room, choosing a chair through the
// same commands as the list, the last chair, scope on the plan, and the actions on an occupied chair.
// The drawing itself is checked in a browser (scripts/journeys.mjs, "Room model: …").
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { company, eventWith } from './support/customapp-kit.js';

const ROWS = [
  ['P1', 'Maria', 'Santos', 'Northbay Bank', 'Banking', 'p1@example.com', '0917 000 0001', 'preferred', '', '1', '4'],
  ['R1', 'Ana', 'Cruz', 'Northbay Bank', 'Banking', 'r1@example.com', '0917 000 0002', 'regular', 'sam', '', ''],
  ['R2', 'Ben', 'Lim', 'Isla Savings', 'Banking', 'r2@example.com', '0917 000 0003', 'regular', 'sam', '', ''],
  ['R3', 'Cora', 'Tan', 'Harbor Life', 'Insurance', 'r3@example.com', '0917 000 0004', 'regular', 'tess', '', ''],
];
async function setup() {
  const c = await company();
  const e = await eventWith(c, { rows: ROWS, room: { rows: 2, cols: 3, chairsPerTable: 10, stageSide: 'right', boothSide: 'left' } });
  return { c, e, room: (who) => c.as[who]('GET', `${e.base}/room`) };
}

describe('US-031: Interactive room model', () => {
  test('GIVEN two devices WHEN one seats a guest THEN the other plan shows it within one pollMs (AC-207, server side)', async () => {
    const { c, e, room } = await setup();
    const r = await room('sam');
    assert.deepEqual(r.room, { rows: 2, cols: 3, chairsPerTable: 10, stageSide: 'right', boothSide: 'left', numbering: 'from-stage' });
    assert.deepEqual(r.tables.map((t) => [t.number, t.row, t.col]), [[1, 0, 2], [2, 1, 2], [3, 0, 1], [4, 1, 1], [5, 0, 0], [6, 1, 0]], 'tables where they stand, numbered from the stage');
    assert.ok(r.tables.every((t) => t.chairs.length === 10 && t.chairs.every((ch, i) => ch.seatNo === i + 1)));
    const p1 = r.tables[0].chairs[3];
    assert.deepEqual([p1.taken, p1.status, p1.initials, p1.name, p1.mine], [true, 'reserved', 'MS', 'Maria Santos', false]);
    // Another device seats a guest; the next short poll of the plan (tab=room) carries it.
    const seq = (await c.as.sam('GET', `${e.base}/changes?tab=room`)).seq;
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('R1').id });
    await e.cmd('sam', { type: 'assign', guestId: e.guest('R1').id, tableId: e.tables[3], seatNo: 5 });
    const poll = await c.as.tess('GET', `${e.base}/changes?tab=room&since=${seq}`);
    assert.ok(poll.pollMs >= 2000 && poll.pollMs <= 2200);
    assert.equal(poll.board.tables.find((t) => t.number === 3).chairs[4].name, 'Ana Cruz');
  });

  test('assign a chair; last chair race (AC-210): Seat here sends one assign with tableId, seatNo and the revisions seen; a 409 carries the fresh state to redraw from', async () => {
    const { c, e, room } = await setup();
    for (const r of ['R1', 'R2']) await e.cmd('sam', { type: 'checkIn', guestId: e.guest(r).id });
    const t3 = (await room('sam')).tables.find((t) => t.number === 3);
    const g1 = e.guest('R1');
    const g2 = e.guest('R2');
    // Two devices choose chair 7 of table 3 at the same moment.
    const [a, b] = await Promise.all([
      e.cmd('sam', { type: 'assign', guestId: g1.id, tableId: t3.id, seatNo: 7, expect: { [g1.id]: g1.rev, [t3.id]: t3.rev } }),
      e.cmd('lead', { type: 'assign', guestId: g2.id, tableId: t3.id, seatNo: 7, expect: { [g2.id]: g2.rev, [t3.id]: t3.rev } }),
    ]);
    assert.ok(a.ok);
    assert.deepEqual([b.status, b.code], [409, 'seat_taken']);
    const fresh = b.fresh.tables.find((t) => t.id === t3.id);
    assert.deepEqual([fresh.taken, fresh.claims, fresh.free], [[7], 1, 9], 'the reply says which chair is taken now');
    assert.ok(b.fresh.options.length, 'and where there is room');
    // A table changed since the plan was drawn (its rev): stale, with the state as it is.
    await e.cmd('lead', { type: 'table.update', tableId: t3.id, capacity: 9 });
    const s = await e.cmd('lead', { type: 'assign', guestId: g2.id, tableId: t3.id, seatNo: 8, expect: { [g2.id]: e.guest('R2').rev, [t3.id]: t3.rev } });
    assert.equal(s.code, 'stale');
    assert.ok(s.fresh.tables.some((t) => t.id === t3.id));
  });

  test('scope on the plan (AC-211): a personnel member sees every table but chooses chairs only at their own; a forged request gets 403 out_of_scope', async () => {
    const { e, room } = await setup();
    const r = await room('sam');
    assert.equal(r.tables.length, 6, 'every table is shown');
    assert.deepEqual(r.tables.filter((t) => t.mine).map((t) => t.number), [3, 4]);
    assert.deepEqual(r.waiting, [], 'nobody of Sam\'s is waiting yet');
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('R1').id });
    assert.deepEqual((await room('sam')).waiting.map((g) => g.name), ['Ana Cruz']);
    assert.deepEqual((await room('tess')).waiting, [], 'not Tess\'s guest');
    assert.equal((await room('lead')).waiting.length, 1, 'the Super Administrator sees everyone waiting');
    const forged = await e.cmd('sam', { type: 'assign', guestId: e.guest('R1').id, tableId: e.tables[5], seatNo: 1 });
    assert.deepEqual([forged.status, forged.code], [403, 'out_of_scope']);
  });

  test('occupied chair actions (AC-212): a reserved chair is retrieved by Arrived: seat now; only the Super Administrator releases it; a seated guest is moved or sent back to waiting by the same commands as the list', async () => {
    const { c, e, room } = await setup();
    const p1 = e.guest('P1');
    await e.cmd('lead', { type: 'table.update', tableId: e.tables[1], ownerUserId: c.ids.sam });
    await e.cmd('lead', { type: 'guest.update', guestId: p1.id, ownerUserId: c.ids.sam });
    assert.equal((await e.cmd('sam', { type: 'release', guestId: p1.id, reason: 'No-show' })).code, 'needs_super_admin', 'Release: Super Administrator only while releaseDelegable is off');
    assert.ok((await e.cmd('sam', { type: 'checkIn', guestId: p1.id })).ok, 'Arrived: seat now');
    const chair = (await room('sam')).tables[0].chairs[3];
    assert.deepEqual([chair.status, chair.mine], ['confirmed', true]);
    assert.ok((await e.cmd('sam', { type: 'transfer', guestId: p1.id, tableId: e.tables[1], seatNo: 9 })).ok, 'Move');
    assert.equal((await room('sam')).tables[0].chairs[8].name, 'Maria Santos');
    assert.ok((await e.cmd('sam', { type: 'unseat', guestId: p1.id, reason: 'Sent back to waiting' })).ok, 'Back to waiting');
    assert.deepEqual((await room('sam')).waiting.map((g) => g.name), ['Maria Santos']);
    // Another reservation, released by the Super Administrator with a reason.
    await e.cmd('lead', { type: 'reserve', guestId: e.guest('R3').id, tableId: e.tables[5], seatNo: 2 });
    assert.equal((await room('lead')).tables.find((t) => t.number === 5).chairs[1].status, 'reserved');
    assert.ok((await e.cmd('lead', { type: 'release', guestId: e.guest('R3').id, reason: 'No-show at 8 PM' })).ok);
    assert.deepEqual((await c.as.lead('GET', `${e.base}/invariants`)).violations, []);
  });
});
