// Leave, work-from-home and official-business requests routed Sprout-style: immediate supervisor
// first, then further levels (sequential or parallel), an Approval Center, half days, Leave
// Without Pay for days beyond the credits, return for revision, cancel with a reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { computePayslip, computeEntry, scheduleFor } from '../shared/calc.js';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-approvals-')), 'db.json');
const db = openDb(file);
const handle = createApi(db);
function client() {
  let cookie = '';
  return async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
}
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
const person = (no, firstName, extra = {}) => admin('POST', '/api/employees', { employeeNo: no, firstName, lastName: 'Cruz', hireDate: '2024-01-01', payType: 'monthly', rate: 30000, gender: 'Female', ...extra });
async function login(username, role, employeeId) {
  await admin('POST', '/api/users', { name: username, username, role, employeeId, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  return c;
}
// Lea (director) ← Ben (team lead) ← Ana (staff). Hana is HR.
const lea = await person('E-1', 'Lea');
const ben = await person('E-2', 'Ben', { supervisorId: lea.id });
const ana = await person('E-3', 'Ana', { supervisorId: ben.id });
const asLea = await login('lea', 'employee', lea.id);
const asBen = await login('ben', 'employee', ben.id);
const asAna = await login('ana', 'employee', ana.id);
const hr = await login('hana', 'hr');
const day = (d) => `2026-12-${String(d).padStart(2, '0')}`; // December 2026: the 1st is a Tuesday
const leave = (start, end = start, extra = {}) => ({ kind: 'leave', leaveTypeId: 'vl', startDate: start, endDate: end, reason: 'Family matters', ...extra });

test('supervisors are on the employee record, without loops', async () => {
  await assert.rejects(admin('PUT', `/api/employees/${lea.id}`, { ...lea, supervisorId: ana.id }), /loop/);
  await assert.rejects(admin('PUT', `/api/employees/${ana.id}`, { ...ana, supervisorId: ana.id }), /own supervisor/);
  const route = await asAna('GET', '/api/me/approvers');
  assert.deepEqual(route.levels.map((l) => l.label), ['Ben Cruz (immediate supervisor)', 'HR']);
  const status = await asBen('GET', '/api/auth/status');
  assert.equal(status.user.isApprover, true, 'a supervisor with reports is an approver');
  assert.equal((await asAna('GET', '/api/auth/status')).user.isApprover, false);
});

test('sequential: the supervisor approves first, then HR; only then is it in the DTR', async () => {
  const r = await asAna('POST', '/api/me/requests', leave(day(7)));
  assert.equal(r.status, 'pending');
  assert.deepEqual(r.waitingOn, ['Ben Cruz (immediate supervisor)']);
  // Not Lea's turn, and Ana cannot approve her own.
  await assert.rejects(asLea('POST', `/api/approvals/${r.id}/approve`), /not waiting for your approval/);
  assert.equal((await asBen('GET', '/api/approvals')).length, 1);
  assert.equal((await asBen('GET', '/api/approvals/summary')).pending, 1);
  const step = await asBen('POST', `/api/approvals/${r.id}/approve`, { note: 'Fine with me' });
  assert.equal(step.status, 'pending');
  assert.deepEqual(step.waitingOn, ['HR']);
  assert.equal(db.data.timeEntries.filter((e) => e.requestId === r.id).length, 0);
  assert.equal((await asBen('GET', '/api/approvals?tab=processed')).length, 1);
  const done = await hr('POST', `/api/approvals/${r.id}/approve`);
  assert.equal(done.status, 'approved');
  assert.equal(db.data.timeEntries.filter((e) => e.requestId === r.id && e.type === 'leave').length, 1);
  assert.deepEqual(done.approvals.map((l) => l.status), ['approved', 'approved']);
  assert.ok(done.history.some((h) => /Approved at level 1/.test(h.text)));
});

test('rejecting or returning needs remarks; a returned request is revised and starts again', async () => {
  const r = await asAna('POST', '/api/me/requests', leave(day(11)));
  await assert.rejects(asBen('POST', `/api/approvals/${r.id}/return`), /what the employee should change/);
  const back = await asBen('POST', `/api/approvals/${r.id}/return`, { note: 'Please file the 9th instead' });
  assert.equal(back.status, 'returned');
  assert.equal((await asBen('GET', '/api/approvals')).filter((x) => x.id === r.id).length, 0);
  const again = await asAna('PUT', `/api/me/requests/${r.id}`, leave(day(9)));
  assert.equal(again.status, 'pending');
  assert.equal(again.startDate, day(9));
  assert.deepEqual(again.waitingOn, ['Ben Cruz (immediate supervisor)']);
  assert.ok(again.history.some((h) => h.text === 'Revised and resubmitted'));
  await assert.rejects(asBen('POST', `/api/approvals/${r.id}/reject`), /reason for rejecting/);
  const no = await asBen('POST', `/api/approvals/${r.id}/reject`, { note: 'Team offsite that day' });
  assert.equal(no.status, 'rejected');
  assert.equal(no.decisionNote, 'Team offsite that day');
});

test('a level with nobody to approve it is skipped, so nothing is stuck', async () => {
  // Lea has no supervisor: her requests go straight to HR.
  const r = await asLea('POST', '/api/me/requests', leave(day(10)));
  assert.deepEqual(r.approvals.map((l) => l.status), ['skipped', 'pending']);
  assert.match(r.approvals[0].note, /No immediate supervisor/);
  await hr('POST', `/api/approvals/${r.id}/approve`);
  // HR can decide at any point (override), e.g. when the supervisor is away.
  const r2 = await asAna('POST', '/api/me/requests', leave(day(14)));
  const o = await hr('POST', `/api/requests/${r2.id}/approve`, { note: 'Ben is on leave' });
  assert.equal(o.status, 'approved');
  assert.ok(o.history.some((h) => /HR override/.test(h.text)));
});

test('parallel: one approval at any level decides it', async () => {
  const flow = await admin('GET', '/api/approval-flow');
  await admin('PUT', '/api/approval-flow', { flow: 'parallel', levels: [{ type: 'supervisor' }, { type: 'manager' }] });
  const r = await asAna('POST', '/api/me/requests', leave(day(15)));
  assert.deepEqual(r.waitingOn, ['Ben Cruz (immediate supervisor)', "Lea Cruz (supervisor's supervisor)"]);
  const done = await asLea('POST', `/api/approvals/${r.id}/approve`);
  assert.equal(done.status, 'approved');
  assert.deepEqual(done.approvals.map((l) => l.status), ['skipped', 'approved']);
  await admin('PUT', '/api/approval-flow', { flow: flow.flow, levels: flow.levels });
});

test('half days: a 1st-half leave pays half a day and the afternoon is timed against half the shift', async () => {
  const r = await asAna('POST', '/api/me/requests', leave(day(16), day(17), { portions: { [day(16)]: 'am' } }));
  assert.equal(r.days, 1.5);
  await asBen('POST', `/api/approvals/${r.id}/approve`);
  await hr('POST', `/api/approvals/${r.id}/approve`);
  const half = db.data.timeEntries.find((e) => e.employeeId === ana.id && e.date === day(16));
  assert.equal(half.type, 'work');
  assert.equal(half.halfLeave.portion, 'am');
  // She works the afternoon, arriving at 1:40 PM on a 9-to-6 shift (mid-shift is 1:30 PM).
  Object.assign(half, { timeIn: '13:40', timeOut: '18:00' });
  const emp = db.data.employees.find((e) => e.id === ana.id);
  const c = computeEntry(half, scheduleFor(emp, db.data.settings), db.data.settings);
  assert.equal(c.lateMinutes, 10);
  assert.equal(c.undertimeMinutes, 0);
  const slip = computePayslip({ employee: emp, entries: db.data.timeEntries, periodStart: day(16), periodEnd: day(17), settings: db.data.settings });
  assert.equal(slip.attendance.leaveDays, 1.5);
  assert.equal(slip.attendance.daysPresent, 0.5);
  const bal = (await asAna('GET', '/api/me/leave-balances?year=2026')).find((b) => b.leaveTypeId === 'vl');
  assert.equal(bal.used, 1 + 1 + 1 + 1.5, 'whole days and the half day count');
});

test('days beyond the remaining credits go to Leave Without Pay', async () => {
  await admin('PUT', '/api/leave-credits', { employeeId: ana.id, year: 2026, leaveTypeId: 'el', credits: 1 });
  const r = await asAna('POST', '/api/me/requests', { ...leave(day(21), day(22)), leaveTypeId: 'el' });
  assert.equal(r.paidDays, 1);
  assert.equal(r.overflowDays, 1);
  assert.deepEqual(r.breakdown.map((d) => Boolean(d.overflow)), [false, true]);
  await hr('POST', `/api/requests/${r.id}/approve`);
  const entries = db.data.timeEntries.filter((e) => e.requestId === r.id).sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(entries.map((e) => [e.leaveTypeId, e.paid]), [['el', true], ['lwop', false]]);
});

test('file-ahead rule, official business, bulk approval and cancelling with a reason', async () => {
  const vl = db.data.leaveTypes.find((t) => t.id === 'vl');
  await admin('PUT', '/api/leave-types/vl', { ...vl, advanceDays: 90 });
  await assert.rejects(asAna('POST', '/api/me/requests', leave(day(23))), /at least 90 days before/);
  await admin('PUT', '/api/leave-types/vl', { ...vl, advanceDays: null });
  await assert.rejects(asAna('POST', '/api/me/requests', { kind: 'ob', startDate: day(23), endDate: day(23) }), /where you will be/);
  const ob = await asAna('POST', '/api/me/requests', { kind: 'ob', startDate: day(23), endDate: day(23), destination: 'Client site, Makati' });
  const wfh = await asAna('POST', '/api/me/requests', { kind: 'remote', startDate: day(29), endDate: day(29) });
  const bulk = await asBen('POST', '/api/approvals/bulk', { ids: [ob.id, wfh.id, 'nope'] });
  assert.equal(bulk.approved, 2);
  assert.equal(bulk.failed.length, 1);
  await hr('POST', '/api/approvals/bulk', { ids: [ob.id, wfh.id] });
  const obDay = db.data.timeEntries.find((e) => e.employeeId === ana.id && e.date === day(23));
  assert.equal(obDay.officialBusiness, true);
  assert.equal(obDay.destination, 'Client site, Makati');
  // Ben approved it, so he can cancel it, with a reason; the day leaves the DTR.
  await assert.rejects(asBen('POST', `/api/requests/${ob.id}/cancel`), /reason for cancelling/);
  const c = await asBen('POST', `/api/requests/${ob.id}/cancel`, { note: 'Client meeting moved' });
  assert.equal(c.status, 'cancelled');
  assert.ok(!db.data.timeEntries.some((e) => e.requestId === ob.id));
  await assert.rejects(asLea('POST', `/api/requests/${wfh.id}/cancel`, { note: 'x' }), /Only HR or an approver/);
  // The employee withdraws her own pending request.
  const p = await asAna('POST', '/api/me/requests', leave(day(28)));
  const w = await asAna('POST', `/api/me/requests/${p.id}/cancel`, { reason: 'Plans changed' });
  assert.equal(w.cancelReason, 'Plans changed');
  assert.equal((await asBen('GET', '/api/approvals?tab=team')).length >= 5, true, 'the team tab lists the direct reports’ requests');
});
