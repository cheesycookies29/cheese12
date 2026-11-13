---
id: sales
title: Selling with Sales & CRM
summary: For Sales Officers and Sales Managers: leads and how to convert them, accounts and contacts, the deal pipeline, public bids and their documents, contracts and renewals, activities, and the sales setup.
roles: sales, salesmgr
apps: crm
order: 50
---

## Before you start

This guide is for the **sales team**: the people who follow up leads, move deals through the pipeline, prepare public bids and keep contracts renewed. There are two account types:

- **Sales Officer**: adds and edits leads, accounts, contacts, deals, bids and contracts, moves deals, and logs calls, meetings, emails, notes and tasks.
- **Sales Manager**: everything a Sales Officer does, plus **deleting** records and the **Sales setup** (pipeline stages, lead sources, lost reasons, industries, the bid checklist and the renewal notice). Only a manager sees the **Delete** button on a record and **Sales setup** in the menu.

What you need to know first:

- Sign in to CORE and choose **Open Sales & CRM** on the CORE home. You land on the **Overview**. Every screen is in the side menu on the left.
- Everyone in sales sees every record. Each record has an **Owner**; the **Mine** filter on each list shows only yours.
- Records are linked: an **account** is an organization; its **contacts** are the people there; a **deal** is an opportunity with an account; a **bid** is a public tender or RFP; a **contract** is what you won. A **lead** is interest that is not qualified yet.
- Codes are given automatically: `LD-0001` for leads, `DL-0001` for deals, `BID-0001` for bids, `CT-0001` for contracts (demo records start with `DEMO-`).
- To try things out, use the demo data: sign in as `sales.demo` (password `demo1234`), a Sales Manager. Your own self-service (leave, payslips, equipment) is in [the employee guide](employee) if your account is linked to an employee record.

## Walkthrough

A first tour with the demo data. It takes about fifteen minutes.

### The Overview

1. Sign in as `sales.demo` and choose **Open Sales & CRM**. The **Overview** shows five figures at the top: **Open pipeline**, **Weighted forecast** (value × stage probability), **Won this quarter**, **Win rate, 90 days** and **Open leads**. Click any of them to open the list behind it.
2. Under **Pipeline by stage** is the value in each open stage, and under it the **Weighted forecast by expected close** for the next three months.
3. On the right, **My tasks** lists your tasks due today or overdue. *Send revised price schedule to Paolo* is overdue. Below are **Bid deadlines**, **Renewals coming up** and **Closing in 30 days**.
4. Type `north` in the search box at the top (**Search accounts, people, deals, bids…**). It finds Northfield State University, its people, its deals and its contracts. Press Escape to close it.

![The Sales & CRM Overview](sales-overview.jpg)

### Move a deal on the board

1. Open **Pipeline**. The **Board** has a column per open stage, with its probability, number of deals and total value. Each card shows the deal, the account, the value, the expected close date, the owner and the next step.
2. Drag *Plant attendance and timekeeping* from **Needs analysis** to **Proposal**. CORE says *Moved to Proposal.* and the totals change.
3. While you drag a card, **Won** and **Lost** appear at the bottom of the screen. Dropping a card on **Lost** asks why it was lost.
4. Click **List** at the top right. The list has every deal, including the won and lost ones, with the weighted value of each.

![The pipeline board](sales-pipeline.jpg)

### Work on a deal

1. Click the card *Student information system upgrade*. The deal page has the **stage bar** at the top (click a stage to move the deal there), the **Activity** timeline on the left and **Details**, **Bids** and **Contracts** on the right.
2. Under **Open and upcoming**, tick the box next to *Send revised price schedule to Paolo*. The task moves to **History** as done.
3. In the box at the top of **Activity**, click **Call**, type a subject such as *Follow-up on pricing* and what was said, and click **Log call**. It is added to the history with your name and the time.

![A deal: the stage bar, the timeline and the details](sales-deal.jpg)

### Turn a lead into a deal

1. Open **Leads**. The list shows open leads; new ones are in bold and counted next to **Leads** in the menu.
2. Click *Engr. Felipe Reyes*. He is *Qualified*: there is a real opportunity.
3. Click **Convert**. CORE offers to **Create a new account** for his office, with **Also create a deal** ticked and the deal name and value filled in from the lead.
4. Click **Convert**. CORE creates the account, a contact for Engr. Reyes and a deal in the first stage, and opens the deal.

![Converting a lead into an account, a contact and a deal](sales-lead-convert.jpg)

### A bid, a contract and your tasks

1. Open **Bids** and click *Supply, delivery and installation of an e-permit and licensing system*. The top shows the **Submission deadline** (*6 days left*), the **Approved budget (ABC)**, **Our bid** (2.5% below the ABC) and **Documents ready** (*6/10*).
2. Tick **Bid security** in the **Document checklist**. The count goes up and your name and the date are kept next to it.
3. Open **Contracts** and click *Student information system support and maintenance*. Its badge says *Renew in 40 days*: it ends within the renewal notice.
4. Open **Activities**. **My open** lists your open calls, meetings and tasks across the CRM, soonest first.

![A bid with its document checklist](sales-bid.jpg)

## How to…

### Add a lead

1. Open **Leads** and click **+ Lead** (also on the Overview).
2. Enter the **Name**, **Company or organization**, **Position**, **Source**, **Email** and **Phone**.
3. Enter an **Estimated value (₱)** if you know it, and what they need under **What they need**.
4. Leave **Status** at *New* and pick the **Owner**. Click **Save**.

The lead opens. Change its status with **Edit** as you go: *Contacted* after the first call, *Qualified* when there is a real opportunity, or *Disqualified* (say why under **If disqualified, why**). An enquiry that came in to the IT Service Desk can be sent here from the ticket with **Send to Sales & CRM**.

### Convert a lead

1. Open the lead and click **Convert**.
2. Under **Account**, keep **Create a new account** or pick an account that already exists. CORE picks the existing one when its name matches the company.
3. Keep **Also create a deal** ticked for an opportunity, and check the **Deal name**, **Value (₱)** and **Expected close**. Untick it if there is no deal yet.
4. Click **Convert**.

CORE creates the account (as a *Prospect*), a contact from the lead's name, email and phone, and the deal in the first stage. Open tasks and notes on the lead move to the new deal. A converted lead cannot be edited any more; edit its account, contact or deal instead.

### Add an account and its contacts

1. Open **Accounts** and click **+ Account**.
2. Enter the **Organization name**, the **Relationship** (*Prospect*, *Client*, *Partner*, *Supplier* or *Other*), the **Sector**, **Industry**, **TIN**, email, phone, website and address. **Tags** are comma-separated words you can search for.
3. Click **Save**. The account page opens.
4. Under **People**, click **+ Contact**, enter the person's name, **Position**, email and phone, and click **Save**.

Two accounts cannot have the same name. A prospect becomes a client by itself when one of its deals is won. The account page shows its open pipeline, what was won, contracts and bids, and one timeline with the activity of all its contacts, deals, bids and contracts.

### Add a deal and move it through the pipeline

1. Click **+ Deal** on the Overview, the **Pipeline**, or an account page. Add the account first if it is new.
2. Enter the **Deal name**, **Account**, **Main contact**, **Value (₱)**, **Expected close**, **Stage**, **Owner**, **Source** and the **Next step**. Click **Save**.
3. To move it, drag its card on the **Pipeline** board, or click a stage in the stage bar on the deal page.
4. When it is won, click **Won** in the stage bar (or drop the card on **Won**) and confirm with **Mark as won**. When it is lost, click **Lost**, pick the **Reason** and click **Mark as lost**. The **Edit** form does not offer Won or Lost: a deal is closed from the stage bar or the board. On a phone, use the stage bar.

Choosing someone else as **Owner** (on any lead, deal, account, contact, bid or contract, new or not) tells them by the **bell** in the top bar: *Sara made you the owner of deal DL-0004 …*, which opens the record. Taking a record yourself tells nobody.

Each move is written in the deal's history. Won and lost deals leave the board and stay in the **List**. Each stage's probability weighs the forecast: a ₱1M deal at *Proposal* (50%) counts ₱500K.

![Marking a deal as lost asks why](sales-lost.jpg)

### Find deals in the list

1. Open **Pipeline** and click **List**.
2. Narrow it down with the search box, the owner filter (**Everyone**, **Mine** or a person), the stage filter (**All stages**, **Open only** or one stage), and **Past expected close** for open deals whose date has passed.
3. Click **Export CSV** for a spreadsheet of what is shown.

Every list in Sales & CRM has **Export CSV**.

### Prepare a public bid

1. Click **+ Bid** on **Bids**, on the account, or on the deal (which links them).
2. Enter the **Project or tender title**, the **Procuring entity or client**, the **Reference no.** (PhilGEPS or ITB number) and the **Procurement mode**.
3. Enter the **Approved budget, ABC (₱)** and **Our bid (₱)**, the **Submission deadline** (date and time), **Bid opening** and **Pre-bid conference**.
4. Pick the **Linked deal** if there is one, and click **Save**.
5. On the bid page, tick each document in the **Document checklist** once it is signed, notarized where needed, and in the envelope. To add a document this bid needs, type it under the list and click **Add**; the **×** removes one.
6. When the envelope is in, click **Edit**, set **Status** to *Submitted* and click **Save**.

For every government procurement mode (all but *Private RFP*), a bid above the ABC is refused, because the procuring entity would reject it. Setting a bid to *Submitted* with documents unticked asks first (**Mark as submitted**). When the bid is *Awarded*, the linked deal closes as won; when it is *Not awarded*, the deal closes as lost.

### Record a contract and renew it

1. On a won deal, click **+ Contract** under **Contracts**. Or click **+ Contract** on **Contracts** or on the account.
2. Enter the **Contract title**, **Client**, **Contract or PO no.**, **Value (₱)**, **Status**, **Start**, **End**, **Billing** and **Key terms**. Tick **Renews automatically** if it does.
3. Click **Save**.

A contract shows *Renew in … days* when it ends within the renewal notice (60 days unless your manager changed it), and appears under **Renewals coming up** on the Overview. To work on the renewal, open the contract and click **Renew**: CORE starts a new deal, *Renewal: …*, with the same account and value and the end date as the expected close. The contract shows it under **Renewal**, and the deal links back to the contract. While that deal is open, the contract shows *Renewal DL-… open* and **Renew** opens the deal instead of starting another. Set the old contract to *Ended* when the term is over.

![A contract due for renewal](sales-contract.jpg)

### Start a project from a won deal

When a deal is won, the work of delivering it is a project in **Project Management**. Starting it needs an account that can edit projects as well as use the CRM: a Project Manager with CRM access, or a sales account an administrator gave **Projects access** (Sales Managers see every project, read only).

1. Open the won deal (or its contract) and click **Start project**.
2. Check the **Project name**, **Type**, **Project manager**, **Start** and **End** dates. The end date comes from the contract when there is one.
3. Click **Start project**.

The project opens, linked to the client, the deal and the contract. The deal and the contract list it under **Projects**; Sales Managers can open it to follow the delivery. A deal starts one project; to start a second one for the same deal, CORE asks first. See [the projects guide](projects).

![Start project on a won deal](sales-start-project.jpg)

### Log a call, meeting, email, note or task

1. Open the record it is about: a lead, account, contact, deal, bid or contract.
2. At the top of **Activity**, click **Call**, **Meeting**, **Email**, **Task** or **Note**.
3. Type the subject and the details or outcome. For a task, set the **Due** date (it is required); for a call or meeting you can set **Schedule for** a later date. Pick the **Owner**.
4. Click **Log call**, **Log meeting**, **Log email**, **Add task** or **Save note**.

Anything with a date that is not done shows under **Open and upcoming**; tick it when it is done. Stage and status changes are added to the history automatically. You can delete what you wrote yourself; a Sales Manager can delete any entry.

### Keep up with your tasks

1. Open **Activities**. The number next to it in the menu counts your tasks due today or overdue.
2. Pick a tab: **My open**, **Overdue**, **All open**, **Done** or **All**, and a type if you like.
3. Tick **Done** on a row when it is finished. Click the name under **About** to open the record.

### Change the sales setup (Sales Managers)

1. Open **Sales setup**.
2. **Pipeline stages**: rename a stage, change its **Probability %**, move it up or down, click **+ Stage** to add one, then **Save stages**. *Won* (100%) and *Lost* (0%) are always there.
3. **Lists**: one item per line for **Lead sources**, **Reasons a deal is lost** and **Industries**, and the **Renewal notice (days before a contract ends)**. Click **Save lists**.
4. **Bid checklist**: the documents every new bid starts with, one per line. Click **Save checklist**.

The pipeline needs 2 to 10 open stages, and a stage that still has deals cannot be removed: move them first. A changed checklist applies to new bids only. Administrators also see **Team access**, where they give or remove CRM access for other accounts (see [the administrator's guide](admin)).

![Sales setup: the pipeline stages](sales-setup.jpg)

### Delete a record (Sales Managers)

1. Open the record and click **Delete**.
2. Confirm. Its notes and history go with it.

An account that still has deals, bids or contracts cannot be deleted; delete or move those first. Sales Officers do not see **Delete**.

## Screens at a glance

| Screen | What it is for |
|---|---|
| Overview | Open pipeline, weighted forecast, won this quarter, win rate, open leads; pipeline by stage and forecast; my tasks, bid deadlines, renewals and deals closing in 30 days; search across the CRM |
| Pipeline | The deals: a board to drag between stages (and onto Won or Lost), and a list with filters and CSV export |
| Leads | Interest not yet qualified, with source and status; convert a lead into an account, contact and deal |
| Accounts | Organizations: clients, prospects, partners and suppliers, with their people, deals, bids, contracts and timeline |
| Contacts | The people at your accounts |
| Bids | Public tenders and RFPs: ABC, our bid, deadlines and the document checklist |
| Contracts | What was won: value, term, billing, renewal badges and **Renew**; the projects delivering it |
| Activities | Calls, meetings, emails, notes and tasks across the CRM; your open and overdue tasks |
| Sales setup | Pipeline stages and probabilities, lead sources, lost reasons, industries, renewal notice and the bid checklist (Sales Managers); team access (administrators) |

## Questions

**Why can't I see Delete or Sales setup?**
Those are for Sales Managers and administrators. Ask your manager to delete a record or change a list.

**What is the weighted forecast?**
Each open deal's value times its stage probability, added up. It is a better guess of what will close than the full pipeline. The probabilities are set in **Sales setup**.

**Why was my bid refused?**
Under Philippine procurement law (RA 9184, and the New Government Procurement Act, RA 12009, that replaced it) a bid above the approved budget for the contract (ABC) is disqualified, so CORE does not accept one in any government procurement mode. Check the amount, or the procurement mode (*Private RFP* has no ABC rule).

**Where does the bid checklist come from?**
It lists the eligibility, technical and financial documents usually asked for in Philippine public bidding. Always check it against the procuring entity's bidding documents and bid bulletins, and add or remove documents on the bid.

**Who can be the owner of a record?**
Anyone with access to Sales & CRM. Administrators can give access to other accounts.

**A lead came in through the service desk. How do I get it here?**
A service desk agent with CRM access opens the ticket and clicks **Send to Sales & CRM**. The lead keeps a link to the ticket.

**CORE says the record was changed since I opened it. What do I do?**
Someone else saved the same record while your form was open. Close the form: the page loads their change. Then make yours again. This keeps one person's save from undoing another's.

**Where do I see how the delivery of a won deal is going?**
On the deal or contract page, under **Projects**. Sales Managers can open the project to see its progress, health and milestones (read only).

**Can I undo a lost deal?**
Yes. Open the deal and click another stage in the stage bar. The history keeps both moves.
