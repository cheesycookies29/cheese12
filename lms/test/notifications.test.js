// Notifications for every account (the bell), after CORE ERP's (test/notifications.test.js at the
// repository root): what each system tells whom, never the person who acted; only your own; mark
// read and the count; the per-person cap and age pruning; links only to pages in ATLAS; accounts
// that are deleted; backups; the demo school; the bell's wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seed } from './support.js';
import { notify, pruneNotifications, restoreNotifications, decidersFor, NOTIFY_KEEP, NOTIFY_DAYS, TITLE_MAX, BODY_MAX } from '../server/notifications.js';
import { isAtlasLink, ATLAS_HREF } from '../shared/notifications.js';
import { cleanQuickLinks } from '../server/account.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;
const list = (c, q = '') => c.get(`/api/me/notifications${q}`);
const count = async (c) => (await c.get('/api/me/notifications/count')).unread;
const newest = async (c) => (await list(c)).items[0];
const readAll = (c) => c.put('/api/me/notifications/read', { all: true });
const titles = async (c) => (await list(c)).items.map((n) => n.title);

// The seeded school (test/support.js) with a registrar and a dean, signed in.
async function school() {
  const env = setup();
  const s = await seed(env);
  const signIn = async (username, password = PW) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password });
    c.id = env.db.data.users.find((u) => u.username === username).id;
    return c;
  };
  await s.admin.post('/api/admin/users', { role: 'registrar', username: 'reg', name: 'Rita Registrar', password: PW, mustChangePassword: false });
  await s.admin.post('/api/admin/users', { role: 'dean', username: 'dean', name: 'Dan Dean', password: PW, mustChangePassword: false });
  return { env, ...s, signIn, reg: await signIn('reg'), dean: await signIn('dean'), t1: await signIn('teach1'), s1: await signIn('stud1'), s2: await signIn('stud2') };
}
// The demo school: every demo account signs in with demo1234.
async function demoSchool() {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await admin.post('/api/admin/demo');
  const as = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: 'demo1234' });
    c.id = env.db.data.users.find((u) => u.username === username).id;
    await readAll(c); // start from nothing unread
    return c;
  };
  return { env, admin, as, d: () => env.db.data };
}

test('Learn: enrollment decisions, scored and returned work, final grades (to parents whose link shares grades), admission', async () => {
  const f = await school();
  const { admin, t1, s1, s2, sections } = f;
  // Enrollment: the registrar's decision reaches the student, with the reason when declined.
  const e1 = await s1.post('/api/enrollment', { sectionId: sections.prog1.id });
  assert.equal(e1.status, 'pending');
  assert.equal(await count(admin), 0, 'a request is the registrar\'s queue, not a notification');
  await admin.post(`/api/admin/enrollments/${e1.id}/approve`, {});
  const ok = await newest(s1);
  assert.equal(ok.title, 'Ada Admin approved your enrollment in PROG1 A');
  assert.match(ok.body, /Programming 1 · First Semester/);
  assert.equal(ok.link, '/lms/#/enroll/mine');
  assert.equal(ok.system, 'lms');
  assert.equal(ok.actorName, 'Ada Admin');
  assert.equal(await count(admin), 0, 'never told of their own action');
  const e2 = await s2.post('/api/enrollment', { sectionId: sections.math.id });
  await admin.post(`/api/admin/enrollments/${e2.id}/reject`, { note: 'Take PROG1 first' });
  assert.equal((await newest(s2)).title, 'Ada Admin declined your enrollment request for MATH A');
  assert.match((await newest(s2)).body, /Reason: Take PROG1 first/);

  // Work handed in: scored (told once, not again for the same score), then returned with feedback.
  const task = await t1.post(`/api/classes/${sections.prog1.id}/assignments`, { title: 'Ex 1', points: 20, dueAt: '2026-08-20T23:59', published: true });
  const sub = await s1.post(`/api/assignments/${task.id}/submit`, { text: 'my answer' });
  assert.equal(await count(f.t1), 0, 'handing in is the teacher\'s queue');
  await t1.post(`/api/submissions/${sub.id}/grade`, { score: 15, feedback: 'Good' });
  const scored = await newest(s1);
  assert.equal(scored.title, 'Teach1 scored your work on Ex 1'.replace('Teach1', 'teach1'));
  assert.equal(scored.link, `/lms/#/assignments/${task.id}`);
  assert.doesNotMatch(`${scored.title} ${scored.body}`, /15/, 'the score is on the page, not in the text');
  const before = (await list(s1)).items.length;
  await t1.post(`/api/submissions/${sub.id}/grade`, { score: 15, feedback: 'Good' });
  assert.equal((await list(s1)).items.length, before, 'saving the same score again tells nobody');
  await t1.post(`/api/submissions/${sub.id}/grade`, { score: '', feedback: 'Add your tests and hand it in again.' });
  const back = await newest(s1);
  assert.equal(back.title, 'teach1 returned your work on Ex 1');
  assert.equal(back.body, '“Add your tests and hand it in again.”');

  // Final grade: the student, and a parent whose link shares grades; not one whose link does not.
  const mom = await admin.post('/api/admin/guardians', { name: 'Mona Mom', username: 'mom', password: PW, mustChangePassword: false, studentId: f.students.s1.id, relationship: 'Mother' });
  const dad = await admin.post('/api/admin/guardians', { name: 'Dino Dad', username: 'dad', password: PW, mustChangePassword: false, studentId: f.students.s1.id, relationship: 'Father' });
  const dadLink = f.env.db.data.guardianLinks.find((l) => l.guardianId === f.env.db.data.users.find((u) => u.username === 'dad').id);
  assert.ok(mom && dad);
  await admin.put(`/api/admin/guardian-links/${dadLink.id}`, { views: { enrollment: true, grades: false } });
  const asMom = await f.signIn('mom');
  const asDad = await f.signIn('dad');
  await t1.put(`/api/classes/${sections.prog1.id}/final-grades`, { grades: [{ enrollmentId: e1.id, grade: 91 }] });
  assert.equal((await newest(s1)).title, 'teach1 gave your final grade in PROG1 A');
  assert.equal((await newest(s1)).link, '/lms/#/grades');
  const forMom = await newest(asMom);
  assert.equal(forMom.title, 'teach1 gave stud1\'s final grade in PROG1 A');
  assert.equal(forMom.link, `/lms/#/children/${f.students.s1.id}/grades`);
  assert.doesNotMatch(`${forMom.title} ${forMom.body}`, /91/);
  assert.equal(await count(asDad), 0, 'his link does not share grades');
  await t1.put(`/api/classes/${sections.prog1.id}/final-grades`, { grades: [{ enrollmentId: e1.id, grade: 93 }] });
  assert.equal((await newest(s1)).title, 'teach1 changed your final grade in PROG1 A');
  // Grades switched off for parents: the parent is not told.
  f.env.db.data.modules.grades.guardian = false;
  await readAll(asMom);
  await t1.put(`/api/classes/${sections.prog1.id}/final-grades`, { grades: [{ enrollmentId: e1.id, grade: 94 }] });
  assert.equal(await count(asMom), 0);

  // An applicant admitted finds it waiting at the first sign-in.
  f.env.db.data.settings.registration.open = true;
  await f.env.client().post('/api/auth/apply', { name: 'Nina New', email: 'nina@example.edu', username: 'nina', password: PW });
  const nina = f.env.db.data.users.find((u) => u.username === 'nina');
  await admin.post(`/api/admin/users/${nina.id}/approve`, {});
  const asNina = await f.signIn('nina');
  const admitted = await newest(asNina);
  assert.match(admitted.title, /^You are admitted to /);
  assert.match(admitted.body, /^Student number \S+ · You can now ask to enroll in classes$/);
  assert.equal(admitted.link, '/lms/#/enroll');
});

test('Academic: grade sheets (dean, teacher, registrar, students), grade changes and document requests', async () => {
  const f = await school();
  const { admin, t1, s1, reg, dean, sections } = f;
  await admin.post('/api/admin/enrollments', { studentId: f.students.s1.id, sectionId: sections.prog1.id });
  const book = await t1.get(`/api/classes/${sections.prog1.id}/gradebook`);
  await t1.put(`/api/classes/${sections.prog1.id}/final-grades`, { grades: book.rows.map((r) => ({ enrollmentId: r.enrollmentId, grade: 88 })) });
  for (const c of [admin, t1, s1, reg, dean]) await readAll(c);
  // Submitted: the dean (who approves) is told; the administrator is not while a dean can decide.
  await t1.post(`/api/academic/grade-sheets/${sections.prog1.id}/submit`, {});
  const sub = await newest(dean);
  assert.equal(sub.title, 'teach1 submitted the grade sheet for PROG1 A');
  assert.match(sub.body, /Programming 1 · First Semester · Waiting for your approval/);
  assert.equal(sub.link, `/academic/#/grade-sheets/${sections.prog1.id}`);
  assert.equal(sub.system, 'uis');
  assert.equal(await count(admin), 0);
  assert.equal(await count(reg), 0);
  // Returned: the teacher, with the reason; resubmitted: the dean again.
  let sheet = (await t1.get(`/api/academic/grade-sheets/${sections.prog1.id}`));
  await dean.post(`/api/academic/grade-sheets/${sheet.sheetId}/return`, { note: 'Check the INC list' });
  assert.equal((await newest(t1)).title, 'Dan Dean returned your grade sheet for PROG1 A');
  assert.match((await newest(t1)).body, /Reason: Check the INC list/);
  await t1.post(`/api/academic/grade-sheets/${sections.prog1.id}/submit`, {});
  assert.equal((await newest(dean)).title, 'teach1 resubmitted the grade sheet for PROG1 A');
  // Approved: the teacher hears of it; the registrar, that it waits to be posted.
  sheet = await t1.get(`/api/academic/grade-sheets/${sections.prog1.id}`);
  await readAll(dean);
  await dean.post(`/api/academic/grade-sheets/${sheet.sheetId}/approve`);
  assert.equal((await newest(t1)).title, 'Dan Dean approved your grade sheet for PROG1 A');
  assert.equal((await newest(reg)).title, 'Dan Dean approved the grade sheet for PROG1 A');
  assert.match((await newest(reg)).body, /Waiting for you to post it/);
  assert.equal(await count(dean), 0);
  // Posted: each student, and the teacher.
  await readAll(s1);
  await reg.post(`/api/academic/grade-sheets/${sheet.sheetId}/post`);
  const posted = await newest(s1);
  assert.equal(posted.title, 'Your final grade in PROG1 is posted');
  assert.equal(posted.link, '/academic/#/me/grades');
  assert.equal((await newest(t1)).title, 'Rita Registrar posted your grade sheet for PROG1 A');
  // A grade change waits for the dean; the decision goes back to the registrar who asked.
  const rec = f.env.db.data.academicRecords.find((r) => r.studentId === f.students.s1.id);
  await reg.post(`/api/academic/records/${rec.id}/changes`, { percent: 92, reason: 'Recomputed the project.' });
  assert.equal((await newest(dean)).title, 'Rita Registrar asked to change a grade in PROG1');
  const change = f.env.db.data.gradeChanges.at(-1);
  await dean.post(`/api/academic/changes/${change.id}/reject`, { note: 'Attach the class record' });
  assert.equal((await newest(reg)).title, 'Dan Dean rejected your grade change in PROG1');
  assert.match((await newest(reg)).body, /Reason: Attach the class record/);
  // Document requests: the registrar hears of a student's; the student, of each step.
  await readAll(reg);
  const req = await s1.post('/api/academic/my/requests', { type: 'tor', purpose: 'Scholarship' });
  const filed = await newest(reg);
  assert.equal(filed.title, 'stud1 requested a Transcript of Records');
  assert.match(filed.body, new RegExp(`^${req.refNo} · To be paid at the cashier$`));
  assert.equal(filed.link, '/academic/#/requests?status=open');
  assert.doesNotMatch(filed.body, /Scholarship/, 'the purpose stays on the request');
  await reg.put(`/api/academic/requests/${req.id}`, { action: 'pay', orNo: 'OR-77' });
  assert.equal((await newest(s1)).title, `Payment for your Transcript of Records (${req.refNo}) is recorded`);
  await reg.put(`/api/academic/requests/${req.id}`, { action: 'ready' });
  assert.equal((await newest(s1)).title, `Your Transcript of Records (${req.refNo}) is ready for release`);
  assert.equal((await newest(s1)).link, '/academic/#/me/requests');
  assert.equal(await count(reg), 1, 'only the request, not their own steps on it');
});

test('People: requests reach HR and come back decided; withdrawn ones; payslips', async () => {
  const { as, d } = await demoSchool();
  const teacher = await as('teacher.demo');
  const hr = await as('hr.demo');
  const payroll = await as('payroll.demo');
  const r = await teacher.post('/api/hris/me/requests', { kind: 'remote', startDate: '2026-09-14', endDate: '2026-09-14', reason: 'Private: a family matter' });
  const n = await newest(hr);
  assert.equal(n.title, 'Maria Santos asked for 1 day of remote work');
  assert.equal(n.body, 'Sep 14, 2026 · Waiting for your approval');
  assert.equal(n.link, '/hris/#/leave?tab=requests');
  assert.equal(n.system, 'hris');
  assert.ok(!JSON.stringify(n).includes('family'), 'the reason stays on the request');
  assert.equal(await count(payroll), 0, 'payroll sees leave but does not decide it');
  await hr.post(`/api/hris/requests/${r.id}/approve`, { note: 'Enjoy' });
  const done = await newest(teacher);
  assert.equal(done.title, `${d().users.find((u) => u.username === 'hr.demo').name} approved your request for 1 day of remote work`);
  assert.match(done.body, /^Sep 14, 2026 · The days are marked remote in your attendance · Remarks: Enjoy$/);
  assert.equal(done.link, '/hris/#/me/requests');
  assert.equal(await count(hr), 1, 'only the request, not her own approval');
  // Filed, then withdrawn while it waits: HR need not decide it any more.
  await readAll(hr);
  const w = await teacher.post('/api/hris/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: '2026-09-15', endDate: '2026-09-16', reason: 'x' });
  assert.equal((await newest(hr)).title, 'Maria Santos asked for 2 days of Vacation Leave');
  await teacher.post(`/api/hris/me/requests/${w.id}/cancel`);
  assert.equal((await newest(hr)).title, 'Maria Santos withdrew a request for 2 days of Vacation Leave');
  assert.match((await newest(hr)).body, /no longer needs your approval/);
  // Rejected by HR, with the reason.
  const x = await teacher.post('/api/hris/me/requests', { kind: 'remote', startDate: '2026-09-21', endDate: '2026-09-21', reason: 'x' });
  await hr.post(`/api/hris/requests/${x.id}/reject`, { note: 'Faculty meeting that day' });
  assert.match((await newest(teacher)).title, /rejected your request for 1 day of remote work$/);
  assert.match((await newest(teacher)).body, /Reason: Faculty meeting that day/);
  // A payroll run finalized: each employee in it with an account; never the amounts; not the officer.
  await readAll(teacher);
  await readAll(hr);
  const run = await payroll.post('/api/hris/payroll-runs', { periodStart: '2026-08-01', periodEnd: '2026-08-15', payDate: '2026-08-20' });
  await payroll.post(`/api/hris/payroll-runs/${run.id}/finalize`);
  for (const c of [teacher, hr]) {
    const p = await newest(c);
    assert.equal(p.title, 'Your payslip for Aug 1, 2026 to Aug 15, 2026 is ready');
    assert.equal(p.body, 'Pay date Aug 20, 2026 · Open it under My payslips');
    assert.equal(p.link, `/hris/#/me/payslips/${run.id}`);
  }
  assert.equal(await count(payroll), 0);
});

test('Finance: purchase requests, requisitions and vouchers wait for the right office; decisions go back', async () => {
  const { as, d } = await demoSchool();
  const teacher = await as('teacher.demo');
  const head = await as('head.demo');
  const supply = await as('supply.demo');
  const accountant = await as('accountant.demo');
  const cashier = await as('cashier.demo');
  // A purchase request: the approving officer; approved: back to the requester.
  const pr = await teacher.post('/api/finance/prs', { purpose: 'Projector for room 204', items: [{ description: 'Projector', unit: 'unit', qty: 1, unitCost: 25000 }], submit: true });
  const n = await newest(head);
  assert.equal(n.title, `Maria Santos submitted purchase request ${pr.no}`);
  assert.equal(n.body, 'Projector for room 204 · Waiting for your approval');
  assert.equal(n.link, `/finance/#/prs/${pr.id}`);
  assert.equal(n.system, 'fmis');
  assert.doesNotMatch(n.body, /25,?000/, 'no amounts');
  assert.equal(await count(supply), 0);
  await head.post(`/api/finance/prs/${pr.id}/approve`);
  assert.equal((await newest(teacher)).title, `Alicia Bautista approved your purchase request ${pr.no}`);
  // A draft saved first tells nobody until it is submitted.
  const draft = await teacher.post('/api/finance/prs', { purpose: 'Chairs', items: [{ description: 'Chair', unit: 'pc', qty: 4, unitCost: 900 }] });
  await readAll(head);
  assert.equal(await count(head), 0);
  await teacher.post(`/api/finance/prs/${draft.id}/submit`);
  assert.equal((await newest(head)).title, `Maria Santos submitted purchase request ${draft.no}`);
  await head.post(`/api/finance/prs/${draft.id}/cancel`, { reason: 'Use the old chairs' });
  assert.equal((await newest(teacher)).title, `Alicia Bautista cancelled your purchase request ${draft.no}`);
  assert.match((await newest(teacher)).body, /Reason: Use the old chairs/);
  // A requisition: the supply office; issued: back to the requester.
  const item = d().finItems.find((i) => i.demo);
  const ris = await teacher.post('/api/finance/ris', { purpose: 'Class handouts', items: [{ itemId: item.id, qty: 1 }] });
  assert.equal((await newest(supply)).title, `Maria Santos asked for supplies (RIS ${ris.no})`);
  await supply.post(`/api/finance/ris/${ris.id}/issue`, {});
  assert.equal((await newest(teacher)).title, `Edgar Manalo issued the supplies on your requisition RIS ${ris.no}`);
  assert.equal((await newest(teacher)).link, `/finance/#/ris/${ris.id}`);
  // Vouchers: certified (Box C) → the approving officer; approved (Box D) → the cashier who prepared it.
  const dv = d().finDvs.find((x) => x.demo && x.status === 'certified');
  await head.post(`/api/finance/dvs/${dv.id}/approve`);
  const ready = await newest(cashier);
  assert.equal(ready.title, `Alicia Bautista approved DV ${dv.no} for payment`);
  assert.equal(ready.link, `/finance/#/dvs/${dv.id}`);
  // Submitted by the cashier: the accountant (Box C); certified: the approving officer (Box D).
  const waiting = d().finDvs.find((x) => x.demo && x.status === 'draft' && x.submitted);
  waiting.submitted = false; // taken back to the cashier's drafts, then submitted again
  await cashier.put(`/api/finance/dvs/${waiting.id}`, { submit: true });
  const toCertify = await newest(accountant);
  assert.match(toCertify.title, /^Lorna Esguerra submitted a disbursement voucher for \S/);
  assert.equal(toCertify.body, 'Waiting for your certification (Box C)');
  assert.equal(toCertify.link, `/finance/#/dvs/${waiting.id}`);
  await readAll(accountant);
  await cashier.put(`/api/finance/dvs/${waiting.id}`, { submit: true });
  assert.equal(await count(accountant), 0, 'saving a submitted voucher again tells nobody');
  await readAll(head);
  await accountant.post(`/api/finance/dvs/${waiting.id}/certify`, { docsComplete: true });
  assert.match((await newest(head)).title, /^Teresita Lopez certified DV \S+ for \S/);
  assert.equal((await newest(head)).body, 'Waiting for your approval (Box D)');
  assert.equal(await count(cashier), 1, 'the preparer hears only of the approval');
});

test('only your own: others\' items are invisible and cannot be marked read; count; paging; filters', async () => {
  const { env, as, admin } = await demoSchool();
  const teacher = await as('teacher.demo');
  const hr = await as('hr.demo');
  await teacher.post('/api/hris/me/requests', { kind: 'remote', startDate: '2026-09-28', endDate: '2026-09-28', reason: 'x' });
  const hrs = await list(hr, '?unread=1');
  assert.equal(hrs.unread, 1);
  const id = hrs.items[0].id;
  assert.ok(!(await list(teacher)).items.some((n) => n.id === id));
  const r = await teacher.put('/api/me/notifications/read', { ids: [id, 'not-a-real-id'] });
  assert.equal(r.marked, 0);
  assert.equal(await count(hr), 1);
  await assert.rejects(teacher.put('/api/me/notifications/read', { ids: 'all' }), /mark as read/);
  await assert.rejects(teacher.put('/api/me/notifications/read', { ids: [42] }), /mark as read/);
  await assert.rejects(teacher.put('/api/me/notifications/read', {}), /mark as read/);
  await assert.rejects(env.client().get('/api/me/notifications'), status(401));
  await assert.rejects(env.client().get('/api/me/notifications/count'), status(401));
  // HR marks it read.
  assert.deepEqual(await hr.put('/api/me/notifications/read', { ids: [id] }), { marked: 1, unread: 0 });
  assert.equal((await list(hr, '?unread=1')).items.length, 0);
  assert.ok((await list(hr)).items.find((n) => n.id === id).readAt);
  // Paging, newest first, and the system filter.
  const all = await list(hr, '?limit=1');
  assert.equal(all.items.length, 1);
  assert.equal(all.more, true);
  const next = await list(hr, '?limit=1&offset=1');
  assert.notEqual(next.items[0].id, all.items[0].id);
  assert.ok(next.items[0].at <= all.items[0].at);
  const people = await list(hr, '?system=hris&limit=100');
  assert.ok(people.items.length && people.items.every((n) => n.system === 'hris'));
  assert.equal((await list(hr, '?system=fmis')).items.length, 0);
  // Every side signs in to the same routes: a portal account (Learn), an admin-panel one.
  const student = await as('student.demo');
  assert.ok(Array.isArray((await list(student)).items));
  assert.equal(typeof (await count(admin)), 'number');
  // Reading is not a change: an account that only read its notifications can still be deleted.
  const temp = await admin.post('/api/system/users', { role: 'staff', username: 'temp.reader', name: 'Temp Reader', password: PW, mustChangePassword: false, campusIds: [env.db.data.campuses[0].id] });
  const asTemp = env.client();
  await asTemp.post('/api/hub/login', { username: 'temp.reader', password: PW });
  notify(env.db.data, [temp.id], { system: 'hris', title: 'Hello', link: '/hris/#/me' });
  await asTemp.put('/api/me/notifications/read', { all: true });
  await admin.del(`/api/system/users/${temp.id}`);
});

test('notify(): skips the actor, missing, inactive and repeated accounts; checks the system and link; trims text', async () => {
  const f = await school();
  const data = f.env.db.data;
  const s1 = f.students.s1.id;
  const before = data.notifications.length;
  const rows = notify(data, [s1, s1, f.t1.id, 'nobody', null], { system: 'lms', kind: 'x', title: 'T', body: 'B', link: '/lms/#/grades' }, { actorId: f.t1.id });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, s1);
  assert.equal(data.notifications.length, before + 1);
  const u = data.users.find((x) => x.id === f.students.s2.id);
  u.status = 'disabled';
  assert.equal(notify(data, [u.id], { system: 'lms', title: 'T', link: '/lms/#/grades' }).length, 0);
  u.status = 'active';
  const [long] = notify(data, [s1], { system: 'lms', title: `A ${'very '.repeat(80)}long\ntitle`, body: 'b'.repeat(1000), link: '/lms/#/grades' });
  assert.equal(long.title.length, TITLE_MAX);
  assert.ok(long.title.endsWith('…'));
  assert.equal(long.body.length, BODY_MAX);
  assert.doesNotMatch(long.title, /\n/);
  // Links: only pages in ATLAS, as Quick access accepts them (one rule, shared).
  for (const bad of ['https://evil.example/', 'javascript:alert(1)', '#/grades', '//evil.example/lms/#/x', '/lms/#/a b', '/lms/#/"><img', '/other/#/x', '', null, `/lms/#/${'a'.repeat(400)}`]) {
    assert.equal(isAtlasLink(bad), false, String(bad));
    assert.throws(() => notify(data, [s1], { system: 'lms', title: 'T', link: bad }), /page in ATLAS/);
  }
  for (const good of ['/lms/#/grades', '/admin#/enrollment', '/academic/#/grade-sheets/abc-1', '/hris/#/leave?tab=requests', '/finance/#/dvs?status=pending', '/']) assert.ok(isAtlasLink(good), good);
  assert.deepEqual(cleanQuickLinks([{ href: '/hris/#/me', label: 'Me' }]), [{ href: '/hris/#/me', label: 'Me' }]);
  assert.throws(() => cleanQuickLinks([{ href: 'https://evil.example/', label: 'x' }]), /only pages in ATLAS/);
  assert.ok(ATLAS_HREF.test('/tools/#/pdf'));
  assert.throws(() => notify(data, [s1], { system: 'crm', title: 'T', link: '/lms/#/x' }), /system/);
  assert.throws(() => notify(data, [s1], { system: 'lms', title: '  ', link: '/lms/#/x' }), /title/);
  // Who decides: the office with the permission at the campus; administrators only when nobody else can.
  assert.deepEqual(decidersFor(data, 'grades.approve', { campusId: data.campuses[0].id }), [f.dean.id]);
  data.users.find((x) => x.id === f.dean.id).status = 'disabled';
  assert.deepEqual(decidersFor(data, 'grades.approve', { campusId: data.campuses[0].id }), [data.users.find((x) => x.role === 'admin').id]);
});

test('each person keeps their newest 200, nothing older than 60 days', async () => {
  const f = await school();
  const data = f.env.db.data;
  const s1 = f.students.s1.id;
  const now = new Date('2026-08-10T10:00:00').getTime(); // the test server's clock
  const others = data.notifications.filter((n) => n.userId !== s1).length;
  const old = new Date(now - (NOTIFY_DAYS + 1) * 86400000).toISOString();
  data.notifications.push({ id: 'ancient', userId: s1, system: 'lms', kind: 'x', title: 'Old', body: '', link: '/lms/#/grades', actorId: null, at: old, readAt: null });
  for (let i = 0; i < NOTIFY_KEEP + 5; i++) notify(data, [s1], { system: 'lms', kind: 'x', title: `N${i}`, link: '/lms/#/grades' }, { at: new Date(now - (NOTIFY_KEEP + 5 - i) * 1000).toISOString(), nowMs: now });
  const mine = data.notifications.filter((n) => n.userId === s1);
  assert.equal(mine.length, NOTIFY_KEEP);
  assert.ok(!mine.some((n) => n.id === 'ancient'), 'older than 60 days: gone');
  assert.ok(mine.some((n) => n.title === `N${NOTIFY_KEEP + 4}`) && !mine.some((n) => n.title === 'N0'), 'the oldest went');
  assert.equal(data.notifications.filter((n) => n.userId !== s1).length, others, 'others keep theirs');
  const first = await list(f.s1, '?limit=500');
  assert.equal(first.items.length, 100, 'at most 100 a page');
  assert.equal(first.more, true);
  assert.equal(first.unread, NOTIFY_KEEP);
  // Reading the list prunes what got old since (the server's time).
  assert.equal(pruneNotifications([{ userId: 'a', at: old }], now).length, 0);
  const same = [{ userId: 'a', at: new Date(now).toISOString() }];
  assert.equal(pruneNotifications(same, now), same, 'nothing to prune: the same list');
});

test('a deleted account takes its notifications, and is no longer named in others\'', async () => {
  const f = await school();
  const { admin, env } = f;
  // An unused account (no records), told of something and named in someone else's.
  const temp = await admin.post('/api/admin/users', { role: 'student', username: 'temp', name: 'Temp Student', password: PW, mustChangePassword: false });
  notify(env.db.data, [temp.id], { system: 'lms', title: 'For temp', link: '/lms/#/grades' });
  notify(env.db.data, [f.students.s1.id], { system: 'uis', title: 'By temp', link: '/academic/#/me/requests' }, { actorId: temp.id });
  assert.equal((await newest(f.s1)).actorName, 'Temp Student');
  await admin.del(`/api/system/users/${temp.id}`);
  assert.ok(!env.db.data.notifications.some((n) => n.userId === temp.id || n.actorId === temp.id));
  const kept = await newest(f.s1);
  assert.equal(kept.title, 'By temp');
  assert.equal(kept.actorId, null);
  // The Admin panel's delete does the same.
  const temp2 = await admin.post('/api/admin/users', { role: 'student', username: 'temp2', name: 'Temp Two', password: PW, mustChangePassword: false });
  notify(env.db.data, [temp2.id], { system: 'lms', title: 'For temp2', link: '/lms/#/grades' });
  await admin.del(`/api/admin/users/${temp2.id}`);
  assert.ok(!env.db.data.notifications.some((n) => n.userId === temp2.id));
});

test('backup and restore: valid notifications come back, anything else is left out', async () => {
  const f = await school();
  const { admin, env } = f;
  notify(env.db.data, [f.students.s1.id], { system: 'lms', title: 'Keep me', body: 'ok', link: '/lms/#/grades' }, { actorId: f.t1.id });
  const backup = await admin.get('/api/admin/backup');
  const good = backup.notifications.find((n) => n.title === 'Keep me');
  assert.ok(good);
  const row = (over) => ({ ...good, id: `x-${Math.random().toString(36).slice(2)}`, ...over });
  backup.notifications.push(
    row({ title: 'Bad link', link: 'https://evil.example/' }),
    row({ title: 'Script link', link: 'javascript:alert(1)' }),
    row({ title: 'Nobody', userId: 'no-such-user' }),
    row({ title: 'Bad system', system: 'crm' }),
    row({ title: 'No date', at: 'yesterday' }),
    row({ title: '' }),
    row({ title: 'Gone actor', actorId: 'no-such-user' }),
    row({ title: `Long ${'x'.repeat(500)}` }),
    { ...good }, // the same id twice
    'not a row', null, [1, 2],
  );
  await admin.post('/api/admin/restore', backup);
  const back = env.db.data.notifications;
  assert.deepEqual(back.map((n) => n.title.slice(0, 9)).sort(), ['Gone acto', 'Keep me', 'Long xxxx']);
  assert.equal(back.find((n) => n.title === 'Gone actor').actorId, null);
  assert.equal(back.find((n) => n.title.startsWith('Long')).title.length, TITLE_MAX);
  assert.equal(back.find((n) => n.title === 'Keep me').actorId, f.t1.id);
  // A backup from before notifications: none.
  const older = await admin.get('/api/admin/backup');
  delete older.notifications;
  await admin.post('/api/admin/restore', older);
  assert.deepEqual(env.db.data.notifications, []);
  // The validator on its own: a list that is not a list.
  const data = { users: [], notifications: 'nope' };
  restoreNotifications(data);
  assert.deepEqual(data.notifications, []);
});

test('the demo school: a few for each demo account, marked demo, removed with the demo; real ones stay', async () => {
  const { env, admin, d } = await demoSchool();
  const demo = [...d().notifications];
  assert.ok(demo.length >= 15);
  assert.ok(demo.every((n) => n.demo === true && isAtlasLink(n.link)));
  const users = (n) => d().users.find((u) => u.id === n.userId)?.username;
  for (const username of ['student.demo', 'parent.demo', 'teacher.demo', 'dean.demo', 'registrar.demo', 'hr.demo', 'head.demo', 'accountant.demo', 'supply.demo']) {
    assert.ok(demo.some((n) => users(n) === username), `${username} has notifications`);
  }
  assert.deepEqual([...new Set(demo.map((n) => n.system))].sort(), ['fmis', 'hris', 'lms', 'uis']);
  assert.ok(demo.some((n) => n.readAt) && demo.some((n) => !n.readAt));
  // The demo's own making (Finance's routes) left nothing of its own behind: only the demo set.
  const adminId = d().users.find((u) => u.username === 'admin').id;
  assert.equal(demo.filter((n) => n.userId === adminId).length, 0);
  // A real notification for the administrator stays when the demo goes; the demo's go.
  notify(d(), [adminId], { system: 'lms', title: 'Real', link: '/admin#/enrollment' }, { actorId: d().users.find((u) => u.username === 'registrar.demo').id });
  await admin.post('/api/admin/demo'); // refreshed: the same set again, not doubled
  assert.equal(d().notifications.filter((n) => n.demo).length, demo.length);
  await admin.del('/api/admin/demo');
  assert.deepEqual(d().notifications.map((n) => [n.title, n.actorId]), [['Real', null]]);
  assert.ok(env);
});

test('the bell: badge text, its label, relative times and day groups', async () => {
  const { badgeText, bellLabel, relTime, dayGroup, groupByDay } = await import('../public/js/account/notify-format.js');
  assert.equal(badgeText(0), '0');
  assert.equal(badgeText(7), '7');
  assert.equal(badgeText(99), '99');
  assert.equal(badgeText(100), '99+');
  assert.equal(bellLabel(3), 'Notifications, 3 unread');
  assert.equal(bellLabel(0), 'Notifications');
  const now = new Date(2026, 10, 13, 15, 0).getTime(); // Nov 13, 2026, 3 pm where the browser is
  const at = (day, h, m = 0) => new Date(2026, 10, day, h, m).toISOString();
  assert.equal(relTime(new Date(now - 20000).toISOString(), now), 'Just now');
  assert.equal(relTime(at(13, 14, 55), now), '5 min ago');
  assert.equal(relTime(at(13, 9), now), '6 h ago');
  assert.equal(relTime(at(12, 23), now), 'Yesterday');
  assert.match(relTime(at(3, 9), now), /Nov\s+3/);
  assert.match(relTime(new Date(2025, 10, 3).toISOString(), now), /2025/);
  assert.equal(relTime('not a date', now), '');
  assert.equal(dayGroup(at(13, 0, 1), now), 'Today');
  assert.equal(dayGroup(at(12, 0, 1), now), 'Yesterday');
  assert.equal(dayGroup(at(11, 23), now), 'Earlier');
  const groups = groupByDay([{ at: at(13, 10) }, { at: at(13, 8) }, { at: at(12, 9) }, { at: at(1, 9) }], now);
  assert.deepEqual(groups.map(([g, l]) => [g, l.length]), [['Today', 2], ['Yesterday', 1], ['Earlier', 1]]);
});
