# Moving ATLAS to another AWS account and a new domain: analysis

Status: **analysis only.** Nothing is built yet. **Reviewed by the council on 2026-11-25:** see
[../council/2026-11-aws-move/README.md](../council/2026-11-aws-move/README.md) for what it adds and changes
(keys travel apart from the data, a freeze step, a 308 forward, and gaps G9–G17). This note lists what the move touches, what has to be
decided first, what the code and templates cannot do yet, and the order to do it in.

Today ATLAS runs on one EC2 server made by `deploy/aws/lms-ec2.yaml`:
- the server reaches the internet through one fixed IP (an Elastic IP);
- its address is `<name>.duckdns.org`;
- Caddy gets the HTTPS certificate;
- the data is in `/opt/ltdc-lms/data`.

GitHub updates go through `deploy/aws/github-ops.yaml`, which is optional.

---

## 1. Decisions needed before anything is built

| # | Question | Why it matters |
|---|---|---|
| D1 | **The new domain name**, for example `atlas.<school>.edu.ph`. Who controls its DNS: Route 53 in the new account, Cloudflare, or the school's or registrar's DNS? | The template only knows DuckDNS (section 3). Certificates, Keycloak, calendar feeds and printed QR codes all carry the domain. |
| D2 | **Is the old DuckDNS name kept?** Recommended: keep it, pointed at the new server, sending visitors to the new name. | QR codes already printed on TORs, CORs and certificates, calendar subscriptions and Documents share links all hold the old name (section 4). If it goes, they break. |
| D3 | **Same AWS region?** Today it is `ap-southeast-1`, the template's default. | An EBS snapshot and an Elastic IP stay in their region. Latency for the campus. |
| D4 | **Is the old AWS account closed after the move, or kept?** | This decides how long the old server can stay as a fallback. Section 7 asks to keep it stopped for 2–4 weeks. |
| D5 | **Does the new account already have CORE ERP**, or another stack with GitHub OIDC? | An account can have only one GitHub identity provider. If it has one, `github-ops.yaml` is created with `CreateGitHubConnection = No`. |
| D6 | **Does Keycloak move too, or change address?** | ATLAS stores the Keycloak issuer URL, and Keycloak stores the ATLAS redirect URL. Both sides must be updated. |
| D7 | **Is Cloudflare in front of the new domain?** | With Cloudflare, the "only through Cloudflare" firewall and `cloudflare-apply.sh` apply. That script falls back to the DuckDNS name (section 3, G5). |
| D8 | **When is the maintenance window, and how long?** Suggested: a weekend evening, outside enrollment, grade submission and payroll cut-off. | Expected downtime is 30–60 minutes (section 6). |

---

## 2. What has to move: the inventory

### Must move, or the school loses data or access

| Item | Where | Note |
|---|---|---|
| Records | `/opt/ltdc-lms/data/db.json` | Copy with the app stopped. It is one file, written by the app. |
| Audit log | `/opt/ltdc-lms/data/audit-log.jsonl` | The entries are chained. Copy it intact and check the chain afterwards (System → Audit log). |
| Uploaded class files | `/opt/ltdc-lms/data/files/` | |
| ATLAS Documents | `/opt/ltdc-lms/data/documents/` | Encrypted. The `uploads/` part-uploads can be left behind. |
| Job applicants' documents | `/opt/ltdc-lms/data/applicant-files/` | Encrypted under a key derived from `server.key` (no key of its own). Added 2026-11-26. |
| Document circulation's forms | `/opt/ltdc-lms/data/forms/` | Every version of every downloadable form; encrypted under a key derived from `server.key` (no key of its own). Added 2026-11-26. |
| **Password key** | `/opt/ltdc-lms/data/password.key`, or `PASSWORD_KEY` in `app.env` | **Not in the nightly backups.** Without it, no password works, and every 2-step verification secret is lost, because those secrets are sealed under the same key. |
| **Server key** | `/opt/ltdc-lms/data/server.key`, or `SERVER_KEY` in `app.env` | **Not in the nightly backups.** Without it, no document in ATLAS Documents can be opened, ever. It cannot be changed or recovered. |
| Keycloak client secret | `OIDC_CLIENT_SECRET` in `/etc/ltdc-lms/app.env` | Only if Keycloak is used. It is kept only on the server. |
| Other `app.env` lines | `/etc/ltdc-lms/app.env` | Copy only the lines that matter: `PASSWORD_KEY_OLD`, `KEYCLOAK_PRIVATE_HOSTS`, any limits that were set. Do not copy `ALLOWED_HOSTS` or `PUBLIC_URL`; they change. |

### Can move, but nothing breaks without it

| Item | Where | Note |
|---|---|---|
| Security monitor history | `data/monitor.json` | Charts start again otherwise. |
| Nightly copies | `data/backups/` | Old copies, 30 days. Copy them if the old account is closed (D4). |
| Caddy access logs | `/var/log/caddy/` | Keep with the old account's records if needed. |

### Does not move; made new in the new account

- The CloudFormation stack and the EC2 instance.
- The **new Elastic IP**, so the server's public IP changes.
- The security group.
- The IAM roles: the server's Session Manager role and the snapshot role.
- The daily snapshot policy (DLM).
- The SSM document `ltdc-lms-ops`.
- The GitHub OIDC role `ltdc-lms-github-ops`.
- The Caddy certificate, which is issued again for the new name.
- `/etc/ltdc-lms/server.env`, with a new setup code.
- PDF Studio's working files: they are deleted after 4 hours anyway, so tell people to finish their work before the window.

### Unaffected

- **School networks.** They list *campus* addresses, which do not change. The server's own address is not in them.
- **TOTP authenticator entries.** Their issuer is "ATLAS", not the domain, so people's authenticator apps keep working, provided the password key moves.
- **The GitHub repository, the branch and automatic updates.** These stay as they are.

---

## 3. What the code and templates cannot do yet (to build later)

| # | Gap | What would be built |
|---|---|---|
| G1 | **`lms-ec2.yaml` only takes a DuckDNS name.** `LMS_DOMAIN` is always `<sub>.duckdns.org`, and the DuckDNS token is required. | A `Domain` parameter, with DuckDNS optional. An optional list of old names to forward. Optionally, a Route 53 record when the zone is in the same account. |
| G2 | **No forwarding from an old name.** Caddy has one site block, and `ALLOWED_HOSTS` has one name. | A Caddy block for the old name or names that **serves** `/verify/*`, `/share/*` and `/api/calendar/feed/*` directly. Calendar apps and some scanners do not reliably follow redirects. It would answer `301` to the new name for everything else. The old name would also be added to `ALLOWED_HOSTS`. |
| G3 | **No export or restore of a whole server.** "Download backup" holds the records only: not files, documents or keys. | An **export** step on the old server: stop ATLAS, pack the data folder, both keys and the chosen `app.env` lines, with a checksum. A **restore** step on the new server: unpack, set the owners and modes, check the checksum, start, and check the audit chain. Both run from the AWS console (Session Manager), with no SSH. The key material must never go through GitHub, chat or email. |
| G4 | **Transport between accounts.** The EBS volumes are encrypted with the account's default AWS key, and **those snapshots cannot be shared with another account.** | Copy the bundle through an S3 bucket in the *new* account with a short-lived upload link, or by hand through the console. Encrypt it on the old server before it leaves, with a passphrase given to the operator and nowhere else. The other route is re-encrypting a snapshot copy under a customer-managed KMS key and sharing that, which takes more steps and gives the whole disk. |
| G5 | **`cloudflare-apply.sh` assumes DuckDNS.** "Switch off" goes back to `LMS_DOMAIN` from `server.env`, described as "back to the DuckDNS address only". | Make it use the configured domain, whatever it is. Check the Admin panel's Cloudflare page texts too. |
| G6 | **The DuckDNS updater** (`duckdns-update.sh`) runs only when a DuckDNS name is the main address. | Keep it running for the **old** name (D2) so it points at the new server's IP. Without a DuckDNS name, it is not installed. |
| G7 | **Old-domain links stored in the data.** News, announcements, lesson text and resources may hold full `https://<old>.duckdns.org/...` links. | A read-only check, run from the console, that lists records with the old name, for an administrator to fix or to leave to the forwarding in G2. |
| G8 | **Documentation.** | `deploy/aws/EC2.md`: a section "Moving to another AWS account or domain". `docs/guides/admin.md`: what changes for people, and what to tell them. A What's-new line. |

---

## 4. What people will notice, and what to tell them

| What | Effect | Handled by |
|---|---|---|
| New address | Bookmarks and phone home-screen shortcuts to the old name. | G2 forwarding; an announcement in ATLAS a week before. |
| Signed out once | Sessions are kept per address, and in the server's memory, so everyone signs in again. | Expected; mention it in the announcement. |
| Saved settings in the browser (PDF Studio arrangement, small view preferences) | These are kept per address, so they start fresh. | Minor; nothing to do. |
| **Printed documents' QR codes** (TOR, COR, certificates) | The QR code and the "Check at … /verify" line hold the address **as it was when printed** (`public/js/academic/views/documents.js`). These are permanent on paper. | G2 must keep `/verify/*` answering on the old name **for as long as those documents are in use**: years. This is the strongest reason for D2. |
| Calendar subscriptions (`/api/calendar/feed/<token>.ics`) | Phones and Google Calendar keep the old address. | G2 serves the feed on the old name. People can also copy the new address from Calendar → Subscribe. |
| Documents share links already sent to outside people | They hold the old name. | G2 serves `/share/*` on the old name until the links expire; links have an end date. |
| Keycloak sign-in | Keycloak only sends people back to addresses it knows. | Add the new `https://<new>/api/sso/callback` and web origin in Keycloak (client `atlas`) **before** the cutover; remove the old one later. Or use **Admin panel → Sign-in → Keycloak** again on the new address, which updates the client when ATLAS has Keycloak admin access. |
| 2-step verification | Unchanged: the same codes and authenticator entries. | The password key moves (section 2). |
| PDF Studio files in progress | Lost at the cutover. | Announce: finish before the window. |

---

## 5. Checks before the move (on the old server, from the console)

1. **Size of the data:** `du -sh /opt/ltdc-lms/data/{db.json,files,documents,backups}`. This sets the copy time and the new disk size (`DiskSizeGiB`).
2. **Both keys exist and are backed up** in the school's password manager: `password.key` and `server.key`. Check them against the copies.
3. **Versions:** `cat /opt/ltdc-lms/build.json` and `node --version` (22 expected). The new server installs the same branch.
4. **Audit chain is intact** (System → Audit log) and the Security monitor shows no open problems.
5. **The lines in `app.env` to carry over:** for example `OIDC_CLIENT_SECRET` and `KEYCLOAK_PRIVATE_HOSTS`. Write them down somewhere safe, never in chat or email.
6. **Keycloak:** note the issuer URL and whether ATLAS manages the client.
7. **Cloudflare:** is it switched on, is "only through Cloudflare" on, and which zone.
8. **Old-domain links in the data** (G7).

---

## 6. Order of the move (outline)

**A. Prepare (days before)**
1. Settle D1–D8.
2. Build G1–G8, test them on a test account, and rehearse.
3. Lower the TTL of the new domain's DNS record to 300 s. The DuckDNS TTL is already short.
4. In the new account:
   - create the stack with the new domain;
   - let Caddy get its certificate, which needs the new name pointed at the new Elastic IP;
   - add `github-ops.yaml` (D5) and update the GitHub variables: `ATLAS_AWS_ROLE_ARN`, `ATLAS_EC2_INSTANCE_ID` and `ATLAS_AWS_REGION`.
5. **Rehearsal:** restore a copy of the data on the new server and check it:
   - sign in, 2-step, a document opens, a TOR verifies, the calendar feed, Keycloak;
   - then **wipe it**, so two live copies never take changes.
6. Add the new redirect URL in Keycloak.
7. Post an announcement in ATLAS: the date, the new address, "you will be signed out once", "finish PDF Studio work".

**B. Cutover (the window)**
1. Stop ATLAS on the old server so no more changes are made. A maintenance page is optional.
2. Export the bundle (G3), with checksums, and carry it over (G4).
3. Restore it on the new server and start ATLAS.
4. Check: health, sign-in, the audit chain, counts (students, employees, documents), one document opens, `/verify/<code>` works.
5. Point the **old** DuckDNS name at the new Elastic IP. The forwarding (G2) then serves the old QR codes, calendar feeds and share links.
6. If Cloudflare is used: switch it on for the new domain from the Admin panel.

**C. After**
1. Watch the Security monitor and the GitHub update run for a few days.
2. Keep the old server **stopped, not deleted**, for 2–4 weeks (D4), with its snapshots. Then release its Elastic IP, delete the stack and the old OIDC role, and close or keep the account.
3. Change the GitHub repository variables if not done, and remove the old `ltdc-lms-github-ops` role.
4. After a term, remove the old Keycloak redirect URL. Keep the old domain forwarding (D2).

**Rollback.** If something is wrong during B:
- start the old server again and point the old DuckDNS name back at the old IP;
- nothing was changed there, because it was stopped first;
- after people have worked on the new server, rolling back means losing that work, so decide "go or no-go" within the window.

---

## 7. Risks

| Risk | Effect | How it is avoided |
|---|---|---|
| A key is not copied | Every password fails, or every document is unreadable, for good. | Section 2; the checks in A5 and B4; the copies in the password manager. |
| Two servers taking changes at once | Records split, with no clean merge. | Stop the old server first (B1); wipe the rehearsal copy (A5). |
| Old domain dropped | Printed QR codes, calendars and share links break. | D2 and G2. |
| The certificate is not issued for the new name | No HTTPS at the cutover. | Get it during A4, before the window, because the name is new. |
| The bundle leaks while being moved | It holds the records **and both keys**. | Encrypted before it leaves (G4); a short-lived link; deleted after the restore; never through GitHub, chat or email. |
| Keycloak refuses the new address | Staff who sign in with Keycloak are blocked. | A6, before the cutover; local passwords still work for administrators. |
| Same-account CloudFormation names | `ltdc-lms-github-ops` or `ltdc-lms-ops` already exist in the new account (for example from CORE). | D5; rename at stack creation if needed. |

---

## 8. Not affected, for the record

The application code, the database format, users, roles, permissions, school networks, the guides and
the GitHub workflow's tests are not affected. The move changes *where* ATLAS runs and *under which
name*, not what it does.
