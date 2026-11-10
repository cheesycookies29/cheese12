---
id: cashier
title: The Cashier in ATLAS Finance
summary: Prepare and pay disbursement vouchers by check or LDDAP-ADA, grant cash advances, remit taxes withheld, issue official receipts, and report and deposit collections.
roles: cashier
apps: finance
order: 62
---

## Before you start

This guide is for the Cashier: the school's disbursing and collecting officer in **ATLAS Finance**. You do two jobs.

- **Disbursing.** You prepare disbursement vouchers (DV) against obligations, pay them once approved (MDS or agency check, or LDDAP-ADA), grant cash advances, record Box E, and remit the taxes withheld to BIR.
- **Collecting.** You issue official receipts (O.R.) from your booklet, report them on the Report of Collections and Deposits (RCD) and record the deposit.

**Signing in.** Sign in on the ATLAS home page with your Finance account and open **Finance**. Only an administrator creates or changes Finance accounts.

**How a voucher moves.** You prepare it (Box A is the requesting office), the Chief Accountant certifies Box C, the approving officer signs Box D, and you pay it. Box B (the accounting entry) is posted when it is paid. The other offices' guides: [Chief Accountant](accountant), [Budget Officer](budget-officer), [Supply Officer](supply-officer), [Approving Officer](approver).

> **Tip:** The **?** button at the top of every page opens these guides.

## Walkthrough

Try this with the demo school: sign in as `cashier.demo` (password `demo1234`).

1. Open **Finance**. The **Waiting for you** box on the **Dashboard** lists *1 official receipt not yet reported*, *1 collection report not deposited* and *1 cash advance past due for liquidation*. Approved vouchers show here as *vouchers to pay*.

![The cashier's dashboard](cashier-dashboard.jpg)

2. Open **Official receipts** and choose **Issue O.R.**. Leave the fund at *05 · Internally Generated Funds*. In **Student (search name or number)**, type `Carlo` and pick Carlo Reyes. Under **Nature of collection**, pick a fee that has a set amount, such as *Certification fee* (the amount fills in), and choose **Issue O.R.**. The receipt takes the next number in your booklet and opens ready to print.

![Issuing an official receipt](cashier-issue-or.jpg)

3. Open **Collections & deposits** and choose **Prepare RCD**. The button counts your receipts not yet reported. Pick fund 05, keep today's date under **Through** and choose **Prepare and post**. The collections are posted to the Cash Receipts Journal.
4. On the report, choose **Record deposit**. Pick the bank account, enter the date and the validated deposit slip number, and choose **Record deposit**. The report now shows *Deposited*. Do the same for the older report still marked *Undeposited*.

![A Report of Collections and Deposits waiting for its deposit](cashier-rcd.jpg)

5. Open **Disbursement vouchers** and look at the tabs: **Open**, **Drafts**, **For certification (Box C)**, **For approval (Box D)**, **To pay**, **Paid**, **Cancelled**, **All**. In the demo, the Agri-Pinoy Farm Supply voucher is waiting for Box D. To pay it, sign in as `head.demo` and approve it first (see [the approving officer's guide](approver)), then come back: it is under **To pay**. Open it, choose **Pay**, enter a check number and choose **Record payment**.

![All disbursement vouchers](cashier-dv-list.jpg)

6. Open **Taxes withheld** to see last month's summary by fund and ATC and what is still to remit.

## How to…

### Prepare a voucher for an obligation

1. Open the obligated ORS/BURS (**Obligations → Unpaid**) and choose **Prepare voucher**. For a purchase order, open the PO instead and choose **Voucher** on the delivery (IAR) being paid; or, on the ORS, choose **Pay through PO …'s deliveries**.
2. The form fills in the fund, payee, obligation, gross amount and particulars. Check them.
3. Pick the **Nature of payment** (Goods, Services, Contractor, Rent / lease, Professional fees…). It decides the taxes withheld, with the payee's tax status on their card.
4. Pick the **Mode of payment**: *MDS check*, *LDDAP-ADA (online)*, *Check from the agency bank account* or *Cash (petty cash / disbursing officer)*.
5. Fill in **Box A: certified by** and **Position** (the head of the requesting office).
6. Choose **Preview taxes and entry** and check the net amount and the Box B entry.
7. Choose **Submit to accounting** (or **Save draft**).

The voucher goes to the Chief Accountant's **For certification (Box C)** list. A late delivery's liquidated damages are already under **Other deductions**.

### Pay a voucher

1. Open **Disbursement vouchers → To pay** and open the voucher.
2. For a check: choose **Pay**, enter the check number and date, and choose **Record payment**. The entry is posted to the Check Disbursements Journal.
3. For LDDAP-ADA: choose **Put on an LDDAP-ADA** (see below).
4. When the payee receives it, choose **Box E: receipt**, fill in who received it, the date and the payee's O.R. or invoice number, and choose **Save**.

### Pay by LDDAP-ADA

1. Open **LDDAP-ADA** and choose **New LDDAP-ADA (… ready)**.
2. Pick the fund cluster: one list per fund. Pick the MDS-GSB branch or account debited and the date.
3. Untick any voucher to leave out, and choose **Issue**.
4. Choose **Print** on the new list to send it to the bank.

Each payee needs a bank account on their card (the dialog shows *None* in red if missing). Each voucher's entry is posted to the Cash Disbursements Journal.

### Pay a payroll from ATLAS People

Payroll vouchers come from the payroll office, already submitted, with mode LDDAP-ADA. Once certified and approved, they appear in **To pay** and in **LDDAP-ADA**; issue the list as above. After the payroll voucher is paid, the remittance vouchers to GSIS, PhilHealth, Pag-IBIG and BIR follow the same path.

### Pay without an obligation

Only a payment that settles a liability needs no ORS/BURS: amounts due to BIR, GSIS and others, payables, trust liabilities.

1. Choose **New voucher**, choose *None (non-budgetary: remittances, trust, prior-year payables)* under **Obligation (ORS/BURS)**.
2. Open **Debits (only for payments without an obligation)** and enter the liability account and amount.
3. Submit it to accounting as usual.

### Grant a cash advance

1. The advance needs an obligation first. Then choose **New voucher** (or **New advance (DV)** on **Cash advances**).
2. Choose **Kind**: *Cash advance*, the obligation, the employee or accountable officer as payee, and **Advance for** (operating expenses, local or foreign travel, payroll, special disbursing officer).
3. Leave **Liquidate by** blank to use the rule's days, or set a date.
4. Submit it to accounting.

ATLAS refuses a new advance while the person has one unsettled, and an advance for a special disbursing officer or payroll needs a fidelity bond on the officer's card that covers the amount and has not expired. When the officer refunds the unused balance, issue an O.R. crediting the advance account with the officer's card; the Chief Accountant then posts the liquidation.

![Outstanding cash advances, one overdue](cashier-advances.jpg)

### Remit the taxes withheld

1. Open **Taxes withheld**. The **Monthly summary and remittance** tab shows last month by fund and ATC, and what is still to remit and when it is due (the 10th of the next month).
2. Choose **Record remittance**, pick the fund, enter the TRA number (fund 01) or the payment reference (other funds, eFPS), and the date.
3. Choose **Record remittance**.

For the 1601-EQ, use the **Quarterly alphalist and 2307** tab; the **2307** button prints each payee's BIR Form 2307.

![Taxes withheld and remittances](cashier-taxes.jpg)

### Issue and cancel official receipts

1. **Official receipts → Issue O.R.**: pick the fund, date and mode (Cash, Check, Online / bank transfer). The payor is a student, a card, or a name typed under **Payor name (as printed)**.
2. Add a line per fee, and type the amount if the fee has no set amount. For something not on the fee list, pick *Other (pick the account)* and choose the account.
3. Choose **Issue O.R.** and print it.

To cancel a receipt you issued that is not yet on an RCD, choose **Cancel** on its row and give the reason. Write "Cancelled" on all copies and keep them in the booklet.

### Report and deposit collections

1. **Collections & deposits → Prepare RCD**, pick the fund and the **Through** date, and choose **Prepare and post**.
2. Deposit the collections intact, then open the report and choose **Record deposit** with the validated deposit slip number.

A report not deposited by the deadline in the Control panel is marked *Undeposited – late*.

### Keep accountable forms

1. Open **Accountable forms** and choose **Issue a booklet**.
2. Enter the form (51), fund, serial numbers from and to (at most 1,000), the collecting officer and the date, and choose **Issue**.

The list is the Report of Accountability for Accountable Forms (RAAF): used, cancelled and remaining receipts per booklet.

## Screens at a glance

| Screen | What it is for |
|---|---|
| Dashboard | **Waiting for you**: vouchers to pay, receipts not reported, reports not deposited, overdue advances |
| Find a document | Type a DV, O.R., RCD, LDDAP-ADA or check number, or a payee's name |
| Card file | Payees with their TIN, tax status, bank account and fidelity bond; add or edit cards |
| Journal entries | The books (view) |
| Ledgers | One account's ledger (view) |
| Trial balance | Per fund (view) |
| Financial statements | The statements (view) |
| Bank reconciliation | The accountant's reconciliations (view) |
| Chart of accounts | Account codes |
| Budget & allotments | Allotments and NCAs (view) |
| Obligations | ORS/BURS; **Prepare voucher** on an obligated one |
| Budget reports | Budget office reports (view) |
| Purchase requests | Requests from the offices |
| Purchase orders | Orders and deliveries; **Voucher** on an accepted delivery |
| Requisitions | Supplies requested from stock |
| Stock | Supplies on hand |
| Inventory reports | RSMI and physical count |
| Property | The school's property |
| Depreciation | Monthly depreciation |
| Property reports | Physical count reports of property |
| Disbursement vouchers | Prepare, submit, pay, Box E, cancel |
| LDDAP-ADA | Lists of approved ADA vouchers for the bank |
| Cash advances | Outstanding and settled advances; new advance |
| Taxes withheld | Monthly summary, remittances, quarterly alphalist, BIR 2307 |
| Official receipts | Issue, print and cancel receipts |
| Collections & deposits | Prepare RCDs and record deposits |
| Accountable forms | O.R. booklets and the RAAF |
| Revenue monitoring | Collections by month against targets; set targets |
| Audit trail | Who did what in Finance (under *Control panel* in the sidebar) |
| My accountabilities | Property in your custody and your own cash advances |

## Questions

**Why is the voucher not numbered?** It is numbered when the Chief Accountant certifies Box C.

**Why can't I pay an approved ADA voucher with "Pay"?** ADA vouchers are paid on an LDDAP-ADA list.

**ATLAS says the payee has an unsettled cash advance.** No new advance until the earlier one is liquidated (COA Circular 97-002).

**A check was spoiled or went stale.** Ask the Chief Accountant to void the payment; the voucher goes back to **To pay** and you can pay it with a new check.

**Why can't I cancel an O.R.?** Only the collector who issued it can, and only before it is on an RCD.

**How soon must collections be deposited?** Intact, by the deadline set in the Control panel (the next banking day by default).

**Fund 01 or another fund for taxes?** Fund 01 taxes are remitted through a Tax Remittance Advice (TRA); other funds pay from their bank account.
