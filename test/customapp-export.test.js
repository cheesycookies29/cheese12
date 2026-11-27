// CUSTOM APP → events: the export (US-012). One versioned JSON document, customapp.event/1, with the
// event's seq and a sha256 of itself, is the recovery copy; the CSV and the printable plan are made
// from it. The golden file pins the format: a change to it is a new version, not an edit.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, company, eventWith } from './support/customapp-kit.js';
import { exportEvent, exportHash, exportCsv, planHtml, EXPORT_FORMAT } from '../server/customapp/events/io.js';

const GOLDEN = new URL('./support/customapp-export-golden.json', import.meta.url);
const NOW = '2026-12-09T12:34:00.000Z';
function sample() {
  const db = fixture({
    tables: [{ n: 1, cls: 'preferred', owner: 'sam' }, { n: 2 }],
    guests: [
      { ref: 'TG-0001', first: 'Maria', last: 'Santos', cls: 'preferred', owner: 'sam', arrived: true, seat: [1, 4] },
      { ref: 'TG-0002', first: 'Jose', last: 'Reyes', cls: 'preferred', seat: [1, 5, 'reserved'] },
      { ref: 'TG-0003', first: 'Ana', last: 'Cruz', company: '=HYPERLINK("x")', arrived: true },
    ],
  });
  const d = db.data;
  d.caEvents[0].room = { rows: 1, cols: 2, chairsPerTable: 10, stageSide: 'right', boothSide: 'left', numbering: 'from-stage' };
  d.caTables.forEach((t, i) => Object.assign(t, { row: 0, col: 1 - i }));
  d.caEvents[0].seq = 7;
  d.caGuests[0].statusTokens = [{ hash: 'secret-token-hash', issuedAt: NOW }];
  d.caGuests[0].lookup = { surnames: ['santos'], m4: '4417' };
  d.caChanges = [{ seq: 7, eventId: 'ev1', at: NOW, actorId: 'u-lead', via: 'staff', type: 'assign', opId: 'op-7', h: 'abc', guestIds: ['g-TG-0001'], tableIds: ['t1'], diff: [{ id: 'g-TG-0001', f: 'seat', from: null, to: { t: 't1', s: 4, st: 'confirmed' } }], reason: '', result: null }];
  return { event: d.caEvents[0], tables: d.caTables, guests: d.caGuests, changes: d.caChanges, outbox: [] };
}

describe('US-012: Export JSON v1, CSV and printable plan', () => {
  test('GIVEN a fixture event WHEN GET .../export.json is produced THEN it equals the golden fixture with format customapp.event/1, exportedAt, eventId, seq, sha256, event, tables, guests, changes and outbox', () => {
    const exp = exportEvent(sample(), { now: NOW });
    assert.deepEqual(Object.keys(exp), ['format', 'exportedAt', 'eventId', 'seq', 'sha256', 'event', 'tables', 'guests', 'changes', 'outbox']);
    assert.equal(exp.format, EXPORT_FORMAT);
    assert.equal(EXPORT_FORMAT, 'customapp.event/1');
    if (process.env.UPDATE_GOLDEN) fs.writeFileSync(GOLDEN, `${JSON.stringify(exp, null, 2)}\n`);
    assert.deepEqual(exp, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  });
  test('GIVEN guests with reserved and confirmed seats and status tokens WHEN exported THEN every claim is present, sha256 verifies, token hashes are absent and no PII beyond the agreed fields appears', () => {
    const s = sample();
    const exp = exportEvent(s, { now: NOW });
    assert.equal(exp.sha256, exportHash(exp));
    assert.notEqual(exportHash({ ...exp, seq: 8 }), exp.sha256, 'any change breaks the fingerprint');
    assert.deepEqual(exp.guests.filter((g) => g.seat).map((g) => [g.ref, g.seat.status]), [['TG-0001', 'confirmed'], ['TG-0002', 'reserved']]);
    const text = JSON.stringify(exp);
    for (const gone of ['secret-token-hash', 'statusTokens', 'lookup', '"flags":[{']) assert.ok(!text.includes(gone), gone);
    const allowed = ['id', 'ref', 'externalKey', 'name', 'designation', 'company', 'industryId', 'industryText', 'email', 'mobile', 'classification', 'tags', 'rsvp', 'ownerUserId', 'arrival', 'approval', 'substituteFor', 'substitutedBy', 'groupId', 'seat', 'released', 'notify', 'deskOnly', 'altSurnames', 'active', 'rev'];
    for (const g of exp.guests) for (const k of Object.keys(g)) assert.ok(allowed.includes(k), `guest field ${k}`);
    assert.ok(!('qrKeyHash' in exp.event));
  });
  test('GIVEN an export WHEN .../export.csv?kind= and .../plan.pdf are requested THEN both are derived from the same export and the CSV is formula-safe', async () => {
    const exp = exportEvent(sample(), { now: NOW });
    const guests = exportCsv(exp, 'guests', { names: { 'u-sam': 'Sam Staff' } });
    assert.match(guests, /^Ref,First name,Surname/);
    assert.match(guests, /"'=HYPERLINK\(""x""\)"/, 'a formula is opened as text');
    assert.match(guests, /TG-0001,Maria,Santos,.*Sam Staff,Checked in/);
    const seating = exportCsv(exp, 'seating');
    assert.deepEqual(seating.trim().split('\r\n').slice(1).map((l) => l.split(',').slice(0, 3).join(',')), ['1,4,TG-0001', '1,5,TG-0002']);
    const html = planHtml(exp, { names: { 'u-sam': 'Sam Staff' } });
    assert.match(html, /<title>Test Gala: seating plan<\/title>/);
    assert.match(html, /As of Dec 9, 2026, 8:34\sPM/, 'stamped with the export time, in Manila time');
    assert.match(html, /Table 1 <span>Preferred · Sam Staff · 1 seated · 1 reserved · 8 free/);
    assert.match(html, /<td class="n">4<\/td><td>Maria Santos<\/td>/);
    assert.match(html, /@media print/);
    assert.doesNotMatch(html, /<script/i);
    assert.ok(html.indexOf('<td><b>2</b>') < html.indexOf('<td><b>1</b>'), 'the room grid: table 1 nearest the stage on the right');
    // Through the API, the files carry the same seq as the JSON.
    const c = await company();
    const e = await eventWith(c, { rows: [['A1', 'Ana', 'Cruz', 'Acme', '', 'ana@example.com', '0917 000 1111', 'regular', '', '', '']] });
    const json = await c.as.lead('GET', `${e.base}/export.json`);
    const plan = await c.as.lead('GET', `${e.base}/plan.html`);
    assert.match(plan.toString(), new RegExp(`seq ${json.seq} `));
    assert.match(plan.headers['Content-Type'], /^text\/html/);
    assert.match(plan.headers['Content-Security-Policy'], /default-src 'none'/);
    const csv = await c.as.lead('GET', `${e.base}/export.csv?kind=seating`);
    assert.match(csv.headers['Content-Disposition'], /attachment; filename="test-gala-.*seating\.csv"/);
  });
  test('GIVEN a staffer and the Super Administrator WHEN each requests the exports THEN only the Super Administrator gets them', async () => {
    const c = await company();
    const e = await eventWith(c);
    for (const url of ['export.json', 'export.csv?kind=guests', 'export.csv?kind=seating', 'plan.html', 'invariants']) {
      assert.equal((await c.as.sam('GET', `${e.base}/${url}`)).code, 'needs_super_admin', url);
      assert.equal((await c.admin('GET', `${e.base}/${url}`)).code, 'needs_super_admin', `${url}: a CORE administrator neither`);
    }
    assert.equal((await c.as.lead('GET', `${e.base}/export.json`)).format, 'customapp.event/1');
    const audit = fs.readFileSync(`${c.dir}/audit-log.jsonl`, 'utf8');
    assert.match(audit, /"action":"customapp.export"/, 'every export is in the audit log');
  });
});
