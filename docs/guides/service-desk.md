---
id: service-desk
title: Working the IT Service Desk
summary: For helpdesk agents and IT: the ticket queue, replies and internal notes, assignment, status and service levels, logging calls, tickets by email and from the public form, and the service desk settings.
roles: support, it
apps: helpdesk
order: 45
---

## Before you start

This guide is for **helpdesk agents** and **IT asset managers**: the people who answer IT Service Desk tickets. Administrators set up the desk's email and rules (see [Service desk settings](#service-desk-settings-administrators-only)). Equipment, stock and problem reports are covered in [the IT assets guide](it-assets).

- Sign in and open the **IT Service Desk** tile on the home page. You land on the **Overview**.
- **Agents** see every ticket, reply, add internal notes and can be assigned tickets. Administrators, IT Asset Managers and Helpdesk Agents are agents by default. An administrator can turn agent access on or off for any account.
- Everyone else, and you for your own problems, uses **My tickets**.
- Tickets come from four places: **My tickets** in CORE, **email** to the helpdesk address, the **public form** at `/support`, and agents who **Log a ticket** for a call or a walk-in. The channel shows under the ticket number: *Portal*, *Email*, *Web form* or *Agent*.
- To try things out, load the demo data and sign in as `it.demo` (password `demo1234`). The demo has four tickets.

## Walkthrough

A first tour with the demo data. It takes about ten minutes.

### The overview

1. Sign in as `it.demo` and open **IT Service Desk**. The tiles count tickets **Awaiting reply**, **Unassigned**, **Assigned to me**, **Overdue** and **Open**. Click a tile to open that list.
2. **Needs attention** lists tickets that are overdue or waiting on the desk. **Assigned to me** lists your own open tickets.

![The IT Service Desk overview](desk-overview.jpg)

### The queue

1. Open **Tickets**. It shows open tickets: overdue first, then by priority, then the most recently updated.
2. Bold rows are waiting on the desk: the requester wrote last. The **Due** column says when the next reply or the fix is due, for example *Respond in 2 h*.
3. Use the tabs **Open**, **Mine**, **Unassigned**, **Overdue**, **Resolved & closed** and **All**, and the filters for priority, category and assignee. The search box looks in the number, subject, requester and message text.

![The ticket queue](desk-queue.jpg)

### A ticket with a reply and an internal note

1. Click the row *HD-000002 Request: second monitor for sales desk*.
2. The conversation reads from the top. Mark's request has a blue edge, the desk's reply a maroon edge, and the **Internal note** an amber background. Mark never sees internal notes.
3. On the right, **Ticket** holds the status, priority, category, assignee and related asset. **Service level** shows when the first response was made (*Met* or *Late*) and when the ticket is due to be resolved.

![A ticket: the conversation, the reply box and the ticket details](desk-ticket.jpg)

### Answer a new ticket

1. Go back to **Tickets** and open *HD-000004 Cannot open the Finance shared drive*. It is *New* and *High*.
2. Under **Assignee**, choose yourself. The ticket becomes *Open*.
3. Type a reply, leave **Then** at *Waiting on requester* and click **Send reply**. The first response is now recorded.

## How to…

### Reply to the requester

1. Open the ticket. Leave **Reply to requester** selected.
2. Type your reply. To use a standard answer, pick it under **Insert saved reply…**; the requester's first name and the ticket number are filled in.
3. To add screenshots or PDFs, click **Attach** (up to 5 files).
4. Under **Then**, choose the next status. For a *New* or *Open* ticket it suggests *Waiting on requester*. Choose *Resolved* if your reply fixes it.
5. Click **Send reply**.

The reply shows in the requester's **My tickets**. If outgoing email is set up and the requester has an email address, it is also emailed, and the conversation shows *Emailed to …*. Otherwise it shows *Not emailed* with the reason. If the ticket was unassigned, it is assigned to you.

### Add an internal note

1. Open the ticket and choose **Internal note**.
2. Type the note, for example what you tried or which spare to use, and click **Add note**.

Notes are for agents only. The requester never sees them, in CORE or by email.

### Assign a ticket, change status, priority or category

1. Open the ticket.
2. In **Ticket** on the right, change **Status**, **Priority**, **Category** or **Assignee**. Each change is saved at once and noted in the conversation. Status changes are shown to the requester too; the other changes are for agents only.
3. To link the ticket to a piece of equipment, pick it under **Related asset**. **Open asset** then takes you to it.

The statuses are *New*, *Open*, *Waiting on requester*, *On hold*, *Resolved* and *Closed*. Changing the priority changes the due times. If another agent has the same ticket open, a notice says so at the top.

### Keep to the service levels

Each priority has a target for the first response and for the resolution, in hours. The defaults are:

| Priority | First response | Resolution |
|---|---|---|
| Urgent | 1 | 8 |
| High | 4 | 24 |
| Normal | 8 | 72 |
| Low | 24 | 120 |

1. The **Due** column in **Tickets** shows *Respond in …* until the first reply, then *Resolve in …*. It turns amber when the time is nearly up and red when it is overdue.
2. Open **Tickets → Overdue** to see every ticket past its target.

While a ticket is *Waiting on requester*, *Resolved* or *Closed*, it shows no due time and does not count as overdue.

### Log a ticket on someone's behalf

Use this for a request by phone, chat or in person.

1. Open **Log a ticket**.
2. Enter the **Requester name** and **Requester email (for replies)**. If the email belongs to someone with a CORE account, the ticket also shows in their **My tickets**. Administrators can pick the person under **Requester** instead.
3. Enter the **Subject**, **Category** and **Priority**. **Assign to** starts with you. Pick a **Related asset** if it is about one.
4. Write the **Description**, add attachments if you have them, and click **Create ticket**.

The ticket opens on the *Agent* channel with the line *Logged by … on behalf of …*.

![Log a ticket for a phone call or walk-in](desk-log-ticket.jpg)

### Tickets by email

When an administrator has set up the helpdesk address, CORE checks the mailbox every few minutes.

- A new email becomes a ticket on the *Email* channel, with the category and priority set for emailed tickets. The sender gets an acknowledgement with the ticket number, if that is turned on and outgoing email is set up.
- A reply to the desk's email, or an email with the ticket number (for example `[HD-000123]`) in the subject, is added to that ticket. A reply to a ticket that is *Waiting on requester* or *Resolved* reopens it.
- An email about a *Closed* ticket starts a new ticket that mentions the old number.
- Out-of-office replies, bounces, mailing lists and the desk's own mail are ignored. PDF and image attachments are kept.

### Tickets from the public form

The public form at `https://<your CORE address>/support` lets anyone, with or without an account, send a complaint or request. An administrator turns it on.

![The public form at /support](desk-public-form.jpg)

1. Each request becomes a ticket on the *Web form* channel. The sender gets a reference number and a private tracking link.
2. On the ticket, **Service level** shows **Requester's tracking link**. Click **Copy link** if the person lost it. Share it only with them.
3. Reply as usual. The sender reads your reply on the tracking link, and by email if outgoing email is set up. They can reply there too.

Requesters from outside the company are marked *Outside the company*.

### Send a sales enquiry to Sales & CRM

Some tickets, often from the public form, are really sales enquiries.

1. Open the ticket and click **Send to Sales & CRM**.
2. CORE creates a lead with the requester's details and the message, and opens it. The ticket notes *Sent to Sales & CRM as lead …*.

The button shows only for accounts with Sales & CRM access. If yours does not have it, add an internal note and pass the ticket to an administrator or the sales team.

### My tickets: your own requests

**My tickets** is in the menu for everyone. Use it for your own IT problems.

1. Click **+ New ticket**. Fill in the **Subject**, **Category**, **How urgent?**, the equipment it is about (optional) and **Describe the problem**. Click **Submit ticket**.
2. Click a ticket to read replies and **Add a reply**. Click **My problem is solved** when it is fixed.

![A ticket in My tickets, as the requester sees it](desk-my-tickets.jpg)

A reply to a resolved ticket reopens it. A closed ticket cannot be reopened: open a new one and mention its number. See [the employee guide](employee) for more.

### Service desk settings (administrators only)

**Service desk settings** is in the menu for **administrators only**. Agents ask an administrator for these changes. It has five tabs:

1. **Receiving email**: the **Helpdesk email address**, the mailbox it is read from (pick the **Email provider** to fill in Gmail, Microsoft 365 or Zoho), the sign-in and app password, **Check every (minutes)**, **Who can open tickets by email**, and the category and priority for emailed tickets. Tick **Receive email at this address** and click **Save**. **Test connection** checks the sign-in; **Check mail now** imports at once.
2. **Sending email**: the outgoing mail (SMTP) server, usually with **Use the same sign-in as the mailbox**. Tick **Send replies by email** and click **Save**. **Send a test email** checks it.
3. **Tickets & replies**: the **Categories (one per line)**, the **Service level targets (hours)**, **Close resolved tickets after (days)**, the acknowledgement email, and **Saved replies** (**+ Add**).
4. **Public form**: **Accept requests from this link**, the page title and introduction, the categories visitors can choose, and the link to share.
5. **Agents**: who works tickets. Turn **Agent access** on or off for any account.

![Service desk settings: receiving email](desk-settings-email.jpg)

![Service desk settings: categories, service levels and saved replies](desk-settings-tickets.jpg)

Only administrators can delete a ticket (**Delete**, on the ticket).

## Screens at a glance

| Screen | What it is for |
|---|---|
| Overview | Counts of tickets awaiting a reply, unassigned, yours, overdue and open; what needs attention |
| Tickets | The queue with views, filters and search; open a ticket to reply, add notes, assign and change status |
| Log a ticket | A ticket for a call, chat or walk-in, on someone's behalf |
| Service desk settings | Administrators only: receiving and sending email, categories, service levels, saved replies, the public form and agents |
| My tickets | Your own requests to the IT Service Desk |

## Questions

**What does "Waiting on requester" do?**
It tells everyone the desk is waiting for an answer from the requester. The ticket shows no due time and is not counted as overdue. When the requester replies, it goes back to *Open*.

**Does a resolved ticket stay open for the requester?**
Yes, for 7 days by default. Until then a reply from the requester reopens it. After that it closes by itself. Administrators change the number of days under **Tickets & replies**.

**Why was my reply not emailed?**
Outgoing email is not set up, or the requester has no email address. The reply is still in their **My tickets** or on their tracking link. The reason shows under your reply.

**Can the requester see internal notes or files attached to them?**
No. Notes and their files are shown to agents only.

**The Insert saved reply list is missing. Why?**
There are no saved replies yet. An administrator adds them under **Service desk settings → Tickets & replies**.

**Is the public form protected against spam?**
Yes: a hidden trap field, a minimum time to fill in the form, and at most 5 requests per visitor per hour and 10 per email address per day. The form tells visitors that their details are used only to answer their request, in line with the Data Privacy Act of 2012.

**What is the difference between a ticket and a problem report?**
A problem report is filed by an employee from **My Assets** about equipment assigned to them, and is handled under **IT Asset Management → Problem reports**. A ticket is any request to the service desk. See [the IT assets guide](it-assets).
