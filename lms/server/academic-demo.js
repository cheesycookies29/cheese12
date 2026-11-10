// Academic demo data, added with the rest of the demo school (server/demo.js): colleges,
// curricula (four posted, one draft), student profiles and requirements, last term's grade
// sheets at every step (posted, approved, waiting for the dean), the permanent records they
// produced, an INC with its completion waiting for approval, a transferee's credited subject,
// document requests in every status, and a dean account (dean.demo).
import { randomUUID } from 'node:crypto';
import { equivalent } from '../shared/academic.js';
import { nameParts } from './academic.js';

const FEMALE = new Set(['Andrea', 'Camille', 'Patricia', 'Kristine', 'Nicole', 'Danica', 'Shaira', 'Aileen', 'Erika', 'Hannah', 'Mae', 'Princess', 'Joanna', 'Clarisse', 'Faith', 'Lovely', 'Rica', 'Joy', 'Bea', 'Jasmine', 'Angela', 'Trisha', 'Lea', 'Aira', 'Celine']);

const MIDDLE = ['Santos', 'Reyes', 'Cruz', 'Garcia', 'Lopez'];
export function removeAcademicDemo(data) {
  const users = new Set(data.users.filter((u) => u.demo).map((u) => u.id));
  const sections = new Set(data.sections.filter((s) => s.demo).map((s) => s.id));
  const curricula = new Set(data.curricula.filter((c) => c.demo).map((c) => c.id));
  const colleges = new Set(data.colleges.filter((c) => c.demo).map((c) => c.id));
  const byStudent = (k) => (data[k] = data[k].filter((x) => !x.demo && !users.has(x.studentId)));
  for (const k of ['academicRecords', 'gradeChanges', 'documentRequests', 'issuedDocuments', 'studentProfiles', 'auditLog']) byStudent(k);
  data.gradeSheets = data.gradeSheets.filter((g) => !g.demo && !sections.has(g.sectionId));
  data.curricula = data.curricula.filter((c) => !c.demo);
  data.colleges = data.colleges.filter((c) => !c.demo);
  for (const u of data.users) if (curricula.has(u.curriculumId)) u.curriculumId = null;
  for (const p of data.programs) if (colleges.has(p.collegeId)) p.collegeId = null;
}

export function addAcademicDemo(data, { P, C, past, S, crowd, person, main, rand }) {
  const now = new Date().toISOString();
  const add = (k, rec) => {
    const r = { id: randomUUID(), demo: true, createdAt: now, ...rec };
    data[k].push(r);
    return r;
  };
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const scale = data.academicSettings.scale;
  const dean = person('dean', 'dean.demo', 'Elena Cruz', { title: 'Dean, College of Computing Studies' });
  const REG = 'Rosa Villanueva';
  const log = (action, studentId, at, by = REG) => add('auditLog', { at, by, action, studentId });

  // ----- Colleges -----
  for (const [code, name, deanName, programs] of [
    ['CCS', 'College of Computing Studies', 'Dr. Elena Cruz', ['BSIT', 'BSCS']],
    ['CBM', 'College of Business and Management', 'Dr. Liza Gonzales', ['BSBA']],
    ['CA', 'College of Agriculture', 'Dr. Ramon Villareal', ['BSA']],
    ['CTE', 'College of Teacher Education', 'Dr. Mark Torres', ['BSED']],
  ]) {
    const c = add('colleges', { code: data.colleges.some((x) => x.code === code && !x.demo) ? `${code}-DEMO` : code, name, dean: deanName });
    for (const p of programs) P[p].collegeId = c.id;
  }

  // ----- Laboratory units (for the FHE billing columns) -----
  for (const code of ['IT101', 'IT102', 'IT201', 'IT202', 'IT210', 'IT220', 'AGRI101', 'AGRI201']) C[code].labUnits = 1;

  // ----- Curricula -----
  const ids = (codes) => codes.map((c) => C[c].id);
  const curriculum = (program, series, terms, status = 'posted') => add('curricula', {
    programId: P[program].id, code: P[program].code, series, major: '', status, notes: 'Demo curriculum (a shortened prospectus).',
    terms: terms.map(([year, term, codes]) => ({ year, term, courseIds: ids(codes) })),
    postedAt: status === 'posted' ? daysAgo(400) : null, postedBy: status === 'posted' ? REG : undefined, updatedAt: daysAgo(400),
  });
  const CUR = {
    BSIT: curriculum('BSIT', '2026', [[1, '1', ['IT101', 'IT102', 'GE101', 'GE102', 'NSTP1', 'PE101']], [1, '2', ['IT201', 'IT220', 'GE103', 'GE104']], [2, '1', ['IT202', 'IT210']]]),
    BSCS: curriculum('BSCS', '2026', [[1, '1', ['IT101', 'IT102', 'GE101', 'GE102', 'NSTP1']], [1, '2', ['IT201', 'CS201', 'GE103', 'GE104']], [2, '1', ['IT202', 'IT220']]]),
    BSA: curriculum('BSA', '2026', [[1, '1', ['AGRI101', 'AGRI102', 'GE101', 'GE102', 'NSTP1', 'PE101']], [1, '2', ['AGRI201', 'GE103', 'GE104']]]),
    BSBA: curriculum('BSBA', '2026', [[1, '1', ['BA101', 'BA102', 'GE101', 'GE102', 'NSTP1', 'PE101']], [1, '2', ['BA201', 'GE103', 'GE104']]]),
  };
  curriculum('BSED', '2027', [[1, '1', ['ED101', 'ED102', 'GE101', 'GE102']], [1, '2', []], [2, '1', []]], 'draft');

  // ----- Students: curriculum, profile, requirements -----
  const students = [...Object.values(S), ...crowd];
  const programCode = (st) => Object.keys(P).find((k) => P[k].id === st.programId);
  const REQS = data.academicSettings.requirements;
  let i = 0;
  for (const st of students) {
    i++;
    const code = programCode(st);
    if (CUR[code] && i % 23 !== 0) st.curriculumId = CUR[code].id; // a few left without one, for the dashboard
    const first = st.name.split(' ')[0];
    const n = nameParts(st);
    const type = st === S.trisha ? 'transferee' : st.yearLevel === 1 ? 'new' : 'old';
    const requirements = {};
    for (const r of REQS.filter((x) => x.for.includes(type))) if (!(r.id === 'med' && i % 4 === 0) && !(r.id === 'gmc' && i % 9 === 0)) requirements[r.id] = { at: daysAgo(120 + (i % 30)), by: REG };
    add('studentProfiles', {
      studentId: st.id, studentType: type, lastName: n.last, firstName: n.first, middleName: MIDDLE[i % 5] === n.last ? MIDDLE[(i + 1) % 5] : MIDDLE[i % 5], // never the same as the last name
      sex: FEMALE.has(first) ? 'Female' : 'Male', birthDate: `${2008 - st.yearLevel}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      citizenship: 'Filipino', civilStatus: 'Single', address: ['Pili, Camarines Sur', 'Naga City', 'Iriga City', 'Sipocot, Camarines Sur', 'Pasacao, Camarines Sur'][i % 5],
      lrn: `1234${String(100000 + i * 37).slice(-6)}0`, previousSchool: type === 'transferee' ? 'Bicol University' : ['Pili National High School', 'Camarines Sur National High School', 'Naga City Science High School'][i % 3],
      education: [{ level: 'Senior high school', school: ['Pili National High School', 'Camarines Sur National High School', 'Naga City Science High School'][i % 3], year: String(2026 - st.yearLevel) }],
      requirements, updatedAt: daysAgo(100),
    });
  }

  // ----- Last term's grade sheets -----
  const sections = data.sections.filter((s) => s.demo && s.termId === past.id);
  const codeOf = (s) => Object.keys(C).find((k) => C[k].id === s.courseId);
  const STEP = { GE101: 'submitted', ED101: 'approved' }; // the rest are posted
  let incStudent = null;
  for (const s of sections) {
    const code = codeOf(s);
    const status = STEP[code] || 'posted';
    const enr = data.enrollments.filter((e) => e.sectionId === s.id && e.status === 'completed');
    const rows = enr.map((e, k) => {
      const st = data.users.find((u) => u.id === e.studentId);
      // One INC in BA101, for the INC-completion example.
      if (code === 'BA101' && k === 1) {
        incStudent = st;
        return { studentId: st.id, enrollmentId: e.id, name: st.name, studentNo: st.studentNo, percent: null, grade: null, remark: 'inc' };
      }
      const eq = equivalent(e.finalGrade, scale);
      return { studentId: st.id, enrollmentId: e.id, name: st.name, studentNo: st.studentNo, percent: e.finalGrade, grade: eq.grade, remark: eq.passed ? 'passed' : 'failed' };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const teacher = data.users.find((u) => u.id === s.teacherId)?.name || '';
    const trail = [{ at: daysAgo(78), by: teacher, action: 'Submitted' }];
    if (status !== 'submitted') trail.push({ at: daysAgo(76), by: 'Elena Cruz', action: 'Approved' });
    if (status === 'posted') trail.push({ at: daysAgo(74), by: REG, action: 'Posted' });
    const sheet = add('gradeSheets', {
      sectionId: s.id, termId: s.termId, campusId: s.campusId, rows, status, note: '', trail,
      submittedAt: daysAgo(78), submittedBy: teacher, approvedAt: status === 'submitted' ? null : daysAgo(76), approvedBy: status === 'submitted' ? '' : 'Elena Cruz',
      postedAt: status === 'posted' ? daysAgo(74) : null, postedBy: status === 'posted' ? REG : '',
    });
    if (status !== 'posted') continue;
    for (const row of rows) {
      add('academicRecords', {
        studentId: row.studentId, campusId: s.campusId, termId: s.termId, termName: past.name, courseId: s.courseId, courseCode: C[code].code, courseTitle: C[code].title,
        units: Number(C[code].units), sectionId: s.id, gradeSheetId: sheet.id, percent: row.percent, grade: row.grade, remark: row.remark, passed: row.remark === 'passed',
        source: 'grade-sheet', incDeadline: row.remark === 'inc' ? daysAgo(-290).slice(0, 10) : null, postedAt: daysAgo(74), postedBy: REG, history: [],
      });
      if (row.remark === 'inc') log(`Posted ${C[code].code}: INC`, row.studentId, daysAgo(74));
    }
  }

  // ----- Grade changes: an approved rectification (Carlo, IT102) and a waiting INC completion -----
  const carloIt102 = data.academicRecords.find((r) => r.demo && r.studentId === S.carlo.id && r.courseId === C.IT102.id);
  if (carloIt102) {
    const from = { percent: carloIt102.percent - 3, grade: equivalent(carloIt102.percent - 3, scale).grade, remark: 'passed' };
    const to = { percent: carloIt102.percent, grade: carloIt102.grade, remark: 'passed', passed: true };
    carloIt102.history.push({ at: daysAgo(60), from, to, reason: 'The final exam was encoded as 72 instead of 82.', requestedBy: REG, approvedBy: 'Elena Cruz' });
    add('gradeChanges', { recordId: carloIt102.id, studentId: S.carlo.id, courseCode: carloIt102.courseCode, termName: past.name, kind: 'rectification', from, to, reason: 'The final exam was encoded as 72 instead of 82.', status: 'approved', requestedBy: REG, requestedById: null, decidedBy: 'Elena Cruz', decidedAt: daysAgo(60), createdAt: daysAgo(62) });
    log(`Approved grade change for ${carloIt102.courseCode}`, S.carlo.id, daysAgo(60), 'Elena Cruz');
  }
  const incRec = incStudent && data.academicRecords.find((r) => r.demo && r.studentId === incStudent.id && r.remark === 'inc');
  if (incRec) {
    const reg = data.users.find((u) => u.demo && u.username.startsWith('registrar.demo'));
    add('gradeChanges', { recordId: incRec.id, studentId: incStudent.id, courseCode: incRec.courseCode, termName: past.name, kind: 'inc', from: { percent: null, grade: null, remark: 'inc' }, to: { percent: 86, grade: equivalent(86, scale).grade, remark: 'passed', passed: true }, reason: 'Submitted the missing case study on time.', status: 'pending', requestedBy: REG, requestedById: reg?.id || null, createdAt: daysAgo(3) });
    log(`Requested INC completion for ${incRec.courseCode}: Submitted the missing case study on time.`, incStudent.id, daysAgo(3));
  }

  // ----- A transferee's credited subject (Trisha: GE103 from Bicol University) -----
  add('academicRecords', {
    studentId: S.trisha.id, campusId: main.id, termId: null, termName: 'Credited', courseId: C.GE103.id, courseCode: C.GE103.code, courseTitle: C.GE103.title,
    units: Number(C.GE103.units), percent: null, grade: 1.75, remark: 'credited', passed: true, source: 'credited', school: 'Bicol University', originalCode: 'GEC 3',
    postedAt: daysAgo(150), postedBy: REG, history: [],
  });
  log('Credited GE103 from Bicol University (1.75)', S.trisha.id, daysAgo(150));

  // ----- Document requests in every status -----
  const fee = (t, copies = 1) => data.academicSettings.fees[t] * copies;
  let ref = data.documentRequests.filter((r) => r.refNo?.startsWith(`DR${new Date().getFullYear()}`)).length;
  const request = (st, type, purpose, status, extra = {}) => {
    const createdAt = daysAgo(extra.ago ?? 5);
    const steps = ['requested', 'paid', 'processing', 'ready', 'released'];
    const history = status === 'cancelled' ? [{ at: createdAt, by: st.name, status: 'requested' }, { at: daysAgo(1), by: REG, status: 'cancelled', note: extra.cancelReason }]
      : steps.slice(0, steps.indexOf(status) + 1).map((x, k) => ({ at: daysAgo((extra.ago ?? 5) - k), by: k ? REG : st.name, status: x }));
    add('documentRequests', {
      refNo: `DR${new Date().getFullYear()}-${String(++ref).padStart(5, '0')}`, studentId: st.id, campusId: main.id, type, copies: extra.copies || 1, purpose,
      fee: fee(type, extra.copies || 1), status, orNo: ['requested', 'cancelled'].includes(status) ? '' : `70${String(9000 + ref)}`, history, updatedAt: daysAgo(1), createdAt, ...extra,
    });
  };
  request(S.carlo, 'tor', 'Scholarship application', 'requested', { copies: 2, ago: 1 });
  request(S.bea, 'cog', 'Scholarship renewal', 'processing', { ago: 3 });
  request(S.paolo, 'coe', 'Student discount card', 'ready', { ago: 4 });
  request(S.jasmine, 'gmc', 'Scholarship application', 'released', { ago: 9, releasedTo: 'Jasmine Tan' });
  request(S.miguel, 'hd', 'Transfer to another school', 'cancelled', { ago: 6, cancelReason: 'Decided to stay.' });
  request(S.angela, 'cog', 'Employment (part-time)', 'paid', { ago: 2 });
  for (const st of crowd.filter((_, k) => k % 19 === 3).slice(0, 4)) request(st, ['tor', 'coe', 'cog', 'gmc'][Math.floor(rand() * 4)], 'Employment', 'requested', { ago: 1 + Math.floor(rand() * 4) });

  return { dean };
}
