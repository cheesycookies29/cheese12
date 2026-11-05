// Learning-portal routes for teachers and students: classes, class lists, lessons,
// announcements, assignments and submissions, grades and the weekly schedule.
// Each route names its module; the router refuses it when the administrator has
// switched that module off for the caller's account type (shared/modules.js).
import { randomUUID } from 'node:crypto';
import { HttpError, DATETIME_RE, text } from './util.js';
import { findById, sectionView, enrollmentView, STATUS_LABELS } from './enrollment.js';
import { moduleOn } from '../shared/modules.js';
import { validateQuestions, quizPoints, scoreAttempt, bestAttempt, registerQuizRoutes } from './quiz.js';
import { registerResourceRoutes, fileInfo } from './files.js';
import { registerAttendanceRoutes } from './attendance.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const IN_CLASS = ['enrolled', 'completed'];
const round1 = (n) => Math.round(n * 10) / 10;
const SHOW_RESULTS = ['immediately', 'after_close', 'never'];

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

  // A teacher sees the sections they teach at the campus they have switched to;
  // a student sees their own classes (all at their one campus).
  function myClasses(user, termId, campusId) {
    const d = data();
    const sections = user.role === 'teacher'
      ? d.sections.filter((s) => s.teacherId === user.id && s.status !== 'cancelled' && (!campusId || s.campusId === campusId))
      : d.enrollments.filter((e) => e.studentId === user.id && IN_CLASS.includes(e.status)).map((e) => findById(d.sections, e.sectionId)).filter(Boolean);
    return sections.filter((s) => !termId || s.termId === termId);
  }

  // ----- Home and classes -----
  route('GET', '/api/home', 'portal', ({ user, campusId }) => {
    const d = data();
    const termId = d.settings.currentTermId;
    const on = (m) => moduleOn(d.modules, m, user.role);
    const classes = myClasses(user, termId, campusId).map((s) => sectionView(d, s));
    const ids = new Set(classes.map((c) => c.id));
    const out = { term: findById(d.terms, termId) || null, classes, announcements: [], due: [], upcoming: [], toGrade: [], requests: [], progress: {} };
    if (on('announcements')) {
      out.announcements = d.announcements.filter((a) => ids.has(a.sectionId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
        .map((a) => ({ ...a, class: classes.find((c) => c.id === a.sectionId) }));
    }
    if (on('assignments')) {
      const live = d.assignments.filter((a) => ids.has(a.sectionId) && a.published);
      if (user.role === 'student') {
        // To do: open work not handed in yet, soonest first, and anything overdue that still accepts work.
        out.due = live
          .filter((a) => isOpen(a) && !resultFor(a, user.id).submitted)
          .sort((a, b) => (a.dueAt || '9').localeCompare(b.dueAt || '9'))
          .slice(0, 8)
          .map((a) => ({ ...listView(a), overdue: Boolean(a.dueAt && nowLocal() > a.dueAt), class: classes.find((c) => c.id === a.sectionId) }));
        out.upcoming = live
          .filter((a) => a.opensAt && nowLocal() < a.opensAt)
          .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
          .slice(0, 4)
          .map((a) => ({ ...listView(a), class: classes.find((c) => c.id === a.sectionId) }));
        out.progress = Object.fromEntries(classes.map((c) => {
          const st = standing(c.id, user.id);
          return [c.id, { done: st.done, total: st.total, percent: st.percent }];
        }));
      } else {
        out.toGrade = live
          .map((a) => {
            const waiting = studentsOf(a.sectionId).filter((e) => resultFor(a, e.studentId).toGrade).length;
            return { ...listView(a), class: classes.find((c) => c.id === a.sectionId), waiting };
          })
          .filter((a) => a.waiting);
      }
    }
    if (on('news')) {
      out.events = ctx.upcomingEvents(campusId).slice(0, 4);
      out.news = d.news.filter((n) => n.campusId == null || n.campusId === campusId).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt.localeCompare(a.createdAt)).slice(0, 3).map(({ reactions, comments, ...n }) => ({ ...n, comments: comments?.length || 0 }));
    }
    if (user.role === 'student' && on('enrollment')) {
      out.requests = d.enrollments.filter((e) => e.studentId === user.id && ['pending', 'waitlisted'].includes(e.status)).map((e) => enrollmentView(d, e));
    }
    return out;
  });

  route('GET', '/api/classes', 'portal', ({ user, query, campusId }) => {
    const all = query.termId === 'all';
    return myClasses(user, all ? null : query.termId || data().settings.currentTermId, campusId)
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
  // Tasks (hand in work) and quizzes (questions answered in the portal, graded automatically).
  const assignmentFields = (b) => {
    const kind = b.kind === 'quiz' ? 'quiz' : 'task';
    const types = data().activityTypes.filter((t) => t.active !== false);
    const x = {
      kind,
      typeId: types.some((t) => t.id === b.typeId) ? b.typeId : (types.find((t) => t.id === (kind === 'quiz' ? 'short-quiz' : 'task')) || types[0])?.id || '',
      title: text(b.title, 200),
      instructions: text(b.instructions, 20000),
      opensAt: b.opensAt ? String(b.opensAt).slice(0, 16) : '',
      dueAt: b.dueAt ? String(b.dueAt).slice(0, 16) : '',
      points: Number(b.points),
      allowLate: kind === 'task' && Boolean(b.allowLate),
      published: Boolean(b.published),
    };
    if (!x.title) fail('Title is required.');
    if (x.opensAt && !DATETIME_RE.test(x.opensAt)) fail('Opening time must be a date and time.');
    if (x.dueAt && !DATETIME_RE.test(x.dueAt)) fail(`${kind === 'quiz' ? 'Closing' : 'Due'} time must be a date and time.`);
    if (x.opensAt && x.dueAt && x.dueAt <= x.opensAt) fail('It must close after it opens.');
    if (kind === 'quiz') {
      const q = b.quiz || {};
      x.quiz = {
        timeLimit: Math.max(0, Math.min(600, Math.floor(Number(q.timeLimit) || 0))), // minutes; 0 = none
        attempts: Math.max(0, Math.min(20, Math.floor(Number(q.attempts ?? 1)))), // 0 = unlimited
        shuffle: Boolean(q.shuffle),
        showResults: SHOW_RESULTS.includes(q.showResults) ? q.showResults : 'after_close',
      };
      x.questions = validateQuestions(b.questions);
      x.points = quizPoints(x.questions);
    } else if (!(x.points > 0 && x.points <= 1000)) fail('Points must be between 1 and 1000.');
    return x;
  };
  const isOpen = (x) => {
    const now = nowLocal();
    if (!x.published || (x.opensAt && now < x.opensAt)) return false;
    return !x.dueAt || now <= x.dueAt || (x.kind !== 'quiz' && x.allowLate);
  };
  // Without the questions (and their answer key), for lists.
  const listView = ({ questions, ...x }) => ({ ...x, kind: x.kind || 'task', questionCount: questions?.length || 0 });

  // One student's result on one activity: the scored submission, or the best quiz attempt.
  function resultFor(x, studentId) {
    if (x.kind === 'quiz') {
      const list = data().attempts.filter((t) => t.assignmentId === x.id && t.studentId === studentId);
      const best = bestAttempt(list);
      return { submitted: Boolean(best), attempts: list.filter((t) => t.submittedAt).length, inProgress: list.some((t) => !t.submittedAt), score: best && !best.needsGrading ? best.score : null, toGrade: Boolean(best?.needsGrading), late: false };
    }
    const sub = data().submissions.find((y) => y.assignmentId === x.id && y.studentId === studentId);
    return { submitted: Boolean(sub), score: sub?.score ?? null, toGrade: Boolean(sub && sub.score == null), late: Boolean(sub?.late), submittedAt: sub?.submittedAt };
  }

  const findAssignment = (id) => findById(data().assignments, id) || fail('Assignment not found.', 404);
  const submissionView = (s) => {
    const st = findById(data().users, s.studentId);
    return { ...s, file: fileInfo(data().files.find((f) => f.id === s.fileId)), student: st ? { id: st.id, name: st.name, studentNo: st.studentNo || '' } : null };
  };

  route('GET', '/api/classes/:id/assignments', 'portal', ({ user, params }) => {
    const a = access(user, params.id);
    const list = data().assignments.filter((x) => x.sectionId === a.section.id && (a.teacher || x.published));
    const total = studentsOf(a.section.id).length;
    const roster = studentsOf(a.section.id);
    return list
      .map((x) => {
        if (a.teacher) {
          const results = roster.map((e) => resultFor(x, e.studentId));
          return { ...listView(x), open: isOpen(x), submitted: results.filter((r) => r.submitted).length, graded: results.filter((r) => r.score != null).length, toGrade: results.filter((r) => r.toGrade).length, students: total };
        }
        const r = resultFor(x, user.id);
        return { ...listView(x), open: isOpen(x), mine: r.submitted || r.inProgress ? r : null };
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
    const mine = subs.find((s) => s.studentId === user.id);
    return { ...listView(x), class: sectionView(data(), a.section), mine: mine ? submissionView(mine) : null, closed: !isOpen(x), notOpenYet: Boolean(x.opensAt && nowLocal() < x.opensAt) };
  }, { module: 'assignments' });

  route('PUT', '/api/assignments/:id', 'teacher', ({ user, params, body }) => {
    const x = findAssignment(params.id);
    teacherOnly(access(user, x.sectionId));
    const next = assignmentFields({ ...body, kind: x.kind || 'task' }); // a task stays a task, a quiz a quiz
    if (next.kind === 'task' && next.points < x.points && data().submissions.some((s) => s.assignmentId === x.id && s.score > next.points)) fail('Some scores are higher than the new points. Change those scores first.');
    Object.assign(x, next, { updatedAt: iso() });
    // Questions may have changed: rescore every attempt (answers to removed questions are ignored).
    if (x.kind === 'quiz') for (const t of data().attempts.filter((t) => t.assignmentId === x.id)) scoreAttempt(x, t);
    save();
    return x;
  }, { module: 'assignments' });

  route('DELETE', '/api/assignments/:id', 'teacher', ({ user, params }) => {
    const x = findAssignment(params.id);
    teacherOnly(access(user, x.sectionId));
    data().assignments.splice(data().assignments.indexOf(x), 1);
    data().submissions = data().submissions.filter((s) => s.assignmentId !== x.id);
    data().attempts = data().attempts.filter((t) => t.assignmentId !== x.id);
    save();
    return { ok: true };
  }, { module: 'assignments' });

  route('POST', '/api/assignments/:id/submit', 'student', ({ user, params, body }) => {
    const x = findAssignment(params.id);
    const a = access(user, x.sectionId);
    if (!x.published) fail('Assignment not found.', 404);
    if (x.kind === 'quiz') fail('Quizzes are answered from the quiz page.');
    if (a.enrollment.status !== 'enrolled') fail('This class has ended; submissions are closed.');
    if (x.opensAt && nowLocal() < x.opensAt) fail('This activity has not opened yet.');
    const late = Boolean(x.dueAt && nowLocal() > x.dueAt);
    if (late && !x.allowLate) fail('The due date has passed and this assignment does not accept late work.');
    const content = text(body.text, 50000);
    const link = text(body.link, 500);
    const previous = data().submissions.find((y) => y.assignmentId === x.id && y.studentId === user.id);
    if (previous?.score != null) fail('This work has been scored already. Ask your teacher if you need to resubmit.');
    let fileId = body.keepFile && previous?.fileId ? previous.fileId : null;
    if (body.file) {
      const f = ctx.files.save(body.file, { sectionId: x.sectionId, owner: user });
      f.private = true; // only the student and the teacher can open it
      if (previous?.fileId && previous.fileId !== f.id) ctx.files.remove(previous.fileId);
      fileId = f.id;
    } else if (previous?.fileId && !fileId) ctx.files.remove(previous.fileId);
    if (!content && !link && !fileId) fail('Write your answer, attach a file or add a link to your work.');
    if (link && !/^https?:\/\//i.test(link)) fail('Links must start with http:// or https://');
    let s = previous;
    if (!s) {
      s = { id: randomUUID(), assignmentId: x.id, studentId: user.id, score: null, feedback: '', gradedAt: null, attempts: 0 };
      data().submissions.push(s);
    }
    Object.assign(s, { text: content, link, fileId, submittedAt: iso(), late, attempts: (s.attempts || 0) + 1 });
    save();
    return { ...s, file: fileInfo(data().files.find((f) => f.id === s.fileId)) };
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
  // A student's running grade from scored work (unscored work is left out).
  // When activity types have weights, each type's percentage counts by its weight
  // (spread over the types that have scored work so far); otherwise every point counts the same.
  function standing(sectionId, studentId) {
    const items = data().assignments.filter((x) => x.sectionId === sectionId && x.published);
    const types = data().activityTypes;
    const weighted = types.some((t) => Number(t.weight) > 0);
    let earned = 0;
    let possible = 0;
    const byType = {};
    const scores = {};
    for (const x of items) {
      const r = resultFor(x, studentId);
      scores[x.id] = r;
      if (r.score == null) continue;
      earned += r.score;
      possible += x.points;
      const t = types.find((y) => y.id === x.typeId) ? x.typeId : types[0]?.id;
      byType[t] ||= { earned: 0, possible: 0 };
      byType[t].earned += r.score;
      byType[t].possible += x.points;
    }
    let percent = possible ? (earned / possible) * 100 : null;
    if (weighted && possible) {
      let sum = 0;
      let weights = 0;
      for (const [id, v] of Object.entries(byType)) {
        const w = Number(types.find((t) => t.id === id)?.weight) || 0;
        if (!w || !v.possible) continue;
        sum += (v.earned / v.possible) * w;
        weights += w;
      }
      percent = weights ? sum / weights * 100 : percent;
    }
    const done = items.filter((x) => scores[x.id].submitted).length;
    return { scores, earned: round1(earned), possible, percent: percent == null ? null : round1(percent), weighted, done, total: items.length };
  }

  route('GET', '/api/classes/:id/gradebook', 'teacher', ({ user, params }) => {
    const a = access(user, params.id);
    const assignments = data().assignments.filter((x) => x.sectionId === a.section.id && x.published).map((x) => ({ id: x.id, title: x.title, points: x.points, dueAt: x.dueAt, kind: x.kind || 'task', typeId: x.typeId }));
    const rows = studentsOf(a.section.id).map((e) => {
      const st = findById(data().users, e.studentId);
      return { enrollmentId: e.id, status: e.status, finalGrade: e.finalGrade, passed: e.passed, student: { id: st?.id, name: st?.name || '?', studentNo: st?.studentNo || '' }, ...standing(a.section.id, e.studentId) };
    }).sort((x, y) => x.student.name.localeCompare(y.student.name));
    return { class: sectionView(data(), a.section), assignments, rows, passingGrade: data().settings.passingGrade, types: data().activityTypes };
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

  registerQuizRoutes(route, ctx, { access, findAssignment, isOpen });
  registerResourceRoutes(route, ctx, { access, files: ctx.files });
  registerAttendanceRoutes(route, ctx, { access, studentsOf });

  route('GET', '/api/activity-types', 'portal', () => data().activityTypes);

  // ----- Schedule -----
  route('GET', '/api/schedule', 'portal', ({ user, query, campusId }) => {
    const d = data();
    const termId = query.termId || d.settings.currentTermId;
    if (user.role === 'teacher') return { termId, terms: d.terms, classes: myClasses(user, termId, campusId).map((s) => ({ ...sectionView(d, s), status: 'teaching' })) };
    const classes = d.enrollments
      .filter((e) => e.studentId === user.id && e.termId === termId && ['enrolled', 'pending', 'completed'].includes(e.status))
      .map((e) => ({ ...sectionView(d, findById(d.sections, e.sectionId)), status: e.status }));
    return { termId, terms: d.terms, classes };
  }, { module: 'schedule' });

  // For the parents & guardians views (server/guardian.js).
  return { standing, resultFor, isOpen };
}
