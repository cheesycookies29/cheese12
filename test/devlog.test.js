// The dev log must stay well-formed and in step with package.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEVLOG, DEVLOG_MODULES, CHANGE_TYPES, APP_VERSION } from '../shared/devlog.js';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const semver = (v) => v.split('.').map(Number);
const newer = (a, b) => { const [x, y] = [semver(a), semver(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

test('dev log entries are well-formed, newest first, and match package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, APP_VERSION, 'Add a dev log entry for the new version (or bump package.json to match).');
  assert.equal(new Set(DEVLOG.map((r) => r.version)).size, DEVLOG.length, 'versions are unique');
  DEVLOG.forEach((r, i) => {
    assert.match(r.version, /^\d+\.\d+\.\d+$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.title && r.summary && r.changes.length, `${r.version} has a title, summary and changes`);
    for (const m of r.modules) assert.ok(DEVLOG_MODULES[m], `${r.version}: unknown module ${m}`);
    for (const [type, module, text] of r.changes) {
      assert.ok(CHANGE_TYPES[type], `${r.version}: unknown change type ${type}`);
      assert.ok(r.modules.includes(module), `${r.version}: change in ${module} but modules lists ${r.modules}`);
      assert.ok(text.length > 10);
    }
    if (i > 0) {
      assert.ok(newer(DEVLOG[i - 1].version, r.version) > 0, `${DEVLOG[i - 1].version} should be newer than ${r.version}`);
      assert.ok(DEVLOG[i - 1].date >= r.date, `${DEVLOG[i - 1].version} should not be dated before ${r.version}`);
    }
  });
});

test('only administrators can read the installed version', async () => {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-devlog-')), 'db.json'));
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    return async (method, url, body = {}) => {
      const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res.data;
    };
  };
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
  const about = await admin('GET', '/api/system/about');
  assert.equal(about.version, APP_VERSION);
  assert.ok(about.startedAt && about.node);
  await admin('POST', '/api/users', { name: 'IT', username: 'itstaff', role: 'it', password: 'secret123', mustChangePassword: false });
  const it = client();
  await it('POST', '/api/auth/login', { username: 'itstaff', password: 'secret123' });
  await assert.rejects(it('GET', '/api/system/about'), /does not have access/);
});
