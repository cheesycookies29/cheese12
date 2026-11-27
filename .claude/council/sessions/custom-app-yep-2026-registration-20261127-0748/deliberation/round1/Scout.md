# Scout Position — CUSTOM APP / YEP 2026 Registration & Table Assignment

**Core recommendation:** Copy what ticketing and check-in products already do, and use n8n only for its transport and public-form patterns. From pretix, take the write contract: an idempotency `nonce` on every write, structured `reason` codes on refusal, capacity counted as confirmed + reserved + held, and a lock taken before the availability check. For offline work, take pretix's upload-later model with the original timestamp. From n8n, take the waiting-form status page (an opaque token compared in constant time, with the page polling a status suffix), the SSE wire format, and the in-memory capacity queue, but only to throttle the email outbox. Reject n8n queue mode and its multi-main pub/sub relay; they show why CORE must stay single-process. Separately, before building anything public, fix one blocker found in CORE itself: today's per-IP limits (`public-write` 20/hour, `api-anon` 120/min) would lock out the whole guest crowd once they share the venue Wi-Fi's single address.

**Key argument:**
Mature event products have already solved the hard parts of this brief. The pretix check-in redeem API takes an optional `nonce` so that "sending the same nonce again succeeds but creates only one check-in", which allows safe retries after a dropped connection. It refuses with machine-readable reasons (`already_redeemed`, `ambiguous` when several tickets match, `blocked`, `unapproved`). It accepts `force` plus a historical `datetime`, used "to upload offline scans that already happened" ([pretix check-in API](https://docs.pretix.eu/dev/_sources/api/resources/checkin.rst.txt)). That one contract covers three of the twelve acceptance scenarios: duplicate/simultaneous check-in, the last available seat (a refusal with a reason makes the losing device refresh), and connectivity/recovery. pretix counts capacity as orders paid or within their payment period plus non-expired cart positions, and it reports pending orders, cart positions and blocking vouchers as separate figures ([pretix quotas](https://docs.pretix.eu/dev/api/resources/quotas.html)). That is the spec's section 8 rule (confirmed + active reservations + holds count toward 10). pretix takes a lock only for actions that make a resource less available, takes it before the availability check, and needs none to free capacity ([pretix locking](https://docs.pretix.eu/dev/_sources/development/implementation/locking.rst.txt)). In CORE the synchronous handler plays the lock, and the rule becomes "no `await` between check and `db.save()`". Cvent OnArrival's kiosk lets planners limit which fields attendees can search, so attendees cannot browse other registrants' names ([Skift review](https://meetings.skift.com/reviews/cvent-onarrival-check-tool-review/)). This supports the interview decision: surname + last 4 digits, one exact match or go to staff, never a candidate list. n8n was checked against its real source (a sparse clone at commit `bafcff7`, 27 Nov 2026; the session's codebase map assumed it was unavailable). Its waiting-form flow is the guest status page we need. `waiting-webhooks.ts` checks the length, then compares the opaque `resumeToken` with `timingSafeEqual`, and a bad token gets the same 401 page. `waiting-forms.ts` serves a status suffix that the page polls until the run completes. n8n keeps HMAC-signed URLs for the case where query parameters such as `approved=true` must be tamper-proof, which we do not need. CORE already does the token half: `server/helpdesk.js:518` issues a `randomBytes(24)` `publicToken`. n8n's SSE backend (`packages/cli/src/push/sse.push.ts`, 56 lines) shows that server push on raw Node needs only a few headers (`text/event-stream`, `X-Accel-Buffering: no`), a `:ok` primer, a 60-second ping, and one connection per (user, tab) that replaces the old one. It sits behind auth middleware with `allowSkipMFA: false`. Because `EventSource` sends no `Origin`, the origin check accepts `Sec-Fetch-Site: same-origin` instead. So SSE is a cheap upgrade if long-polling proves too slow. It is not a prerequisite. The message should stay a thin "event revision N changed" signal, and clients re-fetch a delta with `since=N`. n8n's `concurrency-queue.ts` decrements a capacity counter synchronously and parks the overflow in a FIFO queue of promises. That pattern fits the SMTP outbox, so 300 confirmation emails cannot pile onto the helpdesk mail server at once. It does not fit seat allocation: the spec says the losing request refreshes or escalates, so seat requests must fail fast, never wait in a queue. No surveyed product recommends tables by industry affinity at arrival. zkipster's "autoseat" fills the available seats, which is the sequential fill the spec forbids ([zkipster seating](https://support.zkipster.com/en/articles/10346623-getting-started-with-zkipster-seating)). Social Tables-style tools are planner drag-and-drop. This is the one area to build from scratch, so keep it deterministic and explainable: a score made of tiers with "why" chips, not a black box.

**Risks if ignored:**
- **Guests locked out by rate limits on event night.** `server/api.js:562,1447` applies `public-write` (20 per hour per IP) to every non-GET `/api/public/*` call, and `api-anon` (120 per minute per IP) to every anonymous call. Behind venue Wi-Fi NAT, or carrier CGNAT for guests on mobile data, the 21st guest check-in in an hour from that address gets "Too many messages from this network". A guest status page polling every 4 seconds uses up `api-anon` with only about 8 phones. The event paths need their own buckets: per-token for status polls, per-IP with a ceiling sized for a crowd of 300 behind one address, per-surname for failed verifications, and an event-wide brake on failures. They must be exempt from the generic `public-write`. Test this in the load test from a single source IP.
- **Retries that double-book or double-check-in.** Without a client-generated idempotency key (pretix's `nonce`) on check-in, assign, transfer and swap, a tap repeated over flaky venue Wi-Fi becomes two writes. Offline devices that each allocate independently produce duplicates: FooEvents and Ticketsolve warn that the same ticket can be accepted by two offline devices ([FooEvents](https://help.fooevents.com/docs/topics/use-cases/check-in-setup-for-multi-gate-events-with-unreliable-connectivity/), [Ticketsolve](https://ticketsolve.zendesk.com/hc/en-us/articles/15409775899540)). Keep the spec's "single allocation authority or pre-partitioned ranges" and reconcile with nonce + original timestamp.
- **Reinventing, or adding infrastructure.** Copying n8n's queue mode (Bull/Redis) or its multi-main pub/sub relay (`push/index.ts` `shouldRelayViaPubSub`) adds a process boundary. That breaks the one guarantee that makes "only one gets the last seat" trivial in CORE. Skipping what CORE already ships (`public/js/vendor/qrcode.js` for the reception QR, `shared/csv.js` `parseCsv`, `server/pdf/office-core.js` `readZip`/`parseXml` for .xlsx import, `server/mail` `sendMail`, the helpdesk public-token flow, `pagePolicy` CSP hashes) wastes some of the 12 days.

**Dependencies on other domains:**
- **Architect:** commits to a per-event revision counter and a `since` delta feed, which both long-poll and optional SSE ride on, plus an `opId`/nonce dedupe store per event (pretix-style). This decides whether SSE is a 60-line add-on or a redesign.
- **Skeptic/Guardian:** the rate-limit bucket design and keys (token vs IP vs surname), the verification-failure lockout, and whether the status token is shown only once or can be sent again by email.
- **Operator:** confirms the Caddy reverse-proxy config does not buffer streamed or long-held responses (Caddy is believed to flush `text/event-stream` automatically; verify in `deploy/aws`), knows the venue network topology (one public IP or not), and gets the paper fallback printed.
- **Strategist:** keeps the recommendation engine to a simple tiered score for MVP, with affinity/exclusion tags optional, as spec section 19 already allows.
- **Craftsman:** turns pretix-style reason codes into assertions in the 12 acceptance scenarios, and adds a single-source-IP load test.

---

## Appendix A — n8n patterns, verified against source

Source: `github.com/n8n-io/n8n`, sparse clone at commit `bafcff716010` (27 Nov 2026), at `/tmp/claude-0/-home-user-cheese12/9c3bac6a-3ed8-59bc-8b1f-3a103fe2e21c/scratchpad/n8n/repo`. Paths are relative to `packages/`. Items marked *(model knowledge)* were not re-read in source.

| # | n8n pattern | Where | What it does | Verdict for CORE |
|---|---|---|---|---|
| 1 | Waiting-form resume token | `cli/src/webhooks/waiting-webhooks.ts` `validateToken` | Opaque random token; checks the length, then `timingSafeEqual`; any bad token gets the same 401 page (`form-invalid-token`) | **Adopt.** Guest status URL `/event/<code>/s/<token>`, token from `randomBytes(24).toString('base64url')` as in `helpdesk.js:518`; compare in constant time; uniform 404 |
| 2 | Waiting-form status poll | `cli/src/webhooks/waiting-forms.ts` (status suffix `WAITING_FORMS_EXECUTION_STATUS`) | The form page polls a status endpoint; a queued or running run returns nothing, so the page keeps polling | **Adopt.** `GET /api/public/event/<code>/status/<token>` returns `{state:'pending'|'assigned'|'referred', table, seat, rev}` only; the page polls every 3–5 s with backoff and `Cache-Control: no-store` |
| 3 | HMAC-signed URLs | same file, `validateSignature` | Used only where query params (e.g. `approved=true`) must be tamper-proof | **Skip.** The status token carries no parameters; a stored random token is simpler and can be revoked |
| 4 | SSE push backend | `cli/src/push/sse.push.ts`, `abstract.push.ts` | Headers `text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`; `:ok` primer; `:ping` every 60 s; one connection per (userId, pushRef), a new one replaces the old; removed on `close` only if still current | **Trial (optional).** If long-poll latency or load disappoints, add `/api/customapp/events/:id/stream` in `server.js` ahead of `api.handle`. Send a thin `{rev}` signal; clients re-fetch `?since=rev`. Cap connections per user |
| 5 | Push auth + origin | `cli/src/push/index.ts` `setupPushHandler`; `origin-validator.ts` | Auth middleware with `allowSkipMFA:false`; WebSocket requires a matching `Origin`; SSE accepts a missing `Origin` only with `Sec-Fetch-Site: same-origin` | **Adopt** for any stream or long-poll: a full CORE session (2-step done) plus the `Sec-Fetch-Site` check |
| 6 | Multi-main pub/sub relay | `cli/src/push/index.ts` `shouldRelayViaPubSub` | Once there is more than one process, push needs Redis pub/sub to reach the right main | **Reject.** Shows the cost of leaving a single process; supports the "one process, sync handlers" decision |
| 7 | Concurrency control | `cli/src/concurrency/concurrency-queue.ts`, `concurrency-capacity-reservation.ts` | Synchronous `capacity--`; if below zero, park in a FIFO promise queue; `release()` resolves the next; the reservation object asserts it is not reserved twice | **Adopt for the email outbox only** (SMTP concurrency 1–2, retry with backoff). **Reject for seats**: the spec wants the loser refreshed or escalated, not queued |
| 8 | Queue mode (Bull/Redis workers) | *(model knowledge)* `cli/src/scaling/` | Executions spread across worker processes | **Hold.** Needs Redis and more than one process; breaks atomicity; overkill for ~300 guests |
| 9 | Form Trigger auth and response modes | `nodes-base/nodes/Form/v2/FormTriggerV2.node.ts`, `common.descriptions.ts` | Auth `none`/`basicAuth`/`n8nUserAuth`; `responseMode` `onReceived`/`lastNode`/`responseNode`; option `ignoreBots` (via `isbot`); note: "n8n exposes inbound trigger URLs publicly by design" | **Adapt.** The guest verify POST answers like `onReceived` (respond at once: "Checked in, waiting for your table"), then hands over to the status page; never hold the request open for staff. Add a small no-dependency bot filter by user agent plus the helpdesk trap field and minimum fill time |
| 10 | Active/inactive production webhook | `cli/src/webhooks/live-webhooks.ts` vs `test-webhooks.ts` *(model knowledge on semantics)* | Production URLs exist only while the workflow is active | **Adopt** as the registration toggle: when inactive, the verify endpoint returns the same neutral "Registration is not open" for every input |
| 11 | Webhook IP allowlist | `nodes-base/nodes/Webhook/utils.ts` `isIpAllowed` | Accepts requests only from listed source IPs | **Reject for guests** (mobile data breaks it). Possibly an optional staff-side setting, not MVP |
| 12 | Credentials encryption / Email Send | *(model knowledge)* | Credentials encrypted with an instance key; email results per item | **Already in CORE** (`server/secrets.js`, `server/mail`). Borrow only the shape of a per-message result record |

## Appendix B — Competitive analysis (skill output)

### Feature comparison matrix

| Feature | CORE YEP plan | pretix + pretixSCAN (OSS) | Cvent OnArrival | zkipster |
|---|---|---|---|---|
| Self check-in without an app | Common QR → web page, surname + last 4 | Ticket barcode scan by staff; self-service via kiosk/POS | Kiosk mode: name/email/confirmation-number search; planner can limit search fields | Staff app; QR/guest-list check-in |
| Ambiguous identity | Single exact match only, else staff | `ambiguous` reason, rejected | Planner limits fields to avoid browsing | Staff search |
| Idempotent retries | **Adopt** `opId` nonce | `nonce` dedupes re-uploads | n/a (not documented) | n/a |
| Structured refusal reasons | **Adopt** (`already_checked_in`, `table_full`, `out_of_scope`, `stale`, `ambiguous`, `not_open`) | Yes (`already_redeemed`, `blocked`, `unapproved`…) | n/a | n/a |
| Capacity incl. reservations/holds | Confirmed + reserved + holds ≤ 10 | Quota = paid/pending orders + unexpired cart positions + blocking vouchers | n/a | Seat count per table |
| Concurrency control | Sync handler = lock; no await before save | DB advisory lock before the availability check; none needed to free | n/a | n/a |
| Offline | Paper list + pre-partitioned ranges; reconcile later | Full offline: device caches tickets, uploads later with `force` + `datetime` + `nonce` | n/a (not researched) | Local data store; sync banner until resynced |
| Seating assignment | Staff confirm from ranked eligible tables | Seat map at purchase; seats blocked manually or by order/cart | n/a | Import / drag-and-drop / autoseat (fills available seats) |
| Affinity recommendations | **Industry tiered score (new)** | None | None | None (autoseat is a sequential fill) |
| Delegated staff scopes | Exclusive guest + table ownership | Check-in lists per device | Roles | Team permissions |
| Live updates | Long-poll on revision (SSE optional) | Periodic sync | Cloud sync | Cloud sync; "improved sync" redesign |

### UX approach summary

| Aspect | pretix | Cvent OnArrival | zkipster |
|---|---|---|---|
| Onboarding | Import/order data; device paired to a check-in list | Event preloaded; kiosk locked so only authorized users can exit | Spreadsheet import with table/seat columns |
| Core interaction | Scan → green/yellow ("already used")/red | Attendee searches self → confirm → badge | Tap guest → see or reseat |
| Info architecture | Check-in list = scope | Kiosk vs staff app | Guest list + seating tab |
| Visual style | Full-screen colour verdict | Branded kiosk | Clean iPad list |

### Differentiation opportunities
1. **Explainable affinity ranking.** No surveyed product ranks tables by industry at arrival. Show tiers (same industry > related > other eligible) with capacity and the "why" chips staff need to choose quickly.
2. **Ownership-scoped queues.** Check-in tools scope by device or list. The spec needs exclusive per-person guest and table ownership with instant reallocation. Model it as data (owner fields re-read on every write), not as UI.
3. **Pending-table status page.** Most tools stop at "checked in". The n8n waiting-page pattern gives the guest a live "waiting for your table" state, then table/seat, at no extra infrastructure cost.

### Lessons from prior art
- **Adopt:** idempotency nonce + reason codes (pretix); capacity = confirmed + reserved + holds (pretix quotas); lock before the availability check, none to free (pretix locking); restricted self-search fields (Cvent); "already used" shown in yellow rather than as an error (pretixSCAN); opaque status token + polled status endpoint (n8n waiting forms).
- **Avoid:** independent offline allocation on several devices (duplicate risk noted by FooEvents/Ticketsolve); sequential autoseat (zkipster; forbidden by the spec); queue/multi-process scaling for a 300-guest event (n8n queue mode, pub/sub relay); per-IP-only rate limits on a public crowd endpoint (CORE today).
- **Innovate:** the industry-affinity recommendation and group fit. No prior art found, so keep it deterministic and testable.

## Appendix C — Reuse inventory in CORE (build vs reuse)

| Need | Reuse | Gap |
|---|---|---|
| Reception QR | `public/js/vendor/qrcode.js` (qrcode-generator 1.4.4, MIT, used in `views/security.js` `qrSvg`) | Printable QR sheet view |
| CSV import/export | `shared/csv.js` `parseCsv`, `csvSeparator` (formula-safe export noted in the devlog) | Column mapping UI |
| Excel import | `server/pdf/office-core.js` `readZip`, `parseXml`; shared-strings handling in `office-ooxml.js:605` | A small sheet → rows reader (~80 lines); `xlsxToBlocks` produces PDF blocks, not records |
| Public token + page | `helpdesk.js:454-542` (trap field, minimum fill time, `publicToken`), `public/support.html`, `security.js` `pagePolicy` hashes | New `event.html` + `event.js` |
| Rate limits | `server/ratelimit.js`, buckets in `api.js:554` | **New event buckets + exemption from `public-write`** |
| Email | `server/mail` `sendMail`, `composeMessage`; SMTP settings in helpdesk | Outbox with status/attempts/lastError, resend, concurrency 1–2 |
| Audit | `server/audit.js` | Event change history view |

## Appendix D — Technology radar (transport and infrastructure)

| Item | Ring | Note |
|---|---|---|
| Short poll / long-poll on a `since` revision, inside `api.handle` | **Adopt** | Zero new infrastructure; matches the existing badge polling |
| SSE (n8n `sse.push.ts` shape) | **Trial** | Only if the load test shows long-poll is too slow; ~60 lines; needs Caddy flush verified |
| WebSocket | **Hold** | Node 22 has no built-in WS server; would need a dependency or a hand-rolled RFC 6455 |
| Redis/Bull queue, clustering | **Hold** | Breaks single-thread atomicity |
| Service worker / offline PWA for staff | **Hold** | Too risky in 12 days; paper + pre-partitioned ranges per spec |

## Sources
- pretix check-in redeem API: https://docs.pretix.eu/dev/_sources/api/resources/checkin.rst.txt
- pretix check-in algorithm (offline overview): https://docs.pretix.eu/dev/_sources/development/algorithms/checkin.rst.txt
- pretix quotas: https://docs.pretix.eu/dev/api/resources/quotas.html
- pretix locking: https://docs.pretix.eu/dev/_sources/development/implementation/locking.rst.txt
- pretix seats API: https://docs.pretix.eu/dev/api/resources/seats.html
- pretixSCAN: https://pretix.eu/about/en/scan
- Cvent OnArrival review (kiosk search fields): https://meetings.skift.com/reviews/cvent-onarrival-check-tool-review/
- Cvent OnArrival: https://www.cvent.com/en/onsite-solutions/onarrival-event-check-in-software
- zkipster seating: https://support.zkipster.com/en/articles/10346623-getting-started-with-zkipster-seating ; sync: https://support.zkipster.com/en/articles/2886157-seating-redesign-improved-sync
- FooEvents offline multi-gate: https://help.fooevents.com/docs/topics/use-cases/check-in-setup-for-multi-gate-events-with-unreliable-connectivity/
- Ticketsolve offline: https://ticketsolve.zendesk.com/hc/en-us/articles/15409775899540
- n8n source (commit bafcff7): packages/cli/src/push/*, packages/cli/src/concurrency/*, packages/cli/src/webhooks/waiting-*.ts, packages/nodes-base/nodes/Form/*, packages/nodes-base/nodes/Webhook/*
