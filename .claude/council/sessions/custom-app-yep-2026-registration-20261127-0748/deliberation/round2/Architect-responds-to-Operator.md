## Architect Response to Operator

**Their position:** Putting the event inside CORE's shared `db.json` turns event recovery into whole-company recovery. The only restore path rolls all of CORE back to an hourly snapshot. That loses up to an hour of check-ins and also rolls back HR, CRM and projects. Meanwhile, on a 1 GB t3.micro, every check-in re-stringifies the whole of CORE while about 300 phones poll. The event therefore needs event-scoped snapshots and a replayable log, so that one event can be restored onto a standby. Skeptic lists a separate data file as an open decision.

**My response:** Modify

**Reasoning:** I concede the storage location. I hold the write discipline.

Operator is right, and re-reading the code gives one more reason that I missed in Round 1. Admin panel → "Restore a backup" (`server/api.js:1314`, `db.replace` at `:422`) replaces *all* of `db.data`. An administrator restoring CORE for an unrelated reason on 9 December would silently roll back or erase every check-in. Three other things also argue for moving out:

- `save()` cost grows with CORE, not with the event.
- Guest PII would sit in 30 nightly whole-CORE copies.
- The purge after the event could not be done cleanly.

So the event moves into its own store, the same way `audit-log.jsonl` and `documents/` already live beside `db.json`. My Round 1 rule, "only above about 20 MB", was the wrong trigger. The bounded context and its recovery unit should decide where the data lives, not file size.

What I do not give up:

1. **One authoritative copy.** No dual-writing to `db.json` and the event file.
2. **One synchronous `commit()`** that re-reads the role, checks revisions and invariants, applies the change and persists it in one event-loop turn. Nothing is awaited between the check and the write.
3. **No cross-store transactions.** A `commit()` writes only its event's store, plus the audit append it already makes. Anything that touches `db.json`, such as creating an Event-staff account, is a separate CORE operation. Event code refers to users by id and re-reads them at every commit.

I would not build a log that is just a rewritten array inside a JSON file. I would build a small write-ahead pair per event: a compact `state.json` rewritten on every commit (about 300-500 KB, a few ms) and an append-only `log.jsonl`. That makes the per-commit cost independent of both CORE's size and the event's history. The same log is Operator's replay journal and my live-sync cursor.

The cost I accepted in Round 1 now has to be paid, and it is bounded:

- Add the event directory to the offsite manifest allow-list (`server/offsite.js:176,265`), following the `documents/` precedent at `:280-290`.
- Add one cron line.
- Make the restore check parse the event store.
- Add a RESTORE.md section.

All of this can ship by 1 December, which leaves the 6 December chaos drill to prove it.

---

### Revised storage contract (replaces Appendix B "collections in db.json")

```
data/customapp/<eventId>/
  state.json     compact JSON {v, eventId, seq, event, tables[], guests[], outbox[]}; tmp + fsync + rename on every commit
  log.jsonl      one line per commit: {seq, at, actor, op, args, after:{guests:[...], tables:[...]}, prevHash}
  snapshots/     state-<HHMM>.json every 5 min while event.window is open (copy of the last serialized bytes; no re-stringify)
db.json          keeps only: modules.customapp switch, customApp.events index [{id, code, name, dir, status}]
```

| Concern | Rule |
|---|---|
| Commit order | Validate, then apply in memory, then **append `log.jsonl` (fsync)**, then write `state.json` (tmp+rename). If the state write fails: undo in memory, append `{seq, void:true}`, return 503. If even that append fails, set the event to `readOnly` and alert. |
| Boot | Load `state.json`, then apply `after` images from log lines with `seq > state.seq` that are not voided. This covers a crash between the two writes. |
| Replay semantics | Point-in-time restore applies **after-images** up to seq N, which is deterministic and does not re-validate. Paper reconciliation replays **commands** through `commit()`, which re-validates so capacity and duplicates are still checked. Same log, two uses. |
| Integrity | `prevHash` chains the log lines, using the `server/audit.js` pattern. The restore check verifies the chain and that `state.seq` is no greater than the last log seq. |
| Event restore | `POST /api/customapp/events/:id/restore` (event SA + CORE admin, password re-entry, requires `readOnly`). It loads a snapshot or export, then replays the log to a chosen seq. **It touches only this event's directory.** It never calls `db.replace`. |
| Standby | Copy the event export (`state.json` plus `log.jsonl`), import it on standby, and the seq continues from there. Same format as the 5-minute laptop download. |
| Full-CORE restore | `db.replace` leaves `data/customapp/` alone. The Admin restore screen says "Event data is not part of this backup" whenever an event is open. A test asserts that a CORE restore does not change any event's `seq`. |
| Backups | Hourly offsite: `customapp/<eventId>/{state.json,log.jsonl}` go into the manifest with sha256. Nightly cron: rsync of `data/customapp/` to `backups/customapp/`, 30 days or the event retention date, whichever comes first. |
| Purge (Guardian) | Deleting the event removes its directory and its local snapshot and backup copies. Offsite copies age out under the bucket lifecycle. Retention is now per event, not tied to CORE's. |
| Live sync | Long-poll on `seq`, unchanged. The cursor is now the log seq. |

**What this does not change:** the data model inside the event (guest-embedded seat, tables, revisions, invariants I1 to I7), the routes, the n8n-derived outbox, and the single-process rule. Queue mode and clustering stay rejected, because single-thread atomicity still depends on one writer.

**Still measure on 28 Nov:** production `db.json` size and `save()` p95, because CORE-side writes (sign-ins, audit, notifications) still run on the same loop during the event. Event `state.json` write p95 must stay under 20 ms on the resized instance with 300 guests. The 4-5 Dec load test enforces that.
