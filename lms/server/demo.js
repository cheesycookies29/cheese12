// Demo data, added next to real data and removable without touching it.
// Every demo record has demo: true. Demo accounts use the password "demo1234".
import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth.js';
import { addDays } from './util.js';
import { findById } from './enrollment.js';
import { scoreAttempt, quizPoints } from './quiz.js';
import { meetingsClash } from '../shared/schedule.js';
import { addHrisDemo, removeHrisDemo } from './hris-demo.js';

export const DEMO_PASSWORD = 'demo1234';
const COLLECTIONS = ['guardianLinks', 'campuses', 'programs', 'terms', 'courses', 'sections', 'enrollments', 'lessons', 'announcements', 'assignments', 'submissions', 'attempts', 'resources', 'attendance', 'news', 'events', 'users', 'employees', 'timeEntries', 'requests', 'payrollRuns'];

export function demoStatus(data) {
  const counts = Object.fromEntries(COLLECTIONS.map((k) => [k, data[k].filter((x) => x.demo).length]));
  return { loaded: counts.users > 0 || counts.courses > 0, counts, accounts: data.users.filter((u) => u.demo && u.status === 'active' && u.role !== 'student').map((u) => u.username).concat(data.users.some((u) => u.username === 'student.demo') ? ['student.demo'] : []) };
}

// files: the file store, so uploaded files in demo sections are deleted too.
export function removeDemo(data, files = null) {
  removeHrisDemo(data, files);
  const ids = (k) => new Set(data[k].filter((x) => x.demo).map((x) => x.id));
  const users = ids('users');
  const sections = ids('sections');
  const assignments = ids('assignments');
  const courses = ids('courses');
  const programs = ids('programs');
  const terms = ids('terms');
  data.enrollments = data.enrollments.filter((e) => !e.demo && !users.has(e.studentId) && !sections.has(e.sectionId));
  data.guardianLinks = data.guardianLinks.filter((l) => !l.demo && !users.has(l.guardianId) && !users.has(l.studentId));
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
  // Real records placed in a demo campus move to the first real campus.
  const campuses = ids('campuses');
  const home = data.campuses.find((c) => !c.demo)?.id;
  for (const s of data.sections) if (campuses.has(s.campusId)) s.campusId = home;
  for (const k of ['news', 'events']) for (const x of data[k]) if (campuses.has(x.campusId)) x.campusId = home;
  for (const k of ['employees', 'payrollRuns']) for (const x of data[k]) if (campuses.has(x.campusId)) x.campusId = home;
  for (const u of data.users) {
    if (!u.campusIds) continue;
    u.campusIds = u.campusIds.filter((id) => !campuses.has(id));
    if (u.role !== 'admin' && !u.campusIds.length && home) u.campusIds = [home];
  }
  data.campuses = data.campuses.filter((c) => !c.demo);
  // Real sections taught by a demo teacher lose their teacher; real courses lose demo prerequisites.
  for (const s of data.sections) if (users.has(s.teacherId)) s.teacherId = null;
  for (const c of data.courses) if (c.prerequisites) c.prerequisites = c.prerequisites.filter((id) => !courses.has(id));
  for (const u of data.users) if (programs.has(u.programId)) u.programId = null;
  for (const k of ['users', 'courses', 'programs', 'terms']) data[k] = data[k].filter((x) => !x.demo);
  if (terms.has(data.settings.currentTermId)) data.settings.currentTermId = data.terms.at(-1)?.id || null;
}

// The demo school: 5 programs, 8 teachers, about 60 students and 5 applicants, a finished
// term (grades, for prerequisites) and a current term with enrollment open: 24 sections
// with lessons, announcements, resources, graded work, quizzes, attempts and attendance.
// The same school every time (no randomness), so screenshots and guides stay true.
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
  // Repeatable "random": the same numbers every time.
  let seed = 20261103;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const typeId = (id) => (data.activityTypes.find((t) => t.id === id) || data.activityTypes[0])?.id || '';

  // ----- Campuses: the full demo school is at the first campus; three smaller ones beside it -----
  const main = data.campuses[0];
  const [sipocot, pasacao, calabanga] = [['Sipocot Campus', 'SIP'], ['Pasacao Campus', 'PAS'], ['Calabanga Campus', 'CAL']].map(([name, code]) => add('campuses', {
    name: data.campuses.some((c) => c.name === name) ? `${name} (demo)` : name,
    code: data.campuses.some((c) => c.code === code) ? `${code}D` : code, address: 'Camarines Sur',
  }));

  // ----- Programs -----
  const P = {};
  for (const [code, name, description] of [
    ['BSIT', 'BS Information Technology', 'Software, networks and systems for organizations.'],
    ['BSCS', 'BS Computer Science', 'Algorithms, theory and the science of computing.'],
    ['BSBA', 'BS Business Administration', 'Management, accounting and marketing.'],
    ['BSA', 'BS Agriculture', 'Crop and animal science, soils and sustainable farming.'],
    ['BSED', 'Bachelor of Secondary Education', 'Teaching, learning and the secondary school curriculum.'],
  ]) P[code] = add('programs', { code: data.programs.some((p) => p.code === code) ? `${code}-DEMO` : code, name, description });
  const ALL = Object.keys(P);

  // ----- Terms: one finished (grades, for prerequisites), one with enrollment open now -----
  const past = add('terms', { name: 'Demo: Previous Term', startDate: addDays(today, -200), endDate: addDays(today, -80), enrollStart: addDays(today, -230), enrollEnd: addDays(today, -195), dropDeadline: addDays(today, -170), status: 'active' });
  const term = add('terms', { name: 'Demo: Current Term', startDate: addDays(today, -24), endDate: addDays(today, 100), enrollStart: addDays(today, -31), enrollEnd: addDays(today, 20), dropDeadline: addDays(today, 30), status: 'active' });
  const realCurrent = findById(data.terms, data.settings.currentTermId);
  if (!realCurrent || realCurrent.demo) data.settings.currentTermId = term.id;

  // ----- Courses -----
  const C = {};
  const course = (code, title, units, prereqs, programs, description) => {
    C[code] = add('courses', {
      code: data.courses.some((c) => c.code === code) ? `${code}-DEMO` : code,
      title, units, description, status: 'active', programIds: programs.map((p) => P[p].id),
      prerequisites: prereqs.map((p) => C[p].id),
    });
  };
  course('GE101', 'Purposive Communication', 3, [], ALL, 'Writing and speaking for academic and professional audiences.');
  course('GE102', 'Mathematics in the Modern World', 3, [], ALL, 'Patterns, logic, statistics and their use in everyday life.');
  course('GE103', 'The Contemporary World', 3, [], ALL, 'Globalization and its effects on economies, cultures and the Philippines.');
  course('GE104', 'Readings in Philippine History', 3, [], ALL, 'Philippine history through primary sources.');
  course('PE101', 'Physical Education 1', 2, [], ALL, 'Movement competency and fitness.');
  course('NSTP1', 'National Service Training Program 1', 3, [], ALL, 'Civic welfare and community service.');
  course('IT101', 'Introduction to Computing', 3, [], ['BSIT', 'BSCS'], 'Hardware, software, networks and how computers solve problems.');
  course('IT102', 'Computer Programming 1', 3, [], ['BSIT', 'BSCS'], 'Variables, control flow, functions and debugging.');
  course('IT201', 'Computer Programming 2', 3, ['IT102'], ['BSIT', 'BSCS'], 'Objects, collections, files and testing.');
  course('IT202', 'Data Structures and Algorithms', 3, ['IT201'], ['BSIT', 'BSCS'], 'Lists, trees, graphs, sorting and complexity.');
  course('IT210', 'Web Development', 3, ['IT102'], ['BSIT'], 'HTML, CSS, JavaScript and building small web apps.');
  course('IT220', 'Database Systems', 3, ['IT101'], ['BSIT', 'BSCS'], 'Relational design, SQL and transactions.');
  course('CS201', 'Discrete Structures', 3, ['IT101'], ['BSCS'], 'Logic, sets, relations, counting and graphs.');
  course('AGRI101', 'Fundamentals of Crop Science', 3, [], ['BSA'], 'How crops grow, and how to raise them well.');
  course('AGRI102', 'Fundamentals of Animal Science', 3, [], ['BSA'], 'Livestock and poultry: breeds, feeding and health.');
  course('AGRI201', 'Soil Science', 3, ['AGRI101'], ['BSA'], 'Soil formation, fertility and management.');
  course('BA101', 'Principles of Management', 3, [], ['BSBA'], 'Planning, organizing, leading and controlling.');
  course('BA102', 'Basic Accounting', 3, [], ['BSBA'], 'The accounting cycle and financial statements.');
  course('BA201', 'Marketing Management', 3, ['BA101'], ['BSBA'], 'Markets, customers and the marketing mix.');
  course('ED101', 'The Teaching Profession', 3, [], ['BSED'], 'The teacher as a professional and a person.');
  course('ED102', 'Child and Adolescent Development', 3, [], ['BSED'], 'How learners grow, think and feel.');

  // ----- People -----
  const person = (role, username, name, extra = {}) => add('users', {
    role, username: taken('username', username) ? `${username}2` : username, name, email: `${username}@example.edu`,
    status: 'active', mustChangePassword: false, passwordHash: hash, lastLoginAt: new Date(Date.now() - rand() * 6 * 86400000).toISOString(), campusIds: [main.id], ...extra,
  });
  person('registrar', 'registrar.demo', 'Rosa Villanueva', { campusIds: [main.id, sipocot.id] }); // works at two campuses
  const T = {
    maria: person('teacher', 'teacher.demo', 'Maria Santos', { department: 'College of Computing', employeeNo: 'T-1001', campusIds: [main.id, sipocot.id] }), // also teaches at Sipocot
    juan: person('teacher', 'jdelacruz.demo', 'Juan Dela Cruz', { department: 'College of Computing', employeeNo: 'T-1002' }),
    ana: person('teacher', 'aramos.demo', 'Ana Ramos', { department: 'General Education', employeeNo: 'T-1003' }),
    leo: person('teacher', 'lmercado.demo', 'Leo Mercado', { department: 'College of Computing', employeeNo: 'T-1004' }),
    grace: person('teacher', 'gaquino.demo', 'Grace Aquino', { department: 'General Education', employeeNo: 'T-1005' }),
    ramon: person('teacher', 'rvillareal.demo', 'Ramon Villareal', { department: 'College of Agriculture', employeeNo: 'T-1006' }),
    liza: person('teacher', 'lgonzales.demo', 'Liza Gonzales', { department: 'College of Business', employeeNo: 'T-1007' }),
    mark: person('teacher', 'mtorres.demo', 'Mark Torres', { department: 'College of Education', employeeNo: 'T-1008' }),
  };
  let n = 0;
  const student = (username, name, program, yearLevel, extra = {}) =>
    person('student', username, name, { programId: P[program].id, yearLevel, studentNo: `DEMO-${String(++n).padStart(4, '0')}`, ...extra });
  // The students the guides talk about
  const S = {
    carlo: student('student.demo', 'Carlo Reyes', 'BSIT', 2),
    bea: student('bea.demo', 'Bea Mendoza', 'BSIT', 2),
    paolo: student('paolo.demo', 'Paolo Garcia', 'BSIT', 2),
    jasmine: student('jasmine.demo', 'Jasmine Tan', 'BSCS', 2),
    miguel: student('miguel.demo', 'Miguel Bautista', 'BSCS', 2),
    angela: student('angela.demo', 'Angela Cruz', 'BSIT', 2),
    rafael: student('rafael.demo', 'Rafael Lim', 'BSCS', 2),
    trisha: student('trisha.demo', 'Trisha Aquino', 'BSIT', 2),
    kevin: student('kevin.demo', 'Kevin Navarro', 'BSIT', 1),
  };
  // Everyone else: names from common Filipino first and last names, spread across programs and years
  const FIRST = ['Andrea', 'Joshua', 'Camille', 'Mark Anthony', 'Patricia', 'John Paul', 'Kristine', 'Christian', 'Nicole', 'Jerome', 'Danica', 'Renz', 'Shaira', 'Vincent', 'Aileen', 'Gabriel', 'Erika', 'Jericho', 'Hannah', 'Kyle', 'Mae', 'Adrian', 'Princess', 'Bryan', 'Joanna', 'Ralph', 'Clarisse', 'Elijah', 'Faith', 'Nathaniel', 'Lovely', 'Ivan', 'Rica', 'Daniel', 'Joy', 'Paulo'];
  const LAST = ['Dizon', 'Castillo', 'Ramirez', 'Flores', 'Villanueva', 'Pascual', 'Soriano', 'Manalo', 'Lopez', 'Gonzaga', 'Salazar', 'Ocampo', 'Rivera', 'Tolentino', 'Navarro', 'Mercado', 'Domingo', 'Del Rosario', 'Bernardo', 'Mendoza', 'Fernandez', 'Panganiban', 'Santiago', 'Valdez', 'Aguilar', 'Bautista', 'Cortez', 'De Guzman', 'Esguerra', 'Francisco', 'Gutierrez', 'Ilagan', 'Javier', 'Lacson', 'Magbanua', 'Natividad'];
  const PLAN = [['BSIT', 1, 8], ['BSIT', 2, 6], ['BSCS', 1, 5], ['BSCS', 2, 4], ['BSBA', 1, 6], ['BSBA', 2, 5], ['BSA', 1, 6], ['BSA', 2, 5], ['BSED', 1, 5], ['BSED', 2, 4]];
  const crowd = [];
  let k = 0;
  for (const [program, year, count] of PLAN) {
    for (let i = 0; i < count; i++, k++) {
      const first = FIRST[k % FIRST.length];
      const last = LAST[(k * 7 + Math.floor(k / FIRST.length)) % LAST.length]; // no two students share a name
      const username = `${first.split(' ')[0]}.${last.replace(/\s+/g, '')}`.toLowerCase();
      crowd.push(student(taken('username', username) ? `${username}${k}` : username, `${first} ${last}`, program, year));
    }
  }
  // Applicants waiting for the registrar
  for (const [username, name, program, note] of [
    ['lea.demo', 'Lea Fernandez', 'BSBA', 'Transferring from another school.'],
    ['nico.demo', 'Nico Valdez', 'BSIT', ''],
    ['aira.demo', 'Aira Mallari', 'BSA', 'Graduated senior high (STEM) this year.'],
    ['jomar.demo', 'Jomar Ignacio', 'BSED', 'Wants to teach mathematics.'],
    ['celine.demo', 'Celine Robles', 'BSCS', ''],
  ]) student(username, name, program, 1, { status: 'pending', studentNo: '', appliedAt: new Date(Date.now() - rand() * 4 * 86400000).toISOString(), applicationNote: note });

  // ----- Sections -----
  const M = (days, start, end) => days.map((day) => ({ day, start, end }));
  const MW = (s, e) => M([1, 3], s, e);
  const TT = (s, e) => M([2, 4], s, e);
  const section = (code, name, termRec, teacher, meetings, capacity, extra = {}) =>
    add('sections', { courseId: C[code].id, termId: termRec.id, campusId: main.id, name, teacherId: teacher?.id || null, meetings, capacity, room: extra.room || `Room ${100 + data.sections.length}`, status: 'open', enrollmentKey: '', ...extra });
  const old = {
    IT101: section('IT101', 'A', past, T.juan, MW('08:00', '09:30'), 40),
    IT102: section('IT102', 'A', past, T.maria, TT('08:00', '09:30'), 40),
    GE101: section('GE101', 'A', past, T.ana, M([5], '08:00', '11:00'), 60),
    AGRI101: section('AGRI101', 'P', past, T.ramon, MW('07:30', '09:00'), 40, { room: 'Agri Bldg 1' }),
    BA101: section('BA101', 'P', past, T.liza, TT('10:30', '12:00'), 40),
    ED101: section('ED101', 'P', past, T.mark, MW('10:30', '12:00'), 40),
  };
  const cur = {
    // The ones the guides talk about
    IT201A: section('IT201', 'A', term, T.maria, MW('09:00', '10:30'), 30, { room: 'Lab 1' }),
    IT201B: section('IT201', 'B', term, T.juan, TT('13:00', '14:30'), 25, { room: 'Lab 2' }),
    IT210A: section('IT210', 'A', term, T.maria, TT('09:00', '10:30'), 3, { room: 'Lab 3' }), // full, with a waitlist
    IT220A: section('IT220', 'A', term, T.ana, MW('13:00', '14:30'), 30, { enrollmentKey: 'DB2026', room: 'Lab 4' }),
    IT202A: section('IT202', 'A', term, T.juan, MW('15:00', '16:30'), 30, { room: 'Lab 2' }),
    GE101B: section('GE101', 'B', term, T.ana, MW('09:00', '10:30'), 40),
    GE102A: section('GE102', 'A', term, T.juan, M([5], '08:00', '11:00'), 40),
    PE101A: section('PE101', 'A', term, T.ana, M([6], '08:00', '10:00'), 50, { room: 'Gym' }),
    // The rest of the campus
    IT101B: section('IT101', 'B', term, T.leo, MW('07:30', '09:00'), 35, { room: 'Lab 5' }),
    IT102B: section('IT102', 'B', term, T.leo, MW('10:30', '12:00'), 35, { room: 'Lab 5' }),
    CS201A: section('CS201', 'A', term, T.leo, TT('07:30', '09:00'), 30),
    GE101C: section('GE101', 'C', term, T.grace, TT('13:00', '14:30'), 40),
    GE102B: section('GE102', 'B', term, T.grace, MW('15:00', '16:30'), 40),
    GE103A: section('GE103', 'A', term, T.grace, TT('10:30', '12:00'), 40),
    GE104A: section('GE104', 'A', term, T.ana, TT('15:00', '16:30'), 40),
    NSTP1A: section('NSTP1', 'A', term, T.mark, M([6], '10:00', '12:00'), 60, { room: 'Covered Court' }),
    PE101B: section('PE101', 'B', term, T.mark, M([6], '13:00', '15:00'), 50, { room: 'Gym' }),
    AGRI101A: section('AGRI101', 'A', term, T.ramon, MW('07:30', '09:00'), 35, { room: 'Agri Bldg 1' }),
    AGRI102A: section('AGRI102', 'A', term, T.ramon, TT('07:30', '09:00'), 35, { room: 'Agri Bldg 2' }),
    AGRI201A: section('AGRI201', 'A', term, T.ramon, MW('13:00', '14:30'), 30, { room: 'Soils Lab' }),
    BA101A: section('BA101', 'A', term, T.liza, MW('09:00', '10:30'), 40),
    BA102A: section('BA102', 'A', term, T.liza, TT('09:00', '10:30'), 40),
    BA201A: section('BA201', 'A', term, T.liza, MW('13:00', '14:30'), 35),
    ED101A: section('ED101', 'A', term, T.mark, MW('07:30', '09:00'), 35),
    ED102A: section('ED102', 'A', term, T.mark, TT('10:30', '12:00'), 35),
  };

  // ----- Enrollments -----
  let tick = 0;
  const at = () => new Date(Date.now() - 86400000 * 25 + 60000 * ++tick).toISOString();
  const enroll = (st, sec, status, extra = {}) => {
    const when = at();
    return add('enrollments', {
      studentId: st.id, sectionId: sec.id, courseId: sec.courseId, termId: sec.termId, status, requestedBy: 'student',
      createdAt: when, updatedAt: when, queuedAt: status === 'waitlisted' ? when : undefined, finalGrade: null, passed: null,
      history: [{ at: when, status, by: 'Demo data', note: 'Added with the demo data.' }], ...extra,
    });
  };
  const done = (grade) => ({ finalGrade: grade, passed: grade >= data.settings.passingGrade });
  const grade = () => Math.round(72 + rand() * 26);
  const programOf = (st) => Object.keys(P).find((code) => P[code].id === st.programId);

  // Last term: second-years finished their program's first courses
  for (const st of Object.values(S)) {
    if (st === S.kevin) continue; // a first-year with no history
    enroll(st, old.IT101, 'completed', done(85 + (st.name.length % 10)));
    enroll(st, old.IT102, 'completed', done(st === S.trisha ? 68 : 80 + (st.name.length % 15)));
    enroll(st, old.GE101, 'completed', done(88));
  }
  const FIRST_COURSES = { BSIT: ['IT101', 'IT102'], BSCS: ['IT101', 'IT102'], BSBA: ['BA101'], BSA: ['AGRI101'], BSED: ['ED101'] };
  for (const st of crowd.filter((s) => s.yearLevel === 2)) {
    for (const code of FIRST_COURSES[programOf(st)]) enroll(st, old[code], 'completed', done(grade()));
    enroll(st, old.GE101, 'completed', done(grade()));
  }

  // This term: the guides' students, as written in the README
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
  for (const st of [S.jasmine, S.miguel, S.rafael]) enroll(st, cur.CS201A, 'enrolled');
  for (const st of [S.trisha, S.paolo, S.angela]) enroll(st, cur.GE103A, 'enrolled');

  // This term: everyone else takes their program's courses, without clashes or full sections
  const LOAD = {
    'BSIT-1': ['IT101', 'IT102', 'GE101', 'GE102', 'NSTP1', 'PE101'],
    'BSIT-2': ['IT201', 'IT220', 'GE102', 'GE103', 'GE104', 'PE101'],
    'BSCS-1': ['IT101', 'IT102', 'GE101', 'GE102', 'NSTP1'],
    'BSCS-2': ['IT201', 'CS201', 'GE102', 'GE103', 'GE104'],
    'BSBA-1': ['BA101', 'BA102', 'GE101', 'GE102', 'NSTP1', 'PE101'],
    'BSBA-2': ['BA201', 'BA102', 'GE103', 'GE104', 'GE102'],
    'BSA-1': ['AGRI101', 'AGRI102', 'GE101', 'GE102', 'NSTP1', 'PE101'],
    'BSA-2': ['AGRI201', 'AGRI102', 'GE103', 'GE104', 'GE102'],
    'BSED-1': ['ED101', 'ED102', 'GE101', 'GE102', 'NSTP1', 'PE101'],
    'BSED-2': ['ED102', 'GE103', 'GE104', 'GE102', 'PE101'],
  };
  const seats = (sec) => data.enrollments.filter((e) => e.sectionId === sec.id && ['enrolled', 'pending'].includes(e.status)).length;
  const keep = new Set([cur.IT210A, cur.IT220A, cur.IT202A]); // kept as the guides describe them
  for (const st of crowd) {
    const mine = [];
    for (const code of LOAD[`${programOf(st)}-${st.yearLevel}`]) {
      const options = Object.values(cur).filter((s) => s.courseId === C[code].id && !keep.has(s) && seats(s) < s.capacity && !mine.some((m) => meetingsClash(m.meetings, s.meetings)));
      if (!options.length) continue;
      const sec = options.sort((a, b) => seats(a) - seats(b))[0];
      mine.push(sec);
      const r = rand();
      if (r < 0.05) {
        const e = enroll(st, sec, 'dropped');
        e.history.unshift({ at: e.createdAt, status: 'enrolled', by: 'Demo data', note: 'Enrolled.' });
        e.history.at(-1).note = 'Dropped by the student.';
        mine.pop();
      } else enroll(st, sec, r < 0.14 ? 'pending' : 'enrolled');
    }
  }
  // A few late requests: one rejected, two more on the full IT210 A waitlist
  const late = crowd.filter((s) => programOf(s) === 'BSIT' && s.yearLevel === 2);
  if (late[0]) {
    const e = enroll(late[0], cur.IT202A, 'rejected');
    e.history = [{ at: e.createdAt, status: 'pending', by: late[0].name, note: 'Requested by the student.' }, { at: at(), status: 'rejected', by: 'Rosa Villanueva', note: 'IT201 has to be passed first.' }];
  }
  for (const st of late.slice(1, 3)) enroll(st, cur.IT210A, 'waitlisted');

  // ----- The three smaller campuses: same courses, their own teachers, students and classes -----
  const MINI = [
    [sipocot, [['Elena Bonifacio', 'ebonifacio'], ['Rico Abad', 'rabad']], ['AGRI101', 'ED101'], ['BSA', 'BSED']],
    [pasacao, [['Teresa Llamas', 'tllamas'], ['Dennis Ortiz', 'dortiz']], ['BA101', 'IT101'], ['BSBA', 'BSIT']],
    [calabanga, [['Gloria Pineda', 'gpineda'], ['Arnel Cruzado', 'acruzado']], ['AGRI101', 'BA101'], ['BSA', 'BSBA']],
  ];
  const miniSections = [];
  MINI.forEach(([campus, teachers, programCourses, programs], ci) => {
    const [ta, tb] = teachers.map(([name, user], i) => person('teacher', `${user}.demo`, name, { department: i ? 'General Education' : 'Faculty', employeeNo: `T-${2001 + ci * 10 + i}`, campusIds: [campus.id] }));
    const place = { campusId: campus.id };
    const secs = {
      GE101: section('GE101', 'A', term, ta, MW('08:00', '09:30'), 40, place),
      GE102: section('GE102', 'A', term, ta, TT('08:00', '09:30'), 40, place),
      NSTP1: section('NSTP1', 'A', term, tb, M([6], '08:00', '10:00'), 50, { ...place, room: 'Covered Court' }),
      PE101: section('PE101', 'A', term, tb, M([6], '10:00', '12:00'), 50, { ...place, room: 'Gym' }),
      [programCourses[0]]: section(programCourses[0], 'A', term, tb, MW('10:00', '11:30'), 35, place),
      [programCourses[1]]: section(programCourses[1], 'A', term, ta, TT('10:00', '11:30'), 35, place),
    };
    miniSections.push(...Object.values(secs));
    for (let i = 0; i < 12; i++, k++) {
      const program = programs[i % 2];
      const first = FIRST[k % FIRST.length];
      const last = LAST[(k * 7 + Math.floor(k / FIRST.length)) % LAST.length];
      const username = `${first.split(' ')[0]}.${last.replace(/\s+/g, '')}`.toLowerCase();
      const st = student(taken('username', username) ? `${username}${k}` : username, `${first} ${last}`, program, 1, { campusIds: [campus.id] });
      const mine = ['GE101', 'GE102', 'NSTP1', 'PE101', programCourses[programs.indexOf(program)]];
      for (const code of mine) enroll(st, secs[code], rand() < 0.1 ? 'pending' : 'enrolled');
    }
  });
  // Maria Santos also teaches a Friday class at Sipocot (she switches campus to see it).
  const mariaSipocot = section('IT101', 'S1', term, T.maria, M([5], '13:00', '16:00'), 30, { campusId: sipocot.id, room: 'Sipocot Lab' });
  miniSections.push(mariaSipocot);
  for (const st of data.users.filter((u) => u.demo && u.role === 'student' && u.status === 'active' && u.campusIds[0] === sipocot.id).slice(0, 8)) enroll(st, mariaSipocot, 'enrolled');

  // ----- Class content -----
  const Q = (type, prompt, points, extra) => ({ id: randomUUID(), type, prompt, points, ...extra });
  const opt = (text, correct = false) => ({ id: randomUUID(), text, correct });
  const inClass = (sec) => data.enrollments.filter((e) => e.sectionId === sec.id && e.status === 'enrolled').map((e) => findById(data.users, e.studentId));
  const teacherOf = (sec) => findById(data.users, sec.teacherId);
  const addAttempt = (quiz, st, answers, manual = {}, when = at()) => scoreAttempt(quiz, add('attempts', {
    assignmentId: quiz.id, studentId: st.id, startedAt: when, deadline: when, submittedAt: when, answers, manualScores: manual, feedback: {}, order: null,
  }));

  // IT201 A (Maria Santos): the class the guides walk through
  const sec = cur.IT201A;
  [
    ['Week 1: Classes and objects', 'We model real things as objects: a class describes them, an object is one of them.\n\nRead the notes, then try the exercises at the end before Wednesday.', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes'],
    ['Week 2: Collections', 'Arrays, maps and sets: when to use which, and how to loop over them.', ''],
    ['Week 3: Testing your code', 'Small automated tests catch mistakes early. We write tests for the BankAccount class.', ''],
    ['Week 4: Reading and writing files', 'Draft notes. Published next week.', ''],
  ].forEach(([title, body, link], i) => add('lessons', { sectionId: sec.id, title, body, link, order: i + 1, published: i < 3 }));
  add('announcements', { sectionId: sec.id, title: 'Welcome to Programming 2', body: 'Bring a laptop to every lab session. Office hours: Tuesdays 3–5 PM, Faculty Room 2.', authorId: T.maria.id, authorName: T.maria.name, createdAt: addDays(today, -20) + 'T08:00:00.000Z' });
  add('announcements', { sectionId: sec.id, title: 'Lab 1 moved to Room 204', body: 'Only for this Wednesday.', authorId: T.maria.id, authorName: T.maria.name, createdAt: addDays(today, -1) + 'T08:00:00.000Z' });
  const a1 = add('assignments', { sectionId: sec.id, kind: 'task', typeId: typeId('task'), title: 'Exercise 1: A BankAccount class', instructions: 'Write a BankAccount class with deposit, withdraw and balance. Withdrawals may not go below zero.', dueAt: `${addDays(today, -1)}T23:59`, points: 20, allowLate: true, published: true });
  const a2 = add('assignments', { sectionId: sec.id, kind: 'task', typeId: typeId('task'), title: 'Exercise 2: Word counter', instructions: 'Read a paragraph and print each word with how many times it appears, most frequent first.', dueAt: `${addDays(today, 6)}T23:59`, points: 30, allowLate: false, published: true });
  add('assignments', { sectionId: sec.id, kind: 'task', typeId: typeId('task'), title: 'Project proposal', instructions: 'One page: the problem, who it is for, and what your program will do.', dueAt: `${addDays(today, 20)}T23:59`, points: 50, allowLate: false, published: false });
  const submit = (st, x, extra) => add('submissions', { assignmentId: x.id, studentId: st.id, text: 'class BankAccount { … }', link: '', submittedAt: at(), late: false, score: null, feedback: '', gradedAt: null, attempts: 1, ...extra });
  submit(S.carlo, a1, { score: 18, feedback: 'Good work. Check the withdraw rule for exactly zero.', gradedAt: now, gradedBy: T.maria.name });
  submit(S.bea, a1, { score: 20, feedback: 'Excellent.', gradedAt: now, gradedBy: T.maria.name });
  submit(S.paolo, a1, {});
  submit(S.angela, a1, { late: true });
  submit(S.bea, a2, { text: 'Uses a Map and sorts by count.' });
  const quiz1 = add('assignments', {
    sectionId: sec.id, kind: 'quiz', typeId: typeId('short-quiz'),
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
  quiz1.points = quizPoints(quiz1.questions);
  const exam = add('assignments', {
    sectionId: sec.id, kind: 'quiz', typeId: typeId('exam'),
    title: 'Midterm examination', instructions: 'One attempt, 60 minutes. Answers are shown after the exam closes.', opensAt: `${addDays(today, 14)}T08:00`, dueAt: `${addDays(today, 14)}T17:00`,
    published: true, allowLate: false, quiz: { timeLimit: 60, attempts: 1, shuffle: true, showResults: 'after_close' },
    questions: [Q('single', 'A class is a…', 2, { options: [opt('blueprint for objects', true), opt('kind of loop'), opt('database table')] }), Q('essay', 'Describe encapsulation with an example.', 10, {})],
  });
  exam.points = quizPoints(exam.questions);
  const [q1, q2, q3, q4, q5] = quiz1.questions;
  const right = { [q1.id]: q1.options[1].id, [q2.id]: q2.options.slice(0, 3).map((o) => o.id), [q3.id]: false, [q4.id]: 'method' };
  addAttempt(quiz1, S.bea, { ...right, [q5.id]: 'A class describes the shape; an object is one thing made from it, with its own values.' }, { [q5.id]: 5 });
  addAttempt(quiz1, S.paolo, { ...right, [q2.id]: [q2.options[0].id], [q5.id]: 'An object is made from a class.' });
  addAttempt(quiz1, S.angela, { [q1.id]: q1.options[0].id, [q3.id]: true, [q4.id]: 'function', [q5.id]: 'Not sure.' });
  let order = 0;
  if (files) {
    const f = files.save({ name: 'IT201 course outline.pdf', type: 'application/pdf', data: demoPdf('IT201 Computer Programming 2 - Course outline', ['Week 1: classes and objects', 'Week 2: collections', 'Week 3: testing', 'Grading: assignments 30%, quizzes 40%, exam 30%']).toString('base64') }, { sectionId: sec.id, owner: T.maria });
    add('resources', { sectionId: sec.id, kind: 'file', fileId: f.id, category: 'pdf', title: 'Course outline', description: 'Topics week by week, grading and class rules.', published: true, order: ++order, createdBy: T.maria.name });
  }
  add('resources', { sectionId: sec.id, kind: 'link', url: 'https://www.youtube.com/watch?v=pTB0EiLXUC8', category: 'video', title: 'Video: object-oriented programming in 7 minutes', description: '', published: true, order: ++order, createdBy: T.maria.name });
  add('resources', { sectionId: sec.id, kind: 'link', url: 'https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Objects', category: 'link', title: 'MDN: JavaScript objects', description: 'Reading for week 1.', published: true, order: ++order, createdBy: T.maria.name });

  // Every other class: three weeks of lessons, a welcome, a reading (scored), a task due
  // next week, a quiz most students have taken, notes as a PDF, and a link.
  const TOPICS = {
    IT201: ['Classes and objects', 'Collections', 'Testing your code'],
    IT210: ['HTML structure', 'CSS layout', 'JavaScript in the page'],
    IT220: ['The relational model', 'SQL queries', 'Joins'],
    IT202: ['Lists and arrays', 'Stacks and queues', 'Sorting'],
    IT101: ['What a computer is', 'Software and operating systems', 'Networks and the internet'],
    IT102: ['Variables and types', 'Decisions and loops', 'Functions'],
    CS201: ['Propositional logic', 'Sets and relations', 'Counting'],
    GE101: ['Communication and globalization', 'Academic writing', 'Presentations that work'],
    GE102: ['Patterns in nature', 'Logic and reasoning', 'Statistics for everyday life'],
    GE103: ['What globalization is', 'The global economy', 'Global governance'],
    GE104: ['Reading primary sources', 'Pre-colonial Philippines', 'The Cavite Mutiny'],
    PE101: ['Warm-up and stretching', 'Fitness testing', 'Movement and coordination'],
    NSTP1: ['Citizenship and service', 'Disaster preparedness', 'Community immersion planning'],
    AGRI101: ['Plant growth and development', 'Crop production systems', 'Pests and diseases'],
    AGRI102: ['Livestock breeds', 'Animal nutrition', 'Animal health'],
    AGRI201: ['How soils form', 'Soil fertility and nutrients', 'Soil sampling'],
    BA101: ['What managers do', 'Planning and decision making', 'Organizing'],
    BA102: ['The accounting equation', 'Journal and ledger', 'Financial statements'],
    BA201: ['Understanding customers', 'The marketing mix', 'Pricing'],
    ED101: ['Teaching as a profession', 'The Code of Ethics for teachers', 'The teacher and the community'],
    ED102: ['Theories of development', 'Cognitive development', 'Social and emotional growth'],
  };
  const QUIZ = {
    IT201: ['Which keyword creates an object from a class?', ['new', 'class', 'import']],
    IT210: ['Which language styles a web page?', ['CSS', 'HTML', 'SQL']],
    IT220: ['Which SQL statement reads rows?', ['SELECT', 'INSERT', 'DELETE']],
    IT202: ['Which structure is first in, first out?', ['Queue', 'Stack', 'Tree']],
    IT101: ['Which part of a computer runs the programs?', ['CPU', 'Monitor', 'Keyboard']],
    IT102: ['Which statement repeats code?', ['A loop', 'A comment', 'A variable']],
    CS201: ['If p is true and q is false, p AND q is…', ['false', 'true', 'unknown']],
    GE101: ['Which is a feature of academic writing?', ['Citing sources', 'Using slang', 'No paragraphs']],
    GE102: ['The Fibonacci sequence starts 1, 1, 2, 3, 5, …; the next number is', ['8', '7', '10']],
    GE103: ['Globalization mainly increases…', ['Connections between countries', 'Distance between countries', 'Trade barriers']],
    GE104: ['A primary source is…', ['Written at the time of the event', 'A modern textbook', 'An encyclopedia summary']],
    PE101: ['Why warm up before exercise?', ['To prepare the muscles', 'To get tired faster', 'It has no effect']],
    NSTP1: ['The first thing to do in an earthquake is to…', ['Drop, cover and hold', 'Run outside at once', 'Use the elevator']],
    AGRI101: ['Plants make their food through…', ['Photosynthesis', 'Respiration', 'Transpiration']],
    AGRI102: ['Which is a ruminant?', ['Carabao', 'Chicken', 'Pig']],
    AGRI201: ['The three main plant nutrients are N, P and…', ['K', 'Fe', 'Ca']],
    BA101: ['Setting goals and deciding how to reach them is…', ['Planning', 'Controlling', 'Staffing']],
    BA102: ['Assets = Liabilities + …', ["Owner's equity", 'Expenses', 'Revenue']],
    BA201: ['The 4 Ps are product, price, place and…', ['Promotion', 'People', 'Profit']],
    ED101: ['The Code of Ethics for Professional Teachers is issued by the…', ['PRC Board for Professional Teachers', 'Department of Health', 'Senate']],
    ED102: ['Piaget is best known for his theory of…', ['Cognitive development', 'Motivation', 'Language acquisition']],
  };
  const classDays = (s, count) => {
    const out = [];
    for (let i = 1; out.length < count && i < 60; i++) {
      const d = addDays(today, -i);
      if (d < term.startDate) break;
      if (s.meetings.some((m) => m.day === new Date(`${d}T00:00:00`).getDay())) out.unshift(d);
    }
    return out;
  };
  for (const s of [...Object.values(cur), ...miniSections]) {
    const students = inClass(s);
    const t = teacherOf(s);
    const c = findById(data.courses, s.courseId);
    const code = c.code.replace(/-DEMO$/, '');
    if (s !== sec) {
      const topics = TOPICS[code] || ['Introduction', 'Key ideas', 'Applications'];
      topics.forEach((topic, i) => add('lessons', {
        sectionId: s.id, title: `Week ${i + 1}: ${topic}`, order: i + 1, published: true, link: '',
        body: `This week: ${topic.toLowerCase()}.\n\nRead the notes under Resources before class, and bring your questions. We discuss the examples together and work on a short exercise in class.`,
      }));
      add('lessons', { sectionId: s.id, title: 'Week 4 (draft)', body: 'Notes for next week. Published on Monday.', link: '', order: 4, published: false });
      add('announcements', { sectionId: s.id, title: `Welcome to ${c.title}`, body: `Welcome! The course outline is under Resources. ${t ? `Consultation: ${pick(['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays'])} 3–5 PM.` : ''}`, authorId: t?.id, authorName: t?.name || 'Registrar', createdAt: addDays(term.startDate, 1) + 'T08:00:00.000Z' });
      if (rand() < 0.6) add('announcements', { sectionId: s.id, title: pick(['Reminder: bring your notebook', 'No class on Friday', 'Quiz 1 is open', 'Room change this week']), body: 'See you in class.', authorId: t?.id, authorName: t?.name || 'Registrar', createdAt: addDays(today, -Math.ceil(rand() * 5)) + 'T08:00:00.000Z' });

      const reading = add('assignments', { sectionId: s.id, kind: 'task', typeId: typeId('task'), title: `Reflection 1: ${topics[0]}`, instructions: `In one page, explain what you learned about ${topics[0].toLowerCase()} and one question you still have.`, opensAt: '', dueAt: `${addDays(today, -6)}T23:59`, points: 20, allowLate: true, published: true });
      const task = add('assignments', { sectionId: s.id, kind: 'task', typeId: typeId('task'), title: `Activity 2: ${topics[1]}`, instructions: `Answer the exercise sheet on ${topics[1].toLowerCase()} (under Resources) and hand in your answers.`, opensAt: '', dueAt: `${addDays(today, 3 + Math.floor(rand() * 6))}T23:59`, points: 30, allowLate: false, published: true });
      const [prompt, [good, ...wrong]] = QUIZ[code] || ['Which is correct?', ['A', 'B', 'C']];
      const quiz = add('assignments', {
        sectionId: s.id, kind: 'quiz', typeId: typeId('short-quiz'), title: `Quiz 1: ${topics[0]}`, instructions: 'Fifteen minutes, one attempt.',
        opensAt: `${addDays(today, -8)}T08:00`, dueAt: `${addDays(today, 2)}T23:59`, published: true, allowLate: false,
        quiz: { timeLimit: 15, attempts: 1, shuffle: true, showResults: 'after_close' },
        questions: [
          Q('single', prompt, 2, { options: [opt(good, true), ...wrong.map((w) => opt(w))].sort((a, b) => a.text.localeCompare(b.text)) }),
          Q('truefalse', `${topics[0]} is one of the topics of ${c.title}.`, 1, { answer: true }),
          Q('truefalse', `${c.title} has no lessons this term.`, 1, { answer: false }),
          Q('essay', `In a few sentences, explain one idea from "${topics[0]}" in your own words.`, 6, {}),
        ],
      });
      quiz.points = quizPoints(quiz.questions);
      const [qs, qt1, qt2, qe] = quiz.questions;
      const goodOpt = qs.options.find((o) => o.correct).id;
      for (const st of students) {
        // Reflection: most handed in, most of those scored
        const r = rand();
        if (r < 0.85) {
          const scored = r < 0.72;
          add('submissions', {
            assignmentId: reading.id, studentId: st.id, text: `My reflection on ${topics[0].toLowerCase()}: the main idea I learned is how it is used in practice. My question: how is it applied in the province?`,
            link: '', submittedAt: new Date(Date.now() - (6 + rand() * 3) * 86400000).toISOString(), late: rand() < 0.1, attempts: 1,
            score: scored ? Math.min(20, Math.round(13 + rand() * 8)) : null, feedback: scored ? pick(['Good work.', 'Clear and well written.', 'Add an example next time.', 'Good question at the end.', '']) : '',
            gradedAt: scored ? now : null, gradedBy: scored ? t?.name : undefined,
          });
        }
        // Activity 2: a few already handed in
        if (rand() < 0.3) add('submissions', { assignmentId: task.id, studentId: st.id, text: 'My answers are attached in the text below.\n1. …\n2. …', link: '', submittedAt: new Date(Date.now() - rand() * 2 * 86400000).toISOString(), late: false, attempts: 1, score: null, feedback: '', gradedAt: null });
        // Quiz: most took it; essays scored for about half
        if (rand() < 0.75) {
          const answers = { [qs.id]: rand() < 0.75 ? goodOpt : qs.options.find((o) => !o.correct).id, [qt1.id]: rand() < 0.9, [qt2.id]: rand() < 0.15, [qe.id]: `${topics[0]} matters because it explains what we see in real life. One example is from our barangay.` };
          addAttempt(quiz, st, answers, rand() < 0.5 ? { [qe.id]: Math.round(3 + rand() * 3) } : {}, new Date(Date.now() - rand() * 6 * 86400000).toISOString());
        }
      }
      // Notes as a PDF and a reading link
      let ro = 0;
      if (files && students.length) {
        const f = files.save({ name: `${code} course outline.pdf`, type: 'application/pdf', data: demoPdf(`${code} ${c.title} - Course outline`, topics.map((x, i) => `Week ${i + 1}: ${x}`).concat(['Grading: assignments 30%, quizzes 40%, exam 30%'])).toString('base64') }, { sectionId: s.id, owner: t || T.ana });
        add('resources', { sectionId: s.id, kind: 'file', fileId: f.id, category: 'pdf', title: 'Course outline', description: 'Topics, requirements and grading.', published: true, order: ++ro, createdBy: t?.name });
      }
      add('resources', { sectionId: s.id, kind: 'link', url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(topics[0])}`, category: 'link', title: `Reading: ${topics[0]}`, description: 'Background reading for week 1.', published: true, order: ++ro, createdBy: t?.name });
    }
    // Attendance for the class days so far this term (mostly present)
    const days = classDays(s, s === sec ? 4 : 6);
    days.forEach((date) => {
      const records = Object.fromEntries(students.map((st) => {
        const r = rand();
        return [st.id, r < 0.82 ? 'present' : r < 0.91 ? 'late' : r < 0.97 ? 'absent' : 'excused'];
      }));
      if (Object.keys(records).length) add('attendance', { sectionId: s.id, date, takenBy: t?.name || 'Registrar', updatedAt: now, records });
    });
  }

  // ----- School news and events -----
  const everyone = [...Object.values(S), ...crowd];
  const some = (share) => everyone.filter(() => rand() < share).map((u) => u.id);
  const comment = (u, body, daysAgo) => ({ id: randomUUID(), userId: u.id, name: u.name, role: u.role, body, createdAt: `${addDays(today, -daysAgo)}T10:00:00.000Z` });
  add('news', { campusId: null, title: 'Enrollment for the current term is open', body: 'Request your sections under Enrollment in the learning portal. Requests are reviewed by the registrar within two working days.\n\nFull sections take a waitlist: you move up automatically when a seat frees up.', authorId: null, authorName: 'Office of the Registrar', pinned: true, commentsOff: false, createdAt: `${addDays(today, -30)}T09:00:00.000Z`, reactions: { like: some(0.4), celebrate: [S.carlo.id, ...some(0.1)] }, comments: [comment(S.paolo, 'Is IT210 opening another section?', 28), comment(T.maria, 'We are asking the registrar. Join the waitlist for now.', 27)] });
  add('news', { campusId: null, title: 'Midterm examinations schedule', body: 'Midterm examinations run for one week, starting in two weeks. Check each class for the exact time and room. Bring your school ID and a blue or black pen.', authorId: null, authorName: 'Office of the Registrar', pinned: false, commentsOff: false, createdAt: `${addDays(today, -3)}T09:00:00.000Z`, reactions: { like: some(0.3) }, comments: [comment(crowd[2], 'Will there be a make-up exam schedule?', 2)] });
  add('news', { campusId: main.id, title: 'Library hours extended during exams', body: 'The library is open until 9 PM on weekdays for the next three weeks.', authorId: null, authorName: 'Rosa Villanueva', pinned: false, commentsOff: true, createdAt: `${addDays(today, -2)}T09:00:00.000Z`, reactions: { love: [S.angela.id, ...some(0.15)] }, comments: [] });
  add('news', { campusId: null, title: 'Scholarship applications now open', body: 'Students with a general weighted average of 85 or higher may apply for the academic scholarship. Forms are at the Office of Student Affairs until the end of the month.', authorId: null, authorName: 'Office of Student Affairs', pinned: false, commentsOff: false, createdAt: `${addDays(today, -9)}T09:00:00.000Z`, reactions: { like: some(0.25), celebrate: some(0.1) }, comments: [comment(crowd[7], 'Does it cover second-years?', 8), comment(crowd[11], 'Thank you for this!', 8)] });
  add('news', { campusId: main.id, title: 'Agriculture students win regional quiz bee', body: 'Congratulations to our BS Agriculture team for winning first place in the regional agriculture quiz bee! Thank you to their coach, Prof. Ramon Villareal.', authorId: null, authorName: 'Public Information Office', pinned: false, commentsOff: false, createdAt: `${addDays(today, -12)}T09:00:00.000Z`, reactions: { celebrate: some(0.35), love: some(0.15) }, comments: [comment(T.ramon, 'Proud of you all!', 11)] });
  add('news', { campusId: main.id, title: 'New computer laboratory opens', body: 'Lab 5, with 40 new computers, is open for classes and for students from 7 AM to 7 PM.', authorId: null, authorName: 'College of Computing', pinned: false, commentsOff: false, createdAt: `${addDays(today, -18)}T09:00:00.000Z`, reactions: { like: some(0.3) }, comments: [] });
  for (const [campus, title] of [[sipocot, 'Welcome to Sipocot Campus'], [pasacao, 'Pasacao Campus coastal clean-up this Saturday'], [calabanga, 'Calabanga Campus farm visit for first-years']]) {
    add('news', { campusId: campus.id, title, body: 'Details from the campus administrator. See you there!', authorId: null, authorName: `${campus.name} Office`, pinned: false, commentsOff: false, createdAt: `${addDays(today, -4)}T09:00:00.000Z`, reactions: { like: [] }, comments: [] });
  }
  for (const [campus, title, description, location, start, end, from, to] of [
    [null, 'Last day to request sections', 'Enrollment requests close at the end of the day.', 'Learning portal', 20, 20, '', ''],
    [null, 'University intramurals', 'Opening parade and games across campus. Classes are suspended in the afternoon.', 'Main grounds', 9, 11, '08:00', '17:00'],
    [null, 'Midterm examinations week', '', '', 14, 18, '', ''],
    [main, 'Career fair', 'Meet employers and partner companies. Bring copies of your résumé.', 'Gymnasium', 26, 26, '09:00', '16:00'],
    [null, 'Foundation Day', 'Mass, program and alumni homecoming.', 'University grounds', 40, 40, '07:00', '21:00'],
    [null, 'Final examinations week', '', '', 92, 96, '', ''],
    [sipocot, 'Sipocot Campus clean-up drive', 'Bring gloves and a water bottle.', 'Sipocot Campus grounds', 6, 6, '07:00', '10:00'],
    [pasacao, 'Pasacao Campus coastal clean-up', '', 'Pasacao beach', 5, 5, '06:00', '09:00'],
    [calabanga, 'Farm visit for first-years', 'Buses leave at 7:00 AM.', 'Calabanga demo farm', 8, 8, '07:00', '15:00'],
  ]) add('events', { campusId: campus?.id ?? null, title, description, location, startDate: addDays(today, start), endDate: addDays(today, end), startTime: from, endTime: to, createdBy: 'Demo data' });

  // ----- Parents & guardians: Carlo's mother (who is also Kevin's guardian, with fewer views) and father -----
  const allViews = { enrollment: true, schedule: true, grades: true, attendance: true, activities: true };
  const mother = person('guardian', 'parent.demo', 'Lorna Reyes', { phone: '0917 555 0142', email: 'lorna.reyes@example.com' });
  const father = person('guardian', 'father.demo', 'Roberto Reyes', { phone: '0918 555 0199', email: 'roberto.reyes@example.com' });
  add('guardianLinks', { guardianId: mother.id, studentId: S.carlo.id, relationship: 'Mother', views: allViews, status: 'active', createdBy: 'Rosa Villanueva', lastViewedAt: `${addDays(today, -1)}T11:20:00.000Z` });
  add('guardianLinks', { guardianId: mother.id, studentId: S.kevin.id, relationship: 'Aunt / Uncle', views: { ...allViews, enrollment: false, schedule: false }, status: 'active', createdBy: 'Rosa Villanueva' });
  add('guardianLinks', { guardianId: father.id, studentId: S.carlo.id, relationship: 'Father', views: { ...allViews, activities: false }, status: 'active', createdBy: 'Rosa Villanueva' });

  // ----- HRIS: employee records for these people, HR/payroll/staff sign-ins, attendance, leave, payroll -----
  const userByName = (username) => data.users.find((u) => u.demo && (u.username === username || u.username === `${username}2`));
  addHrisDemo(data, today, { campuses: { main, sipocot, pasacao, calabanga }, userByName, person, rand, files, demoPdf });

  return demoStatus(data);
}

// A one-page PDF with a line of text, for the demo resource preview.
function demoPdf(title, lines = []) {
  const esc = (s) => String(s).replace(/[()\\]/g, '').replace(/[^\x20-\x7e]/g, '-');
  const stream = `BT /F1 18 Tf 60 760 Td (${esc(title)}) Tj 0 -36 Td /F1 12 Tf ${lines.map((l) => `(${esc(l)}) Tj 0 -18 Td`).join(' ')} ET`;
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
