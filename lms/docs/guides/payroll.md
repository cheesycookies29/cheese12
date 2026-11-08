---
id: payroll
title: Preparing payroll in ATLAS People
summary: For payroll officers: government payroll runs and bonus runs, payslips, the General Payroll, remittances, sending payroll to Finance, and payroll setup.
roles: payroll
apps: people, finance
order: 56
---

## Before you start

This guide is for **payroll officers**. You prepare payroll for the campus you are looking at: compute a run for each pay period, check and adjust it, finalize it, print payslips and the General Payroll, and send it to ATLAS Finance to be obligated and paid. You can view employees, attendance and leave; HR keeps those records (see [the HR guide](hr)). Your own time clock, leave and payslips are in [the employee guide](employee).

- Sign in on the ATLAS home page and open the **People** tile. You land on the **HR dashboard**; open **Payroll** from the sidebar.
- Payroll runs belong to a campus. If you work at more than one, switch campus from your name at the top right. **Payroll setup** is shared by every campus.
- The school runs **government payroll** (a state university or college) unless **Payroll setup** says *Private school*. This guide describes government payroll; private payroll works the same way with SSS instead of GSIS and no bonus runs or Finance tab.
- To try things out, use the demo school: sign in as `payroll.demo` (password `demo1234`). Benjamin Soriano is the payroll officer at Main Campus.

### What to have ready before a run

- Attendance for the whole period is complete in **Attendance (DTR)**. A scheduled work day with no record counts as an absence without pay.
- Leave and remote-work requests in the period are decided by HR.
- Each employee's **salary grade and step**, PERA, RATA and appointment are right on their record (HR edits records), and loans are entered on the record (you do this).

## Walkthrough

A first tour with the demo school, about fifteen minutes.

### The payroll runs

1. Sign in as `payroll.demo`, open **People**, then **Payroll**.
2. The list shows the year-end bonus and cash gift as a *Draft*, the two most recent half-month payrolls (*Finalized*), and this year's mid-year bonus (*Finalized*). Each row has the number of employees, gross pay, deductions and net pay.

![Payroll runs at Main Campus](payroll-runs.jpg)

### A finalized regular run

1. Click the second row, the latest half-month payroll. The **Register** tab has one line per employee: salary grade and step, days present out of scheduled, absences, late and undertime (with the part charged to vacation leave, e.g. *VL 0.038*), basic salary, PERA, RATA, gross, GSIS, PhilHealth, Pag-IBIG, tax, loans and net pay.
2. Find *Santos, Maria* and click **Payslip**. Her payslip shows an honorarium under **Other earnings** and her GSIS and Pag-IBIG loans under **Deductions**. Click **Payroll** in the breadcrumb to go back.
3. Open the **Remittances** tab: what to remit to GSIS, PhilHealth, Pag-IBIG, BIR and each loan creditor, with a **CSV** per agency.
4. Open the **General Payroll** tab: the COA form (GAM Appendix 33), ready to print.
5. Open the **Finance** tab: the three steps that send this payroll to ATLAS Finance. Leave them for now.

![The register of a finalized run](payroll-register.jpg)

![A government payslip](payroll-payslip.jpg)

### Loans on an employee's record

1. Open **Employees** and click *Santos, Maria*.
2. Scroll to **Loans and deductions**: a GSIS Consolidated Loan, a Pag-IBIG Multi-Purpose Loan and union dues, each with the monthly amount, what has been paid and the balance. **Add** enters a new one.

![Loans and deductions on an employee's record](payroll-loans.jpg)

### A bonus run

1. Go back to **Payroll** and open **Year-end bonus and cash gift 2026** (the first row; the year is the current one). It is a draft.
2. Read the notice: some employees get nothing, for example a contract of service worker. The **Note** column says why for each person.
3. Click **Adjust** on a row to see how someone is left out of the run with a reason.
4. When you are ready, click **Finalize**. The run is recomputed one last time and locked, and the payslips appear in each employee's **My payslips**.

![The year-end bonus and cash gift as a draft](payroll-bonus.jpg)

### Payroll setup

1. Open **Payroll setup**. The **Government payroll** card holds the GSIS shares, PERA, the minimum net pay, the tardiness and overtime rules and the bonus amounts.
2. Scroll to **Salary schedule**: the EO 64 tranches, with the one in force marked.
3. Under **Try it**, pick a salary grade and step to see one pay period's deductions. Nothing is saved until you click **Save payroll setup**.

## How to…

### Run payroll for a pay period

1. Open **Payroll** and click **New payroll run**.
2. Leave **Kind** at *Regular payroll (salary, PERA, RATA)*.
3. Check **Period start**, **Period end** and **Pay date**. They start at the current pay period; changing the start moves the end to the end of that period.
4. Click **Compute payroll**.

All active employees of the campus hired by the end of the period are included, except anyone already paid for that period in another campus's run. The run opens as a *Draft*. Run it once the period has ended, so that all attendance is in.

### Check a draft run

1. Read the notice above the tabs and deal with what it lists (see below).
2. Ask HR to fix attendance or decide pending requests, then click **Recompute**.
3. Open a few payslips and compare them with the register.

The notice lists:

- employees with an open attendance record (no clock-out): those days are not paid until fixed in **Attendance (DTR)**;
- scheduled work days with no record, counted as absences without pay;
- leave or remote-work requests in the period that are still pending;
- loans or deductions held back so net pay stays at the minimum;
- tardiness and undertime that will be charged to vacation leave when the run is finalized.

**Recompute** takes the latest attendance, leave, loans, employee records and payroll setup. Your adjustments stay.

### Adjust one employee's pay

1. In a draft run, click **Adjust** on the employee's row.
2. Enter **Other earnings (₱, taxable)**, such as an honorarium, or **Other deductions (₱)**, such as a refund.
3. Write the reason in **Remarks (shown on payslip)**.
4. Click **Save**. The run is recomputed.

### Leave someone out of a run

1. Click **Adjust** on the employee's row.
2. Tick **Leave out of this run** and give the reason in **Remarks**, for example *On leave without pay* or, in a bonus run, *Performance rating below Satisfactory*.
3. Click **Save**.

The row turns grey and pays nothing; no loans are taken. If someone has already been paid for the period or bonus in a finalized run at another campus, ATLAS refuses to finalize until they are left out.

### Finalize a run

1. Open the draft run and click **Finalize**, then **Finalize** again.
2. The run is recomputed one last time and locked.

After finalizing:

- employees see their payslip under **My payslips**;
- tardiness charged to vacation leave comes off each person's credits;
- loan balances count the amounts taken;
- the **Finance** tab opens.

A finalized run never changes, even if payroll setup changes later. To correct one, delete it (only while it has no live documents in Finance) and run the period again; deleting gives back the leave it charged.

### Print payslips

1. Open the run and click **Print payslips** for every employee, or **Payslip** on one row.
2. Click **Print / Save as PDF**.

A draft payslip is marked *DRAFT*. Each payslip shows the employer address and TIN set in HR settings.

### Add a loan or deduction to an employee

1. Open **Employees**, click the employee and scroll to **Loans and deductions**.
2. Click **Add**.
3. Choose the **Kind**, for example *GSIS Multi-Purpose Loan (GSIS)* or *Cooperative (Cooperative)*. The agency in brackets is where it is remitted.
4. Enter the **Loan / account no.**, the **Amount a month (₱)**, the **First month** and, if known, the **Last month**.
5. For a loan, enter the **Total to pay (₱)** from the amortization schedule. Deductions stop once it is paid. Leave it blank for dues and savings.
6. Click **Add**.

It is taken from the next payroll run. On a semi-monthly payroll half the monthly amount is taken each time. To change a loan, click **Edit**; recompute draft runs to apply it. A deduction already taken in a finalized payroll cannot be deleted: set its **Last month** instead.

### Run a bonus or allowance

1. Open **Payroll** and click **New payroll run**.
2. Choose the **Kind**: *Mid-year bonus*, *Year-end bonus and cash gift*, *Productivity Enhancement Incentive* or *Clothing / uniform allowance*.
3. Enter the **Year** and the **Pay date**. The mid-year bonus is paid from 15 May; the year-end bonus and cash gift from 15 November.
4. Click **Compute payroll**.
5. Read the **Months** and **Note** columns. Leave out anyone who is not entitled for a reason ATLAS cannot see (for example a rating below Satisfactory), then **Finalize**.

There can be one run of each kind per year at a campus. Everyone in service on the cut-off date is listed, including someone who left after it (HR records the **Date separated**).

### Remit contributions and taxes

1. Open a finalized run and the **Remittances** tab.
2. For each agency, the card shows the employee share, the government share and loans, and the total to remit.
3. Click **CSV** on a card for a list per employee with their GSIS BP no., PhilHealth no., Pag-IBIG MID or TIN, for the agency's remittance file.

GSIS, PhilHealth and Pag-IBIG are due by the 10th of the following month; BIR Form 1601-C by the 10th (the 15th for eFPS filers).

### Print the General Payroll

1. Open the run and the **General Payroll** tab.
2. Click **Print General Payroll**.

It lists everyone paid in the run, with the signature boxes A to D. Boxes B to D carry the names of the Chief Accountant, the head of agency and the disbursing officer from Finance's settings.

![The General Payroll (Appendix 33)](payroll-general-payroll.jpg)

### Send a finalized payroll to Finance

The **Finance** tab of a finalized government run takes the payroll through ATLAS Finance, one step at a time. You act for the payroll office (Box A); Finance's officers do the rest.

1. **Obligation request.** Choose the **Personnel services allotment** (and the **MOOE (job orders) allotment** if the run pays job orders) and click **Prepare the obligation request**. The ORS/BURS goes to the budget office, which obligates it (Box B).
2. **Payroll voucher.** Once the request shows *Obligated*, choose **Paid by**: *LDDAP-ADA (credited to the employees' accounts)* or *MDS check*, and click **Prepare the voucher**. It goes to the Chief Accountant (Box C), then the head of agency (Box D), then the cashier, who pays it. Paying it posts the journal entry.
3. **Remittances.** Once the voucher shows *Paid*, click **Prepare remittance vouchers (GSIS, PhilHealth, Pag-IBIG, BIR)**. They go to the accountant like any voucher.

Each step shows its document number, amount and status, with a link that opens it in Finance for Finance's officers. The **Accounting entry** under the steps shows what the voucher debits and credits. Cooperative, provident fund and other deductions are remitted with a voucher to each creditor, made in Finance. A run with live documents in Finance cannot be deleted.

![The Finance tab of a finalized run](payroll-finance.jpg)

### Change payroll setup

1. Open **Payroll setup**.
2. Change what you need: the **Payroll system**, **Government payroll** amounts and rules, **Pay rules**, **Deductions to compute**, contribution rates or the **Withholding tax tables**.
3. Use **Try it** to check the result for a salary grade and step.
4. Click **Save payroll setup**.

Changes apply to new runs and to drafts when you recompute; finalized runs keep the rules they were computed with. **Restore default rates** fills in the current GSIS, PhilHealth and Pag-IBIG rates, PERA and bonus amounts and the TRAIN tax tables, without saving. The salary schedule is read-only.

![Payroll setup](payroll-setup.jpg)

## Screens at a glance

| Screen | What it is for |
|---|---|
| HR dashboard | Headcount, today's attendance and the latest payroll for the campus |
| Employees | Employee records (view only) and each employee's **Loans and deductions** and recent payslips |
| Attendance (DTR) | Daily time records for the period (view only) |
| Leave & approvals | Leave requests, balances and leave types (HR approves requests) |
| Payroll | Payroll and bonus runs: the register, adjustments, payslips, Remittances, General Payroll and Finance |
| Payroll setup | Government or private payroll, amounts and rules, the salary schedule, contribution rates and tax tables |
| My day, My attendance, Leave & requests, My payslips, My profile | Your own self-service, as for every employee: see [the employee guide](employee) |
| My accountabilities, Supply & purchase requests | Your own self-service in ATLAS Finance: see [the employee guide](employee) |

## Questions

**How is government pay worked out?**
By the national government's rules (EO 64, CSC, DBM, the GAA and BIR), built into ATLAS. Payroll setup holds the amounts and rates.

| Item | Rule |
|---|---|
| Basic salary | From the salary grade and step on the record, using the EO 64, s. 2024 schedule in force at the end of the pay period (January payroll moves to the next tranche by itself). Semi-monthly: half each time |
| Daily rate | Monthly salary ÷ 22 (*Working days a month*); a minute is 1/480 of a day |
| Absences without pay | A scheduled work day with no record, or unpaid leave, at the daily rate |
| Tardiness and undertime | Charged to vacation leave credits first (CSC); what the credits cannot cover is deducted from pay. Not for FLEX employees |
| PERA | ₱2,000 a month, less 1/22 for each day of absence without pay. Not taxable |
| RATA | The official's monthly amounts, paid in the run that ends on the last day of the month, by days of actual work: 17 or more 100%, 12 to 16 75%, 6 to 11 50%, 1 to 5 25%. Not taxable |
| GSIS | 9% personal share and 12% government share of the monthly basic salary; Employees' Compensation ₱100, paid by the government |
| PhilHealth | 5% of the monthly basic salary (floor ₱10,000, ceiling ₱100,000), shared equally |
| Pag-IBIG | 2% each, of up to ₱10,000 |
| Withholding tax | TRAIN tables on pay less the GSIS, PhilHealth and Pag-IBIG shares. Minimum wage earners are exempt |
| Overtime | Approved overtime earns compensatory time-off (COC), not pay, unless Payroll setup pays it (125% / 150%, at most 50% of the monthly salary) |
| Loans and deductions | Taken in order: GSIS, then Pag-IBIG, then the rest. One that would bring net pay below ₱5,000 a month (₱2,500 a half-month) is held back that time |
| Job order, contract of service | Paid the daily rate for days worked. No GSIS, PERA, PhilHealth, Pag-IBIG or bonuses. 5% withholding tax and 3% percentage tax |
| Mid-year bonus | One month's salary as of 15 May, for at least four months of service from 1 July of last year, still in service on 15 May |
| Year-end bonus and cash gift | One month's salary as of 31 October and a ₱5,000 cash gift, for four months of service from 1 January, in service on 31 October. Less than four months: a prorated cash gift only |
| PEI, clothing | ₱5,000 PEI (prorated for less than four months of service); ₱7,000 clothing allowance after six months of service (tax-exempt up to ₱8,000) |
| Tax on bonuses | Bonuses and benefits are tax-free up to ₱90,000 a year in all; tax is withheld only on the excess |

**Why did someone get nothing for a day they worked?**
Their attendance record for that day is open (no clock-out), or missing. Ask HR to fix it in **Attendance (DTR)**, then **Recompute** the draft.

**A loan was not taken this time. Why?**
Taking it would have brought net pay below ₱5,000 a month (GAA general provisions). The register shows *held back* and the payslip lists it under *Not deducted this time*. It is tried again in the next run; nothing is carried over automatically.

**Why does Late/UT show VL 0.038?**
That much tardiness and undertime (0.038 of a day, about 18 minutes) is charged to vacation leave instead of pay. The credits are taken off when the run is finalized.

**Can I change an employee's salary grade?**
No; HR edits employee records. Ask HR, then recompute your draft.

**Why does someone's salary change in January?**
Each run uses the salary schedule in force at the end of its period. The EO 64 schedule has a new tranche on 1 January.

**Can I change a finalized run?**
No. Payslips of a finalized run never change. Delete the run (when it has no live documents in Finance) and run the period again, or correct it in the next run with **Adjust**.

**Why can't I open the documents in Finance?**
The links on the **Finance** tab open the documents in ATLAS Finance for its officers (budget, accounting, cashier). You see their status on the tab.

**Who can see the payroll?**
Payroll officers, HR managers (view only) and administrators. Each employee sees only their own finalized payslips.
