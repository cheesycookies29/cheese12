// System → Security monitor (after CORE ERP's): the collector (buckets of fixed size, route
// templates, capped addresses, signals), the page's data and who sees it, the metrics export and its
// token, the backup and file checks, and a real server counting what it answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setup } from './support.js';
import { openDb } from '../server/db.js';
import { createMonitor, signalOf, auditSignal, isProbe, percentile, TIERS, MAX_ADDRESSES, OTHERS, UNKNOWN_ROUTE } from '../server/monitor.js';
import { NODE_END_OF_LIFE, tokenMatches, newToken } from '../server/monitor-panel.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = 'password123';
const status = (code) => (e) => e.status === code;
const tmpDir = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `atlas-monitor-${n}-`));

async function school(env = setup()) {
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  return { env, admin };
}

// ----- The collector -----
test('signals: refusals by status and route, sign-in pages left to the audit, scanner paths', () => {
  assert.equal(signalOf({ status: 401, kind: 'api', route: '/api/system/users', method: 'GET' }), 'unauthenticated');
  assert.equal(signalOf({ status: 401, kind: 'api', route: '/api/hub/login', method: 'POST' }), null, 'a wrong password is the audit\'s failed sign-in');
  assert.equal(signalOf({ status: 429, kind: 'api', route: '/api/admin/auth/login', method: 'POST' }), null, 'a locked username too');
  assert.equal(signalOf({ status: 429, kind: 'api', route: '/api/system/users', method: 'GET' }), 'rate-limited');
  assert.equal(signalOf({ status: 403, kind: 'api', route: '/api/admin/users', method: 'GET' }), 'denied');
  assert.equal(signalOf({ status: 404, kind: 'api', route: UNKNOWN_ROUTE, method: 'GET' }), 'unknown-route');
  assert.equal(signalOf({ status: 404, kind: 'api', route: '/api/system/users/:id', method: 'GET' }), null, 'a record that is not there is not an attack');
  assert.equal(signalOf({ status: 413, kind: 'api' }), 'too-large');
  assert.equal(signalOf({ status: 415, kind: 'api' }), 'not-json');
  for (const p of ['/.env', '/wp-admin/', '/index.php', '/.git/config', '/cgi-bin/x']) assert.ok(isProbe(p), p);
  for (const p of ['/admin', '/api/system/monitor', '/.well-known/security.txt', '/hris/']) assert.ok(!isProbe(p), p);
  assert.equal(signalOf({ status: 200, kind: 'page', path: '/.env' }), 'probe');
  // The audit trail's sign-in entries.
  assert.equal(auditSignal({ kind: 'signin', outcome: 'failed', action: 'Sign-in failed: wrong password' }), 'login-failed');
  assert.equal(auditSignal({ kind: 'signin', outcome: 'failed', action: 'Sign-in refused: username locked' }), 'locked');
  assert.equal(auditSignal({ kind: 'signin', outcome: 'failed', action: 'Sign-in refused: too many wrong passwords from this address' }), 'address-paused');
  assert.equal(auditSignal({ kind: 'password', outcome: 'failed', action: 'Password change failed: wrong current password' }), 'password-failed');
  assert.equal(auditSignal({ kind: 'signin', outcome: 'ok', action: 'Signed in' }), null);
});

test('buckets: fixed tiers, route templates, capped addresses, percentiles, changes by system', () => {
  let t = Date.parse('2026-11-16T08:00:30');
  const m = createMonitor(null, { now: () => t });
  const seen = (o) => m.observe({ method: 'GET', kind: 'api', status: 200, ms: 20, ip: '10.0.0.1', ...o });
  seen({ route: '/api/system/users/:id', path: '/api/system/users/abc' });
  seen({ route: '/api/system/users/:id', path: '/api/system/users/def', ms: 900 });
  seen({ method: 'PUT', route: '/api/hris/employees/:id', path: '/api/hris/employees/1', userId: 'u1' });
  seen({ method: 'POST', route: '/api/finance/dvs', path: '/api/finance/dvs', userId: 'u1', status: 400 });
  const b = m.merge(m.series('1h').buckets);
  assert.deepEqual(Object.keys(b.routes).sort(), ['GET /api/system/users/:id', 'POST /api/finance/dvs', 'PUT /api/hris/employees/:id'], 'by template, never the address with its ids');
  assert.equal(b.routes['GET /api/system/users/:id'].n, 2);
  assert.deepEqual(b.act, { people: 1 }, 'a change that went through counts for its system; a refused one does not');
  assert.equal(percentile([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 50), 37.5);
  assert.equal(percentile(Array(15).fill(0), 95), null);
  // Addresses are capped per bucket; the rest count together.
  for (let i = 0; i < MAX_ADDRESSES + 20; i++) seen({ route: '/api/x', path: '/api/x', ip: `10.1.${Math.floor(i / 250)}.${i % 250}` });
  const ips = m.series('1h').buckets.at(-1).ips;
  assert.equal(Object.keys(ips).length, MAX_ADDRESSES + 1);
  assert.ok(ips[OTHERS].n >= 20);
  // Time moves on: each tier keeps a fixed number of buckets.
  for (let h = 0; h < 200; h++) {
    t += 3600000;
    seen({ route: '/api/x', path: '/api/x' });
  }
  assert.equal(m.series('1h').buckets.length, 60);
  assert.equal(m.series('7d').buckets.length, 168);
  assert.ok(m.series('30d').buckets.length === 30);
  m.stop();
  assert.equal(TIERS.hour.keep, 168);
});

test('the file: saved privately, read back after a restart; the token kept only as a hash', () => {
  const dir = tmpDir('file');
  const m = createMonitor(dir);
  m.observe({ method: 'GET', kind: 'api', route: '/api/x', path: '/api/x', status: 200, ms: 5, ip: '10.0.0.9' });
  const { token, saved } = newToken({ name: 'Ada' });
  m.setToken(saved);
  m.stop();
  const file = path.join(dir, 'monitor.json');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes(token), 'the token itself is never written');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0, 'readable by ATLAS only');
  const again = createMonitor(dir);
  assert.equal(again.merge(again.series('1h').buckets).n, 1, 'the history survives a restart');
  assert.ok(tokenMatches(again.token(), `Bearer ${token}`));
  assert.ok(!tokenMatches(again.token(), `Bearer ${token}x`));
  assert.ok(!tokenMatches(again.token(), token), 'only as a bearer token');
  again.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ----- The page -----
test('the page: administrators only; sign-in problems, refusals and checks; who is signed in', async () => {
  const { env, admin } = await school();
  // A wrong password, and a username locked after five.
  await admin.post('/api/admin/users', { role: 'registrar', username: 'reg', name: 'Rhea Registrar', password: PW, mustChangePassword: false });
  const stranger = env.client();
  for (let i = 0; i < 6; i++) await stranger.post('/api/hub/login', { username: 'reg', password: `wrong${i}` }).catch(() => {});
  // A refusal reported by the web server (server.js), as it would be.
  env.api.monitor.observe({ method: 'POST', kind: 'api', route: '/api/system/users', path: '/api/system/users', status: 403, ms: 3, ip: '203.0.113.7', signal: 'cross-site' });
  const reg = env.client();
  await reg.post('/api/hub/login', { username: 'reg', password: PW }).catch(() => {}); // still locked
  const v = await admin.get('/api/system/monitor?range=1h');
  const count = (list, name) => list.find((x) => x.name === name).count;
  assert.equal(count(v.api.signIn, 'login-failed'), 5);
  assert.ok(count(v.api.signIn, 'locked') >= 1);
  assert.equal(count(v.api.refusals, 'cross-site'), 1);
  assert.ok(v.api.inventory.total > 300 && v.api.inventory.public.includes('POST /api/hub/login'));
  assert.ok(!v.api.inventory.public.some((r) => r.startsWith('GET /api/system/monitor ')), 'the page is not public');
  assert.ok(v.status.checks.some((c) => c.id === 'audit-chain' && c.state === 'ok'));
  assert.ok(v.status.checks.some((c) => c.id === 'node'));
  assert.equal(v.activity.now.people, 1, 'the administrator');
  assert.ok(v.activity.signInLog.some((e) => e.outcome === 'locked'));
  assert.ok(v.activity.signInLog.some((e) => e.outcome === 'signed-in' && e.name === 'Ada Admin'));
  assert.equal(v.series.length, 60);
  // Nobody else: a registrar (admin panel, but not an administrator), nobody signed in.
  const regUser = env.db.data.users.find((u) => u.username === 'reg');
  await admin.post(`/api/system/users/${regUser.id}/unlock`, {});
  const regClient = env.client();
  await regClient.post('/api/admin/auth/login', { username: 'reg', password: PW });
  await assert.rejects(regClient.get('/api/system/monitor'), status(403));
  await assert.rejects(regClient.post('/api/system/monitor/token', {}), status(403));
  await assert.rejects(env.client().get('/api/system/monitor'), status(401));
});

test('metrics: off until a token is made; the token works once shown, is audited, and can be revoked', async () => {
  const { env, admin } = await school();
  const metrics = (auth) => env.api({ method: 'GET', headers: auth ? { authorization: auth } : {} }, new URL('http://localhost/api/system/monitor/metrics'), {});
  await assert.rejects(metrics('Bearer x'), status(404));
  const made = await admin.post('/api/system/monitor/token', {});
  assert.match(made.token, /^atlas_mt_/);
  await assert.rejects(metrics(), status(401));
  await assert.rejects(metrics(`Bearer ${made.token}0`), status(401));
  const out = await metrics(`Bearer ${made.token}`);
  assert.match(out.type, /^text\/plain/);
  assert.match(out.raw, /# TYPE http_server_requests_total counter/);
  assert.match(out.raw, /atlas_security_events_total\{signal="login-failed",owasp="API2"\} \d+/);
  assert.match(out.raw, /atlas_audit_chain_intact 1/);
  assert.ok(!out.raw.includes('Ada Admin') && !out.raw.includes('127.0.0.1'), 'no names or addresses');
  const v = await admin.get('/api/system/monitor');
  assert.equal(v.api.metrics.token.createdBy, 'Ada Admin');
  assert.ok(!JSON.stringify(v).includes(made.token), 'shown once only');
  const again = await admin.post('/api/system/monitor/token', {});
  await assert.rejects(metrics(`Bearer ${made.token}`), status(401), 'the old one stops working');
  await metrics(`Bearer ${again.token}`);
  await admin.del('/api/system/monitor/token');
  await assert.rejects(metrics(`Bearer ${again.token}`), status(404));
  const trail = env.api.audit.entries().map((e) => e.action);
  assert.ok(trail.includes('Made a metrics token') && trail.some((a) => a.startsWith('Replaced the metrics token')) && trail.includes('Revoked the metrics token'));
});

test('backup and data files: a downloaded backup is noted; the data file is saved privately', async () => {
  const dir = tmpDir('data');
  const db = openDb(path.join(dir, 'db.json'));
  const { admin, env } = await school(setup({ db }));
  const check = async (id) => (await admin.get('/api/system/monitor')).status.checks.find((c) => c.id === id);
  assert.equal((await check('backup')).state, 'warn');
  await admin.get('/api/admin/backup');
  const b = await check('backup');
  assert.equal(b.state, 'ok');
  assert.match(b.detail, /Downloaded by Ada Admin, today/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(dir, 'db.json')).mode & 0o007, 0, 'not readable by other accounts');
    assert.equal((await check('file-permissions')).state, 'ok');
  }
  assert.ok((await admin.get('/api/system/monitor')).status.files.db > 0);
  env.api.monitor.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Node.js support dates are known for the versions ATLAS runs on', () => {
  for (const major of [22, 24]) assert.match(NODE_END_OF_LIFE[major], /^\d{4}-\d{2}-\d{2}$/);
});

// ----- A real server: what it answers is counted -----
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

test('a real server counts its answers: probes, other websites, bad JSON, wrong host names; saved when stopped', async () => {
  const port = await freePort();
  const dir = tmpDir('server');
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_FILE: path.join(dir, 'db.json'), RATE_LIMITS: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/healthz`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    const json = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const setup = await json('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
    const cookie = setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    for (const p of ['/.env', '/wp-login.php']) await fetch(base + p);
    await json('/api/system/users', {}, { cookie, 'Sec-Fetch-Site': 'cross-site' });
    await json('/api/hub/login', '{bad');
    await fetch(`${base}/api/nothing-here`);
    // A wrong host name (fetch cannot set Host, so the request is written by hand).
    await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => s.end('GET /api/auth/status HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n'));
      s.on('data', () => {});
      s.on('close', resolve);
      s.on('error', resolve);
    });
    await fetch(`${base}/healthz`); // not counted
    const v = await (await fetch(`${base}/api/system/monitor?range=1h`, { headers: { cookie } })).json();
    const count = (name) => v.api.refusals.find((x) => x.name === name).count;
    assert.equal(count('probe'), 2);
    assert.equal(count('cross-site'), 1);
    assert.equal(count('bad-json'), 1);
    assert.equal(count('unknown-route'), 1);
    assert.equal(count('wrong-host'), 1);
    assert.ok(v.traffic.topRoutes.some((r) => r.route === 'POST /api/admin/auth/setup'), 'by route template');
    assert.ok(v.traffic.totals.pages >= 1, '/.env got the home page (and /wp-login.php a 404): counted either way');
  } finally {
    if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve).kill());
  }
  // Stopped (SIGTERM): the last minute was saved.
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'monitor.json'), 'utf8'));
  assert.ok(saved.minute.at(-1).sig.probe >= 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
