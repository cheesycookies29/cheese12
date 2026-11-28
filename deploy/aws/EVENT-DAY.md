# YEP 2026 event-day runbook (CUSTOM APP on CORE)

For the **on-call developer** and the event's **Super Administrator**. Print it (it is written to be
read on paper), fill in the blanks below in pen, and keep it beside the event laptop from 4 December
to 10 December. Every command is meant to be copied exactly. Desk staff do not need this page: they
use the staff desk card and the guide (*Help & guides → Running an event in CUSTOM APP → If the
system is down*).

Production is `https://ltdc-core.com` (one EC2 server, Ubuntu, the app in `/opt/ltdc-erp`, the
service `ltdc-erp`, Caddy in front). Staging is a separate server built from production's off-server
copy; it is the load-test target and, on the night, the **warm standby**.

## Fill in before 4 December

| | |
|---|---|
| Doors open (9 Dec) | ____ : ____  (T-3h is ____ : ____) |
| Event closes (9 Dec) | ____ : ____ |
| On-call developer | name ______________________  phone ______________________ |
| Super Administrator (event) | name ______________________  phone ______________________ |
| CORE administrator for break-glass (can hand over the Super Administrator) | name ______________________  phone ______________________ |
| Client contact | name ______________________  phone ______________________ |
| Staging / standby address | https://______________________________ |
| Staging instance ID | i-______________________ |
| Production instance ID | i-______________________ |
| Uptime checker (what and where it alerts) | ______________________________ |
| SMTP sink for staging and the rehearsal guest | ______________________________ |
| 4G hotspot for staff devices | ______________________________ |

## If something breaks (keep this page on top)

Reach the server through **AWS console → EC2 → Instances → (the instance) → Connect → Session
Manager → Connect**. No SSH key is needed. Type `bash` first, then the commands below.

| What you see | Who | Do this |
|---|---|---|
| Staff signed out all at once, CORE answers again within seconds | Staff | Nothing broke for good: CORE restarted (systemd starts it in 3 s). Sign in again; you land back on your queue. Check-ins and seats made before are kept. |
| `502 Bad Gateway` or the page does not load for more than 1 minute | On-call developer | `sudo systemctl status ltdc-erp --no-pager` then `sudo journalctl -u ltdc-erp -n 50 --no-pager`. If it is stopped: `sudo systemctl restart ltdc-erp`. Meanwhile the desk works from the offline pack (degrade step 4). |
| It keeps crashing after every restart, and the log shows the same error from the new code | On-call developer, with the Super Administrator | `sudo ltdc-erp-rollback` (back to the release before the last deploy, about 1 minute; the data folder is not touched; everyone signs in again). `sudo ltdc-erp-event status` shows which version it goes back to. |
| The server itself is gone (instance stopped, unreachable, disk full and not fixable in 5 minutes) | On-call developer | Standby: staff use the standby address (desk card), the desk keeps the paper. Afterwards the paper and the newest export are entered as commands (degrade step 5). Guests' QR pages do not move: guests go to the desk. |
| Event control → Health: **save time** above 250 ms, or **too many requests** rising | Super Administrator | Degrade step 1: **Refresh interval** to `4000`. |
| A red **seating rules** banner (Event control or Security monitor) | Super Administrator, then on-call developer | Do not undo anything by hand. Call the on-call developer. Read the banner: it names the table or guest. Fix on screen (move or send back to waiting) once you know which one is right. |
| More than 5 failed seat emails | Super Administrator | Degrade step 2: **Email paused**. Staff tell guests their table. |
| Guests waiting for a table more than 3 minutes | Super Administrator | Event control → **Staff and their queues**: give a slow person's guests to someone else (**All to…**), or seat them yourself. |
| Free disk under 1 GB (`sudo ltdc-erp-event status`) | On-call developer | `sudo du -sh /opt/ltdc-erp/data/* \| sort -h \| tail` and remove old `data/backups/db-before-update-*` copies only (never `db.json`, `secret.key` or the event copies of today). |
| Anyone suggests copying an old `db.json` over the server (RESTORE.md §1) | Everyone | **No. Never while the event is Live.** It would roll back every check-in. Use the export, the paper and the standby. |

**Degrade ladder** (one step at a time; each can be undone; none needs a deploy; the Super
Administrator changes the switches in **Event control → Switches**):

1. **Refresh interval** to `4000` (staff screens every 4 s, waiting guests every 8 s).
2. **Email paused** (tables shown on screen and told by staff).
3. **Self check-in open** OFF: the desk checks everyone in (staff-assisted only).
4. **Paper** by owner: each staff member works from their own sheet in the offline pack, and the Super
   Administrator turns **Read only** ON. When CORE is back: **Reconcile paper seating**, then Read only OFF.
5. **Standby** (staff URL only), then enter the paper sheets and the newest export as commands
   (Reconcile paper seating on the standby). Guests are never sent to the standby.

## Who does what

- **On-call developer**: the servers (production, staging), every command on this page, the load
  tests, watching the Security monitor, the standby. Sits beside the Super Administrator from T-3h
  until the close, with this page, the laptop (signed in to AWS and to CORE) and the standby address.
- **Super Administrator**: Event control (counts, exceptions inbox, staff queues, health), the
  switches, the offline pack, paper reconciliation, the final export. Decides each degrade step with
  the on-call developer.
- **CORE administrator (break-glass)**: reachable on the night; only job is **Hand over the Super
  Administrator** if the Super Administrator's account or device is lost.
- **Desk staff**: check guests in, seat their own guests at their own tables, work from paper when
  told, sign in again after a restart.

## The week before

### 1-3 Dec: build staging (the restore drill) and time it (AC-183, AC-184)

Staging is a second EC2 server of the **same instance type** as production, with its own address
and certificate, running the same release as production (0.74.3 or later: the load test reads the
server's numbers from it). Build it with **RESTORE.md §2** from the latest off-server copy, with these
additions, and write the clock time at each step: the total from "start" to "staff can sign in on the
standby address" is the measured RTO (target under 30 minutes).

| Step | Started | Done |
|---|---|---|
| EC2.md Parts 1-5 on the new server (its own address; do not create the first administrator) | | |
| IAM role **ltdc-erp-server** attached (RESTORE.md §2 step 2; it needs it to fetch the copy) | | |
| Server key put back (RESTORE.md §2 step 3) | | |
| Latest copy fetched and put in place (RESTORE.md §2 step 4, **stop before** `systemctl start`) | | |
| Mail off and every event's email paused (below), then `sudo systemctl start ltdc-erp` | | |
| Staff sign in on the staging address | | |

Before the **first start** of staging (and again after every top-up), make the copy unable to email
anyone: the service desk mailbox and outgoing mail off, the Projects digest off, and every event's
**Email paused** on. In the Session Manager window, with CORE stopped:

```bash
sudo systemctl stop ltdc-erp
sudo -u ltdc node -e '
const fs = require("fs"); const f = "/opt/ltdc-erp/data/db.json"; const d = JSON.parse(fs.readFileSync(f, "utf8"));
if (d.helpdesk?.mailbox) d.helpdesk.mailbox.enabled = false;
if (d.helpdesk?.outgoing) { d.helpdesk.outgoing.enabled = false; d.helpdesk.outgoing.events = false; }
if (d.pm?.digest) d.pm.digest.enabled = false;
for (const e of d.caEvents || []) e.flags = { ...e.flags, emailPaused: true };
fs.writeFileSync(f, JSON.stringify(d), { mode: 0o600 });
console.log("Staging: mail off, digest off, email paused on", (d.caEvents || []).length, "event(s).");'
sudo systemctl start ltdc-erp
```

Then, on staging only, stop its own off-server backups and restore checks (it would otherwise copy
staging's data into **production's** backup bucket):

```bash
sudo systemctl disable --now ltdc-erp-offsite.timer ltdc-erp-restore-check.timer || echo "Not installed here: nothing to stop."
```

**Top up staging** (6 Dec morning, and T-3h on 9 Dec): the newest production copy over staging's
data, without starting CORE on it before the mail-off step. The folder is the newest one in **S3 →
ltdc-erp-backups-… → hourly → the day → the hour** (or a minute folder in it on 8-9 Dec):

```bash
R="$(sudo -u ltdc mktemp -d /opt/ltdc-erp/data/restore-XXXXXX)"
cd /opt/ltdc-erp && sudo -u ltdc node scripts/offsite-fetch.js hourly/2026-12-09/16/20 "$R"
sudo systemctl stop ltdc-erp
sudo cp "$R/db.json" "$R/audit-log.jsonl" "$R/audit-head.json" /opt/ltdc-erp/data/
sudo chown -R ltdc:ltdc /opt/ltdc-erp/data && sudo rm -rf "$R"
```

then the mail-off block above (it starts CORE).

To test seat emails on staging, point **IT Service Desk → Settings → Sending email** at the SMTP sink
from the table above (never a real mail server), and keep **Email paused** on for every event except
when you deliberately test the sink.

Keep staging running until 10 Dec (it is the standby).

### 4 Dec: load test 1 (AC-185 to AC-189)

From the on-call developer's laptop, on one network (the whole ballroom is behind one address, so
the load comes from one address too), with the repository checked out at the release on production:

```bash
cd ltdc-erp            # the repository
read -rs LT_PASSWORD && export LT_PASSWORD     # type the staging administrator's password, Enter
node scripts/event-load.mjs --url https://STAGING-ADDRESS --user ADMIN-USERNAME --password-env LT_PASSWORD \
  --report load-test-1.json
```

- It refuses production addresses and any event whose **Email paused** is off.
- If the account uses 2-step verification, it asks for the code once (and again if CORE restarts).
- It makes an event *Load test …* of 25 tables of 10 with 250 synthetic guests (addresses
  `…@loadtest.invalid`) and 15 synthetic staff accounts `loadtest-staff-01…`, opens self check-in,
  then for 10 minutes plays the ballroom: guests on the guest page (some mistype first), guests at the
  desk, staff seating from My queue, the Super Administrator on Event control. About 13 minutes in all.
- It ends with a table per endpoint and **PASS** or **FAIL** per gate:

| Gate | Pass mark |
|---|---|
| AC-186 | zero 429 (Too many requests) to guests and staff |
| AC-187 | `save()` p95 under 100 ms (from the server, `GET /api/admin/perf`) |
| AC-188 | event-loop delay p99 under 200 ms (from the server) |
| AC-189 | rules scan clean: no overbooked table, duplicate check-in, double seat, reservation released by expiry; exactly one Super Administrator |
| ERR | no 5xx or unanswered requests |

If a gate fails: keep the report, raise **Refresh interval** for the night if it was load, fix and
run again before 6 Dec. The presence key (US-016) is turned on only if this passes. Clean up when
done (it archives the event and disables the synthetic accounts):

```bash
node scripts/event-load.mjs --url https://STAGING-ADDRESS --user ADMIN-USERNAME --password-env LT_PASSWORD \
  --event EVENT-ID-FROM-THE-REPORT --cleanup-only
```

### 5 Dec: client acceptance demo

All 12 scenarios on several devices; show the four switches working with no deploy (AC-181, AC-182).
Record the sign-off.

### 6 Dec: load test 2, the kill -9 drill and the dress rehearsal (AC-190 to AC-197)

Morning: **top up staging** (above), so it holds the real guest list.

1. **Hand over the Super Administrator** of the YEP event on staging to the on-call developer's
   administrator account (**Event control → Hand over the Super Administrator**, by a CORE
   administrator). Time it with a stopwatch from opening the event: under 2 minutes (AC-193).
2. **Load test 2 with the kill drill**, on the real list, leaving 10 guests for the paper step:

   ```bash
   node scripts/event-load.mjs --url https://STAGING-ADDRESS --user ADMIN-USERNAME --password-env LT_PASSWORD \
     --event YEP-EVENT-ID --guests 240 --kill-at 5 --report load-test-2.json
   ```

   At minute 5 it takes the event export and prints **KILL NOW**. In the staging Session Manager
   window, at once:

   ```bash
   sudo systemctl kill -s KILL ltdc-erp
   ```

   systemd starts CORE again; the script's staff sign in again and carry on. Its extra gates:
   **AC-190** staff back in within 3 minutes of the kill, **AC-191** no check-in lost compared with
   the export taken just before. Guests owned by real staff accounts are seated by the Super
   Administrator session; the synthetic staff work the desk. If the event has the presence key on,
   add `--qr-key KEY` (else every guest goes to the desk).
3. **Restore attempt while the window is open** (AC-192): note Event control's counts and change
   number, then **Admin panel → Backup & restore** and restore a backup downloaded earlier that day.
   The event's counts and change number must be exactly as before.
4. **Paper reconciliation** (AC-194): from the offline pack, write paper lines for the 10 guests the
   script left (time, ref, table, chair), turn **Read only** on, **Reconcile paper seating**, Read
   only off, then **Seating rules check**: zero problems.
5. **Freeze candidate** (AC-195, AC-196), in the repository:

   ```bash
   FUZZ_SEEDS=1000 node --test test/customapp-fuzz.test.js
   for i in 1 2 3 4 5; do node --test test/customapp-race.test.js || break; done
   git tag -a yep2026-candidate -m "YEP 2026 freeze candidate" && git push origin yep2026-candidate
   ```

6. **Dress rehearsal** (AC-197) on staging with the real staff accounts, their phones and 2-step
   sign-in, volunteers as guests. Stopwatch: QR scan to "checked in", median under 30 s. Then
   download **Event export (JSON)** and compute checked-in-to-seated (p90 under 2 minutes at peak;
   put the rehearsal's start time in UTC):

   ```bash
   node -e 'const e = require(require("path").resolve(process.argv[1])); const d = e.guests.filter((g) => g.arrival?.state === "checked_in" && g.seat?.status === "confirmed" && g.arrival.at >= process.argv[2]).map((g) => (Date.parse(g.seat.at) - Date.parse(g.arrival.at)) / 1000).filter((x) => x >= 0).sort((a, b) => a - b); const p = (q) => d[Math.min(d.length - 1, Math.ceil(q * d.length) - 1)]; console.log(d.length, "guests; checked in to seated p50", p(0.5), "s, p90", p(0.9), "s");' EXPORT.json 2026-12-06T02:00:00Z
   ```

Afterwards hand the staging Super Administrator back (or leave it: staging is rebuilt at T-3h).

### 7 Dec, 18:00: code freeze (AC-198)

- **Before anything else:** `sudo ltdc-erp-event status` works on **production** (it came with
  0.74.3). It must be there before 8 Dec: once the freeze is on, no deploy can bring it.
- GitHub → **Settings → Environments → production**: **Required reviewers** on (EC2.md, "Approve
  each deploy").
- Tag the release that is on production: `git tag -a yep2026-event -m "YEP 2026 event build" <commit> && git push origin yep2026-event`.
  (Tags do not deploy.)
- If the 30 Nov storage gate asked for a bigger instance: check the Elastic IP is attached first
  (**EC2 → Elastic IPs**), then resize (stop, **Actions → Instance settings → Change instance type**,
  start). Fixes only from here on, each with a test that failed before it.

## 8 Dec: freeze, full backup, 15-minute backups, print

At **12:00**, on production (Session Manager):

```bash
sudo ltdc-erp-event freeze 2026-12-10T09:00:00+08:00 "YEP 2026 (9 Dec); lifted at the 10 Dec close-out"
```

Check it (AC-199): push an empty commit; the tests run on GitHub, the deploy job (after its review)
must fail saying **Deploys are frozen until …**, and production must not restart:

```bash
git commit --allow-empty -m "Freeze check: this deploy must fail with exit 3" && git push
```

**Full backup**, all three:

1. **EC2 → Volumes → (production's volume) → Actions → Create snapshot**, named `yep2026-8dec`.
2. **Admin panel → Backup & restore → Download backup**, saved on the event laptop.
3. The 15-minute off-server backups, which also take one copy now (AC-200):

   ```bash
   sudo ltdc-erp-event backups-every-15
   ```

   It ends with **Done: backups now run every 15 minutes** and the timer's next run (5, 20, 35 or 50
   past). Copies after the hour's first go into minute folders: `hourly/2026-12-09/19/20/`.
   Confirm in **Admin panel → Security monitor → Software status** (off-server backup: *Last copy
   just now*).

Print the **offline pack** (**Event control → Offline pack (print)**) as a first set, and the desk
cards (guide: *If the system is down*), with the standby address written in.

## 9 Dec: the event

### T-3h checklist (AC-201): tick each one

- [ ] `sudo ltdc-erp-event status` on production says: **Deploy freeze: ON**, **EVERY 15 MINUTES**, last
      off-server backup **OK**, **Rollback: ready**, free disk over 1 GB, **CORE: answering**.
- [ ] GitHub production reviewer gate on (Settings → Environments → production).
- [ ] A manual off-server backup now: `sudo systemctl start ltdc-erp-offsite.service`, then **Security
      monitor → Software status** shows it (*just now*).
- [ ] Standby topped up (*Top up staging*, 1-3 Dec section) from the folder just written (the newest
      `hourly/2026-12-09/…`), mail-off step included; staff can sign in on the standby address.
      Time: ____ : ____
- [ ] Smoke test on production with the rehearsal guest: guest page verify, check in, seat, the
      guest page shows the table, the seat email arrives at the sink address (Email paused off just
      for this, then as decided), then undo the check-in and release the seat.
- [ ] The newest event export (**Health → 5-minute copy**) is under 5 minutes old, and **Event export
      (JSON)** is downloaded to the laptop. Time: ____ : ____
- [ ] Offline pack printed now; every page stamped *as of* ____ : ____
- [ ] Staff devices: signed in, on the 4G hotspot, charged (and a charger at the desk).
- [ ] Easel card under the reception QR; staff desk cards with the standby address.
- [ ] Uptime checker on `https://ltdc-core.com/api/public/health`, alerting the on-call developer.
- [ ] Event control open on the laptop; Security monitor open in a second tab.

### Doors

Super Administrator: **Event control → Switches → Self check-in open** ON. Note the time: ____ : ____

### During the event

The on-call developer watches **Admin panel → Security monitor** (errors and response times by route,
the seating rules line, the off-server backup line) and every 15 minutes runs `sudo ltdc-erp-event status`.
The Super Administrator watches **Event control** (counts, **Exceptions**, **Staff and their
queues**, **Health**). Re-download **Event export (JSON)** to the laptop every 30 minutes, and print
the pack again if much has changed.

Act on any of these (then the degrade ladder on page 1, one step at a time):

| Signal | Where it shows |
|---|---|
| 5xx on event pages above 1% for 2 minutes | Security monitor (traffic, errors by route) |
| 2 failed uptime checks in a row | the uptime checker's alert |
| save time p95 above 250 ms | Event control → Health |
| a guest waiting for a table more than 3 minutes | Event control → Staff and their queues (longest wait); My queue turns amber at 4 and red at 8 minutes |
| more than 5 failed seat emails | Event control → Health (outbox) and Exceptions |
| any red in the seating rules check | Event control banner; Security monitor |
| free disk under 1 GB | `sudo ltdc-erp-event status`; Security monitor |

**When to pause email:** more than 5 failures, or the outbox keeps growing. **When to go to paper:**
CORE does not answer for more than 1 minute, or the rules check is red and the cause is not clear.
**When to roll back:** only when CORE crashes again after each restart and the log points at the new
code (deploys are frozen, so this means the last release before the freeze). **When to use the
standby:** production is unreachable and a restart or rollback has not brought it back within 5
minutes, or the server is gone.

**Never run RESTORE.md §1 while the event is Live.**

### Close (AC-203)

1. **Self check-in open** OFF. Time: ____ : ____
2. **Event export (JSON)** and **Guests (CSV)**, **Seating (CSV)** downloaded to the laptop.
3. A manual off-server backup: `sudo systemctl start ltdc-erp-offsite.service` (check it in the
   Security monitor).
4. The retention date for the guest data, as agreed with the client: ____ / ____ / ______ (written in
   the close-out record; CORE has no field for it).
5. The post-event hard gates (AC-202): **Seating rules check** shows no problem.

## 10 Dec, 09:00: close-out (AC-204)

On production:

```bash
sudo ltdc-erp-event close-out
```

It lifts the freeze, puts the off-server backup back to hourly, and lists what is left by hand:

- [ ] Resize production back to its usual type, if it was resized (the Elastic IP stays).
- [ ] Snapshot staging's volume, then terminate staging.
- [ ] Hand the final export archive (JSON and CSV) to the client: who ________ when ________
- [ ] Start the PII purge clock to the retention date: the event's records in CORE (`ca*`), the nightly
      copies and the event's 5-minute copies in `data/backups`, the downloaded exports on the laptop,
      and the off-server copies (deleted by S3 after 30 days).
- [ ] Remove the `yep2026-8dec` snapshot after the retention date.
- [ ] Retro, and a dev log entry recording the close-out.
