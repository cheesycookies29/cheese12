# Philippine NGA / SUC FMIS: Rules and Forms Reference (as of Nov 2026)

Compiled 2026-11-06. Scope: a State University/College (SUC), which is a national government agency (NGA).

**Confidence tags**
- **[OFFICIAL]**: read directly in an official document (BIR CDN PDF, GPPB site/PDF, GAM Vol. II TOC hosted by BTr).
- **[SECONDARY]**: two or more consistent secondary sources (Big-4 / law-firm alerts, agency memos quoting the rule, ERP vendor ATC tables). The official text was not opened.
- **[MEMORY]**: from general knowledge of the GAM/COA forms and consistent with what I found, but no source text was opened. Verify before hard-coding.
- **UNVERIFIED**: could not be confirmed, or sources conflict.

Access notes: dbm.gov.ph returned 503 / TLS errors from this environment, and coa.gov.ph and officialgazette.gov.ph returned 403. The DBM and COA primary texts (JC 2019-1, NBC 599, GAM Vol. I, COA Circular 2022-004) were therefore not read directly. bir.gov.ph is a JS app, but its CDN PDFs were readable.

---

## A. BIR withholding by government offices on payments to suppliers

### A1. Expanded (creditable) withholding tax (EWT): rates and ATCs

**Key correction.** WI158/WC158 and WI160/WC160 are the *Top Withholding Agent* (TWA, private) codes. Government offices and GOCCs use **WI640/WC640 (goods, 1%)** and **WI157/WC157 (services, 2%)**. [SECONDARY: NetSuite PH ATC table with BIR descriptions. Rates confirmed by BIR MOMD slides at PAGBA, Nov 2023.]

| Payment | Payee | ATC | Rate | Basis / notes |
|---|---|---|---|---|
| Govt/GOCC purchase of **goods** (local/resident supplier) | Individual | **WI640** | 1% | RR 2-98 §2.57.2 as amended by RR 11-2018 (TRAIN) |
| same | Corporate | **WC640** | 1% | |
| Govt/GOCC purchase of **services** | Individual | **WI157** | 2% | |
| same | Corporate | **WC157** | 2% | |
| TWA goods (NOT for government) | Ind / Corp | WI158 / WC158 | 1% | for private TWAs only |
| TWA services (NOT for government) | Ind / Corp | WI160 / WC160 | 2% | for private TWAs only |
| Professional / talent fees, gross income ≤ ₱3M (and not VAT-registered) | Individual | **WI010** | 5% | RR 11-2018. Payee submits sworn declaration (Annex B-1/B-2) and COR (2303) by Jan 15 or before first payment |
| Professional fees, gross income > ₱3M **or** VAT-registered | Individual | **WI011** | 10% | |
| Professional fees, gross income ≤ ₱720,000 | Corporate | **WC010** | 10% | Annex B-3 sworn declaration |
| Professional fees, gross income > ₱720,000 | Corporate | **WC011** | 15% | |
| Rentals: real property used in business; personal property > ₱10,000/yr; poles, satellites, billboards | Ind / Corp | **WI100 / WC100** | 5% | |
| Income payments to certain contractors (general engineering, general building, specialty, other contractors) | Ind / Corp | **WI120 / WC120** | 2% | Use for infrastructure contracts instead of WC157 |

- Payor also executes the Annex C sworn declaration (professional-fee payors) and files it with BIR by **Jan 31**. [OFFICIAL-ish: BIR MOMD slides]
- **₱10,000 threshold for government: UNVERIFIED.** A BIR regional reminder (Negros Now Daily) says single purchases of ₱10,000 or less by government offices are exempt from the 1%/2% withholding. I could not confirm this in the RR 11-2018 text. The ₱10,000 / "regular supplier" (≥6 transactions) rule is a TWA concept. Make it a configurable flag, default OFF (withhold regardless of amount), until checked with the SUC's RDO.
- **Time of withholding.** RMC 47-2023 (for NGAs, LGUs, GOCCs) said tax is withheld when the income is paid or payable, or accrued/recorded as expense or asset, whichever comes first. [OFFICIAL-ish: BIR MOMD slides] **EOPT (RA 11976) / RR 4-2024** changed the obligation to arise when the income "becomes payable" (due, demandable or legally enforceable). [SECONDARY: PwC, Grant Thornton] RR 4-2024 also repealed withholding as a condition for expense deductibility (NIRC §34(K)); that point is irrelevant to an NGA. Design note: compute withholding at ORS/DV (payable) stage, not at check release.
- **Officers liable** for late remittance (RMC 23-2012): for NGAs/SUCs, the Chief Accountant and the Head of Office. [OFFICIAL-ish: BIR slides]

### A2. Withholding VAT by government

- **Rate: 5% of gross payment, CREDITABLE (not final).** It became creditable on **1 Jan 2021** under TRAIN (RA 10963 §37 amending NIRC §114(C)) and was implemented by **RMC 36-2021** (5 Mar 2021). The 5% FINAL regime of RR 13-2018 applied only up to 31 Dec 2020. [SECONDARY: KPMG, Grant Thornton, Roque Law, multiple]
- **EOPT (RA 11976, effective 22 Jan 2024; RRs 3/4-2024 effective ~26/27 Apr 2024) did NOT create the creditable system; TRAIN did.** I found no EOPT amendment to the 5% rate. **UNVERIFIED** whether EOPT changed any §114(C) wording.
- **ATCs:** **WV010** = VAT withheld on purchase of goods (5%); **WV020** = purchase of services (5%). For non-resident payees, government agents use WV040 (12% VAT withholding from non-residents) and WV060 (final VAT on services by non-residents, 12%). [SECONDARY]
- **Certificate:** **BIR Form 2307** (Certificate of Creditable Tax Withheld at Source). **Form 2306 is no longer issued for government VAT withholding** (RMC 36-2021). Suppliers claim the 2307 in their VAT return (2550Q), not the ITR.
- **Remittance:** **BIR Form 1600-VT** (Monthly Remittance Return of VAT Withheld), due the **10th of the following month**. NGAs e-file and e-pay. A **Monthly Alphalist of Payees (MAP)** goes with the 1600. [OFFICIAL: BIR RMC 89-2026 lists "1600-VT and/or 1600-PT and 1601-C – NGAs" with due date Aug 10, 2026 for July 2026, and "MAP" for 1600]
- 2307 for VAT/PT withheld is issued monthly (PwC calendar: "Issuance of 2307 (VAT/PT withheld) for Jan 2026 – Feb 10"). [SECONDARY]
- Purchases from CREATE MORE registered business enterprises (RR 9-2025): one secondary source says government withholds **12%** VAT on such purchases. **UNVERIFIED.** Edge case; keep it configurable.

### A3. Percentage tax withholding (non-VAT suppliers)

- **3%** of gross payment to non-VAT suppliers (NIRC §116 rate), creditable. [SECONDARY]
- CREATE (RA 11534) cut the §116 rate to **1% from 1 Jul 2020 to 30 Jun 2023**. **Back to 3% from 1 Jul 2023.** [SECONDARY]
- **ATC:** **WB080** = "Persons exempt from VAT under Sec. 109(BB) (creditable) – Government Withholding Agent", 3% (WB082 is the private-agent equivalent). [SECONDARY: NetSuite table, which says "108BB", likely garbled] **UNVERIFIED** against the current BIR ATC list.
- **Form:** **1600-PT** (Monthly Remittance Return of Other Percentage Taxes Withheld), due the 10th of the following month. Certificate: **2307**. [OFFICIAL: RMC 89-2026 lists 1600-PT]

### A4. Forms and deadlines (current, confirmed still in use Aug 2026)

| Form | What | Due (NGA) | Status |
|---|---|---|---|
| **0619-E** | Monthly Remittance Form of Creditable Income Taxes Withheld (Expanded): months 1 and 2 of each quarter | 10th of following month (non-eFPS); eFPS staggered 11th–15th by group. Under RR 1-2013, NGAs are excluded from staggered filing, so the 10th applies | **Still in use; NOT abolished** [OFFICIAL: RMC 89-2026, Aug 2026] |
| **1601-EQ** | Quarterly Remittance Return of Creditable Income Taxes Withheld (Expanded): month 3 plus quarterly reconciliation; with **QAP** (Quarterly Alphalist of Payees) | Last day of month after quarter (e.g., Q4 2025 → Feb 2, 2026 because Jan 31 was a Saturday) | In use [SECONDARY: PwC 2026 calendar] |
| **0619-F / 1601-FQ** | Final withholding taxes, monthly / quarterly | Same pattern as 0619-E / 1601-EQ | In use [OFFICIAL: RMC 89-2026 for 0619-F] |
| **1601-C** | Monthly Remittance Return of Income Taxes Withheld on Compensation | 10th of following month; December due Jan 15 | In use [OFFICIAL: RMC 89-2026] |
| **1600-VT / 1600-PT** | Monthly VAT / percentage tax withheld (+ MAP) | 10th of following month | In use [OFFICIAL] |
| **2307** | Certificate of Creditable Tax Withheld at Source (EWT, VAT, PT) | EWT: within 20 days after close of quarter, or on payee's request with payment (RR 2-98 §2.58). VAT/PT: monthly | [MEMORY for 20-day rule; SECONDARY for VAT/PT] |
| **2306** | Certificate of Final Tax Withheld | For final taxes (e.g., 0619-F/1601-FQ items). Not for govt VAT since 2021 | |
| **2316** | Certificate of Compensation Payment/Tax Withheld | To employees by Jan 31. Employer submits copies to BIR by Feb 28 | [SECONDARY] |
| **1604-C** | Annual Information Return, Compensation, + alphalist of employees | Jan 31 | [SECONDARY] |
| **1604-E** | Annual Information Return of Creditable Income Taxes Withheld (Expanded) + alphalist | Mar 1 | [SECONDARY] |
| **SAWT** | Summary Alphalist of Withholding Taxes | Prepared by the **payee** (supplier) to support its return. The SUC produces 2307s and QAP/MAP, not SAWT. SAWT matters only for the SUC's own income from which others withheld (rare) | [MEMORY] |
| **2550Q** | Quarterly VAT return | Relevant to the **supplier** (credits the 5% WV), not to the SUC as payor | |

- **eFPS / eBIRForms:** RR 1-2013 requires NGAs to **e-file via eFPS** and pay the same day.

### A5. Tax Remittance Advice (TRA / eTRA): constructive remittance

- **DOF-DBM-COA Joint Circular No. 1-2000** created the **TRA**. It is a serially numbered DBM-prescribed document used by NGAs to remit taxes withheld on **DBM-sourced funds (NCA/MDS)**, replacing cash remittance, MDS checks and ADA. [SECONDARY via RR 1-2013 background]
- **RR 1-2013** (23 Jan 2013): NGAs must use the **eTRA** (TRA filed online through eFPS).
  - The TRA is certified by the Chief Accountant, approved by the head of agency, and attached to each withholding return.
  - **eTRA covers only liabilities from DBM-sourced funds.** Taxes withheld from **other funds (e.g., the SUC's STF/IGF in its AGDB account) are paid in cash through the AAB/bank-debit system, with a separate return per fund** (separate branch code).
  - Staggered eFPS filing does not apply to NGAs.
  - Returns covered: 1601-C, 1601-E (now 0619-E/1601-EQ), 1601-F, 1603, 1600, and others.
  - Follow-on issuances: RMO 30-2014 (uniform eTRA procedures), RMC 57-2014 (clarifications), RMO 23-2014 (consolidated withholding obligations of government offices). [SECONDARY: lawyerly/eLibrary text of RR 1-2013]
- FMIS design consequence: the tax-remittance module needs **two paths**:
  1. **Fund 01 (Regular Agency Fund, NCA):** TRA/eTRA. Constructive remittance: DBM issues NCA for TRA and BTr credits BIR. GAM account "Cash – Tax Remittance Advice" exists in the RCA; exact UACS code is **UNVERIFIED**.
  2. **STF/IGF/BRF/Trust funds:** actual payment through the AAB (bank debit / LBP Link.BizPortal / eFPS ePayment).

---

## B. DBM budget execution (NGAs/SUCs)

### B1. Authorities and documents

- **GAA**: the annual appropriation law. The **FY 2026 GAA took effect 5 Jan 2026**. The FY 2025 GAA was deemed re-enacted until 4 Jan 2026. **NBC No. 599** (5 Jan 2026) = "Guidelines on the Release of Funds for FY 2026". **NBC 603-2026** (May 2026) ordered a review of remaining FY 2025 appropriations. [SECONDARY: DBM X post, search extracts]
- **GAA-as-Allotment Order (GAAAO) / Agency Budget Matrix (ABM)**: items in the ABM not needing clearance are deemed released on GAA effectivity. [MEMORY: established practice since FY 2018–2019]
- **SARO** (Special Allotment Release Order): for items needing clearance. **GARO** (General Allotment Release Order): comprehensive release to all agencies for a purpose (e.g., PS adjustments). **SAA** (Sub-Allotment Advice): central office → ROs/OUs. [MEMORY]
- **NCA** (Notice of Cash Allocation): cash authority credited to the agency's MDS sub-account at the MDS-GSB, spent via check or **LDDAP-ADA**. **NTA** (Notice of Transfer of Allocation): CO → OU transfer of NCA. **NCAA** (Non-Cash Availment Authority) and **CDC** (Cash Disbursement Ceiling) also exist. [MEMORY; GAM App. 30 RANCA and App. 31 RANTA confirm NCA/NTA registries: OFFICIAL]
- **Allotment classes:** **PS** (Personnel Services), **MOOE** (Maintenance and Other Operating Expenses), **FE** (Financial Expenses), **CO** (Capital Outlays). [OFFICIAL: GAM App. 9-A..D / 10-A..D are split this way]
- **UACS**: COA-DBM-DOF JC 2013-1 (6 Aug 2013) as amended (fund-cluster codes by JC 2014-1 / 2016). Fund clusters [MEMORY, verify]:
  - 01 Regular Agency Fund
  - 02 Foreign Assisted Projects Fund
  - 03 Special Account – Locally Funded/Domestic Grants
  - 04 Special Account – Foreign Assisted/Foreign Grants
  - 05 Internally Generated Funds
  - 06 Business Related Funds
  - 07 Trust Receipts

  SUCs report FAR 2 by **IGF and BRF** and FAR 5 by **IGF, BRF, TRF** (EVSU FY 2025 postings).

### B2. ORS vs BURS (COA-DBM JC 2013-1, 15 Mar 2013, as amended by JC 2014-1 and JC 2019-1)

- **ORS (Obligation Request and Status), GAM Appendix 11**: used by requesting offices against approved allotments under the GAA and other budget laws, i.e., **Fund Cluster 01 / GAA funds**. Maintained by fund cluster. **NORSA** (Notice of ORS Adjustment), Appendix 12. [OFFICIAL: GAM Vol II TOC]
- **BURS (Budget Utilization Request and Status), GAM Appendix 14**: for **off-budget and custodial funds** (SAGF, Internally Generated Funds, Business-Related Funds, Trust Funds). For an SUC this means STF income (tuition/IGF, BRF, trust receipts). **NBURSA**, Appendix 15. [OFFICIAL: GAM TOC]
- ORS layout [MEMORY, consistent with DepEd processing guides]:
  - Header: Serial No. (format fund cluster-yyyy-mm-nnnn), Date, Fund Cluster, Payee, Office, Address.
  - Lines: Responsibility Center, Particulars, MFO/PAP, UACS Object Code, Amount.
  - **Box A**: "Certified: Charges to appropriation/allotment are necessary, lawful and under my direct supervision; and supporting documents valid, proper and legal." Signed by the Head, Requesting Office / Authorized Representative.
  - **Box B**: "Certified: Allotment available and obligated for the purpose/adjustment necessary as indicated above." Signed by the Head, Budget Division/Unit / Authorized Representative.
  - **Section C, Status of Obligation**: Date, Particulars, Reference doc (ORS/JEV/Check/ADA/TRA No.), Amount: Obligation (a), Payable (b), Payment (c); Balance: Not Yet Due (a–b), Due and Demandable (b–c).
  - BURS has the same layout, with "budget utilization" wording and Box B certifying "Budget available and utilized…".

### B3. Registries (GAM Vol. II) [OFFICIAL: GAM TOC]

| Registry | GAM App. | Maintained by |
|---|---|---|
| **RAPAL**: Registry of Appropriations and Allotments | 8 | Budget; separate registry for prior-year appropriations |
| **RAOD**: Registry of Allotments, Obligations and Disbursements: PS / MOOE / FE / CO | 9-A / 9-B / 9-C / 9-D | Budget; by appropriation act, fund cluster, MFO/PAP |
| **RBUD**: Registry of Budget, Utilization and Disbursements: PS / MOOE / FE / CO | 10-A / 10-B / 10-C / 10-D | Budget; for off-budget funds (BURS side) |
| **RANCA**: Registry of Allotments and NCA | 30 | Accounting; allotments not covered by NCA and available NCA |
| **RANTA**: Registry of Allotment and NTA | 31 | Accounting |
| Registry of Revenue and Other Receipts – Summary | 7 | |

- "RAODCO" is not a separate registry. It is **RAOD–CO (App. 9-D)**.

### B4. Budget and Financial Accountability Reports (BFARs): COA-DBM JC No. 2019-1 (1 Jan 2019)

Governing circular: **COA-DBM Joint Circular No. 2019-1**, which modified the BFAR formats with the adoption of the Cash Budgeting System. It supersedes the JC 2013-1 / 2014-1 formats. Submission is via the **DBM Unified Reporting System (URS)** (DBM Circular Letter 2024-5, 27 Feb 2024, reiterates). [SECONDARY]

Current titles as posted by an SUC (EVSU, FY 2025), cross-checked with the GAM 2015 appendix numbers:

| Report | Title (current usage) | GAM 2015 App. | Frequency / due |
|---|---|---|---|
| **BAR No. 1** | Quarterly Physical Report of Operation (QPRO), against the Physical Plan (BED No. 2) | 16 | Quarterly, within 30 days after quarter end |
| **FAR No. 1** | Statement of Appropriations, Allotments, Obligations, Disbursements and Balances (**SAAODB**), separate Current and Continuing | 17 | Quarterly, 30 days |
| **FAR No. 1-A** | Summary of Appropriations, Allotments, Obligations, Disbursements and Balances by Object of Expenditures (SAAODBOE) | 18 | Quarterly, 30 days |
| **FAR No. 1-B** | List of Allotments and Sub-Allotments (LASA) | 19 | Quarterly, 30 days |
| **FAR No. 1-C** | Statement of Obligations, Disbursements, Liquidations and Balances for Inter-Agency Fund Transfers (added by JC 2019-1) | n/a (post-2015) | Quarterly, 30 days [SECONDARY] |
| **FAR No. 2** | Statement of Approved Budget, Utilizations, Disbursements and Balances (**SABUDB**), off-budget funds (SUC: by IGF, BRF) | 20 | Quarterly |
| **FAR No. 2-A** | Summary of Approved Budget, Utilizations, Disbursements and Balances by Object of Expenditures (SABUDBOE) | 21 | Quarterly |
| **FAR No. 3** | GAM 2015: "Aging of Due and Demandable Obligations" (ADDO). EVSU FY 2025: "**Aging of Unpaid Obligations**", 4th quarter only, all funds | 22 | **Annual**, within 30 days after end of year |
| **FAR No. 4** | Monthly Report of Disbursements (MRD) | 23 | Monthly. GAM: on or before the 30th day of the following month. SUCs submit to the **DBM Regional Office** |
| **FAR No. 5** | Quarterly Report of Revenue and Other Receipts (QRROR) (SUC: IGF, BRF, TRF) | 24 | Quarterly, within 30 days, to COA, DBM, BTr |

- **Conflict on due date: UNVERIFIED.** A DENR memo (Nov 2024) paraphrases JC 2019-1 as "within the 10th day of the month following the last month of the covered reporting period". Another DENR memo and DBM CL 2024-5 say "within 30 days after the end of each quarter". GAM App. text says 30 days. Treat **30 days** as the working rule and keep the due date configurable.
- Signatories (from the GAM FAR 3 instruction): Budget Officer (ORS data), Chief Accountant (aging data), approved by Head of Agency. FAR 4: certified by the Chief Accountant, approved by the Head of Agency.

### B5. Validity of appropriations; NCA lapsing

- **Cash Budgeting System: EO 91 s.2019** (one-year validity). From FY 2022 onward the GAA general provisions restored **two-year availability for MOOE and CO**. NBC 587 (FY 2022) gave MOOE and CO until 31 Dec 2023. The NBC 595 extract says FY 2025 validity extends to 31 Dec 2026. [SECONDARY]
- **FY 2026 (NBC 599)**: the extracted text contains both "until December 31, 2026" and "until December 31, 2027". It also says delivery of goods and services and completion of infrastructure (including inspection and acceptance) must happen **not later than 31 Dec 2027**. **Exact per-class mapping is UNVERIFIED** because the table was garbled. Working assumption: **PS valid until 31 Dec 2026; MOOE and CO available for release and obligation until 31 Dec 2027**. Unreleased and unobligated balances revert after that.
- **NCA lapsing: UNVERIFIED for FY 2026.** Practice per DBM CL 2013-16(B): LDDAP-ADAs must reach the MDS-GSB at least **2 working days before end of the quarter**, and unused NCA lapses at quarter end (DENR memo, Nov 2024). Year-end: lapsed NCA is reversed in the books. The exact rule is in each year's NBC on release of funds (NBC 599 for 2026).

### B6. SUC income / Special Trust Fund

- **RA 8292 (Higher Education Modernization Act of 1997) §4(d)**: tuition and other fees, government subsidies and other SUC income are **retained** and constitute a **Special Trust Fund (STF)**, deposited in an authorized government depository bank and disbursed per Board of Regents/Trustees approval. [SECONDARY: Rotoras v. COA, G.R. 211999 (2019)]
- COA position (Rotoras; Benguet State Univ. v. COA): STF cannot pay compensation, per diems or honoraria not authorized by law. Board approval is needed but limited.
- **CHED Memorandum Order No. 20 s.2011**: "Policies and Guidelines for the Use of Income, Special Trust Fund and Programs of Receipts and Expenditures of the SUCs". [SECONDARY]
- **DBM-CHED-COA JC 2004-1: UNVERIFIED.** No such circular found. The governing references found are RA 8292 §4(d), CMO 20-2011, and the yearly GAA special provisions for SUCs. Tuition under RA 10931 (Free Higher Education) is reimbursed from CHED/UniFAST; CHED-DBM JMC 2017-1/1-A says SUCs charge the Higher Education Support Fund in lieu of tuition.
- Budget/reporting: STF uses **BURS → RBUD → FAR 2 / 2-A**, and revenue goes to **FAR 5**.

---

## C. Procurement

- **RA 9184 has been replaced** by **RA 12009, the New Government Procurement Act (NGPA)**. It was signed 20 Jul 2024 and **took effect 13 Aug 2024**. Its **IRR was approved by GPPB Resolution No. 02-2025 (4 Feb 2025) and took effect 25 Feb 2025**. [OFFICIAL: GPPB Res. 10-2026 recitals]
- Later GPPB issuances:
  - Res. 12-2025: Procurement Mode Selection Decision Tree, an IRR annex. [SECONDARY]
  - **Res. 10-2026 / Circular 06-2026** (3 Feb 2026): exclusive list of eligibility documents for Direct Contracting, SVP and certain Negotiated Procurement modes. Expired Mayor's permit plus OR is accepted at eligibility. [OFFICIAL]
- **Modes under RA 12009** [OFFICIAL: GPPB NGPA series]: Competitive Bidding; Limited Source Bidding; Competitive Dialogue; Unsolicited Offer with Bid Matching; Direct Contracting; **Direct Acquisition**; Repeat Order; **Small Value Procurement**; Negotiated Procurement (emergency, two failed biddings, take-over, adjacent/contiguous, agency-to-agency, scientific/scholarly/artistic, highly technical consultants, lease of property, **direct retail purchase** of POL, e-charging devices and online subscriptions; airline tickets are now CSE via PhilGEPS eMarketplace); Direct Sales; Direct Procurement for Science, Technology and Innovation.
  - **"Shopping" no longer exists as a mode.**
- **Thresholds** [OFFICIAL: GPPB posts]:
  - **Small Value Procurement (IRR §34)**: ABC **≤ ₱2,000,000**, for NGAs/GOCCs/GFIs/**SUCs**. LGU thresholds are set by the GPPB by income class. Under RA 9184 the NGA/SUC limit was ₱1,000,000. Request at least 3 quotations; **one responsive quotation is sufficient**. Covers goods not available at PS-DBM, infrastructure, and consulting.
  - **Direct Acquisition (RA 12009 §32)**: ABC **≤ ₱200,000**, for non-CSE goods (and CSE not available at PS-DBM) and services, from any known reputable source. The GPPB can adjust this.
  - No post-IRR GPPB revision of these thresholds was found (**UNVERIFIED** that none exists).
- **Documents and GAM appendix numbers:**

| Document | Prescribed by | GAM App. |
|---|---|---|
| PPMP (Project Procurement Management Plan) | GPPB format (indicative and final PPMP under NGPA) | none |
| APP (Annual Procurement Plan) | GPPB format | none |
| **Purchase Request (PR)** | COA GAM | **60** |
| RFQ / RFP | GPPB template | none |
| Abstract of Quotations / Bids | GPPB/agency template | none |
| BAC Resolution (recommending award / mode) | GPPB | none |
| Notice of Award, Contract/PO, Notice to Proceed | GPPB (Philippine Bidding Documents) | none |
| **Purchase Order (PO)** | COA GAM | **61** |
| **Inspection and Acceptance Report (IAR)** | COA GAM | **62** |

- **Liquidated damages**: **1/10 of 1% (0.1%) per calendar day of delay** on the cost of the unperformed portion (goods: the delayed goods; infra: the unperformed works). If LDs reach **10% of contract price**, the PE may rescind (RA 9184 IRR §68; RA 12009 IRR reportedly says "at least 1/10 of 1%"). [SECONDARY; the RA 12009 IRR section text and cap is **UNVERIFIED**]

---

## D. COA forms: GAM for NGAs (COA Circular 2015-007; GAM effective 1 Jan 2016)

GAM structure: **Vol. I** (policies, guidelines, procedures, illustrative entries), **Vol. II** (books, registries, records, forms, reports, Appendices 1–81), **Vol. III** (Revised Chart of Accounts, as updated by later COA circulars).

### D1. Appendix numbers [OFFICIAL: GAM Vol. II table of contents, BTr-hosted PDF]

| Form | App. | Notes |
|---|---|---|
| General Journal | 1 | |
| Cash Receipts Journal | 2 | |
| Cash Disbursements Journal | 3 | |
| Check Disbursements Journal | 4 | |
| General Ledger | 5 | |
| Subsidiary Ledger | 6 | |
| Registry of Revenue and Other Receipts – Summary | 7 | |
| RAPAL | 8 | |
| RAOD PS/MOOE/FE/CO | 9-A/B/C/D | |
| RBUD PS/MOOE/FE/CO | 10-A/B/C/D | |
| **ORS** | **11** | |
| NORSA | 12 | |
| Report of ADA Issued | 13 | |
| **BURS** | **14** | |
| NBURSA | 15 | |
| BAR No. 1 (QPRO) | 16 | |
| FAR 1 / 1-A / 1-B / 2 / 2-A / 3 / 4 / 5 | 17 / 18 / 19 / 20 / 21 / 22 / 23 / 24 | |
| Notice of Dishonored Checks | 25 | |
| **Report of Collections and Deposits (RCD)** | **26** | Collecting Officer; by fund cluster |
| Cash Receipts Register (CRReg) | 27 | field offices without books |
| Order of Payment | 28 | Accounting prepares from bill |
| **Cash Receipts Record (CRRec)** | **29** | each collecting officer; daily, extract undeposited balance |
| RANCA | 30 | |
| RANTA | 31 | |
| **Disbursement Voucher (DV)** | **32** | |
| Payroll | 33 | |
| Check and ADA Disbursements Record (CkADADRec) | 34 | |
| Report of Checks Issued (RCI) | 35 | |
| **Journal Entry Voucher (JEV)** | **36** | |
| Cash in Bank Register | 37 | |
| Index of Payments | 38 | |
| Advice of Checks Issued and Cancelled (ACIC) | 39 | to GSB daily |
| Cash Disbursements Record | 40 | |
| Report of Cash Disbursements (RCDisb) | 41 | liquidation of DO's cash advance |
| **LDDAP-ADA** | **42** | accountable form; MDS-GSB debits NCA |
| Cash Disbursements Register | 43 | |
| **Liquidation Report (LR)** | **44** | travel CA |
| Itinerary of Travel | 45 | |
| Reimbursement Expense Receipt (RER) | 46 | |
| Certificate of Travel Completed | 47 | |
| **Petty Cash Voucher (PCV)** | **48** | |
| Report on Paid Petty Cash Vouchers (RPPCV) | 49 | replenishment |
| Petty Cash Fund Record | 50 | |
| Petty Cash Fund Register | 51 | |
| ADA Disbursement Journal | 52 | |
| **SLIIE**: Summary of LDDAP-ADAs Issued and Invalidated ADA Entries | **53** | daily, to BTr |
| Schedule of Accounts Payable | 54 | |
| Schedule of Accounts Receivable | 55 | |
| Registry of Accounts Written-Off | 56 | |
| **Supplies Ledger Card (SLC)** | **57** | Accounting |
| **Stock Card (SC)** | **58** | Supply |
| **Inventory Custodian Slip (ICS)** | **59** | GAM text "< ₱15,000" is superseded (see D3) |
| **PR** | **60** | |
| **PO** | **61** | |
| **IAR** | **62** | |
| **RIS** (Requisition and Issue Slip) | **63** | |
| **RSMI** (Report of Supplies and Materials Issued) | **64** | |
| **WMR** (Waste Materials Report) | **65** | |
| **RPCI** (Report on the Physical Count of Inventories) | **66** | semi-annual |
| **RAAF** (Report of Accountability for Accountable Forms) | **67** | monthly, by fund cluster |
| Investment Property Ledger Card | 68 | |
| Registry of Heritage Assets / Summary | 69 / 69-A | |
| **Property Card (PC)** | **70** | Supply, per PPE class |
| Construction in Progress Ledger Card | 71 | |
| **PPE Ledger Card (PPELC)** | **72** | Accounting |
| **PAR** (Property Acknowledgement Receipt) | **73** | renewed every 3 years or on change of custodian |
| **RPCPPE** (Report on the Physical Count of PPE) | **74** | yearly |
| **IIRUP** (Inventory and Inspection Report of Unserviceable Property) | **75** | |
| **RLSDDP** (Report of Lost, Stolen, Damaged or Destroyed Property) | **76** | |
| **PTR** (Property Transfer Report) | **77** | |
| Biological Assets Property Card | 78 | |
| Quarterly Report of Biological Assets | 79 | |
| **Bank Reconciliation Statement, MDS accounts** | **80** | |
| **Bank Reconciliation Statement, AGDB accounts** | **81** | |

**Not GAM Vol. II appendices:**
- Official Receipt (**Accountable Form No. 51-C**, COA-prescribed, printed by APO/NPO); appendix number **UNVERIFIED**.
- MDS **Check**: a GSB-issued accountable form.
- "Certificate of Cash Advance": not found in the GAM. **UNVERIFIED** whether such a form exists.
- Trial Balance and FS formats are in GAM Vol. I Ch. 19 annexes, not Vol. II. **UNVERIFIED** annex numbers.

### D2. DV (App. 32) boxes [SECONDARY for B–E; MEMORY for A wording]

- Header: Entity Name, Fund Cluster, DV No., Date. Mode of Payment: MDS Check / Commercial Check / ADA / Others. Payee, TIN/Employee No., ORS/BURS No., Address. Lines: Particulars, Responsibility Center, MFO/PAP, Amount (gross, less taxes and deductions).
- **Box A**: "Certified: Expenses/Cash Advance necessary, lawful and incurred under my direct supervision." Signed by the Head of Requesting Office / Authorized Representative.
- **Box B**: Accounting Entry (Account Title, UACS Code, Debit, Credit).
- **Box C**: "Certified: Cash available; Subject to Authority to Debit Account (when applicable); Supporting documents complete and amount claimed proper." Signed by the Head, Accounting Unit / Authorized Representative.
- **Box D**: "Approved for Payment." Signed by the Agency Head / Authorized Representative.
- **Box E**: Receipt of Payment: Check/ADA No., Date, Bank Name and Account No., Signature, Printed Name, Date, OR / other documents. JEV No. is also recorded.

### D3. Semi-expendable property (COA Circular 2022-004)

- **Capitalization threshold raised from ₱15,000 to ₱50,000** (per item, not per bulk purchase). [SECONDARY: UPLB SPMO memo, DepEd memos, consistent]
- Items below ₱50,000 that otherwise meet the PPE definition are **semi-expendable property**:
  - **low-valued**: ≤ ₱5,000 each
  - **high-valued**: > ₱5,000 and < ₱50,000
- Accountability is through the **ICS**, renewed every 3 years or on change of custodian.
- Forms annexed to the circular: Semi-expendable Property Card (SPC), **Semi-Expendable Property Ledger Card (SPLC, Annex A.2)**, ICS, Report of Semi-expendable Property Issued (RSPI), **Registry of Semi-expendable Property Issued (RegSPI, Annex A.4)**, **RPCSP** (Report on the Physical Count of Semi-Expendable Property), ITR (Inventory Transfer Report), IIRUSP, RLSDDSP. The annex numbers other than A.2 and A.4 are **UNVERIFIED**. Effectivity date is **UNVERIFIED** (circular dated 2022; agencies implemented FY 2022–2023).

### D4. Depreciation (GAM Vol. I Ch. 10)

- **Straight-line method.** [SECONDARY]
- **Residual value: at least 5% of cost** under the 2015 GAM. **10% was the old NGAS rule**, which the question cited. [SECONDARY: NGAS-vs-GAM comparison]
- **Start: the month following acquisition/completion (available for use), regardless of the day of the month** (COA CL 2004-003, carried into the GAM). [SECONDARY; GAM wording **UNVERIFIED**]
- Monthly computation. Useful lives per the GAM annex table. Revised estimated useful lives possibly in COA Circular 2017-004: **UNVERIFIED**.

### D5. Cash advances (COA Circular 97-002, 10 Feb 1997; GAM Vol. I Ch. 6; also COA Circ. 2012-004)

[SECONDARY]
- **No additional cash advance** to anyone until the previous one is liquidated or properly accounted for.
- All CAs are **fully liquidated at year-end** (except PCF, which is replenished).
- CA **unused for 2 months** must be returned.
- Liquidation deadlines:
  - **Salaries/wages**: within **5 days** after each 15-day / month-end pay period
  - **Local travel**: within **30 days** after return
  - **Foreign travel**: within **60 days** after return
  - **Special time-bound undertakings**: within 1 month after completion
  - Petty operating / field operating expenses: liquidate or replenish; full year-end liquidation
- Failure to liquidate is a valid ground to **withhold salary**.
- Forms: Liquidation Report (App. 44) for travel; Report of Cash Disbursements (App. 41) for the Disbursing Officer's CA; Itinerary (45), RER (46), Certificate of Travel Completed (47).

### D6. Petty Cash Fund (GAM Vol. I Ch. 6)

[SECONDARY, several agency memos citing GAM]
- Imprest system. Fund sized for **one month's** recurring petty expenses.
- Each payment **≤ ₱15,000 per transaction** (unless otherwise authorized).
- **Replenish when disbursements reach at least 75%** (or as needed), via RPPCV (App. 49) with PCVs (App. 48).
- The PCF Custodian maintains the PCF Record (App. 50).
- An older COA rule (Circ. 2012-001) set a ₱1,000 per-item limit; that rule is superseded.
- A fixed ₱ ceiling on total PCF size: **UNVERIFIED**. Some agency memos say a ₱15,000 maximum CA for PCF, but that is agency-specific.

---

## E. Revenue / collections (SUC)

- **Official Receipts** (AF 51-C) are **accountable forms**. Accountability is reported **monthly in the RAAF (App. 67)**.
- The Collecting Officer records collections daily in the **Cash Receipts Record (App. 29)** and extracts the undeposited balance. Deposits are reported in the **RCD (App. 26)**, which is the basis of the Cash Receipts Journal (App. 2) via JEV.
- An **Order of Payment (App. 28)** is issued by Accounting from the bill.
- **Deposit rule: collections are deposited intact daily, or not later than the next banking day.**
  - Source: BTr DO 14-94 / DOF DC 001-2015 for national collections; repeated in COA audit observations. [SECONDARY]
  - The GAM Vol. I wording and any ₱ threshold or weekly rule for remote collecting officers are **UNVERIFIED**.
- National-government (general fund) collections go to the BTr. **SUC income is retained** (RA 8292 §4(d), STF, see B6) and deposited in the SUC's AGDB account (typically LBP/DBP).
- **E-collections:**
  - COA Circular **2013-007** (18 Sep 2013): guidelines for **electronic Official Receipts (eOR)** acknowledging electronic collections. Minimum data: issuing agency, payor, date/time, mode of payment.
  - COA Circular **2021-014**: e-Collection and e-Payment framework for government.
  - LBP **Link.BizPortal** is a common e-payment channel for SUC fees.
  - [SECONDARY] No 2023–2025 replacement found (**UNVERIFIED**).
- EOPT note: suppliers now issue **invoices** (not ORs) as primary sales documents (RR 7-2024). The SUC's AF 51-C ORs are COA accountable forms, separate from BIR invoicing.

---

## F. Financial statements (PPSAS / GAM Vol. I Ch. 19)

- **Complete set** [MEMORY, standard per PPSAS 1/24 and GAM]:
  1. Statement of Financial Position (SFPos)
  2. Statement of Financial Performance (SFPerf)
  3. Statement of Changes in Net Assets/Equity (SCNA/E)
  4. Statement of Cash Flows (SCF, direct method)
  5. **Statement of Comparison of Budget and Actual Amounts (SCBAA)**
  6. Notes to FS
- Supporting schedules: the Trial Balance (pre-closing and post-closing) is required by the GAM.
- **Deadline: year-end FS submitted to COA (Auditor) and DBM not later than 14 February** of the following year (GAM Vol. I Ch. 19, §60). [SECONDARY: DENR memo quoting GAM §60] Quarterly TB/FS deadlines: **UNVERIFIED**.
- Year-end closing [MEMORY, standard GAM]:
  - Close revenue and expense accounts to **Revenue and Expense Summary**, then to **Accumulated Surplus/(Deficit)**.
  - Reverse unused NCA: Dr Subsidy from National Government, Cr Cash–MDS. Book accounts payable for due-and-demandable obligations.
  - Exact UACS codes are in the RCA (GAM Vol. III as updated). **UNVERIFIED here.**
- SUC FS are prepared **by fund cluster** and consolidated.

---

## Sources

Official / primary:
- BIR RMC No. 89-2026 (10 Aug 2026), deadline-extension table showing 0619-E, 0619-F, 1601-C, 1600-VT/PT (NGAs), MAP: https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2089-2026_redacted.pdf
- GAM for NGAs Vol. II table of contents (Appendices 1–81), BTr-hosted: https://www.treasury.gov.ph/wp-content/uploads/2018/01/Volume-II.pdf
- GPPB Resolution 10-2026 / Circular 06-2026 (RA 12009 effectivity 13 Aug 2024; IRR 25 Feb 2025): https://www.gppb.gov.ph/wp-content/uploads/2026/06/Approved_GPPB-Resolution-No.-10-2026-Documentary-Requirements.pdf
- GPPB NGPA series: SVP ₱2M https://www.gppb.gov.ph/?p=12337 ; Direct Acquisition ₱200k https://www.gppb.gov.ph/streamlining-procurement-by-introducing-direct-acquisition-under-ra-12009/ ; modes https://www.gppb.gov.ph/fit-for-purpose-procurement-modalities-under-ra-12009/ ; direct retail purchase https://www.gppb.gov.ph/key-changes-in-negotiated-procurement-for-direct-retail-purchase-under-ra-12009/
- RR 1-2013 (eTRA) text: https://dev.lawyerly.ph/laws/68551
- BIR MOMD slides at PAGBA, Nov 2023 (RMC 47-2023, EWT rates, RMC 23-2012): https://www.pagba.com/wp-content/uploads/2023/11/TAX-UPDATES-SLIDES.pdf
- DBM NBC 599 (not readable from here): https://www.dbm.gov.ph/wp-content/uploads/Issuances/2026/National-Budget-Circular/NATIONAL-BUDGET-CIRCULAR-NO-599.pdf
- COA-DBM JC 2019-1 (not readable from here): https://dbm.gov.ph/wp-content/uploads/Issuances/2019/Joint-Circular/COA-DBM-JOINT-CIRCULAR-NO-2019-1-DATED-JANUARY-1-2019.pdf
- DBM CL 2024-5 (BFARs via URS): https://www.dbm.gov.ph/wp-content/uploads/Issuances/2024/Circular-Letter/CIRCULAR-LETTER-NO-2024-5-DATED-FEBRUARY-27-2024.pdf

Secondary / cross-checks:
- ATC table (government vs TWA codes): https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1961761.html
- Creditable VAT on sales to government (RMC 36-2021): https://www.grantthornton.com.ph/insights/articles-and-updates1/tax-notes/how-to-fill-in-vat-returns-from-final-to-creditable-vat-withheld-on-sales-to-govt/ ; https://roquelaw.com.ph/guidelines-for-the-shift-from-final-to-creditable-system-of-vat-withheld-on-sales-to-government/
- EOPT RRs: https://www.pwc.com/ph/en/tax/tax-publications/tax-alerts/2024/tax-alert-22.html ; https://forvismazars.com/ph/en/insights/tax-alerts/ease-of-paying-taxes-act/effectivity-dates-of-eopt-act-regulations
- BIR reminder to government offices (₱10,000 exception claim, forms): https://negrosnowdaily.com/govt-offices-brgys-reminded-on-use-of-correct-bir-forms/
- PwC 2026 tax calendar: https://www.pwc.com/ph/en/client-accounting-services/2026-tax-calendar/2026-february-tax-calendar.html
- DENR memos on JC 2019-1 BFAR timing, GAM §60 Feb 14, DBM CL 2013-16(B): https://apidb.denr.gov.ph/infores/uploads/MEMO-2024-1017.pdf
- EVSU FY 2025 BFAR listing (current report titles incl. FAR 1-C): https://www.evsu.edu.ph/?p=30448
- Semi-expendable ₱50k (COA C2022-004): https://spmo.uplb.edu.ph/ovca-memorandum-no-28-implementation-increase-capitalization-threshold-semi-expendable-property-%e2%82%b115000-00-%e2%82%b150000-00-thru-issuance-inventory-cus
- RA 8292 STF: Rotoras v. COA, G.R. 211999 (2019) https://batasnatin.com/laws/gr-211999 ; CMO 20-2011 https://legaldex.com/laws/policies-and-guidelines-for-the-use-of-income-special-trust
- eOR COA Circ. 2013-007: https://dev.lawyerly.ph/laws/67538
