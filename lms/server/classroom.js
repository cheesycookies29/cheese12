// Learning-portal routes for teachers and students: classes, class lists, lessons,
// announcements, assignments and submissions, grades and the weekly schedule.
// Each route names its module; the router refuses it when the administrator has
// switched that module off for the caller's account type (shared/modules.js).
import { randomUUID } from 'node:crypto';
import { HttpError, DATETIME_RE, text } from './util.js';
import { findById, sectionView, enrollmentView, STATUS_LABELS } from './enrollment.js';
import { moduleOn } from '../shared/modules.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const IN_CLASS = ['enrolled', 'completed'];
const round1 = (n) => Math.round(n * 10) / 10;

export function registerClassroomRoutes(route, ctx) {
  const { db, nowLocal } = ctx;
  const data = () => db.data;
  const save = () => db.save();
  const iso = () => new Date().toISOString();

  // The section, if this user teaches it or is (or was) enrolled in it.
  function access(user, sectionId) {
    const section = findById(data().sections, sectionId);
    if (!section || section.status === 'cancelled') fail('Class not found.', 404);
    if (user.role === 'teacher') {
      if (section.teacherId !== user.id) fail('Class not found.', 404);
      return { section, teacher: true, enrollment: null };
    }
    const enrollment = data().enrollments.find((e) => e.studentId === user.id && e.sectionId === section.id && IN_CLASS.includes(e.status));
    if (!enrollment) fail('You are not enrolled in this class.', 404);
    return { section, teacher: false, enrollment };
  }
  const teacherOnly = (a) => {
    if (!a.teacher) fail('Only the teacher of this class can do this.', 403);
    return a;
  };
  const studentsOf = (sectionId, statuses = IN_CLASS) =>
    data().enrollments.filter((e) => e.sectionId === sectionId && statuses.includes(e.status));

  function myClasses(user, termId) {
    const d = data();
    const sections = user.role === 'teacher'
      ? d.sections.filter((s) => s.teacherId === user.id && s.status !== 'cancelled')
      : d.enrollments.filter((e) => e.studentId === user.id && IN_CLASS.includes(e.status)).map((e) => findById(d.sections, e.sectionId)).filter(Boolean);
    return sections.filter((s) => !termId || s.termId === termId);
  }

  // ----- Home and classes -----
  route('GET', '/api/home', 'portal', ({ user }) => {
    const d = data();
    const termId = d.settings.currentTermId;
    const on = (m) => moduleOn(d.modules, m, user.role);
    const classes = myClasses(user, termId).map((s) => sectionView(d, s));
    const ids = new Set(classes.map((c) => c.id));
    const out = { term: findById(d.terms, termId) || null, classes, announcements: [], due: [], toGrade: [], requests: [] };
    if (on('announcements')) {
      out.announcements = d.announcements.filter((a) => ids.has(a.sectionId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
        .map((a) => ({ ...a, class: classes.find((c) => c.id === a.sectionId) }));
    }
    if (on('assignments')) {
      const live = d.assignments.filter((a) => ids.has(a.sectionId) && a.published);
      if (user.role === 'student') {
        out.due = live
          .filter((a) => !d.submissions.some((s) => s.assignmentId === a.id && s.studentId === user.id))
          .filter((a) => !a.dueAt || a.dueAt >= nowLocal() || a.allowLate)
          .sort((a, b) => (a.dueAt || '9').localeCompare(b.dueAt || '9'))
          .slice(0, 6)
          .map((a) => ({ ...a, class: classes.find((c) => c.id === a.sectionId) }));
      } else {
        out.toGrade = live
          .map((a) => ({ ...a, class: classes.find((c) => c.id === a.sectionId), waiting: d.submissions.filter((s) => s.assignmentId === a.id && s.score == null).length }))
          .filter((a) => a.waiting);
      }
    }
    if (user.role === 'student' && on('enrollment')) {
      out.requests = d.enrollments.filter((e) => e.studentId === user.id && ['pending', 'waitlisted'].includes(e.status)).map((e) => enrollmentView(d, e));
    }
    return out;
  });

  route('GET', '/api/classes', 'portal', ({ user, query }) => {
    const all = query.termId === 'all';
    return myClasses(user, all ? null : query.termId || data().settings.currentTermId)
      .map((s) => ({ ...sectionView(data(), s), students: studentsOf(s.id).length }))
      .sort((a, b) => a.course.code.localeCompare(b.course.code));
  });

  route('GET', '/api/classes/:id', 'portal', ({ user, params }) => {
    const a = access(user, params.id);
    return {
      ...sectionView(data(), a.section),
      students: studentsOf(a.section.id).length,
      role: a.teacher ? 'teacher' : 'student',
      enrollment: a.enrollment ? { id: a.enrollment.id, status: a.enrollment.status, finalGrade: a.enrollment.finalGrade, passed: a.enrollment.passed } : null,
    };
  });

  route('GET', '/api/classes/:id/roster', 'teacher', ({ user, params }) => {
    const a = access(user, params.id);
    return data().enrollments
      .filter((e) => e.sectionId === a.section.id && ['enrolled', 'completed', 'pending', 'waitlisted'].includes(e.status))
      .map((e) => {
        const v = enrollmentView(data(), e);
        const st = findById(data().users, e.studentId);
        return { id: e.id, status: e.status, statusLabel: STATUS_LABELS[e.status], position: v.position, student: { ...v.student, email: st?.email || '' }, createdAt: e.createdAt };
      })
      .sort((x, y) => (x.status === y.status ? x.student.name.localeCompare(y.student.name) : x.status.localeCompare(y.status)));
  }, { module: 'enrollment' });

  // ----- Lessons -----
  const lessonFields = (b) => {
    const l = { title: text(b.title, 200), body: text(b.body, 20000), link: text(b.link, 500), published: Boolean(b.published) };
    if (!l.title) fail('Lesson title is required.');
    if (l.link && !/^https?:\/\//i.test(l.link)) fail('Links must start with http:// or https://');
    return l;
  };
  route('GET', '/api/classes/:id/lessons', 'portal', ({ user, params }) => {
    const a = access(user, params.id);
    return data().lessons.filter((l) => l.sectionId === a.section.id && (a.teacher || l.published)).sort((x, y) => x.order - y.order);
  }, { module: 'lessons' });
  route('POST', '/api/classes/:id/lessons', 'teacher', ({ user, params, body }) => {
    const a = teacherOnly(access(user, params.id));
    const order = Math.max(0, ...data().lessons.filter((l) => l.sectionId === a.section.id).map((l) => l.order)) + 1;
    const l = { id: randomUUID(), sectionId: a.section.id, ...lessonFields(body), order, createdAt: iso() };
    data().lessons.push(l);
    save();
    return l;
  }, { module: 'lessons' });
  route('PUT', '/api/lessons/:id', 'teacher', ({ user, params, body }) => {
    const l = findById(data().lessons, params.id) || fail('Lesson not found.', 404);
    teacherOnly(access(user, l.sectionId));
    Object.assign(l, lessonFields(body), { updatedAt: iso() });
    if (body.move === 'up' || body.move === 'down') {
      const list = data().lessons.filter((x) => x.sectionId === l.sectionId).sort((x, y) => x.order - y.order);
      const i = list.indexOf(l);
      const other = list[body.move === 'up' ? i - 1 : i + 1];
      if (other) [l.order, other.order] = [other.order, l.order];
    }
    save();
    return l;
  }, { module: 'lessons' });
  route('DELETE', '/api/lessons/:id', 'teacher', ({ user, params }) => {
    const l = findById(data().lessons, params.id) || fail('Lesson not found.', 404);
    teacherOnly(access(user, l.sectionId));
    data().lessons.splice(data().lessons.indexOf(l), 1);
    save();
    return { ok: true };
  }, { module: 'lessons' });

  // ----- Announcements -----
  route('GET', '/api/classes/:id/announcements', 'portal', ({ user, params }) => {
    const a = access(user, params.id);
    return data().announcements.filter((x) => x.sectionId === a.section.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }, { module: 'announcements' });
  route('POST', '/api/classes/:id/announcements', 'teacher', ({ user, params, body }) => {
    const a = teacherOnly(access(user, params.id));
    const n = { id: randomUUID(), sectionId: a.section.id, title: text(body.title, 200), body: text(body.body, 10000), authorId: user.id, authorName: user.name, createdAt: iso() };
    if (!n.title) fail('Give the announcement a title.');
    data().announcements.push(n);
    save();
    return n;
  }, { module: 'announcements' });
  route('DELETE', '/api/announcements/:id', 'teacher', ({ user, params }) => {
    const n = findById(data().announcements, params.id) || fail('Announcement not found.', 404);
    teacherOnly(access(user, n.sectionId));
    data().announcements.splice(data().announcements.indexOf(n), 1);
    save();
    return { ok: true };
  }, { module: 'announcements' });

  // ----- Assignments and submissions -----
  const assignmentFields = (b) => {
    const x = {
      title: text(b.title, 200),
      instructions: text(b.instructions, 20000),
      dueAt: b.dueAt ? String(b.dueAt).slice(0, 16) : '',
      points: Number(b.points),
      allowLate: Boolean(b.allowLate),
      published: Boolean(b.published),
    };
    if (!x.title) fail('Assignment title is required.');
    if (x.dueAt && !DATETIME_RE.test(x.dueAt)) fail('Due date must be a date and time.');
    if (!(x.points > 0 && x.points <= 1000)) fail('Points must be between 1 and 1000.');
    return x;
  };
  const findAssignment = (id) => findById(data().assignments, id) || fail('Assignment not found.', 404);
  const submissionView = (s) => {
    const st = findById(data().users, s.studentId);
    return { ...s, student: st ? { id: st.id, name: st.name, studentNo: st.studentNo || '' } : null };
  };

  route('GET', '/api/classes/:id/assignments', 'portal', ({ user, params }) => {
    const a = access(user, params.id);
    const list = data().assignments.filter((x) => x.sectionId === a.section.id && (a.teacher || x.published));
    const total = studentsOf(a.section.id).length;
    return list
      .map((x) => {
        const subs = data().submissions.filter((s) => s.assignmentId === x.id);
        if (a.teacher) return { ...x, submitted: subs.length, graded: subs.filter((s) => s.score != null).length, students: total };
        const mine = subs.find((s) => s.studentId === user.id);
        return { ...x, mine: mine ? { submittedAt: mine.submittedAt, late: mine.late, score: mine.score, gradedAt: mine.gradedAt } : null };
      })
      .sort((x, y) => (x.dueAt || '9').localeCompare(y.dueAt || '9') || x.createdAt.localeCompare(y.createdAt));
  }, { module: 'assignments' });

  route('POST', '/api/classes/:id/assignments', 'teacher', ({ user, params, body }) => {
    const a = teacherOnly(access(user, params.id));
    const x = { id: randomUUID(), sectionId: a.section.id, ...assignmentFields(body), createdAt: iso() };
    data().assignments.push(x);
    save();
    return x;
  }, { module: 'assignments' });

  route('GET', '/api/assignments/:id', 'portal', ({ user, params }) => {
    const x = findAssignment(params.id);
    const a = access(user, x.sectionId);
    if (!a.teacher && !x.published) fail('Assignment not found.', 404);
    const subs = data().submissions.filter((s) => s.assignmentId === x.id);
    if (a.teacher) {
      const submitted = new Set(subs.map((s) => s.studentId));
      const missing = studentsOf(x.sectionId).filter((e) => !submitted.has(e.studentId)).map((e) => findById(data().users, e.studentId)).filter(Boolean).map((u) => ({ id: u.id, name: u.name, studentNo: u.studentNo || '' }));
      return { ...x, class: sectionView(data(), a.section), submissions: subs.map(submissionView).sort((p, q) => p.student.name.localeCompare(q.student.name)), missing };
    }
    return { ...x, class: sectionView(data(), a.section), mine: subs.find((s) => s.studentId === user.id) || null, closed: Boolean(x.dueAt && nowLocal() > x.dueAt && !x.allowLate) };
  }, { module: 'assignments' });

  route('PUT', '/api/assignments/:id', 'teacher', ({ user, params, body }) => {
    const x = findAssignment(params.id);
    teacherOnly(access(user, x.sectionId));
    const next = assignmentFields(body);
    if (next.points < x.points && data().submissions.some((s) => s.assignmentId === x.id && s.score > next.points)) fail('Some scores are higher than the new points. Change those scores first.');
    Object.assign(x, next, { updatedAt: iso() });
    save();
    return x;
  }, { module: 'assignments' });

  route('DELETE', '/api/assignments/:id', 'teacher', ({ user, params }) => {
    const x = findAssignment(params.id);
    teacherOnly(access(user, x.sectionId));
    data().assignments.splice(data().assignments.indexOf(x), 1);
    data().submissions = data().submissions.filter((s) => s.assignmentId !== x.id);
    save();
    return { ok: true };
  }, { module: 'assignments' });

  route('POST', '/api/assignments/:id/submit', 'student', ({ user, params, body }) => {
    const x = findAssignment(params.id);
    const a = access(user, x.sectionId);
    if (!x.published) fail('Assignment not found.', 404);
    if (a.enrollment.status !== 'enrolled') fail('This class has ended; submissions are closed.');
    const late = Boolean(x.dueAt && nowLocal() > x.dueAt);
    if (late && !x.allowLate) fail('The due date has passed and this assignment does not accept late work.');
    const content = text(body.text, 50000);
    const link = text(body.link, 500);
    if (!content && !link) fail('Write your answer or add a link to your work.');
    if (link && !/^https?:\/\//i.test(link)) fail('Links must start with http:// or https://');
    let s = data().submissions.find((y) => y.assignmentId === x.id && y.studentId === user.id);
    if (s?.score != null) fail('This work has been scored already. Ask your teacher if you need to resubmit.');
    if (!s) {
      s = { id: randomUUID(), assignmentId: x.id, studentId: user.id, score: null, feedback: '', gradedAt: null, attempts: 0 };
      data().submissions.push(s);
    }
    Object.assign(s, { text: content, link, submittedAt: iso(), late, attempts: (s.attempts || 0) + 1 });
    save();
    return s;
  }, { module: 'assignments' });

  route('POST', '/api/submissions/:id/grade', 'teacher', ({ user, params, body }) => {
    const s = findById(data().submissions, params.id) || fail('Submission not found.', 404);
    const x = findAssignment(s.assignmentId);
    teacherOnly(access(user, x.sectionId));
    if (body.score === '' || body.score == null) {
      Object.assign(s, { score: null, gradedAt: null, feedback: text(body.feedback, 5000) }); // returned for resubmission
    } else {
      const score = Number(body.score);
      if (!(score >= 0 && score <= x.points)) fail(`Score must be between 0 and ${x.points}.`);
      Object.assign(s, { score, feedback: text(body.feedback, 5000), gradedAt: iso(), gradedBy: user.name });
    }
    save();
    return submissionView(s);
  }, { module: 'assignments' });

  // ----- Grades -----
  // A student's running percentage from scored assignments (unscored work is left out).
  function standing(sectionId, studentId) {
    const items = data().assignments.filter((x) => x.sectionId === sectionId && x.published);
    let earned = 0;
    let possible = 0;
    const scores = {};
    for (const x of items) {
      const s = data().submissions.find((y) => y.assignmentId === x.id && y.studentId === studentId);
      scores[x.id] = s ? { score: s.score, submitted: true, late: s.late } : { score: null, submitted: false };
      if (s?.score != null) {
        earned += s.score;
        possible += x.points;
      }
    }
    return { scores, earned, possible, percent: possible ? round1((earned / possible) * 100) : null };
  }

  route('GET', '/api/classes/:id/gradebook', 'teacher', ({ user, params }) => {
    const a = access(user, params.id);
    const assignments = data().assignments.filter((x) => x.sectionId === a.section.id && x.published).map((x) => ({ id: x.id, title: x.title, points: x.points, dueAt: x.dueAt }));
    const rows = studentsOf(a.section.id).map((e) => {
      const st = findById(data().users, e.studentId);
      return { enrollmentId: e.id, status: e.status, finalGrade: e.finalGrade, passed: e.passed, student: { id: st?.id, name: st?.name || '?', studentNo: st?.studentNo || '' }, ...standing(a.section.id, e.studentId) };
    }).sort((x, y) => x.student.name.localeCompare(y.student.name));
    return { class: sectionView(data(), a.section), assignments, rows, passingGrade: data().settings.passingGrade };
  }, { module: 'grades' });

  route('PUT', '/api/classes/:id/final-grades', 'teacher', ({ user, params, body }) => {
    const a = access(user, params.id);
    const pass = data().settings.passingGrade;
    for (const g of Array.isArray(body.grades) ? body.grades : []) {
      const e = data().enrollments.find((x) => x.id === g.enrollmentId && x.sectionId === a.section.id && IN_CLASS.includes(x.status));
      if (!e) fail('A student in the list is not in this class.');
      if (g.grade === '' || g.grade == null) {
        if (e.status === 'completed') {
          Object.assign(e, { finalGrade: null, passed: null });
          e.history.push({ at: iso(), status: 'enrolled', by: user.name, note: 'Final grade removed.' });
          e.status = 'enrolled';
          e.updatedAt = iso();
        }
        continue;
      }
      const grade = Number(g.grade);
      if (!(grade >= 0 && grade <= 100)) fail('Final grades must be between 0 and 100.');
      if (e.finalGrade === grade && e.status === 'completed') continue;
      Object.assign(e, { finalGrade: grade, passed: grade >= pass, status: 'completed', gradedAt: iso(), updatedAt: iso() });
      e.history.push({ at: iso(), status: 'completed', by: user.name, note: `Final grade ${grade} (${grade >= pass ? 'passed' : 'failed'}).` });
    }
    save();
    return { ok: true };
  }, { module: 'grades' });

  route('GET', '/api/my/grades', 'student', ({ user }) => {
    const d = data();
    return d.enrollments
      .filter((e) => e.studentId === user.id && IN_CLASS.includes(e.status))
      .map((e) => {
        const s = findById(d.sections, e.sectionId);
        return { enrollmentId: e.id, status: e.status, finalGrade: e.finalGrade, passed: e.passed, class: s ? sectionView(d, s) : null, ...standing(e.sectionId, user.id) };
      })
      .filter((g) => g.class)
      .sort((a, b) => a.class.term.name.localeCompare(b.class.term.name) || a.class.course.code.localeCompare(b.class.course.code));
  }, { module: 'grades' });

  // ----- Schedule -----
  route('GET', '/api/schedule', 'portal', ({ user, query }) => {
    const d = data();
    const termId = query.termId || d.settings.currentTermId;
    if (user.role === 'teacher') return { termId, terms: d.terms, classes: myClasses(user, termId).map((s) => ({ ...sectionView(d, s), status: 'teaching' })) };
    const classes = d.enrollments
      .filter((e) => e.studentId === user.id && e.termId === termId && ['enrolled', 'pending', 'completed'].includes(e.status))
      .map((e) => ({ ...sectionView(d, findById(d.sections, e.sectionId)), status: e.status }));
    return { termId, terms: d.terms, classes };
  }, { module: 'schedule' });
}
