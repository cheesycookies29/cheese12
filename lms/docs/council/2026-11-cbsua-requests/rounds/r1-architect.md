# Architect (blue) — Round 1: the configuration model

**Core recommendation:** build **one versioned-definition substrate** and put seven kinds of definition on it.
Do not add seven ad-hoc settings blobs. Every mechanism below follows one rule: *the school edits data, the
code renders it and enforces the law, and a signed or posted record keeps the version it used.*

## 0. What the code tells us

- **The Settings center (`server/config.js`) is an area store, not a version store.** It diffs a whole area,
  keeps at most 5,000 history entries (`settingsLog`), drops values over 20 kB (`MAX_KEPT`: a logo is
  "omitted" and cannot be undone), and saves through each module's route (`ctx.invoke`). That fits scalar
  settings. It does not fit templates with logos, or routes that in-flight documents depend on.
- **Two numbering engines that disagree.**
  - `server/numbering.js` (student and employee numbers, document requests) skips numbers already used. Its
    reset comes from the format's tokens (`seriesKey`).
  - Finance's `fx.nextNo` (`server/finance.js`) has its own `finCounters` key (`kind|fund|year|month`) and no
    used-set. Its formats are checked only for `{N}`, not by `formatProblem`.

  Both derive the reset period from the tokens, which is exactly FMIS PL-38/PL-40.
- **Freezing is inconsistent.**
  - Academic freezes well: `issue()` stores the whole `payload`, including `registrar` and `school`.
  - Finance freezes the signers it records (`certifiedBy`, `approvedBy`). But the printout fills every other
    slot from live settings: the JEV's "Certified correct" uses `sig('accountant')`, and the RCD and reports do
    the same (`public/js/finance/views/print.js` lines 27, 149, 159). A posted JEV reprinted after a change of
    accountant shows the new name.
- **Hard-coded lists that drive logic:** `JOURNALS`, `*_STATUS` and `FUND_CLUSTERS` (`shared/finance.js`),
  `REMARKS`, `STUDENT_TYPES` and `DOCUMENT_TYPES` (`shared/academic.js`), and `APPOINTMENTS` (`shared/gov-pay.js`).
- **Roles** (`shared/roles.js`) has overrides per type and per account, and `ADMIN_ONLY_PERMISSIONS`. It has no
  notion of *who holds an office on a date*. Yet that is what signatories (FMIS PL-23/37/41/46) and approvers
  (HRIS PL-042, UIS-PL-10) both need.

## 1. The shared substrate

```
configDefinitions  id, kind, key, module, scope{campusId?,fund?,college?,docType?}, builtInRef, ownerPermission
configVersions     definitionId, ver, status(draft|approved|retired), effectiveFrom, body(JSON),
                   bodySha256, basedOnBuiltIn(ver), draftedBy, approvedBy, approvedAt, note
configAssets       sha256, mime, bytes          (logos and seals, addressed by content)
officeHolders      officeKey (role key or finance office code), userId/employeeId, from, to, capacity(regular|OIC)
```

- **Built-ins ship in code** (`shared/builtins/*.js`), one per kind and key. Each declares a body and a lock map
  saying which parts the school may change.
  - A school version is an overlay on a built-in, checked by a per-kind `validate(body, builtIn)`.
  - The check refuses removing a locked part, the same way `keepUsed` refuses removing a fund in use.
- **Maker-checker.**
  - An administrator or ICT steward drafts a definition (`settings.edit`).
  - The owning office approves it (`ownerPermission`): the registrar for Academic forms, the Chief Accountant
    for Finance forms and series, the HRMO for HR forms.
  - The approver must not be the drafter, and the administrator never approves.

  This is how "an admin must not configure ATLAS out of compliance" becomes code rather than policy.
- **Records keep `{definitionId, ver, sha256}`** plus the resolved values they printed.
- **`officeHolders` is one table** that both signatory slots and route steps resolve through. It also takes the
  office hierarchy of FMIS PL-19 (division → unit) as a `parent` on Finance's offices.
- **Where it lives.** One new Settings-center family, *Forms, series, lists, routes, grading, imports, reports*,
  with seven AREAS rows in `settings-catalog.js` whose screen is a versions list. Each module's own screen shows
  its slice: Finance Control panel → Numbering, Academic → Settings → Documents, People → Leave types. Search,
  "changed from default" and history come from `configVersions`, not from `settingsLog` diffs.

## 2. The seven mechanisms

### 2.1 Document templates

Serves about 55 items: UIS theme 1 (27 items), HRIS theme 1 (16 items), FMIS themes 2–3. It is the largest.

- **Data model.** `body`:
  - `page{size: A4|Letter|Legal|Long, orientation, margins}`;
  - `letterhead{lines[], logos[{sha256, position}], rightBlock{formNo, revision, effectiveDate}}`;
  - `sections[]`: show, hide or reorder only the optional sections the built-in lists;
  - `columns[]` for wide tables (HRIS PL-008, ACIC PL-47–50);
  - `signatorySlots[{slot, label, resolver: role|officeHead(preparer|requesting)|permission|named, case: upper|as-is}]`;
  - `footnote` with whitelisted tokens `{generatedBy} {generatedAt} {reference} {verifyUrl}`;
  - `dateFormat`;
  - `variantOf{studentType, programLevel, campus}` (UIS-PL-02, 18).

  There is no free HTML. Renderers stay in code and read the template as parameters. Certification types the
  registrar adds (UIS-PL-56) get a body with merge fields from a per-type dictionary.
- **Versioning.** An unsigned document resolves its slots when printed. Signing or issuing freezes
  `{templateVer, sha256, letterhead lines, logo hashes, resolved names and titles}` on the record.
  - Academic: extend the `payload`.
  - Finance: add a `printModel` written at certify, obligate or post time. This fixes the live-signatory reprint
    above.
- **Export.** Approved versions, with their assets, go in the settings package (§3).
- **Fixed.**
  - The QR code and verification code, and "Nothing follows".
  - The boxes and certifications of COA, DBM and CSC forms (DV Boxes A–E, ORS Box B, the appendix numbers).
  - Data only from posted records, never typed into the document.
  - A required signature block can be relabelled but not removed.

### 2.2 Number series

Serves FMIS PL-10, 18, 20, 38, 40, 63, 64, 112, 120; HRIS PL-033, 062; UIS-PL-59.

- **Data model.** One engine replaces both:
  - `series{key, format, reset: never|calendarYear|fiscalYear|monthly, dims: [fund, subFund, journal, campus], pad, start}`;
  - a counter row `seriesCounters(key, dimValues, period, last)`;
  - an append-only `issuedNumbers(key, no, docRef, status: issued|spoiled|voided, reason)`.

  New tokens: `{F}`, `{SF}` (CBSUA's 161/164), `{J}`, `{CAMPUS}`. The reset is explicit and no longer read from
  tokens.
- **Rule.** `formatProblem` gains a uniqueness check: the format must contain a token for every dimension, and
  for the reset period when that is not *never*. Otherwise two years or two funds would print the same number.
  Existing formats migrate with the reset they have today (`{MM}` → monthly, `{YYYY}` → yearly), so nothing
  changes until an office changes it.
- **Versioning.** A format version applies only to numbers not yet issued. An issued number is the record, and
  `issuedNumbers` explains every gap (COA).
- **Export.** Formats and resets only. Counters and issued numbers are school data and never travel, the same way
  `school.portable` drops `currentTermId` today.
- **Fixed.**
  - A number is never reused or edited.
  - Counters at boot must be at least the highest number issued (the earlier council's check).
  - O.R. serials come from pre-numbered accountable forms, not from a format.

### 2.3 Lookup lists with rules

Serves FMIS theme 5, HRIS theme 2 and UIS-PL-02, 14, 23: about 25 items.

- **Data model.** `lookup{list, code, label, active, order, meaning?, rules{…}}`, with a per-list schema of
  typed rule fields. There is no expression language. Two classes:
  - **open lists**: units of measure, separation reasons, fee categories;
  - **mapped lists**: each entry maps to a fixed internal `meaning`:
    - a check status label → an internal state;
    - a journal → a GAM book;
    - a remark → `{passes, earnsUnits, inGwa, needsDeadline}`;
    - an appointment status → `{gsis, probationMonths, renewalMonths}`.
- **Versioning.** Once a code is used, its *meaning and rules are immutable*. Only the label and the order change.
  Changing behaviour means a new code plus deactivating the old one, so old TORs and GWAs never move. Records
  store the code, and official documents also store the label as printed.
- **Fixed.**
  - The internal state machines.
  - GAM books.
  - The fund clusters and ORS-for-01 / BURS-for-others mapping (JC 2013-1).
  - The CSC leave types prescribed by the omnibus rules: they can be relabelled, not removed.

### 2.4 Approval routes

Serves FMIS PL-09, 35, 55, 114; HRIS PL-040–042, 054, 059, 060; UIS-PL-05, 07, 09, 10, 52, 54: about 22 items.

- **Data model.**
  - `route{docType, scope{campus, office, fund, amountFrom}, steps[{name, resolver (as 2.1), required, remindAfterDays, escalateTo}]}`.
  - Inserted between **anchors** declared in code. The DV, for example: requester → [school steps] → Box B → Box C → Box D → Box E.
  - A per-document `docSteps(docRef, seq, stepName, resolvedTo, actedBy, decision, at, receivedAt)`. This is
    also the routing log of PL-055.
- **Versioning.** A route is snapshotted onto the document at submission. Editing a route never changes a document
  already in flight.
- **Fixed, enforced by the engine rather than per module.**
  - Anchors cannot be removed or reordered.
  - One person acts on one step per document, and the requester never approves.
  - The `admin` role can never resolve to a step on a transactional document.
  - A timeout only reminds or escalates, never auto-approves (HRIS PL-041).

### 2.5 Grading policy

Serves LMS-PL-05, 10, 13, 16, 19, 20, 21 and UIS-PL-03, 14, 23, 47.

- **Data model.** `gradePolicy`, scoped by term and optionally by college:
  - `periods[{id, weight}]`;
  - `types: schoolWide | classTypes{required[], shareMin, shareMax}`;
  - `transmutation[{rawMin, value}]`;
  - `rounding{stage, places, mode}`;
  - a reference to `academic.scale`, the lowest passing grade and the remarks list.

  Validation reuses `scaleProblems` and the 100% weight check.
- **Versioning.** A section pins the policy version when its term opens. A submitted grade sheet stores
  `{policyVer, sha256}`. Changes apply to new terms only.
- **Fixed.**
  - The grading system approved by the university's governing board: the version records the approving
    resolution number.
  - Separation of duties between approving and posting.
  - Posted grades change only through the grade-change route.

### 2.6 Import templates

Serves X-PL-01; UIS-PL-13, 35, 55; LMS-PL-01, 06, 18; FMIS PL-01, 26, 85; HRIS PL-032.

- **Data model.**
  - `importTemplate{target, columns[{header, aliases[], field, required, type, lookupList?}]}`. The school may
    rename headers and add aliases, not drop required columns.
  - `importBatches(id, target, templateVer, fileSha256, rows, accepted, rejected, by, at, status)`.
  - Every row written carries `batchId`.
- **Flow.**
  1. Parse with `shared/csv.js` or `server/pdf/office-ooxml.js`.
  2. Map the columns.
  3. Dry run through the *same domain validators* the screens use, with errors per row.
  4. Commit in one transaction.
  5. Undo the last batch only while nothing references its rows.
- **Fixed.**
  - Imports never bypass checks.
  - Legacy grades arrive as `source: legacy` and are checked per campus.
  - Imported numbers enter `issuedNumbers`, so the counters seed above them.

### 2.7 Report definitions

Serves UIS theme 3, HRIS PL-009, 013, 048, 049 and FMIS theme 3: about 30 items.

- **Data model.**
  - `report{dataset, columns[], filters[], groupBy, sort, period: day|month|quarter|year|range, layoutTemplate, exports[csv,xlsx,print]}`.
  - Datasets are named queries in code, each with a column catalog that marks personal and sensitive fields.
    Users choose columns; they never write SQL.
  - Built-in statutory reports (FAR 1/1-A/2/2-A, RAAF, ACIC, RCI, CHED list, UniFAST Form 2, BIR alphalist)
    lock their prescribed columns.
  - Dropping one needs `waivers[{column, authority, reference, date}]`, for example the COA auditor's written
    agreement on the ACIC (PL-47–50).
- **Versioning.** A certified run (RAAF, FAR, RCI) gets a number from §2.2 and a `reportRuns` row: `defVer`,
  parameters, the output's SHA-256, and the frozen output. Periods can be reopened, so a signed report must not
  regenerate differently.
- **Fixed.**
  - Agency layouts follow the agency's current form.
  - Exports with personal columns need their own permission, ask for a purpose, and are logged.

## 3. Export and import, as the working method

- **Extend today's `atlasSettings: 1` file to `atlasSettings: 2`.** The package holds:
  - the areas, as now;
  - the approved `configVersions` with their hashes;
  - the `configAssets`;
  - a manifest with the ATLAS commit and schema version.

  It is packed with `public/js/zip-store.js`.
- **Import.** Each imported definition lands as a **draft**, and the preview shows its diff against the current
  approved version. Each owning office approves its own drafts. An import never activates a Finance or Academic
  form by itself.
- **Never exported:** counters, issued numbers, `officeHolders` (people), route instances and report runs.
- **The working method (PL-116).** Each office's sign-off produces a baseline export: "Registrar forms v3,
  approved 2027-02-10". CBSUA keeps these as its versioned configuration of record. Testing means importing the
  baseline into a staging copy and printing the sample set against the office's own forms.

## 4. How this depends on `node:sqlite`

- **Can live in the heap now**, because they are small and bounded (the Tuner's tier rule): definitions, current
  approved versions, lookups and `officeHolders`. Built-ins, validators, renderers and the series engine's
  formatting can therefore be written and tested before the move.
- **Must be tables, and wait for the store:**
  - `configVersions` and `configAssets`: append-only, with logos, which `settingsLog` cannot keep.
  - `seriesCounters` and `issuedNumbers`. The number and its document must commit in one
    `BEGIN IMMEDIATE`. That is the unit of work that replaces `finSnap`. Gap-free COA numbering is unprovable
    without it.
  - `docSteps`, `importBatches` and `reportRuns`: these grow per transaction. An import through today's
    `db.save()` would rewrite `db.json` once per row.
  - Cross-campus report datasets need indexes. The earlier council measured 17–31 s scans.
- **One more dependency.** `config.js`'s `atomic()` uses the same snapshot-and-restore pattern as `finSnap`. It is
  safe only because `ctx.invoke` is synchronous. In SQLite it should become a savepoint.

## 5. Top 5 next steps (6–8 weeks), in order

1. **Week 1: a design note for the substrate.** Write the definition and version model, the lock map per kind,
   the anchors per document type and the `officeHolders` model as an ADR. In the same week, send CBSUA the sample
   and decision list from the three matrices (forms, series formats and resets, remarks, route levels, grading
   formula).
2. **Weeks 1–4: the `node:sqlite` store,** after the AWS move window. Create `configVersions`, `seriesCounters`,
   `issuedNumbers`, `docSteps`, `importBatches` and `reportRuns` from the first schema version, and use the
   synchronous unit of work that replaces `finSnap`.
3. **Weeks 3–5: one series engine.** It has an explicit reset, the `{F}` `{SF}` `{J}` `{CAMPUS}` tokens, the
   uniqueness check, the issued-numbers log and the fund passed to every `nextNo`. This is small, closes about 12
   items, and Finance and Academic both need it before any import.
4. **Weeks 4–7: document templates v1.**
   - Print profile, letterhead, several logos, signatory slots through `officeHolders`, and footnote tokens.
   - Built-ins for the TOR, COG, COE, payslip, leave form, DV, ORS/BURS and JEV.
   - The print model frozen at signing.
   - Owner sign-off, and the `atlasSettings: 2` package.
5. **Weeks 6–8: lookup lists with typed rules, plus the import framework** for accounts, students, employees and
   curricula. The remarks, student types, appointment statuses and journals move out of the code. Bulk accounts
   go in before the pilot.

Approval routes, the grading policy and report definitions are specified in step 1. They are built after this
window, once CBSUA has answered the route levels (FMIS question 11, UIS question 14), the grading formula
(UIS question 5) and the report samples.
