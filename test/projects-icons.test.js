// Project icons (0.19): a project's own icon (a picture from the set on a colour) or its letter tile,
// checked on the way in, kept on edits, carried by template copies and sent with the project
// wherever its name is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { parseProjectIcon, letterTile, PROJECT_ICONS, PROJECT_ICON_COLORS, addDays } from '../shared/projects.js';
import { iconSvg } from '../public/js/icons.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pmicon-'));
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
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
await admin('POST', '/api/users', { name: 'Pia Manager', username: 'pia', role: 'pm', password: 'secret123', mustChangePassword: false });
const pia = client();
await pia('POST', '/api/auth/login', { username: 'pia', password: 'secret123' });
const day = (n) => addDays(localDate(), n);

test('every icon in the set exists in CORE\'s icon library', () => {
  const none = iconSvg('no-such-icon');
  for (const k of Object.keys(PROJECT_ICONS)) assert.notEqual(iconSvg(k), none, `icon ${k}`);
});

test('parseProjectIcon: empty means the letter tile; only listed icons and colours pass', () => {
  for (const v of [null, undefined, '']) assert.equal(parseProjectIcon(v), null);
  assert.deepEqual(parseProjectIcon({ glyph: 'cap', color: 'blue', extra: 'x' }), { glyph: 'cap', color: 'blue' });
  assert.throws(() => parseProjectIcon({ glyph: 'nope', color: 'blue' }), /icon from the list/);
  assert.throws(() => parseProjectIcon({ glyph: 'cap', color: '#fff' }), /colour from the list/);
  assert.throws(() => parseProjectIcon({ glyph: '__proto__', color: 'blue' }), /icon from the list/);
  assert.throws(() => parseProjectIcon('cap'), /icon from the list/);
  assert.throws(() => parseProjectIcon(['cap', 'blue']), /icon from the list/);
});

test('letterTile: the first letter or digit, upper case, and a steady colour from the code', () => {
  assert.equal(letterTile('ánimo project', 'PRJ-1').letter, 'Á');
  assert.equal(letterTile('  2027 budget', 'PRJ-2').letter, '2');
  assert.equal(letterTile('', '').letter, '?');
  const a = letterTile('Alpha', 'PRJ-0001');
  assert.deepEqual(letterTile('Alpha', 'PRJ-0001'), a);
  assert.ok(Object.hasOwn(PROJECT_ICON_COLORS, a.color) && a.color !== 'gray');
});

test('a project keeps its icon through edits, can go back to the letter, and refuses others', async () => {
  const p = await pia('POST', '/api/pm/projects', { name: 'Campus rollout', type: 'Client', startDate: day(0), icon: { glyph: 'cap', color: 'teal' } });
  assert.deepEqual(p.icon, { glyph: 'cap', color: 'teal' });
  // An edit that does not mention the icon keeps it.
  const e1 = await pia('PUT', `/api/pm/projects/${p.id}`, { name: 'Campus rollout, phase 1', version: p.version });
  assert.deepEqual(e1.icon, { glyph: 'cap', color: 'teal' });
  await assert.rejects(pia('PUT', `/api/pm/projects/${p.id}`, { icon: { glyph: 'cap', color: 'pink' }, version: e1.version }), /colour from the list/);
  await assert.rejects(pia('PUT', `/api/pm/projects/${p.id}`, { icon: { glyph: '<svg onload=x>', color: 'blue' }, version: e1.version }), /icon from the list/);
  const e2 = await pia('PUT', `/api/pm/projects/${p.id}`, { icon: null, version: e1.version });
  assert.equal(e2.icon, null);
  const e3 = await pia('PUT', `/api/pm/projects/${p.id}`, { icon: { glyph: 'shield', color: 'brand' }, version: e2.version });
  assert.deepEqual(db.data.pmProjects.find((x) => x.id === p.id).icon, { glyph: 'shield', color: 'brand' });

  // Sent wherever the name is shown: the portfolio, the project, My work, Milestones.
  const ov = await pia('GET', '/api/pm/overview');
  assert.deepEqual(ov.projects.find((x) => x.id === p.id).icon, e3.icon);
  const one = await pia('GET', `/api/pm/projects/${p.id}`);
  assert.deepEqual(one.icon ?? one.project?.icon, e3.icon);
  await pia('POST', `/api/pm/projects/${p.id}/milestones`, { name: 'Go-live', dueDate: day(20) });
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Train the registrars', assigneeId: db.data.users.find((u) => u.username === 'pia').id, dueDate: day(3) });
  assert.ok(t.id);
  const mine = Object.values(await pia('GET', '/api/pm/my-work')).flat();
  assert.deepEqual(mine.find((x) => x.id === t.id).project.icon, e3.icon);
  const ms = await pia('GET', '/api/pm/milestones');
  assert.deepEqual((ms.rows || ms).find((r) => r.projectId === p.id).projectIcon, e3.icon);
});

test('a copy (or a project from a template) takes the source\'s icon unless one is picked', async () => {
  const src = await pia('POST', '/api/pm/projects', { name: 'Clinic template', type: 'Client', startDate: day(0), icon: { glyph: 'heart', color: 'red' } });
  const same = await pia('POST', `/api/pm/projects/${src.id}/copy`, { name: 'Clinic A', startDate: day(7) });
  assert.deepEqual(same.icon, { glyph: 'heart', color: 'red' });
  const own = await pia('POST', `/api/pm/projects/${src.id}/copy`, { name: 'Clinic B', startDate: day(7), icon: { glyph: 'building', color: 'violet' } });
  assert.deepEqual(own.icon, { glyph: 'building', color: 'violet' });
  const letter = await pia('POST', `/api/pm/projects/${src.id}/copy`, { name: 'Clinic C', startDate: day(7), icon: null });
  assert.equal(letter.icon, null);
  await assert.rejects(pia('POST', `/api/pm/projects/${src.id}/copy`, { name: 'Clinic D', startDate: day(7), icon: { glyph: 'heart', color: 'x' } }), /colour from the list/);
});

test('demo projects come with icons, and some with the letter tile', async () => {
  await admin('POST', '/api/admin/demo');
  const demo = db.data.pmProjects.filter((p) => p.code.startsWith('DEMO-'));
  assert.ok(demo.some((p) => p.icon) && demo.some((p) => !p.icon));
  for (const p of demo.filter((x) => x.icon)) assert.deepEqual(parseProjectIcon(p.icon), p.icon);
});

// ===== 0.26: a project's own picture =====
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const pic = (buf = PNG) => ({ file: { name: 'logo.png', data: buf.toString('base64') } });

test('a project\'s own picture: managers set and remove it; members see it; nobody else; images only', async () => {
  const p = await pia('POST', '/api/pm/projects', { name: 'Logo project', type: 'Client', startDate: day(0), icon: { glyph: 'cap', color: 'teal' } });
  const withPic = await pia('PUT', `/api/pm/projects/${p.id}/icon`, pic());
  assert.ok(withPic.iconImage?.at);
  assert.deepEqual(withPic.icon, { glyph: 'cap', color: 'teal' }, 'the icon from the set is kept underneath');
  const res = await pia.raw('GET', `/api/pm/projects/${p.id}/icon`);
  assert.ok(Buffer.isBuffer(res.data) && res.data.equals(PNG));
  assert.equal(res.headers['Content-Type'], 'image/png');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(res.headers['Content-Security-Policy'], /default-src 'none'; sandbox/);
  // Lists carry its date, so the address changes with a new picture.
  const ov = await pia('GET', '/api/pm/overview');
  assert.equal(ov.projects.find((x) => x.id === p.id).iconImage.at, withPic.iconImage.at);
  // Only pictures, by content; at most 300 KB.
  await assert.rejects(pia('PUT', `/api/pm/projects/${p.id}/icon`, pic(Buffer.from('<svg onload="alert(1)"/>'))), (e) => e.status === 400);
  await assert.rejects(pia('PUT', `/api/pm/projects/${p.id}/icon`, pic(Buffer.from('%PDF-1.4\n'))), /JPEG, PNG or WebP/);
  await assert.rejects(pia('PUT', `/api/pm/projects/${p.id}/icon`, pic(Buffer.concat([PNG, Buffer.alloc(310 * 1024)]))), /300 KB/);
  // Someone not on the project: not found; a member who is not a manager cannot change it.
  const outsider = client();
  await admin('POST', '/api/users', { name: 'Olga Out', username: 'olga', role: 'pm', password: 'secret123', mustChangePassword: false });
  await outsider('POST', '/api/auth/login', { username: 'olga', password: 'secret123' });
  await assert.rejects(outsider.raw('GET', `/api/pm/projects/${p.id}/icon`), (e) => e.status === 404);
  // A copy brings its own copy of the picture; removing the original's leaves the copy's.
  const copy = await pia('POST', `/api/pm/projects/${p.id}/copy`, { name: 'Logo project 2', startDate: day(5) });
  assert.ok(copy.iconImage?.at);
  const copyFile = db.data.pmProjects.find((x) => x.id === copy.id).iconImage.id;
  const origFile = db.data.pmProjects.find((x) => x.id === p.id).iconImage.id;
  assert.notEqual(copyFile, origFile);
  const removed = await pia('DELETE', `/api/pm/projects/${p.id}/icon`);
  assert.equal(removed.iconImage, undefined);
  assert.ok(!fs.existsSync(path.join(dir, 'attachments', origFile)));
  assert.ok(fs.existsSync(path.join(dir, 'attachments', copyFile)));
  await assert.rejects(pia('DELETE', `/api/pm/projects/${p.id}/icon`), /no picture/);
  // Deleting the project deletes its picture.
  await pia('DELETE', `/api/pm/projects/${copy.id}`);
  assert.ok(!fs.existsSync(path.join(dir, 'attachments', copyFile)));
});
