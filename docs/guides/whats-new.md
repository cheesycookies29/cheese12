---
id: whats-new
title: What's new in CORE
summary: The changes in each update, newest first, and which guide explains them.
roles: admin, hr, hrstaff, payroll, it, support, sales, salesmgr, pm, employee
apps: home
order: 2
---

## November 2026

### PDF Studio exports Word, Excel, text and pictures (0.68)
- **PDF Studio** now exports more than PDFs. Under **Export → Format**, choose **Word**, **OpenDocument text**, **Rich Text**, **Web page**, **Markdown** or **Plain text** for a document to go on editing (paragraphs, headings, tables and pictures read back from the pages), **Excel** or **CSV** for the text in rows and columns with numbers as numbers, or **PNG**, **JPEG** or **SVG** pictures of each page. Your arrangement, changes and signatures go in. See [the PDF Studio guide](pdf-studio#export-as-word-excel-text-or-pictures).

### Document Management (0.67)
- A new module, **Document Management**, on the CORE home. Keep files in **My files** and company folders, with every version, check-out while you edit, and search by the words inside PDF and Office files. Share with people, account types, departments or everyone, and send links to people outside the company (view only, download with a limit, or upload links to collect files), with a password and an end date. CORE reads every file to tell what it really is: programs, scripts, web pages and Office files with macros are never accepted, and every file is stored encrypted. See [the Documents guide](documents).
- Administrators set which kinds of files are accepted, sizes and storage, the sharing and link rules and the trash in **Admin panel → Document control**, and see the links that work and refused uploads there. See [Set up Document control](admin#set-up-document-control).

### PDF Studio on your phone (0.66.1)
- **PDF Studio** works better on phones and small tablets. In the page editor, swipe to move around the page and tap where text, a tick, the date or your signature goes; the page keeps its place when you choose a tool or zoom, and has more room on the screen. Signing with a finger has a larger box. See [the PDF Studio guide](pdf-studio#add-text-white-out-highlights-ticks-and-dates).

### PDF Studio takes many more files, up to 100 MB (0.66)
- **PDF Studio** now takes files of up to 100 MB each (25 MB before), sent in pieces with a progress bar, and many more kinds: protected PDFs (it asks for the password; PDFs that only stop printing or copying just open), old Word, Excel and PowerPoint files (.doc, .xls, .ppt), RTF, TIFF scans of several pages, Outlook (.msg) and other e-mails (.eml), e-books (EPUB), code and data files (.json, .xml, .sql, .log…), Office files with macros and templates, and ZIPs of files (each one added). Scanned PDFs made of fax pictures now show instead of grey pages. See [the PDF Studio guide](pdf-studio#before-you-start).

### PDF pages that are one picture show again (0.65.2)
- A PDF page made of one big picture (a CV exported from a design tool, a page scanned at 300 dpi) showed as a grey page in **PDF Studio** and its page editor. It shows again. A picture in a format CORE cannot show (JPEG 2000, JBIG2, fax) is still grey, and the page editor now says so; it stays as it is in your PDF. See [the PDF Studio guide](pdf-studio).

### PDF Studio fixes (0.65.1)
- **Preview** opens the PDF again (it opened an empty tab). Excel numbers, amounts, dates and times now look as they do in Excel. Form answers and stamps on a PDF are kept. Turning a page turns what you added with it; **Page setup** keeps your arrangement; a character the PDF fonts do not have is reported when you export. The page editor zooms, keeps your work if you leave it, and shows typed signatures in their handwriting style. See [the PDF Studio guide](pdf-studio).

### Change text and sign PDFs (0.65)
- **PDF Studio** has a page editor (the pencil on a page): change the text on a page (the old words are taken out of the page, the new ones go where they were), add text, white-out, highlights, ticks, crosses, today's date and pictures, and sign. **Sign** lets you draw, type or upload your signature and place it on any page; the PDF can end with a signature record page, and **Verify a signed PDF** tells whether a file is exactly the one that was signed. Every page now shows as it looks. See [the PDF Studio guide](pdf-studio#change-the-text-on-a-page).

### PDF Studio, the first of the Tools (0.64)
- The CORE home has a new **Tools** area, under Integrations, for everyone. Its first tool, **PDF Studio**, turns Word, Excel, PowerPoint, OpenDocument, text, Markdown, CSV and HTML files and pictures into PDF, and puts PDFs together. Drop your files, arrange the pages of all of them in one place (drag, turn, remove, add blank pages), set the page size and margins, and download one PDF, or one per file or per page in a ZIP, with page numbers, a header, a footer or a watermark if you like. Your files are yours only and are deleted after 4 hours. See [the PDF Studio guide](pdf-studio).

### Show or hide what is coming soon (0.63)
- **Admin panel → Modules** has a **Coming soon** section: a switch for each module on the roadmap (Finance & Accounting, Procurement, Document Management, C-suite), each integration (Microsoft 365, Google Cloud, CodeRabbit) and Data replication. A hidden one is gone from the CORE home, the modules menu and the side menu for everyone until it is shown again; **Hide all** and **Show all** do them all at once. See [Show or hide what is coming soon](admin#show-or-hide-what-is-coming-soon).

### Automation rules (0.62)
- Under a project's **Automations**, project managers add **rules**: *when* something happens to a task (it is added, moves to a status, is assigned, gets a comment, becomes overdue, or its last subtask is done), *if* it matches some conditions, *then* CORE does it: move it, assign it, set its priority or due date, add a watcher, a comment or checklist items, notify someone, or create a follow-up task. Six examples to start from. Each run is in the **Run log**. See [Set up a rule](projects#set-up-a-rule-project-managers).

### Recurring tasks and the run log (0.61)
- A project has a new **Automations** tab. Project managers set up **recurring tasks**: CORE makes the task on a schedule (every working day, every week on the days you tick, a day of the month or its first or last working day), with the same assignee, checklist and due date each time, and skips it while the last one is still open. The **Run log** shows each time one ran: made, skipped or failed (managers are told of a failure). See [Make a task repeat on a schedule](projects#make-a-task-repeat-on-a-schedule-project-managers) and [Read the run log](projects#read-the-run-log).

### HR & Payroll is now Human Resource Management (0.60)
- The module is called **Human Resource Management** everywhere: the CORE home, the modules menu, its side menu, the Admin panel, Help and notifications. Nothing else changes: the same pages, records, payroll and permissions. See [the HR guide](hr).

### Export the timeline (0.59)
- A project's **Timeline** has **Export**: **Report (PDF)**, a landscape report with the Gantt chart and the schedule to print or save as PDF, or **Image (PNG)**, the chart as a picture. See [Export the timeline as a report or an image](projects#export-the-timeline-as-a-report-or-an-image).

### Replies and emoji reactions on comments (0.58)
- Comments on a task now read like a conversation: **Reply** keeps an answer under the comment it answers, in a thread; an emoji (👍 ❤️ 🎉 😄 🙏 👀 ✅ 🚀) can be added under any comment; your own comments can be edited. See [Comment on a task](projects#comment-on-a-task).

### Download all of a task's files as a ZIP (0.57)
- In **Project Management**, a task or milestone with two files or more has **Download all (.zip)**: every file in one compressed ZIP, named after the task (*LEA-12 files.zip*). See [Attach files to a task or a deliverable](projects#attach-files-to-a-task-or-a-deliverable).

### More kinds of files on tasks (0.56)
- Tasks and milestones in **Project Management** now take Word, Excel and PowerPoint files (.docx, .xlsx, .pptx), OpenDocument files (.odt, .ods, .odp), GIFs, and text and CSV files, besides PDFs and photos, up to 8 MB each. Each shows its kind on its icon. Programs, web pages, archives and macro-enabled files are still refused. See [Attach files to a task or a deliverable](projects#attach-files-to-a-task-or-a-deliverable).

### A scrolling list for many files (0.55)
- In **Project Management**, a task or milestone with more than five files keeps them in a list that scrolls inside the card, so the rest of the page stays close. See [Attach files to a task or a deliverable](projects#attach-files-to-a-task-or-a-deliverable).

### Previews of attached files (0.54)
- In **Project Management**, the files on a task or a milestone show a preview as their icon: a photo shows itself, a scanned PDF its first page. Click it to see it larger. See [Attach files to a task or a deliverable](projects#attach-files-to-a-task-or-a-deliverable).

### Drag and drop files onto a task (0.53)
- In **Project Management**, drop files from your computer on a task's **Files** card (or a milestone's files window) to attach them, several at once. A file CORE does not take is left out and named; the others are added. See [Attach files to a task or a deliverable](projects#attach-files-to-a-task-or-a-deliverable).

### Task keys and links to share (0.52)
- Each project has a **key** of three letters, its own or the first three letters of its name, and its tasks are named with it: **LEA-1**, **LEA-2**…. Every task has a link to share, `/t/LEA-12`: **Copy link** on the task. Existing tasks were renamed (*PRJ-0001-12* is now, for example, *LEA-12*), and their old names still open them. See [Share a link to a task](projects#share-a-link-to-a-task).

### Favorite projects (0.51)
- In **Project Management**, choose the **star** beside a project's name to make it a favorite. Your favorites lead the **Overview** as cards with their progress, health and next milestone, and are listed in the side menu. See [Keep your favorite projects at hand](projects#keep-your-favorite-projects-at-hand).

### Integration cards with a design (0.50)
- The **Integrations** cards on the CORE home each have their own colour, show CORE's mark linked to the service, and list what each will bring. See [Getting started](getting-started#walkthrough).

### Integrations on the CORE home (0.49)
- Under **Your modules**, a new **Integrations** area shows the services CORE will connect to, all coming soon: **Microsoft 365**, **Google Cloud** and **CodeRabbit**. See [Getting started](getting-started#walkthrough).

### Data replication on the roadmap (0.48)
- **IT Asset Management** has a **Data replication** item in its side menu, marked **Soon**: a second, up-to-date copy of the asset records in another location. It is not available yet; its page says what it will do. See [Data replication](it-assets#data-replication-coming-soon).

### Phones, tablets and small laptops (0.47)
- On a phone the CORE home now opens in the **Compact** view, two tiles a row even on the smallest phones. Choose **Cards** to go back to the larger cards; your choice is kept. See [Getting started](getting-started#walkthrough).
- On a small laptop or a tablet held sideways (up to about 1200 pixels wide) the side menu shows only its icons until you open it with the **menu** button, so lists and tables have more room. See [Open a module](getting-started#open-a-module).
- Windows (such as **New project**) never grow taller than the screen: the form scrolls and **Save** stays in view. On a tablet they open in the middle of the screen.
- Fixes for small screens: the top bar fits a 320-pixel phone; the **Reply | Internal note** switch on a ticket, the try-it table in **Payroll Setup** and the statuses table in the projects setup no longer run off the screen; long project names in **My work** wrap; the modules menu answers the arrow keys and **Escape**; contact emails, phone numbers and contract terms no longer break into many lines; a long file name keeps its extension (*.pdf*, *.docx*) when shortened.

### Compact view on the CORE home (0.46)
- **Your modules** has a **Cards | Compact** switch: **Compact** shows every module at once as small tiles in a grid, with the first figure of each and its pin star. See [Getting started](getting-started#walkthrough).

### A compact modules menu (0.45)
- The **modules** button at the top now shows every module at a glance, as small tiles: the ones you can open first (pinned ones leading), then the ones coming soon. **C-suite**, the executive dashboard, has a gold accent there and on the CORE home. See [Getting started](getting-started#walkthrough).

### A fuller projects demo (0.44)
- The demo data now has **26 projects** with about 260 tasks: most of them deliver the deals and contracts in the sales demo, so the portfolio, **Milestones**, the **Billing forecast**, the workload and **My work** look like a busy company. Three support contracts track time. Reload it under **Admin panel → Demo data**. See [the projects guide](projects#walkthrough).

### Documents on contracts (0.43)
- A contract in **Sales & CRM** now keeps its documents: upload the signed contract, annexes and amendments (PDF, scans or photos, Word or Excel, up to 8 MB each) under **Documents** on the contract, and download them from there. See [Keep a contract's documents](sales#keep-a-contract-s-documents).

### Who changed what, in Sales & CRM (0.42)
- The **History** of every deal, lead, account, contact, bid and contract now names the person behind each change, and an edit lists each field it changed with the old and new value (for example *Value: ₱2,850,000 → ₱3,100,000*). See [the Sales & CRM guide](sales).

### A fuller sales demo (0.41)
- The demo data now has a full **Sales & CRM** book to try things on: 30 organizations, 56 contacts, 47 deals in every stage, 25 leads, 10 bids, 16 contracts (some due for renewal) and their calls, meetings and tasks. Reload it under **Admin panel → Demo data**. See [Load or remove the demo data](admin#load-or-remove-the-demo-data).

### Pinned modules, and C-suite on the way (0.40)
- **Pin your modules**: the star on a module's card on the CORE home puts it first, and your pins follow you to every device. See [Pin your modules to the front](getting-started#pin-your-modules-to-the-front).
- **C-suite**, an executive dashboard with the key figures from every module on one page, is on the CORE home as *Coming soon*.

### Security fixes (0.39)
- A third security assessment of CORE: the **Security monitor** shows the account checks, devices and addresses only to those who manage accounts, feedback ignores hidden direction characters, and on the AWS server the off-server backups are sealed and checked before a restore, updates need the approved **production** step, and CORE cannot change its own program files. See [Watch the security monitor](admin#watch-the-security-monitor).

### Safer updates and backups (0.38)
- On the AWS server, CORE now copies its data **off the server every hour** and **checks every night** that the latest copy can be restored. **Admin panel → Security monitor** shows both. Before each update, the most-used journeys (leave approvals, payroll, the service desk, feedback, and every page on a phone) are tried in a real browser, and an update can be set to wait for a person's approval. See [Back up and restore](admin#back-up-and-restore).

### Feedback fixes (0.37)
- Responses, status changes and deletions of feedback are now in the **Audit log**, numbers are never reused, and a reply that also changes the status says both. The inbox search finds phrases in formatted feedback, and the inbox fits on narrower screens.

### Feedback form fixes (0.36)
- The **New feedback** and **Respond** forms are laid out in one column again, **Esc** while text is selected no longer closes the form, and lists in a response show properly.

### Formatting in feedback (0.35)
- **Send feedback** now has the same editor as project comments: write the **Details** with bold, numbered steps, links and small tables, from its bar or by typing **/**. Administrators' **Responses** use it too, and both show formatted. See [Send feedback](getting-started#send-feedback).

### A security monitor for administrators (0.34)
- **Admin panel → Security monitor** shows, for the last hour up to 30 days: **software status** checks (Node.js support dates, errors, memory, disk, backups, HTTPS, rate limits, 2-step verification), each with what to do; **API security** (refused requests by kind, network addresses to watch, the controls in force, the list of API addresses); **traffic** (requests and response times by route); and **user activity** (who is signed in now, people active today, this week and this month, sign-ins, what people worked on). It refreshes every minute, and a health check and a metrics export let an outside tool watch CORE too. See [the admin guide](admin#watch-the-security-monitor).

### Everyone has a profile, with a role in the company (0.32)
- **My profile**, under your name at the top right, shows your role in the company (such as *Software Engineer*), your account, your employment and which modules you can open. Click a colleague's name in a project, a task or a comment for their profile. The role is set by administrators and says *Employee* until then; the top bar now shows it instead of the account type. HR's *My Profile* page is now **My HR record**. See [the getting started guide](getting-started#see-your-profile-and-a-colleague-s) and, for administrators, [the admin guide](admin#set-someone-s-role-in-the-company).

### Moving pictures: GIFs for your picture and project icons (0.31)
- Your profile picture and a project's own icon can be an animated GIF (up to 1 MB): it is kept as it is and moves wherever it shows. If your device is set to reduce motion, GIFs show standing still. See [Add your profile picture](getting-started#add-your-profile-picture) and [the projects guide](projects#give-a-project-its-icon).

### Comments in the new editor (0.30)
- A task's comment box is now the same editor as the description: bold, lists, checklists, quotes, code and tables, as they will look. Type **@** to pick someone on the project to mention. **Ctrl+Enter** posts. See [the projects guide](projects#comment-on-a-task).

### A path at the top of every project and task (0.29)
- Above the title of a project's pages and its tasks, a path shows where you are (*Projects › project › Board › parent task › task*); each part is a link. On a task, the view you came from takes you back to it with your filters. The arrow beside the project's name goes to another project. See [the projects guide](projects#find-your-way-with-the-path-at-the-top).

### Tables you can change (0.28)
- In the description editor, click in a table: a bar over it adds rows above or below and columns left or right, and deletes rows and columns. Its **…** button, or a right-click on a cell, also moves rows and columns, aligns a column left, center or right, and deletes the table. **Ctrl+Z** undoes. See [the projects guide](projects#change-a-table-s-rows-and-columns).

### A new description editor (0.27)
- Task descriptions are written as they will look: no more marks like `**` or `- `. Format with the toolbar, the small menu over selected text, or **/** for headings, lists, checklists, tables, code and pictures. Click **Edit** next to **Description** to write in place on the task page; **Ctrl+Enter** saves. Pasted text keeps its formatting. See [the projects guide](projects#write-a-task-s-description).

### Your own project icons (0.26)
- A project's icon can be your own picture, such as the client's logo: **Edit** the project, then **Upload a picture…** under **Icon**. It shows beside the name everywhere; **Remove picture** goes back to the icon. See [the projects guide](projects#give-a-project-its-icon).

### No limit on files in tasks (0.25.1)
- A task (and a milestone) can have as many files as you need, and a task's description as many pictures: the limits of 5 files and 20 pictures are gone. Each file is still up to 5 MB, PDF or photo. See [the projects guide](projects#attach-files-to-a-task-or-a-deliverable).

### Projects are for their members (0.25)
- Every project is now seen only by the people on its member list, and by administrators. Project Managers and Sales Managers see the projects they are on, not all of them. Add people under **Members** in the project form, or with **Members** at the top of a project. The **Private project** switch is gone: every project works that way. See [the projects guide](projects#choose-who-sees-a-project).

### Task descriptions show the right layout (0.24.2)
- Lists inside lists, lists with empty lines between items, checklists and tables now show as written; bold with italic inside, links with brackets and pictures inside a sentence too. The toolbar has a **Checklist** button, **Heading** goes smaller on a second click, and Enter in a list inside a list goes back to the outer list. See [the projects guide](projects#write-a-task-s-description).

### Private projects (0.24)
- A project can be **Private**: only the people on its member list, and administrators, can see it. Pick the members right in the project form (**Members** under **Private project**), or with **Members** at the top of the project. Project Managers and others who see every project do not, unless they are added. See [the projects guide](projects#choose-who-sees-a-project).

### Notifications (0.23)
- A **bell** in the top bar, for everyone: its red number counts what you have not read. Choose it for your latest notifications, under *Today*, *Yesterday* and *Earlier*; choose one to open the request, payslip, ticket, task or record it is about. **Mark all read**, **Unread only**, and **See all** for the full list with a module filter. See [Getting started](getting-started#see-your-notifications).
- You are told when a request needs your approval and when yours is decided; when your payslip is ready; when equipment is assigned or supplies are issued to you; when a ticket is assigned to you, its requester replies, or an agent replies to or resolves your ticket; when you are made the owner of a sales record; when an administrator answers your feedback. Project Management's **For you** is in the bell too, and reading one in either place reads it in both.
- On a phone the panel fills the screen's width, and **Dark mode** moves into the menu under your name.

### Profile pictures (0.22)
- Everyone can add a small profile picture: choose your name at the top right, then **Add my picture**, and frame the photo. It shows instead of your initials across CORE. See [Getting started](getting-started#add-your-profile-picture). Administrators can remove one from **Users & Access** (see [the administrator's guide](admin#remove-someone-s-profile-picture)).

### Formatted task descriptions with pictures (0.21)
- A task's description has a formatting toolbar: headings, bold, italic, strikethrough, code, links, lists, quotes and lines, with **Preview**. Add pictures with the toolbar, by pasting a screenshot or by dragging one in. See [the projects guide](projects#write-a-task-s-description).

### Project icons (0.20)
- Each project can have its own icon: a picture from CORE's set on a colour, shown beside its name in every list, on its pages and on its tasks. Without one, a project shows the first letter of its name. See [the projects guide](projects#give-a-project-its-icon).

### Compact or comfortable project lists (0.19)
- **Projects**, **Milestones**, a project's **List** and **My work** have a **Comfortable** / **Compact** switch. Compact shows about a third more rows on a screen; CORE remembers your choice in this browser. See [the projects guide](projects#make-the-lists-compact-or-comfortable).

### Phones and tablets (0.18)
- Every screen fits a phone: nothing makes the page wider than the screen, and wide lists are cards on tablets and landscape phones too. Tabs and chips that scroll sideways fade at the edge, and the one you are on is in view. See [Getting started](getting-started#use-core-on-a-phone).
- Buttons, menu items, links and checkboxes are easier to tap (at least 44 px), inputs no longer make the phone zoom in, and small text is larger.
- Forms show every problem at once, at its field, with the field's name (*First name is required.*), and take you to the first one. Long forms keep **Save** at the bottom of a phone's screen; windows fit a phone turned sideways with their buttons in view.
- On a phone: a list's filters fold into one **Filters** button; tickets, tasks and CRM records show the conversation, description or details first; board columns scroll on their own; messages appear at the top of the screen.
- **Timesheet** on a phone: one day at a time, with a day picker. See [the projects guide](projects#fill-in-your-timesheet). The List's bulk bar becomes **Actions** and **×**. See [the projects guide](projects#change-many-tasks-at-once).
- **Roles & permissions** on a phone shows one account type at a time. See [the administrator's guide](admin#change-what-an-account-type-may-do). The payroll register shows a summary per employee with **Details**. See [the payroll guide](payroll#read-the-register).
- **Won** on a deal now asks you to confirm, like **Lost**. See [the sales guide](sales).
- Help & guides: a screenshot opens full size on a phone to look around in; the guide editor has **Write** and **Preview** tabs on a phone.
- Tapping is exact: a link's tap area grows only into free space, so a tap on a name or a title never opens its neighbour, and the List's checkboxes always tick. In **My work** and other task lists the whole row opens the task. See [Getting started](getting-started#use-core-on-a-phone).
- On a tablet and a phone turned sideways, wide lists are compact cards (the fields side by side, the buttons at the top right), the filters fold into **Filters**, messages appear at the top and long forms keep **Save** at the bottom. **Access grants** and **Contacts** no longer scroll sideways. The page's main button comes first on a phone.
- **Payroll Setup**: **Restore 2025 government rates** is under the tax tables, out of the Save bar; the tax brackets show their whole values on a tablet. See [the payroll guide](payroll#change-payroll-setup).
- Smaller fixes: **Settings & branding** marks the field to fix; an empty reply, note or activity marks its box; a single wrong field is no longer repeated in a red box; a disabled button always looks disabled.

### Workload removed (0.17.1)
- **Workload** is no longer in Project Management. Task sizes still weigh progress and the burn-up; My work, the Timesheet and time tracking work as before. See [the projects guide](projects).

### Projects: sizes instead of hours, time tracking only where needed, and the Timesheet (0.17)
- Tasks have a **size** instead of an hour estimate: *XS*, *S*, *M*, *L* or *XL* (shown as *M · Medium*), a rough idea of the effort. Set it on the task, in the **List** (also for many tasks at once) or when you add a task. Progress and the milestone burn-up weigh tasks by size when most have one, and the burn-up counts *effort points* or tasks, never hours. *Hours left* is gone. See [the projects guide](projects#size-a-task).
- Your hour estimates became sizes (up to 2 h *XS*, up to 8 h *S*, up to 24 h *M*, up to 48 h *L*, more *XL*), noted in each task's history. See [the projects guide](projects#questions).
- **Workload** shows a level for each person and week, *Light*, *Normal*, *Busy*, *Overloaded* or *On leave*, each with its own shape, instead of hours against capacity. Open a cell for its tasks, their sizes and the days behind the level. See [the projects guide](projects).
- **Time tracking is per project** and off unless a project manager turns it on (**Track time on this project** under **Edit**), for time-and-materials work or a client who asks for a timesheet. Only then does the project have a **Time** tab, logging on its tasks and a budget in hours. Projects that had time logged on them track time already. See [the projects guide](projects#turn-time-tracking-on-for-a-project).
- A weekly **Timesheet** in the Projects menu for everyone on a project that tracks time: a row per project and task, Monday to Sunday, with your DTR shown under it for comparison only. Project managers open their members' timesheets. See [the projects guide](projects#fill-in-your-timesheet).
- **Projects setup → Effort sizes**: reword what each size means for your teams. See [the projects guide](projects#change-the-projects-setup-project-managers).
- The CSV import reads a **Size** column, and still an **Estimate (h)** column, turned into sizes; the template has **Size**. See [the projects guide](projects#import-tasks-from-a-csv-file-project-managers).

### The Admin panel (0.16)
- Everything administrators look after is now in one place, the **Admin panel**: the **Admin panel** card on the CORE home, **Admin panel** at the end of every module's side menu, and in the modules menu. The **System** items in the module menus moved there; old links such as `#/settings` and `#/users` still work. See [the administrator's guide](admin) and [Getting started](getting-started#open-the-admin-panel-administrators).
- A **Dashboard**: accounts, who is signed in, 2-step adoption, failed sign-ins and locks, the audit log check, modules, feedback waiting, data size and the last backup. See [the administrator's guide](admin#the-dashboard).
- **Roles & permissions**: change what each account type may do, with the defaults marked and **Restore defaults**. Administrators always keep everything. See [the administrator's guide](admin#change-what-an-account-type-may-do).
- **Access grants**: the service desk, Sales & CRM and Projects access of each person in one table. See [the administrator's guide](admin#give-someone-the-service-desk-sales-crm-or-projects).
- **Modules**: turn a module off for the company; it disappears for everyone but administrators, and nothing is deleted. See [the administrator's guide](admin#turn-a-module-on-or-off).
- The **Settings center**: every setting in one searchable list with its default, the change history with **Undo**, and export and import of the company's settings. See [the administrator's guide](admin#find-any-setting-and-compare-it-with-the-default).
- **Branding**: the company's colour, logo and sign-in headline, on every page and the sign-in page. See [the administrator's guide](admin#change-the-brand-colour-logo-and-sign-in-headline).

### Projects: watchers, daily digest, bulk edit, files, milestones and billing forecast, CSV import (0.15)
- **Watch** a task to hear of its comments and of it being done or cancelled; you watch tasks you add, are assigned or comment on. See [the projects guide](projects#watch-a-task).
- A **daily digest** on My work, and by email once a working day when the company turns it on and outgoing email is set up: your overdue tasks, those due soon, milestones at risk in projects you manage, and unread For you. Turn the email off for yourself with **Email me a daily digest**. See [Getting started](getting-started#get-the-daily-digest-by-email) and [the projects guide](projects#set-up-the-daily-digest-project-managers).
- **Change many tasks at once** on the List: tick them, then set the status, assignee, milestone or priority, move their dates in working days, add or remove watchers, or delete them. See [the projects guide](projects#change-many-tasks-at-once).
- **Files** on tasks and milestones, and the **acceptance document** of a deliverable. See [the projects guide](projects#attach-files-to-a-task-or-a-deliverable).
- A **Milestones** tab on the portfolio, with each deliverable's amount and the **billing forecast** by month for Sales & CRM users. See [the projects guide](projects#see-milestones-and-the-billing-forecast-across-projects).
- **Import tasks** from a CSV file, with a template, column matching and a check before anything is saved. See [the projects guide](projects#import-tasks-from-a-csv-file-project-managers).

### Projects: For you, hours left, quick filters, templates and the burn-up (0.14)
- **For you** on **My work**: a task assigned to you, an @mention, a comment on your task, your task done or cancelled by someone else, and being added to a project. Similar ones share a line; the number next to My work includes the unread ones. See [Getting started](getting-started#see-your-project-tasks-my-work) and [the projects guide](projects#catch-up-on-what-concerns-you-for-you).
- **Hours left** on every task: the estimate less the hours logged, or set by hand on the task or when logging time. Tasks, the list and a project's overview show estimate, logged and left; **Workload** now plans the hours left, not the whole estimate. (Replaced by task sizes in 0.17: see [the projects guide](projects#size-a-task).)
- **Quick filters** on the board and the list (*Mine, Unassigned, Overdue, Due this week, Blocked, High & urgent*), a search on the board, and **saved views**, your own or shared with the project. See [the projects guide](projects#filter-the-board-or-list-quickly).
- **Project templates**: mark a project as a template, and start new projects from one with the dates moved in working days. Three starter templates come with CORE. See [the projects guide](projects#start-a-project-from-a-template).
- **Milestone burn-up** on a project's overview: scope, work done and the expected line. See [the projects guide](projects#read-the-milestone-burn-up).

### More demo projects (0.13.2)
- The demo data now has ten projects in every state: on hold, completed and cancelled ones, one off track, one with its own statuses, one with a WIP limit and one with a task linked to a service desk ticket. See [the projects guide](projects#walkthrough).

### Modules carousel (0.13.1)
- The CORE home shows **Your modules** in a sliding row, like the ATLAS home: swipe it on a phone, or use the arrows and dots. Modules coming soon are at the end of the row. See [Getting started](getting-started).

### Project Management (0.13)
- A new module, **Project Management**: projects with milestones and contract deliverables, a task board, a list, a timeline, time logs, and health worked out from the tasks. See [the projects guide](projects).
- **My work** lists the tasks assigned to you in every project you are on, and **My Home** shows them too. Anyone a project manager adds to a project can open it. See [Getting started](getting-started#see-your-project-tasks-my-work).
- A new account type, **Project Manager**, and **Projects access** per account. See [the administrator's guide](admin#give-someone-the-service-desk-sales-crm-or-projects).
- In Sales & CRM, **Start project** on a won deal or a contract, and its projects on the deal and contract pages. See [the sales guide](sales#start-a-project-from-a-won-deal).
- On a service desk ticket, **Add to a project** turns it into a task; both link to each other. See [the service desk guide](service-desk#add-a-ticket-to-a-project).

### Security fixes (0.12.1)
- **Restore backup** now asks for your password, and refuses a backup whose user accounts are not valid. See [the administrator's guide](admin#back-up-and-restore).
- The **Audit log** notice says *Keyed from entry N*: entries from there on are sealed with the server's key. See [the administrator's guide](admin#check-the-audit-log).

### Sign-in security (0.12)
- **2-step verification**: sign in with your password and a code from an authenticator app on your phone. Set it up under your name → **My security**, and keep the ten recovery codes it gives you. See [Getting started](getting-started#turn-on-2-step-verification).
- **My security** also lists where you are signed in, with **Sign out** for each device and **Sign out everywhere else**. See [Getting started](getting-started#see-where-you-are-signed-in).
- New passwords cannot be common ones or contain your username or name. Repeated wrong passwords lock a username for longer each time, and too many requests or failed sign-ins from one place are refused for a while.
- Administrators set who must use 2-step verification, how long sessions last and the limits in **Settings → Sign-in & security**, and can sign someone out everywhere or reset their 2-step verification in **Users & Access**. See [the administrator's guide](admin#set-the-sign-in-and-security-rules).

### Medical certificate rules (0.11.6)
- HR sets when a leave type needs a medical certificate: from a number of work days in one request (1 = every request), after a number of requests in a year or a month, or both. A sick leave filed without a required certificate is refused, with the reason. See [the HR guide](hr#set-when-a-medical-certificate-is-needed).
- The old setting carries over unchanged: Sick Leave *longer than 3 days* is now *from 4 days*. See [the employee guide](employee#attach-a-medical-certificate).

### New sign-in page (0.11.5)
- The sign-in page has a new look: CORE's maroon and gold beside the form, the same for first-run setup and for choosing a new password. Signing in works as before. See [Getting started](getting-started#sign-in).

### Sales & CRM checks (0.11.2 and 0.11.3)
- Two people editing the same record no longer overwrite each other: the second save is refused with a message to reload. See [the sales guide](sales).
- **Renew** on a contract links the renewal deal to the contract, and does not start a second one. Bids above the ABC are refused in every government procurement mode. Deals are closed as won or lost from the stage bar or the board, which always ask for the lost reason. See [the sales guide](sales).
- A contract with a renewal in progress shows *Renewal DL-… open*. Removing the demo data keeps your own sales records, and a demo organization they use stays as a real account.
- Errors on ticks, checklists and deletes are now shown; dialogs keep keyboard focus inside and close with Escape; CSV exports open correctly in Excel and cannot run formulas.

### Help & guides
- The **?** button in the top bar opens **Help & guides**: a guide for each job in CORE, with a walkthrough using the demo data, step-by-step tasks, every screen and common questions, and search across all of them. It opens on the guide for your job in the module you were in. See [Getting started](getting-started#get-help).
- Administrators can edit any guide for the company, add the company's own guides, and see when an update of CORE changes a guide they edited. See [the administrator's guide](admin#edit-a-help-guide).

### Year to date, locked payroll and personal data (0.11)
- **Payroll → Year to date**: each employee's totals for the year from finalized payslips, and the 13th month so far. Opening balances for pay before CORE or from a previous employer's BIR 2316. Employees see their own totals in **My Payslips**. See [the payroll guide](payroll) and [the employee guide](employee).
- A finalized payroll run is locked: it cannot be changed or deleted, only voided with a reason. See [the payroll guide](payroll).
- **Audit log** for administrators: sign-ins, changes to employees, pay, attendance, leave, payroll and settings, views of pay and full ID numbers, certificate openings, backups. See [the administrator's guide](admin).
- Government ID numbers and bank accounts are masked; **Show numbers** reveals them and is logged. A new **HR Staff** account type works without pay data. Medical certificates open for HR only, unless the approval flow lets approvers open them. See [the HR guide](hr) and [approving requests](approver).

### Holidays, holiday pay and night shift (0.10)
- **Human Resource Management → Holidays**: the 2026 and 2027 national holidays as proclaimed, plus Eid and local holidays added by HR. See [the HR guide](hr).
- Payroll pays regular holidays, special days, rest days and double holidays at the DOLE rates, with overtime on each, and a night shift differential from 10 PM to 6 AM. The rates are in **Payroll Setup**. See [the payroll guide](payroll).
- Leave and work-from-home requests skip holidays, so they use no leave credits on them. See [the employee guide](employee).

### Leave, work from home and official business (0.9)
- Requests go to your immediate supervisor first, then through the approval flow; supervisors decide in **Approvals**. Half days, official business, return for revision, and Leave Without Pay for days beyond your credits. See [the employee guide](employee) and [approving requests](approver).

### Sales & CRM (0.8)
- The **Sales & CRM** module: leads, accounts, contacts, the deal pipeline, public bids and contracts. See [the sales guide](sales).

### CORE (0.7)
- The ERP became **CORE**, with a home page of modules, a module switcher, dark mode and a design shared with the company's other systems. A Windows program, **CORE-ERP.exe**, runs CORE on one computer with its own data. See [Getting started](getting-started).
