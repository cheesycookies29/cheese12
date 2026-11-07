# ATLAS Finance: design and compliance

ATLAS Finance (`/finance/`) is the accounting system of a state university or college (SUC), built to the rules a Philippine national government agency's accounting department works under:

- **COA**: the Government Accounting Manual for NGAs (GAM, COA Circular 2015-007), the Revised Chart of Accounts (GAM Vol. III, updated 2019 by COA Circular 2020-001), and COA Circular 2022-004 (semi-expendable property).
- **DBM**: budget execution (appropriations, allotments, NCAs), obligations on the ORS/BURS (COA-DBM Joint Circular 2013-1), and the Budget and Financial Accountability Reports (COA-DBM JC 2019-1).
- **BIR**: withholding on government money payments.
- **GPPB**: the New Government Procurement Act (RA 12009) and its 2025 IRR.

This document records the research behind it, how each requirement is met, and what to confirm before a school goes live.

The bid asked for eight modules: **Card File, Accounts, Budget, Inventory, Property, Disbursement, Revenue and Control Panel**. All eight are built.

## 1. How the system is put together

- **One set of books per fund cluster** (GAM): 01 Regular Agency Fund (GAA), 05 Internally Generated Funds (the SUC's retained income, RA 8292), 07 Trust Receipts. 02, 03, 04 and 06 can be switched on.
  - Every document and journal entry carries its fund cluster.
  - The trial balance and the statements are per fund, or for all funds combined.
- **Double entry everywhere.** Modules never update balances directly. They post journal entry vouchers (JEV), and every balance, ledger and report is computed from posted JEVs.
  - A posted entry is never edited; it is reversed.
  - A month can be closed so nothing can be dated in it.
- **Documents follow the government workflow and its signatories.**
  - ORS/BURS: Box A (requesting office), Box B (budget officer).
  - Disbursement voucher: Box A, Box B (the accounting entry), Box C (accountant), Box D (head of agency), Box E (receipt).
  - Each step is a permission, and the server enforces separation of duties.
- **Printouts** follow the GAM Volume II appendices and show the appendix number.
- **All or nothing.** If any check in a Finance change fails partway (stock short on one item of a requisition, a closed month, a switched-off account), nothing is saved.
- **No future dates.** Entries, payments and issues cannot be dated after today.
- **Only an administrator creates or changes Finance accounts.** No officer can give themselves another office's powers.

### Roles

Finance accounts sign in on the ATLAS home page. They are on the HR side, so they also get People self-service.

| Role | Permissions |
| --- | --- |
| Chief Accountant | books, Box C, liquidations, bank reconciliation, period close and year-end closing, Control panel |
| Budget Officer | appropriations, allotments, NCAs, Box B |
| Cashier | disbursing (vouchers, checks, LDDAP-ADA, cash advances, tax remittances) and collecting (receipts, RCD, deposits) |
| Supply & Property Officer | purchase requests and orders, deliveries, stock, requisitions, property, depreciation |
| Approving Officer | head of agency: purchase requests, purchase orders, Box D |
| Administrator | everything |
| Any employee | self-service: property in their custody, their cash advances, supply requisitions and purchase requests |
| Student | their official receipts |

## 2. Requirements and how they are met

### Card File

- **One card per party**: supplier, employee, accountable officer, government agency, individual.
  - Each card holds TIN, VAT status, taxpayer type, usual nature of payment (for withholding), address, contact, bank account (for ADA), office, and the linked ATLAS account.
  - Accountable officers also have their fidelity bond (amount, expiry, policy).
- **Each card is a subsidiary ledger** (GAM Appendix 6): accounts payable, advances and receivables per payee, from the posted entries.
- **Each card shows its documents**: vouchers, obligations, purchase orders, receipts, property in custody, and taxes withheld by quarter with a BIR 2307 link.
- **Blacklisted cards** cannot receive purchase orders or payments.

### Accounts

**Chart of accounts**
- Built from the Revised Chart of Accounts: 235 accounts a SUC uses, with 8-digit codes, normal balance, contra flags, and allotment class for expenses and capital outlays.
- Accounts can be added under a valid major group or switched off. Accounts the modules post to stay on.
- Capital outlays are budgeted under the 506 UACS objects (e.g. ICT equipment `10605030` → `5060405003`), while the books debit the 106 accounts.

**Journal entries (JEV, Appendix 36)**
- Four journals: General, Cash Receipts, Cash Disbursements, Check Disbursements.
- Entries must balance and use active accounts. Drafts are posted by the accountant.
- Numbering is `fund-year-month-serial`, configurable.
- Reversal posts an opposite entry, and is allowed for manual entries only. Module entries are undone in their module.

**Books**
- General ledger per account with balance forward; subsidiary ledgers by card.
- Trial balance, before or after closing entries.
- Statement of Financial Position (current / non-current) and Statement of Financial Performance, per fund or combined, with a check that assets equal liabilities plus equity.

**Bank reconciliation (Appendices 80/81)**
- Book balance against the bank statement, ticking the cleared items.
- Deposits in transit and outstanding checks are computed; the difference is shown for adjusting entries.

**Closing**
- Months are locked through a chosen month.
- Year-end closing posts one entry per fund: revenue and expense to Accumulated Surplus/(Deficit) (30101010), dated December 31. It is only allowed once the year is over, and is refused if already done. Until a year is closed, the Statement of Financial Position shows its surplus as "not yet closed".

### Budget

**Appropriations**: GAA new and continuing, automatic, supplemental, board-approved IGF/STF budgets, trust receipts. Each is recorded by fund, PAP (UACS 15-digit code) and allotment class (PS, MOOE, FE, CO).

**Allotments**
- GARO/ABM, SARO, sub-allotments, board approvals, each against its appropriation.
- Allotments under a continuing appropriation carry their unobligated balance into the next year, where they can still be obligated.
- An allotment cannot exceed the unreleased appropriation.

**NCAs (fund 01)**
- Recorded as Dr Cash – MDS, Regular / Cr Subsidy from National Government.
- The MDS balance is what Box C checks before a check or ADA is issued.

**Obligation requests**
- ORS (Appendix 11) for fund 01; BURS (Appendix 14) for the other funds.
- Each line is charged to an allotment with an object code of the allotment's class.
- Box B refuses anything beyond the allotment's balance.
- Numbers are assigned at obligation. Adjustments (NORSA/NBURSA) can reduce or increase an obligation, never below what is paid.
- Status of obligation per line: obligated, disbursed, on vouchers, balance.

**Reports**
- Every report counts obligations, adjustments and payments in the year and quarter they happened. Earlier years' obligations paid or adjusted this year are shown in their own section.
- SAAODB, FAR No. 1 (Appendix 17): by PAP and class, obligations by quarter, disbursements, unreleased appropriations, unobligated allotments, unpaid obligations.
- RAOD per class (Appendix 9-A to D): chronological, with running unobligated and unpaid balances, and a recap by object code.
- Aging of due and demandable obligations, FAR No. 3 (Appendix 22), in age buckets, as of any date.
- SCBAA: original budget, final budget, actual (obligations).

### Inventory

**Purchase requests (Appendix 60)**
- Filed by any office, including teachers and staff through self-service. Approved by the approving officer, never by the requester.

**Purchase orders (Appendix 61)**
- Modes of procurement follow RA 12009: Small Value Procurement (capped at ₱2,000,000 for SUCs), Direct Acquisition (capped at ₱200,000), competitive bidding, and the rest. Both caps are settings.
- Optional abstract of quotations.
- Each line is a supply, semi-expendable property, PPE or a service. PPE needs a unit cost of ₱50,000 or more; semi-expendable property is below that.
- The PO's obligation request groups its object codes:
  - supplies by their expense code;
  - semi-expendable items by 50203210/50203220;
  - PPE by its asset account.
- A PO can be approved only after its ORS is obligated.

**Inspection and Acceptance Report (Appendix 62)**
- Partial deliveries are allowed.
- Supplies go into stock; each unit of property is registered.
- The liability is booked: Dr inventory / PPE / expense, Cr Accounts Payable on the supplier's card.
- Late delivery: liquidated damages of 1/10 of 1% of the late items per day, capped at 10% of the contract. The amount is offered as a deduction on the voucher.

**Stock**
- Stock cards (Appendix 58) and supplies ledger cards (Appendix 57), with FIFO cost and reorder points.

**Requisition and Issue Slip (Appendix 63)**
- Requested by an office, approved and issued by the supply office from stock (FIFO).

**RSMI (Appendix 64)**
- The month's issues, with the entry Dr expense (by office) / Cr inventory.

**Physical count of inventories (RPCI, Appendix 66)**
- Counted quantities against the cards.
- Shortages: Dr Loss of Assets. Overages: Cr Miscellaneous Income.

### Property

**Property register**
- Property number, account, cost, date acquired, useful life, residual value (5% of cost, per the GAM), serial number, office and location, custodian, status.

**Issue**
- PPE goes on a Property Acknowledgment Receipt (Appendix 73).
- Semi-expendable property goes on an Inventory Custodian Slip (Appendix 59). It is charged to expense when issued (COA Circular 2022-004) and classed high- or low-value at ₱5,000.

**Movements**
- Transfers go on a Property Transfer Report (PTR, Appendix 77); returns to the supply office are recorded.
- Disposal goes on an IIRUP (Appendix 75): the asset and its accumulated depreciation come off the books, and the book value is a loss.

**Depreciation**
- Straight-line, monthly: (cost − residual) ÷ life in months.
- It starts the month the asset is available for use if on or before the 15th, otherwise the next month.
- One entry per fund and class. Months not yet booked are caught up.
- Disposal requires depreciation booked through the previous month.

**Useful lives**: COA Circular 2003-007 Annex A, kept in force by COA Circular 2015-002.
- 5 years: office and ICT equipment, books.
- 7 years: motor vehicles.
- 10 years: other equipment, furniture, land improvements.
- 30 years: concrete buildings.
- The life can be changed per item.

**Reports**
- Property card per item (history).
- Report on the Physical Count of PPE (RPCPPE, Appendix 74) and of Semi-expendable Property, by account, with blank count columns and the committee's signature lines.

### Disbursement

**Disbursement voucher (Appendix 32)**
- Prepared against an obligation, or without one only for non-budgetary payments: settling a liability (payables, amounts due to BIR, GSIS and others, trust liabilities). Expense, capital outlay, inventory and advance accounts are refused without an obligation.
- The payee must be the obligation's payee. A purchase order's obligation is paid delivery by delivery: against an accepted IAR, up to the value it accepted.
- Charges never exceed the obligation's balance, counting other vouchers not yet paid.
- Payments for accepted deliveries debit Accounts Payable.
- Taxes are computed from the payee's card (see Taxes below).
- Box C checks:
  - the obligation is still available;
  - the cash is available: the cash account's balance less vouchers already approved, i.e. MDS for funds 01 and 07, the fund's bank account otherwise;
  - the accountant confirms the supporting documents are complete.
- Box D is approved by someone other than the preparer and the certifier.
- Payment:
  - by check (MDS or the agency's bank account), posted to the Check Disbursements Journal;
  - or by LDDAP-ADA, posted to the Cash Disbursements Journal.
- A spoiled, stale or cancelled check can be voided; this reverses the payment.
- Box E records the payee's receipt.

**LDDAP-ADA (Appendix 42)**
- Approved ADA vouchers of one fund, each payee with a bank account; printable with the total in words.

**Cash advances** (COA Circular 97-002 / 2012-004)
- Advance types: operating expenses, local and foreign travel, payroll, special disbursing officer. They go to the 19901 advance accounts.
- No new advance while one is unsettled.
- Special disbursing and payroll advances need a fidelity bond on the officer's card that covers the amount and has not expired.
- Liquidation deadlines are settings: 20 days for special purposes, 30 days local travel, 60 days foreign travel, 5 days payroll.
- Liquidation reports (Appendix 44) debit expenses within the advance's obligation. Refunds are official receipts crediting the advance account.
- Overdue advances are flagged.

**Taxes**
- Monthly summary by fund and ATC, for 0619-E, 1600-VT and 1600-PT.
- Remittance:
  - fund 01 by Tax Remittance Advice: Dr Cash – TRA / Cr Subsidy from NG, then Dr Due to BIR / Cr Cash – TRA;
  - other funds from their bank account (eFPS).
- Quarterly Alphalist of Payees, for the 1601-EQ.
- BIR Form 2307 per payee and quarter: expanded withholding, or VAT and percentage tax withheld.

### Revenue

**Accountable forms**
- Official receipt booklets (Accountable Form 51), 50 receipts each, issued to collecting officers by fund, with no overlapping serials.
- The booklet list is the Report of Accountability for Accountable Forms (RAAF, Appendix 67).

**Official receipts**
- Drawn from the collector's own booklet in serial order.
- Each line is a fee from the fee list (or any revenue, receivable, advance, trust or payable account), and the payor is a student, a card or a name.
- A cancelled receipt keeps its serial, with the reason.
- Students see their receipts in self-service.

**Report of Collections and Deposits (Appendix 26)**
- The collector's unreported receipts, posted to the Cash Receipts Journal: Dr Cash – Collecting Officers / Cr revenue.
- The deposit is recorded with the validated deposit slip: Dr Cash in Bank / Cr Cash – Collecting Officers.
- Undeposited reports past the deposit deadline are flagged.

**Revenue monitoring**: the school's own income by account and month against targets set by the budget or revenue office (the basis of FAR No. 5). Subsidies from the national government and other agencies are not counted as collections.

### Control Panel

- **Entity**: name, UACS organization code, TIN, address, fiscal year.
- **Structure**: fund clusters in use, responsibility centers (offices), PAPs.
- **Banks and fees**: bank accounts and their ledger accounts, and the fee list.
- **Signatories** printed on each form.
- **Numbering**: each document's format, with the tokens `{F}` fund, `{YYYY}`, `{MM}` and `{N4}` serial.
- **Rules**: withholding tax table (ATC, rate, nature, payee type), capitalization and high-value thresholds, residual rate, procurement ceilings, deposit deadline, liquidation deadlines.
- **Periods**: closing the books through a month, reopening, year-end closing.
- **Users**: Finance accounts (create, change role, disable, reset password; administrators only) and the matrix of roles and permissions.
- **Audit trail**: every action, with who did it and when.

## 3. Taxes on government money payments (research summary)

| Payment | Payee | ATC | Rate | Base |
| --- | --- | --- | --- | --- |
| Goods | individual / corporation | WI640 / WC640 | 1% | net of VAT if VAT-registered |
| Services | individual / corporation | WI157 / WC157 | 2% | same |
| Rentals | individual / corporation | WI100 / WC100 | 5% | same |
| Professional fees, individual | gross income ₱3M or less / more or VAT-registered | WI010 / WI011 | 5% / 10% | same |
| Professional fees, corporation | gross income ₱720K or less / more | WC010 / WC011 | 10% / 15% | same |
| Contractors | individual / corporation | WI120 / WC120 | 2% | same |
| VAT withheld (creditable since 2021, RMC 36-2021) | VAT-registered payees | WV010 goods / WV020 services | 5% | net of VAT |
| Percentage tax withheld (back to 3% since July 2023) | non-VAT payees | WB080 | 3% | gross |

Notes:
- WI/WC158 and 160 are for private top withholding agents, not government.
- Under the Ease of Paying Taxes Act (RA 11976), the obligation to withhold arises when the amount becomes payable.
- Returns and deadlines:
  - 0619-E by the 10th of the following month for the first two months of a quarter;
  - 1601-EQ with the Quarterly Alphalist of Payees by the last day of the month after the quarter;
  - 1600-VT and 1600-PT by the 10th of the following month;
  - 1604-E by March 1.
- Fund 01 taxes are remitted through the Tax Remittance Advice (JC 1-2000, RR 1-2013). Taxes on the SUC's own funds are paid from its bank account.
- Rates and ATCs are editable in the Control panel.

## 4. What is not in this release

- **Payroll from ATLAS People.** Payroll vouchers are entered here. People computes payroll, but its personnel-services obligations and payroll entries are not yet posted to Finance automatically.
- **Petty cash fund**: petty cash vouchers (Appendix 48), replenishment report (Appendix 49), registers.
- **Further reports and outputs**:
  - the remaining budget reports in DBM's exact templates for online submission: FAR No. 1-A, 1-B, 1-C, 2, 2-A, 4, 5 and BAR No. 1;
  - the Statement of Cash Flows and the Statement of Changes in Net Assets/Equity;
  - the notes to the financial statements;
  - eNGAS export;
  - the BIR alphalist in the DAT file format, and the eFPS/eBIRForms files.
- **Other features not yet built**:
  - assessments of students' fees (billing before collection);
  - online payments (Link.BizPortal);
  - Notice of Cash Allocation lapsing at year end;
  - continuing appropriations carried to the next year;
  - inter-fund transfers;
  - fund 01 collections remitted to the Bureau of the Treasury: there is a Constructive Income Remittance account, but no screen for it.
- **Campus books.** Finance keeps one set of books per fund for the whole institution, not one per campus.
- **Stock by fund.** Stock is one pool. The RSMI and the physical count post to the fund the user picks, so a school buying supplies from more than one fund should keep separate stock items per fund.
- **Back-dated issues.** FIFO costing takes the oldest lots on hand now, not as of a back-dated issue's date.

## 5. To confirm before going live

The research reached the official sources for most items, but several government sites were unreachable (coa.gov.ph, dbm.gov.ph and uacs.gov.ph returned 403/503). Check these against the documents the school's accountant and COA auditor use:

1. **Chart of accounts.**
   - The balance-sheet codes come from the 2015 Revised Chart of Accounts and are believed unchanged in the 2019 update.
   - Expense and revenue codes were checked against 2022–2024 agency financial accountability reports.
   - Confirm against COA Circular 2020-001 Annexes A–G and COA Circular 2022-002.
2. **Default sub-objects.** UACS sub-objects other than 00 (e.g. 5020301002 Office Supplies Expenses) are not applied; the 8-digit code is used. If the school's FARs use sub-objects, add them as accounts.
3. **Percentage tax code.** The ATC for percentage tax withheld by government (WB080 here) was not confirmed.
4. **Exemption for small purchases.** The ₱10,000 exemption from the 1%/2% for small government purchases, mentioned in a BIR regional reminder, was not confirmed. It is not applied.
5. **Useful lives.** Semi-concrete buildings and "other machinery and equipment" were not retrieved from COA Circular 2003-007; set per item.
6. **Validity of appropriations.** NBC 599's validity periods for FY 2026 (PS to December 31, 2026; MOOE and CO to December 31, 2027, as read) govern the "continuing" kind.
7. **Due dates.** The BFAR submission deadlines and the quarterly financial statement deadline. Year-end statements go to COA by February 14.

The full research notes, with sources and what could not be verified, are in [finance/RESEARCH-RULES.md](finance/RESEARCH-RULES.md) (BIR, DBM, COA forms, procurement) and [finance/RESEARCH-CHART.md](finance/RESEARCH-CHART.md) (chart of accounts, UACS, useful lives).
