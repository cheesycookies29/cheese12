// Account types. Shared by the server (enforcement) and the browser (hiding screens).
//
// Everyone signs in once on the University Portal (/). Each account type has a "side",
// which decides the session it gets:
//  - admin:  the LMS admin panel (/admin): Administrators and Registrars,
//  - portal: the learning portal (/lms/): Teachers, Students, and Parents & guardians
//            (who see only the students linked to them, as far as each link allows),
//  - hris:   HR and staff accounts, who only use the HRIS (/hris/).
// ATLAS Academic (/academic/) accepts administrators, registrars and deans (admin-panel session) and
// teachers and students (portal session); the academic.* and grades.approve permissions open its screens.
// The HRIS accepts any employee's session (a teacher or registrar linked to an employee
// record uses its self-service); the hris.* / employees.* / payroll.* permissions below
// open its HR screens.

export const ROLES = {
  admin: {
    label: 'Administrator',
    side: 'admin',
    description: 'Everything in the admin panel: modules for students and teachers, settings, staff accounts, data.',
    permissions: ['*'],
  },
  registrar: {
    label: 'Registrar',
    side: 'admin',
    description: 'Runs enrollment at their campuses: applicants, student records, the course catalog, terms, sections and enrollment requests.',
    permissions: ['dashboard', 'enrollment.manage', 'students.manage', 'guardians.manage', 'catalog.manage', 'teachers.view', 'news.manage', 'academic.view', 'academic.records', 'academic.curricula', 'academic.settings'],
  },
  dean: {
    label: 'Dean / Program chair',
    side: 'admin',
    description: 'Leads a college at their campuses in ATLAS Academic: curricula, student records and evaluations, and approving grade sheets and grade changes.',
    permissions: ['academic.view', 'academic.curricula', 'grades.approve', 'teachers.view'],
  },
  teacher: {
    label: 'Teacher',
    side: 'portal',
    description: 'Teaches sections: class lists, lessons, announcements, assignments and grades (as switched on under Modules).',
    permissions: [],
  },
  student: {
    label: 'Student',
    side: 'portal',
    description: 'Enrolls in sections and takes classes (as switched on under Modules).',
    permissions: [],
  },
  guardian: {
    label: 'Parent / Guardian',
    side: 'portal',
    description: 'Follows the students linked to them: enrollment, schedule, grades, attendance and activities, as far as each link and the Modules allow. Read-only.',
    permissions: [],
  },
  hr: {
    label: 'HR Manager',
    side: 'hris',
    description: 'Runs HR at their campuses: employee records and sign-in accounts, attendance, clock-in locations and the time clock, leave approvals and credits; adjusts payroll setup.',
    permissions: ['hris.dashboard', 'employees.view', 'employees.edit', 'hris.accounts', 'attendance.view', 'attendance.edit', 'attendance.location', 'clock.kiosk', 'leave.manage', 'leave.approve', 'leave.adjust', 'payroll.view', 'payroll.config', 'hris.settings'],
  },
  payroll: {
    label: 'Payroll Officer',
    side: 'hris',
    description: 'Prepares payroll at their campuses: payroll runs, payslips and payroll setup; views employees, attendance and leave.',
    permissions: ['hris.dashboard', 'employees.view', 'attendance.view', 'leave.manage', 'payroll.view', 'payroll.edit', 'payroll.config'],
  },
  accountant: {
    label: 'Chief Accountant',
    side: 'hris',
    description: 'Keeps the books in ATLAS Finance: journal entries, certifying vouchers (Box C), liquidations, bank reconciliation, statements, closing, and the Control panel.',
    permissions: ['finance.view', 'finance.cardfile', 'finance.accounts', 'finance.settings'],
  },
  budget: {
    label: 'Budget Officer',
    side: 'hris',
    description: 'Runs the budget in ATLAS Finance: appropriations, allotments, NCAs, and obligating requests (ORS/BURS Box B).',
    permissions: ['finance.view', 'finance.cardfile', 'finance.budget'],
  },
  cashier: {
    label: 'Cashier',
    side: 'hris',
    description: 'Disbursing and collecting officer in ATLAS Finance: vouchers, checks and LDDAP-ADA, cash advances, tax remittances, official receipts, collections and deposits.',
    permissions: ['finance.view', 'finance.cardfile', 'finance.disburse', 'finance.collect'],
  },
  supply: {
    label: 'Supply & Property Officer',
    side: 'hris',
    description: 'Procurement, inventory and property in ATLAS Finance: purchase requests and orders, deliveries, stock, requisitions, PAR/ICS, depreciation and disposal.',
    permissions: ['finance.view', 'finance.cardfile', 'finance.procure', 'finance.inventory', 'finance.property'],
  },
  approver: {
    label: 'Approving Officer',
    side: 'hris',
    description: 'The head of agency or authorized representative in ATLAS Finance: approves purchase requests, purchase orders and vouchers (Box D).',
    permissions: ['finance.view', 'finance.approve'],
  },
  staff: {
    label: 'Staff',
    side: 'hris',
    description: 'A non-teaching employee: self-service (time clock, attendance, leave requests, payslips, profile).',
    permissions: [],
  },
};

export const ADMIN_ROLES = Object.keys(ROLES).filter((r) => ROLES[r].side === 'admin');
export const PORTAL_ROLES = Object.keys(ROLES).filter((r) => ROLES[r].side === 'portal');
export const HRIS_ROLES = Object.keys(ROLES).filter((r) => ROLES[r].side === 'hris');

export const PERMISSION_LABELS = [
  ['dashboard', 'Admin dashboard'],
  ['enrollment.manage', 'Approve, reject, add and drop enrollments'],
  ['students.manage', 'Student accounts and applicants'],
  ['guardians.manage', 'Parent and guardian accounts, and what each may see'],
  ['teachers.view', 'View teacher accounts'],
  ['teachers.manage', 'Add and edit teacher accounts'],
  ['catalog.manage', 'Programs, courses, terms and sections'],
  ['campuses.manage', 'Add, rename and remove campuses'],
  ['modules.config', 'Turn modules on or off for students and teachers'],
  ['news.manage', 'Post school news and events; remove comments'],
  ['settings.edit', 'School details, branding, enrollment rules, activity types and grade weights'],
  ['admins.manage', 'Administrator and registrar accounts'],
  ['data.manage', 'Demo data and backups'],
];

export const HRIS_PERMISSION_LABELS = [
  ['hris.dashboard', 'HR dashboard'],
  ['employees.view', 'View employee records'],
  ['employees.edit', 'Add and edit employee records'],
  ['hris.accounts', 'Sign-in accounts for employees (HR, payroll and staff)'],
  ['attendance.view', 'View attendance (DTR)'],
  ['attendance.edit', 'Correct attendance and approve overtime'],
  ['attendance.location', 'See clock-in locations; set the campus location'],
  ['clock.kiosk', 'Open the shared time clock'],
  ['leave.manage', 'View leave requests and balances; leave types'],
  ['leave.approve', 'Approve, reject and cancel requests'],
  ['leave.adjust', 'Change one employee’s leave credits, access and days'],
  ['payroll.view', 'View payroll runs and payslips'],
  ['payroll.edit', 'Create, adjust and finalize payroll runs'],
  ['payroll.config', 'Payroll setup: pay rules, contributions, tax tables'],
  ['hris.settings', 'Employer details and the default work schedule'],
];

export { FINANCE_PERMISSION_LABELS } from './finance.js';

export function can(role, permission) {
  const perms = ROLES[role]?.permissions || [];
  return perms.includes('*') || perms.includes(permission) || (permission === 'teachers.view' && perms.includes('teachers.manage'));
}

export const roleLabel = (role) => ROLES[role]?.label || role;
