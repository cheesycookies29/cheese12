// Passwords, sessions and login throttling.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scrypt, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
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

// ----- Password hashing -----
// scrypt at N = 2^17, r = 8, p = 1 (OWASP's minimum; about 0.3 s and 128 MB per hash). The cost is
// written into the hash ("s2$17$8$1$salt$hash"), so it can be raised later and older hashes are
// redone at the next sign-in. Hashes from before ("scrypt$salt$hash") are N = 2^14 and still accepted.
// The hashing runs on Node's thread pool (crypto.scrypt), never on the main thread for a request, and
// at most HASH_SLOTS at a time: more would need more memory than a small server has. Past
// HASH_QUEUE waiting, a request is turned away ("busy") rather than queued without end.
let costLog2 = 17;
const HASH_R = 8;
const HASH_P = 1;
const HASH_SLOTS = 2;
const HASH_QUEUE = 100;
// Tests and scripts that make many accounts use a lower cost (2^10 at the least).
export function setPasswordCost(log2) {
  costLog2 = Math.min(20, Math.max(10, Math.round(Number(log2)) || 17));
}
export const passwordCost = () => costLog2;
const paramsOf = (inner) => {
  const parts = String(inner).split('$');
  if (parts[0] === 's2') return { log2: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), salt: parts[4], hash: parts[5] };
  return { log2: 14, r: 8, p: 1, salt: parts[1], hash: parts[2] }; // "scrypt$salt$hash", Node's defaults
};
const scryptOptions = ({ log2, r, p }) => ({ N: 2 ** log2, r, p, maxmem: 160 * r * 2 ** log2 + 32 * 1024 * 1024 });
const innerHash = (salt, key, log2 = costLog2) => `s2$${log2}$${HASH_R}$${HASH_P}$${salt}$${key.toString('hex')}`;
const sealed = (inner) => (keyRing.current ? seal(inner) : inner);

// Slots for the slow hashing, shared by every request.
let busy = 0;
const waiting = [];
async function withHashSlot(run) {
  if (busy >= HASH_SLOTS) {
    if (waiting.length >= HASH_QUEUE) throw Object.assign(new HttpError(503, 'ATLAS is busy checking passwords. Try again in a moment.'), { headers: { 'Retry-After': '5' } });
    await new Promise((resolve) => waiting.push(resolve));
  }
  busy++;
  try {
    return await run();
  } finally {
    busy--;
    waiting.shift()?.();
  }
}
const scryptAsync = (password, salt, opts) => new Promise((resolve, reject) => scrypt(password, salt, 64, opts, (err, key) => (err ? reject(err) : resolve(key))));

// For scripts and the demo school (one hash, made once): the same format, computed in place.
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return sealed(innerHash(salt, scryptSync(String(password), salt, 64, scryptOptions({ log2: costLog2, r: HASH_R, p: HASH_P }))));
}
// For requests: computed on the thread pool, in a slot.
export async function hashPasswordAsync(password) {
  const salt = randomBytes(16).toString('hex');
  const log2 = costLog2;
  const key = await withHashSlot(() => scryptAsync(String(password), salt, scryptOptions({ log2, r: HASH_R, p: HASH_P })));
  return sealed(innerHash(salt, key, log2));
}

// A made-up hash at the current cost, so an unknown username takes as long to refuse as a known one.
const dummies = new Map();
const dummyFor = (log2) => {
  if (!dummies.has(log2)) dummies.set(log2, innerHash(randomBytes(16).toString('hex'), randomBytes(64), log2));
  return dummies.get(log2);
};
const matches = (expectedHex, actual) => {
  const expected = Buffer.from(expectedHex || '', 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export function verifyPassword(password, stored) {
  const inner = unseal(stored);
  const q = paramsOf(inner || dummyFor(costLog2));
  const actual = scryptSync(String(password), q.salt || 'x', 64, scryptOptions(q)); // also for unknown accounts, so timing gives nothing away
  return inner != null && matches(q.hash, actual);
}
export async function verifyPasswordAsync(password, stored) {
  const inner = unseal(stored);
  const q = paramsOf(inner || dummyFor(costLog2));
  const actual = await withHashSlot(() => scryptAsync(String(password), q.salt || 'x', scryptOptions(q)));
  return inner != null && matches(q.hash, actual);
}
// A new password, checked against the policy and hashed (the slow part: call it before changing anything).
export async function newPasswordHash(password, policy) {
  validatePassword(password, policy);
  return hashPasswordAsync(password);
}

// Made at a lower cost than today's (or in the old format): redo it at the next sign-in.
export const needsRehash = (stored) => {
  const inner = unseal(stored);
  if (inner == null) return false;
  const q = paramsOf(inner);
  return !String(inner).startsWith('s2$') || q.log2 < costLog2 || q.r !== HASH_R || q.p !== HASH_P;
};

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

// A cookie the browser mangled (e.g. "%E0%A4%A") is skipped, never an error for the whole request.
export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k || !v || Object.hasOwn(out, k)) continue; // the first cookie of a name wins
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      // not valid percent-encoding: leave it out
    }
  }
  return out;
}

// Browsers share cookies between ports on the same host, so these names must differ
// from the ERP's (ltdc_sid) for both apps to run side by side on localhost.
export const PORTAL_COOKIE = 'ltdc_lms_sid';
export const ADMIN_COOKIE = 'ltdc_lms_admin';
export const HRIS_COOKIE = 'ltdc_hris_sid';
const SESSION_TTL = 8 * 60 * 60 * 1000; // signed out after 8 idle hours (Settings → Sign-in & passwords can change it)
const SESSION_MAX = 12 * 60 * 60 * 1000; // and after 12 hours however busy (Settings can change it too)
const SESSIONS_PER_ACCOUNT = 10; // a new sign-in past this ends that account's oldest session

// Sessions live in memory: restarting the app signs everyone out.
// (On AWS with more than one server, move these to a shared store such as ElastiCache or DynamoDB.)
// ttl(): how long a session lasts without use; maxAge(): how long it lasts at most, from sign-in.
// Both are read on each request, so a new setting applies at once.
export function createSessions(ttl = () => SESSION_TTL, maxAge = () => SESSION_MAX) {
  const sessions = new Map();
  // Ended sessions are cleared every ten minutes, not only when someone uses them again.
  const sweep = setInterval(() => {
    const t = Date.now();
    for (const [token, s] of sessions) if (s.expires < t) sessions.delete(token);
  }, 10 * 60 * 1000);
  sweep.unref?.();
  return {
    // extra: e.g. { sso: true, idToken } for a single sign-on session (used to end the Keycloak session too),
    // and { ip, agent }: where it was opened from (shown to administrators in Control → Sessions).
    create(userId, extra = {}) {
      const token = randomBytes(32).toString('hex');
      const at = Date.now();
      // At most SESSIONS_PER_ACCOUNT at once: the oldest end first (Map keeps the order they began).
      const own = [...sessions].filter(([, s]) => s.userId === userId);
      for (const [old] of own.slice(0, Math.max(0, own.length - SESSIONS_PER_ACCOUNT + 1))) sessions.delete(old);
      sessions.set(token, { ...extra, userId, createdAt: at, lastSeen: at, expires: Math.min(at + ttl(), at + maxAge()) });
      return token;
    },
    get(token) {
      const s = token && sessions.get(token);
      if (!s) return null;
      const t = Date.now();
      if (s.expires < t || t - s.createdAt > maxAge()) {
        sessions.delete(token);
        return null;
      }
      s.lastSeen = t;
      s.expires = Math.min(t + ttl(), s.createdAt + maxAge());
      return s;
    },
    // Live sessions, each with a short id made from its token (the token itself is never shown).
    list() {
      const t = Date.now();
      return [...sessions].filter(([, s]) => s.expires >= t).map(([token, s]) => ({
        id: sessionId(token), userId: s.userId, createdAt: s.createdAt, lastSeen: s.lastSeen, expires: s.expires, ip: s.ip || '', agent: s.agent || '', sso: Boolean(s.sso),
      }));
    },
    idOf: (token) => (token ? sessionId(token) : ''),
    destroyById(id) {
      for (const token of sessions.keys()) if (sessionId(token) === id) return sessions.delete(token);
      return false;
    },
    destroy(token) {
      sessions.delete(token);
    },
    destroyForUser(userId, exceptToken) {
      for (const [token, s] of sessions) if (s.userId === userId && token !== exceptToken) sessions.delete(token);
    },
  };
}

const sessionId = (token) => createHash('sha256').update(token).digest('hex').slice(0, 16);

// Served over HTTPS (COOKIE_SECURE=1, or a PUBLIC_URL that starts with https:), the session cookies
// are "Secure" (never sent over plain HTTP) and named with the "__Host-" prefix: the browser then
// takes them only from this exact host over HTTPS, so no other site or subdomain can plant or
// overwrite one. Over plain HTTP (a laptop, or the school network through the Windows launcher)
// neither is possible, and the plain names are used.
export const cookiesSecureByDefault = (env = process.env) => env.COOKIE_SECURE === '1' || /^https:/i.test(String(env.PUBLIC_URL || ''));
export const cookieName = (base, secure) => (secure ? `__Host-${base}` : base);
export const sessionCookie = (name, token, maxAgeMs = SESSION_TTL, secure = false) => `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.round(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`;
export const clearedCookie = (name, secure = false) => `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;

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
    // Keys locked right now, with when they open again (Control → Locked sign-ins).
    locked() {
      const t = Date.now();
      return [...failures].filter(([, f]) => f.until > t).map(([key, f]) => ({ key, until: f.until }));
    },
  };
}
