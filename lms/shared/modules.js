// Learning-portal modules that an administrator turns on or off, separately for
// students, teachers and parents & guardians (Admin panel → Modules). The server
// refuses calls to a module that is off for the caller's account type; the portal
// hides it. Modules without a `guardian` description are not offered to guardians.

export const MODULES = [
  {
    id: 'enrollment',
    label: 'Enrollment',
    student: 'Browse open sections, enroll (or join a waitlist), see request status and drop classes.',
    teacher: 'See the class list and waitlist of each section they teach.',
    guardian: 'See their student’s enrollment requests, enrolled classes and units.',
  },
  {
    id: 'schedule',
    label: 'Class schedule',
    student: 'A weekly timetable of their classes.',
    teacher: 'A weekly timetable of the sections they teach.',
    guardian: 'See their student’s weekly timetable.',
  },
  {
    id: 'lessons',
    label: 'Lessons & materials',
    student: 'Read published lessons and open shared materials.',
    teacher: 'Write lessons, share links and choose what students can see.',
  },
  {
    id: 'announcements',
    label: 'Announcements',
    student: 'Read announcements posted to their classes.',
    teacher: 'Post announcements to a class.',
  },
  {
    id: 'resources',
    label: 'Resources',
    student: 'Open and download files and links shared in their classes.',
    teacher: 'Upload files (PDF, slides, video, images…) and share links with a class.',
  },
  {
    id: 'assignments',
    label: 'Activities & quizzes',
    student: 'Hand in work, take quizzes and exams (with time limits), and read scores and feedback.',
    teacher: 'Create tasks, quizzes and exams, score work and essays, and see how each question went.',
    guardian: 'See what is due, what was handed in, missing work and scores.',
  },
  {
    id: 'attendance',
    label: 'Attendance',
    student: 'See their own attendance in each class.',
    teacher: 'Take attendance (present, late, absent, excused) and export it.',
    guardian: 'See their student’s attendance in each class.',
  },
  {
    id: 'grades',
    label: 'Grades',
    student: 'See assignment scores and final grades.',
    teacher: 'Use the gradebook and post final grades.',
    guardian: 'See running grades and final grades.',
  },
  {
    id: 'calendar',
    label: 'School calendar',
    student: 'A month, week and list calendar of their classes, due dates, exams, holidays, school events and term dates; subscribe from a phone.',
    teacher: 'The same calendar for the sections they teach: class meetings, due dates, exams, holidays and school events.',
    guardian: 'The calendar of each linked student (classes and due dates as far as each link allows), with holidays and school events.',
  },
  {
    id: 'news',
    label: 'News & events',
    student: 'Read school news (react and comment) and see upcoming events.',
    teacher: 'Read school news (react and comment) and see upcoming events.',
    guardian: 'Read school news (react and comment) and see upcoming events.',
  },
];
export const MODULE_ROLES = ['student', 'teacher', 'guardian'];

export const MODULE_IDS = MODULES.map((m) => m.id);

export function defaultModuleConfig() {
  return Object.fromEntries(MODULES.map((m) => [m.id, { student: true, teacher: true, ...(m.guardian ? { guardian: true } : {}) }]));
}
export const offeredTo = (m, role) => role !== 'guardian' || Boolean(m.guardian);

// config: settings saved by the admin (may miss modules added in later builds → on).
export function moduleOn(config, moduleId, role) {
  if (!MODULE_IDS.includes(moduleId)) return false;
  if (!MODULE_ROLES.includes(role)) return false;
  if (role === 'guardian' && !MODULES.find((m) => m.id === moduleId).guardian) return false;
  const v = config?.[moduleId]?.[role];
  return v === undefined ? true : Boolean(v);
}

export function enabledModules(config, role) {
  return MODULE_IDS.filter((id) => moduleOn(config, id, role));
}
