# PeopleOps, Round 1: CBSUA's People requests (PL-001 to PL-067)

**Jurisdiction.** CBSUA is a state university (RA 8292). For its HR, the rules come from the following:
- **CSC:** EO 292 Book V, the 2017 ORAOHRA (rev. 2018), the Omnibus Rules on Leave (MC 41 s.1998, as amended), SPMS (MC 6 s.2012) and flexible work (MC 6 s.2022);
- **DBM:** RA 11466, EO 64 s.2024, PSIPOP/NOSCA and the budget circulars;
- **GSIS:** RA 8291;
- **BIR:** RA 10963, the withholding tables, 1601-C and 2316;
- **COA:** the DTR as payroll support.

**Core recommendation:** before adding modules, make People correct under CSC and DBM rules. Lock the statutory numbers, ship a CSC leave preset with monthly accrual, and build the **service record** and **plantilla register** that everything else depends on. Recruitment, PDS, SALN and SPMS come after the two parallel payroll runs the earlier council required.

## 1. A finding first: an admin can configure ATLAS out of compliance today

I checked these in the code:
- **Statutory rates are plain settings.** `shared/settings-catalog.js` (lines 118–136) lets an admin edit these fields: `gov.gsisPersonal`, `gov.gsisGovernment` (RA 8291 §§9–10), `gov.ecc`, `gov.pera` (GAA), `gov.overtimeRegular`, `gov.overtimeRestDay` and `gov.overtimeCapPercent` (CSC-DBM JC 2 s.2004), `gov.benefitsExemptCeiling` (RA 10963), `gov.cashGift`, `gov.pei` and `gov.clothingAllowance` (DBM circulars).
- **Tardiness can skip leave credits.** `gov.tardiness` can be set to `salary`, which skips the CSC rule that tardiness and undertime are charged to VL credits first.
- **Flexible time removes undertime.** `shared/calc.js` `computeEntry` and `shared/gov-pay.js:304` give a FLEX employee **no undertime at all**. Under MC 6 s.2022, flexitime still requires 8 hours a day within the band, so a 6-hour day today pays as 8. That is a COA disallowance waiting to happen.
- **The grace period is a free number.** `payroll.gracePeriodMinutes` can be set to anything. CSC has no grace period, only official time or the approved flexi band.

**Fix:** a "statutory preset" class.
- The values come as dated, cited tables shipped by LTDC, and the admin selects the version in force.
- An override needs a reason and a second approver, and it is logged.
- The settings screen shows the citation.

## 2. Leave (PL-036–039, 046, 047, 067)

| Rule | Fixed by | Configurable |
|---|---|---|
| **The "SPL" clash.** `shared/leave.js:14` seeds `SPL` = *Solo Parent Leave*. On CS Form 6 (rev. 2020), SPL is *Special Privilege Leave* (3 days, non-cumulative, Omnibus Rules §21). Solo Parent Leave is 7 working days (RA 8972 as amended by RA 11861), needs the Solo Parent ID and 6 months of service, and is gender-neutral. | The leave types, the days and the conditions | Display codes and labels only. Internal ids (`special_privilege`, `solo_parent`) stay fixed, so a code rename never re-points history. The preset must run **before** the leave import. |
| **CSC preset.** This matches CS Form 6: VL, Mandatory/Forced, SL, Maternity (RA 11210), Paternity (RA 8187), SPL, Solo Parent, Study, VAWC (RA 9262), Rehabilitation, Special Leave Benefits for Women (RA 9710), Calamity, Adoption and Wellness. Drop the private-sector *Emergency Leave*. | Entitlements | Which optional types are active; the medical-certificate threshold, within the CSC rule |
| **Monthly accrual (PL-039):** 1.25 VL + 1.25 SL per month of actual service from assumption, the CSC daily-earnings table for part months, and reduced earnings during LWOP. The front-loaded `leaveBalances` model is wrong for government. | The rates, the tables and the start date | An opening-balance import as of the cut-over date |
| **Forced Leave:** an employee with 10 or more VL days takes 5 days a year, charged to VL. The untaken part is forfeited at year-end unless the leave was cancelled for exigency of service. | The rule | Who records the exigency exception, through the approval route |
| **Wellness Leave** | The CSC issuance | **CBSUA to confirm** the circular number and whether it stacks with SPL. Ship it as a preset row with a citation field. |
| **Late/undertime conversion (PL-046):** the CSC table for an 8-hour day (hours × 0.125 plus the minutes column, 30 min = 0.062). The code uses `round(min/480, 3)` on the period total, so results drift by 0.001. | The table itself. It must **not** be an editable setting (the map's "conversion table setting" goes too far). | Nothing. Also add a habitual-tardiness alert (MC 23 s.1998). |
| **Monetization and terminal leave:** at least 15 VL days to monetize, 5 retained; terminal leave = salary × credits × 0.0481927 | Fixed | — |
| **Faculty (PL-047):** the teachers' leave rules (proportional vacation pay and vacation service credits) unless the faculty member holds an administrative designation | The CSC framework | Per category, from CBSUA policy: the deduction basis (scheduled hours vs. teaching load plus consultation hours), the designation flag, and the service-credit grants |

## 3. Forms

The law fixes these forms' content. Schemas are built in and versioned; the school configures the letterhead, signatories, paper and date format (PL-001, 026, 030).
- **PDS, CS Form 212 (PL-017, 031, 032) and the WES (PL-023):**
  - A versioned schema, with the revision CBSUA means by "2026" to be confirmed. Admins cannot remove fields.
  - The answers to Q34–40 and the solo-parent and PWD flags are sensitive personal information. They wait for the earlier council's masking and the PIA.
  - The solo-parent answer feeds the eligibility for Solo Parent Leave.
- **SALN (PL-035):**
  - RA 6713 §8 sets the deadlines: within 30 days of assumption, by April 30 each year, and within 30 days of separation.
  - First phase: a **filing register** only (filed, received, reviewed, transmitted), with no amounts. Holding the contents waits for the DPO's decision.
- **Plantilla per DBM PSIPOP (PL-014, 045, 052):**
  - Each item carries its number, title, SG, authorized and actual salary, step, area code and type, level, incumbent, original appointment, last promotion, status and eligibility.
  - Correction to the map: **DBM issues item numbers** (through the NOSCA), so ATLAS records them as given and must not generate them from a number series. Items are never created in ATLAS, only recorded from DBM's approval.
- **Appointment papers (PL-025):** CS Form 33-A, the Oath of Office (CS Form 32), the Certification of Assumption (CS Form 4), the Position Description Form (DBM-CSC Form 1), and the monthly Report on Appointments Issued to CSC. CBSUA to confirm the revisions it uses.
- **Publication (PL-027):**
  - CS Form 9 shows the item, SG, **monthly salary** (from `salaryFor`), the qualification standards and the place of assignment.
  - RA 7041 requires posting for at least 10 calendar days, and a publication is valid for 9 months.
- **Leave and attendance forms:** the leave application (CS Form 6, PL-036) and the DTR (**CS Form 48**). The map does not list the DTR; COA requires it, and ATLAS prints none.

## 4. Recruitment (PL-003, 004, 015–022, 028, 029, 066)

**Fixed by CSC:**
- publication before filling;
- the CSC qualification standards as a floor;
- an HRMPSB constituted per CBSUA's CSC-approved Merit Selection Plan;
- the comparative assessment, with the appointing authority choosing from those assessed;
- no criteria on age, sex or religion (RA 10911).

**Configurable from the MSP:**
- the rating templates per position category (EETE, exam, interview, work sample), with weights validated to 100% (PL-066);
- the stages;
- the pool's retention period;
- the sign-up fields.

Faculty ranking also follows NBC 461, so the faculty template is a different template, not a different engine. Internal applicants apply from self-service, with no second account (PL-004).

## 5. Other HR processes

- **MERF (PL-040–042):**
  - MERF becomes an attendance-correction request that writes to the DTR.
  - **Refuse the 3–5-day auto-approval:** CS Form 48 must be verified by the supervisor, and unverified time in payroll is a COA finding.
  - Instead, a reminder after N days, then escalation to the alternate or OIC. N is configurable.
- **WFH (PL-043, 044, 063):**
  - Patterns come from CBSUA's FWA policy under MC 6 s.2022: flexiplace, compressed week and skeleton workforce. The patterns and the weekly caps are configurable.
  - **Fixed:** the 40-hour week, the accomplishment report for each flexiplace day, and the supervisor's sign-off. Today a remote day with no clock times counts as a full day without any report (`computeEntry`).
- **IPCR/SPMS and L&D (PL-054–056):**
  - **Fixed:** the 5-point adjectival scale, the semestral periods, and what follows from the rating: a development plan for Unsatisfactory, and grounds for separation after two successive Unsatisfactory ratings or one Poor.
  - **Configurable:** the success indicators, the weights of core, strategic and support functions, the IDP threshold and the PMT members.
  - The rating feeds PBB/PEI eligibility.
- **Offboarding and rehire (PL-005, 060):**
  - The clearance follows CS Form 7, with offices from a list, and Finance's accountabilities are checked automatically.
  - A rehire adds rows to the **service record**; it never overwrites `hireDate`. Step increments, the loyalty award, leave restoration and the GSIS separation report all read the service record.
  - Service-record rows are corrected by a new dated row, never edited or deleted.
- **Appointment statuses (PL-034, 053):**
  - `APPOINTMENTS` lacks *Fixed term* and *Provisional* (ORAOHRA).
  - Job order and contract-of-service workers stay outside the appointment list, since they have no employer–employee relationship. `isJobOrder` already treats them so.
  - Probation and renewal periods are rule rows on each status.

## 6. Order of work for People, given "not yet (4–3)"

1. **Correctness before features.** Statutory presets, the CSC leave preset, the conversion table and the FLEX undertime fix (all S). These change payroll numbers, so they must land **before** any parallel run.
2. **The storage move (December, owned by the Architect), then accrual and the service record (M).** Leave ledgers and DTR rows go into tables, as the earlier council required. Opening balances are imported as of the cut-over date.
3. **The shared engines with Finance and Academic:** document templates (letterhead, signatories, print profiles) and approval routes with escalation. People's first forms are CS Form 6, CS Form 48, the payslip (PL-050/051) and the service record.
4. **Two reconciled parallel payroll runs,** with the payroll checker and the masking in place. That is the earlier council's gate.
5. **Then** the plantilla register, recruitment, the PDS (after the PIA), the SALN register, SPMS/L&D and rewards. None of these fit in the 6–8 weeks, and the AWS move takes the same hands.

## 7. What CBSUA provides, and the working method

**To provide by mid-December:**
- the current PSIPOP and item list with fund sources;
- the leave policy answers (accrual, Forced Leave, the Wellness circular, faculty service credits);
- the FWA policy;
- the MSP and the rating sheets;
- a filled sample of CS Forms 6, 48, 9, 33-A and 7, the payslip and the service record;
- one recent upload file each for GSIS, PhilHealth, Pag-IBIG and the BIR alphalist.

**Sign-off on each configured form:**
- the HRMO signs every HR form;
- the Accountant signs the payslip and the remittance exports;
- the Budget Officer signs the PSIPOP and the fund sources.

**Testing and keeping changes:**
- Each form is tested against CBSUA's filled sample, reproduced field for field on its own paper, and recorded as a check in `npm test`.
- Configuration is kept through the Settings center export (`server/config.js`), versioned per release with the sign-off attached.
- Changes to the statutory presets come only through LTDC releases that cite the circular.

## Top 5 next steps, in order

1. Lock the statutory parameters into dated, cited presets. Fix FLEX undertime and the grace period, and make the CSC conversion table fixed code.
2. Ship the CSC leave preset (fixing the SPL clash, adding Forced and Wellness Leave and the Solo Parent conditions) and monthly accrual on the new store.
3. Add service-record rows and the appointment-status rule table (with Fixed term and Provisional, and JO/COS kept out). These are the foundation for rehire, alerts and the plantilla.
4. Collect CBSUA's samples and policies by mid-December, with a named office signing off on each form, and build CS Form 6, CS Form 48 and the payslip on the shared template and approval engines. MERF uses escalation, not auto-approval.
5. Run two reconciled parallel payrolls with the checker and masking. Only then open the plantilla register, then recruitment and the PDS.
