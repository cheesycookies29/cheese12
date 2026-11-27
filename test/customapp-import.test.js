// CUSTOM APP → events: the guest list import (US-008): CSV and Excel, header names as people write
// them, normalised surnames and last 4 digits, the collision report, the limits, and re-imports.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { company, eventWith, csvOf } from './support/customapp-kit.js';
import { canonSurname, last4, cleanText } from '../server/customapp/events/model.js';
import { csvCell, previewImport, readXlsxRows } from '../server/customapp/events/io.js';
import { zipFiles } from '../server/zip.js';

// A small .xlsx made here (shared strings and a number cell), as Excel saves one.
function xlsx(rows) {
  const strings = [];
  const si = (v) => {
    if (!strings.includes(v)) strings.push(v);
    return strings.indexOf(v);
  };
  const col = (i) => String.fromCharCode(65 + i);
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v === '' ? '' : typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>`)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Guests" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`,
  };
  return zipFiles(Object.entries(files).map(([name, text]) => ({ name, buffer: Buffer.from(text), type: 'application/xml' })), { paths: true });
}

describe('US-008: Guest import with collision report', () => {
  test('GIVEN a CSV and an XLSX with aliased headers WHEN POST .../import previews and POST .../import/:jobId/apply applies THEN the preview changes nothing and the apply is one commit', async () => {
    const c = await company();
    const e = await eventWith(c);
    const csv = 'Guest ID;Given name;Family name;Organisation;Sector;E-mail;Cellphone number;Guest type;Designated personnel;Table No;Seat No\nX1;Maria;Santos;Northbay Bank;Banking;MARIA@example.com;+63 917 123 4417;VIP;sam;1;3\nX2;Jose;Reyes;Harbor Life;Insurance;;0917 555 0002;regular;;;';
    const before = JSON.stringify(c.db.data.caGuests);
    const seq = c.db.data.caEvents[0].seq;
    const pv = await c.as.lead('POST', `${e.base}/import`, { format: 'csv', data: csv });
    assert.equal(pv.report.adds, 2);
    assert.equal(pv.report.blocking, 0, JSON.stringify(pv.report));
    assert.equal(JSON.stringify(c.db.data.caGuests), before, 'the preview writes nothing');
    assert.equal(c.db.data.caEvents[0].seq, seq);
    const n = c.db.data.caChanges.length;
    const ap = await c.as.lead('POST', `${e.base}/import/${pv.jobId}/apply`, {});
    assert.deepEqual([ap.added, ap.updated], [2, 0]);
    assert.equal(c.db.data.caChanges.length, n + 1, 'one commit');
    assert.equal(c.db.data.caEvents[0].seq, seq + 1);
    const m = e.guest('X1');
    assert.deepEqual([m.classification, m.email, m.ownerUserId, m.seat.status, m.seat.seatNo, m.lookup.m4], ['preferred', 'maria@example.com', c.ids.sam, 'reserved', 3, '4417']);
    assert.equal(m.industryId, c.db.data.caEvents[0].industries.find((i) => i.name === 'Banking').id);
    assert.equal((await c.as.lead('POST', `${e.base}/import/${pv.jobId}/apply`, {})).status, 404, 'a job is applied once');
    // Excel: the same columns, a number cell for the mobile.
    const book = xlsx([['Ref', 'First name', 'Surname', 'Company', 'Mobile', 'Classification'], ['X3', 'Ana', 'Cruz', 'Palengke', 9171230003, 'employee'], ['X4', 'Liza', 'Ocampo', 'Palengke', '0917 123 0004', '']]);
    assert.deepEqual(readXlsxRows(book)[1], ['X3', 'Ana', 'Cruz', 'Palengke', '9171230003', 'employee']);
    const pv2 = await c.as.lead('POST', `${e.base}/import`, { format: 'xlsx', data: book.toString('base64') });
    assert.equal(pv2.report.adds, 2, JSON.stringify(pv2));
    await c.as.lead('POST', `${e.base}/import/${pv2.jobId}/apply`, {});
    assert.deepEqual([e.guest('X3').classification, e.guest('X3').lookup.m4, e.guest('X4').classification], ['employee', '0003', 'regular']);
    assert.equal((await c.as.lead('POST', `${e.base}/import`, { format: 'xlsx', data: Buffer.from('not a zip').toString('base64') })).status, 400);
  });

  test('GIVEN surnames with diacritics, spaces, hyphens, apostrophes and Jr./III and mobiles +63 917 123 4567, 09171234567 and 917-123-4567 WHEN they are normalised THEN the surname canon follows R2 and every mobile gives last 4 = 4567', () => {
    assert.equal(canonSurname('Dela Cruz'), 'delacruz');
    assert.equal(canonSurname('dela Cruz Jr.'), 'delacruz');
    assert.equal(canonSurname('Peñaflor-Santos III'), 'penaflorsantos');
    assert.equal(canonSurname("O'Brien Sr"), 'obrien');
    assert.equal(canonSurname('Mañalac, IV'), 'manalac');
    assert.equal(canonSurname('De  Leon'), 'deleon');
    assert.equal(canonSurname('St. John'), 'stjohn');
    assert.equal(canonSurname('Ivy'), 'ivy', 'a name is not mistaken for a suffix');
    for (const m of ['+63 917 123 4567', '09171234567', '917-123-4567']) assert.equal(last4(m), '4567', m);
    assert.equal(last4('12'), '');
  });

  test('GIVEN a list with two guests sharing surname and last 4, a guest with no mobile and no email, a likely duplicate, an unknown industry and a table above capacity WHEN previewed THEN the collision report counts each kind', async () => {
    const c = await company();
    const e = await eventWith(c, { room: { rows: 1, cols: 3, chairsPerTable: 2, stageSide: 'right' } });
    const rows = [
      ['A1', 'Maria', 'Santos', 'Bank A', 'Banking', '', '0917 000 4417', 'regular', '', '', ''],
      ['A2', 'Mario', 'Santos', 'Bank B', 'Banking', 'mario@example.com', '0918 111 4417', 'regular', '', '', ''],
      ['N1', 'Nora', 'Nocontact', 'Shop', 'Retail', '', '', 'regular', '', '', ''],
      ['D1', 'Jose', 'Reyes', 'Harbor', 'Insurance', 'jose@example.com', '0917 000 0001', 'regular', '', '', ''],
      ['D2', 'José', 'Reyes', 'Harbor', 'Insurance', 'jose.r@example.com', '0917 000 0002', 'regular', '', '', ''],
      ['U1', 'Uma', 'Unknown', 'Mine Co', 'Mining', 'uma@example.com', '0917 000 0003', 'regular', '', '', ''],
      ['P1', 'Pia', 'One', 'X', '', 'p1@example.com', '0917 000 0004', 'preferred', '', '1', '1'],
      ['P2', 'Pio', 'Two', 'X', '', 'p2@example.com', '0917 000 0005', 'preferred', '', '1', '2'],
      ['P3', 'Pat', 'Three', 'X', '', 'p3@example.com', '0917 000 0006', 'preferred', '', '1', '1'],
    ];
    const pv = await c.as.lead('POST', `${e.base}/import`, { format: 'csv', data: csvOf(rows) });
    const r = pv.report;
    assert.equal(r.issues.ambiguous.length, 1, 'same surname and last 4');
    assert.equal(r.issues.noContact.length, 1);
    assert.equal(r.issues.duplicates.length, 1, 'José and Jose Reyes of Harbor');
    assert.equal(r.unknownIndustry.length, 1);
    assert.equal(r.issues.unknownIndustry.length, 1);
    assert.equal(r.overCapacity.length, 1, 'table 1 has 2 chairs and 3 guests');
    assert.equal(r.seatConflict.length, 1, 'two guests for table 1 seat 1');
    assert.ok(r.blocking >= 2);
    assert.equal(r.tooMany, 3, '9 guests for 6 chairs');
    assert.equal((await c.as.lead('POST', `${e.base}/import/${pv.jobId}/apply`, {})).status, 400, 'blocking problems are fixed in the file first');
    const bad = await c.as.lead('POST', `${e.base}/import`, { format: 'csv', data: csvOf([['Q1', 'Q', 'Q', 'X', '', 'q@example.com', '0917', 'platinum', '', '', ''], ['Q2', 'R', 'R', 'X', '', 'r@example.com', '0918', 'regular', '', '9', '']]) });
    assert.equal(bad.report.unknownClass.length, 1);
    assert.equal(bad.report.unknownTable.length, 1);
    assert.equal(bad.report.issues.ambiguous.length, 0);
  });

  test('GIVEN names containing CR/LF and control characters and cells starting with = + - @, tab or CR WHEN imported and exported THEN the characters are stripped on import and the cells are prefixed with \' on export', async () => {
    assert.equal(cleanText('Ana\r\nBcc: evil@example.com\u0007'), 'Ana Bcc: evil@example.com');
    assert.equal(cleanText('Zero​width'), 'Zerowidth');
    for (const v of ['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)', '\tx', '\rx']) assert.ok(csvCell(v).replace(/^"/, '').startsWith("'"), v);
    assert.equal(csvCell('Plain'), 'Plain');
    const c = await company();
    const e = await eventWith(c, { rows: [['C1', 'Ana\nBcc:x', 'Cruz\r', '=cmd|calc', '', 'ana@example.com', '0917 000 1111', 'regular', '', '', '']] });
    const g = e.guest('C1');
    assert.equal(g.name.first, 'Ana Bcc:x');
    assert.equal(g.name.last, 'Cruz');
    const out = (await c.as.lead('GET', `${e.base}/export.csv?kind=guests`)).toString();
    assert.match(out, /'=cmd\|calc/);
  });

  test('GIVEN a 2.5 MB file, a 2,500-row file and a non-Super-Administrator caller WHEN they import THEN each is refused', async () => {
    const c = await company();
    const e = await eventWith(c);
    assert.equal((await c.as.lead('POST', `${e.base}/import`, { format: 'csv', data: `Surname\n${'x'.repeat(2.5 * 1024 * 1024)}` })).status, 400);
    const many = `Ref,Surname\n${Array.from({ length: 2500 }, (_, i) => `K${i},Name${i}`).join('\n')}`;
    assert.equal((await c.as.lead('POST', `${e.base}/import`, { format: 'csv', data: many })).status, 400);
    assert.equal((await c.as.sam('POST', `${e.base}/import`, { format: 'csv', data: 'Surname\nCruz' })).code, 'needs_super_admin');
    assert.equal((await c.admin('POST', `${e.base}/import`, { format: 'csv', data: 'Surname\nCruz' })).code, 'needs_super_admin', 'not a CORE administrator either');
    assert.equal((await c.as.lead('POST', `${e.base}/import`, { format: 'csv', data: 'Colour\nred' })).status, 400, 'a list with no surname column');
  });

  test('GIVEN a live event with checked-in, seated and owned guests WHEN the same list is re-imported with changes THEN it merges by externalKey and never touches status, seat or owner, and a second identical import changes nothing', async () => {
    const c = await company();
    const rows = [['M1', 'Ana', 'Cruz', 'Acme', '', 'ana@example.com', '0917 000 1111', 'regular', 'sam', '', ''], ['M2', 'Ben', 'Lim', 'Acme', '', 'ben@example.com', '0917 000 2222', 'regular', 'sam', '', '']];
    const e = await eventWith(c, { rows });
    const ev = await c.as.lead('GET', e.base);
    await c.as.lead('PATCH', e.base, { rev: ev.rev, status: 'live' });
    const m1 = e.guest('M1');
    await e.cmd('sam', { type: 'checkIn', guestId: m1.id });
    await e.cmd('sam', { type: 'assign', guestId: m1.id, tableId: e.tables[3], seatNo: 4 });
    const changed = [['M1', 'Ana', 'Cruz', 'Acme Holdings', '', 'ana.cruz@example.com', '0917 000 1111', 'regular', 'tess', '', ''], rows[1]];
    const pv = await c.as.lead('POST', `${e.base}/import`, { format: 'csv', data: csvOf(changed) });
    assert.deepEqual([pv.report.adds, pv.report.updates], [0, 1]);
    await c.as.lead('POST', `${e.base}/import/${pv.jobId}/apply`, {});
    const after = e.guest('M1');
    assert.equal(after.company, 'Acme Holdings');
    assert.equal(after.email, 'ana.cruz@example.com');
    assert.equal(after.arrival.state, 'checked_in', 'status untouched');
    assert.deepEqual([after.seat.tableId, after.seat.seatNo], [e.tables[3], 4], 'seat untouched');
    assert.equal(after.ownerUserId, c.ids.sam, 'owner untouched once live');
    const n = c.db.data.caChanges.length;
    const again = await c.as.lead('POST', `${e.base}/import`, { format: 'csv', data: csvOf(changed) });
    assert.deepEqual([again.report.adds, again.report.updates], [0, 1], 'the owner column still differs, so it is offered');
    const r = await c.as.lead('POST', `${e.base}/import/${again.jobId}/apply`, {});
    assert.deepEqual([r.added, r.updated], [0, 0], 'and changes nothing once live');
    assert.equal(c.db.data.caChanges.length, n, 'a second identical import writes nothing');
  });

  test('previewImport refuses a list larger than the room (the event maximum is the room: 5 x 5 x 10 = 250)', () => {
    const tables = Array.from({ length: 25 }, (_, i) => ({ id: `t${i + 1}`, number: i + 1, capacity: 10, active: true, classification: 'regular' }));
    const state = { event: { id: 'e', industries: [], staff: [], settings: {} }, tables, guests: [] };
    const rows = [['Ref', 'Surname'], ...Array.from({ length: 251 }, (_, i) => [`G${i}`, `Name${i}`])];
    const pv = previewImport(state, rows);
    assert.deepEqual([pv.report.capacity, pv.report.total, pv.report.tooMany], [250, 251, 1]);
    assert.ok(pv.report.blocking >= 1);
    assert.equal(previewImport(state, rows.slice(0, 251)).report.tooMany, 0, '250 fit');
  });
});
