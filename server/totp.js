// 2-step verification codes from an authenticator app (TOTP, RFC 6238: HMAC-SHA1, 6 digits, 30 s),
// and one-time recovery codes. No dependencies.
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// A new secret: 20 random bytes (160 bits, as RFC 4226 recommends), in base32 for the app.
export const newSecret = () => base32Encode(randomBytes(20));

// The 6-digit code for a 30-second step.
export function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

// The step a code belongs to, allowing one step either side for a phone's clock being a little off;
// null when it matches none, or when that step (or an earlier one) was already used: a code works once.
export function verifyCode(secret, code, { now = Date.now(), lastStep = -1 } = {}) {
  const digits = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const current = stepAt(now);
  for (const step of [current, current - 1, current + 1]) {
    if (step <= lastStep) continue;
    const expected = Buffer.from(codeAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(digits))) return step;
  }
  return null;
}

// The link an authenticator app reads from the QR code.
export function otpauthUrl({ secret, account, issuer = 'CORE' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// Recovery codes: ten one-time codes such as "K7QPM-2XW4D", for when the phone is lost. Only their
// hashes are stored, so they cannot be read from the data file or a backup.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
export function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const b = randomBytes(10);
    const s = [...b].map((x) => RECOVERY_ALPHABET[x % RECOVERY_ALPHABET.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
export const normalizeRecovery = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashRecovery = (code) => createHash('sha256').update(`core-recovery:${normalizeRecovery(code)}`).digest('hex');
export const looksLikeRecovery = (code) => normalizeRecovery(code).length === 10;
