# Round 1: Cipher (cryptography and key management)

## Cipher Position: moving ATLAS to a new AWS account and domain

**Core recommendation:** The approach is sound. Change one thing: **the two keys must not travel in
the same bundle as the data.** Encrypt the data bundle with AES-256-GCM under a one-time data key
sealed by a KMS key in the *new* account. Install the keys on the new server from the school's
password manager, so the move also proves that the escrow copy works.

**Key argument.** The analysis packs `db.json`, `password.key` and `server.key` into one archive. Whoever
gets that archive gets every record, the password hashes they can now test offline, every 2-step
secret and every document. The code already splits these duties well. `auth.js` seals each scrypt
hash and TOTP secret with AES-256-GCM under the password key, with separate AADs
(`atlas-password-v1`, `atlas-totp-v1`) and a key id in every `enc1$<id>$…` value. `dms/blobs.js`
wraps a per-file key under `derive('documents.master-key')`. A bundle without the keys therefore
exposes only the plain records in `db.json`. Each key is 64 hex characters, small enough to paste.

## 1. How the keys travel

- **Data bundle** (data folder without `password.key` and `server.key`): encrypted, through S3 (below).
- **Keys:** paste them from the password manager into the new server through Session Manager. Use
  `read -s` and write each file with mode 0600, owned by `ltdc-lms`. Never use `cat` or `echo`:
  Session Manager logging, if it is on, records terminal output. EC2.md's `sudo cat password.key`
  advice should change for the same reason.
- **Fingerprints:** at export, write `sha256sum` of each key file into the bundle manifest. Before the
  first start, the restore step compares them and **refuses to start ATLAS if they differ**.
  This is needed because the stack's first install starts ATLAS, and both `loadPasswordKeys`
  (`auth.js`) and `createSecrets` (`secrets.js`) **quietly make new random keys when the files are
  missing**. With the wrong keys, ATLAS starts anyway. Passwords show as "unreadable" (a log line
  only) and documents open as "damaged". Worse, anything written afterwards (new passwords, 2-step
  set-ups, uploads) is sealed under the wrong key, which leaves the data split between two keys.
  Restore order: stop ATLAS and its update timer, delete the generated keys, install the escrow keys,
  check the fingerprints, start.
- **Not in the inventory:** `data/oidc-client.secret`. `sso.js` uses this file before
  `OIDC_CLIENT_SECRET` when "Set up for me" was used.

## 2. Rotation

- **Password key: rotate it, but after the go/no-go window**, not during it. The code supports
  rotation without anyone changing a password. Set the new key as current and keep the old one in
  `PASSWORD_KEY_OLD`. About two minutes after start, the hashes and TOTP secrets are encrypted again
  under the new key (`sealAllPasswords`, `resealSecret`). Rotating stops the old key, which also sits
  in the old account's snapshots and in the stopped server, from ever opening later copies of the
  data. Keep `PASSWORD_KEY_OLD` for as long as any nightly copy or off-site backup sealed under the
  old key may need restoring: 30 days at least. Then remove it.
- **Server key: it cannot be rotated today, and the move is the wrong moment to add that.** There is
  one key and no key ring. The `CDM1` header carries no key id, and `derive()` is a fixed HMAC of the
  key. The design makes rotation cheap, though: only the 60-byte wrap header of each file (IV, tag,
  wrapped file key) changes, and the content does not. A later gap (G12): a `CDM2` header with a key
  id, plus an offline re-wrap tool. The only side effect would be that share-link unlock cookies stop
  working; they last 12 hours anyway.
- **Also rotate:** the Keycloak client secret and the DuckDNS token. Both are cheap to change, and
  copies of both remain in the old account.

## 3. Bundle encryption (Node's crypto and the AWS CLI only)

- **Do not use `openssl enc`.** It cannot use authenticated modes such as GCM, so it would mean
  CBC plus a separate MAC that someone has to get right.
- **Use a small Node script (part of G3):**
  - a 32-byte data key;
  - AES-256-GCM with a random 12-byte IV;
  - a header (format version, KMS key ARN or scrypt settings, IV) bound in as AAD, so nobody can
    tamper with the settings or force a weaker format.
- **Where the data key comes from (preferred): a customer-managed KMS key in the new account.**
  - The old server role may only call `kms:GenerateDataKey`; the new server role may only call
    `kms:Decrypt`. The old side can seal, and only the new side can open.
  - There is no passphrase to hand over, CloudTrail records every unseal, and scheduling the key for
    deletion after the move destroys every stray copy.
  - The cost is one inline policy on the old role.
  - Fallback: scrypt (N=2^17) over a generated passphrase of at least 6 words.
- **Decrypt to a temporary file.** Run `tar -x` only after `final()` has checked the tag, and never
  stream unverified plaintext into tar.
- **Write three things down out of band:** the bundle's SHA-256, the key fingerprints and the last
  hash of the audit log. `audit.js` chains entries with plain SHA-256, so the chain proves the log
  moved complete only if that last hash is compared from outside the bundle.
- **S3:** a bucket in the new account with SSE-KMS under the same key and Block Public Access. A
  bucket policy refuses requests without TLS (`aws:SecureTransport`). The presigned PUT is valid for
  at most 1 hour (treat its URL as a secret), and a lifecycle rule deletes the bundle after 3 days.

## 4. EBS snapshot under a customer-managed key, or the bundle

The snapshot route works. Copy the snapshot under a customer-managed key in the old account, share
the key and the snapshot, copy it again in the new account, then mount it. But it moves the whole
disk:
- both keys;
- `app.env`, the DuckDNS token and Caddy's ACME account key;
- logs, and deleted blocks still on the disk;
- data that is only crash-consistent unless the app is stopped first.

**Prefer the bundle**, which moves only what is listed. Keep the snapshot route for one archival
copy if D4 closes the old account. Separately, while the stack is new anyway, give `lms-ec2.yaml` a
`KmsKeyId` (customer-managed key) for the volume. With the default key, today's problem comes back
at the next move and with off-site backups. A customer-managed key costs about USD 1 a month.

## 5. TLS for two names

- Use **two separate Caddy site blocks, which gives two certificates** rather than one certificate
  for both names, so a failure on one name never takes down the other.
- Issue the new name's certificate in A4. The old name's certificate can only be issued after B5,
  when DuckDNS points at the new IP, so expect about a minute of certificate errors on the old name.
  Accept that rather than copy the old TLS private key.
- Check for **CAA** records on the school's zone: they must allow `letsencrypt.org`, and
  `sectigo.com` for ZeroSSL, which Caddy falls back to.
- Browsers already hold the one-year HSTS rule for the DuckDNS name, so the **old name must stay on
  HTTPS for years**, never plain HTTP.
- With Cloudflare (D7), use Full (strict).
- Caddy already negotiates the hybrid post-quantum key exchange (X25519MLKEM768). All other crypto
  here is symmetric with 256-bit keys. Nothing needs doing for post-quantum at this move.

## 6. Sessions and cookies

- Sessions exist only in memory, so no session secret moves and everyone signs in once. Sign-ins
  that are in progress fail (the SSO `pending` map, the 2-step challenges).
- Cookies are `__Host-`, Secure, SameSite=Strict and host-only, so they never carry over between the
  names. Leave it that way.
- **The old name must never become a second sign-in address.** G2 should serve these, and give 404
  for every other `/api/*` on the old name rather than redirect it:
  - `/verify/*`, `/api/verify/*`;
  - `/share/*`, `/api/public/share/*`;
  - `/api/calendar/feed/*`;
  - the static files those pages load. `script-src 'self'` blocks scripts redirected to another
    origin, so these files must be served on the old name.
- **Trust anchor:** for years, printed TORs are only as trustworthy as whoever controls the DuckDNS
  name. Protect that account (2-step on its sign-in) and keep the token only on the new server.

## Gaps

- **Needed for the move:** G1, G2, G3, G4, G8.
- **New, needed:**
  - **G9:** key fingerprint check, and refusing to start with keys ATLAS made itself;
  - **G10:** `oidc-client.secret` in the inventory.
- **New, nice to have:**
  - **G11:** customer-managed keys for EBS and S3;
  - **G12:** re-wrapping documents under a new server key, later.
- **Earlier council:** off-site backups should come with the move, reusing the G3 bundle format and
  keeping the keys out of the backups. `node:sqlite` should wait, because changing storage during a
  move doubles the risk.

## Verdict: Go with conditions

1. The keys travel apart from the data, are pasted from escrow and are checked by fingerprint, and
   the restore refuses to start with keys ATLAS made itself.
2. The bundle uses AES-256-GCM with an authenticated header, under a KMS data key from the new
   account (or a generated passphrase), with tar run only after the tag is checked, and is deleted
   from S3 after the restore.
3. The password key is rotated within a week of the cutover, with `PASSWORD_KEY_OLD` kept at least
   30 days. The Keycloak secret and the DuckDNS token are rotated.
4. The old name serves only the verify, share and calendar routes over HTTPS with its own
   certificate, and never sign-in.
5. When the old server is retired (D4), its volumes and snapshots are deleted, because they hold
   both keys.
