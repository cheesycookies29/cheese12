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
    description: 'Manages employees, attendance, leave and the time clock; approves leave and remote work; adjusts payroll setup. Can view payroll and IT assets.',
    permissions: ['dashboard', 'employees.view', 'employees.edit', 'attendance.view', 'attendance.edit', 'clock.kiosk', 'payroll.view', 'payroll.config', 'leave.manage', 'leave.approve', 'assets.view', 'self'],
  },
  payroll: {
    label: 'Payroll Officer',
    description: 'Runs, adjusts and finalizes payroll; adjusts payroll setup and leave credits. Can view employees and attendance.',
    permissions: ['dashboard', 'employees.view', 'attendance.view', 'payroll.view', 'payroll.edit', 'payroll.config', 'leave.manage', 'self'],
  },
  it: {
    label: 'IT Asset Manager',
    description: 'Manages IT assets and consumable inventory: registers, assigns, returns and retires equipment; receives and issues stock; handles equipment problem reports from employees.',
    permissions: ['assets.view', 'assets.edit', 'self'],
  },
  employee: {
    label: 'Employee',
    description: 'Self-service only: clock in and out, file leave and remote-work requests, see own attendance, payslips, profile and assigned IT equipment; report malfunctioning or damaged equipment.',
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
  ['leave.adjust', "Change one employee's leave: types offered, credits, adjustments, recorded days"],
  ['assets.view', 'View IT assets, inventory, allocations and problem reports'],
  ['assets.edit', 'Register, assign and return assets; receive and issue stock; respond to problem reports'],
  ['settings.edit', 'Company details and default schedule'],
  ['data.manage', 'Backup, restore and erase data'],
  ['users.manage', 'Manage user accounts'],
  ['devlog.view', 'Dev log: release notes and installed version'],
  ['devlog.edit', 'Write and edit dev log entries'],
  ['self', 'Own attendance, payslips, profile, requests and assigned equipment; report equipment problems'],
];

export function can(role, permission) {
  const perms = ROLES[role]?.permissions || [];
  return perms.includes('*') || perms.includes(permission);
}
