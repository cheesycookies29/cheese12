# Strategist Final Position — CUSTOM APP and the YEP 2026 Registration & Table Assignment app

**Lens:** gold. Value per unit of effort, the MVP cut line, sequencing against a fixed date.
**Inputs:** my Round 1 position, my Round 2 responses to Operator and Scout, the Round 2 challenges
(Operator, Advocate, Skeptic, Architect, Scout), and the Round 3 finals of Architect and Advocate.
**Checked in the repo for this round:**
- `server/api.js:416-431`: `replaceData()` already keeps `devlog`, `feedback`, `guideEdits`, the
  helpdesk mail setup, and the CRM and Projects setup across a restore. Architect's carve-out
  follows this precedent.
- A grep of `server.js` and `server/` finds no `unhandledRejection` handler.

**n8n:** not cloned locally. n8n references come from peers' citations or model knowledge, and the
latter are marked *(unverified)*.

---

**Revised recommendation:** Keep the three tiers. Each tier ends with CORE event-ready, so a slip
costs a feature and never the event:
- **Tier 0, staff-only seating:** released dark by 1 Dec.
- **Tier 1, guest QR page plus delegated queues:** by 3 Dec.
- **Tier 2, exceptions, email and dashboard:** by 5 Dec, with the client acceptance demo.

No feature work after 6 Dec. The council has now converged on the build:
- event data stays in `db.json` as `ca*` collections, which a CORE restore never touches;
- one synchronous `commit()` per change, counting seats through a status-agnostic `claimsAt()`;
- `reserved` is in and `held` is out;
- short polling with a `pollMs` set by the server;
- a hardened guest page that never writes to disk on a failed attempt;
- about one developer-day of cheap operations safeguards, front-loaded on 28 Nov.

The new items are cheap and are paid for by the cuts. The build stays at about 15 dev-days, with
6 to 8 Dec as buffer.

**Concessions made:**
1. **Restore safety moves into Tier 0.** In Round 1 I missed that Admin "Restore a backup"
   (`db.replace`) would wipe event state. I add Architect's `replaceData()` carve-out (XS, plus a
   test that every event's `seq` is unchanged after a restore) as a Must. It is cheaper than
   Architect's Round 2 per-event store, which I opposed, and it closes the same hole.
2. **The event export becomes a fixed, versioned format (JSON v1) in Tier 0.** It used to be a
   Tier 2 by-product of CSV export. One format feeds the laptop pull, the printed pack, the
   standby and a v1.1 import. Fixing it now makes the deferred import a reader, not a redesign.
3. **On-box 5-minute export copies are back in, at XS.** In Round 2 I cut "on-box snapshots" as an
   S. Once the export exists, writing it to `data/backups/events/` every 5 minutes is a timer.
   Operator and Architect both want it. With 300 guests the file is small, so it does not slow
   the event loop.
4. **Operations item #24 grows from XS to S, and its dates move earlier, as Operator asked.**
   - On 28 Nov, about half a developer-day: the freeze guard in `remote-deploy.sh`, keeping
     `/opt/ltdc-erp-prev` before the `rsync --delete`, and the `unhandledRejection` logger.
   - Staging is rebuilt from S3 between 1 and 3 Dec. That is the restore drill, and staging then
     serves as the load-test target and the warm standby. This replaces my 4 Dec date.
   - A first load test runs on 4 Dec against the Tier 1 build, and a second on 6 Dec with the
     kill -9 drill.
   - All of this is operator time except the 28 Nov half-day.
5. **The storage decision has a gate, not an assumption.** Measure `db.json` size and `save()` p95
   on 28 Nov, on a copy of production. If it is above 50 ms, apply in order: compact JSON, then
   coalesced outbox writes, then a resize (check the Elastic IP first). Split the store only if
   p95 is still above 150 ms, decided by 30 Nov. Above that line the split costs about 2
   dev-days, and email is dropped to "display + verbal" to pay for it.
6. **The guest page is hardened as Skeptic and Advocate jointly specified, adding about 0.5
   dev-day to Tier 1:**
   - every failure gets the same reply, carrying a referral code;
   - name normalisation is deterministic, with exact matching only (no fuzzy matching in
     public);
   - a hashed random status token is kept per device, so polling never resends the surname or
     last 4;
   - an activation window;
   - re-verifying is idempotent: the guest sees the same status, and staff see a flag;
   - a soft cap per surname of 8 distinct wrong last-4 values in 15 minutes, which staff can
     clear in one tap or which times out;
   - a high failure rate alerts the Super Administrator and never locks the event;
   - failed attempts live only in bounded in-memory maps.

   I also add the pre-event name-collision report as a Must, folded into the import preview at
   no extra item. For remote spoofing I take Advocate's zero-typing presence key in the QR URL
   (XS). A typed rotating desk code is a Could, off by default: it costs every guest a step to
   stop an unlikely attack.
7. **Fuzz coverage of `reserved` (+0.5 day).** Random sequences of assign, check-in, release,
   transfer, swap, substitute and group arrival are run over seeded reserved and confirmed
   guests. The suite asserts zero holds, no release by expiry, and a closed `SEAT_STATUSES` set.

**Non-negotiables:**
1. **One synchronous `commit()` for every change.** No `await` between validation and `save()`,
   enforced by a test. The actor's event role is re-read on every call. The change is undone in
   memory if the save fails. There is one process and no queue mode. This is the leverage that
   makes transfer, swap, groups and substitutes size S. Without it, the Must list does not fit in
   12 days.
2. **Capacity is counted, never stored.** `claimsAt(tableId)` counts every seat claim whatever its
   status, and every handler calls it. `reserved` is Must, because spec sections 8, 10 and 21 and
   the no-show scenario require it. `held` is Won't. A closed-enum test forces a decision before
   any status is added.
3. **A CORE restore never changes event state**, through the `replaceData()` carve-out and its
   test. This ships in Tier 0, before any real guest data is imported.
4. **Event endpoints never fall into the generic per-IP buckets** (`api-anon` 120/min and
   `public-write` 20/h). Otherwise the venue's shared NAT stops check-in at about the 20th guest.
   Signed-out traffic causes a disk write only on a successful verification.
5. **One Super Administrator per event**, held as a field on the event and not as CORE's `*`.
   Changed only through an audited `setSuperAdmin`.
6. **The core loop is above the cut line:** verified guest, then an eligible table chosen, then
   capacity holds, then the guest sees the table. That covers backlog #2, #5 to #7, #12 to #14
   and #21. The fallback order may never touch them.
7. **Dates:**
   - client decisions (section 22) by 1 Dec;
   - final guest list, industries and table inventory by 3 Dec;
   - email go/no-go on 3 Dec;
   - data freeze and last feature work on 6 Dec;
   - code freeze on 7 Dec at 18:00;
   - deploy freeze from 8 Dec 12:00 to 10 Dec 09:00.
8. **Still Won't before 9 Dec:**
   - SSE or WebSocket push;
   - seat holds;
   - an event-only import endpoint (format fixed, reader in v1.1);
   - persisted sessions (they would change the VAPT-hardened `auth.js`);
   - long-poll (the `wait` parameter is reserved);
   - a QR redirect host;
   - the floor plan, SMS and analytics;
   - any generic app framework or CORE-wide outbox.

**Implementation notes:** see below.

---

## 1. Final backlog delta (changes against my Round 1 MoSCoW only)

| # | Item | Round 1 | Final | Effort | Tier / date |
|---|------|---------|-------|--------|-------------|
| 2a | `replaceData()` keeps `ca*` collections, with a seq-unchanged test and a notice on the Admin restore screen | absent | **Must** | XS | Tier 0 |
| 9 | Export: CSV, plus a **versioned event JSON v1** carrying `seq` and `sha256`, plus a printable plan | Must S | **Must S** (format fixed in Tier 0) | S | Tier 0 |
| 9a | Export written to `data/backups/events/` every 5 min; laptop pulls the same file | cut (R2) | **Must** | XS | Tier 1 |
| 4a | Name-collision report in the import preview (same normalised surname and last 4) | absent | **Must** | XS | Tier 0 |
| 12 | Guest QR page with the merged Skeptic/Advocate spec (concession 6) | Must M | **Must M+** (+0.5 d) | M | Tier 1 |
| 12a | Presence key in the QR URL | absent | **Should** | XS | Tier 1 |
| 12b | Typed rotating desk code | absent | **Could** (off by default) | XS | after load test 1, only if asked |
| 12c | Failure-rate alarm to the Super Administrator (notification bell) | absent | **Must** | XS | Tier 1 |
| 21 | Acceptance suite, plus a fuzz suite over `reserved`, plus the closed-enum test | Must M | **Must M** (+0.5 d) | M | Tiers 0 to 2 |
| 24 | Ops: freeze guard, kept prior release, `unhandledRejection` logger, flags checked in `commit()`, 60 s invariant self-check | Must XS | **Must S** | S | 28 Nov (half-day) + Tier 0/1 |
| 24a | Measure `save()` p95 on a production copy; storage gate | Tier 0 decision | **First task** | XS (ops) | 28 Nov; gate 30 Nov |
| 24b | Staging rebuilt from S3 (restore drill), then load target and warm standby | 4 Dec (R2) | **1 to 3 Dec** | ops time | Ops |
| 11 | Live sync: short poll on `changes?since=seq`, `pollMs` set by the server, `wait` parameter reserved | Must S | **Must S** (unchanged) | S | Tier 1 |
| 20 | Dashboard: counts, occupancy grid, health strip (`seq`, save p95, outbox, 429s) | Must M | **Must S** (fallback form from day one) | S | Tier 2 |
| 35 | Short-lived holds | Won't | **Won't** (`reserved` Must, inside #6/#7) | none | none |
| new | Per-event store `data/customapp/<eventId>/` | absent | **Won't**, unless the 30 Nov gate trips (>150 ms) | M | none |
| new | Event-only import / restore endpoint | Won't (R2) | **Won't before 9 Dec**, v1.1 reader | M | 10 Dec + |

**Ledger:** Round 1 Must was about 15 dev-days.
- **Added:** about 2.6 dev-days (ops 1.0, carve-out 0.1, export v1 0.25, 5-minute copy 0.1,
  guest-page hardening and alarm 0.6, collision report 0.1, fuzz 0.5).
- **Removed against the Round 2 proposals:** about 3 dev-days (event import, on-box snapshot
  engine, persisted sessions, long-poll, QR redirect, per-event store).
- **Saved:** about 0.5 day by building the dashboard in its fallback form.
- **Net:** about 14.5 to 15 dev-days against 9 build days, at CORE's observed cadence. MOD-08
  went from engine to release in about 3 days. The buffer is 6 to 8 Dec.

## 2. Roadmap (final)

| Date | Work | Gate / milestone |
|------|------|------------------|
| 27 Nov | Council converges. The user sends the client the section-22 questions (seat numbers for non-preferred guests, mixed tables, delegating no-show release, who owns the industry map, sender address for email). | Design signed off |
| 28 Nov | **Ops half-day first:** measure `save()` p95 on a copy; freeze guard; `/opt/ltdc-erp-prev` and rollback script; `unhandledRejection` logger. Then start Tier 0: module shell, model, `commit()`, `claimsAt()`, carve-out. | p95 known |
| 30 Nov | Storage gate. Under 50 ms: nothing to do. 50 to 150 ms: compact JSON, coalescing, resize. Over 150 ms: split, and email drops to display plus verbal. | Decision recorded in the devlog |
| 1 Dec | **Tier 0 released dark** (module off for non-admins): import with collision report, assisted search, manual check-in, preferred retrieval, choose table, audit, CSV and JSON v1 export, printable plan, NAT-sized buckets, event Super Administrator, flags. Acceptance tests: last seat, duplicate check-in, preferred no-show, all tables full, restore-safety. | Client decisions due |
| 1 to 3 Dec (ops) | Staging rebuilt from S3: this is the restore drill, and staging becomes the load target and standby. | Restore proven on a real box |
| 3 Dec | **Tier 1:** guest page (hardened), status token, activation window, presence key, failure alarm, delegation, per-owner queues, recommendations, polling, idempotency key, 5-minute export copy. Acceptance tests: cross-scope rejected, reallocation. | Final data due; real import; **email go/no-go** |
| 4 Dec (ops) | **Load test 1** on staging: 300 guests from one IP in a 10-minute burst, plus 15 staff polling. | Zero 429s to genuine guests; p95 within budget |
| 5 Dec | **Tier 2:** transfer, swap, release, groups, unlisted guests and substitutes, email outbox (capacity-1 FIFO), dashboard with health strip, offline pack and reconciliation, CORE guide plus whats-new. | **Client acceptance demo: all 12 scenarios on several devices** |
| 6 Dec | Data freeze. **Load test 2 with the kill -9 drill.** Dress rehearsal with real staff accounts and 2-step sign-in. Last feature or fix work that is not a Sev-1. | Fallback order applied to any open Sev-1 |
| 7 Dec | Code freeze at 18:00. Resize (after checking the Elastic IP). GitHub `production` reviewer gate. | Event build tagged |
| 8 Dec | Deploy freeze from 12:00. Full backup. Offsite copies every 15 minutes during the event window. Print the contingency pack. | Event-ready |
| 9 Dec | Event: the Super Administrator, a standby CORE admin for break-glass only, and the warm standby (staff URL only). | YEP 2026 |
| 10 Dec + | Freeze lifted. Archive the export. Event import reader (v1.1). Post-event PII purge (#33). Retro. Decide whether CUSTOM APP is worth generalising, only if a second client app exists. | Post-event report |

## 3. Fallback order if we slip (unchanged in spirit, extended)

Apply these one at a time, at the first missed tier date:
1. Email becomes display plus verbal. Spec section 6 allows this, and the "email failure"
   scenario must work without email anyway.
2. The dashboard becomes counts plus the occupancy list.
3. Groups become one-by-one assignment with a capacity hint.
4. The seat picker for non-preferred guests is dropped. Seats stay mandatory for preferred
   guests.
5. The presence key is dropped, and the activation window plus last 4 remain the controls.

Never dropped:
- `commit()` and `claimsAt()`;
- the `replaceData()` carve-out;
- event-scoped rate-limit buckets;
- the guest page with uniform replies;
- delegation and queues;
- the acceptance and fuzz suites;
- the printed contingency pack.

## 4. Reusable without over-engineering (final line)

"Reusable" means **parameterised**:
- every record is keyed by `eventId`;
- classifications, table types, industries and relationships are data;
- no YEP strings appear in code;
- the module shell has an `APPS` registry with one entry.

It does not mean **abstracted**: no app builder, no custom fields, no plugin loading, no generic
outbox. The bounded context lives in code: only `server/customapp/` touches `ca*`. It does not
live in the file layout. The cost is about 5% of the build. Event #2 reuses the engine as it is.
Anything more is decided after 9 Dec, from the metrics below.

## 5. n8n patterns: what we borrow and what we reject

- **Borrowed (pattern, not code):**
  - Form Trigger: a hosted public form with a fixed response mode becomes the guest page with one
    uniform reply *(unverified)*.
  - The concurrency-control queue becomes the capacity-1 FIFO email outbox, kept outside
    `commit()`, with retry and the `emailPaused` flag *(per Architect's citation)*.
  - Credentials kept server-side become reuse of the helpdesk SMTP setup; no new secrets store.
- **Rejected:**
  - Queue mode with Bull/Redis workers: it breaks single-thread atomicity.
  - The push connection (SSE/WS): it is new infrastructure in `server.js` that a 2 to 4 second
    poll makes unnecessary for about 15 staff and 300 status pages.
  - Execution locking across processes: there is only one writer.

## 6. Success metrics

**Hard gates**, checked by the invariant scan after each load test and after the event:
- zero overbooked tables;
- zero duplicate check-ins;
- zero double seats;
- zero holds;
- zero reservations released by expiry;
- exactly one Super Administrator.

**Event-day flow:**
- QR scan to "checked in": median under 30 s.
- Checked in to seated (regular guests and employees): p90 under 2 minutes at peak.
- Share self-verified versus assisted, which decides whether to invest in the guest page for
  event #2.
- Share seated at a recommended table, which says whether the ranking helps.
- Email delivered, failed and resent.

**Operations:**
- At least 4 production deploys exercise the freeze guard and rollback before 7 Dec, including
  one deliberate rollback.
- `save()` p95 under 100 ms at the load profile.
- Zero 429s to genuine guests from one IP.
- In the kill -9 drill, staff are back in or on paper within 3 minutes.
- Paper reconciliation through normal commands gives zero invariant violations.
