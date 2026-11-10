# ATLAS email art: the prospectus, November 2026

A general set about ATLAS in a new look: a printed school prospectus, built around the "Ex libris"
bookplate of the sign-in page. Ten panels for email and slides, and three extras.

| Panel | |
| --- | --- |
| `g01` | Cover: *One school. One sign-in.* with the sign-in bookplate |
| `g02` | What is inside: the four systems as an index (Academic, Learn, People, Finance) |
| `g03` | Learn: the week at a glance (student home) |
| `g04` | People and Finance: from clock-in to the voucher, with the demo school's October 16–31 payroll |
| `g05` | Finance: the school's books (dashboard, dark mode) |
| `g06` | Who it is for: a directory of roles and the systems each uses |
| `g07` | Colophon: what ATLAS is built on, the eight checks on every request, four figures |
| `g08` | On a phone: sign-in, a parent's calendar, a teacher's My day |
| `g09` | Forthcoming: the roadmap |
| `g10` | Close: sign-in address to be announced |

| Extra | |
| --- | --- |
| `extras/x01` | A header banner for the top of an email (1250 × 300) |
| `extras/x02` | A footer strip (1250 × 170) |
| `extras/x03` | A square teaser for chat or social posts (1080 × 1080) |

- `ATLAS_prospectus_November_2026.pdf`: the ten panels, one per page.
- `png/`: each panel at 2× (2500 px wide). `extras/`: PNG at 2× and JPEG at 1×.
- `email/`: each panel as a 1250-px JPEG (55–130 KB).
- `email.html`: an email body with the panels in order, each with alt text. Upload the `email/` images
  (or attach them inline) and change the `src` addresses before sending.
- `panels.html`: the source. Edit the text there and re-render: open it in Chromium and screenshot each
  `section.panel` at 2×. Fonts come from `public/fonts/`, marks from `../assets/`, screens from `screens/`
  (the demo school; `screens/shots.mjs` retakes them on a throw-away server).

To fill in before sending: the sign-in address (`g10` says "to be announced").

## The look

The direction came from a Taste Engine search for *editorial, academic, print* references (magazine and
prospectus sites: warm paper, serif headlines with italic emphasis, hairline rules, flat colour blocks) and
its design rubric, which was used to check the panels against the usual tells of generated design.

- **One idea per panel.** Each is laid out for its content: an index, a ledger, a directory, a colophon, a
  publisher's list. No repeated "label, title, paragraph, cards" template.
- **Paper and ink, four flat colours.** One per system: navy (Academic), burgundy (Learn), forest (People),
  ochre (Finance). No gradients, no shadows, square corners.
- **Type does the work.** Newsreader for headlines (italic for emphasis), DM Sans for text, Big Shoulders
  for numerals. No icon tiles, no pills, no cards with a coloured edge.
- **The whole page is used.** Colour blocks and screens run to the edges; text sits on a 12-column grid
  (60 px margins, 20 px gutters).
- **A running head** on every panel ("No. 3 of 10"), as in a printed booklet.

## Facts behind the claims

Checked against the code and the demo school on 10 November 2026.

- `g04`: the demo school's Main Campus payroll for October 16–31, 2026: 28 employees, gross ₱558,451.49,
  deductions ₱105,033.37, net ₱453,418.12 (People → Payroll).
- `g07`: no dependencies in `package.json`; 400 `route(…)` declarations in `server/`; 129 tests
  (`npm test`); Node.js 22 on new servers (`deploy/aws/install-node.sh`); scrypt and AES-256-GCM
  (`server/auth.js`); the eight checks are those of `../2026-11-security/` (see its README).
- `g09`: the roadmap is the one in `../2026-11/` (`p11`).
- The set does not say that ATLAS has no vulnerabilities or that it was tested independently.
