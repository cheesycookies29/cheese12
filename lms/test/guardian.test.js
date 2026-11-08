// Parents & guardians: accounts, links with chosen views, read-only access to linked
// students only, module switches, students seeing who is linked, campus scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seed } from './support.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;

async function family(env) {
  const s = await seed(env);
  // stud1 asks for MATH: a pending request the parent can follow.
  await (await s.login('stud1')).post('/api/enrollment', { sectionId: s.sections.math.id });
  const mother = await s.admin.post('/api/admin/guardians', {
    name: 'Mara Mom', username: 'mara', email: 'mara@example.com', phone: '0917 555 0100', password: PW, mustChangePassword: false,
    studentId: s.students.s1.id, relationship: 'Mother', views: { enrollment: true, schedule: true, grades: true, attendance: true, activities: true },
  });
  const signIn = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: PW });
    return c;
  };
  return { ...s, mother, signIn };
}

test('a guardian signs in on the portal and follows only the linked student', async () => {
  const env = setup();
  const f = await family(env);
  assert.equal(f.mother.children.length, 1);
  const mom = await f.signIn('mara');
  const st = await mom.get('/api/auth/status');
  assert.equal(st.user.role, 'guardian');
  assert.deepEqual(st.children.map((c) => [c.name, c.relationship]), [['stud1', 'Mother']]);
  const hub = await mom.get('/api/hub/status');
  assert.deepEqual(hub.systems.filter((x) => x.status === 'live').map((x) => [x.id, x.url]), [['lms', '/lms/']]);

  const [kid] = await mom.get('/api/guardian/children');
  assert.equal(kid.student.id, f.students.s1.id);
  assert.equal(kid.enrollment.pending, 1);
  assert.ok(kid.alerts.some((a) => /enrollment request/.test(a.text)));
  const detail = await mom.get(`/api/guardian/children/${f.students.s1.id}`);
  assert.deepEqual(detail.views, ['enrollment', 'schedule', 'grades', 'attendance', 'activities']);
  assert.equal(detail.enrollment[0].status, 'pending');
  assert.equal(detail.enrollment[0].section.course.code, 'MATH');
  // Not another student, and none of the students' or teachers' own pages.
  await assert.rejects(mom.get(`/api/guardian/children/${f.students.s2.id}`), status(404));
  for (const url of ['/api/home', '/api/classes', '/api/schedule', `/api/classes/${f.sections.math.id}`, '/api/my/grades', '/api/enrollment/mine']) {
    await assert.rejects(mom.get(url), status(403), url);
  }
  await assert.rejects(mom.post('/api/enrollment', { sectionId: f.sections.art.id }), status(403));
  assert.ok(Array.isArray(await mom.get('/api/news')), 'school news is open to guardians');
  // Students and teachers cannot use the guardian pages.
  await assert.rejects((await f.login('stud1')).get('/api/guardian/children'), status(403));
});

test('each link shares only the chosen views; the Modules switch can turn a view off for all guardians', async () => {
  const env = setup();
  const f = await family(env);
  const mom = await f.signIn('mara');
  const [link] = (await f.admin.get(`/api/admin/students/${f.students.s1.id}/guardians`));
  await f.admin.put(`/api/admin/guardian-links/${link.id}`, { views: { grades: true, attendance: true } });
  let d = await mom.get(`/api/guardian/children/${f.students.s1.id}`);
  assert.deepEqual(d.views, ['grades', 'attendance']);
  assert.equal(d.enrollment, undefined);
  assert.equal(d.schedule, undefined);
  assert.ok(Array.isArray(d.grades));

  const { config } = await f.admin.get('/api/admin/modules');
  config.grades.guardian = false;
  await f.admin.put('/api/admin/modules', { config });
  d = await mom.get(`/api/guardian/children/${f.students.s1.id}`);
  assert.deepEqual(d.views, ['attendance']);
  assert.ok((await f.login('stud1')).get('/api/my/grades'), 'students keep their grades');

  // Paused: the student disappears from the guardian's list.
  await f.admin.put(`/api/admin/guardian-links/${link.id}`, { status: 'paused' });
  assert.equal((await mom.get('/api/guardian/children')).length, 0);
  await assert.rejects(mom.get(`/api/guardian/children/${f.students.s1.id}`), status(404));
});

test('students see who is linked to them and when they last looked', async () => {
  const env = setup();
  const f = await family(env);
  const kid = await f.login('stud1');
  let mine = await kid.get('/api/my/guardians');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, 'Mara Mom');
  assert.equal(mine[0].lastViewedAt, null);
  await (await f.signIn('mara')).get(`/api/guardian/children/${f.students.s1.id}`);
  mine = await kid.get('/api/my/guardians');
  assert.ok(mine[0].lastViewedAt);
  assert.equal((await (await f.login('stud2')).get('/api/my/guardians')).length, 0);
});

test('linking rules: no duplicates, a second child, unlinking, deleting the account', async () => {
  const env = setup();
  const f = await family(env);
  await assert.rejects(f.admin.post('/api/admin/guardian-links', { guardianId: f.mother.id, studentId: f.students.s1.id }), /already linked/);
  const second = await f.admin.post('/api/admin/guardian-links', { guardianId: f.mother.id, studentId: f.students.s2.id, relationship: 'Aunt / Uncle' });
  assert.deepEqual(Object.values(second.views), [true, true, true, true, true], 'a new link shares everything unless told otherwise');
  const mom = await f.signIn('mara');
  assert.equal((await mom.get('/api/guardian/children')).length, 2);
  await f.admin.del(`/api/admin/guardian-links/${second.id}`);
  assert.equal((await mom.get('/api/guardian/children')).length, 1);
  // Guardians cannot be linked to a teacher, and teachers cannot be linked as guardians.
  await assert.rejects(f.admin.post('/api/admin/guardian-links', { guardianId: f.mother.id, studentId: f.teachers.t1.id }), status(404));
  await assert.rejects(f.admin.post('/api/admin/guardian-links', { guardianId: f.teachers.t1.id, studentId: f.students.s2.id }), status(404));
  await f.admin.del(`/api/admin/users/${f.mother.id}`);
  assert.equal(env.db.data.guardianLinks.length, 0);
  await assert.rejects(mom.get('/api/guardian/children'), status(401));
});

test('registrars manage guardians for students at their own campuses only', async () => {
  const env = setup();
  const f = await family(env);
  const b = await f.admin.post('/api/admin/campuses', { name: 'North Campus', code: 'NOR' });
  await f.admin.post('/api/admin/users', { role: 'registrar', username: 'reg.north', name: 'Reg North', password: PW, mustChangePassword: false, campusIds: [b.id] });
  const regNorth = env.client();
  await regNorth.post('/api/admin/auth/login', { username: 'reg.north', password: PW });
  assert.equal((await regNorth.get('/api/admin/guardians')).length, 0);
  await assert.rejects(regNorth.get(`/api/admin/guardians/${f.mother.id}`), status(404));
  await assert.rejects(regNorth.get(`/api/admin/students/${f.students.s1.id}/guardians`), status(404));
  await assert.rejects(regNorth.post('/api/admin/guardians', { name: 'X Y', username: 'xy.parent', password: PW, studentId: f.students.s1.id }), status(404));
  // A registrar at the student's campus can.
  await f.admin.post('/api/admin/users', { role: 'registrar', username: 'reg.main', name: 'Reg Main', password: PW, mustChangePassword: false });
  const regMain = env.client();
  await regMain.post('/api/admin/auth/login', { username: 'reg.main', password: PW });
  assert.equal((await regMain.get('/api/admin/guardians')).length, 1);
  const dad = await regMain.post('/api/admin/guardians', { name: 'Dan Dad', username: 'dan.dad', password: PW, studentId: f.students.s1.id, relationship: 'Father', views: { grades: true } });
  assert.deepEqual(dad.children[0].views, { enrollment: false, schedule: false, grades: true, attendance: false, activities: false });
  // Teachers cannot manage guardians.
  await assert.rejects((await f.login('teach1')).get('/api/admin/guardians'), status(401));
});
