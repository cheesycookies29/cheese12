// Dev log: what changed in each release, newest first. Shown to administrators
// on the Dev log page. Add an entry at the top for every change that ships, and
// keep package.json "version" equal to the newest entry (a test checks this).
//
// modules: hr | assets | system | deploy      change types: new | improved | fixed

export const DEVLOG_MODULES = {
  hr: 'HR & Payroll',
  assets: 'IT Asset Management',
  system: 'System & access',
  deploy: 'Deployment & hosting',
};

export const CHANGE_TYPES = { new: 'New', improved: 'Improved', fixed: 'Fixed' };

export const DEVLOG = [
  {
    version: '2.4.0',
    date: '2026-10-15',
    title: 'Dev log',
    modules: ['system'],
    summary: 'Administrators can see what changed in each release and which version the server is running.',
    changes: [
      ['new', 'system', 'Dev log page (System › Dev log): every release with its date, the modules it touched, and what was new, improved or fixed. Filter by module or search.'],
      ['new', 'system', 'Installed version panel: version number, the exact build (commit), when it was installed and how long the app has been running.'],
      ['new', 'system', 'A count next to Dev log in the menu and on the launcher shows releases you haven’t read yet.'],
    ],
  },
  {
    version: '2.3.0',
    date: '2026-10-15',
    title: 'Automatic deployment from GitHub',
    modules: ['deploy'],
    summary: 'New versions are tested and installed on the EC2 server automatically, without using a terminal.',
    changes: [
      ['new', 'deploy', 'The “Deploy to EC2” GitHub workflow tests every new version and installs it on the server through AWS Systems Manager. No SSH keys or AWS passwords are stored.'],
      ['new', 'deploy', 'One-click AWS setup: a CloudFormation template creates the permissions the deployment needs.'],
      ['new', 'deploy', 'Each deployment keeps the server on Philippine time and the nightly backup installed.'],
      ['improved', 'deploy', 'Deployment settings can be saved as GitHub variables or secrets, and a missing or mistyped setting is named in the run summary instead of the deploy being silently skipped.'],
    ],
  },
  {
    version: '2.2.0',
    date: '2026-10-15',
    title: 'Equipment problem reports',
    modules: ['assets', 'deploy'],
    summary: 'Employees can report malfunctioning, damaged or lost equipment; administrators and IT follow each report through to resolution.',
    changes: [
      ['new', 'assets', 'Report a problem from My Assets: what’s wrong (malfunction, physical damage, lost or stolen), whether the employee can still work, when it was noticed and a description.'],
      ['new', 'assets', 'Problem reports page for administrators and IT, with a count of new reports in the menu, filters, search and CSV export.'],
      ['new', 'assets', 'Report status (New, Being checked, Resolved, Closed) and notes from IT, which the employee sees in My Assets.'],
      ['improved', 'assets', 'Open reports appear on the IT overview, on the asset’s page and in its history, and on the module launcher.'],
      ['fixed', 'assets', 'History entries recorded in the same instant are now always listed newest first.'],
      ['improved', 'deploy', 'The EC2 guide sets the server to Philippine time, so clock-ins, attendance and report dates are correct.'],
    ],
  },
  {
    version: '2.1.0',
    date: '2026-10-14',
    title: 'Running in the cloud',
    modules: ['deploy', 'system'],
    summary: 'LTDC ERP can run on an Amazon EC2 server over HTTPS, reachable 24/7 from any browser.',
    changes: [
      ['new', 'deploy', 'Step-by-step Amazon EC2 guide: server, web address (including a free DuckDNS option), HTTPS with automatic certificates, daily snapshots and nightly data backups.'],
      ['new', 'deploy', 'One-command updates on the server that keep the data and back it up first.'],
      ['new', 'system', 'HTTPS-only sign-in cookie for online use, and a command to create the first Administrator before the site goes public.'],
    ],
  },
  {
    version: '2.0.1',
    date: '2026-10-14',
    title: 'Launcher redesign',
    modules: ['system'],
    summary: 'The module launcher now follows the lancastertechdev.com look.',
    changes: [
      ['improved', 'system', 'White Lancaster-style launcher: greeting, module cards with live figures, “Coming soon” modules and an administration band for admins.'],
    ],
  },
  {
    version: '2.0.0',
    date: '2026-10-14',
    title: 'LTDC ERP and IT Asset Management',
    modules: ['system', 'assets'],
    summary: 'The HR system became LTDC ERP, one system with several modules, and gained an IT Asset Management module.',
    changes: [
      ['new', 'system', 'Module launcher after sign-in. Future modules (Finance, Procurement, Projects, CRM, Service Desk, Documents) are shown as coming soon.'],
      ['new', 'assets', 'Asset register with tags, serial numbers, specs, purchase and warranty details, and full history.'],
      ['new', 'assets', 'Assign, transfer and return equipment to employees, departments or locations; mark items in repair, retired or lost.'],
      ['new', 'assets', 'Consumable inventory with stock in, issue and count adjustments, and low-stock alerts.'],
      ['new', 'assets', 'Allocations by holder, activity log, My Assets for employees, and CSV export on every list.'],
      ['new', 'system', 'IT Asset Manager account type; HR can view assets, and employee profiles show their IT equipment.'],
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-13',
    title: 'Payroll Setup, leave and requests',
    modules: ['hr'],
    summary: 'HR and Payroll can adjust payroll rules and leave; employees file leave and remote-work requests online.',
    changes: [
      ['new', 'hr', 'Payroll Setup for HR Managers and Payroll Officers: pay frequency, overtime rates, SSS, PhilHealth and Pag-IBIG rates and tax tables.'],
      ['new', 'hr', 'Leave management: leave types, yearly credits, per-employee adjustments and balances.'],
      ['new', 'hr', 'Leave and remote-work requests filed by employees and approved by the HR Manager or an Administrator; approvals update attendance.'],
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-13',
    title: 'Windows support',
    modules: ['deploy'],
    summary: 'The app runs on Windows by double-clicking, with nothing to install.',
    changes: [
      ['new', 'deploy', 'Portable Windows package with its own copy of Node.js, double-click launchers, a desktop shortcut and an office-network mode.'],
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-13',
    title: 'User access',
    modules: ['system', 'hr'],
    summary: 'A sign-in page and account types control who can see and change what.',
    changes: [
      ['new', 'system', 'Sign-in page and first-run Administrator setup; account types Administrator, HR Manager, Payroll Officer and Employee.'],
      ['new', 'system', 'Users & Access page, password changes, and a 5-minute lock after repeated wrong passwords.'],
      ['new', 'hr', 'Employee self-service: clock in and out, own attendance, payslips and profile.'],
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-12',
    title: 'First release: HR & Payroll',
    modules: ['hr', 'system'],
    summary: 'Employee records, time tracking and Philippine payroll, in the LTDC design.',
    changes: [
      ['new', 'hr', 'Employee records with government IDs, pay rates and work schedules.'],
      ['new', 'hr', 'Time clock and daily time records (DTR) with late, undertime and overtime.'],
      ['new', 'hr', 'Payroll runs with SSS, PhilHealth, Pag-IBIG and withholding tax, plus printable payslips.'],
      ['improved', 'system', 'Look and feel follow the lancastertechdev.com design language.'],
    ],
  },
];

export const APP_VERSION = DEVLOG[0].version;
