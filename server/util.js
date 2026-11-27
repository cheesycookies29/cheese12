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

// extra (0.71, CUSTOM APP): { code, fresh }, a stable code from a refusal catalogue and the state
// as it is now, so the browser can show what happened without asking again. Optional: two-argument
// callers are unchanged.
export class HttpError extends Error {
  constructor(status, message, { code, fresh } = {}) {
    super(message);
    this.status = status;
    if (code) this.code = code;
    if (fresh !== undefined) this.fresh = fresh;
  }
}

// The JSON body of an error answer: { error }, plus { code, fresh } when CORE's own HttpError
// carries them. Anything unexpected (a 500) says nothing about itself.
export function errorBody(err) {
  const status = err?.status || 500;
  if (status === 500) return { error: 'Something went wrong. Check the terminal for details.' };
  const out = { error: err.message };
  if (err instanceof HttpError) {
    if (err.code) out.code = err.code;
    if (err.fresh !== undefined) out.fresh = err.fresh;
  }
  return out;
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
