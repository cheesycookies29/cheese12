## Advocate Position — CBSUA rollout of Lancaster ATLAS, module by module

### 1. Opening perspective

ATLAS is well made for a staff member at a desk: one sign-in, one shell, guides for each role, tables that turn into cards on phones (`public/css/styles.css:712-725`), A4 COA forms (`public/js/finance/views/print.js`). CBSUA's largest group of users is different. It is ten thousand or more students on prepaid mobile data in Pili, Sipocot, Pasacao and Calabanga, and their work happens in bursts: enrollment week, quiz windows, grade release. For them, ATLAS today needs a live connection and a server that does not restart. It keeps nothing on the device, and it sends a student who forgot a password to the registrar's window. The most important question from my lens is this: **when the network or the server drops in the middle of a task (a quiz, an enlistment, a clock-in), what does the user lose, and how do they get back?** At present the answer is often "everything since the last save, plus their session". I would fix that before adding any new module.

### 2. Module input

**ATLAS home (`/`).** The home page has a single sign-in, system cards with live figures, and pin/compact. It starts in Compact on a phone (`docs/guides/getting-started.md:93`). The cards load in parallel and fail gracefully (`public/js/hub/app.js:326-354`, `.catch` on the feed). Two problems:
- **Password recovery is "Ask the registrar or your administrator to reset it"** (`public/js/hub/app.js:46`, `getting-started.md:221`). For tens of thousands of students in enrollment week, that is a queue at a window.
- The "coming soon" cards for Facilities and REX (`shared/systems.js:53-79`) are shown to everyone. A student sees two tiles they cannot use.

*Recommendation:* add self-service recovery as a launch item. That means a reset code by email or SMS, or a reset done through the student's registered email or Keycloak (SSO already exists, `server/sso.js`). Also hide the "soon" tiles from student and parent roles.

**Learn + Admin panel (`/lms/`, `/admin`).** The student journey (To do, class tabs, quiz, enrollment with "why I can't take this") is the strongest UX in the product (`docs/guides/student.md`). The quiz saves itself 900 ms after each change, but only in memory and to the server (`public/js/portal/views/quiz.js:290-318`). If a save fails, the error text replaces "All answers saved." There is no retry and no local copy. A 401 sends the student back to sign-in (`public/js/shell.js:488-494`). On the Admin side, the registrar approves enrollment requests one row at a time and has no way to select many and approve them together (`public/js/admin/views/enrollment.js`). The manual-add form lists every section of the term in a single `<select>` (`enrollment.js:72`). That cannot be used at CBSUA's scale.

*Recommendation:*
- Mirror quiz answers into `localStorage`, retry failed saves with backoff, and show the save state in the timer bar as offline / saving / saved.
- Give the registrar bulk approve and reject with filters by program, block and year.
- Replace large selects with type-ahead search.

**Academic (`/academic/`).** The flow teacher → dean → registrar for grade sheets, the QR-verified documents (`public/verify.html`) and the student's Evaluation with "What you can take next" are real improvements on the UIS. The journey problem is where enrollment lives. Today students request seats in **Learn → Enrollment**, while the plan moves enlistment and add/drop to Academic (`docs/ACADEMIC-PLAN.md:70, 117, 155`). Assessment and payment then belong to Academic or Finance, and that is still undecided (§6). A student would cross three systems to become "officially enrolled". The student-facing UIS was never reviewed (`ACADEMIC-PLAN.md:169`), so we do not know what students are used to.

*Recommendation:* design one **"My enrollment" journey** with a single status tracker: enlist → assessed → paid → officially enrolled (`registrations.status`, `ACADEMIC-PLAN.md:101`). It should sit in one place, Academic, with Learn and Finance linking to it. Before we build phase 4, observe a real enrollment day and get a student UIS account.

**People (`/hris/`).** Clock-in uses geolocation with `enableHighAccuracy`, a 12 s timeout, and a failure that does not stop the clock-in (`public/js/hris/geo.js:12-17`, `docs/guides/employee.md:24`). That is the right forgiving behaviour for rural campuses with weak GPS indoors. Clock-in is still a live API call with no queue, though. Self-service for leave, payslips and requests is clear in the guide (`employee.md`).

*Recommendation:* show the local time of the attempt and allow an "I clocked in at 7:52 but the network failed" correction request that comes pre-filled from the failed attempt. Otherwise DTR disputes will move to HR's desk. Test the payslip view at 360 px, because many non-teaching staff only have phones.

**Finance (`/finance/`).** This module serves a few expert users: accountant, budget officer, cashier, approver, supply officer. Their guides are task-based, and the printable GAM forms with signatories (`print.js:12-13`) match how COA-bound staff work. The risk is trust, not friction. FINANCE-PLAN §5 lists unconfirmed codes: the UACS sub-objects, the WB080 ATC, and the ₱10k exemption (`docs/FINANCE-PLAN.md:288-300`). If the accountant meets one wrong code on day one, they go back to Excel. For students, Finance is only "My payments" (receipts). There is no online payment, so they still queue at the cashier.

*Recommendation:* show each unconfirmed rule visibly in the Control panel with an "Confirmed by: ___" field, so staff see what still needs checking instead of finding it later. Put an online-payment reference flow (LANDBANK/Link.BizPortal or GCash reference upload) on the roadmap for the student side.

**System (`#/system/*`).** The audit log, security monitor and Users & Access sit inside every app, which helps administrators. The user-visible cost of the architecture shows up here. Sessions are in memory (`server/auth.js:245`). Auto-update can restart the server at any 10-minute mark (`deploy/aws/EC2.md:18, 89-91`). The guide itself tells users that a restart signs them out (`getting-started.md:227`). A restart in quiz week or enrollment week logs out every student at the same moment.

*Recommendation:* make "Users & Access → Updates" a visible maintenance-window setting (e.g. 22:00–05:00 only, with a freeze during enrollment and grade-posting weeks). Show signed-in users a "the system will restart in 5 minutes" banner.

**Facilities (planned).** The users here are campus admins, deans and student organisations booking venues across four campuses. The main job is "can I have this room on this date, and who approves?" The shared calendar UI (`public/js/calendar-ui.js`) and room data from Academic's planned rooms (`ACADEMIC-PLAN.md:154`) should be reused, so that a room clash between a class and an event is caught.

*Recommendation:* build it after Academic phase 3 (rooms), as a request → approve flow on the existing calendar. Do not show the tile until it does something.

**REX e-Reader (planned).** This is the module where low bandwidth matters most. A student in Pasacao will not stream a textbook page by page. It is an external integration, so ATLAS mostly owns entry (SSO hand-off from a class's Resources tab) and entitlement (which section gets which book).

*Recommendation:* make **offline download** with a data-size warning ("this book is 48 MB, download on Wi-Fi") a condition for the integration contract, and link e-books from inside the class rather than through a separate tile.

### 3. Top 3 concerns (ranked)

1. **Losing work and sessions on unreliable networks and restarts.**
   - Sessions are in memory only (`server/auth.js:245-263`).
   - Auto-update restarts at any 10-minute mark (`deploy/aws/EC2.md:18`).
   - The 401 handler sends users to sign-in (`public/js/shell.js:488-494`).
   - Quiz answers live in memory with no retry or local copy (`public/js/portal/views/quiz.js:290-318`).
   - There is no service worker or manifest anywhere in `public/` (grep: none).

   Picture Maria on a timed quiz on Globe prepaid. Her signal drops, the save fails, an update restarts the server, and she is back at the sign-in page with the clock still running server-side. Fix: persisted sessions or a scheduled update window, plus a local answer backup and retry.

2. **Enrollment week does not scale for the registrar or the student.**
   - There is no bulk approve (`public/js/admin/views/enrollment.js`).
   - The manual-add form uses an all-sections `<select>` (`enrollment.js:72`).
   - Password resets go only through the registrar (`public/js/hub/app.js:46`).
   - The enrollment journey is split across Learn, Academic and Finance (`ACADEMIC-PLAN.md:70-71`).
   - There are no notifications: the server has no email or SMS (grep `server/` shows email only as a profile field). Students have to keep checking for "approved / waitlist moved up".

   This turns into a physical queue at the window, which is what ATLAS is supposed to remove.

3. **Language, privacy and accessibility gaps for parents and assistive-tech users.**
   - Everything is English-only with no locale layer: `<html lang="en">`, and there are no Filipino strings or guides (`public/index.html:2`, `docs/guides/*.md`).
   - The parent guide says the registrar decides what parents see (`docs/guides/parent.md`), but nothing records the **student's consent**. CBSUA students are mostly adults, so this is a Data Privacy Act (RA 10173) issue (grep `consent`: none).
   - There is no skip link. Only about 10 `aria-live` or status regions exist across 40+ views, and the enrollment and gradebook tables depend on visual masks for horizontal scrolling (`styles.css:645-652`).

   Fix:
   - Filipino versions of the student and parent guides and of the key student screens (sign-in, enrollment, COR).
   - A student-controlled "share with guardian" consent.
   - A WCAG 2.2 AA pass over the student journey before launch.
