# LTDC HR & Payroll

A simple HR app for Lancaster Technology and Development Corporation (LTDC). It runs on your own computer, opens in your browser, and follows the look of [lancastertechdev.com](https://lancastertechdev.com/). It has four parts:

- **Employee records**: personal details, employment, pay rate, work schedule, government IDs (TIN, SSS, PhilHealth, Pag-IBIG) and bank details.
- **Time tracking**: a time clock where employees clock in and out, and an attendance record (DTR) that works out late, undertime and overtime minutes. You can also add paid leave, fix records by hand and approve overtime.
- **Payroll**: semi-monthly or monthly payroll runs worked out from attendance, with SSS, PhilHealth, Pag-IBIG and BIR withholding tax. It produces a payroll register (CSV) and payslips you can print or save as PDF.
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
| **HR Manager** | Add and edit employees, manage attendance and approve overtime, run the shared time clock. View payroll. |
| **Payroll Officer** | Create, adjust and finalize payroll. View employees and attendance. |
| **Employee** | Self-service only: clock in and out, see their own attendance, finalized payslips and profile. |

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
| Daily rate (monthly-rated) | monthly salary × 12 ÷ work days per year (261 by default, set in Settings) |
| Hourly rate | daily rate ÷ scheduled hours per day (shift length minus break) |
| Basic pay, monthly-rated | half the monthly salary per semi-monthly period, minus absences, late and undertime |
| Basic pay, daily-rated | (days present + paid leave days) × daily rate, minus late and undertime |
| Absences | scheduled work days in the period that have no attendance record |
| Overtime | minutes after the end of the shift × hourly rate × 1.25. It must be **approved** in Attendance and last at least 30 minutes |
| Rest day work | hours × hourly rate × 1.30 (approved only) |
| SSS | 2025 schedule: 5% employee and 10% employer share of the Monthly Salary Credit (₱5,000–₱35,000), plus EC |
| PhilHealth | 5% of monthly basic salary (floor ₱10k, ceiling ₱100k), split 50/50 |
| Pag-IBIG | 2% employee and 2% employer share, on a fund salary capped at ₱10,000 (max ₱200 each) |
| Withholding tax | BIR TRAIN table effective 2023, applied to gross pay minus employee contributions. Minimum wage earners are exempt |
| Allowance | monthly, non-taxable (de minimis), split across pay periods |

In a semi-monthly payroll, contributions are split equally between the two cutoffs.
To add bonuses, commissions, holiday pay, loans or cash advances, click **Adjust** on an employee's row in a draft payroll run.
A draft run can be recomputed after you edit attendance. Once you finalize it, it is locked.

The multipliers, grace period, minimum overtime, pay frequency and which deductions apply are all set in **Settings**.

**Check these rates against the latest SSS, PhilHealth, Pag-IBIG and BIR circulars before you rely on the payroll.** Government rates change.

## Not included (yet)

Holidays and holiday pay rates, night differential, leave balances and approvals, 13th month pay, loans with amortization, government remittance reports and BIR 2316, password reset by email, and an audit log.

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
