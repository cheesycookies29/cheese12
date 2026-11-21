// Animated pictures (0.31): a profile picture or a project's icon can be a GIF, kept as it is (so it
// moves): known by its first bytes, at most 1 MB and 1024 pixels each way, served as image/gif with
// nosniff and a sandbox policy. Files on tasks, task description pictures and the logo stay as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { GIF_MAX_BYTES } from '../server/attachments.js';

const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-gif-')), 'db.json'));
const handle = createApi(db);
const client = () => {
  let cookie = '';
  const c = async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
  c.raw = (method, url, body = {}) => handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
  return c;
};
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
  return true;
});
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'secret123' });
const u = await admin('POST', '/api/users', { name: 'Pia Manager', username: 'pia', role: 'pm', password: 'secret123', mustChangePassword: false });
const pia = client();
await pia('POST', '/api/auth/login', { username: 'pia', password: 'secret123' });

// A 1 × 1 GIF, and one with a given canvas size and padding (the size is read from the header).
const GIF = Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex');
const gifOf = ({ w = 1, h = 1, pad = 0, head = 'GIF89a' } = {}) => {
  const b = Buffer.concat([GIF, Buffer.alloc(pad)]);
  b.write(head, 0, 'latin1');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
};
const file = (buf, name = 'me.gif') => ({ file: { name, data: buf.toString('base64') } });

test('a profile picture can be a GIF: kept byte for byte, served as image/gif, up to 1 MB', async () => {
  const big = gifOf({ w: 480, h: 360, pad: 600 * 1024 }); // over the 300 KB of a photo, under 1 MB
  const r = await pia('PUT', '/api/me/avatar', file(big));
  assert.ok(r.avatar);
  const res = await pia.raw('GET', `/api/users/${u.id}/avatar`);
  assert.ok(res.data.equals(big), 'not re-encoded: it still moves');
  assert.equal(res.headers['Content-Type'], 'image/gif');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(res.headers['Content-Security-Policy'], /default-src 'none'; sandbox/);
  // GIF87a too.
  await pia('PUT', '/api/me/avatar', file(gifOf({ head: 'GIF87a' })));
});

test('a GIF is refused when too large, too big on screen, or not a GIF inside', async () => {
  await fails(pia('PUT', '/api/me/avatar', file(gifOf({ pad: GIF_MAX_BYTES }))), 400, /The GIF is too large .* The limit is 1 MB/);
  await fails(pia('PUT', '/api/me/avatar', file(gifOf({ w: 1025, h: 200 }))), 400, /too big \(1025 × 200 pixels\)/);
  await fails(pia('PUT', '/api/me/avatar', file(gifOf({ w: 0, h: 10 }))), 400, /could not be read/);
  await fails(pia('PUT', '/api/me/avatar', file(Buffer.from('GIF89a'))), 400, /could not be read/);
  // Named .gif but HTML or SVG inside: refused by content.
  await fails(pia('PUT', '/api/me/avatar', file(Buffer.from('<svg onload="alert(1)"/>'))), 400, /JPEG, PNG, WebP or GIF/);
  await fails(pia('PUT', '/api/me/avatar', file(Buffer.from('GIF89<script>alert(1)</script>'))), 400, /JPEG, PNG, WebP or GIF/);
});

test('a project\'s icon can be a GIF, and so can a file on its tasks (0.56); description pictures cannot', async () => {
  const p = await pia('POST', '/api/pm/projects', { name: 'Lively project', type: 'Internal', startDate: '2026-11-02' });
  const g = gifOf({ w: 200, h: 200, pad: 500 * 1024 });
  const saved = await pia('PUT', `/api/pm/projects/${p.id}/icon`, file(g, 'icon.gif'));
  assert.ok(saved.iconImage?.at);
  const res = await pia.raw('GET', `/api/pm/projects/${p.id}/icon`);
  assert.ok(res.data.equals(g));
  assert.equal(res.headers['Content-Type'], 'image/gif');
  await assert.rejects(pia('PUT', `/api/pm/projects/${p.id}/icon`, file(gifOf({ w: 2000, h: 2000 }))), /too big/);
  // A copy of the project gets its own copy of the GIF.
  const copy = await pia('POST', `/api/pm/projects/${p.id}/copy`, { name: 'Lively copy', startDate: '2026-11-09' });
  assert.equal((await pia.raw('GET', `/api/pm/projects/${copy.id}/icon`)).headers['Content-Type'], 'image/gif');
  // A task's files take GIFs (0.56); its description pictures stay JPEG, PNG and WebP.
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'A task' });
  assert.equal((await pia('POST', `/api/pm/tasks/${t.id}/attachments`, file(GIF, 'a.gif'))).attachments[0].type, 'image/gif');
  await assert.rejects(pia('POST', `/api/pm/tasks/${t.id}/images`, file(GIF, 'a.gif')), /PDF or a photo|JPEG, PNG or WebP/);
});
