// Work experience in People (HRIS request PL-023, and the work-experience section of the PDS, PL-017):
// entries kept by employees on their own record and by job applicants on their account, validated;
// HR verifies (an entry changed after it is no longer verified); every change in the audit log;
// other people's entries are "not found"; the Work Experience Sheet (newest first); CSV import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { parseCsv } from '../shared/csv.js';
import { cleanEntry, newestFirst, entriesFromCsv, csvTemplate, durationText, lengthText } from '../shared/work-experience.js';
import { memoryDb } from '../server/db.js';
import { addDemo } from '../server/demo.js';

const PW = 'password123';
const DATE = '2026-11-03';
const status = (code) => (err) => err.status === code;

async function school() {
  const env = setup({ today: DATE });
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const signIn = async (username, password = PW) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password });
    return c;
  };
  const employee = (extra = {}) => admin.post('/api/hris/employees', { firstName: 'Nora', lastName: 'Staff', hireDate: '2020-01-06', payType: 'monthly', rate: 26100, position: 'Clerk', ...extra });
  const hrEmp = await employee({ firstName: 'Hana', lastName: 'Reyes', position: 'HRMO III' });
  await admin.post(`/api/hris/employees/${hrEmp.id}/account`, { role: 'hr', username: 'hana', password: PW, mustChangePassword: false });
  const eliEmp = await employee({ firstName: 'Eli', lastName: 'Cruz', position: 'Administrative Aide IV' });
  await admin.post(`/api/hris/employees/${eliEmp.id}/account`, { role: 'staff', username: 'eli', password: PW, mustChangePassword: false });
  const solEmp = await employee({ firstName: 'Sol', lastName: 'Santos' });
  await admin.post(`/api/hris/employees/${solEmp.id}/account`, { role: 'staff', username: 'sol', password: PW, mustChangePassword: false });
  const payEmp = await employee({ firstName: 'Pia', lastName: 'Pay' });
  await admin.post(`/api/hris/employees/${payEmp.id}/account`, { role: 'payroll', username: 'pia', password: PW, mustChangePassword: false });
  const hr = await signIn('hana');
  const opening = (extra = {}) => hr.post('/api/hris/recruitment/openings', {
    title: 'Instructor I', salaryGrade: 12, office: 'College of Computing', education: "Master's degree", training: 'None required',
    experience: 'None required', eligibility: 'None required', vacancies: 1, closingDate: '2026-11-20', audience: 'all', status: 'open', ...extra,
  });
  let n = 20;
  const signUp = async (name) => {
    const username = name.toLowerCase().replace(/\s+/g, '');
    const c = env.client({ ip: `198.51.100.${n++}` });
    await c.post('/api/jobs/signup', { name, email: `${username}@example.com`, username, password: 'longenough1', consent: true });
    await c.post('/api/hub/login', { username, password: 'longenough1' });
    return c;
  };
  const trail = () => env.api.audit.entries().filter((e) => e.action.startsWith('Work experience: '));
  return { env, admin, signIn, hr, hrEmp, eliEmp, solEmp, opening, signUp, trail };
}
const entry = (extra = {}) => ({
  from: '2018-06-04', to: '2021-05-31', position: 'Administrative Aide III', office: 'Records Section', agency: 'Municipality of Example', location: 'Example City',
  supervisor: 'Records Officer II', appointmentStatus: 'Casual', government: true, salaryGrade: 3, step: 1, monthlySalary: 12000,
  duties: 'Kept the records.', accomplishments: ['Digitized the 201 files', 'Trained two aides'], ...extra,
});

test('the rules of an entry: dates (or present), required fields, grades and amounts', () => {
  const ok = cleanEntry(entry(), DATE);
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.entry.accomplishments, ['Digitized the 201 files', 'Trained two aides']);
  const bad = (x, re) => assert.match(cleanEntry(entry(x), DATE).error, re);
  bad({ from: '' }, /From: pick the date/);
  bad({ from: '2021-02-30' }, /From: pick a real date/);
  bad({ from: '2027-01-01' }, /From cannot be in the future/);
  bad({ to: '' }, /To: pick the date the work ended, or tick "Present"/);
  bad({ to: '2017-01-01' }, /To cannot be before From/);
  bad({ to: '2026-12-01' }, /To cannot be in the future/);
  bad({ position: ' ' }, /Position title is required/);
  bad({ agency: '' }, /Agency or organization is required/);
  bad({ salaryGrade: 40 }, /Salary grade: a whole number from 1 to 33/);
  bad({ salaryGrade: '', step: 2 }, /give the salary grade too/);
  bad({ monthlySalary: -5 }, /Monthly salary/);
  bad({ position: 'x'.repeat(201) }, /at most 200 characters/);
  // "Present": no end date; the word in To means the same (a CSV row).
  const now = cleanEntry(entry({ to: 'Present' }), DATE).entry;
  assert.deepEqual([now.present, now.to], [true, '']);
  assert.equal(durationText(now), 'June 4, 2018 – Present');
  assert.equal(lengthText(now, DATE), '8 years 4 months');
  assert.equal(lengthText(cleanEntry(entry(), DATE).entry, DATE), '2 years 11 months');
  // Newest first: the one held now, then by end date; the person's own order breaks ties.
  const list = [{ id: 'a', from: '2010-01-01', to: '2012-01-01', order: 1 }, { id: 'b', from: '2015-01-01', present: true, order: 2 }, { id: 'c', from: '2012-02-01', to: '2014-12-31', order: 3 }];
  assert.deepEqual(newestFirst(list).map((e) => e.id), ['b', 'c', 'a']);
});

test('an employee keeps their own entries: add, change, reorder, remove; others are not found', async () => {
  const s = await school();
  const eli = await s.signIn('eli');
  const sol = await s.signIn('sol');
  assert.deepEqual((await eli.get('/api/hris/me/work-experience')).entries, []);
  const a = await eli.post('/api/hris/me/work-experience', entry());
  const b = await eli.post('/api/hris/me/work-experience', entry({ from: '2021-06-01', to: '', present: true, position: 'Administrative Aide IV', agency: 'This school', accomplishments: [] }));
  await assert.rejects(eli.post('/api/hris/me/work-experience', entry({ to: '2010-01-01' })), /To cannot be before From/);
  let mine = await eli.get('/api/hris/me/work-experience');
  assert.deepEqual(mine.entries.map((e) => e.position), ['Administrative Aide III', 'Administrative Aide IV'], 'in the order added: "Add another entry" goes at the end');
  assert.equal(mine.canEdit, true);
  assert.equal(mine.canVerify, false);
  // Reorder: every entry once.
  await assert.rejects(eli.post('/api/hris/me/work-experience/order', { ids: [a.id] }), /every entry once/);
  mine = await eli.post('/api/hris/me/work-experience/order', { ids: [b.id, a.id] });
  assert.deepEqual(mine.entries.map((e) => e.id), [b.id, a.id]);
  const changed = await eli.put(`/api/hris/me/work-experience/${a.id}`, { ...entry(), duties: 'Kept and indexed the records.' });
  assert.equal(changed.duties, 'Kept and indexed the records.');
  // Somebody else's entry: not found, whatever the route.
  await assert.rejects(sol.put(`/api/hris/me/work-experience/${a.id}`, entry()), status(404));
  await assert.rejects(sol.del(`/api/hris/me/work-experience/${a.id}`), status(404));
  assert.deepEqual((await sol.get('/api/hris/me/work-experience')).entries, []);
  // Without an employee record there is no list of one's own.
  const adminList = s.admin.get('/api/hris/me/work-experience');
  await assert.rejects(adminList, /not linked to an employee record/);
  await eli.del(`/api/hris/me/work-experience/${a.id}`);
  assert.deepEqual((await eli.get('/api/hris/me/work-experience')).entries.map((e) => e.id), [b.id]);
  // Every change is in the audit log, with the values.
  const actions = s.trail().map((e) => e.action);
  assert.deepEqual(actions, ['Work experience: added an entry', 'Work experience: added an entry', 'Work experience: changed the order of the entries', 'Work experience: changed an entry', 'Work experience: removed an entry']);
  const edit = s.trail().find((e) => e.action === 'Work experience: changed an entry');
  assert.deepEqual(edit.changes, [{ field: 'Summary of actual duties', from: 'Kept the records.', to: 'Kept and indexed the records.' }]);
  assert.equal(edit.actor, 'Eli Cruz');
});

test('HR verifies; an edit after verification marks the entry not verified again; nobody verifies their own', async () => {
  const s = await school();
  const eli = await s.signIn('eli');
  const e = await eli.post('/api/hris/me/work-experience', entry());
  const base = `/api/hris/employees/${s.eliEmp.id}/work-experience`;
  const list = await s.hr.get(base);
  assert.deepEqual([list.canEdit, list.canVerify, list.entries.length], [true, true, 1]);
  await assert.rejects(eli.post(`${base}/${e.id}/verify`, {}), status(403), 'staff have no HR route');
  const v = await s.hr.post(`${base}/${e.id}/verify`, {});
  assert.equal(v.verified.by, 'Hana Reyes');
  assert.equal((await eli.get('/api/hris/me/work-experience')).entries[0].verified.by, 'Hana Reyes');
  // Saving the same values keeps it verified; a real change does not.
  assert.ok((await eli.put(`/api/hris/me/work-experience/${e.id}`, entry())).verified);
  const after = await eli.put(`/api/hris/me/work-experience/${e.id}`, entry({ position: 'Administrative Aide IV' }));
  assert.equal(after.verified, null);
  assert.equal(after.unverifiedAfterChange, true);
  const logged = s.trail().find((x) => x.action === 'Work experience: changed a verified entry (no longer verified)');
  assert.ok(logged.changes.some((c) => c.field === 'Verified' && c.to.startsWith('No')));
  // Verify again, then HR takes it back.
  await s.hr.post(`${base}/${e.id}/verify`, { verified: true });
  assert.equal((await s.hr.post(`${base}/${e.id}/verify`, { verified: false })).verified, null);
  assert.ok(s.trail().some((x) => x.action === 'Work experience: marked an entry not verified'));
  // Not one's own record.
  const own = await s.hr.post(`/api/hris/employees/${s.hrEmp.id}/work-experience`, entry());
  await assert.rejects(s.hr.post(`/api/hris/employees/${s.hrEmp.id}/work-experience/${own.id}/verify`, {}), (err) => err.status === 403 && /own record/.test(err.message));
  // Reading needs employees.view; changing needs employees.edit (a payroll officer only reads).
  const pia = await s.signIn('pia');
  assert.deepEqual([(await pia.get(base)).canEdit, (await pia.get(base)).canVerify], [false, false]);
  await assert.rejects(pia.post(`${base}/${e.id}/verify`, {}), status(403));
  await assert.rejects(pia.post(base, entry()), status(403));
  // An employee at another campus is not found from this one.
  await assert.rejects(s.hr.get(`/api/hris/employees/nope/work-experience`), status(404));
});

test('applicants keep theirs until an application is Selected; HR sees and verifies them; removal takes them away', async () => {
  const s = await school();
  const o = await s.opening();
  const carla = await s.signUp('Carla Mendiola');
  const dan = await s.signUp('Dan Ocampo');
  const e = await carla.post('/api/hris/me/work-experience', entry({ government: false, salaryGrade: '', step: '', agency: 'Example Private College' }));
  assert.equal(e.government, false);
  assert.equal(e.salaryGrade, null);
  await assert.rejects(dan.put(`/api/hris/me/work-experience/${e.id}`, entry()), status(404), 'another applicant\'s entry');
  const app = await carla.post(`/api/hris/jobs/${o.id}/apply`, { note: '' });
  const userId = s.env.db.data.users.find((u) => u.username === 'carlamendiola').id;
  // HR: on the applicant profile and from the application.
  const hrList = await s.hr.get(`/api/hris/recruitment/people/${userId}/work-experience`);
  assert.deepEqual([hrList.entries.length, hrList.canEdit, hrList.canVerify, hrList.owner.kind], [1, false, true, 'applicant']);
  const sheet = await s.hr.get(`/api/hris/recruitment/applications/${app.id}/work-experience/sheet`);
  assert.equal(sheet.person.name, 'Carla Mendiola');
  assert.equal(sheet.entries[0].agency, 'Example Private College');
  await s.hr.post(`/api/hris/recruitment/people/${userId}/work-experience/${e.id}/verify`, {});
  assert.ok((await carla.get('/api/hris/me/work-experience')).entries[0].verified);
  // Applicants never reach HR's routes.
  await assert.rejects(carla.get(`/api/hris/recruitment/people/${userId}/work-experience`), status(403));
  // Selected: the entries are now HR's to keep for the appointment.
  await s.hr.put(`/api/hris/recruitment/applications/${app.id}`, { stage: 'selected', note: 'Congratulations.' });
  const locked = await carla.get('/api/hris/me/work-experience');
  assert.equal(locked.canEdit, false);
  assert.match(locked.lockedReason, /selected you/);
  await assert.rejects(carla.post('/api/hris/me/work-experience', entry()), (err) => err.status === 403 && /kept by HR/.test(err.message));
  await assert.rejects(carla.put(`/api/hris/me/work-experience/${e.id}`, entry()), status(403));
  assert.equal((await carla.get('/api/hris/me/work-experience/sheet')).entries.length, 1, 'still printable');
  // Removing an applicant account removes their entries.
  await dan.post('/api/hris/me/work-experience', entry());
  const danId = s.env.db.data.users.find((u) => u.username === 'danocampo').id;
  await s.hr.del(`/api/hris/recruitment/applicants/${danId}`);
  assert.equal(s.env.db.data.workExperience.filter((x) => x.ownerId === danId).length, 0);
});

test('the Work Experience Sheet: the person, newest first, every WES column', async () => {
  const s = await school();
  const eli = await s.signIn('eli');
  await eli.post('/api/hris/me/work-experience', entry({ from: '2012-01-02', to: '2015-03-31', position: 'Clerk I' }));
  await eli.post('/api/hris/me/work-experience', entry({ from: '2021-06-01', present: true, to: '', position: 'Administrative Aide IV' }));
  await eli.post('/api/hris/me/work-experience', entry());
  const mine = await eli.get('/api/hris/me/work-experience/sheet');
  const hr = await s.hr.get(`/api/hris/employees/${s.eliEmp.id}/work-experience/sheet`);
  for (const sheet of [mine, hr]) {
    assert.equal(sheet.person.name, 'Eli Cruz');
    assert.deepEqual(sheet.entries.map((e) => e.position), ['Administrative Aide IV', 'Administrative Aide III', 'Clerk I']);
    const e = sheet.entries[1];
    for (const k of ['from', 'to', 'position', 'office', 'supervisor', 'agency', 'location', 'accomplishments', 'duties']) assert.ok(e[k]?.length, `${k} is on the sheet`);
    assert.equal(sheet.school.name.length > 0, true);
  }
  assert.equal(hr.printedBy, 'Hana Reyes');
  assert.equal(mine.printedBy, 'Eli Cruz');
});

test('CSV import (HR): all rows or none, with the template and the headings people use', async () => {
  const s = await school();
  const base = `/api/hris/employees/${s.eliEmp.id}/work-experience`;
  // The template parses and imports as it is.
  const tpl = entriesFromCsv(parseCsv(csvTemplate()).rows, DATE);
  assert.deepEqual([tpl.errors, tpl.entries.length, tpl.entries[0].accomplishments.length, tpl.entries[0].government], [[], 1, 2, true]);
  const csv = [
    'Start date;Position;Company;Office;Supervisor;Status;Gov\'t service;SG;Step;Salary;Duties;Accomplishments',
    '2010-06-01;Clerk I;Municipality of Example;Treasury;Treasurer;Casual;Y;3;1;"9,500";Received payments.;"Kept the logbooks; Balanced the cash daily"',
    '2013-01-02;Clerk II;Municipality of Example;Treasury;Treasurer;Permanent;yes;5;;;Prepared the reports.;',
  ].join('\n');
  // A row without its end date is refused, and nothing is imported.
  await assert.rejects(s.hr.post(`${base}/import`, { csv }), (err) => /Nothing was imported/.test(err.message) && /Row 2: To: pick the date/.test(err.message));
  assert.equal((await s.hr.get(base)).entries.length, 0);
  const good = csv.replace('Start date', 'From;To').replace('2010-06-01;', '2010-06-01;2012-12-31;').replace('2013-01-02;', '2013-01-02;Present;');
  const r = await s.hr.post(`${base}/import`, { csv: good });
  assert.equal(r.imported, 2);
  assert.deepEqual(r.entries.map((e) => [e.position, e.present, e.monthlySalary, e.salaryGrade, e.step]), [['Clerk I', false, 9500, 3, 1], ['Clerk II', true, null, 5, null]]);
  assert.deepEqual(r.entries[0].accomplishments, ['Kept the logbooks', 'Balanced the cash daily']);
  assert.ok(r.entries.every((e) => !e.verified), 'imported entries wait for verification');
  await assert.rejects(s.hr.post(`${base}/import`, { csv: 'Name,Age\nx,1' }), /missing: From, Position title, Agency or organization/);
  const eli = await s.signIn('eli');
  await assert.rejects(eli.post(`${base}/import`, { csv: good }), status(403));
  assert.ok(s.trail().some((e) => e.action === 'Work experience: imported 2 entries from a CSV file' && e.actor === 'Hana Reyes'));
});

test('demo data: entries for demo employees and the demo applicant, all marked demo', () => {
  const data = memoryDb().data;
  data.users.push({ id: 'admin', role: 'admin', username: 'admin', name: 'Admin', campusIds: [] });
  addDemo(data, DATE);
  const list = data.workExperience;
  assert.ok(list.length >= 5 && list.every((e) => e.demo));
  const applicant = data.users.find((u) => u.username === 'applicant.demo');
  assert.ok(list.some((e) => e.ownerKind === 'applicant' && e.ownerId === applicant.id));
  assert.ok(new Set(list.filter((e) => e.ownerKind === 'employee').map((e) => e.ownerId)).size >= 3);
  for (const e of list) assert.equal(cleanEntry(e, DATE).error, undefined, `${e.position} is a valid entry`);
});
