# Putting LTDC ERP online with Amazon EC2

Use this guide instead of Part 1 of [LIGHTSAIL.md](LIGHTSAIL.md) if you want to run LTDC ERP on **Amazon EC2**, for example to use AWS credits. Only creating the server differs. Once it is running, you follow Parts 2–5 of the Lightsail guide, with the small differences listed at the end.

## Before you start: credits and your account plan

- **Check what your credits cover.** In the AWS console, go to **Billing and Cost Management → Credits**. Each credit shows its expiry date and **applicable products**.
  - If **Lightsail** is listed, consider using Lightsail instead. It is simpler, and at about US$7 a month all-in it uses your credits more slowly.
- **Upgrade to the paid plan if you're on the free plan.** Accounts opened since July 2025 choose either a *free* or a *paid* plan. A free-plan account is closed after 6 months, or once its credits run out, unless you upgrade. Upgrading keeps your remaining credits; they still pay the bill until they are used up or expire.
- **Set a budget alert.** Go to **Billing and Cost Management → Budgets → Create budget**, choose the **Monthly cost budget** template, set an amount (e.g. US$20) and enter your email. AWS then warns you before you are charged more than expected, including after the credits end.

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

## Part 1 (EC2): Create the server

1. Sign in to the AWS console. In the top-right corner, set the region to **Asia Pacific (Singapore) ap-southeast-1**.
2. Open **EC2** and click **Launch instance**.
   - **Name:** `ltdc-erp`.
   - **Application and OS image:** **Ubuntu**, then **Ubuntu Server 24.04 LTS**, 64-bit (x86).
   - **Instance type:** **t3.micro** (1 GB memory), which is plenty for an office. Choose **t3.small** (2 GB) if you have credits to spare and want extra headroom.
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

## Then: Parts 2–5 of the Lightsail guide

Continue with **Part 2** of [LIGHTSAIL.md](LIGHTSAIL.md), using your Elastic IP wherever it says "static IP". There are three differences.

**Step 11 (copying the app):** your key is `ltdc-erp.pem`.

```bash
chmod 400 ~/Downloads/ltdc-erp.pem
scp -i ~/Downloads/ltdc-erp.pem ~/Downloads/ltdc-erp.zip ubuntu@203.0.113.10:~
```

To bring your existing data, use the same key: `scp -i ~/Downloads/ltdc-erp.pem ~/path/to/ltdc-erp/data/db.json ubuntu@203.0.113.10:~`

**Step 12 (connecting to the server):** connect from your Mac's Terminal instead of a browser window.

```bash
ssh -i ~/Downloads/ltdc-erp.pem ubuntu@203.0.113.10
```

Then run steps 13–20 exactly as written.

**Firewall:** the security group from step 2 already allows HTTP and HTTPS. If you later connect from a different network and SSH stops working, go to **EC2 → Instances → ltdc-erp → Security → Security groups → Edit inbound rules** and set the SSH rule's source to **My IP** again.

Restoring backups, installing new versions, troubleshooting and the security notes are all the same as in the Lightsail guide.

## When the credits run out

The server keeps running and AWS starts charging your card at the rates above. Your budget alert emails you first. To stop all charges, you would need to:

1. download a final backup from **Settings → Download backup**;
2. **terminate** the instance;
3. **release** the Elastic IP;
4. delete the snapshots.

An Elastic IP that isn't released keeps costing money even when nothing is using it.
