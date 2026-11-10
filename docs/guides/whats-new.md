---
id: whats-new
title: What's new in CORE
summary: The changes in each update, newest first, and which guide explains them.
roles: admin, hr, hrstaff, payroll, it, support, sales, salesmgr, employee
apps: home
order: 2
---

## November 2026

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
