#!/usr/bin/env bash
# Checks GitHub for a new version of LTDC ERP and installs it. Run every few
# minutes by the ltdc-erp-update timer (see setup-auto-update.sh).
# A new version is installed only if its automated tests pass on this server.
set -euo pipefail

CONF=/etc/ltdc-erp/auto-update.conf
STATE=/var/lib/ltdc-erp
# shellcheck source=/dev/null
. "$CONF"   # REPO, BRANCH, KEY
APP="${APP:-/opt/ltdc-erp}"
export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

mkdir -p "$STATE"
[ -d "$STATE/repo.git" ] || git init -q --bare "$STATE/repo.git"
git --git-dir="$STATE/repo.git" fetch -q --depth 1 "$REPO" "$BRANCH"
NEW="$(git --git-dir="$STATE/repo.git" rev-parse FETCH_HEAD)"
SHORT="${NEW:0:7}"

[ "$NEW" = "$(cat "$STATE/deployed" 2>/dev/null)" ] && exit 0
[ "$NEW" = "$(cat "$STATE/rejected" 2>/dev/null)" ] && exit 0

echo "New version $SHORT found on $BRANCH."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git --git-dir="$STATE/repo.git" archive --format=zip --prefix=ltdc-erp/ -o "$WORK/ltdc-erp.zip" "$NEW"
unzip -q "$WORK/ltdc-erp.zip" -d "$WORK/check"

if ! (cd "$WORK/check/ltdc-erp" && node --test >"$WORK/test.log" 2>&1); then
  echo "Version $SHORT NOT installed: its tests failed on this server. The running version is unchanged."
  tail -n 40 "$WORK/test.log"
  echo "$NEW" > "$STATE/rejected"
  exit 1
fi

bash "$APP/deploy/aws/update.sh" "$WORK/ltdc-erp.zip"
echo "$NEW" > "$STATE/deployed"
