// Passwords, sessions and login throttling.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { HttpError } from './util.js';

// ----- Passwords -----
// A password is never stored. It is hashed with scrypt (one way: a hash cannot be turned back into
// the password), and the hash is then encrypted with AES-256-GCM under a key kept outside the
// database (a "pepper"). A copied database or backup is then useless for guessing passwords
// without the key, and the key can be replaced without anyone changing their password.
//   Stored: enc1$<key id>$<iv>$<encrypted hash + tag>   (or, without a key: scrypt$<salt>$<hash>)
// The key: PASSWORD_KEY (64 hex characters), or the file password.key beside the data file, made
// on first start. PASSWORD_KEY_OLD (comma-separated) lets hashes under an earlier key be read and
// re-encrypted under the new one.
const AAD = Buffer.from('atlas-password-v1');
const keyRing = { current: null, all: new Map() };
const keyId = (key) => createHash('sha256').update(key).digest('hex').slice(0, 8);
function parseKey(hex, where) {
  if (!/^[0-9a-f]{64}$/i.test(String(hex).trim())) throw new Error(`${where} must be 64 hexadecimal characters (32 bytes), e.g. from: openssl rand -hex 32`);
  return Buffer.from(String(hex).trim(), 'hex');
}

// Set the keys (tests, scripts). current: hex, or '' for none.
export function setPasswordKeys(current = '', old = []) {
  keyRing.current = null;
  keyRing.all.clear();
  for (const hex of old.map((h) => String(h).trim()).filter(Boolean)) {
    const key = parseKey(hex, 'PASSWORD_KEY_OLD');
    keyRing.all.set(keyId(key), key);
  }
  if (current) {
    const key = parseKey(current, 'PASSWORD_KEY');
    keyRing.current = { id: keyId(key), key };
    keyRing.all.set(keyRing.current.id, key);
  }
}

// At start-up: PASSWORD_KEY, else the key file in `dir` (made if missing, readable by this app only).
export function loadPasswordKeys(dir, env = process.env) {
  let current = env.PASSWORD_KEY || '';
  let source = 'PASSWORD_KEY';
  if (!current && dir) {
    const file = path.join(dir, 'password.key');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
      console.log(`  A new password encryption key was made: ${file}. Keep a copy somewhere safe; without it, no password works.`);
    }
    current = fs.readFileSync(file, 'utf8').trim();
    source = file;
  }
  setPasswordKeys(current, String(env.PASSWORD_KEY_OLD || '').split(','));
  return { on: Boolean(keyRing.current), source: keyRing.current ? source : null };
}

export const passwordEncryption = () => ({ on: Boolean(keyRing.current), keyId: keyRing.current?.id || null });

function seal(inner) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyRing.current.key, iv);
  c.setAAD(AAD);
  const body = Buffer.concat([c.update(inner, 'utf8'), c.final(), c.getAuthTag()]);
  return `enc1$${keyRing.current.id}$${iv.toString('base64url')}$${body.toString('base64url')}`;
}
// The scrypt hash inside a stored value; null if it is encrypted under a key this server does not have.
function unseal(stored) {
  if (!String(stored || '').startsWith('enc1$')) return stored || null;
  const [, id, iv, body] = stored.split('$');
  const key = keyRing.all.get(id);
  if (!key || !iv || !body) return null;
  try {
    const data = Buffer.from(body, 'base64url');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAAD(AAD);
    d.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const inner = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
  return keyRing.current ? seal(inner) : inner;
}

const DUMMY_SALT = randomBytes(16).toString('hex');
const DUMMY_HASH = `scrypt$${DUMMY_SALT}$${scryptSync(randomBytes(8).toString('hex'), DUMMY_SALT, 64).toString('hex')}`;

export function verifyPassword(password, stored) {
  const inner = unseal(stored);
  const [, salt, hash] = (inner || DUMMY_HASH).split('$');
  const expected = Buffer.from(hash || '', 'hex');
  const actual = scryptSync(String(password), salt || DUMMY_SALT, 64); // also for unknown accounts, so timing gives nothing away
  return inner != null && expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Can this server read the stored value (plain, or encrypted under a key it has)?
export const readableHash = (stored) => unseal(stored) != null;
// Should it be (re-)encrypted under the current key? (plain, or under an old key)
export const needsSealing = (stored) => Boolean(keyRing.current && stored && !String(stored).startsWith(`enc1$${keyRing.current.id}$`) && unseal(stored) != null);
export const sealHash = (stored) => (needsSealing(stored) ? seal(unseal(stored)) : stored);

// Encrypt every readable hash under the current key (at start-up and after a restore).
export function sealAllPasswords(users) {
  let sealed = 0;
  let unreadable = 0;
  for (const u of users) {
    if (!u.passwordHash) continue;
    if (!readableHash(u.passwordHash)) unreadable++;
    else if (needsSealing(u.passwordHash)) {
      u.passwordHash = sealHash(u.passwordHash);
      sealed++;
    }
  }
  return { sealed, unreadable };
}

// policy: settings.security (Settings → Sign-in & passwords); without it, the defaults.
export function validatePassword(password, policy = {}) {
  const min = Math.max(8, Number(policy.minPasswordLength) || 8);
  if (typeof password !== 'string' || password.length < min) throw new HttpError(400, `Password must be at least ${min} characters.`);
  if (password.length > 200) throw new HttpError(400, 'Password is too long.');
  if (policy.requireLettersAndDigits && !(/[A-Za-z]/.test(password) && /\d/.test(password))) throw new HttpError(400, 'Password must have both letters and digits.');
}

// What may leave the server about an account: never the password hash, the private calendar
// address (it opens the person's calendar without signing in) or the Keycloak link.
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, calendarToken, ssoSubject, ...rest } = user;
  return rest;
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)]),
  );
}

// Browsers share cookies between ports on the same host, so these names must differ
// from the ERP's (ltdc_sid) for both apps to run side by side on localhost.
export const PORTAL_COOKIE = 'ltdc_lms_sid';
export const ADMIN_COOKIE = 'ltdc_lms_admin';
export const HRIS_COOKIE = 'ltdc_hris_sid';
const SESSION_TTL = 8 * 60 * 60 * 1000; // signed out after 8 idle hours (Settings → Sign-in & passwords can change it)

// Sessions live in memory: restarting the app signs everyone out.
// (On AWS with more than one server, move these to a shared store such as ElastiCache or DynamoDB.)
// ttl(): how long a session lasts without use, read on each request so a new setting applies at once.
export function createSessions(ttl = () => SESSION_TTL) {
  const sessions = new Map();
  // Ended sessions are cleared every ten minutes, not only when someone uses them again.
  const sweep = setInterval(() => {
    const t = Date.now();
    for (const [token, s] of sessions) if (s.expires < t) sessions.delete(token);
  }, 10 * 60 * 1000);
  sweep.unref?.();
  return {
    // extra: e.g. { sso: true, idToken } for a single sign-on session (used to end the Keycloak session too).
    create(userId, extra = {}) {
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { ...extra, userId, expires: Date.now() + ttl() });
      return token;
    },
    get(token) {
      const s = token && sessions.get(token);
      if (!s) return null;
      if (s.expires < Date.now()) {
        sessions.delete(token);
        return null;
      }
      s.expires = Date.now() + ttl();
      return s;
    },
    destroy(token) {
      sessions.delete(token);
    },
    destroyForUser(userId, exceptToken) {
      for (const [token, s] of sessions) if (s.userId === userId && token !== exceptToken) sessions.delete(token);
    },
  };
}

// COOKIE_SECURE=1 when served over HTTPS, so browsers never send the cookie over plain HTTP.
const SECURE = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';

export const sessionCookie = (name, token, maxAgeMs = SESSION_TTL) => `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.round(maxAgeMs / 1000)}${SECURE}`;
export const clearedCookie = (name) => `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE}`;

// Lock a username for 5 minutes after 5 wrong passwords in a row. limits: an object, or a
// function returning { max, lockMs } (read at each attempt, so Settings apply at once).
// fail(key, times): this key locks after `times` × max failures (a looser, wider lock).
// Entries left alone for a day are forgotten, so made-up usernames do not pile up in memory.
export function createThrottle(limits = {}) {
  const failures = new Map();
  const get = () => ({ max: 5, lockMs: 5 * 60 * 1000, ...(typeof limits === 'function' ? limits() : limits) });
  const DAY = 24 * 3600 * 1000;
  const prune = () => {
    const t = Date.now();
    for (const [key, f] of failures) if (f.until < t && t - f.at > DAY) failures.delete(key);
  };
  const timer = setInterval(prune, 3600 * 1000);
  timer.unref?.();
  return {
    check(key) {
      const f = failures.get(key);
      if (f && f.until > Date.now()) {
        const mins = Math.ceil((f.until - Date.now()) / 60000);
        throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`);
      }
    },
    fail(key, times = 1) {
      const f = failures.get(key) || { count: 0, until: 0, at: 0 };
      f.count += 1;
      f.at = Date.now();
      const { max, lockMs } = get();
      if (f.count >= max * times) Object.assign(f, { count: 0, until: Date.now() + lockMs });
      failures.set(key, f);
      if (failures.size > 100000) prune();
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
