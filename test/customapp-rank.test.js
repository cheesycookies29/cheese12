// CUSTOM APP → events: the recommendation engine (US-018): eligible(), recommend() and GET …/recommend.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { eligible, recommend, whyNot, classOK } from '../shared/customapp/seating.js';
import { company, eventWith } from './support/customapp-kit.js';

const IND = [{ id: 'bank', name: 'Banking', related: ['ins'] }, { id: 'ins', name: 'Insurance', related: ['bank'] }, { id: 'retail', name: 'Retail', related: [] }, { id: 'tech', name: 'Technology', related: [] }];
const ev = (settings = {}) => ({ industries: IND, settings: { mixedTables: false, ...settings } });
const T = (id, number, classification = 'regular', capacity = 10, extra = {}) => ({ id, number, classification, capacity, active: true, tags: [], ...extra });
let n = 0;
const at = (tableId, industryId, k = 1, status = 'confirmed') => Array.from({ length: k }, () => ({ id: `x${n++}`, industryId, classification: 'regular', seat: { tableId, seatNo: null, status } }));
const guest = (industryId = 'bank', classification = 'regular', extra = {}) => ({ id: `g${n++}`, industryId, classification, ...extra });

describe('US-018: Recommendation engine', () => {
  test('GIVEN preferred, regular, employee and unlisted guests, mixed tables on and off, a table with too few seats and an excluded tag WHEN eligible() is evaluated THEN only active tables of an allowed class with enough free seats and no exclusion are eligible', () => {
    const tables = [T('p', 1, 'preferred'), T('r', 2), T('e', 3, 'employee'), T('m', 4, 'mixed'), T('off', 5, 'regular', 10, { active: false }), T('small', 6, 'regular', 2), T('nopress', 7, 'regular', 10, { tags: ['no:press'] })];
    const guests = [...at('small', 'retail', 1)];
    const ok = (g, size = 1, settings) => tables.filter((t) => eligible(t, g, ev(settings), guests, { size })).map((t) => t.id);
    assert.deepEqual(ok(guest('bank', 'preferred')), ['p']);
    assert.deepEqual(ok(guest('bank', 'regular')), ['r', 'small', 'nopress']);
    assert.deepEqual(ok(guest('bank', 'employee')), ['e']);
    assert.deepEqual(ok(guest('bank', 'regular'), 1, { mixedTables: true }), ['r', 'm', 'small', 'nopress'], 'mixed only when the event turns mixed tables on');
    assert.deepEqual(ok(guest('bank', 'unlisted')), [], 'an unlisted guest sits nowhere until approved');
    assert.deepEqual(ok(guest('bank', 'unlisted', { approval: { state: 'approved', classification: 'employee' } })), ['e'], '…then by the class approved');
    assert.deepEqual(ok(guest('bank', 'regular'), 2), ['r', 'nopress'], 'a table with 1 free seat cannot take 2');
    assert.deepEqual(ok(guest('bank', 'regular', { tags: ['press'] })), ['r', 'small'], 'a "no:press" table keeps press guests away');
    assert.equal(whyNot(tables[4], [guest()], ev(), guests), 'inactive');
    assert.equal(whyNot(tables[0], [guest()], ev(), guests), 'class');
    assert.ok(classOK('mixed', guest(), true) && !classOK('mixed', guest(), false));
  });

  test('GIVEN tables with same-industry, related-industry and other guests WHEN recommend() ranks them THEN same beats related beats other, and within a tier group fit, then more same-industry companions, then fewer seats left, then table number decide', () => {
    const tables = [T('t1', 1), T('t2', 2), T('t3', 3), T('t4', 4), T('t5', 5), T('t6', 6), T('t7', 7)];
    const guests = [
      ...at('t1', 'retail', 3), // other: 7 free
      ...at('t2', 'ins', 2), // related: 8 free
      ...at('t3', 'bank', 1), // same, 1 companion, 9 free
      ...at('t4', 'bank', 3), // same, 3 companions
      ...at('t5', 'bank', 1), ...at('t5', 'retail', 4), // same, 1 companion, 5 free: fills a gap before t3
      ...at('t6', 'retail', 3), // other, 7 free: ties t1, number decides
    ];
    const r = recommend([guest('bank')], ev(), tables, guests);
    assert.deepEqual(r.map((x) => [x.number, x.tier]), [[4, 1], [5, 1], [3, 1], [2, 2], [1, 3], [6, 3], [7, 3]]);
    assert.deepEqual(r.find((x) => x.number === 4).reasons, ['Same industry: Banking, 3 of 3 seated', '6 seats left']);
    assert.deepEqual(r.find((x) => x.number === 2).reasons, ['Related: Insurance', '7 seats left']);
    assert.deepEqual(r.find((x) => x.number === 7).reasons, ['Empty table', '9 seats left']);
    // Deterministic: the same input, the same order.
    assert.deepEqual(recommend([guest('bank')], ev(), [...tables].reverse(), [...guests].reverse()).map((x) => x.number), r.map((x) => x.number));
    // A group of 6: only tables with 6 free chairs are ranked.
    assert.deepEqual(recommend([guest('bank'), guest('bank'), guest('bank'), guest('bank'), guest('bank'), guest('bank')], ev(), tables, guests).map((x) => x.number), [4, 3, 2, 1, 6, 7]);
  });

  test('GIVEN a full table and an ineligible table WHEN recommend() runs THEN neither is ever listed', () => {
    const tables = [T('full', 1), T('pref', 2, 'preferred'), T('ok', 3), T('off', 4, 'regular', 10, { active: false })];
    const guests = [...at('full', 'bank', 6), ...at('full', 'bank', 4, 'reserved')];
    assert.deepEqual(recommend([guest('bank')], ev(), tables, guests).map((x) => x.tableId), ['ok'], 'a full table (reservations count) and an ineligible one are never listed');
  });

  test('GIVEN a staffer with some tables WHEN GET .../recommend?guestIds= is called, and when nothing fits THEN results split into mine and othersReadOnly with tier, free, reasons and selectable, and nothing-fits returns none true and refer super_admin', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: [
      ['R1', 'Ana', 'Cruz', 'Northbay Bank', 'Banking', 'a@example.com', '0917 000 0001', 'regular', 'sam', '', ''],
      ['R2', 'Ben', 'Lim', 'Isla Savings', 'Banking', 'b@example.com', '0917 000 0002', 'regular', 'tess', '', ''],
      ['E1', 'Paolo', 'Tan', 'Host Co', '', 'p@example.com', '0917 000 0006', 'employee', 'sam', '', ''],
    ] });
    await e.cmd('tess', { type: 'checkIn', guestId: e.guest('R2').id });
    await e.cmd('tess', { type: 'assign', guestId: e.guest('R2').id, tableId: e.tables[5], seatNo: 1 });
    const r = await c.as.sam('GET', `${e.base}/recommend?guestIds=${e.guest('R1').id}`);
    assert.deepEqual(r.mine.map((x) => x.number), [3, 4], 'Sam\'s tables 3 and 4');
    assert.deepEqual(r.othersReadOnly.map((x) => [x.number, x.tier]), [[5, 1]], 'Tess\'s table 5 has a Banking guest: ranked first, but not Sam\'s');
    for (const x of [...r.mine, ...r.othersReadOnly]) {
      assert.deepEqual(['tier', 'free', 'reasons', 'selectable'].filter((k) => !(k in x)), []);
      assert.equal(x.selectable, r.mine.includes(x));
    }
    assert.match(r.othersReadOnly[0].reasons[0], /^Same industry: Banking, 1 of 1 seated$/);
    // Nothing of Sam's fits an employee (the only employee table, 6, is nobody's).
    const none = await c.as.sam('GET', `${e.base}/recommend?guestIds=${e.guest('E1').id}`);
    assert.deepEqual([none.none, none.refer, none.mine.length, none.othersReadOnly.map((x) => x.number)], [true, 'super_admin', 0, [6]]);
    assert.ok((await c.as.lead('GET', `${e.base}/recommend?guestIds=${e.guest('E1').id}`)).mine.length, 'the Super Administrator may use every table');
  });
});
