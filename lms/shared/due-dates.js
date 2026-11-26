// Due dates in ATLAS People (HRIS request PL-053): alerts for employees due for the renewal of their
// appointment, a probation evaluation, a step increment or retirement, worked out from the dates on
// the employee record. Shared by the server (server/due-dates.js: the list, the bell, the settings)
// and the browser (People → Due dates; HR settings → Alerts and due dates; My HR record).
//
//  - The kinds of rule are fixed here; HR names them, turns them on or off, and sets the lead days
//    (and a rule's one number: the months of probation, the years between step increments, the age).
//    HR never writes a formula.
//  - The defaults are a starting point, to confirm against CSC rules and the school's own policy.
//  - Dates are calendar dates ("YYYY-MM-DD"). Adding months or years keeps the day of the month, or
//    takes the last day of a shorter month: Aug 31 + 6 months is Feb 28 (Feb 29 in a leap year), and
//    someone born on Feb 29 turns 65 on Feb 28 in a year that is not a leap year.

export const CONFIRM_NOTE = 'To confirm against CSC rules and the school\'s policy';

// ----- The dates on the employee record (blank: worked out from the appointment history, or none) -----
export const RECORD_DATE_FIELDS = [
  ['appointmentEndDate', 'Appointment ends on', 'For a temporary, casual, contractual, substitute or coterminous appointment with an end date. Filled in from the appointment when it is confirmed.'],
  ['originalAppointmentDate', 'Date of original appointment', 'The assumption to duty of an original permanent appointment: the probation period counts from it. Blank: from the appointment history, when it has one.'],
  ['lastStepIncrementDate', 'Date of last step increment', 'The next step increment counts from this date or the effective date of the last appointment, whichever is later.'],
];
export const RECORD_DATE_KEYS = RECORD_DATE_FIELDS.map(([k]) => k);

// ----- The kinds of rule -----
// param: the rule's one number (key, label, min, max). employee: whether the employee may be told.
export const RULE_KINDS = [
  {
    kind: 'renewal', label: 'Renewal of appointment', employee: true,
    explain: 'An appointment with an end date, of the statuses ticked. Due on the date the appointment ends.',
  },
  {
    kind: 'probation', label: 'Probation evaluation', employee: false, param: { key: 'months', label: 'Probation period (months)', min: 1, max: 24 },
    explain: 'An original permanent appointment (or a Probationary employee): the evaluation is due before the probation period ends, counted from the date of original appointment.',
  },
  {
    kind: 'step', label: 'Step increment', employee: false, param: { key: 'years', label: 'Years in the same position', min: 1, max: 10 },
    explain: 'Salary grade and step (government payroll), below the last step: due every few years of continuous service in the same position, from the last step increment or the last appointment. A reminder only: it never changes the step or the pay.',
  },
  {
    kind: 'retirement', label: 'Compulsory retirement', employee: true, param: { key: 'age', label: 'Age', min: 50, max: 80 },
    explain: 'Due on the birthday at this age, from the birth date on the record.',
  },
  {
    kind: 'optionalRetirement', label: 'Optional retirement eligibility', employee: true, param: { key: 'age', label: 'Age', min: 50, max: 80 },
    explain: 'Due on the birthday at this age. Years of service are not checked.',
  },
];
export const RULE_IDS = RULE_KINDS.map((r) => r.kind);
export const ruleKind = (kind) => RULE_KINDS.find((r) => r.kind === kind) || null;

// The statuses a renewal applies to by default (the government's list; a private school ticks its own).
export const RENEWAL_STATUSES = ['Temporary', 'Casual', 'Contractual', 'Substitute', 'Coterminous'];
// Job orders and contracts of service have no appointment: no rule applies to them.
export const NO_APPOINTMENT = ['Job order', 'Contract of service'];

export const LIMITS = { name: 80, leadDays: 6, leadMax: 730, snoozeMax: 365, note: 300 };

export const DEFAULT_DUE_SETTINGS = {
  renewal: { on: true, name: 'Renewal of appointment', leadDays: [60, 30, 7], statuses: [...RENEWAL_STATUSES], tellHr: true, tellEmployee: false },
  probation: { on: true, name: 'Probation evaluation', leadDays: [30], months: 6, tellHr: true, tellEmployee: false },
  step: { on: true, name: 'Step increment', leadDays: [30], years: 3, tellHr: true, tellEmployee: false },
  retirement: { on: true, name: 'Compulsory retirement', leadDays: [180], age: 65, tellHr: true, tellEmployee: false },
  optionalRetirement: { on: false, name: 'Optional retirement eligibility', leadDays: [90], age: 60, tellHr: true, tellEmployee: false },
};

// Lead days as typed ("60, 30, 7" or a list): whole days, largest first, no repeats. null when one is not.
export function parseLeadDays(v) {
  const parts = Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > LIMITS.leadMax) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => b - a);
}

// settings.dueDates as stored, every rule and field present (a fresh object). Values out of range
// are put back to the default (the server refuses them when HR saves).
export function mergeDueSettings(v = {}) {
  const out = {};
  for (const k of RULE_KINDS) {
    const d = DEFAULT_DUE_SETTINGS[k.kind];
    const s = v && typeof v === 'object' ? v[k.kind] || {} : {};
    const lead = parseLeadDays(s.leadDays);
    const r = {
      on: typeof s.on === 'boolean' ? s.on : d.on,
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, LIMITS.name) : d.name,
      leadDays: lead && lead.length && lead.length <= LIMITS.leadDays ? lead : [...d.leadDays],
      tellHr: typeof s.tellHr === 'boolean' ? s.tellHr : d.tellHr,
      tellEmployee: k.employee && typeof s.tellEmployee === 'boolean' ? s.tellEmployee : false,
    };
    if (k.param) {
      const n = Number(s[k.param.key]);
      r[k.param.key] = Number.isInteger(n) && n >= k.param.min && n <= k.param.max ? n : d[k.param.key];
    }
    if (k.kind === 'renewal') r.statuses = Array.isArray(s.statuses) ? [...new Set(s.statuses.map(String).filter(Boolean))].slice(0, 20) : [...d.statuses];
    out[k.kind] = r;
  }
  return out;
}

// ----- Calendar arithmetic -----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s) => DATE_RE.test(String(s || '')) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const ymd = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1–12
// The same day of the month, `n` months later (earlier when negative); the last day of a shorter month.
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12 + 1;
  return ymd(ty, tm, Math.min(d, daysInMonth(ty, tm)));
}
export const addYears = (date, n) => addMonths(date, n * 12);
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// Days from `a` to `b` (negative when b is before a).
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// ----- What each rule makes of one employee -----
export const statusOf = (emp) => emp.appointment || emp.employmentStatus || '';
// Out of every rule: inactive, separated, or without an appointment (job order, contract of service).
export const excluded = (emp) => emp.status !== 'Active' || Boolean(emp.separationDate) || NO_APPOINTMENT.includes(statusOf(emp)) || emp.employmentStatus === 'Job order';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Jun 11, 2026", for the details of a row.
export const shortDate = (d) => (isDate(d) ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}, ${d.slice(0, 4)}` : '');
const latest = (dates) => dates.filter(isDate).sort().at(-1) || '';

// The dates a rule counts from: the record's own, else worked out from the appointment history
// (never invented). assumptionOf(appointmentId): the date of assumption of that appointment, if any.
// Each: { value, from } where from is 'record', 'history' or '' (no date).
export function recordDates(emp, { assumptionOf = () => '' } = {}) {
  const hist = Array.isArray(emp.appointmentHistory) ? emp.appointmentHistory.filter((r) => isDate(r.from)) : [];
  const byFrom = [...hist].sort((a, b) => b.from.localeCompare(a.from));
  const original = byFrom.find((r) => r.nature === 'original' && r.status === 'Permanent');
  const originalDate = original ? (isDate(assumptionOf(original.appointmentId)) ? assumptionOf(original.appointmentId) : original.from) : '';
  const lastAppointment = byFrom[0]?.from || '';
  const step = latest([emp.lastStepIncrementDate, lastAppointment]);
  return {
    appointmentEndDate: isDate(emp.appointmentEndDate) ? { value: emp.appointmentEndDate, from: 'record' } : { value: '', from: '' },
    originalAppointmentDate: isDate(emp.originalAppointmentDate) ? { value: emp.originalAppointmentDate, from: 'record' } : originalDate ? { value: originalDate, from: 'history' } : { value: '', from: '' },
    // The later of the last step increment and the last appointment (a promotion starts the count again).
    stepBase: step ? { value: step, from: step === emp.lastStepIncrementDate ? 'record' : 'history' } : { value: '', from: '' },
    lastAppointment,
  };
}

// The occurrences of every rule for one employee (whether the rule is on or not; the caller picks):
// [{ key, kind, employeeId, due, base, detail }], and what is missing: [{ kind, reason }].
// gov: government payroll (salary grades); stepsIn(sg): the steps a grade has.
export function occurrencesOf(emp, settings, { gov = true, stepsIn = () => 8, assumptionOf } = {}) {
  const out = [];
  const missing = [];
  if (excluded(emp)) return { list: out, missing };
  const s = mergeDueSettings(settings);
  const st = statusOf(emp);
  const dates = recordDates(emp, { assumptionOf });
  const add = (kind, due, base, detail) => out.push({ key: `${kind}:${emp.id}:${due}`, kind, employeeId: emp.id, due, base, detail });
  // Renewal: the statuses ticked, with an end date.
  if (s.renewal.statuses.includes(st)) {
    if (dates.appointmentEndDate.value) add('renewal', dates.appointmentEndDate.value, '', `${st} appointment ends`);
    else missing.push({ kind: 'renewal', reason: `${st} appointment without an end date` });
  }
  // Probation: an original permanent appointment, or a Probationary employee (from the date hired).
  const probBase = dates.originalAppointmentDate.value || (st === 'Probationary' && isDate(emp.hireDate) ? emp.hireDate : '');
  if ((st === 'Permanent' && dates.originalAppointmentDate.value) || (st === 'Probationary' && probBase)) {
    add('probation', addMonths(probBase, s.probation.months), probBase, `${s.probation.months} months from ${shortDate(probBase)}`);
  }
  // Step increment: a salary grade below its last step.
  if (gov && emp.salaryGrade && Number(emp.step || 1) < stepsIn(emp.salaryGrade)) {
    if (dates.stepBase.value) add('step', addYears(dates.stepBase.value, s.step.years), dates.stepBase.value, `${s.step.years} years from ${shortDate(dates.stepBase.value)}${dates.stepBase.from === 'history' ? ' (last appointment)' : ''}`);
    else missing.push({ kind: 'step', reason: 'No date of last step increment or appointment' });
  }
  // Retirement: the birthday at the age.
  if (isDate(emp.birthDate)) {
    add('retirement', addYears(emp.birthDate, s.retirement.age), emp.birthDate, `Turns ${s.retirement.age} · born ${shortDate(emp.birthDate)}`);
    add('optionalRetirement', addYears(emp.birthDate, s.optionalRetirement.age), emp.birthDate, `Turns ${s.optionalRetirement.age} · born ${shortDate(emp.birthDate)}`);
  } else {
    missing.push({ kind: 'retirement', reason: 'No birth date' });
    missing.push({ kind: 'optionalRetirement', reason: 'No birth date' });
  }
  return { list: out, missing };
}

// Which lead-day alert is due now: the smallest lead whose day has come (daysLeft <= lead), and every
// lead crossed so far (all of them are marked sent together, so an older one is never sent late).
export function leadsCrossed(leadDays, daysLeft) {
  const crossed = leadDays.filter((l) => daysLeft <= l);
  return { crossed, current: crossed.length ? Math.min(...crossed) : null };
}

// "in 20 days", "today", "5 days ago".
export function whenText(daysLeft) {
  if (daysLeft === 0) return 'today';
  const n = Math.abs(daysLeft);
  const d = `${n} day${n === 1 ? '' : 's'}`;
  return daysLeft > 0 ? `in ${d}` : `${d} ago`;
}

// The windows of the Due dates list: overdue only, or overdue and the next N days.
export const WINDOWS = [['overdue', 'Overdue only'], ['30', 'Next 30 days'], ['60', 'Next 60 days'], ['90', 'Next 90 days'], ['180', 'Next 180 days'], ['365', 'Next 12 months']];
export const LIST_DAYS = 365;
