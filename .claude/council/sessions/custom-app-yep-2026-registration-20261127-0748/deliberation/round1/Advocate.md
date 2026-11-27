## Advocate Position: YEP 2026 Registration & Table Assignment as CORE "CUSTOM APP"

**Core recommendation:** Design around two moments that have to feel instant under pressure. The first is the guest at reception, in formal wear on a phone with weak signal, going from QR to "Table 7, Seat 4" in under 30 seconds. The second is the registration staffer with a line in front of them seating one guest in under 15 seconds and two taps. Build three separate surfaces: a tiny standalone guest page (not the SPA), a phone-first "My queue" screen that is the landing page for Event staff, and a desktop/tablet "Event control" screen for the Super Administrator. Every server rejection (last seat taken, guest moved to someone else, registration closed) must come back as a recovery screen with fresh options, never as a bare error toast.

**Key argument:**
Walk through 9 December. It is 6:40 PM. Forty guests come off the elevators in ten minutes, most of them on the venue Wi-Fi. Mrs. Dela Cruz scans the QR on the easel, types "dela cruz" and "4417", and the page has to cope with "Dela Cruz", "De la Cruz", "DELA CRUZ" and "Dela Cruz-Reyes". She is preferred, so she gets the delight moment straight away: "Welcome, Ms. Dela Cruz. Table 3, Seat 4". The number is huge, an email follows, and nobody else had to act. Mr. Tan is regular. He sees "You're checked in. We're choosing your table. This page updates by itself." He hasn't been rejected, he is waiting, and his status token page (like `/support/t/<token>`) refreshes without him touching it. Meanwhile Joel, a staffer holding a phone, gets a new card at the top of his queue: "Tan, Robert · Megabank · Banking · waiting 0:20". He taps it and sees three ranked tables, each with a reason ("Same industry: Banking, 3 of 6 seated") and a 10-dot capacity meter. He taps Table 5, then Confirm, and he is done. If Ana took the last seat at Table 5 a second earlier, Joel must not see "Error 409". He must see "Table 5 just filled. Updated options:" with the list re-ranked in place and Mr. Tan still selected. The spec states the requirements: recommendations are advisory, write access is scoped, there is one Super Administrator, last seat goes to one person. Whether people experience those requirements as safety or as friction comes down to these recovery states. The guest's other paths need the same care. When there is no match or an ambiguous match, the page must not dead-end with "not found". It should show "Please see the registration desk and show this code: R-482". That referral code carries what the guest typed, so the staffer's assisted search starts pre-filled. The same referral path covers walk-ins, substitutes and released reservations. One more point resolves a real tension in the spec: **any event staffer may check a guest in at the desk; only the owner (or the Super Administrator) may seat them.** Assisted search at reception has to find anyone, but delegation governs seating, not arrival. A checked-in guest who belongs to someone else drops into their owner's queue, and the staffer at the desk says so: "You're checked in; Maria will have your table in a moment."

**Risks if ignored:**
- **Launch blocker found in the code: the existing public rate limits will refuse real guests.** `server/api.js:1447` caps every non-GET to `/api/public/*` at **20 per hour per IP** (`public-write`), and `api-anon` allows 120 GETs/min per IP. At the venue, guests on hotel Wi-Fi share one NAT address. The 21st guest's check-in gets "Too many messages from this network". Fifty guests whose status pages poll every 5 s add up to 600 requests/min and lock out everyone. The event routes need their own buckets: a high per-IP ceiling sized for one shared address, plus per-event and per-surname failure caps to stop guessing. The status page must poll lightly with backoff, for example 4 s for the first 2 minutes and then 10 s, paused when the tab is hidden. This needs a load test from one IP.
- **Identity matching that fails real Filipino names creates a queue at the desk.** If matching is strictly literal, compound surnames (dela/de la/de los), ñ and accents, hyphenated married names, "Ma." and "Jr." all fall to assisted search, and assisted search is the slowest path. Normalize case, diacritics, spaces, hyphens, periods and apostrophes, and match on the stored surname plus any alias. Married-versus-listed-name mismatches still go to the desk by design. Also, "last 4 of email" is not a real identifier, because most addresses end in ".com". Offer "last 4 digits of mobile" as the main field and "or your full email address" as the alternative.
- **Silent state changes will make staff distrust the system mid-event.** A guest who disappears from Joel's queue because the Super Administrator reassigned them, a write refused because his delegation was revoked, a table that greys out under his thumb: each needs an explanation in place. Examples: "Moved to Maria's queue by the Super Administrator, 6:52 PM"; "You no longer manage Table 9". Without that, staff phone the command desk at the busiest moment of the night. Missing keyboard/screen-reader support and low contrast in a dim ballroom are smaller risks, but they are real for older executives using the guest page.

**Dependencies on other domains:**
- **Architect:** split check-in from seat assignment as separate state transitions and endpoints. A conflict response (409) must carry the *fresh* recommendation list and who or what won, so the client can re-render without a second round trip. Per-record `rev` with refusal reasons as stable codes (`seat_taken`, `not_owner`, `guest_moved`, `stale`) that the UI maps to copy. A referral-attempt entity (short code, inputs typed, timestamp). A guest status token. A `since`-revision delta feed for queues.
- **Skeptic:** confirm that re-verifying from a second device shows the same status (idempotent, low-sensitivity: table number only) rather than an "already checked in" error, and that the uniform no-match/multi-match response does not leak existence. Confirm that full email is acceptable as the alternative identifier.
- **Tuner/Operator:** the venue-NAT rate-limit problem above; poll intervals for about 10 staff devices plus up to about 300 guest status pages; venue Wi-Fi survey and a 4G hotspot for staff; printed event-day pack ritual; deploy freeze.
- **Craftsman:** Playwright journeys at 390 px phone viewport with 2+ browser contexts racing for the last seat, plus a guest-page journey through closed, no match, preferred, and pending then seated.
- **Strategist:** agree the cut line below (graphical floor plan, seat-picker visuals, undo and sounds are follow-ups).

---

### MVP vs follow-up (UX lens, honest about the 12 days)

| Must ship (launch blockers) | Follow-up / nice to have |
|---|---|
| Guest page: closed state, verify, preferred result, pending to seated auto-refresh, referral code, no-match path | Animated reveal, wake-lock, add-to-calendar |
| Event-specific rate-limit buckets that survive one shared venue IP | SMS |
| Staff "My queue" (phone-first) with wait timers, 2-tap seat, conflict recovery, moved/revoked explanations | Sound/vibration on new arrival; undo within 10 s |
| Assisted search (any staffer checks in, owner seats), walk-in/substitute form to SA | Bulk keyboard shortcuts |
| Group select then "seat together (n)" with explicit split confirm | Smart auto-split suggestions |
| SA Event control: counts row, table tile grid (10-dot meters, full = dimmed), exceptions inbox, per-staff workload, redistribute pending | Graphical ballroom floor plan (spec lists it as optional) |
| Seat number as a simple 1–10 chip row (mandatory for preferred) | Seat visualization around a round table |
| Email status chip (Sent / Failed / No email) + Resend, never blocking | Delivery analytics |
| Print event-day pack (A–Z list, per-table sheets, per-staffer sheets, "as of" timestamp) + reconciliation entry | Printed slips per guest |
| Operator guide + CORE `docs/guides` page for Event staff & SA (`test/guides.test.js` requires coverage of sidebar items) | Video walkthrough |

---

## Appendix A: Journey Mapping (skill: journey-mapping)

### Step 1: Personas and jobs

| Persona | Context / device | Job to be done | Emotional state on arrival |
|---|---|---|---|
| **Guest** (external exec, employee, preferred VIP) | Own phone, venue Wi-Fi or patchy 4G, dim lobby, possibly older, holding a bag/drink | "Get me to my seat without fuss and without looking lost." | Mildly anxious, socially exposed, impatient if a line forms |
| **Guest without smartphone/data** | Nothing in hand | "Someone just tell me where I sit." | Slightly embarrassed; needs a human |
| **Registration staffer** (Event staff account) | Phone or tablet, standing, one hand, guest in front of them | "Seat the person in front of me correctly in seconds; never be blamed for an overbooked table." | Task-focused, pressured, fears doing something wrong |
| **Super Administrator** (one account) | Laptop/tablet at a command desk, sometimes walking the floor | "See everything, clear every exception, rebalance before a line forms." | Vigilant, interrupted constantly |
| **Usher** | No device or a printout | "Know where to walk this guest; report moves." | Reactive |
| **Pre-event organizer** (SA / ICD) | Desktop, days before | "Load the list, set up tables, hand out responsibilities, get a clean plan." | Careful, detail-oriented |

### Step 2: Entry points

```
[Reception QR easel] ───────────────→ /event/<code>  (guest page; standalone HTML like support.html)
[QR shared early on social media] ──→ /event/<code>  → "Registration opens at 5:00 PM" (closed state)
[Confirmation email link] ──────────→ /event/<code>/s/<token>  (my status; table + seat)
[Re-scan / second device] ──────────→ verify again → same status (idempotent, no scolding)
[Staff sign-in, Event staff type] ──→ CORE login (+2-step) → lands directly on "My queue" (not the launcher)
[SA sign-in] ───────────────────────→ CORE → Custom App → YEP 2026 → Event control
[Referral code on guest phone] ─────→ staff "Find guest" → enter R-482 → pre-filled search
[Notification bell] ────────────────→ SA: "3 approvals waiting", staff: "2 guests reassigned to you"
[Printed pack] ─────────────────────→ offline mode, reconciled later
```

### Step 3: Happy paths

**3a. Preferred guest (express)**

| Step | Screen/View | User Action | System Response | User Emotion | Notes |
|---|---|---|---|---|---|
| 1 | Guest page: "Welcome to YEP 2026" | Scans QR | Page loads in <1 s (target <40 KB, no SPA, no fonts download) | Curious | Logo, one heading, two fields, one button |
| 2 | Verify form | Types surname, last 4 of mobile (numeric keypad via `inputmode="numeric"`) | Inline: "4 digits" counter | Confident | "Use email instead" link swaps 2nd field to full email |
| 3 | Submit | Taps "Check me in" (full-width, 48 px) | Button shows progress; server checks in + reads reservation atomically | Brief anticipation | Disable button to stop double-submit; server is idempotent anyway |
| 4 | Result | Reads | "Welcome, Ms. Dela Cruz. **Table 3**, Seat 4." Table number at ~72 px; "Show this screen to an usher"; email sent note | **Delighted**, relieved | URL replaced with status token (history.replaceState as support.js does) |
| 5 | Walks in | Shows phone to usher | — | Taken care of | Status page keeps working if reopened from email |

**3b. Regular / employee guest (assisted seating)**

| Step | Screen/View | User Action | System Response | User Emotion | Notes |
|---|---|---|---|---|---|
| 1–3 | Same as 3a | Verify | Check-in recorded; routed to owner's queue (or SA if no owner) | Confident | Check-in is not seating |
| 4 | Status: pending | Waits | "You're checked in, Mr. Tan. We're choosing a table for you. This page updates by itself." + "Updated 6:41 PM" line | Reassured (not abandoned) | Polls with backoff; text, not a spinner only |
| 5 | Status: seated | Phone updates | Table number appears with a short highlight; email sent | Delighted | `aria-live="polite"` announces the change |
| 6 | (If the wait goes over ~4 min) | — | "Still choosing. A staff member can help at the desk." | Patient | Same 4-minute mark turns the staff card amber |

**3c. Staffer seats one guest**

| Step | Screen/View | User Action | System Response | User Emotion | Notes |
|---|---|---|---|---|---|
| 1 | My queue | Glances | New card slides in at the top of "Waiting for table": name, company, industry, class badge, wait timer | Alert | Tab title "(3) My queue"; cards oldest first |
| 2 | Guest sheet | Taps card | Bottom sheet: 3 recommended tables with reason line + 10-dot meter ("6/10 · 4 left"), seated names/companies on expand; "Other eligible tables" collapsed | Confident | Only delegated eligible tables are tappable; others read-only, greyed with "Not yours" |
| 3 | Table chosen | Taps Table 5 | If seat numbers are on: 1–10 chips, taken ones disabled, first free pre-selected | In control | Default "any seat" when seat numbers are off |
| 4 | Confirm | Taps "Seat at Table 5" | Card leaves the queue; toast "Robert Tan, Table 5 Seat 6. Email sent." | Accomplished | One primary action; label repeats the choice |

**3d. SA clears an exception (unlisted walk-in)**

| Step | Screen/View | User Action | System Response | User Emotion | Notes |
|---|---|---|---|---|---|
| 1 | Desk staffer: "Add walk-in" | Enters name, company, industry, invited-by, mobile/email optional | Guest created as Unlisted, pending approval; referral code linked | Relieved (has a path) | Staffer tells guest "One moment, approval pending" |
| 2 | SA Event control: Exceptions inbox | Sees "Needs approval (1)" with bell | Card: who, typed by whom, when | Focused | Inbox is the SA's primary area |
| 3 | Approve | Picks classification + industry, Approve, then delegates or seats | Audit entry; guest appears in chosen queue or seated | Decisive | Reject requires a reason; desk staffer is told |

### Step 4: Alternate paths

- **First-time vs returning guest:** a returning visit (re-scan, email link) always lands on "my status". Re-verifying shows the same status with no "already checked in" error. The duplicate is still prevented, and staff see "verified again from another device" on the record.
- **Group arrival:** the staffer turns on select mode (a checkbox on each card, which works on touch and keyboard, unlike long-press), picks 3, then "Seat together (3)". Only tables with ≥3 free spaces are ranked. If none fit: "No table has 3 seats. Options: Table 5 (2) + Table 8 (1)". Splitting needs an explicit "Split group" confirm. A group spanning owners shows "Ask the Super Administrator", and a one-tap "Send group to SA" moves it.
- **Power user (SA):** desktop table grid plus a filterable guest list (name, org, industry, class, status, table) with CSV/Excel export. Bulk delegation before the event works by selecting guests by filter, then "Assign to Joel", and selecting tables by range ("Tables 10–15 to Joel").
- **Mobile vs desktop:** staff queue is designed for 390 px first (bottom sheet, thumb-reach Confirm). The SA screen is designed for ≥1024 px first and collapses to tabbed sections on a tablet (Exceptions / Tables / People). This is a separate design, not a squeezed one (heuristic 4).
- **Substitute:** from the original invitee's record, "Record substitute" opens a pre-filled form linked to the original. The UI shows one seat moving ("Seat 3-4: Juan Reyes replaces Pedro Reyes"), never two people on one seat.

### Step 5: Error and edge paths

| Where | Failure | What the user sees | Recovery |
|---|---|---|---|
| Guest page | Registration not active | "Registration for YEP 2026 opens on 9 December at 5:00 PM." (time set by SA) | None needed; no inputs shown |
| Guest page | No match / several matches (uniform response) | "We couldn't confirm your details here. Please see the registration desk and show this code: **R-482**." | Staff enters the code; search is pre-filled |
| Guest page | Too many attempts | "Please see the registration desk." No countdown, nothing that teaches guessing | Desk assisted path |
| Guest page | Network drop on submit | Inputs kept; "No connection. Tap to try again." | Retry is safe (idempotent check-in) |
| Status page | Network drop while waiting | "Offline, will update when you reconnect"; last known status kept | Auto-resume |
| Status page | Preferred reservation was released (late arrival) | "You're checked in. Please see the registration desk for your table." | Routed to SA/owner queue flagged "Released: late arrival" |
| Staff seat | Last seat taken (409 `seat_taken`) | Inline in the sheet: "Table 5 just filled. Updated options:" list re-ranked; guest still selected | One more tap |
| Staff seat | No eligible seat in scope | "None of your tables can take this guest. Send to Super Administrator?" one button | SA exceptions inbox: "No seat in scope" |
| Staff any | Guest reassigned / delegation revoked (`not_owner`, `guest_moved`) | Card greys with "Moved to Maria's queue by the Super Administrator, 6:52 PM", then leaves after 5 s | No action; no silent vanish |
| Staff any | Stale data (`stale`) | "This guest changed a moment ago." Sheet reloads with current state | Retry with fresh data |
| Staff any | Signed out / session expired mid-event | Sign-in screen returns to the same queue afterwards | Consider a longer idle limit for the Event staff type on event day (Operator) |
| Email | Send failed / no email | Status chip on guest: "Email failed" (red) / "No email" (grey); "Resend" button; seat unaffected | Verbal + guest page already shows table |
| SA | Remove table with guests | Disabled with reason "4 guests seated; move them first" + "Move guests…" | Guided relocation |
| SA | Release preferred no-show | Confirm dialog naming guest, table and seat: "Release Table 3 Seat 4 held for Mr. Lim? If he arrives later he'll need a new table." | Audit; late arrival gets referred |
| Empty states | Staff queue empty | "No one is waiting for you. Your tables: 5, 6, 7 (14 seats left)." (useful, not blank) | — |
| Empty states | Before import (pre-event) | "Start by importing the guest list (Excel or CSV)" + sample template download | Onboarding is the empty state |
| Total outage | Server/connectivity down | Printed pack (A–Z list with tables, per-table sheets with pre-partitioned free seats per staffer); after recovery, "Reconcile paper seating" screen validates each entry against capacity | Reconcile before going back online |

### Step 6: Friction points and mitigations

- **Friction:** surname typing on a phone with formatting variants. **Mitigation:** normalization plus alias surnames; examples in placeholder text ("e.g. Dela Cruz").
- **Friction:** "last 4 of email" is meaningless. **Mitigation:** mobile last-4 is the primary field; full email is the alternative.
- **Friction:** guest in "pending" with no sense of progress. **Mitigation:** an explicit sentence, an "updated" timestamp, and a 4-minute escalation prompt that matches the staff amber timer.
- **Friction:** staff unsure whether they may seat a guest. **Mitigation:** out-of-scope tables render read-only with a "Not yours" label, and the server enforces the same rule.
- **Friction:** assisted search shows personal data. **Mitigation:** results show name, company and status only. Mobile/email appear only as masked last 4 for confirmation ("•••• 4417").
- **Friction:** shared venue IP throttling (see Risks). **Mitigation:** event-specific buckets plus a load test from a single IP.
- **Friction:** dim ballroom and small text. **Mitigation:** ≥16 px inputs (also stops iOS zoom), 48 px targets, WCAG AA contrast in both CORE themes, table number at ≥56 px.

### Step 7: Delight moments

- **Delight:** preferred guests see their table and seat within one tap of the QR. It is the express lane made visible.
- **Delight:** the pending screen turns into "Table 5" by itself, with a short highlight, while the guest is still at the desk.
- **Delight:** the reason line on a recommendation ("Same industry: Banking, 3 of 6 seated") lets staff say something useful to the guest ("You'll be with other bankers").
- **Delight:** the email subject reads "Your table at YEP 2026: Table 5", so it is readable from the lock screen.

---

## Appendix B: Screen inventory and key interaction specs (for Architect/Craftsman)

1. **Guest page** `/event/<code>` (standalone HTML on CORE styles, CSP-hash-compatible, `noindex`)
   - States: `closed` · `verify` · `submitting` · `seated` (preferred) · `pending` · `referred` (code) · `released` · `offline`.
   - A11y: labelled inputs, `autocomplete="off"`, `inputmode="numeric"` + `pattern="\d{4}"`, errors linked via `aria-describedby`, result region `aria-live="polite"`, focus moves to result heading, works fully by keyboard, honors `prefers-reduced-motion` for the highlight.
2. **Status page** `/event/<code>/s/<token>`: the same component in read-only form. Polls with backoff and pauses on `visibilitychange`.
3. **Staff: My queue** (Event staff landing page)
   - Tabs/sections: Waiting for table (n) · Checked in, seated (n) · Find guest. A sticky top bar shows the event name, the staffer's name and "Last updated 2 s ago". If updates stop for more than 15 s, the bar turns amber and reads "Reconnecting".
   - Card: name, company, industry chip, class badge (Preferred/Regular/Employee/Unlisted, with text and not color alone), wait timer that turns amber at 4 min and red at 8 min, group link icon.
   - Guest sheet: recommendations (max 3 shown) → other eligible → read-only others; seat chips 1–10; Confirm button repeats the choice.
4. **Staff: Find guest / assisted check-in:** search by partial name, company or referral code. Results are minimal. Actions: "Check in" (any staffer) and "Seat" (only if owner). Also "Add walk-in" and "Record substitute".
5. **SA: Event control:** counts row (Invited · RSVP yes · Checked in · Not yet arrived · Waiting for table · Needs approval · Seats left). Table tiles grid shows a number, class color plus label, 10-dot meter (filled = seated, ring = reserved/held), industries represented, and owner. Full tiles are dimmed with a "Full" label. Below that: Exceptions inbox, per-staffer workload (pending count, longest wait, last active), and "Redistribute pending…".
6. **SA: Setup** (pre-event): Import (Excel/CSV with column mapping preview and duplicate report), Guests, Tables (bulk create "Tables 1–30, capacity 10"), Industries & relationships, Delegation (bulk by filter/range with overlap prevented at selection time), Registration on/off with opening-time message, Print pack, Export.
7. **Print pack** (`@media print`, which CORE already uses in 7 places in `styles.css`): A–Z list with table/seat, per-table sheets, per-staffer sheets, and a pre-partitioned free-seat range per staffer for outage mode. Each page is stamped "as of <time>" and "Print again after changes".

### Staff conflict-recovery contract (what the UI needs from the API)

```
409 { code: "seat_taken" | "table_full" | "not_owner" | "guest_moved" | "stale" | "no_eligible_seat",
      message: "<human sentence>",
      by?: { name, at },              // who/what won, if shareable
      guest: <current guest state>,   // so the sheet re-renders in place
      options?: <fresh ranked tables> // for seat_taken / table_full
    }
```

### Copy principles
- Address the guest by title and surname. Write sentences, not codes. Never show "error", "invalid" or "not found" to a guest.
- Staff copy names the person and the time ("by the Super Administrator, 6:52 PM").
- Every guest-facing dead end points to a human: "Please see the registration desk."

### Guides (CORE convention)
Add a CORE guide (e.g. `docs/guides/custom-app-events.md`, roles: event staff type + admin, apps: customapp) with sections "Seat a guest", "When a table fills up", "Find a guest at the desk", "Event control (Super Administrator)", "If the system is down". Add a `whats-new.md` line and screenshots in `screenshots.json`. This doubles as the spec's required "brief operator guide". A one-page printable desk card for staff is recommended.
