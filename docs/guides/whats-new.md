---
id: whats-new
title: What's new in CORE
summary: The changes in each update, newest first, and which guide explains them.
roles: admin, hr, hrstaff, payroll, it, support, sales, salesmgr, pm, employee
apps: home
order: 2
---

## November 2026

### The Admin panel (0.16)
- Everything administrators look after is now in one place, the **Admin panel**: the **Admin panel** card on the CORE home, **Admin panel** at the end of every module's side menu, and in the modules menu. The **System** items in the module menus moved there; old links such as `#/settings` and `#/users` still work. See [the administrator's guide](admin) and [Getting started](getting-started#open-the-admin-panel-administrators).
- A **Dashboard**: accounts, who is signed in, 2-step adoption, failed sign-ins and locks, the audit log check, modules, feedback waiting, data size and the last backup. See [the administrator's guide](admin#the-dashboard).
- **Roles & permissions**: change what each account type may do, with the defaults marked and **Restore defaults**. Administrators always keep everything. See [the administrator's guide](admin#change-what-an-account-type-may-do).
- **Access grants**: the service desk, Sales & CRM and Projects access of each person in one table. See [the administrator's guide](admin#give-someone-the-service-desk-sales-crm-or-projects).
- **Modules**: turn a module off for the company; it disappears for everyone but administrators, and nothing is deleted. See [the administrator's guide](admin#turn-a-module-on-or-off).
- The **Settings center**: every setting in one searchable list with its default, the change history with **Undo**, and export and import of the company's settings. See [the administrator's guide](admin#find-any-setting-and-compare-it-with-the-default).
- **Branding**: the company's colour, logo and sign-in headline, on every page and the sign-in page. See [the administrator's guide](admin#change-the-brand-colour-logo-and-sign-in-headline).

### Projects: watchers, daily digest, bulk edit, files, milestones and billing forecast, CSV import (0.15)
- **Watch** a task to hear of its comments and of it being done or cancelled; you watch tasks you add, are assigned or comment on. See [the projects guide](projects#watch-a-task).
- A **daily digest** on My work, and by email once a working day when the company turns it on and outgoing email is set up: your overdue tasks, those due soon, milestones at risk in projects you manage, and unread For you. Turn the email off for yourself with **Email me a daily digest**. See [Getting started](getting-started#get-the-daily-digest-by-email) and [the projects guide](projects#set-up-the-daily-digest-project-managers).
- **Change many tasks at once** on the List: tick them, then set the status, assignee, milestone or priority, move their dates in working days, add or remove watchers, or delete them. See [the projects guide](projects#change-many-tasks-at-once).
- **Files** on tasks and milestones, and the **acceptance document** of a deliverable. See [the projects guide](projects#attach-files-to-a-task-or-a-deliverable).
- A **Milestones** tab on the portfolio, with each deliverable's amount and the **billing forecast** by month for Sales & CRM users. See [the projects guide](projects#see-milestones-and-the-billing-forecast-across-projects).
- **Import tasks** from a CSV file, with a template, column matching and a check before anything is saved. See [the projects guide](projects#import-tasks-from-a-csv-file-project-managers).

### Projects: For you, hours left, quick filters, templates and the burn-up (0.14)
- **For you** on **My work**: a task assigned to you, an @mention, a comment on your task, your task done or cancelled by someone else, and being added to a project. Similar ones share a line; the number next to My work includes the unread ones. See [Getting started](getting-started#see-your-project-tasks-my-work) and [the projects guide](projects#catch-up-on-what-concerns-you-for-you).
- **Hours left** on every task: the estimate less the hours logged, or set by hand on the task or when logging time. Tasks, the list and a project's overview show estimate, logged and left; **Workload** now plans the hours left, not the whole estimate. See [the projects guide](projects#keep-the-hours-left-up-to-date).
- **Quick filters** on the board and the list (*Mine, Unassigned, Overdue, Due this week, Blocked, High & urgent*), a search on the board, and **saved views**, your own or shared with the project. See [the projects guide](projects#filter-the-board-or-list-quickly).
- **Project templates**: mark a project as a template, and start new projects from one with the dates moved in working days. Three starter templates come with CORE. See [the projects guide](projects#start-a-project-from-a-template).
- **Milestone burn-up** on a project's overview: scope, work done and the expected line. See [the projects guide](projects#read-the-milestone-burn-up).

### More demo projects (0.13.2)
- The demo data now has ten projects in every state: on hold, completed and cancelled ones, one off track, one with its own statuses, one with a WIP limit and one with a task linked to a service desk ticket. See [the projects guide](projects#walkthrough).

### Modules carousel (0.13.1)
- The CORE home shows **Your modules** in a sliding row, like the ATLAS home: swipe it on a phone, or use the arrows and dots. Modules coming soon are at the end of the row. See [Getting started](getting-started).

### Project Management (0.13)
- A new module, **Project Management**: projects with milestones and contract deliverables, a task board, a list, a timeline, time logs, and health worked out from the tasks. See [the projects guide](projects).
- **My work** lists the tasks assigned to you in every project you are on, and **My Home** shows them too. Anyone a project manager adds to a project can open it. See [Getting started](getting-started#see-your-project-tasks-my-work).
- A new account type, **Project Manager**, and **Projects access** per account. See [the administrator's guide](admin#give-someone-the-service-desk-sales-crm-or-projects).
- In Sales & CRM, **Start project** on a won deal or a contract, and its projects on the deal and contract pages. See [the sales guide](sales#start-a-project-from-a-won-deal).
- On a service desk ticket, **Add to a project** turns it into a task; both link to each other. See [the service desk guide](service-desk#add-a-ticket-to-a-project).

### Security fixes (0.12.1)
- **Restore backup** now asks for your password, and refuses a backup whose user accounts are not valid. See [the administrator's guide](admin#back-up-and-restore).
- The **Audit log** notice says *Keyed from entry N*: entries from there on are sealed with the server's key. See [the administrator's guide](admin#the-audit-log).

### Sign-in security (0.12)
- **2-step verification**: sign in with your password and a code from an authenticator app on your phone. Set it up under your name → **My security**, and keep the ten recovery codes it gives you. See [Getting started](getting-started#turn-on-2-step-verification).
- **My security** also lists where you are signed in, with **Sign out** for each device and **Sign out everywhere else**. See [Getting started](getting-started#see-where-you-are-signed-in).
- New passwords cannot be common ones or contain your username or name. Repeated wrong passwords lock a username for longer each time, and too many requests or failed sign-ins from one place are refused for a while.
- Administrators set who must use 2-step verification, how long sessions last and the limits in **Settings → Sign-in & security**, and can sign someone out everywhere or reset their 2-step verification in **Users & Access**. See [the administrator's guide](admin#set-the-sign-in-and-security-rules).

### Medical certificate rules (0.11.6)
- HR sets when a leave type needs a medical certificate: from a number of work days in one request (1 = every request), after a number of requests in a year or a month, or both. A sick leave filed without a required certificate is refused, with the reason. See [the HR guide](hr#set-when-a-medical-certificate-is-needed).
- The old setting carries over unchanged: Sick Leave *longer than 3 days* is now *from 4 days*. See [the employee guide](employee#attach-a-medical-certificate).

### New sign-in page (0.11.5)
- The sign-in page has a new look: CORE's maroon and gold beside the form, the same for first-run setup and for choosing a new password. Signing in works as before. See [Getting started](getting-started#sign-in).

### Sales & CRM checks (0.11.2 and 0.11.3)
- Two people editing the same record no longer overwrite each other: the second save is refused with a message to reload. See [the sales guide](sales).
- **Renew** on a contract links the renewal deal to the contract, and does not start a second one. Bids above the ABC are refused in every government procurement mode. Deals are closed as won or lost from the stage bar or the board, which always ask for the lost reason. See [the sales guide](sales).
- A contract with a renewal in progress shows *Renewal DL-… open*. Removing the demo data keeps your own sales records, and a demo organization they use stays as a real account.
- Errors on ticks, checklists and deletes are now shown; dialogs keep keyboard focus inside and close with Escape; CSV exports open correctly in Excel and cannot run formulas.

### Help & guides
- The **?** button in the top bar opens **Help & guides**: a guide for each job in CORE, with a walkthrough using the demo data, step-by-step tasks, every screen and common questions, and search across all of them. It opens on the guide for your job in the module you were in. See [Getting started](getting-started#get-help).
- Administrators can edit any guide for the company, add the company's own guides, and see when an update of CORE changes a guide they edited. See [the administrator's guide](admin#edit-a-help-guide).

### Year to date, locked payroll and personal data (0.11)
- **Payroll → Year to date**: each employee's totals for the year from finalized payslips, and the 13th month so far. Opening balances for pay before CORE or from a previous employer's BIR 2316. Employees see their own totals in **My Payslips**. See [the payroll guide](payroll) and [the employee guide](employee).
- A finalized payroll run is locked: it cannot be changed or deleted, only voided with a reason. See [the payroll guide](payroll).
- **Audit log** for administrators: sign-ins, changes to employees, pay, attendance, leave, payroll and settings, views of pay and full ID numbers, certificate openings, backups. See [the administrator's guide](admin).
- Government ID numbers and bank accounts are masked; **Show numbers** reveals them and is logged. A new **HR Staff** account type works without pay data. Medical certificates open for HR only, unless the approval flow lets approvers open them. See [the HR guide](hr) and [approving requests](approver).

### Holidays, holiday pay and night shift (0.10)
- **HR & Payroll → Holidays**: the 2026 and 2027 national holidays as proclaimed, plus Eid and local holidays added by HR. See [the HR guide](hr).
- Payroll pays regular holidays, special days, rest days and double holidays at the DOLE rates, with overtime on each, and a night shift differential from 10 PM to 6 AM. The rates are in **Payroll Setup**. See [the payroll guide](payroll).
- Leave and work-from-home requests skip holidays, so they use no leave credits on them. See [the employee guide](employee).

### Leave, work from home and official business (0.9)
- Requests go to your immediate supervisor first, then through the approval flow; supervisors decide in **Approvals**. Half days, official business, return for revision, and Leave Without Pay for days beyond your credits. See [the employee guide](employee) and [approving requests](approver).

### Sales & CRM (0.8)
- The **Sales & CRM** module: leads, accounts, contacts, the deal pipeline, public bids and contracts. See [the sales guide](sales).

### CORE (0.7)
- The ERP became **CORE**, with a home page of modules, a module switcher, dark mode and a design shared with the company's other systems. A Windows program, **CORE-ERP.exe**, runs CORE on one computer with its own data. See [Getting started](getting-started).
