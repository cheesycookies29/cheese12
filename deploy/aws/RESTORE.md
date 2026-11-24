# Restoring LTDC ERP from a backup

What to do when data was lost, damaged or changed by mistake, or the server itself is gone. Keep
this page where you can reach it without the server (it is also in the repository on GitHub).

## The copies you have

| Copy | Where | How often | Kept |
|---|---|---|---|
| Off-server copy (0.38) | S3 bucket `ltdc-erp-backups-<account id>`, folder `hourly/<day>/<hour>/` | Every hour, at 5 past | 30 days; never overwritten |
| Attached files | the same bucket, folder `attachments/` | Every hour, new files only | Until removed by hand (a file deleted in CORE is no longer listed with later hours, so it does not come back on a restore; remove it from the bucket in the S3 console when it must be erased) |
| Documents (0.67) | the same bucket, folder `documents/` | Every hour, new files only | As attached files. They are encrypted with keys made from the server key: without `secret.key` they cannot be read, even from the bucket |
| Nightly copy | `/opt/ltdc-erp/data/backups/db-<date>.json` on the server | 2:15 AM | 30 days |
| Before each update | `/opt/ltdc-erp/data/backups/db-before-update-<date>-<time>.json` | Every deployment | 30 days |
| Disk snapshot | EC2 → Snapshots (Data Lifecycle Manager) | Daily | 7 |
| Downloaded backup | wherever an administrator saved it (Admin panel → Backup & restore) | By hand | As kept |

**Admin panel → Security monitor → Software status** shows the last off-server copy and the last
restore check. The **restore check** runs every night at 3:40 AM: it takes the latest off-server
copy, restores it into a throw-away folder on the server, starts CORE on it and checks that it
opens, has an administrator and that its audit log passes its check. If it says **Problem**, read
the reason there and fix it before you need the copy.

Each hour's folder has a `manifest.json` listing every file with its size and fingerprint, sealed
with a key made from the server key (0.39). A restore checks the seal and every file, so a copy
changed in the bucket is refused. Uploads can never replace a file already there, so whoever takes
over the server cannot rewrite the history either.

**The server key is not in any backup.** `/opt/ltdc-erp/data/secret.key` seals the 2-step
verification secrets, the audit log's chain and the backup manifests, and (0.67) encrypts every stored
document: **without it, no document can ever be opened again.** It never changes, so keep one
copy of it in the company's password manager now. Show it over SSH (not in a Session Manager window,
whose session logging may record it), copy it into the password manager, then clear the screen:

```bash
sudo cat /opt/ltdc-erp/data/secret.key; echo
clear
```

Without it, a restored CORE works, but the off-server copies cannot be checked or fetched (restore
a nightly copy or a snapshot instead), everyone with 2-step verification must have it reset by an
administrator, and the audit log check says the key is missing.

## 1. Undo a mistake: go back to an earlier hour (server still running)

Everything after the hour you go back to is lost, so pick the latest hour before the mistake and
tell people what will be redone.

1. In the AWS console, open **S3 → `ltdc-erp-backups-…` → hourly → the day**, and note the hour
   folder to go back to, for example `hourly/2026-11-18/09`.
2. Connect to the server (EC2.md, step 12, or **Systems Manager → Session Manager → Start session**)
   and fetch that hour into a folder:

   ```bash
   R="$(sudo -u ltdc mktemp -d /opt/ltdc-erp/data/restore-XXXXXX)"
   cd /opt/ltdc-erp && sudo -u ltdc node scripts/offsite-fetch.js hourly/2026-11-18/09 "$R"
   ```

   It checks the hour's seal and every file; if it says a file "is not the file that was sent", stop
   and use the hour before, a nightly copy or a snapshot.

3. Put it in place (a copy of the current data is kept first):

   ```bash
   sudo systemctl stop ltdc-erp
   sudo cp /opt/ltdc-erp/data/db.json /opt/ltdc-erp/data/backups/db-before-restore-$(date +%F-%H%M).json
   sudo cp "$R/db.json" /opt/ltdc-erp/data/db.json
   sudo cp -n "$R"/attachments/* /opt/ltdc-erp/data/attachments/ 2>/dev/null || true
   [ -d "$R/documents" ] && sudo cp -rn "$R"/documents/. /opt/ltdc-erp/data/documents/
   sudo chown -R ltdc:ltdc /opt/ltdc-erp/data && sudo systemctl start ltdc-erp
   sudo rm -rf "$R"
   ```

   Keep the current audit log: it records what happened, including the restore. Only replace it
   (with `$R/audit-log.jsonl` and `audit-head.json`) if the log itself was damaged.

4. Sign in, check the records you expected, and say in **Send feedback** or by email what changed.

A nightly copy works the same way: use `/opt/ltdc-erp/data/backups/db-<date>.json` in step 3.

## 2. The server is gone: a new server from the off-server copy

1. Make a new server and install CORE with **EC2.md, Parts 1–5** (keep the same web address, or
   point it at the new Elastic IP). Do not create the first administrator yet.
2. Attach the **ltdc-erp-server** IAM role to it (**EC2 → Actions → Security → Modify IAM role**),
   and update the CloudFormation stack's **InstanceId** to the new server.
3. Put the server key back first, from the password manager. Type the first line, paste the key,
   press Enter, then Ctrl-D (the key never appears in a command, the shell history or the logs):

   ```bash
   sudo -u ltdc sh -c 'umask 077; cat > /opt/ltdc-erp/data/secret.key'
   ```

4. Fetch the latest hour (S3 shows the newest folder) and put it all in place:

   ```bash
   R="$(sudo -u ltdc mktemp -d /opt/ltdc-erp/data/restore-XXXXXX)"
   cd /opt/ltdc-erp && sudo -u ltdc node scripts/offsite-fetch.js hourly/2026-11-18/09 "$R"
   sudo systemctl stop ltdc-erp
   sudo cp "$R/db.json" "$R/audit-log.jsonl" "$R/audit-head.json" /opt/ltdc-erp/data/
   sudo mkdir -p /opt/ltdc-erp/data/attachments && sudo cp "$R"/attachments/* /opt/ltdc-erp/data/attachments/ 2>/dev/null || true
   [ -d "$R/documents" ] && sudo mkdir -p /opt/ltdc-erp/data/documents && sudo cp -r "$R"/documents/. /opt/ltdc-erp/data/documents/
   sudo chown -R ltdc:ltdc /opt/ltdc-erp/data && sudo systemctl start ltdc-erp
   sudo rm -rf "$R"
   ```

5. Sign in with an administrator account from the backup. **Admin panel → Security monitor**
   should show the audit log check as **Intact**; the next hourly copy and restore check run by
   themselves.

If the S3 copy cannot be used, restore the latest EC2 snapshot instead (**EC2 → Snapshots →
Actions → Create volume**, attach it to the new server) and copy `/opt/ltdc-erp/data` from it.

## 3. Practise it

Twice a year, do section 2 on a test server (a t3.micro for an hour costs a few cents) and time it.
The nightly restore check proves the copies open; the practice proves the people know the steps.
