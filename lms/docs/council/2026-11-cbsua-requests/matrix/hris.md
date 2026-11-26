# CBSUA requests mapped to ATLAS People (HRIS)

**Source:** the HRIS tab of CBSUA's punchlist from the October 15, 2026 executive meeting (items PL-001 to
PL-067). The items are end users' feedback on demos of the **current vendor's** systems, not of ATLAS.
**Read for this map:** `lms/server/hris.js`, `hris-leave.js`, `hris-finance.js`, `hris-geo.js`,
`lms/shared/gov-pay.js`, `shared/leave.js`, `shared/settings-catalog.js`, `server/config.js`,
`shared/numbering.js` with `server/numbering.js`, `shared/roles.js`, `public/js/hris/**` with `public/css/hris.css`, the
`hr`, `payroll` and `employee` guides, the README's HRIS and Government payroll sections, and the
earlier council verdict (`../../2026-11-cbsua-modules/README.md`: People "not yet, 4–3").

**What ATLAS People is today.** It covers employee records, sign-in accounts, the DTR and time clock,
clock-in locations, leave and remote-work requests, and government payroll. Payroll includes EO 64
salary grades, GSIS, PERA and RATA, loans, bonus runs, the General Payroll and remittance summaries, and
the hand-off to Finance (ORS, DV, remittance vouchers). It has **no** recruitment, PDS or 201 file,
plantilla register, performance management (IPCR), learning and development, rewards, SALN, offboarding
clearance or printable CSC forms other than the payslip and the General Payroll.

**What an administrator can configure today for People** (`shared/settings-catalog.js`, saved through
`server/config.js` with history, undo, export and import):
- HR settings: employer address and TIN, default work schedule;
- Payroll setup: system, frequency, grace period, GSIS, PERA, net-pay floor, tardiness and overtime rules,
  bonus amounts, contribution tables, tax tables, payroll fund;
- leave types: code, name, paid, annual credits, who gets it, gender, medical-certificate threshold;
- clock-in locations;
- the employee-number format (Numbering);
- permissions per account type (Roles and permissions);
- branding: school name and logo.

The following are **fixed in code**:
- appointment statuses (`APPOINTMENTS`) and deduction types (`DEDUCTION_TYPES`), in `shared/gov-pay.js`;
- HR attachment types and the 5 MB limit, in `shared/leave.js`;
- the payslip layout and its footnote;
- A4 paper in `public/css/hris.css`;
- single-step leave approval by anyone holding `leave.approve` at the campus.

Status key:
- **Has:** works as asked.
- **Configurable:** an admin can set it today.
- **Partly:** some of it exists.
- **Missing:** not built.
- **Not ATLAS:** a bug in, or the data of, the other vendor's system. The row still says whether ATLAS's
  equivalent is right.

Effort: **S** is up to about 3 days; **M** is 1–3 weeks; **L** is more than 3 weeks or a new module.

## The items

| ID | Area | Request | ATLAS today | Where | To meet it | Effort |
|---|---|---|---|---|---|---|
| PL-001 | Form templates & design | Print forms such as the IPCR and budget forms in landscape and on legal paper, not A4. | Partly | `public/css/hris.css`: the payslip is A4 and the General Payroll is A4 landscape, both hard-coded. Finance and Academic print A4 too. There is no IPCR form. | A per-form **print profile** in a new "Document templates" settings area: paper size (A4, Letter, Legal, Long), orientation and margins, applied with a named `@page`. | M |
| PL-002 | Form templates & design | Repeat the column headers on every page of multi-page tables. | Partly | The General Payroll and the register use a real `<thead>`, so browsers repeat it. Only `academic.css` forces `table-header-group`. | Make `thead { display: table-header-group }` and `tr { break-inside: avoid }` global print rules. Add a Playwright print check of a 3-page General Payroll. | S |
| PL-003 | Account management | Temporary job-applicant accounts that expire, by default after 365 days. | Has (2026-11-26) | People → Recruitment → Applicant accounts; HR settings → Job applicants (`server/recruitment.js`). Outsiders sign up from Job openings; accounts last `applicantAccountDays` (365, 30–1095), a bell warning `applicantWarnDays` before (30), closed at expiry, removed `applicantPurgeDays` after (30; 0 = keep; Selected applicants are never removed automatically); HR can extend or remove. | Done. | — |
| PL-004 | Account management | Internal staff seeking promotion or transfer apply through a separate applicant account. | Has, redesigned (2026-11-26) | Owner's decision: employees apply from People self-service → Job openings with their **own** account; the application is marked Internal and linked to their employee record (no second account). Openings can be Internal only. | Done as redesigned. | — |
| PL-005 | Account management | An offboarding flow that deactivates the account, and a rehire that reuses the existing record instead of creating a duplicate. | Partly | `server/hris.js`: record status Inactive, a date separated, and account disable or unlink exist. Duplicate employee numbers are refused. A rehire overwrites the single hire date and keeps no service history. | Separation steps: a reason from a lookup list, disable the account, end loans, then clearance (PL-060). Keep a **service record** of appointments as dated rows. On "Add employee", look for an existing person by name and birth date and offer to reactivate that record. | M |
| PL-006 | Document uploads | Accept PDF, DOC/DOCX and XLS/XLSX for documents, and JPEG, PNG and GIF for profile pictures. | Partly | HR certificates allow only PDF, JPEG, PNG and WebP (`shared/leave.js`, `ATTACHMENT_TYPES`). ATLAS Documents has a configurable file-type list (`documents.families`). There are no profile pictures in People. | One **upload policy per purpose** (leave certificate, applicant file, clearance, profile picture) in the settings catalog. Each picks file families from Documents' list (`server/dms/types.js`), which already refuses macros and scripts. | S |
| PL-007 | Document uploads | A 2 MB cap per upload, with a clear error and advice on compressing or splitting the file. | Partly | The HR limit is 5 MB, fixed in code (`MAX_ATTACHMENT_BYTES`), with a clear error. Photos are shrunk in the browser (`public/js/hris/attachments.js`). Learn and Documents have their own MB settings. | Put the size in the same per-purpose upload policy and generate the message from the rule ("limit 2 MB; scan at 150 dpi or split the file"). PDF Studio already compresses and splits PDFs: link to it from the error. | S |
| PL-008 | Payroll & remittances | Payslip and summary layouts that fit many deduction and earning columns. | Partly | `public/js/hris/views/payroll-gov.js`: the payslip lists any number of deductions as rows. The register and General Payroll have fixed columns, with loans in one column. A4 only. | A per-template column set for the register and General Payroll (choose and group columns, e.g. "GSIS loans" as one column), on the Legal or landscape print profile (PL-001). | M |
| PL-009 | Payroll & remittances | Remittance reports generated automatically from processed payroll. | Partly | The Remittances tab gives a summary and a CSV per agency (`payroll-gov.js`), and the Finance tab makes remittance vouchers (`server/hris-finance.js`). They are not the agencies' own upload formats. | **Export templates per agency**: column order and headers for GSIS, PhilHealth, Pag-IBIG and the BIR 1601-C/alphalist, kept as data so a format change is an update to the template, not to code. | M |
| PL-010 | User support | Inline advisories for upload errors, account-creation steps and file limits. | Partly | Errors are specific (e.g. "The file is too large … The limit is 5 MB"), and forms have hints. There is no applicant sign-up to guide. | Show the limits from the upload policy (PL-006/007) beside each file field, and a step list on the applicant sign-up when it is built. | S |
| PL-011 | Login & authentication | Login with Keycloak does not work. | Not ATLAS | The vendor's integration. ATLAS has OIDC sign-in with Keycloak (PKCE, signature checks), "Set up for me" and "Test connection" (`server/sso.js`, `server/keycloak-admin.js`). | Nothing to build. Use the January Keycloak gate from the earlier council and test it against CBSUA's realm. | — |
| PL-012 | Login & authentication | Login verification could be bypassed through "forgot password". | Not ATLAS | A security defect in the vendor's system. ATLAS has no self-service password reset: staff reset passwords, or Keycloak handles it. | Nothing to configure. Treat it as a security test item; Keycloak self-service reset is already a January gate. | — |
| PL-013 | Dashboard | A full dashboard with charts of the data in the system. | Partly | `public/js/hris/views/dashboard.js`: headcount, today's attendance, requests, the latest payroll, and bar lists by department and status. No trends, and nothing by sex, age, salary grade or appointment. | Dashboard cards fed by the report definitions of PL-048: headcount by any field, joiners and leavers by month, leave use, tardiness. Pick cards per role. | M |
| PL-014 | Plantilla creation | Plantilla fields per DBM's Personal Services Itemization and Plantilla of Personnel (PSIPOP); HR to give the sample. | Has (2026-11-26), columns to confirm with HR's sample | People → Plantilla (`server/plantilla.js`, `shared/plantilla.js`): one record per DBM item no. (recorded as issued, unique), position, SG, authorized and actual annual salary (`salaryFor`), office, campus, fund source, status (Filled / Vacant / Unfunded / Abolished), incumbent linked to the employee record; filters, totals, CSV; printable PSIPOP (Legal landscape, repeated headers, signatories, Nothing follows). The PSIPOP columns are one list (`PSIPOP_COLUMNS`) to match HR's sample. Existing free-text item numbers moved into the register (unknown ones as drafts to review). | Confirm the columns, area code/type/level values and signatories with HR's PSIPOP sample. | S |
| PL-015 | Recruitment | Applicants can track the progress of their application. | Has (2026-11-26) | People → My applications → **See its progress** (`server/recruitment.js`, `shared/recruitment.js`): a tracker of the school's recruitment stages (done, current, to come, with dates; a vertical list on phones), the current stage's description, HR's notes (signed "HR office") and the outcome; the bell links to it. Stages are a lookup list with fixed meanings (HR settings → Recruitment stages; Settings center): in-progress stages HR adds, renames, reorders and retires (never deletes once used); outcomes Selected, Not qualified, Not selected, Withdrawn with fixed meanings. HR moves applications forward, back one stage with a reason, or to an outcome, one or several at once, with a note and an internal remark; history per application; counts per stage. Earlier statuses migrated with their history. | Done. Default stages (received → screening → assessment → deliberation → final decision) to confirm against the school's merit selection plan; an applicant pool ("pooled") is not an outcome yet. | — |
| PL-016 | Registration | Remove Branch, document upload and Employee ID from the applicant registration. | Missing | No applicant registration. | Make the registration fields a **field list** an admin can show, hide or require (like Academic's admission requirements), so this request is a setting. | S (within module) |
| PL-017 | User profile, 201 file | Profile fields per the 2026 version of the PDS (CSC Form 212). | Missing | `EMPLOYEE_FIELDS` in `server/hris.js` covers about 40 personal, employment, pay and ID fields. There is no family, education, eligibility, work experience, voluntary work, training or references. | A structured **PDS** (repeating sections), versioned by CSC revision, so that a new CSC version adds a schema rather than rework. It prints as the CSC form. Employees edit it, and HR verifies changes. | L |
| PL-018 | Recruitment | Different criteria for faculty and non-teaching positions, per CBSUA policy; there is no EETE rating. | Missing | — | **Rating templates per position category** (faculty, non-teaching, and others): EETE criteria with weights and point scales, from CBSUA's merit selection plan. | M (within module) |
| PL-019 | Recruitment | Produce an applicant profile. | Missing | — | The applicant profile is the PDS subset plus attachments and ratings. It prints from a template. | S (within module) |
| PL-020 | Recruitment | Move disqualified and unselected applicants to a "pool of applicants". | Missing | — | A pool status, with a configurable retention period (privacy), searchable by qualifications for later vacancies. | S (within module) |
| PL-021 | Recruitment | Rating computations for the competency exam, interview, work sample test and performance rating. | Missing | ATLAS has the pattern in Learn: activity types with weights that must total 100% (`server/admin.js`). | Reuse that pattern for rating templates: components with weights, a score per assessor, and averaging rules. A comparative assessment report per vacancy. | M (within module) |
| PL-022 | Recruitment | Each applicant can upload attachments. | Missing | ATLAS Documents stores files, but nothing is linked to applicants. | A requirements checklist per vacancy (like Academic's admission requirements), under the applicant upload policy (PL-006). | S (within module) |
| PL-023 | Employee 201 file | The PDS also generates the Work Experience Sheet. | Missing | — | A WES template filled from the PDS work-experience rows. | S (after PL-017) |
| PL-024 | Certificate | The certificate has the wrong header; use the updated version. | Not ATLAS | The vendor's certificate header. ATLAS People issues **no** HR certificates (employment, service record). Headers elsewhere come from Branding (school name, logo). | When HR certificates are added, take the header from the template's letterhead (PL-026) so updates are made in configuration. | — |
| PL-025 | Recruitment | Generate the appointment form, certificate of assumption, oath of office (Panunumpa sa Katungkulan) and their PDFs from the selected applicant's data. | Missing | — | **Document templates with merge fields** (name, position, item no., SG/step, salary from `gov-pay.js`, dates, appointing officer from signatories). Generate them on "Appoint", and make the person an employee. | M |
| PL-026 | Header | Headers should be dynamic and easy to update. | Partly | School name and logo (Branding), the employer address and TIN (HR settings), the campus, and Finance's entity name and address. There is no letterhead (lines such as "Republic of the Philippines", the office, the form or ISO code, the revision date). | One **letterhead** per document template: lines, logo, right-hand block (form no., revision, effective date). It is versioned with an effective date, so old printouts keep their header. | M |
| PL-027 | HR posting | Job postings include the monthly salary and the other details of CSC's publication format. | Partly (2026-11-26) | A vacant plantilla item has "Post a job opening", which fills the item no., title, SG and campus (2026-11-26). Job openings show the monthly salary from the salary grade, the plantilla item no. and the CSC qualification standards; the CSC publication print format is still to come. The salary for an SG and step is available (`salaryFor` in `shared/gov-pay.js`). | Vacancy posting from a plantilla item, with the salary filled in automatically, printed in the CSC publication format template. | M |
| PL-028 | Applicant account | Ask only for basic information when creating the account. | Has (2026-11-26) | Applicant sign-up asks only for name, email, username, password and (optional) mobile. No applicant accounts. | Covered by the field list in PL-016: sign-up asks for name, email and password; the rest comes with the application. | S (within module) |
| PL-029 | Applicant account | Make the applicant workflow user-friendly. | Partly (2026-11-26) | A first applicant flow exists (Job openings → sign up → apply → My applications); to be reviewed with HR and applicants. No applicant workflow. Academic's admission flow is the house pattern. | Design the flow with CBSUA's HR office and test it with applicants. Not a setting. | — (within module) |
| PL-030 | Applicant account | Dates as dd/mm/yyyy per the CSC PDS format. | Partly | Screens show "Aug 7, 2026" (`fmtDate` in `public/js/ui.js`). Date inputs follow the browser's locale, and data is stored as YYYY-MM-DD. | A **date-format setting per printed form** (the PDS prints its own format), leaving storage alone. Confirm the format the current PDS uses (see the questions). | S |
| PL-031 | PDS | Change the format to CSC's updated PDS. | Missing | See PL-017. | See PL-017 (a versioned PDS schema and print template). | (in PL-017) |
| PL-032 | PDS | An "add another" button at the bottom of repeating sections (trainings and so on). | Missing | See PL-017. | Part of the PDS editor: an add button after each repeating section, plus a CSV import for long training lists. | (in PL-017) |
| PL-033 | Employee records | Generate the employee number automatically. | Has | `server/numbering.js` (`employeeNo`): the next free number is suggested on a new record and given if left blank. Its format is under Settings → Numbering. | — | — |
| PL-034 | Employee records | Show the probationary period. | Partly | Private mode has a "Probationary" status. The government appointment list (`APPOINTMENTS`) has none, and no record has a probation end date. | Appointment statuses become a lookup list with **rules**: probation months, renewal months. The record shows "probation ends …" and an alert (PL-053). | S |
| PL-035 | SALN | Use the new SALN version. | Missing | — | A SALN template (versioned) with declarant and spouse sections. SALN is sensitive: decide first whether ATLAS should hold it (privacy impact assessment). | M |
| PL-036 | Leave | Update the leave form header. | Missing | ATLAS prints no leave application (CSC Form 6). Requests are on screen only. | A printable leave application from a template, with the letterhead (PL-026), the credits certification and the recommending and approving signatories (PL-042). | S |
| PL-037 | Leave | Show a prompt when no leave credits are available. | Has | `buildRequest` in `server/hris-leave.js` refuses with "Not enough … credits: n day(s) left". The request form shows the days left. | — | — |
| PL-038 | Leave | Sick, Vacation, Forced, Special Privilege and Wellness Leave must be available. | Configurable | Leave types (`/hris/#/leave`, `leaveTypes` area). The defaults are private-sector: SL, VL, Emergency, Maternity, Paternity, **SPL = Solo Parent Leave**, LWOP. There is no Forced Leave rule (taken from VL, forfeited if not used). | HR can add Special Privilege and Wellness Leave now. Add a **CSC leave preset** for government schools (fixing the SPL code clash) and a "charged to another type" rule for Forced Leave. | S |
| PL-039 | Leave | New employees do not earn leave credits automatically. | Partly | `leaveBalances` gives every employee the type's full annual credits from 1 January. HR can override credits per person and year. There is no accrual. | **Accrual rules per leave type**: front-loaded or monthly (1.25 days a month of service), the start (hire date, or after N months), and proration. It also gives CSC-correct balances. | M |
| PL-040 | MERF | A MERF for employees with no lunch in/out entries. | Missing | One time in and time out per day, with a fixed break (`validateEntry`). Only HR corrects the DTR. There is no employee correction request. | A new request kind, **attendance correction (MERF)**: the employee files the missing punches with a reason, and approval writes them into the DTR (like leave). Optionally four punches a day. | M |
| PL-041 | MERF | Treat a MERF as approved if not acted on within 3–5 days. | Missing | There is no timeout or escalation. | Do not auto-approve, since it would let unreviewed time into payroll. Add **reminders and escalation** in the approval route (after N days, remind, then pass to the alternate approver), with N as a setting. | S |
| PL-042 | MERF | Approving officers and signatories can be chosen or added by hand. | Partly | Approvers are any account with `leave.approve` at the campus (`decidersFor` in `server/notifications.js`). The roles editor can grant it. There are no per-office approvers, no recommending step, and no names on forms. Finance has named signatories. | **Approval routes** per request type: steps (recommending, approving), each resolved to the office head, a named officer or a role, with an OIC/delegate. The signatory names print on the form. | M |
| PL-043 | WFH | Flexible schedules for employees' different work patterns. | Partly | Each employee has one schedule (shift, break, work days) plus FLEX. Remote work is requested per date range. There are no rotating or alternating patterns. | **Schedule patterns** as a lookup list (e.g. 4-day compressed week, alternating WFH weeks), with dated assignment to employees. Remote days follow the pattern without a request when the policy allows. | M |
| PL-044 | WFH | A WFH monitoring form with targets and accomplishments. | Missing | Remote work records days only. | A WFH accomplishment report per remote day or week (targets, accomplishments, supervisor sign-off), from a template. It is attached to the remote request. | M |
| PL-045 | Payroll | Add a division showing the salary's source of funds, for filtering. | Partly (2026-11-26) | Plantilla items carry a fund source (fund cluster and fund from Finance's lists) and the register filters by it; payroll filtering and the ORS split by fund are still to come. One payroll fund for everyone (`gov.payrollFund`). `department` is free text. Finance has funds and offices lists. | A **fund source** per employee or plantilla item (fund cluster + office/PAP from Finance's lists). Filter the register by it and split the ORS by fund. | M |
| PL-046 | Late | Convert lateness with the CSC conversion table. | Partly | `computeGovPayslip`: a minute is 1/480 of a day and the total is rounded to 0.001. The CSC table rounds per minute (e.g. 30 min = 0.062), so results can differ by 0.001. | A **conversion table** setting (built-in CSC table as the default), used for leave charges and deductions. | S |
| PL-047 | Late | Proportional deductions for faculty. | Missing | Faculty are paid like other staff, from the work schedule. The README lists teacher leave rules (proportional vacation pay) as not included. | Faculty rules from CBSUA's policy: deductions based on the teaching load, and vacation service credits. Selected per category (`teaching`). | M |
| PL-048 | All modules | Generate the personnel complement and personnel profile automatically. | Partly | Dashboard counts by department and status. The employee CSV export filters by department, status and category. | **Report definitions** (fields, grouping, filters) with print and Excel export: complement by office, SG, appointment, sex, age band, education (after the PDS). | M |
| PL-049 | All modules | Generate lists of new and separated employees automatically. | Partly | `hireDate` and `separationDate` are stored. There is no report. | A preset report in PL-048: joiners and leavers for a period, by campus and office, in the format CBSUA files. | S |
| PL-050 | Payslip | Follow the CBSUA payslip format, with signatories. | Partly | A fixed layout (`govPayslipCard` in `payroll-gov.js`): logo, employer, address and TIN, a "received by" line, and no signatories. | A payslip template: sections and labels, signatory slots (e.g. the HRMO, the accountant from Finance's signatories), and the print profile. | M |
| PL-051 | Payslip | The payslip footnote says who generated it. | Partly | The footer says "system-generated by [school]", without the user or the time. | Footnote tokens in the template: `{generatedBy}`, `{generatedAt}`, `{reference}`. Default: "Generated by … on …". | S |
| PL-052 | Employment type | A plantilla position does not automatically mean permanent. | Has | The appointment status (`APPOINTMENTS`) is separate from the plantilla item. Nothing infers permanence from the item. | Keep this when the plantilla register (PL-014) is built. | — |
| PL-053 | Prompts | Alerts for employees due for renewal or evaluation, based on the appointment date. | Missing | There is no appointment end date or evaluation date. The bell (`server/notifications.js`) exists. | **Date-based alerts**: rules per appointment status (renewal N days before the end, probation evaluation, step increment every 3 years, retirement). They go to the bell and a "due" list. | M |
| PL-054 | Learning & development | Link the IDP to training applications. | Missing | — | Part of an L&D module: an IDP per employee per year, and training applications linked to IDP items, through the approval routes (PL-042). | L (module) |
| PL-055 | Learning & development | No L&D module was presented. | Missing | — | L&D module: trainings, participants, attendance, certificates; training hours feed the PDS. ATLAS Learn can host training content. | L (module) |
| PL-056 | Performance management | Link the IPCR to L&D when the required rating is not met. | Missing | There is no performance management. Payroll can leave a person out of a bonus with the remark "rating below Satisfactory". | SPMS/IPCR module with rating periods. A rule (configurable threshold) creates an IDP item when the rating is below it. The rating feeds bonus eligibility (PEI). | L (module) |
| PL-057 | All modules | All modules must be linked. | Partly | Leave writes to the DTR, the DTR feeds payroll, payroll goes to Finance (ORS, DV, remittances), and Learn accounts link to employees. Recruitment, PDS, PM and L&D do not exist yet. | Build the missing modules on the employee record and the plantilla item, not as separate stores. | (in others) |
| PL-058 | Rewards & recognition | Improve rewards and recognition. | Missing | — | A rewards register (award, date, basis), shown in the 201 file, per CBSUA's PRAISE policy. | M |
| PL-059 | Microtransactions | Requests are available and carry a "system-generated" footnote. | Partly | Leave and remote-work requests exist. There are no requests for certificates (COE, service record) and no printed request slips. | A **request catalog** (types from a lookup list, each with an approval route and output template), with the system-generated footnote token. Academic's document requests are the pattern. | M |
| PL-060 | Offboarding | Allow uploads of supporting documents such as the clearance. | Missing | Separation is only a date and an Inactive status. | A **clearance checklist** per separation (offices to sign off, from a list), with attachments under the upload policy. The record cannot be closed until it is complete. Finance accountabilities (property, cash advances) are already in ATLAS. | M |
| PL-061 | Login & authentication | The generated username differs from the one in the credentials email. | Not ATLAS | The vendor's account email. ATLAS sends no email: HR types or accepts the username, and it is shown on screen when the account is created (`POST /api/hris/employees/:id/account`). | None now. If ATLAS starts sending credential emails, fill them from the saved account, not from the form. With Keycloak, there is no ATLAS password to send. | — |
| PL-062 | Employee ID | Employee ID numbering follows CBSUA's scheme. | Configurable | Settings → Numbering, `employeeNo` (tokens `{YYYY}` `{YY}` `{MM}` `{N}`; yearly reset). The year is the date the number is given, not the hire year, and there is no campus token. | If CBSUA's scheme needs them, add `{CAMPUS}` and hire-year tokens. Otherwise this is a setting now. | S |
| PL-063 | WFH scheduling | WFH scheduling follows the policy and stays flexible. | Partly | See PL-043. | See PL-043. Policy limits (e.g. at most N WFH days a week) become checks on the remote request. | (in PL-043) |
| PL-064 | Participants page | Make the add button easy to notice. | Not ATLAS | A UI detail of the vendor's page. ATLAS's pattern puts the main action as a filled button in the page head ("Add employee", "File a request"). | Keep that pattern for the future L&D participants screen. | — |
| PL-065 | Notifications | Notifications pop up, and forms clear after saving. | Has | A toast after each save, modal forms that close on save, and the bell for requests and decisions. | — | — |
| PL-066 | Application | The EETE rating must not exceed 100%. | Not ATLAS | A computation bug in the vendor's system. ATLAS has no EETE. Its weighted-scheme precedent (Learn grade weights) refuses totals other than 100%. | Apply the same validation to rating templates (PL-018/021). | — |
| PL-067 | Leave | A leave request cannot go ahead without enough credits. | Has | Filing is refused when credits are short. Approval re-checks the balance. HR recording past leave needs an explicit "Allow going over the balance" tick. | — | — |

## Configurability themes

One configurable mechanism each, grouped by the items it would serve.

### 1. Document templates and print layout

Paper, orientation, repeated headers, letterhead, logo, signatories, footnotes, merge fields.
**Items:** PL-001, 002, 008, 023, 024, 025, 026, 027, 030, 035, 036, 044, 050, 051, 059 (and the PSIPOP print in 014).

**Today:**
- Branding sets the school name and logo.
- HR settings set the employer address and TIN.
- Finance has an entity name and address and named **signatories** (head, accountant, budget, cashier).
- Academic has the registrar's name and title.
- Every layout is in code, and paper size is fixed in CSS (A4, the General Payroll A4 landscape).

**To add:** a "Document templates" area in `settings-catalog.js`. Per form:
- print profile;
- letterhead lines and right-hand block (form no., revision), versioned by effective date;
- signatory slots bound to an office or role;
- footnote tokens;
- column sets for wide tables.

What the law fixes (the content of CSC, DBM and COA forms) stays in the built-in template. The school configures the header, signatories and paper.

### 2. Lookup lists and the rules attached to them

**Items:**
- appointment statuses with probation and renewal rules: PL-034, 052, 053;
- leave types with accrual, a CSC preset and "charged to" rules: PL-038, 039;
- offices and fund sources: PL-045;
- position categories: PL-018, 047;
- separation reasons: PL-005;
- request types: PL-059;
- schedule patterns: PL-043, 063;
- the CSC conversion table: PL-046.

**Today:**
- Leave types are a full admin list (credits, paid, who gets it, gender, certificate rule).
- Payroll setup holds the tardiness rule and the leave type charged.
- `APPOINTMENTS`, `DEDUCTION_TYPES` and employment statuses are **constants in code**.
- `department` is free text, though Finance has an offices list.

**To add:**
- make those constants lists, with flags (e.g. "job order: no GSIS"), kept read-only where law fixes them;
- People should use Finance's offices and funds rather than a second list.

### 3. Approval routes and approving officers

**Items:** PL-004, 040, 041, 042, 054, 059, 060 (and the "Appoint" step in 025).

**Today:**
- One step: any account with `leave.approve` at the employee's campus decides.
- Nobody may decide their own request (`notOwnRecord`).
- The bell tells approvers.
- Permissions per account type can be changed in Roles and permissions.

**To add:** per request type:
- ordered steps (recommending, approving), each resolved to the office head, a named officer or a role, with an OIC/delegate and dates;
- reminders and escalation after N days instead of auto-approval;
- the signatory names on the printed form.

### 4. Structured HR forms and field lists

PDS, applicant sign-up, plantilla, rating templates.
**Items:** PL-014, 016, 017, 018, 019, 021, 023, 028, 031, 032, 066.

**Today:**
- None in People: the employee record is a fixed field list (`EMPLOYEE_FIELDS`).
- The nearest patterns are Academic's admission requirements list and Learn's weighted activity types (weights must total 100%).

**To add:**
- versioned built-in schemas for the CSC PDS and DBM PSIPOP, which are not free-form builders, so compliance holds;
- show, hide or require settings for sign-up fields;
- rating templates per position category with weights validated to 100%.

### 5. Reports, dashboards and date-based alerts

**Items:** PL-009, 013, 045, 048, 049, 053.

**Today:**
- HR dashboard counts and bar lists, and the employee CSV export.
- Remittance summaries with CSV per agency, and Finance's tax reports.
- The bell.

**To add:**
- report definitions (fields, grouping, filters, print and Excel export) and per-agency export templates;
- alert rules on dates (end of appointment, probation, step increment, retirement) delivered to the bell.

### 6. Document upload rules

**Items:** PL-006, 007, 010, 022, 060.

**Today:**
- ATLAS Documents: configurable file families and maximum MB.
- Learn: `maxUploadMb`.
- People: medical certificates fixed at PDF, JPEG, PNG and WebP, up to 5 MB, in `shared/leave.js`.

**To add:**
- an upload policy per purpose (leave certificate, applicant file, clearance, profile picture) that reuses Documents' families;
- error and hint text generated from the policy.

### 7. Number series

**Items:** PL-033, 062 (and new series for plantilla items in 014, applications in 015, and requests and certificates in 059).

**Today:** Settings → Numbering for `employeeNo` (with `studentNo` and `documentRequest`):
- tokens `{YYYY}` `{YY}` `{MM}` `{N}`;
- yearly or monthly reset;
- numbers in use are skipped.

Finance has its own numbering.

**To add:**
- `{CAMPUS}` and hire-year tokens;
- the new series registered in `server/numbering.js` `SERIES`.

### 8. Account lifecycle

**Items:** PL-003, 004, 005, 060, 061.

**Today:**
- Accounts can be disabled or unlinked, and Keycloak SSO is available.
- Security settings cover passwords and sessions.
- There is no expiry and no rehire history.

**To add:**
- account expiry per account type;
- service-record rows instead of one hire date;
- a duplicate-person check on add.

## Questions for CBSUA

Ask for these before building:

**Plantilla and positions**
- **PL-014 Plantilla per DBM:** the HR office to give the PSIPOP sample (current DBM format) and the current item list, with fund sources (also needed for PL-045).
- **PL-052, PL-034, PL-053:** CBSUA's appointment statuses, with the probation length and renewal period for each, and who is told before an appointment ends.

**PDS and personal records**
- **PL-017, PL-031, PL-023, PL-030 PDS:** the exact PDS revision meant by "2026 version", with a filled sample, the Work Experience Sheet sample, and the date format that revision prescribes.
- **PL-035 SALN:** the SALN form version, and whether CBSUA wants ATLAS to hold SALNs at all (the DPO to confirm under the privacy assessment).

**Forms, headers and payslips**
- **PL-024, PL-026, PL-036 headers:** the updated letterhead and the current leave application (CSC Form 6) and certificate samples, with their form or ISO codes.
- **PL-001:** the list of forms that must print on Legal or landscape, with a sample of each (the IPCR and the budget forms).
- **PL-050, PL-051 Payslip:** the CBSUA payslip sample with its signatories and footnote wording.

**Recruitment**
- **PL-018, PL-021, PL-066 Recruitment ratings:** CBSUA's merit selection plan and the selection board's rating sheets (EETE weights, exam, interview, work sample, performance rating) for faculty and for non-teaching staff.
- **PL-027 Posting:** a sample of the CSC publication format CBSUA uses.
- **PL-025:** samples of the appointment form, certificate of assumption and oath of office (Panunumpa sa Katungkulan), and the appointing and attesting officers.
- **PL-003, PL-004 Applicant accounts:** confirm the 365-day expiry. Confirm whether internal applicants really need separate accounts; the recommendation is one account with single sign-on.

**Leave and attendance**
- **PL-038, PL-039 Leave policy:**
  - whether credits accrue monthly (1.25 days) or are given at the start of the year;
  - when new hires start earning;
  - the Forced Leave rule;
  - which circular the Wellness Leave follows;
  - the vacation service credits for faculty.
- **PL-040, PL-041, PL-042 MERF:** the MERF form and policy, the approving officers per office, and acceptance of escalation instead of auto-approval after 3–5 days.
- **PL-043, PL-044, PL-063 WFH:** CBSUA's flexible work arrangement policy (allowed patterns, limits per week) and the WFH accomplishment form.
- **PL-046, PL-047 Tardiness:** the conversion table in use, and the written policy on proportional deductions for faculty.

**Payroll and remittances**
- **PL-009:** which agency upload formats CBSUA files (GSIS, PhilHealth, Pag-IBIG, BIR alphalist), with a recent file of each.

**Reports and dashboard**
- **PL-048, PL-049, PL-013 Reports:** samples of the personnel complement, the personnel profile and the new and separated employees reports, and the charts management wants.

**Numbering and uploads**
- **PL-062 Employee ID:** a sample of the CBSUA employee ID number and how it is built (campus, year hired, serial).
- **PL-006, PL-007 Uploads:** confirm the 2 MB cap (ATLAS allows 5 MB today) and whether Word and Excel files are wanted as applicant attachments.

**Performance, L&D, rewards and offboarding**
- **PL-054, PL-055, PL-056, PL-058:** the IDP form, the SPMS/IPCR forms and rating thresholds, the L&D policy, and the rewards (PRAISE) policy.
- **PL-060 Offboarding:** the clearance form and the offices that sign it.
