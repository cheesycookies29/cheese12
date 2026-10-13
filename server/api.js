import { randomUUID } from 'node:crypto';
import { computePayslip, toMinutes } from '../shared/calc.js';
import { HttpError, localDate, localTime } from './util.js';
import { demoData } from './seed.js';
import { registerLeaveRoutes, findLeaveType } from './leave.js';
import { emptyData, mergeSettings } from './db.js';
import { ROLES, can } from '../shared/roles.js';
import {
  hashPassword, verifyPassword, validatePassword, publicUser, parseCookies, createSessions, createThrottle,
  sessionCookie, clearedCookie, SESSION_COOKIE,
} from './auth.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const EMPLOYEE_FIELDS = [
  'employeeNo', 'firstName', 'middleName', 'lastName', 'email', 'phone', 'birthDate', 'gender', 'civilStatus',
  'address', 'position', 'department', 'employmentStatus', 'hireDate', 'status', 'payType', 'rate', 'allowance',
  'minimumWageEarner', 'tin', 'sssNo', 'philhealthNo', 'pagibigNo', 'bankName', 'bankAccount',
  'emergencyContactName', 'emergencyContactPhone', 'schedule',
];

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}

function trimStrings(obj) {
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') obj[k] = v.trim();
  return obj;
}

function validateSchedule(s) {
  if (!TIME_RE.test(s.shiftStart || '') || !TIME_RE.test(s.shiftEnd || '')) throw new HttpError(400, 'Shift start and end must be HH:MM.');
  const workDays = (s.workDays || []).map(Number).filter((d) => d >= 0 && d <= 6);
  if (!workDays.length) throw new HttpError(400, 'Pick at least one work day.');
  return { shiftStart: s.shiftStart, shiftEnd: s.shiftEnd, breakMinutes: Math.max(0, Number(s.breakMinutes) || 0), workDays: [...new Set(workDays)].sort() };
}

function validateEmployee(input, db, existingId) {
  const e = trimStrings(pick(input, EMPLOYEE_FIELDS));
  for (const f of ['employeeNo', 'firstName', 'lastName', 'hireDate']) {
    if (!e[f]) throw new HttpError(400, `${f} is required.`);
  }
  if (!DATE_RE.test(e.hireDate)) throw new HttpError(400, 'Hire date must be YYYY-MM-DD.');
  if (e.birthDate && !DATE_RE.test(e.birthDate)) throw new HttpError(400, 'Birth date must be YYYY-MM-DD.');
  if (!['monthly', 'daily'].includes(e.payType)) throw new HttpError(400, 'Pay type must be monthly or daily.');
  e.rate = Number(e.rate);
  if (!(e.rate > 0)) throw new HttpError(400, 'Rate must be greater than zero.');
  e.allowance = Math.max(0, Number(e.allowance) || 0);
  e.minimumWageEarner = Boolean(e.minimumWageEarner);
  e.status = e.status === 'Inactive' ? 'Inactive' : 'Active';
  e.schedule = validateSchedule(e.schedule || db.data.settings.schedule);
  const dup = db.data.employees.find((x) => x.employeeNo.toLowerCase() === e.employeeNo.toLowerCase() && x.id !== existingId);
  if (dup) throw new HttpError(400, `Employee number ${e.employeeNo} is already used.`);
  return e;
}

function findEmployee(db, id) {
  const emp = db.data.employees.find((e) => e.id === id);
  if (!emp) throw new HttpError(404, 'Employee not found.');
  return emp;
}

function validateEntry(input, db, existingId) {
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
    notes: String(input.notes || '').trim(),
  };
  findEmployee(db, e.employeeId);
  if (!DATE_RE.test(e.date || '')) throw new HttpError(400, 'Date must be YYYY-MM-DD.');
  if (e.type === 'leave') {
    e.timeIn = e.timeOut = null;
    e.otApproved = false;
    // Leave entries without a type (older data) are treated as paid leave.
    if (input.leaveTypeId) {
      const type = findLeaveType(db, input.leaveTypeId);
      Object.assign(e, { leaveTypeId: type.id, paid: type.paid });
    } else e.paid = true;
  } else if (e.remote && !e.timeIn) {
    // A remote-work day without clock times counts as a full scheduled day.
    if (e.timeOut) throw new HttpError(400, 'Enter a time in, or leave both times blank for a full remote day.');
  } else {
    if (!TIME_RE.test(e.timeIn || '')) throw new HttpError(400, 'Time in must be HH:MM.');
    if (e.timeOut && !TIME_RE.test(e.timeOut)) throw new HttpError(400, 'Time out must be HH:MM.');
    if (e.timeOut && toMinutes(e.timeOut) === toMinutes(e.timeIn)) throw new HttpError(400, 'Time out must differ from time in.');
  }
  const dup = db.data.timeEntries.find((x) => x.employeeId === e.employeeId && x.date === e.date && x.id !== existingId);
  if (dup) throw new HttpError(400, 'This employee already has a record on that date. Edit it instead.');
  return e;
}

function findRun(db, id) {
  const run = db.data.payrollRuns.find((r) => r.id === id);
  if (!run) throw new HttpError(404, 'Payroll run not found.');
  return run;
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

function computeRun(db, run) {
  const { settings, employees, timeEntries } = db.data;
  const previous = new Map(run.payslips.map((p) => [p.employeeId, p.adjustments]));
  run.payslips = employees
    .filter((e) => run.employeeIds.includes(e.id))
    .map((employee) =>
      computePayslip({ employee, entries: timeEntries, periodStart: run.periodStart, periodEnd: run.periodEnd, settings, adjustments: previous.get(employee.id) }),
    )
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  run.payFrequency = settings.payFrequency;
  run.updatedAt = new Date().toISOString();
  return summarize(run);
}

function assertDraft(run) {
  if (run.status !== 'draft') throw new HttpError(400, 'This payroll run is finalized and can no longer be changed.');
}

function num(value, label, min, max) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} must be between ${min} and ${max}.`);
  return n;
}

function validateTaxTable(rows, label) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 15) throw new HttpError(400, `${label} tax table needs 1 to 15 brackets.`);
  const out = rows
    .map((r, i) => ({
      over: num(r.over, `${label} bracket ${i + 1} "over"`, 0, 1e9),
      base: num(r.base, `${label} bracket ${i + 1} base tax`, 0, 1e9),
      rate: num(r.rate, `${label} bracket ${i + 1} rate`, 0, 1),
    }))
    .sort((a, b) => a.over - b.over);
  if (out[0].over !== 0) throw new HttpError(400, `${label} tax table must start at 0.`);
  if (new Set(out.map((r) => r.over)).size !== out.length) throw new HttpError(400, `${label} tax table has two brackets with the same starting amount.`);
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
  if (s.rates.sss.minMsc >= s.rates.sss.maxMsc) throw new HttpError(400, 'SSS minimum salary credit must be below the maximum.');
  s.rates.philhealth = { rate: num(philhealth.rate, 'PhilHealth rate', 0, 1), floor: num(philhealth.floor, 'PhilHealth floor', 0, 1e7), ceiling: num(philhealth.ceiling, 'PhilHealth ceiling', 0, 1e7) };
  if (s.rates.philhealth.floor > s.rates.philhealth.ceiling) throw new HttpError(400, 'PhilHealth floor must not exceed the ceiling.');
  s.rates.pagibig = {
    eeRate: num(pagibig.eeRate, 'Pag-IBIG employee rate', 0, 1), eeLowRate: num(pagibig.eeLowRate, 'Pag-IBIG low-income rate', 0, 1),
    lowThreshold: num(pagibig.lowThreshold, 'Pag-IBIG low-income threshold', 0, 1e7), erRate: num(pagibig.erRate, 'Pag-IBIG employer rate', 0, 1),
    maxFundSalary: num(pagibig.maxFundSalary, 'Pag-IBIG maximum fund salary', 0, 1e7),
  };
  s.rates.tax = { 'semi-monthly': validateTaxTable(s.rates.tax['semi-monthly'], 'Semi-monthly'), monthly: validateTaxTable(s.rates.tax.monthly, 'Monthly') };
  return s;
}

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

function validateUser(input, db, existingId) {
  const u = {
    username: String(input.username || '').trim().toLowerCase(),
    name: String(input.name || '').trim(),
    role: input.role,
    employeeId: input.employeeId || null,
    active: input.active !== false,
  };
  if (!u.name) throw new HttpError(400, 'Name is required.');
  if (!USERNAME_RE.test(u.username)) throw new HttpError(400, 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.');
  if (db.data.users.some((x) => x.username === u.username && x.id !== existingId)) throw new HttpError(400, `Username "${u.username}" is already taken.`);
  if (!ROLES[u.role]) throw new HttpError(400, 'Pick a valid account type.');
  if (u.employeeId) {
    findEmployee(db, u.employeeId);
    const other = db.data.users.find((x) => x.employeeId === u.employeeId && x.id !== existingId);
    if (other) throw new HttpError(400, `That employee is already linked to the account "${other.username}".`);
  }
  if (u.role === 'employee' && !u.employeeId) throw new HttpError(400, 'Employee accounts must be linked to an employee record.');
  return u;
}

function findUser(db, id) {
  const user = db.data.users.find((u) => u.id === id);
  if (!user) throw new HttpError(404, 'User not found.');
  return user;
}

// Replace all data, then unlink accounts whose employee record no longer exists.
function replaceData(db, next) {
  db.replace(next);
  const ids = new Set(db.data.employees.map((e) => e.id));
  for (const u of db.data.users) if (u.employeeId && !ids.has(u.employeeId)) u.employeeId = null;
  db.save();
}

const DEMO_PASSWORD = 'demo1234';
const DEMO_ACCOUNTS = [['hr.demo', 'hr', 'Demo HR Manager'], ['payroll.demo', 'payroll', 'Demo Payroll Officer'], ['employee.demo', 'employee', null]];

function demoAccounts(db, employees) {
  const taken = new Set(db.data.users.map((u) => u.username));
  const juan = employees.find((e) => e.firstName === 'Juan') || employees[0];
  return DEMO_ACCOUNTS.filter(([username]) => !taken.has(username)).map(([username, role, name]) => ({
    id: randomUUID(),
    username,
    name: name || `${juan.firstName} ${juan.lastName}`,
    role,
    employeeId: role === 'employee' ? juan.id : null,
    active: true,
    mustChangePassword: false,
    demo: true,
    passwordHash: hashPassword(DEMO_PASSWORD),
    createdAt: new Date().toISOString(),
  }));
}

// Clock in / out for the current date and time.
function clock(db, emp, action) {
  if (emp.status !== 'Active') throw new HttpError(400, 'This employee is inactive.');
  const date = localDate();
  const time = localTime();
  const open = db.data.timeEntries.find((e) => e.employeeId === emp.id && e.type === 'work' && e.timeIn && !e.timeOut);
  if (action === 'in') {
    if (open) throw new HttpError(400, `Already clocked in since ${open.date} ${open.timeIn}.`);
    // An approved remote day can still be clocked, to record actual hours.
    const remoteDay = db.data.timeEntries.find((e) => e.employeeId === emp.id && e.date === date && e.remote && !e.timeIn);
    if (remoteDay) {
      remoteDay.timeIn = time;
      db.save();
      return { message: `${emp.firstName} clocked in at ${time} (remote work).`, entry: remoteDay };
    }
    const entry = { id: randomUUID(), ...validateEntry({ employeeId: emp.id, date, type: 'work', timeIn: time }, db) };
    db.data.timeEntries.push(entry);
    db.save();
    return { message: `${emp.firstName} clocked in at ${time}.`, entry };
  }
  if (action === 'out') {
    if (!open) throw new HttpError(400, 'Not clocked in.');
    if (time === open.timeIn && open.date === date) throw new HttpError(400, 'Clock out must be at least a minute after clock in.');
    open.timeOut = time;
    db.save();
    return { message: `${emp.firstName} clocked out at ${time}.`, entry: open };
  }
  throw new HttpError(400, 'Action must be "in" or "out".');
}

export function createApi(db) {
  const routes = [];
  const sessions = createSessions();
  const throttle = createThrottle();
  // permission: 'public', 'auth' (any signed-in user) or a permission from shared/roles.js
  const route = (method, pattern, permission, handler, { duringPasswordChange = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, permission, handler, duringPasswordChange });
  };
  const users = () => db.data.users;
  const activeAdmins = () => users().filter((u) => u.role === 'admin' && u.active);

  function startSession(user) {
    user.lastLoginAt = new Date().toISOString();
    db.save();
    return { data: { user: publicUser(user) }, headers: { 'Set-Cookie': sessionCookie(sessions.create(user.id)) } };
  }

  function linkedEmployee(user) {
    const emp = user.employeeId && db.data.employees.find((e) => e.id === user.employeeId);
    if (!emp) throw new HttpError(400, 'Your account is not linked to an employee record. Ask an administrator to link it.');
    return emp;
  }

  // ----- Sign in -----
  route('GET', '/api/auth/status', 'public', ({ user }) => ({ setupRequired: users().length === 0, user: publicUser(user) }));
  route('POST', '/api/auth/setup', 'public', ({ body }) => {
    if (users().length) throw new HttpError(400, 'Setup is already complete. Please sign in.');
    const user = { id: randomUUID(), ...validateUser({ ...body, role: 'admin', active: true }, db), mustChangePassword: false };
    validatePassword(body.password);
    user.passwordHash = hashPassword(body.password);
    user.createdAt = new Date().toISOString();
    users().push(user);
    return startSession(user);
  });
  route('POST', '/api/auth/login', 'public', ({ body }) => {
    const username = String(body.username || '').trim().toLowerCase();
    throttle.check(username);
    const user = users().find((u) => u.username === username);
    if (!verifyPassword(String(body.password || ''), user?.passwordHash) || !user.active) {
      throttle.fail(username);
      throw new HttpError(401, user && !user.active ? 'This account is disabled. Contact your administrator.' : 'Incorrect username or password.');
    }
    throttle.reset(username);
    return startSession(user);
  });
  route('POST', '/api/auth/logout', 'auth', ({ token }) => {
    sessions.destroy(token);
    return { data: { ok: true }, headers: { 'Set-Cookie': clearedCookie } };
  }, { duringPasswordChange: true });
  route('POST', '/api/auth/change-password', 'auth', ({ user, token, body }) => {
    if (!verifyPassword(String(body.currentPassword || ''), user.passwordHash)) throw new HttpError(400, 'Your current password is incorrect.');
    validatePassword(body.newPassword);
    if (body.newPassword === body.currentPassword) throw new HttpError(400, 'Choose a password different from the current one.');
    user.passwordHash = hashPassword(body.newPassword);
    user.mustChangePassword = false;
    sessions.destroyForUser(user.id, token);
    db.save();
    return { user: publicUser(user) };
  }, { duringPasswordChange: true });

  // ----- User accounts -----
  route('GET', '/api/users', 'users.manage', () => users().map(publicUser));
  route('POST', '/api/users', 'users.manage', ({ body }) => {
    const user = { id: randomUUID(), ...validateUser(body, db) };
    validatePassword(body.password);
    user.passwordHash = hashPassword(body.password);
    user.mustChangePassword = body.mustChangePassword !== false;
    user.createdAt = new Date().toISOString();
    users().push(user);
    db.save();
    return publicUser(user);
  });
  route('PUT', '/api/users/:id', 'users.manage', ({ params, body, user: me }) => {
    const user = findUser(db, params.id);
    const next = validateUser(body, db, user.id);
    if (user.id === me.id && (next.role !== user.role || !next.active)) throw new HttpError(400, 'You cannot change your own role or disable your own account.');
    if (user.role === 'admin' && user.active && (next.role !== 'admin' || !next.active) && activeAdmins().length === 1) {
      throw new HttpError(400, 'There must be at least one active administrator.');
    }
    Object.assign(user, next, { updatedAt: new Date().toISOString() });
    if (!user.active) sessions.destroyForUser(user.id);
    db.save();
    return publicUser(user);
  });
  route('POST', '/api/users/:id/reset-password', 'users.manage', ({ params, body }) => {
    const user = findUser(db, params.id);
    validatePassword(body.password);
    user.passwordHash = hashPassword(body.password);
    user.mustChangePassword = true;
    sessions.destroyForUser(user.id);
    db.save();
    return publicUser(user);
  });
  route('DELETE', '/api/users/:id', 'users.manage', ({ params, user: me }) => {
    const user = findUser(db, params.id);
    if (user.id === me.id) throw new HttpError(400, 'You cannot delete your own account.');
    if (user.role === 'admin' && user.active && activeAdmins().length === 1) throw new HttpError(400, 'There must be at least one active administrator.');
    db.data.users = users().filter((u) => u.id !== user.id);
    sessions.destroyForUser(user.id);
    db.save();
    return { ok: true };
  });

  // ----- Employee self-service -----
  route('GET', '/api/me/profile', 'self', ({ user }) => linkedEmployee(user));
  route('GET', '/api/me/time-entries', 'self', ({ user, query }) => {
    const emp = linkedEmployee(user);
    return db.data.timeEntries
      .filter((e) => e.employeeId === emp.id && (!query.from || e.date >= query.from) && (!query.to || e.date <= query.to))
      .sort((a, b) => b.date.localeCompare(a.date));
  });
  route('POST', '/api/me/clock', 'self', ({ user, body }) => clock(db, linkedEmployee(user), body.action));
  route('GET', '/api/me/payslips', 'self', ({ user }) => {
    const emp = linkedEmployee(user);
    return db.data.payrollRuns
      .filter((r) => r.status === 'finalized')
      .flatMap((r) => r.payslips.filter((p) => p.employeeId === emp.id).map((p) => ({ runId: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, payDate: r.payDate, grossPay: p.grossPay, totalDeductions: p.totalDeductions, netPay: p.netPay })))
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  });
  route('GET', '/api/me/payslips/:runId', 'self', ({ user, params }) => {
    const emp = linkedEmployee(user);
    const run = db.data.payrollRuns.find((r) => r.id === params.runId && r.status === 'finalized');
    const payslip = run?.payslips.find((p) => p.employeeId === emp.id);
    if (!payslip) throw new HttpError(404, 'Payslip not found.');
    const { payslips, employeeIds, ...meta } = run;
    return { run: meta, payslip };
  });

  registerLeaveRoutes(route, db, { linkedEmployee });

  // ----- Settings -----
  route('GET', '/api/settings', 'auth', () => db.data.settings);
  // Company details and default schedule (Administrator).
  route('PUT', '/api/settings', 'settings.edit', ({ body }) => {
    const s = db.data.settings;
    for (const k of ['companyName', 'companyAddress', 'companyTin']) if (k in body) s[k] = String(body[k] || '').trim();
    if (!s.companyName) throw new HttpError(400, 'Company name is required.');
    if (body.schedule) s.schedule = validateSchedule(body.schedule);
    db.save();
    return s;
  });

  // Payroll Setup: pay rules, deductions, government rates and tax tables (HR, Payroll, Administrator).
  route('PUT', '/api/payroll-config', 'payroll.config', ({ body, user }) => {
    const s = db.data.settings;
    const next = mergeSettings({ ...s, ...pick(body, ['payFrequency', 'workDaysPerYear', 'gracePeriodMinutes', 'minimumOvertimeMinutes', 'overtimeMultiplier', 'restDayMultiplier', 'contributions', 'rates']) });
    db.data.settings = { ...validatePayrollConfig(next), payrollConfigUpdatedAt: new Date().toISOString(), payrollConfigUpdatedBy: user.name };
    db.save();
    return db.data.settings;
  });

  // ----- Employees -----
  route('GET', '/api/employees', 'employees.view', () => db.data.employees);
  route('GET', '/api/employees/:id', 'employees.view', ({ params }) => findEmployee(db, params.id));
  route('POST', '/api/employees', 'employees.edit', ({ body }) => {
    const emp = { id: randomUUID(), ...validateEmployee(body, db), createdAt: new Date().toISOString() };
    db.data.employees.push(emp);
    db.save();
    return emp;
  });
  route('PUT', '/api/employees/:id', 'employees.edit', ({ params, body }) => {
    const emp = findEmployee(db, params.id);
    Object.assign(emp, validateEmployee(body, db, emp.id), { updatedAt: new Date().toISOString() });
    db.save();
    return emp;
  });
  route('DELETE', '/api/employees/:id', 'employees.edit', ({ params }) => {
    findEmployee(db, params.id);
    db.data.employees = db.data.employees.filter((e) => e.id !== params.id);
    db.data.timeEntries = db.data.timeEntries.filter((e) => e.employeeId !== params.id);
    db.data.requests = db.data.requests.filter((r) => r.employeeId !== params.id);
    db.data.leaveCredits = db.data.leaveCredits.filter((c) => c.employeeId !== params.id);
    for (const u of db.data.users) if (u.employeeId === params.id) u.employeeId = null;
    db.save();
    return { ok: true };
  });

  // ----- Time entries -----
  route('GET', '/api/time-entries', 'attendance.view', ({ query }) => {
    const { employeeId, from, to } = query;
    return db.data.timeEntries
      .filter((e) => (!employeeId || e.employeeId === employeeId) && (!from || e.date >= from) && (!to || e.date <= to))
      .sort((a, b) => b.date.localeCompare(a.date) || (a.timeIn || '').localeCompare(b.timeIn || ''));
  });
  route('POST', '/api/time-entries', 'attendance.edit', ({ body }) => {
    const entry = { id: randomUUID(), ...validateEntry(body, db) };
    db.data.timeEntries.push(entry);
    db.save();
    return entry;
  });
  route('PUT', '/api/time-entries/:id', 'attendance.edit', ({ params, body }) => {
    const entry = db.data.timeEntries.find((e) => e.id === params.id);
    if (!entry) throw new HttpError(404, 'Time entry not found.');
    Object.assign(entry, validateEntry(body, db, entry.id));
    db.save();
    return entry;
  });
  route('DELETE', '/api/time-entries/:id', 'attendance.edit', ({ params }) => {
    db.data.timeEntries = db.data.timeEntries.filter((e) => e.id !== params.id);
    db.save();
    return { ok: true };
  });

  route('POST', '/api/clock', 'clock.kiosk', ({ body }) => clock(db, findEmployee(db, body.employeeId), body.action));

  // ----- Payroll -----
  route('GET', '/api/payroll-runs', 'payroll.view', () =>
    db.data.payrollRuns.map(({ payslips, ...run }) => run).sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
  );
  route('GET', '/api/payroll-runs/:id', 'payroll.view', ({ params }) => findRun(db, params.id));
  route('POST', '/api/payroll-runs', 'payroll.edit', ({ body }) => {
    const { periodStart, periodEnd, payDate } = body;
    if (!DATE_RE.test(periodStart || '') || !DATE_RE.test(periodEnd || '')) throw new HttpError(400, 'Pick a valid pay period.');
    if (periodEnd < periodStart) throw new HttpError(400, 'Period end must be on or after period start.');
    const employeeIds = db.data.employees.filter((e) => e.status === 'Active' && e.hireDate <= periodEnd).map((e) => e.id);
    if (!employeeIds.length) throw new HttpError(400, 'There are no active employees for this period.');
    const run = {
      id: randomUUID(),
      periodStart,
      periodEnd,
      payDate: DATE_RE.test(payDate || '') ? payDate : periodEnd,
      status: 'draft',
      employeeIds,
      payslips: [],
      createdAt: new Date().toISOString(),
    };
    computeRun(db, run);
    db.data.payrollRuns.push(run);
    db.save();
    return run;
  });
  route('POST', '/api/payroll-runs/:id/recompute', 'payroll.edit', ({ params }) => {
    const run = findRun(db, params.id);
    assertDraft(run);
    computeRun(db, run);
    db.save();
    return run;
  });
  route('PUT', '/api/payroll-runs/:id/payslips/:employeeId', 'payroll.edit', ({ params, body }) => {
    const run = findRun(db, params.id);
    assertDraft(run);
    const slip = run.payslips.find((p) => p.employeeId === params.employeeId);
    if (!slip) throw new HttpError(404, 'Payslip not found.');
    slip.adjustments = {
      otherEarnings: Math.max(0, Number(body.otherEarnings) || 0),
      otherDeductions: Math.max(0, Number(body.otherDeductions) || 0),
      remarks: String(body.remarks || '').trim(),
    };
    computeRun(db, run);
    db.save();
    return run;
  });
  route('POST', '/api/payroll-runs/:id/finalize', 'payroll.edit', ({ params }) => {
    const run = findRun(db, params.id);
    assertDraft(run);
    computeRun(db, run);
    run.status = 'finalized';
    run.finalizedAt = new Date().toISOString();
    db.save();
    return run;
  });
  route('DELETE', '/api/payroll-runs/:id', 'payroll.edit', ({ params }) => {
    findRun(db, params.id);
    db.data.payrollRuns = db.data.payrollRuns.filter((r) => r.id !== params.id);
    db.save();
    return { ok: true };
  });

  // ----- Data management -----
  route('GET', '/api/admin/export', 'data.manage', () => db.data);
  route('POST', '/api/admin/import', 'data.manage', ({ body }) => {
    if (!body || !Array.isArray(body.employees) || !Array.isArray(body.timeEntries) || !Array.isArray(body.payrollRuns)) {
      throw new HttpError(400, 'That file is not a valid backup.');
    }
    // Keep the current accounts unless the backup carries its own.
    replaceData(db, { ...body, users: Array.isArray(body.users) && body.users.length ? body.users : users() });
    return { ok: true };
  });
  route('POST', '/api/admin/demo', 'data.manage', () => {
    const data = demoData();
    replaceData(db, { ...data, users: users().filter((u) => !u.demo) });
    db.data.users.push(...demoAccounts(db, data.employees));
    db.save();
    return { ok: true, demoAccounts: DEMO_ACCOUNTS.map(([username, role]) => ({ username, role })), demoPassword: DEMO_PASSWORD };
  });
  route('POST', '/api/admin/reset', 'data.manage', () => {
    replaceData(db, { ...emptyData(), users: users().filter((u) => !u.demo) });
    return { ok: true };
  });

  // Returns { data, headers }.
  return async function handle(req, url, body) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = sessions.get(token);
    const user = session && users().find((u) => u.id === session.userId && u.active);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      if (r.permission !== 'public') {
        if (!user) throw new HttpError(401, 'Please sign in.');
        if (user.mustChangePassword && !r.duringPasswordChange) throw new HttpError(403, 'Please change your password first.');
        if (r.permission !== 'auth' && !can(user.role, r.permission)) throw new HttpError(403, 'Your account does not have access to this.');
      }
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const result = await r.handler({ params, body, query: Object.fromEntries(url.searchParams), user, token });
      return result && result.headers && 'data' in result ? result : { data: result, headers: {} };
    }
    throw new HttpError(404, 'Not found.');
  };
}
