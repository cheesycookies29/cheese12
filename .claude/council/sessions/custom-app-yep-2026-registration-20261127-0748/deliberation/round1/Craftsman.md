# Craftsman Position: CUSTOM APP / YEP 2026 Registration & Table Assignment

**Lens:** purple. Testability, patterns, regression protection, and the developer who changes this
code on 7 December with guests arriving in 48 hours.

**Grounding:** spec.txt (sections 1 to 22, the 12 acceptance scenarios in section 07), the codebase
map, round 1 drafts from Architect, Advocate, Scout, Skeptic and Strategist, and these direct checks
of the repository:

- `node --test`: **716 tests, 3 min 10 s** on this machine (measured today).
- `server/api.js:1433-1460`: `handle()` has exactly one `await`, the one on the handler. A
  synchronous handler is therefore one turn of the event loop.
- `server/util.js:15`: `HttpError(status, message)` carries no structured payload.
- `scripts/journeys.mjs:43`: the browser journeys spawn CORE with **`RATE_LIMITS: 'off'`**.
- `.github/workflows/deploy-ec2.yml`: `test` + `journeys` must pass before `deploy`.
- `test/guides.test.js:20`: a hard-coded `MODULES` list; every sidebar label needs a guide.
- `test/crm.test.js`, `test/public-form.test.js`: the in-process `client()` / `visitor(ip)` harness.
- Only two test files use `Promise.all`, and both use it for logins, not for races.

**On n8n:** the clone that Architect and Scout read is no longer on disk. The n8n testing notes
below are from model knowledge and marked *(unverified)*. The n8n runtime patterns I build on are
the ones Architect and Scout verified.

---

## Core recommendation

Make the seating engine **a pure, synchronous `plan(state, command, actor, now)` function**, wrapped
by one `commit()` that applies the plan and saves. Guard it with **one shared `checkInvariants()`**
that runs:

- after every unit test,
- inside a seeded random-command fuzz test,
- at the end of the load script, and
- in production, as a read-only health check.

Then turn the spec's 12 acceptance scenarios into 12 named `node --test` cases, plus one multi-device
browser journey. The client gets the test output as the acceptance evidence, and every fix in the
last four days is re-proved automatically before it can deploy.

## Key argument

The spec's hardest guarantees are the ones a normal test suite here **cannot see**:

- the last seat goes to exactly one request,
- a check-in is never duplicated,
- a transfer or swap is atomic,
- a stale write is refused.

CORE's in-process harness calls `handle()` one request at a time. `Promise.all` over two "assign"
calls, with bodies already parsed, runs them **sequentially**. The test goes green whether or not
the handler is atomic.

The atomicity rests on a fact about structure, not behavior: no `await` between the check and
`db.save()`. The first person to break it will be well-meaning. Someone adds an `await sendMail()`
or an `await audit...` inside the confirm handler on 6 December to "email the assignment right
away". All 716 tests still pass, and the last-seat race opens in production. So the guarantee has to
be **built into the structure and tested at the structure**:

1. Mutations register through a `mutation(route, ...)` helper that **refuses an `AsyncFunction`
   handler at startup**, and a test asserts this.
2. The pure `plan()` is exercised directly, in milliseconds, with no database file and an injected
   clock.
3. A real-socket race test spawns `server.js` and fires N parallel `fetch` calls at the last seat.

The same discipline answers "reusable without over-engineering". The engine is reusable when a
**second fixture event** passes the same suite: different capacity, no employee tables, no seat
numbers. That proves no YEP strings are hard-coded, which a plugin framework would not prove. The
Rule of Three says build no "CUSTOM APP SDK" until the third client app.

What does deserve abstraction **now**, because it would otherwise be written in 8 places:

- the event fixture builder,
- the refusal-code catalogue, and
- `checkInvariants()`.

Each of those will be repeated by every one of the 8 mutation types (check in, assign, transfer,
swap, release, group assign, substitute, reallocate) and every one of the 5 or more test files.

### The design this lens asks of the build (concrete, CORE-idiomatic)

```
shared/customapp/
  refusals.js     // frozen catalogue shared by server + browser: STALE, FULL, SEAT_TAKEN,
                  // OUT_OF_SCOPE, NOT_ELIGIBLE, ALREADY_CHECKED_IN, REGISTRATION_CLOSED,
                  // DUPLICATE_NONCE_DIFFERENT_BODY, NOT_SUPER_ADMIN, TABLE_HAS_ASSIGNMENTS
  rank.js         // pure recommendation ranking (same / related industry, capacity, group fit)
  invariants.js   // checkInvariants(eventState) -> [] | [{rule, ids, detail}]
server/customapp/
  engine.js       // plan(state, cmd, actor, now) -> {ok:true, changes, events} | {ok:false, code, fresh}
                  // NO db, NO Date.now(), NO async, NO I/O. Pure.
  commit.js       // commit(db, cmd, actor): nonce check -> plan -> apply -> seq++ -> db.save()
                  // synchronous; then returns after-effects (email, wake pollers) for the caller
                  // to run AFTER the save
  routes.js       // registerCustomAppRoutes(route, db, {audit}); every write via mutation()
  public.js       // /api/public/event/:code/* (verify, status token)
  outbox.js       // email queue + per-message status; async, outside commit
```

Two small changes to CORE's shared code, each with its own test:

- `HttpError` gets an optional third argument, `new HttpError(409, msg, { code, fresh })`, and
  `handle()` serializes it as `{ error, code, fresh }`. This is backward compatible: no existing
  caller passes a third argument. The losing device then gets typed fresh options, which is what the
  Advocate's recovery screens need. Tests assert `code`, never message text, so copy can be improved
  for staff without breaking 40 assertions.
- `mutation()` wrapper:

```js
// server/customapp/routes.js
function mutation(route, method, path, perm, handler) {
  if (handler.constructor.name === 'AsyncFunction')
    throw new Error(`${method} ${path}: event writes must be synchronous (no await before save)`);
  route(method, path, perm, handler);
}
```

## Risks if ignored

- **Silent loss of atomicity (regression risk, highest).** The in-process suite cannot detect an
  `await` added to the critical section, and the browser journeys cannot either. They run with rate
  limits off and one clicker per page. The last-seat and duplicate-check-in guarantees would rest on
  code review alone, during the most rushed week of the project.
- **The #1 launch blocker is invisible to CI as it stands.** Skeptic, Scout and Advocate all found
  that `public-write` is 20 per hour per IP and `api-anon` is 120 per minute per IP. With 300 guests
  behind venue NAT, that limit is hit. `journeys.mjs` sets `RATE_LIMITS: 'off'`, so even a perfect
  browser journey passes. The guest path needs an **in-process test with limits ON**: 300 verifies
  plus polling from one `x-forwarded-for`, as `public-form.test.js` already does with
  `TRUST_PROXY=1`.
- **Pattern drift across 8 mutation types (consistency risk).** If each handler does its own
  "count seats", one of them will forget that active reservations and holds count toward 10
  (spec section 8). Swap and transfer are the usual culprits. One `plan()` with one capacity
  function, checked by one `checkInvariants()` after every fuzzed step, makes that bug impossible to
  merge.
- **Velocity collapse in the last 4 days (DX risk).** The full suite takes 3 min 10 s and journeys
  run on top of that. If the event tests are not runnable alone in under 5 s
  (`node --test test/customapp-*.test.js`), developers will skip them while fixing at the venue
  rehearsal.
- **Guides gate surprise (process risk).** CORE's `test/guides.test.js` hard-codes `MODULES` and
  requires a guide for every sidebar label. Adding the CUSTOM APP sidebar without a
  `docs/guides/events.md` (roles: event staff, admin) and a `whats-new.md` line fails `npm test`,
  which blocks deploy. The spec also asks for a "brief operator guide" (section 20). Write it once,
  as the guide, and it satisfies both.

## Dependencies on other domains

- **Architect:** split `commit()` into a pure `plan()` and an `apply/save` step. Give refusals the
  typed codes listed above. Return after-effects from `commit()`, never run them inside it. Agree
  the `seq` / long-poll contract so a test can assert "device B sees change within one poll".
- **Prover:** the authoritative invariant list for `checkInvariants()`. My draft is in Appendix C.
- **Skeptic / Guardian:** the abuse cases, as concrete test rows (enumeration timing, wrong last-4
  digits, token replay, master list never in a public response, PII fields in exports and staff
  read-only views).
- **Tuner:** the load targets: guests per minute at peak, staff count, poll interval, acceptable
  p95, and `db.save()` cost at the real file size, so `scripts/event-load.mjs` has pass/fail
  thresholds, not just numbers.
- **Operator:** a prod-like rehearsal target (a restored copy of production `db.json`) for the load
  script. A tagged freeze commit with `test` + `journeys` green. The freeze mechanism itself
  (environment reviewer) is theirs.
- **Advocate:** the recovery screens ("Table 5 just filled. Updated options:"), so the journey asserts
  them by visible text and the screenshot script captures them for the guide.
- **Strategist:** test scope per tier. The acceptance cases for a tier must be green at that tier's
  date (Appendix E).

---

## Appendix A: Test infrastructure audit (testing-strategy Step 1)

| Item | Today in CORE | Implication for CUSTOM APP |
|---|---|---|
| Runner | `node --test`, `node:assert/strict`, no deps | Same. Seeded PRNG for fuzzing written inline (mulberry32, 6 lines) |
| Harness | `openDb(tmp)` + `createApi(db)` + cookie `client()`; `visitor(ip)` with `TRUST_PROXY=1` | Reuse it. Extract an event fixture (Rule of Three: 5 or more files need it) |
| Fakes | `test/support/mail-servers.js` `fakeSmtp` / `fakeImap` | Outbox tests use `fakeSmtp` and a failing variant (refuse RCPT, drop connection) |
| Clock | No fake clock; handlers call `Date.now()` / `localDate()` | Engine takes `now` as a parameter. Only `commit()` reads the real clock |
| Browser | `scripts/journeys.mjs` (Playwright, desktop + phone contexts, **RATE_LIMITS off**) | Add one multi-context "Event night" journey. The rate-limit check lives in node tests |
| CI | `test` and `journeys` jobs gate `deploy` on every push to the branch | Every event commit is acceptance-tested before it reaches EC2 |
| Suite time | 716 tests, 3 min 10 s | Event files must be fast and runnable alone |
| Guides gate | `test/guides.test.js` (MODULES list, NAV labels, screenshots.json) | Add `customapp` to MODULES, `docs/guides/events.md`, screenshots |
| Module tests | `modules-roadmap.test.js`, `favorite-modules.test.js` assert module sets | Update for the new MODULES entry |
| Phone sweep | Journey 5 visits every menu page of every role at 390 px | Covers the new Event staff role automatically once it is in ROLES |

## Appendix B: Test pyramid summary (testing-strategy Steps 3 and 6)

| Layer | Files | Approx. count | Run time | Mock strategy |
|---|---|---|---|---|
| Unit (pure) | `customapp-engine`, `customapp-rank`, `customapp-invariants`, `customapp-fuzz`, `customapp-import` | ~110 | < 2 s | None. Plain objects in, plan out; injected `now` |
| Integration (in-process API) | `customapp-api`, `customapp-scope`, `customapp-public`, `customapp-outbox`, `customapp-sync`, `customapp-offline`, `customapp-acceptance`, `customapp-reuse` | ~85 | < 6 s | Real `openDb(tmp)` + `createApi`; `fakeSmtp`; real rate limiter with limits ON |
| Socket race (real HTTP) | `customapp-race` (spawns `server.js`, parallel `fetch`) | 4 | ~3 s | None; real process |
| E2E (browser) | `journeys.mjs`: "Event night, four devices" | 1 journey, ~10 checks | ~40 s | None; real browser contexts |
| Load (manual + rehearsal) | `scripts/event-load.mjs` (`npm run event:load`) | 1 scenario | 2 to 5 min | None; prod-like copy, limits ON |

Roughly 55 % unit, 40 % integration, 5 % race and browser. The integration share is higher than
the textbook pyramid on purpose. In CORE, an in-process API test is as fast as a unit test (no
network, a tmp file), and it exercises permissions, module gating and audit, which a pure test cannot.

## Appendix C: Invariants (shared `checkInvariants`, draft for Prover)

1. For every active table: `confirmed + activeReservations + activeHolds <= capacity` (10 for YEP).
2. No two active seat claims share `(tableId, seatNo)` when a seat number is set.
3. A guest holds at most one active seat claim (by construction if the seat is embedded in the guest).
4. A substitute and its original never both hold an active seat claim.
5. Every guest and every table has 0 or 1 owner. The owner is an active event-staff member of that event.
6. Exactly one `superAdminUserId` per event, and it is an active user.
7. `checkedInAt` is set at most once per guest. Corrections are recorded as events, not overwrites.
8. A seat claim's table is eligible for the guest's classification (preferred / regular / employee
   / mixed rules).
9. A deactivated or removed table has no active claims.
10. A preferred reservation is released only by a release event with an actor (no expiry path exists).
11. `seq` is strictly increasing, and every state change has exactly one change-log entry.
12. Status axes are independent: RSVP, check-in, assignment and notification. Email failure never
    changes assignment.

## Appendix D: Test specifications (testing-strategy Step 4)

### Unit

```
File: test/customapp-engine.test.js            Layer: Unit (pure plan())
  assign: confirms into a table with 9 claims; refuses FULL at 10 counting reservations + holds
  assign: refuses SEAT_TAKEN for an occupied seat number; refuses NOT_ELIGIBLE (employee table, regular guest)
  assign: refuses STALE when expect.guestRev != current rev; refusal carries fresh options
  assign: refuses OUT_OF_SCOPE when actor owns the guest but not the table, and vice versa
  check-in: sets checkedInAt from injected now; second check-in refuses ALREADY_CHECKED_IN
  preferred check-in: returns the reserved seat; released reservation routes to reassignment queue
  transfer: old seat kept until new seat validated (FULL target leaves guest where they were)
  swap: two guests at two full tables succeed atomically; swap across scopes refuses for staff, succeeds for SA
  release: SA releases a preferred no-show; staff refuses unless delegated release is enabled for the event
  group assign: fits 4 into a table with 4 free; 5 into the same refuses with alternatives; split requires confirm flag
  substitute: links to original, moves original's claim, original ends with none
  reallocate: pending guests move to new owner; confirmed claims untouched; old owner refused next write
  table admin: renumber/reclassify ok; deactivate with claims refuses TABLE_HAS_ASSIGNMENTS
  every case: afterEach assert.deepEqual(checkInvariants(state), [])
Mocks: none. Edge: capacity 1 table, 0 tables, guest with no industry, unknown command type.

File: test/customapp-rank.test.js              Layer: Unit
  same industry ranks above related above other; full and ineligible tables never listed
  ties broken by remaining capacity then table number (deterministic order, so tests are stable)
  exclusion tag removes a table; group-fit ranks only tables with enough room for all members
  scope filter: staff see only delegated tables in "recommended"; read-only "others" list separate
  no industry match: returns other eligible tables, flagged reason "no industry match"

File: test/customapp-fuzz.test.js              Layer: Unit (property-based, seeded)
  for seeds 1..200: 300 random commands (mixed actors incl. wrong-scope and stale revs) on a
  30-table / 280-guest fixture; after each step checkInvariants() == []; refusals only use catalogue codes
  failure prints the seed and the command prefix so it replays exactly

File: test/customapp-invariants.test.js        Layer: Unit
  each rule in Appendix C detected on a hand-broken state (proves the checker is not vacuous)

File: test/customapp-import.test.js            Layer: Unit
  CSV and XLSX (server/pdf/xlsx reader) import: header aliases, trimmed / cased surnames, last-4 derived
  duplicate rows by stable id merge, not duplicate; missing mobile and email both allowed
  re-import is idempotent; a changed classification is reported, not silently applied to a seated guest
```

### Integration (in-process API, real `openDb` + `createApi`)

```
File: test/customapp-api.test.js
  module gating: off in Admin panel -> /api/customapp/* 403 for non-admins (MODULE_API regex)
  mutation(): registering an async handler throws at startup
  HttpError 409 carries {code, fresh}; existing callers' error shape unchanged
  idempotency: same nonce + same body -> same result, one change; same nonce + different body -> refused
  every mutation writes exactly one audit entry with actor, entity, before/after (audit.diff)

File: test/customapp-scope.test.js
  "Event staff" account type sees only CUSTOM APP; CORE admin ('*') is NOT event Super Administrator
  unless designated (Skeptic's finding: userCan('*') must not grant event authority)
  delegation exclusivity: delegating a guest/table already owned moves it (one owner), audit records both
  permission change takes effect on the very next request (no cached role)
  SA recovery path does not create a second active SA (spec section 13)

File: test/customapp-public.test.js            (process.env.TRUST_PROXY = '1', rate limits ON)
  registration inactive -> uniform "not open" response
  300 verify + 300 status polls from ONE x-forwarded-for within the event window: zero 429 on the event bucket
  wrong surname / wrong last-4 / two matches -> identical response body + referral code; no candidate list
  status token: opaque, compared constant-time, wrong token same 404 as unknown; token never reveals guest id
  public responses never contain mobile, email, company of other guests, or table member names
  per-token and per-IP brute-force caps on verify still apply (tuned, not removed)
  CSP: the guest page's inline script hash is in server/security.js pagePolicy

File: test/customapp-outbox.test.js            (fakeSmtp, failing variant)
  confirmed assignment queues one email; SMTP failure marks message failed, assignment untouched
  resend creates a new attempt, never a second assignment; no email address -> status "not applicable"
  email send happens after save (assert db file already contains the claim when fakeSmtp receives DATA)

File: test/customapp-sync.test.js
  GET /changes?since=seq returns only newer changes; long-poll resolves on commit; restart keeps seq
  a staff device's view after reallocation drops the old owner's queue in the next poll

File: test/customapp-offline.test.js
  printable plan + guest list export contain every active claim (CSV and print view)
  paper allocations replayed as commands with original timestamps; conflicts listed, none applied twice
  pre-partitioned offline ranges: replay from two desks never exceeds capacity

File: test/customapp-reuse.test.js
  a second event ("Test Gala": capacity 8, no employee tables, no seat numbers) passes engine,
  rank and invariants; events are isolated (staff of event A refused on event B); no 'YEP' in server/customapp

File: test/customapp-race.test.js              Layer: real socket
  spawn server.js (tmp DB_FILE, limits ON); 10 parallel fetch "assign last seat" from 10 staff
  -> exactly one 200, nine 409 FULL with fresh options; checkInvariants on GET /health == []
  2 parallel check-ins of the same guest (guest page + staff desk) -> one check-in
```

### E2E (Playwright, added to `scripts/journeys.mjs`)

```
Journey: Event night, four devices
  contexts: guest PHONE, staff A PHONE, staff B PHONE, Super Administrator DESK
  guest verifies on /event/<code> -> "checked in, choosing your table" (no reload afterwards)
  staff A sees the card appear in "My queue" without reload; opens it; ranked tables with reasons
  staff A and B both target the last seat of Table 5; both press Confirm
  -> one sees success, the other sees "Table 5 just filled. Updated options:" with guest still selected
  guest phone shows "Table N" without reload; SA dashboard counts updated
  SA reallocates staff B's pending guests to A; B's next write is refused with a clear message
  no console errors, no error toast, nothing wider than 390 px
```

### Load (manual, `npm run event:load`; not on every push)

```
scripts/event-load.mjs --target <url> --guests 300 --staff 15 --nat-ips 1 --poll 5s
  arrival curve from Tuner; reports p50/p95 per route, 429s by bucket, db.save() duration,
  event-loop lag; ends with GET /health invariants == [] and a reconciliation count
  pass/fail thresholds from Tuner; run on a restored prod copy at the dress rehearsal (6 to 7 Dec)
```

## Appendix E: Acceptance traceability (spec section 07, one named test each)

`test/customapp-acceptance.test.js`. Test names quote the spec rows, so `node --test` output is the
evidence pack for the client demo.

| Spec scenario | Test | Also covered by | Tier |
|---|---|---|---|
| Preferred guest / no-show | `preferred: assignment retrieved; seat blocked until manual release; late arrival referred` | engine, fuzz | 0 |
| Regular guest / no match | `regular: multiple industry-ranked tables; other eligible shown when no match` | rank | 1 |
| Employee / group arrivals | `employee group: eligible employee tables; group fit; alternatives when it cannot fit` | engine, rank | 2 |
| Manual alternative / all full | `manual alternative within authority; no allocation when no eligible seat` | engine | 0 |
| Unlisted / substitute | `unlisted approved + classified + audited; substitute without double allocation` | engine, scope | 2 |
| Duplicate / simultaneous check-in | `one registration and allocation per guest` | race, fuzz | 0 |
| Last available seat | `one concurrent assignment succeeds; the other gets FULL + fresh options` | race, journey | 0 |
| Unauthorized cross-scope | `rejected; SA can act or delegate; no duplicate ownership` | scope, fuzz | 1 |
| Ownership reallocation / absent | `new owner gets pending queue; old owner loses write; confirmed intact` | scope, journey | 1 |
| Transfer / swap / release | `counts update; no overbooking; no lost assignment` | engine, fuzz | 0 |
| Email failure / no email | `assignment valid; display works; retry available` | outbox | 2 |
| Connectivity / recovery | `offline replay reconciles without duplicates` | offline | 2 |

## Appendix F: Coverage targets (testing-strategy Step 5)

No coverage tool in CORE (zero dependencies). `node --test --experimental-test-coverage` exists in
Node 22 and needs no install. Use it locally as a report, not as a gate.

| Category | Target | Rationale |
|---|---|---|
| `engine.js`, `invariants.js`, `rank.js` | 95 %+ lines, every refusal branch | The event's correctness lives here; pure, so cheap to cover |
| `commit.js`, `routes.js`, `public.js` | 85 %+ | Permission, nonce, gating and public-surface contracts |
| `outbox.js`, sync | 75 %+ | Failure paths matter more than the happy path |
| Views (`public/js/views/customapp.js`, guest page) | Journey + phone sweep | No DOM unit tests in CORE; follow the existing pattern |
| Glue (MODULES entry, NAV rows) | Covered by existing module and guide tests | Not worth new tests |

## Appendix G: Quality gates

- **Per edit (developer loop):** `node --test test/customapp-*.test.js` in under 5 s, which includes
  fuzz at 50 seeds. `CUSTOMAPP_FUZZ_SEEDS=1000` runs locally before a release.
- **Per push (existing CI, unchanged workflow):** the full `npm test` (the event files add about
  10 s) plus `npm run journeys` (adds the one journey) must pass before the `deploy` job. Nothing new
  to configure.
- **Release (per tier, Strategist's dates):** the tier's acceptance rows are green; the version is
  bumped; the devlog entry, `docs/guides/events.md` and the `whats-new.md` line ship in the same
  commit; screenshots retaken with `npm run guides:screenshots -- <file>`.
- **Freeze candidate (6 Dec):** full fuzz at 1000 seeds, race test ×20 runs (flake check),
  `event:load` on a prod copy with limits ON, and a tagged commit. After the freeze, fixes only, each
  with a test that failed before it.
- **Event morning (read-only):** `GET /api/customapp/events/:id/health` returns
  `checkInvariants() == []` on production, and the SA dashboard shows a banner if it ever turns
  non-empty during the night.
- **Review checklist for every event PR:**
  - no `await` in `engine.js` or `commit.js`;
  - every write uses `mutation()`;
  - every refusal uses the catalogue;
  - new rules are added to `checkInvariants()`;
  - tests assert codes, not message text;
  - no YEP-specific string in `server/customapp`.

## Appendix H: n8n patterns from a quality lens

- **Waiting-form status page** (Architect and Scout verified: `waiting-forms.ts`, `timingSafeEqual`
  on the resume token). It gives a clean, testable contract: opaque token, uniform 401/404, a status
  suffix to poll. Copy the contract into `customapp-public.test.js` rows.
- **Typed push messages** (Architect verified: `abstract.push.ts`). A small discriminated set of
  message types (`{type:'changed', seq}`) keeps the browser handler a single `switch`. Share the
  type names from `shared/customapp/` so server and client cannot drift.
- **Concurrency control as a separate, testable service** *(unverified detail)*: n8n isolates its
  execution concurrency limit in its own service class with its own unit tests, rather than burying
  it in handlers. Do the same with the outbox throttle: `outbox.js` alone, `fakeSmtp` in tests.
- **Do not borrow:** queue mode and multi-main locking. They would invalidate the single-thread
  atomicity that the whole test strategy relies on.
