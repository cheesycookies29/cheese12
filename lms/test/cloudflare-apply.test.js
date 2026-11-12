// The server half of "Set up Cloudflare for me": deploy/aws/cloudflare-apply.sh (installed on the
// server as /usr/local/sbin/ltdc-lms-cloudflare, run as root). Here it runs without root and
// without a network, in a temporary folder, with stand-ins for systemctl, caddy, curl, nft, chown
// and sleep: the only commands on its PATH are those stand-ins and ordinary file tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AWS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'aws');
const SCRIPT = path.join(AWS, 'cloudflare-apply.sh');
const TEMPLATE = path.join(AWS, 'Caddyfile');
const RANGES = path.join(AWS, 'cloudflare-ips.txt');
const DUCK = 'testschool.duckdns.org';
const HOST = 'atlas.school.edu.ph';
const TOOLS = ['bash', 'sed', 'tail', 'tr', 'cat', 'cmp', 'cp', 'mv', 'rm', 'mkdir', 'mktemp', 'dirname', 'basename',
  'chmod', 'install', 'seq', 'grep', 'od', 'date', 'id', 'flock', 'env', 'cut', 'head', 'touch'];
const which = (t) => spawnSync('sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
const canRun = process.platform !== 'win32' && TOOLS.every((t) => which(t).startsWith('/'));
const skip = canRun ? false : 'needs bash and the usual Linux tools';

const bundled = fs.readFileSync(RANGES, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const plainCaddyfile = fs.readFileSync(TEMPLATE, 'utf8').split('\n').map((l) => l.replace('__DOMAIN__', DUCK)).join('\n');
const APP_ENV = `NODE_ENV=production\nHOST=127.0.0.1\nPORT=3100\nCOOKIE_SECURE=1\nALLOWED_HOSTS=${DUCK}\nSETUP_CODE=river-mango-2026\nOIDC_CLIENT_SECRET=abc\n`;

const STUBS = {
  systemctl: `echo "systemctl $*" >> "$STUB_LOG"
[ "$1" = reload ] && [ "\${STUB_RELOAD:-ok}" != ok ] && exit 1
# An administrator clicks again while the first request is being applied.
if [ "$1" = reload ] && [ -n "\${STUB_NEXT:-}" ] && [ -f "$STUB_NEXT" ]; then mv -f "$STUB_NEXT" "$LTDC_CF_DATA_DIR/cloudflare.json"; fi
exit 0`,
  caddy: `echo "caddy $*" >> "$STUB_LOG"
[ "$1" = validate ] || exit 0
[ "\${STUB_CADDY:-ok}" = ok ] && exit 0
echo "Error: adapting config using caddyfile: unrecognized directive" >&2; exit 1`,
  nft: `echo "nft $*" >> "$STUB_LOG"
case "$*" in
  "list table inet ltdc_cloudflare") [ -f "$STUB_DIR/nft-table" ] ;;
  "delete table inet ltdc_cloudflare") rm -f "$STUB_DIR/nft-table" ;;
  "-f "*) cp "$2" "$STUB_DIR/nft-applied.nft"; [ "\${STUB_NFT:-ok}" = ok ] || exit 1; touch "$STUB_DIR/nft-table" ;;
  *) exit 1 ;;
esac`,
  chown: 'echo "chown $*" >> "$STUB_LOG"',
  sleep: 'exit 0',
  setpriv: 'echo "setpriv must not run in tests" >> "$STUB_LOG"; exit 1',
  curl: `url="" out="" hdr="" resolve=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -D) hdr="$2"; shift 2 ;;
    --resolve) resolve="$2"; shift 2 ;;
    --max-time) shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
echo "curl $url\${resolve:+ resolve=$resolve}" >> "$STUB_LOG"
case "$url" in
  https://www.cloudflare.com/ips-v*)
    case "\${STUB_IPS:-fail}" in
      ok) if [ "$url" = https://www.cloudflare.com/ips-v4 ]; then grep -E '^[0-9]+[.]' "$STUB_RANGES" > "$out"; echo 198.51.100.0/24 >> "$out"
          else grep -E '^[0-9a-f]+:' "$STUB_RANGES" > "$out"; fi; exit 0 ;;
      bad) echo '<html>Blocked</html>' > "$out"; exit 0 ;;
      *) exit 6 ;;
    esac ;;
  http://127.0.0.1:3100/healthz) [ "\${STUB_APP:-ok}" = ok ]; exit $? ;;
esac
if [ -n "$resolve" ]; then [ "\${STUB_CERT:-ok}" = ok ]; exit $?; fi
nonce="$(grep -o 'respond "[0-9a-f]*"' "$LTDC_CF_CADDY_DIR/Caddyfile" | cut -d'"' -f2)"
case "\${STUB_EDGE:-fail}" in
  ok) printf 'HTTP/2 200\\r\\ncf-ray: 8f00aa11-SIN\\r\\n\\r\\n' > "$hdr"; echo "$nonce" > "$out" ;;
  noray) printf 'HTTP/2 200\\r\\nserver: Caddy\\r\\n\\r\\n' > "$hdr"; echo "$nonce" > "$out" ;;
  other) printf 'HTTP/2 200\\r\\ncf-ray: 8f00aa11-SIN\\r\\n\\r\\n' > "$hdr"; echo "someone else's site" > "$out" ;;
  *) exit 6 ;;
esac`,
};

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-cf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = (...a) => path.join(dir, ...a);
  for (const d of ['etc', 'caddy', 'data', 'state', 'stubs', 'bin', 'outside']) fs.mkdirSync(p(d));
  fs.writeFileSync(p('etc', 'server.env'), `LMS_DOMAIN=${DUCK}\nDUCKDNS_TOKEN=00000000-0000-0000-0000-000000000000\n`, { mode: 0o600 });
  fs.writeFileSync(p('etc', 'app.env'), APP_ENV, { mode: 0o640 });
  fs.chmodSync(p('etc', 'app.env'), 0o640);
  fs.writeFileSync(p('caddy', 'Caddyfile'), plainCaddyfile, { mode: 0o644 });
  for (const tool of TOOLS) fs.symlinkSync(which(tool), p('bin', tool));
  for (const [name, body] of Object.entries(STUBS)) fs.writeFileSync(p('stubs', name), `#!${which('bash')}\n${body}\n`, { mode: 0o755 });
  const sb = {
    dir, p,
    read: (...a) => fs.readFileSync(p(...a), 'utf8'),
    log: () => (fs.existsSync(p('stub.log')) ? sb.read('stub.log') : ''),
    status: () => JSON.parse(sb.read('data', 'cloudflare-status.json')),
    request(r) {
      fs.writeFileSync(p('data', 'cloudflare.json'), typeof r === 'string' ? r : JSON.stringify({
        version: 1, hostname: HOST, lockOrigin: false, requestedAt: nextTime(), requestedBy: 'Ada Admin', ...r,
      }));
    },
    run(env = {}, ...args) {
      fs.rmSync(p('stub.log'), { force: true });
      const r = spawnSync(which('bash'), [SCRIPT, ...args], {
        encoding: 'utf8',
        timeout: 60000,
        env: {
          PATH: `${p('stubs')}:${p('bin')}`,
          LTDC_CF_TEST: '1',
          LTDC_CF_DATA_DIR: p('data'),
          LTDC_CF_ETC_DIR: p('etc'),
          LTDC_CF_CADDY_DIR: p('caddy'),
          LTDC_CF_RANGES_FILE: RANGES,
          LTDC_CF_TEMPLATE: TEMPLATE,
          LTDC_CF_STATE_DIR: p('state'),
          LTDC_CF_LOCK: p('state', 'lock'),
          LTDC_CF_NODE: process.execPath,
          LTDC_CF_CERT_TRIES: '3',
          LTDC_CF_EDGE_TRIES: '2',
          STUB_LOG: p('stub.log'),
          STUB_DIR: dir,
          STUB_RANGES: RANGES,
          ...env,
        },
      });
      return { code: r.status, out: `${r.stdout}${r.stderr}`, log: sb.log() };
    },
  };
  return sb;
}

let clock = Date.parse('2026-11-12T05:00:00.000Z');
const nextTime = () => new Date((clock += 1000)).toISOString(); // each request is a new one

const caddyfileFrom = (sb) => sb.read('caddy', 'Caddyfile');
const siteBlock = (caddyfile, name) => {
  const start = caddyfile.indexOf(`\n${name} {`);
  return start < 0 ? '' : caddyfile.slice(start, caddyfile.indexOf('\n}', start) + 2);
};

test('the scripts are valid bash (and pass shellcheck where it is installed)', { skip }, () => {
  const scripts = ['cloudflare-apply.sh', 'install-cloudflare.sh', 'upgrade-server.sh', 'server-setup.sh'];
  for (const f of [...scripts, 'update.sh']) {
    const r = spawnSync(which('bash'), ['-n', path.join(AWS, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
  if (which('shellcheck')) {
    const r = spawnSync('shellcheck', scripts.map((f) => path.join(AWS, f)), { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
  }
});

test('a request puts Cloudflare in front: Caddy, app.env, the answer for the Admin panel', { skip }, (t) => {
  const sb = sandbox(t);
  const requestedAt = '2026-11-12T04:00:00.000Z';
  sb.request({ requestedAt });
  const r = sb.run({ STUB_EDGE: 'ok' });
  assert.equal(r.code, 0, r.out);

  const cf = caddyfileFrom(sb);
  const site = siteBlock(cf, HOST);
  assert.ok(site, cf);
  // The visitor's address: CF-Connecting-IP only from Cloudflare's ranges, the connection's own otherwise.
  const matcher = /@cloudflare \{\n\t\tremote_ip ([^\n]+)\n\t\theader_regexp CF-Connecting-IP \^\[0-9A-Fa-f:\.\]\+\$\n\t\}/.exec(site);
  assert.ok(matcher, site);
  assert.deepEqual(matcher[1].split(' ').sort(), [...bundled].sort(), 'every Cloudflare range, and nothing else');
  assert.match(site, /handle @cloudflare \{\n\t\treverse_proxy 127\.0\.0\.1:3100 \{\n\t\t\theader_up X-Forwarded-For \{http\.request\.header\.CF-Connecting-IP\}/);
  assert.match(site, /\thandle \{\n\t\treverse_proxy 127\.0\.0\.1:3100 \{\n\t\t\theader_up X-Forwarded-For \{http\.request\.remote\.host\}/);
  assert.match(site, /Strict-Transport-Security "max-age=31536000"/);
  assert.match(site, /output file \/var\/log\/caddy\/access\.log/);
  assert.match(site, /encode gzip/);
  // Ubuntu 24.04's Caddy 2.6.2 does not know these; using them would fail "caddy validate".
  assert.doesNotMatch(cf, /trusted_proxies|client_ip_headers|\{client_ip\}/);
  // The DuckDNS address is kept, as a permanent redirect.
  assert.match(siteBlock(cf, DUCK), new RegExp(`redir https://${HOST.replace(/\./g, '\\.')}\\{uri\\} permanent`));
  assert.equal(fs.statSync(sb.p('caddy', 'Caddyfile')).mode & 0o777, 0o644);

  // app.env: the two settings changed, every other line kept in its place, mode kept.
  assert.equal(sb.read('etc', 'app.env'), APP_ENV.replace(`ALLOWED_HOSTS=${DUCK}\n`, `ALLOWED_HOSTS=${DUCK},${HOST}\nPUBLIC_URL=https://${HOST}\n`));
  assert.equal(fs.statSync(sb.p('etc', 'app.env')).mode & 0o777, 0o640);

  // Checked before it is used; ATLAS restarted (its settings changed), Caddy reloaded.
  const lines = r.log.split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));
  assert.ok(at(/^caddy validate --adapter caddyfile --config /) >= 0, r.log);
  assert.ok(at(/^caddy validate/) < at(/^systemctl reload caddy$/), r.log);
  assert.ok(at(/^systemctl restart ltdc-lms$/) >= 0, r.log);
  assert.ok(at(new RegExp(`^curl https://${HOST}/healthz resolve=${HOST}:443:127\\.0\\.0\\.1$`)) >= 0, r.log);
  assert.doesNotMatch(r.log, /^nft -f/m, 'no lock was asked for');
  assert.match(r.out, /using .*cloudflare-ips\.txt/, 'no network: the list that comes with the script');

  // The answer, exactly in the agreed shape.
  const s = sb.status();
  assert.deepEqual(Object.keys(s).sort(), ['appliedAt', 'certificate', 'hostname', 'message', 'originLocked', 'requestedAt', 'state', 'throughCloudflare', 'version']);
  assert.equal(s.version, 1);
  assert.equal(s.state, 'active');
  assert.equal(s.hostname, HOST);
  assert.equal(s.requestedAt, requestedAt);
  assert.ok(!Number.isNaN(Date.parse(s.appliedAt)));
  assert.equal(s.certificate, true);
  assert.equal(s.throughCloudflare, true);
  assert.equal(s.originLocked, false);
  assert.match(s.message, /^Cloudflare is in front of atlas\.school\.edu\.ph\. Visitors can still reach the server directly/);
  assert.equal(fs.statSync(sb.p('data', 'cloudflare-status.json')).mode & 0o777, 0o640);
  assert.equal(fs.statSync(sb.p('state', 'status.json')).mode & 0o777, 0o600, 'its own record is root-only');
  assert.deepEqual(fs.readdirSync(sb.p('data')).sort(), ['cloudflare-status.json', 'cloudflare.json'], 'no temporary files left behind');

  // The same request again (a path re-trigger, or a restart): nothing is redone.
  const again = sb.run({ STUB_EDGE: 'ok' });
  assert.equal(again.code, 0, again.out);
  assert.doesNotMatch(again.log, /caddy validate|systemctl/);
  assert.match(again.out, /already applied/);
});

test('the current ranges are fetched from Cloudflare when the server can; a bad answer falls back to the list', { skip }, (t) => {
  const sb = sandbox(t);
  sb.request({});
  let r = sb.run({ STUB_EDGE: 'ok', STUB_IPS: 'ok' });
  assert.equal(r.code, 0, r.out);
  assert.match(caddyfileFrom(sb), /remote_ip [^\n]*198\.51\.100\.0\/24/, 'the fetched list is used');
  assert.match(r.log, /curl https:\/\/www\.cloudflare\.com\/ips-v4/);

  sb.request({});
  r = sb.run({ STUB_EDGE: 'ok', STUB_IPS: 'bad' });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(caddyfileFrom(sb), /198\.51\.100\.0/, 'an answer that is not a list of ranges is not used');
  assert.match(r.out, /using .*cloudflare-ips\.txt/);
});

test('only through Cloudflare: the firewall table is applied once the site answers through Cloudflare', { skip }, (t) => {
  const sb = sandbox(t);
  sb.request({ lockOrigin: true });
  const r = sb.run({ STUB_EDGE: 'ok' });
  assert.equal(r.code, 0, r.out);
  const rules = sb.read('nft-applied.nft');
  // Its own table only: never the whole rule set, never another table.
  assert.deepEqual([...rules.matchAll(/^\s*(?:add |delete |flush )?table (\S+ \S+)/gm)].map((m) => m[1]), ['inet ltdc_cloudflare', 'inet ltdc_cloudflare', 'inet ltdc_cloudflare']);
  assert.doesNotMatch(rules, /flush ruleset|flush table|ip filter|inet filter/);
  assert.match(rules, /type filter hook input priority filter; policy accept;/);
  assert.match(rules, /iifname "lo" accept/);
  assert.match(rules, /tcp dport \{ 80, 443 \} ip saddr @cloudflare4 accept\n\t\ttcp dport \{ 80, 443 \} ip6 saddr @cloudflare6 accept\n\t\ttcp dport \{ 80, 443 \} drop/);
  for (const range of bundled) assert.ok(rules.includes(range), range);
  const s = sb.status();
  assert.equal(s.state, 'active');
  assert.equal(s.originLocked, true);
  assert.equal(s.throughCloudflare, true);
  assert.match(s.message, /only accepts visitors that come through Cloudflare/);
  // The DuckDNS address cannot renew its certificate behind the lock: it is left out of Caddy.
  assert.equal(siteBlock(caddyfileFrom(sb), DUCK), '');
  assert.ok(siteBlock(caddyfileFrom(sb), HOST));

  // After a restart the table is gone; the boot run puts it back from its own record.
  fs.rmSync(sb.p('nft-applied.nft'));
  fs.rmSync(sb.p('nft-table'));
  const boot = sb.run({});
  assert.equal(boot.code, 0, boot.out);
  assert.ok(fs.existsSync(sb.p('nft-table')), boot.out);
  assert.doesNotMatch(boot.log, /caddy validate|systemctl/);

  // A planted answer saying "not locked" changes nothing: the record that counts is root's own.
  fs.writeFileSync(sb.p('data', 'cloudflare-status.json'), JSON.stringify({ ...s, originLocked: false }));
  fs.rmSync(sb.p('nft-table'));
  sb.run({});
  assert.ok(fs.existsSync(sb.p('nft-table')));
});

test('only through Cloudflare, but the site does not answer through Cloudflare: the server stays open', { skip }, (t) => {
  for (const edge of ['noray', 'other', 'fail']) {
    const sb = sandbox(t);
    sb.request({ lockOrigin: true });
    const r = sb.run({ STUB_EDGE: edge });
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.log, /^nft -f/m, edge);
    assert.ok(!fs.existsSync(sb.p('nft-table')), edge);
    const s = sb.status();
    assert.equal(s.state, 'active', edge);
    assert.equal(s.certificate, true, edge);
    assert.equal(s.throughCloudflare, false, edge);
    assert.equal(s.originLocked, false, edge);
    assert.match(s.message, /not reaching it through Cloudflare yet, so the server still accepts visitors directly/, edge);
    assert.ok(siteBlock(caddyfileFrom(sb), DUCK), 'the DuckDNS redirect stays');
  }
});

test('lock asked for while a lock is on, but the check fails: the lock is taken off', { skip }, (t) => {
  const sb = sandbox(t);
  sb.request({ lockOrigin: true });
  sb.run({ STUB_EDGE: 'ok' });
  assert.ok(fs.existsSync(sb.p('nft-table')));
  sb.request({ lockOrigin: true });
  sb.run({ STUB_EDGE: 'noray' });
  assert.ok(!fs.existsSync(sb.p('nft-table')));
  assert.equal(sb.status().originLocked, false);
  // Lock no longer asked for: the table goes at once.
  sb.request({ lockOrigin: true });
  sb.run({ STUB_EDGE: 'ok' });
  assert.ok(fs.existsSync(sb.p('nft-table')));
  sb.request({ lockOrigin: false });
  const r = sb.run({ STUB_EDGE: 'ok' });
  assert.match(r.log, /^nft delete table inet ltdc_cloudflare$/m);
  assert.ok(!fs.existsSync(sb.p('nft-table')));
  assert.equal(sb.status().originLocked, false);
  assert.ok(siteBlock(caddyfileFrom(sb), DUCK), 'the DuckDNS redirect is back');
});

test('a request written while another is being applied is applied next', { skip }, (t) => {
  const sb = sandbox(t);
  sb.request({});
  const next = sb.p('outside', 'next.json');
  fs.writeFileSync(next, JSON.stringify({ version: 1, hostname: '', lockOrigin: false, requestedAt: nextTime() }));
  const second = JSON.parse(fs.readFileSync(next, 'utf8')).requestedAt;
  const r = sb.run({ STUB_EDGE: 'ok', STUB_NEXT: next });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /A new request arrived meanwhile/);
  const s = sb.status();
  assert.equal(s.requestedAt, second);
  assert.equal(s.state, 'off');
  assert.equal(caddyfileFrom(sb), plainCaddyfile);
});

test('a request that is not valid keeps what was applied before, firewall included', { skip }, (t) => {
  const sb = sandbox(t);
  sb.request({ lockOrigin: true });
  assert.equal(sb.run({ STUB_EDGE: 'ok' }).code, 0);
  const before = caddyfileFrom(sb);
  fs.rmSync(sb.p('nft-table')); // a restart
  sb.request({ hostname: 'evil;name' });
  const r = sb.run({ STUB_EDGE: 'ok' });
  assert.equal(r.code, 1, r.out);
  assert.ok(fs.existsSync(sb.p('nft-table')), 'the lock is put back');
  const s = sb.status();
  assert.equal(s.state, 'failed');
  assert.equal(s.hostname, HOST, 'what the server still does');
  assert.equal(s.originLocked, true);
  assert.equal(caddyfileFrom(sb), before);
});

test('no certificate yet: failed with a plain message, and the firewall is left open', { skip }, (t) => {
  const sb = sandbox(t);
  sb.request({ lockOrigin: true });
  const r = sb.run({ STUB_CERT: 'fail', STUB_EDGE: 'ok' });
  assert.equal(r.code, 1, r.out);
  const s = sb.status();
  assert.equal(s.state, 'failed');
  assert.equal(s.certificate, false);
  assert.equal(s.originLocked, false);
  assert.match(s.message, /could not get the security certificate yet/);
  assert.doesNotMatch(r.log, /^nft -f/m);
});

test('a lock with nftables missing is reported, not pretended', { skip }, (t) => {
  const sb = sandbox(t);
  fs.rmSync(sb.p('stubs', 'nft'));
  sb.request({ lockOrigin: true });
  const r = sb.run({ STUB_EDGE: 'ok' });
  assert.equal(r.code, 0, r.out);
  const s = sb.status();
  assert.equal(s.originLocked, false);
  assert.match(s.message, /nftables\) is missing/);
});

test('switching off puts back the original Caddyfile and app.env and removes the firewall table', { skip }, (t) => {
  const sb = sandbox(t);
  sb.request({ lockOrigin: true });
  assert.equal(sb.run({ STUB_EDGE: 'ok' }).code, 0);
  assert.notEqual(caddyfileFrom(sb), plainCaddyfile);
  sb.request({ hostname: '', lockOrigin: false });
  const r = sb.run({});
  assert.equal(r.code, 0, r.out);
  assert.equal(caddyfileFrom(sb), plainCaddyfile, 'byte for byte what server-setup.sh writes');
  assert.equal(sb.read('etc', 'app.env'), APP_ENV);
  assert.match(r.log, /^nft delete table inet ltdc_cloudflare$/m);
  assert.ok(!fs.existsSync(sb.p('nft-table')));
  const s = sb.status();
  assert.equal(s.state, 'off');
  assert.equal(s.hostname, '');
  assert.equal(s.originLocked, false);
  assert.equal(s.message, `Cloudflare is off. ATLAS answers at https://${DUCK} directly.`);
  // Switching off when it was never on changes nothing.
  sb.request({ hostname: '' });
  const idle = sb.run({});
  assert.equal(idle.code, 0, idle.out);
  assert.doesNotMatch(idle.log, /systemctl/);
});

test('--print-plain-caddyfile gives what server-setup.sh has always written', { skip }, (t) => {
  const sb = sandbox(t);
  const r = spawnSync(which('bash'), [SCRIPT, '--print-plain-caddyfile'], {
    encoding: 'utf8', env: { PATH: `${sb.p('stubs')}:${sb.p('bin')}`, LTDC_CF_ETC_DIR: sb.p('etc'), LTDC_CF_TEMPLATE: TEMPLATE, LTDC_CF_NODE: process.execPath },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, plainCaddyfile);
  const sed = spawnSync(which('sed'), [`s/__DOMAIN__/${DUCK}/`, TEMPLATE], { encoding: 'utf8' });
  assert.equal(r.stdout, sed.stdout);
});

test('requests that are not valid change nothing and are answered "failed"', { skip }, (t) => {
  const sb = sandbox(t);
  const bad = [
    ['atlas.school.edu.ph;reboot', /not a valid website address/],
    ['atlas.school.edu.ph\nevil.example', /not a valid website address/],
    [`$(touch ${sb.p('pwned')}).school.ph`, /not a valid website address/],
    ['`touch pwned`.school.ph', /not a valid website address/],
    ['a{b}.school.ph', /not a valid website address/],
    ['atlas.school.ph {\n\trespond hi\n}\nx.ph', /not a valid website address/],
    ['Atlas.School.edu.ph', /not a valid website address/],
    ['atlas.school.edu.ph ', /not a valid website address/],
    ['-atlas.school.ph', /not a valid website address/],
    ['atlas..school.ph', /not a valid website address/],
    ['localhost', /not a valid website address/],
    [`${'a'.repeat(64)}.school.ph`, /not a valid website address/],
    [`${'abcdefghi.'.repeat(26)}ph`, /not a valid website address/],
    ['*.school.ph', /not a valid website address/],
    ['school.123', /not a valid website address/],
    ['203.0.113.5', /not an IP address/],
    ['::1', /not an IP address/],
    ['[2001:db8::1]', /not an IP address/],
    [DUCK, /DuckDNS address/],
  ];
  const others = [
    [{ version: 2 }, /different version/],
    [{ version: '1' }, /different version/],
    [{ lockOrigin: 'true' }, /lockOrigin/],
    [{ lockOrigin: undefined }, /lockOrigin/],
    [{ hostname: 42 }, /no address/],
    [{ requestedAt: 'yesterday' }, /no valid time/],
    [{ requestedAt: `2026-11-12T05:00:00.${'0'.repeat(40)}Z` }, /no valid time/],
  ];
  const cases = [...bad.map(([hostname, re]) => [{ hostname }, re]), ...others, ['{"version":1,', /not valid JSON/], ['[1]', /could not be read/], ['null', /could not be read/]];
  for (const [req, re] of cases) {
    const label = JSON.stringify(req);
    sb.request(req);
    const r = sb.run({ STUB_EDGE: 'ok' });
    assert.equal(r.code, 1, `${label}: ${r.out}`);
    const s = sb.status();
    assert.equal(s.state, 'failed', label);
    assert.match(s.message, re, label);
    assert.match(s.message, /Nothing was changed\.$/, label);
    assert.equal(caddyfileFrom(sb), plainCaddyfile, label);
    assert.equal(sb.read('etc', 'app.env'), APP_ENV, label);
    assert.doesNotMatch(r.log, /systemctl|caddy|nft -f/, label);
    assert.ok(!fs.existsSync(sb.p('pwned')), label);
    if (typeof req === 'object' && !('requestedAt' in req)) assert.ok(s.requestedAt, `${label}: the time is echoed so the Admin panel stops waiting`);
  }
});

test('a request that is too large, a link, or not a file is ignored', { skip }, (t) => {
  const sb = sandbox(t);
  const req = sb.p('data', 'cloudflare.json');
  sb.request({ requestedBy: 'x'.repeat(5000) });
  let r = sb.run({ STUB_EDGE: 'ok' });
  assert.equal(r.code, 1, r.out);
  assert.match(sb.status().message, /larger than expected/);

  fs.rmSync(req);
  const elsewhere = sb.p('outside', 'request.json');
  fs.writeFileSync(elsewhere, JSON.stringify({ version: 1, hostname: HOST, lockOrigin: false, requestedAt: new Date().toISOString() }));
  fs.symlinkSync(elsewhere, req);
  r = sb.run({ STUB_EDGE: 'ok' });
  assert.equal(r.code, 1, r.out);
  assert.match(sb.status().message, /is a link/);

  fs.rmSync(req);
  fs.mkdirSync(req);
  r = sb.run({ STUB_EDGE: 'ok' });
  assert.equal(r.code, 1, r.out);
  assert.match(sb.status().message, /not a plain file/);
  assert.equal(caddyfileFrom(sb), plainCaddyfile);
  assert.equal(sb.read('etc', 'app.env'), APP_ENV);
  assert.doesNotMatch(r.log, /systemctl/);
});

test('no request yet: nothing is done and no answer is written', { skip }, (t) => {
  const sb = sandbox(t);
  const r = sb.run({});
  assert.equal(r.code, 0, r.out);
  assert.ok(!fs.existsSync(sb.p('data', 'cloudflare-status.json')));
  assert.doesNotMatch(r.log, /systemctl|caddy/);
});

test('the answer replaces a link planted in its place instead of writing through it', { skip }, (t) => {
  const sb = sandbox(t);
  const victim = sb.p('outside', 'important.txt');
  fs.writeFileSync(victim, 'keep me\n', { mode: 0o600 });
  fs.symlinkSync(victim, sb.p('data', 'cloudflare-status.json'));
  sb.request({ hostname: 'bad;name' });
  sb.run({});
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me\n');
  assert.equal(fs.statSync(victim).mode & 0o777, 0o600);
  assert.ok(fs.lstatSync(sb.p('data', 'cloudflare-status.json')).isFile());

  fs.rmSync(sb.p('data', 'cloudflare-status.json'));
  fs.symlinkSync(victim, sb.p('data', 'cloudflare-status.json'));
  sb.request({});
  assert.equal(sb.run({ STUB_EDGE: 'ok' }).code, 0);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me\n');
  assert.equal(sb.status().state, 'active');
});

test('Caddy refuses the new settings: the old Caddyfile and app.env are kept', { skip }, (t) => {
  const sb = sandbox(t);
  sb.request({});
  const r = sb.run({ STUB_CADDY: 'fail', STUB_EDGE: 'ok' });
  assert.equal(r.code, 1, r.out);
  assert.equal(caddyfileFrom(sb), plainCaddyfile);
  assert.equal(sb.read('etc', 'app.env'), APP_ENV);
  assert.doesNotMatch(r.log, /systemctl/);
  const s = sb.status();
  assert.equal(s.state, 'failed');
  assert.equal(s.hostname, '');
  assert.match(s.message, /were not accepted, so nothing was changed/);
  assert.deepEqual(fs.readdirSync(sb.p('caddy')), ['Caddyfile'], 'no temporary file left behind');
});

test('Caddy does not take the new settings, or ATLAS does not start: the previous ones are put back', { skip }, (t) => {
  const sb = sandbox(t);
  sb.request({});
  let r = sb.run({ STUB_RELOAD: 'fail', STUB_EDGE: 'ok' });
  assert.equal(r.code, 1, r.out);
  assert.equal(caddyfileFrom(sb), plainCaddyfile);
  assert.equal(sb.read('etc', 'app.env'), APP_ENV);
  assert.match(sb.status().message, /did not take the new settings/);

  sb.request({});
  r = sb.run({ STUB_APP: 'fail', STUB_EDGE: 'ok' });
  assert.equal(r.code, 1, r.out);
  assert.equal(caddyfileFrom(sb), plainCaddyfile);
  assert.equal(sb.read('etc', 'app.env'), APP_ENV);
  assert.match(sb.status().message, /ATLAS did not start with the new settings/);
});

test('the server scripts install the helper, its units and the ranges, and keep an active set-up', () => {
  const read = (f) => fs.readFileSync(path.join(AWS, f), 'utf8');
  const installer = read('install-cloudflare.sh');
  // Root code and Caddy's template are copied out of the app's folder (which the app account owns).
  assert.match(installer, /install -m 750 "\$HERE\/cloudflare-apply\.sh" \/usr\/local\/sbin\/ltdc-lms-cloudflare/);
  assert.match(installer, /install -m 644 "\$HERE\/cloudflare-ips\.txt" \/usr\/local\/share\/ltdc-lms\/cloudflare-ips\.txt/);
  assert.match(installer, /install -m 644 "\$HERE\/Caddyfile" \/usr\/local\/share\/ltdc-lms\/Caddyfile\.template/);
  assert.match(installer, /ltdc-lms-cloudflare\.service" \/etc\/systemd\/system\/ltdc-lms-cloudflare\.service/);
  assert.match(installer, /ltdc-lms-cloudflare\.path" \/etc\/systemd\/system\/ltdc-lms-cloudflare\.path/);
  assert.match(installer, /systemctl daemon-reload\n[^]*systemctl enable ltdc-lms-cloudflare\.service\n[^]*systemctl enable --now ltdc-lms-cloudflare\.path/);
  assert.match(installer, /apt-get install -y -q nftables/);
  assert.doesNotMatch(installer, /systemctl (enable|start|restart)[^\n]* nftables/, "Ubuntu's own nftables.service is not switched on");
  for (const f of ['upgrade-server.sh', 'server-setup.sh']) {
    const src = read(f);
    assert.match(src, /bash "\$HERE\/install-cloudflare\.sh"/, f);
    assert.match(src, /if \[ -f "\$APP\/data\/cloudflare\.json" \]; then\n[^\n]*\n\s*\/usr\/local\/sbin\/ltdc-lms-cloudflare --force/, `${f}: an active set-up is applied again`);
  }
  const setup = read('server-setup.sh');
  assert.match(setup, /\/usr\/local\/sbin\/ltdc-lms-cloudflare --print-plain-caddyfile > \/etc\/caddy\/Caddyfile\.new/);
  assert.doesNotMatch(setup, /__DOMAIN__/, 'one way to write the plain Caddyfile');
  assert.doesNotMatch(read('update.sh'), /cloudflare/i, 'the automatic updater never installs root code');
  assert.match(read('ltdc-lms-cloudflare.path'), /^PathChanged=\/opt\/ltdc-lms\/data\/cloudflare\.json$/m);
  const service = read('ltdc-lms-cloudflare.service');
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^ExecStart=\/usr\/local\/sbin\/ltdc-lms-cloudflare$/m);
  assert.match(service, /^WantedBy=multi-user\.target$/m);
});
