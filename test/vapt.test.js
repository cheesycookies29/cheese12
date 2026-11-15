// Regression tests for the fixes of the 0.12.0 security assessment (0.12.1): one group per fix.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApi, clientIp } from '../server/api.js';
import { createAudit } from '../server/audit.js';
import { createSecrets } from '../server/secrets.js';
import { createAttachments } from '../server/attachments.js';
import { hashPassword } from '../server/auth.js';
import { PUBLIC_BODY_BYTES } from '../server/helpdesk.js';
import { ROLES } from '../shared/roles.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = 'Correct-Horse-42';
const tmpDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `ltdc-vapt-${name}-`));
const newDb = (name) => openDb(path.join(tmpDir(name), 'db.json'));
const auditLines = (db) => fs.readFileSync(path.join(db.dir, 'audit-log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// A browser driving the API in-process: keeps its cookie, reports errors as { status, error }.
function browser(handle, { ip = '10.0.0.5', headers = {} } = {}) {
  let cookie = '';
  return async (method, url, body = {}, extra = {}) => {
    try {
      const res = await handle({ method, headers: { cookie, ...headers, ...extra }, socket: { remoteAddress: ip } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res.data;
    } catch (err) {
      return { status: err.status, error: err.message };
    }
  };
}
async function withAdmin(name, options) {
  const db = newDb(name);
  const handle = createApi(db, options);
  const admin = browser(handle);
  await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: PW });
  return { db, handle, admin };
}

// ----- A real server on a free port, for the fixes in server.js -----
const children = [];
after(() => children.forEach((c) => c.kill()));
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
async function startServer(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_FILE: path.join(tmpDir('http'), 'db.json'), RATE_LIMITS: 'off', OPEN_BROWSER: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const host = env.HOST || '127.0.0.1';
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://${host}:${port}/api/auth/status`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return { port, child, output: () => output, url: `http://${host}:${port}` };
}
// One request with node:http, so a path or a body can be sent exactly as given.
// write(req) may send (part of) a body; the answer is { status, body } whenever it arrives.
function raw(port, { method = 'GET', path: p = '/', headers = {}, write = (req) => req.end() }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    write(req);
  });
}

// ----- FIX-01: a malformed address never stops the server -----
test('FIX-01: malformed percent-encoding is answered 400 and the server keeps running', async () => {
  const s = await startServer();
  for (const p of ['/%', '/shared/%', '/%zz', '/shared/%e0%a4%a', '/foo/%zz']) {
    assert.equal((await raw(s.port, { path: p })).status, 400, p);
  }
  const status = await fetch(`${s.url}/api/auth/status`);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).setupRequired, true);
  assert.equal((await fetch(`${s.url}/`)).status, 200, 'pages are still served');
  assert.equal(s.child.exitCode, null, 'the process is alive');
  assert.doesNotMatch(s.output(), /URIError/);
});

// ----- FIX-02: the address behind the proxy is the one the proxy wrote -----
test('FIX-02: clientIp takes the last X-Forwarded-For entry, and only from this machine', () => {
  const req = (remote, xff) => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req('127.0.0.1', '203.0.113.7')), '203.0.113.7');
  assert.equal(clientIp(req('127.0.0.1', '9.9.9.9, 203.0.113.7')), '203.0.113.7', 'a value the visitor sent is ignored');
  assert.equal(clientIp(req('::ffff:127.0.0.1', '1.1.1.1,2.2.2.2 , 203.0.113.7')), '203.0.113.7');
  assert.equal(clientIp(req('::1', '10.0.0.1, 203.0.113.7')), '203.0.113.7');
  assert.equal(clientIp(req('198.51.100.4', '9.9.9.9')), '198.51.100.4', 'the header means nothing from another computer');
  assert.equal(clientIp(req('127.0.0.1')), '127.0.0.1');
  assert.equal(clientIp(req('127.0.0.1', '9.9.9.9, ')), '127.0.0.1', 'an empty last entry falls back to the peer');
});

test('FIX-02: rotating a spoofed X-Forwarded-For no longer escapes the per-address limits', async () => {
  const { db, handle, admin } = await withAdmin('xff', { rateLimits: true });
  await admin('PUT', '/api/security-settings', { signInFailuresPerAddress: 5 });
  // Through the proxy: the visitor's own header first, then the address the proxy saw.
  const proxied = browser(handle, { ip: '127.0.0.1' });
  const results = [];
  for (let i = 0; i < 30; i++) {
    results.push(await proxied('POST', '/api/auth/login', { username: `rot${i}`, password: 'definitely-wrong' }, { 'x-forwarded-for': `10.0.0.${i + 1}, 203.0.113.9` }));
  }
  assert.deepEqual(results.slice(0, 5).map((r) => r.status), [401, 401, 401, 401, 401]);
  assert.ok(results.slice(5).every((r) => r.status === 429), 'every attempt after the fifth is refused');
  assert.match(results[5].error, /Too many failed sign-ins from this network/);
  // The audit log holds the real address, never the spoofed one.
  const failed = auditLines(db).filter((e) => e.action === 'auth.login-failed');
  assert.equal(failed.length, 5);
  assert.ok(failed.every((e) => e.ip === '203.0.113.9'));
  // Another visitor is not affected.
  const other = await proxied('POST', '/api/auth/login', { username: 'ghost', password: 'wrong' }, { 'x-forwarded-for': '203.0.113.9, 198.51.100.20' });
  assert.equal(other.status, 401);
});

// ----- FIX-03: the audit chain is keyed -----
// What the testers did: remove an entry, change another, and rebuild the chain with plain SHA-256.
function rewriteChain(file, { keepKeyMark = true } = {}) {
  const sha = (prev, entry) => createHash('sha256').update(`${prev}\n${JSON.stringify(entry)}`).digest('hex');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e, i) => i !== 1);
  lines[1].label = 'TAMPERED';
  let prev = '';
  lines.forEach((e, i) => {
    Object.assign(e, { seq: i + 1, prev });
    if (!keepKeyMark) delete e.k;
    const { hash, ...rest } = e;
    e.hash = sha(prev, rest);
    prev = e.hash;
  });
  fs.writeFileSync(file, `${lines.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

test('FIX-03: a new log is keyed from entry 1 and a chain rebuilt with SHA-256 is detected', async () => {
  const { db, admin } = await withAdmin('audit');
  await admin('POST', '/api/users', { name: 'HR', username: 'hrboss', role: 'hr', password: PW });
  await admin('PUT', '/api/settings', { companyName: 'Acme Trading' });
  const good = await admin('GET', '/api/audit/verify');
  assert.deepEqual([good.ok, good.keyedFrom, good.count >= 3], [true, 1, true]);
  assert.equal(db.data.settings.auditKeyedFrom, 1);
  const entries = auditLines(db);
  assert.ok(entries.every((e) => e.k === 1 && /^[0-9a-f]{64}$/.test(e.hash)));
  const file = path.join(db.dir, 'audit-log.jsonl');
  const original = fs.readFileSync(file, 'utf8');
  const { hash, ...first } = entries[0];
  assert.notEqual(hash, createHash('sha256').update(`\n${JSON.stringify(first)}`).digest('hex'), 'not a plain hash');

  rewriteChain(file);
  const bad = await admin('GET', '/api/audit/verify');
  assert.deepEqual([bad.ok, bad.brokenAt], [false, 1]);
  // The same, pretending the entries were written before the key existed.
  fs.writeFileSync(file, original);
  rewriteChain(file, { keepKeyMark: false });
  assert.deepEqual([(await admin('GET', '/api/audit/verify')).ok], [false]);
  // Put back, the log verifies again; one changed letter does not.
  fs.writeFileSync(file, original);
  assert.equal((await admin('GET', '/api/audit/verify')).ok, true);
  fs.writeFileSync(file, original.replace('Acme Trading', 'Acme Trading Co'));
  assert.equal((await admin('GET', '/api/audit/verify')).ok, false);
});

test('FIX-03: a log begun by an older build verifies, legacy entries by hash and new ones by key', async () => {
  const dir = tmpDir('legacy');
  // Three entries as 0.12.0 wrote them (no key).
  const old = createAudit(dir);
  for (const n of [1, 2, 3]) old.record('settings.update', { label: `Old entry ${n}` });
  assert.deepEqual(old.verify(), { ok: true, count: 3, keyedFrom: null });
  const db = openDb(path.join(dir, 'db.json'));
  const handle = createApi(db);
  assert.equal(db.data.settings.auditKeyedFrom, 4);
  const admin = browser(handle);
  await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: PW });
  await admin('PUT', '/api/settings', { companyName: 'Acme Trading' });
  const entries = auditLines(db);
  assert.deepEqual(entries.map((e) => e.k === 1), [false, false, false, ...entries.slice(3).map(() => true)]);
  const good = await admin('GET', '/api/audit/verify');
  assert.deepEqual([good.ok, good.count, good.keyedFrom], [true, entries.length, 4]);

  const file = path.join(dir, 'audit-log.jsonl');
  const original = fs.readFileSync(file, 'utf8');
  // A keyed entry without its mark, or a whole chain rebuilt without the key: both fail.
  rewriteChain(file, { keepKeyMark: false });
  assert.equal((await admin('GET', '/api/audit/verify')).ok, false);
  fs.writeFileSync(file, original);
  rewriteChain(file);
  assert.equal((await admin('GET', '/api/audit/verify')).ok, false);
  // A legacy entry changed is still caught by its hash.
  fs.writeFileSync(file, original.replace('Old entry 2', 'Old entry two'));
  assert.deepEqual([(await admin('GET', '/api/audit/verify')).brokenAt], [2]);
  // A restored backup cannot move where the keyed entries begin.
  fs.writeFileSync(file, original);
  const backup = structuredClone(await admin('GET', '/api/admin/export')); // as a downloaded file
  await admin('POST', '/api/admin/import', { ...backup, settings: { ...backup.settings, auditKeyedFrom: 9999 }, password: PW });
  assert.equal(db.data.settings.auditKeyedFrom, 4);
  assert.equal((await admin('GET', '/api/audit/verify')).ok, true);
  // Restarted, the log still verifies and keeps where it became keyed.
  const again = browser(createApi(openDb(path.join(dir, 'db.json'))));
  await again('POST', '/api/auth/login', { username: 'admin', password: PW });
  const later = await again('GET', '/api/audit/verify');
  assert.deepEqual([later.ok, later.keyedFrom], [true, 4]);
});

test('FIX-03: keyed entries cannot be verified without the key, or with another key', () => {
  const dir = tmpDir('nokey');
  const secrets = createSecrets(dir);
  let from = null;
  const state = { keyedFrom: () => from, setKeyedFrom: (n) => (from = n) };
  const audit = createAudit(dir, { key: () => secrets.derive('core-audit-chain-v1'), ...state });
  audit.record('settings.update', { label: 'One' });
  audit.record('settings.update', { label: 'Two' });
  assert.deepEqual(audit.verify(), { ok: true, count: 2, keyedFrom: 1 });
  assert.notDeepEqual(secrets.derive('core-audit-chain-v1'), secrets.derive('something-else'));
  assert.equal(secrets.derive('core-audit-chain-v1').length, 32);
  const unreadable = createAudit(dir, { key: () => { throw new Error('no key'); }, ...state });
  assert.deepEqual([unreadable.verify().ok, unreadable.verify().keyMissing], [false, true]);
  // A new key file (the old one lost or replaced): the entries no longer match.
  const other = createSecrets(tmpDir('otherkey'));
  assert.equal(createAudit(dir, { key: () => other.derive('core-audit-chain-v1'), ...state }).verify().ok, false);
  // And a build without the key does not accept keyed entries as plain ones.
  assert.equal(createAudit(dir).verify().ok, false);
});

// ----- FIX-04: a restore asks for the password and checks the accounts in the file -----
test('FIX-04: a backup with an injected administrator is refused and nothing changes', async () => {
  const { db, handle, admin } = await withAdmin('restore');
  await admin('POST', '/api/employees', { employeeNo: 'E-1', firstName: 'Ana', lastName: 'Cruz', hireDate: '2024-01-01', payType: 'monthly', rate: 30000 });
  const backup = structuredClone(await admin('GET', '/api/admin/export')); // as a downloaded file
  const before = JSON.stringify(db.data);
  const evil = { id: 'evil-admin-0001', username: 'backdoor', name: 'Backdoor', role: 'admin', active: true, mustChangePassword: false, passwordHash: hashPassword('Backdoor-Pass-1'), createdAt: '2020-01-01T00:00:00Z' };
  const restore = (users, password = PW) => admin('POST', '/api/admin/import', { ...structuredClone(backup), users, ...(password === null ? {} : { password }) });

  // The testers' file, as they sent it: no password, so it is refused whatever it holds.
  const noPassword = await restore([...backup.users, evil], null);
  assert.deepEqual([noPassword.status, noPassword.error], [400, 'Enter your password to restore a backup.']);
  const wrongPassword = await restore([...backup.users, evil], 'not-my-password');
  assert.deepEqual([wrongPassword.status, wrongPassword.error], [400, 'Your password is not right.']);
  assert.equal(JSON.stringify(db.data), before);
  assert.equal((await browser(handle)('POST', '/api/auth/login', { username: 'backdoor', password: 'Backdoor-Pass-1' })).status, 401);

  // With the password, every account in the file is checked first.
  const me = backup.users[0];
  const refused = [
    ['an unknown account type', [me, { ...evil, role: 'superuser' }]],
    ['an inherited property as account type', [me, { ...evil, role: 'constructor' }]],
    ['a password hash in another format', [me, { ...evil, passwordHash: 'plain:Backdoor-Pass-1' }]],
    ['a short password hash', [me, { ...evil, passwordHash: 'scrypt$00$00' }]],
    ['no password hash', [me, { ...evil, passwordHash: undefined }]],
    ['an invalid username', [me, { ...evil, username: 'Back Door!' }]],
    ['no name', [me, { ...evil, name: '  ' }]],
    ['an id that is not text', [me, { ...evil, id: 42 }]],
    ['active that is not yes or no', [me, { ...evil, active: 'yes' }]],
    ['a repeated username', [me, { ...evil, username: me.username }]],
    ['a repeated id', [me, { ...evil, id: me.id }]],
    ['broken 2-step details', [me, { ...evil, twoFactor: { enabledAt: true } }]],
    ['broken pending 2-step details', [me, { ...evil, twoFactorPending: 'x' }]],
    ['something that is not an account', [me, 'admin']],
    ['no active administrator', [{ ...me, active: false }]],
    ['no administrator at all', [{ ...me, role: 'hr' }]],
  ];
  for (const [what, users] of refused) {
    const res = await restore(users);
    assert.equal(res.status, 400, what);
    assert.match(res.error, /cannot be restored/, what);
    assert.equal(JSON.stringify(db.data), before, `${what}: nothing was changed`);
  }
  assert.equal((await admin('GET', '/api/audit/verify')).ok, true);
  assert.ok(!auditLines(db).some((e) => e.action === 'data.import'));
});

test('FIX-04: a normal backup still restores, with fields CORE does not know dropped', async () => {
  const { db, handle, admin } = await withAdmin('roundtrip');
  const emp = await admin('POST', '/api/employees', { employeeNo: 'E-1', firstName: 'Ana', lastName: 'Cruz', hireDate: '2024-01-01', payType: 'monthly', rate: 30000 });
  await admin('POST', '/api/users', { name: 'Ana Cruz', username: 'ana', role: 'employee', employeeId: emp.id, password: PW, mustChangePassword: false });
  // An account with 2-step verification pending, to carry those details through a restore.
  await admin('POST', '/api/me/2fa/setup', { password: PW });
  const backup = structuredClone(await admin('GET', '/api/admin/export')); // as a downloaded file
  assert.equal(backup.users.length, 2);
  // Things change after the backup; the restore brings the backup's state back.
  await admin('POST', '/api/users', { name: 'Later', username: 'later', role: 'hr', password: PW });
  await admin('POST', '/api/employees', { employeeNo: 'E-2', firstName: 'Ben', lastName: 'Diaz', hireDate: '2024-01-01', payType: 'monthly', rate: 30000 });
  const file = structuredClone(backup);
  file.users[1].isSuperuser = true;
  file.users[1].permissions = ['*'];
  assert.deepEqual(await admin('POST', '/api/admin/import', { ...file, password: PW }), { ok: true });
  assert.deepEqual(db.data.users.map((u) => u.username), ['admin', 'ana']);
  assert.equal(db.data.employees.length, 1);
  assert.ok(!('password' in db.data), 'the password is not stored with the data');
  const ana = db.data.users[1];
  assert.ok(!('isSuperuser' in ana) && !('permissions' in ana));
  assert.deepEqual(db.data.users.map((u) => ({ ...u })), backup.users.map((u) => ({ ...u })), 'the accounts come back as they were');
  assert.ok(db.data.users[0].twoFactorPending.secret);
  // Everyone signs in as before, and the administrator's session carries on.
  assert.equal((await browser(handle)('POST', '/api/auth/login', { username: 'ana', password: PW })).user.username, 'ana');
  assert.equal((await admin('GET', '/api/users')).length, 2);
  assert.ok(auditLines(db).some((e) => e.action === 'data.import'));
  // A backup without accounts keeps the current ones.
  const { users, ...noUsers } = structuredClone(backup);
  assert.deepEqual(await admin('POST', '/api/admin/import', { ...noUsers, password: PW }), { ok: true });
  assert.deepEqual(db.data.users.map((u) => u.username), ['admin', 'ana']);
});

// ----- FIX-05: the data files are for the app's account only -----
test('FIX-05: the data file, audit log and attachments are private to the app\'s account', { skip: process.platform === 'win32' }, async () => {
  const mode = (p) => fs.statSync(p).mode & 0o777;
  const dir = path.join(tmpDir('modes'), 'data');
  const db = openDb(path.join(dir, 'db.json'));
  const handle = createApi(db);
  await browser(handle)('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: PW });
  const files = createAttachments(path.join(dir, 'attachments'));
  const saved = files.save({ name: 'a.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(path.join(dir, 'db.json')), 0o600);
  assert.equal(mode(path.join(dir, 'audit-log.jsonl')), 0o600);
  assert.equal(mode(path.join(dir, 'secret.key')), 0o600);
  assert.equal(mode(path.join(dir, 'attachments')), 0o700);
  assert.equal(mode(path.join(dir, 'attachments', saved.id)), 0o600);
  assert.ok(!fs.existsSync(path.join(dir, 'db.json.tmp')));

  // Files left world-readable by an older build are closed at start-up.
  for (const p of [dir, path.join(dir, 'attachments')]) fs.chmodSync(p, 0o755);
  for (const p of ['db.json', 'audit-log.jsonl', path.join('attachments', saved.id)]) fs.chmodSync(path.join(dir, p), 0o644);
  createApi(openDb(path.join(dir, 'db.json')));
  assert.deepEqual([dir, path.join(dir, 'attachments')].map(mode), [0o700, 0o700]);
  assert.deepEqual(['db.json', 'audit-log.jsonl', path.join('attachments', saved.id)].map((p) => mode(path.join(dir, p))), [0o600, 0o600, 0o600]);
});

// ----- FIX-06: little is read from someone who is not signed in -----
test('FIX-06: an oversized request from a visitor is refused at once; the public form keeps its room', async () => {
  const s = await startServer();
  const json = { 'Content-Type': 'application/json', Host: 'localhost' };
  const MB = 1024 * 1024;
  // Announced as 2 MB: refused on the headers alone, before any of the body is sent.
  let started = Date.now();
  const announced = await raw(s.port, { method: 'POST', path: '/api/auth/login', headers: { ...json, 'Content-Length': 2 * MB }, write: (req) => req.flushHeaders() });
  assert.equal(announced.status, 413);
  assert.match(announced.body, /Request too large/);
  assert.ok(Date.now() - started < 2000, 'answered without waiting for the body');
  // No length announced: refused as soon as more than 1 MB has arrived, not after the whole body.
  started = Date.now();
  let sent = 0;
  const streamed = await raw(s.port, {
    method: 'POST', path: '/api/auth/login', headers: { ...json, 'Transfer-Encoding': 'chunked' },
    write: (req) => {
      req.on('error', () => {}); // the server closes the connection once it has answered
      const chunk = Buffer.alloc(64 * 1024, 'a');
      const more = () => {
        if (req.destroyed || sent >= 40 * MB) return;
        sent += chunk.length;
        req.write(chunk, () => setTimeout(more, 2));
      };
      more();
    },
  });
  assert.equal(streamed.status, 413);
  assert.ok(sent < 20 * MB, `stopped early (after ${Math.round(sent / MB)} MB)`);
  // The same holds for a request with a made-up session cookie.
  const fake = await raw(s.port, { method: 'POST', path: '/api/auth/login', headers: { ...json, Cookie: 'ltdc_sid=made-up', 'Content-Length': 2 * MB }, write: (req) => req.flushHeaders() });
  assert.equal(fake.status, 413);
  // Just under 1 MB is read (and then refused for what it is, not for its size).
  const small = await fetch(`${s.url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'x', password: 'y', pad: 'a'.repeat(MB - 1000) }) });
  assert.equal(small.status, 401);

  // An administrator turns the public form on; signed in, a large request is read as before.
  let cookie = '';
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(`${s.url}${p}`, { method, headers: { 'Content-Type': 'application/json', cookie, ...headers }, body: body && JSON.stringify(body) });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  await call('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: PW });
  const form = await call('PUT', '/api/helpdesk/settings/public-form', { enabled: true, title: 'Customer care', intro: 'Tell us.', categories: ['Other'], requirePhone: false, allowFiles: true });
  assert.equal(form.status, 200);
  const big = await call('POST', '/api/feedback', { type: 'idea', area: 'general', subject: 'Big', message: 'm', pad: 'a'.repeat(3 * MB) });
  assert.notEqual(big.status, 413);

  // The public form at its largest: three files of 5 MB each, no session.
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * MB - 9, 0x20)]).toString('base64');
  const ticket = { name: 'Pedro Penduko', email: 'pedro@customer.ph', category: 'Other', subject: 'Late delivery of order 1042', message: 'Our order 1042 was promised for Monday and has not arrived.', elapsedMs: 9000, attachments: [1, 2, 3].map((n) => ({ name: `scan-${n}.pdf`, data: `data:application/pdf;base64,${pdf}` })) };
  const body = JSON.stringify(ticket);
  assert.ok(body.length > 20 * MB && body.length < PUBLIC_BODY_BYTES, 'the largest form fits under its limit');
  const posted = await fetch(`${s.url}/api/public/helpdesk/tickets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const answer = await posted.json();
  assert.equal(posted.status, 200, JSON.stringify(answer));
  assert.match(answer.ref, /\d/);
  const tickets = await call('GET', '/api/helpdesk/tickets');
  const full = await call('GET', `/api/helpdesk/tickets/${(tickets.data.tickets || tickets.data)[0].id}`);
  assert.equal(JSON.stringify(full.data).match(/scan-\d\.pdf/g).length >= 3, true, 'all three files were kept');
  // And nothing larger than the form needs.
  const over = await raw(s.port, { method: 'POST', path: '/api/public/helpdesk/tickets', headers: { ...json, 'Content-Length': PUBLIC_BODY_BYTES + 1 }, write: (req) => req.flushHeaders() });
  assert.equal(over.status, 413);
  assert.equal((await fetch(`${s.url}/api/auth/status`)).status, 200);
});

// ----- FIX-07: "disabled" is said only to someone who knows the password -----
test('FIX-07: a wrong password gets the same answer for a disabled account as for any other', async () => {
  const { db, handle, admin } = await withAdmin('disabled');
  const created = await admin('POST', '/api/users', { name: 'Old Hand', username: 'oldhand', role: 'hr', password: PW, mustChangePassword: false });
  await admin('PUT', `/api/users/${created.id}`, { name: 'Old Hand', username: 'oldhand', role: 'hr', active: false });
  const visitor = browser(handle, { ip: '203.0.113.50' });
  const generic = { status: 401, error: 'Incorrect username or password.' };
  assert.deepEqual(await visitor('POST', '/api/auth/login', { username: 'oldhand', password: 'wrong-guess' }), generic);
  assert.deepEqual(await visitor('POST', '/api/auth/login', { username: 'nosuchuser', password: 'wrong-guess' }), generic);
  assert.deepEqual(await visitor('POST', '/api/auth/login', { username: 'admin', password: 'wrong-guess' }), generic);
  assert.deepEqual(await visitor('POST', '/api/auth/login', { username: 'oldhand', password: PW }), { status: 401, error: 'This account is disabled. Contact your administrator.' });
  // The audit log still says why, for the administrator.
  assert.ok(auditLines(db).some((e) => e.action === 'auth.login-failed' && e.label === 'oldhand' && e.note === 'Account disabled'));
});

// ----- FIX-08: build details are for administrators -----
test('FIX-08: the Node version, commit and branch go to administrators only', async () => {
  const { handle, admin } = await withAdmin('about');
  const about = await admin('GET', '/api/system/about');
  assert.ok(about.version && about.node && about.startedAt && 'commit' in about && 'channel' in about);
  await admin('POST', '/api/users', { name: 'IT', username: 'itstaff', role: 'it', password: PW, mustChangePassword: false });
  const it = browser(handle);
  await it('POST', '/api/auth/login', { username: 'itstaff', password: PW });
  assert.equal((await it('GET', '/api/system/about')).status, 403);
  // An account type given the Dev log, but not user management, sees the version and nothing else.
  ROLES.it.permissions.push('devlog.view');
  try {
    assert.deepEqual(await it('GET', '/api/system/about'), { version: about.version });
  } finally {
    ROLES.it.permissions.pop();
  }
});

// ----- FIX-09 / FIX-10: deployment -----
test('FIX-09: the deployment workflow pins its actions to commits; Caddy sets the visitor\'s address', () => {
  const uses = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-ec2.yml'), 'utf8').split('\n').filter((l) => /^\s*-?\s*uses:/.test(l));
  assert.ok(uses.length >= 3);
  for (const line of uses) assert.match(line, /uses: [\w./-]+@[0-9a-f]{40} # v\d/, line);
  assert.match(fs.readFileSync(path.join(ROOT, 'deploy', 'aws', 'Caddyfile'), 'utf8'), /reverse_proxy 127\.0\.0\.1:3000 \{\s+header_up X-Forwarded-For \{remote_host\}\s+\}/);
});

// 127.0.0.2 is this computer too, but not the address CORE treats as "only this computer":
// it stands in for the office-network mode without listening on the network. (Linux only.)
test('FIX-10: started for the network over plain http, CORE warns that passwords are not encrypted', { skip: process.platform !== 'linux' }, async () => {
  const lan = await startServer({ HOST: '127.0.0.2' });
  assert.match(lan.output(), /WARNING: this connection is plain http, not encrypted/);
  assert.match(lan.output(), /HTTPS set-up/);
  const local = await startServer();
  assert.doesNotMatch(local.output(), /WARNING/);
  const proxied = await startServer({ HOST: '127.0.0.2', COOKIE_SECURE: '1' });
  assert.doesNotMatch(proxied.output(), /WARNING/);
});
