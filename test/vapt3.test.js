// Regression tests for the fixes of the third security assessment (0.39): one group per finding.
// A: Security monitor; B: feedback, unlisted pages, text fields; C: off-server backups and deploys.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApi, clientIp } from '../server/api.js';
import { cleanFeedback } from '../server/feedback.js';
import { cleanCompanyRole } from '../shared/profile.js';
import { s3Client, runOffsiteBackup, fetchOffsiteCopy, hourPrefix, sealManifest, checkManifest, manifestKey, IntegrityError } from '../server/offsite.js';
import { runRestoreCheck } from '../server/restore-check.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = 'Correct-Horse-42';
const tmpDir = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `ltdc-vapt3-${n}-`));
const servers = [];
const children = [];
after(() => {
  servers.forEach((s) => s.close());
  children.forEach((c) => c.kill());
});

function browser(handle, ip = '10.0.0.5') {
  let cookie = '';
  return async (method, url, body = {}, headers = {}) => {
    try {
      const res = await handle({ method, headers: { cookie, 'user-agent': 'Mozilla/5.0 Firefox/130.0', ...headers }, socket: { remoteAddress: ip } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res.data;
    } catch (err) {
      return { status: err.status, error: err.message };
    }
  };
}
async function company(name) {
  const dir = tmpDir(name);
  const db = openDb(path.join(dir, 'db.json'));
  const handle = createApi(db);
  const admin = browser(handle);
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  return { dir, db, handle, admin };
}

// ----- A3-1: the forwarded address is read only where CORE is behind its proxy -----
test('A3-1: X-Forwarded-For from this machine is ignored unless TRUST_PROXY (or COOKIE_SECURE) is set', () => {
  const before = { t: process.env.TRUST_PROXY, c: process.env.COOKIE_SECURE };
  const req = { headers: { 'x-forwarded-for': '203.0.113.7' }, socket: { remoteAddress: '127.0.0.1' } };
  try {
    delete process.env.TRUST_PROXY;
    delete process.env.COOKIE_SECURE;
    assert.equal(clientIp(req), '127.0.0.1', 'an office PC: a program on it cannot name another address');
    process.env.TRUST_PROXY = '1';
    assert.equal(clientIp(req), '203.0.113.7');
    delete process.env.TRUST_PROXY;
    process.env.COOKIE_SECURE = '1';
    assert.equal(clientIp(req), '203.0.113.7', 'the AWS set-up');
    assert.equal(clientIp({ ...req, socket: { remoteAddress: '10.1.1.1' } }), '10.1.1.1', 'never from another machine');
  } finally {
    for (const [k, v] of [['TRUST_PROXY', before.t], ['COOKIE_SECURE', before.c]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

// ----- A3-2: the monitor shows accounts, devices and addresses only to those who manage accounts -----
test('A3-2: a role given only the Security monitor sees no account checks, devices, addresses or sign-in log', async () => {
  const { handle, admin } = await company('a32');
  await admin('PUT', '/api/admin/roles', { overrides: { support: { add: ['security.monitor'] } } });
  await admin('POST', '/api/users', { name: 'Sam Support', username: 'samsup', role: 'support', password: PW, mustChangePassword: false });
  const sam = browser(handle, '10.0.0.9');
  await sam('POST', '/api/auth/login', { username: 'samsup', password: PW });
  const full = await admin('GET', '/api/admin/monitor');
  const part = await sam('GET', '/api/admin/monitor');
  handle.monitor.stop();
  assert.ok(full.status.checks.some((c) => c.id === 'two-factor-admins'));
  assert.ok(full.activity.live.some((s) => s.ip && s.device));
  assert.ok(Array.isArray(full.activity.signInLog));
  for (const id of ['two-factor-admins', 'unused-accounts', 'admins', 'temp-passwords']) assert.ok(!part.status.checks.some((c) => c.id === id), id);
  assert.ok(part.status.checks.length > 0, 'the other checks still show');
  assert.ok(part.activity.live.length >= 2);
  assert.ok(part.activity.live.every((s) => !('ip' in s) && !('device' in s)));
  assert.equal(part.activity.signInLog, undefined);
  assert.equal(part.api.metrics, undefined);
});

// ----- A3-3: the metrics address answers the same whether or not a token exists -----
test('A3-3: /api/admin/monitor/metrics answers 401 with no token made, and with a wrong one', async () => {
  const { handle, admin } = await company('a33');
  const anon = browser(handle, '198.51.100.4');
  const none = await anon('GET', '/api/admin/monitor/metrics', {}, { authorization: 'Bearer nope' });
  const made = await admin('POST', '/api/admin/monitor/token');
  assert.ok(made.token);
  const wrong = await anon('GET', '/api/admin/monitor/metrics', {}, { authorization: 'Bearer nope' });
  handle.monitor.stop();
  assert.deepEqual(none, wrong);
  assert.equal(none.status, 401);
});

// ----- B3-2: unlisted pages have their own CSP; a guessed address is a plain 404 -----
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_FILE: path.join(tmpDir('http'), 'db.json'), RATE_LIMITS: 'off', OPEN_BROWSER: '' }, stdio: 'ignore' });
  children.push(child);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/auth/status`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return `http://127.0.0.1:${port}`;
}
test('B3-2: unlisted pages send a Content-Security-Policy with their scripts by hash; unknown ones answer 404', async () => {
  const url = await startServer();
  const pages = fs.readdirSync(path.join(ROOT, 'public', 'private')).filter((f) => /^core-rd-[a-z0-9]+\.html$/.test(f));
  assert.ok(pages.length >= 1);
  for (const f of pages) {
    const r = await fetch(`${url}/${f.slice(0, -5)}`);
    assert.equal(r.status, 200, f);
    const csp = r.headers.get('content-security-policy');
    assert.ok(csp, f);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, 'scripts only by hash');
    const body = await r.text();
    for (const m of body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      assert.ok(csp.includes(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`), `${f}: an inline script without its hash`);
    }
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  }
  const miss = await fetch(`${url}/core-rd-zzzzzzzzzz`);
  assert.equal(miss.status, 404);
  assert.equal(miss.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive', 'a miss looks like a hit by its headers');
  assert.equal((await fetch(`${url}/private/core-rd-1e36k7glxr.html`)).status, 404, 'never by its file name');
});

// ----- B3-3: a restored backup cannot bring feedback without a number, or two with the same one -----
test('B3-3: cleanFeedback gives a missing, malformed or repeated number the next free one', () => {
  const out = cleanFeedback([
    { id: 'a', number: 'FB-0003', subject: 'A' },
    { id: 'b', number: 'FB-0003', subject: 'B' },
    { id: 'c', subject: 'C' },
    { id: 'd', number: 'FB-0000', subject: 'D' },
    { id: 'e', number: 'nonsense', subject: 'E' },
    { id: 'a', number: 'FB-0009', subject: 'A again' },
  ]);
  assert.deepEqual(out.map((f) => f.number), ['FB-0003', 'FB-0004', 'FB-0005', 'FB-0006', 'FB-0007']);
  assert.equal(new Set(out.map((f) => f.number)).size, out.length);
});

// ----- B3-4: direction overrides and invisible marks are dropped from text people read -----
test('B3-4: bidi overrides and zero-width characters are removed from feedback and the company role', async () => {
  const { handle, admin } = await company('b34');
  const sent = await admin('POST', '/api/feedback', { type: 'idea', area: 'general', subject: 'Pay‮gnp.exe​', message: 'Hello⁦ there' });
  handle.monitor.stop();
  const item = sent.item || sent;
  assert.equal(item.subject, 'Paygnp.exe');
  assert.doesNotMatch(item.message, /[⁦‮​]/);
  assert.equal(cleanCompanyRole('Chief‮ Officer﻿'), 'Chief Officer');
});

// ----- C: off-server backups (against a stand-in S3 that behaves like the bucket policy) -----
async function fakeS3() {
  const objects = new Map();
  const state = { redirect: '', huge: false };
  const url = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (state.redirect) return res.writeHead(307, { location: state.redirect }), res.end();
        const k = decodeURIComponent(req.url);
        if (req.method === 'PUT') {
          if (req.headers['if-none-match'] !== '*') return (res.statusCode = 403), res.end('<Error><Code>AccessDenied</Code></Error>');
          if (objects.has(k)) return (res.statusCode = 412), res.end();
          objects.set(k, Buffer.concat(chunks));
          return res.end();
        }
        const body = objects.get(k);
        if (!body) return (res.statusCode = 404), res.end('<Error><Code>NoSuchKey</Code></Error>');
        if (state.huge) {
          // Says nothing of its size, then sends far more than the manifest gives.
          res.writeHead(200, { 'transfer-encoding': 'chunked' });
          for (let i = 0; i < 64; i++) res.write(Buffer.alloc(64 * 1024, 120));
          return res.end();
        }
        res.end(body);
      });
    }).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${s.address().port}`));
    servers.push(s);
  });
  const creds = { id: 'AKIDEXAMPLE', secret: 'secret' };
  return { objects, state, client: () => s3Client({ bucket: 'ltdc-erp-backups-123456789012', region: 'ap-southeast-1', creds, endpoint: url }) };
}
async function backedUp(name) {
  const c = await company(name);
  c.handle.monitor.stop();
  fs.mkdirSync(path.join(c.dir, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(c.dir, 'attachments', 'a1.pdf'), '%PDF-1.4 one');
  fs.writeFileSync(path.join(c.dir, 'attachments', 'a2.pdf'), '%PDF-1.4 two');
  const s3 = await fakeS3();
  const now = new Date(2026, 10, 19, 8, 5);
  const r = await runOffsiteBackup({ dataDir: c.dir, now, client: s3.client() });
  assert.equal(r.ok, true, r.error);
  return { ...c, s3, now, prefix: hourPrefix(now), bucket: '/ltdc-erp-backups-123456789012' };
}

test('C3-2: an hour is never overwritten, and its manifest is sealed with a key from the server key', async () => {
  const b = await backedUp('c32');
  // The same hour again is refused by S3 (If-None-Match) and nothing changes.
  const before = Buffer.from(b.s3.objects.get(`${b.bucket}/${b.prefix}/db.json`));
  b.db.data.employees.push({ id: 'x' });
  b.db.save?.();
  const again = await runOffsiteBackup({ dataDir: b.dir, now: b.now, client: b.s3.client() });
  assert.equal(again.ok, false);
  assert.deepEqual(b.s3.objects.get(`${b.bucket}/${b.prefix}/db.json`), before);
  // The seal: made with this server's key, checked in constant time; another key or a change fails.
  const m = JSON.parse(b.s3.objects.get(`${b.bucket}/${b.prefix}/manifest.json`));
  const key = manifestKey(b.dir);
  assert.equal(checkManifest(m, key, b.prefix).prefix, b.prefix);
  assert.throws(() => checkManifest({ ...m, files: m.files.map((f) => ({ ...f, sha256: '0'.repeat(64) })) }, key, b.prefix), IntegrityError);
  assert.throws(() => checkManifest(m, Buffer.alloc(32, 1), b.prefix), /does not match the server key/);
  assert.throws(() => checkManifest(m, key, 'hourly/2026-11-19/07'), IntegrityError, 'an hour moved to another folder');
  assert.throws(() => checkManifest(sealManifest({ ...m, v: 2 }, key), key, b.prefix), IntegrityError);
  // Without the server key nothing can be fetched or sealed.
  const other = tmpDir('nokey');
  await assert.rejects(fetchOffsiteCopy({ prefix: b.prefix, dest: tmpDir('dest'), dataDir: other, client: b.s3.client() }), /server key is missing/);
  assert.ok(![...b.s3.objects.keys()].some((k) => k.endsWith('secret.key')));
});

test('C3-2/C3-3: a file or manifest changed in the bucket is refused, and the restore check fails with no fallback', async () => {
  const b = await backedUp('c33');
  fs.copyFileSync(path.join(b.dir, 'db.json'), path.join(b.dir, 'backups', 'db-2026-11-18.json'));
  // A forged manifest that matches a forged file.
  const forged = Buffer.from(JSON.stringify({ users: [], employees: [] }));
  const m = JSON.parse(b.s3.objects.get(`${b.bucket}/${b.prefix}/manifest.json`));
  m.files[0] = { name: 'db.json', bytes: forged.length, sha256: createHash('sha256').update(forged).digest('hex') };
  b.s3.objects.set(`${b.bucket}/${b.prefix}/manifest.json`, Buffer.from(JSON.stringify(m)));
  b.s3.objects.set(`${b.bucket}/${b.prefix}/db.json`, forged);
  await assert.rejects(fetchOffsiteCopy({ prefix: b.prefix, dest: tmpDir('dest'), dataDir: b.dir, client: b.s3.client() }), IntegrityError);
  const r = await runRestoreCheck({ dataDir: b.dir, client: b.s3.client() });
  assert.equal(r.ok, false);
  assert.match(r.error, /does not match the server key/);
  assert.notEqual(r.source, 'local', 'the nightly copy on the server never covers a changed off-server copy');
  // An attached file changed in the bucket.
  const c = await backedUp('c33b');
  c.s3.objects.set(`${c.bucket}/attachments/a1.pdf`, Buffer.from('%PDF-1.4 oNe'));
  await assert.rejects(fetchOffsiteCopy({ prefix: c.prefix, dest: tmpDir('dest'), dataDir: c.dir, client: c.s3.client() }), /attachments\/a1.pdf is not the file that was sent/);
});

test('C3-5: an attached file deleted in CORE is not listed with later hours, so a restore does not bring it back', async () => {
  const b = await backedUp('c35');
  fs.unlinkSync(path.join(b.dir, 'attachments', 'a2.pdf'));
  const later = new Date(2026, 10, 19, 9, 5);
  assert.equal((await runOffsiteBackup({ dataDir: b.dir, now: later, client: b.s3.client() })).ok, true);
  const dest = tmpDir('dest');
  const got = await fetchOffsiteCopy({ prefix: hourPrefix(later), dest, dataDir: b.dir, client: b.s3.client() });
  assert.equal(got.attachments, 1);
  assert.deepEqual(fs.readdirSync(path.join(dest, 'attachments')), ['a1.pdf']);
  // The earlier hour still has both, as it was.
  assert.equal((await fetchOffsiteCopy({ prefix: b.prefix, dest: tmpDir('dest'), dataDir: b.dir, client: b.s3.client() })).attachments, 2);
});

test('C3-6: a download bigger than the manifest says is stopped, not read into memory', async () => {
  const b = await backedUp('c36');
  b.s3.state.huge = true;
  await assert.rejects(fetchOffsiteCopy({ prefix: b.prefix, dest: tmpDir('dest'), dataDir: b.dir, client: b.s3.client() }), IntegrityError);
  await assert.rejects(b.s3.client().get(`${b.prefix}/db.json`, { maxBytes: 1000 }), /more than the 1000 bytes expected/);
});

test('C3-8: the copy the restore check starts never sends mail or reads the mailbox', async () => {
  const b = await backedUp('c38');
  // What the check restores is checked by the copy it makes: watch for the mail settings it writes.
  const d = JSON.parse(fs.readFileSync(path.join(b.dir, 'db.json'), 'utf8'));
  d.helpdesk = { ...(d.helpdesk || {}), mailbox: { enabled: true, host: '127.0.0.1' }, outgoing: { enabled: true, host: '127.0.0.1' } };
  d.pm = { ...(d.pm || {}), digest: { enabled: true } };
  fs.writeFileSync(path.join(b.dir, 'db.json'), JSON.stringify(d));
  const later = new Date(2026, 10, 19, 10, 5);
  assert.equal((await runOffsiteBackup({ dataDir: b.dir, now: later, client: b.s3.client() })).ok, true);
  const src = fs.readFileSync(path.join(ROOT, 'server', 'restore-check.js'), 'utf8');
  for (const s of ['mailbox.enabled = false', 'outgoing.enabled = false', 'outgoing.events = false', 'digest.enabled = false']) assert.ok(src.includes(s), s);
  const r = await runRestoreCheck({ dataDir: b.dir, client: b.s3.client() });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.source, 's3');
});

test('C3-10: redirects from S3 are refused, never followed', async () => {
  const b = await backedUp('c310');
  b.s3.state.redirect = 'http://127.0.0.1:9/elsewhere';
  await assert.rejects(b.s3.client().get(`${b.prefix}/db.json`));
  const r = await runOffsiteBackup({ dataDir: b.dir, now: new Date(2026, 10, 19, 11, 5), client: b.s3.client() });
  assert.equal(r.ok, false);
});

// ----- C3-1, C3-9, C3-11, C3-12: the deploy pipeline and the server set-up -----
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (p) => read(p).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
test('C3-1/C3-11: only the approved deploy job can take the deploy role; checkouts keep no credentials', () => {
  const wf = code('.github/workflows/deploy-ec2.yml');
  const top = wf.slice(0, wf.indexOf('\njobs:'));
  assert.match(top, /permissions:\s*\n\s+contents: read\s*\n/);
  assert.doesNotMatch(top, /id-token/);
  const jobs = wf.slice(wf.indexOf('\njobs:')).split(/\n  (?=[a-z][\w-]*:\n)/).slice(1);
  const withToken = jobs.filter((j) => /id-token:\s*write/.test(j));
  assert.equal(withToken.length, 1, 'one job only');
  assert.match(withToken[0], /environment:\s*production/);
  assert.match(withToken[0], /needs:\s*\[?\s*test/);
  for (const m of wf.matchAll(/uses: actions\/checkout@[^\n]+\n((?:\s{8,}[^\n]*\n)*)/g)) assert.match(m[1], /persist-credentials: false/);
  assert.doesNotMatch(wf, /curl[^\n]*Authorization: token \$/, 'the token is never on a command line');
  const cfn = read('deploy/aws/github-deploy.yaml');
  assert.match(cfn, /repo:\$\{GitHubRepository\}:environment:\$\{DeployEnvironment\}/);
  assert.doesNotMatch(cfn, /:ref:refs\/heads\/|repo:\$\{GitHubRepository\}:\*/, 'no branch or wildcard trust');
  assert.match(cfn, /document\/\$\{DeployDocument\}/);
  assert.match(cfn, /\^\[0-9a-f\]\{40\}\$/, 'the commit is checked by the command document');
  assert.match(cfn, /Sid: NoOverwrites\s+Effect: Deny[\s\S]{0,120}?Action: s3:PutObject[\s\S]{0,120}?'Null': \{ 's3:if-none-match': 'true' \}/);
});

test('C3-9/C3-12: CORE cannot change its own code or reach the instance metadata; the backup timers are sandboxed', () => {
  const update = read('deploy/aws/update.sh');
  assert.match(update, /chown -R root:root "\$APP"/);
  assert.match(update, /chown -R ltdc:ltdc "\$APP\/data"/);
  // Root-owned code must stay readable by the app: the download folder is private and rsync -a copies
  // its modes (0.39 deploy: the app could not enter its own folder). Data keeps its private modes.
  assert.match(update, /find "\$APP" -path "\$APP\/data" -prune -o -exec chmod u\+rwX,go\+rX,go-w \{\} \+/);
  assert.ok(update.indexOf('reset-failed ltdc-erp') < update.indexOf('systemctl start ltdc-erp'), 'reset before start');
  const drop = read('deploy/aws/ltdc-erp-hardening.conf');
  assert.match(drop, /IPAddressDeny=169\.254\.169\.254/);
  assert.match(drop, /TRUST_PROXY=1/);
  for (const unit of ['ltdc-erp-offsite.service', 'ltdc-erp-restore-check.service']) {
    const u = read(`deploy/aws/${unit}`);
    for (const k of ['User=ltdc', 'ProtectSystem=strict', 'PrivateTmp=true', 'NoNewPrivileges=true', 'MemoryMax=']) assert.ok(u.includes(k), `${unit}: ${k}`);
  }
  assert.doesNotMatch(code('deploy/aws/ltdc-erp-backup.cron'), /offsite|restore-check/, 'not twice: cron and timer');
  const remote = read('deploy/aws/remote-deploy.sh');
  for (const f of ['ltdc-erp-offsite.timer', 'ltdc-erp-restore-check.timer', 'ltdc-erp-hardening.conf']) assert.ok(remote.includes(f), f);
  // The metadata address cannot be swapped by an environment variable on the server.
  assert.doesNotMatch(read('server/offsite.js'), /process\.env\.[A-Z_]*IMDS/);
});

// ----- D3-1: a value that cannot be turned into text is a bad request, never a server error -----
test('D3-1: objects where text is expected answer 400 (helpdesk, employees, and any body over HTTP)', async () => {
  const { handle, admin } = await company('d31');
  await admin('PUT', '/api/admin/modules', { helpdesk: true });
  for (const bad of [{ toString: 0 }, ['x'], { a: 1 }]) {
    const r = await admin('POST', '/api/helpdesk/mine', { subject: bad, body: 'x', category: 'Hardware' });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const e = await admin('POST', '/api/employees', { employeeNo: { toString: 0 }, firstName: 'A', lastName: 'B', hireDate: '2020-01-01', payType: 'monthly', rate: 1 });
  assert.equal(e.status, 400);
  handle.monitor.stop();
  // Over HTTP the body parser drops toString/valueOf keys, so no route can be made to throw on them.
  const url = await startServer();
  const r = await fetch(`${url}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":{"toString":0},"username":{"valueOf":0},"password":"x"}' });
  assert.ok(r.status >= 400 && r.status < 500, `got ${r.status}`);
});
