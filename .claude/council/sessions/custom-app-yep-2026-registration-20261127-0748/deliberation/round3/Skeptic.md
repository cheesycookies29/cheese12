# Skeptic Final Position: CUSTOM APP / YEP 2026 Registration and Table Assignment

**Lens:** red. Pre-mortem, attack surface, Swiss cheese, Chesterton's fence.
**Re-checked for this round:** `server/api.js` (limiter buckets at 556-562, `signin-fail` keyed by
`client.ip` at 648-688, `signInFailuresPerAddress` is a security setting, not a constant),
`server.js` and `server/*.js` (no `unhandledRejection` or `uncaughtException` handler anywhere).
**n8n caveat:** the n8n repository is not in this workspace. Any n8n reference here is from model
knowledge and is marked *(unverified)*.

---

## Revised recommendation

The council has converged on mechanics I can sign: one synchronous `commit()` per event, a
status-agnostic `claimsAt(table)`, `reserved` and `confirmed` claims with no holds, short polling,
kill-switch flags checked inside `commit()`, and a soft, desk-forgiving guest verification. I no
longer see a seating-logic risk that should block the plan.

The risks that remain are all in CORE's **existing** safeguards, which were built for an office
ERP and not for a ballroom on one NAT address:

- per-IP limits on guest pages and staff sign-in;
- the CORE `admin` `*` bypass;
- a process that dies on the first unhandled promise rejection;
- an Admin "Restore a backup" that can silently erase check-ins;
- a deploy pipeline that restarts production on any push.

Each of these must be closed **in code or in config**, then proven by the single-IP load test and
the 6 Dec chaos drill. A runbook promise does not count. If those five are closed, I accept the
rest of the risk register as tolerable for 9 December.

## Concessions made

1. **Holds are out (Scout, Strategist).** I had already cut them in Round 1, and the council's
   argument is now stronger than mine: a single-request staff commit has no checkout window to
   protect, and a parked hold would block the last seat at peak. A lost last seat is a 409
   `seat_taken` with fresh options. `reserved` stays, with no expiry, released only by hand
   (spec s.8, s.10).
2. **No hard lockouts (Advocate).** A per-surname lockout lets one person block "Dela Cruz" at the
   door. It becomes a soft cap: **8 distinct wrong last-4 values per (event, normalised surname) in
   15 minutes**. Retyping the same wrong value counts once. The cap clears itself after 15 minutes
   or in one tap at the desk. There is no per-event global lockout; a high failure rate alerts the
   Super Administrator and never blocks.
3. **Re-verify shows the seat (Advocate).** I withdraw "a second self-check-in does not re-show
   the seat". A spoofer learns only a table number on the first try anyway, and hiding it punishes
   the real guest on a second phone. Re-verify is idempotent: same status, no scolding, no second
   check-in, and a "verified again from another device" flag for staff.
4. **Lenient normalisation (Advocate).** The surname is not the secret; the last 4 and the
   activation window are. NFKD, strip diacritics, lowercase, drop spaces, hyphens, periods and
   apostrophes, strip Jr./Sr./III, match `altSurnames[]`. My condition stands: matching stays
   **exact** on the normalised form.
5. **Referral codes (Advocate).** Accepted, because they are compatible with my uniform-reply rule
   if every failure is byte-identical apart from the random code.
6. **No desk code or presence key for 9 Dec.** The server-enforced activation window is the real
   control against remote pre-arrival spoofing. Both stay Won't unless Strategist finds an XS slot
   after the 5 Dec load test, and then Advocate's zero-typing rotatable QR key is preferred over a
   typed desk code.
7. **No SSE, no long-poll.** Short polling paced by a server-supplied `pollMs` is the lowest-risk
   live sync: no long-lived connections, no reconnect storm after a restart, no session-touch
   questions.
8. **No persisted staff sessions.** Changing VAPT-hardened `auth.js` 12 days out is a bigger risk
   than the one it removes. I accept "restart signs every staff device out", but only with the
   technical freeze, the crash handler and the venue sign-in allowance below. A freeze without them
   means one unhandled rejection at 18:40 signs out all staff, and then the per-IP sign-in limit
   locks them out.
9. **Storage location: not my call, but one condition (Architect vs Operator).** Both options are
   acceptable to me. What I will not accept is any path where a CORE-wide restore can silently
   overwrite live event data:
   - **Per-event store (Architect):** this closes the `db.replace` hazard structurally, because a
     full CORE restore does not touch `data/customapp/`. The cost is offsite, cron and restore-check
     changes, which must be drilled on 6 Dec.
   - **Shared `db.json` (Operator):** this is the smaller change, but it needs a **code guard**, not
     a runbook line. The Admin restore (`api.js:1314`) must refuse while any event window is open,
     unless a CORE admin re-enters their password and types the event code to confirm. It must be
     audited, and a test must prove that a CORE restore cannot change an event's `seq` without that
     confirmation.
   Whichever wins, the event-only restore must be rehearsed end to end before 7 Dec. If it has not
   been rehearsed, it does not exist.
10. **Ops scope trimmed (Operator, Strategist).** Event-only import as a separate feature, on-box
    snapshot tooling beyond the 5-minute copies, warm standby and persisted sessions are deferred.
    The cheap items (freeze guard, kept prior release, crash logger, flags in `commit()`, invariant
    check, `save()` measurement on 28 Nov, laptop export pulls) cover the failure modes I care
    about.

## Non-negotiables

These must be in place before the event is activated. Each has a test or a drill that proves it.

| # | Safeguard | Proof |
|---|---|---|
| N1 | **Event authority is event data.** `event.superAdminUserId` (exactly one) plus delegations, checked by `eventCan(user, event, action, target)`. CORE `admin` `*` grants no guest or table writes. A CORE admin's only event power is an audited "transfer Super Administrator" (2-step, reason, old holder revoked in the same commit). | Unit test: a CORE admin's seat write returns 403; a transfer leaves exactly one Super Administrator. |
| N2 | **One mutation path.** Every seat, owner or status change goes through the synchronous `commit()`: re-read the user and delegations, check `expectedRev` and `clientOpId`, check flags, build the candidate state, check invariants I1 to I6 (Round 1 Appendix C), apply, persist. **No `await` between check and write.** If the persist step throws, undo in memory and return 503, never a false success. | Lint-style test that no handler mutates event state outside `commit()`; save-failure test. |
| N3 | **Capacity counts every claim.** A single `claimsAt(table)` counts every status that occupies a seat, every handler calls it, and a test fails when a new status is added without being classified. | Status-exhaustiveness test plus the fuzz suite (random ops, invariants after each step, zero holds, no expiry release). |
| N4 | **Idempotency and staleness.** `clientOpId` replay returns the first result (kept 24 h per event). Per-guest and per-table `rev`; a mismatch returns 409 with a stable code and fresh options. This also applies to Super Administrator actions. | Interleaved `handle()` tests for all 12 acceptance scenarios, including double-tap and last seat. |
| N5 | **No per-IP limits on legitimate guests or staff at the venue.** Event public routes leave the global `public-write`/`api-anon` buckets and get their own limiter, keyed per event, per surname (failures) and per status token (polls), with a high per-IP ceiling sized for one NAT address. Staff sign-in: raise `signInFailuresPerAddress` (a setting, so no code change) or allow the venue's known egress IP for the event window, audited. | Single-IP load test, 4-5 Dec: 300 guest pollers plus 15 staff, with a "restart at peak, all staff re-sign in" step. **Zero 429s** to real guests and staff. |
| N6 | **Uniform guest failure reply.** No match, ambiguous, capped, malformed, unlisted and window-closed-mid-request all return the same status code, copy and layout, with timing padded to the success path, plus a random referral code from one pool. The real reason is visible to staff only. | Test comparing response bodies minus the code; timing parity measured under load. |
| N7 | **Activation window enforced on the server.** Before doors-open the page shows "Registration opens at 6:00 PM" and accepts no input; verify routes refuse. The Super Administrator can open it early or close it, audited. | Unit test on the window boundaries (stored as UTC instants, shown in Asia/Manila). |
| N8 | **Status token.** 32 bytes random, stored as SHA-256, per device, scoped to one guest, revocable by staff, persisted with the event (survives a restart). Responses carry `Cache-Control: no-store` and only title or first name, table, seat and state. Polling never resends surname or last 4. | Test: poll with an unknown token returns the uniform reply; poll after restart still works. |
| N9 | **Pre-event collision report cleared before activation.** It lists every pair with the same normalised surname and last 4, every guest with no mobile and no email, and import problems (duplicates, unknown classification or industry, capacity over 10). Activation is refused until it is clear or acknowledged by the Super Administrator. | Preflight test with a seeded collision. |
| N10 | **The process does not die on a stray promise.** Add `process.on('unhandledRejection')` and `uncaughtException` loggers (none exist today, and Node 22 exits on an unhandled rejection by default). The rejection handler logs and keeps serving; the exception handler logs and exits so systemd restarts cleanly. | Chaos drill: inject a rejected promise in a non-event route during the load test; the event keeps serving. |
| N11 | **Technical deploy freeze, 8 Dec 18:00 to 10 Dec 09:00.** A `DEPLOY_FREEZE` file checked by `deploy/aws/update.sh` **and** the `environment: production` reviewer gate. A kept prior release enables rollback in under 60 s. Event-day fixes use kill-switch flags, not code. | Push a test commit on 8 Dec after 18:00 on purpose; it must not restart production. |
| N12 | **No silent loss of check-ins on restore** (see concession 9). | Test plus the 6 Dec drill. |
| N13 | **Module switch cannot be turned off mid-event by accident.** Turning CUSTOM APP off in Admin panel → Modules while an event window is open needs Super Administrator confirmation, or is locked. | Unit test on the modules route. |

## Implementation notes

**Guest public route (`/event/<code>`, `/api/public/event/:code/*`)**
- Accept only `application/json`, with a body cap of about 1 KB. No multipart, no file fields, and
  no echo of submitted fields in the reply. This is the lesson from content-type confusion in
  public form and webhook handlers *(n8n advisory, unverified)*.
- Validate input: surname of 1 to 80 characters after normalisation, with zero-width and control
  characters stripped; last 4 must match `^\d{4}$`; email is the **full** address, lowercased and
  trimmed, max 254 characters. Anything else gets the uniform reply, not a 400 with detail.
- Last-4 comparison uses the digits-only form of the stored mobile ("+63 917 123 4567",
  "09171234567" and "917-123-4567" all compare on "4567").
- Order of checks: limiter, then window, then match. Never return early before the limiter; pad
  failures to match success timing.
- The soft-cap counter is a `Map` keyed by `eventId|normSurname`, holding a set of distinct wrong
  values with timestamps. In-memory is acceptable: a restart clears the caps, and that fails toward
  the guest. A global failure-rate alarm (for example over 30 failures in 5 minutes) goes to the
  Super Administrator's exceptions inbox.
- The status poll handler is O(1): token hash, then guest, then a small projection. It must not
  re-serialise the event or touch any session. Honour `pollMs` (about 4 s while waiting, 10 s once
  seated), with jitter.
- CSP hash in `server/security.js` pagePolicy, `noindex`, `no-store`, and the same pattern as
  `support.html`.

**Staff routes (`/api/customapp/*`)**
- `customapp.use` only opens the module. Every write calls `eventCan` on **every** guest and every
  destination table in the plan. Any out-of-scope element rejects the whole plan (group and
  cross-scope transfers).
- Re-read delegations from the event state at commit time and never cache them, so a reallocation
  takes effect on the old owner's next write (403) and next poll (UI refresh).
- Out-of-scope rows in the read-only availability view show name, company, industry and table
  only. No contact fields. Exports are Super Administrator only.
- Required reasons: override, release, cross-scope move, Super Administrator transfer, and opening
  the window early.

**Data hygiene**
- On import and edit, strip CR/LF and control characters from names and companies (email header
  injection). Use `composeMessage` encoded words; never put a raw name in a header.
- Size cap of about 2 MB and 2,000 rows on import, dry-run diff before apply, Super Administrator
  only. Once the event is live, re-import is merge-by-external-ref and never touches status, seat or
  owner fields.
- On CSV export, prefix cells starting with `= + - @`, tab or CR with `'` (check `shared/csv.js`).
- Audit labels use the guest ref and a masked name, never mobile or email, so the hash-chained log
  holds no purgeable PII. Event snapshots and laptop copies hold PII and join the retention timer
  that starts 10 Dec.
- Assignment email uses a separate events From or Reply-To, so guest replies do not land in the
  helpdesk IMAP mailbox as IT tickets. If email is cut on 3 Dec, the status page and the printed
  A-Z list carry the table number.

**Kill-switch flags (checked inside `commit()` and the public routes)**
- At minimum: `selfCheckIn` (off sends guests to the desk with the uniform reply), `readOnly`
  (refuses all commits; used during restore), and `emailSend`. Flag changes are Super Administrator
  only and audited.

**Tests and drills Skeptic will check before signing off**
1. All 12 spec acceptance scenarios as interleaved `node --test` cases against `handle()`.
2. Fuzz: random sequences of check-in, seat, release, transfer, swap, substitute and reallocate,
   with invariants asserted after every step and a status-exhaustiveness check.
3. Playwright multi-context journey: two staff, same last seat, one 409 with fresh options.
4. 4-5 Dec single-IP load test on a production-sized copy (**not** production): zero 429s,
   `state.json` or `save()` p95 within Operator's thresholds, restart at peak with all staff
   re-signing in under 3 minutes.
5. 6 Dec chaos drill: kill -9 at peak, injected unhandled rejection, event-only restore to a chosen
   `seq`, CORE Admin restore attempted while the window is open (must be refused or must leave the
   event untouched), Super Administrator transfer in under 2 minutes.
6. 8 Dec: deliberate push after the freeze starts, which must not deploy.

**Residual risks accepted**
- Pre-arrival spoof by someone who knows a colleague's direct mobile. Bounded by the activation
  window, the usher's "show this screen" step and the re-verify flag.
- A restart signs every staff device out. Bounded by the freeze, the crash handler, the venue
  sign-in allowance and a rehearsed re-login.
- One Super Administrator is a single point of failure (spec requirement). Bounded by the rehearsed
  CORE-admin transfer.
- In-memory surname caps reset on restart. This fails toward the guest, which is the safe
  direction.
