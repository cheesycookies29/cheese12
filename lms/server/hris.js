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
import { computePayslip, toMinutes, scheduleFor, dayOfWeek, DEFAULT_SETTINGS as HR_DEFAULTS, DEFAULT_RATES } from '../shared/calc.js';
import { ROLES, HRIS_ROLES, can } from '../shared/roles.js';
import { hashPassword, validatePassword } from './auth.js';
import { campusesFor, campusName } from './campus.js';
import { validateUserFields } from './admin.js';
import { registerLeaveRoutes, findLeaveType, leaveBalances } from './hris-leave.js';
import { clockInLocation, forViewer, locationSettings, purgeOldLocations, registerGeoRoutes } from './hris-geo.js';
import { registerPayrollFinanceRoutes } from './hris-finance.js';
import { computeGovPayslip, computeGovBonus, DEFAULT_GOV, BONUS_KINDS, APPOINTMENTS, DEDUCTION_TYPES, monthlySalary, salaryFor, stepsIn, isJobOrder } from '../shared/gov-pay.js';

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
    // Government (GSIS, salary grades, PERA/RATA) or private-sector (SSS) payroll; a state school is government.
    payrollSystem: s.payrollSystem === 'private' ? 'private' : 'government',
    gov: { ...DEFAULT_GOV, ...(s.gov || {}) },
    contributions: { gsis: true, ...HR_DEFAULTS.contributions, ...(s.contributions || {}) },
    // Each group is merged on its own, so an older or partial group still gets every field.
    rates: {
      sss: { ...DEFAULT_RATES.sss, ...(s.rates?.sss || {}) },
      philhealth: { ...DEFAULT_RATES.philhealth, ...(s.rates?.philhealth || {}) },
      pagibig: { ...DEFAULT_RATES.pagibig, ...(s.rates?.pagibig || {}) },
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
  // Government service: plantilla item, salary grade and step, appointment, GSIS, PERA and RATA.
  'salaryGrade', 'step', 'plantillaItem', 'appointment', 'gsisNo', 'pera', 'rataRepresentation', 'rataTransportation', 'separationDate',
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
  // Salary grade and step (government): the monthly rate comes from the salary schedule.
  // Private-school payroll has no salary grades: the rate entered is the rate.
  if (data.hrSettings.payrollSystem !== 'government') e.salaryGrade = null;
  e.salaryGrade = e.salaryGrade === '' || e.salaryGrade == null ? null : Math.round(Number(e.salaryGrade));
  if (e.salaryGrade != null) {
    if (!(e.salaryGrade >= 1 && e.salaryGrade <= 33)) fail('Salary grade must be 1 to 33.');
    e.step = Math.round(Number(e.step) || 1);
    if (!(e.step >= 1 && e.step <= stepsIn(e.salaryGrade))) fail(`Salary grade ${e.salaryGrade} has steps 1 to ${stepsIn(e.salaryGrade)}.`);
    e.payType = 'monthly';
    e.rate = salaryFor(e.salaryGrade, e.step, localDate());
  } else e.step = null;
  e.appointment = APPOINTMENTS.includes(e.appointment) ? e.appointment : '';
  // Date of separation (resignation, retirement, end of contract): bonuses look at service on their cut-off date.
  e.separationDate = e.separationDate || null;
  if (e.separationDate && (!DATE_RE.test(e.separationDate) || e.separationDate < e.hireDate)) fail('Date separated must be a date after the date hired.');
  e.pera = e.pera !== false && e.pera !== 'false';
  for (const k of ['rataRepresentation', 'rataTransportation']) {
    e[k] = Math.max(0, Number(e[k]) || 0);
    if (e[k] > 100000) fail('RATA must be at most ₱100,000 a month each.');
  }
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

export function summarizeRun(run) {
  const sum = (f) => Math.round(run.payslips.reduce((a, p) => a + f(p), 0) * 100) / 100;
  run.totals = {
    employees: run.payslips.length,
    grossPay: sum((p) => p.grossPay),
    totalDeductions: sum((p) => p.totalDeductions),
    netPay: sum((p) => p.netPay),
    employerContributions: sum((p) => Object.values(p.employerShare || {}).reduce((a, v) => a + (Number(v) || 0), 0)),
  };
  return run;
}

// What each recurring deduction has had taken in finalized runs (other than `exceptRunId`).
export function deductionsPaid(data, exceptRunId = null) {
  const paid = {};
  for (const r of data.payrollRuns) {
    if (r.status !== 'finalized' || r.id === exceptRunId) continue;
    for (const p of r.payslips) for (const d of p.deductions?.items || []) paid[d.id] = Math.round(((paid[d.id] || 0) + d.amount) * 100) / 100;
  }
  return paid;
}

// Bonuses already paid this year that count toward the P90,000 exemption, per employee.
function benefitsThisYear(data, year, exceptRunId) {
  const used = {};
  for (const r of data.payrollRuns) {
    if (r.status !== 'finalized' || r.id === exceptRunId || r.kind === 'regular' || !r.kind || !String(r.payDate).startsWith(String(year))) continue;
    for (const p of r.payslips) used[p.employeeId] = (used[p.employeeId] || 0) + (p.benefitsCounted || 0);
  }
  return used;
}

export function computeRun(data, run) {
  const { hrSettings, employees, timeEntries } = data;
  const previous = new Map(run.payslips.map((p) => [p.employeeId, p.adjustments]));
  const people = employees.filter((e) => run.employeeIds.includes(e.id));
  if (run.system === 'government' && run.kind && run.kind !== 'regular') {
    // A bonus or allowance run: eligibility, the P90,000 exemption so far this year, tax on any excess.
    const year = Number(run.year);
    const used = benefitsThisYear(data, year, run.id);
    const g = hrSettings.gov;
    run.payslips = people.map((employee) => {
      const m = monthlySalary(employee, run.payDate) || 0;
      const monthlyTaxable = Math.max(0, m - m * g.gsisPersonal - Math.min(m, hrSettings.rates.philhealth.ceiling) * hrSettings.rates.philhealth.rate / 2 - Math.min(m, hrSettings.rates.pagibig.maxFundSalary) * hrSettings.rates.pagibig.eeRate);
      return computeGovBonus({ employee, kind: run.kind, year, payDate: run.payDate, settings: hrSettings, ytdExempt: used[employee.id] || 0, monthlyTaxable, adjustments: previous.get(employee.id) });
    }).sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  } else if (run.system === 'government') {
    const paid = deductionsPaid(data, run.id);
    const year = Number(run.periodEnd.slice(0, 4));
    const vlId = hrSettings.gov.vacationLeaveId;
    run.payslips = people.map((employee) => {
      const vl = leaveBalances(data, employee.id, year).find((b) => b.leaveTypeId === vlId);
      return computeGovPayslip({
        employee, entries: timeEntries, periodStart: run.periodStart, periodEnd: run.periodEnd, settings: hrSettings, adjustments: previous.get(employee.id),
        deductions: (data.payrollDeductions || []).filter((d) => d.employeeId === employee.id), paidSoFar: paid, vlRemaining: vl?.remaining ?? 0,
      });
    }).sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  } else {
    run.payslips = people
      .map((employee) => computePayslip({ employee, entries: timeEntries, periodStart: run.periodStart, periodEnd: run.periodEnd, settings: hrSettings, adjustments: previous.get(employee.id) }))
      .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  }
  run.payFrequency = hrSettings.payFrequency;
  run.updatedAt = new Date().toISOString();
  return summarizeRun(run);
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
  s.contributions = Object.fromEntries(['gsis', 'sss', 'philhealth', 'pagibig', 'withholdingTax'].map((k) => [k, Boolean(s.contributions[k])]));
  s.payrollSystem = s.payrollSystem === 'private' ? 'private' : 'government';
  const g = s.gov;
  s.gov = {
    gsisPersonal: num(g.gsisPersonal, 'GSIS personal share', 0, 1), gsisGovernment: num(g.gsisGovernment, 'GSIS government share', 0, 1), ecc: num(g.ecc, 'Employees\' Compensation', 0, 10000),
    pera: num(g.pera, 'PERA', 0, 100000), peraTaxable: Boolean(g.peraTaxable),
    workingDaysPerMonth: num(g.workingDaysPerMonth, 'Working days a month', 15, 31),
    netPayFloor: num(g.netPayFloor, 'Minimum net pay', 0, 1e6),
    overtime: g.overtime === 'pay' ? 'pay' : 'cto',
    overtimeRegular: num(g.overtimeRegular, 'Overtime rate (work days)', 1, 5), overtimeRestDay: num(g.overtimeRestDay, 'Overtime rate (rest days)', 1, 5),
    overtimeCapPercent: num(g.overtimeCapPercent, 'Overtime cap', 0, 100),
    tardiness: g.tardiness === 'salary' ? 'salary' : 'leave',
    vacationLeaveId: String(g.vacationLeaveId || 'vl').slice(0, 40),
    benefitsExemptCeiling: num(g.benefitsExemptCeiling, '13th-month and other benefits exemption', 0, 1e7),
    cashGift: num(g.cashGift, 'Cash gift', 0, 1e6), pei: num(g.pei, 'PEI', 0, 1e6),
    clothingAllowance: num(g.clothingAllowance, 'Clothing allowance', 0, 1e6), clothingExemptCeiling: num(g.clothingExemptCeiling, 'Clothing de minimis ceiling', 0, 1e6),
    clothingMinMonths: num(g.clothingMinMonths, 'Months of service for the clothing allowance', 0, 24),
    jobOrderEwt: num(g.jobOrderEwt, 'Job order withholding tax', 0, 1), jobOrderPercentageTax: num(g.jobOrderPercentageTax, 'Job order percentage tax', 0, 1),
    payrollFund: /^\d{2}$/.test(String(g.payrollFund || '')) ? String(g.payrollFund) : '01',
  };
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
  for (const k of ['leaveCredits', 'leaveAccess', 'leaveAdjustments', 'payrollDeductions']) data[k] = (data[k] || []).filter((c) => !gone.has(c.employeeId));
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
  // Each campus has its own clock-in location; the screens get the one for the campus they are on.
  const hrSettingsView = (campusId) => {
    const { locations: _all, ...s } = data().hrSettings;
    return { ...s, employerName: data().settings.schoolName, location: locationSettings(data(), campusId) };
  };
  // Clock-in locations past each campus's retention period are removed at start-up and while the server runs.
  if (purgeOldLocations(data(), ctx.now())) save();
  setInterval(() => purgeOldLocations(data(), ctx.now()) && save(), 6 * 60 * 60 * 1000).unref();

  // ----- Settings -----
  route('GET', '/api/hris/settings', 'hris', ({ campusId }) => hrSettingsView(campusId));
  // Employer details on payslips and the default work schedule (HR).
  route('PUT', '/api/hris/settings', 'hris:hris.settings', ({ body, user, campusId }) => {
    const s = data().hrSettings;
    if ('employerAddress' in body) s.employerAddress = text(body.employerAddress, 300);
    if ('employerTin' in body) s.employerTin = text(body.employerTin, 40);
    if (body.schedule) s.schedule = validateSchedule(body.schedule);
    s.updatedAt = new Date().toISOString();
    s.updatedBy = user.name;
    save();
    return hrSettingsView(campusId);
  });
  // Payroll setup: pay rules, deductions, government rates and tax tables (payroll, administrators).
  route('PUT', '/api/hris/payroll-config', 'hris:payroll.config', ({ body, user, campusId }) => {
    const next = mergeHrSettings({ ...data().hrSettings, ...pick(body, ['payFrequency', 'workDaysPerYear', 'gracePeriodMinutes', 'minimumOvertimeMinutes', 'overtimeMultiplier', 'restDayMultiplier', 'contributions', 'rates', 'payrollSystem']), gov: { ...data().hrSettings.gov, ...(body.gov || {}) } });
    data().hrSettings = { ...validatePayrollConfig(next), payrollConfigUpdatedAt: new Date().toISOString(), payrollConfigUpdatedBy: user.name };
    save();
    return hrSettingsView(campusId);
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
    // Late today: clocked in after the shift start plus the grace period, on a scheduled work
    // day (rest-day work is never late) and not on flexible time.
    const lateBy = (t) => {
      const sched = scheduleFor(byId.get(t.employeeId), s);
      if (t.type !== 'work' || !t.timeIn || sched.flex || !sched.workDays.includes(dayOfWeek(t.date))) return 0;
      const mins = toMinutes(t.timeIn) - toMinutes(sched.shiftStart);
      return mins > (Number(s.gracePeriodMinutes) || 0) ? mins : 0;
    };
    const late = todays.filter((t) => lateBy(t) > 0);
    // Everyone scheduled today or with a record today, with their status (as on the ERP dashboard).
    const rowOf = (emp) => {
      const t = todays.find((x) => x.employeeId === emp.id);
      const status = !t ? 'not-in' : t.type === 'leave' ? 'leave' : t.remote && !t.timeIn ? 'remote' : t.timeIn && !t.timeOut ? 'in' : 'done';
      return {
        id: emp.id, name: `${emp.lastName}, ${emp.firstName}`, position: emp.position || '', department: emp.department || '',
        status, timeIn: t?.timeIn || '', timeOut: t?.timeOut || '', remote: Boolean(t?.remote), lateMinutes: t ? lateBy(t) : 0,
        leaveTypeId: t?.leaveTypeId || null, paid: t?.paid, shiftStart: scheduleFor(emp, s).shiftStart, flex: Boolean(emp.flexTime),
      };
    };
    const rowIds = new Set([...scheduledToday.map((e) => e.id), ...todays.map((t) => t.employeeId)]);
    const order = { in: 0, done: 1, remote: 2, leave: 3, 'not-in': 4 };
    const rows = active.filter((e) => rowIds.has(e.id)).map(rowOf).sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    const count = (list, key) => Object.entries(list.reduce((m, e) => ((m[e[key] || '—'] = (m[e[key] || '—'] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
    const month = date.slice(5, 7);
    const pending = data().requests.filter((r) => r.status === 'pending' && ids.has(r.employeeId));
    const upcoming = data().requests
      .filter((r) => r.status === 'approved' && ids.has(r.employeeId) && r.endDate >= date && r.startDate <= localDate(new Date(new Date(`${date}T00:00`).getTime() + 14 * 86400000)))
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 8)
      .map((r) => ({ id: r.id, kind: r.kind, startDate: r.startDate, endDate: r.endDate, days: r.days, name: `${byId.get(r.employeeId).firstName} ${byId.get(r.employeeId).lastName}`, typeName: r.kind === 'remote' ? 'Remote work' : data().leaveTypes.find((t) => t.id === r.leaveTypeId)?.name || 'Leave' }));
    // The latest regular payroll (bonus runs are not "the payroll").
    const runs = can(user.role, 'payroll.view') ? data().payrollRuns.filter((r) => r.campusId === campusId && (!r.kind || r.kind === 'regular')).sort((a, b) => b.periodStart.localeCompare(a.periodStart)) : [];
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
        rows,
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
    const role = HRIS_ROLES.includes(body.role) ? body.role : fail('Pick an account type (Staff, HR, payroll or a Finance office).');
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
      if (!HRIS_ROLES.includes(body.role)) fail('Pick an account type (Staff, HR, payroll or a Finance office).');
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
  // Clock-in locations are only ever sent to HR managers and administrators (hris-geo.js).
  route('GET', '/api/hris/time-entries', 'hris:attendance.view', ({ query, campusId, user }) => {
    const ids = new Set(campusEmployees(campusId).map((e) => e.id));
    const { employeeId, from, to } = query;
    return data().timeEntries
      .filter((e) => ids.has(e.employeeId) && (!employeeId || e.employeeId === employeeId) && (!from || e.date >= from) && (!to || e.date <= to))
      .sort((a, b) => b.date.localeCompare(a.date) || (a.timeIn || '').localeCompare(b.timeIn || ''))
      .map((e) => forViewer(user, e));
  });
  route('POST', '/api/hris/time-entries', 'hris:attendance.edit', ({ body, campusId, user }) => {
    employeeIn(campusId, body.employeeId);
    const entry = { id: randomUUID(), ...validateEntry(body, data()) };
    data().timeEntries.push(entry);
    save();
    return forViewer(user, entry);
  });
  const entryIn = (campusId, id) => {
    const entry = data().timeEntries.find((e) => e.id === id) || fail('Attendance record not found.', 404);
    employeeIn(campusId, entry.employeeId);
    return entry;
  };
  // Editing a record keeps the location recorded when the employee clocked in.
  route('PUT', '/api/hris/time-entries/:id', 'hris:attendance.edit', ({ params, body, campusId, user }) => {
    const entry = entryIn(campusId, params.id);
    Object.assign(entry, validateEntry({ ...body, employeeId: entry.employeeId }, data(), entry.id));
    save();
    return forViewer(user, entry);
  });
  route('DELETE', '/api/hris/time-entries/:id', 'hris:attendance.edit', ({ params, campusId }) => {
    const entry = entryIn(campusId, params.id);
    data().timeEntries = data().timeEntries.filter((e) => e.id !== entry.id);
    save();
    return { ok: true };
  });

  // Clock in / out at the current date and time. Clocking in also records where (hris-geo.js);
  // a missing location never stops anyone from clocking in.
  function clock(emp, action, body = {}, source = 'self') {
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
        remoteDay.clockInLocation = clockInLocation(locationSettings(data(), emp.campusId), body, source, now);
        save();
        return { message: `${emp.firstName} clocked in at ${time} (remote work).`, entry: remoteDay };
      }
      const entry = { id: randomUUID(), ...validateEntry({ employeeId: emp.id, date, type: 'work', timeIn: time }, data()), clockedIn: true, clockInLocation: clockInLocation(locationSettings(data(), emp.campusId), body, source, now) };
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

  // ----- Time clock (one shared computer at the campus; from the ERP) -----
  // Who can clock in here, and where each person is today: no other employee details.
  route('GET', '/api/hris/clock', 'hris:clock.kiosk', ({ campusId, user }) => {
    const date = today();
    const people = campusEmployees(campusId).filter((e) => e.status === 'Active').sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
    const ids = new Set(people.map((e) => e.id));
    const open = data().timeEntries.filter((e) => ids.has(e.employeeId) && e.type === 'work' && e.timeIn && !e.timeOut);
    const todays = data().timeEntries.filter((e) => ids.has(e.employeeId) && e.date === date);
    return {
      date,
      people: people.map((e) => ({ id: e.id, name: `${e.lastName}, ${e.firstName}`, firstName: e.firstName, employeeNo: e.employeeNo })),
      // Open entries from earlier days too (someone who forgot to clock out).
      entries: [...new Map([...todays, ...open].map((e) => [e.id, e])).values()].map((e) => forViewer(user, e)),
    };
  });
  route('POST', '/api/hris/clock', 'hris:clock.kiosk', ({ body, campusId, user }) => {
    const res = clock(employeeIn(campusId, String(body.employeeId || '')), body.action, body, 'kiosk');
    return { ...res, entry: forViewer(user, res.entry) };
  });
  registerGeoRoutes(route, { data, save, campusEmployees, now: () => ctx.now() });

  // ----- Payroll -----
  route('GET', '/api/hris/payroll-runs', 'hris:payroll.view', ({ campusId }) =>
    data().payrollRuns.filter((r) => r.campusId === campusId).map(({ payslips, ...run }) => run).sort((a, b) => b.periodStart.localeCompare(a.periodStart)));
  // Runs made before the campus was kept on them get its current name.
  const withCampus = (run) => ({ ...run, campusName: run.campusName || campusName(data(), run.campusId) });
  // With the agency's name and Finance's signatories, for the General Payroll (GAM Appendix 33).
  const payrollForms = () => {
    const f = data().finSettings || {};
    const sig = (k) => ({ name: f.signatories?.[k]?.name || '', title: f.signatories?.[k]?.title || '' });
    return { entity: f.entity?.name || data().settings.schoolName, head: sig('head'), accountant: sig('accountant'), cashier: sig('cashier') };
  };
  route('GET', '/api/hris/payroll-runs/:id', 'hris:payroll.view', ({ params, campusId }) => ({ ...withCampus(findRun(params.id, campusId)), forms: payrollForms() }));
  // Runs elsewhere (another campus) that already pay an employee for this period or bonus:
  // someone who moved campus is not paid twice.
  const otherRuns = (run, employeeId) => data().payrollRuns.filter((r) => r.id !== run.id && r.employeeIds.includes(employeeId)
    && r.payslips.some((p) => p.employeeId === employeeId && p.grossPay > 0)
    && (run.kind && run.kind !== 'regular' ? r.kind === run.kind && Number(r.year) === Number(run.year) : (!r.kind || r.kind === 'regular') && r.periodStart <= run.periodEnd && run.periodStart <= r.periodEnd));
  const notPaidElsewhere = (run) => (id) => !otherRuns(run, id).length;
  route('POST', '/api/hris/payroll-runs', 'hris:payroll.edit', ({ body, campusId }) => {
    const system = data().hrSettings.payrollSystem;
    const kind = BONUS_KINDS[body.kind] ? body.kind : 'regular';
    if (kind !== 'regular') {
      // A bonus or allowance run (government payroll): one of each kind a year per campus.
      if (system !== 'government') fail('Bonus runs are part of government payroll (Payroll setup).');
      const year = Math.round(Number(body.year));
      if (!(year >= 2000 && year <= 2100)) fail('Pick the year.');
      if (!DATE_RE.test(body.payDate || '') || !String(body.payDate).startsWith(String(year))) fail(`Pick a pay date in ${year}.`);
      const dup = data().payrollRuns.find((r) => r.campusId === campusId && r.kind === kind && Number(r.year) === year);
      if (dup) fail(`There is already a ${BONUS_KINDS[kind].name.toLowerCase()} run for ${year} at this campus (${dup.status}). Open it instead, or delete it first.`);
      // Everyone in service on the cut-off date (someone who left after it is still listed).
      const cutoff = BONUS_KINDS[kind].cutoff ? `${year}-${BONUS_KINDS[kind].cutoff}` : body.payDate;
      const probe = { id: '', kind, year };
      const employeeIds = campusEmployees(campusId)
        .filter((e) => e.hireDate <= body.payDate && (e.status === 'Active' || (e.separationDate && e.separationDate >= cutoff)))
        .map((e) => e.id).filter(notPaidElsewhere(probe));
      if (!employeeIds.length) fail('There are no employees at this campus for this bonus (or they were paid it at another campus).');
      const run = {
        id: randomUUID(), campusId, campusName: campusName(data(), campusId), system, kind, year, name: `${BONUS_KINDS[kind].name} ${year}`,
        periodStart: body.payDate, periodEnd: body.payDate, payDate: body.payDate, status: 'draft', employeeIds, payslips: [], createdAt: new Date().toISOString(),
      };
      computeRun(data(), run);
      data().payrollRuns.push(run);
      save();
      return run;
    }
    const { periodStart, periodEnd, payDate } = body;
    if (!DATE_RE.test(periodStart || '') || !DATE_RE.test(periodEnd || '')) fail('Pick a valid pay period.');
    if (periodEnd < periodStart) fail('Period end must be on or after period start.');
    const clash = data().payrollRuns.find((r) => r.campusId === campusId && (!r.kind || r.kind === 'regular') && r.periodStart <= periodEnd && periodStart <= r.periodEnd);
    if (clash) fail(`There is already a payroll run for ${clash.periodStart} to ${clash.periodEnd} at this campus (${clash.status}). Open it instead, or delete it first.`);
    const employeeIds = campusEmployees(campusId).filter((e) => e.status === 'Active' && e.hireDate <= periodEnd).map((e) => e.id)
      .filter(notPaidElsewhere({ id: '', kind: 'regular', periodStart, periodEnd }));
    if (!employeeIds.length) fail('There are no active employees at this campus for this period (or they were paid for it at another campus).');
    const run = {
      // The campus is kept on the run: payslips show it even after the campus is renamed or an employee moves.
      id: randomUUID(), campusId, campusName: campusName(data(), campusId), system, kind: 'regular', periodStart, periodEnd, payDate: DATE_RE.test(payDate || '') ? payDate : periodEnd,
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
      // Government payroll: leave someone out of this run (e.g. not entitled to a bonus), with the reason in the remarks.
      excluded: run.system === 'government' && (body.excluded === true || body.excluded === 'on' || body.excluded === 'true'),
    };
    computeRun(data(), run);
    save();
    return run;
  });
  route('POST', '/api/hris/payroll-runs/:id/finalize', 'hris:payroll.edit', ({ params, user, campusId }) => {
    const run = findRun(params.id, campusId);
    assertDraft(run);
    computeRun(data(), run);
    const twice = run.payslips.filter((p) => p.grossPay > 0 && otherRuns(run, p.employeeId).some((r) => r.status === 'finalized'));
    if (twice.length) fail(`Already paid for this ${run.kind && run.kind !== 'regular' ? 'bonus' : 'period'} in another run: ${twice.map((p) => p.employee.name).join(', ')}. Use Adjust → leave out, then finalize.`);
    Object.assign(run, { status: 'finalized', campusName: campusName(data(), run.campusId), finalizedAt: new Date().toISOString(), finalizedBy: user.name });
    // Tardiness and undertime charged to vacation leave come off the credits now (CSC rules).
    const vlId = data().hrSettings.gov.vacationLeaveId;
    for (const p of run.payslips) {
      const days = p.leave?.chargedToLeaveDays;
      if (!days) continue;
      data().leaveAdjustments.push({ id: randomUUID(), employeeId: p.employeeId, leaveTypeId: vlId, year: Number(run.periodEnd.slice(0, 4)), days: -days, reason: `Tardiness and undertime, ${run.periodStart} to ${run.periodEnd} (${p.leave.tardinessMinutes} min)`, at: new Date().toISOString(), by: user.name, runId: run.id });
    }
    save();
    return run;
  });
  route('DELETE', '/api/hris/payroll-runs/:id', 'hris:payroll.edit', ({ params, campusId }) => {
    const run = findRun(params.id, campusId);
    // Once Finance has its obligation request, the run is the record behind it.
    const ors = run.finance?.orsId && data().finObligations?.find((o) => o.id === run.finance.orsId);
    if (ors && ors.status !== 'cancelled') fail(`This run is on ${ors.form} ${ors.no || '(being obligated)'} in Finance. Cancel that request first.`);
    const remit = (run.finance?.remittances || []).map((r) => data().finDvs?.find((d) => d.id === r.dvId)).find((d) => d && d.status !== 'cancelled');
    if (remit) fail(`This run has a remittance voucher in Finance${remit.no ? ` (DV ${remit.no})` : ''}. Cancel it first.`);
    data().payrollRuns = data().payrollRuns.filter((r) => r.id !== run.id);
    // Leave charged by the run goes back; loan balances follow the remaining finalized runs.
    data().leaveAdjustments = data().leaveAdjustments.filter((a) => a.runId !== run.id);
    save();
    return { ok: true };
  });

  registerPayrollFinanceRoutes(route, ctx, { data, save, findRun });

  // ----- Loans and other recurring deductions (government payroll) -----
  const deductionView = (d, paid) => {
    const paidAmount = paid[d.id] || 0;
    return { ...d, paid: paidAmount, balance: d.total ? Math.max(0, Math.round((d.total - paidAmount) * 100) / 100) : null };
  };
  function validateDeduction(input) {
    const type = DEDUCTION_TYPES.find((t) => t.code === input.type) || fail('Pick the kind of deduction.');
    const d = {
      type: type.code,
      name: text(input.name, 80) || type.name,
      reference: text(input.reference, 60),
      monthly: Math.round(Number(input.monthly) * 100) / 100,
      total: input.total === '' || input.total == null ? null : Math.round(Number(input.total) * 100) / 100,
      startDate: input.startDate,
      endDate: input.endDate || null,
      notes: text(input.notes, 300),
    };
    if (!(d.monthly > 0 && d.monthly <= 1e6)) fail('Enter the amount deducted a month.');
    if (d.total != null && !(d.total >= d.monthly)) fail('The total to pay must be at least one month\'s deduction.');
    if (!DATE_RE.test(d.startDate || '')) fail('Pick the first month of the deduction.');
    if (d.endDate && (!DATE_RE.test(d.endDate) || d.endDate < d.startDate)) fail('The last month must be after the first.');
    return d;
  }
  route('GET', '/api/hris/employees/:id/deductions', 'hris:payroll.view', ({ params, campusId }) => {
    const emp = employeeIn(campusId, params.id);
    const paid = deductionsPaid(data());
    return data().payrollDeductions.filter((d) => d.employeeId === emp.id).map((d) => deductionView(d, paid)).sort((a, b) => b.startDate.localeCompare(a.startDate));
  });
  route('POST', '/api/hris/employees/:id/deductions', 'hris:payroll.edit', ({ params, body, campusId, user }) => {
    const emp = employeeIn(campusId, params.id);
    const d = { id: randomUUID(), employeeId: emp.id, ...validateDeduction(body), createdAt: new Date().toISOString(), createdBy: user.name };
    data().payrollDeductions.push(d);
    save();
    return deductionView(d, {});
  });
  const deductionIn = (campusId, empId, id) => {
    const emp = employeeIn(campusId, empId);
    return data().payrollDeductions.find((d) => d.id === id && d.employeeId === emp.id) || fail('Deduction not found.', 404);
  };
  route('PUT', '/api/hris/employees/:id/deductions/:dedId', 'hris:payroll.edit', ({ params, body, campusId, user }) => {
    const d = deductionIn(campusId, params.id, params.dedId);
    Object.assign(d, validateDeduction({ ...d, ...body }), { updatedAt: new Date().toISOString(), updatedBy: user.name });
    save();
    return deductionView(d, deductionsPaid(data()));
  });
  // A deduction already taken in a finalized payroll is ended instead (its history stays).
  route('DELETE', '/api/hris/employees/:id/deductions/:dedId', 'hris:payroll.edit', ({ params, campusId }) => {
    const d = deductionIn(campusId, params.id, params.dedId);
    if (deductionsPaid(data())[d.id]) fail('This deduction has been taken in a finalized payroll. Set its last month instead, so the record stays.');
    data().payrollDeductions = data().payrollDeductions.filter((x) => x.id !== d.id);
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
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => forViewer(user, e));
  });
  route('POST', '/api/hris/me/clock', 'hris', ({ user, body }) => {
    const res = clock(linkedEmployee(user), body.action, body, 'self');
    return { ...res, entry: forViewer(user, res.entry) };
  });
  route('GET', '/api/hris/me/payslips', 'hris', ({ user }) => {
    const emp = linkedEmployee(user);
    return data().payrollRuns
      .filter((r) => r.status === 'finalized')
      .flatMap((r) => r.payslips.filter((p) => p.employeeId === emp.id && (p.grossPay || !r.kind || r.kind === 'regular')).map((p) => ({ runId: r.id, name: r.name || '', kind: r.kind || 'regular', periodStart: r.periodStart, periodEnd: r.periodEnd, payDate: r.payDate, grossPay: p.grossPay, totalDeductions: p.totalDeductions, netPay: p.netPay })))
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  });
  route('GET', '/api/hris/me/payslips/:runId', 'hris', ({ user, params }) => {
    const emp = linkedEmployee(user);
    const run = data().payrollRuns.find((r) => r.id === params.runId && r.status === 'finalized');
    const payslip = run?.payslips.find((p) => p.employeeId === emp.id) || fail('Payslip not found.', 404);
    const { payslips, employeeIds, ...meta } = withCampus(run);
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
