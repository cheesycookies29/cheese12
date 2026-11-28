// Modules pinned to the front of the CORE home (0.40), and C-suite on the roadmap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { MODULES, SWITCHABLE, PINNABLE, cleanFavoriteModules } from '../shared/modules.js';

const PW = 'Correct-Horse-42';
function company() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pins-'));
  const db = openDb(path.join(dir, 'db.json'));
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
  return { db, handle, client };
}

test('C-suite is on the roadmap as an executive dashboard, coming soon, and cannot be turned on or pinned', () => {
  const m = MODULES.find((x) => x.id === 'csuite');
  assert.ok(m);
  assert.equal(m.name, 'C-suite');
  assert.equal(m.status, 'soon');
  assert.match(m.description, /executive dashboard/i);
  assert.ok(!SWITCHABLE.includes('csuite'));
  assert.ok(!PINNABLE.includes('csuite'));
  assert.equal(new Set(MODULES.map((x) => x.code)).size, MODULES.length, 'module codes are unique');
});

test('cleanFavoriteModules keeps live modules once, in order, and drops the rest', () => {
  assert.deepEqual(cleanFavoriteModules(['projects', 'hr', 'projects', 'csuite', 'nope', 7, null, '__proto__']), ['projects', 'hr']);
  assert.deepEqual(cleanFavoriteModules([]), []);
  assert.equal(cleanFavoriteModules('hr'), null);
  assert.equal(cleanFavoriteModules({ 0: 'hr' }), null);
});

test('each person pins their own modules; the list is saved on the account and comes back after signing in', async () => {
  const { handle, client } = company();
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await admin('POST', '/api/users', { name: 'Eli PM', username: 'eli', role: 'pm', password: PW, mustChangePassword: false });
  const eli = client();
  await eli('POST', '/api/auth/login', { username: 'eli', password: PW });

  assert.deepEqual(await admin('PUT', '/api/me/favorite-modules', { modules: ['projects', 'csuite', 'hr'] }), { favoriteModules: ['projects', 'hr'] });
  assert.deepEqual(await eli('PUT', '/api/me/favorite-modules', { modules: ['helpdesk'] }), { favoriteModules: ['helpdesk'] });
  assert.equal((await eli('PUT', '/api/me/favorite-modules', { modules: 'helpdesk' })).status, 400);
  assert.equal((await eli('PUT', '/api/me/favorite-modules', {})).status, 400);

  // Signed in again (another device): the same pins, each person their own.
  const again = client();
  const me = await again('POST', '/api/auth/login', { username: 'admin', password: PW });
  assert.deepEqual((me.user || me).favoriteModules, ['projects', 'hr']);
  const status = await eli('GET', '/api/auth/status');
  assert.deepEqual(status.user.favoriteModules, ['helpdesk']);

  // Unpinning everything leaves an empty list; signed out, nothing can be saved.
  assert.deepEqual(await eli('PUT', '/api/me/favorite-modules', { modules: [] }), { favoriteModules: [] });
  assert.equal((await client()('PUT', '/api/me/favorite-modules', { modules: ['hr'] })).status, 401);
  handle.monitor.stop();
});

test('pinned modules survive a backup and restore; unknown ones in a backup are dropped', async () => {
  const { db, handle, client } = company();
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await admin('PUT', '/api/me/favorite-modules', { modules: ['crm', 'assets'] });
  const backup = JSON.parse(JSON.stringify(db.data));
  backup.users[0].favoriteModules = ['crm', 'csuite', 'assets', 'gone'];
  await admin('PUT', '/api/me/favorite-modules', { modules: [] });
  const r = await admin('POST', '/api/admin/import', { ...backup, password: PW });
  assert.ok(!r.error, r.error);
  assert.deepEqual(db.data.users[0].favoriteModules, ['crm', 'assets']);
  handle.monitor.stop();
});

test('GIVEN the customapp module WHEN favourite modules are computed THEN customapp is handled like every other module', () => {
  const m = MODULES.find((x) => x.id === 'customapp');
  assert.deepEqual([m.name, m.code, m.status, m.glyph], ['Corp Comm YEP tool', 'MOD-10', 'live', 'party']);
  assert.ok(PINNABLE.includes('customapp'));
  assert.ok(SWITCHABLE.includes('customapp'));
  assert.deepEqual(cleanFavoriteModules(['customapp', 'hr', 'customapp']), ['customapp', 'hr']);
});
