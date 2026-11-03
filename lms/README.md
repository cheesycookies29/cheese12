# LTDC LMS

The learning management system of Lancaster Technology and Development Corporation (LTDC), a sibling of [LTDC ERP](../README.md).
It is built the same way as the ERP: one Node.js program with **no dependencies**, a browser app with no build step, and all data in one file, `data/db.json`.
It runs on your own computer for now. It is set up so it can move to AWS later (see [Putting it online](#putting-it-online-aws)).

Everyone starts at the **University Portal**, the school's single front door to its four systems:

| Address | What it is |
| --- | --- |
| <http://localhost:3100> | **University Portal**: one sign-in for students, faculty and staff, then a tile for each system they may use (HRIS, FMIS, UIS, LMS), with school announcements and events |
| <http://localhost:3100/lms/> | **LMS** for students and teachers |
| <http://localhost:3100/admin> | **LMS admin panel** for administrators and registrars (it also keeps its own sign-in page) |
| <http://localhost:3100/hris/> | **HRIS** for every employee (self-service) and for HR and payroll staff |

The **LMS** and the **HRIS** are live. **FMIS** and **UIS** show greyed out as *Coming soon* until an administrator switches them on under **Admin panel → Portal & systems** with the address each one runs at. Students do not see the HRIS tile.

### Campuses

A school can have several campuses (e.g. Pili, Sipocot, Pasacao, Calabanga). Every campus has the **same features**, catalog (programs and courses), terms, modules, grading and branding; each has **its own** students, teachers, registrars, sections (with their enrollments and class content), news and events.

- **Switch campus** from your name at the top right (as in the current LMS). The choice is remembered; every list follows it: dashboard, students, teachers, sections, enrollment requests, news and events. The current campus shows in the top bar.
- **Administrators** reach every campus. **Registrars** and **teachers** work at the campuses ticked on their account (a teacher at two campuses switches to see each one's classes). **Students** belong to one campus, see only its sections and cannot request another campus's (the registrar can override for a cross-campus enrollee).
- **Admin panel → Campuses** adds, renames and removes campuses. News and events are for one campus, or (administrators only) for every campus.
- Data from before campuses moves into a "Main Campus" automatically; rename it under Campuses. The first-run setup asks for the campus name.

Signing in at the portal opens the right side for the account (students and teachers: the LMS; administrators and registrars: the admin panel; HR and staff accounts: the HRIS), so opening a system from its tile needs no second sign-in. Every page has an **All systems** button back to the portal, and **Sign out** anywhere signs out of everything.

## Run it

You need Node.js 18 or newer (the same one the ERP uses). If you don't have it, download the **LTS** installer from <https://nodejs.org> and run it (one time only).

### Without the terminal: double-click

Open the `lms` folder and double-click:

- **Windows:** `Start LMS (Windows).bat`. If Windows shows "Windows protected your PC", click **More info → Run anyway**.
- **Mac:** `Start LMS (Mac).command`. If macOS says it **could not verify** the file (it does this for files downloaded in a browser, e.g. GitHub's *Download ZIP*), allow it once:
  1. Click **Done** on the warning (not *Move to Trash*).
  2. Open **System Settings → Privacy & Security**, scroll down to **Security**, and click **Open Anyway** next to *"Start LMS (Mac).command" was blocked*. The button shows for about an hour after the blocked attempt.
  3. Enter your Mac password and click **Open Anyway**.

  After that it opens with a double-click. Getting the code with **GitHub Desktop** (cloning) instead of *Download ZIP* avoids the warning altogether.

A small window opens and your browser opens the University Portal at <http://localhost:3100>. **Keep that window open** while you use the LMS; close it to stop the LMS.
Double-clicking again while it is running just opens the browser again.

### From the terminal

```bash
cd lms
npm start
```

Open **<http://localhost:3100>**. The first time, it points you to the admin panel to create the **Administrator** account and name the school.

The ERP runs on port 3000 and the LMS on port 3100, so both can run at the same time. Their sign-in cookies have different names, so signing in to one does not sign you out of the other.

To try it out, open **Demo data & backup → Add demo data** in the admin panel. Then sign in:

| Where | Username | Password | What to try |
| --- | --- | --- | --- |
| University Portal | `student.demo` | `demo1234` | Home To-do; take *Quiz 1* in IT201 A (timed, 2 attempts); resources with a PDF preview; attendance; news. Enrollment: one section is full (join its waitlist), one needs the key `DB2026`, one is blocked by a prerequisite |
| University Portal | `teacher.demo` | `demo1234` | IT201 A: quiz results and essays to score, work to grade, take attendance, gradebook, build a new quiz |
| University Portal or admin panel | `registrar.demo` | `demo1234` | Approve requests, admit 2 applicants, manage the waitlist |
| University Portal → HRIS | `hr.demo` | `demo1234` | HR dashboard; approve the pending leave (one sick leave has a medical certificate attached); employee records and sign-in accounts; attendance; switch to Sipocot campus |
| University Portal → HRIS | `payroll.demo` | `demo1234` | Two finalized payroll runs with printable payslips; payroll setup (rates and tax tables with a "try it" calculator) |
| University Portal → HRIS | `staff.demo` | `demo1234` | A librarian's self-service: clock in, file leave, payslips. `teacher.demo` has the same in the HRIS tile |

The demo school has 5 programs (IT, Computer Science, Business, Agriculture, Education), 8 teachers, about 60 students with past grades, 5 applicants, 21 courses and 25 sections this term. Every class has lessons, announcements, a course outline (PDF), graded work, a quiz most students have taken and a few weeks of attendance; there are also school news posts with reactions and comments, and upcoming events. Other teacher accounts: `lmercado.demo`, `gaquino.demo`, `rvillareal.demo` (Agriculture), `lgonzales.demo` (Business), `mtorres.demo` (Education), `jdelacruz.demo`, `aramos.demo`. It's the same school every time it is added. The demo school is at your first campus, and three smaller demo campuses (Sipocot, Pasacao, Calabanga) are added beside it, each with its own teachers, students and classes. `teacher.demo` also teaches a Friday class at Sipocot, and `registrar.demo` works at both, so both can try switching campus.
For the HRIS, every demo teacher and the registrar have an employee record linked to their account, with non-teaching staff beside them (guidance, nurse, ICT, guards, utility), six weeks of attendance, leave requests in every state and two finalized payroll runs.

Demo records are added **next to your own data** and **Remove demo data** takes them out again without changing your records. If you already have a current term, it stays current and the demo term is listed beside it.

Other settings: `PORT=3101 npm start` (another port), `HOST=0.0.0.0 npm start` (let other computers on your network open it), `DB_FILE=/path/db.json` (another data file).

## Admin panel

| Page | What it does |
| --- | --- |
| **Dashboard** | Current term and its enrollment window, pending requests, waitlists, applicants, fullest sections, recent activity |
| **Enrollment requests** | Approve or reject pending requests; *Enroll over capacity* or reject waitlisted ones; drop enrolled students; add a student to a section; every step's history |
| **Applicants** | People who applied from the portal. *Admit* gives them a student number (e.g. `2026-0001`) and lets them sign in; *Decline* keeps a reason on record |
| **Students / Teachers** | Accounts, with each student's full enrollment record and grades and each teacher's sections |
| **Sections** | A course offered in a term: teacher, days and times, room, capacity, enrollment key, status (open, closed, cancelled). Shows enrolled, pending, waitlist (in order) and past students |
| **Courses** | The catalog: code, title, units, description, prerequisites, programs |
| **Terms** | Class dates, the enrollment window, the drop deadline, and which term is current |
| **Programs** | e.g. BS Information Technology |
| **News & events** | School-wide posts (pin, turn comments off, remove comments) and events, shown on everyone's home page |
| **Modules** | Turn each portal module on or off, separately for **students** and **teachers** |
| **Activity types & grading** | Types teachers pick for each activity (Assignment, Short Quiz, Long Quiz, Examination… add your own) and how much each counts in the running grade |
| **Settings & branding** | School name, passing grade, enrollment rules, student applications; the school's **colour** (presets or its own) and **logo**, and the sign-in headline |
| **Admins & registrars** | Admin-panel accounts |
| **Demo data & backup** | Add or remove demo data; download or restore a backup. The backup file holds the records; uploaded files are in `data/files/`, so to keep everything, copy the whole `data` folder |

### Modules for students and teachers

| Module | Students | Teachers |
| --- | --- | --- |
| Enrollment | Browse sections, enroll, join waitlists, drop | Class list and waitlist |
| Class schedule | Weekly timetable | Teaching timetable |
| Lessons & materials | Read lessons, open materials | Write lessons, publish or hide them |
| Announcements | Read | Post |
| Resources | Open and download files and links, with a preview (PDF, images, video, YouTube) | Upload files (up to 10 MB each, drag and drop) and add links; hide or show them |
| Activities & quizzes | Hand in work (text, a file, a link); take quizzes and exams with a timer; see scores, feedback and (when released) the answers | Create assignments, quizzes and exams; grade one student after another; score essays; results per question |
| Attendance | Their attendance and rate per class | Take attendance (present, late, absent, excused), monthly grid, CSV export |
| Grades | Running grade, scores and final grades | Gradebook (weighted by activity type), CSV export, post final grades |
| News & events | Read school news, react and comment; upcoming events | The same |

A module that is off disappears from that account type's menu, **and the server refuses it** (it is not only hidden). Turning a module off never deletes anything.
For example, switch *Enrollment* off for students outside enrollment season so only the registrar can add or drop classes.

### Account types

| Account type | Signs in on | Can do |
| --- | --- | --- |
| **Administrator** | Admin panel | Everything, including modules, settings, admin accounts, demo data and backups |
| **Registrar** | Admin panel | Enrollment requests, applicants, students, the catalog (courses, sections, terms, programs); can view teachers |
| **Teacher** | Portal | The sections assigned to them, as far as the modules allow |
| **Student** | Portal | Enrollment and their classes, as far as the modules allow |

Passwords and sign-in work as in the ERP: temporary passwords must be changed at first sign-in, 5 wrong passwords lock the username for 5 minutes, and people are signed out after 8 idle hours or when the app restarts.
Locked-out administrator? Stop the app and run `npm run reset-password -- <username> <new-password>`.

## HRIS

The Human Resource Information System, built from the [Lancaster ERP's HR & Payroll](../README.md) module: the same time, leave, pay, contribution and tax rules (`shared/calc.js` and `shared/leave.js` are the ERP's files; a test checks the two stay identical), reworked for a school with campuses.

**Everyone with an employee record** (teachers, registrars, staff) gets **self-service** in the HRIS with the sign-in they already have:

- **My day**: a time clock (clock in and out), today's status and this pay period's hours, late, undertime and overtime.
- **My attendance**: the daily time record (DTR).
- **Leave & requests**: balances per leave type; file leave or remote work (with a medical certificate for sick leave of more than 3 days); withdraw a pending request.
- **My payslips**: finalized payslips, printable or saved as PDF. **My profile**.

**HR screens**, for HR managers, payroll officers and administrators, always for the campus they are looking at:

| Screen | What it does |
| --- | --- |
| HR dashboard | Headcount (teaching and non-teaching), who is in today and who has no record yet, requests to review, leave in the next two weeks, departments, employment status, birthdays, the latest payroll |
| Employees | Records (personal, employment, pay, schedule, government IDs, bank), CSV export, and the **sign-in account**: link a teacher's or registrar's LMS account, or create an HRIS account (Staff, HR Manager, Payroll Officer); reset its password or disable it |
| Attendance (DTR) | Every record with late, undertime and overtime; add or correct records; approve overtime; CSV export |
| Leave & approvals | Approve, reject or cancel requests (approval writes the days into the DTR; HR cannot approve their own); leave balances per person; one employee's leave (credits, access to a leave type, adjustments with a reason, leave recorded on paper); leave types (gender rules, medical certificate rules) |
| Payroll | A run per pay period and campus (semi-monthly or monthly): the payroll register, adjustments (other earnings and deductions), recompute, finalize; payslips with SSS, PhilHealth, Pag-IBIG and BIR withholding tax; register export |
| Payroll setup | Pay rules, which deductions to compute, government rates and tax tables, with a calculator to try them |
| HR settings | The employer's address and TIN on payslips, and the default work schedule |

### HRIS account types

| Account type | Signs in on | Can do in the HRIS |
| --- | --- | --- |
| **HR Manager** | University Portal | Employees and their accounts, attendance, leave approvals and credits, view payroll, HR settings |
| **Payroll Officer** | University Portal | Payroll runs and payroll setup; views employees, attendance and leave |
| **Staff** | University Portal | Self-service only (a non-teaching employee) |
| Administrator | (any) | Everything, at every campus |
| Teacher, Registrar | (their own) | Self-service, once HR links their account to their employee record |

The first HR manager is made by an administrator: open the HRIS from the portal, add the HR manager's employee record, then **Sign-in account → Create an HRIS account** with the type *HR Manager*. HR accounts work at the campus of their record; an administrator can add campuses to them in the LMS admin panel. Students have no HRIS.

## How enrollment works

A student picks a section under **Enrollment → Open sections**. The request is checked in this order:

1. The section is open, and the term's **enrollment window** is open today.
2. The **enrollment key** matches, if the section has one.
3. The student is not already enrolled, pending or waitlisted in **the same course** this term.
4. The student has not **already passed** the course.
5. Every **prerequisite** has been passed (a final grade at or above the passing grade, 75 by default).
6. The **unit limit** for the term is not exceeded (24 by default; enrolled + pending + waitlisted).
7. There is **no schedule conflict** with the student's other classes (back-to-back classes are fine).
8. A seat is free → **Pending approval** (or **Enrolled** straight away when approval is switched off).
   No seat → **Waitlisted**, if waitlists are on and the waitlist is not full; otherwise refused.

The catalog shows, for every section, whether the student can take it and **why not** (e.g. "IT202 requires IT201 first").

- **Waitlist:** when a seat frees up (a drop, a rejection, a cancelled request, or the registrar raising the capacity), the first student in line moves up automatically.
- **Dropping:** students can withdraw pending or waitlisted requests at any time, and drop enrolled classes until the term's drop deadline. After that, the registrar drops them.
- **Registrar:** adds students regardless of the window and key; with *Override the rules* also past prerequisites, the unit limit, conflicts and a full section. Can enroll a waitlisted student over capacity.
- **Cancelling a section** drops everyone in it. A teacher cannot be given two sections that meet at the same time.
- **Completing:** when a teacher posts a final grade, the enrollment becomes *Completed* (passed or failed), which is what prerequisites look at.
- Every enrollment keeps its **history**: each status, who changed it, when, and the note.

**Student applications** (Settings → Student applications): when on, the portal's sign-in page shows *Apply as a student*. Applicants choose a username and password, appear under **Applicants**, and can sign in once admitted.

## Quizzes and exams

- **Question types:** one answer, several answers (partial credit: each right pick adds, each wrong pick takes away), true or false, short answer (several accepted answers; capitals and spaces ignored) and essay (scored by the teacher).
- **Settings per quiz:** opening and closing time, time limit, number of attempts (the highest score counts), shuffled question order, and when students see the correct answers (right after submitting, after the quiz closes, or never).
- **Fair timing:** the server sets each attempt's deadline when it starts (the time limit, or the closing time if sooner) and refuses answers after it. Answers save as the student goes; when time runs out the quiz submits itself, even if the student closed the page. Students never receive the answer key before results are released.
- **Results:** average, highest and lowest; each student's best attempt; how each question went (questions most of the class missed are shown in red); essays waiting to be scored.

## Grading

Each activity has a type with a weight (Settings: **Activity types & grading**). The running grade combines each type's percentage by its weight, leaving out types with no scored work yet. Example with assignments 30%, quizzes 20%, exams 50%: a student with 80% on assignments and 90% on quizzes and no exam yet has (80×30 + 90×20) ÷ 50 = 84%. Set every weight to 0 to count every point the same. Teachers post final grades (they can fill them from the running grade); a final grade at or above the passing grade completes the class and counts for prerequisites.

## Look and feel

The layout follows the school's current LMS (top bar with the seal and the current term, a sidebar with icons, breadcrumbs, a class header with the teacher, tabs for each part of a class) with one brand colour throughout, chosen under **Settings & branding**, and the school's own logo. Everyone can switch to **dark mode** (moon button; remembered per browser), and the sidebar folds to icons. On phones the sidebar becomes a drawer and tables become cards. A comparison with the current LMS and other open-source LMSes is in [docs/BENCHMARK.md](docs/BENCHMARK.md).

## For developers

```
lms/
  server.js              HTTP server: the portal (/), the LMS (/lms/), the admin panel (/admin), /api, /healthz
  server/api.js          router, the two sign-ins, applications, demo data and backups
  server/enrollment.js   the enrollment rules (evaluate, enroll, waitlist, drop) and their routes
  server/admin.js        admin panel: accounts, applicants, catalog, sections, modules, settings, dashboard
  server/classroom.js    portal: classes, lessons, announcements, activities, grades, schedule, home
  server/quiz.js         quiz questions, attempts, deadlines, automatic grading, results
  server/attendance.js   attendance per class and date
  server/files.js        uploaded files (data/files/) and class resources
  server/news.js         school news (reactions, comments) and events
  server/db.js           JSON-file storage (and an in-memory one for tests)
  server/campus.js       campuses: who can reach which campus, the active campus
  server/demo.js         demo data
  server/hris.js         HRIS: employees and their accounts, DTR and time clock, payroll, dashboard, self-service
  server/hris-leave.js   HRIS: leave types, credits, balances, requests and approval (from the ERP)
  server/hris-demo.js    HRIS demo data
  shared/calc.js         time and payroll rules (the ERP's file): DTR, payslips, SSS, PhilHealth, Pag-IBIG, tax
  shared/leave.js        leave rules (the ERP's file)
  shared/roles.js        account types and permissions (server and browser)
  shared/modules.js      the switchable portal modules (server and browser)
  shared/schedule.js     meeting times and clash checks (server and browser)
  shared/themes.js       brand colour presets
  shared/systems.js      the systems on the University Portal (HRIS, FMIS, UIS, LMS) and who sees each
  public/                University Portal (index.html, js/hub), LMS (lms/index.html, js/portal), admin panel (admin/index.html, js/admin), HRIS (hris/index.html, js/hris, css/hris.css)
  public/js/shell.js     branding, dark mode, sign-in screens, top bar, sidebar, router (all the apps)
  public/js/icons.js     the icon set
  test/                  node:test suites
```

- Run the tests with `npm test` (from `lms/`, or from the repository root, which runs the ERP's and the LMS's tests together).
- Every route states who may call it (`'student'`, `'teacher'`, `'portal'`, `'admin:<permission>'`, `'hris:<permission>'`) and, for portal routes, which module it belongs to. The router in `server/api.js` enforces both.
- Three session cookies: the portal's (students, teachers), the admin panel's (administrators, registrars) and the HRIS's (HR and staff accounts). HRIS routes accept whichever of them the browser has; signing in on the University Portal ends the others, so a browser is one person at a time.
- `public/css/styles.css` is built on colour tokens: `--brand` and `--accent` come from the branding settings and every shade is mixed from them, with a dark set under `[data-theme=dark]`.

### Ideas this borrows from

- **Moodle**: the self-enrolment key on a section, enrollment windows and a maximum number of students ([Moodle docs: Self enrolment](https://docs.moodle.org/401/en/Self_enrolment)).
- **Frappe Learning** (`frappe/lms`): courses → lessons, batches (here: sections), assignments graded by instructors.
- **Gibbon**: modules granted per role, here switched on or off for students and teachers.
- **openSIS / Fedena**: the student-information side: admissions applications, programs, terms, student numbers.

### Not included (yet)

In the HRIS: a shared clock-in kiosk, clock-in location (both in the ERP), holidays and holiday pay, 13th-month pay, loans, and DepEd/CHED leave rules for teachers (proportional vacation pay). Elsewhere: guardian accounts, messages/chat, single sign-on (Keycloak/OIDC), question banks, copying lessons and activities between sections, certificates, a term-end "close term" step, email notifications and an audit log. See the roadmap in [docs/BENCHMARK.md](docs/BENCHMARK.md).

## Putting it online (AWS)

Follow **[deploy/aws/EC2.md](deploy/aws/EC2.md)**: one CloudFormation template (`deploy/aws/lms-ec2.yaml`) builds an EC2 server in a few clicks, with HTTPS at a DuckDNS address, a fixed IP, nightly backups, daily disk snapshots, security updates and automatic updates from this branch (installed only if the tests pass on the server, rolled back if they don't start). A **setup code** chosen in the template protects the first administrator account.

The app reads these settings (all set by the template): `COOKIE_SECURE=1`, `ALLOWED_HOSTS` (the site's address), `HOST`, `PORT`, `DB_FILE`, `SETUP_CODE`. `GET /healthz` answers `{ "ok": true }`.

When one server is no longer enough:

| Today | On AWS |
| --- | --- |
| `data/db.json` | Amazon RDS (PostgreSQL): one table per collection in `server/db.js`; every record already has an `id` |
| Sessions in memory | ElastiCache (Redis) or DynamoDB, behind `createSessions()` in `server/auth.js` |
| Uploaded files in `data/files/` | Amazon S3, behind `createFileStore()` in `server/files.js` |
| One EC2 instance | Several behind an Application Load Balancer once sessions and data are shared |
