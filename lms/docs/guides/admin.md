---
id: admin
title: Running ATLAS: the Admin panel
summary: Set up and look after ATLAS as an administrator: accounts, campuses, the catalog, modules, settings in every system, and System (Users & Access, roles and permissions, sign-in rules, single sign-on, Cloudflare, the Audit log and the Security monitor), demo data, backups and the guides.
roles: admin
apps: admin, home
order: 80
---

## Before you start

The **Admin panel** is the school side of ATLAS Learn. Administrators and registrars use it; deans work in ATLAS Academic instead. An **Administrator** can do everything in it. A **Registrar** uses most of the same pages: they can change enrollment, students, applicants, parents & guardians, the catalog and news, see teachers, and see the **Configuration** pages read-only. **Settings center** and **Demo data & backup** are for administrators only (an administrator can give registrars more under **Roles & permissions**). Day-to-day enrollment (approving requests, waitlists, adding and dropping students) is explained in [the registrar's guide](registrar).

**System**, at the bottom of the sidebar, is for administrators only, as in CORE: **Users & Access** (every account in every system, and what each account type can do) the **Audit log** (sign-ins, failed sign-ins and every change) and the **Security monitor** (the server's health, refused requests, traffic and who is signed in). It is in the sidebar of whichever system you have open: the Admin panel, People, Academic and Finance. In the Admin panel it also has **Roles & permissions**, **Sign-in and passwords**, **Single sign-on** and **Cloudflare** (putting ATLAS behind Cloudflare at a name on the school's own domain). Nobody else sees System, whatever their permissions.

To open it:

1. Sign in on the ATLAS home page.
2. Under **Administration**, below your systems, choose **Admin panel**. The tiles beside it go straight to **Users & Access**, the **Settings center**, the **Audit log** and **What's new**.

![Administration on the ATLAS home page: the Admin panel and shortcuts into it](home-administration.jpg)

The admin panel also has its own sign-in page at `/admin`, for administrators and registrars.

On a new server, the first person to open ATLAS creates the first administrator (see [Set up ATLAS the first time](#set-up-atlas-the-first-time)). With the demo school, sign in as `admin` with the password `password123`.

Most lists in the admin panel show **one campus at a time**: the campus shown under your name. Administrators can reach every campus and switch from the menu under their name.

## Walkthrough

This tour uses the demo school, signed in as `admin`.

1. On the ATLAS home page, under **Administration**, choose **Admin panel**. The **Dashboard** opens.

![The Dashboard: enrollment numbers, the fullest sections and recent activity](admin-dashboard.jpg)

2. Read the line under **Dashboard**: the campus, the current term, whether enrollment is open and the class dates. The boxes count requests **Pending approval**, **Waitlisted** students, **Applicants** and more. Choose any box to open the list behind it.
3. In the sidebar, under **System**, choose **Users & Access**. Every account in ATLAS is here, with what each account type can do below.

![System → Users & Access](system-users.jpg)

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

### Add an administrator, registrar, dean or other staff account

1. Under **System**, choose **Users & Access → + Add user**.
2. Type the **Full name** and **Username** (3 to 40 lowercase letters, numbers, dots, dashes or underscores), and choose the **Account type**: the line under it says what that type can do. Any staff type can be made here: Administrator, Registrar, Dean / Program chair, Teacher, HR Manager, Payroll Officer, the Finance offices or Staff.
3. Type the **Email** (needed to link a teacher, registrar, dean, administrator or officer to Keycloak), and tick the campuses under **Works at**. Administrators always reach every campus.
4. Keep the **Temporary password** ATLAS suggests (**New** makes another) and give it to the person privately. They choose a new password at first sign-in.
5. Choose **Create user**.

Students and parents are added from **Students** and **Parents & guardians**. HR can also make accounts in ATLAS People, on the employee's record (see [the HR guide](hr)).

### Add a teacher or a student

1. Choose **Teachers → + Add teacher**, or **Students → + Add student**.
2. Fill in the name, username and email. For a teacher, add the **Department** and **Employee number**. For a student, choose the **Program** and **Year level**; leave **Student number** blank to number them automatically.
3. Choose the campus (students belong to one campus; teachers can work at several).
4. Type a **Temporary password** and choose **Save**.

The person's record opens. Teachers and students sign in on the ATLAS home page.

### Find an account, change it, reset its password or disable it

1. Under **System**, choose **Users & Access**. Search by name, username, email or student number, or narrow the list by **Account type**, status, or **Signed in now**, **Locked**, **Own access**, **Temporary password**, **Linked to Keycloak** or **Without 2-step verification**.
2. Each row shows the account type, the **Linked employee**, the status (with **Temp. password**, **Locked**, **Signed in**, **Keycloak**, **2-step on**, **2-step not set up** or **Demo** where they apply) and the last sign-in. Choose a link on the row (below).

| Link | What it does |
| --- | --- |
| **Edit** | Change the **Full name**, **Username**, **Account type**, **Email**, **Linked employee record**, campuses, or untick **Account is active (can sign in)** to disable it. Changing the type signs the person out. **Unlink** ends a Keycloak link |
| **Access** | Give this one person a permission more, or take one away (see the next section) |
| **Reset password** | Give them the temporary password shown. They are signed out, unlocked, and choose a new password at the next sign-in |
| **Unlock** | A username locked after wrong passwords can sign in again at once |
| **Reset 2-step verification** | For someone who lost their phone and their recovery codes: their authenticator app and codes stop working and they are signed out. They sign in with their password alone (and set it up again at once if the school requires it). They are told on the bell. Only once you are sure it is them asking |
| **Sign out** | Ends every session of the person |
| **Audit log** | What they did, and what was done to their account |
| **Profile** | Their profile as they see it, where you can **Give a title** (their position in the school) |
| **Remove picture** | Takes away their picture (for one that does not belong on a school system); written in the Audit log |
| **Delete** | Only for an account with no records (no enrollment, no sections, no changes in any system). Otherwise untick **Account is active**, so the records keep who made them |

You cannot change your own account type or disable, reset or delete your own account, and the last active administrator stays one. Only staff accounts change type: students and parents keep theirs, and a teacher who still has sections keeps the teacher type until their sections go to another teacher.

Below the accounts, **Account types** lists what each type can do in each system, with ✓ and —, as in CORE. Change a type under **Roles & permissions**.

### Give one account more or less access

The account type decides what someone may do. Sometimes one person needs a little more or a little less, for example one registrar who also reads Finance's reports, or one HR manager who should not approve leave.

1. Under **System → Users & Access**, choose **Access** on the person's row.
2. Tick a permission to give it to this person, or untick one to take it away. Shaded rows are this person's own, different from the account type. Permissions the account type can never have are not offered, and **Administrators only** ones stay with administrators.
3. Choose **Save access**. The person is signed out on every device and has the new access as soon as they sign in again, so nothing keeps running under the old permissions.

The row then shows **+ own access** under the account type. Changing a person's account type clears their own access, as it belonged to the old type. Administrators always have every permission.

### Read and export the Audit log

1. Under **System**, choose **Audit log**. It opens on the last 30 days, newest first: sign-ins and failed sign-ins (with the network address), sign-outs and password changes, every change by staff in every system, requests that were refused, and the Settings, Finance and Academic logs.
2. The notice at the top checks the log: **Sign-in and access log intact.** means no sealed entry was changed, removed or reordered. The sealed log covers sign-ins, failed sign-ins and the changes staff make across ATLAS; the Settings, Finance and Academic entries shown below it come from the data file and are restored with a backup, so they sit outside the seal and the notice says how many they are. If it says **The log was altered.**, the sealed file was edited outside ATLAS: keep a copy and investigate.
3. Narrow it with **From** and **To**, the area (**Sign-in**, **Account**, **Change**, **Refused**…), the system, the outcome, or the search box (a name, a record, a changed field or a network address). A change to an account, its access or a setting lists each field with its value before and after.
4. Choose **Export CSV** for every entry that matches. The export itself is written in the log.

![The Audit log](system-audit.jpg)

Passwords and what people type into forms are never recorded; a username nobody has is written as *(unknown username)*, as people sometimes type their password there by mistake. The log is kept the way CORE keeps its own: in a file of its own beside the data (`audit-log.jsonl`), every entry numbered and chained to the one before. Entries cannot be edited or deleted in ATLAS, and restoring a backup or removing the demo school does not change them. A backup does not contain the audit log; on the AWS server a copy is kept each night with the other backups.

### Watch the server with the Security monitor

1. Under **System**, choose **Security monitor**. Pick the period at the top: **Last hour**, **24 hours**, **7 days** or **30 days**. The page updates itself every minute while it is open.
2. The four cards at the top sum up the period; each opens its tab (described below).
3. Each chart has **Show the numbers** for a table; point at a bar (or use the arrow keys) to read one period.

![The Security monitor](system-monitor.jpg)

The four tabs:

- **Software status**: checks on the server and the school's settings, each **Fine**, **Look at this**, **Problem** or **Note**, with the reason and, where there is one, **Open** to go to the fix. They cover the Node.js version and its support dates, server errors, memory, disk, the Audit log check, backups, who can read the data files, the password key, demo data, HTTPS, rate limits, the number of administrators, temporary passwords, staff accounts unused for 90 days, the password rules and single sign-on.
- **API security**: requests ATLAS refused, by kind (not signed in, not allowed, too many, from another website, malformed, scanner paths such as `/.env`, calls to a private address…), each with its item in the OWASP API Security Top 10; failed and refused sign-ins; **Addresses to watch** (20 refusals, 5 sign-in problems, or a locked username, in the period); the **Controls in force** as they are set now; and the **API inventory** (every address ATLAS answers, and which are open without signing in).
- **Traffic**: requests, API response times (median, p95, p99), server errors, the busiest and the slowest API routes.
- **User activity**: who is signed in now (and where, from which device and address), how many people used ATLAS today, this week and this month, sign-ins and changes over time, where people made changes, the most active people, and the latest sign-ins.

A campus, a computer lab or a dormitory shares one network address, so look before blocking an address: the Audit log shows who used it. Block it at the firewall, in AWS or in Cloudflare, not in ATLAS. To end someone's sessions, use **Users & Access** → the person → **Sign out**.

The monitor counts what the server already sees, by route (never the address with its ids, the query or what was typed), and keeps it in `monitor.json` beside the data: minutes for an hour, hours for a week, days for 90 days, so the file never grows. Network addresses are kept 7 days. It is not part of a backup.

**From another tool.** At the bottom of **API security**, **Monitoring from another tool** gives the health check (`/healthz`, for an uptime checker or a load balancer) and the metrics address for Prometheus and Grafana. Choose **Make a token**, copy it at once (ATLAS keeps only a fingerprint and cannot show it again) and give it to the metrics server as `Authorization: Bearer`. **Replace the token** stops the old one; **Revoke** turns metrics off. Neither shows names or network addresses, and each change of token is in the Audit log.

### Set the rules for passwords and sign-in

1. Under **System**, choose **Sign-in and passwords**.
2. Change the settings (see the table below) and choose **Save**. They apply at once, in every system, and the change is in the Audit log with the old and new value.

Only administrators change these settings. Someone else who may change the school's settings sees them in the Settings center, read-only.

The settings under **Sign-in and passwords**:

| Setting | What it does |
| --- | --- |
| **Shortest password** | 8 to 64 characters, for new and changed passwords |
| **Passwords mix letters and digits** | A new password needs at least one letter and one digit |
| **Always change the first password** | New accounts and reset passwords must be changed at the first sign-in, in every system |
| **Wrong passwords before locking**, **Minutes locked** | A username is locked after this many wrong passwords in a row. The lock is for the network address they came from, so nobody can lock a colleague out from elsewhere; ten times as many lock the username everywhere. It is one lock for the username, whichever sign-in page is used. Wrong 2-step verification codes count as wrong passwords, and also for the account from every address: after this many, the account takes no code for **Minutes locked** (twice as long each time it happens again without a right code), and the person is told on the bell. Typing the right password again does not end that wait, and neither does **Unlock**; if someone else has the password, use **Reset password** |
| **Who must use 2-step verification** | **Optional for everyone** (the default), **Required for administrators**, **Required for employees and administrators** (everyone but students and parents) or **Required for everyone**. Those it covers set it up right after signing in. Require it for administrators first, and turn it on for your own account before (ATLAS refuses otherwise). Keycloak sign-ins skip ATLAS's code, even for accounts that turned it on: with Keycloak, the second step is Keycloak's to require, so require one (such as OTP) in the school's Keycloak realm |
| **Sign out after (hours idle)** | People are signed out after this long without using ATLAS |
| **Sign out after (hours signed in)** | 1 to 168, normally 12. However busy, people sign in again this long after signing in, so a session that was copied or left open stops working. Never sooner than the idle time |
| **Requests per person per minute** | 60 to 3000, normally 300. Above this, ATLAS asks the person to wait a few seconds. A network address that is not signed in gets four times as many |
| **Wrong passwords per network address** | 10 to 1000 in 15 minutes, normally 30. An address that keeps guessing passwords, for any usernames, has to wait. Raise it if a whole campus reaches the internet through one address and people mistype often |
| **School networks** | The addresses each campus reaches the internet through (see below). From them, the limits counted per address are multiplied |
| **Limits on school networks (times)** | 1 to 100, normally 20: how many times those limits a school network gets |

![Sign-in and passwords, with who must use 2-step verification](admin-2fa-policy.jpg)

Password rules apply to new and changed passwords; nobody has to change a password that is already set.

### List the school's networks

A campus usually reaches the internet through one or two addresses, so to ATLAS a thousand students on the campus Wi-Fi look like one visitor. Without this, thirty mistyped passwords in a quarter of an hour, or sixty sign-ins in a minute, make *everyone* on that campus wait. List the campus addresses, and the limits counted per address (sign-ins, wrong passwords, requests before signing in, applications and Keycloak sign-ins) are multiplied there. Everywhere else they stay as they are, so password guessing from the internet still meets the usual limit, and one username still locks after its own wrong passwords.

1. Under **System**, choose **Sign-in and passwords**, and go down to **School networks**.
2. The page shows the address you are reaching ATLAS from. If you are on a campus connection, choose **Add it**.
3. **Where people signed in from in the last 7 days** lists the busiest networks, with how many people signed in from each. Choose **Add** beside a campus network. Ask the school's network administrator if you are not sure which addresses are the school's. An address is listed once: if it is already in the list, saved or not, ATLAS points at its row instead of adding another, and **Save** refuses two rows with the same address.
4. Type the campus name under **Campus or note** (for example *Main Campus*). To type an address yourself, choose **Add a network**: one address (`203.0.113.7`) or a range (`203.0.113.0/24`, at most a /16; IPv6 at most a /32).
5. Leave **Limits on school networks (times)** at 20 unless the Security monitor shows waits at busy times, and choose **Save**.

![School networks, with the busiest networks of the week](admin-school-networks.jpg)

> **Important:** List only addresses that belong to the school. Anyone on a listed network gets the larger limits, so a home or shared public address must never be on the list.

### Admit or decline applicants

New students register themselves with **Register account** on the ATLAS home page: campus, title, first, middle and last name, email, mobile number and a password. Their accounts wait as applicants.

1. Choose **Applicants**. The sidebar badge counts the registrations waiting. Each row shows the name and its parts, the email and mobile number, the date and the preferred campus.
2. To admit, choose **Admit**, check the details, pick a **Program** if you know it, and choose **Admit**. The student gets a student number and signs in with their email.
3. To decline, choose **Decline**, type a **Reason (kept on record)** and choose **Decline**.

People can register only while **Let new students register from the sign-in page** is ticked under **Settings & branding → Registration** (see [Set up student registration](#set-up-student-registration)).

### Set up student registration

The **Registration** section of **Settings & branding** decides whether the sign-in page shows **Register account**, and what students agree to at the bottom of **Create Student Account**: *By using this service, you understand and agree to the … online services Terms of Use and Privacy Policy* (with your school's short name when your school's brand leads, else its name).

![Settings & branding → Registration: the switch, then the Terms of Use and the Privacy Policy, each an address or a text](admin-registration.jpg)

1. Choose **Settings & branding** and scroll to **Registration**.
2. Tick **Let new students register from the sign-in page**.
3. Under **Terms of Use**, type the **Address of the school's page** (starting with `https://`), or write the terms under **Or the text**. Leave both empty if the school has none: students then see no Terms of Use link. ATLAS never writes terms for you; the grey text in the empty box is only a reminder for administrators.
4. Under **Privacy Policy**, do the same. Left empty, students read ATLAS's built-in notice (**The built-in privacy notice** shows it): what the form collects, that it is used to consider the registration and to contact the student, that it becomes part of the student records, and to ask the registrar. **Start from this text** copies it into the box so you can change it.
5. Choose **Save settings**.

An address is used when there is both an address and a text. A text opens in a window over the form. The four settings are also in the **Settings center** under **ATLAS Learn → Enrollment and passing** (*Registration: Terms of Use address* and the others), where **Restore default** empties them.

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
4. Under **Branding**: choose the **Brand** (see [Lead with your school's name and seal](#lead-with-your-school-s-name-and-seal)), a colour theme or **School colour** with its **Accent**, **Upload logo** (PNG, JPEG or WebP, under 300 KB; it replaces the ATLAS mark in the round seal on the sign-in pages), and the **Sign-in headline** (an optional line under the school name on the sign-in pages). **Preview** shows the top bar and the sign-in page as you choose.
5. Under **Registration**: whether new students may register from the sign-in page, and the school's **Terms of Use** and **Privacy Policy** (see [Set up student registration](#set-up-student-registration)).
6. **Sign-in and passwords** are under **System** (see [Set the rules for passwords and sign-in](#set-the-rules-for-passwords-and-sign-in)).
7. Under **Uploads, quizzes and parent alerts**: the **Largest upload (MB)** (1 to 15), the **Quiz grace period (seconds)** that answers sent just after a deadline still count, and from how many absences a parent sees them in red.
8. Under **Numbering**: how new student numbers, employee numbers and document request numbers look. `{YYYY}` or `{YY}` is the year, `{MM}` the month and `{N4}` the serial with at least 4 digits; **Next:** shows the number the next record will get as you type.
9. Choose **Save settings**.

The colour changes on screen as you choose it, so you can try themes before saving. A new numbering format applies to new records only, and never gives a number that is already in use.

### Lead with your school's name and seal

By default ATLAS's mark and name lead every screen, with your school's name beside them. Your school can lead instead, with ATLAS only as a small credit.

1. Choose **Settings & branding**.
2. Under **Branding → Brand**, choose **Our school, powered by ATLAS**.
3. Type the **School short name**: the name or initials your school goes by, up to 24 characters (for example `LA` for the demo's *Lancaster Academy*).
4. **Upload logo** with your school's seal. A square seal on a transparent background works best; it is made at most 400 pixels wide.
5. Under **Colours**, choose a theme, or **School colour** and its **Accent** for your school's own two colours (for example a green with a gold).
6. Check **Preview**: the top bar and the sign-in page as everyone will see them. Under it, ATLAS says whether text on the accent is set dark or white, and how readable it is.
7. Choose **Save settings**. The top bar changes at once; everyone else sees it the next time they open a page.

![Settings & branding with Our school, powered by ATLAS](admin-branding-school.jpg)

What changes, in every system:

- The top bar shows your seal and short name in place of the ATLAS mark and name (*LA* · *Learn*), in light and dark mode.
- The systems are named after your school: *LA Learn*, *LA Academic*, *LA People*, *LA Finance*, *LA Documents* and *LA Tools*; so are the **LA home** page, the **LA systems** menu, the page titles and the browser tab's icon.
- The sign-in pages show your seal and short name at the top, your seal and full school name on the card, and a small *Powered by ATLAS* at the foot of the card.
- The home page says *Welcome to LA's online services*, and its footer and the side menu say *Powered by ATLAS*.

What stays: every screen works the same, printed documents keep your logo and school name as before, and messages about what the software itself does may still name ATLAS. These guides also say ATLAS; read it as your school's name. To go back, choose **ATLAS (default)** and save: the short name is kept for later.

> **Note:** The short name is needed for **Our school, powered by ATLAS**; without one, ATLAS says *Type the school's short name*.

### Find any setting and compare it with the default

The **Settings center** lists every setting in ATLAS (Admin panel, Learn, Academic, People and Finance) in one place.

1. Choose **Settings center**.
2. Type in **Find a setting**, e.g. *password*, *PERA* or *waitlist*, or choose a module such as **ATLAS People**.
3. Tick **Only changed from the default** to see what your school has changed. Each setting shows its value **Now**, its **Default**, and who changed it last.
4. To change a setting, choose **Open** on its group: its own screen opens.

![The Settings center: every setting, by module](admin-config.jpg)

### Set how long job applicant accounts last

People outside the school apply for jobs with a temporary **applicant account** (see [the applicant's guide](applicant)). Three settings decide its life, in the **Settings center** under **ATLAS People → Job applicants** (HR managers change them in People under **HR settings → Job applicants**):

| Setting | Default | What it does |
|---|---|---|
| Applicant accounts last (days) | 365 | An account closes this many days after sign-up (30 to 1095). A change applies to accounts made after it; HR can extend one account. |
| Warn applicants before closing (days) | 30 | The applicant is told on the bell this many days before, once (1 to 90). |
| Remove closed applicant accounts after (days) | 30 | A daily check removes a closed account and the personal details in its applications this many days after it closed (0 to 365). 0 keeps it until HR removes it. |
| Keep people in the pool of applicants (months) | 12 | How long someone who ticked *Keep me in the school's pool of applicants* stays in it after an application ends Not selected or Not qualified (1 to 36). Never longer than they agreed to; an applicant account is kept open as long. |

1. Choose **Settings center** and find *applicant*.
2. Choose **Open** on **Job applicants**: People's **HR settings** opens. Change the numbers and choose **Save HR settings**.

A closed account cannot sign in, and its sessions end when it closes. Removed applicants stay in each opening's list as *Removed applicant*, without a name, so the counts stay true. Employees, students and other accounts never close this way.

### Check what the applicant sign-up asks

The same group has **Applicant sign-up fields**: what the job applicant sign-up asks besides the full name, email, username and password (always asked and required). Each optional field is **Hidden**, **Optional** or **Required**; by default only the **Mobile number** is asked, and it is optional, so the school asks only what it needs (Data Privacy Act of 2012). HR managers change it in People under **HR settings → Applicant sign-up fields** (see [the HR guide](hr#choose-what-the-applicant-sign-up-asks)).

1. Choose **Settings center** and find *sign-up*. **Now** lists the fields asked besides the fixed ones.
2. Choose **Open** on **Job applicants** to change them in People, or **Restore default** to ask only the mobile number again.

Each field's change is in the **Change history**, for example *Applicant sign-up fields (Date of birth)*, *Hidden* → *Required*. Document uploads and an employee ID are never asked at sign-up: documents come with each application, and employees apply with their own account. Hiding a field deletes nothing applicants already gave.

### Check the recruitment stages

Job applications go through the school's **recruitment stages**, which the applicant follows on their application (see [the applicant's guide](applicant#follow-your-application)). HR managers set them in People under **HR settings → Recruitment stages** (see [the HR guide](hr#set-the-recruitment-stages)); you find them in the **Settings center** under **ATLAS People → Recruitment stages**:

| Setting | Default | What it does |
|---|---|---|
| Recruitment stages | Application received → Initial screening → Assessment (examination or interview) → Deliberation → Final decision | The stages, in order, each with what the applicant reads. A stage an application has used can be retired, never removed. |
| Final outcomes of an application | Selected, Not qualified, Not selected, Withdrawn | Fixed meanings; only their labels and descriptions change. *Not qualified* can be turned off. |

1. Choose **Settings center** and find *stages*.
2. Choose **Open** on **Recruitment stages**: People's **HR settings** opens at the stages. Change them and choose **Save recruitment stages**.

**Restore defaults** puts the built-in stages back, unless a stage the school added has been used by an application: ATLAS then says which, and nothing changes (retire it first in People). Each change is in the **Change history**.

### Check the assessment templates

HR rates job applicants with **assessment templates**: criteria with weights, per **position category** (see [the HR guide](hr#set-up-the-assessment-templates)). HR managers set them in People under **HR settings → Assessment templates**; you find them in the **Settings center** under **ATLAS People → Assessment templates**:

| Setting | Default | What it does |
|---|---|---|
| Position categories | Faculty, Non-teaching | The kinds of position an opening can be, each with the template a new opening of that kind starts with |
| Assessment templates | Faculty (example), Non-teaching (example) | The criteria and their weights, which must total exactly 100%; each criterion is scored 0 to 100, so a weighted total is never more than 100 |
| Comparative list captions | *Comparative assessment of applicants*; *Prepared by*, HRMPSB Secretariat; *Rated by*, Member, HRMPSB | The title, the secretariat's signature line, and the caption and title of each assessor's signature line on the printed comparative list |
| Selection board | Off | Whether an assessor who has submitted sees the combined result (total and rank). How the assessors' ratings are combined is set on each template: average (the default), average without the highest and lowest, or board consensus |

1. Choose **Settings center** and find *assessment*.
2. Choose **Open** on **Assessment templates**: People's **HR settings** opens at them. Change them and choose **Save assessment templates**.

The built-in templates are examples, to replace with the school's merit selection plan. **Restore defaults** puts them back, unless an opening not yet rated uses a template the school added: ATLAS then says which, and nothing changes. An opening already rated keeps its own copy of its template either way. Each change is in the **Change history**.

### Check the applicant documents settings

Applicants upload documents against each opening's checklist (see [the HR guide](hr#set-the-applicant-upload-policy-and-the-default-checklists)). HR managers set the upload policy in People under **HR settings → Applicant documents**; you find it in the **Settings center** under **ATLAS People → Applicant documents**:

| Setting | Default | What it does |
|---|---|---|
| File types applicants may upload | PDF, Word (DOC, DOCX), Excel (XLS, XLSX), pictures (JPEG, PNG, GIF) | The kinds of file accepted, worked out from each file's content. Programs, scripts, web pages, Office files with macros and password-protected files are always refused. |
| Largest file (MB) | 2 | 1 to 10. A larger file is refused with advice on making it smaller or splitting it. |
| Most files per application | 15 | 1 to 50 |
| Help on compressing and splitting files | A short text | Shown beside the upload buttons |
| Default requirements checklists | Examples for Faculty and Non-teaching | The documents a new opening of each position category asks for |

The files are kept encrypted in *applicant-files* beside the data file, under a key derived from the server key (keep the server key safe, as for ATLAS Documents), and are included in neither *db.json* nor its exports.

### Who rates applicants: the permission hris.assess

Selection board members (assessors) can be any active staff account. The permission **Rate applicants as a selection board member** (*hris.assess*) is given by HR naming someone on an opening's selection board, for that opening only: no account type has it built in, and giving it to an account type under **Roles & permissions** adds nothing by itself. To stop one person from rating anywhere, take it away from their account under **Users & Access → Access**; HR can then no longer name them, and they can no longer open the openings they were named on.

### Check the appointment papers settings

When HR appoints a selected applicant, ATLAS People makes the appointment form, the Oath of Office (Panunumpa sa Katungkulan, Filipino and English) and the Certificate of Assumption to Duty. HR managers set them in People under **HR settings → Appointment papers**; you find them in the **Settings center** under **ATLAS People → Appointment papers**:

| Setting | Default | What it does |
|---|---|---|
| Appointment signatories | Blank names; titles *Appointing Officer*, *Human Resource Management Officer*, *Chairperson, HRMPSB*, *Head of Office* | Filled in on each new appointment, where HR can change them; an issued paper keeps the names it was issued with |
| Agency on the appointment papers | Blank: Finance's entity name, else the school name | The agency the papers name |
| Place on the appointment papers | Blank: the employer address | For "Done this … in …" and where oaths are sworn |
| Wording of the appointment papers | ATLAS's starting wording | Each paper's text, with merge fields such as `{name}` and `{position}`; an unknown merge field is refused. Replace it with the wording of the CSC form the school uses |
| Form numbers printed on the papers | Blank | Printed only when typed, as on the school's copy of the form |

Each paper gets a number when it is issued, from **Settings & branding → Numbering → Appointment paper numbers** (`APT{YYYY}-{N4}` by default, so *APT2026-0001*). A number is never given twice, even when the format changes.

### Who appoints: the permission hris.appoint

**Appoint selected applicants** (*hris.appoint*) lets an account, together with **Recruitment** (*hris.recruitment*), appoint an applicant whose outcome is *Selected*: issue, reprint, cancel and reissue the appointment papers, and make the person an employee, which turns an applicant account into a staff account. HR Manager has it built in. Change it under **Roles & permissions**, or for one account under **Users & Access → Access**. Only an administrator can make the new account a Finance office account.

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

1. Under **System**, choose **Roles & permissions**.
2. In the table for a system (**Admin panel**, **ATLAS Academic**, **ATLAS People**, **ATLAS Finance**), tick or untick a permission for an account type. A shaded box differs from the built-in setting.
3. Choose **Save permissions**. If accounts would lose something they can do now, ATLAS asks first.

For example, let deans open Finance's reports (**ATLAS Finance** → *Finance dashboard, books and reports* for **Dean / Program chair**), or keep the academic settings with administrators only by unticking *Grading scale, requirements, document fees and signatories* (under **ATLAS Academic**) for **Registrar**. **Restore built-in** puts an account type back as ATLAS made it.

Administrators always have every permission, and managing administrator accounts and replacing data (**Administrators only**) cannot be given to anyone else. Admin-panel permissions go only to registrars and deans, who use the Admin panel.

The plantilla register in People is *Plantilla: record items, link incumbents, print the PSIPOP* under **ATLAS People**. HR managers have it; account types that can view employee records (such as the payroll officer) can read the register and print the PSIPOP without it. Tick it for another account type to let it record items and link incumbents. The names on the PSIPOP's signature lines are in the **Settings center** under **ATLAS People → Plantilla: PSIPOP signatories**.

Recruitment in People (job openings, applications and applicant accounts) is *Recruitment: job openings, applications and applicant accounts* under **ATLAS People**. HR managers have it; tick it for another account type to let it post openings and decide on applications. **Job applicants** (people outside the school who signed up from Job openings) can never be given a permission: they see only Job openings, My applications and their own account.

![Roles & permissions](admin-roles.jpg)

![Settings & branding](admin-settings.jpg)

### Choose what the ATLAS home page shows

1. Choose **Home page & systems**. Academic, Learn, People and Finance are built in and always live.
2. For **Facilities** or the **REX Bookstore e-Reader**, choose a **Status**: **Coming soon (greyed out)**, **Live: open it from the ATLAS home page** or **Hidden**.
3. To make it live, type its **Address** (starting with `https://`, `http://` or `/`).
4. Choose **Save**. The home page changes at once.

The **REX Bookstore e-Reader** connects to the REX Bookstore app's library of e-books, for students and teachers. It shows as **Coming soon** until that connection is ready; then switch it to **Live** with the address of the e-reader.

Each card says which account types see that tile.

### Choose who can use PDF Studio

**PDF Studio** (making, joining, editing and signing PDFs) is a tool in **ATLAS Tools**, under the systems on **Home page & systems**. By default the school's employees have it: teachers, registrars, deans, HR, payroll, the Finance offices and staff. Students and parents do not.

1. Choose **Home page & systems** and go down to **Tools**.
2. Under **Open to**, tick the account types that may use it, and untick the others.
3. Choose **Save tools**. People see the change the next time they open the ATLAS home page; someone whose account type is unticked is told *PDF Studio is not switched on for your account type*.

Administrators always have it. Each person's files are their own (administrators do not see them) and are removed after a few hours unused; the **Audit log** records each export and signature (kind *Document*, system *Tools*), never the contents. See [the PDF Studio guide](pdf-studio).

![Tools: the account types that may use PDF Studio](admin-tools.jpg)

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

Single sign-on is under **System**. You need a Keycloak realm and a Keycloak account that may manage its clients: a Keycloak administrator, or a service account with the realm-management role *manage-clients*. ATLAS does the rest.

1. Under **System**, choose **Single sign-on**.
2. In **Set up for me**, type the **Issuer (realm address)**, for example `https://sso.school.edu/realms/school`. Keep **Client ID to use** as `atlas` unless the school wants another name.
3. Under **Sign in to Keycloak as**, choose **A Keycloak administrator** and type their username and password, or **A service account** and its client ID and secret. In **That account's realm**, leave `master` for a Keycloak administrator; for a realm administrator or a service account, type the school's realm.
4. Choose **Set up in Keycloak**. ATLAS creates its client in Keycloak (or fixes the one already there), keeps the client secret on the server and switches single sign-on on. It then says what it did, or what went wrong. The **Status** card shows **Client secret: Saved on the server by Set up for me**.
5. Under **Keycloak connection**, choose how to **Match Keycloak users to ATLAS accounts by**: **Email (verified in Keycloak)** or **Username**, change the **Button text** if you like, and choose **Save**. By username, only students, parents and staff are linked on the username alone; teachers, registrars, deans, administrators and officers must also have the same verified email in Keycloak as on their ATLAS account, so that nobody gets such an account just by having its username in Keycloak.

The Keycloak sign-in you type is used for the set-up only: it is not saved anywhere. A Keycloak account with two-step sign-in cannot be used here; use a service account instead. Untick **Switch single sign-on on when done** to connect first and switch it on later. **Set up again** is safe to repeat: it keeps the client's secret and only adds what is missing.

To set it up by hand instead, create the client as listed in **Or by hand, in Keycloak**, put its secret in the server's settings as `OIDC_CLIENT_SECRET` and restart ATLAS, then fill in **Keycloak connection**, choose **Test connection** (administrators only), tick **Show "Sign in with Keycloak" on the sign-in pages** and choose **Save**. A secret saved by **Set up for me** is used instead of `OIDC_CLIENT_SECRET`.

ATLAS calls Keycloak only at an address on the internet, over https, or at `localhost` for a Keycloak on the same server. If the school's Keycloak is on the campus network (ATLAS installed on campus), whoever runs the server lists its name in the server setting `KEYCLOAK_PRIVATE_HOSTS`; it cannot be set from the Admin panel. When Keycloak refuses something, ATLAS shows its status and error code (for example `invalid_client`), not Keycloak's own message.

Leave **Keep ATLAS passwords too** ticked while people get used to it. When you untick it, everyone except administrators must sign in with Keycloak; administrators keep their password in case Keycloak is down. Anyone else who types a password is told to use Keycloak, whether the password was right or not.

![Single sign-on settings](admin-sso.jpg)

### Put ATLAS behind Cloudflare

Cloudflare stands in front of the server: it keeps attacks and floods of traffic away from it and makes ATLAS faster to load. People then reach ATLAS at a name on the school's own domain, such as `atlas.school.edu.ph`; the DuckDNS address keeps working. A duckdns.org address itself cannot go on Cloudflare.

You need three things:

- The school's domain on Cloudflare, shown there as **Active**. Adding a domain to Cloudflare means changing its nameservers where the domain is registered; Cloudflare shows which.
- A Cloudflare API token for that domain (the steps are below, and on the page).
- The server's Cloudflare helper, installed once: whoever looks after the server runs `sudo bash /opt/ltdc-lms/deploy/aws/upgrade-server.sh` from a console (see the server guide, `deploy/aws/EC2.md`). Until then the page says *The server's Cloudflare helper is not installed.* You can still do the Cloudflare side first; the server switches over once the helper is there.

To make the API token:

1. Sign in to Cloudflare and open **My Profile → API Tokens**.
2. Choose **Create Token**, then **Create Custom Token**.
3. Under **Permissions**, add three: **Zone · Zone · Read**, **Zone · DNS · Edit** and **Zone · Zone Settings · Edit**.
4. Under **Zone Resources**, choose **Include · Specific zone** and the school's domain.
5. Choose **Continue to summary**, then **Create Token**, and copy the token.

To set it up:

1. Under **System**, choose **Cloudflare**.
2. In **Set up for me**, type the **New address for ATLAS**, for example `atlas.school.edu.ph`.
3. Check **This server's address**: on AWS it is filled in for you. It must be the server's public IPv4 address.
4. Paste the token in **Cloudflare API token** and choose **Set up in Cloudflare**. ATLAS adds the address to the domain in Cloudflare, pointing at this server through Cloudflare, sets **SSL/TLS** to **Full (strict)** and the oldest TLS version allowed to 1.2, and says what it did.
5. The page shows *Waiting for the server to switch over* while the server gets an HTTPS certificate for the new name, usually a minute; it checks every few seconds. Then it shows **Active**, with **HTTPS certificate** and **Through Cloudflare** ticked. If it shows **Failed**, it says why: fix that and choose **Set up again**.

ATLAS uses the token for this one request and does not keep it; you can delete it in Cloudflare afterwards. If the name already has another record in Cloudflare (a CNAME, for example), or the token lacks a permission, ATLAS changes nothing and says what to fix. **Set up again** is safe to repeat: it only changes what is not right yet. For the first minute, the new address may show Cloudflare's *Error 526* until the server has its certificate.

> **Important:** The SSL/TLS setting is for the whole domain in Cloudflare. If the school has other websites on the same domain that go through Cloudflare, they now need a valid HTTPS certificate too. ATLAS warns you when it changed this setting.

> **Note:** ATLAS does not turn on Cloudflare's **Always Use HTTPS**: ATLAS sends visitors to HTTPS itself. If it is on, the page warns you, because it may block the server's certificate renewals; you can turn it off in Cloudflare under **SSL/TLS → Edge Certificates**.

**Only accept visitors through Cloudflare.** Once Cloudflare is **Active**, tick this under **Who may reach the server**. The server's firewall then accepts web visitors from Cloudflare only, so nobody can go around Cloudflare to the server's own address (the DuckDNS address then no longer opens ATLAS in a browser either). The server turns it on only after it has checked that ATLAS answers through Cloudflare. Untick it to accept visitors from anywhere again.

**Switch Cloudflare off.** Choose **Switch Cloudflare off** and confirm. The server goes back to its DuckDNS address only. ATLAS does not change Cloudflare: the DNS record it made stays there, and you can delete it in Cloudflare under the domain's **DNS** page.

> **Important:** If single sign-on is set up, Keycloak sends people back only to the address it knows. After the switch, open ATLAS at the new address and choose **System → Single sign-on → Set up again**, so Keycloak learns the new address.

![System → Cloudflare](admin-cloudflare.jpg)

### Set the rules for documents

**Document control** sets the rules of [ATLAS Documents](documents) for the whole school. Administrators have it; to give it to another account type (for example the records officer's), tick **Document control** under **Roles & permissions → ATLAS Documents**, or give it to one account (or take it from one) under **System → Users & Access → Access**. Whoever has it also manages every document and folder. Those who do not use the Admin panel find the same page in ATLAS Documents.

1. Choose **Document control**.
2. On **File types**, tick the kinds of file people may add, and choose **Save**. PDF, pictures, Office and OpenDocument files, RTF, text and e-mail are on at first; ZIP archives, audio, video and CAD drawings are off. The list under *Always refused, whatever is ticked* (programs and scripts, web pages and SVG, Office files with macros) cannot be switched on.
3. On **Uploads & storage**, set the largest file (up to 100 MB), the storage each person may keep (0 = no limit), how many versions of a document are kept, and whether the same file twice in a folder is refused. Choose **Save**.
4. On **Sharing**, choose whether people may share inside the school, whether staff may share with everyone at once, whether staff may make links for people outside the school and upload links, who makes links, whether every link needs a password (switching it on also stops the links already made without one), how long links last, and which classifications may be shared by link (never *Restricted*). Choose **Save**.
5. On **Retention**, set the days in the trash before documents are deleted for good, and the longest check-out. Choose **Save**.

![Document control: the kinds of file ATLAS Documents accepts](admin-document-control.jpg)

Every change applies at once and is recorded in the **Settings center**'s history. Students never make links or share with groups, whatever is set here.

### Watch documents and links

1. Choose **Document control → Activity**.
2. The figures show the storage used, documents, versions, folders, the trash, legal holds and files received through upload links that are not reviewed yet.
3. Under **Links that work**, choose **Turn off** for one link, or **Turn all off** (for example after a leak). They stop working at once.
4. **Refused uploads** lists each file ATLAS refused, who tried, and why (for example *Name and content differ* for a “.pdf” that is not a PDF, or *Wrong kind for a new version* for a new version that is not the same kind of file as the document).
5. Choose **Check every file now** under **Integrity check**: ATLAS opens every stored file and compares it with its fingerprint. A file changed or damaged on the disk, or missing after a restore, is listed. If the check cannot finish, it says why; choose the button again to retry.

![Document control: activity, links that work, refused uploads and the integrity check](admin-document-activity.jpg)

To keep a document or folder from being deleted (for an audit or a case), open it in ATLAS Documents and choose **Legal hold** (on a folder: **Folder → Place on legal hold**). Only document managers place or lift a hold. A hold on a folder holds everything inside it, however deep: nothing there is deleted, moved out or loses old versions, and the folders above it cannot be deleted. While a hold applies, **Move to trash** and **Delete for good** are greyed out, with the reason beside them.

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

**System → Sign-in and passwords** shows whether the password hashes are encrypted, and with which key.

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
| Enrollment | Applicants | Admit or decline new students who registered from the sign-in page (title, name parts, email, mobile number, campus) |
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
| Configuration | Settings & branding | School name, current term, passing grade, enrollment rules, brand (ATLAS or your school), short name, colours, logo, applications, uploads and quizzes, numbering |
| Configuration | Home page & systems | The tiles on the ATLAS home page, the address of systems not built in, and who may use the **Tools** (PDF Studio) |

| Configuration | Settings & branding | School name, current term, passing grade, enrollment rules, brand (ATLAS or your school), short name, colours, logo, applications, passwords and sign-in, uploads and quizzes, numbering |
| Configuration | Home page & systems | The tiles on the ATLAS home page, and the address of systems not built in |
| Configuration | Single sign-on | Signing in with the school's Keycloak account |
| Configuration | Admins, registrars & deans | Accounts for administrators, registrars and deans |
| Configuration | Roles & permissions | What each account type may do in each system |
| Configuration | Document control | The rules of ATLAS Documents: file types, uploads and storage, sharing and links, retention, activity and the integrity check |
| Configuration | Demo data & backup | Add or remove the demo school; download or restore a backup |
| System | Users & Access | Every account in every system, with Edit, Access, Reset password, Unlock, Sign out, Audit log and Delete; what each account type can do (administrators only) |
| System | Roles & permissions | What each account type may do in each system |
| System | Sign-in and passwords | Password rules, lock-out, idle sign-out and rate limits, for every system |
| System | Single sign-on | Signing in with the school's Keycloak account |
| System | Cloudflare | Putting ATLAS behind Cloudflare at a name on the school's own domain; only accepting visitors through Cloudflare; switching it off |
| System | Audit log | Sign-ins, failed sign-ins, every change (field by field) and refused requests, with a check that the log is intact; export |
| System | Security monitor | The server's checks, refused requests and addresses to watch, the controls in force, traffic and response times, and who is signed in; the metrics token |
| Elsewhere | ATLAS home | The ATLAS home page, in a new tab |

## Questions

**Which account types are there, and where are they made?**

| Account type | Made in |
|---|---|
| Administrator, Registrar, Dean / Program chair | System → Users & Access → + Add user |
| Teacher, Student | Admin panel → Teachers, Students (or Applicants) |
| Parent / Guardian | Admin panel → Parents & guardians |
| HR Manager, Payroll Officer, Staff | ATLAS People, on the employee's record, or System → Users & Access → + Add user |
| Chief Accountant, Budget Officer, Cashier, Supply & Property Officer, Approving Officer | ATLAS Finance → Control panel, or System → Users & Access → + Add user |
| Job applicant | Nobody: people outside the school sign up themselves from **Job openings** on the ATLAS home page, while an opening is Open to all. HR extends or removes them in People → Recruitment → Applicant accounts |

**Why can't I delete an account?** Students, teachers and parents are disabled, not deleted, so their records stay. Under **System → Users & Access**, an account with no records can be deleted; you cannot delete your own account or the last active administrator. Disabling works the same way: you cannot disable yourself or the last active administrator.

**Why does a registrar see the settings but cannot change them?** Modules, settings, activity types, campuses and systems are for administrators. Registrars see them read-only, with *Only administrators can change these.* (**System**, with **Users & Access**, **Roles & permissions**, **Single sign-on** and **Cloudflare**, is for administrators only.) To let registrars change them, tick the permission for **Registrar** under **Roles & permissions**.

**Everyone was signed out at once.** Sign-ins are kept in the server's memory, so restarting ATLAS signs everyone out. People are also signed out after 8 hours without activity (change it under **System → Sign-in and passwords**). To sign one person out, use **Sign out** on their row in **Users & Access**.

**Can the sign-in pages and the systems show our school instead of ATLAS?** Yes: under **Settings & branding → Branding**, choose **Our school, powered by ATLAS**, type the school's short name and upload its seal. See [Lead with your school's name and seal](#lead-with-your-school-s-name-and-seal).

**Who changed this setting?** Open **Settings center**, find the setting and choose the clock button beside it: its history lists each change with who made it, when, and the value before and after.

**I gave an account type a permission, but its people do not see the new screen.** Permissions apply at their next page load; ask them to reload, or sign out and in again.

**I am locked out of the only administrator account.** On the server, stop ATLAS and run `npm run reset-password -- <username> <new-password>`, then start it again.

**The new address shows Cloudflare's Error 526.** Cloudflare cannot find a valid certificate on the server yet. Right after **Set up in Cloudflare** this lasts about a minute, while the server gets one. If it stays, open **System → Cloudflare**: the server's answer says what went wrong (often the helper is not installed yet, or the address does not point at this server).

**Does a backup include uploaded files?** No. **Download backup** holds the records only. To keep class resources and handed-in work too, copy the server's whole `data` folder.

**Does a backup include uploaded files?** No. **Download backup** holds the records only. To keep class resources, handed-in work and ATLAS Documents' files too, copy the server's whole `data` folder.

**What must I keep to restore ATLAS Documents?** The `data/documents` folder and the server key (`server.key` beside the data file, or `SERVER_KEY` on the server). Every document is encrypted under that key: without it, a copy of the files cannot be opened, by anyone. Keep a copy of the key somewhere safe, apart from the backups.

**Can I read a teacher's or student's own files?** An administrator (and anyone with **Document control**) can open any document, so that nothing is lost when someone leaves. Your own lists (**Shared with me**, **Recent**, **Trash**) still show only what was shared with you, and other people's **My files** are not listed with your folders.
