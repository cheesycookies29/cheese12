# Round 1: Controller (Philippine government accounting, budget and treasury)

**Core position.** Most of the 120 FMIS items reduce to five mechanisms: number series, funds under a
cluster, form templates, workflow steps with attachments, and lookup labels. Each has a fixed legal core
and a configurable shell. Build the shell, keep the core in code where no administrator can reach it,
and build only after the earlier council's three Finance gates. Scope the first build to what a
Fund 05 pilot actually uses. FMIS item IDs are as in `../matrix/fmis.md`.

## 1. Fixed versus configurable

| Area | Fixed (authority) | Configurable | Items |
|---|---|---|---|
| Chart of accounts | Revised Chart codes, normal balances and groups (GAM Vol. III, COA Circ. 2020-001). Default accounts can be hidden but not deleted. No inactivation while an account has a balance | Added accounts under a valid major group, deletable while never posted. UACS sub-objects as added accounts (FINANCE-PLAN §5.2). Heading shading | PL-65–68 |
| Obligation | ORS for cluster 01, BURS for 05/06/07 (COA-DBM JC 2013-1 as amended; `obligationForm`). One ORS/BURS belongs to one fund cluster. Box B certifies against the **legal allotment** | Separate `ors` and `burs` series. A multi-fund request is split into linked ORS/BURS, one per fund. Office allocations under the allotment (off, warn or block) | PL-10, 12, 20, 99 |
| Funds | The seven UACS clusters (`FUND_CLUSTERS`) drive the books, ORS/BURS, FARs and statements | Funds under a cluster: local code (101, 161, 163, 164), campus, bank accounts flagged MDS, AGDB or commercial, allowed payment modes | PL-42, 51, 57, 75 |
| Journals | The GAM books: GJ, CRJ, CDJ and CkDJ (App. 1–4), plus the ADA Disbursement Journal (App. 52, missing from `JOURNALS`). "Purchase" and "Sales" are not NGA books | Labels. Which book a source posts to, where the GAM allows a choice (PL-96 needs the auditor's view) | PL-74, 83, 96 |
| Numbers | An issued number is never edited, reused or removed. Numbers are assigned at posting, obligation or issue, never at draft (`jevNo` stays empty until posting, `server/finance.js`). A cancelled document keeps its number | Format; tokens {F}, {J} and campus; a reset period (never, yearly, monthly). A change takes effect only from the next reset boundary | PL-18, 38, 40, 63, 64 |
| Forms | Prescribed columns and certifications: GAM Vol. II appendices, COA Circ. 2022-004 annexes, DBM FAR layouts | Letterhead, paper, columns the template marks optional, signatory rules, case style | PL-34, 47–50, 95, 106 |
| Workflow | Box B before the PO is approved. Box C, then Box D, by different people. The requester never approves. Different people sign the inspection and acceptance parts of the IAR | Steps added in front of these, a "received" log, the required-attachments checklist | PL-05, 09, 55, 114, 117 |

Configuration that affects the books (numbering, chart, signatories, templates) is set by the
administrator but takes effect only when the Chief Accountant approves it, with an effective date. That
is how the earlier condition "administrators lose transactional powers" applies to configuration.

## 2. Budget execution (DBM)

- **FAR No. 1 (SAAODB)** exists. **FAR 1-A** (App. 18) regroups ORS lines by object code. **FAR 2/2-A**
  (App. 20/21) applies the same engine to BURS against the Board-approved budget, and is what a Fund 05
  pilot needs. **FAR 4 MRD** (App. 23) is PL-54. All of them need Excel export in the URS layouts (PL-14).
- **The FRA** (PL-13) is CBSUA's internal form, not a DBM report. Print it from the office allocations
  (PL-12). An allocation is a management limit below the allotment and never replaces Box B.
- **PL-101/PL-98:** the matrix would let the DV preparer change the debit "with the ORS line still
  charged". That leaves RAOD/RBUD by object code disagreeing with the ledger, and FAR 1-A disagreeing with
  the SFPerf. Allow the change only within the same allotment class, and have ATLAS prepare the
  object-code NORSA/NBURSA (App. 12/15) for the Budget Officer to sign. The registry and the books then
  still tie.

## 3. Treasury

- **Checks become accountable forms** per bank account, issued from booklets as O.R.s are (PL-31).
  - The internal states are fixed: on hand → prepared → signed → released (Box E) → cleared (by the bank
    reconciliation), cancelled or stale.
  - Cancellation takes two steps: the cashier requests it, the accountant approves it, and the notice
    prints (PL-35).
  - CBSUA's labels (Preparation, Approval, Releasing, Cancelled) map onto these states (PL-33, PL-43).
- **The check register feeds these reports:**
  - the RCI (App. 35) per bank account and fund, for a day, month or year (PL-36);
  - the RAAF (App. 67), monthly by cluster, for O.R.s, checks and LDDAP-ADA forms: beginning, received,
    issued and ending (PL-44, PL-45);
  - the unreleased checks and cancelled checks reports (PL-52, PL-34).
- **MDS only:**
  - the ACIC (App. 39), the Report of ADA Issued (App. 13), the SLIIE (App. 53) and the LDDAP-ADA;
  - the ACIC goes to the servicing bank, so refuse removing its columns (PL-47–50) without written
    agreement from the COA auditor and the bank;
  - the bank-account flag (PL-51) decides which accounts these reports include.
- **Funds 161, 163 and 164** use the Authority to Debit Account in the bank's format (PL-57), with no
  LDDAP (PL-42).

## 4. Procurement (RA 12009 and its 2025 IRR)

**The chain:**
1. PPMP (indicative, then final, with amended and supplemental versions);
2. APP, approved by the head of the procuring entity;
3. PR (App. 60);
4. RFQ, with no supplier named;
5. abstract of quotations;
6. BAC resolution and notice of award;
7. PO (App. 61) or JO;
8. NOD;
9. IAR (App. 62).

For Small Value Procurement, at least three quotations are requested and one responsive quotation is
enough (IRR §34, per `docs/finance/RESEARCH-RULES.md`).

**PR within the PPMP (PL-27, PL-28, PL-119):**
- The approved APP is the authority to procure. Once planning is switched on, "PR needs a PPMP line"
  cannot be turned off.
- A PR line above the amount left on its PPMP item is **blocked**.
- A difference in quantity or specification only **warns**, and needs a reason.
- The way out is an amended or supplemental PPMP, not an override.
- Until planning exists in ATLAS, the PR carries a typed APP reference.
- The BAC Secretariat should confirm the IRR section.

**Other rules:**
- An approved PO names its supplier; only a draft PO may leave it blank (PL-30).
- The NOD carries the PO lines (PL-115).

**Timing:** this is L effort. Time it to the next PPMP cycle, not the middle of a year.

## 5. Semi-expendable property (COA Circ. 2022-004)

- The IIRUSP, RegSPI, RSPI and return slip (PL-109–112) print from data ATLAS already holds: ICS
  issues, returns and disposals. Each is S effort and low risk.
- Annex numbers other than A.2 and A.4 are unconfirmed (`RESEARCH-RULES.md` D3), so use CBSUA's copies
  as the templates.
- The PTR/ITR, IIRUP and Liquidation Report have no printout either.

## 6. Bank reconciliation and statements

**Bank reconciliation:**
- The BRS is App. 80 for MDS accounts and App. 81 for AGDB accounts. `APPENDIX.brs` has only 81.
- Add:
  - bank-side items: charges, interest, credit memos and dishonored checks (App. 25);
  - statement import;
  - a draft adjusting JEV in the GJ;
  - a signed reconciliation that freezes (PL-84, PL-85).
- A cleared check closes in the check register.

**Financial statements (GAM Vol. I Ch. 19, PPSAS):**
- SFPos, SFPerf and SCBAA exist.
- Add the SCNA/E (PL-92), the Statement of Cash Flows by the direct method (PPSAS 2), and the Notes as a
  template filled from schedules (PL-94).
- Each statement is per cluster and consolidated, with the prior year.
- The tie checks are fixed:
  - SCNA/E closing equity equals SFPos equity;
  - the change in cash on the SCF equals the change in cash on the SFPos.
- Needed before the pilot's first year-end submission to COA (February 14), not at go-live.

## 7. The control requests

| Request | Answer |
|---|---|
| Delete posted or cancelled entries (PL-77, PL-79) | **Refuse.** Drafts, which have no number yet, can be deleted. Posted entries are reversed, and the number series stays gap-free. Cancelled and reversed entries can be hidden from the default lists, which deals with the clutter the request is really about |
| Restore cancelled JEVs (PL-71, PL-78) | **No reopening.** "Copy as a new draft" gets a new number on posting, with links both ways. After statements are issued, a correction is a prior-period entry through Accumulated Surplus (PPSAS 3) |
| One ORS, many DVs (PL-100) | **Has.** Keep the cap: vouchers, including unpaid ones, never exceed the obligation line (`pendingByLine`). Add a "final payment" that prepares the NORSA/NBURSA releasing what is left |
| PR within the PPMP (PL-119) | Block on amount; see §4 |
| Attachments travel (PL-117) | **Build it for the pilot.** A checklist per transaction type from COA Circ. 2012-001, kept by the Chief Accountant. Files lock at Box C (hashed), can be replaced only with a reason, and are never deleted. Paper originals still go to the auditor unless COA agrees otherwise |

Reopening a closed month should be the Chief Accountant's alone, with a reason, and never once the year
is closed.

## 8. Order of work

0. **Gates, not features:**
   - the `node:sqlite` store;
   - a synchronous commit in place of `finSnap` (`server/api.js`), with a test that a failed request
     leaves no gap in any number series;
   - administrators without transactional powers;
   - the FINANCE-PLAN §5 confirmations;
   - the retention matrix.

   Finish the AWS move before any Finance data is loaded, so the opening balances are loaded once.
1. **Decisions and samples** (no code).
2. **Shared mechanisms:** number series, funds under clusters, the journal list, signatory rules, and the
   template, period and Excel layer, which People and Academic also need.
3. **The Fund 05 pilot set:**
   - the check register and cancellation, RCI and RAAF;
   - attachments;
   - the App. 81 BRS and FAR 2/2-A;
   - the opening-balance import (PL-01), copy-as-draft and the draft liquidation JEV (PL-80);
   - the SMO printouts;
   - then one parallel month.
4. **Before the pilot's year-end:** SCNA/E, SCF, Notes and the Alphalist (PL-105).
5. **Wave 2:**
   - Fund 01: MDS, NCA, ACIC, App. 13, SLIIE, FAR 1-A and FAR 4;
   - office budgets and the FRA;
   - approval routes;
   - the PPMP-to-IAR chain.

   PL-14 (in part), PL-39–41, PL-47–51, PL-54 and PL-56 are Fund 01 items, which takes about a dozen
   items out of the pilot.

**Cost to the close:** each sub-fund adds a trial balance review, and each extra approval step adds days
before Box C.

## 9. What CBSUA must provide

- **The fund map:** cluster, campus, bank and payment modes for 101, 161, 163 and 164. Also whether the
  campuses are operating units with books of their own (GAM CO/OU, with Due to/Due from eliminated on
  consolidation) or a dimension of one set of books.
- **At cut-over:** the audited closing trial balance; the registries (unpaid obligations, allotment
  balances); check and O.R. stock; outstanding cash advances; the property register.
- **Samples:** the reports in the matrix's questions 2, 7, 8 and 15.
- **The COA auditor's written positions** on the ACIC fields, the daily summary JEV (PL-120) and the
  liquidation journal (PL-96).

## 10. Working method

- **Sign-off on each configured form:**
  - the head of the office that owns it;
  - also the Chief Accountant, if the form posts or is prescribed by COA;
  - also the Budget Officer for ORS/BURS and FARs;
  - also the BAC Secretariat for procurement forms;
  - and the auditor's written agreement for any change from a prescribed format.
- **Testing:**
  - each form has a test pack of scripted transactions with the expected JEVs, registry balances and
    report totals, written in advance;
  - it must tie: the trial balance balances, the BURS registry equals FAR 2, and cash per books equals
    the BRS;
  - one parallel month is reconciled by close +5.
- **Versioning:**
  - the configuration is exported (Settings center), with an effective date and the approver;
  - every issued document keeps the template version and the signatories as they were when it was
    signed.

## Top 5 next steps (6–8 weeks)

1. **Close the gates** (weeks 1–4): the storage move, a synchronous commit with a no-gap numbering test,
   and administrators without transactional powers. No Finance item is built before these are done.
2. **Collect CBSUA's decisions and samples** (weeks 1–3):
   - the fund map and the decision on campus books;
   - the number formats and the cut-over date with the closing trial balance;
   - the report samples and the documentary requirements;
   - the COA auditor's written positions.
3. **Build number series and funds under clusters** (weeks 3–6):
   - the {J} and campus tokens, the `burs` key and the fund passed to every series;
   - a reset period that applies only at the next boundary, and `formatProblem` for Finance formats;
   - ORS/BURS by cluster kept fixed.
4. **Build the shared template, period and export layer** (weeks 4–8):
   - columns marked prescribed or optional;
   - signatory rules frozen at signing;
   - the RCI, RAAF and SMO printouts as its first uses.
5. **Specify the Fund 05 pilot and its test pack** (by week 8):
   - the check register, attachments, the App. 81 BRS, FAR 2/2-A and the opening import;
   - the parallel month and its tie-out criteria;
   - Fund 01 and PPMP/APP left to wave 2.
