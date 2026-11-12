# Putting Lancaster ATLAS online with Amazon EC2

This puts Lancaster ATLAS (the ATLAS home page, ATLAS Learn and ATLAS People) on an Amazon EC2 server, at an address like **https://cbsua-portal.duckdns.org**, with HTTPS. Everything is done in the AWS website; no terminal and no key files.

The server's own names (the `ltdc-lms` service, `/opt/ltdc-lms`, `/etc/ltdc-lms`, the template `lms-ec2.yaml`) keep their names from before the ATLAS rename, so a server that is already running updates in place.

One template file (`lms-ec2.yaml`) builds the whole server:

```
Visitors ──HTTPS──▶ Caddy (automatic certificate) ──▶ Lancaster ATLAS (port 3100, this server only)
                                                        └── /opt/ltdc-lms/data   (records and uploaded files)
```

- **Ubuntu 24.04** server with security updates installed automatically, in the **Singapore** region.
- A **fixed public IP** (Elastic IP), and your **DuckDNS** address pointed at it automatically.
- **HTTPS** certificate from Let's Encrypt, renewed automatically.
- **Backups:** a copy of the data every night (30 days kept) and a snapshot of the whole disk every day (7 kept).
- **Updates:** every 10 minutes the server checks GitHub. A new version is installed only if its tests pass on the server, and if it does not start the previous version is put back.
- **No SSH port.** If you ever need a console on the server, open it from the AWS website (Session Manager).
- **A setup code** that you choose protects the first administrator account, so nobody else can claim the new site.

It takes about 20 minutes, most of it waiting.

## Before you start

1. **Protect the AWS root account.** Sign in to AWS with the root email, open **IAM → Security credentials** (or your account name → *Security credentials*) and:
   - change the root password if it has ever been shared (for example in a chat or email);
   - under **Multi-factor authentication (MFA)**, click **Assign MFA device** and set up an authenticator app.
2. **Set a budget alert.** **Billing and Cost Management → Budgets → Create budget → Monthly cost budget**, e.g. US$30, with your email.
3. **Expected cost** (Singapore, before credits):

   | Item | t3.small (recommended) | t3.micro (to try it out) |
   |---|---|---|
   | Server | about US$19 | about US$10 |
   | Public IPv4 address | US$3.65 | US$3.65 |
   | 30 GB disk (gp3) | about US$3 | about US$3 |
   | Daily snapshots (7 kept) | about US$1–2 | about US$1–2 |
   | **Total per month** | **about US$27** | **about US$18** |

## Step 1: Get a DuckDNS address

1. Go to <https://www.duckdns.org> and sign in (the same account as for the ERP is fine).
2. Under **domains**, type a name, e.g. `cbsua-portal`, and click **add domain**. Leave the IP as it is; the server sets it.
3. At the top of the page, note your **token** (it looks like `a1b2c3d4-e5f6-…`). You type it into the AWS form in Step 3. Don't share it.

## Step 2: Download the template

Open this link and save the file (right-click → **Save Link As…**, or **File → Save Page As…**) as `lms-ec2.yaml`:

<https://raw.githubusercontent.com/cheesycookies29/cheese12/claude/compassionate-edison-kc7gd0/lms/deploy/aws/lms-ec2.yaml>

## Step 3: Create the server (CloudFormation)

1. Sign in to the AWS console. In the top-right corner, set the region to **Asia Pacific (Singapore) ap-southeast-1**.
2. Search for and open **CloudFormation**. Click **Create stack → With new resources (standard)**.
3. Choose **Upload a template file → Choose file**, pick `lms-ec2.yaml`, and click **Next**.
4. **Stack name:** `ltdc-lms`. Fill in:

   | Field | What to enter |
   |---|---|
   | **DuckDNS name** | The name from Step 1, without `.duckdns.org` (e.g. `cbsua-portal`) |
   | **DuckDNS token** | The token from Step 1 |
   | **Setup code** | A code you make up, at least 10 characters (letters, numbers, dots, dashes), e.g. `river-mango-2026`. **Write it down**: you need it in Step 5 |
   | **Server size** | `t3.small` (or `t3.micro` to try it out cheaply) |
   | **Disk size** | `30` |
   | Source code fields | Leave as they are |

5. Click **Next**. On the next page, leave everything as it is and click **Next**.
6. At the bottom of the review page, tick **I acknowledge that AWS CloudFormation might create IAM resources**, then click **Submit**.
7. Wait until the stack shows **CREATE_COMPLETE** (about 3–5 minutes; click the refresh button). Open the **Outputs** tab: it shows your **WebsiteUrl**, **AdminPanelUrl** and **PublicIp**.

## Step 4: Wait for the server to finish setting itself up

After the stack is complete, the server installs its software and ATLAS, and gets its HTTPS certificate. **This takes about 5–10 minutes.** Then open the **WebsiteUrl** (e.g. https://cbsua-portal.duckdns.org). You should see the University Portal with the note *Not set up yet*.

If it doesn't answer after 15 minutes, see [If something goes wrong](#if-something-goes-wrong).

## Step 5: Create the administrator

1. Open the **AdminPanelUrl** (e.g. https://cbsua-portal.duckdns.org/admin).
2. Enter the **setup code** from Step 3, the school's name, your name, a username and a password (at least 8 characters).
3. You're in the admin panel. From here:
   - **Settings & branding**: the school's colour (e.g. *Agriculture Green*) and logo;
   - **Terms, Courses, Sections, Students, Teachers**: your real data, or **Demo data & backup → Add demo data** to look around first (you can remove it later without touching your own records);
   - **Portal & systems**: HRIS, FMIS and UIS stay *Coming soon* until you switch them on.

Students and teachers sign in at the **WebsiteUrl**.

## Updates

New versions on the branch `claude/compassionate-edison-kc7gd0` are installed automatically within about 10 minutes, but only if all tests pass on the server. A copy of the data is taken before each update (`/opt/ltdc-lms/data/backups/db-before-update-…`).

To see which version is installed, open a console (below) and run `cat /opt/ltdc-lms/build.json`.

### Who can change what the server runs

The server installs whatever is on the branch it follows, once that version's tests pass. So **anyone who can push to that branch can change what your school's server runs.** Protect it on GitHub: **Settings → Branches → Add branch ruleset** (or *Add rule*) for the branch, with **Require a pull request before merging**, at least one approval, and **Block force pushes**. Keep the list of people with write access short.

The server limits the damage a bad version could do before it is installed: the tests run as the account `nobody`, with none of the server's settings, unable to read ATLAS's data, and without a network where the server allows it. Only a version that passes is installed, and it then runs as the app's own account, which can write only to the data folder.

The updater itself (`/usr/local/sbin/ltdc-lms-update`) is **not** replaced by updates, because it runs as root: a new updater is installed only when someone runs `upgrade-server.sh` on the server (next section).

## Bringing an older server up to date

A server set up before November 2026 needs this once. From a console on the server:

```bash
sudo bash /opt/ltdc-lms/deploy/aws/upgrade-server.sh
```

It installs **Node.js 22** (Ubuntu's Node 18 no longer gets security fixes; from then on it is kept current by the automatic security updates), replaces the updater and the service file with the current ones, closes the data folder to other accounts on the server, installs the Cloudflare helper (see [Cloudflare](#cloudflare)), and restarts ATLAS. Data is not touched. To check afterwards: `node --version` shows v22.

Then, in the AWS console, require **IMDSv2** on the server, so that a request tricked out of the app cannot read the server's AWS credentials: **EC2 → Instances → ltdc-lms → Actions → Instance settings → Modify instance metadata options → IMDSv2: Required**, and **Save**. (Servers created from the current template already have this.)

## Opening a console on the server (no SSH)

**CloudFormation → ltdc-lms → Outputs → ConsoleAccess**, or **EC2 → Instances → ltdc-lms → Connect → Session Manager → Connect**. Useful commands:

| What | Command |
|---|---|
| First-boot setup log | `sudo tail -n 60 /var/log/ltdc-lms-setup.log` |
| Is ATLAS running? | `systemctl status ltdc-lms` |
| ATLAS log | `sudo journalctl -u ltdc-lms -n 50` |
| HTTPS / certificate log | `sudo journalctl -u caddy -n 50` |
| Install the latest version now | `sudo ltdc-lms-update` |
| Turn automatic updates off / on | `sudo systemctl disable --now ltdc-lms-update.timer` / `sudo systemctl enable --now ltdc-lms-update.timer` |
| Point DuckDNS at the server now | `sudo ltdc-lms-duckdns` |
| Cloudflare set-up log | `sudo journalctl -u ltdc-lms-cloudflare -n 50` |
| Apply the Cloudflare set-up again now | `sudo ltdc-lms-cloudflare --force` |
| Reset a locked-out administrator | `sudo systemctl stop ltdc-lms`, then `cd /opt/ltdc-lms && sudo -u ltdc-lms node scripts/reset-password.js <username> <new-password>`, then `sudo systemctl start ltdc-lms` |

## Single sign-on with Keycloak

The simplest way needs no console: **Admin panel → System → Single sign-on → Set up for me** (see the README, *Single sign-on*). ATLAS creates its client in Keycloak and keeps the client secret in `/opt/ltdc-lms/data/oidc-client.secret`, readable by ATLAS only. Like the password key, it is not in the nightly copies or downloaded backups, but it is in the daily disk snapshots.

To do it by hand instead, put the Keycloak client's secret in the app's settings file, then restart. From a console on the server:

```bash
sudoedit /etc/ltdc-lms/app.env
```

Add a line `OIDC_CLIENT_SECRET=` followed by the secret from Keycloak (Clients → atlas → Credentials), save, then:

```bash
sudo systemctl restart ltdc-lms
```

Then finish in *Admin panel → System → Single sign-on*. The server needs to reach Keycloak over HTTPS; if Keycloak is only on the school's network, the server must be able to reach it there.

## Cloudflare

ATLAS can sit behind Cloudflare at the school's own address (for example **atlas.school.edu.ph**) instead of the DuckDNS address: **Set up Cloudflare for me** in the Admin panel. ATLAS makes the changes at Cloudflare (the DNS record, SSL/TLS **Full (strict)**) with the API token you give it, then asks the server to do its part. The token is used by ATLAS for those calls only: it never reaches the server's files (not `app.env`, not the data folder, not the backups), and the server's helper never sees it.

### What the server does

The server's part is done by a small root helper, `/usr/local/sbin/ltdc-lms-cloudflare`, started by `ltdc-lms-cloudflare.path` a few seconds after ATLAS writes its request (`/opt/ltdc-lms/data/cloudflare.json`). It:

1. **Checks the request.** Only a website name (lowercase letters, numbers, dots and dashes; not an IP address, not the DuckDNS address) is accepted. Anything else is refused and nothing changes.
2. **Gets Cloudflare's address list** from cloudflare.com, or, if the server cannot reach it, uses the copy that comes with ATLAS (`/usr/local/share/ltdc-lms/cloudflare-ips.txt`).
3. **Caddy** (`/etc/caddy/Caddyfile`): a site for the school's address. For connections from Cloudflare's addresses, the visitor's own address is taken from Cloudflare's `CF-Connecting-IP` header and passed to ATLAS, so sign-in limits apply to each visitor rather than to Cloudflare; from any other address the header is ignored, so it cannot be forged. The DuckDNS address forwards visitors to the school's address. Caddy checks the new settings first (`caddy validate`); if it refuses them, the old ones stay.
4. **ATLAS's settings** (`/etc/ltdc-lms/app.env`): `ALLOWED_HOSTS` gets the school's address and `PUBLIC_URL` is set to it; every other line stays as it is. ATLAS restarts only if they changed.
5. **Checks** that the school's address has its certificate (up to about 2 minutes) and that it answers through Cloudflare, then writes the answer the Admin panel shows (`/opt/ltdc-lms/data/cloudflare-status.json`).

The certificate still comes from Let's Encrypt and renews itself: Cloudflare passes the check on port 80 to the server, so Cloudflare's **Always Use HTTPS** stays off (Caddy itself sends HTTP visitors to HTTPS). Its log: `sudo journalctl -u ltdc-lms-cloudflare -n 50`.

**A server set up before the Cloudflare helper existed** needs it installed once, from a console (like the updater, it runs as root, so ordinary updates do not install it):

```bash
sudo bash /opt/ltdc-lms/deploy/aws/upgrade-server.sh
```

Until then, the Admin panel keeps showing that it is waiting for the server.

### Only accept visitors through Cloudflare

With this switched on, the server's firewall accepts web visitors (ports 80 and 443) **only from Cloudflare's addresses**, in a firewall table of its own (`inet ltdc_cloudflare`); nothing else on the server's firewall is changed, and the AWS console (Session Manager) is not affected. So the **DuckDNS address stops working**: it no longer opens ATLAS, not even as a forward, and it is taken out of Caddy's settings (its certificate could not renew). Everyone uses the school's address.

It is switched on only after the server has seen the school's address answer through Cloudflare. If it does not (for example the DNS record is not proxied yet), the server stays open to direct visitors and the Admin panel says why. The table is put back at every restart of the server (`ltdc-lms-cloudflare.service` runs at boot). Switching it off in the Admin panel removes the table at once.

### Undoing it by hand

If the Admin panel cannot be reached, from a console on the server:

```bash
# Accept visitors directly again (at once):
sudo nft delete table inet ltdc_cloudflare
# Back to the DuckDNS address only, as when Cloudflare is switched off in the Admin panel:
echo "{\"version\":1,\"hostname\":\"\",\"lockOrigin\":false,\"requestedAt\":\"$(date -u +%FT%TZ)\"}" | sudo -u ltdc-lms tee /opt/ltdc-lms/data/cloudflare.json
sudo journalctl -u ltdc-lms-cloudflare -n 20   # shows "Status: off."
```

Or do what set-up does, step by step: `sudo nft delete table inet ltdc_cloudflare`; `sudo /usr/local/sbin/ltdc-lms-cloudflare --print-plain-caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null` and `sudo systemctl reload caddy`; in `sudoedit /etc/ltdc-lms/app.env`, set `ALLOWED_HOSTS=` to the DuckDNS address only and delete the `PUBLIC_URL=` line; then `sudo systemctl restart ltdc-lms`. To stop the helper altogether: `sudo systemctl disable --now ltdc-lms-cloudflare.path ltdc-lms-cloudflare.service`.

At Cloudflare, the school's DNS record still points at the server; delete it there if the address should not be used any more.

## Backups and restoring

- **Every night at 2:15 AM** a copy of the data file goes to `/opt/ltdc-lms/data/backups/` (30 days kept), uploaded files are mirrored there at 2:20 AM, and the audit log (`audit-log.jsonl`, kept apart from the data) is copied at 2:25 AM. A server set up before this runs `sudo bash /opt/ltdc-lms/deploy/aws/upgrade-server.sh` once to get the audit-log copy.
- **Every day at 2:00 AM** AWS takes a snapshot of the whole disk (7 kept): **EC2 → Snapshots**. To go back to one, create a volume from it and swap it in, or ask for help.
- From the admin panel, **Demo data & backup → Download backup** saves the records (not uploaded files) to your computer.

### The password key

Passwords are stored only as one-way hashes, and those hashes are encrypted with a key kept outside the data: `/opt/ltdc-lms/data/password.key`, made by ATLAS the first time it starts. The nightly copies and downloaded backups do **not** contain it, so a copied backup cannot be used to guess passwords. The daily disk snapshots do contain it.

**Keep a copy of the key somewhere safe** (the school's password manager). Without it, a backup restored on another server has no working passwords. To see it, from a console:

```bash
sudo cat /opt/ltdc-lms/data/password.key
```

- **Moving to a new server:** copy `password.key` into the new server's `/opt/ltdc-lms/data/` with the data, or add the old key as `PASSWORD_KEY_OLD=<key>` in `/etc/ltdc-lms/app.env` before restoring.
- **Changing the key** (e.g. if it may have been seen): add `PASSWORD_KEY_OLD=<the current key>` and `PASSWORD_KEY=<a new key from openssl rand -hex 32>` to `/etc/ltdc-lms/app.env`, then `sudo systemctl restart ltdc-lms`. Every hash is re-encrypted two minutes after the start; nobody changes their password. After that, the old key can be removed.
- **Lost the key:** reset each password (the table above shows how, for an administrator).

## If something goes wrong

| What you see | What to do |
|---|---|
| Stack fails with *No default VPC* | **VPC → Your VPCs → Actions → Create default VPC**, then delete the failed stack and create it again |
| Stack fails for another reason | Open the stack's **Events** tab; the first red line says why. Delete the stack and try again |
| The address doesn't answer after 15 minutes | Open a console and read the setup log (`sudo tail -n 60 /var/log/ltdc-lms-setup.log`). Check that the DuckDNS page now shows the **PublicIp** from the Outputs; if not, the DuckDNS name or token is wrong: delete the stack and create it again with the right values (nothing is lost before Step 5) |
| Browser warns about the certificate | Wait a few minutes; Caddy retries. Check `sudo journalctl -u caddy -n 50` |
| *That setup code is not correct* | Use the code typed in Step 3. To see it: **EC2 → Instances → ltdc-lms → Actions → Instance settings → Edit user data** (read only, don't change it) |

## Removing it

**CloudFormation → ltdc-lms → Delete** removes the server, its disk, the fixed IP and the snapshot schedule. Existing snapshots stay (and cost a little) until you delete them under **EC2 → Snapshots**. Download a backup first.

## Good to know

- The DuckDNS token and the setup code are stored in the server's settings in your AWS account; only people with access to your AWS account can read them. The setup code only matters until the first administrator exists.
- The code comes from the public GitHub repository `cheesycookies29/cheese12`. If the repository is made private, automatic updates stop until a GitHub token is added on the server.
- The ERP has its own server and guide ([deploy/aws/EC2.md](../../../deploy/aws/EC2.md)); this one does not change it.
