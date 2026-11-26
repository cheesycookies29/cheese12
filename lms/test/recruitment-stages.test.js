// Recruitment stages and the applicant's progress tracker (HRIS request PL-015): a lookup list of
// in-progress stages HR orders, renames and retires (never deletes once used), fixed final outcomes,
// the move from the old statuses, each application's history, what the applicant sees (and never
// sees), moving forward, back with a reason, and several at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { memoryDb } from '../server/db.js';
import { DEFAULT_STAGES, DEFAULT_OUTCOMES, LEGACY_STATUSES, migrateApplications, mergeRecruitmentStages, trackerOf } from '../shared/recruitment.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;

async function school({ db } = {}) {
  let now = Date.parse('2026-11-03T10:00:00');
  const env = setup({ clock: () => new Date(now), options: { rateLimits: 'off' }, ...(db ? { db } : {}) });
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
  const eliEmp = await employee({ firstName: 'Eli', lastName: 'Cruz', position: 'Administrative Aide IV' });
  await admin.post(`/api/hris/employees/${eliEmp.id}/account`, { role: 'staff', username: 'eli', password: PW, mustChangePassword: false });
  const hr = await signIn('hana');
  const opening = (extra = {}) => hr.post('/api/hris/recruitment/openings', {
    title: 'Instructor I', salaryGrade: 12, education: "Master's degree", vacancies: 2, closingDate: '2026-12-20', audience: 'all', status: 'open', ...extra,
  });
  let n = 0;
  const signUp = async (name = `Applicant ${++n}`) => {
    const username = `app${++n}`;
    const c = env.client();
    await c.post('/api/jobs/signup', { name, email: `${username}@example.com`, username, password: 'longenough1', consent: true });
    await c.post('/api/hub/login', { username, password: 'longenough1' });
    return c;
  };
  const user = (username) => env.db.data.users.find((u) => u.username === username);
  const stored = (id) => env.db.data.jobApplications.find((a) => a.id === id);
  const move = (id, body) => hr.put(`/api/hris/recruitment/applications/${id}`, body);
  const stages = () => hr.get('/api/hris/recruitment/stages');
  const body = (v) => ({ stages: v.stages.map(({ id, label, description, retired }) => ({ id, label, description, retired })), outcomes: v.outcomes.map(({ id, label, description, retired }) => ({ id, label, description, retired })) });
  return { env, admin, signIn, hr, opening, signUp, user, stored, move, stages, body, clock: { add: (ms) => (now += ms) } };
}

test('the default stages: the usual merit selection flow, then the fixed final outcomes', async () => {
  const s = await school();
  const v = await s.stages();
  assert.deepEqual(v.stages.map((x) => x.label), ['Application received', 'Initial screening', 'Assessment (examination or interview)', 'Deliberation', 'Final decision']);
  assert.ok(v.stages.every((x) => x.description && x.meaning === 'in-progress' && !x.retired && x.used === 0));
  assert.deepEqual(v.outcomes.map((x) => [x.id, x.label, x.meaning]), [['selected', 'Selected', 'selected'], ['not-qualified', 'Not qualified', 'not-selected'], ['not-selected', 'Not selected', 'not-selected'], ['withdrawn', 'Withdrawn', 'withdrawn']]);
  assert.deepEqual(v.outcomes.filter((x) => x.optional).map((x) => x.id), ['not-qualified']);
  assert.equal(v.outcomes.find((x) => x.id === 'withdrawn').applicantOnly, true);
  assert.deepEqual(v.defaults.stages, DEFAULT_STAGES);
  assert.deepEqual(v.defaults.outcomes, DEFAULT_OUTCOMES);
});

test('stage settings: checked, added, renamed, reordered, retired; a used stage is never deleted; the outcomes are fixed', async () => {
  const s = await school();
  const v = s.body(await s.stages());
  const put = (next) => s.hr.put('/api/hris/recruitment/stages', next);
  const withStages = (stages) => ({ ...v, stages });
  // Checks.
  await assert.rejects(put(withStages([...v.stages, { label: '' }])), /needs a label/);
  await assert.rejects(put(withStages([...v.stages, { label: 'x'.repeat(61) }])), /at most 60 characters/);
  await assert.rejects(put(withStages([...v.stages, { label: 'Background check', description: 'y'.repeat(401) }])), /at most 400 characters/);
  await assert.rejects(put(withStages([...v.stages, { label: 'initial SCREENING' }])), /Two stages or outcomes are called/);
  await assert.rejects(put(withStages([...v.stages, { label: 'Hired' , id: 'selected' }])), /cannot be used/);
  await assert.rejects(put(withStages([...v.stages, { label: 'Hmm', id: 'Bad Id!' }])), /cannot be used/);
  await assert.rejects(put(withStages([...v.stages, { ...v.stages[0], label: 'Copy' }])), /in the list twice/);
  await assert.rejects(put(withStages(v.stages.map((x) => ({ ...x, retired: true })))), /at least one stage that is not retired/);
  await assert.rejects(put(withStages(Array.from({ length: 21 }, (_, i) => ({ label: `Stage ${i}` })))), /At most 20 stages/);
  await assert.rejects(put({ ...v, outcomes: v.outcomes.slice(0, 3) }), /final outcomes are fixed/);
  await assert.rejects(put({ ...v, outcomes: [...v.outcomes, { id: 'pooled', label: 'Pooled' }] }), /final outcomes are fixed/);
  await assert.rejects(put({ ...v, outcomes: v.outcomes.map((x) => (x.id === 'selected' ? { ...x, retired: true } : x)) }), /fixed outcome and cannot be retired/);
  await assert.rejects(put({ ...v, outcomes: v.outcomes.map((x) => (x.id === 'withdrawn' ? { ...x, label: '' } : x)) }), /needs a label/);
  await assert.rejects((await s.signIn('eli')).put('/api/hris/recruitment/stages', v), status(403));

  // Add one (its id is made from its label), rename, reorder, and relabel an outcome: its meaning stays.
  const added = await put({
    stages: [v.stages[0], { label: 'Background check', description: 'HR checks your references.' }, v.stages[1], v.stages[2], { ...v.stages[3], label: 'Board deliberation' }, v.stages[4]],
    outcomes: v.outcomes.map((x) => (x.id === 'selected' ? { ...x, label: 'Hired' } : x)),
  });
  assert.deepEqual(added.stages.map((x) => x.id), ['received', 'background-check', 'screening', 'assessment', 'deliberation', 'final-decision']);
  assert.equal(added.stages[4].label, 'Board deliberation');
  assert.deepEqual([added.outcomes[0].id, added.outcomes[0].label, added.outcomes[0].meaning], ['selected', 'Hired', 'selected']);
  // A stage no application has used can be removed outright.
  const v2 = s.body(added);
  const removed = await put({ ...v2, stages: v2.stages.filter((x) => x.id !== 'background-check') });
  assert.equal(removed.stages.length, 5);

  // Once used, it can only be retired: kept in its place, out of the moves, still in the history.
  const job = await s.opening();
  const c = await s.signUp('Carla Mendiola');
  const a = await c.post(`/api/hris/jobs/${job.id}/apply`, {});
  await s.move(a.id, { stage: 'screening' });
  await s.move(a.id, { stage: 'assessment' });
  const v3 = s.body(await s.stages());
  assert.equal((await s.stages()).stages.find((x) => x.id === 'screening').used, 1);
  await assert.rejects(put({ ...v3, stages: v3.stages.filter((x) => x.id !== 'screening') }), /Initial screening has been used by 1 application: retire it instead/);
  const retired = await put({ ...v3, stages: v3.stages.map((x) => (x.id === 'screening' ? { ...x, retired: true } : x)) });
  assert.equal(retired.stages.find((x) => x.id === 'screening').retired, true);
  const detail = await s.hr.get(`/api/hris/recruitment/openings/${job.id}`);
  assert.equal(detail.applications[0].history[1].stageLabel, 'Initial screening', 'the history keeps its meaning');
  // A retired stage takes no new applications and no moves; going back skips it.
  await assert.rejects(s.move(a.id, { stage: 'screening', reason: 'Wrong stage' }), /retired/);
  const back = await s.move(a.id, { stage: 'received', reason: 'Moved by mistake: the transcript is still missing.' });
  assert.equal(back.stage, 'received');
  // The applicant's tracker still shows the retired stage they passed through.
  const mine = await c.get(`/api/hris/my-applications/${a.id}`);
  assert.equal(mine.tracker.steps.find((x) => x.id === 'screening')?.label, undefined, 'after going back, the retired stage not reached this round is not shown as to come');
  // The first stage that is not retired is where new applications start.
  const v4 = s.body(await s.stages());
  await put({ ...v4, stages: v4.stages.map((x) => (x.id === 'received' ? { ...x, retired: true } : x)) });
  const d = await (await s.signUp()).post(`/api/hris/jobs/${job.id}/apply`, {});
  assert.equal(d.stage, 'assessment', 'received and screening are retired: assessment is the first stage now');
  // The optional outcome Not qualified can be retired; then it is not offered.
  const v5 = s.body(await s.stages());
  await put({ ...v5, outcomes: v5.outcomes.map((x) => (x.id === 'not-qualified' ? { ...x, retired: true } : x)) });
  await assert.rejects(s.move(d.id, { stage: 'not-qualified' }), /retired/);
});

test('the Settings center: Recruitment stages under ATLAS People, its history, and restore defaults', async () => {
  const s = await school();
  const v = s.body(await s.stages());
  await s.hr.put('/api/hris/recruitment/stages', { ...v, stages: [...v.stages, { label: 'Background check', description: '' }] });
  const config = await s.admin.get('/api/admin/config');
  const area = config.areas.find((a) => a.id === 'recruitmentStages');
  assert.deepEqual([area.module, area.label, area.screen, area.resettable], ['people', 'Recruitment stages', '/hris/#/settings?section=stages', true]);
  const row = config.settings.find((x) => x.area === 'recruitmentStages' && x.path === 'stages');
  assert.equal(row.changed, true);
  assert.equal(row.format, 'stages');
  const history = await s.admin.get('/api/admin/config/history?area=recruitmentStages');
  assert.equal(history.entries[0].by, 'Hana Reyes');
  // Restoring the defaults removes the unused stage; once a stage is used, the restore is refused.
  await s.admin.post('/api/admin/config/reset', { area: 'recruitmentStages', path: 'stages' });
  assert.equal((await s.stages()).stages.length, 5);
  await s.hr.put('/api/hris/recruitment/stages', { ...v, stages: [...v.stages, { label: 'Background check', description: '' }] });
  const job = await s.opening();
  const a = await (await s.signUp()).post(`/api/hris/jobs/${job.id}/apply`, {});
  await s.move(a.id, { stage: 'background-check' });
  await assert.rejects(s.admin.post('/api/admin/config/reset', { area: 'recruitmentStages' }), /Background check has been used/);
  assert.equal((await s.stages()).stages.length, 6, 'nothing changed');
});

test('migration: the old statuses move to the stages with their history, and the mapping is kept in the code', async () => {
  // Data from before the stages, as the earlier version kept it.
  const at = (d) => `2026-10-${String(d).padStart(2, '0')}T02:00:00.000Z`;
  const old = (id, statusNow, history, extra = {}) => ({ id, openingId: 'o1', userId: `u-${id}`, internal: false, employeeId: null, note: '', status: statusNow, statusNote: '', createdAt: at(1), updatedAt: history.at(-1)?.at || at(1), history, ...extra });
  const initial = {
    jobOpenings: [{ id: 'o1', title: 'Instructor I', status: 'open', audience: 'all', closingDate: '2026-12-31' }],
    jobApplications: [
      old('a1', 'received', [{ status: 'received', at: at(1), self: true }]),
      old('a2', 'review', [{ status: 'received', at: at(1), self: true }, { status: 'review', at: at(3), by: 'Josefina Dimaculangan', note: 'Send your transcript.' }], { statusNote: 'Send your transcript.' }),
      old('a3', 'shortlisted', [{ status: 'received', at: at(1), self: true }, { status: 'review', at: at(2), by: 'H' }, { status: 'shortlisted', at: at(4), by: 'H', note: 'Interview on Monday.' }]),
      old('a4', 'selected', [{ status: 'received', at: at(1), self: true }, { status: 'selected', at: at(5), by: 'H' }]),
      old('a5', 'not-selected', [{ status: 'received', at: at(1), self: true }, { status: 'not-selected', at: at(5), by: 'H' }]),
      old('a6', 'withdrawn', [{ status: 'received', at: at(1), self: true }, { status: 'withdrawn', at: at(2), self: true }]),
      old('a7', 'review', [], { statusNote: 'Kept without a history.' }),
    ],
  };
  const db = memoryDb(structuredClone(initial)); // normalize runs the migration
  const apps = Object.fromEntries(db.data.jobApplications.map((a) => [a.id, a]));
  assert.deepEqual(Object.values(apps).map((a) => [a.id, a.stage, a.status]), [
    ['a1', 'received', 'in-progress'], ['a2', 'screening', 'in-progress'], ['a3', 'assessment', 'in-progress'],
    ['a4', 'selected', 'selected'], ['a5', 'not-selected', 'not-selected'], ['a6', 'withdrawn', 'withdrawn'], ['a7', 'screening', 'in-progress'],
  ]);
  // Nothing is lost: every entry, its date, who, and the note to the applicant.
  assert.deepEqual(apps.a3.history.map((h) => [h.stage, h.at, h.by || (h.self && 'self'), h.note || '']), [
    ['received', at(1), 'self', ''], ['screening', at(2), 'H', ''], ['assessment', at(4), 'H', 'Interview on Monday.'],
  ]);
  assert.equal(apps.a2.history[1].by, 'Josefina Dimaculangan');
  assert.equal(apps.a2.legacyStatus, 'review');
  assert.equal(apps.a1.history[0].applied, true);
  assert.deepEqual(apps.a6.history.map((h) => h.stage), ['received', 'withdrawn']);
  // An application without a history starts it at the migration, with its current state.
  assert.deepEqual(apps.a7.history.map((h) => [h.stage, h.migrated, h.note]), [['screening', true, 'Kept without a history.']]);
  // Running it again changes nothing.
  const before = JSON.stringify(db.data.jobApplications);
  assert.equal(migrateApplications(db.data), 0);
  assert.equal(JSON.stringify(db.data.jobApplications), before);
  // The mapping, in the code.
  const cfg = mergeRecruitmentStages();
  assert.deepEqual(Object.fromEntries(Object.entries(LEGACY_STATUSES).map(([k, f]) => [k, f(cfg)])), {
    received: 'received', review: 'screening', shortlisted: 'assessment', selected: 'selected', 'not-selected': 'not-selected', withdrawn: 'withdrawn',
  });
  // The migrated applications work on: the tracker and the HR moves.
  const t = trackerOf(db.data.settings.recruitmentStages, apps.a3);
  assert.deepEqual(t.steps.map((x) => x.state), ['done', 'done', 'current', 'next', 'next']);
});

test('history: each change keeps the stage, date and time, the HR person, the note to the applicant and the internal remark', async () => {
  const s = await school();
  const job = await s.opening();
  const c = await s.signUp('Carla Mendiola');
  const a = await c.post(`/api/hris/jobs/${job.id}/apply`, { note: 'Hello' });
  s.clock.add(3600e3);
  await s.move(a.id, { stage: 'screening', note: 'Please send your transcript.', remark: 'Called her school to confirm the degree.' });
  s.clock.add(3600e3);
  await s.move(a.id, { stage: 'screening', note: 'Thank you, we have it.' }); // a note at the same stage
  await assert.rejects(s.move(a.id, { stage: 'screening' }), /Pick another stage, or write a note/);
  s.clock.add(3600e3);
  const hr = await s.move(a.id, { stage: 'assessment', remark: 'Strong application.' });
  const h = s.stored(a.id).history;
  assert.deepEqual(h.map((x) => [x.stage, x.by || 'self', x.note || '', x.remark || '']), [
    ['received', 'self', '', ''],
    ['screening', 'Hana Reyes', 'Please send your transcript.', 'Called her school to confirm the degree.'],
    ['screening', 'Hana Reyes', 'Thank you, we have it.', ''],
    ['assessment', 'Hana Reyes', '', 'Strong application.'],
  ]);
  assert.ok(h.every((x) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(x.at)), 'date and time');
  assert.equal(h[1].byId, s.user('hana').id);
  assert.deepEqual(hr.history.map((x) => x.by), ['Applicant', 'Hana Reyes', 'Hana Reyes', 'Hana Reyes']);
  assert.equal(hr.history[1].remark, 'Called her school to confirm the degree.', 'HR sees its own remarks');
  // The audit log has each change; a remark alone tells the applicant nothing.
  const audit = s.env.api.audit.entries().filter((e) => e.targetId === a.id);
  assert.deepEqual(audit.map((e) => e.action).reverse(), ['Moved a job application to another stage', 'Added a note to a job application', 'Moved a job application to another stage']);
  assert.ok(audit.some((e) => e.changes.some((x) => x.field === 'Internal remark' && x.to === 'Strong application.')));
  const bell = s.env.db.data.notifications.filter((n) => n.userId === s.stored(a.id).userId);
  assert.equal(bell.length, 3, 'two moves and one note');
});

test('the applicant sees the stages, dates and notes from "HR office", never the internal remarks or the HR person; the bell links to the page', async () => {
  const s = await school();
  const job = await s.opening();
  const c = await s.signUp('Carla Mendiola');
  const a = await c.post(`/api/hris/jobs/${job.id}/apply`, {});
  await s.move(a.id, { stage: 'screening', note: 'Please send your transcript.', remark: 'SECRET-REMARK about her references.' });
  s.clock.add(86400e3);
  await s.move(a.id, { stage: 'assessment', note: 'Interview on Monday at 9:00.' });
  const mine = await c.get(`/api/hris/my-applications/${a.id}`);
  assert.deepEqual(mine.tracker.steps.map((x) => [x.label, x.state, Boolean(x.at)]), [
    ['Application received', 'done', true], ['Initial screening', 'done', true], ['Assessment (examination or interview)', 'current', true], ['Deliberation', 'next', false], ['Final decision', 'next', false],
  ]);
  assert.deepEqual([mine.tracker.step, mine.tracker.of], [3, 5]);
  assert.match(mine.tracker.current.description, /examination/);
  assert.equal(mine.tracker.outcome, null);
  assert.deepEqual(mine.notes.map((x) => [x.stage, x.note, x.from]), [['Initial screening', 'Please send your transcript.', 'HR office'], ['Assessment (examination or interview)', 'Interview on Monday at 9:00.', 'HR office']]);
  assert.ok(mine.notes[0].at < mine.notes[1].at, 'in time order');
  for (const view of [mine, await c.get('/api/hris/my-applications'), await c.get(`/api/hris/jobs/${job.id}`)]) {
    const json = JSON.stringify(view);
    assert.ok(!json.includes('SECRET-REMARK'), 'never the internal remark');
    assert.ok(!json.includes('Hana'), 'never the HR person');
    assert.ok(!json.includes('remark') && !json.includes('byId'), 'no remark or HR fields at all');
  }
  // The bell: each change, linked to the application's page.
  const bell = s.env.db.data.notifications.filter((n) => n.userId === s.stored(a.id).userId && n.kind === 'job.status');
  assert.ok(bell.every((n) => n.link === `/hris/#/jobs/mine/${a.id}`));
  assert.ok(bell.every((n) => !JSON.stringify(n).includes('SECRET-REMARK')));
  assert.ok(bell.every((n) => n.actorId === null), 'no actor on the bell: it would show the HR person\'s name');
  const shown = await c.get('/api/me/notifications');
  assert.ok(JSON.stringify(shown).includes('Your application for Instructor I'), 'the bell as the applicant reads it');
  assert.ok(!JSON.stringify(shown).includes('Hana'), 'never the HR person\'s name');
  // Decided: the outcome ends the tracker, the stages never reached are left out.
  await s.move(a.id, { stage: 'not-qualified', note: 'The position needs a completed master\'s degree.' });
  const decided = await c.get(`/api/hris/my-applications/${a.id}`);
  assert.deepEqual(decided.tracker.steps.map((x) => [x.label, x.state]), [['Application received', 'done'], ['Initial screening', 'done'], ['Assessment (examination or interview)', 'done'], ['Not qualified', 'outcome']]);
  assert.deepEqual([decided.tracker.outcome.label, decided.tracker.outcome.meaning, decided.status], ['Not qualified', 'not-selected', 'not-selected']);
  await assert.rejects(c.post(`/api/hris/my-applications/${a.id}/withdraw`), /decided/);
  // A skipped stage shows as skipped.
  const b = await (await s.signUp()).post(`/api/hris/jobs/${job.id}/apply`, {});
  await s.move(b.id, { stage: 'deliberation' });
  const t = s.env.db.data.jobApplications.find((x) => x.id === b.id);
  assert.deepEqual(trackerOf(s.env.db.data.settings.recruitmentStages, t).steps.map((x) => x.state), ['done', 'skipped', 'skipped', 'current', 'next']);
});

test('an internal applicant (an employee) sees the same tracker', async () => {
  const s = await school();
  const job = await s.opening({ audience: 'internal', title: 'Administrative Officer II' });
  const eli = await s.signIn('eli');
  const a = await eli.post(`/api/hris/jobs/${job.id}/apply`, {});
  await s.move(a.id, { stage: 'screening', note: 'Your service record is complete.', remark: 'INTERNAL-ONLY' });
  const mine = await eli.get(`/api/hris/my-applications/${a.id}`);
  assert.equal(mine.internal, true);
  assert.deepEqual(mine.tracker.steps.map((x) => x.state), ['done', 'current', 'next', 'next', 'next']);
  assert.equal(mine.notes[0].from, 'HR office');
  assert.ok(!JSON.stringify(mine).includes('INTERNAL-ONLY'));
});

test('access: another person\'s application is "not found", and only HR moves applications', async () => {
  const s = await school();
  const job = await s.opening();
  const carla = await s.signUp('Carla Mendiola');
  const a = await carla.post(`/api/hris/jobs/${job.id}/apply`, {});
  const other = await s.signUp('Other Person');
  await assert.rejects(other.get(`/api/hris/my-applications/${a.id}`), status(404));
  await assert.rejects((await s.signIn('eli')).get(`/api/hris/my-applications/${a.id}`), status(404));
  await assert.rejects(s.hr.get(`/api/hris/my-applications/${a.id}`), status(404), 'not through the applicant\'s route either');
  await assert.rejects(carla.put(`/api/hris/recruitment/applications/${a.id}`, { stage: 'selected' }), status(403));
  await assert.rejects(carla.post(`/api/hris/recruitment/openings/${job.id}/move`, { ids: [a.id], stage: 'selected' }), status(403));
  await assert.rejects(carla.get('/api/hris/recruitment/stages'), status(403));
  await assert.rejects(s.env.client().get(`/api/hris/my-applications/${a.id}`), status(401));
});

test('moving: any later stage, back one stage only with a reason (audited), an outcome; a decided one goes back to where it was', async () => {
  const s = await school();
  const job = await s.opening();
  const a = await (await s.signUp('Carla Mendiola')).post(`/api/hris/jobs/${job.id}/apply`, {});
  const moved = await s.move(a.id, { stage: 'deliberation' });
  assert.deepEqual(moved.moves, { forward: ['final-decision'], outcomes: ['selected', 'not-qualified', 'not-selected'], back: 'assessment' });
  await assert.rejects(s.move(a.id, { stage: 'assessment' }), /reason for moving it back/);
  await assert.rejects(s.move(a.id, { stage: 'received', reason: 'x' }), /back one stage at a time: to Assessment/);
  const back = await s.move(a.id, { stage: 'assessment', reason: 'The interview has not been held yet.', note: 'We will tell you the interview date.' });
  assert.equal(back.stage, 'assessment');
  assert.deepEqual([back.history.at(-1).back, back.history.at(-1).reason], [true, 'The interview has not been held yet.']);
  const entry = s.env.api.audit.entries().find((e) => e.action === 'Moved a job application back a stage');
  assert.deepEqual(entry.changes.slice(0, 2), [{ field: 'Stage', from: 'Deliberation', to: 'Assessment (examination or interview)' }, { field: 'Reason for moving back', from: '', to: 'The interview has not been held yet.' }]);
  assert.match(s.env.db.data.notifications.at(-1).body, /We will tell you the interview date/);
  // An outcome; then only back to the stage before it, with a reason; never to another outcome directly.
  await s.move(a.id, { stage: 'selected' });
  await assert.rejects(s.move(a.id, { stage: 'not-selected' }), /already decided \(Selected\)/);
  await assert.rejects(s.move(a.id, { stage: 'received', reason: 'x' }), /only go back to Assessment/);
  await assert.rejects(s.move(a.id, { stage: 'assessment' }), /reason/);
  const reopened = await s.move(a.id, { stage: 'assessment', reason: 'Selected the wrong applicant by mistake.' });
  assert.deepEqual([reopened.stage, reopened.status], ['assessment', 'in-progress']);
  // The status names from before the stages still work, mapped as the migration maps them.
  const c2 = await (await s.signUp()).post(`/api/hris/jobs/${job.id}/apply`, {});
  assert.equal((await s.move(c2.id, { status: 'shortlisted' })).stage, 'assessment');
  await assert.rejects(s.move(c2.id, { status: 'withdrawn' }), /Only the applicant/);
  // At the first stage there is nothing to go back to.
  const b = await (await s.signUp()).post(`/api/hris/jobs/${job.id}/apply`, {});
  await assert.rejects(s.move(b.id, { stage: 'received', reason: 'x' }), /Pick another stage, or write a note/);
});

test('bulk move: several applications to one opening, to one stage with one note; all or nothing; never back', async () => {
  const s = await school();
  const job = await s.opening();
  const other = await s.opening({ title: 'Laboratory Technician I' });
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await (await s.signUp(`Person ${i}`)).post(`/api/hris/jobs/${job.id}/apply`, {})).id);
  const elsewhere = (await (await s.signUp('Elsewhere')).post(`/api/hris/jobs/${other.id}/apply`, {})).id;
  const bulk = (body) => s.hr.post(`/api/hris/recruitment/openings/${job.id}/move`, body);
  await assert.rejects(bulk({ ids: [], stage: 'screening' }), /Tick the applications/);
  await assert.rejects(bulk({ ids: [...ids, elsewhere], stage: 'screening' }), /Nothing was moved\. An application: Application not found in this opening/);
  const out = await bulk({ ids, stage: 'assessment', note: 'The examination is on Nov 20 at 9:00 at the HR office.' });
  assert.deepEqual(out, { moved: 3, stage: 'Assessment (examination or interview)' });
  for (const id of ids) {
    const a = s.stored(id);
    assert.equal(a.stage, 'assessment');
    assert.deepEqual([a.history.at(-1).note, a.history.at(-1).bulk], ['The examination is on Nov 20 at 9:00 at the HR office.', true]);
  }
  const told = s.env.db.data.notifications.filter((n) => n.kind === 'job.status');
  assert.equal(told.length, 3);
  assert.ok(told.every((n) => n.body === 'Note from HR: The examination is on Nov 20 at 9:00 at the HR office.' && /\/hris\/#\/jobs\/mine\/.+/.test(n.link)));
  assert.equal(s.env.api.audit.entries().filter((e) => e.action === 'Moved a job application to another stage' && /3 applications at once/.test(e.detail)).length, 3);
  // One already there, or one that cannot move: nothing moves, and HR is told which.
  await s.move(ids[0], { stage: 'deliberation' });
  await assert.rejects(bulk({ ids, stage: 'deliberation' }), (e) => /Nothing was moved\. Person 0: already at Deliberation/.test(e.message));
  assert.equal(s.stored(ids[1]).stage, 'assessment');
  await assert.rejects(bulk({ ids: [ids[0]], stage: 'assessment' }), /one at a time/);
  // Counts per stage on the opening.
  await bulk({ ids: ids.slice(1), stage: 'not-selected' });
  const detail = await s.hr.get(`/api/hris/recruitment/openings/${job.id}`);
  assert.deepEqual(detail.counts.byStage, { deliberation: 1, 'not-selected': 2 });
  assert.deepEqual(detail.counts.byStatus, { 'in-progress': 1, selected: 0, 'not-selected': 2, withdrawn: 0 });
  assert.deepEqual(detail.stages.stages.map((x) => x.id), ['received', 'screening', 'assessment', 'deliberation', 'final-decision']);
  assert.equal((await s.hr.get('/api/hris/recruitment/openings')).find((o) => o.id === job.id).counts.byStage.deliberation, 1);
});

test('withdrawing and sending again: the applicant\'s own steps; the tracker starts over at the first stage', async () => {
  const s = await school();
  const job = await s.opening();
  const c = await s.signUp('Carla Mendiola');
  const a = await c.post(`/api/hris/jobs/${job.id}/apply`, {});
  await s.move(a.id, { stage: 'screening', note: 'First note.' });
  const w = await c.post(`/api/hris/my-applications/${a.id}/withdraw`);
  assert.deepEqual([w.stage, w.status, w.tracker.outcome.label], ['withdrawn', 'withdrawn', 'Withdrawn']);
  await assert.rejects(s.move(a.id, { stage: 'assessment' }), /withdrew/);
  const again = await c.post(`/api/hris/jobs/${job.id}/apply`, {});
  assert.equal(again.stage, 'received');
  assert.deepEqual(again.tracker.steps.map((x) => x.state), ['current', 'next', 'next', 'next', 'next']);
  assert.equal(again.notes.length, 1, 'the earlier notes stay');
});

test('demo data: applications at every stage, with notes, all marked demo', async () => {
  const s = await school();
  await s.admin.post('/api/admin/demo');
  const apps = s.env.db.data.jobApplications;
  assert.ok(apps.length >= 6 && apps.every((a) => a.demo));
  const stagesUsed = new Set(apps.map((a) => a.stage));
  for (const id of ['received', 'screening', 'assessment', 'deliberation', 'not-qualified']) assert.ok(stagesUsed.has(id), id);
  assert.ok(apps.some((a) => a.history.some((h) => h.note)) && apps.some((a) => a.history.some((h) => h.remark)));
  assert.ok(s.env.db.data.users.filter((u) => u.role === 'applicant').every((u) => u.demo));
  const carla = s.env.client();
  await carla.post('/api/hub/login', { username: 'applicant.demo', password: 'demo1234' });
  const [mine] = (await carla.get('/api/hris/my-applications')).applications;
  assert.equal(mine.tracker.current.label, 'Assessment (examination or interview)');
  assert.equal(mine.notes.length, 2);
  assert.ok(!JSON.stringify(mine).includes('Josefina') && !JSON.stringify(mine).includes('teaching demonstration'));
  await s.admin.del('/api/admin/demo');
  assert.equal(s.env.db.data.jobApplications.length, 0);
  assert.equal(s.env.db.data.users.filter((u) => u.role === 'applicant').length, 0);
});
