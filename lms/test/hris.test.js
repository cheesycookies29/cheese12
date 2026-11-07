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

test('payroll and time rules are the ERP\'s, unchanged', { skip: !fs.existsSync(ERP_CALC) && 'the ERP is not next to the LMS' }, async () => {
  const erpCalc = await import(ERP_CALC);
  const settings = { ...lmsCalc.DEFAULT_SETTINGS, workDaysPerYear: 261 };
  const employee = { id: 'e1', employeeNo: 'E1', firstName: 'A', lastName: 'B', payType: 'monthly', rate: 32000, allowance: 2000, hireDate: '2020-01-01', schedule: settings.schedule };
  const entries = [
    { employeeId: 'e1', date: '2026-10-01', type: 'work', timeIn: '08:20', timeOut: '17:00' },
    { employeeId: 'e1', date: '2026-10-02', type: 'work', timeIn: '08:00', timeOut: '19:00', otApproved: true },
    { employeeId: 'e1', date: '2026-10-05', type: 'leave', paid: true },
  ];
  const args = { employee, entries, periodStart: '2026-10-01', periodEnd: '2026-10-15', settings };
  assert.deepEqual(lmsCalc.computePayslip(args), erpCalc.computePayslip(args));
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
