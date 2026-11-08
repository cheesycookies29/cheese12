---
id: supply-officer
title: The Supply and Property Officer in ATLAS Finance
summary: Turn purchase requests into purchase orders, inspect and accept deliveries (IAR), keep stock and issue requisitions (RIS), book the RSMI and the physical count, and keep the school's property, PAR/ICS and depreciation.
roles: supply
apps: finance
order: 63
---

## Before you start

This guide is for the Supply & Property Officer and the supply office staff. In **ATLAS Finance** you handle procurement (under the New Government Procurement Act, RA 12009), inventory and property, following the COA forms of the Government Accounting Manual:

- **Purchase requests** (PR, Appendix 60) from the offices, approved by the head of agency.
- **Purchase orders** (PO, Appendix 61), each with its obligation request (ORS/BURS) and **deliveries** on an Inspection and Acceptance Report (IAR, Appendix 62).
- **Stock** on stock cards with FIFO cost, issued on **requisitions** (RIS, Appendix 63) and booked monthly on the **RSMI** (Appendix 64); the **physical count** (RPCI, Appendix 66).
- **Property**: PPE (unit cost of ₱50,000 or more) on a Property Acknowledgment Receipt (PAR), semi-expendable property on an Inventory Custodian Slip (ICS); transfers, returns, disposal (IIRUP) and monthly depreciation.

**Signing in.** Sign in on the ATLAS home page with your Finance account and open **Finance**. Only an administrator creates Finance accounts.

**Who does what.** The approving officer approves PRs and POs, the budget office obligates the PO's request (Box B), and the cashier pays the supplier once you have accepted the delivery. The other guides: [Chief Accountant](accountant), [Budget Officer](budget-officer), [Cashier](cashier), [Approving Officer](approver).

> **Tip:** The **?** button at the top of every page opens these guides.

## Walkthrough

Try this with the demo school: sign in as `supply.demo` (password `demo1234`).

1. Open **Finance**. On the **Dashboard**, **Waiting for you** lists *1 requisition to issue* and the *stock items at or below the reorder point*.

![The supply officer's dashboard](supply-officer-dashboard.jpg)

2. Click **1 requisition to issue**. **Requisitions** opens on **To issue**. Open the Registrar's requisition for enrollment period forms. The **In stock** column shows what is on hand.

![A requisition waiting to be issued](supply-officer-ris.jpg)

3. Click **Issue**. The quantities to issue are filled in (at most what was requested and what is in stock). Check **Received by** and click **Issue**. The stock cards go down, at FIFO cost.
4. Open **Purchase orders** and open the agricultural supplies PO. It is *Partly delivered* and *Late*: 40 of 60 bags of fertilizer came. The **Deliveries (IAR)** section lists the IAR already accepted.

![A purchase order with a partial delivery](supply-officer-po.jpg)

5. Click **Inspect and accept delivery**. You would enter the supplier's invoice number and the quantity delivered now; because the PO is late, ATLAS computes liquidated damages. (Close the dialog without saving if you are only looking.)
6. Open **Stock**. Tick **Low stock only** and click **Find** to see what needs a purchase request. Click an item for its stock card.

![Stock items with what is on hand](supply-officer-stock.jpg)
7. Open **Property** and open an item. Its property card shows how it was received and to whom it was issued, with the depreciation schedule.

![A property item with its PAR and property card](supply-officer-property.jpg)

8. Open **Inventory reports** to see this month's RSMI.

## How to…

### Turn a purchase request into a purchase order

1. Open **Purchase requests → Approved** and open the PR.
2. Click **Prepare PO**. The items come over from the PR.
3. Pick the supplier, the mode of procurement, the delivery date (**Deliver by**), fund, office, place of delivery and payment term.
4. For each item, check the **Kind** (*Supply*, *Semi-expendable*, *PPE* or *Service*) and the **Account**. Supplies come from the stock list. A unit cost of ₱50,000 or more is PPE; below that, semi-expendable.
5. Optionally, enter the quotations under **Abstract of quotations (optional)**.
6. Click **Save PO**.

ATLAS refuses a mode whose ceiling the order exceeds (Small Value Procurement and Direct Acquisition), and a blacklisted supplier. You can also click **New PO** on **Purchase orders** to order without a PR.

### Request the PO's obligation

1. On the draft PO, click **Request obligation**.
2. For each allotment class on the order, pick the allotment to charge, and click **Send to the budget office**.

The ORS/BURS groups the PO's object codes. Once the budget office obligates it (Box B), the approving officer can approve the PO. If the fund has no allotment of that class with a balance, the dialog says so: ask the budget office.

### Inspect and accept a delivery (IAR)

1. Open the approved PO and click **Inspect and accept delivery**.
2. Enter the date accepted, the supplier's invoice number and date, and who inspected it.
3. Enter the quantity **Delivered now** for each item (property in whole units).
4. Click **Accept delivery**.

Supplies go into stock, each unit of property is registered, and the payable to the supplier is booked. A partial delivery leaves the PO *Partly delivered*. If the delivery is late, liquidated damages of 1/10 of 1% a day of the late items (up to 10% of the contract) are computed and offered as a deduction on the voucher. Print the IAR with the **IAR** button.

### Add a stock item

1. Open **Stock** and click **New item**.
2. Enter the stock number, unit, description, inventory account and reorder point, and click **Add**.

The inventory account cannot be changed once the item has moved. Untick **In use** to retire an item.

### Issue a requisition

1. Open **Requisitions → To issue** and open the RIS.
2. Click **Approve** if your office approves first, or go straight to **Issue**.
3. Adjust the quantities if stock is short, fill in **Received by**, and click **Issue**.

Offices and employees file requisitions through **Supply & purchase requests** in their own Finance self-service; you can also click **New requisition**.

### Book the RSMI

1. Open **Inventory reports** (the **RSMI** tab) and pick the month.
2. If some issues are not yet booked, pick the fund and click **Book … issues (JEV)**.

The entry charges the month's issues to expense by office (Dr expense / Cr inventory). The **Recapitulation** shows the entry.

![The RSMI for the month](supply-officer-rsmi.jpg)

### Record the physical count of inventories

1. Open **Inventory reports → Physical count (RPCI)**, set **As of** and click **Show**. **Print** gives the count sheet.
2. After the count, type each counted quantity under **Per count**. Items left blank are taken as matching the stock card.
3. Pick the fund under **Book differences to** and click **Record the count…**.

Shortages are booked as a loss of assets and overages as miscellaneous income. Record the count as of the latest stock movement or later.

### Issue, transfer and return property

1. Open **Property**, pick **Property, plant and equipment** or **Semi-expendable**, and open the item.
2. **Issue (PAR)** or **Issue (ICS)**: pick the custodian (an employee or accountable officer card), office, location and date, and click **Issue**. Click **Print PAR** or **Print ICS** for the signed copy.
3. **Transfer**: pick the new custodian and give the reason (PTR/ITR).
4. **Return**: pick the condition (*Serviceable*, *Unserviceable*, *For repair*).

Issuing semi-expendable property charges it to expense (COA Circular 2022-004). The employee sees what is in their custody under **My accountabilities**. Use **Register existing property** only for property already in the books; new purchases are registered when their delivery is accepted.

### Dispose of property (IIRUP)

1. Book depreciation through the previous month first.
2. Open the item and click **Dispose (IIRUP)**.
3. Pick the mode of disposal, the appraised value, remarks and date, and click **Dispose**.

The asset and its accumulated depreciation come off the books; the book value is a loss.

### Book depreciation

1. Open **Depreciation**, pick the month under **Through** and click **Preview**.
2. Click **Book ₱… through …**.

One entry is posted per fund and PPE class (Dr depreciation expense / Cr accumulated depreciation). Months not yet booked are caught up. Depreciation is straight-line: (cost − 5% residual) ÷ the useful life in months.

### Print the property count reports

1. Open **Property reports**, pick **PPE** (RPCPPE) or **Semi-expendable**, the fund and the date, and click **Show**.
2. Click **Print**. The report lists property by account with blank **Per count** and **Shortage / overage** columns and the inventory committee's signature lines.

## Screens at a glance

| Screen | What it is for |
|---|---|
| Dashboard | **Waiting for you**: requisitions to issue, stock at the reorder point, depreciation not yet booked |
| Find a document | Type a PR, PO, IAR, RIS, property or PAR/ICS number, or a supplier's name |
| Card file | Suppliers (with blacklisting), employees and officers who hold property |
| Journal entries | The books (view) |
| Ledgers | One account's ledger (view) |
| Trial balance | Per fund (view) |
| Financial statements | The statements (view) |
| Bank reconciliation | The accountant's reconciliations (view) |
| Chart of accounts | Inventory, property and expense accounts |
| Budget & allotments | Allotments and their balances (view) |
| Obligations | The obligation requests your POs send |
| Budget reports | Budget office reports (view) |
| Purchase requests | PRs from the offices; **Prepare PO** on an approved one |
| Purchase orders | POs, their obligation and deliveries (IAR) |
| Requisitions | RIS to approve and issue |
| Stock | Stock items and stock cards |
| Inventory reports | RSMI and the physical count (RPCI) |
| Property | The register of PPE and semi-expendable property; issue, transfer, return, dispose |
| Depreciation | Preview and book monthly depreciation |
| Property reports | RPCPPE and the count of semi-expendable property |
| Disbursement vouchers | Payments to suppliers (view) |
| LDDAP-ADA | ADA payments (view) |
| Cash advances | Outstanding advances (view) |
| Taxes withheld | Taxes withheld from suppliers (view) |
| Official receipts | Collections (view) |
| Collections & deposits | Reports of collections (view) |
| Accountable forms | O.R. booklets (view) |
| Revenue monitoring | Collections against targets (view) |
| Audit trail | Who did what in Finance (under *Control panel* in the sidebar) |
| My accountabilities | Property in your own custody and your own cash advances |

## Questions

**Why can't I approve the PO?** The approving officer approves it, and only after its ORS/BURS is obligated.

**Why can't I accept a delivery?** Only an approved PO (or one partly delivered) receives deliveries, and never more than what is left on the order.

**PPE or semi-expendable?** It depends on the unit cost: ₱50,000 or more is PPE (COA Circular 2022-004); below that is semi-expendable, classed high- or low-value at ₱5,000. The thresholds are in the Control panel.

**Why can't I dispose of this item?** Depreciation must be booked through the month before the disposal.

**Stock is one pool for all funds.** The RSMI and the count post to the fund you pick. A school that buys supplies from more than one fund should keep separate stock items per fund.

**Can someone approve their own purchase request?** No. A PR is approved by the approving officer, never by its requester.
