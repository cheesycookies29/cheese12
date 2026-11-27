# Interview Summary: YEP 2026 Registration & Table Assignment as CORE "CUSTOM APP"

## Core Intent
Build, inside CORE, a reusable "CUSTOM APP" module whose first app is the Legati Group YEP 2026 registration and table-assignment system (spec: spec.txt), ready and acceptance-tested before 9 December 2026 (12 days from today). This session is analysis only: how it will be built, with patterns from the n8n repository.

## Key Decisions Made
- CUSTOM APP is a reusable area for client-specific apps; YEP registration is the first app, built as a reusable event engine (events, guests, tables, delegation) with YEP 2026 as its first event.
- Staff are CORE user accounts with event roles; possibly a limited "Event staff" account type that opens only CUSTOM APP. Exactly one Super Administrator per event, designated among CORE accounts; reuse CORE sign-in, 2-step, sessions, audit.
- Guests self-verify on a common QR page with surname + last 4 digits of mobile (or email); single exact match only; else staff-assisted search. The master list is never exposed publicly.
- Runs on the current CORE production (EC2, same domain); deploy freeze on event day; load test beforehand.

## Open Questions for Deliberation
- Concurrency: CORE uses a single-process JSON-file DB (db.data/db.save). How to guarantee "last seat: only one succeeds", atomic transfers/swaps, stale-write rejection, and permission changes taking effect immediately? (Node single thread may make a synchronous check-and-assign atomic; is that enough? versions/ETags per guest/table?)
- Live sync to many devices: SSE vs polling; what n8n does (push via SSE/WebSocket); CORE has no push today.
- Guest-facing public page: CSP, rate limits, enumeration resistance, status retrieval token after check-in, registration activation toggle.
- Data model: events, guests (stable id), tables (classification, capacity 10, owner), seats, reservations, holds, delegations, approvals/substitutions, notifications, change history.
- Recommendation engine: industry categories and relationships, group fit, eligibility by classification/table type, exclusions.
- Email: CORE's existing mail/outbox (helpdesk SMTP) reuse; delivery status tracking and resend.
- Offline contingency: printable seating plan and guest list, pre-partitioned ranges, reconciliation.
- MVP vs optional within 12 days; acceptance-test scenarios automated (multi-device, concurrency).
- "Reusable" without over-engineering: what is generic vs YEP-specific.
- Patterns to borrow from n8n: Form Trigger (public forms), webhook auth, queue mode/concurrency control, push (SSE/WS), credentials and email nodes, execution locking.

## Perspective Relevance Scores
| Perspective | Score (0-5) | Rationale |
|---|---|---|
| Architect | 5 | New module, data model, concurrency on a JSON-file DB, live sync, reusable app area |
| Advocate | 5 | Guest phone flow without accounts, staff queues under pressure, assisted check-in |
| Skeptic | 5 | Public QR page, identity verification, enumeration, scope enforcement, race conditions |
| Strategist | 4 | 12-day deadline; core vs optional; reusable vs one-off balance |
| Scout | 4 | n8n repository patterns; precedent event check-in/seating systems |
| Operator | 4 | Event-day on shared production, deploy freeze, backups, offline contingency, monitoring |
| Craftsman | 4 | 12 acceptance scenarios incl. simultaneous devices; journeys in CI |
| Tuner | 3 | ~300 guests, bursts at arrival, live updates fan-out |
| Guardian | 3 | Guest PII (mobile, email), audit trail, data retention after event |
| Prover | 2 | Capacity/no-double-allocation invariants |
| Others | 0-1 | Not relevant (no AI, IoT, crypto, kernel, native mobile, growth) |
