# Acceptance Contract: YEP 2026 Registration (CUSTOM APP)

Session: custom-app-yep-2026-registration-20261127-0748 | PRD: prd.md | Status: locked

Every criterion of every user story in `prd.md`, numbered once. A criterion is verified only with evidence (a passing test run, a load-script report, or a devlog entry for a drill or sign-off) recorded against it. Test paths follow the design's layout: `test/customapp-<area>.test.js` (node:test, run alone with `npm run test:event`), the browser journey "Event night, four devices" in `scripts/journeys.mjs`, and the load and drill pass marks in `scripts/event-load.mjs`. Manual checks and metrics name the checklist or record that holds the evidence. BDD stubs for every criterion are in `test-stubs/` (one file per test file; the `it()` name is the test name below).

## Quality Gates

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

## US-001: 28 Nov ops half-day: freeze guard, kept release, rollback and crash logger

Tier: Ops (28 Nov) · Due: 28 Nov 2026 · Agent: Operator

#### AC-001: `remote-deploy.sh` exits with code 3 and prints "Deploys are frozen (<reason>). Nothing was changed." when `$APP/data/DEPLOY_FREEZE` exists and `DEPLOY_FREEZE_OVERRIDE` is unset, and the guard runs before the unit reinstall and `update.sh` (nothing on disk changes).

- **Method:** integration-test
- **Test:** `test/scripts.test.js` › "GIVEN data/DEPLOY_FREEZE exists in $APP and DEPLOY_FREEZE_OVERRIDE is unset WHEN remote-deploy.sh runs THEN it prints the frozen message and exits 3 before the unit reinstall and update.sh"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-002: With `DEPLOY_FREEZE_OVERRIDE` set, the guard lets the deploy continue past the freeze check.

- **Method:** integration-test
- **Test:** `test/scripts.test.js` › "GIVEN data/DEPLOY_FREEZE exists WHEN remote-deploy.sh runs with DEPLOY_FREEZE_OVERRIDE set THEN the guard lets the deploy continue"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-003: `.github/workflows/deploy-ec2.yml` declares an optional `freeze_override` input, passes it to the remote step as `DEPLOY_FREEZE_OVERRIDE`, and an override is written to the audit log or devlog; exit code 3 fails the deploy job (never a silent pass).

- **Method:** unit-test
- **Test:** `test/scripts.test.js` › "GIVEN the deploy workflow file WHEN it is parsed THEN it declares an optional freeze_override input that is passed through as DEPLOY_FREEZE_OVERRIDE and recorded in the devlog or audit"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-004: `deploy/aws/update.sh` copies the running release to `/opt/ltdc-erp-prev` with `/data/` excluded before `systemctl stop`.

- **Method:** unit-test
- **Test:** `test/scripts.test.js` › "GIVEN deploy/aws/update.sh WHEN its steps are read in order THEN the rsync of the running release to /opt/ltdc-erp-prev (excluding /data/) comes before systemctl stop"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-005: `/usr/local/sbin/ltdc-erp-rollback` stops the service, restores `/opt/ltdc-erp-prev` over `$APP` with `/data/` excluded, applies the same chown/chmod as `update.sh`, starts the service and passes the health loop (proved once on staging, recorded in the devlog).

- **Method:** manual-check
- **Test:** `manual: staging rollback drill (devlog)` › "GIVEN a deploy on staging WHEN ltdc-erp-rollback is run THEN the previous release is back, data/ is untouched, ownership matches update.sh and the health loop passes"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-006: An `unhandledRejection` is logged and recorded to the monitor, and the process keeps serving (spawned child-process test).

- **Method:** integration-test
- **Test:** `test/customapp-process.test.js` › "GIVEN a spawned CORE child process WHEN a promise rejection goes unhandled THEN it is logged and recorded to the monitor and the server keeps answering requests"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-007: An `uncaughtException` is logged and recorded, then the process exits with code 1 so systemd restarts it in 3 s.

- **Method:** integration-test
- **Test:** `test/customapp-process.test.js` › "GIVEN a spawned CORE child process WHEN an uncaughtException is thrown THEN it is logged and recorded and the process exits with code 1"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-008: At least 4 production deploys exercise the freeze guard and the kept previous release before 7 Dec (counted from the deploy history, recorded in the devlog).

- **Method:** metric
- **Test:** `metric: deploy history (devlog)` › "GIVEN the guard and rollback are merged on 28 Nov WHEN production deploys happen before 7 Dec THEN at least 4 of them run through the guard and the kept release"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-002: Restore carve-out keeps live event data

Tier: Ops (28 Nov) · Due: 28 Nov 2026 · Agent: Skeptic

#### AC-009: `replaceData()` keeps the live `caEvents`, `caTables`, `caGuests`, `caChanges` and `caOutbox` whenever the live data holds at least one event: restoring a backup at `seq` 50 over a live event at `seq` 120 leaves the event and its `seq` unchanged.

- **Method:** unit-test
- **Test:** `test/customapp-restore.test.js` › "GIVEN live data with an event at seq 120 WHEN a backup taken at seq 50 is restored through replaceData() THEN caEvents, caTables, caGuests, caChanges, caOutbox and seq are unchanged"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-010: "Erase all data" and loading demo data also leave the live `ca*` collections and `seq` untouched.

- **Method:** unit-test
- **Test:** `test/customapp-restore.test.js` › "GIVEN a live event WHEN an admin runs Erase all data or loads demo data THEN the live ca* collections and seq are untouched"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-011: When the live data holds no event (the standby case), `replaceData()` takes the backup's `ca*` collections (not the `next.x?.length ? next.x : db.data.x` pattern).

- **Method:** unit-test
- **Test:** `test/customapp-restore.test.js` › "GIVEN live data with no events (the standby) WHEN a backup that holds an event is restored THEN the backup's ca* collections are taken"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-012: While any event is `live`, the Admin restore screen says "Event data is not part of a CORE restore".

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN an event is live WHEN an administrator opens the Admin restore screen THEN it shows "Event data is not part of a CORE restore""
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-013: `deploy/aws/RESTORE.md` §1 carries a boxed warning that it is forbidden while an event is `live`.

- **Method:** unit-test
- **Test:** `test/customapp-restore.test.js` › "GIVEN deploy/aws/RESTORE.md WHEN section 1 is read THEN it carries the boxed warning that it is forbidden while an event is live"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-014: `/api/admin/export` leaves out event PII while an event is live unless "include events" is ticked, and ticking it is audited.

- **Method:** integration-test
- **Test:** `test/customapp-restore.test.js` › "GIVEN a live event WHEN /api/admin/export is downloaded with and without include events THEN event PII is left out by default and ticking include events adds it and writes an audit entry"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-015: Admin panel → Modules refuses to switch CUSTOM APP off while an event window is open, unless the Super Administrator confirms.

- **Method:** unit-test
- **Test:** `test/customapp-api.test.js` › "GIVEN an event whose window is open WHEN Admin panel Modules tries to switch CUSTOM APP off THEN it is refused unless the event Super Administrator confirms"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-003: Event rate-limit buckets and the staff sign-in allowance

Tier: Ops (28 Nov) · Due: 1 Dec 2026 (started 28 Nov; ships in the Tier 0 release) · Agent: Skeptic

#### AC-016: `/api/public/event/*` is exempt from the generic `api-anon` (120/min) and `public-write` (20/h) buckets.

- **Method:** integration-test
- **Test:** `test/customapp-public.test.js` › "GIVEN rate limits ON and TRUST_PROXY=1 WHEN 200 requests hit /api/public/event/* from one x-forwarded-for THEN none is counted in api-anon or public-write"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-017: The event limiter has a per-event global ceiling (600/min), a per-surname bucket for failures, a per-token bucket for polls and a high per-IP ceiling.

- **Method:** unit-test
- **Test:** `test/customapp-public.test.js` › "GIVEN the event limiter WHEN its buckets are exercised THEN it enforces a per-event global ceiling (600/min), a per-surname failure bucket, a per-token poll bucket and a high per-IP ceiling"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-018: The staff allowance raises `signInFailuresPerAddress` and the `auth` bucket for the event window only, and the change is audited.

- **Method:** unit-test
- **Test:** `test/customapp-api.test.js` › "GIVEN an event window WHEN the Super Administrator turns on the event sign-in allowance THEN signInFailuresPerAddress and the auth bucket are raised only inside the window and the change is audited"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-019: 30 staff sign-ins and board polls at 2 s from one address within the allowance get zero 429s.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN limits ON and the allowance active WHEN 30 staff sign in and poll boards at 2 s from one address THEN no request gets a 429"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-004: save() measurement and the 30 Nov storage gate

Tier: Ops (28 Nov) · Due: 30 Nov 2026 · Agent: Operator

#### AC-020: On 28 Nov, over SSM and read-only: `db.json` size; p50 and p95 of 50 runs of `JSON.stringify` + `writeFileSync` on a copy; `free -m` and the instance type; `aws ec2 describe-addresses` (an Elastic IP before any resize), all recorded in the devlog.

- **Method:** manual-check
- **Test:** `manual: storage measurement (devlog, 28 Nov)` › "GIVEN SSM read-only access WHEN the measurement runs on a production copy THEN db.json size, p50 and p95 of 50 stringify-and-write runs, free -m, the instance type and the Elastic IP check are in the devlog"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-021: `save()` p95 is classified against the A8 bands: under 50 ms nothing; 50 to 150 ms compact JSON, then coalesced 2 s outbox status writes, then a t3.small resize on 7 Dec; over 150 ms on 30 Nov the split to `data/customapp/<eventId>/`.

- **Method:** metric
- **Test:** `metric: save() p95 on the production copy` › "GIVEN the 28 Nov measurement WHEN p95 is compared with the A8 bands THEN under 50 ms needs nothing, 50 to 150 ms triggers the levers and over 150 ms on 30 Nov triggers the split"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-022: The 30 Nov decision is recorded in the devlog; if the split is chosen, email drops to "display + verbal" (`emailPaused=true`) to pay for it.

- **Method:** manual-check
- **Test:** `manual: storage gate decision (devlog, 30 Nov)` › "GIVEN the measured p95 WHEN the gate is held on 30 Nov THEN the chosen action is written in the devlog and, if the split is chosen, email is moved to display plus verbal to pay for it"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-005: CUSTOM APP module shell and the Event staff account type

Tier: Tier 0 · Due: 1 Dec 2026 · Agent: Architect

#### AC-023: `shared/modules.js` has a `customapp` entry, `MODULE_API` `^/api/(customapp|public/event)(/|$)` and its `MODULE_PARTS`, and `customapp` is added to the modules-roadmap test.

- **Method:** unit-test
- **Test:** `test/modules-roadmap.test.js` › "GIVEN shared/modules.js WHEN the module list is read THEN customapp is registered with MODULE_API ^/api/(customapp|public/event)(/|$) and its MODULE_PARTS"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-024: `customapp` is added to the favorite-modules test and passes.

- **Method:** unit-test
- **Test:** `test/favorite-modules.test.js` › "GIVEN the customapp module WHEN favourite modules are computed THEN customapp is handled like every other module"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-025: `GET /api/customapp/apps` returns the `APPS` registry with exactly one entry, `events`.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN a signed-in user with customapp.use WHEN GET /api/customapp/apps is called THEN the registry lists exactly one app, events"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-026: `shared/roles.js` has an `eventstaff` account type with `customapp.use` only and a `customapp.manage` permission; an Event staff user sees only CUSTOM APP and gets 403 from every other module API.

- **Method:** integration-test
- **Test:** `test/customapp-scope.test.js` › "GIVEN an eventstaff user WHEN they call other module APIs and open the app THEN they see only CUSTOM APP and other modules answer 403"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-027: With the module switched off, `/api/customapp/*` and `/api/public/event/*` refuse (module gating).

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN the module switched off WHEN /api/customapp/* or /api/public/event/* is called THEN both refuse"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-028: Tier 0 is released dark on 1 Dec: the module is off for non-admins in production.

- **Method:** manual-check
- **Test:** `manual: Tier 0 release check (devlog, 1 Dec)` › "GIVEN the Tier 0 deploy on 1 Dec WHEN a non-admin signs in to production THEN CUSTOM APP is not visible (released dark)"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-006: Event, table and industry setup

Tier: Tier 0 · Due: 1 Dec 2026 · Agent: Architect

#### AC-029: `POST /api/customapp/events` needs `customapp.manage`; `GET` lists only events the caller has a role in; `PATCH /api/customapp/events/:id` carries `rev` and a stale `rev` gets 409 `stale`.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN users with and without a role in an event WHEN they call GET/POST /api/customapp/events and PATCH /:id with an old rev THEN create needs customapp.manage, the list shows only their events and the stale PATCH gets 409 stale"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-030: The event `code` is a slug with a random suffix (for example `yep26-k3f9`) so the page cannot be guessed before the QR is shown.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a new event WHEN it is created THEN its code is a slug with a random suffix such as yep26-k3f9"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-031: `industries[].related` is kept symmetric on every write.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN industries A and B WHEN A is saved with B in related THEN B lists A in related too, and removing it removes both"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-032: Table `capacity` is limited to 1..`hardLimit` (10); classification is one of `preferred|regular|employee|mixed`; each table has at most one owner.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN an event with hardLimit 10 WHEN table.add or table.update sets capacity 0 or 11 THEN the command is refused and capacity 1..10 is accepted"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-033: A table cannot shrink below its claims or be deactivated while it holds claims (`table_has_claims`, I8) unless a `table.relocate` in the same commit empties it.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a table holding 6 claims WHEN table.update shrinks it to 5 or deactivates it THEN 409 table_has_claims, unless a table.relocate in the same commit empties it"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-034: Window times are stored as UTC instants and shown in Asia/Manila.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN window.opensAt entered as 6:00 PM Asia/Manila WHEN it is stored and read back THEN it is a UTC instant and displays as 6:00 PM in Asia/Manila"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-007: commit() unit of work, claimsAt(), invariants and typed refusals

Tier: Tier 0 · Due: 1 Dec 2026 · Agent: Architect

#### AC-035: `server/customapp/events/commit.js` and `engine.js` contain no `await` (a source test greps them).

- **Method:** unit-test
- **Test:** `test/customapp-api.test.js` › "GIVEN server/customapp/events/commit.js and engine.js WHEN their source is searched THEN neither contains await"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-036: `mutation()` refuses an `AsyncFunction` at startup and a handler that returns a thenable at run time.

- **Method:** unit-test
- **Test:** `test/customapp-api.test.js` › "GIVEN mutation() WHEN it is given an AsyncFunction at startup or a handler that returns a thenable at run time THEN it refuses both"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-037: `claimsAt(tableId)` counts every claim whatever its status: a table with 8 confirmed and 2 reserved seats refuses an assign with 409 `table_full`.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a table of 10 with 8 confirmed and 2 reserved seats WHEN another guest is assigned to it THEN it is refused with 409 table_full"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-038: `SEAT_STATUSES` is frozen as `['reserved','confirmed']`; an exhaustiveness test fails if it changes without a classification; no file other than `shared/customapp/seating.js` counts by `seat.status`.

- **Method:** unit-test
- **Test:** `test/customapp-invariants.test.js` › "GIVEN SEAT_STATUSES WHEN a status is added without a classification or any file other than seating.js counts by seat.status THEN the test fails"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-039: `checkInvariants()` catches each of I1–I10 broken by hand and returns `[{rule, ids, detail}]`; a clean state returns `[]`.

- **Method:** unit-test
- **Test:** `test/customapp-invariants.test.js` › "GIVEN a valid event state WHEN each of I1 to I10 is broken by hand THEN checkInvariants returns that rule with the ids involved"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-040: When `db.save()` throws, `commit()` undoes the change in memory, nothing is audited or queued, and the reply is 503 `not_saved`.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN db.save() stubbed to throw WHEN a command is posted THEN the reply is 503 not_saved, the in-memory state is unchanged, nothing is audited and nothing is queued"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-041: Each successful write records exactly one audit entry (`afterCommit` → `audit.record`), labelled with the guest ref and a masked name, never the mobile or email.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN a successful command WHEN the audit log is read THEN there is exactly one entry, labelled with the guest ref and a masked name and never the mobile or email"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-042: Every commit appends one compact `caChanges` entry `{seq, eventId, at, actorId, via, type, opId, guestIds, tableIds, diff, reason}`, increments `ev.seq` and the `rev` of every touched record.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN an event at seq n WHEN a command commits THEN one compact caChanges entry is appended with seq n+1, the type, opId, guestIds, tableIds and diff, and each touched record's rev is incremented"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-043: Every code in `shared/customapp/refusals.js` (409: `stale`, `table_full`, `seat_taken`, `not_eligible`, `no_eligible_seat`, `already_checked_in`, `guest_moved`, `table_has_claims`, `op_replay_mismatch`, `read_only`, `registration_closed`; 403: `out_of_scope`, `needs_super_admin`; 503: `not_saved`) is produced by at least one test; tests assert codes, never message text.

- **Method:** unit-test
- **Test:** `test/customapp-api.test.js` › "GIVEN the frozen refusal catalogue WHEN the suite runs THEN every code in shared/customapp/refusals.js is produced by at least one test with its catalogue status"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-044: `HttpError(status, message, {code, fresh})` is backward compatible, and `handle()` serialises `{error, code, fresh}`.

- **Method:** unit-test
- **Test:** `test/customapp-api.test.js` › "GIVEN HttpError(status, message, {code, fresh}) and an existing two-argument caller WHEN handle() serialises them THEN the reply is {error, code, fresh} and the old callers are unchanged"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-045: A command whose `expect` revision is out of date gets 409 `stale`, with `fresh` holding the current state and re-ranked options.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a guest at rev 3 WHEN a command expects rev 2 THEN 409 stale with fresh holding the current guest state and re-ranked options"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-046: `opId` replay with the same body returns the prior result without a second write; the same `opId` with a different body gets `op_replay_mismatch`; the idempotency map is rebuilt from `caChanges` at boot.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN a committed command with opId X WHEN it is replayed with the same body, with a different body, and after a restart THEN the same body returns the prior result without a write, a different body gets op_replay_mismatch, and the map is rebuilt from caChanges"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-008: Guest import with collision report

Tier: Tier 0 · Due: 1 Dec 2026 · Agent: Architect

#### AC-047: CSV and XLSX (via `server/pdf/office-core.js` `readZip`/`parseXml`) are imported with header aliases in two steps, `POST .../import` (preview) then `POST .../import/:jobId/apply`; the preview writes nothing and the apply is one commit.

- **Method:** integration-test
- **Test:** `test/customapp-import.test.js` › "GIVEN a CSV and an XLSX with aliased headers WHEN POST .../import previews and POST .../import/:jobId/apply applies THEN the preview changes nothing and the apply is one commit"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-048: Normalisation follows R2: NFKD and strip diacritics, lowercase, drop spaces, hyphens, periods and apostrophes, strip Jr., Sr., II, III, IV; `altSurnames[]` kept; last 4 taken from the digits-only mobile ("+63 917 123 4567", "09171234567" and "917-123-4567" all give "4567").

- **Method:** unit-test
- **Test:** `test/customapp-import.test.js` › "GIVEN surnames with diacritics, spaces, hyphens, apostrophes and Jr./III and mobiles +63 917 123 4567, 09171234567 and 917-123-4567 WHEN they are normalised THEN the surname canon follows R2 and every mobile gives last 4 = 4567"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-049: The collision report finds every ambiguous pair (same normalised surname and last 4), every guest with no mobile and no email, possible duplicates, unknown classification or industry, and tables set above capacity.

- **Method:** unit-test
- **Test:** `test/customapp-import.test.js` › "GIVEN a list with two guests sharing surname and last 4, a guest with no mobile and no email, a likely duplicate, an unknown industry and a table above capacity WHEN previewed THEN the collision report counts each kind"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-050: CR/LF and control characters are stripped from names and companies on import; export prefixes cells starting with `= + - @`, tab or CR with `'`.

- **Method:** unit-test
- **Test:** `test/customapp-import.test.js` › "GIVEN names containing CR/LF and control characters and cells starting with = + - @, tab or CR WHEN imported and exported THEN the characters are stripped on import and the cells are prefixed with ' on export"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-051: Import is capped at about 2 MB and 2,000 rows and is Super Administrator only.

- **Method:** integration-test
- **Test:** `test/customapp-import.test.js` › "GIVEN a 2.5 MB file, a 2,500-row file and a non-Super-Administrator caller WHEN they import THEN each is refused"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-052: Re-import is idempotent; once the event is live, it merges by `externalKey` and never touches status, seat or owner.

- **Method:** unit-test
- **Test:** `test/customapp-import.test.js` › "GIVEN a live event with checked-in, seated and owned guests WHEN the same list is re-imported with changes THEN it merges by externalKey and never touches status, seat or owner, and a second identical import changes nothing"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-053: Setup → Import check lists each problem as a count with a fix action (add the full email, add a direct mobile, mark "desk only"); "Open registration" stays disabled with "N issues to resolve" until the list is clear or the Super Administrator acknowledges it.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN an import with 3 unresolved issues WHEN the Super Administrator opens Setup then Import check THEN each problem shows a count with a fix action and Open registration is disabled with "3 issues to resolve" until cleared or acknowledged"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-009: Seat commands: check-in, preferred retrieval, reservations, assign, transfer and swap

Tier: Tier 0 · Due: 1 Dec 2026 · Agent: Architect

#### AC-054: `checkIn` sets `arrival{state:'checked_in', at, by, via}` once; a second check-in with a new `opId` gets 409 `already_checked_in` (I7).

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN an expected guest WHEN checkIn is committed twice with different opIds THEN arrival is checked_in once with at, by and via and the second gets 409 already_checked_in"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-055: `undoCheckIn` returns the guest to `expected` and is recorded in `caChanges`.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a checked-in guest WHEN undoCheckIn is committed THEN arrival returns to expected and the change is in caChanges"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-056: For a preferred guest, `checkIn` turns the `reserved` seat into `confirmed` at the preassigned table and seat.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a preferred guest with a reserved seat at table 3 seat 4 WHEN checkIn is committed THEN the seat becomes confirmed at table 3 seat 4"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-057: `reserve` and `release` are allowed only to the Super Administrator, or to the owner when `releaseDelegable` is set; a reason is required; no timer or expiry ever clears a seat (I9).

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a reserved seat WHEN release is attempted by a non-owner, by the owner without releaseDelegable, without a reason, and by the Super Administrator with a reason THEN only the authorised actor with a reason succeeds and no timer ever clears a seat"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-058: A preferred guest whose reservation was released goes to the Super Administrator's queue on arrival.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a preferred guest whose reservation was released WHEN they arrive and check in THEN they are routed to the Super Administrator queue for reassignment"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-059: `assign` refuses an occupied `(tableId, seatNo)` with `seat_taken` (I3), a wrong-class table with `not_eligible`, and returns `no_eligible_seat` (referred to the Super Administrator) when no eligible seat remains.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN an occupied seat, a table of the wrong class and an event with no free eligible seat WHEN assign is committed for each THEN the replies are seat_taken, not_eligible and no_eligible_seat"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-060: `settings.seatNumbers` (`preferred|all|none`) decides when `seatNo` is required; it is always required for preferred guests.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN settings.seatNumbers preferred WHEN a preferred guest is assigned without a seatNo and a regular guest is assigned without one THEN the preferred assign is refused and the regular one succeeds"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-061: `transfer` keeps the old seat until the new one validates; `swap` is atomic; both validate every affected seat and the counts update.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a seated guest WHEN transfer targets a full table and when swap exchanges two guests THEN the failed transfer leaves the old seat in place and the swap moves both or neither, with counts correct"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-010: Staff Find guest and seating screens

Tier: Tier 0 · Due: 1 Dec 2026 · Agent: Advocate

#### AC-062: `GET /api/customapp/events/:id/guests?q=&class=&status=&table=` searches by partial name or company, masks contact details ("•••• 4417"), and shows non-owners only name, company, industry and table.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN an owner and a non-owner staffer WHEN they search GET .../guests?q=&class=&status=&table= by partial name or company THEN the owner sees masked contact fields and the non-owner sees name, company, industry and table only"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-063: Check in (any staffer) and Seat (owner or Super Administrator only) are separate transitions with separate permissions.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN a staffer who does not own the guest WHEN they check the guest in and then try to seat them THEN check-in succeeds and seating is refused with out_of_scope"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-064: Seating takes two taps: tapping a table preselects the first free seat, Confirm repeats the choice ("Seat at Table 5"), taken seat chips are disabled and seat chips are mandatory for preferred guests.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN a staff phone at 390 px WHEN the staffer taps a guest card and then a table THEN the first free seat is preselected and Confirm reads "Seat at Table 5""
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-065: The 10-dot meter shows filled for confirmed and a ring for reserved with a text count ("6 seated · 2 reserved · 2 free"); full tables are disabled for new assignments.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN a table with 6 confirmed and 2 reserved seats and a full table WHEN the seating sheet opens THEN the meter shows filled and ring dots with "6 seated · 2 reserved · 2 free" and the full table cannot be chosen"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-066: A 409 re-renders the sheet in place with the guest still selected ("Table 5 just filled. Updated options:"); there is no optimistic UI.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN two staff phones on the last seat of Table 5 WHEN both confirm THEN one seats the guest and the other's sheet re-renders in place with the guest still selected and "Table 5 just filled. Updated options:""
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-067: Staff screens meet the U6 floor: nothing wider than 390 px, inputs at least 16 px, touch targets at least 48 px, keyboard operable, badges and meter states carry text, WCAG AA contrast in both themes, `prefers-reduced-motion` honoured.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN the staff screens in both CORE themes WHEN checked at 390 px with the keyboard THEN nothing is wider than 390 px, inputs are at least 16 px, targets at least 48 px, badges and meters carry text and contrast meets WCAG AA"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-011: Event Super Administrator and runtime flags

Tier: Tier 0 · Due: 1 Dec 2026 · Agent: Skeptic

#### AC-068: Exactly one Super Administrator per event (`superAdminUserId`); a CORE `admin` with `*` gets 403 on a seat write unless designated.

- **Method:** integration-test
- **Test:** `test/customapp-scope.test.js` › "GIVEN a CORE admin with * who is not the event's superAdminUserId WHEN they post a seat command THEN it is refused with 403"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-069: `POST /api/customapp/events/:id/super-admin` (`setSuperAdmin`) needs `customapp.manage`, password re-entry and a reason; the old holder is revoked in the same commit; it is audited; afterwards there is exactly one Super Administrator (I5).

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN a CORE admin WHEN POST .../super-admin is called without customapp.manage, without password re-entry, without a reason, and then with all three THEN only the last succeeds, the old holder is revoked in the same commit, it is audited and exactly one Super Administrator remains"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-070: `setFlag` for `registrationOpen`, `emailPaused`, `readOnly` and `pollMs` is Super Administrator only and audited.

- **Method:** unit-test
- **Test:** `test/customapp-flags.test.js` › "GIVEN a staffer and the Super Administrator WHEN each sends setFlag for registrationOpen, emailPaused, readOnly and pollMs THEN only the Super Administrator succeeds and each change is audited"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-071: Every flag is checked inside `commit()` or carried in the poll reply.

- **Method:** unit-test
- **Test:** `test/customapp-flags.test.js` › "GIVEN each of the four flags WHEN its effect is traced THEN it is checked inside commit() or returned in the poll reply"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-072: `readOnly` refuses every mutation with `read_only` except reconcile commands from the Super Administrator, and still serves reads.

- **Method:** unit-test
- **Test:** `test/customapp-flags.test.js` › "GIVEN readOnly is on WHEN staff post any command, the Super Administrator posts a reconcile command and anyone reads THEN commands get 409 read_only, the reconcile command is accepted and reads are served"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-073: A flag change applies on the next request, with no restart or deploy.

- **Method:** integration-test
- **Test:** `test/customapp-flags.test.js` › "GIVEN a running server WHEN a flag is changed THEN the next request reflects it with no restart or deploy"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-012: Export JSON v1, CSV and printable plan

Tier: Tier 0 · Due: 1 Dec 2026 · Agent: Operator

#### AC-074: `GET .../export.json` returns `{format:'customapp.event/1', exportedAt, eventId, seq, sha256, event, tables, guests, changes, outbox}` and matches a golden fixture.

- **Method:** unit-test
- **Test:** `test/customapp-export.test.js` › "GIVEN a fixture event WHEN GET .../export.json is produced THEN it equals the golden fixture with format customapp.event/1, exportedAt, eventId, seq, sha256, event, tables, guests, changes and outbox"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-075: The export contains every claim (reserved and confirmed), its `sha256` verifies, guests carry no token hashes and no PII beyond the agreed fields.

- **Method:** unit-test
- **Test:** `test/customapp-export.test.js` › "GIVEN guests with reserved and confirmed seats and status tokens WHEN exported THEN every claim is present, sha256 verifies, token hashes are absent and no PII beyond the agreed fields appears"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-076: `.../export.csv?kind=` and `.../plan.pdf` are derived from the same export; the CSV is formula-safe.

- **Method:** integration-test
- **Test:** `test/customapp-export.test.js` › "GIVEN an export WHEN .../export.csv?kind= and .../plan.pdf are requested THEN both are derived from the same export and the CSV is formula-safe"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-077: The export endpoints are Super Administrator only.

- **Method:** integration-test
- **Test:** `test/customapp-export.test.js` › "GIVEN a staffer and the Super Administrator WHEN each requests the exports THEN only the Super Administrator gets them"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-013: Tier 0 proof suite: fuzz, race and the Tier 0 acceptance rows

Tier: Tier 0 · Due: 1 Dec 2026 · Agent: Craftsman

#### AC-078: `npm run test:event` (`node --test test/customapp-*.test.js`, added to `package.json`) runs alone in under 5 s with fuzz at 50 seeds.

- **Method:** metric
- **Test:** `metric: npm run test:event` › "GIVEN package.json has test:event = node --test test/customapp-*.test.js WHEN it runs alone with fuzz at 50 seeds THEN it finishes in under 5 s"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-079: The fuzz suite runs seeded random command sequences (200 seeds in CI), keeps `checkInvariants()` at `[]` after every step, never produces a hold or a release by expiry, refuses only with catalogue codes and prints the seed on failure.

- **Method:** unit-test
- **Test:** `test/customapp-fuzz.test.js` › "GIVEN 200 seeds WHEN random sequences of assign, check-in, release, transfer, swap, substitute, group, reclassify, deactivate and delegate run over reserved and confirmed guests with wrong scopes and stale revs THEN checkInvariants is [] after every step, no holds exist, nothing is released by expiry and every refusal is from the catalogue"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-080: Over real sockets, 10 parallel requests for the last seat give one 200 and nine 409s; two parallel check-ins of one guest give one check-in; invariants are `[]`.

- **Method:** integration-test
- **Test:** `test/customapp-race.test.js` › "GIVEN one free seat and a real listening server WHEN 10 parallel requests claim it and two parallel check-ins target one guest THEN one 200 and nine 409 table_full, one check-in, and invariants []"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-081: Acceptance "Preferred guest / no-show": the existing assignment is retrieved; the reserved seat stays blocked until a manual release; a late arrival after release is referred.

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN a preferred guest with a reservation WHEN they arrive, when they do not arrive, and when they arrive after a manual release THEN the reservation is retrieved, stays blocked until released, and the late arrival is referred"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-082: Acceptance "Manual alternative / all tables full": a manual alternative is allowed within authority and capacity; nothing is allocated when no eligible seat remains.

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN a staffer choosing a non-recommended eligible table and an event with every eligible table full WHEN they assign THEN the alternative succeeds within authority and capacity and the full case allocates nothing and refers to the Super Administrator"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-083: Acceptance "Duplicate / simultaneous check-in": only one registration and one allocation per guest.

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN one guest WHEN two devices check them in and seat them at the same time THEN there is one registration and one allocation"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-084: Acceptance "Last available seat": one concurrent assignment succeeds; the other gets `table_full` with fresh options.

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN one seat left WHEN two staff assign different guests at once THEN one succeeds and the other gets 409 table_full with fresh options"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-085: Acceptance "Transfer / swap / release": all affected capacity counts update; no overbooking and no lost assignment.

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN seated and reserved guests WHEN transfer, swap and release run THEN every affected count is right, nothing is overbooked and no assignment is lost"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-014: Public verify with a uniform referral reply

Tier: Tier 1 · Due: 3 Dec 2026 · Agent: Skeptic

#### AC-086: `GET /api/public/event/:code` returns `{name, date, state: closed|open, opensAt}` and nothing else, answered only when the event is `live`.

- **Method:** integration-test
- **Test:** `test/customapp-public.test.js` › "GIVEN a live event and an unknown code WHEN GET /api/public/event/:code is called THEN the live event returns only name, date, state and opensAt and nothing else"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-087: One exact match on the normalised surname plus last 4 (or the full email) runs `commit(selfCheckIn)` with `via:'self'` and returns `{token, state, firstName, table?, seat?}`; the `selfCheckIn` plan can only check a guest in.

- **Method:** integration-test
- **Test:** `test/customapp-public.test.js` › "GIVEN an open window and a guest on the list WHEN POST .../verify sends the exact normalised surname and last 4 THEN commit(selfCheckIn) runs with via self and the reply is token, state, firstName and table and seat if seated"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-088: Every failure (no match, ambiguous, capped, malformed, unlisted, window closed mid-request, `registrationOpen=false` or `readOnly` after doors open) returns the same status and a byte-identical body apart from the random `R-xxx` code from one pool.

- **Method:** integration-test
- **Test:** `test/customapp-public.test.js` › "GIVEN no match, an ambiguous pair, a capped surname, a malformed body, an unlisted name, a window closed mid-request, registrationOpen false and readOnly WHEN each verifies THEN every reply has the same status and a byte-identical body apart from the R-xxx code"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-089: Failure replies are padded to the success path's timing (timing parity measured under load).

- **Method:** metric
- **Test:** `scripts/event-load.mjs` › "GIVEN load test 1 WHEN failing and succeeding verifies are timed THEN failure replies are padded to the success path's timing"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-090: 1,000 failed verifies cause 0 `db.save()` calls; failed attempts, caps and referral codes live in bounded in-memory maps (TTL 3 h, at most 5,000 entries).

- **Method:** unit-test
- **Test:** `test/customapp-public.test.js` › "GIVEN a spy on db.save() WHEN 1,000 failed verifies are sent THEN save is called 0 times and the in-memory maps stay within TTL 3 h and 5,000 entries"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-091: The soft cap is 8 distinct wrong last-4 values per (event, normalised surname) in 15 minutes; a repeated value counts once; it clears after 15 minutes or with one tap at the desk; there is no global lockout.

- **Method:** unit-test
- **Test:** `test/customapp-public.test.js` › "GIVEN one surname WHEN 8 distinct wrong last-4 values arrive in 15 minutes, a wrong value is repeated, 15 minutes pass, and staff clear the cap THEN the cap trips at 8 distinct values, a repeat counts once, it clears after 15 minutes or with one tap, and nobody else is locked"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-092: More than 30 failures in 5 minutes raises an alarm to the Super Administrator and locks nobody out.

- **Method:** unit-test
- **Test:** `test/customapp-public.test.js` › "GIVEN 31 failures within 5 minutes WHEN the next genuine guest verifies THEN an alarm is raised to the Super Administrator and the genuine guest still succeeds"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-093: The server-enforced activation window: before `window.opensAt` (and after `closesAt`) verify gets the uniform reply; boundaries are tested.

- **Method:** unit-test
- **Test:** `test/customapp-public.test.js` › "GIVEN window.opensAt WHEN verify arrives one second before and one second after THEN the first gets the uniform referral reply and the second proceeds"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-094: Only `application/json` is accepted, the body is capped at about 1 KB, surnames are 1–80 characters after normalisation with zero-width and control characters stripped, `last4` matches `^\d{4}$`, the email is the full address (at most 254), fields are never echoed, the helpdesk trap field, minimum fill time and a short user-agent denylist apply, and the check order is limiter → window → match.

- **Method:** unit-test
- **Test:** `test/customapp-public.test.js` › "GIVEN a form-encoded body, a 2 KB body, an 81-character surname, last4 abc1, a partial email, a filled trap field and a denylisted user agent WHEN each verifies THEN each gets the uniform reply, no field is echoed and the order is limiter, window, match"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-095: 300 verifies plus polling from one `x-forwarded-for` give zero 429s while the soft cap still trips.

- **Method:** integration-test
- **Test:** `test/customapp-public.test.js` › "GIVEN limits ON and TRUST_PROXY=1 WHEN 300 verifies plus status polling arrive from one x-forwarded-for THEN there are zero 429s and the soft cap still trips for a brute-forced surname"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-096: `GET /api/customapp/events/:id/referral/:code` shows staff the real failure reason and what the guest typed (masked).

- **Method:** integration-test
- **Test:** `test/customapp-public.test.js` › "GIVEN a referral code R-482 from a failed verify WHEN staff call GET .../referral/R-482 THEN they see the real reason and what the guest typed, masked"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-015: Guest status page and status token

Tier: Tier 1 · Due: 3 Dec 2026 · Agent: Advocate

#### AC-097: The status token is 32 random bytes, stored as SHA-256 and looked up by hash, at most 5 per guest (one per device), revocable by staff, and kept with the event so it survives a restart.

- **Method:** unit-test
- **Test:** `test/customapp-public.test.js` › "GIVEN a successful verify WHEN the token is issued, a sixth device verifies, staff revoke one and the server restarts THEN the token is 32 random bytes stored as SHA-256, at most 5 are kept, the revoked one fails and the rest survive the restart"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-098: `GET /api/public/event/:code/status` reads the token only from `X-Event-Token` and returns `{seq, pollMs, state: pending|seated|see_desk, title, firstName, table, seat}` or `{seq, pollMs, unchanged:true}`; no reply ever holds another guest's data.

- **Method:** integration-test
- **Test:** `test/customapp-public.test.js` › "GIVEN a valid token WHEN GET .../status is called with the token in X-Event-Token, in the query string and with ?since=seq THEN only the header works and the reply holds only this guest's seq, pollMs, state, title, firstName, table and seat, or unchanged"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-099: The token (and any `t=`) never appears in monitor, audit or devlog output; replies carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

- **Method:** integration-test
- **Test:** `test/customapp-public.test.js` › "GIVEN a verify and 20 status polls WHEN monitor, audit and devlog output are scanned THEN the token never appears and every reply carries Cache-Control no-store and Referrer-Policy no-referrer"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-100: Re-verifying from a second device is idempotent (no second check-in), shows the same status and adds a `reverified_other_device` flag for staff.

- **Method:** unit-test
- **Test:** `test/customapp-public.test.js` › "GIVEN a guest already checked in on one phone WHEN they verify again from a second phone THEN there is no second check-in, the same status is returned and a reverified_other_device flag is added for staff"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-101: `/event/<code>` serves standalone `public/event.html` under 40 KB, with its CSP hash in `pagePolicy`, `noindex`, `no-store` and no web fonts.

- **Method:** integration-test
- **Test:** `test/customapp-public.test.js` › "GIVEN a live event WHEN /event/<code> is requested THEN public/event.html is served under 40 KB with its CSP hash in pagePolicy, noindex and no-store and no web fonts"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-102: The guest page shows each U1 state: `closed` ("Registration opens at 6:00 PM.", no inputs), `verify`, `pending` (after 4 minutes adds "Still choosing. A staff member can help at the desk"), `seated` ("Welcome, Ms. Dela Cruz. Table 3, Seat 4", table number 56 px or larger), `referred` ("Please see the registration desk and show this code: R-482.") and `offline`; it never shows "not found", "invalid", "already checked in", a countdown, a lock screen or a 429.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN a guest phone WHEN the page is opened before the window, verified, left pending, seated, referred and taken offline THEN it shows the closed, verify, pending, seated, referred and offline states and never says not found, invalid, already checked in, a countdown, a lock screen or a 429"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-103: After verification `history.replaceState` puts the token in the URL fragment (`#s=<token>`) and the page keeps a `localStorage` copy, so a reload shows the status again.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN a verified guest page WHEN the page is reloaded THEN the status returns from the #s= fragment and the localStorage copy without verifying again"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-104: The status region is `aria-live="polite"`, focus moves to the result heading, and the status line says how old it is ("Updated 6:41 PM").

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN a pending guest page WHEN the seat is confirmed by staff THEN the aria-live polite region announces it, focus moves to the result heading and the status line reads Updated with the time"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-105: `curl -I` on staging confirms Caddy does not override `Referrer-Policy`, and `deploy/aws/Caddyfile` has no `log` directive.

- **Method:** manual-check
- **Test:** `manual: staging header check (devlog)` › "GIVEN staging behind Caddy WHEN curl -I is run on /event/<code> and the status endpoint and the Caddyfile is read THEN Referrer-Policy no-referrer survives and there is no log directive"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-016: Zero-typing QR presence key (Should)

Tier: Tier 1 · Due: 3 Dec 2026 (built); enabled only after load test 1 passes on 4 Dec · Agent: Strategist

#### AC-106: When the event has `qrKeyHash`, verify with a wrong or missing `k` gets the uniform referral reply and the correct `k` proceeds; the key is stored hashed.

- **Method:** unit-test
- **Test:** `test/customapp-public.test.js` › "GIVEN an event with qrKeyHash set WHEN verify is sent with the correct k, a wrong k and no k THEN the correct key proceeds and the others get the uniform referral reply, and the key is stored only as a hash"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-107: The reception QR sheet (`public/js/vendor/qrcode.js`) encodes `/event/<code>` with the key, and the guest page sends `k` without the guest typing it.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN the reception QR sheet printed with public/js/vendor/qrcode.js WHEN a guest phone opens its link THEN the page sends k with verify without the guest typing it"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-108: The key stays off by default and is enabled only after load test 1 passes; the decision is recorded in the devlog.

- **Method:** manual-check
- **Test:** `manual: presence key enablement (devlog, 4 Dec)` › "GIVEN load test 1 results WHEN the key is considered for production THEN it stays off unless load test 1 passed and the decision is recorded"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-017: Delegation, scope enforcement and My queue

Tier: Tier 1 · Due: 3 Dec 2026 · Agent: Advocate

#### AC-109: `delegateGuests` and `delegateTables` are Super Administrator only and never touch seats; each guest and table has at most one owner, who is active staff (I4).

- **Method:** unit-test
- **Test:** `test/customapp-scope.test.js` › "GIVEN guests and tables WHEN the Super Administrator delegates them and a staffer tries to delegate THEN each has at most one active owner, only the Super Administrator can delegate and no seat changes"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-110: `eventCan` runs on every guest and destination table in a plan; any element out of scope rejects the whole plan with `out_of_scope` or `needs_super_admin` (I10).

- **Method:** unit-test
- **Test:** `test/customapp-scope.test.js` › "GIVEN a transfer whose destination table belongs to another staffer WHEN the plan is checked THEN eventCan rejects the whole plan with out_of_scope or needs_super_admin"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-111: Delegations are re-read at commit time: a permission change applies on the next request, and a reallocation leaves confirmed claims intact.

- **Method:** integration-test
- **Test:** `test/customapp-scope.test.js` › "GIVEN staffer A owns guests and tables WHEN the Super Administrator reallocates them to B THEN A's next write gets 403, B can write and confirmed claims stay intact"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-112: Verified guests are routed to their owner's `queue(owner)`; guests with no owner, unlisted pending, flagged, and released-and-arrived guests are in the Super Administrator's `superQueue`.

- **Method:** unit-test
- **Test:** `test/customapp-scope.test.js` › "GIVEN owned and unowned guests, an unlisted pending guest, a flagged guest and a released preferred guest who arrived WHEN queues are derived THEN owned guests are in their owner's queue and the rest in the Super Administrator's queue"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-113: Event staff land on My queue: a sticky bar (event name, staffer name, "Last updated 2 s ago"), sections Waiting for table (oldest first), Checked in and seated, and Find guest; cards show name, company, industry chip, a class badge in text and a wait timer that turns amber at 4 minutes and red at 8.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN an Event staff account WHEN it signs in THEN it lands on My queue with the sticky bar, the three sections, oldest first, and cards with a text class badge and a wait timer amber at 4 minutes and red at 8"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-114: A guest the Super Administrator moved greys out with "Moved to Maria's queue by the Super Administrator, 6:52 PM" before it leaves the list, and a refused write after a reallocation shows a recovery screen; nothing disappears silently.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN a guest in staffer A's queue WHEN the Super Administrator moves it to Maria THEN A sees it grey out with "Moved to Maria's queue by the Super Administrator" and the time before it leaves, and A's next write on it shows a recovery screen"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-115: The empty queue reads "No one is waiting for you. Your tables: 5, 6, 7 (14 seats left)."

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN a staffer with tables 5, 6 and 7 and no one waiting WHEN My queue renders THEN it reads "No one is waiting for you. Your tables: 5, 6, 7 (14 seats left).""
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-116: Find guest by referral code fills in what the guest typed and the real reason; "Clear cap and check in" works in one tap.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN a guest with a capped surname and referral code R-482 WHEN staff type R-482 in Find guest THEN the real reason and what the guest typed appear and Clear cap and check in works in one tap"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-117: The "Event night, four devices" journey in `scripts/journeys.mjs` (a guest phone, two staff phones and the Super Administrator's desk, run at once) is green in `npm run journeys`.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN a guest phone, two staff phones and the Super Administrator's desk on one server WHEN npm run journeys runs THEN the Event night, four devices journey is green"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-118: Acceptance "Unauthorised cross-scope action": rejected; the Super Administrator can act or delegate; no duplicate guest or table ownership.

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN a staffer acting on a guest and a table outside their scope WHEN they assign THEN it is rejected, the Super Administrator can act or delegate, and no guest or table ever has two owners"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-119: Acceptance "Ownership reallocation / staff absent": the new owner receives the pending queue; the old owner loses write access; confirmed assignments remain intact.

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN staffer A is absent with pending guests and confirmed seats WHEN the Super Administrator reallocates A's scope to B THEN B receives the pending queue, A loses write access and confirmed assignments are intact"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-018: Recommendation engine

Tier: Tier 1 · Due: 3 Dec 2026 · Agent: Scout

#### AC-120: `eligible(table, guest, group)` = `table.active` && `classOK` (preferred→{preferred, mixed}; regular→{regular, mixed}; employee→{employee, mixed}; unlisted→its approved class; mixed only when `settings.mixedTables`) && free seats ≥ group size && not `excluded(tags)`.

- **Method:** unit-test
- **Test:** `test/customapp-rank.test.js` › "GIVEN preferred, regular, employee and unlisted guests, mixed tables on and off, a table with too few seats and an excluded tag WHEN eligible() is evaluated THEN only active tables of an allowed class with enough free seats and no exclusion are eligible"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-121: Ranking: tier 1 same industry, tier 2 related, tier 3 other eligible; within a tier, fits the whole group → more same-industry companions → fewer seats left after placement → table number (deterministic tie-break).

- **Method:** unit-test
- **Test:** `test/customapp-rank.test.js` › "GIVEN tables with same-industry, related-industry and other guests WHEN recommend() ranks them THEN same beats related beats other, and within a tier group fit, then more same-industry companions, then fewer seats left, then table number decide"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-122: Full and ineligible tables are never listed.

- **Method:** unit-test
- **Test:** `test/customapp-rank.test.js` › "GIVEN a full table and an ineligible table WHEN recommend() runs THEN neither is ever listed"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-123: `GET .../recommend?guestIds=` returns `[{tableId, tier, free, reasons[], selectable}]` split into `mine` and `othersReadOnly`, with human reasons ("Same industry: Banking, 3 of 6 seated", "Related: Insurance", "4 seats left"); when nothing fits it returns `{none:true, refer:'super_admin'}`.

- **Method:** integration-test
- **Test:** `test/customapp-rank.test.js` › "GIVEN a staffer with some tables WHEN GET .../recommend?guestIds= is called, and when nothing fits THEN results split into mine and othersReadOnly with tier, free, reasons and selectable, and nothing-fits returns none true and refer super_admin"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-124: `commit()` uses the same `eligible()` as a constraint; the ranking is advisory, so a non-recommended eligible table in scope is accepted.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a recommended table and a lower-ranked eligible table in scope WHEN the staffer assigns to the lower-ranked one THEN commit() accepts it, and an ineligible table is refused by the same eligible()"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-125: The bottom sheet shows up to 3 recommendations with reason lines, "Other eligible tables" (collapsed) and a read-only "Not yours" list.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN a regular guest WHEN the bottom sheet opens THEN up to 3 recommendations show reason lines, Other eligible tables is collapsed below and a read-only Not yours list follows"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-126: Acceptance "Regular guest / no match": multiple eligible industry-ranked tables; other eligible tables shown when there is no industry match.

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN a regular guest from Banking with and without Banking guests seated WHEN recommendations are requested THEN several eligible industry-ranked tables are offered, and other eligible tables when nothing matches"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-019: Live sync by short poll

Tier: Tier 1 · Due: 3 Dec 2026 · Agent: Scout

#### AC-127: `GET .../changes?since=<seq>&tab=<id>` returns `{seq, pollMs, unchanged:true}` without building a board when nothing has changed.

- **Method:** unit-test
- **Test:** `test/customapp-sync.test.js` › "GIVEN a client at the current seq WHEN it calls changes?since=seq THEN the reply is seq, pollMs and unchanged true and no board is built"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-128: When `seq` has moved, the reply is `{seq, pollMs, board}` scoped by the access policy (a non-owner sees name, company, industry and table only).

- **Method:** integration-test
- **Test:** `test/customapp-sync.test.js` › "GIVEN seq has moved WHEN an owner and a non-owner poll THEN each gets seq, pollMs and a board scoped by the access policy, with no contact fields for the non-owner"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-129: The `wait` parameter is accepted and ignored.

- **Method:** unit-test
- **Test:** `test/customapp-sync.test.js` › "GIVEN a poll with wait=25 WHEN it is answered THEN it returns at once as if wait were absent"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-130: When the server's `seq` is behind `since` (a restored standby), the client receives a full board.

- **Method:** unit-test
- **Test:** `test/customapp-sync.test.js` › "GIVEN a restored standby whose seq is behind the client's since WHEN the client polls THEN it receives a full board"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-131: `pollMs` is 2 s for staff boards, 4 s for pending guest pages and 10 s once seated, with jitter; raising it to 8 s for guests and 4 s for staff applies on the next reply with no deploy.

- **Method:** integration-test
- **Test:** `test/customapp-sync.test.js` › "GIVEN default pacing WHEN staff and guests poll and the Super Administrator raises pollMs THEN staff get 2 s, pending guests 4 s and seated guests 10 s with jitter, and 8 s guests / 4 s staff apply on the next reply with no deploy"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-132: A reallocated staffer's next poll drops the old queue.

- **Method:** integration-test
- **Test:** `test/customapp-sync.test.js` › "GIVEN staffer A's guests reallocated to B WHEN A polls next THEN A's queue no longer contains them"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-133: Polling pauses on `visibilitychange` and backs off while offline; after 15 s without updates the sticky bar turns amber and reads "Reconnecting…".

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN a staff board WHEN the tab is hidden, then the network drops for 15 s THEN polling pauses while hidden, backs off while offline and the sticky bar turns amber with Reconnecting…"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-134: Change records use the closed `CHANGE_TYPES` set from `shared/customapp/statuses.js`.

- **Method:** unit-test
- **Test:** `test/customapp-sync.test.js` › "GIVEN CHANGE_TYPES in shared/customapp/statuses.js WHEN any change record is written THEN its type is in the closed set"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-020: Safety nets: 5-minute export copies and the 60 s invariant self-check

Tier: Tier 1 · Due: 3 Dec 2026 · Agent: Operator

#### AC-135: Every 5 minutes the export v1 is written to `data/backups/events/` by the same export function, keeping the last 24.

- **Method:** unit-test
- **Test:** `test/customapp-export.test.js` › "GIVEN a live event WHEN the 5-minute writer runs 30 times THEN it writes the export v1 with the same function into data/backups/events/ and keeps the last 24"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-136: `GET .../invariants` returns `checkInvariants()` over the whole event (used by the self-check and the load script).

- **Method:** integration-test
- **Test:** `test/customapp-export.test.js` › "GIVEN a clean event and one with a forced violation WHEN GET .../invariants is called THEN it returns [] and the violation respectively"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-137: The 60 s self-check runs `checkInvariants()` and records any violation to the monitor, which shows a banner on the health strip.

- **Method:** unit-test
- **Test:** `test/customapp-invariants.test.js` › "GIVEN the 60 s self-check WHEN a violation is introduced THEN the next run records it to the monitor for the health strip banner"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-021: Group arrivals

Tier: Tier 2 · Due: 5 Dec 2026 · Agent: Architect

#### AC-138: `assign {placements[], allowSplit}` commits every group member in one commit, or none.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a group of 4 and a table with 3 free seats WHEN assign places all 4 there THEN nothing is committed, and with 4 free seats all 4 are committed in one commit"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-139: Only tables with n or more free seats are ranked for a group of n; when none fits, split suggestions (the largest partitions that fit) are returned and a split needs `allowSplit:true`.

- **Method:** unit-test
- **Test:** `test/customapp-rank.test.js` › "GIVEN a group of 6 and no table with 6 free seats WHEN recommend() runs and assign is sent with and without allowSplit THEN only tables with at least 6 free are ranked, split suggestions give the largest partitions that fit, and the split needs allowSplit true"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-140: A group whose members have different owners can only be seated by the Super Administrator.

- **Method:** unit-test
- **Test:** `test/customapp-scope.test.js` › "GIVEN a group whose members have different owners WHEN a staffer tries to seat it THEN it is refused with needs_super_admin and the Super Administrator can seat it"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-141: The UI offers checkboxes and "Seat together (n)", needs an explicit "Split group" confirm, and shows "Send group to Super Administrator" for a group with different owners.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN three selected guests WHEN the staffer taps Seat together (3) and later tries a split THEN only fitting tables are ranked, the split needs an explicit Split group confirm, and a mixed-owner group shows Send group to Super Administrator"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-142: Each group member keeps an individual registration and assignment.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a seated group WHEN one member is transferred THEN only that member's check-in and seat change"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-143: Acceptance "Employee / group arrivals": eligible employee tables; group-fit recommendations; alternatives when the group cannot fit.

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN employees and a group arriving together WHEN they are recommended and seated THEN employees get eligible employee tables, the group gets group-fit tables, and alternatives appear when it cannot fit"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-022: Unlisted guests and substitutes

Tier: Tier 2 · Due: 5 Dec 2026 · Agent: Architect

#### AC-144: `createUnlisted` (any staffer) puts the guest in the Super Administrator's inbox; an unlisted guest cannot be seated before approval.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN a staffer WHEN createUnlisted records a walk-in and then assign is tried before approval THEN the guest is in the Super Administrator's inbox and the assign is refused"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-145: `approve` and `reject` are Super Administrator only; approval records identity, classification and industry with `{state, by, at, note}`.

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN an unlisted guest WHEN a staffer and the Super Administrator each approve or reject THEN only the Super Administrator can, and approval records identity, classification, industry, by, at and note"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-146: `substitute {originalId, newGuest}` moves the seat in one commit and links `substituteFor`/`substitutedBy`; the original and the substitute never both hold a seat (I6).

- **Method:** unit-test
- **Test:** `test/customapp-engine.test.js` › "GIVEN Pedro Reyes seated at 3-4 WHEN substitute {originalId, newGuest} records Juan Reyes THEN the seat moves to Juan in one commit, substituteFor and substitutedBy link them and they never both hold a seat"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-147: Add walk-in and Record substitute go to the Super Administrator's inbox; a substitute is shown as one seat changing hands ("Seat 3-4: Juan Reyes replaces Pedro Reyes").

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN Find guest WHEN a staffer uses Add walk-in and Record substitute THEN both reach the Super Administrator's inbox and the substitute shows as "Seat 3-4: Juan Reyes replaces Pedro Reyes""
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-148: The approval and change history (spec s.7 and s.13) is read from `caChanges` with actor and timestamp.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN an approval and a substitution WHEN the guest's history is read THEN it lists each approval and change with actor and time from caChanges"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-149: Acceptance "Unlisted / substitute": approval, classification and audit recorded; the original reservation handled without double allocation.

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN an unlisted guest and a substitute for a reserved invitee WHEN they are approved and seated THEN approval, classification and audit are recorded and the original reservation is handled without a double allocation"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-023: Email outbox

Tier: Tier 2 · Due: 5 Dec 2026 (go/no-go 3 Dec) · Agent: Scout

#### AC-150: `smtpOptions()` and `canEmail()` (`server/helpdesk.js:245-261`) are extracted into a shared `mailTransport(db)` used by the helpdesk and the outbox.

- **Method:** unit-test
- **Test:** `test/customapp-outbox.test.js` › "GIVEN server/helpdesk.js WHEN smtpOptions() and canEmail() are extracted into mailTransport(db) THEN the helpdesk and the outbox use the same transport and the helpdesk tests stay green"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-151: `afterCommit` queues an `assignment` or `update` message in `caOutbox` after the save when a seat is confirmed or changed and an address exists, with the body rendered from a seat snapshot; with no address, the notification is "not applicable".

- **Method:** unit-test
- **Test:** `test/customapp-outbox.test.js` › "GIVEN a seat confirmed or changed for guests with and without an address WHEN afterCommit runs THEN an assignment or update message is queued after the save with a body from the seat snapshot, and the guest with no address is marked not applicable"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-152: `outbox.js` drains a capacity-1 FIFO outside `commit()`: `sending` → `await sendMail(mailTransport(db))` → `sent` or `failed`, updating `guest.notify`; status writes are debounced to one save every 2 s.

- **Method:** integration-test
- **Test:** `test/customapp-outbox.test.js` › "GIVEN three queued messages and fakeSmtp WHEN the drain runs THEN they are sent one at a time in order, outside commit(), as queued to sending to sent, and status writes are debounced to one save every 2 s"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-153: An SMTP failure never touches `seat` or `arrival`; transient errors are retried three times with backoff.

- **Method:** integration-test
- **Test:** `test/customapp-outbox.test.js` › "GIVEN fakeSmtp failing transiently and then permanently WHEN a message is drained THEN it is retried three times with backoff and seat and arrival are untouched"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-154: A manual Resend is a `notify` command and creates a new attempt.

- **Method:** integration-test
- **Test:** `test/customapp-outbox.test.js` › "GIVEN a failed message WHEN staff press Resend THEN a notify command creates a new attempt"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-155: `emailPaused` queues messages without sending.

- **Method:** unit-test
- **Test:** `test/customapp-outbox.test.js` › "GIVEN emailPaused true WHEN seats are confirmed THEN messages are queued and none is sent"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-156: After a restart, a message left in `sending` for more than 2 minutes is queued again.

- **Method:** unit-test
- **Test:** `test/customapp-outbox.test.js` › "GIVEN a message left in sending for 3 minutes WHEN the server restarts THEN it is queued again"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-157: Messages use the event's own `emailFrom` and `replyTo` (never the helpdesk IMAP mailbox) and names are encoded with `composeMessage` encoded words.

- **Method:** unit-test
- **Test:** `test/customapp-outbox.test.js` › "GIVEN an event with emailFrom and replyTo and a guest named José Ñúñez WHEN the message is composed THEN it uses the event's From and Reply-To, never the helpdesk mailbox, and the name is an encoded word"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-158: If email is cut, the guest page replaces the "email sent" line with "Screenshot this screen" and the email surfaces are hidden.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN email is cut WHEN a seated guest's page renders THEN the email sent line is replaced by Screenshot this screen and staff email surfaces are hidden"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-159: The 3 Dec email go/no-go is recorded in the devlog, and `emailPaused` is set to match.

- **Method:** manual-check
- **Test:** `manual: email go/no-go (devlog, 3 Dec)` › "GIVEN the sender address, SMTP status and schedule on 3 Dec WHEN the go/no-go is held THEN the decision is recorded and emailPaused set accordingly"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-160: Acceptance "Email failure / no email": the confirmed assignment stays valid; the display or staff notification works; a retry is available (or the email surfaces are hidden if email is cut).

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN a confirmed seat WHEN the email fails and when the guest has no email THEN the assignment stays valid, the display works and a retry is available"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-024: Event control dashboard

Tier: Tier 2 · Due: 5 Dec 2026 · Agent: Advocate

#### AC-161: The counts row (Invited · Checked in · Not yet arrived · Waiting for table · Needs approval · Seats left) is derived from the source and matches a recount.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN a fixture event WHEN the dashboard data is requested THEN Invited, Checked in, Not yet arrived, Waiting for table, Needs approval and Seats left match a recount from the source"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-162: The occupancy grid shows one tile per table with number, class label, meter with a text count and owner; a full table is dimmed and labelled "Full".

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN the Super Administrator's desk WHEN Event control opens THEN every table has a tile with number, class label, meter with a text count and owner, and a full table is dimmed and labelled Full"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-163: The exceptions inbox (Must) lists walk-in and substitute approvals, "No seat in scope", released reservations whose guest has arrived, capped surnames and the failure-rate alarm.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN a walk-in, a substitute, a No seat in scope referral, a released reservation whose guest arrived, a capped surname and a failure-rate alarm WHEN the exceptions inbox is read THEN each appears"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-164: The workload table shows staffer · waiting · longest wait · last active, with a per-guest and per-table "Move to…" action.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN two staffers with waiting guests WHEN the workload table is used to Move a guest and a table THEN it shows staffer, waiting, longest wait and last active and the move is applied through commit()"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-165: The health strip shows `seq`, save p95, outbox depth, the age of the newest export, the 429 count and the invariant self-check result; a violation shows a banner.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN a running event WHEN the health strip is read THEN it shows seq, save p95, outbox depth, the age of the newest export, the 429 count and the self-check result, and a violation raises the banner"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-166: Flags are toggles whose confirm dialogs name the effect ("Turn off self check-in? Guests will be sent to the desk."); a release confirm names the guest, table and seat; removing a table that has guests is disabled with a "Move guests…" action.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN Event control WHEN the Super Administrator turns off registrationOpen, releases a reservation and tries to remove a table with guests THEN each confirm names its effect, the release confirm names guest, table and seat, and removal is disabled with Move guests…"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-167: Transfer, swap and release are available from Event control and update every device on its next poll.

- **Method:** e2e-test
- **Test:** `scripts/journeys.mjs` › "GIVEN seated guests WHEN the Super Administrator transfers, swaps and releases from Event control THEN each goes through commit() and every device shows the new counts on its next poll"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-025: Offline pack and paper reconciliation

Tier: Tier 2 · Due: 5 Dec 2026 · Agent: Operator

#### AC-168: The print pack, derived from export v1, holds an A–Z list, per-table sheets and per-staffer sheets covering every claim, with every page stamped "as of HH:MM".

- **Method:** integration-test
- **Test:** `test/customapp-export.test.js` › "GIVEN an export v1 WHEN the print pack is generated THEN it has an A–Z list, per-table sheets and per-staffer sheets covering every claim, each page stamped as of HH:MM"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-169: "Reconcile paper seating" replays each paper entry as a command with `via:'reconcile'`, `occurredAt` and an `opId` through `commit()`; a paper overbooking is refused and listed as a recovery card, not applied.

- **Method:** integration-test
- **Test:** `test/customapp-api.test.js` › "GIVEN paper entries including one that would overbook a table WHEN Reconcile paper seating replays them THEN each goes through commit() with via reconcile, occurredAt and an opId, and the overbooking is refused and listed as a recovery card"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-170: Re-entering the same paper sheet creates no duplicates (`opId`).

- **Method:** unit-test
- **Test:** `test/customapp-api.test.js` › "GIVEN a paper sheet already reconciled WHEN it is entered again THEN no duplicate check-in or seat is created"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-171: The easel card ("If this page doesn't open, please go to the registration desk.") and the staff desk card (standby URL; "If the app restarts you'll be signed out. Sign in again and you'll land back on your queue") are printed from the guide.

- **Method:** manual-check
- **Test:** `manual: printed contingency pack review` › "GIVEN the guide's desk card and the easel card WHEN they are printed THEN the easel card reads "If this page doesn't open, please go to the registration desk." and the desk card has the standby URL and the re-login line"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-172: Acceptance "Connectivity / recovery": the printed pack covers every claim; paper re-entry by `opId` creates no duplicates.

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN an export and paper changes made while offline WHEN they are reconciled THEN the printed pack covers every claim and re-entry by opId creates no duplicate allocation"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-026: CORE guide "custom-app-events", whats-new and screenshots

Tier: Tier 2 (a part in every tier commit) · Due: 5 Dec 2026 · Agent: Advocate

#### AC-173: `docs/guides/custom-app-events.md` has a valid header (roles include `eventstaff`; apps `customapp`) and the five required sections; its How to… holds "Seat a guest", "When a table fills up", "Find a guest at the desk", "Event control (Super Administrator)" and "If the system is down".

- **Method:** unit-test
- **Test:** `test/guides.test.js` › "GIVEN docs/guides/custom-app-events.md WHEN the guides test runs THEN its header is valid (roles include eventstaff, apps customapp) and it has Before you start, Walkthrough, How to, Screens at a glance and Questions"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-174: Every CUSTOM APP sidebar item is covered by a guide.

- **Method:** unit-test
- **Test:** `test/guides.test.js` › "GIVEN the CUSTOM APP sidebar WHEN the guides test runs THEN every item (My queue, Find guest, Event control, Setup) is covered by the guide"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-175: Every image the guide shows exists and is listed in `docs/guides/screenshots.json` (with `user` and `url`), retaken with `npm run guides:screenshots -- <file.jpg>`.

- **Method:** unit-test
- **Test:** `test/guides.test.js` › "GIVEN the guide's images WHEN the guides test runs THEN each exists, is listed in docs/guides/screenshots.json with a user and url, and was retaken with npm run guides:screenshots"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-176: Each tier commit carries the version bump, devlog entry, guide change, a `whats-new.md` line (newest first) and retaken screenshots.

- **Method:** manual-check
- **Test:** `manual: tier commit review` › "GIVEN each tier commit (1, 3 and 5 Dec) WHEN it is reviewed THEN it carries the version bump, devlog entry, guide change, a whats-new line (newest first) and retaken screenshots"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-177: The guide holds the O6 event-day runbook (T-3h checklist, doors, act-on thresholds, degrade ladder, close, 10 Dec) and the line "Never run RESTORE.md §1 while an event is `live`."

- **Method:** manual-check
- **Test:** `manual: operator guide review` › "GIVEN the guide's If the system is down section WHEN it is reviewed with the on-call developer THEN it holds the T-3h checklist, the doors step, the act-on thresholds, the degrade ladder, close and 10 Dec steps, and "Never run RESTORE.md §1 while an event is live""
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-027: Tier 2 acceptance, reuse proof and the 5 Dec client demo

Tier: Tier 2 · Due: 5 Dec 2026 · Agent: Strategist

#### AC-178: The acceptance-critical engine cases pass over YEP and "Test Gala" (capacity 8, no employee tables, no seat numbers), and events are isolated.

- **Method:** unit-test
- **Test:** `test/customapp-reuse.test.js` › "GIVEN the YEP event and a Test Gala event (capacity 8, no employee tables, no seat numbers) WHEN the acceptance-critical engine cases run on both THEN both pass and neither event sees the other's data"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-179: A grep finds no YEP string in `server/customapp`.

- **Method:** unit-test
- **Test:** `test/customapp-reuse.test.js` › "GIVEN server/customapp WHEN it is searched for YEP strings THEN none is found"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-180: All 12 named scenarios in `test/customapp-acceptance.test.js` are green (the evidence pack).

- **Method:** integration-test
- **Test:** `test/customapp-acceptance.test.js` › "GIVEN the 12 named spec scenarios WHEN customapp-acceptance runs THEN all 12 are green"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-181: On 5 Dec all 12 scenarios are demonstrated to Legati/ICD on several simultaneous devices and the sign-off is recorded.

- **Method:** manual-check
- **Test:** `manual: client acceptance demo (5 Dec)` › "GIVEN Legati and ICD with several devices WHEN the 12 scenarios are demonstrated with sample data THEN each is observed and the sign-off is recorded"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-182: The four flags (`registrationOpen`, `emailPaused`, `readOnly`, `pollMs`) are shown working with no deploy.

- **Method:** manual-check
- **Test:** `manual: client acceptance demo (5 Dec)` › "GIVEN the demo WHEN registrationOpen, emailPaused, readOnly and pollMs are each changed THEN each takes effect with no deploy"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-028: Staging restore drill, warm standby and load test 1

Tier: Ops (readiness) · Due: 4 Dec 2026 (staging built 1–3 Dec) · Agent: Operator

#### AC-183: Staging is built with `RESTORE.md` §2 from the latest offsite copy, on the production instance type, with its own hostname and a certificate issued in advance; `emailPaused=true` and SMTP points at a sink before the first start; each step is timed.

- **Method:** manual-check
- **Test:** `manual: staging restore drill (devlog, 1–3 Dec)` › "GIVEN the latest offsite copy WHEN staging is built with RESTORE.md §2 on the production instance type with its own hostname and certificate THEN emailPaused is true and SMTP points at a sink before the first start, and each step is timed"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-184: The measured RTO from "primary lost" to "staff on the standby URL" is under 30 minutes.

- **Method:** metric
- **Test:** `metric: restore drill RTO` › "GIVEN the timed drill WHEN primary lost to staff on the standby URL is measured THEN it is under 30 minutes"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-185: `scripts/event-load.mjs` uses only Node's standard library and drives the load from one source IP with limits ON.

- **Method:** unit-test
- **Test:** `test/scripts.test.js` › "GIVEN scripts/event-load.mjs WHEN its imports are read THEN it uses only node: modules and drives one source IP with limits ON"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-186: Load test 1 (4 Dec): zero 429s to real guests and staff.

- **Method:** metric
- **Test:** `scripts/event-load.mjs` › "GIVEN load test 1 on staging (300 guest pages at 4 s, 15–30 staff boards at 2 s, 40 verify-and-check-in in 10 minutes, a last-seat race on 3 contexts, one injected unhandled rejection) WHEN it runs THEN real guests and staff get zero 429s"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-187: Load test 1: `save()` p95 under 100 ms.

- **Method:** metric
- **Test:** `scripts/event-load.mjs` › "GIVEN load test 1 WHEN save() is timed THEN p95 is under 100 ms"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-188: Load test 1: event-loop delay p99 under 200 ms.

- **Method:** metric
- **Test:** `scripts/event-load.mjs` › "GIVEN load test 1 WHEN event-loop delay is sampled THEN p99 is under 200 ms"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-189: Load test 1 ends with a clean invariant scan: zero overbooked tables, duplicate check-ins, double seats, holds and reservations released by expiry, and exactly one Super Administrator.

- **Method:** metric
- **Test:** `scripts/event-load.mjs` › "GIVEN the end of load test 1 WHEN GET .../invariants is scanned THEN there are zero overbooked tables, duplicate check-ins, double seats, holds and expiry releases, and exactly one Super Administrator"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-029: Load test 2 with the kill -9 drill and the dress rehearsal

Tier: Ops (readiness) · Due: 6 Dec 2026 · Agent: Skeptic

#### AC-190: Load test 2 (6 Dec) with `systemctl kill -s KILL ltdc-erp` at minute 5: staff are back in, or on paper, within 3 minutes.

- **Method:** metric
- **Test:** `scripts/event-load.mjs` › "GIVEN load test 2 on the real list WHEN systemctl kill -s KILL ltdc-erp runs at minute 5 THEN staff are back in, or on paper, within 3 minutes"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-191: No committed check-in is lost, compared with the export taken just before the kill.

- **Method:** metric
- **Test:** `scripts/event-load.mjs` › "GIVEN an export taken just before the kill WHEN the restarted server is compared with it THEN no committed check-in is lost"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-192: A CORE Admin restore attempted while the window is open leaves the event untouched.

- **Method:** manual-check
- **Test:** `manual: load test 2 drill sheet (6 Dec)` › "GIVEN the event window is open WHEN a CORE Admin restore is attempted THEN the event data is untouched"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-193: A Super Administrator transfer by a CORE admin takes under 2 minutes.

- **Method:** metric
- **Test:** `manual: load test 2 drill sheet (6 Dec)` › "GIVEN the Super Administrator is unavailable WHEN a CORE admin transfers the role with setSuperAdmin THEN it takes under 2 minutes and exactly one Super Administrator remains"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-194: Reconciliation through commands gives zero invariant violations.

- **Method:** metric
- **Test:** `scripts/event-load.mjs` › "GIVEN paper sheets from the drill WHEN they are reconciled through commands THEN the invariant scan shows zero violations"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-195: Freeze candidate: fuzz at 1,000 seeds is green.

- **Method:** unit-test
- **Test:** `test/customapp-fuzz.test.js` › "GIVEN the freeze candidate WHEN the fuzz suite runs at 1,000 seeds THEN every invariant holds"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-196: Freeze candidate: the race test passes five times in a row, and the commit is tagged.

- **Method:** integration-test
- **Test:** `test/customapp-race.test.js` › "GIVEN the freeze candidate WHEN the race test runs 5 times THEN every run gives one 200, nine 409s and invariants []"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-197: Dress rehearsal with real staff accounts and 2-step sign-in: QR scan to checked in median under 30 s; checked in to seated p90 under 2 minutes at peak.

- **Method:** metric
- **Test:** `manual: dress rehearsal (6 Dec)` › "GIVEN real staff accounts with 2-step sign-in and the rehearsal guests WHEN arrivals are timed THEN QR scan to checked in has a median under 30 s and checked in to seated a p90 under 2 minutes"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## US-030: Freeze, event-day runbook and close-out

Tier: Ops (readiness) · Due: 8 Dec 2026 (code freeze 7 Dec 18:00; event 9 Dec; close-out 10 Dec) · Agent: Operator

#### AC-198: Code freeze 7 Dec 18:00: the GitHub `production` reviewer gate is on, the event build is tagged, and the resize is done if the 30 Nov gate asked for it (Elastic IP checked first).

- **Method:** manual-check
- **Test:** `manual: freeze checklist (7–8 Dec)` › "GIVEN the event build WHEN the code freeze starts on 7 Dec at 18:00 THEN the GitHub production reviewer gate is on, the build is tagged and any resize the gate asked for is done after checking the Elastic IP"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-199: `touch /opt/ltdc-erp/data/DEPLOY_FREEZE` at 8 Dec 12:00; a deliberate push afterwards runs CI and fails the deploy job with exit 3, and production does not restart.

- **Method:** manual-check
- **Test:** `manual: freeze checklist (7–8 Dec)` › "GIVEN DEPLOY_FREEZE touched on 8 Dec at 12:00 WHEN a deliberate push is made THEN CI runs and the deploy job fails with exit 3 and production does not restart"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-200: On 8 Dec after the last deploy, a full backup is taken and the `ltdc-erp-offsite.timer` drop-in `OnCalendar=*:05/15` is added and confirmed with `systemctl list-timers`.

- **Method:** manual-check
- **Test:** `manual: freeze checklist (7–8 Dec)` › "GIVEN the last deploy is done WHEN the offsite timer drop-in OnCalendar=*:05/15 is added and a full backup taken THEN systemctl list-timers shows the 15-minute schedule"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-201: The T-3h checklist is completed: freeze file and gate on; offsite drop-in present; manual offsite backup confirmed in the Security monitor; standby topped up; smoke test on the rehearsal guest (verify, check in, seat, status, email to the sink); newest export under 5 minutes old and pulled by the laptop; pack printed with every page stamped "as of HH:MM"; staff devices signed in, on 4G and charged.

- **Method:** manual-check
- **Test:** `manual: event-day T-3h checklist (9 Dec)` › "GIVEN T-3h on 9 Dec WHEN the checklist is run THEN freeze and gate, timers, a manual offsite backup in the Security monitor, the standby top-up, the rehearsal-guest smoke test, an export under 5 minutes old on the laptop, the printed pack and staff devices on 4G are each confirmed"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-202: The post-event hard gates hold: zero overbooked tables, duplicate check-ins, double seats, holds and reservations released by expiry, and exactly one Super Administrator.

- **Method:** metric
- **Test:** `GET /api/customapp/events/:id/invariants (after the event)` › "GIVEN the event has closed WHEN the invariant scan runs THEN there are zero overbooked tables, duplicate check-ins, double seats, holds and expiry releases and exactly one Super Administrator"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-203: Close: `registrationOpen` off, final CSV and JSON export, manual offsite backup, retention date set.

- **Method:** manual-check
- **Test:** `manual: close-out checklist (9–10 Dec)` › "GIVEN the event closes WHEN close-out runs THEN registrationOpen is off, the final CSV and JSON exports are taken, a manual offsite backup runs and the retention date is set"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

#### AC-204: 10 Dec 09:00: the freeze file and timer drop-in are removed, the instance is resized back, staging is snapshotted and decommissioned, the export archive is handed to the client and the PII purge clock starts (covering `ca*`, the nightly copies, the event exports and the offsite lifecycle).

- **Method:** manual-check
- **Test:** `manual: close-out checklist (9–10 Dec)` › "GIVEN 10 Dec 09:00 WHEN the freeze is lifted THEN the freeze file and timer drop-in are removed, the instance is resized back, staging is snapshotted and decommissioned, the export archive is handed to the client and the PII purge clock starts"
- **Status:** pending
- **Evidence:** —
- **Verified-by:** —

## Verification Summary

| Story | Tier | Due | ACs | unit | integration | e2e | manual | metric | Verified |
|---|---|---|---|---|---|---|---|---|---|
| US-001 28 Nov ops half-day: freeze guard, kept release, rollback and crash logger | Ops (28 Nov) | 28 Nov 2026 | 8 | 2 | 4 | 0 | 1 | 1 | 0/8 |
| US-002 Restore carve-out keeps live event data | Ops (28 Nov) | 28 Nov 2026 | 7 | 5 | 1 | 1 | 0 | 0 | 0/7 |
| US-003 Event rate-limit buckets and the staff sign-in allowance | Ops (28 Nov) | 1 Dec 2026 | 4 | 2 | 2 | 0 | 0 | 0 | 0/4 |
| US-004 save() measurement and the 30 Nov storage gate | Ops (28 Nov) | 30 Nov 2026 | 3 | 0 | 0 | 0 | 2 | 1 | 0/3 |
| US-005 CUSTOM APP module shell and the Event staff account type | Tier 0 | 1 Dec 2026 | 6 | 2 | 3 | 0 | 1 | 0 | 0/6 |
| US-006 Event, table and industry setup | Tier 0 | 1 Dec 2026 | 6 | 5 | 1 | 0 | 0 | 0 | 0/6 |
| US-007 commit() unit of work, claimsAt(), invariants and typed refusals | Tier 0 | 1 Dec 2026 | 12 | 9 | 3 | 0 | 0 | 0 | 0/12 |
| US-008 Guest import with collision report | Tier 0 | 1 Dec 2026 | 7 | 4 | 2 | 1 | 0 | 0 | 0/7 |
| US-009 Seat commands: check-in, preferred retrieval, reservations, assign, transfer and swap | Tier 0 | 1 Dec 2026 | 8 | 8 | 0 | 0 | 0 | 0 | 0/8 |
| US-010 Staff Find guest and seating screens | Tier 0 | 1 Dec 2026 | 6 | 0 | 2 | 4 | 0 | 0 | 0/6 |
| US-011 Event Super Administrator and runtime flags | Tier 0 | 1 Dec 2026 | 6 | 3 | 3 | 0 | 0 | 0 | 0/6 |
| US-012 Export JSON v1, CSV and printable plan | Tier 0 | 1 Dec 2026 | 4 | 2 | 2 | 0 | 0 | 0 | 0/4 |
| US-013 Tier 0 proof suite: fuzz, race and the Tier 0 acceptance rows | Tier 0 | 1 Dec 2026 | 8 | 1 | 6 | 0 | 0 | 1 | 0/8 |
| US-014 Public verify with a uniform referral reply | Tier 1 | 3 Dec 2026 | 11 | 5 | 5 | 0 | 0 | 1 | 0/11 |
| US-015 Guest status page and status token | Tier 1 | 3 Dec 2026 | 9 | 2 | 3 | 3 | 1 | 0 | 0/9 |
| US-016 Zero-typing QR presence key (Should) | Tier 1 | 3 Dec 2026 | 3 | 1 | 0 | 1 | 1 | 0 | 0/3 |
| US-017 Delegation, scope enforcement and My queue | Tier 1 | 3 Dec 2026 | 11 | 3 | 3 | 5 | 0 | 0 | 0/11 |
| US-018 Recommendation engine | Tier 1 | 3 Dec 2026 | 7 | 4 | 2 | 1 | 0 | 0 | 0/7 |
| US-019 Live sync by short poll | Tier 1 | 3 Dec 2026 | 8 | 4 | 3 | 1 | 0 | 0 | 0/8 |
| US-020 Safety nets: 5-minute export copies and the 60 s invariant self-check | Tier 1 | 3 Dec 2026 | 3 | 2 | 1 | 0 | 0 | 0 | 0/3 |
| US-021 Group arrivals | Tier 2 | 5 Dec 2026 | 6 | 4 | 1 | 1 | 0 | 0 | 0/6 |
| US-022 Unlisted guests and substitutes | Tier 2 | 5 Dec 2026 | 6 | 3 | 2 | 1 | 0 | 0 | 0/6 |
| US-023 Email outbox | Tier 2 | 5 Dec 2026 | 11 | 5 | 4 | 1 | 1 | 0 | 0/11 |
| US-024 Event control dashboard | Tier 2 | 5 Dec 2026 | 7 | 0 | 3 | 4 | 0 | 0 | 0/7 |
| US-025 Offline pack and paper reconciliation | Tier 2 | 5 Dec 2026 | 5 | 1 | 3 | 0 | 1 | 0 | 0/5 |
| US-026 CORE guide "custom-app-events", whats-new and screenshots | Tier 2 (a part in every tier commit) | 5 Dec 2026 | 5 | 3 | 0 | 0 | 2 | 0 | 0/5 |
| US-027 Tier 2 acceptance, reuse proof and the 5 Dec client demo | Tier 2 | 5 Dec 2026 | 5 | 2 | 1 | 0 | 2 | 0 | 0/5 |
| US-028 Staging restore drill, warm standby and load test 1 | Ops (readiness) | 4 Dec 2026 | 7 | 1 | 0 | 0 | 1 | 5 | 0/7 |
| US-029 Load test 2 with the kill -9 drill and the dress rehearsal | Ops (readiness) | 6 Dec 2026 | 8 | 1 | 1 | 0 | 1 | 5 | 0/8 |
| US-030 Freeze, event-day runbook and close-out | Ops (readiness) | 8 Dec 2026 | 7 | 0 | 0 | 0 | 6 | 1 | 0/7 |
| **Total** | | | **204** | 84 | 61 | 24 | 20 | 15 | **0/204** |

Progress: 0/204 verified
