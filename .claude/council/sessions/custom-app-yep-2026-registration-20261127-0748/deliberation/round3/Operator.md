## Operator Final Position: YEP 2026 Registration & Table Assignment on CORE production

**Lens:** orange. How we deploy it, watch it, roll it back, and what happens when it fails at twice the load.
**Grounding:** my Round 1 and Round 2 files; the Round 2 responses from Architect and Strategist; the Round 3 finals from Architect and Strategist; and fresh reads of:
- `deploy/aws/update.sh:27-44` (stop, `rsync --delete`, start, no previous release kept);
- `deploy/aws/remote-deploy.sh` (it reinstalls the offsite and restore-check units from the repo on every deploy);
- `deploy/aws/ltdc-erp-offsite.timer` (`*:05`, hourly);
- `deploy/aws/Caddyfile` (no `log` directive, so Caddy keeps no access log);
- `deploy/aws/RESTORE.md` sections 1 and 2 (both restore by copying `db.json` straight onto disk);
- `server/api.js:419-431` (`replaceData` carve-outs);
- `server.js:70` (the monitor keys requests by path with the query string removed).

n8n patterns are from model knowledge only, because no clone exists in this workspace *(unverified)*.

---

**Revised recommendation:** Run the event on the current CORE production with the event data inside `db.json` (the `ca*` collections). That production is protected by a small operations layer that is **shipped on 28 Nov, before the first Tier 0 push**:
- a deploy freeze guard;
- a kept previous release with a one-command rollback;
- an `unhandledRejection` logger.

Everything else is either folded into the tier items that Strategist already owns (three flags plus `readOnly`, the 5-minute export copy, the dashboard health strip) or is operator time:
- measure on 28 Nov;
- staging restored from S3 between 1 and 3 Dec, which is the restore drill;
- load tests on 4 and 6 Dec;
- resize on 7 Dec;
- freeze on 8 Dec;
- offsite copies every 15 minutes on 9 Dec.

The night runs on a rehearsed degrade ladder:
1. raise `pollMs`;
2. pause email;
3. close the guest page;
4. go to paper by partition;
5. go to standby.

None of these steps needs a deploy.

---

### Concessions made

1. **Storage stays in `db.json`, and I accept Architect's carve-out in place of my event-only import.** In Round 2 Architect and I crossed over: he moved to a per-event store while I moved to the shared file. The Round 3 resolution is the `replaceData()` carve-out. It is one line, it follows the existing precedent for `devlog`, `guideEdits`, helpdesk, CRM and Projects, and a test checks it. That closes the "Admin restore erases check-ins" hole more cheaply than either my event import or his `state.json` and `log.jsonl` pair. I give up the event-only import and the restore endpoint before 9 Dec. Recovery means corrections through normal commands, or the standby. *Why:* a recovery tool built in a hurry, which overwrites live event data and is only ever used under pressure, is a bigger 3 AM risk than the gap it fills.
2. **Short poll, not long-poll.** I drop the 25 s long-poll, its heartbeat and the exclusion from the Security monitor. The `wait` parameter is reserved. *Why:* this removes the `server.requestTimeout` (120 s) interaction completely, and `pollMs` gives me the same lever under load.
3. **Persisted sessions are not needed.** A restart still signs every staffer out. I accept that, because the freeze removes deploy restarts and the logger removes the most likely crash. Skeptic's NAT-sized `auth` bucket and staff on the 4G hotspot make the re-sign-in survivable. *Why:* changing the VAPT-hardened `auth.js` 10 days out is the riskier move.
4. **No QR-redirect host, and standby is for staff only.** If the primary is lost, guests are checked in by staff at the desk. *Why:* DNS and redirect machinery for one evening does not pay for itself.
5. **The health panel becomes a strip on dashboard #20**, not a second screen. Process health comes from the existing Security monitor plus a free external 1-minute uptime check. *Why:* I would rather instrument what the Super Administrator will actually look at.
6. **The 60 s invariant self-check stays as Strategist placed it (Tier 1, XS).** I had cut it to "on demand" in Round 2, and I withdraw that cut. It is the oracle for the load test and the reconciliation check.
7. **`readOnly` stays.** I cut it in Round 2. Architect and Strategist both keep it at one line in `commit()`, and the Super Administrator needs it during a reconcile. I side with them.
8. **The trigger for splitting the store is latency, not size:** above 50 ms, pull the levers; above 150 ms on 30 Nov, split. This is the gate that Architect and Strategist adopted. I hold to it and do not reopen it.

### Non-negotiables (before production on 9 Dec)

1. **On 28 Nov, before any Tier 0 push**, these three are merged and deployed:
   - **(O1)** a freeze guard as the first line of `remote-deploy.sh` that does real work. It must run before the unit reinstall and `update.sh`. Override: `DEPLOY_FREEZE_OVERRIDE=<reason>` passed in from the workflow input and written to the audit/devlog.
   - **(O2)** `update.sh` copies `$APP` (excluding `data/`) to `/opt/ltdc-erp-prev` before `rsync --delete`, plus `ltdc-erp-rollback`.
   - **(O3)** `process.on('unhandledRejection')`, which logs, records to the monitor and does not exit, with one test.

   The freeze guard only protects deploys that run after it is installed, so it cannot wait for 1 Dec.
2. **On 28 Nov, on a copy of production**, measure `db.json` size and `save()` p50 and p95 **(O4)**. Send the numbers to Architect, Tuner and Strategist for the 30 Nov storage gate.
3. **The restore carve-out has a matching runbook line.** The `replaceData()` carve-out protects only the Admin panel path. `RESTORE.md` sections 1 and 2 copy `db.json` straight onto disk, so they bring the backup's `ca*` with them:
   - **Section 1** ("go back an hour" on the live server) rolls check-ins back. It gets a boxed warning: forbidden while an event is `live`, use the standby instead.
   - **Section 2** (new server) bringing `ca*` across is exactly what we want for the standby.
   - **Edge case:** the carve-out must not drop a backup's events when the live server has none. That is the standby case if someone uses Admin restore there. The rule is to keep the live `ca*` only when the live data holds at least one event, and a test covers it.
4. **Staging is restored from the S3 offsite copy by 3 Dec** using `RESTORE.md` section 2. That is the drill. Staging then becomes the load target and the warm standby, with its own hostname and certificate issued in advance. Load test run 1 happens on **4 Dec**, and run 2 with `kill -9` on **6 Dec**.
5. **The freeze is on in two places:**
   - the GitHub `production` environment reviewer gate from 7 Dec 18:00;
   - `touch /opt/ltdc-erp/data/DEPLOY_FREEZE` at 8 Dec 12:00, removed 10 Dec 09:00.

   At least 4 real production deploys exercise the guard and the kept release before 7 Dec, including one deliberate rollback.
6. **Four runtime levers work with no deploy** and are each demonstrated on 5 Dec:
   - `registrationOpen`;
   - `emailPaused`;
   - `pollMs`, returned in every poll response;
   - `readOnly`.

   The module kill switch already exists (Admin panel → Modules).
7. **The guest status token never reaches a log.**
   - Caddy has no `log` directive today, and none may be added during the event window.
   - The monitor already removes query strings (`server.js:70`), and a test asserts that `t=` never appears in monitor, audit or devlog output.
   - Check that the app's `Referrer-Policy: no-referrer` on the status route is not overwritten by Caddy's `Referrer-Policy same-origin` header block (verify on staging with `curl -I`). If Caddy wins, add `defer` or exclude the path.
8. **Recovery point on the night is at most 5 minutes on the box and at most 15 minutes off it:**
   - the 5-minute export copy to `data/backups/events/`, keeping the last 24;
   - the laptop pulls the export every print cycle;
   - offsite every 15 minutes during the window.

   Freshness of each is shown on the #20 health strip.

### Implementation notes

**A. 28 Nov ops half-day (code, about 0.5 dev-day, in this order)**

```bash
# remote-deploy.sh, immediately after the "is it installed" check, before any unit install
if [ -f "$APP/data/DEPLOY_FREEZE" ] && [ -z "${DEPLOY_FREEZE_OVERRIDE:-}" ]; then
  echo "Deploys are frozen ($(cat "$APP/data/DEPLOY_FREEZE")). Nothing was changed."; exit 3
fi
# update.sh, before `systemctl stop`
rm -rf /opt/ltdc-erp-prev && rsync -a --exclude /data/ "$APP/" /opt/ltdc-erp-prev/
# /usr/local/sbin/ltdc-erp-rollback: stop; rsync -a --delete --exclude /data/ /opt/ltdc-erp-prev/ $APP/; same chown/chmod as update.sh; start; health loop
```

- The workflow step that calls SSM needs an optional `freeze_override` input. Without it, the job fails red, so a blocked deploy is visible and not silent.
- Exit code 3 must surface as a failed deploy job.
- `unhandledRejection` handler: `console.error` with the stack, `monitor.record('process','unhandledRejection')`, no `process.exit`. Leave `uncaughtException` at Node's default (exit, then systemd restarts in 3 s), because the state is undefined after one.
- Dry-run `ltdc-erp-rollback` on staging once it exists (1-3 Dec), and on production once in the 4 deploys before 7 Dec.

**B. 28 Nov measurements (operator time over SSM, read-only)**
- `ls -l /opt/ltdc-erp/data/db.json`.
- Time `JSON.stringify(data, null, 2)` and `writeFileSync` on a copy in `/tmp`, 50 runs, p50 and p95.
- Check `free -m` and the instance type.
- **Check for an Elastic IP** (`aws ec2 describe-addresses`). If there is none, a resize stop/start changes the public IP. Then either allocate one first, which is a 5-minute DNS change done that day, or skip the resize.
- Decision ladder (shared with Architect and Strategist):

  | `save()` p95 | Action |
  |---|---|
  | Under 50 ms | Nothing to do |
  | 50 to 150 ms | Compact JSON, then 2 s debounced outbox status writes, then resize to t3.small on 7 Dec |
  | Above 150 ms on 30 Nov | Split |

**C. Staging, which is also the drill and the standby (1 to 3 Dec, about 3 h operator time)**
- Follow `RESTORE.md` section 2 from the latest offsite copy, onto the same instance type as production after its resize.
- Before first start: set the event `emailPaused=true` and the helpdesk SMTP to a sink address, so a load test can never email real guests.
- Note the time each step takes. That becomes our measured RTO for the night, and the target is under 30 minutes from "primary lost" to "staff on standby URL".
- Keep it running until 10 Dec. The cost is about US$0.30 a day. On 9 Dec, top it up from the newest offsite copy at T-3h. That puts the standby URL in the runbook.

**D. Offsite every 15 minutes during the window, without a deploy**
- `remote-deploy.sh` reinstalls `ltdc-erp-offsite.timer` from the repo on every deploy, but it does not touch drop-ins.
- On 8 Dec, after the last deploy: `systemctl edit ltdc-erp-offsite.timer` with `OnCalendar=` and `OnCalendar=*:05/15`. Then `systemctl daemon-reload`, then `systemctl list-timers` to confirm.
- Remove it on 10 Dec. The drop-in survives because the freeze means no deploys run in between.

**E. Load tests (Craftsman's stdlib `scripts/event-load.mjs`, run from one source IP)**

| Run | Date | Profile | Pass |
|---|---|---|---|
| 1 | 4 Dec, evening | 300 guest status pages at `pollMs` 4 s with jitter; 15 to 30 staff boards at 2 s; 40 verify-and-check-in in 10 min; last-seat race on 3 contexts | Zero 429s to legitimate guests; `save()` p95 under 100 ms; event-loop delay p99 under 200 ms; invariant scan clean |
| 2 | 6 Dec, real list | Same as run 1, plus `systemctl kill -s KILL ltdc-erp` at minute 5 | Staff back in, or on paper, within 3 min; reconciliation through commands gives zero violations; no lost committed check-in (compare against the export taken just before) |

**F. Event-day runbook (goes into `docs/guides` with #22 and #23)**

*T-3h*
1. `DEPLOY_FREEZE` is present and the reviewer gate is on.
2. Check the offsite drop-in with `list-timers`.
3. Run a manual offsite backup, then confirm it in the Security monitor.
4. Top up the standby from the newest copy.
5. Smoke test on the rehearsal guest: verify, check in, seat, status, email to the sink.
6. Newest export under 5 min old, and the laptop has pulled it.
7. Print the pack, with every page marked "as of HH:MM".
8. Check staff devices: signed in, on 4G, charged.

*Doors*
- Set `registrationOpen=true`.
- The on-call developer sits beside the Super Administrator with `ltdc-erp-rollback`, this runbook and the standby URL.

*Triggers to act on*

| Signal | Threshold |
|---|---|
| 5xx on event routes | Above 1% for 2 min |
| External uptime check | 2 consecutive failures |
| `save()` p95 | Above 250 ms |
| Oldest pending guest | Waiting more than 3 min |
| Email | More than 5 failures |
| Invariant self-check | Any red |
| Free disk | Under 1 GB |

*Degrade ladder* (each step is reversible and none needs a deploy)
1. `pollMs` raised to 8 s guest and 4 s staff.
2. `emailPaused`.
3. `registrationOpen=false`: staff-only, assisted check-in.
4. Paper by partition, with `readOnly` on.
5. Standby: staff URL only, then replay the paper sheets and newest export as commands through `commit()`.

Never run `RESTORE.md` section 1 while an event is `live`.

*Close*
1. Set `registrationOpen=false`.
2. Take the final CSV and JSON export.
3. Run a manual offsite backup.
4. Set a retention date on the event.

*10 Dec, 09:00*
1. Remove the freeze and the drop-in.
2. Resize back.
3. Take a final snapshot of staging, then decommission it.
4. Start the PII purge clock (Guardian #33). It covers the `ca*` records in `db.json`, the 30 nightly copies, the event export copies and the offsite bucket lifecycle.

**G. n8n patterns, operations side *(unverified)***
- **Concurrency-limited execution:** becomes the outbox drain, with at most N SMTP sends in flight, retry with backoff and a status per message.
- **Form Trigger "respond on received":** check-in replies straight away, and email goes out later, outside `commit()`.
- **Rejected: queue mode (Bull/Redis workers) and multi-main.** A second process breaks single-thread atomicity and adds a Redis that can fail at 3 AM. This is unanimous across the council.

**H. Cost**
- Resize to t3.small for about 3 days: about US$1.
- Staging and standby for about 10 days: about US$3 to US$5.
- Offsite every 15 minutes for one day: a negligible number of S3 PUTs.
- External uptime check: free tier.
- Total: under US$10.
