// Learning-portal modules that an administrator turns on or off, separately for
// students and for teachers (Admin panel → Modules). The server refuses calls to a
// module that is off for the caller's account type; the portal hides it.

export const MODULES = [
  {
    id: 'enrollment',
    label: 'Enrollment',
    student: 'Browse open sections, enroll (or join a waitlist), see request status and drop classes.',
    teacher: 'See the class list and waitlist of each section they teach.',
  },
  {
    id: 'schedule',
    label: 'Class schedule',
    student: 'A weekly timetable of their classes.',
    teacher: 'A weekly timetable of the sections they teach.',
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
  },
  {
    id: 'attendance',
    label: 'Attendance',
    student: 'See their own attendance in each class.',
    teacher: 'Take attendance (present, late, absent, excused) and export it.',
  },
  {
    id: 'grades',
    label: 'Grades',
    student: 'See assignment scores and final grades.',
    teacher: 'Use the gradebook and post final grades.',
  },
  {
    id: 'news',
    label: 'News & events',
    student: 'Read school news (react and comment) and see upcoming events.',
    teacher: 'Read school news (react and comment) and see upcoming events.',
  },
];

export const MODULE_IDS = MODULES.map((m) => m.id);

export function defaultModuleConfig() {
  return Object.fromEntries(MODULES.map((m) => [m.id, { student: true, teacher: true }]));
}

// config: settings saved by the admin (may miss modules added in later builds → on).
export function moduleOn(config, moduleId, role) {
  if (!MODULE_IDS.includes(moduleId)) return false;
  if (role !== 'student' && role !== 'teacher') return false;
  const v = config?.[moduleId]?.[role];
  return v === undefined ? true : Boolean(v);
}

export function enabledModules(config, role) {
  return MODULE_IDS.filter((id) => moduleOn(config, id, role));
}
