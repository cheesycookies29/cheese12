// Sign-in security: rate limits, lockouts, sessions, the password rules, 2-step verification
// (authenticator codes and recovery codes), the policy that requires it, and the browser checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { createSessions, createThrottle, publicUser, deviceOf } from '../server/auth.js';
import { createRateLimiter } from '../server/ratelimit.js';
import { checkPassword, validateSecuritySettings, SECURITY_DEFAULTS, twoFactorRequired, crossSite, pagePolicy, baseHeaders } from '../server/security.js';
import { base32Decode, base32Encode, codeAt, stepAt, verifyCode, newRecoveryCodes, hashRecovery, looksLikeRecovery, otpauthUrl } from '../server/totp.js';

const PW = 'Correct-Horse-42';
// The actions in the audit log (a file next to the database).
const audited = (db) => fs.readFileSync(path.join(db.dir, 'audit-log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).action);
const newDb = (name) => openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), `ltdc-sec-${name}-`)), 'db.json'));

// A browser: keeps its cookie, comes from one network address, and reports errors as { status, error }.
function browser(handle, { ip = '10.0.0.5', ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' } = {}) {
  let cookie = '';
  const call = async (method, url, body = {}) => {
    try {
      const res = await handle({ method, headers: { cookie, 'user-agent': ua }, socket: { remoteAddress: ip } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res.data;
    } catch (err) {
      return { status: err.status, error: err.message, headers: err.headers };
    }
  };
  call.cookie = () => cookie;
  return call;
}

// The code the authenticator app shows now (and the next one, for a second use within 30 seconds).
const appCode = (secret, offset = 0) => codeAt(secret, stepAt() + offset);

test('TOTP matches the RFC 6238 test vectors and refuses a code used twice', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(codeAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(codeAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(codeAt(secret, Math.floor(1234567890 / 30)), '005924');
  assert.deepEqual(base32Decode(secret), Buffer.from('12345678901234567890'));
  const now = 1234567890 * 1000;
  const step = verifyCode(secret, '005924', { now });
  assert.equal(step, Math.floor(1234567890 / 30));
  assert.equal(verifyCode(secret, '005 924', { now }), step, 'spaces are ignored');
  assert.equal(verifyCode(secret, '005924', { now, lastStep: step }), null, 'the same code twice is refused');
  assert.equal(verifyCode(secret, '000000', { now }), null);
  assert.equal(verifyCode(secret, '12345', { now }), null);
  assert.match(otpauthUrl({ secret, account: 'ana', issuer: 'CORE ERP' }), /^otpauth:\/\/totp\/CORE%20ERP%3Aana\?secret=[A-Z2-7]+&issuer=CORE%20ERP/);
});

test('recovery codes: ten, readable, stored only as hashes', () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  assert.ok(looksLikeRecovery(codes[0].toLowerCase().replace('-', ' ')));
  assert.equal(hashRecovery(codes[0]), hashRecovery(codes[0].toLowerCase().replace('-', '')));
  assert.ok(!looksLikeRecovery('123456'));
});

test('the rate limiter refuses past the limit with Retry-After, and recovers over the window', () => {
  let t = 1_000_000;
  const rl = createRateLimiter({ api: { limit: 3, windowMs: 60000 } }, { now: () => t });
  rl.hit('api', 'a');
  rl.hit('api', 'a');
  rl.hit('api', 'a');
  assert.throws(() => rl.hit('api', 'a'), (e) => e.status === 429 && Number(e.headers['Retry-After']) > 0);
  assert.doesNotThrow(() => rl.hit('api', 'b'), 'another key has its own count');
  t += 2 * 60000;
  assert.doesNotThrow(() => rl.hit('api', 'a'));
});

test('a username is locked for longer each time the wrong passwords keep coming', () => {
  let t = 0;
  const th = createThrottle({ now: () => t });
  const fails = () => Array.from({ length: 5 }, () => th.fail('bob')).at(-1);
  assert.equal(fails(), 5);
  assert.throws(() => th.check('bob'), /5 minutes/);
  t += 5 * 60000 + 1;
  assert.equal(fails(), 15);
  t += 15 * 60000 + 1;
  assert.equal(fails(), 60);
  t += 60 * 60000 + 1;
  assert.equal(fails(), 60, 'an hour at most');
  t += 25 * 60 * 60000;
  assert.equal(fails(), 5, 'a quiet day forgets the escalation');
});

test('the password rules: length, common passwords, the username or name', () => {
  const who = { username: 'mreyes', name: 'Maria Reyes' };
  assert.throws(() => checkPassword('short', who), /at least 8/);
  assert.throws(() => checkPassword('x'.repeat(201), who), /too long/);
  for (const p of ['password123', 'Password1', 'qwertyuiop', '11111111', '123456789abc', 'lancaster1']) assert.throws(() => checkPassword(p, who), /too common/, p);
  assert.throws(() => checkPassword('mreyes-2026!', who), /username or name/);
  assert.throws(() => checkPassword('Reyes-family-9', who), /username or name/);
  assert.doesNotThrow(() => checkPassword('copper kettle sunrise', who));
  assert.doesNotThrow(() => checkPassword('password123', who, { ...SECURITY_DEFAULTS, blockCommonPasswords: false }), 'can be turned off');
});

test('sessions end after the idle time and after the longest session; each has a device and an id', () => {
  const policy = { idleMs: 60000, maxMs: 3600000 };
  const s = createSessions(() => policy);
  const a = s.create('u1', { ip: '10.0.0.5', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1' });
  const b = s.create('u1', {});
  s.create('u2', {});
  assert.equal(s.get(a).device, 'Safari on iOS');
  assert.match(s.get(a).id, /^[0-9a-f]{16}$/);
  assert.ok(!s.get(a).id.includes(a.slice(0, 16)), 'the id is not the token');
  assert.equal(s.list('u1').length, 2);
  assert.equal(s.destroyForUser('u1', a), 1);
  assert.equal(s.get(b), null);
  assert.ok(s.destroyById('u1', s.get(a).id));
  assert.equal(s.get(a), null);
  const c = s.create('u1', {});
  policy.idleMs = 0;
  assert.equal(s.get(c), null, 'idle too long');
  policy.idleMs = 60000;
  const d = s.create('u1', {});
  policy.maxMs = 0;
  assert.equal(s.get(d), null, 'past the longest session');
  assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/130.0 Safari/537.36 Edg/130.0'), 'Edge on Windows');
});

test('what the browser sees of an account never includes the password hash or 2-step secrets', () => {
  const u = publicUser({ id: '1', username: 'a', passwordHash: 'scrypt$x$y', twoFactor: { secret: 's', enabledAt: '2026-01-01', recovery: [{ hash: 'h' }] }, twoFactorPending: { secret: 'p' } });
  assert.deepEqual(Object.keys(u).sort(), ['id', 'twoFactorEnabled', 'username']);
  assert.equal(u.twoFactorEnabled, true);
});

test('security settings: ranges, the 2-step policy, and idle time within the longest session', () => {
  const ok = validateSecuritySettings({ twoFactor: 'admins', sessionIdleMinutes: 30, requestsPerMinute: '600' }, SECURITY_DEFAULTS);
  assert.equal(ok.twoFactor, 'admins');
  assert.equal(ok.requestsPerMinute, 600);
  assert.throws(() => validateSecuritySettings({ requestsPerMinute: 5 }, SECURITY_DEFAULTS), /60 to 5000/);
  assert.throws(() => validateSecuritySettings({ twoFactor: 'sometimes' }, SECURITY_DEFAULTS), /Choose who/);
  assert.throws(() => validateSecuritySettings({ sessionIdleMinutes: 600, sessionMaxHours: 8 }, SECURITY_DEFAULTS), /idle time/);
  assert.equal(twoFactorRequired({ twoFactor: 'admins' }, { role: 'admin' }), true);
  assert.equal(twoFactorRequired({ twoFactor: 'admins' }, { role: 'hr' }), false);
  assert.equal(twoFactorRequired({ twoFactor: 'all' }, { role: 'employee' }), true);
});

test('browser checks: other sites cannot make changes; pages get a script policy and safe headers', () => {
  const req = (headers) => ({ headers: { host: 'erp.example.com', ...headers } });
  assert.equal(crossSite(req({ 'sec-fetch-site': 'same-origin', origin: 'https://erp.example.com' })), false);
  assert.equal(crossSite(req({ 'sec-fetch-site': 'cross-site' })), true);
  assert.equal(crossSite(req({ origin: 'https://evil.example' })), true);
  assert.equal(crossSite(req({ origin: 'null' })), true);
  assert.equal(crossSite(req({})), false, 'scripts and tools without Origin are let through (the cookie is SameSite=Strict)');
  const csp = pagePolicy(path.resolve('.'));
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(baseHeaders()['X-Frame-Options'], 'DENY');
  assert.equal(baseHeaders()['Strict-Transport-Security'], undefined);
  assert.match(baseHeaders({ https: true })['Strict-Transport-Security'], /max-age=/);
});

test('rate limits in the running app: sign-in bursts and failures from one address are refused', async () => {
  const db = newDb('limits');
  const handle = createApi(db, { rateLimits: true });
  const admin = browser(handle, { ip: '10.0.0.1' });
  await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: PW });
  await admin('PUT', '/api/security-settings', { signInFailuresPerAddress: 5 });

  // Five wrong passwords for different usernames from one address: the address waits.
  const guesser = browser(handle, { ip: '10.9.9.9' });
  for (let i = 0; i < 5; i++) assert.equal((await guesser('POST', '/api/auth/login', { username: `user${i}`, password: 'nope-nope' })).status, 401);
  const blocked = await guesser('POST', '/api/auth/login', { username: 'admin', password: PW });
  assert.equal(blocked.status, 429);
  assert.match(blocked.error, /from this network/);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
  // Another address is not affected.
  const other = browser(handle, { ip: '10.0.0.2' });
  assert.ok((await other('POST', '/api/auth/login', { username: 'admin', password: PW })).user);

  // More than 20 sign-in requests a minute from one address.
  const burst = browser(handle, { ip: '10.7.7.7' });
  let last;
  for (let i = 0; i < 21; i++) last = await burst('POST', '/api/auth/login', { username: 'admin', password: PW });
  assert.equal(last.status, 429);
  assert.match(last.error, /sign-in attempts/);

  // The audit log has the failures.
  assert.ok(audited(db).filter((a) => a === 'auth.login-failed').length >= 5);
});

test('five wrong passwords lock the username, and the lock is in the audit log', async () => {
  const db = newDb('lock');
  const handle = createApi(db);
  const admin = browser(handle);
  await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: PW });
  const b = browser(handle, { ip: '10.0.0.8' });
  for (let i = 0; i < 5; i++) await b('POST', '/api/auth/login', { username: 'admin', password: 'wrong-wrong' });
  const res = await b('POST', '/api/auth/login', { username: 'admin', password: PW });
  assert.equal(res.status, 429);
  assert.match(res.error, /Try again in 5 minutes/);
  assert.ok(audited(db).includes('auth.locked'));
});

test('new passwords follow the rules everywhere they are set', async () => {
  const db = newDb('pw');
  const handle = createApi(db);
  const admin = browser(handle);
  assert.match((await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'password123' })).error, /too common/);
  await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: PW });
  assert.match((await admin('POST', '/api/users', { name: 'Jose Rizal', username: 'jrizal', role: 'hr', password: 'rizal-2026x' })).error, /username or name/);
  const u = await admin('POST', '/api/users', { name: 'Jose Rizal', username: 'jrizal', role: 'hr', password: PW, mustChangePassword: false });
  assert.match((await admin('POST', `/api/users/${u.id}/reset-password`, { password: '12345678' })).error, /too common/);
  assert.match((await admin('POST', '/api/auth/change-password', { currentPassword: PW, newPassword: 'qwerty123' })).error, /too common/);
});

test('sessions: where I am signed in, sign out one or everywhere else; a role change signs out', async () => {
  const db = newDb('sessions');
  const handle = createApi(db);
  const laptop = browser(handle, { ip: '10.0.0.3' });
  await laptop('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: PW });
  const phone = browser(handle, { ip: '10.0.0.4', ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile' });
  const tablet = browser(handle, { ip: '10.0.0.6', ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/605.1' });
  await phone('POST', '/api/auth/login', { username: 'admin', password: PW });
  await tablet('POST', '/api/auth/login', { username: 'admin', password: PW });
  const list = await laptop('GET', '/api/me/sessions');
  assert.equal(list.length, 3);
  assert.equal(list.filter((s) => s.current).length, 1);
  const phoneRow = list.find((s) => s.device === 'Chrome on Android');
  assert.equal(phoneRow.ip, '10.0.0.4');
  assert.ok(!JSON.stringify(list).includes(phone.cookie().split('=')[1]), 'tokens are never listed');
  assert.deepEqual(await laptop('DELETE', `/api/me/sessions/${phoneRow.id}`), { ok: true });
  assert.equal((await phone('GET', '/api/me/sessions')).status, 401);
  assert.deepEqual(await laptop('POST', '/api/me/sessions/sign-out-others'), { signedOut: 1 });
  assert.equal((await tablet('GET', '/api/me/sessions')).status, 401);
  assert.equal((await laptop('GET', '/api/me/sessions')).length, 1);

  const hr = await laptop('POST', '/api/users', { name: 'Hana Reyes', username: 'hana', role: 'hr', password: PW, mustChangePassword: false });
  const hana = browser(handle, { ip: '10.0.0.7' });
  await hana('POST', '/api/auth/login', { username: 'hana', password: PW });
  assert.equal((await laptop('GET', '/api/users')).find((u) => u.id === hr.id).sessions, 1);
  await laptop('PUT', `/api/users/${hr.id}`, { name: 'Hana Reyes', username: 'hana', role: 'payroll', active: true });
  assert.equal((await hana('GET', '/api/me/sessions')).status, 401, 'signed in again with the new access');
  await hana('POST', '/api/auth/login', { username: 'hana', password: PW });
  assert.deepEqual(await laptop('POST', `/api/users/${hr.id}/sign-out`), { signedOut: 1 });
  assert.equal((await hana('GET', '/api/me/sessions')).status, 401);
});

test('2-step verification: set up, sign in with a code, recovery codes, turn off', async () => {
  const db = newDb('tfa');
  const handle = createApi(db);
  const me = browser(handle);
  await me('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: PW });
  const other = browser(handle, { ip: '10.0.0.9' });
  await other('POST', '/api/auth/login', { username: 'admin', password: PW });

  assert.match((await me('POST', '/api/me/2fa/setup', { password: 'not-mine-x' })).error, /password is not right/);
  const { secret, otpauthUrl: url } = await me('POST', '/api/me/2fa/setup', { password: PW });
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.ok(!JSON.stringify(db.data.users).includes(secret), 'the secret is sealed in the database');
  assert.match((await me('POST', '/api/me/2fa/enable', { code: '000000' })).error, /not right/);
  const on = await me('POST', '/api/me/2fa/enable', { code: appCode(secret) });
  assert.equal(on.recoveryCodes.length, 10);
  assert.equal(on.user.twoFactorEnabled, true);
  assert.equal((await other('GET', '/api/me/sessions')).status, 401, 'other devices are signed out');
  assert.ok(db.data.users[0].twoFactor.recovery.every((r) => !on.recoveryCodes.includes(r.hash)), 'only hashes are kept');
  const status = await me('GET', '/api/me/2fa');
  assert.equal(status.enabled, true);
  assert.equal(status.recoveryLeft, 10);

  // Sign in: the password alone gives a challenge, not a session.
  const b = browser(handle, { ip: '10.0.0.10' });
  const first = await b('POST', '/api/auth/login', { username: 'admin', password: PW });
  assert.equal(first.twoFactorRequired, true);
  assert.equal(first.user, undefined);
  assert.equal(b.cookie(), '');
  assert.match((await b('POST', '/api/auth/2fa', { challenge: first.challenge, code: '123456' })).error, /not right/);
  // The code used to turn it on was spent; the next one works.
  const signedIn = await b('POST', '/api/auth/2fa', { challenge: first.challenge, code: appCode(secret, 1) });
  assert.equal(signedIn.user.username, 'admin');
  assert.ok(b.cookie());
  assert.equal((await b('POST', '/api/auth/2fa', { challenge: first.challenge, code: appCode(secret, 1) })).status, 401, 'a challenge works once');
  // The same code again is refused (replay).
  const again = browser(handle, { ip: '10.0.0.11' });
  const second = await again('POST', '/api/auth/login', { username: 'admin', password: PW });
  assert.match((await again('POST', '/api/auth/2fa', { challenge: second.challenge, code: appCode(secret, 1) })).error, /not right/);
  // A recovery code signs in once.
  const rc = on.recoveryCodes[0];
  assert.equal((await again('POST', '/api/auth/2fa', { challenge: second.challenge, code: rc.toLowerCase() })).user.username, 'admin');
  const third = await again('POST', '/api/auth/login', { username: 'admin', password: PW });
  assert.match((await again('POST', '/api/auth/2fa', { challenge: third.challenge, code: rc })).error, /not right/);
  assert.equal((await me('GET', '/api/me/2fa')).recoveryLeft, 9);
  assert.ok(audited(db).includes('auth.recovery-used'));

  // Five wrong codes end the challenge and count as a failed sign-in.
  for (let i = 0; i < 3; i++) await again('POST', '/api/auth/2fa', { challenge: third.challenge, code: '000000' }); // the reused recovery code was the first
  assert.match((await again('POST', '/api/auth/2fa', { challenge: third.challenge, code: '000000' })).error, /Too many wrong codes/);
  assert.match((await again('POST', '/api/auth/2fa', { challenge: third.challenge, code: '000000' })).error, /expired/);

  // New recovery codes replace the old ones.
  const fresh = await me('POST', '/api/me/2fa/recovery-codes', { password: PW, code: on.recoveryCodes[1] });
  assert.equal(fresh.recoveryCodes.length, 10);
  assert.equal((await me('GET', '/api/me/2fa')).recoveryLeft, 10);
  // Turning it off needs the password and a code.
  assert.match((await me('POST', '/api/me/2fa/disable', { password: PW, code: '000000' })).error, /not right/);
  assert.equal((await me('POST', '/api/me/2fa/disable', { password: PW, code: on.recoveryCodes[2] })).error, 'That code is not right.', 'old recovery codes stopped working');
  assert.equal((await me('POST', '/api/me/2fa/disable', { password: PW, code: fresh.recoveryCodes[0] })).user.twoFactorEnabled, false);
  assert.ok((await browser(handle)('POST', '/api/auth/login', { username: 'admin', password: PW })).user, 'the password alone signs in again');
});

test('the 2-step policy: required accounts set it up first, cannot turn it off, and admins can reset it', async () => {
  const db = newDb('policy');
  const handle = createApi(db);
  const admin = browser(handle);
  await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: PW });
  // An administrator cannot require it of themselves before they have it.
  assert.match((await admin('PUT', '/api/security-settings', { twoFactor: 'all' })).error, /your own account first/);
  const { secret } = await admin('POST', '/api/me/2fa/setup', { password: PW });
  const { recoveryCodes } = await admin('POST', '/api/me/2fa/enable', { code: appCode(secret) });
  assert.equal((await admin('PUT', '/api/security-settings', { twoFactor: 'all' })).twoFactor, 'all');
  assert.ok(audited(db).includes('settings.security'));
  assert.match((await admin('POST', '/api/me/2fa/disable', { password: PW, code: recoveryCodes[0] })).error, /requires 2-step/);

  const hanaUser = await admin('POST', '/api/users', { name: 'Hana Reyes', username: 'hana', role: 'hr', password: PW, mustChangePassword: false });
  assert.equal((await admin('GET', '/api/users')).find((u) => u.id === hanaUser.id).twoFactorRequired, true);
  const hana = browser(handle, { ip: '10.0.0.12' });
  const signed = await hana('POST', '/api/auth/login', { username: 'hana', password: PW });
  assert.equal(signed.user.twoFactorSetupRequired, true);
  const blocked = await hana('GET', '/api/employees');
  assert.equal(blocked.status, 403);
  assert.match(blocked.error, /Set up 2-step verification first/);
  assert.equal((await hana('GET', '/api/me/2fa')).required, true);
  const setup = await hana('POST', '/api/me/2fa/setup', { password: PW });
  const enabled = await hana('POST', '/api/me/2fa/enable', { code: appCode(setup.secret) });
  assert.equal(enabled.user.twoFactorSetupRequired, false);
  assert.ok(Array.isArray(await hana('GET', '/api/employees')));

  // Lost phone and codes: an administrator resets it (not their own), and Hana is signed out.
  assert.match((await admin('POST', `/api/users/${db.data.users[0].id}/2fa/reset`)).error, /My security/);
  assert.equal((await admin('POST', `/api/users/${hanaUser.id}/2fa/reset`)).twoFactorEnabled, false);
  assert.equal((await hana('GET', '/api/employees')).status, 401);
  assert.ok(audited(db).includes('user.2fa-reset'));
  // Her next sign-in needs only the password, then the setup again.
  assert.equal((await hana('POST', '/api/auth/login', { username: 'hana', password: PW })).user.twoFactorSetupRequired, true);
});
