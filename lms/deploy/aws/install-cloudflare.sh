#!/usr/bin/env bash
# Installs the Cloudflare helper behind "Set up Cloudflare for me" (Admin panel): the root script
# /usr/local/sbin/ltdc-lms-cloudflare, the list of Cloudflare's addresses it falls back on, the
# plain Caddyfile template it switches back to, its systemd units, and nftables (the firewall tool
# for "Only accept visitors through Cloudflare"). Used by server-setup.sh (new servers) and
# upgrade-server.sh (servers set up earlier). Run as root; safe to run again.
#
# The files are copied out of /opt/ltdc-lms on purpose: that folder belongs to the app's account
# and is replaced by every update, and root must not run (or copy into Caddy) what the app can change.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

if ! command -v nft >/dev/null 2>&1; then
  # Ubuntu's own nftables.service (it loads /etc/nftables.conf, which starts with "flush ruleset") is
  # left as it was: if installing the package enabled it, it is disabled again.
  before="$(systemctl is-enabled nftables.service 2>/dev/null || true)"
  apt-get install -y -q nftables || { apt-get update -q && apt-get install -y -q nftables; } \
    || echo "Could not install nftables now: \"Only accept visitors through Cloudflare\" needs it. Run this again later."
  if [ "$before" != enabled ] && systemctl is-enabled -q nftables.service 2>/dev/null; then
    systemctl disable nftables.service
  fi
fi

install -d -m 755 /usr/local/share/ltdc-lms
install -m 750 "$HERE/cloudflare-apply.sh" /usr/local/sbin/ltdc-lms-cloudflare
install -m 644 "$HERE/cloudflare-ips.txt" /usr/local/share/ltdc-lms/cloudflare-ips.txt
install -m 644 "$HERE/Caddyfile" /usr/local/share/ltdc-lms/Caddyfile.template
install -m 644 "$HERE/ltdc-lms-cloudflare.service" /etc/systemd/system/ltdc-lms-cloudflare.service
install -m 644 "$HERE/ltdc-lms-cloudflare.path" /etc/systemd/system/ltdc-lms-cloudflare.path
systemctl daemon-reload
# At boot: puts the firewall back as it was last applied. The path unit: runs it on each request.
systemctl enable ltdc-lms-cloudflare.service
systemctl enable --now ltdc-lms-cloudflare.path
echo "Cloudflare helper installed: /usr/local/sbin/ltdc-lms-cloudflare"
