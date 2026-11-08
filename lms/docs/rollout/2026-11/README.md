# ATLAS rollout: concept art, November 2026

The second set, after the first one (`../`, made for the launch of Learn, People and Academic). Same look,
updated to everything ATLAS does now: Finance, government payroll sent to Finance, the school calendar,
the Settings center and roles, Help & guides, the REX Bookstore e-Reader (coming soon), how it relates to
CORE, and what it is built on.

| Panel | |
| --- | --- |
| `p01` | Hero: *One school. One sign-in.* Learn, Academic, People, and new Finance and Calendar |
| `p02` | What's inside: four systems (Learn, People, Academic, Finance) and what runs across all of them |
| `p03` | CORE and ATLAS: CORE's HR & Payroll engine inside ATLAS People, one design language, built the same way; shared code, not shared data |
| `p04` | People → Finance: government payroll from clock-in to the obligation request, voucher and remittances (demo school figures) |
| `p05` | Finance: budget, procurement and property, paying and collecting, books and reports |
| `p06` | The school calendar |
| `p07` | For administrators: Settings center, history and undo, roles and permissions, guides |
| `p08` | For everyone: students, parents, faculty, registrar and deans, HR and payroll, finance offices |
| `p09` | Under the hood: the backend (Node.js with no outside packages, JSON data store, Caddy, Keycloak, tests, backups, where it runs) |
| `p10` | On your phone, light and dark |
| `p11` | Roadmap: REX Bookstore e-Reader (coming soon), Facilities, fees and assessment, scheduling, scholarships |
| `p12` | Sign-in: address to be announced |

- `ATLAS_by_Lancaster_November_2026.pdf`: all panels, one per page (for slides or printing).
- `png/`: each panel at 2× (2500 px wide), for decks.
- `email/`: each panel as a 1250-px JPEG (40–160 KB), for email.
- `email.html`: an email body with the panels in order, each with alt text. Upload the `email/` images
  (or attach them inline) and change the `src` addresses before sending.
- `panels.html`: the source. Edit the text there and re-render: open it in Chromium and screenshot each
  `section.panel` at 2×, or print to PDF. Fonts come from `public/fonts/`, marks from `../assets/`, screens
  from `screens/` (the demo school, *Lancaster Academy*; `screens/shots.mjs` retakes them from a demo server).

To fill in before sending: the launch date and the sign-in address (`p12` says "to be announced").

Facts behind the claims (checked against the code in November 2026): 112 settings in the Settings center;
over 100 automated tests (`npm test`); about 30,000 lines in `server/`, `shared/` and `public/js/`; no packages
in `package.json`; Node.js 18 or later; nightly data copies kept 30 days and daily disk snapshots kept 7
(`deploy/aws/`); Keycloak sign-in with PKCE (`server/sso.js`). The payroll figures on `p04` are the demo
school's October 16–31 run.
