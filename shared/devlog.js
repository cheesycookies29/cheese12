// Dev log: one entry per build, newest first, written by the developer in the
// first person, the way I'd explain it to a colleague.
//
// These are the built-in entries. Each one is copied into the database the first
// time a server runs that build (server/devlog.js); from then on administrators
// can edit or delete it on the Dev log page, and changing it here does not
// overwrite their edits.
//
// When something ships: add an entry at the top and set package.json "version"
// to the same value (a test checks both).
//   version  semver with a stage, e.g. '0.2.4-alpha'
//   modules  hr | assets | system | deploy
//   changes  [type, module, text], type is new | improved | fixed
//   known    issues I know about in this build (optional)

export const DEVLOG_MODULES = {
  hr: 'HR & Payroll',
  assets: 'IT Asset Management',
  system: 'System & access',
  deploy: 'Deployment & hosting',
};

export const CHANGE_TYPES = { new: 'New', improved: 'Improved', fixed: 'Fixed' };

export const DEVLOG = [
  {
    version: '0.2.4-alpha',
    date: '2026-10-15',
    title: 'An editable dev log',
    modules: ['system'],
    notes: 'Until now every note was baked into the code, so fixing a typo meant shipping a build. The log now lives in the database: as an admin I can write a new entry, edit any old one or delete it, right on this page. I also made it clear it is one person writing all of this. It is just me for now, so every entry is in my own voice under one name.',
    changes: [
      ['new', 'system', 'New entry, Edit and Delete on the Dev log page for administrators: version, date, title, a short note, the list of changes and known issues.'],
      ['new', 'system', 'The whole log shows one author. It defaults to the first administrator\'s name and can be changed on the page.'],
      ['improved', 'system', 'Each new build still adds its own entry automatically, but edits and deletions made on the page are kept across updates.'],
      ['improved', 'system', 'All entries rewritten in the first person.'],
    ],
    known: ['Edits are not versioned. If you change an entry, the old wording is gone, except in data backups.'],
  },
  {
    version: '0.2.3-alpha',
    date: '2026-10-15',
    title: 'Dev log, take two',
    modules: ['system'],
    notes: 'The first version of this page read like a press release, and the version numbers made the system look further along than it is. I started over from 0.0.1, since this is still alpha, and rewrote every entry the way I would explain it to a colleague.',
    changes: [
      ['improved', 'system', 'Builds are numbered from 0.0.1-alpha. The old 1.x and 2.x numbers were never meaningful.'],
      ['improved', 'system', 'Each entry now says what I did and why, not just what changed, plus known issues where there are any.'],
    ],
  },
  {
    version: '0.2.2-alpha',
    date: '2026-10-15',
    title: 'Keeping a dev log',
    modules: ['system'],
    notes: 'Updates now go out automatically, so it is easy to lose track of what changed and when. This page is that record. The top panel also shows which build the server is actually running, so you can confirm a deploy landed without opening GitHub.',
    changes: [
      ['new', 'system', 'Dev log under System, for administrators only. You can filter it by module or search it.'],
      ['new', 'system', 'Installed-version panel: build number, exact commit, when it was installed and how long it has been up.'],
      ['new', 'system', 'An unread count on the menu item and on the launcher.'],
    ],
    known: ['The unread count is kept in your browser, so on a different computer everything shows as unread again.'],
  },
  {
    version: '0.2.1-alpha',
    date: '2026-10-15',
    title: 'Deploys without the terminal',
    modules: ['deploy'],
    notes: 'Uploading a zip and SSHing into the server for every update got old fast. Now GitHub runs the tests on each push and, if they pass, asks AWS Systems Manager to install the build. There are no SSH keys or AWS passwords sitting in GitHub. The first run skipped the deploy without saying why, which cost me some head-scratching, so now it tells you exactly which setting is missing.',
    changes: [
      ['new', 'deploy', '"Deploy to EC2" GitHub workflow: test, then install on the server, with a backup taken first.'],
      ['new', 'deploy', 'A CloudFormation template creates the AWS permissions in one go, instead of clicking through IAM by hand.'],
      ['new', 'deploy', 'Every deploy also makes sure the server is on Philippine time and the nightly backup is in place.'],
      ['fixed', 'deploy', 'Deploys were silently skipped when the settings were missing or saved somewhere unexpected. Settings now work from Variables or Secrets, and anything missing is named in the run.'],
    ],
    known: ['GitHub shows a warning that one of the AWS add-ons it uses runs on an older Node.js. Nothing is affected; I will bump it when I am next in there.'],
  },
  {
    version: '0.2.0-alpha',
    date: '2026-10-15',
    title: 'Problem reports',
    modules: ['assets', 'deploy'],
    notes: 'Until now, if a laptop broke, someone had to message IT and hope it did not get buried. Employees can now report it from My Assets, and IT and admins get a proper queue. It is mainly built for laptops, but it works for anything assigned to a person. I also found the cloud server was running on UTC, eight hours behind, which would have messed up clock-ins, so I fixed that too.',
    changes: [
      ['new', 'assets', '"Report a problem" on each item in My Assets: what is wrong, whether you can still work, when you noticed it and a description.'],
      ['new', 'assets', 'Problem reports page for IT and admins, with a count of new ones in the menu, filters and CSV export. HR can look but not change anything.'],
      ['new', 'assets', 'Reports move from New to Being checked to Resolved or Closed, and IT can leave notes the employee sees in My Assets.'],
      ['improved', 'assets', 'Open reports show on the IT overview, on the asset page and history, and on the launcher.'],
      ['fixed', 'assets', 'Two history entries saved in the same millisecond could show in the wrong order. They are now always newest first.'],
      ['fixed', 'deploy', 'The server clock is set to Asia/Manila, so attendance and report dates are no longer 8 hours off.'],
    ],
    known: ['No photo attachments on reports yet.', 'IT is not emailed when a report comes in; they see it in the app.'],
  },
  {
    version: '0.1.2-alpha',
    date: '2026-10-14',
    title: 'Moving to the cloud',
    modules: ['deploy', 'system'],
    notes: 'Running on one laptop meant nobody could clock in when that laptop was off. I wrote up a full EC2 setup with HTTPS, backups and snapshots. It started as a Lightsail guide, but I switched to EC2 to use the AWS credits. Updates went from "copy a folder by hand" to one command.',
    changes: [
      ['new', 'deploy', 'EC2 setup guide covering the server, web address (with a free DuckDNS fallback), automatic HTTPS, daily snapshots and nightly data backups.'],
      ['new', 'deploy', 'One-command update script that backs up the data before touching anything.'],
      ['new', 'system', 'The sign-in cookie can be locked to HTTPS for online use, and the first admin can be created from the server before the site goes public.'],
    ],
    known: ['Updating still needs a terminal (fixed in 0.2.1).'],
  },
  {
    version: '0.1.1-alpha',
    date: '2026-10-14',
    title: 'Launcher redesign',
    modules: ['system'],
    notes: 'The first launcher had a dark, industrial look that did not feel like Lancaster. I redid it to match lancastertechdev.com: white, maroon and gold, and simpler.',
    changes: [
      ['improved', 'system', 'New launcher with a greeting, module cards showing live numbers, the coming-soon modules and an admin band.'],
    ],
  },
  {
    version: '0.1.0-alpha',
    date: '2026-10-14',
    title: 'From HR app to ERP',
    modules: ['system', 'assets'],
    notes: 'The biggest change so far. The HR app became one module of LTDC ERP, and IT gets its own module to track who has which laptop, what is in the store room, and when warranties run out. The launcher already has spots for the modules I will build next, greyed out for now.',
    changes: [
      ['new', 'system', 'Module launcher after sign-in. Finance, Procurement, Projects, CRM, Service Desk and Documents are listed as coming soon.'],
      ['new', 'assets', 'Asset register with tags, serial numbers, specs, purchase and warranty details, and a full history per item.'],
      ['new', 'assets', 'Assign, transfer and return equipment to a person, a department or a location. Items can be marked in repair, retired or lost.'],
      ['new', 'assets', 'Inventory for consumables like cables, ink and RAM, with stock in, issue and counts, and a heads-up when stock runs low.'],
      ['new', 'assets', 'Allocations view, activity log, My Assets for employees, and a CSV export on every list.'],
      ['new', 'system', 'New IT Asset Manager account type. HR can view assets, and employee profiles list their equipment, which helps when someone resigns.'],
    ],
  },
  {
    version: '0.0.5-alpha',
    date: '2026-10-13',
    title: 'Payroll setup, leave and requests',
    modules: ['hr'],
    notes: 'Contribution rates and tax tables were hard-coded. That works until the government changes them, which it does. HR and Payroll can now edit them. I also added leave, and moved leave and work-from-home requests out of chat threads into the system.',
    changes: [
      ['new', 'hr', 'Payroll Setup: pay frequency, overtime rates, and SSS, PhilHealth and Pag-IBIG rates and tax tables, all editable.'],
      ['new', 'hr', 'Leave types, yearly credits, per-person adjustments and running balances.'],
      ['new', 'hr', 'Employees file leave or remote-work requests. The HR Manager or an admin approves them, and approved days go straight into attendance.'],
    ],
    known: ['Approval is one step. Either the HR Manager or an admin can approve; a two-level option is still on the list.'],
  },
  {
    version: '0.0.4-alpha',
    date: '2026-10-13',
    title: 'Windows build',
    modules: ['deploy'],
    notes: 'Most of the office is on Windows. I bundled Node.js into the package so nobody has to install anything: unzip it and double-click.',
    changes: [
      ['new', 'deploy', 'Portable Windows package with double-click launchers, an optional desktop shortcut, and an office-network mode so other PCs can connect.'],
    ],
    known: ['The .bat launchers were built on a Mac and have not been tried on a real Windows PC yet.'],
  },
  {
    version: '0.0.3-alpha',
    date: '2026-10-13',
    title: 'Sign-in and roles',
    modules: ['system', 'hr'],
    notes: 'Up to here anyone who opened the page could see everyone\'s salary. Now there is a login, and each account type only sees what it needs to.',
    changes: [
      ['new', 'system', 'Sign-in page and first-run admin setup, with Administrator, HR Manager, Payroll Officer and Employee accounts.'],
      ['new', 'system', 'Users & Access page, password changes, and a 5-minute lockout after five wrong passwords.'],
      ['new', 'hr', 'Self-service for employees: clock in and out, and see their own attendance, payslips and profile.'],
    ],
    known: ['There is no "forgot password" email yet. An admin resets passwords.'],
  },
  {
    version: '0.0.2-alpha',
    date: '2026-10-12',
    title: 'Making it look like Lancaster',
    modules: ['system'],
    notes: 'The first build worked but looked generic. I reskinned it to match lancastertechdev.com: the maroon and gold, Big Shoulders headings and the logo.',
    changes: [
      ['improved', 'system', 'New look and feel across every screen, following the company website.'],
    ],
  },
  {
    version: '0.0.1-alpha',
    date: '2026-10-12',
    title: 'First build',
    modules: ['hr'],
    notes: 'Where it all started: a small HR app in the spirit of Sprout, running on one MacBook. Employee records, a time clock and Philippine payroll. Rough around the edges, but it gets from a time record to a payslip.',
    changes: [
      ['new', 'hr', 'Employee records with SSS, PhilHealth, Pag-IBIG and TIN numbers, pay rates and schedules.'],
      ['new', 'hr', 'Time clock and daily time records, with late, undertime and overtime worked out automatically.'],
      ['new', 'hr', 'Payroll runs with SSS, PhilHealth, Pag-IBIG and withholding tax, and printable payslips.'],
    ],
    known: ['Not handled yet: holiday pay, night differential, 13th month pay, loans and BIR 2316.'],
  },
];

export const APP_VERSION = DEVLOG[0].version;

// Compare 'x.y.z' or 'x.y.z-stage' versions by their numbers.
export function compareVersions(a, b) {
  const nums = (v) => v.split('-')[0].split('.').map(Number);
  const [x, y] = [nums(a), nums(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
