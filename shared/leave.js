// Leave types and request helpers. Shared by the server and the browser.
import { eachDate, dayOfWeek, scheduleFor } from './calc.js';
import { isDayOff } from './holidays.js';

// annualCredits: days granted per calendar year; null = not tracked (no balance limit).
// appliesTo (optional): 'all' (default) or 'selected' = only employees an administrator adds.
// gender: null = anyone, or 'Female' / 'Male' = only employees with that gender on record.
// Medical certificate (either rule, or both; a request that meets either needs one):
//   certificateFromDays: null = no, or a request of this many work days or more needs one (1 = every request).
//   certificateAfterCount: null = no, or once the employee has filed this many requests of the type in a
//     certificatePeriod ('year' or 'month', of the leave's start date), every later one needs one (0 = every one).
// advanceDays: null = any time, or the leave must be filed at least this many days before it starts.
export const DEFAULT_LEAVE_TYPES = [
  { id: 'vl', code: 'VL', name: 'Vacation Leave', paid: true, annualCredits: 15, active: true, gender: null, certificateFromDays: null, certificateAfterCount: null, certificatePeriod: 'year', advanceDays: null },
  { id: 'sl', code: 'SL', name: 'Sick Leave', paid: true, annualCredits: 15, active: true, gender: null, certificateFromDays: 4, certificateAfterCount: null, certificatePeriod: 'year', advanceDays: null },
  { id: 'el', code: 'EL', name: 'Emergency Leave', paid: true, annualCredits: 3, active: true, gender: null, certificateFromDays: null, certificateAfterCount: null, certificatePeriod: 'year', advanceDays: null },
  { id: 'ml', code: 'ML', name: 'Maternity Leave', paid: true, annualCredits: null, active: true, gender: 'Female', certificateFromDays: null, certificateAfterCount: null, certificatePeriod: 'year', advanceDays: null },
  { id: 'pl', code: 'PL', name: 'Paternity Leave', paid: true, annualCredits: 7, active: true, gender: 'Male', certificateFromDays: null, certificateAfterCount: null, certificatePeriod: 'year', advanceDays: null },
  { id: 'spl', code: 'SPL', name: 'Solo Parent Leave', paid: true, annualCredits: 7, active: true, gender: null, certificateFromDays: null, certificateAfterCount: null, certificatePeriod: 'year', advanceDays: null },
  { id: 'lwop', code: 'LWOP', name: 'Leave Without Pay', paid: false, annualCredits: null, active: true, gender: null, certificateFromDays: null, certificateAfterCount: null, certificatePeriod: 'year', advanceDays: null },
];

export const LEAVE_GENDERS = { Female: 'Female employees only', Male: 'Male employees only' };
export const genderAllows = (type, employee) => !type.gender || employee?.gender === type.gender;
export const CERTIFICATE_PERIODS = { year: 'year', month: 'month' };
// Requests that count toward the "after N filings" rule: pending, returned or approved.
export const CERTIFICATE_COUNTED = ['pending', 'returned', 'approved'];
const periodOf = (type, date) => (type?.certificatePeriod === 'month' ? String(date).slice(0, 7) : String(date).slice(0, 4));
// How many requests of this type the employee filed before this one in the same year or month (by the
// leave's start date). filings: [{ id, startDate, filedAt }] of the employee's counted requests of the type.
export function priorFilings(type, filings, startDate, { excludeId = null, before = null } = {}) {
  if (!type || !startDate) return 0;
  const key = periodOf(type, startDate);
  return (filings || []).filter((f) => f.id !== excludeId && periodOf(type, f.startDate) === key && (!before || f.filedAt < before)).length;
}
// Which rule makes a certificate necessary: 'days', 'count', or null when none is needed.
export function certificateRule(type, days, prior = 0) {
  if (!type) return null;
  if (type.certificateFromDays != null && (type.certificateFromDays <= 1 || days >= type.certificateFromDays)) return 'days';
  if (type.certificateAfterCount != null && prior >= type.certificateAfterCount) return 'count';
  return null;
}
export const needsCertificate = (type, days, prior = 0) => Boolean(certificateRule(type, days, prior));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Why a certificate is needed, for the employee: "Sick Leave of 4 or more work days needs ..." or the filing count.
export function certificateReason(type, days, prior = 0) {
  const rule = certificateRule(type, days, prior);
  if (rule === 'days') {
    return type.certificateFromDays <= 1 ? `Every ${type.name} request needs a medical certificate.` : `${type.name} of ${type.certificateFromDays} or more work days needs a medical certificate (this request is ${plural(days, 'work day')}).`;
  }
  if (rule === 'count') {
    const period = type.certificatePeriod === 'month' ? 'month' : 'year';
    return type.certificateAfterCount === 0
      ? `Every ${type.name} request needs a medical certificate.`
      : `You have already filed ${plural(prior, `${type.name} request`)} this ${period}; after ${type.certificateAfterCount}, every further one needs a medical certificate.`;
  }
  return '';
}
// The rule in a few words, for the leave type list: "from 4 days; after 3 a year".
export function certificateSummary(type) {
  const parts = [];
  if (type?.certificateFromDays != null) parts.push(type.certificateFromDays <= 1 ? 'every request' : `from ${plural(type.certificateFromDays, 'day')}`);
  if (type?.certificateAfterCount != null) parts.push(type.certificateAfterCount === 0 ? 'every request' : `after ${type.certificateAfterCount} a ${type.certificatePeriod === 'month' ? 'month' : 'year'}`);
  return [...new Set(parts)].join('; ');
}

// Files accepted as a medical certificate, by content type.
export const ATTACHMENT_TYPES = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG image', 'image/png': 'PNG image', 'image/webp': 'WebP image' };
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const REQUEST_STATUS = { pending: 'Pending', returned: 'Returned for revision', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };
export const OPEN_REQUEST = ['pending', 'returned'];
// What can be filed: leave, working from home, or official business (work away from the office).
export const REQUEST_KINDS = { leave: 'Leave', remote: 'Work from home', ob: 'Official business' };
// A leave day can be taken whole or as the first or second half of the shift.
export const PORTIONS = { whole: 'Whole day', am: '1st half', pm: '2nd half' };
export const portionDays = (p) => (p === 'am' || p === 'pm' ? 0.5 : 1);

// Who approves, level by level (like Sprout HR's approval levels). Level 1 is normally the
// employee's immediate supervisor. Sequential: every level approves in turn. Parallel: the
// request goes to every level at once and one approval decides it. A rejection always ends it.
export const APPROVER_TYPES = {
  supervisor: 'Immediate supervisor',
  manager: "Supervisor's supervisor",
  hr: 'HR (anyone who approves leave)',
  users: 'Specific people',
};
export const APPROVAL_FLOWS = { sequential: 'Sequential: level by level', parallel: 'Parallel: any level can decide' };
export const DEFAULT_APPROVALS = { flow: 'sequential', levels: [{ type: 'supervisor' }, { type: 'hr' }], attachmentsToApprovers: false };
export const LEVEL_STATUS = { waiting: 'Waiting', pending: 'For approval', approved: 'Approved', rejected: 'Rejected', returned: 'Returned', skipped: 'Skipped' };

// Scheduled work days for an employee between two dates (inclusive). Regular holidays and special
// non-working days on the calendar are days off, so leave and remote work do not count them.
export function workDates(employee, settings, start, end, holidays = []) {
  const schedule = scheduleFor(employee, settings);
  const off = new Set(holidays.filter(isDayOff).map((h) => h.date));
  return eachDate(start, end).filter((d) => schedule.workDays.includes(dayOfWeek(d)) && (!employee.hireDate || d >= employee.hireDate) && !off.has(d));
}
