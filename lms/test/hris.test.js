// HRIS: the ERP's pay rules carried over unchanged, access by account type and campus,
// employee records and accounts, the time clock, leave approval and payroll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import fs from 'node:fs';
import * as lmsCalc from '../shared/calc.js';

// The ERP sits next to the LMS in this repository; its pay rules are the reference.
const ERP_CALC = new URL('../../shared/calc.js', import.meta.url);

const PW = 'password123';
const status = (code) => (err) => err.status === code;

// An admin, a second campus, an HR manager at the main campus, a teacher there, and an employee record.
async function hrisSchool(opts = {}) {
  const env = setup({ today: '2026-11-03', ...opts });
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const main = (await admin.get('/api/admin/campuses'))[0];
  const other = await admin.post('/api/admin/campuses', { name: 'North Campus', code: 'NOR' });
  const teacher = await admin.post('/api/admin/users', { role: 'teacher', username: 'tess', name: 'Tess Teacher', password: PW, mustChangePassword: false, campusIds: [main.id] });
  const signIn = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: PW });
    return c;
  };
  const newEmployee = (client, extra = {}) => client.post('/api/hris/employees', {
    firstName: 'Nora', lastName: 'Staff', gender: 'Female', hireDate: '2025-01-06', payType: 'monthly', rate: 26100, position: 'Clerk', department: 'Registrar', ...extra,
  });
  // The admin makes the first HR manager from an employee record.
  const hrEmp = await newEmployee(admin, { firstName: 'Hana', lastName: 'Reyes' });
  await admin.post(`/api/hris/employees/${hrEmp.id}/account`, { role: 'hr', username: 'hana', password: PW, mustChangePassword: false });
  const hr = await signIn('hana');
  return { env, admin, hr, main, other, teacher, signIn, newEmployee, hrEmp };
}

// Everything ATLAS computes must match CORE (the same value under the same name). CORE may compute
// more (e.g. its holiday and night-shift premiums, added after ATLAS took the engine), so its extra
// fields are not compared: a new CORE feature must not fail ATLAS's tests, or CORE's deploys.
function assertSameAsCore(atlas, core, path = 'payslip') {
  if (atlas && typeof atlas === 'object') {
    assert.ok(core && typeof core === 'object', `${path}: CORE has no ${path}`);
    for (const k of Object.keys(atlas)) assertSameAsCore(atlas[k], core[k], `${path}.${k}`);
  } else {
    assert.deepEqual(atlas, core, `${path}: ATLAS ${atlas}, CORE ${core}`);
  }
}

test('payroll and time rules agree with the ERP\'s (CORE)', { skip: !fs.existsSync(ERP_CALC) && 'the ERP is not next to the LMS' }, async () => {
  const erpCalc = await import(ERP_CALC);
  const settings = { ...lmsCalc.DEFAULT_SETTINGS, workDaysPerYear: 261 };
  const employee = { id: 'e1', employeeNo: 'E1', firstName: 'A', lastName: 'B', payType: 'monthly', rate: 32000, allowance: 2000, hireDate: '2020-01-01', schedule: settings.schedule };
  const entries = [
    { employeeId: 'e1', date: '2026-10-01', type: 'work', timeIn: '08:20', timeOut: '17:00' },
    { employeeId: 'e1', date: '2026-10-02', type: 'work', timeIn: '08:00', timeOut: '19:00', otApproved: true },
    { employeeId: 'e1', date: '2026-10-05', type: 'leave', paid: true },
  ];
  const args = { employee, entries, periodStart: '2026-10-01', periodEnd: '2026-10-15', settings };
  assertSameAsCore(lmsCalc.computePayslip(args), erpCalc.computePayslip(args));
  for (const fn of ['sssContribution', 'philhealthContribution', 'pagibigContribution']) assert.deepEqual(lmsCalc[fn](32000), erpCalc[fn](32000));
  assert.equal(lmsCalc.withholdingTax(16000, 'semi-monthly'), erpCalc.withholdingTax(16000, 'semi-monthly'));
});

test('HRIS access: students are kept out, teachers only get self-service, HR sees its own campus', async () => {
  const { env, admin, hr, other, signIn, newEmployee } = await hrisSchool();
  await admin.post('/api/admin/users', { role: 'student', username: 'stu', name: 'Stu Dent', password: PW, mustChangePassword: false });
  const student = await signIn('stu');
  const st = await student.get('/api/hris/auth/status');
  assert.equal(st.user, null);
  assert.equal(st.deniedUser.name, 'Stu Dent');
  await assert.rejects(student.get('/api/hris/me/profile'), status(403));

  const teacher = await signIn('tess');
  assert.deepEqual((await teacher.get('/api/hris/auth/status')).permissions, []);
  await assert.rejects(teacher.get('/api/hris/employees'), status(403));
  await assert.rejects(teacher.get('/api/hris/me/profile'), /not linked/);

  // An employee at the other campus is invisible to HR at the main campus, until they switch (they can't: one campus).
  await admin.post('/api/admin/auth/campus', { campusId: other.id });
  const far = await newEmployee(admin, { firstName: 'Far', lastName: 'Away' });
  assert.equal(far.campusName, 'North Campus');
  assert.ok(!(await hr.get('/api/hris/employees')).some((e) => e.id === far.id));
  await assert.rejects(hr.get(`/api/hris/employees/${far.id}`), status(404));
  await assert.rejects(hr.post('/api/hris/auth/campus', { campusId: other.id }), status(403));
  assert.equal(env.db.data.employees.length, 2);
});

test('HR accounts sign in on the University Portal only, get the HRIS tile, and one sign-in per browser', async () => {
  const { hr, env } = await hrisSchool();
  const hub = await hr.get('/api/hub/status');
  assert.equal(hub.side, 'hris');
  assert.deepEqual(hub.systems.filter((s) => s.status === 'live').map((s) => [s.id, s.url]), [['hris', '/hris/'], ['fmis', '/finance/']]);
  await assert.rejects(env.client().post('/api/auth/login', { username: 'hana', password: PW }), /ATLAS home page/);
  await assert.rejects(env.client().post('/api/admin/auth/login', { username: 'hana', password: PW }), /ATLAS home page/);
  // Signing in as someone else on the same browser ends the HR session.
  await hr.post('/api/hub/login', { username: 'tess', password: PW });
  const now = await hr.get('/api/hris/auth/status');
  assert.equal(now.user.username, 'tess');
  assert.deepEqual(now.permissions, []);
});

test('linking a teacher\'s LMS account gives them HRIS self-service; the time clock records the day', async () => {
  let now = new Date('2026-11-03T08:12:00');
  const { hr, teacher, signIn, newEmployee } = await hrisSchool({ clock: () => now });
  const linkable = await hr.get('/api/hris/accounts/linkable');
  assert.ok(linkable.some((u) => u.id === teacher.id));
  const emp = await newEmployee(hr, { firstName: 'Tess', lastName: 'Teacher', category: 'teaching', linkUserId: teacher.id });
  assert.equal(emp.account.username, 'tess');
  assert.equal(emp.category, 'teaching');
  await assert.rejects(newEmployee(hr, { firstName: 'Dup', lastName: 'Link', linkUserId: teacher.id }), /already linked/);

  const t = await signIn('tess');
  assert.equal((await t.get('/api/hris/auth/status')).employee.id, emp.id);
  const inRes = await t.post('/api/hris/me/clock', { action: 'in' });
  assert.equal(inRes.entry.timeIn, '08:12');
  await assert.rejects(t.post('/api/hris/me/clock', { action: 'in' }), /Already clocked in/);
  now = new Date('2026-11-03T17:30:00');
  const outRes = await t.post('/api/hris/me/clock', { action: 'out' });
  assert.equal(outRes.entry.timeOut, '17:30');
  const dtr = await hr.get(`/api/hris/time-entries?employeeId=${emp.id}`);
  assert.equal(dtr.length, 1);
  // HR can see it; the teacher cannot edit the DTR.
  await assert.rejects(t.put(`/api/hris/time-entries/${dtr[0].id}`, { ...dtr[0], otApproved: true }), status(403));
});

test('HRIS accounts for staff: created on the record, disabled, password reset', async () => {
  const { hr, signIn, newEmployee, env } = await hrisSchool();
  const emp = await newEmployee(hr);
  const withAcct = await hr.post(`/api/hris/employees/${emp.id}/account`, { role: 'staff', username: 'nora', password: PW, mustChangePassword: false });
  assert.equal(withAcct.account.roleLabel, 'Staff');
  const nora = await signIn('nora');
  assert.equal((await nora.get('/api/hris/me/profile')).id, emp.id);
  await assert.rejects(hr.post(`/api/hris/employees/${emp.id}/account`, { role: 'staff', username: 'nora2', password: PW }), /already has an account/);
  await hr.put(`/api/hris/employees/${emp.id}/account`, { status: 'disabled' });
  await assert.rejects(nora.get('/api/hris/me/profile'), status(401));
  await hr.put(`/api/hris/employees/${emp.id}/account`, { status: 'active', password: 'brandnew123' });
  const u = env.db.data.users.find((x) => x.username === 'nora');
  assert.equal(u.mustChangePassword, true);
  // Payroll officers cannot make accounts.
  const pemp = await newEmployee(hr, { firstName: 'Pay', lastName: 'Roll' });
  await hr.post(`/api/hris/employees/${pemp.id}/account`, { role: 'payroll', username: 'pay', password: PW, mustChangePassword: false });
  const pay = await signIn('pay');
  await assert.rejects(pay.post(`/api/hris/employees/${emp.id}/account`, { role: 'hr', username: 'x.y.z', password: PW }), status(403));
  await assert.rejects(pay.post('/api/hris/employees', { firstName: 'N', lastName: 'O', hireDate: '2025-01-01', payType: 'monthly', rate: 1 }), status(403));
});

test('leave: file, approve into the DTR, balances, no self-approval, medical certificate rule', async () => {
  const { hr, signIn, newEmployee, hrEmp } = await hrisSchool();
  const emp = await newEmployee(hr);
  await hr.post(`/api/hris/employees/${emp.id}/account`, { role: 'staff', username: 'nora', password: PW, mustChangePassword: false });
  const nora = await signIn('nora');
  // Mon 9 – Tue 10 Nov 2026: two work days.
  const req = await nora.post('/api/hris/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: '2026-11-09', endDate: '2026-11-10', reason: 'Trip' });
  assert.equal(req.days, 2);
  let vl = (await nora.get('/api/hris/me/leave-balances?year=2026')).find((b) => b.leaveTypeId === 'vl');
  assert.equal(vl.pending, 2);
  await assert.rejects(nora.post('/api/hris/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: '2026-11-10', endDate: '2026-11-10' }), /overlaps/);
  // Sick leave over 3 days needs a certificate.
  await assert.rejects(nora.post('/api/hris/me/requests', { kind: 'leave', leaveTypeId: 'sl', startDate: '2026-11-16', endDate: '2026-11-19' }), /medical certificate/);
  const pdf = Buffer.from('%PDF-1.4\n% demo\n').toString('base64');
  const sick = await nora.post('/api/hris/me/requests', { kind: 'leave', leaveTypeId: 'sl', startDate: '2026-11-16', endDate: '2026-11-19', attachment: { name: 'cert.pdf', data: pdf } });
  assert.equal(sick.attachment.type, 'application/pdf');
  assert.equal((await hr.get(`/api/hris/requests/${sick.id}/attachment`)).data, pdf);
  await assert.rejects(nora.post('/api/hris/me/requests', { kind: 'leave', leaveTypeId: 'sl', startDate: '2026-11-23', endDate: '2026-11-26', attachment: { name: 'x.exe', data: Buffer.from('MZ...').toString('base64') } }), /PDF or a photo/);

  assert.equal((await hr.get('/api/hris/requests/summary')).pending, 2);
  const approved = await hr.post(`/api/hris/requests/${req.id}/approve`, { note: 'Enjoy' });
  assert.equal(approved.status, 'approved');
  const dtr = await hr.get(`/api/hris/time-entries?employeeId=${emp.id}`);
  assert.deepEqual(dtr.map((e) => [e.date, e.type, e.leaveTypeId]).sort(), [['2026-11-09', 'leave', 'vl'], ['2026-11-10', 'leave', 'vl']]);
  vl = (await nora.get('/api/hris/me/leave-balances?year=2026')).find((b) => b.leaveTypeId === 'vl');
  assert.deepEqual([vl.used, vl.pending, vl.remaining], [2, 0, 13]);
  // Cancelling gives the days back.
  await hr.post(`/api/hris/requests/${req.id}/cancel`, {});
  assert.equal((await hr.get(`/api/hris/time-entries?employeeId=${emp.id}`)).length, 0);

  // HR cannot approve their own request.
  const hana = hr;
  const own = await hana.post('/api/hris/me/requests', { kind: 'remote', startDate: '2026-11-12', endDate: '2026-11-12' });
  assert.equal(own.employeeId, hrEmp.id);
  await assert.rejects(hana.post(`/api/hris/requests/${own.id}/approve`, {}), /own request/);
  // Maternity leave is for women; Nora is.
  const ml = (await hr.get(`/api/hris/employees/${emp.id}/leave?year=2026`)).balances.find((b) => b.leaveTypeId === 'pl');
  assert.equal(ml.eligible, false);
});

test('payroll: one run per period per campus, finalized payslips reach the employee', async () => {
  const { hr, admin, signIn, newEmployee } = await hrisSchool();
  const emp = await newEmployee(hr);
  await hr.post(`/api/hris/employees/${emp.id}/account`, { role: 'staff', username: 'nora', password: PW, mustChangePassword: false });
  for (const date of ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']) {
    await hr.post('/api/hris/time-entries', { employeeId: emp.id, date, type: 'work', timeIn: '08:00', timeOut: '17:00' });
  }
  // HR can view payroll but not run it; the administrator can.
  await assert.rejects(hr.post('/api/hris/payroll-runs', { periodStart: '2026-10-01', periodEnd: '2026-10-15' }), status(403));
  const run = await admin.post('/api/hris/payroll-runs', { periodStart: '2026-10-01', periodEnd: '2026-10-15' });
  const slip = run.payslips.find((p) => p.employeeId === emp.id);
  assert.equal(slip.attendance.daysPresent, 11);
  assert.equal(slip.earnings.basicPay, 13050); // half of 26,100: full attendance
  assert.equal(slip.attendance.absentDays, 0);
  await assert.rejects(admin.post('/api/hris/payroll-runs', { periodStart: '2026-10-10', periodEnd: '2026-10-20' }), /already a payroll run/);
  const nora = await signIn('nora');
  assert.equal((await nora.get('/api/hris/me/payslips')).length, 0); // drafts are not shown
  await admin.post(`/api/hris/payroll-runs/${run.id}/finalize`, {});
  await assert.rejects(admin.post(`/api/hris/payroll-runs/${run.id}/recompute`, {}), /finalized/);
  const mine = await nora.get('/api/hris/me/payslips');
  assert.equal(mine.length, 1);
  assert.equal((await nora.get(`/api/hris/me/payslips/${run.id}`)).payslip.netPay, slip.netPay);
});

test('demo data adds HR records for the demo school and removes them again', async () => {
  const { env, admin } = await hrisSchool();
  const before = env.db.data.employees.length;
  await admin.post('/api/admin/demo');
  const d = env.db.data;
  assert.ok(d.employees.filter((e) => e.demo).length >= 20);
  assert.ok(d.payrollRuns.some((r) => r.demo && r.status === 'finalized'));
  const maria = d.users.find((u) => u.username === 'teacher.demo');
  assert.ok(d.employees.some((e) => e.id === maria.employeeId));
  for (const u of ['hr.demo', 'payroll.demo', 'staff.demo']) assert.ok(d.users.some((x) => x.username === u && x.employeeId));
  await admin.del('/api/admin/demo');
  assert.equal(env.db.data.employees.length, before);
  assert.equal(env.db.data.timeEntries.length, 0);
  assert.equal(env.db.data.requests.length, 0);
  assert.equal(env.db.data.payrollRuns.length, 0);
});

// ----- From the ERP: clock-in geotagging, the shared time clock, and the port fixes -----

const NEAR = { lat: 13.58795, lng: 123.28290, accuracy: 25 }; // about 60 m from the campus point
const FAR = { lat: 13.62, lng: 123.19, accuracy: 15 }; // about 10 km away

test('clock-in geotagging: recorded per campus, flagged, shown only to HR and administrators', async () => {
  let now = new Date('2026-11-03T08:05:00');
  const { hr, admin, teacher, signIn, newEmployee } = await hrisSchool({ clock: () => now });
  // Validation, then the campus location.
  await assert.rejects(hr.put('/api/hris/location-settings', { officeLabel: 'Main', officeLat: 13.5876, officeLng: '', radius: 300, retentionDays: 365 }), /both latitude and longitude/);
  await assert.rejects(hr.put('/api/hris/location-settings', { officeLat: 13.5876, officeLng: 123.2826, radius: 5, retentionDays: 365 }), /radius/);
  const loc = await hr.put('/api/hris/location-settings', { officeLabel: 'Main campus', officeLat: 13.5876, officeLng: 123.2826, radius: 300, retentionDays: 365 });
  assert.equal(loc.radius, 300);
  assert.equal((await hr.get('/api/hris/settings')).location.officeLabel, 'Main campus');

  const emp = await newEmployee(hr, { firstName: 'Tess', lastName: 'Teacher', category: 'teaching', linkUserId: teacher.id });
  const t = await signIn('tess');
  const res = await t.post('/api/hris/me/clock', { action: 'in', location: NEAR });
  // The employee never gets a location back, not even their own.
  assert.equal(res.entry.timeIn, '08:05');
  assert.ok(!('clockInLocation' in res.entry));
  assert.ok((await t.get('/api/hris/me/time-entries')).every((e) => !('clockInLocation' in e)));
  await assert.rejects(t.get('/api/hris/clock-locations'), status(403));
  await assert.rejects(t.put('/api/hris/location-settings', { radius: 300, retentionDays: 365 }), status(403));

  const [entry] = await hr.get(`/api/hris/time-entries?employeeId=${emp.id}`);
  assert.equal(entry.clockInLocation.status, 'ok');
  assert.equal(entry.clockInLocation.source, 'self');
  assert.equal(entry.clockInLocation.inside, true);
  assert.ok(entry.clockInLocation.distance > 20 && entry.clockInLocation.distance < 120);

  // Editing the record keeps the location.
  now = new Date('2026-11-03T17:00:00');
  await t.post('/api/hris/me/clock', { action: 'out' });
  const edited = await hr.put(`/api/hris/time-entries/${entry.id}`, { ...entry, timeOut: '17:00', notes: 'checked' });
  assert.equal(edited.clockInLocation.inside, true);

  // Far away, and no location at all (permission denied): flagged, never blocked.
  now = new Date('2026-11-04T08:00:00');
  await t.post('/api/hris/me/clock', { action: 'in', location: FAR });
  now = new Date('2026-11-04T17:00:00');
  await t.post('/api/hris/me/clock', { action: 'out' });
  now = new Date('2026-11-05T08:00:00');
  await t.post('/api/hris/me/clock', { action: 'in', locationError: 'denied' });
  const list = await hr.get('/api/hris/clock-locations?from=2026-11-01&to=2026-11-30');
  assert.deepEqual(list.map((r) => [r.date, r.status, r.inside ?? null]), [['2026-11-05', 'denied', null], ['2026-11-04', 'ok', false], ['2026-11-03', 'ok', true]]);
  assert.ok(list[1].distance > 5000);
  // Administrators see it too.
  assert.equal((await admin.get('/api/hris/clock-locations')).length, 3);
});

test('clock-in locations are deleted after the campus retention period', async () => {
  const now = new Date('2026-11-03T08:00:00');
  const { env, hr, newEmployee } = await hrisSchool({ clock: () => now });
  const emp = await newEmployee(hr);
  env.db.data.timeEntries.push(
    { id: 'old', employeeId: emp.id, date: '2026-07-01', type: 'work', timeIn: '08:00', timeOut: '17:00', clockInLocation: { status: 'ok', lat: 1, lng: 1, source: 'self', at: '2026-07-01T00:00:00Z' } },
    { id: 'new', employeeId: emp.id, date: '2026-10-30', type: 'work', timeIn: '08:00', timeOut: '17:00', clockInLocation: { status: 'ok', lat: 1, lng: 1, source: 'self', at: '2026-10-30T00:00:00Z' } },
  );
  await hr.put('/api/hris/location-settings', { radius: 300, retentionDays: 60 });
  const byId = Object.fromEntries(env.db.data.timeEntries.map((e) => [e.id, e]));
  assert.ok(!byId.old.clockInLocation, 'older than 60 days: location removed');
  assert.ok(byId.old.timeIn, 'the attendance record stays');
  assert.ok(byId.new.clockInLocation);
});

test('shared time clock: HR clocks campus employees in and out; others cannot', async () => {
  let now = new Date('2026-11-03T07:58:00');
  const { env, hr, other, newEmployee, signIn } = await hrisSchool({ clock: () => now });
  const emp = await newEmployee(hr, { firstName: 'Kio', lastName: 'Sk' });
  const board = await hr.get('/api/hris/clock');
  assert.ok(board.people.some((p) => p.id === emp.id));
  assert.ok(board.people.every((p) => !('rate' in p)), 'no pay details on the time clock');
  const r = await hr.post('/api/hris/clock', { employeeId: emp.id, action: 'in', location: NEAR });
  assert.match(r.message, /Kio clocked in at 07:58/);
  assert.equal((await hr.get('/api/hris/clock')).entries.find((e) => e.employeeId === emp.id).clockInLocation.source, 'kiosk');
  now = new Date('2026-11-03T17:05:00');
  await hr.post('/api/hris/clock', { employeeId: emp.id, action: 'out' });
  // An employee of another campus cannot be clocked from this one.
  const elsewhere = await newEmployee(hr, { firstName: 'Far', lastName: 'Away' });
  env.db.data.employees.find((e) => e.id === elsewhere.id).campusId = other.id;
  await assert.rejects(hr.post('/api/hris/clock', { employeeId: elsewhere.id, action: 'in' }), status(404));
  assert.ok(!(await hr.get('/api/hris/clock')).people.some((p) => p.id === elsewhere.id));
  // A payroll officer has no time clock.
  const pEmp = await newEmployee(hr, { firstName: 'Pay', lastName: 'Roll' });
  await hr.post(`/api/hris/employees/${pEmp.id}/account`, { role: 'payroll', username: 'payo', password: PW, mustChangePassword: false });
  const payroll = await signIn('payo');
  await assert.rejects(payroll.get('/api/hris/clock'), status(403));
  await assert.rejects(payroll.post('/api/hris/clock', { employeeId: emp.id, action: 'in' }), status(403));
});

test('HR dashboard: per-employee attendance today; work on a rest day is never late', async () => {
  let now = new Date('2026-11-03T09:30:00'); // a Tuesday
  const { hr, newEmployee } = await hrisSchool({ clock: () => now });
  const late = await newEmployee(hr, { firstName: 'Lena', lastName: 'Late' });
  await newEmployee(hr, { firstName: 'Abby', lastName: 'Absent' });
  await hr.post('/api/hris/clock', { employeeId: late.id, action: 'in' });
  let d = await hr.get('/api/hris/dashboard');
  assert.equal(d.today.late, 1);
  const row = d.today.rows.find((x) => x.id === late.id);
  assert.equal(row.status, 'in');
  assert.equal(row.lateMinutes, 90);
  assert.ok(d.today.rows.some((x) => x.name === 'Absent, Abby' && x.status === 'not-in'));
  // Saturday: Lena comes in at 09:30, which is rest-day work, not lateness.
  now = new Date('2026-11-07T09:30:00');
  await hr.put(`/api/hris/time-entries/${(await hr.get(`/api/hris/time-entries?employeeId=${late.id}`))[0].id}`, { employeeId: late.id, date: '2026-11-03', type: 'work', timeIn: '09:30', timeOut: '17:00' });
  await hr.post('/api/hris/clock', { employeeId: late.id, action: 'in' });
  d = await hr.get('/api/hris/dashboard');
  assert.equal(d.today.late, 0);
  assert.equal(d.today.rows.find((x) => x.id === late.id).lateMinutes, 0);
});

test('port fixes: payslips keep their campus, partial rate settings are filled in, demo clean-up', async () => {
  const { env, admin, main } = await hrisSchool();
  const run = await admin.post('/api/hris/payroll-runs', { periodStart: '2026-10-01', periodEnd: '2026-10-15' });
  assert.equal(run.campusName, main.name);
  await admin.put(`/api/admin/campuses/${main.id}`, { ...main, name: 'Renamed Campus' }).catch(() => {});
  await admin.post(`/api/hris/payroll-runs/${run.id}/finalize`, {});
  assert.ok((await admin.get(`/api/hris/payroll-runs/${run.id}`)).campusName);

  const { mergeHrSettings } = await import('../server/hris.js');
  const merged = mergeHrSettings({ rates: { sss: { eeRate: 0.045 } } });
  assert.equal(merged.rates.sss.eeRate, 0.045);
  assert.equal(merged.rates.sss.maxMsc, lmsCalc.DEFAULT_RATES.sss.maxMsc, 'missing SSS fields come from the defaults');
  assert.equal(merged.rates.philhealth.rate, lmsCalc.DEFAULT_RATES.philhealth.rate);

  // Removing the demo takes demo employees out of real draft runs; adding it brings back deleted standard leave types.
  const { removeHrisDemo } = await import('../server/hris-demo.js');
  const slip = (id, net) => ({ employeeId: id, grossPay: net, totalDeductions: 0, netPay: net, employerShare: { sss: 0, sssEc: 0, philhealth: 0, pagibig: 0 } });
  const data = {
    employees: [{ id: 'd1', demo: true }, { id: 'r1' }], timeEntries: [], requests: [], leaveCredits: [], leaveAccess: [], leaveAdjustments: [], users: [],
    payrollRuns: [{ id: 'run', status: 'draft', employeeIds: ['d1', 'r1'], payslips: [slip('d1', 100), slip('r1', 250)] }],
  };
  removeHrisDemo(data);
  assert.deepEqual(data.payrollRuns[0].employeeIds, ['r1']);
  assert.equal(data.payrollRuns[0].totals.netPay, 250);
  env.db.data.leaveTypes = env.db.data.leaveTypes.filter((t) => t.id !== 'vl');
  await admin.post('/api/admin/demo');
  assert.ok(env.db.data.leaveTypes.some((t) => t.id === 'vl'));
});

// ----- Government payroll (state university): salary grades, GSIS, PERA/RATA, leave, loans, bonuses -----
import * as gov from '../shared/gov-pay.js';

test('government pay rules: EO 64 schedule, contributions, PERA and RATA, tax, net pay floor', () => {
  // Every row rises step by step and grade by grade; SG 33 has two steps.
  for (const s of gov.SALARY_SCHEDULES) {
    for (const [sg, row] of Object.entries(s.grades)) {
      assert.equal(row.length, sg === '33' ? 2 : 8);
      for (let i = 1; i < row.length; i++) assert.ok(row[i] > row[i - 1], `${s.effective} SG ${sg} step ${i + 1}`);
    }
  }
  assert.equal(gov.salaryFor(11, 1, '2026-06-30'), 31705);
  assert.equal(gov.salaryFor(11, 1, '2027-01-15'), 33387); // the next tranche from January
  assert.equal(gov.salaryFor(1, 1, '2026-01-01'), 14634);
  assert.equal(gov.rataShare(17), 1);
  assert.equal(gov.rataShare(12), 0.75);
  assert.equal(gov.rataShare(6), 0.5);
  assert.equal(gov.rataShare(1), 0.25);
  assert.deepEqual([3.5, 2.2, 1, 0.5].map(gov.prorateShare), [0.4, 0.3, 0.2, 0.1]);

  const settings = { ...lmsCalc.DEFAULT_SETTINGS, payFrequency: 'monthly', contributions: { ...lmsCalc.DEFAULT_SETTINGS.contributions, gsis: true } };
  const emp = { id: 'e', employeeNo: 'E', firstName: 'A', lastName: 'B', salaryGrade: 12, step: 1, hireDate: '2020-01-01', status: 'Active', rataRepresentation: 5000, rataTransportation: 5000, schedule: settings.schedule };
  const days = [...lmsCalc.eachDate('2026-10-01', '2026-10-31')].filter((d) => ![0, 6].includes(lmsCalc.dayOfWeek(d)));
  // 22 work days in October 2026; one absence without pay and 60 minutes late (no leave credits left).
  const entries = days.slice(1).map((d, i) => ({ employeeId: 'e', date: d, type: 'work', timeIn: i === 0 ? '09:00' : '08:00', timeOut: '17:00' }));
  const p = gov.computeGovPayslip({ employee: emp, entries, periodStart: '2026-10-01', periodEnd: '2026-10-31', settings, vlRemaining: 0, deductions: [] });
  const daily = 33947 / 22;
  assert.equal(p.earnings.absenceDeduction, lmsCalc.round2(daily));
  assert.equal(p.earnings.tardinessDeduction, lmsCalc.round2(60 * (daily / 480)));
  assert.equal(p.earnings.pera, lmsCalc.round2(2000 - 2000 / 22)); // PERA less 1/22 for the day without pay
  assert.equal(p.earnings.rataDays, 21);
  assert.equal(p.earnings.representation, 5000); // 21 days of actual work: full RATA
  assert.equal(p.deductions.gsis, lmsCalc.round2(33947 * 0.09));
  assert.equal(p.employerShare.gsis, lmsCalc.round2(33947 * 0.12));
  assert.equal(p.employerShare.ecc, 100);
  assert.equal(p.deductions.pagibig, 200);
  assert.equal(p.deductions.philhealth, lmsCalc.round2(33947 * 0.025));
  // PERA and RATA are not taxable.
  assert.equal(p.taxableIncome, lmsCalc.round2(p.earnings.basicPay - p.deductions.gsis - p.deductions.philhealth - p.deductions.pagibig));
  assert.equal(p.deductions.withholdingTax, lmsCalc.withholdingTax(p.taxableIncome, 'monthly'));

  // With vacation leave credits, tardiness comes off the credits, not the pay.
  const withLeave = gov.computeGovPayslip({ employee: emp, entries, periodStart: '2026-10-01', periodEnd: '2026-10-31', settings, vlRemaining: 5 });
  assert.equal(withLeave.earnings.tardinessDeduction, 0);
  assert.equal(withLeave.leave.chargedToLeaveDays, 0.125);

  // Loans: GSIS first; one that would bring net pay below P5,000 a month is held back.
  const loans = [
    { id: 'big', type: 'COOP', monthly: 40000, startDate: '2026-01-01', createdAt: '1' },
    { id: 'gsis', type: 'GSIS-CONSO', monthly: 4000, total: 6000, startDate: '2026-01-01', createdAt: '2' },
  ];
  const q = gov.computeGovPayslip({ employee: emp, entries, periodStart: '2026-10-01', periodEnd: '2026-10-31', settings, vlRemaining: 5, deductions: loans, paidSoFar: { gsis: 4000 } });
  assert.deepEqual(q.deductions.items.map((d) => [d.id, d.amount]), [['gsis', 2000]]); // only the balance is left
  assert.deepEqual(q.skippedDeductions.map((d) => d.id), ['big']);
  assert.ok(q.netPay >= 5000);

  // Job order: paid for days worked, no GSIS or PERA, tax withheld at the set rates.
  const jo = gov.computeGovPayslip({ employee: { ...emp, salaryGrade: null, payType: 'daily', rate: 600, appointment: 'Job order', rataRepresentation: 0, rataTransportation: 0 }, entries, periodStart: '2026-10-01', periodEnd: '2026-10-31', settings });
  assert.equal(jo.earnings.basePay, 21 * 600);
  assert.equal(jo.deductions.gsis, 0);
  assert.equal(jo.earnings.pera, 0);
  assert.equal(jo.deductions.withholdingTax, lmsCalc.round2(jo.grossPay * 0.05));
});

test('government payroll: SG employees, loans, VL charged on finalize, bonus runs with the P90,000 exemption', async () => {
  const { env, admin, hr, newEmployee } = await hrisSchool();
  assert.equal((await hr.get('/api/hris/settings')).payrollSystem, 'government');
  await assert.rejects(newEmployee(hr, { salaryGrade: 33, step: 3 }), /steps 1 to 2/);
  const emp = await newEmployee(hr, { firstName: 'Gina', lastName: 'Gov', salaryGrade: 18, step: 2, appointment: 'Permanent', hireDate: '2026-01-05', plantillaItem: 'ITEM-1', gsisNo: '123' });
  assert.equal(emp.rate, 54371);
  // A loan, added by payroll (the administrator here); HR may not.
  await assert.rejects(hr.post(`/api/hris/employees/${emp.id}/deductions`, { type: 'GSIS-MPL', monthly: 2000, startDate: '2026-10-01' }), status(403));
  const loan = await admin.post(`/api/hris/employees/${emp.id}/deductions`, { type: 'GSIS-MPL', monthly: 2000, total: 3000, startDate: '2026-10-01', reference: 'MPL-1' });
  assert.equal(loan.balance, 3000);
  // October: on time every day except 48 minutes late once.
  const days = [...lmsCalc.eachDate('2026-10-01', '2026-10-15')].filter((d) => ![0, 6].includes(lmsCalc.dayOfWeek(d)));
  for (const [i, date] of days.entries()) await hr.post('/api/hris/time-entries', { employeeId: emp.id, date, type: 'work', timeIn: i === 2 ? '08:48' : '08:00', timeOut: '17:00' });
  const run = await admin.post('/api/hris/payroll-runs', { periodStart: '2026-10-01', periodEnd: '2026-10-15' });
  assert.equal(run.system, 'government');
  const slip = run.payslips.find((p) => p.employeeId === emp.id);
  assert.equal(slip.earnings.basicPay, 54371 / 2);
  assert.equal(slip.earnings.pera, 1000);
  assert.equal(slip.leave.chargedToLeaveDays, 0.1);
  assert.deepEqual(slip.deductions.items.map((d) => d.amount), [1000]);
  await admin.post(`/api/hris/payroll-runs/${run.id}/finalize`, {});
  // 0.1 day of vacation leave is taken off; the loan balance follows the finalized run.
  const adj = env.db.data.leaveAdjustments.filter((a) => a.employeeId === emp.id);
  assert.deepEqual(adj.map((a) => [a.leaveTypeId, a.days]), [['vl', -0.1]]);
  assert.equal((await admin.get(`/api/hris/employees/${emp.id}/deductions`))[0].balance, 2000);
  await assert.rejects(admin.del(`/api/hris/employees/${emp.id}/deductions/${loan.id}`), /finalized payroll/);
  // Deleting the run gives the leave back and restores the balance.
  await admin.del(`/api/hris/payroll-runs/${run.id}`);
  assert.equal(env.db.data.leaveAdjustments.filter((a) => a.employeeId === emp.id).length, 0);
  assert.equal((await admin.get(`/api/hris/employees/${emp.id}/deductions`))[0].balance, 3000);

  // Mid-year bonus (hired 5 Jan: 4+ months by 15 May), then the year-end bonus and cash gift.
  const myb = await admin.post('/api/hris/payroll-runs', { kind: 'mid-year', year: 2026, payDate: '2026-05-15' });
  const m = myb.payslips.find((p) => p.employeeId === emp.id);
  assert.equal(m.grossPay, 54371);
  assert.equal(m.deductions.withholdingTax, 0);
  await assert.rejects(admin.post('/api/hris/payroll-runs', { kind: 'mid-year', year: 2026, payDate: '2026-05-20' }), /already a mid-year/);
  await admin.post(`/api/hris/payroll-runs/${myb.id}/finalize`, {});
  const yeb = await admin.post('/api/hris/payroll-runs', { kind: 'year-end', year: 2026, payDate: '2026-11-15' });
  const y = yeb.payslips.find((p) => p.employeeId === emp.id);
  assert.deepEqual(y.earnings.items.map((i) => [i.code, i.amount]), [['YEB', 54371], ['CG', 5000]]);
  // 54,371 + 54,371 + 5,000 = 113,742: the 23,742 above P90,000 is taxed.
  assert.equal(y.taxableIncome, 23742);
  assert.ok(y.deductions.withholdingTax > 0);
  // Leave someone out of a bonus run, with the reason.
  const out = await admin.put(`/api/hris/payroll-runs/${yeb.id}/payslips/${emp.id}`, { excluded: true, remarks: 'Rating below Satisfactory' });
  assert.equal(out.payslips.find((p) => p.employeeId === emp.id).grossPay, 0);
});

test('government payroll to Finance: ORS (Box A) → obligated → payroll voucher → paid with its journal entry → remittances', async () => {
  const env = setup({ today: '2026-11-07' });
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await admin.post('/api/admin/demo');
  const as = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: 'demo1234' });
    return c;
  };
  const [payroll, budget, acct, head, cash, hr] = await Promise.all(['payroll.demo', 'budget.demo', 'accountant.demo', 'head.demo', 'cashier.demo', 'hr.demo'].map(as));
  const run = (await payroll.get('/api/hris/payroll-runs')).find((r) => r.kind === 'regular' && r.status === 'finalized' && r.periodEnd.endsWith('-31'));
  const plan = await payroll.get(`/api/hris/payroll-runs/${run.id}/finance`);
  const full = await payroll.get(`/api/hris/payroll-runs/${run.id}`);
  // The entry balances: obligation = gross pay + government shares; net = the payroll's net pay.
  const shares = full.payslips.reduce((a, p) => a + Object.values(p.employerShare).reduce((x, y) => x + y, 0), 0);
  assert.equal(plan.entry.gross, Math.round((full.totals.grossPay + shares) * 100) / 100);
  assert.equal(plan.entry.net, full.totals.netPay);
  assert.ok(plan.entry.lines.some((l) => l.code === '50101010') && plan.entry.lines.some((l) => l.code === '50103010'));
  const ps = plan.allotments.find((a) => a.cls === 'PS');
  const mooe = plan.allotments.find((a) => a.cls === 'MOOE');
  assert.ok(ps, 'the PS allotment is offered');
  // HR may look but not prepare; payroll prepares the request.
  await assert.rejects(hr.post(`/api/hris/payroll-runs/${run.id}/finance/ors`, { allotments: { PS: ps.id, MOOE: mooe?.id } }), status(403));
  await assert.rejects(payroll.post(`/api/hris/payroll-runs/${run.id}/finance/dv`, {}), /obligation request first/);
  let st = await payroll.post(`/api/hris/payroll-runs/${run.id}/finance/ors`, { allotments: { PS: ps.id, MOOE: mooe?.id } });
  assert.equal(st.ors.status, 'draft');
  assert.ok(st.ors.submitted);
  await assert.rejects(payroll.post(`/api/hris/payroll-runs/${run.id}/finance/ors`, { allotments: { PS: ps.id, MOOE: mooe?.id } }), /already has/);
  await assert.rejects(payroll.del(`/api/hris/payroll-runs/${run.id}`), /Cancel that request first/);
  await assert.rejects(payroll.post(`/api/hris/payroll-runs/${run.id}/finance/dv`, {}), /not obligated yet/);
  // Box B in Finance, then the voucher.
  await budget.post(`/api/finance/obligations/${st.ors.id}/obligate`, {});
  st = await payroll.post(`/api/hris/payroll-runs/${run.id}/finance/dv`, {});
  const dv = await acct.get(`/api/finance/dvs/${st.dv.id}`);
  assert.equal(dv.gross, plan.entry.gross);
  assert.equal(dv.net, plan.entry.net);
  assert.ok(dv.entry.some((l) => l.code === '20201020' && l.credit > 0), 'Due to GSIS');
  assert.ok(dv.entry.some((l) => l.code === '20201010' && l.credit > 0), 'Due to BIR');
  await assert.rejects(payroll.post(`/api/hris/payroll-runs/${run.id}/finance/remittances`, {}), /paid first/);
  // Boxes C and D, then the LDDAP-ADA pays it and posts the journal entry.
  await acct.post(`/api/finance/dvs/${dv.id}/certify`, { docsComplete: true });
  await head.post(`/api/finance/dvs/${dv.id}/approve`);
  await cash.post('/api/finance/lddaps', { dvIds: [dv.id] });
  st = await payroll.get(`/api/hris/payroll-runs/${run.id}/finance`);
  assert.equal(st.dv.status, 'paid');
  assert.match(st.dv.jevNo, /^01-/);
  // Remittance vouchers settle what was withheld, one per agency.
  st = await payroll.post(`/api/hris/payroll-runs/${run.id}/finance/remittances`, {});
  assert.deepEqual(st.remittances.map((r) => r.agency).sort(), ['BIR', 'GSIS', 'Pag-IBIG', 'PhilHealth']);
  const gsisDue = plan.entry.deductions.filter((d) => d.code === '20201020').reduce((a, d) => a + d.amount, 0);
  assert.equal(st.remittances.find((r) => r.agency === 'GSIS').amount, Math.round(gsisDue * 100) / 100);
});

test('government payroll QA fixes: exclusion, new hires, daily casuals, job orders, halves, separation, moved campus, private mode', async () => {
  const settings = { ...lmsCalc.DEFAULT_SETTINGS, payFrequency: 'semi-monthly', contributions: { ...lmsCalc.DEFAULT_SETTINGS.contributions, gsis: true } };
  const emp = { id: 'e', employeeNo: 'E', firstName: 'A', lastName: 'B', salaryGrade: 11, step: 3, hireDate: '2020-01-01', status: 'Active', schedule: settings.schedule };
  const work = (from, to, id = 'e', lateFirst = false) => [...lmsCalc.eachDate(from, to)].filter((d) => ![0, 6].includes(lmsCalc.dayOfWeek(d))).map((d, i) => ({ employeeId: id, date: d, type: 'work', timeIn: lateFirst && i === 0 ? '08:41' : '08:00', timeOut: '17:00' }));
  // Left out of a run: nothing paid, no leave charged, no deductions (net 0, not negative).
  const out = gov.computeGovPayslip({ employee: emp, entries: work('2026-10-01', '2026-10-15', 'e', true), periodStart: '2026-10-01', periodEnd: '2026-10-15', settings, vlRemaining: 5, adjustments: { excluded: true, otherDeductions: 250 } });
  assert.deepEqual([out.grossPay, out.netPay, out.leave.chargedToLeaveDays], [0, 0, 0]);
  // The two halves of a month add up to the monthly contribution to the centavo.
  const h1 = gov.computeGovPayslip({ employee: emp, entries: work('2026-10-01', '2026-10-15'), periodStart: '2026-10-01', periodEnd: '2026-10-15', settings });
  const h2 = gov.computeGovPayslip({ employee: emp, entries: work('2026-10-16', '2026-10-31'), periodStart: '2026-10-16', periodEnd: '2026-10-31', settings });
  assert.equal(lmsCalc.round2(h1.deductions.gsis + h2.deductions.gsis), lmsCalc.round2(32109 * 0.09));
  assert.equal(lmsCalc.round2(h1.employerShare.gsis + h2.employerShare.gsis), lmsCalc.round2(32109 * 0.12));
  // A new hire mid-period: PERA and contributions for the part of the period in service.
  const hire = gov.computeGovPayslip({ employee: { ...emp, hireDate: '2026-10-14' }, entries: work('2026-10-14', '2026-10-15'), periodStart: '2026-10-01', periodEnd: '2026-10-15', settings });
  assert.ok(hire.earnings.pera < 1000 && hire.earnings.pera > 0, `PERA ${hire.earnings.pera}`);
  assert.ok(hire.deductions.gsis < h1.deductions.gsis / 2);
  // A casual on a daily wage (not a job order) pays GSIS, PhilHealth and Pag-IBIG and gets PERA.
  const casual = gov.computeGovPayslip({ employee: { ...emp, salaryGrade: null, payType: 'daily', rate: 800, appointment: 'Casual' }, entries: work('2026-10-01', '2026-10-15'), periodStart: '2026-10-01', periodEnd: '2026-10-15', settings });
  assert.equal(casual.deductions.gsis, lmsCalc.round2((800 * 22 * 0.09) / 2));
  assert.equal(casual.earnings.pera, 1000);
  // Job order recorded by employment status only: paid and booked as a job order.
  const jo = gov.computeGovPayslip({ employee: { ...emp, salaryGrade: null, payType: 'daily', rate: 600, employmentStatus: 'Job order' }, entries: work('2026-10-01', '2026-10-15'), periodStart: '2026-10-01', periodEnd: '2026-10-15', settings });
  assert.equal(jo.jobOrder, true);
  const { payrollEntry } = await import('../server/hris-finance.js');
  assert.deepEqual(payrollEntry({ kind: 'regular', payslips: [jo] }).lines.map((l) => [l.code, l.cls]), [['50216010', 'MOOE']]);
  // Separated after the cut-off (31 October) and inactive by the pay date: still gets the year-end bonus.
  const left = gov.computeGovBonus({ employee: { ...emp, status: 'Inactive', separationDate: '2026-11-05' }, kind: 'year-end', year: 2026, payDate: '2026-11-15', settings });
  assert.ok(left.earnings.items.some((i) => i.code === 'YEB'));
  const before = gov.computeGovBonus({ employee: { ...emp, status: 'Inactive', separationDate: '2026-10-15' }, kind: 'year-end', year: 2026, payDate: '2026-11-15', settings });
  assert.equal(before.grossPay, 0);

  // Moved campus after being paid: not paid again at the new campus.
  const { env, admin, hr, other, newEmployee } = await hrisSchool();
  const mover = await newEmployee(hr, { firstName: 'Mo', lastName: 'Ver', salaryGrade: 11, step: 1 });
  const myb = await admin.post('/api/hris/payroll-runs', { kind: 'mid-year', year: 2026, payDate: '2026-05-15' });
  await admin.post(`/api/hris/payroll-runs/${myb.id}/finalize`, {});
  env.db.data.employees.find((e) => e.id === mover.id).campusId = other.id;
  await admin.post('/api/hris/auth/campus', { campusId: other.id });
  await assert.rejects(admin.post('/api/hris/payroll-runs', { kind: 'mid-year', year: 2026, payDate: '2026-05-15' }), /paid it at another campus/);
  await admin.post('/api/hris/auth/campus', { campusId: (await admin.get('/api/admin/campuses'))[0].id });
  // Private payroll: the rate typed in is kept (salary grades are a government thing).
  await admin.put('/api/hris/payroll-config', { ...(await admin.get('/api/hris/settings')), payrollSystem: 'private' });
  const pv = await newEmployee(hr, { firstName: 'Pri', lastName: 'Vate' });
  const priv = await admin.put(`/api/hris/employees/${pv.id}`, { firstName: 'Pri', lastName: 'Vate', hireDate: '2025-01-06', payType: 'monthly', rate: 99999, salaryGrade: 16 });
  assert.equal(priv.rate, 99999);
  assert.equal(priv.salaryGrade, null);
});

test('an install that already ran private payroll stays private after the upgrade', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const { openDb } = await import('../server/db.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-upgrade-'));
  const file = path.join(dir, 'db.json');
  fs.writeFileSync(file, JSON.stringify({ hrSettings: { payFrequency: 'monthly' }, payrollRuns: [{ id: 'r', campusId: 'c', periodStart: '2026-01-01', periodEnd: '2026-01-31', payslips: [], employeeIds: [], status: 'finalized' }] }));
  assert.equal(openDb(file).data.hrSettings.payrollSystem, 'private');
  fs.rmSync(dir, { recursive: true, force: true });
});
