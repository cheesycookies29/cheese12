# Benchmark: the current CBSUA LMS, LTDC LMS, and open-source LMSes

Reviewed on 1 November 2026 by signing in to the current system (`lms2.cbsua.edu.ph`, release 2.1.260903) as a super administrator and **only viewing** pages. Nothing was created, changed or copied from it; no personal data from it appears in this repository.

## 1. The current system at a glance

**Stack:** Nuxt (Vue) + Tailwind, Inter font, heroicons; Keycloak single sign-on.

**Layout (the part we keep as the basis):**
- White top bar: school seal, "Learning Management System", the current semester ("First Semester A.Y. 2025-2026"), chat and dark-mode buttons, the user's name and email.
- Left sidebar with an icon per item; a hamburger collapses it.
- Breadcrumb pills above each page.
- A **class page** with a header card (subject code and title, units/hours, block section) beside a **professor card** (avatar, name, email, message button), then large tabs: *Lessons, Resources, Activities, Students*.
- Cards with drag handles to reorder lessons, resources and activities; edit / copy / delete icons on each.

**Features seen:**

| Area | What it has |
| --- | --- |
| Home | Campus name, mission and vision, events, a news feed |
| Classes | Classes grouped by **teacher** (accordion), each with its subjects (schedule code, subject code, block section); *View* and *Copy* |
| Lessons | Title, text, attachments; reorder; copy |
| Resources | Files and links with type filters (PDF, video, image, link, document, audio, spreadsheet, presentation), preview pane |
| Activities | Types set by the admin (Article Review, Short Quiz, Long Quiz, Examination); time limit; start and close date-time; copy |
| Students | Class list with attendance today and grade; monthly **attendance** grid (Present, Late, Absent, Excused) with CSV export |
| Guardians | Guardian self-registration, binding requests to students (approve/reject), guardian monitoring |
| News feed | Posts with reactions (👍 ❤️ 😂) and comments |
| Events | Title, description, date range and times |
| Chat | Direct and group conversations |
| Control panel | Users (91 accounts: students, teachers, administrators, guardians), activity types |

## 2. Where it is weak (and what we do instead)

| Weakness in the current system | LTDC LMS |
| --- | --- |
| **Inconsistent branding**: green landing and login, then a blue app with purple, yellow and grey tabs | One brand colour everywhere, chosen by the admin (presets or the school's own colour) plus the school's logo |
| **Home page is not actionable**: mission, vision and news, but nothing to do | A **To-do** list (open quizzes, work due, overdue), today's classes, upcoming events, news, class progress |
| **No enrollment**: classes come pre-assigned by "block section" | Full enrollment: catalog, prerequisites, unit limits, schedule-conflict checks, enrollment keys, waitlists that move up automatically, registrar approval, applications |
| **Classes listed by teacher** (an admin view shown to everyone) | Students see *their* classes; teachers see *their* sections; admins see sections by term |
| Breadcrumbs that repeat ("Home › Home"); raw timestamps ("14:50:00"); raw byte sizes ("49672"); emoji used as icons | Readable dates ("Sep 17, 2:50 PM"), sizes ("48.5 KB"), consistent icons |
| Activity types are labels only | Activity types carry **grade weights** (e.g. quizzes 30%, exams 40%) used by the gradebook |
| Students tab shows "Grade: –", no gradebook | Gradebook with weighted running grade and final grades that feed prerequisites |
| Activities card shows when it was created, not what the student must do | Status per student: *To do, Submitted, Scored, Missed*, attempts left, time limit |
| Modules cannot be switched per role | Each module switched on/off for students and teachers separately, enforced by the server |

## 3. What other open-source LMSes do well (and what we took)

| Project | Idea | In LTDC LMS |
| --- | --- | --- |
| **Moodle** ([quiz docs](https://docs.moodle.org/34/en/mod/quiz/config)) | Quizzes with many question types, a countdown that submits automatically, several attempts graded by the highest | Quizzes: single/multiple choice, true/false, short answer, essay; time limit enforced by the server; attempts; highest attempt counts |
| **Moodle** (self-enrolment) | Enrollment key, window, seat limit | Already in the enrollment module |
| **Canvas** ([instructure/canvas-lms](https://github.com/instructure/canvas-lms)) | Student To-do list; grading one student after another | To-do on Home; grading screen steps through submissions |
| **Open edX** ([course outline](https://docs.openedx.org/en/ulmo/educators/concepts/open_edx_platform/about_course_outline.html)) | Progress: completed items ticked, a progress view per course | Progress bar per class (activities done / total) |
| **Chamilo** ([chamilo/chamilo-lms](https://github.com/chamilo/chamilo-lms)) | Attendance usable in the gradebook | Attendance with monthly grid, CSV, per-student rate |
| **Frappe Learning** (`frappe/lms`) | Courses → lessons, quizzes, batches | Lessons and quizzes per section |
| **Gibbon** | Modules granted per role | Module switches for students and teachers |

## 4. Roadmap

**This round (0.2):** redesign on the current system's layout; themes and logo; dark mode; quizzes and exams with auto-grading and results; activity types with grade weights; attendance; class resources with file uploads and preview; school news (reactions, comments) and events; student To-do.

**Next:**
1. **Guardians**: guardian registration, binding requests, read-only view of a child's grades, attendance and work (the current system has this).
2. **Messages**: direct and class group chat (the current system has this).
3. **Single sign-on** with Keycloak (OIDC), as the current system offers.
4. Question banks and random questions per student; copying lessons and activities between sections.
5. Email notifications; certificates; analytics per class and per program.
6. Move storage to PostgreSQL (Amazon RDS) and files to S3 for AWS.
