// Test helpers: an API on an in-memory database, and clients that keep their own cookies.
import { createApi } from '../server/api.js';
import { memoryDb } from '../server/db.js';

export const TODAY = '2026-08-10';

export function setup({ today = TODAY } = {}) {
  const db = memoryDb();
  const api = createApi(db, { clock: () => new Date(`${today}T10:00:00`) });
  const client = () => {
    const jar = {};
    const call = async (method, path, body = {}) => {
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      const { data, headers } = await api({ method, headers: { cookie } }, new URL(`http://localhost${path}`), body);
      const set = headers['Set-Cookie'];
      if (set) {
        const [pair] = set.split(';');
        const [k, v] = pair.split('=');
        if (v) jar[k] = v;
        else delete jar[k];
      }
      return data;
    };
    return {
      get: (p) => call('GET', p),
      post: (p, b) => call('POST', p, b),
      put: (p, b) => call('PUT', p, b),
      del: (p) => call('DELETE', p),
    };
  };
  return { db, api, client };
}

// An admin, a registrar-free catalog: one term with enrollment open around TODAY,
// courses PROG1 → PROG2 (prerequisite), MATH, ART (2 units), and two teachers.
export async function seed(env) {
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123' });
  const term = await admin.post('/api/admin/terms', {
    name: 'First Semester', startDate: '2026-08-15', endDate: '2026-12-15', enrollStart: '2026-08-01', enrollEnd: '2026-08-20', dropDeadline: '2026-08-31',
  });
  const past = await admin.post('/api/admin/terms', {
    name: 'Summer', startDate: '2026-05-01', endDate: '2026-06-30', enrollStart: '2026-04-01', enrollEnd: '2026-04-20',
  });
  await admin.put('/api/admin/settings', { currentTermId: term.id });
  const prog1 = await admin.post('/api/admin/courses', { code: 'prog1', title: 'Programming 1', units: 3 });
  const prog2 = await admin.post('/api/admin/courses', { code: 'PROG2', title: 'Programming 2', units: 3, prerequisites: [prog1.id] });
  const math = await admin.post('/api/admin/courses', { code: 'MATH', title: 'Mathematics', units: 3 });
  const art = await admin.post('/api/admin/courses', { code: 'ART', title: 'Art', units: 2 });
  const mk = (role, username, extra = {}) => admin.post('/api/admin/users', { role, username, name: username, password: 'password123', mustChangePassword: false, ...extra });
  const t1 = await mk('teacher', 'teach1');
  const t2 = await mk('teacher', 'teach2');
  const s1 = await mk('student', 'stud1');
  const s2 = await mk('student', 'stud2');
  const s3 = await mk('student', 'stud3');
  const sec = (course, name, teacher, meetings, capacity = 30, extra = {}) =>
    admin.post('/api/admin/sections', { courseId: course.id, termId: term.id, name, teacherId: teacher?.id, meetings, capacity, ...extra });
  const MW9 = [{ day: 1, start: '09:00', end: '10:30' }, { day: 3, start: '09:00', end: '10:30' }];
  const sections = {
    prog1: await sec(prog1, 'A', t1, MW9, 2),
    prog2: await sec(prog2, 'A', t1, [{ day: 2, start: '09:00', end: '10:30' }]),
    math: await sec(math, 'A', t2, [{ day: 1, start: '10:00', end: '11:00' }]), // clashes with prog1 A
    art: await sec(art, 'A', t2, [{ day: 5, start: '13:00', end: '15:00' }], 30, { enrollmentKey: 'PAINT' }),
    pastProg1: await admin.post('/api/admin/sections', { courseId: prog1.id, termId: past.id, name: 'S', teacherId: t2.id, capacity: 30, meetings: [] }),
  };
  const login = async (username) => {
    const c = env.client();
    await c.post('/api/auth/login', { username, password: 'password123' });
    return c;
  };
  return { admin, term, past, courses: { prog1, prog2, math, art }, teachers: { t1, t2 }, students: { s1, s2, s3 }, sections, login };
}
