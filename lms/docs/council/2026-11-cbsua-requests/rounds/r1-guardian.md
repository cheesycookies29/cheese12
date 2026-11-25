## Guardian (silver), Round 1: configurable, but not out of compliance

**Core recommendation:** Make configuration a governed record, not a free-edit screen. Every configurable element carries a **prescribed level** (locked, needs concurrence, or school's choice). Each change goes through maker-checker under the owning office and lands in a change log that is never trimmed. Issued documents freeze the version they were printed with. Build this layer before the template engine. It is small, and it is what lets an office say yes to the 269 items safely.

Labels: **[M]** mandatory (law, COA or NPC exposure), **[SR]** strongly recommended, **[A]** advisory.

### 1. What configuration must never change

| Area | Fixed rule | Items it constrains |
|---|---|---|
| Numbering (COA) | **[M]** An issued number is never reused, edited or reissued. A format change or reset applies only to numbers not yet given, and the server refuses a new format that would repeat an issued number. | FMIS PL-10, 18, 20, 38, 40, 63; UIS-PL-59 |
| Posted entries (COA/GAM) | **[M]** Never deleted and never reopened. Reversal only, then "copy as new draft". | FMIS PL-71, 77–79 (refuse the delete in PL-79) |
| Separation of duties | **[M]** Box B before PO; Box C and Box D by different people; the requester never approves; whoever approves a grade sheet does not post it; a second person finalises payroll. Routes can **add** steps but cannot remove or reorder these. The administrator configures routes and is never a step in one. | FMIS PL-09; UIS-PL-10, 12; HRIS PL-042 |
| Prescribed content | **[M]** CSC forms (PDS CS Form 212, Form 6 leave, appointment, SALN), DBM forms (PSIPOP, FARs), COA forms (ORS/BURS, DV boxes, RAAF, RCI, ACIC, the COA Circular 2022-004 annexes), BIR forms (2307, alphalist, ATC and tax tables), and the CHED and UniFAST templates. These are built-in, versioned schemas. A school edits the letterhead, signatories and paper size, never the prescribed columns and certifications. | HRIS PL-014, 017, 035; FMIS PL-14, 47–50, 105; UIS-PL-26, 40 |
| Statutory tables | **[M]** Salary schedule, contribution and tax tables, and ATCs are effective-dated rows with a source citation (EO, RR or circular number). A new row never recomputes a closed period. | `shared/gov-pay.js`, Finance ATC table |
| Audit trail | **[M]** Cannot be switched off, edited or truncated. **Gap today:** `server/config.js:231` cuts `settingsLog` to 5,000 entries. That history is the evidence for every template and route change, so it must move uncapped into an append-only table with the `node:sqlite` move. | all |
| Retention | **[M]** Periods come from a signed retention matrix (NAP General Records Disposition Schedule, COA, CHED). Configuration may lengthen a period, never shorten it. Disposal of covered records needs authority to dispose under RA 9470: ATLAS lists records due for disposal and does not purge them itself. Legal hold overrides everything (reuse `legalHold`/`retainUntil` from `server/documents.js`). | all |

Refuse or redesign: auto-approval after 3–5 days (HRIS PL-041), replaced by reminder and escalation. A second account store for faculty (LMS-PL-07). An approved PO with no supplier (FMIS PL-30; a draft PO without one is fine). Dropping the ACIC's "Received/Verified/Posted by" lines (PL-49) without the auditor's written concurrence. **[A]** The "Doc. stamp paid" line (UIS-PL-24) may be evidence of documentary stamp tax paid. Ask the Accounting Office before it goes.

### 2. Guardrails the configuration needs

1. **A prescribed flag per element** (template, column, certification block, lookup value, number rule). Each carries the owning agency, a citation and a level:
   - *Locked:* changes only with a release.
   - *Concurrence:* changes only with an uploaded written concurrence from the COA auditor, CHED or another agency, plus a second approver.
   - *School:* the school sets it.

   This is the mechanism the FMIS map asks for: "the template should mark which columns are optional."
2. **Who may change what.** **[M]** Content belongs to offices, not to the administrator:
   - the Registrar: academic templates and remarks;
   - the Chief Accountant: Finance forms;
   - the Budget Officer: FARs;
   - the HRMO: HR forms;
   - the DPO: the export column catalog and the retention matrix.

   Add `templates.<area>.edit` and `templates.<area>.approve` to `shared/roles.js`, with maker ≠ checker. The `ADMIN_ONLY_PERMISSIONS` model stays: the administrator keeps the platform and holds no content approvals.
3. **The change log.** Every change records who, when, before and after, a **reason**, the approver and the version it produced. Undo and settings **import** (`config.js`) are changes too. An imported file arrives as a draft and cannot flip a locked element.
4. **Versioned templates.** Versions are immutable, each with an effective-from date, a preview with synthetic data, and a sign-off. Publishing a version never rewrites earlier ones.

### 3. Privacy of the specific requests (RA 10173)

Under Sec. 3(l) of the Data Privacy Act, *education* (grades), age, marital status, religion, health and government IDs are **sensitive** personal information. That raises the bar on most of these requests.

- **SALN (HRIS PL-035):** **[SR]** Keep it out of the pilot. The SALN carries third parties' data (the spouse and children under 18). If CBSUA later wants it in ATLAS:
  - a PIA first;
  - only the declarant and the custodian (HRMO) can see it;
  - no bulk export;
  - every view logged;
  - kept 10 years (RA 6713 Sec. 8), then the disposal list;
  - public-access requests handled outside the system under the current Ombudsman and CSC rules.
- **Masterlists in Excel (UIS-PL-36, 46; HRIS PL-048):** **[M]** Exports run only through the report runner:
  - its own permission;
  - columns from a catalog the DPO approves, with sensitive fields masked by default;
  - a purpose typed on each export;
  - a footer "exported by, on, for";
  - an export log the DPO can review.

  NPC Circular 16-01 applies these controls to government agencies.
- **Grade holds (UIS-PL-52):** **[M]** A student's right of access (Sec. 16) covers their own grades. Redesign the request as a hold on **releasing official documents** (TOR, certifications), not on viewing grades. Each hold has:
  - an office and a reason code;
  - a notice to the student;
  - a log of who placed and lifted it.

  It is never used for unpaid fees in a way that runs into RA 11984. The legal office and the DPO decide before it is built.
- **Applicants (HRIS PL-003, 015, 020):**
  - Notice at sign-up that names the pool and its retention.
  - The pool needs the applicant's opt-in, with a default of 12 months (matching the 365-day account expiry) and a purge after it.
  - The selection board's comparative assessment for a vacancy that was filled is a personnel record, kept under the matrix.
- **Exam integrity (LMS-PL-14):** **[SR]**
  - No webcam or screen capture.
  - Page-leave events are disclosed in the exam instructions, shown only to the teacher, and kept until grades are final plus the appeal window, then deleted.
  - Never the sole basis of a finding of cheating (the student handbook's due process).
  - Safe Exam Browser only on school machines, opt-in per exam.
- **Pictures on TORs (UIS-PL-22):**
  - A separate ID-photo field captured by the registrar with notice.
  - Never the self-chosen avatar (`server/account.js`), because the purposes differ.
  - Frozen into the issued payload.
  - Never returned by `/api/verify`.

  **[A]** Review whether that public answer needs the GWA (`server/academic.js:834`).

### 4. Records management: reprints keep the original header

`documentPayload` already freezes the school name, logo and registrar at issue (`server/academic.js:785–786`). That is the right principle. Extend it to every module:

1. **The issue snapshot holds:**
   - the template version id;
   - the letterhead lines;
   - the logos as **content-hashed assets**, not a data URL copied into every document;
   - each signatory's printed name, title and OIC "for" line;
   - the data.
2. **Rule:** **[M]** A **reprint renders from the snapshot.** It shows the original date, header and signatory, marked "Copy of the document issued on … , reprinted on … by …". A **current** document is a new issue with a new code. Finance prints use the signers already kept (`certifiedBy`, `approvedBy`). A period report's "head of office" (FMIS PL-37) is resolved for the report period and frozen when the report is certified.
3. **Logos and assets:** a logo referenced by an issued document is never deleted. A logo change (UIS-PL-16, Bagong Pilipinas, ISO) is a new asset with an effective date.

### 5. Governance of the working method (FMIS PL-116)

- **Per office:**
  - a process owner (the office head) signs off each configured form;
  - a focal person configures and tests it;
  - the DPO co-signs anything that touches personal data;
  - the COA auditor's written concurrence is attached for any *concurrence*-level change (ACIC PL-47–50, daily JEV PL-120).

  An LTDC representative is paired with each office but holds no production transactional powers.
- **Acceptance record per form:** the office's sample, the ATLAS preview made with **synthetic data** (never real records sent to the vendor), a checklist of the prescribed elements, the signatures, and the effective date. It is filed in ATLAS Documents under the retention matrix. Sign-off cannot waive a locked element.
- **Baseline:** a config export (`GET /api/admin/config/export`) at each release, kept with its diff. Emergency changes are ratified within 5 working days.
- **Refusals in writing:** each refused or redesigned request is answered in writing, with the reason, and CBSUA acknowledges it.

### Risks if ignored
- An admin removes a COA column or signature line; disallowance at audit. **High.**
- PII masterlists leave without a trail; a reportable breach under NPC Circular 16-03. **High.**
- Reprints show today's header and signatory; documents that can be contested, and a records-integrity finding. **Medium.**

### Dependencies
- Architect: an uncapped audit table and an asset store, in the `node:sqlite` move.
- Skeptic: a separation-of-duties conflict check in the roles editor.
- Strategist: this layer is scheduled ahead of the template work.

### Top 5 next steps, in order
1. **Weeks 1–2, no code:** a **prescribed-elements register** for every form in the three maps (agency, citation, level) and an office RACI. CBSUA signs both.
2. **Weeks 1–3:** the **DPO and legal decisions pack**:
   - SALN out for now;
   - the holds policy;
   - the export column catalog;
   - applicant pool retention;
   - the integrity-log notice;
   - ID photos.

   Also get the earlier council's **retention matrix** signed.
3. **After the storage move (not before):** the **guardrail layer** in the configuration center:
   - prescribed flags;
   - office edit and approve permissions with maker-checker;
   - the uncapped change log;
   - imports and undo that respect locks.
4. **The versioned template store with issue snapshots** and the reprint rule, first for Academic certifications and Finance report signatories.
5. **Governed export** (permission, purpose, masking, log) before any masterlist with personal data ships.
