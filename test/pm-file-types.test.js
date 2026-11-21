// The files a task or milestone takes (0.56): PDF, pictures (GIF too), Word, Excel and PowerPoint,
// OpenDocument text, spreadsheet and presentation, text and CSV, each known by its contents.
// Refused: macro-enabled Office or OpenDocument files, programs, web pages, archives, files that only
// claim to be text, and anything over 8 MB. Downloads stay files to save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { sniffOffice, sniffText } from '../server/attachments.js';
import { DOCX, XLSX, PPTX, ODT, ODS, ODP, TEXT, CSV, PM_FILE_TYPES, PM_FILE_EXTS, fileTag } from '../shared/files.js';

const PW = 'Correct-Horse-42';
// A minimal ZIP: entries [name, text, { stored }]; deflated unless stored.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text, { stored = false } = {}] of entries) {
    const raw = Buffer.from(text);
    const data = stored ? raw : deflateRawSync(raw);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(stored ? 0 : 8, 10);
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
const ooxml = (main, extra = []) => zip([['[Content_Types].xml', `<?xml version="1.0"?><Types><Override PartName="/x" ContentType="${main}"/></Types>`], ...extra]);
const odf = (kind, extra = []) => zip([['mimetype', kind, { stored: true }], ['content.xml', '<office:document-content/>'], ...extra]);
const pptx = ooxml('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', [['ppt/presentation.xml', '<p/>']]);
const pptm = ooxml('application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml');
const pptxVba = ooxml('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', [['ppt/vbaProject.bin', 'x']]);
const docx = ooxml('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml');
const xlsx = ooxml('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
const odt = odf(ODT);
const ods = odf(ODS);
const odp = odf(ODP);
const odtMacro = odf(ODT, [['Basic/Standard/Module1.xml', '<script/>']]);
const gif = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

test('kinds of files by their contents: Office, OpenDocument and text', () => {
  assert.equal(sniffOffice(pptx), PPTX);
  assert.equal(sniffOffice(docx), DOCX);
  assert.equal(sniffOffice(xlsx), XLSX);
  assert.deepEqual([odt, ods, odp].map(sniffOffice), [ODT, ODS, ODP]);
  for (const bad of [pptm, pptxVba, odtMacro, odf('application/vnd.oasis.opendocument.graphics'), zip([['mimetype', ODT]]), zip([['readme.txt', 'hi']])]) assert.equal(sniffOffice(bad), null);
  assert.equal(sniffText(Buffer.from('Name,Hours\nAna,8\n'), 'hours.csv'), CSV);
  assert.equal(sniffText(Buffer.from('# Notes\nTabs\tand ñ are fine.\r\n'), 'notes.md'), TEXT);
  assert.equal(sniffText(Buffer.from('plain'), 'a.TXT'), TEXT);
  assert.equal(sniffText(Buffer.from('MZ\u0000\u0001'), 'setup.txt'), null, 'a program named .txt');
  assert.equal(sniffText(Buffer.from([0xc3, 0x28]), 'a.txt'), null, 'not UTF-8');
  assert.equal(sniffText(Buffer.from('<html>'), 'page.html'), null, 'only .txt, .md and .csv');
  assert.equal(sniffText(Buffer.from(''), 'empty.txt'), null);
  // Every kind has a label and the browser offers its extension; documents carry a tag.
  assert.equal(Object.keys(PM_FILE_TYPES).length, 13);
  for (const x of ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'txt', 'md', 'csv', 'gif']) assert.ok(PM_FILE_EXTS.includes(x), x);
  assert.deepEqual(fileTag(DOCX), ['DOC', 'blue']);
  assert.deepEqual(fileTag(CSV), ['CSV', 'green']);
  assert.equal(fileTag('image/jpeg'), null, 'a photo shows itself');
});

test('a task takes the new kinds and refuses the rest; downloads stay files to save', async () => {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-types-')), 'db.json'));
  const handle = createApi(db);
  let cookie = '';
  const pia = async (method, url, body = {}) => {
    try {
      const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.5' } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return Buffer.isBuffer(res.data) ? { buffer: res.data, headers: res.headers } : res.data;
    } catch (err) {
      return { status: err.status, error: err.message };
    }
  };
  await pia('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const p = await pia('POST', '/api/pm/projects', { name: 'Rollout', startDate: localDate() });
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Plan' });
  const base = `/api/pm/tasks/${t.id}/attachments`;
  const add = (name, buf) => pia('POST', base, { file: { name, data: buf.toString('base64') } });

  const good = [['Plan.docx', docx, DOCX], ['Budget.xlsx', xlsx, XLSX], ['Kick-off.pptx', pptx, PPTX], ['Minutes.odt', odt, ODT], ['Costs.ods', ods, ODS], ['Deck.odp', odp, ODP],
    ['Notes.txt', Buffer.from('Call the registrar.\n'), TEXT], ['README.md', Buffer.from('# Setup\n'), TEXT], ['Hours.csv', Buffer.from('Name,Hours\nAna,8\n'), CSV], ['Spinner.gif', gif, 'image/gif']];
  let out;
  for (const [name, buf] of good) {
    out = await add(name, buf);
    assert.ok(out.attachments, `${name}: ${out.error}`);
  }
  assert.deepEqual(out.attachments.map((a) => [a.name, a.type]), good.map(([n, , ty]) => [n, ty]));
  assert.equal(out.attachments.find((a) => a.name === 'Spinner.gif').preview, true, 'a GIF that holds together shows as itself');
  assert.equal(out.attachments.find((a) => a.name === 'Plan.docx').preview, false);
  const dl = await pia('GET', `${base}/${out.attachments[0].id}`);
  assert.equal(dl.headers['Content-Type'], 'application/octet-stream');
  assert.match(dl.headers['Content-Disposition'], /^attachment/);
  assert.equal((await pia('GET', `${base}/${out.attachments[0].id}/preview`)).status, 404, 'no preview of a Word file');

  const bad = [['Deck.pptm', pptm], ['Deck.pptx', pptxVba], ['Minutes.odt', odtMacro], ['setup.exe', Buffer.from('MZ\u0090\u0000program')], ['setup.txt', Buffer.from('MZ\u0000\u0001')],
    ['page.html', Buffer.from('<script>alert(1)</script>')], ['logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')], ['files.zip', zip([['a.txt', 'a']])], ['empty.txt', Buffer.alloc(0)]];
  for (const [name, buf] of bad) {
    const r = await add(name, buf);
    assert.equal(r.status, 400, name);
  }
  assert.match((await add('page.html', Buffer.from('<p>'))).error, /Macro-enabled files, programs and archives are not accepted/);
  const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(8 * 1024 * 1024)]);
  assert.match((await add('Scan.pdf', big)).error, /too large .* limit is 8 MB/);
  handle.monitor.stop();
});
