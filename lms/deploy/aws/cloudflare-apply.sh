#!/usr/bin/env bash
# Puts Cloudflare in front of Lancaster ATLAS, or takes it away again, as an administrator asked in
# the Admin panel ("Set up Cloudflare for me"). Installed by upgrade-server.sh and server-setup.sh as
# /usr/local/sbin/ltdc-lms-cloudflare (root only) and run by ltdc-lms-cloudflare.service: each time
# the app writes its request (ltdc-lms-cloudflare.path), and at boot, to put the firewall back
# (firewall rules do not survive a restart).
#
#   The request, written by the app:   /opt/ltdc-lms/data/cloudflare.json         (not trusted)
#   The answer, read by the app:       /opt/ltdc-lms/data/cloudflare-status.json
#   What was applied (root only):      /var/lib/ltdc-lms-cloudflare/
#
# It changes only: /etc/caddy/Caddyfile (checked with "caddy validate" first), ALLOWED_HOSTS and
# PUBLIC_URL in /etc/ltdc-lms/app.env, and its own firewall table "inet ltdc_cloudflare". The
# Cloudflare API token is used by the app only and never reaches this script or the server's files.
#
# Usage: ltdc-lms-cloudflare                  apply the request (if already applied: only the firewall)
#        ltdc-lms-cloudflare --force          apply it again in full (upgrade-server.sh does this)
#        ltdc-lms-cloudflare --print-plain-caddyfile
#                                             the Caddyfile without Cloudflare (server-setup.sh uses it)
# Tests run it without root or network: LTDC_CF_TEST=1, the LTDC_CF_* paths below, and stub
# commands first on PATH (see test/cloudflare-apply.test.js).
set -euo pipefail
umask 077

DATA="${LTDC_CF_DATA_DIR:-/opt/ltdc-lms/data}"
ETC="${LTDC_CF_ETC_DIR:-/etc/ltdc-lms}"
CADDY_DIR="${LTDC_CF_CADDY_DIR:-/etc/caddy}"
RANGES_BUNDLED="${LTDC_CF_RANGES_FILE:-/usr/local/share/ltdc-lms/cloudflare-ips.txt}"
TEMPLATE="${LTDC_CF_TEMPLATE:-/usr/local/share/ltdc-lms/Caddyfile.template}"
STATE="${LTDC_CF_STATE_DIR:-/var/lib/ltdc-lms-cloudflare}"
LOCK="${LTDC_CF_LOCK:-/run/ltdc-lms-cloudflare/lock}"
NODE="${LTDC_CF_NODE:-/usr/bin/node}"
CERT_TRIES="${LTDC_CF_CERT_TRIES:-24}" # 24 × 5 s: about 2 minutes for the first certificate
EDGE_TRIES="${LTDC_CF_EDGE_TRIES:-6}"  # 6 × 10 s for the check through Cloudflare
TEST_MODE="${LTDC_CF_TEST:-}"

REQUEST="$DATA/cloudflare.json"
STATUS="$DATA/cloudflare-status.json"
CADDYFILE="$CADDY_DIR/Caddyfile"
APPENV="$ETC/app.env"
SERVERENV="$ETC/server.env"
APP_USER=ltdc-lms
TABLE=ltdc_cloudflare
CHECK_PATH=/.well-known/ltdc-lms-cloudflare

log() { printf '%s\n' "$*"; }

# ---- Small helpers in Node.js: reading the request, the ranges and writing the answer ----------
# shellcheck disable=SC2016
JS='
"use strict";
const fs = require("fs"), net = require("net"), path = require("path"), crypto = require("crypto");
const [cmd, ...a] = process.argv.slice(1);
const C = fs.constants;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const isName = (h) => typeof h === "string" && h.length <= 253 && h.includes(".") && h.split(".").every((l) => LABEL.test(l)) && !/^[0-9]+$/.test(h.split(".").pop());
const done = (...f) => { process.stdout.write(f.join("|") + "\n"); process.exit(0); };
// Which version of the request file this is (a new write or a rename changes it); "" = no file.
const keyOf = (file) => {
  try { const s = fs.lstatSync(file); return [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(":"); } catch { return ""; }
};

if (cmd === "key") { process.stdout.write(keyOf(a[0])); process.exit(0); }

if (cmd === "name") { // name <h>: is h a lowercase DNS name?
  process.exit(isName(a[0]) && !net.isIP(a[0]) ? 0 : 1);
}

if (cmd === "request") { // request <file> <duckdns name> → key|OK|host|yes/no|requestedAt|by  or  key|ERR|requestedAt|message  or  |MISSING
  const [file, duck] = a;
  const key = keyOf(file);
  const bad = (at, msg) => done(key, "ERR", at, msg);
  let fd;
  try {
    fd = fs.openSync(file, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  } catch (e) {
    if (e.code === "ENOENT") done("", "MISSING");
    bad("", e.code === "ELOOP" ? "The request file is a link, not a plain file, so it was ignored. Nothing was changed." : "The request could not be read. Nothing was changed.");
  }
  const st = fs.fstatSync(fd);
  if (!st.isFile()) bad("", "The request is not a plain file, so it was ignored. Nothing was changed.");
  const buf = Buffer.alloc(4097);
  const n = st.size > 4096 ? 4097 : fs.readSync(fd, buf, 0, 4097, 0);
  fs.closeSync(fd);
  if (n > 4096) bad("", "The request is larger than expected, so it was ignored. Nothing was changed.");
  let r;
  try { r = JSON.parse(buf.subarray(0, n).toString("utf8")); } catch { bad("", "The request could not be read (it is not valid JSON). Nothing was changed."); }
  if (!r || typeof r !== "object" || Array.isArray(r)) bad("", "The request could not be read. Nothing was changed.");
  const at = typeof r.requestedAt === "string" && r.requestedAt.length <= 40 && ISO.test(r.requestedAt) && !Number.isNaN(Date.parse(r.requestedAt)) ? r.requestedAt : "";
  if (r.version !== 1) bad(at, "The request comes from a different version of ATLAS. Run upgrade-server.sh on the server, then try again. Nothing was changed.");
  if (!at) bad("", "The request has no valid time (requestedAt). Nothing was changed.");
  const h = r.hostname;
  if (typeof h !== "string") bad(at, "The request has no address (hostname). Nothing was changed.");
  if (h !== "") {
    if (net.isIP(h) || /^[0-9.]+$/.test(h) || h.includes(":")) bad(at, "Enter a name for the website, such as atlas.school.edu.ph, not an IP address. Nothing was changed.");
    if (!isName(h)) bad(at, "That is not a valid website address. Use lowercase letters, numbers, dots and dashes, such as atlas.school.edu.ph. Nothing was changed.");
    if (h === duck) bad(at, "That is the DuckDNS address of this server. Enter the address of the school for Cloudflare. Nothing was changed.");
  }
  if (typeof r.lockOrigin !== "boolean") bad(at, "The request is incomplete (lockOrigin). Nothing was changed.");
  const by = typeof r.requestedBy === "string" ? JSON.stringify(r.requestedBy.slice(0, 80)) : "\"\"";
  done(key, "OK", h, r.lockOrigin ? "yes" : "no", at, by);
}

if (cmd === "ranges") { // ranges <file>... → line 1: IPv4 ranges, line 2: IPv6 ranges (space-separated); exit 1 if any line is wrong
  const v4 = new Set(), v6 = new Set();
  const fail = (why) => { process.stderr.write(why + "\n"); process.exit(1); };
  for (const f of a) {
    for (const raw of fs.readFileSync(f, "utf8").split("\n")) {
      const l = raw.replace(/#.*/, "").trim().toLowerCase();
      if (!l) continue;
      const m = /^([0-9a-f.:]{2,39})\/([0-9]{1,3})$/.exec(l);
      if (!m) fail("not an address range: " + JSON.stringify(l.slice(0, 60)));
      const kind = net.isIP(m[1]), bits = Number(m[2]);
      if (kind === 4 && bits >= 8 && bits <= 32) v4.add(l);
      else if (kind === 6 && bits >= 12 && bits <= 128) v6.add(l);
      else fail("not an address range: " + JSON.stringify(l.slice(0, 60)));
    }
  }
  if (v4.size < 5 || v4.size > 200 || v6.size < 2 || v6.size > 200) fail(`unexpected number of ranges (${v4.size} IPv4, ${v6.size} IPv6)`);
  process.stdout.write([...v4].join(" ") + "\n" + [...v6].join(" ") + "\n");
  process.exit(0);
}

if (cmd === "get") { // get <file> <key>: a field of our own (root-owned) record; yes/no for booleans
  try {
    const v = JSON.parse(fs.readFileSync(a[0], "utf8"))[a[1]];
    process.stdout.write(v === true ? "yes" : v === false ? "no" : typeof v === "string" ? v.replace(/[^\x20-\x7e]/g, "") : "");
  } catch { /* none yet */ }
  process.exit(0);
}

if (cmd === "status") { // status <target> <uid> <gid> <own copy> <state> <hostname> <requestedAt> <cert> <through> <locked> <message>
  const [target, uid, gid, copy, state, hostname, requestedAt, cert, through, locked, message] = a;
  const text = JSON.stringify({
    version: 1, state, hostname, requestedAt, appliedAt: new Date().toISOString(),
    certificate: cert === "yes", throughCloudflare: through === "yes", originLocked: locked === "yes", message,
  }, null, 2) + "\n";
  // Written through the file descriptor of a new file (never through a path the app could have
  // swapped for a link), then renamed over the target: a link planted there is replaced, not followed.
  const put = (file, mode, u, g) => {
    const tmp = path.join(path.dirname(file), "." + path.basename(file) + "." + crypto.randomBytes(8).toString("hex"));
    const fd = fs.openSync(tmp, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, mode);
    try {
      fs.writeSync(fd, text);
      if (u !== "-") fs.fchownSync(fd, Number(u), Number(g));
      fs.fchmodSync(fd, mode);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  };
  put(copy, 0o600, "-", "-");
  put(target, 0o640, uid, gid);
  process.exit(0);
}
process.exit(2);
'
js() { "$NODE" -e "$JS" "$@"; }

# ---- The server's own DuckDNS address --------------------------------------------------------
read_duck() {
  DUCK="$(sed -n 's/^LMS_DOMAIN=//p' "$SERVERENV" | tail -n 1 | tr -d "\"' \r")"
  js name "$DUCK" || { log "LMS_DOMAIN in $SERVERENV is not a valid address: '$DUCK'."; exit 1; }
}

# The Caddyfile without Cloudflare: the template, exactly as server-setup.sh has always written it.
print_plain() { sed "s/__DOMAIN__/$DUCK/" "$TEMPLATE"; }

# ---- Caddyfile with Cloudflare in front ------------------------------------------------------
# Ubuntu 24.04's Caddy is 2.6.2, which has neither "servers { trusted_proxies }" (2.6.3) nor
# "client_ip_headers" and {client_ip} (2.7). So the visitor's address is taken from
# CF-Connecting-IP only when the connection itself comes from a Cloudflare range (remote_ip looks
# at the direct connection), and sent to ATLAS as the only X-Forwarded-For entry. Any other
# connection is sent with its own address, so the header cannot be forged by going around
# Cloudflare. Works the same on newer Caddy versions.
print_cloudflare() { # $1 = yes: keep the DuckDNS address as a redirect
  cat <<EOF
# Written by ltdc-lms-cloudflare on $(date -Is): Cloudflare is in front of $HOST.
# Do not edit by hand: switch Cloudflare off in the Admin panel to go back to the plain set-up
# (deploy/aws/EC2.md, "Cloudflare").
$HOST {
	encode gzip
	@ltdc_check path $CHECK_PATH
	@cloudflare {
		remote_ip $RANGES_ALL
		header_regexp CF-Connecting-IP ^[0-9A-Fa-f:.]+\$
	}
	handle @ltdc_check {
		respond "$NONCE" 200
	}
	handle @cloudflare {
		reverse_proxy 127.0.0.1:3100 {
			header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
		}
	}
	handle {
		reverse_proxy 127.0.0.1:3100 {
			header_up X-Forwarded-For {http.request.remote.host}
		}
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
	log {
		output file /var/log/caddy/access.log {
			roll_size 20mb
			roll_keep 5
		}
	}
}
EOF
  if [ "$1" = yes ]; then
    cat <<EOF

# The DuckDNS address sends visitors on to the school's address.
$DUCK {
	redir https://$HOST{uri} permanent
}
EOF
  fi
}

# ---- app.env: ALLOWED_HOSTS and PUBLIC_URL; every other line kept as it is -------------------
print_appenv() { # $1 = ALLOWED_HOSTS value, $2 = PUBLIC_URL value ("" = no PUBLIC_URL)
  local line placed=no
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ALLOWED_HOSTS=*)
        if [ "$placed" = no ]; then
          printf 'ALLOWED_HOSTS=%s\n' "$1"
          [ -z "$2" ] || printf 'PUBLIC_URL=%s\n' "$2"
          placed=yes
        fi ;;
      PUBLIC_URL=*) ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$APPENV"
  if [ "$placed" = no ]; then
    printf 'ALLOWED_HOSTS=%s\n' "$1"
    [ -z "$2" ] || printf 'PUBLIC_URL=%s\n' "$2"
  fi
}

caddy_validate() { # $1 = file
  if [ -z "$TEST_MODE" ] && [ "$(id -u)" = 0 ] && id caddy >/dev/null 2>&1; then
    # As Caddy's own account, so that nothing it creates belongs to root.
    setpriv --reuid=caddy --regid=caddy --init-groups env HOME="$(getent passwd caddy | cut -d: -f6)" \
      caddy validate --adapter caddyfile --config "$1"
  else
    caddy validate --adapter caddyfile --config "$1"
  fi
}

new_temp() { mktemp "$(dirname "$1")/.$(basename "$1").XXXXXX"; } # next to the file, so mv is a rename

# Puts a checked new file in place, keeping the old file's owner and mode.
install_over() { # $1 = new file, $2 = target
  chown --reference="$2" "$1" && chmod --reference="$2" "$1" && mv -f "$1" "$2"
}

wait_for_app() {
  local _
  for _ in $(seq 1 30); do
    curl -fs -o /dev/null --max-time 5 http://127.0.0.1:3100/healthz && return 0
    sleep 1
  done
  return 1
}

# ---- Firewall: our own table only; nothing else on the server is touched ---------------------
firewall_open() {
  command -v nft >/dev/null 2>&1 || return 0
  if nft list table inet "$TABLE" >/dev/null 2>&1; then
    nft delete table inet "$TABLE" && log "Firewall: the server accepts visitors directly again."
  fi
}

firewall_lock() { # uses RANGES4 / RANGES6
  local rules
  rules="$STATE/firewall.nft"
  {
    echo "# Written by ltdc-lms-cloudflare: HTTP and HTTPS only from Cloudflare (Cloudflare's ranges)."
    echo "table inet $TABLE {}"
    echo "delete table inet $TABLE"
    echo "table inet $TABLE {"
    echo "	set cloudflare4 {"
    echo "		type ipv4_addr"
    echo "		flags interval"
    echo "		auto-merge"
    echo "		elements = { ${RANGES4// /, } }"
    echo "	}"
    echo "	set cloudflare6 {"
    echo "		type ipv6_addr"
    echo "		flags interval"
    echo "		auto-merge"
    echo "		elements = { ${RANGES6// /, } }"
    echo "	}"
    echo "	chain input {"
    echo "		type filter hook input priority filter; policy accept;"
    echo "		iifname \"lo\" accept"
    echo "		tcp dport { 80, 443 } ip saddr @cloudflare4 accept"
    echo "		tcp dport { 80, 443 } ip6 saddr @cloudflare6 accept"
    echo "		tcp dport { 80, 443 } drop"
    echo "		udp dport 443 ip saddr @cloudflare4 accept"
    echo "		udp dport 443 ip6 saddr @cloudflare6 accept"
    echo "		udp dport 443 drop"
    echo "	}"
    echo "}"
  } > "$rules"
  nft -f "$rules" # one transaction: all of it or nothing
}

load_applied_ranges() {
  local out
  out="$(js ranges "$STATE/applied-ranges.txt" 2>/dev/null)" || out="$(js ranges "$RANGES_BUNDLED")" || return 1
  RANGES4="$(sed -n 1p <<<"$out")"
  RANGES6="$(sed -n 2p <<<"$out")"
}

# After a restart (or a repeated request): the firewall as it was last applied, from our own record.
reassert_firewall() {
  if [ "$(js get "$STATE/status.json" originLocked)" = yes ]; then
    if ! command -v nft >/dev/null 2>&1; then log "Firewall: nft is not installed, so the server stays open."; return 0; fi
    load_applied_ranges || { log "Firewall: no valid Cloudflare ranges, so the server stays open."; return 0; }
    firewall_lock && log "Firewall: HTTP and HTTPS only from Cloudflare, as last applied."
  else
    firewall_open
  fi
}

# ---- Cloudflare's address ranges: fetched now, or the list that came with this script ----------
load_ranges() {
  local out
  if curl -fsS --max-time 10 -o "$STATE/fetched-v4.txt" https://www.cloudflare.com/ips-v4 \
    && curl -fsS --max-time 10 -o "$STATE/fetched-v6.txt" https://www.cloudflare.com/ips-v6 \
    && out="$(js ranges "$STATE/fetched-v4.txt" "$STATE/fetched-v6.txt")"; then
    log "Cloudflare ranges: fetched from cloudflare.com."
  elif out="$(js ranges "$RANGES_BUNDLED")"; then
    log "Cloudflare ranges: could not fetch the current list; using $RANGES_BUNDLED."
  else
    return 1
  fi
  rm -f "$STATE/fetched-v4.txt" "$STATE/fetched-v6.txt"
  RANGES4="$(sed -n 1p <<<"$out")"
  RANGES6="$(sed -n 2p <<<"$out")"
  RANGES_ALL="$RANGES4 $RANGES6"
}

# ---- The answer for the Admin panel ----------------------------------------------------------
status() { # state hostname certificate(yes/no) throughCloudflare originLocked message
  local uid=- gid=-
  if [ -z "$TEST_MODE" ]; then uid="$(id -u "$APP_USER")"; gid="$(id -g "$APP_USER")"; fi
  js status "$STATUS" "$uid" "$gid" "$STATE/status.json" "$1" "$2" "$REQ_AT" "$3" "$4" "$5" "$6"
  log "Status: $1. $6"
}

# The end of a run. If the Admin panel wrote a new request while this one was being applied (the
# path unit does not start the service again while it runs), that one is applied next.
finish() { # $1 = exit code
  local again="${LTDC_CF_AGAIN:-0}"
  if [ "$(js key "$REQUEST")" != "$REQ_KEY" ] && [ "$again" -lt 5 ]; then
    log "A new request arrived meanwhile; applying it."
    exec 9>&-
    LTDC_CF_AGAIN=$((again + 1)) exec bash "$0"
  fi
  exit "$1"
}

# Something went wrong before anything changed: report it with what the server still does.
failed_unchanged() { # $1 = message
  local locked=no
  if command -v nft >/dev/null 2>&1 && nft list table inet "$TABLE" >/dev/null 2>&1; then locked=yes; fi
  status failed "$(js get "$STATE/status.json" hostname)" "$(js get "$STATE/status.json" certificate)" \
    "$(js get "$STATE/status.json" throughCloudflare)" "$locked" "$1"
  finish 1
}

# Checks a new Caddyfile and app.env and puts them in place; anything that fails is put back.
# Returns 1 (with MSG set) if the new settings could not be used. It runs as "apply_files … ||",
# where bash does not stop at errors, so every step that matters is checked here.
apply_files() { # $1 = new Caddyfile, $2 = new app.env
  local caddy_changed=no app_changed=no
  MSG="The new settings could not be written, so nothing was changed. See the server log: journalctl -u ltdc-lms-cloudflare."
  if ! caddy_validate "$1"; then
    rm -f "$1" "$2"
    MSG="The new web server settings were not accepted, so nothing was changed. See the server log: journalctl -u ltdc-lms-cloudflare."
    return 1
  fi
  cmp -s "$1" "$CADDYFILE" || caddy_changed=yes
  cmp -s "$2" "$APPENV" || app_changed=yes
  if ! cp -p "$CADDYFILE" "$STATE/Caddyfile.before" || ! cp -p "$APPENV" "$STATE/app.env.before"; then
    rm -f "$1" "$2"
    return 1
  fi

  if [ "$app_changed" = yes ]; then
    install_over "$2" "$APPENV" || { rm -f "$1" "$2"; return 1; }
    log "app.env: ALLOWED_HOSTS and PUBLIC_URL updated; restarting ATLAS."
    systemctl restart ltdc-lms
    if ! wait_for_app; then
      cp -p "$STATE/app.env.before" "$APPENV"
      systemctl restart ltdc-lms || true
      rm -f "$1"
      MSG="ATLAS did not start with the new settings, so the previous ones were put back."
      return 1
    fi
  else
    rm -f "$2"
  fi

  if [ "$caddy_changed" = yes ]; then
    if ! install_over "$1" "$CADDYFILE" || ! systemctl reload caddy; then
      rm -f "$1"
      cp -p "$STATE/Caddyfile.before" "$CADDYFILE"
      systemctl reload caddy || systemctl restart caddy || true
      if [ "$app_changed" = yes ]; then
        cp -p "$STATE/app.env.before" "$APPENV"
        systemctl restart ltdc-lms || true
      fi
      MSG="The web server did not take the new settings, so the previous ones were put back."
      return 1
    fi
    log "Caddy: new settings in use."
  else
    rm -f "$1"
  fi
  return 0
}

# ---- Cloudflare off: the plain set-up again --------------------------------------------------
apply_off() {
  local caddy_new env_new
  log "Switching Cloudflare off."
  firewall_open
  caddy_new="$(new_temp "$CADDYFILE")"; print_plain > "$caddy_new"; chmod 644 "$caddy_new"
  env_new="$(new_temp "$APPENV")"; print_appenv "$DUCK" "" > "$env_new"
  apply_files "$caddy_new" "$env_new" || failed_unchanged "$MSG"
  : > "$STATE/applied-ranges.txt"
  status off "" no no no "Cloudflare is off. ATLAS answers at https://$DUCK directly."
  finish 0
}

# ---- Cloudflare on ---------------------------------------------------------------------------
apply_on() {
  local caddy_new env_new cert=no edge=no locked=no hdr body _ msg state=active
  log "Setting up Cloudflare for $HOST (lock to Cloudflare: $LOCK_REQ)."
  [ "$LOCK_REQ" = yes ] || firewall_open
  NONCE="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  caddy_new="$(new_temp "$CADDYFILE")"; print_cloudflare yes > "$caddy_new"; chmod 644 "$caddy_new"
  env_new="$(new_temp "$APPENV")"; print_appenv "$DUCK,$HOST" "https://$HOST" > "$env_new"
  apply_files "$caddy_new" "$env_new" || failed_unchanged "$MSG"
  # shellcheck disable=SC2086 # one range per line
  printf '%s\n' $RANGES_ALL > "$STATE/applied-ranges.txt"

  log "Checking the certificate for $HOST (up to about $((CERT_TRIES * 5)) seconds)…"
  for _ in $(seq 1 "$CERT_TRIES"); do
    if curl -fsS -o /dev/null --max-time 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/healthz"; then cert=yes; break; fi
    sleep 5
  done
  if [ "$cert" = yes ]; then
    log "Checking that $HOST answers through Cloudflare…"
    hdr="$STATE/check.headers"; body="$STATE/check.body"
    for _ in $(seq 1 "$EDGE_TRIES"); do
      rm -f "$hdr" "$body"
      if curl -fsS --max-time 10 -D "$hdr" -o "$body" "https://$HOST$CHECK_PATH" \
        && grep -qi '^cf-ray:' "$hdr" && [ "$(tr -d '\r\n' < "$body")" = "$NONCE" ]; then
        edge=yes; break
      fi
      sleep 10
    done
    rm -f "$hdr" "$body"
  fi

  if [ "$cert" = no ]; then
    firewall_open
    state=failed
    msg="The server is set up for $HOST, but it could not get the security certificate yet. Check that the DNS record for $HOST is in place at Cloudflare, then try again in a few minutes."
  elif [ "$edge" = no ]; then
    firewall_open
    if [ "$LOCK_REQ" = yes ]; then
      msg="$HOST works, but visitors are not reaching it through Cloudflare yet, so the server still accepts visitors directly. Check that the DNS record for $HOST is proxied (orange cloud), then try again."
    else
      msg="$HOST works, but visitors are not reaching it through Cloudflare yet. Check that the DNS record for $HOST is proxied (orange cloud)."
    fi
  elif [ "$LOCK_REQ" = no ]; then
    msg="Cloudflare is in front of $HOST. Visitors can still reach the server directly; turn on Only accept visitors through Cloudflare to stop that."
  elif ! command -v nft >/dev/null 2>&1; then
    msg="Cloudflare is in front of $HOST, but the server could not be closed to direct visitors because its firewall tool (nftables) is missing. Run upgrade-server.sh on the server, then try again."
  elif ! firewall_lock; then
    firewall_open
    msg="Cloudflare is in front of $HOST, but the firewall change failed, so the server still accepts visitors directly. See the server log: journalctl -u ltdc-lms-cloudflare."
  else
    locked=yes
    log "Firewall: HTTP and HTTPS only from Cloudflare."
    msg="Cloudflare is in front of $HOST, and the server only accepts visitors that come through Cloudflare. The DuckDNS address no longer opens ATLAS directly."
    # The DuckDNS address cannot renew its certificate any more: it is left out of Caddy's settings.
    caddy_new="$(new_temp "$CADDYFILE")"; print_cloudflare no > "$caddy_new"; chmod 644 "$caddy_new"
    env_new="$(new_temp "$APPENV")"; cp -p "$APPENV" "$env_new"
    apply_files "$caddy_new" "$env_new" || log "Caddy: could not leave the DuckDNS address out ($MSG); it stays as a redirect."
  fi
  status "$state" "$HOST" "$cert" "$edge" "$locked" "$msg"
  if [ "$state" = active ]; then finish 0; else finish 1; fi
}

# ---- Main ------------------------------------------------------------------------------------
MODE="${1:-}"
case "$MODE" in
  ""|--force) ;;
  --print-plain-caddyfile) read_duck; print_plain; exit 0 ;;
  *) echo "Usage: $0 [--force | --print-plain-caddyfile]" >&2; exit 2 ;;
esac
if [ "$(id -u)" != 0 ] && [ "$TEST_MODE" != 1 ]; then echo "Run as root: sudo $0"; exit 1; fi

install -d -m 700 "$STATE"
mkdir -p "$(dirname "$LOCK")"
exec 9>"$LOCK"
flock -w 900 9 || { log "Another run did not finish in 15 minutes."; exit 1; }

read_duck
REQ_AT=""
IFS='|' read -r REQ_KEY KIND F1 F2 F3 F4 <<<"$(js request "$REQUEST" "$DUCK")"
case "$KIND" in
  MISSING)
    log "No Cloudflare request yet."
    reassert_firewall
    finish 0 ;;
  ERR)
    REQ_AT="$F1"
    log "Request refused: $F2"
    reassert_firewall # what was applied before stays in force, firewall included
    failed_unchanged "$F2" ;;
  OK)
    HOST="$F1"; LOCK_REQ="$F2"; REQ_AT="$F3"
    log "Request of $REQ_AT by $F4: address \"$HOST\", only through Cloudflare: $LOCK_REQ." ;;
  *)
    log "The request could not be read."; exit 1 ;;
esac

if [ "$MODE" != --force ] && [ "$(js get "$STATE/status.json" requestedAt)" = "$REQ_AT" ]; then
  log "This request was already applied; putting the firewall back as it was."
  reassert_firewall
  finish 0
fi

load_ranges || failed_unchanged "The list of Cloudflare addresses on the server is missing or damaged, so nothing was changed. Run upgrade-server.sh on the server."
if [ -z "$HOST" ]; then apply_off; else apply_on; fi
