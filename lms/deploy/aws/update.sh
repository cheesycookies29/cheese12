#!/usr/bin/env bash
# Install the latest version of Lancaster ATLAS from GitHub, if there is a new one.
# Installed on the server as /usr/local/sbin/ltdc-lms-update; run every 10 minutes by
# ltdc-lms-update.timer when automatic updates are on.
#
# A new version is installed only if its tests pass on this server. The data folder
# is never touched (a copy of the data file is taken first), and if the new version
# does not start, the previous one is put back.
#
# Usage: sudo ltdc-lms-update [--force]   (--force installs even if the version is unchanged)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root: sudo $0"; exit 1; }
# shellcheck source=/dev/null
. /etc/ltdc-lms/server.env
APP=/opt/ltdc-lms
PREV=/opt/ltdc-lms.previous
FORCE="${1:-}"
exec 9>/run/ltdc-lms-update.lock
flock -n 9 || { echo "Another update is running."; exit 0; }

json_field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];console.log(v??"")}catch{console.log("")}})' "$1"; }

LATEST="$(curl -fsS --max-time 30 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$LMS_REPO/commits/$LMS_BRANCH" | json_field sha)"
[ -n "$LATEST" ] || { echo "Could not read the latest version from GitHub."; exit 1; }
CURRENT="$( [ -f "$APP/build.json" ] && json_field commit < "$APP/build.json" || true)"
if [ "$LATEST" = "$CURRENT" ] && [ "$FORCE" != "--force" ]; then exit 0; fi
echo "Installing ${LATEST:0:7} (was ${CURRENT:0:7})"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL --max-time 120 -o "$TMP/src.tar.gz" "https://codeload.github.com/$LMS_REPO/tar.gz/$LATEST"
tar xzf "$TMP/src.tar.gz" -C "$TMP" --strip-components=1
NEW="$TMP/lms"
[ -f "$NEW/server.js" ] || { echo "No LMS in this version of the repository."; exit 1; }

echo "Running the tests…"
if ! (cd "$NEW" && env -u SETUP_CODE timeout 600 node --test >"$TMP/tests.log" 2>&1); then
  tail -n 40 "$TMP/tests.log"
  echo "Tests failed: ${LATEST:0:7} was NOT installed. The current version keeps running."
  exit 1
fi
grep -E '^# (pass|fail)' "$TMP/tests.log" || true

STAMP="$(date +%F-%H%M)"
[ -f "$APP/data/db.json" ] && cp -p "$APP/data/db.json" "$APP/data/backups/db-before-update-$STAMP.json"
rm -rf "$PREV"
if [ -f "$APP/server.js" ]; then rsync -a --exclude /data/ "$APP/" "$PREV/"; fi

systemctl stop ltdc-lms 2>/dev/null || true
rsync -a --delete --exclude /data/ "$NEW/" "$APP/"
printf '{"commit":"%s","installedAt":"%s","channel":"aws"}\n' "$LATEST" "$(date -Is)" > "$APP/build.json"
chown -R ltdc-lms:ltdc-lms "$APP"
systemctl start ltdc-lms 9>&-

for _ in $(seq 1 20); do
  if curl -fs -o /dev/null http://127.0.0.1:3100/healthz; then
    echo "Lancaster ATLAS ${LATEST:0:7} is running."
    exit 0
  fi
  sleep 1
done

echo "The new version did not start. Recent log:"
journalctl -u ltdc-lms -n 30 --no-pager || true
if [ -d "$PREV" ]; then
  echo "Putting the previous version back."
  systemctl stop ltdc-lms || true
  rsync -a --delete --exclude /data/ "$PREV/" "$APP/"
  # The data as it was before the update, in case the new version had already changed it.
  if [ -f "$APP/data/backups/db-before-update-$STAMP.json" ]; then
    cp -p "$APP/data/backups/db-before-update-$STAMP.json" "$APP/data/db.json"
  fi
  chown -R ltdc-lms:ltdc-lms "$APP"
  systemctl start ltdc-lms 9>&-
fi
exit 1
