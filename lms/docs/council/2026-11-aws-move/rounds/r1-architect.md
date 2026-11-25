# Architect, Round 1: moving ATLAS to another AWS account and a new domain

**Core recommendation:** The approach is sound. Three changes:
- Move the data and the keys as two separate artifacts, checked against one manifest.
- Make the old name a Caddy concern, not an app concern.
- Keep `node:sqlite` out of this window.

## 1. The approach

**Not in the analysis's inventory, all checked in the code:**

| Binding | Where | Risk |
|---|---|---|
| `cloudflare.json`, `cloudflare-status.json` | `data/` | `ltdc-lms-cloudflare.path` watches the file (`PathChanged`), and `server-setup.sh` applies it again. Restoring it rewrites Caddy, `ALLOWED_HOSTS` and `PUBLIC_URL`, and can lock the firewall. |
| `settings.cloudflare.originIp` | `db.json` | Still holds the old Elastic IP. |
| Keys made when missing | `secrets.js`, `auth.js` (`flag: 'wx'`) | The new stack has already made its own keys. If a key is missing at restore, a fresh one is made without a word. With a wrong server key, new uploads are sealed under it, so the documents end up under two keys and cannot be merged. |
| No `PUBLIC_URL` in the plain set-up | `server-setup.sh` | `originOf()` (`api.js`) follows whichever host was used. |

**Transport (G3/G4).** Keep the S3 bundle. Do not share a KMS snapshot: it carries the whole disk,
including `server.env` (with the DuckDNS token) and `app.env`. Changes:

1. **Data bundle.** An explicit list of what goes in:
   - `db.json`, `audit-log.jsonl`, `files/`, `documents/` without `uploads/`, `monitor.json`;
   - no keys and no `cloudflare*.json`.

   Encrypt it with `gpg --symmetric`. Upload it with a presigned PUT, valid 30 minutes or less, to a bucket in
   the new account that has public access blocked, SSE-KMS and a 1-day lifecycle rule.
2. **Keys out of band.** Enter them on the new server through Session Manager, from the password manager.
   This proves the backup copy, and a leaked bundle does not leak the keys.
3. **`MANIFEST.json`**, written with the app stopped. It holds:
   - the SHA-256 of every file and the record count of every collection;
   - the audit chain's last sequence number and hash;
   - the `build.json` commit;
   - a fingerprint of each key.

   **Restore refuses to start on any mismatch.** It then decrypts every password hash and every document
   once to check them, and appends a "restored from bundle" audit entry.
4. **Stop `ltdc-lms-update.timer` during the restore.** When an update fails, `update.sh` copies its earlier
   copy of the data file back over `db.json` (lines 64 and 91), which could undo the restore.

**Rehearsal, then wipe: agreed.** Wipe both keys and the S3 object too, then restart, because sessions
live in memory.

**Cutover additions:**
- At B1, switch off the old server's DuckDNS cron. If that server is ever restarted, its updater takes the name back.
- Pin the new stack to the old commit.
- Add the old-name Caddy block only after B5. If ACME fails while the name still points at the old
  server, Caddy waits longer and longer before it retries.

## 2. URL design for the old name

A printed `/verify/<code>` is a contract that lasts for years. Today it carries `location.origin`
(`documents.js:158`).

```
<old>.duckdns.org {
  @feed path /api/calendar/feed/*
  handle @feed { reverse_proxy 127.0.0.1:3100 { header_up Host <new> } }
  handle      { redir https://<new>{uri} 308 }
}
```

- **Redirect `/verify/*` and `/share/*`.** A QR scan opens a browser, and browsers follow a 308.
  Serving these pages in place would also need `/api/verify`, `/api/public/share`, `/css`, `/img`
  and `/js`, and would put the share unlock cookie on a second host.
- **Serve only the feed in place, with `Host` rewritten.** Then **`ALLOWED_HOSTS` keeps one name**, unlike
  the analysis's plan to add the old name. With the old name allowed, the whole API would answer on it.
  Keycloak sign-in would also fail there: `PUBLIC_URL` sends the callback to the new host, while the state
  cookie is on the old one.
- **Conflict with D7.** "Only through Cloudflare" drops all port 80/443 traffic that does not come from Cloudflare
  (`firewall_lock`). DuckDNS cannot go on Cloudflare (`cloudflare.js:52`). The lock therefore stops every
  printed QR code, and the helper's own DuckDNS redirect block, from working.

## 3. Decisions

- **D1:** a name the school will keep for as long as its documents stay in use.
- **D2:** keep the old name, as in §2.
- **D3:** stay in `ap-southeast-1`, because the privacy addendum names Singapore. Check whether any outside
  system allows ATLAS by its IP.
- **D4:** after 2–4 weeks, delete the old volume, its snapshots and `backups/` as a recorded step.
- **D6:** with `PUBLIC_URL` set, the old redirect URI can go one week after cutover.
- **D7:** not in this move. Or Cloudflare without the origin lock.

## 4. Gaps

| Gap | Needed for the move? |
|---|---|
| G1 (with `PUBLIC_URL` and old names) | Needed |
| G2 (§2) | Needed |
| G3 (manifest) | Needed |
| G4 | Needed |
| G6 (with the old server's cron off) | Needed |
| G8 | Needed |
| G5 | Needed before Cloudflare is switched on |
| G7 | Nice to have |
| **G9 (add):** ATLAS refuses to make a new key when `db.json` already holds sealed data | Needed. It is small and protects every restore. |
| **G10 (add):** QR codes print `PUBLIC_URL`, not `location.origin` | Needed before CBSUA prints in volume |
| **G11 (add):** fixed calendar UID domain (`calendar.js:241`) | Nice to have. Each change of domain otherwise re-adds every event once. |

## 5. Earlier council asks, and `node:sqlite`

- **Domain:** this move delivers it.
- **Release branch:** set at stack creation, with automatic updates off, pinned to the old commit.
- **Hourly off-site backups:** use the same bundle and manifest format, in a separate bucket with 35-day expiry
  and no keys. They must be live before the old copies are deleted.
- **`node:sqlite`: keep it apart, and do it after the move.**
  - Combined, a failed check cannot be traced to one cause.
  - The move's strongest proof is a byte-identical `db.json`, which would become a weaker comparison per
    collection under time pressure.
  - The old server has no off-site backup to fall back on.
  - Order: move, then one week of verified backups, then a separate window for the store change, with
    `db.json` kept read-only for rollback. Both come before the CBSUA import.
  - Keep G3 independent of the store, so that later `db.json` is simply swapped for a `VACUUM INTO` copy.

## Verdict: Go with conditions

1. Data and keys travel separately. Restore refuses to start on any mismatch with the manifest, and G9 is in place.
2. Nothing else changes in the window: same commit, same region, no `node:sqlite`, no origin lock.
3. The old name lives only in Caddy: a 308 redirect, the feed served in place, and one name in `ALLOWED_HOSTS`.
   The old server's DuckDNS cron is off before it stops.
4. Hourly off-site backups are running in the new account before the old account's copies are deleted.
