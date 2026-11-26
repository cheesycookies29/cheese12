// The pool of applicants (HRIS request PL-020): only people who opted in themselves (never by default,
// never by HR); entry when an application ends Not selected or Not qualified; HR adding by hand with a
// reason; the time in the pool (applicantPoolMonths) and the applicant account kept open for it; the
// daily sweep; leaving; Invite to apply on the bell; the search; the audit log; and the removal of a
// pooled applicant's data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { addMonths, poolMonthsFor, poolTickText } from '../shared/recruitment-assess.js';

const PW = 'password123';
const DAY = 86400000;
const status = (code) => (err) => err.status === code;

async function school() {
  let now = Date.parse('2026-11-03T10:00:00');
  const env = setup({ clock: () => new Date(now), options: { rateLimits: 'off' } });
  const clock = { at: () => now, add: (days) => (now += days * DAY) };
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
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
  const eliEmp = await employee({ firstName: 'Eli', lastName: 'Cruz', position: 'Administrative Aide IV', salaryGrade: 4, step: 2 });
  await admin.post(`/api/hris/employees/${eliEmp.id}/account`, { role: 'staff', username: 'eli', password: PW, mustChangePassword: false });
  const hr = await signIn('hana');
  const main = env.db.data.campuses[0];
  const opening = (extra = {}) => hr.post('/api/hris/recruitment/openings', {
    title: 'Instructor I', salaryGrade: 12, education: "Master's degree", vacancies: 2, closingDate: '2027-12-20', audience: 'all', status: 'open', categoryId: 'faculty', ...extra,
  });
  let n = 0;
  const signUp = async (name, extra = {}) => {
    const username = `app${++n}`;
    const c = env.client();
    await c.post('/api/jobs/signup', { name, email: `${username}@example.com`, username, password: 'longenough1', consent: true, ...extra });
    await c.post('/api/hub/login', { username, password: 'longenough1' });
    return Object.assign(c, { username });
  };
  const apply = (c, job) => c.post(`/api/hris/jobs/${job.id}/apply`, {});
  const decide = (id, stage, note = '') => hr.put(`/api/hris/recruitment/applications/${id}`, { stage, note });
  const user = (username) => env.db.data.users.find((u) => u.username === username);
  const entry = (username) => (env.db.data.applicantPool || []).find((e) => e.userId === user(username)?.id);
  const bell = (username) => env.db.data.notifications.filter((x) => x.userId === user(username)?.id);
  const audit = (action) => env.api.audit.entries().filter((e) => e.action === action);
  return { env, clock, admin, signIn, hr, main, opening, signUp, apply, decide, user, entry, bell, audit, sweep: () => env.api.recruitment.sweep() };
}

test('opting in: never by default, only by the person (at sign-up or under My applications), and they can leave at any time', async () => {
  const s = await school();
  const job = await s.opening();
  // The sign-up says how long, and the box is not ticked unless they tick it.
  const pub = await s.env.client().get('/api/jobs/openings');
  assert.equal(pub.poolMonths, 12);
  assert.equal(poolTickText(12), "Keep me in the school's pool of applicants for other vacancies for 12 months");
  const no = await s.signUp('Nico Nones');
  assert.equal(s.user(no.username).poolOptIn, undefined, 'not opted in by default');
  assert.deepEqual((await no.get('/api/hris/my-applications')).pool, { optedIn: false, optedInAt: null, months: 12, inPool: false, enteredAt: null, until: null, invites: [] });
  // No opt-in: an application ending Not selected puts nobody in the pool, and HR cannot add them.
  const a = await s.apply(no, job);
  await s.decide(a.id, 'not-selected');
  assert.equal(s.entry(no.username), undefined);
  await assert.rejects(s.hr.post('/api/hris/recruitment/pool', { userId: s.user(no.username).id, reason: 'Good candidate' }), (e) => e.status === 409 && /has not agreed/.test(e.message));
  // HR has no way to tick it for someone: the opt-in route is the person's own.
  await s.hr.put('/api/hris/my-pool', { optIn: true });
  assert.equal(s.user(no.username).poolOptIn, undefined);
  // Ticked at sign-up.
  const yes = await s.signUp('Yna Yes', { pool: true });
  assert.deepEqual(s.user(yes.username).poolOptIn, { at: new Date(s.clock.at()).toISOString(), months: 12 });
  assert.ok(s.audit('Signed up as a job applicant').at(-1).detail.includes('agreed to the pool of applicants for 12 months'));
  // Ticked later, under My applications: having already been Not selected, they enter the pool now.
  const later = await no.put('/api/hris/my-pool', { optIn: true });
  assert.deepEqual([later.optedIn, later.inPool], [true, true]);
  assert.deepEqual(s.audit('Agreed to be kept in the pool of applicants').map((x) => x.actor), ['Hana Reyes', 'Nico Nones'], 'each by the person themselves (Hana for her own account)');
  // Leaving: out of the pool, the agreement withdrawn, audited.
  const left = await no.put('/api/hris/my-pool', { optIn: false });
  assert.deepEqual([left.optedIn, left.inPool], [false, false]);
  assert.equal(s.entry(no.username), undefined);
  assert.equal(s.audit('Withdrew from the pool of applicants').length, 1);
  assert.equal(s.audit('Left the pool of applicants (their own choice)').length, 1);
  await assert.rejects(no.put('/api/hris/my-pool', {}), /optIn/);
});

test('automatic entry on Not selected and Not qualified: what the entry keeps, the bell, and the account kept open', async () => {
  const s = await school();
  await s.hr.put('/api/hris/recruitment/settings', { signupFields: { education: 'optional', campus: 'optional' } });
  const job = await s.opening();
  const lab = await s.opening({ title: 'Laboratory Technician I', categoryId: 'non-teaching' });
  const carla = await s.signUp('Carla Mendiola', { pool: true, education: 'graduate', campus: s.main.id });
  const a = await s.apply(carla, job);
  await s.hr.put(`/api/hris/recruitment/applications/${a.id}/rating`, { scores: { education: { score: 90 }, experience: { score: 80 } } });
  // In progress: not in the pool.
  await s.decide(a.id, 'screening');
  assert.equal(s.entry(carla.username), undefined);
  // Not qualified (the meaning Not selected): in the pool.
  s.clock.add(200);
  await s.decide(a.id, 'not-qualified', 'The position needs a completed master\'s degree.');
  const e = s.entry(carla.username);
  assert.ok(e);
  const entered = new Date(s.clock.at()).toISOString();
  assert.deepEqual([e.how, e.enteredAt, e.until, e.months, e.internal], ['auto', entered, addMonths(entered, 12), 12, false]);
  assert.deepEqual(e.qualifications, { education: 'graduate', educationLabel: 'Graduate studies', campusId: s.main.id, campusName: s.main.name });
  assert.deepEqual(e.openings.map((o) => [o.title, o.categoryId, o.stageLabel]), [['Instructor I', 'faculty', 'Not qualified']]);
  assert.deepEqual(e.bestRatings.map((b) => [b.categoryId, b.categoryLabel, b.total]), [['faculty', 'Faculty', 34.5]]);
  // Signed up 200 days ago, closing after 365: kept open to the end of the 12 months, and told.
  const u = s.user(carla.username);
  assert.equal(u.expiresAt, e.until);
  assert.equal(u.poolExtendedFrom, new Date(Date.parse('2026-11-03T10:00:00') + 365 * DAY).toISOString());
  const notice = s.bell(carla.username).find((x) => x.kind === 'pool.entered');
  assert.match(notice.title, /You are in the pool of applicants until/);
  assert.match(notice.body, /Your applicant account stays open until/);
  assert.equal(s.audit('Applicant entered the pool of applicants').length, 1);
  // Another application ends Not selected while in the pool: the entry is renewed and updated.
  const b = await s.apply(carla, lab);
  s.clock.add(10);
  await s.decide(b.id, 'not-selected');
  const renewed = s.entry(carla.username);
  assert.equal(renewed.id, e.id);
  assert.equal(renewed.enteredAt, entered, 'the date they first entered stays');
  assert.equal(renewed.until, addMonths(new Date(s.clock.at()).toISOString(), 12));
  assert.deepEqual(renewed.openings.map((o) => o.title), ['Instructor I', 'Laboratory Technician I']);
  assert.equal(s.audit('Renewed a place in the pool of applicants').length, 1);
  // Never longer than they agreed to: the school's 12 months is cut to 6 for everyone.
  assert.equal(poolMonthsFor({ months: 12 }, 6), 6);
  assert.equal(poolMonthsFor({ months: 6 }, 24), 6);
  // Undoing the decision that put someone there: they leave again (one decision left: still in).
  await s.hr.put(`/api/hris/recruitment/applications/${b.id}`, { stage: 'received', reason: 'Decided by mistake.' });
  assert.ok(s.entry(carla.username), 'still in: the first decision stands');
  await s.hr.put(`/api/hris/recruitment/applications/${a.id}`, { stage: 'screening', reason: 'Decided by mistake.' });
  assert.equal(s.entry(carla.username), undefined);
  assert.equal(s.audit('Left the pool of applicants: the outcome that put them there was undone').length, 1);
  // Selected for another opening: out of the pool.
  await s.decide(a.id, 'not-selected');
  assert.ok(s.entry(carla.username));
  await s.decide(b.id, 'selected');
  assert.equal(s.entry(carla.username), undefined);
  assert.equal(s.audit('Left the pool of applicants: selected for a position').length, 1);
});

test('the time in the pool: applicantPoolMonths (1 to 36), the daily sweep, leaving, then the usual closing and removal', async () => {
  const s = await school();
  await assert.rejects(s.hr.put('/api/hris/recruitment/settings', { applicantPoolMonths: 0 }), /1 to 36 months/);
  await assert.rejects(s.hr.put('/api/hris/recruitment/settings', { applicantPoolMonths: 37 }), /1 to 36 months/);
  await assert.rejects(s.hr.put('/api/hris/recruitment/settings', { applicantPoolMonths: 2.5 }), /1 to 36 months/);
  await s.hr.put('/api/hris/recruitment/settings', { applicantAccountDays: 30, applicantWarnDays: 7, applicantPurgeDays: 10, applicantPoolMonths: 3 });
  const job = await s.opening();
  const carla = await s.signUp('Carla Mendiola', { pool: true });
  assert.equal(s.user(carla.username).poolOptIn.months, 3);
  const a = await s.apply(carla, job);
  await s.decide(a.id, 'not-selected');
  const until = s.entry(carla.username).until;
  assert.equal(until, addMonths(new Date(s.clock.at()).toISOString(), 3));
  assert.equal(s.user(carla.username).expiresAt, until, 'the 30-day account is kept open for the 3 months');
  // At 31 days the account would have closed: it does not.
  s.clock.add(31);
  s.sweep();
  assert.equal(s.user(carla.username).status, 'active');
  // The usual warning comes before the new date.
  s.clock.add(55);
  s.sweep();
  assert.ok(s.bell(carla.username).some((x) => x.kind === 'applicant.expiring'));
  // At the end of the 3 months: out of the pool, told, and the account closes in the same sweep.
  s.clock.add(Math.ceil((Date.parse(until) - s.clock.at()) / DAY));
  s.sweep();
  assert.equal(s.entry(carla.username), undefined);
  assert.ok(s.bell(carla.username).some((x) => x.kind === 'pool.left' && /has ended/.test(x.title)));
  assert.equal(s.audit('Left the pool of applicants: the time ended').length, 1);
  assert.equal(s.user(carla.username).status, 'expired');
  assert.equal(s.user(carla.username).poolExtendedFrom, undefined);
  // The usual removal, 10 days after closing: account, pool data and personal details gone.
  s.clock.add(11);
  s.sweep();
  assert.equal(s.user(carla.username), undefined);
  const kept = s.env.db.data.jobApplications.find((x) => x.id === a.id);
  assert.deepEqual([kept.removed, kept.userId], [true, null]);
});

test('an employee in the pool: the same opt-in; the months apply, the account never expires', async () => {
  const s = await school();
  await s.hr.put('/api/hris/recruitment/settings', { applicantPoolMonths: 2 });
  const eli = await s.signIn('eli');
  const job = await s.opening({ title: 'Administrative Officer II', audience: 'internal', categoryId: 'non-teaching' });
  const a = await s.apply(eli, job);
  await s.decide(a.id, 'not-selected');
  assert.equal(s.entry('eli'), undefined, 'not opted in: not in the pool');
  const r = await eli.put('/api/hris/my-pool', { optIn: true });
  assert.deepEqual([r.inPool, r.expiresAt], [true, null]);
  const e = s.entry('eli');
  assert.deepEqual([e.internal, e.qualifications.position, e.qualifications.salaryGrade], [true, 'Administrative Aide IV', 4]);
  assert.equal(s.user('eli').expiresAt, undefined, 'an employee account has no closing date');
  // HR may invite them to an internal opening.
  const next = await s.opening({ title: 'Administrative Officer III', audience: 'internal', categoryId: 'non-teaching' });
  await s.hr.post(`/api/hris/recruitment/pool/${e.id}/invite`, { openingId: next.id });
  assert.ok(s.bell('eli').some((x) => x.kind === 'pool.invited'));
  // Two months on, the sweep takes them out; the account stays as it is.
  s.clock.add(62);
  s.sweep();
  assert.equal(s.entry('eli'), undefined);
  assert.equal(s.user('eli').status, 'active');
});

test('HR: add by hand (opted in, with a reason), remove with a reason, invite to apply (a bell notice); each audited', async () => {
  const s = await school();
  const job = await s.opening();
  const internalOnly = await s.opening({ title: 'Administrative Officer II', audience: 'internal', categoryId: 'non-teaching' });
  const draft = await s.opening({ title: 'Registrar III', status: 'draft' });
  const carla = await s.signUp('Carla Mendiola', { pool: true });
  const id = s.user(carla.username).id;
  await assert.rejects(s.hr.post('/api/hris/recruitment/pool', { userId: id }), /Give the reason/);
  const row = await s.hr.post('/api/hris/recruitment/pool', { userId: id, reason: 'Strong applicant for the next vacancy.' });
  assert.deepEqual([row.how, row.addedBy, row.reason], ['hr', 'Hana Reyes', 'Strong applicant for the next vacancy.']);
  await assert.rejects(s.hr.post('/api/hris/recruitment/pool', { userId: id, reason: 'Again' }), /already in the pool/);
  const added = s.audit('Added an applicant to the pool of applicants');
  assert.deepEqual([added.length, added[0].actor, added[0].detail.startsWith('By HR: Strong applicant')], [1, 'Hana Reyes', true]);
  // Invite: to an open opening anyone may apply for; the bell links to it; they apply themselves.
  await assert.rejects(s.hr.post(`/api/hris/recruitment/pool/${row.id}/invite`, { openingId: internalOnly.id }), /for employees only/);
  await assert.rejects(s.hr.post(`/api/hris/recruitment/pool/${row.id}/invite`, { openingId: draft.id }), /does not take applications/);
  const invited = await s.hr.post(`/api/hris/recruitment/pool/${row.id}/invite`, { openingId: job.id, note: 'We would welcome your application.' });
  assert.deepEqual(invited.invites.map((x) => [x.title, x.by]), [['Instructor I', 'Hana Reyes']]);
  const notice = s.bell(carla.username).find((x) => x.kind === 'pool.invited');
  assert.deepEqual([notice.title, notice.body, notice.link, notice.actorId], ['You are invited to apply for Instructor I', 'Note from HR: We would welcome your application.', `/hris/#/jobs/${job.id}`, null]);
  assert.equal(s.audit('Invited someone in the pool of applicants to apply').length, 1);
  await assert.rejects(s.hr.post(`/api/hris/recruitment/pool/${row.id}/invite`, { openingId: job.id }), /already invited/);
  assert.equal(s.env.db.data.jobApplications.length, 0, 'HR never applies for them');
  // The person sees the invite (not any rating) and applies themselves.
  const mine = (await carla.get('/api/hris/my-applications')).pool;
  assert.deepEqual(mine.invites.map((x) => x.title), ['Instructor I']);
  await s.apply(carla, job);
  const other = await s.signUp('Bea Ramos', { pool: true });
  const brow = await s.hr.post('/api/hris/recruitment/pool', { userId: s.user(other.username).id, reason: 'Referred by the college.' });
  await s.apply(other, job);
  await assert.rejects(s.hr.post(`/api/hris/recruitment/pool/${brow.id}/invite`, { openingId: job.id }), /already applied/);
  // Remove, with a reason: audited, and the person told.
  await assert.rejects(s.hr.post(`/api/hris/recruitment/pool/${row.id}/remove`, {}), /Give the reason/);
  await s.hr.post(`/api/hris/recruitment/pool/${row.id}/remove`, { reason: 'Asked by phone to be removed.' });
  assert.equal(s.entry(carla.username), undefined);
  assert.equal(s.audit('Removed an applicant from the pool of applicants')[0].detail.split(' · ')[0], 'Asked by phone to be removed.');
  assert.ok(s.bell(carla.username).some((x) => x.kind === 'pool.left'));
  // Only Recruitment.
  const eli = await s.signIn('eli');
  await assert.rejects(eli.get('/api/hris/recruitment/pool'), status(403));
  await assert.rejects(eli.post(`/api/hris/recruitment/pool/${brow.id}/invite`, { openingId: job.id }), status(403));
  await assert.rejects(other.get('/api/hris/recruitment/pool'), status(403));
});

test('the pool page: search and filters by category, education, campus, rating range and date', async () => {
  const s = await school();
  await s.hr.put('/api/hris/recruitment/settings', { signupFields: { education: 'optional', campus: 'optional' } });
  const second = await s.admin.post('/api/admin/campuses', { name: 'Sipocot Campus', code: 'SIP' });
  const faculty = await s.opening();
  const staff = await s.opening({ title: 'Laboratory Technician I', categoryId: 'non-teaching' });
  const person = async (name, extra, job, total) => {
    const c = await s.signUp(name, { pool: true, ...extra });
    const a = await s.apply(c, job);
    if (total != null) await s.hr.put(`/api/hris/recruitment/applications/${a.id}/rating`, { scores: { education: { score: total * 4 > 100 ? 100 : total * 4 } } });
    await s.decide(a.id, 'not-selected');
    return c;
  };
  await person('Ana Graduate', { education: 'graduate', campus: s.main.id }, faculty, 25); // faculty: education weighs 25% → total 25 × 4 × 0.25 = 25
  s.clock.add(5);
  await person('Ben College', { education: 'college', campus: second.id }, staff, 10); // non-teaching: 15% → 6
  s.clock.add(5);
  await person('Cy Secondary', { education: 'secondary' }, staff, null);
  const q = async (params) => (await s.hr.get(`/api/hris/recruitment/pool?${new URLSearchParams(params)}`)).entries.map((e) => e.name);
  assert.deepEqual(await q({}), ['Cy Secondary', 'Ben College', 'Ana Graduate'], 'newest first');
  assert.deepEqual(await q({ q: 'ben' }), ['Ben College']);
  assert.deepEqual(await q({ q: 'laboratory' }), ['Cy Secondary', 'Ben College'], 'by an opening applied to');
  assert.deepEqual(await q({ category: 'faculty' }), ['Ana Graduate']);
  assert.deepEqual(await q({ category: 'non-teaching' }), ['Cy Secondary', 'Ben College']);
  assert.deepEqual(await q({ education: 'college' }), ['Ben College', 'Ana Graduate'], 'at least college');
  assert.deepEqual(await q({ campus: second.id }), ['Ben College']);
  assert.deepEqual(await q({ min: 20 }), ['Ana Graduate']);
  assert.deepEqual(await q({ min: 0, max: 10 }), ['Ben College']);
  assert.deepEqual(await q({ category: 'non-teaching', min: 5 }), ['Ben College']);
  assert.deepEqual(await q({ from: '2026-11-07' }), ['Cy Secondary', 'Ben College']);
  assert.deepEqual(await q({ to: '2026-11-03' }), ['Ana Graduate']);
  const all = await s.hr.get('/api/hris/recruitment/pool');
  assert.equal(all.total, 3);
  assert.deepEqual(all.categories.map((c) => c.id), ['faculty', 'non-teaching']);
  assert.deepEqual(all.openings.map((o) => o.title).sort(), ['Instructor I', 'Laboratory Technician I']);
});

test('removing a pooled applicant: the pool entry goes, ratings keep their scores without comments, the application stays anonymous', async () => {
  const s = await school();
  const job = await s.opening();
  const carla = await s.signUp('Carla Mendiola', { pool: true });
  const a = await s.apply(carla, job);
  await s.hr.put(`/api/hris/recruitment/applications/${a.id}/rating`, { scores: { education: { score: 90, comment: 'Carla has a master\'s from the state university.' } } });
  await s.decide(a.id, 'not-selected', 'Thank you, Carla.');
  assert.ok(s.entry(carla.username));
  const id = s.user(carla.username).id;
  await s.hr.del(`/api/hris/recruitment/applicants/${id}`);
  assert.equal((s.env.db.data.applicantPool || []).length, 0);
  const kept = s.env.db.data.jobApplications.find((x) => x.id === a.id);
  assert.deepEqual([kept.removed, kept.userId, kept.rating.total, kept.rating.scores.education], [true, null, 22.5, { score: 90 }]);
  assert.doesNotMatch(JSON.stringify(kept), /Carla/);
  assert.equal(s.audit('Left the pool of applicants: the account was removed').length, 1);
  // The comparative list keeps the anonymous rating, so the ranking stays true.
  const cmp = await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`);
  assert.deepEqual(cmp.rows.map((r) => [r.name, r.total, r.userId]), [['Removed applicant', 22.5, null]]);
  await assert.rejects(s.hr.get(`/api/hris/recruitment/profiles/${id}`), status(404));
});

test('demo data: rated applications on Instructor I and two people in the pool, all marked demo and removed with the demo school', async () => {
  const s = await school();
  await s.admin.post('/api/admin/demo');
  const d = s.env.db.data;
  const instructor = d.jobOpenings.find((o) => o.demo && o.title === 'Instructor I');
  const rated = d.jobApplications.filter((a) => a.openingId === instructor.id && a.rating);
  assert.equal(rated.length, 3);
  assert.ok(rated.every((a) => a.demo));
  assert.equal(instructor.assessment.templateId, 'faculty-example');
  assert.equal(d.applicantPool.length, 2);
  assert.ok(d.applicantPool.every((e) => e.demo && d.users.find((u) => u.id === e.userId)?.demo && d.users.find((u) => u.id === e.userId)?.poolOptIn));
  const hr = await s.signIn('hr.demo', 'demo1234');
  const pool = await hr.get('/api/hris/recruitment/pool');
  assert.deepEqual(pool.entries.map((e) => e.name).sort(), ['Bianca Yap', 'Liza Manalastas']);
  const cmp = await hr.get(`/api/hris/recruitment/openings/${instructor.id}/comparative`);
  assert.deepEqual(cmp.rows.map((r) => r.name), ['Diego Lumbres', 'Teresa Malabanan', 'Carla Mendiola']);
  await s.admin.del('/api/admin/demo');
  assert.equal(d.applicantPool?.length || s.env.db.data.applicantPool.length, 0);
});
