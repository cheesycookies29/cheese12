// File previews (0.54): a photo is its own preview; a scanned PDF's preview is the picture of its
// page (the JPEG inside it); a typed PDF has none. Previews are sent to be shown, never run: an
// image type, nosniff and a sandbox policy, to those who can open the project only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { pdfJpegRange } from '../server/attachments.js';

const PW = 'Correct-Horse-42';
const fixture = (n) => fs.readFileSync(new URL(`../scripts/fixtures/${n}`, import.meta.url));
const scanned = fixture('Scanned acceptance NSU-2025-118.pdf');
const typed = fixture('Signed contract NSU-2025-118.pdf');
const photo = fixture('profile-sample.jpg');
const pdfWith = (dict, data) => Buffer.concat([Buffer.from(`%PDF-1.4\n4 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream\nendobj\n')]);

test('the picture inside a PDF: only a plain JPEG image stream, the page-sized one first', () => {
  const r = pdfJpegRange(scanned);
  assert.ok(r);
  assert.equal(scanned[r[0]], 0xff);
  assert.equal(scanned[r[0] + 1], 0xd8);
  assert.equal(scanned[r[1] - 1], 0xd9);
  assert.equal(pdfJpegRange(typed), null, 'a typed PDF has no picture');
  assert.equal(pdfJpegRange(photo), null, 'not a PDF');
  assert.equal(pdfJpegRange(Buffer.from('')), null);
  assert.equal(pdfJpegRange(pdfWith('/Subtype /Image /Filter [/FlateDecode /DCTDecode]', photo)), null, 'another filter on top');
  assert.equal(pdfJpegRange(pdfWith('/Subtype /Image /Filter /DCTDecode', Buffer.from('not a jpeg at all'))), null, 'bytes that are not a JPEG');
  assert.equal(pdfJpegRange(pdfWith('/Filter /DCTDecode', photo)), null, 'not an image object');
  const small = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
  const two = Buffer.concat([pdfWith('/Subtype /Image /Filter /DCTDecode', small).subarray(0, -1), pdfWith('/Subtype /Image /Filter /DCTDecode', Buffer.concat([photo, Buffer.alloc(0)])).subarray(9)]);
  const pick = pdfJpegRange(two);
  assert.deepEqual(two.subarray(pick[0], pick[1]), photo, 'the page-sized picture, not a small logo');
});

test('previews of a task\'s and a milestone\'s files: shown safely, to members only', async () => {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-preview-')), 'db.json'));
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
  for (const [name, username] of [['Pia Manager', 'pia'], ['Paolo Manager', 'paolo']]) await admin('POST', '/api/users', { name, username, role: 'pm', password: PW, mustChangePassword: false });
  const login = async (u) => {
    const c = client();
    await c('POST', '/api/auth/login', { username: u, password: PW });
    return c;
  };
  const [pia, paolo] = [await login('pia'), await login('paolo')];
  const p = await pia('POST', '/api/pm/projects', { name: 'Learning management system', startDate: localDate() });
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Sign-off' });
  const base = `/api/pm/tasks/${t.id}/attachments`;
  let out;
  for (const [name, buf] of [['Scanned acceptance.pdf', scanned], ['Contract.pdf', typed], ['Whiteboard.jpg', photo]]) out = await pia('POST', base, { file: { name, data: buf.toString('base64') } });
  assert.deepEqual(out.attachments.map((a) => [a.name, a.preview]), [['Scanned acceptance.pdf', true], ['Contract.pdf', false], ['Whiteboard.jpg', true]]);
  const [scan, doc, pic] = out.attachments;

  const r = pdfJpegRange(scanned);
  const pv = await pia('GET', `${base}/${scan.id}/preview`);
  assert.deepEqual(pv.buffer, scanned.subarray(r[0], r[1]), 'the scan\'s page picture');
  assert.equal(pv.headers['Content-Type'], 'image/jpeg');
  assert.equal(pv.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(pv.headers['Content-Security-Policy'], /sandbox/);
  assert.match(pv.headers['Content-Disposition'], /^inline/);
  const ph = await pia('GET', `${base}/${pic.id}/preview`);
  assert.deepEqual(ph.buffer, photo);
  assert.equal(ph.headers['Content-Type'], 'image/jpeg');
  assert.equal((await pia('GET', `${base}/${doc.id}/preview`)).status, 404, 'a typed PDF has no preview');
  assert.equal((await paolo('GET', `${base}/${pic.id}/preview`)).status, 404, 'not for someone outside the project');
  assert.equal((await client()('GET', `${base}/${pic.id}/preview`)).status, 401);
  // The download itself is unchanged: a file to save.
  assert.equal((await pia('GET', `${base}/${scan.id}`)).headers['Content-Type'], 'application/octet-stream');

  // A milestone's files too.
  const full = await pia('GET', `/api/pm/projects/${p.id}`);
  const m = await pia('POST', `/api/pm/projects/${p.id}/milestones`, { name: 'Sign-off', dueDate: localDate(), deliverable: true, version: full.version });
  assert.ok(m.id || m.milestones, JSON.stringify(m).slice(0, 200));
  const mid = m.id || m.milestones.at(-1).id;
  const mo = await pia('POST', `/api/pm/projects/${p.id}/milestones/${mid}/attachments`, { file: { name: 'Acceptance.pdf', data: scanned.toString('base64') } });
  assert.equal(mo.attachments[0].preview, true);
  const mp = await pia('GET', `/api/pm/projects/${p.id}/milestones/${mid}/attachments/${mo.attachments[0].id}/preview`);
  assert.equal(mp.headers['Content-Type'], 'image/jpeg');
  handle.monitor.stop();
});
