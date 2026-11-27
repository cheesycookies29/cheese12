// CUSTOM APP → events: the invariants (design A3) and the closed set of seat statuses. The checker
// must catch each rule broken by hand, or it would be a checker that never fails.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInvariants } from '../shared/customapp/invariants.js';
import { SEAT_STATUSES } from '../shared/customapp/statuses.js';
import { SEAT_STATUS_CLASS, claimsAt } from '../shared/customapp/seating.js';
import { fixture } from './support/customapp-kit.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateOf = (db) => ({ event: db.data.caEvents[0], tables: db.data.caTables, guests: db.data.caGuests });
const base = () => fixture({
  tables: [{ n: 1, owner: 'sam' }, { n: 2 }, { n: 3, cap: 4 }],
  guests: [{ ref: 'A', arrived: true, owner: 'sam', seat: [1, 1] }, { ref: 'B', seat: [1, 2, 'reserved'] }, { ref: 'C', arrived: true }, { ref: 'D' }],
});
const rules = (db, opts) => checkInvariants(stateOf(db), opts).map((v) => v.rule);

describe('US-007: commit() unit of work, claimsAt(), invariants and typed refusals', () => {
  test('GIVEN SEAT_STATUSES WHEN a status is added without a classification or any file other than seating.js counts by seat.status THEN the test fails', () => {
    assert.deepEqual([...SEAT_STATUSES], ['reserved', 'confirmed'], 'exactly two seat statuses, no holds (design decision log)');
    assert.ok(Object.isFrozen(SEAT_STATUSES));
    assert.deepEqual(Object.keys(SEAT_STATUS_CLASS).sort(), [...SEAT_STATUSES].sort(), 'every status is classified, and nothing else is');
    assert.ok(Object.values(SEAT_STATUS_CLASS).every((c) => c === 'claim'), 'every status takes a chair');
    // claimsAt counts whatever the status (even one that should never exist).
    assert.equal(claimsAt('t1', [{ seat: { tableId: 't1', status: 'reserved' } }, { seat: { tableId: 't1', status: 'confirmed' } }, { seat: { tableId: 't1', status: 'odd' } }]), 3);
    // Nowhere but seating.js is a seat counted or filtered by its status.
    const files = [
      ...fs.readdirSync(path.join(ROOT, 'server/customapp/events')).map((f) => `server/customapp/events/${f}`),
      'server/customapp/index.js', 'shared/customapp/invariants.js', 'shared/customapp/statuses.js', 'shared/customapp/room.js', 'shared/customapp/refusals.js', 'shared/customapp/time.js',
      'public/js/views/customapp.js',
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.doesNotMatch(src, /\.(filter|reduce|some|every|find|findIndex)\([^\n]*seat\??\.status\s*[!=]==/, `${f} counts seats by status: use shared/customapp/seating.js`);
      assert.doesNotMatch(src, /status\s*===?\s*'held'|'held'/, `${f}: there are no holds`);
    }
  });

  test('GIVEN a valid event state WHEN each of I1 to I10 is broken by hand THEN checkInvariants returns that rule with the ids involved', () => {
    assert.deepEqual(checkInvariants(stateOf(base())), [], 'the valid state is clean');
    const broken = (rule, mutate, opts) => {
      const db = base();
      mutate(db.data);
      const out = checkInvariants(stateOf(db), opts);
      const hit = out.find((v) => v.rule === rule);
      assert.ok(hit, `${rule} not caught: ${JSON.stringify(out)}`);
      assert.ok(hit.ids.length && hit.detail, `${rule} names what is wrong`);
      return hit;
    };
    const g = (d, ref) => d.caGuests.find((x) => x.ref === ref);
    // I1: more claims than chairs (a reserved seat counts), and a capacity over the hard limit.
    assert.deepEqual(broken('I1', (d) => {
      d.caTables[2].capacity = 1;
      g(d, 'C').seat = { tableId: 't3', seatNo: 1, status: 'confirmed' };
      g(d, 'D').seat = { tableId: 't3', seatNo: null, status: 'reserved' };
    }).ids, ['t3']);
    broken('I1', (d) => (d.caTables[1].capacity = 11));
    // I2: two seats for one guest.
    assert.deepEqual(broken('I2', (d) => (g(d, 'C').seat = [{ tableId: 't2', seatNo: 1 }, { tableId: 't3', seatNo: 1 }])).ids, ['g-C']);
    // I3: one chair held twice.
    assert.deepEqual(broken('I3', (d) => (g(d, 'C').seat = { tableId: 't1', seatNo: 1, status: 'confirmed' })).ids, ['g-A', 'g-C']);
    // I4: an owner who is not (or no longer) event staff.
    broken('I4', (d) => (d.caTables[1].ownerUserId = 'u-nobody'));
    broken('I4', (d) => (d.caEvents[0].staff[0].active = false));
    // I5: no Super Administrator, or two.
    broken('I5', (d) => (d.caEvents[0].superAdminUserId = null));
    broken('I5', (d) => (d.caEvents[0].superAdminUserId = ['u-lead', 'u-sam']));
    // I6: an invitee and their substitute both seated.
    assert.deepEqual(broken('I6', (d) => {
      g(d, 'B').substituteFor = 'g-A';
    }).ids, ['g-B', 'g-A']);
    // I7: an unknown arrival state, a check-in with no time, two records for one invitee.
    broken('I7', (d) => (g(d, 'D').arrival = { state: 'arrived twice' }));
    broken('I7', (d) => (g(d, 'D').arrival = { state: 'checked_in', at: null }));
    broken('I7', (d) => (g(d, 'D').externalKey = 'C'));
    // I8: a table out of use that still holds claims.
    assert.deepEqual(broken('I8', (d) => (d.caTables[0].active = false)).ids, ['t1']);
    // I9: a seat that is a hold, or that expires.
    broken('I9', (d) => (g(d, 'B').seat.status = 'held'));
    broken('I9', (d) => (g(d, 'B').seat.expiresAt = '2026-12-09T12:00:00Z'));
    // I10: a staffer's change touching a guest or table that is not theirs.
    broken('I10', () => {}, { write: { actor: { id: 'u-sam', role: 'staff' }, guests: [{ id: 'g-C', ownerUserId: null }], tables: [{ id: 't1', ownerUserId: 'u-sam' }] } });
    assert.deepEqual(rules(base(), { write: { actor: { id: 'u-lead', role: 'super' }, guests: [{ id: 'g-C', ownerUserId: null }] } }), [], 'the Super Administrator writes any');
  });
});
