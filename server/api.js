import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import { computePayslip, toMinutes } from '../shared/calc.js';
import { DAY_TYPES } from '../shared/holidays.js';
import { HttpError, localDate, localTime, notOwnRecord } from './util.js';
import { registerLeaveRoutes, findLeaveType, migrateLeaveTypes } from './leave.js';
import { createAttachments, parseUpload } from './attachments.js';
import { registerFeedbackRoutes, cleanFeedback } from './feedback.js';
import { clockInLocation, forViewer, purgeOldLocations, registerGeoRoutes } from './geo.js';
import { registerHelpdeskRoutes, migrateHelpdesk, keepHelpdeskConfig, linkTicketOwners } from './helpdesk.js';
import { registerCrmRoutes, migrateCrm, keepCrmConfig } from './crm.js';
import { registerPdfStudio } from './tools-pdf.js';
import { registerDocuments } from './documents.js';
import { registerForms } from './forms.js';
import { docToPdf } from './pdf/layout.js';
import { documentText } from './documents-text.js';
import { registerProjectRoutes, migratePm, keepPmConfig, isProjectMember, removeUserFromProjects, timesheetAccess } from './projects.js';
import { registerNotificationRoutes, migrateNotifications, notify, forgetUser, accountOfEmployee, fmtRange } from './notifications.js';
import { migrateApprovals, isApprover } from './approvals.js';
import { registerHolidayRoutes, migrateHolidays } from './holidays.js';
import { createAudit, withActor, currentActor, diff, flatten, mask, MASKED_FIELDS } from './audit.js';
import { registerLedgerRoutes, syncLedger, postRun, voidRunRows, yearTotals } from './ledger.js';
import { registerGuideRoutes } from './guides.js';
import { areaOfPath } from '../shared/audit.js';
import { createSecrets } from './secrets.js';
import { createRateLimiter } from './ratelimit.js';
import { securitySettings, validateSecuritySettings, twoFactorRequired, TWO_FACTOR_POLICIES } from './security.js';
import { newSecret, verifyCode, otpauthUrl, newRecoveryCodes, hashRecovery, looksLikeRecovery } from './totp.js';
import { addDemo, removeDemo, hasDemo, demoCounts } from './demo.js';
import { registerAssetRoutes } from './assets.js';
import { emptyData, mergeSettings } from './db.js';
import { ROLES, userCan, setRoleOverrides, cleanOverrides, roleOverrides, usesAdminPanel, confinedTo } from '../shared/roles.js';
import { cleanCompanyRole, companyRoleOf, moduleAccess } from '../shared/profile.js';
import { moduleOfApi, moduleOn, moduleName, cleanModuleConfig, cleanFavoriteModules } from '../shared/modules.js';
import { registerAdminRoutes } from './config.js';
import { validateBranding, publicBrand, settingsForBrowser } from './branding.js';
import {
  hashPassword, verifyPassword, validatePassword, publicUser, parseCookies, createSessions, createThrottle,
  sessionCookie, clearedCookie, SESSION_COOKIE,
} from './auth.js';
import { APP_VERSION } from '../shared/devlog.js';
import { buildInfo } from './build.js';
import { createMonitor } from './monitor.js';
import { registerMonitorRoutes } from './monitor-panel.js';
import { syncDevlog, registerDevlogRoutes } from './devlog.js';
import { registerCustomApp } from './customapp/index.js';
import { CA_COLLECTIONS } from './customapp/events/model.js';
import { addDemoEvent, removeDemoEvents } from './customapp/events/demo.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Changes that are records in themselves, or not about company data: no generic audit entry.
const USER_AUDIT_FIELDS = ['name', 'username', 'role', 'companyRole', 'active', 'employeeId', 'helpdeskAgent', 'crmAccess', 'pmAccess', 'mustChangePassword'];
const UNAUDITED = /^\/api\/(me\/clock|clock|auth\/logout|feedback|me\/feedback|public\/)/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const EMPLOYEE_FIELDS = [
  'employeeNo', 'firstName', 'middleName', 'lastName', 'email', 'phone', 'birthDate', 'gender', 'civilStatus',
  'address', 'position', 'department', 'employmentStatus', 'hireDate', 'status', 'payType', 'rate', 'allowance',
  'minimumWageEarner', 'flexTime', 'tin', 'sssNo', 'philhealthNo', 'pagibigNo', 'bankName', 'bankAccount',
  'emergencyContactName', 'emergencyContactPhone', 'schedule', 'supervisorId', 'workDaysPerYear'];

// Pay, government IDs and bank details: only accounts with employees.sensitive receive them.
const PAY_ADJUST_MAX = 100_000_000; // per payslip adjustment, in pesos
// Fields of your own record that someone else changes (see notOwnRecord).
const OWN_LOCKED_FIELDS = ['rate', 'allowance', 'payType', 'minimumWageEarner', 'workDaysPerYear', 'schedule', 'flexTime', 'status', 'employmentStatus', 'supervisorId'];
const SENSITIVE_FIELDS = ['rate', 'allowance', 'minimumWageEarner', 'workDaysPerYear', 'tin', 'sssNo', 'philhealthNo', 'pagibigNo', 'bankName', 'bankAccount'];
const PRIVATE_FIELDS = ['tin', 'sssNo', 'philhealthNo', 'pagibigNo', 'bankName', 'bankAccount'];
// What an account may see of an employee record. Government ID and bank numbers are masked even
// for HR and payroll; the full numbers come from /private, which is logged.
// Personal details (birth date, home address, private phone, emergency contact) are for the HR side
// (VAPT 0.33): accounts that keep records or leave, or see pay. Others who view employee records
// (a Project Manager choosing people) get the name, position, department and work email.
const PERSONAL_FIELDS = ['birthDate', 'gender', 'civilStatus', 'address', 'phone', 'emergencyContactName', 'emergencyContactPhone'];
const seesPersonal = (user) => ['employees.edit', 'employees.sensitive', 'leave.manage'].some((p) => userCan(user, p));
function employeeFor(user, e) {
  const out = { ...e };
  if (!seesPersonal(user)) {
    for (const f of PERSONAL_FIELDS) delete out[f];
    out.personalHidden = true;
  }
  if (!userCan(user, 'employees.sensitive')) {
    for (const f of SENSITIVE_FIELDS) delete out[f];
    out.restricted = true;
    return out;
  }
  for (const f of MASKED_FIELDS) if (out[f]) out[f] = mask(out[f]);
  return out;
}

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
  // A masked number sent back unchanged (e.g. "••••1234") keeps the number on record.
  const before = existingId && db.data.employees.find((x) => x.id === existingId);
  for (const f of MASKED_FIELDS) if (typeof e[f] === 'string' && e[f].startsWith('••••')) e[f] = before?.[f] || '';
  for (const f of ['employeeNo', 'firstName', 'lastName', 'hireDate']) {
    if (!e[f]) throw new HttpError(400, `${f} is required.`);
    if (typeof e[f] !== 'string') throw new HttpError(400, `Write ${f} as text.`);
  }
  if (!DATE_RE.test(e.hireDate)) throw new HttpError(400, 'Hire date must be YYYY-MM-DD.');
  if (e.birthDate && !DATE_RE.test(e.birthDate)) throw new HttpError(400, 'Birth date must be YYYY-MM-DD.');
  if (!['monthly', 'daily'].includes(e.payType)) throw new HttpError(400, 'Pay type must be monthly or daily.');
  e.rate = Number(e.rate);
  if (!(e.rate > 0)) throw new HttpError(400, 'Rate must be greater than zero.');
  e.allowance = Math.max(0, Number(e.allowance) || 0);
  e.minimumWageEarner = Boolean(e.minimumWageEarner);
  e.flexTime = Boolean(e.flexTime);
  // Own daily-rate factor (e.g. 313 for a 6-day week); empty = the company default.
  e.workDaysPerYear = e.workDaysPerYear === '' || e.workDaysPerYear == null ? null : Math.round(Number(e.workDaysPerYear));
  if (e.workDaysPerYear !== null && !(e.workDaysPerYear >= 200 && e.workDaysPerYear <= 366)) throw new HttpError(400, 'Work days per year must be between 200 and 366, or empty for the company default.');
  e.status = e.status === 'Inactive' ? 'Inactive' : 'Active';
  e.schedule = validateSchedule(e.schedule || db.data.settings.schedule);
  const dup = db.data.employees.find((x) => x.employeeNo.toLowerCase() === e.employeeNo.toLowerCase() && x.id !== existingId);
  if (dup) throw new HttpError(400, `Employee number ${e.employeeNo} is already used.`);
  // One email address per person: email that arrives for the service desk is matched to an account by it.
  if (e.email) {
    const same = db.data.employees.find((x) => x.email && x.email.toLowerCase() === e.email.toLowerCase() && x.id !== existingId);
    if (same) throw new HttpError(400, `The email ${e.email} is already on ${same.firstName} ${same.lastName}'s record. Each employee needs their own.`);
  }
  // Immediate supervisor: the first approver of this employee's requests. No loops (A → B → A).
  e.supervisorId = e.supervisorId || null;
  if (e.supervisorId) {
    if (e.supervisorId === existingId) throw new HttpError(400, 'An employee cannot be their own supervisor.');
    const byId = new Map(db.data.employees.map((x) => [x.id, x]));
    if (!byId.has(e.supervisorId)) throw new HttpError(400, 'Pick the immediate supervisor from the employee list.');
    for (let at = byId.get(e.supervisorId), hops = 0; at && hops < 50; at = byId.get(at.supervisorId), hops++) {
      if (existingId && at.id === existingId) throw new HttpError(400, `That would make a loop: ${at.firstName} ${at.lastName} already reports, directly or not, to this employee.`);
    }
  }
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
      computePayslip({ employee, entries: timeEntries, periodStart: run.periodStart, periodEnd: run.periodEnd, settings, holidays: db.data.holidays, adjustments: previous.get(employee.id) }),
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
  s.premiums = Object.fromEntries(Object.entries(DAY_TYPES).map(([k, label]) => {
    const p = s.premiums[k];
    const day = k === 'ordinary' ? 1 : num(p.day, `${label}: first 8 hours`, 1, 10);
    return [k, { day, overtime: num(p.overtime, `${label}: overtime`, 1, 15) }];
  }));
  s.nightDiff = { rate: num(s.nightDiff.rate, 'Night differential', 0, 1), start: s.nightDiff.start, end: s.nightDiff.end };
  if (!TIME_RE.test(s.nightDiff.start || '') || !TIME_RE.test(s.nightDiff.end || '') || s.nightDiff.start === s.nightDiff.end) throw new HttpError(400, 'Give the night shift hours as two different times, e.g. 22:00 to 06:00.');
  s.holidayPay = { requirePresentBefore: s.holidayPay.requirePresentBefore !== false, specialNotWorked: s.holidayPay.specialNotWorked === 'unpaid' ? 'unpaid' : 'paid' };
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

// The visitor's address. Behind the local HTTPS proxy (Caddy) it comes from X-Forwarded-For, and
// that header is read only when the request comes from this machine. A visitor can send the
// header too, and a proxy adds the address it saw after theirs: so the last entry, the one the
// nearest proxy wrote, is the address, and whatever comes before it is ignored.
// VAPT 0.39 (A3-1): only where CORE is set up behind that proxy (TRUST_PROXY=1, or COOKIE_SECURE=1
// as the AWS set-up has). Elsewhere (an office PC) any program on the same computer could otherwise
// name any address, to frame one on the Security monitor or to slip past the per-address limits.
export const trustsProxy = () => process.env.TRUST_PROXY === '1' || process.env.COOKIE_SECURE === '1';
export function clientIp(req) {
  const remote = req.socket?.remoteAddress || '';
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded && trustsProxy() && /^(127\.|::1$|::ffff:127\.)/.test(remote)) {
    const last = String(forwarded).split(',').pop().trim();
    if (last) return last;
  }
  return remote || 'local';
}

// A user account as a backup may carry it: only the fields CORE itself writes, each of the right
// kind. Anything else in the file is dropped; a wrong value refuses the whole restore.
const PASSWORD_HASH_RE = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/;
const isText = (v, max = 400) => typeof v === 'string' && v.length <= max;
const optional = (v, ok) => v === undefined || v === null || ok(v);
function validTwoFactor(tf) {
  if (!tf || typeof tf !== 'object' || Array.isArray(tf)) return null;
  if (!isText(tf.secret) || !isText(tf.enabledAt, 40) || !optional(tf.lastStep, Number.isInteger) || !Array.isArray(tf.recovery) || tf.recovery.length > 20) return null;
  if (!tf.recovery.every((r) => r && isText(r.hash, 128) && optional(r.usedAt, (v) => isText(v, 40)))) return null;
  return { secret: tf.secret, enabledAt: tf.enabledAt, lastStep: tf.lastStep ?? -1, recovery: tf.recovery.map((r) => ({ hash: r.hash, usedAt: r.usedAt ?? null })) };
}
function backupUsers(list) {
  const bad = (i, why) => new HttpError(400, `That backup cannot be restored: user account ${i + 1} ${why}. Nothing was changed.`);
  const out = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad(i, 'is not an account');
    if (!isText(raw.id, 64) || !raw.id) throw bad(i, 'has no valid id');
    if (typeof raw.username !== 'string' || !USERNAME_RE.test(raw.username) || raw.username !== raw.username.toLowerCase()) throw bad(i, 'has an invalid username');
    if (!isText(raw.name, 200) || !raw.name.trim()) throw bad(i, 'has no name');
    if (!Object.hasOwn(ROLES, raw.role)) throw bad(i, 'has an unknown account type');
    if (typeof raw.active !== 'boolean') throw bad(i, 'does not say whether it is active');
    if (typeof raw.passwordHash !== 'string' || !PASSWORD_HASH_RE.test(raw.passwordHash)) throw bad(i, 'has an invalid password hash');
    if (!optional(raw.employeeId, (v) => isText(v, 64))) throw bad(i, 'has an invalid employee link');
    for (const k of ['mustChangePassword', 'helpdeskAgent', 'crmAccess', 'pmAccess', 'pmDigest', 'demo']) if (!optional(raw[k], (v) => typeof v === 'boolean')) throw bad(i, `has an invalid "${k}"`);
    for (const k of ['createdAt', 'lastLoginAt']) if (!optional(raw[k], (v) => isText(v, 40))) throw bad(i, `has an invalid "${k}"`);
    const u = { id: raw.id, username: raw.username, name: raw.name.trim(), role: raw.role, employeeId: raw.employeeId || null, active: raw.active, passwordHash: raw.passwordHash };
    for (const k of ['mustChangePassword', 'helpdeskAgent', 'crmAccess', 'pmAccess', 'pmDigest', 'demo', 'createdAt', 'lastLoginAt']) if (raw[k] !== undefined && raw[k] !== null) u[k] = raw[k];
    // Modules pinned to the front of the CORE home (0.40): unknown ones are dropped, not refused.
    const pinned = cleanFavoriteModules(raw.favoriteModules);
    if (pinned?.length) u.favoriteModules = pinned;
    // Favorite projects (0.51): ids kept as they are; the ones gone or out of reach are skipped on read.
    if (Array.isArray(raw.favoriteProjects)) {
      const favs = [...new Set(raw.favoriteProjects.filter((x) => isText(x, 64)))].slice(0, 50);
      if (favs.length) u.favoriteProjects = favs;
    }
    // The role in the company (0.32): kept as cleaned text.
    if (raw.companyRole !== undefined && raw.companyRole !== null) {
      let role;
      try {
        role = cleanCompanyRole(raw.companyRole);
      } catch {
        throw bad(i, 'has an invalid role in the company');
      }
      if (role) u.companyRole = role;
    }
    if (raw.twoFactor !== undefined && raw.twoFactor !== null) {
      u.twoFactor = validTwoFactor(raw.twoFactor);
      if (!u.twoFactor) throw bad(i, 'has invalid 2-step verification details');
    }
    if (raw.twoFactorPending !== undefined && raw.twoFactorPending !== null) {
      const p = raw.twoFactorPending;
      if (typeof p !== 'object' || !isText(p.secret) || !isText(p.createdAt, 40)) throw bad(i, 'has invalid 2-step verification details');
      u.twoFactorPending = { secret: p.secret, createdAt: p.createdAt };
    }
    if (out.some((x) => x.username === u.username)) throw bad(i, `repeats the username "${u.username}"`);
    if (out.some((x) => x.id === u.id)) throw bad(i, 'repeats the id of another account');
    out.push(u);
  });
  if (!out.some((u) => u.role === 'admin' && u.active)) throw new HttpError(400, 'That backup cannot be restored: it has no active Administrator account. Nothing was changed.');
  return out;
}

// Whether the visitor reached CORE over HTTPS: directly, or through the HTTPS proxy on this computer.
function isHttps(req) {
  const local = /^(127\.|::1$|::ffff:127\.)/.test(req.socket?.remoteAddress || '');
  return Boolean(req.socket?.encrypted) || (local && req.headers?.['x-forwarded-proto'] === 'https');
}

// The address people use to reach the app, e.g. https://erp.company.com, for links in emails.
function publicOrigin(req) {
  const local = /^(127\.|::1$|::ffff:127\.)/.test(req.socket?.remoteAddress || '');
  const proto = local && req.headers?.['x-forwarded-proto'] === 'https' ? 'https' : req.socket?.encrypted ? 'https' : 'http';
  return `${proto}://${req.headers?.host || 'localhost'}`;
}

// One-time changes to company settings that a release brings. Each runs once per database;
// afterwards the setting can be changed in Payroll Setup as usual.
const POLICY_UPDATES = [
  ['work-days-312', (s) => (s.workDaysPerYear = 312)],
];
function applyPolicyUpdates(db) {
  const s = db.data.settings;
  s.appliedUpdates ||= [];
  let changed = false;
  for (const [id, apply] of POLICY_UPDATES) {
    if (s.appliedUpdates.includes(id)) continue;
    apply(s);
    s.appliedUpdates.push(id);
    changed = true;
  }
  return changed;
}

// Replace all data, then unlink accounts whose employee record no longer exists.
// keepAdmin: keep the company's changes to the account types and which modules are on (erasing
// all data keeps the accounts, so it keeps what they may do).
// Event data (CUSTOM APP, 0.71): while this server holds an event (not just the demo one), its event
// collections are always kept as they are: a restore, "Erase all data" or demo data must never roll a
// check-in or a seat back. Deliberately not the "the backup's if it has any" rule used above for the
// dev log, which would bring back an older event. A server with no event of its own (a standby being
// built) takes the backup's.
export function eventDataFor(live, next) {
  const holds = (live.caEvents || []).some((e) => !e.demo);
  return Object.fromEntries(CA_COLLECTIONS.map((k) => [k, holds ? live[k] || [] : Array.isArray(next[k]) ? next[k] : []]));
}

function replaceData(db, next, { keepAdmin = false } = {}) {
  // The dev log and user feedback are about the software, not company data: keep them unless a backup
  // brings its own (demo data and "erase all data" start from an empty template and must not wipe them).
  db.replace({
    ...next,
    ...eventDataFor(db.data, next),
    // Where the audit log's keyed entries begin belongs to this server's log, not to the backup.
    settings: { ...next.settings, auditKeyedFrom: db.data.settings.auditKeyedFrom },
    devlog: next.devlog?.entries?.length ? next.devlog : db.data.devlog,
    feedback: Array.isArray(next.feedback) && next.feedback.length ? cleanFeedback(next.feedback) : db.data.feedback,
    feedbackSeq: Math.max(Number(db.data.feedbackSeq) || 0, Number(next.feedbackSeq) || 0),
    // So are administrators' edits of the Help guides.
    guideEdits: Array.isArray(next.guideEdits) && next.guideEdits.length ? next.guideEdits : db.data.guideEdits || [],
    // The service desk's mail setup and settings are kept; its tickets are company data.
    helpdesk: keepHelpdeskConfig(db.data.helpdesk, next.helpdesk),
    // So is the sales setup (pipeline stages, sources, checklist); CRM records are company data.
    crm: keepCrmConfig(db.data.crm, next.crm),
    // So is the Projects setup (default statuses, project types); projects are company data.
    pm: keepPmConfig(db.data.pm, next.pm),
    // Roles and modules come from a backup only as CORE writes them (never an admin-only power for
    // another account type); the settings history and the last backup belong to this server.
    roleOverrides: keepAdmin || next.roleOverrides === undefined ? db.data.roleOverrides : cleanOverrides(next.roleOverrides),
    modules: keepAdmin || next.modules === undefined ? db.data.modules : cleanModuleConfig(next.modules),
    settingsLog: db.data.settingsLog || [],
    adminState: db.data.adminState,
  });
  setRoleOverrides(db.data.roleOverrides);
  migrateCrm(db);
  migratePm(db);
  migrateNotifications(db);
  syncDevlog(db);
  migrateLeaveTypes(db);
  const ids = new Set(db.data.employees.map((e) => e.id));
  for (const u of db.data.users) if (u.employeeId && !ids.has(u.employeeId)) u.employeeId = null;
  db.save();
}

const DEMO_PASSWORD = 'demo1234';
const DEMO_ACCOUNTS = [['hr.demo', 'hr', 'Demo HR Manager'], ['payroll.demo', 'payroll', 'Demo Payroll Officer'], ['it.demo', 'it', 'Demo IT Asset Manager'], ['sales.demo', 'salesmgr', 'Demo Sales Manager'], ['pm.demo', 'pm', null], ['employee.demo', 'employee', null], ['eventlead.demo', 'eventstaff', 'Demo Event Lead'], ['event.demo', 'eventstaff', 'Demo Event Staff']];

function demoAccounts(db, employees) {
  const taken = new Set(db.data.users.map((u) => u.username));
  const juan = employees.find((e) => e.firstName === 'Juan') || employees[0];
  const maria = employees.find((e) => e.firstName === 'Maria');
  const andrea = employees.find((e) => e.firstName === 'Andrea') || juan;
  const linked = new Set(db.data.users.map((u) => u.employeeId).filter(Boolean));
  // Their role in the company: the linked employee's position, or the job the account stands for.
  const TITLES = { hr: 'HR Manager', payroll: 'Payroll Officer', it: 'IT Asset Manager', salesmgr: 'Sales Manager', pm: 'Project Manager', employee: 'Team Lead', eventstaff: 'Event Staff' };
  const byId = new Map(employees.map((e) => [e.id, e]));
  return DEMO_ACCOUNTS.filter(([username]) => !taken.has(username)).map(([username, role, name]) => {
    // The employee account is Juan (a team lead); the HR account is Maria, the HR Manager; the
    // project manager is Andrea, who runs the delivery projects.
    const employeeId = role === 'employee' ? juan.id : role === 'pm' && !linked.has(andrea.id) ? andrea.id : role === 'hr' && maria && !linked.has(maria.id) ? maria.id : null;
    return {
    id: randomUUID(),
    username,
    name: name || (role === 'pm' ? `${andrea.firstName} ${andrea.lastName}` : `${juan.firstName} ${juan.lastName}`),
    role,
    companyRole: cleanCompanyRole(byId.get(employeeId)?.position || TITLES[role]) || undefined,
    employeeId,
    active: true,
    mustChangePassword: false,
    demo: true,
    passwordHash: hashPassword(DEMO_PASSWORD),
    createdAt: new Date().toISOString(),
    };
  });
}

// Clock in / out for the current date and time. Clocking in also records where (see server/geo.js).
function clock(db, emp, action, body = {}, source = 'self') {
  if (emp.status !== 'Active') throw new HttpError(400, 'This employee is inactive.');
  const date = localDate();
  const time = localTime();
  const open = db.data.timeEntries.find((e) => e.employeeId === emp.id && e.type === 'work' && e.timeIn && !e.timeOut);
  if (action === 'in') {
    if (open) throw new HttpError(400, `Already clocked in since ${open.date} ${open.timeIn}.`);
    // An approved remote or official-business day, or a half-day leave, is clocked on its own entry.
    const planned = db.data.timeEntries.find((e) => e.employeeId === emp.id && e.date === date && e.type === 'work' && !e.timeIn && (e.remote || e.halfLeave));
    if (planned) {
      planned.timeIn = time;
      planned.clockInLocation = clockInLocation(db.data.settings, body, source);
      db.save();
      const why = planned.officialBusiness ? 'official business' : planned.remote ? 'remote work' : 'half-day leave';
      return { message: `${emp.firstName} clocked in at ${time} (${why}).`, entry: planned };
    }
    const onLeave = db.data.timeEntries.find((e) => e.employeeId === emp.id && e.date === date && e.type === 'leave');
    if (onLeave) throw new HttpError(400, `${emp.firstName} is on approved leave today.`);
    const entry = { id: randomUUID(), ...validateEntry({ employeeId: emp.id, date, type: 'work', timeIn: time }, db), clockInLocation: clockInLocation(db.data.settings, body, source) };
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

// rateLimits: on in the running app (server.js); off where tests call the API directly.
// digestMail and digestClock: tests replace how the Projects digest sends and what time it is.
export function createApi(db, { rateLimits = false, digestMail, digestClock, eventOutbox } = {}) {
  const secrets = createSecrets(db.dir);
  // The audit chain is sealed with a key made from the server key. Where keyed entries begin is
  // kept in the settings (never taken from a restored backup: see replaceData).
  // The security monitor's collector (0.34): requests (reported by server.js), audit entries and
  // the process, in buckets of fixed size (server/monitor.js).
  let handlePdf = null;
  const monitor = createMonitor(db.dir, { sessions: () => sessions.active() });
  const audit = createAudit(db.dir, {
    onRecord: (entry) => monitor.audit(entry),
    key: () => secrets.derive('core-audit-chain-v1'),
    keyedFrom: () => db.data.settings.auditKeyedFrom,
    setKeyedFrom: (seq) => {
      db.data.settings.auditKeyedFrom = seq;
      db.save();
    },
  });
  const files = createAttachments(path.join(db.dir, 'attachments'));
  // What each account type may do, with the company's changes (Admin panel → Roles & permissions).
  setRoleOverrides(db.data.roleOverrides);
  const migrated = [syncDevlog(db), migrateLeaveTypes(db), purgeOldLocations(db), applyPolicyUpdates(db), migrateHelpdesk(db), migrateCrm(db), migratePm(db), migrateNotifications(db), migrateApprovals(db), migrateHolidays(db), syncLedger(db)];
  if (migrated.some(Boolean)) db.save();
  // Clock-in locations past the retention period are removed while the server runs, too.
  setInterval(() => purgeOldLocations(db) && db.save(), 6 * 60 * 60 * 1000).unref();
  const routes = [];
  // Sign-in and security policy (Admin panel → Sign-in & security), read at each use so changes apply at once.
  const sec = () => securitySettings(db);
  const sessions = createSessions(() => ({ idleMs: sec().sessionIdleMinutes * 60000, maxMs: sec().sessionMaxHours * 3600000 }));
  const throttle = createThrottle();
  // Rate limits: everyday use per person (or per network address before signing in), sign-in
  // attempts and failures per address, password and 2-step changes per person, the public form.
  // Event allowance (0.71): while an event's doors are open (CUSTOM APP), everyone at the venue comes
  // from one network address, so staff sign-in gets more room. Set by server/customapp once it loads.
  let eventWindowOpen = () => false;
  const limiter = createRateLimiter(() => {
    const s = sec();
    const venue = eventWindowOpen();
    return {
      'api-user': { limit: s.requestsPerMinute, windowMs: 60000 },
      'api-anon': { limit: 120, windowMs: 60000 },
      auth: { limit: venue ? 120 : 20, windowMs: 60000 },
      'signin-fail': { limit: venue ? Math.max(s.signInFailuresPerAddress, 60) : s.signInFailuresPerAddress, windowMs: 15 * 60000 },
      // An event's guest pages (/api/public/event/…, 0.71): a ballroom of phones behind one venue
      // address. Not the generic signed-out buckets (they would stop check-in at about the 20th
      // guest); a high ceiling per address against a runaway script, the guest's own poll per
      // status token, and attempts per event. Wrong answers are capped per surname in the engine.
      'event-ip': { limit: 12000, windowMs: 60000 },
      'event-token': { limit: 90, windowMs: 60000 },
      'event-verify': { limit: 900, windowMs: 60000 },
      sensitive: { limit: 10, windowMs: 15 * 60000 },
      'public-write': { limit: 20, windowMs: 60 * 60000 },
      // Document links outside the company (0.67): opening, wrong passwords, files sent in.
      'share-access': { limit: 120, windowMs: 60000 },
      'share-password': { limit: 10, windowMs: 15 * 60000 },
      'share-upload': { limit: 60, windowMs: 60 * 60000 },
    };
  });
  const limits = rateLimits ? limiter : { hit() {}, check() {}, add() {} };
  // A password that was right, waiting for the 2-step code: challenge id → { userId, expires, attempts }.
  const challenges = new Map();
  const TWO_FACTOR_WAIT = 5 * 60000;
  // permission: 'public', 'auth' (any signed-in user) or a permission from shared/roles.js
  const route = (method, pattern, permission, handler, { duringPasswordChange = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, permission, handler, duringPasswordChange, pattern });
  };
  const users = () => db.data.users;
  const activeAdmins = () => users().filter((u) => u.role === 'admin' && u.active);

  function startSession(user, client = {}) {
    user.lastLoginAt = new Date().toISOString();
    db.save();
    const token = sessions.create(user.id, client);
    return { data: { user: authUser(user) }, headers: { 'Set-Cookie': sessionCookie(token, { maxAge: sessions.maxAgeSeconds(), secure: client.https }) } };
  }
  // The signed-in account as the browser sees it, with whether 2-step verification must be set up first.
  const authUser = (user) => ({ ...publicUser(user), isApprover: isApprover(db, user), inProjects: isProjectMember(db, user), timesheet: timesheetAccess(db, user), twoFactorSetupRequired: twoFactorRequired(sec(), user) && !user.twoFactor?.enabledAt });
  const requirePassword = (user, password) => {
    if (!verifyPassword(String(password || ''), user.passwordHash)) throw new HttpError(400, 'Your password is not right.');
  };
  // The second step: a code from the authenticator app (each works once), or an unused recovery code.
  // Returns 'app', 'recovery', or null when it is wrong.
  function secondFactor(user, code) {
    const tf = user.twoFactor;
    if (!tf?.enabledAt) return null;
    if (looksLikeRecovery(code)) {
      const hit = (tf.recovery || []).find((r) => r.hash === hashRecovery(code) && !r.usedAt);
      if (!hit) return null;
      hit.usedAt = new Date().toISOString();
      db.save();
      return 'recovery';
    }
    // The secret is sealed with this server's key; a backup restored elsewhere only accepts recovery codes.
    const secret = secrets.open(tf.secret);
    const step = secret && verifyCode(secret, code, { lastStep: tf.lastStep ?? -1 });
    if (step == null || step === false) return null;
    tf.lastStep = step;
    db.save();
    return 'app';
  }
  const recoveryLeft = (user) => (user.twoFactor?.recovery || []).filter((r) => !r.usedAt).length;
  const issueRecovery = (user) => {
    const codes = newRecoveryCodes();
    user.twoFactor.recovery = codes.map((c) => ({ hash: hashRecovery(c), usedAt: null }));
    return codes;
  };
  const passwordRules = (who) => [who, sec()];

  function linkedEmployee(user) {
    const emp = user.employeeId && db.data.employees.find((e) => e.id === user.employeeId);
    if (!emp) throw new HttpError(400, 'Your account is not linked to an employee record. Ask an administrator to link it.');
    return emp;
  }

  // ----- Sign in -----
  // Before sign-in too: the branding (colours, headline, logo) for the sign-in page. Signed in: the
  // account, the company's changes to the account types and which modules are on, so the browser
  // shows what the server allows.
  route('GET', '/api/auth/status', 'public', ({ user }) => ({
    setupRequired: users().length === 0, user: user ? authUser(user) : null, brand: publicBrand(db.data.settings),
    ...(user ? { roleOverrides: roleOverrides(), modules: cleanModuleConfig(db.data.modules) } : {}),
  }));
  route('POST', '/api/auth/setup', 'public', ({ body, client }) => {
    if (users().length) throw new HttpError(400, 'Setup is already complete. Please sign in.');
    const user = { id: randomUUID(), ...validateUser({ ...body, role: 'admin', active: true }, db), mustChangePassword: false };
    validatePassword(body.password, ...passwordRules(user));
    user.passwordHash = hashPassword(body.password);
    user.createdAt = new Date().toISOString();
    users().push(user);
    audit.record('user.create', { entity: 'user', entityId: user.id, label: `${user.name} (${user.username})`, note: 'First administrator, created at setup', actor: { user, ip: currentActor()?.ip } });
    return startSession(user, client);
  });
  // Too many failed sign-ins from one network address (any usernames) stop that address for a while;
  // too many for one username lock it, for longer each time (server/auth.js).
  const signInFailed = (username, user, client, note) => {
    limits.add('signin-fail', client.ip);
    const locked = throttle.fail(username);
    audit.record('auth.login-failed', { entity: 'user', entityId: user?.id || '', label: username.slice(0, 64), note, actor: { name: `Unknown (${username.slice(0, 64)})`, ip: client.ip } });
    if (locked) audit.record('auth.locked', { entity: 'user', entityId: user?.id || '', label: username.slice(0, 64), note: `Locked for ${locked} minutes after 5 failed attempts`, actor: { name: 'CORE', ip: client.ip } });
  };
  route('POST', '/api/auth/login', 'public', ({ body, client }) => {
    const username = String(body.username || '').trim().toLowerCase();
    limits.check('signin-fail', client.ip, 'Too many failed sign-ins from this network.');
    throttle.check(username);
    const user = users().find((u) => u.username === username);
    const rightPassword = verifyPassword(String(body.password || ''), user?.passwordHash);
    if (!rightPassword || !user.active) {
      signInFailed(username, user, client, user && !user.active ? 'Account disabled' : 'Wrong username or password');
      // That an account is disabled is said only to someone who knows its password.
      throw new HttpError(401, rightPassword ? 'This account is disabled. Contact your administrator.' : 'Incorrect username or password.');
    }
    throttle.reset(username);
    // With 2-step verification on, the password alone does not sign in: the code comes next.
    if (user.twoFactor?.enabledAt) {
      const challenge = randomBytes(24).toString('hex');
      challenges.set(challenge, { userId: user.id, expires: Date.now() + TWO_FACTOR_WAIT, attempts: 0 });
      for (const [id, c] of challenges) if (c.expires < Date.now()) challenges.delete(id);
      return { twoFactorRequired: true, challenge };
    }
    audit.record('auth.login', { entity: 'user', entityId: user.id, label: user.username, actor: { user, ip: client.ip } });
    return startSession(user, client);
  });
  route('POST', '/api/auth/2fa', 'public', ({ body, client }) => {
    const id = String(body.challenge || '');
    const c = challenges.get(id);
    const user = c && c.expires > Date.now() && users().find((u) => u.id === c.userId && u.active);
    if (!user || !user.twoFactor?.enabledAt) {
      challenges.delete(id);
      throw new HttpError(401, 'The sign-in has expired. Enter your username and password again.');
    }
    limits.check('signin-fail', client.ip, 'Too many failed sign-ins from this network.');
    throttle.check(user.username);
    const how = secondFactor(user, body.code);
    if (!how) {
      c.attempts += 1;
      limits.add('signin-fail', client.ip);
      audit.record('auth.2fa-failed', { entity: 'user', entityId: user.id, label: user.username, actor: { name: user.name, ip: client.ip } });
      if (c.attempts >= 5) {
        challenges.delete(id);
        signInFailed(user.username, user, client, 'Five wrong 2-step verification codes');
        throw new HttpError(401, 'Too many wrong codes. Enter your username and password again.');
      }
      throw new HttpError(401, 'That code is not right. Check that the time on your phone is correct, or use a recovery code.');
    }
    challenges.delete(id);
    throttle.reset(user.username);
    if (how === 'recovery') audit.record('auth.recovery-used', { entity: 'user', entityId: user.id, label: user.username, note: `${recoveryLeft(user)} recovery codes left`, actor: { user, ip: client.ip } });
    audit.record('auth.login', { entity: 'user', entityId: user.id, label: user.username, note: how === 'recovery' ? 'With a recovery code' : 'With 2-step verification', actor: { user, ip: client.ip } });
    return startSession(user, client);
  });
  route('POST', '/api/auth/logout', 'auth', ({ token, client }) => {
    sessions.destroy(token);
    return { data: { ok: true }, headers: { 'Set-Cookie': clearedCookie(client.https) } };
  }, { duringPasswordChange: true });
  route('POST', '/api/auth/change-password', 'auth', ({ user, token, body }) => {
    limits.hit('sensitive', user.id, 'Too many password changes.');
    if (!verifyPassword(String(body.currentPassword || ''), user.passwordHash)) throw new HttpError(400, 'Your current password is incorrect.');
    validatePassword(body.newPassword, ...passwordRules(user));
    if (body.newPassword === body.currentPassword) throw new HttpError(400, 'Choose a password different from the current one.');
    user.passwordHash = hashPassword(body.newPassword);
    user.mustChangePassword = false;
    sessions.destroyForUser(user.id, token);
    audit.record('auth.password-change', { entity: 'user', entityId: user.id, label: user.username });
    db.save();
    return { user: publicUser(user) };
  }, { duringPasswordChange: true });

  // ----- My security: 2-step verification and where I am signed in -----
  const during = { duringPasswordChange: true };
  route('GET', '/api/me/2fa', 'auth', ({ user }) => ({
    enabled: Boolean(user.twoFactor?.enabledAt), enabledAt: user.twoFactor?.enabledAt || null,
    recoveryLeft: recoveryLeft(user), required: twoFactorRequired(sec(), user),
  }), during);
  // Step 1: a new secret for the authenticator app (the QR code), after the password is confirmed.
  route('POST', '/api/me/2fa/setup', 'auth', ({ user, body }) => {
    limits.hit('sensitive', user.id, 'Too many attempts.');
    requirePassword(user, body.password);
    const secret = newSecret();
    user.twoFactorPending = { secret: secrets.seal(secret), createdAt: new Date().toISOString() };
    db.save();
    return { secret, otpauthUrl: otpauthUrl({ secret, account: user.username, issuer: 'CORE ERP' }) };
  }, during);
  // Step 2: the first code from the app proves it is set up; then ten recovery codes, shown once.
  route('POST', '/api/me/2fa/enable', 'auth', ({ user, body, token }) => {
    limits.hit('sensitive', user.id, 'Too many attempts.');
    const pending = user.twoFactorPending;
    const secret = pending && Date.now() - Date.parse(pending.createdAt) < 15 * 60000 && secrets.open(pending.secret);
    if (!secret) throw new HttpError(400, 'Start again: scan a new QR code.');
    const step = verifyCode(secret, body.code);
    if (step == null) throw new HttpError(400, 'That code is not right. Enter the 6-digit code the app shows now.');
    user.twoFactor = { secret: pending.secret, enabledAt: new Date().toISOString(), lastStep: step, recovery: [] };
    delete user.twoFactorPending;
    const codes = issueRecovery(user);
    // Anyone signed in elsewhere signs in again, now with the code.
    sessions.destroyForUser(user.id, token);
    db.save();
    audit.record('auth.2fa-on', { entity: 'user', entityId: user.id, label: user.username });
    return { recoveryCodes: codes, user: authUser(user) };
  }, during);
  route('POST', '/api/me/2fa/disable', 'auth', ({ user, body }) => {
    limits.hit('sensitive', user.id, 'Too many attempts.');
    if (twoFactorRequired(sec(), user)) throw new HttpError(400, 'Your company requires 2-step verification for your account, so it cannot be turned off.');
    requirePassword(user, body.password);
    if (!secondFactor(user, body.code)) throw new HttpError(400, 'That code is not right.');
    delete user.twoFactor;
    db.save();
    audit.record('auth.2fa-off', { entity: 'user', entityId: user.id, label: user.username });
    return { user: authUser(user) };
  }, during);
  route('POST', '/api/me/2fa/recovery-codes', 'auth', ({ user, body }) => {
    limits.hit('sensitive', user.id, 'Too many attempts.');
    requirePassword(user, body.password);
    if (!secondFactor(user, body.code)) throw new HttpError(400, 'That code is not right.');
    const codes = issueRecovery(user);
    db.save();
    audit.record('auth.recovery-new', { entity: 'user', entityId: user.id, label: user.username });
    return { recoveryCodes: codes };
  }, during);
  const sessionRow = (s, currentId) => ({ id: s.id, current: s.id === currentId, device: s.device, ip: s.ip, signedInAt: new Date(s.created).toISOString(), lastSeenAt: new Date(s.lastSeen).toISOString() });
  route('GET', '/api/me/sessions', 'auth', ({ user, token }) => {
    const current = sessions.get(token, { touch: false })?.id;
    return sessions.list(user.id).map((s) => sessionRow(s, current));
  }, during);
  route('DELETE', '/api/me/sessions/:id', 'auth', ({ user, params }) => {
    if (!sessions.destroyById(user.id, params.id)) throw new HttpError(404, 'That session has already ended.');
    audit.record('auth.sessions', { entity: 'user', entityId: user.id, label: user.username, note: 'One session' });
    return { ok: true };
  }, during);
  route('POST', '/api/me/sessions/sign-out-others', 'auth', ({ user, token }) => {
    const n = sessions.destroyForUser(user.id, token);
    audit.record('auth.sessions', { entity: 'user', entityId: user.id, label: user.username, note: `${n} other session${n === 1 ? '' : 's'}` });
    return { signedOut: n };
  }, during);

  // ----- Sign-in & security settings (Administrators) -----
  route('GET', '/api/security-settings', 'users.manage', () => ({ ...sec(), policies: TWO_FACTOR_POLICIES }));
  route('PUT', '/api/security-settings', 'users.manage', ({ body, user }) => {
    const before = sec();
    const next = validateSecuritySettings(body, before);
    // Requiring 2-step verification of yourself before you have it would lock you out at the next sign-in.
    if (twoFactorRequired(next, user) && !user.twoFactor?.enabledAt) {
      throw new HttpError(400, 'Turn on 2-step verification for your own account first (your name → My security), then require it.');
    }
    db.data.settings.security = next;
    db.save();
    const changes = diff(before, next);
    if (changes.length) audit.record('settings.security', { entity: 'settings', label: 'Sign-in and security', changes });
    return { ...next, policies: TWO_FACTOR_POLICIES };
  });

  // ----- Profile pictures -----
  // Everyone's own small picture, shown instead of their initials. A square JPEG, PNG or WebP (by its
  // first bytes, never SVG), made small in the browser, at most 300 KB; or an animated GIF as it is
  // (at most 1 MB and 1024 pixels each way: checkGif). Set and removed by its owner;
  // an administrator can remove anyone's. Shown to everyone signed in, with its own type, nosniff and
  // a sandbox policy; the address carries the picture's date, so a new one is not hidden by the cache.
  const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const AVATAR_MAX = 300 * 1024;
  const avatarList = () => Object.fromEntries(users().filter((u) => u.avatar?.id).map((u) => [u.id, u.avatar.at]));
  function setAvatar(user, file) {
    const up = parseUpload(file, { pictures: AVATAR_TYPES });
    if (up.type !== 'image/gif' && up.buffer.length > AVATAR_MAX) throw new HttpError(400, `The picture is too large (${Math.ceil(up.buffer.length / 1024)} KB). The limit is ${AVATAR_MAX / 1024} KB.`);
    const old = user.avatar;
    const saved = files.save({ ...up, name: 'profile' });
    user.avatar = { id: saved.id, type: saved.type, size: saved.size, at: saved.uploadedAt };
    if (old?.id) files.remove(old);
  }
  function dropAvatar(user) {
    if (!user.avatar) return false;
    files.remove(user.avatar);
    delete user.avatar;
    return true;
  }
  route('GET', '/api/avatars', 'auth', () => avatarList());
  route('GET', '/api/users/:id/avatar', 'auth', ({ params }) => {
    const user = users().find((u) => u.id === params.id);
    if (!user?.avatar?.id) throw new HttpError(404, 'No picture.');
    return { data: files.buffer(user.avatar), headers: { 'Content-Type': user.avatar.type, 'Content-Disposition': 'inline; filename="profile"', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable' } };
  });
  // Modules pinned to the front of this person's CORE home, in the order pinned (their own choice:
  // no audit entry). Only live modules; unknown ones are dropped.
  route('PUT', '/api/me/favorite-modules', 'auth', ({ user, body }) => {
    const list = cleanFavoriteModules(body?.modules);
    if (!list) throw new HttpError(400, 'Send the pinned modules as a list.');
    user.favoriteModules = list;
    db.save();
    return { favoriteModules: list };
  });
  route('PUT', '/api/me/avatar', 'auth', ({ user, body }) => {
    setAvatar(user, body?.file);
    db.save();
    return { avatar: user.avatar.at, avatars: avatarList() };
  });
  route('DELETE', '/api/me/avatar', 'auth', ({ user }) => {
    dropAvatar(user);
    db.save();
    return { avatar: null, avatars: avatarList() };
  });
  route('DELETE', '/api/users/:id/avatar', 'users.manage', ({ params }) => {
    const user = findUser(db, params.id);
    if (!dropAvatar(user)) throw new HttpError(400, `${user.name} has no picture.`);
    db.save();
    audit.record('user.avatar-remove', { entity: 'user', entityId: user.id, label: `${user.name} (${user.username})`, note: 'Profile picture removed by an administrator' });
    return publicUser(user);
  });

  // ----- User accounts -----
  // ----- Profiles -----
  // Everyone's profile: their picture, name, role in the company and department, for anyone signed
  // in. Their own profile (and anyone's, for an administrator) adds the account: username, account
  // type, 2-step sign-in, what they can open in each module, and their employment details. A
  // disabled account is shown to administrators only. Only administrators change the role.
  const companyRoleFrom = (body) => {
    try {
      return cleanCompanyRole(body?.companyRole ?? null);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  };
  function setCompanyRole(user, role) {
    if (role) user.companyRole = role;
    else delete user.companyRole;
  }
  function profileOf(u, me) {
    const full = u.id === me.id || userCan(me, 'users.manage');
    const hrOn = moduleOn(db.data.modules, 'hr') || me.role === 'admin';
    const emp = u.employeeId && hrOn ? db.data.employees.find((e) => e.id === u.employeeId) : null;
    const supervisor = emp?.supervisorId ? db.data.employees.find((e) => e.id === emp.supervisorId) : null;
    // The projects both are members of (only those the viewer can open anyway).
    const shared = u.id === me.id || !moduleOn(db.data.modules, 'projects') ? [] : (db.data.pmProjects || [])
      .filter((p) => !p.isTemplate && p.members.some((m) => m.userId === u.id) && p.members.some((m) => m.userId === me.id))
      .map((p) => ({ id: p.id, code: p.code, name: p.name })).sort((a, b) => a.code.localeCompare(b.code));
    const out = { id: u.id, name: u.name, companyRole: companyRoleOf(u), department: emp?.department || null, supervisor: supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : null, sharedProjects: shared, active: u.active !== false, self: u.id === me.id, canEditRole: userCan(me, 'users.manage') };
    if (!full) return out;
    const approver = isApprover(db, u);
    return {
      ...out,
      username: u.username, accountType: u.role, accountTypeLabel: ROLES[u.role]?.label || u.role,
      twoFactorEnabled: Boolean(u.twoFactor?.enabledAt), createdAt: u.createdAt || null,
      modules: moduleAccess(u, { modules: db.data.modules, inProjects: isProjectMember(db, u), isApprover: approver }),
      adminPanel: usesAdminPanel(u), approver,
      employee: emp ? { employeeNo: emp.employeeNo, position: emp.position || null, department: emp.department || null, employmentStatus: emp.employmentStatus || null, hireDate: emp.hireDate || null, supervisor: supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : null } : null,
      ...(userCan(me, 'users.manage') ? { roleSuggestions: [...new Set(users().map((x) => x.companyRole).filter(Boolean))].sort((a, b) => a.localeCompare(b)) } : {}),
    };
  }
  route('GET', '/api/people/:id', 'auth', ({ params, user: me }) => {
    const u = users().find((x) => x.id === params.id);
    if (!u || (u.active === false && !userCan(me, 'users.manage'))) throw new HttpError(404, 'There is no such person in CORE.');
    return profileOf(u, me);
  });
  route('PUT', '/api/people/:id/company-role', 'users.manage', ({ params, body, user: me }) => {
    const u = findUser(db, params.id);
    const before = publicUser(u);
    setCompanyRole(u, companyRoleFrom(body));
    u.updatedAt = new Date().toISOString();
    db.save();
    audit.record('user.update', { entity: 'user', entityId: u.id, label: `${u.name} (${u.username})`, changes: diff(before, publicUser(u), ['companyRole']) });
    return profileOf(u, me);
  });

  route('GET', '/api/users', 'users.manage', () => users().map((u) => ({ ...publicUser(u), sessions: sessions.list(u.id).length, twoFactorRequired: twoFactorRequired(sec(), u) })));
  route('POST', '/api/users', 'users.manage', ({ body }) => {
    const user = { id: randomUUID(), ...validateUser(body, db) };
    const companyRole = companyRoleFrom(body);
    if (companyRole) user.companyRole = companyRole;
    validatePassword(body.password, ...passwordRules(user));
    user.passwordHash = hashPassword(body.password);
    user.mustChangePassword = body.mustChangePassword !== false;
    user.createdAt = new Date().toISOString();
    users().push(user);
    db.save();
    audit.record('user.create', { entity: 'user', entityId: user.id, label: `${user.name} (${user.username})`, changes: diff({}, publicUser(user), USER_AUDIT_FIELDS) });
    return publicUser(user);
  });
  route('PUT', '/api/users/:id', 'users.manage', ({ params, body, user: me }) => {
    const user = findUser(db, params.id);
    const next = validateUser(body, db, user.id);
    if (user.id === me.id && (next.role !== user.role || !next.active)) throw new HttpError(400, 'You cannot change your own role or disable your own account.');
    if (user.role === 'admin' && user.active && (next.role !== 'admin' || !next.active) && activeAdmins().length === 1) {
      throw new HttpError(400, 'There must be at least one active administrator.');
    }
    const before = publicUser(user);
    Object.assign(user, next, { updatedAt: new Date().toISOString() });
    if (Object.hasOwn(body || {}, 'companyRole')) setCompanyRole(user, companyRoleFrom(body));
    // A disabled account, or one whose role changed, signs in again (with its new access).
    if (!user.active || before.role !== user.role) sessions.destroyForUser(user.id);
    db.save();
    audit.record('user.update', { entity: 'user', entityId: user.id, label: `${user.name} (${user.username})`, changes: diff(before, publicUser(user), USER_AUDIT_FIELDS) });
    return publicUser(user);
  });
  route('POST', '/api/users/:id/reset-password', 'users.manage', ({ params, body }) => {
    const user = findUser(db, params.id);
    validatePassword(body.password, ...passwordRules(user));
    user.passwordHash = hashPassword(body.password);
    user.mustChangePassword = true;
    sessions.destroyForUser(user.id);
    db.save();
    audit.record('user.reset-password', { entity: 'user', entityId: user.id, label: `${user.name} (${user.username})` });
    return publicUser(user);
  });
  route('POST', '/api/users/:id/sign-out', 'users.manage', ({ params }) => {
    const user = findUser(db, params.id);
    const n = sessions.destroyForUser(user.id);
    audit.record('user.sign-out', { entity: 'user', entityId: user.id, label: `${user.name} (${user.username})`, note: `${n} session${n === 1 ? '' : 's'} ended` });
    return { signedOut: n };
  });
  // For someone who lost their phone and their recovery codes: they sign in with the password and,
  // if the company requires it, set up 2-step verification again.
  route('POST', '/api/users/:id/2fa/reset', 'users.manage', ({ params, user: me }) => {
    const user = findUser(db, params.id);
    if (user.id === me.id) throw new HttpError(400, 'Change your own 2-step verification under My security.');
    if (!user.twoFactor && !user.twoFactorPending) throw new HttpError(400, `${user.name} does not use 2-step verification.`);
    delete user.twoFactor;
    delete user.twoFactorPending;
    sessions.destroyForUser(user.id);
    db.save();
    audit.record('user.2fa-reset', { entity: 'user', entityId: user.id, label: `${user.name} (${user.username})` });
    return publicUser(user);
  });
  route('DELETE', '/api/users/:id', 'users.manage', ({ params, user: me }) => {
    const user = findUser(db, params.id);
    if (user.id === me.id) throw new HttpError(400, 'You cannot delete your own account.');
    if (user.role === 'admin' && user.active && activeAdmins().length === 1) throw new HttpError(400, 'There must be at least one active administrator.');
    db.data.users = users().filter((u) => u.id !== user.id);
    dropAvatar(user);
    // Sales & CRM records they owned now have no owner (shown as such), not a dangling id.
    for (const k of ['crmAccounts', 'crmContacts', 'crmLeads', 'crmDeals', 'crmBids', 'crmContracts', 'crmActivities']) for (const x of db.data[k] || []) if (x.ownerId === user.id) x.ownerId = null;
    // Off every project; their tasks are unassigned.
    removeUserFromProjects(db, user.id);
    // Their notifications go; others' no longer name them.
    forgetUser(db, user.id);
    sessions.destroyForUser(user.id);
    db.save();
    audit.record('user.delete', { entity: 'user', entityId: user.id, label: `${user.name} (${user.username}, ${user.role})` });
    return { ok: true };
  });

  // ----- Employee self-service -----
  route('GET', '/api/me/profile', 'self', ({ user }) => linkedEmployee(user));
  route('GET', '/api/me/time-entries', 'self', ({ user, query }) => {
    const emp = linkedEmployee(user);
    return db.data.timeEntries
      .filter((e) => e.employeeId === emp.id && (!query.from || e.date >= query.from) && (!query.to || e.date <= query.to))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => forViewer(user, e));
  });
  route('POST', '/api/me/clock', 'self', ({ user, body }) => {
    const res = clock(db, linkedEmployee(user), body.action, body, 'self');
    return { ...res, entry: forViewer(user, res.entry) };
  });
  route('GET', '/api/me/payslips', 'self', ({ user }) => {
    const emp = linkedEmployee(user);
    return db.data.payrollRuns
      .filter((r) => r.status === 'finalized' || r.status === 'voided')
      .flatMap((r) => r.payslips.filter((p) => p.employeeId === emp.id).map((p) => ({ runId: r.id, status: r.status, periodStart: r.periodStart, periodEnd: r.periodEnd, payDate: r.payDate, grossPay: p.grossPay, totalDeductions: p.totalDeductions, netPay: p.netPay })))
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  });
  route('GET', '/api/me/payslips/:runId', 'self', ({ user, params }) => {
    const emp = linkedEmployee(user);
    const run = db.data.payrollRuns.find((r) => r.id === params.runId && (r.status === 'finalized' || r.status === 'voided'));
    const payslip = run?.payslips.find((p) => p.employeeId === emp.id);
    if (!payslip) throw new HttpError(404, 'Payslip not found.');
    const { payslips, employeeIds, ...meta } = run;
    return { run: meta, payslip };
  });

  // The employee's own year-to-date totals (from finalized payslips and opening balances).
  route('GET', '/api/me/ytd', 'self', ({ user, query }) => {
    const emp = linkedEmployee(user);
    const year = Number(query.year) || new Date().getFullYear();
    return { year, totals: yearTotals(db, year, emp.id)[0] || null };
  });

  registerLeaveRoutes(route, db, { linkedEmployee, files, audit });
  registerLedgerRoutes(route, db, { audit });
  registerAssetRoutes(route, db, { linkedEmployee });

  // ----- Settings -----
  route('GET', '/api/settings', 'auth', ({ user }) => settingsForBrowser(db.data.settings, (p) => userCan(user, p)));
  // Company details, default schedule and branding (Admin panel → Settings & branding).
  route('PUT', '/api/settings', 'settings.edit', ({ body, user }) => {
    const s = db.data.settings;
    const brandOf = (x) => ({ ...x.branding, logo: x.branding?.logo ? `(a picture, ${Math.round((x.branding.logo.length * 3) / 4 / 1024)} KB)` : '' });
    const keys = ['companyName', 'companyAddress', 'companyTin', 'schedule'];
    const before = flatten({ ...pick(s, keys), branding: brandOf(s) });
    // Everything is checked before anything is changed.
    const next = {};
    for (const k of ['companyName', 'companyAddress', 'companyTin']) if (k in body) next[k] = String(body[k] ?? '').trim().slice(0, k === 'companyAddress' ? 300 : 200);
    if ('companyName' in next && !next.companyName) throw new HttpError(400, 'Company name is required.');
    if (body.schedule) next.schedule = validateSchedule(body.schedule);
    if (body.branding !== undefined) next.branding = validateBranding(body.branding, s.branding);
    Object.assign(s, next);
    db.save();
    const changes = diff(before, flatten({ ...pick(s, keys), branding: brandOf(s) }));
    if (changes.length) audit.record('settings.update', { entity: 'settings', label: 'Company details, default schedule and branding', changes });
    return settingsForBrowser(s, (p) => userCan(user, p));
  });

  // Payroll Setup: pay rules, deductions, government rates and tax tables (HR, Payroll, Administrator).
  route('PUT', '/api/payroll-config', 'payroll.config', ({ body, user }) => {
    const s = db.data.settings;
    const keys = ['payFrequency', 'workDaysPerYear', 'gracePeriodMinutes', 'minimumOvertimeMinutes', 'premiums', 'nightDiff', 'holidayPay', 'contributions', 'rates'];
    const before = flatten(pick(s, keys));
    const next = mergeSettings({ ...s, ...pick(body, keys) });
    db.data.settings = { ...validatePayrollConfig(next), payrollConfigUpdatedAt: new Date().toISOString(), payrollConfigUpdatedBy: user.name };
    db.save();
    const changes = diff(before, flatten(pick(db.data.settings, keys)));
    if (changes.length) audit.record('payroll.config', { entity: 'settings', label: 'Payroll Setup', changes });
    return settingsForBrowser(db.data.settings, (p) => userCan(user, p));
  });

  // ----- Employees -----
  const empLabel = (e) => `${e.firstName} ${e.lastName} (${e.employeeNo})`;
  // Every look at employee records is logged (once per person and 10 minutes), not only those with pay.
  route('GET', '/api/employees', 'employees.view', ({ user }) => {
    audit.view('employee.list', { entity: 'employee', label: `${db.data.employees.length} employees`, note: userCan(user, 'employees.sensitive') ? 'List with pay' : seesPersonal(user) ? 'List' : 'List without personal details' });
    return db.data.employees.map((e) => employeeFor(user, e));
  });
  // The full list, with government IDs and bank accounts, for the CSV export (logged).
  route('GET', '/api/employees/export', 'employees.sensitive', () => {
    audit.record('employee.export', { entity: 'employee', label: `${db.data.employees.length} employees`, note: 'Includes pay, government IDs and bank accounts' });
    return db.data.employees;
  });
  route('GET', '/api/employees/:id', 'employees.view', ({ params, user }) => {
    const emp = findEmployee(db, params.id);
    audit.view('employee.view', { entity: 'employee', entityId: emp.id, label: empLabel(emp), note: userCan(user, 'employees.sensitive') ? 'Record with pay' : seesPersonal(user) ? 'Record' : 'Record without personal details' });
    return employeeFor(user, emp);
  });
  // Full government ID numbers and bank account: for the edit form and the "Show" button (logged).
  route('GET', '/api/employees/:id/private', 'employees.sensitive', ({ params, query }) => {
    const emp = findEmployee(db, params.id);
    audit.view('employee.reveal', { entity: 'employee', entityId: emp.id, label: empLabel(emp), note: query.purpose === 'edit' ? 'Opened for editing' : 'Shown on the profile' });
    return pick(emp, PRIVATE_FIELDS);
  });
  route('POST', '/api/employees', 'employees.edit', ({ body, user }) => {
    const emp = { id: randomUUID(), ...validateEmployee(body, db), createdAt: new Date().toISOString() };
    db.data.employees.push(emp);
    db.save();
    audit.record('employee.create', { entity: 'employee', entityId: emp.id, label: empLabel(emp), changes: diff({}, emp, EMPLOYEE_FIELDS) });
    return employeeFor(user, emp);
  });
  route('PUT', '/api/employees/:id', 'employees.edit', ({ params, body, user }) => {
    const emp = findEmployee(db, params.id);
    const before = { ...emp };
    const next = validateEmployee(body, db, emp.id);
    // Your own pay, schedule and status are changed by someone else.
    if (OWN_LOCKED_FIELDS.some((f) => JSON.stringify(next[f] ?? null) !== JSON.stringify(emp[f] ?? null))) notOwnRecord(user, emp.id, 'pay, schedule or status');
    Object.assign(emp, next, { updatedAt: new Date().toISOString() });
    db.save();
    const changes = diff(before, emp, EMPLOYEE_FIELDS);
    if (changes.length) audit.record('employee.update', { entity: 'employee', entityId: emp.id, label: empLabel(emp), changes });
    return employeeFor(user, emp);
  });
  route('DELETE', '/api/employees/:id', 'employees.edit', ({ params }) => {
    const gone = findEmployee(db, params.id);
    audit.record('employee.delete', { entity: 'employee', entityId: gone.id, label: empLabel(gone), note: 'Record, attendance, requests and leave balances removed; finalized payslips and the year-to-date ledger are kept' });
    db.data.employees = db.data.employees.filter((e) => e.id !== params.id);
    for (const e of db.data.employees) if (e.supervisorId === params.id) e.supervisorId = null;
    db.data.timeEntries = db.data.timeEntries.filter((e) => e.employeeId !== params.id);
    for (const r of db.data.requests) if (r.employeeId === params.id) files.remove(r.attachment);
    db.data.requests = db.data.requests.filter((r) => r.employeeId !== params.id);
    db.data.leaveCredits = db.data.leaveCredits.filter((c) => c.employeeId !== params.id);
    db.data.leaveAccess = db.data.leaveAccess.filter((a) => a.employeeId !== params.id);
    db.data.leaveAdjustments = db.data.leaveAdjustments.filter((a) => a.employeeId !== params.id);
    for (const u of db.data.users) if (u.employeeId === params.id) u.employeeId = null;
    db.save();
    return { ok: true };
  });

  // ----- Time entries -----
  route('GET', '/api/time-entries', 'attendance.view', ({ query, user }) => {
    const { employeeId, from, to } = query;
    return db.data.timeEntries
      .filter((e) => (!employeeId || e.employeeId === employeeId) && (!from || e.date >= from) && (!to || e.date <= to))
      .sort((a, b) => b.date.localeCompare(a.date) || (a.timeIn || '').localeCompare(b.timeIn || ''))
      .map((e) => forViewer(user, e));
  });
  // A day inside a finalized payroll: the change is allowed but cannot alter that payroll.
  const lockedRun = (entry) => db.data.payrollRuns.find((r) => r.status === 'finalized' && r.employeeIds.includes(entry.employeeId) && entry.date >= r.periodStart && entry.date <= r.periodEnd);
  const lockNote = (run) => (run ? `In the finalized payroll for ${run.periodStart} to ${run.periodEnd}: that payroll does not change. Settle any difference with an adjustment in the next run.` : '');
  const entryLabel = (entry) => {
    const emp = db.data.employees.find((e) => e.id === entry.employeeId);
    return `${emp ? `${emp.firstName} ${emp.lastName}` : 'Employee'}, ${entry.date}`;
  };
  const ENTRY_FIELDS = ['date', 'type', 'timeIn', 'timeOut', 'otApproved', 'remote', 'leaveTypeId', 'paid', 'notes'];
  route('POST', '/api/time-entries', 'attendance.edit', ({ body, user }) => {
    notOwnRecord(user, body?.employeeId, 'attendance or overtime');
    const entry = { id: randomUUID(), ...validateEntry(body, db) };
    db.data.timeEntries.push(entry);
    db.save();
    const warning = lockNote(lockedRun(entry));
    audit.record('attendance.create', { entity: 'timeEntry', entityId: entry.id, label: entryLabel(entry), changes: diff({}, entry, ENTRY_FIELDS), note: warning });
    return { ...forViewer(user, entry), warning };
  });
  // Editing a record keeps the location recorded when the employee clocked in.
  route('PUT', '/api/time-entries/:id', 'attendance.edit', ({ params, body, user }) => {
    const entry = db.data.timeEntries.find((e) => e.id === params.id);
    if (!entry) throw new HttpError(404, 'Time entry not found.');
    const before = { ...entry };
    notOwnRecord(user, entry.employeeId, 'attendance or overtime');
    notOwnRecord(user, body?.employeeId, 'attendance or overtime');
    const next = validateEntry(body, db, entry.id);
    Object.assign(entry, next);
    db.save();
    const warning = lockNote(lockedRun(before) || lockedRun(entry));
    audit.record('attendance.update', { entity: 'timeEntry', entityId: entry.id, label: entryLabel(entry), changes: diff(before, entry, ENTRY_FIELDS), note: warning });
    return { ...forViewer(user, entry), warning };
  });
  route('DELETE', '/api/time-entries/:id', 'attendance.edit', ({ params, user }) => {
    const entry = db.data.timeEntries.find((e) => e.id === params.id);
    if (!entry) throw new HttpError(404, 'Time entry not found.');
    notOwnRecord(user, entry.employeeId, 'attendance or overtime');
    db.data.timeEntries = db.data.timeEntries.filter((e) => e.id !== params.id);
    db.save();
    const warning = lockNote(lockedRun(entry));
    audit.record('attendance.delete', { entity: 'timeEntry', entityId: entry.id, label: entryLabel(entry), changes: diff(entry, {}, ENTRY_FIELDS), note: warning });
    return { ok: true, warning };
  });

  route('POST', '/api/clock', 'clock.kiosk', ({ body, user }) => {
    const res = clock(db, findEmployee(db, body.employeeId), body.action, body, 'kiosk');
    return { ...res, entry: forViewer(user, res.entry) };
  });
  registerGeoRoutes(route, db);

  // ----- Payroll -----
  // A payroll run as an account may see it (VAPT 0.33): government ID and bank numbers masked on
  // each payslip, as on employee records, and left out for accounts without employees.sensitive. The
  // full bank accounts for the bank's payroll file come from the register export below, which is logged.
  const runOut = (user, run) => ({
    ...run,
    payslips: (run.payslips || []).map((p) => {
      const employee = { ...p.employee };
      for (const f of PRIVATE_FIELDS) {
        if (!userCan(user, 'employees.sensitive')) delete employee[f];
        else if (MASKED_FIELDS.includes(f) && employee[f]) employee[f] = mask(employee[f]);
      }
      return { ...p, employee };
    }),
  });
  route('GET', '/api/payroll-runs', 'payroll.view', () =>
    db.data.payrollRuns.map(({ payslips, ...run }) => run).sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
  );
  const runLabel = (run) => `${run.periodStart} to ${run.periodEnd} (pay date ${run.payDate})`;
  route('GET', '/api/payroll-runs/:id', 'payroll.view', ({ params, user }) => {
    const run = findRun(db, params.id);
    audit.view('payroll.run.view', { entity: 'payrollRun', entityId: run.id, label: runLabel(run) });
    return runOut(user, run);
  });
  // The register with full bank accounts, for the bank's payroll file (logged).
  route('GET', '/api/payroll-runs/:id/register', 'payroll.view', ({ params, user }) => {
    const run = findRun(db, params.id);
    if (!userCan(user, 'employees.sensitive')) return runOut(user, run);
    audit.record('payroll.register.export', { entity: 'payrollRun', entityId: run.id, label: runLabel(run), note: 'Payroll register with bank accounts' });
    return run;
  });
  route('POST', '/api/payroll-runs', 'payroll.edit', ({ body, user }) => {
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
    audit.record('payroll.run.create', { entity: 'payrollRun', entityId: run.id, label: runLabel(run), note: `${run.payslips.length} payslips` });
    return runOut(user, run);
  });
  route('POST', '/api/payroll-runs/:id/recompute', 'payroll.edit', ({ params, user }) => {
    const run = findRun(db, params.id);
    assertDraft(run);
    computeRun(db, run);
    db.save();
    audit.record('payroll.run.recompute', { entity: 'payrollRun', entityId: run.id, label: runLabel(run) });
    return runOut(user, run);
  });
  route('PUT', '/api/payroll-runs/:id/payslips/:employeeId', 'payroll.edit', ({ params, body, user }) => {
    const run = findRun(db, params.id);
    assertDraft(run);
    notOwnRecord(user, params.employeeId, 'payslip');
    const slip = run.payslips.find((p) => p.employeeId === params.employeeId);
    if (!slip) throw new HttpError(404, 'Payslip not found.');
    const before = { ...slip.adjustments };
    // Amounts are checked (VAPT 0.33): a number that is not finite, or past ₱100 million, is refused
    // instead of turning the run's totals into nothing.
    const amount = (v, what) => {
      const n = v === '' || v == null ? 0 : Number(v);
      if (!Number.isFinite(n) || n < 0 || n > PAY_ADJUST_MAX) throw new HttpError(400, `${what} must be an amount from 0 to ${PAY_ADJUST_MAX.toLocaleString('en-PH')}.`);
      return Math.round(n * 100) / 100;
    };
    slip.adjustments = {
      otherEarnings: amount(body.otherEarnings, 'Other earnings'),
      otherDeductions: amount(body.otherDeductions, 'Other deductions'),
      remarks: String(body.remarks || '').trim().slice(0, 500),
    };
    computeRun(db, run);
    db.save();
    const changes = diff(before, slip.adjustments, ['otherEarnings', 'otherDeductions', 'remarks']);
    if (changes.length) audit.record('payroll.run.adjust', { entity: 'payrollRun', entityId: run.id, label: `${slip.employee.name}, ${runLabel(run)}`, changes });
    return runOut(user, run);
  });
  // Finalizing locks the run and posts its payslips to the year-to-date ledger.
  route('POST', '/api/payroll-runs/:id/finalize', 'payroll.edit', ({ params, user }) => {
    const run = findRun(db, params.id);
    assertDraft(run);
    computeRun(db, run);
    Object.assign(run, { status: 'finalized', finalizedAt: new Date().toISOString(), finalizedBy: user.name });
    postRun(db, run);
    // Each employee in it who has an account: their payslip is ready in My Payslips.
    for (const slip of run.payslips) {
      const acct = accountOfEmployee(db, slip.employeeId);
      if (!acct || !userCan(acct, 'self')) continue;
      notify(db, [acct.id], {
        module: 'hr', kind: 'payslip', title: `Your payslip for ${fmtRange(run.periodStart, run.periodEnd)} is ready`,
        body: `${run.payDate ? `Pay date ${fmtRange(run.payDate)}. ` : ''}Open it under My Payslips.`, link: `#/me/payslips/${run.id}`,
      }, { actorId: user.id });
    }
    db.save();
    audit.record('payroll.run.finalize', { entity: 'payrollRun', entityId: run.id, label: runLabel(run), note: `${run.payslips.length} payslips, net pay ₱${Number(run.totals?.netPay || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` });
    return runOut(user, run);
  });
  // A finalized run is a record: it is voided (with a reason), never deleted or changed. Its
  // payslips leave the year-to-date totals; employees still see them, marked voided.
  route('POST', '/api/payroll-runs/:id/void', 'payroll.edit', ({ params, body, user }) => {
    const run = findRun(db, params.id);
    if (run.status !== 'finalized') throw new HttpError(400, run.status === 'voided' ? 'This payroll run is already voided.' : 'Only a finalized payroll run can be voided. Delete a draft instead.');
    const reason = String(body.reason || '').trim().slice(0, 500);
    if (!reason) throw new HttpError(400, 'Give the reason for voiding this payroll run.');
    Object.assign(run, { status: 'voided', voidedAt: new Date().toISOString(), voidedBy: user.name, voidReason: reason });
    voidRunRows(db, run, run.voidedAt);
    db.save();
    audit.record('payroll.run.void', { entity: 'payrollRun', entityId: run.id, label: runLabel(run), note: reason });
    return runOut(user, run);
  });
  route('DELETE', '/api/payroll-runs/:id', 'payroll.edit', ({ params }) => {
    const run = findRun(db, params.id);
    if (run.status !== 'draft') throw new HttpError(400, 'A finalized payroll run is a record and cannot be deleted. Void it instead, with a reason.');
    db.data.payrollRuns = db.data.payrollRuns.filter((r) => r.id !== params.id);
    db.save();
    audit.record('payroll.run.delete', { entity: 'payrollRun', entityId: run.id, label: runLabel(run) });
    return { ok: true };
  });

  // ----- Data management -----
  route('GET', '/api/admin/export', 'data.manage', ({ user, query }) => {
    // While an event is live (CUSTOM APP), its guest list stays out of the download unless "include
    // events" is ticked, so a backup on someone's laptop is not a second copy of it; the event's own
    // export is its recovery copy. Ticking it is in the audit log.
    const live = customapp.liveEvents();
    const withEvents = !live.length || query.includeEvents === '1';
    audit.record(withEvents && live.length ? 'data.export-events' : 'data.export', { label: 'Full backup', note: `All company data, including pay, government IDs and bank accounts${live.length ? (withEvents ? '; including the guest lists of live events (CUSTOM APP)' : '; live events left out (CUSTOM APP)') : ''}` });
    // When the last backup was downloaded, and by whom (Admin panel → Dashboard).
    db.data.adminState = { lastBackupAt: new Date().toISOString(), lastBackupBy: user.name };
    db.save();
    if (withEvents) return db.data;
    return { ...db.data, ...Object.fromEntries(CA_COLLECTIONS.map((k) => [k, []])), eventsOmitted: { at: new Date().toISOString(), events: live.map((e) => e.name), note: 'Live event data is not in this backup. Each event has its own export (CUSTOM APP → Event control).' } };
  });
  // A restore replaces everything, the accounts included: the administrator's password is asked
  // again, and the accounts in the file are checked before anything is replaced.
  route('POST', '/api/admin/import', 'data.manage', ({ body, user }) => {
    limits.hit('sensitive', user.id, 'Too many attempts.');
    const { password, ...backup } = body || {};
    if (!password) throw new HttpError(400, 'Enter your password to restore a backup.');
    requirePassword(user, password);
    if (!Array.isArray(backup.employees) || !Array.isArray(backup.timeEntries) || !Array.isArray(backup.payrollRuns)) {
      throw new HttpError(400, 'That file is not a valid backup.');
    }
    // Keep the current accounts unless the backup carries its own.
    replaceData(db, { ...backup, users: Array.isArray(backup.users) && backup.users.length ? backupUsers(backup.users) : users() });
    // A backup from before 0.33: its tickets are linked to their accounts as at startup.
    if (db.data.helpdesk && !db.data.helpdesk.ownersLinked) {
      linkTicketOwners(db);
      db.data.helpdesk.ownersLinked = true;
      db.save();
    }
    syncLedger(db) && db.save();
    // The accounts after a restore are on record: an account the backup added shows here.
    const admins = activeAdmins().map((u) => u.username).join(', ');
    audit.record('data.import', { label: 'Backup restored', note: `${db.data.employees.length} employees, ${db.data.payrollRuns.length} payroll runs, ${users().length} user accounts (administrators: ${admins})`.slice(0, 500) });
    return { ok: true };
  });
  // Demo data is added next to the real data (server/demo.js); loading again refreshes it.
  route('GET', '/api/admin/demo', 'data.manage', () => ({ loaded: hasDemo(db), counts: demoCounts(db) }));
  route('POST', '/api/admin/demo', 'data.manage', () => {
    removeDemoEvents(db);
    const counts = addDemo(db, { summarize, demoAccounts, removeFile: (a) => files.remove(a) });
    // The demo event (CUSTOM APP), unless the server holds a real event: demo data never touches one.
    if (!db.data.caEvents.some((e) => !e.demo)) addDemoEvent(db, { lead: users().find((u) => u.username === 'eventlead.demo'), staff: users().find((u) => u.username === 'event.demo') });
    // Demo forms in Document circulation: small generated PDFs, marked demo.
    forms.addDemo((title, lines) => docToPdf({ title, blocks: [{ type: 'heading', level: 1, runs: [{ text: title }] }, ...lines.map((t) => ({ type: 'paragraph', runs: [{ text: t }] }))] }, { size: 'a4' }).pdf);
    // The demo tickets belong to the demo people's accounts.
    linkTicketOwners(db, (t) => t.demo);
    syncLedger(db);
    db.save();
    audit.record('data.demo-load', { label: 'Demo data' });
    return { ok: true, counts, demoAccounts: DEMO_ACCOUNTS.map(([username, role]) => ({ username, role })), demoPassword: DEMO_PASSWORD };
  });
  route('DELETE', '/api/admin/demo', 'data.manage', () => {
    const removed = removeDemo(db, { summarize, removeFile: (a) => files.remove(a) });
    removeDemoEvents(db);
    forms.removeDemo();
    db.save();
    audit.record('data.demo-remove', { label: 'Demo data' });
    return { ok: true, removed };
  });
  registerDevlogRoutes(route, db);
  registerFeedbackRoutes(route, db, { audit });
  const helpdesk = registerHelpdeskRoutes(route, db, { files, secrets, linkedEmployee });
  registerCrmRoutes(route, db, { audit, files });
  const projects = registerProjectRoutes(route, db, { audit, files, mailer: helpdesk.mailer, ...(digestMail ? { sendMail: digestMail } : {}), ...(digestClock ? { clock: digestClock } : {}) });
  registerHolidayRoutes(route, db, { audit });
  registerGuideRoutes(route, db, { audit });
  // ----- Tools: PDF Studio (server/tools-pdf.js, 0.64) -----
  handlePdf = registerPdfStudio(route, db, { audit });
  // ----- Document Management (server/documents.js, 0.67) -----
  const docs = registerDocuments(route, db, {
    secrets, audit, limits, extractText: documentText,
    departmentOf: (u) => (u.employeeId && db.data.employees.find((e) => e.id === u.employeeId)?.department) || '',
  });
  // ----- Document circulation: every module's downloadable forms (server/forms.js, 0.70) -----
  // The files are kept in Document Management's encrypted store, so its backups keep them too.
  const forms = registerForms(route, db, {
    blobs: docs.blobs, audit,
    opensModule: (u, id) => Boolean(moduleAccess(u, { modules: db.data.modules, inProjects: isProjectMember(db, u), isApprover: isApprover(db, u) }).find((m) => m.id === id)?.home),
  });
  // ----- CUSTOM APP (server/customapp, 0.71): events, check-in and seating -----
  // The event outbox sends through the helpdesk's outgoing mail transport (one place for SMTP).
  const customapp = registerCustomApp(route, db, { audit, limits, requirePassword, monitor, transport: helpdesk.transport, ...(eventOutbox ? { outbox: eventOutbox } : {}) });
  // The rate limits give staff sign-in more room while an event's doors are open (0.70.1).
  eventWindowOpen = customapp.eventWindowOpen;
  // ----- Notifications: the bell in the top bar (server/notifications.js) -----
  registerNotificationRoutes(route, db, { pm: projects.notifications });
  // ----- Admin panel: Settings center, Roles & permissions, Modules, Dashboard (server/config.js) -----
  const admin = registerAdminRoutes(route, db, { invoke, audit, sessionCount: (id) => sessions.list(id).length, openEvents: customapp.openEvents });
  // Admin panel → Security monitor, the health check and the metrics export (0.34).
  registerMonitorRoutes(route, { db, monitor, audit, sec, rateLimits, routes, sessions: () => sessions.active() });
  // ----- Audit log (Administrators) -----
  route('GET', '/api/audit', 'audit.view', ({ query }) => ({ ...audit.list(query), users: users().map((u) => ({ id: u.id, name: u.name })) }));
  route('GET', '/api/audit/verify', 'audit.view', () => audit.verify());
  // The build's details (Node version, commit, branch) are for Administrators; others see the version.
  route('GET', '/api/system/about', 'devlog.view', ({ user }) => (userCan(user, 'users.manage') ? { version: APP_VERSION, node: process.version, ...buildInfo() } : { version: APP_VERSION }));
  route('POST', '/api/admin/reset', 'data.manage', () => {
    replaceData(db, { ...emptyData(), users: users().filter((u) => !u.demo) }, { keepAdmin: true });
    // The demo event goes with the demo accounts; a real event stays as it is (see replaceData).
    removeDemoEvents(db);
    db.save();
    audit.record('data.reset', { label: 'All company data erased', note: 'The audit log is kept' });
    return { ok: true };
  });

  // Whether `user` may use route `r` (null: signed out), or why not. A module the company turned
  // off is refused for everyone but administrators, and on the public form too.
  function authorize(r, user, method, pathname) {
    if (r.permission !== 'public') {
      if (!user) throw new HttpError(401, 'Please sign in.');
      if (user.mustChangePassword && !r.duringPasswordChange) throw new HttpError(403, 'Please change your password first.');
      if (!r.duringPasswordChange && twoFactorRequired(sec(), user) && !user.twoFactor?.enabledAt) throw new HttpError(403, 'Set up 2-step verification first.');
    }
    const mod = moduleOfApi(method, pathname);
    if (mod && !moduleOn(db.data.modules, mod) && user?.role !== 'admin') throw new HttpError(403, `${moduleName(mod)} is turned off for the company. An administrator can turn it on in the Admin panel, under Modules.`);
    // An account type confined to some modules (Event staff: CUSTOM APP only) gets no other module's API.
    const only = confinedTo(user);
    if (mod && only && !only.includes(mod)) throw new HttpError(403, `Your account type opens ${only.map(moduleName).join(', ')} only.`);
    if (r.permission !== 'public' && r.permission !== 'auth' && !userCan(user, r.permission)) throw new HttpError(403, 'Your account does not have access to this.');
  }
  const paramsOf = (r, m) => {
    try {
      return Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    } catch {
      throw new HttpError(404, 'Not found.');
    }
  };

  // Runs one of CORE's own routes as `user`, inside the request being handled, with the same checks
  // as a request from the browser (the Settings center saves through each screen's route this way).
  // Only routes that answer at once are used.
  function invoke(user, method, pathname, body = {}) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      authorize(r, user, method, pathname);
      const a = currentActor();
      const result = r.handler({ params: paramsOf(r, m), body: structuredClone(body ?? {}), query: {}, user, token: null, ip: a?.ip || '', client: a?.client || {}, origin: a?.origin });
      if (result && typeof result.then === 'function') throw new Error(`${method} ${r.pattern} cannot be called from the Settings center.`);
      return result;
    }
    throw new HttpError(404, 'Not found.');
  }

  // Returns { data, headers }. handle.helpdesk exposes the mail poller (used by tests).
  async function handle(req, url, body) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    // The route that answers, known before any check, so the monitor counts a refusal under it.
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    req.coreRoute = r ? r.pattern : null;
    // The bell's count is polled in the background: it does not keep an idle session alive.
    const session = sessions.get(token, { touch: !(req.method === 'GET' && url.pathname === '/api/notifications/count') });
    const user = session && users().find((u) => u.id === session.userId && u.active);
    const ip = clientIp(req);
    const client = { ip, ua: String(req.headers?.['user-agent'] || '').slice(0, 300), https: isHttps(req) };
    req.coreUser = user?.id || null;
    const eventPublic = url.pathname.startsWith('/api/public/event/');
    try {
      if (user) limits.hit('api-user', user.id);
      else if (eventPublic) limits.hit('event-ip', ip, 'Too many requests from this network. Wait a minute, then try again.');
      else limits.hit('api-anon', ip);
    } catch (err) {
      // An event's health strip counts its 429s (CUSTOM APP, 0.73).
      if (err.status === 429) customapp.note429(url.pathname);
      throw err;
    }
    if (req.method === 'POST' && /^\/api\/auth\/(login|setup|2fa)$/.test(url.pathname)) limits.hit('auth', ip, 'Too many sign-in attempts from this network.');
    if (req.method !== 'GET' && url.pathname.startsWith('/api/public/') && !eventPublic) limits.hit('public-write', ip, 'Too many messages from this network.');
    // Several CORE servers can share one process (the tests): each request uses its own company's roles.
    setRoleOverrides(db.data.roleOverrides);
    if (r) {
      const m = url.pathname.match(r.re);
      authorize(r, user, req.method, url.pathname);
      const params = paramsOf(r, m);
      const actor = { user, ip, client, origin: publicOrigin(req), before: audit.count() };
      // A settings screen's save is recorded in the Settings center's history, before and after.
      const recordSettings = admin.settingsWatch(req.method, url.pathname);
      const result = await withActor(actor, () => r.handler({ params, body, query: Object.fromEntries(url.searchParams), user, token, ip, client, origin: publicOrigin(req), headers: req.headers || {} }));
      recordSettings?.(user);
      // A change with no entry of its own is still recorded, with its route (never its body).
      if (req.method !== 'GET' && user && audit.count() === actor.before && !UNAUDITED.test(url.pathname)) {
        const data = result && result.headers && 'data' in result ? result.data : result;
        audit.record(`${areaOfPath(url.pathname)}.change`, { entityId: params.id || params.userId || (typeof data?.id === 'string' ? data.id : ''), label: `${req.method} ${r.pattern}`, actor });
      }
      return result && result.headers && 'data' in result ? result : { data: result, headers: {} };
    }
    throw new HttpError(404, 'Not found.');
  }
  handle.helpdesk = helpdesk;
  handle.pdfStudio = handlePdf;
  handle.documents = docs;
  handle.forms = forms;
  handle.monitor = monitor;
  // CUSTOM APP's guest-page gate and safety nets (tests read them).
  handle.customapp = customapp;
  handle.projects = projects;
  // Whether the request carries a live session (server.js allows large uploads only then).
  handle.signedIn = (req) => {
    try {
      const session = sessions.get(parseCookies(req.headers?.cookie)[SESSION_COOKIE], { touch: false });
      return Boolean(session && users().some((u) => u.id === session.userId && u.active));
    } catch {
      return false;
    }
  };
  return handle;
}
