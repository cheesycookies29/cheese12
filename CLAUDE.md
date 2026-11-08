# Working in this repository

Two apps live here: the Lancaster ERP (repo root) and **Lancaster ATLAS** (`lms/`), the school
platform (ATLAS home, Learn, Admin panel, Academic, People, Finance).

## ATLAS: keep the user guides current with every change

ATLAS has in-app **Help & guides** (`/help/`), written in `lms/docs/guides/` (one Markdown file per
kind of user; format and process in `lms/docs/guides/README.md`). They ship with the code, so they
must change in the same commit as the feature:

1. A change a user can see (new screen, button, rule, renamed label) → update the guide(s) for the
   roles who use it, and add a line to `lms/docs/guides/whats-new.md` (newest first).
2. A screen that looks different → retake its screenshots: `cd lms && npm run guides:screenshots -- <file.jpg>`
   (all: `npm run guides:screenshots`). New images go in `docs/guides/screenshots.json`.
3. `cd lms && npm test` must pass: `test/guides.test.js` fails when a sidebar item has no guide, an
   image is missing, or a guide's header or sections are wrong.

Administrators can edit guides in ATLAS; their version is kept and they are told when the built-in
guide changes, so improve the built-in guides freely.

## Other conventions

- Develop on the branch you are given; end commit messages with the attribution lines given in the session.
- `cd lms && npm test` before committing. No dependencies beyond Node's standard library (Playwright only for the screenshot script and browser checks).
