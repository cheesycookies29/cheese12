# LTDC HR & Payroll

A simple HR app for Lancaster Technology and Development Corporation (LTDC). It runs on your own computer, opens in your browser, and follows the look of [lancastertechdev.com](https://lancastertechdev.com/). It has these parts:

- **Employee records**: personal details, employment, pay rate, work schedule, government IDs (TIN, SSS, PhilHealth, Pag-IBIG) and bank details.
- **Time tracking**: a time clock where employees clock in and out, and an attendance record (DTR) that works out late, undertime and overtime minutes. You can also add paid leave, fix records by hand and approve overtime.
- **Payroll**: semi-monthly or monthly payroll runs worked out from attendance, with SSS, PhilHealth, Pag-IBIG and BIR withholding tax. It produces a payroll register (CSV) and payslips you can print or save as PDF.
- **Leave and remote work**: employees file leave or work-from-home requests; HR Managers or Administrators approve them, and approved days go into attendance and payroll automatically. Leave types, yearly credits and balances are managed in **Leave & Requests**.
- **Payroll Setup**: HR Managers and Payroll Officers adjust pay rules, government contribution rates and BIR tax tables without code changes.
- **User access**: everyone signs in with their own account, and each account type only sees what it needs (see below).

There is no cloud. Your data stays on your Mac in `data/db.json`.

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
> and three demo accounts you can sign in with to see each account type: `hr.demo`, `payroll.demo` and `employee.demo`
> (password `demo1234`). Your own account is kept.
> When you're ready for real data, use **Settings → Erase all data**. It removes the demo accounts too.

To use a different port, run `PORT=8080 npm start`.

## Run it on Windows

### Easiest: the Windows package (nothing to install)

`LTDC-HR-Windows-x64.zip` contains the app **and its own copy of Node.js**, so there is nothing to install.

1. Right-click the zip → **Properties** → tick **Unblock** if it is shown → **OK**.
2. Right-click → **Extract All…** and put the `LTDC-HR` folder somewhere permanent, such as **Documents** (not Program Files). Your data is saved inside it.
3. Double-click **`Start LTDC HR.bat`**. The app opens in your browser at <http://localhost:3000>. Keep the black window open while you use it.
4. Optional: double-click **`Create desktop shortcut.bat`**.

The folder also has **`Start LTDC HR (office network).bat`** (lets other PCs sign in), **`Reset a password.bat`** (for a locked-out admin) and **`READ ME FIRST.txt`**.
To build the package yourself, run `scripts/build-windows.sh` on macOS or Linux. It downloads the official Node.js Windows build, checks it against nodejs.org's checksums, and writes `dist/LTDC-HR-Windows-x64.zip`.

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
| **HR Manager** | Add and edit employees, manage attendance and approve overtime, run the shared time clock, **approve leave and remote-work requests**, manage leave credits, adjust Payroll Setup. View payroll. |
| **Payroll Officer** | Create, adjust and finalize payroll, adjust Payroll Setup and leave credits. View employees, attendance and requests (cannot approve them). |
| **Employee** | Self-service only: clock in and out, file leave and remote-work requests, see their own attendance, leave balances, finalized payslips and profile. |

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

## Not included (yet)

Holidays and holiday pay rates, night differential, half-day leave, two-level approvals, 13th month pay, loans with amortization, government remittance reports and BIR 2316, password reset by email, and an audit log.

## Backups

Admins can use **Settings → Download backup** to save everything as a single JSON file, and **Restore backup** to load one back.
The backup includes user accounts (with passwords stored as secure hashes), so keep the file private.
You can also just copy the `data/` folder.

## For developers

- `server.js` is a dependency-free Node HTTP server. The JSON API is in `server/api.js` and storage in `server/db.js`.
- `shared/calc.js` holds all the time and payroll math. Both the server and the browser use it.
- `shared/roles.js` defines the account types and permissions. The server enforces them on every API call (`server/api.js`), and the browser uses them to hide screens and buttons. Passwords and sessions are in `server/auth.js`.
- `public/` is the single-page app: plain ES modules with no build step.
- Run the tests with `npm test`.
- Build the Windows package with `scripts/build-windows.sh` (needs `curl`, `zip`, `unzip`; set `NODE_VERSION` to change the bundled runtime). The launchers, icon and read-me it adds are in `packaging/windows/`.
