# CORE guides: how they are written and kept current

The guides in this folder are the **Help & guides** pages of CORE (`/help/`, the **?** button in the
top bar). They are written here, next to the code, and ship with every release ("docs as code"), so
each update of CORE brings its guides with it. Administrators can edit a guide inside CORE; their
version is kept, and CORE tells them when the built-in guide has changed since.

## Keeping them current (every change)

When a change adds, renames or removes something a user sees:

1. Update the guide(s) for the people who use it (the `roles` in each guide's header), and add a
   line to `whats-new.md`.
2. If a screen changed, retake its screenshots: `npm run guides:screenshots` (or
   `npm run guides:screenshots -- hr-dtr.jpg` for one). It starts a throw-away server with the demo
   data and photographs every image in `screenshots.json`.
3. `npm test` checks that every sidebar item of every module is covered by a guide, that every image
   a guide shows exists and is in `screenshots.json`, and that every guide has a valid header.

## The guide format

A guide is a Markdown file with a header:

```
---
id: hr                           # file name without .md; used in links: /help/#/hr
title: Running HR in CORE
summary: One sentence: what this guide helps you do.
roles: hr, hrstaff               # account types it is written for (comma-separated, see shared/roles.js)
apps: hr                         # modules its screens are in: home, hr, assets, helpdesk, crm, projects, system
order: 30                        # place in the list (lower first)
---
```

Then the body, using only this Markdown (anything else is shown as text):

- `##` and `###` headings (the title is the `#`; do not write one). Headings become links.
- Paragraphs, **bold**, *italic*, `code`, [links](https://example.org) and links to other guides
  (`[the payroll guide](payroll)`) or a section (`(payroll#finalize-a-payroll-run)`).
- Bullet lists (`- `) and numbered lists (`1. `), one level deep.
- Tables with `|` columns and a `|---|` line under the header.
- A screenshot on its own line: `![What it shows](hr-dtr.jpg)`. Every image must be listed in
  `screenshots.json` (see below).
- Callouts: a paragraph starting `> **Tip:**`, `> **Note:**` or `> **Important:**`.
- Menu paths in bold with arrows: **HR & Payroll → Payroll → New payroll run**.

### How a guide is organised

Following the Diátaxis framework (tutorials, how-to guides, reference and explanation kept apart):

1. `## Before you start`: who it is for, how to sign in, what you need. Short.
2. `## Walkthrough`: a guided first tour, numbered steps someone can follow with the demo data
   (demo accounts use the password `demo1234`), with screenshots. Teaches by doing; no digressions.
3. `## How to…`: one `###` per task ("### Finalize a payroll run"), numbered steps, the result at the end.
4. `## Screens at a glance`: a table of every screen in the sidebar and what it is for.
5. `## Questions`: short answers to what people ask, and where the rule comes from when it matters
   (e.g. the Labor Code, a DOLE advisory or the Data Privacy Act).

Write for the person doing the job, in plain words, with the names exactly as the screens show them.

## Demo accounts

Load the demo data under **Admin panel → Demo data**. It adds these accounts (password `demo1234`):

| Account | Type | Who |
|---|---|---|
| `hr.demo` | HR Manager | Maria Santos, HR Manager, who supervises Juan, Andrea and Ramon |
| `payroll.demo` | Payroll Officer | not linked to an employee |
| `it.demo` | IT Asset Manager | also works service desk tickets |
| `sales.demo` | Sales Manager | Sales & CRM |
| `pm.demo` | Project Manager | Andrea Villanueva, who runs the delivery projects (LMS phase 2, the Meridian payroll rollout, the provincial helpdesk bid) |
| `employee.demo` | Employee | Juan Dela Cruz, Software Engineer and team lead of Mark and Kristine; a member of two projects |

The screenshot script also creates the first administrator, `admin` (password `Guide-Shots-2026`).

## Screenshots

`screenshots.json` lists every image:

```json
{ "file": "hr-dtr.jpg", "user": "hr.demo", "url": "/#/dtr", "click": ["text=Edit >> nth=0"], "wait": 900 }
```

- `user`: the demo account to sign in as (password `demo1234`; `admin` uses `Guide-Shots-2026`).
- `url`: the page to open (path and `#/route`).
- `api` (optional): requests made as that user before the page opens, `[[method, path, body], …]`,
  e.g. `[["POST", "/api/payroll-runs", { "periodStart": "…" }]]` so a list has something to show.
  Shots run in order on one server, so later shots see these changes.
- `click` (optional): Playwright selectors clicked in order after the page loads, e.g. `text=Approve`,
  `#add`, `tr[data-href] >> nth=0`.
- `wait` (optional, ms): time to settle after each step (default 800).
- `viewport` (optional): `"phone"` for a 390 × 844 phone; desktop (1280 × 800) otherwise.
- `dark` (optional): `true` for dark mode.
- `full` (optional): `true` for the whole page instead of the first screen.
- `scroll` (optional): a selector to scroll into view before the photo.
- `fresh` (optional): `true` on the first shot of a group starts a new server with fresh demo data,
  so one guide's changes (payroll runs created, requests approved) do not affect another's. Within
  a group, shots run in order and see each other's changes.

Some groups create payroll runs for fixed periods (October and November 2026). The demo has
attendance for the six weeks before the day the script runs, so move those dates forward when you
retake the payroll screenshots later.

Name each image after its guide: `hr-dtr.jpg`, `payroll-year-to-date.jpg`. JPEGs, taken at 1280 × 800.
