---
id: admin
title: Running ATLAS: the Admin panel
summary: Set up and look after ATLAS as an administrator: accounts, campuses, the catalog, modules, settings in every system, roles and permissions, single sign-on, demo data, backups and the guides.
roles: admin
apps: admin, home
order: 80
---

## Before you start

The **Admin panel** is the school side of ATLAS Learn. Administrators and registrars use it; deans work in ATLAS Academic instead. An **Administrator** can do everything in it. A **Registrar** uses most of the same pages: they can change enrollment, students, applicants, parents & guardians, the catalog and news, see teachers, and see the **Configuration** pages read-only. **Settings center**, **Single sign-on**, **Admins, registrars & deans**, **Roles & permissions** and **Demo data & backup** are for administrators only (an administrator can give registrars more under **Roles & permissions**). Day-to-day enrollment (approving requests, waitlists, adding and dropping students) is explained in [the registrar's guide](registrar).

To open it:

1. Sign in on the ATLAS home page.
2. On the **Learn** tile, choose **Open the admin panel**.

The admin panel also has its own sign-in page at `/admin`, for administrators and registrars.

On a new server, the first person to open ATLAS creates the first administrator (see [Set up ATLAS the first time](#set-up-atlas-the-first-time)). With the demo school, sign in as `admin` with the password `password123`.

Most lists in the admin panel show **one campus at a time**: the campus shown under your name. Administrators can reach every campus and switch from the menu under their name.

## Walkthrough

This tour uses the demo school, signed in as `admin`.

1. On the ATLAS home page, choose **Open the admin panel** on the Learn tile. The **Dashboard** opens.

![The Dashboard: enrollment numbers, the fullest sections and recent activity](admin-dashboard.jpg)

2. Read the line under **Dashboard**: the campus, the current term, whether enrollment is open and the class dates. The boxes count requests **Pending approval**, **Waitlisted** students, **Applicants** and more. Choose any box to open the list behind it.
3. In the sidebar, choose **Admins, registrars & deans**. This is where accounts that use the admin panel and Academic are made.

![Admins, registrars & deans](admin-staff.jpg)

4. Choose **Campuses**. The demo school has a main campus and three smaller ones. On **Sipocot Campus**, choose **Switch to it**. The page reloads; the campus under your name and on the Dashboard is now Sipocot. Switch back to **Main Campus** the same way.

![Campuses, with their students, teachers and sections](admin-campuses.jpg)

5. Choose **Modules**. Each row is a part of Learn; each column is who gets it. Leave everything on for now.

![Modules for students, teachers and parents & guardians](admin-modules.jpg)

6. Choose **Settings & branding**. Look at the school name, the current term, the enrollment rules and the colour themes. Do not save anything yet.
7. Choose **Settings center**. Every setting of every system is listed here by module. Type *password* in **Find a setting**: the sign-in rules appear, each with its value now and its default.
8. Choose **Demo data & backup**. This is where the demo school is added and removed, and where backups are made.

## How to…

### Set up ATLAS the first time

1. Open the ATLAS home page on the new server. It says **Not set up yet**; choose **Set up in the admin panel**.
2. If the server asks for a **Setup code**, type the code chosen when the server was created.
3. Type the **School name**, the **Campus name**, **Your full name**, a **Username** and a password (at least 8 characters), twice.
4. Choose **Create account and sign in**.

The Dashboard opens with a *Getting started* note. Add a term, courses and sections, then students and teachers. To look around first, add the demo data (see [Add or remove the demo school](#add-or-remove-the-demo-school)).

### Add an administrator, registrar or dean

1. Choose **Admins, registrars & deans → + Add account**.
2. Choose the **Account type**: Registrar, Dean / Program chair or Administrator.
3. Fill in the **Full name**, **Username** (3 to 40 lowercase letters, numbers, dots, dashes or underscores) and **Email**.
4. When the school has more than one campus, tick the campuses under **Works at**. Administrators always reach every campus.
5. Type a **Temporary password** (at least 8 characters). Leave **Ask them to choose their own password when they first sign in** ticked.
6. Choose **Save**, and give the person their username and temporary password.

The list shows each account's type, status and last sign-in, with **Edit**, **Reset password** and **Delete**.

Accounts for HR managers, payroll officers and other staff are not made here: HR makes them in ATLAS People, on the employee's record (see [the HR guide](hr)). Accounts for the finance offices are made by an administrator in **ATLAS Finance → Control panel**.

### Add a teacher or a student

1. Choose **Teachers → + Add teacher**, or **Students → + Add student**.
2. Fill in the name, username and email. For a teacher, add the **Department** and **Employee number**. For a student, choose the **Program** and **Year level**; leave **Student number** blank to number them automatically.
3. Choose the campus (students belong to one campus; teachers can work at several).
4. Type a **Temporary password** and choose **Save**.

The person's record opens. Teachers and students sign in on the ATLAS home page.

### Reset a password or disable an account

1. Open the account: from **Students** or **Teachers**, choose the row; for an administrator, registrar or dean, use the buttons on **Admins, registrars & deans**.
2. To reset: choose **Reset password**, type a **New temporary password** and choose **Reset password**. The person is signed out everywhere and must choose their own password at the next sign-in.
3. To disable: choose **Edit**, set **Status** to **Disabled (cannot sign in)** and choose **Save**. The person is signed out at once. Set it back to **Active** to let them in again.

Students and teachers have no **Delete** button: disable their accounts instead, so their records stay. Only accounts on **Admins, registrars & deans** can be deleted.

### Admit or decline applicants

1. Choose **Applicants**. The sidebar badge counts the applications waiting.
2. To admit, choose **Admit**, check the **Program**, and choose **Admit**. The student gets a student number and can sign in at once.
3. To decline, choose **Decline**, type a **Reason (kept on record)** and choose **Decline**.

People can apply only while **Let people apply from the sign-in page** is ticked under **Settings & branding → Student applications**.

### Add a parent or guardian

1. Choose **Parents & guardians → Add parent or guardian**.
2. Choose the **Student** and the **Relationship**.
3. Fill in the name, username, email or mobile number, and a **Temporary password**.
4. Under **What they can see**, tick what this person may see of this student: **Enrollment**, **Class schedule**, **Grades**, **Attendance**, **Activities & quizzes**.
5. Choose **Add and link**.

On the parent's page, **Link a student** adds another student (for example, a sibling), each with its own choices. **Change** edits a link, or pauses it (**Paused: they see nothing for now**); **Unlink** removes it and keeps the account. The same can be done from the **Parents & guardians** card on a student's record.

### Add a campus

1. Choose **Campuses → Add campus**.
2. Type the **Name**, a **Short code** and the **Address**, then choose **Save**.
3. Choose **Switch to it** on the new campus, then add its people and sections.

Every campus shares the catalog, terms and settings; each has its own students, teachers, registrars, sections, news and events. Only an empty campus can be removed (**Remove**), and the school always keeps at least one.

### Set up programs, courses, terms and sections

Programs, courses and terms have an **+ Add** button, and **Edit** and **Delete** on every row. A section is edited or deleted from its own page (choose its row, then **Edit section** or **Delete**).

1. **Programs → + Add program**: a **Code** (e.g. BSIT) and **Name**.
2. **Courses → + Add course**: the **Code**, **Title**, **Units**, **Prerequisites (must be passed first)** and the programs that take it.
3. **Terms → + Add term**: the name, the enrollment window, the **Drop deadline**, the class dates, and **Current term**.
4. **Sections → + Add section**: the course, section name, term, **Capacity**, **Teacher**, room, days and times, and optionally an **Enrollment key**.

A course or term that has sections cannot be deleted: set the course to **Retired (no new sections)** or the term to **Archived (hidden from students)**. A section with enrollment records cannot be deleted; set it to **Cancelled (drops everyone)**. See [the registrar's guide](registrar) for the rest.

### Switch a module on or off

1. Choose **Modules**.
2. Use the switch in the **Students**, **Teachers** or **Parents & guardians** column of a module. It changes at once and ATLAS confirms, e.g. *Enrollment is now off for students.*

A module that is off disappears from those people's menu, and ATLAS refuses it. Nothing is deleted; switching it back on shows everything again.

### Set activity types and grade weights

1. Choose **Activity types & grading**.
2. Rename a type, change its **Weight %**, or switch it off. **Add a type** adds one; the bin removes a type nobody has used yet.
3. Make the weights add up to 100%, or set them all to 0 to count every point the same.
4. Choose **Save**.

Teachers pick a type for each assignment, quiz or exam. A type that is in use cannot be removed; switch it off instead. A type that is off is no longer offered for new work, but work already given that type still counts by its weight; set its weight to 0 to stop that.

### Change school settings and branding

1. Choose **Settings & branding**.
2. Under **School**: the **School name**, the **Current term** and the **Passing grade (%)**.
3. Under **Enrollment rules**: **Requests need approval**, **Waitlists**, **Waitlist size per section** and **Maximum units per term** (0 means no limit).
4. Under **Branding**: choose a colour theme or **School colour**, **Upload logo** (PNG, JPEG or WebP, under 300 KB; it replaces the ATLAS mark in the round seal on the sign-in pages), and the **Sign-in headline** (an optional line under the school name on the sign-in pages).
5. Under **Student applications**: whether people may apply from the sign-in page.
6. Under **Sign-in and passwords**: the password rules, the lock after wrong passwords, when idle people are signed out, and the limits on requests (see the table below).
7. Under **Uploads, quizzes and parent alerts**: the **Largest upload (MB)** (1 to 15), the **Quiz grace period (seconds)** that answers sent just after a deadline still count, and from how many absences a parent sees them in red.
8. Under **Numbering**: how new student numbers, employee numbers and document request numbers look. `{YYYY}` or `{YY}` is the year, `{MM}` the month and `{N4}` the serial with at least 4 digits; **Next:** shows the number the next record will get as you type.
9. Choose **Save settings**.

The settings under **Sign-in and passwords**:

| Setting | What it does |
| --- | --- |
| **Shortest password** | 8 to 64 characters, for new and changed passwords |
| **Passwords mix letters and digits** | A new password needs at least one letter and one digit |
| **Always change the first password** | New accounts and reset passwords must be changed at the first sign-in, in every system |
| **Wrong passwords before locking**, **Minutes locked** | A username is locked after this many wrong passwords in a row. The lock is for the network address they came from, so nobody can lock a colleague out from elsewhere; ten times as many lock the username everywhere |
| **Sign out after (hours idle)** | People are signed out after this long without using ATLAS |
| **Requests per person per minute** | 60 to 3000, normally 300. Above this, ATLAS asks the person to wait a few seconds. A network address that is not signed in gets four times as many |
| **Wrong passwords per network address** | 10 to 1000 in 15 minutes, normally 30. An address that keeps guessing passwords, for any usernames, has to wait. Raise it if a whole campus reaches the internet through one address and people mistype often |

The colour changes on screen as you choose it, so you can try themes before saving. Password rules apply to new and changed passwords; nobody has to change a password that is already set. A new numbering format applies to new records only, and never gives a number that is already in use.

### Find any setting and compare it with the default

The **Settings center** lists every setting in ATLAS (Admin panel, Learn, Academic, People and Finance) in one place.

1. Choose **Settings center**.
2. Type in **Find a setting**, e.g. *password*, *PERA* or *waitlist*, or choose a module such as **ATLAS People**.
3. Tick **Only changed from the default** to see what your school has changed. Each setting shows its value **Now**, its **Default**, and who changed it last.
4. To change a setting, choose **Open** on its group: its own screen opens.

![The Settings center: every setting, by module](admin-config.jpg)

### Restore a default or undo a change

1. In the **Settings center**, find the setting and choose **Restore default**, or **Restore defaults** on its group to put the whole group back.
2. Confirm with **Restore**.

Every save on any settings screen is recorded under **Change history**: who, when, and each setting's value before and after. To take a change back, choose **Undo** on it; ATLAS refuses if the setting has been changed again since. The school's own information (its name, offices, bank accounts) has no default to go back to.

![Change history with the value before and after](admin-config-history.jpg)

### Copy settings to another ATLAS

1. In the **Settings center**, choose **Export & import**, then **Export settings**. A file with the school's settings downloads: rules, grading, payroll rates, Finance numbering and taxes, roles and permissions. It has no people, records or passwords.
2. On the other ATLAS, choose **Choose a settings file…** and pick that file.
3. Read what would change, untick any group you want to keep as it is, and choose **Import the ticked groups**.

If one group fails its checks, nothing is imported. Keep an export before big changes: importing it puts everything back.

### Change what an account type may do

1. Choose **Roles & permissions**.
2. In the table for a system (**Admin panel**, **ATLAS Academic**, **ATLAS People**, **ATLAS Finance**), tick or untick a permission for an account type. A shaded box differs from the built-in setting.
3. Choose **Save permissions**. If accounts would lose something they can do now, ATLAS asks first.

For example, let deans open Finance's reports (**ATLAS Finance** → *Finance dashboard, books and reports* for **Dean / Program chair**), or keep the academic settings with administrators only by unticking *Grading scale, requirements, document fees and signatories* (under **ATLAS Academic**) for **Registrar**. **Restore built-in** puts an account type back as ATLAS made it.

Administrators always have every permission, and managing administrator accounts and replacing data (**Administrators only**) cannot be given to anyone else. Admin-panel permissions go only to registrars and deans, who use the Admin panel.

![Roles & permissions](admin-roles.jpg)

![Settings & branding](admin-settings.jpg)

### Choose what the ATLAS home page shows

1. Choose **Home page & systems**. Academic, Learn, People and Finance are built in and always live.
2. For **Facilities** or the **REX Bookstore e-Reader**, choose a **Status**: **Coming soon (greyed out)**, **Live: open it from the ATLAS home page** or **Hidden**.
3. To make it live, type its **Address** (starting with `https://`, `http://` or `/`).
4. Choose **Save**. The home page changes at once.

The **REX Bookstore e-Reader** connects to the REX Bookstore app's library of e-books, for students and teachers. It shows as **Coming soon** until that connection is ready; then switch it to **Live** with the address of the e-reader.

Each card says which account types see that tile.

### Post school news and events

1. Choose **News & events → New post**. Type the **Title** and **Message**; tick **Pin to the top** or **Turn comments off** if needed. With more than one campus, tick **For every campus** to post everywhere.
2. Choose **Post**.
3. For an event, choose **New event**, fill in the dates, times and location, and choose **Save**.

Posts and events appear on the home pages of the campus, when the **News & events** module is on. Events also go on the school calendar (see below).

### Plan the school calendar

**School calendar** shows the campus's school events, holidays and examinations with the term dates (enrollment, the last day to drop, the first and last day of classes), by month, week or list.

1. Choose **School calendar**.
2. Choose a day, then **Add an event on this day** (or **New event** at the top).
3. Fill in the **Title** and the **Kind**: **School event**, **Holiday or no classes**, **Examinations**, **Meeting**, **Activity** or **Deadline**.
4. Under **For**, untick who should not see it: e.g. a faculty meeting only for **Teachers**, a parent–teacher conference for **Teachers** and **Parents & guardians**.
5. Tick **No classes** for a day without classes (a holiday ticks it by itself; also typhoon suspensions or exam days). Class meetings on those days disappear from everyone's calendar at the campus.
6. Choose **Save**. To change or delete an event, choose it on the calendar, then **Edit** or **Delete**.

Students, teachers and parents see these events on their own **Calendar** in Learn, with their classes and due dates. They can subscribe to it from Google Calendar, Outlook or a phone. The **School calendar** module (under **Modules**) turns the calendar on or off for students, teachers and parents.

![The school calendar in the Admin panel](admin-calendar.jpg)

### Set up single sign-on with Keycloak

You need a Keycloak realm and a Keycloak account that may manage its clients: a Keycloak administrator, or a service account with the realm-management role *manage-clients*. ATLAS does the rest.

1. Choose **Single sign-on**.
2. In **Set up for me**, type the **Issuer (realm address)**, for example `https://sso.school.edu/realms/school`. Keep **Client ID to use** as `atlas` unless the school wants another name.
3. Under **Sign in to Keycloak as**, choose **A Keycloak administrator** and type their username and password, or **A service account** and its client ID and secret. In **That account's realm**, leave `master` for a Keycloak administrator; for a realm administrator or a service account, type the school's realm.
4. Choose **Set up in Keycloak**. ATLAS creates its client in Keycloak (or fixes the one already there), keeps the client secret on the server and switches single sign-on on. It then says what it did, or what went wrong. The **Status** card shows **Client secret: Saved on the server by Set up for me**.
5. Under **Keycloak connection**, choose how to **Match Keycloak users to ATLAS accounts by**: **Email (verified in Keycloak)** or **Username**, change the **Button text** if you like, and choose **Save**. By username, only students, parents and staff are linked on the username alone; teachers, registrars, deans, administrators and officers must also have the same verified email in Keycloak as on their ATLAS account, so that nobody gets such an account just by having its username in Keycloak.

The Keycloak sign-in you type is used for the set-up only: it is not saved anywhere. A Keycloak account with two-step sign-in cannot be used here; use a service account instead. Untick **Switch single sign-on on when done** to connect first and switch it on later. **Set up again** is safe to repeat: it keeps the client's secret and only adds what is missing.

To set it up by hand instead, create the client as listed in **Or by hand, in Keycloak**, put its secret in the server's settings as `OIDC_CLIENT_SECRET` and restart ATLAS, then fill in **Keycloak connection**, choose **Test connection**, tick **Show "Sign in with Keycloak" on the sign-in pages** and choose **Save**. A secret saved by **Set up for me** is used instead of `OIDC_CLIENT_SECRET`.

Leave **Keep ATLAS passwords too** ticked while people get used to it. When you untick it, everyone except administrators must sign in with Keycloak; administrators keep their password in case Keycloak is down. Anyone else who types a password is told to use Keycloak, whether the password was right or not.

![Single sign-on settings](admin-sso.jpg)

### Add or remove the demo school

1. Choose **Demo data & backup**.
2. Choose **Add demo data** (or **Refresh demo data** when it is already there).
3. To take it out, choose **Remove demo data** and confirm.

The demo school is added next to your own data, at your first campus and three demo campuses. Removing it removes every demo record and signs the demo accounts out; your own records stay.

![Demo data & backup](admin-data.jpg)

### Make a backup or restore one

1. Choose **Demo data & backup → Download backup**. A file named like `atlas-backup-2026-11-08.json` is saved.
2. To restore, choose **Restore from backup…**, pick the file and confirm **Restore**.

> **Important:** Restoring replaces **all** current data with the backup and cannot be undone. The backup holds the records, so keep it private. Passwords are in it only as one-way hashes, encrypted with the server's own password key, which is not in the backup: a backup restored on another server needs that key (the person who looks after the server knows where it is), or the passwords must be reset. Uploaded files are not in it: to keep them too, copy the server's whole `data` folder.

**Settings & branding → Sign-in and passwords** shows whether the password hashes are encrypted, and with which key.

### Edit a guide

Administrators can change any guide on the **Help & guides** page, for example to add the school's own office hours or rules.

1. Open the guide (choose **Help & guides**, the question mark in the top bar), then choose **Edit this guide**.
2. Change the text on the left, in Markdown. The buttons above it add a heading (**H2**, **H3**), bold, a menu path (**→**), numbered steps, a list, a **Tip**, **Note** or important (**!**) box, a link or a screenshot. The preview on the right shows how it will look.
3. Choose **Save**.

Everyone now sees your school's version, marked *Edited by the school*. It is kept when ATLAS is updated. When an update changes the built-in guide, ATLAS says *ATLAS has updated this guide since it was edited here.*; choose **Compare and update it** to see the new built-in guide and copy in what you need. To drop your changes, open **Edit this guide** and choose **Restore the built-in guide**. **New guide** in the Help sidebar adds a guide of the school's own.

## Screens at a glance

| Sidebar group | Screen | What it is for |
|---|---|---|
| (top) | Dashboard | The campus's current term, enrollment numbers, the fullest sections and recent activity |
| Enrollment | Enrollment requests | Approve or reject requests, manage waitlists, add or drop students |
| Enrollment | Applicants | Admit or decline people who applied from the sign-in page |
| Enrollment | Students | Student accounts at this campus; each row opens the student's record |
| Enrollment | Parents & guardians | Parent and guardian accounts, their students and what each may see |
| Enrollment | Teachers | Teacher accounts at this campus and their sections |
| Catalog | Sections | Courses offered this term: teacher, schedule, seats, waitlist, enrollment key |
| Catalog | Courses | The school's subjects, with units and prerequisites |
| Catalog | Terms | Semesters, their enrollment windows, drop deadlines and class dates |
| Catalog | Programs | Degrees or strands students belong to |
| Communication | School calendar | School events, holidays, exams and term dates by month, week or list; add an event on a day |
| Communication | News & events | School news posts and events, for one campus or all |
| Configuration | Settings center | Every setting in ATLAS, compared with its default; change history and undo; export and import |
| Configuration | Campuses | Add, rename, remove and switch between campuses |
| Configuration | Modules | What students, teachers and parents & guardians get in Learn |
| Configuration | Activity types & grading | Activity types and how much each counts in the running grade |
| Configuration | Settings & branding | School name, current term, passing grade, enrollment rules, colours, logo, applications, passwords and sign-in, uploads and quizzes, numbering |
| Configuration | Home page & systems | The tiles on the ATLAS home page, and the address of systems not built in |
| Configuration | Single sign-on | Signing in with the school's Keycloak account |
| Configuration | Admins, registrars & deans | Accounts for administrators, registrars and deans |
| Configuration | Roles & permissions | What each account type may do in each system |
| Configuration | Demo data & backup | Add or remove the demo school; download or restore a backup |
| Elsewhere | ATLAS home | The ATLAS home page, in a new tab |

## Questions

**Which account types are there, and where are they made?**

| Account type | Made in |
|---|---|
| Administrator, Registrar, Dean / Program chair | Admin panel → Admins, registrars & deans |
| Teacher, Student | Admin panel → Teachers, Students (or Applicants) |
| Parent / Guardian | Admin panel → Parents & guardians |
| HR Manager, Payroll Officer, Staff | ATLAS People, on the employee's record |
| Chief Accountant, Budget Officer, Cashier, Supply & Property Officer, Approving Officer | ATLAS Finance → Control panel |

**Why can't I delete an account?** Students, teachers and parents are disabled, not deleted, so their records stay. On **Admins, registrars & deans** you cannot delete your own account or the last active administrator. Disabling works the same way: you cannot disable yourself or the last active administrator.

**Why does a registrar see the settings but cannot change them?** Modules, settings, activity types, campuses and systems are for administrators. Registrars see them read-only, with *Only administrators can change these.* (**Single sign-on** is not in a registrar's sidebar at all.) To let registrars change them, tick the permission for **Registrar** under **Roles & permissions**.

**Everyone was signed out at once.** Sign-ins are kept in the server's memory, so restarting ATLAS signs everyone out. People are also signed out after 8 hours without activity (change it under **Settings & branding** → **Sign-in and passwords**).

**Who changed this setting?** Open **Settings center**, find the setting and choose the clock button beside it: its history lists each change with who made it, when, and the value before and after.

**I gave an account type a permission, but its people do not see the new screen.** Permissions apply at their next page load; ask them to reload, or sign out and in again.

**I am locked out of the only administrator account.** On the server, stop ATLAS and run `npm run reset-password -- <username> <new-password>`, then start it again.

**Does a backup include uploaded files?** No. **Download backup** holds the records only. To keep class resources and handed-in work too, copy the server's whole `data` folder.
