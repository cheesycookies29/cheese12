## Advocate Position: CBSUA's end-user requests

**Core recommendation:** Read the 269 items as notes on how CBSUA's offices work. They work from paper
forms, from "what is waiting for me", and from last term's material. Give them **good presets and a few
safe controls**, not builders. Every configuration screen follows one pattern: **draft → preview with a
real record → test → publish**. The office that signs a form owns its template.

### 1. What the requests say about how people work

- **"Make it look like our form" is how offices accept work.** About 40 items ask for a header, logo,
  signatory or column to match a paper sample (UIS-PL-15, 16, 24, 50, 60; HRIS PL-001, 026, 050; FMIS
  PL-34, 47–50, 95). Offices judge the printout by holding it next to their own form, so we sign off per
  form, not per module.
- **Screens that wait (FMIS PL-58).** Lists open on a default tab, but every dropdown still needs
  **Show** or **Find** (`public/js/finance/views/accounts.js`, `budget.js`, `cards.js`). This should be one
  rule for the whole UI, not a setting: a dropdown reloads the list when it changes, a search waits for
  Enter, and every list opens on "what needs me". Size S.
- **"Blank home page" and "a full dashboard"** (FMIS PL-59, HRIS PL-013). The dashboards exist. What people
  want is their first task. Keep **Waiting for you** at the top of each role's dashboard, then show preset
  cards per role from the report definitions (HRIS PL-048). No dashboard builder: no clerk will design
  charts.
- **Settings people could not find.** UIS-PL-20 says there is "no button" for the registrar's name, but
  the setting exists. UIS-PL-32/34/43/45 are four items with one cause: the server takes a `termId`, but
  **Print** always uses the current term. Put each control where its effect is seen: a term picker and a
  "Change signatory" link on the document preview.
- **Teachers want time back, not settings:** copy last term's class (LMS-PL-11), score work done in class
  (PL-20), a printable class record (PL-12), question import (PL-18), availability windows (PL-03).
- **The applicant flow (HRIS PL-015, 016, 028, 029, 010).** No setting can meet PL-029 ("make it
  user-friendly"). Applicants come once, mostly on phones. Design it:
  - sign-up asks for name, email and password only;
  - a requirements checklist shows the limit beside each upload ("limit 2 MB; scan at 150 dpi", linked
    to PDF Studio, PL-007);
  - a status tracker with plain stages, like the "My enrollment" tracker the earlier council asked for;
  - internal applicants apply from self-service with their one account (PL-004).
- **Pop-ups (PL-065) are already met.** Toasts are announced to screen readers (`toast()` in
  `public/js/ui.js`), and forms close on save.

### 2. Configuration that serves users, and configuration that shifts work onto them

**It serves them** where the office already owns the decision:
- remarks codes (UIS-PL-14, 23);
- a CSC leave preset (HRIS PL-038);
- status labels mapped to fixed internal states (FMIS PL-33);
- header lines, logos and signatories by role;
- number formats with the live sample the Numbering screen already shows;
- report column pickers.

**It shifts work** where every user becomes a policy author:
- free activity types for each teacher (LMS-PL-10);
- WYSIWYG template editors;
- approval graphs drawn from scratch;
- dashboard builders.

The rule: **start from a preset, adjust within limits, and see the effect before saving.** For LMS-PL-10,
load the college's types into the class, let the teacher move weights within the allowed range against a
live total that must reach 100%, and show the weights to the dean on the grade sheet.

### 3. Configuration screens for office staff

1. **Draft, then publish.** Today a setting is live when saved, and history and undo come after
   (`server/config.js`). That is fine for a toggle but not for a TOR template or a grade formula. Those get
   a draft state, and publishing sets an effective date or term.
2. **Preview with a real record,** at real paper size (Legal, landscape: HRIS PL-001), side by side with
   the published version, with the changes highlighted.
3. **Test before publish.**
   - A route simulator: "a MERF from Office X goes to: Unit head → HR, with names".
   - Sample scores that show the old and the new final grade.
   - Remarks described in plain language ("Counts in GWA: no").
4. **Locked parts look locked.** A padlock and its reason ("Required for verification: QR code";
   "Prescribed by COA"), never hidden.
5. **A summary before publish:** "3 changes; applies from 2nd Semester AY 2026–2027". Statutory forms
   need a second person to approve the publish.
6. **The office owns its content.** The registrar edits the TOR, HR the payslip, Accounting the DV. The
   administrator grants access but does not edit content. Keyboard-operable throughout, with a link to
   the guide section.

### 4. Refuse or redesign, with the alternative shown

A refusal with nothing to show brings the item back. Demo the alternative each time:
- **Lockdown browser (LMS-PL-14):** named integrity options, each with what it does and does not do.
- **MERF auto-approval (PL-041):** escalation, with "waiting 4 days" on the approver's dashboard.
- **Separate LMS accounts (LMS-PL-07/09):** one account.
- **Deleting posted entries (FMIS PL-79):** "Copy as a new draft" (PL-71), because the real need is not
  retyping.
- **Hiding grades (UIS-PL-52):** hold document release instead, and show the student why and which office
  clears the hold.

### 5. Working method with each office

- **A focal person per office, and a named LTDC counterpart role** (FMIS PL-116).
- **Walkthroughs, not demos.** Spend 60–90 minutes in each office and watch one real transaction from
  paper to filing. Many items are the other vendor's bugs, so show ATLAS doing the same task with CBSUA's
  sample data (collections were never demoed, FMIS PL-118).
- **A form register:** owner office, legal basis, sample, variants, and status (configured → previewed →
  tested → signed off → live).
- **Sign-off by the head who signs the form,** and by the oversight body for statutory parts: COA for
  ACIC columns (FMIS PL-47–50), the DPO for export columns (UIS-PL-36).
- **Testing.** The office replays last month's real cases on a training copy and compares printouts with
  its paper, following a short acceptance script written with them.
- **Versioning.** Each sign-off records the configuration export it covers. Later edits go through a
  change request. An item closes only when the office has accepted it.

### 6. Order

Storage and the AWS move take the engineering time. Walkthroughs and samples cost no build time and run
alongside them. Small UI fixes that add no data volume can ship with Learn. Templates, routes and
formulas are built after the storage move, but they can be designed and prototyped now. I need drafts
and effective dates from the Architect, and maker-checker on publish from the Skeptic and Guardian.

### Top 5 next steps, in order

1. **Office walkthroughs and the form register** (weeks 1–3): Registrar, HR, Accounting, Cashier and a
   faculty group. Collect the samples in each matrix's question list.
2. **Agree the refusals and their alternatives in writing,** each shown as a demo.
3. **Ship the small fixes:**
   - auto-refreshing filters as a shared pattern (FMIS PL-58);
   - the term picker (UIS-PL-32/34/43/45);
   - repeated table headers (HRIS PL-002);
   - the class record and in-class scoring (LMS-PL-12, 20);
   - resource windows (LMS-PL-03).
4. **Prototype draft → preview → test → publish** on the Certificate of Grades and the payslip, tested
   with registrar and HR staff before it is built.
5. **Before next term:** "Copy class content" (LMS-PL-11), and an applicant-flow design session with HR
   and real applicants (HRIS PL-015, 029).
