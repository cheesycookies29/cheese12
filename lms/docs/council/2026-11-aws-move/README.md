# Council meeting: moving ATLAS to another AWS account and a new domain

**Date:** 2026-11-25 · **Mode:** meeting (discussion only, nothing built) · **Rounds:** one round each, then
this synthesis
**Panel (5):** Operator (deployment, operations), Architect (system design, data), Skeptic (risk),
Guardian (privacy, compliance), Cipher (cryptography, keys)

## Topic

The council reviewed the analysis in
[../../migration/2026-11-new-aws-account-and-domain.md](../../migration/2026-11-new-aws-account-and-domain.md):
- what it got right and what it misses;
- decisions D1–D8;
- gaps G1–G8;
- whether the move is the moment for the earlier council's asks.

The shared brief is [rounds/brief.md](rounds/brief.md). Each member's full answer is in [rounds/](rounds/).

## Verdict

| Member | Verdict |
|---|---|
| Operator | Go with conditions |
| Architect | Go with conditions |
| Skeptic | Go with conditions |
| Guardian | Go with conditions |
| Cipher | Go with conditions |

**The council's verdict: Go with conditions (5–0).** The approach in the analysis holds:
- stop the old server;
- export, encrypted transport, restore, verify;
- keep the old name as a forward.

But several of its safety claims are not yet true in the deploy files (section 1), and the conditions in
section 4 must be met before the window.

## 1. What the council found that the analysis missed (all checked in the code)

1. **Two background jobs on the old server would undo the cutover.**
   - Its DuckDNS cron (every 5 minutes) points the old name back at itself.
   - Its update timer (every 10 minutes) ends with `systemctl start ltdc-lms`, so stopping the app is not enough.
   - Started again for any reason, the old server takes writes on stale data. That is split-brain.
   - *(Operator, Skeptic, Architect)*
2. **The template can take the live address before the move.** `lms-ec2.yaml` requires a DuckDNS name and
   token, and `server-setup.sh` points that name at the new server on first boot. A new stack built with
   the production name moves every printed QR code to an empty server. *(Skeptic, Operator)*
3. **Keys are made silently.** `server/auth.js` (password key) and `server/secrets.js` (server key) create
   new random keys when theirs are missing, and the new stack's first boot already made its own.
   - A restore that misses a key still starts.
   - Passwords fail and documents show as damaged.
   - Anything written afterwards is sealed under the wrong key, splitting the data between two keys.
   - *(Cipher, Architect, Operator)*
4. **An update can undo a restore.** When an update fails, `update.sh` copies its earlier `db.json` back.
   The timer must be off during the restore. *(Architect, Operator)*
5. **The inventory is incomplete or unsafe as listed.**
   - `data/oidc-client.secret` (Keycloak "Set up for me") and `avatars/` are missing.
   - `data/cloudflare.json` must **not** be copied: a path unit watches it, and it rewrites Caddy,
     `ALLOWED_HOSTS` and `PUBLIC_URL`.
   - `settings.cloudflare.originIp` still holds the old IP.
   - `backups/` and the Caddy logs should not move. The backup mirror has no `--delete`, so files deleted
     in ATLAS live on there, and the Caddy logs hold visitors' addresses.
   - *(Skeptic, Architect, Cipher, Guardian)*
6. **Forwarding only `/verify/*` and `/share/*` breaks those pages.** Their CSS, scripts and APIs live
   elsewhere. With `script-src 'self'`, a script redirected to another origin is blocked. *(Skeptic,
   Architect, Cipher)*
7. **"Only through Cloudflare" and the old name cannot coexist.** The lock drops all non-Cloudflare traffic,
   and DuckDNS cannot sit behind Cloudflare. With the lock on, every QR code printed before the move fails.
   *(all five)*
8. **The rehearsal "wipe" leaves copies.**
   - The new server's daily snapshots keep the records and both keys for 7 days, and the nightly copies
     duplicate them.
   - The new name is public before cutover: first the setup page, then the rehearsal copy with real
     password hashes.
   - *(Skeptic, Guardian, Operator)*
9. **An intact audit chain is not proof of a whole log.** The chain is unkeyed SHA-256, and a log cut short
   still verifies. The restore must compare the entry count and the last hash against a value recorded
   outside the bundle. *(Skeptic, Cipher, Guardian)*
10. **No canonical address.** The plain setup writes no `PUBLIC_URL`, so feed, share and Keycloak links
    follow whatever host was used (`originOf()` in `server/api.js`). The printed QR codes use
    `location.origin` (`public/js/academic/views/documents.js`). *(Architect, Guardian)*
11. **Governance is missing** *(Guardian)*:
    - who owns the new account (D9, new);
    - the processing agreement;
    - a signed record of the move;
    - proven destruction of the old copies. AWS keeps a closed account's content for 90 days, and the old
      volume's AWS-managed key cannot be deleted.
12. **DuckDNS is now a trust anchor.**
    - The name answers every printed TOR's QR code for years.
    - It sits on a free service with no contract, behind one person's login and one token.
    - Browsers hold a one-year HSTS rule for it, so it must stay on valid HTTPS.
    - *(Skeptic, Guardian, Cipher)*

## 2. Where the council agrees

- **Keys travel apart from the data.**
  - `password.key` and `server.key` come from the school's password manager into the new server through
    Session Manager (`read -s`, files mode 0600). That also proves the stored copy works.
  - The bundle carries data only, so on its own it exposes only the plain records.
  - Keys are checked by fingerprint, and never printed (`EC2.md`'s `sudo cat password.key` advice should
    change).
- **A manifest decides go/no-go.** The export writes:
  - the SHA-256 of every file;
  - the counts per collection;
  - the audit entry count and last hash;
  - the commit;
  - the key fingerprints.

  The restore refuses to start on any mismatch.
- **Freeze before export.** On the old server:
  - mask the app;
  - remove the update timer and the DuckDNS cron;
  - freeze the branch;
  - take a manual EBS snapshot. That snapshot is the real rollback asset.
- **The new server stays dark until restore.** Use a holding page, or the operator's IP only, or SSM port
  forwarding. Its update timer stays off until the checks pass.
- **Rehearse on a throwaway stack** in the new account, never with the production DuckDNS name. Delete it
  with its snapshots afterwards.
- **Nothing else changes in the window.**
  - Same commit, same region (`ap-southeast-1`).
  - No `node:sqlite`, no Keycloak move, no Cloudflare lock.
  - Cloudflare, if wanted, comes a week later and without the origin lock.
- **`node:sqlite` comes after the move** in its own window, before the CBSUA import. A byte-identical
  `db.json` is the move's strongest proof.
- **The earlier council's asks at this move:**
  - the school domain (yes, this move);
  - a protected release branch set at stack creation (yes);
  - hourly off-site backups in the new account, reusing the bundle format without keys, running before the
    old copies are destroyed.
- **The old name is kept (D2), under school custody.**
  - It moves to a school-owned login with 2-step sign-in and two named holders.
  - The token is rotated after the move.
  - A daily outside check confirms the name points at the new server.

## 3. Where members differ, and the council's resolution

| Question | Views | Resolution |
|---|---|---|
| **How the old name answers** (G2) | Cipher: serve verify, share and feed routes (and their assets) in place; 404 elsewhere. Architect and Skeptic: **308 redirect everything** to the new name, keeping path and query, and serve only `/api/calendar/feed/*` in place. `ALLOWED_HOSTS` keeps one name. | **Redirect everything except calendar feeds.** QR scans and share links open a browser, which follows a 308; calendar apps may not. The old name never becomes a sign-in address. Add the Caddy block only after DuckDNS points at the new server. |
| **How the bundle is encrypted** (G4) | Cipher: a small Node script, AES-256-GCM with the header as AAD, the data key from a customer-managed KMS key in the new account (old role may only generate data keys, new role only decrypt); fallback scrypt. Architect: `gpg --symmetric`. All: S3 in the new account, SSE-KMS, TLS only, presigned upload of an hour at most, 1–3 day expiry, deleted after the restore. | **Node AES-256-GCM under a KMS data key** (no passphrase to hand over; CloudTrail records every unseal). Unpack only after the tag checks. Not an EBS snapshot shared through KMS: that carries the whole disk, including `app.env` and `server.env`. |
| **How long the old account's data is kept** (D4) | Operator: 60 days or more, until a restore from the new off-site backups has been drilled. Guardian: 30 days at most, then destruction with a certificate. Skeptic: 30 days. Architect: 2–4 weeks. | **Target 30 days.** Destroy as soon as hourly off-site backups run in the new account *and* one restore from them has been drilled; never longer than 60 days. Delete item by item (instance, volumes, all snapshots, images, logs, buckets) and record it. |
| **Rotation** | Cipher: rotate the password key within a week of cutover (`PASSWORD_KEY_OLD` kept 30 days or more); rotate the Keycloak secret and the DuckDNS token. Server key: cannot be rotated today (no key id in the `CDM1` header). | **Adopted.** Server-key rotation is a later gap, not part of the move. |
| **QR codes from `PUBLIC_URL`** | Guardian: before the move. Architect: before CBSUA prints in volume. | **Before CBSUA prints in volume**, and ideally with the move, so new TORs carry the school domain. |
| **Window length** (D8) | Operator: book 2 hours, 45-minute go/no-go. Skeptic: book 3 hours for a 60-minute job. | **Book 3 hours**, go/no-go at 45 minutes by one named owner, outside enrollment, grading and payroll cut-off, before the CBSUA import. |

## 4. The council's conditions (before the window)

1. **Ownership and paperwork (D9).**
   - The new account's owner is decided; the council recommends the university, with LTDC given access through IAM Identity Center.
   - The DPO signs off.
   - The processing addendum names AWS Singapore. An account owned by LTDC or a reseller needs the university's written consent before any data moves.
2. **The tooling exists and was rehearsed on a throwaway stack:**
   - G1: a template with its own domain and DuckDNS optional;
   - G2: the 308 forward with feeds served in place;
   - G3: export and restore that work both ways, with the manifest;
   - G4: KMS-encrypted transport;
   - G6: DuckDNS kept only for the old name;
   - the new key guard: ATLAS refuses to make a key when sealed data already exists;
   - the holding page;
   - the freeze step;
   - CloudTrail and session logging in both accounts.
3. **Old server fully frozen before export**, with a manual snapshot. **New server dark** until restore, with its update timer off.
4. **The restore proves itself** before users return. The rehearsed rollback also puts the new server into maintenance. The proof:
   - keys by fingerprint against the password-manager copy;
   - the manifest;
   - the audit count and last hash;
   - one document opens;
   - `/verify/<code>` works on both names.
5. **After the move:**
   - external uptime and certificate checks on both names, plus an EC2 auto-recover alarm;
   - the bundle and every stray key copy deleted within 24 hours;
   - the password key rotated within a week;
   - hourly off-site backups running, and a restore drilled, before the old account's data is destroyed.

## 5. Additions to the analysis' gaps

The members numbered their additions independently; the council merges them as:

| # | Gap | Raised by |
|---|---|---|
| G9 | Key guard: no new key when sealed data exists; restore checks key fingerprints | Cipher, Architect |
| G10 | Manifest and comparison: per-file SHA-256, counts, audit count and last hash, commit | Skeptic, Architect, Cipher |
| G11 | Freeze step on the old server (mask the app, timers and crons off, manual snapshot) and holding pages on the new one | Operator, Skeptic |
| G12 | CloudTrail, Session Manager logging and a customer-managed KMS key (`KmsKeyId`) for the volume in the template | Guardian, Cipher |
| G13 | Monitoring: external uptime and certificate checks on both names, EC2 auto-recover alarm, a daily DuckDNS check | Operator, Skeptic |
| G14 | QR codes and the "Check at" line built from `PUBLIC_URL`, plus a `/verify` page with a code box (today only `/verify/<code>` answers) | Guardian, Architect, Skeptic |
| G15 | Inventory fixes: add `oidc-client.secret` and `avatars/`; exclude `cloudflare.json`, `backups/` and the Caddy logs; reset `settings.cloudflare.originIp` | Skeptic, Architect, Cipher, Guardian |
| G16 (later) | Server-key rotation (a key id in the `CDM1` header and a key ring) | Cipher |
| G17 (later) | Calendar event UIDs from a fixed domain, not the request host (`server/calendar.js`) | Architect |

## 6. Decisions: the council's recommendations

| # | Recommendation |
|---|---|
| D1 | A name under the school's own domain (for example `atlas.cbsua.edu.ph`), DNS run by the school, an A record only (the server has no IPv6). CAA records must allow `letsencrypt.org` and `sectigo.com`. |
| D2 | Keep the old DuckDNS name for as long as printed documents are in use, in school custody (section 2). |
| D3 | Stay in `ap-southeast-1`. |
| D4 | Target 30 days, at most 60 (section 3). |
| D5 | Check the new account for an existing GitHub identity provider and for stacks or roles named `ltdc-lms-*` before creating anything. |
| D6 | Keycloak does not move in this window; add the new redirect URI before cutover and remove the old one a week after. |
| D7 | No Cloudflare during the move; if wanted later, never with the origin lock while the old name serves QR codes. |
| D8 | Book 3 hours, with a 45-minute go/no-go and one named owner, outside enrollment, grading and payroll cut-off, before the CBSUA import. |
| D9 (new) | Who owns the new account (section 4, condition 1). |

**Not checked by the council:** the Guardian quoted the NPC rules, AWS's 90-day retention after an account is
closed, and the AWS Data Processing Addendum from knowledge. The DPO or counsel should confirm them.
