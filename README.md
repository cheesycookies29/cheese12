# LTDC HR & Payroll

A simple HR app for Lancaster Technology and Development Corporation (LTDC). It runs on your own computer, opens in your browser, and follows the look of [lancastertechdev.com](https://lancastertechdev.com/). It has three parts:

- **Employee records**: personal details, employment, pay rate, work schedule, government IDs (TIN, SSS, PhilHealth, Pag-IBIG) and bank details.
- **Time tracking**: a time clock where employees clock in and out, and an attendance record (DTR) that works out late, undertime and overtime minutes. You can also add paid leave, fix records by hand and approve overtime.
- **Payroll**: semi-monthly or monthly payroll runs worked out from attendance, with SSS, PhilHealth, Pag-IBIG and BIR withholding tax. It produces a payroll register (CSV) and payslips you can print or save as PDF.

There is no account system and no cloud. Your data stays on your Mac in `data/db.json`.

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

> To try it out, go to **Settings → Load demo data**. This loads 6 sample employees and about six weeks of attendance.
> When you're ready for real data, use **Settings → Erase all data**.

To use a different port, run `PORT=8080 npm start`.

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

Holidays and holiday pay rates, night differential, leave balances and approvals, 13th month pay, loans with amortization, government remittance reports and BIR 2316, user logins and roles.

## Backups

Use **Settings → Download backup** to save everything as a single JSON file, and **Restore backup** to load one back.
You can also just copy the `data/` folder.

## For developers

- `server.js` is a dependency-free Node HTTP server. The JSON API is in `server/api.js` and storage in `server/db.js`.
- `shared/calc.js` holds all the time and payroll math. Both the server and the browser use it.
- `public/` is the single-page app: plain ES modules with no build step.
- Run the payroll math tests with `npm test`.
