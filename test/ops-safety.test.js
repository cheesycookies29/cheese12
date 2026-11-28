// Event-day safety (0.71, before YEP 2026): the deploy freeze, the kept previous release and the
// rollback command, what CORE does with an error nobody caught, and the venue rate limits (a
// ballroom of phones behind one network address must not hit the generic signed-out limits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const root = new URL('..', import.meta.url).pathname;
const deploy = (app) => spawnSync('bash', [path.join(root, 'deploy/aws/remote-deploy.sh'), '/nonexistent', 'abc1234'], { env: { ...process.env, LTDC_APP: app }, encoding: 'utf8' });

test('deploy freeze: a frozen deploy changes nothing and fails the deploy; an ended freeze lets it go on', () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'core-freeze-'));
  fs.mkdirSync(path.join(app, 'data'));
  const freeze = path.join(app, 'data', 'DEPLOY_FREEZE');
  fs.writeFileSync(freeze, `${new Date(Date.now() + 86400000).toISOString()}\nYEP 2026\n`);
  const frozen = deploy(app);
  assert.equal(frozen.status, 3, frozen.stderr);
  assert.match(frozen.stdout, /Deploys are frozen until .* \(YEP 2026\)\. Nothing was changed\./);
  // An end time in the past: the guard lets the deploy continue (here it then stops, as this test
  // folder is not an installed CORE).
  fs.writeFileSync(freeze, '2020-01-01T00:00:00Z\nold\n');
  const ended = deploy(app);
  assert.match(ended.stdout, /The deploy freeze ended/);
  assert.equal(ended.status, 1);
  assert.match(ended.stdout, /not installed on this server yet/);
  // A file with no end time freezes until it is removed.
  fs.writeFileSync(freeze, '');
  assert.equal(deploy(app).status, 3);
  // No file: no freeze.
  fs.rmSync(freeze);
  assert.doesNotMatch(deploy(app).stdout, /frozen/);
  // The guard runs before anything is installed on the server.
  const src = fs.readFileSync(path.join(root, 'deploy/aws/remote-deploy.sh'), 'utf8');
  assert.ok(src.indexOf('DEPLOY_FREEZE') < src.indexOf('timedatectl'), 'the freeze check comes first');
});

test('the previous release is kept on every deploy, and ltdc-erp-rollback puts it back', () => {
  const update = fs.readFileSync(path.join(root, 'deploy/aws/update.sh'), 'utf8');
  const keep = update.indexOf('rsync -a --delete --exclude /data/ "$APP/" "$PREV/"');
  assert.ok(keep > 0 && keep < update.indexOf('systemctl stop ltdc-erp'), 'kept before the service stops');
  const remote = fs.readFileSync(path.join(root, 'deploy/aws/remote-deploy.sh'), 'utf8');
  assert.match(remote, /install -m 755 "\$SRC\/deploy\/aws\/ltdc-erp-rollback" \/usr\/local\/sbin\/ltdc-erp-rollback/);
  const rb = fs.readFileSync(path.join(root, 'deploy/aws/ltdc-erp-rollback'), 'utf8');
  assert.match(rb, /rsync -a --delete --exclude \/data\/ "\$PREV\/" "\$APP\/"/, 'the data folder is never touched');
  assert.match(rb, /chown -R ltdc:ltdc "\$APP\/data"/, 'the same ownership as update.sh');
  assert.equal(spawnSync('bash', ['-n', path.join(root, 'deploy/aws/ltdc-erp-rollback')]).status, 0);
  assert.ok(fs.statSync(path.join(root, 'deploy/aws/ltdc-erp-rollback')).mode & 0o100, 'executable');
});

const guarded = (code) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { installProcessGuards } from ${JSON.stringify(path.join(root, 'server/process-guard.js'))};
  const state = installProcessGuards({ log: (m) => console.log(m.split('\\n')[0]) });
  ${code}`], { encoding: 'utf8', timeout: 10000 });

test('an unhandled promise rejection is logged and counted, and CORE keeps serving', () => {
  const r = guarded(`Promise.reject(new Error('stray')); setTimeout(() => console.log('still serving', state.rejections), 50);`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Unhandled promise rejection \(CORE keeps running\): Error: stray/);
  assert.match(r.stdout, /still serving 1/);
});

test('an uncaught exception is logged, then CORE exits with code 1 for systemd to restart it', () => {
  const r = guarded(`setTimeout(() => { throw new Error('boom'); }, 10); setTimeout(() => console.log('should not run'), 200);`);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Uncaught exception: CORE stops now and systemd starts it again\. Error: boom/);
  assert.doesNotMatch(r.stdout, /should not run/);
});

test('venue rate limits: event guest pages do not use the generic signed-out limits', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-limits-'));
  const handle = createApi(openDb(path.join(dir, 'db.json')), { rateLimits: true });
  const call = (method, url) => handle({ method, headers: {}, socket: { remoteAddress: '203.0.113.9' } }, new URL(url, 'http://localhost'), {}).then(() => 200, (e) => e.status);
  // 30 posts from one address to the event's guest pages: never 429 (a 404 is fine: no event yet).
  for (let i = 0; i < 30; i++) assert.notEqual(await call('POST', '/api/public/event/yep26/verify'), 429);
  // 200 reads from one address: no 429 either (the generic signed-out limit is 120 a minute).
  for (let i = 0; i < 200; i++) assert.notEqual(await call('GET', '/api/public/event/yep26/status'), 429);
  // Other public pages keep their limit: the 21st post in an hour is refused.
  const other = [];
  for (let i = 0; i < 21; i++) other.push(await call('POST', '/api/public/tickets'));
  assert.equal(other.at(-1), 429);
});

// Event day (0.74.3): sudo ltdc-erp-event, run here against a temporary app folder and systemd folder
// with a stand-in systemctl on the PATH that only writes down what it was asked: nothing on this
// computer is touched.
function eventBox() {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'core-event-cmd-'));
  const app = path.join(box, 'app');
  const systemd = path.join(box, 'systemd');
  const bin = path.join(box, 'bin');
  for (const d of [path.join(app, 'data', 'backups'), systemd, bin]) fs.mkdirSync(d, { recursive: true });
  fs.chmodSync(path.join(app, 'data'), 0o700);
  const log = path.join(box, 'systemctl.log');
  // systemctl: records each call; "start ltdc-erp-offsite.service" writes the backup's status as the
  // real service would (FAKE_BACKUP=fail: a failed copy).
  fs.writeFileSync(path.join(bin, 'systemctl'), `#!/usr/bin/env bash
echo "$*" >> "${log}"
if [ "$1 $2" = "start ltdc-erp-offsite.service" ]; then
  if [ "\${FAKE_BACKUP:-ok}" = ok ]; then
    printf '{"at":"2026-12-08T04:20:00.000Z","ok":true,"bucket":"ltdc-erp-backups-1","prefix":"hourly/2026-12-08/12/20","ms":900}' > "${app}/data/backups/offsite.json"
  else
    printf '{"at":"2026-12-08T04:20:00.000Z","ok":false,"error":"Access denied","lastOk":{"at":"2026-12-08T04:05:00.000Z","prefix":"hourly/2026-12-08/12"}}' > "${app}/data/backups/offsite.json"; exit 1
  fi
fi
if [ "$1" = list-timers ]; then echo "NEXT  LEFT  LAST  PASSED  UNIT  ACTIVATES"; fi
exit 0
`, { mode: 0o755 });
  const run = (args, { env = {}, umask } = {}) => spawnSync('bash', ['-c', `${umask ? `umask ${umask}; ` : ''}exec bash "$0" "$@"`, path.join(root, 'deploy/aws/ltdc-erp-event'), ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LTDC_APP: app, LTDC_SYSTEMD: systemd, LTDC_PREV: path.join(box, 'prev'), LTDC_HEALTH_URL: 'http://127.0.0.1:9/', ...env }, encoding: 'utf8',
  });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  return { box, app, systemd, run, calls, dropIn: path.join(systemd, 'ltdc-erp-offsite.timer.d', 'event.conf'), freeze: path.join(app, 'data', 'DEPLOY_FREEZE') };
}

test('ltdc-erp-event: a checked bash script, executable, installed by every deploy after the freeze guard and before update.sh', () => {
  const file = path.join(root, 'deploy/aws/ltdc-erp-event');
  assert.equal(spawnSync('bash', ['-n', file]).status, 0);
  assert.ok(fs.statSync(file).mode & 0o100, 'executable');
  const remote = fs.readFileSync(path.join(root, 'deploy/aws/remote-deploy.sh'), 'utf8');
  const at = remote.indexOf('install -m 755 "$SRC/deploy/aws/ltdc-erp-event" /usr/local/sbin/ltdc-erp-event');
  assert.ok(at > 0, 'installed as /usr/local/sbin/ltdc-erp-event');
  assert.ok(remote.indexOf('DEPLOY_FREEZE') < at && at < remote.indexOf('bash "$SRC/deploy/aws/update.sh"'));
  assert.doesNotMatch(remote.replace(/^#.*$/gm, ''), /ltdc-erp-event (status|backups|freeze|unfreeze|close-out)/, 'a deploy only installs it, never runs it');
  // Root only on the server (a test folder in LTDC_APP is the exception).
  const r = spawnSync('bash', [file, 'unfreeze'], { env: { ...process.env, LTDC_APP: '' }, encoding: 'utf8' });
  if (process.getuid?.() !== 0) assert.match(r.stdout, /Run it with sudo/);
  const help = spawnSync('bash', [file], { encoding: 'utf8' });
  assert.equal(help.status, 2);
  assert.match(help.stdout, /backups-every-15/);
});

test('ltdc-erp-event backups-every-15: the timer drop-in as systemd needs it (reset first), readable under umask 077, a backup now; backups-hourly takes it away', () => {
  const b = eventBox();
  const on = b.run(['backups-every-15'], { umask: '077' });
  assert.equal(on.status, 0, on.stdout + on.stderr);
  const text = fs.readFileSync(b.dropIn, 'utf8');
  const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(lines, ['[Timer]', 'OnCalendar=', 'OnCalendar=*:05/15'], 'the empty OnCalendar= clears the hourly time before the new one');
  assert.equal(fs.statSync(b.dropIn).mode & 0o777, 0o644, 'systemd reads it');
  assert.equal(fs.statSync(path.dirname(b.dropIn)).mode & 0o777, 0o755);
  assert.deepEqual(b.calls().filter((c) => !c.startsWith('list-timers')), ['daemon-reload', 'restart ltdc-erp-offsite.timer', 'start ltdc-erp-offsite.service']);
  assert.match(on.stdout, /Last off-server backup: OK at .* to s3:\/\/ltdc-erp-backups-1\/hourly\/2026-12-08\/12\/20\//);
  assert.match(on.stdout, /Done: backups now run every 15 minutes/);
  // Again: the same file, nothing doubled; a failed backup now is said, and the schedule stays.
  const again = b.run(['backups-every-15'], { env: { FAKE_BACKUP: 'fail' } });
  assert.equal(again.status, 1);
  assert.match(again.stdout, /already in place/);
  assert.match(again.stdout, /FAILED .*Access denied.*The last good one/);
  assert.match(again.stdout, /15-minute schedule IS set/);
  assert.equal(fs.readFileSync(b.dropIn, 'utf8'), text);
  assert.match(b.run(['status']).stdout, /EVERY 15 MINUTES/);
  // Back to hourly, twice (the second time there is nothing to do).
  const off = b.run(['backups-hourly']);
  assert.equal(off.status, 0, off.stdout);
  assert.ok(!fs.existsSync(b.dropIn) && !fs.existsSync(path.dirname(b.dropIn)));
  assert.match(off.stdout, /back to every hour/);
  const n = b.calls().length;
  assert.match(b.run(['backups-hourly']).stdout, /already on the normal hourly schedule/);
  assert.equal(b.calls().length, n, 'nothing reloaded when nothing changed');
  // The unit itself still says hourly at 5 past, so removing the drop-in is all it takes.
  assert.match(fs.readFileSync(path.join(root, 'deploy/aws/ltdc-erp-offsite.timer'), 'utf8'), /^OnCalendar=\*-\*-\* \*:05:00$/m);
});

test('ltdc-erp-event freeze writes what the deploy guard reads (round trip: frozen deploy exits 3; unfrozen it does not), readable by the app under umask 077', () => {
  const b = eventBox();
  const until = new Date(Date.now() + 2 * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
  const on = b.run(['freeze', until.replace('Z', '+00:00'), 'YEP 2026 event'], { umask: '077' });
  assert.equal(on.status, 0, on.stdout + on.stderr);
  assert.equal(fs.readFileSync(b.freeze, 'utf8'), `${until}\nYEP 2026 event\n`, 'end time (UTC) on line 1, reason on line 2');
  assert.equal(fs.statSync(b.freeze).mode & 0o777, 0o640);
  assert.equal(fs.statSync(b.freeze).uid, fs.statSync(path.join(b.app, 'data')).uid, 'owned like the data folder');
  const frozen = deploy(b.app);
  assert.equal(frozen.status, 3);
  assert.match(frozen.stdout, new RegExp(`Deploys are frozen until ${until} \\(YEP 2026 event\\)`));
  assert.match(b.run(['status']).stdout, /Deploy freeze: ON until/);
  // Refused: no reason, not a date, a time already passed. The freeze in place is kept.
  assert.equal(b.run(['freeze', until]).status, 2);
  assert.match(b.run(['freeze', 'next tuesday-ish', 'x']).stdout, /is not a date and time/);
  assert.match(b.run(['freeze', '2020-01-01T00:00:00Z', 'x']).stdout, /already passed/);
  assert.equal(deploy(b.app).status, 3);
  // Unfreeze, twice.
  assert.match(b.run(['unfreeze']).stdout, /deploys go through again/);
  assert.match(b.run(['unfreeze']).stdout, /There was no deploy freeze/);
  const open = deploy(b.app);
  assert.notEqual(open.status, 3);
  assert.doesNotMatch(open.stdout, /frozen/);
  assert.match(b.run(['status']).stdout, /Deploy freeze: OFF/);
});

test('ltdc-erp-event close-out: unfreeze and hourly backups together, then the steps left by hand; status reads everything without changing it', () => {
  const b = eventBox();
  b.run(['freeze', '2099-01-01T00:00:00+08:00', 'YEP 2026']);
  b.run(['backups-every-15']);
  fs.mkdirSync(path.join(b.box, 'prev'));
  fs.writeFileSync(path.join(b.box, 'prev', 'server.js'), '');
  fs.writeFileSync(path.join(b.box, 'prev', 'build.json'), '{"commit":"abcdef1234567","installedAt":"x"}');
  fs.writeFileSync(path.join(b.app, 'build.json'), '{"commit":"9876543210fed","installedAt":"x"}');
  const before = b.calls().length;
  const st = b.run(['status']);
  assert.equal(st.status, 0);
  for (const re of [/Deploy freeze: ON until 2098-12-31T16:00:00Z \(YEP 2026\)/, /EVERY 15 MINUTES/, /Last off-server backup: OK/, /Rollback: ready\. Running 9876543; .* back to abcdef1/, /Free disk: /, /CORE: NOT answering/]) assert.match(st.stdout, re);
  assert.ok(b.calls().slice(before).every((c) => c.startsWith('list-timers')), 'status only reads');
  const out = b.run(['close-out']);
  assert.equal(out.status, 0, out.stdout);
  assert.ok(!fs.existsSync(b.freeze) && !fs.existsSync(b.dropIn));
  for (const re of [/deploys go through again/, /back to every hour/, /Resize the instance back/, /terminate staging/, /export .* to the client/, /deleting the guest data/]) assert.match(out.stdout, re);
  // Again: nothing left to do, still fine.
  const again = b.run(['close-out']);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /There was no deploy freeze[\s\S]*already on the normal hourly schedule/);
});
