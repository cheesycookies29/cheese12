---
id: approver
title: Approving requests as a supervisor
summary: For supervisors, named approvers and HR: approve, reject or return leave, work-from-home and official-business requests in Approvals, one at a time or in bulk.
roles: employee, hr
apps: hr
order: 25
---

## Before you start

This guide is for **anyone who approves requests**: supervisors (even on an Employee account), people HR names as approvers, and HR managers. Your own requests are in [the employee guide](employee).

- You are someone's supervisor when HR sets you as the **Immediate supervisor** on their employee record (**Employees → Edit → Employment**).
- Open **HR & Payroll**. **Approvals** is in your sidebar, with a count of the requests waiting for you. It appears only when you have a team, are named as an approver, or are HR.
- Requests come to you in the order set by the approval flow. By default, the immediate supervisor approves first, then HR.
- CORE does not send email about requests. Check the count next to **Approvals**.
- To try things out, use the demo data: sign in as `employee.demo` (password `demo1234`). Juan Dela Cruz leads Mark Bautista and Kristine Mendoza. `hr.demo` is the HR manager.

## Walkthrough

### See what is waiting for you

1. Sign in as `employee.demo` and open **HR & Payroll**. **Approvals** shows *3*.
2. Click **Approvals**. The **For my approval** tab lists Mark's work from home, Mark's official business at Meridian Logistics, and Kristine's vacation leave. Each says *Your turn*.

![Approvals: requests waiting for Juan](approver-list.jpg)

### Open and approve a request

1. Click Kristine's row. The window shows her reason, how many Vacation Leave days she has left, each day of the leave, the **Approval route** and the **History**. Level 1 is Juan, level 2 is HR.
2. Click **Approve**. Add remarks if you like and click **Approve** again.
3. CORE says *Approved. Now waiting on HR.* The request leaves **For my approval** and is listed under **Processed**.

![A request with its days, approval route and history](approver-detail.jpg)

### Return a request for revision

1. On Mark's work-from-home row, click **Return**.
2. Under **What should the employee change?**, write what you need, for example *Please file it for the 11th instead*.
3. Click **Return for revision**.

Mark sees the request under **My Requests** as *Returned for revision*, with your note. When he resubmits it, it comes back to you.

### Finish as HR

1. Sign out and sign in as `hr.demo`. Kristine's leave is now in **Approvals → For my approval**: it is HR's turn.
2. Click **Approve** and confirm. The two days go into Kristine's attendance and come off her Vacation Leave balance.
3. Open **Leave & Requests**. The **Requests** tab lists every request with its status and route.

## How to…

### Approve a request

1. Open **Approvals → For my approval**.
2. Click **Approve** on the row, or click the row to read it first and then **Approve**.
3. Add **Remarks (optional)** and click **Approve**.

If more levels follow, the request moves to the next approver and CORE tells you who. On the last approval, the days go into the employee's attendance: leave days (paid or without pay), half days, and work-from-home or official-business days as full days.

If some leave days are beyond the employee's remaining credits, the window says how many will be recorded as Leave Without Pay.

### Approve several at once

1. In **For my approval**, tick the requests, or tick the box in the header to select all.
2. Click **Approve selected**.
3. Add **Remarks (optional)** and click **Approve all**.

Each request is checked on its own. CORE says how many were approved, and the reason if any could not be.

### Reject a request

1. Click **Reject** on the row, or in the request's window.
2. Write the **Reason for rejecting (the employee sees this)**. It is required.
3. Click **Reject**.

A rejection ends the request at any level. The employee can file a new one.

### Return a request for revision

1. Click **Return** on the row, or **Return for revision** in the request's window.
2. Write **What should the employee change?**. It is required.
3. Click **Return for revision**.

The employee revises it and clicks **Resubmit for approval**. It then starts its route again from level 1.

### Open a medical certificate

1. A leave with a certificate shows **📎 Medical certificate** under the request. Click it.
2. If it says *Certificate attached (HR only)*, only HR can open it. You can still see that one is attached.

A Sick Leave that needs a certificate under HR's rules (by default, 4 or more work days) cannot be approved until one is attached. The row shows *Certificate missing* until the employee attaches it.

### Decide as HR when it is not your turn

HR managers can decide any request at any level, for example when a supervisor is away.

1. Open **Leave & Requests → Requests**. A request waiting on someone else shows **Approve (HR)**.
2. Click **Approve (HR)**. The window says *It is not your turn on this request's route*. Approving decides it for every level still to come.
3. Add remarks and click **Approve**.

**Return** and **Reject** are on the same row. An HR approval is recorded in the request's history as an HR override.

![Approving as HR when it is not your turn](approver-hr-override.jpg)

### Cancel an approved request

1. As HR, open **Leave & Requests → Requests** and choose *Approved* in the filter.
2. Click **Cancel** on the request.
3. Write the **Reason (the employee sees this)** and click **Cancel request**.

The days the request added are taken out of the attendance record, and the leave credits come back. Days the employee actually clocked are kept as normal work days. Supervisors cannot cancel from **Approvals**: ask HR.

### Change who approves

1. As HR, open **Leave & Requests → Approval flow**.
2. Choose **Sequential** (level by level) or **Parallel** (any level can decide).
3. For each level, choose **Immediate supervisor**, **Supervisor's supervisor**, **HR (anyone who approves leave)** or **Specific people**. For specific people, tick who; any one of them can approve that level. Use **+ Add a level** (up to three) or **×** to remove one.
4. Tick **Approvers can open medical certificates** only if supervisors need to read them. Off, only accounts that manage leave (HR and payroll) open them.
5. Click **Save approval flow**.

The new flow applies to requests filed from now on. A notice says how many active employees have no immediate supervisor on record; set it on each employee record.

![Leave & Requests → Approval flow](approver-flow.jpg)

## Screens at a glance

| Screen | What it is for |
|---|---|
| Approvals → For my approval | Requests where it is your turn: open, approve, return, reject, or approve several at once |
| Approvals → Processed | Requests you approved, rejected, returned or cancelled |
| Approvals → My team | Every request from the people who report to you, with where each one is |
| Leave & Requests → Requests | HR only: every request, its status and route; HR decisions and cancelling approved requests |
| Leave & Requests → Approval flow | HR only: the approval levels, sequential or parallel, and who opens medical certificates |
| My Home, My Requests and the other My account pages | Your own self-service: see [the employee guide](employee) |

## Questions

**How do I know a request is waiting for me?**
The **bell** in the top bar tells you: *Mark Bautista asked for 1 day of official business*, with the dates. It comes when the request reaches your step: when it is filed, when the level before you approves, or when the employee resubmits it after a revision. Choosing it opens the request in **Approvals**. If the employee withdraws it, or HR cancels it, while it waits for you, the bell tells you too. The employee hears of your decision (approved, rejected with your reason, or returned with your remarks) in their own bell. Notifications do not include the employee's reason; open the request to read it. See [See your notifications](getting-started#see-your-notifications).

**What is the difference between sequential and parallel?**
Sequential: every level approves in turn, and the request comes to you only when the level before you has approved. Parallel: the request goes to every level at once, and the first approval decides it. In both, a rejection ends it.

**A request from my team is not under For my approval. Why?**
It is not your turn yet, someone else already decided it, or it was returned to the employee. **My team** shows all your team's requests and who each one is waiting on.

**I approved, but the request is still Pending. Why?**
It has moved to the next level, for example HR. It is approved when the last level approves.

**Can I approve my own request?**
No. Nobody approves their own request; it goes to the next approver.

**Why does the route say a level was skipped?**
That level had nobody to approve it: no supervisor on record, or a supervisor without a CORE account. If every level is skipped, HR decides, so no request gets stuck. If you hold two levels in a row, one approval covers both.

**Someone's supervisor changed. Who approves their old request?**
The route is fixed when the request is filed. Changes to supervisors or to the approval flow apply to new requests.

**Why can't I approve this request?**
CORE says why. Common reasons: a Sick Leave that needs a medical certificate and has none, attendance already recorded on one of the days, or not enough credits left.

**Why can't I open the medical certificate?**
Certificates are health data under the Data Privacy Act. Only HR and payroll open them unless HR ticks **Approvers can open medical certificates** under **Leave & Requests → Approval flow**. Every opening is recorded in the audit log.

**I approved by mistake. Can I undo it?**
Not from Approvals. Ask HR to cancel the approved request, with the reason; the employee can then file it again.
