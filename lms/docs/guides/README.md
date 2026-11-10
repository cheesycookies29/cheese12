# ATLAS guides: how they are written and kept current

The guides in this folder are the **Help & guides** pages of ATLAS (`/help/`). They are written
here, next to the code, and ship with every release ("docs as code"), so each update of ATLAS
brings its guides with it. Administrators can edit a guide inside ATLAS; their version is kept,
and ATLAS tells them when the built-in guide has changed since.

## Keeping them current (every change)

When a change adds, renames or removes something a user sees:

1. Update the guide(s) for the people who use it (the `roles` in each guide's header), and add a
   line to `whats-new.md`.
2. If a screen changed, retake its screenshots: `npm run guides:screenshots` (or
   `npm run guides:screenshots -- teacher-gradebook.jpg` for one). It starts a throw-away server
   with the demo school and photographs every image in `screenshots.json`.
3. `npm test` checks that every sidebar item of every app is covered by a guide, that every image a
   guide shows exists and is in `screenshots.json`, that every guide has a valid header, that every
   link between guides goes to a section that exists (so renaming a heading shows which links to
   fix), that lists are one level deep and steps are numbered in order, and that the search finds
   the common questions.

## The guide format

A guide is a Markdown file with a header:

```
---
id: teacher                      # file name without .md; used in links: /help/#/teacher
title: Teaching with ATLAS Learn
summary: One sentence: what this guide helps you do.
roles: teacher                   # account types it is written for (comma-separated, see shared/roles.js)
apps: learn, people, finance     # where its screens are: home, learn, admin, academic, people, finance
order: 20                        # place in the list (lower first)
---
```

Then the body, using only this Markdown (anything else is shown as text):

- `##` and `###` headings (the title is the `#`; do not write one). Headings become links.
- Paragraphs, **bold**, *italic*, `code`, [links](https://example.org) and links to other guides
  (`[the registrar's guide](registrar)` or a section: `(registrar#posting-grades)`).
- Bullet lists (`- `) and numbered lists (`1. `), one level deep.
- Tables with `|` columns and a `|---|` line under the header.
- A screenshot on its own line: `![What it shows](teacher-gradebook.jpg)`. Every image must be
  listed in `screenshots.json` (see below).
- Callouts: a paragraph starting `> **Tip:**`, `> **Note:**` or `> **Important:**`.
- Menu paths in bold with arrows: **Admin panel → Terms → Add term**.

### How a guide is organised

Following the Diátaxis framework (tutorials, how-to guides, reference and explanation kept apart):

1. `## Before you start`: who it is for, how to sign in, what you need. Short.
2. `## Walkthrough`: a guided first tour, numbered steps someone can follow with the demo school
   (demo accounts use the password `demo1234`), with screenshots. Teaches by doing; no digressions.
3. `## How to…`: one `###` per task ("### Post final grades"), numbered steps, the result at the end.
4. `## Screens at a glance`: a table of every screen in the sidebar and what it is for.
5. `## Questions`: short answers to what people ask, and where the rule comes from when it matters
   (e.g. a COA or CSC rule).

Write for the person doing the job, in plain words, with the names exactly as the screens show them.

### Words

- **Choose** a button, link, tab or menu item (it fits a mouse and a phone; not *click*, *tap* or
  *press*). **Press** is for keys (`Enter`, `/`). **Type** text, **tick** a check box, **pick** from
  a list or a date.
- Names on the screen are in **bold**, exactly as shown, capitals included. Messages ATLAS shows are
  in *italics*. What the reader types is in `code`.
- One action per step, and say what happens ("The request shows as *Pending approval*").
- Say who can help when the reader cannot do something themselves (the registrar, HR, an administrator).
- A question in **Questions** starts in bold, as the reader would ask it or as ATLAS says it
  (`**ATLAS says "Too many requests."** …`), then the answer in the same paragraph. Each question
  is found by the search on its own, so use the words people would type.

## Search and reading without signing in

- The Help search (`server/guide-search.js`) looks in each section and each question, matches the
  start of words, and knows everyday words for the guides' words (*login* → *sign in*, *salary* →
  *payslip*). When people search for a word the guides do not use, add it to `SYNONYMS` there rather
  than to the guides.
- Signed out, people can read and search **Getting started** only (`PUBLIC_GUIDES` in
  `server/guides.js`): the sign-in pages link to Help, so everything about signing in, passwords and
  sign-in messages belongs in that guide. Do not put anything there that only signed-in people
  should read.

## Screenshots

`screenshots.json` lists every image:

```json
{ "file": "teacher-gradebook.jpg", "user": "teacher.demo", "url": "/lms/#/", "click": ["text=IT 101", "text=Grades"], "wait": 900 }
```

- `user`: the demo account to sign in as (password `demo1234`; `admin` uses `password123`).
- `url`: the page to open (path and `#/route`).
- `api` (optional): requests made as that user before the page opens, `[[method, path, body], …]`,
  e.g. `[["PUT", "/api/academic/settings", { "incDays": 180 }]]` so a history has something to show.
  Shots run in order on one server, so later shots see these changes.
- `click` (optional): Playwright selectors clicked in order after the page loads, e.g. `text=Grades`,
  `[data-tab=finance]`, `tr[data-href] >> nth=0`.
- `wait` (optional, ms): time to settle after each step (default 800).
- `viewport` (optional): `"phone"` for a 390 × 844 phone; desktop (1280 × 800) otherwise.
- `full` (optional): `true` for the whole page instead of the first screen.
- `scroll` (optional): a selector to scroll into view before the photo.

Images are saved to `public/help/img/` as JPEG.
