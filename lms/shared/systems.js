// The school's systems, shown as tiles on the University Portal (/).
// The HRIS and LMS are built in; the others are switched live by an administrator
// (Admin panel → Portal & systems) once they exist, with the address they run at.
// audience: account types that see the tile (students do not see HRIS, for example).

export const SYSTEMS = [
  {
    id: 'hris',
    name: 'HRIS',
    title: 'Human Resource Information System',
    description: 'Employee records, time clock and attendance, leave requests and credits, payroll and payslips.',
    icon: 'users',
    audience: ['teacher', 'registrar', 'admin', 'hr', 'payroll', 'staff'],
    builtIn: true,
    path: '/hris/',
  },
  {
    id: 'fmis',
    name: 'FMIS',
    title: 'Financial Management Information System',
    description: 'Budget, assessments and collections, disbursements, accounting and financial reports.',
    icon: 'wallet',
    audience: ['student', 'teacher', 'registrar', 'admin', 'hr', 'payroll', 'staff'],
  },
  {
    id: 'uis',
    name: 'UIS',
    title: 'University Information System',
    description: 'Admissions, student records, registration, grades and registrar services.',
    icon: 'cap',
    audience: ['student', 'teacher', 'registrar', 'admin', 'hr', 'payroll', 'staff'],
  },
  {
    id: 'lms',
    name: 'LMS',
    title: 'Learning Management System',
    description: 'Classes, lessons and resources, quizzes and exams, attendance, grades and enrollment.',
    icon: 'book',
    audience: ['student', 'teacher', 'registrar', 'admin'],
    builtIn: true,
    path: '/lms/', // administrators and registrars open the LMS admin panel (/admin) instead
  },
];

export const SYSTEM_STATUS = ['soon', 'live', 'hidden'];

export function defaultSystemSettings() {
  return Object.fromEntries(SYSTEMS.filter((s) => !s.builtIn).map((s) => [s.id, { status: 'soon', url: '' }]));
}
