# Craftsman Final Position: CUSTOM APP / YEP 2026 Registration & Table Assignment

**Lens:** purple. Testability, patterns, regression protection, and the developer who changes this
code on 7 December with guests arriving in 48 hours.

**Inputs:** my Round 1 position; the Round 2 challenges (Operator x2, Strategist x2, Architect,
Advocate, Skeptic, Scout); the Round 3 finals of Architect, Advocate, Scout, Skeptic and Strategist.

**Re-checked in the repository for this round:**
- `server/api.js:418-431`: `replaceData()` keeps `devlog`, `feedback`, `guideEdits` with the
  pattern `next.x?.length ? next.x : db.data.x`. That pattern **prefers the backup's copy when it is
  non-empty**. Copied verbatim for event data, it would bring back stale check-ins from the backup.
  The event carve-out must be "always keep live", and that needs its own test (see N3).
- `server/util.js:15-20`: `HttpError(status, message)` still carries no structured payload.
- `scripts/journeys.mjs:43`: journeys still spawn CORE with `RATE_LIMITS: 'off'`.

**n8n:** not cloned in this workspace. n8n references below are the ones Architect and Scout cited
(`waiting-forms.ts` status polling, `timingSafeEqual` on the resume token, typed push messages) or
are marked *(unverified)*.

---

## Revised recommendation

The council converged on mechanics that make my test strategy **smaller and stronger**, not bigger:
one synchronous `commit()` per change, one status-agnostic `claimsAt(tableId)`, claim statuses
`{reserved, confirmed}` only, event data in `db.json` as `ca*` collections that a CORE restore never
touches, short polling with a server-supplied `pollMs`, and kill-switch flags checked inside
`commit()`.

My recommendation is now:

1. **Keep the engine shape:** a pure, synchronous `plan(state, cmd, actor, now)` inside `commit()`.
   It is what lets the hardest guarantees be tested in milliseconds with no database.
2. **Keep one shared `checkInvariants()`**, now built on `claimsAt()`, run after every unit test,
   after every fuzz step, at the end of the load script and by the 60-second production self-check
   (Strategist's item, the same function).
3. **Cut the suite to what each tier needs**, about 120 focused tests instead of ~200, with the 12
   spec acceptance scenarios as 12 named tests that are the client's evidence pack on 5 Dec.
4. **Add tests for the new council decisions,** each one small and each one closing a hole that the
   current suite would let through silently: the restore carve-out, the closed status enum, the
   kill switches, the undo-on-save-failure, the failed-attempt-never-writes rule, the single-IP
   guest load, the versioned export, and the `unhandledRejection` logger.

## Concessions made

| # | What I relaxed | Round 1 | Final | Why |
|---|---|---|---|---|
| C1 | **Holds** | Invariant 1 counted `confirmed + reservations + holds`; fuzz generated holds | No `held` state. Invariant 1 is `claimsAt(t) <= capacity`. Fuzz asserts zero holds and no expiry path | Scout and Strategist are right: a single-request commit has no checkout window, and holds add the only write no request triggers (an expiry sweeper). My worry was "a handler forgets to count a status". Strategist's structural fix (count claims, never statuses) removes the bug class better than more tests would. |
| C2 | **Long-poll sync test** | `customapp-sync`: "long-poll resolves on commit" | Short-poll contract test: `changes?since=seq` returns only newer changes, carries `pollMs`, and ignores `wait` for now | Short polling removes the 120 s timeout and monitor-exclusion work. The test pins the contract so a later long-poll is a server change only. |
| C3 | **Offline replay and pre-partitioned ranges** | `customapp-offline`: replay with original timestamps, two-desk ranges | Dropped ranges. Paper allocations are re-entered through the normal commands, each with an `opId`; the test asserts a repeated `opId` is idempotent and a conflicting one is refused | No device-side offline mode in 12 days (Scout C4). The event-only import is cut (Strategist), so there is no replay engine to test. |
| C4 | **Event-only import / restore tests** | Implied by Operator's import | None before 9 Dec. Instead, a **golden-file test for export JSON v1** so the v1.1 import is a reader of a frozen format | Strategist and Architect cut the import. Freezing the format now is the cheap part that keeps the later import safe. |
| C5 | **Race test volume** | Real-socket race x20 runs at freeze; 10 parallel staff | Race test stays (4 cases), run x5 at freeze | The pure engine plus the `mutation()` guard carry most of the atomicity proof. The socket test is a smoke alarm, not the evidence. |
| C6 | **Coverage numbers** | Per-file targets (95 / 85 / 75 %) | Report only, no gate, no per-file targets in the plan | No tool to add, no time to argue about percentages. Every refusal code having a test (checked by a catalogue test) is a better gate. |
| C7 | **Second fixture event scope** | Whole engine, rank and invariants suite re-run on "Test Gala" | One `customapp-reuse` file: the acceptance-critical engine cases parametrised over two fixtures, plus a grep that `server/customapp` contains no YEP string | Strategist's "reuse by parametrising, not abstracting". Proves no hard-coding without doubling the suite. |
| C8 | **The multi-device browser journey** | 4 contexts, ~10 checks, Tier 0 | Same journey, but it lands with Tier 1 (3 Dec); Tier 0 relies on node tests | The guest page and queues do not exist in Tier 0; a journey written early would be rewritten. |
| C9 | **Guest abuse rows follow the converged rules** | Hard per-token and per-IP caps | Soft cap: 8 distinct wrong last-4 values per (event, normalised surname) per 15 min; same wrong value counts once; staff clear in one tap; no per-event global lockout (alarm only); re-verify idempotent with a staff flag | Advocate and Skeptic agreed the numbers; my job is to pin them in tests so nobody "tightens" them on 7 Dec. |

## Non-negotiables

N1. **No `await` between check and save, enforced in code.** Every event write registers through
    `mutation()`, which refuses an `AsyncFunction` at startup, and `commit()` throws in tests if a
    handler or `plan()` returns a thenable. A sync wrapper around a promise is the realistic
    6 December regression; the AsyncFunction check alone does not catch it.

N2. **One `claimsAt(tableId)`, and a closed status set.** `SEAT_STATUSES` is frozen in
    `shared/customapp/`. A test fails if any status is not classified, and a source test fails if
    any file other than `engine.js` reads `seat.status` to count capacity.

N3. **A CORE restore never touches event data, and a test proves it.** Restore a backup taken at
    `seq` 50 while live is at `seq` 120: every event's `seq`, guests and claims are unchanged. Also
    covered: "Erase all data" and demo data. This is the case where copying the existing
    `devlog`/`guideEdits` pattern would be wrong.

N4. **`checkInvariants()` is one function used in four places:** after every engine test, after
    every fuzz step (seeded, replayable, 200 seeds in CI and 1000 at freeze), at the end of the load
    script, and by the 60-second production self-check. A checker test breaks each rule by hand, so
    the checker cannot be vacuous.

N5. **The 12 spec acceptance scenarios are 12 named `node --test` cases**, green by their tier's
    date (table below). Test names quote the spec rows; the output is the 5 Dec evidence pack.

N6. **Refusals are typed.** `HttpError(status, message, {code, fresh})` (backward compatible) and a
    frozen refusal catalogue shared with the browser. Tests assert `code`, never message text. A
    catalogue test fails if a code has no test that produces it.

N7. **The guest crowd is tested on one IP with limits ON.** An in-process test with
    `TRUST_PROXY=1`: 300 verifies plus status polling from one `x-forwarded-for` gives zero 429 on
    the event buckets, while the per-surname soft cap still trips. The browser journeys run with
    limits off, so without this test the #1 launch blocker is invisible to CI.

N8. **A failed public attempt never writes to disk.** Count `db.save()` calls around 50 failed
    verifies: zero. Every failure reply is byte-identical apart from the random referral code.

N9. **Event files run alone in under 5 s:** `node --test test/customapp-*.test.js`, with
    `npm run test:event` as the documented loop. If they are slow, they get skipped at the venue
    rehearsal.

N10. **After the 6 Dec freeze, every fix lands with a test that failed before it.** Same commit,
     same CI gate; the version bump, devlog entry and guide update ship with it.

## Implementation notes

### Files (unchanged shape, smaller contents)

```
shared/customapp/
  statuses.js     SEAT_STATUSES = Object.freeze(['reserved','confirmed']); FLAGS list
  refusals.js     frozen codes: STALE, FULL, SEAT_TAKEN, OUT_OF_SCOPE, NOT_ELIGIBLE,
                  ALREADY_CHECKED_IN, REGISTRATION_CLOSED, READ_ONLY, OP_REPLAY_MISMATCH,
                  NOT_SUPER_ADMIN, TABLE_HAS_CLAIMS
  invariants.js   checkInvariants(eventState) -> [] | [{rule, ids, detail}]
  rank.js         pure recommendation ranking
server/customapp/
  engine.js       plan(state, cmd, actor, now) and claimsAt(); pure, sync, no I/O, no Date.now()
  commit.js       commit(db, cmd, actor): flags -> role re-read -> opId -> plan -> apply -> seq++ ->
                  db.save() (undo in memory if it throws) -> return after-effects
  routes.js       mutation() + staff routes
  public.js       verify, status token, activation window, soft cap
  outbox.js       email queue, run after save, never inside commit
  export.js       event export JSON v1 (laptop pull, printed pack, 5-minute on-box copies)
```

Two shared-code changes, each with its own test file entry:
- `server/util.js`: optional third `HttpError` argument; `handle()` serialises `{error, code, fresh}`.
- `server/api.js` `replaceData()`: `ca*` collections always taken from `db.data`, never from `next`.

The guard, revised for N1:

```js
// server/customapp/routes.js
export function mutation(route, method, path, perm, handler) {
  if (handler.constructor.name === 'AsyncFunction')
    throw new Error(`${method} ${path}: event writes must be synchronous`);
  route(method, path, perm, (req) => {
    const out = handler(req);
    if (out && typeof out.then === 'function')
      throw new Error(`${method} ${path}: event write returned a promise`);
    return out;
  });
}
```

### Test files, by tier (about 120 tests, under 5 s together)

| File | Layer | Key cases | Tier |
|---|---|---|---|
| `customapp-engine` | Unit (pure) | assign / FULL counting reserved / SEAT_TAKEN / NOT_ELIGIBLE / STALE with fresh options; check-in once; preferred retrieves reservation; release by actor only; transfer keeps old seat until new one validates; swap atomic; group all-or-none; substitute moves the claim; afterEach `checkInvariants == []` | 0 |
| `customapp-invariants` | Unit | each rule broken by hand is detected; `SEAT_STATUSES` closed; no other file counts by status | 0 |
| `customapp-fuzz` | Unit (seeded) | random assign, check-in, release, transfer, swap, substitute, group over seeded reserved + confirmed guests, wrong scopes and stale revs; zero holds; refusals only from catalogue; prints seed on failure | 0 |
| `customapp-api` | Integration | module gating; `mutation()` refuses async and thenable; typed 409; `opId` replay idempotent, mismatch refused; one audit entry per write; **save throws -> state unchanged, no audit, 500** | 0 |
| `customapp-restore` | Integration | N3: restore of older backup, Erase all data, demo data all leave live `ca*` and `seq` untouched | 0 |
| `customapp-flags` | Integration | each flag (`registrationOpen`, `selfCheckIn`, `emailPaused`, `readOnly`, `pollMs`) checked inside `commit()` or the poll reply; `readOnly` refuses every mutation with READ_ONLY and still serves reads | 0 |
| `customapp-export` | Integration | export v1 matches a golden fixture (field set, `v:1`, `seq`); contains every active claim; no PII beyond the agreed fields; 5-minute writer uses the same function | 0 |
| `customapp-import` | Unit | guest-list CSV/XLSX import: header aliases, normalised surnames, last-4 derived, re-import idempotent; collision report lists every ambiguous (surname, last-4) pair and every guest with neither mobile nor email | 0 |
| `customapp-process` | Integration | `unhandledRejection` logger records and does not exit (spawned child) | 0 |
| `customapp-race` | Real socket | 10 parallel `fetch` on the last seat: one 200, nine 409 FULL; two parallel check-ins of one guest: one check-in; health invariants `[]` | 0 |
| `customapp-rank` | Unit | same > related > other industry; full and ineligible never listed; deterministic tie-break; group fit; scope filter | 1 |
| `customapp-scope` | Integration | Event staff sees only CUSTOM APP; CORE `admin` is not the event SA unless designated; one owner per guest and table; permission change effective on the next request; reallocation leaves confirmed claims intact | 1 |
| `customapp-public` | Integration, limits ON | N7 single-IP crowd; N8 zero saves on failure and byte-identical replies; activation window; soft cap at 8 distinct wrong values / 15 min, same value counts once, staff clear; no global lockout (alarm raised instead); token 32 bytes stored as SHA-256, compared constant-time, revocable; re-verify idempotent with flag; no other guest's data in any public reply; CSP hash present | 1 |
| `customapp-sync` | Integration | `changes?since=seq` returns only newer changes and `pollMs`; reallocated staffer's next poll drops the old queue | 1 |
| `customapp-outbox` | Integration (`fakeSmtp`) | email after save; SMTP failure leaves assignment intact; resend is a new attempt; `emailPaused` queues without sending; no address = not applicable | 2 |
| `customapp-reuse` | Integration | acceptance-critical engine cases over YEP and "Test Gala" (capacity 8, no employee tables, no seat numbers); events isolated; no YEP string in `server/customapp` | 2 |
| `customapp-acceptance` | Integration | the 12 named spec scenarios (table below) | per row |

Browser: one "Event night, four devices" journey in `scripts/journeys.mjs` (guest phone, two staff
phones, SA desk; the last-seat contest; the recovery screen asserted by visible text; reallocation
refusal; nothing wider than 390 px). Lands with Tier 1.

Load: `scripts/event-load.mjs` (`npm run event:load`), limits ON, one source IP, 300 guests, 15
staff, `pollMs` from the server. Reports p50/p95 per route, 429s by bucket, `db.save()` p95 and
event-loop lag, and ends with `checkInvariants == []`. Thresholds: zero guest 429s, save p95 under
the 50 ms gate Operator set. Runs 4 Dec (Tier 1) and 6 Dec (with the kill -9 drill) on staging.

### Acceptance traceability (spec section 07)

| Spec scenario | Named test | Also covered by | Green by |
|---|---|---|---|
| Preferred guest / no-show | reservation retrieved; blocked until manual release; late arrival referred | engine, fuzz | Tier 0 (1 Dec) |
| Manual alternative / all full | manual alternative within authority; no allocation when no eligible seat | engine | Tier 0 |
| Duplicate / simultaneous check-in | one registration and allocation per guest | race, fuzz | Tier 0 |
| Last available seat | one concurrent assignment succeeds; the other gets FULL + fresh options | race, journey | Tier 0 |
| Transfer / swap / release | counts update; no overbooking; no lost assignment | engine, fuzz | Tier 0 |
| Regular guest / no match | industry-ranked tables; other eligible shown when no match | rank | Tier 1 (3 Dec) |
| Unauthorized cross-scope | rejected; SA can act or delegate; no duplicate ownership | scope, fuzz | Tier 1 |
| Ownership reallocation / absent | new owner gets pending queue; old owner loses write; confirmed intact | scope, journey | Tier 1 |
| Employee / group arrivals | eligible employee tables; group fit; alternatives when it cannot fit | engine, rank | Tier 2 (5 Dec) |
| Unlisted / substitute | unlisted approved, classified, audited; substitute without double allocation | engine, scope | Tier 2 |
| Email failure / no email | assignment valid; display works; retry available | outbox | Tier 2 (or "display + verbal" if email is dropped on 3 Dec: test asserts email surfaces are hidden) |
| Connectivity / recovery | printed pack covers every claim; paper re-entry via `opId` has no duplicates | export, api | Tier 2 |

### Quality gates

- **Per edit:** `npm run test:event` under 5 s (fuzz at 50 seeds).
- **Per push (existing workflow, unchanged):** full `npm test` plus `npm run journeys` gate `deploy`.
  Event files add about 10 s. The freeze guard Operator adds to `remote-deploy.sh` sits after this
  gate, so CI still proves every push even during the freeze.
- **Per tier:** that tier's acceptance rows green; version bump, devlog entry, `docs/guides`
  page for the Event staff and Super Administrator roles, `whats-new` line and retaken screenshots in
  the same commit (`test/guides.test.js` fails otherwise; add `customapp` to its `MODULES` list
  and update `modules-roadmap` / `favorite-modules` tests).
- **Freeze candidate (6 Dec):** fuzz at 1000 seeds, race x5, load test 2 green, tagged commit.
- **Event night:** the 60-second self-check runs `checkInvariants()` and puts a banner on Event
  control if it ever returns a violation.
- **Review checklist for every event PR:** no `await` in `engine.js`/`commit.js`; every write via
  `mutation()`; no capacity count outside `claimsAt()`; refusals from the catalogue; new rules in
  `checkInvariants()`; tests assert codes, not text; no YEP string in `server/customapp`.

### Effort

About 3 dev-days of test work in total, spread across tiers, not a separate phase: about 1.5 in
Tier 0 (engine, invariants, fuzz with reservations, which includes the +0.5 day Strategist
priced, api, restore, flags, export, race), about 1 in Tier 1 (public, scope, rank, sync, journey)
and about 0.5 in Tier 2 plus the load script. Tests are written with each command, in the same
commit, never "after the feature".

### n8n patterns, through this lens

- **Waiting-form status contract** (cited by Architect and Scout: `waiting-forms.ts`,
  `timingSafeEqual`, status polling). Copy the contract into `customapp-public` rows: opaque token,
  uniform reply, a status endpoint polled at a server-chosen pace.
- **Typed push messages** (Architect: `abstract.push.ts`). Even with polling, the change records
  returned by `changes?since` use a small closed set of `type` values shared from
  `shared/customapp/`, so a later SSE transport reuses them.
- **Concurrency control as its own service** *(unverified detail)*: applied only to the email
  outbox throttle, tested alone with `fakeSmtp`.
- **Not borrowed:** queue mode, workers, multi-main locking. They would break the single-thread
  atomicity the whole test strategy rests on.
