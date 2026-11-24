// Document Management: the secrets of external links (shared by CORE and ATLAS).
//
// A link's token is 32 random bytes (base64url), shown once when the link is made; only its SHA-256 is
// stored, so the data file (or a backup) never holds a working link. A link password is hashed with
// scrypt. After the right password, the browser gets a cookie holding an HMAC of the link id, the
// password hash and the link's version: changing the password or revoking the link (which bumps the
// version) makes every earlier cookie worthless.
import { randomBytes, createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex');
export const looksLikeToken = (t) => /^[A-Za-z0-9_-]{43}$/.test(String(t || ''));

const SCRYPT = { N: 16384, r: 8, p: 1 };
export function hashLinkPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(String(password), salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function checkLinkPassword(password, stored) {
  const m = String(stored || '').match(/^scrypt\$([^$]+)\$([^$]+)$/);
  if (!m) return false;
  const want = Buffer.from(m[2], 'base64');
  const got = scryptSync(String(password ?? ''), Buffer.from(m[1], 'base64'), want.length, SCRYPT);
  return got.length === want.length && timingSafeEqual(got, want);
}

// The value of the "unlocked" cookie for a link, from a key only the server holds.
export const unlockValue = (key, link) => createHmac('sha256', key).update(`${link.id}|${link.passwordHash || ''}|${link.linkVersion || 0}`).digest('base64url');
export function checkUnlock(key, link, value) {
  const want = Buffer.from(unlockValue(key, link));
  const got = Buffer.from(String(value || ''));
  return got.length === want.length && timingSafeEqual(got, want);
}
export const cookieName = (linkId) => `core_share_${String(linkId).replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`;
