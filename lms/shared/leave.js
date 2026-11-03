// Leave types and request helpers. Shared by the server and the browser.
import { eachDate, dayOfWeek, scheduleFor } from './calc.js';

// annualCredits: days granted per calendar year; null = not tracked (no balance limit).
// appliesTo (optional): 'all' (default) or 'selected' = only employees an administrator adds.
// gender: null = anyone, or 'Female' / 'Male' = only employees with that gender on record.
// certificateAfterDays: null = never, or a medical certificate is required when a request is longer than this.
export const DEFAULT_LEAVE_TYPES = [
  { id: 'vl', code: 'VL', name: 'Vacation Leave', paid: true, annualCredits: 15, active: true, gender: null, certificateAfterDays: null },
  { id: 'sl', code: 'SL', name: 'Sick Leave', paid: true, annualCredits: 15, active: true, gender: null, certificateAfterDays: 3 },
  { id: 'el', code: 'EL', name: 'Emergency Leave', paid: true, annualCredits: 3, active: true, gender: null, certificateAfterDays: null },
  { id: 'ml', code: 'ML', name: 'Maternity Leave', paid: true, annualCredits: null, active: true, gender: 'Female', certificateAfterDays: null },
  { id: 'pl', code: 'PL', name: 'Paternity Leave', paid: true, annualCredits: 7, active: true, gender: 'Male', certificateAfterDays: null },
  { id: 'spl', code: 'SPL', name: 'Solo Parent Leave', paid: true, annualCredits: 7, active: true, gender: null, certificateAfterDays: null },
  { id: 'lwop', code: 'LWOP', name: 'Leave Without Pay', paid: false, annualCredits: null, active: true, gender: null, certificateAfterDays: null },
];

export const LEAVE_GENDERS = { Female: 'Female employees only', Male: 'Male employees only' };
export const genderAllows = (type, employee) => !type.gender || employee?.gender === type.gender;
export const needsCertificate = (type, days) => type?.certificateAfterDays != null && days > type.certificateAfterDays;

// Files accepted as a medical certificate, by content type.
export const ATTACHMENT_TYPES = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG image', 'image/png': 'PNG image', 'image/webp': 'WebP image' };
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const REQUEST_STATUS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };

// Scheduled work days for an employee between two dates (inclusive).
export function workDates(employee, settings, start, end) {
  const schedule = scheduleFor(employee, settings);
  return eachDate(start, end).filter((d) => schedule.workDays.includes(dayOfWeek(d)) && (!employee.hireDate || d >= employee.hireDate));
}
