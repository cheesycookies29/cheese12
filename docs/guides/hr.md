---
id: hr
title: Running HR in CORE
summary: For HR Managers and HR Staff: employee records, attendance and the time clock, clock-in locations, leave and approvals, the holiday calendar and payroll setup.
roles: hr, hrstaff
apps: hr
order: 30
---

## Before you start

This guide is for **HR Managers** and **HR Staff**: the people who keep employee records, watch attendance, decide leave and keep the holiday calendar. Payroll is prepared by the Payroll Officer (see [the payroll guide](payroll)); as HR Manager you can view it and change **Payroll Setup**. Your own clock-ins, requests and payslips are under **My account**, as for every employee (see [the self-service guide](employee)).

- Sign in and open the **HR & Payroll** tile on the CORE home page. HR Managers land on the **Dashboard**.
- To try things out, load the demo data and sign in as `hr.demo` (password `demo1234`). The account is Maria Santos, HR Manager, who supervises Juan, Andrea and Ramon.

### What HR Staff see

HR Staff do day-to-day HR without pay data. Compared with an HR Manager:

| | HR Manager | HR Staff |
|---|---|---|
| Employee records | Add, edit, delete; sees pay, government IDs and bank details | Views only; pay, IDs and bank show *Visible to HR and payroll only* |
| Attendance (DTR) and Time Clock | Yes | Yes |
| Leave & Requests | Decides any request, sets the approval flow | Sees requests, changes balances and leave types; cannot decide requests or change the flow |
| Holidays | Yes | Yes |
| Dashboard, Clock-in locations, Payroll, Payroll Setup | Yes | No |
| Approvals | Yes | Only if they supervise someone |

An HR Staff account opens **HR & Payroll** on **Employees**. Link it to the person's own employee record under **Admin panel → Users & Access** so they also get their own self-service (**My Home**, **My Payslips**…).

## Walkthrough

A first tour with the demo data. It takes about ten minutes.

### The dashboard

1. Sign in as `hr.demo` and open **HR & Payroll**. The **Dashboard** shows active employees, who is working now, late today, on leave today, not in yet, and **Pending requests**.
2. Read **Today's attendance**. Each person has a status: *Working*, *Done*, a leave type, *Remote work*, a holiday, *Not in yet* or *Rest day*, with the minutes late.
3. On the right are the **Latest payroll** and **Headcount by department**. Click any count to open the list behind it.

![The HR dashboard](hr-dashboard.jpg)

### An employee record

1. Open **Employees** and click *Dela Cruz, Juan*. His record shows personal details, **Employment & pay** (his supervisor, Maria Santos, and his direct reports, Mark and Kristine), the **Daily-rate factor**, his schedule and whether he is on flexible time.
2. Under **Government IDs & bank** the numbers are masked. Click **Show numbers** to see them in full. CORE writes this in the audit log.
3. Scroll down for **Year to date**, **Recent payslips** and the IT equipment he holds.

![An employee record, with the government IDs masked](hr-employee.jpg)

### Approve a request

1. The **Approvals** item in the menu shows *1*. Open it. Juan's half-day sick leave is on **For my approval**, marked *Your turn*, because Maria is his immediate supervisor.
2. Click the row to see the days, his balance and the route. Click **Approve**, add remarks if you like, and click **Approve** again. The half day goes into his attendance.

![Approvals: requests waiting for you](hr-approvals.jpg)

Supervisors use the same screen; see [the approver guide](approver).

### All requests and the approval flow

1. Open **Leave & Requests**. The **Requests** tab lists every pending request, with who it is waiting on. Mark's and Kristine's requests wait on Juan, so the button reads **Approve (HR)**.
2. Open the **Approval flow** tab: level 1 is the **Immediate supervisor**, level 2 is **HR (anyone who approves leave)**.

![Every pending request, with its route](hr-leave-requests.jpg)

### Attendance

1. Open **Attendance (DTR)**. It shows the current pay period for everyone, with late, undertime and overtime worked out from each schedule.
2. Change **From** to see earlier days. A holiday has a badge beside the date, for example *All Souls' Day*; a weekend record has *Rest day*. In the demo, Ramon in the warehouse works on holidays, so his rows show them.

![The DTR, with a holiday badge](hr-dtr.jpg)

## How to…

### Add an employee

1. Open **Employees** and click **+ Add employee** (also on the Dashboard).
2. Fill in **Personal information**. Set **Gender**: leave types limited to one gender use it.
3. Under **Employment**, check the **Employee no.** (the next number is suggested), and enter the **Position**, **Department**, **Immediate supervisor**, **Employment status** and **Date hired**.
4. Under **Compensation**, choose the **Pay type** (*Monthly-rated* or *Daily-rated*), the **Rate (₱)** and any **Monthly allowance (₱)** (non-taxable). Leave **Work days per year** empty to use the company default from Payroll Setup.
5. Tick **Minimum wage earner** for someone exempt from withholding tax, and **Flexible time (FLEX)** for someone whose clock-in and clock-out times should not affect pay.
6. Check the **Work schedule**: **Shift start**, **Shift end**, **Unpaid break (minutes)** and the **Work days**. It starts as the company default.
7. Enter the **Government IDs & bank** and click **Create employee**.

The record opens. The person is included in the next payroll run.

![Compensation on the employee form: Work days per year and FLEX](hr-employee-edit.jpg)

### Set the daily-rate factor

**Work days per year** is how many days a year the monthly salary pays for. CORE uses it for the daily rate: monthly salary × 12 ÷ work days per year. The daily rate prices absences, late and undertime, overtime and holiday premiums.

1. Leave it empty on most records, so the company default applies (set by HR or Payroll in **Payroll Setup**).
2. For someone on a different week, enter their own: 261 is common for a 5-day week, 313 for a 6-day week.
3. Click **Save changes**. The record shows *(own)* or *(company default)* beside **Daily-rate factor**.

### Edit, deactivate or delete an employee

1. Open the record and click **Edit**.
2. To stop paying someone, set **Record status** to *Inactive*. Inactive employees are left out of new payroll runs.
3. Click **Save changes**.

**Delete employee** at the bottom of the record removes the record with its attendance, requests and leave balances. Payslips in past payroll runs are kept. Setting the record to *Inactive* is usually the better choice.

### Export the employee list

1. Open **Employees**. Narrow the list with the search box, the department and the status if you like.
2. Click **Export CSV**.

For HR Managers the file has pay, full government IDs and bank accounts, and CORE records the export in the audit log. HR Staff get the same file without those columns.

### Correct attendance

1. Open **Attendance (DTR)**. Pick an employee and the dates with **From** and **To** if needed.
2. Click **Edit** on a row, or **+ Add record** for a day with no record.
3. Choose the **Type**: *Work (on site)*, *Remote work* or a leave type. For work, enter **Time in** and **Time out**. Leave **Time out** blank if the person is still working; for a full remote day leave both blank.
4. Add **Notes** saying why, and click **Save**.

A record with a time in but no time out shows *Open* and is not paid until it is fixed. **Delete** removes a record. **Export CSV** gives the records with the day type, holiday and night-shift minutes.

### Approve overtime

1. Open **Attendance (DTR)**.
2. In the **Overtime** column, click **Approve** next to the minutes. Or click **Edit** and tick **Overtime / rest-day work approved**.

Only approved overtime is paid. Overtime shorter than the **Minimum overtime** in Payroll Setup (30 minutes) is ignored. All work on a rest day needs the same approval.

### Change attendance that is already paid

You can still edit a day inside a **finalized** payroll. CORE saves it, but that payroll does not change, and a red message says so. Tell the Payroll Officer, who settles the difference with an adjustment in the next run.

![The warning when a day is in a finalized payroll](hr-dtr-finalized.jpg)

### Set up the shared time clock

1. On the computer employees will use, sign in as HR and open **Time Clock**.
2. Leave it open. Each employee picks their name under **Employee** and clicks **Clock in** or **Clock out**.

The **Today** list shows who has clocked in. Someone on approved leave cannot clock in; someone on an approved remote day can, to record their hours.

### Set the office location for clock-ins

1. Open **Clock-in locations** and click **Set office location** (or **Change**).
2. Enter a **Name**, then stand in the office and click **Use this device's current location**, or copy the **Latitude** and **Longitude** from Google Maps.
3. Set the **Radius (metres)** (150 m suits most offices) and **Keep locations for (days)** (365 by default).
4. Click **Save**.

Clock-ins farther than the radius are flagged *Outside office*. They are never blocked. Leave latitude and longitude blank to record locations without an office check.

![The office location](hr-clock-locations.jpg)

### Check where someone clocked in

1. Open **Clock-in locations**. Pick the employee, the dates, and what to show: *All clock-ins*, *Outside office*, *No location* or *Within office*.
2. Click **View map** on a row, or **Details** when no location was recorded.
3. Click **Export CSV** for a file with the coordinates.

Only HR Managers and administrators see locations. Approved remote-work days are not flagged.

### Decide a request as HR

1. Open **Leave & Requests → Requests**. It shows *Pending* requests; change the filter for others.
2. Click a row to see the days, the route and any medical certificate.
3. Click **Approve** (or **Approve (HR)** when it is not your turn), **Return** or **Reject**. Remarks are required to return or reject; the employee sees them.

When the approval flow has an HR level, the **bell** in the top bar tells everyone with approval rights when a request reaches it (*Ben Reyes approved Ana Reyes's request for 2 days of Vacation Leave*); choosing it opens the request. The employee hears of your decision in their own bell, with your remarks, and of a cancellation with its reason.

As HR Manager you can decide any request at any point, for example when a supervisor is away. Approving out of turn decides it for every level still to come. Nobody approves their own request. To undo an approved request, filter by *Approved*, click **Cancel** and give a reason: its days leave the DTR and the credits come back.

### Approve several at once

1. Open **Approvals → For my approval**.
2. Tick the requests, or the box in the header for all of them.
3. Click **Approve selected**, add remarks if you like, and click **Approve all**.

### Set the approval flow

1. Open **Leave & Requests → Approval flow**.
2. Choose **Sequential** (level by level) or **Parallel** (the first approval decides).
3. Set up to three levels: *Immediate supervisor*, *Supervisor's supervisor*, *HR (anyone who approves leave)* or *Specific people*. **+ Add a level** adds one; **×** removes one.
4. Tick **Approvers can open medical certificates** only if supervisors need to read them. Off, only accounts that manage leave (HR and payroll) open them; supervisors see that one is attached.
5. Click **Save approval flow**.

It applies to requests filed from now on. A level with nobody to approve it is skipped; if every level is skipped, HR decides.

![The approval flow](hr-approval-flow.jpg)

### Change leave credits and leave types

1. Open **Leave & Requests → Leave balances** and pick the **Year**. Each cell shows remaining of credits.
2. Click a cell to set that employee's **Credits** for the year, for example for carry-over or a new hire. Leave it blank for the default.
3. Open **Leave types** and click **+ Add leave type**, or **Edit** on a row. Set the **Code**, **Name**, **Annual credits (days)**, **Paid leave**, **Who gets it**, **Limited to**, the **Medical certificate** rules (see below) and **File at least this many days ahead**.

A leave type that was used cannot be deleted; untick **Active** instead.

### Set when a medical certificate is needed

Each leave type has two certificate rules. Use either or both; a request that meets either one cannot be filed without a certificate (a PDF or a photo).

1. Open **Leave & Requests → Leave types** and click **Edit** on the leave type, for example **Sick Leave**.
2. Under **Medical certificate**, set **Required from this many work days in one request**: **1** means every request; **4** means requests of 4 or more work days (the default for Sick Leave). Leave it blank to turn this rule off.
3. Set **Required after this many requests**, and choose **in a year** or **in a month**. For example **3 in a year**: once an employee has filed 3 Sick Leave requests this year, the 4th and every later one needs a certificate. Pending, returned and approved requests count; cancelled and rejected ones do not. Leave it blank to turn this rule off.
4. Click **Save**. The **Rules** column shows the result, for example *Medical certificate: from 4 days; after 3 a year*.

![Sick Leave's medical certificate rules](hr-leave-type-certificate.jpg)

When an employee files without a required certificate, CORE refuses the request and tells them why. A request filed before you changed a rule cannot be approved until a certificate is attached. The **Employee leave** tab, for one person's leave in detail (types offered, adjustments with a reason, leave recorded by hand), is for administrators.

### Keep the holiday calendar

1. Open **Holidays** and pick the year tab.
2. If proclaimed holidays are missing, click **Load the 2027 national holidays** (or that year). CORE has the 2026 and 2027 proclamations.
3. Click **+ Add holiday** for **Eid'l Fitr** and **Eid'l Adha** once they are proclaimed, or a local holiday. Enter the **Date**, **Name**, **Type**, **Applies to** (and **Where** for one city or province) and the **Basis**, then click **Add holiday**.

Choose the **Type** carefully. A *Regular holiday* is paid even when not worked and 200% when worked. A *Special non-working day* pays 130% when worked. A *Special working day* is an ordinary work day. Leave and work-from-home requests skip regular holidays and special non-working days.

![Adding a holiday](hr-holidays.jpg)

### Change payroll setup

HR Managers can change **Payroll Setup**: pay rules, **Work days per year**, the holiday, rest-day and night premiums, the holiday rules, contribution rates and tax tables. It is shared with the Payroll Officer; see [Payroll Setup in the payroll guide](payroll#change-payroll-setup). Click **Save payroll setup**. Draft runs change when recomputed; finalized runs never change.

## Screens at a glance

| Screen | What it is for |
|---|---|
| Dashboard | Today at a glance: headcount, who is working, late, on leave or not in, pending requests, the latest payroll |
| Employees | Employee records, supervisors, pay, schedules, masked government IDs, CSV export |
| Time Clock | The shared clock-in computer |
| Attendance (DTR) | Daily time records; add and correct records, approve overtime, holiday badges, CSV export |
| Clock-in locations | Where each clock-in was made, and the office location |
| Approvals | Requests waiting for you, the ones you decided, and your team's |
| Leave & Requests | Every request and its route, leave balances, leave types and the approval flow |
| Payroll | Payroll runs, payslips and year to date (view only for HR) |
| Payroll Setup | Pay rules, premiums, holiday rules, government rates and tax tables |
| Holidays | The holiday calendar payroll and leave use |
| My Home, My Attendance, My Requests, My Payslips, My Profile | Your own self-service: see [the self-service guide](employee) |

## Questions

**Why is someone counted absent when they were at work?**
A scheduled work day with no attendance record counts as an absence. Add the record in **Attendance (DTR)** before payroll is run, or ask the Payroll Officer to **Recompute** a draft run.

**What does FLEX mean?**
Flexible time: clock-in and clock-out times do not affect pay, so there is no late or undertime. Absences and approved overtime still count.

**Why does no late show on a holiday?**
Hours worked on a holiday are not checked for late or undertime. They are paid at the holiday premium.

**Can I approve my own leave?**
No. Another approver or HR Manager decides it.

**Who can open a medical certificate?**
HR and the Payroll Officer, who manage leave, and supervisors only when **Approvers can open medical certificates** is on. Certificates are health data under the Data Privacy Act, and every opening is in the audit log.

**Who sees the full government IDs?**
HR Managers, Payroll Officers and administrators, after **Show numbers**, on the edit form, or in the full export. Each is in the audit log. HR Staff do not see them.

**Is a local holiday only for that city?**
CORE pays a holiday on the calendar the same way for every employee. Add a local holiday only if it applies to the people you pay.

**Where do the default leave types come from?**
Common Philippine practice: Service Incentive Leave of at least 5 days (Labor Code), maternity (RA 11210), paternity (RA 8187) and solo parent leave (RA 11861). Adjust them to company policy under **Leave types**.
