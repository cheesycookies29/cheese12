import { randomUUID } from 'node:crypto';
import { computePayslip, toMinutes } from '../shared/calc.js';
import { HttpError, localDate, localTime } from './util.js';
import { demoData } from './seed.js';
import { emptyData, mergeSettings } from './db.js';

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
    notes: String(input.notes || '').trim(),
  };
  findEmployee(db, e.employeeId);
  if (!DATE_RE.test(e.date || '')) throw new HttpError(400, 'Date must be YYYY-MM-DD.');
  if (e.type === 'leave') {
    e.timeIn = e.timeOut = null;
    e.otApproved = false;
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

export function createApi(db) {
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, handler });
  };

  // ----- Settings -----
  route('GET', '/api/settings', () => db.data.settings);
  route('PUT', '/api/settings', ({ body }) => {
    const s = mergeSettings({ ...db.data.settings, ...body });
    s.payFrequency = s.payFrequency === 'monthly' ? 'monthly' : 'semi-monthly';
    s.workDaysPerYear = Number(s.workDaysPerYear) || 261;
    s.gracePeriodMinutes = Math.max(0, Number(s.gracePeriodMinutes) || 0);
    s.minimumOvertimeMinutes = Math.max(0, Number(s.minimumOvertimeMinutes) || 0);
    s.overtimeMultiplier = Number(s.overtimeMultiplier) || 1.25;
    s.restDayMultiplier = Number(s.restDayMultiplier) || 1.3;
    s.schedule = validateSchedule(s.schedule);
    s.contributions = Object.fromEntries(Object.entries(s.contributions).map(([k, v]) => [k, Boolean(v)]));
    db.data.settings = s;
    db.save();
    return s;
  });

  // ----- Employees -----
  route('GET', '/api/employees', () => db.data.employees);
  route('GET', '/api/employees/:id', ({ params }) => findEmployee(db, params.id));
  route('POST', '/api/employees', ({ body }) => {
    const emp = { id: randomUUID(), ...validateEmployee(body, db), createdAt: new Date().toISOString() };
    db.data.employees.push(emp);
    db.save();
    return emp;
  });
  route('PUT', '/api/employees/:id', ({ params, body }) => {
    const emp = findEmployee(db, params.id);
    Object.assign(emp, validateEmployee(body, db, emp.id), { updatedAt: new Date().toISOString() });
    db.save();
    return emp;
  });
  route('DELETE', '/api/employees/:id', ({ params }) => {
    findEmployee(db, params.id);
    db.data.employees = db.data.employees.filter((e) => e.id !== params.id);
    db.data.timeEntries = db.data.timeEntries.filter((e) => e.employeeId !== params.id);
    db.save();
    return { ok: true };
  });

  // ----- Time entries -----
  route('GET', '/api/time-entries', ({ query }) => {
    const { employeeId, from, to } = query;
    return db.data.timeEntries
      .filter((e) => (!employeeId || e.employeeId === employeeId) && (!from || e.date >= from) && (!to || e.date <= to))
      .sort((a, b) => b.date.localeCompare(a.date) || (a.timeIn || '').localeCompare(b.timeIn || ''));
  });
  route('POST', '/api/time-entries', ({ body }) => {
    const entry = { id: randomUUID(), ...validateEntry(body, db) };
    db.data.timeEntries.push(entry);
    db.save();
    return entry;
  });
  route('PUT', '/api/time-entries/:id', ({ params, body }) => {
    const entry = db.data.timeEntries.find((e) => e.id === params.id);
    if (!entry) throw new HttpError(404, 'Time entry not found.');
    Object.assign(entry, validateEntry(body, db, entry.id));
    db.save();
    return entry;
  });
  route('DELETE', '/api/time-entries/:id', ({ params }) => {
    db.data.timeEntries = db.data.timeEntries.filter((e) => e.id !== params.id);
    db.save();
    return { ok: true };
  });

  // Clock in / out for the current date and time.
  route('POST', '/api/clock', ({ body }) => {
    const emp = findEmployee(db, body.employeeId);
    if (emp.status !== 'Active') throw new HttpError(400, 'This employee is inactive.');
    const date = localDate();
    const time = localTime();
    const open = db.data.timeEntries.find((e) => e.employeeId === emp.id && e.type === 'work' && !e.timeOut);
    if (body.action === 'in') {
      if (open) throw new HttpError(400, `Already clocked in since ${open.date} ${open.timeIn}.`);
      const entry = { id: randomUUID(), ...validateEntry({ employeeId: emp.id, date, type: 'work', timeIn: time }, db) };
      db.data.timeEntries.push(entry);
      db.save();
      return { message: `${emp.firstName} clocked in at ${time}.`, entry };
    }
    if (body.action === 'out') {
      if (!open) throw new HttpError(400, 'Not clocked in.');
      if (time === open.timeIn && open.date === date) throw new HttpError(400, 'Clock out must be at least a minute after clock in.');
      open.timeOut = time;
      db.save();
      return { message: `${emp.firstName} clocked out at ${time}.`, entry: open };
    }
    throw new HttpError(400, 'Action must be "in" or "out".');
  });

  // ----- Payroll -----
  route('GET', '/api/payroll-runs', () =>
    db.data.payrollRuns.map(({ payslips, ...run }) => run).sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
  );
  route('GET', '/api/payroll-runs/:id', ({ params }) => findRun(db, params.id));
  route('POST', '/api/payroll-runs', ({ body }) => {
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
  route('POST', '/api/payroll-runs/:id/recompute', ({ params }) => {
    const run = findRun(db, params.id);
    assertDraft(run);
    computeRun(db, run);
    db.save();
    return run;
  });
  route('PUT', '/api/payroll-runs/:id/payslips/:employeeId', ({ params, body }) => {
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
  route('POST', '/api/payroll-runs/:id/finalize', ({ params }) => {
    const run = findRun(db, params.id);
    assertDraft(run);
    computeRun(db, run);
    run.status = 'finalized';
    run.finalizedAt = new Date().toISOString();
    db.save();
    return run;
  });
  route('DELETE', '/api/payroll-runs/:id', ({ params }) => {
    findRun(db, params.id);
    db.data.payrollRuns = db.data.payrollRuns.filter((r) => r.id !== params.id);
    db.save();
    return { ok: true };
  });

  // ----- Data management -----
  route('GET', '/api/admin/export', () => db.data);
  route('POST', '/api/admin/import', ({ body }) => {
    if (!body || !Array.isArray(body.employees) || !Array.isArray(body.timeEntries) || !Array.isArray(body.payrollRuns)) {
      throw new HttpError(400, 'That file is not a valid backup.');
    }
    db.replace(body);
    return { ok: true };
  });
  route('POST', '/api/admin/demo', () => (db.replace(demoData()), { ok: true }));
  route('POST', '/api/admin/reset', () => (db.replace(emptyData()), { ok: true }));

  return async function handle(req, url, body) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return r.handler({ params, body, query: Object.fromEntries(url.searchParams) });
    }
    throw new HttpError(404, 'Not found.');
  };
}
