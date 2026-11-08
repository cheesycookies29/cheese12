---
id: accountant
title: The Chief Accountant in ATLAS Finance
summary: Keep the books: certify vouchers (Box C), post and reverse journal entries, read the ledgers, trial balance and statements, reconcile the bank, liquidate cash advances and close the books.
roles: accountant
apps: finance
order: 60
---

## Before you start

This guide is for the Chief Accountant and the accounting staff who keep the school's books in **ATLAS Finance**. Finance follows the COA Government Accounting Manual (GAM) and the Revised Chart of Accounts, with one set of books per fund cluster (01 Regular Agency Fund, 05 Internally Generated Funds, 07 Trust Receipts, and any others switched on).

- **Signing in.** Sign in on the ATLAS home page with the Finance account an administrator made for you, then open **Finance**. Only an administrator creates or changes Finance accounts.
- **What you do here.** You are the only office that posts journal entries, certifies vouchers (Box C), liquidates cash advances, voids check payments, reconciles the bank and closes periods. You also keep the Control panel.
- **What the other offices do.** The budget office obligates (Box B of the ORS/BURS), the cashier prepares and pays vouchers and collects, the supply office buys and keeps stock and property, and the approving officer signs Box D. Each office has its own guide: [Budget Officer](budget-officer), [Cashier](cashier), [Supply Officer](supply-officer), [Approving Officer](approver).
- **How the books are kept.** Every module (vouchers, receipts, deliveries, depreciation…) posts its own journal entry voucher (JEV). Balances, ledgers and reports are all computed from posted entries. A posted entry is never edited; it is reversed.

> **Tip:** The **?** button at the top of every page opens these guides.

## Walkthrough

Try this with the demo school: sign in as `accountant.demo` (password `demo1234`).

1. Open **Finance**. The **Dashboard** shows cash by fund, how much of the allotments is obligated and paid, and collections against the target. The **Waiting for you** box lists what needs the accounting office: in the demo, *1 voucher to certify (Box C)*, *1 draft journal entry* and *1 cash advance past due for liquidation*.

![The accountant's dashboard with the Waiting for you list](accountant-dashboard.jpg)

2. Click **1 voucher to certify (Box C)**. The list opens on the **For certification (Box C)** tab. Click the janitorial voucher for Kalinisan Multi-Purpose Cooperative.
3. Read the voucher. The boxes across the top show where it is (A requesting office, B accounting entry, C accountant, D approving officer, Paid, E received). Check the **Amount** (gross, taxes withheld, net) and the **Box B · Accounting entry**.

![A voucher waiting for Box C](accountant-dv-certify.jpg)

4. Click **Certify (Box C)**, tick *Cash available; subject to Authority to Debit Account (when applicable); supporting documents complete and amount claimed proper*, and click **Certify**. The voucher now has its DV number and goes to the approving officer for Box D.
5. Go back to the **Dashboard** and click **1 draft journal entry**. Open the draft (an accrual of the month's water bill). Check that debits equal credits, then click **Post**. It gets its JEV number.

![A draft journal entry ready to post](accountant-journal-draft.jpg)

6. Open **Trial balance**. Pick a fund cluster (or all), the date and *Including closing entries* or *Before closing entries*, and click **Show**. Click any account code to open its ledger. Click **Financial statements** for the Statement of Financial Position and the Statement of Financial Performance of the same fund.

![The trial balance for fund 01](accountant-trial-balance.jpg)

7. Open **Bank reconciliation**. Pick the cash account, the fund and the month. Type the **Balance per bank statement**, tick the entries that appear on the statement, and watch the summary: when the difference is 0.00 it says *Reconciled*.

![A bank reconciliation](accountant-bank-recon.jpg)
8. Open **Control panel → Periods & closing** to see how the books are closed. (In the demo you can close a past month and then click **Reopen all**.)

![Closing the books in the Control panel](accountant-control-periods.jpg)

## How to…

### Certify a voucher (Box C)

1. Open **Disbursement vouchers**. Your list opens on **For certification (Box C)**.
2. Open the voucher. Check the payee, the obligation (ORS/BURS) it charges, the taxes and the Box B entry. Click the payee's name to see their card, or the ORS/BURS number to see what is left on the obligation.
3. Click **Certify (Box C)**, tick the statement and click **Certify**.

The voucher is numbered and moves to **For approval (Box D)**. ATLAS checks again that the obligation still has the balance and that the cash is available (the cash account's balance less vouchers already approved). If not, it says *Not enough cash…* and nothing changes. If the voucher is wrong, click **Cancel voucher…** and give the reason; its charges go back to the obligation.

### Post a journal entry

Modules post their own entries. Enter by hand only adjusting, correcting and other entries no module makes.

1. Open **Journal entries** and click **New entry**.
2. Pick the date, the fund cluster and the journal (General Journal, Cash Receipts Journal, Cash Disbursements Journal or Check Disbursements Journal), and write the particulars.
3. Fill in the lines: account, the card (for a subsidiary ledger) and office if needed, and the debit or the credit. The total line tells you if the entry is out of balance.
4. Click **Save draft** to finish later, or **Save and post**.

The entry gets its JEV number when posted. **Save and post** stays disabled until debits equal credits.

### Reverse a posted entry

1. Open the entry from **Journal entries** and click **Reverse**.
2. Give the date and the reason, and click **Reverse**.

An opposite entry is posted and both stay on the books. Only entries made here (and opening or closing entries) can be reversed. An entry made by a module is undone in its module: cancel the voucher, void the payment, or cancel the receipt or report.

### Read a ledger

1. Open **Ledgers**, pick the account, the fund (or all funds) and the dates, and click **Show**.
2. The ledger starts with the balance forward and ends with the totals and ending balance. Click a JEV number to open the entry. **CSV** downloads it; **Print** prints it.

For one payee's accounts payable, advances or receivables, open their card in **Card file** and use the **Subsidiary ledgers** tab. The **Taxes withheld** tab has a **BIR 2307** button for each quarter.

### Prepare the financial statements

1. Open **Financial statements**, pick the fund cluster (or all), the start date and the **As of** date, and click **Show**.
2. Check that the Statement of Financial Position balances. If it does not, a red notice says so: check the trial balance.
3. Click **Print**. The printout carries the accountant's and the head's signature lines from the Control panel.

Until a year is closed, the year's result shows as *Surplus/(deficit) not yet closed*.

### Reconcile a bank account

1. Open **Bank reconciliation**. Pick the cash account, the fund and the month, and click **Show**.
2. Type the **Balance per bank statement**.
3. Tick each book entry that appears on the bank statement. What you leave unticked is counted as deposits in transit or outstanding checks.
4. If there is still a difference (bank charges, errors, unrecorded items), book it with a journal entry, then come back.
5. Click **Save reconciliation**.

### Liquidate a cash advance

The cashier grants the advance on a voucher; you post its liquidation (Liquidation Report, Appendix 44).

1. If the officer is refunding unused money, ask the cashier to issue the official receipt first, crediting the advance account on the officer's card.
2. Open **Cash advances** and click **Liquidate** on the advance.
3. Enter the expenses (account, particulars, amount). Only the object codes on the advance's obligation are offered.
4. Under **Refund of the unused balance: official receipt**, pick the refund O.R. if there is one.
5. Click **Post liquidation**.

The advance shows *Settled* once nothing is outstanding. Advances past their **Liquidate by** date are marked *Overdue*, and the officer cannot get a new advance until it is settled.

### Void a check payment

1. Open the paid voucher and click **Void payment**.
2. Pick the reason (spoiled, stale, cancelled or lost) and the date, and click **Void payment**.

The payment entry is reversed and the voucher goes back to *to pay*. Payments on an LDDAP-ADA are corrected with the bank, not here.

### Close a month and the year

1. When the month's reports are done, post or delete every draft entry dated in it.
2. Open **Control panel → Periods & closing**, pick the month and click **Close through this month**. Nothing can be posted in it or before it.
3. To correct something, click **Reopen all**, fix it, and close again.
4. After December, under **Year-end closing**, pick the year and the fund cluster and click **Post closing entry**. It closes revenue and expenses to Accumulated Surplus/(Deficit), dated December 31. Do it once for each fund.

### Keep the chart of accounts and the settings

1. **Chart of accounts**: **Add account** adds an 8-digit code under an existing major group (only accounts COA has authorized). **Switch off** hides an account from new entries; accounts the modules post to stay on.
2. **Control panel** tabs: **Entity** (name, UACS code, TIN, fiscal year), **Funds & offices** (fund clusters, responsibility centers, PAPs), **Banks & fees** (bank accounts and the fee list), **Signatories** (names on every form, and document numbering), **Taxes & rules** (withholding rates, thresholds, deadlines), **Periods & closing**, and **Users** (who has which Finance role).

### Handle payroll from ATLAS People

When the payroll office sends a finalized government payroll to Finance, its voucher arrives already submitted, in **For certification (Box C)**: gross is the obligation, the deductions go to Due to BIR, GSIS, Pag-IBIG, PhilHealth and Other Payables, and the net is the General Payroll's take-home pay. Certify it like any voucher. After it is paid, the remittance vouchers to GSIS, PhilHealth, Pag-IBIG and BIR come the same way, without an obligation request.

## Screens at a glance

| Screen | What it is for |
|---|---|
| Dashboard | Cash by fund, budget utilization, collections, and **Waiting for you**: vouchers to certify, draft entries, overdue advances |
| Find a document | Type any document number (DV, JEV, ORS/BURS, PR, PO, IAR, RIS, O.R., RCD, LDDAP-ADA, property, PAR/ICS), a check number or a name |
| Card file | Suppliers, employees, accountable officers, agencies and individuals; each card's subsidiary ledgers, documents, taxes withheld and property |
| Journal entries | Every JEV by journal; new entries, posting, reversing |
| Ledgers | The general ledger of one account, per fund and period |
| Trial balance | Per fund or all funds, before or after closing entries |
| Financial statements | Statements of Financial Position and Financial Performance |
| Bank reconciliation | Book balance against the bank statement (Appendices 80/81) |
| Chart of accounts | The Revised Chart of Accounts with balances; add or switch off accounts |
| Budget & allotments | Appropriations, allotments and NCAs (the budget office records them) |
| Obligations | ORS/BURS and their status of obligation |
| Budget reports | SAAODB (FAR 1), RAOD, aging (FAR 3), SCBAA |
| Purchase requests | Requests from the offices |
| Purchase orders | Orders to suppliers and their deliveries (IAR) |
| Requisitions | Supplies requested from stock (RIS) |
| Stock | Stock cards with FIFO cost |
| Inventory reports | RSMI and the physical count of inventories (RPCI) |
| Property | PPE and semi-expendable property, each with its property card |
| Depreciation | Monthly depreciation, booked by the supply office |
| Property reports | RPCPPE and the count of semi-expendable property |
| Disbursement vouchers | Vouchers through Boxes A to E; certify here |
| LDDAP-ADA | Lists of approved ADA payments |
| Cash advances | Outstanding advances; liquidate here |
| Taxes withheld | Monthly summary and remittances, quarterly alphalist and BIR 2307 |
| Official receipts | Receipts issued by the collectors |
| Collections & deposits | Reports of Collections and Deposits (RCD) and deposits |
| Accountable forms | O.R. booklets issued to collectors (RAAF) |
| Revenue monitoring | The school's own income by month against targets |
| Control panel | Entity, funds and offices, banks and fees, signatories and numbering, taxes and rules, periods and closing, users |
| Audit trail | Who did what in Finance, newest first |
| My accountabilities | Property in your own custody and your own cash advances |

## Questions

**Why can't I change a posted entry?** The GAM keeps posted entries as they are. Reverse it (if you made it) or undo it in its module, then post the correct one.

**ATLAS says "The books are closed through…".** The date falls in a closed month. Date it after, or reopen in **Control panel → Periods & closing** and close again after.

**Why can't I close the month?** There are draft entries dated in it, or it is not over yet. Post or delete the drafts first.

**Why does the voucher have no number?** Vouchers are numbered when you certify Box C; obligation requests when the budget office obligates them.

**Can I approve a voucher I certified?** No. Box D must be signed by someone other than the person who prepared or certified the voucher.

**Can I add a Finance user or change someone's role?** No. Only an administrator does, so no officer can give themselves another office's powers. The **Users** tab shows who has which role.

**Year-end closing says the year is not over.** Closing is allowed from January of the next year, once per fund.

