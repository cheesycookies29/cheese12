## Scout Final Position — CUSTOM APP / YEP 2026 Registration & Table Assignment

**Revised recommendation:** Build the write path on the pretix check-in contract and the guest path on n8n's waiting-form pattern, and add no new infrastructure.

The pretix contract has four parts:
- Every write carries a client `opId` (pretix's `nonce`).
- A refusal returns a `409` with a machine reason and the current `seq`.
- One status-agnostic `claimsAt(table)` counter covers both `reserved` and `confirmed`.
- The synchronous `commit()` takes the role of pretix's lock-before-availability-check.

The n8n waiting-form pattern has three parts:
- The verify POST answers at once, as in `onReceived`.
- It mints an opaque status token, stored hashed.
- The status page polls a status endpoint. Outside the activation window, every input gets the same neutral reply, as an inactive production webhook does.

For live sync, I move from long-poll to short poll: a server-supplied `pollMs` plus a `?since=seq` delta. SSE moves to Hold for 9 Dec. n8n's concurrency queue is used only to throttle the email outbox; seat requests fail fast and never wait in a queue.

One finding comes before any public build: today's per-IP limits would lock the guest crowd and the staff out on the venue network. The event therefore needs its own rate-limit buckets and a single-source-IP load test.

---

### Concessions made

| # | What I gave up | Round 1 position | Why I moved |
|---|---|---|---|
| 1 | **Short-lived holds (`held`)** | pretix-style capacity = confirmed + reserved + **held** | Strategist and I agreed this in Round 2. pretix cart positions and Seats.io `holdToken`s exist to protect a buyer's checkout window, which spans several requests. A staff assignment is one request, and so is a group's all-or-none assignment, so there is no window to protect. A TTL hold would also add a write that no request triggers (an expiry sweeper), which would need its own audit trail and restart recovery. It would also block the last seat at the arrival peak. Seat states are `{reserved, confirmed}` and a closed-enum test guards the set. |
| 2 | **Long-poll as the Adopt-ring transport** | Long-poll on `since` was Adopt and SSE was Trial | Strategist's short poll with a server-supplied `pollMs` takes away the 120 s held-request timeout, the Caddy buffering question and the exclusion from the request-duration monitor. It is also the prior-art pattern itself: n8n's waiting-form page polls its status suffix (`packages/cli/src/webhooks/waiting-forms.ts:58,252`, `WAITING_FORMS_EXECUTION_STATUS`), and CORE's badges already poll. The latency cost is about `pollMs/2` on average. That is fine for a "waiting for your table" page and for staff queues at 2-3 s. SSE (`sse.push.ts` shape) moves to **Hold until after 9 Dec**. The `seq` cursor stays, so SSE can be added later without a redesign. |
| 3 | **An event-wide brake on verification failures** | "an event-wide brake on failures" as a rate-limit bucket | Advocate is right that a global cap is a denial-of-service lever: one script could stop every guest at 6:45 PM. The evidence I cited supports controls on *what* can be searched (Cvent OnArrival restricts kiosk search fields), not a global lockout. A high event-wide failure rate now **alarms** the Super Administrator. Only the per-surname soft cap blocks: it counts distinct wrong last-4 values, routes the guest to the desk with the uniform reply, and staff can clear it in one tap. Advocate proposed 5 per 10 min and Skeptic 8 per 15 min. Both are within the range of prior art, so I defer the exact number to them. |
| 4 | **pretix-style offline devices** | Presented pretixSCAN's upload-later model with `force` + `datetime` as the offline precedent | We will not build device-side offline caching in 12 days. The precedent I cited (FooEvents, Ticketsolve) warns that two offline devices can accept the same guest. What I keep is pretix's **reconciliation contract**. The paper fallback is replayed through the normal `commit()` with the original timestamp and an `opId`, so re-entering a paper sheet twice is a no-op and capacity and duplicate checks still run. Architect's "replay commands through `commit()`" is that same contract. |
| 5 | **HMAC-signed URLs and IP allowlists** | Already Skip/Reject in Round 1 | No change. I list them here so that nobody adds them back. |

### Storage location: where I stand on the crossed concessions

Architect and Operator each conceded to the other in Round 2. Architect now wants `data/customapp/<eventId>/`, and Operator now accepts the shared `db.json`. No prior art settles this: pretix keeps every event in one database and restores at database level, and n8n keeps workflows and executions in one database. So this is a CORE-specific call, and I **defer** it to Architect, Operator and Strategist. Here is what I checked in the code, so the decision rests on facts:

- **Operator is right that the offsite allowlist is hard-coded.** `server/offsite.js:265` rejects any manifest file other than `db.json`, `audit-head.json` and `audit-log.jsonl`. The nightly restore check (`deploy/aws/ltdc-erp-restore-check.service` → `scripts/restore-check.js`) knows only that set.
- **Architect is right that the change is bounded.** `offsite.js:280-290` already restores a `documents/` directory from a separate `manifest.documents` map with name checks and sha256. An event directory would follow that precedent.
- **Architect's new hazard is real.** `POST /api/admin/import` (`server/api.js:1315`) calls `replaceData` → `db.replace` (`server/db.js:118`), which swaps the whole of `db.data`. If the event lives in `db.json`, a CORE restore during the event erases check-ins.
- **Save cost.** `db.save()` writes `JSON.stringify(data, null, 2)` (`db.js:125`), so pretty-printing inflates every commit. Compact JSON is a one-line saving whichever option wins.

My tie-breaker is the "boring technology" rule: for 9 Dec, prefer the path that the nightly restore check already exercises. That is the shared `db.json`, **provided** the restore hazard is closed cheaply. Either `replaceData` carries over the live `customApp` subtree, or `/api/admin/import` refuses while any event window is open. A test must assert that a CORE restore leaves every event's `seq` unchanged. If the 28 Nov `save()` measurement goes past Operator's 150 ms line, Architect's directory store is the right fallback, built on the `documents/` precedent.

---

### Non-negotiables

1. **Event-specific rate limits, tested from a single IP address.** Today the limits in `server/api.js:1447-1448` work like this:
   - `api-anon` allows 120 requests per minute per IP, on every anonymous call.
   - `public-write` allows 20 per hour per IP, on every non-GET `/api/public/*`.
   - `auth` allows 20 sign-ins per minute per IP (`api.js:557`).

   Behind venue-Wi-Fi NAT or carrier CGNAT, the 21st guest in an hour gets "Too many messages from this network". About 8 status-polling phones use up `api-anon`, and staff signing in together hit `auth`. The fix:
   - `/api/public/event/*` is exempt from `public-write` and `api-anon`.
   - It gets its own buckets: per status token (polls), per IP with a crowd-sized ceiling while the window is open, and per surname (the soft cap above).
   - The `auth` limit is raised for the event window only.

   The 4-5 Dec load test drives 300 guests and the staff from one source IP.
2. **`opId` idempotency on every event write**: check-in, assign, release, transfer, swap, substitute, approve, group assign and paper replay. Storing `(opId → result)` per event and returning the stored result on a repeat is what keeps venue-Wi-Fi retries and paper re-entry from becoming double writes.
3. **Structured refusal reasons**, as in pretix `already_redeemed` / `ambiguous` / `blocked`. Every staff-side refusal is `409 {reason, seq}`, with `reason ∈ {table_full, already_checked_in, out_of_scope, stale, not_eligible, not_open, read_only}`, and the client refreshes. Guest-side failures are the opposite: one byte-identical reply with a random referral code, and the reason stored server-side for staff.
4. **One status-agnostic capacity counter.** `claimsAt(tableId)` counts every active claim whatever its status. Every handler calls it, and an exhaustiveness test fails if a new seat status appears without a decision on whether it counts.
5. **No public enumeration.** Public matching is exact on the normalised form: no fuzzy matching, no candidate list and no first-name fallback (the Cvent restricted-fields precedent). Fuzzy and partial search exist only in staff-assisted search behind sign-in.
6. **One process, synchronous commit, nothing awaited between the check and the save.** No queue mode, Redis, cluster, or WebSocket dependency. n8n's own `shouldRelayViaPubSub` (`packages/cli/src/push/index.ts`) shows that leaving a single process brings a pub/sub relay with it.
7. **Seat requests are never queued.** The FIFO from n8n `concurrency-queue.ts` applies to the outbox only. The spec wants the loser refreshed or escalated.
8. **A whole-CORE restore must never silently change event data.** This holds whichever storage option wins, and a test must assert it.

---

### Implementation notes

**Patterns to adopt, with sources**

| Concern | Pattern | Source (n8n at commit `bafcff7`, or prior art) | CORE implementation |
|---|---|---|---|
| Guest status token | Opaque random token; any bad token gets the same response | `packages/cli/src/webhooks/waiting-webhooks.ts` `validateToken` (length check, then `timingSafeEqual`) | `randomBytes(32).toString('base64url')`, as at `server/helpdesk.js:518`. Store `sha256(token)` and look up by hash, so no constant-time compare is needed. One token per device. Staff can revoke it. Bad or revoked tokens get a uniform 404. |
| Guest verify response | Answer immediately, hand off to the status page | Form Trigger `responseMode: onReceived` (`nodes-base/nodes/Form/v2/FormTriggerV2.node.ts`) | `POST /api/public/event/:code/verify` returns `{statusUrl}` or the uniform referral reply. It never waits on staff. |
| Status polling | The page polls a status suffix until it is done | `waiting-forms.ts` (`WAITING_FORMS_EXECUTION_STATUS`) | `GET /api/public/event/:code/status` with the `X-Event-Token` header returns `{state: pending\|assigned\|referred, table, seat, pollMs}` and `Cache-Control: no-store`. The token goes in a header, not the URL, after the first load, so it stays out of Caddy and referrer logs. |
| Registration toggle | Production URL live only while the workflow is active | `live-webhooks.ts` vs `test-webhooks.ts` | `event.registrationOpen` plus the activation window. When closed, every input gets "Registration opens at 6:00 PM". |
| Bot filter | `ignoreBots` option | Form Trigger (uses `isbot`) | No dependency. Reuse the helpdesk trap field and minimum fill time (`server/helpdesk.js:454-542`) plus a short user-agent denylist. |
| Staff live sync | Thin change signal, then the client re-fetches | n8n push sends small messages that the UI acts on | `GET /api/customapp/events/:id/changes?since=seq` returns `{seq, pollMs, guests:[changed], tables:[changed]}`. Staff poll every 2-3 s and guests every 4-6 s, both server-tunable through `pollMs` (Operator's kill switch). |
| Write contract | `nonce`, reason codes, `force` + `datetime` for late uploads | [pretix check-in API](https://docs.pretix.eu/dev/_sources/api/resources/checkin.rst.txt) | Body `{opId, expectSeq?, at?}`. `at` is accepted only on the Super Administrator's paper-replay route and is recorded as `occurredAt` beside the server's `committedAt`. |
| Capacity and locking | Quota counts every blocking claim; lock only when a change reduces availability, and take it before the check | [pretix quotas](https://docs.pretix.eu/dev/api/resources/quotas.html), [pretix locking](https://docs.pretix.eu/dev/_sources/development/implementation/locking.rst.txt) | `claimsAt()` inside the synchronous `commit()`. Releases need no special path. |
| Email outbox | Synchronous capacity decrement, FIFO of waiting promises, release wakes the next | `packages/cli/src/concurrency/concurrency-queue.ts` | Outbox records `{id, to, template, status: queued\|sent\|failed, attempts, lastError, sentAt}` per event. Concurrency 1-2 over `server/mail` `sendMail`, exponential backoff, a manual Resend, and Operator's `emailPaused` flag. Strategist moved the go/no-go on email to 3 Dec, and this design works either way. |

**Reuse inventory (unchanged from Round 1, confirmed)**
- `public/js/vendor/qrcode.js` (qrcode-generator 1.4.4, MIT) for the reception QR sheet.
- `shared/csv.js` `parseCsv` / `csvSeparator` for guest import and formula-safe export.
- `server/pdf/office-core.js` `readZip` / `parseXml` for an .xlsx reader of about 80 lines.
- `server/security.js` `pagePolicy` for CSP hashes on the new `public/event.html`.
- `server/audit.js` for the change history.

**Tests that the prior art implies (for Craftsman)**
- Send the same `opId` twice. Expect one change and an identical response.
- Two devices race for the last seat. Expect exactly one `200` and one `409 table_full` with the current `seq`.
- Replay a paper sheet twice. Expect it to apply once.
- Every guest failure path (no match, ambiguous, capped, not open, unlisted) returns the same status, the same body shape and the same byte length apart from the code.
- From one source IP, 300 verifies and 300 phones polling for 30 minutes get zero 429s on event paths.
- A CORE restore through `/api/admin/import` leaves every event's `seq` unchanged.
- `SEAT_STATUSES` is closed and `held` is absent.

**Technology radar for this event (revised)**

| Item | Ring |
|---|---|
| Short poll with server `pollMs` and a `since=seq` delta | **Adopt** |
| Long-poll | **Hold** (unnecessary given the above) |
| SSE in the `sse.push.ts` shape | **Hold until after 9 Dec**, then Trial for the next CUSTOM APP |
| WebSocket, Redis/Bull, clustering | **Hold** |
| Device-side offline / PWA | **Hold**; use paper plus `commit()` replay |
| Seat holds with a TTL | **Hold**; add later as a claim status with `expiresAt` if a client needs them |

**Honest limits:** I found no prior art for ranking tables by industry affinity at arrival. zkipster's autoseat is a sequential fill, and Social Tables-style tools are drag-and-drop. The recommendation engine is therefore the one part with no outside model. Keep it a deterministic tiered score with "why" chips, as in Round 1.
