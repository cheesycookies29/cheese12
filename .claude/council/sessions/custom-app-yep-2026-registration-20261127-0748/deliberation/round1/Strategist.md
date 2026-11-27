# Strategist Position: CUSTOM APP and the YEP 2026 Registration & Table Assignment app

**Lens:** gold. Value per unit of effort, MVP cut line, sequencing against a fixed date.
**Grounding:** spec.txt (sections 1 to 22), interview summary, codebase map, Architect/Advocate/Skeptic
round 1 drafts, and direct checks of the repo: `server/api.js:558-562,1445-1447` (anon and
public-write buckets), `docs/guides/` + `test/guides.test.js` (CORE has the same guides gate as
ATLAS), and the release cadence in `git log` (Document Management, MOD-08, went from engine to
release in about 3 days, 22 to 24 Nov; `server/documents.js` is 943 lines, `server/forms.js` 477).
**n8n:** not present locally; n8n references here are from model knowledge and are marked *(unverified)*.

---

## Core recommendation

Treat 9 December as an immovable launch, not a target. Build in three tiers so that **CORE is
event-ready at the end of every tier**, and the event can still run if the next tier slips:

- **Tier 0, staff-only seating:** done 1 Dec.
- **Tier 1, guest QR self-check-in and delegated queues:** done 3 Dec.
- **Tier 2, groups, substitutions, email and dashboard:** done 5 Dec, with the acceptance demo.

The last four days (6 to 9 December) are for load testing, a dress rehearsal on the real guest
list, fixes only, and the deploy freeze. Make it "reusable" by **parameterising** (every record
keyed by `eventId`, classifications and table types as data, no YEP strings in code), never by
**abstracting** (no app builder, no plugin system, no generic outbox). Cut SSE/WebSocket, seat
holds, the floor plan, SMS and analytics.

## Key argument

The spec says it plainly in section 17: "Prioritize a dependable workflow over elaborate features."
Section 22 adds: "Optional enhancements should not delay the core event-day workflow." The value
of this system is concentrated in one loop:

> verified guest → a staffer picks an eligible table → capacity holds → the guest sees the table number

Everything else either speeds up that loop (QR self-check-in, recommendations, groups) or makes it
safe to change afterwards (transfers, substitutions, audit, email). So the build order is:

1. **The loop, operated by staff alone.** Import, assisted search, manual check-in, preferred
   retrieval, choose table, capacity enforced in one synchronous `commit()`, CSV export and a
   printable seating plan.
2. **Taking work off the desk.** The guest QR page, plus the per-owner queues with ranked
   recommendations.
3. **The exception paths that the acceptance scenarios name.**

Staff-assisted check-in is a hard requirement in section 4 anyway, so Tier 0 is never wasted work.
It is also the fallback if the public page misbehaves on venue Wi-Fi.

The biggest schedule risk is not code. CORE ships a module this size in about 3 days: MOD-08 went
from engine to release between 22 and 24 Nov. The real risk is the **client's inputs**, which
section 22 still lists as open:

- the final guest list with industries,
- industry relationships,
- the table inventory and which tables are mixed,
- whether seat numbers are needed for non-preferred guests,
- the staff roster and delegation,
- whether no-show release can be delegated.

Each of these needs a dated deadline, so the engineering plan cannot be blocked by them.

One architectural choice saves the most effort. All mutations (check-in, assign, transfer, swap,
release, group assign, substitute, reallocate) go through **one** validate-apply-save function with
guest revisions. Then transfers, swaps, groups and substitutions become thin commands of size S,
not M. It also gives the "last seat" and "stale write" acceptance scenarios one test surface
instead of eight. That single function is the strategic bet that makes the 12 days fit.

Live sync by short or long polling on an event sequence number (`since=seq`) is enough for ~15
staff devices and ~300 guest status pages. A push channel in the style of n8n's SSE/WS
*(unverified)* is new infrastructure in `server.js`, carries risk on the day, and adds nothing a
2 to 3 second poll cannot give. It is "Won't (this time)".

Reusability is worth about 5% extra effort, and no more. CUSTOM APP becomes:

- a module entry (`shared/modules.js`),
- a landing page that lists client apps (one app today),
- an `events` collection.

YEP 2026 is just `event #1`. The second event or client app reuses the engine. Anything beyond
that is speculative; we decide it after 9 Dec, using real usage data.

## Risks if ignored

- **Building the elaborate parts first and running out of days.** If the push channel, floor plan,
  seat picker or a generic "custom app framework" are built before the staff loop works
  end-to-end, the event could arrive with nothing dependable. The tiering exists so that a slip
  costs us a feature, never the event.
- **A tested system with the wrong data.** If the guest list, industry mapping and table inventory
  arrive on 8 Dec, the recommendations will be wrong, preferred seats will be missing, and there
  will be no time for a dress rehearsal. The mitigation is client deadlines: decisions by 1 Dec,
  final data by 3 Dec, data freeze by 6 Dec. After 6 Dec, changes go through the app UI only, with
  audit.
- **Launch blockers in CORE's existing safeguards, which no feature work will fix.** Skeptic and
  Advocate both found them, and I confirmed them in `server/api.js:562,1447`:
  - `public-write` allows 20 per hour per IP and `api-anon` 120 per minute per IP. Behind the
    venue's shared NAT, guest 21 is refused.
  - A CORE `admin` holds `*`, which would make every CORE admin a second Super Administrator.
  - Sessions are held in memory and are lost on any restart.

  These are XS to S fixes, but they belong in **Tier 0**, not at the end. They are cheap now and
  fatal on the day.

## Dependencies on other domains

- **Architect:** confirm that one synchronous `commit()` (no `await` between validate and
  `db.save()`) covers every mutation. The S-sizing of transfer, swap, group and substitution
  depends on it. Confirm the data model (seat embedded in the guest, a single owner field).
- **Advocate:** the minimum screen set for Tier 0 and Tier 1:
  - "My queue" on a phone,
  - "Event control" on a tablet or desktop,
  - the guest page plus the status-token page.

  Also the recovery screens for a 409 refusal. These are Must, because a refusal without options
  breaks the loop.
- **Skeptic / Guardian:** the threat-model bar for the public page. Proposed: surname + last 4
  digits, uniform responses, a registration on/off toggle, and event-scoped rate-limit buckets
  sized for one NAT. Also the Super Administrator break-glass procedure: a CORE admin reassigns
  `superAdminUserId`, audited, with no second active account.
- **Operator:**
  - the freeze mechanism (disable the deploy workflow or require approval from 8 to 10 Dec),
  - a backup and restore drill on 7 Dec,
  - whether sessions survive a restart, or we accept that risk under the freeze,
  - the printed contingency pack.
- **Craftsman:** the 12 acceptance scenarios as `node --test` cases against `handle()`, built from
  day 1 alongside each tier. Also one Playwright multi-device journey and a load script: 300
  guests plus 15 staff in a 10-minute burst.
- **Tuner:** whole-file `db.save()` cost under the arrival burst, with the shared `db.json`
  including other CORE modules. Does save coalescing or a separate event data file need to be in
  Tier 0?
- **Client (Legati/ICD), through the user:** the six section-22 decisions by 1 Dec, the final
  data by 3 Dec, the staff roster with CORE accounts by 4 Dec, and the dress rehearsal on 6 or
  7 Dec.

---

## Appendix A: MoSCoW table (mvp-scoping skill)

Effort is T-shirt size at CORE's observed cadence: XS < 0.5 d, S ≈ 1 d, M ≈ 2 to 3 d. Value is
tied to the core loop and the spec's acceptance scenarios (AS-n refers to the scenario rows in
section 20).

| # | Feature | MoSCoW | Effort | Value | Quadrant | Tier |
|---|---------|--------|--------|-------|----------|------|
| 1 | CUSTOM APP module shell (MODULES entry, MODULE_API incl. `/api/public/event`, app list page) + limited "Event staff" role | Must | S | High | Quick Win | 0 |
| 2 | Event engine data model (events, tables, guests with embedded seat, change log, `seq`) + single `commit()` with revisions and typed 409 | Must | M | High | Strategic Bet (enabler) | 0 |
| 3 | Event-scoped Super Administrator (`superAdminUserId`), not CORE `*`; break-glass reassignment by CORE admin, audited | Must | XS | High | Quick Win | 0 |
| 4 | Guest list import CSV (+ xlsx via existing reader if verified), table setup, industry categories | Must | M | High | Strategic Bet | 0 |
| 5 | Assisted search (partial name, company) + manual check-in by any event staffer | Must | S | High | Quick Win | 0 |
| 6 | Preferred express: retrieve preassigned table/seat; released reservation referred | Must | XS | High | Quick Win | 0 |
| 7 | Choose eligible table (+ seat for preferred), capacity counts confirmed + reserved, full tables hidden; last-seat single winner | Must | S | High | Quick Win | 0 |
| 8 | Audit via `audit.record` + per-event change history | Must | S | High | Quick Win | 0 |
| 9 | Export CSV + printable seating plan and guest list (browser print) | Must | S | High | Quick Win | 0 |
| 10 | Event rate-limit buckets sized for shared NAT (public verify, status poll) | Must | XS | High | Quick Win | 0 |
| 11 | Live sync: poll `GET .../changes?since=seq` (2 to 3 s) for staff and status pages | Must | S | High | Quick Win | 1 |
| 12 | Guest QR page (standalone HTML like `support.html`): surname + last 4, uniform responses, registration toggle, referral code, status-token page | Must | M | High | Strategic Bet | 1 |
| 13 | Exclusive delegation of guests and tables (single owner field) + SA reallocation of pending work | Must | M | High | Strategic Bet | 1 |
| 14 | Per-owner queue (derived view) + SA queue for unowned/unlisted | Must | S | High | Quick Win | 1 |
| 15 | Recommendation ranking: same industry > related > capacity fit > other eligible; editable relationship map | Must | S | High | Quick Win | 1 |
| 16 | Transfer / swap / release (thin commands on `commit()`) | Must | S | High | Quick Win | 2 |
| 17 | Group arrivals: tables with remaining ≥ n, alternatives, split only on confirmation | Must | S | High | Quick Win | 2 |
| 18 | Unlisted approval + substitutes linked to original invitee | Must | S | High | Quick Win | 2 |
| 19 | Email assignment via existing SMTP (`server/mail`), event-scoped send log with status, resend; send after save | Must | M | Medium | Strategic Bet | 2 |
| 20 | Dashboard: counts by status/classification, table occupancy grid (list/grid, not floor plan), workload per owner | Must | M | High | Strategic Bet | 2 |
| 21 | Acceptance suite: 12 AS scenarios as `node --test` + 1 multi-device Playwright journey + load script | Must | M | High | Strategic Bet | 0 to 2 (grow per tier) |
| 22 | Offline contingency: printed pack, pre-partitioned table ranges per staffer, reconciliation by replaying paper allocations as commands | Must | S | High | Quick Win | 2 |
| 23 | Operator guide in `docs/guides` (CORE `test/guides.test.js` gate) + whats-new + devlog | Must | S | Medium | Fill-in (mandatory) | 2 |
| 24 | Deploy freeze 8 to 10 Dec, pre-event backup, restore drill, runbook | Must | XS | High | Quick Win | Ops |
| 25 | Idempotency key on staff mutations (double tap on slow response) | Should | XS | Medium | Fill-in | 1 |
| 26 | Seat numbers for non-preferred guests (optional seat picker) | Should | S | Low to Medium | Fill-in | 2 if client says seats are numbered |
| 27 | Sessions survive a restart (persist session store) | Should | S | Medium | Fill-in | Operator decides; freeze is the fallback |
| 28 | Read-only overall availability for staff | Should | XS | Medium | Fill-in | 1 (falls out of the occupancy grid) |
| 29 | Long-poll instead of short poll | Could | S | Low | Fill-in | After load test, only if needed |
| 30 | Seating tags / exclusions (sensitive pairings) | Could | S | Low | Fill-in | Only if ICD asks by 1 Dec |
| 31 | Seat visualization per table | Could | S | Low | Fill-in | Post-event |
| 32 | Printed slips | Could | XS | Low | Fill-in | Status page is printable |
| 33 | Post-event PII purge / retention control | Should | S | Medium | Fill-in | v1.1 (after 9 Dec) |
| 34 | SSE / WebSocket push channel (n8n-style *(unverified)*) | Won't | M | Low | Avoid | Future |
| 35 | Short-lived seat holds | Won't | S | Low | Avoid | Not needed: sync commit has no window |
| 36 | Graphical ballroom floor plan | Won't | L | Low | Avoid | Future |
| 37 | SMS | Won't | M | Low | Avoid | Future |
| 38 | Detailed analytics | Won't | M | Low | Avoid | Basic timestamps captured only |
| 39 | Generic CUSTOM APP framework (app builder, custom fields, plugin loading) | Won't | XL | Low now | Avoid | Decide after a second client app exists |
| 40 | Generic CORE-wide outbox | Won't | M | Low now | Avoid | Event send log only |
| 41 | Separate process / queue workers (n8n queue mode *(unverified)*) | Won't | L | Negative | Avoid | Breaks single-thread atomicity |

## Appendix B: Value-effort matrix

```
  High value │ STRATEGIC BETS (phase carefully)     QUICK WINS (do first)
             │  #2 commit() engine                  #1 module shell   #3 event SA
             │  #4 import    #12 guest QR page      #5 assisted search #6 preferred
             │  #13 delegation #19 email            #7 capacity/assign #8 audit #9 export/print
             │  #20 dashboard #21 acceptance suite  #10 NAT buckets   #11 polling sync
             │                                      #14 queues #15 ranking #16 transfer/swap
             │                                      #17 groups #18 unlisted/subst #22 offline
             │                                      #24 freeze/backup
  ───────────┼───────────────────────────────────────────────────────────────────────
  Low value  │ AVOID (cut)                          FILL-INS (if time permits)
             │  #34 SSE/WS  #36 floor plan          #25 idempotency  #26 seat picker
             │  #37 SMS  #38 analytics              #27 session persistence  #28 read-only view
             │  #39 app framework  #40 outbox       #29 long-poll  #30 tags  #31 seat viz
             │  #41 queue workers  #35 holds        #32 slips  #33 PII purge  #23 guide (mandatory)
             └───────────────────────────────────────────────────────────────────────
               High effort  ←──────────────────────────────────→  Low effort
```

Note: #16 to #18 count as Quick Wins **only because** #2 exists. Without a single `commit()`,
each of them is an M and the Must list no longer fits.

## Appendix C: MVP feature set and cut line

- [ ] Tier 0 (#1 to #10, #24, first AS tests): about 5 to 6 days of work, compressed to about 3
  calendar days at CORE cadence
- [ ] Tier 1 (#11 to #15, #25, #28): about 4 days of work, about 2 calendar days
- [ ] Tier 2 (#16 to #23): about 6 days of work, about 2 calendar days
- **Total:** about 15 days of work at T-shirt sizing, against 9 build days. This fits **only**
  with CORE's demonstrated AI-assisted cadence (MOD-08 took about 3 days) and the `commit()`
  leverage. Buffer: 6 to 8 Dec.
- **Cut line rationale:** everything named in the spec's section 19 "Core" list, or in a section 20
  acceptance scenario, is above the line. Everything in section 19 "Optional" is below it. So is
  infrastructure that a poll or a single-thread commit makes unnecessary (push, holds, workers).
- **Fallback order if we slip:** drop #19 email to "display + verbal" (spec section 6 allows
  verbal communication, and the AS "Email failure" row requires the flow to work without email),
  then simplify #20 dashboard to counts + occupancy list, then make #17 groups "assign one by one
  with a capacity hint". Never drop #2, #7, #12, #13 or #21.

## Appendix D: Phased roadmap with milestones and decision points

| Date | Phase | Scope | Milestone | Decision point |
|------|-------|-------|-----------|----------------|
| 27 to 28 Nov | Decide | Council converges; send the section-22 question list to the client through the user | Design signed off | Client answers due **1 Dec** (seat numbers, mixed tables, release delegation, industry map owner) |
| 28 Nov to 1 Dec | Tier 0 | #1 to #10, #24 prep, AS: last seat, duplicate check-in, preferred/no-show, all full | Released to production with the module switched **off** for non-admins | Is the staff loop usable on a phone? Is `db.save()` time acceptable with the real `db.json` size? (Tuner) |
| 2 to 3 Dec | Tier 1 | #11 to #15, #25, #28; AS: cross-scope rejected, reallocation | Guest QR page live behind the registration toggle (off) | Final guest list + industries + table inventory **due 3 Dec**; import the real data |
| 4 to 5 Dec | Tier 2 | #16 to #23; AS: transfer/swap/release, group, unlisted/substitute, email failure, offline | **Client acceptance demo, 5 Dec**: all 12 scenarios on several devices | Go / no-go on email (SMTP sender for Legati verified?) and on the seat picker |
| 6 to 7 Dec | Harden | Load test (300 guests + 15 staff, 10-minute burst, from one IP), dress rehearsal with real staff accounts, fixes only | Data freeze **6 Dec**; restore drill **7 Dec** | Any open Sev-1 → apply the fallback order above |
| 8 Dec | Freeze | Deploy freeze starts; full backup; print the contingency pack; staff 2-step enrolment checked | Event-ready | none |
| 9 Dec | Event | Monitoring; Super Administrator plus a stand-by CORE admin for break-glass only | YEP 2026 | none |
| 10 Dec + | v1.1 | Freeze lifted; export archive; PII retention/purge (#33); retro | Post-event report | Is CUSTOM APP worth generalising? Only if a second client app is on the table |

## Appendix E: Success metrics (light analytics-design, from timestamps already in the change log)

Every guest record already carries `verifiedAt`, `checkedInAt` and `seatedAt`, and emails carry
`notifiedAt`. These come from the change log at no extra cost, so we can measure:

- **Zero** overbooked tables, duplicate check-ins or double seats. This is a hard gate, checked by
  an invariant scan after the load test and after the event.
- QR scan to "checked in": median under 30 s.
- Checked in to seated (regular/employee): 90th percentile under 2 minutes at peak.
- Peak queue depth per staffer, and the share of guests seated at a recommended table (does the
  ranking help?).
- Email delivered / failed / resent counts.
- Share of guests who self-verified versus were assisted (does the QR page pay for itself?). This
  answers the post-event decision on investing in the guest page for event #2.

## Quality checks (mvp-scoping)

- [x] All proposed features enumerated (spec sections 1 to 22, the council's open questions, and
  the Skeptic/Advocate blockers)
- [x] MoSCoW justified against section 19 Core/Optional and the section 20 acceptance scenarios
- [x] Consistent T-shirt sizing, with a stated cadence assumption
- [x] Value tied to the core loop and the acceptance scenarios
- [x] Matrix plotted with all features
- [x] Cut line explicit, with a fallback order
- [x] Roadmap has dated milestones and decision points
- [x] Won't-haves documented with reasons
