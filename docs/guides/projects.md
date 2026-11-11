---
id: projects
title: Running projects
summary: For Project Managers and everyone on a project: the portfolio, a project's milestones and deliverables, the board, the list, the timeline, tasks, time, My work, Workload and the Projects setup.
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

To try things out, use the demo data: sign in as `pm.demo` (password `demo1234`), Andrea Villanueva, a Project Manager. `employee.demo` (Juan Dela Cruz) is a member of two projects.

## Walkthrough

A first tour with the demo data. It takes about fifteen minutes.

### The portfolio

1. Sign in as `pm.demo` and choose **Open Project Management**. **Overview** lists the open projects with their client, manager, dates, a **progress** bar, the **health** and the **next milestone**. Health has a word and a shape as well as a colour: a green circle *On track*, an amber triangle *At risk*, a red square *Off track*.
2. The figures at the top count open projects, those at risk and off track, overdue tasks, and your own open tasks.
3. Change the filter from **Open projects** to **All**, or pick a type or a manager, or tick **Mine**. The filters stay in the address, so a bookmark keeps them.

![The project portfolio](projects-portfolio.jpg)

### A project's overview

1. Click *Learning management system, phase 2*. The project opens on its **Overview**. Its tabs are **Overview**, **Board**, **List**, **Timeline** and **Time**.
2. The **Health** line says why the project is *At risk*: tasks in *Gradebook and parent portal build* are overdue.
3. Under **Milestones**, each card shows its due date, its progress and its health. *Design and requirements sign-off* is a deliverable (gold diamond) for 30% of the contract, and was accepted. *Go-live and acceptance* is the deliverable for the other 70%.
4. Further down: **Overdue** tasks, **Blocked** tasks, **Recent activity**, the **Members**, and **Links** to the client, the deal and the contract in Sales & CRM.

![A project's overview: health, figures and milestones](projects-overview.jpg)

### The board

1. Click **Board**. There is a column per status, from *To do* to *Done*, with the number of tasks in each.
2. Each card shows the task's key, title, due date (red when overdue), checklist (*2/3*), subtasks, the assignee's initials and, when it waits for another task, *Blocked*.
3. Drag *Data privacy notice for parents* from **For review** to **Done**. CORE says *moved to Done*.
4. Every card has a **Move to** menu (the small arrow at its top right). It lists the statuses, and **Move up** and **Move down** in the column. It works with the keyboard and on a phone, where dragging does not.
5. To add a task, type its title in **+ Add a task** at the top of a column and press Enter.

![The board](projects-board.jpg)

![The Move to menu on a phone](projects-move-to.jpg)

### A task

1. Click *Gradebook: import class lists from the SIS*. The task page has its description, **Checklist**, **Subtasks**, **Comments** and **History** on the left; **Details**, **Blocked by**, the linked service desk ticket and **Time** on the right.
2. Tick *Test with the College of Engineering lists* in the checklist.
3. Under **Details**, change **Status** to *For review*. Each change is saved at once and written in the history.
4. Under **Comments**, write a comment and mention someone with @ and their username, for example `@employee.demo`. The mention is highlighted.

![A task](projects-task.jpg)

### List, timeline and time

1. Click the project's name at the top, then **List**: every task in a table, grouped by milestone (or by status), with the status, assignee and due date editable in place. Click a column title to sort; **Export CSV** saves what is shown.
2. Click **Timeline**: weeks across the top, milestones as diamonds, tasks as bars from their start to their due date (a dot when there is only a due date), a red line for today, and weekends and holidays shaded. It scrolls sideways; on a phone it is a list by date.
3. Click **Time**: log your hours, see your entries this week, and the totals by person and by task against the estimates.

![The list, grouped by milestone](projects-list.jpg)

![The timeline](projects-timeline.jpg)

![Logging time](projects-time.jpg)

### My work and Workload

1. Open **My work** in the side menu. It lists the tasks assigned to you in every project: **Overdue**, **Today**, **This week**, **Later** and **No date**. Change a task's status right there.
2. Open **Workload**. Each row is a person; each column a week. A cell shows the hours planned for that person that week against their capacity. A red cell has more work than time. Click a cell to see its tasks.

![My work](projects-my-work.jpg)

![Workload: planned hours against capacity](projects-workload.jpg)

## How to…

### Start a project

1. On **Overview**, click **+ New project**.
2. Enter the **Project name**, the **Type** (*Client*, *Government* or *Internal*), the **Status**, the **Start** date (required) and the **End** date.
3. Pick the **Project manager**, and the **Budget (hours)** if there is one.
4. If you have Sales & CRM access, pick the **Client**, the **Deal** and the **Contract**. A deliverable due after the contract's end date is flagged.
5. Click **Save**.

The project opens. Its board starts with the statuses from the Projects setup. From a won deal or a contract, **Start project** in Sales & CRM fills all of this in (see [the sales guide](sales#start-a-project-from-a-won-deal)).

### Add the milestones and deliverables

1. On the project's **Overview**, click **+ Milestone**.
2. Enter the **Name** and the **Due** date.
3. For a contract deliverable, tick **Contract deliverable** and enter the **Billing % of the contract**. The deliverables of a project bill at most 100%.
4. Click **Save**.
5. When the deliverable goes to the client, click its pencil and enter **Submitted to the client on**; when they accept it, **Accepted on** and the **Acceptance note** (for example the certificate of acceptance).

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
3. Click **Log time**.

If the hours you logged on a day are more than your attendance in the DTR shows, CORE saves them and flags them (*Over attended*). Only you, the project's managers and HR see that check. You can delete your own entries; a project manager can delete any.

### Set the project's health yourself

1. On the project's **Overview**, click **Set health**.
2. Pick *On track*, *At risk* or *Off track* and write why, in one line.
3. Click **Save**.

Your reading is shown with your name next to the one CORE works out, which stays visible. Pick *As worked out* to remove it.

### Print a status report

1. On the project's **Overview**, click **Print status report**.
2. Print it, or choose **Save as PDF** in the print window.

The report fits one page: the health, progress, dates and hours, every milestone, the overdue tasks and the tasks due in the next two weeks.

### Copy a project as a template

1. On the project's **Overview**, click **Copy**.
2. Enter the **New project name** and the **New start date**, and click **Copy**.

The copy has the same statuses, milestones and tasks, with every date moved by the same number of days. It has no assignees, time, comments or client links, and starts in *Planning*.

### Change the Projects setup (Project Managers)

1. Open **Projects setup**.
2. **Default statuses**: click **Edit statuses** to change the columns new projects start with.
3. **Project types**: one per line. Click **Save types**.

A change applies to new projects. Administrators also see **Team access** (see [the administrator's guide](admin)).

![Projects setup](projects-setup.jpg)

## Screens at a glance

| Screen | What it is for |
|---|---|
| Overview | The portfolio: every project you may see with its progress, health and next milestone; filters; **+ New project** |
| A project: Overview | Health and why, progress, overdue and blocked tasks, hours, the milestones and deliverables, members, links to Sales & CRM, open service desk tickets of the client, recent activity, **Print status report** |
| A project: Board | A column per status; drag cards or use **Move to**; quick add; filters by assignee and milestone; **Edit columns** |
| A project: List | Every task in a table grouped by milestone or status, edited in place, sorted and filtered; **Export CSV** |
| A project: Timeline | Weeks across, milestones and tasks along a line, today, weekends and holidays; a dated list on a phone |
| A project: Time | Log hours; your entries this week; totals by person and by task against estimates |
| A task | Details, checklist, subtasks, blocked by, comments with @mentions, time, the linked ticket, history |
| My work | Your open tasks in every project: overdue, today, this week, later, no date |
| Workload | Planned hours of open tasks against each person's capacity, week by week (Project Managers, Sales Managers) |
| Projects setup | The statuses new projects start with and the project types (Project Managers); team access (administrators) |

## Questions

**Why can't I see a project?**
You are not on it, and your account does not see every project. Ask its project manager to add you.

**How is health worked out?**
From the tasks, every time you open the project. A milestone is *Off track* when its date has passed with work still open, and *At risk* with an overdue task, a task due after it, or progress more than 15 points behind the straight line from its start to its due date (counted in working days, so weekends and the holidays in CORE's calendar do not count). The project takes its worst milestone, and is *At risk* while any task is overdue and *Off track* when its end date has passed with work open.

**What is the capacity on Workload?**
The person's working days that week, less holidays and approved leave, times the hours of their work day (8 by default, or their schedule in HR). A task's estimate is spread over its working days from start to due; with only a due date, it counts in that week. Tasks without a due date are under **No due date**.

**Can a task have several assignees?**
No. Give it one assignee, and use subtasks or the checklist to share the work.

**Does closing the service desk ticket close the task?**
No. The task shows the ticket's status and the ticket shows the task; each is closed on its own.

**CORE says the task was changed since I opened it. What do I do?**
Someone else saved it while you had it open. The page loads their change; make yours again. Moving cards on the board does not ask: the last move wins.

**Is time on a project the same as attendance?**
No. The DTR is attendance for pay. Time on a project is effort reporting; CORE only compares the two and flags a day with more project hours than attended hours.
