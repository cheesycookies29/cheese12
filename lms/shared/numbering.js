// Numbering formats an administrator can change (student numbers, employee numbers, document
// requests). Shared with the browser for the "next number" preview. Same tokens as Finance:
// {YYYY} or {YY} year, {MM} month, {N} the serial ({N4} = at least 4 digits).
export const DEFAULT_NUMBERING = {
  studentNo: '{YYYY}-{N4}',
  employeeNo: 'EMP-{N4}',
  documentRequest: 'DR{YYYY}-{N5}',
};

export const NUMBERING_LABELS = {
  studentNo: 'Student numbers',
  employeeNo: 'Employee numbers',
  documentRequest: 'Document request numbers',
};

export function formatSerial(format, { date, serial }) {
  const [y, m] = String(date).split('-');
  return String(format).replace(/\{YYYY\}/g, y).replace(/\{YY\}/g, y.slice(2)).replace(/\{MM\}/g, m)
    .replace(/\{N(\d?)\}/g, (_, d) => String(serial).padStart(Number(d) || 1, '0'));
}

// The part of the date a series restarts on: a new year (or month) starts again at 1.
export function seriesKey(format, date) {
  const f = String(format);
  return `${/\{YYYY\}|\{YY\}/.test(f) ? date.slice(0, 4) : ''}${f.includes('{MM}') ? date.slice(4, 7) : ''}` || 'all';
}

// null when the format is fine, else what is wrong with it.
export function formatProblem(format) {
  const f = String(format ?? '');
  if (!f.trim()) return 'is empty';
  if (f.length > 40) return 'is longer than 40 characters';
  if (!/\{N\d?\}/.test(f)) return 'needs a serial: {N} or {N4}';
  if ((f.match(/\{N\d?\}/g) || []).length > 1) return 'has more than one serial';
  const rest = f.replace(/\{(YYYY|YY|MM|N\d?)\}/g, '');
  if (/[{}]/.test(rest)) return 'has an unknown {…} part; use {YYYY}, {YY}, {MM} and {N}';
  if (!/^[A-Za-z0-9 ._/#-]*$/.test(rest)) return 'may only use letters, digits, spaces and . _ / # -';
  return null;
}
