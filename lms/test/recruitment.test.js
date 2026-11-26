// Recruitment in People (HRIS requests PL-003, PL-004): job openings, temporary applicant accounts that
// expire (warning, close, removal after the purge days), internal applications by employees from their
// own account, and HR's simple status, with the bell and the audit log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { ROLES, userCan, HRIS_ROLES } from '../shared/roles.js';
import { DEFAULT_PEOPLE_SETTINGS } from '../shared/recruitment.js';
import { twoFactorRequired } from '../shared/two-factor.js';
import { guideFor } from '../shared/help.js';

const PW = 'password123';
const DAY = 86400000;
const status = (code) => (err) => err.status === code;

// An admin, HR (Hana, at the main campus), an employee with a sign-in (Eli, staff, SG 11) and a
// teacher with no employee record; a clock the test can move.
async function school({ options = {} } = {}) {
  let now = Date.parse('2026-11-03T10:00:00');
  const env = setup({ clock: () => new Date(now), options });
  const clock = { at: () => now, add: (days) => (now += days * DAY), set: (ms) => (now = ms) };
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const main = (await admin.get('/api/admin/campuses'))[0];
  const signIn = async (username, password = PW) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password });
    return c;
  };
  const employee = (extra = {}) => admin.post('/api/hris/employees', {
    firstName: 'Nora', lastName: 'Staff', gender: 'Female', hireDate: '2020-01-06', payType: 'monthly', rate: 26100, position: 'Clerk', department: 'Registrar', ...extra,
  });
  const hrEmp = await employee({ firstName: 'Hana', lastName: 'Reyes', position: 'HR Officer' });
  await admin.post(`/api/hris/employees/${hrEmp.id}/account`, { role: 'hr', username: 'hana', password: PW, mustChangePassword: false });
  const eliEmp = await employee({ firstName: 'Eli', lastName: 'Cruz', position: 'Administrative Aide IV', salaryGrade: 4, step: 2, email: 'eli@example.edu' });
  await admin.post(`/api/hris/employees/${eliEmp.id}/account`, { role: 'staff', username: 'eli', password: PW, mustChangePassword: false });
  await admin.post('/api/admin/users', { role: 'teacher', username: 'tess', name: 'Tess Teacher', email: 'tess@example.edu', password: PW, mustChangePassword: false, campusIds: [main.id] });
  const hr = await signIn('hana');
  const opening = (extra = {}) => hr.post('/api/hris/recruitment/openings', {
    title: 'Instructor I', plantillaItem: 'INST1-001', salaryGrade: 12, office: 'College of Computing', education: "Master's degree", training: 'None required',
    experience: 'None required', eligibility: 'None required', vacancies: 2, closingDate: '2026-11-20', audience: 'all', status: 'open', ...extra,
  });
  const form = (i = '', extra = {}) => ({ name: `Carla Mendiola${i}`, email: `carla${i}@example.com`, username: `carla${i}`, password: 'longenough1', phone: '0917 123 4567', consent: true, ...extra });
  const signUp = async (i = '', extra = {}, ip = '198.51.100.7') => {
    const c = env.client({ ip });
    const out = await c.post('/api/jobs/signup', form(i, extra));
    await c.post('/api/hub/login', { username: out.username, password: form(i, extra).password });
    return Object.assign(c, { signedUp: out });
  };
  const user = (username) => env.db.data.users.find((u) => u.username === username);
  const bell = (username) => env.db.data.notifications.filter((n) => n.userId === user(username)?.id);
  return { env, clock, admin, main, signIn, hr, hrEmp, eliEmp, opening, form, signUp, user, bell, sweep: () => env.api.recruitment.sweep() };
}

test('sign-up: basic information only, validated as admissions are; duplicates refused; an existing account is told to sign in', async () => {
  const s = await school();
  // Each attempt from its own address (one address may send ten an hour: the next test).
  let n = 10;
  const fresh = () => s.env.client({ ip: `198.51.100.${n++}` });
  const visitor = { get: (p) => fresh().get(p), post: (p, b) => fresh().post(p, b) };
  // No opening anyone may apply for: sign-up is closed.
  await assert.rejects(visitor.post('/api/jobs/signup', s.form()), (e) => e.status === 403 && /no job openings/.test(e.message));
  await s.opening({ audience: 'internal', title: 'Administrative Officer II' });
  assert.equal((await visitor.get('/api/jobs/openings')).signUpOpen, false, 'an Internal-only opening is not for outsiders');
  const open = await s.opening();
  const list = await visitor.get('/api/jobs/openings');
  assert.deepEqual(list.openings.map((o) => o.title), ['Instructor I']);
  assert.equal(list.accountDays, 365);
  assert.equal(list.openings[0].monthlySalary > 0, true, 'the monthly salary from the salary grade');
  assert.equal('counts' in list.openings[0], false, 'nobody signed out sees who applied');
  assert.equal((await visitor.get('/api/hub/status')).jobs, 1);

  await assert.rejects(visitor.post('/api/jobs/signup', s.form('', { email: '' })), /Email is required/);
  await assert.rejects(visitor.post('/api/jobs/signup', s.form('', { email: 'not-an-email' })), /does not look right/);
  await assert.rejects(visitor.post('/api/jobs/signup', s.form('', { name: '' })), /Name is required/);
  await assert.rejects(visitor.post('/api/jobs/signup', s.form('', { username: 'a b' })), /Username/);
  await assert.rejects(visitor.post('/api/jobs/signup', s.form('', { password: 'short' })), /at least 8/);
  await assert.rejects(visitor.post('/api/jobs/signup', s.form('', { phone: 'call me' })), /mobile number/);
  await assert.rejects(visitor.post('/api/jobs/signup', s.form('', { consent: false })), /privacy notice/);
  // Fields a sign-up does not take (an account type, a status) never reach the account.
  const out = await visitor.post('/api/jobs/signup', { ...s.form(), role: 'hr', status: 'active', expiresAt: '2099-01-01T00:00:00Z', campusIds: [s.main.id] });
  assert.equal(out.username, 'carla');
  const carla = s.user('carla');
  assert.equal(carla.role, 'applicant');
  assert.equal(carla.status, 'active');
  assert.deepEqual(carla.campusIds, []);
  assert.equal(carla.phone, '0917 123 4567');
  assert.equal(carla.expiresAt, new Date(s.clock.at() + 365 * DAY).toISOString(), 'open for settings.people.applicantAccountDays');
  assert.ok(carla.consentAt);
  assert.ok(s.env.api.audit.entries().some((e) => e.action === 'Signed up as a job applicant' && e.targetId === carla.id));

  // Usernames and emails are unique, whatever their case.
  await assert.rejects(visitor.post('/api/jobs/signup', s.form('2', { username: 'CARLA' })), /already taken/);
  await assert.rejects(visitor.post('/api/jobs/signup', s.form('2', { email: 'Carla@Example.com' })), (e) => e.status === 409 && /already have an applicant account/.test(e.message));
  // Someone who already has an ATLAS account (an employee, a teacher) signs in with it instead.
  await assert.rejects(visitor.post('/api/jobs/signup', s.form('3', { email: 'TESS@example.edu' })), (e) => e.status === 409 && /Sign in with it on the ATLAS home page/.test(e.message));
  assert.equal(s.env.db.data.users.filter((u) => u.role === 'applicant').length, 1);

  // The applicant signs in on the home page and lands in People's jobs area.
  const c = await s.signIn('carla', 'longenough1');
  const st = await c.get('/api/hris/auth/status');
  assert.equal(st.allowed, true);
  assert.deepEqual(st.permissions, []);
  assert.equal(st.employee, null);
  assert.equal(st.applicant.expiresAt, carla.expiresAt);
  assert.equal((await c.get('/api/hris/jobs')).openings[0].id, open.id);
});

test('sign-up counts against the "apply" rate limit of the address', async () => {
  const s = await school();
  await s.opening();
  const here = s.env.client({ ip: '203.0.113.50' });
  for (let i = 0; i < 10; i++) await here.post('/api/jobs/signup', s.form(String(i)));
  await assert.rejects(here.post('/api/jobs/signup', s.form('10')), (e) => e.status === 429);
  await s.env.client({ ip: '203.0.113.51' }).post('/api/jobs/signup', s.form('11')); // another address still can
});

test('an applicant reaches only the jobs area: every other route of every system is refused', async () => {
  const s = await school({ options: { rateLimits: 'off' } });
  await s.opening();
  const c = await s.signUp();
  const refused = [];
  for (const r of s.env.api.routes()) {
    // Open routes answer anyone (and signing out would end the session); "me" routes are the
    // applicant's own account (profile, security, the bell); the jobs area is marked applicants.
    if (r.access === 'public' || r.access === 'me' || r.applicants) continue;
    const path = r.pattern.replace(/:(\w+)/g, 'x');
    const call = { GET: c.get, POST: c.post, PUT: c.put, DELETE: c.del }[r.method];
    if (!call) continue;
    try {
      await call(path, {});
      refused.push(`${r.method} ${r.pattern}: answered`);
    } catch (e) {
      if (![401, 403].includes(e.status)) refused.push(`${r.method} ${r.pattern}: ${e.status} ${e.message}`);
    }
  }
  assert.deepEqual(refused, [], 'every route outside the jobs area refuses a job applicant');
  // The jobs area and their own account work.
  assert.equal((await c.get('/api/hris/jobs')).openings.length, 1);
  assert.deepEqual((await c.get('/api/hris/my-applications')).applications, []);
  assert.equal((await c.get('/api/me/profile')).accountType, 'applicant');
  await c.post('/api/hris/auth/change-password', { currentPassword: 'longenough1', newPassword: 'evenlonger22' });
  // What the home page and the other systems tell them.
  const hub = await c.get('/api/hub/status');
  assert.deepEqual(hub.systems.map((x) => x.id), ['hris']);
  assert.deepEqual(hub.tools, []);
  assert.deepEqual(await c.get('/api/hub/feed'), { news: [], events: [] });
  for (const p of ['/api/finance/auth/status', '/api/docs/auth/status', '/api/academic/auth/status']) assert.equal((await c.get(p)).user, null, p);
  assert.deepEqual((await c.get('/api/tools/auth/status')).tools, []);
  // Help: only the public guide and the applicant's guide.
  assert.deepEqual((await c.get('/api/guides')).guides.map((g) => g.id).sort(), ['applicant', 'getting-started']);
  await assert.rejects(c.get('/api/guides/hr'), status(404));
  assert.equal(guideFor('hris', 'applicant'), 'applicant');
  // An applicant has no permissions, whatever an override or a per-account grant says.
  assert.equal(userCan({ role: 'applicant', access: { add: ['hris.recruitment'] } }, 'hris.recruitment'), false);
  assert.ok(!HRIS_ROLES.includes('applicant'), 'HR never makes applicant accounts for employees');
  assert.equal(twoFactorRequired({ twoFactor: 'staff' }, { role: 'applicant' }), false, 'not an employee');
  assert.equal(twoFactorRequired({ twoFactor: 'all' }, { role: 'applicant' }), true, 'the same 2-step verification policy as everyone');
  await assert.rejects(s.admin.post('/api/admin/users', { role: 'applicant', username: 'made', name: 'Made By Hand', password: PW }), /sign up themselves/);
  await assert.rejects(s.admin.post('/api/system/users', { role: 'applicant', username: 'made', name: 'Made By Hand', password: PW }), /sign up themselves/);
});

test('expiry: set from the setting, warned once, sign-in refused and sessions ended, HR extends, removed after the purge days', async () => {
  const s = await school();
  await s.hr.put('/api/hris/recruitment/settings', { applicantAccountDays: 100, applicantWarnDays: 30, applicantPurgeDays: 30 });
  const job = await s.opening({ closingDate: '2027-12-31' });
  const c = await s.signUp();
  const carla = s.user('carla');
  assert.equal(carla.expiresAt, new Date(s.clock.at() + 100 * DAY).toISOString());
  const applied = await c.post(`/api/hris/jobs/${job.id}/apply`, { note: 'I teach programming.' });
  // 69 days on: nothing yet. 70 days on (30 before): one notice on the bell, only once.
  s.clock.add(69);
  s.sweep();
  assert.equal(s.bell('carla').filter((n) => n.kind === 'applicant.expiring').length, 0);
  s.clock.add(1);
  s.sweep();
  s.sweep();
  const warned = s.bell('carla').filter((n) => n.kind === 'applicant.expiring');
  assert.equal(warned.length, 1);
  assert.match(warned[0].title, /Your applicant account closes on Feb 11, 2027/);
  assert.equal(warned[0].link, '/hris/#/jobs/mine');
  // Applying again does not move the date.
  await c.post(`/api/hris/my-applications/${applied.id}/withdraw`);
  await c.post(`/api/hris/jobs/${job.id}/apply`, { note: 'Again.' });
  assert.equal(s.user('carla').expiresAt, carla.expiresAt);
  // At the end: the session ends, and signing in again is refused with a clear message.
  s.clock.add(30);
  await assert.rejects(c.get('/api/hris/jobs'), status(401));
  await assert.rejects(s.env.client().post('/api/hub/login', { username: 'carla', password: 'longenough1' }), (e) => e.status === 403 && /Your applicant account closed on Feb 11, 2027/.test(e.message));
  s.sweep();
  assert.equal(s.user('carla').status, 'expired');
  assert.ok(s.env.api.audit.entries().some((e) => e.action === 'Applicant account closed: its time ran out' && e.targetId === carla.id));
  // A closed account's email cannot sign up again: HR extends it instead.
  await assert.rejects(s.env.client().post('/api/jobs/signup', s.form('', { username: 'carla2' })), /has closed\. Ask HR to extend it/);
  const accounts = (await s.hr.get('/api/hris/recruitment/applicants')).applicants;
  assert.equal(accounts[0].status, 'closed');
  assert.equal(accounts[0].removeAfter, new Date(Date.parse(carla.expiresAt) + 30 * DAY).toISOString());
  await assert.rejects(s.hr.post(`/api/hris/recruitment/applicants/${carla.id}/extend`, { days: 0 }), /1 to 1095/);
  const ext = await s.hr.post(`/api/hris/recruitment/applicants/${carla.id}/extend`, { days: 60 });
  assert.equal(ext.status, 'open');
  assert.equal(ext.expiresAt, new Date(s.clock.at() + 60 * DAY).toISOString(), 'from today, as the old date had passed');
  assert.ok(s.env.api.audit.entries().some((e) => e.action === 'Extended a job applicant\'s account' && e.actor === 'Hana Reyes' && e.changes[0].field === 'Open until'));
  assert.match(s.bell('carla').at(-1).title, /Your applicant account is open until/);
  const back = await s.signIn('carla', 'longenough1');
  assert.equal((await back.get('/api/hris/my-applications')).applications.length, 1);
  // It closes again; 30 days after, the sweep removes the account and the personal details in its
  // applications. HR's list keeps a "removed applicant" so the counts stay true.
  s.clock.add(60);
  s.sweep();
  s.clock.add(29);
  s.sweep();
  assert.ok(s.user('carla'), 'kept until the purge days have passed');
  s.clock.add(1);
  s.sweep();
  assert.equal(s.user('carla'), undefined);
  assert.equal(s.env.db.data.notifications.filter((n) => n.userId === carla.id).length, 0);
  const detail = await s.hr.get(`/api/hris/recruitment/openings/${job.id}`);
  assert.equal(detail.counts.total, 1);
  assert.deepEqual(detail.applications.map((a) => [a.name, a.email, a.phone, a.note, a.removed]), [['Removed applicant', '', '', '', true]]);
  assert.ok(!JSON.stringify(s.env.db.data.jobApplications).includes('Carla'), 'no personal details left in the applications');
  await assert.rejects(s.hr.put(`/api/hris/recruitment/applications/${detail.applications[0].id}`, { status: 'shortlisted' }), /removed/);

  // 0 = kept until HR removes it.
  await s.hr.put('/api/hris/recruitment/settings', { applicantPurgeDays: 0 });
  const d = await s.signUp('d');
  await d.post(`/api/hris/jobs/${job.id}/apply`, {});
  s.clock.add(500);
  s.sweep();
  assert.equal(s.user('carlad').status, 'expired');
  const dId = s.user('carlad').id;
  assert.equal((await s.hr.get('/api/hris/recruitment/applicants')).applicants[0].removeAfter, null);
  await s.hr.del(`/api/hris/recruitment/applicants/${dId}`);
  assert.equal(s.user('carlad'), undefined);
  assert.ok(s.env.api.audit.entries().some((e) => e.action === 'Removed a job applicant\'s account' && e.actor === 'Hana Reyes'));
  assert.equal((await s.hr.get(`/api/hris/recruitment/openings/${job.id}`)).counts.total, 2);
  // Employees, students and others never expire through this.
  s.clock.add(2000);
  s.sweep();
  assert.equal(s.user('eli').status, 'active');
  assert.equal(s.user('tess').status, 'active');
  await s.signIn('eli');
});

test('internal applications (PL-004): the employee applies with their own account, linked to their record; outsiders never see Internal-only openings', async () => {
  const s = await school();
  const open = await s.opening();
  const internal = await s.opening({ title: 'Administrative Officer II', salaryGrade: 11, audience: 'internal', office: 'Human Resources' });
  const eli = await s.signIn('eli');
  const seen = await eli.get('/api/hris/jobs');
  assert.equal(seen.internal, true);
  assert.equal(seen.applicant, null);
  assert.deepEqual(seen.openings.map((o) => o.title).sort(), ['Administrative Officer II', 'Instructor I']);
  const mine = await eli.post(`/api/hris/jobs/${internal.id}/apply`, { note: 'I would like to be considered.' });
  assert.equal(mine.internal, true);
  const stored = s.env.db.data.jobApplications.find((a) => a.id === mine.id);
  assert.equal(stored.employeeId, s.eliEmp.id);
  assert.equal(s.env.db.data.users.filter((u) => u.role === 'applicant').length, 0, 'no second account');
  const detail = await s.hr.get(`/api/hris/recruitment/openings/${internal.id}`);
  const row = detail.applications[0];
  assert.equal(row.internal, true);
  assert.equal(row.name, 'Eli Cruz');
  assert.deepEqual([row.employee.position, row.employee.salaryGrade, row.employee.step, row.employee.campusName], ['Administrative Aide IV', 4, 2, 'Main Campus']);
  assert.equal(row.note, 'I would like to be considered.');
  assert.equal(detail.counts.internal, 1);
  // HR was told on the bell.
  assert.ok(s.bell('hana').some((n) => n.kind === 'job.applied' && n.title === 'New application for Administrative Officer II'));

  // An outsider sees only the Open-to-all opening, and cannot reach the other one by its address.
  const c = await s.signUp();
  assert.deepEqual((await c.get('/api/hris/jobs')).openings.map((o) => o.id), [open.id]);
  await assert.rejects(c.get(`/api/hris/jobs/${internal.id}`), status(404));
  await assert.rejects(c.post(`/api/hris/jobs/${internal.id}/apply`, {}), status(404));
  const ext = await c.post(`/api/hris/jobs/${open.id}/apply`, { note: 'Hello' });
  assert.equal(ext.internal, false);
  const hrRow = (await s.hr.get(`/api/hris/recruitment/openings/${open.id}`)).applications[0];
  assert.deepEqual([hrRow.name, hrRow.email, hrRow.phone, hrRow.employee], ['Carla Mendiola', 'carla@example.com', '0917 123 4567', null]);
  // Applicants' data never shows to other applicants.
  const other = await s.signUp('2');
  assert.deepEqual((await other.get('/api/hris/my-applications')).applications, []);
  await assert.rejects(other.post(`/api/hris/my-applications/${ext.id}/withdraw`), status(404));
  assert.ok(!JSON.stringify(await other.get(`/api/hris/jobs/${open.id}`)).includes('Carla'));
  await assert.rejects(other.get(`/api/hris/recruitment/openings/${open.id}`), status(403));

  // Without an employee record (or with an inactive one) there is no Job openings in self-service.
  const tess = await s.signIn('tess');
  await assert.rejects(tess.get('/api/hris/jobs'), (e) => e.status === 403 && /active employee record/.test(e.message));
  await s.admin.put(`/api/hris/employees/${s.eliEmp.id}`, { status: 'Inactive' });
  await assert.rejects(eli.get('/api/hris/jobs'), status(403));
});

test('one application per person per opening; withdraw and apply again before the closing date; drafts and closed openings are not shown', async () => {
  const s = await school();
  const job = await s.opening();
  const draft = await s.opening({ title: 'Draft job', status: 'draft' });
  const c = await s.signUp();
  assert.deepEqual((await c.get('/api/hris/jobs')).openings.map((o) => o.title), ['Instructor I']);
  await assert.rejects(c.post(`/api/hris/jobs/${draft.id}/apply`, {}), status(404));
  const a = await c.post(`/api/hris/jobs/${job.id}/apply`, { note: 'First' });
  assert.equal(a.status, 'received');
  await assert.rejects(c.post(`/api/hris/jobs/${job.id}/apply`, { note: 'Twice' }), (e) => e.status === 409 && /already applied/.test(e.message));
  assert.equal((await c.get('/api/hris/jobs')).openings[0].mine.status, 'received');
  const w = await c.post(`/api/hris/my-applications/${a.id}/withdraw`);
  assert.equal(w.status, 'withdrawn');
  assert.equal(w.canApplyAgain, true);
  assert.ok(s.user('carla'), 'withdrawing does not delete the account');
  await assert.rejects(c.post(`/api/hris/my-applications/${a.id}/withdraw`), /already withdrawn/);
  const again = await c.post(`/api/hris/jobs/${job.id}/apply`, { note: 'Second' });
  assert.equal(again.id, a.id, 'the same application, sent again');
  assert.equal(again.status, 'received');
  assert.equal(s.env.db.data.jobApplications.length, 1);
  // After the closing date: not shown, and no more applications (the one sent stays in My applications).
  await c.post(`/api/hris/my-applications/${a.id}/withdraw`);
  s.clock.set(Date.parse('2026-11-21T08:00:00'));
  assert.deepEqual((await c.get('/api/hris/jobs')).openings, []);
  assert.equal((await c.get('/api/hris/my-applications')).applications[0].canApplyAgain, false);
  await assert.rejects(c.post(`/api/hris/jobs/${job.id}/apply`, {}), /no longer takes applications/);
  // HR closes it: an application can no longer be withdrawn.
  s.clock.set(Date.parse('2026-11-10T08:00:00'));
  const b = await c.post(`/api/hris/jobs/${job.id}/apply`, {});
  await s.hr.put(`/api/hris/recruitment/openings/${job.id}`, { status: 'closed' });
  await assert.rejects(c.post(`/api/hris/my-applications/${b.id}/withdraw`), /closed/);
  assert.deepEqual((await c.get('/api/hris/jobs')).openings, []);
  // HR cannot delete an opening that has applications, only close it.
  await assert.rejects(s.hr.del(`/api/hris/recruitment/openings/${job.id}`), /close it instead/);
  await s.hr.del(`/api/hris/recruitment/openings/${draft.id}`);
});

test('HR: openings are checked, applications get a status with a note, on the bell and in the audit log', async () => {
  const s = await school();
  await assert.rejects(s.opening({ title: '' }), /Position title is required/);
  await assert.rejects(s.opening({ salaryGrade: 40 }), /Salary grade must be 1 to 33/);
  await assert.rejects(s.opening({ closingDate: '' }), /Closing date is required/);
  await assert.rejects(s.opening({ vacancies: 0 }), /vacancies must be 1 to 999/);
  await assert.rejects(s.opening({ education: '', training: '', experience: '', eligibility: '' }), /qualification standards/);
  await assert.rejects(s.opening({ closingDate: '2026-10-01' }), /closing date has passed/);
  const job = await s.opening();
  assert.equal(job.monthlySalary > 30000, true);
  assert.equal(job.campusName, 'Main Campus');
  assert.equal(job.counts.total, 0);
  assert.ok(s.env.api.audit.entries().some((e) => e.system === 'people' && e.action === 'Added · recruitment › openings' && e.target === 'Instructor I'));
  const c = await s.signUp();
  const a = await c.post(`/api/hris/jobs/${job.id}/apply`, { note: 'Hello' });
  await assert.rejects(s.hr.put(`/api/hris/recruitment/applications/${a.id}`, { status: 'withdrawn' }), /Pick a status/);
  const changed = await s.hr.put(`/api/hris/recruitment/applications/${a.id}`, { status: 'shortlisted', note: 'Interview on Nov 12, 9:00 at the HR office.' });
  assert.equal(changed.status, 'shortlisted');
  assert.deepEqual(changed.history.map((h) => h.status), ['received', 'shortlisted']);
  // The applicant: on the bell, and in My applications with the date of the change.
  const told = s.bell('carla').find((n) => n.kind === 'job.status');
  assert.equal(told.title, 'Your application for Instructor I: Shortlisted');
  assert.equal(told.body, 'Note from HR: Interview on Nov 12, 9:00 at the HR office.');
  assert.equal(told.link, '/hris/#/jobs/mine');
  const mine = (await c.get('/api/hris/my-applications')).applications[0];
  assert.deepEqual([mine.status, mine.statusNote, mine.updatedAt], ['shortlisted', 'Interview on Nov 12, 9:00 at the HR office.', changed.updatedAt]);
  // The audit log: who, what, from and to.
  const entry = s.env.api.audit.entries().find((e) => e.action === 'Changed a job application\'s status');
  assert.equal(entry.actor, 'Hana Reyes');
  assert.equal(entry.system, 'people');
  assert.deepEqual(entry.changes[0], { field: 'Status', from: 'Received', to: 'Shortlisted' });
  await s.hr.put(`/api/hris/recruitment/applications/${a.id}`, { status: 'selected' });
  await assert.rejects(c.post(`/api/hris/my-applications/${a.id}/withdraw`), /decided/);
  // HR never decides on their own application.
  const internal = await s.opening({ title: 'HR Officer III', audience: 'internal' });
  const own = await s.hr.post(`/api/hris/jobs/${internal.id}/apply`, {});
  await assert.rejects(s.hr.put(`/api/hris/recruitment/applications/${own.id}`, { status: 'shortlisted' }), /own application/);
  // A withdrawn application is the applicant's: HR cannot change it.
  const b = await (await s.signUp('2')).post(`/api/hris/jobs/${job.id}/apply`, {});
  const c2 = await s.signIn('carla2', 'longenough1');
  await c2.post(`/api/hris/my-applications/${b.id}/withdraw`);
  await assert.rejects(s.hr.put(`/api/hris/recruitment/applications/${b.id}`, { status: 'review' }), /withdrew/);
  const detail = await s.hr.get(`/api/hris/recruitment/openings/${job.id}`);
  assert.deepEqual(detail.counts.byStatus.withdrawn, 1);
  assert.deepEqual(detail.counts.active, 1);
  // Staff without the permission are kept out of HR's screens.
  const eli = await s.signIn('eli');
  await assert.rejects(eli.get('/api/hris/recruitment/openings'), status(403));
  await assert.rejects(eli.put(`/api/hris/recruitment/applications/${a.id}`, { status: 'review' }), status(403));
});

test('the hris.recruitment permission: HR managers have it; Roles & permissions can move it; never applicants', async () => {
  const s = await school();
  assert.ok(ROLES.hr.permissions.includes('hris.recruitment'));
  assert.ok(!ROLES.payroll.permissions.includes('hris.recruitment'));
  assert.ok((await s.hr.get('/api/hris/auth/status')).permissions.includes('hris.recruitment'));
  const roles = await s.admin.get('/api/admin/roles');
  const people = roles.groups.find((g) => g.id === 'people');
  assert.ok(people.permissions.some((p) => p.id === 'hris.recruitment'));
  assert.ok(!people.roles.includes('applicant'));
  // Taken from HR managers: their screens close. Given to payroll officers: theirs open.
  const hrPerms = roles.roles.find((r) => r.id === 'hr').permissions.filter((p) => p !== 'hris.recruitment');
  await s.admin.put('/api/admin/roles', { permissions: { hr: hrPerms, payroll: [...ROLES.payroll.permissions, 'hris.recruitment'] } });
  await assert.rejects(s.hr.get('/api/hris/recruitment/openings'), status(403));
  const payEmp = await s.admin.post('/api/hris/employees', { firstName: 'Pia', lastName: 'Pay', gender: 'Female', hireDate: '2020-01-06', payType: 'monthly', rate: 30000 });
  await s.admin.post(`/api/hris/employees/${payEmp.id}/account`, { role: 'payroll', username: 'pia', password: PW, mustChangePassword: false });
  assert.deepEqual(await (await s.signIn('pia')).get('/api/hris/recruitment/openings'), []);
  await assert.rejects(s.admin.put('/api/admin/roles', { permissions: { applicant: ['hris.recruitment'] } }), /cannot be given/);
  await s.admin.put('/api/admin/roles', { overrides: {} });
  assert.ok((await s.hr.get('/api/hris/auth/status')).permissions.includes('hris.recruitment'));
});

test('the settings: defaults, limits, the Settings center and its history', async () => {
  const s = await school();
  assert.deepEqual(DEFAULT_PEOPLE_SETTINGS, { applicantAccountDays: 365, applicantWarnDays: 30, applicantPurgeDays: 30 });
  assert.deepEqual(await s.hr.get('/api/hris/recruitment/settings'), DEFAULT_PEOPLE_SETTINGS);
  await assert.rejects(s.hr.put('/api/hris/recruitment/settings', { applicantAccountDays: 29 }), /Applicant accounts last: 30 to 1095 days/);
  await assert.rejects(s.hr.put('/api/hris/recruitment/settings', { applicantAccountDays: 1096 }), /30 to 1095/);
  await assert.rejects(s.hr.put('/api/hris/recruitment/settings', { applicantAccountDays: 'many' }), /30 to 1095/);
  await assert.rejects(s.hr.put('/api/hris/recruitment/settings', { applicantWarnDays: 0 }), /1 to 90/);
  await assert.rejects(s.hr.put('/api/hris/recruitment/settings', { applicantPurgeDays: 366 }), /0 to 365/);
  await assert.rejects(s.hr.put('/api/hris/recruitment/settings', { applicantAccountDays: 60, applicantWarnDays: 60 }), /fewer days/);
  assert.equal((await s.hr.put('/api/hris/recruitment/settings', { applicantAccountDays: 1095, applicantPurgeDays: 0 })).applicantPurgeDays, 0);
  // Staff without HR settings cannot change them.
  await assert.rejects((await s.signIn('eli')).put('/api/hris/recruitment/settings', { applicantAccountDays: 90 }), status(403));
  // The Settings center: under ATLAS People, with defaults, the change history and restore.
  const config = await s.admin.get('/api/admin/config');
  const area = config.areas.find((a) => a.id === 'recruitment');
  assert.equal(area.module, 'people');
  const rows = config.settings.filter((x) => x.area === 'recruitment');
  assert.deepEqual(rows.map((r) => [r.path, r.value, r.default, r.changed]), [['applicantAccountDays', 1095, 365, true], ['applicantWarnDays', 30, 30, false], ['applicantPurgeDays', 0, 30, true]]);
  const history = await s.admin.get('/api/admin/config/history?area=recruitment');
  assert.equal(history.entries[0].by, 'Hana Reyes');
  await s.admin.post('/api/admin/config/reset', { area: 'recruitment', path: 'applicantAccountDays' });
  assert.equal(s.env.db.data.settings.people.applicantAccountDays, 365);
});

test('demo data: openings (one Internal only), the demo applicant with an application, removed with the demo school', async () => {
  const s = await school();
  await s.admin.post('/api/admin/demo');
  const demo = s.env.db.data.jobOpenings.filter((o) => o.demo);
  assert.equal(demo.length, 3);
  assert.equal(demo.filter((o) => o.audience === 'internal').length, 1);
  const c = s.env.client();
  await c.post('/api/hub/login', { username: 'applicant.demo', password: 'demo1234' });
  const mine = (await c.get('/api/hris/my-applications')).applications;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, 'review');
  assert.ok((await c.get('/api/hris/jobs')).openings.every((o) => o.audience === 'all'));
  assert.ok(s.env.db.data.jobApplications.some((a) => a.internal && a.demo), 'an internal application by a demo employee');
  await s.admin.del('/api/admin/demo');
  assert.equal(s.env.db.data.jobOpenings.length, 0);
  assert.equal(s.env.db.data.jobApplications.length, 0);
  assert.equal(s.user('applicant.demo'), undefined);
});

test('a selected outsider is never removed automatically: their details may become a personnel record', async () => {
  const s = await school();
  await s.hr.put('/api/hris/recruitment/settings', { applicantAccountDays: 30, applicantWarnDays: 7, applicantPurgeDays: 30 });
  const job = await s.opening({ closingDate: '2027-12-31' });
  const carla = await s.signUp();
  await carla.post(`/api/hris/jobs/${job.id}/apply`, {});
  const app = (await s.hr.get(`/api/hris/recruitment/openings/${job.id}`)).applications[0];
  await s.hr.put(`/api/hris/recruitment/applications/${app.id}`, { status: 'selected' });
  s.clock.add(31);
  s.sweep();
  assert.equal(s.user('carla').status, 'expired');
  s.clock.add(60);
  s.sweep();
  assert.ok(s.user('carla'), 'kept until an HR person removes it');
});
