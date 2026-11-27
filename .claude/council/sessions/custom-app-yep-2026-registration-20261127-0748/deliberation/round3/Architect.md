# Architect Final Position — CUSTOM APP module and the YEP 2026 Registration & Table Assignment engine

**Revised recommendation:** Build CUSTOM APP (`customapp`) as a thin module shell whose first app is a generic event engine. Event data lives in CORE's existing `db.json` as `ca*` collections, and that is the one authoritative copy. Every state change goes through one synchronous `commit()`: it re-reads the actor's event role, checks revisions, checks invariants through one status-agnostic `claimsAt(tableId)`, applies the change, saves, and undoes the change in memory if the save fails. Three cheap rules give the event its own recovery unit without splitting the file:
1. `replaceData()` keeps the current `ca*` collections, so a CORE restore never touches an event.
2. A versioned, event-scoped export is the single format for the laptop pull, the printed pack and any later import.
3. Failed public attempts never write to disk.

Live sync is a short poll of `changes?since=<seq>` with a server-supplied `pollMs`. The contract has a `wait` parameter, so a long-poll can be switched on later without a client change.

I move storage back into `db.json`, because Operator and Strategist both showed that a split is more risk than a fix 12 days out. I keep everything that makes the system correct.

---

## 1. Where Round 2 left us, and how I resolve it

In Round 2, Operator and I each crossed over. I conceded a per-event store (`data/customapp/<eventId>/`). Operator conceded the shared `db.json`, with conditions. Strategist then cut the event-only import, the on-box snapshots and the long-poll. This is my resolution:

| Question | Round 1 | Round 2 (me) | **Final** | Why |
|---|---|---|---|---|
| Where event data lives | `db.json` | Per-event `state.json` + `log.jsonl` | **`db.json` (`ca*` collections)** | A split changes the offsite allowlist (`server/offsite.js:265`), the cron, the restore check and RESTORE.md, none of it drilled, in 12 days. Operator is right that an undrilled recovery path is the worse risk at 3 AM. |
| The danger that drove my Round 2 flip: Admin "Restore a backup" erases check-ins | not seen | Solved by moving out | **Solved in place by a carve-out in `replaceData()`** | `server/api.js:419-431` already keeps `devlog`, `feedback`, `guideEdits` and the helpdesk mail setup across a restore. Event data joins that list. It is one line, it follows the existing precedent, and a test covers it. |
| `save()` cost grows with CORE | Measure | Split | **Measure on 28 Nov, then use levers in order** | Operator's ladder: compact JSON, then coalesce outbox status writes, then resize. Split only if p95 is still above about 150 ms, decided by 30 Nov. |
| Event restore endpoint | none | `POST .../restore` | **Cut before 9 Dec** | Recovery means corrections through normal commands, or the standby (a whole-file restore on a separate box rolls back nobody's work). The export format is fixed now, so a v1.1 import is a reader, not a redesign. |
| Live sync | 25 s long-poll | long-poll | **Short poll, `pollMs` from the server, `wait` param reserved** | Avoids the `requestTimeout` and monitor-exclusion work. My Round 1 fallback was already "the same URL with `wait=0`", so this is the same contract at one speed. |
| Holds | Out | Out | **Out. `reserved` In, counted by `claimsAt()`** | I agree with Strategist and Scout (see section 3). |

## 2. Concessions made

1. **Storage location (second reversal, made deliberately).** I withdraw the per-event `state.json` / `log.jsonl` store. My Round 2 reasons were:
   - (a) a CORE restore erases check-ins;
   - (b) save cost tracks CORE's size;
   - (c) PII ends up in whole-CORE backups;
   - (d) an event-scoped purge.

   Each has a cheaper answer inside `db.json`:
   - (a) the `replaceData()` carve-out;
   - (b) measure, then compact JSON, coalescing and a resize;
   - (c) and (d) a post-event purge command removes `ca*` records for the event. Backups age out on the existing 30-day and offsite lifecycle. Guardian sets the retention date, and the dated nightly copies are documented as the residual.

   The bounded context is kept in the code (only `server/customapp/` touches `ca*`), not in the file layout.
2. **Long-poll becomes short poll.** The server returns `pollMs`: 2000 for staff boards and 4000 for guest status pages, with a ceiling raised under load. An unchanged answer is `{seq, unchanged:true}`, a few bytes, computed without building the board. Long-poll stays a Could, behind the `wait` parameter.
3. **The event restore endpoint and on-box snapshots move to v1.1.** I keep Operator's O6 (export JSON to `data/backups/events/` every 5 minutes) as an option. It is XS once the export exists, and Operator and Strategist should settle it. My non-negotiable is the format, not the timer.
4. **Holds stay Won't.** The naming follows Strategist: `seat.status ∈ {reserved, confirmed}`, counted by `claimsAt()`. That replaces my Round 1 `seat.state` and Scout's `claimsOn`.
5. **Public verification follows the merged Skeptic and Advocate spec**, not my Round 1 single `{ok:false, see:'desk'}`. The data model changes this causes are in section 5.

## 3. Non-negotiables

1. **One writer, one synchronous `commit()`.** There is no `await` between validation and `db.save()`, and a test enforces that `commit.js` contains no `await`. The process stays single: no queue mode, no cluster, no worker threads that write. n8n's Bull/Redis queue mode is rejected for this reason.
2. **One authoritative copy.** There is no dual-write, no mirror file and no browser-side capacity check. Snapshots and exports are derived copies, with a `seq` and a `sha256`.
3. **Capacity is counted, never stored.** `claimsAt(tableId)` counts every guest whose `seat.tableId === tableId`, **whatever the status**. Every handler that places or moves a seat calls the shared `checkInvariants(post-state)`, which calls `claimsAt`. A closed-enum test fails if `SEAT_STATUSES` gains a value without a decision on how it counts.
4. **The seat lives inside the guest record**, and the owner, the Super Administrator and the seat are single fields. This makes double seats, double delegation and two Super Administrators impossible to represent.
5. **A CORE restore never changes event state.** `replaceData()` keeps `caEvents`, `caTables`, `caGuests`, `caChanges` and `caOutbox` from the live data, and a test asserts that every event's `seq` is unchanged after `/api/admin/import`. While any event is `live`, the Admin restore screen says "Event data is not part of a CORE restore".
6. **Signed-out traffic cannot cause a disk write, except a successful verification.** Failed attempts, caps and referral codes live in bounded in-memory maps (section 5). Without this rule, an attacker on the QR page drives a whole-CORE `JSON.stringify` per request.
7. **Event endpoints never fall into the generic per-IP buckets** (`api-anon` 120/min and `public-write` 20/h at `server/api.js:558-562, 1445-1447`). The event limiter is keyed per event and per normalised surname. Otherwise the venue NAT stops check-in after about the 20th guest.
8. **Exactly one Super Administrator per event**, changed only through `setSuperAdmin`. That needs `customapp.manage`, password re-entry and an audit record.

## 4. Implementation notes

### 4.1 Module layout (unchanged from Round 1 apart from feed.js)
```
server/customapp/index.js            registerCustomAppRoutes(route, db, {audit, notify, mail})
server/customapp/events/model.js     accessors, normalisers (surname canon, last-4), lookup keys
server/customapp/events/commit.js    the unit of work (no await)
server/customapp/events/commands.js  plan() per command, pure
server/customapp/events/changes.js   seq, since-queries, scoped board builder (replaces feed.js waiters)
server/customapp/events/public.js    verify, status, referral map, caps (the only signed-out code)
server/customapp/events/outbox.js    capacity-1 FIFO drain (n8n ConcurrencyQueue shape), retries, emailPaused
server/customapp/events/io.js        import preview/apply with collision report, export (CSV, JSON v1, plan PDF)
shared/customapp.js                  APPS registry, enums (SEAT_STATUSES, ARRIVAL, APPROVAL), validators
shared/seating.js                    eligible(), claimsAt(), recommend(): pure, browser and server
public/event.html + public/js/event.js    guest page; server.js page list + security.js pagePolicy hash
```

### 4.2 `commit()` (final shape)
```js
export function commit(ctx, eventId, user, cmd) {            // synchronous; a test greps for 'await'
  const ev = mustEvent(ctx.db, eventId);
  if (ev.flags.readOnly) throw conflict('read_only');          // see note on flags
  const role = roleOf(ev, user);                               // re-read every call: permission changes apply at once
  const prior = ctx.idem.get(cmd.requestId);                   // Map rebuilt from caChanges at boot
  if (prior) return prior.result;
  const plan = COMMANDS[cmd.type].plan(ctx.db, ev, role, cmd);  // pure; throws Conflict(code, fresh)
  expectRevs(plan, cmd.expect);                                // 409 stale
  checkInvariants(ctx.db, ev, plan);                           // I1-I10 on post-state, via claimsAt()
  const undo = apply(ctx.db, ev, plan);                        // rev++, ev.seq++, push compact caChanges entry
  try { ctx.db.save(); } catch { undo(); throw new HttpError(503, 'Not saved. Try again.'); }
  afterCommit(ctx, ev, plan);                                  // audit.record, outbox.enqueue (sync); no awaits
  return plan.result;                                          // {seq, revs, ...}
}
```
- **Flags** (Operator O5) are fields on `ev.flags`: `registrationOpen` (public verify), `emailPaused` (outbox drain) and `pollMs` (poll response). I would keep `readOnly` as well. It costs one line above, and it is the switch the Super Administrator uses during a reconcile. Strategist kept it; Operator cut it. It is cheap enough that I side with keeping it.
- **Invariant check on demand:** `GET .../invariants` runs the same `checkInvariants` over the whole event. Craftsman's fuzz oracle, the load-test post-check and the 60-second self-check (if Strategist keeps it) all call this one function.

### 4.3 Data model deltas from Round 1 Appendix B
| Change | Field | Reason |
|---|---|---|
| Rename | `guest.seat = {tableId, seatNo\|null, status:'reserved'\|'confirmed', at, by}` | Converged naming. `null` means no claim. A release writes history, not a third status |
| Replace | `guest.statusTokens: [{hash, issuedAt}]` (at most 5; the oldest is dropped) | One token per device (Skeptic). Staff revoke a token by removing its entry |
| Add | `guest.flags: [{kind:'reverified_other_device', at}]` | Advocate and Skeptic: detection without scolding. Shown in the owner's queue and the Super Administrator's alerts |
| Add | `guest.lookup.altSurnames[]` | Stored aliases (for example "dela Cruz" / "Cruz"), matched exactly after canonicalisation |
| Add | `event.window = {opensAt, closesAt}` | Server-enforced activation window. Before it opens, an event-level "opens at" page accepts no input |
| Add | `event.qrKeyHash` (optional, P0/P1 for Strategist) | Advocate's zero-typing presence key in the QR URL. One field and one constant-time compare. The Super Administrator rotates it. A missing or old key gets the uniform desk reply |
| Compact | `caChanges` entry = `{seq, at, actorId, via, type, requestId, guestIds, tableIds, diff}` | Field-level diffs, not full before/after images. Estimate: about 3,000 entries × about 200 B ≈ 0.6 MB at the end of the event. This keeps `db.json` growth small |
| Unchanged | tables, owners, Super Administrator, approval, substitution, outbox, invariants I1-I10 | |

### 4.4 Public verification (merged spec, as architecture)
- `POST /api/public/event/:code/verify {surname, last4, k?}`:
  1. Check the event is `live`, the window is open and `k` matches (when enabled). Then canonicalise: NFKD, strip diacritics, lowercase, drop spaces, hyphens, periods and apostrophes, strip suffixes.
  2. Look the guest up in `guestsByLookupSurname` (a lazy map, rebuilt when `seq` changes).
  3. With exactly one match, the result is `commit(selfCheckIn)` (idempotent). It mints a token and adds the flag if the device is new. The reply is `{token}`.
- **Any failure** gives one byte-identical reply with the same status code, plus `R-xxx` drawn from one random pool. The server pads both paths to a fixed minimum response time.
- **The referral map** is held in memory: `Map<code, {eventId, surnameCanon, reason, at}>`, with a 3-hour TTL and at most 5,000 entries. The typed last 4 digits are never stored. Staff open `GET /api/customapp/events/:id/referral/:code` (signed in) to see the reason and a pre-filled search. A restart loses the codes, and staff then search by name. That is acceptable.
- **The surname cap** is also held in memory: `Map<eventId:surnameCanon, Set<distinct wrong last-4 hashes>>`. Advocate counts distinct values, so a typo repeated counts once. On the threshold, I defer to Skeptic and Advocate. Skeptic proposes 8 per 15 minutes and Advocate 5 distinct per 10 minutes, and both sit inside the same structure. It clears on timeout, or when a staff member taps "Clear and check in". A global failure rate only raises an alarm to the Super Administrator (a notification); it never blocks.
- **Event limiter:** `createRateLimiter` buckets keyed `event:code` (a global ceiling, for example 600/min) and `event:code:surname`. `/api/public/event/` is exempt from `api-anon` and `public-write`. Status polls are keyed by token hash.
- `GET /api/public/event/:code/status?t=<token>&since=<seq>` returns `{seq, pollMs, state, firstName, table, seat}`, or `{seq, unchanged:true, pollMs}`. The token goes in a query parameter, never in the path, so it stays out of the page URL history. Caddy and app logs must strip it. Operator, please check the access log format. The headers are `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

### 4.5 Live sync (short poll)
- `GET /api/customapp/events/:id/changes?since=<seq>&tab=<id>` returns `{seq, pollMs, unchanged:true}` when `seq` is unchanged. That is one integer comparison, without building the board. If `seq` has moved, it returns `{seq, pollMs, board}`, scoped per the Round 1 access policy, with gzip from Caddy.
- **Budget:** 30 staff at 2 s, plus about 60 pending guest pages at 4 s, is about 30 requests per second at peak. Unchanged replies cost microseconds. A changed board costs one scoped build per device per commit. Tuner checks this in load test 1 (4 Dec).
- When the server's `seq` is behind `since` (the standby case), the client gets a full board.
- Optimistic UI is not allowed. The client re-renders from the 409 `fresh` payload, or from the next poll.

### 4.6 Email (decision moves to 3 Dec)
- `caOutbox` stays in `db.json`, and the drain runs outside `commit()`. Status writes go through a 2-second debounced `db.save()` (Operator's coalescing lever). The trade-off is that a crash can lose a status. Messages left in `sending` are re-queued after 2 minutes, which risks a rare duplicate email rather than a lost one.
- Every async path in `outbox.js` is wrapped in `try/catch`, and it reports to the monitor. This sits alongside Operator's O3 process-level `unhandledRejection` logger, which lands on 28 Nov before any of this code.
- The transport comes from `smtpOptions()` / `canEmail()`, extracted from `server/helpdesk.js:245-261` into a shared `mailTransport(db)`. If the 3 Dec go/no-go says "display + verbal", the outbox ships with `emailPaused=true` and the model is unchanged.

### 4.7 Export format (the one artifact for recovery)
`GET /api/customapp/events/:id/export.json` returns `{format:'customapp.event/1', exportedAt, eventId, seq, sha256, event, tables, guests (without token hashes), changes, outbox}`.

The same bytes feed:
- the laptop pull every 5 minutes (Strategist and Operator);
- the printed pack (CSV and PDF are derived from it);
- the standby top-up reference;
- the post-event archive handed to the client before the purge.

A v1.1 `import` reads this format and nothing else. Paper reconciliation stays as commands, sent with `via:'reconcile'` and `occurredAt` through `commit()`, so a paper overbooking is refused and listed rather than applied.

### 4.8 Migration and CORE touch points (all small)
1. `server/db.js`: add `ca*` defaults to `emptyData()` / `openDb`. Switch to compact JSON (`JSON.stringify(data)`) **only if** the 28 Nov p95 is above 50 ms. Readers are unaffected, and the restore check parses either form.
2. `server/api.js` `replaceData()`: keep the live `ca*` collections (one block next to `guideEdits`). Also exclude `ca*` guest PII from `GET /api/admin/export`, unless an "include events" option is ticked. Guardian decides the default; my proposal is to exclude while an event is live, because the full-backup download is otherwise a second copy of the guest list on someone's laptop.
3. `server/api.js` limiter exemption for `/api/public/event/`. `server.js` and `server/security.js` get the `event.html` page and its CSP hash.
4. `shared/modules.js`: `customapp` entry, and `MODULE_API` `^/api/(customapp|public/event)(/|$)`. `shared/roles.js`: `eventstaff` (`customapp.use`), plus `customapp.manage`.
5. Guides: a new `docs/guides` page for Event staff and for the Super Administrator, plus `whats-new` and the screenshots, as the repository rules require.

### 4.9 Tests I depend on (owned by Craftsman)
- A grep guard: `commit.js` contains no `await`.
- Race tests: `Promise.all` of N `handle()` calls for the last seat. Exactly one succeeds, and the others get `409 full` or `seat_taken` with `fresh`.
- A fuzz suite over assign, check-in, release, transfer, swap, substitute, reclassify, table deactivate and delegate, seeded with reserved and confirmed guests. After every step, `checkInvariants` passes, holds are 0, and no reservation is released without an actor.
- A closed-enum test on `SEAT_STATUSES`.
- **Restore isolation:** after `/api/admin/import`, every event's `seq` and `caGuests` are unchanged.
- **Public no-write:** 1,000 failed verifies cause 0 calls to `db.save()` (spy), and byte-identical bodies.
- **Save-failure undo:** when `save()` is stubbed to throw, the state equals the pre-state and the reply is 503.
- A journey test: two browser contexts race for the last seat. Then guest verify, the referral code, and "clear and check in" at the desk.

### 4.10 n8n patterns, final disposition
| Pattern | Final |
|---|---|
| Form Trigger `responseMode: onReceived` | **Borrow.** Verify answers at once with a token, and the status page polls |
| Form auth token bound to node, webhook and execution | **Borrow the binding.** Random, hashed, per-device token bound to (event, guest). No JWT and no signing key |
| ConcurrencyQueue (capacity counter + FIFO) | **Borrow for the email outbox only.** Seats fail fast with a 409 and never queue |
| Capacity reservation `reserve()` / `release()` | The model if holds are ever added (an explicit release, never two per guest). Not built now |
| Push abstraction, SSE handshake | **Defer.** If it is added later, copy the `connectionKey`-replaces-older and heartbeat semantics. Push carries only `{seq}`, and data comes from the authorised GET |
| Queue mode, multi-main | **Reject.** It breaks single-writer atomicity |

### 4.11 What I need from others to close
- **Operator:** the 28 Nov `db.json` size and `save()` p95. Whether logs strip the `t=` query parameter. Whether to keep the on-box export timer (O6).
- **Strategist:** P0 or P1 for `qrKeyHash`. Whether `readOnly` stays (I recommend yes, at XS).
- **Skeptic and Advocate:** one threshold for the surname cap (the structure supports either).
- **Guardian:** the post-event purge date, and the admin-export default for event PII.
