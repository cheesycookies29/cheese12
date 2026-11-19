// Documents on a contract (0.43): who adds, opens and removes them, which files are taken (PDF,
// photos, Word and Excel, never macro-enabled), and that each change is in the contract's history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { sniffOffice, shortName } from '../server/attachments.js';
import { DOCX, XLSX } from '../shared/crm.js';

const PW = 'Correct-Horse-42';

// A minimal ZIP (Office files are ZIPs): entries [name, text], stored or deflated.
function zip(entries, { deflate = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const raw = Buffer.from(text);
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const types = (main) => `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/x" ContentType="${main}"/></Types>`;
const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const docx = zip([['[Content_Types].xml', types(WORD)], ['word/document.xml', '<w:document/>']], { deflate: true });
const xlsx = zip([['[Content_Types].xml', types(SHEET)], ['xl/workbook.xml', '<workbook/>']]);
const docm = zip([['[Content_Types].xml', types('application/vnd.ms-word.document.macroEnabled.main+xml')], ['word/document.xml', '<w:document/>']]);
const withVba = zip([['[Content_Types].xml', types(WORD)], ['word/vbaProject.bin', 'x']]);
const pdf = Buffer.from('%PDF-1.4\n% signed contract\n');
const b64 = (buf) => buf.toString('base64');

test('sniffOffice: Word and Excel files are recognised from their parts; macro-enabled and other ZIPs are not', () => {
  assert.equal(sniffOffice(docx), DOCX);
  assert.equal(sniffOffice(xlsx), XLSX);
  assert.equal(sniffOffice(docm), null);
  assert.equal(sniffOffice(withVba), null);
  assert.equal(sniffOffice(zip([['hello.txt', 'hi']])), null, 'a plain ZIP');
  assert.equal(sniffOffice(Buffer.from('PK\u0003\u0004 not really a zip')), null);
  assert.equal(sniffOffice(pdf), null);
});

test('a long file name is shortened before its extension, which it keeps (0.47)', () => {
  const long = `${'Memorandum of agreement '.repeat(8)}signed.docx`;
  const short = shortName(long);
  assert.equal(short.length, 120);
  assert.ok(short.endsWith('….docx'), short);
  assert.equal(shortName('Annex A.pdf'), 'Annex A.pdf');
  assert.equal(shortName('x'.repeat(130)).length, 120, 'no extension: cut at 120');
});

test('contract documents: added by those who edit, opened as a download, removed by the uploader or a Sales Manager, all in the history', async () => {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-crm-docs-')), 'db.json'));
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    return async (method, url, body = {}) => {
      try {
        const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.5' } }, new URL(url, 'http://localhost'), body);
        if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
        return Buffer.isBuffer(res.data) ? { buffer: res.data, headers: res.headers } : res.data;
      } catch (err) {
        return { status: err.status, error: err.message };
      }
    };
  };
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  for (const [name, username, role] of [['Sam Sales', 'sam', 'sales'], ['Sol Sales', 'sol', 'sales'], ['Mia Manager', 'mia', 'salesmgr'], ['Hana HR', 'hana', 'hr']]) {
    await admin('POST', '/api/users', { name, username, role, password: PW, mustChangePassword: false });
  }
  const login = async (username) => {
    const c = client();
    await c('POST', '/api/auth/login', { username, password: PW });
    return c;
  };
  const [sam, sol, mia, hana] = await Promise.all(['sam', 'sol', 'mia', 'hana'].map(login));
  const acct = await sam('POST', '/api/crm/accounts', { name: 'Kalayaan Medical Center' });
  const c = await sam('POST', '/api/crm/contracts', { title: 'HR and payroll', accountId: acct.id, value: 2450000, startDate: '2026-01-01', endDate: '2026-12-31' });
  const base = `/api/crm/contracts/${c.id}/documents`;

  // Adding: PDF, Word, Excel; refused: macro-enabled, other files, too large.
  let out = await sam('POST', base, { file: { name: 'Signed contract.pdf', data: b64(pdf) } });
  assert.equal(out.documents.length, 1, out.error);
  out = await sam('POST', base, { file: { name: 'Annex A.docx', data: b64(docx) } });
  out = await sam('POST', base, { file: { name: 'Price schedule.xlsx', data: b64(xlsx) } });
  assert.deepEqual(out.documents.map((d) => [d.name, d.type, d.byName]), [['Signed contract.pdf', 'application/pdf', 'Sam Sales'], ['Annex A.docx', DOCX, 'Sam Sales'], ['Price schedule.xlsx', XLSX, 'Sam Sales']]);
  for (const [name, buf] of [['Annex.docm', docm], ['Macro.docx', withVba], ['page.html', Buffer.from('<script>alert(1)</script>')], ['notes.zip', zip([['a.txt', 'a']])]]) {
    const r = await sam('POST', base, { file: { name, data: b64(buf) } });
    assert.equal(r.status, 400, name);
    assert.match(r.error, /PDF, a photo or scan .* Macro-enabled files are not accepted/);
  }
  const big = Buffer.concat([pdf, Buffer.alloc(8 * 1024 * 1024)]);
  assert.match((await sam('POST', base, { file: { name: 'Scan.pdf', data: b64(big) } })).error, /too large .* limit is 8 MB/);
  assert.equal((await hana('POST', base, { file: { name: 'x.pdf', data: b64(pdf) } })).status, 403, 'no Sales & CRM access');

  // Opening: everyone in Sales & CRM, as a file to save; nobody else.
  const detail = await sol('GET', `/api/crm/contracts/${c.id}`);
  assert.equal(detail.documents.length, 3);
  assert.ok(detail.documents.every((d) => d.canDelete === false), 'Sol did not add them and is not a manager');
  const file = await sol('GET', `${base}/${detail.documents[0].id}`);
  assert.deepEqual(file.buffer, pdf);
  assert.equal(file.headers['Content-Type'], 'application/octet-stream');
  assert.match(file.headers['Content-Disposition'], /^attachment; filename="Signed contract.pdf"/);
  assert.match(file.headers['Content-Security-Policy'], /sandbox/);
  assert.equal((await hana('GET', `${base}/${detail.documents[0].id}`)).status, 403);
  assert.equal((await sol('GET', `${base}/00000000-0000-0000-0000-000000000000`)).status, 404);
  const list = await sol('GET', '/api/crm/contracts');
  assert.equal(list.find((x) => x.id === c.id).documentCount, 3);
  assert.equal(list.find((x) => x.id === c.id).documents, undefined, 'the list does not carry the files');

  // Removing: not by another salesperson; by the uploader or a Sales Manager.
  assert.equal((await sol('DELETE', `${base}/${detail.documents[0].id}`)).status, 403);
  out = await sam('DELETE', `${base}/${detail.documents[0].id}`);
  assert.equal(out.documents.length, 2);
  out = await mia('DELETE', `${base}/${detail.documents[1].id}`);
  assert.equal(out.documents.length, 1);
  const stored = path.join(db.dir, 'attachments', detail.documents[0].id);
  assert.ok(!fs.existsSync(stored), 'the removed file is gone from the server');

  // History: each document added and removed, with who did it.
  const h = (await sam('GET', `/api/crm/activities?type=contract&id=${c.id}`)).filter((a) => a.type === 'event').map((a) => `${a.createdByName}: ${a.subject}`);
  for (const line of ['Sam Sales: Document added: Signed contract.pdf', 'Sam Sales: Document added: Annex A.docx', 'Sam Sales: Document added: Price schedule.xlsx', 'Sam Sales: Document removed: Signed contract.pdf', 'Mia Manager: Document removed: Annex A.docx']) assert.ok(h.includes(line), line);

  // An edit of the contract keeps its documents; deleting the contract removes their files.
  const fresh = await mia('GET', `/api/crm/contracts/${c.id}`);
  await mia('PUT', `/api/crm/contracts/${c.id}`, { billing: 'Quarterly', updatedAt: fresh.updatedAt });
  assert.equal((await mia('GET', `/api/crm/contracts/${c.id}`)).documents.length, 1);
  const last = path.join(db.dir, 'attachments', fresh.documents[0].id);
  assert.ok(fs.existsSync(last));
  await mia('DELETE', `/api/crm/contracts/${c.id}`);
  assert.ok(!fs.existsSync(last), 'files go with the contract');
  handle.monitor.stop();
});
