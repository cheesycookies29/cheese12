// Leave types, leave credits and balances, and leave / remote-work requests with approval.
import { randomUUID } from 'node:crypto';
import { HttpError, localDate } from './util.js';
import { workDates, genderAllows, needsCertificate, LEAVE_GENDERS, DEFAULT_LEAVE_TYPES } from '../shared/leave.js';
import { parseUpload } from './attachments.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REQUEST_DAYS = 180;

export function findLeaveType(db, id) {
  const type = db.data.leaveTypes.find((t) => t.id === id);
  if (!type) throw new HttpError(404, 'Leave type not found.');
  return type;
}

// Leave types saved by older builds lack the gender and certificate rules: take them
// from the built-in defaults (Maternity: women, Paternity: men, Sick Leave: over 3 days).
export function migrateLeaveTypes(db) {
  let changed = false;
  for (const t of db.data.leaveTypes) {
    const builtIn = DEFAULT_LEAVE_TYPES.find((d) => d.id === t.id);
    for (const k of ['gender', 'certificateAfterDays']) {
      if (!(k in t)) {
        t[k] = builtIn ? builtIn[k] : null;
        changed = true;
      }
    }
  }
  return changed;
}

const firstName = (emp) => emp?.firstName || 'this employee';
// Why an employee can't have a gender-limited leave type, or null if they can.
export function genderBlock(type, emp, { self = false } = {}) {
  if (genderAllows(type, emp)) return null;
  const rule = `${type.name} is for ${type.gender.toLowerCase()} employees only`;
  if (!emp?.gender) return self ? `${rule}, and your record has no gender. Ask HR to update your profile.` : `${rule}. Set the gender on ${firstName(emp)}'s employee record first.`;
  return self ? `${rule}.` : `${rule}; ${firstName(emp)}'s record says ${emp.gender}.`;
}

function findRequest(db, id) {
  const req = db.data.requests.find((r) => r.id === id);
  if (!req) throw new HttpError(404, 'Request not found.');
  return req;
}

function validateLeaveType(input, db, existingId) {
  const t = {
    code: String(input.code || '').trim().toUpperCase(),
    name: String(input.name || '').trim(),
    paid: input.paid !== false,
    annualCredits: input.annualCredits === '' || input.annualCredits == null ? null : Number(input.annualCredits),
    active: input.active !== false,
    // 'all' = every employee unless an admin removes it for someone; 'selected' = only employees an admin adds.
    appliesTo: input.appliesTo === 'selected' ? 'selected' : 'all',
    gender: LEAVE_GENDERS[input.gender] ? input.gender : null,
    certificateAfterDays: input.certificateAfterDays === '' || input.certificateAfterDays == null ? null : Number(input.certificateAfterDays),
  };
  if (!/^[A-Z0-9]{1,8}$/.test(t.code)) throw new HttpError(400, 'Code must be 1–8 letters or digits.');
  if (!t.name) throw new HttpError(400, 'Name is required.');
  if (t.annualCredits !== null && !(t.annualCredits >= 0 && t.annualCredits <= 366)) throw new HttpError(400, 'Annual credits must be between 0 and 366, or blank for no limit.');
  if (t.certificateAfterDays !== null && !(Number.isInteger(t.certificateAfterDays) && t.certificateAfterDays >= 0 && t.certificateAfterDays <= 365)) {
    throw new HttpError(400, 'Medical certificate: enter a whole number of days (0 = always required), or leave it blank.');
  }
  if (db.data.leaveTypes.some((x) => x.code === t.code && x.id !== existingId)) throw new HttpError(400, `Code ${t.code} is already used.`);
  return t;
}

// Whether an employee gets a leave type: never if the type is limited to another gender;
// otherwise an admin's choice for that person, else the type's default.
export function offeredTo(db, employeeId, type) {
  if (!genderAllows(type, db.data.employees.find((e) => e.id === employeeId))) return false;
  const access = db.data.leaveAccess.find((a) => a.employeeId === employeeId && a.leaveTypeId === type.id);
  return access ? access.offered : type.appliesTo !== 'selected';
}

// Credits, adjustments, used and pending days per leave type for one employee and calendar year.
// Used days are counted from leave entries in the DTR, so leave recorded by HR counts too.
export function leaveBalances(db, employeeId, year) {
  const y = String(year);
  const emp = db.data.employees.find((e) => e.id === employeeId);
  return db.data.leaveTypes.map((t) => {
    const override = db.data.leaveCredits.find((c) => c.employeeId === employeeId && c.year === Number(year) && c.leaveTypeId === t.id);
    const credits = override ? override.credits : t.annualCredits;
    const adjusted = db.data.leaveAdjustments
      .filter((a) => a.employeeId === employeeId && a.year === Number(year) && a.leaveTypeId === t.id)
      .reduce((sum, a) => sum + a.days, 0);
    const used = db.data.timeEntries.filter((e) => e.employeeId === employeeId && e.type === 'leave' && e.leaveTypeId === t.id && e.date.startsWith(y)).length;
    const pending = db.data.requests
      .filter((r) => r.employeeId === employeeId && r.status === 'pending' && r.kind === 'leave' && r.leaveTypeId === t.id && r.startDate.startsWith(y))
      .reduce((a, r) => a + r.days, 0);
    return {
      leaveTypeId: t.id, code: t.code, name: t.name, paid: t.paid, active: t.active, offered: offeredTo(db, employeeId, t),
      gender: t.gender || null, eligible: genderAllows(t, emp), certificateAfterDays: t.certificateAfterDays ?? null,
      credits, overridden: Boolean(override), adjusted, used, pending, remaining: credits == null ? null : credits + adjusted - used - pending,
    };
  });
}

function withEmployee(db, req) {
  const emp = db.data.employees.find((e) => e.id === req.employeeId);
  const type = req.leaveTypeId && db.data.leaveTypes.find((t) => t.id === req.leaveTypeId);
  return {
    ...req,
    employeeName: emp ? `${emp.lastName}, ${emp.firstName}` : '(deleted employee)',
    employeeNo: emp?.employeeNo || '',
    typeName: req.kind === 'remote' ? 'Remote work' : type?.name || 'Leave',
    certificateRequired: req.kind === 'leave' && needsCertificate(type, req.days),
  };
}

function overlaps(a, b) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

function buildRequest(db, employee, user, body, upload) {
  const kind = body.kind === 'remote' ? 'remote' : 'leave';
  const { startDate, endDate } = body;
  if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '')) throw new HttpError(400, 'Pick a start and end date.');
  if (endDate < startDate) throw new HttpError(400, 'The end date must be on or after the start date.');
  const dates = workDates(employee, db.data.settings, startDate, endDate);
  if (!dates.length) throw new HttpError(400, 'There are no scheduled work days in that range.');
  if (dates.length > MAX_REQUEST_DAYS) throw new HttpError(400, `A request can cover at most ${MAX_REQUEST_DAYS} work days.`);
  const reason = String(body.reason || '').trim().slice(0, 500);

  let leaveTypeId = null;
  if (kind === 'leave') {
    const type = findLeaveType(db, body.leaveTypeId);
    if (!type.active) throw new HttpError(400, `${type.name} is no longer offered.`);
    const block = genderBlock(type, employee, { self: true });
    if (block) throw new HttpError(400, block);
    if (!offeredTo(db, employee.id, type)) throw new HttpError(400, `${type.name} is not available to you. Ask HR if you think it should be.`);
    leaveTypeId = type.id;
    const bal = leaveBalances(db, employee.id, startDate.slice(0, 4)).find((b) => b.leaveTypeId === type.id);
    if (bal.remaining !== null && dates.length > bal.remaining) {
      throw new HttpError(400, `Not enough ${type.name} credits: ${Math.max(0, bal.remaining)} day(s) left, ${dates.length} requested.`);
    }
    if (needsCertificate(type, dates.length) && !upload) {
      throw new HttpError(400, `${type.name} of more than ${type.certificateAfterDays} day${type.certificateAfterDays === 1 ? '' : 's'} needs a medical certificate. This request is ${dates.length} work days; attach the certificate (PDF or photo) and submit again.`);
    }
  }
  const clash = db.data.requests.find((r) => r.employeeId === employee.id && ['pending', 'approved'].includes(r.status) && overlaps(r, { startDate, endDate }));
  if (clash) throw new HttpError(400, `This overlaps another ${clash.status} request (${clash.startDate} to ${clash.endDate}).`);

  return {
    id: randomUUID(), employeeId: employee.id, kind, leaveTypeId, startDate, endDate, days: dates.length, reason,
    status: 'pending', filedAt: new Date().toISOString(), filedBy: user.id,
  };
}

function decide(req, user, status, note) {
  Object.assign(req, { status, decidedAt: new Date().toISOString(), decidedBy: user.id, decidedByName: user.name, decisionNote: String(note || '').trim().slice(0, 500) });
}

// Approving writes the request into the DTR: one leave entry, or one remote-work entry, per scheduled day.
function approve(db, req, user, note) {
  if (req.status !== 'pending') throw new HttpError(400, `This request is already ${req.status}.`);
  if (user.employeeId && user.employeeId === req.employeeId) throw new HttpError(403, 'You cannot approve your own request. Another approver must do it.');
  const employee = db.data.employees.find((e) => e.id === req.employeeId);
  if (!employee) throw new HttpError(400, 'The employee record no longer exists.');
  const dates = workDates(employee, db.data.settings, req.startDate, req.endDate);
  const existing = db.data.timeEntries.filter((e) => e.employeeId === employee.id && dates.includes(e.date));

  if (req.kind === 'leave') {
    if (existing.length) {
      throw new HttpError(400, `Attendance is already recorded on ${existing.map((e) => e.date).sort().join(', ')}. Edit or remove those records first.`);
    }
    const type = findLeaveType(db, req.leaveTypeId);
    const block = genderBlock(type, employee);
    if (block) throw new HttpError(400, `Cannot approve: ${block}`);
    if (needsCertificate(type, req.days) && !req.attachment) {
      throw new HttpError(400, `Cannot approve yet: ${type.name} of more than ${type.certificateAfterDays} days needs a medical certificate, and none is attached. The employee can attach it under My Requests.`);
    }
    const bal = leaveBalances(db, employee.id, req.startDate.slice(0, 4)).find((b) => b.leaveTypeId === type.id);
    if (bal.remaining !== null && bal.remaining < 0) throw new HttpError(400, `Not enough ${type.name} credits left to approve this request.`);
    for (const date of dates) {
      db.data.timeEntries.push({
        id: randomUUID(), employeeId: employee.id, date, type: 'leave', leaveTypeId: type.id, paid: type.paid,
        timeIn: null, timeOut: null, otApproved: false, remote: false, notes: `${type.name} (approved request)`, requestId: req.id,
      });
    }
  } else {
    const onLeave = existing.filter((e) => e.type === 'leave');
    if (onLeave.length) throw new HttpError(400, `The employee is on leave on ${onLeave.map((e) => e.date).join(', ')}.`);
    for (const date of dates) {
      const entry = existing.find((e) => e.date === date);
      if (entry) Object.assign(entry, { remote: true, remoteRequestId: req.id });
      else {
        db.data.timeEntries.push({
          id: randomUUID(), employeeId: employee.id, date, type: 'work', timeIn: null, timeOut: null,
          otApproved: false, remote: true, notes: 'Remote work (approved request)', requestId: req.id,
        });
      }
    }
  }
  decide(req, user, 'approved', note);
}

// Undo what approval wrote. Remote days the employee already clocked on are kept as normal work days.
function cancel(db, req, user, note) {
  if (!['pending', 'approved'].includes(req.status)) throw new HttpError(400, `This request is already ${req.status}.`);
  if (req.status === 'approved') {
    db.data.timeEntries = db.data.timeEntries.filter((e) => {
      if (e.requestId === req.id && (e.type === 'leave' || !e.timeIn)) return false;
      if (e.requestId === req.id || e.remoteRequestId === req.id) {
        e.remote = false;
        delete e.requestId;
        delete e.remoteRequestId;
      }
      return true;
    });
  }
  Object.assign(req, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: user.id, cancelledByName: user.name });
  if (note) req.decisionNote = String(note).trim().slice(0, 500);
}

export function registerLeaveRoutes(route, db, { linkedEmployee, files }) {
  // Pending first, then newest filed first.
  const sortRequests = (list) => list.sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.filedAt.localeCompare(a.filedAt));

  // ----- Leave types -----
  route('GET', '/api/leave-types', 'auth', () => db.data.leaveTypes);
  route('POST', '/api/leave-types', 'leave.manage', ({ body }) => {
    const type = { id: randomUUID(), ...validateLeaveType(body, db) };
    db.data.leaveTypes.push(type);
    db.save();
    return type;
  });
  route('PUT', '/api/leave-types/:id', 'leave.manage', ({ params, body }) => {
    const type = findLeaveType(db, params.id);
    Object.assign(type, validateLeaveType(body, db, type.id));
    // Keep the paid flag on future leave entries in step with the type.
    for (const e of db.data.timeEntries) if (e.leaveTypeId === type.id && e.date >= localDate()) e.paid = type.paid;
    db.save();
    return type;
  });
  route('DELETE', '/api/leave-types/:id', 'leave.manage', ({ params }) => {
    const type = findLeaveType(db, params.id);
    const used = db.data.timeEntries.some((e) => e.leaveTypeId === type.id) || db.data.requests.some((r) => r.leaveTypeId === type.id);
    if (used) throw new HttpError(400, `${type.name} has been used. Mark it inactive instead of deleting it.`);
    db.data.leaveTypes = db.data.leaveTypes.filter((t) => t.id !== type.id);
    db.data.leaveCredits = db.data.leaveCredits.filter((c) => c.leaveTypeId !== type.id);
    db.data.leaveAccess = db.data.leaveAccess.filter((a) => a.leaveTypeId !== type.id);
    db.data.leaveAdjustments = db.data.leaveAdjustments.filter((a) => a.leaveTypeId !== type.id);
    db.save();
    return { ok: true };
  });

  // ----- Credits and balances -----
  route('GET', '/api/leave-balances', 'leave.manage', ({ query }) => {
    const year = Number(query.year) || new Date().getFullYear();
    return db.data.employees
      .filter((e) => e.status === 'Active')
      .sort((a, b) => a.lastName.localeCompare(b.lastName))
      .map((e) => ({ employeeId: e.id, employeeNo: e.employeeNo, name: `${e.lastName}, ${e.firstName}`, balances: leaveBalances(db, e.id, year) }));
  });
  route('PUT', '/api/leave-credits', 'leave.manage', ({ body }) => {
    const year = Number(body.year);
    if (!(year >= 2000 && year <= 2100)) throw new HttpError(400, 'Pick a valid year.');
    if (!db.data.employees.some((e) => e.id === body.employeeId)) throw new HttpError(404, 'Employee not found.');
    const type = findLeaveType(db, body.leaveTypeId);
    db.data.leaveCredits = db.data.leaveCredits.filter((c) => !(c.employeeId === body.employeeId && c.year === year && c.leaveTypeId === type.id));
    if (body.credits !== null && body.credits !== '') {
      const credits = Number(body.credits);
      if (!(credits >= 0 && credits <= 366)) throw new HttpError(400, 'Credits must be between 0 and 366.');
      db.data.leaveCredits.push({ employeeId: body.employeeId, year, leaveTypeId: type.id, credits, updatedAt: new Date().toISOString() });
    }
    db.save();
    return leaveBalances(db, body.employeeId, year);
  });

  // ----- One employee's leave, adjusted by an administrator -----
  const employeeOf = (id) => {
    const emp = db.data.employees.find((e) => e.id === id);
    if (!emp) throw new HttpError(404, 'Employee not found.');
    return emp;
  };
  const yearOf = (v) => {
    const year = Number(v);
    if (!(year >= 2000 && year <= 2100)) throw new HttpError(400, 'Pick a valid year.');
    return year;
  };
  const typeName = (id) => db.data.leaveTypes.find((t) => t.id === id)?.name || '(deleted leave type)';
  // Pay periods already finalized, so a change on those dates won't reach payslips already issued.
  const finalizedOn = (dates) => db.data.payrollRuns.filter((r) => r.status === 'finalized' && dates.some((d) => d >= r.periodStart && d <= r.periodEnd));
  const employeeLeave = (emp, year) => ({
    employee: { id: emp.id, name: `${emp.firstName} ${emp.lastName}`, employeeNo: emp.employeeNo, department: emp.department || '', status: emp.status, hireDate: emp.hireDate || null, gender: emp.gender || '' },
    year,
    balances: leaveBalances(db, emp.id, year),
    // Reversed first so adjustments saved in the same instant stay newest first.
    adjustments: db.data.leaveAdjustments.filter((a) => a.employeeId === emp.id && a.year === year).reverse().sort((a, b) => b.at.localeCompare(a.at))
      .map((a) => ({ ...a, typeName: typeName(a.leaveTypeId) })),
    leaveDays: db.data.timeEntries.filter((e) => e.employeeId === emp.id && e.type === 'leave' && e.date.startsWith(String(year))).sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => ({ id: e.id, date: e.date, leaveTypeId: e.leaveTypeId, typeName: typeName(e.leaveTypeId), paid: e.paid !== false, notes: e.notes || '',
        source: e.requestId ? 'request' : e.manualLeave ? 'admin' : 'attendance', requestId: e.requestId || null })),
  });

  route('GET', '/api/employees/:id/leave', 'leave.adjust', ({ params, query }) =>
    employeeLeave(employeeOf(params.id), yearOf(query.year || new Date().getFullYear())));

  // Give or take away a leave type for one employee; offered = null goes back to the type's default.
  route('PUT', '/api/employees/:id/leave-access', 'leave.adjust', ({ params, body, user }) => {
    const emp = employeeOf(params.id);
    const type = findLeaveType(db, body.leaveTypeId);
    const block = body.offered === true && genderBlock(type, emp);
    if (block) throw new HttpError(400, block);
    db.data.leaveAccess = db.data.leaveAccess.filter((a) => !(a.employeeId === emp.id && a.leaveTypeId === type.id));
    if (body.offered === true || body.offered === false) {
      db.data.leaveAccess.push({ employeeId: emp.id, leaveTypeId: type.id, offered: body.offered, updatedAt: new Date().toISOString(), updatedBy: user.name });
    }
    db.save();
    return employeeLeave(emp, yearOf(body.year || new Date().getFullYear()));
  });

  // Add or take away days, with a reason (carry-over, correction, offset…).
  route('POST', '/api/employees/:id/leave-adjustments', 'leave.adjust', ({ params, body, user }) => {
    const emp = employeeOf(params.id);
    const type = findLeaveType(db, body.leaveTypeId);
    const year = yearOf(body.year);
    const days = Number(body.days);
    if (!days || Math.abs(days) > 366 || Math.round(days * 2) !== days * 2) throw new HttpError(400, 'Enter the number of days to add or take away, in half days (e.g. 2, -1 or 0.5).');
    const reason = String(body.reason || '').trim().slice(0, 300);
    if (!reason) throw new HttpError(400, 'Say why, e.g. "carry-over from last year" or "correction".');
    const bal = leaveBalances(db, emp.id, year).find((b) => b.leaveTypeId === type.id);
    if (bal.credits == null) throw new HttpError(400, `${type.name} has no day limit, so there is no balance to adjust. Set credits for this employee first if you want to track it.`);
    db.data.leaveAdjustments.push({ id: randomUUID(), employeeId: emp.id, leaveTypeId: type.id, year, days, reason, at: new Date().toISOString(), by: user.name });
    db.save();
    return employeeLeave(emp, year);
  });
  route('DELETE', '/api/employees/:id/leave-adjustments/:adjId', 'leave.adjust', ({ params }) => {
    const emp = employeeOf(params.id);
    const adj = db.data.leaveAdjustments.find((a) => a.id === params.adjId && a.employeeId === emp.id);
    if (!adj) throw new HttpError(404, 'Adjustment not found.');
    db.data.leaveAdjustments = db.data.leaveAdjustments.filter((a) => a.id !== adj.id);
    db.save();
    return employeeLeave(emp, adj.year);
  });

  // Record leave the employee took (e.g. filed on paper): one DTR leave entry per scheduled work day.
  route('POST', '/api/employees/:id/leave-days', 'leave.adjust', ({ params, body, user }) => {
    const emp = employeeOf(params.id);
    const type = findLeaveType(db, body.leaveTypeId);
    const block = genderBlock(type, emp);
    if (block) throw new HttpError(400, block);
    const { startDate, endDate } = body;
    if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '')) throw new HttpError(400, 'Pick a start and end date.');
    if (endDate < startDate) throw new HttpError(400, 'The end date must be on or after the start date.');
    if (startDate.slice(0, 4) !== endDate.slice(0, 4)) throw new HttpError(400, 'Record leave one calendar year at a time.');
    const dates = workDates(emp, db.data.settings, startDate, endDate);
    if (!dates.length) throw new HttpError(400, 'There are no scheduled work days in that range.');
    if (dates.length > MAX_REQUEST_DAYS) throw new HttpError(400, `At most ${MAX_REQUEST_DAYS} work days at a time.`);
    const taken = db.data.timeEntries.filter((e) => e.employeeId === emp.id && dates.includes(e.date));
    if (taken.length) throw new HttpError(400, `Attendance is already recorded on ${taken.map((e) => e.date).sort().join(', ')}. Edit or remove those days in the DTR first.`);
    const year = Number(startDate.slice(0, 4));
    const bal = leaveBalances(db, emp.id, year).find((b) => b.leaveTypeId === type.id);
    if (bal.remaining !== null && dates.length > bal.remaining && !body.allowOverdraw) {
      throw new HttpError(400, `That is ${dates.length} day(s) but only ${Math.max(0, bal.remaining)} ${type.name} day(s) are left. Tick "Allow going over the balance" to record it anyway.`);
    }
    const note = String(body.note || '').trim().slice(0, 200);
    for (const date of dates) {
      db.data.timeEntries.push({
        id: randomUUID(), employeeId: emp.id, date, type: 'leave', leaveTypeId: type.id, paid: type.paid,
        timeIn: null, timeOut: null, otApproved: false, remote: false, manualLeave: true,
        notes: `${type.name} (recorded by ${user.name})${note ? `: ${note}` : ''}`,
      });
    }
    db.save();
    const runs = finalizedOn(dates);
    return { ...employeeLeave(emp, year), recorded: dates.length, warning: runs.length ? `Payroll for ${runs.map((r) => `${r.periodStart} to ${r.periodEnd}`).join(', ')} is already finalized, so those payslips are unchanged.` : null };
  });
  route('DELETE', '/api/employees/:id/leave-days/:entryId', 'leave.adjust', ({ params }) => {
    const emp = employeeOf(params.id);
    const entry = db.data.timeEntries.find((e) => e.id === params.entryId && e.employeeId === emp.id && e.type === 'leave');
    if (!entry) throw new HttpError(404, 'Leave day not found.');
    if (entry.requestId) throw new HttpError(400, 'This day comes from an approved request. Cancel the request under Requests instead, so the employee sees it.');
    db.data.timeEntries = db.data.timeEntries.filter((e) => e.id !== entry.id);
    db.save();
    const runs = finalizedOn([entry.date]);
    return { ...employeeLeave(emp, Number(entry.date.slice(0, 4))), warning: runs.length ? 'Payroll for that date is already finalized, so the payslip is unchanged.' : null };
  });

  // ----- Requests (HR / payroll view, HR / admin decide) -----
  route('GET', '/api/requests', 'leave.manage', ({ query }) =>
    sortRequests(db.data.requests.filter((r) => !query.status || r.status === query.status).map((r) => withEmployee(db, r))),
  );
  route('GET', '/api/requests/summary', 'leave.manage', () => ({ pending: db.data.requests.filter((r) => r.status === 'pending').length }));
  route('GET', '/api/requests/:id/attachment', 'leave.manage', ({ params }) => files.read(findRequest(db, params.id).attachment));
  route('POST', '/api/requests/:id/approve', 'leave.approve', ({ params, body, user }) => {
    const req = findRequest(db, params.id);
    approve(db, req, user, body.note);
    db.save();
    return withEmployee(db, req);
  });
  route('POST', '/api/requests/:id/reject', 'leave.approve', ({ params, body, user }) => {
    const req = findRequest(db, params.id);
    if (req.status !== 'pending') throw new HttpError(400, `This request is already ${req.status}.`);
    if (user.employeeId && user.employeeId === req.employeeId) throw new HttpError(403, 'You cannot decide on your own request.');
    decide(req, user, 'rejected', body.note);
    db.save();
    return withEmployee(db, req);
  });
  route('POST', '/api/requests/:id/cancel', 'leave.approve', ({ params, body, user }) => {
    const req = findRequest(db, params.id);
    cancel(db, req, user, body.note);
    db.save();
    return withEmployee(db, req);
  });

  // ----- Employee self-service -----
  route('GET', '/api/me/requests', 'self', ({ user }) => {
    const emp = linkedEmployee(user);
    return sortRequests(db.data.requests.filter((r) => r.employeeId === emp.id).map((r) => withEmployee(db, r)));
  });
  route('POST', '/api/me/requests', 'self', ({ user, body }) => {
    const emp = linkedEmployee(user);
    if (emp.status !== 'Active') throw new HttpError(400, 'Inactive employees cannot file requests.');
    const upload = body.kind !== 'remote' && body.attachment ? parseUpload(body.attachment) : null;
    const req = buildRequest(db, emp, user, body, upload);
    if (upload) req.attachment = files.save(upload);
    db.data.requests.push(req);
    db.save();
    return withEmployee(db, req);
  });
  route('POST', '/api/me/requests/:id/cancel', 'self', ({ user, params }) => {
    const emp = linkedEmployee(user);
    const req = findRequest(db, params.id);
    if (req.employeeId !== emp.id) throw new HttpError(404, 'Request not found.');
    if (req.status !== 'pending') throw new HttpError(400, 'Only pending requests can be withdrawn. Ask HR to cancel an approved one.');
    cancel(db, req, user);
    db.save();
    return withEmployee(db, req);
  });
  const ownRequest = (user, id) => {
    const emp = linkedEmployee(user);
    const req = findRequest(db, id);
    if (req.employeeId !== emp.id) throw new HttpError(404, 'Request not found.');
    return req;
  };
  route('GET', '/api/me/requests/:id/attachment', 'self', ({ user, params }) => files.read(ownRequest(user, params.id).attachment));
  // Attach or replace the medical certificate on a pending leave request.
  route('PUT', '/api/me/requests/:id/attachment', 'self', ({ user, params, body }) => {
    const req = ownRequest(user, params.id);
    if (req.kind !== 'leave') throw new HttpError(400, 'Files can only be attached to leave requests.');
    if (req.status !== 'pending') throw new HttpError(400, 'The certificate can only be changed while the request is pending.');
    const upload = parseUpload(body.attachment);
    const old = req.attachment;
    req.attachment = files.save(upload);
    db.save();
    files.remove(old);
    return withEmployee(db, req);
  });
  route('GET', '/api/me/leave-balances', 'self', ({ user, query }) => {
    const emp = linkedEmployee(user);
    return leaveBalances(db, emp.id, Number(query.year) || new Date().getFullYear()).filter((b) => b.active && b.offered);
  });
}
