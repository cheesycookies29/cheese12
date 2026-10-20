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
