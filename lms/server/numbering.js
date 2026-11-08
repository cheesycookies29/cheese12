// The next number in a series an administrator can format (Settings → Numbering):
// student numbers, employee numbers and document requests. A series restarts each year
// (or month) when its format has {YYYY}/{YY} ({MM}); numbers already in use are skipped,
// so changing the format never hands out a number twice.
import { DEFAULT_NUMBERING, formatSerial, seriesKey } from '../shared/numbering.js';
import { localDate } from './util.js';

const trailing = (no) => Number((String(no ?? '').match(/(\d+)$/) || [])[1]) || 0;

// What each series has already used, and where a series with no counter yet starts.
const SERIES = {
  studentNo: (data) => ({ used: new Set(data.users.map((u) => u.studentNo).filter(Boolean)), seed: () => 0 }),
  // Continues after the highest employee number already given (EMP-0042 → 43).
  employeeNo: (data) => ({ used: new Set(data.employees.map((e) => e.employeeNo).filter(Boolean)), seed: () => data.employees.reduce((m, e) => Math.max(m, trailing(e.employeeNo)), 0) }),
  // Continues after this year's requests.
  documentRequest: (data, date) => ({ used: new Set(data.documentRequests.map((r) => r.refNo)), seed: () => data.documentRequests.filter((r) => String(r.refNo || '').includes(date.slice(0, 4))).length }),
};

export function nextNumber(data, kind, { date = localDate(), format = data.settings?.numbering?.[kind] || DEFAULT_NUMBERING[kind] } = {}) {
  const { used, seed } = SERIES[kind](data, date);
  const key = seriesKey(format, date);
  data.counters ||= {};
  const c = (data.counters[kind] ||= {});
  let n = c[key] ?? seed();
  let no;
  do no = formatSerial(format, { date, serial: ++n });
  while (used.has(no));
  c[key] = n;
  return no;
}

// The number the next record would get with `format`, without using it up (the Settings preview).
export function previewNumber(data, kind, format, date = localDate()) {
  const copy = { ...data, counters: structuredClone(data.counters || {}) };
  return nextNumber(copy, kind, { date, format });
}
