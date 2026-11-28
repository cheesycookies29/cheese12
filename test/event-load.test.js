// The event load test script (0.74.3, US-028/US-029, AC-185): scripts/event-load.mjs run against a CORE
// started here on a free port (rate limits on, as on staging), with a tiny profile: the report's shape,
// no 429s, the rules scan, 2-step sign-in for the operator and the synthetic staff, the refusals
// (production addresses, an event whose email is not paused), and the kill -9 drill with a real
// SIGKILL and restart of that CORE. Nothing outside the temporary folders is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { codeAt, stepAt } from '../server/totp.js';
import { refusalOf, parseDuration, syntheticGuests, tablePlan, arrivalTimes, mulberry32, totpAt } from '../scripts/event-load.mjs';
import { mergedPercentile, createPerf } from '../server/perf.js';
import { company } from './support/customapp-kit.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'event-load.mjs');
const PW = 'Correct-Horse-42';

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
function startCore(port, dbFile) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_FILE: dbFile, OPEN_BROWSER: '', CUSTOMAPP_VERIFY_PAD_MS: '20', RATE_LIMITS: 'on' }, stdio: 'ignore' });
  return child;
}
async function waitUp(base) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/public/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('CORE did not start');
}
// A fresh CORE with its first administrator and CUSTOM APP on; with twoFactor, the administrator has
// 2-step verification and the company requires it of everyone (as production may on the night).
async function core({ twoFactor = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-load-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child = startCore(port, path.join(dir, 'db.json'));
  await waitUp(base);
  let cookie = '';
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  await call('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  assert.equal((await call('PUT', '/api/admin/modules', { modules: { customapp: true } })).status, 200);
  let secret = null;
  if (twoFactor) {
    secret = (await call('POST', '/api/me/2fa/setup', { password: PW })).data.secret;
    assert.equal((await call('POST', '/api/me/2fa/enable', { code: codeAt(secret, stepAt()) })).status, 200);
    const cur = (await call('GET', '/api/security-settings')).data;
    assert.equal((await call('PUT', '/api/security-settings', { ...cur, twoFactor: 'all' })).status, 200);
  }
  return {
    dir, port, base, call, secret,
    kill: () => new Promise((r) => {
      child.once('exit', r);
      child.kill('SIGKILL');
    }),
    restart: async () => {
      child = startCore(port, path.join(dir, 'db.json'));
      await waitUp(base);
    },
    stop: () => child.kill(),
  };
}
// The script as the operator runs it; onLine sees its output as it comes.
function runScript(args, { env = {}, onLine = () => {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: ROOT, env: { ...process.env, LT_PW: PW, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let buf = '';
    child.stdout.on('data', (d) => {
      out += d;
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('exit', (code) => resolve({ code, out }));
  });
}
const TINY = ['--guests', '20', '--staff', '3', '--duration', '2s', '--drain', '40s', '--think', '50ms', '--typing', '200ms', '--seed', '7'];

test('the plan: a production address is refused before anything is sent, and the synthetic list fits the 5 x 5 room of 10', async () => {
  for (const url of ['https://ltdc-core.com', 'https://WWW.ltdc-core.com/', 'https://ltdc-erp.duckdns.org/x']) {
    assert.match(refusalOf(url), /PRODUCTION/);
    const r = await runScript(['--url', url, '--user', 'admin', '--password-env', 'LT_PW']);
    assert.equal(r.code, 2);
    assert.match(r.out, /REFUSED: .*PRODUCTION.*Nothing was sent/);
  }
  assert.equal(refusalOf('https://staging.example.com'), null);
  assert.equal(refusalOf('https://ltdc-core.com', { allowProduction: true }), null, 'only with the flag nobody should use');
  assert.match(refusalOf('ftp://x'), /not an http/);
  assert.equal(parseDuration('10m'), 600000);
  assert.equal(parseDuration('1.5'), 90000, 'bare numbers are minutes');
  assert.equal(parseDuration('250', 'ms'), 250);
  // 250 guests: every chair once, preferred guests on tables 1-2 with their chair, owners matching.
  const list = syntheticGuests(250, 15, mulberry32(1));
  assert.equal(new Set(list.map((g) => g.last)).size, 250, 'surnames are unique (no soft cap shared)');
  assert.equal(new Set(list.map((g) => `${g.table}:${g.seat}`).values().filter((k) => k !== 'null:null')).size, 20);
  assert.equal(list.filter((g) => g.classification === 'employee').length, 10);
  assert.ok(list.every((g) => /@loadtest\.invalid$/.test(g.email)), 'addresses that can never receive mail');
  const plan = tablePlan(15);
  assert.deepEqual(plan.filter((t) => t.owner == null).map((t) => t.number), [1, 2, 3, 4]);
  const times = arrivalTimes(250, 600000, mulberry32(2));
  const peak = times.filter((t) => t >= 150000 && t < 330000).length;
  assert.ok(peak > 110 && peak < 170, `a peak in the middle (${peak})`);
  assert.match(totpAt('JBSWY3DPEHPK3PXP', 1), /^\d{6}$/);
  assert.equal(totpAt('JBSWY3DPEHPK3PXP', 1), codeAt('JBSWY3DPEHPK3PXP', 1), 'the same codes as CORE');
});

test('a tiny ballroom against a real CORE with limits on and 2-step required: report shape, zero 429s, rules clean, every gate PASS; an event with email on is refused', async () => {
  const c = await core({ twoFactor: true });
  try {
    const report = path.join(c.dir, 'report.json');
    const r = await runScript(['--url', c.base, '--user', 'admin', '--password-env', 'LT_PW', '--totp-env', 'LT_TOTP', ...TINY, '--report', report], { env: { LT_TOTP: c.secret } });
    if (process.env.SHOW_LOAD) console.log(r.out);
    assert.equal(r.code, 0, r.out);
    const rep = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.equal(fs.statSync(report).mode & 0o777, 0o600, 'the report is private');
    for (const k of ['target', 'startedAt', 'endedAt', 'profile', 'event', 'requests', 'guests', 'staff', 'server', 'invariants', 'gates', 'pass']) assert.ok(k in rep, k);
    assert.equal(rep.pass, true);
    assert.deepEqual(rep.gates.map((g) => [g.id, g.pass]), [['AC-186', true], ['AC-187', true], ['AC-188', true], ['AC-189', true], ['ERR', true]]);
    assert.equal(rep.requests.byStatus['429'], undefined, 'no 429 to anyone');
    assert.deepEqual(rep.invariants.violations, []);
    assert.equal(rep.invariants.duplicateCheckIns, 0);
    assert.equal(rep.invariants.superAdmins, 1);
    assert.deepEqual([rep.guests.total, rep.guests.checkedIn, rep.guests.seated], [20, 20, 20]);
    assert.ok(rep.guests.viaGuestPage > 0 && rep.guests.viaDesk > 0, 'both ways in were used');
    assert.ok(rep.server.perf.save.count > 0 && rep.server.perf.loop.count > 0, 'the server\'s numbers were read');
    const keys = rep.requests.endpoints.map((e) => e.key);
    for (const k of ['GET guest page', 'POST verify', 'GET find guest', 'POST command checkIn', 'GET guest sheet', 'POST command assign', 'GET changes (staff)', 'POST /api/auth/2fa']) assert.ok(keys.includes(k), k);
    for (const e of rep.requests.endpoints) for (const p of ['n', 'p50', 'p95', 'p99', 'max', 'status']) assert.ok(p in e, `${e.key} ${p}`);
    assert.match(r.out, /PASS {2}AC-186/);
    assert.match(r.out, /ALL GATES PASS/);
    // The same event with its email switched on (by the administrator's own session from the set-up):
    // refused before anything changes.
    const evBase = `/api/customapp/events/${rep.event.id}`;
    assert.equal((await c.call('POST', `${evBase}/commands`, { type: 'setFlag', flag: 'emailPaused', value: false })).status, 200);
    const seqBefore = (await c.call('GET', evBase)).data.seq;
    // (Another administrator, with 2-step no longer required: the operator's own code was just used.)
    const cur = (await c.call('GET', '/api/security-settings')).data;
    assert.equal((await c.call('PUT', '/api/security-settings', { ...cur, twoFactor: 'off' })).status, 200);
    assert.equal((await c.call('POST', '/api/users', { name: 'Bea Admin', username: 'bea', role: 'admin', password: PW, mustChangePassword: false })).status, 200);
    const again = await runScript(['--url', c.base, '--user', 'bea', '--password-env', 'LT_PW', '--event', rep.event.id, ...TINY]);
    assert.equal(again.code, 2, again.out);
    assert.match(again.out, /REFUSED: .*Email paused OFF/);
    assert.equal((await c.call('GET', evBase)).data.seq, seqBefore, 'nothing changed in the event');
  } finally {
    c.stop();
  }
});

test('the kill -9 drill: KILL NOW is printed, CORE is killed and restarted, staff sign in again within the limit, and no committed check-in is lost', async () => {
  const c = await core();
  try {
    const report = path.join(c.dir, 'report.json');
    let killed = null;
    const r = await runScript(['--url', c.base, '--user', 'admin', '--password-env', 'LT_PW', ...TINY, '--duration', '4s', '--kill-at', '2s', '--report', report], {
      onLine: (line) => {
        if (line.includes('EVENT-LOAD-KILL-NOW') && !killed) killed = c.kill().then(() => new Promise((res) => setTimeout(res, 700))).then(() => c.restart());
      },
    });
    await killed;
    assert.ok(killed, 'the marker was printed');
    assert.match(r.out, /sudo systemctl kill -s KILL ltdc-erp/);
    const rep = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.equal(r.code, 0, r.out);
    const g = Object.fromEntries(rep.gates.map((x) => [x.id, x]));
    assert.equal(g['AC-190'].pass, true, JSON.stringify(rep.kill));
    assert.ok(rep.kill.recoverSec > 0 && rep.kill.recoverSec < 60, `back in ${rep.kill.recoverSec} s`);
    assert.equal(g['AC-191'].pass, true);
    assert.deepEqual(rep.kill.lostFromExport, []);
    assert.deepEqual(rep.kill.lostAcknowledged, []);
    assert.ok(rep.kill.staffSignIns > 3, 'staff signed in again after the restart');
    assert.equal(g['AC-189'].pass, true);
    assert.deepEqual([rep.guests.checkedIn, rep.guests.seated], [20, 20]);
  } finally {
    c.stop();
  }
});

test('GET /api/admin/perf: for administrators only (never audited), the saves since a time and the event loop\'s delay; windows merge into one p99', async () => {
  const c = await company();
  const lines = () => fs.readFileSync(path.join(c.dir, 'audit-log.jsonl'), 'utf8').trim().split('\n').length;
  await new Promise((r) => setTimeout(r, 100)); // the loop's histogram has had a turn
  const since = Date.now();
  for (let i = 0; i < 5; i++) await c.admin('POST', '/api/customapp/events', { name: `Perf ${i}`, superAdminUserId: c.ids.lead });
  const busy = Date.now();
  while (Date.now() - busy < 120);
  await new Promise((r) => setTimeout(r, 100));
  const before = lines();
  const p = await c.admin('GET', `/api/admin/perf?since=${since}`);
  assert.equal(lines(), before, 'reading it writes nothing to the audit log');
  assert.equal(p.save.count, 5, 'only the saves since then');
  assert.ok(p.save.p95 > 0 && p.save.p95 <= p.save.max);
  assert.ok(p.save.total >= 5);
  assert.ok(p.loop.max >= 80, `the 120 ms block is seen (${p.loop.max})`);
  assert.ok(p.loop.windows.length >= 1 && p.loop.windows.at(-1).current);
  assert.equal((await c.as.sam('GET', '/api/admin/perf')).status, 403, 'Event staff cannot read it');
  // Merging: 1,000 samples at 1 ms and 1,000 with 5% at 300 ms are 2.5% at 300 ms together.
  const A = { count: 1000, cdf: [[0.001, 1], [50, 1], [99, 1], [100, 1]] };
  const B = { count: 1000, cdf: [[0.001, 1], [95, 1], [96, 300], [100, 300]] };
  assert.equal(mergedPercentile([A], 99), 1);
  assert.equal(mergedPercentile([A, B], 99), 300);
  assert.equal(mergedPercentile([A, B], 97), 1);
  assert.equal(mergedPercentile([], 99), 0);
  // A save records two numbers; nothing grows past the ring.
  const perf = createPerf();
  for (let i = 0; i < 5000; i++) perf.recordSave(i % 10);
  const snap = perf.snapshot();
  assert.equal(snap.save.total, 5000);
  assert.equal(snap.save.count, 4096);
});
