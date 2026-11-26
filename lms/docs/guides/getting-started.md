---
id: getting-started
title: Getting started with ATLAS
summary: Sign in once, open the systems your account may use, switch campus, change your password and find help.
roles: student, teacher, guardian, registrar, dean, admin, hr, payroll, accountant, budget, cashier, supply, approver, staff, applicant
apps: home
order: 1
---

## Before you start

ATLAS is your school's platform. It is made of several systems: **Academic** (records and registrar services), **Learn** (classes), **People** (HR, attendance, leave and payslips), **Finance** (the school's accounts, and your receipts) and **Documents** (your files and the school's shared documents). You sign in once, on the **ATLAS home page**, and open each system from there without signing in again.

You need:

- The address of your school's ATLAS home page (for example `https://atlas.school.edu`).
- Your username (or your email) and password. Students get theirs from the registrar, or register themselves with **Register account** when the school allows it (see [Register as a new student](#register-as-a-new-student)); employees get theirs from the registrar, HR or an administrator. If your school uses Keycloak, you can use your Keycloak account instead.

> **Note:** Your school may show its own name and seal instead of ATLAS, for example *LA home* and *LA Learn*, with a small *Powered by ATLAS*. Everything works the same; where these guides say ATLAS, read your school's name.

This guide is for everyone. The guides for your own job are listed on the **Help & guides** page (see [Get help](#get-help)).

## Walkthrough

This tour uses the demo school. Sign in as `teacher.demo` with the password `demo1234`.

1. Open the ATLAS home page. Type `teacher.demo` under **Username or email** and `demo1234` under **Password**, then choose **Sign in**.
2. The home page greets you by name. Under the greeting are your account type (*Teacher*) and your campus (*Main Campus*). Below that, **Your systems** shows a card for each system your account may use, how many are available, and a few figures from your own work on each card (for example *2 sections you teach* and *8 to grade*; they can be up to a minute old). When there are more cards than fit across the screen, they move in a row: choose the arrows beside *… available to you* or the dots under the cards, swipe the row on a phone or tablet, or press `Tab` until the row itself is selected and then the left and right arrow keys. Choose **Compact** to see every system at once instead.

![The ATLAS home page after signing in](getting-started-home.jpg)

3. Scroll down: **Announcements** and **Upcoming events** show the school's latest news and events for your campus.
4. Choose **Open People** on the People tile. People opens straight away; you do not sign in again.

![A system: the menu button on the left, and the Systems, Quick access, Help & guides, dark mode and name buttons on the right](getting-started-system.jpg)

5. Look at the top bar. On the left is the **menu** button (three lines), which folds the side menu. On the right are, in order: **Systems** (the grid of squares), **Quick access** (the lightning bolt), **Help & guides** (the question mark), the **dark mode** button (the moon) and your name with your picture.
6. Choose **Systems**. It shows every ATLAS system as a tile: the ones you can open first (the one you are in is highlighted, and pinned ones lead with a star), then the ones coming soon, greyed. Below are **ATLAS home** and **Help & guides**. Choose **ATLAS home**: you are back on the home page.
7. Choose your name at the top right. The menu shows your picture, name and title, then **My profile**, **Add my picture**, **My security**, **Change password** and **Sign out**. An account that works at more than one campus also sees **Switch campus** here.

![The menu under your name, with Switch campus for an account at two campuses](getting-started-user-menu.jpg)

8. Choose **Sign out**. You are signed out of every ATLAS system at once.

## How to…

### Sign in

1. Open the ATLAS home page. The sign-in page shows your school's name at the top, the form under it, and the systems ATLAS opens at the bottom.

![The ATLAS sign-in page: the school's seal and name, then Username or email, Password, Sign in and Register account](getting-started-sign-in.jpg)

2. Under **Username or email**, type your username or the email address on your account (capitals do not matter). Type your **Password**; choose **Show** to see what you typed.
3. Choose **Sign in**.

Your email works only when no other ATLAS account has the same one; if it is refused, sign in with your username instead, or ask the registrar. Wrong passwords count the same whether you typed your email or your username.

**Help & guides** and **Dark mode** are at the top right of the sign-in page, so you can read this guide or switch to dark mode before you sign in; the other guides open once you are signed in. On a phone they are the question mark and the moon.

The home page opens with the tiles for your account. If you opened a system's address directly (for example `/hris/`) while signed out, ATLAS asks you to sign in on the home page and then takes you back to that system.

> **Note:** Administrators and registrars can also sign in on the admin panel's own sign-in page at `/admin`. Teachers, students and parents always sign in on the ATLAS home page.

### Sign in with Keycloak

When your school has connected ATLAS to its Keycloak account, the sign-in card shows a button above the password fields, usually **Sign in with Keycloak** (your school may have named it differently).

1. Choose **Sign in with Keycloak**.
2. Sign in on your school's Keycloak page.
3. Keycloak sends you back to ATLAS, signed in.

Your Keycloak account must belong to someone who already has an ATLAS account. The first time, ATLAS links the two, by email address or by username (your school chooses which).

If your school has also kept ATLAS passwords, the card says **or with your ATLAS password** under the button, and you can still sign in with your username and password. If passwords are switched off, only the Keycloak button is shown; the password fields are folded under **Administrator sign-in**, for administrators only.

### Open a system and come back

1. On the ATLAS home page, choose the tile, for example **Open Learn**.
2. To go to another system, choose **Systems** (the grid of squares) in the top bar, then the system, or **ATLAS home** to come back here.

Administrators and registrars also have **Administration** below their systems: the **Admin panel**, and shortcuts to the pages in it they use most. Their Learn tile says **Manage Learn**, because they run Learn instead of taking classes. A tile marked **Coming soon** cannot be opened yet.

### Pin a system to the front

1. On the ATLAS home page, choose the star at the top right of a system's card (or of its tile in **Compact**).
2. The system moves to the front of **Your systems**, and leads in the **Systems** menu at the top of every system, with a star.

![Your systems in Compact, with People pinned to the front](getting-started-compact.jpg)

Pinned systems come first in the order you pinned them, and follow you to any computer or phone. Choose the star again to unpin. Only a system you can open can be pinned.

### See every system at once

1. Beside **Your systems**, choose **Compact**. Every system shows as a small tile, in the same order, with its first figure (or what it is for) under its name.
2. Choose **Cards** for the large cards again.

ATLAS remembers your choice in this browser. On a phone, ATLAS starts in **Compact**.

### See your profile

1. Choose your name at the top right, then **My profile**. It opens in the system you sign in to (Learn for teachers, students and parents; the Admin panel for administrators and registrars; People for other staff).
2. The top shows your picture, name, title and campus. **Account** lists your username, email, account type, campuses, whether you are linked to Keycloak, and when you joined and last signed in. **Studies**, **Work** or **Children** shows your student number and program, your position and department, or your linked children, with a link to your academic record or your HR record. **What you can open** lists your ATLAS systems, each with **Open**.

![My profile](getting-started-profile.jpg)

Your **title** is your position in the school (for example *University Registrar* or *Instructor I*), given by an administrator; until then your account type shows. To correct your name or email, ask the registrar (students and parents) or HR (employees).

### Add or change your picture

1. Choose your name at the top right, then **Add my picture** (or **Change my picture**). You can also choose it on **My profile**.
2. Choose **Choose a photo** and pick a JPEG, PNG or WebP photo.
3. Frame it with **Zoom**, **Left and right** and **Up and down**.
4. Choose **Save picture**.

The picture shows in the top bar and on your profile, and administrators see it in Users & Access. It is cut to a square and made small before it is sent. It is shown only to people with a reason to see you: the school's employees, your family (a parent and their children), the teacher and students of a class you share, and someone told on the bell about something you did. To take it away, open the same window and choose **Remove my picture**.

### See where you are signed in

1. Choose your name at the top right, then **My security**.
2. **Where you are signed in** lists each browser or device with your account: which system, the network address, and when it signed in and was last used. **This device** marks the one you are using.
3. Choose **Sign out** on a row to end that one, or **Sign out everywhere else** to end all but this one.

A device you do not recognise? Sign it out, then choose **Change password** on the same page.

### See your notifications

ATLAS tells you when someone did something that concerns you: a request waiting for your decision, or a decision on your own request. Examples include your enrollment approved, your work graded, a grade sheet to approve, a leave request to decide, your payslip ready, or a voucher waiting for your step.

1. Choose the **bell** in the top bar. A red number shows how many you have not read.
2. The latest ones are listed, newest first, grouped by day. Choose one to open the page it is about; it is marked as read.
3. Choose the tick on a notification to mark it read without opening it, or **Mark all as read**. Tick **Unread only** to see only those.
4. Choose **See all notifications** for the full list, where you can filter by system (Learn, Academic, People, Finance, Documents or **Your account**) and choose **Show more** for older ones.

![The bell, with the latest notifications](getting-started-notifications.jpg)

You are never told about your own actions. Notifications are kept for 60 days. Parents are told about a child's final grades only when their link to the student shares **Grades**.

### Turn on 2-step verification

With 2-step verification, signing in needs your password and a code from an app on your phone, so a stolen password alone is not enough. You need an authenticator app, such as Google Authenticator, Microsoft Authenticator or 1Password.

1. Choose your name at the top right, then **My security**.
2. Under **2-step verification**, choose **Set up 2-step verification**, type **Your password** and choose **Continue**.
3. In the authenticator app, add an account and scan the QR code (or type the key shown under it).
4. Type the 6-digit code the app shows under **Code from the app**, and choose **Turn on**.
5. ATLAS shows ten **recovery codes**, once. Choose **Copy** or **Download**, keep them somewhere safe away from your phone, tick **I have saved my recovery codes**, and choose **Done**.

![Setting up 2-step verification on My security](getting-started-2fa.jpg)

Each recovery code signs you in once if you lose your phone. **New recovery codes** makes a fresh set (the old ones stop working). **Turn off** asks for your password and a code; it is not offered when the school requires 2-step verification for your account. If you sign in with Keycloak, Keycloak asks for its own second step instead, and ATLAS does not.

### Sign in with 2-step verification

1. Sign in with your username and password as usual.
2. ATLAS asks you to **Enter your code**. Open the authenticator app and type the 6-digit code under **Code from the app, or a recovery code**, then choose **Verify and sign in**.

A code works once and changes every 30 seconds. Lost your phone? Type one of your recovery codes instead, then set up 2-step verification again under **My security**. Each recovery code works once: typed again, ATLAS says *That recovery code was already used*, so cross it off your list and use another. Without your phone and your recovery codes, ask an administrator to reset it.

Wrong codes count for your account wherever they are typed, recovery codes too, and typing your password again does not start the count over. After a few in a row (as many as the wrong passwords that lock a username), no code is taken for a few minutes, longer each time it happens again, and you are told on the bell. The right code starts the count again.

If the school requires 2-step verification for your account and you have not set it up, ATLAS asks you to set it up right after you sign in, before anything else.

### Pin the pages you use most

1. Open a page you use often, for example your class list or **My payslips**.
2. Choose **Quick access** (the lightning bolt) in the top bar, then **Pin this page**.
3. Next time, choose **Quick access** and the page under **Pinned**, from any system.

![Quick access with two pinned pages](getting-started-quick.jpg)

Pinned pages follow you to any computer or phone; you can pin up to 12, and choose **×** beside one to unpin it. **Recent** shows the pages you opened last in this browser, and until you pin anything, **Suggested** offers a few to start with.

### Switch campus

Only accounts that work at more than one campus can do this, such as a teacher with classes at two campuses, a registrar who works at both, or an administrator.

1. Choose your name at the top right.
2. Under **Switch campus**, choose the campus. A tick shows the one you are looking at.

The page reloads and says *Switched to …*. Every list in every system now shows that campus: its sections, students, news and events. On the home page you can also choose **switch** next to your campus under the greeting.

### Turn dark mode on or off

1. Choose the moon button in the top bar (on a phone: your name, then **Dark mode**). The screen turns dark.
2. To go back, choose the sun button in the same place.

![The ATLAS home page in dark mode](getting-started-dark.jpg)

ATLAS remembers your choice in this browser, for every system. Until you choose, it follows your device's own light or dark setting.

### Change your password

1. Choose your name at the top right, then **Change password**.
2. Type your **Current password**.
3. Type the **New password (at least 8 characters)** and type it again under **Confirm new password**.
4. Choose **Change password**.

ATLAS says *Password changed.* You stay signed in here, and ATLAS signs you out on every other browser or device. The new password must be different from the old one.

![The Change password window](getting-started-change-password.jpg)

### Choose a new password the first time you sign in

When the registrar, HR or an administrator creates your account or resets your password, they give you a temporary password. The first time you sign in with it, ATLAS shows **Choose a new password** before anything else.

1. Type the temporary password under **Current (temporary) password**.
2. Type your new password (at least 8 characters) twice.
3. Choose **Save and continue**.

You cannot use ATLAS until you do this. To stop, choose **Sign out** under the form.

### Sign out

1. Choose your name at the top right.
2. Choose **Sign out**.

You are signed out of every ATLAS system in this browser, and back on the sign-in page. If you signed in with Keycloak, ATLAS also ends your Keycloak session. On a shared computer, always sign out when you finish.

### Get help

Every system has a **Help & guides** button (a question mark) in the top bar, beside the dark mode button; the ATLAS home page has one too.

1. Choose **Help & guides**.
2. The **Help & guides** page opens at the guide for your job in the system you were using.
3. To find something else, use **Search the guides** at the top (or press `/`), or choose a guide on the left: under **Your guides**, or under a system such as **ATLAS Learn**. On a phone, the menu button at the top left opens that list.

Each guide starts with a short walkthrough, then explains each task step by step, lists every screen, and answers common questions. On a wide screen, **On this page** on the right jumps to a section; on a smaller one it is a list at the top of the guide. Choose a screenshot to see it larger.

### Register as a new student

When your school lets new students register on the ATLAS home page, the sign-in card shows **New student?** and a **Register account** button under **Sign in**.

1. Choose **Register account**. **Create Student Account** opens, under your school's seal and name.

![Create Student Account: Preferred Campus, Title and First Name, Middle Name and Last Name, Email Address and Mobile Number, Password and Confirm Password, then Register student account](getting-started-register.jpg)

2. Pick your **Preferred Campus** (when the school has one campus, it is filled in for you).
3. Pick your **Title** and type your **First Name**, **Middle Name** (leave it empty if you have none) and **Last Name**, as on your birth certificate.
4. Type your **Email Address** and your **Mobile Number**, as `09XXXXXXXXX` or `+639XXXXXXXXX`. You will sign in with this email.
5. Choose a **Password** and type it again under **Confirm Password**. The eye button beside each box shows or hides what you typed.
6. Read the **Privacy Policy** (and the **Terms of Use**, when your school has them) from the line at the bottom, then choose **Register student account**.

*Registration received* opens and says what happens next.

![Registration received: the registrar reviews the registration, then the student signs in with their email](getting-started-registered.jpg)

The registrar reviews your registration. Until you are admitted, signing in says *Your application is still being reviewed*. Once you are admitted, you get a student number and sign in with your email and the password you chose. Your program and year level are set later, when you are admitted or enroll. Already have an account? Choose **Click here** at the bottom of the form to go back to signing in.

### Apply for a job at the school

When the school has job openings, the sign-in page shows **Job openings** at the top and **Looking for a job? See job openings** under the form.

1. Choose **Job openings** to read the openings without signing in.
2. Choose **Sign up to apply** and fill in your name, email, a username and a password (your mobile number is optional).
3. Tick that you have read the privacy notice and choose **Create my applicant account**.

You are signed in and can apply. Your applicant account is temporary. See [the applicant's guide](applicant) once you are signed in. If you already work at the school, do not sign up: apply with your own account from **People → Job openings**.

## Screens at a glance

| Screen or button | What it is for |
|---|---|
| Sign-in page | The ATLAS home page before you sign in: the **Sign in** card (**Username or email** and **Password**), the Keycloak button when your school uses it, **Register account** when the school lets new students register, and **Job openings** when the school has some; **Help & guides** and **Dark mode** at the top right |
| Create Student Account | **Register account**: a new student's campus, title, name, email, mobile number and password; then *Registration received* |
| Bell (top bar) | Your notifications: the latest, **Mark all as read**, **Unread only** and **See all notifications** |
| Notifications | The full list, by system and unread, with **Show more** |
| ATLAS home page | Your greeting, account type and campus, **Your systems** (cards with figures from your work and a star to pin, in a row with arrows and dots, or all at once in **Compact**), **Tools** (PDF Studio, for the account types that have it), **Administration** (administrators and registrars: the Admin panel and shortcuts into it), **Announcements** and **Upcoming events** |
| Academic tile | Academic records: student records, registration, grades and registrar services. For students, teachers, registrars, deans and administrators |
| Learn tile | Classes, lessons, quizzes, attendance, grades and enrollment. For students, parents and guardians, and teachers; registrars and administrators open its admin panel |
| People tile | HR: employee records, time clock, attendance, leave and payslips. For every employee; not for students or parents |
| Finance tile | The school's accounts for the finance offices, and self-service for employees and students (for example, receipts). Not for parents |
| Documents tile | Your files, the school's folders and what people share with you. Its figures are from your own files: received through your upload links and not reviewed, checked out to you, and shared with you this week. For every employee and student; not for parents. See [the Documents guide](documents) |
| Tools | Under your systems: **PDF Studio**, to make PDFs from documents and pictures, put PDFs together, change text and sign. For the school's employees (an administrator chooses who); also in the **Systems** menu. See [the PDF Studio guide](pdf-studio) |
| Facilities tile | Rooms, bookings, maintenance and property. Shown as **Coming soon** until your school switches it on |
| REX Bookstore e-Reader tile | E-books for your subjects from the REX Bookstore app's library. For students, teachers, registrars, deans and administrators; shown as **Coming soon** for now |
| Systems | The grid button in the top bar: every ATLAS system as a tile (yours first, pinned ones with a star, coming soon greyed), **ATLAS home** and **Help & guides** |
| Quick access | The lightning button: pages you pinned, pages you opened recently, and **Pin this page** |
| Help | The question-mark button in the top bar: the Help & guides page |
| Dark mode | The moon (or sun) button: dark or light screens |
| Your name | The menu with your picture and title, **My profile**, **Add my picture**, **My security**, **Change password**, **Sign out** and, for some accounts, **Switch campus** |
| My profile | Your account, your studies or work, and the systems you can open |
| My security | Your password, 2-step verification (turn it on or off, and new recovery codes), and the browsers and devices signed in with your account |
| Menu button | The three lines at the top left of each system: folds the side menu to icons on a computer, or opens it on a phone |

## Questions

**I forgot my password.** Ask the registrar or your administrator to reset it; employees can also ask HR. They give you a temporary password, and ATLAS asks you to choose your own the next time you sign in. If your school signs in with Keycloak, reset your password in Keycloak.

**ATLAS says "Too many failed attempts. Try again in 5 minutes."** After 5 wrong passwords in a row, ATLAS locks that username for 5 minutes on the network the wrong passwords came from (for example the school's Wi-Fi); until then even the right password is refused there. Wait, then try again with the right password. Your school may have set other numbers. If it says *Too many wrong passwords from your network* instead, too many wrong passwords came from your network, perhaps from other people: wait the minutes it says.

**ATLAS says "Too many requests. Try again in … seconds."** ATLAS limits how many requests one person, or one network before anyone has signed in, can send in a minute. Wait the seconds it says, then reload the page or try again.

**ATLAS took me back to the sign-in page, or says "Your session has ended. Please sign in again."** ATLAS signs you out after 8 hours without any activity, and 12 hours after you signed in however busy you are (your school may have set other times). You are also signed out when the ATLAS server is restarted, when someone resets your password or changes what your account may do, and on your other devices when you change your password.

**ATLAS says "This account is disabled."** The registrar or an administrator has switched your account off. Contact the registrar.

**ATLAS says "Your applicant account closed on …"** You signed up to apply for jobs, and your applicant account was open for a set number of days only. Ask the school's HR office to extend it if you still want to apply.

**ATLAS says "Your application is still being reviewed."** You registered as a new student and the registrar has not admitted you yet. You can sign in once you are admitted, with your email and the password you chose. You do not need to register again.

**ATLAS says "An account with this email address already exists."** Someone already has an ATLAS account with that email, perhaps you. Sign in with it (choose **Click here** to go back), or ask the registrar for help.

**My email does not work for signing in, but my username does.** Signing in with an email works only when exactly one ATLAS account has that email. Sign in with your username, and ask the registrar or an administrator to check the email on your account.

**What do the Terms of Use and the Privacy Policy say?** Choose them in the line at the bottom of **Create Student Account**; they open the school's own page or text. The Privacy Policy lists what the form collects (campus, title, name, email, mobile number and password) and why: to consider your registration and contact you about it. The Terms of Use link shows only when your school has written its own.

**ATLAS says "This school signs in with Keycloak."** Your school has switched ATLAS passwords off. Choose the Keycloak button instead.

**Keycloak sent me back with "There is no ATLAS account for …".** Your Keycloak account does not match an ATLAS account. Ask the registrar (students) or HR (employees) to create your ATLAS account, with the same email as in Keycloak if your school matches by email.

**Why don't I see a system?** Each tile is shown only to the account types that use it. For example, students do not see People, and parents see only Learn. A system can also be hidden by an administrator.

**Can two people use ATLAS in the same browser?** Not at the same time. Signing in ends any other ATLAS session in that browser. Use a private window or another browser for a second person.

**I opened Academic, People or Finance and it says it is not for my account.** Each system says who it is for, for example *People is for school employees* when a student opens it. Choose **Back to ATLAS home**.

**ATLAS asks for a code, and I have lost my phone.** Type one of your recovery codes in the code box. If you have none left, ask an administrator to reset your 2-step verification; you then sign in with your password and set it up again.

**ATLAS says there were too many wrong 2-step verification codes for my account.** Wait the minutes it says, then sign in again with a code from the app. If you did not type those codes, someone knows your password: once you are in, change it (**My security**), or ask an administrator to reset it.

**I got a notification that an administrator reset my 2-step verification, but I did not ask.** Tell the administrator at once, change your password (**My security**), and set up 2-step verification again.
