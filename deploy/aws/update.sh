#!/usr/bin/env bash
# Install a new version of LTDC ERP from ltdc-erp.zip (or an unpacked folder).
# The data folder is kept, and a copy of the data file is saved first in data/backups.
# Usage (on the server): sudo bash /opt/ltdc-erp/deploy/aws/update.sh ~/ltdc-erp.zip
#                        sudo bash update.sh /path/to/unpacked/ltdc-erp [version]
set -euo pipefail

APP=/opt/ltdc-erp
SOURCE="${1:-}"
[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo bash $0 $SOURCE"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [ -d "$SOURCE" ]; then
  SRC="${SOURCE%/}"
  VERSION="${2:-unknown}"
elif [ -f "$SOURCE" ]; then
  unzip -q "$SOURCE" -d "$TMP"
  SRC="$TMP/ltdc-erp"
  VERSION="$(unzip -z "$SOURCE" | tail -n +2 | head -n 1)"
else
  echo "Usage: sudo bash $0 ~/ltdc-erp.zip  (file not found: ${SOURCE:-none given})"
  exit 1
fi
[ -f "$SRC/server.js" ] || { echo "$SOURCE is not an LTDC ERP package."; exit 1; }

STAMP="$(date +%F-%H%M)"
mkdir -p "$APP/data/backups"
[ -f "$APP/data/db.json" ] && cp "$APP/data/db.json" "$APP/data/backups/db-before-update-$STAMP.json"

systemctl stop ltdc-erp
rsync -a --delete --exclude /data/ "$SRC/" "$APP/"
printf '{"commit":"%s","installedAt":"%s","channel":"server"}\n' "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$APP/build.json"
chown -R ltdc:ltdc "$APP"
systemctl start ltdc-erp

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fs -o /dev/null http://127.0.0.1:3000/api/auth/status; then
    echo "LTDC ERP updated to version ${VERSION:0:7} and running."
    echo "Data backup taken before the update: $APP/data/backups/db-before-update-$STAMP.json"
    exit 0
  fi
  sleep 1
done
echo "The app did not start. Recent log:"
journalctl -u ltdc-erp -n 30 --no-pager
exit 1
