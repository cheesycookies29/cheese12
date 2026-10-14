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

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (password.length > 200) throw new HttpError(400, 'Password is too long.');
}

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)]),
  );
}

export const SESSION_COOKIE = 'ltdc_sid';
const SESSION_TTL = 8 * 60 * 60 * 1000; // signed out after 8 idle hours

// Sessions live in memory: restarting the app signs everyone out.
export function createSessions() {
  const sessions = new Map();
  return {
    create(userId) {
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { userId, expires: Date.now() + SESSION_TTL });
      return token;
    },
    get(token) {
      const s = token && sessions.get(token);
      if (!s) return null;
      if (s.expires < Date.now()) {
        sessions.delete(token);
        return null;
      }
      s.expires = Date.now() + SESSION_TTL;
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

// COOKIE_SECURE=1 when the app is served over HTTPS (e.g. in the cloud behind Caddy),
// so browsers never send the session cookie over plain HTTP.
const SECURE = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${SECURE}`;
}
export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE}`;

// Lock a username for 5 minutes after 5 wrong passwords in a row.
export function createThrottle({ max = 5, lockMs = 5 * 60 * 1000 } = {}) {
  const failures = new Map();
  return {
    check(key) {
      const f = failures.get(key);
      if (f && f.until > Date.now()) {
        const mins = Math.ceil((f.until - Date.now()) / 60000);
        throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`);
      }
    },
    fail(key) {
      const f = failures.get(key) || { count: 0, until: 0 };
      f.count += 1;
      if (f.count >= max) Object.assign(f, { count: 0, until: Date.now() + lockMs });
      failures.set(key, f);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
