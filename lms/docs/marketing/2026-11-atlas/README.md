# Lancaster ATLAS: product sheet and email, November 2026

Marketing materials for Lancaster ATLAS 0.8.0-alpha, written for decision-makers at Philippine state universities and colleges. The goal of both is one thing: a 30-minute demo booked.

| File | What it is |
| --- | --- |
| `atlas-product-sheet.html` | Technical product sheet. Two A4 pages. One file, no external fonts, scripts or images. |
| `atlas-email.html` | The marketing email: tables, inline CSS, 600px wide. |
| `atlas-product-sheet.pdf` | The sheet printed to A4, for reference. Its contact box still shows the `{{…}}` placeholders: fill them in the HTML, then print it again (Chrome: Print, Save as PDF, A4, margins None, background graphics on). |
| `atlas-email.txt` | The plain-text version of the same email. |

## Subject lines and preview text

Subject lines (all under 55 characters):

1. `One sign-in for registrar, HR and accounting` (44)
2. `A school platform built on COA and DBM rules` (44)
3. `ORS to LDDAP-ADA in one system: a 30-minute demo` (48)

Preview text (the email already carries the first as its hidden preheader; to use the second, replace the text in the first `<div>` after `<body>`):

1. `Classes, student records, payroll and government accounting behind one sign-in. See it on a demo school in 30 minutes.`
2. `Government payroll, ORS/BURS, vouchers and CHED reports on a server your school controls. Thirty minutes, on a demo school.`

## Placeholders to fill

Every placeholder is written `{{LIKE_THIS}}`. Search each file for `{{` before sending or printing; none should be left.

| Placeholder | Where | Fill with |
| --- | --- | --- |
| `{{FIRST_NAME}}` | email (HTML, text) | The recipient's first name. Most email tools have their own merge tag; replace ours with theirs. |
| `{{SCHOOL_NAME}}` | email (HTML, text), twice | The recipient's school, as it writes its own name. |
| `{{DEMO_LINK}}` | email, sheet | The booking page. Full `https://` address. On the sheet it is printed, so keep it short. |
| `{{PRODUCT_SHEET_LINK}}` | email | Where the sheet is hosted: the HTML file, or a PDF printed from it. |
| `{{LOGO_URL}}` | email (HTML) | A hosted PNG of `lms/docs/brand/atlas-logo-horizontal-on-dark.png`. It is shown at 208 × 80 on the burgundy band; upload it at 416 × 160 or larger. Not an SVG: Gmail and Outlook do not show them. |
| `{{CONTACT_NAME}}` | email (sign-off), sheet | The person at LTDC who signs the email and takes the demo. |
| `{{CONTACT_EMAIL}}`, `{{CONTACT_PHONE}}` | sheet | That person's email and phone. |
| `{{COMPANY_ADDRESS}}` | email footer | LTDC's registered postal address. |
| `{{UNSUBSCRIBE_LINK}}` | email footer | The email tool's unsubscribe link. Do not send without it. |

## How to send the email

1. Host the logo and the product sheet, and fill the placeholders.
2. In your email tool, create a campaign and choose the option to paste or import your own HTML. Paste all of `atlas-email.html`. Paste `atlas-email.txt` as the plain-text version; do not let the tool generate one.
3. Set the subject line. If the tool has its own preview-text field, leave it empty or paste the same text as the preheader.
4. Send a test to a Gmail address and an Outlook address first. Check on a phone and on a computer:
   - the logo shows, and with images blocked the band reads "Lancaster ATLAS";
   - the button and both links open the right pages;
   - the unsubscribe link works;
   - no `{{` is left anywhere;
   - in dark mode the text is still readable.
5. Send only to people it is reasonable to write to about their office's systems, and honour every unsubscribe. The footer says why the person is receiving the email and how to stop it, as the Data Privacy Act's practice expects.

The email has no JavaScript, forms or background images, and uses a `<style>` block only for the phone layout and dark-mode hints. Some tools strip that block; the email still reads correctly without it.

## How to print the product sheet

Open `atlas-product-sheet.html` in Chrome or Edge, fill the four placeholders, then **Print → Save as PDF**, paper size **A4**, margins **Default** (the file sets its own). It prints on exactly two pages with its colours. It also reads on screen and on a phone, so the HTML itself can be the `{{PRODUCT_SHEET_LINK}}`.

## Claims table

Every factual claim in the sheet and the email, with the file it comes from. Paths are relative to `lms/`. "Sheet" numbers are the section numbers printed on the sheet (the brief's nine sections map to: headline and positioning = the top band; product family = 01; one front door = 02; government rules = 03; security = 04; architecture = 05; what's included = 06; status = 07; call to action = the burgundy box).

### Positioning, product family, front door

| # | Claim | Used in | Source |
| --- | --- | --- | --- |
| 1 | ATLAS is a school platform; LTDC's Unified Education Management Platform | Sheet top, email | `README.md` (intro); `docs/BRAND.md` |
| 2 | Students, parents, faculty and staff sign in once and open the systems their account may use | Sheet top, 02; email | `README.md` (ATLAS home table; "no second sign-in"); `docs/guides/getting-started.md` (Before you start) |
| 3 | Built for state universities and colleges; payroll and accounting follow the rules of a national government agency | Sheet top, email | `docs/FINANCE-PLAN.md` (intro); `README.md` (Government payroll) |
| 4 | Runs on the school's own server or on AWS | Sheet top, 05; email | `README.md` (intro; Putting it online); `deploy/aws/EC2.md` |
| 5 | Version 0.8.0-alpha | Sheet, email | `package.json` |
| 6 | Learn: lessons, materials, assignments; timed quizzes and exams the server closes on time | Sheet 01 | `README.md` (Modules table; Quizzes and exams, "Fair timing") |
| 7 | Learn: enrollment checks prerequisites, the unit limit and schedule conflicts, with waitlists | Sheet 01 | `README.md` (How enrollment works) |
| 8 | Learn: attendance, weighted gradebook, final grades, CSV export | Sheet 01 | `README.md` (Modules table; Grading) |
| 9 | Learn: read-only parent accounts; the registrar chooses what each link shares | Sheet 01, 04 | `README.md` (Parents & guardians) |
| 10 | Learn is used by teachers, students, parents and guardians, and the registrar through its admin panel | Sheet 01 | `README.md` (addresses table; Account types) |
| 11 | Academic: one student record with evaluation against the curriculum, back subjects, units earned, GWA | Sheet 01, email | `README.md` (Academic) |
| 12 | Academic: grade sheets go teacher, dean, registrar; a grade change needs a second person's approval | Sheet 01, email | `README.md` (Academic); `docs/ACADEMIC-PLAN.md` §0 |
| 13 | Academic: TOR, COR and certificates with a QR code anyone can check | Sheet 01, email | `README.md` (Academic, Documents; `/verify/CODE`) |
| 14 | Academic: CHED enrollment list, FHE billing details (UniFAST Form 2, lecture and laboratory units), enrollment summary by program, year and sex, dean's list, candidates for graduation; print on A4, export to CSV | Sheet 01, 03; email | `README.md` (Academic, Reports); `docs/guides/registrar.md` |
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
| 33 | Facilities: rooms and venues, bookings, maintenance, property; coming soon, greyed out on the home page | Sheet 01, 07 | `README.md` (products table) |
| 34 | Home page: a card per system with figures from the person's own work; announcements and events | Sheet 02 | `docs/guides/getting-started.md` (Walkthrough) |
| 35 | Sign out anywhere signs out of everything; the school's Keycloak account can be used | Sheet 02 | `README.md` (Campuses, last paragraph; Single sign-on) |
| 36 | Campuses: same features, catalog and grading; own students, teachers, sections, news and events; staff switch campus from their name | Sheet 02 | `README.md` (Campuses) |
| 37 | Notifications: the bell, with the five examples given | Sheet 02 | `docs/guides/whats-new.md` (Notifications); `docs/guides/getting-started.md` |

### Government rules

| # | Claim | Used in | Source |
| --- | --- | --- | --- |
| 38 | COA Government Accounting Manual and Revised Chart of Accounts; one set of books per fund cluster | Sheet 03, email | `docs/FINANCE-PLAN.md` (intro, §1) |
| 39 | DBM budget execution: ORS for fund 01, BURS for the others; SAAODB (FAR 1), RAOD, aging of obligations (FAR 3) | Sheet 03 | `README.md` (Finance, Budget); `docs/FINANCE-PLAN.md` |
| 40 | The server enforces separation of duties; Box D never by the preparer or certifier | Sheet 03 | `docs/FINANCE-PLAN.md` §1; `README.md` (Finance, Disbursement) |
| 41 | BIR withholding on government payments, remittances by TRA, quarterly alphalist, Form 2307 | Sheet 03 | `README.md` (Finance, Disbursement); `docs/FINANCE-PLAN.md` §3 |
| 42 | Every Finance form prints on A4 after its GAM appendix | Sheet 03, email | `README.md` (Finance, last paragraph) |
| 43 | Salary grade and step under EO 64, s. 2024; 2026 and 2027 schedules built in | Sheet 03, email | `README.md` (Government payroll) |
| 44 | PERA and RATA; GSIS 9% personal and 12% government share; PhilHealth, Pag-IBIG, BIR withholding tax | Sheet 03, email | `README.md` (Government payroll) |
| 45 | Tardiness and undertime charged to vacation leave credits first (CSC), the rest from pay | Sheet 03 | `README.md` (Government payroll) |
| 46 | Loans held back when net pay would fall below ₱5,000 a month | Sheet 03 | `README.md` (Government payroll) |
| 47 | Mid-year and year-end bonus, cash gift, PEI and clothing allowance runs | Sheet 03 | `README.md` (Government payroll, Bonus runs) |
| 48 | A finalized run goes to Finance: ORS/BURS, payroll voucher, remittance vouchers | Sheet 03, email | `README.md` (Government payroll, "To Finance"); `docs/guides/payroll.md` |
| 49 | Tax rates, contribution tables and the chart of accounts are editable; checked against the accountant's and COA auditor's documents before going live | Sheet 03 | `docs/FINANCE-PLAN.md` §3 (last note), §5; `README.md` (Payroll setup; Control panel) |

### Security, architecture, what's included, status

| # | Claim | Used in | Source |
| --- | --- | --- | --- |
| 50 | Passwords stored only as hashes, each encrypted under a key kept outside the data | Sheet 04 | `README.md` (Security in the app, Passwords) |
| 51 | 2-step verification with an authenticator app and recovery codes; administrators choose who must use it | Sheet 04, 07; email | `docs/guides/getting-started.md`; `docs/guides/whats-new.md` |
| 52 | Access by account type; the server refuses, not only hides; single permissions per person | Sheet 04, email | `README.md` (Modules; For developers; "Own access") |
| 53 | Tamper-evident audit log: numbered entries chained by SHA-256; the page re-checks the chain | Sheet 04, email | `README.md` (Security in the app, Audit trail) |
| 54 | Security monitor for administrators: refused requests by kind, failed sign-ins, traffic, who is signed in | Sheet 04 | `docs/security-monitor.md`; `docs/guides/whats-new.md` |
| 55 | Rate limits per person and per network address; five wrong passwords lock a username for five minutes | Sheet 04 | `README.md` (Rate limits; Account types); `docs/guides/getting-started.md` (Questions) |
| 56 | Signed out after 8 idle hours; see and sign out other devices | Sheet 04 | `docs/guides/getting-started.md` (My security; Questions); `docs/account-profile.md` |
| 57 | Students see who is linked; a leave's reason and medical certificate shown to HR only | Sheet 04 | `README.md` (Parents & guardians, "Students know"); `docs/guides/whats-new.md` |
| 58 | One Node.js program with no third-party dependencies | Sheet 05 | `README.md` (intro); `package.json` (no dependencies listed) |
| 59 | One CloudFormation template builds the EC2 server with HTTPS and a fixed IP | Sheet 05 | `README.md` (Putting it online); `deploy/aws/lms-ec2.yaml` |
| 60 | Works on phones; no app to install | Sheet 05 | `README.md` (intro "a browser app"; Look and feel) |
| 61 | Single sign-on with Keycloak or another standard OpenID Connect provider | Sheet 05, 07 | `README.md` (Single sign-on) |
| 62 | On the AWS setup, updates install by themselves, only if the tests pass on the server | Sheet 05 | `README.md` (Putting it online); `deploy/aws/EC2.md` |
| 63 | On the AWS setup, a nightly copy of the data and a daily disk snapshot | Sheet 05 | `README.md` (Putting it online); `deploy/aws/EC2.md` (Backups) |
| 64 | Can sit behind Cloudflare at a name on the school's own domain | Sheet 05 | `README.md` (Cloudflare) |
| 65 | Records are kept in one data file on the server, with uploaded files beside it | Sheet 05 | `README.md` (intro; Demo data & backup row) |
| 66 | Help button in every system opens the guide for that person's job, with screenshots and how-to steps; kept current with every release; the school can edit them | Sheet 06 | `README.md` (Help & guides); `docs/guides/README.md` |
| 67 | First-run setup names the school and its campus and creates the administrator; the school sets its colour and logo | Sheet 06 | `README.md` (Run it; Campuses; Settings & branding) |
| 68 | Demo school with several campuses, payroll runs and this fiscal year's books; added next to your data and removed without changing it | Sheet 06, email | `README.md` (demo school paragraphs) |
| 69 | Live: Learn, People, Academic (release 1), Finance (release 1), Documents, PDF Studio, the home with Keycloak sign-on, notifications, 2-step verification | Sheet 07 | `README.md` (products table); `docs/guides/whats-new.md` |
| 70 | The REX Bookstore e-Reader tile is planned only | Sheet 07 | `docs/guides/whats-new.md`; `docs/guides/getting-started.md` |
| 71 | Not yet built: Academic admissions with entrance exams, fee assessment, scholarships | Sheet 07 | `docs/ACADEMIC-PLAN.md` §0; `README.md` (Academic, last paragraph) |
| 72 | Not yet built: Finance petty cash, Statement of Cash Flows, eNGAS export | Sheet 07 | `docs/FINANCE-PLAN.md` §4 |

### Statements that come from the brief, not the repository

| Statement | Used in | Note |
| --- | --- | --- |
| "Sized with you for your enrollment during onboarding" | Sheet 05, 06 | The wording the brief gave for scale. The repository has no sizing or onboarding service document. Confirm LTDC offers this before sending. |
| "Any modern browser" | Sheet 05 | Allowed by the brief. The repository says it is a browser app that also works on phones; it names no list of supported browsers. |
| "We walk through the demo school with the people who would use it" | Sheet call to action, email | A promise about the demo, not about the product. Make sure the demo is run this way. |

## Deliberately not claimed

| Not claimed | Why |
| --- | --- |
| Uptime, speed, savings, user counts, number of schools, prices | No such figures exist in the repository. |
| Any school as a client or pilot site; testimonials or quotes | The pilot is not public. The demo campus names in the README are also left out, because they point to a real school. |
| "Now in pilot with schools" | Left out entirely. The version number (0.8.0-alpha) is stated instead. |
| Proven at a given enrollment | Not shown. Scale is covered only by "sized with you for your enrollment during onboarding". |
| ISO, SOC 2, "DPA-certified", "COA-approved" or any badge | ATLAS holds none. The sheet says what the code does, and its footer says the agencies named do not endorse it. |
| "Compliant with" COA, DBM, BIR, CSC or CHED | The sheet says ATLAS "follows" the rules and that rates and the chart of accounts are checked with the school's accountant and COA auditor before going live. `docs/FINANCE-PLAN.md` §5 lists items still to confirm, so "compliant" would overstate it. |
| Penetration tests, VAPT, security reviews, vulnerabilities fixed | Those reports are confidential. |
| AI features | ATLAS has none. |
| Encryption of all data at rest | Only two things are encrypted by the application: password hashes and files in ATLAS Documents. The sheet says exactly that. |
| Algorithm names for passwords (scrypt, AES-256-GCM) | True, but left off the sheet to keep it readable. The MIS office can be given them in the demo. |
| OWASP labels in the Security monitor, Prometheus export | True, but "OWASP" in marketing reads like a certification. |
| Backups and automatic updates on a school's own server | The repository sets these up only in the AWS template, so the sheet says "On the AWS setup". |
| Rollback of a failed update | True on AWS (`README.md`), cut from the sheet for space. |
| PostgreSQL, S3, load balancing | The README describes these as a path for later, not as built. |
| Facilities and the REX Bookstore e-Reader as features | Not built. Both are marked coming soon or planned. |
| Fee assessment, online payments, admissions exams, scholarships, petty cash, eNGAS export, Statement of Cash Flows | Not in release 1 (`docs/ACADEMIC-PLAN.md` §0, `docs/FINANCE-PLAN.md` §4). The sheet lists the main ones under "Not yet built". |
| RA 12009 (procurement) | Purchase orders follow it per the README, but the 2025 IRR is recent and procurement is not ATLAS's main claim. Left for the demo. |
| Email notifications, chat, mobile app | Not in the repository. Notifications are in-app (the bell) only. |
| Dark mode, school calendar, Settings center, clock-in locations | True, left out for space. Clock-in locations also need a privacy conversation better had in person. |

## Checks made

Both HTML files were opened in Chromium with Playwright: the sheet at 1280px and 390px wide and printed to A4 (two pages, nothing cut off), and the email at 600px and 390px, in dark mode, and with the logo missing. Neither file scrolls sideways at any of those widths.
