// The systems of Lancaster ATLAS, shown as tiles on the ATLAS home page (/).
// ATLAS Learn (the LMS) and ATLAS People (the HRIS) are built in; the others are switched
// live by an administrator (Admin panel → Home page & systems) once they exist, with the
// address they run at. Ids stay as they were (hris, lms…) so saved settings keep working.
// audience: account types that see the tile (students do not see HRIS, for example).

export const SYSTEMS = [
  {
    id: 'uis',
    product: 'Academic',
    short: 'UIS',
    title: 'Academic records',
    description: 'Admissions, student records, registration, grades and registrar services.',
    icon: 'cap',
    audience: ['student', 'teacher', 'registrar', 'dean', 'admin'],
    builtIn: true,
    path: '/academic/',
  },
  {
    id: 'lms',
    product: 'Learn',
    short: 'LMS',
    title: 'Learning management',
    description: 'Classes, lessons and resources, quizzes and exams, attendance, grades and enrollment.',
    icon: 'laptop',
    audience: ['student', 'guardian', 'teacher', 'registrar', 'admin'],
    builtIn: true,
    path: '/lms/', // administrators and registrars open its admin panel (/admin) instead
  },
  {
    id: 'hris',
    product: 'People',
    short: 'HRIS',
    title: 'Human resources',
    description: 'Employee records, time clock and attendance, leave requests and credits, payroll and payslips.',
    icon: 'users',
    audience: ['teacher', 'registrar', 'dean', 'admin', 'hr', 'payroll', 'staff', 'accountant', 'budget', 'cashier', 'supply', 'approver'],
    builtIn: true,
    path: '/hris/',
  },
  {
    id: 'fmis',
    product: 'Finance',
    short: 'FMIS',
    title: 'Financial management',
    description: 'Government accounting: budget, procurement, inventory and property, disbursements, collections and financial reports.',
    icon: 'coins',
    audience: ['student', 'teacher', 'registrar', 'dean', 'admin', 'hr', 'payroll', 'staff', 'accountant', 'budget', 'cashier', 'supply', 'approver'],
    builtIn: true,
    path: '/finance/',
  },
  {
    id: 'facilities',
    product: 'Facilities',
    short: '',
    title: 'Facilities and property',
    description: 'Rooms and venues, bookings, maintenance requests, and the school’s property and equipment.',
    icon: 'building',
    audience: ['teacher', 'registrar', 'admin', 'hr', 'payroll', 'staff', 'accountant', 'budget', 'cashier', 'supply', 'approver'],
  },
].map((s) => ({ ...s, name: `ATLAS ${s.product}` }));

export const SYSTEM_STATUS = ['soon', 'live', 'hidden'];

export function defaultSystemSettings() {
  return Object.fromEntries(SYSTEMS.filter((s) => !s.builtIn).map((s) => [s.id, { status: 'soon', url: '' }]));
}
