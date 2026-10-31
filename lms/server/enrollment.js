// Enrollment rules and routes.
//
// A student asks for a seat in a section. The request is checked in this order:
//   1. the account is an active student, and the section is not cancelled;
//   2. (students only) the section is open, the term's enrollment window is open,
//      and the enrollment key matches when the section has one;
//   3. not already holding a place in the same course this term;
//   4. (unless the registrar forces it) not already passed, prerequisites passed,
//      unit limit for the term, no clash with the student's other classes;
//   5. a free seat → enrolled (or pending, when requests need approval);
//      no seat → waitlisted (when waitlists are on and not full), else refused.
// When a seat frees up (drop / reject / capacity raised), the oldest waitlisted
// request moves up automatically.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { meetingsClash, formatMeetings } from '../shared/schedule.js';

export const STATUS_LABELS = {
  pending: 'Pending approval',
  enrolled: 'Enrolled',
  waitlisted: 'Waitlisted',
  dropped: 'Dropped',
  rejected: 'Rejected',
  completed: 'Completed',
};
export const HOLDS_PLACE = ['pending', 'enrolled', 'waitlisted']; // counts toward units, clashes and duplicates
export const HOLDS_SEAT = ['pending', 'enrolled']; // uses up the section's capacity
const FREES_SEAT = ['dropped', 'rejected'];

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};

export const findById = (list, id) => list.find((x) => x.id === id);
export const sectionLabel = (data, section) => `${findById(data.courses, section.courseId)?.code || '?'} ${section.name}`;

export function seatsTaken(data, sectionId) {
  return data.enrollments.filter((e) => e.sectionId === sectionId && HOLDS_SEAT.includes(e.status)).length;
}

export function waitlistOf(data, sectionId) {
  return data.enrollments
    .filter((e) => e.sectionId === sectionId && e.status === 'waitlisted')
    .sort((a, b) => (a.queuedAt || a.createdAt).localeCompare(b.queuedAt || b.createdAt));
}

export function hasPassed(data, studentId, courseId) {
  return data.enrollments.some((e) => e.studentId === studentId && e.courseId === courseId && e.status === 'completed' && e.passed);
}

export function termOpen(term, today) {
  return Boolean(term?.enrollStart && term?.enrollEnd && today >= term.enrollStart && today <= term.enrollEnd);
}

// Checks a request without saving anything. Returns { status, course, term } or throws a 400 with the reason.
export function evaluate(data, { student, section, today, key, asAdmin = false, force = false }) {
  const rules = data.settings.enrollment;
  if (!student || student.role !== 'student') fail('Pick a student.');
  if (student.status !== 'active') fail('This student account is not active.');
  if (!section) fail('Section not found.', 404);
  const course = findById(data.courses, section.courseId);
  const term = findById(data.terms, section.termId);
  if (!course || !term) fail('This section is missing its course or term.');
  if (section.status === 'cancelled') fail('This section has been cancelled.');

  if (!asAdmin) {
    if (section.status === 'closed') fail('This section is closed for enrollment.');
    if (!termOpen(term, today)) {
      fail(term.enrollStart && today < term.enrollStart
        ? `Enrollment for ${term.name} opens on ${term.enrollStart}.`
        : `Enrollment for ${term.name} is closed.`);
    }
    if (section.enrollmentKey && String(key ?? '').trim() !== section.enrollmentKey) {
      fail(key ? 'That enrollment key is not correct.' : 'This section needs an enrollment key. Ask the teacher or registrar for it.');
    }
  }

  const mine = data.enrollments.filter((e) => e.studentId === student.id && e.termId === term.id && HOLDS_PLACE.includes(e.status));
  const same = mine.find((e) => e.courseId === course.id);
  if (same) {
    const s = findById(data.sections, same.sectionId);
    fail(`Already ${STATUS_LABELS[same.status].toLowerCase()} in ${course.code} this term (section ${s?.name || '?'}).`);
  }

  if (!force) {
    if (hasPassed(data, student.id, course.id)) fail(`Already passed ${course.code}.`);
    const missing = (course.prerequisites || []).filter((id) => !hasPassed(data, student.id, id));
    if (missing.length) {
      const codes = missing.map((id) => findById(data.courses, id)?.code || '?');
      fail(`${course.code} requires ${codes.join(', ')} first.`);
    }
    const units = mine.reduce((sum, e) => sum + (findById(data.courses, e.courseId)?.units || 0), 0);
    if (rules.maxUnits && units + course.units > rules.maxUnits) {
      fail(`This would make ${units + course.units} units this term; the limit is ${rules.maxUnits}.`);
    }
    for (const e of mine) {
      const other = findById(data.sections, e.sectionId);
      if (other && meetingsClash(other.meetings, section.meetings)) {
        fail(`Schedule conflict with ${sectionLabel(data, other)} (${formatMeetings(other.meetings)}).`);
      }
    }
  }

  if (seatsTaken(data, section.id) >= section.capacity && !force) {
    if (!rules.allowWaitlist) fail('This section is full.');
    if (rules.waitlistLimit && waitlistOf(data, section.id).length >= rules.waitlistLimit) fail('This section and its waitlist are full.');
    return { status: 'waitlisted', course, term };
  }
  return { status: asAdmin || !rules.requireApproval ? 'enrolled' : 'pending', course, term };
}

function log(enrollment, status, by, note = '') {
  const at = new Date().toISOString();
  enrollment.history ||= [];
  enrollment.history.push({ at, status, by, note });
  enrollment.status = status;
  enrollment.updatedAt = at;
  if (status === 'waitlisted') enrollment.queuedAt = at;
}

export function enroll(data, opts, actor) {
  const { status, course, term } = evaluate(data, opts);
  const now = new Date().toISOString();
  const e = {
    id: randomUUID(),
    studentId: opts.student.id,
    sectionId: opts.section.id,
    courseId: course.id,
    termId: term.id,
    status,
    requestedBy: opts.asAdmin ? 'registrar' : 'student',
    createdAt: now,
    updatedAt: now,
    finalGrade: null,
    passed: null,
    history: [],
  };
  log(e, status, actor.name, opts.note || (opts.asAdmin ? (opts.force ? 'Added by the registrar (rules overridden).' : 'Added by the registrar.') : 'Requested by the student.'));
  if (opts.demo) e.demo = true;
  data.enrollments.push(e);
  return e;
}

// Moves waitlisted requests up while the section has free seats. Returns those moved.
export function promoteWaitlist(data, sectionId) {
  const section = findById(data.sections, sectionId);
  if (!section || section.status === 'cancelled') return [];
  const moved = [];
  while (seatsTaken(data, sectionId) < section.capacity) {
    const next = waitlistOf(data, sectionId)[0];
    if (!next) break;
    log(next, data.settings.enrollment.requireApproval ? 'pending' : 'enrolled', 'System', 'A seat opened; moved up from the waitlist.');
    moved.push(next);
  }
  return moved;
}

export function changeStatus(data, enrollment, status, actor, note = '') {
  const before = enrollment.status;
  log(enrollment, status, actor.name, note);
  if (FREES_SEAT.includes(status) && HOLDS_SEAT.includes(before)) promoteWaitlist(data, enrollment.sectionId);
  return enrollment;
}

// What a student may still do with their own request.
export function canStudentDrop(data, enrollment, today) {
  if (enrollment.status === 'pending' || enrollment.status === 'waitlisted') return true;
  if (enrollment.status !== 'enrolled') return false;
  const term = findById(data.terms, enrollment.termId);
  return !term?.dropDeadline || today <= term.dropDeadline;
}

// A section as shown in lists (no enrollment key, only whether one is needed).
export function sectionView(data, section) {
  const course = findById(data.courses, section.courseId) || {};
  const term = findById(data.terms, section.termId) || {};
  const teacher = findById(data.users, section.teacherId);
  return {
    id: section.id,
    name: section.name,
    status: section.status,
    room: section.room || '',
    meetings: section.meetings || [],
    schedule: formatMeetings(section.meetings),
    capacity: section.capacity,
    taken: seatsTaken(data, section.id),
    waitlisted: waitlistOf(data, section.id).length,
    needsKey: Boolean(section.enrollmentKey),
    course: {
      id: course.id, code: course.code, title: course.title, units: course.units, description: course.description || '',
      prerequisites: (course.prerequisites || []).map((id) => findById(data.courses, id)?.code).filter(Boolean),
    },
    term: { id: term.id, name: term.name },
    teacher: teacher ? { id: teacher.id, name: teacher.name } : null,
  };
}

export function enrollmentView(data, e) {
  const section = findById(data.sections, e.sectionId);
  const student = findById(data.users, e.studentId);
  const program = student && findById(data.programs, student.programId);
  return {
    ...e,
    statusLabel: STATUS_LABELS[e.status],
    position: e.status === 'waitlisted' ? waitlistOf(data, e.sectionId).findIndex((x) => x.id === e.id) + 1 : null,
    section: section ? sectionView(data, section) : null,
    student: student ? { id: student.id, name: student.name, studentNo: student.studentNo || '', yearLevel: student.yearLevel || '', program: program?.code || '' } : null,
  };
}

export function registerEnrollmentRoutes(route, ctx) {
  const { db, today } = ctx;
  const data = () => db.data;
  const findEnrollment = (id) => findById(data().enrollments, id) || fail('Enrollment not found.', 404);
  const termOr = (id) => findById(data().terms, id || data().settings.currentTermId) || data().terms.at(-1) || null;

  // ----- Students (learning portal) -----
  route('GET', '/api/enrollment/terms', 'student', () => {
    const t = today();
    return data().terms
      .filter((term) => term.status !== 'archived')
      .map((term) => ({ ...term, open: termOpen(term, t), current: term.id === data().settings.currentTermId }));
  }, { module: 'enrollment' });

  route('GET', '/api/enrollment/catalog', 'student', ({ user, query }) => {
    const term = termOr(query.termId);
    if (!term) return { term: null, sections: [], rules: data().settings.enrollment };
    const t = today();
    const sections = data().sections
      .filter((s) => s.termId === term.id && s.status !== 'cancelled')
      .map((s) => {
        const view = sectionView(data(), s);
        const mine = data().enrollments.find((e) => e.studentId === user.id && e.sectionId === s.id && e.status !== 'dropped' && e.status !== 'rejected');
        let eligibility = { ok: true, outcome: null, reason: '' };
        if (!mine) {
          try {
            // Check everything except the key, which the student types when enrolling.
            const r = evaluate(data(), { student: user, section: s.enrollmentKey ? { ...s, enrollmentKey: '' } : s, today: t });
            eligibility = { ok: true, outcome: r.status, reason: '' };
          } catch (err) {
            eligibility = { ok: false, outcome: null, reason: err.message };
          }
        }
        return { ...view, mine: mine ? { id: mine.id, status: mine.status, statusLabel: STATUS_LABELS[mine.status] } : null, eligibility };
      })
      .sort((a, b) => a.course.code.localeCompare(b.course.code) || a.name.localeCompare(b.name));
    return { term: { ...term, open: termOpen(term, t) }, sections, rules: data().settings.enrollment };
  }, { module: 'enrollment' });

  route('GET', '/api/enrollment/mine', 'student', ({ user, query }) => {
    const t = today();
    const list = data().enrollments
      .filter((e) => e.studentId === user.id && (!query.termId || e.termId === query.termId))
      .map((e) => ({ ...enrollmentView(data(), e), canDrop: canStudentDrop(data(), e, t) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
  }, { module: 'enrollment' });

  route('POST', '/api/enrollment', 'student', ({ user, body }) => {
    const section = findById(data().sections, body.sectionId);
    const e = enroll(data(), { student: user, section, today: today(), key: body.key }, user);
    db.save();
    return enrollmentView(data(), e);
  }, { module: 'enrollment' });

  route('POST', '/api/enrollment/:id/drop', 'student', ({ user, params }) => {
    const e = findEnrollment(params.id);
    if (e.studentId !== user.id) fail('Enrollment not found.', 404);
    if (!canStudentDrop(data(), e, today())) {
      fail(e.status === 'enrolled' ? 'The drop deadline for this term has passed. Ask the registrar.' : 'This class can no longer be dropped.');
    }
    const note = e.status === 'enrolled' ? 'Dropped by the student.' : 'Request withdrawn by the student.';
    changeStatus(data(), e, 'dropped', user, note);
    db.save();
    return enrollmentView(data(), e);
  }, { module: 'enrollment' });

  // ----- Registrar (admin panel) -----
  route('GET', '/api/admin/enrollments', 'admin:enrollment.manage', ({ query }) => {
    const q = String(query.q || '').toLowerCase();
    return data().enrollments
      .filter((e) => (!query.termId || e.termId === query.termId)
        && (!query.status || e.status === query.status)
        && (!query.sectionId || e.sectionId === query.sectionId)
        && (!query.studentId || e.studentId === query.studentId))
      .map((e) => enrollmentView(data(), e))
      .filter((e) => !q || [e.student?.name, e.student?.studentNo, e.section?.course.code, e.section?.course.title].some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => (query.status === 'waitlisted'
        ? a.sectionId.localeCompare(b.sectionId) || a.position - b.position // each section's queue in order
        : b.updatedAt.localeCompare(a.updatedAt)));
  });

  route('GET', '/api/admin/enrollments/summary', 'admin:enrollment.manage', () => {
    const termId = data().settings.currentTermId;
    const inTerm = data().enrollments.filter((e) => !termId || e.termId === termId);
    return {
      pending: data().enrollments.filter((e) => e.status === 'pending').length,
      waitlisted: inTerm.filter((e) => e.status === 'waitlisted').length,
      applicants: data().users.filter((u) => u.role === 'student' && u.status === 'pending').length,
    };
  });

  route('POST', '/api/admin/enrollments', 'admin:enrollment.manage', ({ user, body }) => {
    const student = findById(data().users, body.studentId);
    const section = findById(data().sections, body.sectionId);
    const e = enroll(data(), { student, section, today: today(), asAdmin: true, force: Boolean(body.force), note: String(body.note || '').trim() }, user);
    db.save();
    return enrollmentView(data(), e);
  });

  route('POST', '/api/admin/enrollments/:id/approve', 'admin:enrollment.manage', ({ user, params, body }) => {
    const e = findEnrollment(params.id);
    if (e.status === 'waitlisted') {
      if (!body.force) fail('This request is on the waitlist because the section is full. Choose "Enroll over capacity" to add it anyway.');
      changeStatus(data(), e, 'enrolled', user, String(body.note || '').trim() || 'Enrolled over capacity by the registrar.');
    } else if (e.status === 'pending') {
      changeStatus(data(), e, 'enrolled', user, String(body.note || '').trim() || 'Approved.');
    } else fail(`Only pending or waitlisted requests can be approved (this one is ${STATUS_LABELS[e.status].toLowerCase()}).`);
    db.save();
    return enrollmentView(data(), e);
  });

  route('POST', '/api/admin/enrollments/:id/reject', 'admin:enrollment.manage', ({ user, params, body }) => {
    const e = findEnrollment(params.id);
    if (!['pending', 'waitlisted'].includes(e.status)) fail('Only pending or waitlisted requests can be rejected. Drop an enrolled student instead.');
    changeStatus(data(), e, 'rejected', user, String(body.note || '').trim());
    db.save();
    return enrollmentView(data(), e);
  });

  route('POST', '/api/admin/enrollments/:id/drop', 'admin:enrollment.manage', ({ user, params, body }) => {
    const e = findEnrollment(params.id);
    if (!HOLDS_PLACE.includes(e.status)) fail('Only active enrollments can be dropped.');
    changeStatus(data(), e, 'dropped', user, String(body.note || '').trim() || 'Dropped by the registrar.');
    db.save();
    return enrollmentView(data(), e);
  });
}
