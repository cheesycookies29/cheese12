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

// Local date and time as 'YYYY-MM-DDTHH:MM' (compared as strings with due dates).
export function localDateTime(d = new Date()) {
  return `${localDate(d)}T${localTime(d)}`;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

export const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export function required(value, label) {
  if (!value) throw new HttpError(400, `${label} is required.`);
  return value;
}
