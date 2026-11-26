---
id: admin
title: Administering CORE
summary: For administrators: the Admin panel. User accounts, roles and permissions, access grants, modules, the Settings center, company settings and branding, sign-in security, Document control, the security monitor, the audit log, the dev log, feedback, backups and demo data, and editing the Help guides.
roles: admin
apps: system, home
order: 60
---

## Before you start

This guide is for **administrators**: the people who give others their accounts, decide what each account type may do and which modules the company uses, keep the company settings and the backups, and watch the audit log. An administrator can open every module and every screen. The work of each module is in its own guide: [HR](hr), [payroll](payroll), [IT assets](it-assets), [the service desk](service-desk), [sales](sales) and [projects](projects).

Everything an administrator looks after is in one place, the **Admin panel**, inside CORE's one sign-in (there is no separate sign-in page):

- On the **CORE home**, the **Administration** section starts with the **Admin panel** card, followed by shortcuts to **Users & Access**, the **Settings center**, the **Dev log** and the **Feedback inbox**.
- In every module, the side menu ends with **Administration → Admin panel** (the number next to it counts new feedback and dev log releases you have not opened). The **modules** button at the top right also lists **Admin panel**.
- The Admin panel has its own side menu: **Dashboard**; **People** (**Users & Access**, **Roles & permissions**, **Access grants**); **Configuration** (**Settings center**, **Modules**, **Settings & branding**, **Sign-in & security**, **Help & guides**, **Document control**); **Records** (**Security monitor**, **Audit log**, **Dev log**, **Feedback inbox**); **Data** (**Backup & restore**, **Demo data**); and **Elsewhere** (**CORE home**, **Send feedback**).
- Old links still work: an address such as `#/settings` or `#/users` opens the page in the Admin panel.

The first administrator is created the first time CORE starts: CORE asks for a name, a username and a password. Keep at least two administrator accounts, so one can help the other. To try things out, load the demo data (see [Load or remove the demo data](#load-or-remove-the-demo-data)). It adds the demo accounts `hr.demo`, `payroll.demo`, `it.demo`, `sales.demo`, `pm.demo` and `employee.demo`, all with the password `demo1234`.

## Walkthrough

A first tour of the Admin panel, signed in as `admin` with the demo data loaded. It takes about fifteen minutes.

### The dashboard

1. Sign in and choose the **Admin panel** card under **Administration** on the CORE home. The **Dashboard** opens.
2. The line under the title is the **version** of CORE and the build it runs.
3. **People** counts the active accounts (and the disabled ones), the accounts **signed in now**, how many have **2-step verification on** (and how many must still set it up), and **temporary passwords not changed** yet. Below, the active accounts by account type.
4. **Security, last 24 hours** counts **failed sign-ins**, wrong 2-step codes and **usernames locked**, and shows the **Audit log check**: *Intact* when no entry was changed since it was written. **Security monitor**, beside it, opens the full picture (see [Watch the security monitor](#watch-the-security-monitor)).
5. **Modules** shows which modules are on; **Waiting for you**, feedback awaiting a reply and dev log releases you have not opened; **Data**, the size of the data file and the attached files, when a backup was **last downloaded** and whether the demo data is loaded. Each part links to its page.

![The Admin panel dashboard](admin-dashboard.jpg)

### Accounts, roles and access

1. Choose **Users & Access**. The table lists every account with its **Account type**, **Linked employee**, **Status** (*Active* or *Disabled*, *Temp. password* until they choose their own, *Demo* for demo accounts), **2-step** (*On*, *Off*, or *Not set up* when the company requires it) and **Last sign-in**, with how many devices the person is signed in on.

![Users & Access](admin-users.jpg)

2. Choose **Roles & permissions**. Each account type is listed with its active accounts, then a table per part of CORE (**Human Resource Management**, **IT Asset Management**, **IT Service Desk**, **Sales & CRM**, **Project Management**, **Document Management**, **Admin panel**): a tick means that account type may do it. *default* marks what CORE gives it; a shaded box differs from the default.

![Roles & permissions](admin-roles.jpg)

3. Choose **Access grants**. One table shows everyone with an active account and whether they are a **Service Desk agent**, use **Sales & CRM** and use **Projects**, by their account type or by access given to them alone.

### Settings

1. Choose **Settings center**. Every setting of every module is listed by group, with its value **Now** and its **Default**. Type *SLA* in **Find a setting** to find the service desk's service levels.
2. Choose **Modules**. Each module has a switch; all are on.
3. Choose **Settings & branding**. Under **Company**, the **Company name**, **TIN** and **Address** are printed on every payslip; the name also shows on the CORE home and the sign-in page. **Default work schedule** is the schedule new employee records start with. **Branding** holds the brand colour, the logo and the sign-in headline.
4. Choose **Sign-in & security** for the 2-step verification policy, session lengths and the limits on requests and failed sign-ins.

### Records and data

1. Choose **Audit log**. The green notice **Intact** says no entry was changed, removed or reordered since it was written. **Keyed from entry N** means the entries from that number on are sealed with this server's key. The list shows the last 30 days, newest first. Pick **Sign-in** under **All areas** to see who signed in, and every failed sign-in.

![The audit log](admin-audit.jpg)

2. Choose **Dev log**: the **version** installed, and every release of CORE, newest first. The number next to **Dev log** in the menu counts releases you have not opened yet.

![The dev log](admin-devlog.jpg)

3. Choose **Feedback inbox**. What people send with **Send feedback** lands here, newest first.
4. Choose **Backup & restore** and **Demo data**. The *Loaded* badge says the demo data is in.

## How to…

### Add a user

1. Open **Admin panel → Users & Access** and click **+ Add user**.
2. Enter the **Full name** and a **Username** (3 to 32 letters, numbers, dots, dashes or underscores).
3. Type their **Role in the company**, such as *Software Engineer* (empty means *Employee*), and pick the **Account type**. What the account type may do is shown under it.
4. Under **Linked employee record**, pick the person's employee record. It is required for an *Employee* account and gives other account types the **My account** pages (their own attendance, payslips and requests).
5. Type a **Temporary password** of at least 8 characters, leave **Ask them to choose a new password at first sign-in** ticked, and click **Create user**.

Give the person their username and temporary password privately. They choose their own password the first time they sign in.

| Account type | For |
|---|---|
| Administrator | Everything, including accounts, roles, settings, backups and the audit log |
| HR Manager | Employees with pay, attendance, leave approvals, payroll setup and holidays; views payroll and IT assets |
| HR Staff | Day-to-day HR without pay, government IDs or bank details; no payroll, no approvals |
| Payroll Officer | Payroll runs, payroll setup, holidays and leave credits; views employees and attendance |
| IT Asset Manager | IT assets and stock; works service desk tickets |
| Helpdesk Agent | Service desk tickets; views IT assets |
| Sales Officer | Sales & CRM, without deleting or the sales setup |
| Sales Manager | Sales & CRM, with deleting and the sales setup; the projects they are added to |
| Project Manager | Runs Project Management; views employee records |
| Employee | Self-service only |

These are CORE's defaults; your company can change them under **Roles & permissions**.

### Set someone's role in the company

1. Open their profile: click their name in **Admin panel → Users & Access** (or anywhere their name is a link).
2. Click **Change role in the company**, type the role (CORE suggests the ones already in use) and click **Save role**. Empty means *Employee*.

Or edit the user under **Users & Access**: **Role in the company** is in the same form. Only administrators can change it; the change is in the audit log. Everyone sees it beside the person's name at the top right and on their profile. It is a job title only: what the person can open is still their **account type** and any access grants, and their profile shows both (*What they can open*, for you and for them).

### Change what an account type may do

1. Open **Admin panel → Roles & permissions**.
2. In the table for a part of CORE, tick or untick a permission for an account type. A shaded box differs from the default; *default* marks what CORE gives that account type. On a phone (also turned sideways), pick the account type under **Account type to show**: the tables then show its column only.
3. Click **Save permissions** in the bar at the bottom (**Discard** forgets the changes). If accounts would lose something they can do now, CORE asks first.

Everyone with that account type gets the change the next time they open a page; the server applies it at once. For example, let **HR Manager** read the **Audit log** (under **Admin panel**), or take **Add and edit employees** from **HR Manager** so only administrators add employees. **Restore defaults** on an account type puts it back as CORE made it.

Some things never change:

- **Administrators** always have every permission; their column cannot be changed, so nobody can lock the administrators out.
- **Manage user accounts and access grants; sign-in & security settings**, **Roles & permissions** and **Backup, restore and erase data** are marked *Administrators only* and cannot be given to another account type (with them, an account could make itself an administrator or replace every record).
- Access given to one person under **Access grants** still applies on top of their account type.

Every change is recorded in the **Settings center**'s **Change history** (where it can be undone) and in the **Audit log**, permission by permission.

![Roles & permissions](admin-roles.jpg)

### Give someone the service desk, Sales & CRM or Projects

Some access can be given to one account on top of its account type, or taken from it:

1. Open **Admin panel → Access grants**.
2. In the person's row, under **Service Desk agent**, **Sales & CRM** or **Projects**, choose **Given** or **Removed**. **Account type (yes)** or **Account type (no)** goes back to what their account type allows.

The change is saved at once. **Users & Access** then shows *+ Helpdesk agent*, *+ Sales & CRM* or *+ Projects* under the account type. Sales & CRM and Projects access let the person see and edit; removing it from a Sales Manager or Project Manager also takes away deleting and the setup. Administrators always have all three. The same switches are still in each module's settings (**Agents**, **Team access**).

You do not need Projects access to work on a project: its project manager adds people as members, and members open their projects whatever their account type.

![Access grants](admin-access-grants.jpg)

### Change an account type, or disable an account

1. Open **Admin panel → Users & Access** and click **Edit** on the row.
2. Change the **Account type** or the **Linked employee record**.
3. To stop someone signing in, untick **Account is active (can sign in)**. They are signed out at once.
4. Click **Save**.

You cannot change your own account type or disable your own account, and there must always be one active administrator. A disabled account keeps its history; tick the box again to let the person back in.

### Reset a password

1. Open **Admin panel → Users & Access** and click **Reset password** on the row.
2. Type a **New temporary password** and click **Reset password**.

The person is signed out everywhere and must choose a new password at the next sign-in. The temporary password follows the password rules too (see [Set the sign-in and security rules](#set-the-sign-in-and-security-rules)). After 5 wrong passwords a username is locked for 5 minutes, then 15, then an hour if the wrong passwords continue; it unlocks by itself.

### Sign someone out everywhere

1. Open **Admin panel → Users & Access**. **Last sign-in** shows *Signed in on N devices* for someone signed in now.
2. Click **Sign out everywhere** on the row and confirm.

They can sign in again with their password. To keep them out, disable the account instead.

### Reset someone's 2-step verification

For someone who lost their phone and their recovery codes. Confirm who they are first (in person or by a call you place).

1. Open **Admin panel → Users & Access** and click **Reset 2-step** on the row.
2. Confirm **Reset 2-step**.

They are signed out, sign in with their password only, and set up 2-step verification again if the company requires it. Your own 2-step verification is changed under your name → **My security**.

### Remove someone's profile picture

1. Open **Admin panel → Users & Access** and click **Remove picture** on the row.
2. Confirm **Remove picture**.

Their initials show instead, everywhere. They can add another picture themselves; you cannot add one for them. The removal is in the audit log. Your own picture is under your name at the top right, like everyone's. Deleting an account deletes its picture.

### Delete an account

1. Open **Admin panel → Users & Access** and click **Delete** on the row.
2. Confirm.

The person can no longer sign in. Their employee record is not affected, and the audit log keeps what they did. Disabling is usually the better choice.

### Turn a module on or off

1. Open **Admin panel → Modules**.
2. Use the switch of a module: **Human Resource Management**, **IT Asset Management**, **IT Service Desk**, **Sales & CRM**, **Project Management** or **Document Management**, or of a tool: **PDF Studio** (on the CORE home under **Tools**, for everyone; see [the PDF Studio guide](pdf-studio)). Turning one off asks you to confirm; CORE then says, for example, *Sales & CRM is now off for the company.*

A module that is off disappears from the CORE home, the modules menu and the side menus of everyone except administrators, and CORE refuses it even if someone types its address. Administrators still see it, marked **Off**, and can open it and its settings. Nothing is deleted: turning it back on shows everything again. While it is off its background work waits (reading the service desk mailbox; the Projects daily digest), and the service desk's public form (`/support`) is closed.

While a module is off, its notifications are hidden from the bell of everyone except administrators; they come back when it is turned on again.

Self-service belongs to the module it is part of. With **Human Resource Management** off, employees no longer clock in or out, file leave or see their payslips in CORE (**My Home**, **My Attendance**, **My Requests**, **My Payslips** and **My HR record** go with it); **My Assets** stays with IT Asset Management and **My tickets** with the service desk. The holiday calendar can still be read, because Projects counts working days by it. Buttons that lead into a module that is off (*Add to a project* or *Send to Sales & CRM* on a ticket, *Start project* on a deal) are hidden.

![Modules](admin-modules.jpg)

### Show or hide what is coming soon

What is on CORE's roadmap shows greyed out, marked **Coming soon**: the modules **Finance & Accounting**, **Procurement** and **C-suite** on the CORE home and in the modules menu; the integrations **Microsoft 365**, **Google Cloud**, **CodeRabbit** and **PhilGEPS** under **Integrations** on the CORE home; and **Data replication** in the IT Asset Management side menu. Nothing can be opened or set up in them yet.

1. Open **Admin panel → Modules** and scroll to **Coming soon**. They are grouped as **Modules**, **Integrations** and **Pages in a module**, with where each one shows.
2. Turn a switch off to hide one: CORE says, for example, *Procurement is now hidden from everyone.* Turn it on to show it again. **Hide all** and **Show all** change them all at once; the line under the table counts how many are shown.

A hidden one is gone from the CORE home, the modules menu and the side menu for everyone, administrators included; with all three integrations hidden, the **Integrations** area goes too. Showing it brings it back as it was. Hiding never turns a live module off (that is the switch above), and the change is in the audit log and the Settings center (*Procurement (coming soon): Shown → Hidden*).

![Coming soon, shown or hidden](admin-modules-soon.jpg)

### Find any setting and compare it with the default

The **Settings center** lists every setting in CORE (the Admin panel, Human Resource Management, the service desk, Sales & CRM and Projects) in one place.

1. Open **Admin panel → Settings center**.
2. Type in **Find a setting**, e.g. *password*, *radius* or *SLA*, or choose a module such as **Human Resource Management**.
3. Tick **Only changed from the default** to see what your company has changed. Each setting shows its value **Now**, its **Default**, *Differs from default* when they differ, and who changed it last.
4. To change a setting, choose **Open** on its group: its own screen opens.

The company's own information (its name, address and TIN) has no default. Payroll Setup, leave types and the service desk's email settings are listed so you can compare them, and are changed on their own screens only (no restore, undo or import here). No password is shown or kept: the service desk's mail passwords never leave their screen.

![The Settings center: every setting, by module](admin-config.jpg)

### Restore a default or undo a change

1. In the **Settings center**, find the setting and choose **Restore default**, or **Restore defaults** on its group to put the whole group back.
2. Confirm with **Restore**.

Every save on any settings screen in any module is recorded under **Change history**: who, when, and each setting's value before and after. Restoring a backup or erasing all data is recorded too. To take a change back, choose **Undo** on it; CORE refuses if the setting has been changed again since (undo the later change first). A change is saved through its own screen's checks, so a default or an undo is refused if that screen would refuse it.

![Change history with the value before and after](admin-config-history.jpg)

### Copy settings to another CORE

1. In the **Settings center**, choose **Export & import**, then **Export settings**. A file with the company's settings downloads: company details, the default schedule, branding, sign-in & security, modules, roles and permissions, clock-in locations, approvals, the service desk's ticket settings and public form, the sales setup and the Projects setup. It has no people, records, passwords or mail server sign-ins.
2. On the other CORE, choose **Choose a settings file…** and pick that file.
3. Read what would change, untick any group you want to keep as it is, and choose **Import the ticked groups**.

Each group is checked by its own screen's rules. If one group is refused, nothing is imported. Keep an export before big changes: importing it puts everything back.

### Change the company details and default schedule

1. Open **Admin panel → Settings & branding**.
2. Under **Company**, enter the **Company name** (required), **TIN** and **Address**.
3. Under **Default work schedule**, set **Shift start**, **Shift end**, **Unpaid break (minutes)** and the **Work days**.
4. Click **Save settings**. If something is missing, the field is outlined with a message under it and CORE takes you to it.

Pay rules, rates and tax tables are not here: they are in **Payroll Setup** (see [the payroll guide](payroll)).

![Settings & branding: company details and the default schedule](admin-settings.jpg)

### Change the brand colour, logo and sign-in headline

1. Open **Admin panel → Settings & branding** and scroll to **Branding**.
2. Under **Brand colour**, choose a preset (**CORE Maroon** is the default) or **Company colour**. For your own colour, pick it with the colour box or type it, e.g. `#1e3a5f`. CORE checks that white text on it is readable (a contrast of at least 4.5 : 1) and refuses a colour that is too light.
3. **Upload logo**: a PNG, JPEG or WebP picture. CORE makes it at most 400 pixels and refuses it if it is still over 300 KB. **Remove the logo** goes back to the CORE mark. SVG pictures are not accepted.
4. Type a **Sign-in headline**: the large line on the sign-in page. Empty, it is *Every part of the company, on one core.*
5. Click **Save settings**.

The colour changes on screen as you choose it, so you can try colours before saving; leaving the page without saving puts the saved one back. Once saved, every module, the Admin panel, Help & guides and the sign-in page use it, in light and dark mode; the logo shows on the sign-in page and the CORE home.

![Branding: brand colour, logo and sign-in headline](admin-branding.jpg)

### Set the sign-in and security rules

1. Open **Admin panel → Sign-in & security**.
2. Under **2-step verification**, choose *Optional for everyone*, *Required for Administrators* or *Required for everyone*. Turn it on for your own account first (your name → **My security**): CORE will not let you require it of yourself before.
3. **Sign out after (idle minutes)**: people are signed out after this long without using CORE (480 = 8 hours). **Longest session (hours)**: they sign in again after this long, even if in use.
4. **Requests per minute, per person**: more than this is refused for a moment. 300 is plenty for normal use.
5. **Failed sign-ins per network address**: in 15 minutes, for any usernames; then that address waits. An office where everyone shares one internet address may need a higher number.
6. **Refuse common passwords and passwords with the username or name**: on unless you untick it.
7. Click **Save sign-in settings**.

When 2-step verification becomes required, people without it are asked to set it up the next time they sign in, and can do nothing else in CORE until they have. The **Dashboard** counts who still has to.

![Sign-in & security](admin-security.jpg)

> **Note:** Always on: the username lock after 5 wrong passwords; a password change, an account type change or turning on 2-step verification signs the account out on other devices; and every sign-in, failed sign-in, lock and 2-step change is in the audit log.

### Set up Document control

**Admin panel → Document control** (also at the end of the **Document Management** side menu) sets the rules of Documents for everyone. It needs the *Documents: Document control* permission, which administrators have; give it to another account type under **Roles & permissions** to let them look after the company's documents (they then also open every document and folder, and place legal holds). How people use Documents is in [the Documents guide](documents). Each tab has **Save** and **Use the defaults on this tab**; every field shows its default, and every change is in the audit log (*Changed Document control*).

![Document control: the kinds of file accepted](documents-control.jpg)

1. **File types**: one switch per kind of file (PDF, Pictures, Word, Excel, PowerPoint, Office 97–2003, OpenDocument, Rich Text, Text, CSV and data, E-mail messages, ZIP archives, Audio, Video, CAD drawings), with its extensions. ZIP, audio, video and CAD are off at first. CORE reads the kind from the file's content and refuses a file whose extension does not match it. The last row, **Programs and scripts, web pages and SVG, and Office files with macros**, is locked: always refused, with its full list of extensions. Turning a kind off stops new uploads of it (people see *Pictures files are not accepted here*); documents already stored stay.
2. **Uploads & storage**: the **Largest file** (up to 100 MB; 50 MB at first), **Space per person** (2,048 MB; 0 = no limit), **Versions kept per document** (20) and what happens to **The same file twice in a folder** (keep it and say so, or refuse it).
3. **Sharing**: whether people may share with others inside the company, and with *Everyone signed in*; whether **links outside the company** and **upload links** are allowed (turning links off stops every existing link until you turn them on again); **Who makes links** (anyone who may share, or document managers only); whether **every link needs a password** and the **shortest link password**; how long **a new link lasts** and the **longest a link can last**; the **download limit suggested**; and which **classifications may be shared by link** (*Restricted* is locked off). The **Classification levels** table explains the four levels.
4. **Retention**: **Days in the trash** before documents are deleted for good (30), and the hours after which a **check-out ends by itself** (72).
5. **Activity**: the storage used (encrypted), the documents, versions and folders, files received and not reviewed, the trash and legal holds; every **working link** with what it shares, who made it, until when and how much it was used, with **Turn off** for one and **Turn all off**; the **refused uploads** with who, when and why; and the **Integrity check**: **Check every file now** decrypts every stored version and compares it with the fingerprint taken when it was added, and counts stored files no document uses.

![Document control: links, refused uploads and the integrity check](documents-control-activity.jpg)

> **Tip:** If a link was sent to the wrong person, turn it off here or on the document. If you are unsure which links are out there, **Turn all off**: people make new ones when they need them.

### Back up and restore

1. Open **Admin panel → Backup & restore**.
2. Click **Download backup**. CORE saves one file with all the company's data, named after today's date. The page (and the **Dashboard**) shows when the last backup was downloaded, and by whom.
3. To go back to a backup, click **Restore backup…**, pick the file, enter **your password** and click **Restore**. Everything now in CORE is replaced by the backup.

Download a backup regularly and keep it somewhere safe and private: it holds pay, government IDs, bank accounts and the user accounts (passwords are stored as secure hashes). Attached files (medical certificates, ticket files, files on project tasks and deliverables) and the audit log are not in the backup file; copy the `data` folder for those. A restore keeps the current user accounts when the backup has none. CORE checks the user accounts in the file first: a backup with an invalid account, or with no active Administrator, is refused and nothing is changed. Roles and permissions in a backup are taken only as CORE writes them: an *Administrators only* permission in the file is dropped.

> **Note:** Restore only backups you downloaded from CORE yourself. The user accounts in the file replace the current ones.

On the AWS server CORE also backs itself up: **every hour** the data file, the audit log and new attached files are copied to a private storage bucket away from the server, and **every night** the latest copy is restored into a throw-away copy and checked (it opens, has an administrator, and its audit log is intact). **Admin panel → Security monitor → Software status** shows both, under **Off-server backup** and **Restore check**: *Fine* when they are current, *Problem* with the reason when not. The steps to restore from these copies, including onto a new server, are in `deploy/aws/RESTORE.md`, for whoever runs the server.

![Backup & restore](admin-data.jpg)

### Erase all data

1. Open **Admin panel → Backup & restore** and click **Erase all data**.
2. Click **Erase everything** to confirm.

This removes all employees, attendance, payroll runs, assets, tickets, sales records, projects and the company settings. User accounts are kept (except the demo accounts), and so are roles and permissions, which modules are on, the dev log, feedback, your Help guide edits, the service desk mail setup, the sales setup and the audit log. Download a backup first.

### Load or remove the demo data

1. Open **Admin panel → Demo data**.
2. Click **Add demo data** and confirm. CORE adds sample employees with attendance and leave, IT assets and stock, service desk tickets, a full sales book (30 organizations with their contacts, 47 deals in every stage over the past year and the next six months, leads, public bids, contracts with some due for renewal, and a history of calls, meetings and tasks), 26 projects in every state (planning, active, on hold, completed, cancelled), most of them delivering the sales demo's contracts, with about 260 sized tasks, milestones, comments, and three support contracts that track time, and the demo accounts, next to your own data.
3. **Reload demo data** replaces the demo records with a fresh set.
4. **Remove demo data** takes out every demo record and the demo accounts. Your own records stay.

Demo records are numbered *DEMO-…*. Demo employees are included in new payroll runs until you remove them, so remove the demo data before the first real payroll.

### Check the audit log

1. Open **Admin panel → Audit log**.
2. Set **From** and **To**, an area (**Sign-in**, **User accounts**, **Employees**, **Payroll**, **Settings**, **Backup & data** and others) and a person under **Everyone**. Type in the search box to find a name, record or change.
3. Click **Export CSV** for a file of the entries shown.

The log records every sign-in and failed sign-in, every change to employees, pay, attendance, leave, payroll runs, payroll setup, holidays, users and settings, field by field; changes to roles and permissions and to modules; views of records with pay or full ID numbers; certificate openings; backups, restores, demo data and erasing; and changes in the other modules. Every look at employee records is logged too, once per person and record in 10 minutes. Government ID and bank numbers appear masked, and names or notes are kept without control characters. Entries cannot be edited or deleted from CORE.

> **Important:** If the notice says **The log was altered**, the file was edited outside CORE at the entry it names. If it says **Entries are missing**, lines were removed from the end of the file outside CORE (CORE remembers its last entry, sealed with the server's key, so this shows even after a restart). Either way, keep a copy of the `data` folder and find out who had access to the computer or server.

### Watch the security monitor

**Admin panel → Security monitor** shows how CORE is doing: whether the software is healthy, what the API refused and from where, how much CORE is used and how fast it answers, and who is signed in. It refreshes every minute while it is open. It is for administrators, and for any account type given **Security monitor** under **Roles & permissions**. Only administrators see the checks about accounts (administrators without 2-step verification, temporary passwords, unused accounts) and the device and address of each session; the recent sign-ins need **Audit log** too.

1. Open **Admin panel → Security monitor**.
2. Choose the period above the figures: **Last hour**, **24 hours**, **7 days** or **30 days**. Every figure and chart on the page follows it.
3. Choose a tab: **Software status**, **API security**, **Traffic** or **User activity**. The four figures at the top sum them up and open them too.

| Tab | What it shows |
|---|---|
| Software status | Checks, each marked **Fine**, **Look at this**, **Problem** or **Note**, problems first, with the reason and a link to where it is fixed: the versions of CORE and Node.js (and when Node.js stops getting security fixes), server errors, memory, responsiveness, disk space, the audit log check, the last backup, the hourly off-server copy and the nightly restore check, who can read the data files, demo data left loaded, HTTPS, rate limits, the 2-step policy and administrators without it, temporary passwords, accounts unused for 90 days and common passwords. **This server** shows the build, the system, how long CORE has run and the size of its files; the charts show memory and responsiveness |
| API security | Refused requests and failed sign-ins over the period; **Addresses to watch** (20 refused requests, 5 failed sign-ins or a locked username); **Refusals by kind**, each with the OWASP API Security Top 10 item it guards against; **Sign-in events**; the **Controls in force**, as set now; the **API inventory**: how many API addresses CORE has, which are open without signing in, how many need a permission |
| Traffic | Page views, the API's response time (median, p95 and p99), server errors and data sent; the **busiest** and **slowest API routes**; the answers by status |
| User activity | Who is **signed in now** (device, network address, when they signed in and were last active); how many people used CORE today, this week and this month; sign-ins and actions over the period; **what people worked on**; the **most active** people; the **recent sign-ins**, failed ones included |

Point at a chart, or select it and use the arrow keys, to read each period; **Show the numbers** lists them all.

![The security monitor](admin-monitor.jpg)

> **Tip:** An office shares one network address, so an address to watch is often your own office. Check the audit log for who used it before blocking anything. Block addresses at the firewall or in AWS, not in CORE.

### Connect an uptime checker or a metrics server

For a tool outside CORE that watches it: an uptime checker such as Uptime Kuma or an AWS load balancer, or a metrics server such as Prometheus with Grafana.

1. For an uptime checker, use the **health check** address shown at the bottom of **Security monitor → API security**. It ends in `/api/public/health` and answers `{"status":"ok"}` while CORE runs, with nothing else and without signing in.
2. For metrics, click **Make a token** under **Monitoring from another tool**. Copy the token at once: CORE keeps only a fingerprint of it and cannot show it again.
3. Set the metrics server to read the **Metrics** address with the header `Authorization: Bearer` and the token. The answer is in the Prometheus format: requests by route and status, response times, refusals by kind, sign-ins, sessions, the audit log check and each status check. It has no names and no network addresses.
4. **Replace the token** makes a new one and stops the old one at once; **Revoke** turns metrics off. Both are written in the audit log.

### Write a dev log entry

1. Open **Admin panel → Dev log** and click **+ New entry**.
2. Check the **Version** and **Date**, and enter a **Title** and a **Summary**.
3. Under **Changes**, pick the type and module for each change and describe it; **+ Add change** adds a row. Add **Known issues** if there are any.
4. Click **Add entry**.

Each update of CORE adds its own entries (*built-in*). **Edit** and **Delete** are on each release; **change** next to the maintainer's name sets the author. **Export CHANGELOG.md** saves the whole log as a file.

### Answer feedback

1. Open **Admin panel → Feedback inbox**. It shows open feedback first; filter by status, type or module, or search.
2. Click a row to read it, then click **Respond**.
3. Pick the **Status** (*New*, *Under review*, *Planned*, *Resolved*, *Closed*), write a **Response** if you like (with the same editor: bold, lists, links), and click **Save response**.

The person sees the status and your response under **Send feedback**, and the **bell** in the top bar tells them *An administrator replied to your feedback FB-0003* (or marked it *Planned*, and so on). Like the Feedback page, it does not say which administrator. **Delete** removes the feedback for them too. Each response, status change and deletion is written in the **Audit log** (who did it and when; not the text of the response). Numbers are never given twice: after FB-0003 is deleted, the next feedback is FB-0004. The number next to **Feedback inbox** counts new feedback; the **Dashboard** counts feedback still awaiting a reply.

![The feedback inbox](admin-feedback-inbox.jpg)

### Send feedback

1. Click **Send feedback** in the side menu (or under your name at the top right) and click **+ New feedback**.
2. Pick the **Type of feedback**, the **Module**, and enter a **Subject** and **Details** (formatted with the editor's bar, or type **/**).
3. Click **Submit feedback**.

Everyone can send feedback this way; only administrators read it.

### Edit a Help guide

1. Open **Admin panel → Help & guides**. Every guide is listed with whom it is for and whether your company edited it. Click **Edit** on a guide (the editor opens in a new tab), or open the guide in **Help & guides** (the **?** button in the top bar) and click **Edit this guide**.
2. Change the text on the left; the **Preview** on the right shows how it will look. The buttons above the text add headings, bold, menu paths, lists, tips, notes, links and pictures.
3. Click **Save**.

Your company's version is shown to everyone from then on and is kept when CORE is updated. The guide is marked *Edited by the company*. Keep the header at the top (between the `---` lines): **title** is required and **roles** says whose guides it appears under. Pictures can only show the screenshots that come with CORE. Every save is written in the audit log.

- **Add your own guide**: click **New guide** (in the Admin panel's **Help & guides**, or at the bottom of the Help menu), enter the **Guide id (its web address)**, for example `office-rules`, fill in the header and the text, and click **Save**. **Delete this guide** removes it.
- **When CORE updates a guide you edited**, **Help & guides** says so, and the guide says *CORE has updated this guide since it was edited here*. Click **Compare and update it**, then **Compare with the new built-in guide** to read the new version and copy what you need.
- **To go back to the guide that comes with CORE**, open the editor and click **Restore the built-in guide**.

![Editing a Help guide](admin-guide-editor.jpg)

### Let someone else help with administration

An HR Manager can, for example, be given the **Audit log**, or a trusted manager the **Settings center**: tick the permission for their account type under **Roles & permissions** (in the **Admin panel** table). They then see **Admin panel** in their menus, with only the pages their permissions open. The **Settings center** shows such an account only the groups of settings it may change on their own screens, and it can restore, undo, export and import only those. Users, roles, sign-in security and data stay with administrators.

### Run CORE on a Windows PC or a cloud server

- **On one Windows PC**: double-click **CORE-ERP.exe**. The data stays on that PC. Start it with `--network` to let other PCs in the office sign in, and use `--reset-password <username> <new password>` (with CORE closed) if the only administrator is locked out.
- **On a cloud server**: CORE runs online over HTTPS, with automatic restarts and nightly backups that also copy the audit log.

Setting these up is described in CORE's README file and in the server set-up instructions that come with it.

## Screens at a glance

| Screen (Admin panel) | What it is for |
|---|---|
| Dashboard | A read-only overview: version and build; accounts by type, signed in now, 2-step adoption, temporary passwords; failed sign-ins and locks in the last 24 hours and the audit log check; modules on or off; feedback awaiting a reply and unopened dev log releases; data size, the last backup and the demo data |
| Users & Access | Accounts: add, edit, disable, reset passwords, delete; 2-step status, sign out everywhere, reset 2-step; link to an employee record |
| Roles & permissions | What each account type may do, per part of CORE; defaults marked; **Restore defaults** per account type (administrators only) |
| Access grants | One table of the access given to (or taken from) one person: Service Desk agent, Sales & CRM, Projects |
| Settings center | Every setting with its value, its default and whether it differs; restore defaults; the change history with undo; export and import of the company's settings |
| Modules | Turn Human Resource Management, IT Asset Management, IT Service Desk, Sales & CRM, Project Management, Document Management and PDF Studio on or off for the company; show or hide what is coming soon (modules, integrations, Data replication) |
| Settings & branding | Company details printed on payslips, the default work schedule, the brand colour, the logo and the sign-in headline |
| Sign-in & security | 2-step verification policy, session lengths, request and failed sign-in limits, common passwords |
| Help & guides | Every guide and whether the company edited it; links to the guide editor |
| Document control | Documents for the whole company: the kinds of file accepted, upload size, space per person and versions kept, sharing inside the company and by link, days in the trash and check-out hours; storage, working links (turn off one or all), refused uploads and the integrity check |
| Security monitor | For a period (an hour to 30 days): software status checks; API security (refusals, addresses to watch, controls, the API inventory, the metrics export); traffic and response times; who is signed in and what people worked on |
| Audit log | Who viewed or changed personal data, payroll, attendance, leave, roles and settings, and every sign-in; the integrity check; CSV export |
| Dev log | The version installed and every release of CORE; write and edit entries; export CHANGELOG.md |
| Feedback inbox | Feedback from everyone: read, respond, set the status, export |
| Backup & restore | Download backup, restore a backup, when the last backup was downloaded; Erase all data |
| Demo data | Add, reload or remove the demo data |
| CORE home | Back to the modules |
| Send feedback | Your own feedback to the administrators, and their responses |

## Questions

**Someone forgot their password. Can CORE email a new one?**
No. Reset it under **Admin panel → Users & Access** and give them the temporary password yourself.

**I am the only administrator and I am locked out. What now?**
Wait 5 minutes if you typed the wrong password too often. If you forgot it, close CORE and reset it from the computer it runs on: `CORE-ERP.exe --reset-password admin NewPassword123`, or `npm run reset-password -- admin NewPassword123` in the app folder. Then start CORE again.

**Can a change in Roles & permissions lock me out?**
No. Administrators always have every permission, their column cannot be changed, and the permissions that manage accounts, roles, sign-in security and data cannot be given to another account type. A data file or backup edited by hand cannot do it either: CORE ignores such entries.

**Are documents in the backup?**
The backup download holds their details (folders, titles, versions, sharing), not the files. The files are in `data/documents`, encrypted with a key kept in `data/secret.key`: copy the whole `data` folder, with that key, to keep them.

**I turned a module off. Is its data gone?**
No. Turning a module off only hides it and makes CORE refuse it for everyone but administrators. Its records, settings and files stay; turn it back on under **Modules** and everything is there.

**Someone lost their phone. Can they still sign in?**
Yes, with one of their recovery codes instead of the app's code. If they have none left, reset their 2-step verification in **Users & Access**.

**We moved CORE to a new server from a backup, and 2-step codes stopped working.**
2-step secrets are sealed with a key kept on the server (`data/secret.key`), not in the backup. Copy that file with the backup, or have people sign in with a recovery code and set up 2-step verification again (or reset it for them).

**People in the office are told there are too many failed sign-ins from this network.**
Everyone behind one internet address shares the count. Raise **Failed sign-ins per network address** in **Admin panel → Sign-in & security**, or wait 15 minutes.

**Does the security monitor read what people type, or follow them around?**
No. It counts what the server already sees: which kind of address was asked for (such as *GET /api/employees/:id*, never the record), whether it was answered or refused, how long it took and from which network address. It never keeps what was sent, searched for or shown. Network addresses are kept for 7 days; the counts for 90 days, in `data/monitor.json`, which is not part of backups. It is there for the same reasons as the audit log: security and accountability under the Data Privacy Act.

**The security monitor says Node.js support ends soon. What do I do?**
Nothing urgent: it says so six months ahead. Install the version it names when you next update the server (the AWS set-up in `deploy/aws/EC2.md` installs Node.js with the operating system's updates). The Windows app comes with its own Node.js, so a new CORE release brings the new version.

**Why does the security monitor's history start again sometimes?**
It keeps its counts in `data/monitor.json`, saved every minute and when CORE stops. A copy restored to another server starts its own history, as the counts describe the server, not the company's records.

**Why is the audit log not in the backup?**
It is kept in its own file, `data/audit-log.jsonl`, so that restoring a backup, loading demo data or erasing all data can never change it. Each entry carries a fingerprint of the one before it, which is how the page can tell when the file was edited. Copy the `data` folder to keep it.

**Why are views of employee records logged?**
The Data Privacy Act (RA 10173) holds the company accountable for who saw personal data. Opening a record with pay, showing full government ID numbers and opening a medical certificate are logged, once per person and record every 10 minutes.

**Can I give one person a power their account type does not have?**
Service desk work, Sales & CRM and Projects, under **Access grants**. Anything else is given to the whole account type under **Roles & permissions**. (Being a member of a project is not a power of the account: the project's manager adds people.)

**Is the settings file from Export settings safe to send to someone?**
It holds no people, records, passwords or mail server sign-ins, only how CORE is set up (including roles and the logo). Keep it within the company all the same.

**What happens to my Help guide edits when CORE is updated?**
They stay. CORE tells you on the guide, and in **Admin panel → Help & guides**, when its own version has changed, so you can compare.
