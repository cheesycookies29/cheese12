// Changing the web address (0.73.1): deploy/aws/ltdc-erp-address.cjs writes Caddy's sites and the
// app's ALLOWED_HOSTS from deploy/aws/site-address. These tests run it against fake DNS, a fake Caddy
// and a temporary folder: nothing on this computer is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = new URL('..', import.meta.url).pathname;
const tool = createRequire(import.meta.url)(path.join(root, 'deploy/aws/ltdc-erp-address.cjs'));
const { parseAddresses, renderCaddyfile, apply } = tool;
const SERVER = '47.131.220.135';

test('the site-address file: the main address first, comments ignored, bad lines refused', () => {
  assert.deepEqual(parseAddresses(fs.readFileSync(path.join(root, 'deploy/aws/site-address'), 'utf8')), ['ltdc-erp.com', 'www.ltdc-erp.com', 'ltdc-erp.duckdns.org']);
  assert.deepEqual(parseAddresses('# x\n ERP.Example.com \nerp.example.com\n\nold.example.org # kept\n'), ['erp.example.com', 'old.example.org']);
  assert.throws(() => parseAddresses('https://erp.example.com/'), /not a web address/);
  assert.throws(() => parseAddresses('erp.example.com {\n'), /not a web address/);
  assert.throws(() => parseAddresses('# nothing\n'), /lists no address/);
});

test('the Caddy site is the same as the installation guide\'s Caddyfile, and the others redirect with their path', () => {
  const template = fs.readFileSync(path.join(root, 'deploy/aws/Caddyfile'), 'utf8');
  const site = template.slice(template.indexOf('erp.example.com {')).replace('erp.example.com', 'a.example.com');
  assert.ok(renderCaddyfile({ served: ['a.example.com'] }).endsWith(site), 'same headers and proxy as the guide');
  const both = renderCaddyfile({ served: ['a.example.com', 'b.example.com'] });
  assert.match(both, /^a\.example\.com, b\.example\.com \{$/m);
  assert.doesNotMatch(both, /redir/);
  const moved = renderCaddyfile({ served: ['a.example.com', 'b.example.com', 'c.example.org'], redirectTo: 'a.example.com' });
  assert.match(moved, /^a\.example\.com \{$/m);
  assert.match(moved, /^b\.example\.com \{\n\tredir https:\/\/a\.example\.com\{uri\} 308\n\}$/m);
  assert.match(moved, /^c\.example\.org \{\n\tredir https:\/\/a\.example\.com\{uri\} 308\n\}$/m);
  assert.equal((moved.match(/reverse_proxy/g) || []).length, 1, 'only the main address reaches the app');
});

function server(dns, { works = () => false, validate, reload } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-address-'));
  const file = path.join(dir, 'site-address');
  fs.writeFileSync(file, 'ltdc-erp.com\nwww.ltdc-erp.com\nltdc-erp.duckdns.org\n');
  const caddyfile = path.join(dir, 'Caddyfile');
  fs.writeFileSync(caddyfile, 'ltdc-erp.duckdns.org {\n\treverse_proxy 127.0.0.1:3000\n}\n');
  const calls = [];
  const lines = [];
  const system = {
    validate: (f) => { calls.push('validate'); if (validate) validate(fs.readFileSync(f, 'utf8')); },
    reloadCaddy: () => { calls.push('reload'); if (reload) reload(fs.readFileSync(caddyfile, 'utf8')); },
    daemonReload: () => calls.push('daemon-reload'),
    restartApp: () => calls.push('restart'),
  };
  const go = (extra = {}) => apply({
    file, caddyfile, dropIn: path.join(dir, 'ltdc-erp.service.d', 'address.conf'), publicIp: SERVER, system,
    resolve: async (name) => dns[name] || [], certificateWorks: async (name) => works(name), waitMs: 20, stepMs: 5,
    log: (m) => lines.push(m), ...extra,
  });
  return { dir, caddyfile, calls, lines, go, dropIn: () => fs.readFileSync(path.join(dir, 'ltdc-erp.service.d', 'address.conf'), 'utf8') };
}

test('today: ltdc-erp.com has no DNS yet, so the old address goes on as it is; the app already accepts all three', async () => {
  const s = server({ 'ltdc-erp.duckdns.org': [SERVER] });
  const r = await s.go();
  assert.equal(r.mode, 'serve');
  assert.deepEqual(r.live, ['ltdc-erp.duckdns.org']);
  const caddy = fs.readFileSync(s.caddyfile, 'utf8');
  assert.match(caddy, /^ltdc-erp\.duckdns\.org \{$/m);
  assert.doesNotMatch(caddy, /ltdc-erp\.com|redir/);
  assert.match(s.dropIn(), /^Environment=ALLOWED_HOSTS=ltdc-erp\.com,www\.ltdc-erp\.com,ltdc-erp\.duckdns\.org$/m);
  assert.ok(s.lines.some((l) => /ltdc-erp\.com has no DNS record yet/.test(l)));
  assert.ok(fs.readdirSync(s.dir).some((f) => f.startsWith('Caddyfile.before-')), 'the old Caddyfile is kept');
  // From a deploy (restart not asked), update.sh restarts the app; by hand, the tool does.
  assert.deepEqual(s.calls, ['daemon-reload', 'validate', 'reload']);
  // Run again with nothing new: nothing is written or reloaded.
  s.calls.length = 0;
  const again = await s.go();
  assert.equal(again.changed, false);
  assert.deepEqual(s.calls, []);
  assert.ok(s.lines.at(-1).includes('already up to date'));
});

test('Cloudflare proxy on (orange cloud): the address is left out and the fix is named', async () => {
  const s = server({ 'ltdc-erp.com': ['104.21.3.4', '172.67.1.2'], 'ltdc-erp.duckdns.org': [SERVER] });
  const r = await s.go();
  assert.deepEqual(r.live, ['ltdc-erp.duckdns.org']);
  assert.ok(s.lines.some((l) => l.includes('ltdc-erp.com points at 104.21.3.4, 172.67.1.2, not this server (47.131.220.135)') && l.includes('"DNS only" (grey cloud)')));
});

test('DNS ready: all are served while Caddy gets the certificate, then the old addresses send visitors to ltdc-erp.com', async () => {
  let polls = 0;
  const seen = [];
  const s = server({ 'ltdc-erp.com': [SERVER], 'www.ltdc-erp.com': [SERVER], 'ltdc-erp.duckdns.org': [SERVER] }, {
    works: (name) => name === 'ltdc-erp.com' && ++polls > 2,
    reload: (text) => seen.push(text),
  });
  const r = await s.go({ restart: true });
  assert.equal(r.mode, 'redirect');
  assert.equal(seen.length, 2);
  assert.match(seen[0], /^ltdc-erp\.com, www\.ltdc-erp\.com, ltdc-erp\.duckdns\.org \{$/m, 'first every address, so Caddy can get each certificate');
  assert.doesNotMatch(seen[0], /redir/);
  assert.match(seen[1], /^www\.ltdc-erp\.com \{\n\tredir https:\/\/ltdc-erp\.com\{uri\} 308/m);
  assert.match(seen[1], /^ltdc-erp\.duckdns\.org \{\n\tredir https:\/\/ltdc-erp\.com\{uri\} 308/m);
  assert.ok(s.calls.includes('restart'), 'by hand, the app is restarted for its new ALLOWED_HOSTS');
  assert.ok(s.lines.some((l) => l.startsWith('Main address: https://ltdc-erp.com.')));
});

test('the certificate is not ready in time: nothing redirects yet, and the message says what to do', async () => {
  const s = server({ 'ltdc-erp.com': [SERVER], 'ltdc-erp.duckdns.org': [SERVER] });
  const r = await s.go();
  assert.equal(r.mode, 'serve');
  assert.doesNotMatch(fs.readFileSync(s.caddyfile, 'utf8'), /redir/);
  assert.ok(s.lines.some((l) => /certificate for ltdc-erp\.com is not ready yet, so ltdc-erp\.duckdns\.org keep working/.test(l)));
});

test('Caddy refuses the settings, or the reload fails: the previous Caddyfile stays in use', async () => {
  const s = server({ 'ltdc-erp.duckdns.org': [SERVER] }, { validate: () => { throw Object.assign(new Error('x'), { stderr: 'bad config' }); } });
  const before = fs.readFileSync(s.caddyfile, 'utf8');
  await assert.rejects(s.go(), /Caddy refused the new settings, so nothing was changed\. bad config/);
  assert.equal(fs.readFileSync(s.caddyfile, 'utf8'), before);
  assert.ok(!fs.existsSync(`${s.caddyfile}.new`));

  let first = true;
  const t = server({ 'ltdc-erp.duckdns.org': [SERVER] }, { reload: () => { if (first) { first = false; throw new Error('reload failed'); } } });
  const old = fs.readFileSync(t.caddyfile, 'utf8');
  await assert.rejects(t.go(), /previous settings were put back/);
  assert.equal(fs.readFileSync(t.caddyfile, 'utf8'), old);
  assert.deepEqual(t.calls.filter((c) => c === 'reload').length, 2, 'reloaded again with the old settings');
});

test('no address points at the server (a DNS outage): nothing is changed', async () => {
  const s = server({});
  const before = fs.readFileSync(s.caddyfile, 'utf8');
  const r = await s.go();
  assert.equal(r.changed, false);
  assert.equal(fs.readFileSync(s.caddyfile, 'utf8'), before);
  assert.deepEqual(s.calls, []);
  assert.ok(s.lines.at(-1).includes('nothing was changed'));
});

test('every deploy installs and runs it before update.sh, and a problem with it never stops the deploy', () => {
  const src = fs.readFileSync(path.join(root, 'deploy/aws/remote-deploy.sh'), 'utf8');
  const run = src.indexOf('node "$SRC/deploy/aws/ltdc-erp-address.cjs" --deploy "$SRC/deploy/aws/site-address"');
  assert.ok(run > 0 && run < src.indexOf('bash "$SRC/deploy/aws/update.sh"'));
  assert.match(src, /install -m 755 "\$SRC\/deploy\/aws\/ltdc-erp-address\.cjs" \/usr\/local\/sbin\/ltdc-erp-address/);
  assert.match(src.slice(run), /^node .*\\\n\s+\|\| echo "The web address step did not finish/m);
  assert.ok(src.indexOf('DEPLOY_FREEZE') < run, 'a frozen deploy changes no address either');
});

test('the deploy runs with umask 077: the files Caddy and systemd read are still 0644, also when put back', async () => {
  const was = process.umask(0o077);
  try {
    const s = server({ 'ltdc-erp.duckdns.org': [SERVER] });
    await s.go();
    assert.equal(fs.statSync(s.caddyfile).mode & 0o777, 0o644);
    assert.equal(fs.statSync(path.join(s.dir, 'ltdc-erp.service.d', 'address.conf')).mode & 0o777, 0o644);

    let first = true;
    const t = server({ 'ltdc-erp.duckdns.org': [SERVER] }, { reload: () => { if (first) { first = false; throw new Error('reload failed'); } } });
    await assert.rejects(t.go(), /previous settings were put back/);
    assert.equal(fs.statSync(t.caddyfile).mode & 0o777, 0o644, 'the old settings, readable');

    // The state 0.73.1's first deploy left: the old settings in a file only root can read. The next
    // run puts the new settings in a readable file.
    const u = server({ 'ltdc-erp.duckdns.org': [SERVER] });
    fs.chmodSync(u.caddyfile, 0o600);
    await u.go();
    assert.equal(fs.statSync(u.caddyfile).mode & 0o777, 0o644);
    // And with the settings already up to date, only the permissions are fixed (no reload needed).
    fs.chmodSync(u.caddyfile, 0o600);
    u.calls.length = 0;
    const r = await u.go();
    assert.equal(r.changed, true);
    assert.equal(fs.statSync(u.caddyfile).mode & 0o777, 0o644);
    assert.deepEqual(u.calls, []);
  } finally { process.umask(was); }
});
