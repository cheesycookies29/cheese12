// Leave types, leave credits and balances, and leave / remote-work requests with approval.
import { randomUUID } from 'node:crypto';
import { HttpError, localDate } from './util.js';
import { isDayOff, HOLIDAY_TYPES } from '../shared/holidays.js';
import { workDates, genderAllows, needsCertificate, LEAVE_GENDERS, DEFAULT_LEAVE_TYPES, PORTIONS, portionDays, OPEN_REQUEST, REQUEST_KINDS, APPROVER_TYPES, APPROVAL_FLOWS } from '../shared/leave.js';
import { parseUpload } from './attachments.js';
import { routeRequest, decideStep, addHistory, canDecide, isCurrentApprover, isOnRoute, directReports, approvalSettings } from './approvals.js';
import { userCan } from '../shared/roles.js';

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
    for (const k of ['gender', 'certificateAfterDays', 'advanceDays']) {
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
    advanceDays: input.advanceDays === '' || input.advanceDays == null ? null : Number(input.advanceDays),
  };
  if (t.advanceDays !== null && !(Number.isInteger(t.advanceDays) && t.advanceDays >= 0 && t.advanceDays <= 90)) throw new HttpError(400, 'File-ahead rule: a whole number of days from 0 to 90, or blank.');
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
    // Whole leave days, plus half days recorded on a work day.
    const used = db.data.timeEntries.reduce((n, e) => {
      if (e.employeeId !== employeeId || !e.date.startsWith(y)) return n;
      if (e.type === 'leave' && e.leaveTypeId === t.id) return n + 1;
      if (e.halfLeave?.leaveTypeId === t.id) return n + 0.5;
      return n;
    }, 0);
    // Days waiting for approval, counted against the type they would use (overflow days go to Leave Without Pay).
    const pending = db.data.requests
      .filter((r) => r.employeeId === employeeId && OPEN_REQUEST.includes(r.status) && r.kind === 'leave' && r.startDate.startsWith(y))
      .reduce((a, r) => a + requestDaysOf(r, t.id), 0);
    return {
      leaveTypeId: t.id, code: t.code, name: t.name, paid: t.paid, active: t.active, offered: offeredTo(db, employeeId, t),
      gender: t.gender || null, eligible: genderAllows(t, emp), certificateAfterDays: t.certificateAfterDays ?? null,
      credits, overridden: Boolean(override), adjusted, used, pending, remaining: credits == null ? null : credits + adjusted - used - pending,
    };
  });
}

// Days of a request that count against a leave type (its paid days, or its overflow on Leave Without Pay).
function requestDaysOf(req, typeId) {
  if (!req.breakdown) return req.leaveTypeId === typeId ? req.days : 0;
  return req.breakdown.reduce((n, d) => n + ((d.overflow ? 'lwop' : req.leaveTypeId) === typeId ? portionDays(d.portion) : 0), 0);
}

function withEmployee(db, req, viewer) {
  const emp = db.data.employees.find((e) => e.id === req.employeeId);
  const type = req.leaveTypeId && db.data.leaveTypes.find((t) => t.id === req.leaveTypeId);
  const sup = emp?.supervisorId && db.data.employees.find((e) => e.id === emp.supervisorId);
  return {
    ...req,
    employeeName: emp ? `${emp.lastName}, ${emp.firstName}` : '(deleted employee)',
    employeeNo: emp?.employeeNo || '',
    department: emp?.department || '',
    supervisorName: sup ? `${sup.firstName} ${sup.lastName}` : null,
    typeName: req.kind === 'leave' ? type?.name || 'Leave' : REQUEST_KINDS[req.kind] || 'Work from home',
    certificateRequired: req.kind === 'leave' && needsCertificate(type, req.days),
    waitingOn: req.status === 'pending' ? (req.approvals || []).filter((l) => l.status === 'pending').map((l) => l.label) : [],
    ...(viewer ? { canDecide: canDecide(req, viewer), yourTurn: isCurrentApprover(req, viewer) } : {}),
  };
}

function overlaps(a, b) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

// Why a date range has nothing to file: only rest days, or holidays (named).
function noWorkDays(db, start, end) {
  const off = (db.data.holidays || []).filter((h) => h.date >= start && h.date <= end && isDayOff(h));
  if (!off.length) return 'There are no scheduled work days in that range.';
  return `There are no work days to file in that range: ${off.map((h) => `${h.date} is ${h.name} (${HOLIDAY_TYPES[h.type].toLowerCase()})`).join('; ')}.`;
}

// Builds (or rebuilds, for a resubmission) a request from the form. Leave dates can be whole days
// or a first or second half; days beyond the remaining credits go to Leave Without Pay when it is
// offered (Sprout labels them "without pay"), otherwise the request is refused.
function buildRequest(db, employee, user, body, upload, { existingId = null, byHr = false } = {}) {
  const kind = REQUEST_KINDS[body.kind] ? body.kind : 'leave';
  const { startDate, endDate } = body;
  if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '')) throw new HttpError(400, 'Pick a start and end date.');
  if (endDate < startDate) throw new HttpError(400, 'The end date must be on or after the start date.');
  const dates = workDates(employee, db.data.settings, startDate, endDate, db.data.holidays);
  if (!dates.length) throw new HttpError(400, noWorkDays(db, startDate, endDate));
  if (dates.length > MAX_REQUEST_DAYS) throw new HttpError(400, `A request can cover at most ${MAX_REQUEST_DAYS} work days.`);
  const reason = String(body.reason || '').trim().slice(0, 500);
  const destination = String(body.destination || '').trim().slice(0, 200);
  if (kind === 'ob' && !destination) throw new HttpError(400, 'Say where you will be: the client, site or office you will work from.');
  const portions = body.portions && typeof body.portions === 'object' ? body.portions : {};
  const breakdown = dates.map((date) => ({ date, portion: kind === 'leave' && PORTIONS[portions[date]] ? portions[date] : 'whole' }));
  const days = breakdown.reduce((n, d) => n + portionDays(d.portion), 0);

  let leaveTypeId = null;
  if (kind === 'leave') {
    const type = findLeaveType(db, body.leaveTypeId);
    if (!type.active) throw new HttpError(400, `${type.name} is no longer offered.`);
    const block = genderBlock(type, employee, { self: true });
    if (block) throw new HttpError(400, block);
    if (!offeredTo(db, employee.id, type)) throw new HttpError(400, `${type.name} is not available to you. Ask HR if you think it should be.`);
    if (type.advanceDays && !byHr) {
      const earliest = new Date(Date.parse(`${localDate()}T00:00:00Z`) + type.advanceDays * 86400000).toISOString().slice(0, 10);
      if (startDate < earliest) throw new HttpError(400, `${type.name} must be filed at least ${type.advanceDays} day${type.advanceDays === 1 ? '' : 's'} before it starts (from ${earliest}).`);
    }
    leaveTypeId = type.id;
    const bal = leaveBalances(db, employee.id, startDate.slice(0, 4)).find((b) => b.leaveTypeId === type.id);
    // When resubmitting, this request's own pending days are not counted against itself.
    const own = existingId ? requestDaysOf(db.data.requests.find((r) => r.id === existingId), type.id) : 0;
    let left = bal.remaining === null ? Infinity : bal.remaining + own;
    const lwop = db.data.leaveTypes.find((t) => t.id === 'lwop' && t.active && offeredTo(db, employee.id, t));
    for (const d of breakdown) {
      const n = portionDays(d.portion);
      if (n <= left) left -= n;
      else d.overflow = true;
    }
    const over = breakdown.filter((d) => d.overflow).reduce((n, d) => n + portionDays(d.portion), 0);
    if (over && (!type.paid || !lwop)) {
      throw new HttpError(400, `Not enough ${type.name} credits: ${Math.max(0, bal.remaining + own)} day(s) left, ${days} requested.`);
    }
    if (needsCertificate(type, days) && !upload) {
      throw new HttpError(400, `${type.name} of more than ${type.certificateAfterDays} day${type.certificateAfterDays === 1 ? '' : 's'} needs a medical certificate. This request is ${days} work days; attach the certificate (PDF or photo) and submit again.`);
    }
  }
  const clash = db.data.requests.find((r) => r.id !== existingId && r.employeeId === employee.id && ['pending', 'returned', 'approved'].includes(r.status) && overlaps(r, { startDate, endDate }));
  if (clash) throw new HttpError(400, `This overlaps another ${clash.status} request (${clash.startDate} to ${clash.endDate}).`);

  const overflowDays = breakdown.filter((d) => d.overflow).reduce((n, d) => n + portionDays(d.portion), 0);
  return {
    employeeId: employee.id, kind, leaveTypeId, startDate, endDate, breakdown, days, paidDays: kind === 'leave' ? days - overflowDays : days, overflowDays,
    reason, destination: kind === 'ob' ? destination : '',
  };
}

// Approving writes the request into the DTR: one leave entry per whole day, a half-day mark on the
// day's work entry, or one work-from-home / official-business entry per scheduled day.
function approve(db, req, user) {
  const employee = db.data.employees.find((e) => e.id === req.employeeId);
  if (!employee) throw new HttpError(400, 'The employee record no longer exists.');
  const breakdown = req.breakdown || workDates(employee, db.data.settings, req.startDate, req.endDate, db.data.holidays).map((date) => ({ date, portion: 'whole' }));
  const entryOn = (date) => db.data.timeEntries.find((e) => e.employeeId === employee.id && e.date === date);

  if (req.kind === 'leave') {
    const type = findLeaveType(db, req.leaveTypeId);
    const block = genderBlock(type, employee);
    if (block) throw new HttpError(400, `Cannot approve: ${block}`);
    if (needsCertificate(type, req.days) && !req.attachment) {
      throw new HttpError(400, `Cannot approve yet: ${type.name} of more than ${type.certificateAfterDays} days needs a medical certificate, and none is attached. The employee can attach it under My Requests.`);
    }
    const busy = breakdown.filter((d) => {
      const e = entryOn(d.date);
      return e && (d.portion === 'whole' || e.type === 'leave' || e.halfLeave);
    });
    if (busy.length) throw new HttpError(400, `Attendance is already recorded on ${busy.map((d) => d.date).join(', ')}. Edit or remove those records first.`);
    const bal = leaveBalances(db, employee.id, req.startDate.slice(0, 4)).find((b) => b.leaveTypeId === type.id);
    if (bal.remaining !== null && bal.remaining < 0) throw new HttpError(400, `Not enough ${type.name} credits left to approve this request.`);
    const lwop = db.data.leaveTypes.find((t) => t.id === 'lwop');
    for (const d of breakdown) {
      const t = d.overflow && lwop ? lwop : type;
      if (d.portion === 'whole') {
        db.data.timeEntries.push({
          id: randomUUID(), employeeId: employee.id, date: d.date, type: 'leave', leaveTypeId: t.id, paid: t.paid,
          timeIn: null, timeOut: null, otApproved: false, remote: false, notes: `${t.name} (approved request)`, requestId: req.id,
        });
      } else {
        const halfLeave = { portion: d.portion, leaveTypeId: t.id, paid: t.paid, requestId: req.id };
        const e = entryOn(d.date);
        if (e) e.halfLeave = halfLeave;
        else {
          db.data.timeEntries.push({
            id: randomUUID(), employeeId: employee.id, date: d.date, type: 'work', timeIn: null, timeOut: null, otApproved: false, remote: false,
            halfLeave, notes: `${t.name}, ${PORTIONS[d.portion].toLowerCase()} (approved request)`, requestId: req.id,
          });
        }
      }
    }
  } else {
    const onLeave = breakdown.filter((d) => entryOn(d.date)?.type === 'leave');
    if (onLeave.length) throw new HttpError(400, `The employee is on leave on ${onLeave.map((d) => d.date).join(', ')}.`);
    const ob = req.kind === 'ob';
    for (const d of breakdown) {
      const entry = entryOn(d.date);
      const mark = { remote: true, ...(ob ? { officialBusiness: true, destination: req.destination } : {}) };
      if (entry) Object.assign(entry, mark, { remoteRequestId: req.id });
      else {
        db.data.timeEntries.push({
          id: randomUUID(), employeeId: employee.id, date: d.date, type: 'work', timeIn: null, timeOut: null, otApproved: false, ...mark,
          notes: ob ? `Official business: ${req.destination} (approved request)` : 'Work from home (approved request)', requestId: req.id,
        });
      }
    }
  }
  Object.assign(req, { status: 'approved', decidedAt: new Date().toISOString(), decidedBy: user.id, decidedByName: user.name });
}

// Undo what approval wrote. Days the employee already clocked are kept as normal work days.
function cancel(db, req, user, note) {
  if (!['pending', 'returned', 'approved'].includes(req.status)) throw new HttpError(400, `This request is already ${req.status}.`);
  if (req.status === 'approved') {
    db.data.timeEntries = db.data.timeEntries.filter((e) => {
      if (e.requestId === req.id && (e.type === 'leave' || !e.timeIn)) return false;
      if (e.halfLeave?.requestId === req.id) delete e.halfLeave;
      if (e.requestId === req.id || e.remoteRequestId === req.id) {
        e.remote = false;
        delete e.officialBusiness;
        delete e.destination;
        delete e.requestId;
        delete e.remoteRequestId;
      }
      return true;
    });
  }
  for (const l of req.approvals || []) if (l.status === 'pending' || l.status === 'waiting') l.status = 'skipped';
  Object.assign(req, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: user.id, cancelledByName: user.name, cancelReason: String(note || '').trim().slice(0, 500) });
  addHistory(req, user, `Cancelled${req.cancelReason ? `: ${req.cancelReason}` : ''}`);
}

// One step of the approval route; on the final approval the days go into the DTR.
function act(db, req, user, action, note) {
  if (action === 'approve') {
    const snapshot = structuredClone({ approvals: req.approvals, history: req.history });
    const result = decideStep(req, user, 'approve', note);
    if (result === 'approved') {
      try {
        approve(db, req, user);
        if (note) req.decisionNote = String(note).trim().slice(0, 500);
      } catch (err) {
        Object.assign(req, snapshot); // the DTR could not take it: leave the route as it was
        throw err;
      }
    }
    return result;
  }
  return decideStep(req, user, action, note);
}

export function validateApprovalSettings(body, db) {
  const flow = APPROVAL_FLOWS[body.flow] ? body.flow : 'sequential';
  const levels = (Array.isArray(body.levels) ? body.levels : []).slice(0, 3).map((l) => {
    if (!APPROVER_TYPES[l.type]) throw new HttpError(400, 'Pick who approves at each level.');
    if (l.type !== 'users') return { type: l.type };
    const userIds = [...new Set((l.userIds || []).filter((id) => db.data.users.some((u) => u.id === id && u.active)))];
    if (!userIds.length) throw new HttpError(400, 'Choose at least one person for a "specific people" level.');
    return { type: 'users', userIds };
  });
  if (!levels.length) throw new HttpError(400, 'Keep at least one approval level.');
  return { flow, levels };
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
    const dates = workDates(emp, db.data.settings, startDate, endDate, db.data.holidays);
    if (!dates.length) throw new HttpError(400, noWorkDays(db, startDate, endDate));
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

  // ----- Requests (HR / payroll view; HR / admin decide at any level) -----
  route('GET', '/api/requests', 'leave.manage', ({ query, user }) =>
    sortRequests(db.data.requests.filter((r) => !query.status || r.status === query.status).map((r) => withEmployee(db, r, user))),
  );
  route('GET', '/api/requests/summary', 'leave.manage', () => ({ pending: db.data.requests.filter((r) => r.status === 'pending').length }));
  route('GET', '/api/requests/:id/attachment', 'leave.manage', ({ params }) => files.read(findRequest(db, params.id).attachment));
  for (const action of ['approve', 'reject', 'return']) {
    route('POST', `/api/requests/:id/${action}`, 'leave.approve', ({ params, body, user }) => {
      const req = findRequest(db, params.id);
      act(db, req, user, action, body.note);
      db.save();
      return withEmployee(db, req, user);
    });
  }
  // Cancelling an approved request (HR, or an approver on its route) removes its days from the DTR.
  route('POST', '/api/requests/:id/cancel', 'auth', ({ params, body, user }) => {
    const req = findRequest(db, params.id);
    if (!userCan(user, 'leave.approve') && !isOnRoute(req, user)) throw new HttpError(403, 'Only HR or an approver of this request can cancel it.');
    if (!String(body.note || '').trim()) throw new HttpError(400, 'Give the reason for cancelling; the employee sees it.');
    cancel(db, req, user, body.note);
    db.save();
    return withEmployee(db, req, user);
  });

  // ----- Approval Center: requests waiting for this account, decided by it, and its team -----
  const teamIds = (user) => new Set(directReports(db, user).map((e) => e.id));
  function approvalList(user, tab) {
    const team = teamIds(user);
    const hr = userCan(user, 'leave.approve');
    const list = db.data.requests.filter((r) => {
      if (tab === 'processed') return (r.approvals || []).some((l) => l.decidedBy === user.id) || r.decidedBy === user.id || r.cancelledBy === user.id;
      if (tab === 'team') return team.has(r.employeeId);
      return r.status === 'pending' && isCurrentApprover(r, user);
    });
    return sortRequests(list.map((r) => withEmployee(db, r, user))).map((r) => ({ ...r, hrOverride: hr && !r.yourTurn }));
  }
  route('GET', '/api/approvals', 'auth', ({ query, user }) => approvalList(user, ['processed', 'team'].includes(query.tab) ? query.tab : 'pending'));
  route('GET', '/api/approvals/summary', 'auth', ({ user }) => ({ pending: db.data.requests.filter((r) => r.status === 'pending' && isCurrentApprover(r, user)).length, team: teamIds(user).size }));
  const visibleTo = (req, user) => userCan(user, 'leave.manage') || isOnRoute(req, user) || teamIds(user).has(req.employeeId);
  route('GET', '/api/approvals/:id', 'auth', ({ params, user }) => {
    const req = findRequest(db, params.id);
    if (!visibleTo(req, user)) throw new HttpError(404, 'Request not found.');
    const balance = req.kind === 'leave' ? leaveBalances(db, req.employeeId, req.startDate.slice(0, 4)).find((b) => b.leaveTypeId === req.leaveTypeId) : null;
    return { ...withEmployee(db, req, user), balance };
  });
  route('GET', '/api/approvals/:id/attachment', 'auth', ({ params, user }) => {
    const req = findRequest(db, params.id);
    if (!visibleTo(req, user)) throw new HttpError(404, 'Request not found.');
    return files.read(req.attachment);
  });
  for (const action of ['approve', 'reject', 'return']) {
    route('POST', `/api/approvals/:id/${action}`, 'auth', ({ params, body, user }) => {
      const req = findRequest(db, params.id);
      if (!isCurrentApprover(req, user) && !userCan(user, 'leave.approve')) throw new HttpError(403, 'This request is not waiting for your approval.');
      act(db, req, user, action, body.note);
      db.save();
      return withEmployee(db, req, user);
    });
  }
  // Approve several at once (Sprout's select-all). Each one is checked on its own; failures are listed.
  route('POST', '/api/approvals/bulk', 'auth', ({ body, user }) => {
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 200) : [];
    const done = [];
    const failed = [];
    for (const id of ids) {
      const req = db.data.requests.find((r) => r.id === id);
      try {
        if (!req) throw new HttpError(404, 'Request not found.');
        if (!isCurrentApprover(req, user) && !userCan(user, 'leave.approve')) throw new HttpError(403, 'Not waiting for your approval.');
        act(db, req, user, 'approve', body.note);
        done.push(id);
      } catch (err) {
        failed.push({ id, error: err.message });
      }
    }
    db.save();
    return { approved: done.length, failed };
  });

  // ----- Approval flow (HR and administrators) -----
  route('GET', '/api/approval-flow', 'leave.manage', () => ({
    ...approvalSettings(db),
    people: db.data.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, role: u.role })),
    withoutSupervisor: db.data.employees.filter((e) => e.status === 'Active' && !e.supervisorId).length,
  }));
  route('PUT', '/api/approval-flow', 'leave.approve', ({ body }) => {
    db.data.settings.approvals = validateApprovalSettings(body, db);
    db.save();
    return approvalSettings(db);
  });

  // ----- Employee self-service -----
  route('GET', '/api/me/requests', 'self', ({ user }) => {
    const emp = linkedEmployee(user);
    return sortRequests(db.data.requests.filter((r) => r.employeeId === emp.id).map((r) => withEmployee(db, r)));
  });
  // Who a new request would go to, shown on the form.
  route('GET', '/api/me/approvers', 'self', ({ user }) => {
    const emp = linkedEmployee(user);
    const probe = {};
    routeRequest(db, probe, emp, user.id);
    return { flow: probe.flow, levels: probe.approvals.map(({ level, label, status, note }) => ({ level, label, skipped: status === 'skipped', note })) };
  });
  route('POST', '/api/me/requests', 'self', ({ user, body }) => {
    const emp = linkedEmployee(user);
    if (emp.status !== 'Active') throw new HttpError(400, 'Inactive employees cannot file requests.');
    const upload = body.kind === 'leave' && body.attachment ? parseUpload(body.attachment) : null;
    const req = { id: randomUUID(), ...buildRequest(db, emp, user, body, upload), status: 'pending', filedAt: new Date().toISOString(), filedBy: user.id, history: [] };
    routeRequest(db, req, emp, user.id);
    addHistory(req, user, 'Filed');
    if (upload) req.attachment = files.save(upload);
    db.data.requests.push(req);
    db.save();
    return withEmployee(db, req);
  });
  const ownRequest = (user, id) => {
    const emp = linkedEmployee(user);
    const req = findRequest(db, id);
    if (req.employeeId !== emp.id) throw new HttpError(404, 'Request not found.');
    return req;
  };
  // Edit a request that is still pending or was returned for revision; it starts its route again.
  route('PUT', '/api/me/requests/:id', 'self', ({ user, params, body }) => {
    const req = ownRequest(user, params.id);
    if (!OPEN_REQUEST.includes(req.status)) throw new HttpError(400, 'Only pending or returned requests can be edited.');
    const emp = linkedEmployee(user);
    const upload = body.kind === 'leave' && body.attachment ? parseUpload(body.attachment) : null;
    const fields = buildRequest(db, emp, user, { ...body, kind: body.kind || req.kind }, upload || (req.attachment ? true : null), { existingId: req.id });
    const wasReturned = req.status === 'returned';
    Object.assign(req, fields, { status: 'pending', resubmittedAt: new Date().toISOString() });
    delete req.returnNote;
    routeRequest(db, req, emp, user.id);
    addHistory(req, user, wasReturned ? 'Revised and resubmitted' : 'Edited and resubmitted');
    if (upload) {
      const old = req.attachment;
      req.attachment = files.save(upload);
      files.remove(old);
    }
    db.save();
    return withEmployee(db, req);
  });
  route('POST', '/api/me/requests/:id/cancel', 'self', ({ user, params, body }) => {
    const req = ownRequest(user, params.id);
    if (!OPEN_REQUEST.includes(req.status)) throw new HttpError(400, 'Only pending or returned requests can be withdrawn. Ask your approver or HR to cancel an approved one.');
    cancel(db, req, user, body?.reason || body?.note);
    db.save();
    return withEmployee(db, req);
  });
  route('GET', '/api/me/requests/:id/attachment', 'self', ({ user, params }) => files.read(ownRequest(user, params.id).attachment));
  // Attach or replace the medical certificate on a pending or returned leave request.
  route('PUT', '/api/me/requests/:id/attachment', 'self', ({ user, params, body }) => {
    const req = ownRequest(user, params.id);
    if (req.kind !== 'leave') throw new HttpError(400, 'Files can only be attached to leave requests.');
    if (!OPEN_REQUEST.includes(req.status)) throw new HttpError(400, 'The certificate can only be changed while the request is pending.');
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
