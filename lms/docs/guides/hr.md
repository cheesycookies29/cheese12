---
id: hr
title: Running HR in ATLAS People
summary: For HR managers: employee records and sign-in accounts, attendance and the time clock, clock-in locations, leave approvals and credits, and HR settings.
roles: hr
apps: people
order: 55
---

## Before you start

This guide is for **HR managers**: the people who keep employee records, watch attendance, approve leave and give employees their sign-in accounts. Payroll is prepared by the payroll officer (see [the payroll officer's guide](payroll)); you can view it and change payroll setup. Your own time clock, leave and payslips are in [the employee guide](employee).

- Sign in on the ATLAS home page and open the **People** tile. You land on the **HR dashboard**.
- Everything you see is for **one campus at a time**: the one named under your name at the top right. If you work at more than one campus, switch from that menu (see [Switch campus](#switch-campus)).
- HR settings, payroll setup and leave types are shared by every campus. Employees, attendance, requests, clock-in locations and payroll runs belong to a campus.
- To try things out, use the demo school: sign in as `hr.demo` (password `demo1234`). Josefina Dimaculangan is HR manager for Main Campus and Sipocot Campus.

## Walkthrough

A first tour with the demo school. It takes about ten minutes.

### The HR dashboard

1. Sign in as `hr.demo` and open **People**. The **HR dashboard** shows active employees (teaching and non-teaching), who is in today, requests to review, the latest payroll, and leave in the next two weeks.
2. Read the blue notice: some active employees have **no sign-in account**, so they have no self-service yet.
3. Scroll to **Today's attendance**. Each scheduled employee has a status: *Working*, *Done*, *Remote work*, a leave type, or *Not in*, with the minutes late. On a rest day the table is empty.

![The HR dashboard at Main Campus](hr-dashboard.jpg)

### Approve a leave request

1. Open **Leave & approvals**. The **Requests** tab lists what is waiting: a vacation leave from Mark Torres and a four-day sick leave from Cecilia Navarro.
2. On Cecilia's row, click the **Medical certificate** link to read the certificate. Sick leave of more than 3 days needs one.
3. Click **Approve**, add a note if you like, and click **Approve** again. Each work day in the range is now leave in the DTR and comes off her Sick Leave balance.

![Pending requests under Leave & approvals](hr-leave-requests.jpg)

### An employee and their sign-in account

1. Open **Employees** and click the first name, *Abello, Nestor*. The record shows personal details, employment and pay, the **Sign-in account** card and government IDs. Nestor signs in with `staff.demo`.
2. Go back to **Employees** and open someone whose row says *No account* in the **Sign-in** column, for example the guidance counselor. Their card has **Create a sign-in account** and **Link an existing account**.

![An employee record with the sign-in account](hr-employee.jpg)

### Attendance and clock-ins

1. Open **Attendance (DTR)**. It shows the current pay period for everyone. Late, undertime and overtime are worked out from each person's schedule. Overtime that is not approved yet shows an **Approve** link.
2. Open **Clock-in locations**. Rows with a gold edge were clocked in *Away from campus*. Click **View map** on one to see where it was made.
3. Open **Time clock**. This is the screen for one shared computer in the HR office or faculty room.

![Attendance (DTR) for the pay period](hr-dtr.jpg)

![Clock-in locations, with clock-ins away from campus flagged](hr-clock-locations.jpg)

### Another campus

1. Click your name at the top right and, under **Switch campus**, choose **Sipocot Campus**. The page reloads and every list now shows Sipocot.
2. Open **Leave & approvals**. Elena Bonifacio's remote-work request is waiting there.
3. Switch back to **Main Campus** when you are done.

## How to…

### Add an employee

1. Open **Employees** and click **Add employee** (also on the HR dashboard).
2. If the person already signs in to Learn (a teacher, registrar or dean), pick their account under **Already has an account?**. ATLAS fills in the name, email and department and links the account when you save.
3. Fill in **Personal information**. Set **Gender**: maternity and paternity leave use it.
4. Under **Employment**, enter the **Employee no.** (the next free number is suggested), **Category** (teaching or non-teaching), position, office, **Appointment status**, **Date hired** and, if you have more than one campus, the **Campus**.
5. Under **Compensation**, pick the **Salary grade** and **Step**. The monthly salary from the salary schedule is shown beside them. For someone without a plantilla position (a job order paid by the day), leave the grade at *None (fixed rate)* and enter the **Pay type** and **Rate**. Tick **PERA** and enter RATA only for officials who receive it.
6. Tick **Flexible time (FLEX)** for someone whose clock-in and clock-out times should not affect pay.
7. Check the **Work schedule** (it starts as the default from HR settings), enter the government IDs and bank account, and click **Create employee**.

The record opens. The employee is included in the next payroll run at that campus.

### Give an employee a sign-in account

1. Open the employee's record under **Employees**.
2. For a teacher, registrar or dean: in the **Sign-in account** card, click **Link an existing account**, pick their Learn account and click **Link**.
3. For non-teaching staff: click **Create a sign-in account**, choose the **Account type** (usually *Staff: self-service only*), check the username, type a temporary password of at least 8 characters and click **Create account**.

Give the person the username and temporary password. They sign in on the ATLAS home page and are asked to choose their own password. From then on they have self-service in People.

> **Note:** The same list of account types also creates HR managers and payroll officers. Accounts for the Finance offices (Chief Accountant, Budget Officer, Cashier, Supply & Property Officer, Approving Officer) are created, linked and changed only by an administrator, so that nobody can give themselves the power to approve payments.

> **Note:** You cannot change your own leave credits, leave adjustments, leave days, pay or HR details, and a payroll officer cannot adjust their own payslip. ATLAS answers *You cannot … on your own record. Ask another officer or an administrator.*

### Reset a password, disable or unlink an account

1. Open the employee's record.
2. In **Sign-in account**, click **Reset password** to set a new temporary password (they are signed out everywhere), or **Change type or status** to change the account type or set it to *Disabled: cannot sign in*.
3. Click **Unlink** to separate the account from the record. The account stays, but loses self-service until it is linked again.

Reset password and Change type or status appear only for People accounts. A teacher's, registrar's or dean's password and status are managed in the Learn admin panel. A Finance office account shows *Only an administrator changes Finance office accounts.* instead. You cannot change your own account type or disable your own account.

### Edit, deactivate or move an employee

1. Open the record and click **Edit**.
2. To stop paying someone, set **Record status** to *Inactive* and, if they left, the **Date separated**. Inactive employees are left out of new payroll runs. Someone separated after a bonus's cut-off date still gets that bonus.
3. To move someone to another of your campuses, change **Campus**. This is refused while they are in a draft payroll run at the old campus.
4. Click **Save changes**.

**Delete employee** (at the bottom of the record) removes the record with its attendance and leave. Payslips in past payroll runs are kept. Setting the record to *Inactive* is usually the better choice.

### Correct attendance

1. Open **Attendance (DTR)**. Pick an employee and dates with **From** and **To** if you need to narrow it down.
2. Click **Edit** on a row, or **Add record** for a day with no record.
3. Choose the **Type**: *Work (on site)*, *Remote work*, or a leave type. For work, enter **Time in** and **Time out**. Leave **Time out** blank if the person is still working; for a full remote day leave both times blank.
4. Add a note saying why, and click **Save**.

A record with a time in but no time out shows *Open* and is not paid until it is fixed. An employee can have only one record per day.

### Approve overtime

1. Open **Attendance (DTR)**.
2. In the **Overtime** column, click **Approve** next to the minutes. Or click **Edit** and tick **Overtime / rest-day work approved**.

Only approved overtime counts in payroll. Under government payroll it is earned as compensatory time-off unless payroll setup pays it.

### Set the campus location for clock-ins

1. Open **Clock-in locations** and click **Set campus location** (or **Change**).
2. Stand on campus and click **Use this device's current location**, or paste the latitude and longitude from Google Maps.
3. Set the **Radius (metres)**. 300 m covers most campuses. Set **Keep locations for (days)** (365 by default).
4. Click **Save**.

Clock-ins farther than the radius are flagged *Away from campus*. They are never blocked. Each campus has its own location. Leave the coordinates blank to record locations without checking them.

### Check where someone clocked in

1. Open **Clock-in locations**. Pick the dates, an employee, and what to show: *All clock-ins*, *Away from campus*, *No location* or *On campus*.
2. Click **View map** on a row for the map, the accuracy and the distance from campus, or **Details** when no location was recorded (for example *Location permission denied*).
3. Click **Export CSV** for a file with the coordinates.

Only HR managers and administrators see locations. Approved remote-work days are shown as *Remote day*, not flagged.

### Set up the shared time clock

1. On the computer employees will use, sign in as an HR manager and open **Time clock**.
2. Leave it open. Each employee picks their name under **Employee** and clicks **Clock in** or **Clock out**. The list clears for the next person.

The times are the server's, not the computer's. The **Today** list shows who has clocked in and refreshes every minute.

![The shared time clock](hr-time-clock.jpg)

### Approve, reject or cancel a leave request

1. Open **Leave & approvals → Requests**. It shows *Pending* requests first; change the filter to see approved, rejected, cancelled or all.
2. Click **Approve** or **Reject** on a row. Add a note to the employee if you like and confirm.
3. To undo an approved request, filter by *Approved*, click **Cancel** on its row, then **Cancel request**. The leave or remote days are taken out of the DTR and the credits come back.

Approving writes each work day of the request into the DTR: leave days come off the balance; remote-work days count as full days. A request cannot be approved when:

- it is your own request (another approver must do it);
- the employee already has attendance on one of the days;
- the leave type needs a medical certificate and none is attached (the employee attaches it under **Leave & requests**);
- there are not enough credits left.

### Change one employee's leave

1. Open **Leave & approvals → Employee leave**, or click **Leave** on the employee's record.
2. Pick the **Employee** and **Year**.
3. To give or take away a leave type for this person, use the **Gets it?** switch on its row. *use default* puts it back to the type's rule.
4. To set this person's yearly credits (for example a prorated new hire), click the **Credits** number.
5. To add or take away days with a reason, such as a carry-over, click **Adjust** (or **Adjust balance**). Each adjustment is kept with your name.
6. To add leave taken outside the system (filed on paper) to the DTR, click **Record** (or **Record leave**).
7. To undo, click **Remove** in the **Adjustments** or **Leave taken** list below the table.

Remaining = credits + adjustments − used − pending. Days from an approved request can only be removed by cancelling the request. If payroll for a day is already finalized, ATLAS warns you that the payslip does not change.

![One employee's leave: credits, adjustments and leave taken](hr-employee-leave.jpg)

### Manage leave types

1. Open **Leave & approvals → Leave types** and click **Add leave type**, or **Edit** on a row.
2. Set the **Code**, **Name**, **Annual credits** (blank means no limit), whether it is **Paid leave**, **Who gets it** (everyone, or only employees you add under Employee leave), **Limited to** a gender, and **Medical certificate needed when longer than (days)**.
3. Click **Add** or **Save**.

A leave type that has been used cannot be deleted; untick **Active** instead. Leave types are the same at every campus.

### Change HR settings

1. Open **HR settings**.
2. Enter the employer **Address** and **Employer TIN** printed on payslips. The employer name is the school name set in the Learn admin panel.
3. Set the **Default work schedule** for new employee records.
4. Click **Save HR settings**.

The **Who can do what** table below lists which account type has which power in People. It is fixed by the account type; to give someone different powers, change their account type.

### Switch campus

1. Click your name at the top right.
2. Under **Switch campus**, click the campus.

The page reloads and every screen follows the campus. The current campus shows in the top bar.

## Screens at a glance

| Screen | What it is for |
|---|---|
| HR dashboard | Today at a glance: headcount, who is in, late and on leave, requests to review, leave in the next two weeks, the latest payroll, birthdays |
| Employees | Employee records, CSV export, and each employee's sign-in account |
| Attendance (DTR) | Daily time records with late, undertime and overtime; add and correct records; approve overtime; CSV export |
| Time clock | The shared clock-in computer for the campus |
| Clock-in locations | Where each clock-in was made, flags for clock-ins away from campus, and the campus location |
| Leave & approvals | Requests to approve, leave balances, one employee's leave, and leave types |
| Payroll | Payroll runs and payslips (view only; the payroll officer prepares them) |
| Payroll setup | Pay rules, contributions, tax tables and the salary schedule, shared with the payroll officer |
| HR settings | Employer details on payslips, the default work schedule, and who can do what |
| My day, My attendance, Leave & requests, My payslips, My profile | Your own self-service, as for every employee: see [the employee guide](employee) |
| My accountabilities, Supply & purchase requests | Your own self-service in ATLAS Finance: see [the employee guide](employee) |

## Questions

**Why is someone counted absent when they were at work?**
A scheduled work day with no attendance record counts as an absence. Add the record in **Attendance (DTR)** before payroll is run, or ask the payroll officer to recompute a draft run afterwards.

**Can I approve my own leave?**
No. Another HR manager or an administrator must approve it.

**A sick leave cannot be approved. Why?**
If the leave type needs a medical certificate for that many days (Sick Leave: more than 3 work days), it must be attached first. The employee attaches it under **Leave & requests → Attach certificate** while the request is pending.

**Does a clock-in away from campus stop the employee?**
No. Locations are recorded, never used to block. Treat a flag as a reason to check: laptops on Wi-Fi can be off by a few hundred metres, and a location can be faked. The payroll officer and the employee do not see locations.

**What does FLEX mean on a record?**
Flexible time: clock-in and clock-out times do not affect pay, so there is no late or undertime. Absences and approved overtime still count.

**What happens to leave already in a finalized payroll?**
Payslips of finalized runs never change. If you record or remove leave on a day that is already paid, ATLAS tells you, and the correction has to be made in a later payroll.

**Where do the default leave types come from?**
Common Philippine practice: Service Incentive Leave of at least 5 days (Labor Code), maternity (RA 11210), paternity (RA 8187) and solo parent leave (RA 11861). Adjust them to school policy under **Leave types**.

**Why is tardiness taken from vacation leave?**
Under government payroll, tardiness and undertime are charged to vacation leave credits first (CSC Omnibus Rules on Leave) when the payroll run is finalized; what the credits cannot cover is deducted from pay. Payroll setup can change this to *Deducted from pay*.
