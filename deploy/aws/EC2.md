# Putting LTDC ERP online with Amazon EC2

This guide puts LTDC ERP on an Amazon EC2 server so staff can use it 24/7 from any browser at an address like **https://erp.lancastertechdev.com**.

It takes about an hour. You need:

- an AWS account (AWS credits can pay for it);
- a web address, either a record you can add for `lancastertechdev.com` or a free DuckDNS address (see Part 2);
- your Mac, with `ltdc-erp.zip` (the app's source package) in your Downloads folder.

Throughout this guide, replace **`erp.lancastertechdev.com`** with your address and **`203.0.113.10`** with your server's Elastic IP address.

## How it fits together

```
Staff browser ──HTTPS──▶ Caddy (port 443, automatic certificate) ──▶ LTDC ERP (port 3000, this server only)
                                                                         └── /opt/ltdc-erp/data/db.json
```

## Before you start: credits, account plan and cost

- **Check your credits.** In the AWS console, go to **Billing and Cost Management → Credits**. Each credit shows its expiry date and **applicable products**; EC2 should be listed.
- **Upgrade to the paid plan if you're on the free plan.** Accounts opened since July 2025 choose either a *free* or a *paid* plan. A free-plan account is closed after 6 months, or once its credits run out, unless you upgrade. Upgrading keeps your remaining credits; they still pay the bill until they are used up or expire.
- **Set a budget alert.** Go to **Billing and Cost Management → Budgets → Create budget**, choose the **Monthly cost budget** template, set an amount (e.g. US$20) and enter your email. AWS warns you before you are charged more than expected, including after the credits end.

**Expected cost** (Singapore region, paid from credits until they run out):

| Item | Approx. per month |
|---|---|
| t3.micro server (2 vCPU, 1 GB memory) | US$9.60 |
| Public IPv4 address (AWS charges for every public IPv4 address) | US$3.65 |
| 20 GB disk (gp3) | US$2 |
| Daily snapshots, 7 kept | about US$1 |
| **Total** | **about US$16** |

Check current prices with the [AWS Pricing Calculator](https://calculator.aws/).

---

## Part 1: Create the server (AWS console)

1. Sign in to the AWS console. In the top-right corner, set the region to **Asia Pacific (Singapore) ap-southeast-1**. This is the closest region to the Philippines.
2. Open **EC2** and click **Launch instance**.
   - **Name:** `ltdc-erp`.
   - **Application and OS image:** **Ubuntu**, then **Ubuntu Server 24.04 LTS**, 64-bit (x86).
   - **Instance type:** **t3.micro** (1 GB memory), which is plenty for an office. Choose **t3.small** (2 GB) if you want extra headroom.
   - **Key pair:** **Create new key pair**, name it `ltdc-erp`, type **RSA**, format **.pem**. The file downloads to your Mac. Keep it safe, because it is the key to the server.
   - **Network settings:** keep **Create security group** selected and set:
     - **Allow SSH traffic from:** **My IP**;
     - tick **Allow HTTPS traffic from the internet**;
     - tick **Allow HTTP traffic from the internet**, which is needed for the certificate and to redirect to HTTPS.
   - **Configure storage:** **20 GiB**, **gp3**. Click **Advanced**, open the volume, and set **Encrypted** to **Yes**. That protects the payroll data at rest.
3. Click **Launch instance**, then **View all instances**. Wait until **Instance state** is **Running**.

### Give it a fixed address (Elastic IP)

4. In the EC2 menu, go to **Network & Security → Elastic IPs → Allocate Elastic IP address → Allocate**.
5. Select the new address, then **Actions → Associate Elastic IP address**, choose the `ltdc-erp` instance, and click **Associate**.
6. Write the address down (e.g. `203.0.113.10`). It stays the same even if you stop and start the server.

### Turn on daily snapshots

7. In the EC2 menu, go to **Elastic Block Store → Lifecycle Manager → Create lifecycle policy**.
8. Choose **EBS snapshot policy** and set:
   - **Target resource types:** **Instance**;
   - **Target resource tags:** `Name` = `ltdc-erp`;
   - schedule **Daily**, keep **7** snapshots.

   Leave the IAM role as **Default role**. Click **Create default policy**.

---

## Part 2: Point your web address at the server (DNS)

9. Where `lancastertechdev.com` is managed (your registrar, Cloudflare or Route 53), add a record:

   | Type | Name | Value |
   |---|---|---|
   | A | `erp` | `203.0.113.10` (your Elastic IP) |

   If you use Cloudflare, set the record to **DNS only** (grey cloud), at least for the first setup.

   **No access to the domain's DNS?** Ask whoever manages the lancastertechdev.com website to add the record above. It costs nothing and doesn't affect the website. Until then, use a free DuckDNS address:

   1. Go to <https://www.duckdns.org> and sign in with Google or GitHub.
   2. Under **sub domain**, enter a name (e.g. `ltdc-erp`) and click **add domain**.
   3. In the **current ip** box next to it, enter your Elastic IP and click **update ip**. An Elastic IP never changes, so nothing else is needed.
   4. Use `ltdc-erp.duckdns.org` wherever this guide says `erp.lancastertechdev.com`.

   To move to your own address later, add the DNS record above, then repeat steps 14, 19 and 20 with the new address.

10. On your Mac, wait until this prints your Elastic IP. It usually takes a few minutes and can take up to an hour.

    ```bash
    dig +short erp.lancastertechdev.com
    ```

---

## Part 3: Copy the app to the server (your Mac)

11. Open **Terminal** on your Mac and run these two commands. Change the path if the `.pem` file is somewhere other than Downloads.

    ```bash
    chmod 400 ~/Downloads/ltdc-erp.pem
    scp -i ~/Downloads/ltdc-erp.pem ~/Downloads/ltdc-erp.zip ubuntu@203.0.113.10:~
    ```

    Type `yes` if it asks whether to trust the server.

    **Optional: bring your existing data.** To move the data you already have on your Mac (employees, payroll, assets and accounts), also copy its data file. Stop the app on your Mac first.

    ```bash
    scp -i ~/Downloads/ltdc-erp.pem ~/path/to/ltdc-erp/data/db.json ubuntu@203.0.113.10:~
    ```

---

## Part 4: Set up the server

12. **Connect to the server** from your Mac's Terminal:

    ```bash
    ssh -i ~/Downloads/ltdc-erp.pem ubuntu@203.0.113.10
    ```

    The prompt changes to `ubuntu@ip-…`. Run each block below there, one at a time.

13. **Set the server to Philippine time and install Node.js 22.** The time zone matters: the time clock, attendance and report dates use the server's clock, which starts on UTC (8 hours behind).

    ```bash
    sudo timedatectl set-timezone Asia/Manila
    sudo apt update && sudo apt -y upgrade
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs unzip rsync
    node -v
    ```

    The last line should print `v22.` followed by a version number.

14. **Set your address** for this session. The commands below use it. If you reconnect later, run this line again.

    ```bash
    DOMAIN=erp.lancastertechdev.com
    ```

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

18. **Turn on nightly data backups.** A copy of the data file is saved each night in `data/backups` and kept for 30 days.

    ```bash
    sudo cp /opt/ltdc-erp/deploy/aws/ltdc-erp-backup.cron /etc/cron.d/ltdc-erp-backup
    ```

19. **Start the app as a service.** It starts automatically at boot and restarts if it stops.

    ```bash
    sudo cp /opt/ltdc-erp/deploy/aws/ltdc-erp.service /etc/systemd/system/
    sudo sed -i "s/erp.example.com/$DOMAIN/" /etc/systemd/system/ltdc-erp.service
    sudo systemctl daemon-reload
    sudo systemctl enable ltdc-erp && sudo systemctl restart ltdc-erp
    systemctl status ltdc-erp --no-pager
    ```

    Look for **active (running)** in green.

20. **Turn on HTTPS.** Caddy gets the certificate on its own within a few seconds.

    ```bash
    sudo cp /opt/ltdc-erp/deploy/aws/Caddyfile /etc/caddy/Caddyfile
    sudo sed -i "s/erp.example.com/$DOMAIN/" /etc/caddy/Caddyfile
    sudo systemctl reload caddy
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

- EC2 snapshots of the whole disk, kept 7 days (step 8);
- the nightly data copies in `/opt/ltdc-erp/data/backups`, kept 30 days;
- **Settings → Download backup** in the app. Do this regularly and keep the file off the server, for example on the company drive.

To restore one day's data, connect as in step 12 and run this (replace the date):

```bash
sudo systemctl stop ltdc-erp
sudo cp /opt/ltdc-erp/data/backups/db-2026-10-14.json /opt/ltdc-erp/data/db.json
sudo chown ltdc:ltdc /opt/ltdc-erp/data/db.json
sudo systemctl start ltdc-erp
```

**Installing a new version by hand.** Only needed if automatic deployment (below) is not set up. Your data is kept, and a copy of it is saved first.

1. On your Mac, put the new `ltdc-erp.zip` in Downloads and upload it, as in step 11:

   ```bash
   scp -i ~/Downloads/ltdc-erp.pem ~/Downloads/ltdc-erp.zip ubuntu@203.0.113.10:~
   ```

2. Connect as in step 12 and run:

   ```bash
   sudo bash /opt/ltdc-erp/deploy/aws/update.sh ~/ltdc-erp.zip
   ```

   It ends with "LTDC ERP updated to version … and running". If something goes wrong, it shows the error log instead. Your data stays as it was, and the copy saved before the update is in `/opt/ltdc-erp/data/backups`.

3. Refresh the browser. Staff may need to sign in again.

**Servers set up before October 15, 2026, without automatic deployment:** run this once so times and dates are in Philippine time and the nightly backup runs at 2:15 AM:

```bash
sudo timedatectl set-timezone Asia/Manila
sudo cp /opt/ltdc-erp/deploy/aws/ltdc-erp-backup.cron /etc/cron.d/ltdc-erp-backup
sudo systemctl restart ltdc-erp
```

If the server says `update.sh` is not found, the version installed there is older than the update script. Run these commands once instead; after that, step 2 works:

```bash
sudo systemctl stop ltdc-erp
cd /tmp && rm -rf ltdc-erp && unzip -q ~/ltdc-erp.zip
sudo rsync -a --delete --exclude /data/ /tmp/ltdc-erp/ /opt/ltdc-erp/
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

**Connecting from a different network.** SSH only accepts your IP from step 2. If `ssh` times out after you change networks, go to **EC2 → Instances → ltdc-erp → Security → Security groups → Edit inbound rules** and set the SSH rule's source to **My IP** again. Staff using the website are not affected.

## Automatic deployment from GitHub (no terminal)

Set this up once, after the first installation (Parts 1–5). From then on, every new version pushed to the GitHub repository is installed on the server automatically. It all happens in your browser, in the AWS console and on GitHub.

**How it works.** GitHub runs the app's automated tests on each new version. If they pass, it asks AWS Systems Manager to run the install command on your server. The server downloads that exact version, saves a backup of the data, installs it and checks that it starts. If the tests fail, nothing is sent to the server. No SSH keys or AWS passwords are stored anywhere. GitHub gets a short-lived permission that can only send commands to this one server.

### A. AWS: create the permissions (CloudFormation)

1. In the EC2 console, open **Instances**, select `ltdc-erp` and copy its **Instance ID** (it starts with `i-`).
2. Have the file `github-deploy.yaml` on your Mac. It's in the `deploy/aws` folder of `ltdc-erp.zip`, or download it from the repository on GitHub.
3. Open **CloudFormation**, with the region still **Asia Pacific (Singapore)**. Click **Create stack → With new resources (standard)**.
4. Choose **Upload a template file**, select `github-deploy.yaml` and click **Next**.
5. Fill in the stack details:
   - **Stack name:** `ltdc-erp-deploy`;
   - **InstanceId:** pick your server from the list;
   - leave the other two fields as they are.

   Click **Next**, then **Next** again.
6. At the bottom, tick **"I acknowledge that AWS CloudFormation might create IAM resources with custom names"** and click **Submit**.
7. Wait about a minute until the status is **CREATE_COMPLETE**. Then open the **Outputs** tab and keep it open; you need these values in part B.
8. Back in **EC2 → Instances**, select `ltdc-erp`. Choose **Actions → Security → Modify IAM role**, pick **ltdc-erp-server** and click **Update IAM role**.
9. Open **Systems Manager → Fleet Manager**. Within about 10 minutes your server appears with **Ping status: Online**. If it doesn't after 15 minutes, restart the server once: **EC2 → Instances → Instance state → Reboot instance**. The website is down for about a minute.

### B. GitHub: tell the workflow where to deploy

1. Open the repository on GitHub. Go to **Settings → Secrets and variables → Actions**, then the **Variables** tab.
2. Click **New repository variable** three times, copying the values from the CloudFormation **Outputs** tab. The **Secrets** tab works too, but don't use **Environments**:

   | Name | Value |
   |---|---|
   | `AWS_ROLE_ARN` | the **AwsRoleArn** output (starts with `arn:aws:iam::`) |
   | `EC2_INSTANCE_ID` | the **Ec2InstanceId** output (starts with `i-`) |
   | `AWS_REGION` | `ap-southeast-1` |

### C. Try it

1. On GitHub, open the **Actions** tab, then **Deploy to EC2** on the left.
2. Click **Run workflow**, keep the branch shown, and click the green **Run workflow** button.
3. After about two minutes the run shows a green tick, and its summary reads **"Deployed … to the LTDC ERP server"**. Refresh the website.

**From then on:**
- **New versions deploy by themselves** within a few minutes of being pushed to GitHub.
- **History:** the **Actions** tab shows every deployment. A red cross means it didn't install. Click the run and the **deploy** step to see why. The server keeps running the previous version.
- **Deploy again or roll back:** open an earlier run and click **Re-run all jobs** to reinstall that version.
- **Pause deployments:** **Actions → Deploy to EC2 → ⋯ → Disable workflow**.
- **Settings it keeps for you:** each deployment also makes sure the server is on Philippine time and that the nightly backup is installed.

## Troubleshooting

| What you see | What to do |
|---|---|
| Browser says the site can't be reached | Check that `dig +short erp.lancastertechdev.com` shows your Elastic IP, and that the security group allows HTTP (80) and HTTPS (443) from anywhere. |
| Certificate or "not secure" warning | Wait one minute, then run `sudo journalctl -u caddy -n 50 --no-pager`. Usually DNS isn't pointing at the server yet, or Cloudflare's proxy (orange cloud) is on. |
| "Forbidden host" | The address in `/etc/systemd/system/ltdc-erp.service` (`ALLOWED_HOSTS`) doesn't match the one in the browser. Fix it, then run `sudo systemctl daemon-reload && sudo systemctl restart ltdc-erp`. |
| Signing in does nothing / you're signed out immediately | Open the site with `https://`, not `http://`. The login cookie is HTTPS-only. |
| "502 Bad Gateway" | The app isn't running. Check it with `sudo journalctl -u ltdc-erp -n 50 --no-pager`. |
| `ssh` times out | Your IP changed. See "Connecting from a different network" above. |
| Deployment fails with "not managed" or "InvalidInstanceId" | The server isn't connected to Systems Manager yet. Check part A, steps 8–9 of "Automatic deployment from GitHub". |
| Deployment fails with "not installed on this server yet" | Finish the first installation (Parts 1–5), then click **Re-run all jobs**. |
| Run is green but the summary says "nothing was deployed" | GitHub can't see the setting(s) named in the message. Check part B: repository level, exact names, no Environment. |
| "AWS_ROLE_ARN should look like…" or "EC2_INSTANCE_ID should look like…" | A value was pasted incompletely. Copy it again from the CloudFormation **Outputs** tab. |

## When the credits run out

The server keeps running and AWS starts charging your card at the rates above. Your budget alert emails you first. To stop all charges, you would need to:

1. download a final backup from **Settings → Download backup**;
2. **terminate** the instance;
3. **release** the Elastic IP;
4. delete the snapshots and the Lifecycle Manager policy;
5. delete the `ltdc-erp-deploy` CloudFormation stack.

An Elastic IP that isn't released keeps costing money even when nothing is using it.

## Security notes

- The app only listens on the server itself (`127.0.0.1:3000`). The internet reaches it only through Caddy over HTTPS.
- The app runs as the limited `ltdc` user and can write only to its `data` folder. The disk is encrypted.
- Sessions use secure, HTTP-only cookies. Five wrong passwords lock that username for 5 minutes.
- SSH is open only to your IP, and only with the `ltdc-erp.pem` key. Don't share the key, and keep a copy somewhere safe.
- The server holds employee personal and payroll data covered by the Data Privacy Act of 2012 (RA 10173). Give accounts only to the people who need them and use strong passwords.
