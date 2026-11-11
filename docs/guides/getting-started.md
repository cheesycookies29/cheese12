---
id: getting-started
title: Getting started with CORE
summary: Sign in, find your way around the modules, change your password, turn on 2-step verification, use CORE on a phone, and get help.
roles: admin, hr, hrstaff, payroll, it, support, sales, salesmgr, pm, employee
apps: home, system
order: 1
---

## Before you start

CORE is the ERP of Lancaster Technology and Development Corporation (LTDC). It is made of **modules**, one per part of the company's work:

| Module | What it is for |
|---|---|
| **HR & Payroll** | Employee records, time and attendance, leave and work-from-home requests, holidays and Philippine payroll. Every employee's self-service is here too: clock in, file a request, see payslips. |
| **IT Asset Management** | Laptops, devices and consumable stock: who holds what, and its history. Employees see the equipment assigned to them. |
| **IT Service Desk** | Support tickets from CORE, by email and from the public form. |
| **Sales & CRM** | Leads, accounts, contacts, the deal pipeline, public bids and contracts. |
| **Project Management** | Projects with milestones, a task board, a timeline and time logs. Anyone who is on a project opens it here, and **My work** lists their tasks. |

You sign in once and move between modules without signing in again. What you see depends on your **account type** (for example *Employee*, *HR Manager* or *Sales Officer*): a module you may not use is shown locked.

You need:

- CORE's address. On the company network or the cloud server, IT gives you the link. On a computer with the Windows program, double-click **CORE-ERP.exe** and CORE opens in the browser.
- The username and temporary password an administrator gave you.

This guide is for everyone. The guide for your own job opens from the **?** button (see [Get help](#get-help)).

## Walkthrough

This tour uses the demo data. Sign in as `employee.demo` with the password `demo1234`. That is Juan Dela Cruz, a software engineer and team lead.

1. Open CORE. Type `employee.demo` under **Username** and `demo1234` under **Password**, then choose **Sign in**.

![The CORE sign-in page](getting-started-signin.jpg)

2. The **CORE home** greets you by name, with today's date and your account type. **Your modules** has a card for each module. A module you may open shows a few live figures (for Juan: the equipment assigned to him and his open ticket) and **Open** with its name. A locked card says *No access · ask your administrator*. The cards sit in one row that slides sideways: swipe it on a phone, or use the arrows or dots beside **Your modules** (or the arrow keys once the row is selected). After the modules you may open come the locked ones, then the modules still in development, greyed out and marked *Coming soon*.

![The CORE home, with a card per module](getting-started-home.jpg)

3. Choose **Open HR & Payroll**. The module opens on your own page, **My Home**.
4. Look at the left: the **side menu** of the module. At the top is the module's name and code (*HR & Payroll · MOD-01*). Under **My account** are your own pages. Juan also sees **Approvals**, because he supervises two people. At the bottom is **Send feedback**.

![A module: the side menu on the left, and the top bar](getting-started-module.jpg)

5. Look at the top bar. On the right are, in order: the **modules** button (the grid of squares), **Help** (the question mark), the **dark mode** button (the moon) and your name.
6. Choose the **modules** button. The menu lists **CORE modules** you can open; choose one to switch to it, or **All modules** for the CORE home.

![The modules menu](getting-started-modules.jpg)

7. Choose your name at the top right. The menu shows your username and account type, **Send feedback**, **My security**, **Change password** and **Sign out**.

![The menu under your name](getting-started-user-menu.jpg)

8. Choose **Sign out**. You are back on the sign-in page.

## How to…

### Sign in

1. Open CORE's address.
2. Type your **Username** and **Password**.
3. Choose **Sign in**.

The CORE home opens. The first time, CORE asks you to choose your own password: type the temporary one, then a new one of at least 8 characters twice, and choose **Save and continue**. CORE refuses common passwords (such as *password123*) and passwords that contain your username or name.

If you use 2-step verification, CORE then shows **Enter your code**: open your authenticator app, type the 6-digit code it shows for **CORE ERP** and choose **Verify and sign in**. Without your phone, choose **Lost your phone? Use a recovery code** and type one of your recovery codes.

If your company requires 2-step verification and you have not set it up, CORE shows **Set up 2-step verification** right after your password. Follow [Turn on 2-step verification](#turn-on-2-step-verification) from step 3; **Sign out** leaves it for later, but CORE stays closed until it is done.

> **Note:** After 5 wrong passwords, your username is locked for 5 minutes, then 15, then an hour if the wrong passwords continue. Every sign-in, and every failed one, is recorded in the audit log.

### Open a module

1. On the CORE home, choose **Open** on the module's card. Or, from anywhere, choose the **modules** button at the top right and pick the module.
2. The module opens on its first page. Its pages are in the side menu on the left.

To go back to the CORE home, choose the CORE logo at the top left, or **All modules** in the modules menu.

### See your project tasks (My work)

If you are on a project, **Project Management** is one of your modules, whatever your account type.

1. Open **Project Management**. **Overview** lists the projects you are on.
2. Open **My work** in the side menu. **For you**, at the top, tells you what others did that concerns you: a task assigned to you, an @mention, a comment on your task, your task moved to done or cancelled, being added to a project. New ones are in bold; several on the same task are one line (*3 comments on …*). Open one, or click its tick, to mark it read; **Mark all read** clears them all.
3. Below are the tasks assigned to you in every project: **Overdue**, **Today**, **This week**, **Later** and **No date**. The number next to **My work** counts the overdue ones, today's and the unread **For you** ones.
4. Change a task's status in its row, or click it to open it.

Your **My Home** page in HR & Payroll also shows **My project tasks** when you have some. See [the projects guide](projects).

### Change your password

1. Choose your name at the top right, then **Change password**.
2. Type your **Current password**, then the **New password** (at least 8 characters) and type it again under **Confirm new password**.
3. Choose **Change password**.

You stay signed in on this browser and are signed out everywhere else. The new password must be at least 8 characters and cannot be a common password or contain your username or name: three unrelated words make a strong one.

### Turn on 2-step verification

With 2-step verification, signing in needs your password and a code from an app on your phone, so a stolen password alone is not enough. You need an authenticator app, for example Google Authenticator, Microsoft Authenticator or 1Password.

1. Choose your name at the top right, then **My security**.
2. Under **2-step verification**, choose **Set up 2-step verification**, type **Your password** and choose **Continue**.
3. In the authenticator app, add an account and scan the QR code. If you cannot scan it, choose to enter a setup key in the app and type the key shown under the code.
4. Type the 6-digit code the app shows under **Code from the app** and choose **Turn on**.
5. CORE shows ten **recovery codes**. Choose **Copy** or **Download** and keep them somewhere safe, away from your phone. Each one signs you in once if you lose your phone. They are shown only now.
6. Tick **I have saved my recovery codes** and choose **Done**.

You are signed out on every other device; sign in there again with a code.

![My security](getting-started-security.jpg)

> **Tip:** When few recovery codes are left, choose **New recovery codes** under **My security**. The old ones stop working. **Turn off** asks for your password and a code; it is not offered when your company requires 2-step verification.

### See where you are signed in

1. Choose your name at the top right, then **My security**.
2. **Where you are signed in** lists each browser with its network address, when it signed in and when it was last used. *This device* is the one you are using.
3. Choose **Sign out** on a row to end that session, or **Sign out everywhere else** to end all the others.

If you see a device you do not recognize, sign it out and change your password.

### Switch between light and dark

Choose the **moon** button in the top bar for dark mode, and the **sun** to go back. CORE remembers the choice on this browser. The Help pages follow it too.

### Use CORE on a phone

CORE works in the phone's browser; there is nothing to install. On a narrow screen the side menu folds away: choose the **menu** button (three lines) at the top left to open it, and tap outside it to close it. Tables become cards, one per row.

![CORE on a phone](getting-started-phone.jpg)

> **Tip:** Clocking in from a phone records where you were, if you allow location. See [the employee guide](employee).

### Get help

1. Choose **Help** (the question mark) in the top bar. The **Help & guides** page opens in a new tab, on the guide for your job in the module you were in.
2. On the left are **Help home**, this guide, **What's new**, then **Your guides** and the guides for every module.
3. To find something, type a few words in the search box at the top (or press `/`), for example *file a leave*, and press Enter. The results show the guide and section with the words highlighted.

![Help & guides](getting-started-help.jpg)

Each guide has the same parts: **Before you start**, a **Walkthrough** with the demo data, **How to…** steps for each task, **Screens at a glance** and **Questions**. Choose **Print** on a guide for a paper copy.

### Send feedback

1. Choose your name at the top right, then **Send feedback**. It is also at the bottom of every side menu.
2. Choose what kind of feedback it is, the **Module** it is about, and a short **Subject**, then say what happened or what you would like.
3. Choose **Submit feedback**. The administrators read it in their **Feedback inbox** and can reply; you see their answer on the same page.

Use it for a bug, a wrong figure, a missing feature or a confusing screen.

### Sign out

Choose your name at the top right, then **Sign out**. You are also signed out after a while without using CORE (8 hours unless your administrator changed it), after the longest session your administrator allows (24 hours unless changed), or when CORE is restarted.

## Screens at a glance

| Screen | What it is for |
|---|---|
| Sign-in page | Your username and password; the 2-step code; choosing your own password the first time |
| CORE home | Your modules in a sliding row (the ones you may open, with live figures, then the ones coming soon), and shortcuts for administrators |
| Modules menu (grid button) | Switching modules from anywhere |
| Help & guides (question mark) | The guide for your job, search, and what's new |
| Your name (top right) | Send feedback, My security, Change password, Sign out |
| My security | Change password, 2-step verification and recovery codes, where you are signed in |
| Send feedback | A message to the administrators about CORE |

The screens of each module are described in its guide: [the employee guide](employee), [approving requests](approver), [HR](hr), [payroll](payroll), [IT assets](it-assets), [the service desk](service-desk), [sales](sales), [projects](projects) and [administration](admin).

## Questions

**I forgot my password. What do I do?**
Ask an administrator. They set a temporary password in **Users & Access**, and CORE asks you to choose your own when you sign in.

**I lost my phone and my recovery codes. How do I sign in?**
Ask an administrator to reset your 2-step verification in **Users & Access**. You then sign in with your password and, if your company requires it, set it up again on your new phone.

**CORE says the code is not right, but I typed what the app shows.**
The codes depend on the time. Check that the time on your phone is set automatically, and type the code before it changes. Each code works once.

**A module is locked on the CORE home. Why?**
Your account type does not include it. If your work needs it, ask an administrator. They can change your account type or, for the service desk, the CRM and Projects, give you access to that module only. Project Management also opens for anyone a project manager adds to a project.

**Why don't I see My Home or My Payslips?**
Your sign-in account is not linked to your employee record. An administrator links it in **Users & Access**.

**Is my data private?**
Each account sees only what its job needs. Pay, government ID numbers and bank details are shown only to HR, payroll and administrators, and the numbers are masked until someone chooses to show them. Who viewed or changed personal data is recorded in an audit log, as the Data Privacy Act (RA 10173) expects.

**Which browsers work?**
Any current Chrome, Edge, Firefox or Safari, on a computer or a phone.

**Where are the dates and times from?**
From CORE's server, in Philippine time, not from your computer's clock.
