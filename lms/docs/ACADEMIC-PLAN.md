# ATLAS Academic: plan

ATLAS Academic is the student information system in the ATLAS family: admissions, curricula, enlistment, assessment, grades, records and documents. This plan benchmarks the system CBSUA uses today, the **CBSUA UIS Admin Portal** (version 2.1.261002, by Wizzard Technologies Inc.), and sets out how ATLAS Academic matches it screen for screen and where it does better.

*Method.* The UIS was explored on 6 November 2026 with the account the project was given. It was read-only: after signing in, the browser blocked every request that could change data (none were attempted), and only the structure of each screen was noted (menus, columns, fields, tabs, workflows), not the records in it. 55 menu pages and the main detail screens were reviewed. References: open-source systems [RosarioSIS](https://github.com/francoisjacquet/rosariosis), [openSIS](https://github.com/OS4ED/openSIS-Classic), [Frappe Education](https://docs.frappe.io/education/program-enrollment) and [OpenEduCat](https://openeducat.org/features/student-information-system/), and the Philippine rules on free higher education ([RA 10931](https://jur.ph/law/summary/universal-access-to-quality-tertiary-education-act), [UniFAST FHE](https://unifast.gov.ph/assets/pdf/infgrfx/FHE2024.pdf)).

## 0. Status

**Release 1 is built** (November 2026): the app at `/academic/` with student records and evaluation, curricula, colleges, grade sheets (teacher → dean → registrar), grade changes with a second approver, credited subjects, documents with QR verification, document requests, the CHED list, FHE billing details, the enrollment summary, failing/INC, dean's list and graduation candidates, and settings. It covers phases 0, 1, 6 and 7 below, most of 2 and 8, and the student self-service parts of 4 and 5 that need no fees.

Next: admissions with entrance exams (phase 2), schedule codes, block sections and rooms in Academic (3), curriculum-guided enlistment and add/drop transactions (4), fee schedules, assessment and cashiering (5), scholarships and guidance records (8), and the import tool for moving data off the UIS (0).

## 1. What the UIS has

The admin portal has a term picker in the top bar ("First Semester A.Y. 2025-2026"), a light/dark theme, and 14 menu groups:

| Group | Screens | What they do |
| --- | --- | --- |
| **Students** (monitoring) | Pre-Admitted · Admitted · Candidates for Enrollment · Old Students · Initial Requirement Validation | The admission pipeline as lists by status: applicant number, name, status (Incomplete/Completed), student type (New/Old), TOR status. A record moves **Incomplete → Completed → Admitted → Verified → Enrolled**. |
| **Waiting List** | Waiting List | Applicants waiting for a slot, by course and department; "Fetch students" by status and academic year. |
| **Analytics** | Dashboard | Enrolled students, employees, total collections; enrollment by program and sex (bar chart). |
| **Finance** | Student Master File · Collections · Account Receivable · A.R. Subsidiary Ledger · Statement of Account · Document Requests · Deposit Slips · File Reports | Cashiering with official receipts (O.R. number, status, remarks; bank and reference for non-cash; pay from advance payment; tabs for student, short-course, scholarship-group and doctoral collections), receivables by department, a per-student ledger (debit/credit/balance, adjustments), statements of account by section, deposit slips, daily collection and collection summary reports. |
| **Enrollment** | Student Master File · **Student Enlistment** · Account Receivable · Overall Enrollment Summary · **CHED Enrollment List** · Grade Sheet Monitoring | Enlistment picks student, course, curriculum, year level, recommended block section, graduating flag, max allowed units, override units, scholarship; tabs **Allowed Subjects** (school year/semester, code, name, prerequisite, credit units, back subject, taken, grade), **Class Schedules**, **Assessment**. Summary by program; CHED list by academic year, department, course, student type, year level and sex (student number, names, sex, subjects enrolled, units). |
| **Registrar** | Students Registration · List of Candidates · Subject Crediting · Subject Adjustment · Delisting Students · Grading System · Grade Sheet Monitoring · Document Requests · Requirements Monitoring · Short Courses · Grade Rectification · Student Promotion · Incomplete Grades Processing | Student record (LRN, applicant no., student type, enrollment status steps, personal information, documents such as the test permit, pre-admission course choices and exam schedule, educational background by level). Lists of scholars and grantees, candidates for graduation, official graduating students, honors, removal of INC. Crediting of subjects against a curriculum; add/drop with transaction numbers; delisting; grade equivalents (e.g. 99–100 = 1.00 Excellent … by academic level), grading periods, entrance-exam grading; document requests with purpose, reference no., O.R. and paid status; a requirements checklist per student (student directory form, Form 138, certificate of good character, medical/dental certificate, police clearance, PSA birth certificate); short courses (enrollees, schedules, class list, certificate); grade rectification; promotion to the next year level; INC processing. |
| **Academe** | Student Master File · Generate Class List · Electronic Grades | Class list by professor and schedule; grade sheets per schedule (schedule code, course, department, subject, room, building, professor, status) with **Manual Encoding** and **Dean's Approval**. |
| **Scheduling** | Schedule ID Proposal · Block Sections · Schedule List · Merge Schedules / Block | Offerings with a schedule code per subject, course, curriculum series, professor and section; block sections (course, adviser, year level, open to all); the schedule list by campus and department with room; merging two schedules or blocks. |
| **Alumni** | Alumni Master File | Alumni number, graduation date, email. |
| **Curriculum** | Curriculum List | Curricula by code, series (e.g. BSABE 2026), course, major, department, status, posted flag; a curriculum is built level by level ("Add level"). |
| **Student Services** | Student Master File · Students With Failing Grades · Scholarship/Grant Types · Scholarship Grants · Scholars Monitoring · Guidance Records | Scholarship types (sponsored or not) and grants per student; scholars assigned to departments, evaluated, attendance; failing grades by course and year level; guidance records. |
| **Examination** | Schedules · Results | Entrance-exam schedules (campus, building, room, venue) with the applicants in each, and results (application number, result, status). |
| **System Users** | Users · Roles · Permissions | Accounts linked to employees, with a role, campus access and an expiry date. |
| **Login History** | Employees · Students | IP address, action, device, platform, date. |

It runs on its own API (`api.uis.cbsua.edu.ph/api/v2/...`), with sign-in by password or Keycloak.

**Where it falls short** (what ATLAS Academic can do better):

- **The same student list appears five times** (Enrollment, Finance, Registrar, Academe, Student Services master files), each with its own view. One student record with tabs is simpler.
- **Lists are mostly "pick filters, then Fetch"**, and several work screens open empty with "No records found" until you search for a student by an icon. Work queues ("12 grade sheets waiting for you", "5 applicants missing a PSA certificate") would bring the work to the user.
- **Statuses are opaque** (Incomplete/Completed/Admitted/Verified with no reason shown in the list); the detail page says what is missing only in warnings at the bottom.
- **No visible audit trail for grades or records**, only sign-in history. Grade rectification is a form with "Save changes".
- **No conflict checking is visible** in scheduling (room, professor, student), and no capacity view.
- **Wide tables that overflow** on a laptop screen; the portal is not usable on a phone.
- Small quality issues: typos ("Academc Level", "subject-schudules"), "Mr." in front of every name, tabs labeled with icons that do not load.
- Finance and Academic are mixed in one menu; payment is a prerequisite for enrollment, but the two jobs belong to different offices.

## 2. What ATLAS already has

Much of the foundation is built and tested (57 tests, the API sweep, browser QA):

| Needed for Academic | In ATLAS today |
| --- | --- |
| One sign-in, roles, campus scope, sign-in history | ATLAS home sign-in; administrator, registrar, teacher, student, parent, HR, payroll, staff roles with permissions; campuses with a switcher; registrars limited to their campuses |
| Programs, terms, courses with prerequisites and units | Admin panel → Programs, Terms (with enrollment window), Courses (prerequisites) |
| Offerings (sections) with schedule, room, professor, capacity | Sections with meetings, capacity, teacher; schedule clash checks (`shared/schedule.js`) |
| Enlistment rules | Enrollment requests checked for the window, enrollment key, prerequisites passed, already passed/taking, schedule conflicts, max units; approval, waitlist that moves up automatically |
| Applicants | "Apply as a student" on the sign-in page; Admin → Applicants (admit, with a student number) |
| Class lists and grades | ATLAS Learn: class people list, gradebook with activity types and weights, final grade, passing grade |
| Faculty records | ATLAS People: employee records linked to teacher accounts |
| Parents | Guardian accounts that see enrollment, schedule and grades when allowed |
| Printouts, reports, CSV | Printable payslips and class pages; CSV export of attendance; print styles |

So ATLAS Academic is not a new system from scratch: it moves the registrar's screens out of the Learn admin panel into their own product and adds what a university registrar needs on top.

## 3. Design

### 3.1 Where it lives

- A fourth app at **`/academic/`**, on the same server, data file and sign-in as Learn and People, using the same shell (top bar "ATLAS · Academic", sidebar, dark mode, phone layout). The **Academic** tile on the ATLAS home page turns live.
- **Academic becomes the system of record** for students, programs, curricula, terms, offerings, enlistment and final grades. **Learn uses them**: a section created in Academic is a class in Learn; Learn's gradebook sends the term grade to Academic as a grade sheet. The catalog and enrollment screens move from the Learn admin panel to Academic (the Learn admin panel keeps modules, class settings and branding).
- **Finance stays separate** (ATLAS Finance, coming soon). Academic produces the **assessment** (what the student owes); until Finance exists, a small **Cashier** screen records a payment and an O.R. number so enlistment can complete. The fee and payment records are shaped so ATLAS Finance takes them over unchanged.

### 3.2 Roles

Existing: administrator, registrar, teacher, student, parent. New, each scoped to campuses (and colleges where noted):

| Role | Does |
| --- | --- |
| **Admissions officer** | Applications, requirements, entrance exams, admission |
| **Dean / program chair** (per college) | Curricula and offerings for the college, approves grade sheets, advising and evaluation |
| **Scheduler** | Offerings, rooms, block sections |
| **Cashier** (until ATLAS Finance) | Records payments and O.R. numbers |
| **Guidance / scholarship officer** | Scholarships, guidance records, failing-grade lists |

Teachers keep encoding grades in Learn; students and applicants get self-service.

### 3.3 Data

New collections in `data/db.json` (one file, as today), with the ones that exist reused:

| Collection | Holds |
| --- | --- |
| `colleges` | Colleges and departments (CEFS, CAS, …), with a dean |
| `curricula` | Program + **series** (e.g. BSABE 2026) + major, status draft/posted; **levels → terms → subjects** (course, lecture/lab units and hours, prerequisites, co-requisites, electives groups) |
| `studentProfiles` | Everything personal about a student account: LRN, birth date, sex, civil status, citizenship, address, contact, emergency contact, educational background by level, student type (new, old, transferee, returnee, cross-enrollee), curriculum and year level, status history |
| `applications` | Applicant pipeline: course choices (by campus), exam schedule, requirements submitted (files), status with reasons, decision |
| `requirements` | The checklist (PSA birth certificate, Form 138, good moral, medical, …) per student type, required at admission or before graduation |
| `exams`, `examResults` | Entrance-exam schedules (venue, room, capacity) and results |
| `blockSections` | A block (program, year level, adviser) and the offerings it takes together |
| `sections` (existing) | Offerings gain a **schedule code**, room, lecture/lab split, merged-with |
| `registrations` | A student's registration for a term: curriculum, year level, block, max/override units, scholarship, graduating flag, status (enlisting → assessed → paid → **officially enrolled**), with the subjects (the existing `enrollments`) |
| `feeSchedules`, `assessments` | Fees by program, year level and term (per unit, lab, miscellaneous; flags for **free tuition under RA 10931** and TOSF), and the computed assessment per registration |
| `payments` | Amount, O.R. number, method, bank reference, cashier (handed to ATLAS Finance later) |
| `gradeSheets` | Per offering and grading period: draft → submitted (teacher) → approved (dean) → **posted** (registrar); grades per student |
| `academicRecords` | The permanent record per student, term and subject: final grade, credited units, remarks (passed/failed/INC/dropped/credited), source (grade sheet, crediting, rectification) |
| `gradeChanges` | Rectifications and INC completions: old grade, new grade, reason, attachment, approvals |
| `gradingScales` | Percentage → equivalent (1.00–5.00), descriptions, by academic level |
| `documentRequests` | TOR, certificate of grades, of enrollment, of registration, good moral, honorable dismissal, CAV: purpose, copies, fee, payment, status (requested → paid → processing → ready → released), release log |
| `scholarships`, `grants` | Types (sponsored or not) and grants per student and term |
| `guidanceRecords` | Confidential notes, visible to guidance only |
| `auditLog` | Who changed what and when, for every grade, record and status change |

### 3.4 Main workflows

1. **Admissions.** An applicant applies on the ATLAS home page (exists), picks campus and program choices, uploads requirements and books an entrance-exam slot. Admissions sees a queue by status *with the reason* ("missing PSA certificate"), records exam results, and admits; the account becomes a student with a student number (exists).
2. **Curriculum.** The dean builds a curriculum level by level and term by term from the course catalog (prerequisites already exist), previews it as the **prospectus**, and posts it. Students are assigned a curriculum series.
3. **Evaluation and enlistment.** For each student and term ATLAS computes the **allowed subjects** from the curriculum: next-term subjects, back subjects (failed or not taken), prerequisites met, units within the maximum (overridable by the dean, with a reason). Students enlist themselves online, or the adviser enlists a whole block; schedule conflicts and full sections are caught (exists).
4. **Assessment and payment.** The assessment is computed from the fee schedule (free tuition and TOSF for qualified students, charged items otherwise). Payment (or a zero balance under FHE) makes the registration **officially enrolled** and prints the **Certificate of Registration** with a QR code.
5. **Classes.** Each offering is a class in ATLAS Learn with its enrolled students (exists).
6. **Grades.** At the end of the term the teacher sends the gradebook's final grades from Learn as a grade sheet; the dean approves; the registrar posts. Posted grades are locked and go to the permanent record; any later change is a **rectification** with a reason and approvals, kept in the audit log. INC grades get a deadline and are completed or lapse.
7. **Records and documents.** TOR, certificate of grades and certificates are generated from the permanent record, with a QR code that leads to a verification page. Students request documents online and follow their status; the registrar works a queue.
8. **End of term.** Promotion to the next year level, delisting (with reason), lists of failing grades, candidates for graduation (curriculum completed, requirements complete), honors (by the grading scale and the school's rules), alumni.

### 3.5 Reports

CHED enrollment list (by academic year, college, program, student type, year level, sex); overall enrollment summary; **FHE billing (UniFAST Form 2)** from officially enrolled students, *with lecture and laboratory units* (a COA finding on another SUC was that billing forms lacked the lab column); class lists; grade sheets; promotion and failing-grade lists; candidates for graduation and honors; scholars and grantees; document-request log. Every list exports to CSV and prints on A4.

## 4. Better than the UIS

| UIS today | ATLAS Academic |
| --- | --- |
| Five student master files | **One student record** with tabs (profile, admission, curriculum and evaluation, registrations, grades, documents, finance, scholarships), opened from anywhere |
| Filter-then-fetch screens that start empty | **Work queues** on each role's home: applications to review, grade sheets to approve, documents to release, INC deadlines |
| Statuses without reasons | Every status says **why** and what is next ("Admitted · waiting for PSA certificate") |
| Enlistment by staff | **Student self-enlistment** online, limited to allowed subjects, with the same checks; staff enlist only exceptions |
| Encoded grades | Grades **flow from ATLAS Learn's gradebook**; no re-encoding |
| Grade changes without a visible trail | **Audit log** on every grade, record and status change; rectification needs a reason and approval |
| No conflict checks visible | Room, professor and student **conflict checks** and capacity bars while scheduling |
| Paper documents | **QR-verifiable** COR, certificate of grades and TOR; online requests with status tracking |
| Desktop only | **Phone-friendly** for students, parents and staff (as the rest of ATLAS) |
| Separate parent communication | Parents see enrollment and grades when the link allows (exists) |
| — | **Prospectus and evaluation** for each student: what is done, what is left, what is next |
| — | FHE/TES-ready assessment and Form 2 export |

## 5. Phases

Each phase ends with tests (API and browser), demo data, docs, and a release on the live server.

| # | Phase | Delivers | Depends on |
| --- | --- | --- | --- |
| 0 | **Foundations** | `/academic/` app and tile; roles (admissions, dean, scheduler, cashier, guidance); colleges and departments; academic years/terms with grading periods; grading scale; audit log; **import** of students, curricula and grades from CSV/Excel (to migrate from the UIS) | — |
| 1 | **Curriculum** | Curriculum builder (levels, terms, subjects, prerequisites, electives), prospectus print, posting | 0 |
| 2 | **Student record & admissions** | Student profile, requirements checklist with uploads, application pipeline with reasons, entrance exams and results, admission | 0 |
| 3 | **Offerings & scheduling** | Schedule codes, block sections, rooms, conflict checks, merging; move the catalog and enrollment screens from the Learn admin panel | 1 |
| 4 | **Evaluation & enlistment** | Allowed subjects from the curriculum, back subjects, max/override units, self-enlistment, block enlistment, add/drop with transaction numbers | 1, 3 |
| 5 | **Assessment & official enrollment** | Fee schedules, FHE/TOSF, assessment, cashier payment with O.R., Certificate of Registration with QR | 4 |
| 6 | **Grades** | Grade sheets from Learn, dean approval, posting, permanent record, rectification, INC processing, subject crediting | 4 |
| 7 | **Documents & graduation** | Document requests, TOR/certificates with QR verification, promotion, delisting, candidates for graduation, honors, alumni | 6 |
| 8 | **Reports & student services** | CHED list, enrollment summary, FHE Form 2, failing grades, scholarships and grants, guidance records, analytics dashboard | 5, 6 |

Phases 1–2 can run side by side, as can 5–6.

## 6. Decisions needed from CBSUA

1. **Fee schedule and FHE rules**: the fee items per program and year level, which are covered by free tuition and TOSF, and how non-qualified students are charged.
2. **Grading**: the full equivalents table (seen: 99–100 = 1.00 Excellent, 96–98.99 = 1.25, 93–95.99 = 1.50, 90–92.99 = 1.75 Very good, 87–89.99 = 2.00, 84–86.99 = 2.25 Above average, …), grading periods (midterm/final), INC deadline, honors rules.
3. **Document templates**: the official TOR, COR, certificate of grades and certificate layouts, signatories, and fees.
4. **Requirements list** per student type (the UIS shows six for new students).
5. **The student-facing UIS**: this review covered the admin portal only. If there is a student portal, an account for it would show what students do online today.
6. **Data migration**: an export of current students, curricula and grades from the UIS (CSV or Excel) for the import tool.
7. **Finance scope**: whether cashiering stays in Academic until ATLAS Finance, or Finance comes first.
