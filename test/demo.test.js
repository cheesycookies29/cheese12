// "Load demo data" adds a tagged demo set next to real data; "Remove demo data" takes it out again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-demo-')), 'db.json'));
const handle = createApi(db);
const admin = (() => {
  let cookie = '';
  return async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
})();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
// Real data, using the same numbers the demo used to use.
const real = await admin('POST', '/api/employees', { employeeNo: 'EMP-0001', firstName: 'Real', lastName: 'Person', email: 'real@company.com', hireDate: '2024-01-01', payType: 'monthly', rate: 40000 });
const realAsset = await admin('POST', '/api/assets', { assetTag: 'LTDC-IT-0001', name: 'Real laptop', category: 'Laptop', serialNumber: 'REAL-1' });
await admin('POST', '/api/time-entries', { employeeId: real.id, date: '2026-10-05', type: 'work', timeIn: '09:00', timeOut: '18:00' });
const realTicket = await admin('POST', '/api/helpdesk/tickets', { requesterName: 'Real Person', subject: 'Real ticket', body: 'A real request.', category: 'Hardware' });
await admin('PUT', '/api/settings', { companyName: 'My Real Company Inc.' });
const count = (k, demo) => db.data[k].filter((x) => Boolean(x.demo) === demo).length;

test('loading demo data adds to real data and never reuses its numbers', async () => {
  assert.deepEqual(await admin('GET', '/api/admin/demo'), { loaded: false, counts: { employees: 0, assets: 0, inventoryItems: 0, tickets: 0 } });
  const res = await admin('POST', '/api/admin/demo');
  assert.equal(res.counts.employees, 6);
  assert.equal(count('employees', false), 1, 'the real employee is still there');
  assert.equal(count('assets', false), 1);
  assert.equal(count('timeEntries', false), 1);
  assert.equal(db.data.settings.companyName, 'My Real Company Inc.', 'settings are kept');
  assert.ok(db.data.employees.filter((e) => e.demo).every((e) => /^DEMO-\d{4}$/.test(e.employeeNo)));
  assert.ok(db.data.assets.filter((a) => a.demo).every((a) => a.assetTag.startsWith('DEMO-IT-')));
  const refs = db.data.tickets.map((t) => t.ref);
  assert.equal(new Set(refs).size, refs.length, 'ticket numbers stay unique');
  assert.equal(realTicket.ref, 'HD-000001');
  assert.ok(db.data.tickets.filter((t) => t.demo).every((t) => t.number > 1));
  assert.ok(db.data.users.some((u) => u.username === 'employee.demo' && u.demo));
  // The new numbering keeps working after the demo set.
  const next = await admin('POST', '/api/helpdesk/tickets', { requesterName: 'Real Person', subject: 'Second real ticket', body: 'Another request.', category: 'Hardware' });
  assert.ok(!refs.includes(next.ref));
});

test('loading again refreshes the demo set instead of doubling it', async () => {
  await admin('POST', '/api/admin/demo');
  assert.equal(count('employees', true), 6);
  assert.equal(db.data.users.filter((u) => u.username === 'hr.demo').length, 1);
  assert.equal(count('employees', false), 1);
});

test('removing demo data takes out demo records and what hangs off them, and keeps the rest', async () => {
  const demoEmp = db.data.employees.find((e) => e.demo);
  // Real equipment lent to a demo employee, and a draft payroll run with demo payslips in it.
  await admin('POST', `/api/assets/${realAsset.id}/assign`, { type: 'employee', employeeId: demoEmp.id });
  const run = await admin('POST', '/api/payroll-runs', { periodStart: '2026-10-01', periodEnd: '2026-10-15', payDate: '2026-10-15' });
  assert.equal(run.payslips.length, 7);

  const res = await admin('DELETE', '/api/admin/demo');
  assert.equal(res.removed.employees, 6);
  assert.equal(res.removed.accounts, 4);
  assert.equal(count('employees', true), 0);
  assert.equal(db.data.employees.length, 1);
  assert.ok(db.data.timeEntries.every((e) => e.employeeId === real.id));
  assert.ok(!db.data.users.some((u) => u.demo));
  assert.ok(db.data.users.some((u) => u.username === 'admin'));
  const asset = db.data.assets.find((a) => a.id === realAsset.id);
  assert.equal(asset.status, 'in_stock', 'real equipment goes back to stock');
  assert.match(db.data.assetHistory.filter((h) => h.assetId === asset.id).at(-1).detail, /demo data/);
  const draft = db.data.payrollRuns.find((r) => r.id === run.id);
  assert.deepEqual(draft.payslips.map((p) => p.employeeId), [real.id]);
  assert.equal(draft.totals.employees, 1);
  assert.deepEqual(db.data.tickets.map((t) => t.subject).sort(), ['Real ticket', 'Second real ticket']);
  assert.deepEqual(await admin('GET', '/api/admin/demo'), { loaded: false, counts: { employees: 0, assets: 0, inventoryItems: 0, tickets: 0 } });
});

test('an empty system gets the full demo, as before', async () => {
  const db2 = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-demo2-')), 'db.json'));
  const h2 = createApi(db2);
  let cookie = '';
  const a2 = async (method, url, body = {}) => {
    const r = await h2({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (r.headers['Set-Cookie']) cookie = r.headers['Set-Cookie'].split(';')[0];
    return r.data;
  };
  await a2('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
  await a2('POST', '/api/admin/demo');
  assert.equal(db2.data.employees.length, 6);
  assert.ok(db2.data.timeEntries.length > 100);
  assert.equal(db2.data.tickets[0].ref, 'HD-000001');
});
