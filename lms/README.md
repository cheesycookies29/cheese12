# LTDC LMS

The learning management system of Lancaster Technology and Development Corporation (LTDC), a sibling of [LTDC ERP](../README.md).
It is built the same way as the ERP: one Node.js program with **no dependencies**, a browser app with no build step, and all data in one file, `data/db.json`.
It runs on your own computer for now. It is set up so it can move to AWS later (see [Moving to AWS](#moving-to-aws-later)).

It has two separate sides, each with its **own sign-in**:

| Side | Address | Who signs in |
| --- | --- | --- |
| **Learning portal** | <http://localhost:3100> | Students and teachers |
| **Admin panel** | <http://localhost:3100/admin> | Administrators and registrars |

An account can only sign in on its own side. Signing in to one side does not sign you in to the other.

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

A small window opens and your browser opens the admin panel at <http://localhost:3100/admin>. **Keep that window open** while you use the LMS; close it to stop the LMS.
Double-clicking again while it is running just opens the browser again.

### From the terminal

```bash
cd lms
npm start
```

Open **<http://localhost:3100/admin>**. The first time, it asks you to create the **Administrator** account and name the school.

The ERP runs on port 3000 and the LMS on port 3100, so both can run at the same time. Their sign-in cookies have different names, so signing in to one does not sign you out of the other.

To try it out, open **Demo data & backup → Add demo data** in the admin panel. Then sign in:

| Where | Username | Password | What to try |
| --- | --- | --- | --- |
| Learning portal | `student.demo` | `demo1234` | Enrollment: one section is full (join its waitlist), one needs the key `DB2026`, one is blocked by a prerequisite |
| Learning portal | `teacher.demo` | `demo1234` | IT201 A: lessons, assignments to grade, gradebook, class list |
| Admin panel | `registrar.demo` | `demo1234` | Approve requests, admit 2 applicants, manage the waitlist |

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
| **Modules** | Turn each portal module on or off, separately for **students** and **teachers** |
| **Settings** | School name, passing grade, enrollment rules, student applications |
| **Admins & registrars** | Admin-panel accounts |
| **Demo data & backup** | Add or remove demo data; download or restore a backup |

### Modules for students and teachers

| Module | Students | Teachers |
| --- | --- | --- |
| Enrollment | Browse sections, enroll, join waitlists, drop | Class list and waitlist |
| Class schedule | Weekly timetable | Teaching timetable |
| Lessons & materials | Read lessons, open materials | Write lessons, publish or hide them |
| Announcements | Read | Post |
| Assignments | Hand in work, read feedback | Create, review, score, give feedback |
| Grades | Scores and final grades | Gradebook, post final grades |

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

## For developers

```
lms/
  server.js              HTTP server: static files, /admin, /api, /healthz
  server/api.js          router, the two sign-ins, applications, demo data and backups
  server/enrollment.js   the enrollment rules (evaluate, enroll, waitlist, drop) and their routes
  server/admin.js        admin panel: accounts, applicants, catalog, sections, modules, settings, dashboard
  server/classroom.js    portal: classes, lessons, announcements, assignments, grades, schedule
  server/db.js           JSON-file storage (and an in-memory one for tests)
  server/demo.js         demo data
  shared/roles.js        account types and permissions (server and browser)
  shared/modules.js      the switchable portal modules (server and browser)
  shared/schedule.js     meeting times and clash checks (server and browser)
  public/                portal (index.html, js/portal) and admin panel (admin/index.html, js/admin)
  public/js/shell.js     sign-in screens, menu, router shared by both apps
  test/                  node:test suites
```

- Run the tests with `npm test` (from `lms/`, or from the repository root, which runs the ERP's and the LMS's tests together).
- Every route states who may call it (`'student'`, `'teacher'`, `'portal'`, `'admin:<permission>'`) and, for portal routes, which module it belongs to. The router in `server/api.js` enforces both.
- Styles and UI helpers were copied from the ERP (`public/css/styles.css`, `public/js/ui.js`) so the two look like one family; the LMS's own styles are at the end of the stylesheet.

### Ideas this borrows from

- **Moodle**: the self-enrolment key on a section, enrollment windows and a maximum number of students ([Moodle docs: Self enrolment](https://docs.moodle.org/401/en/Self_enrolment)).
- **Frappe Learning** (`frappe/lms`): courses → lessons, batches (here: sections), assignments graded by instructors.
- **Gibbon**: modules granted per role, here switched on or off for students and teachers.
- **openSIS / Fedena**: the student-information side: admissions applications, programs, terms, student numbers.

### Not included (yet)

Quizzes, file uploads for assignments, attendance, certificates, a term-end "close term" step, class-wide email notifications, an audit log, and SSO with the ERP.

## Moving to AWS later

It already follows the ERP's cloud setup, so the ERP's [EC2 guide](../deploy/aws/EC2.md) applies almost as is (service name `ltdc-lms`, port 3100, start command `node server.js` in `lms/`):

- `COOKIE_SECURE=1` (sign-in cookies over HTTPS only), `ALLOWED_HOSTS=lms.example.com` (the address it is served at), `HOST`, `PORT`, `DB_FILE`.
- `GET /healthz` answers `{ "ok": true }` for a load balancer or uptime check.
- `npm run create-admin -- <username> "<Full Name>"` creates the first administrator from the server, before the site is reachable.
- Serve `/admin` from the same address, or put it behind an extra restriction (e.g. an office IP allow-list on the load balancer path `/admin*` and `/api/admin/*`).

When one server is no longer enough:

| Today | On AWS |
| --- | --- |
| `data/db.json` | Amazon RDS (PostgreSQL): one table per collection in `server/db.js`; every record already has an `id` |
| Sessions in memory | ElastiCache (Redis) or DynamoDB, behind `createSessions()` in `server/auth.js` |
| Links to materials | Amazon S3 for uploaded files, when uploads are added |
| One EC2 instance | Several behind an Application Load Balancer once sessions and data are shared |
