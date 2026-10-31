// Demo data, added next to real data and removable without touching it.
// Every demo record has demo: true. Demo accounts use the password "demo1234".
import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth.js';
import { addDays } from './util.js';
import { findById } from './enrollment.js';

export const DEMO_PASSWORD = 'demo1234';
const COLLECTIONS = ['programs', 'terms', 'courses', 'sections', 'enrollments', 'lessons', 'announcements', 'assignments', 'submissions', 'users'];

export function demoStatus(data) {
  const counts = Object.fromEntries(COLLECTIONS.map((k) => [k, data[k].filter((x) => x.demo).length]));
  return { loaded: counts.users > 0 || counts.courses > 0, counts, accounts: data.users.filter((u) => u.demo && u.status === 'active' && u.role !== 'student').map((u) => u.username).concat(data.users.some((u) => u.username === 'student.demo') ? ['student.demo'] : []) };
}

export function removeDemo(data) {
  const ids = (k) => new Set(data[k].filter((x) => x.demo).map((x) => x.id));
  const users = ids('users');
  const sections = ids('sections');
  const assignments = ids('assignments');
  const courses = ids('courses');
  const programs = ids('programs');
  const terms = ids('terms');
  data.enrollments = data.enrollments.filter((e) => !e.demo && !users.has(e.studentId) && !sections.has(e.sectionId));
  data.submissions = data.submissions.filter((s) => !s.demo && !users.has(s.studentId) && !assignments.has(s.assignmentId));
  for (const k of ['lessons', 'announcements', 'assignments']) data[k] = data[k].filter((x) => !x.demo && !sections.has(x.sectionId));
  data.sections = data.sections.filter((s) => !s.demo);
  // Real sections taught by a demo teacher lose their teacher; real courses lose demo prerequisites.
  for (const s of data.sections) if (users.has(s.teacherId)) s.teacherId = null;
  for (const c of data.courses) if (c.prerequisites) c.prerequisites = c.prerequisites.filter((id) => !courses.has(id));
  for (const u of data.users) if (programs.has(u.programId)) u.programId = null;
  for (const k of ['users', 'courses', 'programs', 'terms']) data[k] = data[k].filter((x) => !x.demo);
  if (terms.has(data.settings.currentTermId)) data.settings.currentTermId = data.terms.at(-1)?.id || null;
}

export function addDemo(data, today) {
  removeDemo(data); // adding again refreshes the set instead of doubling it
  const now = new Date().toISOString();
  const add = (k, rec) => {
    const r = { id: randomUUID(), demo: true, createdAt: now, ...rec };
    data[k].push(r);
    return r;
  };
  const hash = hashPassword(DEMO_PASSWORD);
  const taken = (field, value) => data.users.some((u) => u[field] === value);

  // Programs
  const P = {};
  for (const [code, name] of [['BSIT', 'BS Information Technology'], ['BSCS', 'BS Computer Science'], ['BSBA', 'BS Business Administration']]) {
    P[code] = add('programs', { code: data.programs.some((p) => p.code === code) ? `${code}-DEMO` : code, name, description: '' });
  }

  // Terms: one finished (for prerequisites), one with enrollment open now
  const past = add('terms', { name: 'Demo: Previous Term', startDate: addDays(today, -200), endDate: addDays(today, -80), enrollStart: addDays(today, -230), enrollEnd: addDays(today, -195), dropDeadline: addDays(today, -170), status: 'active' });
  const term = add('terms', { name: 'Demo: Current Term', startDate: addDays(today, -3), endDate: addDays(today, 120), enrollStart: addDays(today, -10), enrollEnd: addDays(today, 20), dropDeadline: addDays(today, 30), status: 'active' });
  const realCurrent = findById(data.terms, data.settings.currentTermId);
  if (!realCurrent || realCurrent.demo) data.settings.currentTermId = term.id;

  // Courses
  const C = {};
  const course = (code, title, units, prereqs = [], description = '') => {
    C[code] = add('courses', {
      code: data.courses.some((c) => c.code === code) ? `${code}-DEMO` : code,
      title, units, description, status: 'active', programIds: [P.BSIT.id, P.BSCS.id],
      prerequisites: prereqs.map((p) => C[p].id),
    });
  };
  course('GE101', 'Purposive Communication', 3, [], 'Writing and speaking for academic and professional audiences.');
  course('GE102', 'Mathematics in the Modern World', 3, [], 'Patterns, logic, statistics and their use in everyday life.');
  course('IT101', 'Introduction to Computing', 3, [], 'Hardware, software, networks and how computers solve problems.');
  course('IT102', 'Computer Programming 1', 3, [], 'Variables, control flow, functions and debugging.');
  course('IT201', 'Computer Programming 2', 3, ['IT102'], 'Objects, collections, files and testing.');
  course('IT202', 'Data Structures and Algorithms', 3, ['IT201'], 'Lists, trees, graphs, sorting and complexity.');
  course('IT210', 'Web Development', 3, ['IT102'], 'HTML, CSS, JavaScript and building small web apps.');
  course('IT220', 'Database Systems', 3, ['IT101'], 'Relational design, SQL and transactions.');
  course('PE101', 'Physical Education 1', 2, [], 'Movement competency and fitness.');

  // People
  const person = (role, username, name, extra = {}) => add('users', {
    role, username: taken('username', username) ? `${username}2` : username, name, email: `${username}@example.edu`,
    status: 'active', mustChangePassword: false, passwordHash: hash, ...extra,
  });
  person('registrar', 'registrar.demo', 'Rosa Villanueva');
  const T = {
    maria: person('teacher', 'teacher.demo', 'Maria Santos', { department: 'College of Computing' }),
    juan: person('teacher', 'jdelacruz.demo', 'Juan Dela Cruz', { department: 'College of Computing' }),
    ana: person('teacher', 'aramos.demo', 'Ana Ramos', { department: 'General Education' }),
  };
  let n = 0;
  const student = (username, name, program = 'BSIT', yearLevel = 2, extra = {}) =>
    person('student', username, name, { programId: P[program].id, yearLevel, studentNo: `DEMO-${String(++n).padStart(4, '0')}`, ...extra });
  const S = {
    carlo: student('student.demo', 'Carlo Reyes'),
    bea: student('bea.demo', 'Bea Mendoza'),
    paolo: student('paolo.demo', 'Paolo Garcia'),
    jasmine: student('jasmine.demo', 'Jasmine Tan', 'BSCS'),
    miguel: student('miguel.demo', 'Miguel Bautista', 'BSCS'),
    angela: student('angela.demo', 'Angela Cruz'),
    rafael: student('rafael.demo', 'Rafael Lim', 'BSCS'),
    trisha: student('trisha.demo', 'Trisha Aquino'),
    kevin: student('kevin.demo', 'Kevin Navarro', 'BSIT', 1),
  };
  // Applicants waiting for the registrar
  student('lea.demo', 'Lea Fernandez', 'BSBA', 1, { status: 'pending', studentNo: '', appliedAt: now, applicationNote: 'Transferring from another school.' });
  student('nico.demo', 'Nico Valdez', 'BSIT', 1, { status: 'pending', studentNo: '', appliedAt: now });

  // Sections
  const M = (days, start, end) => days.map((day) => ({ day, start, end }));
  const section = (code, name, termRec, teacher, meetings, capacity, extra = {}) =>
    add('sections', { courseId: C[code].id, termId: termRec.id, name, teacherId: teacher?.id || null, meetings, capacity, room: extra.room || `Room ${100 + data.sections.length}`, status: 'open', enrollmentKey: '', ...extra });
  const old = {
    IT101: section('IT101', 'A', past, T.juan, M([1, 3], '08:00', '09:30'), 40),
    IT102: section('IT102', 'A', past, T.maria, M([2, 4], '08:00', '09:30'), 40),
    GE101: section('GE101', 'A', past, T.ana, M([5], '08:00', '11:00'), 40),
  };
  const cur = {
    IT201A: section('IT201', 'A', term, T.maria, M([1, 3], '09:00', '10:30'), 30, { room: 'Lab 1' }),
    IT201B: section('IT201', 'B', term, T.juan, M([2, 4], '13:00', '14:30'), 25, { room: 'Lab 2' }),
    IT210A: section('IT210', 'A', term, T.maria, M([2, 4], '09:00', '10:30'), 3, { room: 'Lab 3' }),
    IT220A: section('IT220', 'A', term, T.ana, M([1, 3], '13:00', '14:30'), 30, { enrollmentKey: 'DB2026' }),
    IT202A: section('IT202', 'A', term, T.juan, M([1, 3], '15:00', '16:30'), 30),
    GE101B: section('GE101', 'B', term, T.ana, M([1, 3], '09:00', '10:30'), 40),
    GE102A: section('GE102', 'A', term, T.juan, M([5], '08:00', '11:00'), 40),
    PE101A: section('PE101', 'A', term, T.ana, M([6], '08:00', '10:00'), 40, { room: 'Gym' }),
  };

  // Enrollments
  let tick = 0;
  const at = () => new Date(Date.now() - 86400000 * 5 + 60000 * ++tick).toISOString();
  const enroll = (st, sec, status, extra = {}) => {
    const when = at();
    return add('enrollments', {
      studentId: st.id, sectionId: sec.id, courseId: sec.courseId, termId: sec.termId, status, requestedBy: 'student',
      createdAt: when, updatedAt: when, queuedAt: status === 'waitlisted' ? when : undefined, finalGrade: null, passed: null,
      history: [{ at: when, status, by: 'Demo data', note: 'Added with the demo data.' }], ...extra,
    });
  };
  const done = (grade) => ({ finalGrade: grade, passed: grade >= data.settings.passingGrade });
  for (const st of Object.values(S)) {
    if (st === S.kevin) continue; // a first-year with no history
    enroll(st, old.IT101, 'completed', done(85 + (st.name.length % 10)));
    enroll(st, old.IT102, 'completed', done(st === S.trisha ? 68 : 80 + (st.name.length % 15)));
    enroll(st, old.GE101, 'completed', done(88));
  }
  // Current term
  enroll(S.carlo, cur.IT201A, 'enrolled');
  enroll(S.carlo, cur.GE102A, 'enrolled');
  enroll(S.carlo, cur.PE101A, 'pending');
  for (const st of [S.bea, S.paolo, S.angela, S.miguel]) enroll(st, cur.IT201A, 'enrolled');
  for (const st of [S.jasmine, S.rafael]) enroll(st, cur.IT201B, 'enrolled');
  for (const st of [S.bea, S.paolo, S.jasmine]) enroll(st, cur.IT210A, 'enrolled'); // full
  for (const st of [S.angela, S.miguel]) enroll(st, cur.IT210A, 'waitlisted');
  for (const st of [S.rafael, S.angela]) enroll(st, cur.IT220A, 'pending');
  enroll(S.kevin, cur.GE101B, 'pending');
  enroll(S.kevin, cur.PE101A, 'enrolled');
  enroll(S.bea, cur.GE102A, 'enrolled');

  // Class content for IT201 A (Maria Santos)
  const sec = cur.IT201A;
  [
    ['Week 1: Classes and objects', 'We model real things as objects: a class describes them, an object is one of them.\n\nRead the notes, then try the exercises at the end before Wednesday.', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes'],
    ['Week 2: Collections', 'Arrays, maps and sets: when to use which, and how to loop over them.', ''],
    ['Week 3: Reading and writing files', 'Draft notes. Published next week.', ''],
  ].forEach(([title, body, link], i) => add('lessons', { sectionId: sec.id, title, body, link, order: i + 1, published: i < 2 }));
  add('announcements', { sectionId: sec.id, title: 'Welcome to Programming 2', body: 'Bring a laptop to every lab session. Office hours: Tuesdays 3–5 PM, Faculty Room 2.', authorId: T.maria.id, authorName: T.maria.name, createdAt: addDays(today, -3) + 'T08:00:00.000Z' });
  add('announcements', { sectionId: sec.id, title: 'Lab 1 moved to Room 204', body: 'Only for this Wednesday.', authorId: T.maria.id, authorName: T.maria.name, createdAt: addDays(today, -1) + 'T08:00:00.000Z' });
  const a1 = add('assignments', { sectionId: sec.id, title: 'Exercise 1: A BankAccount class', instructions: 'Write a BankAccount class with deposit, withdraw and balance. Withdrawals may not go below zero.', dueAt: `${addDays(today, -1)}T23:59`, points: 20, allowLate: true, published: true });
  const a2 = add('assignments', { sectionId: sec.id, title: 'Exercise 2: Word counter', instructions: 'Read a paragraph and print each word with how many times it appears, most frequent first.', dueAt: `${addDays(today, 6)}T23:59`, points: 30, allowLate: false, published: true });
  add('assignments', { sectionId: sec.id, title: 'Project proposal', instructions: 'One page: the problem, who it is for, and what your program will do.', dueAt: `${addDays(today, 20)}T23:59`, points: 50, allowLate: false, published: false });
  const submit = (st, x, extra) => add('submissions', { assignmentId: x.id, studentId: st.id, text: 'class BankAccount { … }', link: '', submittedAt: at(), late: false, score: null, feedback: '', gradedAt: null, attempts: 1, ...extra });
  submit(S.carlo, a1, { score: 18, feedback: 'Good work. Check the withdraw rule for exactly zero.', gradedAt: now, gradedBy: T.maria.name });
  submit(S.bea, a1, { score: 20, feedback: 'Excellent.', gradedAt: now, gradedBy: T.maria.name });
  submit(S.paolo, a1, {});
  submit(S.angela, a1, { late: true });
  submit(S.bea, a2, { text: 'Uses a Map and sorts by count.' });

  return demoStatus(data);
}
