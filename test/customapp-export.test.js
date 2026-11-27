// CUSTOM APP → events: the export (US-012). One versioned JSON document, customapp.event/1, with the
// event's seq and a sha256 of itself, is the recovery copy; the CSV and the printable plan are made
// from it. The golden file pins the format: a change to it is a new version, not an edit.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, company, eventWith } from './support/customapp-kit.js';
import { exportEvent, exportHash, exportCsv, planHtml, packHtml, roomSvg, EXPORT_FORMAT } from '../server/customapp/events/io.js';

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
    const allowed = ['id', 'ref', 'externalKey', 'name', 'designation', 'company', 'industryId', 'industryText', 'email', 'mobile', 'classification', 'tags', 'rsvp', 'ownerUserId', 'arrival', 'approval', 'substituteFor', 'substitutedBy', 'groupId', 'seat', 'released', 'notify', 'deskOnly', 'altSurnames', 'active', 'rev', 'rsvpReply', 'invite'];
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
    // The room as drawn on the room plan (the same geometry), in black and white with table and
    // chair numbers: table 1 nearest the stage on the right.
    const cx = (n) => Number(html.match(new RegExp(`<g class="t" data-n="${n}"><circle cx="([\\d.]+)"`))[1]);
    assert.match(html, /<svg class="roomsvg"/);
    assert.ok(cx(1) > cx(2) || (exp.tables.length < 2), 'table 1 nearest the stage on the right');
    assert.match(html, />STAGE<\/text>/);
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

describe('US-020: Safety nets: 5-minute export copies and the 60 s invariant self-check', () => {
  test('GIVEN a live event WHEN the 5-minute writer runs 30 times THEN it writes the export v1 with the same function into data/backups/events/ and keeps the last 24', async () => {
    const path = await import('node:path');
    const { createSafety, SAFETY } = await import('../server/customapp/events/safety.js');
    const { eventExport } = await import('../server/customapp/events/io.js');
    const db = fixture({ tables: [{ n: 1 }], guests: [{ ref: 'A', arrived: true, seat: [1, 1] }] });
    db.dir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'core-ca-safety-'));
    let t = Date.parse('2026-12-09T11:00:00.000Z');
    const safety = createSafety(db, { now: () => t });
    assert.equal(SAFETY.copyEveryMs, 5 * 60000);
    for (let i = 0; i < 30; i++) {
      db.data.caEvents[0].seq = i + 1;
      safety.writeCopies();
      t += SAFETY.copyEveryMs;
    }
    const dir = path.join(db.dir, 'backups', 'events');
    const files = fs.readdirSync(dir).sort();
    assert.equal(files.length, 24, 'the last 24 kept');
    assert.match(files.at(-1), /^test-gala-abcd-20261209T132500000Z-seq30\.json$/);
    assert.match(files[0], /-seq7\.json$/, 'the oldest six went');
    const exp = JSON.parse(fs.readFileSync(path.join(dir, files.at(-1)), 'utf8'));
    assert.equal(exp.format, EXPORT_FORMAT);
    assert.equal(exp.sha256, exportHash(exp));
    assert.deepEqual(exp, eventExport(db, db.data.caEvents[0], exp.exportedAt), 'the same function as the download');
    assert.equal(safety.health('ev1').copy.seq, 30);
    // A draft event is not copied.
    db.data.caEvents[0].status = 'draft';
    assert.deepEqual(safety.writeCopies(), []);
  });

  test('GIVEN a clean event and one with a forced violation WHEN GET .../invariants is called THEN it returns [] and the violation respectively', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: [['A1', 'Ana', 'Cruz', 'Acme', '', 'a@example.com', '0917 000 0001', 'regular', '', '', '']] });
    assert.deepEqual((await c.as.lead('GET', `${e.base}/invariants`)).violations, []);
    // Forced by hand (never possible through commit()): a table smaller than its claims.
    const g = c.db.data.caGuests.find((x) => x.externalKey === 'A1');
    g.seat = { tableId: e.tables[3], seatNo: 11, status: 'confirmed' };
    const v = (await c.as.lead('GET', `${e.base}/invariants`)).violations;
    assert.deepEqual(v.map((x) => x.rule), ['I3']);
    assert.equal((await c.as.sam('GET', `${e.base}/invariants`)).code, 'needs_super_admin');
  });
});

describe('US-025: Offline pack and paper reconciliation', () => {
  test('GIVEN an export v1 WHEN the print pack is generated THEN it has an A–Z list, per-table sheets and per-staffer sheets covering every claim, each page stamped as of HH:MM', async () => {
    const exp = exportEvent(sample(), { now: NOW });
    const html = packHtml(exp, { names: { 'u-sam': 'Sam Staff' } });
    const sheets = [...html.matchAll(/<section class="sheet[^"]*" data-sheet="([^"]+)">([\s\S]*?)<\/section>/g)].map((m) => ({ id: m[1], body: m[2] }));
    assert.deepEqual(sheets.map((x) => x.id), ['room', 'az', 'table-1', 'table-2', 'staff-u-sam', 'staff-none', 'cards']);
    // Every sheet's heading row (repeated on every printed page of it) says "as of" the time.
    for (const sh of sheets) assert.match(sh.body, /<thead><tr class="st"><th[^>]*>Test Gala · [^<]* · <strong>as of 8:34\sPM<\/strong> · seq 7<\/th><\/tr>/, sh.id);
    assert.match(html, /thead\s*\.st|thead \.st/, 'the heading row is styled to repeat');
    // A–Z: every guest, surname first, in order.
    const az = sheets.find((x) => x.id === 'az').body;
    assert.ok(az.indexOf('Cruz, Ana') < az.indexOf('Reyes, Jose') && az.indexOf('Reyes, Jose') < az.indexOf('Santos, Maria'));
    // Every claim (reserved and confirmed) is on the A–Z list, its table's sheet and its owner's sheet.
    const claims = exp.guests.filter((g) => g.seat);
    assert.equal(claims.length, 2);
    for (const g of claims) {
      const t = exp.tables.find((x) => x.id === g.seat.tableId);
      assert.match(sheets.find((x) => x.id === `table-${t.number}`).body, new RegExp(`<td class="n">${g.seat.seatNo}</td><td>${g.name.display}</td>`), g.ref);
      assert.ok(az.includes(`${g.name.last}, ${g.name.first}`), g.ref);
      assert.ok(sheets.find((x) => x.id === `staff-${g.ownerUserId || 'none'}`).body.includes(`${g.name.last}, ${g.name.first}`), `${g.ref} on their owner's sheet`);
    }
    assert.match(sheets.find((x) => x.id === 'table-1').body, /<td>Reserved<\/td>/, 'a reservation is on the sheet as a claim');
    // The room, as drawn on the room plan, in black and white with table and chair numbers.
    assert.ok(html.includes(roomSvg(exp)));
    assert.match(roomSvg(exp), /<circle class="c confirmed"[^>]*fill="#000"/);
    assert.match(roomSvg(exp), /<circle class="c reserved"[^>]*fill="url\(#hatch\)"/);
    assert.equal((roomSvg(exp).match(/<circle class="c/g) || []).length, 20, 'every chair of both tables');
    // The cards, as the guide prints them.
    assert.match(html, /If this page doesn't open, please go to the registration desk\./);
    assert.match(html, /If the app restarts you'll be signed out\. Sign in again and you'll land back on your queue\./);
    assert.doesNotMatch(html, /<script/i);
    // Through the API: the Super Administrator only, from the same export (same seq).
    const c = await company();
    const e = await eventWith(c, { rows: [['A1', 'Ana', 'Cruz', 'Acme', '', 'ana@example.com', '0917 000 1111', 'regular', 'sam', '', '']] });
    const json = await c.as.lead('GET', `${e.base}/export.json`);
    const pack = await c.as.lead('GET', `${e.base}/pack.html?standby=https://standby.example`);
    assert.match(pack.toString(), new RegExp(`seq ${json.seq}<`));
    assert.match(pack.toString(), /Standby address: https:\/\/standby\.example/);
    assert.match(pack.headers['Content-Security-Policy'], /default-src 'none'/);
    assert.equal((await c.as.sam('GET', `${e.base}/pack.html`)).code, 'needs_super_admin');
  });
});
