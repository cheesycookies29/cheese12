# CBSUA's FMIS requests against ATLAS Finance

**Source:** the FMIS tab of CBSUA's punch list from the October 15, 2026 executive meeting, items
PL-01 to PL-120. The items are end users' comments on demos of the systems the university uses today,
which come from another vendor. IDs are as in that tab. (The cross-system tab has its own PL-01.)

**What was checked:** the ATLAS code as it stands. That means `server/finance.js`,
`finance-budget.js`, `finance-supply.js`, `finance-cash.js` and `hris-finance.js`; `shared/finance.js`,
`numbering.js`, `settings-catalog.js` and `roles.js`; `server/config.js`; the screens in
`public/js/finance/` (forms in `views/print.js`); `docs/FINANCE-PLAN.md`, `docs/finance/*`, the five
Finance guides and the README. Paths below are relative to `lms/`.

**How to read it:**
- *Has*: ATLAS does what is asked today.
- *Configurable*: an administrator can already set it.
- *Partly*: some of it is there.
- *Missing*: not built.
- *Not ATLAS*: a bug or bad data in the other vendor's system; the row says whether ATLAS has the
  matching safeguard.

**Effort** includes tests and the guide updates the repository requires:
- **S**: up to 3 days.
- **M**: 1–2 weeks.
- **L**: more than 2 weeks.
- A dash means nothing needs to be built.

**What this does not change:** the earlier council's verdict on Finance stands
(`../../2026-11-cbsua-modules/README.md`). Finance is "not yet" until three things are done:
- the rollback snapshot is replaced;
- administrators lose their transactional powers;
- the FINANCE-PLAN §5 items are confirmed.

Then it starts as a Fund 05 pilot. Nothing in this matrix should be built before the storage move.

## The matrix

| ID | Area | Request | ATLAS today | Where | To meet it | Effort |
|---|---|---|---|---|---|---|
| PL-01 | Accounts | Set up the chart of accounts, opening entries and beginning balances, and validate the trial balance | Has | `shared/finance.js` (235-account Revised Chart); Journal entries; Trial balance; Statement of Financial Position checks that it balances | Nothing required. A per-fund CSV import of the opening trial balance would speed up go-live | S |
| PL-02 | Accounts | Control panels for tax codes, bank accounts, fund categories and access rights | Configurable | Control panel → Taxes & rules, Banks & fees, Funds & offices, Users (`PUT /api/finance/settings`); Admin → Roles & permissions | Already set by an admin. Funds under each cluster: see theme 4 | — |
| PL-03 | Budget | Link approved budget object codes to the BUS and to transactions that are not procurement | Partly | `finance-budget.js` `obligationFields`: each ORS/BURS line is charged to an allotment (fund, PAP, class) with an object code of that class; an ORS can be made without a PO | Optional line-item budget: allotments broken down by UACS object code, with Box B checking the object code's balance when the school turns it on | M |
| PL-04 | Budget | Bring the APP/PPMP into budget realignment and tracking | Missing | No PPMP or APP anywhere in `finance-supply.js` | PPMP per office and APP per year as versioned documents, a PPMP vs allotment vs obligation view, and realignment recorded as an allotment modification | L |
| PL-05 | Procurement | Full pipeline: PR → RFQ → Abstract → Resolution → PO → Inspection → Receipt | Partly | `finance-supply.js`: PR → PO (optional abstract of quotations inside the PO) → ORS → IAR (stock, property, payable) | Add the RFQ, the abstract as its own document, and the BAC resolution / notice of award before the PO. Make the stages a route per mode of procurement (theme 7) | L |
| PL-06 | Disbursement | Make the voucher, check and entry from the ORS | Has | `finance-cash.js` `dvFields` (charges to ORS lines), `payDv` (JEV in CKDJ or CDJ) | Nothing to build | — |
| PL-07 | Integration | JEVs generated automatically from HRIS payroll runs | Has | `server/hris-finance.js`: a finalized run makes the ORS/BURS, then the payroll DV (its JEV is posted on payment), then the remittance DVs | Nothing to build; see PL-104 for the review screen | — |
| PL-08 | Budget control | Real-time tracking, alerts and hard limits on each office's budget | Partly | Box B refuses anything over the allotment's balance (`/obligations/:id/obligate`); dashboard shows use by class | Budget per office (PL-12), the hard stop at Box B per office, and alert thresholds (e.g. 80%, 95%) sent through the bell (`server/notifications.js`) | M |
| PL-09 | Approval | Multi-stage approval of PRs, POs and DVs before the obligation is final | Partly | PR approved by the approving officer, never the requester; PO approved only after its ORS is obligated; DV Boxes A–E with separation of duties | Configurable approval steps per document type (e.g. head of office → VP → President, by amount), added in front of the fixed legal boxes (theme 7) | L |
| PL-10 | Numbering | Dynamic series and formats for BUR/ORS, with allocation across several funds | Partly | Control panel → Signatories → Document numbering (`DEFAULT_NUMBERING.ors`; tokens {F} {YYYY} {MM} {N4}); one fund per ORS | Separate `ors` and `burs` series, a reset period (theme 1), and a request charged to several funds split into one ORS/BURS per fund | M |
| PL-11 | Fund setup | Fee types under each kind of fund | Configurable | Control panel → Banks & fees: each fee has a fund, a revenue account and a default amount | Already set by an admin. Grouping the list by fund and adding a fee category lookup would help | S |
| PL-12 | Budget allocation | Distribute the budget to each office | Missing | Allotments are by fund, PAP and class only (`budgetLine`); offices exist only as responsibility centers | Allocations per office under each allotment; the ORS draws on its office's allocation; reports by office | M |
| PL-13 | Budget reports | Include the Fund/Resource Allocation (FRA) | Missing | None | Print it from the per-office allocations (PL-12), to CBSUA's sample | M |
| PL-14 | Budget reports | BFARs: FAR No. 1, 1-A, 2 and 2-A | Partly | Budget reports: SAAODB (FAR No. 1), RAOD, FAR No. 3, SCBAA (`finance-budget.js`) | FAR 1-A (by object of expenditure), FAR 2 and 2-A (off-budget funds: IGF, BRF), from the same data, with Excel export in DBM's layout | M |
| PL-15 | Obligation | One ORS/BURS covering payroll, several PAPs and several UACS codes | Has | Each ORS line has its own allotment (so its own PAP) and object code; payroll ORS from `hris-finance.js` | Nothing to build | — |
| PL-16 | Budget setup | Remove the Tier and Quantity fields | Has | The appropriation and allotment forms (`views/budget.js`) have no tier or quantity fields | Nothing to build | — |
| PL-17 | Budget setup | Monthly fields default to zero | Missing | No monthly breakdown (no monthly disbursement or cash program) | If a monthly program is added, blanks count as 0 and the months must add up to the allotment | S |
| PL-18 | Numbering | Separate transaction numbers per fund | Partly | {F} runs a separate serial per fund for JEV, ORS/BURS, DV, RCD and LDDAP (`fx.nextNo`). PR, PO, IAR, RIS and property numbers are not given the fund, so {F} prints blank in them | Pass the fund to every `nextNo` call, so the admin can put {F} in any series | S |
| PL-19 | BUS | The BUS should use the Division, not default to the Unit/Office | Partly | Offices are one flat list (`settings.offices`); the ORS office is optional and not defaulted | Office hierarchy (division → unit) and a setting for which level each document asks for and prints | S |
| PL-20 | Obligation | Separate serial numbers for BURS and ORS | Partly | One `ors` format for both. With {F}, ORS (fund 01) and BURS (the other funds) never share a serial; without {F} they do | Add a separate `burs` numbering key, defaulting to the same format | S |
| PL-21 | Budget | Fix the spelling of "Operations" | Not ATLAS | A label in the vendor's system; ATLAS has no "Internal Operation Budget" screen | Nothing to build | — |
| PL-22 | PPMP | PPMP in Indicative, Amended and Supplemental versions | Missing | None | PPMP document with a version type (Indicative, Final, Amended, Supplemental) and its history; one current version per office and year (theme 6) | L |
| PL-23 | PPMP | The "Checked by" signatory is fixed to one person; it should be the current Procurement Officer | Partly | Signatories are role keys with a typed name (Control panel → Signatories); there is no Procurement Officer or BAC key; documents keep who actually signed | Signatory slots resolved when printed to whoever holds the role, then frozen on the document once it is signed (theme 2) | S |
| PL-24 | APP | APP in Indicative, Amended and Supplemental versions | Missing | None | The same versioning as the PPMP | M |
| PL-25 | APP | Simpler APP updating | Missing | None | APP consolidated from the approved PPMPs and changed by amendment, not retyped | M |
| PL-26 | APP | CSE prices updated every year | Missing | Stock items have no price list (`itemFields`) | Yearly price list for common-use supplies and equipment, imported by CSV, used as the default unit cost in the PPMP and PR | M |
| PL-27 | PR | A PR can be created without an APP | Has | A PR needs no APP or PPMP today (`POST /api/finance/prs`) | Keep this as a setting once PPMP/APP exist: "PR needs a PPMP/APP line: off / warn / block" | S |
| PL-28 | PR | A PR can be created once a PPMP exists | Missing | No PPMP | PR lines picked from the office's PPMP (PL-119) | M |
| PL-29 | RFQ | Supplier name not required on the RFQ | Missing | No RFQ | RFQ document sent to many suppliers, with no supplier required; quotes recorded against it (PL-05) | S |
| PL-30 | PO | Supplier name should be blank | Partly | The PO form starts with no supplier, but saving needs one (`fx.card(body.supplierId)`) | Ask what is meant: blank on the printed form, or a draft PO before the award? A draft can be allowed without a supplier, but an approved PO must name one | S |
| PL-31 | Check register | Check number and net amount generated automatically | Partly | Net is computed (gross − taxes − deductions). The check number is typed at payment and checked for duplicates (`/dvs/:id/pay`) | Check booklets per bank account as accountable forms, like O.R. booklets: the next number offered automatically, spoiled numbers kept | M |
| PL-32 | Releasing | Do not require an ID attachment for releasing | Has | Box E records who received, the date and the O.R. no.; no ID asked (`/dvs/:id/receipt`) | Nothing to build | — |
| PL-33 | Check register | Statuses: Preparation, Approval, Releasing, Cancelled | Partly | DV statuses are Draft, Certified, Approved, Paid, Cancelled (`DV_STATUS`); release is Box E | A check record with its own status list: labels the school sets, mapped to fixed internal states (theme 5) | M |
| PL-34 | Cancelled checks | Revise the format to the sample | Missing | Voided checks are kept on the DV (`d.voided`), but there is no report | Cancelled checks report built to CBSUA's sample (theme 3) | S |
| PL-35 | Cancelled checks | Add "Request for Check Cancellation" and "Notice of Check Cancellation" | Missing | Voiding is one step by the accountant (`/dvs/:id/void-payment`) | Two steps: the cashier requests, the accountant approves and the notice prints; both are statuses on the check | M |
| PL-36 | Issued checks | Report daily, monthly and yearly | Missing | No Report of Checks Issued (GAM App. 35) | RCI per bank account and fund, with a period picker (day, month, year) and Excel export (theme 3) | M |
| PL-37 | Issued checks | Signatory is the immediate head of office | Missing | Reports print fixed keys (accountant, head of agency) | A signatory rule "head of the preparer's office", taken from the office's Head (Control panel → offices already has a Head column) (theme 2) | S |
| PL-38 | Issued checks | Report numbers as Year/Month/Series, starting at 001 and reset each year | Partly | The tokens exist, but any {MM} makes a series restart every month (the `fx.nextNo` key); reports have no numbers | A reset period separate from the format (never, yearly, monthly), so `{YYYY}-{MM}-{N3}` can run all year; numbering for reports as well as documents (theme 1) | S |
| PL-39 | Issued ADA | Report daily, monthly and yearly | Partly | LDDAP-ADA lists per fund; no Report of ADA Issued (App. 13) | Report of ADA Issued with the same period picker as PL-36 | M |
| PL-40 | Issued ADA | Default series as Year/Month/Series, reset to 001 each year | Partly | Same as PL-38 | Same as PL-38 | S |
| PL-41 | Issued ADA | Signatory is the immediate head of office | Missing | Same as PL-37 | Same as PL-37 | S |
| PL-42 | ADA preparation | No ADA preparation for Funds 161 and 164 (mode of payment) | Partly | The ADA mode works in any fund cluster in use, with one LDDAP-ADA per cluster. But funds are only the seven fixed GAM clusters (`FUND_CLUSTERS`), so CBSUA's 161/164 have no place | Funds under each cluster: code (e.g. 161, 164), name, campus, bank account and allowed modes of payment (theme 4) | M |
| PL-43 | ADA preparation | ADA status should only be "Preparation" | Partly | ADA vouchers go Draft → Certified → Approved → Paid on an LDDAP | Ask what "Preparation" covers. Then set the status labels per document (theme 5) | S |
| PL-44 | Checks on hand | Retitle as "Monthly Report of Accountability for Accountable Forms (RAAF)" | Partly | The RAAF covers O.R. booklets only (Accountable forms screen) | Checks become accountable forms in the RAAF (App. 67), by fund and month | M |
| PL-45 | Checks on hand | Generate it monthly | Partly | The booklet list has no period | Month picker showing beginning balance, received, issued and ending, per form type | S |
| PL-46 | Checks on hand | Signatory is the immediate head of office | Missing | Same as PL-37 | Same as PL-37 | S |
| PL-47 | ACIC | Remove the ACIC No. | Missing | No ACIC (App. 39) | ACIC per MDS bank account, from a template where optional columns can be switched off. Prescribed columns stay unless COA agrees (theme 3) | M |
| PL-48 | ACIC | Remove the allocation number | Missing | No ACIC | A column switch in the ACIC template | S |
| PL-49 | ACIC | Remove "Received by", "Verified by" and "Posted by" | Missing | No ACIC | A configurable signature block on the template | S |
| PL-50 | ACIC | Remove the object code column | Missing | No ACIC | A column switch in the template | S |
| PL-51 | ACIC | Applies only to DBP bank accounts | Missing | Bank accounts have no type (`bankAccounts`: name, number, fund, ledger account) | A flag on each bank account (government servicing bank / MDS, or commercial) that decides which reports include it | S |
| PL-52 | Disbursed checks | Rename as "Unreleased Checks" | Missing | Paid vouchers with no Box E receipt are the unreleased checks, but there is no report | An "Unreleased checks" report (paid, not received), with age | S |
| PL-53 | Unreleased checks | Generate it yearly | Missing | No report | Period picker (theme 3) | S |
| PL-54 | Report of Disbursement | Monthly Report of Disbursement for Fund 101/GAA | Missing | Only the CKDJ/CDJ journal lists | Monthly Report of Disbursements (FAR No. 4, App. 23) per fund | M |
| PL-55 | Cashier receiving | Record the date and time the Cashier's Office receives documents | Missing | Timestamps only for preparing, certifying, approving and paying (`certifiedBy.at`, `approvedBy.at`) | Routing log: "received by" an office, with date and time, at each step; shown on the DV and in a tracking report (theme 7) | M |
| PL-56 | ADA preparation | ADA for Fund 101 | Has | Fund 01 ADA through the MDS and the LDDAP-ADA | Nothing to build | — |
| PL-57 | Authority to Debit/Credit | Authority to Debit/Credit Account for Funds 163 and 164 (two campuses) | Partly | ADA payments from the bank accounts of funds other than 01; only the LDDAP-ADA prints; no campus books (FINANCE-PLAN §4) | Funds per campus (PL-42), and a printed Authority to Debit/Credit Account for commercial bank accounts in the bank's format | M |
| PL-58 | List pages | Load records with a default status, and fetch again when the filter changes | Partly | Lists open on a default tab (DVs "For certification", JEVs "Posted and drafts"); the filter dropdowns still need **Find** or **Show** | Submit the filter form when a dropdown changes (`public/js/finance/views/*`) | S |
| PL-59 | Home page | The home page is blank after sign-in; add a dashboard | Has | Finance dashboard (`views/dashboard.js`): cash by fund, budget use, collections, "Waiting for you" | Nothing to build | — |
| PL-60 | Control panel > Employee | Duplicate employee records; no check for an existing email or name | Not ATLAS | Safeguards: usernames are unique (`validateUserFields`), so are employee numbers (`server/hris.js`); one account per employee; cards are unique by name and TIN. There is no duplicate email or name check | Warn on the same email, or the same name and birth date, when creating an employee or account; a duplicates report for the import | S |
| PL-61 | Control panel > User accounts | Test accounts with disposable emails, one an admin, in production | Not ATLAS | Demo records are flagged (`demo: true`, `example.edu`) and removed in one step (`DELETE /api/admin/demo`); only administrators create Finance accounts | A configurable list of blocked email domains, and a list of accounts that have never signed in | S |
| PL-62 | Accounts > Setup | Purpose of the setup screen unclear; cannot add or delete | Not ATLAS | Each Control panel tab is explained in `docs/guides/accountant.md` | Nothing to build | — |
| PL-63 | Accounts > Transaction No. | JEV series per journal type within each fund | Partly | The JEV format has {F} but no journal token | A {J} token (GJ, CRJ, CDJ, CKDJ, ADA), so the series runs per fund and journal (theme 1) | S |
| PL-64 | Accounts > Transaction No. | Journal summaries also numbered per fund | Partly | Journals are listed and filtered per fund and journal, but not numbered as summaries | The same {J} token for numbered journal summaries (PL-120) | S |
| PL-65 | Chart of accounts | Delete accounts that are unused and have no balance | Missing | Accounts can be switched off but not deleted; default accounts are added back on update (`mergeChart`) | Delete for added accounts never posted to; default accounts can only be hidden | S |
| PL-66 | Chart of accounts | Inactivate an account only when it has no balance | Partly | Switching off is refused only for the accounts the modules post to (`PUT /api/finance/accounts/:code`) | Also refuse it while the account has a balance in any fund | S |
| PL-67 | Chart of accounts | Show header and sub-header accounts in another colour | Partly | A flat list of 8-digit accounts; the groups come from the code (`GROUPS`, `MAJOR`) | Shaded heading rows for group, major group and sub-major group | S |
| PL-68 | Chart of accounts | Account types: Class, Header, Sub-Header, Detail; drop "Detail Cash" | Has | No account-type dropdown: the level comes from the code, and only detail accounts take entries | Nothing to build (heading rows: PL-67) | — |
| PL-69 | Beginning balance | One beginning balance per fund; the "New" button disappeared | Has | Beginning balances are opening JEVs dated January 1, in any fund (as in `finance-demo.js`), with no limit | A labelled "Beginning balance" source on the JEV and the CSV import from PL-01 | S |
| PL-70 | Beginning balance | Subsidiary ledger button for beginning balance accounts | Has | JEV lines take a card, which makes the subsidiary ledger | Nothing to build | — |
| PL-71 | Beginning balance | Restore a cancelled beginning balance to "For Posting" for editing | Partly | Drafts stay editable until posted; a posted entry is reversed and never reopened (GAM) | "Copy as a new draft" from a reversed entry, so no amount is retyped | S |
| PL-72 | All modules | "Company" filled in automatically | Has | Entity name from the Control panel (blank uses the school's name), on every form | Nothing to build | — |
| PL-73 | JEV | Unit/Office and Division not mandatory | Has | The office is optional on JEV lines (`manualFields`) | Nothing to build | — |
| PL-74 | JEV | Journal types: add "Advice to Debit Account", remove "Purchase" and "Sales" | Partly | Four fixed journals (`JOURNALS`: GJ, CRJ, CDJ, CKDJ); ADA payments post to the CDJ | The journal list as a lookup tied to the GAM books, with an ADA journal and a journal chosen per source (theme 5) | S |
| PL-75 | JEV | Fund list: add Business Related Fund, drop Trust Receipts | Configurable | Control panel → Funds & offices switches clusters 01–07 on and off; a cluster in use cannot be removed | Already set by an admin | — |
| PL-76 | JEV | The Subsidiary Ledger button does not work | Not ATLAS | ATLAS keeps a subsidiary ledger on each card (Card file) | Nothing to build | — |
| PL-77 | JEV | Cancel does not work on posted JEVs | Not ATLAS | ATLAS reverses a posted manual JEV with an opposite entry; module entries are undone in their module | Nothing to build | — |
| PL-78 | JEV | Restore cancelled JEVs to "For Posting" for editing | Partly | Same as PL-71 | Same as PL-71 | S |
| PL-79 | JEV | Delete button for cancelled JEVs | Partly | Drafts can be deleted; posted and reversed entries stay on the books | Do not build for posted entries: COA keeps them | — |
| PL-80 | JEV | JEVs from a liquidation still editable before posting | Partly | The accountant enters the liquidation's lines, but saving posts the JEV at once (`POST /api/finance/liquidations`) | An option to save a liquidation as a draft JEV, posted after review | S |
| PL-81 | Closing entries | Accounts cannot be added in "New Transaction" | Not ATLAS | ATLAS makes the year-end closing entry itself, once per fund (`POST /api/finance/closing`) | Nothing to build | — |
| PL-82 | Closing entries | Load all income and expense accounts with their balances | Has | The closing entry takes every revenue and expense balance automatically | If the auditor wants it, close in two steps through Revenue and Expense Summary (30301010) | S |
| PL-83 | Book of accounts | Unclear; should list the General, Cash Receipts, Cash Disbursement, Check Disbursement and ADA journals | Partly | Journal entries filters the four journals; there are no printed books in the GAM column layout | Printable books of accounts (App. 1–4) per fund and month, including an ADA journal | M |
| PL-84 | Bank reconciliation | Nowhere to enter bank statements, balances or transactions; saving fails | Partly | Book balance, statement balance and cleared book items are ticked; deposits in transit and outstanding checks are computed; saved per account, fund and month (`/api/finance/bank-recon`) | Add bank-side items (charges, interest, credits not in the books) and the printed BRS (App. 81). The save failure is the vendor's bug | M |
| PL-85 | Bank reconciliation | Upload statements, pull JEVs, match, find reconciling items, attach documents, compute the adjusted balance | Partly | Cash-in-bank lines are pulled from JEVs and ticked by hand; the adjusted balance is computed | Statement import (CSV), automatic matching by amount, check no. and date, a list of reconciling items, the statement attached, and a draft adjusting JEV | L |
| PL-86 | Journal reports | All journal reports under one button with a dropdown | Has | Journal entries is one screen with a Journal dropdown | Nothing to build | — |
| PL-87 | General ledger | Running balance after each movement | Has | Ledgers: balance forward and a running balance (`/api/finance/ledger/:code`) | Nothing to build | — |
| PL-88 | Account transactions | Summary of transactions per account (e.g. Due to BIR) | Has | Ledgers: pick an account, fund and period; CSV export | Nothing to build | — |
| PL-89 | Subsidiary ledger | Running balance after each movement | Has | Card ledgers with a running balance (`GET /api/finance/cards/:id`) | Nothing to build | — |
| PL-90 | Subsidiary ledger | Pick the account first, then only the names under it | Partly | The subsidiary ledger opens from the card (name first) | Subsidiary ledger by account: pick it, see the cards with balances, open one | S |
| PL-91 | Summary of fixed assets | Belongs under the Supply Office | Has | Property, Depreciation and Property reports are in the supply officer's Property section | Nothing to build | — |
| PL-92 | Financial statements | Retitle as "Statement of Changes in Net Assets/Equity" | Missing | ATLAS has no SCNA/E yet | Build it with the PPSAS title (PL-94) | M |
| PL-93 | Financial statements | All statements under one button with a dropdown | Partly | One screen shows Position and Performance side by side | A statement picker on the same screen for all of them | S |
| PL-94 | Financial statements | Add the Statement of Cash Flows and the Notes | Missing | FINANCE-PLAN §4 lists both as not built | Statement of Cash Flows (direct method) from cash lines, with an activity mapping per account and source the school can set; SCNA/E; Notes as an editable template filled with schedules | L |
| PL-95 | Statements / Trial balance | Formats should follow the office's existing reports | Partly | Formats follow PPSAS/GAM, per fund or combined | Report templates (headings, columns, prior-year comparison, signatories) built from CBSUA's samples (theme 3) | M |
| PL-96 | Cash Disbursement Journal | Liquidations of SDO and payroll advances belong in the CDJ, with the summary for posting | Partly | Liquidations post to the GJ (`finance-cash.js`); payroll payments to the CKDJ/CDJ | A journal chosen per source (liquidation → CDJ) and a monthly summary for posting to the GL | S |
| PL-97 | Budget vs Actual | Belongs under the Budget Office | Has | The SCBAA is in Budget reports | Nothing to build | — |
| PL-98 | Liquidation | All account titles selectable when posting | Partly | Lines are limited to the object codes on the advance's ORS (budget control) | Allow other expense codes of the same allotment class, with an ORS adjustment prompted. Keep the check | S |
| PL-99 | BUS | BUS should be the ORS for Regular Agency Fund and the BURS for IGF | Has | `obligationForm`: fund 01 → ORS, every other fund → BURS | Nothing to build | — |
| PL-100 | BUS / DV | One BUS/ORS, many DVs for staggered payment, never above the obligation | Has | Charges per ORS line; vouchers not yet paid are counted (`pendingByLine`) | Nothing to build | — |
| PL-101 | BUS / DV | Expense accounts debited from the BUS are only suggestions the preparer can replace | Partly | Debits come from the ORS lines (Accounts Payable for a PO) and cannot be changed | The DV preparer may change the debit within the same allotment class, with the ORS line still charged and the change shown at Box C | S |
| PL-102 | JEV integration | Link the depreciation schedule, NOD summary and RSMI summary to JEV creation | Partly | The depreciation run and the RSMI post their JEVs (`finance-supply.js`); the IAR posts the delivery; there is no NOD | A NOD document before the IAR (PL-114) | M |
| PL-103 | JEV integration | UIS assessment and collection of student fees into JEVs | Partly | Collections: O.R.s → RCD → CRJ entry. Assessments (billing, receivables) are not built (FINANCE-PLAN §4) | Academic assessments post Dr Accounts Receivable / Cr School Fees, per fee type and fund | L |
| PL-104 | JEV integration | View the payroll details behind the automated entry and adjust it | Partly | Payroll ORS and DVs carry the General Payroll id in their particulars; a draft DV can be edited | A link from the voucher to the payroll register in People, and a review step before it is submitted | S |
| PL-105 | Disbursement > BIR 1600 | Retitle as "Alphalist of Taxes Withheld", listing every tax to remit | Partly | Taxes withheld: monthly summary by fund and ATC, quarterly alphalist of payees, BIR 2307 (`/api/finance/taxes*`). Payroll tax is a voucher deduction, so it is not on these lists | A monthly Alphalist of Taxes Withheld per payee and ATC, including compensation tax from payroll | M |
| PL-106 | All reports | All signatories in uppercase | Has | Printed forms show signatory names in capitals (`.f-sign .f-line` in `public/css/finance.css`); the signature rows on report screens do not | Same style on report signature rows, as a template setting | S |
| PL-107 | Control panel > setup screens | Setup screens accept duplicate active records and invalid values | Not ATLAS | ATLAS refuses duplicate codes for offices, PAPs, ATCs and stock numbers (`codeList`, `itemFields`); units of measure are free text | Lookup lists (units, delivery terms) with unique active values and checked numbers (theme 5) | S |
| PL-108 | Employee data from HRIS | Names in inconsistent capitalization | Not ATLAS | Names are stored as typed (`validateUserFields`); nothing standardizes them | Optional name normalization on entry and import, keeping particles such as "de la" | S |
| PL-109 | Semi-expendable property | IIRUSP missing | Missing | Disposal (with an IIRUP number) works for PPE and semi-expendable items, but nothing prints (`/property/:id/dispose`) | IIRUSP print (COA Circular 2022-004) from the disposal data, several items per report | S |
| PL-110 | Semi-expendable property | RegSPI missing | Missing | ICS issues are only in each item's history | Register from the ICS issues, per fund and period | S |
| PL-111 | Semi-expendable property | RSPI missing | Missing | Same data as PL-110, no report | RSPI per month from the ICS issues | S |
| PL-112 | Equipment / semi-expendable | Return slip missing | Missing | A return is recorded with its condition (`action === 'return'`); there is no form | Printed return slip with its own number series | S |
| PL-113 | Procurement records | SMO access to the approved PPMP, PR, FRA, PO and Job Order | Partly | The Supply & Property Officer sees PRs and POs; PPMP, FRA and JO do not exist | Add those documents (a JO as a PO for services) and give access through the Roles & permissions editor | M |
| PL-114 | IAR | NOD first, then the IAR by the Inspection Committee and/or SMO | Partly | The supply officer makes the IAR and types the inspector's name (`POST /api/finance/iars`) | A NOD record; an inspection permission so the committee signs the inspection part while the SMO accepts; who does which is a setting | M |
| PL-115 | PO/JO → NOD → IAR | The PO/JO is the main reference; its details flow into the NOD and IAR | Partly | IAR lines come from the PO | The NOD carries the PO lines too | S |
| PL-116 | Project coordination | The provider assigns a representative to work with each office | Not ATLAS | About the provider, not the software. ATLAS can support it: a settings export/import with preview, change history with undo (`server/config.js`), and the in-app guides | Working method: a focal person per office, sign-off on each configured form, the configuration exported and versioned | — |
| PL-117 | Attachments / routing | Uploaded attachments do not follow the document to the next office | Missing | Finance documents take no attachments; uploads exist elsewhere in ATLAS (`server/files.js`, ATLAS Documents) | Attachments on PR, PO, IAR, ORS, DV and liquidations, kept on the document and seen at every step; a configurable checklist of required attachments per transaction type at Box C | M |
| PL-118 | Collections and receipts | Not presented at the rollout | Has | Revenue: O.R. booklets, receipts, RCD and deposit, RAAF (`finance-cash.js`) | Demo it to the Accounting Office and the Cashier's Office | — |
| PL-119 | PPMP > PR | No control stopping a PR from going over the office's PPMP | Missing | No PPMP | Check each PR line against the PPMP balance per item; block or warn, as a setting | M |
| PL-120 | JEV | Daily consolidation of JEVs not demonstrated | Partly | One JEV per RCD (collections), per paid DV, per RSMI and per depreciation run | An optional daily summary JEV per fund and journal (e.g. one day's checks), keeping the detail per document. Confirm with COA first | M |

## Configurability themes

### What ATLAS's configuration center has today

**The settings catalog** (`shared/settings-catalog.js`) has two Finance areas:
- *Finance: entity, funds, offices and banks*;
- *Finance: numbering, taxes and rules*.

**The Admin panel's Settings center** (`server/config.js`) covers both areas. It can:
- search the settings and compare each value with its default;
- reset to the defaults;
- keep a change history with undo;
- export the school's settings as a file, and import one with a preview.

**The Finance Control panel** (`views/control.js`, `PUT /api/finance/settings`) sets:
- entity, fiscal year, fund clusters, offices (code, name, head) and PAPs;
- bank accounts and fees;
- six signatories (name and title);
- the formats of 15 document number series;
- the ATC table;
- thresholds, deadlines and period locks.

It refuses to remove a fund, office, PAP, bank account or ATC that a document already uses.

**Roles & permissions** (`shared/roles.js`):
- changes per account type (`roleOverrides`);
- grants per account (`user.access`);
- some permissions stay with administrators only.

**Hard-coded in `shared/finance.js`:**
- the fund clusters and journals;
- the statuses of every document;
- the modes of procurement and payment;
- the natures of payment;
- the signatory keys;
- the forms and their layouts.

The themes below are mostly about moving these into the center without breaking the rules they enforce.

### 1. Number series (per fund, journal, document or report; reset period; format)
**Items:** PL-10, PL-18, PL-20, PL-38, PL-40, PL-63, PL-64, PL-112, PL-120.

**Today:** `formatNo` and `fx.nextNo` support {F}, {YYYY}, {YY}, {MM} and {N}. A series restarts for each value of the tokens it contains. Admin numbering (`shared/numbering.js`) also validates formats (`formatProblem`) and skips numbers already used.

**Add:**
- a reset period separate from the format (never, yearly, monthly);
- a {J} journal token and a campus token;
- the fund passed to every series;
- separate `burs` and report series;
- the same `formatProblem` validation for Finance formats.

**Must stay fixed:** issued numbers are never reused or edited, and gaps are explained (COA). The format can change only for numbers not yet issued.

### 2. Signatories by role, not by person
**Items:** PL-23, PL-37, PL-41, PL-46, PL-49, PL-106.

**Today:** six fixed keys (head, accountant, budget, cashier, supply, inspector) with a typed name. Signed documents keep who actually signed (`certifiedBy`, `approvedBy`). Offices have a Head column that is printed nowhere.

**Add:** each form's signature slot gets a rule:
- a role key;
- the head of the preparer's office;
- whoever holds a permission;
- a named person.

The rule is resolved at print time and frozen once the document is signed. A case style (uppercase) is set per template.

**Must stay fixed:** the Box C and Box D signers, and separation of duties.

### 3. Report periods and report templates
**Items:**
- periods: PL-36, PL-39, PL-45, PL-53, PL-54;
- templates: PL-34, PL-44, PL-47–PL-50, PL-95, PL-105, PL-13.

**Today:** each report has its own selector: month (RSMI, taxes), quarter (alphalist), as-of date (TB, aging), range (ledger, statements) or year (SAAODB). Some reports export CSV. There is no template layer.

**Add:**
- one period picker (day, month, quarter, year, range) for every register-type report;
- report templates: title, optional columns, signature block, header and logo;
- Excel export.

**Must stay fixed:** the columns and certifications COA, DBM or BIR prescribe (ACIC, RAAF, FARs, 2307). Removing one needs the auditor's written agreement, so the template should mark which columns are optional.

### 4. Funds and modes of payment
**Items:** PL-02, PL-11, PL-42, PL-51, PL-56, PL-57, PL-75, PL-99.

**Today:**
- seven GAM clusters, each switched on or off;
- bank accounts and fees per cluster;
- ORS for 01, BURS for the others;
- four fixed payment modes;
- the cash account chosen in code (01 and 07 pay through the MDS, other funds through their bank account);
- one set of books per cluster for the whole institution (no campus books).

**Add:** funds under a cluster, each with:
- its code (CBSUA uses 101, 161, 163 and 164), name and campus;
- its bank accounts, each flagged MDS/government servicing bank or commercial;
- the modes of payment it allows (check, ADA, Authority to Debit/Credit).

The books and reports stay per cluster, with sub-fund filters.

**Must stay fixed:**
- ORS vs BURS by cluster (JC 2013-1);
- one LDDAP-ADA per cluster.

### 5. Lookup lists without duplicates
**Items:** PL-11 (fee categories), PL-33, PL-35, PL-43, PL-74, PL-96, PL-107.

**Today:** journals, statuses, modes and natures are constant arrays. Offices, PAPs and ATCs refuse duplicate codes. Units of measure and delivery terms are free text.

**Add:** one generic lookup list (unique code, label, active, order). Where the code depends on an entry, it is mapped to a fixed internal meaning: a status label maps to an internal state, a journal to a GAM book. Every lookup that drives logic keeps its internal values; only labels and optional entries change.

### 6. Procurement planning documents and versions (indicative, amended, supplemental)
**Items:** PL-04, PL-22, PL-24, PL-25, PL-26, PL-27, PL-28, PL-113, PL-119.

**Today:** nothing; procurement starts at the PR.

**Add:**
- PPMP per office and year, and APP consolidated from the PPMPs;
- a version type lookup (Indicative, Final, Amended, Supplemental) with history;
- a yearly CSE price list;
- a setting for how strictly a PR is checked against the PPMP (off, warn, block).

This is the largest single gap in the list.

### 7. Workflow stages, routing and attachments
**Items:** PL-05, PL-09, PL-33, PL-35, PL-55, PL-114, PL-117.

**Today:**
- fixed state machines: PR → PO → ORS → IAR → DV Boxes A–E;
- separation-of-duties checks in the server;
- notifications through the bell;
- an audit trail.

**Add, per document type:**
- configurable steps (step name, who acts by permission or office head, an amount threshold, optional or required);
- a routing log with "received" timestamps per office;
- attachments that travel with the document, and a required-attachments checklist per transaction type;
- procurement stages per mode of procurement (RFQ, abstract, resolution, award, PO, NOD, IAR).

**Must stay fixed:** steps can be added but the legal ones cannot be removed or reordered:
- Box B before a PO is approved;
- Box C, then Box D, by different people;
- the requester never approves.

### 8. Budget per office and organization levels
**Items:** PL-03, PL-08, PL-12, PL-13, PL-19.

**Today:** allotments per fund, PAP and class; offices are a flat list.

**Add:**
- an office hierarchy (division → unit);
- allocations per office under each allotment;
- an optional line-item budget by object code;
- alert thresholds;
- the FRA printed from the allocations.

## Missing forms and reports

| Form or report | Asked in | What ATLAS has today |
|---|---|---|
| Inventory and Inspection Report of Unserviceable Semi-Expendable Property (IIRUSP) | PL-109 | Disposal with an IIRUP number; no printed IIRUP or IIRUSP |
| Registry of Semi-Expendable Property Issued (RegSPI) | PL-110 | ICS issues in each item's history |
| Report of Semi-Expendable Property Issued (RSPI) | PL-111 | Same data, no report |
| Return slip for equipment and semi-expendable items | PL-112 | Return recorded, no form |
| RAAF covering checks (monthly) | PL-44, PL-45 | RAAF for O.R. booklets only, with no period |
| FAR No. 1-A, FAR No. 2, FAR No. 2-A | PL-14 | FAR No. 1 (SAAODB), FAR No. 3, RAOD, SCBAA |
| Monthly Report of Disbursements (FAR No. 4) / Report of Disbursement for Fund 101 | PL-54 | Journal lists only |
| Fund/Resource Allocation (FRA) | PL-13, PL-113 | None (no budget per office) |
| Statement of Cash Flows | PL-94 | None |
| Statement of Changes in Net Assets/Equity | PL-92, PL-93 | None |
| Notes to the Financial Statements | PL-94 | None |
| Alphalist of Taxes Withheld (monthly, all taxes including compensation) | PL-105 | Monthly summary by ATC, quarterly alphalist of payees, BIR 2307 |
| Report of Checks Issued (RCI, App. 35) | PL-36, PL-38 | None |
| Report of ADA Issued (App. 13) | PL-39, PL-40 | LDDAP-ADA lists |
| Advice of Checks Issued and Cancelled (ACIC, App. 39) | PL-47–PL-51 | None |
| Cancelled checks report; Request and Notice of Check Cancellation | PL-34, PL-35 | Voids recorded on the DV |
| Unreleased checks report | PL-52, PL-53 | None |
| Authority to Debit/Credit Account (commercial bank funds) | PL-57 | LDDAP-ADA print only |
| Printed books of accounts, including an ADA journal (App. 1–4) | PL-83, PL-96 | On-screen journal list |
| Bank reconciliation statement print with bank-side items (App. 81) | PL-84, PL-85 | Screen print of the reconciliation |
| PPMP and APP (with versions) | PL-04, PL-22, PL-24 | None |
| RFQ, abstract of quotations as a document, BAC resolution / notice of award | PL-05, PL-29 | Optional abstract inside the PO |
| Notice of Delivery (NOD) and NOD summary | PL-102, PL-114, PL-115 | IAR only |
| Job Order | PL-113, PL-115 | A PO with service lines |

**Found while checking:** these forms are numbered or recorded but have no printout in `views/print.js`:
- PTR/ITR;
- IIRUP;
- the Liquidation Report (App. 44);
- the cash advance's Report of Cash Disbursements.

## Questions for CBSUA

The items below need the office's sample format or a decision before anything is built.

1. **Fund codes (PL-42, PL-57, PL-18):**
   - Which GAM fund cluster and which campus does each of CBSUA's funds 101, 161, 163 and 164 belong to?
   - Which bank account is each fund paid from?
   - Which modes of payment does each fund use?
2. **Samples of the cashier's reports (PL-34–PL-54):** the current cancelled checks report, RCI, Report of ADA Issued, RAAF for checks, ACIC, unreleased checks and Report of Disbursement.
   - The Accounting Office and the COA auditor must confirm in writing which ACIC fields (ACIC No., allocation no., object code, signatories) may be dropped.
   - Is the ACIC limited to the government servicing bank's accounts?
3. **Numbering (PL-38, PL-40, PL-63, PL-64):** the exact format of each series, and whether each one resets yearly or monthly.
4. **"Immediate head of office" (PL-37, PL-41, PL-46):** the head of which office?
   - the preparer's office;
   - the Cashier's Office;
   - the requesting office.
5. **Check statuses (PL-33, PL-35, PL-43):**
   - What does each status mean?
   - Who moves a check from one status to the next?
   - Does "Preparation" for an ADA mean that nothing after it is tracked?
6. **Office structure (PL-12, PL-19):**
   - the list of divisions and units;
   - which level the BUS/ORS should carry;
   - whether budgets are allocated per division or per unit.
7. **Budget reports (PL-13, PL-14):** a sample FRA, and the DBM templates the Budget Office submits (FAR 1-A, 2, 2-A).
8. **Financial statements (PL-95, PL-94):** the office's current SFPos, SFPerf, SCNA/E, Trial Balance and Notes. Are statements per fund, consolidated, or both, and are they compared with the prior year?
9. **Procurement planning (PL-04, PL-22–PL-28, PL-119):**
   - the PPMP and APP templates in use;
   - how the versions are approved;
   - where the CSE price list comes from;
   - whether a PR over the PPMP should be blocked or only warned.
10. **Procurement and inspection (PL-05, PL-30, PL-114):**
    - the stages per mode of procurement;
    - what "supplier name blank" on the PO means;
    - who sits on the Inspection Committee, and who signs which part of the IAR.
11. **Approval routes (PL-09):** for PR, PO and DV, the approvers in order, and any amount above which another approval is needed.
12. **Attachments (PL-117):** the documentary requirements per transaction type that the Chief Accountant checks at Box C.
13. **Taxes (PL-105):** the "Alphalist of Taxes Withheld" sample. Must it include compensation tax from payroll, and is a BIR file format expected?
14. **Daily consolidation and journals (PL-96, PL-120):** has COA agreed to one summary JEV per day? Which journal should liquidations of SDO and payroll advances go to?
15. **SMO forms (PL-109–PL-112):** the versions of the IIRUSP, RegSPI, RSPI and return slip in use, since some COA Circular 2022-004 annex numbers are unconfirmed (`docs/finance/RESEARCH-RULES.md`).
