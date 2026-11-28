#!/usr/bin/env node
// Event load test for CUSTOM APP (0.74.3, US-028 / US-029: AC-185 to AC-191). Node's standard library
// only. Run by the on-call developer from ONE laptop (one network address, as the ballroom's phones
// behind the venue's NAT) against a STAGING CORE, with its rate limits ON, never against production:
//
//   LT_PASSWORD='…' node scripts/event-load.mjs --url https://staging.example.com --user admin --password-env LT_PASSWORD
//
// What it does (deploy/aws/EVENT-DAY.md has the exact commands for 4 and 6 Dec):
//  1. Sets up a load-test event (or uses --event <id>): a 5 x 5 room of tables of 10, 250 synthetic
//     guests imported as CSV (20 preferred with reserved chairs, 10 employees, the rest regular),
//     synthetic Event staff accounts (loadtest-staff-01…) owning the tables and their guests, and
//     self check-in open with a window around now. Its email stays paused: the script refuses an
//     event whose "Email paused" switch is off, so no guest is ever emailed.
//  2. Drives the ballroom: guests arrive over --duration (a peak in the middle). Most use the guest
//     page (open it, type surname and last 4, a few mistype first, then poll their status at the
//     server's pollMs); the rest are checked in at the desk by staff (Find guest, Check in). Staff poll
//     My queue at pollMs and seat their waiting guests from the guest sheet (assign with opId and the
//     revisions they saw), the Super Administrator seats the guests nobody owns and works Event control
//     (the board, the room, exceptions, the rules check, the export a laptop pulls).
//  3. Measures every request (status, latency per endpoint) and reads from the server the save() p95
//     and the event-loop delay p99 for the run (GET /api/admin/perf: sign in as a CORE administrator),
//     then scans the rules (GET …/invariants and the export) and prints PASS or FAIL per gate:
//        AC-186 no 429 to guests or staff · AC-187 save() p95 < 100 ms · AC-188 loop delay p99 < 200 ms
//        AC-189 no overbooked table, duplicate check-in, double seat or reservation released by expiry,
//               exactly one Super Administrator
//     With --kill-at <minutes> (6 Dec drill, US-029): at that minute it takes the export, prints
//     KILL NOW for the operator's `sudo systemctl kill -s KILL ltdc-erp`, then measures how long staff
//     take to be back in (AC-190: under 3 minutes) and compares the checked-in guests with that export
//     (AC-191: none lost).
//  4. Writes the JSON report (--report) and exits 0 when every gate passes, 1 when one fails, 2 when it
//     refused to run.
//
// Options: node scripts/event-load.mjs --help
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROD_FLAG = 'yes-this-is-production-and-real-guests-will-be-affected';
const PRODUCTION_HOSTS = ['ltdc-core.com', 'www.ltdc-core.com', 'ltdc-erp.duckdns.org'];
const GATES = { saveP95Ms: 100, loopP99Ms: 200, recoverSec: 180 };
const USAGE = `Event load test (staging only). Usage:
  LT_PASSWORD='…' node scripts/event-load.mjs --url https://<staging host> --user <admin> --password-env LT_PASSWORD [options]

  --url URL              the staging CORE (never production: refused)
  --user NAME            a CORE administrator (makes the event, the synthetic staff, reads /api/admin/perf);
                         with --event it must be that event's Super Administrator
  --password-env VAR     the environment variable holding that password (never on the command line)
  --totp-env VAR         the environment variable holding the account's 2-step secret (base32); without it
                         the code is asked for on the terminal when CORE wants one
  --event ID             use this event (load test 2: the real list) instead of making one
  --guests N             synthetic guests (default 250; 5 x 5 tables of 10)
  --staff N              synthetic Event staff accounts (default 15; 0: the Super Administrator does it all)
  --duration T           arrivals spread over T (default 10m; 250 arrivals of 20-30 minutes, compressed)
  --drain T              after the last arrival, wait up to T for everyone to be seated (default 3m)
  --self-share F         share of guests using the guest page (default 0.6; the rest at the desk)
  --mistype-share F      share of guest page users who mistype their last 4 first (default 0.1)
  --think T              staff time between actions (default 2s, varied ±50%)
  --typing T             time a guest spends on the page before sending (default 4s)
  --kill-at M            minute of the kill -9 drill (prints KILL NOW; measures the recovery)
  --qr-key K             the event's presence key, when it has one (else guests go to the desk)
  --seed N               random seed (default 1), so a run can be repeated
  --report FILE          the JSON report (default event-load-report-<time>.json)
  --cleanup              afterwards: self check-in off, the event archived, the synthetic staff disabled
  --cleanup-only         only that, for --event
  --${PROD_FLAG}
                         the only way to point it at a production address. Do not.
`;

// ----- Small helpers -----
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
export function parseDuration(v, bare = 'm') {
  if (v === undefined || v === null || v === '') return null;
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
  if (!m) throw new Error(`"${v}" is not a duration (e.g. 10m, 30s, 500ms).`);
  return Math.round(Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2] || bare]);
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const clock = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

// The production addresses: deploy/aws/site-address (when the repository is here) and the known ones.
export function productionHosts() {
  const hosts = new Set(PRODUCTION_HOSTS);
  try {
    for (const line of fs.readFileSync(path.join(HERE, '..', 'deploy', 'aws', 'site-address'), 'utf8').split('\n')) {
      const h = line.replace(/#.*/, '').trim().toLowerCase();
      if (h) hosts.add(h);
    }
  } catch {}
  return hosts;
}
// Why this target is refused, or null.
export function refusalOf(url, { allowProduction = false } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return `"${url}" is not a web address. Give the staging server's, e.g. --url https://staging.example.com`;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return `${url} is not an http(s) address.`;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (productionHosts().has(host) && !allowProduction) {
    return `${host} is PRODUCTION (deploy/aws/site-address). A load test there would slow down or break the real event, and its synthetic accounts and event would be in the client's data. Run it against the staging copy (deploy/aws/EVENT-DAY.md). Nothing was sent.`;
  }
  return null;
}

// RFC 6238 codes (HMAC-SHA1, 6 digits, 30 s), as CORE's server/totp.js.
function base32(str) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totpAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  return String((((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]) % 1_000_000).padStart(6, '0');
}
const stepNow = () => Math.floor(Date.now() / 30000);

// ----- The synthetic guest list: 250 slots on the 5 x 5 room of tables of 10 -----
// Tables 1-2 preferred (the Super Administrator's, every chair reserved), 3-4 regular and nobody's
// (the Super Administrator seats their guests), 5-24 regular and 25 employee, owned by the staff in
// turn; each table's 10 guests are owned by the table's owner, so everyone fits where they may sit.
const SURNAMES_A = ['Abad', 'Bautista', 'Cruz', 'Dizon', 'Espino', 'Flores', 'Garcia', 'Hernandez', 'Ilagan', 'Jimenez', 'Katigbak', 'Lopez', 'Mendoza', 'Navarro', 'Ocampo', 'Pascual', 'Quinto', 'Reyes', 'Santos', 'Torres', 'Umali', 'Valdez', 'Villareal', 'Yap', 'Zamora'];
const SURNAMES_B = ['Alba', 'Baylon', 'Cortez', 'Dimaculangan', 'Estrada', 'Fajardo', 'Gatchalian', 'Lacson', 'Macaraeg', 'Panganiban'];
const FIRST = ['Ana', 'Ben', 'Carla', 'Dante', 'Elena', 'Fe', 'Gino', 'Hazel', 'Ivan', 'Joy', 'Karl', 'Lea', 'Mark', 'Nina', 'Oscar', 'Paz', 'Rico', 'Sol', 'Tess', 'Vic'];
export function tablePlan(staffCount) {
  const owner = (n) => (n <= 4 || !staffCount ? null : (n - 5) % staffCount);
  return Array.from({ length: 25 }, (_, i) => {
    const n = i + 1;
    return { number: n, classification: n <= 2 ? 'preferred' : n === 25 ? 'employee' : 'regular', owner: owner(n) };
  });
}
export function syntheticGuests(count, staffCount, rand) {
  const plan = tablePlan(staffCount);
  const slots = [];
  for (const t of plan) for (let c = 1; c <= 10; c++) slots.push({ table: t.number, seat: c, classification: t.classification, owner: t.owner });
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots.slice(0, Math.min(count, slots.length)).map((s, i) => ({
    key: `LT-${String(i + 1).padStart(3, '0')}`, first: FIRST[i % FIRST.length], last: `${SURNAMES_A[i % 25]}-${SURNAMES_B[Math.floor(i / 25) % 10]}`,
    company: `Load Test Co ${String((i % 40) + 1).padStart(2, '0')}`, email: `guest${String(i + 1).padStart(3, '0')}@loadtest.invalid`,
    mobile: `0917 000 ${String(1000 + i).padStart(4, '0')}`, last4: String(1000 + i).padStart(4, '0'),
    classification: s.classification, owner: s.owner, table: s.classification === 'preferred' ? s.table : null, seat: s.classification === 'preferred' ? s.seat : null,
  }));
}
const csvCell = (v) => (/[",\r\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
export function guestCsv(guests, staffNames) {
  const rows = [['External key', 'First name', 'Surname', 'Company', 'Email', 'Mobile', 'Classification', 'Personnel', 'Table', 'Seat']];
  for (const g of guests) rows.push([g.key, g.first, g.last, g.company, g.email, g.mobile, g.classification, g.owner == null ? '' : staffNames[g.owner], g.table ?? '', g.seat ?? '']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
// Arrival offsets over `duration`: 20% in the first quarter, 55% in the peak (25-55%), 25% after.
export function arrivalTimes(count, duration, rand) {
  const pieces = [[0, 0.25, 0.2], [0.25, 0.55, 0.55], [0.55, 1, 0.25]];
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = rand();
    let acc = 0;
    let piece = pieces[2];
    for (const p of pieces) {
      acc += p[2];
      if (x < acc) {
        piece = p;
        break;
      }
    }
    out.push(Math.round((piece[0] + rand() * (piece[1] - piece[0])) * duration));
  }
  return out.sort((a, b) => a - b);
}

// ----- HTTP: one keep-alive pool, every request measured -----
export function createStats() {
  const endpoints = new Map(); // key → { n, ms: [], status: { code: n } }
  const byActor = { guest: { n: 0, status: {} }, staff: { n: 0, status: {} }, super: { n: 0, status: {} } };
  const events = []; // { at, actor, key, status, ok } (for the kill drill: kept small)
  return {
    endpoints, byActor, events,
    record(key, actor, status, ms, at) {
      const e = endpoints.get(key) || { n: 0, ms: [], status: {} };
      e.n += 1;
      e.ms.push(ms);
      e.status[status] = (e.status[status] || 0) + 1;
      endpoints.set(key, e);
      const a = byActor[actor] || (byActor[actor] = { n: 0, status: {} });
      a.n += 1;
      a.status[status] = (a.status[status] || 0) + 1;
      events.push({ at, end: at + ms, actor, key, status });
    },
  };
}

function createHttp(base, stats) {
  const u = new URL(base);
  const mod = u.protocol === 'https:' ? https : http;
  const agent = new mod.Agent({ keepAlive: true, maxSockets: 400 });
  const prefix = u.pathname.replace(/\/$/, '');
  return {
    agent,
    request({ method = 'GET', path: p, body, cookie, headers = {}, key, actor = 'staff', timeoutMs = 30000 }) {
      const started = performance.now();
      const at = Date.now();
      return new Promise((resolve) => {
        const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const req = mod.request({
          protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: prefix + p, method, agent, timeout: timeoutMs,
          headers: { Accept: 'application/json', 'User-Agent': actor === 'guest' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) event-load' : 'Mozilla/5.0 (event-load staff)', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const ms = performance.now() - started;
            const raw = Buffer.concat(chunks);
            let json = null;
            if (/json/.test(res.headers['content-type'] || '')) {
              try {
                json = JSON.parse(raw.toString('utf8'));
              } catch {}
            }
            if (key) stats.record(key, actor, res.statusCode, ms, at);
            resolve({ status: res.statusCode, data: json, bytes: raw.length, headers: res.headers, ms });
          });
          res.on('error', (err) => done(err));
        });
        const done = (err) => {
          const ms = performance.now() - started;
          if (key) stats.record(key, actor, 0, ms, at);
          resolve({ status: 0, error: err.code || err.message, data: null, ms });
        };
        req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })));
        req.on('error', done);
        if (data) req.write(data);
        req.end();
      });
    },
  };
}

// A signed-in account (staff, the Super Administrator): its cookie, signing in again after a restart
// (CORE keeps sessions in memory) with the password and, when CORE asks, a 2-step code.
function createSession(client, { username, password, totpSecret = null, actor = 'staff', ask = null, onLog = () => {} }) {
  const s = { username, password, totpSecret, actor, cookie: '', user: null, lastStep: -1, relogin: null, signIns: 0 };
  async function code() {
    if (s.totpSecret) {
      let st = stepNow();
      if (st <= s.lastStep) st = s.lastStep + 1;
      // CORE takes the step either side of now, never one used before.
      if (st > stepNow() + 1) await sleep((st - 1) * 30000 - Date.now() + 200);
      s.lastStep = st;
      return totpAt(s.totpSecret, st);
    }
    if (!ask) throw new Error(`${username} needs a 2-step code: give --totp-env, or run it in a terminal.`);
    return ask(`2-step code for ${username}: `);
  }
  async function login() {
    for (let attempt = 0; ; attempt++) {
      const r = await client.request({ method: 'POST', path: '/api/auth/login', body: { username, password: s.password }, key: 'POST /api/auth/login', actor });
      if (r.status === 0 || r.status >= 500) {
        // CORE is down (the kill drill): try again, as a person would.
        if (attempt > 600) throw new Error(`${username} could not sign in: ${r.error || r.status}`);
        await sleep(1000);
        continue;
      }
      if (r.status !== 200) throw new Error(`${username} could not sign in (${r.status}): ${r.data?.error || ''}`);
      let res = r;
      if (r.data?.twoFactorRequired) {
        for (let tries = 0; tries < 3; tries++) {
          res = await client.request({ method: 'POST', path: '/api/auth/2fa', body: { challenge: r.data.challenge, code: await code() }, key: 'POST /api/auth/2fa', actor });
          if (res.status === 200) break;
          if (!/not right/.test(res.data?.error || '')) break;
        }
        if (res.status !== 200) throw new Error(`${username}: the 2-step code was refused (${res.status}): ${res.data?.error || ''}`);
      }
      const set = [].concat(res.headers['set-cookie'] || []);
      s.cookie = set.map((c) => c.split(';')[0]).find((c) => c.includes('=')) || s.cookie;
      s.user = res.data?.user || s.user;
      s.signIns += 1;
      if (s.signIns > 1) onLog(`${username} signed in again`);
      return s;
    }
  }
  s.login = login;
  // One call; a 401 (the session is gone: CORE restarted) signs in again once, then repeats it.
  s.call = async (method, p, body, key) => {
    let r = await client.request({ method, path: p, body, cookie: s.cookie, key, actor });
    if (r.status === 401 && !p.startsWith('/api/auth/')) {
      if (!s.relogin) s.relogin = login().finally(() => { s.relogin = null; });
      await s.relogin;
      r = await client.request({ method, path: p, body, cookie: s.cookie, key, actor });
    }
    return r;
  };
  return s;
}

function asker() {
  if (!process.stdin.isTTY) return null;
  return (question) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

const ok = (r) => r.status >= 200 && r.status < 300;
const must = (r, what) => {
  if (!ok(r)) throw new Error(`${what} failed (${r.status || r.error}): ${r.data?.error || ''}${r.data?.code ? ` [${r.data.code}]` : ''}`);
  return r.data;
};

// ----- The run -----
export async function main(argv = process.argv.slice(2), { log = (m) => console.log(m), env = process.env } = {}) {
  let o;
  try {
    ({ values: o } = parseArgs({
      args: argv, strict: true,
      options: {
        url: { type: 'string' }, user: { type: 'string' }, 'password-env': { type: 'string' }, 'totp-env': { type: 'string' },
        event: { type: 'string' }, guests: { type: 'string', default: '250' }, staff: { type: 'string', default: '15' },
        duration: { type: 'string', default: '10m' }, drain: { type: 'string', default: '3m' }, 'self-share': { type: 'string', default: '0.6' },
        'mistype-share': { type: 'string', default: '0.1' }, think: { type: 'string', default: '2s' }, typing: { type: 'string', default: '4s' },
        'kill-at': { type: 'string' }, 'qr-key': { type: 'string' }, seed: { type: 'string', default: '1' }, report: { type: 'string' },
        cleanup: { type: 'boolean', default: false }, 'cleanup-only': { type: 'boolean', default: false }, [PROD_FLAG]: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
      },
    }));
  } catch (err) {
    log(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    log(USAGE);
    return 0;
  }
  if (!o.url) {
    log(`Give the staging server: --url https://…\n\n${USAGE}`);
    return 2;
  }
  // 1. Never production (before anything is sent).
  const refused = refusalOf(o.url, { allowProduction: o[PROD_FLAG] });
  if (refused) {
    log(`REFUSED: ${refused}`);
    return 2;
  }
  if (o[PROD_FLAG]) log('WARNING: running against a PRODUCTION address because you said so. Ctrl-C now to stop.');
  if (!o.user || !o['password-env'] || !env[o['password-env']]) {
    log('Give --user and --password-env VAR, with the password in that environment variable (never on the command line).');
    return 2;
  }
  let cfg;
  try {
    cfg = {
      guests: Math.max(1, Math.min(250, Number(o.guests) | 0)), staff: Math.max(0, Math.min(50, Number(o.staff) | 0)),
      duration: parseDuration(o.duration), drain: parseDuration(o.drain), selfShare: Number(o['self-share']), mistype: Number(o['mistype-share']),
      think: parseDuration(o.think, 'ms'), typing: parseDuration(o.typing, 'ms'), killAt: parseDuration(o['kill-at']), seed: Number(o.seed) || 1,
    };
  } catch (err) {
    log(err.message);
    return 2;
  }
  const rand = mulberry32(cfg.seed);
  const stats = createStats();
  const client = createHttp(o.url, stats);
  const t0 = Date.now();
  const say = (m) => log(`[${clock(Date.now() - t0)}] ${m}`);
  const report = { tool: 'scripts/event-load.mjs', version: 1, target: new URL(o.url).host, startedAt: new Date(t0).toISOString(), profile: { ...cfg, url: undefined }, notes: [] };
  const reportFile = o.report || `event-load-report-${new Date(t0).toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  const writeReport = () => {
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  };

  // 2. The operator: a CORE administrator, the event's Super Administrator.
  const sa = createSession(client, { username: o.user, password: env[o['password-env']], totpSecret: o['totp-env'] ? env[o['totp-env']] : null, actor: 'super', ask: asker(), onLog: say });
  try {
    await sa.login();
  } catch (err) {
    log(err.message);
    return 2;
  }
  const me = (await sa.call('GET', '/api/auth/status')).data?.user;
  if (!me) {
    log('Signed in, but CORE did not say who this is.');
    return 2;
  }
  if ((await sa.call('GET', '/api/customapp/apps')).status !== 200) {
    log('CUSTOM APP is off, or this account cannot use it: turn it on in Admin panel → Modules, as an administrator.');
    return 2;
  }
  const perfStart = await sa.call('GET', '/api/admin/perf');
  if (perfStart.status !== 200) report.notes.push(`GET /api/admin/perf answered ${perfStart.status}: save() and event-loop numbers need a CORE administrator (Security monitor permission).`);

  let ev;
  let created = false;
  let base;
  const staffNames = [];
  const staffIds = [];
  const staffPasswords = [];
  try {
    if (o.event) {
      base = `/api/customapp/events/${encodeURIComponent(o.event)}`;
      ev = must(await sa.call('GET', base), 'Opening the event');
      // 3. Never email a guest: the event's email must be paused before anything else happens.
      if (!ev.flags?.emailPaused) {
        log(`REFUSED: "${ev.name}" has Email paused OFF. A load test would email its guests. Turn on Email paused in Event control (and point outgoing mail at a sink, EVENT-DAY.md), then run it again. Nothing was changed.`);
        return 2;
      }
      if (ev.role !== 'super') {
        log(`You are not this event's Super Administrator (${ev.superAdmin?.name || '?'} is). Hand it over to ${me.name} first (Event control), on staging.`);
        return 2;
      }
    }
    if (o['cleanup-only']) {
      if (!ev) {
        log('--cleanup-only needs --event.');
        return 2;
      }
      await cleanup();
      return 0;
    }
    // 4. Synthetic staff accounts (an administrator's work), fresh passwords each run.
    if (cfg.staff) {
      const list = await sa.call('GET', '/api/users');
      if (list.status !== 200) {
        log('Making the synthetic staff accounts needs a CORE administrator (or run with --staff 0).');
        return 2;
      }
      for (let k = 1; k <= cfg.staff; k++) {
        const username = `loadtest-staff-${String(k).padStart(2, '0')}`;
        const pw = `Lt-${randomBytes(18).toString('base64url')}-7q`;
        let u = list.data.find((x) => x.username === username);
        if (!u) {
          u = must(await sa.call('POST', '/api/users', { name: `Load Test Staff ${String(k).padStart(2, '0')}`, username, role: 'eventstaff', password: pw, mustChangePassword: false }), `Making ${username}`);
          staffPasswords.push({ temp: null, final: pw });
        } else {
          if (u.active === false || u.role !== 'eventstaff') must(await sa.call('PUT', `/api/users/${u.id}`, { name: u.name, username, role: 'eventstaff', active: true }), `Turning ${username} on`);
          if (u.twoFactorEnabled) must(await sa.call('POST', `/api/users/${u.id}/2fa/reset`, {}), `Resetting ${username}'s 2-step`);
          const temp = `Lt-${randomBytes(18).toString('base64url')}-3x`;
          must(await sa.call('POST', `/api/users/${u.id}/reset-password`, { password: temp }), `Setting ${username}'s password`);
          staffPasswords.push({ temp, final: pw });
        }
        staffNames.push(username);
        staffIds.push(u.id);
      }
    }
    // 5. The event: made here (5 x 5 tables of 10), or the one given, with a window around now.
    const now = Date.now();
    const total = cfg.duration + cfg.drain;
    const window = { opensAt: new Date(now - 15 * 60000).toISOString(), closesAt: new Date(now + total + 2 * 3600000).toISOString() };
    if (!ev) {
      const made = must(await sa.call('POST', '/api/customapp/events', {
        name: `Load test ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`, venue: 'Load test (synthetic guests)', date: new Date(now).toISOString().slice(0, 10),
        room: { rows: 5, cols: 5, chairsPerTable: 10, stageSide: 'right', boothSide: 'left' }, superAdminUserId: me.id, window, refPrefix: 'LT',
      }), 'Making the load-test event');
      created = true;
      base = `/api/customapp/events/${made.id}`;
      ev = must(await sa.call('GET', base), 'Opening the event');
      if (!ev.flags?.emailPaused) must(await sa.call('POST', `${base}/commands`, { type: 'setFlag', flag: 'emailPaused', value: true }), 'Pausing email');
      say(`Made the event "${ev.name}" (${ev.id}), 25 tables of 10, email paused.`);
    }
    const staffNow = new Set((ev.staff || []).map((x) => x.userId));
    if (staffIds.some((id) => !staffNow.has(id))) {
      ev = must(await sa.call('PATCH', base, { rev: ev.rev, staff: [...(ev.staff || []).map((x) => ({ userId: x.userId, active: x.active !== false })), ...staffIds.filter((id) => !staffNow.has(id)).map((userId) => ({ userId }))] }), 'Putting the synthetic staff on the event');
    }
    let guests;
    if (created) {
      for (const t of tablePlan(cfg.staff)) {
        const id = ev.tables.find((x) => x.number === t.number)?.id;
        must(await sa.call('POST', `${base}/commands`, { type: 'table.update', tableId: id, classification: t.classification, ownerUserId: t.owner == null ? null : staffIds[t.owner] }), `Setting up table ${t.number}`);
      }
      const list = syntheticGuests(cfg.guests, cfg.staff, rand);
      const pv = must(await sa.call('POST', `${base}/import`, { format: 'csv', data: guestCsv(list, staffNames) }), 'Reading the guest list');
      if (pv.report.blocking) throw new Error(`The synthetic guest list has ${pv.report.blocking} problems: ${JSON.stringify(pv.report).slice(0, 400)}`);
      must(await sa.call('POST', `${base}/import/${pv.jobId}/apply`, {}), 'Importing the guest list');
      say(`Imported ${list.length} synthetic guests.`);
    }
    ev = must(await sa.call('GET', base), 'Opening the event');
    ev = must(await sa.call('PATCH', base, { rev: ev.rev, status: 'live', window }), 'Making the event live with its window around now');
    must(await sa.call('POST', `${base}/commands`, { type: 'importAck' }), 'Acknowledging the import check');
    if (!ev.flags?.registrationOpen) must(await sa.call('POST', `${base}/commands`, { type: 'setFlag', flag: 'registrationOpen', value: true }), 'Opening self check-in');
    ev = must(await sa.call('GET', base), 'Opening the event');
    if (!ev.flags?.emailPaused) throw new Error('Email paused went off during set-up: stopping.');
    if (ev.qrKey && !o['qr-key']) report.notes.push('The event has a presence key and --qr-key was not given: every guest goes to the desk.');
    // The guests, as the Super Administrator sees them (surname, last 4 of the mobile, owner, seat).
    const gl = must(await sa.call('GET', `${base}/guests?limit=300`), 'Reading the guest list');
    guests = gl.guests.filter((g) => g.active !== false && g.arrival?.state === 'expected' && g.classification !== 'unlisted').map((g) => ({
      id: g.id, ref: g.ref, last: g.name?.last || '', last4: (String(g.mobile || '').match(/(\d{4})$/) || [])[1] || '', owner: g.ownerUserId,
    }));
    if (gl.total > 300) report.notes.push(`The event has ${gl.total} guests; the first 300 are used.`);
    guests = guests.slice(0, cfg.guests);
    report.event = { id: ev.id, code: ev.code, name: ev.name, created, guests: guests.length, tables: ev.tables.length };
    if (!guests.length) throw new Error('No guest of this event is still expected: nothing to check in.');

    // 6. Staff sign in (inside the event's window, as on the night: the venue allowance applies).
    const staff = [];
    for (let k = 0; k < staffNames.length; k++) {
      const p = staffPasswords[k];
      const s = createSession(client, { username: staffNames[k], password: p.temp || p.final, onLog: say });
      await s.login();
      if (p.temp) {
        must(await s.call('POST', '/api/auth/change-password', { currentPassword: p.temp, newPassword: p.final }), `${staffNames[k]} choosing a password`);
        s.password = p.final;
      }
      const tf = (await s.call('GET', '/api/me/2fa')).data;
      if (tf?.required && !tf.enabled) {
        const setup = must(await s.call('POST', '/api/me/2fa/setup', { password: s.password }), `${staffNames[k]} setting up 2-step`);
        s.totpSecret = setup.secret;
        const st = stepNow();
        must(await s.call('POST', '/api/me/2fa/enable', { code: totpAt(setup.secret, st) }), `${staffNames[k]} turning on 2-step`);
        s.lastStep = st;
      }
      s.id = staffIds[k];
      s.desk = k < Math.max(1, Math.ceil(staffNames.length / 3));
      s.seq = null;
      s.waiting = [];
      staff.push(s);
    }
    say(`${staff.length} staff signed in${staff.length ? ` (${staff.filter((s) => s.desk).length} at the desk)` : ''}.`);

    // 7. Drive the ballroom.
    const perfSince = perfStart.status === 200 ? (await sa.call('GET', '/api/admin/perf')).data?.now ?? perfStart.data.now : null;
    const run = { running: true, started: Date.now(), deskQueue: [], inFlight: new Set(), killAt: null, outageAt: null, recoveredAt: null, counts: null };
    const countsAtStart = ev.counts || { checkedIn: 0 };
    // Every wait in the loops ends at once when the run stops.
    let wake;
    const stopped = new Promise((r) => {
      wake = r;
    });
    const nap = (ms) => Promise.race([sleep(ms), stopped]);
    const stop = () => {
      run.running = false;
      wake();
    };
    const code = ev.code;
    const times = arrivalTimes(guests.length, cfg.duration, rand);
    const tally = { arrived: 0, selfOk: 0, deskOk: 0, already: 0, referrals: {}, mistyped: 0, seatedByStaff: 0, seatConflicts: 0, noOption: 0, busy: 0 };
    const gstate = new Map(guests.map((g) => [g.id, { ...g, checkedInAt: null, seatedAt: null, ack: null }]));
    const jitter = (ms) => ms * (0.5 + rand());
    const foreign = (g) => Boolean(g?.owner) && !staffIds.includes(g.owner) && g.owner !== me.id;
    const markIn = (g, how) => {
      if (!g.checkedInAt) g.checkedInAt = Date.now();
      g.ack = g.ack || how;
    };
    const markSeated = (g) => {
      if (!g.seatedAt) g.seatedAt = Date.now();
    };

    // A desk check-in, by a staffer (or the Super Administrator when there are no staff).
    async function deskCheckIn(s, g) {
      const found = await s.call('GET', `${base}/guests?q=${encodeURIComponent(g.last)}`, undefined, 'GET find guest');
      if (!ok(found)) return false;
      const hit = (found.data.guests || []).find((x) => x.id === g.id);
      if (hit?.arrival?.state === 'checked_in') {
        markIn(g, 'already');
        return true;
      }
      const r = await s.call('POST', `${base}/commands`, { type: 'checkIn', guestId: g.id, opId: `lt-ci-${g.id}` }, 'POST command checkIn');
      if (ok(r)) {
        tally.deskOk += 1;
        markIn(g, 'desk');
        if ((r.data.guests || [])[0]?.seat?.status === 'confirmed') markSeated(g);
        return true;
      }
      if (r.data?.code === 'already_checked_in') {
        tally.already += 1;
        markIn(g, 'already');
        return true;
      }
      return false; // network or server error: the desk tries again
    }

    // A guest's phone: the page, the form (a mistype sometimes), then the status at the server's pace.
    async function guestPhone(g) {
      const phone = { actor: 'guest' };
      await client.request({ path: `/api/public/event/${code}`, key: 'GET guest page', ...phone });
      await nap(cfg.typing * (0.5 + rand()));
      const send = (last4) => client.request({ method: 'POST', path: `/api/public/event/${code}/verify`, body: { surname: g.last, last4, elapsedMs: Math.max(2000, cfg.typing), website: '', ...(o['qr-key'] ? { k: o['qr-key'] } : {}) }, key: 'POST verify', ...phone });
      if (rand() < cfg.mistype) {
        tally.mistyped += 1;
        await send(String((Number(g.last4) + 1) % 10000).padStart(4, '0'));
        await nap(1500);
      }
      let r;
      for (let attempt = 0; attempt < 3; attempt++) {
        r = await send(g.last4);
        if (r.status !== 0 && r.status < 500) break;
        await nap(3000);
      }
      if (!r.data?.token) {
        // Referred to the desk: why (staff read it by the code), then the desk checks them in.
        let why = r.status ? 'unknown' : 'network';
        if (r.data?.referral) {
          const ref = await sa.call('GET', `${base}/referral/${r.data.referral}`, undefined, 'GET referral');
          why = ref.data?.reason || why;
        }
        tally.referrals[why] = (tally.referrals[why] || 0) + 1;
        if (why === 'busy') tally.busy += 1;
        run.deskQueue.push(g);
        return;
      }
      tally.selfOk += 1;
      markIn(g, 'self');
      let seq = r.data.seq;
      let pollMs = r.data.pollMs || 4000;
      if (r.data.state === 'seated') markSeated(g);
      while (run.running) {
        await nap(pollMs);
        if (!run.running) break;
        const st = await client.request({ path: `/api/public/event/${code}/status?since=${seq}`, headers: { 'X-Event-Token': r.data.token }, key: 'GET status', ...phone });
        if (!ok(st)) {
          pollMs = Math.min(15000, pollMs * 1.5);
          continue;
        }
        pollMs = st.data.pollMs || pollMs;
        seq = st.data.seq ?? seq;
        if (st.data.state === 'seated') markSeated(g);
      }
    }

    // Seat one waiting guest from their sheet: the first table they may use with a free chair, its
    // lowest free chair, with the revisions seen; a conflict is read again and tried again.
    async function seatOne(s, guestId, isSuper) {
      const g = gstate.get(guestId);
      for (let attempt = 0; attempt < 3 && run.running; attempt++) {
        const sheet = await s.call('GET', `${base}/guests/${guestId}`, undefined, 'GET guest sheet');
        if (!ok(sheet)) return;
        const guest = sheet.data.guest;
        if (guest.seat) {
          if (g && guest.seat.status === 'confirmed') markSeated(g);
          return;
        }
        if (guest.arrival?.state !== 'checked_in') return;
        let options = (sheet.data.options || []).filter((t) => t.mine && t.active && t.free > 0);
        // The Super Administrator seats the guests nobody owns at the tables nobody owns, so the staff's
        // tables keep their chairs for the staff's guests; a guest of an owner with no session here
        // (load test 2, the real list) takes the recommended table, as on screen.
        if (isSuper && !foreign(g)) options = [...options.filter((t) => !t.ownerUserId && t.classification !== 'preferred'), ...options.filter((t) => !t.ownerUserId && t.classification === 'preferred'), ...options.filter((t) => t.ownerUserId)];
        const t = options[0];
        if (!t) {
          tally.noOption += 1;
          return;
        }
        const taken = new Set(t.taken || []);
        let seatNo = 1;
        while (taken.has(seatNo) && seatNo < t.capacity) seatNo++;
        const r = await s.call('POST', `${base}/commands`, { type: 'assign', guestId, tableId: t.id, seatNo, opId: `lt-seat-${guestId}-${attempt}`, expect: { [guestId]: guest.rev || 0, [t.id]: t.rev || 0 } }, 'POST command assign');
        if (ok(r)) {
          tally.seatedByStaff += 1;
          if (g) markSeated(g);
          return;
        }
        if (r.status === 409) {
          tally.seatConflicts += 1;
          continue;
        }
        return;
      }
    }

    async function pollBoard(s, isSuper) {
      while (run.running) {
        const r = await s.call('GET', `${base}/changes${s.seq == null ? '' : `?since=${s.seq}`}`, undefined, isSuper ? 'GET changes (super)' : 'GET changes (staff)');
        if (ok(r)) {
          s.seq = r.data.seq;
          if (r.data.board) s.waiting = (r.data.board.waiting || []).map((x) => x.id);
          await nap(r.data.pollMs || 2000);
        } else await nap(2000);
      }
    }
    async function staffWork(s) {
      while (run.running) {
        if ((s.desk || !staff.length) && run.deskQueue.length) {
          const g = run.deskQueue.shift();
          if (!(await deskCheckIn(s, g))) {
            run.deskQueue.push(g);
            await nap(1000);
          }
          await nap(jitter(cfg.think));
          continue;
        }
        // The Super Administrator also seats the guests whose owner has no session in this run.
        const next = s.waiting.find((id) => !run.inFlight.has(id))
          || (s === sa ? [...gstate.values()].find((g) => foreign(g) && g.checkedInAt && !g.seatedAt && !run.inFlight.has(g.id) && Date.now() - (g.triedAt || 0) > 10000)?.id : null);
        if (next) {
          run.inFlight.add(next);
          s.waiting = s.waiting.filter((id) => id !== next);
          if (gstate.has(next)) gstate.get(next).triedAt = Date.now();
          try {
            await seatOne(s, next, s === sa);
          } finally {
            run.inFlight.delete(next);
          }
          await nap(jitter(cfg.think));
          continue;
        }
        await nap(200);
      }
    }
    // The Super Administrator's other screens: Event control, the room, the inbox, the rules check,
    // and the export the laptop pulls every print cycle.
    async function superExtras() {
      let tick = 0;
      while (run.running) {
        await nap(5000);
        if (!run.running) break;
        tick += 1;
        const c = await sa.call('GET', `${base}/changes?tab=control`, undefined, 'GET changes (control)');
        if (ok(c) && c.data.board?.counts) run.counts = c.data.board.counts;
        if (tick % 6 === 0) await sa.call('GET', `${base}/room`, undefined, 'GET room');
        if (tick % 12 === 0) {
          await sa.call('GET', `${base}/exceptions`, undefined, 'GET exceptions');
          await sa.call('GET', `${base}/invariants`, undefined, 'GET invariants');
        }
        if (tick % 30 === 0) await sa.call('GET', `${base}/export.json`, undefined, 'GET export.json');
      }
    }

    // The kill -9 drill: the export before, the prompt, then when staff are back.
    let beforeKill = null;
    async function killDrill() {
      await nap(cfg.killAt);
      if (!run.running) return;
      const exp = await sa.call('GET', `${base}/export.json`, undefined, 'GET export.json');
      beforeKill = ok(exp) ? new Set(exp.data.guests.filter((g) => g.arrival?.state === 'checked_in').map((g) => g.id)) : null;
      const acked = new Set([...gstate.values()].filter((g) => g.ack && g.ack !== 'already').map((g) => g.id));
      run.ackedBeforeKill = acked;
      run.killAt = Date.now();
      log('');
      log('================================================================================');
      log(` EVENT-LOAD-KILL-NOW ${new Date(run.killAt).toISOString()}`);
      log(' KILL NOW: on the server (Session Manager), run:');
      log('     sudo systemctl kill -s KILL ltdc-erp');
      log(` ${beforeKill ? beforeKill.size : '?'} guests checked in in the export just taken; the clock for "staff back in" starts at the first failed request.`);
      log('================================================================================');
      log('');
    }

    say(`Running: ${guests.length} arrivals over ${clock(cfg.duration)}, then up to ${clock(cfg.drain)} to seat everyone. Ctrl-C stops it.`);
    const tasks = [];
    for (const s of staff) tasks.push(pollBoard(s, false), staffWork(s));
    sa.seq = null;
    sa.waiting = [];
    tasks.push(pollBoard(sa, true), staffWork(sa), superExtras());
    if (cfg.killAt != null) tasks.push(killDrill());
    const phones = [];
    const arrivals = (async () => {
      for (let i = 0; i < guests.length; i++) {
        await nap(run.started + times[i] - Date.now());
        if (!run.running) break;
        const g = gstate.get(guests[i].id);
        tally.arrived += 1;
        const self = g.last4 && !(ev.qrKey && !o['qr-key']) && rand() < cfg.selfShare;
        if (self) phones.push(guestPhone(g));
        else run.deskQueue.push(g);
      }
    })();
    const progress = setInterval(() => {
      const all = [...gstate.values()];
      const non2xx = {};
      for (const e of stats.endpoints.values()) for (const [st, n] of Object.entries(e.status)) if (!(st >= 200 && st < 300)) non2xx[st] = (non2xx[st] || 0) + n;
      say(`arrived ${tally.arrived}/${guests.length} · checked in ${all.filter((g) => g.checkedInAt).length} · seated ${all.filter((g) => g.seatedAt).length} · at the desk ${run.deskQueue.length} · requests ${stats.events.length}${Object.keys(non2xx).length ? ` · non-2xx ${Object.entries(non2xx).map(([k, v]) => `${k === '0' ? 'network' : k}×${v}`).join(' ')}` : ''}`);
    }, 15000);
    progress.unref();
    let stopping = false;
    const onSigint = () => {
      if (stopping) process.exit(130);
      stopping = true;
      say('Stopping (Ctrl-C again to quit at once)…');
      stop();
    };
    process.once('SIGINT', onSigint);
    await arrivals;
    const drainUntil = Date.now() + cfg.drain;
    while (run.running && Date.now() < drainUntil) {
      const all = [...gstate.values()];
      const arrivedAll = tally.arrived >= guests.length;
      // Everyone in and seated: as this script saw it, or as the server counts it (an answer lost in
      // the kill drill leaves the script unsure, the server is not).
      const done = all.every((g) => g.checkedInAt && g.seatedAt) || Boolean(run.counts && run.counts.checkedIn >= countsAtStart.checkedIn + guests.length && run.counts.waiting === 0);
      const killDone = cfg.killAt == null || (run.killAt && (run.recoveredAt || Date.now() - run.killAt > 5 * 60000));
      if (arrivedAll && done && !run.deskQueue.length && killDone) break;
      if (run.killAt && run.recoveredAt == null) {
        const failed = stats.events.find((e) => e.end >= run.killAt && (e.status === 0 || e.status >= 502));
        if (failed) {
          run.outageAt = failed.end;
          const back = stats.events.find((e) => e.at > failed.end && e.actor !== 'guest' && e.status >= 200 && e.status < 300 && !e.key.includes('/api/auth/'));
          if (back) run.recoveredAt = back.end;
        }
      }
      await nap(250);
    }
    stop();
    clearInterval(progress);
    process.removeListener('SIGINT', onSigint);
    await Promise.race([Promise.allSettled([...tasks, ...phones]), sleep(40000)]);
    if (run.killAt && run.recoveredAt == null) {
      const failed = stats.events.find((e) => e.end >= run.killAt && (e.status === 0 || e.status >= 502));
      if (failed) {
        run.outageAt = failed.end;
        const back = stats.events.find((e) => e.at > failed.end && e.actor !== 'guest' && e.status >= 200 && e.status < 300 && !e.key.includes('/api/auth/'));
        if (back) run.recoveredAt = back.end;
      }
    }
    report.endedAt = new Date().toISOString();
    say('Arrivals done; reading the server\'s numbers and checking the rules.');

    // 8. The server's side, the rules scan and the export.
    const perfEnd = perfSince != null ? await sa.call('GET', `/api/admin/perf?since=${perfSince}`) : null;
    const control = await sa.call('GET', `${base}/changes?tab=control`);
    const inv = await sa.call('GET', `${base}/invariants`, undefined, 'GET invariants');
    const exp = await sa.call('GET', `${base}/export.json`, undefined, 'GET export.json');
    const all = [...gstate.values()];
    const endpoints = [...stats.endpoints.entries()].map(([key, e]) => {
      const xs = [...e.ms].sort((a, b) => a - b);
      return { key, n: e.n, p50: r1(percentile(xs, 50)), p95: r1(percentile(xs, 95)), p99: r1(percentile(xs, 99)), max: r1(xs.at(-1)), status: e.status };
    }).sort((a, b) => b.n - a.n);
    const byStatus = {};
    for (const e of endpoints) for (const [st, n] of Object.entries(e.status)) byStatus[st] = (byStatus[st] || 0) + n;
    const nonOk = Object.fromEntries(Object.entries(byStatus).filter(([st]) => !(Number(st) >= 200 && Number(st) < 300)));
    const in429 = (a) => stats.byActor[a]?.status?.[429] || 0;
    // The drill's own failures: answers that came after the prompt (a request in flight when CORE was
    // killed included), until a few seconds after staff were back.
    const outage = (e) => run.killAt && e.end >= run.killAt && (!run.recoveredAt || e.at <= run.recoveredAt + 5000);
    const serverErrors = stats.events.filter((e) => (e.status === 0 || e.status >= 500) && !outage(e)).length;
    const toSeat = all.filter((g) => g.checkedInAt && g.seatedAt).map((g) => (g.seatedAt - g.checkedInAt) / 1000).sort((a, b) => a - b);
    report.requests = { total: stats.events.length, byStatus, nonOk, byActor: stats.byActor, endpoints };
    // Checked in and seated as the server has them (the export), else as this script saw them.
    const truth = ok(exp) ? new Map(exp.data.guests.map((g) => [g.id, g])) : null;
    const isIn = (g) => (truth ? truth.get(g.id)?.arrival?.state === 'checked_in' : Boolean(g.checkedInAt));
    const isSeated = (g) => (truth ? truth.get(g.id)?.seat?.status === 'confirmed' : Boolean(g.seatedAt));
    report.guests = {
      total: all.length, arrived: tally.arrived, checkedIn: all.filter(isIn).length, seated: all.filter(isSeated).length,
      viaGuestPage: tally.selfOk, viaDesk: tally.deskOk, alreadyIn: tally.already, mistypedFirst: tally.mistyped, referrals: tally.referrals,
      checkedInToSeatedSec: { p50: r1(percentile(toSeat, 50)), p90: r1(percentile(toSeat, 90)), max: r1(toSeat.at(-1)) },
    };
    report.staff = { accounts: staff.length, seatedByStaffOrSuper: tally.seatedByStaff, seatConflicts409: tally.seatConflicts, noTableOffered: tally.noOption };
    const perf = perfEnd && ok(perfEnd) ? perfEnd.data : null;
    report.server = { perf: perf ? { since: perf.since, save: perf.save, loop: { ...perf.loop, windows: perf.loop.windows.length } } : null, health: control.data?.board?.health || null };

    // The rules: GET …/invariants (the engine's own check) and the export (the change log).
    const violations = ok(inv) ? inv.data.violations : null;
    const extra = { duplicateCheckIns: null, releasedWithoutActor: null, preferredWithoutSeat: null, superAdmins: null };
    if (ok(exp)) {
      const ins = new Map();
      for (const c of exp.data.changes) {
        for (const d of c.diff || []) if (d.f === 'arrival' && d.to === 'checked_in') ins.set(d.id, (ins.get(d.id) || 0) + 1);
        for (const d of c.diff || []) if (d.f === 'arrival' && d.from === 'checked_in' && d.to !== 'checked_in') ins.set(d.id, (ins.get(d.id) || 0) - 1);
      }
      extra.duplicateCheckIns = [...ins.values()].filter((n) => n > 1).length;
      extra.releasedWithoutActor = exp.data.changes.filter((c) => c.type === 'release' && !c.actorId).length;
      extra.preferredWithoutSeat = created ? exp.data.guests.filter((g) => g.classification === 'preferred' && !g.seat).length : null;
      extra.superAdmins = typeof exp.data.event.superAdminUserId === 'string' && exp.data.event.superAdminUserId ? 1 : 0;
    }
    report.invariants = { violations, ...extra };

    // The kill drill: how long until staff were back, and whether any committed check-in was lost.
    if (cfg.killAt != null) {
      const finalIn = ok(exp) ? new Set(exp.data.guests.filter((g) => g.arrival?.state === 'checked_in').map((g) => g.id)) : null;
      const lostExport = beforeKill && finalIn ? [...beforeKill].filter((id) => !finalIn.has(id)) : null;
      const lostAcked = run.ackedBeforeKill && finalIn ? [...run.ackedBeforeKill].filter((id) => !finalIn.has(id)) : null;
      report.kill = {
        promptedAt: run.killAt ? new Date(run.killAt).toISOString() : null, outageAt: run.outageAt ? new Date(run.outageAt).toISOString() : null,
        recoveredAt: run.recoveredAt ? new Date(run.recoveredAt).toISOString() : null, recoverSec: run.outageAt && run.recoveredAt ? r1((run.recoveredAt - run.outageAt) / 1000) : null,
        checkedInBefore: beforeKill ? beforeKill.size : null, lostFromExport: lostExport, lostAcknowledged: lostAcked, staffSignIns: staff.reduce((n, s) => n + s.signIns, 0),
      };
    }

    // 9. The gates.
    const gates = [];
    const gate = (id, name, pass, value, limit, note = '') => gates.push({ id, name, pass: Boolean(pass), value, limit, note });
    gate('AC-186', 'No 429 (Too many requests) to guests or staff', in429('guest') + in429('staff') + in429('super') + tally.busy === 0, in429('guest') + in429('staff') + in429('super') + tally.busy, 0, `guests ${in429('guest')}, staff ${in429('staff')}, Super Administrator ${in429('super')}, guest page "busy" referrals ${tally.busy}`);
    gate('AC-187', 'save() p95 under 100 ms', perf && perf.save.count > 0 && perf.save.p95 < GATES.saveP95Ms, perf ? perf.save.p95 : null, GATES.saveP95Ms, perf ? `${perf.save.count} saves, p50 ${perf.save.p50} ms, max ${perf.save.max} ms` : 'not measured: GET /api/admin/perf needs a CORE administrator');
    gate('AC-188', 'Event-loop delay p99 under 200 ms', perf && perf.loop.count > 0 && perf.loop.p99 < GATES.loopP99Ms, perf ? perf.loop.p99 : null, GATES.loopP99Ms, perf ? `max ${perf.loop.max} ms, worst 10 s window p99 ${perf.loop.worstWindowP99} ms` : 'not measured');
    const invBad = violations == null ? null : violations.length + (extra.duplicateCheckIns || 0) + (extra.releasedWithoutActor || 0) + (extra.preferredWithoutSeat || 0) + (extra.superAdmins === 1 ? 0 : 1);
    gate('AC-189', 'Rules scan clean (no overbooked table, duplicate check-in, double seat or reservation released by expiry; one Super Administrator)', invBad === 0, invBad, 0, violations == null ? `the scan could not run (${inv.status})` : violations.map((v) => `${v.rule}: ${v.detail}`).join(' ').slice(0, 300));
    gate('ERR', 'No server errors (5xx or no answer) outside the kill drill', serverErrors === 0, serverErrors, 0);
    if (cfg.killAt != null) {
      const k = report.kill;
      gate('AC-190', 'Staff back in within 3 minutes of the kill', k.recoverSec != null && k.recoverSec <= GATES.recoverSec, k.recoverSec, GATES.recoverSec, k.outageAt ? (k.recoveredAt ? '' : 'staff were not back before the run ended') : 'no outage was seen: was the server killed?');
      const lost = (k.lostFromExport?.length ?? 0) + (k.lostAcknowledged?.length ?? 0);
      gate('AC-191', 'No committed check-in lost (export before the kill and acknowledged check-ins)', k.lostFromExport != null && lost === 0, k.lostFromExport == null ? null : lost, 0, `${k.checkedInBefore ?? '?'} checked in before the kill`);
    }
    report.info = { allCheckedIn: report.guests.checkedIn === all.length, allSeated: report.guests.seated === all.length };
    report.gates = gates;
    report.pass = gates.every((g) => g.pass);
    writeReport();

    // 10. On the screen.
    log('');
    log('Requests by endpoint (ms)');
    log(`  ${'endpoint'.padEnd(30)} ${'n'.padStart(6)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'p99'.padStart(7)} ${'max'.padStart(7)}  non-2xx`);
    for (const e of endpoints) {
      const bad = Object.entries(e.status).filter(([st]) => !(Number(st) >= 200 && Number(st) < 300)).map(([st, n]) => `${st === '0' ? 'network' : st}×${n}`).join(' ');
      log(`  ${e.key.slice(0, 30).padEnd(30)} ${String(e.n).padStart(6)} ${String(e.p50).padStart(7)} ${String(e.p95).padStart(7)} ${String(e.p99).padStart(7)} ${String(e.max).padStart(7)}  ${bad}`);
    }
    log('');
    log(`Guests: ${report.guests.checkedIn}/${all.length} checked in (${tally.selfOk} on the guest page, ${tally.deskOk} at the desk), ${report.guests.seated} seated; checked in to seated p50 ${report.guests.checkedInToSeatedSec.p50 ?? '-'} s, p90 ${report.guests.checkedInToSeatedSec.p90 ?? '-'} s.`);
    if (Object.keys(tally.referrals).length) log(`Guest page referrals to the desk: ${Object.entries(tally.referrals).map(([k, v]) => `${k} ${v}`).join(', ')} (after ${tally.mistyped} deliberate mistypes).`);
    for (const n of report.notes) log(`Note: ${n}`);
    log('');
    for (const g of gates) log(`${g.pass ? 'PASS' : 'FAIL'}  ${g.id.padEnd(7)} ${g.name}: ${g.value ?? 'n/a'}${g.limit != null ? ` (limit ${g.limit})` : ''}${g.note ? `  [${g.note}]` : ''}`);
    log('');
    log(`${report.pass ? 'ALL GATES PASS' : 'SOME GATES FAILED'}. Report: ${path.resolve(reportFile)}`);
    if (o.cleanup) await cleanup();
    else if (created) log(`The load-test event stays on staging (${ev.name}). Remove it with: --event ${ev.id} --cleanup-only`);
    client.agent.destroy();
    return report.pass ? 0 : 1;
  } catch (err) {
    log(`STOPPED: ${err.message}`);
    report.error = err.message;
    try {
      writeReport();
    } catch {}
    client.agent.destroy();
    return 1;
  }

  // Self check-in off, the event archived, the synthetic staff disabled.
  async function cleanup() {
    let cur = must(await sa.call('GET', base), 'Opening the event');
    if (cur.flags?.registrationOpen) await sa.call('POST', `${base}/commands`, { type: 'setFlag', flag: 'registrationOpen', value: false });
    cur = must(await sa.call('GET', base), 'Opening the event');
    must(await sa.call('PATCH', base, { rev: cur.rev, status: 'archived' }), 'Archiving the event');
    const users = await sa.call('GET', '/api/users');
    let off = 0;
    if (ok(users)) {
      for (const u of users.data.filter((x) => /^loadtest-staff-\d+$/.test(x.username) && x.active !== false)) {
        if (ok(await sa.call('PUT', `/api/users/${u.id}`, { name: u.name, username: u.username, role: u.role, active: false }))) off += 1;
      }
    }
    log(`Clean-up: "${cur.name}" archived (self check-in off); ${off} synthetic staff account${off === 1 ? '' : 's'} disabled.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(1);
  });
}
