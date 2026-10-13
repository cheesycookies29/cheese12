// Leave types and request helpers. Shared by the server and the browser.
import { eachDate, dayOfWeek, scheduleFor } from './calc.js';

// annualCredits: days granted per calendar year; null = not tracked (no balance limit).
export const DEFAULT_LEAVE_TYPES = [
  { id: 'vl', code: 'VL', name: 'Vacation Leave', paid: true, annualCredits: 15, active: true },
  { id: 'sl', code: 'SL', name: 'Sick Leave', paid: true, annualCredits: 15, active: true },
  { id: 'el', code: 'EL', name: 'Emergency Leave', paid: true, annualCredits: 3, active: true },
  { id: 'ml', code: 'ML', name: 'Maternity Leave', paid: true, annualCredits: null, active: true },
  { id: 'pl', code: 'PL', name: 'Paternity Leave', paid: true, annualCredits: 7, active: true },
  { id: 'spl', code: 'SPL', name: 'Solo Parent Leave', paid: true, annualCredits: 7, active: true },
  { id: 'lwop', code: 'LWOP', name: 'Leave Without Pay', paid: false, annualCredits: null, active: true },
];

export const REQUEST_STATUS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };

// Scheduled work days for an employee between two dates (inclusive).
export function workDates(employee, settings, start, end) {
  const schedule = scheduleFor(employee, settings);
  return eachDate(start, end).filter((d) => schedule.workDays.includes(dayOfWeek(d)) && (!employee.hireDate || d >= employee.hireDate));
}
