# LTDC ERP

The unified enterprise system of Lancaster Technology and Development Corporation (LTDC). It runs on your own computer, opens in your browser, and follows the look of [lancastertechdev.com](https://lancastertechdev.com/).

After signing in, everyone lands on the **module launcher** and picks a module. Two modules are live:

| Module | For |
| --- | --- |
| **HR & Payroll** | Employee records, time and attendance, leave and remote work, Philippine payroll |
| **IT Asset Management** | IT equipment and consumable stock: who or where it is allocated to, warranty, history, CSV exports |

Finance & Accounting, Procurement, Project Management, Sales & CRM, IT Service Desk and Document Management appear on the launcher greyed out as **coming soon**.
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
- **Agents** (Administrators, IT Asset Managers and the new *Helpdesk Agent* account type) work a queue with views (Open, Mine, Unassigned, Overdue, Resolved), filters and search. On a ticket they **reply** to the requester or add an **internal note** the requester never sees, insert **saved replies**, attach files, and set the next status. A notice shows when another agent has the same ticket open.
- **Service levels**: first-response and resolution targets per priority (hours, editable). Tickets show when they are due and turn red when overdue; the overview counts tickets awaiting a reply, unassigned, assigned to you and overdue.
- **Requesters** follow their tickets, reply, add screenshots, and mark a ticket solved. A reply reopens a resolved ticket; resolved tickets close automatically after 7 days (editable).
- **Email**, under **IT Service Desk → Service desk settings** (Administrators):
  - *Receiving email*: set the **helpdesk email address** and the mailbox it is read from (IMAP server, port, security, sign-in, app password, folder, how often to check). Presets fill in Gmail / Google Workspace, Microsoft 365 and Zoho. **Test connection** checks the sign-in; **Check mail now** imports at once. New emails become tickets; replies (ticket number in the subject, or a reply to the desk's email) are added to the right ticket, with the quoted history cut off. Out-of-office replies, bounces, mailing lists and the desk's own mail are ignored, each message is imported once, and you can accept email from anyone, only listed domains, or only employees. PDF and image attachments are kept; other files are listed as not imported.
  - *Sending email*: the SMTP server (or the same sign-in as the mailbox). Agents' replies and an acknowledgement for new emailed tickets go out from the helpdesk address, threaded so the requester's email program groups them. Without it, replies show only in the portal.
  - Mailbox passwords are stored encrypted with a key in `data/secret.key`; they are never sent back to the browser or included in a downloaded backup.
  - Gmail and Google Workspace need an **app password** (2-Step Verification on). Microsoft 365 has switched off password sign-in for IMAP and SMTP in most organisations, so it works only where an administrator allows it for that mailbox.

All modules share one data file, `data/db.json`. It runs on your own computer, or online on a small cloud server: see [Putting LTDC ERP online with Amazon EC2](deploy/aws/EC2.md).

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

> To try it out, go to **Settings → Load demo data**. This loads 6 sample employees, about six weeks of attendance,
> 16 IT assets and 7 inventory items, and demo accounts you can sign in with to see each account type: `hr.demo`, `payroll.demo`, `it.demo` and `employee.demo`
> (password `demo1234`). Your own account is kept.
> When you're ready for real data, use **Settings → Erase all data**. It removes the demo accounts too.

To use a different port, run `PORT=8080 npm start`.

## Run it on Windows

### Easiest: the Windows package (nothing to install)

`LTDC-ERP-Windows-x64.zip` contains the app **and its own copy of Node.js**, so there is nothing to install.

1. Right-click the zip → **Properties** → tick **Unblock** if it is shown → **OK**.
2. Right-click → **Extract All…** and put the `LTDC-ERP` folder somewhere permanent, such as **Documents** (not Program Files). Your data is saved inside it.
3. Double-click **`Start LTDC ERP.bat`**. The app opens in your browser at <http://localhost:3000>. Keep the black window open while you use it.
4. Optional: double-click **`Create desktop shortcut.bat`**.

The folder also has **`Start LTDC ERP (office network).bat`** (lets other PCs sign in), **`Reset a password.bat`** (for a locked-out admin) and **`READ ME FIRST.txt`**.
To build the package yourself, run `scripts/build-windows.sh` on macOS or Linux. It downloads the official Node.js Windows build, checks it against nodejs.org's checksums, and writes `dist/LTDC-ERP-Windows-x64.zip`.

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
| **HR Manager** | Add and edit employees, manage attendance and approve overtime, run the shared time clock, **approve leave and remote-work requests**, manage leave credits, adjust Payroll Setup. View payroll and IT assets. |
| **IT Asset Manager** | IT Asset Management: register, assign, transfer, return and retire assets; receive, issue and count stock; export. No access to HR records. |
| **Payroll Officer** | Create, adjust and finalize payroll, adjust Payroll Setup and leave credits. View employees, attendance and requests (cannot approve them). |
| **Employee** | Self-service only: clock in and out, file leave and remote-work requests, see their own attendance, leave balances, finalized payslips, profile and assigned equipment. |

- Admins add accounts in **Users & Access** and give the person a temporary password. They're asked to pick their own password the first time they sign in.
- **Employee** accounts must be linked to an employee record. HR Managers and Payroll Officers can be linked too, which gives them the "My account" pages.
- Anyone can change their password from the bottom of the sidebar. Admins can reset anyone's password or disable an account.
- After 5 wrong passwords, that username is locked for 5 minutes. People are signed out after 8 idle hours, or when the app is restarted.
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
| Rest day work | hours × hourly rate × 1.30 (approved only) |
| SSS | 2025 schedule: 5% employee and 10% employer share of the Monthly Salary Credit (₱5,000–₱35,000), plus EC |
| PhilHealth | 5% of monthly basic salary (floor ₱10k, ceiling ₱100k), split 50/50 |
| Pag-IBIG | 2% employee and 2% employer share, on a fund salary capped at ₱10,000 (max ₱200 each) |
| Withholding tax | BIR TRAIN table effective 2023, applied to gross pay minus employee contributions. Minimum wage earners are exempt |
| Allowance | monthly, non-taxable (de minimis), split across pay periods. Not paid, and no contributions deducted, in a period with no pay |

In a semi-monthly payroll, contributions are split equally between the two cutoffs.
To add bonuses, commissions, holiday pay, loans or cash advances, click **Adjust** on an employee's row in a draft payroll run.
A draft run can be recomputed after you edit attendance. Once you finalize it, it is locked.

Pay frequency, multipliers, grace period, minimum overtime, which deductions apply, the SSS / PhilHealth / Pag-IBIG rates and the tax tables are all set in **Payroll Setup**. It has a **Try it** calculator to check deductions at any salary before saving, and a button to restore the 2025 government rates. Changes apply to new runs and to drafts when recomputed; finalized runs never change.

**Check these rates against the latest SSS, PhilHealth, Pag-IBIG and BIR circulars before you rely on the payroll.** Government rates change.

## Leave and remote work

1. The employee opens **My Requests → File a request**, picks a leave type or **Remote work**, the dates and a reason. Only scheduled work days are counted, and leave with a yearly limit cannot exceed the remaining balance.
2. HR Managers and Administrators see it under **Leave & Requests** (the menu shows how many are waiting) and approve or reject it with an optional note. Nobody can approve their own request.
3. Approving writes each day into attendance: as leave (paid or unpaid, per the leave type), or as a remote-work day. The employee can still clock in on a remote day to record actual hours.
4. An approved request can be cancelled by HR; its days are removed from attendance and the credits come back. Employees can withdraw requests that are still pending.

Default leave types (editable under **Leave & Requests → Leave types**): Vacation 15, Sick 15, Emergency 3, Paternity 7 and Solo Parent 7 days a year; Maternity and Leave Without Pay with no yearly limit. Credits can be changed per employee and year under **Leave balances**, e.g. for carry-over or new hires. Balances count all leave in attendance, including leave HR records directly.

Administrators can manage one person's leave under **Leave & Requests → Employee leave** (or **Manage leave** on the employee's profile): switch leave types on or off for that employee (a type can also be set to *only employees you add*), set their yearly credits, add or take away days with a reason (carry-over, offsets, corrections), and record or remove leave taken outside the system. Employees only see and file the leave types they get.

## Not included (yet)

Holidays and holiday pay rates, night differential, half-day leave, two-level approvals, 13th month pay, loans with amortization, government remittance reports and BIR 2316, password reset by email, and an audit log.

## Put it online (cloud)

To use it 24/7 from any browser over HTTPS, follow [deploy/aws/EC2.md](deploy/aws/EC2.md). It sets up an Amazon EC2 Ubuntu server with Caddy for HTTPS, automatic restarts, nightly data backups and optional automatic deployment: the GitHub workflow `.github/workflows/deploy-ec2.yml` tests every push and installs it on the server through AWS Systems Manager (permissions from `deploy/aws/github-deploy.yaml`; no SSH keys or AWS keys stored). Two settings matter online: `COOKIE_SECURE=1` (login cookie sent over HTTPS only) and `ALLOWED_HOSTS=<your address>`. To create the first Administrator from the server instead of the first-run page, stop the app and run `npm run create-admin -- <username> "<Full Name>"`; it prints a temporary password.

## Backups

Admins can use **Settings → Download backup** to save everything as a single JSON file, and **Restore backup** to load one back.
The backup includes user accounts (with passwords stored as secure hashes), so keep the file private.
You can also just copy the `data/` folder. It also holds `attachments/` (medical certificates, ticket files) and `secret.key`, which unlocks the saved mailbox passwords; without it, re-enter them under Service desk settings.

## For developers

- **Dev log:** written by one developer, in the first person. Each build's entry goes at the top of `shared/devlog.js` (version such as `0.2.4-alpha`, date, a short note, the changes, known issues) and `package.json` "version" must match; `npm test` checks both. A server copies each build's entry into its database the first time it runs that build (`server/devlog.js`); after that, administrators edit, add or delete entries and set the author name under **System → Dev log**, and those edits survive updates, demo data and "erase all data". The installed build comes from `build.json`, written by the installers.

- `server.js` is a dependency-free Node HTTP server. The JSON API is in `server/api.js` and storage in `server/db.js`.
- `server/leave.js` and `server/assets.js` hold the leave/request and IT asset routes; `shared/assets.js` the asset statuses and categories.
- `public/js/modules.js` lists the ERP modules shown on the launcher (`public/js/views/launcher.js`). To add a module: add its routes and menu in `public/js/app.js`, set it to `live`, and give it a home in `moduleHome()`.
- `shared/calc.js` holds all the time and payroll math. Both the server and the browser use it.
- `shared/roles.js` defines the account types and permissions. The server enforces them on every API call (`server/api.js`), and the browser uses them to hide screens and buttons. Passwords and sessions are in `server/auth.js`.
- `public/` is the single-page app: plain ES modules with no build step.
- Run the tests with `npm test`.
- Build the Windows package with `scripts/build-windows.sh` (needs `curl`, `zip`, `unzip`; set `NODE_VERSION` to change the bundled runtime). The launchers, icon and read-me it adds are in `packaging/windows/`.
