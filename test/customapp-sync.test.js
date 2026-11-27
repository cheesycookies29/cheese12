// CUSTOM APP → events: live sync by short poll (US-019): changes?since=<seq>, the server's pollMs,
// scoped boards, and the closed set of change kinds.
process.env.CUSTOMAPP_VERIFY_PAD_MS = '0';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { company, eventWith, openForGuests, pub } from './support/customapp-kit.js';
import { pollReply } from '../server/customapp/events/board.js';
import { CHANGE_TYPES, pollFor, POLL_FACTOR } from '../shared/customapp/statuses.js';
import { COMMAND_TYPES } from '../server/customapp/events/engine.js';

const ROWS = [
  ['R1', 'Ana', 'Cruz', 'Northbay Bank', 'Banking', 'ana@example.com', '0917 123 0003', 'regular', 'sam', '', ''],
  ['R2', 'Juan', 'Dela Cruz', 'Palengke', 'Retail', 'juan@example.com', '0917 123 0004', 'regular', 'tess', '', ''],
  ['R3', 'Liza', 'Ocampo', 'Palengke', 'Retail', 'liza@example.com', '0917 123 0005', 'regular', 'sam', '', ''],
];

describe('US-019: Live sync by short poll', () => {
  test('GIVEN a client at the current seq WHEN it calls changes?since=seq THEN the reply is seq, pollMs and unchanged true and no board is built', async () => {
    let built = 0;
    const ev = { seq: 7, flags: { pollMs: 2000 } };
    const r = pollReply(ev, '7', () => built++);
    assert.deepEqual(Object.keys(r).sort(), ['pollMs', 'seq', 'unchanged']);
    assert.equal(r.unchanged, true);
    assert.equal(built, 0, 'no board built when nothing changed');
    assert.ok(pollReply(ev, '6', () => ({ ok: 1 })).board);
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    const first = await c.as.sam('GET', `${e.base}/changes`);
    assert.ok(first.board && first.seq >= 1);
    const again = await c.as.sam('GET', `${e.base}/changes?since=${first.seq}`);
    assert.deepEqual([Object.keys(again).sort(), again.seq, again.unchanged], [['pollMs', 'seq', 'unchanged'], first.seq, true]);
  });

  test('GIVEN seq has moved WHEN an owner and a non-owner poll THEN each gets seq, pollMs and a board scoped by the access policy, with no contact fields for the non-owner', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    const before = (await c.as.sam('GET', `${e.base}/changes`)).seq;
    await e.cmd('tess', { type: 'checkIn', guestId: e.guest('R1').id });
    const own = await c.as.sam('GET', `${e.base}/changes?since=${before}`);
    assert.equal(own.seq, before + 1);
    assert.deepEqual(own.board.waiting.map((g) => g.ref), [e.guest('R1').ref], 'Sam\'s queue: his guest');
    assert.equal(own.board.waiting[0].mobile, '•••• 0003', 'the owner sees contact details, masked');
    const other = await c.as.tess('GET', `${e.base}/changes?since=${before}`);
    assert.deepEqual(other.board.waiting, [], 'not Tess\'s guest');
    // The room board: everyone's tables and chairs, but never contact details.
    await e.cmd('sam', { type: 'assign', guestId: e.guest('R1').id, tableId: e.tables[3], seatNo: 1 });
    const room = await c.as.tess('GET', `${e.base}/changes?tab=room`);
    const chair = room.board.tables.find((t) => t.number === 3).chairs[0];
    assert.deepEqual([chair.name, chair.company, chair.industry, chair.mine], ['Ana Cruz', 'Northbay Bank', 'Banking', false]);
    assert.doesNotMatch(JSON.stringify(room.board), /0917|example\.com|•••/, 'no contact field anywhere on the room board');
  });

  test('GIVEN a poll with wait=25 WHEN it is answered THEN it returns at once as if wait were absent', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    const seq = (await c.as.sam('GET', `${e.base}/changes`)).seq;
    const t0 = Date.now();
    const r = await c.as.sam('GET', `${e.base}/changes?since=${seq}&wait=25`);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(r.unchanged, true);
  });

  test('GIVEN a restored standby whose seq is behind the client\'s since WHEN the client polls THEN it receives a full board', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    const seq = (await c.as.sam('GET', `${e.base}/changes`)).seq;
    const r = await c.as.sam('GET', `${e.base}/changes?since=${seq + 50}`);
    assert.equal(r.seq, seq);
    assert.ok(r.board && Array.isArray(r.board.waiting));
  });

  test('GIVEN default pacing WHEN staff and guests poll and the Super Administrator raises pollMs THEN staff get 2 s, pending guests 4 s and seated guests 10 s with jitter, and 8 s guests / 4 s staff apply on the next reply with no deploy', async () => {
    process.env.CUSTOMAPP_VERIFY_PAD_MS = '0';
    assert.deepEqual({ ...POLL_FACTOR }, { staff: 1, pending: 2, seated: 5 });
    assert.equal(pollFor({ pollMs: 2000 }, 'staff', () => 0), 2000);
    assert.equal(pollFor({ pollMs: 2000 }, 'staff', () => 1), 2200, 'up to 10% jitter');
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    const code = await openForGuests(c, e);
    const within = (ms, base) => assert.ok(ms >= base && ms <= base * 1.1, `${ms} is ${base} ms plus jitter`);
    within((await c.as.sam('GET', `${e.base}/changes`)).pollMs, 2000);
    const t1 = (await pub(c, 'POST', `/api/public/event/${code}/verify`, { surname: 'Cruz', last4: '0003', elapsedMs: 3000 })).body;
    within(t1.pollMs, 4000);
    const t2 = (await pub(c, 'POST', `/api/public/event/${code}/verify`, { surname: 'Dela Cruz', last4: '0004', elapsedMs: 3000 })).body;
    await e.cmd('tess', { type: 'assign', guestId: e.guest('R2').id, tableId: e.tables[5], seatNo: 1 });
    within((await pub(c, 'GET', `/api/public/event/${code}/status`, {}, { headers: { 'x-event-token': t2.token } })).body.pollMs, 10000);
    // Under load: the switch, no deploy, on the very next reply.
    await e.cmd('lead', { type: 'setFlag', flag: 'pollMs', value: 4000 });
    within((await c.as.sam('GET', `${e.base}/changes`)).pollMs, 4000);
    within((await pub(c, 'GET', `/api/public/event/${code}/status`, {}, { headers: { 'x-event-token': t1.token } })).body.pollMs, 8000);
  });

  test('GIVEN staffer A\'s guests reallocated to B WHEN A polls next THEN A\'s queue no longer contains them', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    for (const r of ['R1', 'R3']) await e.cmd('sam', { type: 'checkIn', guestId: e.guest(r).id });
    const a = await c.as.sam('GET', `${e.base}/changes`);
    assert.equal(a.board.waiting.length, 2);
    await e.cmd('lead', { type: 'delegateGuests', fromUserId: c.ids.sam, ownerUserId: c.ids.tess });
    const next = await c.as.sam('GET', `${e.base}/changes?since=${a.seq}`);
    assert.deepEqual(next.board.waiting, []);
    // …and says where they went, so the screen greys them out before they leave.
    assert.deepEqual(next.board.movedAway.map((m) => [m.toName, m.byName]).sort(), [['Tess', 'Lead'], ['Tess', 'Lead']]);
    assert.equal((await c.as.tess('GET', `${e.base}/changes`)).board.waiting.length, 2);
  });

  test('GIVEN CHANGE_TYPES in shared/customapp/statuses.js WHEN any change record is written THEN its type is in the closed set', async () => {
    assert.ok(Object.isFrozen(CHANGE_TYPES));
    for (const t of COMMAND_TYPES) assert.ok(CHANGE_TYPES.includes(t) || ['guest.update', 'event.update'].includes(t), `${t} has a change kind`);
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    await openForGuests(c, e);
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('R1').id });
    await e.cmd('lead', { type: 'delegateTables', ids: [e.tables[6]], ownerUserId: c.ids.tess });
    for (const ch of c.db.data.caChanges) assert.ok(CHANGE_TYPES.includes(ch.type), ch.type);
    const src = (await import('node:fs')).readFileSync(new URL('../server/customapp/events/commit.js', import.meta.url), 'utf8');
    assert.match(src, /CHANGE_TYPES\.includes\(p\.type\)/, 'commit() refuses a kind outside the set');
  });
});
