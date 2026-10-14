# Putting LTDC ERP online with AWS Lightsail

This guide puts LTDC ERP on a small cloud server so staff can use it 24/7 from any browser at an address like **https://erp.lancastertechdev.com**.

Using Amazon EC2 instead (for example, to spend AWS credits)? Do Part 1 from [EC2.md](EC2.md), then continue here from Part 2.

It takes about an hour. You need:

- an AWS account (a payment card is required);
- access to the DNS settings of `lancastertechdev.com` (wherever the domain is managed), or a free DuckDNS address (see Part 2);
- your Mac, with `ltdc-erp.zip` (the app's source package) in your Downloads folder.

Throughout this guide, replace **`erp.lancastertechdev.com`** with the address you choose and **`203.0.113.10`** with your server's static IP address.

**Cost:** about **US$7 a month** for the server (1 GB plan), plus about US$1–2 a month for automatic snapshots. Check the current figures on the [Lightsail pricing page](https://aws.amazon.com/lightsail/pricing/).

## How it fits together

```
Staff browser ──HTTPS──▶ Caddy (port 443, automatic certificate) ──▶ LTDC ERP (port 3000, this server only)
                                                                         └── /opt/ltdc-erp/data/db.json
```

---

## Part 1: Create the server (AWS website)

1. Sign in at <https://lightsail.aws.amazon.com>.
2. Click **Create instance** and choose:
   - **Region:** Asia Pacific (Singapore), `ap-southeast-1`. This is the closest region to the Philippines.
   - **Platform:** Linux/Unix.
   - **Blueprint:** **OS Only**, then **Ubuntu 24.04 LTS**.
   - **SSH key pair:** leave the default. Click **Download** and save the `.pem` file. You need it in Part 3.
   - **Plan:** choose a **dual-stack** plan (one with a public IPv4 address), **1 GB memory** (about $7/month). Do **not** pick an IPv6-only plan, because many office networks cannot reach those.
   - **Name:** `ltdc-erp`.
3. Click **Create instance** and wait until its status is **Running**.

### Give it a fixed address

4. Go to the **Networking** tab on the Lightsail home page, then **Create static IP**.
5. Attach it to `ltdc-erp` and name it `ltdc-erp-ip`. Write the address down (e.g. `203.0.113.10`). A static IP is free while it is attached to a running server.

### Open the HTTPS port

6. Open the `ltdc-erp` instance, then the **Networking** tab. Under **IPv4 Firewall**:
   - keep **SSH (22)** and **HTTP (80)**; HTTP is needed for the certificate and to redirect to HTTPS;
   - click **Add rule** and choose **HTTPS (443)**.
   - Optional but recommended: edit the SSH rule, tick **Restrict to IP address**, enter your office's public IP, and keep **Allow Lightsail browser SSH** ticked.
7. Do the same under **IPv6 Firewall**: add **HTTPS (443)**.

### Turn on automatic snapshots

8. In the instance, open the **Snapshots** tab and turn on **Automatic snapshots**. Lightsail then keeps a copy of the whole server for each of the last 7 days.

---

## Part 2: Point your web address at the server (DNS)

9. Where `lancastertechdev.com` is managed (your registrar, Cloudflare, or a Lightsail DNS zone), add a record:

   | Type | Name | Value |
   |---|---|---|
   | A | `erp` | `203.0.113.10` (your static IP) |

   If you use Cloudflare, set the record to **DNS only** (grey cloud), at least for the first setup.

   **No access to the domain's DNS?** Ask whoever manages the lancastertechdev.com website to add the record above. It costs nothing and doesn't affect the website. Until then, use a free DuckDNS address:

   1. Go to <https://www.duckdns.org> and sign in with Google or GitHub.
   2. Under **sub domain**, enter a name (e.g. `ltdc-erp`) and click **add domain**.
   3. In the **current ip** box next to it, enter your static IP and click **update ip**. A static IP never changes, so nothing else is needed.
   4. Use `ltdc-erp.duckdns.org` wherever this guide says `erp.lancastertechdev.com`.

   To move to your own address later, add the DNS record above, then repeat steps 13, 18 and 19 with the new address.

10. On your Mac, wait until this prints your static IP. It usually takes a few minutes and can take up to an hour.

    ```bash
    dig +short erp.lancastertechdev.com
    ```

---

## Part 3: Copy the app to the server (your Mac)

11. Open **Terminal** on your Mac and run these two commands. Change the `.pem` file name if yours is different.

    ```bash
    chmod 400 ~/Downloads/LightsailDefaultKey-ap-southeast-1.pem
    scp -i ~/Downloads/LightsailDefaultKey-ap-southeast-1.pem ~/Downloads/ltdc-erp.zip ubuntu@203.0.113.10:~
    ```

    Type `yes` if it asks whether to trust the server.

**Optional: bring your existing data.** To move the data you already have on your Mac (employees, payroll, assets and accounts), also copy its data file. Stop the app on your Mac first.

```bash
scp -i ~/Downloads/LightsailDefaultKey-ap-southeast-1.pem ~/path/to/ltdc-erp/data/db.json ubuntu@203.0.113.10:~
```

---

## Part 4: Set up the server

12. In Lightsail, open the `ltdc-erp` instance and click **Connect using SSH**. A terminal opens in your browser. Run each block below, one at a time; paste with **Ctrl+Shift+V** or right-click.

13. **Set your address** for this session. The commands below use it.

    ```bash
    DOMAIN=erp.lancastertechdev.com
    ```

14. **Update the server and install Node.js 22.**

    ```bash
    sudo apt update && sudo apt -y upgrade
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs unzip rsync
    node -v
    ```

    The last line should print `v22.` followed by a version number.

15. **Install Caddy**, the web server that handles HTTPS. These commands come from caddyserver.com.

    ```bash
    sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo apt update && sudo apt install -y caddy
    ```

16. **Unpack the app** into `/opt/ltdc-erp`. It runs as its own limited user, `ltdc`.

    ```bash
    sudo useradd --system --home-dir /opt/ltdc-erp --shell /usr/sbin/nologin ltdc
    sudo unzip -q ~/ltdc-erp.zip -d /opt
    sudo mkdir -p /opt/ltdc-erp/data/backups
    sudo chown -R ltdc:ltdc /opt/ltdc-erp
    ```

17. **Create the Administrator account.** Do this *before* the site goes live, so no one else can claim the first-run page.

    **Starting fresh:** create the account and note the temporary password it prints.

    ```bash
    cd /opt/ltdc-erp && sudo -u ltdc node scripts/create-admin.js admin "Your Full Name"
    ```

    **Or, if you copied your Mac's data in step 11:** move it into place instead. Your existing accounts and passwords carry over.

    ```bash
    sudo mv ~/db.json /opt/ltdc-erp/data/db.json && sudo chown ltdc:ltdc /opt/ltdc-erp/data/db.json
    ```

18. **Start the app as a service.** It starts automatically at boot and restarts if it stops.

    ```bash
    sudo cp /opt/ltdc-erp/deploy/aws/ltdc-erp.service /etc/systemd/system/
    sudo sed -i "s/erp.example.com/$DOMAIN/" /etc/systemd/system/ltdc-erp.service
    sudo systemctl daemon-reload
    sudo systemctl enable ltdc-erp && sudo systemctl restart ltdc-erp
    systemctl status ltdc-erp --no-pager
    ```

    Look for **active (running)** in green. Press `q` if the output doesn't return to the prompt.

19. **Turn on HTTPS.** Caddy gets the certificate on its own within a few seconds.

    ```bash
    sudo cp /opt/ltdc-erp/deploy/aws/Caddyfile /etc/caddy/Caddyfile
    sudo sed -i "s/erp.example.com/$DOMAIN/" /etc/caddy/Caddyfile
    sudo systemctl reload caddy
    ```

20. **Turn on nightly data backups.** A copy of the data file is saved each night in `data/backups` and kept for 30 days.

    ```bash
    sudo cp /opt/ltdc-erp/deploy/aws/ltdc-erp-backup.cron /etc/cron.d/ltdc-erp-backup
    ```

---

## Part 5: Sign in

21. Open **https://erp.lancastertechdev.com**. You should see the padlock and the LTDC ERP sign-in page.
22. Sign in as `admin` with the temporary password from step 17, then choose a new password.
23. In **Settings**, check the company details. In **Users & Access**, create an account for each person. Share the address with staff.

Do **not** use **Load demo data** on the live server. It replaces all data.

---

## Day-to-day

**Backups.** There are three layers:

- Lightsail automatic snapshots of the whole server, kept 7 days;
- the nightly data copies in `/opt/ltdc-erp/data/backups`, kept 30 days;
- **Settings → Download backup** in the app. Do this regularly and keep the file off the server, for example on the company drive.

To restore one day's data, run this (replace the date):

```bash
sudo systemctl stop ltdc-erp
sudo cp /opt/ltdc-erp/data/backups/db-2026-10-14.json /opt/ltdc-erp/data/db.json
sudo chown ltdc:ltdc /opt/ltdc-erp/data/db.json
sudo systemctl start ltdc-erp
```

**Installing a new version of the app.**

1. Copy the new `ltdc-erp.zip` to the server, as in step 11.
2. Run the commands below. Your `data` folder is kept.

```bash
sudo systemctl stop ltdc-erp
cd /tmp && rm -rf ltdc-erp && unzip -q ~/ltdc-erp.zip
sudo rsync -a --delete --exclude data/ /tmp/ltdc-erp/ /opt/ltdc-erp/
sudo chown -R ltdc:ltdc /opt/ltdc-erp
sudo systemctl start ltdc-erp
```

**Locked out of the Administrator account.**

```bash
sudo systemctl stop ltdc-erp
cd /opt/ltdc-erp && sudo -u ltdc node scripts/reset-password.js admin 'NewTemporaryPass123'
sudo systemctl start ltdc-erp
```

**Server updates.** Ubuntu installs security updates automatically. About once a month, run `sudo apt update && sudo apt -y upgrade`. Reboot with `sudo reboot` if it says a restart is required; the app comes back on its own.

## Troubleshooting

| What you see | What to do |
|---|---|
| Browser says the site can't be reached | Check that `dig +short erp.lancastertechdev.com` shows your static IP, and that ports 80 and 443 are open in the Lightsail firewall (step 6). |
| Certificate or "not secure" warning | Wait one minute, then run `sudo journalctl -u caddy -n 50 --no-pager`. Usually DNS isn't pointing at the server yet, or Cloudflare's proxy (orange cloud) is on. |
| "Forbidden host" | The address in `/etc/systemd/system/ltdc-erp.service` (`ALLOWED_HOSTS`) doesn't match the one in the browser. Fix it, then run `sudo systemctl daemon-reload && sudo systemctl restart ltdc-erp`. |
| Signing in does nothing / you're signed out immediately | Open the site with `https://`, not `http://`. The login cookie is HTTPS-only. |
| "502 Bad Gateway" | The app isn't running. Check it with `sudo journalctl -u ltdc-erp -n 50 --no-pager`. |

## Security notes

- The app only listens on the server itself (`127.0.0.1:3000`). The internet reaches it only through Caddy over HTTPS.
- The app runs as the limited `ltdc` user and can write only to its `data` folder.
- Sessions use secure, HTTP-only cookies. Five wrong passwords lock that username for 5 minutes.
- The server holds employee personal and payroll data covered by the Data Privacy Act of 2012 (RA 10173). Give accounts only to the people who need them, use strong passwords, and restrict SSH to your office IP (step 6).
