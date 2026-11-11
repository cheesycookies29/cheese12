---
id: projects
title: Running projects
summary: For Project Managers and everyone on a project: the portfolio, templates and milestones with the billing forecast, a project's milestones, deliverables and burn-up, the board and list with quick filters, saved views, bulk edit and CSV import, tasks with watchers, files and hours left, time, My work with For you and the daily digest, Workload and the Projects setup.
roles: pm, employee, it, salesmgr
apps: projects
order: 55
---

## Before you start

**Project Management** keeps the company's dated, contract-bound work in one place: client implementations, government contracts with deliverables, and internal IT projects. A project has **milestones** (some are contract **deliverables** the client accepts, with a share of the contract price), **tasks** on a board, and the **time** people spend on it. CORE works out each project's progress and health from its tasks, so nobody has to type a percentage.

Who sees what:

- **Project Manager** (account type): sees every project, starts and edits any project, deletes projects and changes the **Projects setup**.
- **Members of a project** open that project, whatever their account type, with a role in it (below).
- **Sales Managers** see every project, read only, to follow the delivery of what they sold. Administrators can give **Projects access** to anyone else (see [the administrator's guide](admin)).
- Everyone else does not see a project at all. Its tasks and comments are hidden too.

| Role in a project | Can |
|---|---|
| Manager | Edit the project, its members, columns, milestones and every task |
| Member | Add and edit tasks, move cards, comment, log time |
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
| *Learning management system, phase 2* | A client delivery in full swing: deliverables with billing, overdue and blocked tasks, comments, time. The tour below uses it. |
| *Warehouse HR and payroll rollout* | The board's **WIP limit**: four tasks in *In progress*, whose limit is 3. The manager's own reading (*Off track*, with a note) next to the computed health. |
| *SIS support and maintenance, 2025–2026* | A project with **its own statuses** (*Backlog*, *Client sign-off*, *Released*), a release submitted and waiting for the client's sign-off, and the contract renewal coming up. |
| *Year-end payroll and 2027 tax tables* | *Off track*: its first milestone has passed with work still open. Run by `payroll.demo`. |
| *Data privacy compliance review* | **On hold**, with the manager's note on why. |
| *Laptop refresh, engineering team* | A task linked to a **service desk ticket** (Juan's laptop battery); the ticket shows the task too. |
| *Provincial helpdesk and asset tracking* | **Planning**: a government bid not yet awarded, with deliverables from the terms of reference. |
| *University website redesign* | **Completed**, both deliverables accepted. Choose **All** in the filter to see it. |
| *Move the file server to the cloud* | **Cancelled**, with the reason in its description. |
| *Office network refresh* | A small internal IT project. |

The three starter templates are under **Templates** in the filter.

### A project's overview

1. Click *Learning management system, phase 2*. The project opens on its **Overview**. Its tabs are **Overview**, **Board**, **List**, **Timeline** and **Time**.
2. The **Health** line says why the project is *At risk*: tasks in *Gradebook and parent portal build* are overdue.
3. Under **Milestones**, each card shows its due date, its progress and its health. *Design and requirements sign-off* is a deliverable (gold diamond) for 30% of the contract, and was accepted. *Go-live and acceptance* is the deliverable for the other 70%.
4. The **Hours** figure shows the hours left on the open tasks, with the hours estimated and logged under it.
5. **Milestone burn-up** draws the next open milestone: the grey line is its scope (the work it holds), the green line the work done, and the dashed gold line where the work should be by each day. *Gradebook and parent portal build* is well below the dashed line, and its scope grew when tasks were added after the start. Pick another milestone in the list to see its chart.
6. Each milestone card has **Files** (on a deliverable, **Acceptance document**): click it on *Design and requirements sign-off* to see where the client's signed certificate goes.
7. Further down: **Overdue** tasks, **Blocked** tasks, **Recent activity**, the **Members**, and **Links** to the client, the deal and the contract in Sales & CRM.

![A project's overview: health, figures and milestones](projects-overview.jpg)

![The milestone burn-up](projects-burnup.jpg)

### The board

1. Click **Board**. There is a column per status, from *To do* to *Done*, with the number of tasks in each.
2. Each card shows the task's key, title, due date (red when overdue), checklist (*2/3*), subtasks, the assignee's initials and, when it waits for another task, *Blocked*.
3. Drag *Data privacy notice for parents* from **For review** to **Done**. CORE says *moved to Done*.
4. Every card has a **Move to** menu (the small arrow at its top right). It lists the statuses, and **Move up** and **Move down** in the column. It works with the keyboard and on a phone, where dragging does not.
5. To add a task, type its title in **+ Add a task** at the top of a column and press Enter.
6. Above the columns are the **quick filters**: **Mine**, **Unassigned**, **Overdue**, **Due this week**, **Blocked** and **High & urgent**. Click **Overdue**: only the overdue cards stay. Click it again to clear it. Type in **Search key or title…** to find a card.
7. Click **Views**. *Due this week* is a view Andrea saved for everyone on the project; choose it, and the board shows that filter. **Save this view…** keeps the filters you set under a name.

![The board, with the Overdue filter on](projects-board.jpg)

![The Views menu](projects-views.jpg)

![The Move to menu on a phone](projects-move-to.jpg)

### A task

1. Click *Gradebook: import class lists from the SIS*. The task page has its description, **Checklist**, **Subtasks**, **Comments** and **History** on the left; **Details**, **Blocked by**, the linked service desk ticket and **Time** on the right.
2. Tick *Test with the College of Engineering lists* in the checklist.
3. Under **Details**, change **Status** to *For review*. Each change is saved at once and written in the history.
4. The **Time** box shows the **Estimate**, the hours **Logged** and the hours **Left**. Juan logged more than the 24 hours estimated, but set **Hours left** to 6: the work is not done yet.
5. Under **Comments**, write a comment and mention someone with @ and their username, for example `@employee.demo`. The mention is highlighted, and Juan finds it under **For you** on his My work.
6. At the top, **Watch** (or **Watching**) shows how many people watch the task; the **Watchers** box lists them. **Files** holds documents and photos for the task.

![A task](projects-task.jpg)

### List, timeline and time

1. Click the project's name at the top, then **List**: every task in a table, grouped by milestone (or by status), with the status, assignee and due date editable in place, and the estimate, hours logged and hours **Left**. It has the same quick filters, search and **Views** as the board. Click a column title to sort; **Export CSV** saves what is shown.
2. Tick two tasks: a bar appears at the bottom with **Status**, **Assignee**, **Milestone**, **Priority**, **Move dates**, **Watchers** and **Delete** for all the ticked tasks at once. **Clear selection** closes it. Project managers also have **Import tasks** at the top.
3. Click **Timeline**: weeks across the top, milestones as diamonds, tasks as bars from their start to their due date (a dot when there is only a due date), a red line for today, and weekends and holidays shaded. It scrolls sideways; on a phone it is a list by date.
4. Click **Time**: log your hours, see your entries this week, and the totals by person and by task against the estimates.

![The list, grouped by milestone](projects-list.jpg)

![Changing several tasks at once on the list](projects-bulk.jpg)

![The timeline](projects-timeline.jpg)

![Logging time](projects-time.jpg)

### My work and Workload

1. Sign in as `employee.demo` and open **My work** in the side menu. **For you** at the top lists what others did that concerns Juan: Andrea mentioned him, there are *2 comments on* a task of his, a task was assigned to him. Unread ones are in bold; open one or click its tick to mark it read, or **Mark all read**.
2. Under it, **Daily digest** sums up Juan's day: overdue tasks, tasks due within 3 working days, and unread notifications. **Show today's digest** lists them; **Email me a daily digest** turns the email on or off for him.
3. Below, the tasks assigned to you in every project: **Overdue**, **Today**, **This week**, **Later** and **No date**. Change a task's status right there.
4. Sign in as `pm.demo` again and open **Workload**. Each row is a person; each column a week. A cell shows the hours planned for that person that week against their capacity: the hours **left** on their tasks, spread over the working days to each due date. A red cell has more work than time. Click a cell to see its tasks.

![My work](projects-my-work.jpg)

![The daily digest on My work](projects-digest.jpg)

![Workload: planned hours against capacity](projects-workload.jpg)

## How to…

### Start a project

1. On **Overview**, click **+ New project**.
2. Enter the **Project name**, the **Type** (*Client*, *Government* or *Internal*), the **Status**, the **Start** date (required) and the **End** date.
3. Pick the **Project manager**, and the **Budget (hours)** if there is one.
4. If you have Sales & CRM access, pick the **Client**, the **Deal** and the **Contract**. A deliverable due after the contract's end date is flagged.
5. Click **Save**.

The project opens. Its board starts with the statuses from the Projects setup. From a won deal or a contract, **Start project** in Sales & CRM fills all of this in (see [the sales guide](sales#start-a-project-from-a-won-deal)).

### Start a project from a template

1. On **Overview**, click **+ New project**, and under **Start from** pick a template (or pick **Templates** in the filter and click **Use template** on one).
2. Enter the **Project name** and the **Start** date, pick the **Project manager**, and if you have Sales & CRM access the **Client**, **Deal** and **Contract**.
3. Click **Save**.

The new project gets the template's board statuses, milestones (deliverables keep their billing %), tasks, subtasks, checklists (unticked), blocked-by links and estimates. Every date keeps its place in **working days** from the start: a task due on the template's 10th working day is due on the project's 10th working day, skipping weekends and the holidays in CORE's calendar. Nobody is assigned, and no time or comments are copied. The type and description come from the template; change them under **Edit**.

![Starting a project from a template](projects-from-template.jpg)

### Make a project a template

1. Open the project (a finished one that went well, or a new one you set up for the purpose) and click **Edit** (project managers).
2. Tick **Use as a template** and click **Save**.

It leaves the portfolio, My work, Workload and the health counts, and appears under **Templates**. Change its milestones and tasks as in any project. To make it a project again, untick the box. A Project Manager can delete a template, including the starter ones; a deleted starter template does not come back.

### Add the milestones and deliverables

1. On the project's **Overview**, click **+ Milestone**.
2. Enter the **Name** and the **Due** date.
3. For a contract deliverable, tick **Contract deliverable** and enter the **Billing % of the contract**. The deliverables of a project bill at most 100%.
4. Click **Save**.
5. When the deliverable goes to the client, click its pencil and enter **Submitted to the client on**; when they accept it, **Accepted on** and the **Acceptance note** (for example the certificate of acceptance). Then attach the signed document with **Acceptance document** on the card (see [Attach files to a task or a deliverable](projects#attach-files-to-a-task-or-a-deliverable)).

A milestone is *Off track* once its date has passed with work still open; *At risk* when one of its tasks is overdue, a task is due after the milestone, or its progress is more than 15 points behind where it should be by now (counted in working days, without weekends and holidays).

### Add the people

1. On the project's **Overview**, click **Manage** under **Members**.
2. Pick a person and their role (**Manager**, **Member** or **Viewer**) and click **Add**.
3. Change a role in the list, or remove someone with the bin.
4. Click **Save**.

The project manager is always a manager. Open tasks of someone taken off the project are unassigned. A project manager can also assign a task to someone who is not on the project yet: they are added as a member.

### Add and plan tasks

1. On the **List**, click **+ Task** (or type in **+ Add a task** on the board).
2. Enter the **Title**, and if you know them the **Assignee**, **Start**, **Due**, **Estimate (hours)**, **Milestone** and **Priority**.
3. To break a task down, pick it under **Subtask of**, or add subtasks on the task's page. Subtasks are one level deep: a subtask cannot have subtasks.
4. When a task cannot start before another is done, open it and pick that task under **Blocked by**. The card shows *Blocked* until the other task is done; nothing is rescheduled.

Progress counts the subtasks, not their parent. When most tasks (60% or more) have an estimate, progress is weighed by hours (a task without one counts at the average); otherwise every task counts the same. Cancelled tasks do not count.

### Change many tasks at once

1. On the **List**, tick the tasks to change, or tick **Select all … tasks shown** (it takes the tasks the filters show). With the keyboard, Tab to a box and press Space.
2. In the bar at the bottom, click what to change: **Status**, **Assignee** (members of the project only), **Milestone**, **Priority**, **Move dates** (a number of working days, negative for earlier; weekends and holidays are skipped, and tasks without dates keep none) or **Watchers**.
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
| Estimate (h) | Hours, such as `8` or `1.5` (`1,5` works too) |
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

1. On a task, under **Files**, click **Add files** and pick PDFs or photos (JPEG, PNG or WebP; up to 5 MB each, at most 5 per task). Large photos are made smaller first.
2. For a milestone, click **Files** on its card on the project's **Overview** (on a deliverable, **Acceptance document**) and add files the same way.
3. Click a file's name to download it. The bin removes it.

Members and managers add files; everyone who can open the project downloads them; the person who added a file or a project manager removes it. Adding and removing are in the task's (or the project's) history. When you set **Accepted on** for a deliverable that has no document yet, CORE reminds you to attach the signed certificate, and the card says so until you do. Deleting a task, a milestone or the project deletes its files.

> **Note:** Files are kept in CORE's `data` folder, not in the backup file from **Settings → Download backup**. Your administrator copies the `data` folder to keep them (see [the administrator's guide](admin)).

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

### Log your time

1. Open the project's **Time** tab (or the **Time** box on a task).
2. Pick the **Date**, enter the **Hours** (quarter hours: 0.25, 0.5, 1.75…), pick the **Task** or *No task* for meetings and project work, and add a **Note**.
3. If the estimate less what is logged is not what is really left, enter **Hours left on the task after this** (optional).
4. Click **Log time**.

If the hours you logged on a day are more than your attendance in the DTR shows, CORE saves them and flags them (*Over attended*). Only you, the project's managers and HR see that check. You can delete your own entries; a project manager can delete any.

### Keep the hours left up to date

Each task shows its **Estimate**, the hours **Logged** on it and the hours **Left**: the estimate less the hours logged, never below 0, and 0 once the task is done or cancelled.

1. When that is wrong (half the hours are logged but most of the work remains), open the task and enter **Hours left** under **Details**, or enter it when you log time.
2. To go back to estimate less logged, empty the box. A new **Estimate** also starts the count again.

Anyone who works on the task (members and managers) can set it; the change is in the task's history. **Workload** plans the hours left, not the whole estimate, and the project's **Overview** adds them up. Progress still goes by the estimates, so logging time does not move it.

### Read the milestone burn-up

1. On the project's **Overview**, find **Milestone burn-up** and pick a milestone (it opens on the next one not yet finished).
2. Read the three lines: **Scope** (what the milestone holds), **Done** (up to today) and **Expected** (a straight line from the milestone's start to its due date, in working days). The red line is today.
3. The text under the chart says the same in words: the scope, how much was added after the start, what is done and what was expected by now.

The chart counts hours when 60% or more of the milestone's tasks have an estimate, and tasks otherwise, as its progress does. A task cancelled leaves the scope from the day it was cancelled; a task reopened leaves *Done* until it is done again.

### See milestones and the billing forecast across projects

1. On **Overview**, click the **Milestones** tab.
2. Filter by **month**, **client**, **health**, or tick **Deliverables only**. **Upcoming and overdue** hides milestones already accepted or done; pick **All** to see them too.
3. Click a row to open its project.

With Sales & CRM access, each deliverable shows its **Amount**: its billing % of the value of the contract linked to the project (or of the deal's value when there is no contract). The **Billing forecast** under the list adds them up by month: **Expected** (not accepted yet, in the month it is due, with what is overdue), and **Earned** (accepted, in the month of acceptance). **Export CSV** saves the forecast. Without Sales & CRM access, the amounts and the forecast are not shown, and CORE does not send them to your browser at all.

Project Managers and Sales Managers see every project here; others see the projects they are on.

![Milestones across projects, with the billing forecast](projects-milestones.jpg)

### Catch up on what concerns you (For you)

1. Open **My work**. **For you** lists, newest first, what others did that concerns you: a task assigned to you, an @mention, a comment on a task assigned to you, that you added or that you watch, a task of yours or one you watch moved to done or cancelled, being added to a project.
2. Several of the same kind on one task are one line, such as *3 comments on PRJ-0001-7*.
3. Click a line to open the task; it is marked read. Click the tick to mark it read without opening it, or **Mark all read**.

Your own actions never notify you. The number next to **My work** includes the unread ones. CORE keeps your newest 200 for 60 days, and shows only those of projects you can still open. They are in CORE; the **daily digest** email counts the unread ones.

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

The report fits one page: the health, progress, dates and hours, every milestone, the overdue tasks and the tasks due in the next two weeks.

### Copy a project

1. On the project's **Overview**, click **Copy**.
2. Enter the **New project name** and the **New start date**, and click **Copy**.

The copy has the same statuses, milestones and tasks, with every date moved by the same number of calendar days. It has no assignees, time, comments or client links, and starts in *Planning*. For a pattern you use again and again, make a template instead (see [Make a project a template](projects#make-a-project-a-template)).

### Change the Projects setup (Project Managers)

1. Open **Projects setup**.
2. **Default statuses**: click **Edit statuses** to change the columns new projects start with.
3. **Project types**: one per line. Click **Save types**.

A change applies to new projects. **Daily digest** is described above. Administrators also see **Team access** (see [the administrator's guide](admin)).

![Projects setup](projects-setup.jpg)

## Screens at a glance

| Screen | What it is for |
|---|---|
| Overview | The portfolio: every project you may see with its progress, health and next milestone; filters; **Templates**; **+ New project** (blank or from a template). Its **Milestones** tab: milestones and deliverables across projects, with amounts and the **Billing forecast** for Sales & CRM users |
| A project: Overview | Health and why, progress, overdue and blocked tasks, hours left, estimated and logged, the milestones and deliverables (with their files and acceptance document), the **Milestone burn-up**, members, links to Sales & CRM, open service desk tickets of the client, recent activity, **Print status report** |
| A template | Like a project's overview, with **New project from this template** instead of health |
| A project: Board | A column per status; drag cards or use **Move to**; quick add; quick filters, search and **Views**; filters by assignee and milestone; **Edit columns** |
| A project: List | Every task in a table grouped by milestone or status, edited in place, with estimate, logged and hours left; quick filters, search and **Views**; ticked tasks changed together (bulk edit); **Export CSV**; **Import tasks** (managers) |
| A project: Timeline | Weeks across, milestones and tasks along a line, today, weekends and holidays; a dated list on a phone |
| A project: Time | Log hours; your entries this week; totals by person and by task against estimates |
| A task | Details (with hours left), checklist, subtasks, files, blocked by, comments with @mentions, **Watch** and watchers, time (estimate, logged, left), the linked ticket, history |
| My work | **For you** (what others did that concerns you), the **Daily digest** and its email setting, then your open tasks in every project: overdue, today, this week, later, no date |
| Workload | Hours left on open tasks against each person's capacity, week by week (Project Managers, Sales Managers) |
| Projects setup | The statuses new projects start with, the project types and the daily digest (Project Managers); team access (administrators) |

## Questions

**Why can't I see a project?**
You are not on it, and your account does not see every project. Ask its project manager to add you.

**How is health worked out?**
From the tasks, every time you open the project. A milestone is *Off track* when its date has passed with work still open, and *At risk* with an overdue task, a task due after it, or progress more than 15 points behind the straight line from its start to its due date (counted in working days, so weekends and the holidays in CORE's calendar do not count). The project takes its worst milestone, and is *At risk* while any task is overdue and *Off track* when its end date has passed with work open.

**What is the capacity on Workload?**
The person's working days that week, less holidays and approved leave, times the hours of their work day (8 by default, or their schedule in HR). The hours left on a task (not its whole estimate) are spread over its working days from its start, or today if later, to its due date; with only a due date, they count in that week. Tasks without a due date are under **No due date**.

**I logged time; why did progress not move?**
Progress goes by the tasks that are done, weighed by their estimates. The hours left change as you log time; progress changes when a task is done.

**Why did I not get a notification?**
CORE tells you only about what others did: your own changes never notify you. It does not notify about edits of dates or descriptions, and nothing comes from templates. If you were taken off a project, its notifications are no longer shown. To hear about a task that is not yours, **Watch** it.

**Why did I not get the digest email?**
The line under **Daily digest** on My work says why: you turned it off, digest emails are off for the company, CORE has no outgoing email, or your employee record has no email address. It is also not sent on a day with nothing in it, nor on weekends and holidays when the company chose working days only.

**Why can I not see the amounts on Milestones?**
Amounts come from contract and deal values in Sales & CRM, so only people with Sales & CRM access see them. Ask an administrator if you need them.

**Are task files in the backup?**
No. Like medical certificates and ticket files, they are kept in the `data` folder next to the database, not in the backup file. An administrator copies that folder to keep them.

**Which files can I attach?**
PDFs and photos (JPEG, PNG, WebP), up to 5 MB each and 5 per task or milestone. CORE checks what the file really is, not just its name. Files are always downloaded, never opened inside CORE.

**How exact is the burn-up?**
It is worked out from what each task remembers: when it was added, its status changes and when it was done. A deleted task is not remembered, so it is not in the chart at all; and a task moved from another milestone counts in its current one from the day it was added.

**Do templates count in the figures?**
No. Templates are not in the portfolio counts, health, My work or Workload, and their tasks are never in anyone's My work.

**Can a task have several assignees?**
No. Give it one assignee, and use subtasks or the checklist to share the work.

**Does closing the service desk ticket close the task?**
No. The task shows the ticket's status and the ticket shows the task; each is closed on its own.

**CORE says the task was changed since I opened it. What do I do?**
Someone else saved it while you had it open. The page loads their change; make yours again. Moving cards on the board does not ask: the last move wins.

**Is time on a project the same as attendance?**
No. The DTR is attendance for pay. Time on a project is effort reporting; CORE only compares the two and flags a day with more project hours than attended hours.
