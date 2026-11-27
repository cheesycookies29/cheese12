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
