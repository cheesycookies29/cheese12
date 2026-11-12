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
    description: 'Manages employees, attendance, leave and the time clock; approves leave and remote work; adjusts payroll setup and the holiday calendar. Can view payroll and IT assets.',
    permissions: ['dashboard', 'employees.view', 'employees.edit', 'employees.sensitive', 'attendance.view', 'attendance.edit', 'attendance.location', 'clock.kiosk', 'payroll.view', 'payroll.config', 'holidays.manage', 'leave.manage', 'leave.approve', 'assets.view', 'self'],
  },
  hrstaff: {
    label: 'HR Staff',
    description: 'Day-to-day HR: views employee records without pay, government IDs or bank details; manages attendance, the shared time clock, the holiday calendar and leave records. Cannot see payroll or approve requests (unless a supervisor).',
    permissions: ['employees.view', 'attendance.view', 'attendance.edit', 'clock.kiosk', 'holidays.manage', 'leave.manage', 'self'],
  },
  payroll: {
    label: 'Payroll Officer',
    description: 'Runs, adjusts and finalizes payroll; adjusts payroll setup, the holiday calendar and leave credits. Can view employees and attendance.',
    permissions: ['dashboard', 'employees.view', 'employees.sensitive', 'attendance.view', 'payroll.view', 'payroll.edit', 'payroll.config', 'holidays.manage', 'leave.manage', 'self'],
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
  sales: {
    label: 'Sales Officer',
    description: 'Works Sales & CRM: leads, accounts, contacts, deals, bids, contracts and activities. Cannot delete records or change the sales setup.',
    permissions: ['crm.view', 'crm.edit', 'self'],
  },
  salesmgr: {
    label: 'Sales Manager',
    description: 'Everything a Sales Officer does, plus deleting CRM records and the sales setup: pipeline stages, lead sources, lost reasons and the bid document checklist. Sees every project (read only), to follow the delivery of what was sold.',
    permissions: ['crm.view', 'crm.edit', 'crm.manage', 'pm.view', 'self'],
  },
  pm: {
    label: 'Project Manager',
    description: 'Runs Project Management: creates and edits any project, its members, milestones and tasks; sees every project, the workload and time; deletes projects and changes the Projects setup. Can view employee records.',
    permissions: ['pm.view', 'pm.edit', 'pm.manage', 'employees.view', 'self'],
  },
  employee: {
    label: 'Employee',
    description: 'Self-service only: clock in and out, file leave and remote-work requests, see own attendance, payslips, profile and assigned IT equipment; report malfunctioning or damaged equipment.',
    permissions: ['self'],
  },
};

// Rows for the access matrix (Admin panel → Roles & permissions).
export const PERMISSION_LABELS = [
  ['dashboard', 'Company dashboard'],
  ['employees.view', 'View employee records'],
  ['employees.edit', 'Add and edit employees'],
  ['employees.sensitive', 'See pay, government ID numbers and bank details (full numbers are shown on request and logged)'],
  ['attendance.view', 'View attendance (DTR)'],
  ['attendance.edit', 'Edit attendance and approve overtime'],
  ['attendance.location', 'Clock-in locations (geotagging) and the office location'],
  ['clock.kiosk', 'Shared time clock'],
  ['payroll.view', 'View payroll runs and payslips'],
  ['payroll.edit', 'Create, adjust and finalize payroll'],
  ['payroll.config', 'Payroll setup: pay rules, holiday and night premiums, government rates, tax tables'],
  ['holidays.manage', 'Holiday calendar: load proclaimed holidays, add local and Eid holidays'],
  ['leave.manage', 'Leave types, credits and balances; view all requests'],
  ['leave.approve', 'Approve or reject leave and remote-work requests'],
  ['leave.adjust', "Change one employee's leave: types offered, credits, adjustments, recorded days"],
  ['assets.view', 'View IT assets, inventory, allocations and problem reports'],
  ['assets.edit', 'Register, assign and return assets; receive and issue stock; respond to problem reports'],
  ['settings.edit', 'Company details, default schedule and branding'],
  ['settings.center', 'Settings center: every setting in one list, its change history, undo, export and import (changing a setting still needs the permission of its own screen)'],
  ['modules.config', 'Turn modules on or off for the company'],
  ['roles.manage', 'Roles & permissions: what each account type may do'],
  ['data.manage', 'Backup, restore and erase data; demo data'],
  ['users.manage', 'Manage user accounts and access grants; sign-in & security settings'],
  ['audit.view', 'Audit log: who viewed or changed personal data, payroll and settings'],
  ['devlog.view', 'Dev log: release notes and installed version'],
  ['devlog.edit', 'Write and edit dev log entries'],
  ['guides.edit', 'Help & guides: edit the guides and add the company\'s own'],
  ['helpdesk.agent', 'Service desk: work all tickets (reply, notes, assign, status)'],
  ['helpdesk.manage', 'Service desk settings: receiving email address and mailbox, outgoing mail, categories, SLA, saved replies'],
  ['crm.view', 'Sales & CRM: see accounts, contacts, leads, deals, bids and contracts'],
  ['crm.edit', 'Sales & CRM: add and edit records, move deals, log calls, meetings and tasks'],
  ['crm.manage', 'Sales & CRM: delete records and change the sales setup'],
  ['pm.view', 'Projects: see every project, its tasks, milestones, time and the workload'],
  ['pm.edit', 'Projects: create projects and edit any project (details, members, columns, milestones, tasks)'],
  ['pm.manage', 'Projects: delete projects and change the Projects setup'],
  ['feedback.view', 'Read feedback sent by users'],
  ['feedback.manage', 'Reply to feedback, change its status or delete it'],
  ['self', 'Own attendance, payslips, profile, requests and assigned equipment; report equipment problems'],
];

// The matrix on Roles & permissions, a table per part of CORE.
export const PERMISSION_GROUPS = [
  { id: 'hr', label: 'HR & Payroll', permissions: ['dashboard', 'employees.view', 'employees.edit', 'employees.sensitive', 'attendance.view', 'attendance.edit', 'attendance.location', 'clock.kiosk', 'payroll.view', 'payroll.edit', 'payroll.config', 'holidays.manage', 'leave.manage', 'leave.approve', 'leave.adjust', 'self'] },
  { id: 'assets', label: 'IT Asset Management', permissions: ['assets.view', 'assets.edit'] },
  { id: 'helpdesk', label: 'IT Service Desk', permissions: ['helpdesk.agent', 'helpdesk.manage'] },
  { id: 'crm', label: 'Sales & CRM', permissions: ['crm.view', 'crm.edit', 'crm.manage'] },
  { id: 'projects', label: 'Project Management', permissions: ['pm.view', 'pm.edit', 'pm.manage'] },
  { id: 'admin', label: 'Admin panel', permissions: ['settings.edit', 'settings.center', 'modules.config', 'audit.view', 'devlog.view', 'devlog.edit', 'feedback.view', 'feedback.manage', 'guides.edit', 'users.manage', 'roles.manage', 'data.manage'] },
];
const KNOWN = new Set(PERMISSION_LABELS.map(([p]) => p));

// Permissions that stay with administrators: given to another account type, it could make itself
// an administrator (accounts, the security settings, roles) or replace every record (data).
export const ADMIN_ONLY_PERMISSIONS = ['users.manage', 'roles.manage', 'data.manage'];
// Any of these opens the Admin panel (each of its pages needs its own).
export const ADMIN_PANEL_PERMISSIONS = ['users.manage', 'roles.manage', 'settings.edit', 'settings.center', 'modules.config', 'data.manage', 'audit.view', 'devlog.view', 'feedback.view', 'guides.edit'];

// The company's changes to the account types (Admin panel → Roles & permissions):
// { role: { add: [permission…], remove: [permission…] } }, kept in db.data.roleOverrides. The server
// sets them at start, after each change and after a restore; the browser gets them with the sign-in
// status. Only known permissions are kept, administrators are never changed, and admin-only
// permissions are never added, whatever the saved data says.
let overrides = {};
export function cleanOverrides(o) {
  const out = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const [role, v] of Object.entries(o)) {
    if (role === 'admin' || !Object.hasOwn(ROLES, role) || !v || typeof v !== 'object') continue;
    const base = ROLES[role].permissions;
    const list = (x) => (Array.isArray(x) ? [...new Set(x.filter((p) => typeof p === 'string' && KNOWN.has(p)))].sort() : []);
    const add = list(v.add).filter((p) => !base.includes(p) && !ADMIN_ONLY_PERMISSIONS.includes(p));
    const remove = list(v.remove).filter((p) => base.includes(p));
    if (add.length || remove.length) out[role] = { add, remove };
  }
  return out;
}
export function setRoleOverrides(o) {
  overrides = cleanOverrides(o);
  return overrides;
}
export const roleOverrides = () => overrides;

// The permissions an account type has: its built-in ones, with the company's changes.
export function permissionsOf(role) {
  const base = ROLES[role]?.permissions || [];
  if (base.includes('*')) return base;
  const o = overrides[role];
  if (!o) return base;
  const remove = new Set(o.remove);
  return [...new Set([...base.filter((p) => !remove.has(p)), ...o.add])];
}

export function can(role, permission) {
  const perms = permissionsOf(role);
  return perms.includes('*') || perms.includes(permission);
}
// Built-in only, without the company's changes ("Defaults" on Roles & permissions).
export const builtInCan = (role, permission) => {
  const perms = ROLES[role]?.permissions || [];
  return perms.includes('*') || perms.includes(permission);
};

// Permissions an administrator can grant or remove per account, on top of the account type (and of
// the company's changes to it: Admin panel → Access grants).
// user.helpdeskAgent / user.crmAccess / user.pmAccess: true (granted), false (removed) or absent
// (follow the account type). CRM and Projects access grant viewing and editing; removing it also
// removes crm.manage / pm.manage. Administrators always keep everything.
// (Anyone who is a member of a project can open that project without pm.view: see server/projects.js.)
export const PER_USER = { 'helpdesk.agent': 'helpdeskAgent', 'crm.view': 'crmAccess', 'crm.edit': 'crmAccess', 'pm.view': 'pmAccess', 'pm.edit': 'pmAccess' };
export function userCan(user, permission) {
  if (!user) return false;
  if (user.role !== 'admin') {
    const field = PER_USER[permission];
    if (field && typeof user[field] === 'boolean') return user[field];
    if (permission === 'crm.manage' && user.crmAccess === false) return false;
    if (permission === 'pm.manage' && user.pmAccess === false) return false;
  }
  return can(user.role, permission);
}

// Whether this account opens the Admin panel at all.
export const usesAdminPanel = (user) => ADMIN_PANEL_PERMISSIONS.some((p) => userCan(user, p));
