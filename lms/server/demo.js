// Demo data, added next to real data and removable without touching it.
// Every demo record has demo: true. Demo accounts use the password "demo1234".
import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth.js';
import { addDays } from './util.js';
import { findById } from './enrollment.js';

export const DEMO_PASSWORD = 'demo1234';
const COLLECTIONS = ['programs', 'terms', 'courses', 'sections', 'enrollments', 'lessons', 'announcements', 'assignments', 'submissions', 'attempts', 'resources', 'attendance', 'news', 'events', 'users'];

export function demoStatus(data) {
  const counts = Object.fromEntries(COLLECTIONS.map((k) => [k, data[k].filter((x) => x.demo).length]));
  return { loaded: counts.users > 0 || counts.courses > 0, counts, accounts: data.users.filter((u) => u.demo && u.status === 'active' && u.role !== 'student').map((u) => u.username).concat(data.users.some((u) => u.username === 'student.demo') ? ['student.demo'] : []) };
}

// files: the file store, so uploaded files in demo sections are deleted too.
export function removeDemo(data, files = null) {
  const ids = (k) => new Set(data[k].filter((x) => x.demo).map((x) => x.id));
  const users = ids('users');
  const sections = ids('sections');
  const assignments = ids('assignments');
  const courses = ids('courses');
  const programs = ids('programs');
  const terms = ids('terms');
  data.enrollments = data.enrollments.filter((e) => !e.demo && !users.has(e.studentId) && !sections.has(e.sectionId));
  data.submissions = data.submissions.filter((s) => !s.demo && !users.has(s.studentId) && !assignments.has(s.assignmentId));
  data.attempts = data.attempts.filter((s) => !s.demo && !users.has(s.studentId) && !assignments.has(s.assignmentId));
  for (const k of ['lessons', 'announcements', 'assignments', 'resources', 'attendance']) data[k] = data[k].filter((x) => !x.demo && !sections.has(x.sectionId));
  for (const r of data.attendance) for (const id of Object.keys(r.records)) if (users.has(id)) delete r.records[id];
  for (const f of data.files.filter((x) => sections.has(x.sectionId) || users.has(x.ownerId))) (files ? files.remove(f.id) : (data.files = data.files.filter((x) => x.id !== f.id)));
  data.news = data.news.filter((n) => !n.demo);
  data.events = data.events.filter((e) => !e.demo);
  for (const n of data.news) {
    n.comments = (n.comments || []).filter((c) => !users.has(c.userId));
    for (const k of Object.keys(n.reactions || {})) n.reactions[k] = n.reactions[k].filter((id) => !users.has(id));
  }
  data.sections = data.sections.filter((s) => !s.demo);
  // Real sections taught by a demo teacher lose their teacher; real courses lose demo prerequisites.
  for (const s of data.sections) if (users.has(s.teacherId)) s.teacherId = null;
  for (const c of data.courses) if (c.prerequisites) c.prerequisites = c.prerequisites.filter((id) => !courses.has(id));
  for (const u of data.users) if (programs.has(u.programId)) u.programId = null;
  for (const k of ['users', 'courses', 'programs', 'terms']) data[k] = data[k].filter((x) => !x.demo);
  if (terms.has(data.settings.currentTermId)) data.settings.currentTermId = data.terms.at(-1)?.id || null;
}

export function addDemo(data, today, files = null) {
  removeDemo(data, files); // adding again refreshes the set instead of doubling it
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
  const taskType = (data.activityTypes.find((t) => t.id === 'task') || data.activityTypes[0])?.id || '';
  [
    ['Week 1: Classes and objects', 'We model real things as objects: a class describes them, an object is one of them.\n\nRead the notes, then try the exercises at the end before Wednesday.', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes'],
    ['Week 2: Collections', 'Arrays, maps and sets: when to use which, and how to loop over them.', ''],
    ['Week 3: Reading and writing files', 'Draft notes. Published next week.', ''],
  ].forEach(([title, body, link], i) => add('lessons', { sectionId: sec.id, title, body, link, order: i + 1, published: i < 2 }));
  add('announcements', { sectionId: sec.id, title: 'Welcome to Programming 2', body: 'Bring a laptop to every lab session. Office hours: Tuesdays 3–5 PM, Faculty Room 2.', authorId: T.maria.id, authorName: T.maria.name, createdAt: addDays(today, -3) + 'T08:00:00.000Z' });
  add('announcements', { sectionId: sec.id, title: 'Lab 1 moved to Room 204', body: 'Only for this Wednesday.', authorId: T.maria.id, authorName: T.maria.name, createdAt: addDays(today, -1) + 'T08:00:00.000Z' });
  const a1 = add('assignments', { sectionId: sec.id, kind: 'task', typeId: taskType, title: 'Exercise 1: A BankAccount class', instructions: 'Write a BankAccount class with deposit, withdraw and balance. Withdrawals may not go below zero.', dueAt: `${addDays(today, -1)}T23:59`, points: 20, allowLate: true, published: true });
  const a2 = add('assignments', { sectionId: sec.id, kind: 'task', typeId: taskType, title: 'Exercise 2: Word counter', instructions: 'Read a paragraph and print each word with how many times it appears, most frequent first.', dueAt: `${addDays(today, 6)}T23:59`, points: 30, allowLate: false, published: true });
  add('assignments', { sectionId: sec.id, kind: 'task', typeId: taskType, title: 'Project proposal', instructions: 'One page: the problem, who it is for, and what your program will do.', dueAt: `${addDays(today, 20)}T23:59`, points: 50, allowLate: false, published: false });
  const submit = (st, x, extra) => add('submissions', { assignmentId: x.id, studentId: st.id, text: 'class BankAccount { … }', link: '', submittedAt: at(), late: false, score: null, feedback: '', gradedAt: null, attempts: 1, ...extra });
  submit(S.carlo, a1, { score: 18, feedback: 'Good work. Check the withdraw rule for exactly zero.', gradedAt: now, gradedBy: T.maria.name });
  submit(S.bea, a1, { score: 20, feedback: 'Excellent.', gradedAt: now, gradedBy: T.maria.name });
  submit(S.paolo, a1, {});
  submit(S.angela, a1, { late: true });
  submit(S.bea, a2, { text: 'Uses a Map and sorts by count.' });


  // Quiz (open now, results right away) and an exam that opens later
  const Q = (type, prompt, points, extra) => ({ id: randomUUID(), type, prompt, points, ...extra });
  const opt = (text, correct = false) => ({ id: randomUUID(), text, correct });
  const quiz1 = add('assignments', {
    sectionId: sec.id, kind: 'quiz', typeId: data.activityTypes.some((t) => t.id === 'short-quiz') ? 'short-quiz' : data.activityTypes[0]?.id,
    title: 'Quiz 1: Classes and objects', instructions: 'Ten minutes, two attempts. Your best score counts.', opensAt: `${addDays(today, -2)}T08:00`, dueAt: `${addDays(today, 5)}T23:59`,
    published: true, allowLate: false, quiz: { timeLimit: 10, attempts: 2, shuffle: false, showResults: 'immediately' },
    questions: [
      Q('single', 'Which keyword creates a new object from a class?', 1, { options: [opt('class'), opt('new', true), opt('this'), opt('extends')] }),
      Q('multiple', 'Which of these are usually part of a class?', 2, { options: [opt('Fields', true), opt('Methods', true), opt('A constructor', true), opt('A database')] }),
      Q('truefalse', 'Two objects of the same class always hold the same values.', 1, { answer: false }),
      Q('short', 'What is the name for a function that belongs to a class?', 1, { answers: ['method', 'a method'] }),
      Q('essay', 'In two or three sentences, explain the difference between a class and an object.', 5, {}),
    ],
  });
  quiz1.points = quiz1.questions.reduce((n, q) => n + q.points, 0);
  const exam = add('assignments', {
    sectionId: sec.id, kind: 'quiz', typeId: data.activityTypes.some((t) => t.id === 'exam') ? 'exam' : data.activityTypes[0]?.id,
    title: 'Midterm examination', instructions: 'One attempt, 60 minutes. Answers are shown after the exam closes.', opensAt: `${addDays(today, 14)}T08:00`, dueAt: `${addDays(today, 14)}T17:00`,
    published: true, allowLate: false, quiz: { timeLimit: 60, attempts: 1, shuffle: true, showResults: 'after_close' },
    questions: [Q('single', 'A class is a…', 2, { options: [opt('blueprint for objects', true), opt('kind of loop'), opt('database table')] }), Q('essay', 'Describe encapsulation with an example.', 10, {})],
  });
  exam.points = exam.questions.reduce((n, q) => n + q.points, 0);
  const attempt = (st, answers, manual = {}) => {
    const when = at();
    const a = add('attempts', { assignmentId: quiz1.id, studentId: st.id, startedAt: when, deadline: when, submittedAt: when, answers, manualScores: manual, feedback: {}, order: null });
    let score = 0;
    a.itemScores = {};
    for (const q of quiz1.questions) {
      const v = manual[q.id] ?? (q.type === 'essay' ? null : q.type === 'single' ? (q.options.find((o) => o.id === answers[q.id])?.correct ? q.points : 0)
        : q.type === 'multiple' ? Math.max(0, (q.options.filter((o) => o.correct && answers[q.id]?.includes(o.id)).length - q.options.filter((o) => !o.correct && answers[q.id]?.includes(o.id)).length) / q.options.filter((o) => o.correct).length) * q.points
          : q.type === 'truefalse' ? (answers[q.id] === q.answer ? q.points : 0) : q.answers.includes(String(answers[q.id]).toLowerCase()) ? q.points : 0);
      a.itemScores[q.id] = v;
      if (v != null) score += v;
    }
    a.score = Math.round(score * 100) / 100;
    a.needsGrading = Object.values(a.itemScores).filter((v) => v == null).length;
    a.status = a.needsGrading ? 'submitted' : 'graded';
    return a;
  };
  const [q1, q2, q3, q4, q5] = quiz1.questions;
  const right = { [q1.id]: q1.options[1].id, [q2.id]: q2.options.slice(0, 3).map((o) => o.id), [q3.id]: false, [q4.id]: 'method' };
  attempt(S.bea, { ...right, [q5.id]: 'A class describes the shape; an object is one thing made from it, with its own values.' }, { [q5.id]: 5 });
  attempt(S.paolo, { ...right, [q2.id]: [q2.options[0].id], [q5.id]: 'An object is made from a class.' });
  attempt(S.angela, { [q1.id]: q1.options[0].id, [q3.id]: true, [q4.id]: 'function', [q5.id]: 'Not sure.' });

  // Attendance for the class days before today
  const recent = [];
  for (let i = 1; recent.length < 4 && i < 30; i++) {
    const d = addDays(today, -i);
    if (sec.meetings.some((m) => m.day === new Date(`${d}T00:00:00`).getDay())) recent.unshift(d);
  }
  const roster = [S.carlo, S.bea, S.paolo, S.angela, S.miguel];
  recent.forEach((date, i) => add('attendance', {
    sectionId: sec.id, date, takenBy: T.maria.name, updatedAt: now,
    records: Object.fromEntries(roster.map((st, j) => [st.id, (i + j) % 7 === 3 ? 'absent' : (i + j) % 5 === 2 ? 'late' : (i * j) % 9 === 4 ? 'excused' : 'present'])),
  }));

  // Resources: a small PDF (when the file store is available) and links
  let order = 0;
  if (files) {
    const f = files.save({ name: 'IT201 course outline.pdf', type: 'application/pdf', data: demoPdf('IT201 Computer Programming 2 - Course outline').toString('base64') }, { sectionId: sec.id, owner: T.maria });
    add('resources', { sectionId: sec.id, kind: 'file', fileId: f.id, category: 'pdf', title: 'Course outline', description: 'Topics week by week, grading and class rules.', published: true, order: ++order, createdBy: T.maria.name });
  }
  add('resources', { sectionId: sec.id, kind: 'link', url: 'https://www.youtube.com/watch?v=pTB0EiLXUC8', category: 'video', title: 'Video: object-oriented programming in 7 minutes', description: '', published: true, order: ++order, createdBy: T.maria.name });
  add('resources', { sectionId: sec.id, kind: 'link', url: 'https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Objects', category: 'link', title: 'MDN: JavaScript objects', description: 'Reading for week 1.', published: true, order: ++order, createdBy: T.maria.name });

  // School news and events
  add('news', { title: 'Enrollment for the current term is open', body: 'Request your sections under Enrollment in the learning portal. Requests are reviewed by the registrar within two working days.\n\nFull sections take a waitlist: you move up automatically when a seat frees up.', authorId: null, authorName: 'Office of the Registrar', pinned: true, commentsOff: false, createdAt: `${addDays(today, -6)}T09:00:00.000Z`, reactions: { like: [S.bea.id, S.paolo.id], celebrate: [S.carlo.id] }, comments: [{ id: randomUUID(), userId: S.paolo.id, name: S.paolo.name, role: 'student', body: 'Is IT210 opening another section?', createdAt: `${addDays(today, -5)}T10:00:00.000Z` }] });
  add('news', { title: 'Library hours extended during exams', body: 'The library is open until 9 PM on weekdays for the next three weeks.', authorId: null, authorName: 'Rosa Villanueva', pinned: false, commentsOff: true, createdAt: `${addDays(today, -2)}T09:00:00.000Z`, reactions: { love: [S.angela.id] }, comments: [] });
  add('events', { title: 'University intramurals', description: 'Opening parade and games across campus. Classes are suspended in the afternoon.', location: 'Main grounds', startDate: addDays(today, 9), endDate: addDays(today, 11), startTime: '08:00', endTime: '17:00', createdBy: 'Demo data' });
  add('events', { title: 'Midterm examinations week', description: '', location: '', startDate: addDays(today, 14), endDate: addDays(today, 18), startTime: '', endTime: '', createdBy: 'Demo data' });

  return demoStatus(data);
}

// A one-page PDF with a line of text, for the demo resource preview.
function demoPdf(title) {
  const esc = title.replace(/[()\\]/g, '');
  const stream = `BT /F1 20 Tf 60 760 Td (${esc}) Tj 0 -36 Td /F1 12 Tf (Week 1: classes and objects) Tj 0 -18 Td (Week 2: collections) Tj 0 -18 Td (Week 3: files) Tj 0 -18 Td (Grading: assignments 30%, quizzes 40%, exam 30%) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
