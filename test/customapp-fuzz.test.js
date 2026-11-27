// CUSTOM APP → events: seeded random command sequences (US-013, AC-079). Random actors (the Super
// Administrator, two staff, a CORE administrator), random guests and tables, wrong scopes and stale
// revisions, over reserved and confirmed seats. After every step every invariant holds, no seat is a
// hold or lapses, a seat is only ever cleared by a release or an unseat, and every refusal is from
// the catalogue (or a 400 for input that makes no sense). FUZZ_SEEDS raises the count (1,000 at the
// freeze); a failure prints its seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, newCtx, commitAs, USERS } from './support/customapp-kit.js';
import { checkInvariants } from '../shared/customapp/invariants.js';
import { REFUSALS } from '../shared/customapp/refusals.js';
import { SEAT_STATUSES } from '../shared/customapp/statuses.js';

const SEEDS = Number(process.env.FUZZ_SEEDS) || 200;
const STEPS = 70;
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 2 ** 32);
}

function world(rand) {
  const tables = [
    { n: 1, cls: 'preferred', owner: 'sam', cap: 4 }, { n: 2, cls: 'regular', owner: 'sam', cap: 3 }, { n: 3, cls: 'regular', owner: 'tess', cap: 4 },
    { n: 4, cls: 'regular', cap: 2 }, { n: 5, cls: 'employee', owner: 'tess', cap: 3 }, { n: 6, cls: 'mixed', cap: 2 },
  ];
  const owners = [null, 'sam', 'tess'];
  const guests = Array.from({ length: 22 }, (_, i) => {
    const cls = i < 5 ? 'preferred' : i > 18 ? 'employee' : 'regular';
    return { ref: `F${i}`, cls, owner: owners[Math.floor(rand() * 3)], arrived: rand() < 0.3, seat: cls === 'preferred' && i < 4 ? [1, i + 1, 'reserved'] : null };
  });
  for (const g of guests) if (g.seat && g.arrived) g.seat[2] = 'confirmed';
  return fixture({ tables, guests, settings: { mixedTables: rand() < 0.5, releaseDelegable: rand() < 0.3, seatNumbers: rand() < 0.7 ? 'all' : 'preferred' } });
}

function randomCommand(rand, db) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const g = () => pick(db.data.caGuests).id;
  const t = () => pick(db.data.caTables).id;
  const seat = () => (rand() < 0.1 ? null : 1 + Math.floor(rand() * 4));
  const kinds = [
    () => ({ type: 'checkIn', guestId: g() }),
    () => ({ type: 'checkIn', guestId: g() }),
    () => ({ type: 'undoCheckIn', guestId: g() }),
    () => ({ type: 'assign', guestId: g(), tableId: t(), seatNo: seat() }),
    () => ({ type: 'assign', guestId: g(), tableId: t(), seatNo: seat() }),
    () => ({ type: 'assign', placements: [{ guestId: g(), tableId: t(), seatNo: seat() }, { guestId: g(), tableId: t(), seatNo: seat() }] }),
    () => ({ type: 'transfer', guestId: g(), tableId: t(), seatNo: seat() }),
    () => ({ type: 'swap', guestIds: [g(), g()] }),
    () => ({ type: 'unseat', guestId: g(), reason: 'fuzz' }),
    () => ({ type: 'reserve', guestId: g(), tableId: t(), seatNo: seat() }),
    () => ({ type: 'release', guestId: g(), reason: rand() < 0.9 ? 'No-show' : '' }),
    () => ({ type: 'table.update', tableId: t(), capacity: 1 + Math.floor(rand() * 5) }),
    () => ({ type: 'table.update', tableId: t(), active: rand() < 0.6 }),
    () => ({ type: 'table.update', tableId: t(), classification: pick(['preferred', 'regular', 'employee', 'mixed']) }),
    () => ({ type: 'table.update', tableId: t(), ownerUserId: pick([null, USERS.sam.id, USERS.tess.id]) }),
    () => ({ type: 'table.relocate', fromTableId: t(), toTableId: t(), deactivate: rand() < 0.5 }),
    () => ({ type: 'guest.update', guestId: g(), ownerUserId: pick([null, USERS.sam.id, USERS.tess.id]) }),
    () => ({ type: 'guest.update', guestId: g(), classification: pick(['preferred', 'regular', 'employee']) }),
    () => ({ type: 'setFlag', flag: 'readOnly', value: rand() < 0.3 }),
    () => ({ type: 'event.update', settings: { mixedTables: rand() < 0.5 } }),
  ];
  const cmd = pick(kinds)();
  // A stale revision now and then, and a replayed opId now and then.
  if (rand() < 0.15 && cmd.guestId) cmd.expect = { [cmd.guestId]: Math.floor(rand() * 3) };
  cmd.opId = rand() < 0.05 ? 'replayed' : `op-${Math.floor(rand() * 1e9)}`;
  return cmd;
}

test('GIVEN 200 seeds WHEN random sequences of assign, check-in, release, transfer, swap, substitute, group, reclassify, deactivate and delegate run over reserved and confirmed guests with wrong scopes and stale revs THEN checkInvariants is [] after every step, no holds exist, nothing is released by expiry and every refusal is from the catalogue', () => {
  const tally = { ok: 0, refused: 0, bad: 0, codes: new Set() };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const rand = rng(seed);
    const db = world(rand);
    const ctx = newCtx(db);
    const actors = [USERS.lead, USERS.lead, USERS.sam, USERS.tess, USERS.ada];
    for (let step = 0; step < STEPS; step++) {
      const actor = actors[Math.floor(rand() * actors.length)];
      const cmd = randomCommand(rand, db);
      const seatsBefore = new Map(db.data.caGuests.map((g) => [g.id, g.seat]));
      const where = `seed ${seed}, step ${step}: ${actor.username} ${JSON.stringify(cmd)}`;
      try {
        commitAs(ctx, 'ev1', actor, cmd);
        tally.ok++;
      } catch (err) {
        if (err.status === 400) tally.bad++;
        else {
          assert.ok(err.code && REFUSALS[err.code], `${where}: refused outside the catalogue: ${err.status} ${err.message}`);
          assert.equal(err.status, REFUSALS[err.code].status, where);
          tally.refused++;
          tally.codes.add(err.code);
        }
      }
      const state = { event: db.data.caEvents[0], tables: db.data.caTables, guests: db.data.caGuests };
      assert.deepEqual(checkInvariants(state), [], where);
      for (const g of db.data.caGuests) {
        if (g.seat) assert.ok(SEAT_STATUSES.includes(g.seat.status) && !('expiresAt' in g.seat), `${where}: ${g.ref} holds ${JSON.stringify(g.seat)}`);
        // A seat is cleared only by a release or an unseat, never by time.
        if (seatsBefore.get(g.id) && !g.seat) assert.ok(['release', 'unseat'].includes(db.data.caChanges.at(-1)?.type), `${where}: ${g.ref} lost a seat`);
      }
    }
  }
  assert.ok(tally.ok > SEEDS * 5, `enough changes were made (${tally.ok})`);
  if (process.env.FUZZ_REPORT) console.log(tally);
  for (const code of ['out_of_scope', 'needs_super_admin', 'table_full', 'seat_taken', 'not_eligible', 'stale', 'already_checked_in', 'read_only', 'table_has_claims', 'guest_moved']) assert.ok(tally.codes.has(code), `the fuzz never produced ${code}`);
});
