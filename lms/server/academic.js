// ATLAS Academic (/academic/): the student information system. Builds on Learn's catalog
// (programs, courses with prerequisites, terms, sections, enrollments) and adds what the
// registrar keeps: colleges, curricula (the prospectus), student records and requirements,
// the evaluation of each student against their curriculum, grade sheets (teacher → dean →
// registrar), the permanent record with an approved-change trail, document requests,
// verifiable documents and reports (CHED enrollment list, FHE billing, honors, graduation).
//
// Access ('academic' routes, see server/api.js): administrators, registrars and deans with
// their admin-panel session; teachers and students with their portal session.
import { randomUUID, randomBytes } from 'node:crypto';
import { HttpError, text, DATE_RE } from './util.js';
import { nextNumber } from './numbering.js';
import { can } from '../shared/roles.js';
import {
  DEFAULT_ACADEMIC_SETTINGS, DOCUMENT_TYPES, REQUEST_STATUS, STUDENT_TYPES, TERMS,
  equivalent, gwa, docType, termOrder, ACADEMIC_PERMISSION_LABELS, scaleProblems, passingPercent,
} from '../shared/academic.js';
import { campusesFor, activeCampusId, canReach } from './campus.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const iso = () => new Date().toISOString();
const byId = (list, id) => list.find((x) => x.id === id);
const STAFF = ['admin', 'registrar', 'dean'];
export const ACADEMIC_ROLES = [...STAFF, 'teacher', 'student'];

export function mergeAcademicSettings(s = {}) {
  const d = structuredClone(DEFAULT_ACADEMIC_SETTINGS);
  return {
    ...d,
    ...s,
    scale: Array.isArray(s.scale) && s.scale.length ? s.scale : d.scale,
    requirements: Array.isArray(s.requirements) ? s.requirements : d.requirements,
    fees: { ...d.fees, ...(s.fees || {}) },
    honors: { ...d.honors, ...(s.honors || {}) },
    registrar: { ...d.registrar, ...(s.registrar || {}) },
    maxUnits: undefined, // never used (Learn's Settings → Maximum units per term is the limit)
  };
}

// Split "Maria Clara Santos" into last, first and middle names when a profile has none.
export function nameParts(user, profile = {}) {
  if (profile.lastName) return { last: profile.lastName, first: profile.firstName || '', middle: profile.middleName || '' };
  const parts = String(user?.name || '').trim().split(/\s+/);
  return { last: parts.length > 1 ? parts.at(-1) : parts[0] || '', first: parts.length > 1 ? parts.slice(0, -1).join(' ') : '', middle: '' };
}

export function registerAcademicRoutes(route, ctx) {
  const data = () => ctx.db.data;
  const save = () => ctx.db.save();
  const S = () => data().academicSettings;
  const isStaff = (u) => STAFF.includes(u.role);

  function audit(user, action, detail = {}) {
    data().auditLog.push({ id: randomUUID(), at: iso(), by: user?.name || 'System', byId: user?.id || null, action, ...detail });
    if (data().auditLog.length > 20000) data().auditLog.splice(0, data().auditLog.length - 20000);
  }

  // ----- Lookups -----
  const profileOf = (studentId) => data().studentProfiles.find((p) => p.studentId === studentId) || null;
  function ensureProfile(student) {
    let p = profileOf(student.id);
    if (!p) {
      p = { id: randomUUID(), studentId: student.id, studentType: 'old', requirements: {}, education: [], createdAt: iso() };
      data().studentProfiles.push(p);
    }
    return p;
  }
  const campusOf = (u) => u.campusIds?.[0] || null;
  const termName = (id) => byId(data().terms, id)?.name || '';
  const courseOf = (id) => byId(data().courses, id);
  const programOf = (id) => byId(data().programs, id);

  // A student the caller may look at: staff at the student's campus; the student themself.
  function reachStudent(user, id) {
    const st = byId(data().users, id);
    if (!st || st.role !== 'student') fail('Student not found.', 404);
    if (user.role === 'student') {
      if (st.id !== user.id) fail('Student not found.', 404);
    } else if (!isStaff(user) || !canReach(data(), user, st)) fail('Student not found.', 404);
    return st;
  }
  // A section the caller may handle grades for: its teacher, or staff at its campus.
  function reachSection(user, id) {
    const s = byId(data().sections, id);
    if (!s) fail('Class not found.', 404);
    if (user.role === 'teacher') {
      if (s.teacherId !== user.id) fail('Class not found.', 404);
    } else if (!isStaff(user) || !(user.role === 'admin' || (user.campusIds || []).includes(s.campusId))) fail('Class not found.', 404);
    return s;
  }
  const records = (studentId) => data().academicRecords.filter((r) => r.studentId === studentId);
  const recordView = (r) => ({ ...r, termName: r.termName || termName(r.termId) });

  // ----- Evaluation: a student against their curriculum -----
  // Status of each subject: passed, credited, graded (final grade in Learn, not posted yet),
  // enrolled, pending (requested), inc, failed, or remaining (with prerequisites met or not).
  function evaluation(student) {
    const d = data();
    const recs = records(student.id);
    const byCourse = new Map();
    // The best result per course: a pass beats an INC beats a fail; later beats earlier.
    const rank = (r) => (r.passed ? 3 : r.remark === 'inc' ? 2 : 1);
    for (const r of recs) {
      const cur = byCourse.get(r.courseId);
      if (!cur || rank(r) > rank(cur) || (rank(r) === rank(cur) && (r.postedAt || '') > (cur.postedAt || ''))) byCourse.set(r.courseId, r);
    }
    const learn = new Map();
    for (const e of d.enrollments.filter((x) => x.studentId === student.id && ['enrolled', 'pending', 'completed'].includes(x.status))) {
      const s = byId(d.sections, e.sectionId);
      if (!s) continue;
      const prev = learn.get(s.courseId);
      if (!prev || (e.status === 'completed' && e.passed) || prev.status !== 'completed') learn.set(s.courseId, { ...e, termId: s.termId });
    }
    const passedIds = new Set();
    for (const [cid, r] of byCourse) if (r.passed) passedIds.add(cid);
    for (const [cid, e] of learn) if (e.status === 'completed' && e.passed) passedIds.add(cid);

    const subjectStatus = (cid) => {
      const r = byCourse.get(cid);
      if (r?.passed) return { status: r.source === 'credited' ? 'credited' : 'passed', grade: r.grade, termName: r.termName || termName(r.termId), recordId: r.id };
      const e = learn.get(cid);
      if (e?.status === 'completed') {
        const eq = equivalent(e.finalGrade, S().scale, S().passingGrade);
        if (e.passed) return { status: 'graded', grade: eq?.grade, termName: termName(e.termId) };
        if (!r) return { status: 'failed', grade: eq?.grade, termName: termName(e.termId) };
      }
      if (e?.status === 'enrolled') return { status: 'enrolled', termName: termName(e.termId) };
      if (e?.status === 'pending') return { status: 'pending', termName: termName(e.termId) };
      if (r?.remark === 'inc') return { status: 'inc', termName: r.termName || termName(r.termId), recordId: r.id };
      if (r) return { status: 'failed', grade: r.grade, termName: r.termName || termName(r.termId), recordId: r.id };
      return { status: 'remaining' };
    };

    const cur = byId(d.curricula, student.curriculumId);
    const yearLevel = Number(student.yearLevel) || 1;
    const blocks = [];
    let required = 0;
    let earned = 0;
    let inProgress = 0;
    const inCurriculum = new Set();
    if (cur) {
      for (const t of [...cur.terms].sort((a, b) => a.year - b.year || termOrder(a.term) - termOrder(b.term))) {
        const subjects = t.courseIds.map((cid) => {
          inCurriculum.add(cid);
          const c = courseOf(cid);
          const units = Number(c?.units) || 0;
          const st = subjectStatus(cid);
          const prereqs = (c?.prerequisites || []).map((pid) => ({ id: pid, code: courseOf(pid)?.code || '?', met: passedIds.has(pid) }));
          required += units;
          if (['passed', 'credited', 'graded'].includes(st.status)) earned += units;
          if (['enrolled', 'pending'].includes(st.status)) inProgress += units;
          const open = ['remaining', 'failed', 'inc'].includes(st.status);
          return {
            courseId: cid, code: c?.code || '?', title: c?.title || '(removed course)', units, labUnits: Number(c?.labUnits) || 0, ...st, prereqs,
            canTake: open && st.status !== 'inc' && prereqs.every((p) => p.met),
            back: open && t.year < yearLevel,
          };
        });
        blocks.push({ year: t.year, term: t.term, subjects, units: subjects.reduce((a, s) => a + s.units, 0) });
      }
    }
    const allowed = blocks.flatMap((b) => b.subjects.filter((s) => s.canTake).map((s) => ({ ...s, year: b.year, term: b.term })));
    const others = [...byCourse.values()].filter((r) => !inCurriculum.has(r.courseId)).map(recordView);
    const remaining = blocks.flatMap((b) => b.subjects).filter((s) => !['passed', 'credited', 'graded'].includes(s.status));
    return {
      curriculum: cur ? { id: cur.id, code: cur.code, series: cur.series, major: cur.major, status: cur.status, program: programOf(cur.programId)?.code || '' } : null,
      blocks,
      allowed,
      back: allowed.filter((s) => s.back),
      others,
      totals: {
        required, earned, inProgress,
        remaining: remaining.reduce((a, s) => a + s.units, 0),
        remainingSubjects: remaining.length,
        percent: required ? Math.round((earned / required) * 100) : 0,
      },
      gwa: gwa(recs.filter((r) => r.grade != null)),
      // Done once nothing is left but subjects being taken now.
      candidate: Boolean(cur) && remaining.every((s) => ['enrolled'].includes(s.status)) && remaining.length <= 12,
      complete: Boolean(cur) && remaining.length === 0,
    };
  }

  function requirementsFor(profile) {
    const type = profile?.studentType || 'old';
    return S().requirements.filter((r) => (r.for || []).includes(type)).map((r) => ({ ...r, submitted: Boolean(profile?.requirements?.[r.id]), at: profile?.requirements?.[r.id]?.at || null, by: profile?.requirements?.[r.id]?.by || '' }));
  }

  function studentRow(st) {
    const p = profileOf(st.id);
    const reqs = requirementsFor(p);
    const cur = byId(data().curricula, st.curriculumId);
    const recs = records(st.id);
    return {
      id: st.id, name: st.name, studentNo: st.studentNo || '', yearLevel: st.yearLevel || 1, email: st.email || '',
      program: programOf(st.programId)?.code || '', programId: st.programId || null,
      curriculum: cur ? `${cur.code} ${cur.series}` : '', curriculumId: cur?.id || null,
      studentType: p?.studentType || 'old', sex: p?.sex || '',
      requirements: { done: reqs.filter((r) => r.submitted).length, total: reqs.length },
      gwa: gwa(recs), records: recs.length, inc: recs.filter((r) => r.remark === 'inc').length,
    };
  }

  // Students at the caller's active campus (staff).
  const campusStudents = (user, campusId) => data().users.filter((u) => u.role === 'student' && u.status === 'active' && (u.campusIds || []).includes(campusId));

  // ----- Settings -----
  route('GET', '/api/academic/settings', 'academic', () => ({
    ...S(), documentTypes: DOCUMENT_TYPES, studentTypes: STUDENT_TYPES, terms: TERMS,
    learnPassing: data().settings.passingGrade, scalePassing: passingPercent(S().scale, S().passingGrade),
  }));
  route('PUT', '/api/academic/settings', 'academic:academic.settings', ({ user, body }) => {
    const s = structuredClone(S());
    const range = (v, min, max, label) => {
      const n = Number(v);
      if (v === '' || v == null || !Number.isFinite(n) || n < min || n > max) fail(`${label} must be between ${min} and ${max}.`);
      return n;
    };
    if ('passingGrade' in body) s.passingGrade = range(body.passingGrade, 1, 5, 'Lowest passing grade');
    if (Array.isArray(body.scale)) {
      if (body.scale.length > 30) fail('A scale has at most 30 bands.');
      s.scale = body.scale.map((b) => ({ min: Number(b.min), grade: Number(b.grade), remark: text(b.remark, 40) })).sort((a, b) => b.min - a.min);
    }
    const problems = scaleProblems(s.scale, s.passingGrade);
    if (problems.length) fail(problems[0]);
    if (Array.isArray(body.requirements)) {
      const ids = new Set();
      s.requirements = body.requirements.filter((r) => text(r.name, 120)).map((r) => {
        let id = text(r.id, 40) || randomUUID().slice(0, 8);
        while (ids.has(id)) id = randomUUID().slice(0, 8); // two rows must not share an id
        ids.add(id);
        return { id, name: text(r.name, 120), for: (Array.isArray(r.for) ? r.for : []).filter((t) => STUDENT_TYPES.some(([k]) => k === t)) };
      });
    }
    if (body.fees) for (const d of DOCUMENT_TYPES) if (d.id in body.fees) s.fees[d.id] = range(body.fees[d.id] || 0, 0, 100000, `The ${d.name} fee`);
    if (body.registrar) s.registrar = { name: text(body.registrar.name, 120), title: text(body.registrar.title, 120) || 'University Registrar' };
    if ('incDays' in body) s.incDays = Math.round(range(body.incDays, 30, 1000, 'Days to complete an INC'));
    if (body.honors) {
      const h = { ...s.honors, ...body.honors };
      s.honors = { maxGwa: range(h.maxGwa, 1, 5, "Dean's list: GWA at most"), worstGrade: range(h.worstGrade, 1, 5, "Dean's list: no grade lower than"), minUnits: range(h.minUnits, 0, 60, "Dean's list: at least (units)") };
      if (s.honors.worstGrade > s.passingGrade) fail(`Dean's list: "no grade lower than" cannot be a failing grade (worse than ${Number(s.passingGrade).toFixed(2)}).`);
    }
    data().academicSettings = s;
    audit(user, 'Changed Academic settings');
    save();
    return s;
  });

  // ----- Colleges and programs -----
  route('GET', '/api/academic/colleges', 'academic', () => data().colleges.map((c) => ({ ...c, programs: data().programs.filter((p) => p.collegeId === c.id).map((p) => p.code) })));
  route('POST', '/api/academic/colleges', 'academic:academic.curricula', ({ user, body }) => {
    const code = text(body.code, 20).toUpperCase();
    const name = text(body.name, 120);
    if (!code || !name) fail('A college needs a code and a name.');
    if (data().colleges.some((c) => c.code === code)) fail(`There is already a college ${code}.`);
    const c = { id: randomUUID(), code, name, dean: text(body.dean, 120), createdAt: iso() };
    data().colleges.push(c);
    audit(user, `Added college ${code}`);
    save();
    return c;
  });
  route('PUT', '/api/academic/colleges/:id', 'academic:academic.curricula', ({ user, params, body }) => {
    const c = byId(data().colleges, params.id);
    if (!c) fail('College not found.', 404);
    if (body.name) c.name = text(body.name, 120);
    if ('dean' in body) c.dean = text(body.dean, 120);
    if (Array.isArray(body.programIds)) {
      for (const p of data().programs) {
        if (body.programIds.includes(p.id)) p.collegeId = c.id;
        else if (p.collegeId === c.id) p.collegeId = null;
      }
    }
    audit(user, `Changed college ${c.code}`);
    save();
    return c;
  });
  route('DELETE', '/api/academic/colleges/:id', 'academic:academic.curricula', ({ user, params }) => {
    const c = byId(data().colleges, params.id);
    if (!c) fail('College not found.', 404);
    for (const p of data().programs) if (p.collegeId === c.id) p.collegeId = null;
    data().colleges = data().colleges.filter((x) => x.id !== c.id);
    audit(user, `Removed college ${c.code}`);
    save();
    return { ok: true };
  });
  route('GET', '/api/academic/programs', 'academic', () => data().programs.map((p) => ({ id: p.id, code: p.code, name: p.name, collegeId: p.collegeId || null })));
  route('GET', '/api/academic/courses', 'academic', () => data().courses.filter((c) => c.status !== 'archived').map((c) => ({ id: c.id, code: c.code, title: c.title, units: c.units, labUnits: c.labUnits || 0, prerequisites: c.prerequisites || [], programIds: c.programIds || [] })));
  route('PUT', '/api/academic/courses/:id', 'academic:academic.curricula', ({ user, params, body }) => {
    const c = courseOf(params.id);
    if (!c) fail('Course not found.', 404);
    if ('labUnits' in body) {
      const lab = Number(body.labUnits);
      if (!(lab >= 0 && lab <= Number(c.units))) fail(`Laboratory units must be between 0 and ${c.units}.`);
      c.labUnits = lab;
    }
    audit(user, `Changed ${c.code} laboratory units to ${c.labUnits}`);
    save();
    return c;
  });

  // ----- Curricula -----
  const curriculumView = (c, full = false) => {
    const program = programOf(c.programId);
    const units = c.terms.reduce((a, t) => a + t.courseIds.reduce((b, id) => b + (Number(courseOf(id)?.units) || 0), 0), 0);
    const out = {
      id: c.id, code: c.code, series: c.series, major: c.major || '', status: c.status, notes: c.notes || '',
      program: program ? { id: program.id, code: program.code, name: program.name, collegeId: program.collegeId || null } : null,
      college: data().colleges.find((x) => x.id === program?.collegeId)?.name || '',
      subjects: c.terms.reduce((a, t) => a + t.courseIds.length, 0), units,
      students: data().users.filter((u) => u.curriculumId === c.id).length,
      postedAt: c.postedAt || null, updatedAt: c.updatedAt || c.createdAt,
    };
    if (!full) return out;
    // Prerequisites placed in the same or a later term than the subject that needs them.
    const position = new Map();
    for (const t of c.terms) for (const id of t.courseIds) position.set(id, t.year * 10 + termOrder(t.term));
    const warnings = [];
    out.terms = [...c.terms].sort((a, b) => a.year - b.year || termOrder(a.term) - termOrder(b.term)).map((t) => ({
      year: t.year, term: t.term,
      courses: t.courseIds.map((id) => {
        const co = courseOf(id);
        const prereqs = (co?.prerequisites || []).map((pid) => {
          const at = position.get(pid);
          const ok = at != null && at < t.year * 10 + termOrder(t.term);
          if (!ok) warnings.push(`${co?.code}: its prerequisite ${courseOf(pid)?.code || '?'} ${at == null ? 'is not in this curriculum' : 'comes in the same or a later term'}.`);
          return { id: pid, code: courseOf(pid)?.code || '?', ok };
        });
        return { id, code: co?.code || '?', title: co?.title || '(removed course)', units: Number(co?.units) || 0, labUnits: Number(co?.labUnits) || 0, prereqs };
      }),
    }));
    out.warnings = warnings;
    return out;
  };
  route('GET', '/api/academic/curricula', 'academic', ({ user }) => {
    const list = data().curricula.filter((c) => isStaff(user) || c.status === 'posted');
    return list.map((c) => curriculumView(c)).sort((a, b) => (a.program?.code || '').localeCompare(b.program?.code || '') || b.series.localeCompare(a.series));
  });
  route('GET', '/api/academic/curricula/:id', 'academic', ({ user, params }) => {
    const c = byId(data().curricula, params.id);
    if (!c || (!isStaff(user) && c.status !== 'posted' && user.curriculumId !== c.id)) fail('Curriculum not found.', 404);
    return curriculumView(c, true);
  });
  function cleanTerms(terms) {
    if (!Array.isArray(terms)) fail('Terms are missing.');
    const seen = new Set();
    const out = [];
    for (const t of terms) {
      const year = Number(t.year);
      if (!(year >= 1 && year <= 6)) fail('Year levels go from 1 to 6.');
      if (!TERMS.some((x) => x.id === t.term)) fail('Unknown term.');
      if (out.some((x) => x.year === year && x.term === t.term)) fail(`${year}-${t.term} appears twice.`);
      const courseIds = [];
      for (const id of Array.isArray(t.courseIds) ? t.courseIds : []) {
        const co = courseOf(id);
        if (!co) fail('A course in the curriculum no longer exists.');
        if (seen.has(id)) fail(`${co.code} appears more than once.`);
        seen.add(id);
        courseIds.push(id);
      }
      out.push({ year, term: t.term, courseIds });
    }
    return out;
  }
  route('POST', '/api/academic/curricula', 'academic:academic.curricula', ({ user, body }) => {
    const program = programOf(body.programId);
    if (!program) fail('Pick a program.');
    const series = text(body.series, 20);
    if (!series) fail('Give the curriculum series, e.g. 2026.');
    const code = text(body.code, 30).toUpperCase() || program.code;
    const major = text(body.major, 80);
    if (data().curricula.some((c) => c.programId === program.id && c.series === series && (c.major || '') === major)) fail(`${program.code} already has a ${series} curriculum${major ? ` for ${major}` : ''}.`);
    let terms = [];
    if (body.copyFrom) {
      const src = byId(data().curricula, body.copyFrom);
      if (!src) fail('The curriculum to copy was not found.');
      terms = structuredClone(src.terms);
    } else {
      const years = Math.min(6, Math.max(1, Number(body.years) || 4));
      for (let y = 1; y <= years; y++) for (const t of ['1', '2']) terms.push({ year: y, term: t, courseIds: [] });
    }
    const c = { id: randomUUID(), programId: program.id, code, series, major, status: 'draft', terms, notes: text(body.notes, 500), createdAt: iso(), updatedAt: iso() };
    data().curricula.push(c);
    audit(user, `Created curriculum ${code} ${series}`);
    save();
    return curriculumView(c, true);
  });
  route('PUT', '/api/academic/curricula/:id', 'academic:academic.curricula', ({ user, params, body }) => {
    const c = byId(data().curricula, params.id);
    if (!c) fail('Curriculum not found.', 404);
    if (c.status !== 'draft') fail('A posted curriculum is locked. Copy it to make a new series.');
    if ('terms' in body) c.terms = cleanTerms(body.terms);
    if ('code' in body) c.code = text(body.code, 30).toUpperCase() || c.code;
    if ('major' in body) c.major = text(body.major, 80);
    if ('notes' in body) c.notes = text(body.notes, 500);
    if ('series' in body && text(body.series, 20)) c.series = text(body.series, 20);
    c.updatedAt = iso();
    save();
    return curriculumView(c, true);
  });
  route('POST', '/api/academic/curricula/:id/post', 'academic:academic.curricula', ({ user, params }) => {
    const c = byId(data().curricula, params.id);
    if (!c) fail('Curriculum not found.', 404);
    if (c.status !== 'draft') fail('Only a draft can be posted.');
    if (!c.terms.some((t) => t.courseIds.length)) fail('Add subjects before posting.');
    Object.assign(c, { status: 'posted', postedAt: iso(), postedBy: user.name, updatedAt: iso() });
    audit(user, `Posted curriculum ${c.code} ${c.series}`);
    save();
    return curriculumView(c, true);
  });
  route('POST', '/api/academic/curricula/:id/retire', 'academic:academic.curricula', ({ user, params }) => {
    const c = byId(data().curricula, params.id);
    if (!c) fail('Curriculum not found.', 404);
    if (c.status !== 'posted') fail('Only a posted curriculum can be retired.');
    Object.assign(c, { status: 'retired', updatedAt: iso() });
    audit(user, `Retired curriculum ${c.code} ${c.series}`);
    save();
    return curriculumView(c, true);
  });
  route('DELETE', '/api/academic/curricula/:id', 'academic:academic.curricula', ({ user, params }) => {
    const c = byId(data().curricula, params.id);
    if (!c) fail('Curriculum not found.', 404);
    if (c.status !== 'draft') fail('Only a draft can be deleted; retire a posted curriculum instead.');
    if (data().users.some((u) => u.curriculumId === c.id)) fail('Students are assigned to this curriculum.');
    data().curricula = data().curricula.filter((x) => x.id !== c.id);
    audit(user, `Deleted draft curriculum ${c.code} ${c.series}`);
    save();
    return { ok: true };
  });

  // ----- Students -----
  route('GET', '/api/academic/students', 'academic:academic.view', ({ user, query, campusId }) => {
    const q = String(query.q || '').toLowerCase();
    let list = campusStudents(user, campusId);
    if (query.programId) list = list.filter((u) => u.programId === query.programId);
    if (query.yearLevel) list = list.filter((u) => String(u.yearLevel || 1) === String(query.yearLevel));
    if (q) list = list.filter((u) => [u.name, u.studentNo, u.email].some((v) => String(v || '').toLowerCase().includes(q)));
    let rows = list.map(studentRow);
    if (query.filter === 'no-curriculum') rows = rows.filter((r) => !r.curriculumId);
    if (query.filter === 'requirements') rows = rows.filter((r) => r.requirements.done < r.requirements.total);
    if (query.filter === 'inc') rows = rows.filter((r) => r.inc > 0);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  });

  function fullRecord(st, viewer) {
    const d = data();
    const p = profileOf(st.id) || { studentType: 'old', requirements: {}, education: [] };
    const recs = records(st.id).map(recordView);
    const terms = [...new Set(recs.map((r) => r.termId || r.termName))].map((t) => {
      const list = recs.filter((r) => (r.termId || r.termName) === t);
      return { termId: list[0].termId || null, termName: list[0].termName, records: list.sort((a, b) => a.courseCode.localeCompare(b.courseCode)), gwa: gwa(list), units: list.reduce((a, r) => a + (r.passed ? Number(r.units) : 0), 0) };
    }).sort((a, b) => String(byId(d.terms, a.termId)?.startDate || a.termName).localeCompare(String(byId(d.terms, b.termId)?.startDate || b.termName)));
    const current = d.enrollments.filter((e) => e.studentId === st.id && e.termId === d.settings.currentTermId && ['enrolled', 'pending', 'completed'].includes(e.status)).map((e) => {
      const s = byId(d.sections, e.sectionId);
      const c = courseOf(s?.courseId);
      return { id: e.id, status: e.status, code: c?.code, title: c?.title, units: Number(c?.units) || 0, section: s?.name, room: s?.room || '', meetings: s?.meetings || [], teacher: byId(d.users, s?.teacherId)?.name || '' };
    });
    const out = {
      student: { id: st.id, name: st.name, studentNo: st.studentNo || '', email: st.email || '', yearLevel: st.yearLevel || 1, programId: st.programId || null, program: programOf(st.programId) ? { code: programOf(st.programId).code, name: programOf(st.programId).name } : null, curriculumId: st.curriculumId || null, campus: d.campuses.find((c) => c.id === campusOf(st))?.name || '' },
      profile: p,
      names: nameParts(st, p),
      requirements: requirementsFor(p),
      evaluation: evaluation(st),
      terms,
      current: { termId: d.settings.currentTermId, termName: termName(d.settings.currentTermId), classes: current, units: current.reduce((a, c) => a + c.units, 0) },
      requests: d.documentRequests.filter((r) => r.studentId === st.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      changes: d.gradeChanges.filter((g) => g.studentId === st.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
    if (viewer.role !== 'student') out.history = d.auditLog.filter((a) => a.studentId === st.id).slice(-50).reverse();
    return out;
  }
  route('GET', '/api/academic/students/:id', 'academic:academic.view', ({ user, params }) => fullRecord(reachStudent(user, params.id), user));

  route('PUT', '/api/academic/students/:id', 'academic:academic.records', ({ user, params, body }) => {
    const st = reachStudent(user, params.id);
    const p = ensureProfile(st);
    const fields = ['lastName', 'firstName', 'middleName', 'suffix', 'lrn', 'sex', 'civilStatus', 'citizenship', 'religion', 'address', 'contactNo', 'guardianName', 'guardianContact', 'previousSchool'];
    for (const f of fields) if (f in body) p[f] = text(body[f], 160);
    if ('birthDate' in body) {
      if (body.birthDate && !DATE_RE.test(body.birthDate)) fail('Birth date must be a date.');
      p.birthDate = body.birthDate || '';
    }
    if ('sex' in body && p.sex && !['Male', 'Female'].includes(p.sex)) fail('Sex is Male or Female (as on the PSA birth certificate).');
    if ('studentType' in body) {
      if (!STUDENT_TYPES.some(([k]) => k === body.studentType)) fail('Unknown student type.');
      p.studentType = body.studentType;
    }
    if (Array.isArray(body.education)) p.education = body.education.slice(0, 6).map((e) => ({ level: text(e.level, 40), school: text(e.school, 160), year: text(e.year, 20) }));
    if ('programId' in body && body.programId !== st.programId) {
      if (body.programId && !programOf(body.programId)) fail('Program not found.');
      audit(user, `Changed program from ${programOf(st.programId)?.code || 'none'} to ${programOf(body.programId)?.code || 'none'}`, { studentId: st.id });
      st.programId = body.programId || null;
    }
    if ('curriculumId' in body && body.curriculumId !== st.curriculumId) {
      const c = body.curriculumId ? byId(data().curricula, body.curriculumId) : null;
      if (body.curriculumId && !c) fail('Curriculum not found.');
      if (c && c.status !== 'posted') fail('Assign a posted curriculum.');
      if (c && st.programId && c.programId !== st.programId) fail(`That curriculum is for ${programOf(c.programId)?.code}, not the student's program.`);
      audit(user, `Assigned curriculum ${c ? `${c.code} ${c.series}` : 'none'}`, { studentId: st.id });
      st.curriculumId = c?.id || null;
    }
    if ('yearLevel' in body && Number(body.yearLevel) !== Number(st.yearLevel)) {
      const y = Number(body.yearLevel);
      if (!(y >= 1 && y <= 6)) fail('Year level is 1 to 6.');
      audit(user, `Changed year level from ${st.yearLevel || 1} to ${y}`, { studentId: st.id });
      st.yearLevel = y;
    }
    p.updatedAt = iso();
    save();
    return fullRecord(st, user);
  });

  route('PUT', '/api/academic/students/:id/requirements', 'academic:academic.records', ({ user, params, body }) => {
    const st = reachStudent(user, params.id);
    const p = ensureProfile(st);
    for (const [id, on] of Object.entries(body.requirements || {})) {
      const req = S().requirements.find((r) => r.id === id);
      if (!req) continue;
      if (on && !p.requirements[id]) {
        p.requirements[id] = { at: iso(), by: user.name };
        audit(user, `Received requirement: ${req.name}`, { studentId: st.id });
      } else if (!on && p.requirements[id]) {
        delete p.requirements[id];
        audit(user, `Removed requirement: ${req.name}`, { studentId: st.id });
      }
    }
    save();
    return requirementsFor(p);
  });

  // Subjects taken elsewhere (transferees) or before ATLAS: credited onto the record.
  route('POST', '/api/academic/students/:id/credits', 'academic:academic.records', ({ user, params, body }) => {
    const st = reachStudent(user, params.id);
    const c = courseOf(body.courseId);
    if (!c) fail('Pick the subject to credit.');
    if (records(st.id).some((r) => r.courseId === c.id && r.passed)) fail(`${c.code} is already passed or credited.`);
    const grade = body.grade === '' || body.grade == null ? null : Number(body.grade);
    if (grade != null && !(grade >= 1 && grade <= S().passingGrade)) fail(`A credited grade is between 1.00 and ${Number(S().passingGrade).toFixed(2)}.`);
    const school = text(body.school, 160);
    if (!school) fail('Name the school where the subject was taken.');
    const r = {
      id: randomUUID(), studentId: st.id, campusId: campusOf(st), termId: null, termName: text(body.termName, 60) || 'Credited',
      courseId: c.id, courseCode: c.code, courseTitle: c.title, units: Number(c.units) || 0, percent: null, grade,
      remark: 'credited', passed: true, source: 'credited', school, originalCode: text(body.originalCode, 30),
      postedAt: iso(), postedBy: user.name, history: [],
    };
    data().academicRecords.push(r);
    audit(user, `Credited ${c.code} from ${school}${grade != null ? ` (${grade.toFixed(2)})` : ''}`, { studentId: st.id });
    save();
    return recordView(r);
  });

  // ----- Grade sheets: Learn's final grades → teacher submits → dean approves → registrar posts -----
  const sheetOf = (sectionId) => data().gradeSheets.find((g) => g.sectionId === sectionId) || null;
  function sheetRows(section) {
    const d = data();
    return d.enrollments.filter((e) => e.sectionId === section.id && ['enrolled', 'completed'].includes(e.status)).map((e) => {
      const st = byId(d.users, e.studentId);
      const eq = e.status === 'completed' ? equivalent(e.finalGrade, S().scale, S().passingGrade) : null;
      return { studentId: e.studentId, enrollmentId: e.id, name: st?.name || '?', studentNo: st?.studentNo || '', percent: e.status === 'completed' ? e.finalGrade : null, grade: eq?.grade ?? null, remark: eq ? (eq.passed ? 'passed' : 'failed') : null };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  function sheetView(section, withRows = false) {
    const d = data();
    const c = courseOf(section.courseId);
    const g = sheetOf(section.id);
    const live = sheetRows(section);
    const out = {
      sectionId: section.id, code: c?.code || '?', title: c?.title || '', units: Number(c?.units) || 0, section: section.name, termId: section.termId, termName: termName(section.termId),
      teacher: byId(d.users, section.teacherId)?.name || '', campusId: section.campusId, room: section.room || '',
      program: (c?.programIds || []).map((id) => programOf(id)?.code).filter(Boolean).join(', '),
      status: g?.status || 'none', sheetId: g?.id || null, note: g?.note || '',
      submittedAt: g?.submittedAt || null, submittedBy: g?.submittedBy || '', approvedAt: g?.approvedAt || null, approvedBy: g?.approvedBy || '', postedAt: g?.postedAt || null, postedBy: g?.postedBy || '',
      students: live.length, graded: live.filter((r) => r.percent != null).length,
    };
    if (withRows) out.rows = g && g.status !== 'returned' ? g.rows : live.map((r) => ({ ...r, inc: false }));
    if (withRows && g) out.trail = g.trail || [];
    return out;
  }
  route('GET', '/api/academic/grade-sheets', 'academic', ({ user, query, campusId }) => {
    if (user.role === 'student') fail('Not for students.', 403);
    if (isStaff(user) && !can(user.role, 'academic.view')) fail('Your account does not have access to this.', 403);
    // A status to work on (waiting for approval, to post, returned) lists every term unless one is picked.
    const termId = query.termId === 'all' || (!query.termId && ['submitted', 'approved', 'returned'].includes(query.status)) ? null : query.termId || data().settings.currentTermId;
    const list = data().sections.filter((s) => (!termId || s.termId === termId) && s.status !== 'cancelled' && (user.role === 'teacher' ? s.teacherId === user.id : s.campusId === campusId));
    let rows = list.map((s) => sheetView(s));
    if (query.status) rows = rows.filter((r) => r.status === query.status);
    return { termId, terms: data().terms.map((t) => ({ id: t.id, name: t.name })), sheets: rows.sort((a, b) => a.code.localeCompare(b.code) || a.section.localeCompare(b.section)) };
  });
  route('GET', '/api/academic/grade-sheets/:sectionId', 'academic', ({ user, params }) => sheetView(reachSection(user, params.sectionId), true));

  route('POST', '/api/academic/grade-sheets/:sectionId/submit', 'academic', ({ user, params, body }) => {
    const s = reachSection(user, params.sectionId);
    if (user.role !== 'teacher' && !can(user.role, 'academic.records')) fail('Only the teacher or the registrar submits a grade sheet.', 403);
    const g = sheetOf(s.id);
    if (g && !['returned'].includes(g.status)) fail(g.status === 'posted' ? 'This grade sheet is already posted.' : 'This grade sheet is already submitted.');
    const inc = new Set(Array.isArray(body.inc) ? body.inc : []);
    const rows = sheetRows(s).map((r) => (inc.has(r.studentId) ? { ...r, percent: null, grade: null, remark: 'inc' } : r));
    if (!rows.length) fail('There are no students in this class.');
    const missing = rows.filter((r) => r.remark == null);
    if (missing.length) fail(`${missing.length} student${missing.length === 1 ? ' has' : 's have'} no final grade yet. Give final grades in Learn (Grades), or mark them INC.`);
    const sheet = g || { id: randomUUID(), sectionId: s.id, termId: s.termId, campusId: s.campusId, createdAt: iso(), trail: [] };
    Object.assign(sheet, { rows, status: 'submitted', note: '', submittedAt: iso(), submittedBy: user.name, approvedAt: null, approvedBy: '' });
    sheet.trail.push({ at: iso(), by: user.name, action: 'Submitted' });
    if (!g) data().gradeSheets.push(sheet);
    audit(user, `Submitted grade sheet ${courseOf(s.courseId)?.code} ${s.name}`);
    save();
    return sheetView(s, true);
  });
  const sheetById = (user, id) => {
    const g = byId(data().gradeSheets, id);
    if (!g) fail('Grade sheet not found.', 404);
    return { g, s: reachSection(user, g.sectionId) };
  };
  route('POST', '/api/academic/grade-sheets/:id/approve', 'academic:grades.approve', ({ user, params }) => {
    const { g, s } = sheetById(user, params.id);
    if (g.status !== 'submitted') fail('Only a submitted grade sheet can be approved.');
    Object.assign(g, { status: 'approved', approvedAt: iso(), approvedBy: user.name });
    g.trail.push({ at: iso(), by: user.name, action: 'Approved' });
    audit(user, `Approved grade sheet ${courseOf(s.courseId)?.code} ${s.name}`);
    save();
    return sheetView(s, true);
  });
  route('POST', '/api/academic/grade-sheets/:id/return', 'academic', ({ user, params, body }) => {
    if (!can(user.role, 'grades.approve') && !can(user.role, 'academic.records')) fail('Your account does not have access to this.', 403);
    const { g, s } = sheetById(user, params.id);
    if (!['submitted', 'approved'].includes(g.status)) fail('Only a submitted or approved grade sheet can be returned.');
    const note = text(body.note, 500);
    if (!note) fail('Say why it is returned, so the teacher knows what to fix.');
    Object.assign(g, { status: 'returned', note });
    g.trail.push({ at: iso(), by: user.name, action: 'Returned', note });
    audit(user, `Returned grade sheet ${courseOf(s.courseId)?.code} ${s.name}: ${note}`);
    save();
    return sheetView(s, true);
  });
  route('POST', '/api/academic/grade-sheets/:id/post', 'academic:academic.records', ({ user, params }) => {
    const { g, s } = sheetById(user, params.id);
    if (g.status !== 'approved') fail('Only an approved grade sheet can be posted.');
    const c = courseOf(s.courseId);
    for (const row of g.rows) {
      if (data().academicRecords.some((r) => r.gradeSheetId === g.id && r.studentId === row.studentId)) continue;
      const st = byId(data().users, row.studentId);
      data().academicRecords.push({
        id: randomUUID(), studentId: row.studentId, campusId: s.campusId, termId: s.termId, termName: termName(s.termId),
        courseId: c.id, courseCode: c.code, courseTitle: c.title, units: Number(c.units) || 0, sectionId: s.id, gradeSheetId: g.id,
        percent: row.percent, grade: row.grade, remark: row.remark, passed: row.remark === 'passed', source: 'grade-sheet',
        incDeadline: row.remark === 'inc' ? new Date(Date.now() + S().incDays * 86400000).toISOString().slice(0, 10) : null,
        postedAt: iso(), postedBy: user.name, history: [],
      });
      audit(user, `Posted ${c.code}: ${row.remark === 'inc' ? 'INC' : `${row.grade?.toFixed(2)} (${row.percent})`}`, { studentId: st?.id });
    }
    Object.assign(g, { status: 'posted', postedAt: iso(), postedBy: user.name });
    g.trail.push({ at: iso(), by: user.name, action: 'Posted' });
    save();
    return sheetView(s, true);
  });

  // ----- Grade changes (rectification, completing an INC): requested, then approved by someone else -----
  route('POST', '/api/academic/records/:id/changes', 'academic:academic.records', ({ user, params, body }) => {
    const r = byId(data().academicRecords, params.id);
    if (!r) fail('Record not found.', 404);
    reachStudent(user, r.studentId);
    if (r.source === 'credited') fail('Credited subjects are corrected by removing and crediting again.');
    if (data().gradeChanges.some((x) => x.recordId === r.id && x.status === 'pending')) fail('A change for this grade is already waiting for approval.');
    const reason = text(body.reason, 500);
    if (!reason) fail('Give the reason for the change.');
    let to;
    if (body.remark === 'dropped') to = { percent: null, grade: null, remark: 'dropped', passed: false };
    else {
      const pct = Number(body.percent);
      if (!(pct >= 0 && pct <= 100) || body.percent === '' || body.percent == null) fail('Enter the corrected percentage (0–100).');
      const eq = equivalent(pct, S().scale, S().passingGrade);
      to = { percent: pct, grade: eq.grade, remark: eq.passed ? 'passed' : 'failed', passed: eq.passed };
    }
    const change = {
      id: randomUUID(), recordId: r.id, studentId: r.studentId, courseCode: r.courseCode, termName: r.termName,
      kind: r.remark === 'inc' ? 'inc' : 'rectification', from: { percent: r.percent, grade: r.grade, remark: r.remark }, to, reason,
      status: 'pending', requestedBy: user.name, requestedById: user.id, createdAt: iso(),
    };
    data().gradeChanges.push(change);
    audit(user, `Requested ${change.kind === 'inc' ? 'INC completion' : 'grade change'} for ${r.courseCode}: ${reason}`, { studentId: r.studentId });
    save();
    return change;
  });
  route('GET', '/api/academic/changes', 'academic:academic.view', ({ user, query, campusId }) => data().gradeChanges
    .filter((c) => (!query.status || c.status === query.status) && byId(data().users, c.studentId)?.campusIds?.includes(campusId))
    .map((c) => ({ ...c, student: { id: c.studentId, name: byId(data().users, c.studentId)?.name || '?', studentNo: byId(data().users, c.studentId)?.studentNo || '' } }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  route('POST', '/api/academic/changes/:id/:decision', 'academic:grades.approve', ({ user, params, body }) => {
    const c = byId(data().gradeChanges, params.id);
    if (!c) fail('Change not found.', 404);
    reachStudent(user, c.studentId);
    if (!['approve', 'reject'].includes(params.decision)) fail('Not found.', 404);
    if (c.status !== 'pending') fail('This change was already decided.');
    if (c.requestedById === user.id) fail('Someone other than the person who asked for a change must approve it.', 403);
    c.status = params.decision === 'approve' ? 'approved' : 'rejected';
    Object.assign(c, { decidedBy: user.name, decidedAt: iso(), note: text(body.note, 300) });
    if (c.status === 'approved') {
      const r = byId(data().academicRecords, c.recordId);
      r.history.push({ at: iso(), from: c.from, to: c.to, reason: c.reason, requestedBy: c.requestedBy, approvedBy: user.name });
      Object.assign(r, c.to, { source: r.source, incDeadline: null, changedAt: iso() });
    }
    audit(user, `${c.status === 'approved' ? 'Approved' : 'Rejected'} grade change for ${c.courseCode}`, { studentId: c.studentId });
    save();
    return c;
  });

  // ----- Documents: requests, issuing, verification -----
  // Settings → Numbering (DR2026-00001 by default); a new series continues after this year's requests.
  const nextRef = () => nextNumber(data(), 'documentRequest');
  function newRequest(user, st, body) {
    const t = docType(body.type);
    if (!t) fail('Pick the document.');
    const copies = Math.min(10, Math.max(1, Number(body.copies) || 1));
    const purpose = text(body.purpose, 200);
    if (!purpose) fail('Say what the document is for (e.g. employment, scholarship, transfer).');
    const fee = (S().fees[t.id] ?? t.fee) * copies;
    const r = {
      id: randomUUID(), refNo: nextRef(), studentId: st.id, campusId: campusOf(st), type: t.id, copies, purpose, fee,
      status: fee ? 'requested' : 'paid', orNo: '', history: [{ at: iso(), by: user.name, status: 'requested' }], createdAt: iso(), updatedAt: iso(),
    };
    data().documentRequests.push(r);
    audit(user, `Requested ${t.label} ×${copies} (${r.refNo})`, { studentId: st.id });
    save();
    return r;
  }
  const requestView = (r) => {
    const st = byId(data().users, r.studentId);
    return { ...r, typeLabel: docType(r.type)?.label || r.type, student: { id: r.studentId, name: st?.name || '?', studentNo: st?.studentNo || '' } };
  };
  route('GET', '/api/academic/requests', 'academic:academic.view', ({ query, campusId }) => data().documentRequests
    .filter((r) => r.campusId === campusId && (!query.status || (query.status === 'open' ? !['released', 'cancelled'].includes(r.status) : r.status === query.status)))
    .map(requestView).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  route('POST', '/api/academic/requests', 'academic:academic.records', ({ user, body }) => requestView(newRequest(user, reachStudent(user, body.studentId), body)));
  route('PUT', '/api/academic/requests/:id', 'academic:academic.records', ({ user, params, body }) => {
    const r = byId(data().documentRequests, params.id);
    if (!r) fail('Request not found.', 404);
    reachStudent(user, r.studentId);
    const next = { pay: 'paid', process: 'processing', ready: 'ready', release: 'released', cancel: 'cancelled' }[body.action];
    if (!next) fail('Unknown action.');
    const from = { paid: ['requested'], processing: ['paid'], ready: ['processing', 'paid'], released: ['ready'], cancelled: ['requested', 'paid', 'processing', 'ready'] }[next];
    if (!from.includes(r.status)) fail(`A request that is ${REQUEST_STATUS[r.status].toLowerCase()} cannot be marked ${REQUEST_STATUS[next].toLowerCase()}.`);
    if (next === 'paid') {
      r.orNo = text(body.orNo, 40);
      if (!r.orNo) fail('Enter the official receipt (O.R.) number.');
    }
    if (next === 'released') r.releasedTo = text(body.releasedTo, 120) || 'The student';
    if (next === 'cancelled') r.cancelReason = text(body.reason, 200);
    r.status = next;
    r.updatedAt = iso();
    r.history.push({ at: iso(), by: user.name, status: next, note: body.orNo || body.releasedTo || body.reason || '' });
    audit(user, `${REQUEST_STATUS[next]}: ${docType(r.type)?.label} (${r.refNo})`, { studentId: r.studentId });
    save();
    return requestView(r);
  });

  // The content of a document, from the record as it is now. Saved with its code when issued.
  function documentPayload(type, st, termId) {
    const d = data();
    const rec = fullRecord(st, { role: 'registrar' });
    const school = { name: d.settings.schoolName, campus: rec.student.campus, logo: d.settings.branding.logo || '' };
    const base = { type, title: docType(type)?.label, school, student: rec.student, names: rec.names, profile: { sex: rec.profile.sex || '', birthDate: rec.profile.birthDate || '', address: rec.profile.address || '', citizenship: rec.profile.citizenship || '', previousSchool: rec.profile.previousSchool || '' }, registrar: S().registrar };
    if (type === 'tor') return { ...base, terms: rec.terms.map((t) => ({ termName: t.termName, records: t.records.map(({ courseCode, courseTitle, units, grade, remark, school: from, percent }) => ({ courseCode, courseTitle, units, grade, remark, percent, from: from || '' })), gwa: t.gwa })), gwa: rec.evaluation.gwa, earned: rec.terms.reduce((a, t) => a + t.units, 0), curriculum: rec.evaluation.curriculum };
    const tid = termId || d.settings.currentTermId;
    const tname = termName(tid);
    if (type === 'cog') {
      const t = rec.terms.find((x) => x.termId === tid);
      if (!t) fail(`No posted grades for ${tname || 'that term'}.`);
      return { ...base, termName: tname, records: t.records.map(({ courseCode, courseTitle, units, grade, remark }) => ({ courseCode, courseTitle, units, grade, remark })), gwa: t.gwa };
    }
    if (type === 'cor' || type === 'coe') {
      const classes = d.enrollments.filter((e) => e.studentId === st.id && e.termId === tid && ['enrolled', 'completed'].includes(e.status)).map((e) => {
        const s = byId(d.sections, e.sectionId);
        const c = courseOf(s?.courseId);
        return { code: c?.code, title: c?.title, units: Number(c?.units) || 0, labUnits: Number(c?.labUnits) || 0, section: s?.name, room: s?.room || '', meetings: s?.meetings || [], teacher: byId(d.users, s?.teacherId)?.name || '' };
      });
      if (!classes.length) fail(`${st.name} is not enrolled in ${tname || 'the current term'}.`);
      return { ...base, termName: tname, classes, units: classes.reduce((a, c) => a + c.units, 0) };
    }
    if (type === 'gmc' || type === 'hd') return { ...base, termName: tname };
    fail('Unknown document.');
  }
  function issue(user, type, st, { termId, requestId } = {}) {
    const payload = documentPayload(type, st, termId);
    let code;
    do code = randomBytes(6).toString('hex').toUpperCase().match(/.{4}/g).join('-');
    while (data().issuedDocuments.some((x) => x.code === code));
    const doc = { id: randomUUID(), code, type, studentId: st.id, requestId: requestId || null, issuedAt: iso(), issuedBy: user.name, payload };
    data().issuedDocuments.push(doc);
    audit(user, `Issued ${payload.title} (${code})`, { studentId: st.id });
    save();
    return doc;
  }
  route('POST', '/api/academic/documents', 'academic:academic.records', ({ user, body }) => {
    const st = reachStudent(user, body.studentId);
    if (body.requestId) {
      const r = byId(data().documentRequests, body.requestId);
      if (!r || r.studentId !== st.id) fail('Request not found.', 404);
      if (r.status === 'requested') fail('This request is not paid yet.');
    }
    return issue(user, body.type, st, body);
  });
  route('GET', '/api/academic/documents/:code', 'academic', ({ user, params }) => {
    const doc = data().issuedDocuments.find((x) => x.code === params.code);
    if (!doc) fail('Document not found.', 404);
    if (user.role === 'student' ? doc.studentId !== user.id : !isStaff(user)) fail('Document not found.', 404);
    if (isStaff(user)) reachStudent(user, doc.studentId); // staff: only students at their campuses
    return doc;
  });
  route('GET', '/api/verify/:code', 'public', ({ params }) => {
    const doc = data().issuedDocuments.find((x) => x.code === String(params.code).toUpperCase());
    if (!doc) return { valid: false };
    const p = doc.payload;
    const mask = (s) => String(s || '').replace(/^(.{3}).*(.{2})$/, (_, a, b) => `${a}•••${b}`);
    return {
      valid: true, code: doc.code, title: p.title, issuedAt: doc.issuedAt, school: p.school.name, campus: p.school.campus,
      student: p.student.name, studentNo: mask(p.student.studentNo), program: p.student.program?.name || '',
      termName: p.termName || '', units: p.units ?? p.earned ?? null, gwa: p.gwa ?? null,
    };
  });

  // ----- Students' own record (self-service) -----
  route('GET', '/api/academic/my/record', 'academic', ({ user }) => {
    if (user.role !== 'student') fail('This is for students.', 403);
    return fullRecord(user, user);
  });
  route('GET', '/api/academic/my/requests', 'academic', ({ user }) => {
    if (user.role !== 'student') fail('This is for students.', 403);
    return data().documentRequests.filter((r) => r.studentId === user.id).map(requestView).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  route('POST', '/api/academic/my/requests', 'academic', ({ user, body }) => {
    if (user.role !== 'student') fail('This is for students.', 403);
    if (!docType(body.type)?.official) fail('Print your Certificate of Registration yourself from My registration.');
    return requestView(newRequest(user, user, body));
  });
  route('POST', '/api/academic/my/requests/:id/cancel', 'academic', ({ user, params }) => {
    const r = byId(data().documentRequests, params.id);
    if (user.role !== 'student' || !r || r.studentId !== user.id) fail('Request not found.', 404);
    if (r.status !== 'requested') fail('Only an unpaid request can be withdrawn. Ask the registrar.');
    r.status = 'cancelled';
    r.history.push({ at: iso(), by: user.name, status: 'cancelled', note: 'Withdrawn by the student' });
    save();
    return requestView(r);
  });
  // The Certificate of Registration for the current term: printed by the student, verifiable.
  route('POST', '/api/academic/my/cor', 'academic', ({ user }) => {
    if (user.role !== 'student') fail('This is for students.', 403);
    const termId = data().settings.currentTermId;
    const existing = data().issuedDocuments.filter((x) => x.studentId === user.id && x.type === 'cor' && x.payload.termName === termName(termId)).at(-1);
    const fresh = documentPayload('cor', user, termId);
    if (existing && JSON.stringify(existing.payload.classes) === JSON.stringify(fresh.classes)) return existing;
    return issue(user, 'cor', user, { termId });
  });

  // ----- Dashboard and reports -----
  route('GET', '/api/academic/dashboard', 'academic:academic.view', ({ user, campusId }) => {
    const d = data();
    const students = campusStudents(user, campusId);
    const termId = d.settings.currentTermId;
    const sections = d.sections.filter((s) => s.campusId === campusId && s.termId === termId);
    const sheets = sections.map((s) => sheetOf(s.id)?.status || 'none');
    const count = (st) => sheets.filter((x) => x === st).length;
    const rows = students.map(studentRow);
    const enrolled = new Set(d.enrollments.filter((e) => e.termId === termId && ['enrolled', 'completed'].includes(e.status) && sections.some((s) => s.id === e.sectionId)).map((e) => e.studentId));
    return {
      termName: termName(termId),
      students: students.length,
      enrolled: enrolled.size,
      noCurriculum: rows.filter((r) => !r.curriculumId).length,
      requirementsMissing: rows.filter((r) => r.requirements.done < r.requirements.total).length,
      inc: rows.filter((r) => r.inc > 0).length,
      sheets: { none: count('none'), submitted: count('submitted'), approved: count('approved'), posted: count('posted'), returned: count('returned'), total: sheets.length },
      // Work waiting from any term.
      queue: Object.fromEntries(['submitted', 'approved', 'returned'].map((st) => [st, d.gradeSheets.filter((g) => g.campusId === campusId && g.status === st).length])),
      changesPending: d.gradeChanges.filter((c) => c.status === 'pending' && students.some((s) => s.id === c.studentId)).length,
      requestsOpen: d.documentRequests.filter((r) => r.campusId === campusId && !['released', 'cancelled'].includes(r.status)).length,
      requestsUnpaid: d.documentRequests.filter((r) => r.campusId === campusId && r.status === 'requested').length,
      curricula: { draft: d.curricula.filter((c) => c.status === 'draft').length, posted: d.curricula.filter((c) => c.status === 'posted').length },
      byProgram: d.programs.map((p) => ({ code: p.code, students: students.filter((s) => s.programId === p.id).length, enrolled: students.filter((s) => s.programId === p.id && enrolled.has(s.id)).length })).filter((p) => p.students),
      recent: d.auditLog.filter((a) => !a.studentId || students.some((s) => s.id === a.studentId)).slice(-8).reverse(),
    };
  });

  // Officially enrolled students of a term at the campus, with their subjects.
  function enrolledIn(campusId, termId) {
    const d = data();
    const sections = new Map(d.sections.filter((s) => s.campusId === campusId && s.termId === termId).map((s) => [s.id, s]));
    const by = new Map();
    for (const e of d.enrollments.filter((x) => sections.has(x.sectionId) && ['enrolled', 'completed'].includes(x.status))) {
      const st = byId(d.users, e.studentId);
      if (!st) continue;
      const c = courseOf(sections.get(e.sectionId).courseId);
      if (!by.has(st.id)) by.set(st.id, { st, subjects: [] });
      by.get(st.id).subjects.push({ code: c?.code || '?', units: Number(c?.units) || 0, labUnits: Number(c?.labUnits) || 0 });
    }
    return [...by.values()].map(({ st, subjects }) => {
      const p = profileOf(st.id) || {};
      const n = nameParts(st, p);
      const lab = subjects.reduce((a, s) => a + s.labUnits, 0);
      const total = subjects.reduce((a, s) => a + s.units, 0);
      return {
        studentId: st.id, studentNo: st.studentNo || '', lastName: n.last, firstName: n.first, middleName: n.middle,
        sex: p.sex || '', program: programOf(st.programId)?.code || '', programId: st.programId || null, yearLevel: Number(st.yearLevel) || 1,
        studentType: p.studentType || 'old', subjects: subjects.map((s) => s.code).join(', '), units: total, labUnits: lab, lecUnits: total - lab,
      };
    }).sort((a, b) => a.program.localeCompare(b.program) || a.yearLevel - b.yearLevel || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  }
  const termOf = (query) => query.termId || data().settings.currentTermId;
  route('GET', '/api/academic/reports/enrollment-list', 'academic:academic.view', ({ query, campusId }) => {
    let rows = enrolledIn(campusId, termOf(query));
    if (query.programId) rows = rows.filter((r) => r.programId === query.programId);
    if (query.yearLevel) rows = rows.filter((r) => String(r.yearLevel) === String(query.yearLevel));
    if (query.sex) rows = rows.filter((r) => r.sex === query.sex);
    if (query.studentType) rows = rows.filter((r) => r.studentType === query.studentType);
    return { termName: termName(termOf(query)), rows };
  });
  route('GET', '/api/academic/reports/summary', 'academic:academic.view', ({ query, campusId }) => {
    const rows = enrolledIn(campusId, termOf(query));
    const programs = [...new Set(rows.map((r) => r.program))].sort();
    const years = [...new Set(rows.map((r) => r.yearLevel))].sort();
    const table = programs.map((p) => {
      const mine = rows.filter((r) => r.program === p);
      return { program: p, years: years.map((y) => {
        const yr = mine.filter((r) => r.yearLevel === y);
        return { year: y, male: yr.filter((r) => r.sex === 'Male').length, female: yr.filter((r) => r.sex === 'Female').length, total: yr.length };
      }), male: mine.filter((r) => r.sex === 'Male').length, female: mine.filter((r) => r.sex === 'Female').length, total: mine.length };
    });
    return { termName: termName(termOf(query)), years, table, total: rows.length, male: rows.filter((r) => r.sex === 'Male').length, female: rows.filter((r) => r.sex === 'Female').length, unknownSex: rows.filter((r) => !r.sex).length };
  });
  route('GET', '/api/academic/reports/failing', 'academic:academic.view', ({ user, query, campusId }) => {
    const tid = termOf(query);
    const ids = new Set(campusStudents(user, campusId).map((s) => s.id));
    return { termName: termName(tid), rows: data().academicRecords.filter((r) => ids.has(r.studentId) && r.termId === tid && ['failed', 'inc'].includes(r.remark)).map((r) => {
      const st = byId(data().users, r.studentId);
      return { studentId: r.studentId, studentNo: st?.studentNo || '', name: st?.name || '?', program: programOf(st?.programId)?.code || '', yearLevel: st?.yearLevel || 1, courseCode: r.courseCode, courseTitle: r.courseTitle, grade: r.grade, remark: r.remark, incDeadline: r.incDeadline || null };
    }).sort((a, b) => a.name.localeCompare(b.name)) };
  });
  route('GET', '/api/academic/reports/honors', 'academic:academic.view', ({ user, query, campusId }) => {
    const tid = termOf(query);
    const h = S().honors;
    const rows = [];
    for (const st of campusStudents(user, campusId)) {
      const list = records(st.id).filter((r) => r.termId === tid);
      if (!list.length || list.some((r) => ['inc', 'dropped', 'failed'].includes(r.remark))) continue;
      const units = list.reduce((a, r) => a + Number(r.units), 0);
      const g = gwa(list);
      if (g == null || units < h.minUnits || g > h.maxGwa || list.some((r) => r.grade > h.worstGrade)) continue;
      rows.push({ studentId: st.id, studentNo: st.studentNo || '', name: st.name, program: programOf(st.programId)?.code || '', yearLevel: st.yearLevel || 1, units, gwa: g });
    }
    return { termName: termName(tid), rules: h, rows: rows.sort((a, b) => a.gwa - b.gwa) };
  });
  route('GET', '/api/academic/reports/graduation', 'academic:academic.view', ({ user, campusId }) => {
    const rows = [];
    for (const st of campusStudents(user, campusId)) {
      if (!st.curriculumId) continue;
      const ev = evaluation(st);
      if (!ev.candidate && !ev.complete) continue;
      const reqs = requirementsFor(profileOf(st.id));
      rows.push({ studentId: st.id, studentNo: st.studentNo || '', name: st.name, program: programOf(st.programId)?.code || '', curriculum: `${ev.curriculum.code} ${ev.curriculum.series}`, gwa: ev.gwa, remaining: ev.totals.remainingSubjects, inProgress: ev.totals.inProgress, complete: ev.complete, requirementsDone: reqs.every((r) => r.submitted) });
    }
    return { rows: rows.sort((a, b) => a.program.localeCompare(b.program) || a.name.localeCompare(b.name)) };
  });

  route('GET', '/api/academic/audit', 'academic:academic.view', ({ user, query, campusId }) => {
    const ids = new Set(campusStudents(user, campusId).map((s) => s.id));
    return data().auditLog.filter((a) => (!query.studentId || a.studentId === query.studentId) && (!a.studentId || ids.has(a.studentId))).slice(-300).reverse();
  });

  return { evaluation, permissionsFor: (role) => ACADEMIC_PERMISSION_LABELS.map(([p]) => p).filter((p) => can(role, p)) };
}
