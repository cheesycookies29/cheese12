// 2-step verification, ported from CORE ERP (server/totp.js; test/security.test.js and vapt.test.js at
// the repository root): the RFC 6238 codes, setting it up under My security, the code step of each
// sign-in (wrong, reused and expired codes, recovery codes, the lock-out), the school's policy and the
// forced set-up, an administrator's reset, Keycloak sign-ins skipping it, backups, and that the secret
// and the recovery codes never leave the server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setup, seed } from './support.js';
import { setPasswordKeys } from '../server/auth.js';
import { base32Encode, base32Decode, codeAt, stepAt, verifyCode, otpauthUrl, newRecoveryCodes, hashRecovery, looksLikeRecovery, normalizeRecovery, newSecret } from '../server/totp.js';
import { twoFactorRequired, TWO_FACTOR_POLICIES } from '../shared/two-factor.js';
import { cleanTwoFactor } from '../server/two-factor.js';
import { startProvider } from './oidc-provider.js';

// The server keeps the secret encrypted with its password key; these tests run with one.
const KEY = randomBytes(32).toString('hex');
setPasswordKeys(KEY);

const PW = 'demo1234';
const status = (code, re) => (e) => e.status === code && (!re || re.test(e.message));
const START = Date.parse('2026-08-10T10:00:00');

// The demo school, with a clock the test moves (codes are worked out from it, as the server does).
async function school() {
  const time = { now: START };
  const env = setup({ clock: () => new Date(time.now) });
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123' });
  await admin.post('/api/admin/demo');
  const as = async (username, password = PW) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password });
    return c;
  };
  // The next 30 seconds' code from the phone (time moves on, so each code is new).
  const code = (secret) => {
    time.now += 30 * 1000;
    return codeAt(secret, stepAt(time.now));
  };
  // Turns 2-step verification on for a signed-in client: returns the secret and the recovery codes.
  const turnOn = async (client, password = PW) => {
    const { secret } = await client.post('/api/me/2fa/setup', { password });
    const { recoveryCodes } = await client.post('/api/me/2fa/enable', { code: code(secret) });
    return { secret, recoveryCodes };
  };
  // Signs in on the ATLAS home page with the password and then the code.
  const signIn = async (username, secret, { password = PW, client = env.client() } = {}) => {
    const first = await client.post('/api/hub/login', { username, password });
    assert.equal(first.twoFactorRequired, true);
    await client.post('/api/hub/login/verify', { challenge: first.challenge, code: code(secret) });
    return client;
  };
  const user = (username) => env.db.data.users.find((u) => u.username === username);
  const entries = () => env.api.audit.entries();
  return { env, admin, as, code, turnOn, signIn, user, entries, time };
}

test('RFC 6238 test vectors, base32, the time window, codes that work once, recovery codes', () => {
  // RFC 6238 appendix B (SHA-1): the secret "12345678901234567890"; the RFC shows 8 digits, ATLAS uses the last 6.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  assert.equal(base32Decode('gezd gnbv-gy3t').toString(), base32Decode('GEZDGNBVGY3T').toString(), 'case, spaces and dashes do not matter');
  for (const [seconds, eight] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(codeAt(secret, stepAt(seconds * 1000)), eight.slice(2), `T = ${seconds}`);
  }
  // A phone's clock a little off: one step either side; further is refused, and so is anything not 6 digits.
  const s = newSecret();
  assert.match(s, /^[A-Z2-7]{32}$/);
  const now = START;
  const step = stepAt(now);
  assert.equal(verifyCode(s, codeAt(s, step), { now }), step);
  assert.equal(verifyCode(s, codeAt(s, step - 1), { now }), step - 1);
  assert.equal(verifyCode(s, codeAt(s, step + 1), { now }), step + 1);
  assert.equal(verifyCode(s, codeAt(s, step + 3), { now }), null);
  assert.equal(verifyCode(s, `${codeAt(s, step).slice(0, 3)} ${codeAt(s, step).slice(3)}`, { now }), step, 'spaces are fine');
  for (const bad of ['', '12345', '1234567', 'abcdef', null]) assert.equal(verifyCode(s, bad, { now }), null);
  // Once used (lastStep), that step and earlier ones are refused.
  assert.equal(verifyCode(s, codeAt(s, step), { now, lastStep: step }), null);
  assert.equal(verifyCode(s, codeAt(s, step - 1), { now, lastStep: step }), null);
  assert.equal(verifyCode(s, codeAt(s, step + 1), { now, lastStep: step }), step + 1);
  // The link for the QR code.
  const url = otpauthUrl({ secret: s, account: 'stud1 (Lancaster Academy)' });
  assert.match(url, /^otpauth:\/\/totp\/ATLAS%3Astud1%20\(Lancaster%20Academy\)\?secret=[A-Z2-7]{32}&issuer=ATLAS&algorithm=SHA1&digits=6&period=30$/);
  // Recovery codes: ten, like K7QPM-2XW4D, without look-alike letters; hashed with ATLAS's own prefix.
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(normalizeRecovery(' k7qpm 2xw4d '), 'K7QPM2XW4D');
  assert.equal(hashRecovery('k7qpm-2xw4d'), hashRecovery('K7QPM2XW4D'));
  assert.notEqual(hashRecovery('K7QPM-2XW4D'), hashRecovery('K7QPM-2XW4E'));
  assert.ok(looksLikeRecovery('K7QPM-2XW4D') && !looksLikeRecovery('123456'));
  // The policy.
  assert.deepEqual(Object.keys(TWO_FACTOR_POLICIES), ['off', 'admins', 'staff', 'all']);
  const who = (p) => ['admin', 'registrar', 'teacher', 'hr', 'student', 'guardian'].filter((role) => twoFactorRequired({ twoFactor: p }, { role }));
  assert.deepEqual(who('off'), []);
  assert.deepEqual(who(undefined), []);
  assert.deepEqual(who('admins'), ['admin']);
  assert.deepEqual(who('staff'), ['admin', 'registrar', 'teacher', 'hr']);
  assert.deepEqual(who('all'), ['admin', 'registrar', 'teacher', 'hr', 'student', 'guardian']);
});

test('set up under My security, then sign in on the ATLAS home page with the password and a code', async () => {
  const f = await school();
  const teacher = await f.as('teacher.demo');
  const before = await teacher.get('/api/me/2fa');
  assert.equal(before.enabled, false);
  assert.equal(before.required, false);
  assert.equal(before.available, true);
  // Step 1: the password, then a secret for the app.
  await assert.rejects(teacher.post('/api/me/2fa/setup', { password: 'wrong-password' }), status(400, /password is not right/));
  const setupRes = await teacher.post('/api/me/2fa/setup', { password: PW });
  assert.match(setupRes.secret, /^[A-Z2-7]{32}$/);
  assert.match(setupRes.otpauthUrl, /^otpauth:\/\/totp\/ATLAS%3Ateacher\.demo%20/);
  // Kept encrypted, never in plain text.
  const pending = f.user('teacher.demo').twoFactorPending;
  assert.match(pending.secret, /^enc1\$/);
  assert.ok(!JSON.stringify(f.env.db.data).includes(setupRes.secret));
  // Step 2: the first code turns it on; ten recovery codes, shown once; other sessions end.
  const other = await f.as('teacher.demo');
  await assert.rejects(teacher.post('/api/me/2fa/enable', { code: '000000' }), status(400, /not right/));
  const on = await teacher.post('/api/me/2fa/enable', { code: f.code(setupRes.secret) });
  assert.equal(on.recoveryCodes.length, 10);
  assert.equal(on.user.twoFactorEnabled, true);
  assert.equal(on.user.twoFactor, undefined);
  assert.equal((await teacher.get('/api/me/2fa')).enabled, true, 'this session goes on');
  await assert.rejects(other.get('/api/me/2fa'), status(401), 'the other device signs in again');
  const stored = f.user('teacher.demo').twoFactor;
  assert.match(stored.secret, /^enc1\$/);
  assert.equal(stored.recovery.length, 10);
  assert.ok(stored.recovery.every((r) => /^[0-9a-f]{64}$/.test(r.hash) && r.usedAt === null));
  assert.equal(f.user('teacher.demo').twoFactorPending, undefined);
  assert.ok(f.entries().some((e) => e.action === 'Turned on 2-step verification' && e.kind === 'password'));

  // Signing in: the password alone opens no session and changes no cookie.
  const browser = f.env.client();
  await browser.post('/api/hub/login', { username: 'admin', password: 'password123' }); // someone else was signed in here
  const first = await browser.post('/api/hub/login', { username: 'teacher.demo', password: PW });
  assert.deepEqual(Object.keys(first).sort(), ['challenge', 'twoFactorRequired']);
  assert.match(first.challenge, /^[0-9a-f]{48}$/);
  assert.equal((await browser.get('/api/hub/status')).user.username, 'admin', 'nothing changed yet');
  // A wrong code: refused, in the audit log (never the code).
  await assert.rejects(browser.post('/api/hub/login/verify', { challenge: first.challenge, code: '123456' }), status(401, /not right/));
  await assert.rejects(browser.post('/api/hub/login/verify', { challenge: first.challenge, code: '' }), status(401, /not right/));
  const failed = f.entries().filter((e) => e.action === 'Sign-in failed: wrong 2-step verification code');
  assert.equal(failed.length, 2);
  assert.equal(failed[0].outcome, 'failed');
  assert.ok(!JSON.stringify(failed).includes('123456'));
  // The code used to turn it on works no more (each code works once).
  const used = codeAt(setupRes.secret, stepAt(f.time.now));
  await assert.rejects(browser.post('/api/hub/login/verify', { challenge: first.challenge, code: used }), status(401));
  // The right code: the session opens, the other side's session in this browser ends.
  const next = f.code(setupRes.secret);
  const done = await browser.post('/api/hub/login/verify', { challenge: first.challenge, code: next });
  assert.equal(done.user.username, 'teacher.demo');
  assert.equal(done.user.twoFactorEnabled, true);
  const st = await browser.get('/api/hub/status');
  assert.equal(st.user.username, 'teacher.demo');
  assert.equal(st.side, 'portal');
  assert.equal((await browser.get('/api/admin/auth/status')).user, null, 'one person per browser, as with a password');
  assert.ok(f.entries().some((e) => e.action === 'Signed in' && /password and 2-step verification code/.test(e.detail)));
  // The challenge is used up, and so is the code.
  await assert.rejects(browser.post('/api/hub/login/verify', { challenge: first.challenge, code: next }), status(401, /expired/));
  const again = await f.env.client().post('/api/hub/login', { username: 'teacher.demo', password: PW });
  await assert.rejects(f.env.client().post('/api/hub/login/verify', { challenge: again.challenge, code: next }), status(401, /not right/));
  // A wrong password still says nothing about 2-step verification.
  await assert.rejects(f.env.client().post('/api/hub/login', { username: 'teacher.demo', password: 'nope-nope' }), status(401, /Incorrect username or password/));
});

test('recovery codes, expired challenges, the Learn and Admin panel sign-ins', async () => {
  const f = await school();
  const { secret, recoveryCodes } = await f.turnOn(await f.as('student.demo'));
  // A recovery code signs in once (any case, with or without the dash).
  const c1 = f.env.client();
  const a = await c1.post('/api/hub/login', { username: 'student.demo', password: PW });
  await c1.post('/api/hub/login/verify', { challenge: a.challenge, code: recoveryCodes[0].toLowerCase().replace('-', '') });
  assert.equal((await c1.get('/api/hub/status')).user.username, 'student.demo');
  const entry = f.entries().findLast((e) => e.action === 'Signed in with a recovery code');
  assert.match(entry.detail, /9 recovery codes left/);
  assert.ok(!JSON.stringify(f.entries()).includes(recoveryCodes[0]));
  assert.equal((await c1.get('/api/me/2fa')).recoveryLeft, 9);
  const b = await f.env.client().post('/api/hub/login', { username: 'student.demo', password: PW });
  await assert.rejects(f.env.client().post('/api/hub/login/verify', { challenge: b.challenge, code: recoveryCodes[0] }), status(401), 'a recovery code works once');
  // A challenge lasts five minutes.
  const late = f.env.client();
  const c = await late.post('/api/hub/login', { username: 'student.demo', password: PW });
  f.time.now += 5 * 60 * 1000 + 1000;
  await assert.rejects(late.post('/api/hub/login/verify', { challenge: c.challenge, code: codeAt(secret, stepAt(f.time.now)) }), status(401, /expired/));
  await assert.rejects(late.post('/api/hub/login/verify', { challenge: 'made-up', code: '123456' }), status(401, /expired/));
  // Learn's own sign-in has its own verify route; a challenge works only on the route that started it.
  const learn = f.env.client();
  const d = await learn.post('/api/auth/login', { username: 'student.demo', password: PW });
  assert.equal(d.twoFactorRequired, true);
  await assert.rejects(learn.post('/api/admin/auth/login/verify', { challenge: d.challenge, code: f.code(secret) }), status(401, /expired/));
  const d2 = await learn.post('/api/auth/login', { username: 'student.demo', password: PW });
  await learn.post('/api/auth/login/verify', { challenge: d2.challenge, code: f.code(secret) });
  assert.equal((await learn.get('/api/auth/status')).user.username, 'student.demo');
  // The Admin panel's sign-in, for a registrar.
  const reg = await f.as('registrar.demo');
  const r = await f.turnOn(reg);
  const panel = f.env.client();
  const e = await panel.post('/api/admin/auth/login', { username: 'registrar.demo', password: PW });
  assert.equal(e.twoFactorRequired, true);
  assert.equal((await panel.get('/api/admin/auth/status')).user, null);
  await panel.post('/api/admin/auth/login/verify', { challenge: e.challenge, code: f.code(r.secret) });
  assert.equal((await panel.get('/api/admin/auth/status')).user.username, 'registrar.demo');
});

test('wrong codes count as wrong passwords: five end the sign-in and lock the username; the address pauses too', async () => {
  const f = await school();
  const { secret } = await f.turnOn(await f.as('teacher.demo'));
  const c = f.env.client();
  const { challenge } = await c.post('/api/hub/login', { username: 'teacher.demo', password: PW });
  for (let i = 1; i <= 4; i++) await assert.rejects(c.post('/api/hub/login/verify', { challenge, code: '000000' }), status(401, /not right/));
  await assert.rejects(c.post('/api/hub/login/verify', { challenge, code: '000000' }), status(429, /Too many wrong 2-step verification codes/));
  assert.ok(f.entries().some((e) => e.action === 'Sign-in failed: 2-step verification locked after wrong codes'));
  // The username is locked now (five wrong in a row, as five wrong passwords would), even with the right password.
  await assert.rejects(c.post('/api/hub/login', { username: 'teacher.demo', password: PW }), status(429, /Too many failed attempts/));
  // The challenge is gone: the right code does not help.
  await assert.rejects(c.post('/api/hub/login/verify', { challenge, code: f.code(secret) }), status(401, /expired/));

  // The per-address limit counts wrong codes too (here 10 in 15 minutes, with a looser username lock).
  const g = await school();
  await g.admin.put('/api/admin/settings', { security: { lockoutAttempts: 20, signInFailuresPerAddress: 10 } });
  const t2 = await g.turnOn(await g.as('teacher.demo'));
  const d = g.env.client();
  for (let round = 0; round < 2; round++) {
    const { challenge: ch } = await d.post('/api/hub/login', { username: 'teacher.demo', password: PW });
    for (let i = 0; i < 5; i++) await assert.rejects(d.post('/api/hub/login/verify', { challenge: ch, code: '000000' }), status(401));
  }
  await assert.rejects(d.post('/api/hub/login', { username: 'teacher.demo', password: PW }), status(429, /wrong passwords from your network/));
  assert.ok(t2.secret);
});

test('wrong codes count for the account from every address; a right password does not forgive them, a right code does', async () => {
  const f = await school();
  const { secret, recoveryCodes } = await f.turnOn(await f.as('teacher.demo'));
  // One wrong code from each of five addresses, typing the right password again before each one.
  const from = (i) => f.env.client({ ip: `198.51.100.${i}` });
  const tryOnce = async (ip, code) => {
    const c = from(ip);
    const { challenge } = await c.post('/api/hub/login', { username: 'teacher.demo', password: PW });
    return c.post('/api/hub/login/verify', { challenge, code });
  };
  for (let i = 1; i <= 4; i++) await assert.rejects(tryOnce(i, '000000'), status(401, /not right/));
  // A wrong recovery code counts the same way: the fifth wrong code locks the code step.
  await assert.rejects(tryOnce(5, 'AAAAA-BBBBB'), status(429, /Too many wrong 2-step verification codes for this account. Try again in 5 minutes/));
  // Now the right password still asks for a code (it says nothing about the password), but no code works, not even a recovery code.
  await assert.rejects(tryOnce(6, f.code(secret)), status(429, /Too many wrong 2-step verification codes/));
  await assert.rejects(tryOnce(7, recoveryCodes[0]), status(429, /Too many wrong 2-step verification codes/));
  assert.equal(f.user('teacher.demo').twoFactor.recovery.filter((r) => r.usedAt).length, 0, 'the recovery code was not used up');
  assert.ok(f.entries().some((e) => e.action === 'Sign-in refused: 2-step verification locked after wrong codes'));
  // The person is told on the bell.
  const bell = f.env.db.data.notifications.filter((n) => n.userId === f.user('teacher.demo').id && n.kind === '2fa-locked');
  assert.equal(bell.length, 1);
  assert.equal(bell[0].system, 'account');
  assert.equal(bell[0].link, '/lms/#/security');
  // The wait ends after "Minutes locked"; then the right code signs in, and the count starts again.
  f.time.now += 5 * 60 * 1000 + 1000;
  await tryOnce(8, f.code(secret));
  for (let i = 1; i <= 4; i++) await assert.rejects(tryOnce(10 + i, '000000'), status(401, /not right/));
  await tryOnce(20, f.code(secret)); // four wrong, then right: not locked
  for (let i = 1; i <= 4; i++) await assert.rejects(tryOnce(30 + i, '000000'), status(401, /not right/));
  await assert.rejects(tryOnce(35, '000000'), status(429, /Try again in 5 minutes/));
  // Locked again without a right code in between: twice as long.
  f.time.now += 5 * 60 * 1000 + 1000;
  for (let i = 1; i <= 4; i++) await assert.rejects(tryOnce(40 + i, '000000'), status(401, /not right/));
  await assert.rejects(tryOnce(45, '000000'), status(429, /Try again in 10 minutes/));
  f.time.now += 5 * 60 * 1000 + 1000;
  await assert.rejects(tryOnce(46, f.code(secret)), status(429, /Try again in 5 minutes/));
  f.time.now += 5 * 60 * 1000;
  await tryOnce(47, f.code(secret));
  // The lock follows the school's lock-out settings.
  await f.turnOn(f.admin, 'password123');
  await f.admin.put('/api/admin/settings', { security: { lockoutAttempts: 3, lockoutMinutes: 30 } });
  for (let i = 1; i <= 2; i++) await assert.rejects(tryOnce(50 + i, '000000'), status(401, /not right/));
  await assert.rejects(tryOnce(53, '000000'), status(429, /Try again in 30 minutes/));
});

test('wrong codes under My security count towards the same lock', async () => {
  const f = await school();
  const teacher = await f.as('teacher.demo');
  const { secret } = await f.turnOn(teacher);
  for (let i = 1; i <= 4; i++) await assert.rejects(teacher.post('/api/me/2fa/recovery-codes', { password: PW, code: '000000' }), status(400, /not right/));
  await assert.rejects(teacher.post('/api/me/2fa/recovery-codes', { password: PW, code: '000000' }), status(429, /Too many wrong 2-step verification codes/));
  await assert.rejects(teacher.post('/api/me/2fa/recovery-codes', { password: PW, code: f.code(secret) }), status(429));
  // Signing in waits too.
  const c = f.env.client({ ip: '203.0.113.9' });
  const { challenge } = await c.post('/api/hub/login', { username: 'teacher.demo', password: PW });
  await assert.rejects(c.post('/api/hub/login/verify', { challenge, code: f.code(secret) }), status(429));
  f.time.now += 5 * 60 * 1000 + 1000;
  assert.equal((await teacher.post('/api/me/2fa/recovery-codes', { password: PW, code: f.code(secret) })).recoveryCodes.length, 10);
});

test('My security: turn off and new recovery codes need the password and a code; the policy keeps it on', async () => {
  const f = await school();
  const teacher = await f.as('teacher.demo');
  const { secret, recoveryCodes } = await f.turnOn(teacher);
  await assert.rejects(teacher.post('/api/me/2fa/setup', { password: PW }), status(400, /already on/));
  // New recovery codes: the old ones stop working.
  await assert.rejects(teacher.post('/api/me/2fa/recovery-codes', { password: 'wrong-pass', code: f.code(secret) }), status(400, /password/));
  await assert.rejects(teacher.post('/api/me/2fa/recovery-codes', { password: PW, code: '000000' }), status(400, /not right/));
  const fresh = await teacher.post('/api/me/2fa/recovery-codes', { password: PW, code: recoveryCodes[1] });
  assert.equal(fresh.recoveryCodes.length, 10);
  assert.equal(fresh.status.recoveryLeft, 10);
  const x = await f.env.client().post('/api/hub/login', { username: 'teacher.demo', password: PW });
  await assert.rejects(f.env.client().post('/api/hub/login/verify', { challenge: x.challenge, code: recoveryCodes[2] }), status(401), 'an old recovery code');
  assert.ok(f.entries().some((e) => e.action === 'Made new 2-step verification recovery codes'));
  // The school requires it of employees: it cannot be turned off.
  await f.turnOn(f.admin, 'password123');
  await f.admin.put('/api/admin/settings', { security: { twoFactor: 'staff' } });
  assert.equal((await teacher.get('/api/me/2fa')).required, true);
  await assert.rejects(teacher.post('/api/me/2fa/disable', { password: PW, code: f.code(secret) }), status(400, /requires 2-step verification/));
  // Optional again: turned off with the password and a code; the password alone signs in.
  await f.admin.put('/api/admin/settings', { security: { twoFactor: 'off' } });
  await assert.rejects(teacher.post('/api/me/2fa/disable', { password: PW, code: '111111' }), status(400));
  const off = await teacher.post('/api/me/2fa/disable', { password: PW, code: f.code(secret) });
  assert.equal(off.user.twoFactorEnabled, false);
  assert.equal(f.user('teacher.demo').twoFactor, undefined);
  const plain = await f.env.client().post('/api/hub/login', { username: 'teacher.demo', password: PW });
  assert.equal(plain.user.username, 'teacher.demo');
  assert.ok(f.entries().some((e) => e.action === 'Turned off 2-step verification'));
});

test('the policy: required of yourself only once you have it; then set up right after signing in, before anything else', async () => {
  const f = await school();
  await assert.rejects(f.admin.put('/api/admin/settings', { security: { twoFactor: 'bogus' } }), status(400, /Choose who must use/));
  await assert.rejects(f.admin.put('/api/admin/settings', { security: { twoFactor: 'admins' } }), status(400, /Turn on 2-step verification for your own account first/));
  await assert.rejects(f.admin.put('/api/admin/settings', { security: { twoFactor: 'staff' } }), status(400, /own account first/));
  assert.equal((await f.admin.get('/api/admin/settings')).security.twoFactor, 'off');
  await f.turnOn(f.admin, 'password123');
  const saved = await f.admin.put('/api/admin/settings', { security: { twoFactor: 'staff' } });
  assert.equal(saved.security.twoFactor, 'staff');
  // Other security settings saved later keep it.
  await f.admin.put('/api/admin/settings', { security: { minPasswordLength: 10 } });
  assert.equal(f.env.db.data.settings.security.twoFactor, 'staff');
  // The Settings center knows the setting, and its change is in the history.
  assert.ok(f.env.db.data.settingsLog.some((e) => JSON.stringify(e).includes('twoFactor')));

  // An employee without it: signed in, but sent to set it up first.
  const teacher = await f.as('teacher.demo');
  const st = await teacher.get('/api/hub/status');
  assert.equal(st.user.twoFactorSetupRequired, true);
  assert.equal((await teacher.get('/api/auth/status')).user.twoFactorSetupRequired, true);
  await assert.rejects(teacher.get('/api/hub/figures'), status(403, /Set up 2-step verification first/));
  await assert.rejects(teacher.get('/api/me/profile'), status(403, /Set up 2-step/));
  assert.ok(!f.entries().some((e) => e.kind === 'refused' && /Set up 2-step/.test(e.detail)), 'not a refusal worth logging');
  const tfa = await teacher.get('/api/me/2fa');
  assert.deepEqual([tfa.required, tfa.setupRequired, tfa.policy], [true, true, 'staff']);
  await f.turnOn(teacher);
  assert.equal((await teacher.get('/api/hub/status')).user.twoFactorSetupRequired, false);
  assert.ok(await teacher.get('/api/hub/figures'));
  // Students and parents are not employees.
  const student = await f.as('student.demo');
  assert.equal((await student.get('/api/hub/status')).user.twoFactorSetupRequired, false);
  assert.ok(await student.get('/api/hub/figures'));
  // Required of everyone: students too. A forced password change comes first, then this.
  await f.admin.put('/api/admin/settings', { security: { twoFactor: 'all' } });
  assert.equal((await student.get('/api/hub/status')).user.twoFactorSetupRequired, true);
  const stud = f.user('student.demo');
  stud.mustChangePassword = true;
  await assert.rejects(student.get('/api/hub/figures'), status(403, /change your password first/));
  await student.post('/api/auth/change-password', { currentPassword: PW, newPassword: 'another-pass-1' });
  await assert.rejects(student.get('/api/hub/figures'), status(403, /Set up 2-step/));
  await f.turnOn(student, 'another-pass-1');
  assert.ok(await student.get('/api/hub/figures'));
  // Without the password key, ATLAS cannot keep the secret encrypted, so it cannot be set up.
  const parent = await f.as('parent.demo');
  setPasswordKeys('');
  try {
    assert.equal((await parent.get('/api/me/2fa')).available, false);
    await assert.rejects(parent.post('/api/me/2fa/setup', { password: PW }), status(400, /password key/));
  } finally {
    setPasswordKeys(KEY);
  }
});

test('the sign-in and password settings: only administrators change them, others with settings.edit read them', async () => {
  const f = await school();
  await f.turnOn(f.admin, 'password123');
  await f.admin.put('/api/admin/settings', { security: { twoFactor: 'staff' } });
  // A registrar who may change the school's settings, with 2-step verification on.
  f.user('registrar.demo').access = { add: ['settings.edit'] };
  const reg = await f.as('registrar.demo');
  const { secret } = await f.turnOn(reg);
  for (const security of [{ twoFactor: 'off' }, { lockoutAttempts: 20 }, { lockoutMinutes: 1 }, { signInFailuresPerAddress: 1000 }, { requestsPerMinute: 3000 }, { schoolNetworkFactor: 100 }, { schoolNetworks: [{ cidr: '203.0.113.0/24', label: 'x' }] }, { minPasswordLength: 8, idleHours: 72 }]) {
    await assert.rejects(reg.put('/api/admin/settings', { security }), status(403, /Only administrators change the sign-in and password settings/), JSON.stringify(security));
  }
  const sec = f.env.db.data.settings.security;
  assert.deepEqual([sec.twoFactor, sec.lockoutAttempts, sec.lockoutMinutes, sec.signInFailuresPerAddress], ['staff', 5, 5, 30]);
  // Through the Settings center too (restore defaults, undo, import).
  await assert.rejects(reg.post('/api/admin/config/reset', { area: 'security', path: 'twoFactor' }), status(403));
  await assert.rejects(reg.post('/api/admin/config/reset', { area: 'security', path: '' }), status(403));
  const file = await reg.get('/api/admin/config/export');
  file.areas.security.twoFactor = 'off';
  await assert.rejects(reg.post('/api/admin/config/import', { file, areas: ['security'] }), status(403));
  const entry = f.env.db.data.settingsLog.findLast((e) => e.area === 'security');
  await assert.rejects(reg.post(`/api/admin/config/history/${entry.id}/undo`), status(403));
  assert.equal(f.env.db.data.settings.security.twoFactor, 'staff');
  // The same values sent back, and the school's other settings, are fine; reading them is too.
  await reg.put('/api/admin/settings', { schoolName: 'Lancaster Academy', security: { ...(await reg.get('/api/admin/settings')).security } });
  assert.equal((await reg.get('/api/admin/settings')).security.twoFactor, 'staff');
  assert.equal(f.env.db.data.settings.schoolName, 'Lancaster Academy');
  // Administrators change them.
  await f.admin.put('/api/admin/settings', { security: { lockoutAttempts: 6 } });
  assert.equal(f.env.db.data.settings.security.lockoutAttempts, 6);
  assert.ok(secret);
});

test('until 2-step verification is set up, only setting it up and signing out answer as that account', async () => {
  const f = await school();
  await f.turnOn(f.admin, 'password123');
  await f.admin.put('/api/admin/settings', { security: { twoFactor: 'staff' } });
  f.user('registrar.demo').access = { add: ['guides.edit'] };
  const reg = await f.as('registrar.demo');
  // The pages' status says what to do; My security works.
  assert.equal((await reg.get('/api/hub/status')).user.twoFactorSetupRequired, true);
  assert.equal((await reg.get('/api/admin/auth/status')).user.twoFactorSetupRequired, true);
  assert.equal((await reg.get('/api/me/2fa')).setupRequired, true);
  // News and the guides see a signed-out visitor: no news, only the public guide, no editing.
  await assert.rejects(reg.get('/api/hub/feed'), status(401));
  const list = await reg.get('/api/guides');
  assert.equal(list.signedIn, false);
  assert.deepEqual(list.guides.map((g) => g.id), ['getting-started']);
  await assert.rejects(reg.get('/api/guides/admin'), status(401));
  await assert.rejects(reg.put('/api/guides/getting-started', { markdown: '---\ntitle: Changed\n---\n\nChanged.' }), status(401));
  await assert.rejects(reg.del('/api/guides/getting-started'), status(401));
  assert.equal((f.env.db.data.guideEdits || []).length, 0);
  // Once it is set up, they answer as usual.
  await f.turnOn(reg);
  assert.ok((await reg.get('/api/hub/feed')).news);
  assert.equal((await reg.get('/api/guides')).signedIn, true);
  assert.ok((await reg.get('/api/guides/admin')).markdown);
  // The same for an account that must change its password first.
  const student = await f.as('student.demo');
  f.user('student.demo').mustChangePassword = true;
  await assert.rejects(student.get('/api/hub/feed'), status(401));
  assert.equal((await student.get('/api/guides')).signedIn, false);
  assert.equal((await student.get('/api/auth/status')).user.mustChangePassword, true);
  // Signing out works.
  await student.post('/api/hub/logout');
  assert.equal((await student.get('/api/hub/status')).user, null);
  assert.ok(f.entries().some((e) => e.action === 'Signed out' && e.actorId === f.user('student.demo').id), 'the sign-out is in the audit log, with who it was');
});

test('administrators: who uses it in Users & Access, and Reset 2-step verification (audited; not your own)', async () => {
  const f = await school();
  const teacher = await f.as('teacher.demo');
  const { secret } = await f.turnOn(teacher);
  const id = f.user('teacher.demo').id;
  const list = await f.admin.get('/api/system/users?q=teacher.demo');
  assert.equal(list.users[0].twoFactor, true);
  assert.equal(list.users[0].twoFactorRequired, false);
  assert.ok((await f.admin.get('/api/system/users?flag=no-2fa')).users.every((u) => !u.twoFactor));
  assert.equal((await f.admin.get(`/api/system/users/${id}`)).twoFactor, true);
  // Only administrators; never for your own account; only for an account that uses it.
  const registrar = await f.as('registrar.demo');
  await assert.rejects(registrar.post(`/api/system/users/${id}/reset-2fa`), status(403));
  await assert.rejects(f.admin.post(`/api/system/users/${f.user('admin').id}/reset-2fa`), status(400, /My security/));
  await assert.rejects(f.admin.post(`/api/system/users/${f.user('student.demo').id}/reset-2fa`), status(400, /does not use/));
  const res = await f.admin.post(`/api/system/users/${id}/reset-2fa`);
  assert.equal(res.twoFactor, false);
  assert.equal(f.user('teacher.demo').twoFactor, undefined);
  await assert.rejects(teacher.get('/api/me/2fa'), status(401), 'signed out everywhere');
  const entry = f.entries().findLast((e) => e.action === 'Reset 2-step verification');
  assert.equal(entry.kind, 'password', 'like a password reset, it does not keep the administrator from being deleted');
  assert.equal(entry.targetId, id);
  assert.equal(entry.actorId, f.user('admin').id);
  // They are told on the bell (Your account), with a link to My security in their own system.
  const told = f.env.db.data.notifications.filter((n) => n.userId === id && n.kind === '2fa-reset');
  assert.equal(told.length, 1);
  assert.equal(told[0].system, 'account');
  assert.match(told[0].title, /^Ada Admin reset your 2-step verification$/);
  assert.match(told[0].link, /^\/(lms\/|admin|hris\/)#\/security$/);
  assert.equal(told[0].actorId, f.user('admin').id);
  // The password alone signs in again; with the policy on, they set it up again at once.
  const again = await f.env.client().post('/api/hub/login', { username: 'teacher.demo', password: PW });
  assert.equal(again.user.username, 'teacher.demo');
  assert.ok(secret);
  // A set-up left half way (QR code shown, no code entered) can be reset too.
  const reg = await f.as('registrar.demo');
  await reg.post('/api/me/2fa/setup', { password: PW });
  assert.equal((await f.admin.get(`/api/system/users/${f.user('registrar.demo').id}`)).twoFactorPending, true);
  await f.admin.post(`/api/system/users/${f.user('registrar.demo').id}/reset-2fa`);
  assert.equal(f.user('registrar.demo').twoFactorPending, undefined);
});

test('the Security monitor: administrators without it, while nobody must use it', async () => {
  const f = await school();
  const check = async () => (await f.admin.get('/api/system/monitor')).status.checks.find((c) => c.id === 'two-factor');
  const a = await check();
  assert.equal(a.state, 'warn');
  assert.match(a.detail, /admin/);
  await f.turnOn(f.admin, 'password123');
  assert.equal((await check()).state, 'ok');
  await f.admin.put('/api/admin/settings', { security: { twoFactor: 'admins' } });
  assert.match((await check()).detail, /Required for administrators/);
});

test('backups: valid 2-step verification fields are kept, invalid ones dropped; a restored account still needs its code', async () => {
  const f = await school();
  const t = await f.turnOn(await f.as('teacher.demo'));
  const s = await f.turnOn(await f.as('student.demo'));
  await (await f.as('registrar.demo')).post('/api/me/2fa/setup', { password: PW });
  const backup = await f.admin.get('/api/admin/backup');
  const raw = JSON.stringify(backup);
  assert.ok(!raw.includes(t.secret) && !raw.includes(s.secret), 'the backup has only the encrypted secret');
  assert.ok(!t.recoveryCodes.some((c) => raw.includes(c)), 'and only the hashes of the recovery codes');
  const by = (n) => backup.users.find((u) => u.username === n);
  by('student.demo').twoFactor.recovery = 'not a list';
  by('parent.demo').twoFactor = { secret: 'PLAINTEXTSECRET', enabledAt: '2026-08-01T00:00:00Z', recovery: [] }; // not encrypted: dropped
  by('jdelacruz.demo').twoFactorPending = { secret: 42 };
  by('teacher.demo').twoFactor.extra = 'dropped field';
  const res = await f.admin.post('/api/admin/restore', backup);
  assert.equal(res.droppedTwoFactor, 3);
  assert.equal(f.user('student.demo').twoFactor, undefined);
  assert.equal(f.user('parent.demo').twoFactor, undefined);
  assert.equal(f.user('jdelacruz.demo').twoFactorPending, undefined);
  assert.deepEqual(Object.keys(f.user('teacher.demo').twoFactor).sort(), ['enabledAt', 'lastStep', 'recovery', 'secret']);
  assert.ok(f.user('registrar.demo').twoFactorPending.secret.startsWith('enc1$'), 'a valid pending set-up is kept');
  // The restored teacher still needs the code; the student (dropped) signs in with the password alone.
  await f.signIn('teacher.demo', t.secret);
  assert.equal((await f.env.client().post('/api/hub/login', { username: 'student.demo', password: PW })).user.username, 'student.demo');
  // The validator on its own.
  assert.equal(cleanTwoFactor(null), null);
  assert.equal(cleanTwoFactor({ secret: 'enc1$a$b$c', enabledAt: 'yesterday', recovery: [] }), null);
  assert.equal(cleanTwoFactor({ secret: 'enc1$a$b$c', enabledAt: '2026-08-01T00:00:00Z', lastStep: 1.5, recovery: [] }), null);
  assert.equal(cleanTwoFactor({ secret: 'enc1$a$b$c', enabledAt: '2026-08-01T00:00:00Z', recovery: [{ hash: 'short' }] }), null);
  assert.deepEqual(cleanTwoFactor({ secret: 'enc1$a$b$c', enabledAt: '2026-08-01T00:00:00Z', recovery: [{ hash: 'a'.repeat(64), more: 1 }] }), { secret: 'enc1$a$b$c', enabledAt: '2026-08-01T00:00:00Z', lastStep: -1, recovery: [{ hash: 'a'.repeat(64), usedAt: null }] });
});

test('a new password key: the secret is encrypted again under it, and codes still work', async () => {
  const f = await school();
  const t = await f.turnOn(await f.as('teacher.demo'));
  const before = f.user('teacher.demo').twoFactor.secret;
  const next = randomBytes(32).toString('hex');
  setPasswordKeys(next, [KEY]);
  try {
    f.env.api.sealPasswords();
    const after = f.user('teacher.demo').twoFactor.secret;
    assert.notEqual(after.split('$')[1], before.split('$')[1], 'under the new key id');
    await f.signIn('teacher.demo', t.secret);
    // Only the new key now: the code still works (the old key is no longer needed).
    setPasswordKeys(next);
    await f.signIn('teacher.demo', t.secret);
    // With the secret unreadable (as after a restore on a server without that key), only recovery codes work.
    f.user('teacher.demo').twoFactor.secret = `enc1$00000000$${before.split('$').slice(2).join('$')}`;
    const c = f.env.client();
    const x = await c.post('/api/hub/login', { username: 'teacher.demo', password: PW });
    await assert.rejects(c.post('/api/hub/login/verify', { challenge: x.challenge, code: f.code(t.secret) }), status(401, /not right/));
    await c.post('/api/hub/login/verify', { challenge: x.challenge, code: t.recoveryCodes[0] });
    assert.equal((await c.get('/api/hub/status')).user.username, 'teacher.demo');
  } finally {
    setPasswordKeys(KEY);
  }
});

test('the secret and the recovery codes never leave the server: answers, exports, the audit log', async () => {
  const f = await school();
  const teacher = await f.as('teacher.demo');
  const { secret: pendingSecret } = await teacher.post('/api/me/2fa/setup', { password: PW });
  const { recoveryCodes } = await teacher.post('/api/me/2fa/enable', { code: f.code(pendingSecret) });
  const secret = pendingSecret;
  const stored = f.user('teacher.demo').twoFactor;
  const forbidden = [secret, stored.secret, ...recoveryCodes, ...recoveryCodes.map((c) => c.replace('-', '')), ...stored.recovery.map((r) => r.hash)];
  const id = f.user('teacher.demo').id;
  const signedIn = await f.signIn('teacher.demo', secret);
  const answers = {
    'hub status': await signedIn.get('/api/hub/status'),
    'learn status': await signedIn.get('/api/auth/status'),
    'hris status': await signedIn.get('/api/hris/auth/status'),
    'academic status': await signedIn.get('/api/academic/auth/status'),
    'my profile': await signedIn.get('/api/me/profile'),
    'my 2fa': await signedIn.get('/api/me/2fa'),
    'my sessions': await signedIn.get('/api/me/sessions'),
    'users & access': await f.admin.get('/api/system/users'),
    'one account': await f.admin.get(`/api/system/users/${id}`),
    'their profile': await f.admin.get(`/api/system/users/${id}/profile`),
    'admin panel users': await f.admin.get('/api/admin/users?role=teacher'),
    'audit log': await f.admin.get(`/api/system/audit?userId=${id}`),
    'audit csv': (await f.admin.get('/api/system/audit?format=csv')).raw,
    'audit entries': f.entries(),
    'monitor': await f.admin.get('/api/system/monitor'),
    'settings': await f.admin.get('/api/admin/settings'),
  };
  for (const [where, value] of Object.entries(answers)) {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    for (const x of forbidden) assert.ok(!s.includes(x), `${where} must not contain a secret or recovery code`);
    assert.ok(!/"twoFactor(Pending)?":\{/.test(s), `${where} must not carry the stored fields`);
  }
  assert.equal(answers['hub status'].user.twoFactorEnabled, true);
  // The data file holds only the encrypted secret and the hashes.
  const file = JSON.stringify(f.env.db.data);
  assert.ok(!file.includes(secret) && !recoveryCodes.some((c) => file.includes(c)));
});

test('Keycloak sign-ins skip ATLAS\'s 2-step verification (Keycloak asks for its own)', async () => {
  const kc = await startProvider();
  after(() => kc.close());
  const time = { now: START };
  const env = setup({ clock: () => new Date(time.now), options: { ssoSecret: kc.secret } });
  const s = await seed(env);
  await s.admin.post('/api/admin/users', { role: 'teacher', username: 'maria', name: 'Maria Santos', email: 'maria@school.edu', password: 'password123', mustChangePassword: false });
  await s.admin.put('/api/admin/sso', { issuer: kc.issuer, clientId: kc.clientId, matchBy: 'email', enabled: true, allowPasswords: true });
  // Maria uses 2-step verification with her ATLAS password.
  const pw = env.client();
  await pw.post('/api/hub/login', { username: 'maria', password: 'password123' });
  const { secret } = await pw.post('/api/me/2fa/setup', { password: 'password123' });
  time.now += 30000;
  await pw.post('/api/me/2fa/enable', { code: codeAt(secret, stepAt(time.now)) });
  assert.equal((await env.client().post('/api/hub/login', { username: 'maria', password: 'password123' })).twoFactorRequired, true);
  // Through Keycloak: signed in without the code.
  const sso = async (claims) => {
    const client = env.client();
    const start = await client.get('/api/sso/start?next=%2F');
    await client.get(kc.authorize(start.headers.Location, claims, { now: time.now }));
    return client;
  };
  const viaKc = await sso({ sub: 'kc-maria', email: 'maria@school.edu', email_verified: true, preferred_username: 'maria' });
  const st = await viaKc.get('/api/hub/status');
  assert.equal(st.user.username, 'maria');
  const tfa = await viaKc.get('/api/me/2fa');
  assert.deepEqual([tfa.enabled, tfa.sso.linked, tfa.sso.thisSession], [true, true, true]);
  // With the policy on, a Keycloak session is not sent to set it up; a password sign-in is.
  await s.admin.post('/api/admin/users', { role: 'teacher', username: 'leo', name: 'Leo Mercado', email: 'leo@school.edu', password: 'password123', mustChangePassword: false });
  const as = await s.admin.post('/api/me/2fa/setup', { password: 'password123' });
  time.now += 30000;
  await s.admin.post('/api/me/2fa/enable', { code: codeAt(as.secret, stepAt(time.now)) });
  await s.admin.put('/api/admin/settings', { security: { twoFactor: 'staff' } });
  const leoKc = await sso({ sub: 'kc-leo', email: 'leo@school.edu', email_verified: true });
  assert.equal((await leoKc.get('/api/hub/status')).user.twoFactorSetupRequired, false);
  assert.ok(await leoKc.get('/api/hub/figures'));
  const leoPw = env.client();
  await leoPw.post('/api/hub/login', { username: 'leo', password: 'password123' });
  assert.equal((await leoPw.get('/api/hub/status')).user.twoFactorSetupRequired, true);
  await assert.rejects(leoPw.get('/api/hub/figures'), status(403, /Set up 2-step/));
});
