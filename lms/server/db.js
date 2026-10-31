// Tiny JSON-file database: all data lives in data/db.json next to the app.
// Every collection is a plain array of records with an `id`, so moving to a real
// database later (e.g. Amazon RDS for PostgreSQL) is one table per collection.
import fs from 'node:fs';
import path from 'node:path';
import { defaultModuleConfig } from '../shared/modules.js';

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
};

export function emptyData() {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    modules: defaultModuleConfig(), // which portal modules students and teachers get
    users: [], // admins, registrars, teachers, students (and student applicants)
    programs: [], // e.g. BS Information Technology
    terms: [], // e.g. 1st Semester 2026–2027, with an enrollment window
    courses: [], // the catalog: code, title, units, prerequisites
    sections: [], // a course offered in a term: teacher, meetings, capacity
    enrollments: [], // a student in a section: pending / enrolled / waitlisted / dropped / rejected / completed
    lessons: [],
    announcements: [],
    assignments: [],
    submissions: [],
    counters: { studentNo: {} }, // last student number issued per year
  };
}

export function mergeSettings(s = {}) {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...s,
    enrollment: { ...DEFAULT_SETTINGS.enrollment, ...(s.enrollment || {}) },
    registration: { ...DEFAULT_SETTINGS.registration, ...(s.registration || {}) },
  };
}

function normalize(data) {
  const base = emptyData();
  const out = { ...base, ...data };
  for (const k of Object.keys(base)) if (Array.isArray(base[k]) && !Array.isArray(out[k])) out[k] = [];
  out.settings = mergeSettings(data.settings);
  out.modules = { ...defaultModuleConfig(), ...(data.modules || {}) };
  out.counters = { studentNo: {}, ...(data.counters || {}) };
  return out;
}

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = fs.existsSync(file) ? normalize(JSON.parse(fs.readFileSync(file, 'utf8'))) : emptyData();

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
