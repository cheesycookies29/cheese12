# Architect, Round 1: moving ATLAS to another AWS account and a new domain

**Core recommendation:** The approach is sound. I would change three things. Move the data and the keys
as two separate artifacts, checked against one manifest. Make the old name a concern of Caddy only,
not of the app. Keep `node:sqlite` out of this window.

## 1. The approach

**What is bound to the host, per the code.** The analysis lists most of it. Four more things are bound to the old
server, and three of them sit in the data folder that G3 packs:

| Binding | Where | Effect if copied as is |
|---|---|---|
| `cloudflare.json`, `cloudflare-status.json` | `data/` | `ltdc-lms-cloudflare.path` watches the file (`PathChanged`). Restoring it runs the helper, which rewrites the Caddyfile, `ALLOWED_HOSTS` and `PUBLIC_URL` and may lock the firewall. `server-setup.sh` also applies it again. |
| `settings.cloudflare.originIp` | `db.json` | Still holds the old Elastic IP. |
| Keys made on first start | `secrets.js`, `auth.js` (`flag: 'wx'`) | The new stack already has its own `password.key` and `server.key` from its first start. If a key is missing at restore, a fresh one is made without a word. With a wrong server key, new uploads are sealed under it, which leaves two sets of documents under two keys, and they cannot be merged. |
| No `PUBLIC_URL` in the plain set-up | `server-setup.sh` | `originOf()` (`api.js`) falls back to the request's host, so feed, share and Keycloak URLs follow whichever name was used. |

**Transport (G3/G4).** Keep the encrypted bundle in S3 and reject the KMS snapshot share. A snapshot carries the
whole disk, including `server.env` with the DuckDNS token and `app.env`. I would change the following:

1. **Data bundle.** Use an explicit list of what goes in: `db.json`, `audit-log.jsonl`, `files/`, `documents/`
   without `uploads/`, and `monitor.json`. Leave out both keys and `cloudflare*.json`. Encrypt it with
   a passphrase (`gpg --symmetric`, which is authenticated) and upload it to a bucket in the new account. The
   bucket has public access blocked, SSE-KMS and a 1-day lifecycle rule, and the upload uses a presigned PUT URL
   that expires within 30 minutes.
2. **Keys out of band.** On the new server, enter the keys through Session Manager from the school's
   password manager, not from the old disk. This proves the backup copy of the keys before the window ends.
   A leaked bundle then does not also leak the keys.
3. **`MANIFEST.json`** is written with the app stopped. It holds:
   - the SHA-256 and size of every file;
   - the record count of every collection in `db.json`;
   - the audit chain's last sequence number and hash;
   - the commit from `build.json` and the Node version;
   - a short fingerprint of each key, which is a one-way hash and not secret.

   **Restore refuses to start ATLAS on any mismatch.** After the start, a sweep decrypts every password
   hash and every document blob without showing their contents, then appends a "restored from bundle
   <id>" audit entry.
4. **Stop `ltdc-lms-update.timer` during the restore.** If an update fails, `update.sh` copies its earlier
   copy of the data file back over `db.json` (lines 64 and 91). An update that started before the restore
   could put the new server's empty data back over the restored records.

**Rehearsal, then wipe: agreed.** "Wipe" must cover `db.json`, `audit-log.jsonl`, `files/`, `documents/`,
both keys and the S3 object, followed by a restart, because sessions live in memory (`auth.js:273`).

**Cutover order: agreed, with three additions:**
- At B1, switch off the old server's DuckDNS cron. If the old server is ever started again, its
  every-5-minutes updater takes the name back.
- Pin the new stack to the old server's commit, so no code changes inside the window.
- Add the old-name Caddy block only *after* B5. If ACME validation fails while DuckDNS still points at
  the old server, Caddy waits longer and longer before it tries again.

## 2. URL design for the old name

The printed `/verify/<code>` URL is a contract that lasts for years. Today the QR code carries `location.origin`
(`documents.js:158`), so it can hold any name the registrar happened to use.

```
<old>.duckdns.org {
  @feed path /api/calendar/feed/*
  handle @feed { reverse_proxy 127.0.0.1:3100 { header_up Host <new> } }   # served in place
  handle      { redir https://<new>{uri} 308 }                             # path and query kept
}
```

- **Redirect `/verify/*` and `/share/*`; do not serve them on the old name.** A QR scan opens a browser,
  and browsers follow a 308. Serving them in place would also need `/api/verify/*`,
  `/api/public/share/*`, `/css`, `/img` and `/js`. It would also put the share page's unlock cookie
  on a second host.
- **Serve only the feed in place, with `Host` rewritten**, because some calendar clients do not follow
  redirects. The app never sees the old name, so **`ALLOWED_HOSTS` keeps one name**. This replaces
  the analysis's plan to add the old name. If the old name were allowed, the whole API would answer on
  it. Keycloak sign-in would also fail there, because `PUBLIC_URL` sends the callback to the new host
  while the state cookie is on the old one.
- `PUBLIC_URL=https://<new>` is written at set-up (G1), so every generated link uses the canonical name.
- **Conflict with D7:** "only through Cloudflare" drops all port 80/443 traffic that does not come from Cloudflare
  (`cloudflare-apply.sh`, `firewall_lock`). DuckDNS cannot go on Cloudflare (`cloudflare.js:52`). With
  the origin lock on, the old name, and with it every printed QR code, stops working. The same is true today
  of the helper's own DuckDNS redirect block.

## 3. Decisions

- **D1:** use a name the school will keep for as long as its documents stay in use, such as `atlas.cbsua.edu.ph`.
- **D2:** keep the old name, with the design in §2, for as long as printed documents are valid.
- **D3:** stay in the same region, `ap-southeast-1`. The privacy addendum names AWS Singapore, so changing region changes a contract.
  Also check whether any outside system (Keycloak admin, an SMTP relay) allows ATLAS by its IP.
- **D4:** keep the old account for 2–4 weeks, then delete the volume, its snapshots and `backups/` as a recorded step.
  Any copy of the data left behind there is a liability.
- **D6:** with `PUBLIC_URL` set, the old Keycloak redirect URI can go one week after cutover. There is no need to wait a term.
- **D7:** not in this move. Or Cloudflare without the origin lock, until G5 can handle the old name.

## 4. Gaps

| Gap | Needed for the move? |
|---|---|
| G1 (domain, `PUBLIC_URL`, list of old names) | Needed |
| G2 (redirect design in §2) | Needed |
| G3 (manifest, explicit list, timer stopped) | Needed |
| G4 (bucket in the new account; keys out of band) | Needed |
| G6 (DuckDNS updater on the new server; old server's cron off) | Needed |
| G8 (guides; CLAUDE.md requires them) | Needed |
| G5 (Cloudflare script) | Needed only before Cloudflare is switched on |
| G7 (old links in the data) | Nice to have |
| **G9 (add):** ATLAS refuses to make a new key when `db.json` already holds sealed data | Needed. It is small and protects every restore from now on. |
| **G10 (add):** QR codes print `PUBLIC_URL`, not `location.origin` | Nice to have now; needed before CBSUA prints in volume |
| **G11 (add):** calendar UIDs use a fixed domain (`calendar.js:241` uses the host) | Nice to have. Each change of domain otherwise replaces every event once. |

## 5. Earlier council asks, and `node:sqlite`

- **The domain:** this move delivers it.
- **The protected release branch:** set at stack creation, with automatic updates off from day one,
  pinned to the old server's commit.
- **Hourly off-site backups:** build them from the same bundle and manifest format, in a *separate* bucket
  with 35-day expiry and no keys in it. They must be live before the old server is deleted.
- **`node:sqlite`: keep it apart, and do it after the move.**
  - Together, a failed check could not be traced to one cause.
  - The move's strongest proof is a byte-identical `db.json` (by SHA-256). A store change would turn it into
    a weaker comparison of record counts and hashes per collection, done under the window's time pressure.
  - The old server has no off-site backup to fall back on, so the store change should not happen there either.
  - Order: move, then at least one week of verified backups on the new server, then a separate window for the
    store change, with `db.json` kept read-only for rollback. Both come before the CBSUA import.
  - Design G3 so that it does not depend on the store: in that later window, the store change only swaps
    `db.json` for a `VACUUM INTO` copy.

## Verdict: Go with conditions

1. Data and keys travel separately. Restore refuses to start on any mismatch with the manifest (hashes,
   counts, audit chain head, key fingerprints). G9 is in place.
2. Nothing else changes in the window: the same commit, the same region, no `node:sqlite`, no Cloudflare origin lock.
3. The old name lives only in Caddy: a 308 redirect, the feed served in place with `Host` rewritten, and one
   name in `ALLOWED_HOSTS`. The old server's DuckDNS cron is off before it stops.
4. Hourly off-site backups in the new account are running before the old account's copies are deleted.
