// Parents and guardians: what a linked guardian may see about a student.
// Each link between a guardian and a student has its own set of these, chosen by the
// registrar (for example a student's grades but not their enrollment requests). A view
// also needs its LMS module switched on for guardians (Admin panel → Modules).

export const GUARDIAN_VIEWS = [
  { id: 'enrollment', module: 'enrollment', label: 'Enrollment', description: 'Enrollment requests and their status, enrolled classes and units, the waitlist.' },
  { id: 'schedule', module: 'schedule', label: 'Class schedule', description: 'The weekly timetable of the student’s classes.' },
  { id: 'grades', module: 'grades', label: 'Grades', description: 'The running grade in each class, final grades and past terms.' },
  { id: 'attendance', module: 'attendance', label: 'Attendance', description: 'Attendance rate per class, and each late, absent or excused day.' },
  { id: 'activities', module: 'assignments', label: 'Activities & quizzes', description: 'What is due, what was handed in (and when), missing work and scores.' },
];
export const GUARDIAN_VIEW_IDS = GUARDIAN_VIEWS.map((v) => v.id);

export const RELATIONSHIPS = ['Mother', 'Father', 'Guardian', 'Grandparent', 'Sibling', 'Aunt / Uncle', 'Sponsor', 'Other'];

// Every view on, for a new link.
export const allViews = () => Object.fromEntries(GUARDIAN_VIEW_IDS.map((id) => [id, true]));

export function cleanViews(input = {}) {
  return Object.fromEntries(GUARDIAN_VIEW_IDS.map((id) => [id, Boolean(input[id]) && input[id] !== 'false']));
}
