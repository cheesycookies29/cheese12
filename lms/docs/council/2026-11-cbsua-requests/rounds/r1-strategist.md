# Strategist (gold): Round 1, CBSUA's end-user requests

**Core recommendation:** Answer the 269 items in four buckets, not one backlog. Spend the next 6–8 weeks on
the January Learn pilot and the two storage windows; build only the configuration the pilot needs and write
specs for the rest. Academic, People and Finance stay "not yet", and so does their configuration.

## 1. What the list really is

| Bucket | Items | What we do |
|---|---|---|
| Already done: Has, Configurable, or Not ATLAS | 40 + 11 + 21 = **72** | Send CBSUA an answer sheet with the screen or setting for each item. This costs nothing to build. |
| Configuration mechanisms | about 120 of the 197 Partly/Missing | Seven shared mechanisms, built once and used by every module, each released when its module's gate opens. |
| New modules, not configuration | about 70 | Recruitment (HRIS PL-015–029), PDS and plantilla (PL-014, 017), L&D and SPMS (PL-054–056), SALN (PL-035), PPMP/APP and the full procurement pipeline (FMIS PL-04, 05, 22–28, 119), fees and FHE (UIS-PL-11, 28, 39), Form 137 (UIS-PL-33), cash flows and the Notes (FMIS PL-94). Price and sequence them as contract waves. |
| Declined, with an alternative | 6 (a few overlap the rows above) | See section 4. |

Confidence is low: the list judges another vendor's demo. An ATLAS demo per office is the cheapest way to
retire items (FMIS PL-118 is one).

## 2. The configuration model, ranked by reach and effort

| # | Mechanism | Items it serves (approx.) | Fixed by law |
|---|---|---|---|
| 1 | **Import templates** (X-PL-01) | 7 directly, but they gate every go-live | Imports go through each screen's checks; posted grades only through a logged batch |
| 2 | **Lookup lists with fixed internal meanings** | ~25: UIS-PL-14, 23; HRIS PL-034, 038, 043; FMIS PL-33, 74, 107 | The label can change; the internal state cannot (a Box C status, a GAM journal) |
| 3 | **Number series**: `{CAMPUS}`, `{J}`, a reset period separate from the format | ~13: UIS-PL-59, HRIS PL-062, FMIS PL-10, 18, 20, 38, 40, 63 | Numbers are never reused or edited (COA) |
| 4 | **Report runner with .xlsx export** | ~30: UIS-PL-08, 25, 30, 36; HRIS PL-048, 049; FMIS PL-36, 39 | Statutory layouts (CHED, UniFAST, FARs) stay fixed templates; personal-data exports need a permission and are logged |
| 5 | **Document templates**: letterhead, logos, signatories by role, paper size, footnote tokens | ~55, the largest reach: UIS theme 1 (27), HRIS theme 1 (15), FMIS PL-34, 47–50, 95 | CSC, DBM and COA content, the QR code, "Nothing follows" |
| 6 | **Approval routes** with reminders and escalation | ~20: UIS-PL-05, 07, 10; HRIS PL-040–042; FMIS PL-09 | Legal steps cannot be removed or reordered; the requester never approves; the administrator is never a step |
| 7 | **Grading policy and formula** | 11: LMS-PL-10, 13, 19; UIS-PL-14 | A posted grade keeps the formula it was posted with |

What exists for each is in the maps' theme sections: CSV and .xlsx readers, a few coded lists,
`shared/numbering.js`, CSV exports, Branding and Finance's signatories, single-step approvals, the scale and
weights. Templates reach the most items but depend most on CBSUA's samples and Academic's gate. Imports, lookup
lists and number series are small and low-risk, and no CBSUA data enters ATLAS without imports, so they go first.

## 3. What the pilot needs, and what waits

January is home, Learn and System only. From this list, the pilot needs:

- **Must:** bulk import of accounts, sections and enrollments after the `node:sqlite` cut-over (X-PL-01,
  UIS-PL-13); Keycloak for everyone (an earlier gate); question import from CSV, Aiken or GIFT (LMS-PL-18, M).
  Teachers start January with VLP content, not ATLAS content, so question import is the cheap substitute for
  VLP migration.
- **Should** (all S): Available from/until on resources (LMS-PL-03); "Scored in class" (LMS-PL-20); the
  class-record printout (LMS-PL-12); .xlsx export (UIS-PL-30, one shared writer); page-leave logging as the
  first integrity option (LMS-PL-14).
- **After the pilot:** matching questions and pass marks (LMS-PL-05); rubrics (LMS-PL-16); Copy class content
  (LMS-PL-11), which is worth nothing until ATLAS holds an earlier term to copy.
- **Blocked on CBSUA:** the grade formula (LMS-PL-10, 13, 19) needs a university decision; VLP migration
  (LMS-PL-06) a sample export; FTEES (LMS-PL-15) its specification.

**Academic, People and Finance items get specs, not code:** configuration for a "not yet" module ships
nothing to a user. Finance stays frozen until `finSnap` is replaced. New collections are designed for the new
store, never added to `db.json`.

## 4. What to refuse, and the alternative to offer

| Request | Refuse because | Offer |
|---|---|---|
| Separate LMS faculty accounts (LMS-PL-07, 09; HRIS PL-004) | It goes against SSO and leaves orphan accounts | One account, with People as the source |
| Lockdown browser (LMS-PL-14) | It is false assurance | Integrity options; Safe Exam Browser later, opt-in |
| MERF auto-approval (PL-041) | Unreviewed time would reach payroll | Reminders, then escalation after N days |
| Deleting posted JEVs (FMIS PL-79) | COA requires posted entries to stay | Reversal, and "copy as a new draft" (PL-71, S) |
| Administrator in the grade route (UIS-PL-10, 12) | It breaks separation of duties | A route of academic roles |
| Hiding grades for unmet requirements (UIS-PL-52) | The DPO and legal office must decide first | Holds that block official documents instead |

## 5. Order of work, weeks 1–8 (go/no-go 2027-01-08, around week 6)

1. **Weeks 1–2:** answer sheet and requests pack out; focal persons named; AWS move rehearsed on a
   throwaway stack, then made (same commit, byte-identical `db.json`).
2. **Weeks 2–5:** `node:sqlite` store and cut-over with the 20k CI test; the January gates. In parallel, one
   developer: the Learn "Should" items, the .xlsx writer, and `{CAMPUS}` plus a reset period in
   `shared/numbering.js` (UIS-PL-59, HRIS PL-062, FMIS PL-38; S each).
3. **Weeks 5–6:** import framework (pilot lists first), question import, go/no-go.
4. **Weeks 6–8:** pilot support; signed specs for lookup lists, document templates and approval routes from
   CBSUA's samples, so building starts in the next wave.

## 6. What CBSUA must provide, and how we work with the offices

**Before building** (full lists at the end of each map), first: the campus codes; the remarks list; the
grade formula; TOR and certification samples; the approvers per office. Later: fund codes 101/161/163/164
mapped to clusters, the cashier's report samples with COA's written agreement on optional ACIC columns, the
PDS revision and the leave accrual policy.

**Working method (PL-116):** one focal person per CBSUA office and one ATLAS owner per module; the office
head signs off each configured form on a preview, tested on a staging copy with the office's sample data;
the Settings center export (`server/config.js`, `SNAPSHOT_KEYS`) is versioned per release and reviewed like
code.

## 7. What to say to CBSUA

"72 of your 269 items are already answered. About 120 become settings your offices own, delivered as each
module passes its readiness gate. About 70 are new modules we will price and schedule with you. Six we
advise against, each with a safer alternative. January is the Learn pilot; your samples and decisions set
the pace after it."

**Risks if ignored:** gated-module configuration eats the storage window; a generic form builder lets an
administrator configure ATLAS out of compliance; "configurable" is heard as "free" and new modules slip into
scope. **Success metrics:** CBSUA accepts every item's status; zero lost writes in the pilot; a new form or
number format goes live without a code release.

## Top 5 next steps, in order

1. Send CBSUA the four-bucket answer sheet and the requests pack this week. Have the offices re-rate their
   items after an ATLAS demo.
2. Make the AWS move, then the `node:sqlite` cut-over, before any CBSUA data. Add no feature that writes new
   data to `db.json`.
3. Build the import framework (accounts, sections, enrollments), with question import and the Learn "Should"
   items, for the 2027-01-08 go/no-go.
4. Ship the small shared pieces: the `{CAMPUS}` token and reset period, the .xlsx writer, and the
   lookup-list base with fixed internal meanings.
5. Name the focal persons per office, and get signed specs for document templates and approval routes, so
   the next wave starts from approved designs.
