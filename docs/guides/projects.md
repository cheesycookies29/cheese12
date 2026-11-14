---
id: projects
title: Running projects
summary: For Project Managers and everyone on a project: the portfolio, templates and milestones with the billing forecast, a project's milestones, deliverables and burn-up, the board and list with quick filters, saved views, bulk edit and CSV import, tasks with sizes, watchers and files, time tracking and the weekly Timesheet, My work with For you and the daily digest, and the Projects setup.
roles: pm, employee, it, salesmgr
apps: projects
order: 55
---

## Before you start

**Project Management** keeps the company's dated, contract-bound work in one place: client implementations, government contracts with deliverables, and internal IT projects. A project has **milestones** (some are contract **deliverables** the client accepts, with a share of the contract price) and **tasks** on a board. Each task can have a **size**, from *XS* to *XL*: a rough idea of the effort, not an hour estimate. CORE works out each project's progress and health from its tasks, so nobody has to type a percentage.

Hours come in only where they are needed: a project manager can turn on **time tracking** for a project billed by the hour or whose client asks for a timesheet. Its members then log hours on it, on its tasks or on their weekly **Timesheet**. The other projects have no hours at all.

Who sees what:

- **A project is for the people on its member list.** Each sees it with their role in it (below), whatever their account type. Nobody else sees it: not in the lists, not in Milestones, My work or the Timesheet, and its address says *not found*. Its tasks and comments are hidden too.
- **Administrators** see every project, so no project can be lost.
- **Project Manager** (account type): starts projects and manages the ones they are a manager of; deletes the projects they manage and changes the **Projects setup**. They see only the projects they are on.
- **Sales Managers** use Projects for the projects they are added to, to follow the delivery of what they sold. Administrators can give **Projects access** to anyone else so they can start projects (see [the administrator's guide](admin)).

| Role in a project | Can |
|---|---|
| Manager | Edit the project, its members, columns, milestones and every task |
| Member | Add and edit tasks, move cards, comment; log time on a project that tracks time |
| Viewer | Read and comment |

Open it from the CORE home with **Open Project Management**, or from the modules button. It opens on **Overview**, the list of projects. Codes are given automatically: `PRJ-0001` for a project, `PRJ-0001-12` for its 12th task (demo records start with `DEMO-`).

To try things out, use the demo data: sign in as `pm.demo` (password `demo1234`), Andrea Villanueva, a Project Manager. `employee.demo` (Juan Dela Cruz) is a member of several of them; `hr.demo`, `payroll.demo` and `it.demo` run or work on the internal ones.

## Walkthrough

A first tour with the demo data. It takes about fifteen minutes.

### The portfolio

1. Sign in as `pm.demo` and choose **Open Project Management**. **Overview** lists the open projects with their client, manager, dates, a **progress** bar, the **health** and the **next milestone**. Health has a word and a shape as well as a colour: a green circle *On track*, an amber triangle *At risk*, a red square *Off track*.
2. The figures at the top count open projects, those at risk and off track, overdue tasks, and your own open tasks.
3. Change the filter from **Open projects** to **All**, or pick a type or a manager, or tick **Mine**. The filters stay in the address, so a bookmark keeps them.
4. Pick **Templates** in the same filter. These are patterns for new projects, kept out of the other lists: CORE comes with three starter templates, *Client implementation*, *Government contract (with deliverables)* and *Internal IT project*.
5. Click the **Milestones** tab next to **Projects**: every milestone of the projects you can open, soonest first, with its client, due date, health, whether it is a deliverable, and when it was submitted and accepted. Sign in as `sales.demo` to see the **Amount** of each deliverable and the **Billing forecast** under the list.

![The project portfolio](projects-portfolio.jpg)

![Milestones across projects, with the billing forecast](projects-milestones.jpg)

![Templates in the portfolio](projects-templates.jpg)

The demo has ten projects, chosen so each part of the module has something to show:

| Project | What to look at |
|---|---|
| *Learning management system, phase 2* | A client delivery in full swing: deliverables with billing, overdue and blocked tasks, sized tasks, comments. The tour below uses it. |
| *Warehouse HR and payroll rollout* | The board's **WIP limit**: four tasks in *In progress*, whose limit is 3. The manager's own reading (*Off track*, with a note) next to the computed health. |
| *SIS support and maintenance, 2025–2026* | The one project that **tracks time**: the support hours count in the renewal talks, so it has a **Time** tab, a budget in hours, and time on Juan's **Timesheet**. It also has **its own statuses** (*Backlog*, *Client sign-off*, *Released*) and a release waiting for the client's sign-off. |
| *Year-end payroll and 2027 tax tables* | *Off track*: its first milestone has passed with work still open. Run by `payroll.demo`. |
| *Data privacy compliance review* | **On hold**, with the manager's note on why. |
| *Laptop refresh, engineering team* | A task linked to a **service desk ticket** (Juan's laptop battery); the ticket shows the task too. |
| *Provincial helpdesk and asset tracking* | **Planning**: a government bid not yet awarded, with deliverables from the terms of reference. |
| *University website redesign* | **Completed**, both deliverables accepted. Choose **All** in the filter to see it. |
| *Move the file server to the cloud* | **Cancelled**, with the reason in its description. |
| *Office network refresh* | A small internal IT project. |

The three starter templates are under **Templates** in the filter.

### A project's overview

1. Click *Learning management system, phase 2*. The project opens on its **Overview**. Its tabs are **Overview**, **Board**, **List** and **Timeline** (a project that tracks time also has **Time**).
2. The **Health** line says why the project is *At risk*: tasks in *Gradebook and parent portal build* are overdue.
3. Under **Milestones**, each card shows its due date, its progress and its health. *Design and requirements sign-off* is a deliverable (gold diamond) for 30% of the contract, and was accepted. *Go-live and acceptance* is the deliverable for the other 70%.
4. **Sized tasks** says how many tasks have a size. When 60% or more do, progress is weighed by size (a *Large* task done counts more than an *Extra small* one); otherwise every task counts the same. A project that tracks time also shows **Time**: the hours logged, against its budget.
5. **Milestone burn-up** draws the next open milestone: the grey line is its scope (the work it holds), the green line the work done, and the dashed gold line where the work should be by each day. *Gradebook and parent portal build* is well below the dashed line, and its scope grew when tasks were added after the start. Pick another milestone in the list to see its chart.
6. Each milestone card has **Files** (on a deliverable, **Acceptance document**): click it on *Design and requirements sign-off* to see where the client's signed certificate goes.
7. Further down: **Overdue** tasks, **Blocked** tasks, **Recent activity**, the **Members**, and **Links** to the client, the deal and the contract in Sales & CRM.

![A project's overview: health, figures and milestones](projects-overview.jpg)

![The milestone burn-up](projects-burnup.jpg)

### The board

1. Click **Board**. There is a column per status, from *To do* to *Done*, with the number of tasks in each.
2. Each card shows the task's key, title, **size** (*M*, *L*…), due date (red when overdue), checklist (*2/3*), subtasks, the assignee's initials and, when it waits for another task, *Blocked*.
3. Drag *Data privacy notice for parents* from **For review** to **Done**. CORE says *moved to Done*.
4. Every card has a **Move to** menu (the small arrow at its top right). It lists the statuses, and **Move up** and **Move down** in the column. It works with the keyboard and on a phone, where dragging does not.
5. To add a task, type its title in **+ Add a task** at the top of a column and press Enter.
6. Above the columns are the **quick filters**: **Mine**, **Unassigned**, **Overdue**, **Due this week**, **Blocked** and **High & urgent**. Click **Overdue**: only the overdue cards stay. Click it again to clear it. Type in **Search key or title…** to find a card.
7. Click **Views**. *Due this week* is a view Andrea saved for everyone on the project; choose it, and the board shows that filter. **Save this view…** keeps the filters you set under a name.

![The board, with the Overdue filter on](projects-board.jpg)

![The Views menu](projects-views.jpg)

![The Move to menu on a phone](projects-move-to.jpg)

### A task

1. Click *Gradebook: import class lists from the SIS*. The task page has its description (with headings, steps and a link: see [Write a task's description](projects#write-a-tasks-description)), **Checklist**, **Subtasks**, **Comments** and **History** on the left; **Details**, **Blocked by**, **Watchers** and the linked service desk ticket on the right.
2. Tick *Test with the College of Engineering lists* in the checklist.
3. Under **Details**, change **Status** to *For review*. Each change is saved at once and written in the history.
4. **Size** says how big the task is: *S · Small (about a day)*. Pick another to change it; the line under it says what the size means. On a project that tracks time, a **Time** box under it shows the hours logged on the task and lets you log more.
5. Under **Comments**, write a comment and mention someone with @ and their username, for example `@employee.demo`. The mention is highlighted, and Juan finds it under **For you** on his My work.
6. At the top, **Watch** (or **Watching**) shows how many people watch the task; the **Watchers** box lists them. **Files** holds documents and photos for the task.

![A task](projects-task.jpg)

![Picking a task's size](projects-sizes.jpg)

### List, timeline and time

1. Click the project's name at the top, then **List**: every task in a table, grouped by milestone (or by status), with the status, assignee, due date and **Size** editable in place. It has the same quick filters, search and **Views** as the board. Click a column title to sort; **Export CSV** saves what is shown.
2. Tick two tasks: a bar appears at the bottom with **Status**, **Assignee**, **Milestone**, **Priority**, **Size**, **Move dates**, **Watchers** and **Delete** for all the ticked tasks at once. **Clear selection** closes it. Project managers also have **Import tasks** at the top.
3. Click **Timeline**: weeks across the top, milestones as diamonds, tasks as bars from their start to their due date (a dot when there is only a due date), a red line for today, and weekends and holidays shaded. It scrolls sideways; on a phone it is a list by date.
4. Go back to **Overview** and open *SIS support and maintenance, 2025–2026*, the project that tracks time. Its **Time** tab has **Log time**, your entries this week, and the hours by person and by task, against the 300-hour budget.

![The list, grouped by milestone](projects-list.jpg)

![Changing several tasks at once on the list](projects-bulk.jpg)

![The timeline](projects-timeline.jpg)

![Logging time](projects-time.jpg)

### The timesheet

1. Sign in as `employee.demo` and open **Timesheet** in the side menu. It is there for everyone on a project that tracks time.
2. Each row is a project that tracks time (Juan has one, *SIS support…*), with a **task picker**; the columns are Monday to Sunday of this week. Juan's hours of the last few working days are there (early in the week, click **Previous** to see them).
3. Type hours in a day (quarter hours: *1.5*, *0.25*), or pick a task in the row's list. **Another task on …** adds a row for a second task of the same project. The **Total** row and column add up as you type.
4. The grey **Clocked in (DTR)** row is Juan's attendance, for comparison only: nothing is taken from it. A day with more project hours than clocked in gets a small warning sign; it is still saved.
5. Click **Save timesheet**. **Previous** and **Next** move a week; **This week** comes back.

![The weekly timesheet](projects-timesheet.jpg)

![The timesheet on a phone, one day at a time](projects-timesheet-phone.jpg)

### My work

1. Sign in as `employee.demo` and open **My work** in the side menu. **For you** at the top lists what others did that concerns Juan: Andrea mentioned him, there are *2 comments on* a task of his, a task was assigned to him. Unread ones are in bold; open one or click its tick to mark it read, or **Mark all read**.
2. Under it, **Daily digest** sums up Juan's day: overdue tasks, tasks due within 3 working days, and unread notifications. **Show today's digest** lists them; **Email me a daily digest** turns the email on or off for him.
3. Below, the tasks assigned to you in every project: **Overdue**, **Today**, **This week**, **Later** and **No date**. Change a task's status right there. Open a task with its title (on a phone or tablet, anywhere on its row); the project's name under it opens the project.

![My work](projects-my-work.jpg)

![The daily digest on My work](projects-digest.jpg)

## How to…

### Start a project

1. On **Overview**, click **+ New project**.
2. Enter the **Project name** and, if you like, pick its **Icon** (see [Give a project its icon](projects#give-a-project-its-icon)). Then the **Type** (*Client*, *Government* or *Internal*), the **Status**, the **Start** date (required) and the **End** date.
3. Pick the **Project manager**. Tick **Track time on this project** only for time-and-materials work or when the client asks for a timesheet (see [Turn time tracking on for a project](projects#turn-time-tracking-on-for-a-project)); then enter the **Budget (hours)** if there is one.
4. If you have Sales & CRM access, pick the **Client**, the **Deal** and the **Contract**. A deliverable due after the contract's end date is flagged.
5. Click **Save**.

The project opens. Its board starts with the statuses from the Projects setup. From a won deal or a contract, **Start project** in Sales & CRM fills all of this in (see [the sales guide](sales#start-a-project-from-a-won-deal)).

### Give a project its icon

1. Open the project and click **Edit** (or start a new one with **+ New project**).
2. Under **Icon**, click a picture, then a colour. The tile above them shows how it will look.
3. Click **Save**.

![Picking a project's icon](projects-icon.jpg)

The icon is shown beside the project's name on Projects, Milestones, My work, the Timesheet, the project's own pages and its tasks. **Letter** (the first box) goes back to the first letter of the name on a colour CORE picks; that is how a project starts. A project copied or started from a template takes the template's icon unless you pick another. Only those who manage the project can change it.

### Start a project from a template

1. On **Overview**, click **+ New project**, and under **Start from** pick a template (or pick **Templates** in the filter and click **Use template** on one).
2. Enter the **Project name** and the **Start** date, pick the **Project manager**, and if you have Sales & CRM access the **Client**, **Deal** and **Contract**.
3. Click **Save**.

The new project gets the template's board statuses, milestones (deliverables keep their billing %), tasks, subtasks, checklists (unticked), blocked-by links and sizes, and tracks time if the template does. Every date keeps its place in **working days** from the start: a task due on the template's 10th working day is due on the project's 10th working day, skipping weekends and the holidays in CORE's calendar. Nobody is assigned, and no time or comments are copied. The type and description come from the template; change them under **Edit**.

![Starting a project from a template](projects-from-template.jpg)

### Make a project a template

1. Open the project (a finished one that went well, or a new one you set up for the purpose) and click **Edit** (project managers).
2. Tick **Use as a template** and click **Save**.

It leaves the portfolio, My work and the health counts, and appears under **Templates**. Change its milestones and tasks as in any project. To make it a project again, untick the box. A Project Manager can delete a template, including the starter ones; a deleted starter template does not come back.

### Add the milestones and deliverables

1. On the project's **Overview**, click **+ Milestone**.
2. Enter the **Name** and the **Due** date.
3. For a contract deliverable, tick **Contract deliverable** and enter the **Billing % of the contract**. The deliverables of a project bill at most 100%.
4. Click **Save**.
5. When the deliverable goes to the client, click its pencil and enter **Submitted to the client on**; when they accept it, **Accepted on** and the **Acceptance note** (for example the certificate of acceptance). Then attach the signed document with **Acceptance document** on the card (see [Attach files to a task or a deliverable](projects#attach-files-to-a-task-or-a-deliverable)).

A milestone is *Off track* once its date has passed with work still open; *At risk* when one of its tasks is overdue, a task is due after the milestone, or its progress is more than 15 points behind where it should be by now (counted in working days, without weekends and holidays).

### Choose who sees a project

1. Open the project and click **Edit** (or start one with **+ New project**).
2. In **Members**, pick each person who should see it, choose their role (**Member**, **Viewer** or **Manager**) and click **Add**. The project manager is always on it. Take someone off with the bin.
3. Click **Save**.

![The project's members in the project form](projects-private.jpg)

Only the people on the list (and administrators) see the project. If you start a project for someone else (another project manager), you stay on it as a manager. You cannot take yourself off a project, so you never lock yourself out by mistake; another manager or an administrator can. Someone taken off loses access at once. On a Sales & CRM deal or contract, its projects are listed only to the people on them, and a service desk ticket made into a task shows only *A task in a project you are not on* to agents who are not on it.

### Add the people

1. On the project's page, click **Members** at the top (or **Manage** under **Members** on the **Overview**, or use **Members** in **Edit**).
2. Pick a person and their role (**Manager**, **Member** or **Viewer**) and click **Add**.
3. Change a role in the list, or remove someone with the bin.
4. Click **Save**.

The project manager is always a manager. Open tasks of someone taken off the project are unassigned. A project manager can also assign a task to someone who is not on the project yet: they are added as a member.

### Add and plan tasks

1. On the **List**, click **+ Task** (or type in **+ Add a task** on the board).
2. Enter the **Title**, and if you know them the **Assignee**, **Start**, **Due**, **Size**, **Milestone** and **Priority**.
3. To break a task down, pick it under **Subtask of**, or add subtasks on the task's page. Subtasks are one level deep: a subtask cannot have subtasks.
4. When a task cannot start before another is done, open it and pick that task under **Blocked by**. The card shows *Blocked* until the other task is done; nothing is rescheduled.

Progress counts the subtasks, not their parent. When most tasks (60% or more) have a size, progress is weighed by size (a task without one counts at the average); otherwise every task counts the same. Cancelled tasks do not count.

### Write a task's description

1. Open the task and click **Edit** next to **Description** (or **Edit title and description**).
2. Type the description. To format it, select words and use the toolbar: **Heading** (click again for a smaller one), **Bold**, *Italic*, ~~Strikethrough~~, `Code`, **Link**, a bulleted or numbered list, a **Checklist**, a quote and a line. Over several lines, bold and italic apply to each line. **Ctrl+B**, **Ctrl+I** and **Ctrl+K** (on a Mac ⌘) do bold, italic and a link; in a list, Enter starts the next item, and Enter on an empty item ends the list. For a list inside a list, type two or three spaces before the `-`; Enter on an empty inner item goes back to the outer list's next item.
3. To add a picture, click the picture button and choose one, or paste a screenshot (Ctrl+V) or drag a picture into the text. It is added where the cursor is.
4. Click **Preview** to see how it will look, then **Save**.

![Editing a task's description](projects-description.jpg)

The toolbar writes simple marks into the text (`**bold**`, `- item`, `- [ ] to do`, `![caption](img:…)` for a picture), so you can also type them. A table is a line of `| Column | Column |`, then `|---|---|`, then a line per row. The checklist in a description is for reading; tick tasks off in the task's own **Checklist**. Pictures can be JPEG, PNG or WebP, up to 5 MB (a large photo is made smaller before it is sent), as many as you need; the words in brackets are the caption. Everyone who can open the project sees them; click one to open it full size. A picture you take out of the description is deleted when the description is saved. Pictures are added once the task exists: in **New task** the description can be formatted, and pictures come after **Add task**. Links open web pages (`https://…`) or an email (`mailto:…`) in a new tab.

### Size a task

1. Open the task and pick its **Size** under **Details** (or in the **Size** column of the **List**, or when you add it).
2. Pick by how much work it is, roughly:

| Size | Means (as set up) | Weight in progress |
|---|---|---|
| XS · Extra small | under half a day | 1 |
| S · Small | about a day | 2 |
| M · Medium | a few days | 3 |
| L · Large | about a week | 5 |
| XL · Extra large | two weeks or more | 8 |

A size is a rough idea, not a promise: pick the nearest and move on. An *XL* task is usually worth splitting into subtasks. To size many tasks at once, tick them on the **List** and use **Size** in the bar. Changes are in the task's history. A Project Manager can reword what each size means under **Projects setup → Effort sizes**; the weights stay the same everywhere.

### Change many tasks at once

1. On the **List**, tick the tasks to change, or tick **Select all … tasks shown** (it takes the tasks the filters show). With the keyboard, Tab to a box and press Space.
2. In the bar at the bottom, click what to change: **Status**, **Assignee** (members of the project only), **Milestone**, **Priority**, **Size** (or no size), **Move dates** (a number of working days, negative for earlier; weekends and holidays are skipped, and tasks without dates keep none) or **Watchers**. On a phone the bar shows the count, **Actions** (the same list, and **Delete**) and **×** to clear the selection.
3. Pick the new value and click **Apply**.

CORE checks every selected task first. If one cannot take the change (for example a due date that would fall before its start), nothing is changed and CORE says which task and why. Each task changed gets the change in its history. People are told once, not once per task: *assigned you 5 tasks…*. At most 200 tasks at a time.

**Delete** removes the selected tasks, with their subtasks, comments and files. A project manager can delete any task; a member only tasks they added. If one of the selected tasks is not theirs, nothing is deleted. **Watchers**: you can add or remove yourself; a project manager can add or remove anyone who can open the project.

![Changing several tasks at once on the list](projects-bulk.jpg)

### Import tasks from a CSV file (project managers)

Most plans start in Excel or a work plan from the terms of reference. Save it as CSV (in Excel: **File → Save As → CSV UTF-8**) and bring it in.

1. On the project's **List**, click **Import tasks**. **Download the template** gives a file with the columns CORE reads and two example rows.
2. Choose your CSV file (up to 2,000 tasks and 2 MB; commas or semicolons both work).
3. **Match the columns**: CORE matches them by their header; change any that are wrong. Only **Title** is required. Tick **Create the milestones that are missing** if the file names milestones the project does not have yet.
4. Click **Check the file**. Each row with a problem is listed with what to fix; nothing is saved yet.
5. When every row is fine, click **Import … tasks**.

The columns:

| Column | What to put in it |
|---|---|
| Title | The task (required) |
| Description | Plain text |
| Status | The name of a status on this project's board; empty: the first *To do* status |
| Assignee | The username or full name of a member of the project (not a viewer) |
| Start, Due | `2026-12-01` or `01/12/2026` (day first) |
| Size | `XS`, `S`, `M`, `L` or `XL`, or the names (*Extra small* … *Extra large*) |
| Estimate (h) | Instead of a size (a file from before sizes, or another tool): hours such as `8` or `1,5`, turned into a size: up to 2 h *XS*, up to 8 h *S*, up to 24 h *M*, up to 48 h *L*, more *XL*. **Check the file** lists each row converted |
| Priority | Low, Normal, High or Urgent |
| Milestone | The name of a milestone of the project |
| Parent | Another row's number (the header is row 1) or its title; that row becomes the parent. One level only |
| Checklist | Items separated by `;` |

It is all or nothing: one row with a problem and nothing is imported. Tasks get the next keys in order, *imported from a CSV file* in their history, and assignees are told once. A new milestone is due on the latest due date of its tasks (or the project's end date). Text such as `=SUM(A1)` is kept as text.

![Importing tasks: the first step](projects-import.jpg)

### Filter the board or list quickly

1. On the **Board** or the **List**, click a quick filter: **Mine**, **Unassigned**, **Overdue**, **Due this week** (open tasks due Monday to Sunday of this week), **Blocked** or **High & urgent**.
2. Click more than one to narrow down: *Overdue* and *High & urgent* shows the overdue tasks of high or urgent priority. **Mine** and **Unassigned** together show both.
3. Type in the search box to find tasks by key or title (on the list also by assignee).
4. Click a filter again to clear it.

The filters are in the page's address, so a bookmark or a link you send keeps them.

### Make the lists compact or comfortable

1. Open **Projects**, **Milestones**, a project's **List** or **My work**.
2. Next to the filters (on My work, under the title), click **Compact** for tighter rows, smaller type and slimmer controls, so more of a long list fits on the screen. Click **Comfortable** to go back to the roomier rows; that is how CORE starts.

![A project's List in compact rows](projects-list-compact.jpg)

The choice applies to all four lists and is kept in this browser, like the dark or light theme: another computer or browser starts comfortable. On a phone the switch is under **Filters**, and buttons and boxes stay large enough to tap.

### Save a view

1. Set the filters, search, grouping or sort you want on the **Board** or the **List**.
2. Click **Views**, then **Save this view…**.
3. Name it. Project managers choose **Just me** or **Everyone on the project**; everyone else saves for themselves.
4. Click **Save view**.

Pick it again from **Views**; the button shows its name while it is on. **Delete a view…** in the same menu removes your own views; a project manager can delete any shared one. A view that names someone who left the project, or a deleted milestone, shows all tasks for that filter.

### Watch a task

1. Open the task and click **Watch** at the top. It turns to **Watching**; the number is how many people watch it.
2. Click **Watching** to stop.

Watchers hear, under **For you**, of every comment on the task and of it being moved to done or cancelled. You watch a task automatically when you add it, when you are assigned it and when you comment on it; after **Stop watching**, a comment of yours does not bring you back (being assigned does). Anyone who can open the project can watch; someone taken off the project stops watching. The **Watchers** box on the task lists them.

### Attach files to a task or a deliverable

1. On a task, under **Files**, click **Add files** and pick PDFs or photos (JPEG, PNG or WebP; up to 5 MB each, as many as you need). Large photos are made smaller first.
2. For a milestone, click **Files** on its card on the project's **Overview** (on a deliverable, **Acceptance document**) and add files the same way.
3. Click a file's name to download it. The bin removes it.

Members and managers add files; everyone who can open the project downloads them; the person who added a file or a project manager removes it. Adding and removing are in the task's (or the project's) history. When you set **Accepted on** for a deliverable that has no document yet, CORE reminds you to attach the signed certificate, and the card says so until you do. Deleting a task, a milestone or the project deletes its files.

> **Note:** Files are kept in CORE's `data` folder, not in the backup file from **Admin panel → Backup & restore → Download backup**. Your administrator copies the `data` folder to keep them (see [the administrator's guide](admin)).

![A deliverable's acceptance document](projects-files.jpg)

### Move tasks on the board

1. Drag a card to another column, or to another place in its column.
2. Or click the card's **Move to** arrow and pick a status, **Move up** or **Move down**.

A task moved to *Done* gets its completion date. When a column has a **WIP limit** and holds more tasks, its count turns red and CORE warns; the move is still made.

### Change the board's columns

1. On the **Board**, click **Edit columns** (project managers).
2. Rename a status, pick its **Category** and **Colour**, set a **WIP limit**, move it left or right, add one with **+ Status**, or remove one with the bin.
3. If a removed status still has tasks, pick where they move under **… move to**.
4. Click **Save**.

The category is what counts: *To do* and *In progress* are open work, *Done* is finished, *Cancelled* is left out of progress. Keep at least one *To do* and one *Done* status.

### Turn time tracking on for a project

Most projects need no hours: sizes are enough to plan, and the client pays by milestone. Turn time tracking on for work billed by the hour, or when the client asks for a timesheet.

1. On the project's **Overview**, click **Edit** (project managers).
2. Tick **Track time on this project**, and enter the **Budget (hours)** if there is one.
3. Click **Save**.

The project gets a **Time** tab and a **Time** figure on its overview, its tasks a **Time** box, and its members find it on their **Timesheet**. Untick it to turn it off: the hours logged are hidden, not deleted, and come back if you turn it on again. The change is in the project's history.

### Log your time

On a project that tracks time:

1. Open the project's **Time** tab (or the **Time** box on a task).
2. Pick the **Date**, enter the **Hours** (quarter hours: 0.25, 0.5, 1.75…), pick the **Task** or *No task* for meetings and project work, and add a **Note**.
3. Click **Log time**.

Or fill in a whole week at once on your **Timesheet** (below). If the hours you logged on a day are more than your attendance in the DTR shows, CORE saves them and only flags them (*More than attended*). Only you, the project's managers and people who see attendance see that check. You can delete your own entries; a project manager can delete any.

### Fill in your timesheet

1. Open **Timesheet** in the side menu (it is there when you are on a project that tracks time).
2. Each project that tracks time has a row. Pick a **task** in the row if the hours were for one, or leave *No task (project work)*. **Another task on …** adds a row.
3. Type the hours for each day, in quarter hours. Days after today are closed. On a phone the week shows one day at a time: tap a day at the top (each shows its hours) and type the hours for each row.
4. Click **Save timesheet**.

Each cell is one entry: changing it changes that entry, and emptying it removes it. A day can have at most 24 hours across your projects; a day in the future cannot have any. **Clocked in (DTR)** shows your attendance next to it, for comparison only: nothing is filled in from it, and a day with more project hours than clocked in is flagged, never refused. Move between weeks with **Previous**, **Next** and **This week**; CORE asks before leaving hours not saved.

![The weekly timesheet](projects-timesheet.jpg)

### See a member's timesheet (project managers)

1. Open **Timesheet**, and pick the person under **Timesheet of**. Or click their name under **By person** on the project's **Time** tab.
2. Move between weeks as on your own.

You see the projects you manage that track time, read only: only the person changes their hours (a manager can still delete a wrong entry on the **Time** tab). You also see their **Clocked in (DTR)** row.


### Read the milestone burn-up

1. On the project's **Overview**, find **Milestone burn-up** and pick a milestone (it opens on the next one not yet finished).
2. Read the three lines: **Scope** (what the milestone holds), **Done** (up to today) and **Expected** (a straight line from the milestone's start to its due date, in working days). The red line is today.
3. The text under the chart says the same in words: the scope, how much was added after the start, what is done and what was expected by now.

The chart counts **effort points** (each task's size weight: *XS* 1, *S* 2, *M* 3, *L* 5, *XL* 8) when 60% or more of the milestone's tasks have a size, and **tasks** otherwise, as its progress does. It never counts hours. A task cancelled leaves the scope from the day it was cancelled; a task reopened leaves *Done* until it is done again.

### See milestones and the billing forecast across projects

1. On **Overview**, click the **Milestones** tab.
2. Filter by **month**, **client**, **health**, or tick **Deliverables only**. **Upcoming and overdue** hides milestones already accepted or done; pick **All** to see them too.
3. Click a row to open its project.

With Sales & CRM access, each deliverable shows its **Amount**: its billing % of the value of the contract linked to the project (or of the deal's value when there is no contract). The **Billing forecast** under the list adds them up by month: **Expected** (not accepted yet, in the month it is due, with what is overdue), and **Earned** (accepted, in the month of acceptance). **Export CSV** saves the forecast. Without Sales & CRM access, the amounts and the forecast are not shown, and CORE does not send them to your browser at all.

You see the projects you are on here; administrators see every project.

![Milestones across projects, with the billing forecast](projects-milestones.jpg)

### Catch up on what concerns you (For you)

1. Open **My work**. **For you** lists, newest first, what others did that concerns you: a task assigned to you, an @mention, a comment on a task assigned to you, that you added or that you watch, a task of yours or one you watch moved to done or cancelled, being added to a project.
2. Several of the same kind on one task are one line, such as *3 comments on PRJ-0001-7*.
3. Click a line to open the task; it is marked read. Click the tick to mark it read without opening it, or **Mark all read**.

Your own actions never notify you. The number next to **My work** includes the unread ones. The same notifications are in the **bell** in the top bar, with those of the other modules: reading one in either place marks it read in both. See [See your notifications](getting-started#see-your-notifications). CORE keeps your newest 200 for 60 days, and shows only those of projects you can still open. They are in CORE; the **daily digest** email counts the unread ones.

### Get the daily digest

1. Open **My work**. **Daily digest** shows today's: your overdue tasks, tasks due within 3 working days, milestones *At risk* or *Off track* in projects you manage, and how many **For you** you have not read. **Show today's digest** lists them.
2. Tick **Email me a daily digest** to get it by email (it is on unless you turn it off); untick it to stop.

The line under the box says when and where it is emailed, or why it is not: digest emails off for the company, no outgoing email set up in CORE, or no email address on your employee record. The email goes once a working day, only when there is something in it, and lists only projects you can open.

![The daily digest on My work](projects-digest.jpg)

### Set up the daily digest (Project Managers)

1. Open **Projects setup → Daily digest**.
2. Tick **Email the daily digest**, set **Send at** (07:30 by default, the server's local time) and keep **Working days only** ticked to skip weekends and the holidays on CORE's calendar.
3. Click **Save**, from the address people open CORE at: links in the email open CORE there (none when it is `localhost`).

The digest goes out through the Service Desk's outgoing email, from the helpdesk address; an administrator sets that up under **Service desk settings → Sending email** (see [the service desk guide](service-desk)). Without it, nobody is emailed and everyone sees the digest on My work. Each person gets at most one a day: if CORE was off at the time, it goes when CORE starts again that day. Accounts that are disabled or have no email address get none. A failed send is shown on this page and in the audit log, and is not retried until the next day.

![Projects setup: Daily digest](projects-setup-digest.jpg)

### Set the project's health yourself

1. On the project's **Overview**, click **Set health**.
2. Pick *On track*, *At risk* or *Off track* and write why, in one line.
3. Click **Save**.

Your reading is shown with your name next to the one CORE works out, which stays visible. Pick *As worked out* to remove it.

### Print a status report

1. On the project's **Overview**, click **Print status report**.
2. Print it, or choose **Save as PDF** in the print window.

The report fits one page: the health, progress, dates, the open tasks (or, on a project that tracks time, the hours logged against the budget), every milestone, the overdue tasks and the tasks due in the next two weeks.

### Copy a project

1. On the project's **Overview**, click **Copy**.
2. Enter the **New project name** and the **New start date**, and click **Copy**.

The copy has the same statuses, milestones and tasks, with every date moved by the same number of calendar days. It has no assignees, time, comments or client links, and starts in *Planning*. For a pattern you use again and again, make a template instead (see [Make a project a template](projects#make-a-project-a-template)).

### Change the Projects setup (Project Managers)

1. Open **Projects setup**.
2. **Default statuses**: click **Edit statuses** to change the columns new projects start with.
3. **Project types**: one per line. Click **Save types**.
4. **Effort sizes**: reword what each size means for your teams (for example *XS: an hour or two*). The sizes, their weights and their days stay fixed. Click **Save sizes**; **Use the built-in wording** puts the original back.

Statuses and types apply to new projects; the wording of the sizes applies at once, everywhere. **Daily digest** is described above. Administrators also see **Team access** (see [the administrator's guide](admin)).

![Projects setup](projects-setup.jpg)

![Projects setup: Effort sizes](projects-setup-sizes.jpg)

## Screens at a glance

| Screen | What it is for |
|---|---|
| Overview | The portfolio: every project you may see with its progress, health and next milestone; filters; **Templates**; **+ New project** (blank or from a template). Its **Milestones** tab: milestones and deliverables across projects, with amounts and the **Billing forecast** for Sales & CRM users |
| A project: Overview | Health and why, progress, overdue and blocked tasks, how many tasks are sized, the hours logged (on a project that tracks time), the milestones and deliverables (with their files and acceptance document), the **Milestone burn-up**, members, links to Sales & CRM, open service desk tickets of the client, recent activity, **Print status report** |
| A template | Like a project's overview, with **New project from this template** instead of health |
| A project: Board | A column per status; drag cards or use **Move to**; quick add; quick filters, search and **Views**; filters by assignee and milestone; **Edit columns** |
| A project: List | Every task in a table grouped by milestone or status, edited in place, with its size; quick filters, search and **Views**; ticked tasks changed together (bulk edit); **Export CSV**; **Import tasks** (managers) |
| A project: Timeline | Weeks across, milestones and tasks along a line, today, weekends and holidays; a dated list on a phone |
| A project: Time | Only on a project that tracks time: log hours; your entries this week; the hours by person (open a member's timesheet) and by task, against the budget |
| A task | Details (with the size), checklist, subtasks, files, blocked by, comments with @mentions, **Watch** and watchers, the hours logged (on a project that tracks time), the linked ticket, history |
| My work | **For you** (what others did that concerns you), the **Daily digest** and its email setting, then your open tasks in every project: overdue, today, this week, later, no date; **Comfortable** or **Compact** rows |
| Timesheet | Your hours on the projects that track time, Monday to Sunday, with your DTR next to it for comparison; your members' timesheets, read only (project managers) |
| Projects setup | The statuses new projects start with, the project types, what the effort sizes mean, and the daily digest (Project Managers); team access (administrators) |

## Questions

**Why can't I see a project?**
You are not on its member list: only the people on it (and administrators) see a project. Ask its project manager to add you.

**How is health worked out?**
From the tasks, every time you open the project. A milestone is *Off track* when its date has passed with work still open, and *At risk* with an overdue task, a task due after it, or progress more than 15 points behind the straight line from its start to its due date (counted in working days, so weekends and the holidays in CORE's calendar do not count). The project takes its worst milestone, and is *At risk* while any task is overdue and *Off track* when its end date has passed with work open.

**Why sizes, not hours?**
An hour estimate looks precise and rarely is: a task "of 16 hours" is really "a couple of days, give or take". Sizes say that honestly, take seconds to set, and are all progress and the burn-up need. Hours worked are already in the DTR for pay, and clients are billed by milestone, not by the hour, so CORE does not ask everyone to log hours twice. Where hours do matter (time-and-materials work, a client who wants a timesheet), turn on time tracking for that project.

**What happened to my hour estimates?**
When CORE was updated to 0.17, each task's estimate became a size (up to 2 h *XS*, up to 8 h *S*, up to 24 h *M*, up to 48 h *L*, more *XL*), with a line in its history: *size from the hour estimate*. Tasks without an estimate have no size. "Hours left" is gone. Projects that had time logged on them track time, so their hours stay visible; the others do not.

**I logged time; why did progress not move?**
Progress goes by the tasks that are done, weighed by their sizes. Logging time never moves it.

**Why did I not get a notification?**
CORE tells you only about what others did: your own changes never notify you. It does not notify about edits of dates or descriptions, and nothing comes from templates. If you were taken off a project, its notifications are no longer shown. To hear about a task that is not yours, **Watch** it.

**Why did I not get the digest email?**
The line under **Daily digest** on My work says why: you turned it off, digest emails are off for the company, CORE has no outgoing email, or your employee record has no email address. It is also not sent on a day with nothing in it, nor on weekends and holidays when the company chose working days only.

**Why can I not see the amounts on Milestones?**
Amounts come from contract and deal values in Sales & CRM, so only people with Sales & CRM access see them. Ask an administrator if you need them.

**Are task files in the backup?**
No. Like medical certificates and ticket files, they are kept in the `data` folder next to the database, not in the backup file. An administrator copies that folder to keep them.

**Which files can I attach?**
PDFs and photos (JPEG, PNG, WebP), up to 5 MB each, with no limit on how many a task or milestone has. CORE checks what the file really is, not just its name. Files are always downloaded, never opened inside CORE.

**How exact is the burn-up?**
It is worked out from what each task remembers: when it was added, its status changes and when it was done. A deleted task is not remembered, so it is not in the chart at all; and a task moved from another milestone counts in its current one from the day it was added.

**Do templates count in the figures?**
No. Templates are not in the portfolio counts, health or My work, and their tasks are never in anyone's My work.

**Can a task have several assignees?**
No. Give it one assignee, and use subtasks or the checklist to share the work.

**Does closing the service desk ticket close the task?**
No. The task shows the ticket's status and the ticket shows the task; each is closed on its own.

**CORE says the task was changed since I opened it. What do I do?**
Someone else saved it while you had it open. The page loads their change; make yours again. Moving cards on the board does not ask: the last move wins.

**Is the timesheet the same as attendance?**
No. The DTR is attendance for pay. The timesheet is what each project took, and only on projects that track time. CORE shows your DTR next to it for comparison and flags a day with more project hours than clocked in; it never fills one in from the other, and never refuses hours because of it.
