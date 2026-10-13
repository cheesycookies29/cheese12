// Account types and what each one may do. Shared by the server (enforcement)
// and the browser (hiding screens and buttons the user cannot use).

export const ROLES = {
  admin: {
    label: 'Administrator',
    description: 'Full access, including user accounts, company settings and data backup.',
    permissions: ['*'],
  },
  hr: {
    label: 'HR Manager',
    description: 'Manages employees, attendance, leave and the time clock; approves leave and remote work; adjusts payroll setup. Can view payroll.',
    permissions: ['dashboard', 'employees.view', 'employees.edit', 'attendance.view', 'attendance.edit', 'clock.kiosk', 'payroll.view', 'payroll.config', 'leave.manage', 'leave.approve', 'self'],
  },
  payroll: {
    label: 'Payroll Officer',
    description: 'Runs, adjusts and finalizes payroll; adjusts payroll setup and leave credits. Can view employees and attendance.',
    permissions: ['dashboard', 'employees.view', 'attendance.view', 'payroll.view', 'payroll.edit', 'payroll.config', 'leave.manage', 'self'],
  },
  employee: {
    label: 'Employee',
    description: 'Self-service only: clock in and out, file leave and remote-work requests, see own attendance, payslips and profile.',
    permissions: ['self'],
  },
};

// Rows for the access matrix shown on the Users page.
export const PERMISSION_LABELS = [
  ['dashboard', 'Company dashboard'],
  ['employees.view', 'View employee records'],
  ['employees.edit', 'Add and edit employees'],
  ['attendance.view', 'View attendance (DTR)'],
  ['attendance.edit', 'Edit attendance and approve overtime'],
  ['clock.kiosk', 'Shared time clock'],
  ['payroll.view', 'View payroll runs and payslips'],
  ['payroll.edit', 'Create, adjust and finalize payroll'],
  ['payroll.config', 'Payroll setup: pay rules, government rates, tax tables'],
  ['leave.manage', 'Leave types, credits and balances; view all requests'],
  ['leave.approve', 'Approve or reject leave and remote-work requests'],
  ['settings.edit', 'Company details and default schedule'],
  ['data.manage', 'Backup, restore and erase data'],
  ['users.manage', 'Manage user accounts'],
  ['self', 'Own attendance, payslips, profile and requests'],
];

export function can(role, permission) {
  const perms = ROLES[role]?.permissions || [];
  return perms.includes('*') || perms.includes(permission);
}
