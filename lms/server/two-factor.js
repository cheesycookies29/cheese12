// 2-step verification (after CORE ERP's, server/api.js and server/totp.js at the repository root): a
// code from an authenticator app after the password, or one of ten one-time recovery codes.
//   - Signing in: a right password does not open a session for an account that uses it. signIn
//     (server/api.js) asks challenge() for a short-lived challenge instead; verify() checks the code
//     and the route that started the sign-in opens the session. A challenge lasts 5 minutes and takes
//     5 codes; each wrong code counts as a wrong password (lock-out and the per-address pause).
//   - Wrong codes (from the app or recovery codes) also count for the account itself, from every
//     address (codeLocks): after "Wrong passwords before locking" of them, its code step waits for
//     "Minutes locked", twice as long each time it happens again, and the person is told on the bell.
//     Typing the right password again does not forgive them; only a right code (or the wait) does.
//   - My security: set up (password, then the QR code and the first code, then the recovery codes),
//     new recovery codes, turn off (/api/me/2fa…). These routes work while the account must still set
//     it up, as the password change does during a forced password change.
//   - Who must use it: settings.security.twoFactor (shared/two-factor.js). Keycloak sign-ins skip it,
//     since Keycloak asks for its own second step.
// Stored on the account: twoFactor { secret (sealed with the server's key, server/auth.js), enabledAt,
// lastStep (the last code's step: a code works once), recovery: [{ hash, usedAt }] } and, during the
// set-up, twoFactorPending { secret (sealed), createdAt }. The secret and the recovery codes are never
// in an answer (publicUser), the audit log or a log line.
import { randomBytes } from 'node:crypto';
import { HttpError } from './util.js';
import { verifyPasswordAsync, sealSecret, openSecret, canSealSecrets } from './auth.js';
import { sideLabel } from './audit.js';
import { newSecret, verifyCode, otpauthUrl, newRecoveryCodes, hashRecovery, looksLikeRecovery, RECOVERY_COUNT } from './totp.js';
import { twoFactorRequired, TWO_FACTOR_POLICIES } from '../shared/two-factor.js';
import { ROLES } from '../shared/roles.js';
import { ownPageLink } from '../shared/notifications.js';
import { t } from './validate.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
export const CHALLENGE_MS = 5 * 60 * 1000;
export const CHALLENGE_ATTEMPTS = 5;
const PENDING_MS = 15 * 60 * 1000; // a QR code shown at set-up works this long

export const hasTwoFactor = (user) => Boolean(user?.twoFactor?.enabledAt);

// ----- Backups -----
// The 2-step verification fields of an account in a backup being restored: kept when they have the
// shape ATLAS writes, dropped otherwise (the account then signs in with its password alone, and the
// policy asks it to set up again). Nothing else in them is kept.
const isText = (v, max = 400) => typeof v === 'string' && v.length <= max;
const optional = (v, ok) => v === undefined || v === null || ok(v);
const isTime = (v) => isText(v, 40) && !Number.isNaN(Date.parse(v));
export function cleanTwoFactor(tf) {
  if (!tf || typeof tf !== 'object' || Array.isArray(tf)) return null;
  if (!isText(tf.secret) || !tf.secret.startsWith('enc1$') || !isTime(tf.enabledAt) || !optional(tf.lastStep, Number.isSafeInteger)) return null;
  if (!Array.isArray(tf.recovery) || tf.recovery.length > 20) return null;
  if (!tf.recovery.every((r) => r && typeof r === 'object' && typeof r.hash === 'string' && /^[0-9a-f]{64}$/.test(r.hash) && optional(r.usedAt, isTime))) return null;
  return { secret: tf.secret, enabledAt: tf.enabledAt, lastStep: tf.lastStep ?? -1, recovery: tf.recovery.map((r) => ({ hash: r.hash, usedAt: r.usedAt ?? null })) };
}
export function cleanTwoFactorPending(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || !isText(p.secret) || !p.secret.startsWith('enc1$') || !isTime(p.createdAt)) return null;
  return { secret: p.secret, createdAt: p.createdAt };
}
// Every account in a backup: its fields cleaned (in place), invalid ones removed.
export function cleanBackupTwoFactor(users) {
  let dropped = 0;
  for (const u of Array.isArray(users) ? users : []) {
    if (!u || typeof u !== 'object') continue;
    for (const [k, clean] of [['twoFactor', cleanTwoFactor], ['twoFactorPending', cleanTwoFactorPending]]) {
      if (u[k] === undefined) continue;
      const v = u[k] === null ? null : clean(u[k]);
      if (v) u[k] = v;
      else {
        if (u[k] !== null) dropped++;
        delete u[k];
      }
    }
  }
  return dropped;
}

// deps: { db, record (an audit entry), throttle (wrong passwords), codeLocks (wrong codes, per account), limits, sides,
//   security(), systemOf(user), viaSso(user), publicUser, notify(userIds, entry) (the bell),
//   now(): the time in ms, for the codes and how long a challenge lasts (the API's clock, so tests can move it) }
export function createTwoFactor({ db, record, throttle, codeLocks, limits, sides, security, systemOf, viaSso, publicUser, notify = () => {}, now = () => Date.now() }) {
  const users = () => db.data.users;
  // Must this account set it up before anything else? (Not for a Keycloak session: Keycloak asked.)
  const mustSetUp = (user) => Boolean(user && twoFactorRequired(security(), user) && !hasTwoFactor(user) && !viaSso(user));
  const recoveryLeft = (user) => (user.twoFactor?.recovery || []).filter((r) => !r.usedAt).length;
  const issueRecovery = (user) => {
    const codes = newRecoveryCodes();
    user.twoFactor.recovery = codes.map((c) => ({ hash: hashRecovery(c), usedAt: null }));
    return codes;
  };

  // The second step: a code from the app (each works once), or an unused recovery code.
  // Returns 'app', 'recovery', or null when it is wrong. Saves what it used.
  function secondFactor(user, code) {
    const tf = user.twoFactor;
    if (!tf?.enabledAt) return null;
    if (looksLikeRecovery(code)) {
      const hash = hashRecovery(code);
      const hit = (tf.recovery || []).find((r) => r.hash === hash && !r.usedAt);
      if (!hit) return null;
      hit.usedAt = new Date(now()).toISOString();
      db.save();
      return 'recovery';
    }
    // Sealed with this server's key: a backup restored on a server without it accepts only recovery codes.
    const secret = openSecret(tf.secret);
    const step = secret ? verifyCode(secret, code, { now: now(), lastStep: tf.lastStep ?? -1 }) : null;
    if (step == null) return null;
    tf.lastStep = step;
    db.save();
    return 'app';
  }

  // ----- Wrong codes, per account -----
  // Counted wherever the code is typed (signing in, turning it off, new recovery codes), from any address.
  const LOCKED = 'Too many wrong 2-step verification codes for this account.';
  const codeKey = (user) => `2fa:${user.id}`;
  const checkCodeLock = (user) => codeLocks.check(codeKey(user), LOCKED);
  // A wrong code: counted; when it locks the code step, the person is told (it may not be them).
  function wrongCode(user) {
    if (!codeLocks.fail(codeKey(user), 1, { growing: true })) return false;
    notify([user.id], {
      system: 'account', kind: '2fa-locked', title: 'Wrong 2-step verification codes for your account',
      body: 'Your password was typed, then too many wrong codes, so signing in with a code waits a while. If this was not you, change your password now (My security).',
      link: ownPageLink(ROLES[user.role]?.side, 'security'),
    });
    db.save();
    return true;
  }

  // ----- Signing in -----
  // challenge id → { userId, side, via ('hub' | 'portal' | 'admin': the route that started it), expires, attempts }
  const challenges = new Map();
  const sweep = () => {
    const at = now();
    for (const [id, c] of challenges) if (c.expires < at) challenges.delete(id);
  };
  const timer = setInterval(sweep, 60 * 1000);
  timer.unref?.();
  function challenge(user, side, via) {
    sweep();
    const id = randomBytes(24).toString('hex');
    challenges.set(id, { userId: user.id, side, via, expires: now() + CHALLENGE_MS, attempts: 0 });
    return id;
  }
  // The code for a challenge. Returns { user, side, how ('app' | 'recovery'), left } or throws.
  function verify(via, body, ip = '', agent = '') {
    const id = String(body.challenge || '');
    const c = challenges.get(id);
    const user = c && c.via === via && c.expires > now() ? users().find((u) => u.id === c.userId) : null;
    if (!user || user.status !== 'active' || !hasTwoFactor(user) || ROLES[user.role]?.side !== c.side) {
      challenges.delete(id);
      fail('The sign-in has expired. Enter your username and password again.', 401);
    }
    const key = `user:${user.username}`;
    const here = `${key}@${ip}`;
    const side = c.side;
    const system = systemOf(user);
    const refused = (reason, err) => {
      record({ kind: 'signin', system, action: `Sign-in refused: ${reason}`, target: user, ip, agent, outcome: 'failed', detail: `${sideLabel(side)} · 2-step verification` });
      throw err;
    };
    try {
      limits.check('signinFail', ip, 'Too many wrong passwords from your network.');
    } catch (err) {
      refused('too many wrong passwords from this address', err);
    }
    try {
      throttle.check(here);
      throttle.check(key);
    } catch (err) {
      challenges.delete(id);
      refused('username locked', err);
    }
    try {
      checkCodeLock(user);
    } catch (err) {
      challenges.delete(id);
      refused('2-step verification locked after wrong codes', err);
    }
    const how = String(body.code || '').trim() ? secondFactor(user, body.code) : null;
    if (!how) {
      // A wrong code counts as a wrong password: the username locks and the address pauses as for those.
      // It also counts for the account from every address, which a right password does not forgive.
      c.attempts += 1;
      limits.add('signinFail', ip);
      throttle.fail(here);
      throttle.fail(key, 10);
      const locked = wrongCode(user);
      const last = locked || c.attempts >= CHALLENGE_ATTEMPTS;
      record({ kind: 'signin', system, action: locked ? 'Sign-in failed: 2-step verification locked after wrong codes' : last ? 'Sign-in failed: too many wrong 2-step verification codes' : 'Sign-in failed: wrong 2-step verification code', target: user, ip, agent, outcome: 'failed', detail: `${sideLabel(side)} · attempt ${c.attempts} of ${CHALLENGE_ATTEMPTS}` });
      if (last) challenges.delete(id);
      if (locked) checkCodeLock(user); // throws: how long it waits
      if (last) fail('Too many wrong codes. Enter your username and password again.', 401);
      fail('That code is not right. Check that the time on your phone is correct, or use a recovery code.', 401);
    }
    challenges.delete(id);
    throttle.reset(here);
    throttle.reset(key);
    codeLocks.reset(codeKey(user));
    return { user, side, how, left: recoveryLeft(user) };
  }

  // ----- My security -----
  const requirePassword = async (user, password, a) => {
    if (!(await verifyPasswordAsync(String(password || ''), user.passwordHash))) {
      record({ kind: 'password', system: systemOf(user), action: '2-step verification: wrong password', actor: user, target: user, ip: a.ip, agent: a.agent, outcome: 'failed' });
      fail('Your password is not right.');
    }
  };
  const requireCode = (user, code, a) => {
    checkCodeLock(user);
    if (!secondFactor(user, code)) {
      const locked = wrongCode(user);
      record({ kind: 'password', system: systemOf(user), action: locked ? '2-step verification: wrong code; locked after wrong codes' : '2-step verification: wrong code', actor: user, target: user, ip: a.ip, agent: a.agent, outcome: 'failed' });
      if (locked) checkCodeLock(user);
      fail('That code is not right. Enter the code your app shows now, or a recovery code.');
    }
    codeLocks.reset(codeKey(user));
  };
  const status = (user) => ({
    enabled: hasTwoFactor(user),
    enabledAt: user.twoFactor?.enabledAt || null,
    recoveryLeft: recoveryLeft(user),
    recoveryTotal: RECOVERY_COUNT,
    required: twoFactorRequired(security(), user),
    policy: security().twoFactor || 'off',
    policyLabel: TWO_FACTOR_POLICIES[security().twoFactor || 'off'],
    setupRequired: mustSetUp(user),
    available: canSealSecrets(), // a server without a password key cannot keep the secret encrypted
    sso: { linked: Boolean(user.ssoSubject), thisSession: viaSso(user) },
  });
  // Every other session of this account ends (they sign in again, now with a code).
  const endOtherSessions = (user, token) => {
    for (const s of Object.values(sides)) s.destroyForUser(user.id, token);
  };

  function registerRoutes(route) {
    const opts = (body, limit = 'password') => ({ duringPasswordChange: true, audit: false, limit, body });
    route('GET', '/api/me/2fa', 'me', ({ user }) => status(user), { duringPasswordChange: true, audit: false });
    // Step 1: a new secret for the authenticator app (the QR code), after the password is confirmed.
    route('POST', '/api/me/2fa/setup', 'me', async (a) => {
      const { user, body } = a;
      if (hasTwoFactor(user)) fail('2-step verification is already on. Turn it off first to set it up on another phone.');
      if (!canSealSecrets()) fail('2-step verification needs the server\'s password key (PASSWORD_KEY or password.key), which keeps the secret encrypted. Ask the person who runs ATLAS.');
      await requirePassword(user, body.password, a);
      const secret = newSecret();
      user.twoFactorPending = { secret: sealSecret(secret), createdAt: new Date(now()).toISOString() };
      db.save();
      const school = String(db.data.settings.schoolName || '').replace(/:/g, ' ').trim().slice(0, 60);
      return { secret, otpauthUrl: otpauthUrl({ secret, account: school ? `${user.username} (${school})` : user.username, issuer: 'ATLAS' }) };
    }, opts({ password: t.str(1000) }));
    // Step 2: the first code from the app proves it is set up; then ten recovery codes, shown once.
    route('POST', '/api/me/2fa/enable', 'me', (a) => {
      const { user, body, token } = a;
      if (hasTwoFactor(user)) fail('2-step verification is already on.');
      const pending = user.twoFactorPending;
      const secret = pending && now() - Date.parse(pending.createdAt) < PENDING_MS ? openSecret(pending.secret) : null;
      if (!secret) fail('Start again: scan a new QR code.');
      const step = verifyCode(secret, body.code, { now: now() });
      if (step == null) fail('That code is not right. Enter the 6-digit code the app shows now.');
      user.twoFactor = { secret: pending.secret, enabledAt: new Date(now()).toISOString(), lastStep: step, recovery: [] };
      delete user.twoFactorPending;
      const codes = issueRecovery(user);
      endOtherSessions(user, token);
      db.save();
      record({ kind: 'password', system: systemOf(user), action: 'Turned on 2-step verification', actor: user, target: user, ip: a.ip, agent: a.agent, detail: 'Their other sessions were ended.' });
      return { recoveryCodes: codes, user: publicUser(user), status: status(user) };
    }, opts({ code: t.str(20) }));
    route('POST', '/api/me/2fa/disable', 'me', async (a) => {
      const { user, body } = a;
      if (!hasTwoFactor(user)) fail('2-step verification is not on.');
      if (twoFactorRequired(security(), user)) fail('Your school requires 2-step verification for your account, so it cannot be turned off.');
      await requirePassword(user, body.password, a);
      requireCode(user, body.code, a);
      delete user.twoFactor;
      delete user.twoFactorPending;
      db.save();
      record({ kind: 'password', system: systemOf(user), action: 'Turned off 2-step verification', actor: user, target: user, ip: a.ip, agent: a.agent });
      return { user: publicUser(user), status: status(user) };
    }, opts({ password: t.str(1000), code: t.str(40) }));
    route('POST', '/api/me/2fa/recovery-codes', 'me', async (a) => {
      const { user, body } = a;
      if (!hasTwoFactor(user)) fail('2-step verification is not on.');
      await requirePassword(user, body.password, a);
      requireCode(user, body.code, a);
      const codes = issueRecovery(user);
      db.save();
      record({ kind: 'password', system: systemOf(user), action: 'Made new 2-step verification recovery codes', actor: user, target: user, ip: a.ip, agent: a.agent, detail: 'The old ones stopped working.' });
      return { recoveryCodes: codes, status: status(user) };
    }, opts({ password: t.str(1000), code: t.str(40) }));
  }

  return { mustSetUp, challenge, verify, registerRoutes, recoveryLeft, pendingChallenges: () => challenges.size };
}

