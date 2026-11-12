#!/usr/bin/env bash
# Brings a Lancaster ATLAS server that was set up earlier in line with the current set-up, without
# touching its data. Run it once from a console on the server after an update that mentions it:
#
#   sudo bash /opt/ltdc-lms/deploy/aws/upgrade-server.sh
#
# What it does (each step is safe to repeat):
#   1. Node.js 22 LTS from NodeSource (Ubuntu's Node 18 no longer gets security fixes).
#   2. The updater (/usr/local/sbin/ltdc-lms-update), the service file and the nightly backups are
#      replaced with the current ones. The updater is deliberately not replaced by ordinary updates: it runs as
#      root, so a new one is installed only when someone runs this script.
#   3. The data folder is closed to other accounts on the server.
#   4. The Cloudflare helper (/usr/local/sbin/ltdc-lms-cloudflare, for "Set up Cloudflare for me" in
#      the Admin panel), its list of Cloudflare's addresses, its systemd units and nftables. Root
#      code too, so it is installed only here. If Cloudflare is already set up, it is applied again
#      at the end (nothing is switched off).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/ltdc-lms

echo "-- 1. Node.js"
bash "$HERE/install-node.sh"

echo "-- 2. Updater and service"
install -m 750 "$HERE/update.sh" /usr/local/sbin/ltdc-lms-update
install -m 644 "$HERE/ltdc-lms.service" /etc/systemd/system/ltdc-lms.service
install -m 644 "$HERE/ltdc-lms-update.service" /etc/systemd/system/ltdc-lms-update.service
install -m 644 "$HERE/ltdc-lms-update.timer" /etc/systemd/system/ltdc-lms-update.timer
install -m 644 "$HERE/ltdc-lms-backup.cron" /etc/cron.d/ltdc-lms-backup
systemctl daemon-reload

echo "-- 3. Data folder"
chown -R ltdc-lms:ltdc-lms "$APP/data"
chmod 750 "$APP/data"
[ -f "$APP/data/password.key" ] && chmod 600 "$APP/data/password.key"

echo "-- 4. Cloudflare helper"
bash "$HERE/install-cloudflare.sh"

echo "-- Restarting ATLAS on the new Node.js"
systemctl restart ltdc-lms
UP=no
for _ in $(seq 1 20); do
  if curl -fs -o /dev/null http://127.0.0.1:3100/healthz; then UP=yes; break; fi
  sleep 1
done
if [ "$UP" != yes ]; then
  echo "ATLAS did not answer after the restart. Recent log:"
  journalctl -u ltdc-lms -n 30 --no-pager || true
  exit 1
fi
echo "Lancaster ATLAS is running on Node.js $(node --version)."
if [ -f "$APP/data/cloudflare.json" ]; then
  echo "-- Cloudflare is set up in the Admin panel: applying it again with the new helper"
  /usr/local/sbin/ltdc-lms-cloudflare --force || echo "The Cloudflare set-up needs attention: see Admin panel → Cloudflare, or journalctl -u ltdc-lms-cloudflare."
fi
echo "One step is left, in the AWS console: require IMDSv2 on the instance (see deploy/aws/EC2.md, \"Bringing an older server up to date\")."
