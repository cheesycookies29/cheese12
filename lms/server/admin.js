// Admin panel routes: accounts and applicants, the catalog (programs, courses,
// terms, sections), module switches for students and teachers, settings, dashboard.
import { randomUUID } from 'node:crypto';
import { HttpError, DATE_RE, text } from './util.js';
import { hashPassword, validatePassword, publicUser } from './auth.js';
import { can, ROLES, ADMIN_ROLES } from '../shared/roles.js';
import { MODULES } from '../shared/modules.js';
import { TIME_RE, toMinutes, meetingsClash, formatMeetings } from '../shared/schedule.js';
import { mergeSettings } from './db.js';
import {
  findById, sectionView, enrollmentView, seatsTaken, promoteWaitlist, changeStatus, HOLDS_PLACE, termOpen,
} from './enrollment.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const need = (user, permission) => {
  if (!can(user.role, permission)) fail('Your account does not have access to this.', 403);
};
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Which permission manages accounts of each type.
const MANAGES = { student: 'students.manage', teacher: 'teachers.manage', registrar: 'admins.manage', admin: 'admins.manage' };

export function nextStudentNo(data, year = new Date().getFullYear()) {
  const used = new Set(data.users.map((u) => u.studentNo).filter(Boolean));
  let n = data.counters.studentNo[year] || 0;
  let no;
  do no = `${year}-${String(++n).padStart(4, '0')}`;
  while (used.has(no));
  data.counters.studentNo[year] = n;
  return no;
}

export function validateUserFields(input, data, existing) {
  const role = existing ? existing.role : input.role;
  if (!ROLES[role]) fail('Pick an account type.');
  const u = {
    name: text(input.name, 120),
    username: text(input.username, 40).toLowerCase(),
    email: text(input.email, 160).toLowerCase(),
  };
  if (!u.name) fail('Name is required.');
  if (!USERNAME_RE.test(u.username)) fail('Username: 3–40 lowercase letters, numbers, dots, dashes or underscores.');
  if (u.email && !EMAIL_RE.test(u.email)) fail('That email address does not look right.');
  if (data.users.some((x) => x.username === u.username && x.id !== existing?.id)) fail(`The username ${u.username} is already taken.`);
  if (role === 'student') {
    u.programId = input.programId || null;
    if (u.programId && !findById(data.programs, u.programId)) fail('Program not found.');
    u.yearLevel = Math.min(6, Math.max(1, Number(input.yearLevel) || 1));
    u.studentNo = text(input.studentNo, 30);
    if (u.studentNo && data.users.some((x) => x.studentNo === u.studentNo && x.id !== existing?.id)) fail(`Student number ${u.studentNo} is already used.`);
  }
  if (role === 'teacher') {
    u.department = text(input.department, 120);
    u.employeeNo = text(input.employeeNo, 30);
  }
  return { role, ...u };
}

function validateMeetings(list) {
  if (!Array.isArray(list)) return [];
  const out = list.map((m) => ({ day: Number(m.day), start: String(m.start || ''), end: String(m.end || '') }));
  for (const m of out) {
    if (!(m.day >= 0 && m.day <= 6)) fail('Meeting day must be Sunday to Saturday.');
    if (!TIME_RE.test(m.start) || !TIME_RE.test(m.end)) fail('Meeting times must be HH:MM.');
    if (toMinutes(m.end) <= toMinutes(m.start)) fail('A class must end after it starts.');
  }
  return out;
}

function prerequisiteCycle(data, courseId, prereqs) {
  // Would courseId become its own (indirect) prerequisite?
  const seen = new Set();
  const stack = [...prereqs];
  while (stack.length) {
    const id = stack.pop();
    if (id === courseId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(findById(data.courses, id)?.prerequisites || []));
  }
  return false;
}

export function registerAdminRoutes(route, ctx) {
  const { db, today } = ctx;
  const data = () => db.data;
  const save = () => db.save();
  const now = () => new Date().toISOString();
  const found = (list, id, label) => findById(list, id) || fail(`${label} not found.`, 404);
  const activeAdmins = () => data().users.filter((u) => u.role === 'admin' && u.status === 'active');

  // ----- Dashboard -----
  route('GET', '/api/admin/dashboard', 'admin:dashboard', () => {
    const d = data();
    const term = findById(d.terms, d.settings.currentTermId);
    const sections = d.sections.filter((s) => term && s.termId === term.id && s.status !== 'cancelled');
    const inTerm = d.enrollments.filter((e) => term && e.termId === term.id);
    const count = (status) => inTerm.filter((e) => e.status === status).length;
    return {
      term: term ? { ...term, open: termOpen(term, today()) } : null,
      students: d.users.filter((u) => u.role === 'student' && u.status === 'active').length,
      applicants: d.users.filter((u) => u.role === 'student' && u.status === 'pending').length,
      teachers: d.users.filter((u) => u.role === 'teacher' && u.status === 'active').length,
      courses: d.courses.filter((c) => c.status !== 'retired').length,
      sections: sections.length,
      enrolled: count('enrolled'),
      pending: count('pending'),
      waitlisted: count('waitlisted'),
      enrolledStudents: new Set(inTerm.filter((e) => e.status === 'enrolled').map((e) => e.studentId)).size,
      fullest: sections
        .map((s) => sectionView(d, s))
        .sort((a, b) => b.taken / b.capacity - a.taken / a.capacity)
        .slice(0, 6),
      recent: d.enrollments
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8)
        .map((e) => enrollmentView(d, e)),
      unassigned: sections.filter((s) => !s.teacherId).length,
    };
  });

  // ----- Accounts -----
  route('GET', '/api/admin/users', 'admin', ({ user, query }) => {
    const role = query.role;
    if (role === 'student') need(user, 'students.manage');
    else if (role === 'teacher') need(user, 'teachers.view');
    else need(user, 'admins.manage');
    const roles = role === 'staff' || !role ? ADMIN_ROLES : [role];
    return data().users
      .filter((u) => roles.includes(u.role) && (!query.status || u.status === query.status))
      .map((u) => {
        const out = publicUser(u);
        if (u.role === 'student') {
          out.program = findById(data().programs, u.programId)?.code || '';
          out.currentUnits = data().enrollments
            .filter((e) => e.studentId === u.id && e.termId === data().settings.currentTermId && e.status === 'enrolled')
            .reduce((s, e) => s + (findById(data().courses, e.courseId)?.units || 0), 0);
        }
        if (u.role === 'teacher') out.sections = data().sections.filter((s) => s.teacherId === u.id && s.termId === data().settings.currentTermId && s.status !== 'cancelled').length;
        return out;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  route('GET', '/api/admin/users/:id', 'admin', ({ user, params }) => {
    const u = found(data().users, params.id, 'Account');
    need(user, u.role === 'teacher' ? 'teachers.view' : MANAGES[u.role]);
    const out = publicUser(u);
    if (u.role === 'student') {
      out.program = findById(data().programs, u.programId) || null;
      out.enrollments = data().enrollments.filter((e) => e.studentId === u.id).map((e) => enrollmentView(data(), e)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    if (u.role === 'teacher') out.sections = data().sections.filter((s) => s.teacherId === u.id).map((s) => sectionView(data(), s));
    return out;
  });

  route('POST', '/api/admin/users', 'admin', ({ user, body }) => {
    need(user, MANAGES[body.role] || 'admins.manage');
    const fields = validateUserFields(body, data());
    validatePassword(body.password);
    const u = {
      id: randomUUID(),
      ...fields,
      status: 'active',
      mustChangePassword: body.mustChangePassword !== false,
      passwordHash: hashPassword(body.password),
      createdAt: now(),
    };
    if (u.role === 'student' && !u.studentNo) u.studentNo = nextStudentNo(data());
    data().users.push(u);
    save();
    return publicUser(u);
  });

  route('PUT', '/api/admin/users/:id', 'admin', ({ user, params, body }) => {
    const u = found(data().users, params.id, 'Account');
    need(user, MANAGES[u.role]);
    const fields = validateUserFields(body, data(), u);
    if ('status' in body && ['active', 'disabled'].includes(body.status) && u.status !== 'pending' && u.status !== 'rejected') {
      if (u.id === user.id && body.status === 'disabled') fail('You cannot disable your own account.');
      if (u.role === 'admin' && body.status === 'disabled' && activeAdmins().length <= 1 && u.status === 'active') fail('Keep at least one active administrator.');
      fields.status = body.status;
    }
    if (u.role === 'student' && !fields.studentNo) fields.studentNo = u.studentNo || nextStudentNo(data());
    Object.assign(u, fields, { updatedAt: now() });
    if (u.status === 'disabled') ctx.signOutEverywhere(u.id);
    save();
    return publicUser(u);
  });

  route('POST', '/api/admin/users/:id/reset-password', 'admin', ({ user, params, body }) => {
    const u = found(data().users, params.id, 'Account');
    need(user, MANAGES[u.role]);
    validatePassword(body.password);
    u.passwordHash = hashPassword(body.password);
    u.mustChangePassword = true;
    ctx.signOutEverywhere(u.id);
    save();
    return { ok: true };
  });

  route('DELETE', '/api/admin/users/:id', 'admin', ({ user, params }) => {
    const u = found(data().users, params.id, 'Account');
    need(user, MANAGES[u.role]);
    if (u.id === user.id) fail('You cannot delete your own account.');
    if (u.role === 'admin' && u.status === 'active' && activeAdmins().length <= 1) fail('Keep at least one active administrator.');
    if (data().enrollments.some((e) => e.studentId === u.id)) fail('This student has enrollment records. Disable the account instead.');
    if (data().sections.some((s) => s.teacherId === u.id)) fail('This teacher is assigned to sections. Reassign them or disable the account instead.');
    data().users.splice(data().users.indexOf(u), 1);
    ctx.signOutEverywhere(u.id);
    save();
    return { ok: true };
  });

  // Applicants (students who applied from the portal).
  route('POST', '/api/admin/users/:id/approve', 'admin:students.manage', ({ params, body }) => {
    const u = found(data().users, params.id, 'Applicant');
    if (u.role !== 'student' || u.status !== 'pending') fail('Only pending applicants can be admitted.');
    if (body.programId !== undefined) {
      if (body.programId && !findById(data().programs, body.programId)) fail('Program not found.');
      u.programId = body.programId || null;
    }
    u.status = 'active';
    u.studentNo ||= nextStudentNo(data());
    u.admittedAt = now();
    save();
    return publicUser(u);
  });

  route('POST', '/api/admin/users/:id/reject', 'admin:students.manage', ({ params, body }) => {
    const u = found(data().users, params.id, 'Applicant');
    if (u.role !== 'student' || u.status !== 'pending') fail('Only pending applicants can be declined.');
    u.status = 'rejected';
    u.decisionNote = text(body.note, 500);
    save();
    return publicUser(u);
  });

  // ----- Programs -----
  route('GET', '/api/admin/programs', 'admin', () =>
    data().programs.map((p) => ({ ...p, students: data().users.filter((u) => u.programId === p.id && u.status === 'active').length })));

  const validateProgram = (b, existing) => {
    const p = { code: text(b.code, 20).toUpperCase(), name: text(b.name, 160), description: text(b.description, 1000) };
    if (!p.code || !p.name) fail('Program code and name are required.');
    if (data().programs.some((x) => x.code === p.code && x.id !== existing?.id)) fail(`Program ${p.code} already exists.`);
    return p;
  };
  route('POST', '/api/admin/programs', 'admin:catalog.manage', ({ body }) => {
    const p = { id: randomUUID(), ...validateProgram(body), createdAt: now() };
    data().programs.push(p);
    save();
    return p;
  });
  route('PUT', '/api/admin/programs/:id', 'admin:catalog.manage', ({ params, body }) => {
    const p = found(data().programs, params.id, 'Program');
    Object.assign(p, validateProgram(body, p));
    save();
    return p;
  });
  route('DELETE', '/api/admin/programs/:id', 'admin:catalog.manage', ({ params }) => {
    const p = found(data().programs, params.id, 'Program');
    if (data().users.some((u) => u.programId === p.id)) fail('Students are in this program. Move them first.');
    data().programs.splice(data().programs.indexOf(p), 1);
    save();
    return { ok: true };
  });

  // ----- Terms -----
  route('GET', '/api/admin/terms', 'admin', () =>
    data().terms.map((t) => ({
      ...t,
      open: termOpen(t, today()),
      current: t.id === data().settings.currentTermId,
      sections: data().sections.filter((s) => s.termId === t.id && s.status !== 'cancelled').length,
    })));

  const validateTerm = (b) => {
    const t = {
      name: text(b.name, 120),
      startDate: b.startDate || '',
      endDate: b.endDate || '',
      enrollStart: b.enrollStart || '',
      enrollEnd: b.enrollEnd || '',
      dropDeadline: b.dropDeadline || '',
      status: b.status === 'archived' ? 'archived' : 'active',
    };
    if (!t.name) fail('Term name is required.');
    for (const [k, label] of [['startDate', 'Classes start'], ['endDate', 'Classes end'], ['enrollStart', 'Enrollment opens'], ['enrollEnd', 'Enrollment closes']]) {
      if (!DATE_RE.test(t[k])) fail(`${label} must be a date.`);
    }
    if (t.dropDeadline && !DATE_RE.test(t.dropDeadline)) fail('Drop deadline must be a date.');
    if (t.endDate < t.startDate) fail('Classes must end after they start.');
    if (t.enrollEnd < t.enrollStart) fail('Enrollment must close after it opens.');
    return t;
  };
  route('POST', '/api/admin/terms', 'admin:catalog.manage', ({ body }) => {
    const t = { id: randomUUID(), ...validateTerm(body), createdAt: now() };
    data().terms.push(t);
    if (!data().settings.currentTermId || body.makeCurrent) data().settings.currentTermId = t.id;
    save();
    return t;
  });
  route('PUT', '/api/admin/terms/:id', 'admin:catalog.manage', ({ params, body }) => {
    const t = found(data().terms, params.id, 'Term');
    Object.assign(t, validateTerm(body));
    if (body.makeCurrent) data().settings.currentTermId = t.id;
    save();
    return t;
  });
  route('DELETE', '/api/admin/terms/:id', 'admin:catalog.manage', ({ params }) => {
    const t = found(data().terms, params.id, 'Term');
    if (data().sections.some((s) => s.termId === t.id)) fail('This term has sections. Archive it instead.');
    data().terms.splice(data().terms.indexOf(t), 1);
    if (data().settings.currentTermId === t.id) data().settings.currentTermId = data().terms.at(-1)?.id || null;
    save();
    return { ok: true };
  });

  // ----- Courses (the catalog) -----
  route('GET', '/api/admin/courses', 'admin', () =>
    data().courses.map((c) => ({
      ...c,
      prerequisiteCodes: (c.prerequisites || []).map((id) => findById(data().courses, id)?.code).filter(Boolean),
      sections: data().sections.filter((s) => s.courseId === c.id && s.termId === data().settings.currentTermId && s.status !== 'cancelled').length,
    })).sort((a, b) => a.code.localeCompare(b.code)));

  const validateCourse = (b, existing) => {
    const c = {
      code: text(b.code, 20).toUpperCase(),
      title: text(b.title, 160),
      units: Number(b.units),
      description: text(b.description, 2000),
      prerequisites: [...new Set(Array.isArray(b.prerequisites) ? b.prerequisites : [])],
      programIds: [...new Set(Array.isArray(b.programIds) ? b.programIds : [])].filter((id) => findById(data().programs, id)),
      status: b.status === 'retired' ? 'retired' : 'active',
    };
    if (!c.code || !c.title) fail('Course code and title are required.');
    if (!(c.units > 0 && c.units <= 12)) fail('Units must be between 0.5 and 12.');
    if (data().courses.some((x) => x.code === c.code && x.id !== existing?.id)) fail(`Course ${c.code} already exists.`);
    for (const id of c.prerequisites) if (!findById(data().courses, id)) fail('A prerequisite course was not found.');
    if (existing && prerequisiteCycle(data(), existing.id, c.prerequisites)) fail('Those prerequisites would make this course require itself.');
    return c;
  };
  route('POST', '/api/admin/courses', 'admin:catalog.manage', ({ body }) => {
    const c = { id: randomUUID(), ...validateCourse(body), createdAt: now() };
    data().courses.push(c);
    save();
    return c;
  });
  route('PUT', '/api/admin/courses/:id', 'admin:catalog.manage', ({ params, body }) => {
    const c = found(data().courses, params.id, 'Course');
    Object.assign(c, validateCourse(body, c), { updatedAt: now() });
    save();
    return c;
  });
  route('DELETE', '/api/admin/courses/:id', 'admin:catalog.manage', ({ params }) => {
    const c = found(data().courses, params.id, 'Course');
    if (data().sections.some((s) => s.courseId === c.id)) fail('This course has sections. Retire it instead.');
    if (data().courses.some((x) => x.prerequisites?.includes(c.id))) fail('Another course lists this one as a prerequisite.');
    data().courses.splice(data().courses.indexOf(c), 1);
    save();
    return { ok: true };
  });

  // ----- Sections (a course offered in a term) -----
  const adminSection = (s) => ({ ...sectionView(data(), s), enrollmentKey: s.enrollmentKey || '', courseId: s.courseId, termId: s.termId, teacherId: s.teacherId });

  route('GET', '/api/admin/sections', 'admin', ({ query }) =>
    data().sections
      .filter((s) => (!query.termId || s.termId === query.termId) && (!query.teacherId || s.teacherId === query.teacherId) && (!query.courseId || s.courseId === query.courseId))
      .map(adminSection)
      .sort((a, b) => a.course.code.localeCompare(b.course.code) || a.name.localeCompare(b.name)));

  route('GET', '/api/admin/sections/:id', 'admin', ({ params }) => {
    const s = found(data().sections, params.id, 'Section');
    const roster = data().enrollments.filter((e) => e.sectionId === s.id).map((e) => enrollmentView(data(), e));
    return { ...adminSection(s), roster };
  });

  const validateSection = (b, existing) => {
    const s = {
      courseId: b.courseId,
      termId: b.termId,
      name: text(b.name, 20).toUpperCase(),
      teacherId: b.teacherId || null,
      capacity: Math.floor(Number(b.capacity)),
      room: text(b.room, 60),
      meetings: validateMeetings(b.meetings),
      status: ['open', 'closed', 'cancelled'].includes(b.status) ? b.status : 'open',
      enrollmentKey: text(b.enrollmentKey, 40),
    };
    const course = found(data().courses, s.courseId, 'Course');
    found(data().terms, s.termId, 'Term');
    if (!s.name) fail('Section name is required (e.g. A).');
    if (!(s.capacity >= 1 && s.capacity <= 1000)) fail('Capacity must be between 1 and 1000.');
    if (s.teacherId) {
      const t = findById(data().users, s.teacherId);
      if (!t || t.role !== 'teacher') fail('Pick a teacher account.');
      if (s.status !== 'cancelled') {
        const clash = data().sections.find((o) => o.id !== existing?.id && o.teacherId === s.teacherId && o.termId === s.termId && o.status !== 'cancelled' && meetingsClash(o.meetings, s.meetings));
        if (clash) fail(`${t.name} already teaches ${findById(data().courses, clash.courseId)?.code} ${clash.name} at that time (${formatMeetings(clash.meetings)}).`);
      }
    }
    if (data().sections.some((o) => o.id !== existing?.id && o.courseId === s.courseId && o.termId === s.termId && o.name === s.name)) {
      fail(`${course.code} already has a section ${s.name} this term.`);
    }
    if (existing && (existing.courseId !== s.courseId || existing.termId !== s.termId) && data().enrollments.some((e) => e.sectionId === existing.id)) {
      fail('Students have enrolled in this section, so its course and term can no longer change.');
    }
    return s;
  };

  route('POST', '/api/admin/sections', 'admin:catalog.manage', ({ body }) => {
    const s = { id: randomUUID(), ...validateSection(body), createdAt: now() };
    data().sections.push(s);
    save();
    return adminSection(s);
  });

  route('PUT', '/api/admin/sections/:id', 'admin:catalog.manage', ({ user, params, body }) => {
    const s = found(data().sections, params.id, 'Section');
    const next = validateSection(body, s);
    if (next.capacity < seatsTaken(data(), s.id) && next.status !== 'cancelled') {
      fail(`${seatsTaken(data(), s.id)} students already hold seats. Capacity cannot go below that; drop students first.`);
    }
    const cancelling = next.status === 'cancelled' && s.status !== 'cancelled';
    Object.assign(s, next, { updatedAt: now() });
    if (cancelling) {
      for (const e of data().enrollments.filter((x) => x.sectionId === s.id && HOLDS_PLACE.includes(x.status))) {
        changeStatus(data(), e, 'dropped', user, 'The section was cancelled.');
      }
    } else promoteWaitlist(data(), s.id); // capacity may have gone up
    save();
    return adminSection(s);
  });

  route('DELETE', '/api/admin/sections/:id', 'admin:catalog.manage', ({ params }) => {
    const s = found(data().sections, params.id, 'Section');
    if (data().enrollments.some((e) => e.sectionId === s.id)) fail('This section has enrollment records. Cancel it instead.');
    data().sections.splice(data().sections.indexOf(s), 1);
    for (const key of ['lessons', 'announcements', 'assignments']) data()[key] = data()[key].filter((x) => x.sectionId !== s.id);
    save();
    return { ok: true };
  });

  // ----- Modules for students and teachers -----
  route('GET', '/api/admin/modules', 'admin', () => ({ modules: MODULES, config: data().modules }));
  route('PUT', '/api/admin/modules', 'admin:modules.config', ({ body }) => {
    const next = {};
    for (const m of MODULES) {
      const v = body.config?.[m.id] || {};
      next[m.id] = { student: Boolean(v.student), teacher: Boolean(v.teacher) };
    }
    data().modules = next;
    save();
    return { modules: MODULES, config: next };
  });

  // ----- Settings -----
  route('GET', '/api/admin/settings', 'admin', () => data().settings);
  route('PUT', '/api/admin/settings', 'admin:settings.edit', ({ body }) => {
    const s = mergeSettings(data().settings);
    if ('schoolName' in body) s.schoolName = text(body.schoolName, 120) || s.schoolName;
    if ('passingGrade' in body) {
      const g = Number(body.passingGrade);
      if (!(g > 0 && g <= 100)) fail('Passing grade must be between 1 and 100.');
      s.passingGrade = g;
    }
    if ('currentTermId' in body) {
      if (body.currentTermId && !findById(data().terms, body.currentTermId)) fail('Term not found.');
      s.currentTermId = body.currentTermId || null;
    }
    if (body.enrollment) {
      const e = body.enrollment;
      s.enrollment = {
        requireApproval: Boolean(e.requireApproval),
        allowWaitlist: Boolean(e.allowWaitlist),
        waitlistLimit: Math.max(0, Math.floor(Number(e.waitlistLimit) || 0)),
        maxUnits: Math.max(0, Number(e.maxUnits) || 0),
      };
    }
    if (body.registration) s.registration = { open: Boolean(body.registration.open) };
    data().settings = s;
    save();
    return s;
  });
}
