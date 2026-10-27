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
    permissions: ['dashboard', 'employees.view', 'employees.edit', 'attendance.view', 'attendance.edit', 'attendance.location', 'clock.kiosk', 'payroll.view', 'payroll.config', 'leave.manage', 'leave.approve', 'assets.view', 'self'],
  },
  payroll: {
    label: 'Payroll Officer',
    description: 'Runs, adjusts and finalizes payroll; adjusts payroll setup and leave credits. Can view employees and attendance.',
    permissions: ['dashboard', 'employees.view', 'attendance.view', 'payroll.view', 'payroll.edit', 'payroll.config', 'leave.manage', 'self'],
  },
  it: {
    label: 'IT Asset Manager',
    description: 'Manages IT assets and consumable inventory: registers, assigns, returns and retires equipment; receives and issues stock; handles equipment problem reports and IT Service Desk tickets.',
    permissions: ['assets.view', 'assets.edit', 'helpdesk.agent', 'self'],
  },
  support: {
    label: 'Helpdesk Agent',
    description: 'Works IT Service Desk tickets: replies, internal notes, assignment and status. Can view IT assets to see what a user has.',
    permissions: ['helpdesk.agent', 'assets.view', 'self'],
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
  ['attendance.location', 'Clock-in locations (geotagging) and the office location'],
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
  ['helpdesk.agent', 'Service desk: work all tickets (reply, notes, assign, status)'],
  ['helpdesk.manage', 'Service desk settings: receiving email address and mailbox, outgoing mail, categories, SLA, saved replies'],
  ['feedback.view', 'Read feedback sent by users'],
  ['feedback.manage', 'Reply to feedback, change its status or delete it'],
  ['self', 'Own attendance, payslips, profile, requests and assigned equipment; report equipment problems'],
];

export function can(role, permission) {
  const perms = ROLES[role]?.permissions || [];
  return perms.includes('*') || perms.includes(permission);
}

// Permissions an administrator can grant or remove per account, on top of the account type.
// user.helpdeskAgent: true (granted), false (removed) or absent (follow the account type).
// Administrators always keep everything.
export const PER_USER = { 'helpdesk.agent': 'helpdeskAgent' };
export function userCan(user, permission) {
  if (!user) return false;
  const field = PER_USER[permission];
  if (field && user.role !== 'admin' && typeof user[field] === 'boolean') return user[field];
  return can(user.role, permission);
}
