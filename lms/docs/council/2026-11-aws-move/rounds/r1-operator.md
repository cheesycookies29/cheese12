# Round 1: Operator (deployment, infrastructure, operations)

## 1. The approach

The approach is sound. I agree with the S3 bundle: `lms-ec2.yaml` encrypts the volume with the default `aws/ebs` key, so a snapshot cannot be shared with another account. I also agree with the DuckDNS alias and with "stop old, then copy". The weak points are the **background jobs that will undo the cutover by themselves**:

- **The DuckDNS cron.** `/etc/cron.d/ltdc-lms-duckdns` runs every 5 minutes and sends `ip=${PUBLIC_IP}`. B1 stops only the app, so the old server takes the old name back within 5 minutes of B5. Worse, the template still *requires* a DuckDNS name and token. A new stack built with the live name takes over the live address on rehearsal day. Remove the cron on the old server in B1, and build the new stack without DuckDNS.
- **The update timer.** `ltdc-lms-update.timer` ends with `systemctl start ltdc-lms`. One push during the window, and the stopped old server takes writes again. In B1, run `systemctl disable --now ltdc-lms-update.timer` and `systemctl mask ltdc-lms`. Keep the new server's timer off until B4 passes. Freeze the branch until cutover + 7 days, and check that `build.json` shows the same commit on both servers.
- **The new server's own keys.** `server-setup.sh` starts ATLAS, which creates a fresh `password.key` and `server.key`. A restore that leaves those keys in place looks healthy while every document stays sealed. Compare the keys by `sha256sum` fingerprint and never `cat` them, because Session Manager logging may record what is printed. EC2.md's `sudo cat password.key` advice should change.
- **The new name is public for days.** From A4 it shows a setup page, then the rehearsal copy with real, working passwords. Put a Caddy holding page on it; ACME still works behind it. Open the rehearsal only to the operator's IP (`remote_ip`) or through SSM port forwarding.

One change: **leave the keys out of the bundle** and restore them from the school's password-manager copy. A leaked bundle is then useless on its own, and the move proves that the escrowed keys work.

## 2. What is missing

- **Let's Encrypt limits.** Each rebuilt stack asks for a new certificate. Too many rebuilds can hit the duplicate-certificate limit in cutover week. Between rehearsals, wipe the data folder, not the stack. Check that the school's **CAA** records allow Let's Encrypt.
- **DNS.** A new record has no TTL to lower. The risk is negative caching, so create it early. Publish **A only, no AAAA**: the instance has no IPv6 address.
- **The old name's certificate.** It can only be issued after B5, so old QR codes see errors for a few minutes. Check them with `curl` before the go.
- **The Elastic IP changes.** Check whether Keycloak or a mail relay allows only the old IP.
- **A time box.** If B4 is not green by T+45 min, roll back. After the go, a rollback is a *reverse* move, so G3 must work both ways.
- **Snapshots.** DLM starts at the next 18:00 UTC. Take manual snapshots after B4 (new server) and after B1 (old server).
- **Monitoring.** Nothing outside the server watches it today. Add:
  - external checks on `https://<new>/healthz` and `https://<old>.duckdns.org/verify/<code>`;
  - an alert when either certificate is within 14 days of expiry, because the old name now carries every printed QR code;
  - a CloudWatch `StatusCheckFailed_System` alarm with auto-recover.
- **Ownership.** Write down who owns the DuckDNS account, a years-long dependency.
- **The window.** A maintenance page on the old server.

## 3. Decisions

- **D1:** an A record at the school's DNS. Route 53 only if a subzone is delegated.
- **D2:** keep the alias. It is mandatory for `/verify`.
- **D3:** stay in `ap-southeast-1`.
- **D4:** keep the old account and its stopped instance for at least 60 days, and until a restore from the new off-site backups is drilled. It costs a few dollars a month.
- **D5:** check **IAM → Identity providers** and the names `ltdc-lms`, `ltdc-lms-github-ops` and `ltdc-lms-ops` first.
- **D7:** no Cloudflare in the window; turn it on a week later.
- **D8:** book 2 hours for 30–60 minutes of work, with a named go/no-go owner.

## 4. Gaps

- **Needed:**
  - G1 (DuckDNS optional, a `Domain` parameter);
  - G2;
  - G3, reversible, with key fingerprints and a sha256 manifest;
  - G4 as a runbook: a new-account bucket with Block Public Access, TLS only, a 3-day expiry and a presigned PUT; `gpg --symmetric`; a 5 GB limit per PUT;
  - G6;
  - G8.
- **Only with Cloudflare:** G5.
- **Nice to have:** G7, and the Route 53 part of G1.
- **Add:**
  - G9, holding and maintenance pages;
  - G10, a freeze built into the export (timer, service, DuckDNS cron);
  - G11, monitoring and the auto-recover alarm.

**The earlier council's asks:**

- **Domain:** yes, now.
- **Release branch:** yes, now. `GitHubBranch` and `DeployBranch` are set when the stacks are created, so this is the cheapest moment. Also change `on.push.branches` in `atlas-update.yml`.
- **Off-site backups:** within 2 weeks of the cutover, before the old account goes. Reuse G3 and the bucket, with their own write-only role and no keys.
- **`node:sqlite`:** no. Never change storage in the same window as the host, the account and the domain.

## 5. Verdict: Go with conditions

1. G1, G2, G3 (both ways) and G6 pass a full rehearsal on a test account, kept off the public name.
2. B1 freezes the old server completely: the app masked, the timer and the DuckDNS cron removed, the branch frozen.
3. The restore proves the keys by fingerprint against the password-manager copy. It checks counts, the audit chain, one document, and `/verify` on **both** names, within a 45-minute go/no-go.
4. Before users return: a manual snapshot, external uptime and certificate checks on both names, and an auto-recover alarm.
5. The old account stays until hourly off-site backups run in the new account and one restore from them has been drilled.
