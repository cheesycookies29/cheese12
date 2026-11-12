// HRIS leave: leave types, credits and balances, and leave / remote-work requests with
// approval. Ported from the Lancaster ERP (server/leave.js there); the rules are the
// same. What changed for the school: routes live under /api/hris, HR sees the
// employees of the campus they are looking at, and medical certificates are kept in
// the LMS file store (data/files), never reachable from a class.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { workDates, genderAllows, needsCertificate, LEAVE_GENDERS, DEFAULT_LEAVE_TYPES, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '../shared/leave.js';
import { userCan } from '../shared/roles.js';

// Officers cannot change their own leave or pay: another officer or an administrator does (separation of duties).
export function notOwnRecord(user, employeeId, what) {
  if (user && user.role !== 'admin' && user.employeeId && user.employeeId === employeeId) {
    throw new HttpError(403, `You cannot ${what} on your own record. Ask another officer or an administrator.`);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REQUEST_DAYS = 180;

export function findLeaveType(data, id) {
  const type = data.leaveTypes.find((t) => t.id === id);
  if (!type) throw new HttpError(404, 'Leave type not found.');
  return type;
}

// Leave types saved without the gender and certificate rules take them from the built-in
// defaults (Maternity: women, Paternity: men, Sick Leave: over 3 days).
export function migrateLeaveTypes(data) {
  for (const t of data.leaveTypes) {
    const builtIn = DEFAULT_LEAVE_TYPES.find((d) => d.id === t.id);
    for (const k of ['gender', 'certificateAfterDays']) if (!(k in t)) t[k] = builtIn ? builtIn[k] : null;
  }
}

const firstName = (emp) => emp?.firstName || 'this employee';
// Why an employee can't have a gender-limited leave type, or null if they can.
export function genderBlock(type, emp, { self = false } = {}) {
  if (genderAllows(type, emp)) return null;
  const rule = `${type.name} is for ${type.gender.toLowerCase()} employees only`;
  if (!emp?.gender) return self ? `${rule}, and your record has no gender. Ask HR to update your profile.` : `${rule}. Set the gender on ${firstName(emp)}'s employee record first.`;
  return self ? `${rule}.` : `${rule}; ${firstName(emp)}'s record says ${emp.gender}.`;
}

function validateLeaveType(input, data, existingId) {
  const t = {
    code: String(input.code || '').trim().toUpperCase(),
    name: String(input.name || '').trim().slice(0, 80),
    paid: input.paid !== false,
    annualCredits: input.annualCredits === '' || input.annualCredits == null ? null : Number(input.annualCredits),
    active: input.active !== false,
    // 'all' = every employee unless HR removes it for someone; 'selected' = only employees HR adds.
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
  if (data.leaveTypes.some((x) => x.code === t.code && x.id !== existingId)) throw new HttpError(400, `Code ${t.code} is already used.`);
  return t;
}

// Whether an employee gets a leave type: never if the type is limited to another gender;
// otherwise HR's choice for that person, else the type's default.
export function offeredTo(data, employeeId, type) {
  if (!genderAllows(type, data.employees.find((e) => e.id === employeeId))) return false;
  const access = data.leaveAccess.find((a) => a.employeeId === employeeId && a.leaveTypeId === type.id);
  return access ? access.offered : type.appliesTo !== 'selected';
}

// Credits, adjustments, used and pending days per leave type for one employee and calendar year.
// Used days are counted from leave entries in the DTR, so leave recorded by HR counts too.
export function leaveBalances(data, employeeId, year) {
  const y = String(year);
  const emp = data.employees.find((e) => e.id === employeeId);
  return data.leaveTypes.map((t) => {
    const override = data.leaveCredits.find((c) => c.employeeId === employeeId && c.year === Number(year) && c.leaveTypeId === t.id);
    const credits = override ? override.credits : t.annualCredits;
    const adjusted = data.leaveAdjustments
      .filter((a) => a.employeeId === employeeId && a.year === Number(year) && a.leaveTypeId === t.id)
      .reduce((sum, a) => sum + a.days, 0);
    const used = data.timeEntries.filter((e) => e.employeeId === employeeId && e.type === 'leave' && e.leaveTypeId === t.id && e.date.startsWith(y)).length;
    const pending = data.requests
      .filter((r) => r.employeeId === employeeId && r.status === 'pending' && r.kind === 'leave' && r.leaveTypeId === t.id && r.startDate.startsWith(y))
      .reduce((a, r) => a + r.days, 0);
    return {
      leaveTypeId: t.id, code: t.code, name: t.name, paid: t.paid, active: t.active, offered: offeredTo(data, employeeId, t),
      gender: t.gender || null, eligible: genderAllows(t, emp), certificateAfterDays: t.certificateAfterDays ?? null,
      credits, overridden: Boolean(override), adjusted, used, pending, remaining: credits == null ? null : credits + adjusted - used - pending,
    };
  });
}

function withEmployee(data, req) {
  const emp = data.employees.find((e) => e.id === req.employeeId);
  const type = req.leaveTypeId && data.leaveTypes.find((t) => t.id === req.leaveTypeId);
  return {
    ...req,
    employeeName: emp ? `${emp.lastName}, ${emp.firstName}` : '(deleted employee)',
    employeeNo: emp?.employeeNo || '',
    department: emp?.department || '',
    typeName: req.kind === 'remote' ? 'Remote work' : type?.name || 'Leave',
    certificateRequired: req.kind === 'leave' && needsCertificate(type, req.days),
  };
}

const overlaps = (a, b) => a.startDate <= b.endDate && b.startDate <= a.endDate;

function buildRequest(data, employee, user, body, upload) {
  const kind = body.kind === 'remote' ? 'remote' : 'leave';
  const { startDate, endDate } = body;
  if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '')) throw new HttpError(400, 'Pick a start and end date.');
  if (endDate < startDate) throw new HttpError(400, 'The end date must be on or after the start date.');
  const dates = workDates(employee, data.hrSettings, startDate, endDate);
  if (!dates.length) throw new HttpError(400, 'There are no scheduled work days in that range.');
  if (dates.length > MAX_REQUEST_DAYS) throw new HttpError(400, `A request can cover at most ${MAX_REQUEST_DAYS} work days.`);
  const reason = String(body.reason || '').trim().slice(0, 500);

  let leaveTypeId = null;
  if (kind === 'leave') {
    const type = findLeaveType(data, body.leaveTypeId);
    if (!type.active) throw new HttpError(400, `${type.name} is no longer offered.`);
    const block = genderBlock(type, employee, { self: true });
    if (block) throw new HttpError(400, block);
    if (!offeredTo(data, employee.id, type)) throw new HttpError(400, `${type.name} is not available to you. Ask HR if you think it should be.`);
    leaveTypeId = type.id;
    const bal = leaveBalances(data, employee.id, startDate.slice(0, 4)).find((b) => b.leaveTypeId === type.id);
    if (bal.remaining !== null && dates.length > bal.remaining) {
      throw new HttpError(400, `Not enough ${type.name} credits: ${Math.max(0, bal.remaining)} day(s) left, ${dates.length} requested.`);
    }
    if (needsCertificate(type, dates.length) && !upload) {
      throw new HttpError(400, `${type.name} of more than ${type.certificateAfterDays} day${type.certificateAfterDays === 1 ? '' : 's'} needs a medical certificate. This request is ${dates.length} work days; attach the certificate (PDF or photo) and submit again.`);
    }
  }
  const clash = data.requests.find((r) => r.employeeId === employee.id && ['pending', 'approved'].includes(r.status) && overlaps(r, { startDate, endDate }));
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
function approve(data, req, user, note) {
  if (req.status !== 'pending') throw new HttpError(400, `This request is already ${req.status}.`);
  if (user.employeeId && user.employeeId === req.employeeId) throw new HttpError(403, 'You cannot approve your own request. Another approver must do it.');
  const employee = data.employees.find((e) => e.id === req.employeeId);
  if (!employee) throw new HttpError(400, 'The employee record no longer exists.');
  const dates = workDates(employee, data.hrSettings, req.startDate, req.endDate);
  const existing = data.timeEntries.filter((e) => e.employeeId === employee.id && dates.includes(e.date));

  if (req.kind === 'leave') {
    if (existing.length) {
      throw new HttpError(400, `Attendance is already recorded on ${existing.map((e) => e.date).sort().join(', ')}. Edit or remove those records first.`);
    }
    const type = findLeaveType(data, req.leaveTypeId);
    const block = genderBlock(type, employee);
    if (block) throw new HttpError(400, `Cannot approve: ${block}`);
    if (needsCertificate(type, req.days) && !req.attachment) {
      throw new HttpError(400, `Cannot approve yet: ${type.name} of more than ${type.certificateAfterDays} days needs a medical certificate, and none is attached. The employee can attach it under Leave & requests.`);
    }
    const bal = leaveBalances(data, employee.id, req.startDate.slice(0, 4)).find((b) => b.leaveTypeId === type.id);
    if (bal.remaining !== null && bal.remaining < 0) throw new HttpError(400, `Not enough ${type.name} credits left to approve this request.`);
    for (const date of dates) {
      data.timeEntries.push({
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
        data.timeEntries.push({
          id: randomUUID(), employeeId: employee.id, date, type: 'work', timeIn: null, timeOut: null,
          otApproved: false, remote: true, notes: 'Remote work (approved request)', requestId: req.id,
        });
      }
    }
  }
  decide(req, user, 'approved', note);
}

// Undo what approval wrote. Remote days the employee already clocked on are kept as normal work days.
function cancel(data, req, user, note) {
  if (!['pending', 'approved'].includes(req.status)) throw new HttpError(400, `This request is already ${req.status}.`);
  if (req.status === 'approved') {
    data.timeEntries = data.timeEntries.filter((e) => {
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

// ----- Medical certificates -----
// The real type, from the first bytes of the file rather than what the browser claims.
function sniff(buf) {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// { name, data: base64 } from the browser -> what the file store saves, or a 400 explaining what's wrong.
export function parseCertificate(input) {
  if (!input || typeof input.data !== 'string') throw new HttpError(400, 'The attached file could not be read. Please choose it again.');
  const data = input.data.replace(/^data:[^,]*,/, '');
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length) throw new HttpError(400, 'The attached file is empty.');
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new HttpError(400, `The file is too large (${(buffer.length / 1048576).toFixed(1)} MB). The limit is ${MAX_ATTACHMENT_BYTES / 1048576} MB.`);
  const type = sniff(buffer);
  if (!ATTACHMENT_TYPES[type]) throw new HttpError(400, 'Attach a PDF or a photo (JPEG, PNG or WebP).');
  return { name: String(input.name || 'certificate').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'certificate', type, data };
}

// helpers (from server/hris.js):
//   linkedEmployee(user)            the signed-in person's employee record
//   employeeIn(campusId, id)        an employee at that campus (404 otherwise)
//   campusEmployees(campusId)       every employee at that campus
//   finalizedOn(campusId, dates)    finalized payroll runs covering any of the dates
export function registerLeaveRoutes(route, ctx, { linkedEmployee, employeeIn, campusEmployees, finalizedOn }) {
  const { db, files } = ctx;
  const data = () => db.data;
  const save = () => db.save();
  const thisYear = () => Number(ctx.today().slice(0, 4));
  // Pending first, then newest filed first.
  const sortRequests = (list) => list.sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.filedAt.localeCompare(a.filedAt));
  const atCampus = (campusId) => new Set(campusEmployees(campusId).map((e) => e.id));
  const findRequest = (id, campusId) => {
    const req = data().requests.find((r) => r.id === id);
    if (!req || (campusId !== undefined && !atCampus(campusId).has(req.employeeId))) throw new HttpError(404, 'Request not found.');
    return req;
  };
  const certificates = {
    save(input, user) {
      const meta = files.save(parseCertificate(input), { owner: user });
      meta.private = true;
      meta.purpose = 'hr-certificate';
      return { id: meta.id, name: meta.name, type: meta.mime, size: meta.size, uploadedAt: meta.createdAt };
    },
    // As JSON (base64), so the browser shows it in a window with a Download button.
    read(meta) {
      if (!meta?.id) throw new HttpError(404, 'No file is attached.');
      const { bytes } = files.read(meta.id);
      return { name: meta.name, type: meta.type, size: meta.size, data: bytes.toString('base64') };
    },
    remove(meta) {
      if (meta?.id) files.remove(meta.id);
    },
  };

  // ----- Leave types (school-wide) -----
  route('GET', '/api/hris/leave-types', 'hris', () => data().leaveTypes);
  route('POST', '/api/hris/leave-types', 'hris:leave.adjust', ({ body }) => {
    const type = { id: randomUUID(), ...validateLeaveType(body, data()) };
    data().leaveTypes.push(type);
    save();
    return type;
  });
  route('PUT', '/api/hris/leave-types/:id', 'hris:leave.adjust', ({ params, body }) => {
    const type = findLeaveType(data(), params.id);
    Object.assign(type, validateLeaveType(body, data(), type.id));
    // Keep the paid flag on future leave entries in step with the type.
    for (const e of data().timeEntries) if (e.leaveTypeId === type.id && e.date >= ctx.today()) e.paid = type.paid;
    save();
    return type;
  });
  route('DELETE', '/api/hris/leave-types/:id', 'hris:leave.adjust', ({ params }) => {
    const type = findLeaveType(data(), params.id);
    const used = data().timeEntries.some((e) => e.leaveTypeId === type.id) || data().requests.some((r) => r.leaveTypeId === type.id);
    if (used) throw new HttpError(400, `${type.name} has been used. Mark it inactive instead of deleting it.`);
    data().leaveTypes = data().leaveTypes.filter((t) => t.id !== type.id);
    for (const k of ['leaveCredits', 'leaveAccess', 'leaveAdjustments']) data()[k] = data()[k].filter((c) => c.leaveTypeId !== type.id);
    save();
    return { ok: true };
  });

  // ----- Credits and balances -----
  route('GET', '/api/hris/leave-balances', 'hris:leave.manage', ({ query, campusId }) => {
    const year = Number(query.year) || thisYear();
    return campusEmployees(campusId)
      .filter((e) => e.status === 'Active')
      .sort((a, b) => a.lastName.localeCompare(b.lastName))
      .map((e) => ({ employeeId: e.id, employeeNo: e.employeeNo, name: `${e.lastName}, ${e.firstName}`, department: e.department || '', balances: leaveBalances(data(), e.id, year) }));
  });
  route('PUT', '/api/hris/leave-credits', 'hris:leave.adjust', ({ body, user, campusId }) => {
    const year = Number(body.year);
    if (!(year >= 2000 && year <= 2100)) throw new HttpError(400, 'Pick a valid year.');
    const emp = employeeIn(campusId, body.employeeId);
    notOwnRecord(user, emp.id, 'set leave credits');
    const type = findLeaveType(data(), body.leaveTypeId);
    data().leaveCredits = data().leaveCredits.filter((c) => !(c.employeeId === emp.id && c.year === year && c.leaveTypeId === type.id));
    if (body.credits !== null && body.credits !== '') {
      const credits = Number(body.credits);
      if (!(credits >= 0 && credits <= 366)) throw new HttpError(400, 'Credits must be between 0 and 366.');
      data().leaveCredits.push({ employeeId: emp.id, year, leaveTypeId: type.id, credits, updatedAt: new Date().toISOString() });
    }
    save();
    return leaveBalances(data(), emp.id, year);
  });

  // ----- One employee's leave, adjusted by HR -----
  const yearOf = (v) => {
    const year = Number(v);
    if (!(year >= 2000 && year <= 2100)) throw new HttpError(400, 'Pick a valid year.');
    return year;
  };
  const typeName = (id) => data().leaveTypes.find((t) => t.id === id)?.name || '(deleted leave type)';
  const employeeLeave = (emp, year) => ({
    employee: { id: emp.id, name: `${emp.firstName} ${emp.lastName}`, employeeNo: emp.employeeNo, department: emp.department || '', status: emp.status, hireDate: emp.hireDate || null, gender: emp.gender || '' },
    year,
    balances: leaveBalances(data(), emp.id, year),
    // Reversed first so adjustments saved in the same instant stay newest first.
    adjustments: data().leaveAdjustments.filter((a) => a.employeeId === emp.id && a.year === year).reverse().sort((a, b) => b.at.localeCompare(a.at))
      .map((a) => ({ ...a, typeName: typeName(a.leaveTypeId) })),
    leaveDays: data().timeEntries.filter((e) => e.employeeId === emp.id && e.type === 'leave' && e.date.startsWith(String(year))).sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => ({ id: e.id, date: e.date, leaveTypeId: e.leaveTypeId, typeName: typeName(e.leaveTypeId), paid: e.paid !== false, notes: e.notes || '',
        source: e.requestId ? 'request' : e.manualLeave ? 'admin' : 'attendance', requestId: e.requestId || null })),
  });

  route('GET', '/api/hris/employees/:id/leave', 'hris:leave.adjust', ({ params, query, campusId }) =>
    employeeLeave(employeeIn(campusId, params.id), yearOf(query.year || thisYear())));

  // Give or take away a leave type for one employee; offered = null goes back to the type's default.
  route('PUT', '/api/hris/employees/:id/leave-access', 'hris:leave.adjust', ({ params, body, user, campusId }) => {
    const emp = employeeIn(campusId, params.id);
    notOwnRecord(user, emp.id, 'change which leave you get');
    const type = findLeaveType(data(), body.leaveTypeId);
    const block = body.offered === true && genderBlock(type, emp);
    if (block) throw new HttpError(400, block);
    data().leaveAccess = data().leaveAccess.filter((a) => !(a.employeeId === emp.id && a.leaveTypeId === type.id));
    if (body.offered === true || body.offered === false) {
      data().leaveAccess.push({ employeeId: emp.id, leaveTypeId: type.id, offered: body.offered, updatedAt: new Date().toISOString(), updatedBy: user.name });
    }
    save();
    return employeeLeave(emp, yearOf(body.year || thisYear()));
  });

  // Add or take away days, with a reason (carry-over, correction, offset…).
  route('POST', '/api/hris/employees/:id/leave-adjustments', 'hris:leave.adjust', ({ params, body, user, campusId }) => {
    const emp = employeeIn(campusId, params.id);
    notOwnRecord(user, emp.id, 'adjust leave');
    const type = findLeaveType(data(), body.leaveTypeId);
    const year = yearOf(body.year);
    const days = Number(body.days);
    if (!days || Math.abs(days) > 366 || Math.round(days * 2) !== days * 2) throw new HttpError(400, 'Enter the number of days to add or take away, in half days (e.g. 2, -1 or 0.5).');
    const reason = String(body.reason || '').trim().slice(0, 300);
    if (!reason) throw new HttpError(400, 'Say why, e.g. "carry-over from last year" or "correction".');
    const bal = leaveBalances(data(), emp.id, year).find((b) => b.leaveTypeId === type.id);
    if (bal.credits == null) throw new HttpError(400, `${type.name} has no day limit, so there is no balance to adjust. Set credits for this employee first if you want to track it.`);
    data().leaveAdjustments.push({ id: randomUUID(), employeeId: emp.id, leaveTypeId: type.id, year, days, reason, at: new Date().toISOString(), by: user.name });
    save();
    return employeeLeave(emp, year);
  });
  route('DELETE', '/api/hris/employees/:id/leave-adjustments/:adjId', 'hris:leave.adjust', ({ params, user, campusId }) => {
    const emp = employeeIn(campusId, params.id);
    notOwnRecord(user, emp.id, 'adjust leave');
    const adj = data().leaveAdjustments.find((a) => a.id === params.adjId && a.employeeId === emp.id);
    if (!adj) throw new HttpError(404, 'Adjustment not found.');
    data().leaveAdjustments = data().leaveAdjustments.filter((a) => a.id !== adj.id);
    save();
    return employeeLeave(emp, adj.year);
  });

  // Record leave the employee took (e.g. filed on paper): one DTR leave entry per scheduled work day.
  route('POST', '/api/hris/employees/:id/leave-days', 'hris:leave.adjust', ({ params, body, user, campusId }) => {
    const emp = employeeIn(campusId, params.id);
    notOwnRecord(user, emp.id, 'record leave days');
    const type = findLeaveType(data(), body.leaveTypeId);
    const block = genderBlock(type, emp);
    if (block) throw new HttpError(400, block);
    const { startDate, endDate } = body;
    if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '')) throw new HttpError(400, 'Pick a start and end date.');
    if (endDate < startDate) throw new HttpError(400, 'The end date must be on or after the start date.');
    if (startDate.slice(0, 4) !== endDate.slice(0, 4)) throw new HttpError(400, 'Record leave one calendar year at a time.');
    const dates = workDates(emp, data().hrSettings, startDate, endDate);
    if (!dates.length) throw new HttpError(400, 'There are no scheduled work days in that range.');
    if (dates.length > MAX_REQUEST_DAYS) throw new HttpError(400, `At most ${MAX_REQUEST_DAYS} work days at a time.`);
    const taken = data().timeEntries.filter((e) => e.employeeId === emp.id && dates.includes(e.date));
    if (taken.length) throw new HttpError(400, `Attendance is already recorded on ${taken.map((e) => e.date).sort().join(', ')}. Edit or remove those days in the DTR first.`);
    const year = Number(startDate.slice(0, 4));
    const bal = leaveBalances(data(), emp.id, year).find((b) => b.leaveTypeId === type.id);
    if (bal.remaining !== null && dates.length > bal.remaining && !body.allowOverdraw) {
      throw new HttpError(400, `That is ${dates.length} day(s) but only ${Math.max(0, bal.remaining)} ${type.name} day(s) are left. Tick "Allow going over the balance" to record it anyway.`);
    }
    const note = String(body.note || '').trim().slice(0, 200);
    for (const date of dates) {
      data().timeEntries.push({
        id: randomUUID(), employeeId: emp.id, date, type: 'leave', leaveTypeId: type.id, paid: type.paid,
        timeIn: null, timeOut: null, otApproved: false, remote: false, manualLeave: true,
        notes: `${type.name} (recorded by ${user.name})${note ? `: ${note}` : ''}`,
      });
    }
    save();
    const runs = finalizedOn(emp.campusId, dates);
    return { ...employeeLeave(emp, year), recorded: dates.length, warning: runs.length ? `Payroll for ${runs.map((r) => `${r.periodStart} to ${r.periodEnd}`).join(', ')} is already finalized, so those payslips are unchanged.` : null };
  });
  route('DELETE', '/api/hris/employees/:id/leave-days/:entryId', 'hris:leave.adjust', ({ params, user, campusId }) => {
    const emp = employeeIn(campusId, params.id);
    notOwnRecord(user, emp.id, 'remove leave days');
    const entry = data().timeEntries.find((e) => e.id === params.entryId && e.employeeId === emp.id && e.type === 'leave');
    if (!entry) throw new HttpError(404, 'Leave day not found.');
    if (entry.requestId) throw new HttpError(400, 'This day comes from an approved request. Cancel the request under Leave & requests instead, so the employee sees it.');
    data().timeEntries = data().timeEntries.filter((e) => e.id !== entry.id);
    save();
    const runs = finalizedOn(emp.campusId, [entry.date]);
    return { ...employeeLeave(emp, Number(entry.date.slice(0, 4))), warning: runs.length ? 'Payroll for that date is already finalized, so the payslip is unchanged.' : null };
  });

  // ----- Requests (HR and payroll see them; HR decides) -----
  // The reason and the medical certificate are health information: only those who decide on
  // leave (leave.approve) see them. Payroll sees what it needs to pay: the type, dates, days and status.
  const forReader = (user, view) => (userCan(user, 'leave.approve') ? view : { ...view, reason: '', decisionNote: '', attachment: view.attachment ? { withheld: true } : null, detailsWithheld: true });
  route('GET', '/api/hris/requests', 'hris:leave.manage', ({ query, campusId, user }) => {
    const mine = atCampus(campusId);
    return sortRequests(data().requests.filter((r) => mine.has(r.employeeId) && (!query.status || r.status === query.status)).map((r) => forReader(user, withEmployee(data(), r))));
  });
  route('GET', '/api/hris/requests/summary', 'hris:leave.manage', ({ campusId }) => {
    const mine = atCampus(campusId);
    return { pending: data().requests.filter((r) => r.status === 'pending' && mine.has(r.employeeId)).length };
  });
  route('GET', '/api/hris/requests/:id/attachment', 'hris:leave.approve', ({ params, campusId }) => certificates.read(findRequest(params.id, campusId).attachment));
  route('POST', '/api/hris/requests/:id/approve', 'hris:leave.approve', ({ params, body, user, campusId }) => {
    const req = findRequest(params.id, campusId);
    approve(data(), req, user, body.note);
    save();
    return withEmployee(data(), req);
  });
  route('POST', '/api/hris/requests/:id/reject', 'hris:leave.approve', ({ params, body, user, campusId }) => {
    const req = findRequest(params.id, campusId);
    if (req.status !== 'pending') throw new HttpError(400, `This request is already ${req.status}.`);
    if (user.employeeId && user.employeeId === req.employeeId) throw new HttpError(403, 'You cannot decide on your own request.');
    decide(req, user, 'rejected', body.note);
    save();
    return withEmployee(data(), req);
  });
  route('POST', '/api/hris/requests/:id/cancel', 'hris:leave.approve', ({ params, body, user, campusId }) => {
    const req = findRequest(params.id, campusId);
    // As with approving: another approver handles your own request (withdraw a pending one under Leave & requests).
    if (user.employeeId && user.employeeId === req.employeeId) throw new HttpError(403, 'You cannot cancel your own request here. Another approver must do it.');
    cancel(data(), req, user, body.note);
    save();
    return withEmployee(data(), req);
  });

  // ----- Employee self-service -----
  route('GET', '/api/hris/me/requests', 'hris', ({ user }) => {
    const emp = linkedEmployee(user);
    return sortRequests(data().requests.filter((r) => r.employeeId === emp.id).map((r) => withEmployee(data(), r)));
  });
  route('POST', '/api/hris/me/requests', 'hris', ({ user, body }) => {
    const emp = linkedEmployee(user);
    if (emp.status !== 'Active') throw new HttpError(400, 'Inactive employees cannot file requests.');
    const upload = body.kind !== 'remote' && body.attachment ? parseCertificate(body.attachment) : null;
    const req = buildRequest(data(), emp, user, body, upload);
    if (upload) req.attachment = certificates.save(body.attachment, user);
    data().requests.push(req);
    save();
    return withEmployee(data(), req);
  });
  route('POST', '/api/hris/me/requests/:id/cancel', 'hris', ({ user, params }) => {
    const req = ownRequest(user, params.id);
    if (req.status !== 'pending') throw new HttpError(400, 'Only pending requests can be withdrawn. Ask HR to cancel an approved one.');
    cancel(data(), req, user);
    save();
    return withEmployee(data(), req);
  });
  const ownRequest = (user, id) => {
    const emp = linkedEmployee(user);
    const req = findRequest(id);
    if (req.employeeId !== emp.id) throw new HttpError(404, 'Request not found.');
    return req;
  };
  route('GET', '/api/hris/me/requests/:id/attachment', 'hris', ({ user, params }) => certificates.read(ownRequest(user, params.id).attachment));
  // Attach or replace the medical certificate on a pending leave request.
  route('PUT', '/api/hris/me/requests/:id/attachment', 'hris', ({ user, params, body }) => {
    const req = ownRequest(user, params.id);
    if (req.kind !== 'leave') throw new HttpError(400, 'Files can only be attached to leave requests.');
    if (req.status !== 'pending') throw new HttpError(400, 'The certificate can only be changed while the request is pending.');
    const old = req.attachment;
    req.attachment = certificates.save(body.attachment, user);
    certificates.remove(old);
    save();
    return withEmployee(data(), req);
  });
  route('GET', '/api/hris/me/leave-balances', 'hris', ({ user, query }) => {
    const emp = linkedEmployee(user);
    return leaveBalances(data(), emp.id, Number(query.year) || thisYear()).filter((b) => b.active && b.offered);
  });

  return { certificates };
}
