# Lancaster ATLAS: product sheet and email, November 2026

Marketing materials for Lancaster ATLAS 0.8.0-alpha, written for decision-makers at Philippine state universities and colleges. The goal of both: the reader opens the product sheet, sees what ATLAS does and what its screens look like, and writes back with questions. Neither asks for a meeting or a demo.

| File | What it is |
| --- | --- |
| `atlas-product-sheet.html` | Technical product sheet. Three A4 pages; the second shows six screens from the app. One file: no external fonts or scripts, and the screenshots are embedded in it. |
| `atlas-email.html` | The marketing email: tables, inline CSS, 600px wide, with three screenshots. |
| `atlas-product-sheet.pdf` | The sheet printed to A4, for reference. Its contact box still shows the `{{…}}` placeholders: fill them in the HTML, then print it again (Chrome: Print, Save as PDF, A4, margins None, background graphics on). |
| `atlas-email.txt` | The plain-text version of the same email. |
| `images/` | The four image files the email needs, ready to upload (see [Images for the email](#images-for-the-email)). |

## Subject lines and preview text

Subject lines (all under 55 characters):

1. `One sign-in for registrar, HR and accounting` (44)
2. `A school platform built on COA and DBM rules` (44)
3. `Government payroll and accounting, one sign-in` (46)

Preview text (the email already carries the first as its hidden preheader; to use the second, replace the text in the first `<div>` after `<body>`):

1. `Classes, student records, payroll and government accounting behind one sign-in, on a server your school controls.`
2. `Government payroll, ORS/BURS, vouchers and CHED reports in one platform. The product sheet shows the screens.`

## Placeholders to fill

Every placeholder is written `{{LIKE_THIS}}`. Search each file for `{{` before sending or printing; none should be left.

| Placeholder | Where | Fill with |
| --- | --- | --- |
| `{{FIRST_NAME}}` | email (HTML, text) | The recipient's first name. Most email tools have their own merge tag; replace ours with theirs. |
| `{{SCHOOL_NAME}}` | email (HTML, text), twice | The recipient's school, as it writes its own name. |
| `{{PRODUCT_SHEET_LINK}}` | email (the button; the text version) | Where the sheet is hosted: the HTML file, or a PDF printed from it. |
| `{{WEBSITE_LINK}}` | sheet (contact box), twice | LTDC's web page for ATLAS. Full `https://` address. It is printed, so keep it short. |
| `{{LOGO_URL}}` | email (HTML) | The address of `images/atlas-logo.png` once uploaded. |
| `{{SCREEN_1_URL}}` | email (HTML) | The address of `images/screen-1-home.jpg` once uploaded. |
| `{{SCREEN_2_URL}}` | email (HTML) | The address of `images/screen-2-general-payroll.jpg` once uploaded. |
| `{{SCREEN_3_URL}}` | email (HTML) | The address of `images/screen-3-disbursement-voucher.jpg` once uploaded. |
| `{{CONTACT_NAME}}` | email (sign-off), sheet | The person at LTDC who signs the email and answers the replies. |
| `{{CONTACT_EMAIL}}`, `{{CONTACT_PHONE}}` | sheet | That person's email and phone. |
| `{{COMPANY_ADDRESS}}` | email footer | LTDC's registered postal address. |
| `{{UNSUBSCRIBE_LINK}}` | email footer | The email tool's unsubscribe link. Do not send without it. |

## Images for the email

Upload these four files to your email tool's image library (or any public `https://` address) and paste each address into its placeholder. They are already sized for sharp display on phones; do not resize them.

| File | Placeholder | Shown at | What it is |
| --- | --- | --- | --- |
| `images/atlas-logo.png` (416 × 160) | `{{LOGO_URL}}` | 208 × 80 | The ATLAS lockup on burgundy, from `lms/docs/brand/atlas-logo-horizontal-on-dark.png`. A PNG, because Gmail and Outlook do not show SVG. |
| `images/screen-1-home.jpg` (1104 × 690) | `{{SCREEN_1_URL}}` | 552 × 345 | The ATLAS home page of a teacher, from `lms/public/help/img/getting-started-home.jpg`. |
| `images/screen-2-general-payroll.jpg` (810 × 540) | `{{SCREEN_2_URL}}` | 270 × 180; full width on a phone | A finalized payroll run and its General Payroll, cut from `payroll-general-payroll.jpg`. |
| `images/screen-3-disbursement-voucher.jpg` (810 × 540) | `{{SCREEN_3_URL}}` | 270 × 180; full width on a phone | A disbursement voucher with Boxes A to E, cut from `accountant-dv-certify.jpg`. |

The screens come from the Help guides' screenshots of the demo school, "Lancaster Academy". Each was looked at before use: none shows the demo's other campus names or its address, only "Main Campus" and demo names. If you swap in another screenshot, check it the same way (see "Deliberately not claimed").

## How to send the email

1. Upload the four images, host the product sheet, and fill the placeholders.
2. In your email tool, create a campaign and choose the option to paste or import your own HTML. Paste all of `atlas-email.html`. Paste `atlas-email.txt` as the plain-text version; do not let the tool generate one.
3. Set the subject line. If the tool has its own preview-text field, leave it empty or paste the same text as the preheader.
4. Send a test to a Gmail address and an Outlook address first. Check on a phone and on a computer:
   - the logo and the three screens show; with images blocked the band reads "Lancaster ATLAS" and each screen shows its description;
   - the button opens the product sheet, and a reply reaches the person who signed;
   - the unsubscribe link works;
   - no `{{` is left anywhere;
   - in dark mode the text is still readable.
5. Send only to people it is reasonable to write to about their office's systems, and honour every unsubscribe. The footer says why the person is receiving the email and how to stop it, as the Data Privacy Act's practice expects.

The email has no JavaScript, forms or background images, and uses a `<style>` block only for the phone layout and dark-mode hints. Some tools strip that block; the email still reads correctly without it.

## How to print the product sheet

Open `atlas-product-sheet.html` in Chrome or Edge, fill the four placeholders, then **Print → Save as PDF**, paper size **A4**, margins **None**, background graphics on. It prints on exactly three pages with its colours. It also reads on screen and on a phone, so the HTML itself can be the `{{PRODUCT_SHEET_LINK}}`.

## Claims table

Every factual claim in the sheet and the email, with the file it comes from. Paths are relative to `lms/`. "Sheet" numbers are the section numbers printed on the sheet (the brief's nine sections map to: headline and positioning = the top band; product family = 01; one front door = 02; government rules = 04; security = 05; architecture = 06; what's included = 07; status = 08; the contact box = the burgundy box. Section 03, the screens, was added later).

### Positioning, product family, front door

| # | Claim | Used in | Source |
| --- | --- | --- | --- |
| 1 | ATLAS is a school platform; LTDC's Unified Education Management Platform | Sheet top, email | `README.md` (intro); `docs/BRAND.md` |
| 2 | Students, parents, faculty and staff sign in once and open the systems their account may use | Sheet top, 02; email | `README.md` (ATLAS home table; "no second sign-in"); `docs/guides/getting-started.md` (Before you start) |
| 3 | Built for state universities and colleges; payroll and accounting follow the rules of a national government agency | Sheet top, email | `docs/FINANCE-PLAN.md` (intro); `README.md` (Government payroll) |
| 4 | Runs on the school's own server or on AWS | Sheet top, 06; email | `README.md` (intro; Putting it online); `deploy/aws/EC2.md` |
| 5 | Version 0.8.0-alpha | Sheet, email | `package.json` |
| 6 | Learn: lessons, materials, assignments; timed quizzes and exams the server closes on time | Sheet 01 | `README.md` (Modules table; Quizzes and exams, "Fair timing") |
| 7 | Learn: enrollment checks prerequisites, the unit limit and schedule conflicts, with waitlists | Sheet 01 | `README.md` (How enrollment works) |
| 8 | Learn: attendance, weighted gradebook, final grades, CSV export | Sheet 01 | `README.md` (Modules table; Grading) |
| 9 | Learn: read-only parent accounts; the registrar chooses what each link shares | Sheet 01, 05 | `README.md` (Parents & guardians) |
| 10 | Learn is used by teachers, students, parents and guardians, and the registrar through its admin panel | Sheet 01 | `README.md` (addresses table; Account types) |
| 11 | Academic: one student record with evaluation against the curriculum, back subjects, units earned, GWA | Sheet 01, email | `README.md` (Academic) |
| 12 | Academic: grade sheets go teacher, dean, registrar; a grade change needs a second person's approval | Sheet 01, email | `README.md` (Academic); `docs/ACADEMIC-PLAN.md` §0 |
| 13 | Academic: TOR, COR and certificates with a QR code anyone can check | Sheet 01, email | `README.md` (Academic, Documents; `/verify/CODE`) |
| 14 | Academic: CHED enrollment list, FHE billing details (UniFAST Form 2, lecture and laboratory units), enrollment summary by program, year and sex, dean's list, candidates for graduation; print on A4, export to CSV | Sheet 01, 04; email | `README.md` (Academic, Reports); `docs/guides/registrar.md` |
| 15 | Academic is used by the registrar's office, deans, teachers (grade sheets) and students (own record) | Sheet 01 | `README.md` (Academic, "Who uses it") |
| 16 | People: employee records, time clock, DTR with late, undertime and overtime | Sheet 01 | `README.md` (HRIS) |
| 17 | People: leave balances, requests, approvals; HR cannot approve their own | Sheet 01 | `README.md` (HR screens, Leave & approvals) |
| 18 | People: General Payroll (COA GAM Appendix 33) and a remittance summary per agency | Sheet 01 | `README.md` (HR screens, Payroll) |
| 19 | People: self-service for every employee: clock in, file leave, payslips | Sheet 01 | `README.md` (HRIS self-service) |
| 20 | Finance: Revised Chart of Accounts, journal entry vouchers, ledgers, trial balance, statements per fund cluster | Sheet 01 | `README.md` (Finance, Accounts) |
| 21 | Finance: appropriations, allotments, NCAs; ORS/BURS with Box B checking the allotment | Sheet 01, email | `README.md` (Finance, Budget) |
| 22 | Finance: disbursement vouchers through Boxes A to E, checks and LDDAP-ADA, cash advances, BIR Form 2307 | Sheet 01, email | `README.md` (Finance, Disbursement) |
| 23 | Finance: official receipts, RCD and deposits; purchase orders, stock cards, PAR/ICS, depreciation | Sheet 01, email | `README.md` (Finance: Revenue, Inventory, Property) |
| 24 | Finance is used by the accounting, budget, cashier's and supply offices and the approving officer | Sheet 01 | `README.md` (addresses table; Finance accounts); `docs/FINANCE-PLAN.md` (Roles) |
| 25 | Documents: own files, office and college folders, shared with me; for every employee and student | Sheet 01 | `docs/guides/documents.md` (Before you start); `docs/guides/whats-new.md` |
| 26 | Documents: every version kept; check-out | Sheet 01 | `docs/guides/documents.md`; `docs/guides/whats-new.md` |
| 27 | Documents: share at view, edit or manage; outside links with a password, end date and download limit | Sheet 01 | `docs/guides/whats-new.md` (ATLAS Documents) |
| 28 | Documents: every file encrypted on the server; programs, scripts and Office files with macros refused | Sheet 01 | `docs/guides/documents.md`; `README.md` (Security in the app, ATLAS Documents) |
| 29 | PDF Studio: Word, Excel, PowerPoint, OpenDocument files and pictures to PDF; files up to 100 MB | Sheet 01 | `docs/guides/pdf-studio.md` (Before you start) |
| 30 | PDF Studio: put PDFs together; reorder, turn, remove and number pages; change a line of text, add text, sign | Sheet 01 | `docs/guides/whats-new.md` (PDF Studio); `docs/guides/pdf-studio.md` |
| 31 | PDF Studio: signature record page with a code; a check says whether a signed PDF is unchanged | Sheet 01 | `docs/guides/whats-new.md` (PDF Studio) |
| 32 | PDF Studio is for employees; an administrator chooses which account types | Sheet 01 | `docs/guides/pdf-studio.md`; `docs/guides/whats-new.md` |
| 33 | Facilities: rooms and venues, bookings, maintenance, property; coming soon, greyed out on the home page | Sheet 01, 08 | `README.md` (products table) |
| 34 | Home page: a card per system with figures from the person's own work; announcements and events | Sheet 02 | `docs/guides/getting-started.md` (Walkthrough) |
| 35 | Sign out anywhere signs out of everything; the school's Keycloak account can be used | Sheet 02 | `README.md` (Campuses, last paragraph; Single sign-on) |
| 36 | Campuses: same features, catalog and grading; own students, teachers, sections, news and events; staff switch campus from their name | Sheet 02 | `README.md` (Campuses) |
| 37 | Notifications: the bell, with the five examples given | Sheet 02 | `docs/guides/whats-new.md` (Notifications); `docs/guides/getting-started.md` |

### Government rules

| # | Claim | Used in | Source |
| --- | --- | --- | --- |
| 38 | COA Government Accounting Manual and Revised Chart of Accounts; one set of books per fund cluster | Sheet 04, email | `docs/FINANCE-PLAN.md` (intro, §1) |
| 39 | DBM budget execution: ORS for fund 01, BURS for the others; SAAODB (FAR 1), RAOD, aging of obligations (FAR 3) | Sheet 04 | `README.md` (Finance, Budget); `docs/FINANCE-PLAN.md` |
| 40 | The server enforces separation of duties; Box D never by the preparer or certifier | Sheet 04 | `docs/FINANCE-PLAN.md` §1; `README.md` (Finance, Disbursement) |
| 41 | BIR withholding on government payments, remittances by TRA, quarterly alphalist, Form 2307 | Sheet 04 | `README.md` (Finance, Disbursement); `docs/FINANCE-PLAN.md` §3 |
| 42 | Every Finance form prints on A4 after its GAM appendix | Sheet 04, email | `README.md` (Finance, last paragraph) |
| 43 | Salary grade and step under EO 64, s. 2024; 2026 and 2027 schedules built in | Sheet 04, email | `README.md` (Government payroll) |
| 44 | PERA and RATA; GSIS 9% personal and 12% government share; PhilHealth, Pag-IBIG, BIR withholding tax | Sheet 04, email | `README.md` (Government payroll) |
| 45 | Tardiness and undertime charged to vacation leave credits first (CSC), the rest from pay | Sheet 04 | `README.md` (Government payroll) |
| 46 | Loans held back when net pay would fall below ₱5,000 a month | Sheet 04 | `README.md` (Government payroll) |
| 47 | Mid-year and year-end bonus, cash gift, PEI and clothing allowance runs | Sheet 04 | `README.md` (Government payroll, Bonus runs) |
| 48 | A finalized run goes to Finance: ORS/BURS, payroll voucher, remittance vouchers | Sheet 04, email | `README.md` (Government payroll, "To Finance"); `docs/guides/payroll.md` |
| 49 | Tax rates, contribution tables and the chart of accounts are editable; checked against the accountant's and COA auditor's documents before going live | Sheet 04 | `docs/FINANCE-PLAN.md` §3 (last note), §5; `README.md` (Payroll setup; Control panel) |

### Security, architecture, what's included, status

| # | Claim | Used in | Source |
| --- | --- | --- | --- |
| 50 | Passwords stored only as hashes, each encrypted under a key kept outside the data | Sheet 05 | `README.md` (Security in the app, Passwords) |
| 51 | 2-step verification with an authenticator app and recovery codes; administrators choose who must use it | Sheet 05, 08; email | `docs/guides/getting-started.md`; `docs/guides/whats-new.md` |
| 52 | Access by account type; the server refuses, not only hides; single permissions per person | Sheet 05, email | `README.md` (Modules; For developers; "Own access") |
| 53 | Tamper-evident audit log: numbered entries chained by SHA-256; the page re-checks the chain | Sheet 05, email | `README.md` (Security in the app, Audit trail) |
| 54 | Security monitor for administrators: refused requests by kind, failed sign-ins, traffic, who is signed in | Sheet 05 | `docs/security-monitor.md`; `docs/guides/whats-new.md` |
| 55 | Rate limits per person and per network address; five wrong passwords lock a username for five minutes | Sheet 05 | `README.md` (Rate limits; Account types); `docs/guides/getting-started.md` (Questions) |
| 56 | Signed out after 8 idle hours; see and sign out other devices | Sheet 05 | `docs/guides/getting-started.md` (My security; Questions); `docs/account-profile.md` |
| 57 | Students see who is linked; a leave's reason and medical certificate shown to HR only | Sheet 05 | `README.md` (Parents & guardians, "Students know"); `docs/guides/whats-new.md` |
| 58 | One Node.js program with no third-party dependencies | Sheet 06 | `README.md` (intro); `package.json` (no dependencies listed) |
| 59 | One CloudFormation template builds the EC2 server with HTTPS and a fixed IP | Sheet 06 | `README.md` (Putting it online); `deploy/aws/lms-ec2.yaml` |
| 60 | Works on phones; no app to install | Sheet 06 | `README.md` (intro "a browser app"; Look and feel) |
| 61 | Single sign-on with Keycloak or another standard OpenID Connect provider | Sheet 06, 08 | `README.md` (Single sign-on) |
| 62 | On the AWS setup, updates install by themselves, only if the tests pass on the server | Sheet 06 | `README.md` (Putting it online); `deploy/aws/EC2.md` |
| 63 | On the AWS setup, a nightly copy of the data and a daily disk snapshot | Sheet 06 | `README.md` (Putting it online); `deploy/aws/EC2.md` (Backups) |
| 64 | Can sit behind Cloudflare at a name on the school's own domain | Sheet 06 | `README.md` (Cloudflare) |
| 65 | Records are kept in one data file on the server, with uploaded files beside it | Sheet 06 | `README.md` (intro; Demo data & backup row) |
| 66 | Help button in every system opens the guide for that person's job, with screenshots and how-to steps; kept current with every release; the school can edit them | Sheet 07 | `README.md` (Help & guides); `docs/guides/README.md` |
| 67 | First-run setup names the school and its campus and creates the administrator; the school sets its colour and logo | Sheet 07 | `README.md` (Run it; Campuses; Settings & branding) |
| 68 | Demo school with several campuses, payroll runs and this fiscal year's books; added next to your data and removed without changing it | Sheet 07 | `README.md` (demo school paragraphs) |
| 69 | Live: Learn, People, Academic (release 1), Finance (release 1), Documents, PDF Studio, the home with Keycloak sign-on, notifications, 2-step verification | Sheet 08 | `README.md` (products table); `docs/guides/whats-new.md` |
| 70 | The REX Bookstore e-Reader tile is planned only | Sheet 08 | `docs/guides/whats-new.md`; `docs/guides/getting-started.md` |
| 71 | Not yet built: Academic admissions with entrance exams, fee assessment, scholarships | Sheet 08 | `docs/ACADEMIC-PLAN.md` §0; `README.md` (Academic, last paragraph) |
| 72 | Not yet built: Finance petty cash, Statement of Cash Flows, eNGAS export | Sheet 08 | `docs/FINANCE-PLAN.md` §4 |

### Screens (sheet section 03 and the email)

Each screenshot is a Help-guide image from `public/help/img/`, taken from the demo school by `npm run guides:screenshots` (`README.md`, Help & guides).

| # | Caption or claim | Used in | Source |
| --- | --- | --- | --- |
| 73 | ATLAS home: a card for each system the account may use; a teacher's sections and work to grade on the Learn card | Sheet 03; email screen 1 | `getting-started-home.jpg`; `docs/guides/getting-started.md` (Walkthrough) |
| 74 | On a phone: an employee's My day, with the time clock and this pay period's hours | Sheet 03 | `employee-my-day-phone.jpg`; `README.md` (HRIS, My day) |
| 75 | Learn, teacher: the gradebook with scores per activity, the weighted running grade and the final grade | Sheet 03 | `teacher-gradebook.jpg`; `README.md` (Grading) |
| 76 | Academic, registrar: a student evaluated against the curriculum: units earned, GWA, back subjects, what can be taken next | Sheet 03 | `registrar-evaluation.jpg`; `README.md` (Academic) |
| 77 | People, payroll: a finalized run and its General Payroll (Appendix 33), with GSIS, PhilHealth, Pag-IBIG and tax per employee | Sheet 03; email screen 2 | `payroll-general-payroll.jpg`; `README.md` (HR screens, Payroll) |
| 78 | Finance, accounting: a disbursement voucher waiting for Box C, with the taxes withheld and its accounting entry | Sheet 03; email screen 3 | `accountant-dv-certify.jpg`; `README.md` (Finance, Disbursement) |
| 79 | The screens show the demo school, "Lancaster Academy"; each school sets its own name, colour and logo; people see only the systems and screens their account type may use | Sheet 03 | `README.md` (Settings & branding; Account types); `docs/guides/getting-started.md` (Questions) |

### Statements that come from the brief, not the repository

| Statement | Used in | Note |
| --- | --- | --- |
| "Sized with you for your enrollment during onboarding" | Sheet 06, 07 | The wording the brief gave for scale. The repository has no sizing or onboarding service document. Confirm LTDC offers this before sending. |
| "Any modern browser" | Sheet 06 | Allowed by the brief. The repository says it is a browser app that also works on phones; it names no list of supported browsers. |

## Deliberately not claimed

| Not claimed | Why |
| --- | --- |
| Uptime, speed, savings, user counts, number of schools, prices | No such figures exist in the repository. |
| Any school as a client or pilot site; testimonials or quotes | The pilot is not public. The demo campus names in the README are also left out, because they point to a real school. |
| Screenshots that show the demo's other campus names or its address | They point to a real school. Every screenshot used shows only "Lancaster Academy" and "Main Campus". Many other guide screenshots are not safe: look at any replacement at full size first. |
| A demo, a meeting or "30 minutes" | Removed on request. The email's one button opens the product sheet, and questions go by reply. |
| "Now in pilot with schools" | Left out entirely. The version number (0.8.0-alpha) is stated instead. |
| Proven at a given enrollment | Not shown. Scale is covered only by "sized with you for your enrollment during onboarding". |
| ISO, SOC 2, "DPA-certified", "COA-approved" or any badge | ATLAS holds none. The sheet says what the code does, and its footer says the agencies named do not endorse it. |
| "Compliant with" COA, DBM, BIR, CSC or CHED | The sheet says ATLAS "follows" the rules and that rates and the chart of accounts are checked with the school's accountant and COA auditor before going live. `docs/FINANCE-PLAN.md` §5 lists items still to confirm, so "compliant" would overstate it. |
| Penetration tests, VAPT, security reviews, vulnerabilities fixed | Those reports are confidential. |
| AI features | ATLAS has none. |
| Encryption of all data at rest | Only two things are encrypted by the application: password hashes and files in ATLAS Documents. The sheet says exactly that. |
| Algorithm names for passwords (scrypt, AES-256-GCM) | True, but left off the sheet to keep it readable. The MIS office can be given them on request. |
| OWASP labels in the Security monitor, Prometheus export | True, but "OWASP" in marketing reads like a certification. |
| Backups and automatic updates on a school's own server | The repository sets these up only in the AWS template, so the sheet says "On the AWS setup". |
| Rollback of a failed update | True on AWS (`README.md`), cut from the sheet for space. |
| PostgreSQL, S3, load balancing | The README describes these as a path for later, not as built. |
| Facilities and the REX Bookstore e-Reader as features | Not built. Both are marked coming soon or planned. |
| Fee assessment, online payments, admissions exams, scholarships, petty cash, eNGAS export, Statement of Cash Flows | Not in release 1 (`docs/ACADEMIC-PLAN.md` §0, `docs/FINANCE-PLAN.md` §4). The sheet lists the main ones under "Not yet built". |
| RA 12009 (procurement) | Purchase orders follow it per the README, but the 2025 IRR is recent and procurement is not ATLAS's main claim. Left for a later conversation. |
| Email notifications, chat, mobile app | Not in the repository. Notifications are in-app (the bell) only. |
| Dark mode, school calendar, Settings center, clock-in locations | True, left out for space. Clock-in locations also need a privacy conversation better had in person. |

## Checks made

Both HTML files were opened in Chromium with Playwright: the sheet at 1280px and 390px wide and printed to A4 (three pages, nothing cut off), and the email at 600px and 390px, in dark mode, and with the images missing. Neither file scrolls sideways at any of those widths. Every screenshot was looked at, at full size, for names that point to a real school.
