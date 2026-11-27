# Plan: YEP 2026 Registration (CUSTOM APP), 28 Nov – 10 Dec 2026

Session: `custom-app-yep-2026-registration-20261127-0748` · PRD: `prd.md` · Contract: `acceptance-contract.md`
(204 criteria) · Event: Wednesday 9 Dec 2026.

**Capacity.** About 15.5 dev-days of build in 9 build days (28 Nov – 6 Dec), at CORE's observed cadence
(MOD-08 went from engine to release in about 3 days). 6 to 8 Dec are buffer. Test work is written with
each command, in the same commit. Operator time (staging, load tests, drills, freeze) runs alongside.

**Rule for every push.** `npm run test:event` (under 5 s) per edit; `npm test` and `npm run journeys`
per push; each tier commit carries the version bump, devlog entry, guide section, `whats-new.md`
line and retaken screenshots (`npm run guides:screenshots -- <file.jpg>`), and its acceptance rows green.

## 1. Story dependencies (what must land before what)

| Story | Needs first | Unblocks |
|---|---|---|
| US-001 Ops half-day: freeze guard, kept release, rollback, crash logger | — | **Every** production push from Tier 0 on; US-028, US-029 (kill drill), US-030 (freeze) |
| US-002 Restore carve-out | `ca*` defaults in `server/db.js` (same commit) | Any event data in production; US-029 (restore attempt) |
| US-003 Event rate-limit buckets, staff sign-in allowance | US-005 (`MODULE_API` for `/api/public/event`) | US-014 (300-verify proof), US-028 (zero 429s) |
| US-004 save() measurement, 30 Nov gate | Production copy over SSM | The storage decision; a possible 2-day split; a possible 7 Dec resize |
| US-005 Module shell, `eventstaff` account type | — | US-006, US-007 and everything in the module |
| US-006 Event, table and industry setup | US-005; US-007 for `table.*` commands | US-008, US-009, US-018 (industries) |
| US-007 `commit()`, `claimsAt()`, invariants, refusals, `opId` | US-005 | Every command story: US-006, US-008–US-013, US-014, US-017, US-021–US-025 |
| US-008 Guest import with collision report | US-006, US-007; R2 normalisers in `model.js` | US-014 (lookup keys), the 3 Dec real import |
| US-009 Seat commands | US-006, US-007 | US-010, US-013, US-021, US-022, US-024 |
| US-010 Staff Find guest and seating screens | US-009 | US-017 (My queue reuses the sheet), US-021 |
| US-011 Super Administrator and flags | US-007 | US-014 (`registrationOpen`, `readOnly`), US-019 (`pollMs`), US-023 (`emailPaused`), US-025 (`readOnly` reconcile) |
| US-012 Export JSON v1, CSV, plan | US-007, US-009 | US-020 (5-minute copies), US-025 (print pack), US-028/029 (comparisons) |
| US-013 Tier 0 proof suite | US-007, US-009 (+ `npm run test:event`) | **Tier 0 release (1 Dec)** |
| US-014 Public verify | US-003, US-007, US-008, US-011 | US-015, US-016 |
| US-015 Status page and token | US-014 | US-019 (guest polling), US-023 ("Screenshot this screen"), US-028 |
| US-016 QR presence key (Should) | US-014; enabled only after US-028 passes | — (fallback item 5) |
| US-017 Delegation, scope, My queue, four-device journey | US-007, US-010 | US-018 (`mine`/`othersReadOnly`), US-019 (scoped board), US-021, US-022, US-024 |
| US-018 Recommendation engine | US-006 (industries), US-017 (scope) | US-021 (group fit) |
| US-019 Live sync | US-007 (`seq`), US-017 (scope) | US-024, US-028 (load profile) |
| US-020 Safety nets | US-012 | US-024 (health strip), US-028 (invariant scan) |
| US-021 Group arrivals | US-009, US-017, US-018 | US-027 |
| US-022 Unlisted guests and substitutes | US-009, US-017 (Super Administrator inbox) | US-024 (exceptions inbox), US-027 |
| US-023 Email outbox | US-007 (`afterCommit`), US-011 (`emailPaused`), US-015; **3 Dec go/no-go** | US-027 (scenario 11) |
| US-024 Event control dashboard | US-017, US-019, US-020, US-022 | US-027 |
| US-025 Offline pack and reconciliation | US-011, US-012 | US-027, US-029 (reconciliation), US-030 (printed pack) |
| US-026 Guide, whats-new, screenshots | Each tier's screens (a part per tier) | `npm test` per tier commit; desk card for US-025/US-030 |
| US-027 Tier 2 acceptance, reuse, 5 Dec demo | US-021–US-026, all Tier 0 and Tier 1 rows | US-029 |
| US-028 Staging drill, standby, load test 1 | US-001; Tier 1 (US-014, US-015, US-019, US-020) on staging | US-016 enablement; US-029 |
| US-029 Load test 2, kill -9 drill, rehearsal | US-027, US-028, US-001, US-002, US-025 | Freeze candidate tag; US-030 |
| US-030 Freeze, event day, close-out | US-029 | YEP 2026 |

## 2. Critical path

US-001 (28 Nov, before any Tier 0 push) → US-005 → **US-007 `commit()`** (the longest single item) →
US-009 seat commands → US-010 staff screens → US-013 proof suite → **Tier 0, 1 Dec** → US-014 public
verify → US-015 status page → US-017 delegation and My queue → US-019 live sync → **Tier 1, 3 Dec** →
US-028 load test 1 (4 Dec) → US-022/US-024 exceptions and Event control → US-027 → **5 Dec demo** →
US-029 load test 2 + kill -9 drill (6 Dec) → US-030 code freeze 7 Dec 18:00 → `DEPLOY_FREEZE` 8 Dec
12:00 → **9 Dec**. Off the critical path but with hard dates: the 30 Nov storage gate (US-004), which
can add ~2 dev-days, and the 3 Dec email go/no-go (US-023), which can remove ~0.75.

## 3. Day by day

| Date | Build (developer) | Operations / gates | Client inputs |
|---|---|---|---|
| **Fri 27 Nov** | Design signed off; this plan, PRD and contract written | — | Send the section-22 questions (prd.md "Client decisions needed") |
| **Sat 28 Nov** | **Morning, first: US-001** (guard, kept release, rollback, crash logger), merged and deployed before any Tier 0 push. Then **US-005** module shell + `ca*` defaults with **US-002** carve-out in the same commit. Start **US-007** `commit()` (statuses, refusals, invariants, `claimsAt()`, `mutation()`) and **US-003** event buckets | **US-004** measurement over SSM: `db.json` size, `save()` p50/p95 (50 runs), `free -m`, instance type, Elastic IP. Deploy 1 through the guard | — |
| **Sun 29 Nov** | Finish **US-007** (`opId`, `HttpError` `{code, fresh}`, save-failure undo, audit). **US-006** event/table/industry setup. Start **US-009** seat commands | Deploy 2 through the guard (module still off) | — |
| **Mon 30 Nov** | **US-009** done. **US-008** import + collision report. **US-011** Super Administrator + flags. **US-012** export. Start **US-010** screens. **US-003** buckets done | **Storage gate (US-004)**: decision in the devlog. Under 50 ms: nothing. 50–150 ms: compact JSON now, coalesced outbox writes with US-023, resize on 7 Dec. **Over 150 ms: split to `data/customapp/<eventId>/` (~2 dev-days, 1–2 Dec) and email drops to "display + verbal"** | Chase decisions 1–4, 7, 8 |
| **Tue 1 Dec** | **US-010** done. **US-013** fuzz (200 seeds), race, Tier 0 acceptance rows (scenarios 1, 4, 6, 7, 10). Guide: Seat a guest, Find a guest at the desk; whats-new; screenshots. **Tier 0 released dark** (module off for non-admins). Start **US-014** | Deploy 3. Start staging rebuild from S3 with RESTORE.md §2 (**US-028**, restore drill, timed) | **Client decisions due** (1–4, 7, 8) |
| **Wed 2 Dec** | **US-014** public verify (uniform reply, soft cap, window, zero-write failures). **US-015** guest page + token. **US-017** delegation, scope, My queue | Staging: `emailPaused=true`, SMTP to a sink, own hostname and certificate; RTO measured | Staff names and Super Administrator designee (11) |
| **Thu 3 Dec** | **US-018** recommendations, **US-019** live sync, **US-020** 5-minute copies + 60 s self-check, **US-016** presence key (built, off). Four-device journey green; Tier 1 rows (scenarios 2, 8, 9). Guide: When a table fills up. **Tier 1 release** | Deploy 4 (guard exercised ≥4 times). **Email go/no-go** (US-023): go → build in Tier 2; no-go → `emailPaused=true`, "Screenshot this screen". Real import from the final list with collision report | **Final data due**: guest list, table inventory, industries (4, 10); sender address (5); window (9); demo attendees (13) |
| **Fri 4 Dec** | Tier 2 build: **US-021** groups, **US-022** unlisted and substitutes, **US-023** email outbox (if go), start **US-024** Event control | **Load test 1 (US-028)** on staging from one IP, limits ON: zero 429s, `save()` p95 < 100 ms, event-loop p99 < 200 ms, invariants clean. Presence key enabled only if it passes (US-016) | — |
| **Sat 5 Dec** | **US-024** Event control, **US-025** offline pack + reconciliation, **US-026** guide complete (Event control, If the system is down, runbook) + screenshots, **US-027** reuse + all 12 acceptance rows. **Tier 2 release** | Flags shown working with no deploy | **Client acceptance demo: all 12 scenarios on several devices; sign-off** |
| **Sun 6 Dec** | **Data freeze.** Last feature work; from now every fix lands with a test that failed before it. Freeze candidate: fuzz at 1,000 seeds, race ×5, tagged commit | **Load test 2 + kill -9 drill (US-029)** on the real list: staff back within 3 minutes; no committed check-in lost; restore attempt leaves the event untouched; Super Administrator transfer < 2 minutes; reconciliation clean. **Dress rehearsal** with real staff accounts and 2-step sign-in. Fallback order applied to any open Sev-1 | Staff accounts and delegation in place (11); venue connectivity (12) |
| **Mon 7 Dec** | Buffer (fixes only, each with a failing-first test) | **Code freeze 18:00**; GitHub `production` reviewer gate on; event build tagged; resize to t3.small if the gate asked (Elastic IP checked first) | — |
| **Tue 8 Dec** | Buffer | **`DEPLOY_FREEZE` from 12:00** (a deliberate push must fail with exit 3). Full backup. Offsite drop-in `OnCalendar=*:05/15`. Print the contingency pack | — |
| **Wed 9 Dec** | On call beside the Super Administrator with `ltdc-erp-rollback`, the runbook and the standby URL | T-3h checklist; standby topped up; doors: `registrationOpen` on; act-on thresholds and degrade ladder; close: final export, offsite backup, retention date | Retention date (14) |
| **Thu 10 Dec** | Retro; v1.1 import reader; generalise only if a second client app exists | **09:00**: remove the freeze file and the timer drop-in; resize back; snapshot and decommission staging; archive the export to the client; start the PII purge clock | Post-event report |

## 4. Gates and decision points

| When | Gate | Pass / decision | If it fails |
|---|---|---|---|
| 28 Nov, before the first Tier 0 push | US-001 merged and deployed | Guard and rollback in place | No Tier 0 push until it is |
| **30 Nov** | **Storage gate** (US-004, design A8) | p95 < 50 ms: nothing; 50–150 ms: compact JSON → coalesced 2 s outbox writes → t3.small on 7 Dec | **> 150 ms**: split into `data/customapp/<eventId>/` (~2 dev-days on the `offsite.js` `documents/` precedent) and **email drops to "display + verbal"** to pay for it |
| **1 Dec** | Tier 0 released dark | Scenarios 1, 4, 6, 7, 10 green; fuzz 200 seeds; race | Fallback order (section 5) |
| **3 Dec** | Tier 1 release; **email go/no-go** | Scenarios 2, 8, 9 green; four-device journey green. Go: outbox in Tier 2 | No-go: outbox ships with `emailPaused=true`, model unchanged; guests see "Screenshot this screen" |
| 4 Dec | Load test 1 | Zero 429s; `save()` p95 < 100 ms; loop p99 < 200 ms; invariants clean | Presence key stays off; raise `pollMs`; fix and re-run before 6 Dec |
| **5 Dec** | Tier 2 release; **client acceptance demo** | All 12 scenarios on several devices; flags with no deploy; sign-off | Fallback order; re-demo the open scenario on 6 Dec |
| 6 Dec | Load test 2 + kill -9; freeze candidate | Section O7 pass marks; fuzz 1,000; race ×5; tag | Apply the fallback order to any open Sev-1 |
| 7 Dec 18:00 | Code freeze | Reviewer gate on; build tagged | — |
| 8 Dec 12:00 – 10 Dec 09:00 | `DEPLOY_FREEZE` | A deliberate push fails with exit 3 | Override only through `freeze_override`, logged |

## 5. What gets cut first if the schedule slips

From the design (S3), applied **one at a time, at the first missed tier date**:

1. **Email becomes display + verbal** (US-023 ships with `emailPaused=true`; also the price of a
   storage split on 30 Nov).
2. **The dashboard becomes counts plus the occupancy list** (US-024 trimmed; the exceptions inbox
   stays, it is a Must).
3. **Groups become one-by-one assignment with a capacity hint** (US-021).
4. **The presence key is dropped** (US-016).
5. **The room model's extras go first, never the chair choice** (US-031): keep the plan, the chair buttons and the server checks; drop the zoom and pan and the arrow-key moves before anything else in it.

(27 Nov: the seat picker is no longer in this list. Admins choose a chair for every guest on the room model, US-031, so it is a Must.)

**Never dropped (Must):** `commit()` + `claimsAt()`; reserved seats; the `replaceData()` carve-out;
event-scoped rate-limit buckets; the guest page with uniform replies, status token, window and soft
cap; delegation and per-owner queues; recommendations; import with collision report; assisted search
and check-in; export JSON v1, CSV and printable plan; the 5-minute on-box export copy; the failure-rate
alarm; flags in `commit()`; the 60 s invariant self-check; the acceptance and fuzz suites; the printed
contingency pack; the exceptions inbox; the 28 Nov ops half-day.

Not in scope at any date: holds, SSE/WebSocket, an event import/restore endpoint, persisted sessions,
a QR redirect host, a graphical floor plan, SMS, analytics, a generic app framework, queue mode or
workers (prd.md Non-Goals).


## Addendum (27 Nov): the room model (US-031)

- **Where it lands:** Tier 1, 2-3 Dec, beside the delegated queues (US-017), after the room data in Tier 0 (US-006 creates tables from `caEvents.room`; add this to US-006 on 30 Nov).
- **Depends on:** US-006 (tables and room), US-007 (`commit()`), US-009 (`assign` with `seatNo`), US-017 (scope), US-018 (`recommend()`), US-019 (short poll).
- **Effort:** about 2 dev-days. The plan was about 15.5 dev-days; it is now about 17.5 against 9 build days, so either a second developer joins from 1 Dec or the cut order above is applied from the 3 Dec gate.
- **Client inputs:** numbered chairs on every table (decision 1) and the real room size (decision 1a: 250 chairs against about 300 guests), both by 1 Dec.
