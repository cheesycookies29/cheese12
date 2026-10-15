#!/usr/bin/env bash
# Run on the server by the "Deploy to EC2" GitHub workflow (through AWS Systems
# Manager), from the new version's own files. Keeps the server settings in step
# with the guide, then installs the new version with update.sh.
# Usage: bash remote-deploy.sh /path/to/unpacked/new-version <commit>
set -euo pipefail

SRC="${1:?new version folder}"
VERSION="${2:-unknown}"
APP=/opt/ltdc-erp

if [ ! -f "$APP/server.js" ] || ! systemctl cat ltdc-erp >/dev/null 2>&1; then
  echo "LTDC ERP is not installed on this server yet. Do the first installation with the EC2 guide (Parts 1-5), then deploy again."
  exit 1
fi

# Philippine time for the time clock, attendance and report dates.
[ "$(timedatectl show -p Timezone --value 2>/dev/null)" = "Asia/Manila" ] || timedatectl set-timezone Asia/Manila
# Nightly data backup.
install -m 644 "$SRC/deploy/aws/ltdc-erp-backup.cron" /etc/cron.d/ltdc-erp-backup
command -v rsync >/dev/null || apt-get install -y -q rsync >/dev/null

bash "$SRC/deploy/aws/update.sh" "$SRC" "$VERSION"
