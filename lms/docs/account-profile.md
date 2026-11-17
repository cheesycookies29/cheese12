# Account profile, personal settings and quick access: analysis

What CORE ERP has for a person's own account, what ATLAS has, what moves to ATLAS now, and what
comes later. Done November 2026; the user guides are `docs/guides/getting-started.md` and
`docs/guides/admin.md`.

## 1. CORE today (repository root, 0.34)

| Area | CORE | Where |
|---|---|---|
| Top bar | Menu · brand · **module switcher** (grid popover: the modules you can open, Admin panel, All modules) · **bell** · Help · dark mode · your name | `public/js/app.js` 275–390 |
| Menu under your name | Picture, name, role in the company · **My profile** · **Add/Change my picture** · Dark mode (phones) · Send feedback · **My security** · Change password · Sign out | `app.js` 362–390 |
| Profile picture | Framed in the browser (zoom, position) to 256 × 256 JPEG, or an animated GIF; checked by content on the server; 300 KB (GIF 1 MB); served to signed-in people with nosniff and a sandbox policy at a dated address; admins remove any; audited | `public/js/avatars.js`, `server/api.js` 779–824 |
| My profile / anyone's profile | Header (picture, name, role in the company · department). Self and admins: account (username, account type, 2-step, since), employment (from the linked employee), what the person can open. Others: role, department, supervisor, shared projects | `public/js/views/profile.js`, `server/api.js` 832–878 |
| Role in the company | A title set by administrators only ("Employee" until set), shown in the top bar instead of the account type; audited | `shared/profile.js` |
| My security | Password; 2-step verification (authenticator app, recovery codes); where you are signed in, sign out one or all others | `public/js/views/security.js`, `/api/me/2fa*`, `/api/me/sessions*` |
| Notifications | The bell: per-person items from HR, assets, service desk, CRM, projects, feedback; polled each minute | `server/notifications.js`, `public/js/notifications.js` |
| Personal preferences | Dark mode, folded sidebar, project list density (this browser); email digest (server) | localStorage `core-*`, `user.pmDigest` |

## 2. ATLAS today

- **Top bar** (`public/js/shell.js`, the same in Learn, the Admin panel, People, Academic and Finance; the
  home page has its own copy in `public/js/hub/app.js`): Menu · brand · **All systems** (a plain link
  to the home page) · Help · dark mode · your name. The menu under your name has the name, username
  and email, account type, **Change password**, **Sign out** and **Switch campus**.
- **No profile page** for anyone but employees (People → My profile, read-only HR record), **no
  picture** (initials everywhere), **no list of your own sessions** (only administrators, in Users &
  Access), **no bell**, no title beside the account type.
- Account record (`server/admin.js` `validateUserFields`): name, username, email, account type,
  campuses, and per type the student number, program and year, department and employee number, or
  phone; the link to an employee; own access; Keycloak link.

## 3. What moves to ATLAS now

| # | Feature | In ATLAS |
|---|---|---|
| 1 | **Profile picture** | Same rules as CORE (JPEG, PNG or WebP checked by content, never SVG; 300 KB; framed to 256 × 256 in the browser), kept in the data folder beside uploads, served only to people signed in, with nosniff, a sandbox policy and a dated address. Replacing or removing deletes the old file; deleting the account deletes it; administrators can remove anyone's (audited). No animated GIFs: a school directory does not need them. |
| 2 | **My profile**, in every system | Picture, name, title · account type, campus. **Account**: username, email, account type, campuses, single sign-on, in ATLAS since, last sign-in. **School** (by account type): program, year level and student number; department and employee number; linked children for parents; the employee record (position, department, status) with a link to People. **What you can open**: each ATLAS system, with Open. Administrators see the same page for anyone, from Users & Access. |
| 3 | **Title** (CORE's "role in the company") | A position set by administrators (e.g. *University Registrar*, *Instructor I*), shown in the top bar and on the profile instead of the account type; audited. |
| 4 | **My security** | Password; where you are signed in (every system, this device marked), sign out one or all others; when you last signed in and from where. |
| 5 | **Top bar quick access** | **Systems** (the grid becomes a switcher: the ATLAS systems you can open, the home page, Help); **Quick access** (new, a lightning button): pages you pinned (kept on the server, so they follow you to any device), pages you opened recently (this browser), and suggestions until you pin any; **Pin this page**. The menu under your name gains **My profile**, **Add/Change my picture** and **My security**. The home page gets the same. |
| 6 | Admin | Title and **Remove picture** in Users & Access; pictures in its list. |

**Same in CORE:** CORE gets the **Quick access** button with the same behaviour (pinned pages on the
server, recent pages, suggestions from the modules the person can open), so both products share one
top-bar pattern.

## 4. Later (not in this change), and why

| Feature | Why later |
|---|---|
| **2-step verification** for ATLAS passwords | Changes all three sign-in pages and the home page's sign-in, and must agree with Keycloak (which has its own 2-step). Worth doing for administrators and finance staff first; CORE's `server/totp.js` can be reused as is. |
| **Notifications bell** | Needs each ATLAS system to send notices (grades posted, request approved, payslip ready, DV for approval). The sidebar counts cover the waiting work today. |
| **Anyone's profile** for everyone | A school directory shows students' (often minors') details to others; under the Data Privacy Act this needs a decision on what a student, teacher and parent may see of each other. For now only administrators open someone else's profile. |
| **Editing your own details** | Name, email and phone are records the registrar and HR keep (they appear on documents); people ask them to change them, as in CORE. |

## 5. Design notes

- **Shared pages**: `public/js/account/` (profile, security, picture dialog, quick access, systems
  switcher), added to every app by `shell.js`, as `public/js/system/` is for System.
- **Server**: `server/account.js` with routes under `/api/me/…` (any signed-in person, whichever
  system's session they have) and `/api/system/users/:id/…` for administrators.
- **Data**: `user.avatar { id, type, size, at }` (the file in `data/avatars/`), `user.title`,
  `user.quickLinks [{ href, label }]` (at most 12). The picture is not in a backup's JSON; a restore
  keeps the reference only when the file is on this server and is that picture's type (CORE's 0.32.1
  fix, applied here from the start).
- **Privacy**: pictures are served only to signed-in people; the title is public within ATLAS like
  a name; sessions show only your own.
