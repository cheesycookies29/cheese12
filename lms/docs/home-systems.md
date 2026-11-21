# Choosing a system: the ATLAS home and the Systems menu, after CORE's: analysis

CORE ERP redesigned how a person picks a module (CORE 0.40, 0.45, 0.46, 0.47 and 0.49, on the
branch the CORE work happens on). This note compares it with ATLAS, decides what ATLAS takes, and
records what it leaves out and why. Done November 2026. The user guide is
`docs/guides/getting-started.md`.

## 1. CORE today

**The CORE home ("Your modules")**, `public/js/views/launcher.js`:

| Part | What it does |
|---|---|
| Count | "5 of 5 available to you · 4 coming soon" |
| **Cards \| Compact** switch | Cards: the large cards in a sliding row (arrows, dots, swipe, arrow keys). Compact: every module at once, small tiles in a grid (four across, two on phones). The choice is kept in this browser; a phone starts in Compact |
| **Star** on each module you can open | Pins it to the front, in the order pinned; saved on the account (`PUT /api/me/favorite-modules`), so it follows you; the row is redrawn in place with focus kept on the star and a message |
| **Live figures** on each card | A few numbers from data the person may see (6 active employees, 2 pending requests, ₱53.4M open pipeline…). In Compact, the first figure (or the tagline) under the name |
| Order | Pinned → others you can open → no access → coming soon |
| **No access** card | Greyed, "No access · ask your administrator" (a module live for the company that this person may not open) |
| **Off** badge | A module turned off for the company, seen only by administrators |
| Coming soon | Greyed at the end; the executive module (C-suite) has a gold accent |
| **Integrations** | A second row: services CORE will connect to, all "Coming soon" |
| Administration | The Admin panel card and shortcut tiles (ATLAS already has this, from November) |

**The modules menu** (the grid button in every module's top bar, CORE 0.45): every module as a
small tile, three across, with a short name. Openable first (pinned ones lead, with a star; the one
you are in highlighted), then no-access and coming-soon tiles, greyed with a pill ("NO ACCESS",
"SOON"); the CORE home below.

## 2. ATLAS today

- **Home** (`public/js/hub/app.js`): "Your systems" as the same sliding cards (CORE copied the
  carousel from ATLAS), "4 of 6 available", coming-soon cards at the end. No star, no Compact view,
  no figures. Systems outside the person's audience (People for a student, for example) are not
  shown at all.
- **Systems menu** (the grid in every system's top bar, November): a plain list (name and title),
  coming-soon systems as one line of text, then ATLAS home and Help. The home page has no grid.
- Each system already counts its waiting work for its sidebar badges (enrollment requests and
  applicants, leave requests, grade sheets and document requests, vouchers and purchase requests…),
  and Learn's home knows a teacher's work to grade and a student's work to do.

## 3. What ATLAS takes

| # | CORE | In ATLAS |
|---|---|---|
| 1 | Cards \| Compact switch | The same, kept in this browser (`atlas-home-view`); phones start in Compact |
| 2 | Star to pin to the front | The same: `PUT /api/me/favorite-systems`, saved on the account (follows you), only systems you can open; kept through backup and restore (dropped when unknown) |
| 3 | Live figures | `GET /api/hub/figures`: up to three lines per system, from the routes each system already has, as the person, so nothing they may not see. Learn: sections taught and work to grade, or classes and work to do; for the registrar, enrollment requests and applicants. Academic: grade sheets and document requests waiting. People: leave requests waiting (HR), or the person's own position. Finance: vouchers and purchase requests waiting, or a student's receipts |
| 4 | Count line | "4 of 4 available to you · 2 coming soon" |
| 5 | Order | Pinned → others → coming soon |
| 6 | Compact tiles | The same tile: icon, name, first figure (or the system's title), star; coming soon greyed with a lock |
| 7 | Modules menu tiles | The Systems menu becomes the tile grid: three across, short names, pinned first with a star, the system you are in highlighted, coming soon greyed with SOON; ATLAS home and Help below. The home page gets the grid too |

## 4. What ATLAS leaves out, and why

| CORE | Why not in ATLAS |
|---|---|
| **No access** cards | In CORE a module is for everyone and access is a permission; in ATLAS a system is for some account types (a parent has no People, a student no Finance staff screens). Showing a parent a locked People card says nothing useful, so ATLAS keeps hiding systems outside the person's audience |
| **Off** badge | ATLAS turns systems off by marking them *hidden* (Admin panel → Home page & systems); administrators manage them there |
| **Gold accent** | CORE gives it to its executive module. ATLAS has no such system; the style can come with one |
| **Integrations** row | CORE's row lists services the company chose (Microsoft 365, Google Cloud, CodeRabbit). ATLAS's integrations so far are Keycloak and Cloudflare, set up by administrators under System. Which services to show the whole school as "coming soon" is a product decision for the school, not a design one: to be decided, then added the same way |

## 5. Design notes

- One set of rules for both places (`shared/systems.js` gains `orderSystems`): pinned first, in the
  order pinned, then the others, then coming soon.
- Figures are worked out on the server through the existing routes (`ctx.invoke`, as the person), so
  every permission and campus rule applies unchanged; a figure that fails is left out, never an error.
- Styles are CORE's (`.sys-pin`, `.sys-mini`, `.mod-tile`…), on ATLAS's tokens, light and dark.
