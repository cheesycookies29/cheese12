---
id: payroll
title: Running payroll in CORE
summary: For Payroll Officers: payroll runs, the register, adjustments and payslips, finalizing and voiding, year-to-date totals, Payroll Setup and the holiday calendar, and how pay is computed.
roles: payroll
apps: hr
order: 35
---

## Before you start

This guide is for **Payroll Officers**. You compute a payroll run for each pay period, check and adjust it, finalize it and print the payslips. You keep the year-to-date totals and, with HR, **Payroll Setup** and the **Holidays** calendar. HR keeps employee records and attendance (see [the HR guide](hr)); you can view them.

- Sign in and open the **HR & Payroll** tile on the CORE home page. You land on the **Dashboard**; open **Payroll** from the menu.
- CORE runs **semi-monthly** payroll (the 1st to the 15th, and the 16th to the end of the month) unless **Payroll Setup** says *Monthly*.
- To try things out, load the demo data and sign in as `payroll.demo` (password `demo1234`). The demo has about six weeks of attendance and no payroll runs yet.

### What to have ready before a run

- Attendance for the whole period is complete in **Attendance (DTR)**. A scheduled work day with no record counts as an absence.
- Overtime is approved, and leave and work-from-home requests in the period are decided. HR does both.
- New holidays, such as Eid'l Fitr or a local holiday, are on the **Holidays** calendar.
- Each employee's pay type, rate, allowance and schedule are right on their record (HR edits records).

## Walkthrough

A first tour with the demo data, about fifteen minutes. It uses the last full half-month: if today is 8 November, that is 16 to 31 October.

### Compute a payroll run

1. Sign in as `payroll.demo`, open **Payroll** and click **+ New payroll run**.
2. The dates start at the current pay period. Change **Period start** to the 16th of last month. **Period end** and **Pay date** move to the end of that month.
3. Click **Compute payroll**. The run opens as a *Draft*.

![The New payroll run window](payroll-new-run.jpg)

### Read the register

1. The cards show the employees, gross pay, total deductions, net pay and the employer contributions.
2. The register has one line per employee: **Days** (paid days of scheduled days), **Absent**, **Late/UT**, **OT**, **Basic**, **Premiums** (overtime, rest day, holiday and night-shift pay together), **Other earn.**, **Gross**, the SSS, PhilHealth, Pag-IBIG and tax deductions, **Other ded.**, **Allowance** and **Net pay**. On a phone each employee is a card with the days, gross and net pay; **Details** shows the rest.
3. If a notice shows above the register, it lists open records, absences, overtime not yet approved and pending requests in the period.

![The register of a draft run](payroll-register.jpg)

### Open a payslip

1. Click **Payslip** on *Dela Cruz, Juan G.* The payslip is marked *Draft, not final*.
2. Under **Earnings**, each premium has its own line with the hours and the rate, for example *Overtime, 2h 36m × 125%*. Late and undertime are taken off the basic pay.
3. Under it are the deductions, net pay in words, the attendance counts and the employer's share.
4. Click the period at the top to go back.

![A payslip with the overtime line](payroll-payslip.jpg)

### Adjust, then finalize

1. Click **Adjust** on Juan's row. You could add **Other earnings (₱, taxable)**, **Other deductions (₱)** and **Remarks (shown on payslip)**. Click **Cancel** for now.
2. Click **Finalize**, then **Finalize** again. The run is recomputed one last time and locked.
3. Go back to **Payroll** and click **Year to date**. Each employee now has this payslip in their totals, with the **13th month so far**.

![A finalized run: locked](payroll-finalized.jpg)

## How to…

### Run payroll for a pay period

1. Open **Payroll** and click **+ New payroll run**.
2. Check **Period start**, **Period end** and **Pay date**. Changing the start moves the end and the pay date to the end of that period.
3. Click **Compute payroll**.

Every active employee hired by the end of the period is included. Run it once the period has ended, so all attendance is in.

### Check a draft run

1. Read the notice above the register (see the list below).
2. Ask HR to fix the attendance, approve the overtime or decide the requests.
3. Click **Recompute**. It takes the latest attendance, employee records, holidays and Payroll Setup. Your adjustments stay.
4. Open a few payslips and compare them with the register.

The notice lists:

- employees with open attendance records (no clock-out): those days are not paid until fixed in **Attendance (DTR)**;
- scheduled work days with no record, counted as absences;
- overtime waiting for approval, which is not paid until approved;
- leave or remote-work requests in the period that are still pending.

### Add other earnings or deductions

1. In a draft run, click **Adjust** on the employee's row.
2. Enter **Other earnings (₱, taxable)**, such as a bonus or commission, or **Other deductions (₱)**, such as a cash advance or a loan payment.
3. Write the reason in **Remarks (shown on payslip)** and click **Save**.

![Adjusting one employee's pay](payroll-adjust.jpg)

The run is recomputed. Other earnings are taxable. Do not add holiday, overtime or night-shift pay here: CORE computes them from attendance.

### Export the register

1. Open the run and click **Export register**.

The CSV has one row per employee, with overtime, rest-day, holiday and night pay in separate columns, and the bank and account number for the bank's payroll file.

### Print payslips

1. Open the run and click **Print payslips** for everyone, or **Payslip** on one row.
2. Click **Print / Save as PDF**.

A draft payslip has a *DRAFT* watermark. Employees see their payslips under **My Payslips** once the run is finalized.

### Read the premium lines on a payslip

Each line shows what it pays for, the hours (or days) and the rate:

- *Overtime*: approved hours after the shift, × 125%.
- *Rest day worked*: approved hours on a rest day, × 130% for the first 8 hours.
- *Special non-working day worked (premium over the day's pay)*: on a scheduled work day the salary already pays 100%, so the line adds 30%.
- *Regular holiday worked (premium over the day's pay)*: adds 100% to the day's pay, for 200%.
- *Regular holiday, not worked*: a day's pay for daily-rated staff.
- *Night differential*: hours from 10 PM to 6 AM × 10% of the rate that applies, so 20% on a regular holiday.

The **Attendance** box lists each holiday in the period, marked *(worked)* or *(not paid)*, and the night-shift hours.

![A daily-rated employee's payslip with a holiday worked](payroll-holiday-payslip.jpg)

### Finalize a payroll run

1. Open the draft run and click **Finalize**, then **Finalize** again.
2. The run is recomputed one last time and locked.

After finalizing:

- each employee sees the payslip under **My Payslips**;
- the payslips are posted to **Year to date**;
- the run cannot be changed or deleted.

If HR later edits attendance inside the period, CORE warns them that this payroll does not change. Put the difference in the next run with **Adjust**.

### Void a finalized run

A finalized run is a record. It is never deleted; you void it.

1. Open the run and click **Void payroll run** at the bottom.
2. Give the **Reason (recorded in the audit log)** and click **Void payroll run**.

The run and its payslips stay on record, marked *Voided*; employees see theirs marked too. They leave the year-to-date totals. To pay the period again, create a new run for it. Only a draft can be deleted (**Delete payroll run**).

### Check the year to date

1. Open **Payroll → Year to date** and pick the year tab.
2. The cards show gross pay, tax withheld, employee contributions and **13th month accrued**. The table has each employee's totals: basic pay, premiums, gross, non-taxable and taxable pay, contributions, tax withheld, net and **13th month so far**.
3. Click **Export CSV** for every amount, including the employer shares.

Only finalized payslips count; drafts and voided runs do not. The same totals are on each employee's record and in their **My Payslips**.

![Year to date](payroll-year-to-date.jpg)

### Add an opening balance

Use this for pay this year that CORE did not compute.

1. Open **Year to date** and click **+ Opening balance**.
2. Pick the **Employee** and the **Source** (see below).
3. Enter **Covers pay up to**, the amounts (at least **Gross pay**) and a **Note (recorded in the audit log)**, for example *BIR 2316 from ABC Corp., January to March*.
4. Click **Add opening balance**.

The two sources:

- *LTDC, before CORE*: months paid at LTDC before CORE was used. The basic pay counts toward the 13th month.
- *Previous employer (BIR 2316)*: a new hire's pay from their previous employer this year, from their BIR 2316. It counts for tax, not for LTDC's 13th month.

To take one back, click **Remove** in **Opening balances** and give a reason.

![Adding an opening balance](payroll-opening-balance.jpg)

### Change payroll setup

1. Open **Payroll Setup**. It is shared with HR Managers; the top says who changed it last.
2. **Pay rules**: **Pay frequency**, **Work days per year** (the daily-rate factor), **Late grace period** and **Minimum overtime**. Under **Deductions to compute**, tick SSS, PhilHealth, Pag-IBIG and BIR withholding tax.
3. **Holiday, rest day and night premiums**: the rate for the first 8 hours and for each overtime hour on each kind of day, the **Night shift differential** and its hours. **Restore DOLE premium rates** fills in the defaults below.
4. **Holidays not worked**: whether a regular holiday needs the employee present, or on paid leave, on the last working day before it, and whether a **Special non-working day, not worked** is *Paid (company policy)* or *Not paid: "no work, no pay"*.
5. **Government contributions** and **Withholding tax tables** (**+ Add bracket**, **Remove**). **Restore 2025 government rates**, under the tax tables, fills in the 2025 SSS, PhilHealth and Pag-IBIG rates and the TRAIN tables. Nothing is saved until you choose **Save payroll setup**.
6. Under **Try it**, enter a **Monthly salary ₱** to see one period's deductions with the values on the page, saved or not.
7. Click **Save payroll setup**.

Nothing is saved until you click **Save payroll setup**. Changes apply to new runs and to drafts when you recompute; finalized runs never change.

![The premiums table in Payroll Setup](payroll-setup.jpg)

### Add a holiday

1. Open **Holidays** and pick the year.
2. Click **+ Add holiday**, enter the **Date**, **Name**, **Type** and **Applies to**, and click **Add holiday**.
3. **Recompute** any draft run that covers the date.

See [the HR guide](hr#keep-the-holiday-calendar) for loading the proclaimed holidays and the three types.

## Screens at a glance

| Screen | What it is for |
|---|---|
| Dashboard | Headcount, today's attendance, pending requests and the latest payroll |
| Employees | Employee records with pay, schedules and masked government IDs (view only), year to date and recent payslips |
| Attendance (DTR) | Daily time records for the period (view only) |
| Leave & Requests | Requests, leave balances and leave types; you can change credits, HR decides requests |
| Payroll | Payroll runs: the register, adjustments, payslips, finalize and void; **Year to date** with opening balances |
| Payroll Setup | Pay rules, premiums, holiday rules, contribution rates, tax tables and **Try it** |
| Holidays | The holiday calendar payroll uses |

## Questions

**How is pay computed?**
From each employee's rate and attendance, with the rules in Payroll Setup:

| Item | Rule |
|---|---|
| Daily rate | Monthly-rated: monthly salary × 12 ÷ work days per year (the employee's own, or the company default). Daily-rated: the rate |
| Hourly rate | Daily rate ÷ scheduled hours a day (shift length minus the unpaid break) |
| Basic pay, monthly-rated | Half the monthly salary each semi-monthly period, less absences, unpaid leave, late and undertime |
| Basic pay, daily-rated | (Days present + paid leave days) × daily rate, less late and undertime |
| Paid leave, remote work | Paid days. A remote day with no clock times counts as a full day |
| Overtime | Approved minutes after the shift, at least the minimum overtime (30 minutes), × hourly rate × 125% |
| Rest day | Approved work only: first 8 hours × 130%, each hour beyond × 169% |
| Holidays worked | Special non-working day 130% (169% overtime), regular holiday 200% (260%); on a rest day 150% / 260%; double holiday 300%. No late or undertime on a holiday |
| Holidays not worked | A regular holiday is paid if the employee was present, or on paid leave, on the last working day before it. Monthly salaries already include it; daily-rated staff get a day's pay. Special days not worked: paid or not, as Payroll Setup says |
| Night shift differential | 10% of the rate that applies, for each hour from 10 PM to 6 AM |
| SSS | 5% employee and 10% employer share of the Monthly Salary Credit (₱5,000 to ₱35,000), plus EC paid by the employer |
| PhilHealth | 5% of the monthly basic salary (floor ₱10,000, ceiling ₱100,000), shared equally |
| Pag-IBIG | 2% employee and 2% employer, on up to ₱10,000 (₱200 each at most) |
| Withholding tax | BIR TRAIN tables effective 2023, on gross pay less the employee's SSS, PhilHealth and Pag-IBIG. Minimum wage earners are exempt |
| Allowance | Monthly, non-taxable (de minimis), split across the periods. Not paid in a period with no pay |

In a semi-monthly payroll each contribution is split equally between the two periods.

**Where do the premium rates come from?**
The Labor Code (night shift differential, Art. 86; overtime, Art. 87; rest day, Art. 93; holiday pay, Art. 94) and DOLE's yearly holiday pay advisory. The holidays themselves come from the President's proclamation for the year. **Restore DOLE premium rates** puts the defaults back.

**Why is someone's daily rate lower than I expected?**
Check **Work days per year**. A new CORE uses 312 (a 6-day week). For a Monday-to-Friday schedule, 261 is usual; Payroll Setup says so under the field. Confirm the factor with the accountant, and set an employee's own on their record if needed.

**Why was a regular holiday not paid?**
The employee had no attendance, or unpaid leave, on the last working day before it. Days before the employee's first record in CORE are not held against them. You can turn the rule off in **Payroll Setup → Holidays not worked**.

**Someone joined after I created the run. Why are they not in it?**
A run keeps the employees it started with; **Recompute** does not add new ones. Delete the draft and create it again.

**Can I change a finalized run?**
No. Correct it in the next run with **Adjust**, or void it with a reason and run the period again.

**How is the 13th month so far worked out?**
1/12 of the basic pay earned at LTDC this year, from finalized payslips and *LTDC, before CORE* opening balances. A previous employer's pay does not count.

**Does CORE do the 13th month run, annualization or BIR 2316?**
Not yet. The 13th month pay run, year-end tax annualization, BIR 2316 and the alphalist will be built on the year-to-date totals. Loans and government remittance reports are not in CORE yet either; use **Other deductions** for a loan payment.

**The rates changed. What do I do?**
Check SSS, PhilHealth, Pag-IBIG and BIR circulars before you rely on the payroll. Enter new rates or tax brackets in **Payroll Setup**, check them with **Try it**, and click **Save payroll setup**.

**Who can see the payroll?**
Payroll Officers, HR Managers (view only) and administrators. Each employee sees only their own finalized payslips.
