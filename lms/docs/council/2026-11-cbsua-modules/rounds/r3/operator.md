# Operator (orange): Round 3 synthesis

**KEY INSIGHT:** I used to treat rollback as a safety net. The data rollback is itself a way to lose data. `update.sh` restores a pre-update db.json, and `finSnap` restores a snapshot taken before an `await`. Both can silently discard ORs that were already committed. So: fix forward once a release has served traffic, and never restore data backwards without replaying the erasure ledger and reconciling the counters.

**UNRESOLVED TENSION:** Architect wants one offline cut-over to SQLite. Tuner wants a cluster-by-cluster hybrid that keeps a legacy JSON blob. The hybrid ships the Learn write path sooner, but it costs about 7 ms per MB on every write and makes backup and rollback harder.

**MODULE VERDICTS:**
- ATLAS home: Go with conditions. Sessions persist across restarts, and auto-update is off.
- Learn+Admin: Go with conditions. The Learn write path moves to SQLite and hourly off-site backups are restore-tested, or the launch shrinks to a pilot.
- Academic: Not yet. Finish the single-store cut-over and put `atlas.cbsua.edu.ph` live before the first QR document is issued.
- People: Not yet. Freeze deploys on payroll cutoff days and give the DTR a paper fallback.
- Finance: Not yet. A unit of work replaces `finSnap`, and a boot check confirms each OR counter is at least the highest number issued.
- System: Go with conditions. Push alerts go to named people: healthz down, disk space, missing backup heartbeat.
- Facilities: Not yet. Build it on SQLite only.
- REX: Not yet. Link out or serve from a CDN, never from the ATLAS disk.

**RECOMMENDATION:** Hold the January date only as a go/no-go. If the backups, alerts and Learn write path are not done, launch a pilot cohort.

**QUESTION:** Who at CBSUA takes a 22:00 alert, and will CBSUA sign an RPO of 1 hour or less and a 4-hour RTO?
