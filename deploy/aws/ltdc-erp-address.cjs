#!/usr/bin/env node
// Sets the web addresses this server answers to (0.73.1): the Caddy site (HTTPS) and the app's own
// host name check (ALLOWED_HOSTS), from deploy/aws/site-address. Installed by remote-deploy.sh as
// /usr/local/sbin/ltdc-erp-address and run on every deploy; run it by hand with:
//   sudo ltdc-erp-address [path/to/site-address]
//
// What it does, safely:
// - an address is used only when its DNS points at this server (an address with no record yet, or
//   one behind Cloudflare's proxy, is left out and the reason printed);
// - until the main address's certificate works, every address is served as it is; once it works,
//   the others send visitors to it (308, same path, so old links and QR codes keep working). When
//   the main address is new, it waits up to 90 seconds for Caddy to get its certificate, then
//   switches in the same run (otherwise the next run switches);
// - the new Caddyfile is checked with `caddy validate` before it is used, the old one is kept as
//   Caddyfile.before-<time>, and if Caddy refuses the reload the old one is put back;
// - if no address points here (a DNS outage), nothing is changed.
// CommonJS without dependencies, so the installed copy runs on its own with the server's Node.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const https = require('node:https');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// The addresses in a site-address file: one per line, # comments, lower case, no duplicates.
function parseAddresses(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/#.*/, '').trim().toLowerCase();
    if (!line) continue;
    if (!HOST_RE.test(line)) throw new Error(`"${line}" is not a web address (a host name such as erp.example.com, without https:// or a path).`);
    if (!out.includes(line)) out.push(line);
  }
  if (!out.length) throw new Error('The site-address file lists no address.');
  return out;
}

const SITE = (names) => `${names.join(', ')} {
	encode gzip
	# The app is told the visitor's own address, replacing any X-Forwarded-For the visitor sent.
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Forwarded-For {remote_host}
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy same-origin
	}
}
`;

// The Caddyfile: the served addresses as one site; with redirectTo, the others send visitors there.
function renderCaddyfile({ served, redirectTo = null }) {
  const head = '# Written by ltdc-erp-address from /opt/ltdc-erp/deploy/aws/site-address (deploy/aws/EC2.md,\n# "Changing the web address"). Edit that file, not this one: the next deploy rewrites this one.\n# Caddy gets and renews the HTTPS certificate for each address automatically.\n';
  if (!redirectTo) return `${head}${SITE(served)}`;
  const others = served.filter((n) => n !== redirectTo);
  return `${head}${SITE([redirectTo])}${others.map((n) => `
${n} {
	redir https://${redirectTo}{uri} 308
}
`).join('')}`;
}

const renderDropIn = (addresses) => `# Written by ltdc-erp-address: the host names the app answers to (deploy/aws/site-address).
[Service]
Environment=ALLOWED_HOSTS=${addresses.join(',')}
`;

// Which addresses point at this server. resolve(name) → [IPv4]; publicIp may be null (unknown):
// then any address with a record counts.
async function checkAddresses(addresses, { resolve, publicIp }) {
  const live = [];
  const notes = [];
  for (const name of addresses) {
    let ips = [];
    try { ips = await resolve(name); } catch { ips = []; }
    if (!ips.length) notes.push(`${name} has no DNS record yet, so it is not used for now.`);
    else if (publicIp && !ips.includes(publicIp)) notes.push(`${name} points at ${ips.join(', ')}, not this server (${publicIp}), so it is not used for now. If it is in Cloudflare, set its record to "DNS only" (grey cloud) and point it at ${publicIp}.`);
    else live.push(name);
  }
  return { live, notes };
}

// ----- What touches the server (each can be replaced in tests) -----
function systemResolve(name) {
  return dns.resolve4(name);
}

function get(url, opts = {}, timeout = 2000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { timeout, ...opts }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

// This server's public address: the instance metadata (IMDSv2), or AWS's own lookup, or unknown.
async function findPublicIp() {
  const token = await get('http://169.254.169.254/latest/api/token', { method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' } });
  if (token?.status === 200) {
    const ip = await get('http://169.254.169.254/latest/meta-data/public-ipv4', { headers: { 'X-aws-ec2-metadata-token': token.body.trim() } });
    if (ip?.status === 200 && /^\d+\.\d+\.\d+\.\d+$/.test(ip.body.trim())) return ip.body.trim();
  }
  const look = await get('https://checkip.amazonaws.com/', {}, 4000);
  if (look?.status === 200 && /^\d+\.\d+\.\d+\.\d+$/.test(look.body.trim())) return look.body.trim();
  return null;
}

// Whether Caddy on this server already has a trusted certificate for name (asked here, not through
// the internet: the request goes to 127.0.0.1 with the name as the TLS server name).
async function certificateWorks(name) {
  const r = await get(`https://${name}/api/auth/status`, { lookup: (_h, o, cb) => (o && o.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)), servername: name }, 5000);
  return !!r && r.status < 500;
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const system = {
  validate: (file) => run('caddy', ['validate', '--config', file, '--adapter', 'caddyfile']),
  reloadCaddy: () => run('systemctl', ['reload', 'caddy']),
  daemonReload: () => run('systemctl', ['daemon-reload']),
  restartApp: () => run('systemctl', ['restart', 'ltdc-erp']),
  caddyLog: () => run('journalctl', ['-u', 'caddy', '-n', '8', '--no-pager', '-o', 'cat']).trim(),
};

const readOr = (file, fallback) => { try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; } };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Files Caddy (its own account) and systemd read: always 0644, whatever the umask of the process that
// runs this (the deploy runs with umask 077, which would make them unreadable to Caddy).
function writeReadable(file, text) {
  fs.writeFileSync(file, text, { mode: 0o644 });
  fs.chmodSync(file, 0o644);
}

// Installs a Caddyfile: validated first, the old one kept, put back if Caddy refuses it.
function installCaddyfile(file, text, sys, log) {
  const old = readOr(file, null);
  let unreadable = false;
  try { unreadable = (fs.statSync(file).mode & 0o044) !== 0o044; } catch { /* no file yet */ }
  if (old === text) {
    // The same settings, but a file Caddy may not be able to read (0.73.1's first deploy): fix that.
    if (unreadable) { fs.chmodSync(file, 0o644); log(`${file} is readable by Caddy again.`); return true; }
    return false;
  }
  const tmp = `${file}.new`;
  writeReadable(tmp, text);
  try { sys.validate(tmp); } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Caddy refused the new settings, so nothing was changed. ${String(e.stderr || e.message).trim()}`);
  }
  if (old !== null) writeReadable(`${file}.before-${stamp()}`, old);
  fs.renameSync(tmp, file);
  try { sys.reloadCaddy(); } catch (e) {
    if (old !== null) { writeReadable(file, old); try { sys.reloadCaddy(); } catch { /* reported below */ } }
    let why = '';
    try { why = sys.caddyLog ? `\nCaddy's last messages:\n${sys.caddyLog()}` : ''; } catch { /* none */ }
    throw new Error(`Caddy did not reload, so the previous settings were put back. ${String(e.stderr || e.message).trim()}${why}`);
  }
  log(`HTTPS settings updated (${file}).`);
  return true;
}

async function apply(opts = {}) {
  const log = opts.log || ((m) => console.log(m));
  const sys = opts.system || system;
  const caddyfile = opts.caddyfile || '/etc/caddy/Caddyfile';
  const dropIn = opts.dropIn || '/etc/systemd/system/ltdc-erp.service.d/address.conf';
  const addresses = parseAddresses(fs.readFileSync(opts.file, 'utf8'));
  const main = addresses[0];
  const publicIp = opts.publicIp !== undefined ? opts.publicIp : await findPublicIp();
  const { live, notes } = await checkAddresses(addresses, { resolve: opts.resolve || systemResolve, publicIp });
  notes.forEach((n) => log(n));
  if (!live.length) {
    log('No address points at this server right now (a DNS problem?), so nothing was changed.');
    return { changed: false, live, mode: 'unchanged' };
  }

  // The app's host name check: every listed address (one with no DNS yet is harmless to allow).
  let appChanged = false;
  const want = renderDropIn(addresses);
  if (readOr(dropIn, null) !== want) {
    fs.mkdirSync(path.dirname(dropIn), { recursive: true });
    writeReadable(dropIn, want);
    sys.daemonReload();
    if (opts.restart) sys.restartApp();
    appChanged = true;
    log(`The app answers to: ${addresses.join(', ')}${opts.restart ? ' (restarted)' : ' (from its next start)'}.`);
  }

  const works = opts.certificateWorks || certificateWorks;
  const mainLive = live.includes(main);
  let mode = mainLive && live.length > 1 && (await works(main)) ? 'redirect' : 'serve';
  let changed = installCaddyfile(caddyfile, renderCaddyfile({ served: live, redirectTo: mode === 'redirect' ? main : null }), sys, log);
  if (mode === 'serve' && mainLive && live.length > 1) {
    // A new main address: give Caddy time to get its certificate, then send the others to it.
    const waitMs = opts.waitMs ?? 90000;
    const step = opts.stepMs ?? 5000;
    for (let t = 0; t <= waitMs; t += step) {
      if (await works(main)) {
        mode = 'redirect';
        changed = installCaddyfile(caddyfile, renderCaddyfile({ served: live, redirectTo: main }), sys, log) || changed;
        break;
      }
      if (t < waitMs) await sleep(step);
    }
    if (mode !== 'redirect') log(`The HTTPS certificate for ${main} is not ready yet, so ${live.filter((n) => n !== main).join(', ')} keep working as they are. Run sudo ltdc-erp-address again in a few minutes (or deploy again).`);
  }
  if (mode === 'redirect') log(`Main address: https://${main}. ${live.filter((n) => n !== main).join(', ')} send visitors there.`);
  else log(`Serving: ${live.map((n) => `https://${n}`).join(', ')}.`);
  if (!changed && !appChanged) log('The web address settings were already up to date.');
  return { changed: changed || appChanged, live, mode };
}

module.exports = { parseAddresses, renderCaddyfile, renderDropIn, checkAddresses, apply };

if (require.main === module) {
  const args = process.argv.slice(2);
  const deploy = args.includes('--deploy'); // from remote-deploy.sh: update.sh restarts the app
  const file = args.find((a) => !a.startsWith('--')) || '/opt/ltdc-erp/deploy/aws/site-address';
  if (process.getuid && process.getuid() !== 0) { console.log('Run it with sudo: sudo ltdc-erp-address'); process.exit(1); }
  apply({ file, restart: !deploy }).then(() => process.exit(0), (e) => { console.log(e.message); process.exit(1); });
}
