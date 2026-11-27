// Due dates in ATLAS People (HRIS request PL-053): renewals of appointments, probation evaluations,
// step increments and retirements. The date arithmetic (leap years, Feb 29 birthdays, the end of the
// month); one bell alert per occurrence and lead day, across a restart; a rule turned off; mark done,
// snooze and reopen; a renewal done by itself when a new appointment is confirmed; separated and
// inactive employees left out; who may see what; the Settings center; records from before (blank
// stays blank); the demo school.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { createApi } from '../server/api.js';
import { memoryDb, emptyData } from '../server/db.js';
import { ROLES, HRIS_PERMISSION_LABELS } from '../shared/roles.js';
import {
  addMonths, addYears, daysBetween, parseLeadDays, leadsCrossed, occurrencesOf, mergeDueSettings, recordDates, whenText, DEFAULT_DUE_SETTINGS,
} from '../shared/due-dates.js';

const PW = 'password123';
const DAY = 86400000;

async function school() {
  let now = Date.parse('2026-11-03T10:00:00');
  const clockFn = () => new Date(now);
  const env = setup({ clock: clockFn });
  const clock = { add: (days) => (now += days * DAY), fn: clockFn };
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const signIn = async (username, password = PW) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password });
    return c;
  };
  const employee = (extra = {}) => admin.post('/api/hris/employees', { firstName: 'Nora', lastName: 'Staff', gender: 'Female', hireDate: '2020-01-06', payType: 'monthly', rate: 26100, position: 'Clerk', department: 'Registrar', appointment: 'Permanent', employmentStatus: 'Permanent', ...extra });
  const hrEmp = await employee({ firstName: 'Hana', lastName: 'Reyes', position: 'HRMO III', salaryGrade: 18, step: 1, department: 'Human Resources' });
  await admin.post(`/api/hris/employees/${hrEmp.id}/account`, { role: 'hr', username: 'hana', password: PW, mustChangePassword: false });
  const hr = await signIn('hana');
  const data = env.db.data;
  const user = (username) => data.users.find((u) => u.username === username);
  const bell = (username, kind = null) => data.notifications.filter((n) => n.userId === user(username).id && (!kind || n.kind === kind));
  const sweep = () => env.api.dueDates.sweep();
  const list = () => hr.get('/api/hris/due-dates');
  const trail = () => env.api.audit.entries().filter((e) => e.action.startsWith('Due dates: '));
  return { env, clock, admin, signIn, employee, hrEmp, hr, data, user, bell, sweep, list, trail };
}

test('the date arithmetic: months and years keep the day or take the end of a shorter month; Feb 29 birthdays; leap years', () => {
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28', 'the end of the month');
  assert.equal(addMonths('2027-08-31', 6), '2028-02-29', 'a leap year');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2026-11-15', 6), '2027-05-15');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15', 'over the year end');
  assert.equal(addYears('1960-02-29', 65), '2025-02-28', 'born on Feb 29: turns 65 on Feb 28 when that year has no Feb 29');
  assert.equal(addYears('1964-02-29', 60), '2024-02-29', 'and on Feb 29 when it has');
  assert.equal(addYears('2023-02-28', 3), '2026-02-28');
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2, 'a leap day counts');
  assert.equal(daysBetween('2027-02-28', '2027-03-01'), 1);
  assert.equal(daysBetween('2026-11-03', '2026-10-29'), -5);
  assert.deepEqual(parseLeadDays('7, 60 30,30'), [60, 30, 7]);
  assert.equal(parseLeadDays('60, soon'), null);
  assert.equal(parseLeadDays('-1'), null);
  assert.deepEqual(leadsCrossed([60, 30, 7], 20), { crossed: [60, 30], current: 30 });
  assert.deepEqual(leadsCrossed([60, 30, 7], 61), { crossed: [], current: null });
  assert.deepEqual(leadsCrossed([60, 30, 7], -3), { crossed: [60, 30, 7], current: 7 });
  assert.deepEqual([whenText(20), whenText(1), whenText(0), whenText(-5)], ['in 20 days', 'in 1 day', 'today', '5 days ago']);
});

test('each rule: what it counts from, and who is left out', () => {
  const s = mergeDueSettings({});
  assert.deepEqual(s, DEFAULT_DUE_SETTINGS, 'the defaults, every field present');
  const base = { id: 'e1', status: 'Active', hireDate: '2020-01-06', appointment: 'Permanent', employmentStatus: 'Permanent' };
  const of = (extra, opts = {}) => occurrencesOf({ ...base, ...extra }, s, opts);
  const kinds = (r) => Object.fromEntries(r.list.map((o) => [o.kind, o.due]));
  // Renewal: an end date on a contractual appointment.
  assert.deepEqual(kinds(of({ appointment: 'Contractual', employmentStatus: 'Contractual', appointmentEndDate: '2027-01-31' })), { renewal: '2027-01-31' });
  assert.deepEqual(of({ appointment: 'Contractual', employmentStatus: 'Contractual' }).missing.map((m) => m.kind), ['renewal', 'retirement', 'optionalRetirement'], 'no end date, no birth date: missing, never invented');
  assert.deepEqual(kinds(of({ appointmentEndDate: '2027-01-31' })), {}, 'a permanent appointment is never renewed');
  // Probation: 6 months from the original appointment (end of month); a Permanent without the date has none.
  assert.equal(kinds(of({ originalAppointmentDate: '2026-08-31' })).probation, '2027-02-28');
  assert.equal(kinds(of({})).probation, undefined);
  assert.equal(kinds(of({ appointment: '', employmentStatus: 'Probationary', hireDate: '2026-09-01' })).probation, '2027-03-01', 'a private school\'s Probationary employee: from the date hired');
  // From the appointment history: an original permanent appointment, from its assumption when recorded.
  const hist = [{ from: '2026-10-06', nature: 'original', status: 'Permanent', appointmentId: 'a1' }];
  assert.equal(kinds(of({ appointmentHistory: hist })).probation, '2027-04-06');
  assert.equal(kinds(of({ appointmentHistory: hist }, { assumptionOf: (id) => (id === 'a1' ? '2026-10-12' : '') })).probation, '2027-04-12');
  // Step increment: 3 years from the later of the last step increment and the last appointment.
  assert.equal(kinds(of({ salaryGrade: 11, step: 2, lastStepIncrementDate: '2024-02-29' })).step, '2027-02-28');
  assert.equal(kinds(of({ salaryGrade: 11, step: 2, lastStepIncrementDate: '2022-05-01', appointmentHistory: [{ from: '2025-07-01', nature: 'promotion', status: 'Permanent' }] })).step, '2028-07-01', 'a promotion starts the count again');
  assert.equal(kinds(of({ salaryGrade: 11, step: 8, lastStepIncrementDate: '2024-01-01' })).step, undefined, 'the last step: no more');
  assert.equal(kinds(of({ salaryGrade: 11, step: 2, lastStepIncrementDate: '2024-01-01' }, { gov: false })).step, undefined, 'private payroll: no salary grades');
  assert.deepEqual(of({ salaryGrade: 11, step: 2 }).missing.map((m) => m.kind), ['step', 'retirement', 'optionalRetirement']);
  // Retirement at 65, optional at 60.
  const r = kinds(of({ birthDate: '1962-02-28' }));
  assert.deepEqual([r.retirement, r.optionalRetirement], ['2027-02-28', '2022-02-28']);
  assert.equal(kinds(of({ birthDate: '1960-02-29' }, {})).retirement, '2025-02-28');
  assert.equal(occurrencesOf({ ...base, birthDate: '1962-02-28' }, { retirement: { age: 70 } }).list.find((o) => o.kind === 'retirement').due, '2032-02-28', 'the age is a setting');
  // Left out: inactive, separated, job orders and contracts of service.
  for (const extra of [{ status: 'Inactive' }, { separationDate: '2026-10-01' }, { appointment: 'Job order', employmentStatus: 'Job order' }, { appointment: 'Contract of service', employmentStatus: 'Contract of service' }]) {
    assert.deepEqual(of({ birthDate: '1962-02-28', ...extra }).list, [], JSON.stringify(extra));
  }
});

test('the bell: one alert per occurrence and lead day, never again after a restart; the employee only when the rule says so', async () => {
  const s = await school();
  // Ends in 60 days (Nov 3 → Jan 2): the first lead day has come.
  const ren = await s.employee({ firstName: 'Ren', lastName: 'Tal', appointment: 'Contractual', employmentStatus: 'Contractual', appointmentEndDate: '2027-01-02', department: 'ICT Office' });
  await s.admin.post(`/api/hris/employees/${ren.id}/account`, { role: 'staff', username: 'ren', password: PW, mustChangePassword: false });
  s.sweep();
  const first = s.bell('hana', 'due.renewal');
  assert.equal(first.length, 1);
  assert.match(first[0].title, /^Renewal of appointment: Ren Tal's appointment ends in 60 days$/);
  assert.match(first[0].body, /Jan 2, 2027 · Contractual · ICT Office/);
  assert.equal(first[0].link, '/hris/#/due-dates?rule=renewal');
  assert.deepEqual(s.data.dueAlertsSent[`renewal:${ren.id}:2027-01-02`], { hr: [60], employee: [] }, 'what was sent, per recipient group');
  s.sweep();
  s.clock.add(29); // 31 days left
  s.sweep();
  assert.equal(s.bell('hana', 'due.renewal').length, 1, 'once per lead day');
  s.clock.add(1); // 30 days left
  s.sweep();
  assert.equal(s.bell('hana', 'due.renewal').length, 2);
  // A restart (the same data): its own sweep sends nothing again.
  const again = createApi(s.env.db, { clock: s.clock.fn });
  again.dueDates.sweep();
  assert.equal(s.bell('hana', 'due.renewal').length, 2, 'the markers survive a restart');
  assert.equal(s.bell('ren').length, 0, 'the employee is not told by default');
  // HR asks for the employee to be told too, after HR was told of the 30-day lead: the employee gets
  // that lead day's bell once (the save sweeps at once), HR is not told again; then the next lead day.
  const st = await s.hr.get('/api/hris/due-dates/settings');
  await s.hr.put('/api/hris/due-dates/settings', { ...st.rules, renewal: { ...st.rules.renewal, tellEmployee: true } });
  assert.equal(s.bell('hana', 'due.renewal').length, 2, 'HR is not told twice');
  let mine = s.bell('ren', 'due.renewal');
  assert.equal(mine.length, 1, 'the employee turned on later gets the bell of the lead day already reached');
  assert.equal(mine[0].title, 'Your appointment ends on Jan 2, 2027');
  assert.equal(mine[0].link, '/hris/#/me/profile');
  assert.deepEqual(s.data.dueAlertsSent[`renewal:${ren.id}:2027-01-02`], { hr: [60, 30], employee: [60, 30] });
  s.sweep();
  createApi(s.env.db, { clock: s.clock.fn }).dueDates.sweep();
  assert.equal(s.bell('ren', 'due.renewal').length, 1, 'once, across a restart');
  s.clock.add(23); // 7 days left
  s.sweep();
  assert.equal(s.bell('hana', 'due.renewal').length, 3);
  mine = s.bell('ren', 'due.renewal');
  assert.equal(mine.length, 2);
  s.clock.add(10); // overdue: every lead day has been sent
  s.sweep();
  assert.equal(s.bell('hana', 'due.renewal').length, 3);
  // First seen late (20 days left with leads 60, 30, 7): one alert, and the older lead days are never sent late.
  const late = await s.employee({ firstName: 'Lia', lastName: 'Ong', appointment: 'Casual', employmentStatus: 'Casual', appointmentEndDate: '2027-01-25' }); // 20 days from Jan 5 (today now)
  assert.equal(s.env.api.dueDates.sweep(), true);
  const lia = s.bell('hana', 'due.renewal').filter((n) => n.title.includes('Lia Ong'));
  assert.equal(lia.length, 1);
  assert.match(lia[0].title, /in 20 days/);
  assert.deepEqual(s.data.dueAlertsSent[`renewal:${late.id}:2027-01-25`], { hr: [60, 30], employee: [] }, 'Lia has no account: nothing sent to her');
  // A marker from before the groups (a plain list): sent to HR, and to the employee when the rule tells them now.
  s.clock.add(-10);
  s.data.dueAlertsSent[`renewal:${ren.id}:2027-01-02`] = [60, 30];
  s.sweep();
  assert.equal(s.bell('ren', 'due.renewal').length, 3, 'the 7-day lead day only');
  assert.deepEqual(s.data.dueAlertsSent[`renewal:${ren.id}:2027-01-02`], { hr: [60, 30, 7], employee: [60, 30, 7] });
});

test('a rule turned off: no alerts and not on the list; lead days and names are HR\'s; bad values refused; Settings center', async () => {
  const s = await school();
  await s.employee({ firstName: 'Rio', lastName: 'Old', birthDate: '1962-03-01' }); // 65 on 2027-03-01: 118 days
  const st = await s.hr.get('/api/hris/due-dates/settings');
  assert.deepEqual(st.rules.retirement.leadDays, [180]);
  await s.hr.put('/api/hris/due-dates/settings', { ...st.rules, retirement: { ...st.rules.retirement, on: false } });
  assert.equal(s.bell('hana').length, 0, 'off: nothing sent');
  assert.equal((await s.list()).rows.filter((r) => r.kind === 'retirement').length, 0);
  // Back on, renamed, with HR's lead days: sent at once (118 days left is past 120).
  await s.hr.put('/api/hris/due-dates/settings', { ...st.rules, retirement: { ...st.rules.retirement, on: true, name: 'Retirement (65)', leadDays: '120, 30' } });
  const n = s.bell('hana', 'due.retirement');
  assert.equal(n.length, 1);
  assert.match(n[0].title, /^Retirement \(65\): Rio Old turns 65 in 118 days$/);
  assert.deepEqual((await s.hr.get('/api/hris/due-dates/settings')).rules.retirement.leadDays, [120, 30]);
  // Refused: lead days that are not days, an age out of range, a status that is not one; nothing is saved.
  await assert.rejects(s.hr.put('/api/hris/due-dates/settings', { ...st.rules, step: { ...st.rules.step, leadDays: 'soon' } }), /Not saved\. .*lead days are whole days/);
  await assert.rejects(s.hr.put('/api/hris/due-dates/settings', { ...st.rules, retirement: { ...st.rules.retirement, age: 120 } }), /age is a whole number from 50 to 80/);
  await assert.rejects(s.hr.put('/api/hris/due-dates/settings', { ...st.rules, renewal: { ...st.rules.renewal, statuses: ['Forever'] } }), /Forever is not a status/);
  assert.equal((await s.hr.get('/api/hris/due-dates/settings')).rules.retirement.name, 'Retirement (65)');
  // The Settings center lists them under ATLAS People, with the change in its history; restore defaults.
  const cfg = await s.admin.get('/api/admin/config');
  const area = cfg.areas.find((a) => a.id === 'dueDates');
  assert.deepEqual([area.module, area.label, area.screen, area.resettable], ['people', 'Alerts and due dates', '/hris/#/settings?section=due-dates', true]);
  const rows = cfg.settings.filter((x) => x.area === 'dueDates');
  assert.deepEqual(rows.map((x) => x.path), ['renewal', 'probation', 'step', 'retirement', 'optionalRetirement']);
  assert.equal(rows.find((x) => x.path === 'retirement').changed, true);
  assert.equal(rows.find((x) => x.path === 'renewal').changed, false);
  const hist = await s.admin.get('/api/admin/config/history?area=dueDates');
  assert.ok(hist.entries.some((e) => e.by === 'Hana Reyes' && e.changes.some((c) => c.label === 'Due dates: compulsory retirement (on)')));
  await s.admin.post('/api/admin/config/reset', { area: 'dueDates', path: 'retirement' });
  assert.equal((await s.hr.get('/api/hris/due-dates/settings')).rules.retirement.name, 'Compulsory retirement');
  // Only HR settings can change them.
  const eli = await s.employee({ firstName: 'Eli', lastName: 'Cruz' });
  await s.admin.post(`/api/hris/employees/${eli.id}/account`, { role: 'staff', username: 'eli', password: PW, mustChangePassword: false });
  const e = await s.signIn('eli');
  await assert.rejects(e.put('/api/hris/due-dates/settings', st.rules), (err) => err.status === 403);
});

test('mark done, snooze and reopen: off the list and the bell, in the audit log; a step increment date recorded only when asked', async () => {
  const s = await school();
  const arl = await s.employee({ firstName: 'Arlene', lastName: 'Sar', salaryGrade: 11, step: 3, lastStepIncrementDate: '2023-10-29' }); // due 2026-10-29: 5 days overdue
  const pro = await s.employee({ firstName: 'Dina', lastName: 'Pro', originalAppointmentDate: '2026-05-18' }); // probation: 2026-11-18, 15 days
  s.sweep();
  let v = await s.list();
  const step = v.rows.find((r) => r.kind === 'step');
  assert.deepEqual([step.employee.name, step.due, step.daysLeft, step.state, step.ruleName, step.employee.status], ['Sar, Arlene', '2026-10-29', -5, 'open', 'Step increment', 'Permanent']);
  const prob = v.rows.find((r) => r.kind === 'probation');
  assert.deepEqual([prob.due, prob.daysLeft], ['2026-11-18', 15]);
  assert.equal(s.bell('hana', 'due.step').length, 1);
  assert.match(s.bell('hana', 'due.step')[0].title, /Step increment: Arlene Sar, due 5 days ago/);
  // Mark done without recording the date: the record keeps its date.
  await assert.rejects(s.hr.post('/api/hris/due-dates/done', { key: step.key, on: '2026-12-01' }), /cannot be in the future/);
  await s.hr.post('/api/hris/due-dates/done', { key: step.key, on: '2026-11-02', note: 'NOSI issued' });
  assert.equal((await s.admin.get(`/api/hris/employees/${arl.id}`)).lastStepIncrementDate, '2023-10-29');
  v = await s.list();
  const doneRow = v.rows.find((r) => r.key === step.key);
  assert.deepEqual([doneRow.state, doneRow.mark.on, doneRow.mark.note, doneRow.mark.by], ['done', '2026-11-02', 'NOSI issued', 'Hana Reyes']);
  assert.equal(s.data.dueAlertsSent[step.key], undefined, 'its marker is pruned');
  await assert.rejects(s.hr.post('/api/hris/due-dates/done', { key: step.key }), /already marked done/);
  // Reopen, then done with the date recorded: the next one counts from it (the step and pay unchanged).
  await s.hr.post('/api/hris/due-dates/reopen', { key: step.key });
  assert.equal((await s.list()).rows.find((r) => r.key === step.key).state, 'open');
  await s.hr.post('/api/hris/due-dates/done', { key: step.key, on: '2026-11-02', note: 'Granted', recordStep: true });
  const a = await s.admin.get(`/api/hris/employees/${arl.id}`);
  assert.deepEqual([a.lastStepIncrementDate, a.step, a.salaryGrade], ['2026-11-02', 3, 11]);
  assert.ok((await s.list()).rows.every((r) => r.kind !== 'step' || r.employee.id !== arl.id || r.due === '2029-11-02' || r.state === 'done'));
  // The date moved on (the next one, 2029-11-02, is new and open, beyond the list's year). The done
  // mark stays with the old occurrence, across sweeps: Show snoozed and done lists it.
  s.sweep();
  s.sweep();
  let hist = (await s.list()).rows.find((r) => r.key === step.key);
  assert.deepEqual([hist.state, hist.history, hist.canReopen, hist.mark.note, hist.mark.recorded, hist.due], ['done', true, true, 'Granted', true, '2026-10-29']);
  assert.ok(hist.detail, 'what the occurrence was is kept with the mark');
  assert.equal((await s.hr.get('/api/hris/due-dates/summary')).total, 1, 'the history is not counted (the probation is)');
  // Reopen puts the record's earlier date back, so the occurrence is open again.
  const r1 = await s.hr.post('/api/hris/due-dates/reopen', { key: step.key });
  assert.equal(r1.restored, true);
  assert.equal((await s.admin.get(`/api/hris/employees/${arl.id}`)).lastStepIncrementDate, '2023-10-29');
  hist = (await s.list()).rows.find((r) => r.key === step.key);
  assert.deepEqual([hist.state, hist.history], ['open', false]);
  assert.deepEqual(s.trail().at(-1).changes, [{ field: 'Date of last step increment', from: '2026-11-02', to: '2023-10-29' }]);
  // Done again with the date; then someone edits the record's date: Reopen is refused, with why.
  await s.hr.post('/api/hris/due-dates/done', { key: step.key, on: '2026-11-02', note: 'Granted', recordStep: true });
  await s.admin.put(`/api/hris/employees/${arl.id}`, { lastStepIncrementDate: '2026-11-01' });
  s.sweep();
  hist = (await s.list()).rows.find((r) => r.key === step.key);
  assert.deepEqual([hist.state, hist.canReopen], ['done', false]);
  await assert.rejects(s.hr.post('/api/hris/due-dates/reopen', { key: step.key }), (err) => err.status === 409 && /has changed since \(it is 2026-11-01 now\)/.test(err.message));
  // An employee removed: their marks go with them at the next sweep.
  s.data.employees = s.data.employees.filter((e) => e.id !== arl.id);
  s.sweep();
  assert.equal(s.data.dueMarks.filter((m) => m.employeeId === arl.id).length, 0);
  // Snooze the probation 7 days: hidden from the bell's next lead; back after 7 days.
  await assert.rejects(s.hr.post('/api/hris/due-dates/snooze', { key: prob.key, days: 0 }), /1 to 365 days/);
  const out = await s.hr.post('/api/hris/due-dates/snooze', { key: prob.key, days: 7, note: 'Waiting for the rating' });
  assert.equal(out.until, '2026-11-10');
  v = await s.list();
  assert.equal(v.rows.find((r) => r.key === prob.key).state, 'snoozed');
  assert.equal((await s.hr.get('/api/hris/due-dates/summary')).soon, 0, 'snoozed and done are not counted');
  s.clock.add(7);
  s.sweep();
  assert.equal((await s.list()).rows.find((r) => r.key === prob.key).state, 'open', 'it comes back by itself');
  // The audit log.
  assert.deepEqual(s.trail().map((e) => e.action), ['Due dates: marked done', 'Due dates: reopened (it was marked done)', 'Due dates: marked done', 'Due dates: reopened (it was marked done)', 'Due dates: marked done', 'Due dates: snoozed for 7 days']);
  const last = s.trail().find((e) => e.action === 'Due dates: snoozed for 7 days');
  assert.match(last.detail, /Probation evaluation · due 2026-11-18 · Until 2026-11-10 · Waiting for the rating/);
  assert.equal(s.trail()[2].changes[0].field, 'Date of last step increment');
  // A key from nowhere.
  await assert.rejects(s.hr.post('/api/hris/due-dates/done', { key: `step:${pro.id}:2020-01-01` }), (err) => err.status === 404);
});

test('a renewal is done by itself when a new appointment of that person is confirmed; the end date follows the appointment', async () => {
  const s = await school();
  await s.hr.put('/api/hris/appointment-papers/settings', { signatories: { appointingOfficer: { name: 'Dr. Rosa Bautista', title: 'University President' }, hrmo: { name: 'Hana Reyes', title: 'HRMO III' } } });
  const eliEmp = await s.employee({ firstName: 'Eli', lastName: 'Cruz', appointment: 'Contractual', employmentStatus: 'Contractual', salaryGrade: 4, step: 1, appointmentEndDate: '2026-11-30' });
  await s.admin.post(`/api/hris/employees/${eliEmp.id}/account`, { role: 'staff', username: 'eli', password: PW, mustChangePassword: false });
  const key = `renewal:${eliEmp.id}:2026-11-30`;
  assert.equal((await s.list()).rows.find((r) => r.key === key).daysLeft, 27);
  const it = await s.hr.post('/api/hris/plantilla', { itemNo: 'ADA4-010', positionTitle: 'Administrative Aide IV', salaryGrade: 4, office: 'Registrar', fundCluster: '01' });
  const o = await s.hr.post('/api/hris/recruitment/openings', {
    title: 'Administrative Aide IV', plantillaItemId: it.id, salaryGrade: 4, office: 'Registrar', education: 'High school', training: 'None required', experience: 'None required', eligibility: 'None required', vacancies: 1, closingDate: '2026-11-20', audience: 'internal', status: 'open',
  });
  const eli = await s.signIn('eli');
  const app = await eli.post(`/api/hris/jobs/${o.id}/apply`, { note: '' });
  await s.hr.put(`/api/hris/recruitment/applications/${app.id}`, { stage: 'selected', note: '' });
  const vv = await s.hr.get(`/api/hris/recruitment/applications/${app.id}/appointment`);
  assert.equal(vv.draft.endDate, '');
  await assert.rejects(s.hr.post(`/api/hris/recruitment/applications/${app.id}/appointment`, { ...vv.draft, status: 'Permanent', endDate: '2027-06-30' }), /permanent appointment has no end date/);
  await assert.rejects(s.hr.post(`/api/hris/recruitment/applications/${app.id}/appointment`, { ...vv.draft, status: 'Contractual', endDate: vv.draft.effectiveDate }), /must end after its effective date/);
  const appt = await s.hr.post(`/api/hris/recruitment/applications/${app.id}/appointment`, { ...vv.draft, status: 'Contractual', effectiveDate: '2026-12-01', endDate: '2027-05-31' });
  await s.hr.post(`/api/hris/appointments/${appt.id}/issue`, { kinds: ['appointment'] });
  await s.hr.post(`/api/hris/appointments/${appt.id}/confirm`, {});
  const emp = await s.admin.get(`/api/hris/employees/${eliEmp.id}`);
  assert.equal(emp.appointmentEndDate, '2027-05-31', 'the record has the new end date');
  const old = s.data.dueMarks.find((m) => m.key === key);
  assert.deepEqual([old.action, old.auto, old.on, old.by], ['done', true, '2026-12-01', 'Hana Reyes']);
  assert.match(old.note, /New appointment confirmed: Administrative Aide IV/);
  const rows = (await s.list()).rows.filter((r) => r.employee.id === eliEmp.id && r.kind === 'renewal');
  assert.deepEqual(rows.map((r) => [r.due, r.state, r.history]), [['2026-11-30', 'done', true], ['2027-05-31', 'open', false]], 'the old end stays as done (the history); the new appointment\'s end is next, open');
  assert.ok(s.trail().some((e) => e.action === 'Due dates: renewal marked done (a new appointment was confirmed)'));
  // The next sweep keeps the done mark (Show snoozed and done lists it), and it cannot be reopened:
  // the record's end date is the new appointment's.
  s.sweep();
  assert.equal(s.data.dueMarks.filter((m) => m.key === key).length, 1, 'the done mark is kept');
  const hist = (await s.list()).rows.find((r) => r.key === key);
  assert.deepEqual([hist.state, hist.history, hist.canReopen, hist.mark.auto, hist.detail !== ''], ['done', true, false, true, true]);
  await assert.rejects(s.hr.post('/api/hris/due-dates/reopen', { key }), (err) => err.status === 409 && /closed when a new appointment was confirmed; the record now ends on 2027-05-31/.test(err.message));
  assert.equal((await s.hr.get('/api/hris/due-dates/summary')).soon, 0, 'the history is not counted');
});

test('separated or inactive employees are left out; the employee record\'s dates are checked', async () => {
  const s = await school();
  const a = await s.employee({ firstName: 'Ana', lastName: 'Left', appointment: 'Temporary', employmentStatus: 'Temporary', appointmentEndDate: '2026-11-20', birthDate: '1962-01-15' });
  assert.equal((await s.list()).rows.filter((r) => r.employee.id === a.id).length, 2, 'the renewal and the retirement');
  await s.admin.put(`/api/hris/employees/${a.id}`, { separationDate: '2026-11-02' });
  assert.equal((await s.list()).rows.filter((r) => r.employee.id === a.id).length, 0, 'separated');
  await s.admin.put(`/api/hris/employees/${a.id}`, { separationDate: '', status: 'Inactive' });
  assert.equal((await s.list()).rows.filter((r) => r.employee.id === a.id).length, 0, 'inactive');
  s.sweep();
  assert.equal(s.bell('hana').filter((n) => n.title.includes('Ana Left')).length, 0);
  await assert.rejects(s.admin.put(`/api/hris/employees/${a.id}`, { appointmentEndDate: '2026-02-30' }), /Appointment ends on: pick a real date/);
  await assert.rejects(s.admin.put(`/api/hris/employees/${a.id}`, { lastStepIncrementDate: 'soon' }), /Date of last step increment: pick a real date/);
  await assert.rejects(s.admin.put(`/api/hris/employees/${a.id}`, { appointmentEndDate: '2019-01-01' }), /a date after the date hired/);
  const ok = await s.admin.put(`/api/hris/employees/${a.id}`, { appointmentEndDate: '' });
  assert.equal(ok.appointmentEndDate, '');
});

test('who sees what: HR sees the list, a plain employee does not; the employee sees their own date only when the rule tells them', async () => {
  const s = await school();
  assert.ok(ROLES.hr.permissions.includes('hris.due') && HRIS_PERMISSION_LABELS.some(([p]) => p === 'hris.due'));
  assert.ok(!ROLES.staff.permissions.includes('hris.due') && !ROLES.payroll.permissions.includes('hris.due'));
  const nes = await s.employee({ firstName: 'Nestor', lastName: 'Abe', birthDate: '1962-04-02' }); // 65 on 2027-04-02: 150 days
  await s.admin.post(`/api/hris/employees/${nes.id}/account`, { role: 'staff', username: 'nestor', password: PW, mustChangePassword: false });
  const me = await s.signIn('nestor');
  for (const path of ['/api/hris/due-dates', '/api/hris/due-dates/summary', '/api/hris/due-dates/settings']) await assert.rejects(me.get(path), (err) => err.status === 403, path);
  await assert.rejects(me.post('/api/hris/due-dates/done', { key: `retirement:${nes.id}:2027-04-02` }), (err) => err.status === 403);
  const status = await me.get('/api/hris/auth/status');
  assert.ok(!status.permissions.includes('hris.due'));
  assert.ok((await s.hr.get('/api/hris/auth/status')).permissions.includes('hris.due'));
  const row = (await s.list()).rows.find((r) => r.employee.id === nes.id && r.kind === 'retirement');
  assert.deepEqual([row.due, row.daysLeft], ['2027-04-02', 150]);
  // The HR dashboard card.
  const dash = await s.hr.get('/api/hris/dashboard');
  assert.deepEqual(dash.due, { soon: 0, overdue: 0, total: 0 });
  assert.equal((await s.admin.get('/api/hris/dashboard')).due.soon, 0);
  // The employee's own: nothing until HR ticks "the employee" on the rule.
  assert.deepEqual((await me.get('/api/hris/me/due-dates')).items, []);
  const st = await s.hr.get('/api/hris/due-dates/settings');
  await s.hr.put('/api/hris/due-dates/settings', { ...st.rules, retirement: { ...st.rules.retirement, tellEmployee: true } });
  const mine = (await me.get('/api/hris/me/due-dates')).items;
  assert.deepEqual(mine, [{ kind: 'retirement', due: '2027-04-02', daysLeft: 150, text: 'You reach the compulsory retirement age (65) on' }]);
  assert.equal(s.bell('nestor', 'due.retirement').length, 1, 'and on their bell');
  // A rule that never tells the employee (the step increment) cannot be set to.
  await s.hr.put('/api/hris/due-dates/settings', { ...st.rules, step: { ...st.rules.step, tellEmployee: true } });
  assert.equal((await s.hr.get('/api/hris/due-dates/settings')).rules.step.tellEmployee, false);
  // HR at another campus does not see this campus's employees.
  const other = await s.admin.post('/api/admin/campuses', { name: 'North Campus', code: 'NORTH' });
  await s.admin.post('/api/admin/auth/campus', { campusId: other.id });
  const far = await s.employee({ firstName: 'Fay', lastName: 'Far', birthDate: '1962-04-10' });
  await s.admin.post(`/api/hris/employees/${far.id}/account`, { role: 'hr', username: 'fay', password: PW, mustChangePassword: false });
  const fay = await s.signIn('fay');
  const fv = await fay.get('/api/hris/due-dates');
  assert.ok(fv.rows.every((r) => r.employee.campusName === 'North Campus') && fv.rows.some((r) => r.employee.id === far.id));
  await assert.rejects(fay.post('/api/hris/due-dates/snooze', { key: row.key, days: 7 }), (err) => err.status === 404);
});

test('records from before: blank stays blank, nothing is invented; the appointment history is used where it has the date', () => {
  const old = emptyData();
  delete old.dueMarks;
  delete old.dueAlertsSent;
  old.settings = { ...old.settings };
  delete old.settings.dueDates;
  old.employees = [
    { id: 'e1', employeeNo: 'E-1', firstName: 'Old', lastName: 'Record', hireDate: '2010-06-01', status: 'Active', appointment: 'Permanent', employmentStatus: 'Permanent', salaryGrade: 11, step: 3, campusId: 'c1' },
    { id: 'e2', employeeNo: 'E-2', firstName: 'New', lastName: 'Hire', hireDate: '2026-10-06', status: 'Active', appointment: 'Permanent', employmentStatus: 'Permanent', salaryGrade: 9, step: 1, campusId: 'c1', appointmentHistory: [{ id: 'h1', from: '2026-10-06', to: '', nature: 'original', status: 'Permanent', appointmentId: 'a1' }] },
  ];
  old.campuses = [{ id: 'c1', name: 'Main Campus', code: 'MAIN' }];
  const db = memoryDb(old);
  const d = db.data;
  assert.deepEqual([d.dueMarks, d.dueAlertsSent], [[], {}]);
  assert.deepEqual(d.settings.dueDates, DEFAULT_DUE_SETTINGS);
  for (const k of ['appointmentEndDate', 'originalAppointmentDate', 'lastStepIncrementDate']) assert.equal(d.employees[0][k], undefined, `${k} stays blank`);
  const r1 = recordDates(d.employees[0]);
  assert.deepEqual([r1.appointmentEndDate.value, r1.originalAppointmentDate.value, r1.stepBase.value], ['', '', ''], 'the date hired is not taken for a probation or a step');
  const r2 = recordDates(d.employees[1]);
  assert.deepEqual([r2.originalAppointmentDate, r2.stepBase], [{ value: '2026-10-06', from: 'history' }, { value: '2026-10-06', from: 'history' }]);
  assert.equal(d.employees[1].originalAppointmentDate, undefined, 'worked out, not written to the record');
  // A broken marker map from elsewhere is replaced.
  assert.deepEqual(memoryDb({ ...emptyData(), dueAlertsSent: [1, 2] }).data.dueAlertsSent, {});
});

test('the demo school: a renewal in 20 days, a probation evaluation in 15, a step increment 5 days overdue, a retirement in 150; on HR\'s bell', async () => {
  const env = setup({ today: '2026-11-26' });
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await admin.post('/api/admin/demo');
  const hr = env.client();
  await hr.post('/api/hub/login', { username: 'hr.demo', password: 'demo1234' });
  const v = await hr.get('/api/hris/due-dates');
  const pick = (kind, name) => v.rows.find((r) => r.kind === kind && r.employee.name === name);
  assert.equal(pick('renewal', 'Ilagan, Paolo').daysLeft, 20);
  assert.equal(pick('probation', 'Bautista, Dolores').daysLeft, 15);
  assert.equal(pick('step', 'Sarmiento, Arlene').daysLeft, -5);
  assert.equal(pick('retirement', 'Abello, Nestor').daysLeft, 150);
  const hrUser = env.db.data.users.find((u) => u.username === 'hr.demo');
  const bell = env.db.data.notifications.filter((n) => n.userId === hrUser.id && n.kind.startsWith('due.'));
  assert.ok(bell.length >= 4 && bell.every((n) => n.demo), 'demo alerts, removed with the demo');
  assert.ok(v.missing.some((m) => m.kind === 'renewal'), 'a contractual employee without an end date is listed as missing');
  // The dashboard and the Due dates page agree: due in the next 30 days, overdue apart.
  assert.deepEqual((await hr.get('/api/hris/dashboard')).due, { soon: 2, overdue: 1, total: 3 });
  await hr.post('/api/hris/due-dates/done', { key: pick('step', 'Sarmiento, Arlene').key, note: 'Granted', recordStep: true });
  await admin.del('/api/admin/demo');
  assert.equal(env.db.data.notifications.filter((n) => n.kind?.startsWith('due.')).length, 0);
  assert.deepEqual([env.db.data.dueMarks, env.db.data.dueAlertsSent], [[], {}], 'the demo employees\' marks and markers go at once');
});

test('settings: a part left out keeps its value (one rule, or one field of a rule)', async () => {
  const s = await school();
  await s.hr.put('/api/hris/due-dates/settings', { retirement: { tellEmployee: true } });
  const st = (await s.hr.get('/api/hris/due-dates/settings')).rules;
  assert.deepEqual([st.retirement.tellEmployee, st.retirement.on, st.retirement.age, st.retirement.leadDays, st.renewal.statuses], [true, true, 65, [180], DEFAULT_DUE_SETTINGS.renewal.statuses]);
});
