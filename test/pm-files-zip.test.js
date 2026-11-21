// Download all (0.57): a task's or a milestone's files in one ZIP, for those who can open the project.
// The archive is checked the way an unzip program reads it: the central directory, each entry's
// name, size, CRC-32 and contents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync, crc32 as zcrc } from 'node:zlib';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { zipFiles, MAX_ZIP_BYTES } from '../server/zip.js';

const PW = 'Correct-Horse-42';
const photo = fs.readFileSync(new URL('../scripts/fixtures/profile-sample.jpg', import.meta.url));
const scan = fs.readFileSync(new URL('../scripts/fixtures/Scanned acceptance NSU-2025-118.pdf', import.meta.url));

// Reads a ZIP: [{ name, method, data }] from its central directory, checking each CRC.
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'an end of central directory');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    assert.equal(buf.readUInt16LE(at + 8) & 0x0800, 0x0800, 'UTF-8 names');
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + packed);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    assert.equal(data.length, size, name);
    if (typeof zcrc === 'function') assert.equal(zcrc(data) >>> 0, crc, `${name}: CRC`);
    out.push({ name, method, data });
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}

test('zipFiles: compressed or stored by kind, safe and unique names, a size limit', () => {
  const z = unzip(zipFiles([
    { name: 'Notes.txt', type: 'text/plain', buffer: Buffer.from('a'.repeat(1000)) },
    { name: 'notes.TXT', type: 'text/plain', buffer: Buffer.from('second') },
    { name: '../../etc/passwd', type: 'text/plain', buffer: Buffer.from('x') },
    { name: 'Ñandú: plan?.jpg', type: 'image/jpeg', buffer: photo },
    { name: 'Scan.pdf', type: 'application/pdf', buffer: scan },
  ]));
  assert.deepEqual(z.map((e) => e.name), ['Notes.txt', 'notes (2).TXT', '__.._etc_passwd', 'Ñandú_ plan_.jpg', 'Scan.pdf']);
  assert.ok(z.every((e) => !e.name.includes('/') && !e.name.includes('\\')), 'no folders, so nothing lands outside where it is unzipped');
  assert.equal(z[0].method, 8, 'text is compressed');
  assert.equal(z[3].method, 0, 'a photo is stored as it is');
  assert.deepEqual(z[3].data, photo);
  assert.deepEqual(z[4].data, scan);
  assert.equal(z[0].data.toString(), 'a'.repeat(1000));
  const big = { length: MAX_ZIP_BYTES + 1 };
  assert.throws(() => zipFiles([{ name: 'big.pdf', type: 'application/pdf', buffer: big }]), /Download them one by one/);
});

test('Download all for a task and a milestone: one ZIP named after it, for members only', async () => {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-zip-')), 'db.json'));
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
  const zipUrl = `/api/pm/tasks/${t.id}/files.zip`;
  assert.equal((await pia('GET', zipUrl)).status, 404, 'no files yet');
  for (const [name, buf] of [['Scan.pdf', scan], ['Photo.jpg', photo], ['Notes.txt', Buffer.from('Call the registrar.\n')]]) await pia('POST', `/api/pm/tasks/${t.id}/attachments`, { file: { name, data: buf.toString('base64') } });

  const res = await pia('GET', zipUrl);
  assert.equal(res.headers['Content-Type'], 'application/zip');
  assert.match(res.headers['Content-Disposition'], /^attachment; filename="LEA-1 files\.zip"/);
  assert.match(res.headers['Content-Security-Policy'], /sandbox/);
  const entries = unzip(res.buffer);
  assert.deepEqual(entries.map((e) => e.name), ['Scan.pdf', 'Photo.jpg', 'Notes.txt']);
  assert.deepEqual(entries[0].data, scan);
  assert.equal(entries[2].data.toString(), 'Call the registrar.\n');
  assert.equal((await paolo('GET', zipUrl)).status, 404, 'not for someone outside the project');
  assert.equal((await client()('GET', zipUrl)).status, 401);

  // A file missing on disk is left out; the others still come.
  const first = db.data.pmTasks.find((x) => x.id === t.id).attachments[0];
  fs.rmSync(path.join(db.dir, 'attachments', first.id));
  assert.deepEqual(unzip((await pia('GET', zipUrl)).buffer).map((e) => e.name), ['Photo.jpg', 'Notes.txt']);

  // A milestone's files.
  const full = await pia('GET', `/api/pm/projects/${p.id}`);
  const m = await pia('POST', `/api/pm/projects/${p.id}/milestones`, { name: 'Go-live', dueDate: localDate(), deliverable: true, version: full.version });
  const mid = m.id || m.milestones.at(-1).id;
  for (const [name, buf] of [['Acceptance.pdf', scan], ['Photo.jpg', photo]]) await pia('POST', `/api/pm/projects/${p.id}/milestones/${mid}/attachments`, { file: { name, data: buf.toString('base64') } });
  const mz = await pia('GET', `/api/pm/projects/${p.id}/milestones/${mid}/files.zip`);
  assert.match(mz.headers['Content-Disposition'], /filename="LEA Go-live files\.zip"/);
  assert.deepEqual(unzip(mz.buffer).map((e) => e.name), ['Acceptance.pdf', 'Photo.jpg']);
  handle.monitor.stop();
});
