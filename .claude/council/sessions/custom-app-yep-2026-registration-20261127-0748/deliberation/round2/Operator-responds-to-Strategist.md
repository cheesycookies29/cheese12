# Operator Response to Strategist

**Their position:** The event loop decides everything. Build in three tiers, so that CORE is event-ready at the end of each one:

- Tier 0 (staff-only seating) by 1 Dec;
- Tier 1 (guest QR page and delegated queues) by 3 Dec;
- Tier 2 (exceptions, email, dashboard) demoed on 5 Dec.

There is no feature work after 6 Dec. Reuse comes from parameterising, not abstracting. Push, holds and workers are cut. The only operations items in Tier 0 are the three cheap-now, fatal-later fixes: the NAT rate-limit buckets, the CORE-admin-as-second-SA issue, and a deploy freeze (#24, sized XS).

**My response:** Modify.

**Reasoning:** Strategist is right, and I concede the main point. My round 1 list read as a second project, and if it competes with Tier 0 for the 28 Nov to 3 Dec developer-days, the event loses. The feature loop is the product. Most of my list is insurance against failures that the freeze and a small bit of process hygiene already make unlikely.

But "#24 freeze, XS, Ops" is not an operations plan. Strategist's own roadmap also puts the restore drill on 7 Dec. If the off-server copy turns out not to restore, 7 Dec leaves no days to fix it, and the drill becomes a discovery we cannot act on.

So I am not asking for my list in full. I am cutting it to the items that stop a single restart, a crash or a slow `save()` from ending the evening, and putting each one in a bucket:

- **CI-free operator time:** GitHub settings, SSM commands, an AWS resize, building staging from `RESTORE.md`. These cost zero feature developer-days.
- **Absorbed:** folded into a tier item Strategist already owns, at no extra size.
- **Standalone code:** about one developer-day in total, half of it on 28 Nov.

Everything else I defer, and I say what replaces it. Where my items and Strategist's dates conflict, the fix is to move a check earlier and make it smaller, not to make the build bigger.

---

## What I keep, and where it goes (no new Tier 0 feature days)

| # | Item | Bucket | Cost | When | Why it stays |
|---|------|--------|------|------|--------------|
| O1 | **Freeze guard** in `deploy/aws/remote-deploy.sh`: refuse if `/opt/ltdc-erp/data/DEPLOY_FREEZE` exists. Plus required reviewers on the GitHub `production` environment from 7 Dec 18:00. | Code (3 lines) + setting | XS (under 1 h) | 28 Nov | Every push deploys, and every deploy is `systemctl stop`, `rsync --delete`, `start` (`update.sh:31-44`). That signs out every staffer, because sessions live in a `Map`. Today a freeze is only an agreement, and one stray push on the 9th breaks it. The guard has to land *before* the Tier 0 pushes, because it only protects deploys that run after it is installed. |
| O2 | **Keep the previous release.** `update.sh` copies `$APP` (without `data/`) to `/opt/ltdc-erp-prev` before the `rsync`. Plus a 5-line `ltdc-erp-rollback`. | Code | XS (1 to 2 h incl. a dry run on staging) | 28 Nov | Rollback today is revert, then CI (about 15 min), then another restart. Through Tiers 0 to 2 we will push to shared CORE production roughly 15 times in 9 days. A broken push hits HR, CRM and everyone else too, so a 60 s rollback protects the company, not only the event. |
| O3 | **`process.on('unhandledRejection')` logger** in `server.js`: log, record a monitor event, do not exit. Plus one test. | Code | XS (1 h) | 28 Nov | `grep` finds no handler anywhere in `server.js` or `server/`. On Node 22, one rejected promise in a fire-and-forget SMTP send ends the process. The freeze cannot help with that, because it is not a deploy. This is the cheapest way to cut the restart risk that session persistence (#27) would otherwise have to cover. |
| O4 | **Measure production** `db.json` size and `save()` time over SSM. | Operator time | 15 min | 28 Nov | This answers Strategist's own Tier 0 decision point ("is `db.save()` time acceptable with the real `db.json` size?") on day 1, not on 1 Dec. It also decides O7 (whether to resize) and whether Tuner's save coalescing has to go into #2. |
| O5 | **Runtime flags, cut from six to three.** Each one goes into the tier item that it guards: `registrationOpen` (already in #12), `emailPaused` (in #19, a single check in the send path), `pollMs` returned in the `changes?since=seq` response (in #11). | Absorbed | 0 extra | with each tier | These let us degrade without a deploy, which matters because the freeze rules deploys out. `selfCheckIn` merges into `registrationOpen`: closing the guest page *is* staff-only check-in. `readOnly` is cut, because the SA closing registration plus a radio call does the same job on the night. The module kill switch already exists (Admin panel → Modules). |
| O6 | **Event export to disk every 5 minutes** in the event window (`setInterval` writes the #9 export JSON to `data/backups/events/`, keeping the last 24). The command-desk laptop presses Export on each print cycle. | Absorbed into #9/#22 | XS on top of #9 | Tier 2 | The hourly off-server copy gives a 60-minute RPO for the busiest hour CORE will ever have. The 5-minute file plus #22's "replay paper allocations as commands" *is* the recovery path. It needs no restore tooling. |
| O7 | **Resize to t3.small** on 7 Dec, back on 10 Dec. *First check that the instance has an Elastic IP.* A stop/start without one changes the public IP and breaks DNS. | Operator time | 15 min + about 2 min of announced downtime, about US$1 in total | 7 Dec (before the 18:00 gate) | This depends on O4. If production `db.json` is small and `save()` p95 is under 20 ms, skip it. |
| O8 | **Build staging from the S3 hourly copy** (`RESTORE.md` section 2). It serves as both the restore drill and the load-test target. | Operator time | about 2 to 3 h, once | by 3 Dec | Strategist's 7 Dec drill moves 4 days earlier and merges with the load-test host. If the restore fails on 2 Dec, we have time to fix it. If it fails on 7 Dec, we go into the event with an untested backup. |
| O9 | **Load test on staging**, two runs: run 1 on the evening of 4 Dec (Tier 1 exists, and the guest page is what drives the load), run 2 on 6 Dec on the real guest list. Profile: 300 guest pages, 15 staff, a 40-in-10-minute burst, one NAT IP. Run 2 ends with `systemctl kill -s KILL ltdc-erp` during the burst and a check that the floor carries on (that replaces my chaos drill). | Code (stdlib script, Craftsman's #21) + operator time | already in #21 | 4 and 6 Dec | Strategist puts the only load test on 6 to 7 Dec, after the data freeze. If it finds a `save()` problem then, there are no feature days left to fix it. Run 1 on 4 Dec leaves 5 and 6 Dec for a fix. |
| O10 | **Printed pack and T-3h checklist** (`docs/guides` runbook section). | Absorbed into #22/#23 | 0 extra | Tier 2 | Already Must in Strategist's plan. I only add the T-3h order (freeze file present, manual off-server backup, smoke test on the rehearsal guest, print "as of HH:MM"). |

**Net claim on developer-days from 28 Nov to 3 Dec:** about half a day, all of it O1 to O3 on 28 Nov, before the first Tier 0 deploy. **Net claim over the whole build:** about one developer-day, the rest of it absorbed into #9, #11, #12, #19, #21 and #22. O4, O7 and O8 are a few hours of the user's operator time over SSM and in the AWS console, not feature work. If the same person is doing both, then O8 is the one hour I am asking them to take from Tier 1.

## What I defer, and what replaces it

| Round 1 item | Decision | Replaced by |
|---|---|---|
| Event-only export **and import** (restore one event without touching the rest of `db.json`) | Deferred to v1.1 | O6 snapshot plus reconciliation through the normal commands (#22). A bad write on the night is corrected by commands, with audit. We do not bulk-overwrite. An import tool built in a hurry that writes over live event data is a bigger risk than the problem it solves. |
| Warm standby on 9 Dec with its own hostname, cert and QR redirect | Downgraded to Could; decide on 6 Dec | Staging already exists after O8, so keeping it up costs about US$0.30 a day. Failover plan: restore the newest hourly copy onto it, then replay the newest O6 file and the paper sheets. No QR-redirect machinery: if the primary is gone, the floor runs on paper (#22) until the SA decides. |
| Persisted hashed sessions | Deferred (agrees with Strategist #27) | Freeze (O1) plus the logger (O3) remove most restart causes. Skeptic sizes the event `auth` bucket for one NAT under #10, so a forced re-sign-in still works. Staff use the 4G hotspot, not guest Wi-Fi. |
| Six kill switches | Cut to three | O5 |
| Separate kill -9 chaos drill | Merged | The end of load test run 2 (O9) |
| Event health panel (save p95, seq, open polls, oldest wait, outbox, 429s) | Cut to what #20 already shows | #20 dashboard shows queue depth and occupancy. Add two numbers there: oldest pending wait and email failures. Process health comes from the existing Security monitor plus a free external 1-minute uptime check on `/api/public/health` (operator time, 10 min). |
| Invariant self-check every 60 s | Cut to on demand | An invariant scan (no table over 10, no seat held twice) runs as a test, after each load-test run, and once by the SA at close. Craftsman owns it in #21. |

## Non-negotiables before production on 9 Dec

1. O1, O2 and O3 merged and deployed **on 28 Nov**, before Tier 0 pushes start.
2. O4 measured on 28 Nov and sent to Tuner and Architect.
3. Staging restored from S3 (O8) **by 3 Dec**; load test run 1 **by 4 Dec**.
4. `DEPLOY_FREEZE` touched on 8 Dec 12:00, plus the reviewer gate from 7 Dec 18:00. Removed 10 Dec 09:00.
5. The three O5 flags work without a deploy, and each is checked in the 5 Dec acceptance demo.
6. A printed pack and a newest O6 file less than 10 minutes old at T-3h.

## What I am asking Strategist to change in the roadmap

- Move #24 from "Ops, XS" to **Tier 0 day 1 (28 Nov), size S**, and split it into O1 to O4. The freeze is only XS if the guard already exists.
- Move the restore drill from 7 Dec to **1 to 3 Dec**, merged with building staging (O8).
- Add **load test run 1 on 4 Dec** in the evening, between Tier 1 and Tier 2. Keep 6 Dec as run 2 on the real data.
- In the fallback order, the operations items are never cut. They are already the minimum.
