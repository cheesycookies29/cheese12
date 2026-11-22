// Coming soon, shown or hidden (0.63): Admin panel → Modules lists the modules on the roadmap, the
// integrations and the coming-soon pages, each with a switch. Hidden ones are gone from the CORE
// home, the modules menu and the side menu for everyone; the setting is in the change history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { MODULES, INTEGRATIONS, ROADMAP, HIDEABLE, SWITCHABLE, cleanModuleConfig, defaultModuleConfig, shownOnRoadmap, moduleOn } from '../shared/modules.js';
import { SETTINGS } from '../shared/settings-catalog.js';

test('the roadmap: every module coming soon, every integration and Data replication', () => {
  assert.deepEqual(ROADMAP.filter((x) => x.kind === 'module').map((x) => x.id), MODULES.filter((m) => m.status !== 'live').map((m) => m.id));
  assert.deepEqual(ROADMAP.filter((x) => x.kind === 'integration').map((x) => x.id), INTEGRATIONS.map((i) => i.id));
  assert.deepEqual(ROADMAP.filter((x) => x.kind === 'feature').map((x) => x.id), ['replication']);
  assert.ok(!HIDEABLE.some((id) => SWITCHABLE.includes(id)), 'nothing is both');
  // Shown unless hidden; never mixed up with a live module being on.
  const d = defaultModuleConfig();
  assert.ok(HIDEABLE.every((id) => d[id] === true));
  const c = cleanModuleConfig({ finance: false, coderabbit: false, replication: 'no', crm: false, nonsense: false });
  assert.equal(c.finance, false);
  assert.equal(c.coderabbit, false);
  assert.equal(c.replication, true, 'only booleans');
  assert.equal(c.nonsense, undefined);
  assert.equal(shownOnRoadmap(c, 'finance'), false);
  assert.equal(shownOnRoadmap({}, 'finance'), true);
  assert.equal(moduleOn(c, 'finance'), true, 'not a switchable module');
  // In the Settings center, worded Shown / Hidden.
  for (const x of ROADMAP) assert.ok(SETTINGS.some(([area, p, , , f]) => area === 'modules' && p === x.id && f === 'shown'), x.id);
});

test('the screens leave out what is hidden', () => {
  const read = (p) => fs.readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');
  const home = read('views/launcher.js');
  assert.match(home, /MODULES\.filter\(\(m\) => m\.status !== 'live' && shown\(m\.id\)\)/);
  assert.match(home, /INTEGRATIONS\.filter\(\(i\) => shown\(i\.id\)\)/);
  assert.match(home, /\$\{integrations\.length \? html`<section/, 'no Integrations area when all are hidden');
  const app = read('app.js');
  assert.match(app, /MODULES\.filter\(\(m\) => m\.status !== 'live' && shown\(m\.id\)\)/, 'the modules menu');
  assert.match(app, /\(!n\.soon \|\| shown\(n\.soon\)\)/, 'the side menu');
  assert.match(read('views/assets.js'), /if \(!shown\('replication'\)\) return/);
  const admin = read('views/admin/modules.js');
  assert.match(admin, /data-roadmap="\$\{x\.id\}"/);
  assert.match(admin, /data-all="false">Hide all/);
});

test('API: administrators show and hide; everyone signed in gets the setting; it is audited', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-roadmap-'));
  const db = openDb(path.join(dir, 'db.json'));
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    return async (method, url, body = {}) => {
      try {
        const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.3' } }, new URL(url, 'http://localhost'), body);
        if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
        return res.data;
      } catch (err) {
        return { status: err.status, error: err.message };
      }
    };
  };
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'Correct-Horse-42' });
  await admin('POST', '/api/users', { name: 'Pia Manager', username: 'pia', role: 'pm', password: 'Correct-Horse-42', mustChangePassword: false });
  const pia = client();
  await pia('POST', '/api/auth/login', { username: 'pia', password: 'Correct-Horse-42' });

  const start = await admin('GET', '/api/admin/modules');
  assert.ok(HIDEABLE.every((id) => start.config[id] === true), 'all shown at first');
  assert.equal((await pia('PUT', '/api/admin/modules', { modules: { finance: false } })).status, 403);
  assert.match((await admin('PUT', '/api/admin/modules', { modules: { finance: 'hide' } })).error, /Finance & Accounting is shown or hidden/);
  assert.match((await admin('PUT', '/api/admin/modules', { modules: { teleport: false } })).error, /no module "teleport"/);
  const out = await admin('PUT', '/api/admin/modules', { modules: { finance: false, coderabbit: false, replication: false } });
  assert.equal(out.config.finance, false);
  assert.equal(out.config.crm, true, 'live modules untouched');
  // Everyone signed in reads it (the home and menus hide what is hidden).
  const status = await pia('GET', '/api/auth/status');
  assert.equal(status.modules.finance, false);
  assert.equal(status.modules.googlecloud, true);
  // The change history: "Finance & Accounting (coming soon): Shown → Hidden".
  const log = fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.action === 'settings.modules').pop();
  assert.deepEqual(log.changes.map((x) => [x.field, x.from, x.to]), [
    ['Finance & Accounting (coming soon)', 'Shown', 'Hidden'], ['CodeRabbit (coming soon)', 'Shown', 'Hidden'], ['Data replication (coming soon)', 'Shown', 'Hidden'],
  ]);
  // Hiding never turns a module off: the CRM API still answers, and showing again brings it back.
  await admin('PUT', '/api/admin/modules', { modules: Object.fromEntries(HIDEABLE.map((id) => [id, true])) });
  assert.ok(HIDEABLE.every((id) => db.data.modules[id] === true));
  // The Settings center lists them with their current value.
  const cfg = await admin('GET', '/api/admin/config');
  const row = (cfg.settings || []).find((s) => s.area === 'modules' && s.path === 'finance');
  if (row) assert.equal(row.value, true);
  handle.monitor.stop();
});
