// Rating applicants (HRIS requests PL-018, part of PL-021, PL-066) and the applicant profile (PL-019):
// assessment templates per position category whose weights total exactly 100, totals that never
// exceed 100, the template frozen on an opening by its first rating, ranking, the comparative list,
// what the applicant never sees, and the printable profile with its options and access.
// The pool of applicants: test/recruitment-pool.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import {
  DEFAULT_TEMPLATES, DEFAULT_CATEGORIES, weightTotal, weightProblem, weightedTotal, ranksOf, mergeAssessment,
} from '../shared/recruitment-assess.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;

// An admin, HR (Hana) and a second HR person (Hugo), an employee (Eli, staff) and job applicants.
async function school() {
  let now = Date.parse('2026-11-03T10:00:00');
  const env = setup({ clock: () => new Date(now), options: { rateLimits: 'off' } });
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
  const hugoEmp = await employee({ firstName: 'Hugo', lastName: 'Santos', position: 'HR Assistant' });
  await admin.post(`/api/hris/employees/${hugoEmp.id}/account`, { role: 'hr', username: 'hugo', password: PW, mustChangePassword: false });
  const eliEmp = await employee({ firstName: 'Eli', lastName: 'Cruz', position: 'Administrative Aide IV', salaryGrade: 4, step: 2, appointment: 'Permanent' });
  await admin.post(`/api/hris/employees/${eliEmp.id}/account`, { role: 'staff', username: 'eli', password: PW, mustChangePassword: false });
  const hr = await signIn('hana');
  const opening = (extra = {}) => hr.post('/api/hris/recruitment/openings', {
    title: 'Instructor I', salaryGrade: 12, education: "Master's degree", vacancies: 2, closingDate: '2026-12-20', audience: 'all', status: 'open', categoryId: 'faculty', ...extra,
  });
  let n = 0;
  const signUp = async (name, extra = {}) => {
    const username = `app${++n}`;
    const c = env.client();
    await c.post('/api/jobs/signup', { name, email: `${username}@example.com`, username, password: 'longenough1', consent: true, ...extra });
    await c.post('/api/hub/login', { username, password: 'longenough1' });
    return Object.assign(c, { username });
  };
  const apply = async (c, job, note = '') => c.post(`/api/hris/jobs/${job.id}/apply`, { note });
  const rate = (id, scores, who = hr) => who.put(`/api/hris/recruitment/applications/${id}/rating`, { scores });
  const all = (criteria, score) => Object.fromEntries(criteria.map((c) => [c.id, { score }]));
  const stored = (id) => env.db.data.jobApplications.find((a) => a.id === id);
  const user = (username) => env.db.data.users.find((u) => u.username === username);
  return { env, admin, signIn, hr, hrEmp, eliEmp, opening, signUp, apply, rate, all, stored, user, clock: { add: (ms) => (now += ms) } };
}
const FACULTY = DEFAULT_TEMPLATES.find((t) => t.id === 'faculty-example');
const NON_TEACHING = DEFAULT_TEMPLATES.find((t) => t.id === 'non-teaching-example');

// ----- Templates: the weights total exactly 100, and a total never exceeds 100 -----
test('the default templates: Faculty and Non-teaching examples, EETE criteria plus their own, weights totalling 100', () => {
  assert.deepEqual(DEFAULT_CATEGORIES.map((c) => [c.id, c.label, c.templateId]), [['faculty', 'Faculty', 'faculty-example'], ['non-teaching', 'Non-teaching', 'non-teaching-example']]);
  assert.deepEqual(NON_TEACHING.criteria.map((c) => c.label), ['Education', 'Experience', 'Training', 'Eligibility', 'Competency examination', 'Interview', 'Work sample']);
  assert.deepEqual(FACULTY.criteria.map((c) => c.label), ['Education', 'Experience', 'Training', 'Eligibility', 'Teaching demonstration', 'Interview']);
  for (const t of DEFAULT_TEMPLATES) {
    assert.equal(t.example, true, `${t.name} is marked as an example`);
    assert.match(t.name, /\(example\)$/);
    assert.equal(weightTotal(t.criteria), 100);
    assert.equal(weightProblem(t), '');
    assert.ok(t.criteria.every((c) => c.description), 'every criterion says what it rates');
  }
  assert.deepEqual(mergeAssessment().templates, DEFAULT_TEMPLATES);
});

test('templates: weights must total exactly 100 (PL-066); anything else is refused, with the total', async () => {
  const s = await school();
  const v = await s.hr.get('/api/hris/recruitment/assessment');
  assert.equal(v.templates.length, 3); // Faculty, Non-teaching and Promotion (non-teaching): examples
  const put = (templates, extra = {}) => s.hr.put('/api/hris/recruitment/assessment', { categories: v.categories, templates, print: v.print, ...extra });
  const bump = (by) => v.templates.map((t) => (t.id === 'non-teaching-example' ? { ...t, criteria: t.criteria.map((c, i) => (i === 0 ? { ...c, weight: c.weight + by } : c)) } : t));
  await assert.rejects(put(bump(1)), /Non-teaching \(example\): the weights total 101%\. They must total exactly 100%/);
  await assert.rejects(put(bump(-1)), /weights total 99%/);
  await assert.rejects(put(bump(0.001)), /at most two decimals/);
  await assert.rejects(put(bump(-15)), /must be more than 0/);
  await assert.rejects(put([...v.templates, { name: 'Empty', criteria: [] }]), /add at least one criterion/);
  await assert.rejects(put([...v.templates, { name: 'Twice', criteria: [{ label: 'Interview', weight: 50 }, { label: 'interview', weight: 50 }] }]), /two criteria are called/);
  await assert.rejects(put([...v.templates, { name: 'Faculty (example)', criteria: [{ label: 'A', weight: 100 }] }]), /Two assessment templates are called/);
  // Two decimals add up exactly.
  const thirds = await put([...v.templates, { name: 'Thirds', categoryId: 'faculty', criteria: [{ label: 'A', weight: 33.33 }, { label: 'B', weight: 33.33 }, { label: 'C', weight: 33.34 }] }]);
  const t = thirds.templates.find((x) => x.name === 'Thirds');
  assert.deepEqual([t.version, t.criteria.map((c) => c.id), t.example], [1, ['a', 'b', 'c'], undefined]);
  // Only HR settings may change them; anyone in Recruitment may read them.
  await assert.rejects((await s.signIn('eli')).put('/api/hris/recruitment/assessment', { templates: v.templates }), status(403));
  await assert.rejects((await s.signIn('eli')).get('/api/hris/recruitment/assessment'), status(403));
  // The Settings center lists them under ATLAS People, with a change history and restore.
  const config = await s.admin.get('/api/admin/config');
  assert.equal(config.areas.find((a) => a.id === 'assessment').module, 'people');
  assert.deepEqual(config.settings.filter((x) => x.area === 'assessment').map((x) => [x.path, x.changed]), [['categories', false], ['templates', true], ['print', false], ['board', false]]);
  await s.admin.post('/api/admin/config/reset', { area: 'assessment', path: 'templates' });
  assert.equal(s.env.db.data.settings.assessment.templates.length, 3);
});

test('a weighted total is Σ score × weight / 100 and never exceeds 100; scores outside 0 to 100 are refused', async () => {
  // Every score 100 gives exactly 100; any scores from 0 to 100 never give more.
  assert.equal(weightedTotal(NON_TEACHING.criteria, Object.fromEntries(NON_TEACHING.criteria.map((c) => [c.id, { score: 100 }]))).total, 100);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 500; i++) {
    const scores = Object.fromEntries(FACULTY.criteria.map((c) => [c.id, { score: Math.round(rand() * 10000) / 100 }]));
    const { total } = weightedTotal(FACULTY.criteria, scores);
    assert.ok(total >= 0 && total <= 100, `total ${total}`);
  }
  const r = weightedTotal(FACULTY.criteria, { education: { score: 80 }, 'teaching-demo': { score: 90 } });
  assert.deepEqual([r.total, r.points, r.complete], [42.5, { education: 20, 'teaching-demo': 22.5 }, false]);
  // Through the API.
  const s = await school();
  const job = await s.opening();
  const a = await s.apply(await s.signUp('Carla Mendiola'), job);
  await assert.rejects(s.rate(a.id, { education: { score: 101 } }), /Education: give a score from 0 to 100/);
  await assert.rejects(s.rate(a.id, { education: { score: -1 } }), /from 0 to 100/);
  await assert.rejects(s.rate(a.id, { education: { score: 'a lot' } }), /from 0 to 100/);
  await assert.rejects(s.rate(a.id, {}), /at least one criterion/);
  const full = await s.rate(a.id, s.all(FACULTY.criteria, 100));
  assert.deepEqual([full.rating.total, full.rating.complete], [100, true]);
});

// ----- Openings: category and template; the template freezes on the first rating -----
test('an opening gets its template from its category; the first rating freezes that version on it', async () => {
  const s = await school();
  const job = await s.opening();
  assert.deepEqual([job.assessment.categoryLabel, job.assessment.templateId, job.assessment.frozen], ['Faculty', 'faculty-example', false]);
  const other = await s.opening({ title: 'Administrative Aide VI', categoryId: 'non-teaching' });
  assert.equal(other.assessment.templateId, 'non-teaching-example');
  // A category change before any rating brings that category's default; another template can be picked.
  const moved = await s.hr.put(`/api/hris/recruitment/openings/${other.id}`, { categoryId: 'faculty' });
  assert.equal(moved.assessment.templateId, 'faculty-example');
  const picked = await s.hr.put(`/api/hris/recruitment/openings/${other.id}`, { categoryId: 'non-teaching', templateId: 'faculty-example' });
  assert.deepEqual([picked.assessment.categoryId, picked.assessment.templateId], ['non-teaching', 'faculty-example']);
  await assert.rejects(s.hr.put(`/api/hris/recruitment/openings/${other.id}`, { categoryId: 'nope' }), /Pick a position category/);
  // No template: rating is refused until one is chosen.
  const bare = await s.opening({ title: 'Driver', categoryId: '' });
  assert.equal(bare.assessment.templateName, '');
  const d = await s.apply(await s.signUp('Dan Driver'), bare);
  await assert.rejects(s.rate(d.id, { education: { score: 50 } }), /Choose a position category and an assessment template/);

  // The first rating freezes version 1 on the opening.
  const a = await s.apply(await s.signUp('Carla Mendiola'), job);
  const b = await s.apply(await s.signUp('Bea Ramos'), job);
  await s.rate(a.id, s.all(FACULTY.criteria, 80));
  const frozen = s.env.db.data.jobOpenings.find((o) => o.id === job.id).assessment;
  assert.deepEqual([frozen.templateId, frozen.version, frozen.frozenBy, frozen.criteria.length], ['faculty-example', 1, 'Hana Reyes', 6]);
  assert.ok(s.env.api.audit.entries().some((e) => e.action === 'Fixed the assessment template of a job opening (first rating)' && e.targetId === job.id));
  // HR edits the template afterwards: its version goes up, the opening keeps version 1.
  const v = await s.hr.get('/api/hris/recruitment/assessment');
  const edited = v.templates.map((t) => (t.id === 'faculty-example' ? { ...t, criteria: [{ id: 'interview', label: 'Interview', weight: 60 }, { id: 'demo', label: 'Demonstration', weight: 40 }] } : t));
  const saved = await s.hr.put('/api/hris/recruitment/assessment', { categories: v.categories, templates: edited, print: v.print });
  const tpl = saved.templates.find((t) => t.id === 'faculty-example');
  assert.deepEqual([tpl.version, tpl.example, tpl.fixedOpenings], [2, undefined, 1], 'changed criteria: a new version, and no longer an example');
  const rb = await s.rate(b.id, s.all(FACULTY.criteria, 70));
  assert.deepEqual([rb.template.version, rb.template.criteria.length, rb.rating.total], [1, 6, 70], 'later ratings use the frozen version');
  assert.equal(s.stored(a.id).rating.total, 80, 'a past rating never changes');
  // Once rated, the category and template cannot change.
  await assert.rejects(s.hr.put(`/api/hris/recruitment/openings/${job.id}`, { templateId: 'non-teaching-example' }), /have been rated, so its position category and assessment template are fixed/);
  await assert.rejects(s.hr.put(`/api/hris/recruitment/openings/${job.id}`, { categoryId: 'non-teaching' }), /fixed/);
  assert.equal((await s.hr.put(`/api/hris/recruitment/openings/${job.id}`, { title: 'Instructor I (two items)', categoryId: 'faculty', templateId: 'faculty-example' })).title, 'Instructor I (two items)');
  // A new opening in Faculty now starts with version 2.
  const next = await s.opening({ title: 'Instructor II' });
  assert.equal(next.assessment.templateVersion, 2);
  // A template that an unrated opening follows cannot be removed; one only frozen copies use can.
  const v2 = await s.hr.get('/api/hris/recruitment/assessment');
  await assert.rejects(s.hr.put('/api/hris/recruitment/assessment', { ...v2, templates: v2.templates.filter((t) => t.id !== 'faculty-example') }), /assessment template of 2 job openings not yet rated/);
  await assert.rejects(s.hr.put('/api/hris/recruitment/assessment', { ...v2, categories: v2.categories.filter((c) => c.id !== 'faculty') }), /position category of \d job openings: rename it/);
});

// ----- Rating, ranking, and what the applicant never sees -----
test('ratings: who and when, ranks by total (ties share a rank), the audit log, and never the applicant', async () => {
  const s = await school();
  const job = await s.opening();
  const carla = await s.signUp('Carla Mendiola');
  const a = await s.apply(carla, job, 'I teach programming.');
  const b = await s.apply(await s.signUp('Bea Ramos'), job);
  const c = await s.apply(await s.signUp('Cris Lim'), job);
  await s.apply(await s.signUp('Unrated Uy'), job);
  const scores = (edu, demo) => ({ ...s.all(FACULTY.criteria, 80), education: { score: edu, comment: 'Relevant master\'s degree.' }, 'teaching-demo': { score: demo } });
  const ra = await s.rate(a.id, scores(90, 95));
  assert.deepEqual([ra.rating.by, ra.rating.at, ra.rank, ra.rated], ['Hana Reyes', new Date('2026-11-03T10:00:00').toISOString(), 1, 1]);
  assert.equal(ra.rating.scores.education.comment, 'Relevant master\'s degree.');
  await s.rate(b.id, scores(80, 80));
  const rc = await s.rate(c.id, scores(80, 80), await s.signIn('hugo'));
  assert.deepEqual([rc.rank, rc.rated, rc.rating.by], [2, 3, 'Hugo Santos'], 'equal totals share rank 2');
  // A second rating replaces the first; the earlier total is kept in its history.
  const again = await s.rate(c.id, scores(70, 80));
  assert.deepEqual([again.rank, again.rating.history.map((x) => [x.total, x.by])], [3, [[80, 'Hugo Santos']]]);
  const audit = s.env.api.audit.entries().filter((e) => e.targetId === c.id);
  assert.deepEqual(audit.map((e) => e.action), ['Rated a job application', 'Changed the rating of a job application']);
  assert.ok(audit[1].changes.some((x) => x.field === 'Education (25%)' && x.from === '80' && x.to === '70'));
  assert.ok(audit[1].changes.some((x) => x.field === 'Weighted total' && x.from === '80'));
  // The opening's list: each application with its total and rank.
  const detail = await s.hr.get(`/api/hris/recruitment/openings/${job.id}`);
  assert.deepEqual(detail.applications.map((x) => x.rating && [x.rating.rank, x.rating.total]), [[1, 86.25], [2, 80], [3, 77.5], null]);
  assert.equal(detail.assessment.frozen, true);
  // The comparative list: ranked, a column per criterion, the captions from settings.
  const cmp = await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`);
  assert.deepEqual(cmp.rows.map((r) => [r.rank, r.name, r.total]), [[1, 'Carla Mendiola', 86.25], [2, 'Bea Ramos', 80], [3, 'Cris Lim', 77.5]]);
  assert.deepEqual(cmp.template.criteria.map((x) => x.id), FACULTY.criteria.map((x) => x.id));
  assert.equal(cmp.rows[0].scores['teaching-demo'], 95);
  assert.deepEqual([cmp.unrated, cmp.print.signTitle, cmp.print.title, cmp.asOf], [1, 'HRMPSB Secretariat', 'Comparative assessment of applicants', '2026-11-03']);
  const v = await s.hr.get('/api/hris/recruitment/assessment');
  await s.hr.put('/api/hris/recruitment/assessment', { ...v, print: { ...v.print, signName: 'R. DELA PAZ', signTitle: 'Secretary, HRMPSB' } });
  assert.equal((await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`)).print.signTitle, 'Secretary, HRMPSB');
  // Withdrawn: out of the ranking.
  await carla.post(`/api/hris/my-applications/${a.id}/withdraw`);
  assert.deepEqual((await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`)).rows.map((r) => [r.rank, r.name]), [[1, 'Bea Ramos'], [2, 'Cris Lim']]);
  await assert.rejects(s.rate(a.id, scores(10, 10)), /withdrew/);

  // The applicant never sees scores, comments, totals or ranks, and cannot ask for them.
  const bea = s.env.db.data.users.find((u) => u.name === 'Bea Ramos');
  const beaClient = await s.signIn(bea.username, 'longenough1');
  const mine = await beaClient.get('/api/hris/my-applications');
  const one = await beaClient.get(`/api/hris/my-applications/${b.id}`);
  const jobView = await beaClient.get(`/api/hris/jobs/${job.id}`);
  for (const body of [mine, one, jobView]) {
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /rating|score|Relevant master|"total"|rank/i);
  }
  await assert.rejects(beaClient.get(`/api/hris/recruitment/applications/${b.id}/rating`), status(403));
  await assert.rejects(beaClient.get(`/api/hris/recruitment/openings/${job.id}/comparative`), status(403));
  // Nobody rates their own application; staff without Recruitment cannot rate.
  const eli = await s.signIn('eli');
  await assert.rejects(eli.put(`/api/hris/recruitment/applications/${b.id}/rating`, { scores: {} }), status(403));
  const own = await s.apply(s.hr, job); // HR applies with her own account: another HR person rates it
  await assert.rejects(s.rate(own.id, { education: { score: 100 } }), (e) => e.status === 403 && /your own application/.test(e.message));
  assert.equal((await s.rate(own.id, { education: { score: 60 } }, await s.signIn('hugo'))).rating.by, 'Hugo Santos');
});

// ----- The applicant profile (PL-019) -----
test('the applicant profile: details, account dates, every application with its history; remarks and ratings only when asked', async () => {
  const s = await school();
  await s.hr.put('/api/hris/recruitment/settings', { signupFields: { education: 'optional', campus: 'optional', birthDate: 'optional' } });
  const job = await s.opening();
  const lab = await s.opening({ title: 'Laboratory Technician I', categoryId: 'non-teaching' });
  const main = s.env.db.data.campuses[0];
  const carla = await s.signUp('Carla Mendiola', { phone: '0917 123 4567', education: 'graduate', campus: main.id, birthDate: '1996-04-17' });
  const a = await s.apply(carla, job, 'I teach programming part-time.');
  await s.apply(carla, lab);
  await s.hr.put(`/api/hris/recruitment/applications/${a.id}`, { stage: 'screening', note: 'Please send your transcript.', remark: 'Ask the college about a demo slot.' });
  await s.rate(a.id, { education: { score: 90, comment: 'Master\'s in IT.' } });
  const id = s.user(carla.username).id;
  const plain = await s.hr.get(`/api/hris/recruitment/profiles/${id}`);
  assert.deepEqual([plain.name, plain.email, plain.phone, plain.internal], ['Carla Mendiola', `${carla.username}@example.com`, '0917 123 4567', false]);
  assert.deepEqual([plain.details.educationLabel, plain.details.campusName, plain.details.birthDate], ['Graduate studies', main.name, '1996-04-17']);
  assert.deepEqual([plain.account.status, plain.account.createdAt, plain.account.expiresAt.slice(0, 10)], ['open', new Date('2026-11-03T10:00:00').toISOString(), '2027-11-03']);
  assert.equal(plain.applications.length, 2);
  const app = plain.applications.find((x) => x.id === a.id);
  assert.deepEqual([app.title, app.stageLabel, app.outcome, app.note, app.rated], ['Instructor I', 'Initial screening', null, 'I teach programming part-time.', true]);
  assert.deepEqual(app.history.map((h) => [h.stageLabel, h.by, h.note]), [['Application received', 'Applicant', ''], ['Initial screening', 'Hana Reyes', 'Please send your transcript.']]);
  // Left out unless asked: HR's internal remarks, and the ratings.
  assert.doesNotMatch(JSON.stringify(plain), /Ask the college|Master's in IT|"remark"/);
  assert.equal(app.rating, null);
  assert.deepEqual(plain.options, { remarks: false, ratings: false });
  assert.deepEqual([plain.printedBy, plain.school.name], ['Hana Reyes', s.env.db.data.settings.schoolName]);
  assert.deepEqual(plain.pool, { optedIn: false, optedInAt: null, entry: null });
  const full = await s.hr.get(`/api/hris/recruitment/profiles/${id}?remarks=1&ratings=1`);
  const fapp = full.applications.find((x) => x.id === a.id);
  assert.equal(fapp.history[1].remark, 'Ask the college about a demo slot.');
  assert.deepEqual([fapp.rating.total, fapp.rating.rank, fapp.rating.scores.education.comment, fapp.rating.criteria.length], [22.5, 1, 'Master\'s in IT.', 6]);
  const onlyRatings = await s.hr.get(`/api/hris/recruitment/profiles/${id}?ratings=1`);
  assert.doesNotMatch(JSON.stringify(onlyRatings), /Ask the college/);
  // A decided application shows its outcome.
  await s.hr.put(`/api/hris/recruitment/applications/${a.id}`, { stage: 'not-qualified' });
  assert.deepEqual((await s.hr.get(`/api/hris/recruitment/profiles/${id}`)).applications.find((x) => x.id === a.id).outcome, { label: 'Not qualified', meaning: 'Not selected' });

  // An internal applicant: from their employee record.
  const eli = await s.signIn('eli');
  const internal = await s.apply(eli, await s.opening({ title: 'Administrative Officer II', audience: 'internal', categoryId: 'non-teaching' }));
  assert.equal(internal.internal, true);
  const ep = await s.hr.get(`/api/hris/recruitment/profiles/${s.user('eli').id}`);
  assert.deepEqual([ep.internal, ep.employee.position, ep.employee.salaryGrade, ep.employee.step, ep.employee.appointment, ep.employee.id], [true, 'Administrative Aide IV', 4, 2, 'Permanent', s.eliEmp.id]);
  assert.equal(ep.account.employee, true);

  // Access: only Recruitment (hris.recruitment); never the applicant themselves; nobody who never applied.
  await assert.rejects(eli.get(`/api/hris/recruitment/profiles/${id}`), status(403));
  await assert.rejects(carla.get(`/api/hris/recruitment/profiles/${id}`), status(403));
  await assert.rejects(s.hr.get(`/api/hris/recruitment/profiles/${s.user('hugo').id}`), status(404));
  await assert.rejects(s.hr.get('/api/hris/recruitment/profiles/nobody'), status(404));
});

test('ranksOf: highest total first; equal totals share a rank', () => {
  const r = ranksOf([{ id: 'a', total: 70 }, { id: 'b', total: 90 }, { id: 'c', total: 70 }, { id: 'd', total: 50 }]);
  assert.deepEqual(['a', 'b', 'c', 'd'].map((k) => r.get(k)), [2, 1, 2, 4]);
});
