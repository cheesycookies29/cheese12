## Advocate Final Position: YEP 2026 Registration & Table Assignment as CORE "CUSTOM APP"

**Revised recommendation:** Keep the three surfaces from Round 1, which are a tiny standalone guest page, a phone-first "My queue" for Event staff, and an "Event control" screen for the Super Administrator. They now sit on the council's converged mechanics:
- one synchronous `commit()` per event;
- one status-agnostic `claimsAt(table)`;
- `reserved` and `confirmed` claims only, with no holds;
- short polling paced by a server-supplied `pollMs`;
- kill-switch flags;
- a dashboard in its simple form.

Every one of those mechanics has to show up to people in one of two ways. A guest sees a calm sentence that sends them to the desk with a code. A staffer sees a recovery screen that already holds fresh options. Neither ever sees a bare error, a lock screen or a 429. The earlier launch blocker still stands: the current anonymous limits (`server/api.js:558-562`, applied at 1445/1447: 120 GETs/min and 20 writes/hour **per IP**) would refuse real guests who share the venue's NAT address. Event routes therefore need their own buckets, keyed per event and per surname, and the single-IP load test has to show zero 429s to real guests.

**Concessions made:**

1. **No holds. The meter shows two states.** Scout and Strategist are right. A single-request staff commit has no checkout window to protect, and a hold that a staffer leaves parked while talking to a guest would block the last seat at the arrival peak. In Round 1 the 10-dot meter had "ring = reserved/held". It now reads **filled = confirmed (seated)** and **ring = reserved (preferred, waiting)**. The tile's text label repeats the counts ("6 seated · 2 reserved · 2 free"), so colour and shape are never the only cue. A lost last seat is the 409 `seat_taken` recovery I specified, re-ranked in place.
2. **Skeptic's cap numbers, counted my way.** The per-surname soft cap is **8 distinct wrong last-4 values per (event, normalised surname) in 15 minutes**. It clears itself after 15 minutes, and any staffer can clear it in one tap from the referral record. Retyping the same wrong value counts once. A capped surname gets the same uniform desk reply as every other failure.
3. **Exact matching on the normalised form, with no fuzzy matching on the public page.** Lenient canonicalisation still applies: NFKD, strip diacritics, lowercase, drop spaces, hyphens, periods and apostrophes, strip Jr./Sr./III, and match `altSurnames[]`. Edit distance, partial surnames and first-name fallback stay behind staff sign-in, in assisted search.
4. **Pre-event collision report (Skeptic's condition), built as an onboarding screen.** It appears as the "Import check" step in Setup, described in the implementation notes.
5. **No presence key and no desk code in the Must list.** The activation window, enforced on the server, is the real control against remote spoofing. I still oppose a typed desk code that every guest has to enter. If Strategist finds an XS slot after the 5 Dec load test, my preference is a zero-typing key in the QR URL (`/event/yep26?k=…`) that the Super Administrator can rotate. Otherwise both stay Won't for 9 Dec.
6. **Short polling, not long-poll or SSE.** The status page and queue use `pollMs` from the poll response (about 4 s while a guest waits, 10 s once seated, staff 3 s), pause on `visibilitychange`, and back off while offline. "Feels live" means a status that is honest about how old it is ("Updated 6:41 PM", "Last updated 2 s ago"). It does not need push.
7. **Event control is built in its simple form.** I accept Strategist's fallback dashboard: a counts row, an occupancy grid and the event-health strip. My per-staffer workload panel becomes a plain sortable table (staffer · waiting · longest wait · last active). The "Redistribute pending…" wizard becomes a per-guest or per-table "Move to…" action. Bulk redistribution is a follow-up.
8. **Email can fall back to "display + verbal" on 3 Dec.** If email is cut, the status page and the printed A–Z list carry the table number. The guest page then drops the "email sent" line and adds "Screenshot this screen". The seat is never blocked or delayed by email in either case.
9. **No QR redirect for failover, and no persisted sessions.** During a failover, guests go to staff-assisted check-in. What I need in exchange is cheap, and it is listed under implementation notes: easel copy, a desk card with the standby URL, and staff told that a restart signs them out.
10. **Where the event data lives.** Architect wants a per-event store and Operator wants the shared `db.json` with per-event import. This is not my call. My one user-facing requirement is that **no recovery action may erase check-ins people have already seen**. A guest told "Table 5" must not be told something else after a restore. Whichever option wins, replaying the journal has to come before staff resume.

**Non-negotiables:**

1. **No guest-facing dead end.** Every public failure (no match, ambiguous, capped, malformed, unlisted, released reservation) returns identical copy, layout and status code, plus a random referral code: "Please see the registration desk and show this code: R-482." The guest never sees "not found", "invalid", "already checked in", a countdown or a lock screen. The staff side sees the real reason.
2. **Zero 429s to legitimate guests from one shared IP.** Event routes get their own limiter keyed per event and per surname, with a high per-IP ceiling sized for one NAT address. A high global failure rate *alerts* the Super Administrator and never blocks. This passes or fails in the 5–6 Dec single-IP load test.
3. **Check-in is separate from seating.** Any event staffer can check a guest in at the desk. Only the owner or the Super Administrator can seat them. Each is its own transition and its own endpoint.
4. **Every staff rejection is a recovery screen.** A 409 carries a stable code (`seat_taken`, `table_full`, `not_owner`, `guest_moved`, `stale`, `no_eligible_seat`), a human sentence, who or what won where that can be shared, the current guest state, and fresh ranked options. With all of that in the one reply, the sheet re-renders in place with no second round trip. A guest moved by the Super Administrator greys out with "Moved to Maria's queue by the Super Administrator, 6:52 PM" before it leaves. Nothing vanishes silently.
5. **Re-verifying returns the same status, with no scolding.** It creates no second check-in and only adds a "verified again from another device" flag for staff. Each verify mints a per-device token (32 bytes, stored SHA-256, revocable), so polling never resends surname or last 4.
6. **Two taps to seat a guest on a 390 px phone.** Tap the card, tap the table (seat chip pre-selected), then Confirm. The Confirm label repeats the choice ("Seat at Table 5"). Tables outside the staffer's scope are visible and read-only, labelled "Not yours".
7. **The Super Administrator's exceptions inbox is Must, even in the simple dashboard.** It holds approvals for walk-ins and substitutes, "No seat in scope", released reservations of late arrivals, and capped surnames. The spec gives the Super Administrator these decisions, so without an inbox they turn into phone calls at peak.
8. **Accessibility floor on every surface:**
   - inputs at least 16 px and targets at least 48 px;
   - WCAG AA contrast in both CORE themes;
   - table number at 56 px or more;
   - `aria-live="polite"` on the status region, with focus moved to the result heading;
   - everything works by keyboard;
   - class badges and meter states carry text, not colour alone;
   - `prefers-reduced-motion` is honoured.

**Implementation notes:**

*Guest page `/event/<code>`* (standalone HTML like `support.html`, CSP-hashed in `server/security.js` pagePolicy, `noindex`, `Cache-Control: no-store`, target under 40 KB, no web fonts)
- States: `closed` ("Registration opens at 6:00 PM", no inputs) · `verify` · `submitting` · `seated` (preferred: "Welcome, Ms. Dela Cruz. **Table 3**, Seat 4") · `pending` ("You're checked in. We're choosing your table. This page updates by itself.") · `referred` (uniform code) · `offline` (last known status kept, "Will update when you reconnect"). The `selfCheckIn=false` and `readOnly` flags render as the `referred`-style desk sentence, not as an error.
- Fields: Surname (placeholder "e.g. Dela Cruz") and "Last 4 digits of your mobile" (`inputmode="numeric"`, `pattern="\d{4}"`, `autocomplete="off"`). A "Use email instead" link swaps the second field to the **full** email address, because the last 4 characters of an email mean nothing.
- On success, `history.replaceState` moves the page to `/event/<code>/s/<token>`, as support.js already does. After 4 minutes in `pending` the page adds "Still choosing. A staff member can help at the desk", which matches the staff card turning amber at 4 minutes.
- Timing parity: the server pads failure replies to the success path's timing. Tuner confirms this under load.

*Staff "My queue"* (landing page for the Event staff account type; this is a SPA view under the Custom App module)
- Sticky bar: event name, staffer name, "Last updated 2 s ago". If updates stop for more than 15 s, the bar turns amber and reads "Reconnecting…".
- Sections: Waiting for table (n), oldest first · Checked in, seated · Find guest.
- Card: name, company, industry chip, class badge in text, and a wait timer (amber at 4 min, red at 8 min).
- Bottom sheet: up to 3 recommendations, each with a reason line ("Same industry: Banking, 3 of 6 seated") and a meter, then "Other eligible tables" (collapsed), then read-only "Not yours". Seat chips run 1–10, taken seats are disabled and the first free seat is pre-selected. Seat numbers are mandatory for preferred guests.
- Group seating: select mode uses checkboxes (not long-press), then "Seat together (n)". Only tables with n or more free seats are ranked. Splitting a group needs an explicit "Split group" confirm. A group whose members belong to different owners shows "Send group to Super Administrator".
- Empty queue: "No one is waiting for you. Your tables: 5, 6, 7 (14 seats left)."

*Find guest / assisted check-in*
- Search by partial name, company or referral code. Entering R-482 pre-fills what the guest typed and shows the real reason.
- Results show name, company, status and contact masked as "•••• 4417".
- Actions: **Check in** (any staffer), **Seat** (owner only), **Clear cap and check in** (one tap), **Add walk-in**, **Record substitute**. The last two go to the Super Administrator's inbox. A substitute is shown as one seat changing hands ("Seat 3-4: Juan Reyes replaces Pedro Reyes").

*Event control (Super Administrator), simple form*
- Counts row: Invited · Checked in · Not yet arrived · Waiting for table · Needs approval · Seats left.
- Occupancy grid of table tiles: number, class label, 10-dot meter plus a text count, owner. Full tables are dimmed and labelled "Full".
- Health strip, owned by Operator: `seq`, save p95, outbox depth, 429 count, failure-rate alarm.
- Exceptions inbox and workload table. Flags are toggles with confirm dialogs that name the effect, for example "Turn off self check-in? Guests will be sent to the desk."
- Releasing a reservation needs a confirm that names the guest, table and seat. Removing a table with guests is disabled and gives the reason, with a "Move guests…" action.

*Setup → Import check (collision report as onboarding)*
- After import, one screen lists each kind of problem as a count with a fix action next to it:
  - ambiguous pairs (same normalised surname and same last 4): add the full email, add a direct mobile, or mark "desk only";
  - guests with no mobile and no email: mark "desk only";
  - possible duplicates;
  - guests without an industry.
- "Open registration" stays disabled with the reason "3 issues to resolve" until the list is clear or the Super Administrator acknowledges it. This makes Skeptic's condition a guided step instead of a document.

*Failover and offline (the UX side of the cuts)*
- Easel card under the QR: "If this page doesn't open, please go to the registration desk."
- Staff desk card: the standby URL, "If the app restarts you'll be signed out. Sign in again and you'll land back on your queue", and the paper procedure.
- Sign-in returns the user to the route they were on. The session policy (`server/auth.js:54`, 8 h idle and 24 h max) covers a sign-in at 4 PM, so no change to auth.js is needed.
- The print pack (A–Z list, per-table sheets, per-staffer sheets with pre-partitioned free seats) is stamped "as of <time>" and fed by the laptop export pull. After recovery, "Reconcile paper seating" replays each entry through the normal commands and shows any capacity conflict as a recovery card.

*Copy rules:* address guests by title and surname. Write sentences, not codes. Staff copy names the person and the time. Every guest-facing dead end points to a human.

*Tests I need from Craftsman*, as Playwright journeys at 390 px:
- two contexts race for the last seat, and the loser sees "Table 5 just filled. Updated options:" with the guest still selected;
- one journey per row of the merged verification table: closed, match preferred, match pending → seated, uniform failure, capped → cleared at the desk in one action, re-verify from a second device;
- the `not_owner` / `guest_moved` greyed card;
- "Import check" blocks opening registration until resolved.

*Guides (CORE convention, required by `test/guides.test.js`):*
- A new `docs/guides/custom-app-events.md` for the Event staff account type and admins, with the sections "Seat a guest", "When a table fills up", "Find a guest at the desk", "Event control (Super Administrator)" and "If the system is down".
- A `whats-new.md` line and screenshots in `screenshots.json`.
- This guide also serves as the spec's operator guide, and the one-page desk card is printed from it.
