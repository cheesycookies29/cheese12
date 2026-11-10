---
id: budget-officer
title: The Budget Officer in ATLAS Finance
summary: Record appropriations, allotments and NCAs, obligate requests (ORS/BURS Box B), adjust obligations and prepare the budget reports (SAAODB, RAOD, aging, SCBAA).
roles: budget
apps: finance
order: 61
---

## Before you start

This guide is for the Budget Officer and the budget office staff. In **ATLAS Finance** you keep the school's authority to spend, following DBM budget execution and the COA-DBM rules on the ORS/BURS:

- **Appropriations** (the GAA lines and the board-approved IGF/STF budgets) are released as **allotments** (GARO/ABM, SARO, sub-allotments, board approvals).
- Every expense, capital outlay and cash advance is charged to an allotment on an **obligation request**: the **ORS** for fund 01 (Regular Agency Fund), the **BURS** for the other funds. You certify **Box B**: the allotment is available and obligated.
- **NCAs** (Notices of Cash Allocation) for fund 01 are the cash the voucher's Box C checks.

**Signing in.** Sign in on the ATLAS home page with your Finance account and open **Finance**. Only an administrator creates or changes Finance accounts.

**Before you can record a budget,** the programs, activities and projects (PAPs) must be in the Control panel. The Chief Accountant keeps it; ask them to add a PAP if it is missing.

> **Tip:** The **?** button at the top of every page opens these guides. The other offices have theirs: [Chief Accountant](accountant), [Cashier](cashier), [Supply Officer](supply-officer), [Approving Officer](approver).

## Walkthrough

Try this with the demo school: sign in as `budget.demo` (password `demo1234`).

1. Open **Finance**. On the **Dashboard**, the **Waiting for you** box shows *1 obligation request to certify (Box B)*. The cards above show how much of the year's allotments is obligated and how much of the obligations is paid.

![The budget officer's dashboard](budget-officer-dashboard.jpg)

2. Click it. **Obligations** opens on the **For obligation** tab. Open the Library's ORS (subscription to online journals and databases).
3. Read it. **Box A: requested by** is the Chief Librarian. The **Status of obligation** table shows each line's PAP, UACS object code, the allotment it is charged to and the amount requested.

![An ORS waiting for Box B](budget-officer-ors.jpg)

4. Click **Certify and obligate (Box B)**, check the date and click **Obligate**. The ORS gets its number and the amount is now obligated: the cashier can prepare its voucher.
5. Open **Budget & allotments**. On the **Allotments** tab, the MOOE allotment the ORS was charged to shows the new amount under **Obligated** and the lower **Balance**. Look at the **Appropriations** and **Cash allocations (NCA)** tabs too.

![Allotments with what is obligated and what is left](budget-officer-allotments.jpg)

6. Open **Budget reports**. The **SAAODB (FAR 1)** tab shows appropriations, allotments, obligations by quarter, disbursements and the balances by PAP and class. Try **RAOD** (pick a fund and a class), **Aging (FAR 3)** and **SCBAA**. Each has **CSV** and **Print**.

![The SAAODB (FAR No. 1)](budget-officer-saaodb.jpg)

## How to…

### Record an appropriation

1. Open **Budget & allotments** and click **Appropriation**.
2. Fill in the fiscal year, fund cluster, program / activity / project, allotment class (PS, MOOE, FE or CO), kind (GAA – New appropriations, GAA – Continuing appropriations, Automatic appropriations (RLIP), Supplemental / special purpose, Board-approved budget (IGF/STF) or Trust receipts budget), the reference (GAA item or board resolution), date and amount.
3. Click **Record**.

It appears on the **Appropriations** tab, with what is allotted and what is still unreleased.

### Record an allotment

1. Click **Allotment** on **Budget & allotments**.
2. Fill in the same fields, with the kind (GARO / ABM (comprehensive release), SARO, Sub-allotment received, Board approval (IGF/STF) or Allotment for trust receipts) and the SARO/GARO number as the reference.
3. Under **Against appropriation (optional)**, pick the appropriation it releases. Leave *None* for a sub-allotment received from another office.
4. Click **Record**.

An allotment cannot be more than what is unreleased on its appropriation, and must match its fund, year, PAP and class. You can **Remove** an allotment only while nothing is obligated on it.

### Record an NCA

1. Click **NCA** on **Budget & allotments** (shown when fund 01 is in use).
2. Enter the NCA number, date received, amount, valid until date and particulars, and click **Record**.

ATLAS posts the entry (Dr Cash – MDS, Regular / Cr Subsidy from National Government). The **Cash allocations (NCA)** tab shows the NCAs received this year and the MDS balance.

### Obligate a request (Box B)

1. Open **Obligations**. Your list opens on **For obligation**: requests the offices have submitted.
2. Open the request. Check the payee, the particulars, Box A, and each charge in the **Status of obligation** table: the PAP, the UACS object code, the allotment and the amount requested. To see the allotment's balance, open **Budget & allotments** in another tab.
3. Click **Certify and obligate (Box B)**, set the date and click **Obligate**.

The request is numbered (ORS for fund 01, BURS for the others) and shows *Obligated*. If an allotment does not have enough left, ATLAS says *Not enough allotment…* with the balance, and nothing is obligated. The request can also be refused if the allotment is dated after it or is for another fund or year.

If something on a submitted request is wrong, click **Edit** and correct it, or click **Cancel request…** and give the reason. A request made from a purchase order cannot be edited here: the supply office cancels and redoes the PO's request.

### Prepare an obligation request yourself

1. Open **Obligations** and click **New request**.
2. Pick the fund cluster (the form name, ORS or BURS, shows under it), date, responsibility center and payee. A payee not in the card file must be added there first (**Card file → New card**).
3. Write the particulars and Box A (the head of the requesting office and their position).
4. Under **Charges**, add a line for each object code: the allotment (fund, class and balance are shown), the object code and the amount.
5. Click **Save draft**, or **Submit for obligation** to put it in the **For obligation** list.

### Adjust or cancel an obligation

1. Open the obligated ORS/BURS and click **Adjust**.
2. Pick the line, enter the amount (negative to reduce) and the reason, and click **Adjust**.

The adjustment is listed under **Adjustments** on the request and counted in the quarter it was made. An obligation can never be reduced below what is already paid. To cancel an obligated request, click **Cancel request…**; this is only possible while no voucher is charged to it.

### Obligate payroll from ATLAS People

When the payroll office sends a finalized government payroll run to Finance, its ORS/BURS arrives in **For obligation**, already submitted. Its particulars start with *Payroll:*, Box A is the Payroll Officer, and there is one line per object code (salaries, PERA, RATA, bonuses and the government shares), charged to the PS allotment (job orders to MOOE).

1. Open it from **For obligation** and check the PS allotment has enough left.
2. Click **Certify and obligate (Box B)** and **Obligate**.

The payroll office can then prepare the payroll voucher from its run. See [the payroll guide](payroll) for their side.

### Prepare the budget reports

1. Open **Budget reports** and pick the tab (see the list below).
2. Set the year (or the **As of** date) and the fund, and click **Show**.
3. Click **Print** for the signed copy, or **CSV** for a spreadsheet.

The tabs:

- **SAAODB (FAR 1)**: by PAP and class; obligations by quarter, disbursements, unreleased appropriations, unobligated allotments, unpaid obligations. Earlier years' obligations adjusted or paid this year have their own section.
- **RAOD**: one fund and one allotment class at a time, in date order, with running unobligated and unpaid balances and a recap by object code. Click a reference to open the ORS or DV.
- **Aging (FAR 3)**: unpaid obligations as of a date, in 0–30 days, 31–90 days, 91–365 days and Over 1 year.
- **SCBAA**: original budget, adjustments, final budget and actual obligations.

![Aging of due and demandable obligations](budget-officer-aging.jpg)

### Set revenue targets

1. Open **Revenue monitoring** and click **Targets**.
2. Pick the fund cluster and enter the year's target for each revenue account.
3. Click **Save targets**.

The page then compares each month's collections with the targets (the basis of FAR No. 5).

## Screens at a glance

| Screen | What it is for |
|---|---|
| Dashboard | Budget utilization by class, cash by fund, and **Waiting for you**: requests to obligate |
| Find a document | Type any document number (ORS/BURS, DV, PO…), a check number or a name |
| Card file | Payees and suppliers; add a card before preparing a request for a new payee |
| Journal entries | The books, as the accountant posts them (view) |
| Ledgers | One account's ledger (view) |
| Trial balance | Per fund (view) |
| Financial statements | Statements of Financial Position and Financial Performance (view) |
| Bank reconciliation | The accountant's reconciliations (view) |
| Chart of accounts | Account and object codes |
| Budget & allotments | Record appropriations, allotments and NCAs; see balances |
| Obligations | ORS/BURS: obligate (Box B), adjust, cancel, prepare |
| Budget reports | SAAODB (FAR 1), RAOD, Aging (FAR 3), SCBAA |
| Purchase requests | Requests from the offices |
| Purchase orders | Orders and the obligation requests they send you |
| Requisitions | Supplies requested from stock |
| Stock | Supplies on hand |
| Inventory reports | RSMI and the physical count |
| Property | The school's PPE and semi-expendable property |
| Depreciation | Monthly depreciation |
| Property reports | Physical count reports of property |
| Disbursement vouchers | Payments charged to your obligations |
| LDDAP-ADA | Lists of ADA payments |
| Cash advances | Outstanding advances |
| Taxes withheld | Taxes withheld and remitted |
| Official receipts | Collections on official receipts |
| Collections & deposits | Reports of collections and deposits |
| Accountable forms | O.R. booklets |
| Revenue monitoring | Collections against targets; set the targets |
| Audit trail | Who did what in Finance (under *Control panel* in the sidebar) |
| My accountabilities | Property in your custody and your own cash advances |

## Questions

**Why is the request not numbered yet?** ORS and BURS numbers are given when Box B is certified, so the numbers run without gaps.

**ORS or BURS?** ATLAS picks it from the fund: ORS for fund 01, BURS for internally generated, trust and other funds (COA-DBM Joint Circular 2013-1).

**Can an obligation be more than the allotment?** No. Box B is refused beyond the allotment's balance, counting everything already obligated on it.

**Can I charge a supply to a PS allotment?** No. Each line's object code must belong to the allotment's class (PS, MOOE, FE or CO). Capital outlays use the 506 UACS object codes.

**In which quarter does an adjustment count?** In the quarter it was made, not the quarter of the original obligation. Earlier years' obligations adjusted or paid this year are shown in their own section of the SAAODB and RAOD.

**Why can't I record a budget?** The PAP is missing. The Chief Accountant adds it under **Control panel → Funds & offices**.

**Where do I look up a document from a paper form?** **Find a document**: type the number, or part of the payee's name.
