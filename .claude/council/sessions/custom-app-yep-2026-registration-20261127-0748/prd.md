# PRD: YEP 2026 Registration & Table Assignment — the first app of the CORE module "CUSTOM APP"

Session: `custom-app-yep-2026-registration-20261127-0748` · Written 27 Nov 2026 (12 days to the event) ·
Source: the approved `design.md`, the client brief `spec.txt` (Legati Group, 27 Nov 2026) and `interview-summary.md` ·
Companion files: `acceptance-contract.md` (every criterion, locked), `test-stubs/` (BDD stubs), `plan.md` (dates and order).

## Overview

CUSTOM APP (`customapp`, a new entry in `shared/modules.js`) is a thin CORE module that holds
client-specific apps behind an `APPS` registry. Its first app is a **generic event-registration
engine** (events, guests, tables, delegation, check-in and seating), and Legati Group's YEP 2026
(9 Dec 2026, about 300 guests, a hard limit of 10 per table) is the first event loaded into it.
"Reusable" means **parameterised, not abstracted**: every record is keyed by `eventId`;
classifications, table types, industries and their relationships are data; the code holds no YEP
strings. There is no app builder, no custom fields and no plugin loading. Event data lives in CORE's
`db.json` as `ca*` collections, and only `server/customapp/` reads or writes them.

Every state change goes through one **synchronous `commit()`**: it checks the flags, re-reads the
actor's event role, checks idempotency and revisions, plans the change, checks the invariants
(capacity is counted by one status-agnostic `claimsAt(tableId)`), applies it and calls `db.save()`,
undoing the change in memory if the save throws. Nothing is awaited between the check and the write,
so Node's single thread makes "last seat: only one succeeds", atomic swaps and transfers, and "a
permission change applies at once" hold by construction. Seat claims have exactly two statuses,
`reserved` and `confirmed`.

Live sync is a **short poll** on `changes?since=<seq>`, paced by a server-returned `pollMs`. Guests
use a hardened standalone page at `/event/<code>`: surname plus the last 4 digits of their mobile (or
their full email), exact match on the normalised surname, a hashed per-device status token, and one
byte-identical "please see the desk, code R-482" reply for every failure; a failed attempt never
writes to disk. Event routes have their own rate-limit buckets, sized for a ballroom behind one NAT
address.

The build ships in **three tiers**, each leaving CORE ready for the event: Tier 0 (staff-only
seating) on 1 Dec, released dark; Tier 1 (guest QR page, delegated queues, recommendations) on 3 Dec;
Tier 2 (exceptions, email, dashboard) on 5 Dec with the client acceptance demo. A small operations
layer ships **first, on 28 Nov** (freeze guard, kept previous release with one-command rollback,
`unhandledRejection` logger), followed by two single-IP load tests, a kill -9 drill, a technical
deploy freeze from 8 Dec 12:00 to 10 Dec 09:00, a warm standby for staff and a printed contingency
pack. The build is about 15 dev-days; 6 to 8 Dec are buffer.

## Goals

1. **The 10-per-table limit holds at all times**, counting confirmed and reserved seats, under
   simultaneous assignment from many devices: zero overbooked tables, zero double seats and zero
   duplicate check-ins in every invariant scan (after each load test and after the event).
2. **Guests check themselves in from a common QR** without an app or account, never see the guest
   list, and are never left at a dead end: QR scan to checked in has a median under 30 s.
3. **Staff seat guests fast and only within their delegated scope**, with industry-ranked
   recommendations: checked in to seated has a p90 under 2 minutes at peak.
4. **Exactly one Super Administrator per event** with authority over every guest and table;
   delegation and reallocation take effect on the next request.
5. **The night survives failure**: no deploy can restart production during the freeze; a crash
   restarts in seconds; staff are back in, or on paper, within 3 minutes of a kill -9; at most 5
   minutes of data at risk on the box and 15 off it; paper changes re-enter through `commit()`
   without duplicates.
6. **All 12 acceptance scenarios of spec section 07 are demonstrated to the client on 5 Dec** on
   several devices, each backed by a named test.
7. **The engine is reusable for event #2 as it is**: the acceptance-critical cases pass over a second
   "Test Gala" event, and no YEP string exists in `server/customapp`.
8. **CORE conventions hold**: no new dependencies (Node standard library only), the guide, whats-new
   line and screenshots land in each tier commit, and `npm test` and `npm run journeys` stay green.

## Non-Goals

Everything below is deferred or marked Won't before 9 Dec by the design (S1, Tension Resolutions,
Decision Log). None of it is to be built for YEP 2026.

| Not built | Why / what replaces it |
|---|---|
| **Seat holds** (a `held` status, TTL holds) | `seat.status` is the closed enum `{reserved, confirmed}`; a single-request staff commit has no checkout window to protect. n8n's `reserve()`/`release()` is the model if holds are ever added. |
| **SSE or WebSocket push**, and long-poll | Short poll with `pollMs`; the `wait` parameter is reserved and ignored. SSE is on Hold until after 9 Dec (push would carry only `{seq}`). |
| **An event-only import or restore endpoint** | Won't before 9 Dec. The export format `customapp.event/1` is frozen with a golden test; a v1.1 reader comes after the event. Recovery = standby plus replaying commands through `commit()`. |
| **Persisted staff sessions** | Not changing the VAPT-hardened `auth.js` 12 days out. Mitigated by the freeze, the crash logger, the event sign-in allowance, staff on 4G and a rehearsed re-login. |
| ~~A graphical floor plan / ballroom layout~~ | **Moved into scope on 27 Nov at the user's request: see US-031 (interactive room model).** |
| **SMS** | Email (Tier 2, go/no-go 3 Dec), on-screen display and verbal notice only. |
| **Detailed analytics** | Only the S4 success metrics and the post-event report from `caChanges`. |
| **A QR redirect host** for guests to the standby | The standby is for staff only; guests are sent to the desk. |
| **A per-event store** (`data/customapp/<eventId>/`) | Only if `save()` p95 is over 150 ms at the 30 Nov gate. |
| **A generic app framework, custom fields, plugin loading or a CORE-wide outbox** | CUSTOM APP is a thin module with one `events` app; generalise after 9 Dec only if a second client app exists. |
| **Queue mode, clustering or worker threads that write** | One process, one writer: a second process breaks the atomicity of `commit()`. |
| **Device-side offline mode / PWA** | Paper by owner partition, stamped "as of", replayed through `commit()`. |
| **Fuzzy public search, candidate lists, first-name fallback** | Exact match on the normalised surname only; partial search only behind sign-in. |
| **HMAC-signed URLs, IP allowlists for guests** | Rejected in the technology radar. |
| **A typed rotating desk code** | Could: built only if the client asks; off by default. |
| **Bulk redistribution of a staffer's queue** | Follow-up; per-guest and per-table "Move to…" is built. |
| **Optimistic UI** | Not allowed: a refusal re-renders from `fresh`. |
| **A global lockout on the public page** | An alarm only; the soft cap is per surname and cleared at the desk. |

## Quality Gates

The commands below are the real ones in this repository (`package.json`: `npm test` = `node --test`;
`npm run journeys`; `npm run guides:screenshots`). Tests follow CORE's flat layout,
`test/customapp-<area>.test.js`, using the design's file names (Q2); `npm run test:event` is a new
script alias for `node --test test/customapp-*.test.js`, not a dependency.

| Gate | Command | Required |
|---|---|---|
| Event suite, per edit | `npm run test:event` (= `node --test test/customapp-*.test.js`, added to `package.json` in US-013) | Green; runs alone in under 5 s; fuzz at 50 seeds |
| Full suite, per push | `npm test` (= `node --test`) | Green, including `test/guides.test.js`, `test/modules-roadmap.test.js` and `test/favorite-modules.test.js` with `customapp` added |
| Browser journeys, per push | `npm run journeys` | Green, including "Event night, four devices" (from Tier 1); nothing wider than 390 px |
| Guides and screenshots, per tier | `npm run guides:screenshots -- <file.jpg>` (all: `npm run guides:screenshots`), then `npm test` | Every changed screen retaken; every image listed in `docs/guides/screenshots.json`; guide, `whats-new.md` line, version bump and devlog entry in the same commit |
| Acceptance rows, per tier | `node --test test/customapp-acceptance.test.js` | That tier's rows green (Tier 0: 5 rows on 1 Dec; Tier 1: 3 on 3 Dec; Tier 2: 4 on 5 Dec; all 12 for the 5 Dec demo) |
| Storage gate, 28 Nov measure / 30 Nov decide | 50 runs of `JSON.stringify` + `writeFileSync` on a production copy (over SSM, read-only) | `save()` p95 under 50 ms: nothing; 50–150 ms: levers in order; over 150 ms on 30 Nov: split, email to display + verbal. Decision in the devlog |
| Fuzz, CI / freeze | `node --test test/customapp-fuzz.test.js` (seed count raised for the freeze run) | 200 seeds in CI; 1,000 seeds green on the 6 Dec freeze candidate; invariants `[]` after every step |
| Race, freeze | `node --test test/customapp-race.test.js` (×5 at freeze) | Each run: one 200 and nine 409s for the last seat; one check-in for two parallel check-ins; invariants `[]` |
| Load test 1, 4 Dec (staging, one source IP, limits ON) | `node scripts/event-load.mjs` (run 1 profile) | Zero 429s to real guests and staff; `save()` p95 under 100 ms; event-loop delay p99 under 200 ms; invariant scan clean |
| Load test 2 + kill -9 drill, 6 Dec (real list) | `node scripts/event-load.mjs` (run 2) with `systemctl kill -s KILL ltdc-erp` at minute 5, a CORE Admin restore attempt and a Super Administrator transfer | Staff back in, or on paper, within 3 minutes; no committed check-in lost versus the export just before; event untouched by the restore; transfer under 2 minutes; reconciliation through commands gives zero violations |
| Restore drill, 1–3 Dec | `deploy/aws/RESTORE.md` §2 on staging, each step timed | RTO from "primary lost" to "staff on the standby URL" under 30 minutes |
| Deploy safety, 28 Nov to 7 Dec | Production deploys through `deploy/aws/remote-deploy.sh` | At least 4 deploys exercise the freeze guard and the kept release; a deliberate push after 8 Dec 12:00 fails the deploy job with exit 3 |
| Hard gates, after each load test and after the event | `GET /api/customapp/events/:id/invariants` | Zero overbooked tables, duplicate check-ins, double seats, holds and expiry releases; exactly one Super Administrator |
| Flow, dress rehearsal 6 Dec and event | Timings from `caChanges` | QR scan to checked in: median under 30 s; checked in to seated: p90 under 2 minutes at peak |
| Client acceptance, 5 Dec | Live demo on several devices | All 12 spec section 07 scenarios observed and signed off by Legati/ICD |

## User Stories

Thirty stories in tier order: the 28 Nov operations items, Tier 0 (1 Dec), Tier 1 (3 Dec), Tier 2 (5 Dec), then the readiness work (load tests, drills, freeze, event day). Every criterion is numbered in `acceptance-contract.md` (AC-001 to AC-204) with its method and test. Sizes marked "design" come from `design.md`; the rest are estimates. Together they come to about 15.5 dev-days of build, against the design's 14.5 to 15 (test work written with each command is inside each size); readiness stories US-028 to US-030 are mostly operator time. 6 to 8 Dec are buffer.

### US-001: 28 Nov ops half-day: freeze guard, kept release, rollback and crash logger

**Description:** As the on-call developer, I want a deploy that cannot restart production during the freeze, a one-command way back to the previous release and a process that survives a stray promise, so that the event cannot be lost to a push or a crash.

**Tier:** Ops (28 Nov) · **Due:** 28 Nov 2026 · **Agent:** Operator · **Size:** ~0.5 dev-day (design O1), merged before any Tier 0 push

**Acceptance Criteria:**
- [ ] `remote-deploy.sh` exits with code 3 and prints "Deploys are frozen (<reason>). Nothing was changed." when `$APP/data/DEPLOY_FREEZE` exists and `DEPLOY_FREEZE_OVERRIDE` is unset, and the guard runs before the unit reinstall and `update.sh` (nothing on disk changes). *(AC-001, integration-test)*
- [ ] With `DEPLOY_FREEZE_OVERRIDE` set, the guard lets the deploy continue past the freeze check. *(AC-002, integration-test)*
- [ ] `.github/workflows/deploy-ec2.yml` declares an optional `freeze_override` input, passes it to the remote step as `DEPLOY_FREEZE_OVERRIDE`, and an override is written to the audit log or devlog; exit code 3 fails the deploy job (never a silent pass). *(AC-003, unit-test)*
- [ ] `deploy/aws/update.sh` copies the running release to `/opt/ltdc-erp-prev` with `/data/` excluded before `systemctl stop`. *(AC-004, unit-test)*
- [ ] `/usr/local/sbin/ltdc-erp-rollback` stops the service, restores `/opt/ltdc-erp-prev` over `$APP` with `/data/` excluded, applies the same chown/chmod as `update.sh`, starts the service and passes the health loop (proved once on staging, recorded in the devlog). *(AC-005, manual-check)*
- [ ] An `unhandledRejection` is logged and recorded to the monitor, and the process keeps serving (spawned child-process test). *(AC-006, integration-test)*
- [ ] An `uncaughtException` is logged and recorded, then the process exits with code 1 so systemd restarts it in 3 s. *(AC-007, integration-test)*
- [ ] At least 4 production deploys exercise the freeze guard and the kept previous release before 7 Dec (counted from the deploy history, recorded in the devlog). *(AC-008, metric)*

### US-002: Restore carve-out keeps live event data

**Description:** As the event Super Administrator, I want a CORE restore, "Erase all data" or demo data to leave live event data alone, so that no check-in is ever rolled back by an unrelated admin action.

**Tier:** Ops (28 Nov) · **Due:** 28 Nov 2026 · **Agent:** Skeptic · **Size:** XS (design: one line plus a test), plus the notices

> Lands in the same commit as the `ca*` defaults in `server/db.js` `emptyData()` and `openDb`, before any event data exists in production.

**Acceptance Criteria:**
- [ ] `replaceData()` keeps the live `caEvents`, `caTables`, `caGuests`, `caChanges` and `caOutbox` whenever the live data holds at least one event: restoring a backup at `seq` 50 over a live event at `seq` 120 leaves the event and its `seq` unchanged. *(AC-009, unit-test)*
- [ ] "Erase all data" and loading demo data also leave the live `ca*` collections and `seq` untouched. *(AC-010, unit-test)*
- [ ] When the live data holds no event (the standby case), `replaceData()` takes the backup's `ca*` collections (not the `next.x?.length ? next.x : db.data.x` pattern). *(AC-011, unit-test)*
- [ ] While any event is `live`, the Admin restore screen says "Event data is not part of a CORE restore". *(AC-012, e2e-test)*
- [ ] `deploy/aws/RESTORE.md` §1 carries a boxed warning that it is forbidden while an event is `live`. *(AC-013, unit-test)*
- [ ] `/api/admin/export` leaves out event PII while an event is live unless "include events" is ticked, and ticking it is audited. *(AC-014, integration-test)*
- [ ] Admin panel → Modules refuses to switch CUSTOM APP off while an event window is open, unless the Super Administrator confirms. *(AC-015, unit-test)*

### US-003: Event rate-limit buckets and the staff sign-in allowance

**Description:** As a registration staffer working behind the venue's single NAT address, I want guest check-in and staff sign-in to keep working for everyone, so that check-in does not stop at about the 20th guest.

**Tier:** Ops (28 Nov) · **Due:** 1 Dec 2026 (started 28 Nov; ships in the Tier 0 release) · **Agent:** Skeptic · **Size:** S (estimate, ~0.5 dev-day)

**Acceptance Criteria:**
- [ ] `/api/public/event/*` is exempt from the generic `api-anon` (120/min) and `public-write` (20/h) buckets. *(AC-016, integration-test)*
- [ ] The event limiter has a per-event global ceiling (600/min), a per-surname bucket for failures, a per-token bucket for polls and a high per-IP ceiling. *(AC-017, unit-test)*
- [ ] The staff allowance raises `signInFailuresPerAddress` and the `auth` bucket for the event window only, and the change is audited. *(AC-018, unit-test)*
- [ ] 30 staff sign-ins and board polls at 2 s from one address within the allowance get zero 429s. *(AC-019, integration-test)*

### US-004: save() measurement and the 30 Nov storage gate

**Description:** As the on-call developer, I want `db.json` size and `save()` p50 and p95 measured on a copy of production, so that the storage decision on 30 Nov is made from numbers.

**Tier:** Ops (28 Nov) · **Due:** 30 Nov 2026 · **Agent:** Operator · **Size:** XS operator time; the split, if it trips, is ~2 dev-days (design A8)

**Acceptance Criteria:**
- [ ] On 28 Nov, over SSM and read-only: `db.json` size; p50 and p95 of 50 runs of `JSON.stringify` + `writeFileSync` on a copy; `free -m` and the instance type; `aws ec2 describe-addresses` (an Elastic IP before any resize), all recorded in the devlog. *(AC-020, manual-check)*
- [ ] `save()` p95 is classified against the A8 bands: under 50 ms nothing; 50 to 150 ms compact JSON, then coalesced 2 s outbox status writes, then a t3.small resize on 7 Dec; over 150 ms on 30 Nov the split to `data/customapp/<eventId>/`. *(AC-021, metric)*
- [ ] The 30 Nov decision is recorded in the devlog; if the split is chosen, email drops to "display + verbal" (`emailPaused=true`) to pay for it. *(AC-022, manual-check)*

### US-005: CUSTOM APP module shell and the Event staff account type

**Description:** As a CORE administrator, I want a CUSTOM APP module with an `APPS` registry and an Event staff account type that opens only CUSTOM APP, so that event staff use their CORE accounts without seeing the rest of the ERP.

**Tier:** Tier 0 · **Due:** 1 Dec 2026 · **Agent:** Architect · **Size:** S (estimate, ~0.25 dev-day)

**Acceptance Criteria:**
- [ ] `shared/modules.js` has a `customapp` entry, `MODULE_API` `^/api/(customapp|public/event)(/|$)` and its `MODULE_PARTS`, and `customapp` is added to the modules-roadmap test. *(AC-023, unit-test)*
- [ ] `customapp` is added to the favorite-modules test and passes. *(AC-024, unit-test)*
- [ ] `GET /api/customapp/apps` returns the `APPS` registry with exactly one entry, `events`. *(AC-025, integration-test)*
- [ ] `shared/roles.js` has an `eventstaff` account type with `customapp.use` only and a `customapp.manage` permission; an Event staff user sees only CUSTOM APP and gets 403 from every other module API. *(AC-026, integration-test)*
- [ ] With the module switched off, `/api/customapp/*` and `/api/public/event/*` refuse (module gating). *(AC-027, integration-test)*
- [ ] Tier 0 is released dark on 1 Dec: the module is off for non-admins in production. *(AC-028, manual-check)*

### US-006: Event, table and industry setup

**Description:** As the event Super Administrator, I want to set up the event, its tables, industries, staff and settings as data, so that YEP 2026 runs with no YEP strings in code and the next event reuses the engine.

**Tier:** Tier 0 · **Due:** 1 Dec 2026 · **Agent:** Architect · **Size:** M (estimate, ~0.5 dev-day)

**Acceptance Criteria:**
- [ ] `POST /api/customapp/events` needs `customapp.manage`; `GET` lists only events the caller has a role in; `PATCH /api/customapp/events/:id` carries `rev` and a stale `rev` gets 409 `stale`. *(AC-029, integration-test)*
- [ ] The event `code` is a slug with a random suffix (for example `yep26-k3f9`) so the page cannot be guessed before the QR is shown. *(AC-030, unit-test)*
- [ ] `industries[].related` is kept symmetric on every write. *(AC-031, unit-test)*
- [ ] Table `capacity` is limited to 1..`hardLimit` (10); classification is one of `preferred|regular|employee|mixed`; each table has at most one owner. *(AC-032, unit-test)*
- [ ] A table cannot shrink below its claims or be deactivated while it holds claims (`table_has_claims`, I8) unless a `table.relocate` in the same commit empties it. *(AC-033, unit-test)*
- [ ] Window times are stored as UTC instants and shown in Asia/Manila. *(AC-034, unit-test)*

### US-007: commit() unit of work, claimsAt(), invariants and typed refusals

**Description:** As registration staff, I want every change to go through one synchronous commit that re-checks capacity, scope and revisions just before it writes, so that the last seat goes to only one person and nothing is ever overbooked.

**Tier:** Tier 0 · **Due:** 1 Dec 2026 · **Agent:** Architect · **Size:** M (estimate, ~1.25 dev-days)

> `opId` idempotency is part of `commit()` here (Q2 `customapp-api`, Tier 0); the browser's `opId` on retries ships with Tier 1 as the roadmap lists.

**Acceptance Criteria:**
- [ ] `server/customapp/events/commit.js` and `engine.js` contain no `await` (a source test greps them). *(AC-035, unit-test)*
- [ ] `mutation()` refuses an `AsyncFunction` at startup and a handler that returns a thenable at run time. *(AC-036, unit-test)*
- [ ] `claimsAt(tableId)` counts every claim whatever its status: a table with 8 confirmed and 2 reserved seats refuses an assign with 409 `table_full`. *(AC-037, unit-test)*
- [ ] `SEAT_STATUSES` is frozen as `['reserved','confirmed']`; an exhaustiveness test fails if it changes without a classification; no file other than `shared/customapp/seating.js` counts by `seat.status`. *(AC-038, unit-test)*
- [ ] `checkInvariants()` catches each of I1–I10 broken by hand and returns `[{rule, ids, detail}]`; a clean state returns `[]`. *(AC-039, unit-test)*
- [ ] When `db.save()` throws, `commit()` undoes the change in memory, nothing is audited or queued, and the reply is 503 `not_saved`. *(AC-040, integration-test)*
- [ ] Each successful write records exactly one audit entry (`afterCommit` → `audit.record`), labelled with the guest ref and a masked name, never the mobile or email. *(AC-041, integration-test)*
- [ ] Every commit appends one compact `caChanges` entry `{seq, eventId, at, actorId, via, type, opId, guestIds, tableIds, diff, reason}`, increments `ev.seq` and the `rev` of every touched record. *(AC-042, unit-test)*
- [ ] Every code in `shared/customapp/refusals.js` (409: `stale`, `table_full`, `seat_taken`, `not_eligible`, `no_eligible_seat`, `already_checked_in`, `guest_moved`, `table_has_claims`, `op_replay_mismatch`, `read_only`, `registration_closed`; 403: `out_of_scope`, `needs_super_admin`; 503: `not_saved`) is produced by at least one test; tests assert codes, never message text. *(AC-043, unit-test)*
- [ ] `HttpError(status, message, {code, fresh})` is backward compatible, and `handle()` serialises `{error, code, fresh}`. *(AC-044, unit-test)*
- [ ] A command whose `expect` revision is out of date gets 409 `stale`, with `fresh` holding the current state and re-ranked options. *(AC-045, unit-test)*
- [ ] `opId` replay with the same body returns the prior result without a second write; the same `opId` with a different body gets `op_replay_mismatch`; the idempotency map is rebuilt from `caChanges` at boot. *(AC-046, integration-test)*

### US-008: Guest import with collision report

**Description:** As the event Super Administrator, I want to import Legati's Excel or CSV guest list and see every problem before registration opens, so that each guest can verify on their phone and nobody is matched to someone else.

**Tier:** Tier 0 · **Due:** 1 Dec 2026 · **Agent:** Architect · **Size:** M (estimate, ~0.75 dev-day)

**Acceptance Criteria:**
- [ ] CSV and XLSX (via `server/pdf/office-core.js` `readZip`/`parseXml`) are imported with header aliases in two steps, `POST .../import` (preview) then `POST .../import/:jobId/apply`; the preview writes nothing and the apply is one commit. *(AC-047, integration-test)*
- [ ] Normalisation follows R2: NFKD and strip diacritics, lowercase, drop spaces, hyphens, periods and apostrophes, strip Jr., Sr., II, III, IV; `altSurnames[]` kept; last 4 taken from the digits-only mobile ("+63 917 123 4567", "09171234567" and "917-123-4567" all give "4567"). *(AC-048, unit-test)*
- [ ] The collision report finds every ambiguous pair (same normalised surname and last 4), every guest with no mobile and no email, possible duplicates, unknown classification or industry, and tables set above capacity. *(AC-049, unit-test)*
- [ ] CR/LF and control characters are stripped from names and companies on import; export prefixes cells starting with `= + - @`, tab or CR with `'`. *(AC-050, unit-test)*
- [ ] Import is capped at about 2 MB and 2,000 rows and is Super Administrator only. *(AC-051, integration-test)*
- [ ] Re-import is idempotent; once the event is live, it merges by `externalKey` and never touches status, seat or owner. *(AC-052, unit-test)*
- [ ] Setup → Import check lists each problem as a count with a fix action (add the full email, add a direct mobile, mark "desk only"); "Open registration" stays disabled with "N issues to resolve" until the list is clear or the Super Administrator acknowledges it. *(AC-053, e2e-test)*

### US-009: Seat commands: check-in, preferred retrieval, reservations, assign, transfer and swap

**Description:** As registration staff, I want check-in and seating to be separate, server-validated commands, so that every seat change respects capacity, eligibility and the preferred guests' reservations.

**Tier:** Tier 0 · **Due:** 1 Dec 2026 · **Agent:** Architect · **Size:** M (estimate, ~0.75 dev-day)

> The engine, API and acceptance tests for transfer, swap and release are green by Tier 0 (Q3); their Event control screens ship in Tier 2 (US-024), as the roadmap lists.

**Acceptance Criteria:**
- [ ] `checkIn` sets `arrival{state:'checked_in', at, by, via}` once; a second check-in with a new `opId` gets 409 `already_checked_in` (I7). *(AC-054, unit-test)*
- [ ] `undoCheckIn` returns the guest to `expected` and is recorded in `caChanges`. *(AC-055, unit-test)*
- [ ] For a preferred guest, `checkIn` turns the `reserved` seat into `confirmed` at the preassigned table and seat. *(AC-056, unit-test)*
- [ ] `reserve` and `release` are allowed only to the Super Administrator, or to the owner when `releaseDelegable` is set; a reason is required; no timer or expiry ever clears a seat (I9). *(AC-057, unit-test)*
- [ ] A preferred guest whose reservation was released goes to the Super Administrator's queue on arrival. *(AC-058, unit-test)*
- [ ] `assign` refuses an occupied `(tableId, seatNo)` with `seat_taken` (I3), a wrong-class table with `not_eligible`, and returns `no_eligible_seat` (referred to the Super Administrator) when no eligible seat remains. *(AC-059, unit-test)*
- [ ] `settings.seatNumbers` (`preferred|all|none`) decides when `seatNo` is required; it is always required for preferred guests. *(AC-060, unit-test)*
- [ ] `transfer` keeps the old seat until the new one validates; `swap` is atomic; both validate every affected seat and the counts update. *(AC-061, unit-test)*

### US-010: Staff Find guest and seating screens

**Description:** As a registration staffer at the desk, I want to find a guest, check them in and choose a table and seat on my phone, so that staff-only seating works from 1 Dec, before the guest page exists.

**Tier:** Tier 0 · **Due:** 1 Dec 2026 · **Agent:** Advocate · **Size:** M (estimate, ~0.75 dev-day)

**Acceptance Criteria:**
- [ ] `GET /api/customapp/events/:id/guests?q=&class=&status=&table=` searches by partial name or company, masks contact details ("•••• 4417"), and shows non-owners only name, company, industry and table. *(AC-062, integration-test)*
- [ ] Check in (any staffer) and Seat (owner or Super Administrator only) are separate transitions with separate permissions. *(AC-063, integration-test)*
- [ ] Seating takes two taps: tapping a table preselects the first free seat, Confirm repeats the choice ("Seat at Table 5"), taken seat chips are disabled and seat chips are mandatory for preferred guests. *(AC-064, e2e-test)*
- [ ] The 10-dot meter shows filled for confirmed and a ring for reserved with a text count ("6 seated · 2 reserved · 2 free"); full tables are disabled for new assignments. *(AC-065, e2e-test)*
- [ ] A 409 re-renders the sheet in place with the guest still selected ("Table 5 just filled. Updated options:"); there is no optimistic UI. *(AC-066, e2e-test)*
- [ ] Staff screens meet the U6 floor: nothing wider than 390 px, inputs at least 16 px, touch targets at least 48 px, keyboard operable, badges and meter states carry text, WCAG AA contrast in both themes, `prefers-reduced-motion` honoured. *(AC-067, e2e-test)*

### US-011: Event Super Administrator and runtime flags

**Description:** As the event Super Administrator, I want to be the one account with authority over every guest and table and to change the runtime flags without a deploy, so that the spec's single-authority rule holds and I can degrade the service safely on the night.

**Tier:** Tier 0 · **Due:** 1 Dec 2026 · **Agent:** Skeptic · **Size:** S (`readOnly` is XS per the design)

**Acceptance Criteria:**
- [ ] Exactly one Super Administrator per event (`superAdminUserId`); a CORE `admin` with `*` gets 403 on a seat write unless designated. *(AC-068, integration-test)*
- [ ] `POST /api/customapp/events/:id/super-admin` (`setSuperAdmin`) needs `customapp.manage`, password re-entry and a reason; the old holder is revoked in the same commit; it is audited; afterwards there is exactly one Super Administrator (I5). *(AC-069, integration-test)*
- [ ] `setFlag` for `registrationOpen`, `emailPaused`, `readOnly` and `pollMs` is Super Administrator only and audited. *(AC-070, unit-test)*
- [ ] Every flag is checked inside `commit()` or carried in the poll reply. *(AC-071, unit-test)*
- [ ] `readOnly` refuses every mutation with `read_only` except reconcile commands from the Super Administrator, and still serves reads. *(AC-072, unit-test)*
- [ ] A flag change applies on the next request, with no restart or deploy. *(AC-073, integration-test)*

### US-012: Export JSON v1, CSV and printable plan

**Description:** As the event Super Administrator, I want one versioned export of the whole event plus CSV and a printable plan, so that there is a single recovery artifact for the laptop, the standby, the printed pack and the client's archive.

**Tier:** Tier 0 · **Due:** 1 Dec 2026 · **Agent:** Operator · **Size:** S (estimate, ~0.5 dev-day)

**Acceptance Criteria:**
- [ ] `GET .../export.json` returns `{format:'customapp.event/1', exportedAt, eventId, seq, sha256, event, tables, guests, changes, outbox}` and matches a golden fixture. *(AC-074, unit-test)*
- [ ] The export contains every claim (reserved and confirmed), its `sha256` verifies, guests carry no token hashes and no PII beyond the agreed fields. *(AC-075, unit-test)*
- [ ] `.../export.csv?kind=` and `.../plan.pdf` are derived from the same export; the CSV is formula-safe. *(AC-076, integration-test)*
- [ ] The export endpoints are Super Administrator only. *(AC-077, integration-test)*

### US-013: Tier 0 proof suite: fuzz, race and the Tier 0 acceptance rows

**Description:** As the developer handing over to Legati, I want the hardest guarantees proved by fuzz, real-socket races and named acceptance tests, so that the 1 Dec release is evidence, not a promise.

**Tier:** Tier 0 · **Due:** 1 Dec 2026 · **Agent:** Craftsman · **Size:** M (inside the design's ~3 days of test work)

**Acceptance Criteria:**
- [ ] `npm run test:event` (`node --test test/customapp-*.test.js`, added to `package.json`) runs alone in under 5 s with fuzz at 50 seeds. *(AC-078, metric)*
- [ ] The fuzz suite runs seeded random command sequences (200 seeds in CI), keeps `checkInvariants()` at `[]` after every step, never produces a hold or a release by expiry, refuses only with catalogue codes and prints the seed on failure. *(AC-079, unit-test)*
- [ ] Over real sockets, 10 parallel requests for the last seat give one 200 and nine 409s; two parallel check-ins of one guest give one check-in; invariants are `[]`. *(AC-080, integration-test)*
- [ ] Acceptance "Preferred guest / no-show": the existing assignment is retrieved; the reserved seat stays blocked until a manual release; a late arrival after release is referred. *(AC-081, integration-test)*
- [ ] Acceptance "Manual alternative / all tables full": a manual alternative is allowed within authority and capacity; nothing is allocated when no eligible seat remains. *(AC-082, integration-test)*
- [ ] Acceptance "Duplicate / simultaneous check-in": only one registration and one allocation per guest. *(AC-083, integration-test)*
- [ ] Acceptance "Last available seat": one concurrent assignment succeeds; the other gets `table_full` with fresh options. *(AC-084, integration-test)*
- [ ] Acceptance "Transfer / swap / release": all affected capacity counts update; no overbooking and no lost assignment. *(AC-085, integration-test)*

### US-014: Public verify with a uniform referral reply

**Description:** As a guest at reception, I want to type my surname and the last 4 digits of my mobile (or my full email) and be checked in at once, so that I do not queue at the desk, while nobody can learn the guest list or a colleague's table from the page.

**Tier:** Tier 1 · **Due:** 3 Dec 2026 · **Agent:** Skeptic · **Size:** M (estimate, ~1 dev-day)

**Acceptance Criteria:**
- [ ] `GET /api/public/event/:code` returns `{name, date, state: closed|open, opensAt}` and nothing else, answered only when the event is `live`. *(AC-086, integration-test)*
- [ ] One exact match on the normalised surname plus last 4 (or the full email) runs `commit(selfCheckIn)` with `via:'self'` and returns `{token, state, firstName, table?, seat?}`; the `selfCheckIn` plan can only check a guest in. *(AC-087, integration-test)*
- [ ] Every failure (no match, ambiguous, capped, malformed, unlisted, window closed mid-request, `registrationOpen=false` or `readOnly` after doors open) returns the same status and a byte-identical body apart from the random `R-xxx` code from one pool. *(AC-088, integration-test)*
- [ ] Failure replies are padded to the success path's timing (timing parity measured under load). *(AC-089, metric)*
- [ ] 1,000 failed verifies cause 0 `db.save()` calls; failed attempts, caps and referral codes live in bounded in-memory maps (TTL 3 h, at most 5,000 entries). *(AC-090, unit-test)*
- [ ] The soft cap is 8 distinct wrong last-4 values per (event, normalised surname) in 15 minutes; a repeated value counts once; it clears after 15 minutes or with one tap at the desk; there is no global lockout. *(AC-091, unit-test)*
- [ ] More than 30 failures in 5 minutes raises an alarm to the Super Administrator and locks nobody out. *(AC-092, unit-test)*
- [ ] The server-enforced activation window: before `window.opensAt` (and after `closesAt`) verify gets the uniform reply; boundaries are tested. *(AC-093, unit-test)*
- [ ] Only `application/json` is accepted, the body is capped at about 1 KB, surnames are 1–80 characters after normalisation with zero-width and control characters stripped, `last4` matches `^\d{4}$`, the email is the full address (at most 254), fields are never echoed, the helpdesk trap field, minimum fill time and a short user-agent denylist apply, and the check order is limiter → window → match. *(AC-094, unit-test)*
- [ ] 300 verifies plus polling from one `x-forwarded-for` give zero 429s while the soft cap still trips. *(AC-095, integration-test)*
- [ ] `GET /api/customapp/events/:id/referral/:code` shows staff the real failure reason and what the guest typed (masked). *(AC-096, integration-test)*

### US-015: Guest status page and status token

**Description:** As a checked-in guest, I want my phone to show my table and seat as soon as staff confirm it, and to keep showing it if I reload, so that I can walk to my table without asking anyone.

**Tier:** Tier 1 · **Due:** 3 Dec 2026 · **Agent:** Advocate · **Size:** M (estimate, ~0.5 dev-day)

**Acceptance Criteria:**
- [ ] The status token is 32 random bytes, stored as SHA-256 and looked up by hash, at most 5 per guest (one per device), revocable by staff, and kept with the event so it survives a restart. *(AC-097, unit-test)*
- [ ] `GET /api/public/event/:code/status` reads the token only from `X-Event-Token` and returns `{seq, pollMs, state: pending|seated|see_desk, title, firstName, table, seat}` or `{seq, pollMs, unchanged:true}`; no reply ever holds another guest's data. *(AC-098, integration-test)*
- [ ] The token (and any `t=`) never appears in monitor, audit or devlog output; replies carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. *(AC-099, integration-test)*
- [ ] Re-verifying from a second device is idempotent (no second check-in), shows the same status and adds a `reverified_other_device` flag for staff. *(AC-100, unit-test)*
- [ ] `/event/<code>` serves standalone `public/event.html` under 40 KB, with its CSP hash in `pagePolicy`, `noindex`, `no-store` and no web fonts. *(AC-101, integration-test)*
- [ ] The guest page shows each U1 state: `closed` ("Registration opens at 6:00 PM.", no inputs), `verify`, `pending` (after 4 minutes adds "Still choosing. A staff member can help at the desk"), `seated` ("Welcome, Ms. Dela Cruz. Table 3, Seat 4", table number 56 px or larger), `referred` ("Please see the registration desk and show this code: R-482.") and `offline`; it never shows "not found", "invalid", "already checked in", a countdown, a lock screen or a 429. *(AC-102, e2e-test)*
- [ ] After verification `history.replaceState` puts the token in the URL fragment (`#s=<token>`) and the page keeps a `localStorage` copy, so a reload shows the status again. *(AC-103, e2e-test)*
- [ ] The status region is `aria-live="polite"`, focus moves to the result heading, and the status line says how old it is ("Updated 6:41 PM"). *(AC-104, e2e-test)*
- [ ] `curl -I` on staging confirms Caddy does not override `Referrer-Policy`, and `deploy/aws/Caddyfile` has no `log` directive. *(AC-105, manual-check)*

### US-016: Zero-typing QR presence key (Should)

**Description:** As a guest scanning the reception QR, I want the QR link to carry a presence key so that I verify with nothing extra to type, while someone verifying remotely without the key is turned away to the desk.

**Tier:** Tier 1 · **Due:** 3 Dec 2026 (built); enabled only after load test 1 passes on 4 Dec · **Agent:** Strategist · **Size:** XS (design)

> Fifth and last item in the fallback order (S3): dropped first if it is not ready, and never enabled unless load test 1 is green.

**Acceptance Criteria:**
- [ ] When the event has `qrKeyHash`, verify with a wrong or missing `k` gets the uniform referral reply and the correct `k` proceeds; the key is stored hashed. *(AC-106, unit-test)*
- [ ] The reception QR sheet (`public/js/vendor/qrcode.js`) encodes `/event/<code>` with the key, and the guest page sends `k` without the guest typing it. *(AC-107, e2e-test)*
- [ ] The key stays off by default and is enabled only after load test 1 passes; the decision is recorded in the devlog. *(AC-108, manual-check)*

### US-017: Delegation, scope enforcement and My queue

**Description:** As a registration staffer, I want my own live queue of the guests and tables delegated to me, and as the Super Administrator I want to reallocate them at once, so that every guest has exactly one person responsible and an absent colleague never strands a guest.

**Tier:** Tier 1 · **Due:** 3 Dec 2026 · **Agent:** Advocate · **Size:** M (estimate, ~1 dev-day)

**Acceptance Criteria:**
- [ ] `delegateGuests` and `delegateTables` are Super Administrator only and never touch seats; each guest and table has at most one owner, who is active staff (I4). *(AC-109, unit-test)*
- [ ] `eventCan` runs on every guest and destination table in a plan; any element out of scope rejects the whole plan with `out_of_scope` or `needs_super_admin` (I10). *(AC-110, unit-test)*
- [ ] Delegations are re-read at commit time: a permission change applies on the next request, and a reallocation leaves confirmed claims intact. *(AC-111, integration-test)*
- [ ] Verified guests are routed to their owner's `queue(owner)`; guests with no owner, unlisted pending, flagged, and released-and-arrived guests are in the Super Administrator's `superQueue`. *(AC-112, unit-test)*
- [ ] Event staff land on My queue: a sticky bar (event name, staffer name, "Last updated 2 s ago"), sections Waiting for table (oldest first), Checked in and seated, and Find guest; cards show name, company, industry chip, a class badge in text and a wait timer that turns amber at 4 minutes and red at 8. *(AC-113, e2e-test)*
- [ ] A guest the Super Administrator moved greys out with "Moved to Maria's queue by the Super Administrator, 6:52 PM" before it leaves the list, and a refused write after a reallocation shows a recovery screen; nothing disappears silently. *(AC-114, e2e-test)*
- [ ] The empty queue reads "No one is waiting for you. Your tables: 5, 6, 7 (14 seats left)." *(AC-115, e2e-test)*
- [ ] Find guest by referral code fills in what the guest typed and the real reason; "Clear cap and check in" works in one tap. *(AC-116, e2e-test)*
- [ ] The "Event night, four devices" journey in `scripts/journeys.mjs` (a guest phone, two staff phones and the Super Administrator's desk, run at once) is green in `npm run journeys`. *(AC-117, e2e-test)*
- [ ] Acceptance "Unauthorised cross-scope action": rejected; the Super Administrator can act or delegate; no duplicate guest or table ownership. *(AC-118, integration-test)*
- [ ] Acceptance "Ownership reallocation / staff absent": the new owner receives the pending queue; the old owner loses write access; confirmed assignments remain intact. *(AC-119, integration-test)*

### US-018: Recommendation engine

**Description:** As a registration staffer, I want eligible tables ranked by industry affinity with a visible reason for each, so that guests meet people from their own or related sectors instead of filling tables in order.

**Tier:** Tier 1 · **Due:** 3 Dec 2026 · **Agent:** Scout · **Size:** M (estimate, ~0.75 dev-day)

**Acceptance Criteria:**
- [ ] `eligible(table, guest, group)` = `table.active` && `classOK` (preferred→{preferred, mixed}; regular→{regular, mixed}; employee→{employee, mixed}; unlisted→its approved class; mixed only when `settings.mixedTables`) && free seats ≥ group size && not `excluded(tags)`. *(AC-120, unit-test)*
- [ ] Ranking: tier 1 same industry, tier 2 related, tier 3 other eligible; within a tier, fits the whole group → more same-industry companions → fewer seats left after placement → table number (deterministic tie-break). *(AC-121, unit-test)*
- [ ] Full and ineligible tables are never listed. *(AC-122, unit-test)*
- [ ] `GET .../recommend?guestIds=` returns `[{tableId, tier, free, reasons[], selectable}]` split into `mine` and `othersReadOnly`, with human reasons ("Same industry: Banking, 3 of 6 seated", "Related: Insurance", "4 seats left"); when nothing fits it returns `{none:true, refer:'super_admin'}`. *(AC-123, integration-test)*
- [ ] `commit()` uses the same `eligible()` as a constraint; the ranking is advisory, so a non-recommended eligible table in scope is accepted. *(AC-124, unit-test)*
- [ ] The bottom sheet shows up to 3 recommendations with reason lines, "Other eligible tables" (collapsed) and a read-only "Not yours" list. *(AC-125, e2e-test)*
- [ ] Acceptance "Regular guest / no match": multiple eligible industry-ranked tables; other eligible tables shown when there is no industry match. *(AC-126, integration-test)*

### US-019: Live sync by short poll

**Description:** As a staffer and as a guest, I want my screen to update within seconds of any change without reloading, so that every device shows the same seats and queues.

**Tier:** Tier 1 · **Due:** 3 Dec 2026 · **Agent:** Scout · **Size:** S (estimate, ~0.5 dev-day)

**Acceptance Criteria:**
- [ ] `GET .../changes?since=<seq>&tab=<id>` returns `{seq, pollMs, unchanged:true}` without building a board when nothing has changed. *(AC-127, unit-test)*
- [ ] When `seq` has moved, the reply is `{seq, pollMs, board}` scoped by the access policy (a non-owner sees name, company, industry and table only). *(AC-128, integration-test)*
- [ ] The `wait` parameter is accepted and ignored. *(AC-129, unit-test)*
- [ ] When the server's `seq` is behind `since` (a restored standby), the client receives a full board. *(AC-130, unit-test)*
- [ ] `pollMs` is 2 s for staff boards, 4 s for pending guest pages and 10 s once seated, with jitter; raising it to 8 s for guests and 4 s for staff applies on the next reply with no deploy. *(AC-131, integration-test)*
- [ ] A reallocated staffer's next poll drops the old queue. *(AC-132, integration-test)*
- [ ] Polling pauses on `visibilitychange` and backs off while offline; after 15 s without updates the sticky bar turns amber and reads "Reconnecting…". *(AC-133, e2e-test)*
- [ ] Change records use the closed `CHANGE_TYPES` set from `shared/customapp/statuses.js`. *(AC-134, unit-test)*

### US-020: Safety nets: 5-minute export copies and the 60 s invariant self-check

**Description:** As the on-call developer, I want an on-box export every 5 minutes and an invariant check every minute, so that at most 5 minutes of data are at risk on the box and any violation is seen at once.

**Tier:** Tier 1 · **Due:** 3 Dec 2026 · **Agent:** Operator · **Size:** XS each (design)

**Acceptance Criteria:**
- [ ] Every 5 minutes the export v1 is written to `data/backups/events/` by the same export function, keeping the last 24. *(AC-135, unit-test)*
- [ ] `GET .../invariants` returns `checkInvariants()` over the whole event (used by the self-check and the load script). *(AC-136, integration-test)*
- [ ] The 60 s self-check runs `checkInvariants()` and records any violation to the monitor, which shows a banner on the health strip. *(AC-137, unit-test)*

### US-021: Group arrivals

**Description:** As a registration staffer, I want to seat a group that arrives together at one table, or split it only when I confirm, so that colleagues sit together without breaking the 10-person limit.

**Tier:** Tier 2 · **Due:** 5 Dec 2026 · **Agent:** Architect · **Size:** S (estimate, ~0.5 dev-day)

> Third in the fallback order: if Tier 2 slips, groups become one-by-one assignment with a capacity hint.

**Acceptance Criteria:**
- [ ] `assign {placements[], allowSplit}` commits every group member in one commit, or none. *(AC-138, unit-test)*
- [ ] Only tables with n or more free seats are ranked for a group of n; when none fits, split suggestions (the largest partitions that fit) are returned and a split needs `allowSplit:true`. *(AC-139, unit-test)*
- [ ] A group whose members have different owners can only be seated by the Super Administrator. *(AC-140, unit-test)*
- [ ] The UI offers checkboxes and "Seat together (n)", needs an explicit "Split group" confirm, and shows "Send group to Super Administrator" for a group with different owners. *(AC-141, e2e-test)*
- [ ] Each group member keeps an individual registration and assignment. *(AC-142, unit-test)*
- [ ] Acceptance "Employee / group arrivals": eligible employee tables; group-fit recommendations; alternatives when the group cannot fit. *(AC-143, integration-test)*

### US-022: Unlisted guests and substitutes

**Description:** As a desk staffer, I want to record a walk-in or a substitute and send it to the Super Administrator for a decision, so that nobody is admitted unverified and a seat is never held twice.

**Tier:** Tier 2 · **Due:** 5 Dec 2026 · **Agent:** Architect · **Size:** S (estimate, ~0.5 dev-day)

**Acceptance Criteria:**
- [ ] `createUnlisted` (any staffer) puts the guest in the Super Administrator's inbox; an unlisted guest cannot be seated before approval. *(AC-144, unit-test)*
- [ ] `approve` and `reject` are Super Administrator only; approval records identity, classification and industry with `{state, by, at, note}`. *(AC-145, unit-test)*
- [ ] `substitute {originalId, newGuest}` moves the seat in one commit and links `substituteFor`/`substitutedBy`; the original and the substitute never both hold a seat (I6). *(AC-146, unit-test)*
- [ ] Add walk-in and Record substitute go to the Super Administrator's inbox; a substitute is shown as one seat changing hands ("Seat 3-4: Juan Reyes replaces Pedro Reyes"). *(AC-147, e2e-test)*
- [ ] The approval and change history (spec s.7 and s.13) is read from `caChanges` with actor and timestamp. *(AC-148, integration-test)*
- [ ] Acceptance "Unlisted / substitute": approval, classification and audit recorded; the original reservation handled without double allocation. *(AC-149, integration-test)*

### US-023: Email outbox

**Description:** As a guest with an email address, I want my table and seat emailed to me when they are confirmed or changed, so that I have it in writing, while a mail failure never touches my check-in or seat.

**Tier:** Tier 2 · **Due:** 5 Dec 2026 (go/no-go 3 Dec) · **Agent:** Scout · **Size:** M (estimate, ~0.75 dev-day)

> First in the fallback order: if the 3 Dec go/no-go says "display + verbal", the outbox ships with `emailPaused=true` and the model does not change.

**Acceptance Criteria:**
- [ ] `smtpOptions()` and `canEmail()` (`server/helpdesk.js:245-261`) are extracted into a shared `mailTransport(db)` used by the helpdesk and the outbox. *(AC-150, unit-test)*
- [ ] `afterCommit` queues an `assignment` or `update` message in `caOutbox` after the save when a seat is confirmed or changed and an address exists, with the body rendered from a seat snapshot; with no address, the notification is "not applicable". *(AC-151, unit-test)*
- [ ] `outbox.js` drains a capacity-1 FIFO outside `commit()`: `sending` → `await sendMail(mailTransport(db))` → `sent` or `failed`, updating `guest.notify`; status writes are debounced to one save every 2 s. *(AC-152, integration-test)*
- [ ] An SMTP failure never touches `seat` or `arrival`; transient errors are retried three times with backoff. *(AC-153, integration-test)*
- [ ] A manual Resend is a `notify` command and creates a new attempt. *(AC-154, integration-test)*
- [ ] `emailPaused` queues messages without sending. *(AC-155, unit-test)*
- [ ] After a restart, a message left in `sending` for more than 2 minutes is queued again. *(AC-156, unit-test)*
- [ ] Messages use the event's own `emailFrom` and `replyTo` (never the helpdesk IMAP mailbox) and names are encoded with `composeMessage` encoded words. *(AC-157, unit-test)*
- [ ] If email is cut, the guest page replaces the "email sent" line with "Screenshot this screen" and the email surfaces are hidden. *(AC-158, e2e-test)*
- [ ] The 3 Dec email go/no-go is recorded in the devlog, and `emailPaused` is set to match. *(AC-159, manual-check)*
- [ ] Acceptance "Email failure / no email": the confirmed assignment stays valid; the display or staff notification works; a retry is available (or the email surfaces are hidden if email is cut). *(AC-160, integration-test)*

### US-024: Event control dashboard

**Description:** As the event Super Administrator, I want one screen with the counts, every table, the exceptions, the staff workload, the system's health and the flags, so that I can direct the night and make safe changes from my desk.

**Tier:** Tier 2 · **Due:** 5 Dec 2026 · **Agent:** Advocate · **Size:** M (estimate, ~0.75 dev-day)

> Second in the fallback order: if Tier 2 slips, the dashboard becomes counts plus the occupancy list. The exceptions inbox is a Must and is never cut.

**Acceptance Criteria:**
- [ ] The counts row (Invited · Checked in · Not yet arrived · Waiting for table · Needs approval · Seats left) is derived from the source and matches a recount. *(AC-161, integration-test)*
- [ ] The occupancy grid shows one tile per table with number, class label, meter with a text count and owner; a full table is dimmed and labelled "Full". *(AC-162, e2e-test)*
- [ ] The exceptions inbox (Must) lists walk-in and substitute approvals, "No seat in scope", released reservations whose guest has arrived, capped surnames and the failure-rate alarm. *(AC-163, integration-test)*
- [ ] The workload table shows staffer · waiting · longest wait · last active, with a per-guest and per-table "Move to…" action. *(AC-164, e2e-test)*
- [ ] The health strip shows `seq`, save p95, outbox depth, the age of the newest export, the 429 count and the invariant self-check result; a violation shows a banner. *(AC-165, integration-test)*
- [ ] Flags are toggles whose confirm dialogs name the effect ("Turn off self check-in? Guests will be sent to the desk."); a release confirm names the guest, table and seat; removing a table that has guests is disabled with a "Move guests…" action. *(AC-166, e2e-test)*
- [ ] Transfer, swap and release are available from Event control and update every device on its next poll. *(AC-167, e2e-test)*

### US-025: Offline pack and paper reconciliation

**Description:** As the event Super Administrator, I want a printed list and seating plan by table and by staffer, and a way to enter paper changes back through the normal rules, so that a lost connection never means lost or double seats.

**Tier:** Tier 2 · **Due:** 5 Dec 2026 · **Agent:** Operator · **Size:** S (estimate, ~0.5 dev-day)

**Acceptance Criteria:**
- [ ] The print pack, derived from export v1, holds an A–Z list, per-table sheets and per-staffer sheets covering every claim, with every page stamped "as of HH:MM". *(AC-168, integration-test)*
- [ ] "Reconcile paper seating" replays each paper entry as a command with `via:'reconcile'`, `occurredAt` and an `opId` through `commit()`; a paper overbooking is refused and listed as a recovery card, not applied. *(AC-169, integration-test)*
- [ ] Re-entering the same paper sheet creates no duplicates (`opId`). *(AC-170, unit-test)*
- [ ] The easel card ("If this page doesn't open, please go to the registration desk.") and the staff desk card (standby URL; "If the app restarts you'll be signed out. Sign in again and you'll land back on your queue") are printed from the guide. *(AC-171, manual-check)*
- [ ] Acceptance "Connectivity / recovery": the printed pack covers every claim; paper re-entry by `opId` creates no duplicates. *(AC-172, integration-test)*

### US-026: CORE guide "custom-app-events", whats-new and screenshots

**Description:** As an Event staff member or the Super Administrator, I want a short guide in Help & guides for seating, the desk and the night's procedures, so that I can learn the screens before the event and follow the runbook if something fails.

**Tier:** Tier 2 (a part in every tier commit) · **Due:** 5 Dec 2026 · **Agent:** Advocate · **Size:** S (estimate, ~0.25 dev-day)

> Each tier's commit carries its guide section, `whats-new.md` line and retaken screenshots (CLAUDE.md; `test/guides.test.js`). The guide doubles as the spec's operator guide and the source of the desk card.

**Acceptance Criteria:**
- [ ] `docs/guides/custom-app-events.md` has a valid header (roles include `eventstaff`; apps `customapp`) and the five required sections; its How to… holds "Seat a guest", "When a table fills up", "Find a guest at the desk", "Event control (Super Administrator)" and "If the system is down". *(AC-173, unit-test)*
- [ ] Every CUSTOM APP sidebar item is covered by a guide. *(AC-174, unit-test)*
- [ ] Every image the guide shows exists and is listed in `docs/guides/screenshots.json` (with `user` and `url`), retaken with `npm run guides:screenshots -- <file.jpg>`. *(AC-175, unit-test)*
- [ ] Each tier commit carries the version bump, devlog entry, guide change, a `whats-new.md` line (newest first) and retaken screenshots. *(AC-176, manual-check)*
- [ ] The guide holds the O6 event-day runbook (T-3h checklist, doors, act-on thresholds, degrade ladder, close, 10 Dec) and the line "Never run RESTORE.md §1 while an event is `live`." *(AC-177, manual-check)*

### US-027: Tier 2 acceptance, reuse proof and the 5 Dec client demo

**Description:** As Legati Group's event lead, I want to see all 12 acceptance scenarios work on several devices before the event, so that I can sign off the system and the seating plan.

**Tier:** Tier 2 · **Due:** 5 Dec 2026 · **Agent:** Strategist · **Size:** S (estimate, ~0.25 dev-day plus the demo)

**Acceptance Criteria:**
- [ ] The acceptance-critical engine cases pass over YEP and "Test Gala" (capacity 8, no employee tables, no seat numbers), and events are isolated. *(AC-178, unit-test)*
- [ ] A grep finds no YEP string in `server/customapp`. *(AC-179, unit-test)*
- [ ] All 12 named scenarios in `test/customapp-acceptance.test.js` are green (the evidence pack). *(AC-180, integration-test)*
- [ ] On 5 Dec all 12 scenarios are demonstrated to Legati/ICD on several simultaneous devices and the sign-off is recorded. *(AC-181, manual-check)*
- [ ] The four flags (`registrationOpen`, `emailPaused`, `readOnly`, `pollMs`) are shown working with no deploy. *(AC-182, manual-check)*

### US-028: Staging restore drill, warm standby and load test 1

**Description:** As the on-call developer, I want staging rebuilt from the offsite backup and loaded like the ballroom from one address, so that the restore is proven on a real box, the standby exists, and the limits are shown not to stop check-in.

**Tier:** Ops (readiness) · **Due:** 4 Dec 2026 (staging built 1–3 Dec) · **Agent:** Operator · **Size:** ~3 h operator time plus `scripts/event-load.mjs` (estimate, S)

**Acceptance Criteria:**
- [ ] Staging is built with `RESTORE.md` §2 from the latest offsite copy, on the production instance type, with its own hostname and a certificate issued in advance; `emailPaused=true` and SMTP points at a sink before the first start; each step is timed. *(AC-183, manual-check)*
- [ ] The measured RTO from "primary lost" to "staff on the standby URL" is under 30 minutes. *(AC-184, metric)*
- [ ] `scripts/event-load.mjs` uses only Node's standard library and drives the load from one source IP with limits ON. *(AC-185, unit-test)*
- [ ] Load test 1 (4 Dec): zero 429s to real guests and staff. *(AC-186, metric)*
- [ ] Load test 1: `save()` p95 under 100 ms. *(AC-187, metric)*
- [ ] Load test 1: event-loop delay p99 under 200 ms. *(AC-188, metric)*
- [ ] Load test 1 ends with a clean invariant scan: zero overbooked tables, duplicate check-ins, double seats, holds and reservations released by expiry, and exactly one Super Administrator. *(AC-189, metric)*

### US-029: Load test 2 with the kill -9 drill and the dress rehearsal

**Description:** As the event Super Administrator, I want the real list loaded, the server killed mid-run and a forbidden restore tried, so that I know staff recover in minutes and nothing committed is lost.

**Tier:** Ops (readiness) · **Due:** 6 Dec 2026 · **Agent:** Skeptic · **Size:** Operator time (the 6 Dec freeze candidate)

**Acceptance Criteria:**
- [ ] Load test 2 (6 Dec) with `systemctl kill -s KILL ltdc-erp` at minute 5: staff are back in, or on paper, within 3 minutes. *(AC-190, metric)*
- [ ] No committed check-in is lost, compared with the export taken just before the kill. *(AC-191, metric)*
- [ ] A CORE Admin restore attempted while the window is open leaves the event untouched. *(AC-192, manual-check)*
- [ ] A Super Administrator transfer by a CORE admin takes under 2 minutes. *(AC-193, metric)*
- [ ] Reconciliation through commands gives zero invariant violations. *(AC-194, metric)*
- [ ] Freeze candidate: fuzz at 1,000 seeds is green. *(AC-195, unit-test)*
- [ ] Freeze candidate: the race test passes five times in a row, and the commit is tagged. *(AC-196, integration-test)*
- [ ] Dress rehearsal with real staff accounts and 2-step sign-in: QR scan to checked in median under 30 s; checked in to seated p90 under 2 minutes at peak. *(AC-197, metric)*

### US-030: Freeze, event-day runbook and close-out

**Description:** As the on-call developer, I want production frozen, backed up every 15 minutes and checked against the runbook before doors, and cleanly unfrozen and purged afterwards, so that YEP 2026 runs on a build nobody can change and its personal data does not linger.

**Tier:** Ops (readiness) · **Due:** 8 Dec 2026 (code freeze 7 Dec 18:00; event 9 Dec; close-out 10 Dec) · **Agent:** Operator · **Size:** Operator time

**Acceptance Criteria:**
- [ ] Code freeze 7 Dec 18:00: the GitHub `production` reviewer gate is on, the event build is tagged, and the resize is done if the 30 Nov gate asked for it (Elastic IP checked first). *(AC-198, manual-check)*
- [ ] `touch /opt/ltdc-erp/data/DEPLOY_FREEZE` at 8 Dec 12:00; a deliberate push afterwards runs CI and fails the deploy job with exit 3, and production does not restart. *(AC-199, manual-check)*
- [ ] On 8 Dec after the last deploy, a full backup is taken and the `ltdc-erp-offsite.timer` drop-in `OnCalendar=*:05/15` is added and confirmed with `systemctl list-timers`. *(AC-200, manual-check)*
- [ ] The T-3h checklist is completed: freeze file and gate on; offsite drop-in present; manual offsite backup confirmed in the Security monitor; standby topped up; smoke test on the rehearsal guest (verify, check in, seat, status, email to the sink); newest export under 5 minutes old and pulled by the laptop; pack printed with every page stamped "as of HH:MM"; staff devices signed in, on 4G and charged. *(AC-201, manual-check)*
- [ ] The post-event hard gates hold: zero overbooked tables, duplicate check-ins, double seats, holds and reservations released by expiry, and exactly one Super Administrator. *(AC-202, metric)*
- [ ] Close: `registrationOpen` off, final CSV and JSON export, manual offsite backup, retention date set. *(AC-203, manual-check)*
- [ ] 10 Dec 09:00: the freeze file and timer drop-in are removed, the instance is resized back, staging is snapshotted and decommissioned, the export archive is handed to the client and the PII purge clock starts (covering `ca*`, the nightly copies, the event exports and the offsite lifecycle). *(AC-204, manual-check)*

### US-031: Interactive room model: choose a table and chair on the ballroom plan
**Description:** As the Super Administrator or a registration personnel member, I want a live plan of the ballroom (a 5 x 5 grid of round tables with 10 chairs each, the stage on the right and the tech booth on the left) so that I can see every table and chair at a glance and choose the exact chair for each guest.
**Tier:** 1 (with the delegated queues); the Tier 0 list-based seating stays as the fallback.
**Due:** 3 Dec 2026
**Agent:** Advocate (screens), Architect (room data and commands)
**Size:** M (about 2 dev-days)
**Prototype:** https://claude.ai/artifact/R5M9UuLqJZpRJYkQypgZqd (reviewed 27 Nov; example data only)
**Acceptance Criteria:**
- [ ] The room is event data, not code: `caEvents.room = { rows, cols, chairsPerTable, stageSide: left|right|top|bottom, boothSide, numbering: 'from-stage' }`; YEP 2026 is `{5, 5, 10, 'right', 'left'}`, and setting up the event creates tables 1-25 with positions derived from it (a second event with another room needs no code). *(AC-205, unit-test)*
- [ ] Tables are numbered from the stage (the column nearest the stage is 1-5, top to bottom) and chairs 1-10 clockwise from the one facing the stage; the printed pack and exports use the same numbers. *(AC-206, unit-test)*
- [ ] The plan is an inline SVG drawn from `GET /api/customapp/events/:id/room` (tables, chairs, claims, owners) and refreshed by the same short poll as the queues; a chair taken on another device changes within one `pollMs`. *(AC-207, e2e-test)*
- [ ] Every chair shows its state by fill and shape as well as colour (open: hollow ring; reserved: hatched; seated: solid with initials; the chosen chair: thick ring), with a legend; table type is shown by tint and line style (preferred: gold; employee: dashed); full tables say FULL. *(AC-208, e2e-test)*
- [ ] Choosing a waiting guest marks the top three recommended tables on the plan (ring and rank 1-3, from the same `recommend()` as the list) and dims tables the guest is not eligible for. *(AC-209, e2e-test)*
- [ ] Choosing a chair, then **Seat here**, sends one `assign` command with `tableId`, `seatNo` and `expectedRev`; the server's `commit()` decides. On a 409 (the chair or table was taken, or the scope changed) the plan redraws from the fresh state in the reply and says what happened, never silently. *(AC-210, integration-test)*
- [ ] A personnel member sees every table but can only choose chairs at their delegated tables; other tables are dimmed and marked "Not yours", and the server refuses a forged request with 403 `out_of_scope`. *(AC-211, integration-test)*
- [ ] Choosing an occupied chair shows who sits there; for a reserved preferred seat it offers **Arrived: seat now** and, for the Super Administrator only (while `releaseDelegable` is false), **Release reservation**; a seated guest can be moved or sent back to waiting through the same commands as the list. *(AC-212, integration-test)*
- [ ] After n8n's canvas: Fit, zoom in and zoom out buttons; keys + and - zoom, 1 fits; scroll or drag pans when zoomed and Ctrl+scroll zooms; arrow keys move between tables in the same row or column and Enter opens one. *(AC-213, e2e-test)*
- [ ] Opening a table shows its ten chairs as 48 px buttons around the table (labelled "Chair 4: Maria Santos, BDO Unibank"), so seating works with a keyboard, a screen reader and a 390 px phone where the full plan is small. *(AC-214, e2e-test)*
- [ ] The plan reads in light and dark mode, never scrolls the page sideways at 390 px, and the room page loads and redraws in under 300 ms with 250 chairs on the event laptop. *(AC-215, metric)*
- [ ] The room plan replaces the occupancy grid on the Event control screen; the printable plan in the offline pack draws the same room in black and white with table and chair numbers. *(AC-216, manual-check)*

## Acceptance Scenario Coverage (spec section 07)

Each of the spec's 12 scenarios has a named test in `test/customapp-acceptance.test.js` (the 5 Dec
evidence pack) and is green by the tier the design gives it (Q3).

| # | Spec scenario | Expected result (spec) | Stories | Named test (AC) | Green by |
|---|---|---|---|---|---|
| 1 | Preferred guest / no-show | Assignment retrieved; reserved seat blocked until manual release; late arrival after release referred | US-009, US-013 | AC-081 | Tier 0, 1 Dec |
| 2 | Regular guest / no match | Multiple eligible industry-ranked tables; other eligible tables if no match | US-018, US-013 | AC-126 | Tier 1, 3 Dec |
| 3 | Employee / group arrivals | Eligible employee tables; group fit; alternatives if the group cannot fit | US-021 | AC-143 | Tier 2, 5 Dec |
| 4 | Manual alternative / all tables full | Allowed within authority and capacity; no allocation if no eligible seat | US-009, US-018, US-013 | AC-082 | Tier 0 |
| 5 | Unlisted / substitute | Approval, classification and audit; no double allocation | US-022 | AC-149 | Tier 2 |
| 6 | Duplicate / simultaneous check-in | One registration and allocation per guest | US-007, US-009, US-013 | AC-083 | Tier 0 |
| 7 | Last available seat | One concurrent assignment succeeds; the other refreshes or escalates | US-007, US-010, US-013 | AC-084 | Tier 0 |
| 8 | Unauthorised cross-scope action | Rejected; Super Administrator can act or delegate; no duplicate ownership | US-017, US-011 | AC-118 | Tier 1 |
| 9 | Ownership reallocation / staff absent | New owner gets the pending queue; old owner loses write access; confirmed intact | US-017, US-019 | AC-119 | Tier 1 |
| 10 | Transfer / swap / release | Counts update; no overbooking; no lost assignment | US-009, US-013, US-024 | AC-085 | Tier 0 (screens Tier 2) |
| 11 | Email failure / no email | Assignment stays valid; display or staff notice works; retry available | US-023 | AC-160 | Tier 2 |
| 12 | Connectivity / recovery | Offline procedure tested; reconciled without duplicate allocations | US-025, US-029 | AC-172 | Tier 2 (drilled 6 Dec) |

## Technical Notes

### File layout (design A1)

```
shared/customapp/statuses.js       SEAT_STATUSES = freeze(['reserved','confirmed']), ARRIVAL, APPROVAL, FLAGS, CHANGE_TYPES
shared/customapp/refusals.js       frozen refusal catalogue, shared with the browser
shared/customapp/seating.js        eligible(), claimsAt(), recommend(): pure; the server is authoritative
shared/customapp/invariants.js     checkInvariants(eventState) -> [] | [{rule, ids, detail}]
server/customapp/index.js          registerCustomAppRoutes(route, db, {audit, notify, mail}); APPS registry (one entry: 'events')
server/customapp/events/model.js   accessors, normalisers (surname canon, digits-only last 4), lookup keys
server/customapp/events/engine.js  plan(state, cmd, actor, now) per command: pure, sync, no I/O, no Date.now()
server/customapp/events/commit.js  the unit of work (no await; a test enforces this)
server/customapp/events/routes.js  mutation() guard plus the staff routes
server/customapp/events/changes.js seq, since-queries, scoped board builder
server/customapp/events/public.js  verify, status token, activation window, referral map, soft cap (the only signed-out code)
server/customapp/events/outbox.js  capacity-1 FIFO email drain, retries, emailPaused
server/customapp/events/io.js      import preview/apply plus collision report; export (CSV, JSON v1, printable plan)
public/event.html + public/js/event.js   standalone guest page (support.html precedent)
public/js/views/customapp*.js            My queue, Find guest, Event control, Setup
scripts/event-load.mjs                   load script: standard library only, one source IP, limits ON
docs/guides/custom-app-events.md         CORE guide for Event staff and the Super Administrator (also the operator guide)
test/customapp-<area>.test.js            engine, invariants, fuzz, api, restore, flags, export, import, process, race,
                                         rank, scope, public, sync, outbox, reuse, acceptance
```

Changes to CORE outside the module stay small: `server/db.js` (`ca*` defaults in `emptyData()` and
`openDb`; compact JSON only if the gate asks); `server/api.js` (`replaceData()` carve-out, public event
exemption and buckets, admin-export PII rule); `server/util.js` (`HttpError(status, message, {code,
fresh})`, backward compatible, and `handle()` serialises `{error, code, fresh}`); `shared/modules.js`
(`customapp`, `MODULE_API` `^/api/(customapp|public/event)(/|$)`, `MODULE_PARTS`); `shared/roles.js`
(`eventstaff` account type with `customapp.use` only; `customapp.manage`); `server.js` and
`server/security.js` (`event.html` route and its CSP hash in `pagePolicy`); `server/helpdesk.js:245-261`
(`smtpOptions()` and `canEmail()` extracted into `mailTransport(db)`); a process-level
`unhandledRejection` logger.

### Data model (`db.json`, `ca*` collections; design A2)

| Collection | Key fields |
|---|---|
| `caEvents` | `id, app:'events', code (slug + random suffix, e.g. yep26-k3f9), name, venue, date, status: draft\|live\|closed\|archived, superAdminUserId, staff:[{userId, role, active}], industries:[{id, name, related[] (symmetric), active}], settings:{hardLimit:10, seatNumbers: preferred\|all\|none, mixedTables, releaseDelegable, emailFrom, replyTo, template}, window:{opensAt, closesAt} (UTC, shown in Asia/Manila), flags:{registrationOpen, emailPaused, readOnly, pollMs}, qrKeyHash?, seq, counters, rev` |
| `caTables` | `id, eventId, number, classification: preferred\|regular\|employee\|mixed, capacity (1..hardLimit), ownerUserId\|null, tags[], active, rev` |
| `caGuests` (aggregate root) | `id, eventId, ref, externalKey, name{first,last,display}, designation, company, industryId, email, mobile, lookup{surnames[], altSurnames[], m4}, classification: preferred\|regular\|employee\|unlisted, tags[], rsvp, ownerUserId\|null, arrival{state: expected\|checked_in\|cancelled, at, by, via: qr\|desk\|reconcile}, approval{state, by, at, note}, substituteFor/substitutedBy, groupId, seat{tableId, seatNo\|null, status: reserved\|confirmed, at, by}\|null, statusTokens:[{hash, issuedAt}] (≤5), flags:[{kind:'reverified_other_device', at}], notify{state, lastAt, attempts}, deskOnly, active, rev` |
| `caChanges` (append-only) | `{seq, eventId, at, occurredAt?, actorId, via: staff\|self\|reconcile, type, opId, guestIds[], tableIds[], diff, reason}`: field diffs, ~200 B each, ~0.6 MB per event; also the approval/change history, the sync cursor, the idempotency store and the post-event report |
| `caOutbox` | `{id, eventId, guestId, kind: assignment\|update\|resend, to, subject, body, state: queued\|sending\|sent\|failed, attempts, lastError, createdAt, sentAt}` |

**The seat lives on the guest** (one guest, one seat, structurally). `seat=null` means no claim; a
release writes history, not a third status. Table counts (`claimsAt`), `queue(owner)`, `superQueue`
and assignment status are **derived, never stored**. Lazy per-event maps (`guestsByLookupSurname`,
`claimsByTable`) are rebuilt when `seq` changes; commit-time checks recount from the source.

### Invariants I1–I10 (one `checkInvariants()`, used by engine tests, fuzz, the load script and the 60 s self-check)

I1 `claimsAt(t) <= t.capacity <= hardLimit (10)` whatever the status · I2 one seat per guest · I3
`(tableId, seatNo)` unique · I4 at most one active owner per guest and table · I5 exactly one Super
Administrator · I6 a substitute and the original never both hold a seat · I7 checked in once · I8 a
table with claims cannot be deactivated or shrunk below its count · I9 a reserved seat never expires
· I10 the actor writes only what they own (the Super Administrator writes any), re-read every commit.

### The `commit()` / `claimsAt()` contract (design A4)

```js
export function commit(ctx, eventId, user, cmd) {        // server/customapp/events/commit.js — no await
  const ev = mustEvent(ctx.db, eventId);
  if (ev.flags.readOnly && !cmd.reconcile) throw refusal('read_only');
  const role = roleOf(ev, user);                          // re-read every call
  const prior = ctx.idem.get(ev.id, cmd.opId);            // Map rebuilt from caChanges at boot
  if (prior) return prior.sameBody(cmd) ? prior.result : refusal('op_replay_mismatch');
  const plan = ENGINE[cmd.type].plan(ctx.db, ev, role, cmd, ctx.now()); // pure; throws Refusal(code, fresh)
  expectRevs(plan, cmd.expect);                           // 409 stale, with fresh options
  checkInvariants(ctx.db, ev, plan);                      // I1-I10 on the post-state, via claimsAt()
  const undo = apply(ctx.db, ev, plan);                   // rev++, ev.seq++, one compact caChanges entry
  try { ctx.db.save(); } catch { undo(); throw new HttpError(503, 'Not saved. Try again.'); }
  afterCommit(ctx, ev, plan);                             // audit.record, outbox.enqueue: sync
  return plan.result;                                     // {seq, revs, ...}
}
```

- `claimsAt(tableId)` (in `shared/customapp/seating.js`) counts **every** claim whatever its status;
  a source test makes it the only counter, and a closed-enum test fails if `SEAT_STATUSES` changes.
- Every event write is registered through `mutation()`, which refuses an `AsyncFunction` at startup
  and a thenable at run time. One process, one writer.
- Commands (one endpoint, `POST /api/customapp/events/:id/commands {type, opId, expect, ...}`):
  `checkIn`, `undoCheckIn`, `assign {placements[], allowSplit}`, `transfer`, `swap`, `reserve`,
  `release` (reason required; Super Administrator, or owner when `releaseDelegable`), `createUnlisted`,
  `approve`, `reject`, `substitute {originalId, newGuest}`, `delegateGuests`, `delegateTables`,
  `table.add`, `table.update`, `table.relocate`, `setFlag`, `notify`, `setSuperAdmin`
  (`customapp.manage`, password re-entry, reason, audited). The public `selfCheckIn` uses the same
  `commit()` with a synthetic actor (`via:'self'`) and can only check a guest in.
- Paper reconciliation is commands with `via:'reconcile'`, `occurredAt` and an `opId`.

### Routes (design A5)

Signed in (`customapp.use`; `customapp.manage` to create events or set the Super Administrator):
`GET /api/customapp/apps` · `GET/POST /api/customapp/events` · `GET/PATCH /api/customapp/events/:id`
(PATCH carries `rev`) · `POST .../super-admin` · `GET .../changes?since=<seq>&tab=<id>&wait=` (`wait`
reserved, ignored) · `GET .../recommend?guestIds=` (`mine` / `othersReadOnly`) · `GET
.../guests?q=&class=&status=&table=` · `GET .../referral/:code` · `POST .../commands` · `POST
.../import` then `POST .../import/:jobId/apply` · `GET .../export.json`, `.../export.csv?kind=`,
`.../plan.pdf` (Super Administrator only) · `GET .../invariants`.

Signed out (`/api/public/event/:code/*`, answered only when the event is `live`, never in the generic
per-IP buckets): `GET /api/public/event/:code` → `{name, date, state: closed|open, opensAt}` · `POST
.../verify {surname, last4 | email, k?}` → `{token, state, firstName, table?, seat?}` or the uniform
referral reply · `GET .../status` (header `X-Event-Token`, `?since=`) → `{seq, pollMs, state:
pending|seated|see_desk, title, firstName, table, seat}` or `{seq, pollMs, unchanged:true}`. Page:
`/event/<code>` serves `public/event.html`.

### Refusal catalogue (`shared/customapp/refusals.js`, frozen; design A6)

| Status | Codes |
|---|---|
| 409 (state conflict) | `stale`, `table_full`, `seat_taken`, `not_eligible`, `no_eligible_seat`, `already_checked_in`, `guest_moved`, `table_has_claims`, `op_replay_mismatch`, `read_only`, `registration_closed` |
| 403 (authority) | `out_of_scope`, `needs_super_admin` |
| 503 | `not_saved` (the save threw; the state is unchanged) |

Every staff refusal carries `{error, code, fresh}` (`fresh`: current guest state, the winner where it
can be shared, re-ranked options). Tests assert codes, never text; a catalogue test fails if any code
has no test that produces it. Public failures never expose a code: they get the uniform referral reply.

### Rate-limit buckets (design R1, C2)

- `/api/public/event/*` is exempt from `api-anon` (120/min) and `public-write` (20/h).
- Event limiter: a per-event global ceiling (e.g. 600/min), a per-surname bucket for failures, a
  per-token bucket for polls, and a high per-IP ceiling.
- Soft cap: 8 distinct wrong last-4 values per (event, normalised surname) in 15 minutes; a repeat
  counts once; clears after 15 minutes or with one tap at the desk. No global lockout; more than 30
  failures in 5 minutes raises an alarm to the Super Administrator.
- Failed attempts, caps and referral codes live in bounded in-memory maps (TTL 3 h, ≤5,000 entries);
  only a successful verify writes.
- Staff: an audited event-window allowance raises `signInFailuresPerAddress` (default 20) and the
  `auth` bucket; staff devices on the 4G hotspot.

### Guest verification and the status token (design R1, R2, A5, U1)

- Normalisation (R2), shared by import and verify: NFKD and strip diacritics; lowercase; drop
  spaces, hyphens, periods and apostrophes; strip Jr., Sr., II, III, IV; match `surnames[]` plus
  `altSurnames[]`; compare last 4 on the digits-only mobile. Exact match only.
- Input: `application/json` only, body ≤ ~1 KB, surname 1–80 characters, `last4` `^\d{4}$`, full
  email ≤254; check order limiter → window → match; helpdesk trap field and minimum fill time.
- Every failure: same status, byte-identical body except a random `R-xxx`, timing padded.
- Token: 32 random bytes (`randomBytes(32).toString('base64url')`), stored as SHA-256 and looked up
  by hash, ≤5 per guest, revocable, kept with the event. API reads it only from `X-Event-Token`; the
  page keeps it in the fragment `#s=<token>` and in `localStorage`. Replies: `Cache-Control:
  no-store`, `Referrer-Policy: no-referrer`. Caddy gets no `log` directive.
- Optional presence key `k` (Should): checked against `qrKeyHash`; enabled only after load test 1.

### Live sync (design A9)

`changes?since=<seq>` → `{seq, pollMs, unchanged:true}` (one integer comparison) or `{seq, pollMs,
board}` scoped by the access policy and gzipped by Caddy. `pollMs`: staff 2 s; guests 4 s pending, 10 s
seated; jitter; pause on `visibilitychange`; back off offline; under load 8 s guests / 4 s staff with
no deploy. Budget ≈ 30 requests/s. A server `seq` behind `since` returns a full board.

### Email outbox (design A11)

`afterCommit` queues `assignment`/`update` in `caOutbox` (body from a seat snapshot). `outbox.js` drains
a capacity-1 FIFO **outside** `commit()`: `sending` → `await sendMail(mailTransport(db))` → `sent` or
`failed`; `guest.notify` updated; status writes debounced to one save per 2 s; three retries with
backoff; Resend is a `notify` command; a message in `sending` for over 2 minutes after a restart is
queued again (rare duplicate rather than a lost email). Own `emailFrom`/`replyTo` (never the helpdesk
IMAP mailbox); `composeMessage` encoded words; CR/LF stripped on import. A failure never touches `seat`
or `arrival`. Go/no-go on 3 Dec; "display + verbal" ships with `emailPaused=true`.

### Export format `customapp.event/1` (design A12)

`GET .../export.json` → `{format:'customapp.event/1', exportedAt, eventId, seq, sha256, event, tables,
guests (without token hashes), changes, outbox}`. The same bytes feed the laptop pull, the 5-minute
on-box copies (`data/backups/events/`, last 24), the printed pack (CSV and PDF derived from it), the
standby top-up check and the post-event archive. A v1.1 import will read this format only. CSV is
formula-safe (`= + - @`, tab, CR prefixed with `'`).

### Restore carve-out (design A7)

`replaceData()` **always keeps the live `caEvents`, `caTables`, `caGuests`, `caChanges`, `caOutbox`
when the live data holds at least one event**; with no live events (the standby) it takes the
backup's copy. Deliberately not the `next.x?.length ? next.x : db.data.x` pattern. Covers "Restore a
backup", "Erase all data" and demo data. While any event is live the restore screen says "Event data
is not part of a CORE restore"; `/api/admin/export` omits event PII unless "include events" is ticked
(audited); Admin → Modules refuses to switch CUSTOM APP off while a window is open unless the Super
Administrator confirms. `RESTORE.md` §1 is forbidden while an event is live.

### Kill switches (design O3)

Four flags, Super Administrator only, audited, each shown working on 5 Dec with no deploy:
`registrationOpen` (after doors, "closed" renders as the desk sentence), `emailPaused`, `readOnly`
(refuses every commit except the Super Administrator's reconcile commands; reads still served),
`pollMs` (returned in every poll reply). Plus the existing module switch. Degrade ladder on the night:
`pollMs` 8 s/4 s → `emailPaused` → `registrationOpen=false` → paper by owner partition with `readOnly`
→ standby (staff URL) and replay.

### Operations (design O1–O7)

- **28 Nov:** guard as the first working line of `deploy/aws/remote-deploy.sh` (exit 3, optional
  `freeze_override` workflow input, logged); `update.sh` rsyncs to `/opt/ltdc-erp-prev` before
  `systemctl stop`; `/usr/local/sbin/ltdc-erp-rollback`; `unhandledRejection` logs and keeps serving,
  `uncaughtException` logs then exits(1) and systemd restarts in 3 s; `save()` measured.
- **Staging** = restore drill = load target = warm standby (1–3 Dec), `emailPaused=true`, SMTP to a
  sink, kept to 10 Dec (~US$0.30/day), topped up at T-3h.
- **Recovery point:** ≤5 minutes on the box, ≤15 off it (`ltdc-erp-offsite.timer` drop-in
  `OnCalendar=*:05/15` from 8 Dec, removed 10 Dec).
- **Freeze:** reviewer gate 7 Dec 18:00; `DEPLOY_FREEZE` 8 Dec 12:00 → 10 Dec 09:00; CI still runs.
- **Act-on thresholds (event night):** 5xx on event routes above 1% for 2 minutes; 2 failed uptime
  checks in a row; `save()` p95 above 250 ms; the oldest pending guest waiting over 3 minutes; more
  than 5 email failures; any red in the self-check; free disk under 1 GB.
- **Cost:** under US$10 in total.

### Interpretations made in this PRD (where design sections differ)

1. **Transfer, swap and release** are green at engine/API level by Tier 0 (Q3 traceability, Q2
   `customapp-engine`), while their Event control screens ship in Tier 2 (S2 roadmap). US-009 and
   US-024 split them that way.
2. **`opId` idempotency** is in `commit()` from Tier 0 (A4, Q2 `customapp-api` is Tier 0); the
   roadmap's Tier 1 `opId` item is the browser sending it on retries.
3. **Rate-limit fix and restore carve-out** are grouped with the 28 Nov operations work as asked; the
   carve-out lands with the `ca*` defaults on 28 Nov and the NAT-sized buckets ship in the 1 Dec
   Tier 0 release (S2), with the 300-verify proof landing with the public route on 3 Dec.
4. **Test layout:** CORE's tests are flat (`test/*.test.js`), so the design's `customapp-engine`
   etc. become `test/customapp-engine.test.js` etc. Deploy-script checks go in the existing
   `test/scripts.test.js`.
5. **Guide location:** this is CORE (repository root), so the guide is `docs/guides/custom-app-events.md`
   with `docs/guides/whats-new.md` and `docs/guides/screenshots.json`, checked by `test/guides.test.js`
   (header plus the five sections: Before you start, Walkthrough, How to…, Screens at a glance,
   Questions). The design's five topics become `###` tasks under How to….

## Dependencies

- **No new packages.** Node standard library only (CORE has no dependencies); Playwright only for
  `npm run journeys` and `npm run guides:screenshots`, as today. n8n, pretix and Cvent are patterns,
  never code or dependencies.
- **Reused in CORE:** `server/audit.js` (hash-chained audit); `shared/csv.js` (`parseCsv`,
  formula-safe export); `server/pdf/office-core.js` (`readZip`, `parseXml`) for an ~80-line `.xlsx`
  reader; `public/js/vendor/qrcode.js` (qrcode-generator 1.4.4) for the reception QR sheet;
  `server/security.js` `pagePolicy`; the helpdesk trap field and minimum fill time
  (`server/helpdesk.js:454-542`); `server/secrets.js`; `composeMessage` encoded words.
- **SMTP via the existing mail transport:** `smtpOptions()` and `canEmail()` extracted from
  `server/helpdesk.js` into `mailTransport(db)`; no new secret store; events use their own From and
  Reply-To. Needs a sender address and SMTP permission for it (client decision 5).
- **Infrastructure:** production EC2 (same domain); a staging server built from the offsite S3 copy
  with RESTORE.md §2 (own hostname, certificate in advance, same instance type), kept as the warm
  standby to 10 Dec; SSM access for the 28 Nov measurement; an Elastic IP before any resize to
  t3.small; the GitHub `production` reviewer gate; the offsite timer; a free external uptime check;
  a 4G hotspot for staff devices; a printer and a laptop at the venue.
- **People:** the on-call developer beside the Super Administrator on the night; a standby CORE admin
  for the break-glass transfer; real staff accounts with 2-step sign-in for the 6 Dec rehearsal.
- **Client inputs** (Legati Group / ICD): final guest list in Excel or CSV, venue table inventory,
  industry list and relationships, staff list and delegation, the Super Administrator designee,
  sender address, and the decisions below.

## Client decisions needed

Questions the design (S2, 27 Nov) and spec section 22 leave for Legati Group and ICD, with the
design's proposed default (used if no answer arrives) and the date the build needs the answer.
"Client decisions due" is 1 Dec and "final data due" is 3 Dec in the design's roadmap.

| # | Decision | Proposed default (design / spec) | Needed by |
|---|---|---|---|
| 1 | **Seat numbers for every guest** (changed 27 Nov): the admins choose a chair for each guest on the room model, so chairs 1-10 must be numbered on every table. | `settings.seatNumbers = 'all'`; chair 1 faces the stage and numbers run clockwise. The venue numbers the physical chairs to match (or ushers seat by the printed plan). | 1 Dec |
| 1a | **Room capacity (new 27 Nov)**: the room is 5 x 5 round tables of 10 = **250 chairs**, against a planning figure of about 300 guests. Is 250 the real inventory, or are more tables or a sixth row needed? | Build for the configured room (rows, columns and chairs are event settings); the import's capacity check refuses a list larger than the room until the Super Administrator adds tables. | 1 Dec |
| 2 | **Mixed tables**: which tables may seat regular guests alongside preferred guests (and is `mixedTables` enabled)? | Dedicated preferred, regular and employee tables; `mixedTables` off unless the Super Administrator enables it; only tables the client names are classified `mixed`. | 1 Dec |
| 3 | **Delegated no-show release**: may a table owner release a no-show preferred reservation within their scope? | No: `releaseDelegable = false`, so only the Super Administrator releases, always with a reason; nothing expires automatically. | 1 Dec |
| 4 | **Industry categories and relationships**: who supplies and owns the industry list and the related-sector map; are affinity or exclusion tags needed? | ICD supplies the classifications and related-sector mappings; the Super Administrator maintains them in Setup; no tags or exclusions unless supplied. | 1 Dec (list), with the final data on 3 Dec |
| 5 | **Sender address** for assignment emails (From and Reply-To) and permission to send from it. | A dedicated events From and Reply-To, separate from the helpdesk mailbox so replies never become IT tickets. | 3 Dec |
| 6 | **Email or "display + verbal"**: is automatic email required on the night if it is not proven by 3 Dec? | Build the outbox in Tier 2; at the 3 Dec go/no-go, if it is not ready, ship with `emailPaused = true` and guests see "Screenshot this screen" (spec s.6 allows verbal or on-screen notice). | 3 Dec |
| 7 | **Guest identifier and status retrieval** (spec s.22, first item). | Surname (normalised, exact) plus the last 4 digits of the mobile, or the full email; a per-device status token; desk-assisted check-in and search for everyone else. | 1 Dec |
| 8 | **Typed rotating desk code**: does the client want one in addition to the activation window? | Not built (Could; off by default). The server-enforced window, usher's "show this screen" step and, if load test 1 passes, the QR presence key are the controls. | 1 Dec |
| 9 | **Registration activation window**: when self check-in opens and closes on 9 Dec. | Opens at doors (the design's example: 6:00 PM Asia/Manila) and closes at the end of arrivals; `registrationOpen` turned on at doors by the Super Administrator. | 3 Dec |
| 10 | **Final guest count, list and venue table inventory** (300 is a working assumption). | Plan for about 300 guests at 10 per table plus employee tables per the venue inventory; real import on 3 Dec; data freeze on 6 Dec. | 3 Dec (data freeze 6 Dec) |
| 11 | **Staffing and authority**: the one Super Administrator, the registration staff list, the guest and table delegation, and the standby CORE admin for break-glass. | One Super Administrator named by Legati; staff on `eventstaff` CORE accounts with 2-step sign-in; delegation by table ownership (which also partitions the paper fallback); a CORE admin rehearsed on the under-2-minute transfer. | 3 Dec (names); accounts and delegation by the 6 Dec rehearsal |
| 12 | **Venue connectivity and devices**: 4G hotspot for staff, guest Wi-Fi, power, printer and a laptop at the desk. | Staff devices on a 4G hotspot (not the venue NAT); guests on venue Wi-Fi or their own data; the pack printed on site. | 6 Dec (dress rehearsal) |
| 13 | **Client acceptance demo**: who attends on 5 Dec, with which devices, and who signs off. | Legati/ICD event leads watch all 12 scenarios on several devices and sign off in the session. | 3 Dec (to schedule the 5 Dec demo) |
| 14 | **Personal-data retention and purge date** after the post-event archive is handed over. | The purge clock starts 10 Dec and covers `ca*`, nightly copies, event exports and the offsite lifecycle; the retention date is set at close (Guardian sets the date). | 9 Dec (set at close) |


## Change log
- **27 Nov 2026, after the scope review:** the user asked for an interactive model of the room (a 5 x 5 grid of round tables with 10 chairs each, stage on the right, tech booth on the left) where admins choose the chair for each guest. Added US-031 (about 2 dev-days, Tier 1), moved the floor plan out of the Non-Goals, changed client decision 1 to numbered chairs for every guest, added decision 1a (250 chairs against about 300 guests), and dropped "the non-preferred seat picker" from the cut order. Patterns from n8n's editor canvas (fit, zoom and pan controls with keyboard shortcuts, arrow keys between neighbouring nodes, status icons as well as colour) and the Taste Engine's colour-blindness rule (meaning never depends on colour alone). Prototype: https://claude.ai/artifact/R5M9UuLqJZpRJYkQypgZqd. The total is now about 17.5 dev-days against 9 build days, so the cut order matters more; see plan.md.
