---
id: registrar
title: The registrar's office in ATLAS
summary: Run enrollment, applicants and the catalog in the Admin panel, and keep student records, grades and documents in ATLAS Academic.
roles: registrar
apps: admin, academic
order: 40
---

## Before you start

This guide is for registrars and their staff. Your work happens in two places:

- **The Admin panel of ATLAS Learn**: enrollment requests and waitlists, applicants, student accounts, and the catalog (sections, courses, terms, programs).
- **ATLAS Academic**: student records, curricula, grade sheets, grade changes, document requests, reports and the academic settings.

To sign in, open the ATLAS home page and sign in with your username and password. On the home page, the **Learn** tile says *Open the admin panel*, and the **Academic** tile says *Open Academic*. You can also sign in to the Admin panel directly at `/admin`.

If you work at more than one campus, the campus you are on shows in the top bar. To change it, click your name at the top right and pick a campus under **Switch campus**. Every list (students, sections, enrollment requests, grade sheets, document requests) follows the campus you are on.

What a registrar account cannot do: change the school settings, modules and activity types (administrators do that), approve grade sheets or grade changes (the dean does that: see [the dean's guide](dean)), and add teacher accounts.

## Walkthrough

Use the demo school to try the whole job once. Sign in as `registrar.demo` (password `demo1234`). You are Rosa Villanueva, registrar at the Main Campus and at Sipocot.

### 1. Approve a request

1. On the ATLAS home page, open the **Learn** tile (*Open the admin panel*). The **Dashboard** shows the current term, whether its enrollment window is open, and counts of pending requests, waitlisted students and applicants.
2. Open **Enrollment requests**. The **Pending approval** tab lists every request waiting for you.
3. Type `Carlo` in the search box. Carlo Reyes has asked for a seat in PE101 A. Click **Approve**. He is now enrolled.

![Enrollment requests, pending approval](registrar-enrollment.jpg)

### 2. Look at a waitlist

1. Open the **Waitlisted** tab. IT210 A is full (3 of 3 seats), and four students are in line, numbered in the order they joined.
2. Click **History** on one of them to see every step of the request.

![The waitlist of a full section](registrar-waitlist.jpg)

### 3. Admit two applicants

1. Open **Applicants**. Click **Admit** next to Lea Fernandez, keep the program BSBA, and click **Admit**. She gets a student number and can sign in at once.
2. Admit Nico Valdez the same way.

![Applicants waiting to be admitted](registrar-applicants.jpg)

### 4. Look at the terms

1. Open **Terms**. You see *Demo: Previous Term* and *Demo: Current Term*, with each term's enrollment window, drop deadline and class dates. *Current* marks the term everyone sees first.

### 5. Open ATLAS Academic

1. Click **ATLAS home** in the sidebar and open the **Academic** tile. The **Dashboard** lists your work under **Waiting for you**.

![The Academic dashboard](registrar-academic-dashboard.jpg)

### 6. Post a grade sheet

1. Click **1 approved grade sheet to post** and open **ED101 P**: the dean has approved it.
2. Click **Post to records**, then **Post**. The grades are now on each student's permanent record and locked.

![An approved grade sheet, ready to post](registrar-grade-sheet.jpg)

### 7. Read a student's evaluation

1. Open **Students**, search for `Carlo` and open **Carlo Reyes**.
2. Open the **Evaluation** tab: his record compared with the BSIT 2026 curriculum, the subjects he can take next, and his back subjects.

![Carlo Reyes's evaluation](registrar-evaluation.jpg)

### 8. Print a transcript and release a request

1. On Carlo's record, open the **Documents** tab and click **Transcript of Records**. The transcript opens with a code and a QR code.
2. Click the link under the title (it ends in `/verify/` and the code): that page is what anyone sees when they check the document.
3. Open **Document requests**. Carlo's request for 2 copies of his Transcript of Records is *Requested*. Click **Record payment**, type any O.R. number and click **Record payment**.
4. Click **Start processing**, then **Ready for release**, then **Release**. Check the name under **Released to** and click **Release** again.

![Document requests](registrar-document-requests.jpg)

### 9. Download a report

1. Open **Reports**. The **Enrollment list** shows everyone officially enrolled this term.
2. Click **CHED list CSV** or **FHE billing CSV** to download the file.

## How to…

### Approve, reject or drop enrollments

1. Open **Admin panel → Enrollment requests**.
2. On **Pending approval**, click **Approve** to enroll the student, or **Reject** and add a note for the record (for example, *Missing requirements*).
3. To drop an enrolled student, open the **Enrolled** tab (or the section, or the student) and click **Drop**. Add a note if you like.

The result: the request moves to its new status, and every step is kept under **History** with who did it, when, and the note. When a seat frees up (a drop, a rejection or a withdrawn request), the first student on that section's waitlist moves up on their own. If requests need approval, the student moves up to *Pending approval* and waits for you again.

### Manage a waitlist

1. Open **Admin panel → Enrollment requests → Waitlisted**. Each section's line is shown in order; *#1 in line* is next.
2. To take a student even though the section is full, click **Enroll over capacity**, then confirm.
3. To remove a student from the line, click **Reject**.

You can also open the section under **Sections**: it lists *Enrolled*, *Pending approval*, *Waitlist (in order)*, *Completed* and *Dropped or rejected* students. Raising the section's **Capacity** (**Edit section**) moves students up from the waitlist into the new seats.

### Add a student to a section yourself

1. Open **Admin panel → Enrollment requests** and click **+ Add a student to a section** (or open the student and click **+ Add to a section**, or open the section and click **+ Add a student**).
2. Choose the **Student** and the **Section**. Fill in **Note (optional)** if useful, for example *Cross-enrollee*.
3. Tick **Override the rules: prerequisites, unit limit, schedule conflicts and a full section** only when you mean to.
4. Click **Add**.

The result: the student is enrolled without an approval step. The enrollment window and the enrollment key do not apply to you. Without the override, the other rules still apply, and a full section puts the student on its waitlist.

### Admit or decline an applicant

1. Open **Admin panel → Applicants**. Each row shows the program the person chose, when they applied, and their note.
2. Click **Admit**, check the **Program**, and click **Admit**. Or click **Decline**, write the reason (it is kept on record), and click **Decline**.

The result: an admitted applicant gets a student number and can sign in right away. People can apply only while *Student applications* is switched on under **Settings & branding**, which an administrator controls.

### Add a student account

1. Open **Admin panel → Students** and click **+ Add student**.
2. Fill in **Full name** and **Username**. Leave **Student number** blank to number the student automatically. Choose the **Program** and **Year level**, and the **Campus** if your school has several.
3. Type a **Temporary password** of at least 8 characters, and leave **Ask them to choose their own password when they first sign in** ticked.
4. Click **Save** and give the username and password to the student.

On the student's page you can **Edit** the account (or set it to *Disabled (cannot sign in)*), **Reset password**, see the full enrollment record with final grades, and link parents and guardians. To make a parent or guardian account, use **Parents & guardians → Add parent or guardian**.

### Start a term

There is no "copy last term's sections" yet: each section of the new term is added by hand.

1. Open **Admin panel → Terms** and click **+ Add term**.
2. Fill in the **Name** (for example *1st Semester 2026–2027*), **Enrollment opens** and **Enrollment closes**, **Classes start** and **Classes end**. Add a **Drop deadline** if students may drop classes themselves only until a date.
3. Leave **Status** on *Active*. Tick **Current term** now, or later when you are ready to switch everyone over (open the term with **Edit** and tick it then).
4. Click **Save**.

![Adding a term](registrar-terms.jpg)

Then open its sections:

1. Open **Sections** and choose the new term in the term list at the top.
2. Click **+ Add section**. Choose the **Course**, type the **Section** name (for example *A*), check the **Term**, and set the **Capacity**.
3. Choose the **Teacher**, the **Room**, the days under **Meets on**, and the times **From** and **To**.
4. Leave **Status** on *Open for enrollment*. Type an **Enrollment key** only if students must enter one to request the section.
5. Click **Save**. Repeat steps 2–5 for every section of the term.

The result: while the enrollment window is open, students see the open sections under *Enrollment* in Learn and can request seats. Students and teachers see the current term first.

> **Important:** Terms, and which term is current, are the same at every campus. Agree on the date with the other campuses' registrars before you tick **Current term**.

> **Tip:** When the old term is over, open it with **Edit** and set **Status** to *Archived (hidden from students)*. A term with sections cannot be deleted.

### Close, cancel or change a section

1. Open **Admin panel → Sections**, open the section and click **Edit section**.
2. Change what you need. **Status** has three choices: *Open for enrollment*, *Closed (registrar only)*, which stops students' requests but still lets you add students, and *Cancelled (drops everyone)*.
3. Click **Save**.

A teacher cannot be given two sections that meet at the same time. Once students have enrolled, the section's course and term can no longer change.

### Keep the catalog

- **Courses**: click **+ Add course**. Give the **Code**, **Title**, **Units**, the **Prerequisites (must be passed first)** and the **Programs that take this course**. A course with sections cannot be deleted; set its **Status** to *Retired (no new sections)* instead.
- **Programs**: click **+ Add program** with its **Code** and **Name**. A program with students in it cannot be deleted.

### Post a term's grades

Grades go: the teacher gives final grades in Learn and submits the grade sheet, the dean approves it (or returns it with a reason), and you post it.

1. Open **Academic → Grade sheets**. Choose **Show: Approved** to see the sheets waiting for you (or click the item on the dashboard).
2. Open a sheet, check it, and click **Post to records**, then **Post**.

The result: each grade goes to the student's permanent record and is locked. An INC gets a deadline to complete it (365 days after posting by default; see **Settings**). A sheet marked *Returned to the teacher* shows the reason; the teacher fixes it and submits again.

> **Note:** You can submit a sheet for a teacher: open a *Not started* or *Returned* sheet, tick **INC** for any student without a final grade, and click **Submit grade sheet**. The button waits until every student has a grade or an INC.

### Complete an INC or correct a posted grade

1. Open **Academic → Students**, open the student, and open the **Grades** tab.
2. Next to the subject, click **Complete INC** (for an INC) or **Change**.
3. Type the **Corrected final grade (%)**, or choose *Dropped* under **Or mark**. Write the **Reason**.
4. Click **Ask for approval**.

The result: the change waits under **Grade changes** until the dean approves or rejects it. Someone other than the person who asked must approve it. Once approved, the record is updated and the old grade stays in its history (*Changed 1×*).

### Credit a subject for a transferee

1. Open the student's **Grades** tab and click **Credit a subject**.
2. Choose the **Subject here**, type the **School where it was taken**, and add the **Code there**, the **Grade (1.00–3.00)** (leave it blank if the transcript gives none) and the **Term or year taken**.
3. Click **Credit**.

The result: the subject counts as passed in the student's evaluation and shows on the transcript as *credited from* that school. Credited grades are not counted in the GWA.

### Keep a student's record up to date

1. Open **Academic → Students**. Use the list that says **All students** to find students with *No curriculum*, *Missing requirements* or *With an INC*.
2. Open a student. On **Overview**, tick each requirement as you receive it.
3. On **Profile**, set the **Program**, **Curriculum** (only posted curricula of the program are listed), **Year level** and **Student type**, the personal details and the educational background. Click **Save**.

Every change is listed on the **History** tab with who made it and when.

### Issue a document and handle requests

1. To print a document now: open the student's **Documents** tab and click the document (Transcript of Records, Certificate of Grades, Certificate of Enrollment, Certificate of Registration, Certificate of Good Moral Character, Honorable Dismissal). Click **Print**.
2. To record a request at the window: on the same tab click **New request**, choose the **Document**, **Copies** and **Purpose**, and click **Create request**.
3. To work through requests: open **Academic → Document requests**. Move each one along: **Record payment** (type the O.R. number), **Start processing**, **Ready for release**, **Release** (type who received it). **Print** is there once a request is paid. **Cancel** asks for a reason.

The result: every printout carries a code and a QR code. Anyone can check that it is genuine at `/verify/` followed by the code.

### Build or post a curriculum

1. Open **Academic → Curricula** and click **New curriculum**.
2. Choose the **Program**, type the **Series** (the year it takes effect), and choose **Start from**: *Empty terms* or a copy of an existing curriculum. Click **Create**.
3. In each term, use **+ Add a subject…**. Add terms with **Add a term**. Fix any prerequisite warnings shown at the top.
4. Click **Post**. A posted curriculum is locked; later changes go into a new series (**New series from this**).

Deans do the same work; see [the dean's guide](dean).

### Run a report

1. Open **Academic → Reports** and choose a tab: **Enrollment list**, **Summary**, **Failing & INC**, **Dean's list** or **Graduation**.
2. Pick the **Term** and any filters.
3. Click **Print** (A4), or the CSV button: **CHED list CSV** and **FHE billing CSV** on the enrollment list, **CSV** on the others.

### Change the academic settings

Open **Academic → Settings**:

- **Grading scale**: from the final percentage to the grade, and the **Lowest passing grade** (3.00 by default). **Add a band** adds a row and **×** removes one; ATLAS refuses a scale where a higher percentage gets a worse grade, two bands start at the same percentage, or nothing starts at 0%. **Restore the default scale** puts back 1.00 to 5.00 with passing at 3.00. Click **Save scale**. Grades already posted keep the equivalent they were posted with.
- If the scale's passing line and Learn's **Passing grade (%)** (Admin panel → Settings & branding) differ, the scale shows a warning: make them the same so Learn and the permanent record agree.
- **Rules and signatory**: the INC deadline (30 to 1000 days), the dean's list rules (the "no grade lower than" rule cannot be a failing grade), the registrar's name and title on documents, and the fee for each document. Click **Save**.
- **Admission requirements**: tick the student types that must submit each one; **Add** a new one. Click **Save requirements**.
- **Colleges**: **Add college** with its code, name, dean and programs.

An administrator decides who may change these settings (Admin panel → **Roles & permissions**), and sees every change you make in the Settings center's history.

## Screens at a glance

### Admin panel (ATLAS Learn)

| Screen | What it is for |
|---|---|
| **Dashboard** | The current term and its enrollment window, pending requests, waitlists, applicants, the fullest sections, recent enrollment activity |
| **Enrollment requests** | Approve or reject requests, handle waitlists, drop students, add a student to a section, each request's history |
| **Applicants** | People who applied from the sign-in page: admit or decline |
| **Students** | Student accounts, each with their enrollment record, final grades and linked parents |
| **Parents & guardians** | Parent and guardian accounts, the students each follows, and what each may see |
| **Teachers** | Teacher accounts and their sections (view only) |
| **Sections** | Courses offered in a term: teacher, schedule, room, seats, waitlist, enrollment key, status |
| **Courses** | The catalog: codes, titles, units, prerequisites, programs |
| **Terms** | Each term's enrollment window, drop deadline, class dates, and which term is current |
| **Programs** | Degree programs students belong to |
| **School calendar** | The campus's school events, holidays, exams and term dates; add an event on a day (see [Plan the school calendar](admin#plan-the-school-calendar)) |
| **News & events** | School news posts and events on everyone's home page |
| **Campuses** | The school's campuses (view only) |
| **Modules** | What students, teachers and parents get in Learn (view only; administrators change it) |
| **Activity types & grading** | Activity types and grade weights (view only) |
| **Settings & branding** | School details, passing grade, enrollment rules, student applications (view only) |
| **Home page & systems** | The tiles on the ATLAS home page (view only) |
| **ATLAS home** | Back to the ATLAS home page and its tiles |

### ATLAS Academic

| Screen | What it is for |
|---|---|
| **Dashboard** | What is waiting for you, this term's grade sheets by status, students by program, recent activity |
| **Students** | Student records: overview, evaluation, grades, documents, profile, history; export to CSV |
| **Grade sheets** | Every class's grade sheet from submission to posting; post approved sheets |
| **Grade changes** | Rectifications and INC completions and whether each was approved |
| **Document requests** | Requests from students and the window, from requested to released |
| **Curricula** | Each program's prospectus by series: draft, posted, retired |
| **Reports** | Enrollment list (CHED and FHE CSV), summary, failing and INC, dean's list, graduation |
| **Settings** | Grading scale, INC and dean's list rules, document fees and signatory, admission requirements, colleges |

## Questions

**What does ATLAS check when a student asks for a seat?** In order: the section is open and the term's enrollment window is open today; the enrollment key matches, if the section has one; the student does not already hold a place in the same course this term; has not already passed it; has passed every prerequisite (a final grade at or above the passing grade); stays within the unit limit for the term (enrolled, pending and waitlisted classes count); and has no schedule conflict. A free seat gives *Pending approval* (or *Enrolled* when approval is off); no seat puts the student on the waitlist if waitlists are on and not full. The rules and limits are set by an administrator under **Settings & branding → Enrollment rules**.

**A student says enrollment is closed. Can I still enroll them?** Yes. Add them yourself with **+ Add a student to a section**: the window, the key and *Closed* sections do not stop you.

**Why did a student move from the waitlist to *Pending approval*?** A seat freed up and they were first in line. Because requests need approval, they wait for you to approve them.

**Can students drop classes themselves?** They can withdraw a pending or waitlisted request at any time, and drop an enrolled class until the term's drop deadline. After that, you drop it for them.

**Can I copy last term's sections into the new term?** Not yet. Add each section with **+ Add section**.

**Why can't I delete a term, course or program?** A term with sections, a course with sections or listed as another course's prerequisite, and a program with students cannot be deleted. Archive the term or retire the course instead.

**Why can't I approve a grade sheet or a grade change?** Approving needs the dean's (or an administrator's) rights, and a grade change must be approved by someone other than the person who asked for it.

**How do I fix a credited subject?** Credited subjects have no **Change** button, so check the details before you click **Credit**.

**How is the GWA worked out?** It is the average of the grades weighted by units. Credited subjects are left out.

**How does someone check a document I issued?** They scan the QR code, or open `/verify/` followed by the code printed on the document. The page shows whether the document is genuine.

**Last term's grade sheets are missing from the list.** The list shows the current term. Choose the term (or *All terms*) in **Term**. The *Waiting for approval*, *Approved* and *Returned* filters show every term.
