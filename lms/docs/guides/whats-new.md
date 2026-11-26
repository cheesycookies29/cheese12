---
id: whats-new
title: What's new in ATLAS
summary: The changes in each update, newest first, and which guide explains them.
roles: student, teacher, guardian, registrar, dean, admin, hr, payroll, accountant, budget, cashier, supply, approver, staff
apps: home
order: 2
---

## November 2026

### Follow a job application through the recruitment stages
- Applicants (and employees who applied) follow each application under **My applications → See its progress**: the school's recruitment stages with dates, what happens now, HR's notes (from *HR office*) and the outcome, opened from the bell. HR managers **Move** applications to a later stage, back one with a reason, or to an outcome (one or several at once, with a note and an internal remark), see the counts per stage, and set the stages under **HR settings → Recruitment stages**; earlier statuses moved to the stages with their history. See [the applicant's guide](applicant#follow-your-application), [the HR guide](hr#move-an-application-to-another-stage) and [the administrator's guide](admin#check-the-recruitment-stages).

### The plantilla register and the PSIPOP in People
- HR managers keep the plantilla under **People → Plantilla**: each item as DBM issued it (item number, position, salary grade, office and campus, fund source, area code, area type and level, date created and authority), filled, vacant, unfunded or abolished, with its incumbent read from their employee record, the authorized and actual salaries from the salary schedule, filters, totals, CSV export and a printable **PSIPOP** on Legal paper. Item numbers typed on employee records before were moved into the register (drafts to review where they did not match). Linking an item never changes the appointment status. A vacant item has **Post a job opening**. See [the HR guide](hr#record-a-plantilla-item); administrators: [the new permission](admin#change-what-an-account-type-may-do).

### Recruitment in People: job openings, applicant accounts and internal applications
- HR managers post **job openings** under **People → Recruitment → Job openings** (position, plantilla item, salary grade with the monthly salary, place of assignment, qualification standards, vacancies, closing date, **Open to all** or **Internal only**) and follow the applications to each with a simple status the applicant is told about on the bell. See [the HR guide](hr#post-a-job-opening).
- People outside the school find the openings on the ATLAS home page (**Job openings**) and sign up with basic information only. Their **applicant account** sees only Job openings and My applications, and closes after 365 days (a setting), with a warning first; closed accounts are removed later. See [the applicant's guide](applicant).
- Employees apply for promotions and transfers with their own account, from **People → Job openings**: the application is marked Internal and linked to their record. See [the employee guide](employee#apply-for-a-job-opening).
- Administrators: the new settings are under **Settings center → ATLAS People → Job applicants**, and the new permission under **Roles & permissions → ATLAS People**. See [the administrator's guide](admin#set-how-long-job-applicant-accounts-last).

### Your school as the brand, powered by ATLAS
- Under **Settings & branding → Branding**, administrators can now choose **Our school, powered by ATLAS**: the school's seal and short name lead every system (*LA Learn*, *LA home*, the sign-in pages, the browser tab) and ATLAS shows only as a small *Powered by ATLAS*. A school colour can now have its own **Accent**, and **Preview** shows the top bar and the sign-in page before saving. ATLAS stays the default. See [the administrator's guide](admin#lead-with-your-school-s-name-and-seal).

### PDF Studio export: tables, headings and notes
- **PDF Studio export**: tables with numbers set flush right keep one column per heading in Word, Excel, CSV and the other formats; headings are found page by page; characters you typed that the PDF fonts lack are kept in documents and spreadsheets; notes after a download no longer look like errors and stay under the button; clearer **Save as** choices ("One document for each file added (ZIP)"); touch wording in the page editor on phones. See [the PDF Studio guide](pdf-studio#export-as-word-excel-text-or-pictures).

### Documents: figures on the home page, and legal holds shown
- The **Documents** card on the ATLAS home shows figures from your own files, and while a legal hold applies, **Move to trash** and **Delete for good** are greyed out with the reason. See [the Documents guide](documents#delete-or-restore-a-document).

### 2-step verification: wrong codes lock the account's code step
- Wrong 2-step verification codes now count for the account from every address, recovery codes too: after a few, no code is taken for a while and the person is told on the bell; only administrators change **Sign-in and passwords** and Keycloak sign-in, and profile pictures are shown only to people with a reason to see that person. See [getting started](getting-started#sign-in-with-2-step-verification).

### ATLAS Documents: firmer rules for holds, restricted files and links
- A legal hold on a folder now holds everything inside it: nothing there can be deleted, moved out or lose old versions. *Restricted* documents reach only the people named on them (not groups, nor their folder's sharing), and only those who manage them open the file. Links without a password stop when their document becomes confidential or every link must have a password, folder links without one leave confidential files out, and each view counts against a link's download limit. See [the Documents guide](documents#send-a-link-to-someone-outside-the-school).

### PDF Studio exports Word, Excel, text and pictures
- **PDF Studio** now exports more than PDFs. Under **Export → Format**, choose **Word**, **OpenDocument text**, **Rich Text**, **Web page**, **Markdown** or **Plain text** for a document to go on editing (paragraphs, headings, tables and pictures read back from the pages), **Excel** or **CSV** for the text in rows and columns with numbers as numbers, or **PNG**, **JPEG** or **SVG** pictures of each page. Your arrangement, changes and signatures go in. See [the PDF Studio guide](pdf-studio#export-as-word-excel-text-or-pictures).

### Sign-in at busy times: school networks
- A campus that reaches the internet through one address is no longer treated as one visitor. Under **System → Sign-in and passwords → School networks**, administrators list the campus addresses (the page suggests the busiest ones), and there the sign-in and request limits are multiplied, so a morning of typos or a rush of sign-ins no longer makes the whole campus wait. See [the administrator's guide](admin#list-the-school-s-networks).
- Keycloak sign-ins have their own limit, no longer shared with calendar feeds and document checks.
- Calendar apps subscribed to an ATLAS calendar are limited per calendar, not per address, so Google or Outlook fetching many people's calendars is no longer turned away. Phones on IPv6 count as one visitor per home or mobile network for the sign-in limits. Pages load faster behind Cloudflare (files the browser already has are no longer downloaded again), and the figures on the home page's cards are worked out at most once a minute.

### ATLAS Documents: files and sharing for everyone
- A new system, **Documents**, on the ATLAS home page for every employee and student (not for parents). Keep your own files in **My files**, work in the folders your office or college shares (**School folders**), and open what others share with you (**Shared with me**). See [the Documents guide](documents).
- Files go up in pieces with a progress bar, keep every version, can be checked out while you edit them, and are found by their words (text, Word, Excel, PowerPoint and OpenDocument files). ATLAS reads each file to tell what it really is: programs, scripts, web pages, SVG and Office files with macros are never accepted, and a file whose name does not match its content is refused. Every file is encrypted on the server.
- Share a document or folder with people, account types, departments or everyone signed in, at **Can view**, **Can edit** or **Can manage**; never more than you have. Employees can send links to people outside the school, with a password, an end date and a download limit, and collect files with an upload link. Students share with their teachers and classmates by name only.
- Administrators set the rules in **Admin panel → Document control**: file types, size and storage, sharing and links, the trash, and the activity (links that work, refused uploads, an integrity check of every file). See [the administrator's guide](admin#set-the-rules-for-documents). Keep the new server key (`server.key` beside the data file) with your backups: see [Questions](admin#questions).
- Someone you share a document or folder with by name is told on the **bell**, and the bell also shows when your link is first opened or a file arrives through an upload link. See [the Documents guide](documents#share-with-people-in-the-school).

### Notifications and 2-step verification, from CORE
- **Notifications**: the bell in the top bar of every system shows what concerns you, such as your enrollment decided, your work graded, a grade sheet to approve, a leave request to decide, your payslip ready, or a voucher or purchase request waiting for your step. **See all notifications** has the full list. See [getting started](getting-started#see-your-notifications).
- **2-step verification**: sign in with your password and a code from an authenticator app, with recovery codes for a lost phone. Turn it on under **My security**. See [getting started](getting-started#turn-on-2-step-verification).
- Administrators choose who must use it under **System → Sign-in and passwords**, see who uses it in **Users & Access**, and can **Reset 2-step verification** for someone who lost their phone. See [the administrator's guide](admin#set-the-rules-for-passwords-and-sign-in).

### The ATLAS home, sized as CORE's home
- The system cards, the **Admin panel** bar and the shortcuts under **Administration** now have CORE's sizes: system names are a little smaller and in the school colour, and the Admin panel bar and its four shortcuts are more compact. On a phone, the whole Admin panel bar opens it.
- **Tools** show as cards like the systems (PDF Studio in red, with what it does), and as small tiles in **Compact**.

### PDF Studio, from CORE
- **PDF Studio**, a new tool under **Tools** on the ATLAS home page and in the **Systems** menu: turn Word, Excel, PowerPoint, OpenDocument, text and CSV files and pictures into PDF, put PDFs together, reorder, turn and remove pages, number them, change a line of text, add text, white-out and ticks, and sign. See [the PDF Studio guide](pdf-studio).
- A signed PDF can have a **signature record page** with a code such as *ATLAS-7KQ2-M9XA*; **Verify a signed PDF** says whether a file is unchanged since it was signed. See [the PDF Studio guide](pdf-studio#verify-a-signed-pdf).
- Administrators choose which account types may use it, under **Admin panel → Home page & systems → Tools** (employees by default; students and parents when the school switches it on). See [the administrator's guide](admin#choose-who-can-use-pdf-studio).

### Choosing a system, as in CORE
- **Your systems** on the ATLAS home page shows a few figures from your own work on each card (sections you teach and work to grade, your classes and work to do, requests waiting for you…). See [getting started](getting-started#walkthrough).
- **Pin a system** with the star on its card: it comes first on the home page and in the **Systems** menu, on every device. See [getting started](getting-started#pin-a-system-to-the-front).
- **Compact**, beside *Your systems*: every system at once as small tiles; phones start in Compact. See [getting started](getting-started#see-every-system-at-once).
- The **Systems** menu (the grid in the top bar, now on the home page too) shows every system as a tile, yours first and coming soon greyed.

### Your profile, your picture and quick access, as in CORE
- **My profile**, under your name in every system: your account, your studies or work (with links to your academic or HR record), your children for parents, and the systems you can open. See [getting started](getting-started#see-your-profile).
- **Your picture**: choose **Add my picture** under your name, frame the photo, and it shows in the top bar and your profile. See [getting started](getting-started#add-or-change-your-picture).
- **My security**: every browser and device signed in with your account, and **Sign out** on one or **Sign out everywhere else**. See [getting started](getting-started#see-where-you-are-signed-in).
- **Quick access** (the lightning bolt in the top bar): pin the pages you use most, and they follow you to any device; recent pages too. **Systems** (the grid) now lists the systems you can open, instead of going straight home. See [getting started](getting-started#pin-the-pages-you-use-most).
- **A title** beside your name (your position in the school), given by administrators in Users & Access, where they also see everyone's picture and can open anyone's profile. People's **My profile** is now **My HR record**. See [the administrator's guide](admin).

### The Security monitor
- **System → Security monitor**, for administrators in every system's sidebar, as in CORE. Four tabs for the last hour, day, week or month, updated every minute: **Software status** (checks on the server and the school's settings, each with the reason and a link to the fix), **API security** (requests ATLAS refused, by kind, with their OWASP item; failed sign-ins; addresses to watch; the controls in force; every API address), **Traffic** (requests, response times, the busiest and slowest routes) and **User activity** (who is signed in now, active people, sign-ins and changes). A metrics token lets Prometheus and Grafana collect the same numbers. See [the administrator's guide](admin#watch-the-server-with-the-security-monitor).
- **The data file is saved readable only by ATLAS** (and the server's own group), like the audit log.

### Stronger protection for the API
- **Sign in again after 12 hours**, however busy (and still after 8 idle hours). Administrators can change both in **Sign-in and passwords** (**Sign out after (hours signed in)** is new). See [the administrator's guide](admin#set-the-rules-for-passwords-and-sign-in).
- **Changing what an account may do signs that person out**, so they continue with the new access, never the old one.
- **One lock per username.** Wrong passwords lock a username on every sign-in page together, and many guesses sent at once count each one.
- **Passwords are hashed more strongly**, without slowing ATLAS for everyone else; older ones are upgraded the next time each person signs in.
- **A change asked for by another website is refused**, and every request is checked for its shape before ATLAS acts on it.
- **Test connection** for Keycloak is for administrators only, and ATLAS never calls an address on a private network unless the server allows it.
- Everyone signs in once more after this update.

### The Admin panel on the home page
- **Administration**, below your systems on the ATLAS home page, as in CORE: the **Admin panel**, and shortcuts to the pages in it you use most (administrators: **Users & Access**, the **Settings center**, the **Audit log** and **What's new**; registrars: **Enrollment requests** and **Applicants**). For administrators and registrars only. The Learn tile now says **Manage Learn**. See [the administrator's guide](admin).

### ATLAS behind Cloudflare
- **System → Cloudflare** (Admin panel, administrators only) puts ATLAS behind Cloudflare at a name on the school's own domain, like `atlas.school.edu.ph`. Paste a Cloudflare API token once: ATLAS adds the address in Cloudflare, sets SSL/TLS to Full (strict), and the server switches over by itself, with its own certificate. The token is not kept. The page then shows whether the server has its certificate and answers through Cloudflare, can make the server **Only accept visitors through Cloudflare**, and can switch Cloudflare off again. The server needs its Cloudflare helper installed once. See [the administrator's guide](admin#put-atlas-behind-cloudflare).

### Safer and faster under load
- **The Audit log check is clearer about what it seals.** The notice now reads **Sign-in and access log intact** and says how many of the entries below (Settings, Finance and Academic) come from the data file and are restored with a backup, rather than implying every row is sealed. See [the administrator's guide](admin#read-and-export-the-audit-log).
- **The Audit log opens quickly however large it grows:** the integrity check no longer re-reads the whole file on every visit.
- **A visitor who is not signed in can no longer send a large request** to slow the server; uploads still work once you are signed in.

### Users & Access and the Audit log, as in CORE
- **ATLAS Control is gone.** Its pages are now in a **System** group at the bottom of the sidebar, as in CORE, for administrators only, in whichever system is open: the Admin panel, People, Academic and Finance. See [the administrator's guide](admin#find-an-account-change-it-reset-its-password-or-disable-it).
- **Users & Access** is one page, as in CORE: every account with its type, linked employee, status and last sign-in, and **Edit**, **Access**, **Reset password**, **Unlock**, **Sign out**, **Audit log** and **Delete** on each row; **+ Add user** for staff accounts of any type; and **Account types**, what each type can do in each system. It replaces **Admins, registrars & deans**.
- **Audit log** opens on the last 30 days, with **Export CSV** and the check that the log is intact.
- **Roles & permissions**, **Sign-in and passwords** and **Single sign-on** are back in the Admin panel, under **System**.

### ATLAS Control: access as in CORE
- **Own access:** in Control, open an account and choose **Change access** to give that one person a permission more, or take one away, without changing their account type. See [the administrator's guide](admin#give-one-account-more-or-less-access).
- **Audit trail:** the log is now kept as CORE keeps it: in its own file, every entry chained to the one before. The page says **Intact.** when nothing was changed, removed or reordered. Restoring a backup no longer touches it. Changes to accounts, access and settings show each field before and after.
- **Accounts:** link a staff account to its employee record under **Edit**, and **Delete** an account that has no records (others are disabled, so the records keep who made them).

### ATLAS Control: the administrators' control panel
- **ATLAS Control** is a new system for administrators only: a **Control** tile on their ATLAS home page, and **ATLAS Control** in the Admin panel's sidebar. Nobody else sees it or can open it. See [the administrator's guide](admin#find-an-account-change-it-reset-its-password-or-disable-it).
- **Accounts:** every account in every system in one list, with search and filters. An account's page shows what it can open, where it is signed in and its trail, and has its actions: reset the password, end its sessions, unlock it, change its type or campuses, disable it, unlink it from Keycloak. **New staff account** makes accounts of any staff type.
- **Sessions** shows everyone signed in now, with the browser and network address; end one session or everyone else's. **Locked sign-ins** lists usernames locked after wrong passwords, and unlocks them.
- **Audit trail:** sign-ins and failed sign-ins with the network address, every change by staff in every system, refused requests, and the Settings, Finance and Academic logs in one list. Filter it and **Download CSV**. Passwords are never recorded.
- **Access map** shows which account types open which systems and Learn modules. **Roles & permissions**, **Sign-in and passwords** and **Single sign-on** moved from the Admin panel to Control; their old addresses open them there.

### Keycloak: set up for me
- **Single sign-on** has a new **Set up for me**: type the realm address and a Keycloak administrator's sign-in (or a service account's), and ATLAS creates its client in Keycloak, keeps the client secret on the server and switches single sign-on on. Nothing needs to be changed on the server by hand, and the Keycloak sign-in is not saved. See [the administrator's guide](admin#set-up-single-sign-on-with-keycloak).

### Second security review: first fixes
- **Quizzes:** with *Students see answers: Right after they submit*, a student who still has attempts left now sees their score only. The correct answers show once no attempts are left or the quiz closes, so a second attempt is still the student's own work. See [the teacher's guide](teacher#build-a-quiz-or-exam) and [the student's guide](student#take-a-quiz-or-exam).
- **Parents:** a link that does not share **Grades** no longer shows final grades under **Enrollment**.
- **Keycloak:** matching by username links teachers, registrars, deans, administrators and officers only when their verified Keycloak email is also the one on their ATLAS account. With ATLAS passwords switched off, typing a password gives the same answer whether it was right or not. See [the administrator's guide](admin#set-up-single-sign-on-with-keycloak).
- The **Apply for admission** form accepts ten applications an hour from one network address.
- **People, payroll:** a finalized payroll run is the record of what was paid, so only an administrator can delete it; the payroll office corrects it in the next run with **Adjust**. See [the payroll guide](payroll#questions).
- **People, privacy:** the reason for a leave and its medical certificate are shown to HR only. The payroll office sees the type, dates and status.
- **People, own records:** officers cannot add or change their own attendance, loans or which leave they get, and HR cannot unlink a Finance office account. A leave day entered in the DTR always has a leave type.
- When ATLAS refuses something (for example deleting a payroll run that Finance is using), the screen now says why instead of doing nothing.
- **Finance, payments:** a voucher is paid to the bank account it was certified with. An LDDAP-ADA voucher is certified only when the payee's card has a bank account, and a later change to the card does not change where an approved voucher is paid. See [the cashier's guide](cashier#pay-by-lddap-ada).
- **Finance, card file:** on an existing card, the name, bank details, status (including blacklisting) and fidelity bond are changed by the Chief Accountant or an administrator only, and **History** keeps the old and new value.
- **Finance, supplies:** nobody approves or issues their own requisition.
- **For whoever looks after the server:** new servers run Node.js 22 and require IMDSv2, and an update's tests no longer run as root. A server set up earlier needs one command, once: see `deploy/aws/EC2.md`, *Bringing an older server up to date*.
- **Finance, small fixes:** **New advance (DV)** opens the form as a cash advance; depreciation offers **Book** only for a month that has ended; a voucher shows what an advance is for in words.

### The guides were checked against every screen
- Every guide was followed step by step in ATLAS and corrected where a name, a step or a result no longer matched the screen: confirmations that were missing (**Finalize**, **Withdraw**, **Release**), buttons that load a report (**Show**), where a list is filtered, and who may do what.
- The guides now use the same words throughout: **choose** a button, link or tab; **press** a key; **tick** a box.
- [Getting started](getting-started#questions) explains the newer messages: *Too many requests*, the lock after wrong passwords, and being taken back to the sign-in page.

### Small fixes found while checking the guides
- In Finance and Academic, choosing a row of a list opens the record every time (it could stop working after the first list you opened).
- When your session ends, the sign-in page now says so. When you send too many requests, ATLAS shows *Please wait a moment* with the time to wait, instead of *Cannot reach the server*.
- A dean's account can be linked to their employee record, so deans get self-service in People. See [the HR guide](hr#give-an-employee-a-sign-in-account).
- The calendar no longer shows classes and due dates from an enrollment request that is still waiting for approval.

### Help & guides: better search, and help before you sign in
- The search on the **Help & guides** page now looks in each section and each question, and understands everyday words: *login* finds **Sign in**, *salary* finds your payslips, *tuition* finds your receipts. Your own guides come first, and each result opens at the right section.
- **Help & guides** on the sign-in page now opens [Getting started](getting-started) without signing in: how to sign in, what to do about a forgotten password or a locked account, and what each sign-in message means. The other guides open once you are signed in.

### Security review
- ATLAS now limits how fast one person or one network address can send requests, and how many wrong passwords one address may try. Administrators set both under **Settings & branding → Sign-in and passwords**. See [the administrator's guide](admin#change-school-settings-and-branding).
- A wrong-password lock now applies to the address the wrong passwords came from, so nobody can lock a colleague out from elsewhere.
- Password hashes are now also encrypted with a key kept outside the data, so a copied backup cannot be used to guess passwords. **Settings & branding → Sign-in and passwords** shows it is on. See [the administrator's guide](admin#make-a-backup-or-restore-one).
- Only administrators create and change Finance office accounts, also in People. Officers cannot change their own leave, pay or payslip. See [the HR guide](hr).

### A new sign-in page
- Every ATLAS sign-in page (the home page, the admin panel, and the page shown when an account cannot use a system) has a new look: the school's seal and name at the top, the form under it, and the systems ATLAS opens at the bottom. **Help & guides** and **Dark mode** are now on the sign-in page too. See [Getting started](getting-started#sign-in).

### A tidier home page
- **Your systems** on the ATLAS home page is now one row of tiles of the same size. When they do not all fit, use the arrows beside *… available*, the dots under the tiles, or swipe. See [Getting started](getting-started#walkthrough).

### REX Bookstore e-Reader (coming soon)
- The ATLAS home page has a **REX Bookstore e-Reader** tile, marked **Coming soon**: e-books for your subjects from the REX Bookstore app's library, for students and teachers. Administrators switch it on under **Home page & systems** once it is connected. See [the administrator's guide](admin#choose-what-the-atlas-home-page-shows).

### School calendar
- Students, teachers and parents have a **Calendar** in Learn: class meetings, due dates (and whether work was handed in), examinations, holidays and days without classes, school events and term dates, by month, week or list, with filters. Parents see each linked student as far as the link allows. Subscribe from Google Calendar, Outlook or a phone. See [the student's guide](student#use-the-calendar), [the teacher's guide](teacher#use-the-calendar) and [the parent's guide](parent#see-the-school-calendar).
- The calendar has a cleaner look: one frame, a dot and time for each class or due date, events of several days as one bar, tick boxes to show or hide each kind, a week of seven columns and a list with the date beside each day.
- Administrators and registrars plan it under **School calendar** in the Admin panel: each event has a kind (holiday, examinations, meeting…), who it is for, and whether classes are held. See [the administrator's guide](admin#plan-the-school-calendar).

### Settings for administrators
- A **Settings center** in the Admin panel lists every setting of every system in one place: search it, see what differs from the defaults, restore a default, and see who changed what, with the value before and after; any change can be undone. Settings can be exported to a file and imported into another ATLAS, with a preview. See [the administrator's guide](admin#find-any-setting-and-compare-it-with-the-default).
- **Roles & permissions**: administrators choose what each account type may do in each system. See [the administrator's guide](admin#change-what-an-account-type-may-do).
- New settings: password length and letters-and-digits, lockout, signing out after idle hours, always changing the first password, the largest upload, the quiz grace period, the parent absence alert, and the format of student, employee and document request numbers. See [the administrator's guide](admin#change-school-settings-and-branding).
- Academic's grading scale can have bands added or removed and a different lowest passing grade, with checks that the scale is in order. See [the registrar's guide](registrar#change-the-academic-settings).
- Payroll setup shows the leave type tardiness is charged to and the payroll fund cluster. See [the payroll guide](payroll#change-payroll-setup).

### Help & guides
- A **Help** button (the question mark in the top bar) in every system opens the guide for your job there. Every guide has a walkthrough, how-to steps, the screens and common questions. See [Getting started](getting-started).
- Administrators can edit any guide, and add the school's own; see [the administrator's guide](admin#edit-a-guide).
- The Help page has a new look: the guides by system on the left, *On this page* on the right, numbered steps, framed screenshots that open larger, and search from the top bar (press `/`). See [Getting started](getting-started#get-help).

### ATLAS People: government payroll
- Payroll follows the national government's rules for a state university: salary grade and step (EO 64, s. 2024), PERA, RATA, GSIS, PhilHealth, Pag-IBIG, BIR tax, loans with the ₱5,000 net-pay floor, and the mid-year bonus, year-end bonus and cash gift, PEI and clothing allowance. See [the payroll guide](payroll).
- A finalized payroll goes to ATLAS Finance from its **Finance** tab: the obligation request, the payroll voucher and the remittances to GSIS, PhilHealth, Pag-IBIG and BIR. See [the payroll guide](payroll) and [the budget officer's guide](budget-officer).
- Clock-in locations and the shared time clock; the HR dashboard shows today's attendance per employee. See [the HR guide](hr).

### ATLAS Finance
- Clearer screens throughout, a **Find a document** page, and the dashboard's **Waiting for you** list for each office. See your office's guide.
