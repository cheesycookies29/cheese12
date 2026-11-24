# Council meeting: the CBSUA architecture and its modules

**Date:** 2026-11-24 · **Mode:** meeting (discussion only, no action plan) · **Backend:** sequential (one-shot rounds)
**Panel (7 of 19):** Architect (systems, data), Operator (deployment, hosting), Tuner (scale, performance),
Skeptic (risk, security), Guardian (privacy, compliance), Advocate (users, UX), Strategist (scope, priorities)

## Topic

Review the architecture of Lancaster ATLAS as it is rolled out for CBSUA (a multi-campus state
university, enrolment in the low tens of thousands) and give each member's view of every module:
ATLAS home, Learn and the Admin panel, Academic, People, Finance, System, and the planned Facilities
and REX Bookstore e-Reader. The shared brief is [rounds/brief.md](rounds/brief.md); every member's
words are in [rounds/](rounds/) (r1 openings, r2q questions, r2a answers, r3 syntheses).

## The verdict, module by module

Each member's Round 3 verdict (G = go with conditions, N = not yet):

| Module | Arch | Oper | Tuner | Skeptic | Guardian | Advocate | Strat | Council | The conditions that matter most |
|---|---|---|---|---|---|---|---|---|---|
| ATLAS home | G | G | G | G | G | G | G | **Go with conditions** | Keycloak SSO for everyone and MFA for staff; privacy notice on sign-in; cached figures; `atlas.cbsua.edu.ph`, not DuckDNS |
| Learn + Admin panel | G | G | G | G | G | G | G | **Go with conditions** | Storage off the single JSON file before real volume, or a pilot of ≤ 2–3k students; sessions that survive a restart; quiz answers kept on the device with retry; self-registration and parent links off until consent exists |
| Academic | N | N | N | N | N | N | N | **Not yet** | `academicRecords` in a real table before the UIS import (with per-campus checksums); different people approve and post grades; module PIA, drop *religion*; one "My enrollment" tracker |
| People | G | N | N | N | N | G | G | **Not yet (4–3)** | A second person finalises payroll; government IDs and bank numbers masked; DTR rows in the new store; two reconciled parallel payroll runs before cutover |
| Finance | N | N | N | N | N | N | N | **Not yet** | Replace the rollback snapshot with a synchronous unit of work (see the finding below); administrators lose transactional powers; the seven COA/BIR items in FINANCE-PLAN §5 confirmed; a records retention matrix |
| System | G | G | G | G | G | G | G | **Go with conditions** | Deploys only from a protected release branch in declared windows (no 10-minute auto-update); hourly off-site backups with a rehearsed restore; alerts to named people; backup downloads audited; audit log copied off the server |
| Facilities | N | N | N | N | N | N | N | **Not yet** (cut from 2027) | One `rooms` entity owned with Academic scheduling; never a second property register beside Finance's |
| REX e-Reader | N | N | N | N | N | N | N | **Not yet** (hide the tile) | A data-sharing agreement and PIA first; share entitlements only, never store or serve book files from ATLAS |

## What the council found

1. **The data file breaks inside the first semester (Tuner, measured).** Every change rewrites the whole
   `db.json` (`lms/server/db.js`). On a synthetic school at CBSUA size (20.3k students, 100k
   enrollments), a save takes about 485–650 ms on day one; by about week 4 of Learn activity
   (two quiz attempts and two submissions per enrollment) `JSON.stringify` throws *Invalid string
   length* and **every later write fails**. Several screens also scan every enrollment per section
   (enrollment catalog 31.6 s, admin pending list 17.4 s at that size). Benchmarks:
   [tuner-bench/](tuner-bench/); timings from a 4-core machine, so a t3.small will be the
   same or slower.
2. **The fix keeps the no-dependency rule.** Move storage to the built-in `node:sqlite` (unflagged in Node
   22.13+, checked working here, still marked experimental, so behind a small adapter with a startup
   self-test). Bounded collections stay in memory with indexes; per-student and per-day collections
   (`academicRecords`, attempts, submissions, attendance, time entries, audit, sessions) live only in
   tables. The UIS import goes straight into tables. Safety nets: a bare `save()` fails `npm test`,
   a strict test database, a reconciler, per-collection count and SHA-256 checks at cut-over,
   `PRAGMA user_version` (rounds/r2a/architect.md).
3. **A live bug in Finance (Architect, verified by the conductor).** Finance takes a rollback copy of
   every `fin*` collection before a handler runs (`lms/server/api.js`, `finSnap`) and restores it if the
   handler fails. `POST` and `PUT /api/finance/users` wait for the slow password hash and validate again
   after it; if that late check fails, the restore throws away official receipts or journal entries
   other people saved during the wait. Narrow, but it breaks COA's gap-free numbering. Fix: commit each
   request's writes synchronously after the handler, never hold a snapshot across an `await`.
4. **Operations are pilot-grade.** The server installs every push to a working branch every 10 minutes;
   sessions live in memory, so each install signs everyone out; a rollback restores the pre-update data
   and can drop issued OR/DV numbers; nightly copies sit on the same disk; nothing alerts a person.
5. **There is no privacy layer yet.** No notice, consent or data-subject request flow. Sensitive data is
   already held (religion, government IDs, bank numbers, medical certificates, precise clock-in
   locations). Parents see adult students' grades without the student's consent. The audit log keeps
   names and changed values in clear inside the hash chain. No outsourcing agreement names LTDC, AWS
   Singapore and Cloudflare.
6. **Separation of duties has gaps where fraud happens** (Skeptic): one person can edit and finalise
   payroll; one registrar can approve and post grades; the administrator role holds every Finance power;
   one person can restore the whole database from the web. Claim separation of duties only where code
   enforces it.

## Cross-examination highlights

- **Advocate → Strategist:** is a January launch to 20k students acceptable with no quiz backup and
  sign-outs on every restart? → The Strategist made persisted sessions, the deploy freeze, the quiz
  backup and Keycloak self-service password reset into **January entry gates**.
- **Tuner → Strategist:** quiz windows are a write peak, not "traffic spread across the term". → The
  Strategist conceded and moved the storage work from the August wave into January.
- **Strategist → Tuner:** at what size does a save break the 200 ms budget? → About 6.5k students on day
  one; a 2k-student pilot reaches 316 ms by week 4 and 1.2 s by term end; at 20k the file stops
  saving by week 4.
- **Skeptic and Operator → Architect:** what stops a missed write, and how do backups stay consistent
  across two stores? → The Architect dropped the collection-by-collection move for one store, one
  cut-over and one backup file, and found the Finance rollback bug while answering.
- **Architect → Guardian:** how can erasure square with immutable backups and a hash chain? → Backups
  expire on a fixed 35-day clock, an erasure ledger is replayed on every restore, and records COA, CHED
  and the National Archives require are exempt under a signed retention matrix. The audit log is to keep
  ids only, with names in a side table.
- **Guardian → Operator:** which second region? → None until the PIA clears one: a separate, locked
  AWS account in Singapore, plus an encrypted nightly copy to storage CBSUA owns in the Philippines.

## Key insights (one per member)

- **Architect:** the storage move is a January gate, not an August one; commits must be synchronous and
  come after the handler.
- **Operator:** rollback is itself a way to lose data. Fix forward once a release has served traffic.
- **Tuner:** even with no quiz traffic, a 20k-student save takes 485 ms (enrollments 53 MB, users and
  profiles 23 MB); moving only Learn's writes is not enough.
- **Skeptic:** a rollback to memory across an `await` is unsafe; only grades, payroll and receipts need
  a request that fails loudly rather than a reconciler.
- **Guardian:** erasure and immutable backups can coexist (35-day expiry + erasure ledger); the audit
  log is not opaque today.
- **Advocate:** whether users lose work is decided in the data store, not in the browser.
- **Strategist:** storage cannot wait; the same layer is unsafe for money until the rollback is fixed.

## Unresolved tensions

1. **How to move the data.** The Architect now accepts the Tuner's bridge (move collections step by step
   into one SQLite file, with what is left of `db.json` kept as one blob inside it, so a request still
   commits once). After re-measuring, the Tuner says only the **full** cut-over meets a 50 ms save at
   20k students. They agree on one file and one transaction; they differ on how much moves before
   January.
2. **University-wide January or a pilot.** The Strategist keeps the January date only as a go/no-go on
   **2027-01-08**. Tuner, Advocate, Operator and Skeptic would launch a pilot of ≤ 2–3k students unless the
   cut-over passes a 20k-student test in `npm test`.
3. **Loud failure or reconciler.** The Skeptic accepts a 5-minute reconciler for Learn but wants the
   request itself to fail for grades, payroll and receipts; the Architect prices that at 30–100 ms per
   write unless those collections are in tables (where it is free).
4. **The audit chain versus erasure.** Moving names and values out of already-written hashed entries
   without breaking `verify()` is unproven.

## Questions for you (LTDC)

1. Is the January launch for **all ~20k students** or a **pilot of ≤ 3k** (one campus or college)?
   Will CBSUA accept lms2 running in parallel for everyone else?
2. How often will classes run **quizzes and assignments** in January? (This decides how long a pilot
   can run on the current store.)
3. Does CBSUA's **Keycloak** hold a recovery email or mobile number for every student? If not,
   password resets go back to the registrar's window.
4. Is CBSUA's **DPO** registered with the NPC, and will CBSUA accept **AWS Singapore** as the data
   location (or require on-premise)?
5. Who at CBSUA takes a **22:00 alert**, and will CBSUA sign a recovery target (data loss ≤ 1 hour,
   back in ≤ 4 hours)?
6. Do the smaller campuses have **two separate people** for every maker-checker step, or will checkers
   sit at another campus?

## Recommended next steps

1. **December: storage first.** Build the `node:sqlite` store and cut over before any CBSUA data is
   imported, with indexes and pagination on the hot screens and a CI test on a synthetic 20k-student
   school (catalog and pending list < 200 ms, save < 50 ms, sign-in at 11/s without errors). Fix the
   Finance rollback bug at the same time.
2. **This week: the operations and privacy packs.** For operations: switch off auto-update, deploy from
   a protected `release/cbsua` branch, hourly off-site backups with one rehearsed restore, alerts to
   named people, and `atlas.cbsua.edu.ph`. For privacy: send CBSUA's DPO a pre-filled notice, a
   processing addendum naming AWS Singapore and Cloudflare, and a PIA scoped to January. Make the DPO's
   sign-off a CBSUA-owned acceptance criterion.
3. **Contract in waves with gates.** January: home, Learn and System, as a pilot or university-wide
   per the go/no-go. Then People (payroll after two reconciled parallel runs, with a payroll checker),
   Academic (after the UIS import into tables, with grade separation of duties), enlistment, and Finance
   last (Fund 05 pilot, after the rollback fix and the §5 confirmations). Facilities is cut from 2027
   and REX is an optional add-on behind a data-sharing agreement.
