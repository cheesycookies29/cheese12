#!/usr/bin/env bash
# First-boot setup of the LTDC LMS server (Ubuntu 24.04), run as root by the EC2
# user data in lms-ec2.yaml. Safe to run again: it only brings the server in line.
#
#   Visitors ──HTTPS──▶ Caddy (80/443, automatic certificate) ──▶ LMS (127.0.0.1:3100)
#                                                                   └── /opt/ltdc-lms/data
#
# Settings come from /etc/ltdc-lms/server.env (written by the user data):
#   LMS_DOMAIN, DUCKDNS_SUBDOMAIN, DUCKDNS_TOKEN, SETUP_CODE, LMS_REPO, LMS_BRANCH, LMS_AUTO_UPDATE
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. /etc/ltdc-lms/server.env
APP=/opt/ltdc-lms
export DEBIAN_FRONTEND=noninteractive

echo "-- Philippine time (attendance, due dates, logs)"
timedatectl set-timezone Asia/Manila

echo "-- Packages: Node.js and Caddy from Ubuntu, plus tools"
apt-get update -q
apt-get install -y -q nodejs caddy rsync curl unattended-upgrades
node --version

echo "-- Security updates install themselves"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "-- App user and folders"
id ltdc-lms >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin ltdc-lms
install -d -o ltdc-lms -g ltdc-lms "$APP" "$APP/data" "$APP/data/backups"

echo "-- App settings (only what the app needs; the DuckDNS token stays out of it)"
umask 027
cat > /etc/ltdc-lms/app.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3100
COOKIE_SECURE=1
ALLOWED_HOSTS=$LMS_DOMAIN
SETUP_CODE=$SETUP_CODE
EOF
umask 022
chown root:ltdc-lms /etc/ltdc-lms/app.env
chmod 640 /etc/ltdc-lms/app.env
install -m 644 "$HERE/ltdc-lms.service" /etc/systemd/system/ltdc-lms.service

echo "-- DuckDNS: point $LMS_DOMAIN at this server now and every 5 minutes"
install -m 750 "$HERE/duckdns-update.sh" /usr/local/sbin/ltdc-lms-duckdns
echo "*/5 * * * * root /usr/local/sbin/ltdc-lms-duckdns >/dev/null 2>&1" > /etc/cron.d/ltdc-lms-duckdns
/usr/local/sbin/ltdc-lms-duckdns || echo "DuckDNS update failed for now; it is retried every 5 minutes."

echo "-- Waiting for the fixed IP $PUBLIC_IP to be attached (for the HTTPS certificate)"
for _ in $(seq 1 60); do
  TOKEN="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token || true)"
  NOW="$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 || true)"
  [ "$NOW" = "$PUBLIC_IP" ] && break
  sleep 5
done
echo "Public IP now: ${NOW:-unknown}"

echo "-- Caddy: HTTPS certificate for $LMS_DOMAIN and forwarding to the app"
sed "s/__DOMAIN__/$LMS_DOMAIN/" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "-- Nightly backup of the data at 2:15 AM, 30 days kept"
install -m 644 "$HERE/ltdc-lms-backup.cron" /etc/cron.d/ltdc-lms-backup

echo "-- Updates from GitHub ($LMS_REPO, branch $LMS_BRANCH)"
install -m 750 "$HERE/update.sh" /usr/local/sbin/ltdc-lms-update
install -m 644 "$HERE/ltdc-lms-update.service" /etc/systemd/system/ltdc-lms-update.service
install -m 644 "$HERE/ltdc-lms-update.timer" /etc/systemd/system/ltdc-lms-update.timer
systemctl daemon-reload
systemctl enable ltdc-lms

echo "-- Install the current version"
/usr/local/sbin/ltdc-lms-update --force

if [ "${LMS_AUTO_UPDATE:-Yes}" = "Yes" ]; then
  systemctl enable --now ltdc-lms-update.timer
  echo "Automatic updates are on (every 10 minutes)."
else
  systemctl disable --now ltdc-lms-update.timer 2>/dev/null || true
  echo "Automatic updates are off. Install one by hand: sudo /usr/local/sbin/ltdc-lms-update"
fi
echo "LTDC LMS is set up: https://$LMS_DOMAIN"
