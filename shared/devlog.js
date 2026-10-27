// Dev log: the changelog, one entry per build, newest first. Written by a single
// maintainer in a formal, concise register (Keep a Changelog conventions).
//
// These are the built-in entries. The server copies each one into its database
// (server/devlog.js) and keeps it in step with this file until an administrator
// edits it on the Dev log page; edited or deleted entries are left alone.
//
// When something ships: add an entry at the top and set package.json "version"
// to the same value (a test checks both).
//   version  semver with a stage, e.g. '0.2.8-alpha'
//   modules  hr | assets | system | deploy
//   changes  [type, module, text], type is new (Added) | improved (Changed) | fixed (Fixed)
//   known    known issues in this build (optional)

export const DEVLOG_MODULES = {
  hr: 'HR & Payroll',
  assets: 'IT Asset Management',
  system: 'System & access',
  deploy: 'Deployment & hosting',
};

// Short module keys shown as scopes, e.g. "Fixed  system  …".
export const MODULE_SCOPES = { hr: 'hr', assets: 'assets', system: 'system', deploy: 'deploy' };

export const CHANGE_TYPES = { new: 'Added', improved: 'Changed', fixed: 'Fixed' };

export const DEVLOG = [
  {
    version: '0.5.0-alpha',
    date: '2026-10-27',
    title: 'IT Service Desk',
    modules: ['system', 'assets'],
    notes: 'Released the IT Service Desk module: tickets from the portal, by email and from agents, with a configurable receiving address.',
    changes: [
      ['new', 'system', 'IT Service Desk module on the launcher. Ticket numbers (HD-000001), categories, priorities, statuses, assignment, linked IT assets, and first-response and resolution SLA targets with overdue flags.'],
      ['new', 'system', 'My tickets portal for every user: open tickets with attachments and equipment, follow replies, reply, and mark a ticket solved.'],
      ['new', 'system', 'Agent workspace: queue with views, filters and search; public replies and internal notes; saved replies; status selection after replying; collision notice when another agent is viewing; logging tickets on behalf of a user.'],
      ['new', 'system', 'Configurable receiving email: helpdesk address and IMAP mailbox (presets for Gmail, Microsoft 365 and Zoho), connection test, manual and scheduled checks, sender restrictions, and threading of replies by ticket number and message references.'],
      ['new', 'system', 'Outgoing email over SMTP for agent replies and acknowledgements, with a test send. Loop protection for automatic mail and the desk\'s own address; duplicate messages are imported once.'],
      ['new', 'system', 'Helpdesk Agent account type and two permissions: work tickets, and manage service desk settings (Administrators). IT Asset Managers are agents.'],
      ['new', 'system', 'Mailbox passwords are encrypted at rest with a key stored beside the data file and are excluded from the browser and backups.'],
    ],
    known: [
      'Mailboxes that require OAuth sign-in only (most Microsoft 365 tenants) are not supported yet; use a mailbox that allows IMAP with an app password.',
      'Only PDF and image attachments are imported from email; other file types are listed on the ticket as not imported.',
      'Mail is checked every few minutes (configurable from 1 minute); there is no push notification from the mail server.',
    ],
  },
  {
    version: '0.4.2-alpha',
    date: '2026-10-24',
    title: 'Payslip redesign',
    modules: ['hr'],
    notes: 'Redesigned the payslip as a formal pay statement for screen, print and PDF.',
    changes: [
      ['improved', 'hr', 'Letterhead with company details, payslip reference number (PS-period-employee no.) and a confidentiality mark; pay period, pay date, frequency and status in a header row.'],
      ['improved', 'hr', 'Employee information block including government ID numbers and the account pay is credited to; ruled Earnings and Deductions tables with amounts taken off shown in parentheses.'],
      ['new', 'hr', 'Pay summary with net pay in figures and in words; attendance and employer contribution tables; acknowledgement lines for the employee\'s signature and date; standard footer note.'],
      ['improved', 'hr', 'Draft payslips carry a DRAFT watermark. Printing or saving as PDF produces one A4 page per payslip.'],
    ],
  },
  {
    version: '0.4.1-alpha',
    date: '2026-10-21',
    title: 'Flexible time and 312 work days per year',
    modules: ['hr'],
    notes: 'Added a flexible-time (FLEX) designation that exempts an employee\'s clock times from payroll deductions, and set the work days per year to 312.',
    changes: [
      ['new', 'hr', 'Employee records have a Flexible time (FLEX) option. For FLEX employees, late arrival and undertime are not computed or deducted; overtime is time worked beyond the scheduled daily hours regardless of start time and still requires approval. Absences and unpaid leave are deducted as before.'],
      ['new', 'hr', 'FLEX is shown on the employee list, the employee profile, the Attendance (DTR) and the payslip.'],
      ['improved', 'hr', 'Work days per year changed from 261 to 312 (6 days x 52 weeks), applied once to existing data. Daily rate = monthly salary x 12 / 312. The value remains editable in Payroll Setup.'],
      ['fixed', 'hr', 'A monthly-rated employee with no day worked or on paid leave in a period could receive a remainder of basic pay when the work-days factor is higher than the scheduled days; the full basic pay is now deducted.'],
    ],
    known: [
      'Finalized payroll runs keep the figures they were finalized with; draft runs pick up the new daily rate and FLEX rules when recalculated.',
    ],
  },
  {
    version: '0.4.0-alpha',
    date: '2026-10-21',
    title: 'Clock-in geotagging',
    modules: ['hr', 'system'],
    notes: 'Added recording of the device location at clock-in, checked against an office location, with access limited to HR Managers and Administrators.',
    changes: [
      ['new', 'hr', 'Clocking in from My Home or the Time Clock records the device location (coordinates and accuracy) with the time record. Clocking out does not record a location. Employees are informed on the clock screen.'],
      ['new', 'hr', 'Office location with a radius (default 150 m). Clock-ins are marked within the office, outside the office, or remote day; outside clock-ins are flagged, never blocked. If the location is unavailable or permission is denied, the clock-in is recorded and marked "No location".'],
      ['new', 'hr', 'Clock-in locations page: filters by employee, dates and flag, summary counts, map view with links to Google Maps and OpenStreetMap, CSV export, and the office location settings.'],
      ['new', 'hr', 'Attendance (DTR) shows the clock-in location for each record, opens the map, and includes location columns in the CSV export.'],
      ['new', 'system', 'New permission "Clock-in locations", granted to HR Managers and Administrators only. Locations are removed from attendance data sent to every other account, including the employee.'],
      ['new', 'system', 'Locations are deleted automatically after the retention period (default 365 days); the attendance record is kept.'],
    ],
    known: [
      'Browsers provide location only on secure (https) addresses or localhost. On the Windows version opened from other computers by IP address, clock-ins are recorded with "No location".',
      'Laptop locations from Wi-Fi can be off by several hundred metres, and locations can be spoofed with developer tools.',
    ],
  },
  {
    version: '0.3.1-alpha',
    date: '2026-10-20',
    title: 'Feedback dialogs and phone sheets',
    modules: ['system'],
    notes: 'Moved feedback entry, viewing and responses into dialogs, and refined dialog presentation on phones.',
    changes: [
      ['improved', 'system', 'Feedback page lists submissions as compact rows; New feedback opens a dialog with described type options, module, subject and a character count; selecting a submission opens it with its message and history.'],
      ['improved', 'system', 'Feedback inbox: administrators respond through a Respond dialog (status and response); deletion uses a titled confirmation. On phones the inbox is shown as a list of cards with two-column filters.'],
      ['improved', 'system', 'Dialogs on phones open as bottom sheets with a grab handle, a fixed header and footer, a subtitle line and larger buttons; notifications move to the top while a dialog is open.'],
    ],
  },
  {
    version: '0.3.0-alpha',
    date: '2026-10-20',
    title: 'Feedback, leave eligibility and medical certificates',
    modules: ['hr', 'system'],
    notes: 'Added a feedback channel from all users to administrators, restricted gender-specific leave types, and introduced medical certificate attachments for extended sick leave.',
    changes: [
      ['new', 'system', 'Send feedback page for every user (bug, suggestion, question, compliment or other; system area; subject and details), listing the user\'s own submissions with status and administrator replies.'],
      ['new', 'system', 'Feedback inbox for administrators: filters by status, type and area, search, CSV export, per-item status (New, Under review, Planned, Resolved, Closed), replies visible to the sender, and deletion. New items are counted on the menu and launcher.'],
      ['new', 'hr', 'Leave types can be limited by gender, based on the gender on the employee record. Maternity Leave is limited to female employees and Paternity Leave to male employees.'],
      ['new', 'hr', 'Leave types can require a medical certificate above a number of work days. Sick Leave requires one for requests longer than 3 days.'],
      ['new', 'hr', 'Employees attach the certificate (PDF or photo, up to 5 MB) when filing, or attach or replace it while the request is pending. HR opens it from the request list and the approval dialog.'],
      ['fixed', 'hr', 'Maternity Leave and Paternity Leave were offered to all employees regardless of gender. Filing, approval, manual recording and per-employee access now enforce the limit.'],
    ],
    known: [
      'Attachments are stored in the data/attachments folder and are not included in the backup file downloaded from Settings.',
      'An approved sick leave request filed before this build is not checked for a certificate retroactively.',
      'Employees with no gender on record cannot file gender-limited leave until HR updates the record.',
    ],
  },
  {
    version: '0.2.8-alpha',
    date: '2026-10-20',
    title: 'Dev log redesign',
    modules: ['system'],
    notes: 'Reworked the Dev log into a compact changelog view and rewrote all entries in a formal register.',
    changes: [
      ['improved', 'system', 'Compact changelog layout: monospace version and ISO date per release, Added / Changed / Fixed labels with module scopes, and a one-line build information bar.'],
      ['new', 'system', 'Collapsible releases. The three most recent are expanded; older releases show a change summary and expand on demand.'],
      ['new', 'system', 'Filter by change type in addition to module and free-text search.'],
      ['new', 'system', 'Export of the full log as CHANGELOG.md.'],
      ['improved', 'system', 'Built-in entries that have not been edited by an administrator are now updated in place when a newer build revises their wording.'],
    ],
  },
  {
    version: '0.2.7-alpha',
    date: '2026-10-19',
    title: 'Mobile layout',
    modules: ['system'],
    notes: 'Introduced a dedicated phone layout. The sidebar no longer occupies the top of every page, and wide tables no longer overflow the screen.',
    changes: [
      ['improved', 'system', 'Phone top bar with logo, current module and menu button; the sidebar opens as a drawer and closes on navigation, scrim tap or Escape. A dot on the button indicates pending menu badges.'],
      ['improved', 'system', 'Tables render as one labelled card per row below 760 px, with empty fields omitted. Grid tables (leave balances, access matrix, tax editor) keep horizontal scrolling with a pinned first column.'],
      ['improved', 'system', 'Bottom-sheet modals, horizontally scrolling tabs, two-column stat grid, and full-width filters and page actions.'],
      ['fixed', 'system', 'Stat cards were vertically staggered on all screen sizes; card groups on asset pages had no spacing.'],
    ],
    known: ['The payroll register is long on phones (one card per employee, all columns). Payroll runs are better handled on a desktop.'],
  },
  {
    version: '0.2.6-alpha',
    date: '2026-10-17',
    title: 'Stray dev log dialogs',
    modules: ['system'],
    notes: 'Fixed dev log dialogs opening on unrelated pages after the Dev log had been visited.',
    changes: [
      ['fixed', 'system', 'Edit and Delete actions on users, leave types and attendance records no longer open dev log dialogs. The Dev log click handler was bound to the shared page container and never released.'],
      ['improved', 'system', 'Each route now renders into a fresh container, so a view cannot leave event listeners behind for the next one.'],
    ],
  },
  {
    version: '0.2.5-alpha',
    date: '2026-10-17',
    title: 'Per-employee leave management',
    modules: ['hr'],
    notes: 'Added administrator tools to manage leave for an individual employee: leave types offered, credits, adjustments and directly recorded leave days.',
    changes: [
      ['new', 'hr', 'Employee leave tab (Leave & Requests, administrators only), also reachable from the employee profile, showing credits, adjustments, used, pending and remaining per leave type.'],
      ['new', 'hr', 'Per-employee toggle for each leave type. Employees can only view and file the types they are offered.'],
      ['new', 'hr', 'Leave type scope: every employee, or only employees added by an administrator.'],
      ['new', 'hr', 'Balance adjustments in half-day steps with a mandatory reason; each adjustment is recorded with its author and can be removed.'],
      ['new', 'hr', 'Direct recording of leave days into the DTR (one per scheduled work day), with removal for days not tied to a request.'],
      ['improved', 'hr', 'Balance totals include adjustments; the balances grid shows "n/a" for types not offered to an employee.'],
      ['fixed', 'hr', 'Adjustments saved in the same millisecond could be listed out of order.'],
    ],
    known: ['Leave recorded in an already finalized pay period does not change issued payslips; the page displays a warning.', 'Employee leave is restricted to Administrators; HR Managers retain the balances grid.'],
  },
  {
    version: '0.2.4-alpha',
    date: '2026-10-15',
    title: 'Editable dev log',
    modules: ['system'],
    notes: 'Moved dev log entries into the database so that administrators can maintain them from the application.',
    changes: [
      ['new', 'system', 'Create, edit and delete entries on the Dev log page (administrators): version, date, title, summary, changes and known issues.'],
      ['new', 'system', 'Single author name for the whole log, defaulting to the first administrator and editable on the page.'],
      ['improved', 'system', 'Each build adds its own entry automatically; administrator edits and deletions persist across updates, demo data loads and data resets.'],
    ],
    known: ['Entry edits are not versioned; previous wording is only retained in data backups.'],
  },
  {
    version: '0.2.3-alpha',
    date: '2026-10-15',
    title: 'Version renumbering',
    modules: ['system'],
    notes: 'Renumbered all builds as alpha releases starting from 0.0.1-alpha and rewrote the release notes.',
    changes: [
      ['improved', 'system', 'Builds are numbered from 0.0.1-alpha; the earlier 1.x and 2.x numbers are retired.'],
      ['improved', 'system', 'Entries include a summary and, where applicable, known issues.'],
    ],
  },
  {
    version: '0.2.2-alpha',
    date: '2026-10-15',
    title: 'Dev log',
    modules: ['system'],
    notes: 'Added a release log for administrators, together with the identity of the build running on the server.',
    changes: [
      ['new', 'system', 'Dev log page under System, restricted to administrators, with module filter and search.'],
      ['new', 'system', 'Installed version panel: version, commit, install time and uptime.'],
      ['new', 'system', 'Unread release count on the menu item and on the launcher.'],
    ],
    known: ['The unread state is stored per browser.'],
  },
  {
    version: '0.2.1-alpha',
    date: '2026-10-15',
    title: 'Automated deployment',
    modules: ['deploy'],
    notes: 'Added continuous deployment from GitHub to the EC2 server through AWS Systems Manager, without SSH keys or stored AWS credentials.',
    changes: [
      ['new', 'deploy', '"Deploy to EC2" workflow: runs the test suite, then installs the build on the server after taking a data backup.'],
      ['new', 'deploy', 'CloudFormation template that provisions the required IAM role, instance profile and GitHub OIDC provider.'],
      ['new', 'deploy', 'Each deployment enforces the Asia/Manila time zone and installs the nightly backup job.'],
      ['fixed', 'deploy', 'The deploy job was skipped without explanation when settings were missing. Settings are read from repository variables or secrets, validated, and missing values are reported in the run summary.'],
    ],
    known: ['GitHub reports a Node.js 20 deprecation warning for aws-actions/configure-aws-credentials; it has no functional impact.'],
  },
  {
    version: '0.2.0-alpha',
    date: '2026-10-15',
    title: 'Equipment problem reports',
    modules: ['assets', 'deploy'],
    notes: 'Added problem reporting for assigned equipment, with a review queue for IT and administrators.',
    changes: [
      ['new', 'assets', 'Report a problem from My Assets: type (malfunction, physical damage, lost or stolen, other), work impact, date noticed and description.'],
      ['new', 'assets', 'Problem reports page for IT and administrators with new-report badge, filters and CSV export; read-only for HR.'],
      ['new', 'assets', 'Report workflow (New, Being checked, Resolved, Closed) with notes visible to the reporting employee.'],
      ['improved', 'assets', 'Open reports are shown on the IT overview, the asset page and history, and the launcher.'],
      ['fixed', 'assets', 'History entries with identical timestamps could be listed out of order.'],
      ['fixed', 'deploy', 'Server time zone set to Asia/Manila; attendance and report dates were 8 hours behind.'],
    ],
    known: ['Reports do not support photo attachments.', 'No email notification is sent for new reports.'],
  },
  {
    version: '0.1.2-alpha',
    date: '2026-10-14',
    title: 'Cloud hosting',
    modules: ['deploy', 'system'],
    notes: 'Added documentation and tooling to run the ERP on Amazon EC2 over HTTPS.',
    changes: [
      ['new', 'deploy', 'EC2 deployment guide: instance, DNS (with a DuckDNS fallback), automatic HTTPS via Caddy, daily snapshots and nightly data backups.'],
      ['new', 'deploy', 'Update script that backs up the data file before installing a new build.'],
      ['new', 'system', 'COOKIE_SECURE option for HTTPS-only session cookies, and a command to create the first administrator from the server.'],
    ],
    known: ['Updates require terminal access (resolved in 0.2.1-alpha).'],
  },
  {
    version: '0.1.1-alpha',
    date: '2026-10-14',
    title: 'Launcher redesign',
    modules: ['system'],
    notes: 'Restyled the module launcher to match lancastertechdev.com.',
    changes: [
      ['improved', 'system', 'Launcher with greeting, module cards with live figures, upcoming modules and an administration band.'],
    ],
  },
  {
    version: '0.1.0-alpha',
    date: '2026-10-14',
    title: 'LTDC ERP and IT Asset Management',
    modules: ['system', 'assets'],
    notes: 'Restructured the HR application as a module of LTDC ERP and added the IT Asset Management module.',
    changes: [
      ['new', 'system', 'Module launcher after sign-in; Finance, Procurement, Projects, CRM, Service Desk and Documents listed as upcoming.'],
      ['new', 'assets', 'Asset register with tags, serial numbers, specifications, purchase and warranty data, and per-asset history.'],
      ['new', 'assets', 'Assignment, transfer and return to employees, departments or locations; in repair, retired and lost statuses.'],
      ['new', 'assets', 'Consumable inventory with stock receipts, issues, count adjustments and low-stock alerts.'],
      ['new', 'assets', 'Allocations view, activity log, My Assets for employees, and CSV export on all lists.'],
      ['new', 'system', 'IT Asset Manager role; asset visibility for HR and equipment listing on employee profiles.'],
    ],
  },
  {
    version: '0.0.5-alpha',
    date: '2026-10-13',
    title: 'Payroll setup, leave and requests',
    modules: ['hr'],
    notes: 'Made payroll parameters configurable and added leave management with employee requests.',
    changes: [
      ['new', 'hr', 'Payroll Setup: pay frequency, overtime rates, SSS, PhilHealth and Pag-IBIG rates, and tax tables.'],
      ['new', 'hr', 'Leave types, annual credits, per-employee overrides and balances.'],
      ['new', 'hr', 'Leave and remote-work requests approved by the HR Manager or an Administrator; approved days are written to the DTR.'],
    ],
    known: ['Approval is single-level.'],
  },
  {
    version: '0.0.4-alpha',
    date: '2026-10-13',
    title: 'Windows package',
    modules: ['deploy'],
    notes: 'Added a portable Windows build that requires no installation.',
    changes: [
      ['new', 'deploy', 'Windows package with bundled Node.js runtime, launchers, optional desktop shortcut and an office-network mode.'],
    ],
    known: ['The .bat launchers have not been verified on a physical Windows machine.'],
  },
  {
    version: '0.0.3-alpha',
    date: '2026-10-13',
    title: 'Authentication and roles',
    modules: ['system', 'hr'],
    notes: 'Added sign-in and role-based access control.',
    changes: [
      ['new', 'system', 'Sign-in page and first-run administrator setup; Administrator, HR Manager, Payroll Officer and Employee roles.'],
      ['new', 'system', 'Users & Access page, password changes, and a 5-minute lockout after five failed sign-ins.'],
      ['new', 'hr', 'Employee self-service: clock in and out, own attendance, payslips and profile.'],
    ],
    known: ['No self-service password reset; administrators reset passwords.'],
  },
  {
    version: '0.0.2-alpha',
    date: '2026-10-12',
    title: 'Lancaster design system',
    modules: ['system'],
    notes: 'Applied the lancastertechdev.com visual identity across the application.',
    changes: [
      ['improved', 'system', 'Maroon and gold palette, Big Shoulders headings and company logo on all screens.'],
    ],
  },
  {
    version: '0.0.1-alpha',
    date: '2026-10-12',
    title: 'Initial build',
    modules: ['hr'],
    notes: 'Initial HR application with employee records, time tracking and Philippine payroll.',
    changes: [
      ['new', 'hr', 'Employee records with SSS, PhilHealth, Pag-IBIG and TIN numbers, pay rates and schedules.'],
      ['new', 'hr', 'Time clock and daily time records with late, undertime and overtime computation.'],
      ['new', 'hr', 'Payroll runs with SSS, PhilHealth, Pag-IBIG and withholding tax deductions, and printable payslips.'],
    ],
    known: ['Not supported: holiday pay, night differential, 13th month pay, loans, BIR 2316.'],
  },
];

export const APP_VERSION = DEVLOG[0].version;

// Compare 'x.y.z' or 'x.y.z-stage' versions by their numbers.
export function compareVersions(a, b) {
  const nums = (v) => v.split('-')[0].split('.').map(Number);
  const [x, y] = [nums(a), nums(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
