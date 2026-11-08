import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seed } from './support.js';
import { meetingsClash, formatMeetings } from '../shared/schedule.js';

test('meeting clashes', () => {
  const a = [{ day: 1, start: '09:00', end: '10:30' }];
  assert.equal(meetingsClash(a, [{ day: 1, start: '10:00', end: '11:00' }]), true);
  assert.equal(meetingsClash(a, [{ day: 1, start: '10:30', end: '12:00' }]), false, 'back-to-back classes do not clash');
  assert.equal(meetingsClash(a, [{ day: 2, start: '09:00', end: '10:30' }]), false);
  assert.equal(formatMeetings([{ day: 3, start: '09:00', end: '10:30' }, { day: 1, start: '09:00', end: '10:30' }]), 'Mon/Wed 9:00 AM–10:30 AM');
});

test('request needs approval, then the registrar approves it', async () => {
  const env = setup();
  const { admin, sections, login } = await seed(env);
  const s1 = await login('stud1');
  const e = await s1.post('/api/enrollment', { sectionId: sections.prog1.id });
  assert.equal(e.status, 'pending');
  const approved = await admin.post(`/api/admin/enrollments/${e.id}/approve`, {});
  assert.equal(approved.status, 'enrolled');
  assert.deepEqual(approved.history.map((h) => h.status), ['pending', 'enrolled']);
});

test('without approval, requests enroll at once', async () => {
  const env = setup();
  const { admin, sections, login } = await seed(env);
  await admin.put('/api/admin/settings', { enrollment: { requireApproval: false, allowWaitlist: true, waitlistLimit: 0, maxUnits: 24 } });
  const s1 = await login('stud1');
  assert.equal((await s1.post('/api/enrollment', { sectionId: sections.prog1.id })).status, 'enrolled');
});

test('full section → waitlist, and a drop moves the first in line up', async () => {
  const env = setup();
  const { sections, login } = await seed(env);
  const [a, b, c] = [await login('stud1'), await login('stud2'), await login('stud3')];
  const ea = await a.post('/api/enrollment', { sectionId: sections.prog1.id });
  await b.post('/api/enrollment', { sectionId: sections.prog1.id });
  const ec = await c.post('/api/enrollment', { sectionId: sections.prog1.id }); // capacity 2: pending seats count
  assert.equal(ec.status, 'waitlisted');
  assert.equal(ec.position, 1);
  await a.post(`/api/enrollment/${ea.id}/drop`);
  const mine = await c.get('/api/enrollment/mine');
  assert.equal(mine[0].status, 'pending', 'moved up into the freed seat');
  assert.match(mine[0].history.at(-1).note, /waitlist/);
});

test('waitlist off or full refuses the request', async () => {
  const env = setup();
  const { admin, sections, login } = await seed(env);
  await admin.put('/api/admin/settings', { enrollment: { requireApproval: true, allowWaitlist: true, waitlistLimit: 1, maxUnits: 24 } });
  for (const u of ['stud1', 'stud2']) await (await login(u)).post('/api/enrollment', { sectionId: sections.prog1.id });
  const extra = await admin.post('/api/admin/users', { role: 'student', username: 'stud4', name: 'Four', password: 'password123', mustChangePassword: false });
  await (await login('stud3')).post('/api/enrollment', { sectionId: sections.prog1.id }); // waitlist slot 1 of 1
  await assert.rejects((await login('stud4')).post('/api/enrollment', { sectionId: sections.prog1.id }), /waitlist are full/);
  await admin.put('/api/admin/settings', { enrollment: { requireApproval: true, allowWaitlist: false, waitlistLimit: 0, maxUnits: 24 } });
  await assert.rejects((await login('stud4')).post('/api/enrollment', { sectionId: sections.prog1.id }), /This section is full/);
  // The registrar can still enroll over capacity.
  const forced = await admin.post('/api/admin/enrollments', { studentId: extra.id, sectionId: sections.prog1.id, force: true });
  assert.equal(forced.status, 'enrolled');
});

test('prerequisites must be passed first', async () => {
  const env = setup();
  const { admin, sections, students, login } = await seed(env);
  const s1 = await login('stud1');
  await assert.rejects(s1.post('/api/enrollment', { sectionId: sections.prog2.id }), /PROG2 requires PROG1 first/);
  // Took PROG1 last term and passed.
  const past = await admin.post('/api/admin/enrollments', { studentId: students.s1.id, sectionId: sections.pastProg1.id });
  const t2 = await login('teach2');
  await t2.put(`/api/classes/${sections.pastProg1.id}/final-grades`, { grades: [{ enrollmentId: past.id, grade: 90 }] });
  assert.equal((await s1.post('/api/enrollment', { sectionId: sections.prog2.id })).status, 'pending');
  // ...and cannot take PROG1 again.
  await assert.rejects(s1.post('/api/enrollment', { sectionId: sections.prog1.id }), /Already passed PROG1/);
});

test('a failing grade does not satisfy a prerequisite', async () => {
  const env = setup();
  const { admin, sections, students, login } = await seed(env);
  const past = await admin.post('/api/admin/enrollments', { studentId: students.s1.id, sectionId: sections.pastProg1.id });
  await (await login('teach2')).put(`/api/classes/${sections.pastProg1.id}/final-grades`, { grades: [{ enrollmentId: past.id, grade: 60 }] });
  await assert.rejects((await login('stud1')).post('/api/enrollment', { sectionId: sections.prog2.id }), /requires PROG1/);
});

test('schedule conflicts, unit limit and duplicates are refused', async () => {
  const env = setup();
  const { admin, sections, login } = await seed(env);
  const s1 = await login('stud1');
  await s1.post('/api/enrollment', { sectionId: sections.prog1.id });
  await assert.rejects(s1.post('/api/enrollment', { sectionId: sections.math.id }), /Schedule conflict with PROG1 A/);
  await assert.rejects(s1.post('/api/enrollment', { sectionId: sections.prog1.id }), /Already pending approval in PROG1/);
  await admin.put('/api/admin/settings', { enrollment: { requireApproval: true, allowWaitlist: true, waitlistLimit: 0, maxUnits: 4 } });
  await assert.rejects(s1.post('/api/enrollment', { sectionId: sections.art.id, key: 'PAINT' }), /5 units this term; the limit is 4/);
});

test('enrollment window and enrollment key', async () => {
  const closed = setup({ today: '2026-09-01' });
  const a = await seed(closed);
  await assert.rejects((await a.login('stud1')).post('/api/enrollment', { sectionId: a.sections.prog1.id }), /Enrollment for First Semester is closed/);
  // The registrar can still add students after the window.
  const e = await a.admin.post('/api/admin/enrollments', { studentId: a.students.s1.id, sectionId: a.sections.prog1.id });
  assert.equal(e.status, 'enrolled');

  const env = setup();
  const { sections, login } = await seed(env);
  const s1 = await login('stud1');
  await assert.rejects(s1.post('/api/enrollment', { sectionId: sections.art.id }), /needs an enrollment key/);
  await assert.rejects(s1.post('/api/enrollment', { sectionId: sections.art.id, key: 'nope' }), /not correct/);
  assert.equal((await s1.post('/api/enrollment', { sectionId: sections.art.id, key: 'PAINT' })).status, 'pending');
  // The catalog never reveals the key.
  const catalog = await s1.get('/api/enrollment/catalog');
  const art = catalog.sections.find((s) => s.id === sections.art.id);
  assert.equal(art.needsKey, true);
  assert.equal('enrollmentKey' in art, false);
});

test('catalog explains why a section is not available', async () => {
  const env = setup();
  const { sections, login } = await seed(env);
  const s1 = await login('stud1');
  const { sections: list } = await s1.get('/api/enrollment/catalog');
  const prog2 = list.find((s) => s.id === sections.prog2.id);
  assert.equal(prog2.eligibility.ok, false);
  assert.match(prog2.eligibility.reason, /requires PROG1/);
  assert.equal(list.find((s) => s.id === sections.art.id).eligibility.ok, true, 'a keyed section is still shown as available');
});

test('drop deadline applies to enrolled classes, not to pending requests', async () => {
  const env = setup({ today: '2026-08-10' });
  const { admin, sections, students } = await seed(env);
  const e = await admin.post('/api/admin/enrollments', { studentId: students.s1.id, sectionId: sections.prog1.id });
  const later = setup({ today: '2026-09-05' });
  later.db.replace(env.db.data);
  const s1 = later.client();
  await s1.post('/api/auth/login', { username: 'stud1', password: 'password123' });
  await assert.rejects(s1.post(`/api/enrollment/${e.id}/drop`), /drop deadline/);
});

test('cancelling a section drops its students; raising capacity promotes the waitlist', async () => {
  const env = setup();
  const { admin, sections, login } = await seed(env);
  for (const u of ['stud1', 'stud2', 'stud3']) await (await login(u)).post('/api/enrollment', { sectionId: sections.prog1.id });
  const sec = await admin.get(`/api/admin/sections/${sections.prog1.id}`);
  assert.equal(sec.waitlisted, 1);
  const body = { ...sec, capacity: 3 };
  const raised = await admin.put(`/api/admin/sections/${sec.id}`, body);
  assert.equal(raised.waitlisted, 0);
  assert.equal(raised.taken, 3);
  await assert.rejects(admin.put(`/api/admin/sections/${sec.id}`, { ...body, capacity: 1 }), /Capacity cannot go below/);
  await admin.put(`/api/admin/sections/${sec.id}`, { ...body, status: 'cancelled' });
  const after = await admin.get(`/api/admin/enrollments?sectionId=${sec.id}`);
  assert.ok(after.every((e) => e.status === 'dropped'));
});

test('teachers cannot be double-booked; prerequisites cannot loop', async () => {
  const env = setup();
  const { admin, term, courses, teachers } = await seed(env);
  await assert.rejects(
    admin.post('/api/admin/sections', { courseId: courses.math.id, termId: term.id, name: 'B', teacherId: teachers.t1.id, capacity: 10, meetings: [{ day: 1, start: '10:00', end: '11:00' }] }),
    /teach1 already teaches PROG1 A/,
  );
  await assert.rejects(admin.put(`/api/admin/courses/${courses.prog1.id}`, { ...courses.prog1, prerequisites: [courses.prog2.id] }), /require itself/);
});
