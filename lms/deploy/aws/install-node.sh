#!/usr/bin/env bash
# Installs Node.js 22 LTS from NodeSource's signed apt repository and lets Ubuntu's automatic
# security updates keep it current. Ubuntu 24.04's own "nodejs" package is Node 18, which no
# longer gets security fixes. Run as root; safe to run again. Used by server-setup.sh (new
# servers) and upgrade-server.sh (servers set up before this script existed).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
export DEBIAN_FRONTEND=noninteractive
WANT=22

have="$(node --version 2>/dev/null | sed 's/^v//; s/\..*//' || true)"
if [ "${have:-0}" -ge "$WANT" ]; then
  echo "Node.js $(node --version) is already installed."
else
  install -d -m 0755 /etc/apt/keyrings
  if curl -fsSL --max-time 60 -o /etc/apt/keyrings/nodesource.asc https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key; then
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.asc] https://deb.nodesource.com/node_${WANT}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    # Prefer NodeSource's nodejs over Ubuntu's older one.
    printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 700\n' > /etc/apt/preferences.d/nodesource
    apt-get update -q
    apt-get install -y -q nodejs
  else
    echo "Could not reach deb.nodesource.com: keeping Ubuntu's Node.js for now. Run this script again later."
    command -v node >/dev/null || apt-get install -y -q nodejs
  fi
fi
# Automatic security updates also cover NodeSource's repository.
cat > /etc/apt/apt.conf.d/51ltdc-lms-nodesource <<'EOF'
Unattended-Upgrade::Origins-Pattern {
	"site=deb.nodesource.com";
};
EOF
node --version
