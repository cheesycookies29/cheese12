// Tiny JSON-file database: all data lives in data/db.json next to the app.
// Every collection is a plain array of records with an `id`, so moving to a real
// database later (e.g. Amazon RDS for PostgreSQL) is one table per collection.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultModuleConfig } from '../shared/modules.js';
import { defaultSystemSettings } from '../shared/systems.js';
import { DEFAULT_SETTINGS as HR_DEFAULTS } from '../shared/calc.js';
import { DEFAULT_LEAVE_TYPES } from '../shared/leave.js';
import { mergeHrSettings } from './hris.js';
import { migrateLeaveTypes } from './hris-leave.js';
import { mergeAcademicSettings } from './academic.js';
import { mergeSso } from './sso.js';

export const DEFAULT_SETTINGS = {
  schoolName: 'Lancaster Academy',
  currentTermId: null,
  passingGrade: 75, // final grades are percentages; at or above this passes
  enrollment: {
    requireApproval: true, // student requests wait for the registrar
    allowWaitlist: true, // full sections take a waitlist instead of refusing
    waitlistLimit: 10, // per section; 0 = no limit
    maxUnits: 24, // per student per term (enrolled + pending + waitlisted)
  },
  registration: {
    open: false, // the portal shows "Apply as a student"; applicants wait for approval
  },
  branding: {
    theme: 'maroon', // a preset from shared/themes.js, or 'custom'
    color: '', // the brand colour when theme is 'custom' (#rrggbb)
    logo: '', // a small image as a data: URL; empty = the ATLAS mark
    tagline: '',
  },
  systems: defaultSystemSettings(), // other systems on the ATLAS home page: { status: soon | live | hidden, url }
  sso: mergeSso(), // single sign-on with Keycloak (server/sso.js); the client secret is in OIDC_CLIENT_SECRET, never here
};

// Activity types and their share of the running grade (weights are percentages;
// all 0 = every point counts the same).
export const DEFAULT_ACTIVITY_TYPES = [
  { id: 'task', name: 'Assignment', weight: 30, active: true },
  { id: 'short-quiz', name: 'Short Quiz', weight: 20, active: true },
  { id: 'long-quiz', name: 'Long Quiz', weight: 20, active: true },
  { id: 'exam', name: 'Examination', weight: 30, active: true },
];

export function emptyData() {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    modules: defaultModuleConfig(), // which portal modules students and teachers get
    campuses: [], // the school's sites; each has its own people, sections, news and events (server/campus.js)
    users: [], // admins, registrars, teachers, students (and student applicants)
    programs: [], // e.g. BS Information Technology
    terms: [], // e.g. 1st Semester 2026–2027, with an enrollment window
    courses: [], // the catalog: code, title, units, prerequisites
    sections: [], // a course offered in a term: teacher, meetings, capacity
    enrollments: [], // a student in a section: pending / enrolled / waitlisted / dropped / rejected / completed
    lessons: [],
    announcements: [],
    assignments: [], // tasks (hand in work) and quizzes (questions, auto-graded)
    submissions: [], // work handed in for tasks
    attempts: [], // quiz attempts
    activityTypes: structuredClone(DEFAULT_ACTIVITY_TYPES),
    attendance: [], // one record per section per date: { records: { studentId: present|late|absent|excused } }
    files: [], // uploaded files' details; the bytes are in data/files/<id>
    resources: [], // class resources: a file or a link
    news: [], // school news posts, with reactions and comments
    events: [], // school events
    counters: { studentNo: {} }, // last student number issued per year
    guardianLinks: [], // a parent or guardian account linked to a student, with what it may see (server/guardian.js)
    // ----- HRIS (server/hris.js) -----
    hrSettings: structuredClone(HR_DEFAULTS), // pay rules, contributions, tax tables, default schedule
    employees: [], // employee records, each at a campus; an account links to one with user.employeeId
    timeEntries: [], // the DTR: one record per employee per date (work, remote or leave)
    payrollRuns: [], // per campus and pay period, with computed payslips
    leaveTypes: structuredClone(DEFAULT_LEAVE_TYPES),
    leaveCredits: [], // per-employee credits for a year, replacing the leave type's default
    leaveAccess: [], // a leave type given to, or taken from, one employee
    leaveAdjustments: [], // days added or taken away, with a reason
    requests: [], // leave and remote-work requests
    // ----- Academic (server/academic.js) -----
    academicSettings: mergeAcademicSettings(), // grading scale, requirements, document fees, signatories
    colleges: [], // colleges/departments; a program belongs to one (program.collegeId)
    curricula: [], // a program's prospectus for a series: year levels → terms → courses; draft, posted or retired
    studentProfiles: [], // personal details, student type, educational background, requirements received
    gradeSheets: [], // one per section: submitted → approved → posted (or returned), with the grades
    academicRecords: [], // the permanent record: one subject result per student and term (or credited)
    gradeChanges: [], // rectifications and INC completions, approved by someone other than the requester
    documentRequests: [], // TOR, certificates…: requested → paid → processing → ready → released
    issuedDocuments: [], // printed documents with a verification code and what they said
    auditLog: [], // who changed what in Academic
  };
}

export function mergeSettings(s = {}) {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...s,
    enrollment: { ...DEFAULT_SETTINGS.enrollment, ...(s.enrollment || {}) },
    registration: { ...DEFAULT_SETTINGS.registration, ...(s.registration || {}) },
    branding: { ...DEFAULT_SETTINGS.branding, ...(s.branding || {}) },
    systems: Object.fromEntries(Object.entries(defaultSystemSettings()).map(([id, v]) => [id, { ...v, ...(s.systems?.[id] || {}) }])),
    sso: mergeSso(s.sso),
  };
}

function normalize(data) {
  const base = emptyData();
  const out = { ...base, ...data };
  for (const k of Object.keys(base)) if (Array.isArray(base[k]) && !Array.isArray(out[k])) out[k] = [];
  out.settings = mergeSettings(data.settings);
  out.modules = { ...defaultModuleConfig(), ...(data.modules || {}) };
  out.counters = { studentNo: {}, ...(data.counters || {}) };
  if (!Array.isArray(data.activityTypes)) out.activityTypes = structuredClone(DEFAULT_ACTIVITY_TYPES);
  out.hrSettings = mergeHrSettings(data.hrSettings);
  out.academicSettings = mergeAcademicSettings(data.academicSettings);
  if (!Array.isArray(data.leaveTypes)) out.leaveTypes = structuredClone(DEFAULT_LEAVE_TYPES);
  migrateLeaveTypes(out);
  ensureCampuses(out);
  // Assignments from before quizzes and activity types: tasks of the default type.
  for (const a of out.assignments) {
    a.kind ||= 'task';
    if (!a.typeId) a.typeId = (out.activityTypes.find((t) => t.id === (a.kind === 'quiz' ? 'short-quiz' : 'task')) || out.activityTypes[0])?.id || '';
  }
  return out;
}

// Every school has at least one campus. Data from before campuses (or a new, empty
// school) gets a "Main Campus", and records without a campus are placed in it.
export function ensureCampuses(data) {
  if (!data.campuses.length) data.campuses.push({ id: randomUUID(), name: 'Main Campus', code: 'MAIN', address: '', createdAt: new Date().toISOString() });
  const first = data.campuses[0].id;
  for (const s of data.sections) s.campusId ||= first;
  for (const k of ['employees', 'payrollRuns']) for (const x of data[k] || []) x.campusId ||= first;
  for (const u of data.users) if (u.role !== 'admin' && !(u.campusIds?.length)) u.campusIds = [first];
  for (const k of ['news', 'events']) for (const x of data[k]) if (x.campusId === undefined) x.campusId = null; // null: every campus
  return data;
}

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = normalize(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : emptyData());

  const db = {
    dir: path.dirname(file),
    get data() {
      return data;
    },
    replace(next) {
      data = normalize(next);
      db.save();
    },
    save() {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    },
  };
  if (!fs.existsSync(file)) db.save();
  return db;
}

// In-memory database for tests.
export function memoryDb(initial = emptyData()) {
  let data = normalize(initial);
  return {
    dir: null,
    get data() {
      return data;
    },
    replace(next) {
      data = normalize(next);
    },
    save() {},
  };
}
