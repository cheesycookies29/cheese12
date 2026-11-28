#!/usr/bin/env bash
# Run on the server by the "Deploy to EC2" GitHub workflow (through AWS Systems
# Manager), from the new version's own files. Keeps the server settings in step
# with the guide, then installs the new version with update.sh.
# Usage: bash remote-deploy.sh /path/to/unpacked/new-version <commit>
set -euo pipefail

SRC="${1:?new version folder}"
VERSION="${2:-unknown}"
APP="${LTDC_APP:-/opt/ltdc-erp}" # LTDC_APP: tests only

# Deploy freeze (0.71, for events such as YEP 2026): while $APP/data/DEPLOY_FREEZE exists and its
# end time has not passed, nothing is installed or restarted. The file holds the end time (ISO 8601,
# first line) and the reason (second line); an operator writes it with
# `sudo ltdc-erp-event freeze 2026-12-10T09:00:00+08:00 "YEP 2026"` (0.74.3, deploy/aws/EVENT-DAY.md).
# To deploy during a freeze anyway, an operator removes it first (sudo ltdc-erp-event unfreeze).
# This runs before anything else, so a frozen deploy changes nothing on the server.
FREEZE="$APP/data/DEPLOY_FREEZE"
if [ -f "$FREEZE" ]; then
  UNTIL="$(head -n 1 "$FREEZE" | tr -d '[:space:]')"
  REASON="$(sed -n 2p "$FREEZE" | tr -cd '[:print:]' | cut -c1-120)"
  if [ -z "$UNTIL" ] || [ "$(date -u +%s)" -lt "$(date -u -d "$UNTIL" +%s 2>/dev/null || echo 9999999999)" ]; then
    echo "Deploys are frozen until ${UNTIL:-further notice} (${REASON:-no reason given}). Nothing was changed."
    echo "To deploy anyway, an operator removes $FREEZE on the server, then deploys again."
    exit 3
  fi
  echo "The deploy freeze ended at $UNTIL; continuing."
fi

if [ ! -f "$APP/server.js" ] || ! systemctl cat ltdc-erp >/dev/null 2>&1; then
  echo "LTDC ERP is not installed on this server yet. Do the first installation with the EC2 guide (Parts 1-5), then deploy again."
  exit 1
fi

# Philippine time for the time clock, attendance and report dates.
[ "$(timedatectl show -p Timezone --value 2>/dev/null)" = "Asia/Manila" ] || timedatectl set-timezone Asia/Manila
# Nightly data backup.
install -m 644 "$SRC/deploy/aws/ltdc-erp-backup.cron" /etc/cron.d/ltdc-erp-backup
command -v rsync >/dev/null || apt-get install -y -q rsync >/dev/null
# Hourly off-server backup and nightly restore check as sandboxed timers (0.39), and the app's own
# hardening (no instance metadata; behind the proxy).
for unit in ltdc-erp-offsite.service ltdc-erp-offsite.timer ltdc-erp-restore-check.service ltdc-erp-restore-check.timer; do
  install -m 644 "$SRC/deploy/aws/$unit" "/etc/systemd/system/$unit"
done
install -d -m 755 /etc/systemd/system/ltdc-erp.service.d
install -m 644 "$SRC/deploy/aws/ltdc-erp-hardening.conf" /etc/systemd/system/ltdc-erp.service.d/hardening.conf
systemctl daemon-reload
systemctl enable --now ltdc-erp-offsite.timer ltdc-erp-restore-check.timer >/dev/null

# One command back to the release before this one (0.71): sudo ltdc-erp-rollback.
install -m 755 "$SRC/deploy/aws/ltdc-erp-rollback" /usr/local/sbin/ltdc-erp-rollback
# Event-day switches (0.74.3): sudo ltdc-erp-event status | backups-every-15 | backups-hourly | freeze |
# unfreeze | close-out (deploy/aws/EVENT-DAY.md). Only installed here, never run by a deploy; it must be
# on the server before a freeze, as a frozen server takes no deploys.
install -m 755 "$SRC/deploy/aws/ltdc-erp-event" /usr/local/sbin/ltdc-erp-event

# The web addresses (0.73.1): Caddy's sites and the app's ALLOWED_HOSTS, from deploy/aws/site-address.
# Before update.sh, so the app's restart picks up a new address. A problem here never stops the deploy:
# the tool changes nothing it cannot check, and says why.
install -m 755 "$SRC/deploy/aws/ltdc-erp-address.cjs" /usr/local/sbin/ltdc-erp-address
node "$SRC/deploy/aws/ltdc-erp-address.cjs" --deploy "$SRC/deploy/aws/site-address" \
  || echo "The web address step did not finish (see above); the address settings were left as they were."

bash "$SRC/deploy/aws/update.sh" "$SRC" "$VERSION"
