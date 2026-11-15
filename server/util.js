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

// The data holds pay, government IDs and password hashes: its files are for the app's account
// only (0600), in folders only that account can open (0700). Best effort: Windows has no such modes.
export function keepPrivate(target, mode = 0o600) {
  try {
    fs.chmodSync(target, mode);
  } catch {}
}
