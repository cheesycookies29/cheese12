# ATLAS design drafts, November 2026 (Hallmark)

Drafts only, for the owner to approve. Nothing in `lms/public`, `lms/server` or `lms/shared` was changed.
Each folder is a static page that opens from disk (`index.html`, `tokens.css`, `base.css`); the only things it
loads from elsewhere are the brand marks in `lms/public/img/brand/` (by relative path) and the fonts from
Google Fonts.

| Folder | Screen | Theme | Draft states (add to the URL) |
| --- | --- | --- | --- |
| `signin/` | Sign-in page (signed out, `/`) | Almanac, in the ATLAS brand | `#error` |
| `home/` | ATLAS home, as the registrar (`/`) | Almanac, in the ATLAS brand | `#loading`, `#empty`, `#error` |
| `circulation/` | Document circulation (`/admin#/system/forms`) | Almanac, in the ATLAS brand | `#loading`, `#empty`, `#nomatch`, `#error` |
| `alt-home/` | ATLAS home, the alternative direction | Furrow, in the ATLAS brand | none |

`.hallmark/log.json` is the skill's record of these builds, so a later run does not repeat them.

## What was inferred

The owner said "go ahead", so the four questions were answered by inference:

- **Material:** the running demo school (Lancaster Academy), captured as the "before", and its real names, counts,
  form titles, dates and announcements. No photographs, quotes, logos or figures were added.
- **Audience:** registrars, HR, accountants, teachers, students and job applicants, many of them on phones.
- **Use:** get to today's work fast.
- **Tone:** institutional and austere-editorial: a records office, not a startup.
- **Genre:** editorial. The word "platform" points the skill at modern-minimal; the tone above overrode it. The
  alternative's theme (Furrow) carries modern-minimal, as dealt.
- **Kind of redesign:** "from scratch" (`references/redesign.md`): new files beside the old screens, with the old
  screens as the list of what has to be kept. That is a build, not a depth, so the stamps say `redesign: from scratch`.

## The brand, and how a school swaps it

The ATLAS brand stays: the mark (`lms/public/img/brand/atlas-mark.svg`, and `-dark` in dark mode), ATLAS
Burgundy `#5D0013`, ATLAS Gold `#C28618`, DM Sans and Newsreader. The values were read from
`lms/public/css/styles.css` `:root` and `lms/docs/BRAND.md`, then written as OKLCH in each `tokens.css`.

Each `tokens.css` starts from two variables:

```css
--brand: oklch(30.3% 0.122 19.7);       /* ATLAS Burgundy */
--brand-gold: oklch(66.4% 0.134 75.6);  /* ATLAS Gold */
```

The accent, its hover, the text that sits on it, its light wash, the link colour and the focus ring all derive from
`--brand` with relative colour syntax (`oklch(from var(--brand) …)`), in light and in dark. A school that picks its
own colour under **Settings & branding** changes `--brand` (and `--brand-gold` for a second colour) and nothing else.
`--color-accent-ink` flips between light and dark ink from the brand's own lightness, so a light school colour still
gets readable button text. Relative colour syntax needs a current browser (Chrome and Edge 119, Safari 18,
Firefox 128). When this is built, put a plain fallback value in front of each derived token.

The gold is kept small in the main direction: it is the thin rule between the mark and the wordmark, as in the
ATLAS lockup. In the alternative, gold becomes the fill of the primary key. That is a real brand question for the
owner (see the alternative below).

## The Picks blocks

### Sign-in page

**Hallmark · v2.0.0**

- **Redesign** · from scratch · 1 page (`/`, signed out) · old screen: `signInView` and `authPlate` in `lms/public/js/hub/app.js` and `lms/public/js/shell.js`
- **Before** · ATLAS's shared stylesheet lints at 220 FAIL, 409 REFLEX (static, see the sweep) · a centred bookplate on cream with tracked capitals and gold dots; the form is clear and stays first on a phone
- **Keeps** · Sign in (username or email, password with Show), Register account, See job openings, Download forms, Help & guides, Dark mode, the school's name, the ATLAS mark, "Forgot your password?", Coming soon, the copyright · every id and name the script reads (`username`, `password`, `data-toggle-pw`, `#register`, `#see-jobs`, `#see-forms`, `#jobs-link`, `#forms-link`, `#auth-theme`, `.form-error`)
- **Shape** · Index-First, named "front desk" (draw 420917 dealt Long Document; swapped because a sign-in has nothing to read at length: it is a set of doors) · genre editorial · job: sign in
- **Theme** · Almanac, dealt 2 of 3 (cool slate stock, a pale printed sheet, a 2px ink rule over it, hairlines, square corners) · palette and faces replaced by the ATLAS brand · clears Furrow and Solstice
- **Chrome** · nav: edge-aligned, the lockup (mark, gold rule, ATLAS) and four ways out · footer: a colophon block
- **Hero** · Counter (the draw dealt Corridor; swapped by the mirror test: one centred column is every sign-in page, and today's bookplate): the school's name set large on columns 1 to 6, the sign-in sheet on 8 to 12
- **Signature** · the door index: every way in (register, jobs, forms) as one ruled row under the school's name, beside the sign-in sheet
- **Sections** · Bar · Desk (masthead, sheet, door index) · Colophon
- **Material** · real: Lancaster Academy, the five systems this sign-in opens, the two coming soon, the four links · pictures: the ATLAS mark only · absent: photographs, a tagline, any figure
- **Sweep** · Floor 0 FAIL · Reflex 0 · static tier only (render tier not available) · finish review: in-thread, 2 findings, 2 answered

### ATLAS home (registrar)

**Hallmark · v2.0.0**

- **Redesign** · from scratch · app screen (`/`, signed in) · old screen: `lms/public/js/hub/app.js`
- **Keeps** · the top bar's tools (Systems, Quick links, Notifications with its count, Help, Dark mode, the account menu), the greeting, the date, role, campus and switch, term · the seven systems with their descriptions, open links, stars and the Cards/Compact view · Tools (PDF Studio, Document circulation) · Forms & downloads · Administration (Admin panel, Enrollment requests, Applicants, What's new) · four announcements · five upcoming events · every link the old screen had
- **Screen** · a day sheet (the docket of what is waiting) beside the dates ahead and Administration, then the systems as a ruled index, Tools beside Forms & downloads, Announcements in two columns · states: full, loading, empty, error (the docket)
- **Theme** · Almanac, as on the sign-in page (one system across the three screens) · nav: the project's top bar, restyled
- **Signature** · the day sheet: every count waiting for the registrar (57 enrollment requests, 11 applicants, 8 document requests, 1 grade sheet, 1 file) in one ruled docket, largest first, figures in mono, each row the way in. The greeting sits on the sheet as its date line, not above stat cards
- **Material** · real: the demo's counts, systems, forms, events and announcements · pictures: none · absent: any figure the demo does not show
- **Sweep** · Floor 0 FAIL · Reflex 0 (1 fixed: 38iii) · finish review: in-thread, 3 findings: 1 resolved, 1 answered, 1 for the owner

### Document circulation

**Hallmark · v2.0.0**

- **Redesign** · from scratch · app screen (`/admin#/system/forms`, as the registrar) · old screen: `lms/public/js/system/forms.js`
- **Keeps** · the page head and its sentence, Upload a form, the per-module figures as filters, search and the four lists, every column's facts, the Versions list (choosing one downloads it), New version and More with every menu item the form's status allows, the note under the table · `#fm-upload`, `#fm-filter`, `#fm-list`, `data-module`, `data-versions`, `data-act`, `details.fm-more`, the filter names
- **Screen** · the table on a printed sheet under a 2px ink rule; module and category share a column, size joins the current version · states: full, loading, empty, no match, error
- **Theme** · Almanac, as above · nav: the project's top bar and the Admin panel's sidebar (more than seven destinations; a menu under 60rem)
- **Signature** · the issue line: each form's versions drawn on one shared August to November 2026 axis beside its Versions list (hollow rings for earlier issues, a filled square for the current one, an open square for a draft), so the eye reads which forms changed lately and how often
- **Material** · real: the five demo forms, their codes, modules, categories, audiences, versions, notes, dates and sizes · pictures: none
- **Sweep** · Floor 0 FAIL · Reflex 0 (1 FAIL fixed: 62; WARN 49 three times: 1 fixed, the module buttons dismissed on the record) · finish review: in-thread, 3 findings: 2 resolved, 1 partial

### The alternative for the home page

**Hallmark · v2.0.0**

- **Screen** · today's entry card beside the dates ahead, the systems as keys, Forms & downloads on a white sheet beside Tools, Announcements beside Administration · state drawn: full only (it is for comparison)
- **Theme** · Furrow, dealt 1 of 3 (warm manila paper, ink rules, a notebook card on an 8px grid, moulded 6px keys) · genre modern-minimal · posture committed
- **Brand** · burgundy is the only colour type wears (links, the switch) and the focus ring; gold becomes Furrow's "fill with ink on it": the primary key, the selected tab, the next date; DM Sans throughout, Red Hat Mono for figures and dates
- **Signature** · today's entry: the registrar's five counts as one notebook page under an ink head, with the two keys that act on them (Enrollment requests, Admin panel)
- **How it differs from the main direction** · warm and tactile where the main one is cool and printed; counts in cells rather than a ranked list; systems as keys rather than a ruled index; gold carries the action instead of burgundy
- **Sweep** · Floor 0 FAIL · Reflex 0 · finish review: in-thread, 2 findings: 1 resolved, 1 for the owner

## What changed and why, gate by gate

| Gate | Today | In the drafts |
| --- | --- | --- |
| 48 colour literals (Floor) | 149 hex and rgba values past the token block in `styles.css` | every colour and face through a token; the brand is two variables |
| 7a, 7b pure white surfaces | `#ffffff` cards and fields on `#f5f5f5` | a tinted slate stock and a pale printed sheet (Almanac), tinted manila (Furrow) |
| 67 tracked capitals (Floor) | "ATLAS · SIGN IN", "THURSDAY, NOVEMBER 26, 2026 · DEMO: CURRENT TERM", the systems strip on the sign-in page, table heads (FORM, MODULE…), sidebar groups (ENROLLMENT…), "UIS/LMS" codes | sentence case in the body face; only the ATLAS wordmark stays spaced |
| 63 middle-dot meta and status dots | bylines, meta lines, "1 draft · 0 retired", gold dots between system names, bullet dots before to-dos | commas, full stops, hairline separators, columns |
| 54 eyebrows | "Ex libris" over the school's name, "TOOL-01" pills over tool names | dropped; the codes sit after the name in mono, as identifiers |
| 3 and 4 card tells | icon tiles over headings, coloured top stripes, chips inside cards, a card per system | ruled rows and tables; one surface step (the sheet) where content is a document |
| 29 glow and wash | the home hero's burgundy wash with a radial glow and a faded mark | removed; the screen opens on the work |
| 19 dashes | "Dec 5, 2026 – Dec 7, 2026" | "Dec 5 to 7" |
| 39a, 26 states | focus rings and disabled states uneven | every control: hover, focus (instant ring), active, disabled; inputs keep a constant 1px edge |
| App screens (`flow.md`) | the greeting and a hero above system cards; a carousel; table states missing | the work leads (the docket); density in tables; loading, empty, no match and error drawn |

Lines reworded or dropped (the facts are unchanged):

- Sign-in: "ATLAS · Sign in" became the sheet's head "Sign in to ATLAS". "Ex libris" dropped (54). The tracked strip "ACADEMIC • LEARN • PEOPLE • FINANCE • DOCUMENTS" became the lead "This sign-in opens Academic, Learn, People, Finance and Documents." (from the old strip and its own label, "What this sign-in opens"). The red asterisks became a visible "Required".
- Home: the hero sentence "Welcome to ATLAS, the education platform of Lancaster Academy. Choose a system to continue." dropped (the screen now opens on the work, not a welcome). "Cards" became "Detailed" (the systems are rows now). "5 available to you · 2 coming soon" became "5 systems available to you, 2 coming soon". The docket's caption, "Waiting for the registrar", is the old Enrollment requests tile's own line. "Every system" is a new in-page link to the systems list.
- Circulation: "Search title, form code, file, uploader…" became "Title, form code, file, uploader…" (a placeholder shows the format, not an instruction). Version options lost their middle dots. "Learn · Admin" became "Learn admin". Status badges became words (Draft keeps a burgundy outline as the one state mark).
- New copy, all for states ATLAS does not draw today: the docket's empty and error lines; the circulation error line and one line under each empty state.

## The sweep, honestly

- **sloplint, static tier:** 0 FAIL, 0 REFLEX, 0 WARN on all four drafts (sign-in in page scope; the rest with `--scope app`). Found and fixed along the way: REFLEX 38iii on the home page (a tool code inside its heading), FAIL 62 on circulation (the phone sidebar hidden at rest without scripting), WARN 49 three times on circulation (the account button now never wraps; the two module filter buttons wrap their counts on purpose, dismissed on the record in the stamp).
- **Waivers:** none. **Dismissed:** 49 once (circulation).
- **Render tier: not run.** `sloplint --render` needs `puppeteer-core`, which is not installed here, and nothing was installed. So the rendered gates (40 and 41 contrast as painted, 44 fold, 73 overlap, 75 small text, 77 to 79, F17 to F20, F25, F26) were not measured by the script. Instead: the screenshots were taken with Playwright and read by eye; horizontal scroll was checked at 1280 and 390 (none); the colour pairs were checked numerically (body and labels 5.5:1 to 13:1, the dark accent 6.3:1 to 8.2:1 with its text, focus rings 5.4:1 or better on every surface; gold on slate is 1.9:1 and is used only for a decorative rule).
- **Before:** `sloplint lms/public/index.html lms/public/css/styles.css --scope app` gives 220 FAIL, 409 REFLEX and 22 WARN (149 × 48, 34 × 7a, 26 × 67, 3 × 10a, 3 × 34, 351 × 24b, 55 × 7b and others). That is the whole shared stylesheet, not one screen, because the screens are drawn by script and the static tier cannot render them.
- **Finish review:** run in-thread, not in a fresh-context subagent: this session had no tool that starts a subagent. Its findings and how each was settled are in each stamp. The one finding left for the owner on the main direction: Tools (PDF Studio, Document circulation) were louder on the old home page; the drafts set them as two ruled rows.

## The material ask

- **Slots:** none. The drafts use no photographs and no stand-ins.
- **Would improve the drafts most:** a form with a long history (five or more versions over a year). The issue line was drawn on five forms with one or two versions each; a real history shows whether it earns its column.
- **Also useful:** a real school's seal and colours, to test the swap (`--brand`, `--brand-gold`) against the sign-in masthead and the docket; and a registrar's real day at volume (hundreds of requests) to check the docket's figures at width.

## What building this into ATLAS would touch

Nothing below was changed. A build would, after approval:

- **Styles:** `lms/public/css/styles.css` (`:root` and the dark block: the new tokens, the slate and sheet surfaces, `--brand` derivations; the top bar, buttons, inputs, tables), `lms/public/css/forms.css` (the circulation table and the issue line), and the sign-in block (`.auth-screen` and the plate rules).
- **Scripts:** `lms/public/js/shell.js` (`authPlate` becomes the desk; the top bar and `atlasWord`), `lms/public/js/hub/app.js` (`signInView`, the home sections: `systemCard`, `systemsCarousel` and `miniTile` give way to the index, the figures become the docket, `administration`, `toolsSection`), `lms/public/js/system/forms.js` (the table, the module filters, the issue line, the loading and error states), and the Admin panel sidebar in `lms/public/js/admin/app.js` (group headings in sentence case).
- **Brand:** `lms/shared/brand.js` presets would set `--brand` (and a second colour) instead of `--brand` and `--accent`; `lms/docs/BRAND.md` would change where it describes the bookplate, the tracked capitals and Newsreader being for sign-in pages only (the drafts use it for prose and labels in the app too).
- **Fonts:** IBM Plex Mono (main direction) or Red Hat Mono (alternative) would be bundled in `lms/public/fonts/`, as DM Sans and Newsreader are; the app does not load Google Fonts.
- **Security headers:** the drafts' small inline scripts (dark mode, the password toggle) would move into the app's own files or be added by hash, as the server allows inline scripts only by their exact hash.
- **Guides (same commit, per `CLAUDE.md`):** `lms/docs/guides/` for every role that sees these screens, a line in `whats-new.md`, and new screenshots (`getting-started-sign-in.jpg`, `getting-started-register.jpg`, `getting-started-home.jpg`, `getting-started-compact.jpg`, `home-tools-circulation.jpg`, `registrar-document-circulation.jpg`, `admin-document-circulation.jpg`, `hr-document-circulation.jpg`, `accountant-document-circulation.jpg`, and others that show the top bar), then `cd lms && npm test`.
- **States ATLAS has no logic for yet:** the home docket's loading, empty and error states; the circulation table's loading and error states (today a failed load falls to the app's general error). The empty and no-match states exist in `forms.js` today.
