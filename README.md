# CORE · ERP by Lancaster

**CORE** is the enterprise resource planning system of Lancaster Technology and Development Corporation (LTDC). It runs on your own computer or a small cloud server and opens in your browser. Its design language is shared with the Lancaster LMS: a white top bar, an icon sidebar that folds to icons, cards on a light grey canvas, one brand colour throughout, and a **dark mode** (the moon button, remembered per browser).

After signing in, everyone lands on the **CORE home page** and picks a module; the grid button in the top bar switches modules from anywhere. Four modules are live:

| Module | For |
| --- | --- |
| **HR & Payroll** | Employee records, time and attendance, leave and remote work, Philippine payroll |
| **IT Asset Management** | IT equipment and consumable stock: who or where it is allocated to, warranty, history, CSV exports |
| **IT Service Desk** | Support tickets from the portal, email and a public form, with assignment, internal notes and service levels |
| **Sales & CRM** | Leads, accounts and contacts, a deal pipeline with forecasts, public bids with document checklists, and contract renewals |

Finance & Accounting, Procurement, Project Management and Document Management are listed under **On the roadmap**.
A module the user's account cannot use shows **No access**.

### HR & Payroll

- **Employee records**: personal details, employment, pay rate, work schedule, government IDs (TIN, SSS, PhilHealth, Pag-IBIG) and bank details.
- **Time tracking**: a time clock where employees clock in and out, and an attendance record (DTR) that works out late, undertime and overtime minutes. You can also add paid leave, fix records by hand and approve overtime.
- **Payroll**: semi-monthly or monthly payroll runs worked out from attendance, with SSS, PhilHealth, Pag-IBIG and BIR withholding tax. It produces a payroll register (CSV) and payslips you can print or save as PDF.
- **Leave and remote work**: employees file leave or work-from-home requests; HR Managers or Administrators approve them, and approved days go into attendance and payroll automatically. Leave types, yearly credits and balances are managed in **Leave & Requests**.
- **Payroll Setup**: HR Managers and Payroll Officers adjust pay rules, government contribution rates and BIR tax tables without code changes.
- **User access**: everyone signs in with their own account, and each account type only sees what it needs (see below).

### IT Asset Management

- **Assets**: register each piece of equipment (laptop, monitor, phone, printer, server…) with an asset tag (`LTDC-IT-0001`, automatic), serial number, specifications, purchase cost, supplier, warranty end date, condition and storage location.
- **Allocation**: assign an asset to an **employee** (picked from the HR employee list), a **department** or a **location**, with an optional return date. Transfer it to someone else, take it back (to stock or to repair), or mark it retired or lost. Every step is kept in the asset's history.
- **Inventory**: consumables and spare parts (cables, mice, toner, RAM…) with on-hand quantity and reorder level. **Receive** stock, **issue** it to an employee, department or location, or record a **count**. Items at or below the reorder level are flagged.
- **Allocations**: one view of everything each person, department and location holds.
- **Overview**: totals, assets by category, low stock, warranties ending within 60 days and overdue returns.
- **Activity log**: every registration, assignment, return, status change and stock movement, by date.
- **CSV export** on every list: assets, inventory, stock movements, allocations, the activity log, each asset's history, and an employee's own equipment.
- Employees see their own equipment under **My Assets**; HR sees each employee's equipment on their profile (useful when someone leaves).
- **Problem reports**: from **My Assets**, employees report a laptop or other assigned equipment that is malfunctioning, damaged or lost (what's wrong, whether they can still work, a description). Administrators and IT see new reports under **Problem reports** (with a count in the menu), mark them *Being checked*, *Resolved* or *Closed*, and leave notes the employee reads in My Assets. Reports appear on the asset's page and in its history, and export to CSV. HR can view them; only Administrators and IT can respond.

### IT Service Desk

- **Tickets** from three places: the **My tickets** portal (every signed-in user, from any module's menu), **email** to the helpdesk address, and agents logging a call or walk-in on someone's behalf. Each ticket gets a number (`HD-000123`), category, priority, status (*New, Open, Waiting on requester, On hold, Resolved, Closed*), an assignee and, optionally, the IT asset it is about.
- **Agents** (by default Administrators, IT Asset Managers and the new *Helpdesk Agent* account type; administrators can add or remove agent access for any account under **Service desk settings → Agents**) work a queue with views (Open, Mine, Unassigned, Overdue, Resolved), filters and search. On a ticket they **reply** to the requester or add an **internal note** the requester never sees, insert **saved replies**, attach files, and set the next status. A notice shows when another agent has the same ticket open.
- **Service levels**: first-response and resolution targets per priority (hours, editable). Tickets show when they are due and turn red when overdue; the overview counts tickets awaiting a reply, unassigned, assigned to you and overdue.
- **Public complaint and request form** at `https://<your address>/support`: anyone, with or without an account, inside or outside the company, sends a complaint or request (name, email, optional phone and organization, category, subject, details, up to 3 photos/PDFs). It becomes a ticket on the *Web form* channel; the sender gets a reference number and a private tracking link (`/support/t/…`) to follow replies and answer back without signing in, and an emailed confirmation when outgoing email is set up. People whose email matches an employee also see it in My tickets. Turn it on, copy the link, set the title, introduction, categories, priority and options under **Service desk settings → Public form**, which also has a ready-made "Contact us" button for your website. Spam protection: a hidden trap field, a minimum time to fill the form, and at most 5 requests per visitor per hour and 10 per email address per day. Share the link from the online (https) address: a `localhost` link only works on that computer.
- **Requesters** follow their tickets, reply, add screenshots, and mark a ticket solved. A reply reopens a resolved ticket; resolved tickets close automatically after 7 days (editable).
- **Email**, under **IT Service Desk → Service desk settings** (Administrators):
  - *Receiving email*: set the **helpdesk email address** and the mailbox it is read from (IMAP server, port, security, sign-in, app password, folder, how often to check). Presets fill in Gmail / Google Workspace, Microsoft 365 and Zoho. **Test connection** checks the sign-in; **Check mail now** imports at once. New emails become tickets; replies (ticket number in the subject, or a reply to the desk's email) are added to the right ticket, with the quoted history cut off. Out-of-office replies, bounces, mailing lists and the desk's own mail are ignored, each message is imported once, and you can accept email from anyone, only listed domains, or only employees. PDF and image attachments are kept; other files are listed as not imported.
  - *Sending email*: the SMTP server (or the same sign-in as the mailbox). Agents' replies and an acknowledgement for new emailed tickets go out from the helpdesk address, threaded so the requester's email program groups them. Without it, replies show only in the portal.
  - Mailbox passwords are stored encrypted with a key in `data/secret.key`; they are never sent back to the browser or included in a downloaded backup.
  - Gmail and Google Workspace need an **app password** (2-Step Verification on). Microsoft 365 has switched off password sign-in for IMAP and SMTP in most organisations, so it works only where an administrator allows it for that mailbox.

### Sales & CRM

Built on the model the major CRMs share (accounts, contacts, leads, deals moving through pipeline stages, and activities), plus what a government and enterprise IT supplier needs: bids and contracts.

- **Leads**: people or organizations that showed interest (website, referral, PhilGEPS, events, the public form…), with status *New, Contacted, Qualified, Disqualified*. **Convert** a qualified lead: it becomes an account (new, or one that already exists), a contact and, optionally, a deal; its open tasks and notes move to the deal. On a service desk ticket, **Send to Sales & CRM** turns a sales enquiry into a lead.
- **Accounts and contacts**: organizations (prospect, client, partner, supplier; private, government, education or non-profit) and the people at them. An account page shows its contacts, deals, bids and contracts, and one timeline of everything that happened with it. A prospect becomes a client when a deal is won.
- **Pipeline**: a board with a column per stage and the total of each; drag a deal to move it, or drop it on **Won** or **Lost** at the bottom of the screen (losing asks why). The list view filters by owner, stage and overdue close dates. Each stage has a win probability that weighs the forecast. On a deal, the stage bar moves it with one click.
- **Bids**: public tenders and RFPs with the reference number, procurement mode, approved budget (ABC), our bid amount, submission deadline, pre-bid conference and opening. Each bid gets a **document checklist** (PhilGEPS registration, permits, tax clearance, audited statements, NFCC, bid security, omnibus sworn statement, technical and financial proposals; editable). A public bid above the ABC is refused, submitting with documents unticked asks first, and an award or a loss closes the linked deal.
- **Contracts**: value, term, billing, auto-renewal; contracts show for renewal a set number of days before they end (60 by default), and **Renew** starts a renewal deal.
- **Activities**: on every record, log calls, meetings, emails and notes, or schedule tasks with a due date and owner; changes of stage and status are added automatically. **Activities** lists your open and overdue tasks; the menu counts the ones due today.
- **Overview**: open pipeline, weighted forecast, won this quarter, 90-day win rate, open leads, pipeline by stage, forecast for the next three months, your tasks, bid deadlines, renewals and deals closing in 30 days. Search finds any account, person, lead, deal, bid or contract.
- **Sales setup** (Sales Managers and Administrators): pipeline stages and probabilities (stages that still have deals cannot be removed), lead sources, lost reasons, industries, the bid checklist and the renewal notice. Administrators give or remove CRM access per account under **Sales setup → Team access**. The setup survives demo data and "erase all data"; CRM records are company data.
- CSV export on every list. Codes: `LD-0001` leads, `DL-0001` deals, `BID-0001` bids, `CT-0001` contracts.

All modules share one data file, `data/db.json`. It runs on your own computer, or online on a small cloud server: see [Putting CORE online with Amazon EC2](deploy/aws/EC2.md).

## Run it on your Mac

1. **Install Node.js** (one time only). Download the LTS installer from <https://nodejs.org> and run it.
   To check that it worked, open **Terminal** and run `node --version`. It should show `v18` or newer.
2. **Get the code**: clone this repository, or download it as a ZIP and unzip it.
3. **Start the app** from Terminal:

   ```bash
   cd path/to/ltdc-hr
   npm start
   ```

4. Open **<http://localhost:3000>** in Safari or Chrome.

To stop the app, press `Ctrl + C` in the Terminal window. Run `npm start` again whenever you want to use it.
You don't need to run `npm install`, because the app has no dependencies.

The first time you open the app, it asks you to **create the Administrator account**. After that, everyone starts at the sign-in page.

> To try it out, go to **Settings → Demo data → Add demo data**. This adds 6 sample employees with about six weeks of attendance,
> 16 IT assets, 7 inventory items and 4 helpdesk tickets **next to your own data** (demo records are numbered `DEMO-0001`, `DEMO-IT-0001`…,
> and nothing you entered is changed), plus demo accounts you can sign in with to see each account type: `hr.demo`, `payroll.demo`, `it.demo` and `employee.demo`
> (password `demo1234`). Adding it again refreshes the demo set instead of doubling it.
> **Remove demo data** takes out every demo record, what was attached to demo employees and assets, and the demo accounts, and leaves your own records as they were
> (real equipment lent to a demo employee goes back to stock; finalized payroll runs are not changed).

To use a different port, run `PORT=8080 npm start`.

## Run it on Windows

### Easiest: one file for Windows, `CORE-ERP.exe`

`CORE-ERP.exe` is the whole system in a single file: Node.js, the server, every screen and the database engine. Nothing to install, unzip or configure.

1. Copy `CORE-ERP.exe` anywhere, for example the Desktop or Documents.
2. Double-click it. A window opens showing where your data is kept, and CORE opens in your browser at <http://localhost:3000>. Keep the window open while you use CORE; close it to stop.
3. The first time, CORE asks you to create the Administrator account.

- **Your data stays on this PC**, in `%LOCALAPPDATA%\CORE ERP\data` (the database `db.json`, uploaded files and the encryption key). Back it up from **Settings → Download backup**, or copy that folder while CORE is closed. Replacing the .exe with a newer one keeps your data.
- **Portable mode** (e.g. on a USB drive): make a folder named `CORE-data` next to the .exe and CORE keeps its data there instead.
- Starting it again while it is running just opens the browser.
- Options, from a Command Prompt in the file's folder: `CORE-ERP.exe --network` (other PCs on the office network can sign in, at the address it shows), `--port 3001`, `--no-browser`, and `--reset-password <username> <new password>` for a locked-out administrator (close CORE first).
- The file is not code-signed yet, so the first time Windows may show "Windows protected your PC": click **More info → Run anyway**.

To build it, run `scripts/build-exe.sh` on Linux (`LINUX=1` also builds a Linux copy to test with). It downloads the official Node.js builds, checks them against nodejs.org's checksums, bundles the server with esbuild, embeds it and the web files with Node's single executable application feature, sets the icon and version details, and checks the result.

### The Windows package (folder with launchers)

`CORE-ERP-Windows-x64.zip` contains the app **and its own copy of Node.js**, so there is nothing to install.

1. Right-click the zip → **Properties** → tick **Unblock** if it is shown → **OK**.
2. Right-click → **Extract All…** and put the `CORE-ERP` folder somewhere permanent, such as **Documents** (not Program Files). Your data is saved inside it.
3. Double-click **`Start CORE ERP.bat`**. The app opens in your browser at <http://localhost:3000>. Keep the black window open while you use it.
4. Optional: double-click **`Create desktop shortcut.bat`**.

The folder also has **`Start CORE ERP (office network).bat`** (lets other PCs sign in), **`Reset a password.bat`** (for a locked-out admin) and **`READ ME FIRST.txt`**.
To build the package yourself, run `scripts/build-windows.sh` on macOS or Linux. It downloads the official Node.js Windows build, checks it against nodejs.org's checksums, and writes `dist/CORE-ERP-Windows-x64.zip`.

### From the source code

1. **Install Node.js** (one time only): download the **LTS** installer (`.msi`) from <https://nodejs.org> and run it with the default options.
2. **Unzip** `ltdc-hr.zip`: right-click it → **Extract All…**. Put the folder somewhere permanent, such as **Documents**. Your data is saved inside it.
3. **Double-click `start-windows.bat`** in the `ltdc-hr` folder. A black window opens and the app opens in your browser at <http://localhost:3000>.
   - If Windows shows "Windows protected your PC", click **More info → Run anyway**.
4. **Keep the black window open** while you use the app. Close it (or press `Ctrl + C`) to stop.

Everything else (sign-in, accounts, backups) works the same as on a Mac.
If you prefer the command line, open **PowerShell** in the folder and run `npm start`.
The PowerShell way to set options is `$env:PORT=8080; npm start`.

## Accounts and access

| Account type | Can do |
| --- | --- |
| **Administrator** | Everything, including **Users & Access**, company settings, and backup/restore. |
| **HR Manager** | Add and edit employees (including pay, government IDs and bank details), manage attendance and approve overtime, run the shared time clock, **approve leave and remote-work requests**, manage leave credits and the holiday calendar, adjust Payroll Setup. View payroll and IT assets. |
| **HR Staff** | Day-to-day HR without pay data: view employee records (no pay, government IDs or bank details), manage attendance, the shared time clock, the holiday calendar and leave records. No payroll. |
| **IT Asset Manager** | IT Asset Management: register, assign, transfer, return and retire assets; receive, issue and count stock; export. No access to HR records. |
| **Payroll Officer** | Create, adjust, finalize and void payroll, add year-to-date opening balances, adjust Payroll Setup and leave credits. View employees (with pay), attendance and requests (cannot approve them). |
| **Sales Officer** | Sales & CRM: leads, accounts, contacts, deals, bids, contracts and activities. Cannot delete records or change the sales setup. |
| **Sales Manager** | Everything a Sales Officer does, plus deleting CRM records and the sales setup (stages, sources, lost reasons, bid checklist). |
| **Employee** | Self-service only: clock in and out, file leave and remote-work requests, see their own attendance, leave balances, finalized payslips, profile and assigned equipment. |

- Admins add accounts in **Users & Access** and give the person a temporary password. They're asked to pick their own password the first time they sign in.
- **Employee** accounts must be linked to an employee record. HR Managers and Payroll Officers can be linked too, which gives them the "My account" pages.
- Anyone can change their password from the menu under their name at the top right. Admins can reset anyone's password or disable an account.
- After 5 wrong passwords, that username is locked for 5 minutes. People are signed out after 8 idle hours, or when the app is restarted.
- **Personal data.** Government ID numbers and bank accounts are masked everywhere; HR Managers, Payroll Officers and Administrators can click **Show numbers** on a profile, and the edit form and full employee export load them. Each of these is recorded in the audit log. Medical certificates open for HR only, unless **Leave & Requests → Approval flow** lets approvers open them.
- **Audit log** (Administrators, **System → Audit log**): every sign-in and failed sign-in, every change to employees, pay, attendance, leave, payroll runs, Payroll Setup, holidays, users and settings (field by field, before and after), views of records with pay or full ID numbers, medical certificate openings, backups and restores. It is kept in `data/audit-log.jsonl`, separate from the data file, so restoring a backup or erasing all data does not touch it. Each entry is chained to the one before by a hash; the page checks the chain and warns if the file was edited.
- **Locked out as the only admin?** Stop the app, open Terminal (Mac) or PowerShell (Windows) in the app folder, run `npm run reset-password -- admin NewPassword123` (use your admin username), then start the app again.

### Letting employees sign in from their own computers

By default only the computer running the app can open it. To let others on the same office network use it:

- **On Windows:** double-click `start-windows-network.bat`. The window shows this PC's IP address (for example `192.168.1.20`).
  If Windows Firewall asks, allow access on **Private networks** only.
- **On a Mac:** start the app with `HOST=0.0.0.0 npm start`, and find the IP address in **System Settings → Network**.

Others then open `http://192.168.1.20:3000` (using your IP address) in their browser.

The connection is not encrypted (plain `http`), so only do this on a network you trust.

## How pay is computed

| Item | Rule |
| --- | --- |
| Daily rate (monthly-rated) | monthly salary × 12 ÷ work days per year (261 by default, set in Payroll Setup) |
| Hourly rate | daily rate ÷ scheduled hours per day (shift length minus break) |
| Basic pay, monthly-rated | half the monthly salary per semi-monthly period, minus absences, late and undertime |
| Basic pay, daily-rated | (days present + paid leave days) × daily rate, minus late and undertime |
| Absences | scheduled work days in the period that have no attendance record. Unpaid leave (e.g. Leave Without Pay) is deducted the same way |
| Paid leave, remote work | counted as paid days. A remote day with no clock times counts as a full scheduled day |
| Overtime | minutes after the end of the shift × hourly rate × 1.25. It must be **approved** in Attendance and last at least 30 minutes |
| Rest day work | the first 8 hours × 130%, each hour beyond × 169% (approved only) |
| Holidays worked | special non-working day 130% (169% overtime), regular holiday 200% (260%), on a rest day 150% / 260%, double holiday 300%. On a scheduled work day the salary already covers 100%, so the payslip adds the premium. No late or undertime is counted on a holiday |
| Holidays not worked | a regular holiday is paid if the employee was present, or on paid leave, on the last working day before it (monthly salaries already include it; daily-paid staff get a day's pay). Special days not worked are paid or not by company policy |
| Night shift differential | 10% of the rate that applies to each hour worked from 10 PM to 6 AM (so 10% of 200% on a regular holiday) |
| SSS | 2025 schedule: 5% employee and 10% employer share of the Monthly Salary Credit (₱5,000–₱35,000), plus EC |
| PhilHealth | 5% of monthly basic salary (floor ₱10k, ceiling ₱100k), split 50/50 |
| Pag-IBIG | 2% employee and 2% employer share, on a fund salary capped at ₱10,000 (max ₱200 each) |
| Withholding tax | BIR TRAIN table effective 2023, applied to gross pay minus employee contributions. Minimum wage earners are exempt |
| Allowance | monthly, non-taxable (de minimis), split across pay periods. Not paid, and no contributions deducted, in a period with no pay |

In a semi-monthly payroll, contributions are split equally between the two cutoffs.
To add bonuses, commissions, loans or cash advances, click **Adjust** on an employee's row in a draft payroll run.
A draft run can be recomputed after you edit attendance. Once you finalize it, it is locked: it cannot be changed or deleted, only **voided** with a reason (it stays on record, marked voided, and leaves the year-to-date totals). Editing attendance inside a finalized period is allowed but does not change that payroll; the DTR says so, and the difference goes in the next run as an adjustment.

**Payroll → Year to date** lists each employee's totals for the year from finalized payslips: basic pay, premiums, gross, non-taxable and taxable pay, contributions, tax withheld, net pay and the **13th month so far** (1/12 of the basic pay earned at LTDC). Add an **opening balance** for pay this year that CORE did not compute: months before CORE, or a new hire's previous employer (from their BIR 2316, which counts for tax but not for LTDC's 13th month). Employees see their own totals in **My Payslips**. The 13th month run, year-end tax annualization, BIR 2316 and the alphalist will be built on these totals.

Pay frequency, the daily-rate factor (work days per year; an employee can have their own), the holiday, rest-day and night premiums, the holiday rules, grace period, minimum overtime, which deductions apply, the SSS / PhilHealth / Pag-IBIG rates and the tax tables are all set in **Payroll Setup**. It has a **Try it** calculator to check deductions at any salary before saving, and a button to restore the 2025 government rates. Changes apply to new runs and to drafts when recomputed; finalized runs never change.

**Check these rates against the latest SSS, PhilHealth, Pag-IBIG and BIR circulars before you rely on the payroll.** Government rates change.

### Holidays

**HR & Payroll → Holidays** is the calendar payroll uses. The 2026 holidays (Proclamation No. 1006) and 2027 holidays (Proclamation No. 1427) are loaded already; a year whose list CORE knows can be loaded again with one click if holidays were removed. Add **Eid'l Fitr** and **Eid'l Adha** when they are proclaimed, and any local holiday (with the city or province). Each holiday is a *regular holiday*, a *special non-working day* or a *special working day* (paid as an ordinary day). Leave and work-from-home requests skip regular holidays and special non-working days, so they do not use leave credits. The DTR marks holidays, and payslips list each premium with its hours and rate. Changing the calendar changes draft payroll runs when they are recomputed; finalized runs never change.

## Leave, work from home and official business

The request process follows common Philippine HR practice: requests go to the employee's **immediate supervisor** first, then through further approval levels, and supervisors work them in an **Approval Center**.

1. **Filing.** The employee opens **My Requests → File a request** and picks a leave type, **Work from home**, or **Official business** (work away from the office, with where they will be). For leave, the **date breakdown** lists each scheduled work day; each can be a *whole day*, *1st half* or *2nd half*, and shows *with pay* or *without pay*: days beyond the remaining credits are recorded as Leave Without Pay instead of being refused. The form shows who the request goes to. A leave type can require filing a set number of days ahead (**Leave types → File at least this many days ahead**), and sick leave over 3 days needs a medical certificate.
2. **Approval route.** Set under **Leave & Requests → Approval flow**: up to three levels, each the *immediate supervisor* (from the employee record), the *supervisor's supervisor*, *HR* (anyone who approves leave) or *specific people*.
   - **Sequential**: every level approves in turn. **Parallel**: the request goes to every level at once and the first approval decides it. A rejection always ends it.
   - The route is fixed when the request is filed, so changes to supervisors or to the flow apply to new requests.
   - A level with nobody to approve it (no supervisor on record, or one without an account) is skipped, and if every level is skipped HR decides, so no request gets stuck. Nobody approves their own request; someone who holds the next level too approves both at once.
   - HR Managers and Administrators can decide any request at any point (shown as an HR override), for example when a supervisor is away.
3. **Approval Center** (**Approvals** in the menu, for supervisors even on an Employee account, named approvers and HR): *For my approval*, *Processed* and *My team*. Open a request to see its days, the employee's balance, its route and its history. **Approve** (remarks optional), **Reject** or **Return for revision** (remarks required, the employee sees them). Tick several and **Approve selected** to approve them together. The menu counts the requests waiting for you.
4. **Returned requests.** The employee revises the request and resubmits it; it starts its route again. Pending requests can be edited the same way, or withdrawn with a reason.
5. **Approval writes attendance**: whole leave days as leave (paid or unpaid), half days as a half-day mark on the work day (the other half is timed against half the shift, and payroll pays half a day of leave), work from home and official business as full days the employee can still clock in on.
6. **Cancelling.** HR, or an approver on the request's route, can cancel an approved request with a reason; its days leave attendance and the credits come back.

Set each employee's **Immediate supervisor** on their record (**Employees → Edit → Employment**). The profile shows the supervisor and the direct reports. **Leave & Requests** lists every request with its status and route for HR.

Default leave types (editable under **Leave & Requests → Leave types**): Vacation 15, Sick 15, Emergency 3, Paternity 7 and Solo Parent 7 days a year; Maternity and Leave Without Pay with no yearly limit. Credits can be changed per employee and year under **Leave balances**, e.g. for carry-over or new hires. Balances count all leave in attendance, including leave HR records directly.

Administrators can manage one person's leave under **Leave & Requests → Employee leave** (or **Manage leave** on the employee's profile): switch leave types on or off for that employee (a type can also be set to *only employees you add*), set their yearly credits, add or take away days with a reason (carry-over, offsets, corrections), and record or remove leave taken outside the system. Employees only see and file the leave types they get.

## Not included (yet)

13th month pay runs, year-end tax annualization, loans with amortization, government remittance reports and BIR 2316, password reset by email, and email notifications to approvers.

## Help & guides

The **?** button in CORE's top bar opens **Help & guides** (`/help/`): a guide for each job, with a walkthrough using the demo data, step-by-step tasks, every screen and common questions, plus search. It opens on the guide for your job in the module you were in.

| Guide | For |
|---|---|
| Getting started with CORE | Everyone: signing in, modules, password, phone, help |
| What's new in CORE | Everyone: the changes in each update |
| Your self-service | Every employee: clock in, attendance, requests, payslips, assets, tickets |
| Approving requests | Supervisors and named approvers |
| Running HR | HR Managers and HR Staff |
| Running payroll | Payroll Officers |
| Managing IT assets | IT Asset Managers |
| Working the IT Service Desk | Helpdesk Agents and IT |
| Selling with Sales & CRM | Sales Officers and Managers |
| Administering CORE | Administrators |

Administrators can edit a guide for the company (**Edit this guide**), add the company's own guides (**New guide**), and go back to the built-in guide at any time. Their version is kept when CORE is updated, and CORE says when the built-in guide has changed since.

## Put it online (cloud)

To use it 24/7 from any browser over HTTPS, follow [deploy/aws/EC2.md](deploy/aws/EC2.md). It sets up an Amazon EC2 Ubuntu server with Caddy for HTTPS, automatic restarts, nightly data backups and optional automatic deployment: the GitHub workflow `.github/workflows/deploy-ec2.yml` tests every push and installs it on the server through AWS Systems Manager (permissions from `deploy/aws/github-deploy.yaml`; no SSH keys or AWS keys stored). Two settings matter online: `COOKIE_SECURE=1` (login cookie sent over HTTPS only) and `ALLOWED_HOSTS=<your address>`. To create the first Administrator from the server instead of the first-run page, stop the app and run `npm run create-admin -- <username> "<Full Name>"`; it prints a temporary password.

## Backups

Admins can use **Settings → Download backup** to save everything as a single JSON file, and **Restore backup** to load one back.
The backup includes user accounts (with passwords stored as secure hashes), so keep the file private.
You can also just copy the `data/` folder. It also holds `attachments/` (medical certificates, ticket files), `audit-log.jsonl` (the audit log, which a backup file does not include) and `secret.key`, which unlocks the saved mailbox passwords; without it, re-enter them under Service desk settings. On the cloud server the audit log is copied each night next to the data backups.

## For developers

- **Dev log:** written by one developer, in the first person. Each build's entry goes at the top of `shared/devlog.js` (version such as `0.2.4-alpha`, date, a short note, the changes, known issues) and `package.json` "version" must match; `npm test` checks both. A server copies each build's entry into its database the first time it runs that build (`server/devlog.js`); after that, administrators edit, add or delete entries and set the author name under **System → Dev log**, and those edits survive updates, demo data and "erase all data". The installed build comes from `build.json`, written by the installers.

- `server.js` is a dependency-free Node HTTP server. The JSON API is in `server/api.js` and storage in `server/db.js`.
- `server/leave.js` and `server/assets.js` hold the leave/request and IT asset routes; `shared/assets.js` the asset statuses and categories.
- `public/js/modules.js` lists the modules shown on the CORE home page (`public/js/views/launcher.js`) and in the module switcher. To add a module: add its routes and menu in `public/js/app.js` (each menu item names an icon from `public/js/icons.js`), set it to `live`, and give it a home in `moduleHome()`.
- **Design:** `public/css/styles.css` follows the Lancaster LMS design system. Colours are tokens on `:root` (`--brand`, `--accent`, `--surface`, `--border`, `--text`, `--muted`…) with dark-mode values under `[data-theme='dark']`; use the tokens, not fixed colours, so every screen follows the theme. The older names (`--maroon`, `--gold`…) are mapped onto them. The CORE mark is `public/img/core-mark.svg` (gold), `core-mark-brand.svg` (maroon) and `core-app-icon.svg` (app tile). Payslips stay on white paper in both themes.
- `shared/calc.js` holds all the time and payroll math. Both the server and the browser use it.
- `shared/roles.js` defines the account types and permissions. The server enforces them on every API call (`server/api.js`), and the browser uses them to hide screens and buttons. Passwords and sessions are in `server/auth.js`.
- `public/` is the single-page app: plain ES modules with no build step.
- **Guides** are Markdown files in `docs/guides`, shipped with the code; `docs/guides/README.md` explains the format. When a screen changes, update its guide and retake its screenshots with `npm run guides:screenshots` (needs Playwright). `npm test` checks that every menu item is covered by a guide and every screenshot exists.
- Run the tests with `npm test`.
- Build the Windows package with `scripts/build-windows.sh` (needs `curl`, `zip`, `unzip`; set `NODE_VERSION` to change the bundled runtime). The launchers, icon and read-me it adds are in `packaging/windows/`.
