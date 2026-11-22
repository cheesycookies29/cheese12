import { readFileSync } from 'node:fs';
import fs from 'node:fs';

const pad = (n) => String(n).padStart(2, '0');

// Local (not UTC) date/time of the machine running the app.
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localTime(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// A file on disk to send as the answer (0.66: a large PDF export), streamed rather than read into
// memory; removed once sent when `remove` is set.
export class FileReply {
  constructor(path, { size = 0, remove = false } = {}) {
    this.path = path;
    this.size = size;
    this.remove = remove;
  }
  // The bytes, for callers that want them in memory (tests).
  read() { return readFileSync(this.path); }
}

// The data holds pay, government IDs and password hashes: its files are for the app's account
// only (0600), in folders only that account can open (0700). Best effort: Windows has no such modes.
export function keepPrivate(target, mode = 0o600) {
  try {
    fs.chmodSync(target, mode);
  } catch {}
}

// Separation of duties (VAPT 0.33): nobody changes their own attendance, overtime, leave credits,
// pay or payslip; another account with the same access does it. Administrators are the exception
// (someone has to be able to); their changes are in the audit log like everyone's.
export function notOwnRecord(user, employeeId, what) {
  if (user?.role === 'admin' || !user?.employeeId || !employeeId || user.employeeId !== employeeId) return;
  throw new HttpError(403, `You cannot change your own ${what}. Ask a colleague with the same access, or an administrator, to do it.`);
}
