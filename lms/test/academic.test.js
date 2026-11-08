// ATLAS Academic: curricula, student records and evaluation, the grade-sheet workflow,
// grade changes with a second approver, document requests, verifiable documents, reports, access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seed } from './support.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;

async function school(env) {
  const s = await seed(env);
  const program = await s.admin.post('/api/admin/programs', { code: 'BSIT', name: 'BS Information Technology' });
  const signIn = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: PW });
    return c;
  };
  await s.admin.post('/api/admin/users', { role: 'registrar', username: 'reg', name: 'Rita Registrar', password: PW, mustChangePassword: false });
  await s.admin.post('/api/admin/users', { role: 'dean', username: 'dean', name: 'Dan Dean', password: PW, mustChangePassword: false });
  const reg = await signIn('reg');
  const dean = await signIn('dean');
  // A 2-year curriculum: PROG1 and MATH in 1-1, PROG2 (needs PROG1) and ART in 1-2.
  let cur = await dean.post('/api/academic/curricula', { programId: program.id, series: '2026', years: 2 });
  cur = await dean.put(`/api/academic/curricula/${cur.id}`, {
    terms: [
      { year: 1, term: '1', courseIds: [s.courses.prog1.id, s.courses.math.id] },
      { year: 1, term: '2', courseIds: [s.courses.prog2.id, s.courses.art.id] },
    ],
  });
  return { ...s, program, reg, dean, signIn, cur };
}

// Final grades in Learn for a section: { studentId: percent }.
async function finalGrades(teacher, sectionId, grades) {
  const book = await teacher.get(`/api/classes/${sectionId}/gradebook`);
  await teacher.put(`/api/classes/${sectionId}/final-grades`, {
    grades: book.rows.filter((r) => r.student.id in grades).map((r) => ({ enrollmentId: r.enrollmentId, grade: grades[r.student.id] })),
  });
}

test('curricula: built term by term, prerequisite order checked, locked once posted', async () => {
  const env = setup();
  const f = await school(env);
  assert.equal(f.cur.status, 'draft');
  assert.equal(f.cur.subjects, 4);
  assert.equal(f.cur.units, 11);
  assert.deepEqual(f.cur.warnings, []);
  // PROG2 before its prerequisite: a warning.
  const bad = await f.dean.put(`/api/academic/curricula/${f.cur.id}`, { terms: [{ year: 1, term: '1', courseIds: [f.courses.prog2.id] }, { year: 1, term: '2', courseIds: [f.courses.prog1.id] }] });
  assert.match(bad.warnings[0], /PROG2: its prerequisite PROG1 comes in the same or a later term/);
  await assert.rejects(f.dean.put(`/api/academic/curricula/${f.cur.id}`, { terms: [{ year: 1, term: '1', courseIds: [f.courses.math.id, f.courses.math.id] }] }), /appears more than once/);
  await f.dean.put(`/api/academic/curricula/${f.cur.id}`, { terms: [{ year: 1, term: '1', courseIds: [f.courses.prog1.id, f.courses.math.id] }, { year: 1, term: '2', courseIds: [f.courses.prog2.id, f.courses.art.id] }] });
  await assert.rejects(f.dean.post('/api/academic/curricula', { programId: f.program.id, series: '2026' }), /already has a 2026 curriculum/);
  const posted = await f.dean.post(`/api/academic/curricula/${f.cur.id}/post`);
  assert.equal(posted.status, 'posted');
  await assert.rejects(f.dean.put(`/api/academic/curricula/${f.cur.id}`, { notes: 'x' }), /locked/);
  // A copy is a new draft with the same subjects.
  const copy = await f.dean.post('/api/academic/curricula', { programId: f.program.id, series: '2027', copyFrom: f.cur.id });
  assert.equal(copy.status, 'draft');
  assert.equal(copy.subjects, 4);
  // Students see posted curricula only; teachers and students cannot build them.
  const stud = await f.login('stud1');
  assert.deepEqual((await stud.get('/api/academic/curricula')).map((c) => c.series), ['2026']);
  await assert.rejects(stud.post('/api/academic/curricula', { programId: f.program.id, series: '2030' }), status(403));
});

test('student record: profile, curriculum, requirements and an evaluation against the curriculum', async () => {
  const env = setup();
  const f = await school(env);
  const sid = f.students.s1.id;
  await assert.rejects(f.reg.put(`/api/academic/students/${sid}`, { curriculumId: f.cur.id }), /Assign a posted curriculum/);
  await f.dean.post(`/api/academic/curricula/${f.cur.id}/post`);
  const rec = await f.reg.put(`/api/academic/students/${sid}`, {
    programId: f.program.id, curriculumId: f.cur.id, studentType: 'new', lastName: 'Reyes', firstName: 'Carlo', middleName: 'M', sex: 'Male', birthDate: '2007-04-02',
  });
  assert.deepEqual(rec.names, { last: 'Reyes', first: 'Carlo', middle: 'M' });
  assert.equal(rec.evaluation.curriculum.series, '2026');
  assert.ok(rec.requirements.length >= 4, 'new students have the admission requirements');
  const reqs = await f.reg.put(`/api/academic/students/${sid}/requirements`, { requirements: { psa: true, f138: true } });
  assert.equal(reqs.filter((r) => r.submitted).length, 2);

  // Enrolled in PROG1 and MATH this term; PROG2 waits for PROG1.
  await f.admin.post('/api/admin/enrollments', { studentId: sid, sectionId: f.sections.prog1.id });
  await f.admin.post('/api/admin/enrollments', { studentId: sid, sectionId: f.sections.art.id, force: true });
  let ev = (await f.reg.get(`/api/academic/students/${sid}`)).evaluation;
  const st = (code) => ev.blocks.flatMap((b) => b.subjects).find((x) => x.code === code);
  assert.equal(st('PROG1').status, 'enrolled');
  assert.equal(st('MATH').status, 'remaining');
  assert.equal(st('MATH').canTake, true);
  assert.equal(st('PROG2').canTake, false, 'PROG1 not passed yet');
  assert.equal(ev.totals.required, 11);
  // A final grade in Learn shows as graded (not posted yet) and opens PROG2.
  await finalGrades(await f.login('teach1'), f.sections.prog1.id, { [sid]: 91 });
  ev = (await f.reg.get(`/api/academic/students/${sid}`)).evaluation;
  assert.equal(st('PROG1').status, 'graded');
  assert.equal(st('PROG1').grade, 1.75);
  assert.equal(st('PROG2').canTake, true);
  assert.equal(ev.totals.earned, 3);

  // Credit a subject from another school.
  await f.reg.post(`/api/academic/students/${sid}/credits`, { courseId: f.courses.math.id, grade: 2.0, school: 'Bicol College', originalCode: 'MATH-1' });
  ev = (await f.reg.get(`/api/academic/students/${sid}`)).evaluation;
  assert.equal(st('MATH').status, 'credited');
  await assert.rejects(f.reg.post(`/api/academic/students/${sid}/credits`, { courseId: f.courses.math.id, grade: 2, school: 'X' }), /already passed or credited/);

  // The student sees their own record, not anyone else's.
  const stud = await f.login('stud1');
  const mine = await stud.get('/api/academic/my/record');
  assert.equal(mine.student.id, sid);
  assert.equal(mine.history, undefined, 'the audit trail is for staff');
  await assert.rejects(stud.get(`/api/academic/students/${f.students.s2.id}`), status(403));
  await assert.rejects(stud.get('/api/academic/students'), status(403));
});

test('grade sheets: teacher submits, dean approves, registrar posts to the permanent record', async () => {
  const env = setup();
  const f = await school(env);
  const t1 = await f.login('teach1');
  const [a, b] = [f.students.s1.id, f.students.s2.id];
  for (const id of [a, b]) await f.admin.post('/api/admin/enrollments', { studentId: id, sectionId: f.sections.prog1.id });
  const list = await t1.get('/api/academic/grade-sheets');
  assert.deepEqual(list.sheets.map((x) => x.code), ['PROG1', 'PROG2'], 'a teacher sees their own classes');
  await assert.rejects((await f.login('teach2')).get(`/api/academic/grade-sheets/${f.sections.prog1.id}`), status(404));

  await finalGrades(t1, f.sections.prog1.id, { [a]: 95 });
  await assert.rejects(t1.post(`/api/academic/grade-sheets/${f.sections.prog1.id}/submit`, {}), /1 student has no final grade/);
  let sheet = await t1.post(`/api/academic/grade-sheets/${f.sections.prog1.id}/submit`, { inc: [b] });
  assert.equal(sheet.status, 'submitted');
  assert.deepEqual(sheet.rows.map((r) => [r.remark, r.grade]), [['passed', 1.5], ['inc', null]]);
  await assert.rejects(t1.post(`/api/academic/grade-sheets/${f.sections.prog1.id}/submit`, { inc: [b] }), /already submitted/);

  // Registrars do not approve; deans do. Returning needs a reason.
  await assert.rejects(f.reg.post(`/api/academic/grade-sheets/${sheet.sheetId}/approve`), status(403));
  await assert.rejects(f.dean.post(`/api/academic/grade-sheets/${sheet.sheetId}/return`, {}), /Say why/);
  sheet = await f.dean.post(`/api/academic/grade-sheets/${sheet.sheetId}/return`, { note: 'Check the INC.' });
  assert.equal(sheet.status, 'returned');
  sheet = await t1.post(`/api/academic/grade-sheets/${f.sections.prog1.id}/submit`, { inc: [b] });
  await assert.rejects(f.reg.post(`/api/academic/grade-sheets/${sheet.sheetId}/post`), /Only an approved/);
  sheet = await f.dean.post(`/api/academic/grade-sheets/${sheet.sheetId}/approve`);
  sheet = await f.reg.post(`/api/academic/grade-sheets/${sheet.sheetId}/post`);
  assert.equal(sheet.status, 'posted');
  assert.deepEqual(sheet.trail.map((x) => x.action), ['Submitted', 'Returned', 'Submitted', 'Approved', 'Posted']);

  const recA = await f.reg.get(`/api/academic/students/${a}`);
  assert.equal(recA.terms[0].records[0].grade, 1.5);
  assert.equal(recA.evaluation.gwa, 1.5);
  const recB = await f.reg.get(`/api/academic/students/${b}`);
  assert.equal(recB.terms[0].records[0].remark, 'inc');
  assert.ok(recB.terms[0].records[0].incDeadline);
  assert.ok(recB.history.some((h) => /Posted PROG1: INC/.test(h.action)));
});

test('grade changes need a reason and a second person to approve; the old grade stays in the history', async () => {
  const env = setup();
  const f = await school(env);
  const t1 = await f.login('teach1');
  const a = f.students.s1.id;
  await f.admin.post('/api/admin/enrollments', { studentId: a, sectionId: f.sections.prog1.id });
  await t1.post(`/api/academic/grade-sheets/${f.sections.prog1.id}/submit`, { inc: [a] });
  const g = (await f.reg.get('/api/academic/grade-sheets')).sheets.find((x) => x.code === 'PROG1');
  await f.dean.post(`/api/academic/grade-sheets/${g.sheetId}/approve`);
  await f.reg.post(`/api/academic/grade-sheets/${g.sheetId}/post`);
  const rec = (await f.reg.get(`/api/academic/students/${a}`)).terms[0].records[0];

  await assert.rejects(f.reg.post(`/api/academic/records/${rec.id}/changes`, { percent: 88 }), /Give the reason/);
  const change = await f.reg.post(`/api/academic/records/${rec.id}/changes`, { percent: 88, reason: 'Completed the final project.' });
  assert.equal(change.kind, 'inc');
  await assert.rejects(f.reg.post(`/api/academic/records/${rec.id}/changes`, { percent: 90, reason: 'again' }), /already waiting/);
  // The administrator asks and cannot approve their own request.
  await assert.rejects(f.reg.post(`/api/academic/changes/${change.id}/approve`), status(403));
  const own = await f.dean.get('/api/academic/changes?status=pending');
  assert.equal(own.length, 1);
  await f.dean.post(`/api/academic/changes/${change.id}/approve`);
  const after = (await f.reg.get(`/api/academic/students/${a}`)).terms[0].records[0];
  assert.deepEqual([after.grade, after.remark, after.passed], [2.0, 'passed', true]);
  assert.equal(after.history[0].from.remark, 'inc');
  assert.equal(after.history[0].approvedBy, 'Dan Dean');
  // Someone who asked cannot approve their own change.
  const c2 = await f.admin.post(`/api/academic/records/${rec.id}/changes`, { percent: 92, reason: 'Recomputed.' });
  await assert.rejects(f.admin.post(`/api/academic/changes/${c2.id}/approve`), /Someone other than/);
});

test('document requests and verifiable documents', async () => {
  const env = setup();
  const f = await school(env);
  const stud = await f.login('stud1');
  const sid = f.students.s1.id;
  await assert.rejects(stud.post('/api/academic/my/requests', { type: 'cor', purpose: 'x' }), /yourself/);
  await assert.rejects(stud.post('/api/academic/my/requests', { type: 'tor', copies: 2 }), /Say what the document is for/);
  const req = await stud.post('/api/academic/my/requests', { type: 'tor', copies: 2, purpose: 'Employment' });
  assert.equal(req.fee, 300);
  assert.equal(req.status, 'requested');
  assert.match(req.refNo, /^DR\d{4}-00001$/);
  await assert.rejects(f.reg.put(`/api/academic/requests/${req.id}`, { action: 'pay' }), /O\.R\./);
  await assert.rejects(f.reg.post('/api/academic/documents', { type: 'tor', studentId: sid, requestId: req.id }), /not paid yet/);
  await f.reg.put(`/api/academic/requests/${req.id}`, { action: 'pay', orNo: '7009007' });
  await f.reg.put(`/api/academic/requests/${req.id}`, { action: 'process' });
  const doc = await f.reg.post('/api/academic/documents', { type: 'tor', studentId: sid, requestId: req.id });
  assert.match(doc.code, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  await f.reg.put(`/api/academic/requests/${req.id}`, { action: 'ready' });
  await assert.rejects(f.reg.put(`/api/academic/requests/${req.id}`, { action: 'pay', orNo: '1' }), /cannot be marked paid/);
  const done = await f.reg.put(`/api/academic/requests/${req.id}`, { action: 'release', releasedTo: 'Carlo Reyes' });
  assert.equal(done.status, 'released');
  assert.deepEqual((await stud.get('/api/academic/my/requests')).map((r) => r.status), ['released']);

  // Anyone can check a code; the student number is partly hidden.
  const anon = env.client();
  const v = await anon.get(`/api/verify/${doc.code.toLowerCase()}`);
  assert.equal(v.valid, true);
  assert.equal(v.title, 'Transcript of Records');
  assert.equal(v.student, 'stud1');
  assert.ok(!v.studentNo || v.studentNo.includes('•'));
  assert.deepEqual(await anon.get('/api/verify/0000-0000-0000'), { valid: false });

  // The student prints their own Certificate of Registration once enrolled.
  await assert.rejects(stud.post('/api/academic/my/cor'), /not enrolled/);
  await f.admin.post('/api/admin/enrollments', { studentId: sid, sectionId: f.sections.prog1.id });
  const cor = await stud.post('/api/academic/my/cor');
  assert.equal(cor.payload.units, 3);
  assert.equal((await stud.post('/api/academic/my/cor')).code, cor.code, 'the same COR while nothing changed');
  await assert.rejects((await f.login('stud2')).get(`/api/academic/documents/${cor.code}`), status(404));
});

test('reports: enrollment list, summary by program and sex, honors, candidates for graduation', async () => {
  const env = setup();
  const f = await school(env);
  await f.dean.post(`/api/academic/curricula/${f.cur.id}/post`);
  for (const [id, sex] of [[f.students.s1.id, 'Male'], [f.students.s2.id, 'Female']]) {
    await f.reg.put(`/api/academic/students/${id}`, { programId: f.program.id, curriculumId: f.cur.id, sex });
    await f.admin.post('/api/admin/enrollments', { studentId: id, sectionId: f.sections.prog1.id });
  }
  const list = await f.reg.get('/api/academic/reports/enrollment-list');
  assert.equal(list.rows.length, 2);
  assert.deepEqual(Object.keys(list.rows[0]).filter((k) => ['studentNo', 'lastName', 'firstName', 'sex', 'units', 'labUnits', 'lecUnits'].includes(k)).length, 7);
  assert.equal((await f.reg.get('/api/academic/reports/enrollment-list?sex=Female')).rows.length, 1);
  const sum = await f.reg.get('/api/academic/reports/summary');
  assert.deepEqual([sum.total, sum.male, sum.female], [2, 1, 1]);
  assert.equal(sum.table[0].program, 'BSIT');
  // Laboratory units feed the FHE billing columns.
  await f.dean.put(`/api/academic/courses/${f.courses.prog1.id}`, { labUnits: 1 });
  const lab = (await f.reg.get('/api/academic/reports/enrollment-list')).rows[0];
  assert.deepEqual([lab.units, lab.lecUnits, lab.labUnits], [3, 2, 1]);
  const dash = await f.reg.get('/api/academic/dashboard');
  assert.equal(dash.enrolled, 2);
  assert.equal(dash.sheets.total, 4);
  assert.ok(Array.isArray((await f.reg.get('/api/academic/reports/honors')).rows));
  assert.ok(Array.isArray((await f.reg.get('/api/academic/reports/graduation')).rows));
});

test('access: who may open Academic, and campus scope', async () => {
  const env = setup();
  const f = await school(env);
  // Parents and HR accounts have no Academic; teachers have no student records.
  await f.admin.post('/api/admin/guardians', { name: 'Mara Mom', username: 'mara', password: PW, mustChangePassword: false, studentId: f.students.s1.id, relationship: 'Mother' });
  const mom = await f.signIn('mara');
  const st = await mom.get('/api/academic/auth/status');
  assert.equal(st.user, null);
  assert.equal(st.deniedUser.role, 'guardian');
  await assert.rejects(mom.get('/api/academic/my/record'), status(403));
  await assert.rejects((await f.login('teach1')).get('/api/academic/students'), status(403));
  const deanStatus = await f.dean.get('/api/academic/auth/status');
  assert.deepEqual(deanStatus.permissions, ['academic.view', 'academic.curricula', 'grades.approve']);
  // The home page shows Academic, live, to students and staff.
  const hub = await (await f.signIn('stud1')).get('/api/hub/status');
  assert.deepEqual(hub.systems.find((x) => x.id === 'uis'), { ...hub.systems.find((x) => x.id === 'uis'), status: 'live', url: '/academic/' });
  // A registrar at another campus cannot open this campus's students.
  const north = await f.admin.post('/api/admin/campuses', { name: 'North Campus', code: 'NOR' });
  await f.admin.post('/api/admin/users', { role: 'registrar', username: 'reg.north', name: 'Reg North', password: PW, mustChangePassword: false, campusIds: [north.id] });
  const rn = await f.signIn('reg.north');
  assert.equal((await rn.get('/api/academic/students')).length, 0);
  await assert.rejects(rn.get(`/api/academic/students/${f.students.s1.id}`), status(404));
  const doc = await f.reg.post('/api/academic/documents', { type: 'gmc', studentId: f.students.s1.id });
  assert.equal((await f.reg.get(`/api/academic/documents/${doc.code}`)).code, doc.code);
  await assert.rejects(rn.get(`/api/academic/documents/${doc.code}`), status(404), 'not a student at their campus');
  // Settings: registrars change the scale; deans cannot.
  await assert.rejects(f.dean.put('/api/academic/settings', { incDays: 200 }), status(403));
  await assert.rejects(f.reg.put('/api/academic/settings', { scale: [{ min: 50, grade: 1, remark: 'x' }] }), /starts at 0%/);
  assert.equal((await f.reg.put('/api/academic/settings', { incDays: 200 })).incDays, 200);
});
