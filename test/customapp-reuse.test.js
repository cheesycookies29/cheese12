// CUSTOM APP → events: the reuse proof (US-027). The engine is parameterised, not abstracted: an
// event is data. The acceptance-critical engine cases run unchanged over the event the build was made
// for (a 5 x 5 room of tables of 10, preferred, regular and employee tables, a chair for everyone)
// and over a second, different one, "Test Gala" (tables of 8, no employee tables, no chair numbers),
// both in the same CORE at once, and neither event sees or changes the other. No client's name is
// in server/customapp.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { company, csvOf } from './support/customapp-kit.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// An event made through the API like a real one: its room, its tables' types and owners, its guests.
async function makeEvent(c, { name, room, typeOf, seatNumbers, guests }) {
  const lead = c.as.lead;
  const ev = await c.admin('POST', '/api/customapp/events', { name, date: '2026-12-09', room, superAdminUserId: c.ids.lead, settings: { seatNumbers } });
  const base = `/api/customapp/events/${ev.id}`;
  let e = await lead('GET', base);
  e = await lead('PATCH', base, { rev: e.rev, staff: [{ userId: c.ids.sam }, { userId: c.ids.tess }] });
  for (const t of e.tables) {
    const classification = typeOf(t.number, e.tables.length);
    const ownerUserId = t.number <= 3 ? c.ids.sam : t.number === 4 ? c.ids.tess : null;
    assert.ok((await lead('POST', `${base}/commands`, { type: 'table.update', tableId: t.id, classification, ownerUserId })).ok);
  }
  const pv = await lead('POST', `${base}/import`, { format: 'csv', data: csvOf(guests) });
  assert.equal(pv.report.blocking, 0, JSON.stringify(pv.report));
  await lead('POST', `${base}/import/${pv.jobId}/apply`, {});
  const full = await lead('GET', base);
  const T = Object.fromEntries(full.tables.map((t) => [t.number, t]));
  return {
    id: ev.id, base, full, T, cap: room.chairsPerTable, numbered: seatNumbers === 'all',
    g: (ref) => c.db.data.caGuests.find((x) => x.eventId === ev.id && x.externalKey === ref),
    cmd: (who, body) => c.as[who]('POST', `${base}/commands`, body),
  };
}
// The guest list: two preferred guests with reserved chairs at table 1 (one never arrives), and
// cap + 3 regular guests of Sam's.
const guestsFor = (cap) => [
  ['P1', 'Pia', 'Santos', 'Northbay', '', 'p1@example.com', '0917 100 0001', 'preferred', 'sam', '1', '1'],
  ['P2', 'Pedro', 'Reyes', 'Northbay', '', 'p2@example.com', '0917 100 0002', 'preferred', 'sam', '1', '2'],
  ...Array.from({ length: cap + 3 }, (_, i) => [`R${i + 1}`, `Ren${i}`, `Guest${String.fromCharCode(65 + i)}`, 'Acme', '', `r${i + 1}@example.com`, `0917 200 ${String(1000 + i)}`, 'regular', 'sam', '', '']),
];

// The acceptance-critical engine cases, the same code for both events. Tables: 1 preferred (Sam),
// 2 and 3 regular (Sam), 4 regular (Tess).
async function criticalCases(c, e) {
  const seat = (n) => (e.numbered ? n : undefined);
  const claims = (n) => c.db.data.caGuests.filter((g) => g.seat?.tableId === e.T[n].id).length;
  const R = (i) => e.g(`R${i}`).id;
  const seatOf = (id) => c.db.data.caGuests.find((g) => g.id === id).seat;
  // Check-in once (a second is refused); a preferred guest's reservation is retrieved.
  assert.ok((await e.cmd('sam', { type: 'checkIn', guestId: R(1) })).ok);
  assert.equal((await e.cmd('tess', { type: 'checkIn', guestId: R(1) })).code, 'already_checked_in');
  const pref = await e.cmd('sam', { type: 'checkIn', guestId: e.g('P1').id });
  assert.deepEqual([pref.route, pref.seat.number], ['seated', 1]);
  // The reservation of a guest who has not arrived counts: table 1 has two claims.
  assert.equal(claims(1), 2);
  // Fill table 2 to its last chair.
  for (let i = 1; i <= e.cap - 1; i++) {
    if (i > 1) await e.cmd('sam', { type: 'checkIn', guestId: R(i) });
    assert.ok((await e.cmd('sam', { type: 'assign', guestId: R(i), tableId: e.T[2].id, seatNo: seat(i) })).ok, `R${i}`);
  }
  // The last chair: two requests at once, exactly one wins; the other is told the table filled.
  for (const i of [e.cap, e.cap + 1]) await e.cmd('sam', { type: 'checkIn', guestId: R(i) });
  const [a, b] = await Promise.all([R(e.cap), R(e.cap + 1)].map((id) => e.cmd('sam', { type: 'assign', guestId: id, tableId: e.T[2].id, seatNo: seat(e.cap) })));
  assert.equal([a, b].filter((x) => x.ok).length, 1, 'one of two wins the last chair');
  assert.equal([a, b].find((x) => !x.ok).code, 'table_full');
  assert.equal(claims(2), e.cap, 'never over the table');
  // A transfer to the full table is refused, and the guest keeps the seat they had.
  const loser = a.ok ? R(e.cap + 1) : R(e.cap);
  assert.ok((await e.cmd('sam', { type: 'assign', guestId: loser, tableId: e.T[3].id, seatNo: seat(1) })).ok);
  assert.equal((await e.cmd('sam', { type: 'transfer', guestId: loser, tableId: e.T[2].id, seatNo: seat(2) })).code, 'table_full');
  assert.equal(seatOf(loser).tableId, e.T[3].id, 'kept until a new seat is secured');
  // A group is all or nothing: two guests for a table with one free chair.
  await e.cmd('lead', { type: 'table.update', tableId: e.T[3].id, capacity: 2 });
  const pair = [R(e.cap + 2), R(e.cap + 3)];
  for (const id of pair) await e.cmd('sam', { type: 'checkIn', guestId: id });
  const g = await e.cmd('sam', { type: 'assign', placements: pair.map((id) => ({ guestId: id, tableId: e.T[3].id, seatNo: seat(2) })) });
  assert.equal(g.code, 'table_full');
  assert.ok(pair.every((id) => !seatOf(id)), 'none of the group is seated');
  // Out of scope: Tess cannot seat Sam's guest, at her table or his.
  assert.equal((await e.cmd('tess', { type: 'assign', guestId: pair[0], tableId: e.T[4].id, seatNo: seat(1) })).code, 'out_of_scope');
  // A substitute: refused for an invitee who is here; for one who is not, the seat changes hands.
  assert.equal((await e.cmd('lead', { type: 'substitute', originalId: e.g('P1').id, newGuest: { last: 'Other' } })).code, 'already_checked_in');
  const s = await e.cmd('lead', { type: 'substitute', originalId: e.g('P2').id, newGuest: { first: 'Juan', last: 'Reyes' }, note: 'Here instead' });
  assert.ok(s.ok, JSON.stringify(s));
  assert.equal(seatOf(e.g('P2').id), null);
  assert.deepEqual([seatOf(s.guestId).tableId, seatOf(s.guestId).seatNo], [e.T[1].id, 2]);
  assert.equal(claims(1), 2, 'still two claims at table 1: no double allocation');
  assert.deepEqual((await c.as.lead('GET', `${e.base}/invariants`)).violations, [], 'every rule holds');
}

describe('US-027: Tier 2 acceptance, reuse proof and the 5 Dec client demo', () => {
  test('GIVEN the YEP event and a Test Gala event (capacity 8, no employee tables, no seat numbers) WHEN the acceptance-critical engine cases run on both THEN both pass and neither event sees the other\'s data', async () => {
    const c = await company();
    // The event the build was made for: 5 x 5 tables of 10, stage on the right; 1-3 preferred, 22-25 employee.
    const big = await makeEvent(c, { name: 'Year-End Party', room: { rows: 5, cols: 5, chairsPerTable: 10, stageSide: 'right' }, typeOf: (n) => (n === 1 ? 'preferred' : n >= 22 ? 'employee' : 'regular'), seatNumbers: 'all', guests: guestsFor(10) });
    // A second, different event in the same CORE: 2 x 3 tables of 8, stage at the top, no employee tables, no chair numbers.
    const gala = await makeEvent(c, { name: 'Test Gala', room: { rows: 2, cols: 3, chairsPerTable: 8, stageSide: 'top' }, typeOf: (n) => (n === 1 ? 'preferred' : 'regular'), seatNumbers: 'none', guests: guestsFor(8) });
    assert.equal(gala.full.tables.length, 6);
    assert.ok(gala.full.tables.every((t) => t.capacity === 8 && t.classification !== 'employee'));
    assert.equal(big.full.tables.length, 25);
    const snap = (e) => JSON.stringify([c.db.data.caGuests.filter((g) => g.eventId === e.id), c.db.data.caTables.filter((t) => t.eventId === e.id), c.db.data.caChanges.filter((x) => x.eventId === e.id), c.db.data.caEvents.find((x) => x.id === e.id)]);
    // Each event's cases leave the other exactly as it was.
    const galaBefore = snap(gala);
    await criticalCases(c, big);
    assert.equal(snap(gala), galaBefore, 'the Test Gala is untouched by the first event\'s commands');
    const bigBefore = snap(big);
    await criticalCases(c, gala);
    assert.equal(snap(big), bigBefore, 'and the other way round');
    // No chair numbers at the Test Gala (only the preferred guests' reserved ones).
    assert.ok(c.db.data.caGuests.filter((g) => g.eventId === gala.id && g.seat && g.classification === 'regular').every((g) => g.seat.seatNo == null));
    // Isolation by id: a guest or table of one event is not part of the other.
    await big.cmd('sam', { type: 'checkIn', guestId: big.g('R13').id }).catch(() => {});
    const cross = await gala.cmd('lead', { type: 'assign', guestId: big.g('R13').id, tableId: gala.T[2].id });
    assert.equal(cross.status, 400, 'another event\'s guest is not on this list');
    const crossT = await big.cmd('lead', { type: 'transfer', guestId: big.g('R1').id, tableId: gala.T[3].id, seatNo: 1 });
    assert.equal(crossT.status, 400, 'another event\'s table is not in this event');
    assert.equal((await c.as.lead('GET', `${gala.base}/guests/${big.g('R1').id}`)).status, 404);
    const found = (await c.as.lead('GET', `${gala.base}/guests?q=Guest&limit=300`)).guests;
    assert.ok(found.length && found.every((g) => c.db.data.caGuests.find((x) => x.id === g.id).eventId === gala.id), 'search stays in its event');
    // Each its own change numbers, exports and counts.
    const [eb, eg] = [await c.as.lead('GET', `${big.base}/export.json`), await c.as.lead('GET', `${gala.base}/export.json`)];
    assert.ok(eb.guests.every((g) => !eg.guests.some((x) => x.id === g.id)));
    assert.ok(eb.changes.every((x) => x.eventId === big.id) && eg.changes.every((x) => x.eventId === gala.id));
    assert.notEqual(eb.seq, eg.seq);
    const list = (await c.as.lead('GET', '/api/customapp/events')).events;
    assert.deepEqual(list.map((x) => x.name).sort(), ['Test Gala', 'Year-End Party']);
    assert.equal(list.find((x) => x.name === 'Test Gala').counts.capacity, 6 * 8 - 6, 'six tables of 8, one made a table of 2 in the cases');
  });

  test('GIVEN server/customapp WHEN it is searched for YEP strings THEN none is found', () => {
    const files = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.(js|mjs|json|html)$/.test(f.name)) files.push(p);
      }
    };
    walk(path.join(ROOT, 'server', 'customapp'));
    assert.ok(files.length >= 10, 'the module\'s files');
    const BAD = /\bYEP\b|\byep[-_ ]?(20)?2?6\b|\bLegati\b|\bICD\b|year[- ]end party/i;
    const hits = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => BAD.test(l)));
    assert.deepEqual(hits.map(([f, n, l]) => `${path.relative(ROOT, f)}:${n}: ${l.trim()}`), []);
  });
});
