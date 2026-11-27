# Operator Position: YEP 2026 Registration & Table Assignment on CORE production

**Lens:** orange. Deploy, monitor, roll back, fail at 2x load.
**Grounding:** spec.txt (sections 17, 18, 19 and 20), interview summary, codebase map, the round 1 drafts from Architect, Advocate, Skeptic and Strategist, and direct reads of:
- `.github/workflows/deploy-ec2.yml`
- `deploy/aws/{update.sh, remote-deploy.sh, ltdc-erp.service, ltdc-erp-backup.cron, ltdc-erp-offsite.timer, ltdc-erp-restore-check.timer, Caddyfile, EC2.md}`
- `server/db.js` (`save`), `server/auth.js:54` (`createSessions`), `server/api.js:554-570` and `1440-1447` (rate limits), `server/offsite.js` (manifest file names), `server.js:262-263` (timeouts), `server/monitor-panel.js:389` (health)

**n8n:** this workspace has no local clone (the codebase map says so, and `find` finds none). Every n8n pattern below comes from model knowledge and is marked *(unverified)*.

---

## Core recommendation

Treat 9 December as a production incident we already know is coming. CORE runs on one t3.micro with one Node process, and staff sessions are held only in memory. That means any restart, whether from a deploy, a crash or an OOM, signs every staffer out at the peak of arrivals. So the operational plan matters as much as the code:

- a deploy freeze enforced in two places, not just agreed;
- a kill switch for CUSTOM APP, plus runtime knobs, so nothing on the night needs a deploy;
- a server sized up for the evening, and a load test on a prod-sized staging copy;
- event snapshots every 5 minutes, because the hourly backups are far too coarse for an evening of check-ins;
- a rehearsed degrade path: self check-in, then staff-only, then paper, then reconciliation.

## Key argument

What can hurt us on the night is not the feature code. It is how CORE gets deployed, restarted and restored:

1. **Every push deploys, and a deploy is a restart.** Every push to `claude/busy-curie-hfpbg0` deploys once tests and journeys pass (`deploy-ec2.yml`). The `production` environment waits for approval *only if* required reviewers are set. `update.sh` runs `systemctl stop`, then `rsync --delete`, then `start`. That is several seconds of downtime, and with `createSessions` keeping a `Map` in memory, every session is lost.
2. **Rollback is slow.** It means a `git revert` and push, then the full CI run (about 10-20 min), then a deploy that is itself another restart. No copy of the previous release is kept on the box.
3. **Restoring data restores all of CORE.** The restore path (`RESTORE.md` section 1) goes back to an hourly snapshot of the whole `db.json`. Restoring to 18:00 at 19:00 throws away an hour of check-ins and seat assignments, plus every other module's changes.
4. **Crashes are fatal.** I found no `unhandledRejection` handler. On Node 22, one rejected promise left unhandled in a fire-and-forget email send ends the process. `Restart=always`, `RestartSec=3` brings it back, but signed out.
5. **The server is small.** A t3.micro (1 GB, burstable) rewrites the *whole* of CORE's pretty-printed JSON on every mutation, on the same process that holds about 300 guest connections polling or long-polling. Nobody has measured production's `db.json` size or how long `save()` takes.

My answers, in the same order:

1. **Freeze.** Turn on required reviewers for the `production` GitHub environment from 7 Dec 18:00 (a settings change, no code). Ship a server-side freeze file now: `remote-deploy.sh` refuses when `/opt/ltdc-erp/data/DEPLOY_FREEZE` exists, unless the deploy carries an override.
2. **Fast rollback.** Make `update.sh` keep `/opt/ltdc-erp-prev` and add a one-line `ltdc-erp-rollback`, so rolling back takes under a minute without going through CI.
3. **Kill switches and knobs that need no deploy.** These are the Admin panel → Modules switch for `customapp`, plus per-event toggles stored in data:
   - `registrationOpen`: the guest page;
   - `selfCheckIn`: off means staff-only assisted check-in;
   - `emailPaused`: holds the outbox;
   - `pollMs`: the server tells clients how often to poll, so we can slow 300 phones down without shipping code.
4. **Event-grade recovery.** Architect's per-event change log with `seq` is also our recovery journal. Every 5 minutes during the event window, write an event-only snapshot (event, tables, guests, log) to `data/backups/events/`. The command-desk laptop also downloads the event export every 5 minutes. That copy survives losing the instance *and* losing the venue network, and it feeds the printed pack.
5. **Process hygiene.** Every async path in the module (outbox, notifications) is wrapped and tested. Add a process-level `unhandledRejection` logger that records the error and does not exit. Long-polls must stay under `server.requestTimeout` (120 s). I recommend 25 s with a heartbeat, and they must be excluded from the Security monitor's latency figures.
6. **Capacity.** Resize to t3.small or t3.medium on 7 Dec. That is a stop/start of about 2 minutes, done before the freeze, at roughly US$0.02-0.04 an hour extra. Resize back on 10 Dec.

**Staging: one spin-up, three uses.** Build a temporary staging server from the hourly off-server copy using `RESTORE.md` section 2. It will:
- prove disaster recovery works for real, 12 days before we might need it;
- give the load test production-sized data (the real `db.json`, so the real `save()` cost);
- stay up on 9 Dec as a **warm standby** on its own hostname with its certificate already issued, so a dead primary means "restore the latest event snapshot to standby, give staff the standby URL, switch the QR redirect".

**What we take from n8n *(unverified)*:**
- Its concurrency-limited execution queue (`concurrency-control`) becomes our outbox: at most N SMTP sends in flight, retry with backoff, status per message.
- The idea of decoupling the HTTP response from the work (Form Trigger `onReceived`) means check-in answers at once and email goes out afterwards.
- We explicitly *reject* queue mode (Bull/Redis workers). A second process destroys the single-thread atomicity, and it adds infrastructure that can fail at 3 AM.

**Monitoring.** People will be in the room, so we do not need PagerDuty. We need:
- an external 1-minute uptime check on `/api/public/health`;
- an event health panel showing save duration p95, the event `seq`, open polls, oldest pending guest's wait, outbox depth and failures, and 4xx/429 counts on the event routes;
- an on-call developer at the venue, or on the phone, holding the rollback, restore and standby runbooks.

## Risks if ignored

- **Restart at peak equals total outage for staff.** A routine push on the 9th, or one unhandled rejection in the email path, restarts the process. Every staffer is signed out and has to sign in again with password and 2-step. On shared venue Wi-Fi, about 15 staff re-authenticating trips the `auth` bucket (20/min/IP) and `signin-fail` (per address). The queue stops right when 40 guests are at the door.
- **The recovery point is an hour, and the only rollback is CORE-wide.** Without event-scoped snapshots and a replayable log, recovering from a bad write or a lost instance means picking between losing an hour of seating and hand-entering everything again. Doing a whole-`db.json` restore mid-event also rolls back HR, CRM and projects for the whole company.
- **Capacity is unmeasured on a 1 GB burstable box.** If production's `db.json` is tens of MB, `JSON.stringify(data, null, 2)` on every check-in, combined with 300 polling phones, can push event-loop latency past what staff will tolerate. The existing per-IP limits (`public-write` 20/h, `api-anon` 120/min) will start returning 429s to real guests on the venue NAT. All of this must be found in a load test on staging, not at 18:40 on the 9th.

## Dependencies on other domains

- **Architect:** a per-event `seq` change log that can be replayed as commands (offline reconciliation and snapshot restore both use it). An event-only export and import that restores *one event* without touching the rest of `db.json`. Runtime toggles kept in event data, not in code. Long-poll timeout under 120 s with server-supplied `pollMs`. Email kept outside `commit()`.
- **Skeptic / Guardian:** event rate-limit buckets sized for one shared NAT address, which need numbers and the load test. A decision on whether sessions survive a restart (persisting hashed session tokens) or we accept re-sign-in and raise `auth` limits for the event window. How long PII is kept in backups: the nightly copies (30 days) and the S3 offsite copies will hold guest PII after any in-app purge.
- **Tuner:** a measured `save()` cost on production-sized data, a poll-interval budget, and the load-test profile (40 arrivals in 10 min, 300 guest pages, about 15 staff devices, a last-seat race, all from one IP).
- **Craftsman:** a stdlib-only load script (`scripts/event-load.mjs`), a multi-context Playwright journey for the last seat, and a "kill the process during arrivals" chaos test on staging.
- **Strategist:** a hard date for code freeze (7 Dec 18:00) and deploy freeze (8 Dec 12:00 to 10 Dec 09:00), with no feature work after 6 Dec.
- **Client / ICD:** the SMTP provider's sending limits and SPF/DKIM for the From address; the venue Wi-Fi details and a 4G hotspot for staff (a separate IP from guests); printers and power at the registration desk; confirmation of the final guest list by 7 Dec.

---

## Appendix A: Deployment Plan (skill: deployment-plan)

### Deployment Plan: CUSTOM APP (customapp module) and YEP 2026 event

#### Environment Matrix

| Environment | Purpose | URL | Deploy Method | Approval |
|---|---|---|---|---|
| local dev | Build and unit tests (`node --test`, `openDb(tmp)` + `handle`) | localhost:3000 | `npm start` | None |
| CI | `npm test` (about 716 tests plus new customapp tests), Playwright journeys including event journeys | GitHub Actions | On every push | None |
| staging (temporary, 28 Nov to 10 Dec) | Restore drill, load test on production-sized data, dress rehearsal, then warm standby on 9 Dec | separate hostname, own Caddy cert | Built from the S3 hourly copy (RESTORE.md section 2), then the same SSM deploy pointed at its instance ID, or a manual `update.sh` | Developer |
| production | CORE for the company, and the event | existing domain, guest page `/event/<code>` | `deploy-ec2.yml` via SSM, `ltdc-erp-deploy` | Required reviewer from 7 Dec 18:00; freeze file blocks from 8 Dec 12:00 |

Parity: staging runs the same commit, the same `ltdc-erp.service`, the same Caddy config with a different host, and a copy of production data. Before any load test, all outbound email on staging is forced to `emailPaused` or to a sink address.

#### Pipeline Diagram

```
[push] -> [npm test] -> [journeys (incl. event: guest page, last-seat race, 2 contexts, 390px)]
                                  |
                                  v
                  [deploy job: env "production"] --(reviewer gate from 7 Dec)--> [freeze-file check in remote-deploy.sh]
                                  |                                                   |
                                  v                                                   v
                     [update.sh: backup db, keep /opt/ltdc-erp-prev, restart]   (refuse if DEPLOY_FREEZE)
                                  |
                                  v
                     [smoke: /api/auth/status, /api/public/health, /api/customapp/health]
```

#### Deployment Strategy

**Method:** a single-instance restart deploy (as today) with features dark behind flags. Blue-green and canary are not worth building in 12 days on one box. Risk is contained by:

1. Shipping the module dark: CUSTOM APP is off in Admin panel → Modules until the event is configured.
2. Changing data additively only (`||=` defaults, new collections).
3. Keeping a previous-release copy so rollback takes under 1 minute.
4. Freezing early.

Rollback speed target: **under 60 s** for code (`ltdc-erp-rollback`) and **under 5 min** for event data (restore the event snapshot).

#### Timeline

| Date | Operator milestone |
|---|---|
| 27-28 Nov | Measure production `db.json` size and `save()` time over SSM. Confirm SMTP provider limits and SPF/DKIM. Build staging from the offsite copy (this is the DR drill). Write the freeze file and `/opt/ltdc-erp-prev` rollback into `update.sh` and `remote-deploy.sh`. |
| by 3 Dec | Event rate-limit buckets, event health endpoint, outbox with concurrency limit, 5-minute event snapshots, the `unhandledRejection` logger, runtime toggles, all shipped dark. |
| 4-5 Dec | Load test 1 on staging; acceptance demo with multiple devices. |
| 6 Dec | Load test 2 plus a chaos drill: kill -9 during arrivals, restore the event snapshot onto standby, run the paper reconciliation drill. No feature work after today. |
| 7 Dec | Final guest import. Resize production to t3.small or t3.medium (about 2 min outage, announced). Required reviewer on at 18:00 (code freeze; P0 fixes only). |
| 8 Dec 12:00 | `touch DEPLOY_FREEZE`. Manual off-site backup. Dress rehearsal on production using a separate "Rehearsal" event, which is then archived. |
| 9 Dec | T-3h checklist. Open registration at doors. Monitor. Close registration at the end. Final export. |
| 10 Dec 09:00 | Remove the freeze, resize back down, decommission staging (keep its final snapshot), start the PII retention timer. |

#### Rollback Checklist

- [ ] **Trigger:** 5xx on event routes more than 1% for 2 minutes; health check failing for 2 consecutive minutes; `save()` p95 above 250 ms; a capacity invariant violated (any table over 10, or one guest holding two seats); event-loop stalls reported by staff.
- [ ] **First lever (no restart):** set `selfCheckIn=false` (staff-only), `emailPaused=true`, raise `pollMs`. If the module itself is faulty, turn CUSTOM APP off in Admin panel → Modules. The rest of CORE keeps running.
- [ ] **Code rollback:** `sudo ltdc-erp-rollback` swaps in `/opt/ltdc-erp-prev` and restarts. If it is not available: `git revert <sha> && git push`, then approve the deploy (about 15 min). Both restart the process and sign staff out, so announce "sign in again" to staff first.
- [ ] **Event data rollback:** stop staff writes (`selfCheckIn=false` and an event `readOnly=true`), then restore the most recent good `data/backups/events/<event>-<HHMM>.json` through the event import (one event only). Replay the change log after that point, or re-enter it from paper. Never restore the whole `db.json` during the event unless the instance itself is lost.
- [ ] **Instance lost:** restore the latest event snapshot from the command-desk laptop onto the warm standby. Staff switch to the standby URL. The QR destination (a short redirect we control) is pointed at standby. Reconcile into production after the event.
- [ ] **Verify:** `/api/public/health` is OK; the event health panel shows `seq` advancing; the capacity self-check passes (no table over 10, no duplicate seats); one test check-in on the rehearsal guest goes through.
- [ ] **Notify:** command desk (Super Administrator) by voice and radio, then the staff group chat: "Use paper sheets for your tables until told otherwise." Post-mortem by 11 Dec.

#### Feature Flag Plan

| Flag Name | Type | Default | Rollout Plan | Cleanup Date |
|---|---|---|---|---|
| `modules.customapp` (Admin panel → Modules) | ops kill switch | off | On when the YEP event is configured (about 3 Dec) | Permanent (module switch) |
| `event.registrationOpen` | release / ops | false | On at doors on 9 Dec; off at close | Permanent per event |
| `event.selfCheckIn` | ops (degrade) | true | Off when the guest page misbehaves: staff-only assisted check-in | Permanent per event |
| `event.emailPaused` | ops kill switch | false (true on staging) | On if SMTP fails or gets throttled; the outbox holds messages and resends later | Permanent per event |
| `event.pollMs` | ops tuning | 4000 guest / 3000 staff | Raised under load (server-supplied with every response) | Permanent per event |
| `event.readOnly` | ops (recovery) | false | On during a restore or reconciliation, and after the event | Permanent per event |
| `DEPLOY_FREEZE` file | ops | absent | Created 8 Dec 12:00, removed 10 Dec 09:00 | Mechanism permanent |

#### Health Checks

| Check | Type | Endpoint/Method | Interval | Failure Threshold |
|---|---|---|---|---|
| Liveness | external uptime | `GET /api/public/health` | 60 s | 2 consecutive |
| Readiness after deploy | post-deploy | `update.sh` loop on `/api/auth/status` (exists) plus `/api/customapp/health` | on deploy | 10 s |
| Event health | dashboard (SA command desk) | `GET /api/customapp/events/:id/health` (perm: event SA): save p95, `seq`, open polls, oldest pending wait, outbox depth/failures, 429 count | 10 s | Alert banner if oldest wait > 3 min, outbox failures > 5, save p95 > 100 ms |
| Invariant self-check | in-process | Every 60 s: count per table ≤ 10, no seat held twice, one SA per event | 60 s | Any violation: red banner, audit entry |
| Smoke | post-deploy and T-3h | Rehearsal guest: verify, check in, seat, see status, email to sink | on deploy and T-3h | Any failure |
| Snapshot freshness | dashboard | age of the newest `data/backups/events/*` and of the laptop's last download | 60 s | > 10 min |

#### Database Migration Plan

| Migration | Type | Reversible | Run When | Dependencies |
|---|---|---|---|---|
| Add `caEvents`, `caTables`, `caGuests`, `caLog`, `caOutbox`, `customapp` config to `emptyData()` and `openDb` (`||=`) | expand | yes. Older code keeps unknown top-level keys because `save()` writes all of `data` (to be verified by a test) | at first boot of the new version | none |
| Add `customapp` to `MODULES` / `MODULE_API` (incl. `/api/public/event`) | expand | yes | same release | `test/modules-roadmap.test.js` updated |
| Event import (CSV/XLSX) | data load | yes (delete the event) | 3 Dec dry run; 7 Dec final | ICD final list |
| Optional: hashed session persistence | expand (new file `data/sessions.json`) | yes | only if Skeptic/Guardian approve before 3 Dec | Offsite manifest is unaffected (local only) |

No contract (destructive) migrations before 10 Dec.

---

## Appendix B: Event-day runbook (T-3h to close)

**T-3h (15:00)**
1. `DEPLOY_FREEZE` exists; the GitHub reviewer gate is on.
2. Run an off-site backup by hand and confirm it in the Security monitor.
3. The latest event snapshot is under 5 minutes old; the laptop has downloaded the export.
4. Smoke-test the rehearsal guest end to end.
5. Print the event pack:
   - A to Z guest list with classification, owner and preferred table and seat;
   - one sheet per table;
   - one sheet per staffer (their delegated guests and tables form their pre-partitioned offline range);
   - blank reconciliation sheets.

   Mark each page "as of HH:MM".
6. Check every staff device: each one is signed in, uses the 4G hotspot (not guest Wi-Fi), is charged, and has a power bank.
7. Fire a test email and confirm it arrives.

**Doors**
- Set `registrationOpen=true`.
- Watch the event health panel.
- The on-call developer sits next to the Super Administrator.

**Degrade ladder:**
1. Raise `pollMs`.
2. Pause email.
3. Turn self check-in off (staff-only).
4. Go to paper by partition.
5. Fail over to standby.

**Reconciliation:**
- Turn on `readOnly`.
- The SA enters paper allocations in owner order through the normal commands. Capacity and duplicate checks still apply, and conflicts go to the SA queue.
- Export, compare against the paper totals, then turn `readOnly` off.

**Close**
- Set `registrationOpen=false`.
- Take the final export (CSV) and a final snapshot.
- Run an off-site backup by hand.
- Put a retention date on the event record.
