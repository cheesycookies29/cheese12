// Profile pictures (0.22): each person sets or removes their own; only photos (by content), small;
// shown to everyone signed in with safe headers; an administrator can remove anyone's (audited);
// the file goes when the picture is replaced, removed, or the account deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-avatar-'));
const db = openDb(path.join(dir, 'db.json'));
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
async function account(username, role, name) {
  const u = await admin('POST', '/api/users', { name, username, role, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  c.id = u.id;
  return c;
}
const pia = await account('pia', 'pm', 'Pia Manager');
const ivan = await account('ivan', 'it', 'Ivan Agent');
const anon = client();
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);
const photo = (buf = JPEG) => ({ file: { name: 'me.jpg', data: buf.toString('base64') } });
const fileOf = (id) => path.join(dir, 'attachments', id);

test('you set your own picture; everyone signed in sees it, with safe headers; nobody else signed out', async () => {
  assert.deepEqual(await pia('GET', '/api/avatars'), {});
  const r = await pia('PUT', '/api/me/avatar', photo());
  assert.ok(r.avatar);
  assert.deepEqual(r.avatars, { [pia.id]: r.avatar });
  assert.deepEqual(await ivan('GET', '/api/avatars'), { [pia.id]: r.avatar });
  const res = await ivan.raw('GET', `/api/users/${pia.id}/avatar`);
  assert.ok(Buffer.isBuffer(res.data) && res.data.equals(JPEG));
  assert.equal(res.headers['Content-Type'], 'image/jpeg');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(res.headers['Content-Security-Policy'], /default-src 'none'; sandbox/);
  await fails(anon.raw('GET', `/api/users/${pia.id}/avatar`), 401);
  await fails(anon('GET', '/api/avatars'), 401);
  await fails(ivan.raw('GET', `/api/users/${ivan.id}/avatar`), 404);
  // The account the browser sees says when, never anything secret.
  const me = (await pia('GET', '/api/auth/status')).user;
  assert.equal(me.avatar.at, r.avatar);
  assert.equal(me.passwordHash, undefined);
});

test('only photos (by content, never SVG or HTML), at most 300 KB', async () => {
  await fails(ivan('PUT', '/api/me/avatar', photo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))), 400);
  await fails(ivan('PUT', '/api/me/avatar', photo(Buffer.from('%PDF-1.4\n'))), 400, /JPEG, PNG, WebP or GIF/);
  await fails(ivan('PUT', '/api/me/avatar', photo(Buffer.concat([JPEG, Buffer.alloc(310 * 1024)]))), 400, /300 KB/);
  await fails(ivan('PUT', '/api/me/avatar', {}), 400);
  assert.deepEqual(Object.keys(await ivan('GET', '/api/avatars')), [pia.id]);
});

test('a new picture replaces the old file; removing it deletes the file', async () => {
  const a = await ivan('PUT', '/api/me/avatar', photo());
  const first = db.data.users.find((u) => u.id === ivan.id).avatar.id;
  assert.ok(fs.existsSync(fileOf(first)));
  assert.equal((fs.statSync(fileOf(first)).mode & 0o777).toString(8), '600');
  await new Promise((r) => setTimeout(r, 5));
  const b = await ivan('PUT', '/api/me/avatar', photo());
  assert.notEqual(b.avatar, a.avatar, 'a new date: the browser fetches the new one');
  assert.ok(!fs.existsSync(fileOf(first)));
  const second = db.data.users.find((u) => u.id === ivan.id).avatar.id;
  const r = await ivan('DELETE', '/api/me/avatar');
  assert.equal(r.avatar, null);
  assert.ok(!fs.existsSync(fileOf(second)));
  assert.equal(db.data.users.find((u) => u.id === ivan.id).avatar, undefined);
});

test('an administrator removes someone\'s picture (audited); others cannot; deleting the account removes it', async () => {
  await ivan('PUT', '/api/me/avatar', photo());
  await fails(pia('DELETE', `/api/users/${ivan.id}/avatar`), 403);
  const u = await admin('DELETE', `/api/users/${ivan.id}/avatar`);
  assert.equal(u.avatar, undefined);
  await fails(admin('DELETE', `/api/users/${ivan.id}/avatar`), 400, /no picture/);
  const log = fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(log.some((e) => e.action === 'user.avatar-remove' && e.entityId === ivan.id));
  // Editing the account keeps the picture.
  const pic = db.data.users.find((x) => x.id === pia.id).avatar;
  await admin('PUT', `/api/users/${pia.id}`, { name: 'Pia M. Manager', username: 'pia', role: 'pm', active: true });
  assert.deepEqual(db.data.users.find((x) => x.id === pia.id).avatar, pic);
  await admin('DELETE', `/api/users/${pia.id}`);
  assert.ok(!fs.existsSync(fileOf(pic.id)));
  assert.deepEqual(await admin('GET', '/api/avatars'), {});
});

// A restore keeps profile pictures (0.32.1). The picture files are not in the backup file: they stay
// in the attachments folder, so a reference is kept only when its file is there and is that picture.
test('restoring a backup keeps everyone\'s picture; a reference without its file, or a broken one, is dropped', async () => {
  const rosa = await account('rosa', 'hr', 'Rosa Reyes');
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 2)]);
  const set = await ivan('PUT', '/api/me/avatar', { file: { name: 'me.png', data: PNG.toString('base64') } });
  const pic = db.data.users.find((u) => u.id === ivan.id).avatar;
  const backup = structuredClone(await admin('GET', '/api/admin/export')); // as a downloaded file
  const restore = (file) => admin('POST', '/api/admin/import', { ...structuredClone(file), password: 'secret123' });
  // After the backup, the picture is removed from the account (its file stays, as after any restore).
  delete db.data.users.find((u) => u.id === ivan.id).avatar;
  db.save();
  assert.deepEqual(await admin('GET', '/api/avatars'), {});

  assert.deepEqual(await restore(backup), { ok: true });
  assert.deepEqual(db.data.users.find((u) => u.id === ivan.id).avatar, pic);
  assert.deepEqual(await rosa('GET', '/api/avatars'), { [ivan.id]: set.avatar });
  const res = await rosa.raw('GET', `/api/users/${ivan.id}/avatar`);
  assert.ok(Buffer.isBuffer(res.data) && res.data.equals(PNG));
  assert.equal(res.headers['Content-Type'], 'image/png');

  // Broken references are dropped; the accounts are restored all the same.
  const ivanIn = (file) => file.users.find((u) => u.id === ivan.id);
  const rosaIn = (file) => file.users.find((u) => u.id === rosa.id);
  const broken = [
    ['an id in another format', { ...pic, id: '../db.json' }],
    ['a type that is not a picture', { ...pic, type: 'image/svg+xml' }],
    ['a type that is not the file\'s', { ...pic, type: 'image/jpeg' }],
    ['a size that is not a positive whole number', { ...pic, size: -1 }],
    ['a date that is not a date', { ...pic, at: 'yesterday' }],
    ['a long date', { ...pic, at: `${pic.at}${' '.repeat(40)}` }],
    ['not a picture at all', 'me.png'],
  ];
  for (const [what, avatar] of broken) {
    const file = structuredClone(backup);
    ivanIn(file).avatar = avatar;
    assert.deepEqual(await restore(file), { ok: true }, what);
    assert.equal(db.data.users.find((u) => u.id === ivan.id).avatar, undefined, what);
    assert.equal(db.data.users.length, backup.users.length, what);
  }
  // A picture whose file is not on this server (a backup from another server without its data folder).
  const elsewhere = structuredClone(backup);
  ivanIn(elsewhere).avatar = { ...pic, id: '00000000-0000-4000-8000-000000000000' };
  await restore(elsewhere);
  assert.deepEqual(await admin('GET', '/api/avatars'), {});
  // Another file on the server (a task file, a certificate) is not taken as someone's picture.
  const pdf = path.join(dir, 'attachments', '11111111-1111-4111-8111-111111111111');
  fs.writeFileSync(pdf, '%PDF-1.4\n');
  const other = structuredClone(backup);
  ivanIn(other).avatar = { ...pic, id: path.basename(pdf), type: 'image/jpeg' };
  await restore(other);
  assert.equal(db.data.users.find((u) => u.id === ivan.id).avatar, undefined);
  // One file is one account's picture: a second account naming the same file gets none.
  const shared = structuredClone(backup);
  rosaIn(shared).avatar = { ...pic };
  await restore(shared);
  assert.deepEqual(Object.keys(await admin('GET', '/api/avatars')), [ivan.id]);
  assert.equal(db.data.users.find((u) => u.id === rosa.id).avatar, undefined);
});
