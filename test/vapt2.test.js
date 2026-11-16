// Regression tests for the fixes of the second security assessment (0.33.0): one group per finding.
// Findings: A (sign-in, sessions, HTTP), B (access control), C (injection, uploads), D (business
// logic, data protection, audit, deployment).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { createAudit } from '../server/audit.js';
import { createSecrets } from '../server/secrets.js';
import { checkGif } from '../server/attachments.js';
import { linkTicketOwners } from '../server/helpdesk.js';
import { renderMarkdown } from '../shared/markdown.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = 'Correct-Horse-42';
const tmpDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `ltdc-vapt2-${name}-`));

// The API in-process, one cookie per account; errors come back as { status, error }.
function browser(handle) {
  let cookie = '';
  const c = async (method, url, body = {}) => {
    try {
      const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.5' } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res.data;
    } catch (err) {
      return { status: err.status, error: err.message };
    }
  };
  return c;
}
async function company(name) {
  const db = openDb(path.join(tmpDir(name), 'db.json'));
  const handle = createApi(db);
  const admin = browser(handle);
  await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: PW });
  let n = 0;
  const employee = (firstName, extra = {}) => admin('POST', '/api/employees', { employeeNo: `E-${++n}`, firstName, lastName: 'Test', hireDate: '2020-01-01', payType: 'monthly', rate: 30000, email: `${firstName.toLowerCase()}@example.com`, ...extra });
  const account = async (username, role, employeeId = null) => {
    const u = await admin('POST', '/api/users', { name: username, username, role, employeeId, password: PW, mustChangePassword: false });
    const c = browser(handle);
    await c('POST', '/api/auth/login', { username, password: PW });
    c.id = u.id;
    return c;
  };
  return { db, handle, admin, employee, account };
}
const denied = (r, status, re) => {
  assert.equal(r?.status, status, JSON.stringify(r));
  if (re) assert.match(r.error, re);
};

// ----- B-1: a service desk ticket belongs to an account, not to an email address -----
test('B-1: copying a colleague\'s email no longer opens their tickets; employee emails are unique', async () => {
  const { db, admin, employee, account } = await company('b1');
  const mark = await employee('Mark');
  const maria = await employee('Maria');
  const markU = await account('mark', 'employee', mark.id);
  const hr = await account('hana', 'hr', maria.id);
  const t = await markU('POST', '/api/helpdesk/mine', { subject: 'My private laptop issue', body: 'my password is hunter2', category: 'Hardware' });
  assert.ok(t.id);
  // HR copies Mark's address onto Maria's record: refused.
  const rec = await admin('GET', `/api/employees/${maria.id}`);
  denied(await hr('PUT', `/api/employees/${maria.id}`, { ...rec, email: 'MARK@example.com' }), 400, /already on Mark Test's record/);
  // Even with the address copied in the data, the ticket stays Mark's only.
  db.data.employees.find((e) => e.id === maria.id).email = 'mark@example.com';
  assert.equal((await hr('GET', '/api/helpdesk/mine')).length, 0);
  denied(await hr('GET', `/api/helpdesk/mine/${t.id}`), 404);
  assert.equal((await markU('GET', '/api/helpdesk/mine')).length, 1);
  // Tickets that kept only an address are linked once, to the one account with it; never when two have it.
  db.data.tickets.push({ ...structuredClone(db.data.tickets[0]), id: 'old-1', requester: { userId: null, name: 'Mark', email: 'mark@example.com' } });
  linkTicketOwners(db);
  assert.equal(db.data.tickets.find((x) => x.id === 'old-1').requester.userId, null, 'two records have that address: linked to nobody');
  db.data.employees.find((e) => e.id === maria.id).email = 'maria@example.com';
  linkTicketOwners(db);
  assert.equal(db.data.tickets.find((x) => x.id === 'old-1').requester.userId, markU.id);
});

// ----- B-2: payroll runs carry masked ID and bank numbers; the bank file is logged -----
test('B-2: payroll runs mask government IDs and bank accounts; the full register is a logged export', async () => {
  const { admin, employee, account } = await company('b2');
  await employee('Ana', { tin: '123456789000', sssNo: '3412345678', bankName: 'BPI', bankAccount: '001234567893' });
  const hr = await account('hana', 'hr');
  const run = await admin('POST', '/api/payroll-runs', { periodStart: '2027-01-01', periodEnd: '2027-01-15', payDate: '2027-01-15' });
  const seen = await hr('GET', `/api/payroll-runs/${run.id}`);
  const slip = seen.payslips[0].employee;
  assert.match(slip.tin, /^••••/);
  assert.match(slip.bankAccount, /^••••7893$/);
  assert.equal(slip.bankName, 'BPI');
  assert.match(run.payslips[0].employee.bankAccount, /^••••/, 'creating a run answers masked too');
  const full = await hr('GET', `/api/payroll-runs/${run.id}/register`);
  assert.equal(full.payslips[0].employee.bankAccount, '001234567893');
  const log = await admin('GET', '/api/audit?area=payroll');
  assert.ok(log.entries.some((e) => e.action === 'payroll.register.export' && e.userName === 'hana'));
});

// ----- B-3: nobody changes their own attendance, leave credits, pay or payslip -----
test('B-3: own attendance, overtime, leave credits, pay and payslip are changed by someone else', async () => {
  const { admin, employee, account } = await company('b3');
  const me = await employee('Hazel');
  const other = await employee('Olivia');
  const staff = await account('hazel', 'hrstaff', me.id);
  const pay = await account('pablo', 'payroll', (await employee('Pablo')).id);
  const hr = await account('hana', 'hr', (await employee('Hana')).id);
  const day = { date: '2027-02-01', type: 'work', timeIn: '08:00', timeOut: '22:00', otApproved: true };
  denied(await staff('POST', '/api/time-entries', { employeeId: me.id, ...day }), 403, /your own attendance/);
  const theirs = await staff('POST', '/api/time-entries', { employeeId: other.id, ...day });
  assert.ok(theirs.id, 'someone else\'s attendance: fine');
  denied(await staff('PUT', `/api/time-entries/${theirs.id}`, { employeeId: me.id, ...day }), 403, /your own/);
  denied(await staff('PUT', '/api/leave-credits', { employeeId: me.id, year: 2027, leaveTypeId: 'vl', credits: 366 }), 403, /your own leave credits/);
  assert.ok(Array.isArray(await staff('PUT', '/api/leave-credits', { employeeId: other.id, year: 2027, leaveTypeId: 'vl', credits: 16 })));
  // A wrong number leaves the credits as they were (it used to drop them first).
  denied(await staff('PUT', '/api/leave-credits', { employeeId: other.id, year: 2027, leaveTypeId: 'vl', credits: 999 }), 400);
  assert.equal((await staff('PUT', '/api/leave-credits', { employeeId: other.id, year: 2027, leaveTypeId: 'vl', credits: 16 })).find((b) => b.leaveTypeId === 'vl').credits, 16);
  // HR: own address yes, own pay no.
  const own = await admin('GET', `/api/employees/${(await hr('GET', '/api/auth/status')).user.employeeId}`);
  assert.equal((await hr('PUT', `/api/employees/${own.id}`, { ...own, address: 'New address' })).address, 'New address');
  denied(await hr('PUT', `/api/employees/${own.id}`, { ...own, rate: 155000 }), 403, /your own pay/);
  // Payroll: not their own payslip.
  const run = await admin('POST', '/api/payroll-runs', { periodStart: '2027-01-01', periodEnd: '2027-01-15', payDate: '2027-01-15' });
  const pabloId = (await pay('GET', '/api/auth/status')).user.employeeId;
  denied(await pay('PUT', `/api/payroll-runs/${run.id}/payslips/${pabloId}`, { otherEarnings: 50000 }), 403, /your own payslip/);
  assert.ok((await pay('PUT', `/api/payroll-runs/${run.id}/payslips/${other.id}`, { otherEarnings: 100 })).id);
  // The leave credit change is on record with whose and what.
  const log = await admin('GET', '/api/audit?area=leave');
  assert.ok(log.entries.some((e) => e.action === 'leave.credits' && /16 days/.test(e.note)));
});

// ----- B-5: a module turned off stays off inside the other modules -----
test('B-5: Sales & CRM, the Service Desk and IT assets turned off do not show through other modules', async () => {
  const { db, admin, employee, account } = await company('b5');
  const sales = await account('sam', 'salesmgr');
  await admin('PUT', '/api/admin/modules', { modules: { crm: false } });
  const meta = await sales('GET', '/api/pm/meta');
  assert.equal(meta.crm ?? null, null, 'no CRM accounts, deals or contracts');
  await admin('PUT', '/api/admin/modules', { modules: { crm: true, helpdesk: false } });
  const agent = await account('ivan', 'it');
  denied(await agent('POST', '/api/pm/tasks/from-ticket/any', { projectId: 'x' }), 403);
  await admin('PUT', '/api/admin/modules', { modules: { helpdesk: true, assets: false } });
  const e = await employee('Ella');
  const ella = await account('ella', 'employee', e.id);
  db.data.assets.push({ id: 'a1', assetTag: 'LTDC-IT-0001', name: 'Laptop', assignedTo: { type: 'employee', id: e.id } });
  assert.deepEqual((await ella('GET', '/api/helpdesk/info')).myAssets, []);
  await admin('PUT', '/api/admin/modules', { modules: { assets: true } });
  assert.equal((await ella('GET', '/api/helpdesk/info')).myAssets.length, 1);
});

// ----- B-6: the settings each account gets -----
test('B-6: sign-in limits, approval routes and office coordinates go only to who needs them', async () => {
  const { admin, employee, account } = await company('b6');
  await admin('PUT', '/api/location-settings', { officeLabel: 'Makati office', officeLat: 14.55, officeLng: 121.02, radius: 150, retentionDays: 365 });
  const e = await employee('Eve');
  const eve = await account('eve', 'employee', e.id);
  const s = await eve('GET', '/api/settings');
  assert.equal(s.security, undefined);
  assert.equal(s.auditKeyedFrom, undefined);
  assert.deepEqual(s.location, { officeLabel: 'Makati office' });
  assert.ok(s.schedule && s.premiums, 'what their own screens compute with is still there');
  const a = await admin('GET', '/api/settings');
  assert.equal(a.location.officeLat, 14.55);
});

// ----- B-7 and B-8: feedback replies without a name; a ticket's asset is your own -----
test('B-7, B-8: a feedback reply does not name the administrator; My tickets links only your own equipment', async () => {
  const { db, admin, employee, account } = await company('b7');
  const e = await employee('Fe');
  const fe = await account('fely', 'employee', e.id);
  const f = await fe('POST', '/api/feedback', { type: 'idea', area: 'general', subject: 'Colours', message: 'More colours' });
  await admin('POST', `/api/feedback/${f.id}/update`, { note: 'Thanks!', status: 'planned' });
  const mine = await fe('GET', '/api/me/feedback');
  assert.equal(mine[0].updates[0].note, 'Thanks!');
  assert.equal(mine[0].updates[0].by, undefined);
  db.data.assets.push({ id: 'theirs', assetTag: 'LTDC-IT-0009', name: 'CFO laptop', assignedTo: { type: 'employee', id: 'someone-else' } });
  const t = await fe('POST', '/api/helpdesk/mine', { subject: 'Help', body: 'It is slow', category: 'Hardware', assetId: 'theirs' });
  assert.equal(db.data.tickets.find((x) => x.id === t.id).assetId, null);
});

// ----- D1: lines cut from the end of the audit log are noticed -----
test('D1: the audit check notices entries removed from the end, while running and while stopped', () => {
  const dir = tmpDir('d1');
  const secrets = createSecrets(dir);
  let from = null;
  const opts = { key: () => secrets.derive('core-audit-chain-v1'), keyedFrom: () => from, setKeyedFrom: (n) => (from = n) };
  const audit = createAudit(dir, opts);
  for (const label of ['One', 'Two', 'Three', 'Four']) audit.record('settings.update', { label });
  assert.equal(audit.verify().ok, true);
  const file = path.join(dir, 'audit-log.jsonl');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`);
  const live = audit.verify();
  assert.deepEqual([live.ok, live.missingFrom, live.missingTo], [false, 3, 4]);
  // While stopped: the next start writes the gap into the log, and the check keeps saying so.
  const next = createAudit(dir, opts);
  const v = next.verify();
  assert.deepEqual([v.ok, v.missingFrom, v.missingTo], [false, 3, 4]);
  assert.ok(fs.readFileSync(file, 'utf8').includes('"action":"audit.gap"'));
  // The head file changed by hand: noticed too.
  const dir2 = tmpDir('d1b');
  const s2 = createSecrets(dir2);
  const o2 = { key: () => s2.derive('core-audit-chain-v1'), keyedFrom: () => 1, setKeyedFrom: () => {} };
  createAudit(dir2, o2).record('settings.update', { label: 'One' });
  const head = JSON.parse(fs.readFileSync(path.join(dir2, 'audit-head.json'), 'utf8'));
  fs.writeFileSync(path.join(dir2, 'audit-head.json'), JSON.stringify({ ...head, seq: 0 }));
  assert.equal(createAudit(dir2, o2).verify().headChanged, true);
});

// ----- D2: personal details for the HR side; every look at records is logged -----
test('D2: a Project Manager sees no birth dates or home addresses, and their views are logged', async () => {
  const { admin, employee, account } = await company('d2');
  const e = await employee('Mark', { birthDate: '1991-04-13', address: '12 Mabini St', phone: '0917', emergencyContactName: 'Rosa' });
  const pm = await account('pia', 'pm');
  const seen = await pm('GET', `/api/employees/${e.id}`);
  for (const f of ['birthDate', 'address', 'phone', 'emergencyContactName']) assert.equal(seen[f], undefined, f);
  assert.equal(seen.personalHidden, true);
  assert.equal(seen.email, 'mark@example.com', 'the work email stays');
  assert.equal((await pm('GET', '/api/employees'))[0].address, undefined);
  const staff = await account('hazel', 'hrstaff');
  assert.equal((await staff('GET', `/api/employees/${e.id}`)).address, '12 Mabini St', 'the HR side sees them');
  const log = await admin('GET', '/api/audit?area=employee');
  assert.ok(log.entries.some((x) => x.action === 'employee.view' && x.userName === 'pia'));
  assert.ok(log.entries.some((x) => x.action === 'employee.list' && x.userName === 'pia'));
});

// ----- D4, D5: payroll amounts; text in the audit log -----
test('D4, D5: payroll adjustments must be real amounts; audit entries keep no control characters', async () => {
  const { db, admin, employee } = await company('d4');
  const e = await employee('Ana');
  const run = await admin('POST', '/api/payroll-runs', { periodStart: '2027-01-01', periodEnd: '2027-01-15', payDate: '2027-01-15' });
  for (const otherEarnings of [1e308, 'abc', -5, Infinity]) denied(await admin('PUT', `/api/payroll-runs/${run.id}/payslips/${e.id}`, { otherEarnings }), 400, /amount from 0/);
  const ok = await admin('PUT', `/api/payroll-runs/${run.id}/payslips/${e.id}`, { otherEarnings: 1500.555, remarks: 'Bonus\n\u001b[31mRED' });
  assert.equal(Number.isFinite(ok.totals?.netPay ?? ok.payslips[0].netPay), true);
  const lines = fs.readFileSync(path.join(db.dir, 'audit-log.jsonl'), 'utf8');
  assert.ok(!/\\u001b|\\u0000/.test(lines), 'no escape codes stored');
  assert.ok(lines.includes('Bonus  [31mRED') || lines.includes('Bonus [31mRED'));
});

// ----- C-2, C-3: GIF structure; quotes in guides -----
const gif = ({ w = 10, h = 10, frames = 1, fw = 10, fh = 10, trailer = true } = {}) => {
  const head = Buffer.from('GIF89a', 'latin1');
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(w, 0);
  lsd.writeUInt16LE(h, 2);
  const frame = () => {
    const d = Buffer.alloc(10);
    d[0] = 0x2c;
    d.writeUInt16LE(fw, 5);
    d.writeUInt16LE(fh, 7);
    return Buffer.concat([d, Buffer.from([2, 1, 0, 0])]); // LZW size, one data byte, end
  };
  return Buffer.concat([head, lsd, ...Array.from({ length: frames }, frame), trailer ? Buffer.from([0x3b]) : Buffer.alloc(0)]);
};
test('C-2: a GIF is read frame by frame: frame size, number of frames and a whole file', () => {
  assert.doesNotThrow(() => checkGif(gif()));
  assert.throws(() => checkGif(gif({ fw: 5000, fh: 5000 })), /too big \(5000 × 5000/);
  assert.throws(() => checkGif(gif({ frames: 1001 })), /more than 1000 frames/);
  assert.throws(() => checkGif(gif({ trailer: false })), /could not be read/);
  assert.throws(() => checkGif(gif({ frames: 0 })), /could not be read/);
});
test('C-3: a quote in a guide is escaped like the other marks', () => {
  assert.match(renderMarkdown("It's 'quoted'"), /It&#39;s &#39;quoted&#39;/);
});

// ----- A-02, C-1: the HTTP layer (a real server) -----
const children = [];
after(() => children.forEach((c) => c.kill()));
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
  return port;
}
const raw = (port, { method = 'POST', path: p, headers = {}, body = null, announce = false }) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
    let b = '';
    res.on('data', (d) => (b += d));
    res.on('end', () => resolve({ status: res.statusCode, body: b }));
  });
  req.on('error', reject);
  if (announce) req.flushHeaders();
  else req.end(body);
});
test('A-02, C-1: only application/json is JSON; signed-in requests are limited by route', async () => {
  const port = await startServer();
  const setup = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Admin', username: 'admin', password: PW }) });
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const body = JSON.stringify({ companyName: 'X' });
  assert.equal((await raw(port, { method: 'PUT', path: '/api/settings', headers: { cookie, 'Content-Type': 'application/jsonx' }, body })).status, 415);
  assert.equal((await raw(port, { method: 'PUT', path: '/api/settings', headers: { cookie, 'Content-Type': 'text/plain' }, body })).status, 415);
  assert.notEqual((await raw(port, { method: 'PUT', path: '/api/settings', headers: { cookie, 'Content-Type': 'application/json; charset=utf-8' }, body })).status, 415);
  const MB = 1024 * 1024;
  const big = (p, size) => raw(port, { path: p, headers: { cookie, 'Content-Type': 'application/json', 'Content-Length': size }, announce: true });
  assert.equal((await big('/api/feedback', 20 * MB)).status, 413, 'an ordinary route: 12 MB');
  assert.notEqual((await big('/api/admin/import', 20 * MB)).status, 413, 'a backup restore may be large');
});
