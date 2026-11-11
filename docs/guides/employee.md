---
id: employee
title: Your self-service in CORE
summary: For every employee: clock in and out, check your attendance, file leave, work from home and official business, get your payslips, and see your equipment and IT tickets.
roles: employee, hr, hrstaff, payroll, it, support, sales, salesmgr
apps: hr, assets, helpdesk
order: 20
---

## Before you start

This guide is for **everyone with an employee record**: staff on an Employee account, and HR, payroll, IT and sales people for their own records.

- Sign in to CORE. The home page lists your modules. Your self-service pages are under **My account** in the sidebar of each module.
- **HR & Payroll** has My Home, My Attendance, My Requests, My Payslips and My Profile.
- **IT Asset Management** has My Assets, the equipment assigned to you.
- **IT Service Desk** has My tickets, to ask IT for help.
- To jump between modules, use the grid button at the top right.
- If a page says *Your account is not linked to an employee record*, ask an administrator to link it. HR, payroll and IT accounts without a linked record do not see the My account pages.
- To change your password, click your name at the top right and choose **Change password**.
- If you approve your team's requests, see also [the approver's guide](approver).
- To try things out, use the demo data: sign in as `employee.demo` (password `demo1234`). You are Juan Dela Cruz, Software Engineer, with a laptop and a monitor from IT.

## Walkthrough

### Clock in

1. Sign in as `employee.demo` and open **HR & Payroll**. **My Home** opens, with the time, today's status and this pay period.
2. Click **Clock in**. The first time, your browser asks whether CORE may use your location. Your answer does not stop the clock-in.
3. At the end of the day, click **Clock out**.

![My Home: the clock, this pay period, leave balances and the latest payslip](employee-home.jpg)

On a phone, **My Home** shows the same clock at the top. It works the same way.

![My Home on a phone](employee-home-phone.jpg)

### Check your attendance

1. Open **My Attendance**. It shows the current pay period: each day's time in and out, hours worked, late, undertime and overtime.
2. Change **From** and **To** to see other days.

![My Attendance for the pay period](employee-attendance.jpg)

### File a leave request

1. Open **My Requests**. Your **Leave balances** for this year are at the top.
2. Click **+ File a request**.
3. Choose the **Request**, for example *Vacation Leave*, and the dates under **From** and **To**. Below them, CORE lists each work day and how many days you have left.
4. Add a **Reason** and click **Submit for approval**. The form shows who it goes to: for Juan, *Maria Santos (immediate supervisor)*, then *HR*.

![Filing a request: the days, with pay or without, and who approves it](employee-file-request.jpg)

### Follow a request

1. In **My Requests**, look at **My requests**. Each row has its status and who it is waiting on.
2. Click a row to open it. You see each day, the approval route level by level, and the history.

![My Requests: leave balances and your requests](employee-requests.jpg)

### Payslips, equipment and tickets

1. Open **My Payslips**. Payslips appear once the payroll officer finalizes the payroll for a period. In fresh demo data there are none yet.
2. Click the grid button and open **IT Asset Management**. **My Assets** shows Juan's Lenovo ThinkPad and Dell monitor.
3. Open **IT Service Desk**. **My tickets** shows his ticket about the laptop battery.
4. Juan is on two projects, so **Project Management** is among his modules too. Its **My work** lists the project tasks assigned to him, and **My Home** shows a **My project tasks** box with a link to it. See [the projects guide](projects).

## How to…

### Clock in and out

1. Open **My Home**.
2. Click **Clock in** when you start and **Clock out** when you leave.

Times are the server's, not your device's. Your location is recorded when you clock in; only HR and administrators can see it. If the location cannot be read (you said no, or the connection is not secure), you are clocked in without it. Late, undertime and overtime are worked out from your schedule, which is on **My Profile**.

You clock in once a day. After you clock out, **Clock in** stays off until tomorrow. On a day of approved leave you cannot clock in. On an approved work-from-home or official-business day, My Home says *Remote work today*: clock in to record your hours, or leave it as a full day.

> **Tip:** Forgot to clock out? My Home still shows *Working* since that day, and the day has no hours worked until it is fixed. Tell HR the time you left.

Some offices have a shared **Time Clock** computer instead. HR sets it up.

### Check your attendance

1. Open **My Attendance**.
2. Pick the dates with **From** and **To**.

The totals at the top count days worked, hours, late, undertime, approved overtime and leave days. Leave days show the leave type; work-from-home days show *Remote work*. A day you clocked in but not out shows *Open*. Overtime shows *Pending* until HR approves it; only approved overtime is paid. To correct a record, ask HR.

### File leave, work from home or official business

1. Open **My Requests** and click **+ File a request** (or **File a request** on My Home).
2. Under **Request**, choose a leave type, or under *Work arrangement* choose **Work from home** or **Official business (working outside the office)**.
3. Pick **From** and **To**. Rest days, regular holidays and special non-working days are not counted.
4. For official business, fill in **Where you will be**, for example the client and city.
5. For leave, each day can be **Whole day**, **1st half** or **2nd half**. Each day shows *With pay* or *Without pay*.
6. Write a **Reason**. It is optional, but helps your approver decide.
7. Attach a medical certificate if the leave needs one (see below).
8. Check **Goes to** and click **Submit for approval**.

The request shows *Pending* under **My requests**. When the last approver approves it, the days go into **My Attendance**: leave days come off your balance, and a work-from-home or official-business day counts as a full day.

You only see the leave types you are entitled to. You cannot file dates that overlap another pending or approved request. Some leave types must be filed a set number of days ahead; the form says so.

### Leave without pay when credits run out

If you file more days than you have left, the extra days are marked *Without pay* in the form. They are recorded as **Leave Without Pay** when the request is approved, instead of the request being refused. In the list, the **Days** column shows how many are unpaid.

![A request's days, with pay and without pay, and its approval route](employee-request-detail.jpg)

### Attach a medical certificate

A medical certificate is required when the leave type's rules ask for one. For **Sick Leave** that is a request of 4 or more work days, unless HR set other rules: for example every sick leave, or every one after your 3rd this year. The form then says *Medical certificate (required)* and why. Without the certificate, CORE does not accept the request.

1. In **File a request**, choose the file under **Medical certificate**: a PDF or a photo, up to 5 MB.
2. To add or change it later, click **Attach certificate** (or **Replace certificate**) on the request in **My Requests**. This works while it is pending or returned to you.

HR can open your certificate. Your supervisor sees only that one is attached, unless HR lets approvers open certificates.

### Revise a request that was returned

An approver can send a request back to you with a note. My Requests then says so at the top, and the request shows *Returned for revision* with the note.

1. Click **Revise** on the request.
2. Make the change and click **Resubmit for approval**.

The request starts its approval route again. You can also click **Edit** on a pending request; it starts again too.

### Withdraw or cancel a request

1. Open **My Requests**.
2. Click **Withdraw** on a pending or returned request.
3. Give a **Reason** and click **Withdraw**.

An approved request cannot be withdrawn. Ask HR to cancel it; the days leave your attendance and the credits come back.

### Get your payslips

1. Open **My Payslips**. **Year to date** shows your gross pay, tax withheld, SSS, PhilHealth and Pag-IBIG, and the 13th month so far.
2. Click a pay period to open the payslip.
3. Click **Print / Save as PDF**.

The list shows the pay period, pay date, gross pay, deductions and net pay. Your latest payslip is also on **My Home**. A payslip marked *Voided* was cancelled by the payroll officer: it stays in the list for your records but no longer counts in the year-to-date totals. Ask the payroll officer why it was voided.

![My Payslips with the year-to-date totals](employee-payslips.jpg)

### Check your profile and change your password

1. Open **My Profile** to see your personal details, employment, schedule, government IDs and bank.
2. Click **Change password** to choose a new password.

To change any of your details, contact HR.

### See your equipment and report a problem

1. Open **IT Asset Management**. **My Assets** shows each item assigned to you: asset tag, serial number, since when, the return date, condition and status.
2. If something stops working, gets damaged or goes missing, click **Report a problem** on its card.
3. Choose **What's wrong?** (*Malfunction*, *Physical damage*, *Lost or stolen* or *Other problem*), **Noticed on**, and **Can you still work on it?**.
4. **Describe the problem** and click **Send report**.

IT is told in CORE. The card then shows *Problem reported* with the report number. Under **My problem reports** you follow its status (*New*, *Being checked*, *Resolved*, *Closed*) and IT's notes. **Supplies issued to you** lists consumables IT gave you. **Export CSV** saves the whole list. For a lost or stolen device, also tell your manager right away.

![My Assets: the equipment assigned to you](employee-assets.jpg)

### Ask IT for help with a ticket

1. Open **IT Service Desk**. **My tickets** lists your open tickets, and the resolved and closed ones.
2. Click **+ New ticket**.
3. Fill in the **Subject**, **Category** and **How urgent?**. Pick the device under **Which equipment?** if it is about one.
4. **Describe the problem**, add screenshots if you have them, and click **Submit ticket**.

![A new support ticket](employee-new-ticket.jpg)

The ticket opens with its number, for example *HD-000003*. IT's replies appear on it, and the list says *IT replied*. Write under **Add a reply** and click **Send** to answer. When it is fixed, click **My problem is solved**. A reply reopens a resolved ticket; for a closed one, open a new ticket and mention the old number.

If you work the service desk, your sidebar also has **Log a ticket**, for a call or walk-in on someone else's behalf. See [the service desk guide](service-desk).

## Screens at a glance

| Screen | What it is for |
|---|---|
| My Home | Clock in and out, today's status, this pay period, leave balances, pending requests and the latest payslip |
| My Attendance | Your daily time records: time in and out, late, undertime, overtime and leave |
| My Requests | Leave balances; file leave, work from home or official business; attach a certificate; revise, edit or withdraw |
| My Payslips | Year-to-date totals and your finalized payslips, to print or save as PDF |
| My Profile | Your record as HR keeps it, and **Change password** |
| Approvals | Only for supervisors and approvers: see [the approver's guide](approver) |
| My Assets | In IT Asset Management: equipment assigned to you, problem reports, supplies issued to you |
| My tickets | In IT Service Desk: your support tickets and IT's replies |
| Log a ticket | In IT Service Desk, for service desk agents only: log a ticket for someone else |

## Questions

**Why does it say I was absent?**
A scheduled work day with no attendance record counts as an absence. If you worked, ask HR to correct your record.

**Can someone else see where I clocked in?**
Only HR managers and administrators.

**Why is Clock in greyed out?**
You already clocked in today, you are still clocked in from an earlier day, or you are on approved leave today.

**Why are some of my leave days without pay?**
They are beyond the credits you have left for that leave type. They are recorded as Leave Without Pay.

**Why can't I choose Maternity or Paternity Leave?**
Some leave types are for female or male employees only, using the gender on your record, and some are given only to selected employees. Ask HR if you think you should have one.

**Who sees my medical certificate?**
HR. Approvers see it only if HR allows it under **Leave & Requests → Approval flow**. Certificates are health data under the Data Privacy Act.

**Does my approver get an email?**
No. CORE does not send email about requests yet. Your approver sees a count next to **Approvals** in their menu.

**Why can't I see my payslip yet?**
It appears when the payroll officer finalizes the payroll for that period.

**Should I report a broken laptop under My Assets or as a ticket?**
For equipment assigned to you that is broken, damaged or lost, use **Report a problem** in My Assets. For anything else (software, accounts, network, email, printers), open a ticket.
