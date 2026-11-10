// Sign-in and security policy: the administrator's settings, the password rules, and the HTTP
// security headers (with the Content-Security-Policy for CORE's own pages).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HttpError } from './util.js';

// Settings → Sign-in & security. Ranges keep a mistyped value from locking everyone out.
export const SECURITY_DEFAULTS = {
  requestsPerMinute: 300, // per signed-in person
  signInFailuresPerAddress: 20, // failed sign-ins from one network address in 15 minutes
  sessionIdleMinutes: 480, // signed out after this long without using CORE
  sessionMaxHours: 24, // and after this long at most, used or not
  twoFactor: 'off', // 'off' | 'admins' | 'all': who must use 2-step verification
  blockCommonPasswords: true,
};
export const TWO_FACTOR_POLICIES = { off: 'Optional for everyone', admins: 'Required for Administrators', all: 'Required for everyone' };
const RANGES = {
  requestsPerMinute: [60, 5000],
  signInFailuresPerAddress: [5, 1000],
  sessionIdleMinutes: [5, 1440],
  sessionMaxHours: [1, 720],
};

export const securitySettings = (db) => ({ ...SECURITY_DEFAULTS, ...(db.data.settings.security || {}) });

export function validateSecuritySettings(input, current) {
  const out = { ...current };
  for (const [k, [min, max]] of Object.entries(RANGES)) {
    if (!(k in input)) continue;
    const n = Number(input[k]);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${LABELS[k]}: a whole number from ${min} to ${max}.`);
    out[k] = n;
  }
  if ('twoFactor' in input) {
    if (!TWO_FACTOR_POLICIES[input.twoFactor]) throw new HttpError(400, 'Choose who must use 2-step verification.');
    out.twoFactor = input.twoFactor;
  }
  if ('blockCommonPasswords' in input) out.blockCommonPasswords = input.blockCommonPasswords !== false;
  if (out.sessionIdleMinutes > out.sessionMaxHours * 60) throw new HttpError(400, 'The idle time cannot be longer than the longest session.');
  return out;
}
const LABELS = {
  requestsPerMinute: 'Requests per minute',
  signInFailuresPerAddress: 'Failed sign-ins per network address',
  sessionIdleMinutes: 'Sign out after idle minutes',
  sessionMaxHours: 'Longest session in hours',
};

// Whether the policy requires this account to use 2-step verification.
export const twoFactorRequired = (settings, user) => settings.twoFactor === 'all' || (settings.twoFactor === 'admins' && user.role === 'admin');

// Passwords people pick first, and that password lists try first. Kept short and to the point.
const COMMON = new Set(`password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword 12345678 123456789
1234567890 12341234 11111111 00000000 87654321 88888888 qwerty123 qwertyui qwerty12 1q2w3e4r 1qaz2wsx qazwsxedc abc12345
abcd1234 a1b2c3d4 iloveyou iloveyou1 admin123 admin1234 administrator welcome1 welcome123 letmein1 sunshine princess
football baseball dragon123 monkey123 master123 trustno1 superman batman123 starwars changeme changeme1 default1
lancaster lancaster1 lancaster123 core1234 coreerp1 ltdc1234 company1 company123 manila123 philippines pilipinas mahalkita
iloveu123 qwertyuiop asdfghjkl zxcvbnm123 aa123456 asd12345 test1234 testing1 temp1234 guest123 user1234 hello123`.split(/\s+/));

// The password rules, for every new password: length, not a common one, not the username or name.
export function checkPassword(password, { username = '', name = '' } = {}, settings = SECURITY_DEFAULTS) {
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (password.length > 200) throw new HttpError(400, 'Password is too long.');
  if (!settings.blockCommonPasswords) return;
  const p = password.toLowerCase();
  if (COMMON.has(p) || /^(.)\1+$/.test(p) || /^(0123456789|123456789|abcdefgh)/.test(p)) throw new HttpError(400, 'That password is too common and easy to guess. Choose another, for example three unrelated words.');
  const parts = [username, ...String(name).split(/\s+/)].map((x) => String(x || '').toLowerCase()).filter((x) => x.length >= 3);
  if (parts.some((x) => p.includes(x))) throw new HttpError(400, 'The password cannot contain your username or name.');
}

// ----- HTTP security headers -----
// Every response: no MIME sniffing, no framing (clickjacking), no referrer to other sites, only the
// browser features CORE uses (location for clock-in), its own window. HSTS when served over HTTPS.
export function baseHeaders({ https = false } = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...(https ? { 'Strict-Transport-Security': 'max-age=15552000' } : {}),
  };
}

// The Content-Security-Policy for CORE's own pages: scripts only from CORE, plus the few small
// inline scripts in its pages (theme before first paint), allowed by their hash. Styles may be inline
// (the screens use style attributes); images may be data: or blob: (QR codes, attachments).
export function pagePolicy(root) {
  const hashes = new Set();
  for (const page of ['index.html', 'support.html', path.join('help', 'index.html')]) {
    const file = path.join(root, 'public', page);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
    }
  }
  return [
    "default-src 'self'",
    `script-src 'self' ${[...hashes].join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
// API answers are data, never a page.
export const API_POLICY = "default-src 'none'; frame-ancestors 'none'";

// A request that changes something must come from CORE's own pages: a browser says where a request
// came from (Origin, Sec-Fetch-Site); a different site is refused. With the SameSite=Strict cookie and
// JSON-only bodies this closes cross-site request forgery.
export function crossSite(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return Boolean(origin);
  try {
    return new URL(origin).host !== String(req.headers.host || '');
  } catch {
    return true;
  }
}
