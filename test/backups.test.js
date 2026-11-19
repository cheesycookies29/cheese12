// Off-server backups and the restore drill (0.38): request signing against AWS's own example,
// the instance metadata, the hourly copy (against a stand-in S3), the daily restore check, and
// what the Security monitor says about both.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { signV4, instanceCredentials, s3Client, runOffsiteBackup, hourPrefix, fetchOffsiteCopy } from '../server/offsite.js';
import { runRestoreCheck } from '../server/restore-check.js';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const tmpDir = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `core-backups-${n}-`));
const servers = [];
after(() => servers.forEach((s) => s.close()));
const listen = (handler) => new Promise((resolve) => {
  const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${s.address().port}`));
  servers.push(s);
});
const creds = { id: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };

test('Signature Version 4: the GET Object example from the Amazon S3 documentation', () => {
  const h = signV4({
    method: 'GET', path: '/test.txt', headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', region: 'us-east-1', creds, now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(h.authorization, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  const withToken = signV4({ method: 'PUT', path: '/a b', headers: { host: 'x' }, payloadHash: 'UNSIGNED-PAYLOAD', region: 'ap-southeast-1', creds: { ...creds, token: 'T' } });
  assert.equal(withToken['x-amz-security-token'], 'T');
  assert.match(withToken.authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token/);
});

test('instance credentials come from the metadata service (IMDSv2, with its token)', async () => {
  const seen = [];
  const imds = await listen((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers['x-aws-ec2-metadata-token'] || ''}`);
    if (req.url === '/latest/api/token') return res.end('TOKEN1');
    if (req.headers['x-aws-ec2-metadata-token'] !== 'TOKEN1') return (res.statusCode = 401), res.end();
    if (req.url === '/latest/dynamic/instance-identity/document') return res.end(JSON.stringify({ accountId: '123456789012', region: 'ap-southeast-1' }));
    if (req.url === '/latest/meta-data/iam/security-credentials/') return res.end('ltdc-erp-server');
    if (req.url === '/latest/meta-data/iam/security-credentials/ltdc-erp-server') return res.end(JSON.stringify({ AccessKeyId: 'ASIA1', SecretAccessKey: 'S', Token: 'TK' }));
    res.statusCode = 404;
    res.end();
  });
  const id = await instanceCredentials({ imds });
  assert.deepEqual(id, { accountId: '123456789012', region: 'ap-southeast-1', creds: { id: 'ASIA1', secret: 'S', token: 'TK' } });
  assert.equal(seen[0], 'PUT /latest/api/token ');
  await assert.rejects(instanceCredentials({ imds: 'http://127.0.0.1:9' }), /Not on AWS/);
});

// A stand-in S3 (path style): keeps what is put; answers AccessDenied when told to.
async function fakeS3() {
  const objects = new Map();
  const state = { deny: false, redirect: '', requests: [] };
  const url = await listen((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      state.requests.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', ifNoneMatch: req.headers['if-none-match'] || '' });
      if (state.deny) return (res.statusCode = 403), res.end('<Error><Code>AccessDenied</Code></Error>');
      if (state.redirect) return res.writeHead(307, { location: state.redirect }), res.end();
      if (req.method === 'PUT') {
        const k = decodeURIComponent(req.url);
        // Like the bucket policy (NoOverwrites): only conditional uploads, and never over a file.
        if (req.headers['if-none-match'] !== '*') return (res.statusCode = 403), res.end('<Error><Code>AccessDenied</Code></Error>');
        if (objects.has(k)) return (res.statusCode = 412), res.end('<Error><Code>PreconditionFailed</Code></Error>');
        objects.set(k, Buffer.concat(chunks));
        return res.end();
      }
      const body = objects.get(decodeURIComponent(req.url));
      if (!body) return (res.statusCode = 404), res.end('<Error><Code>NoSuchKey</Code></Error>');
      res.end(body);
    });
  });
  return { url, objects, state, client: () => s3Client({ bucket: 'ltdc-erp-backups-123456789012', region: 'ap-southeast-1', creds, endpoint: url }) };
}

// A real CORE data folder: an administrator, an employee, audit entries, an attached file.
async function company() {
  const dir = tmpDir('data');
  const db = openDb(path.join(dir, 'db.json'));
  const handle = createApi(db);
  let cookie = '';
  const call = async (m, u, b = {}) => {
    const r = await handle({ method: m, headers: { cookie } }, new URL(u, 'http://localhost'), b);
    if (r.headers['Set-Cookie']) cookie = r.headers['Set-Cookie'].split(';')[0];
    return r.data;
  };
  await call('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'Correct-Horse-42' });
  await call('POST', '/api/employees', { employeeNo: 'E-1', firstName: 'Juan', lastName: 'Cruz', hireDate: '2020-01-01', payType: 'monthly', rate: 30000 });
  handle.monitor.stop();
  fs.mkdirSync(path.join(dir, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'attachments', 'cert-1.pdf'), '%PDF-1.4 a certificate');
  return { dir, handle };
}

test('the hourly copy: data file, audit log and head, attached files once; failures say why and keep the last good copy', async () => {
  const s3 = await fakeS3();
  const { dir } = await company();
  const now = new Date(2026, 10, 18, 9, 5);
  const first = await runOffsiteBackup({ dataDir: dir, now, client: s3.client() });
  assert.equal(first.ok, true, first.error);
  const prefix = hourPrefix(now);
  assert.equal(prefix, 'hourly/2026-11-18/09');
  const bucket = '/ltdc-erp-backups-123456789012';
  for (const name of ['db.json', 'audit-log.jsonl', 'audit-head.json']) assert.ok(s3.objects.has(`${bucket}/${prefix}/${name}`), name);
  assert.deepEqual(s3.objects.get(`${bucket}/${prefix}/db.json`), fs.readFileSync(path.join(dir, 'db.json')));
  assert.ok(s3.objects.has(`${bucket}/attachments/cert-1.pdf`));
  assert.ok(s3.state.requests.every((r) => r.auth.startsWith('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/')), 'every request signed');
  // The order matters for the chain check: the head before the log.
  const order = s3.state.requests.map((r) => r.url.split('/').pop());
  assert.ok(order.indexOf('audit-head.json') < order.indexOf('audit-log.jsonl'));
  // Every upload is conditional; the hour has a sealed manifest of what it holds.
  assert.ok(s3.state.requests.filter((r) => r.method === 'PUT').every((r) => r.ifNoneMatch === '*'));
  const manifest = JSON.parse(s3.objects.get(`${bucket}/${prefix}/manifest.json`));
  assert.equal(manifest.prefix, prefix);
  assert.match(manifest.mac, /^[0-9a-f]{64}$/);
  assert.deepEqual(manifest.files.map((f) => f.name), ['db.json', 'audit-head.json', 'audit-log.jsonl']);
  assert.deepEqual(Object.keys(manifest.attachments), ['cert-1.pdf']);
  // The same hour again: nothing is replaced.
  const again = await runOffsiteBackup({ dataDir: dir, now, client: s3.client() });
  assert.equal(again.ok, false);
  assert.match(again.error, /already copied/);
  assert.equal(again.lastOk.prefix, prefix);
  // An attached file goes once.
  const second = await runOffsiteBackup({ dataDir: dir, now: new Date(2026, 10, 18, 10, 5), client: s3.client() });
  assert.equal(second.attachments.new, 0);
  assert.equal(second.attachments.total, 1);
  // Denied: the reason and what to do, and the last good copy is still known.
  s3.state.deny = true;
  const failed = await runOffsiteBackup({ dataDir: dir, now: new Date(2026, 10, 18, 11, 5), client: s3.client() });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /AccessDenied.*CloudFormation stack/);
  assert.equal(failed.lastOk.prefix, 'hourly/2026-11-18/10');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'backups', 'offsite.json'), 'utf8'));
  assert.equal(saved.ok, false);
  assert.equal(fs.statSync(path.join(dir, 'backups', 'offsite.json')).mode & 0o077, 0, 'readable only by CORE');
  // Not on AWS at all.
  const away = await runOffsiteBackup({ dataDir: dir, credentials: async () => { throw new Error('Not on AWS: the instance metadata service did not answer.'); } });
  assert.match(away.error, /Not on AWS/);
  assert.ok(!JSON.stringify(s3.state.requests).includes('secret.key'), 'the server key is never sent');
});

test('the restore check: the latest off-server copy opens, has an administrator and an intact audit log', async () => {
  const s3 = await fakeS3();
  const { dir } = await company();
  await runOffsiteBackup({ dataDir: dir, client: s3.client() });
  const ok = await runRestoreCheck({ dataDir: dir, client: s3.client() });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.source, 's3');
  assert.equal(ok.counts.admins, 1);
  assert.equal(ok.counts.employees, 1);
  assert.equal(ok.audit.ok, true);
  assert.ok(ok.audit.entries >= 2);
  // The live data was not touched; nothing is left behind.
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).employees.length, 1);
  assert.ok(!fs.readdirSync(os.tmpdir()).some((f) => f.startsWith('core-restore-check-') && fs.existsSync(path.join(os.tmpdir(), f, 'db.json'))));
  // An unreachable copy: the nightly copy on the server stands in, and says so.
  fs.copyFileSync(path.join(dir, 'db.json'), path.join(dir, 'backups', 'db-2026-11-17.json'));
  s3.state.deny = true;
  const local = await runRestoreCheck({ dataDir: dir, client: s3.client() });
  assert.equal(local.ok, true, local.error);
  assert.equal(local.source, 'local');
  assert.match(local.note, /off-server copy could not be read/);
  s3.state.deny = false;
  // A copy that is not what was sent fails, and the nightly copy never covers it (VAPT3 C3-3).
  const key = [...s3.objects.keys()].find((k) => k.endsWith('/db.json'));
  s3.objects.set(key, Buffer.from('{"users": []}'));
  const tampered = await runRestoreCheck({ dataDir: dir, client: s3.client() });
  assert.equal(tampered.ok, false);
  assert.match(tampered.error, /not the file that was sent/);
});

test('the restore check fails on a copy without an administrator, and never reads the mailbox', async () => {
  const { dir } = await company();
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  data.users.forEach((u) => (u.active = false));
  data.helpdesk.mailbox = { ...(data.helpdesk.mailbox || {}), enabled: true, host: '127.0.0.1' };
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backups', 'db-2026-11-18.json'), JSON.stringify(data));
  const r = await runRestoreCheck({ dataDir: dir, offsite: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /no active administrator/);
  assert.equal((await runRestoreCheck({ dataDir: tmpDir('empty'), offsite: false })).error, 'No backup found: neither an off-server copy nor a nightly copy on this server.');
});

test('the Security monitor shows the hourly copy and the restore check', async () => {
  const s3 = await fakeS3();
  const { dir, handle } = await company();
  let cookie = '';
  const call = async (m, u, b = {}) => {
    const r = await handle({ method: m, headers: { cookie } }, new URL(u, 'http://localhost'), b);
    if (r.headers['Set-Cookie']) cookie = r.headers['Set-Cookie'].split(';')[0];
    return r.data;
  };
  await call('POST', '/api/auth/login', { username: 'admin', password: 'Correct-Horse-42' });
  const checks = async () => Object.fromEntries((await call('GET', '/api/admin/monitor')).status.checks.map((c) => [c.id, c]));
  let c = await checks();
  assert.equal(c['offsite-backup'].state, 'info');
  assert.equal(c['restore-check'].state, 'info');
  await runOffsiteBackup({ dataDir: dir, client: s3.client() });
  await runRestoreCheck({ dataDir: dir, client: s3.client() });
  c = await checks();
  assert.equal(c['offsite-backup'].state, 'ok', c['offsite-backup'].detail);
  assert.match(c['offsite-backup'].detail, /Last copy just now to s3:\/\/ltdc-erp-backups-123456789012\/hourly\//);
  assert.equal(c['restore-check'].state, 'ok', c['restore-check'].detail);
  assert.match(c['restore-check'].detail, /off-server copy .* 1 administrator, 1 employees/);
  s3.state.deny = true;
  await runOffsiteBackup({ dataDir: dir, client: s3.client() });
  c = await checks();
  assert.equal(c['offsite-backup'].state, 'warn', 'failed now, but the last good copy is recent');
  assert.match(c['offsite-backup'].detail, /The last copy failed.*AccessDenied/);
});

test('a lost server: one hour\'s copy, attached files included, fetched into a folder for a restore', async () => {
  const s3 = await fakeS3();
  const { dir } = await company();
  const now = new Date(2026, 10, 18, 14, 5);
  await runOffsiteBackup({ dataDir: dir, now, client: s3.client() });
  const dest = tmpDir('restore');
  const r = await fetchOffsiteCopy({ prefix: hourPrefix(now), dest, dataDir: dir, client: s3.client() });
  assert.deepEqual(r, { files: ['db.json', 'audit-head.json', 'audit-log.jsonl'], attachments: 1, at: now.toISOString() });
  assert.deepEqual(fs.readFileSync(path.join(dest, 'db.json')), fs.readFileSync(path.join(dir, 'db.json')));
  assert.equal(fs.readFileSync(path.join(dest, 'attachments', 'cert-1.pdf'), 'utf8'), '%PDF-1.4 a certificate');
  await assert.rejects(fetchOffsiteCopy({ prefix: '../etc', dest, dataDir: dir, client: s3.client() }), /Give the hour to restore/);
});
