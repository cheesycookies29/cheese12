# Council brief: CBSUA's end-user requests, and making ATLAS configurable enough to meet them

**Mode:** meeting, with recommendations and next steps. Nothing is built yet.

## Background

After the October 15, 2026 executive meeting, CBSUA consolidated end users' feedback on the demos of the
systems it uses today. These come from another vendor, not ATLAS. There are **269 items**:
- HRIS: 67
- FMIS: 120
- LMS: 21
- UIS: 60
- Cross-system: 1

Lancaster ATLAS is meant to cover the same ground: People (HRIS), Finance (FMIS), Learn (LMS) and
Academic (UIS).

**The owner's goal:** make ATLAS **configurable enough to cater to these end-user requests**, without
writing one school's choices into the code. Then agree on the next steps.

## What to read first

1. **The maps of every item against ATLAS today**, in `../matrix/`:
   - `hris.md`
   - `fmis.md`
   - `academic-lms.md` (LMS, UIS, cross-system)

   Each row gives the item, its status in ATLAS (Has, Configurable, Partly, Missing, Not ATLAS), where it lives
   in the code, what would meet it, and the effort. Each map ends with configurability themes and questions
   for CBSUA.
2. **The earlier council on CBSUA**, which set conditions per module:
   `../../2026-11-cbsua-modules/README.md`. Its main conditions:
   - storage moves to `node:sqlite` before real volume;
   - Academic and Finance are "not yet";
   - People "not yet (4–3)".
3. **The configuration center ATLAS has today:**
   - `lms/shared/settings-catalog.js`
   - `lms/server/config*.js`
   - `lms/shared/numbering.js`
   - `lms/shared/roles.js` and the Roles & permissions editor
   - branding (school name, logo, campuses)
4. **The council on moving to a new AWS account and domain:** `../../2026-11-aws-move/README.md`. It
   competes for the same time.

## Questions for each member (through your lens)

1. **The configuration model.** Which few configurable mechanisms would serve the most items? Candidates:
   - document templates: paper size, headers, logos, signatories by role, footnotes;
   - number series: per fund, journal type or campus, with yearly reset and formats;
   - lookup lists: grade remarks, leave types, statuses, journal types, funds and fee types;
   - approval routes and approving officers;
   - grading scales and formulas;
   - import templates (CSV/Excel) for every master list;
   - report filters with Excel export.

   For each one, say what exists, what to add, and what must stay fixed by law or regulation (COA, DBM,
   CSC, CHED, BIR). An admin must not be able to configure ATLAS out of compliance.
2. **What should not be configurable,** or should be refused or redesigned, and why. For example:
   - faculty accounts managed separately in the LMS, against single sign-on;
   - a "lockdown browser" for exams;
   - auto-approving a MERF after 3–5 days;
   - deleting posted entries.
3. **Order of work.** What comes first, given the earlier council's conditions? Consider storage, the
   AWS move, and the pilot scope.
4. **What CBSUA must provide before building:** sample forms, policies, current reports, decisions.
5. **How to work with the offices.** One item asks that the provider assign a representative per office.
   Propose the working method:
   - who signs off on each configured form;
   - how the configuration is tested;
   - how changes are kept, for example as configuration exported and versioned.
6. **Your verdict on the next 6–8 weeks:** the top 5 next steps, in order.

## Rules

- **Discussion only.** Write only your own round file.
- **No personal names.** Use offices and roles; the repository is public.
- **No security-test or vulnerability details.**
- **Write your answer to** `lms/docs/council/2026-11-cbsua-requests/rounds/r1-<your-name-lowercase>.md`, about 700–1,000 words. Be concrete: cite item IDs, files and settings.
