// Labels for the audit log (server/audit.js), shared with the Audit log page.

export const AUDIT_AREAS = {
  auth: 'Sign-in',
  user: 'User accounts',
  employee: 'Employees',
  attendance: 'Attendance',
  leave: 'Leave & requests',
  payroll: 'Payroll',
  settings: 'Settings',
  holiday: 'Holidays',
  data: 'Backup & data',
  assets: 'IT assets',
  helpdesk: 'Service desk',
  crm: 'Sales & CRM',
  projects: 'Projects',
  system: 'System',
};

export const AUDIT_ACTIONS = {
  'auth.login': 'Signed in',
  'auth.login-failed': 'Failed sign-in',
  'auth.logout': 'Signed out',
  'auth.password-change': 'Changed own password',
  'auth.locked': 'Account locked after wrong passwords',
  'auth.2fa-failed': 'Wrong 2-step verification code',
  'auth.2fa-on': 'Turned on 2-step verification',
  'auth.2fa-off': 'Turned off 2-step verification',
  'auth.recovery-used': 'Signed in with a recovery code',
  'auth.recovery-new': 'Made new recovery codes',
  'auth.sessions': 'Signed out other sessions',
  'user.2fa-reset': 'Reset 2-step verification',
  'user.sign-out': 'Signed a user out everywhere',
  'settings.security': 'Changed sign-in and security settings',
  'user.create': 'Created a user account',
  'user.update': 'Changed a user account',
  'user.reset-password': 'Reset a password',
  'user.delete': 'Deleted a user account',
  'employee.create': 'Added an employee',
  'employee.update': 'Changed an employee record',
  'employee.delete': 'Deleted an employee',
  'employee.view': 'Viewed an employee record',
  'employee.reveal': 'Viewed government IDs and bank account',
  'employee.export': 'Exported the employee list (full)',
  'attendance.create': 'Added an attendance record',
  'attendance.update': 'Changed an attendance record',
  'attendance.delete': 'Deleted an attendance record',
  'leave.decide': 'Decided a request',
  'leave.cancel': 'Cancelled a request',
  'leave.attachment': 'Opened a medical certificate',
  'leave.change': 'Changed leave settings or balances',
  'payroll.run.create': 'Created a payroll run',
  'payroll.run.recompute': 'Recomputed a payroll run',
  'payroll.run.adjust': 'Adjusted a payslip',
  'payroll.run.finalize': 'Finalized a payroll run',
  'payroll.run.void': 'Voided a payroll run',
  'payroll.run.delete': 'Deleted a draft payroll run',
  'payroll.run.view': 'Viewed a payroll run',
  'payroll.opening.add': 'Added an opening balance',
  'payroll.opening.remove': 'Removed an opening balance',
  'payroll.config': 'Changed Payroll Setup',
  'settings.update': 'Changed company settings',
  'holiday.create': 'Added a holiday',
  'holiday.update': 'Changed a holiday',
  'holiday.delete': 'Removed a holiday',
  'holiday.load': 'Loaded proclaimed holidays',
  'data.export': 'Downloaded a full backup',
  'data.import': 'Restored a backup',
  'data.demo-load': 'Loaded demo data',
  'data.demo-remove': 'Removed demo data',
  'data.reset': 'Erased all data',
  // Any other change, recorded with the request it came from.
  'assets.change': 'Changed IT assets or inventory',
  'helpdesk.change': 'Changed the service desk',
  'crm.change': 'Changed Sales & CRM',
  'projects.change': 'Changed a project, its tasks or time',
  'projects.bulk': 'Changed or deleted tasks in bulk',
  'projects.import': 'Imported tasks from a CSV file',
  'projects.digest-failed': 'Projects daily digest not sent',
  'attendance.change': 'Changed attendance settings',
  'payroll.change': 'Changed payroll data',
  'system.change': 'Changed system data',
  'system.guide': 'Changed a Help guide',
};

export const actionLabel = (a) => AUDIT_ACTIONS[a] || a;
export const areaOf = (a) => a.split('.')[0];

// The area of a request path, for changes without their own entry.
export function areaOfPath(pathname) {
  if (/^\/api\/(leave|requests|approvals|approval-flow|me\/requests)|^\/api\/employees\/[^/]+\/leave/.test(pathname)) return 'leave';
  if (/^\/api\/(assets|inventory|stock|issue-reports|me\/assets)/.test(pathname)) return 'assets';
  if (/^\/api\/(helpdesk|tickets|me\/tickets)/.test(pathname)) return 'helpdesk';
  if (/^\/api\/crm/.test(pathname)) return 'crm';
  if (/^\/api\/pm\//.test(pathname)) return 'projects';
  if (/^\/api\/(time-entries|clock-locations|location-settings)/.test(pathname)) return 'attendance';
  if (/^\/api\/(payroll|employees\/[^/]+\/ytd)/.test(pathname)) return 'payroll';
  return 'system';
}
