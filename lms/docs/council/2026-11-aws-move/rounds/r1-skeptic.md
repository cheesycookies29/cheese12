# Skeptic: Round 1, moving ATLAS to a new AWS account and domain

**Core recommendation:** the approach is right. But two of its safety claims are not yet true in the deploy files: "two servers never take changes" and "rollback is restarting the old server".

## 1. The approach

- **The template is the first trap.** `lms-ec2.yaml` requires a DuckDNS name and token. `server-setup.sh` points that name at the new server on first boot, then every 5 minutes (`/etc/cron.d/ltdc-lms-duckdns`). Built with the production name before G1 exists, the new stack moves the live address, and every printed QR code, to an empty server days early. Until then, use a throwaway name.
- **The stopped old server fights back.** If anyone starts it, its cron points the old name back at it within 5 minutes, ATLAS starts on stale data, and the update timer installs the branch. That is split-brain. Before the stop at B1:
  - disable `ltdc-lms`, `ltdc-lms-update.timer` and the DuckDNS cron;
  - take a **manual** EBS snapshot, which the 7-day DLM rotation does not delete.

  The rollback asset is that snapshot, not the stopped server.
- **Rehearse on a throwaway stack.** "Wipe" on the real server leaves DLM snapshots holding the records and both keys for 7 days. Deleting a separate stack and its snapshots is a provable wipe. Never run Keycloak or Cloudflare "Set up for me" on the rehearsal copy: Cloudflare's set-up writes the zone's DNS records (`server/cloudflare.js`).
- **Freeze the code.** One commit, `AutoUpdate=No`, from export to go/no-go: `update.sh` restarts the service and could start ATLAS mid-export.
- **Keep the new server dark until the restore.** An empty ATLAS on a public name is waiting for its first administrator. Stop `ltdc-lms` after first boot (Caddy still gets its certificate).

## 2. What is missing

- **Inventory:**
  - `oidc-client.secret` is in the data folder when Keycloak was set up from the Admin panel (`server/sso.js`), not only in `app.env`.
  - `avatars/` is not listed.
  - Do **not** restore `cloudflare.json` as it is. `ltdc-lms-cloudflare.path` fires when it changes and rewrites Caddy and `ALLOWED_HOSTS` from the old request.
- **Checks that catch truncation.** An audit chain that was cut short still verifies. At B1, record on the old server:
  - the number of audit entries and the last hash;
  - the count of each collection;
  - a SHA-256 list of every file;
  - both key ids (`keyId` in `server/auth.js`, never the keys).

  Compare all of them on the new server. Any difference means no-go.
- **G2's path list is incomplete.** `verify.html` fetches `/api/verify/<code>` and loads `/css` and `/img`; `share.html` loads `/js/share.js` and its API. Serving only `/verify/*` and `/share/*` gives pages whose check fails. Simpler: redirect everything on the old name except `/api/calendar/feed/*` (a QR scan opens a browser, which follows redirects), and set `PUBLIC_URL`. Test with real phones and calendars.
- **Cloudflare and the old name do not work together today.** With "only through Cloudflare" on, `cloudflare-apply.sh` drops the DuckDNS site and the firewall blocks it. Every QR code would stop working that day.
- **Certificate gap at B5.** Caddy gets the old name's certificate only after DuckDNS points at it; until then the one-year HSTS header (`Caddyfile`) leaves visitors no click-through. Check it inside the window.
- **Rollback must stop the new server too.** People will use the new name; pointing only the old name back leaves two live copies. Rehearse the rollback. One named person calls go/no-go at a fixed time (say T+60 min); after that, fix forward.
- **Phishing.** "New address, everyone signs in again" is a ready-made lure. Announce the exact address inside ATLAS.
- **Old Elastic IP.** Check nothing points at it before release; it passes to another AWS customer.

## 3. DuckDNS as the QR codes' name for years

It has to stay for what is already printed, but it is a liability:
- a free service with no commitment;
- tied to one person's social login;
- controlled by one token, kept in `server.env` and in the stack's user data.

Whoever controls it controls what "genuine" means on every printed TOR. Conditions:
- **Ownership:** the account moves to a school-owned login with MFA and two named holders.
- **Token:** rotated after the move, which also cuts off the old server.
- **Monitoring:** a daily outside check that the name still points at the new Elastic IP, with an alert to a person.
- **A fallback:** a bare `/verify` page with a code box on the new domain. The paper says "Check at <host>/verify", but `server.js` answers only `/verify/<code>`.

The `.edu.ph` domain needs the same care: registered to the school, auto-renew, two contacts.

## 4. Decisions

- **D2:** keep the old name, under section 3.
- **D3:** same region; one change at a time.
- **D4:** keep the old account 30 days, then delete its snapshots, volumes and backups: closing an account does not delete its data.
- **D6:** Keycloak does not move in the same window.
- **D7:** no Cloudflare lock while the old name serves QR codes, and no Cloudflare change during the cutover.
- **D8:** move before CBSUA's data import, when there is least data. Book 3 hours for a 60-minute job.

## 5. Gaps

- **Needed:** G1, G2 (corrected), G3, G4, G6, and G8 (the `EC2.md` runbook and the admin guide).
- **Only if D7 is yes:** G5.
- **Nice to have:** G7.
- **Add:** G9, old server switched off and snapshotted; G10, the comparison list; G11, the code freeze; G12, the dark new server; G13, bundle hygiene (S3 public access blocked, one-day expiry, every version and unpacked copy deleted).

**Earlier council:**
- **The domain** is the move itself.
- **Protected release branch:** yes; set `GitHubBranch` at stack creation.
- **Off-site backups:** yes; G3 and G4 are half of a rehearsed restore. Keep the keys apart from the data.
- **`node:sqlite`: not in the same window.** If counts differ, you must know whether transport or conversion broke them. G3 should copy the whole folder, so it still works with SQLite's `-wal` file.

## Verdict: Go with conditions

1. No stack in the new account uses the production DuckDNS name before G1 and G6. Rehearse on a throwaway stack, then delete it with its snapshots.
2. The old server's services are off and its manual snapshot is taken before it stops. The rollback is rehearsed, and it puts the new server into maintenance.
3. The cutover passes the full comparison, with a named go/no-go owner and a fixed time.
4. The old name redirects (calendar feeds served directly), keeps valid HTTPS, is not locked behind Cloudflare, and is in school custody with a rotated token and a daily check.
5. Within 24 hours, the bundle is deleted, along with every copy of the keys except the new server's and the password manager's. The deletion is checked.
