---
id: admin
title: Running ATLAS: the Admin panel
summary: Set up and look after ATLAS as an administrator: accounts, campuses, the catalog, modules, settings, single sign-on, demo data, backups and the guides.
roles: admin
apps: admin, home
order: 80
---

## Before you start

The **Admin panel** is the school side of ATLAS Learn. Administrators and registrars use it; deans work in ATLAS Academic instead. An **Administrator** can do everything in it. A **Registrar** uses most of the same pages: they can change enrollment, students, applicants, parents & guardians, the catalog and news, see teachers, and see the **Configuration** pages read-only. **Single sign-on**, **Admins, registrars & deans** and **Demo data & backup** are for administrators only. Day-to-day enrollment (approving requests, waitlists, adding and dropping students) is explained in [the registrar's guide](registrar).

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
7. Choose **Demo data & backup**. This is where the demo school is added and removed, and where backups are made.

## How to…

### Set up ATLAS the first time

1. Open the ATLAS home page on the new server. It says **Not set up yet**; choose **Set up in the admin panel**.
2. If the server asks for a **Setup code**, type the code chosen when the server was created.
3. Type the **School name**, the **Campus name**, your **Full name**, a **Username** and a password (at least 8 characters), twice.
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

Teachers pick a type for each assignment, quiz or exam. A type that is in use cannot be removed; switch it off instead.

### Change school settings and branding

1. Choose **Settings & branding**.
2. Under **School**: the **School name**, the **Current term** and the **Passing grade (%)**.
3. Under **Enrollment rules**: **Requests need approval**, **Waitlists**, **Waitlist size per section** and **Maximum units per term** (0 means no limit).
4. Under **Branding**: choose a colour theme or **School colour**, **Upload logo** (PNG, JPEG or WebP, under 300 KB), and the **Sign-in headline**.
5. Under **Student applications**: whether people may apply from the sign-in page.
6. Choose **Save settings**.

The colour changes on screen as you choose it, so you can try themes before saving.

![Settings & branding](admin-settings.jpg)

### Choose what the ATLAS home page shows

1. Choose **Home page & systems**. Academic, Learn, People and Finance are built in and always live.
2. For **Facilities**, choose a **Status**: **Coming soon (greyed out)**, **Live: open it from the portal** or **Hidden**.
3. To make it live, type its **Address** (starting with `https://`, `http://` or `/`).
4. Choose **Save**. The home page changes at once.

Each card says which account types see that tile.

### Post school news and events

1. Choose **News & events → New post**. Type the **Title** and **Message**; tick **Pin to the top** or **Turn comments off** if needed. With more than one campus, tick **For every campus** to post everywhere.
2. Choose **Post**.
3. For an event, choose **New event**, fill in the dates, times and location, and choose **Save**.

Posts and events appear on the home pages of the campus, when the **News & events** module is on.

### Set up single sign-on with Keycloak

You need a Keycloak realm, and someone who can change the server's settings.

1. Choose **Single sign-on**.
2. In Keycloak, create the client as listed in the **In Keycloak** card. Use **Copy** for the **Valid redirect URIs** and **Valid post logout redirect URIs**.
3. Put the client secret in the server's settings as `OIDC_CLIENT_SECRET` and restart ATLAS. It is never typed into the admin panel. The **Status** card then shows **Client secret: Set on the server**. Without a secret (**Not set**), make the Keycloak client public instead (**Client authentication** off).
4. Back in **Single sign-on**, type the **Issuer (realm address)** and **Client ID**, and change the **Button text** if you like.
5. Choose how to **Match Keycloak users to ATLAS accounts by**: **Email (verified in Keycloak)** or **Username**.
6. Choose **Test connection**. ATLAS shows *Keycloak answered.* or what went wrong.
7. Tick **Show "Sign in with Keycloak" on the sign-in pages** and choose **Save**.

Leave **Keep ATLAS passwords too** ticked while people get used to it. When you untick it, everyone except administrators must sign in with Keycloak; administrators keep their password in case Keycloak is down.

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

> **Important:** Restoring replaces **all** current data with the backup and cannot be undone. The backup holds the records (with passwords as secure hashes), so keep it private. Uploaded files are not in it: to keep them too, copy the server's whole `data` folder.

### Edit a guide

Administrators can change any guide on the **Help & guides** page, for example to add the school's own office hours or rules.

1. Open the guide (choose **Help** in the top bar), then choose **Edit this guide**.
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
| Communication | News & events | School news posts and events, for one campus or all |
| Configuration | Campuses | Add, rename, remove and switch between campuses |
| Configuration | Modules | What students, teachers and parents & guardians get in Learn |
| Configuration | Activity types & grading | Activity types and how much each counts in the running grade |
| Configuration | Settings & branding | School name, current term, passing grade, enrollment rules, colours, logo, applications |
| Configuration | Home page & systems | The tiles on the ATLAS home page, and the address of systems not built in |
| Configuration | Single sign-on | Signing in with the school's Keycloak account |
| Configuration | Admins, registrars & deans | Accounts for administrators, registrars and deans |
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

**Why does a registrar see the settings but cannot change them?** Modules, settings, activity types, campuses, systems and single sign-on are for administrators. Registrars see them read-only, with *Only administrators can change these.*

**Everyone was signed out at once.** Sign-ins are kept in the server's memory, so restarting ATLAS signs everyone out. People are also signed out after 8 hours without activity.

**I am locked out of the only administrator account.** On the server, stop ATLAS and run `npm run reset-password -- <username> <new-password>`, then start it again.

**Does a backup include uploaded files?** No. **Download backup** holds the records only. To keep class resources and handed-in work too, copy the server's whole `data` folder.
