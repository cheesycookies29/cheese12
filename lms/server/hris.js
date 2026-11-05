// HRIS: employee records and their sign-in accounts, attendance (DTR) and the time
// clock, payroll, HR dashboard and employee self-service. Ported from the Lancaster
// ERP's HR & Payroll module (server/api.js there): the time, pay, contribution and tax
// rules are the ERP's, unchanged (shared/calc.js, shared/leave.js).
//
// For the school:
//  - every employee belongs to a campus; HR and payroll work on the campus they are
//    looking at (switch campus to see another), and payroll runs are per campus;
//  - teachers and registrars are employees too: HR links their LMS account to their
//    employee record, and they use the same sign-in for HRIS self-service;
//  - non-teaching staff, HR managers and payroll officers get HRIS-only accounts.
import { randomUUID } from 'node:crypto';
import { HttpError, localDate, localTime, text } from './util.js';
import { computePayslip, toMinutes, scheduleFor, DEFAULT_SETTINGS as HR_DEFAULTS, DEFAULT_RATES } from '../shared/calc.js';
import { ROLES, HRIS_ROLES, can } from '../shared/roles.js';
import { hashPassword, validatePassword } from './auth.js';
import { campusesFor, campusName } from './campus.js';
import { validateUserFields } from './admin.js';
import { registerLeaveRoutes, findLeaveType, leaveBalances } from './hris-leave.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// HR settings with every field present (older or partial data gets the defaults).
export function mergeHrSettings(s = {}) {
  return {
    ...structuredClone(HR_DEFAULTS),
    ...s,
    schedule: { ...HR_DEFAULTS.schedule, ...(s.schedule || {}) },
    contributions: { ...HR_DEFAULTS.contributions, ...(s.contributions || {}) },
    rates: {
      ...structuredClone(DEFAULT_RATES),
      ...(s.rates || {}),
      tax: { ...structuredClone(DEFAULT_RATES.tax), ...(s.rates?.tax || {}) },
    },
  };
}

// ----- Validation (from the ERP) -----
const EMPLOYEE_FIELDS = [
  'employeeNo', 'firstName', 'middleName', 'lastName', 'email', 'phone', 'birthDate', 'gender', 'civilStatus',
  'address', 'position', 'department', 'employmentStatus', 'hireDate', 'status', 'payType', 'rate', 'allowance',
  'minimumWageEarner', 'flexTime', 'tin', 'sssNo', 'philhealthNo', 'pagibigNo', 'bankName', 'bankAccount',
  'emergencyContactName', 'emergencyContactPhone', 'schedule', 'category',
];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
function trimStrings(obj) {
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') obj[k] = v.trim().slice(0, k === 'address' ? 300 : 120);
  return obj;
}
export const CATEGORIES = { teaching: 'Teaching', 'non-teaching': 'Non-teaching' };

function validateSchedule(s) {
  if (!TIME_RE.test(s?.shiftStart || '') || !TIME_RE.test(s?.shiftEnd || '')) fail('Shift start and end must be HH:MM.');
  const workDays = (s.workDays || []).map(Number).filter((d) => d >= 0 && d <= 6);
  if (!workDays.length) fail('Pick at least one work day.');
  return { shiftStart: s.shiftStart, shiftEnd: s.shiftEnd, breakMinutes: Math.min(240, Math.max(0, Number(s.breakMinutes) || 0)), workDays: [...new Set(workDays)].sort() };
}

export function nextEmployeeNo(data) {
  const max = data.employees.reduce((m, e) => Math.max(m, Number((String(e.employeeNo).match(/(\d+)$/) || [])[1]) || 0), 0);
  return `EMP-${String(max + 1).padStart(4, '0')}`;
}

function validateEmployee(input, data, existingId) {
  const e = trimStrings(pick(input, EMPLOYEE_FIELDS));
  if (!e.employeeNo && !existingId) e.employeeNo = nextEmployeeNo(data);
  for (const [f, label] of [['employeeNo', 'Employee number'], ['firstName', 'First name'], ['lastName', 'Last name'], ['hireDate', 'Date hired']]) {
    if (!e[f]) fail(`${label} is required.`);
  }
  if (!DATE_RE.test(e.hireDate)) fail('Date hired must be YYYY-MM-DD.');
  if (e.birthDate && !DATE_RE.test(e.birthDate)) fail('Birth date must be YYYY-MM-DD.');
  if (e.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)) fail('That email address does not look right.');
  if (!['monthly', 'daily'].includes(e.payType)) fail('Pay type must be monthly or daily.');
  e.rate = Number(e.rate);
  if (!(e.rate > 0)) fail('Rate must be greater than zero.');
  e.allowance = Math.max(0, Number(e.allowance) || 0);
  e.minimumWageEarner = Boolean(e.minimumWageEarner);
  e.flexTime = Boolean(e.flexTime);
  e.status = e.status === 'Inactive' ? 'Inactive' : 'Active';
  e.category = CATEGORIES[e.category] ? e.category : 'non-teaching';
  e.schedule = validateSchedule(e.schedule || data.hrSettings.schedule);
  const dup = data.employees.find((x) => x.employeeNo.toLowerCase() === e.employeeNo.toLowerCase() && x.id !== existingId);
  if (dup) fail(`Employee number ${e.employeeNo} is already used.`);
  return e;
}

function validateEntry(input, data, existingId) {
  const e = {
    employeeId: input.employeeId,
    date: input.date,
    type: input.type === 'leave' ? 'leave' : 'work',
    timeIn: input.timeIn || null,
    timeOut: input.timeOut || null,
    otApproved: Boolean(input.otApproved),
    remote: input.type !== 'leave' && Boolean(input.remote),
    leaveTypeId: null,
    paid: null,
    notes: String(input.notes || '').trim().slice(0, 300),
  };
  if (!DATE_RE.test(e.date || '')) fail('Date must be YYYY-MM-DD.');
  if (e.type === 'leave') {
    e.timeIn = e.timeOut = null;
    e.otApproved = false;
    // Leave entries without a type are treated as paid leave.
    if (input.leaveTypeId) {
      const type = findLeaveType(data, input.leaveTypeId);
      Object.assign(e, { leaveTypeId: type.id, paid: type.paid });
    } else e.paid = true;
  } else if (e.remote && !e.timeIn) {
    // A remote-work day without clock times counts as a full scheduled day.
    if (e.timeOut) fail('Enter a time in, or leave both times blank for a full remote day.');
  } else {
    if (!TIME_RE.test(e.timeIn || '')) fail('Time in must be HH:MM.');
    if (e.timeOut && !TIME_RE.test(e.timeOut)) fail('Time out must be HH:MM.');
    if (e.timeOut && toMinutes(e.timeOut) === toMinutes(e.timeIn)) fail('Time out must differ from time in.');
  }
  const dup = data.timeEntries.find((x) => x.employeeId === e.employeeId && x.date === e.date && x.id !== existingId);
  if (dup) fail('This employee already has a record on that date. Edit it instead.');
  return e;
}

function summarize(run) {
  const sum = (f) => Math.round(run.payslips.reduce((a, p) => a + f(p), 0) * 100) / 100;
  run.totals = {
    employees: run.payslips.length,
    grossPay: sum((p) => p.grossPay),
    totalDeductions: sum((p) => p.totalDeductions),
    netPay: sum((p) => p.netPay),
    employerContributions: sum((p) => p.employerShare.sss + p.employerShare.sssEc + p.employerShare.philhealth + p.employerShare.pagibig),
  };
  return run;
}

export function computeRun(data, run) {
  const { hrSettings, employees, timeEntries } = data;
  const previous = new Map(run.payslips.map((p) => [p.employeeId, p.adjustments]));
  run.payslips = employees
    .filter((e) => run.employeeIds.includes(e.id))
    .map((employee) => computePayslip({ employee, entries: timeEntries, periodStart: run.periodStart, periodEnd: run.periodEnd, settings: hrSettings, adjustments: previous.get(employee.id) }))
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  run.payFrequency = hrSettings.payFrequency;
  run.updatedAt = new Date().toISOString();
  return summarize(run);
}

const assertDraft = (run) => run.status === 'draft' || fail('This payroll run is finalized and can no longer be changed.');

function num(value, label, min, max) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n) || n < min || n > max) fail(`${label} must be between ${min} and ${max}.`);
  return n;
}

function validateTaxTable(rows, label) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 15) fail(`${label} tax table needs 1 to 15 brackets.`);
  const out = rows
    .map((r, i) => ({
      over: num(r.over, `${label} bracket ${i + 1} "over"`, 0, 1e9),
      base: num(r.base, `${label} bracket ${i + 1} base tax`, 0, 1e9),
      rate: num(r.rate, `${label} bracket ${i + 1} rate`, 0, 1),
    }))
    .sort((a, b) => a.over - b.over);
  if (out[0].over !== 0) fail(`${label} tax table must start at 0.`);
  if (new Set(out.map((r) => r.over)).size !== out.length) fail(`${label} tax table has two brackets with the same starting amount.`);
  return out;
}

function validatePayrollConfig(s) {
  s.payFrequency = s.payFrequency === 'monthly' ? 'monthly' : 'semi-monthly';
  s.workDaysPerYear = num(s.workDaysPerYear, 'Work days per year', 200, 366);
  s.gracePeriodMinutes = num(s.gracePeriodMinutes, 'Grace period', 0, 120);
  s.minimumOvertimeMinutes = num(s.minimumOvertimeMinutes, 'Minimum overtime', 0, 480);
  s.overtimeMultiplier = num(s.overtimeMultiplier, 'Overtime rate', 1, 5);
  s.restDayMultiplier = num(s.restDayMultiplier, 'Rest day rate', 1, 5);
  s.contributions = Object.fromEntries(['sss', 'philhealth', 'pagibig', 'withholdingTax'].map((k) => [k, Boolean(s.contributions[k])]));
  const { sss, philhealth, pagibig } = s.rates;
  s.rates.sss = {
    eeRate: num(sss.eeRate, 'SSS employee rate', 0, 1), erRate: num(sss.erRate, 'SSS employer rate', 0, 1),
    minMsc: num(sss.minMsc, 'SSS minimum salary credit', 0, 1e7), maxMsc: num(sss.maxMsc, 'SSS maximum salary credit', 0, 1e7),
    mscStep: num(sss.mscStep, 'SSS salary credit step', 1, 1e6),
    ecLow: num(sss.ecLow, 'SSS EC (low)', 0, 1e5), ecHigh: num(sss.ecHigh, 'SSS EC (high)', 0, 1e5), ecThreshold: num(sss.ecThreshold, 'SSS EC threshold', 0, 1e7),
  };
  if (s.rates.sss.minMsc >= s.rates.sss.maxMsc) fail('SSS minimum salary credit must be below the maximum.');
  s.rates.philhealth = { rate: num(philhealth.rate, 'PhilHealth rate', 0, 1), floor: num(philhealth.floor, 'PhilHealth floor', 0, 1e7), ceiling: num(philhealth.ceiling, 'PhilHealth ceiling', 0, 1e7) };
  if (s.rates.philhealth.floor > s.rates.philhealth.ceiling) fail('PhilHealth floor must not exceed the ceiling.');
  s.rates.pagibig = {
    eeRate: num(pagibig.eeRate, 'Pag-IBIG employee rate', 0, 1), eeLowRate: num(pagibig.eeLowRate, 'Pag-IBIG low-income rate', 0, 1),
    lowThreshold: num(pagibig.lowThreshold, 'Pag-IBIG low-income threshold', 0, 1e7), erRate: num(pagibig.erRate, 'Pag-IBIG employer rate', 0, 1),
    maxFundSalary: num(pagibig.maxFundSalary, 'Pag-IBIG maximum fund salary', 0, 1e7),
  };
  s.rates.tax = { 'semi-monthly': validateTaxTable(s.rates.tax['semi-monthly'], 'Semi-monthly'), monthly: validateTaxTable(s.rates.tax.monthly, 'Monthly') };
  return s;
}

// Everything removed with an employee record (attendance, requests, credits), and accounts unlinked.
export function deleteEmployees(data, ids, removeFile = () => {}) {
  const gone = new Set(ids);
  data.timeEntries = data.timeEntries.filter((e) => !gone.has(e.employeeId));
  for (const r of data.requests) if (gone.has(r.employeeId) && r.attachment) removeFile(r.attachment.id);
  data.requests = data.requests.filter((r) => !gone.has(r.employeeId));
  for (const k of ['leaveCredits', 'leaveAccess', 'leaveAdjustments']) data[k] = data[k].filter((c) => !gone.has(c.employeeId));
  for (const u of data.users) if (gone.has(u.employeeId)) u.employeeId = null;
  data.employees = data.employees.filter((e) => !gone.has(e.id));
}

export function registerHrisRoutes(route, ctx) {
  const { db } = ctx;
  const data = () => db.data;
  const save = () => db.save();
  const today = () => ctx.today();

  // ----- Scope -----
  const campusEmployees = (campusId) => data().employees.filter((e) => e.campusId === campusId);
  const employeeIn = (campusId, id) => data().employees.find((e) => e.id === id && e.campusId === campusId) || fail('Employee not found at this campus.', 404);
  const findRun = (id, campusId) => data().payrollRuns.find((r) => r.id === id && r.campusId === campusId) || fail('Payroll run not found.', 404);
  const finalizedOn = (campusId, dates) => data().payrollRuns.filter((r) => r.campusId === campusId && r.status === 'finalized' && dates.some((d) => d >= r.periodStart && d <= r.periodEnd));
  function linkedEmployee(user) {
    const emp = user.employeeId && data().employees.find((e) => e.id === user.employeeId);
    if (!emp) fail('Your account is not linked to an employee record yet. Ask HR to link it.');
    return emp;
  }
  // The linked account, for the employee screens.
  const accountOf = (emp) => {
    const u = data().users.find((x) => x.employeeId === emp.id);
    return u ? { id: u.id, name: u.name, username: u.username, role: u.role, roleLabel: ROLES[u.role]?.label || u.role, status: u.status, hrisOnly: HRIS_ROLES.includes(u.role), lastLoginAt: u.lastLoginAt || null } : null;
  };
  const employeeView = (emp) => ({ ...emp, campusName: campusName(data(), emp.campusId), account: accountOf(emp) });
  const hrSettingsView = () => ({ ...data().hrSettings, employerName: data().settings.schoolName });

  // ----- Settings -----
  route('GET', '/api/hris/settings', 'hris', () => hrSettingsView());
  // Employer details on payslips and the default work schedule (HR).
  route('PUT', '/api/hris/settings', 'hris:hris.settings', ({ body, user }) => {
    const s = data().hrSettings;
    if ('employerAddress' in body) s.employerAddress = text(body.employerAddress, 300);
    if ('employerTin' in body) s.employerTin = text(body.employerTin, 40);
    if (body.schedule) s.schedule = validateSchedule(body.schedule);
    s.updatedAt = new Date().toISOString();
    s.updatedBy = user.name;
    save();
    return hrSettingsView();
  });
  // Payroll setup: pay rules, deductions, government rates and tax tables (payroll, administrators).
  route('PUT', '/api/hris/payroll-config', 'hris:payroll.config', ({ body, user }) => {
    const next = mergeHrSettings({ ...data().hrSettings, ...pick(body, ['payFrequency', 'workDaysPerYear', 'gracePeriodMinutes', 'minimumOvertimeMinutes', 'overtimeMultiplier', 'restDayMultiplier', 'contributions', 'rates']) });
    data().hrSettings = { ...validatePayrollConfig(next), payrollConfigUpdatedAt: new Date().toISOString(), payrollConfigUpdatedBy: user.name };
    save();
    return hrSettingsView();
  });

  // ----- Dashboard -----
  route('GET', '/api/hris/dashboard', 'hris:hris.dashboard', ({ campusId, user }) => {
    const date = today();
    const all = campusEmployees(campusId);
    const active = all.filter((e) => e.status === 'Active');
    const ids = new Set(active.map((e) => e.id));
    const todays = data().timeEntries.filter((e) => e.date === date && ids.has(e.employeeId));
    const s = data().hrSettings;
    const scheduledToday = active.filter((e) => scheduleFor(e, s).workDays.includes(new Date(`${date}T00:00`).getDay()) && e.hireDate <= date);
    const byId = new Map(active.map((e) => [e.id, e]));
    // Late today: clocked in after the shift start plus the grace period (not on flexible time).
    const late = todays.filter((t) => {
      const emp = byId.get(t.employeeId);
      return t.type === 'work' && t.timeIn && !emp.flexTime && toMinutes(t.timeIn) - toMinutes(scheduleFor(emp, s).shiftStart) > (Number(s.gracePeriodMinutes) || 0);
    });
    const count = (list, key) => Object.entries(list.reduce((m, e) => ((m[e[key] || '—'] = (m[e[key] || '—'] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
    const month = date.slice(5, 7);
    const pending = data().requests.filter((r) => r.status === 'pending' && ids.has(r.employeeId));
    const upcoming = data().requests
      .filter((r) => r.status === 'approved' && ids.has(r.employeeId) && r.endDate >= date && r.startDate <= localDate(new Date(new Date(`${date}T00:00`).getTime() + 14 * 86400000)))
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 8)
      .map((r) => ({ id: r.id, kind: r.kind, startDate: r.startDate, endDate: r.endDate, days: r.days, name: `${byId.get(r.employeeId).firstName} ${byId.get(r.employeeId).lastName}`, typeName: r.kind === 'remote' ? 'Remote work' : data().leaveTypes.find((t) => t.id === r.leaveTypeId)?.name || 'Leave' }));
    const runs = can(user.role, 'payroll.view') ? data().payrollRuns.filter((r) => r.campusId === campusId).sort((a, b) => b.periodStart.localeCompare(a.periodStart)) : [];
    return {
      date,
      headcount: active.length,
      inactive: all.length - active.length,
      teaching: active.filter((e) => e.category === 'teaching').length,
      byStatus: count(active, 'employmentStatus'),
      byDepartment: count(active, 'department'),
      today: {
        scheduled: scheduledToday.length,
        present: todays.filter((t) => t.type === 'work' && (t.timeIn || t.remote)).length,
        clockedIn: todays.filter((t) => t.type === 'work' && t.timeIn && !t.timeOut).length,
        late: late.length,
        onLeave: todays.filter((t) => t.type === 'leave').length,
        remote: todays.filter((t) => t.remote).length,
        notIn: scheduledToday.filter((e) => !todays.some((t) => t.employeeId === e.id)).map((e) => ({ id: e.id, name: `${e.lastName}, ${e.firstName}`, position: e.position || '' })),
      },
      pendingRequests: pending.length,
      upcoming,
      birthdays: active.filter((e) => e.birthDate?.slice(5, 7) === month).sort((a, b) => a.birthDate.slice(8).localeCompare(b.birthDate.slice(8))).map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, day: e.birthDate.slice(5) })),
      unlinked: active.filter((e) => !data().users.some((u) => u.employeeId === e.id)).length,
      latestRun: runs[0] ? { id: runs[0].id, periodStart: runs[0].periodStart, periodEnd: runs[0].periodEnd, payDate: runs[0].payDate, status: runs[0].status, totals: runs[0].totals } : null,
    };
  });

  // ----- Employees -----
  route('GET', '/api/hris/employees', 'hris:employees.view', ({ campusId }) => campusEmployees(campusId).map(employeeView));
  route('GET', '/api/hris/employees/:id', 'hris:employees.view', ({ params, campusId }) => employeeView(employeeIn(campusId, params.id)));
  route('POST', '/api/hris/employees', 'hris:employees.edit', ({ body, user, campusId }) => {
    const emp = { id: randomUUID(), ...validateEmployee(body, data()), campusId: targetCampus(user, body.campusId, campusId), createdAt: new Date().toISOString() };
    const linkTo = body.linkUserId ? linkable(user, emp, body.linkUserId) : null;
    data().employees.push(emp);
    if (linkTo) linkTo.employeeId = emp.id;
    save();
    return employeeView(emp);
  });
  route('PUT', '/api/hris/employees/:id', 'hris:employees.edit', ({ params, body, user, campusId }) => {
    const emp = employeeIn(campusId, params.id);
    const fields = validateEmployee({ ...emp, ...body }, data(), emp.id);
    const moveTo = body.campusId ? targetCampus(user, body.campusId, campusId) : emp.campusId;
    if (moveTo !== emp.campusId && data().payrollRuns.some((r) => r.status === 'draft' && r.employeeIds.includes(emp.id))) {
      fail('This employee is in a draft payroll run at this campus. Finalize or delete it before moving them.');
    }
    Object.assign(emp, fields, { campusId: moveTo, updatedAt: new Date().toISOString() });
    // The account follows the employee to the new campus.
    const acct = data().users.find((u) => u.employeeId === emp.id);
    if (acct && HRIS_ROLES.includes(acct.role) && !acct.campusIds?.includes(moveTo)) acct.campusIds = [moveTo];
    save();
    return employeeView(emp);
  });
  route('DELETE', '/api/hris/employees/:id', 'hris:employees.edit', ({ params, campusId }) => {
    const emp = employeeIn(campusId, params.id);
    deleteEmployees(data(), [emp.id], (id) => ctx.files.remove(id));
    save();
    return { ok: true };
  });

  // The campus a new or moved employee goes to: the caller's current one, or another they work at.
  function targetCampus(user, requested, current) {
    if (!requested || requested === current) return current;
    if (!campusesFor(data(), user).some((c) => c.id === requested)) fail('You can only place employees at your own campuses.', 403);
    return requested;
  }

  // ----- Sign-in accounts for employees -----
  // Accounts at this campus that an employee record can be linked to: teachers and
  // registrars (their LMS account), and HRIS accounts. Students never; administrators
  // only by an administrator.
  const linkableRoles = (caller) => ['teacher', 'registrar', ...HRIS_ROLES, ...(caller.role === 'admin' ? ['admin'] : [])];
  function linkable(caller, emp, userId) {
    if (!can(caller.role, 'hris.accounts')) fail('Your account cannot link sign-in accounts.', 403);
    const u = data().users.find((x) => x.id === userId);
    if (!u || !linkableRoles(caller).includes(u.role) || (u.role !== 'admin' && !(u.campusIds || []).includes(emp.campusId))) fail('Account not found at this campus.', 404);
    const other = u.employeeId && data().employees.find((e) => e.id === u.employeeId && e.id !== emp.id);
    if (other) fail(`${u.name}'s account is already linked to ${other.firstName} ${other.lastName} (${other.employeeNo}).`);
    const current = data().users.find((x) => x.employeeId === emp.id && x.id !== u.id);
    if (current) fail(`This employee is already linked to the account ${current.username}. Unlink it first.`);
    return u;
  }
  route('GET', '/api/hris/accounts/linkable', 'hris:hris.accounts', ({ user, campusId }) => {
    const roles = linkableRoles(user);
    return data().users
      .filter((u) => roles.includes(u.role) && u.status === 'active' && (u.role === 'admin' || (u.campusIds || []).includes(campusId)))
      .filter((u) => !u.employeeId || !data().employees.some((e) => e.id === u.employeeId))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, roleLabel: ROLES[u.role].label, email: u.email || '', department: u.department || '', employeeNo: u.employeeNo || '' }));
  });
  // Link an existing account, or create an HRIS account (Staff, HR Manager, Payroll Officer).
  route('POST', '/api/hris/employees/:id/account', 'hris:hris.accounts', ({ params, body, user, campusId }) => {
    const emp = employeeIn(campusId, params.id);
    if (body.userId) {
      linkable(user, emp, body.userId).employeeId = emp.id;
      save();
      return employeeView(emp);
    }
    if (data().users.some((x) => x.employeeId === emp.id)) fail('This employee already has an account. Unlink it first.');
    const role = HRIS_ROLES.includes(body.role) ? body.role : fail('Pick Staff, HR Manager or Payroll Officer.');
    const fields = validateUserFields({ role, name: `${emp.firstName} ${emp.lastName}`, username: body.username, email: emp.email }, data());
    validatePassword(body.password);
    data().users.push({
      id: randomUUID(), ...fields, campusIds: [emp.campusId], employeeId: emp.id, status: 'active',
      mustChangePassword: body.mustChangePassword !== false, passwordHash: hashPassword(body.password), createdAt: new Date().toISOString(),
    });
    save();
    return employeeView(emp);
  });
  // Change an HRIS account: type, active/disabled, or a new temporary password.
  route('PUT', '/api/hris/employees/:id/account', 'hris:hris.accounts', ({ params, body, user, campusId }) => {
    const emp = employeeIn(campusId, params.id);
    const u = data().users.find((x) => x.employeeId === emp.id) || fail('This employee has no account.', 404);
    if (!HRIS_ROLES.includes(u.role)) fail(`${u.name} signs in with their ${ROLES[u.role].label.toLowerCase()} account; change it in the Learn admin panel.`);
    if (body.role && body.role !== u.role) {
      if (!HRIS_ROLES.includes(body.role)) fail('Pick Staff, HR Manager or Payroll Officer.');
      if (u.id === user.id) fail('You cannot change your own account type.');
      u.role = body.role;
      ctx.signOutEverywhere(u.id);
    }
    if (body.status && body.status !== u.status) {
      if (!['active', 'disabled'].includes(body.status)) fail('Status must be active or disabled.');
      if (u.id === user.id) fail('You cannot disable your own account.');
      u.status = body.status;
      if (u.status === 'disabled') ctx.signOutEverywhere(u.id);
    }
    if (body.password) {
      validatePassword(body.password);
      u.passwordHash = hashPassword(body.password);
      u.mustChangePassword = true;
      ctx.signOutEverywhere(u.id);
    }
    save();
    return employeeView(emp);
  });
  // Unlink: the account stays (it may be a teacher's LMS account); it just no longer has HRIS self-service.
  route('DELETE', '/api/hris/employees/:id/account', 'hris:hris.accounts', ({ params, campusId }) => {
    const emp = employeeIn(campusId, params.id);
    for (const u of data().users) if (u.employeeId === emp.id) u.employeeId = null;
    save();
    return employeeView(emp);
  });

  // ----- Attendance (DTR) -----
  route('GET', '/api/hris/time-entries', 'hris:attendance.view', ({ query, campusId }) => {
    const ids = new Set(campusEmployees(campusId).map((e) => e.id));
    const { employeeId, from, to } = query;
    return data().timeEntries
      .filter((e) => ids.has(e.employeeId) && (!employeeId || e.employeeId === employeeId) && (!from || e.date >= from) && (!to || e.date <= to))
      .sort((a, b) => b.date.localeCompare(a.date) || (a.timeIn || '').localeCompare(b.timeIn || ''));
  });
  route('POST', '/api/hris/time-entries', 'hris:attendance.edit', ({ body, campusId }) => {
    employeeIn(campusId, body.employeeId);
    const entry = { id: randomUUID(), ...validateEntry(body, data()) };
    data().timeEntries.push(entry);
    save();
    return entry;
  });
  const entryIn = (campusId, id) => {
    const entry = data().timeEntries.find((e) => e.id === id) || fail('Attendance record not found.', 404);
    employeeIn(campusId, entry.employeeId);
    return entry;
  };
  route('PUT', '/api/hris/time-entries/:id', 'hris:attendance.edit', ({ params, body, campusId }) => {
    const entry = entryIn(campusId, params.id);
    Object.assign(entry, validateEntry({ ...body, employeeId: entry.employeeId }, data(), entry.id));
    save();
    return entry;
  });
  route('DELETE', '/api/hris/time-entries/:id', 'hris:attendance.edit', ({ params, campusId }) => {
    const entry = entryIn(campusId, params.id);
    data().timeEntries = data().timeEntries.filter((e) => e.id !== entry.id);
    save();
    return { ok: true };
  });

  // Clock in / out at the current date and time.
  function clock(emp, action) {
    if (emp.status !== 'Active') fail('This employee record is inactive.');
    const now = ctx.now();
    const date = localDate(now);
    const time = localTime(now);
    const open = data().timeEntries.find((e) => e.employeeId === emp.id && e.type === 'work' && e.timeIn && !e.timeOut);
    if (action === 'in') {
      if (open) fail(`Already clocked in since ${open.date} ${open.timeIn}.`);
      // An approved remote day can still be clocked, to record actual hours.
      const remoteDay = data().timeEntries.find((e) => e.employeeId === emp.id && e.date === date && e.remote && !e.timeIn);
      if (remoteDay) {
        remoteDay.timeIn = time;
        save();
        return { message: `${emp.firstName} clocked in at ${time} (remote work).`, entry: remoteDay };
      }
      const entry = { id: randomUUID(), ...validateEntry({ employeeId: emp.id, date, type: 'work', timeIn: time }, data()), clockedIn: true };
      data().timeEntries.push(entry);
      save();
      return { message: `${emp.firstName} clocked in at ${time}.`, entry };
    }
    if (action === 'out') {
      if (!open) fail('Not clocked in.');
      if (time === open.timeIn && open.date === date) fail('Clock out must be at least a minute after clock in.');
      open.timeOut = time;
      save();
      return { message: `${emp.firstName} clocked out at ${time}.`, entry: open };
    }
    fail('Action must be "in" or "out".');
  }

  // ----- Payroll -----
  route('GET', '/api/hris/payroll-runs', 'hris:payroll.view', ({ campusId }) =>
    data().payrollRuns.filter((r) => r.campusId === campusId).map(({ payslips, ...run }) => run).sort((a, b) => b.periodStart.localeCompare(a.periodStart)));
  route('GET', '/api/hris/payroll-runs/:id', 'hris:payroll.view', ({ params, campusId }) => findRun(params.id, campusId));
  route('POST', '/api/hris/payroll-runs', 'hris:payroll.edit', ({ body, campusId }) => {
    const { periodStart, periodEnd, payDate } = body;
    if (!DATE_RE.test(periodStart || '') || !DATE_RE.test(periodEnd || '')) fail('Pick a valid pay period.');
    if (periodEnd < periodStart) fail('Period end must be on or after period start.');
    const clash = data().payrollRuns.find((r) => r.campusId === campusId && r.periodStart <= periodEnd && periodStart <= r.periodEnd);
    if (clash) fail(`There is already a payroll run for ${clash.periodStart} to ${clash.periodEnd} at this campus (${clash.status}). Open it instead, or delete it first.`);
    const employeeIds = campusEmployees(campusId).filter((e) => e.status === 'Active' && e.hireDate <= periodEnd).map((e) => e.id);
    if (!employeeIds.length) fail('There are no active employees at this campus for this period.');
    const run = {
      id: randomUUID(), campusId, periodStart, periodEnd, payDate: DATE_RE.test(payDate || '') ? payDate : periodEnd,
      status: 'draft', employeeIds, payslips: [], createdAt: new Date().toISOString(),
    };
    computeRun(data(), run);
    data().payrollRuns.push(run);
    save();
    return run;
  });
  route('POST', '/api/hris/payroll-runs/:id/recompute', 'hris:payroll.edit', ({ params, campusId }) => {
    const run = findRun(params.id, campusId);
    assertDraft(run);
    computeRun(data(), run);
    save();
    return run;
  });
  route('PUT', '/api/hris/payroll-runs/:id/payslips/:employeeId', 'hris:payroll.edit', ({ params, body, campusId }) => {
    const run = findRun(params.id, campusId);
    assertDraft(run);
    const slip = run.payslips.find((p) => p.employeeId === params.employeeId) || fail('Payslip not found.', 404);
    slip.adjustments = {
      otherEarnings: Math.min(1e7, Math.max(0, Number(body.otherEarnings) || 0)),
      otherDeductions: Math.min(1e7, Math.max(0, Number(body.otherDeductions) || 0)),
      remarks: text(body.remarks, 300),
    };
    computeRun(data(), run);
    save();
    return run;
  });
  route('POST', '/api/hris/payroll-runs/:id/finalize', 'hris:payroll.edit', ({ params, user, campusId }) => {
    const run = findRun(params.id, campusId);
    assertDraft(run);
    computeRun(data(), run);
    Object.assign(run, { status: 'finalized', finalizedAt: new Date().toISOString(), finalizedBy: user.name });
    save();
    return run;
  });
  route('DELETE', '/api/hris/payroll-runs/:id', 'hris:payroll.edit', ({ params, campusId }) => {
    const run = findRun(params.id, campusId);
    data().payrollRuns = data().payrollRuns.filter((r) => r.id !== run.id);
    save();
    return { ok: true };
  });

  // ----- Employee self-service -----
  route('GET', '/api/hris/me/profile', 'hris', ({ user }) => {
    const emp = linkedEmployee(user);
    return { ...emp, campusName: campusName(data(), emp.campusId) };
  });
  route('GET', '/api/hris/me/time-entries', 'hris', ({ user, query }) => {
    const emp = linkedEmployee(user);
    return data().timeEntries
      .filter((e) => e.employeeId === emp.id && (!query.from || e.date >= query.from) && (!query.to || e.date <= query.to))
      .sort((a, b) => b.date.localeCompare(a.date));
  });
  route('POST', '/api/hris/me/clock', 'hris', ({ user, body }) => clock(linkedEmployee(user), body.action));
  route('GET', '/api/hris/me/payslips', 'hris', ({ user }) => {
    const emp = linkedEmployee(user);
    return data().payrollRuns
      .filter((r) => r.status === 'finalized')
      .flatMap((r) => r.payslips.filter((p) => p.employeeId === emp.id).map((p) => ({ runId: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, payDate: r.payDate, grossPay: p.grossPay, totalDeductions: p.totalDeductions, netPay: p.netPay })))
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  });
  route('GET', '/api/hris/me/payslips/:runId', 'hris', ({ user, params }) => {
    const emp = linkedEmployee(user);
    const run = data().payrollRuns.find((r) => r.id === params.runId && r.status === 'finalized');
    const payslip = run?.payslips.find((p) => p.employeeId === emp.id) || fail('Payslip not found.', 404);
    const { payslips, employeeIds, ...meta } = run;
    return { run: meta, payslip };
  });

  const leave = registerLeaveRoutes(route, ctx, { linkedEmployee, employeeIn, campusEmployees, finalizedOn });

  // Summary for the HRIS start-up: the employee record linked to this account (if any).
  return {
    employeeSummary(user) {
      const emp = user?.employeeId && data().employees.find((e) => e.id === user.employeeId);
      return emp ? { id: emp.id, name: `${emp.firstName} ${emp.lastName}`, firstName: emp.firstName, employeeNo: emp.employeeNo, position: emp.position || '', campusId: emp.campusId, campusName: campusName(data(), emp.campusId), status: emp.status } : null;
    },
    leaveBalances: (employeeId, year) => leaveBalances(data(), employeeId, year),
    certificates: leave.certificates,
  };
}
