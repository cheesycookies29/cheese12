// Leave types and request helpers. Shared by the server and the browser.
import { eachDate, dayOfWeek, scheduleFor } from './calc.js';
import { isDayOff } from './holidays.js';

// annualCredits: days granted per calendar year; null = not tracked (no balance limit).
// appliesTo (optional): 'all' (default) or 'selected' = only employees an administrator adds.
// gender: null = anyone, or 'Female' / 'Male' = only employees with that gender on record.
// certificateAfterDays: null = never, or a medical certificate is required when a request is longer than this.
// advanceDays: null = any time, or the leave must be filed at least this many days before it starts.
export const DEFAULT_LEAVE_TYPES = [
  { id: 'vl', code: 'VL', name: 'Vacation Leave', paid: true, annualCredits: 15, active: true, gender: null, certificateAfterDays: null, advanceDays: null },
  { id: 'sl', code: 'SL', name: 'Sick Leave', paid: true, annualCredits: 15, active: true, gender: null, certificateAfterDays: 3, advanceDays: null },
  { id: 'el', code: 'EL', name: 'Emergency Leave', paid: true, annualCredits: 3, active: true, gender: null, certificateAfterDays: null, advanceDays: null },
  { id: 'ml', code: 'ML', name: 'Maternity Leave', paid: true, annualCredits: null, active: true, gender: 'Female', certificateAfterDays: null, advanceDays: null },
  { id: 'pl', code: 'PL', name: 'Paternity Leave', paid: true, annualCredits: 7, active: true, gender: 'Male', certificateAfterDays: null, advanceDays: null },
  { id: 'spl', code: 'SPL', name: 'Solo Parent Leave', paid: true, annualCredits: 7, active: true, gender: null, certificateAfterDays: null, advanceDays: null },
  { id: 'lwop', code: 'LWOP', name: 'Leave Without Pay', paid: false, annualCredits: null, active: true, gender: null, certificateAfterDays: null, advanceDays: null },
];

export const LEAVE_GENDERS = { Female: 'Female employees only', Male: 'Male employees only' };
export const genderAllows = (type, employee) => !type.gender || employee?.gender === type.gender;
export const needsCertificate = (type, days) => type?.certificateAfterDays != null && days > type.certificateAfterDays;

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
export const DEFAULT_APPROVALS = { flow: 'sequential', levels: [{ type: 'supervisor' }, { type: 'hr' }] };
export const LEVEL_STATUS = { waiting: 'Waiting', pending: 'For approval', approved: 'Approved', rejected: 'Rejected', returned: 'Returned', skipped: 'Skipped' };

// Scheduled work days for an employee between two dates (inclusive). Regular holidays and special
// non-working days on the calendar are days off, so leave and remote work do not count them.
export function workDates(employee, settings, start, end, holidays = []) {
  const schedule = scheduleFor(employee, settings);
  const off = new Set(holidays.filter(isDayOff).map((h) => h.date));
  return eachDate(start, end).filter((d) => schedule.workDays.includes(dayOfWeek(d)) && (!employee.hireDate || d >= employee.hireDate) && !off.has(d));
}
