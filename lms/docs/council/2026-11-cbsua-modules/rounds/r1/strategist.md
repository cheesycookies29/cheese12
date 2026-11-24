# Strategist (gold): Round 1, CBSUA modules

## 1. Opening perspective

ATLAS is wide but not yet deep where CBSUA needs it. There are about 426 routes over six modules, and Finance alone has about 123. The thing that would actually replace the UIS is still missing: the UIS import tool (phase 0), scheduling (3), enlistment (4) and assessment (5). None of them exist yet (ACADEMIC-PLAN §0; `server/academic.js` has no import route). The most important question from my lens is this: **what is the smallest go-live CBSUA can accept, procure and use in front of students, and how does each wave lower the risk of the next one?** My answer is to ship the low-risk, high-visibility work first and to time each cutover to a semester or fiscal-year boundary. Engineering effort should go to the critical path (import, scale, enlistment), not to more breadth. Every new feature beside that path delays the moment CBSUA can retire the UIS.

Proposed waves (calendar boundaries, today 2026-11-24):
- **W1 Jan 2027 (2nd sem start):** ATLAS home + Learn + System, with SSO against CBSUA's existing Keycloak. This replaces lms2.cbsua.edu.ph.
- **W2 Feb–Apr 2027:** People. HR records and DTR first; payroll after 2 cycles run in parallel with the current payroll.
- **W3 May–Jun 2027 (2nd sem grade posting):** Academic records, grade sheets and documents, running beside the UIS. The UIS still does enlistment and cashiering.
- **W4 Aug 2027 (AY 2027-28 enlistment):** Academic phases 3–5. This wave must not start until the scale work is done (concern 1).
- **W5 Jan 2028 (fiscal year start):** Finance. Pilot on Fund 05 (IGF) from H2 2027, then add Fund 01.

## 2. Module input

**ATLAS home.** Its value is the single front door: one sign-in and live tiles, which is the most visible "new system" moment for 20k+ users. It is ready and costs little. *Recommendation:* ship in W1 and stop polishing it (pin/compact is done). Spend the effort on SSO with CBSUA's existing Keycloak, which both the current LMS and the UIS already use, so nobody gets a new password. Launch on a `cbsua.edu.ph` subdomain, not DuckDNS: a state university will not accept a hobbyist domain in an acceptance test.

**Learn + Admin panel.** This is the safest first win. It is benchmarked screen for screen against CBSUA's current LMS and fixes that system's weak points (no enrollment, no gradebook, home page with nothing to do). Learn traffic is spread across the term, not bunched into a peak like enlistment. *Recommendation:* go live first, in W1 at the 2nd-semester boundary, with classes imported from block sections. Defer chat, question banks and certificates (BENCHMARK §4 "Next"). Move the enrollment and catalog screens out of the Admin panel only when Academic phase 3 takes them over, so they are not built twice.

**Academic (UIS).** This module has the highest value and the highest risk. It is the actual replacement for the UIS, but release 1 covers only records, grade sheets and documents. *Recommendation:* finish **phase 0 import first**, because without UIS data nothing goes live for real. Then go live with grade sheets and QR documents in W3 while the UIS keeps enlistment. Decide CBSUA open decision #7 now: **do not build the interim Academic Cashier screen**. Finance → Revenue already has OR booklets, ORs and RCDs, so Academic only produces the assessment and Finance collects. That removes duplicate work and one more migration later.

**People (HRIS).** The value is high: a multi-campus DTR with geolocation, and government payroll ported from CORE's proven engine. A payroll error, though, is the fastest way to lose faculty goodwill. *Recommendation:* in W2 go live with records, DTR, leave and self-service first, then cut payroll over only after **two parallel payroll cycles** that reconcile to the centavo. Payroll → ORS/DV can wait until Finance goes live; until then, export the payroll registers.

**Finance (FMIS).** All eight bid modules are built and the coverage is impressive. But FINANCE-PLAN §5 lists seven items that are **not yet confirmed** (COA sites were unreachable), and §4 lists gaps an SUC will notice: student fee assessment, campus books, eNGAS export, the DBM FAR templates and petty cash. Accountants and COA auditors move only at a fiscal-year boundary. *Recommendation:* freeze new Finance features. Get the CBSUA accountant and the COA resident auditor to sign off on the §5 items. Pilot on **Fund 05 (IGF)** in H2 2027 and cut over in January 2028. Close the §4 items that block go-live (fee assessment, DBM templates) before nice-to-haves (cash-flow statement, eFPS files).

**System (users, roles, audit, security monitor, SSO, Cloudflare).** This is ready, and it is a selling point in procurement: the hash-chained audit log answers the UIS's "no visible audit trail for grades" weakness, and separation of duties is enforced. *Recommendation:* no new features. Write it up as a compliance annex for the bid (Data Privacy Act, audit trail, separation of duties) and add an operations runbook that covers backup restore, key custody and update freezes.

**Facilities (planned).** Its value to CBSUA is moderate, and its scope overlaps other modules. Rooms are needed by Academic phase 3, and "property" already exists in Finance (register, PAR/ICS, depreciation). *Recommendation:* **cut it from the CBSUA scope for 2027.** Build rooms as Academic master data in phase 3, drop "property" from the Facilities description, and leave bookings and maintenance for V2 after W5.

**REX e-Reader (planned).** This is a partnership play with an external dependency. It does not help CBSUA's registrar, HR or accounting, and it has zero routes today. *Recommendation:* keep it out of contract deliverables, price it as an optional add-on, and **set the tile to hidden on CBSUA's instance** until an agreement exists. A "coming soon" tile in a government acceptance test reads as undelivered scope.

## 3. Top 3 concerns (ranked)

1. **The infrastructure is not sized for CBSUA's peaks, and the peaks are exactly when Academic must work.**
   - Sign-in capacity is about 6 per second, with a 503 past 100 waiting (README §Passwords).
   - Every change synchronously rewrites the whole `db.json`. The demo school is already 4.8 MB, and years of CBSUA grades and attendance will be far larger.
   - Sessions live in memory, and auto-update checks every 10 minutes, so an update in enrollment week signs out everyone mid-enlistment.
   - The server is one t3.small.
   - The RDS/Redis/S3 path is documented in the README (§"When one server is no longer enough") but not built.
   - *Implication:* this gates W4. Do it before phases 3–5, not after. Freezing auto-update during peak weeks costs almost nothing and should happen in W1.
2. **The Academic critical path is unbuilt, and CBSUA owes LTDC seven decisions** (ACADEMIC-PLAN §6).
   - The import tool, scheduling, enlistment and assessment do not exist.
   - Fees and FHE rules, grading, document templates and the UIS data export all have to come from CBSUA.
   - *Implication:* the go-live date depends on CBSUA's answers, not on LTDC's code. Get the decisions into the contract as client deliverables with dates, and ask for the UIS export first.
3. **Breadth is crowding out depth.**
   - Finance (about 123 routes) and planned modules (Facilities, REX) are taking effort while the UIS-replacement path is still open.
   - Finance's value depends on outside validation it does not have yet (§5 unconfirmed; §4 gaps).
   - Every "coming soon" tile is a promise that can turn into a procurement acceptance finding.
   - *Implication:* write the bid's scope as phased deliverables (W1–W5) with acceptance criteria per wave. Don't promise a big-bang "six modules live." Success metrics:
     - W1: share of the semester's classes active in Learn.
     - W2: payroll variance against the current payroll = 0.
     - W3: share of grade sheets posted without re-encoding.
     - W4: online self-enlistment rate, and zero sign-outs during peak.
     - W5: trial balance agrees with the current books, and the COA auditor accepts it.
