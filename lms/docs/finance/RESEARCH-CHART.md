# COA Revised Chart of Accounts (NGA) + UACS: reference for a SUC FMIS

Compiled 2026-11-06. **Read the "Source status" box first.**

> **Source status (important)**
> - **What was read in full:** *GAM for NGAs, Volume III: The Revised Chart of Accounts (Updated 2015)*. It was prescribed by COA Circular 2015-007 (22 Oct 2015). The official PDF is hosted by the Bureau of the Treasury: https://www.treasury.gov.ph/wp-content/uploads/2018/01/Volume-III.pdf (152 pp.; Ch.2 List of Accounts with UACS sub-object and 10-digit codes; Ch.3 Description of Accounts with **Normal Balance** for every account). Every code, title and normal balance in Section 2 was machine-extracted from this PDF, unless the row says otherwise.
> - **Also read in full:** *GAM for NGAs, Volume I* (treasury.gov.ph/wp-content/uploads/2018/01/Volume-I.pdf). It covers fund clusters, the useful-life guideline ranges, the P15,000 threshold (since superseded) and the responsibility-centre code.
> - **Current version, not obtainable:** COA Circular **2020-001** (8 Jan 2020) prescribes *Volume III – Revised Chart of Accounts (Updated 2019)*. It replaces the 2015 version and is the **current** NGA RCA. Its Annex A (full RCA) and Annexes B–G (additional object codes, additional sub-objects, modified titles/codes, modified descriptions, modified sub-objects, deleted accounts) are on coa.gov.ph. coa.gov.ph, dbm.gov.ph, uacs.gov.ph and the DPWH copy (DMC 20 s.2020) all returned 403/503 from this environment. The **2019 annexes were therefore NOT read**.
> - **How the 2015 codes were cross-checked against post-2019 practice:** expense, revenue and capital-outlay codes were compared with real 2022–2024 government reports that use the current UACS:
>   - DENR FAR No. 1-A (Dec 2022), which lists ~300 object/sub-object codes
>   - J.H. Cerilles State College FAR No. 1-A, No. 2 and No. 5 (FY2024)
>   - Iloilo State College of Fisheries FAR 1 (2019, 2024)
>   - UP Tacloban FAR 1/2 (2024)
>
>   Where they differ from 2015, the row says so.
> - **Balance-sheet codes (1xxx–3xxx) are as of the 2015 RCA.** They are believed to be carried into the 2019 RCA unchanged but are **UNVERIFIED** against the 2019 Annex A. **Action:** before go-live, obtain COA Circular 2020-001 Annexes A–G and COA Circular 2022-002 (24 Jan 2022, conversion of 2015 accounts to the Updated 2019 RCA) from coa.gov.ph, and diff them against this list.
> - **Later amendments:** no COA circular amending the NGA RCA in 2023, 2024 or 2025 was found in searches. **UNVERIFIED that none exists.** Related circulars that were found:
>   - COA Circular 2020-004 (31 Jan 2020) harmonised NGA/GC accounts, e.g. depreciable biological assets (secondary source only)
>   - COA Circular 2022-002 (conversion)
>   - COA Circular 2022-004 (capitalization threshold)

---

## 1. Code structure and normal balances

**Source:** GAM Vol III (Updated 2015), Ch.1 and Ch.2. COA Circular 2013-002 (RCA for NGAs, effective 1 Jan 2014) is the base.

**8-digit RCA code = `G SS MM AAA`, i.e. `1 | 2 | 2 | 3` digits:**

| Digits | Level | Example (10605030) |
|---|---|---|
| 1st (1 digit) | Account group: 1 Assets, 2 Liabilities, 3 Equity, 4 Revenue, 5 Expenses | `1` Assets |
| 2nd–3rd (2) | Major account group | `06` Property, Plant and Equipment |
| 4th–5th (2) | Sub-major account group | `05` Machinery and Equipment |
| 6th–8th (3) | General ledger account | `030` Information and Communications Technology Equipment |

Ch.3 of Vol III is headed like this: "1 Assets / 01 Cash and Cash Equivalents / 01 Cash on Hand", then GL 10101010.

**Contra-account convention (observed throughout the RCA):**
- Last digit `1` = Accumulated Depreciation, or Allowance for Impairment for receivables. Example: 10605031.
- Last digit `2` = Accumulated Impairment Losses. Example: 10605032.
- Accumulated Amortization for intangibles is `…1`. Exception in the 2015 text: Patents/Copyrights has AA = 10801011 but UACS 1080101200 (a typo in the source).

**UACS object code (10 digits)** = 8-digit RCA code + 2-digit UACS sub-object code. Sub-object `00` = the GL account itself. Non-zero sub-objects are prescribed by the UACS Committee (DBM validates/assigns them). The source is the Vol III Ch.2 column headings "RCA Code | UACS Sub-Object Code | UACS Object Code", e.g. `10101010 | 00 | 1010101000`. Conventions:
- Since the 2019 update, "Others" sub-objects are `99`, e.g. 5029999099 and 4020221099 in 2024 SUC FARs.
- Since 2019, ICT variants are `01` and the regular variant is `02`, e.g. 5020301001 ICT Office Supplies and 5020301002 Office Supplies.

**Normal balances.** Vol III Ch.3 states a "Normal Balance" for each of the 698 described accounts (379 Debit, 319 Credit):
- Assets: **Dr**. Contra-assets (Accumulated Depreciation/Amortization/Impairment, Allowance for Impairment): **Cr**.
- Liabilities: **Cr**.
- Equity: **Cr**. Accumulated Surplus/(Deficit) is Cr; it is a deficit when it has a debit balance.
- Revenue: **Cr**. Contra-revenue such as 40202161 Sales Discounts: **Dr**.
- Expenses: **Dr**.

**Allotment classes (budget side).** PS = Personnel Services (501xxxxx). MOOE = Maintenance and Other Operating Expenses (502xxxxx). FinEx/FE = Financial Expenses (503xxxxx). CO = Capital Outlays. GL accounts in 505 (depreciation, amortization, impairment, losses) are non-cash and carry no allotment class.

On the budget/FAR side, **CO is coded with DBM UACS object codes 506xxxxxxx**, which are not RCA GL accounts. Examples:
- 5060404001 Buildings
- 5060405003 ICT Equipment
- 5060406001 Motor Vehicles
- 5060407002 Books

These appear in DENR FAR 1-A 2022 and in JHCSC FAR 1-A FY2024. In the books, the related asset is debited (e.g. 10605030). An FMIS therefore needs a CO-object to PPE-GL mapping table, provided in Section 2B.

---

## 2. SUC account list (228 rows)

Columns:
- **RCA code / title / normal balance:** from GAM Vol III (Updated 2015) unless noted.
- **UACS object:** the RCA code + `00`.
- **Allotment class:** given for expense GLs, and CO for PPE acquisitions.
- **Notes:** sub-objects and post-2019 observations.

Rows marked *observed 2022/2024* were confirmed in actual DENR, SUC or other agency FARs prepared under the Updated 2019 RCA.

### 2A. Account list

| RCA code | UACS object (10-digit, sub 00) | Account title (RCA) | Group | Normal bal. | Allotment class | Notes |
|---|---|---|---|---|---|---|
| 10101010 | 1010101000 | Cash-Collecting Officers | Asset | Dr | - |  |
| 10101020 | 1010102000 | Petty Cash | Asset | Dr | - |  |
| 10102020 | 1010202000 | Cash in Bank-Local Currency, Current Account | Asset | Dr | - | IGF/STF/trust depository accounts with AGDB (e.g. LBP/DBP). Keep one SL per bank account. |
| 10102030 | 1010203000 | Cash in Bank-Local Currency, Savings Account | Asset | Dr | - | Description in RCA is BTr-oriented; SUCs use only if authorized savings accounts exist. |
| 10102040 | 1010204000 | Cash in Bank-Local Currency, Time Deposits | Asset | Dr | - |  |
| 10104040 | 1010404000 | Cash-Modified Disbursement System (MDS), Regular | Asset | Dr | - | GAA NCA (Fund Cluster 01). |
| 10104050 | 1010405000 | Cash-Modified Disbursement System (MDS), Special Account | Asset | Dr | - |  |
| 10104060 | 1010406000 | Cash-Modified Disbursement System (MDS), Trust | Asset | Dr | - |  |
| 10104070 | 1010407000 | Cash-Tax Remittance Advice | Asset | Dr | - | Taxes withheld remitted via TRA (non-cash; offsets Due to BIR). |
| 10104080 | 1010408000 | Cash-Constructive Income Remittance | Asset | Dr | - | Constructive income remittance (CIR) for income required to be remitted to BTr. |
| 10301010 | 1030101000 | Accounts Receivable | Asset | Dr | - |  |
| 10301011 | 1030101100 | Allowance for Impairment-Accounts Receivable | Asset | Cr | - | Contra-asset. |
| 10301050 | 1030105000 | Interests Receivable | Asset | Dr | - |  |
| 10302010 | 1030201000 | Operating Lease Receivable | Asset | Dr | - | Rent of canteen/space etc. |
| 10303010 | 1030301000 | Due from National Government Agencies | Asset | Dr | - | Funds transferred to other NGAs (e.g. implementing agency). |
| 10303020 | 1030302000 | Due from Government-Owned or Controlled Corporations | Asset | Dr | - |  |
| 10303030 | 1030303000 | Due from Local Government Units | Asset | Dr | - |  |
| 10304050 | 1030405000 | Due from Other Funds | Asset | Dr | - | Inter-fund receivable (eliminated on consolidation). |
| 10305010 | 1030501000 | Receivables-Disallowances/Charges | Asset | Dr | - | Disallowances/charges per COA ND/NC. |
| 10305020 | 1030502000 | Due from Officers and Employees | Asset | Dr | - |  |
| 10305990 | 1030599000 | Other Receivables | Asset | Dr | - |  |
| 19901010 | 1990101000 | Advances for Operating Expenses | Asset | Dr | - | Cash advances for operating expenses (Other Assets group in RCA, not Receivables). |
| 19901020 | 1990102000 | Advances for Payroll | Asset | Dr | - |  |
| 19901030 | 1990103000 | Advances to Special Disbursing Officers | Asset | Dr | - |  |
| 19901040 | 1990104000 | Advances to Officers and Employees | Asset | Dr | - | Travel cash advances. |
| 19902010 | 1990201000 | Advances to Contractors | Asset | Dr | - | Contractor mobilization advances (15% max). |
| 19902020 | 1990202000 | Prepaid Rent | Asset | Dr | - |  |
| 19902030 | 1990203000 | Prepaid Registration | Asset | Dr | - |  |
| 19902050 | 1990205000 | Prepaid Insurance | Asset | Dr | - |  |
| 19902990 | 1990299000 | Other Prepayments | Asset | Dr | - | Use for prepaid subscriptions if no specific account (see UNVERIFIED note on 'Prepaid Subscription'). |
| 19903020 | 1990302000 | Guaranty Deposits | Asset | Dr | - |  |
| 10401010 | 1040101000 | Merchandise Inventory | Asset | Dr | - | IGP/auxiliary merchandise. |
| 10404010 | 1040401000 | Office Supplies Inventory | Asset | Dr | - |  |
| 10404020 | 1040402000 | Accountable Forms, Plates and Stickers Inventory | Asset | Dr | - | Official receipts, etc. |
| 10404030 | 1040403000 | Non-Accountable Forms Inventory | Asset | Dr | - |  |
| 10404050 | 1040405000 | Food Supplies Inventory | Asset | Dr | - |  |
| 10404060 | 1040406000 | Drugs and Medicines Inventory | Asset | Dr | - | Clinic. |
| 10404070 | 1040407000 | Medical, Dental and Laboratory Supplies Inventory | Asset | Dr | - | Clinic/laboratories. |
| 10404080 | 1040408000 | Fuel, Oil and Lubricants Inventory | Asset | Dr | - |  |
| 10404090 | 1040409000 | Agricultural and Marine Supplies Inventory | Asset | Dr | - | Agri SUCs: seeds, fertilizer, feeds. |
| 10404100 | 1040410000 | Textbooks and Instructional Materials Inventory | Asset | Dr | - |  |
| 10404130 | 1040413000 | Construction Materials Inventory | Asset | Dr | - |  |
| 10404990 | 1040499000 | Other Supplies and Materials Inventory | Asset | Dr | - |  |
| 10405010 | 1040501000 | Semi-Expendable Machinery | Asset | Dr | - |  |
| 10405020 | 1040502000 | Semi-Expendable Office Equipment | Asset | Dr | - |  |
| 10405030 | 1040503000 | Semi-Expendable Information and Communications Technology Equipment | Asset | Dr | - |  |
| 10405040 | 1040504000 | Semi-Expendable Agricultural and Forestry Equipment | Asset | Dr | - |  |
| 10405070 | 1040507000 | Semi-Expendable Communication Equipment | Asset | Dr | - |  |
| 10405100 | 1040510000 | Semi-Expendable Medical Equipment | Asset | Dr | - |  |
| 10405120 | 1040512000 | Semi-Expendable Sports Equipment | Asset | Dr | - |  |
| 10405130 | 1040513000 | Semi-Expendable Technical and Scientific Equipment | Asset | Dr | - |  |
| 10405190 | 1040519000 | Semi-Expendable Other Machinery and Equipment | Asset | Dr | - |  |
| 10406010 | 1040601000 | Semi-Expendable Furniture and Fixtures | Asset | Dr | - |  |
| 10406020 | 1040602000 | Semi-Expendable Books | Asset | Dr | - |  |
| 10601010 | 1060101000 | Land | Asset | Dr | CO | Not depreciated. |
| 10602990 | 1060299000 | Other Land Improvements | Asset | Dr | CO |  |
| 10604010 | 1060401000 | Buildings | Asset | Dr | CO |  |
| 10604020 | 1060402000 | School Buildings | Asset | Dr | CO |  |
| 10604060 | 1060406000 | Hostels and Dormitories | Asset | Dr | CO | Dormitories. |
| 10604990 | 1060499000 | Other Structures | Asset | Dr | CO |  |
| 10605010 | 1060501000 | Machinery | Asset | Dr | CO |  |
| 10605020 | 1060502000 | Office Equipment | Asset | Dr | CO |  |
| 10605030 | 1060503000 | Information and Communications Technology Equipment | Asset | Dr | CO |  |
| 10605040 | 1060504000 | Agricultural and Forestry Equipment | Asset | Dr | CO |  |
| 10605070 | 1060507000 | Communication Equipment | Asset | Dr | CO |  |
| 10605110 | 1060511000 | Medical Equipment | Asset | Dr | CO |  |
| 10605130 | 1060513000 | Sports Equipment | Asset | Dr | CO |  |
| 10605140 | 1060514000 | Technical and Scientific Equipment | Asset | Dr | CO | Laboratory/scientific equipment. |
| 10605990 | 1060599000 | Other Machinery and Equipment | Asset | Dr | CO |  |
| 10606010 | 1060601000 | Motor Vehicles | Asset | Dr | CO |  |
| 10607010 | 1060701000 | Furniture and Fixtures | Asset | Dr | CO |  |
| 10607020 | 1060702000 | Books | Asset | Dr | CO | Library books meeting threshold. |
| 10699010 | 1069901000 | Construction in Progress-Land Improvements | Asset | Dr | CO | Not depreciated until completed and reclassified. |
| 10699030 | 1069903000 | Construction in Progress-Buildings and Other Structures | Asset | Dr | CO | Not depreciated until completed and reclassified. |
| 10801020 | 1080102000 | Computer Software | Asset | Dr | CO | Intangible; amortized. |
| 10602991 | 1060299100 | Accumulated Depreciation-Other Land Improvements | Asset | Cr | - | Contra-asset. |
| 10604011 | 1060401100 | Accumulated Depreciation-Buildings | Asset | Cr | - | Contra-asset. |
| 10604021 | 1060402100 | Accumulated Depreciation-School Buildings | Asset | Cr | - | Contra-asset. |
| 10604061 | 1060406100 | Accumulated Depreciation-Hostels and Dormitories | Asset | Cr | - | Contra-asset. |
| 10604991 | 1060499100 | Accumulated Depreciation-Other Structures | Asset | Cr | - | Contra-asset. |
| 10605011 | 1060501100 | Accumulated Depreciation-Machinery | Asset | Cr | - | Contra-asset. |
| 10605021 | 1060502100 | Accumulated Depreciation-Office Equipment | Asset | Cr | - | Contra-asset. |
| 10605031 | 1060503100 | Accumulated Depreciation-Information and Communications Technology Equipment | Asset | Cr | - | Contra-asset. |
| 10605041 | 1060504100 | Accumulated Depreciation-Agricultural and Forestry Equipment | Asset | Cr | - | Contra-asset. |
| 10605071 | 1060507100 | Accumulated Depreciation-Communication Equipment | Asset | Cr | - | Contra-asset. |
| 10605111 | 1060511100 | Accumulated Depreciation-Medical Equipment | Asset | Cr | - | Contra-asset. |
| 10605131 | 1060513100 | Accumulated Depreciation-Sports Equipment | Asset | Cr | - | Contra-asset. |
| 10605141 | 1060514100 | Accumulated Depreciation-Technical and Scientific Equipment | Asset | Cr | - | Contra-asset. |
| 10605991 | 1060599100 | Accumulated Depreciation-Other Machinery and Equipment | Asset | Cr | - | Contra-asset. |
| 10606011 | 1060601100 | Accumulated Depreciation-Motor Vehicles | Asset | Cr | - | Contra-asset. |
| 10607011 | 1060701100 | Accumulated Depreciation-Furniture and Fixtures | Asset | Cr | - | Contra-asset. |
| 10607021 | 1060702100 | Accumulated Depreciation-Books | Asset | Cr | - | Contra-asset. |
| 10801021 | 1080102100 | Accumulated Amortization-Computer Software | Asset | Cr | - | Contra-asset. |
| 20101010 | 2010101000 | Accounts Payable | Liability | Cr | - |  |
| 20101020 | 2010102000 | Due to Officers and Employees | Liability | Cr | - |  |
| 20201010 | 2020101000 | Due to BIR | Liability | Cr | - |  |
| 20201020 | 2020102000 | Due to GSIS | Liability | Cr | - |  |
| 20201030 | 2020103000 | Due to Pag-IBIG | Liability | Cr | - |  |
| 20201040 | 2020104000 | Due to PhilHealth | Liability | Cr | - |  |
| 20201050 | 2020105000 | Due to NGAs | Liability | Cr | - | Unused balances of funds received from other NGAs (e.g. CHED/DOST project funds) -- commonly Fund Cluster 07. |
| 20201060 | 2020106000 | Due to GOCCs | Liability | Cr | - |  |
| 20201070 | 2020107000 | Due to LGUs | Liability | Cr | - |  |
| 20301050 | 2030105000 | Due to Other Funds | Liability | Cr | - | Inter-fund payable (eliminated on consolidation). |
| 20401010 | 2040101000 | Trust Liabilities | Liability | Cr | - | Scholarship/trust receipts held (e.g. TES/TDP, grants) -- Fund Cluster 07. |
| 20401040 | 2040104000 | Guaranty/Security Deposits Payable | Liability | Cr | - | Retention money / bid security. |
| 20401050 | 2040105000 | Customers’ Deposits Payable | Liability | Cr | - |  |
| 20501990 | 2050199000 | Other Deferred Credits | Liability | Cr | - |  |
| 20502990 | 2050299000 | Other Unearned Revenue | Liability | Cr | - | Fees collected in advance (e.g. tuition for next semester). |
| 20601020 | 2060102000 | Leave Benefits Payable | Liability | Cr | - |  |
| 29999990 | 2999999000 | Other Payables | Liability | Cr | - |  |
| 30101010 | 3010101000 | Accumulated Surplus/(Deficit) | Equity | Cr | - |  |
| 30101030 | 3010103000 | Contributed Capital | Equity | Cr | - |  |
| 30301010 | 3030101000 | Revenue and Expense Summary | Equity | Cr | - | Closing account only. |
| 40201040 | 4020104000 | Clearance and Certification Fees | Revenue | Cr | - |  |
| 40201130 | 4020113000 | Processing Fees | Revenue | Cr | - |  |
| 40201990 | 4020199000 | Other Service Income | Revenue | Cr | - | Sub-objects 01-06, 99 Other Service Income. |
| 40202010 | 4020201000 | School Fees | Revenue | Cr | - | Sub-objects: 01 Tuition Fees; 02 Income Collected from Students; 03 Income from Other Sources; 99 Other School Fees. |
| 40202020 | 4020202000 | Affiliation Fees | Revenue | Cr | - |  |
| 40202030 | 4020203000 | Examination Fees | Revenue | Cr | - |  |
| 40202040 | 4020204000 | Seminar/Training Fees | Revenue | Cr | - |  |
| 40202050 | 4020205000 | Rent/Lease Income | Revenue | Cr | - |  |
| 40202130 | 4020213000 | Income from Hostels/Dormitories and Other Like Facilities | Revenue | Cr | - |  |
| 40202150 | 4020215000 | Income from Printing and Publication | Revenue | Cr | - |  |
| 40202160 | 4020216000 | Sales Revenue | Revenue | Cr | - | Sub-objects incl. 01 Book Sales, 05 Sale of Accountable Forms, 06 Sale of Animals, Meat and Dairy, 99 Other Sales. Agricultural produce of IGPs typically booked here (06/99). |
| 40202161 | 4020216100 | Sales Discounts | Revenue | Dr | - | Contra-revenue. |
| 40202210 | 4020221000 | Interest Income | Revenue | Cr | - | Sub-objects: 2015 '03 Others' observed as '99 Others' (4020221099) in a 2024 SUC FAR No. 5. |
| 40202990 | 4020299000 | Other Business Income | Revenue | Cr | - |  |
| 40301010 | 4030101000 | Subsidy from National Government | Revenue | Cr | - | GAA cash allocations (NCA) received; Fund Cluster 01. |
| 40301020 | 4030102000 | Subsidy from Other National Government Agencies | Revenue | Cr | - |  |
| 40301050 | 4030105000 | Subsidy from Other Funds | Revenue | Cr | - | Inter-fund (eliminated on consolidation). |
| 40402010 | 4040201000 | Income from Grants and Donations in Cash | Revenue | Cr | - |  |
| 40402020 | 4040202000 | Income from Grants and Donations in Kind | Revenue | Cr | - |  |
| 40501040 | 4050104000 | Gain on Sale of Property, Plant and Equipment | Revenue | Cr | - |  |
| 40501090 | 4050109000 | Gain on Sale of Agricultural Produce | Revenue | Cr | - |  |
| 40601020 | 4060102000 | Sale of Unserviceable Property | Revenue | Cr | - |  |
| 40609990 | 4060999000 | Miscellaneous Income | Revenue | Cr | - | 2015 Vol III list shows 40609990 but its Ch.3 description prints 40699990 (typo in source); 2024 SUC FAR No. 5 uses 4060999000, confirming 40609990. |
| 50101010 | 5010101000 | Salaries and Wages-Regular | Expense | Dr | PS | Sub 01 Basic Salary-Civilian. |
| 50101020 | 5010102000 | Salaries and Wages-Casual/Contractual | Expense | Dr | PS |  |
| 50102010 | 5010201000 | Personnel Economic Relief Allowance (PERA) | Expense | Dr | PS |  |
| 50102020 | 5010202000 | Representation Allowance (RA) | Expense | Dr | PS | RATA (RA part). |
| 50102030 | 5010203000 | Transportation Allowance (TA) | Expense | Dr | PS | RATA (TA part). |
| 50102040 | 5010204000 | Clothing/Uniform Allowance | Expense | Dr | PS |  |
| 50102050 | 5010205000 | Subsistence Allowance | Expense | Dr | PS | Magna Carta subsistence sub-objects. |
| 50102060 | 5010206000 | Laundry Allowance | Expense | Dr | PS |  |
| 50102100 | 5010210000 | Honoraria | Expense | Dr | PS |  |
| 50102110 | 5010211000 | Hazard Pay | Expense | Dr | PS |  |
| 50102120 | 5010212000 | Longevity Pay | Expense | Dr | PS |  |
| 50102130 | 5010213000 | Overtime and Night Pay | Expense | Dr | PS |  |
| 50102140 | 5010214000 | Year End Bonus | Expense | Dr | PS |  |
| 50102150 | 5010215000 | Cash Gift | Expense | Dr | PS |  |
| 50102160 | 5010216000 | Mid-Year Bonus | Expense | Dr | PS | NOT in 2015 list; present in 2022/2024 agency FARs (5010216000/5010216001 'Mid Year Bonus - Civilian'). Added in the Updated 2019 RCA (title/normal balance per RCA UNVERIFIED; Dr by analogy). |
| 50102990 | 5010299000 | Other Bonuses and Allowances | Expense | Dr | PS | Sub-objects incl. 11 CNA Incentive, 12 Productivity Enhancement Incentive, 14 Performance Based Bonus; 38 Anniversary Bonus (observed 2022). |
| 50103010 | 5010301000 | Retirement and Life Insurance Premiums | Expense | Dr | PS | GSIS employer share. |
| 50103020 | 5010302000 | Pag-IBIG Contributions | Expense | Dr | PS |  |
| 50103030 | 5010303000 | PhilHealth Contributions | Expense | Dr | PS |  |
| 50103040 | 5010304000 | Employees Compensation Insurance Premiums | Expense | Dr | PS | ECC. |
| 50104020 | 5010402000 | Retirement Gratuity | Expense | Dr | PS |  |
| 50104030 | 5010403000 | Terminal Leave Benefits | Expense | Dr | PS |  |
| 50104990 | 5010499000 | Other Personnel Benefits | Expense | Dr | PS | Lump-sums; 15 Loyalty Award (observed 2022); 99 Other Personnel Benefits. |
| 50201010 | 5020101000 | Traveling Expenses-Local | Expense | Dr | MOOE |  |
| 50201020 | 5020102000 | Traveling Expenses-Foreign | Expense | Dr | MOOE |  |
| 50202010 | 5020201000 | Training Expenses | Expense | Dr | MOOE | Sub-objects (2019): 01 ICT Training Expenses; 02 Training Expenses. |
| 50202020 | 5020202000 | Scholarship Grants/Expenses | Expense | Dr | MOOE |  |
| 50203010 | 5020301000 | Office Supplies Expenses | Expense | Dr | MOOE | Sub-objects (2019): 01 ICT Office Supplies Expenses; 02 Office Supplies Expenses. |
| 50203020 | 5020302000 | Accountable Forms Expenses | Expense | Dr | MOOE |  |
| 50203030 | 5020303000 | Non-Accountable Forms Expenses | Expense | Dr | MOOE |  |
| 50203050 | 5020305000 | Food Supplies Expenses | Expense | Dr | MOOE |  |
| 50203070 | 5020307000 | Drugs and Medicines Expenses | Expense | Dr | MOOE |  |
| 50203080 | 5020308000 | Medical, Dental and Laboratory Supplies Expenses | Expense | Dr | MOOE |  |
| 50203090 | 5020309000 | Fuel, Oil and Lubricants Expenses | Expense | Dr | MOOE |  |
| 50203100 | 5020310000 | Agricultural and Marine Supplies Expenses | Expense | Dr | MOOE |  |
| 50203110 | 5020311000 | Textbooks and Instructional Materials Expenses | Expense | Dr | MOOE |  |
| 50203210 | 5020321000 | Semi-Expendable Machinery and Equipment Expenses | Expense | Dr | MOOE | Sub-objects 01 Machinery, 02 Office Eqpt, 03 ICT Eqpt, 04 Agri & Forestry, 07 Communications, 10 Medical, 12 Sports, 13 Technical & Scientific, 99 Other. Recognized upon issuance (ICS). |
| 50203220 | 5020322000 | Semi-Expendable Furniture, Fixtures and Books Expenses | Expense | Dr | MOOE | Sub-objects 01 Furniture and Fixtures, 02 Books. |
| 50203990 | 5020399000 | Other Supplies and Materials Expenses | Expense | Dr | MOOE |  |
| 50204010 | 5020401000 | Water Expenses | Expense | Dr | MOOE |  |
| 50204020 | 5020402000 | Electricity Expenses | Expense | Dr | MOOE |  |
| 50205010 | 5020501000 | Postage and Courier Expenses | Expense | Dr | MOOE | Shown as 'Postage and Courier Services' in 2022 DENR FAR. |
| 50205020 | 5020502000 | Telephone Expenses | Expense | Dr | MOOE | Sub-objects 01 Mobile; 02 Landline. |
| 50205030 | 5020503000 | Internet Subscription Expenses | Expense | Dr | MOOE |  |
| 50205040 | 5020504000 | Cable, Satellite, Telegraph and Radio Expenses | Expense | Dr | MOOE |  |
| 50206010 | 5020601000 | Awards/Rewards Expenses | Expense | Dr | MOOE | Sub 02 Rewards and Incentives (observed 2022). |
| 50207020 | 5020702000 | Research, Exploration and Development Expenses | Expense | Dr | MOOE | Sub-objects (2019): 01 ICT RE&D; 02 RE&D. |
| 50211010 | 5021101000 | Legal Services | Expense | Dr | MOOE |  |
| 50211020 | 5021102000 | Auditing Services | Expense | Dr | MOOE |  |
| 50211030 | 5021103000 | Consultancy Services | Expense | Dr | MOOE | Sub-objects (2019): 01 ICT Consultancy Services; 02 Consultancy Services. |
| 50211990 | 5021199000 | Other Professional Services | Expense | Dr | MOOE | Job orders / contract of service often charged here (agency practice). |
| 50212010 | 5021201000 | Environment/Sanitary Services | Expense | Dr | MOOE |  |
| 50212020 | 5021202000 | Janitorial Services | Expense | Dr | MOOE |  |
| 50212030 | 5021203000 | Security Services | Expense | Dr | MOOE |  |
| 50212990 | 5021299000 | Other General Services | Expense | Dr | MOOE | Sub (2019): 01 Other General Services-ICT Services; 99 Other General Services. |
| 50213020 | 5021302000 | Repairs and Maintenance-Land Improvements | Expense | Dr | MOOE |  |
| 50213040 | 5021304000 | Repairs and Maintenance-Buildings and Other Structures | Expense | Dr | MOOE | Sub-objects 01 Buildings, 02 School Buildings, 06 Hostels and Dormitories, 99 Other Structures. |
| 50213050 | 5021305000 | Repairs and Maintenance-Machinery and Equipment | Expense | Dr | MOOE | Sub-objects 02 Office Eqpt, 03 ICT Eqpt, 04 Agri, 11 Medical, 14 Technical & Scientific, 99 Other. |
| 50213060 | 5021306000 | Repairs and Maintenance-Transportation Equipment | Expense | Dr | MOOE | Sub 01 Motor Vehicles. |
| 50213070 | 5021307000 | Repairs and Maintenance-Furniture and Fixtures | Expense | Dr | MOOE |  |
| 50213210 | 5021321000 | Repairs and Maintenance –Semi-Expendable Machinery and Equipment | Expense | Dr | MOOE |  |
| 50213220 | 5021322000 | Repairs and Maintenance-Semi-Expendable Furniture, Fixtures and Books | Expense | Dr | MOOE |  |
| 50214010 | 5021401000 | Subsidy to NGAs | Expense | Dr | MOOE |  |
| 50214020 | 5021402000 | Financial Assistance to NGAs | Expense | Dr | MOOE |  |
| 50214050 | 5021405000 | Financial Assistance to NGOs/POs | Expense | Dr | MOOE |  |
| 50214990 | 5021499000 | Subsidies-Others | Expense | Dr | MOOE | Observed in a SUC FY2024 FAR 1-A (FC 01) for a ₱98.4M line, likely FHE/RA 10931 transfer (inference, UNVERIFIED). |
| 50215010 | 5021501000 | Taxes, Duties and Licenses | Expense | Dr | MOOE |  |
| 50215020 | 5021502000 | Fidelity Bond Premiums | Expense | Dr | MOOE |  |
| 50215030 | 5021503000 | Insurance Expenses | Expense | Dr | MOOE |  |
| 50216010 | 5021601000 | Labor and Wages | Expense | Dr | MOOE |  |
| 50299010 | 5029901000 | Advertising, Promotional and Marketing Expenses | Expense | Dr | MOOE | 2015 title 'Advertising Expenses'; title as used in 2022 agency FAR (2019 RCA modified title). (2015 title: Advertising Expenses) |
| 50299020 | 5029902000 | Printing and Publication Expenses | Expense | Dr | MOOE |  |
| 50299030 | 5029903000 | Representation Expenses | Expense | Dr | MOOE |  |
| 50299040 | 5029904000 | Transportation and Delivery Expenses | Expense | Dr | MOOE |  |
| 50299050 | 5029905000 | Rent/Lease Expenses | Expense | Dr | MOOE | Sub-objects 01 Rents-Buildings and Structures, 02 Land, 03 Motor Vehicles, 04 Equipment, 05 Living Quarters, 06 Operating Lease, 07 Financial Lease (2015); 08 Rents-ICT Machinery and Equipment (observed 2022). |
| 50299060 | 5029906000 | Membership Dues and Contributions to Organizations | Expense | Dr | MOOE |  |
| 50299070 | 5029907000 | Subscription Expenses | Expense | Dr | MOOE | Sub-objects observed 2022: 01 ICT Software Subscription, 02 Data Center Service, 03 Cloud Computing Service, 04 Library and Other Reading Materials Subscription Expenses, 99 Other Subscription Expenses. |
| 50299080 | 5029908000 | Donations | Expense | Dr | MOOE |  |
| 50299990 | 5029999000 | Other Maintenance and Operating Expenses | Expense | Dr | MOOE | Sub 01 Website Maintenance; 99 Other MOOE (2024 SUC FAR uses 5029999099; 2015 had 02). |
| 50301020 | 5030102000 | Interest Expenses | Expense | Dr | FE |  |
| 50301040 | 5030104000 | Bank Charges | Expense | Dr | FE |  |
| 50402010 | 5040201000 | Cost of Sales | Expense | Dr | n/a (direct cost) | IGP/business-type operations. |
| 50501020 | 5050102000 | Depreciation-Land Improvements | Expense | Dr | n/a (non-cash) |  |
| 50501040 | 5050104000 | Depreciation-Buildings and Other Structures | Expense | Dr | n/a (non-cash) |  |
| 50501050 | 5050105000 | Depreciation-Machinery and Equipment | Expense | Dr | n/a (non-cash) |  |
| 50501060 | 5050106000 | Depreciation-Transportation Equipment | Expense | Dr | n/a (non-cash) |  |
| 50501070 | 5050107000 | Depreciation-Furniture, Fixtures and Books | Expense | Dr | n/a (non-cash) |  |
| 50501990 | 5050199000 | Depreciation-Other Property, Plant and Equipment | Expense | Dr | n/a (non-cash) |  |
| 50502010 | 5050201000 | Amortization-Intangible Assets | Expense | Dr | n/a (non-cash) |  |
| 50503020 | 5050302000 | Impairment Loss-Loans and Receivables | Expense | Dr | n/a (non-cash) |  |
| 50503070 | 5050307000 | Impairment Loss-Inventories | Expense | Dr | n/a (non-cash) |  |
| 50504040 | 5050404000 | Loss on Sale of Property, Plant and Equipment | Expense | Dr | n/a (non-cash) |  |
**Specific UNVERIFIED items in the list:**
- **50102160 Mid-Year Bonus.** It is not in the 2015 RCA. It is used as 5010216000/5010216001 "Mid Year Bonus - Civilian" in DENR FAR 2022. It was therefore added by the 2019 update; the exact RCA title wording is UNVERIFIED.
- **Prepaid Subscription.** The PRC 2023 FS notes list "prepaid subscription" under Prepayments, so a 2019-era account exists. Its **code is UNVERIFIED** and it is not in the 2015 list; until confirmed, use 19902990 Other Prepayments.
- **5029921000 "Legal Defense Expenses".** It appears in DENR FAR 2022 and is not in the 2015 RCA. The code 50299210 is UNVERIFIED in the RCA.
- **Equity.** The NGA RCA has **no GL titled "Government Equity"**. "Government Equity" is the *sub-major group* (301 01) containing 30101010 Accumulated Surplus/(Deficit) and 30101030 Contributed Capital; no 30101020 exists in 2015. LGU charts differ. Whether 2019 added a GL here is UNVERIFIED.
- **Biological assets.** Biological assets (10701xxx bearer, 10702xxx consumable) exist in 2015 but were restructured by COA Circular 2020-004 (depreciable bearer biological assets). They are omitted here; verify them before use if the SUC has a farm or livestock.

### 2B. PPE pairing: accumulated depreciation, depreciation expense, useful life, and CO budget object

The depreciation expense GL is per **class** (50501020/40/50/60/70/99), with the asset type identified by sub-object. Example: 5050105003 Depreciation – M&E – ICT Equipment. The sub-objects are from Vol III 2015 Ch.2.

**Sources for useful life:**
- **(a)** COA Circular **2003-007** (11 Dec 2003), *Revised Estimated Useful Life in Computing Depreciation for Government PPE*, Annex A "Table of Estimated Useful Life of PPE". COA Circular 2015-002 (8 Mar 2015) ¶6.1.6.4 states that 2003-007 useful lives "shall continue to be used until revoked/amended". SUCs cite it in their 2023 FS notes, e.g. Benguet State University: "uses the Schedule on the Estimated Useful Life of PPE by classification under COA Circular No. 2003-007".
- **(b)** GAM Vol I (2015), Ch.10 Sec.27(f) guideline ranges:
  - Infrastructure 20–50 yrs
  - Buildings and Other Structures 30–50
  - Machinery and Equipment 5–15
  - Motor vehicles 5–15
  - Furniture, Fixtures and Books 2–15
  - Other PPE 2–15
  - Land improvements: over the life of the asset improved or of the improvement, if shorter

  The entity sets specific lives, copy furnished to the COA auditor and GAS.

**Residual value:** at least 5% of cost (GAM Vol I). **Depreciation start:** a full month if the asset is available for use on or before the 15th of the month; otherwise from the next month. **Method:** straight-line, monthly.

**About COA Circular 2017-004:** searches indicate it is a circular on **GC (government corporation) financial reporting**, not useful lives. No useful-life annex under 2017-004 for NGAs was found, so citing it for useful lives is UNVERIFIED and probably wrong.

The 2003-007 values below come from search-result extracts of the COA-hosted and BLGF-hosted copies of Annex A. The full PDF could not be downloaded (403).

**Confirmed values:**
- Office Equipment 5
- Furniture & Fixtures 10
- IT Equipment-Hardware 5
- Library Books 5
- Machineries 10
- Agricultural, Fishery & Forestry Equipment 10
- Communication Equipment 10
- Medical, Dental & Laboratory Equipment 10
- Technical & Scientific Equipment 10
- Sports Equipment 10
- Motor Vehicles 7
- Land Improvements 10
- Buildings: Concrete 30, Mixed 20, Wood 10

**Not retrieved (UNVERIFIED):** Semi-concrete buildings, "Other Machinery and Equipment", Firefighting equipment.

| PPE account | Accum. Depreciation | Depreciation expense (sub-object) | Estimated useful life (COA) | CO budget object (UACS, as seen in agency FARs) |
|---|---|---|---|---|
| 10601010 Land | 10601011 (Accum. Impairment only) | n/a | Not depreciated | 5060401001 Land |
| 10602990 Other Land Improvements | 10602991 | 50501020 | 10 yrs (2003-007: Land Improvements) | 5060402099 Other Land Improvements |
| 10604010 Buildings | 10604011 | 50501040 (sub 01 Buildings) | Concrete 30 / Mixed 20 / Wood 10 yrs (2003-007); GAM range 30-50 yrs | 5060404001 Buildings |
| 10604020 School Buildings | 10604021 | 50501040 (sub 02 School Buildings) | Same building table: Concrete 30 / Mixed 20 / Wood 10 yrs | 5060404002 School Buildings (INFERRED sub-object) |
| 10604060 Hostels and Dormitories | 10604061 | 50501040 (sub 06) | Per building material (Concrete 30) | 5060404006 Hostels and Dormitories |
| 10604990 Other Structures | 10604991 | 50501040 (sub 99) | Per material (UNVERIFIED per item) | 5060404099 Other Structures |
| 10605010 Machinery | 10605011 | 50501050 (sub 01) | 10 yrs (Machineries) | 5060405001 Machinery |
| 10605020 Office Equipment | 10605021 | 50501050 (sub 02) | 5 yrs | 5060405002 Office Equipment |
| 10605030 Information and Communications Technology Equipment | 10605031 | 50501050 (sub 03) | 5 yrs (IT Equipment-Hardware) | 5060405003 ICT Equipment |
| 10605040 Agricultural and Forestry Equipment | 10605041 | 50501050 (sub 04) | 10 yrs (Agricultural, Fishery and Forestry Equipment) | 5060405004 Agricultural and Forestry Equipment |
| 10605070 Communication Equipment | 10605071 | 50501050 (sub 07) | 10 yrs | 5060405007 Communications Equipment |
| 10605110 Medical Equipment | 10605111 | 50501050 (sub 11) | 10 yrs (Medical, Dental and Laboratory Equipment) | 5060405011 Medical Equipment |
| 10605130 Sports Equipment | 10605131 | 50501050 (sub 13) | 10 yrs | 5060405013 Sports Equipment |
| 10605140 Technical and Scientific Equipment | 10605141 | 50501050 (sub 14) | 10 yrs | 5060405014 Technical and Scientific Equipment |
| 10605990 Other Machinery and Equipment | 10605991 | 50501050 (sub 99) | UNVERIFIED (2003-007 row not retrieved) | 5060405099 Other Machinery and Equipment |
| 10606010 Motor Vehicles | 10606011 | 50501060 (sub 01) | 7 yrs | 5060406001 Motor Vehicles |
| 10607010 Furniture and Fixtures | 10607011 | 50501070 (sub 01) | 10 yrs | 5060407001 Furniture and Fixtures |
| 10607020 Books | 10607021 | 50501070 (sub 02) | 5 yrs (Library Books) | 5060407002 Books |
| 10699010 Construction in Progress-Land Improvements | n/a | n/a | Not depreciated | (charged to the asset's CO object) |
| 10699030 Construction in Progress-Buildings and Other Structures | n/a | n/a | Not depreciated | 5060404001/002 (charged to building CO object) |
| 10801020 Computer Software | 10801021 (Accum. Amortization) | 50502010 Amortization-Intangible Assets | UNVERIFIED (entity-determined) | 5060602000 Computer Software |
The CO budget objects in the last column were observed in DENR FAR 1-A 2022 and JHCSC FAR 1-A FY2024. The exceptions are 5060404002, which is inferred from the parallel sub-object pattern, and the CIP rows. The CO side also has **5060405015 "ICT Software"** under the M&E Outlay, plus 5060602000 Computer Software under the Intangible Assets Outlay.

---

## 3. Fund clusters

**Source:** GAM Vol I (2015), Ch.2 Sec.13 "Fund Accounting", verbatim: "The books of accounts shall be maintained by fund cluster as follows". Composition is per Annex P of Vol I, which was not retrieved. COA Circular 2015-002 ¶5.5 lists the same clusters by name.

| Code | Description (GAM Vol I) | What a SUC typically books here |
|---|---|---|
| **01** | Regular Agency Fund | GAA appropriations: new general, continuing, supplemental and automatic appropriations (e.g. RLIP), plus unprogrammed. Received as NCA in **Cash–MDS, Regular** (10104040) / **Subsidy from National Government** (40301010). JHCSC's FY2024 FAR 1-A (FC 01) shows a ₱98.409M "Subsidies – Others" (5021499000) line, which matches its FC 05 FAR No. 5 "Income from Other Sources" (4020201003) of ₱98.409M. This is *likely* the Free Higher Education (RA 10931) tuition reimbursement flowing from FC 01 into IGF; that reading is an inference and UNVERIFIED. |
| **02** | Foreign Assisted Projects Fund | GAA-funded foreign-assisted projects (loan proceeds). Rare for SUCs. |
| **03** | Special Account – Locally Funded/Domestic Grants Fund | Special Accounts in the General Fund (SAGF). Rare for SUCs. |
| **04** | Special Account – Foreign Assisted/Foreign Grants Fund | Rare for SUCs. |
| **05** | Internally Generated Funds | **SUC income retained under RA 8292 §4(d)**, i.e. the **Special Trust Fund (STF)/IGF**: tuition and other school fees, rentals, IGP income, interest. Funding source in FAR No. 2 is "05-2-06-441 (Off-Budgetary Funds – Retained Income/Funds – SUCs)" (UP Baguio FAR 2, 2015). In 2024 the label is "05 – Internally Generated Funds" in FAR No. 2 and No. 5 (UP Tacloban, JHCSC). Budget execution uses BURS/RBUD, not ORS/RAOD. |
| **06** | Business Related Funds | Business-type/auxiliary enterprise income kept separately, e.g. Benguet State University's "Business Type Income – Off-Budgetary Funds". Revolving funds also go here (agency practice; Annex P composition UNVERIFIED). |
| **07** | Trust Receipts | Inter-Agency Transferred Funds (IATF) and other trust receipts. Examples: CHED/UniFAST TES and TDP grants, DOST/PCAARRD project funds, TESDA training subsidies, scholarship donations (JHCSC FY2024 FAR No. 5, FC 07). Typical GLs are Trust Liabilities 20401010, Due to NGAs 20201050 and Guaranty/Security Deposits 20401040. COA Circular 2015-002 splits this cluster into "Trust Receipts other than IATF deposited with the National Treasury" vs "... deposited with AGDBs". |

**SUC-specific notes:**
- RA 8292 (Higher Education Modernization Act of 1997) §4(d) allows the governing board to retain and disburse SUC income, which feeds the STF/IGF.
- GAM Vol I Ch.3 §18 prescribes the **Registries of Budget, Utilization and Disbursements (RBUD)** for "retained income authorized under R.A. 8292 for SUCs", revolving funds and trust receipts. FAR No. 2/2-A, the Statement of Approved Budget, Utilizations, Disbursements and Balances, is prepared for "income authorized by law to use, such as OWWA/SUCs, duly approved by their Board of Trustees/Regents".
- **DV/JEV numbering embeds the fund cluster.** GAM Vol I gives the DV number format `00-0000-00-000000`: Fund Cluster, Year, Month, Serial. The serial is "one series per fund cluster for each year".

---

## 4. UACS code segments

**Sources:**
- COA-DBM-DOF Joint Circular 2013-1 (6 Aug 2013), which created the UACS
- JC 2014-1 (7 Nov 2014), which enhanced the Funding Source and MFO/PAP codes and added the fund cluster prefix
- COA-DBM-DOF JC 2017-1 (11 Aug 2017), which changed the 15-digit MFO/PAP code to a Cost Structure/PAP code for FY2018 PREXC
- GAM Vol I
- Observed SUC FARs

The DBM and UACS sites were unreachable (503), so segment *names* are from GAM, secondary sources and observed codes. The UACS totals **54 digits**: 8 (funding source) + 12 (organization) + 9 (location) + 15 (PAP) + 10 (object). The 54-digit total is per the DBM UACS Primer as quoted in search results.

### 4.1 Funding Source Code (8 digits) = Fund Cluster (2) + Financing Source (1) + Authorization (2) + Fund Category (3)

| Segment | Digits | Values |
|---|---|---|
| Fund cluster | 2 | 01–07 (Section 3) |
| Financing source | 1 | 1 = General Fund; 2 = Off-Budgetary Funds (observed "05-2-06-441 Off-Budgetary Funds – Retained Income/Funds – SUCs"); 3 = Custodial Funds (UNVERIFIED) |
| Authorization | 2 | Per GAM Vol I Ch.3 Sec.2(c), the UACS codes for the approved budget: 01 New General Appropriations; 02 Continuing; 03 Supplemental; 04 Automatic; 05 Unprogrammed Funds; 06 Retained Income/Funds; 07 Revolving Funds; 08 Trust Receipts |
| Fund category | 3 | e.g. 101 = Specific Budgets of NGAs; 102 = Retirement and Life Insurance Premiums (as paired with 04); 441 = SUCs (retained income). The full list is in the UACS Manual and was not retrieved. |

**Examples (observed):**
- **01101101**: FC 01 Regular Agency Fund, 1 General Fund, 01 New General Appropriations, 101 Specific Budgets of NGAs. It appears as "Specific Budgets of National Government Agencies 01101101" in the Iloilo State College of Fisheries FAR 1, Q1 2019, and as the GAM Vol I LDDAP-ADA numbering example `01101101-10-001-2014`.
- **01104102**: Retirement and Life Insurance Premiums (automatic appropriation), same FAR.
- **05206441**, written 05-2-06-441: IGF, Off-Budgetary, Retained Income, SUCs (UP Baguio FAR 2, 2015).
- **01105462**: "Unprogrammed Appropriations – For payment of Personnel Benefits (UACS 01105462)" (UP Tacloban FAR 1, 2024).

### 4.2 Organization Code (12 digits) = Department (2) + Agency (3) + Operating Unit (7: OU class 2 + lower-level OU 5)

- Department **08 = State Universities and Colleges**.
- **Examples:**
  - J.H. Cerilles State College `08 084 0000000`, printed "08 084 0000000"
  - UP System `08-008-00-00000`
  - Iloilo State College of Fisheries `08 062 0000000`, printed "080620000000"

  All are from the FY2019 and FY2024 FARs.
- GAM Vol I Ch.4 Sec.7 adds a **3-digit responsibility-center code for major offices/departments**, giving a 15-digit code. Its example is "31 000 0100000 000" (COA Central Office, NG sector). An FMIS can use these 3 digits for colleges or campuses.
- OU class values (e.g. 01 = Central Office) are inferred from the GAM example. Campus OU code assignment for SUCs is UNVERIFIED and is assigned by DBM.

### 4.3 PAP code (15 digits): Cost Structure / Program-Activity-Project (JC 2017-1, PREXC)

**Structure as inferred from observed codes. Segment names are UNVERIFIED.**

`C O PP SS T NNNNN XXX`:
- C = cost structure: 1 GAS, 2 STO, 3 Operations
- O = organizational outcome
- PP = program
- SS = sub-program
- T = type: 1 = activity (the 2 = locally-funded project and 3 = foreign-assisted project values are UNVERIFIED)
- NNNNN = activity/project number
- XXX = sub-activity

**Observed SUC codes (identical structure FY2019 → FY2024; no "2024+" structural change was found):**
- `100000000000000` General Administration and Support; `100000100001000` General Management and Supervision
- `200000100001000` Auxiliary Services (STO)
- `310000000000000` OO: Relevant and quality tertiary education…; `310100000000000` Higher Education Program
- `310100100001000` Provision of Higher Education Services. In FY2024 this is the line "including ₱15,850,000 for Tulong-Dunong" at JHCSC; the regular line is `310100100002000`.
- `320200000000000` Research Program; `320200100001000` Conduct of Research Services
- `330100000000000` Technical Advisory Extension Program; `330100100001000` Provision of Extension Services
- Advanced Education Program / Provision of Advanced Education Services appears by name in the UP Tacloban 2024 FAR. Its code was not captured; it is probably `310200100001000`, which is UNVERIFIED.

**Example:** `310100100002000`, Provision of Higher Education Services (JHCSC FY2024 FAR No. 2).

### 4.4 Location code (9 digits)

Region (2) + Province (2) + City/Municipality (2) + Barangay (3), based on the PSA PSGC. Example: **137404000** = NCR / Quezon City (the 9-digit PSGC). **UNVERIFIED:**
- the exact UACS location segment definition (not retrieved from the UACS Manual)
- whether UACS adopted the 10-digit PSGC introduced by PSA in 2023

### 4.5 Object code (10 digits)

RCA 8 digits + sub-object 2 digits (Section 1). **Example:** `5020301002` Office Supplies Expenses, as used in the JHCSC FY2024 FAR 1-A.

**Full 54-digit example (illustrative composition):** `01101101 | 080840000000 | <location> | 310100100002000 | 5020301002`.

---

## 5. Capitalization threshold and semi-expendable property

**PPE capitalization threshold: ₱50,000 (confirmed).**
- **Legal basis:** Section 23 of the General Provisions of **RA 11639 (GAA FY2022)** provides that "tangible items below ₱50,000.00 shall be accounted as semi-expendable property".
- **Implementing rules:** **COA Circular No. 2022-004 dated 31 May 2022**, "Guidelines on the Implementation of Section 23 of the General Provisions of RA No. 11639 ... relative to the increase in the capitalization threshold from P15,000.00 to P50,000.00".
- **Primary quotes taken from:** the COA Annual Audit Report on Bulacan Agricultural State College 2022 (Part II, Obs. 1), which quotes §4 of the circular, and the PRC 2023 FS notes. Benguet State University's 2023 notes confirm SUC application ("derecognition of PPE accounts of less than ₱50,000.00 per item ... in compliance with COA Circular No. 2022-004").
- **Superseded rule:** GAM Vol I (2015) Ch.10 Sec.3(e) and Sec.4 had P15,000.

**Key COA Circular 2022-004 rules, as quoted in the COA AAR:**
- **§4.1** Items meeting the PPE definition but costing **below ₱50,000** are recorded as **semi-expendable property**, supported by an **Inventory Custodian Slip (ICS)**. The ICS is renewed every 3 years or on change of custodian. The threshold is applied **per item**, including bulk acquisitions (library books, small equipment, computer peripherals, work animals).
- **§4.3** Items acquired before CY2022 costing ₱15,000 to <₱50,000 that were classified as PPE and already issued: charge the carrying amount to **Accumulated Surplus/(Deficit)** (NGAs) and close the related accumulated depreciation and impairment. Existing PARs serve as ICS.
- **§4.4** If such items are still in the Supply/Property unit's custody, reclassify them to the appropriate **semi-expendable** inventory account. Property Cards become Semi-Expendable Property Cards (SPC). PPE Ledger Cards become Semi-Expendable Property Ledger Cards (SPLC).
- **§4.7** prescribes new forms, registries and reports. The section was cited but not quoted; per the secondary summary, the items are 4.7.1–4.7.10.
- **§4.8** sets two categories:
  - **Low-valued**: ≤ ₱5,000 per item
  - **High-valued**: > ₱5,000 but < ₱50,000
- **§4.9** sets accountability:
  - Low-valued accountability is extinguished at the end of estimated useful life or on return.
  - High-valued accountability is extinguished only on return, or on approved relief for loss, regardless of useful life.
- **§4.12** The agency determines the estimated useful life of semi-expendable items, subject to COA post-audit, and issues a policy for it.
- **Expense recognition:** GAM Vol I Ch.8 §10 says semi-expendable items are recognized as **expense upon issuance** to the end-user.
  - The receipt is debited to 10405xxx/10406xxx (Semi-Expendable inventory).
  - Issuance is debited to 50203210 or 50203220 with the matching sub-object, and the inventory is credited.
- **Auditor finding (BASC AAR 2022):** keeping year-end balances in semi-expendable inventory for items already issued is an audit finding.

**Not verified:** a search hit mentioned a "COA Circular 2024-006" on semi-expendable property, but nothing confirming it was found. **UNVERIFIED; treat 2022-004 as current.**

---

## Sources

**Primary or official-hosted:**
- GAM for NGAs Vol III (Updated 2015), RCA: https://www.treasury.gov.ph/wp-content/uploads/2018/01/Volume-III.pdf
- GAM for NGAs Vol I: https://www.treasury.gov.ph/wp-content/uploads/2018/01/Volume-I.pdf
- COA Circular 2020-001 landing page (blocked, 403): https://www.coa.gov.ph/wpfd_file/coa-circular-no-2020-001-january-08-2020/
- COA Circular 2015-002 (useful lives continue; fund clusters; coding): https://dev.lawyerly.ph/laws/67877 (mirror of SC E-Library 10/67877)
- COA Circular 2003-007 Annex A (blocked, 403; values from search extracts): https://www.coa.gov.ph/wp-content/uploads/wpfd/preview_files/C2003-007_AnnexA(177a60cf6f66d63873a84f6202112b92).pdf and the BLGF copy https://blgf.gov.ph/wp-content/uploads/2021/05/Estimated-Useful-Life-of-PPE.pdf

**COA audit reports and agency FS notes:**
- COA AAR, BASC 2022 Part II (quotes COA Circular 2022-004): https://basc.edu.ph/wp-content/uploads/2022/05/10-BASC2022_Part2-Observations_and_Recomm.pdf
- BASC 2024 Notes to FS: https://basc.edu.ph/wp-content/uploads/2025/09/09-BASC2024-Part-1-Notes-to-Financial-Statements.pdf
- Benguet State University 2023 Notes to FS: https://bsu.edu.ph/wp-content/uploads/TS2023/Notes-to-Financial-Statements-for-the-year-ended-December-31-2023.pdf
- PRC Notes to FS CY2023: https://www.prc.gov.ph/sites/default/files/Notes%20to%20Financial%20Statements%20for%20CY%202023.pdf

**SUC Financial Accountability Reports (FY2024):**
- JHCSC FAR 2: https://jhcsc.edu.ph/wp-content/uploads/2025/10/DEC.2024-FAR-2.pdf
- JHCSC FAR 1-A: https://jhcsc.edu.ph/wp-content/uploads/2025/10/DEC.2024-FAR-1A-CONTINUING.pdf
- JHCSC FAR 5 (IGF): https://jhcsc.edu.ph/wp-content/uploads/2025/10/Far-No.-5-4th-Quarter-IGF.pdf
- JHCSC FAR 5 (Trust Receipts): https://jhcsc.edu.ph/wp-content/uploads/2025/10/Far-No.-5-4th-Q-Trust-Receipts.pdf
- UP Tacloban FAR 1: https://www.uptacloban.edu.ph/wp-content/uploads/2026/07/UP-Tacloban_RAOD-SUMMARY-GF-01-CURRENT-2024-Q4-as-of-Dec-31-2024_SBO-FAR-1.pdf
- UP Tacloban FAR 2: https://www.uptacloban.edu.ph/wp-content/uploads/2026/07/UP-Tacloban_RBUD-SUMMARY-RF-05-2024-Q4-as-of-Dec-31-2024_SBO-FAR2.pdf

**Other SUC Financial Accountability Reports:**
- ISCOF FAR 1, Q1 2019: https://isufst.edu.ph/transparencyseal/files/FAR-1-1st-quarter-2019.pdf
- ISCOF FAR 1-A, Dec 2024: https://isufst.edu.ph/transparencyseal/files/FAR%201%20A%20ending%20December%202024%20continuing%20appro.pdf
- UP Baguio FAR 2, 2015: https://bac.upb.edu.ph/wp-content/uploads/2023/01/FAR-No.2-for-1st-2nd-3rd-4th-Quarters-2015.pdf

**Agency report (secondary copy):**
- DENR FAR 1-A, Dec 2022 (Google Sheets copy; secondary, agency-prepared): https://docs.google.com/spreadsheets/d/1MiARNU47yYQH2qWH4rc-Usdmf0Da3srR/edit

**Unreachable from this environment (should be pulled manually):**
- COA Circulars 2020-001 (Annexes A–G), 2020-004, 2022-002 and 2022-004 full text, and 2003-007 Annex A full table
- DBM UACS Manual and Primer: https://www.dbm.gov.ph/wp-content/uploads/UACS/UACS-Primer.pdf
- COA-DBM-DOF JC 2013-1, 2014-1 and 2017-1
- uacs.gov.ph code lists (funding source, organization, location, PAP)
