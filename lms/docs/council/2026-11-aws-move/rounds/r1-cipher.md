# Round 1: Cipher (cryptography and key management)

**Core recommendation:** The approach is sound, with one change: **the keys do not travel in the
bundle.**
- The data bundle is encrypted with AES-256-GCM under a one-time data key sealed by a KMS key in the
  *new* account.
- `password.key` and `server.key` are installed from the school's password manager, so the move also
  proves the escrow copy works.

**Why.** Put the data and both keys in one archive and whoever gets it has everything. The code
already keeps the two apart:
- `auth.js` seals the scrypt hashes and the TOTP secrets with AES-256-GCM under the password key,
  with separate AADs and a key id in every `enc1$<id>$…` value;
- `dms/blobs.js` wraps a key for each file under `derive('documents.master-key')`.

A bundle without the keys exposes only the plain records in `db.json`. Each key is 64 hex
characters, small enough to paste.

## 1. How the keys travel

- **Paste them, never print them.** In Session Manager, use `read -s` and write each file with mode
  0600, owned by `ltdc-lms`. Never `cat` a key: session logging records the screen. EC2.md's
  `sudo cat password.key` should change for the same reason.
- **Check them by fingerprint.** At export, write `sha256sum` of each key into the manifest. The
  restore compares them and **refuses to start ATLAS on a mismatch.** The stack's first install
  starts ATLAS, and `loadPasswordKeys` (`auth.js`) and `createSecrets` (`secrets.js`) **quietly make
  new keys when the files are missing.** ATLAS then starts with the wrong keys and gives only a log
  line about unreadable passwords. Documents open as "damaged". Anything written afterwards is sealed
  under the wrong key, leaving the data split between two keys.
- **Restore order:** stop ATLAS and its update timer, delete the keys ATLAS made, install the escrow
  keys, check the fingerprints, start.
- **Missing from the inventory:** `data/oidc-client.secret`. `sso.js` uses it before
  `OIDC_CLIENT_SECRET`.

## 2. Rotation

**Password key: rotate it after the go/no-go window**, not during it.
- The code already supports this. Set the new key as current and the old one as `PASSWORD_KEY_OLD`.
  About two minutes after start, every hash and TOTP secret is sealed again under the new key
  (`sealAllPasswords`, `resealSecret`). Nobody changes their password.
- This stops the old key, which also lives in the old account's snapshots, from opening any later
  copy of the data.
- Keep `PASSWORD_KEY_OLD` for as long as a backup sealed under it may be restored: 30 days at least.

**Server key: it cannot be rotated today, and the move is no time to add that.**
- There is a single key: no key ring, no key id in the `CDM1` header, and `derive()` is a fixed HMAC.
- The envelope design makes rotation cheap later. Only each file's 60-byte wrap header changes, and
  the content does not. That needs a `CDM2` header with a key id and an offline re-wrap tool (G12).

**Rotate as well:** the Keycloak client secret and the DuckDNS token. Copies of both stay in the old
account.

## 3. Bundle encryption (Node crypto and the AWS CLI)

- **Not `openssl enc`.** It does not support GCM, so it would mean CBC plus a hand-built MAC.
- **A small Node script (G3):**
  - a 32-byte data key;
  - AES-256-GCM with a random 12-byte IV;
  - the header (format version, key ARN or scrypt settings, IV) bound as AAD, so nobody can tamper
    with the settings or force a weaker format.
- **The data key: a customer-managed KMS key in the new account.**
  - The old server role gets `kms:GenerateDataKey` only, and the new role `kms:Decrypt` only.
  - So the old side can seal and only the new side can open. There is no passphrase to hand over,
    and CloudTrail logs every unseal.
  - Scheduling the key for deletion afterwards makes every stray copy unreadable.
  - Fallback: scrypt (N=2^17) over a generated passphrase of at least 6 words.
- **Decrypt to a temporary file first.** Run `tar -x` only after `final()` has checked the GCM tag.
- **Write three things down out of band:** the bundle's SHA-256, the key fingerprints and the last
  hash of the audit log. `audit.js` chains entries with plain SHA-256, so the chain proves the log
  moved complete only if that last hash is compared from outside the bundle.
- **S3:**
  - SSE-KMS under the same key, and Block Public Access;
  - a bucket policy that denies requests without TLS (`aws:SecureTransport`);
  - a presigned PUT valid for 1 hour at most, its URL treated as a secret;
  - a lifecycle rule that deletes the bundle after 3 days.

## 4. EBS snapshot under a customer-managed key, or the bundle

- **The snapshot route works but moves the whole disk:**
  - both keys;
  - `app.env`, the DuckDNS token and Caddy's ACME account key;
  - logs and deleted blocks;
  - data that is only crash-consistent unless ATLAS is stopped first.
- **Prefer the bundle**, which moves only what is listed. Keep a snapshot copy only as an archive if
  D4 closes the old account.
- **While the stack is new anyway,** give `lms-ec2.yaml` a `KmsKeyId` (a customer-managed key) for
  the volume. Otherwise the default key blocks the next move and off-site copies.

## 5. TLS for two names

- **Two Caddy site blocks**, so each name gets its own certificate and one failure cannot take down
  both.
- **The new name's certificate** is issued in A4.
- **The old name's certificate** can only be issued after B5, once DuckDNS points at the new IP.
  Accept a minute of errors rather than copy the old TLS private key.
- **CAA records** on the school's zone must allow `letsencrypt.org`, and `sectigo.com` for ZeroSSL,
  which Caddy falls back to.
- **HSTS:** browsers keep the one-year rule for the DuckDNS name, so the old name stays on HTTPS for
  years.
- **Cloudflare:** with it (D7), use Full (strict).
- **Post-quantum:** current Caddy already uses the hybrid post-quantum key exchange
  (X25519MLKEM768), and everything else is symmetric with 256-bit keys. Nothing needs doing.

## 6. Sessions and cookies

- **Everyone signs in once.** Sessions are in memory only, so no session secret moves. Sign-ins in
  progress fail: the SSO `pending` map and the 2-step challenges are in memory too.
- **Cookies stay as they are.** They are `__Host-`, Secure, SameSite=Strict and host-only, so
  nothing carries over between the names.
- **The old name must never be a sign-in address.** G2 serves these on it:
  - `/verify/*` and `/api/verify/*`;
  - `/share/*` and `/api/public/share/*`;
  - `/api/calendar/feed/*`;
  - the static files those pages load. `script-src 'self'` blocks scripts redirected to another
    origin, so these files must be served on the old name.

  Every other `/api/*` on the old name answers 404, not a redirect.
- **The DuckDNS account must stay protected for years:** whoever controls that name controls what
  the QR codes on printed TORs show. Turn on 2-step for its sign-in.

## Gaps

- **Needed:** G1, G2, G3, G4, G8, and two new ones:
  - **G9:** a key fingerprint check, and a refusal to start with keys ATLAS made itself;
  - **G10:** `oidc-client.secret` in the inventory.
- **Nice to have:**
  - **G11:** customer-managed keys for EBS and S3;
  - **G12:** server key re-wrap, later.
- **Earlier council:**
  - Off-site backups fit the move: reuse the G3 format, without the keys.
  - `node:sqlite` should wait: a storage change during a move doubles the risk.

## Verdict: Go with conditions

1. The keys travel apart from the data, from escrow, checked by fingerprint. The restore refuses
   keys ATLAS made itself.
2. The bundle uses AES-256-GCM with an authenticated header, under a KMS data key (or a generated
   passphrase). It is unpacked only after the tag is checked, and deleted after the restore.
3. The password key is rotated within a week of the cutover, with `PASSWORD_KEY_OLD` kept 30 days or
   more. The Keycloak secret and the DuckDNS token are rotated.
4. The old name serves only the verify, share and calendar routes, over HTTPS with its own
   certificate, and never sign-in.
5. When the old server is retired (D4), its volumes and snapshots are deleted, because they hold
   both keys.
