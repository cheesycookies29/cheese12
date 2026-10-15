#!/usr/bin/env bash
# One-time setup: make this server install new LTDC ERP versions from GitHub
# automatically (checked every 5 minutes).
# Usage: sudo bash /opt/ltdc-erp/deploy/aws/setup-auto-update.sh [branch]
set -euo pipefail

BRANCH="${1:-claude/busy-curie-hfpbg0}"
REPO="git@github.com:cheesycookies29/cheese12.git"
KEY=/etc/ltdc-erp/github-deploy-key
APP=/opt/ltdc-erp
[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }

command -v git >/dev/null || apt-get install -y -q git >/dev/null
mkdir -p /etc/ltdc-erp /var/lib/ltdc-erp
chmod 700 /etc/ltdc-erp
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C "ltdc-erp-server-$(hostname)" -f "$KEY"
printf 'REPO=%q\nBRANCH=%q\nKEY=%q\n' "$REPO" "$BRANCH" "$KEY" > /etc/ltdc-erp/auto-update.conf

cat > /etc/systemd/system/ltdc-erp-update.service <<UNIT
[Unit]
Description=Install new LTDC ERP versions from GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $APP/deploy/aws/auto-update.sh
UNIT
cat > /etc/systemd/system/ltdc-erp-update.timer <<UNIT
[Unit]
Description=Check GitHub for a new LTDC ERP version every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload

if GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes" git ls-remote "$REPO" >/dev/null 2>&1; then
  systemctl enable --now ltdc-erp-update.timer
  echo
  echo "Automatic updates are ON. The server checks branch '$BRANCH' every 5 minutes"
  echo "and installs the latest version within a few minutes if its tests pass."
  echo "See what it did:  sudo journalctl -u ltdc-erp-update -n 30 --no-pager"
else
  echo
  echo "One more step: give this server read-only access to the GitHub repository."
  echo "1. Open https://github.com/cheesycookies29/cheese12/settings/keys/new"
  echo "2. Title: LTDC ERP server.  Key: paste the line below.  Leave 'Allow write access' UNTICKED."
  echo
  cat "$KEY.pub"
  echo
  echo "3. Click 'Add key', then run this command again."
fi
