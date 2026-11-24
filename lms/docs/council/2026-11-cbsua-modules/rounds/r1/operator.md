# Operator Position (Round 1) — Running ATLAS for CBSUA

## 1. Opening perspective

Keep it in the cloud. CBSUA's campuses are in Bicol, which gets several typhoons a year and frequent brownouts, and it has no 24/7 operations team. One on-premise server in Pili would be a bigger availability risk than a Singapore EC2 instance roughly 50 ms away. But the current EC2 setup was built for a pilot, not for a university of over 10,000 students. Everything runs on a single t3.small (`deploy/aws/lms-ec2.yaml`): one process, one JSON file and one disk. Nobody gets alerted when it goes down. Every deploy signs everyone out, and deploys can happen every 10 minutes. The "backup" copies sit on the same disk as the data. My domain covers deploys, backups/DR, capacity, monitoring and alerting, and change control. **The key question from my lens is: what RPO and RTO will CBSUA sign up to for each module, and who gets paged?** Finance, payroll and grades cannot tolerate losing up to 24 hours of data, and that is the most the current backup design guarantees.

## 2. Module input

**ATLAS home.** It is the single front door for every system: one sign-in, one host, one process (`server.js`). If that process is down, all of ATLAS is down. Sessions live in memory (`server/auth.js` `createSessions`, a `Map`), so every restart signs out every user on every side, including restarts from auto-updates and `Restart=always` crash loops. *Recommendation:* keep sessions in a small sidecar store (a sessions file or SQLite next to db.json) so restarts and deploys don't log people out, and add an external uptime check on `/healthz` that pages a named person.

**Learn + Admin panel.** This is the most write-heavy area. Quiz attempts, submissions, attendance and enrollment requests each call `db.save()`, which runs `JSON.stringify(data, null, 2)` on the whole database and blocks the process (`server/db.js` `save()`). Uploads arrive as base64 inside JSON bodies of up to 20 MB (`MAX_BODY_SIGNED_IN`, `server/api.js:70`) and are held in memory on a 2 GB instance. Peaks are predictable: midterm/final quiz windows and the first two weeks of the semester. *Recommendation:* set a change freeze during enrollment and exam weeks (turn off `ltdc-lms-update.timer` and deploy only in a declared window), and load-test with a db.json at CBSUA's real size before go-live.

**Academic.** Grade sheets (teacher → dean → registrar), the permanent `academicRecords` and issued documents verified by QR (`/verify/`) are records of legal standing. Verify links printed on TORs must keep working for years, so the hostname is a long-lived dependency. A DuckDNS name is not acceptable for that. The planned enlistment, add/drop and cashiering (`docs/ACADEMIC-PLAN.md`) will create the system's heaviest concurrent burst. *Recommendation:* use a CBSUA-owned domain (`atlas.cbsua.edu.ph` via the existing Cloudflare path) before the first document is issued. Set an RPO of 1 hour or less for Academic data, and do not ship enlistment until the database question (concern #1) is settled.

**People (HRIS).** The DTR time clock with geolocation has a hard daily peak (around 7:30–8:30 AM across all campuses), and a 6-hour purge timer also writes (`server/hris.js:343`). Payroll runs and remittances (GSIS, PhilHealth, Pag-IBIG, BIR) fall on fixed government cutoff dates. An outage or rollback on a cutoff day becomes a compliance incident, not an inconvenience. *Recommendation:* publish a cutoff calendar as no-deploy days. If the server goes down, campus internet fails or the clock-in breaks, the DTR needs a written paper/offline fallback that HR can enter later.

**Finance (FMIS).** It has the most routes (~123) and the highest audit stakes: COA requires numbered ORs, DVs and RCDs with no gaps or duplicates. If a rollback restores `db-before-update-*.json` (`deploy/aws/update.sh`, rollback branch), any OR or DV issued in between is silently lost, and the next one reuses its number. *Recommendation:* any data restore must be followed by a documented reconciliation runbook (OR booklets, `finCounters`). Finance needs off-site, point-in-time backups (concern #2) before any live money flows through it.

**System.** The Security monitor (`server/monitor.js`) is good telemetry: route latency histograms, event-loop lag, heap, disk via `statfsSync`, and the last downloaded backup. But it is pull-only. It has no email or webhook alerting, and `monitor.json` lives on the same box. It also cannot see the nightly cron copies, so it cannot tell you whether last night's backup ran. *Recommendation:* add push alerts (Uptime Kuma, a free Better Stack or healthchecks.io tier, or CloudWatch alarms) for the following: healthz down for more than 2 minutes, disk below 20% free, event-loop lag above 500 ms, a nightly backup heartbeat that is missing, and a failed auto-update. Also add the EC2 `StatusCheckFailed_System` alarm with the auto-recover action to the template.

**Facilities (planned).** Room and venue booking adds another concurrent-write area. Its peak is semester start, when schedules are built (the same weeks as enrollment). *Recommendation:* don't add ops investment yet, but plan its data as an addition to the same database migration as Academic schedules and rooms, not as more arrays in db.json.

**REX e-Reader (planned).** This is an external integration, so it brings a third-party dependency and possibly large binary content. If e-books are stored or proxied locally, they will fill the 30 GB root volume that also holds the OS, db.json, uploads and the on-box backups. *Recommendation:* link out to REX or serve e-books from REX's CDN or S3. Never store them on the ATLAS disk. Put REX availability on the status dashboard as an external dependency, with a degraded-mode message.

## 3. Top 3 concerns (ranked)

1. **The whole-file JSON database will not survive CBSUA scale or peak load.**
   - **How it works today:** every write synchronously rewrites the full file, pretty-printed (`server/db.js`, `JSON.stringify(data, null, 2)` then `writeFileSync` and `renameSync`). There are 49 direct `db.save()` call sites in `server/*.js`. The demo school alone is about 4.8 MB.
   - **At CBSUA scale:** tens of thousands of students, enrollments, attempts, attendance, DTR and finance records will plausibly reach hundreds of MB. Each save would then block the only event loop for one to several seconds, during exactly the weeks when writes peak.
   - **Hard ceilings:** past roughly 512 MB, V8's maximum string length makes `JSON.stringify` throw. Memory is also tight: a t3.small has 2 GB, and the database is held in memory as objects plus a serialized copy on each save.
   - **CPU:** t3 instances are burstable, so CPU credits run out in a busy enrollment week and the instance drops to its 20% baseline.
   - **The way out already exists:** the `db.js` header comment names RDS PostgreSQL and says the move is one table per collection.
   - **Minimum before go-live:** measure save latency against a synthetic CBSUA-size db.json, and use `t3.medium` with unlimited mode or an `m`-class instance for peak weeks.
   - **Medium term:** move to managed Postgres (RDS or Aurora Serverless v2), or at least SQLite (`node:sqlite` in Node 22 keeps the zero-dependency rule).
2. **Backups are not off-site, RPO is 24 hours, and restores have never been rehearsed.**
   - **What exists:** a nightly `cp` of db.json at 02:15, a files mirror at 02:20 and the audit log at 02:25 (`deploy/aws/ltdc-lms-backup.cron`). All of them write to `/opt/ltdc-lms/data/backups/`, on the same encrypted EBS volume as the live data.
   - **Snapshots:** the DLM snapshots (`lms-ec2.yaml` `DailySnapshots`, 7 kept) are the only copies off the volume, and they stay in the same account and region. There are no cross-region copies, none to a second account, and no S3. A compromised or deleted AWS account, a `DeleteOnTermination: true` stack deletion, or a ransomware-style overwrite loses everything.
   - **Data loss window:** worst case is about 24 hours of grades, ORs and payroll.
   - **Password key:** `password.key` is excluded from the nightly copies, so restoring onto a new server depends on someone having saved the key separately (EC2.md says so, but it is a manual step).
   - **Fix:** take hourly or 15-minute db.json snapshots to versioned S3 in another region with Object Lock, and copy DLM snapshots cross-region. Store the password key in AWS Secrets Manager or SSM Parameter Store. Rehearse a restore every quarter, timed, to set a real RTO.
3. **Unattended continuous deployment to production, with no alerting and no maintenance windows.**
   - **The updater:** `ltdc-lms-update.timer` runs every 10 minutes and installs whatever lands on a `claude/*` branch of a public GitHub repo (`lms-ec2.yaml` `GitHubBranch` default) once the tests pass. Every install restarts the process, which signs every user out (in-memory sessions). That can happen mid-quiz, mid-enlistment or mid-payroll run.
   - **The rollback:** it only checks that `/healthz` answers within 20 seconds (`update.sh`). A version that starts but breaks enrollment stays live.
   - **Data on rollback:** it reverts the data to the pre-update copy, which drops any writes made in between.
   - **No one is told:** there is no notification of failed updates, no external uptime monitor, no EC2 auto-recovery alarm, and DuckDNS is the name of record. Outages are discovered by students on Facebook.
   - **Fix:**
     - Use a protected `release/cbsua` branch or tags, not a working branch.
     - Deploy only in scheduled windows (for example Sat 22:00–24:00 PHT), with a freeze calendar for enrollment, exams, grade posting and payroll cutoffs.
     - Run a staging instance that has a copy of production data.
     - Add push alerts to a named on-call person at CBSUA ICT and at LTDC.
     - Write a one-page incident runbook.

**Cost note:** the upgrades above (t3.medium or m7g.large, S3 with cross-region copies, CloudWatch alarms, a small staging instance) bring the monthly cost to roughly US$60–110. That is small next to the cost of losing one day of COA records.
