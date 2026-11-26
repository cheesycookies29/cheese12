---
id: hr
title: Running HR in ATLAS People
summary: For HR managers: employee records and sign-in accounts, the plantilla register and the PSIPOP, attendance and the time clock, clock-in locations, leave approvals and credits, recruitment (job openings and applications), and HR settings.
roles: hr
apps: people
order: 55
---

## Before you start

This guide is for **HR managers**: the people who keep employee records and the plantilla, watch attendance, approve leave, give employees their sign-in accounts and post job openings. Payroll is prepared by the payroll officer (see [the payroll officer's guide](payroll)); you can view it and change payroll setup. Your own time clock, leave and payslips are in [the employee guide](employee).

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
2. On Cecilia's row, choose the **Medical certificate** link to read the certificate. Sick leave of more than 3 days needs one.
3. Choose **Approve**, add a note if you like, and choose **Approve** again. Each work day in the range is now leave in the DTR and comes off her Sick Leave balance.

![Pending requests under Leave & approvals](hr-leave-requests.jpg)

### An employee and their sign-in account

1. Open **Employees** and choose the first name, *Abello, Nestor*. The record shows personal details, employment and pay, the **Sign-in account** card and government IDs. Nestor signs in with `staff.demo`.
2. Go back to **Employees** and open someone whose row says *No account* in the **Sign-in** column, for example the guidance counselor. Their card has **Create a sign-in account** and **Link an existing account**.

![An employee record with the sign-in account](hr-employee.jpg)

### The plantilla register

1. Open **Plantilla**. Each row is one position (item) as DBM issued it: the item number, position title and salary grade, the office, campus and fund source, the status, the incumbent and the authorized and actual salaries a year. The cards at the top count the **Filled**, **Vacant** and **Unfunded** items and add up the salaries.
2. Under **Filled, vacant and unfunded**, pick **Vacant**. Four items are left, three of them with a job opening already.
3. Choose **DEMO-ADOF2-0107-2026** (Administrative Officer II). It has no incumbent, the authorized annual salary comes from the salary schedule (SG 11, step 1, × 12), and its job opening is listed. **Post a job opening** starts another from it.
4. Go back and choose a filled item. The **Incumbent** card shows the person's name, sex, date of birth, TIN, GSIS no., status of appointment and actual salary, read from their employee record.

![People → Plantilla at Main Campus and Sipocot](hr-plantilla.jpg)

![A vacant item with its job opening](hr-plantilla-item.jpg)

### Attendance and clock-ins

1. Open **Attendance (DTR)**. It shows the current pay period for everyone. Late, undertime and overtime are worked out from each person's schedule. Overtime that is not approved yet shows an **Approve** link.
2. Open **Clock-in locations**. Rows with a gold edge were clocked in *Away from campus*. Choose **View map** on one to see where it was made.
3. Open **Time clock**. This is the screen for one shared computer in the HR office or faculty room.

![Attendance (DTR) for the pay period](hr-dtr.jpg)

![Clock-in locations, with clock-ins away from campus flagged](hr-clock-locations.jpg)

### Job openings and applications

1. Open **Recruitment → Job openings**. Main Campus has three open openings: *Instructor I* and *Laboratory Technician I* are **Open to all**, *Administrative Officer II* is **Internal only**.
2. Choose **Instructor I**. Its **Applications** list has Carla Mendiola, an **External** applicant, *Under review*.
3. Choose **Change status**, pick **Shortlisted**, type a note such as *Interview on Monday, 9:00, at the HR office.*, and choose **Save and tell the applicant**. Carla is told on the bell, and the change is in the audit log.
4. Go back and choose **Administrative Officer II**. Nestor Abello applied from his own account: the application is **Internal**, with his current position, salary grade and campus from his record.

![Recruitment → Job openings at Main Campus](hr-job-openings.jpg)

![An opening and its applications](hr-job-opening.jpg)

### Another campus

1. Choose your name at the top right and, under **Switch campus**, choose **Sipocot Campus**. The page reloads and every list now shows Sipocot.
2. Open **Leave & approvals**. Elena Bonifacio's remote-work request is waiting there.
3. Switch back to **Main Campus** when you are done.

## How to…

### Add an employee

1. Open **Employees** and choose **Add employee** (also on the HR dashboard).
2. If the person already signs in to Learn (a teacher, registrar or dean), pick their account under **Already has an account?**. ATLAS fills in the name, email and department and links the account when you save.
3. Fill in **Personal information**. Set **Gender**: maternity and paternity leave use it.
4. Under **Employment**, enter the **Employee no.** (the next free number is suggested), **Category** (teaching or non-teaching), position, office, **Appointment status**, **Date hired** and, if you have more than one campus, the **Campus**. Pick the **Plantilla item** from the vacant items in the register, or leave it at *None* (job orders and contracts of service are not on the plantilla).
5. Under **Compensation**, pick the **Salary grade** and **Step**. The monthly salary from the salary schedule is shown beside them. For someone without a plantilla position (a job order paid by the day), leave the grade at *None (fixed rate)* and enter the **Pay type** and **Rate**. Tick **PERA** and enter RATA only for officials who receive it.
6. Tick **Flexible time (FLEX)** for someone whose clock-in and clock-out times should not affect pay.
7. Check the **Work schedule** (it starts as the default from HR settings), enter the government IDs and bank account, and choose **Create employee**.

The record opens. The employee is included in the next payroll run at that campus.

### Give an employee a sign-in account

1. Open the employee's record under **Employees**.
2. For a teacher, registrar or dean: in the **Sign-in account** card, choose **Link an existing account**, pick their Learn account and choose **Link**.
3. For non-teaching staff: choose **Create a sign-in account**, choose the **Account type** (usually *Staff: self-service only*), check the username, type a temporary password of at least 8 characters and choose **Create account**.

Give the person the username and temporary password. They sign in on the ATLAS home page and are asked to choose their own password. From then on they have self-service in People.

> **Note:** The same list of account types also creates HR managers and payroll officers. Accounts for the Finance offices (Chief Accountant, Budget Officer, Cashier, Supply & Property Officer, Approving Officer) are created, linked and changed only by an administrator, so that nobody can give themselves the power to approve payments.

> **Note:** You cannot change your own attendance, leave credits, leave adjustments, leave days, which leave you get, pay or HR details, and a payroll officer cannot adjust their own payslip. ATLAS answers *You cannot … on your own record. Ask another officer or an administrator.*

### Reset a password, disable or unlink an account

1. Open the employee's record.
2. In **Sign-in account**, choose **Reset password** to set a new temporary password (they are signed out everywhere), or **Change type or status** to change the account type or set it to *Disabled: cannot sign in*.
3. Choose **Unlink** to separate the account from the record. The account stays, but loses self-service until it is linked again. A Finance office account is unlinked by an administrator.

Reset password and Change type or status appear only for People accounts. A teacher's, registrar's or dean's password and status are managed in the Learn admin panel. A Finance office account shows *Only an administrator changes Finance office accounts.* instead. You cannot change your own account type or disable your own account.

### Edit, deactivate or move an employee

1. Open the record and choose **Edit**.
2. To stop paying someone, set **Record status** to *Inactive* and, if they left, the **Date separated**. Inactive employees are left out of new payroll runs. Someone separated after a bonus's cut-off date still gets that bonus.
3. To move someone to another of your campuses, change **Campus**. This is refused while they are in a draft payroll run at the old campus.
4. Choose **Save changes**.

**Delete employee** (at the bottom of the record) removes the record with its attendance and leave. Payslips in past payroll runs are kept. Setting the record to *Inactive* is usually the better choice.

### Record a plantilla item

Record each position as DBM approved it. ATLAS never makes up an item number.

1. Open **Plantilla** and choose **Record an item**.
2. Type the **Item number** exactly as DBM issued it, and the **Position title**. Each item number can be used once.
3. Pick the **Salary grade**. The **Authorized annual salary** shows beside it: the grade's step 1 monthly salary, from the salary schedule, × 12.
4. Pick the **Campus** (when you work at more than one) and the **Office** from Finance's list of offices, or type it when it is not there. Add the **Division** if you like.
5. Under **Fund source and PSIPOP codes**, pick the **Fund cluster** and the **Program / activity / project**, and type the **Area code**, **Area type** and **Level** as they are on the PSIPOP.
6. Leave **Status** at **Vacant**, or pick **Unfunded**. Fill in the **Date created** and the **Authority or reference** the item was created under.
7. Only if the approved item says another amount: type it under **Authorized annual salary** with the **Reason**.
8. Choose **Record item**.

The item is in the register, and its change history starts. Every change after this is in the audit log, with the value before and after.

### Link or unlink an incumbent

1. Open **Plantilla** and choose the vacant item.
2. Choose **Link an incumbent**, pick the employee and choose **Link**. The item becomes **Filled**.

The list has the active employees at your campuses who hold no other item. Job orders and contracts of service are not on the plantilla, so they are never listed. To move someone to another item (a promotion), unlink them from the first one, then link them to the new one.

To unlink, open the item and choose **Unlink**, then confirm. The item becomes **Vacant**.

You can also pick the item on the employee record: **Employees →** the person **→ Edit**, then **Plantilla item**. The list has the vacant items and the one they hold.

> **Important:** Linking an item never changes the employee's status of appointment. A temporary, casual or contractual employee on a plantilla item stays as their record says; change the appointment on the record when a new appointment is issued.

### Post a job opening for a vacant item

1. Open **Plantilla** and choose the vacant item.
2. Choose **Post a job opening**. The opening form opens with the item number, position title, salary grade, campus and office filled in.
3. Fill in the rest as in [Post a job opening](#post-a-job-opening) and choose **Save opening**.

The opening keeps the item it came from, and the item lists its openings. Marking an applicant **Selected** changes nothing on the item: link the person to it when the appointment is made.

### Mark an item unfunded or abolished

1. Open the item and choose **Edit**.
2. Pick **Unfunded** or **Abolished** under **Status**. For an abolished item, type why under **Why it is abolished**.
3. Choose **Save changes**.

An item with an incumbent must be unlinked first. An abolished item is kept for its history but left out of the register's list, its totals and the PSIPOP: pick **Abolished** or **All, with abolished** under the status filter to see it. To bring it back, set it to **Vacant**.

### Review items recorded from employee records

Before the register, the item number was typed on each employee record. ATLAS moved those numbers into the register by itself: a number that matched an item was linked to it; a number not in the register was recorded as a draft item marked **To review**, with the employee linked to it. Nothing typed was lost.

1. Open **Plantilla**. A notice says how many items are to review; choose **Show them**.
2. Choose an item. The notice on it says where it came from, for example a number typed on two records.
3. Choose **Edit**, check the item number against DBM's list, and fill in what is missing (office, fund source, date created). Choose **Save changes**.
4. Choose **Mark as reviewed**.

A draft with no incumbent whose number is not on DBM's list can be removed: **Edit → Remove draft**.

### Print the PSIPOP

1. Open **Plantilla** and pick the filters you want on the form, for example one campus or one fund source.
2. Choose **Print PSIPOP**.
3. Pick the **As of** date. The salaries follow the salary schedule in force on that date.
4. Choose **Print**, and print on **Legal** paper, **landscape**.

The form has the school's name and seal (from **Branding**), the as-of date, the rows by office, the totals, *Nothing follows*, and three signature lines. The table headings repeat on every page. To set the names on the signature lines, choose **Signatories** on the register: leave the Budget Officer and the head of agency blank to use the names in Finance's signatories.

![The PSIPOP, ready to print](hr-psipop.jpg)

### Export the plantilla

1. Open **Plantilla** and pick the filters.
2. Choose **Export CSV**.

The file has the PSIPOP's columns for every item shown, then its status, campus, office, division, fund cluster, program, date created, authority and whether it is to review.

### Correct attendance

1. Open **Attendance (DTR)**. Pick an employee and dates with **From** and **To** if you need to narrow it down.
2. Choose **Edit** on a row, or **Add record** for a day with no record.
3. Choose the **Type**: *Work (on site)*, *Remote work*, or a leave type. For work, enter **Time in** and **Time out**. Leave **Time out** blank if the person is still working; for a full remote day leave both times blank.
4. Add a note saying why, and choose **Save**.

A record with a time in but no time out shows *Open* and is not paid until it is fixed. An employee can have only one record per day. A leave day always has a leave type, so it comes off that leave's credits. You cannot add or change your own records: another HR manager or an administrator does it.

### Approve overtime

1. Open **Attendance (DTR)**.
2. In the **Overtime** column, choose **Approve** next to the minutes. Or choose **Edit** and tick **Overtime / rest-day work approved**.

Only approved overtime counts in payroll. Under government payroll it is earned as compensatory time-off unless payroll setup pays it.

### Set the campus location for clock-ins

1. Open **Clock-in locations** and choose **Set campus location** (or **Change**).
2. Stand on campus and choose **Use this device's current location**, or paste the latitude and longitude from Google Maps.
3. Set the **Radius (metres)**. 300 m covers most campuses. Set **Keep locations for (days)** (365 by default).
4. Choose **Save**.

Clock-ins farther than the radius are flagged *Away from campus*. They are never blocked. Each campus has its own location. Leave the coordinates blank to record locations without checking them.

### Check where someone clocked in

1. Open **Clock-in locations**. Pick the dates, an employee, and what to show: *All clock-ins*, *Away from campus*, *No location* or *On campus*.
2. Choose **View map** on a row for the map, the accuracy and the distance from campus, or **Details** when no location was recorded (for example *Location permission denied*).
3. Choose **Export CSV** for a file with the coordinates.

Only HR managers and administrators see locations. Approved remote-work days are shown as *Remote day*, not flagged.

### Set up the shared time clock

1. On the computer employees will use, sign in as an HR manager and open **Time clock**.
2. Leave it open. Each employee picks their name under **Employee** and chooses **Clock in** or **Clock out**. The list clears for the next person.

The times are the server's, not the computer's. The **Today** list shows who has clocked in and refreshes every minute.

![The shared time clock](hr-time-clock.jpg)

### Approve, reject or cancel a leave request

1. Open **Leave & approvals → Requests**. It shows *Pending* requests first; change the filter to see approved, rejected, cancelled or all.
2. Choose **Approve** or **Reject** on a row. Add a note to the employee if you like and confirm.
3. To undo an approved request, filter by *Approved*, choose **Cancel** on its row, then **Cancel request**. The leave or remote days are taken out of the DTR and the credits come back.

Approving writes each work day of the request into the DTR: leave days come off the balance; remote-work days count as full days. A request cannot be approved when:

- it is your own request (another approver must do it);
- the employee already has attendance on one of the days;
- the leave type needs a medical certificate and none is attached (the employee attaches it under **Leave & requests**);
- there are not enough credits left.

### Change one employee's leave

1. Open **Leave & approvals → Employee leave**, or choose **Leave** on the employee's record.
2. Pick the **Employee** and **Year**.
3. To give or take away a leave type for this person, use the **Gets it?** switch on its row. *use default* puts it back to the type's rule.
4. To set this person's yearly credits (for example a prorated new hire), choose the **Credits** number.
5. To add or take away days with a reason, such as a carry-over, choose **Adjust** (or **Adjust balance**). Each adjustment is kept with your name.
6. To add leave taken outside the system (filed on paper) to the DTR, choose **Record** (or **Record leave**).
7. To undo, choose **Remove** in the **Adjustments** or **Leave taken** list below the table.

Remaining = credits + adjustments − used − pending. Days from an approved request can only be removed by cancelling the request. If payroll for a day is already finalized, ATLAS warns you that the payslip does not change.

![One employee's leave: credits, adjustments and leave taken](hr-employee-leave.jpg)

### Manage leave types

1. Open **Leave & approvals → Leave types** and choose **Add leave type**, or **Edit** on a row.
2. Set the **Code**, **Name**, **Annual credits** (blank means no limit), whether it is **Paid leave**, **Who gets it** (everyone, or only employees you add under Employee leave), **Limited to** a gender, and **Medical certificate needed when longer than (days)**.
3. Choose **Add** or **Save**.

A leave type that has been used cannot be deleted; untick **Active** instead. Leave types are the same at every campus.

### Post a job opening

1. Open **Recruitment → Job openings** and choose **New opening**.
2. Type the **Position title** and the **Plantilla item no.** as DBM issued it.
3. Pick the **Salary grade**. The monthly salary (step 1, from the salary schedule in Payroll setup) shows under it, and applicants see it.
4. Fill in the place of assignment: the **Campus** (when you work at more than one) and the **Office**. Set the **Number of vacancies** and, if you like, a **Description**.
5. Under **Qualification standards**, fill in **Education**, **Training**, **Experience** and **Eligibility** as the CSC qualification standards for the position say.
6. Pick the **Closing date**. Applications are taken through that day.
7. Under **Who may apply**, choose **Open to all** (job applicants and employees) or **Internal only** (employees only, from People).
8. Set **Status** to **Draft** to keep working on it, or **Open** to publish it. Choose **Save opening**.

For a vacant plantilla item, start from the item instead: **Plantilla →** the item **→ Post a job opening** fills in the item number, title, salary grade, campus and office (see [Post a job opening for a vacant item](#post-a-job-opening-for-a-vacant-item)).

An open opening shows on the ATLAS home page (when it is Open to all) and under **Job openings** in every employee's People, until its closing date. To stop applications early, **Edit** it and set **Status** to **Closed**. An opening with no applications can be deleted from **Edit**; one with applications can only be closed, so they are kept.

### Change an application's status

1. Open **Recruitment → Job openings** and choose the opening.
2. On the applicant's row, choose **Change status**.
3. Pick the status: **Received**, **Under review**, **Shortlisted**, **Not selected** or **Selected**.
4. Type a **Note to the applicant** if you like, for example the date of an interview.
5. Choose **Save and tell the applicant**.

The applicant sees the status, the date of the change and your note in **My applications**, and is told on the bell. Each change is in the audit log (**People**, *Changed a job application's status*), with the status before and after. You cannot decide on your own application, nor change one the applicant withdrew.

![Change the status of an application](hr-change-status.jpg)

### Export the applications

1. Open the opening.
2. Choose **Export CSV**.

The file has each applicant's name, Internal or External, email and mobile, current position, salary grade and campus (for employees), the date applied, the status and its last change.

### Extend or remove an applicant account

People outside the school apply with a temporary **applicant account** (see [the applicant's guide](applicant)). It closes a set number of days after sign-up (365 unless changed under **HR settings → Job applicants**); the applicant is told on the bell before.

1. Open **Recruitment → Applicant accounts**. Each account shows when it signed up, until when it is open (or when a closed one will be removed), and how many applications it has.
2. To give someone more time, choose **Extend**, type the **Days to add** and choose **Extend**. The days are added to the closing date (or to today, if it has passed), a closed account opens again, and the applicant is told.
3. To remove an account now (for example when the person asks), choose **Remove** and confirm.

Removing an account, by hand or by the daily removal after it closed, takes away its sign-in and the personal details in its applications. Each application stays in the opening's list as *Removed applicant*, without a name, so the counts stay true. Extending and removing are in the audit log.

![Recruitment → Applicant accounts](hr-applicant-accounts.jpg)

### Change HR settings

1. Open **HR settings**.
2. Enter the employer **Address** and **Employer TIN** printed on payslips. The employer name is the school name set in the Learn admin panel.
3. Set the **Default work schedule** for new employee records.
4. Under **Job applicants**, set how many days applicant accounts last (30 to 1095; 365 by default), how many days before closing the applicant is warned (30 by default), and how many days after closing a closed account is removed (30 by default; 0 keeps it until you remove it).
5. Choose **Save HR settings**.

A new length applies to applicant accounts made after the change; to give one person more time, extend their account.

The **Who can do what** table below lists which account type has which power in People. It is fixed by the account type; to give someone different powers, change their account type.

### Switch campus

1. Choose your name at the top right.
2. Under **Switch campus**, choose the campus.

The page reloads and every screen follows the campus. The current campus shows in the top bar.

## Screens at a glance

| Screen | What it is for |
|---|---|
| HR dashboard | Today at a glance: headcount, who is in, late and on leave, requests to review, leave in the next two weeks, the latest payroll, birthdays |
| Employees | Employee records, CSV export, and each employee's sign-in account |
| Plantilla | The plantilla register: items as DBM issued them, their incumbents, salaries and fund sources, filters and totals, CSV export, the printable PSIPOP |
| Attendance (DTR) | Daily time records with late, undertime and overtime; add and correct records; approve overtime; CSV export |
| Time clock | The shared clock-in computer for the campus |
| Clock-in locations | Where each clock-in was made, flags for clock-ins away from campus, and the campus location |
| Leave & approvals | Requests to approve, leave balances, one employee's leave, and leave types |
| Payroll | Payroll runs and payslips (view only; the payroll officer prepares them) |
| Payroll setup | Pay rules, contributions, tax tables and the salary schedule, shared with the payroll officer |
| Job openings (Recruitment) | Post job openings at the campus, open and close them, and follow the applications to each: change their status, export them as CSV |
| Applicant accounts | The temporary accounts of job applicants: until when each is open, **Extend** and **Remove** |
| HR settings | Employer details on payslips, the default work schedule, how long applicant accounts last, and who can do what |
| My day, My attendance, Leave & requests, My payslips, My HR record, Job openings (Me) | Your own self-service, as for every employee: see [the employee guide](employee) |
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

**Does a plantilla item make an employee permanent?**
No. The item and the status of appointment are separate: linking an item never changes the appointment, and ATLAS never works out permanence from the item. A temporary or casual appointee can hold an item; the appointment on their record says what it is.

**Where do item numbers come from?**
From DBM. ATLAS records them exactly as given and never makes one up, and each number can be in the register once. ATLAS says *Item number … is already in the register* when it is typed a second time.

**Why can I not link a job order to an item?**
Job orders and contracts of service are not on the plantilla. Someone who holds an item cannot be changed to a job order either: unlink them first.

**Why is the authorized salary different from the actual one?**
The authorized annual salary is the item's: its salary grade at step 1, × 12. The actual annual salary is the incumbent's: their own salary grade and step, from their record, × 12.

**What does "To review" mean on an item?**
The item was recorded by ATLAS from an item number typed on an employee record before the register, or more than one record names it. Check it against DBM's list and mark it as reviewed (see [Review items recorded from employee records](#review-items-recorded-from-employee-records)).

**Who can use Plantilla?**
HR managers and administrators keep it (the *Plantilla* permission). Anyone who can view employee records, such as the payroll officer, can read it, export it and print the PSIPOP. An administrator can give the permission to another account type under **Roles & permissions**.

**Who sees an opening?**
An opening is shown only while its status is **Open** and until its closing date. **Open to all**: people outside the school on the ATLAS home page, and every employee in People. **Internal only**: employees only; applicants never see it, even by its address.

**How is an internal application different?**
An employee applies with their own account from **Me → Job openings**: there is no second account. The application is marked **Internal** and linked to their employee record, so you see their current position, salary grade and campus. Employee accounts never close like applicant accounts.

**Why does an opening count a "Removed applicant"?**
An applicant account is removed some days after it closes (**HR settings → Job applicants**), or when you remove it. An applicant you marked **Selected** is never removed automatically, because their details may become part of a personnel record; remove the account yourself when it is no longer needed. The application stays, without the person's details, so the number of applications stays true.

**Who can use Recruitment?**
HR managers and administrators (the *Recruitment: job openings, applications and applicant accounts* permission). An administrator can give it to another account type under **Roles & permissions**.

