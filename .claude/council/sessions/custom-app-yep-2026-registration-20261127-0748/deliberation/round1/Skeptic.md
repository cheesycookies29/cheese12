# Skeptic Position: CUSTOM APP / YEP 2026 Registration and Table Assignment

**Lens:** red. Pre-mortem, attack surface, Swiss cheese, Chesterton's fence.
**Grounding:** spec.txt, interview summary, codebase map, plus direct reads of `server/api.js`
(rate limiter buckets ~554, request path ~1433), `server/auth.js` (`createSessions`),
`shared/roles.js` (`userCan`), `server/security.js` (session policy), `server/db.js` (`save`),
`server/helpdesk.js` (public form, IMAP mailbox), `.github/workflows/deploy-ec2.yml`,
`deploy/aws/update.sh`.
**n8n caveat:** the n8n repository is not present in this workspace and could not be read. Every
n8n reference below is from model knowledge and is marked *(unverified)*.

---

## Core recommendation

The concurrency story is the easy part. Node's single thread plus a synchronous validate-then-write
handler gives the "last seat, only one wins" guarantee almost for free. The real event-day failures
hide in CORE's existing safeguards, which were built for an office ERP, not a ballroom with
300 phones on one Wi-Fi address:

- the per-IP rate limits would lock the guest page after about 20 guests;
- CORE admins' `*` permission breaks "exactly one Super Administrator";
- sessions are held in memory, so any restart signs every staff device out at peak.

Fix those three before building any feature. Then make one pure "plan, validate invariants, apply,
save" function the only path that can change a seat.

## Key argument

Pre-mortem: it is 9 December, 18:40, and arrivals are peaking. Here is how it fails.

1. **Venue NAT.** Guests on the venue Wi-Fi share one public IP. `server/api.js:1447` charges every
   non-GET `/api/public/*` call to the global `public-write` bucket (20 per hour per IP), and every
   signed-out GET to `api-anon` (120 per minute per IP). Guest 21 gets "Too many messages from this
   network". If 300 guests each poll their status every 5 seconds, they generate about 3,600
   requests a minute, so the pending-status screen dies within seconds.
2. **Staff logins share the same address.** `auth` (20 per minute per IP) and `signin-fail`
   (20 per 15 minutes per address) apply to staff on that Wi-Fi too. Fifteen staff re-signing in
   with password and 2-step after a restart is about 30 auth hits, which trips the limit.
3. **Restarts lose every session.** `createSessions` keeps sessions in a `Map` in memory, and
   `update.sh` does `systemctl stop`/`start`. Any deploy, crash or out-of-memory restart signs every
   staff device out at once. Then the NAT limits in step 2 lock them out.
4. **Pushes reach production.** Every push to `claude/busy-curie-hfpbg0` runs the deploy pipeline,
   and other sessions push to this branch. The 0.38 approval gate (`environment: production`) is
   the only thing between a routine commit and an event-day restart.
5. **Too many unrestricted accounts.** `userCan` returns true for `role: 'admin'` on any permission.
   If event authority is modeled as a CORE permission, every CORE admin is a second unrestricted
   Super Administrator. The spec forbids that in sections 1, 11 and 13.
6. **Shared database, shared save.** `db.save()` pretty-prints the whole shared `db.json`
   synchronously on every mutation. At arrival bursts, the event loop stalls on saves. Staff
   double-tap. Without idempotency keys, a double-tap after a slow response becomes a second
   mutation: a transfer applied twice, or a group confirmed twice.

None of these is a seating-logic bug. All of them would pass a unit-test suite that calls `handle()`
directly. They show up only under a single-IP, multi-device load test run on a production-sized
copy of the data.

## Risks if ignored

- **Critical (availability): the guest page and staff sign-in are rate-limited per IP behind venue
  NAT.** Check-in halts after about 20 guests, and status polling is refused.
  *Mitigation:* event-specific limiter buckets keyed by event and verification attempt, not IP alone.
  Exempt CUSTOM APP's public routes from the global `public-write` bucket. Key status polling by
  status token. Raise or venue-allowlist `auth`/`signin-fail` for the event window, Super
  Administrator controlled and audited. Run the load test from one IP.
- **Critical (authorization): CORE `admin` = `*` is a hidden second Super Administrator.**
  *Mitigation:* event authority is event data, not a CORE permission.
  - `event.superAdminUserId` (exactly one) and `delegations[]` are checked by the module's own
    `eventCan(user, event, action, target)`.
  - CORE permission `customapp.use` only opens the module. CORE admins get no guest or table write
    authority.
  - A CORE admin's only power is an audited "transfer Super Administrator" action (2-step required,
    reason mandatory). The old holder loses authority in the same write. This is also the spec's
    "secure recovery without a second unrestricted account".
- **Critical (operations): an event-day restart wipes all staff sessions.** Caused by any deploy,
  including an accidental approval, or by a crash.
  *Mitigation:*
  - A technical freeze from 8 Dec 18:00 to 10 Dec: disable the workflow or add a required reviewer
    with a wait timer. A promise is not a freeze.
  - Rehearse "restart at peak" and "re-login of all staff".
  - Guest status tokens must persist in the database, not in memory.
  - Persisting staff sessions across restarts is the better fix, but it changes CORE auth 12 days
    out. Weigh it with Architect and Guardian.
- **High (integrity): atomicity holds only if the critical section has no `await`, and only if
  save failures are handled.**
  *Mitigation:*
  - One synchronous `commit(event, plan)`: re-read state, check permissions and revs, check every
    invariant on the candidate state, apply, `db.save()`. Email, file I/O and any `await` happen
    after the commit.
  - Idempotency key (`clientOpId`) on every mutation; a repeat returns the first result.
  - Per-guest and per-table `rev`; the client sends `expectedRev`, a mismatch returns 409 and
    refreshes.
  - Measure production `db.json` size and `save()` time now. If it is over about 50 ms, consider
    a separate `data/customapp.json` store. Offsite backup currently copies only `db.json` and the
    audit files, so that needs Operator work.
- **High (privacy and spoofing): the surname + last-4 page can be probed and can check in someone
  else.**
  *Mitigation:*
  - Identical response for no match, ambiguous match and locked-out: "Please see the registration
    desk".
  - Per-event global failure cap plus a per-surname cap.
  - A random status token in the response (stored hashed). Never a guest id.
  - The status page shows first name, table and seat only.
  - A second self-check-in for an already-arrived guest flags staff; it does not silently show the
    seat.
  - Registration activation toggle with an automatic time window.
- **High (scope): the spec's "Core" list is large for 12 days.** If the acceptance scenarios are
  not automated by about day 8, the event runs on untested transfer, swap and substitution paths.
  *Mitigation:* cut seat holds, seat numbers for non-preferred guests, SSE push and the graphical
  layout. Keep the invariant checker, polling with a revision counter, and the printable fallback.

## Dependencies on other domains

- **Architect:** event-scoped authority model (no CORE `*` bypass); the single `commit(plan)`
  mutation path; per-record `rev` and `clientOpId`; decision on a separate data file versus shared
  `db.json`; polling with a `since=rev` change feed rather than SSE (SSE adds long-lived
  connections, a reconnect storm after restart, and session-touch questions, for little gain at
  300 guests).
- **Operator:** technical deploy freeze; measuring production `db.json` save time; venue network
  (venue Wi-Fi plus a 4G backup router, and the egress IP known in advance); backup right before
  doors open; a restart-at-peak drill; offline packet printing and its custody.
- **Tuner:** single-IP load model (300 guests polling plus 10 to 15 staff, with a save on each
  mutation); poll intervals with jitter and backoff.
- **Guardian:** PII in the hash-chained audit log cannot be purged later without breaking the
  chain, so audit labels should use guest ref/id, not mobile or email. Also a post-event retention
  and purge policy, and control of printed lists.
- **Craftsman:** all 12 acceptance scenarios as `node --test` interleaved `handle()` cases; a
  property test that runs random operation sequences and asserts the invariants after each step;
  plus a Playwright multi-context journey.
- **Strategist:** confirm the cut list (no holds; seat numbers for preferred guests only; no SSE)
  with the client.
- **Scout:** n8n lessons below are *(unverified)*; please confirm with a real fetch if possible.

---

## Appendix A: Threat model (STRIDE)

### Trust boundaries

```
 Internet / venue Wi-Fi (one NAT IP)                     EC2 (Caddy TLS -> single Node process)
 ┌───────────────────────────┐                         ┌────────────────────────────────────────┐
 │ Guest phone (no account)  │──/event/<code> page────▶│ public routes /api/public/event/*      │
 │  surname + last4 / email  │──status poll (token)───▶│   -> limiter -> verify -> status token │
 └───────────────────────────┘                         │                                        │
 ┌───────────────────────────┐                         │ CORE session + 2-step                  │
 │ Staff device (CORE acct)  │──/api/customapp/*──────▶│   -> eventCan(user,event,act,target)   │
 │ Super Admin device (1)    │──same + admin actions──▶│   -> commit(plan): invariants, save    │
 └───────────────────────────┘                         │ db.json (shared with all of CORE)      │
 ┌───────────────────────────┐                         │ audit-log.jsonl (hash chain)           │
 │ CSV/Excel import file     │──upload───────────────▶│ outbox -> SMTP (helpdesk transport)    │
 └───────────────────────────┘                         └───────────────┬────────────────────────┘
                                                                        │ email (guest inbox)
 Paper: printed seating plan/guest list (offline)                       ▼  replies -> helpdesk IMAP?
```

### Threat table

| STRIDE | Threat | Risk | Mitigation | Status |
|---|---|---|---|---|
| Spoofing | Someone who knows a colleague's surname and the last 4 digits of their mobile (a shared office line, or seen on a business card) checks in as them remotely, before arrival. | High | Activation toggle plus automatic window (doors-open to close). A repeat self-check-in flags staff and does not re-show the seat. The preferred express result says "show this screen at the desk". Optional: a rotating 4-digit desk code shown on the reception screen and required on the form (P1). | Open |
| Spoofing | A CORE admin acts as a second Super Administrator through `userCan` `*`. | Critical | Event authority comes from event data; CORE admins can only transfer the Super Administrator designation (2-step, reason, audit, atomic revoke). | Open |
| Spoofing | Staff share one account or one tablet, so audit actor attribution is meaningless. | Medium | One account per person. An event-staff role with only `customapp.use`. The device list is visible to the Super Administrator. | Open |
| Tampering | Stale client writes: the old owner keeps writing after a reallocation, or a cached queue confirms a seat already taken. | High | Every write re-checks `eventCan` and the current owner at commit time. `expectedRev` returns 409 on mismatch. Permission changes take effect immediately because `api.js:1440` re-reads the user on each request; the module must re-read delegations too, with no caching. | Open |
| Tampering | A double-tap or retry after a slow response applies a transfer or group twice. | High | `clientOpId` idempotency map, kept 24 h per event and returned on replay. Buttons are disabled while the request is in flight. | Open |
| Tampering | Re-importing CSV during the event overwrites live assignments, check-ins or ownership. | High | Import is merge-by-external-ref with a dry-run diff. It never touches status, seat or ownership fields once the event is "live". It is Super Administrator only and audited. | Open |
| Tampering | Header or body injection in emails: CR/LF in an imported name or company. | Medium | Strip control characters on import and edit. Use `composeMessage` encoded words; never put a name in a raw header. | Open |
| Repudiation | Overrides, releases and transfers without reasons. | Medium | `audit.record` for each with actor, reason (required for override, release and cross-scope), before and after. Plus an event change-history collection for the spec's "approval and change history". | Open |
| Info disclosure | The public verify response differs (no match versus two matches versus inactive), which allows enumeration of guest surnames. | High | Single uniform message and status code. Similar timing (no early return before the limiter). No names in errors. | Open |
| Info disclosure | The status endpoint keyed by guest id or a sequential code leaks other guests' tables. | High | 32-byte random token, stored as SHA-256, scoped to one guest. Returns only first name, table, seat and state. `Cache-Control: no-store`. | Open |
| Info disclosure | Staff "read-only overall availability" view exposes mobiles and emails of out-of-scope guests. | Medium | Out-of-scope rows show name, company, industry and table only. Contact fields are only in scope. Exports are Super Administrator only. | Open |
| Info disclosure | CSV export opened in Excel runs formulas (`=HYPERLINK(...)` in a company name). | Medium | Prefix cells starting with `= + - @` and tab/CR with `'` on export (check `shared/csv.js`). | Open |
| Info disclosure | Guest replies to the assignment email land in the helpdesk IMAP mailbox and become IT tickets, with PII. | Medium | Use a separate From or Reply-To (an events address), or no-reply plus "speak to the desk". Confirm with Operator. | Open |
| Info disclosure | PII in the hash-chained audit log cannot be removed after the event. | Medium | Audit labels use guest ref and a masked name. Contact data lives only in the guest record, which can be purged. | Open |
| DoS | Per-IP limits behind venue NAT lock out guests and staff (see Key argument). | Critical | Event buckets plus venue allowance, load-tested from a single IP. | Open |
| DoS | Brute force on surname + last-4: about 10,000 combinations per known surname. | Medium | Per-event cap on failed verifications per surname (for example 5 per 10 minutes, then "see desk"). Global failure-rate alarm to the Super Administrator. | Open |
| DoS | Large or zip-bomb Excel import blocks the event loop. | Medium | Size cap (for example 2 MB), row cap (for example 2,000), parse before going live, Super Administrator only. | Open |
| DoS | Synchronous whole-file save of a large shared `db.json` on each mutation, during a burst. | High | Measure now. Separate store if slow. Saves stay synchronous; do not batch them (durability). | Open |
| Elevation | Group or cross-scope transfer by non-Super Administrator staff passes because only the first guest's scope is checked. | High | `eventCan` checks every guest and every destination table in the plan. Any out-of-scope element rejects the whole plan. | Open |
| Elevation | Delegation to two people at once through a race between two reallocation requests. | Medium | Ownership is a single field (`ownerUserId`) on guest and table. Reallocation is a commit with `expectedRev`. Invariant "at most one owner" is structural. | Open |
| (n8n) | Public form/webhook body-parsing confusion. From model knowledge *(unverified)*, n8n had a critical 2026 advisory in its form/webhook handling caused by content-type confusion. | Medium | The guest route accepts only `application/json` and small bodies. No multipart, no file fields, no echo of request fields. | Open |

### Residual risks (accepted)

- **Remote check-in with real knowledge of a guest's surname and phone digits.** Accepted, because
  arrival is confirmed physically at the desk or table and a duplicate attempt is flagged.
  Monitored through the Super Administrator's "repeat attempt" alerts.
- **One Super Administrator is a single point of failure.** It is a spec requirement. Accepted,
  with a rehearsed CORE-admin transfer procedure (target under 2 minutes) and the Super
  Administrator's ability to reallocate queues in bulk.
- **Restart loses staff sessions** (if sessions are not persisted). Accepted only with a tested
  freeze and a rehearsed re-login. Monitored by uptime checks on the event day.

---

## Appendix B: Edge case enumeration

### Input edge cases

| Input | Edge case | Expected behavior | Priority |
|---|---|---|---|
| Surname | "Dela Cruz" / "dela cruz" / "De La Cruz" / "Dela-Cruz" | Normalize: NFKD, strip diacritics, lowercase, remove spaces, hyphens and dots. All four match. | P0 |
| Surname | "Ñ", accents, surname-first order (Chinese names), married versus maiden names | Normalized match. Failure goes to the desk, not an error. Import can store `altSurnames[]`. | P1 |
| Surname | Empty, whitespace only, 500 characters, emoji, zero-width characters | 400 with the same uniform desk message. Length cap 80. | P0 |
| Last-4 | Mobile stored as "+63 917 123 4567", "09171234567", "917-123-4567" | Compare the last 4 of the digits-only form. | P0 |
| Last-4 | Guest has no mobile and no email | Cannot self-verify, so the page always routes to the desk. The dashboard counts these in advance. | P0 |
| Last-4 | Two guests share surname and last-4 (shared corporate line) | Ambiguous, so uniform desk message. Never pick one. | P0 |
| Email option | "Last 4 of email" is ambiguous | Use the full email, normalized and lowercased, instead. Confirm with Strategist and the client. | P1 |
| Import | Duplicate rows, a missing classification, unknown industry, table 11+ for a 10-seat table, BOM, `;` delimiter, Excel serial dates | Dry-run report listing every problem. Nothing is applied until it is clean or acknowledged. | P0 |
| Table number | Renumbering a table whose guests have already been notified | Block while it has assignments, or require re-notify of everyone affected (audited). | P1 |
| Capacity | Setting capacity to 11, 0, or below the current count | Hard maximum 10; never below current count plus reservations. | P0 |

### State edge cases

| State | Edge case | Expected behavior | Priority |
|---|---|---|---|
| Empty | No tables or industries configured when registration is activated | Activation is refused until preflight passes (tables, a Super Administrator, every guest with an owner or routed to the Super Administrator). | P0 |
| Partial | Guest checked in but owner revoked before seating | The guest moves to the new owner's queue, or to the Super Administrator's if there is none. Check-in is kept. | P0 |
| Full | All eligible tables full for a classification | No allocation. Alert, refer to the Super Administrator, offer reclassification of a table. | P0 |
| Full | Group of 6 with a maximum of 4 free on any eligible table | Show alternatives. Split only with explicit staff confirmation; each member is still individual. | P0 |
| Stale | Preferred reservation released, then the guest arrives | Status "referred for reassignment". Never silently re-seat at the old seat if it has been taken. | P0 |
| Stale | Substitute recorded while the original is also checked in | Only one may consume the seat. The second check-in is flagged to the Super Administrator. | P0 |
| Correction | "Undo check-in" for a preferred guest | Revert arrival only. The reservation stays, because releasing it is a separate action. | P1 |
| Deactivate table | Table with active assignments or reservations | Refused unless a relocation plan for every guest commits atomically first. | P0 |

### Concurrency edge cases

| Scenario | Edge case | Expected behavior | Priority |
|---|---|---|---|
| Last seat | Two staff confirm the last seat in the same tick | One commit wins. The other gets 409 plus fresh options (spec section 16). | P0 |
| Duplicate check-in | Guest self-checks in on a phone while staff assist at the desk | One check-in record. The second returns "already checked in" without creating another. | P0 |
| Swap | A swap between tables A and B while a third party assigns into A | Swap is validated on post-swap counts in one commit. Either the swap or the assign fails, never both succeed over capacity. | P0 |
| Transfer | Destination becomes full between preview and confirm | Transfer rejected; the original assignment is untouched ("secure replacement first"). | P0 |
| Double submit | Retry after timeout | `clientOpId` replay returns the first result. | P0 |
| Super Administrator versus staff | Super Administrator reassigns a guest while the owner confirms a seat | `expectedRev` on the guest; the second write gets 409 (the spec says "including Super Administrator actions"). | P0 |
| Reallocation | Old owner's open tab keeps sending writes after reallocation | 403 at the server on the next write. The UI refreshes on the next poll. | P0 |
| Deploy | Request in flight during a restart | The client retries with the same `clientOpId`. The server has either the saved result or nothing. | P1 |

### Temporal edge cases

| Scenario | Edge case | Expected behavior | Priority |
|---|---|---|---|
| Time zone | Server in UTC, event in Asia/Manila (UTC+8); check-in times and the "today" window | Store ISO UTC; show Manila time. The activation window is stored as instants. | P1 |
| Session | Staff session idle limit (default 480 minutes, configurable to 5) or 24 h maximum during a long event | Confirm the production policy. Staff sign in less than 24 h before doors. A rehearsed re-login. | P1 |
| Session | Session expires mid-confirm | 401; the client keeps the draft and retries the same `clientOpId` after re-login. | P1 |
| Status token | A guest closes the browser tab and loses the token | Re-verify works and returns the same state, or the desk looks it up. Token stored in `localStorage` as a convenience only. | P1 |
| Email | SMTP down for 20 minutes | Seating stays valid. The outbox retries with backoff, and status per message is shown with a resend button (pattern from n8n-style concurrency-limited execution queue, *unverified*). | P0 |
| Offline | Connectivity lost for 15 minutes, with paper allocations by pre-partitioned ranges | Reconcile by a single authority entering them online in one place. Conflicts go to the Super Administrator. Invariants are re-checked. | P0 |

### Permission edge cases

| Scenario | Edge case | Expected behavior | Priority |
|---|---|---|---|
| Role transition | Staff member's CORE account deactivated mid-event | `api.js:1440` drops them on the next request. Their queue is reallocated by the Super Administrator. | P0 |
| Super Administrator recovery | Super Administrator phone dies or loses 2-step | CORE admin transfer to the designated standby (2-step and reason). The old holder is revoked in the same write. Never two holders at once. | P0 |
| CORE admin | IT admin opens CUSTOM APP | Read-only plus "transfer Super Administrator"; no seat writes. | P0 |
| Read-only view | Staff view overall availability | No contact fields for out-of-scope guests. Write buttons are absent, and the server refuses anyway. | P1 |
| Cross-scope group | Group members owned by two staff | Only the Super Administrator, or after a formal reallocation of all members to one owner. | P0 |
| Module switched off | Admin panel turns CUSTOM APP off during the event | The `MODULE_API` regex blocks non-admins. Require Super Administrator confirmation, or lock the switch while an event is live. | P1 |

---

## Appendix C: Invariants (assert after every commit, in tests and in production)

Checked on the candidate state inside `commit()`. If any fails, the commit throws before
`db.save()`, so in-memory state is never mutated unless it is valid (build a plan, validate, then
apply).

1. For every active table, confirmed assignments + active reservations (+ holds, if any) <= capacity <= 10.
2. A guest has at most one active assignment or reservation. A seat has at most one occupant.
3. Original and substitute never both consume a seat.
4. Every guest and every table has at most one owner. There is exactly one Super Administrator per
   event.
5. A checked-in guest is in exactly one of three states: seated, in a queue (owner or Super
   Administrator), or referred.
6. Seated implies the guest is eligible for that table's classification (unless the Super
   Administrator override is recorded).

Expose `GET /api/customapp/events/:id/health` to the Super Administrator. It runs the invariants on
demand and shows any violation in red on the dashboard, a last layer of the Swiss cheese.

## Appendix D: Failure modes beyond security (summary)

| Failure | Effect | Mitigation |
|---|---|---|
| Venue Wi-Fi down | Guests cannot reach the page | 4G router for staff; the desk processes guests assisted; printed packet. |
| EC2 or process crash | All down; sessions lost | Uptime alarm; systemd restart; persisted tokens; re-login drill; offline packet. |
| `db.json` write failure (disk full) | Mutation lost after restart | Check free disk in preflight; `save()` throwing returns 500 to the client (no false success). |
| Load test run against production | ERP users disrupted; data polluted | Load test on a restored copy of production data on a separate instance or port. |
| SMTP provider throttle (for example about 30 per minute) | Delayed emails | Outbox with concurrency 1–2 and backoff; the on-screen display is the primary channel. |
| Event-day code fix needed | Restart during the event | A Super Administrator-reachable config toggle instead of code; hotfix only in a lull, with announcement. |
