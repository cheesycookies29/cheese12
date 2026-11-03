import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seed } from './support.js';
import { memoryDb } from '../server/db.js';

test('data from before campuses moves into a "Main Campus"', () => {
  const db = memoryDb({ users: [{ id: 'a', role: 'admin' }, { id: 's', role: 'student' }], sections: [{ id: 'x' }], news: [{ id: 'n' }] });
  const [main] = db.data.campuses;
  assert.equal(main.name, 'Main Campus');
  assert.deepEqual(db.data.users.find((u) => u.id === 's').campusIds, [main.id]);
  assert.equal(db.data.users.find((u) => u.id === 'a').campusIds, undefined, 'administrators reach every campus');
  assert.equal(db.data.sections[0].campusId, main.id);
  assert.equal(db.data.news[0].campusId, null, 'old news is for every campus');
});

// Campus A (the seed's, renamed Pili) and campus B (Sipocot) with its own registrar, teacher, student and section.
async function twoCampuses(env) {
  const s = await seed(env);
  const [a] = (await s.admin.get('/api/admin/campuses'));
  await s.admin.put(`/api/admin/campuses/${a.id}`, { name: 'Pili Campus', code: 'PIL' });
  const b = await s.admin.post('/api/admin/campuses', { name: 'Sipocot Campus', code: 'SIP' });
  await assert.rejects(s.admin.post('/api/admin/campuses', { name: 'sipocot campus' }), /already a campus/);
  await s.admin.post('/api/admin/auth/campus', { campusId: b.id });
  const mk = (role, username, extra = {}) => s.admin.post('/api/admin/users', { role, username, name: username, password: 'password123', mustChangePassword: false, ...extra });
  const regB = await mk('registrar', 'reg.b');
  const teachB = await mk('teacher', 'teach.b');
  const studB = await mk('student', 'stud.b');
  const both = await mk('teacher', 'teach.both', { campusIds: [a.id, b.id] });
  const secB = await s.admin.post('/api/admin/sections', { courseId: s.courses.math.id, termId: s.term.id, name: 'B1', teacherId: teachB.id, capacity: 20, meetings: [{ day: 2, start: '13:00', end: '14:00' }] });
  await assert.rejects(s.admin.post('/api/admin/sections', { courseId: s.courses.art.id, termId: s.term.id, name: 'B2', teacherId: s.teachers.t1.id, capacity: 20, meetings: [] }), /does not teach at Sipocot Campus/);
  const secBoth = await s.admin.post('/api/admin/sections', { courseId: s.courses.art.id, termId: s.term.id, name: 'B3', teacherId: both.id, capacity: 20, meetings: [{ day: 4, start: '13:00', end: '14:00' }] });
  await s.admin.post('/api/admin/auth/campus', { campusId: a.id });
  await mk('registrar', 'reg.a');
  return { ...s, a, b, regB, teachB, studB, both, secB, secBoth };
}

test('each campus keeps its own people, sections and enrollments', async () => {
  const env = setup();
  const c = await twoCampuses(env);
  const regA = env.client();
  await regA.post('/api/hub/login', { username: 'reg.a', password: 'password123' });
  const studentsA = (await regA.get('/api/admin/users?role=student')).map((u) => u.username);
  assert.deepEqual(studentsA.sort(), ['stud1', 'stud2', 'stud3']);
  await assert.rejects(regA.get(`/api/admin/users/${c.studB.id}`), /not found/);
  await assert.rejects(regA.get(`/api/admin/sections/${c.secB.id}`), /Switch to that campus/);
  assert.equal((await regA.get('/api/admin/sections')).some((s) => s.id === c.secB.id), false);
  await assert.rejects(regA.post('/api/admin/auth/campus', { campusId: c.b.id }), /do not have access/);
  await assert.rejects(regA.post('/api/admin/users', { role: 'student', username: 'xyz1', name: 'X', password: 'password123', campusIds: [c.b.id] }), /your own campuses/);

  // Students see and request only their campus's sections.
  const sb = env.client();
  await sb.post('/api/hub/login', { username: 'stud.b', password: 'password123' });
  const catalog = await sb.get('/api/enrollment/catalog');
  assert.deepEqual(catalog.sections.map((s) => s.id).sort(), [c.secB.id, c.secBoth.id].sort());
  await assert.rejects(sb.post('/api/enrollment', { sectionId: c.sections.prog1.id }), /This section is at Pili Campus; stud.b studies at Sipocot Campus/);
  const e = await sb.post('/api/enrollment', { sectionId: c.secB.id });

  // Campus B's request is invisible to campus A's registrar, and B's registrar handles it.
  assert.equal((await regA.get('/api/admin/enrollments?status=pending')).length, 0);
  await assert.rejects(regA.post(`/api/admin/enrollments/${e.id}/approve`, {}), /another campus/);
  const regB = env.client();
  await regB.post('/api/hub/login', { username: 'reg.b', password: 'password123' });
  assert.equal((await regB.get('/api/admin/enrollments/summary')).pending, 1);
  await regB.post(`/api/admin/enrollments/${e.id}/approve`, {});
});

test('switching campus: dashboards and a teacher at two campuses', async () => {
  const env = setup();
  const c = await twoCampuses(env);
  assert.equal((await c.admin.get('/api/admin/dashboard')).campus, 'Pili Campus');
  const status = await c.admin.get('/api/admin/auth/status');
  assert.deepEqual(status.campuses.map((x) => x.name), ['Pili Campus', 'Sipocot Campus']);
  await c.admin.post('/api/admin/auth/campus', { campusId: c.b.id });
  const dash = await c.admin.get('/api/admin/dashboard');
  assert.deepEqual([dash.campus, dash.students, dash.sections], ['Sipocot Campus', 1, 2]);

  const t = env.client();
  await t.post('/api/hub/login', { username: 'teach.both', password: 'password123' });
  const hub = await t.get('/api/hub/status');
  assert.equal(hub.campuses.length, 2);
  assert.equal(hub.campusName, 'Pili Campus');
  assert.equal((await t.get('/api/classes')).length, 0);
  await t.post('/api/auth/campus', { campusId: c.b.id });
  assert.deepEqual((await t.get('/api/classes')).map((x) => x.id), [c.secBoth.id]);
  assert.equal((await t.get('/api/auth/status')).campusName, 'Sipocot Campus', 'the choice is remembered');
});

test('news and events: one campus or every campus', async () => {
  const env = setup();
  const c = await twoCampuses(env);
  await c.admin.post('/api/admin/news', { title: 'For Pili only' });
  await c.admin.post('/api/admin/news', { title: 'For everyone', allCampuses: true });
  await c.admin.post('/api/admin/events', { title: 'Pili fair', startDate: '2026-08-20' });
  const s1 = await c.login('stud1');
  assert.deepEqual((await s1.get('/api/news')).map((n) => n.title).sort(), ['For Pili only', 'For everyone']);
  const sb = env.client();
  await sb.post('/api/hub/login', { username: 'stud.b', password: 'password123' });
  assert.deepEqual((await sb.get('/api/news')).map((n) => n.title), ['For everyone']);
  assert.deepEqual(await sb.get('/api/events'), []);
  // Registrars post for their own campus, never for every campus.
  const regB = env.client();
  await regB.post('/api/hub/login', { username: 'reg.b', password: 'password123' });
  const p = await regB.post('/api/admin/news', { title: 'Sipocot notice', allCampuses: true });
  assert.equal(p.campusId, c.b.id);
  const everyone = (await regB.get('/api/admin/news')).find((n) => n.title === 'For everyone');
  await assert.rejects(regB.del(`/api/admin/news/${everyone.id}`), /Only administrators/);
});

test('demo data adds three campuses next to yours and takes them away again', async () => {
  const env = setup();
  const { admin } = await seed(env);
  const before = (await admin.get('/api/admin/campuses')).length;
  await admin.post('/api/admin/demo');
  const campuses = await admin.get('/api/admin/campuses');
  assert.equal(campuses.length, before + 3);
  assert.ok(campuses.every((c) => c.students > 0), 'every campus has students');
  const t = env.client();
  await t.post('/api/hub/login', { username: 'teacher.demo', password: 'demo1234' });
  const st = await t.get('/api/hub/status');
  assert.deepEqual(st.campuses.map((x) => x.name).slice(-1), ['Sipocot Campus']);
  await t.post('/api/auth/campus', { campusId: st.campuses.find((x) => x.name === 'Sipocot Campus').id });
  assert.deepEqual((await t.get('/api/classes?termId=all')).map((x) => `${x.course.code} ${x.name}`), ['IT101 S1']);
  await admin.del('/api/admin/demo');
  assert.equal((await admin.get('/api/admin/campuses')).length, before);
});
