#!/usr/bin/env bash
# Points the DuckDNS address at this server's public IP (DuckDNS sees it from the request).
# Installed as /usr/local/sbin/ltdc-lms-duckdns and run every 5 minutes by cron.
set -euo pipefail
# shellcheck source=/dev/null
. /etc/ltdc-lms/server.env
ANSWER="$(curl -fsS --max-time 20 "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=${PUBLIC_IP:-}")"
[ "$ANSWER" = "OK" ] || { echo "DuckDNS refused the update ($ANSWER): check the DuckDNS name and token."; exit 1; }
