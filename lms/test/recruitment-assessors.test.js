// Several assessors (the rest of HRIS request PL-021): the selection board of an opening, who may see
// and rate what, independent ratings (drafts, submitting, what each sees), the combining rules
// (average; average without the highest and lowest, also with fewer than 3; board consensus), the
// migration of single ratings, the comparative list with each assessor and the signature lines, the
// Performance rating criterion (the adjectival table, not applicable for external applicants), and
// the audit log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { memoryDb } from '../server/db.js';
import { ROLES, HRIS_PERMISSION_LABELS } from '../shared/roles.js';
import { DEFAULT_ADJECTIVAL, combineRating, weightedTotal, migrateRatings } from '../shared/recruitment-assess.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;

// An admin; HR (Hana); staff Ana and Ben and a teacher, Cora (assessors); staff Dan (never named).
async function school({ db } = {}) {
  let now = Date.parse('2026-11-03T10:00:00');
  const env = setup({ clock: () => new Date(now), options: { rateLimits: 'off' }, ...(db ? { db } : {}) });
  const admin = env.client();
  const signIn = async (username, password = PW) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password });
    return c;
  };
  if (db) { // a school from data given (the migration): only sign in
    await admin.post('/api/admin/auth/login', { username: 'admin', password: PW });
    return { env, admin, signIn };
  }
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const staff = async (first, last, role, username, extra = {}) => {
    const e = await admin.post('/api/hris/employees', { firstName: first, lastName: last, gender: 'Female', hireDate: '2020-01-06', payType: 'monthly', rate: 26100, position: 'Clerk', department: 'Registrar', ...extra });
    await admin.post(`/api/hris/employees/${e.id}/account`, { role, username, password: PW, mustChangePassword: false });
    return e;
  };
  const eli = await staff('Eli', 'Cruz', 'staff', 'eli', { position: 'Administrative Aide IV' });
  await staff('Hana', 'Reyes', 'hr', 'hana', { position: 'HR Officer' });
  await staff('Ana', 'Lopez', 'staff', 'ana', { position: 'Accountant II' });
  await staff('Ben', 'Garcia', 'staff', 'ben', { position: 'Records Officer' });
  await staff('Dan', 'Uy', 'staff', 'dan');
  const campus = (await admin.get('/api/admin/campuses'))[0];
  await admin.post('/api/admin/users', { role: 'teacher', username: 'cora', name: 'Cora Teacher', password: PW, mustChangePassword: false, campusIds: [campus.id] });
  const hr = await signIn('hana');
  const user = (username) => env.db.data.users.find((u) => u.username === username);
  const opening = (extra = {}) => hr.post('/api/hris/recruitment/openings', {
    title: 'Instructor I', salaryGrade: 12, education: "Master's degree", vacancies: 2, closingDate: '2026-12-20', audience: 'all', status: 'open', categoryId: 'faculty', ...extra,
  });
  let n = 0;
  const signUp = async (name) => {
    const username = `app${++n}`;
    const c = env.client();
    await c.post('/api/jobs/signup', { name, email: `${username}@example.com`, username, password: 'longenough1', consent: true });
    await c.post('/api/hub/login', { username, password: 'longenough1' });
    return Object.assign(c, { username });
  };
  const apply = (c, job) => c.post(`/api/hris/jobs/${job.id}/apply`, { note: '' });
  const panel = (job, list) => hr.put(`/api/hris/recruitment/openings/${job.id}/panel`, { assessors: list.map(([u, title = '']) => ({ userId: user(u).id, title })) });
  const rate = (who, id, scores, submit = true) => who.put(`/api/hris/recruitment/applications/${id}/rating`, { scores, submit });
  const all = (criteria, score) => Object.fromEntries(criteria.map((c) => [c.id, { score }]));
  const stored = (id) => env.db.data.jobApplications.find((a) => a.id === id);
  // A template with two criteria of 50% each and the given combining rule.
  const template = async (name, combine, criteria = [{ label: 'Exam', weight: 50 }, { label: 'Interview', weight: 50 }]) => {
    const v = await hr.get('/api/hris/recruitment/assessment');
    const saved = await admin.put('/api/hris/recruitment/assessment', { ...v, templates: [...v.templates, { name, categoryId: 'faculty', combine, criteria }] });
    return saved.templates.find((t) => t.name === name);
  };
  return { env, admin, hr, signIn, user, opening, signUp, apply, panel, rate, all, stored, template, eli, clock: { add: (ms) => (now += ms) } };
}

test('the permission hris.assess exists, no account type has it, and an assessor is any active staff account HR names', async () => {
  assert.ok(HRIS_PERMISSION_LABELS.some(([p]) => p === 'hris.assess'));
  for (const [role, r] of Object.entries(ROLES)) if (role !== 'admin') assert.ok(!r.permissions.includes('hris.assess'), `${role} has hris.assess built in`);
  const s = await school();
  const job = await s.opening();
  const other = await s.opening({ title: 'Instructor II' });
  // HR finds staff accounts (not applicants, students, parents) to name.
  const found = await s.hr.get('/api/hris/recruitment/assessors?q=an');
  assert.ok(found.some((u) => u.name === 'Ana Lopez' && u.position === 'Accountant II'));
  const carla = await s.signUp('Carla Mendiola');
  const a = await s.apply(carla, job);
  const b = await s.apply(carla, other);
  assert.ok(!(await s.hr.get('/api/hris/recruitment/assessors?q=carla')).length, 'a job applicant is never offered');
  await assert.rejects(s.panel(job, [[carla.username]]), /only active staff accounts/);
  // Someone who applied for the opening cannot be on its board.
  await s.apply(await s.signIn('eli'), job);
  await assert.rejects(s.panel(job, [['eli']]), /has applied for this opening/);
  // An account whose hris.assess was taken away cannot be named.
  s.user('dan').access = { remove: ['hris.assess'] };
  await assert.rejects(s.panel(job, [['dan']]), /rating applicants was taken away/);
  delete s.user('dan').access;
  // Only HR names the board.
  const ana = await s.signIn('ana');
  await assert.rejects(ana.put(`/api/hris/recruitment/openings/${job.id}/panel`, { assessors: [] }), status(403));
  const saved = await s.panel(job, [['ana', 'Chairperson'], ['ben'], ['cora', 'Member']]);
  assert.deepEqual(saved.panel.map((p) => [p.name, p.title]), [['Ana Lopez', 'Chairperson'], ['Ben Garcia', ''], ['Cora Teacher', 'Member']]);
  // Each is told on the bell, with a link to the opening's ratings.
  const bell = (await ana.get('/api/me/notifications')).items.find((x) => x.kind === 'assess.panel');
  assert.ok(bell && /selection board for Instructor I/.test(bell.title) && bell.link.endsWith(`/assess/${job.id}`));
  // Their People status says they are an assessor (Ratings to do).
  assert.deepEqual((await ana.get('/api/hris/auth/status')).assessor, { openings: 1, toDo: 2 });
  assert.equal((await (await s.signIn('dan')).get('/api/hris/auth/status')).assessor, null);
  // An assessor sees only the openings they are named on: their applicants, applications.
  const mine = await ana.get('/api/hris/assess');
  assert.deepEqual(mine.openings.map((o) => [o.title, o.applicants, o.toDo, o.myTitle]), [['Instructor I', 2, 2, 'Chairperson']]);
  const view = await ana.get(`/api/hris/assess/openings/${job.id}`);
  assert.deepEqual(view.applications.map((x) => x.name).sort(), ['Carla Mendiola', 'Eli Cruz']);
  assert.doesNotMatch(JSON.stringify(view), /@example\.com|phone/, 'no contact details for assessors');
  await assert.rejects(ana.get(`/api/hris/assess/openings/${other.id}`), status(403));
  await assert.rejects(ana.get(`/api/hris/recruitment/applications/${b.id}/rating`), status(403));
  await assert.rejects(ana.get(`/api/hris/recruitment/openings/${job.id}`), status(403), 'not HR\'s screens');
  await assert.rejects(ana.get(`/api/hris/recruitment/openings/${job.id}/comparative`), status(403), 'the comparative list is HR\'s');
  const dan = await s.signIn('dan');
  assert.deepEqual((await dan.get('/api/hris/assess')).openings, []);
  await assert.rejects(dan.get(`/api/hris/recruitment/applications/${a.id}/rating`), status(403));
  await assert.rejects(dan.put(`/api/hris/recruitment/applications/${a.id}/rating`, { scores: {} }), status(403));
  await assert.rejects(carla.get(`/api/hris/assess/openings/${job.id}`), status(403));
  // The teacher, from their own (Learn) session.
  const cora = await s.signIn('cora');
  assert.equal((await cora.get(`/api/hris/recruitment/applications/${a.id}/rating`)).asAssessor, true);
  // Taking hris.assess away from an account stops it, even where it is named.
  s.user('cora').access = { remove: ['hris.assess'] };
  await assert.rejects(cora.get(`/api/hris/recruitment/applications/${a.id}/rating`), status(403));
  delete s.user('cora').access;
  // An assessor who has rated stays on the board; one who has not can go (their drafts with them).
  const crit = (await ana.get(`/api/hris/recruitment/applications/${a.id}/rating`)).template.criteria;
  await s.rate(ana, a.id, s.all(crit, 80));
  await s.rate(await s.signIn('ben'), a.id, s.all(crit, 70), false);
  await assert.rejects(s.panel(job, [['ben'], ['cora']]), /Ana Lopez has rated 1 applicant here, so stays/);
  await s.panel(job, [['ana', 'Chairperson'], ['cora']]);
  assert.deepEqual(s.stored(a.id).ratings.map((r) => r.by), ['Ana Lopez'], 'Ben\'s draft went with him');
  assert.equal((await (await s.signIn('ben')).get('/api/hris/assess')).openings.length, 0);
});

test('independent ratings: drafts do not count, nobody sees the others before submitting, HR sees the breakdown', async () => {
  const s = await school();
  const job = await s.opening();
  const a = await s.apply(await s.signUp('Carla Mendiola'), job);
  await s.panel(job, [['ana'], ['ben'], ['cora']]);
  const ana = await s.signIn('ana');
  const ben = await s.signIn('ben');
  const crit = (await ana.get(`/api/hris/recruitment/applications/${a.id}/rating`)).template.criteria;
  // A draft: kept, but not counted, and the template is fixed by it.
  const draft = await s.rate(ana, a.id, s.all(crit, 90), false);
  assert.deepEqual([draft.rating.draft, draft.rating.total, draft.combined, draft.progress.submitted, draft.progress.drafts], [true, 90, null, 0, 1]);
  assert.equal(s.stored(a.id).rating, null);
  assert.ok(s.env.db.data.jobOpenings.find((o) => o.id === job.id).assessment, 'the first rating (a draft) fixes the template');
  // Ben submits; before Ana submits she sees only her own, and nobody's breakdown.
  await s.rate(ben, a.id, s.all(crit, 70));
  const anaView = await ana.get(`/api/hris/recruitment/applications/${a.id}/rating`);
  assert.deepEqual([anaView.rating.total, anaView.combined, anaView.breakdown, anaView.rank, anaView.board.independent], [90, null, null, null, true]);
  assert.doesNotMatch(JSON.stringify(anaView), /Ben Garcia|"70"|:70\b/, 'nothing of Ben\'s rating');
  // After submitting: still only her own (the setting is off by default; only HR sees the result).
  const sub = await s.rate(ana, a.id, s.all(crit, 90));
  assert.deepEqual([sub.rating.draft, sub.combined, sub.breakdown, sub.rank], [false, null, null, null]);
  await assert.rejects(s.rate(ana, a.id, s.all(crit, 50), false), /You have submitted this rating/);
  // HR sees everyone's, and the combined result.
  const hrView = await s.hr.get(`/api/hris/recruitment/applications/${a.id}/rating`);
  assert.deepEqual(hrView.breakdown.map((x) => [x.name, x.total, x.draft]).sort(), [['Ana Lopez', 90, false], ['Ben Garcia', 70, false]]);
  assert.deepEqual([hrView.combined.total, hrView.rank, hrView.progress.submitted, hrView.progress.of], [80, 1, 2, 3]);
  // With the setting on, an assessor who has submitted sees the combined result (never the breakdown).
  const v = await s.hr.get('/api/hris/recruitment/assessment');
  await s.admin.put('/api/hris/recruitment/assessment', { ...v, board: { assessorsSeeResult: true } });
  const seen = await ana.get(`/api/hris/recruitment/applications/${a.id}/rating`);
  assert.deepEqual([seen.combined.total, seen.rank, seen.breakdown], [80, 1, null]);
  const cora = await s.signIn('cora');
  const notYet = await cora.get(`/api/hris/recruitment/applications/${a.id}/rating`);
  assert.deepEqual([notYet.combined, notYet.rank], [null, null], 'not before submitting their own');
  // The last assessor submits: HR is told on the bell, once.
  await s.rate(cora, a.id, s.all(crit, 60));
  const bell = (await s.hr.get('/api/me/notifications')).items.filter((x) => x.kind === 'job.rated');
  assert.equal(bell.length, 1);
  assert.match(bell[0].title, /All 3 assessors have rated Carla Mendiola/);
  // Changing a submitted rating keeps the earlier one in its history.
  const changed = await s.rate(cora, a.id, s.all(crit, 66));
  assert.deepEqual(changed.rating.history.map((x) => x.total), [60]);
  assert.equal(s.stored(a.id).rating.total, 75.33);
});

test('combining: the average; without the highest and lowest (3 or more); fewer than 3 is the plain average', async () => {
  const two = [{ id: 'exam', label: 'Exam', weight: 50 }, { id: 'interview', label: 'Interview', weight: 50 }];
  const r = (slot, exam, interview) => ({ slot, submittedAt: 'x', scores: { exam: { score: exam }, interview: { score: interview } } });
  // Average per criterion, to two decimals.
  assert.deepEqual(combineRating(two, [r('a', 80, 70), r('b', 90, 71), r('c', 70, 71)], 'average').scores, { exam: { score: 80 }, interview: { score: 70.67 } });
  // Trimmed: per criterion, the highest and lowest left out.
  const t = combineRating(two, [r('a', 80, 50), r('b', 90, 70), r('c', 100, 60), r('d', 60, 90)], 'trimmed');
  assert.deepEqual(t.scores, { exam: { score: 85 }, interview: { score: 65 } });
  assert.deepEqual(t.trimmed, { exam: ['d', 'c'], interview: ['a', 'd'] });
  assert.equal(t.total, 75);
  // With two assessors (fewer than 3), the trimmed rule is the plain average.
  assert.deepEqual(combineRating(two, [r('a', 80, 50), r('b', 100, 70)], 'trimmed').scores, { exam: { score: 90 }, interview: { score: 60 } });
  // A draft never counts; nothing submitted: no result.
  assert.equal(combineRating(two, [{ ...r('a', 80, 50), submittedAt: null }], 'average'), null);

  // Through the API, on a template with the trimmed rule.
  const s = await school();
  const tpl = await s.template('Board (trimmed)', 'trimmed');
  assert.equal(tpl.combine, 'trimmed');
  const job = await s.opening({ templateId: tpl.id });
  const a = await s.apply(await s.signUp('Carla Mendiola'), job);
  await s.panel(job, [['ana'], ['ben'], ['cora']]);
  const sc = (exam, interview) => ({ exam: { score: exam }, interview: { score: interview } });
  await s.rate(await s.signIn('ana'), a.id, sc(80, 50));
  await s.rate(await s.signIn('ben'), a.id, sc(100, 70));
  assert.equal(s.stored(a.id).rating.total, 75, 'two so far: the plain average (90 and 60)');
  await s.rate(await s.signIn('cora'), a.id, sc(60, 90));
  assert.deepEqual(s.stored(a.id).rating.scores, { exam: { score: 80 }, interview: { score: 70 } }, 'three: each criterion without its highest and lowest');
  assert.equal(s.stored(a.id).rating.total, 75);
  assert.equal(s.stored(a.id).rating.rule, 'trimmed');
  // HR can always rate, as the HR office: one more rating that counts.
  await s.rate(s.hr, a.id, sc(90, 80));
  const cmp = await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`);
  assert.deepEqual([cmp.rows[0].scores, cmp.rows[0].progress.submitted, cmp.rows[0].progress.of], [{ exam: 85, interview: 75 }, 4, 4]);
  // The rule is part of the template's version: changing it makes a new version, and a rated opening keeps its own.
  const v = await s.hr.get('/api/hris/recruitment/assessment');
  const saved = await s.admin.put('/api/hris/recruitment/assessment', { ...v, templates: v.templates.map((x) => (x.id === tpl.id ? { ...x, combine: 'average' } : x)) });
  assert.equal(saved.templates.find((x) => x.id === tpl.id).version, 2);
  assert.equal(s.env.db.data.jobOpenings.find((o) => o.id === job.id).assessment.combine, 'trimmed');
  await assert.rejects(s.admin.put('/api/hris/recruitment/assessment', { ...v, templates: v.templates.map((x) => (x.id === tpl.id ? { ...x, combine: 'median' } : x)) }), /pick how the assessors' ratings are combined/);
});

test('board consensus: the secretariat enters the agreed scores; the assessors\' are kept for reference', async () => {
  const s = await school();
  const tpl = await s.template('Board (consensus)', 'consensus');
  const job = await s.opening({ templateId: tpl.id });
  const a = await s.apply(await s.signUp('Carla Mendiola'), job);
  const b = await s.apply(await s.signUp('Bea Ramos'), job);
  await s.panel(job, [['ana'], ['ben']]);
  const sc = (exam, interview) => ({ exam: { score: exam }, interview: { score: interview } });
  const ana = await s.signIn('ana');
  await s.rate(ana, a.id, sc(80, 60));
  await s.rate(await s.signIn('ben'), a.id, sc(90, 70));
  // No result until the consensus is entered.
  assert.equal(s.stored(a.id).rating, null);
  let cmp = await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`);
  assert.deepEqual([cmp.rows.length, cmp.awaitingConsensus, cmp.unrated, cmp.rule], [0, 1, 2, 'consensus']);
  // Only HR enters it.
  await assert.rejects(ana.put(`/api/hris/recruitment/applications/${a.id}/consensus`, { scores: sc(85, 65) }), status(403));
  const k = await s.hr.put(`/api/hris/recruitment/applications/${a.id}/consensus`, { scores: sc(84, 66) });
  assert.deepEqual([k.combined.total, k.consensus.total, k.rank, k.breakdown.length], [75, 75, 1, 2]);
  assert.deepEqual(s.stored(a.id).ratings.map((r) => r.total).sort(), [70, 80], 'the assessors\' own ratings are kept');
  assert.match(s.stored(a.id).rating.by, /Board consensus \(entered by Hana Reyes\)/);
  cmp = await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`);
  assert.deepEqual(cmp.rows.map((r) => [r.name, r.total, r.consensus, r.assessors.length]), [['Carla Mendiola', 75, true, 2]]);
  // A consensus can be entered even before every assessor has rated (the board met), and changed.
  await s.hr.put(`/api/hris/recruitment/applications/${b.id}/consensus`, { scores: sc(90, 90) });
  const again = await s.hr.put(`/api/hris/recruitment/applications/${a.id}/consensus`, { scores: sc(94, 96) });
  assert.deepEqual([again.consensus.total, again.consensus.history.map((x) => x.total), again.rank], [95, [75], 1]);
  // Not for a template that averages.
  const avgJob = await s.opening({ title: 'Instructor II' });
  const c = await s.apply(await s.signUp('Cris Lim'), avgJob);
  await assert.rejects(s.hr.put(`/api/hris/recruitment/applications/${c.id}/consensus`, { scores: { education: { score: 90 } } }), /not by board consensus/);
});

test('migration: single ratings from before become the HR office\'s rating, and nothing changes for openings rated so far', async () => {
  const s = await school();
  const job = await s.opening();
  const a = await s.apply(await s.signUp('Carla Mendiola'), job);
  const b = await s.apply(await s.signUp('Bea Ramos'), job);
  const crit = (await s.hr.get(`/api/hris/recruitment/applications/${a.id}/rating`)).template.criteria;
  await s.rate(s.hr, a.id, { ...s.all(crit, 80), education: { score: 95, comment: 'Relevant master\'s.' } });
  await s.rate(s.hr, b.id, s.all(crit, 70));
  const before = await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`);
  // The data as it was stored before several assessors: one rating per application, no ratings list.
  const old = structuredClone(s.env.db.data);
  for (const x of old.jobApplications) {
    const r = x.ratings?.[0];
    delete x.ratings;
    if (r) x.rating = { version: r.version, templateId: 'faculty-example', scores: r.scores, total: r.total, complete: r.complete, by: r.by, byId: r.byId, at: r.at, history: [] };
  }
  for (const o of old.jobOpenings) delete o.assessment.combine;
  assert.equal(migrateRatings(structuredClone(old)), 2);
  const t = await school({ db: memoryDb(old) });
  const app = t.env.db.data.jobApplications.find((x) => x.id === a.id);
  assert.deepEqual(app.ratings.map((r) => [r.slot, r.by, Boolean(r.submittedAt), r.total, r.migrated]), [['hr', 'Hana Reyes', true, before.rows[0].total, true]]);
  assert.equal(app.rating.total, before.rows[0].total);
  assert.equal(app.rating.scores.education.comment, 'Relevant master\'s.');
  const hr = await t.signIn('hana');
  const after = await hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`);
  assert.deepEqual(after.rows.map((r) => [r.rank, r.name, r.total]), before.rows.map((r) => [r.rank, r.name, r.total]));
  // HR rating again replaces the HR office's rating, as before.
  const again = await hr.put(`/api/hris/recruitment/applications/${b.id}/rating`, { scores: s.all(crit, 60) });
  assert.deepEqual([again.rating.total, again.rating.history.map((x) => x.total), again.progress.of], [60, [70], 1]);
  // Migrating twice changes nothing.
  assert.equal(migrateRatings(t.env.db.data), 0);
});

test('the comparative list: the combined total and rank, each assessor (HR only), signature lines from settings', async () => {
  const s = await school();
  const job = await s.opening();
  const a = await s.apply(await s.signUp('Carla Mendiola'), job);
  const b = await s.apply(await s.signUp('Bea Ramos'), job);
  await s.apply(await s.signUp('Unrated Uy'), job);
  await s.panel(job, [['ana', 'Chairperson'], ['ben'], ['cora', 'Vice-chair']]);
  const ana = await s.signIn('ana');
  const ben = await s.signIn('ben');
  const crit = (await ana.get(`/api/hris/recruitment/applications/${a.id}/rating`)).template.criteria;
  await s.rate(ana, a.id, s.all(crit, 90));
  await s.rate(ben, a.id, s.all(crit, 80));
  await s.rate(ana, b.id, s.all(crit, 70));
  await s.rate(ben, b.id, s.all(crit, 100), false); // a draft: not on the list
  const v = await s.hr.get('/api/hris/recruitment/assessment');
  await s.admin.put('/api/hris/recruitment/assessment', { ...v, print: { ...v.print, boardCaption: 'Assessed by', memberTitle: 'Member, selection board' } });
  const cmp = await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`);
  assert.deepEqual(cmp.rows.map((r) => [r.rank, r.name, r.total, `${r.progress.submitted} of ${r.progress.of}`]), [[1, 'Carla Mendiola', 85, '2 of 3'], [2, 'Bea Ramos', 70, '1 of 3']]);
  assert.deepEqual(cmp.rows[0].assessors.map((x) => [x.name, x.title, x.total]), [['Ana Lopez', 'Chairperson', 90], ['Ben Garcia', '', 80]]);
  assert.deepEqual(cmp.rows[1].assessors.map((x) => x.name), ['Ana Lopez'], 'drafts are not in the breakdown');
  assert.deepEqual(cmp.panel.map((p) => [p.name, p.title]), [['Ana Lopez', 'Chairperson'], ['Ben Garcia', ''], ['Cora Teacher', 'Vice-chair']]);
  assert.deepEqual([cmp.print.boardCaption, cmp.print.memberTitle, cmp.print.signTitle], ['Assessed by', 'Member, selection board', 'HRMPSB Secretariat']);
  assert.equal(cmp.unrated, 1);
  // The opening's list: "rated by 2 of 3 assessors".
  const detail = await s.hr.get(`/api/hris/recruitment/openings/${job.id}`);
  assert.deepEqual(detail.applications.map((x) => x.assessors && [x.assessors.submitted, x.assessors.of, x.assessors.drafts]), [[2, 3, 0], [1, 3, 1], [0, 3, 0]]);
  assert.deepEqual(detail.assessment.panel.map((p) => [p.name, p.rated]), [['Ana Lopez', 2], ['Ben Garcia', 1], ['Cora Teacher', 0]]);
  // The applicant profile with ratings: the combined result and each assessor.
  const prof = await s.hr.get(`/api/hris/recruitment/profiles/${s.stored(a.id).userId}?ratings=1`);
  assert.deepEqual(prof.applications[0].rating.assessors.map((x) => [x.name, x.total]), [['Ana Lopez', 90], ['Ben Garcia', 80]]);
  assert.equal(prof.applications[0].rating.total, 85);
});

test('conflict of interest: a board member cannot apply for the opening, and never rates or reads documents while an applicant to it', async () => {
  const s = await school();
  const job = await s.opening();
  const a = await s.apply(await s.signUp('Carla Mendiola'), job);
  await s.panel(job, [['ana'], ['ben']]);
  const ana = await s.signIn('ana');
  await assert.rejects(s.apply(ana, job), (e) => e.status === 403 && /You are on this opening's selection board/.test(e.message));
  assert.ok(!s.env.db.data.jobApplications.some((x) => x.userId === s.user('ana').id), 'no application made');
  const crit = (await ana.get(`/api/hris/recruitment/applications/${a.id}/rating`)).template.criteria;
  // HR on the board cannot apply either.
  await s.panel(job, [['ana'], ['ben'], ['hana']]);
  await assert.rejects(s.apply(s.hr, job), /selection board/);
  // Should a board member be an applicant all the same (older data), they cannot rate or open documents.
  s.env.db.data.jobApplications.push({ ...structuredClone(s.stored(a.id)), id: 'conflict', userId: s.user('ana').id, internal: true, ratings: [], rating: null });
  await assert.rejects(ana.get(`/api/hris/recruitment/applications/${a.id}/rating`), (e) => e.status === 403 && /applied for this opening/.test(e.message));
  await assert.rejects(s.rate(ana, a.id, s.all(crit, 5)), status(403));
  await assert.rejects(ana.get(`/api/hris/recruitment/applications/${a.id}/documents`), status(403));
  await assert.rejects(ana.get(`/api/hris/assess/openings/${job.id}`), status(403));
  assert.ok(!s.stored(a.id).rating, 'nothing rated');
  // Ben, on the same board without applying, still rates.
  assert.equal((await s.rate(await s.signIn('ben'), a.id, s.all(crit, 80))).rating.total, 80);
});

test('an HR account on the board sees no other assessor\'s scores on the comparative list, the opening or the profile before its own rating', async () => {
  const s = await school();
  const job = await s.opening();
  const a = await s.apply(await s.signUp('Carla Mendiola'), job);
  await s.panel(job, [['ana'], ['hana']]);
  const ana = await s.signIn('ana');
  const crit = (await ana.get(`/api/hris/recruitment/applications/${a.id}/rating`)).template.criteria;
  await s.rate(ana, a.id, s.all(crit, 90));
  const cmp = await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`);
  assert.deepEqual([cmp.rows.length, cmp.hiddenUntilRated], [0, 1]);
  const detail = await s.hr.get(`/api/hris/recruitment/openings/${job.id}`);
  assert.deepEqual([detail.applications[0].rating, detail.applications[0].ratingHidden], [null, true]);
  const prof = await s.hr.get(`/api/hris/recruitment/profiles/${s.stored(a.id).userId}?ratings=1`);
  assert.equal(prof.applications[0].rating, null);
  for (const v of [cmp, detail, prof]) assert.doesNotMatch(JSON.stringify(v), /"total":90\b|"by":"Ana Lopez"/, 'nothing of Ana\'s rating');
  // Someone not on the board sees it all.
  assert.equal((await s.admin.get(`/api/hris/recruitment/openings/${job.id}/comparative`)).rows[0].total, 90);
  // Once HR submits its own rating, the result shows.
  await s.rate(s.hr, a.id, s.all(crit, 70));
  const after = await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`);
  assert.deepEqual([after.rows[0].total, after.rows[0].assessors.map((x) => x.name).sort(), after.hiddenUntilRated], [80, ['Ana Lopez', 'Hana Reyes'], 0]);
  assert.equal((await s.hr.get(`/api/hris/recruitment/openings/${job.id}`)).applications[0].rating.total, 80);
});

test('the Performance rating criterion: the adjectival table (examples), a source, not applicable for external applicants', async () => {
  const s = await school();
  const crit = [
    { id: 'performance', label: 'Performance rating', weight: 20, type: 'performance' },
    { id: 'exam', label: 'Exam', weight: 40 },
    { id: 'interview', label: 'Interview', weight: 40 },
  ];
  const tpl = await s.template('Promotion board', 'average', crit);
  const perf = tpl.criteria[0];
  assert.deepEqual([perf.type, perf.external, perf.tableExample, perf.table], ['performance', 'spread', true, DEFAULT_ADJECTIVAL], 'the example table, and not applicable for externals by default');
  // The built-in promotion example has one, marked as an example.
  const v0 = await s.hr.get('/api/hris/recruitment/assessment');
  assert.equal(v0.templates.find((x) => x.id === 'promotion-example').criteria.find((c) => c.type === 'performance').tableExample, true);
  const job = await s.opening({ templateId: tpl.id, audience: 'all' });
  // An internal applicant: an adjectival rating converts with the table; the source is kept.
  const eli = await s.signIn('eli');
  const inside = await s.apply(eli, job);
  assert.equal(inside.internal, true);
  const r = await s.rate(s.hr, inside.id, { performance: { adjectival: 'Very Satisfactory', source: 'IPCR Jan–Jun 2026: Very Satisfactory' }, exam: { score: 80 }, interview: { score: 70 } });
  assert.deepEqual([r.rating.scores.performance.score, r.rating.scores.performance.adjectival, r.rating.scores.performance.source, r.rating.total], [90, 'Very Satisfactory', 'IPCR Jan–Jun 2026: Very Satisfactory', 78]);
  await assert.rejects(s.rate(s.hr, inside.id, { performance: { adjectival: 'Superb' } }), /pick a rating from the template's list/);
  // Or a typed score with its source.
  const typed = await s.rate(s.hr, inside.id, { performance: { score: 87.5, source: 'IPCR 2025' }, exam: { score: 80 }, interview: { score: 70 } });
  assert.equal(typed.rating.total, 77.5);
  // An external applicant: not applicable; the weight is spread over the other criteria.
  const outside = await s.apply(await s.signUp('Carla Mendiola'), job);
  await assert.rejects(s.rate(s.hr, outside.id, { performance: { score: 90 }, exam: { score: 80 } }), /Not applicable \(external applicant\)/);
  const ext = await s.rate(s.hr, outside.id, { exam: { score: 80 }, interview: { score: 60 } });
  assert.deepEqual([ext.rating.total, ext.rating.complete, ext.skip], [70, true, ['performance']], '(80 × 40 + 60 × 40) ÷ 80');
  assert.deepEqual(weightedTotal(tpl.criteria, { exam: { score: 80 }, interview: { score: 60 } }, new Set(['performance'])).points, { exam: 40, interview: 30 });
  const cmp = await s.hr.get(`/api/hris/recruitment/openings/${job.id}/comparative`);
  assert.deepEqual(cmp.rows.find((x) => x.name === 'Carla Mendiola').skip, ['performance']);
  // The template's option: a typed score for external applicants instead; and the table edited.
  const v = await s.hr.get('/api/hris/recruitment/assessment');
  const edit = (patch) => s.admin.put('/api/hris/recruitment/assessment', { ...v, templates: v.templates.map((x) => (x.id === tpl.id ? { ...x, criteria: x.criteria.map((c) => (c.type === 'performance' ? { ...c, ...patch } : c)) } : x)) });
  await assert.rejects(edit({ table: [{ label: 'Outstanding', score: 120 }] }), /must count for 0 to 100/);
  await assert.rejects(edit({ table: [{ label: 'A', score: 90 }, { label: 'a', score: 80 }] }), /listed twice/);
  await assert.rejects(edit({ external: 'zero' }), /pick what external applicants get/);
  const saved = await edit({ external: 'typed', table: [{ label: 'Outstanding', score: 100 }, { label: 'Very Satisfactory', score: 88 }, { label: 'Satisfactory', score: 76 }] });
  const p2 = saved.templates.find((x) => x.id === tpl.id).criteria[0];
  assert.deepEqual([p2.external, p2.tableExample, p2.table.length], ['typed', undefined, 3], 'changed values: no longer the example');
  const job2 = await s.opening({ title: 'Instructor II', templateId: tpl.id });
  const ext2 = await s.apply(await s.signUp('Bea Ramos'), job2);
  const typedExt = await s.rate(s.hr, ext2.id, { performance: { score: 80, source: 'Previous employer, 2025' }, exam: { score: 80 }, interview: { score: 60 } });
  assert.equal(typedExt.rating.total, 72);
  // Two performance criteria in one template are refused.
  await assert.rejects(s.template('Twice', 'average', [{ label: 'PR one', weight: 50, type: 'performance' }, { label: 'PR two', weight: 50, type: 'performance' }]), /at most one Performance rating criterion/);
});

test('audit: the board, drafts, ratings and the consensus are recorded with who and when', async () => {
  const s = await school();
  const tpl = await s.template('Board (consensus)', 'consensus');
  const job = await s.opening({ templateId: tpl.id });
  const a = await s.apply(await s.signUp('Carla Mendiola'), job);
  await s.panel(job, [['ana', 'Chairperson'], ['ben']]);
  const ana = await s.signIn('ana');
  const sc = (exam, interview) => ({ exam: { score: exam }, interview: { score: interview } });
  await s.rate(ana, a.id, sc(80, 60), false);
  await s.rate(ana, a.id, sc(82, 60));
  await s.rate(ana, a.id, sc(84, 60));
  await s.hr.put(`/api/hris/recruitment/applications/${a.id}/consensus`, { scores: sc(83, 62) });
  await s.panel(job, [['ana', 'Chairperson']]);
  const log = s.env.api.audit.entries();
  const about = (id) => log.filter((e) => e.targetId === id).map((e) => [e.action, e.actor]);
  assert.deepEqual(about(a.id), [
    ['Saved a draft rating of a job application', 'Ana Lopez'],
    ['Rated a job application', 'Ana Lopez'],
    ['Changed the rating of a job application', 'Ana Lopez'],
    ['Entered the board consensus rating of a job application', 'Hana Reyes'],
  ]);
  const rated = log.find((e) => e.targetId === a.id && e.action === 'Rated a job application');
  assert.match(rated.detail, /as a member of the selection board/);
  assert.ok(rated.changes.some((c) => c.field === 'Exam (50%)' && c.from === '80' && c.to === '82'));
  assert.match(log.find((e) => e.action === 'Entered the board consensus rating of a job application').detail, /1 of 2 assessors had rated/);
  const board = log.filter((e) => e.targetId === job.id && e.action === 'Changed the selection board of a job opening');
  assert.equal(board.length, 2);
  assert.deepEqual(board[0].changes.map((c) => [c.field, c.to]), [['Assessor added', 'Ana Lopez (Chairperson)'], ['Assessor added', 'Ben Garcia']]);
  assert.deepEqual(board[1].changes.map((c) => [c.field, c.from]), [['Assessor removed', 'Ben Garcia']]);
  assert.ok(log.some((e) => e.action === 'Fixed the assessment template of a job opening (first rating)' && /Board consensus/.test(e.detail)));
  // Each stored rating keeps who rated and when.
  const r = s.stored(a.id).ratings[0];
  assert.deepEqual([r.by, r.byId, r.slot, typeof r.at, typeof r.submittedAt], ['Ana Lopez', s.user('ana').id, s.user('ana').id, 'string', 'string']);
});

test('demo data: a selection board of three demo assessors with their own ratings on Instructor I', async () => {
  const s = await school();
  await s.admin.post('/api/admin/demo');
  const d = s.env.db.data;
  const o = d.jobOpenings.find((x) => x.demo && x.title === 'Instructor I');
  assert.deepEqual(o.panel.map((p) => [d.users.find((u) => u.id === p.userId)?.username, p.title, p.demo]), [['teacher.demo', 'Chairperson', true], ['jdelacruz.demo', 'Member', true], ['lmercado.demo', 'Member', true]]);
  const maria = await s.signIn('teacher.demo', 'demo1234');
  const todo = await maria.get('/api/hris/assess');
  assert.equal(todo.openings[0].title, 'Instructor I');
  const hr = await s.signIn('hr.demo', 'demo1234');
  const cmp = await hr.get(`/api/hris/recruitment/openings/${o.id}/comparative`);
  assert.deepEqual(cmp.rows.map((r) => [r.name, r.progress.submitted]), [['Diego Lumbres', 3], ['Teresa Malabanan', 2], ['Carla Mendiola', 1]]);
  await s.admin.del('/api/admin/demo');
  assert.ok(!s.env.db.data.jobOpenings.some((x) => x.demo));
});
