// Every setting an administrator can change in CORE, in one list: which module and group it is in,
// what it is called on its screen, a short explanation, and where to change it. The Admin panel's
// Settings center searches it, compares each value with its default, and labels the change history.
// Ported from Lancaster ATLAS (lms/shared/settings-catalog.js): one registry, many screens.
//
// area: a group of settings saved together (server/config.js knows how to read, save and reset it).
// path: where the setting is inside its area ('' = the whole area).
// format: how to show the value: percent (0.09 → 9%), bool, list, schedule, minutes, json; default: as is.
// No secret is listed or kept: mailbox and outgoing-mail passwords never leave their screen.

export const MODULES = [
  ['admin', 'Admin panel'],
  ['hr', 'HR & Payroll'],
  ['helpdesk', 'IT Service Desk'],
  ['crm', 'Sales & CRM'],
  ['projects', 'Project Management'],
];

// Areas: [id, module, label, screen, permission]. The permission is the one its own screen needs
// to save it; the Settings center shows an area only to accounts that have it.
export const AREAS = [
  ['company', 'admin', 'Company details', '#/admin/settings', 'settings.edit'],
  ['schedule', 'admin', 'Default work schedule', '#/admin/settings', 'settings.edit'],
  ['branding', 'admin', 'Branding', '#/admin/settings', 'settings.edit'],
  ['security', 'admin', 'Sign-in & security', '#/admin/security', 'users.manage'],
  ['modules', 'admin', 'Modules', '#/admin/modules', 'modules.config'],
  ['roles', 'admin', 'Roles & permissions', '#/admin/roles', 'roles.manage'],
  ['location', 'hr', 'Clock-in locations (geotagging)', '#/clock-locations', 'attendance.location'],
  ['approvals', 'hr', 'Leave and request approvals', '#/leave?tab=flow', 'leave.approve'],
  ['leaveTypes', 'hr', 'Leave types', '#/leave?tab=types', 'leave.manage'],
  ['payroll', 'hr', 'Payroll setup (summary)', '#/payroll-setup', 'payroll.config'],
  ['helpdesk', 'helpdesk', 'Tickets & replies', '#/helpdesk/settings?tab=general', 'helpdesk.manage'],
  ['helpdeskForm', 'helpdesk', 'Public form', '#/helpdesk/settings?tab=public', 'helpdesk.manage'],
  ['helpdeskMail', 'helpdesk', 'Receiving and sending email (no passwords)', '#/helpdesk/settings?tab=mailbox', 'helpdesk.manage'],
  ['crm', 'crm', 'Sales setup', '#/crm/settings', 'crm.manage'],
  ['projects', 'projects', 'Projects setup: statuses and types', '#/projects/settings', 'pm.manage'],
  ['digest', 'projects', 'Projects daily digest', '#/projects/settings?tab=digest', 'pm.manage'],
];

// [area, path, label, help, format]
export const SETTINGS = [
  // ----- Admin panel -----
  ['company', 'companyName', 'Company name', 'On every payslip, the CORE home and the sign-in page.'],
  ['company', 'companyAddress', 'Company address', 'Printed on payslips.'],
  ['company', 'companyTin', 'Company TIN', 'Printed on payslips.'],
  ['schedule', '', 'Default work schedule', 'The schedule new employee records start with.', 'schedule'],
  ['branding', 'theme', 'Brand colour', 'A preset, or the company\'s own colour (custom).'],
  ['branding', 'color', 'Company colour', 'The brand colour when the theme is the company\'s own. Must be readable with white text (4.5 : 1).'],
  ['branding', 'logo', 'Company logo', 'On the sign-in page and in the top bar.', 'picture'],
  ['branding', 'headline', 'Sign-in headline', 'The large line on the sign-in page.'],
  ['security', 'twoFactor', '2-step verification', 'Optional, required for administrators, or required for everyone.'],
  ['security', 'sessionIdleMinutes', 'Sign out after (idle minutes)', 'Without using CORE.', 'minutes'],
  ['security', 'sessionMaxHours', 'Longest session (hours)', 'Then sign in again, even if in use.'],
  ['security', 'requestsPerMinute', 'Requests per minute, per person', 'More than this is refused for a moment.'],
  ['security', 'signInFailuresPerAddress', 'Failed sign-ins per network address', 'In 15 minutes, any usernames; then that address waits.'],
  ['security', 'blockCommonPasswords', 'Refuse common passwords', 'And passwords with the username or name.', 'bool'],
  ['modules', 'hr', 'HR & Payroll', 'Employees, attendance, leave, payroll and everyone\'s self-service.', 'bool'],
  ['modules', 'assets', 'IT Asset Management', 'Assets, stock, allocations and My Assets.', 'bool'],
  ['modules', 'helpdesk', 'IT Service Desk', 'Tickets, email, the public form and My tickets.', 'bool'],
  ['modules', 'crm', 'Sales & CRM', 'Leads, accounts, pipeline, bids and contracts.', 'bool'],
  ['modules', 'projects', 'Project Management', 'Projects, My work, the workload and the digest.', 'bool'],
  ['roles', '', 'Permissions changed from the defaults', 'Which account types were given or lost permissions.', 'roles'],
  // ----- HR & Payroll -----
  ['location', 'officeLabel', 'Office name', 'Shown with each clock-in location.'],
  ['location', 'officeLat', 'Office latitude', 'Empty: no office check.'],
  ['location', 'officeLng', 'Office longitude', 'Empty: no office check.'],
  ['location', 'radius', 'Office radius (metres)', 'A clock-in farther than this is flagged.'],
  ['location', 'retentionDays', 'Keep clock-in locations (days)', 'Older locations are removed (Data Privacy Act: keep no longer than needed).'],
  ['approvals', 'flow', 'Approval flow', 'Sequential (one level after another) or any one level.'],
  ['approvals', 'levels', 'Approval levels', 'Who approves at each level.', 'levels'],
  ['approvals', 'attachmentsToApprovers', 'Approvers may open medical certificates', 'Off: only HR opens them (health data, RA 10173).', 'bool'],
  ['leaveTypes', '', 'Leave types', 'The types employees can file, with their yearly credits. Changed on their own screen.', 'list'],
  ['payroll', 'payFrequency', 'Pay frequency', 'Semi-monthly or monthly. Changed in Payroll Setup.'],
  ['payroll', 'workDaysPerYear', 'Work days per year', 'For the daily rate of monthly-paid employees.'],
  ['payroll', 'gracePeriodMinutes', 'Grace period (minutes)', 'Late arrivals within this are not deducted.'],
  ['payroll', 'minimumOvertimeMinutes', 'Minimum overtime (minutes)', 'Shorter overtime is not paid.'],
  ['payroll', 'nightDiff.rate', 'Night differential', 'Added to the hourly rate for night hours.', 'percent'],
  ['payroll', 'contributions', 'Deductions', 'SSS, PhilHealth, Pag-IBIG and withholding tax on or off.'],
  ['payroll', 'holidayPay.specialNotWorked', 'Special day not worked', 'Paid or unpaid.'],
  // ----- IT Service Desk -----
  ['helpdesk', 'categories', 'Ticket categories', '', 'list'],
  ['helpdesk', 'sla', 'Service levels (hours)', 'First response and resolution targets per priority.'],
  ['helpdesk', 'autoCloseDays', 'Close resolved tickets after (days)', '0 = never.'],
  ['helpdesk', 'autoAcknowledge', 'Acknowledge new tickets by email', '', 'bool'],
  ['helpdesk', 'ackTemplate', 'Acknowledgement email', 'The text of the acknowledgement.'],
  ['helpdeskForm', 'enabled', 'Public form (/support)', 'Anyone with the link can send a request.', 'bool'],
  ['helpdeskForm', 'title', 'Public form title', ''],
  ['helpdeskForm', 'intro', 'Public form introduction', ''],
  ['helpdeskForm', 'categories', 'Categories visitors can pick', '', 'list'],
  ['helpdeskForm', 'defaultPriority', 'Priority of public requests', ''],
  ['helpdeskForm', 'requirePhone', 'Ask for a phone number', '', 'bool'],
  ['helpdeskForm', 'allowFiles', 'Allow attachments', '', 'bool'],
  ['helpdeskMail', 'mailbox.enabled', 'Receive email', 'Read the helpdesk mailbox for new tickets.', 'bool'],
  ['helpdeskMail', 'mailbox.address', 'Helpdesk email address', ''],
  ['helpdeskMail', 'mailbox.host', 'Incoming mail server', ''],
  ['helpdeskMail', 'mailbox.pollMinutes', 'Check the mailbox every (minutes)', ''],
  ['helpdeskMail', 'mailbox.allowedSenders', 'Who may email tickets', 'Anyone, listed domains, or known people.'],
  ['helpdeskMail', 'outgoing.enabled', 'Send email', 'Replies, acknowledgements and the Projects digest.', 'bool'],
  ['helpdeskMail', 'outgoing.host', 'Outgoing mail server', ''],
  // ----- Sales & CRM -----
  ['crm', 'stages', 'Pipeline stages', 'Open stages and their win probability.', 'stages'],
  ['crm', 'sources', 'Lead sources', '', 'list'],
  ['crm', 'lostReasons', 'Lost reasons', '', 'list'],
  ['crm', 'industries', 'Industries', '', 'list'],
  ['crm', 'bidChecklist', 'Bid document checklist', 'Documents usually asked for in public bidding.', 'list'],
  ['crm', 'renewalNoticeDays', 'Contract renewal notice (days)', 'How early a contract shows as due for renewal.'],
  // ----- Project Management -----
  ['projects', 'statuses', 'Default task statuses', 'The columns new projects start with.', 'list'],
  ['projects', 'types', 'Project types', '', 'list'],
  ['digest', 'enabled', 'Send the daily digest', 'By email, through the Service Desk\'s outgoing mail.', 'bool'],
  ['digest', 'time', 'Digest time', 'The server\'s local time.'],
  ['digest', 'workingDaysOnly', 'Working days only', 'Weekends and holidays skipped.', 'bool'],
];

export const areaInfo = (id) => {
  const a = AREAS.find(([k]) => k === id);
  return a ? { id: a[0], module: a[1], label: a[2], screen: a[3], permission: a[4] } : null;
};

// The catalog label of a changed path ("radius" → "Office radius (metres)"); for a path under a
// listed setting ("sla.urgent.resolution" under "sla"), the nearest listed parent.
export function labelOf(area, path) {
  let p = path;
  for (;;) {
    const hit = SETTINGS.find(([a, q]) => a === area && q === p);
    if (hit) return hit[2] + (p !== path ? ` (${path.slice(p.length + (p ? 1 : 0))})` : '');
    if (!p) return path;
    p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '';
  }
}
