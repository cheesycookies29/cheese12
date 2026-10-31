// Account types. Shared by the server (enforcement) and the browser (hiding screens).
//
// Two separate sign-ins:
//  - the admin panel (/admin) for Administrators and Registrars,
//  - the learning portal (/) for Teachers and Students.
// An account can only sign in to the side its type belongs to.

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
    description: 'Runs enrollment: applicants, student records, the course catalog, terms, sections and enrollment requests.',
    permissions: ['dashboard', 'enrollment.manage', 'students.manage', 'catalog.manage', 'teachers.view'],
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
};

export const ADMIN_ROLES = Object.keys(ROLES).filter((r) => ROLES[r].side === 'admin');
export const PORTAL_ROLES = Object.keys(ROLES).filter((r) => ROLES[r].side === 'portal');

export const PERMISSION_LABELS = [
  ['dashboard', 'Admin dashboard'],
  ['enrollment.manage', 'Approve, reject, add and drop enrollments'],
  ['students.manage', 'Student accounts and applicants'],
  ['teachers.view', 'View teacher accounts'],
  ['teachers.manage', 'Add and edit teacher accounts'],
  ['catalog.manage', 'Programs, courses, terms and sections'],
  ['modules.config', 'Turn modules on or off for students and teachers'],
  ['settings.edit', 'School details and enrollment rules'],
  ['admins.manage', 'Administrator and registrar accounts'],
  ['data.manage', 'Demo data and backups'],
];

export function can(role, permission) {
  const perms = ROLES[role]?.permissions || [];
  return perms.includes('*') || perms.includes(permission) || (permission === 'teachers.view' && perms.includes('teachers.manage'));
}

export const roleLabel = (role) => ROLES[role]?.label || role;
