# Council meeting brief: CBSUA deployment of Lancaster ATLAS, and its modules

TOPIC: Review the architecture of Lancaster ATLAS as it is being rolled out for **CBSUA** (Central Bicol State University of Agriculture, a Philippine state university with several campuses, e.g. Pili, Sipocot, Pasacao, Calabanga) and give your thoughts on each module.
MODE: discussion and recommendations only. Do NOT edit the repository. Write only to the session folder you are told to.
Repository: /home/user/cheese12 ; ATLAS lives in /home/user/cheese12/lms (the repo root is CORE ERP, a sibling product for companies).

## Architecture (as built, Nov 2026)
- One Node.js 22 process, **zero npm dependencies**, no build step; browser apps are plain ES modules (lms/public/js/<app>/), shared shell lms/public/js/shell.js.
- **All data in one JSON file** (lms/data/db.json via lms/server/db.js): loaded in memory at start; every change rewrites the whole file synchronously (write tmp + rename). Uploaded files in data/files/, profile pictures data/avatars/. Demo school ≈ 4.8 MB JSON. Audit log is a separate append-only, hash-chained file (data/audit-log.jsonl, lms/server/audit.js).
- **Sessions in memory** (lms/server/auth.js createSessions): a restart signs everyone out. Three cookie "sides": portal (Learn: students/teachers/parents), admin (Admin panel: administrators/registrars/deans), hris (People: HR/payroll/finance staff/other staff); Academic and Finance reuse those sessions.
- **API**: ~426 routes in lms/server/*.js registered via route(method, pattern, access, handler, opts) in lms/server/api.js; access strings like 'admin:enrollment.manage', 'hris:leave.manage', 'finance:finance.view', 'academic', 'portal', 'me', 'public'. Per-route body schemas (lms/server/validate.js), CSRF backstop (Sec-Fetch-Site/Origin), host check, rate limits (lms/server/ratelimit.js), scrypt N=2^17 password hashes encrypted with a password key, lockout, 12-h max session, CSP and security headers. Keycloak SSO (lms/server/sso.js) optional. Security monitor (lms/server/monitor.js).
- Roles (lms/shared/roles.js): Administrator, Registrar, Dean/Program chair, Teacher, Student, Parent/Guardian, HR Manager, Payroll Officer, Chief Accountant, Budget Officer, Cashier, Supply & Property Officer, Approving Officer, Staff; per-role overrides and per-account extra access.
- **Multi-campus** in one database: campus-scoped data, campus switching (lms/server/campus.js).
- **Hosting**: AWS EC2 t3.small, Singapore, Ubuntu 24.04, Caddy for HTTPS (Let's Encrypt), DuckDNS name (e.g. cbsua-portal.duckdns.org) or Cloudflare in front (lms/server/cloudflare.js, deploy/aws/cloudflare-apply.sh); nightly copy of db.json (30 days) + daily EBS snapshots (7); auto-update from GitHub every 10 min (tests must pass, rollback if it does not start); no SSH (Session Manager). ~US$27/month. Docs: lms/deploy/aws/EC2.md. An on-premise option (CBSUA's own servers) was analysed earlier as an alternative.
- Tests: 198 node:test tests (lms/test/), npm test. Help guides per role in lms/docs/guides/.
- Sibling: CORE ERP's HR & Payroll engine was ported into ATLAS People; government payroll (SSL, GSIS, PhilHealth, Pag-IBIG, BIR) and COA/DBM/BIR accounting in Finance.

## Modules (API routes per area, approx.)
| Module | Path | What it does | Routes |
|---|---|---|---|
| ATLAS home | / | One sign-in, system cards with live figures, pin/compact, announcements, events, Quick access, My profile/My security | ~6 + /api/me |
| **Learn** (LMS) + Admin panel | /lms/, /admin | Classes/sections, lessons, resources, quizzes, attendance, gradebook, enrollment requests & waitlists, applicants, guardians (parents see children), news, school calendar (ICS), modules on/off per role, Settings center, roles | Learn ~64, Admin ~90 |
| **Academic** (UIS) | /academic/ | Student records, curricula & evaluation, grade sheets (teacher→dean→registrar), grade changes, document requests (QR-verified /verify/), CHED/FHE reports. Planned next (lms/docs/ACADEMIC-PLAN.md): admissions with entrance exams, schedule codes/block sections/rooms, curriculum-guided enlistment and add/drop, fee assessment & cashiering, scholarships/guidance, UIS data import | ~50 |
| **People** (HRIS) | /hris/ | Employees, DTR/time clock (geolocation), leave & requests with approvals, government payroll runs, loans, bonuses, remittances, payslips, self-service | ~68 |
| **Finance** (FMIS) | /finance/ | COA government accounting: card file, chart of accounts/UACS, budget (allotments, ORS), procurement (PR/PO), inventory & property (depreciation), disbursement vouchers (certify/approve/pay), collections (ORs, RCDs), journals, control panel; payroll→ORS/DV link; student receipts. Items to confirm before go-live in lms/docs/FINANCE-PLAN.md §5 | ~123 |
| **System** (in every app, admins) | #/system/* | Users & Access, roles, Audit log, Security monitor, sign-in rules, SSO, Cloudflare | ~21 + |
| Facilities | — | Planned: rooms/venues, bookings, maintenance, property ("coming soon") | 0 |
| REX Bookstore e-Reader | — | Planned: e-books from the REX Bookstore app's library for classes ("coming soon", external integration) | 0 |

## Open decisions recorded for CBSUA (lms/docs/ACADEMIC-PLAN.md §6)
Fee schedule & Free Higher Education rules; grading equivalents/INC/honors; official document templates & signatories; requirements per student type; the student-facing side of the current UIS; data migration export from the UIS; whether cashiering stays in Academic or Finance comes first.

## Useful files to open
lms/README.md, lms/docs/ACADEMIC-PLAN.md, lms/docs/FINANCE-PLAN.md, lms/deploy/aws/EC2.md, lms/server/db.js, lms/server/api.js, lms/server/auth.js, lms/shared/roles.js, lms/shared/systems.js, lms/docs/security-monitor.md, lms/docs/account-profile.md, lms/docs/home-systems.md.
Scale facts to assume unless the code says otherwise: CBSUA enrolment is in the low tens of thousands of students across campuses, with peak load at enrollment and grade-posting weeks. (Treat exact numbers as unknown.)
