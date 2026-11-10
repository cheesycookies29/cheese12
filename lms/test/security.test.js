// Security: rate limits (per person, per network address, sign-in), the per-address lockout, what
// account data leaves the server, separation of duties in People, and the HTTP server itself
// (malformed requests answered, never fatal; security headers; body limits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setup } from './support.js';
import { createRateLimiter, clientIp } from '../server/ratelimit.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A client that comes from a given network address (as the server sees it through Caddy).
function from(env, ip) {
  const jar = {};
  const call = async (method, p, body = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const req = { method, headers: { cookie, 'x-forwarded-for': ip }, socket: { remoteAddress: '127.0.0.1' } };
    const res = await env.api(req, new URL(`http://localhost${p}`), body);
    for (const set of [res.headers['Set-Cookie'] || []].flat()) {
      const [k, v] = set.split(';')[0].split('=');
      if (v) jar[k] = v;
      else delete jar[k];
    }
    return res.data;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b) };
}

test('the limiter: a sliding window, Retry-After, and a cap on how many keys it remembers', () => {
  let t = 1_000_000;
  const rl = createRateLimiter({ r: { limit: 3, windowMs: 1000 } }, { now: () => t, maxKeys: 100 });
  for (let i = 0; i < 3; i++) rl.hit('r', 'a');
  assert.throws(() => rl.hit('r', 'a'), (e) => e.status === 429 && Number(e.headers['Retry-After']) >= 1 && /Try again/.test(e.message));
  rl.hit('r', 'b'); // another key has its own count
  t += 1000; // the next window: the last one still counts in full at its start
  assert.throws(() => rl.hit('r', 'a'), status(429));
  t += 500; // halfway: half of the 3 still counts, so one more fits
  rl.hit('r', 'a');
  t += 2000; // long after: a fresh start
  for (let i = 0; i < 3; i++) rl.hit('r', 'a');
  for (let i = 0; i < 500; i++) rl.hit('r', `flood-${i}`);
  assert.ok(rl.size <= 100, `remembers at most 100 keys, has ${rl.size}`);
});

test('the visitor address: X-Forwarded-For only from a proxy on this computer', () => {
  assert.equal(clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' } }), '203.0.113.9');
  assert.equal(clientIp({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9' } }), '203.0.113.9');
  assert.equal(clientIp({ socket: { remoteAddress: '198.51.100.7' }, headers: { 'x-forwarded-for': '203.0.113.9' } }), '198.51.100.7', 'made-up header from the internet is ignored');
  assert.equal(clientIp({ socket: { remoteAddress: '::ffff:198.51.100.7' }, headers: {} }), '198.51.100.7');
});

test('rate limits: per person when signed in, per address when not, and Settings change them', async () => {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await admin.put('/api/admin/settings', { security: { requestsPerMinute: 60 } });
  assert.equal((await admin.get('/api/admin/settings')).security.requestsPerMinute, 60);
  await assert.rejects(admin.put('/api/admin/settings', { security: { requestsPerMinute: 5 } }), /60/);

  // Signed out: 4 × 60 per address.
  const stranger = from(env, '203.0.113.5');
  for (let i = 0; i < 240; i++) await stranger.get('/api/hub/status');
  await assert.rejects(stranger.get('/api/hub/status'), (e) => e.status === 429 && Boolean(e.headers['Retry-After']));
  await from(env, '203.0.113.6').get('/api/hub/status'); // another address is not affected

  // Signed in: 60 per person, wherever they are.
  await admin.post('/api/admin/users', { role: 'teacher', username: 'tess', name: 'Tess', password: PW, mustChangePassword: false });
  const tess = from(env, '198.51.100.1');
  await tess.post('/api/hub/login', { username: 'tess', password: PW });
  for (let i = 0; i < 60; i++) await tess.get('/api/hub/status');
  await assert.rejects(tess.get('/api/hub/status'), status(429));
  // RATE_LIMITS=off switches them all off (e.g. for load tests).
  const off = setup({ options: { rateLimits: 'off' } });
  const x = from(off, '203.0.113.5');
  for (let i = 0; i < 1300; i++) await x.get('/api/hub/status');
});

test('wrong passwords: the lock is per address, and an address guessing many usernames waits', async () => {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await admin.put('/api/admin/settings', { security: { signInFailuresPerAddress: 10 } });
  await admin.post('/api/admin/users', { role: 'teacher', username: 'tess', name: 'Tess', password: PW, mustChangePassword: false });

  // Five wrong passwords for tess from one address lock her there, not everywhere.
  const attacker = from(env, '203.0.113.66');
  for (let i = 0; i < 5; i++) await assert.rejects(attacker.post('/api/hub/login', { username: 'tess', password: `nope${i}` }), status(401));
  await assert.rejects(attacker.post('/api/hub/login', { username: 'tess', password: PW }), status(429));
  await from(env, '198.51.100.20').post('/api/hub/login', { username: 'tess', password: PW }); // tess at school still signs in

  // Guessing across usernames: 10 wrong passwords from one address, then it waits (even for a right one).
  const sprayer = from(env, '203.0.113.77');
  for (let i = 0; i < 10; i++) await assert.rejects(sprayer.post('/api/hub/login', { username: `user${i}`, password: 'Summer2026' }), status(401));
  await assert.rejects(sprayer.post('/api/admin/auth/login', { username: 'admin', password: PW }), (e) => e.status === 429 && /network/.test(e.message));
  await from(env, '198.51.100.21').post('/api/admin/auth/login', { username: 'admin', password: PW });

  // A very long password is refused before the slow password check.
  await assert.rejects(from(env, '198.51.100.22').post('/api/hub/login', { username: 'tess', password: 'x'.repeat(5000) }), status(401));
});

test('account data that leaves the server: no calendar address, Keycloak link or password hash', async () => {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const s = await admin.post('/api/admin/users', { role: 'student', username: 'stud', name: 'Stud', password: PW, mustChangePassword: false });
  const stud = env.client();
  await stud.post('/api/hub/login', { username: 'stud', password: PW });
  await stud.post('/api/calendar/subscription');
  const row = (await admin.get('/api/admin/users?role=student')).find((u) => u.id === s.id);
  for (const k of ['calendarToken', 'ssoSubject', 'passwordHash']) assert.ok(!(k in row), `${k} is not sent`);
  assert.ok(!('calendarToken' in (await admin.get(`/api/admin/users/${s.id}`))));
});

test('People: parents stay out; HR cannot make Finance office accounts or change their own leave and pay', async () => {
  const env = setup({ today: '2026-11-03' });
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const signIn = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: PW });
    return c;
  };
  const emp = (c, first) => c.post('/api/hris/employees', { firstName: first, lastName: 'Cruz', gender: 'Female', hireDate: '2025-01-06', payType: 'monthly', rate: 26100, position: 'Clerk', department: 'Admin' });
  const hrEmp = await emp(admin, 'Hana');
  await admin.post(`/api/hris/employees/${hrEmp.id}/account`, { role: 'hr', username: 'hana', password: PW, mustChangePassword: false });
  const hr = await signIn('hana');

  // HR makes staff accounts, but not an Approving Officer (only an administrator does).
  const fake = await emp(hr, 'Ghost');
  await assert.rejects(hr.post(`/api/hris/employees/${fake.id}/account`, { role: 'approver', username: 'ghost', password: PW }), (e) => e.status === 403 && /administrator/.test(e.message));
  await hr.post(`/api/hris/employees/${fake.id}/account`, { role: 'staff', username: 'ghost', password: PW });
  await assert.rejects(hr.put(`/api/hris/employees/${fake.id}/account`, { role: 'cashier' }), status(403));
  // An administrator's Finance account cannot be re-passworded or linked by HR either.
  const cashEmp = await emp(admin, 'Carla');
  await admin.post(`/api/hris/employees/${cashEmp.id}/account`, { role: 'cashier', username: 'carla', password: PW, mustChangePassword: false });
  await assert.rejects(hr.put(`/api/hris/employees/${cashEmp.id}/account`, { password: 'takeover123' }), status(403));
  assert.ok(!(await hr.get('/api/hris/accounts/linkable')).some((u) => u.role === 'cashier'));

  // Own record: no leave credits, adjustments or pay changes by oneself.
  const vl = (await hr.get('/api/hris/leave-types')).find((t) => t.code === 'VL') || (await hr.get('/api/hris/leave-types'))[0];
  await assert.rejects(hr.put('/api/hris/leave-credits', { employeeId: hrEmp.id, year: 2026, leaveTypeId: vl.id, credits: 99 }), (e) => e.status === 403 && /own record/.test(e.message));
  await assert.rejects(hr.post(`/api/hris/employees/${hrEmp.id}/leave-adjustments`, { leaveTypeId: vl.id, year: 2026, days: 30, reason: 'x' }), status(403));
  await assert.rejects(hr.put(`/api/hris/employees/${hrEmp.id}`, { rate: 99999 }), status(403));
  await hr.put('/api/hris/leave-credits', { employeeId: fake.id, year: 2026, leaveTypeId: vl.id, credits: 15 }); // someone else's: fine

  // Parents and guardians are not employees.
  const s = await admin.post('/api/admin/users', { role: 'student', username: 'kid', name: 'Kid', password: PW, mustChangePassword: false });
  await admin.post('/api/admin/guardians', { name: 'Mara Mom', username: 'mara', password: PW, mustChangePassword: false, studentId: s.id, relationship: 'Mother' });
  const mom = await signIn('mara');
  assert.equal((await mom.get('/api/hris/auth/status')).allowed, false);
  await assert.rejects(mom.get('/api/hris/settings'), status(403));
});

// ----- The HTTP server itself -----
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
function raw(port, text) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    let out = '';
    s.on('data', (d) => (out += d));
    s.on('error', () => resolve(''));
    s.on('close', () => resolve(out.split('\r\n')[0]));
    s.end(text);
  });
}

test('the server answers malformed requests with 400 and keeps running; security headers; JSON bodies only', async () => {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sec-'));
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DB_FILE: path.join(dir, 'db.json') }, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${base}/healthz`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.match(await raw(port, 'GET /%E0%A4%A HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'), / 400 /);
    assert.match(await raw(port, 'GET /shared/%ZZ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'), / 400 /);
    assert.match(await raw(port, 'GET /%00 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'), / 400 /);
    assert.match(await raw(port, 'GET /api/auth/status HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n'), / 403 /);
    assert.ok((await fetch(`${base}/healthz`)).ok, 'still running');

    const page = await fetch(`${base}/`);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' 'sha256-/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

    const post = (body, type = 'application/json') => fetch(`${base}/api/hub/login`, { method: 'POST', headers: { 'Content-Type': type }, body });
    assert.equal((await post('null')).status, 400);
    assert.equal((await post('{bad')).status, 400);
    assert.equal((await post('{"username":"a"}', 'text/plain')).status, 415);
    const big = await post(`{"a":"${'x'.repeat(21 * 1024 * 1024)}"}`).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
    // Letters split across network packets arrive whole.
    const r = await fetch(`${base}/api/hub/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ñ'.repeat(70000), password: 'x' }) });
    assert.equal(r.status, 401);
    assert.ok((await fetch(`${base}/healthz`)).ok, 'still running');
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('injection: CSV cells that look like formulas, calendar titles with line breaks, links to other sites', async () => {
  const { toCsv } = await import('../public/js/ui.js');
  assert.equal(toCsv([['=HYPERLINK("http://x")', '+1', '@SUM(A1)', '-5', '-2.5', 'Ana']]), '"\'=HYPERLINK(""http://x"")","\'+1","\'@SUM(A1)","-5","-2.5","Ana"');

  const { toIcs } = await import('../server/calendar.js');
  const ics = toIcs([{ id: 'a', kind: 'event', title: 'Exam\rLOCATION:evil', date: '2026-11-17', startTime: '' }], { name: 'N\rX-INJ:1', now: new Date('2026-11-01T00:00:00Z') });
  for (const line of ics.split(/\r\n|\r|\n/)) assert.ok(!/^(LOCATION:evil|X-INJ)/.test(line), `injected property: ${line}`);

  const { renderMarkdown } = await import('../shared/markdown.js');
  const out = renderMarkdown('[a](//evil.example) [b](/admin#/terms) [c](https://a.example/**x**y**z**)');
  assert.ok(!out.includes('evil.example"'), 'protocol-relative links are not made');
  assert.match(out, /href="\/admin#\/terms"/);
  assert.match(out, /href="https:\/\/a\.example\/\*\*x\*\*y\*\*z\*\*"/, 'bold markers inside an address stay as they are');

  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const { systems } = await admin.get('/api/admin/systems');
  const other = systems.find((s) => !s.builtIn);
  await assert.rejects(admin.put('/api/admin/systems', { settings: { [other.id]: { status: 'live', url: '//evil.example' } } }), /one slash/);
});

test('password hashes are encrypted with the server key: switch-on, key change, wrong key, restore, key file', async () => {
  const auth = await import('../server/auth.js');
  const { createApi } = await import('../server/api.js');
  const clientOf = (api) => {
    const jar = {};
    const call = async (method, p, body = {}) => {
      const res = await api({ method, headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } }, new URL(`http://localhost${p}`), body);
      for (const set of [res.headers['Set-Cookie'] || []].flat()) {
        const [k, v] = set.split(';')[0].split('=');
        if (v) jar[k] = v;
        else delete jar[k];
      }
      return res.data;
    };
    return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b) };
  };
  const K1 = '1'.repeat(64);
  const K2 = '2'.repeat(64);
  const warn = console.warn;
  console.warn = () => {};
  try {
    // Before: plain one-way hashes.
    auth.setPasswordKeys('');
    const env = setup();
    const admin = env.client();
    await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
    await admin.post('/api/admin/users', { role: 'teacher', username: 'tess', name: 'Tess', password: PW, mustChangePassword: false });
    assert.ok(env.db.data.users.every((u) => u.passwordHash.startsWith('scrypt$')));
    assert.equal((await admin.get('/api/admin/settings')).passwordEncryption.on, false);

    // A key arrives (a restart): every hash is encrypted at once, and sign-in still works.
    auth.setPasswordKeys(K1);
    const api1 = createApi(env.db);
    assert.ok(env.db.data.users.every((u) => /^enc1\$[0-9a-f]{8}\$/.test(u.passwordHash)), 'all encrypted');
    assert.ok(!JSON.stringify(env.db.data).includes('scrypt$'), 'no plain hash left in the data');
    const a1 = clientOf(api1);
    await a1.post('/api/admin/auth/login', { username: 'admin', password: PW });
    assert.equal((await a1.get('/api/admin/settings')).passwordEncryption.on, true);
    await assert.rejects(clientOf(api1).post('/api/hub/login', { username: 'tess', password: 'wrong-password' }), status(401));
    const before = env.db.data.users.find((u) => u.username === 'tess').passwordHash;

    // A new key, with the old one given as PASSWORD_KEY_OLD: re-encrypted, nobody changes a password.
    auth.setPasswordKeys(K2, [K1]);
    const api2 = createApi(env.db);
    const after = env.db.data.users.find((u) => u.username === 'tess').passwordHash;
    assert.notEqual(after.split('$')[1], before.split('$')[1], 'now under the new key');
    await clientOf(api2).post('/api/hub/login', { username: 'tess', password: PW });

    // A copy of the data on a server without the key (or with another key) is useless.
    const backup = structuredClone(env.db.data);
    auth.setPasswordKeys('3'.repeat(64));
    const stranger = setup();
    const sAdmin = stranger.client();
    await sAdmin.post('/api/admin/auth/setup', { name: 'Sam', username: 'sam', password: PW });
    await assert.rejects(clientOf(createApi(env.db)).post('/api/hub/login', { username: 'tess', password: PW }), status(401));
    await assert.rejects(sAdmin.post('/api/admin/restore', backup), /another server's key/);

    // The key file: made once beside the data, readable by the app only, and reused.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-key-'));
    const first = auth.loadPasswordKeys(dir, {});
    const file = path.join(dir, 'password.key');
    assert.ok(first.on && fs.existsSync(file));
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const id = auth.passwordEncryption().keyId;
    auth.loadPasswordKeys(dir, {});
    assert.equal(auth.passwordEncryption().keyId, id, 'the same key next time');
    auth.loadPasswordKeys(dir, { PASSWORD_KEY: K1 });
    assert.notEqual(auth.passwordEncryption().keyId, id, 'PASSWORD_KEY wins over the file');
    assert.throws(() => auth.loadPasswordKeys(dir, { PASSWORD_KEY: 'short' }), /64 hexadecimal/);
    fs.rmSync(dir, { recursive: true, force: true });
  } finally {
    console.warn = warn;
    auth.setPasswordKeys('');
  }
});
