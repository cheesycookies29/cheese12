## Strategist Response to Operator

**Their position:** Treat 9 December as a known incident. In the same 12 days, build an event-grade operations layer:
- a deploy freeze enforced twice (reviewer gate plus a `DEPLOY_FREEZE` file);
- rollback in under 60 s from a kept prior release;
- six runtime kill switches;
- an `unhandledRejection` logger;
- event-only snapshots every 5 minutes, plus a laptop copy;
- an event-only import that restores one event;
- a staging server rebuilt from S3, used as restore drill, load-test target and warm standby;
- possibly persisted hashed sessions;
- an upsized instance and a kill -9 drill.

Most of it ships dark by 3 Dec, with load tests on 4 to 6 Dec.

**My response:** Modify

**Reasoning:** Operator is right that a restart at peak is the most likely way this event fails, and on that point my Round 1 put too little operations work in Tier 0. Two facts in the repo back this. `update.sh` runs `systemctl stop` and then `rsync --delete`, so every deploy is a restart and no prior release is kept. A grep of `server.js` and `server/` finds no `unhandledRejection` handler.

So I accept the cheap items, which are XS each. Most are one check inside the single `commit()` or the poll response, so they get the same leverage as transfers and swaps. These items are:
- the freeze file;
- the `/opt/ltdc-erp-prev` rollback;
- the crash logger;
- `selfCheckIn`, `emailPaused`, `pollMs` and `readOnly` beside my `registrationOpen`;
- a 60-second invariant self-check;
- a measurement of production's `db.json` size and `save()` time on 28 Nov.

The measurement gates the whole plan, and it needs no staging box. Together these come to about 1.25 dev-days, and they land in Tier 0 and Tier 1.

I reject the items that cost M or S, sit on the critical path and add little for this one evening:
- **Event-only import into production.** It is an M of new restore code and would only be used under pressure. On a separate standby box, a whole-`db.json` restore rolls back nobody's work. The gap after that restore is closed the way paper is: by replaying through the normal commands.
- **Persisted sessions.** They are an S, but they change the VAPT-hardened `auth.js` 10 days out. The freeze, the crash logger and upsizing remove the restart causes instead. An event-window raise of the `auth` rate limit covers the rest.
- **On-box 5-minute event snapshots.** The `seq` change log is already the journal. The laptop pull of the event export stays, because it survives losing the instance and it feeds the printed pack.
- **Long-poll.** Short poll with a server-supplied `pollMs` removes the 120 s timeout work and the monitor-exclusion work.
- **A QR redirect host for failover.** During a failover, guests drop to staff-assisted check-in.

Staging moves from 28 Nov to 4 Dec, and it is operations time, not developer time. The nightly `ltdc-erp-restore-check` timer already proves that the off-server copy restores. That leaves load testing on production-sized data as the only reason to build staging, and that need starts on 5 Dec. Staging then stays up as a warm standby at no extra build cost. The kill -9 drill runs during load test 2. The upsizing on 7 Dec is a console action.

The net cost is about 1.25 dev-days added and about 3 removed from Operator's list. My existing Must list was already about 15 dev-days against 9 build days, so I pay for the additions now:
- Dashboard #20 is built in its fallback form from the start: counts, an occupancy grid and an event-health strip, with no separate health panel.
- The email go/no-go moves from 5 Dec to 3 Dec.
- 6 to 8 Dec stays fixes-only.

---

### Appendix: disposition of Operator's items

| Operator item | Disposition | Tier / date | Effort | Why |
|---|---|---|---|---|
| Measure production `db.json` size and `save()` p95 over SSM (read-only, on a copy) | **Accept, first task** | 28 Nov | XS | Gates the polling budget, upsizing and the whole capacity story; no staging needed |
| `DEPLOY_FREEZE` file checked in `remote-deploy.sh` (+ override) | Accept | Tier 0, 1 Dec | XS | About 3 lines; it must be exercised by real deploys before the freeze, so it ships early |
| GitHub `production` reviewer gate from 7 Dec 18:00 | Accept | 7 Dec | 0 (settings) | No code |
| Keep `/opt/ltdc-erp-prev` + `ltdc-erp-rollback` | Accept | Tier 0, 1 Dec | XS | Copy the code (not `data/`) before the `rsync --delete` in `update.sh`; then 4+ real deploys exercise it before the freeze |
| Process-level `unhandledRejection` logger + wrapped async in the module | Accept | Tier 0 | XS | Removes the most likely restart cause (fire-and-forget email) |
| Kill switches: module switch (exists), `registrationOpen` (already #12), `selfCheckIn`, `emailPaused`, `pollMs`, `readOnly` | Accept | Tier 0 (flags in event record + checks in `commit()`), Tier 1 (`pollMs` in the poll response), Tier 2 (`emailPaused` in the send log) | XS total | One branch each in the single mutation and poll paths |
| Invariant self-check every 60 s (no table > 10, no double seat, one SA) | Accept | Tier 1 | XS | Doubles as the test oracle for AS "last seat" and the load test |
| Event health endpoint/panel | **Modify** | Tier 2, as a strip on dashboard #20 | XS | Shows `seq`, save p95, outbox depth and failures, and the 429 count. No second screen |
| Laptop pulls the event export every 5 min | Accept | Tier 2 | XS | Reuses #9 export (JSON variant). It survives losing the instance and feeds the printed pack |
| On-box event snapshots every 5 min | **Cut** | none | S | The `seq` change log + audit are the journal. A snapshot without an import is only a reference copy |
| Event-only import that restores one event into production | **Cut before 9 Dec** | v1.1 if a second event needs it | M | Recovery uses standby (whole-`db.json` restore is harmless on a separate box) plus replay through normal commands. Post-event merge back into production happens after 10 Dec, without time pressure |
| Off-server copy frequency on 9 Dec | **Add (my substitute)** | Before the freeze | XS (timer config) | Every 15 min during the event window instead of hourly. That shrinks the standby recovery point, with no new code |
| Staging rebuilt from S3 (RESTORE.md section 2) | **Modify: move to 4 Dec** | Ops, 4 Dec | About 0.5 day of ops time | The nightly `ltdc-erp-restore-check` already proves backups restore. Staging's real value is load test on prod-sized data (5 to 6 Dec) |
| Warm standby on 9 Dec | Accept (free once staging exists) | 9 Dec | 0 extra | Staff URL only. Guests drop to staff-assisted check-in during a failover; no QR redirect host |
| Persisted hashed sessions | **Cut** | none | S, security-sensitive | Changes VAPT-hardened `auth.js` 10 days out. Remove restart causes instead, and raise the event-window `auth` bucket (XS) |
| Long-poll at 25 s with heartbeat | Keep as Could | After load test, only if needed | S | Short poll + `pollMs` avoids the `requestTimeout` and monitor-exclusion work |
| Upsize to t3.small/medium on 7 Dec, back on 10 Dec | Accept | 7 Dec | 0 dev (console) | About 2 minutes of announced downtime before the freeze |
| kill -9 chaos drill | Accept | During load test 2, 6 Dec | About 30 min | It rehearses the degrade ladder and paper reconciliation, which are the real mitigation |
| SMTP outbox with a concurrency limit and retry | Accept as part of #19 | Tier 2 | Already counted | n8n concurrency-control pattern *(unverified)*; email stays outside `commit()` |
| Reject queue mode / second process | Agree | none | none | Both of us cut it: it breaks single-thread atomicity |

### Revised developer-day ledger (28 Nov to 5 Dec)

- **Added from Operator:** about 1.25 dev-days. Split: Tier 0 about 0.75 (freeze, rollback, crash logger, flags), Tier 1/2 about 0.5 (self-check, `pollMs`, health strip, laptop pull).
- **Removed from Operator's list:** about 3 dev-days (event-only import, on-box snapshots, persisted sessions, long-poll, QR redirect).
- **Paid for by:**
  - building dashboard #20 in its fallback form from the start (about 0.5 day saved);
  - moving the email go/no-go to 3 Dec, so that if email becomes "display + verbal" the decision frees its Tier 2 day early.
- **Operations time, not developer time:**
  - staging (4 Dec);
  - load tests (5 to 6 Dec);
  - chaos drill (6 Dec);
  - resize and reviewer gate (7 Dec);
  - freeze file (8 Dec 12:00).
- **Dates I adopt from Operator:**
  - no feature work after 6 Dec;
  - code freeze 7 Dec 18:00;
  - deploy freeze 8 Dec 12:00 to 10 Dec 09:00.

### Success measures for the operations layer

- At least 4 production deploys exercise the freeze-file check and `ltdc-erp-rollback` before 7 Dec (one rollback done on purpose).
- `save()` p95 is under 100 ms on production-sized data at the 300-guest + 15-staff load profile from one IP, with zero 429s to legitimate guests.
- The kill -9 drill: staff are back in, or on paper, within 3 minutes, and reconciliation through commands yields zero invariant violations.
