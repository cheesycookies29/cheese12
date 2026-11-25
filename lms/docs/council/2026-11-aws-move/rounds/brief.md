# Council brief: moving ATLAS to another AWS account and a new domain

**Mode:** meeting, discussion only. Members give their view; nothing is built.

## The question

Lancaster ATLAS (the school platform in `lms/`) runs on one EC2 server in the current AWS account.
It is reached at a DuckDNS address (`<name>.duckdns.org`) through Caddy with automatic HTTPS. The
owner plans to move it to **another AWS account** and a **new domain** (for example
`atlas.<school>.edu.ph`).

The analysis is in `lms/docs/migration/2026-11-new-aws-account-and-domain.md`. Read it first. Then
answer as your lens sees it:

1. **The approach.** Is it sound? What would you change: export and restore through an encrypted
   bundle in S3, keeping the old DuckDNS name as a forwarding alias, rehearsal then wipe, and the
   cutover order?
2. **What is missing.** Risks, steps, checks or decisions the analysis does not cover.
3. **The decisions D1–D8.** Your recommendation for the ones your lens covers.
4. **The gaps G1–G8.** Which are needed for the move, which are nice to have, and anything you would
   add.
5. **Your verdict:** *Go with conditions* or *Not yet*, and the 3–5 conditions that matter most.

## Facts you can rely on (check in the code if you need to)

- **Infrastructure:** `lms/deploy/aws/lms-ec2.yaml` creates the server. It takes a DuckDNS name
  only. It also creates the security group (80/443 only, no SSH), the server's role (Session Manager
  only), an Elastic IP and daily EBS snapshots (7 kept). The volume is encrypted with the account's
  default key.
- **Updates:** `lms/deploy/aws/github-ops.yaml` (optional) lets GitHub Actions ask the server to
  update or report status through SSM, using a GitHub OIDC role.
- **Server setup:** `server-setup.sh`, `Caddyfile`, `cloudflare-apply.sh`, `duckdns-update.sh`,
  `ltdc-lms-backup.cron` and `EC2.md`, all in `lms/deploy/aws/`.
- **Data:** `/opt/ltdc-lms/data`:
  - `db.json`, one JSON file;
  - `audit-log.jsonl`, chained;
  - `files/`;
  - `documents/`, encrypted per file under `server.key`;
  - `password.key`, which encrypts the password hashes and the 2-step secrets;
  - `monitor.json`;
  - `backups/`, nightly copies on the **same disk**, with no off-site copy.
- **Keys:** `password.key` and `server.key` are not in the nightly copies. The Keycloak client
  secret is `OIDC_CLIENT_SECRET` in `/etc/ltdc-lms/app.env`.
- **Domain-bound things:**
  - `ALLOWED_HOSTS` and `PUBLIC_URL`;
  - Keycloak's redirect URI `/api/sso/callback`;
  - calendar feed URLs, built from the request origin;
  - Documents share links `/share/<token>`;
  - **QR codes printed on TORs, CORs and certificates**, which carry `location.origin` at print time
    (`lms/public/js/academic/views/documents.js`);
  - session cookies (host-only).
- **Earlier council:** the meeting on the CBSUA architecture
  (`lms/docs/council/2026-11-cbsua-modules/README.md`) asked for:
  - `atlas.cbsua.edu.ph`, not DuckDNS;
  - hourly off-site backups with a rehearsed restore;
  - deploys only from a protected release branch;
  - storage moved to `node:sqlite` before real volume.

  Say whether the move is the right moment for any of these.

## Rules

- **Discussion only.** Do not change any file except your own round file.
- **No secrets** (keys, tokens, passwords) in what you write.
- **No security-test or vulnerability details.** Those reports are confidential.
- **Write your answer** to `lms/docs/council/2026-11-aws-move/rounds/r1-<your-name-lowercase>.md`,
  about 500–900 words.
- **Be concrete:** name files, steps and AWS services, and back claims with the code where you can.
