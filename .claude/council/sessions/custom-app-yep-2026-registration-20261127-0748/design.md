# Design Document: YEP 2026 Registration & Table Assignment as the first app of the CORE module "CUSTOM APP"

Session: `custom-app-yep-2026-registration-20261127-0748` · Date: 27 Nov 2026 (12 days to the event) ·
Scope: analysis and design only. Nothing is built until the user approves.
Perspectives: Architect, Advocate, Skeptic, Strategist, Scout, Operator, Craftsman (three rounds).
Spec: `spec.txt` (Legati Group, "Registration & table assignment", developer brief of 27 Nov 2026).

> **Where the n8n references come from.** In Round 1 Architect and Scout read a sparse clone of
> `n8n-io/n8n` (Scout cites commit `bafcff7`) and quote file paths from it. That clone is not in this
> workspace any more. The other perspectives marked their n8n references *(unverified)*. Every n8n
> item in this document is a **pattern** to copy, never code or a dependency. CORE stays on Node's
> standard library.

---

## Overview

CUSTOM APP (`customapp`, a new entry in `shared/modules.js`) is a thin CORE module that holds
client-specific apps behind an `APPS` registry. Its first app is a **generic event-registration
engine** with events, guests, tables, delegation, check-in and seating, and Legati Group's YEP 2026
(9 Dec 2026, about 300 guests, a hard limit of 10 per table) is the first event loaded into it.
Here "reusable" means **parameterised, not abstracted**. Every record is keyed by `eventId`.
Classifications, table types, industries and their relationships are data, and the code contains
no YEP strings. There is no app builder, no custom fields and no plugin loading. Event data lives in
CORE's existing `db.json` as `ca*` collections, and only `server/customapp/` reads or writes them.
Every state change goes through one **synchronous `commit()`**. It checks the flags, re-reads the
actor's event role, checks idempotency and revisions, plans the change, checks the invariants
(capacity is counted by a single status-agnostic `claimsAt(tableId)`), applies the change, and calls
`db.save()`. If the save throws, it undoes the change in memory. Because nothing is awaited between
the check and the write, Node's single thread makes "last seat: only one succeeds", atomic swaps and
transfers, and "a permission change applies at once" hold by construction. Seat claims have exactly
two statuses, `reserved` and `confirmed`. Holds are out.

Live sync is a **short poll** on `changes?since=<seq>`, paced by a `pollMs` the server returns, so
there is no new connection infrastructure. Guests use a hardened standalone page at `/event/<code>`.
They type their surname and the last 4 digits of their mobile (or their full email). An exact match
on the normalised surname checks them in and issues a hashed per-device status token. Every failure
gets one byte-identical "please see the desk, code R-482" reply, and a failed attempt never writes
to disk. Event routes have their own rate-limit buckets, sized for a ballroom behind one NAT
address. The build ships in **three tiers**, and each tier leaves CORE ready for the event:
- Tier 0, staff-only seating: 1 Dec, released dark.
- Tier 1, guest QR page, delegated queues and recommendations: 3 Dec.
- Tier 2, exceptions, email and dashboard: 5 Dec, with the client acceptance demo.

It is protected by a small operations layer that ships **first, on 28 Nov**: a freeze guard, a
kept previous release with a one-command rollback, and an `unhandledRejection` logger. Then come
two load tests from one source IP, a kill -9 drill, a technical deploy freeze from 8 Dec 12:00 to
10 Dec 09:00, a warm standby for staff, and a printed contingency pack. The build is about 15
dev-days, and 6 to 8 Dec are buffer.

---

## Architecture (Architect)

### A1. Module boundary and file layout

```
shared/customapp/statuses.js      SEAT_STATUSES = freeze(['reserved','confirmed']), ARRIVAL, APPROVAL, FLAGS, CHANGE_TYPES
shared/customapp/refusals.js      frozen refusal catalogue (A6), shared with the browser
shared/customapp/seating.js       eligible(), claimsAt(), recommend(): pure; the server is authoritative, the browser uses them for display only
shared/customapp/invariants.js    checkInvariants(eventState) -> [] | [{rule, ids, detail}]
server/customapp/index.js         registerCustomAppRoutes(route, db, {audit, notify, mail}); APPS registry (one entry: 'events')
server/customapp/events/model.js  accessors, normalisers (surname canon, digits-only last 4), lookup keys
server/customapp/events/engine.js plan(state, cmd, actor, now) per command: pure, sync, no I/O, no Date.now()
server/customapp/events/commit.js the unit of work (no await; a test enforces this)
server/customapp/events/routes.js mutation() guard plus the staff routes
server/customapp/events/changes.js seq, since-queries, scoped board builder
server/customapp/events/public.js verify, status token, activation window, referral map, soft cap (the only signed-out code)
server/customapp/events/outbox.js capacity-1 FIFO email drain, retries, emailPaused
server/customapp/events/io.js     import preview/apply plus collision report; export (CSV, JSON v1, printable plan)
public/event.html + public/js/event.js        standalone guest page (support.html precedent)
public/js/views/customapp*.js                  My queue, Find guest, Event control, Setup
```

Changes to CORE outside the module are deliberately small:
1. `server/db.js`: `ca*` defaults in `emptyData()` and `openDb`. Switch to compact JSON only if the
   28 Nov gate asks for it (A8).
2. `server/api.js` `replaceData()` gets the event carve-out (A7). `/api/public/event/` is exempt
   from `api-anon` and `public-write` and gets event buckets (C2). `/api/admin/export` leaves out
   event PII while an event is live, unless "include events" is ticked (audited).
3. `server/util.js`: `HttpError(status, message, {code, fresh})`, where the third argument is
   optional and backward compatible. `handle()` serialises `{error, code, fresh}`.
4. `shared/modules.js` gets a `customapp` entry, `MODULE_API`
   `^/api/(customapp|public/event)(/|$)` and MODULE_PARTS. `shared/roles.js` gets an `eventstaff`
   account type (`customapp.use` only) and the `customapp.manage` permission.
5. `server.js` and `server/security.js` get the `event.html` page route and its CSP hash in
   `pagePolicy`.
6. `server/helpdesk.js:245-261`: `smtpOptions()` and `canEmail()` are extracted into a shared
   `mailTransport(db)`.
7. A process-level `unhandledRejection` logger (Operator O3).

### A2. Data model (`db.json`, `ca*` collections)

| Collection | Key fields | Notes |
|---|---|---|
| `caEvents` | `id, app:'events', code, name, venue, date, status: draft\|live\|closed\|archived, superAdminUserId, staff:[{userId, role, active}], industries:[{id, name, related[], active}], settings:{hardLimit:10, seatNumbers: preferred\|all\|none, mixedTables, releaseDelegable, emailFrom, replyTo, template}, window:{opensAt, closesAt}, flags:{registrationOpen, emailPaused, readOnly, pollMs}, qrKeyHash?, seq, counters, rev` | `code` is a slug with a random suffix (`yep26-k3f9`), so the page cannot be guessed before the QR is shown. Exactly one Super Administrator by construction (a single field). `related` is kept symmetric on write. Window times are UTC instants, shown in Asia/Manila. |
| `caTables` | `id, eventId, number, classification: preferred\|regular\|employee\|mixed, capacity (1..hardLimit), ownerUserId\|null, tags[], active, rev` | One owner by construction. A table cannot shrink below its claims, or be deactivated while it holds claims, unless a relocate in the same commit empties it. |
| `caGuests` (aggregate root) | `id, eventId, ref (YEP-0001), externalKey, name{first,last,display}, designation, company, industryId, email, mobile, lookup{surnames[], altSurnames[], m4}, classification: preferred\|regular\|employee\|unlisted, tags[], rsvp, ownerUserId\|null, arrival{state: expected\|checked_in\|cancelled, at, by, via: qr\|desk\|reconcile}, approval{state, by, at, note}, substituteFor/substitutedBy, groupId, seat{tableId, seatNo\|null, status: reserved\|confirmed, at, by}\|null, statusTokens:[{hash, issuedAt}] (at most 5), flags:[{kind:'reverified_other_device', at}], notify{state, lastAt, attempts}, deskOnly, active, rev` | **The seat lives on the guest**, so one guest cannot hold two seats. `seat=null` means no claim. A release writes history, not a third status. `ownerUserId=null` puts the guest in the Super Administrator's queue. |
| `caChanges` (append-only) | `{seq, eventId, at, occurredAt?, actorId, via: staff\|self\|reconcile, type, opId, guestIds[], tableIds[], diff, reason}` | Field-level diffs, about 200 B each, about 0.6 MB by the end of the event. The same log is the spec's approval and change history (s.7), the live-sync cursor, the idempotency store and the post-event report. |
| `caOutbox` | `{id, eventId, guestId, kind: assignment\|update\|resend, to, subject, body, state: queued\|sending\|sent\|failed, attempts, lastError, createdAt, sentAt}` | The body is rendered from a seat snapshot when the message is queued. A failure never touches `seat` or `arrival` (spec s.6). |

**Derived, never stored:** table counts (`claimsAt`), `queue(owner)` (owned, checked in, not seated),
`superQueue` (no owner, unlisted pending, flagged, released-and-arrived), and the assignment status.
Two lazy in-memory maps per event, `guestsByLookupSurname` and `claimsByTable`, are rebuilt whenever
`seq` changes. Commit-time checks **recount from the source**, so a stale cache can never allow an
overbooking.

### A3. Invariants (one `checkInvariants`, used everywhere)

| # | Invariant | How it is enforced |
|---|---|---|
| I1 | `claimsAt(t) <= t.capacity <= event.hardLimit (10)`, counting every claim **whatever its status** | Checked on every post-state |
| I2 | A guest holds at most one seat | Structural (single `seat` field) |
| I3 | `(tableId, seatNo)` is unique among claims | Checked |
| I4 | Each guest and each table has at most one owner, and that owner is active staff | Structural plus checked |
| I5 | Exactly one Super Administrator per event | Structural; changed only by `setSuperAdmin` |
| I6 | A substitute and the original invitee never both hold a seat | The seat moves inside one commit; checked |
| I7 | A guest is checked in only once | State-machine guard; a replay is idempotent |
| I8 | A table with claims cannot be deactivated or shrunk below its count | Checked |
| I9 | A reserved seat never expires | No timer touches seats; only `release` clears one |
| I10 | The actor writes only the guests and tables they own (the Super Administrator writes any) | Re-read from the current state on every commit |

### A4. The unit of work

```js
// server/customapp/events/commit.js — synchronous by design; a test greps this file for 'await'
export function commit(ctx, eventId, user, cmd) {
  const ev = mustEvent(ctx.db, eventId);
  if (ev.flags.readOnly && !cmd.reconcile) throw refusal('read_only');
  const role = roleOf(ev, user);                              // re-read every call: permission changes apply at once
  const prior = ctx.idem.get(ev.id, cmd.opId);                // Map rebuilt from caChanges at boot
  if (prior) return prior.sameBody(cmd) ? prior.result : refusal('op_replay_mismatch');
  const plan = ENGINE[cmd.type].plan(ctx.db, ev, role, cmd, ctx.now()); // pure; throws Refusal(code, fresh)
  expectRevs(plan, cmd.expect);                               // 409 stale, with fresh options
  checkInvariants(ctx.db, ev, plan);                          // I1-I10 on the post-state, via claimsAt()
  const undo = apply(ctx.db, ev, plan);                       // rev++, ev.seq++, push a compact caChanges entry
  try { ctx.db.save(); } catch { undo(); throw new HttpError(503, 'Not saved. Try again.'); }
  afterCommit(ctx, ev, plan);                                 // audit.record, outbox.enqueue: sync, no awaits
  return plan.result;                                         // {seq, revs, ...}
}
```

Every event write is registered through `mutation()`. At startup it refuses an `AsyncFunction`, and
at run time it refuses a handler that returns a thenable (Craftsman N1). The process stays single:
no queue mode, no cluster and no worker threads that write. The public `selfCheckIn` uses the same
`commit()` with a synthetic actor (`via:'self'`), and its plan can only check a guest in.

**Command set** (one endpoint, `POST /api/customapp/events/:id/commands {type, opId, expect, ...}`):
- `checkIn` and `undoCheckIn`. For a preferred guest, `checkIn` turns `reserved` into `confirmed`.
  A released preferred guest goes to the Super Administrator's queue.
- `assign {placements[], allowSplit}`. A group is one commit for all its members, and a split needs
  `allowSplit:true`.
- `transfer` and `swap`. The actor's scope must cover every guest and table involved; otherwise
  only the Super Administrator can do it.
- `reserve` and `release`. Only the Super Administrator, or the owner when `releaseDelegable` is
  set. A reason is required, and nothing is ever released automatically.
- `createUnlisted`, `approve` and `reject`. Staff create, and the Super Administrator decides.
- `substitute {originalId, newGuest}`. The seat changes hands in one commit.
- `delegateGuests` and `delegateTables`. Only the Super Administrator. Seats are never touched.
- `table.add`, `table.update`, `table.relocate`, `setFlag`, `notify` and `setSuperAdmin`.
  `setSuperAdmin` needs `customapp.manage`, password re-entry and a reason, and it is audited.

### A5. Routes

Signed in (`customapp.use`; `customapp.manage` to create events or set the Super Administrator):

| Method & path | Purpose |
|---|---|
| `GET /api/customapp/apps` | the APPS registry for the module landing page |
| `GET/POST /api/customapp/events`, `GET/PATCH /api/customapp/events/:id` | events the caller has a role in; settings, industries, staff and flags (the PATCH carries `rev`) |
| `POST /api/customapp/events/:id/super-admin` | audited transfer with re-authentication (the only event power a CORE `admin` has) |
| `GET /api/customapp/events/:id/changes?since=<seq>&tab=<id>&wait=` | live sync (A9). `wait` is reserved and ignored for now |
| `GET /api/customapp/events/:id/recommend?guestIds=` | ranked eligible tables, split into `mine` and `othersReadOnly` |
| `GET /api/customapp/events/:id/guests?q=&class=&status=&table=` | scoped search for assisted check-in, including by referral code |
| `GET /api/customapp/events/:id/referral/:code` | the real failure reason and what the guest typed (masked) |
| `POST /api/customapp/events/:id/commands` | every write, through `commit()` |
| `POST .../import` (preview, with collision report) then `POST .../import/:jobId/apply` | two-step CSV/XLSX import; the apply is one commit |
| `GET .../export.json`, `.../export.csv?kind=`, `.../plan.pdf` | export JSON v1, CSV and printable plan (Super Administrator only) |
| `GET .../invariants` | `checkInvariants` over the whole event, used by the 60 s self-check and the load script |

Signed out (`/api/public/event/:code/*`, answered only when the event is `live`, never in the
generic per-IP buckets):

| Method & path | Returns |
|---|---|
| `GET /api/public/event/:code` | `{name, date, state: closed\|open, opensAt}` and nothing else |
| `POST /api/public/event/:code/verify {surname, last4 \| email, k?}` | one exact match → `commit(selfCheckIn)` (idempotent) → `{token, state, firstName, table?, seat?}`; anything else → the uniform referral reply (C1) |
| `GET /api/public/event/:code/status` with header `X-Event-Token` and `?since=` | `{seq, pollMs, state: pending\|seated\|see_desk, title, firstName, table, seat}` or `{seq, pollMs, unchanged:true}` |

Pages: `/event/<code>` serves `public/event.html`. After verification, `history.replaceState` adds
the token **as a URL fragment** (`#s=<token>`), which the browser never sends to the server, and the
page also keeps a `localStorage` copy. The API reads the token only from the header, so it never
appears in a path, a query string, a monitor key or a referrer.

### A6. Error contract

Refusals come from one frozen catalogue in `shared/customapp/refusals.js`:

| Status | Codes |
|---|---|
| 409 (state conflict) | `stale`, `table_full`, `seat_taken`, `not_eligible`, `no_eligible_seat`, `already_checked_in`, `guest_moved`, `table_has_claims`, `op_replay_mismatch`, `read_only`, `registration_closed` |
| 403 (authority) | `out_of_scope`, `needs_super_admin` |
| 503 | `not_saved` (the save threw; the state is unchanged) |

Every staff refusal carries `{error, code, fresh}`. `fresh` holds the current guest state, the
winner where it can be shared, and re-ranked options, so the client re-renders without a second
call. Optimistic UI is not allowed.

### A7. Restore safety (the carve-out)

`replaceData()` **always keeps the live `caEvents`, `caTables`, `caGuests`, `caChanges` and
`caOutbox` when the live data holds at least one event**. If the live server has no events (the
standby case), it takes the backup's copy. This rule is deliberately *not* the existing
`next.x?.length ? next.x : db.data.x` pattern, which prefers a non-empty backup and would bring back
stale check-ins. It covers Admin "Restore a backup", "Erase all data" and demo data. While any event
is `live`, the Admin restore screen says "Event data is not part of a CORE restore". The module
switch in Admin panel → Modules refuses to turn CUSTOM APP off while an event window is open, unless
the Super Administrator confirms (Skeptic N13).

### A8. Storage decision gate

`db.json` is the one authoritative copy. There is no mirror, no dual-write and no capacity check in
the browser. On 28 Nov, `db.json` size and `save()` p50 and p95 are measured on a copy of
production:

| `save()` p95 | Action |
|---|---|
| Under 50 ms | nothing to do |
| 50 to 150 ms | in this order: compact JSON (`db.js:125` pretty-prints today), coalesced 2 s outbox status writes, a resize to t3.small on 7 Dec (check for an Elastic IP first) |
| Over 150 ms on 30 Nov | split into `data/customapp/<eventId>/` (about 2 dev-days, on the `offsite.js` `documents/` precedent), and email drops to "display + verbal" to pay for it |

### A9. Live sync

`changes?since=<seq>` returns `{seq, pollMs, unchanged:true}` when nothing has changed. That is one
integer comparison and a few bytes, with no board built. When `seq` has moved, it returns
`{seq, pollMs, board}`, scoped by the access policy below and gzipped by Caddy. Change records use a
closed set of `type` values from `shared/customapp/`, so an SSE transport added later can reuse them
(push would carry only `{seq}`).
- `pollMs`: staff boards 2 s, guest pages 4 s while pending and 10 s once seated, all with jitter.
  Polling pauses on `visibilitychange` and backs off while offline. Under load it is raised to 8 s
  for guests and 4 s for staff, with no deploy.
- Budget: about 30 staff devices at 2 s plus about 60 pending guest pages at 4 s is about 30
  requests per second. An unchanged reply costs microseconds.
- If the server's `seq` is behind `since` (a standby that was restored), the client receives a full
  board.

**Access policy:**

| Resource | Super Administrator | Staff (owner) | Staff (not owner) | Guest |
|---|---|---|---|---|
| Event settings, staff, delegation | read/write | read | read | name and open state |
| Guest record | all | own guests | name, company, industry and table only; no contact fields | own title or first name, table and seat, via token |
| Table detail | all | own tables, read/write | counts, industries, free seats, read-only ("Not yours") | none |
| Commands | all | within scope (I10) | none | `selfCheckIn` only |

### A10. Recommendation engine (`shared/customapp/seating.js`, pure)

```
eligible(table, guest, group) = table.active
  && classOK(table.classification, guest.classification, settings.mixedTables)
  && capacity(table) - claimsAt(table) >= group.length
  && !excluded(table.tags, group.tags)
classOK: preferred→{preferred,mixed}; regular→{regular,mixed}; employee→{employee,mixed}; unlisted→its approved class
tier 1: same industry already at the table · tier 2: related industry · tier 3: other eligible
within a tier: fits the whole group → more same-industry companions → fewer seats left after placement
               (fills gaps without forcing sequential filling) → table number (a deterministic tie-break)
result: [{tableId, tier, free, reasons[], selectable}] | {none:true, refer:'super_admin'}
```

`commit()` calls the same `eligible()` as a constraint, and the ranking stays advisory. `reasons`
are human strings such as "Same industry: Banking, 3 of 6 seated", "Related: Insurance" and "4 seats
left". When no table fits the whole group, the result includes split suggestions (the largest
partitions that fit), and the client must send `allowSplit:true`. No prior art ranks tables by
industry affinity at arrival (Scout), so the engine stays a deterministic tiered score with visible
"why" chips.

### A11. Email

`afterCommit` queues an `assignment` or `update` message when a seat is confirmed or changed and an
address exists. `outbox.js` drains a capacity-1 FIFO (the n8n ConcurrencyQueue shape) **outside**
`commit()`:
1. Mark the message `sending`.
2. `await sendMail(mailTransport(db))`.
3. Mark it `sent` or `failed`, and update `guest.notify`. Status writes are debounced to one save
   every 2 s.
4. Transient errors are retried three times with backoff. A manual Resend is a `notify` command.
5. After a restart, a message left in `sending` for more than 2 minutes is queued again. That risks
   a rare duplicate email rather than a lost one.

Messages use their own events From and Reply-To, so guest replies never land in the helpdesk IMAP
mailbox as IT tickets. Names are encoded with `composeMessage` encoded words, and CR/LF is stripped
on import. On 3 Dec there is a go/no-go on email. If it is "display + verbal", the outbox ships with
`emailPaused=true` and the model does not change.

### A12. Export JSON v1 (the one recovery artifact)

`GET .../export.json` returns `{format:'customapp.event/1', exportedAt, eventId, seq, sha256, event,
tables, guests (without token hashes), changes, outbox}`. The same bytes feed:
- the laptop pull;
- the 5-minute copies on the server (`data/backups/events/`, keeping the last 24);
- the printed pack (CSV and PDF are derived from it);
- the standby top-up check;
- the post-event archive handed to the client before the purge.

A v1.1 import will read this format and nothing else. Paper reconciliation is a series of
**commands** sent with `via:'reconcile'`, `occurredAt` and an `opId` through `commit()`, so a paper
overbooking is refused and listed rather than applied.

---

## User Experience (Advocate)

Three surfaces, each designed for a 390 px phone first.

### U1. Guest page `/event/<code>`

The page is standalone HTML, under 40 KB, with no web fonts, a CSP hash, `noindex` and `no-store`.

| State | What the guest sees |
|---|---|
| `closed` | "Registration opens at 6:00 PM." There are no inputs. |
| `verify` | A **Surname** field (placeholder "e.g. Dela Cruz") and **Last 4 digits of your mobile** (`inputmode="numeric"`, `pattern="\d{4}"`, `autocomplete="off"`). A "Use email instead" link swaps the second field to the **full** email address. |
| `seated` | "Welcome, Ms. Dela Cruz. **Table 3**, Seat 4". The table number is 56 px or larger. |
| `pending` | "You're checked in. We're choosing your table. This page updates by itself." After 4 minutes it adds "Still choosing. A staff member can help at the desk". |
| `referred` | "Please see the registration desk and show this code: **R-482**." Every failure, and the `registrationOpen=false` and `readOnly` states after doors open, look exactly like this. |
| `offline` | The last known status, with "Will update when you reconnect". |

- A status line is honest about how old it is ("Updated 6:41 PM").
- `aria-live="polite"` is set on the status region, and focus moves to the result heading.
- Re-verifying from a second phone shows the same status, with no scolding and no second check-in.
  Staff see a "verified again from another device" flag.
- If email is cut, the "email sent" line is replaced by "Screenshot this screen".
- The guest never sees "not found", "invalid", "already checked in", a countdown, a lock screen or
  a 429.

### U2. Staff "My queue"

This is the landing view for the Event staff account type, a view inside the SPA.
- **Sticky bar:** event name, the staffer's name, and "Last updated 2 s ago". If updates stop for
  15 s, it turns amber and reads "Reconnecting…".
- **Sections:** Waiting for table (oldest first), Checked in and seated, and Find guest.
- **Card:** name, company, an industry chip, a class badge **in text**, and a wait timer that turns
  amber at 4 minutes and red at 8.
- **Seating in two taps.** Tap the card, then tap a table. The first free seat is already selected,
  and Confirm repeats the choice ("Seat at Table 5"). The bottom sheet shows up to 3
  recommendations with their reason lines and a 10-dot meter. In the meter, **filled** means
  confirmed and a **ring** means reserved, and a text count sits beside it ("6 seated · 2 reserved ·
  2 free"). Below the recommendations are "Other eligible tables" (collapsed) and a read-only "Not
  yours" list. Seat chips 1 to 10 are mandatory for preferred guests, and taken seats are disabled.
- **Groups:** select checkboxes, then "Seat together (n)". Only tables with n or more free seats
  are ranked. Splitting needs an explicit "Split group" confirm. A group whose members have
  different owners shows "Send group to Super Administrator".
- **Recovery screens:** a 409 re-renders the sheet in place with the guest still selected, for
  example "Table 5 just filled. Updated options:". A guest the Super Administrator moved greys out
  with "Moved to Maria's queue by the Super Administrator, 6:52 PM" before it leaves the list.
  Nothing disappears silently.
- **Empty queue:** "No one is waiting for you. Your tables: 5, 6, 7 (14 seats left)."

### U3. Find guest / assisted check-in

- Search by partial name, company or **referral code**. Entering R-482 fills in what the guest typed
  and shows the real reason.
- Contact details are masked ("•••• 4417").
- Actions:
  - **Check in** (any staffer);
  - **Seat** (owner or Super Administrator only);
  - **Clear cap and check in** (one tap);
  - **Add walk-in** and **Record substitute**, which go to the Super Administrator's inbox.
- A substitute is shown as one seat changing hands: "Seat 3-4: Juan Reyes replaces Pedro Reyes".
- Check-in and seating are separate transitions with separate permissions.

### U4. Event control (Super Administrator), in its simple form

- **Counts row:** Invited · Checked in · Not yet arrived · Waiting for table · Needs approval ·
  Seats left.
- **Occupancy grid:** one tile per table with its number, class label, meter with a text count,
  and owner. A full table is dimmed and labelled "Full".
- **Exceptions inbox (Must):** walk-in and substitute approvals, "No seat in scope", released
  reservations whose guest has arrived, capped surnames, and the failure-rate alarm.
- **Workload table:** staffer · waiting · longest wait · last active. A per-guest or per-table
  "Move to…" action. Bulk redistribution is a follow-up.
- **Health strip** (Operator): `seq`, save p95, outbox depth, the age of the newest export, 429
  count, and the result of the invariant self-check. A violation shows a banner.
- **Flags** are toggles whose confirm dialogs name the effect, for example "Turn off self check-in?
  Guests will be sent to the desk." Releasing a reservation needs a confirm that names the guest,
  table and seat. Removing a table that has guests is disabled, with a "Move guests…" action.

### U5. Setup → Import check

The import preview lists each kind of problem as a count with a fix action beside it:
- ambiguous pairs (same normalised surname and same last 4): add the full email, add a direct
  mobile, or mark "desk only";
- guests with no mobile and no email: mark "desk only";
- possible duplicates;
- unknown classification or industry;
- tables set above capacity.

"Open registration" stays disabled, with the reason "3 issues to resolve", until the list is clear
or the Super Administrator acknowledges it.

### U6. Accessibility and copy floor

- Inputs at least 16 px and touch targets at least 48 px.
- WCAG AA contrast in both CORE themes.
- Everything works by keyboard.
- Badges and meter states carry text, never colour alone.
- `prefers-reduced-motion` is honoured.
- Guests are addressed by title and surname.
- Copy is written in sentences, never codes, and staff copy names the person and the time.
- Every guest-facing dead end points to a person.

### U7. Failover UX

- An easel card under the QR: "If this page doesn't open, please go to the registration desk."
- A staff desk card with the standby URL and "If the app restarts you'll be signed out. Sign in
  again and you'll land back on your queue". Sign-in returns the user to the route they were on.
- The print pack holds an A–Z list, per-table sheets and per-staffer sheets. Every page is stamped
  "as of HH:MM". After recovery, "Reconcile paper seating" replays each entry through the normal
  commands and shows any conflict as a recovery card.
- Guides: a new CORE guide, `docs/guides/custom-app-events.md`, for the Event staff and Super
  Administrator roles. Its sections are "Seat a guest", "When a table fills up", "Find a guest at
  the desk", "Event control (Super Administrator)" and "If the system is down". It doubles as the
  spec's operator guide, and the desk card is printed from it. A `whats-new` line and the
  screenshots ship with it.

---

## Risk Assessment (Skeptic)

The seating logic no longer carries a risk that blocks the plan. What remains are CORE safeguards
that were built for an office ERP, not for a ballroom behind one NAT address. Each one is closed in
code or configuration and proven by a test or a drill. A promise in a runbook does not count.

### R1. Threats and controls

| Threat / failure | Control | Proof |
|---|---|---|
| **The venue NAT trips the per-IP limits** (`api-anon` 120/min, `public-write` 20/h, `auth` 20/min, `signin-fail`), so check-in stops at about the 20th guest | `/api/public/event/*` is exempt from the generic buckets. Its own limiter has a per-event global ceiling (for example 600/min), a per-surname bucket for failures and a per-token bucket for polls, with a high per-IP ceiling. Staff: raise `signInFailuresPerAddress` (a setting) and the `auth` bucket for the event window only, audited, and put staff devices on the 4G hotspot. | In-process test with limits ON; load tests on 4 and 6 Dec from one IP show **zero 429s** to real guests and staff |
| **Guest enumeration** or someone learning a colleague's table | Exact match on the normalised surname only, with no fuzzy match, no candidate list and no first-name fallback. Every failure (no match, ambiguous, capped, malformed, unlisted, window closed mid-request) returns a byte-identical body and status, padded to the success path's timing, plus a random `R-xxx` code from one pool. | Body comparison test (minus the code); timing parity measured under load |
| **Brute force on the last 4** | A soft cap of **8 distinct wrong last-4 values per (event, normalised surname) in 15 minutes**. Retyping the same wrong value counts once. It clears after 15 minutes or with one tap at the desk. There is **no global lockout**: more than 30 failures in 5 minutes raises an alarm to the Super Administrator. | Public test file pins the numbers |
| **Remote pre-arrival spoofing** | A **server-enforced activation window** (`window.opensAt`). Before it opens, verify refuses and the page takes no input. Optional zero-typing QR key `k` (Should, D-table). The usher's "show this screen" step. | Window boundary tests |
| **A failed attempt forces a disk write** (one whole-CORE `JSON.stringify` per request) | Failed attempts, caps and referral codes live in bounded in-memory maps (TTL 3 h, at most 5,000 entries). Only a successful verify writes. | Spy test: 1,000 failed verifies cause 0 `db.save()` calls |
| **Status token leaks** | 32 random bytes, stored as SHA-256 and looked up by hash. One token per device (at most 5), revocable by staff, and kept with the event so it survives a restart. Sent in the `X-Event-Token` header; the page keeps it in the URL fragment. Replies carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and only the title or first name, table, seat and state. Caddy has no `log` directive, and none may be added. | A test that `t=` or the token never appears in monitor, audit or devlog output; `curl -I` on staging to confirm Caddy does not override `Referrer-Policy` |
| **The CORE `admin` `*` acts as a second Super Administrator** | Event authority is event data: `eventCan(user, event, action, target)` checks `superAdminUserId` and the delegations. A CORE admin's only event power is the audited `setSuperAdmin` transfer (2-step, a reason, the old holder revoked in the same commit). | A CORE admin's seat write gets 403; after a transfer there is exactly one Super Administrator |
| **Cross-scope writes**, or a stale permission after a reallocation | `eventCan` runs on **every** guest and destination table in a plan, and any element out of scope rejects the whole plan. Delegations are re-read at commit time and never cached. | Scope tests; reallocation journey |
| **A race on the last seat**, a double tap, or a Wi-Fi retry | Synchronous `commit()`, per-guest and per-table `rev`, and `opId` idempotency. A mismatched replay is refused. | Interleaved `handle()` tests, real-socket race, fuzz |
| **A new seat status is not counted** | `claimsAt` counts every status, and a closed-enum test fails when `SEAT_STATUSES` changes without a classification | Exhaustiveness test |
| **An Admin "Restore a backup" erases check-ins** | The A7 carve-out (always keep live), plus a boxed warning in `RESTORE.md` §1 that it is forbidden while an event is `live` | Restore test: live `seq` 120, backup at `seq` 50, event unchanged; tried during the 6 Dec drill |
| **The process dies on a stray promise** (Node 22 exits on an unhandled rejection; no handler exists today) | An `unhandledRejection` handler logs, records to the monitor and keeps serving. An `uncaughtException` handler logs, then exits, and systemd restarts in 3 s. | Child-process test; an injected rejection during load test 2 |
| **A push restarts production on the night** | The freeze guard in `remote-deploy.sh` plus the GitHub `production` reviewer gate | A deliberate push after the freeze starts, which must not deploy |
| **Injection through the import** (email headers, CSV formulas) | Strip CR/LF and control characters from names and companies. Prefix cells beginning with `= + - @`, tab or CR with `'` on export. Import capped at about 2 MB and 2,000 rows, with a dry-run diff, Super Administrator only. Once the event is live, a re-import merges by `externalKey` and never touches status, seat or owner. | Import tests |
| **Content-type confusion on the public route** | Only `application/json` is accepted, the body is capped at about 1 KB, and submitted fields are never echoed. Surnames are 1 to 80 characters after normalisation, with zero-width and control characters stripped. `last4` must match `^\d{4}$`. The email must be the full address (at most 254 characters). Check order: limiter, then window, then match. | Public tests |
| **PII spreads into backups and laptops** | Audit labels use the guest ref and a masked name, never the mobile or email. The admin export leaves out event PII while the event is live. The purge clock starts 10 Dec and covers `ca*`, the nightly copies, the event exports and the offsite lifecycle. | Purge checklist (Guardian sets the date) |
| **The module is switched off by mistake mid-event** | Admin → Modules refuses while a window is open unless the Super Administrator confirms | Unit test on the modules route |

### R2. Normalisation rules (shared by import and verify)

1. Apply NFKD and strip diacritics.
2. Lowercase.
3. Drop spaces, hyphens, periods and apostrophes.
4. Strip the suffixes Jr., Sr., II, III and IV.
5. Match against `surnames[]` plus the stored `altSurnames[]` (for example "dela Cruz" and "Cruz").
6. Compare the last 4 on the digits-only form of the stored mobile, so "+63 917 123 4567",
   "09171234567" and "917-123-4567" all compare on "4567".

### R3. Residual risks accepted

- **Pre-arrival spoofing by someone who knows a colleague's direct mobile.** Bounded by the window,
  the usher check and the re-verify flag.
- **A restart signs out every staff device.** Bounded by the freeze, the crash handler, the event
  sign-in allowance and a rehearsed re-login. Persisted sessions would mean changing the
  VAPT-hardened `auth.js` 12 days out, which is the bigger risk.
- **One Super Administrator is a single point of failure.** This is a spec requirement. It is
  bounded by a CORE-admin transfer rehearsed to take under 2 minutes.
- **The in-memory caps and referral codes reset on a restart.** That fails toward the guest, and
  staff can still search by name.
- **Up to 5 minutes of data on the box, and 15 off it, if the instance is lost.** Closed by
  replaying paper and the export through commands on the standby.

---

## Delivery Strategy and Scope (Strategist)

### S1. MVP cut line (MoSCoW)

| Must (never dropped) | Should | Could | Won't before 9 Dec |
|---|---|---|---|
| `commit()` + `claimsAt()`. `reserved` seats. The `replaceData()` carve-out. Event-scoped rate-limit buckets. The guest page with uniform replies, status token, window and soft cap. Delegation and per-owner queues. Recommendations. Import with collision report. Assisted search and check-in. Export JSON v1, CSV and printable plan. 5-minute on-box export copy. Failure-rate alarm. Flags in `commit()`. 60 s invariant self-check. Acceptance and fuzz suites. Printed contingency pack. Exceptions inbox. The 28 Nov ops half-day. | Zero-typing QR presence key `k` (XS, Tier 1, enabled only after load test 1 passes). Email outbox (go/no-go 3 Dec). Seat picker for non-preferred guests (client decision). | A typed rotating desk code (built only if the client asks; off by default). Long-poll behind `wait`. | Seat holds. SSE or WebSocket push. An event-only import or restore endpoint (format fixed, v1.1 reader). Persisted sessions. A QR redirect host. A per-event store (unless the 30 Nov gate trips). Floor plan, SMS and analytics. A generic app framework or a CORE-wide outbox. Queue mode or workers. |

### S2. Roadmap

| Date | Work | Gate |
|---|---|---|
| 27 Nov | Design signed off. Send the client the section-22 questions: seat numbers for non-preferred guests, mixed tables, whether no-show release can be delegated, who owns the industry map, and the sender address. | Approval |
| 28 Nov | **Ops half-day first**: freeze guard, `/opt/ltdc-erp-prev` plus rollback, `unhandledRejection` logger; measure `save()` p95 on a production copy. Then Tier 0 begins: module shell, model, `commit()`, `claimsAt()`, carve-out. | p95 known |
| 30 Nov | Storage gate (A8) | Decision in the devlog |
| **1 Dec** | **Tier 0 released dark** (module off for non-admins): import with collision report, assisted search, manual check-in, preferred retrieval, choose table, audit, CSV and JSON v1 export, printable plan, NAT-sized buckets, the event Super Administrator, flags. | Client decisions due |
| 1–3 Dec (ops) | Staging rebuilt from S3 using RESTORE.md §2. This is the restore drill, and staging becomes the load target and the warm standby. | Restore proven on a real box |
| **3 Dec** | **Tier 1**: the hardened guest page, status token, window, presence key, failure alarm, delegation, per-owner queues, recommendations, polling, `opId`, the 5-minute export copy, the self-check. | Final data due; real import; **email go/no-go** |
| 4 Dec (ops) | **Load test 1** on staging | Zero 429s; `save()` p95 under 100 ms |
| **5 Dec** | **Tier 2**: transfer, swap, release, groups, unlisted guests and substitutes, email outbox, dashboard with health strip, offline pack and reconciliation, CORE guide and whats-new. Flags demonstrated with no deploy. | **Client acceptance demo: all 12 scenarios on several devices** |
| 6 Dec | Data freeze. **Load test 2 with the kill -9 drill.** Dress rehearsal with real staff accounts and 2-step sign-in. Last feature work. | Fallback order applied to any open Sev-1 |
| 7 Dec | Code freeze at 18:00. GitHub `production` reviewer gate on. Resize if the gate asked for it. | Event build tagged |
| 8 Dec | `DEPLOY_FREEZE` from 12:00. Full backup. Offsite copies every 15 minutes. Print the pack. | Event-ready |
| 9 Dec | The event, with the Super Administrator, a standby CORE admin for break-glass, the on-call developer and the warm standby | YEP 2026 |
| 10 Dec + | Lift the freeze at 09:00. Archive the export. PII purge. Retro. v1.1 import reader. Generalise only if a second client app exists. | Post-event report |

**Effort:** about 14.5 to 15 dev-days in 9 build days, at CORE's observed cadence (MOD-08 went from
engine to release in about 3 days). Craftsman's roughly 3 days of test work is inside this figure,
written with each command. 6 to 8 Dec are buffer.

### S3. Fallback order

Apply these one at a time, at the first missed tier date:
1. Email becomes display plus verbal.
2. The dashboard becomes counts plus the occupancy list.
3. Groups become one-by-one assignment with a capacity hint.
4. The seat picker for non-preferred guests is dropped. Seats stay mandatory for preferred guests.
5. The presence key is dropped.

### S4. Success metrics

- **Hard gates** (the invariant scan after each load test and after the event): zero overbooked
  tables, zero duplicate check-ins, zero double seats, zero holds, zero reservations released by
  expiry, and exactly one Super Administrator.
- **Flow:** QR scan to checked in has a median under 30 s. Checked in to seated has a p90 under 2
  minutes at peak.
- **What to invest in for event #2:** the share of guests who self-verify versus those helped at the
  desk, the share seated at a recommended table, and email delivered, failed and resent.
- **Operations:**
  - at least 4 production deploys exercise the guard and the rollback before 7 Dec;
  - `save()` p95 under 100 ms at the load profile;
  - zero 429s to genuine guests;
  - staff back in, or on paper, within 3 minutes in the kill drill.

---

## Prior Art and n8n Patterns (Scout)

### P1. What we borrow and what we reject

| Concern | Source | Decision for CORE |
|---|---|---|
| Guest verify answers at once | n8n Form Trigger `responseMode: onReceived` (`nodes-base/nodes/Form/v2/FormTriggerV2.node.ts`, `common.descriptions.ts`) | **Borrow.** Verify returns at once with a token, and it never waits on staff. |
| Waiting page polls a status endpoint | n8n `packages/cli/src/webhooks/waiting-forms.ts` (`WAITING_FORMS_EXECUTION_STATUS`) | **Borrow.** The guest status endpoint is polled at the server's `pollMs`. |
| Opaque resume token, uniform bad-token reply | n8n `waiting-webhooks.ts` `validateToken` (length check, then `timingSafeEqual`); form auth token bound to node, webhook and execution | **Borrow the binding, not the JWT.** A random 32-byte token, stored hashed and bound to (event, guest), with no signing key. A lookup by hash needs no constant-time compare. |
| Production URL live only while the workflow is active | n8n `live-webhooks.ts` vs `test-webhooks.ts` | **Borrow.** `registrationOpen` plus the activation window; outside it, every input gets the same neutral reply. |
| Bot filter | Form Trigger `ignoreBots` (`isbot`) | **Borrow the idea, not the dependency.** Reuse the helpdesk trap field and minimum fill time (`server/helpdesk.js:454-542`) and a short user-agent denylist. |
| Strict CSP on public pages | n8n `getHtmlSandboxCSP` | CORE's hash-based `pagePolicy` already matches it. `event.html` gets the same treatment. |
| Capacity counter plus FIFO of waiting promises | n8n `packages/cli/src/concurrency/concurrency-queue.ts` | **Borrow for the email outbox only** (capacity 1). **Reject for seats**: a seat request fails fast with a 409 and never waits in a queue. |
| Explicit `reserve()` and `release()` | n8n `concurrency-capacity-reservation.ts` | The model to follow if holds are ever added (an explicit release, never two per guest). Not built now. |
| Push abstraction and SSE handshake | n8n `push/abstract.push.ts`, `push/sse.push.ts` (a `connectionKey` replaces the older connection, 60 s ping, typed `{type,data}`, `X-Accel-Buffering: no`) | **Hold until after 9 Dec.** If it is added, copy these semantics, and push carries only `{seq}`. The typed change records already prepare for it. |
| Queue mode (Bull/Redis), multi-main pub/sub | n8n `push/index.ts` `shouldRelayViaPubSub` | **Reject.** A second process breaks single-writer atomicity and brings a pub/sub relay with it. |
| Credentials kept server-side | n8n credentials store | CORE already has `server/secrets.js` and the helpdesk SMTP. No new secret store. |
| Write contract: `nonce`, reason codes, `force` + `datetime` for late uploads | pretix check-in API | **Borrow** `opId`, typed refusals with the current `seq`, and `occurredAt` (on reconcile only). |
| Capacity counts every blocking claim; lock before the availability check | pretix quotas and locking | **Borrow** as `claimsAt()` inside the synchronous `commit()`. |
| Restrict which kiosk search fields exist | Cvent OnArrival | **Borrow.** No fuzzy search in public; partial search only behind sign-in. |
| Offline devices that accept the same guest twice | FooEvents and Ticketsolve warnings | **Avoid.** No device-side offline mode. Paper plus replay through `commit()`. |

### P2. Reuse inventory already in CORE

- `public/js/vendor/qrcode.js` (qrcode-generator 1.4.4) for the reception QR sheet.
- `shared/csv.js` (`parseCsv`, formula-safe export).
- `server/pdf/office-core.js` (`readZip`, `parseXml`) for an `.xlsx` reader of about 80 lines.
- `server/security.js` `pagePolicy`.
- `server/audit.js` (hash-chained) for spec s.13 events.
- `randomBytes(32).toString('base64url')`, as already used at `server/helpdesk.js:518`.

### P3. Technology radar for this event

| Ring | Items |
|---|---|
| Adopt | Short poll with `pollMs` and `since=seq`; a synchronous single-writer commit; typed 409s; `opId` |
| Hold | Long-poll; SSE (until after 9 Dec, then a trial for the next CUSTOM APP); WebSocket, Redis/Bull, clustering; device-side offline or a PWA; seat holds with a TTL |
| Reject | HMAC-signed URLs, IP allowlists for guests, fuzzy public search |

---

## Operations (Operator)

### O1. 28 Nov ops half-day (code, about 0.5 dev-day, merged before any Tier 0 push)

```bash
# remote-deploy.sh — the first line that does real work, before the unit reinstall and update.sh
if [ -f "$APP/data/DEPLOY_FREEZE" ] && [ -z "${DEPLOY_FREEZE_OVERRIDE:-}" ]; then
  echo "Deploys are frozen ($(cat "$APP/data/DEPLOY_FREEZE")). Nothing was changed."; exit 3
fi
# update.sh — before `systemctl stop`
rm -rf /opt/ltdc-erp-prev && rsync -a --exclude /data/ "$APP/" /opt/ltdc-erp-prev/
# /usr/local/sbin/ltdc-erp-rollback: stop; rsync -a --delete --exclude /data/ /opt/ltdc-erp-prev/ $APP/; chown/chmod as update.sh; start; health loop
```

- The workflow gets an optional `freeze_override` input, and the override is written to the
  audit log or devlog. Exit code 3 must show as a failed deploy job, never a silent one.
- The `unhandledRejection` logger and the `uncaughtException` log-then-exit, as in R1.
- Measurements over SSM, read-only:
  - `db.json` size;
  - 50 runs of `JSON.stringify` + `writeFileSync` on a copy, giving p50 and p95;
  - `free -m` and the instance type;
  - `aws ec2 describe-addresses` (an Elastic IP is needed before any resize).

### O2. Staging = restore drill = load target = warm standby (1–3 Dec, about 3 h operator time)

- Build staging with RESTORE.md §2 from the latest offsite copy, on the same instance type as
  production, with its own hostname and a certificate issued in advance.
- Before the first start, set `emailPaused=true` and point the SMTP at a sink address.
- Time each step. That is the measured RTO, and the target is under 30 minutes from "primary lost"
  to "staff on the standby URL".
- Keep it running until 10 Dec (about US$0.30 a day), and top it up from the newest offsite copy at
  T-3h on 9 Dec. The standby is for staff only; there is no QR redirect for guests.

### O3. Runtime levers (no deploy), each shown working on 5 Dec

`registrationOpen`, `emailPaused`, `pollMs` (returned in every poll reply) and `readOnly` (refuses
every commit except reconcile commands from the Super Administrator, and still serves reads). The
module kill switch already exists. Flag changes are Super Administrator only and audited.

### O4. Recovery point

At most 5 minutes on the box (the export copy, keeping the last 24) and at most 15 minutes off it
(offsite every 15 minutes during the window). On 8 Dec, after the last deploy, add a
`systemctl edit ltdc-erp-offsite.timer` drop-in with `OnCalendar=*:05/15`. Deploys reinstall the
unit but not drop-ins, and the freeze keeps it in place. It is removed on 10 Dec. The laptop pulls
the export every print cycle. The health strip shows the age of each copy.

### O5. Freeze

- The GitHub `production` reviewer gate is on from 7 Dec 18:00.
- `touch /opt/ltdc-erp/data/DEPLOY_FREEZE` at 8 Dec 12:00, removed 10 Dec 09:00.
- CI still runs on every push during the freeze, because the guard sits after the test gate.

### O6. Event-day runbook (in the CORE guide)

- **T-3h:**
  1. Confirm the freeze file and the gate are on.
  2. Check the offsite drop-in with `systemctl list-timers`.
  3. Run a manual offsite backup and confirm it in the Security monitor.
  4. Top up the standby.
  5. Smoke-test on the rehearsal guest: verify, check in, seat, status, email to the sink.
  6. Confirm the newest export is under 5 minutes old and the laptop has pulled it.
  7. Print the pack, every page stamped "as of HH:MM".
  8. Check staff devices: signed in, on 4G, charged.
- **Doors:** turn on `registrationOpen`. The on-call developer sits beside the Super Administrator
  with `ltdc-erp-rollback`, the runbook and the standby URL.
- **Act on any of these:**
  - 5xx on event routes above 1% for 2 minutes;
  - 2 failed external uptime checks in a row;
  - `save()` p95 above 250 ms;
  - the oldest pending guest waiting more than 3 minutes;
  - more than 5 email failures;
  - any red in the invariant self-check;
  - free disk under 1 GB.
- **Degrade ladder** (each step is reversible, and none needs a deploy):
  1. `pollMs` to 8 s for guests and 4 s for staff.
  2. `emailPaused`.
  3. `registrationOpen=false`, so check-in is staff-assisted only.
  4. Paper by owner partition, with `readOnly` on.
  5. Standby (staff URL only), then replay the paper sheets and the newest export as commands.

  **Never run RESTORE.md §1 while an event is `live`.**
- **Close:**
  1. Turn off `registrationOpen`.
  2. Take the final CSV and JSON export.
  3. Run a manual offsite backup.
  4. Set the retention date.
- **10 Dec, 09:00:**
  1. Remove the freeze file and the timer drop-in.
  2. Resize back.
  3. Snapshot staging, then decommission it.
  4. Start the PII purge clock.

### O7. Load tests (`scripts/event-load.mjs`, standard library only, one source IP, limits ON)

| Run | Profile | Pass |
|---|---|---|
| 1 (4 Dec) | 300 guest status pages at 4 s with jitter; 15–30 staff boards at 2 s; 40 verify-and-check-in in 10 minutes; a last-seat race on 3 contexts; one injected unhandled rejection | Zero 429s to real guests and staff; `save()` p95 under 100 ms; event-loop delay p99 under 200 ms; invariants clean |
| 2 (6 Dec, real list) | Run 1, plus `systemctl kill -s KILL ltdc-erp` at minute 5, plus a CORE Admin restore attempted while the window is open, plus a Super Administrator transfer | Staff back in, or on paper, within 3 minutes; no committed check-in lost (compared with the export taken just before); the event is untouched by the restore; the transfer takes under 2 minutes; reconciliation through commands gives zero violations |

**Cost:** under US$10 in total (the resize, staging and standby, offsite PUTs, and a free uptime
check).

---

## Quality Strategy (Craftsman)

### Q1. Principles

- The engine is a pure, synchronous `plan(state, cmd, actor, now)`. The hardest guarantees can
  therefore be tested in milliseconds without a database.
- **One** `checkInvariants()` runs in four places: after every engine test, after every fuzz step,
  at the end of the load script, and in the 60 s self-check in production. A checker test breaks
  each rule by hand, so the checker cannot be vacuous.
- About 120 focused tests that run alone in under 5 s (`npm run test:event`). Each test is written
  with its command, in the same commit.
- Tests assert refusal **codes**, never message text. A catalogue test fails if any code has no
  test that produces it.
- After the 6 Dec freeze, every fix lands with a test that failed before it.

### Q2. Test files by tier

| File | Key cases | Tier |
|---|---|---|
| `customapp-engine` | assign; `table_full` counting reserved seats; `seat_taken`; `not_eligible`; `stale` with fresh options; check-in once; preferred retrieval; release by an actor only; transfer keeps the old seat until the new one validates; swap atomic; group all or none; substitute moves the claim | 0 |
| `customapp-invariants` | each rule broken by hand is caught; `SEAT_STATUSES` is closed; no file other than `seating.js` counts by `seat.status` | 0 |
| `customapp-fuzz` | seeded random sequences of assign, check-in, release, transfer, swap, substitute, group, reclassify, deactivate and delegate over reserved and confirmed guests, wrong scopes and stale revs; zero holds; no release by expiry; refusals only from the catalogue; prints the seed (200 seeds in CI, 1,000 at freeze) | 0 |
| `customapp-api` | module gating; `mutation()` refuses async functions and thenables; typed 409s; `opId` replay is idempotent and a mismatch is refused; one audit entry per write; when save throws, the state is unchanged, nothing is audited and the reply is 503 | 0 |
| `customapp-restore` | restoring an older backup, "Erase all data" and demo data all leave the live `ca*` and `seq` untouched; standby case: no live events, so the backup's events are taken | 0 |
| `customapp-flags` | every flag is checked inside `commit()` or in the poll reply; `readOnly` refuses every mutation with `read_only` and still serves reads | 0 |
| `customapp-export` | export v1 matches a golden fixture; contains every claim; no PII beyond the agreed fields; the 5-minute writer uses the same function | 0 |
| `customapp-import` | header aliases; normalised surnames; last 4 derived; re-import idempotent; collision report finds every ambiguous pair and every guest with no contact; CR/LF stripped; formula-safe export | 0 |
| `customapp-process` | the `unhandledRejection` logger records and does not exit (spawned child process) | 0 |
| `customapp-race` | real sockets: 10 parallel requests for the last seat give one 200 and nine 409s; two parallel check-ins of one guest give one check-in; invariants `[]` (×5 at freeze) | 0 |
| `customapp-rank` | same > related > other industry; full and ineligible tables never listed; deterministic tie-break; group fit; scope filter | 1 |
| `customapp-scope` | Event staff see only CUSTOM APP; a CORE admin is not the Super Administrator unless designated; one owner per guest and table; a permission change applies on the next request; a reallocation leaves confirmed claims intact | 1 |
| `customapp-public` (limits ON, `TRUST_PROXY=1`) | 300 verifies plus polling from one `x-forwarded-for` give zero 429s while the soft cap still trips; zero saves on failure; byte-identical replies; window boundaries; cap of 8 distinct values in 15 minutes, a repeated value counts once, staff can clear it; alarm with no lockout; token of 32 bytes stored hashed, revocable, survives a restart; re-verify idempotent and flagged; no other guest's data in any reply; CSP hash present; the token never appears in logs | 1 |
| `customapp-sync` | `changes?since` returns only newer changes plus `pollMs`, and ignores `wait`; a reallocated staffer's next poll drops the old queue | 1 |
| `customapp-outbox` (`fakeSmtp`) | email sent after the save; an SMTP failure leaves the assignment intact; resend is a new attempt; `emailPaused` queues without sending; no address means not applicable | 2 |
| `customapp-reuse` | the acceptance-critical engine cases over YEP and "Test Gala" (capacity 8, no employee tables, no seat numbers); events are isolated; grep finds no YEP string in `server/customapp` | 2 |
| `customapp-acceptance` | the 12 named spec scenarios (Q3) | per row |

**Browser:** one "Event night, four devices" journey in `scripts/journeys.mjs` (a guest phone, two
staff phones and the Super Administrator's desk), landing with Tier 1. It covers:
- the last-seat contest, with the recovery screen checked by its visible text;
- one journey per guest verification state;
- the cap cleared at the desk in one action;
- refusal after a reallocation;
- "Import check" blocking "Open registration";
- nothing wider than 390 px.

### Q3. Acceptance traceability (spec section 07, the 5 Dec evidence pack)

| Spec scenario | Named test asserts | Green by |
|---|---|---|
| Preferred guest / no-show | reservation retrieved; blocked until manual release; a late arrival is referred | Tier 0 (1 Dec) |
| Manual alternative / all full | a manual alternative within authority; no allocation when no seat is eligible | Tier 0 |
| Duplicate / simultaneous check-in | one registration and one allocation per guest | Tier 0 |
| Last available seat | one concurrent assignment succeeds; the other gets `table_full` with fresh options | Tier 0 |
| Transfer / swap / release | counts update; no overbooking; no lost assignment | Tier 0 |
| Regular guest / no match | tables ranked by industry; other eligible tables shown when nothing matches | Tier 1 (3 Dec) |
| Unauthorised cross-scope | rejected; the Super Administrator can act or delegate; no duplicate ownership | Tier 1 |
| Ownership reallocation / absent staffer | the new owner gets the pending queue; the old owner loses write access; confirmed seats stay intact | Tier 1 |
| Employee / group arrivals | eligible employee tables; group fit; alternatives when the group cannot fit | Tier 2 (5 Dec) |
| Unlisted / substitute | an unlisted guest is approved, classified and audited; a substitute without a double allocation | Tier 2 |
| Email failure / no email | the assignment stays valid; the display works; a retry is available (or the email surfaces are hidden if email is cut) | Tier 2 |
| Connectivity / recovery | the printed pack covers every claim; paper re-entry by `opId` creates no duplicates | Tier 2 |

### Q4. Gates

- **Per edit:** `npm run test:event` in under 5 s, with fuzz at 50 seeds.
- **Per push:** the full `npm test` plus `npm run journeys`, as today.
- **Per tier:**
  - that tier's acceptance rows are green;
  - the version bump, devlog entry, guide, whats-new line and retaken screenshots land in the same
    commit (`test/guides.test.js`);
  - `customapp` is added to the modules tests (`modules-roadmap`, `favorite-modules`).
- **Freeze candidate (6 Dec):** fuzz at 1,000 seeds, the race test ×5, load test 2 green, and a
  tagged commit.
- **Review checklist for every event PR:**
  - no `await` in `engine.js` or `commit.js`;
  - every write goes through `mutation()`;
  - no capacity count outside `claimsAt()`;
  - refusals come from the catalogue;
  - any new rule is added to `checkInvariants()`;
  - tests assert codes, not text;
  - no YEP string in `server/customapp`.

---

## Tension Resolutions

| Tension | Agents | Resolution | Reasoning |
|---|---|---|---|
| Where event data lives: per-event `state.json` + `log.jsonl` vs shared `db.json` | Architect, Operator, Strategist, Scout, Skeptic | `db.json` `ca*` collections, with the A7 carve-out. Split into `data/customapp/<eventId>/` only if `save()` p95 is above 150 ms at the 30 Nov gate. | The two crossed over in Round 2 and converged in Round 3. A split would change the offsite allowlist (`offsite.js:265`), the cron, the restore check and RESTORE.md, none of it drilled, 12 days out. The carve-out closes the restore hazard that drove the split, following an existing precedent, in one line plus a test. |
| How to close the "Admin restore erases check-ins" hole: refuse the restore while a window is open vs keep live event data | Skeptic, Architect, Craftsman, Operator | Always keep the live `ca*` when the live data holds an event; take the backup's when it holds none (standby). A notice on the restore screen. RESTORE.md §1 is forbidden while live. | Skeptic accepted either option, provided it is a code guard and tested. Keep-live leaves the CORE restore usable for unrelated reasons. Craftsman showed that the existing `?.length` pattern would be wrong. Operator's standby edge case is covered by the "no live events" branch. |
| Event-only import / restore endpoint | Operator, Strategist, Skeptic, Architect | Won't before 9 Dec. The export JSON v1 format is frozen now, with a golden test. Recovery means the standby plus replaying commands through `commit()`. | A recovery tool built in a hurry, used only under pressure and able to overwrite live data is the bigger risk. Skeptic's "rehearse it or it does not exist" is met by drilling the path that does exist (standby restore plus replay) on 6 Dec. |
| Seat holds (`held`) | Scout, Craftsman, Strategist, Skeptic, Advocate | No holds. `seat.status ∈ {reserved, confirmed}`, counted by a status-agnostic `claimsAt()`, with a closed-enum test. | The spec marks holds optional. A single-request staff commit has no checkout window to protect, and a parked hold would block the last seat at peak. Counting claims rather than statuses removes the "forgot to count a status" bug class. |
| Live sync transport: long-poll vs SSE vs short poll | Architect, Scout, Operator, Strategist, Craftsman | Short poll on `changes?since=seq`, with `pollMs` from the server. The `wait` parameter is reserved. SSE on Hold until after 9 Dec. | Removes the 120 s `requestTimeout`, Caddy buffering and monitor-exclusion work. It is the same contract that n8n's waiting-form uses. `pollMs` doubles as Operator's load lever. |
| Guest verification strictness: Skeptic's hard caps, lockouts and "do not re-show the seat" vs Advocate's no dead ends | Skeptic, Advocate, Scout, Craftsman | Lenient deterministic normalisation with exact match; uniform referral reply; soft cap of 8 distinct wrong values per surname in 15 minutes, cleared at the desk in one tap; an alarm with no global lockout; re-verify shows the seat and flags staff. | The surname is not the secret; the last 4 and the activation window are. Every control fails toward the desk, never toward a lock screen. Advocate's distinct-value counting plus Skeptic's numbers satisfy both. |
| Presence key and desk code | Strategist, Skeptic, Advocate | The zero-typing QR key `k` is a Should: built in Tier 1 (XS), enabled only after load test 1 passes, and the first item dropped in a slip. A typed desk code is Could, built only if the client asks. | Skeptic and Advocate treat the window as the real control. Strategist values the key at XS. Gating it behind the load test keeps it off the critical path, and it costs guests nothing. |
| Status token transport: query `?t=`, header, or path `/s/<token>` | Architect, Scout, Advocate, Operator, Skeptic | Page: `history.replaceState` to the fragment `#s=<token>` plus a `localStorage` copy. API: the `X-Event-Token` header only. | A fragment is never sent to the server, so the token cannot reach monitor keys (which keep the path), Caddy or referrers, and a reload still works. It meets Architect's "never in the path", Scout's header and Advocate's reload-survives. |
| Size of the ops layer (Operator's event-grade list vs Strategist's XS) | Operator, Strategist | About 1 dev-day of code (the 28 Nov half-day plus flags, export copy and health strip folded into tier items), plus CI-free operator time. Cut: event import, snapshot engine, persisted sessions, QR redirect. | A restart at peak is the likeliest way the night fails, so the cheap guards come first. Everything at size M or on the critical path was deferred. |
| `readOnly` flag and the 60 s invariant self-check | Operator, Architect, Strategist | Both kept (XS each). | One line in `commit()`, used by the Super Administrator during reconciliation. The self-check is the same `checkInvariants()` that the load test and fuzz suite use. |
| Kill-switch set: `selfCheckIn` (Skeptic, Craftsman) vs `registrationOpen` (Architect, Operator) | Skeptic, Craftsman, Architect, Operator | Four flags: `registrationOpen`, `emailPaused`, `readOnly`, `pollMs`. `selfCheckIn` folds into `registrationOpen`. Once the window has opened, "closed" renders as the desk sentence (Advocate). | Both flags had the same effect on guests (go to the desk). One fewer flag means one fewer state to test and explain. Status polls keep working when it is closed. |
| Persisted staff sessions | Operator, Skeptic, Strategist | Not built. Mitigated by the freeze, the crash logger, an event-window sign-in allowance, staff on 4G, and a rehearsed re-login. | Changing the VAPT-hardened `auth.js` 12 days out is the bigger risk. Skeptic's condition (no freeze without the crash handler and the sign-in allowance) is met. |
| Refusal code vocabulary | Architect, Advocate, Scout, Craftsman | One frozen catalogue in `shared/customapp/refusals.js` (A6): 409 for state, 403 for authority, 503 for an unsaved change. | Four lists overlapped. One shared catalogue, with a test per code, lets the browser render recovery screens and stops drift. |
| File layout: `events/*.js` + `shared/seating.js` vs `engine.js` + `shared/customapp/*` | Architect, Craftsman | `shared/customapp/{statuses,refusals,seating,invariants}.js` and `server/customapp/events/{model,engine,commit,routes,changes,public,outbox,io}.js`. | Keeps Architect's bounded context and Craftsman's pure engine file. `claimsAt` lives in one shared file, which a source test makes the only counter. |
| Freeze dates and where the guard sits | Skeptic, Operator, Strategist | Code freeze 7 Dec 18:00 with the reviewer gate. `DEPLOY_FREEZE` from 8 Dec 12:00 to 10 Dec 09:00. The guard is the first line of `remote-deploy.sh`. | This is the superset of the proposals. The guard has to run before the unit reinstall, so it goes in `remote-deploy.sh`, not `update.sh`. |
| `uncaughtException`: Node's default exit vs log and exit | Operator, Skeptic | Log and record, then exit(1), and systemd restarts. | The same behaviour as the default, but with evidence. State after an uncaught exception is undefined, so it does not keep serving. |
| `save()` thresholds: 50 ms vs 100 ms | Craftsman, Operator, Strategist | 50 ms is the 28 Nov static trigger for the levers. 100 ms p95 under the load profile is the pass mark. 250 ms is the event-night alarm. 150 ms on 30 Nov triggers the split. | They measure different things, so all four are kept and each one is named. |
| Admin export of event PII | Architect, Skeptic (Guardian absent) | Left out while an event is live, unless "include events" is ticked (audited). Guardian sets the purge date. | Otherwise the full-backup download is a second copy of the guest list on someone's laptop. |
| Email (Must in Round 1) vs date pressure | Strategist, Advocate, Operator | Built as Tier 2 with a go/no-go on 3 Dec. `emailPaused` keeps the model intact either way. | Spec s.6 allows a verbal or on-screen notice. The "email failure" scenario must work without email anyway. |

## Decision Log

| Decision | Options Considered | Chosen | Reasoning |
|---|---|---|---|
| Shape of CUSTOM APP | One-off YEP module; generic app builder; thin module + `APPS` registry + parameterised event engine | Thin `customapp` module with one `events` app, parameterised by `eventId` | Event #2 reuses the engine as it is, for about 5% of the build. Abstraction is decided after 9 Dec, and only if a second client app exists. |
| Staff identity | Separate event logins; CORE accounts with event roles | CORE accounts; a new `eventstaff` account type (`customapp.use`); event roles and delegation are event data | Reuses sign-in, 2-step, sessions and audit. The user chose this in the interview. |
| Super Administrator authority | CORE `admin` `*`; an event field | `event.superAdminUserId` (exactly one); a CORE admin can only transfer it, audited, with re-authentication | The spec requires exactly one account, and `*` would create a second, invisible one. |
| Storage | Per-event files; `db.json` | `db.json` `ca*` collections, with a measured split gate on 30 Nov | Uses the backup and restore path that is already drilled; one source of truth. |
| Concurrency | Locks; Redis or queue mode; ETags only; a synchronous single-writer commit | Synchronous `commit()` with no await, plus `rev` and `opId` | Node's single thread makes check-and-write atomic. Tested by a grep, the `mutation()` guard, a race test and fuzz. |
| Capacity model | Stored counters; status-specific counts; `claimsAt()` over the guest seat | `claimsAt()` counts every claim; the seat is embedded in the guest | A count that is never stored cannot drift, and one seat per guest is structural. |
| Seat statuses | `reserved`, `confirmed`, `held` | `reserved` and `confirmed` only, as a closed enum | The spec requires reservations and makes holds optional. |
| Live sync | SSE; WebSocket; long-poll; short poll | Short poll with `pollMs` and `since=seq`; `wait` reserved | No new infrastructure; it is the lever under load and the n8n waiting-form precedent. |
| Guest identifier | Name only; a ticket QR per guest; surname + last 4 of mobile or the full email | Surname (normalised, exact) + last 4 digits, or the full email | Chosen in the interview. The last 4 characters of an email carry no information, so the full address is used. |
| Public failure reply | Specific errors; one uniform reply plus a referral code | Byte-identical reply with a random `R-xxx`, timing padded, the reason kept for staff | Resists enumeration and never leaves a guest at a dead end. |
| Brute-force control | Per-IP limits; a global lockout; a per-surname soft cap | 8 distinct wrong values per surname in 15 minutes, cleared at the desk; an alarm only, globally | A per-IP limit breaks the venue NAT, and a global lockout lets one script stop everyone. |
| Pre-arrival spoofing | Desk code; presence key; activation window | Server-enforced window; a presence key as a Should | The window is the real control and costs guests nothing. |
| Status token | Re-derive from the identifiers; a JWT; a random hashed token | 32 random bytes, stored as SHA-256, per device (at most 5), revocable; header on the API, fragment on the page | The n8n binding idea without a signing key; it never reaches logs. |
| Writes from public traffic | Persist attempts; keep them in memory | Only a successful verify writes; caps and referral codes live in bounded maps | Otherwise an attacker drives a whole-CORE `JSON.stringify` per request. |
| Rate limiting | Reuse `api-anon`/`public-write`; event buckets | Event buckets per event, surname and token; staff sign-in allowance for the window | The current limits stop check-in at about the 20th guest behind one IP. |
| Restore safety | A runbook line; refuse the restore; keep live `ca*` | Keep live `ca*` (with the standby branch), a notice, and a RESTORE.md §1 warning | A code guard with a test, which still leaves CORE restores usable. |
| Idempotency | None; `requestId`; `opId` | `opId` on every write, stored in `caChanges`, a map rebuilt at boot, mismatch refused | Covers Wi-Fi retries, double taps and paper re-entry (pretix nonce). |
| Refusal transport | Message strings; typed codes | `HttpError(status, msg, {code, fresh})` plus a frozen catalogue | The client re-renders recovery screens without a second call; tests assert codes. |
| Recommendation engine | Sequential fill; ML; a deterministic tiered score | Same > related > other industry; group fit, then gap fill, then a deterministic tie-break; "why" chips | There is no prior art to copy, so explainable and testable wins. `eligible()` is shared with `commit()`. |
| Email | Synchronous send in the request; an outbox with a FIFO drain | `caOutbox` with a capacity-1 FIFO outside `commit()`, retries, `emailPaused`, its own From and Reply-To; go/no-go 3 Dec | Assignment never waits on SMTP (n8n ConcurrencyQueue), and replies do not become helpdesk tickets. |
| Change history | Full before/after images; field diffs | A compact `caChanges` with field diffs (about 0.6 MB per event) | Keeps `db.json` growth and save cost small. One log serves history, sync, idempotency and the report. |
| Recovery artifact | Several export formats; one versioned JSON | `customapp.event/1` with `seq` and `sha256` | One format feeds the laptop, the 5-minute copies, the print pack, the standby and the v1.1 import. |
| Offline contingency | A device-side PWA; pre-partitioned ranges; paper by owner plus replay | Paper by owner partition, stamped "as of"; replayed through `commit()` with `via:'reconcile'` | Table ownership already partitions the seats. Replay keeps every invariant. |
| Kill switches | 3 to 6 flags | `registrationOpen`, `emailPaused`, `readOnly`, `pollMs` (plus the existing module switch) | Each is one check, shown working on 5 Dec, and none needs a deploy. |
| Deploy safety | A runbook freeze; a technical freeze | The `DEPLOY_FREEZE` guard in `remote-deploy.sh` plus the reviewer gate, a kept prior release, `ltdc-erp-rollback` | Every push restarts production today, and the guard must exist before the first Tier 0 push. |
| Crash resilience | None; persisted sessions; a process handler | An `unhandledRejection` logger that keeps serving; `uncaughtException` logs then exits | No handler exists, and Node 22 exits on an unhandled rejection. |
| Standby | None; a guest QR redirect; a staff-only warm standby | Staging restored from S3 = drill = load target = standby (staff URL only) | One box gives three uses for under US$5, and the RTO is measured. |
| Delivery plan | Big bang; three event-ready tiers | Tier 0 on 1 Dec, Tier 1 on 3 Dec, Tier 2 on 5 Dec; freeze from 7 to 8 Dec | A slip costs a feature, never the event. |
| Testing | A large suite with coverage targets; focused tests plus an invariant oracle | About 120 tests in under 5 s; one `checkInvariants`; 12 named acceptance tests; fuzz; a race test; a limits-ON single-IP test; 2 load tests and a chaos drill | Proves the guarantees cheaply; the acceptance tests are the client's evidence pack. |
| n8n usage | Copy code; use it as a dependency; borrow patterns | Patterns only: Form Trigger `onReceived`, the waiting-form status poll, the token binding, ConcurrencyQueue for email, live-vs-test webhook gating. Rejected: queue mode, multi-main, push for now | CORE has no dependencies, and anything that adds a second process breaks atomicity. |
| Guides | None; ATLAS guides; a CORE guide | `docs/guides/custom-app-events.md`, whats-new and screenshots in each tier commit | CORE's `test/guides.test.js` requires it, and the guide is also the event runbook and desk card. |
