// Passwords, sessions and sign-in lockouts.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { HttpError } from './util.js';
import { checkPassword } from './security.js';

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

// The password rules (length, not a common password, not the username or name): see security.js.
export function validatePassword(password, who = {}, settings) {
  checkPassword(password, who, settings);
}

// What the browser may see of an account: never the password hash or the 2-step secret or codes.
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, twoFactor, twoFactorPending, ...rest } = user;
  return { ...rest, twoFactorEnabled: Boolean(twoFactor?.enabledAt) };
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)]),
  );
}

export const SESSION_COOKIE = 'ltdc_sid';
const MINUTE = 60 * 1000;
// A session's id for lists and "sign out this one": derived from the token, so the token itself never
// leaves the cookie.
const sessionId = (token) => createHash('sha256').update(token).digest('hex').slice(0, 16);

// A short description of the browser, for "where you are signed in".
export function deviceOf(ua = '') {
  const s = String(ua);
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS X/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

// Sessions live in memory: restarting the app signs everyone out. Each ends after the idle time
// without use, and after the longest session time at the latest (policy() gives both, from Settings).
export function createSessions(policy = () => ({ idleMs: 8 * 60 * MINUTE, maxMs: 24 * 60 * MINUTE })) {
  const sessions = new Map();
  const alive = (s, now = Date.now()) => {
    const { idleMs, maxMs } = policy();
    return now - s.lastSeen < idleMs && now - s.created < maxMs;
  };
  return {
    create(userId, { ip = '', ua = '' } = {}) {
      const token = randomBytes(32).toString('hex');
      const now = Date.now();
      sessions.set(token, { id: sessionId(token), userId, created: now, lastSeen: now, ip, device: deviceOf(ua) });
      return token;
    },
    get(token, { touch = true } = {}) {
      const s = token && sessions.get(token);
      if (!s) return null;
      if (!alive(s)) {
        sessions.delete(token);
        return null;
      }
      if (touch) s.lastSeen = Date.now();
      return s;
    },
    // A person's sessions, newest first, for "where you are signed in".
    list(userId) {
      return [...sessions.values()].filter((s) => s.userId === userId && alive(s)).sort((a, b) => b.lastSeen - a.lastSeen);
    },
    destroy(token) {
      sessions.delete(token);
    },
    destroyById(userId, id) {
      for (const [token, s] of sessions) if (s.userId === userId && s.id === id) return sessions.delete(token);
      return false;
    },
    destroyForUser(userId, exceptToken) {
      let n = 0;
      for (const [token, s] of sessions) if (s.userId === userId && token !== exceptToken) n += sessions.delete(token) ? 1 : 0;
      return n;
    },
    maxAgeSeconds: () => Math.round(policy().maxMs / 1000),
  };
}

// The session cookie: HttpOnly (no script reads it), SameSite=Strict (no other site sends it), Secure
// when CORE is reached over HTTPS (or COOKIE_SECURE=1), so it never travels over plain HTTP.
const ALWAYS_SECURE = process.env.COOKIE_SECURE === '1';
export function sessionCookie(token, { maxAge = 24 * 60 * 60, secure = false } = {}) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure || ALWAYS_SECURE ? '; Secure' : ''}`;
}
export const clearedCookie = (secure = false) => `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure || ALWAYS_SECURE ? '; Secure' : ''}`;

// Lock a username after 5 wrong passwords in a row: for 5 minutes the first time, then 15, then an
// hour while the wrong passwords keep coming (the count of locks is forgotten after a quiet day).
const LOCK_STEPS = [5 * MINUTE, 15 * MINUTE, 60 * MINUTE];
export function createThrottle({ max = 5, steps = LOCK_STEPS, now = () => Date.now() } = {}) {
  const failures = new Map();
  return {
    check(key) {
      const f = failures.get(key);
      if (f && f.until > now()) {
        const mins = Math.ceil((f.until - now()) / MINUTE);
        throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`);
      }
    },
    // Count a wrong password; returns the lock's minutes when this one starts a lock, else 0.
    fail(key) {
      const t = now();
      const f = failures.get(key) || { count: 0, until: 0, locks: 0, lastLock: 0 };
      if (f.locks && t - f.lastLock > 24 * 60 * MINUTE) f.locks = 0;
      f.count += 1;
      let locked = 0;
      if (f.count >= max) {
        const ms = steps[Math.min(f.locks, steps.length - 1)];
        Object.assign(f, { count: 0, until: t + ms, locks: f.locks + 1, lastLock: t });
        locked = ms / MINUTE;
      }
      failures.set(key, f);
      return locked;
    },
    // A right password clears the count of wrong ones (the escalation is kept for a day).
    reset(key) {
      const f = failures.get(key);
      if (f) Object.assign(f, { count: 0, until: 0 });
    },
  };
}
