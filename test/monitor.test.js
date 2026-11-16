// Admin panel → Security monitor (0.34): the collector (buckets of fixed size, route templates,
// capped addresses, signals), the checks, the page's data and who sees it, the health check, the
// metrics export and its token, and a real server counting what it answers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { createMonitor, signalOf, isProbe, percentile, bucketStart, TIERS, MAX_ADDRESSES, OTHERS, UNKNOWN_ROUTE } from '../server/monitor.js';
import { NODE_END_OF_LIFE, tokenMatches, newToken } from '../server/monitor-panel.js';
import { ROLES, userCan, ADMIN_PANEL_PERMISSIONS } from '../shared/roles.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmpDir = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `core-monitor-${n}-`));
const PW = 'Correct-Horse-42';
const fails = (promise, status) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  return true;
});

function company() {
  const db = openDb(path.join(tmpDir('api'), 'db.json'));
  const handle = createApi(db);
  const client = (extra = {}) => {
    let cookie = '';
    return async (method, url, body = {}) => {
      const res = await handle({ method, headers: { cookie, ...extra } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res;
    };
  };
  return { db, handle, client };
}

test('signals: the status says what kind of refusal it was; scanner paths are probes', () => {
  const api = (status, route = '/api/x', method = 'GET') => signalOf({ status, kind: 'api', route, method, path: route });
  assert.equal(api(401), 'unauthenticated');
  assert.equal(api(401, '/api/auth/login', 'POST'), null, 'a wrong password is the audit log\'s failed sign-in, not counted twice');
  assert.equal(api(403), 'denied');
  assert.equal(api(429), 'rate-limited');
  assert.equal(api(413), 'too-large');
  assert.equal(api(415), 'not-json');
  assert.equal(api(404, UNKNOWN_ROUTE), 'unknown-route');
  assert.equal(api(404, '/api/employees/:id'), null, 'a record that does not exist is not probing');
  assert.equal(api(200), null);
  for (const p of ['/.env', '/wp-admin/setup.php', '/phpmyadmin/', '/index.php', '/.git/config', '/cgi-bin/x']) assert.ok(isProbe(p), p);
  for (const p of ['/', '/help/', '/js/app.js', '/support', '/.well-known/security.txt']) assert.ok(!isProbe(p), p);
  assert.equal(signalOf({ status: 200, kind: 'page', path: '/wp-login.php' }), 'probe');
});

test('percentiles come from the duration histogram, interpolated inside a bucket', () => {
  const h = Array(15).fill(0);
  assert.equal(percentile(h, 95), null);
  h[0] = 50; // ≤ 5 ms
  h[5] = 50; // 75–100 ms
  assert.equal(percentile(h, 50), 5);
  assert.equal(percentile(h, 95), 97.5);
  h[14] = 1000; // over 10 s
  assert.equal(percentile(h, 99), 10000);
});

test('three tiers of fixed size: requests counted by route template, addresses capped, history bounded', () => {
  let t = new Date(2026, 10, 16, 9, 0, 30).getTime();
  const m = createMonitor(tmpDir('tiers'), { now: () => t, persist: false });
  for (let i = 0; i < 3 * 60; i++) {
    m.observe({ method: 'GET', route: '/api/employees/:id', kind: 'api', path: `/api/employees/e-${i}`, status: i % 30 ? 200 : 500, ms: 40, out: 100, https: true, userId: `u${i % 3}`, ip: '10.0.0.1' });
    t += 60000;
  }
  const minutes = m.series('1h', t).buckets;
  assert.equal(minutes.length, 60);
  assert.ok(minutes.every((b) => b.t === bucketStart('minute', b.t)));
  assert.equal(m.merge(m.series('24h', t).buckets).n, 180);
  const routes = Object.keys(m.merge(m.series('24h', t).buckets).routes);
  assert.deepEqual(routes, ['GET /api/employees/:id'], 'one template, never the ids');
  assert.equal(m.merge(m.series('24h', t).buckets).s[5], 6);
  // Ten days later: the minute tier keeps an hour, the hour tier a week.
  t += 10 * TIERS.day.ms;
  m.observe({ method: 'GET', route: '/api/x', kind: 'api', status: 200, ms: 1, ip: '10.0.0.2' });
  assert.equal(m.merge(m.series('7d', t).buckets).n, 1, 'older than a week: gone from the hour tier');
  assert.equal(m.merge(m.series('30d', t).buckets).n, 181, 'still in the day tier');
  // A flood of addresses in one hour: at most MAX_ADDRESSES, the rest together.
  for (let i = 0; i < MAX_ADDRESSES + 50; i++) m.observe({ method: 'GET', route: null, kind: 'api', status: 404, ms: 1, ip: `192.0.2.${i}` });
  const ips = m.merge(m.series('24h', t).buckets).ips;
  assert.ok(Object.keys(ips).length <= MAX_ADDRESSES + 1);
  assert.ok(ips[OTHERS].n >= 50);
  assert.equal(m.merge(m.series('24h', t).buckets).sig['unknown-route'], MAX_ADDRESSES + 50);
  m.stop();
});

test('the history survives a restart; what is past its tier is dropped on loading', () => {
  const dir = tmpDir('persist');
  let t = Date.now();
  const a = createMonitor(dir, { now: () => t });
  a.observe({ method: 'POST', route: '/api/auth/login', kind: 'api', status: 200, ms: 120, ip: '10.0.0.9' });
  a.audit({ action: 'auth.login-failed', ip: '10.0.0.9' });
  a.flush();
  a.stop();
  assert.equal(fs.statSync(path.join(dir, 'monitor.json')).mode & 0o077, 0, 'readable only by CORE');
  const b = createMonitor(dir, { now: () => t });
  const day = b.merge(b.series('24h', t).buckets);
  assert.equal(day.n, 1);
  assert.equal(day.sig['login-failed'], 1);
  b.stop();
  t += 2 * TIERS.hour.ms;
  const c = createMonitor(dir, { now: () => t });
  assert.equal(c.merge(c.series('1h', t).buckets).n, 0, 'two hours later the minutes are gone');
  assert.equal(c.merge(c.series('24h', t).buckets).n, 1, 'the hour is kept');
  c.stop();
  fs.writeFileSync(path.join(dir, 'monitor.json'), '{ not json');
  const d = createMonitor(dir, { now: () => t });
  assert.equal(d.merge(d.series('24h', t).buckets).n, 0, 'an unreadable file: start empty, never fail');
  d.stop();
});

test('the Security monitor permission: administrators by default, grantable, opens the Admin panel', () => {
  assert.ok(userCan({ role: 'admin' }, 'security.monitor'));
  for (const r of Object.keys(ROLES).filter((x) => x !== 'admin')) assert.ok(!userCan({ role: r }, 'security.monitor'), r);
  assert.ok(ADMIN_PANEL_PERMISSIONS.includes('security.monitor'));
});

test('the page: checks, API security, traffic and activity; for the permission only', async () => {
  const { handle, client, db } = company();
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await admin('POST', '/api/users', { name: 'Eli Employee', username: 'eli', role: 'pm', password: PW, mustChangePassword: false });
  const eli = client();
  await eli('POST', '/api/auth/login', { username: 'eli', password: PW });
  await fails(client()('POST', '/api/auth/login', { username: 'eli', password: 'wrong-password-1' }), 401);
  // What server.js reports for each answer.
  handle.monitor.observe({ method: 'GET', route: '/api/employees', kind: 'api', path: '/api/employees', status: 403, ms: 3, userId: db.data.users[1].id, ip: '10.1.1.1' });
  handle.monitor.observe({ method: 'GET', route: null, kind: 'page', path: '/', status: 200, ms: 2, ip: '10.1.1.1', https: true });

  await fails(eli('GET', '/api/admin/monitor'), 403);
  await fails(client()('GET', '/api/admin/monitor'), 401);
  const { data: v } = await admin('GET', '/api/admin/monitor?range=bogus');
  assert.equal(v.range, '24h', 'an unknown range is the last 24 hours');
  const ids = v.status.checks.map((c) => c.id);
  for (const id of ['version', 'node', 'dependencies', 'errors', 'memory', 'event-loop', 'audit-chain', 'backup', 'https', 'rate-limits', 'two-factor', 'two-factor-admins', 'temp-passwords', 'unused-accounts']) assert.ok(ids.includes(id), id);
  assert.ok(v.status.checks.every((c) => ['ok', 'warn', 'bad', 'info'].includes(c.state) && c.label && ['software', 'data', 'access'].includes(c.area)));
  assert.equal(v.status.checks.find((c) => c.id === 'rate-limits').state, 'bad', 'tests run without rate limits: the check says so');
  assert.equal(v.status.checks.find((c) => c.id === 'dependencies').state, 'ok', 'CORE has no third-party packages');
  assert.equal(v.status.checks.find((c) => c.id === 'two-factor-admins').state, 'warn');
  // API security
  assert.ok(v.api.inventory.public.includes('GET /api/public/health'));
  assert.ok(v.api.inventory.public.includes('POST /api/auth/login'));
  assert.ok(v.api.inventory.total > 200 && v.api.inventory.permission > 100);
  assert.equal(v.api.refusals.find((r) => r.name === 'denied').count, 1);
  assert.equal(v.api.signIn.find((r) => r.name === 'login-failed').count, 1);
  assert.ok(v.api.controls.length >= 8);
  assert.deepEqual(v.api.metrics, { token: null }, 'administrators see the export settings');
  // Traffic and activity
  assert.equal(v.traffic.totals.pages, 1);
  assert.equal(v.traffic.totals.https, 1);
  assert.equal(v.activity.signIns, 1, 'Eli (setting up CORE is not a sign-in)');
  assert.equal(v.activity.now.people, 2);
  assert.ok(v.activity.live.some((s) => s.name === 'Eli Employee' && s.device));
  assert.ok(v.activity.byArea.some((a) => a.area === 'auth' && a.label === 'Sign-in and 2-step'));
  assert.equal(v.activity.signInLog[0].outcome, 'failed');
  assert.equal(v.series.length, 24);
  assert.ok(JSON.stringify(v).indexOf(PW) === -1 && JSON.stringify(v).indexOf('passwordHash') === -1);
  // A role given the permission sees the page but not the export token settings.
  await admin('PUT', '/api/admin/roles', { overrides: { support: { add: ['security.monitor'] } } });
  assert.ok(userCan({ role: 'support' }, 'security.monitor'));
  {
    await admin('POST', '/api/users', { name: 'Sam Support', username: 'samsup', role: 'support', password: PW, mustChangePassword: false });
    const sam = client();
    await sam('POST', '/api/auth/login', { username: 'samsup', password: PW });
    const { data: s } = await sam('GET', '/api/admin/monitor?range=1h');
    assert.equal(s.api.metrics, undefined);
    assert.equal(s.series.length, 60);
  }
});

test('a check a module adds shows with the rest; one that fails says so instead of breaking the page', async () => {
  const { handle, client } = company();
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  handle.monitor.check('finance-close', () => ({ area: 'data', label: 'Month-end close', state: 'warn', detail: 'October is still open.' }));
  handle.monitor.check('broken', () => {
    throw new Error('boom');
  });
  handle.monitor.signal('finance-reversal', { label: 'Reversed postings', owasp: 'API6' });
  const { data: v } = await admin('GET', '/api/admin/monitor');
  assert.equal(v.status.checks.find((c) => c.id === 'finance-close').detail, 'October is still open.');
  assert.match(v.status.checks.find((c) => c.id === 'broken').detail, /could not run: boom/);
  assert.ok(v.api.refusals.some((r) => r.name === 'finance-reversal'));
});

test('Node.js support dates: past, close and fine', () => {
  for (const [major, eol] of Object.entries(NODE_END_OF_LIFE)) {
    assert.equal(Number(major) % 2, 0);
    assert.match(eol, /^\d{4}-04-30$/);
  }
});

test('addresses to watch: many refusals or a lock; not the everyday user', async () => {
  const { handle, client } = company();
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  for (let i = 0; i < 25; i++) handle.monitor.observe({ method: 'GET', route: null, kind: 'api', path: '/api/nope', status: 404, ms: 1, ip: '203.0.113.7' });
  for (let i = 0; i < 40; i++) handle.monitor.observe({ method: 'GET', route: '/api/me/profile', kind: 'api', path: '/api/me/profile', status: 200, ms: 1, ip: '10.0.0.5' });
  handle.monitor.audit({ action: 'auth.locked', ip: '198.51.100.3' });
  const { data: v } = await admin('GET', '/api/admin/monitor?range=1h');
  const ips = v.api.watch.map((w) => w.ip);
  assert.deepEqual(ips, ['203.0.113.7', '198.51.100.3']);
  assert.equal(v.api.watch[0].top, 'Unknown API address');
  assert.equal(v.api.watch[1].locked, 1);
});

test('health check: nothing but that CORE answers; metrics need a token only administrators create', async () => {
  const { client } = company();
  const anon = client();
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  assert.deepEqual((await anon('GET', '/api/public/health')).data, { status: 'ok' });
  await fails(anon('GET', '/api/admin/monitor/metrics'), 404);
  await admin('POST', '/api/users', { name: 'Hana HR', username: 'hana', role: 'hr', password: PW, mustChangePassword: false });
  const hana = client();
  await hana('POST', '/api/auth/login', { username: 'hana', password: PW });
  await fails(hana('POST', '/api/admin/monitor/token'), 403);
  const { data: made } = await admin('POST', '/api/admin/monitor/token');
  assert.match(made.token, /^core_mt_[\w-]{43}$/);
  const scraper = (token) => client({ authorization: `Bearer ${token}` });
  await fails(scraper('core_mt_wrong')('GET', '/api/admin/monitor/metrics'), 401);
  const res = await scraper(made.token)('GET', '/api/admin/monitor/metrics');
  assert.ok(Buffer.isBuffer(res.data));
  assert.match(res.headers['Content-Type'], /^text\/plain; version=0\.0\.4/);
  const text = res.data.toString();
  for (const name of ['core_build_info', 'http_server_requests_total', 'core_security_events_total{signal="login-failed"', 'core_audit_chain_intact 1', 'core_check_status{check="node"', 'core_sessions_open']) assert.ok(text.includes(name), name);
  assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(text.replace(/version="[^"]*"|nodejs="[^"]*"/g, '')), 'no network addresses in the export');
  // Replaced: the old one stops working. Revoked: the export is gone.
  const { data: again } = await admin('POST', '/api/admin/monitor/token');
  await fails(scraper(made.token)('GET', '/api/admin/monitor/metrics'), 401);
  await admin('DELETE', '/api/admin/monitor/token');
  await fails(scraper(again.token)('GET', '/api/admin/monitor/metrics'), 404);
  const log = JSON.stringify((await admin('GET', '/api/audit?area=monitor')).data);
  assert.ok(log.includes('Created') && log.includes('Replaced') && log.includes('Revoked'));
  assert.ok(!log.includes(made.token), 'the token itself is never logged');
  // Only its hash is kept.
  const { token, saved } = newToken({ name: 'x' });
  assert.ok(tokenMatches(saved, `Bearer ${token}`));
  assert.ok(!tokenMatches(saved, `Bearer ${token}x`));
  assert.ok(!tokenMatches(saved, token), 'the Bearer scheme is required');
  assert.ok(!JSON.stringify(saved).includes(token));
});

// ----- A real server: what it answers is counted -----
const children = [];
after(() => children.forEach((c) => c.kill()));
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
const raw = (port, { method = 'GET', path: p, headers = {}, body = null }) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
    let b = '';
    res.on('data', (d) => (b += d));
    res.on('end', () => resolve({ status: res.statusCode, body: b }));
  });
  req.on('error', reject);
  req.end(body);
});
test('server.js counts each answer: pages, files, API routes by template, refusals by kind', async () => {
  const port = await freePort();
  const dir = tmpDir('http');
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_FILE: path.join(dir, 'db.json'), RATE_LIMITS: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  children.push(child);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/public/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const base = `http://127.0.0.1:${port}`;
  const setup = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Admin', username: 'admin', password: PW }) });
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  await fetch(`${base}/`);
  await fetch(`${base}/css/styles.css`);
  await fetch(`${base}/.env`);
  await fetch(`${base}/api/no-such-thing`);
  await fetch(`${base}/api/employees/abc`, { headers: { cookie } });
  await raw(port, { method: 'POST', path: '/api/feedback', headers: { cookie, 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  await raw(port, { method: 'POST', path: '/api/feedback', headers: { cookie, 'Content-Type': 'application/json' }, body: '{nope' });
  await raw(port, { path: '/api/auth/status', headers: { Host: 'attacker.example' } });
  for (let i = 0; i < 3; i++) await fetch(`${base}/api/public/health`);
  await new Promise((r) => setTimeout(r, 100));
  const v = await (await fetch(`${base}/api/admin/monitor?range=1h`, { headers: { cookie } })).json();
  const sig = Object.fromEntries(v.api.refusals.map((r) => [r.name, r.count]));
  assert.equal(sig['cross-site'], 1);
  assert.equal(sig['bad-json'], 1);
  assert.equal(sig['wrong-host'], 1);
  assert.equal(sig.probe, 1);
  assert.equal(sig['unknown-route'], 1);
  assert.ok(v.traffic.totals.pages >= 2, 'the app page and the probe answered with it');
  assert.ok(v.traffic.totals.files >= 1);
  const routes = v.traffic.topRoutes.map((r) => r.route);
  assert.ok(routes.includes('GET /api/employees/:id'), 'by template');
  assert.ok(!routes.some((r) => r.includes('abc')), 'never the raw address');
  assert.ok(!routes.some((r) => r.includes('health')), 'the health check is left out');
  assert.ok(v.traffic.latency.p95 >= 0);
  // A clean stop saves the last minute.
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'monitor.json'), 'utf8'));
  assert.ok(saved.minute.reduce((a, b) => a + b.n, 0) >= 8);
});
