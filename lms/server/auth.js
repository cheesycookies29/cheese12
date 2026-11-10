// Passwords, sessions and login throttling.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError } from './util.js';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

const DUMMY_HASH = hashPassword(randomBytes(8).toString('hex'));

export function verifyPassword(password, stored) {
  const [, salt, hash] = (stored || DUMMY_HASH).split('$');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(String(password), salt, 64);
  return stored != null && expected.length === actual.length && timingSafeEqual(expected, actual);
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
