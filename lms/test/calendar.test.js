// The school calendar: each person's classes, due dates, school events and term dates; holidays
// cancel classes; events for some audiences only; parents see linked students as far as each link
// allows; the private iCalendar feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seed } from './support.js';
import { toIcs } from '../server/calendar.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;
const range = 'start=2026-08-01&end=2026-08-31';

async function school(env = setup()) {
  const s = await seed(env);
  const stud = await s.login('stud1');
  const e = await stud.post('/api/enrollment', { sectionId: s.sections.prog1.id });
  await s.admin.post(`/api/admin/enrollments/${e.id}/approve`, {});
  const t1 = await s.login('teach1');
  const task = await t1.post(`/api/classes/${s.sections.prog1.id}/assignments`, { kind: 'task', title: 'Lab 1', points: 10, published: true, dueAt: '2026-08-20T23:59' });
  const mom = await s.admin.post('/api/admin/guardians', {
    name: 'Mara Mom', username: 'mara', password: PW, mustChangePassword: false,
    studentId: s.students.s1.id, relationship: 'Mother', views: { schedule: true, activities: false, grades: true },
  });
  const signIn = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: PW });
    return c;
  };
  return { ...s, env, stud, t1, task, mom, signIn };
}

test('a student sees classes, due dates, term dates and school events; holidays cancel classes', async () => {
  const f = await school();
  await f.admin.post('/api/admin/events', { title: 'Founders Day', category: 'holiday', startDate: '2026-08-17', endDate: '2026-08-17' });
  await f.admin.post('/api/admin/events', { title: 'Faculty meeting', category: 'meeting', audience: ['teacher'], startDate: '2026-08-19', endDate: '2026-08-19', startTime: '15:00', endTime: '16:00' });
  const c = await f.stud.get(`/api/calendar?${range}`);
  const of = (kind) => c.entries.filter((x) => x.kind === kind);
  // PROG1 A meets Monday and Wednesday from August 15 (classes begin); Monday the 17th is a holiday.
  assert.deepEqual(of('class').map((x) => x.date), ['2026-08-19', '2026-08-24', '2026-08-26', '2026-08-31']);
  assert.equal(of('class')[0].startTime, '09:00');
  assert.deepEqual(of('holiday').map((x) => [x.title, x.noClasses]), [['Founders Day', true]]);
  assert.deepEqual(of('due').map((x) => [x.title, x.date, x.startTime, x.state]), [['Lab 1', '2026-08-20', '23:59', 'due']]);
  assert.ok(of('term').some((x) => x.title === 'Classes begin' && x.date === '2026-08-15'));
  assert.ok(of('term').some((x) => x.title === 'Enrollment closes' && x.date === '2026-08-20'));
  assert.ok(!c.entries.some((x) => x.title === 'Faculty meeting'), 'teachers-only events stay with teachers');

  // The teacher: their section's meetings and due dates, the teachers' meeting, no enrollment dates.
  const t = await f.t1.get(`/api/calendar?${range}`);
  assert.ok(t.entries.some((x) => x.title === 'Faculty meeting' && x.kind === 'event'));
  assert.ok(t.entries.some((x) => x.kind === 'due' && x.state === null));
  assert.ok(!t.entries.some((x) => x.title === 'Enrollment closes'));
  assert.equal(t.entries.filter((x) => x.kind === 'class').length, 6); // PROG1 A (Mon/Wed) and PROG2 A (Tue)

  // Due dates follow the Modules switches, and the calendar has its own.
  const config = (await f.admin.get('/api/admin/modules')).config;
  config.assignments.student = false;
  await f.admin.put('/api/admin/modules', { config });
  assert.ok(!(await f.stud.get(`/api/calendar?${range}`)).entries.some((x) => x.kind === 'due'));
  config.calendar.student = false;
  await f.admin.put('/api/admin/modules', { config });
  await assert.rejects(f.stud.get(`/api/calendar?${range}`), status(403));

  await assert.rejects(f.t1.get('/api/calendar?start=2026-01-01&end=2026-12-31'), /at most/);
  await assert.rejects(f.t1.get('/api/calendar?start=x&end=y'), /dates/);
});

test('parents see each linked student as far as the link allows', async () => {
  const f = await school();
  await f.admin.post('/api/admin/events', { title: 'Parents meeting', category: 'meeting', audience: ['guardian'], startDate: '2026-08-22', endDate: '2026-08-22' });
  const mom = await f.signIn('mara');
  const c = await mom.get(`/api/calendar?${range}`);
  assert.deepEqual(c.children.map((k) => k.name), ['stud1']);
  assert.ok(c.entries.some((x) => x.kind === 'class' && x.childName === 'stud1' && x.href.includes('/schedule')));
  assert.ok(!c.entries.some((x) => x.kind === 'due'), 'activities are not shared on this link');
  assert.ok(c.entries.some((x) => x.title === 'Parents meeting'));
  // With activities shared, due dates come with where the student stands.
  const [link] = await f.admin.get(`/api/admin/students/${f.students.s1.id}/guardians`);
  await f.admin.put(`/api/admin/guardian-links/${link.id}`, { views: { schedule: true, activities: true } });
  const d = await mom.get(`/api/calendar?${range}&child=${f.students.s1.id}`);
  assert.deepEqual(d.entries.filter((x) => x.kind === 'due').map((x) => [x.title, x.state]), [['Lab 1', 'due']]);
  // Students do not see parents-only events.
  assert.ok(!(await f.stud.get(`/api/calendar?${range}`)).entries.some((x) => x.title === 'Parents meeting'));
});

test('events: categories, audiences and no-class days are kept; News & events lists only what is for you', async () => {
  const f = await school();
  const e = await f.admin.post('/api/admin/events', { title: 'Midterms', category: 'exam', audience: ['student', 'teacher', 'guardian'], startDate: '2026-08-24', endDate: '2026-08-28' });
  assert.equal(e.category, 'exam');
  assert.deepEqual(e.audience, []); // all three = everyone
  assert.equal(e.noClasses, false);
  const h = await f.admin.post('/api/admin/events', { title: 'Typhoon', category: 'event', noClasses: true, audience: ['student'], startDate: '2026-08-26', endDate: '2026-08-26' });
  assert.equal(h.noClasses, true);
  const c = await f.stud.get(`/api/calendar?${range}`);
  assert.equal(c.entries.find((x) => x.title === 'Typhoon').kind, 'holiday');
  assert.equal(c.entries.find((x) => x.title === 'Midterms').kind, 'exam');
  assert.ok(!c.entries.some((x) => x.kind === 'class' && x.date === '2026-08-26'));
  assert.ok(!(await f.t1.get('/api/events')).some((x) => x.title === 'Typhoon'));
  // The admin panel's calendar: events and term dates of the campus.
  const a = await f.admin.get(`/api/admin/calendar?${range}`);
  assert.ok(a.entries.some((x) => x.title === 'Typhoon' && x.eventId === h.id));
  assert.ok(!a.entries.some((x) => x.kind === 'class'));
});

test('the private calendar feed (iCalendar) for phones and other calendars', async () => {
  const f = await school();
  assert.equal((await f.stud.get('/api/calendar/subscription')).url, null);
  const { url } = await f.stud.post('/api/calendar/subscription');
  assert.match(url, /\/api\/calendar\/feed\/[0-9a-f]{48}\.ics$/);
  const path = new URL(url).pathname;
  const res = await f.env.client().get(path); // no sign-in: the address is the key
  assert.match(res.type, /text\/calendar/);
  assert.match(res.raw, /^BEGIN:VCALENDAR\r\n/);
  assert.match(res.raw, /SUMMARY:PROG1 A/);
  assert.match(res.raw, /SUMMARY:Due: Lab 1 \(PROG1 A\)/);
  assert.match(res.raw, /DTSTART;TZID=Asia\/Manila:20260820T235900/);
  // A new address stops the old one; removing it stops it too.
  const again = await f.stud.post('/api/calendar/subscription');
  assert.notEqual(again.url, url);
  await assert.rejects(f.env.client().get(path), status(404));
  await f.stud.del('/api/calendar/subscription');
  await assert.rejects(f.env.client().get(new URL(again.url).pathname), status(404));
});

test('iCalendar text: escaping, folding at 75 octets, all-day end dates', () => {
  const ics = toIcs([
    { id: 'a', kind: 'event', title: 'Intramurals; games, fun', date: '2026-11-17', endDate: '2026-11-18', startTime: '', description: 'Line one\nLine two '.repeat(8), location: 'Gym' },
  ], { name: 'Test', now: new Date('2026-11-01T00:00:00Z') });
  assert.match(ics, /SUMMARY:Intramurals\\; games\\, fun\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261117\r\nDTEND;VALUE=DATE:20261119/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});
