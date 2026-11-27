# Architect Position — CUSTOM APP module and the YEP 2026 Registration & Table Assignment engine

**Core recommendation:** Build CUSTOM APP as a thin CORE module shell (`customapp`) whose first app is a generic event engine. Store the event in CORE's existing `db.json` as four collections: events, tables, guests (the seat embedded in the guest), and an append-only change log. Route every state change through one synchronous unit-of-work, `commit()`. It re-reads the actor's event role, checks guest revisions, checks the capacity and scope invariants, applies the change, saves, and only then wakes waiting devices and queues email. Run live sync as a long-poll on a per-event sequence number inside the existing `api.handle` pipeline, not as a new SSE or WebSocket server. Keep the process single: Node's single thread is the concurrency guarantee, so anything that splits work across processes (n8n queue mode, a cluster) is ruled out.

**Key argument:**
The spec's hardest requirements are concurrency requirements: the last seat, simultaneous check-in, atomic transfers and swaps, stale and unauthorized writes refused at the server, and permission changes taking effect at once. CORE handles them better than it first appears. `api.handle` (server/api.js:1432) resolves `user` from `db.data.users` on every request. A route handler that does no `await` between validation and `db.save()` (server/db.js:123, a synchronous write of a temp file followed by a rename) runs as one uninterruptible turn of the event loop. That is serializable isolation for free, as long as we never give it up.

The design therefore turns the invariants into structure wherever possible, and checks the rest in one place:

- **The seat lives inside the guest record** (`guest.seat = {tableId, seatNo, state}`). One guest can hold at most one seat by construction, and a transfer is a single field change, so a valid seat is never released before its replacement is secured.
- **The owner is a single field** on each guest and each table (`ownerUserId`), so double delegation cannot be represented.
- **The Super Administrator is a single field** on the event (`superAdminUserId`), so "exactly one" holds by construction.
- **Capacity, seat-number uniqueness, eligibility and scope** are checked by `commit()` against current in-memory state, immediately before the write.

Every command carries the guest revision it was based on (`expect.guestRevs`). Every refusal is a typed 409 (`stale`, `full`, `seat_taken`, `out_of_scope`) that includes fresh options, so the losing device refreshes as the spec requires. Queues are derived views of the data (owned, checked in, not yet seated), never stored lists. Reallocating staff is therefore just a change of owner: the new owner's queue fills immediately, and confirmed seats are untouched.

The same `seq` that orders the change log drives live sync. One mechanism gives four results:

- devices refresh in under a second,
- a restart costs nothing (the sequence number is saved with the data),
- offline paper allocations can be replayed as commands through the same `commit()`, and
- the event can be audited and reconstructed afterwards.

From n8n (sparse-cloned and read in this session), I borrow four patterns:

- **Push as a typed nudge** (`packages/cli/src/push/abstract.push.ts`): one connection per user and tab replaces the older one, with a heartbeat.
- **Respond on receipt, then a waiting page** (Form Trigger `responseMode: onReceived`): the guest's check-in answers immediately and a status page waits for the seat.
- **A token bound to one guest and one event** (`verifyFormUserAuthToken` binds node, webhook and execution): our guest status token is bound to the guest and the event.
- **A capacity counter with a FIFO queue** (`concurrency/concurrency-queue.ts`), used for outgoing email only.

I reject n8n's queue mode (Bull/Redis workers) because it would destroy the single-thread atomicity this design depends on.

**Risks if ignored:**
- **Structural, data level.** If capacity is checked in the browser, or there is an `await` (email, file I/O) between the capacity check and `db.save()`, or capacity is stored as a counter beside the seats, the "last seat" and "no double allocation" guarantees are silently lost. Those are the two acceptance scenarios the client will test first. The same applies if tables and guests are modelled as two independently written lists (a `seats[]` on each table and a `tableId` on each guest): they can drift and double-count.
- **Integration level: an existing limit will block the event.** In server/api.js:1445-1447, every non-GET `/api/public/*` call counts against `public-write` (20 per hour per IP), and every signed-out call counts against `api-anon` (120 per minute per IP). At the venue, most guests share one Wi-Fi IP, or a carrier-grade NAT on mobile data. Self check-in would start failing after about the 20th guest, and guests' waiting pages would be throttled. The event endpoints must be taken out of those generic buckets and given their own limits, keyed by event and identity, before the load test.
- **Performance and blast radius.** `db.save()` does `JSON.stringify(data, null, 2)` of the whole of CORE (HR, CRM, projects, document metadata) on every change, on the shared production instance. Event data is small (about 300 guests, under about 2 MB with history). At about one save per second at peak, the cost depends on production's current `db.json` size, which nobody has measured. It must be measured now. If a save takes more than about 50 ms, coalesce the email-status writes; only above about 20 MB consider a separate event data file, which would mean extending the backup cron, the offsite manifest (server/offsite.js:265 allows only three file names) and RESTORE.md. Bulk import and export must also never block the loop during arrivals.

**Dependencies on other domains:**
- **Skeptic / Guardian:** exact rate-limit numbers and the lockout after repeated failed attempts per surname. The identifier rule: what "last 4 of the email" means, and normalising compound Filipino surnames ("dela Cruz"). Status token lifetime. PII shown to staff outside their own scope (I propose counts and industries only). Purging guest data after the event.
- **Advocate:** the guest page states (verify, pending, seated, see the desk); the staff queue and board layout; the group-split confirmation; and whether a failed verification leaves an "assist" record (I propose not: the guest goes to the desk).
- **Operator / Tuner:** production `db.json` size and `save()` timing now; the deploy freeze; a pre-event backup and restore drill; whether the security monitor treats 25-second long-polls as slow or anomalous requests; a load script with 300 guests behind one IP and 20 to 30 staff long-polls.
- **Craftsman:** in-process race tests (`Promise.all` of `handle` calls); a guard test that `commit.js` contains no `await`; a Playwright journey with two browser contexts racing for the last seat.
- **Strategist:** confirm that holds, SSE, the floor plan, SMS and advanced exclusions stay out of the core build (each can be added later without changing the data model).
- **Integration owner (helpdesk):** `smtpOptions()` and `canEmail()` are private to the helpdesk closure (server/helpdesk.js:245-249). Expose them as a shared outgoing-mail transport so CUSTOM APP can send without a second SMTP configuration.
- **Client (ICD):** the industry list and related-industry map; the venue's table inventory (and therefore the table count); and whether the Super Administrator alone releases preferred no-show seats, or whether release can be delegated within scope (spec section 22).

---

## 1. What I verified in code (grounding)

| Fact | Where | Design consequence |
|---|---|---|
| User and session are resolved on every request; there is no per-session permission cache | server/api.js:1439-1440 | Event-role changes take effect on the next request; `commit()` re-reads `event.staff` every time |
| `handle` awaits the handler (`await withActor(...)`) | server/api.js:1450 | Async handlers are allowed (long-poll), but mutating handlers must be synchronous inside |
| `db.save()` is synchronous: stringify the whole object, write `.tmp`, `renameSync` | server/db.js:123-128 | Saving inside `commit()` keeps validate, apply and persist in one turn of the event loop |
| No optimistic-concurrency (rev) pattern anywhere; the 409s are only for upload offsets | server/forms.js:159, server/documents.js:361 | `rev` per guest and table, and `seq` per event, are new and owned by this module |
| server.js owns `res` and `api` returns `{data, headers}`; there is no streaming hook | server.js:207-252 | SSE would need new code in server.js; a long-poll fits the existing pipeline unchanged |
| Generic public limits: `public-write` 20/h, `api-anon` 120/min, both per IP | server/api.js:558-562, 1445-1447 | They must exempt `/api/public/event/` and add event-specific buckets |
| Public page routing and CSP use an allow-list of pages | server.js:199-201, server/security.js:91-93 | Add `/event/<code>` → `event.html` to both lists |
| Tracking-token precedent: random token, looked up by equality | server/helpdesk.js:454-528 | The guest status token follows it, stored as a SHA-256 hash rather than in plain text |
| SMTP transport is private to the helpdesk | server/helpdesk.js:245-261 | Extract `mailTransport()`; event email needs its own outbox and delivery status |
| Backups copy only `db.json`, the audit log, attachments and documents | deploy/aws/ltdc-erp-backup.cron, server/offsite.js:176,265 | Keeping event data in `db.json` gives hourly offsite copies and the restore drill for free |
| Caddy has `encode gzip`, a single upstream, and forwards X-Forwarded-For | deploy/aws/Caddyfile | One process; a scoped board of about 100 KB compresses well; IP-based limits see the real (NATed) address |

## 2. n8n patterns: borrow or reject (read from a sparse clone of n8n-io/n8n `master`, 27 Nov 2026)

| n8n pattern (file) | What it does | Decision for CORE |
|---|---|---|
| Push abstraction (`packages/cli/src/push/abstract.push.ts`) | Connections keyed by `userId:pushRef`; a newer connection closes the older one; ping every 60 s; typed `{type, data}`; `sendToUsers` | **Borrow the semantics**: waiters keyed by (user, tab); a new wait resolves the old one; typed messages. Push carries only `{seq}` (an invalidation), and data comes from an authorized GET, so scope filtering exists in one place and no PII travels over push. |
| SSE backend (`push/sse.push.ts`) | `text/event-stream`, `:ok` prelude, `X-Accel-Buffering: no`, removes the client on close | **Defer.** It needs a server.js hook outside `api.handle`, bypassing the monitor, limits and audit. Long-poll gives sub-second updates within the existing pipeline. If it is added after the event, copy this exact handshake. |
| Push origin validation (`push/origin-validator.ts`) | An SSE GET without an `Origin` header passes only for a same-origin fetch | CORE already enforces the host allow-list and cross-site checks (server.js:223-237); nothing to add for long-poll. |
| Form Trigger response modes (`nodes/Form/common.descriptions.ts:605`, `onReceived`, `lastNode`, `responseNode`) | Answer at once, or hold until the workflow ends | **Borrow `onReceived`**: verification answers immediately (checked in, pending) with a status token; a separate waiting page long-polls. Never hold the check-in POST open until a member of staff seats the guest. |
| Form auth token (`nodes/Form/utils/utils.ts:790-860`) | HS256 JWT bound to node, webhook and execution | **Borrow the binding, not the JWT**: a random 32-byte status token stored hashed on the guest is bound to (event, guest), can be revoked by re-issuing, and needs no signing key. |
| Sandboxed form CSP (`utils.ts:679`, `getHtmlSandboxCSP`) | Strict CSP on public form pages | Already matched by CORE's hash-based `pagePolicy`; `event.html` gets the same treatment. |
| ConcurrencyQueue (`concurrency/concurrency-queue.ts`) | Capacity counter plus FIFO of waiting promises; `throttled` and `released` events | **Borrow for the email outbox** (at most one or two SMTP sends at a time, FIFO). **Reject for seats**: the spec wants the loser to fail fast and refresh, not wait in a queue. |
| Capacity reservation (`concurrency-capacity-reservation.ts`) | `reserve()` refuses a second reserve; `release()` is explicit | This is the model for optional seat holds if they are ever added: explicit release, never two holds per guest. Holds are out of the core scope, since `commit()` makes them unnecessary for correctness. |
| Queue mode (Bull/Redis workers), multi-main pub/sub (`push/index.ts:231`) | Scale-out across processes | **Reject.** More than one process breaks the single-thread atomicity guarantee. CORE must stay one process; write that down as an operational rule. |
| Credentials encryption | Encrypted credential store | CORE already has `server/secrets.js`; no new secrets (SMTP is reused). |

Note: the `council` repository named in the user's request is this agentic-council plugin. Its process is followed here; it adds no code patterns.

## 3. Boundaries (C4, container and component level)

```
CORE process (server.js, single Node, systemd)
 ├─ api.handle ─ authorize(route perm) ─ withActor ─ handler
 │    ├─ /api/customapp/...          (signed in; perm customapp.use; event role checked inside)
 │    └─ /api/public/event/:code/... (signed out; event-specific rate limits; registration toggle)
 └─ CUSTOM APP module  (server/customapp/)
      index.js     registerCustomAppRoutes(route, db, {audit, notify, mail})  ← app registry
      events/      THE EVENT ENGINE (app #1, id 'events')
        model.js     collection accessors, normalisers, lookup keys
        commit.js    unit of work: re-read role → idempotency → plan → expect → invariants → apply → save → after-commit
        commands.js  one plan() per command type (pure; reads state, returns writes or throws Conflict)
        feed.js      per-event seq, long-poll waiters Map<eventId, Map<user:tab, resolve>>
        outbox.js    email queue, ConcurrencyQueue-style drain, delivery status
        public.js    guest verify, status long-poll (no master-list reads leave this file)
        io.js        CSV/XLSX import with dedupe, CSV export, printable plan (server/pdf)
 shared/customapp.js        APPS registry, enums, validators (used by server and browser)
 shared/seating.js          eligibility, capacity, ranking: PURE functions, browser and server
 public/js/views/customapp*.js  staff and Super Administrator screens (SPA, #/customapp/...)
 public/event.html + public/js/event.js   standalone guest page (like support.html)
```

Ownership rules:

- Only `commit.js` writes event state.
- `shared/seating.js` never writes.
- `public.js` can reach `commit()` only through a narrow `selfCheckIn` command.
- Nothing outside `server/customapp/` reads the `ca*` collections, apart from the admin export and backup, which take the whole file.

**What is generic and what is YEP-specific.** The CUSTOM APP shell is generic: a code-defined `APPS` list (no low-code or metadata platform). The event engine is generic for corporate seated events: classifications, industries, tables, ownership, check-in, email. YEP 2026 is pure data: one event record with its industries, tables, guests, staff and email wording. There are no `if (event.code === 'yep...')` branches, ever.

Not generalized now: multiple sessions per event, floor plan, tickets or payments, SMS, custom guest fields. These are extension points (`event.settings`, `guest.tags`), not abstractions.

---

## Appendix A — Context briefing (codebase-context, scoped to CUSTOM APP)

### Tech Stack
- **Framework**: none. Raw `node:http` server (server.js) plus a hand-written router (server/api.js `route()`); vanilla ES-module SPA, no build step.
- **Language**: JavaScript (ESM), Node 22 in production (package `engines` says 18 or later). CORE version 0.70.0-alpha.
- **Database**: a single JSON document `data/db.json`, held in memory (`db.data`) and written atomically by `db.save()`; hash-chained `audit-log.jsonl`.
- **Auth**: CORE sessions (cookie), scrypt passwords, TOTP 2-step, role permissions (`shared/roles.js` `userCan`), per-company role overrides.
- **Hosting**: AWS EC2, Caddy (TLS, gzip) → 127.0.0.1:3000, systemd; hourly S3 offsite copy, nightly local backups, daily restore check.
- **Key Dependencies**: none at runtime; Playwright for dev and CI only.

### Architectural Patterns
- **Routing**: server: `route(method, '/api/x/:id', permission, handler)`; client: hash routes in `public/js/app.js` as `[path, view, permission, moduleId]`.
- **Data fetching**: the browser fetches JSON; it polls for badges; there is no push.
- **State management**: the server holds authoritative in-memory state; the client re-fetches after every change.
- **Component pattern**: one view file per module screen, built with helpers from `ui.js`.

### Data Model (the existing parts this module touches)
| Entity | Key fields | Relationships |
|---|---|---|
| users | id, username, role, active, 2FA | event.superAdminUserId, event.staff[].userId, guest/table.ownerUserId → users.id |
| roleOverrides | role → permissions | adds `customapp.use` / `customapp.manage` per company |
| modules | id → enabled | `customapp` on/off; `MODULE_API` refuses `/api/customapp` and `/api/public/event` when off |
| helpdesk.outgoing | SMTP settings (sealed password) | reused by the event outbox through an extracted transport |
| audit-log.jsonl | action, entity, entityId, actor | `customapp.*` actions |

### Conventions
1. Flat collections in `db.data`, with a module prefix (`crmDeals`, `pmTasks`) and defaults through `data.x ||= []` in `openDb`. This module uses `caEvents`, `caTables`, `caGuests`, `caChanges`, `caOutbox`.
2. Handlers throw `HttpError(status, message)`; success returns plain data (`{data, headers}` when headers are needed).
3. Every visible change updates the guides plus `whats-new`, bumps `APP_VERSION` and adds a devlog entry; tests run with `node --test` against `openDb(tmp)` + `createApi(db)` + `handle(...)`.
4. IDs come from `randomUUID()`; human codes use counters in module config (here: `YEP-0001` guest references per event).

### Infrastructure Constraints
- One process, one in-memory dataset shared with all of CORE. A crash or a slow save affects every module.
- Every push to the branch deploys to production after CI, so the event-day freeze has to be enforced by process (branch protection), not just agreed.
- There is no streaming route hook.

### Integration Points
| Service | Purpose | Auth |
|---|---|---|
| SMTP (helpdesk outgoing) | assignment email | sealed credentials (`server/secrets.js`), STARTTLS/TLS |
| S3 offsite | hourly copy of `db.json` (includes event data) | EC2 instance role |
| Caddy | TLS, gzip, real client IP | n/a |

### Warnings / Tech Debt
- The generic public rate limits are per IP and will throttle a venue NAT (see Risks).
- Whole-file save cost has not been measured on production.
- There is no generic outbox or delivery-status store, so this module builds one inside its own area. It could be promoted to CORE later.

---

## Appendix B — Schema design (JSON collections in `db.json`)

### Entity Overview
| Entity | Purpose | New/Modified |
|---|---|---|
| `customApp` (object) | module config: counters, app enablement | New |
| `caEvents` | one event: settings, industries, staff roles, Super Administrator, registration toggle, `seq` | New |
| `caTables` | tables of an event | New |
| `caGuests` | master guest list, with embedded seat, arrival, approval, notification state | New |
| `caChanges` | append-only change log per event (history, live-sync cursor, reconciliation) | New |
| `caOutbox` | email messages with delivery status | New |
| `shared/roles.js` ROLES | new `eventstaff` account type: `['customapp.use']`; admin keeps `*` | Modified |
| `shared/modules.js` | `customapp` entry, `MODULE_API` `^/api/(customapp\|public/event)(/\|$)`, MODULE_PARTS | Modified |

### caEvents
| Field | Type | Null | Default | Constraint |
|---|---|---|---|---|
| id | uuid | no | randomUUID | PK |
| app | 'events' | no | 'events' | must be in APPS |
| code | string | no | — | unique among non-archived events; URL slug with a random suffix (e.g. `yep26-k3f9`), so the page cannot be guessed before the QR is shown |
| name, venue | string | no / yes | — | ≤ 120 |
| date | 'YYYY-MM-DD' | no | — | |
| status | 'draft'\|'live'\|'closed'\|'archived' | no | 'draft' | public routes answer only when `live` |
| registrationOpen | bool | no | false | the spec's activation toggle; public verify refuses when false |
| superAdminUserId | uuid | no | — | FK users; exactly one by construction; changed only through `setSuperAdmin` (CORE admin, re-authentication, audited) |
| staff | [{userId, role:'staff'\|'viewer', active}] | no | [] | userId unique; the Super Administrator is never listed here |
| industries | [{id, name, related:[id], active}] | no | [] | `related` kept symmetric on write |
| settings | {hardLimit:10, seatNumbers:'preferred'\|'all'\|'none', mixedTables:bool, releaseDelegable:bool, emailFrom, emailTemplate} | no | defaults | `table.capacity ≤ hardLimit`; hardLimit ≤ 10 for YEP |
| seq | int | no | 0 | +1 per committed command; persisted |
| counters | {guest:int} | no | {guest:0} | for `YEP-0001` |
| rev, createdAt, updatedAt, createdBy | | | | |

### caTables
| Field | Type | Null | Default | Constraint |
|---|---|---|---|---|
| id | uuid | no | | PK |
| eventId | uuid | no | | FK caEvents (RESTRICT: archived with the event) |
| number | string | no | | unique among active tables of the event (renumbering checks this) |
| classification | 'preferred'\|'regular'\|'employee'\|'mixed' | no | 'regular' | 'mixed' only if `settings.mixedTables` |
| capacity | int | no | 10 | 1..hardLimit; cannot drop below the live seat count |
| ownerUserId | uuid | yes | null | FK users; must be a staff member of the event or null; single owner by construction |
| active | bool | no | true | cannot be deactivated while it holds live seats, unless a `relocate` in the same commit empties it |
| rev, createdAt, updatedAt | | | | |

### caGuests (the aggregate root: guest, seat, arrival and notification together)
| Field | Type | Null | Notes |
|---|---|---|---|
| id | uuid | no | stable unique guest identifier (spec section 2) |
| eventId | uuid | no | FK |
| ref | string | no | `YEP-0001`, unique per event |
| externalKey | string | yes | import row key; dedupe on re-import (fallback: normalised name, company and email) |
| name | {first, last, display} | no | |
| designation, company | string | yes | |
| industryId | id | yes | references event.industries |
| email, mobile | string | yes | PII; never returned by public routes |
| lookup | {surnames:[norm], m4, e4} | no | derived on every write, for self-verification (normalisation rules from Skeptic and Advocate) |
| classification | 'preferred'\|'regular'\|'employee'\|'unlisted' | no | |
| tags | [string] | no | optional affinity or exclusion tags |
| rsvp | 'unknown'\|'yes'\|'no'\|'maybe' | no | independent of check-in (spec section 17) |
| ownerUserId | uuid | yes | designated registration personnel; null means the Super Administrator's queue |
| arrival | {state:'expected'\|'checked_in'\|'cancelled', at, by:'self'\|userId, via:'qr'\|'desk'\|'reconcile'} | no | `checked_in` is reached once; replay is idempotent |
| approval | {state:'none'\|'pending'\|'approved'\|'rejected', by, at, note} | no | unlisted guests start as `pending` |
| substituteFor / substitutedBy | uuid | yes | link to the original invitee; at most one of the pair holds a seat |
| groupId | uuid | yes | arrival group (advisory; each member keeps its own seat) |
| **seat** | {tableId, seatNo\|null, state:'reserved'\|'confirmed', at, by} \| null | yes | **the only capacity-consuming record.** Preferred pre-assignment = `reserved`; check-in turns it `confirmed`; release sets `seat=null` and `releasedNote` (late arrival is then referred) |
| status token | {hash, issuedAt} \| null | yes | SHA-256 of the guest status token |
| notify | {state:'none'\|'queued'\|'sent'\|'failed', lastAt, attempts} | no | denormalised from caOutbox for the dashboard |
| active | bool | no | deactivated, not deleted, while the event is live |
| rev, createdAt, updatedAt | | | rev +1 on every write; required in `expect` for guest commands |

Derived, never stored:

- `assignmentStatus` = none / reserved / confirmed / released
- `queue(owner)` = guests owned by that person, checked in, not seated (or released)
- `superQueue` = `ownerUserId == null` + unlisted pending + flagged + released-and-arrived
- table counts = live seats at the table

### caChanges (append-only)
`{seq, eventId, at, actorId, via:'staff'|'self'|'reconcile', type, guestIds[], tableIds[], before, after, reason, requestId}`

This one log serves as:

- the spec's approval and change history (section 7),
- the live-sync cursor,
- the idempotency store (look up by `requestId`),
- the reconciliation record, and
- the post-event report.

CORE `audit.record('customapp.<type>', ...)` is written for the spec section 13 list: approvals, overrides, responsibility changes, releases, transfers and corrections.

### caOutbox
`{id, eventId, guestId, kind:'assignment'|'update'|'resend', to, subject, body (rendered at queue time from a seat snapshot), state:'queued'|'sending'|'sent'|'failed', attempts, lastError, createdAt, sentAt, createdBy}`

A failure never touches `guest.seat` or `guest.arrival` (spec section 6).

### Relationships
```
users 1──N caEvents.superAdminUserId (exactly 1 per event)
users N──M caEvents via event.staff[]
caEvents 1──N caTables   caEvents 1──N caGuests   caEvents 1──N caChanges   caEvents 1──N caOutbox
users 1──N caTables.ownerUserId (0..1 per table)
users 1──N caGuests.ownerUserId (0..1 per guest)
caTables 1──N caGuests.seat.tableId (live seats ≤ capacity ≤ hardLimit)
caGuests 1──1 caGuests (substituteFor ↔ substitutedBy)
caGuests 1──N caOutbox
```

### Invariants (enforced in `commit()`; most are structural)
| # | Invariant | How |
|---|---|---|
| I1 | live seats(table) ≤ table.capacity ≤ event.hardLimit (10) | checked against the post-state of every command |
| I2 | a guest holds at most one seat | structural (`guest.seat` is a single field) |
| I3 | (tableId, seatNo) is unique among live seats | checked |
| I4 | each guest and table has at most one owner; the owner is active staff | structural plus checked |
| I5 | exactly one Super Administrator per event | structural |
| I6 | a substitute and the original never both hold a seat | the seat is moved inside one commit; checked |
| I7 | check-in happens once | state-machine guard; idempotent replay |
| I8 | a table with live seats cannot be deactivated or shrunk below its count | checked |
| I9 | a reserved (preferred) seat never expires | no timer touches seats; only `release` clears one |
| I10 | the actor may write only guests and tables they own (the Super Administrator may write any) | re-read from current state on every commit |

### Index strategy (in-memory)
The data is about 300 guests and about 40 tables, so a linear scan per check costs microseconds; no indexes are needed for correctness.

Add two lazily built maps per event, invalidated on `seq` change: `liveSeatsByTable` and `guestsByLookupSurname`. They are an optimisation for the board and verify paths only. Commit-time capacity checks recount from the source, so a stale cache can never allow an overbooking.

### Access policy (the role-level security equivalent)
| Resource | Super Administrator | Staff (owner) | Staff (not owner) / viewer | Guest (public) |
|---|---|---|---|---|
| Event settings, industries, staff, delegation | read/write | read | read | name and open state only |
| Guest record | read/write all | read/write own guests | none (search for assisted check-in shows name, company and ref only) | own first name, table and seat, via status token |
| Table seat-level detail | all | own tables | counts, industries and remaining seats only (read-only) | none |
| Commands | all | within scope (I10) | none | `selfCheckIn` only |

### Migration (JSON)
- **Up:** add `customApp: {counters:{}}`, `caEvents: []`, `caTables: []`, `caGuests: []`, `caChanges: []` and `caOutbox: []` to `emptyData()`, plus `data.x ||= ...` in `openDb`. Register the module entry, `MODULE_API`, the `eventstaff` role and the permissions `customapp.use` / `customapp.manage`.
- **Down:** switch the module off (routes are refused at once); `delete data.ca*` and `data.customApp`; remove the role (users holding it fall back per existing role-removal handling). The data stays in the dated nightly backups.

---

## Appendix C — The unit of work (`server/customapp/events/commit.js`)

```js
// Synchronous by design: no await anywhere in this file (a test enforces it).
export function commit(ctx, eventId, user, cmd) {
  const ev = mustLiveEvent(ctx.db, eventId);
  const role = roleOf(ev, user);                     // re-read now: permission changes take effect immediately
  const prior = findChange(ev, cmd.requestId);       // network retry or double tap
  if (prior) return resultOf(prior);
  const plan = COMMANDS[cmd.type].plan(ctx.db, ev, role, cmd);  // pure; throws Conflict(code, fresh)
  expectRevs(plan, cmd.expect);                      // stale -> 409 {code:'stale', fresh}
  checkInvariants(ctx.db, ev, plan);                 // I1-I10 on the post-state -> 409 {code:'full'|'seat_taken'|'out_of_scope'|...}
  const undo = apply(ctx.db, ev, plan);              // mutate, rev++, ev.seq++, push caChanges
  try { ctx.db.save(); } catch (e) { undo(); throw new HttpError(503, 'Not saved. Try again.'); }
  afterCommit(ctx, ev, plan);                        // audit.record, feed.wake(ev.id), outbox.enqueue (no awaits)
  return plan.result;                                // includes new revs and seq
}
```

The command set is one endpoint, so the code has one place for revalidation (heuristic: minimise API surface):

| type | Who | Notes |
|---|---|---|
| `checkIn`, `undoCheckIn` | owner, Super Administrator | for preferred guests, `checkIn` turns a reserved seat into confirmed in the same commit; a released preferred guest goes to the Super Administrator's queue |
| `assign` {placements:[{guestId, tableId, seatNo?}], allowSplit} | owner within scope, Super Administrator | a group is one commit for all members; splitting across tables requires `allowSplit:true` (staff confirmation) |
| `transfer`, `swap` | scope covers all guests and tables involved; otherwise Super Administrator | one commit; capacity checked on the destination only |
| `reserve` (preferred, before the event), `release` | Super Administrator (owner if `releaseDelegable`) | never automatic |
| `createUnlisted`, `approve`, `reject` | staff create, Super Administrator decides | approval records identity, classification, industry and owner |
| `substitute` {originalId, newGuest, moveSeat} | Super Administrator or authorised staff | the seat moves; the original is marked `substitutedBy` |
| `delegateGuests`, `delegateTables` {ids, toUserId\|null} | Super Administrator | for guests, only pending (unseated) ones move unless forced; seats are never touched |
| `table.add`, `table.update`, `table.relocate` | Super Administrator | I8 enforced; relocate and deactivate can be one commit |
| `notify` {guestIds, kind} | owner, Super Administrator | queues outbox messages; no state change other than `notify` |

The public `selfCheckIn` uses the same `commit()` with a synthetic actor (`via:'self'`), and its plan is restricted to `checkIn`.

---

## Appendix D — Route contract (minimum surface)

Signed in, permission `customapp.use` (`customapp.manage` for creating events and setting the Super Administrator):

| Method & path | Returns / does |
|---|---|
| GET `/api/customapp/apps` | registry for the module landing page |
| GET/POST `/api/customapp/events` | list the events the caller has a role in / create (manage) |
| GET/PATCH `/api/customapp/events/:id` | settings, industries, staff (Super Administrator); PATCH carries `rev` |
| POST `/api/customapp/events/:id/super-admin` | `customapp.manage` plus re-authentication (sensitive bucket); audited; notifies the old and new holder |
| GET `/api/customapp/events/:id/board?since=<seq>&wait=25&tab=<id>` | **live sync.** Answers at once with `{seq, board}` if `seq > since`, else holds up to 25 s and returns `{seq, unchanged:true}`. `board` is scoped per Appendix B: my queue, my tables, read-only availability, Super Administrator queues and the dashboard |
| GET `/api/customapp/events/:id/recommend?guestIds=a,b,c` | ranked eligible tables (Appendix F), split into `mine` and `othersReadOnly` |
| GET `/api/customapp/events/:id/guests?q=&class=&status=&table=` | search and filter (scoped) for assisted check-in |
| POST `/api/customapp/events/:id/commands` | `{type, requestId, expect:{guestRevs}, ...}` → `commit()` |
| POST `/api/customapp/events/:id/import` (CSV/XLSX) → preview; POST `.../import/:jobId/apply` | two-step import with a dedupe report; apply is one commit |
| GET `/api/customapp/events/:id/export.csv?kind=guests\|seating\|registrations` and `/plan.pdf` | export and printable offline plan |

Signed out (`/api/public/event/:code/...`, gated by event `live` + `registrationOpen`, event-specific limits, never the generic per-IP buckets):

| Method & path | Returns |
|---|---|
| GET `/api/public/event/:code` | `{name, date, open}`, nothing else |
| POST `/api/public/event/:code/verify` {surname, last4} | exactly one match → `selfCheckIn` (idempotent) → `{token}`. Anything else → a uniform `{ok:false, see:'desk'}` with the same response time and shape |
| GET `/api/public/event/:code/status/:token?since=&wait=25` | `{state:'pending'\|'seated'\|'see_desk', firstName, table, seat}` |

Pages: `/event/<code>` and `/event/<code>/s/<token>` → `public/event.html` (added to server.js page routing and to `pagePolicy`).

Error contract: 409 `{error, code, fresh}` where `code` is one of `stale`, `full`, `seat_taken`, `out_of_scope`, `not_eligible`, `already_checked_in`, `needs_super_admin`. `fresh` carries refreshed options so the client re-renders without a second call.

---

## Appendix E — Live sync

- `ev.seq` increments in `apply()`; `feed.wake(ev.id)` resolves every waiter for that event after the save.
- Waiters are keyed `userId:tab` (the n8n `connectionKey` idea); a new wait from the same tab resolves the previous one as unchanged. Each user has a cap on open waits.
- Load: 30 staff devices plus about 60 guests waiting at once, at one request per 25 s each when idle, is about 4 requests per second. Under change, each commit wakes everyone once, and a scoped board is about 10-100 KB before gzip. Node handles this easily on one core.
- Restart or deploy: the waits drop and clients re-poll with `since`, losing no state. A client whose `since` is ahead of the server's `seq` (a restored backup) receives a full board.
- **Fallback:** if a wait errors, the client falls back to a 3-second plain poll of the same URL with `wait=0`. One contract, two speeds.
- Operator must check that the security monitor (server/monitor.js) does not flag 25-second holds as anomalies, and must confirm the intended session effect: the board's long-poll keeps staff signed in during the event.

## Appendix F — Recommendation engine (`shared/seating.js`, pure)

```
recommend({event, tables, guests, group:[guestIds], scope}) → [{tableId, tier, free, reasons[], selectable}]
eligible(table, guest): active && classOK(table.classification, guest.classification, settings.mixedTables)
                        && free(table) ≥ group.length && !excluded(table, group)
classOK: preferred→{preferred, mixed}; regular→{regular, mixed}; employee→{employee, mixed}; unlisted→per approval classification
tier 1: same industry already seated at the table · tier 2: related industry · tier 3: other eligible
order within a tier: fits the whole group first → more same-industry companions → fewer seats left after placement (fills gaps, does not force sequential filling)
selectable = scope covers the table (I10); others are returned read-only for visibility (spec section 13)
reasons: human strings ('2 from Banking', 'related: Insurance', '4 seats left') for the staff screen
```

The same `eligible()` is called by `commit()` as a constraint. Ranking stays advisory: a staff member may pick any eligible table in scope. If no group-fit table exists, the result includes split suggestions (the largest fitting partitions), and the client must send `allowSplit:true`. If nothing is eligible, the result is `{none:true, refer:'super_admin'}`.

## Appendix G — Email

- `afterCommit` queues an `assignment` or `update` message when a seat is confirmed or changed and an email address exists. The body is rendered from a seat snapshot when it is queued.
- `outbox.js` drains through a capacity-1 FIFO (the n8n ConcurrencyQueue shape): it marks `sending`, saves, `await sendMail(transport(), ...)`, then marks `sent` or `failed` plus `guest.notify`, and saves. The await happens **outside** any `commit()`, and the status writes touch only `caOutbox` and `guest.notify`.
- Retries: three with backoff on transient SMTP errors, then `failed`; resend is a `notify` command. A restart re-queues any message left in `sending` older than 2 minutes, accepting a rare duplicate email over a lost one.
- Transport: extract `smtpOptions()` and `canEmail()` from helpdesk.js into a shared `mailTransport(db)`; the event sets its own From name and reply-to.

## Appendix H — Offline contingency and reconciliation

- Exclusive table ownership already is the "pre-partitioned offline seating range": each member of staff may seat only at their own tables, on paper, and the Super Administrator acts as the single authority for anything else.
- Before the event, and at the start of event day, export the following and print them: the guest list (ref, name, company, class, owner, reserved table and seat), the seating plan per table, and a blank allocation sheet per owner.
- After reconnecting, staff enter paper allocations through the `commands` endpoint with `via:'reconcile'` and `occurredAt`. They pass through the same `commit()`, so a paper overbooking is refused and listed, never applied. The Super Administrator resolves the refusals, then flips `registrationOpen` back on.
- There is no client-side offline database or service worker in 12 days; the risk is greater than the benefit.

## Appendix I — Build order (architecture-critical path, 12 days)

1. Data model and migration, `shared/seating.js`, `commit()` with invariants, and pure and race tests (this is the foundation everything else assumes).
2. Commands endpoint plus board long-poll; the Super Administrator setup screens (tables, industries, staff, delegation, import).
3. Public verify and status page plus the event-specific limits (with a NAT load test).
4. Outbox and email; export and printable plan.
5. Dashboard and polish, then guides, journeys and the load test. Freeze about two days before the event.

Out of the core scope, with no data-model change needed to add later: seat holds, SSE, floor plan, SMS, advanced exclusion rules, analytics.
