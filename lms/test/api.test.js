import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seed } from './support.js';
import { hashPassword, verifyPassword, parseCookies } from '../server/auth.js';
import { can } from '../shared/roles.js';
import { moduleOn } from '../shared/modules.js';

test('passwords and cookies', () => {
  const hash = hashPassword('correct horse');
  assert.equal(verifyPassword('correct horse', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  assert.deepEqual(parseCookies('a=1; ltdc_lms_sid=abc'), { a: '1', ltdc_lms_sid: 'abc' });
});

test('roles', () => {
  assert.equal(can('admin', 'modules.config'), true);
  assert.equal(can('registrar', 'enrollment.manage'), true);
  assert.equal(can('registrar', 'modules.config'), false);
  assert.equal(can('registrar', 'teachers.view'), true);
  assert.equal(can('registrar', 'teachers.manage'), false);
  assert.equal(can('teacher', 'dashboard'), false);
  assert.equal(moduleOn({}, 'grades', 'student'), true, 'modules added later default to on');
  assert.equal(moduleOn({ grades: { student: false, teacher: true } }, 'grades', 'student'), false);
  assert.equal(moduleOn({}, 'grades', 'admin'), false);
});

test('first run creates the administrator once', async () => {
  const env = setup();
  const admin = env.client();
  assert.equal((await admin.get('/api/admin/auth/status')).setupRequired, true);
  assert.equal((await env.client().get('/api/auth/status')).setupRequired, true);
  await admin.post('/api/admin/auth/setup', { name: 'A', username: 'admin', password: 'password123', schoolName: 'North High' });
  assert.equal((await admin.get('/api/admin/auth/status')).user.username, 'admin');
  assert.equal((await env.client().get('/api/auth/status')).schoolName, 'North High');
  await assert.rejects(env.client().post('/api/admin/auth/setup', { name: 'B', username: 'b', password: 'password123' }), /already complete/);
});

test('admin panel and portal have separate sign-ins', async () => {
  const env = setup();
  const { admin, login } = await seed(env);
  // Admins cannot sign in to the portal; students cannot sign in to the admin panel.
  await assert.rejects(env.client().post('/api/auth/login', { username: 'admin', password: 'password123' }), /sign in on the admin panel/);
  await assert.rejects(env.client().post('/api/admin/auth/login', { username: 'stud1', password: 'password123' }), /learning portal/);
  // The admin's session is not a portal session, and a student's is not an admin session.
  await assert.rejects(admin.get('/api/classes'), /Please sign in/);
  const s1 = await login('stud1');
  await assert.rejects(s1.get('/api/admin/dashboard'), /admin panel/);
  await assert.rejects(s1.get('/api/admin/users?role=student'), /admin panel/);
});

test('registrars run enrollment but cannot change modules or settings', async () => {
  const env = setup();
  const { admin } = await seed(env);
  await admin.post('/api/admin/users', { role: 'registrar', username: 'reg', name: 'Reg', password: 'password123', mustChangePassword: false });
  const reg = env.client();
  await reg.post('/api/admin/auth/login', { username: 'reg', password: 'password123' });
  await reg.get('/api/admin/enrollments');
  await reg.get('/api/admin/users?role=teacher');
  await assert.rejects(reg.put('/api/admin/modules', { config: {} }), /does not have access/);
  await assert.rejects(reg.put('/api/admin/settings', { schoolName: 'x' }), /does not have access/);
  await assert.rejects(reg.post('/api/admin/users', { role: 'teacher', username: 'tt', name: 'T', password: 'password123' }), /does not have access/);
  await assert.rejects(reg.get('/api/admin/users?role=staff'), /does not have access/);
});

test('modules switched off are hidden and refused for that account type only', async () => {
  const env = setup();
  const { admin, sections, login } = await seed(env);
  const { config } = await admin.get('/api/admin/modules');
  config.assignments.student = false;
  config.enrollment.student = false;
  await admin.put('/api/admin/modules', { config });
  const s1 = await login('stud1');
  const status = await s1.get('/api/auth/status');
  assert.equal(status.modules.includes('assignments'), false);
  assert.equal(status.modules.includes('lessons'), true);
  await assert.rejects(s1.post('/api/enrollment', { sectionId: sections.prog1.id }), /Enrollment is switched off for students/);
  // Teachers still have assignments.
  const t1 = await login('teach1');
  assert.ok((await t1.get('/api/auth/status')).modules.includes('assignments'));
  await t1.post(`/api/classes/${sections.prog1.id}/assignments`, { title: 'Essay', points: 10, published: true });
});

test('student applications: closed, apply, reviewed, admitted', async () => {
  const env = setup();
  const { admin } = await seed(env);
  const visitor = env.client();
  const form = { name: 'New Kid', username: 'newkid', email: 'new@example.com', password: 'password123' };
  await assert.rejects(visitor.post('/api/auth/apply', form), /Applications are closed/);
  await admin.put('/api/admin/settings', { registration: { open: true } });
  await visitor.post('/api/auth/apply', form);
  await assert.rejects(visitor.post('/api/auth/login', { username: 'newkid', password: 'password123' }), /still being reviewed/);
  const [applicant] = await admin.get('/api/admin/users?role=student&status=pending');
  const admitted = await admin.post(`/api/admin/users/${applicant.id}/approve`, {});
  assert.equal(admitted.status, 'active');
  assert.match(admitted.studentNo, /^\d{4}-\d{4}$/);
  assert.equal((await visitor.post('/api/auth/login', { username: 'newkid', password: 'password123' })).user.role, 'student');
});

test('classes, lessons, assignments and grades', async () => {
  const env = setup();
  const { admin, sections, students, login } = await seed(env);
  const e = await admin.post('/api/admin/enrollments', { studentId: students.s1.id, sectionId: sections.prog1.id });
  const t1 = await login('teach1');
  const t2 = await login('teach2');
  const s1 = await login('stud1');
  const s2 = await login('stud2');

  // Only the class's own teacher and students get in.
  await assert.rejects(t2.get(`/api/classes/${sections.prog1.id}`), /Class not found/);
  await assert.rejects(s2.get(`/api/classes/${sections.prog1.id}`), /not enrolled/);
  assert.equal((await s1.get('/api/classes')).length, 1);

  await t1.post(`/api/classes/${sections.prog1.id}/lessons`, { title: 'Draft', published: false });
  await t1.post(`/api/classes/${sections.prog1.id}/lessons`, { title: 'Week 1', body: 'Hello', published: true });
  assert.deepEqual((await s1.get(`/api/classes/${sections.prog1.id}/lessons`)).map((l) => l.title), ['Week 1']);
  await assert.rejects(s1.post(`/api/classes/${sections.prog1.id}/lessons`, { title: 'x' }), /Only teachers/);

  const open = await t1.post(`/api/classes/${sections.prog1.id}/assignments`, { title: 'Ex 1', points: 20, dueAt: '2026-08-20T23:59', published: true });
  const shut = await t1.post(`/api/classes/${sections.prog1.id}/assignments`, { title: 'Ex 0', points: 10, dueAt: '2026-08-01T23:59', published: true });
  await assert.rejects(s1.post(`/api/assignments/${shut.id}/submit`, { text: 'late' }), /due date has passed/);
  const sub = await s1.post(`/api/assignments/${open.id}/submit`, { text: 'my answer' });
  await assert.rejects(t1.post(`/api/submissions/${sub.id}/grade`, { score: 25 }), /between 0 and 20/);
  await t1.post(`/api/submissions/${sub.id}/grade`, { score: 15, feedback: 'ok' });
  await assert.rejects(s1.post(`/api/assignments/${open.id}/submit`, { text: 'again' }), /scored already/);

  const book = await t1.get(`/api/classes/${sections.prog1.id}/gradebook`);
  assert.equal(book.rows[0].percent, 75);
  await t1.put(`/api/classes/${sections.prog1.id}/final-grades`, { grades: [{ enrollmentId: e.id, grade: 74 }] });
  const [grade] = await s1.get('/api/my/grades');
  assert.equal(grade.finalGrade, 74);
  assert.equal(grade.passed, false, 'passing grade is 75 by default');
  assert.equal(grade.status, 'completed');
});

test('demo data is added next to real data and removed cleanly', async () => {
  const env = setup();
  const { admin } = await seed(env);
  const before = JSON.stringify({ users: env.db.data.users.length, courses: env.db.data.courses.length, sections: env.db.data.sections.length });
  const status = await admin.post('/api/admin/demo');
  assert.equal(status.loaded, true);
  assert.ok(status.counts.enrollments > 10);
  await admin.post('/api/admin/demo'); // refresh, not doubled
  assert.equal((await admin.get('/api/admin/demo')).counts.users, status.counts.users);
  const demoStudent = env.client();
  await demoStudent.post('/api/auth/login', { username: 'student.demo', password: 'demo1234' });
  // The real current term stays current; the demo term is listed next to it.
  const terms = await demoStudent.get('/api/enrollment/terms');
  assert.equal(terms.find((t) => t.current).name, 'First Semester');
  const demoTerm = terms.find((t) => t.name === 'Demo: Current Term');
  const catalog = await demoStudent.get(`/api/enrollment/catalog?termId=${demoTerm.id}`);
  assert.equal(catalog.term.open, true, 'demo enrollment is open around today');
  assert.ok(catalog.sections.length >= 8);
  await admin.del('/api/admin/demo');
  const after = JSON.stringify({ users: env.db.data.users.length, courses: env.db.data.courses.length, sections: env.db.data.sections.length });
  assert.equal(after, before);
  await assert.rejects(demoStudent.get('/api/classes'), /Please sign in/);
});
