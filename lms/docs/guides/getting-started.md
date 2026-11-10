---
id: getting-started
title: Getting started with ATLAS
summary: Sign in once, open the systems your account may use, switch campus, change your password and find help.
roles: student, teacher, guardian, registrar, dean, admin, hr, payroll, accountant, budget, cashier, supply, approver, staff
apps: home
order: 1
---

## Before you start

ATLAS is your school's platform. It is made of several systems: **Academic** (records and registrar services), **Learn** (classes), **People** (HR, attendance, leave and payslips) and **Finance** (the school's accounts, and your receipts). You sign in once, on the **ATLAS home page**, and open each system from there without signing in again.

You need:

- The address of your school's ATLAS home page (for example `https://atlas.school.edu`).
- The username and password your school gave you. Students get theirs from the registrar, employees from the registrar, HR or an administrator. If your school uses Keycloak, you can use your Keycloak account instead.

This guide is for everyone. The guides for your own job are listed on the **Help & guides** page (see [Get help](#get-help)).

## Walkthrough

This tour uses the demo school. Sign in as `teacher.demo` with the password `demo1234`.

1. Open the ATLAS home page. Type `teacher.demo` under **Username** and `demo1234` under **Password**, then choose **Sign in**.
2. The home page greets you by name. Under the greeting are your account type (*Teacher*) and your campus (*Main Campus*). Below that, **Your systems** shows a tile for each system your account may use, and how many are available. When there are more tiles than fit across the screen, they move in a row: choose the arrows beside *… available* or the dots under the tiles, swipe the row on a phone or tablet, or press `Tab` until the row itself is selected and then the left and right arrow keys.

![The ATLAS home page after signing in](getting-started-home.jpg)

3. Scroll down: **Announcements** and **Upcoming events** show the school's latest news and events for your campus.
4. Choose **Open People** on the People tile. People opens straight away; you do not sign in again.

![A system: the menu button on the left, and the All systems, Help & guides, dark mode and name buttons on the right](getting-started-system.jpg)

5. Look at the top bar. On the left is the **menu** button (three lines), which folds the side menu. On the right are, in order: **All systems** (the grid of squares), **Help & guides** (the question mark), the **dark mode** button (the moon) and your name.
6. Choose **All systems**. You are back on the ATLAS home page.
7. Choose your name at the top right. The menu shows your username, account type, **Change password** and **Sign out**. An account that works at more than one campus also sees **Switch campus** here.

![The menu under your name, with Switch campus for an account at two campuses](getting-started-user-menu.jpg)

8. Choose **Sign out**. You are signed out of every ATLAS system at once.

## How to…

### Sign in

1. Open the ATLAS home page. The sign-in page shows your school's name at the top, the form under it, and the systems ATLAS opens at the bottom.

![The ATLAS sign-in page: the school's seal and name, then Username, Password and Sign in](getting-started-sign-in.jpg)

2. Type your **Username** and **Password**. Choose **Show** to see the password you typed.
3. Choose **Sign in**.

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
2. To come back, choose **All systems** (the grid of squares) in the top bar.

Administrators and registrars see **Open the admin panel** on the Learn tile, because they manage Learn instead of taking classes. A tile marked **Coming soon** cannot be opened yet.

### Switch campus

Only accounts that work at more than one campus can do this, such as a teacher with classes at two campuses, a registrar who works at both, or an administrator.

1. Choose your name at the top right.
2. Under **Switch campus**, choose the campus. A tick shows the one you are looking at.

The page reloads and says *Switched to …*. Every list in every system now shows that campus: its sections, students, news and events. On the home page you can also choose **switch** next to your campus under the greeting.

### Turn dark mode on or off

1. Choose the moon button in the top bar. The screen turns dark.
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

### Apply for admission

Some schools let new students apply on the ATLAS home page. When this is on, the sign-in card shows **New student? Apply for admission**.

1. Choose **Apply for admission**.
2. Fill in your **Full name**, **Email**, the **Campus** (when the school has more than one), **Program** and **Year level**.
3. Choose a username and a password (at least 8 characters). Add a note for the registrar if you need to.
4. Choose **Send application**.

The registrar reviews your application. Once you are admitted, you sign in with the username you chose.

## Screens at a glance

| Screen or button | What it is for |
|---|---|
| Sign-in page | The ATLAS home page before you sign in: the **Sign in** card, the Keycloak button when your school uses it, and **Apply for admission** when applications are open; **Help & guides** and **Dark mode** at the top right |
| ATLAS home page | Your greeting, account type and campus, **Your systems** (a row of tiles with arrows and dots when they do not all fit), **Announcements** and **Upcoming events** |
| Academic tile | Academic records: student records, registration, grades and registrar services. For students, teachers, registrars, deans and administrators |
| Learn tile | Classes, lessons, quizzes, attendance, grades and enrollment. For students, parents and guardians, and teachers; registrars and administrators open its admin panel |
| People tile | HR: employee records, time clock, attendance, leave and payslips. For every employee; not for students or parents |
| Finance tile | The school's accounts for the finance offices, and self-service for employees and students (for example, receipts). Not for parents |
| Facilities tile | Rooms, bookings, maintenance and property. Shown as **Coming soon** until your school switches it on |
| REX Bookstore e-Reader tile | E-books for your subjects from the REX Bookstore app's library. For students, teachers, registrars, deans and administrators; shown as **Coming soon** for now |
| All systems | The grid button in each system's top bar: back to the ATLAS home page |
| Help | The question-mark button in the top bar: the Help & guides page |
| Dark mode | The moon (or sun) button: dark or light screens |
| Your name | The menu with **Change password**, **Sign out** and, for some accounts, **Switch campus** |
| Menu button | The three lines at the top left of each system: folds the side menu to icons on a computer, or opens it on a phone |

## Questions

**I forgot my password.** Ask the registrar or your administrator to reset it; employees can also ask HR. They give you a temporary password, and ATLAS asks you to choose your own the next time you sign in. If your school signs in with Keycloak, reset your password in Keycloak.

**ATLAS says "Too many failed attempts. Try again in 5 minutes."** After 5 wrong passwords in a row, ATLAS locks that username for 5 minutes on the network the wrong passwords came from (for example the school's Wi-Fi); until then even the right password is refused there. Wait, then try again with the right password. Your school may have set other numbers. If it says *Too many wrong passwords from your network* instead, too many wrong passwords came from your network, perhaps from other people: wait the minutes it says.

**ATLAS says "Too many requests. Try again in … seconds."** ATLAS limits how many requests one person, or one network before anyone has signed in, can send in a minute. Wait the seconds it says, then reload the page or try again.

**ATLAS took me back to the sign-in page, or says "Your session has ended. Please sign in again."** ATLAS signs you out after 8 hours without any activity (your school may have set another time). You are also signed out when the ATLAS server is restarted, when someone resets your password, and on your other devices when you change your password.

**ATLAS says "This account is disabled."** The registrar or an administrator has switched your account off. Contact the registrar.

**ATLAS says "Your application is still being reviewed."** You applied for admission and the registrar has not admitted you yet. You can sign in once you are admitted.

**ATLAS says "This school signs in with Keycloak."** Your school has switched ATLAS passwords off. Choose the Keycloak button instead.

**Keycloak sent me back with "There is no ATLAS account for …".** Your Keycloak account does not match an ATLAS account. Ask the registrar (students) or HR (employees) to create your ATLAS account, with the same email as in Keycloak if your school matches by email.

**Why don't I see a system?** Each tile is shown only to the account types that use it. For example, students do not see People, and parents see only Learn. A system can also be hidden by an administrator.

**Can two people use ATLAS in the same browser?** Not at the same time. Signing in ends any other ATLAS session in that browser. Use a private window or another browser for a second person.

**I opened Academic, People or Finance and it says it is not for my account.** Each system says who it is for, for example *People is for school employees* when a student opens it. Choose **Back to ATLAS home**.
