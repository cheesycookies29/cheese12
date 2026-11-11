---
id: admin
title: Administering CORE
summary: For administrators: user accounts and what each account type may do, sign-in and security rules, company settings, backups and demo data, the audit log, the dev log, feedback, and editing the Help guides.
roles: admin
apps: system, home
order: 60
---

## Before you start

This guide is for **administrators**: the people who give others their accounts, keep the company settings and the backups, and watch the audit log. An administrator can open every module and every screen. The work of each module is in its own guide: [HR](hr), [payroll](payroll), [IT assets](it-assets), [the service desk](service-desk), [sales](sales) and [projects](projects).

- The first administrator is created the first time CORE starts: CORE asks for a name, a username and a password. Keep at least two administrator accounts, so one can help the other.
- On the **CORE home**, the **Administration** card has **Users & Access**, **Settings & Backups**, **Dev log** and **Feedback inbox**.
- Inside any module, the side menu ends with **System**: **Users & Access**, **Settings**, **Audit log**, **Dev log** and **Feedback inbox**, then **Send feedback** under **Help**.
- To try things out, load the demo data (see [Load or remove the demo data](#load-or-remove-the-demo-data)). It adds the demo accounts `hr.demo`, `payroll.demo`, `it.demo`, `sales.demo`, `pm.demo` and `employee.demo`, all with the password `demo1234`.

## Walkthrough

A first tour, signed in as `admin` with the demo data loaded. It takes about ten minutes.

### Accounts and what they may do

1. Sign in and choose **Users & Access** under **Administration** on the CORE home.
2. The table lists every account with its **Account type**, **Linked employee**, **Status** (*Active* or *Disabled*, *Temp. password* until they choose their own, *Demo* for demo accounts), **2-step** (*On*, *Off*, or *Not set up* when the company requires it) and **Last sign-in**, with how many devices the person is signed in on.
3. Scroll down to **Account types**. This table shows, for every account type, what it may do: a tick means yes. It is fixed by the account type; to give someone other powers, change their account type.

![Users & Access](admin-users.jpg)

![What each account type may do](admin-access-matrix.jpg)

### Settings and data

1. Open **Settings**. Under **Company**, the **Company name**, **TIN** and **Address** are printed on every payslip; the name also shows on the CORE home.
2. **Default work schedule** is the schedule new employee records start with.
3. Scroll down to **Data** (backups) and **Demo data**. The *Loaded* badge says the demo data is in.

![Settings: company details and the default schedule](admin-settings.jpg)

### The audit log

1. Open **Audit log**. The green notice **Intact** says no entry was changed, removed or reordered since it was written. **Keyed from entry N** means the entries from that number on are sealed with this server's key, so they cannot be rewritten by editing the file.
2. The list shows the last 30 days, newest first: when, who (with the computer's address), what, and the record. Changes show each field, before and after.
3. Pick **Sign-in** under **All areas** to see who signed in, and every failed sign-in.

![The audit log](admin-audit.jpg)

### The dev log and feedback

1. Open **Dev log**. The bar at the top shows the **version** installed, and below it every release of CORE, newest first, with what was added, changed and fixed. The number next to **Dev log** in the menu counts releases you have not opened yet.

![The dev log](admin-devlog.jpg)

2. Open **Feedback inbox**. What people send with **Send feedback** lands here, newest first.

## How to…

### Add a user

1. Open **Users & Access** and click **+ Add user**.
2. Enter the **Full name** and a **Username** (3 to 32 letters, numbers, dots, dashes or underscores).
3. Pick the **Account type**. What it may do is shown under it.
4. Under **Linked employee record**, pick the person's employee record. It is required for an *Employee* account and gives other account types the **My account** pages (their own attendance, payslips and requests).
5. Type a **Temporary password** of at least 8 characters, leave **Ask them to choose a new password at first sign-in** ticked, and click **Create user**.

Give the person their username and temporary password privately. They choose their own password the first time they sign in.

| Account type | For |
|---|---|
| Administrator | Everything, including accounts, settings, backups and the audit log |
| HR Manager | Employees with pay, attendance, leave approvals, payroll setup and holidays; views payroll and IT assets |
| HR Staff | Day-to-day HR without pay, government IDs or bank details; no payroll, no approvals |
| Payroll Officer | Payroll runs, payroll setup, holidays and leave credits; views employees and attendance |
| IT Asset Manager | IT assets and stock; works service desk tickets |
| Helpdesk Agent | Service desk tickets; views IT assets |
| Sales Officer | Sales & CRM, without deleting or the sales setup |
| Sales Manager | Sales & CRM, with deleting and the sales setup |
| Employee | Self-service only |

### Give someone the service desk, Sales & CRM or Projects

Some access can be given to one account on top of its account type:

1. For the service desk: open **IT Service Desk → Service desk settings → Agents** and turn on **Agent access** for the person. *use default* goes back to their account type.
2. For Sales & CRM: open **Sales & CRM → Sales setup → Team access** and click **Give access** (or **Remove**). **Follow account type** undoes it.
3. For Projects: open **Project Management → Projects setup → Team access** and click **Give access** (or **Remove**). Access lets the person see every project and start and edit projects; removing it from a Project Manager also takes away deleting projects and the setup. **Follow account type** undoes it.

**Users & Access** then shows *+ Helpdesk agent*, *+ Sales & CRM* or *+ Projects* under the account type, as a link to that page. Administrators always have all three.

You do not need Projects access to work on a project: its project manager adds people as members, and members open their projects whatever their account type. The **Project Manager** account type runs the module: every project, the workload and the Projects setup.

![Projects setup: Team access](admin-projects-access.jpg)

### Change an account type, or disable an account

1. Open **Users & Access** and click **Edit** on the row.
2. Change the **Account type** or the **Linked employee record**.
3. To stop someone signing in, untick **Account is active (can sign in)**. They are signed out at once.
4. Click **Save**.

You cannot change your own account type or disable your own account, and there must always be one active administrator. A disabled account keeps its history; tick the box again to let the person back in.

### Reset a password

1. Open **Users & Access** and click **Reset password** on the row.
2. Type a **New temporary password** and click **Reset password**.

The person is signed out everywhere and must choose a new password at the next sign-in. The temporary password follows the password rules too (see [Set the sign-in and security rules](#set-the-sign-in-and-security-rules)). After 5 wrong passwords a username is locked for 5 minutes, then 15, then an hour if the wrong passwords continue; it unlocks by itself.

### Sign someone out everywhere

1. Open **Users & Access**. **Last sign-in** shows *Signed in on N devices* for someone signed in now.
2. Click **Sign out everywhere** on the row and confirm.

They can sign in again with their password. To keep them out, disable the account instead.

### Reset someone's 2-step verification

For someone who lost their phone and their recovery codes. Confirm who they are first (in person or by a call you place).

1. Open **Users & Access** and click **Reset 2-step** on the row.
2. Confirm **Reset 2-step**.

They are signed out, sign in with their password only, and set up 2-step verification again if the company requires it. Your own 2-step verification is changed under your name → **My security**.

### Set the sign-in and security rules

1. Open **Settings** and scroll to **Sign-in & security**.
2. Under **2-step verification**, choose *Optional for everyone*, *Required for Administrators* or *Required for everyone*. Turn it on for your own account first (your name → **My security**): CORE will not let you require it of yourself before.
3. **Sign out after (idle minutes)**: people are signed out after this long without using CORE (480 = 8 hours). **Longest session (hours)**: they sign in again after this long, even if in use.
4. **Requests per minute, per person**: more than this is refused for a moment. 300 is plenty for normal use.
5. **Failed sign-ins per network address**: in 15 minutes, for any usernames; then that address waits. An office where everyone shares one internet address may need a higher number.
6. **Refuse common passwords and passwords with the username or name**: on unless you untick it.
7. Click **Save sign-in settings**.

When 2-step verification becomes required, people without it are asked to set it up the next time they sign in, and can do nothing else in CORE until they have.

![Settings: Sign-in & security](admin-security.jpg)

> **Note:** Always on: the username lock after 5 wrong passwords; a password change, an account type change or turning on 2-step verification signs the account out on other devices; and every sign-in, failed sign-in, lock and 2-step change is in the audit log.

### Delete an account

1. Open **Users & Access** and click **Delete** on the row.
2. Confirm.

The person can no longer sign in. Their employee record is not affected, and the audit log keeps what they did. Disabling is usually the better choice.

### Change the company details and default schedule

1. Open **Settings**.
2. Under **Company**, enter the **Company name** (required), **TIN** and **Address**.
3. Under **Default work schedule**, set **Shift start**, **Shift end**, **Unpaid break (minutes)** and the **Work days**.
4. Click **Save settings**.

Pay rules, rates and tax tables are not here: they are in **Payroll Setup** (see [the payroll guide](payroll)).

### Back up and restore

1. Open **Settings** and scroll to **Data**.
2. Click **Download backup**. CORE saves one file with all the company's data, named after today's date.
3. To go back to a backup, click **Restore backup…**, pick the file, enter **your password** and click **Restore**. Everything now in CORE is replaced by the backup.

Download a backup regularly and keep it somewhere safe and private: it holds pay, government IDs, bank accounts and the user accounts (passwords are stored as secure hashes). Attached files (medical certificates, ticket files) and the audit log are not in the backup file; copy the `data` folder for those. A restore keeps the current user accounts when the backup has none. CORE checks the user accounts in the file first: a backup with an invalid account, or with no active Administrator, is refused and nothing is changed.

> **Note:** Restore only backups you downloaded from CORE yourself. The user accounts in the file replace the current ones.

![The Data and Demo data sections of Settings](admin-data.jpg)

### Load or remove the demo data

1. Open **Settings** and scroll to **Demo data**.
2. Click **Add demo data** and confirm. CORE adds sample employees with attendance and leave, IT assets and stock, service desk tickets, sales accounts and deals, three projects with tasks and logged time, and the demo accounts, next to your own data.
3. **Reload demo data** replaces the demo records with a fresh set.
4. **Remove demo data** takes out every demo record and the demo accounts. Your own records stay.

Demo records are numbered *DEMO-…*. Demo employees are included in new payroll runs until you remove them, so remove the demo data before the first real payroll.

### Erase all data

1. Open **Settings** and click **Erase all data** under **Data**.
2. Click **Erase everything** to confirm.

This removes all employees, attendance, payroll runs, assets, tickets, sales records and the company settings. User accounts are kept (except the demo accounts), and so are the dev log, feedback, your Help guide edits, the service desk mail setup, the sales setup and the audit log. Download a backup first.

### Check the audit log

1. Open **Audit log**.
2. Set **From** and **To**, an area (**Sign-in**, **User accounts**, **Employees**, **Payroll**, **Backup & data** and others) and a person under **Everyone**. Type in the search box to find a name, record or change.
3. Click **Export CSV** for a file of the entries shown.

The log records every sign-in and failed sign-in, every change to employees, pay, attendance, leave, payroll runs, payroll setup, holidays, users and settings, field by field; views of records with pay or full ID numbers; certificate openings; backups, restores, demo data and erasing; and changes in the other modules. Government ID and bank numbers appear masked. Entries cannot be edited or deleted from CORE.

> **Important:** If the notice says **The log was altered**, the file was edited outside CORE at the entry it names. Keep a copy of the `data` folder and find out who had access to the computer or server.

### Write a dev log entry

1. Open **Dev log** and click **+ New entry**.
2. Check the **Version** and **Date**, and enter a **Title** and a **Summary**.
3. Under **Changes**, pick the type and module for each change and describe it; **+ Add change** adds a row. Add **Known issues** if there are any.
4. Click **Add entry**.

Each update of CORE adds its own entries (*built-in*). **Edit** and **Delete** are on each release; **change** next to the maintainer's name sets the author. **Export CHANGELOG.md** saves the whole log as a file.

### Answer feedback

1. Open **Feedback inbox**. It shows open feedback first; filter by status, type or module, or search.
2. Click a row to read it, then click **Respond**.
3. Pick the **Status** (*Under review*, *Planned*, *Resolved*, *Closed*), write a **Response** if you like, and click **Save response**.

The person sees the status and your response under **Send feedback**. **Delete** removes the feedback for them too. The number next to **Feedback inbox** counts new feedback.

![The feedback inbox](admin-feedback-inbox.jpg)

### Send feedback

1. Click **Send feedback** in the side menu (or under your name at the top right) and click **+ New feedback**.
2. Pick the **Type of feedback**, the **Module**, and enter a **Subject** and **Details**.
3. Click **Submit feedback**.

Everyone can send feedback this way; only administrators read it.

### Edit a Help guide

1. Open the guide in **Help & guides** (the **?** button in the top bar) and click **Edit this guide**.
2. Change the text on the left; the **Preview** on the right shows how it will look. The buttons above the text add headings, bold, menu paths, lists, tips, notes, links and pictures.
3. Click **Save**.

Your company's version is shown to everyone from then on and is kept when CORE is updated. The guide is marked *Edited by the company*. Keep the header at the top (between the `---` lines): **title** is required and **roles** says whose guides it appears under. Pictures can only show the screenshots that come with CORE. Every save is written in the audit log.

- **Add your own guide**: click **New guide** at the bottom of the Help menu, enter the **Guide id (its web address)**, for example `office-rules`, fill in the header and the text, and click **Save**. **Delete this guide** removes it.
- **When CORE updates a guide you edited**, the guide says *CORE has updated this guide since it was edited here*. Click **Compare and update it**, then **Compare with the new built-in guide** to read the new version and copy what you need.
- **To go back to the guide that comes with CORE**, open the editor and click **Restore the built-in guide**.

![Editing a Help guide](admin-guide-editor.jpg)

### Run CORE on a Windows PC or a cloud server

- **On one Windows PC**: double-click **CORE-ERP.exe**. The data stays on that PC. Start it with `--network` to let other PCs in the office sign in, and use `--reset-password <username> <new password>` (with CORE closed) if the only administrator is locked out.
- **On a cloud server**: CORE runs online over HTTPS, with automatic restarts and nightly backups that also copy the audit log.

Setting these up is described in CORE's README file and in the server set-up instructions that come with it.

## Screens at a glance

| Screen | What it is for |
|---|---|
| Users & Access | Accounts: add, edit, disable, reset passwords, delete; 2-step status, sign out everywhere, reset 2-step; link to an employee record; the table of what each account type may do |
| Settings | Company details printed on payslips, the default work schedule, Sign-in & security, Download backup, Restore backup, Erase all data, and the demo data |
| Audit log | Who viewed or changed personal data, payroll, attendance, leave and settings, and every sign-in; the integrity check; CSV export |
| Dev log | The version installed and every release of CORE; write and edit entries; export CHANGELOG.md |
| Feedback inbox | Feedback from everyone: read, respond, set the status, export |
| Send feedback | Your own feedback to the administrators, and their responses |
| Help & guides | The guides for every job; administrators edit them and add the company's own |

## Questions

**Someone forgot their password. Can CORE email a new one?**
No. Reset it under **Users & Access** and give them the temporary password yourself.

**I am the only administrator and I am locked out. What now?**
Wait 5 minutes if you typed the wrong password too often. If you forgot it, close CORE and reset it from the computer it runs on: `CORE-ERP.exe --reset-password admin NewPassword123`, or `npm run reset-password -- admin NewPassword123` in the app folder. Then start CORE again.

**Someone lost their phone. Can they still sign in?**
Yes, with one of their recovery codes instead of the app's code. If they have none left, reset their 2-step verification in **Users & Access**.

**We moved CORE to a new server from a backup, and 2-step codes stopped working.**
2-step secrets are sealed with a key kept on the server (`data/secret.key`), not in the backup. Copy that file with the backup, or have people sign in with a recovery code and set up 2-step verification again (or reset it for them).

**People in the office are told there are too many failed sign-ins from this network.**
Everyone behind one internet address shares the count. Raise **Failed sign-ins per network address** in **Settings → Sign-in & security**, or wait 15 minutes.

**Why is the audit log not in the backup?**
It is kept in its own file, `data/audit-log.jsonl`, so that restoring a backup, loading demo data or erasing all data can never change it. Each entry carries a fingerprint of the one before it, which is how the page can tell when the file was edited. Copy the `data` folder to keep it.

**Why are views of employee records logged?**
The Data Privacy Act (RA 10173) holds the company accountable for who saw personal data. Opening a record with pay, showing full government ID numbers and opening a medical certificate are logged, once per person and record every 10 minutes.

**Can I give one person a power their account type does not have?**
Only service desk work, Sales & CRM and Projects, as in [Give someone the service desk, Sales & CRM or Projects](#give-someone-the-service-desk-sales-crm-or-projects). Everything else follows the account type. (Being a member of a project is not a power of the account: the project's manager adds people.)

**What happens to my Help guide edits when CORE is updated?**
They stay. CORE tells you on the guide when its own version has changed, so you can compare.
