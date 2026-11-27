// CUSTOM APP → events: races over real sockets (US-013, AC-080). A CORE server in its own process,
// with its rate limits on; ten requests for the last chair sent at once, and two check-ins of one
// guest at once. Node runs one commit at a time and nothing is awaited inside it, so exactly one
// request wins each race.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvOf } from './support/customapp-kit.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = 'Race-Condition-42';
let server;
let BASE;
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
function apiAs() {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return call;
}

before(async () => {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-race-'));
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_FILE: path.join(dir, 'db.json'), OPEN_BROWSER: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${BASE}/api/public/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
});
after(() => server?.kill());

test('GIVEN one free seat and a real listening server WHEN 10 parallel requests claim it and two parallel check-ins target one guest THEN one 200 and nine 409 table_full, one check-in, and invariants []', async () => {
  const admin = apiAs();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await admin('PUT', '/api/admin/modules', { modules: { customapp: true } });
  // Two staff devices of the Super Administrator, signed in separately.
  await admin('POST', '/api/users', { name: 'Lea Lead', username: 'lead', role: 'eventstaff', password: PW, mustChangePassword: false });
  const devices = [apiAs(), apiAs()];
  for (const d of devices) assert.equal((await d('POST', '/api/auth/login', { username: 'lead', password: PW })).status, 200);
  const lead = devices[0];
  const leadId = (await admin('GET', '/api/users')).body.find((u) => u.username === 'lead').id;
  const ev = (await admin('POST', '/api/customapp/events', { name: 'Race Night', room: { rows: 1, cols: 2, chairsPerTable: 10, stageSide: 'right' }, superAdminUserId: leadId })).body;
  const base = `/api/customapp/events/${ev.id}`;
  // Table 1: 9 chairs reserved, one left. Table 2 has room (so the losers get table_full, not a referral).
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => [`H${i}`, 'Held', `Holder${i}`, 'Acme', '', '', `0917 000 ${2000 + i}`, 'regular', '', '1', String(i + 1)]),
    ...Array.from({ length: 10 }, (_, i) => [`W${i}`, 'Wait', `Waiter${i}`, 'Acme', '', '', `0918 000 ${3000 + i}`, 'regular', '', '', '']),
    ['Q1', 'Twice', 'Arrived', 'Acme', '', '', '0919 000 4000', 'regular', '', '', ''],
  ];
  const pv = (await lead('POST', `${base}/import`, { format: 'csv', data: csvOf(rows) })).body;
  assert.equal(pv.report.blocking, 0, JSON.stringify(pv.report));
  assert.equal((await lead('POST', `${base}/import/${pv.jobId}/apply`, {})).status, 200);
  const guests = (await lead('GET', `${base}/guests?limit=100`)).body.guests;
  const waiting = guests.filter((g) => g.ref && /Waiter/.test(g.name.last));
  for (const g of waiting) assert.equal((await lead('POST', `${base}/commands`, { type: 'checkIn', guestId: g.id })).status, 200);
  const t1 = (await lead('GET', base)).body.tables.find((t) => t.number === 1);
  assert.equal(t1.free, 1);

  const results = await Promise.all(waiting.map((g, i) => devices[i % 2]('POST', `${base}/commands`, { type: 'assign', guestId: g.id, tableId: t1.id, seatNo: 10, opId: `race-${i}` })));
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
  assert.ok(results.filter((r) => r.status === 409).every((r) => ['table_full', 'seat_taken'].includes(r.body.code)), JSON.stringify(results.map((r) => r.body.code)));
  assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.code === 'table_full'), 'the chair and the table are both gone: the table is full');
  assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.fresh.options.some((o) => o.number === 2)), 'each loser is told where there is room');

  // Two devices check the same guest in at the same moment: one check-in.
  const q = guests.find((g) => g.name.last === 'Arrived');
  const twice = await Promise.all(devices.map((d, i) => d('POST', `${base}/commands`, { type: 'checkIn', guestId: q.id, opId: `twice-${i}` })));
  assert.deepEqual(twice.map((r) => r.status).sort(), [200, 409]);
  assert.equal(twice.find((r) => r.status === 409).body.code, 'already_checked_in');

  const check = (await lead('GET', `${base}/invariants`)).body;
  assert.deepEqual(check.violations, []);
  const after = (await lead('GET', base)).body;
  assert.equal(after.tables.find((t) => t.number === 1).claims, 10);
  assert.equal(after.counts.checkedIn, 11);
});
