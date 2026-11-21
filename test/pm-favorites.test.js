// Favorite projects (0.51): each person stars the projects they want at hand. Only projects they
// can open count (no templates); the list is theirs alone, kept in the order starred, and a
// project they lose access to drops out of it by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';

const PW = 'Correct-Horse-42';

test('favorite projects: starred in order, only reachable projects, per person, gone with access', async () => {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-fav-')), 'db.json'));
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    return async (method, url, body = {}) => {
      try {
        const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.5' } }, new URL(url, 'http://localhost'), body);
        if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
        return res.data;
      } catch (err) {
        return { status: err.status, error: err.message };
      }
    };
  };
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const users = {};
  for (const [name, username] of [['Pia Manager', 'pia'], ['Paolo Manager', 'paolo']]) {
    users[username] = await admin('POST', '/api/users', { name, username, role: 'pm', password: PW, mustChangePassword: false });
  }
  const login = async (username) => {
    const c = client();
    await c('POST', '/api/auth/login', { username, password: PW });
    return c;
  };
  const pia = await login('pia');
  const paolo = await login('paolo');
  const start = localDate();
  const a = await pia('POST', '/api/pm/projects', { name: 'Clinic rollout', type: 'Client', startDate: start });
  const b = await pia('POST', '/api/pm/projects', { name: 'Payroll upgrade', type: 'Internal', startDate: start });
  const c = await paolo('POST', '/api/pm/projects', { name: 'Paolo only', type: 'Internal', startDate: start });
  assert.ok(a.id && b.id && c.id, a.error || b.error || c.error);
  const tpl = await pia('POST', '/api/pm/projects', { name: 'A template', type: 'Internal', startDate: start });
  await pia('PUT', `/api/pm/projects/${tpl.id}`, { isTemplate: true, version: (await pia('GET', `/api/pm/projects/${tpl.id}`)).version });
  assert.equal(db.data.pmProjects.find((p) => p.id === tpl.id).isTemplate, true);

  // Starred in order; Paolo's project (not hers), a template, an unknown id and repeats are dropped.
  const r = await pia('PUT', '/api/pm/favorites', { projects: [b.id, a.id, c.id, tpl.id, 'nope', a.id, 7] });
  assert.deepEqual(r.favoriteProjects, [b.id, a.id]);
  assert.deepEqual(r.favorites.map((p) => p.name), ['Payroll upgrade', 'Clinic rollout']);
  assert.deepEqual((await pia('GET', '/api/pm/favorites')).favorites.map((p) => p.id), [b.id, a.id]);
  assert.deepEqual((await pia('GET', '/api/pm/overview')).favorites, [b.id, a.id], 'the overview says which come first');
  assert.equal((await pia('PUT', '/api/pm/favorites', { projects: a.id })).status, 400);
  assert.equal((await client()('PUT', '/api/pm/favorites', { projects: [] })).status, 401);

  // Each person their own; signed in again, the same list.
  assert.deepEqual((await paolo('GET', '/api/pm/favorites')).favorites, []);
  assert.deepEqual((await (await login('pia'))('GET', '/api/auth/status')).user.favoriteProjects, [b.id, a.id]);

  // Paolo is added to Clinic rollout and stars it; taken off it again, it drops out of his list.
  const fresh = await pia('GET', `/api/pm/projects/${a.id}`);
  await pia('PUT', `/api/pm/projects/${a.id}/members`, { version: fresh.version, members: [...fresh.members.map(({ userId, role }) => ({ userId, role })), { userId: users.paolo.id, role: 'member' }] });
  assert.deepEqual((await paolo('PUT', '/api/pm/favorites', { projects: [c.id, a.id] })).favoriteProjects, [c.id, a.id]);
  const again = await pia('GET', `/api/pm/projects/${a.id}`);
  await pia('PUT', `/api/pm/projects/${a.id}/members`, { version: again.version, members: again.members.filter((m) => m.userId !== users.paolo.id).map(({ userId, role }) => ({ userId, role })) });
  assert.deepEqual((await paolo('GET', '/api/pm/favorites')).favorites.map((p) => p.id), [c.id]);
  assert.deepEqual((await paolo('GET', '/api/pm/overview')).favorites, [c.id]);

  // Unstarring everything leaves an empty list.
  assert.deepEqual((await pia('PUT', '/api/pm/favorites', { projects: [] })).favoriteProjects, []);
  handle.monitor.stop();
});

test('favorite projects survive a backup and restore', async () => {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-fav2-')), 'db.json'));
  const handle = createApi(db);
  let cookie = '';
  const admin = async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.5' } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const p = await admin('POST', '/api/pm/projects', { name: 'Kept', type: 'Internal', startDate: localDate() });
  await admin('PUT', '/api/pm/favorites', { projects: [p.id] });
  const backup = JSON.parse(JSON.stringify(db.data));
  await admin('PUT', '/api/pm/favorites', { projects: [] });
  const r = await admin('POST', '/api/admin/import', { ...backup, password: PW });
  assert.ok(!r.error, r.error);
  assert.deepEqual(db.data.users[0].favoriteProjects, [p.id]);
  handle.monitor.stop();
});
