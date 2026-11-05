// Parents and guardians. A guardian account (role "guardian", signs in on the University
// Portal and opens the LMS) is linked to one or more students. Each link says how the
// guardian is related to the student and what they may see: enrollment, schedule,
// grades, attendance, activities (shared/guardians.js). A view also needs its module on
// for guardians (Admin panel → Modules). Guardians only read; they change nothing.
//
// Registrars (guardians.manage) make guardian accounts and links in the admin panel, for
// students at their campuses. Students see who is linked to them and what each can see.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { hashPassword, validatePassword } from './auth.js';
import { findById, sectionView, enrollmentView } from './enrollment.js';
import { attendanceSummary } from './attendance.js';
import { validateUserFields } from './admin.js';
import { canReach, inCampus, campusName } from './campus.js';
import { moduleOn } from '../shared/modules.js';
import { GUARDIAN_VIEWS, GUARDIAN_VIEW_IDS, RELATIONSHIPS, allViews, cleanViews } from '../shared/guardians.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const IN_CLASS = ['enrolled', 'completed'];
const round1 = (n) => Math.round(n * 10) / 10;

// The students a guardian follows (active links whose student still exists).
export function guardianChildren(data, guardianId) {
  return data.guardianLinks
    .filter((l) => l.guardianId === guardianId && l.status === 'active')
    .map((l) => ({ link: l, student: data.users.find((u) => u.id === l.studentId && u.role === 'student') }))
    .filter((x) => x.student);
}

export function registerGuardianRoutes(route, ctx, { standing, resultFor, isOpen }) {
  const { db, nowLocal } = ctx;
  const data = () => db.data;
  const save = () => db.save();
  const iso = () => new Date().toISOString();

  // ----- What a link lets the guardian see -----
  const viewOn = (link, id) => Boolean(link.views?.[id]) && moduleOn(data().modules, GUARDIAN_VIEWS.find((v) => v.id === id).module, 'guardian');
  const allowedViews = (link) => GUARDIAN_VIEW_IDS.filter((id) => viewOn(link, id));
  const relationship = (v) => (RELATIONSHIPS.includes(v) ? v : 'Guardian');
  const studentCard = (s) => {
    const program = findById(data().programs, s.programId);
    return {
      id: s.id, name: s.name, studentNo: s.studentNo || '', yearLevel: s.yearLevel || 1, status: s.status,
      program: program ? { code: program.code, name: program.name } : null,
      campusName: campusName(data(), s.campusIds?.[0]),
    };
  };
  const guardianCard = (g) => ({ id: g.id, name: g.name, username: g.username, email: g.email || '', phone: g.phone || '', status: g.status, lastLoginAt: g.lastLoginAt || null });
  const linkView = (l) => ({ id: l.id, relationship: l.relationship, views: l.views, status: l.status, createdAt: l.createdAt, createdBy: l.createdBy || '', lastViewedAt: l.lastViewedAt || null });

  // A student's classes in a term (enrolled or finished).
  const classesIn = (studentId, termId) => data().enrollments
    .filter((e) => e.studentId === studentId && e.termId === termId && IN_CLASS.includes(e.status))
    .map((e) => ({ e, s: findById(data().sections, e.sectionId) }))
    .filter((x) => x.s);

  // One activity as the guardian sees it: no questions, no answers, just where the student stands.
  function activityState(x, r) {
    if (r.score != null) return 'scored';
    if (r.submitted) return r.toGrade ? 'to-grade' : 'handed-in';
    const now = nowLocal();
    if (x.opensAt && now < x.opensAt) return 'not-open';
    if (x.dueAt && now > x.dueAt) return isOpen(x) ? 'overdue' : 'missing';
    return 'due';
  }
  const activitiesOf = (sectionId, studentId) => data().assignments
    .filter((x) => x.sectionId === sectionId && x.published)
    .map((x) => {
      const r = resultFor(x, studentId);
      const type = data().activityTypes.find((t) => t.id === x.typeId);
      return {
        id: x.id, title: x.title, kind: x.kind || 'task', type: type?.name || '', opensAt: x.opensAt || '', dueAt: x.dueAt || '', points: x.points,
        state: activityState(x, r), score: r.score, late: Boolean(r.late), submittedAt: r.submittedAt || null, attempts: r.attempts ?? null,
      };
    })
    .sort((a, b) => (a.dueAt || '9').localeCompare(b.dueAt || '9'));
  const attendanceOf = (sectionId, studentId) => {
    const records = data().attendance.filter((r) => r.sectionId === sectionId);
    return {
      summary: attendanceSummary(records, studentId),
      days: records.filter((r) => r.records[studentId] && r.records[studentId] !== 'present').map((r) => ({ date: r.date, status: r.records[studentId] })).sort((a, b) => b.date.localeCompare(a.date)),
    };
  };

  // The card on the guardian's home: this term at a glance, as far as the link allows.
  function summary(link, student) {
    const d = data();
    const termId = d.settings.currentTermId;
    const views = allowedViews(link);
    const classes = classesIn(student.id, termId);
    const out = { views, alerts: [] };
    if (views.includes('enrollment')) {
      const mine = d.enrollments.filter((e) => e.studentId === student.id && e.termId === termId);
      const units = (list) => list.reduce((n, e) => n + (findById(d.courses, e.courseId)?.units || 0), 0);
      out.enrollment = {
        classes: mine.filter((e) => IN_CLASS.includes(e.status)).length,
        units: units(mine.filter((e) => IN_CLASS.includes(e.status))),
        pending: mine.filter((e) => e.status === 'pending').length,
        waitlisted: mine.filter((e) => e.status === 'waitlisted').length,
      };
      if (out.enrollment.pending) out.alerts.push({ kind: 'info', text: `${out.enrollment.pending} enrollment request${out.enrollment.pending === 1 ? '' : 's'} waiting for the registrar` });
    }
    if (views.includes('grades')) {
      const percents = classes.map(({ s }) => standing(s.id, student.id).percent).filter((p) => p != null);
      out.average = percents.length ? round1(percents.reduce((a, b) => a + b, 0) / percents.length) : null;
      const low = classes.filter(({ s }) => {
        const p = standing(s.id, student.id).percent;
        return p != null && p < d.settings.passingGrade;
      }).length;
      if (low) out.alerts.push({ kind: 'warn', text: `Below the passing grade in ${low} class${low === 1 ? '' : 'es'}` });
    }
    if (views.includes('attendance')) {
      const all = classes.map(({ s }) => attendanceOf(s.id, student.id).summary);
      const sum = (k) => all.reduce((n, x) => n + x[k], 0);
      const counted = sum('present') + sum('late') + sum('absent');
      out.attendance = { rate: counted ? Math.round(((sum('present') + sum('late')) / counted) * 100) : null, absent: sum('absent'), late: sum('late') };
      if (out.attendance.absent) out.alerts.push({ kind: out.attendance.absent >= 3 ? 'bad' : 'warn', text: `${out.attendance.absent} absence${out.attendance.absent === 1 ? '' : 's'} this term` });
    }
    if (views.includes('activities')) {
      const acts = classes.flatMap(({ s }) => activitiesOf(s.id, student.id));
      out.activities = { missing: acts.filter((a) => a.state === 'missing').length, overdue: acts.filter((a) => a.state === 'overdue').length, due: acts.filter((a) => a.state === 'due').length };
      const behind = out.activities.missing + out.activities.overdue;
      if (behind) out.alerts.push({ kind: 'bad', text: `${behind} activit${behind === 1 ? 'y' : 'ies'} not handed in after the due date` });
    }
    return out;
  }

  function myLink(user, studentId) {
    const found = guardianChildren(data(), user.id).find((x) => x.student.id === studentId);
    if (!found) fail('Student not found.', 404);
    return found;
  }

  // ----- Guardians -----
  route('GET', '/api/guardian/children', 'guardian', ({ user }) =>
    guardianChildren(data(), user.id).map(({ link, student }) => ({ student: studentCard(student), relationship: link.relationship, ...summary(link, student) })));

  route('GET', '/api/guardian/children/:id', 'guardian', ({ user, params, query }) => {
    const { link, student } = myLink(user, params.id);
    const d = data();
    const views = allowedViews(link);
    const has = (v) => views.includes(v);
    // Terms the student has records in, newest first; the current term by default.
    const termIds = new Set(d.enrollments.filter((e) => e.studentId === student.id).map((e) => e.termId));
    if (d.settings.currentTermId) termIds.add(d.settings.currentTermId);
    const terms = d.terms.filter((t) => termIds.has(t.id)).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')).map((t) => ({ id: t.id, name: t.name, current: t.id === d.settings.currentTermId }));
    const termId = terms.some((t) => t.id === query.termId) ? query.termId : d.settings.currentTermId || terms[0]?.id || null;
    const classes = classesIn(student.id, termId);
    const out = { student: studentCard(student), relationship: link.relationship, views, terms, termId, passingGrade: d.settings.passingGrade, summary: summary(link, student) };
    if (has('enrollment')) {
      out.enrollment = d.enrollments
        .filter((e) => e.studentId === student.id && e.termId === termId)
        .map((e) => {
          const v = enrollmentView(d, e);
          return { id: v.id, status: v.status, statusLabel: v.statusLabel, position: v.position, section: v.section, finalGrade: v.finalGrade ?? null, passed: v.passed ?? null, createdAt: v.createdAt, updatedAt: v.updatedAt, history: (v.history || []).map((h) => ({ at: h.at, status: h.status, note: h.note || '' })) };
        })
        .sort((a, b) => a.section.course.code.localeCompare(b.section.course.code));
    }
    if (has('schedule')) {
      out.schedule = d.enrollments
        .filter((e) => e.studentId === student.id && e.termId === termId && ['enrolled', 'pending', 'completed'].includes(e.status))
        .map((e) => ({ ...sectionView(d, findById(d.sections, e.sectionId)), status: e.status }))
        .filter((s) => s.id);
    }
    if (has('grades')) {
      out.grades = d.enrollments
        .filter((e) => e.studentId === student.id && IN_CLASS.includes(e.status))
        .map((e) => {
          const s = findById(d.sections, e.sectionId);
          if (!s) return null;
          const st = standing(s.id, student.id);
          return { class: sectionView(d, s), status: e.status, finalGrade: e.finalGrade ?? null, passed: e.passed ?? null, percent: st.percent, done: st.done, total: st.total };
        })
        .filter(Boolean)
        .sort((a, b) => a.class.term.name.localeCompare(b.class.term.name) || a.class.course.code.localeCompare(b.class.course.code));
    }
    if (has('attendance')) out.attendance = classes.map(({ s }) => ({ class: sectionView(d, s), ...attendanceOf(s.id, student.id) }));
    if (has('activities')) out.activities = classes.map(({ s }) => ({ class: sectionView(d, s), items: activitiesOf(s.id, student.id) }));
    link.lastViewedAt = iso();
    save();
    return out;
  });

  // ----- Students: who can see their records -----
  route('GET', '/api/my/guardians', 'student', ({ user }) =>
    data().guardianLinks
      .filter((l) => l.studentId === user.id && l.status === 'active')
      .map((l) => ({ link: l, g: data().users.find((u) => u.id === l.guardianId && u.role === 'guardian') }))
      .filter((x) => x.g)
      .map(({ link, g }) => ({ id: link.id, name: g.name, relationship: link.relationship, views: allowedViews(link), active: g.status === 'active', lastViewedAt: link.lastViewedAt || null })));

  // ----- Registrars and administrators -----
  const findGuardian = (caller, id) => {
    const g = data().users.find((u) => u.id === id && u.role === 'guardian');
    if (!g || !canReach(data(), caller, g)) fail('Parent or guardian not found.', 404);
    return g;
  };
  const findStudent = (caller, id) => {
    const s = data().users.find((u) => u.id === id && u.role === 'student');
    if (!s || !canReach(data(), caller, s)) fail('Student not found.', 404);
    return s;
  };
  const findLink = (caller, id) => {
    const l = data().guardianLinks.find((x) => x.id === id);
    if (!l) fail('Link not found.', 404);
    findStudent(caller, l.studentId);
    return l;
  };
  // A guardian's campuses follow their students', so registrars there can see them.
  const syncCampuses = (g) => {
    const ids = [...new Set(data().guardianLinks.filter((l) => l.guardianId === g.id).map((l) => data().users.find((u) => u.id === l.studentId)?.campusIds?.[0]).filter(Boolean))];
    if (ids.length) g.campusIds = ids;
  };
  function addLink(caller, g, s, body) {
    if (data().guardianLinks.some((l) => l.guardianId === g.id && l.studentId === s.id)) fail(`${g.name} is already linked to ${s.name}.`);
    const views = body.views ? cleanViews(body.views) : allViews();
    const link = { id: randomUUID(), guardianId: g.id, studentId: s.id, relationship: relationship(body.relationship), views, status: 'active', createdAt: iso(), createdBy: caller.name };
    data().guardianLinks.push(link);
    syncCampuses(g);
    return link;
  }
  const guardianDetail = (caller, g) => ({
    ...guardianCard(g),
    campusNames: (g.campusIds || []).map((id) => campusName(data(), id)).filter(Boolean),
    createdAt: g.createdAt,
    children: data().guardianLinks
      .filter((l) => l.guardianId === g.id)
      .map((l) => ({ ...linkView(l), student: data().users.find((u) => u.id === l.studentId) }))
      .filter((x) => x.student)
      .map((x) => ({ ...x, student: studentCard(x.student), reachable: canReach(data(), caller, x.student), allowed: allowedViews(x) })),
  });

  route('GET', '/api/admin/guardians', 'admin:guardians.manage', ({ user, campusId }) =>
    data().users
      .filter((u) => u.role === 'guardian' && inCampus(u, campusId))
      .map((g) => guardianDetail(user, g))
      .sort((a, b) => a.name.localeCompare(b.name)));

  route('GET', '/api/admin/guardians/:id', 'admin:guardians.manage', ({ user, params }) => guardianDetail(user, findGuardian(user, params.id)));

  // A new guardian account, usually linked to a student straight away.
  route('POST', '/api/admin/guardians', 'admin:guardians.manage', ({ user, body, campusId }) => {
    const fields = validateUserFields({ ...body, role: 'guardian' }, data());
    validatePassword(body.password);
    const student = body.studentId ? findStudent(user, body.studentId) : null;
    const g = {
      id: randomUUID(), ...fields, campusIds: [student?.campusIds?.[0] || campusId].filter(Boolean), status: 'active',
      mustChangePassword: body.mustChangePassword !== false, passwordHash: hashPassword(body.password), createdAt: iso(),
    };
    data().users.push(g);
    if (student) addLink(user, g, student, body);
    save();
    return guardianDetail(user, g);
  });

  route('GET', '/api/admin/students/:id/guardians', 'admin:guardians.manage', ({ user, params }) => {
    const s = findStudent(user, params.id);
    return data().guardianLinks
      .filter((l) => l.studentId === s.id)
      .map((l) => ({ ...linkView(l), guardian: data().users.find((u) => u.id === l.guardianId && u.role === 'guardian') }))
      .filter((x) => x.guardian)
      .map((x) => ({ ...x, guardian: guardianCard(x.guardian), allowed: allowedViews(x) }));
  });

  route('POST', '/api/admin/guardian-links', 'admin:guardians.manage', ({ user, body }) => {
    const link = addLink(user, findGuardian(user, body.guardianId), findStudent(user, body.studentId), body);
    save();
    return linkView(link);
  });
  route('PUT', '/api/admin/guardian-links/:id', 'admin:guardians.manage', ({ user, params, body }) => {
    const l = findLink(user, params.id);
    if ('relationship' in body) l.relationship = relationship(body.relationship);
    if (body.views) l.views = cleanViews(body.views);
    if (['active', 'paused'].includes(body.status)) l.status = body.status;
    l.updatedAt = iso();
    l.updatedBy = user.name;
    save();
    return linkView(l);
  });
  route('DELETE', '/api/admin/guardian-links/:id', 'admin:guardians.manage', ({ user, params }) => {
    const l = findLink(user, params.id);
    data().guardianLinks = data().guardianLinks.filter((x) => x.id !== l.id);
    const g = data().users.find((u) => u.id === l.guardianId);
    if (g) syncCampuses(g);
    save();
    return { ok: true };
  });

  return { childrenOf: (user) => guardianChildren(data(), user.id).map(({ link, student }) => ({ id: student.id, name: student.name, relationship: link.relationship })) };
}

