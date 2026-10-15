// The dev log must stay well-formed and in step with package.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEVLOG, DEVLOG_MODULES, CHANGE_TYPES, APP_VERSION, compareVersions } from '../shared/devlog.js';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

test('dev log entries are well-formed, newest first, and match package.json', () => {
  assert.equal(DEVLOG.at(-1).version, '0.0.1-alpha', 'the log starts at the first alpha build');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, APP_VERSION, 'Add a dev log entry for the new version (or bump package.json to match).');
  assert.equal(new Set(DEVLOG.map((r) => r.version)).size, DEVLOG.length, 'versions are unique');
  DEVLOG.forEach((r, i) => {
    assert.match(r.version, /^\d+\.\d+\.\d+(-(alpha|beta|rc))?$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.title && r.notes && r.changes.length, `${r.version} has a title, notes and changes`);
    assert.ok(!r.known || (Array.isArray(r.known) && r.known.every((k) => typeof k === 'string' && k)), `${r.version}: known is a list of strings`);
    for (const m of r.modules) assert.ok(DEVLOG_MODULES[m], `${r.version}: unknown module ${m}`);
    for (const [type, module, text] of r.changes) {
      assert.ok(CHANGE_TYPES[type], `${r.version}: unknown change type ${type}`);
      assert.ok(r.modules.includes(module), `${r.version}: change in ${module} but modules lists ${r.modules}`);
      assert.ok(text.length > 10);
    }
    if (i > 0) {
      assert.ok(compareVersions(DEVLOG[i - 1].version, r.version) > 0, `${DEVLOG[i - 1].version} should be newer than ${r.version}`);
      assert.ok(DEVLOG[i - 1].date >= r.date, `${DEVLOG[i - 1].version} should not be dated before ${r.version}`);
    }
  });
});

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-devlog-')), 'db.json');
  const db = openDb(file);
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    return async (method, url, body = {}) => {
      const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res.data;
    };
  };
  return { file, db, client };
}

test('only administrators can read the installed version', async () => {
  const { client } = setup();
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

test('dev log: built-in entries are imported once; admins edit, add and delete; one author', async () => {
  const { file, db, client } = setup();
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ian Roca', username: 'admin', password: 'secret123' });
  let log = await admin('GET', '/api/devlog');
  assert.equal(log.entries.length, DEVLOG.length);
  assert.equal(log.entries[0].version, APP_VERSION);
  assert.equal(log.author, 'Ian Roca', 'defaults to the first administrator');

  const first = log.entries.find((e) => e.version === '0.0.1-alpha');
  log = await admin('PUT', `/api/devlog/${first.id}`, { ...first, title: 'Day one', changes: [['new', 'hr', 'Employee records and payroll.'], ['improved', 'system', 'Logo.']] });
  const edited = log.entries.find((e) => e.id === first.id);
  assert.equal(edited.title, 'Day one');
  assert.deepEqual(edited.modules, ['hr', 'system'], 'modules follow the changes');
  assert.ok(edited.updatedAt);

  const body = { version: 'v0.9.0-beta', date: '2026-11-01', title: 'Beta', notes: 'Getting ready.', changes: [['fixed', 'assets', 'A fix.']], known: 'One thing\n\nAnother' };
  log = await admin('POST', '/api/devlog', body);
  assert.equal(log.entries[0].version, '0.9.0-beta', 'sorted newest first, leading v dropped');
  assert.deepEqual(log.entries[0].known, ['One thing', 'Another']);
  await assert.rejects(admin('POST', '/api/devlog', body), /already an entry/);
  await assert.rejects(admin('POST', '/api/devlog', { ...body, version: '1.0' }), /Version must look like/);
  await assert.rejects(admin('POST', '/api/devlog', { ...body, version: '1.0.0', changes: [] }), /at least one change/);
  await assert.rejects(admin('POST', '/api/devlog', { ...body, version: '1.0.0', changes: [['new', 'nope', 'x y z']] }), /needs a module/);

  const second = log.entries.find((e) => e.version === '0.0.2-alpha');
  log = await admin('DELETE', `/api/devlog/${second.id}`);
  assert.ok(!log.entries.some((e) => e.version === '0.0.2-alpha'));
  log = await admin('PUT', '/api/devlog-author', { name: '  Ian R.  ' });
  assert.equal(log.author, 'Ian R.');

  // Restart and a demo-data load keep the edits, and a deleted built-in entry stays deleted.
  await admin('POST', '/api/admin/demo');
  const reopened = openDb(file);
  createApi(reopened);
  const entries = reopened.data.devlog.entries;
  assert.equal(entries.find((e) => e.id === first.id).title, 'Day one');
  assert.ok(entries.some((e) => e.version === '0.9.0-beta'));
  assert.ok(!entries.some((e) => e.version === '0.0.2-alpha'));
  assert.equal(reopened.data.devlog.author, 'Ian R.');
  assert.ok(db.data.devlog.entries.length > 0);

  await admin('POST', '/api/users', { name: 'IT', username: 'itstaff', role: 'it', password: 'secret123', mustChangePassword: false });
  const it = client();
  await it('POST', '/api/auth/login', { username: 'itstaff', password: 'secret123' });
  await assert.rejects(it('GET', '/api/devlog'), /does not have access/);
  await assert.rejects(it('POST', '/api/devlog', body), /does not have access/);
});
