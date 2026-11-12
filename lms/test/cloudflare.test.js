// System → Cloudflare ("Set up Cloudflare for me"): against a stand-in for Cloudflare's API
// (test/cloudflare-api.js) — the DNS record and settings ATLAS makes, what it refuses and why, the
// request file it writes for the server's helper, the status file it reads back, and that the API
// token is never kept, logged or sent back.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from './support.js';
import { memoryDb } from '../server/db.js';
import { fakeCloudflare, TOKEN } from './cloudflare-api.js';
import { checkHostname, isPublicIpv4, zoneCandidates } from '../server/cloudflare.js';

const PW = 'password123';
const IP = '54.169.10.20';
const HOST = 'atlas.school.edu.ph';
const dirs = [];
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

async function school({ cf = {}, helper = false, folder = true, options = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cf-'));
  dirs.push(dir);
  const helperPath = path.join(dir, 'ltdc-lms-cloudflare');
  if (helper) fs.writeFileSync(helperPath, '#!/bin/sh\n');
  const db = memoryDb();
  if (folder) db.dir = dir;
  const fake = fakeCloudflare(cf);
  const env = setup({ db, options: { cloudflareFetch: fake.fetch, cloudflareHelper: helperPath, ...options } });
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const files = {
    request: path.join(dir, 'cloudflare.json'),
    status: path.join(dir, 'cloudflare-status.json'),
    readRequest: () => JSON.parse(fs.readFileSync(path.join(dir, 'cloudflare.json'), 'utf8')),
    writeStatus: (s) => fs.writeFileSync(path.join(dir, 'cloudflare-status.json'), typeof s === 'string' ? s : JSON.stringify(s)),
  };
  return { env, db, admin, fake, dir, files };
}
const body = (extra = {}) => ({ token: TOKEN, hostname: HOST, originIp: IP, lockOrigin: false, ...extra });

test('set up for me: a proxied A record, Full (strict), TLS 1.2, the request file for the server, one audit entry, and the token nowhere', async () => {
  const f = await school({ helper: true });
  const before = await f.admin.get('/api/admin/cloudflare');
  assert.deepEqual([before.state, before.pending, before.request, before.status, before.helperInstalled, before.suggestedIp], ['none', false, null, null, true, IP]);
  assert.equal(before.settings.hostname, '');

  const out = await f.admin.post('/api/admin/cloudflare/setup', body({ hostname: 'Atlas.School.edu.ph' }));
  // Cloudflare, as it now is.
  const zone = f.fake.zones[0];
  assert.equal(f.fake.records.length, 1);
  const rec = f.fake.records[0];
  assert.deepEqual([rec.type, rec.name, rec.content, rec.proxied, rec.ttl, rec.comment], ['A', HOST, IP, true, 1, 'Lancaster ATLAS (set up from the Admin panel)']);
  assert.deepEqual([f.fake.settings().ssl, f.fake.settings().min_tls_version, f.fake.settings().always_use_https], ['strict', '1.2', 'off']);
  // Every call: the token as a bearer token, no redirects followed, a time limit; settings before the record.
  for (const c of f.fake.api()) assert.deepEqual([c.headers.authorization, c.redirect, c.signal], [`Bearer ${TOKEN}`, 'manual', true]);
  assert.deepEqual(f.fake.writes().map((c) => `${c.method} ${c.path.replace('/client/v4', '').replace(zone.id, 'Z')}`), ['PATCH /zones/Z/settings/ssl', 'PATCH /zones/Z/settings/min_tls_version', 'POST /zones/Z/dns_records']);
  assert.ok(f.fake.api().some((c) => c.path === '/client/v4/zones?name=atlas.school.edu.ph&per_page=50'), 'tries the full name first');
  // What ATLAS says it did.
  assert.deepEqual(out.changes, [`added the DNS record ${HOST} → ${IP}, proxied through Cloudflare`, 'set SSL/TLS encryption to Full (strict) (was Full)', 'raised the minimum TLS version to 1.2 (was 1.0)']);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /whole of school\.edu\.ph/);
  assert.deepEqual([out.settings.hostname, out.settings.zoneName, out.settings.originIp, out.settings.lockOrigin, out.settings.setupBy], [HOST, 'school.edu.ph', IP, false, 'Ada Admin']);
  assert.deepEqual([out.state, out.pending, out.status], ['pending', true, null]);
  // The request file, exactly as the server's helper reads it.
  const req = f.files.readRequest();
  assert.deepEqual(Object.keys(req), ['version', 'hostname', 'lockOrigin', 'requestedAt', 'requestedBy']);
  assert.deepEqual([req.version, req.hostname, req.lockOrigin, req.requestedBy], [1, HOST, false, 'Ada Admin']);
  assert.ok(!Number.isNaN(Date.parse(req.requestedAt)) && new Date(req.requestedAt).toISOString() === req.requestedAt);
  assert.deepEqual(out.request, req);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.files.request).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(f.dir).filter((n) => n.endsWith('.tmp')), [], 'no temporary file left');
  // One audit entry, with the zone, the name and the changes.
  const entries = f.env.api.audit.entries().filter((e) => /cloudflare/i.test(`${e.action} ${e.detail}`));
  assert.equal(entries.length, 1);
  assert.deepEqual([entries[0].kind, entries[0].system, entries[0].action, entries[0].actor], ['access', 'admin', 'Set up Cloudflare', 'Ada Admin']);
  assert.match(entries[0].detail, /atlas\.school\.edu\.ph on school\.edu\.ph → 54\.169\.10\.20: added the DNS record/);
  // The token: not in the data, the audit log (in memory and on disk), the request file or the answer.
  for (const [where, s] of [['db', JSON.stringify(f.db.data)], ['audit', JSON.stringify(f.env.api.audit.entries())], ['audit file', fs.readFileSync(path.join(f.dir, 'audit-log.jsonl'), 'utf8')], ['request', fs.readFileSync(f.files.request, 'utf8')], ['response', JSON.stringify(out)], ['GET', JSON.stringify(await f.admin.get('/api/admin/cloudflare'))]]) {
    assert.equal(s.includes(TOKEN), false, `the token is in the ${where}`);
  }
  // Running it again changes nothing in Cloudflare, and asks the server again.
  const writes = f.fake.writes().length;
  const again = await f.admin.post('/api/admin/cloudflare/setup', body());
  assert.deepEqual([again.changes, f.fake.writes().length], [[], writes]);
  assert.ok(f.files.readRequest().requestedAt > req.requestedAt, 'a new requestedAt');
});

test('an existing A record is pointed at this server and proxied; AAAA records and Always Use HTTPS are warned about, not changed', async () => {
  const f = await school({ cf: { records: [{ type: 'A', name: HOST, content: '52.1.2.3', proxied: false }, { type: 'AAAA', name: HOST, content: '2600:1f18::1' }, { type: 'TXT', name: HOST, content: 'hello' }], settings: { ssl: 'strict', min_tls_version: '1.2', always_use_https: 'on' } } });
  const out = await f.admin.post('/api/admin/cloudflare/setup', body());
  const a = f.fake.records.find((r) => r.type === 'A');
  assert.deepEqual([a.content, a.proxied, f.fake.records.length], [IP, true, 3]);
  assert.deepEqual(out.changes, [`pointed ${HOST} at ${IP} (was 52.1.2.3), proxied through Cloudflare`]);
  assert.deepEqual(f.fake.writes().map((c) => c.method), ['PATCH']);
  assert.equal(out.warnings.length, 2);
  assert.match(out.warnings[0], /IPv6 \(AAAA\) record, 2600:1f18::1/);
  assert.match(out.warnings[1], /Always Use HTTPS.*renewals.*turn it off/);
  assert.equal(f.fake.settings().always_use_https, 'on', 'left as it was');
  // Already right but not proxied: only the proxy is turned on.
  f.fake.records.find((r) => r.type === 'A').proxied = false;
  assert.deepEqual((await f.admin.post('/api/admin/cloudflare/setup', body())).changes, [`turned on the Cloudflare proxy for ${HOST}`]);
});

test('refused clearly, with nothing changed in Cloudflare: a CNAME, several A records, a pending or missing zone, a bad token, missing permissions', async () => {
  const refused = async (cf, pattern, extra = {}) => {
    const f = await school({ cf });
    await assert.rejects(f.admin.post('/api/admin/cloudflare/setup', body(extra)), pattern);
    assert.deepEqual(f.fake.writes(), [], 'nothing was changed in Cloudflare');
    assert.equal(fs.existsSync(f.files.request), false, 'no request for the server');
    assert.equal(f.db.data.settings.cloudflare.hostname, '');
    return f;
  };
  await refused({ records: [{ type: 'CNAME', name: HOST, content: 'school.github.io' }] }, /already has a CNAME record in Cloudflare \(pointing to school\.github\.io\)\. ATLAS changed nothing/);
  await refused({ records: [{ type: 'A', name: HOST, content: '52.1.2.3' }, { type: 'A', name: HOST, content: '52.1.2.4' }] }, /has 2 A records/);
  await refused({ zones: [{ name: 'school.edu.ph', status: 'pending', name_servers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'] }] }, (e) => e.status === 409 && /has not activated school\.edu\.ph yet.*nameservers to ada\.ns\.cloudflare\.com and bob\.ns\.cloudflare\.com/.test(e.message));
  await refused({ zones: [{ name: 'other.org' }] }, /no domain for atlas\.school\.edu\.ph that this token can see\. Add the school's domain \(probably school\.edu\.ph\)/);
  await refused({ can: { zoneRead: false } }, /no domain for atlas\.school\.edu\.ph that this token can see/);
  await refused({ token: 'another-token-entirely-0000000' }, /did not accept this API token/);
  await refused({ tokenStatus: 'disabled' }, /token is disabled/);
  const perms = /may not do that for school\.edu\.ph.*Zone · Zone · Read, Zone · DNS · Edit and Zone · Zone Settings · Edit, with Zone Resources: Include · Specific zone · school\.edu\.ph/;
  await refused({ can: { dnsEdit: false } }, perms);
  await refused({ can: { settingsEdit: false } }, perms);
  // A message never carries the token, whatever Cloudflare says.
  const f = await school({ cf: { can: { dnsEdit: false } } });
  await assert.rejects(f.admin.post('/api/admin/cloudflare/setup', body()), (e) => !e.message.includes(TOKEN));
  assert.equal(JSON.stringify(f.env.api.audit.entries()).includes(TOKEN), false);
});

test('an account-owned token (which /user/tokens/verify does not know) still works; the bare domain can be used too', async () => {
  const f = await school({ cf: { accountToken: true, zones: [{ name: 'school.org' }] } });
  const out = await f.admin.post('/api/admin/cloudflare/setup', body({ hostname: 'school.org' }));
  assert.deepEqual([out.settings.zoneName, f.fake.records[0].name], ['school.org', 'school.org']);
  assert.deepEqual(zoneCandidates('atlas.school.edu.ph'), ['atlas.school.edu.ph', 'school.edu.ph', 'edu.ph']);
});

test('bad names, private addresses and malformed tokens are refused before anything is sent to Cloudflare', async () => {
  const f = await school({ options: { rateLimits: 'off' } }); // many tries in a row
  const bad = [
    [{ originIp: '10.0.0.5' }, /public IPv4/], [{ originIp: '192.168.1.10' }, /public IPv4/], [{ originIp: '127.0.0.1' }, /public IPv4/],
    [{ originIp: '100.64.3.1' }, /public IPv4/], [{ originIp: '172.20.0.1' }, /public IPv4/], [{ originIp: '169.254.169.254' }, /public IPv4/],
    [{ originIp: '224.0.0.1' }, /public IPv4/], [{ originIp: '0.1.2.3' }, /public IPv4/], [{ originIp: '255.255.255.255' }, /public IPv4/],
    [{ originIp: '1.2.3' }, /public IPv4/], [{ originIp: '256.1.1.1' }, /public IPv4/], [{ originIp: '054.1.2.3' }, /public IPv4/], [{ originIp: '2600::1' }, /public IPv4/],
    [{ hostname: '' }, /name like/], [{ hostname: 'atlas' }, /name like/], [{ hostname: '1.2.3.4' }, /name like/], [{ hostname: '-atlas.school.edu' }, /name like/],
    [{ hostname: 'atlas-.school.edu' }, /name like/], [{ hostname: 'a_b.school.edu' }, /name like/], [{ hostname: 'a..school.edu' }, /name like/],
    [{ hostname: `${'a'.repeat(64)}.school.edu` }, /name like/], [{ hostname: `${'abcdefghi.'.repeat(26)}edu` }, /name like/], [{ hostname: 'atlas.school.edu/evil' }, /name like/],
    [{ hostname: 'https://atlas.school.edu' }, /name like/], [{ hostname: 'ltdc.duckdns.org' }, /duckdns\.org address cannot go on Cloudflare/],
    [{ token: '' }, /Paste the Cloudflare API token/], [{ token: 'short' }, /Paste the Cloudflare API token/], [{ token: `${TOKEN} x` }, /Paste the Cloudflare API token/], [{ token: 'a'.repeat(201) }, /Paste the Cloudflare API token/],
  ];
  for (const [extra, why] of bad) await assert.rejects(f.admin.post('/api/admin/cloudflare/setup', body(extra)), why, JSON.stringify(extra));
  assert.deepEqual(f.fake.api(), [], 'no call to Cloudflare');
  assert.equal(checkHostname(' ATLAS.School.edu.PH '), HOST);
  for (const ip of ['54.169.10.20', '1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.0.1']) assert.ok(isPublicIpv4(ip), ip);
});

test('administrators only: a registrar given the settings permission is refused, a teacher too', async () => {
  const f = await school();
  await f.admin.post('/api/admin/users', { role: 'registrar', username: 'rosa', name: 'Rosa', password: PW, mustChangePassword: false });
  await f.admin.post('/api/admin/users', { role: 'teacher', username: 'tess', name: 'Tess', password: PW, mustChangePassword: false });
  await f.admin.put('/api/admin/roles', { overrides: { registrar: { add: ['settings.edit'] } } });
  const reg = f.env.client();
  await reg.post('/api/hub/login', { username: 'rosa', password: PW });
  assert.ok(await reg.get('/api/admin/sso'), 'the registrar has the settings permission');
  for (const [m, p] of [['get', '/api/admin/cloudflare'], ['post', '/api/admin/cloudflare/setup'], ['post', '/api/admin/cloudflare/lock'], ['post', '/api/admin/cloudflare/off']]) {
    await assert.rejects(reg[m](p, body()), (e) => e.status === 403, `${m} ${p}`);
  }
  assert.equal('cloudflare' in (await reg.get('/api/admin/settings')), false, 'not in the registrar\'s settings either');
  const teacher = f.env.client();
  await teacher.post('/api/hub/login', { username: 'tess', password: PW });
  await assert.rejects(teacher.get('/api/admin/cloudflare'), (e) => e.status === 401 || e.status === 403);
  await assert.rejects(teacher.post('/api/admin/cloudflare/setup', body()), (e) => e.status === 401 || e.status === 403);
  await assert.rejects(f.env.client().post('/api/admin/cloudflare/off'), (e) => e.status === 401);
  assert.deepEqual(f.fake.api(), []);
  assert.equal(fs.existsSync(f.files.request), false);
});

test('the server\'s answer: pending until its status has the same requestedAt, then active or failed; a broken status file is ignored', async () => {
  const f = await school();
  await f.admin.post('/api/admin/cloudflare/setup', body());
  const { requestedAt } = f.files.readRequest();
  const status = (extra = {}) => ({ version: 1, state: 'active', hostname: HOST, requestedAt, appliedAt: '2026-11-12T05:01:00.000Z', certificate: true, throughCloudflare: true, originLocked: false, message: 'ATLAS answers at atlas.school.edu.ph through Cloudflare.', ...extra });
  f.files.writeStatus(status({ requestedAt: '2026-01-01T00:00:00.000Z' })); // an older request's answer
  let v = await f.admin.get('/api/admin/cloudflare');
  assert.deepEqual([v.state, v.pending, v.status.state], ['pending', true, 'active']);
  f.files.writeStatus(status());
  v = await f.admin.get('/api/admin/cloudflare');
  assert.deepEqual([v.state, v.pending, v.status.certificate, v.status.throughCloudflare, v.status.originLocked, v.status.message], ['active', false, true, true, false, 'ATLAS answers at atlas.school.edu.ph through Cloudflare.']);
  f.files.writeStatus(status({ state: 'failed', certificate: false, throughCloudflare: false, message: 'Caddy could not get a certificate for atlas.school.edu.ph.' }));
  v = await f.admin.get('/api/admin/cloudflare');
  assert.deepEqual([v.state, v.status.message], ['failed', 'Caddy could not get a certificate for atlas.school.edu.ph.']);
  // Broken or odd status files: treated as no answer yet, never an error.
  for (const s of ['{not json', '[]', 'null', '"active"', JSON.stringify(status({ version: 2 })), JSON.stringify(status({ state: 'done' })), JSON.stringify(status({ certificate: 'yes' })), JSON.stringify(status({ requestedAt: 5 })), JSON.stringify(status({ message: { x: 1 } })), JSON.stringify({ ...status(), message: 'x'.repeat(70 * 1024) })]) {
    f.files.writeStatus(s);
    v = await f.admin.get('/api/admin/cloudflare');
    assert.deepEqual([v.status, v.state, v.pending], [null, 'pending', true], s.slice(0, 40));
  }
  // A status with no request (e.g. the data folder was restored) is shown as it is.
  fs.rmSync(f.files.request);
  f.files.writeStatus(status({ state: 'off', hostname: '' }));
  v = await f.admin.get('/api/admin/cloudflare');
  assert.deepEqual([v.request, v.state, v.pending], [null, 'off', false]);
});

test('links are never followed: a linked status file is ignored, a linked request file is refused before Cloudflare is touched', { skip: process.platform === 'win32' }, async () => {
  const f = await school();
  const elsewhere = path.join(f.dir, 'elsewhere.json');
  fs.writeFileSync(elsewhere, JSON.stringify({ version: 1, state: 'active', hostname: HOST, requestedAt: 'x', certificate: true, throughCloudflare: true, originLocked: true, message: '' }));
  fs.symlinkSync(elsewhere, f.files.status);
  assert.equal((await f.admin.get('/api/admin/cloudflare')).status, null);
  fs.symlinkSync(elsewhere, f.files.request);
  assert.equal((await f.admin.get('/api/admin/cloudflare')).request, null);
  await assert.rejects(f.admin.post('/api/admin/cloudflare/setup', body()), (e) => e.status === 409 && /is a link or not a plain file/.test(e.message));
  assert.deepEqual(f.fake.api(), [], 'Cloudflare was not touched');
  await assert.rejects(f.admin.post('/api/admin/cloudflare/off'), /is a link/);
  assert.equal(JSON.parse(fs.readFileSync(elsewhere, 'utf8')).state, 'active', 'the linked file is unchanged');
  assert.ok(fs.lstatSync(f.files.request).isSymbolicLink());
});

test('only through Cloudflare, and switching off: new requests for the server, no token, no call to Cloudflare', async () => {
  const f = await school();
  await assert.rejects(f.admin.post('/api/admin/cloudflare/lock', { lockOrigin: true }), (e) => e.status === 409 && /Set Cloudflare up first/.test(e.message));
  await f.admin.post('/api/admin/cloudflare/setup', body());
  const first = f.files.readRequest();
  const calls = f.fake.api().length;
  const locked = await f.admin.post('/api/admin/cloudflare/lock', { lockOrigin: true });
  const req = f.files.readRequest();
  assert.deepEqual([req.hostname, req.lockOrigin, req.requestedAt > first.requestedAt], [HOST, true, true]);
  assert.deepEqual([locked.settings.lockOrigin, locked.pending], [true, true]);
  const off = await f.admin.post('/api/admin/cloudflare/off');
  const offReq = f.files.readRequest();
  assert.deepEqual([offReq.hostname, offReq.lockOrigin, offReq.requestedAt > req.requestedAt], ['', false, true]);
  assert.deepEqual([off.settings.hostname, off.settings.lockOrigin, off.settings.zoneName], ['', false, 'school.edu.ph']);
  assert.match(off.note, /DNS record for atlas\.school\.edu\.ph stays in Cloudflare/);
  assert.equal(f.fake.api().length, calls, 'Cloudflare is not called');
  f.files.writeStatus({ version: 1, state: 'off', hostname: '', requestedAt: offReq.requestedAt, appliedAt: offReq.requestedAt, certificate: false, throughCloudflare: false, originLocked: false, message: 'Back on the DuckDNS address.' });
  assert.equal((await f.admin.get('/api/admin/cloudflare')).state, 'off');
  await assert.rejects(f.admin.post('/api/admin/cloudflare/lock', { lockOrigin: true }), /Set Cloudflare up first/);
  const actions = f.env.api.audit.entries().filter((e) => /cloudflare/i.test(e.action)).map((e) => e.action);
  assert.deepEqual(actions, ['Set up Cloudflare', 'Cloudflare: only accept visitors through Cloudflare', 'Switched Cloudflare off']);
});

test('without a data folder (in-memory) the request is kept in memory; off AWS there is no suggested address and no helper', async () => {
  const f = await school({ folder: false, cf: { ip: null } });
  const v = await f.admin.get('/api/admin/cloudflare');
  assert.deepEqual([v.suggestedIp, v.helperInstalled, v.duckdns], [null, false, null]);
  const out = await f.admin.post('/api/admin/cloudflare/setup', body({ lockOrigin: true }));
  assert.deepEqual([out.request.hostname, out.request.lockOrigin, out.pending, out.state], [HOST, true, true, 'pending']);
  assert.equal(fs.existsSync(f.files.request), false);
  // The address lookup is not repeated on every visit.
  const imds = f.fake.calls.filter((c) => c.host === '169.254.169.254').length;
  await f.admin.get('/api/admin/cloudflare');
  assert.equal(f.fake.calls.filter((c) => c.host === '169.254.169.254').length, imds);
});
