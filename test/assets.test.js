// API-level tests for IT Asset Management, run against a throwaway data file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-erp-'));
const db = openDb(path.join(dir, 'db.json'));
const handle = createApi(db);

// Minimal client: keeps the session cookie between calls.
function client() {
  let cookie = '';
  return async (method, url, body = {}) => {
    const u = new URL(url, 'http://localhost');
    const res = await handle({ method, headers: { cookie } }, u, body);
    const set = res.headers['Set-Cookie'];
    if (set) cookie = set.split(';')[0];
    return res.data;
  };
}

const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
const emp = await admin('POST', '/api/employees', { employeeNo: 'E-1', firstName: 'Ana', lastName: 'Cruz', hireDate: '2024-01-01', payType: 'monthly', rate: 30000 });
await admin('POST', '/api/users', { name: 'IT', username: 'itstaff', role: 'it', password: 'secret123', mustChangePassword: false });
await admin('POST', '/api/users', { name: 'Payroll', username: 'payroll1', role: 'payroll', password: 'secret123', mustChangePassword: false });
const it = client();
await it('POST', '/api/auth/login', { username: 'itstaff', password: 'secret123' });
const pay = client();
await pay('POST', '/api/auth/login', { username: 'payroll1', password: 'secret123' });

test('IT can register, assign, transfer, return and retire an asset with full history', async () => {
  const a = await it('POST', '/api/assets', { name: 'Laptop A', category: 'Laptop', serialNumber: 'SN-1' });
  assert.equal(a.assetTag, 'LTDC-IT-0001');
  assert.equal(a.status, 'in_stock');
  let r = await it('POST', `/api/assets/${a.id}/assign`, { type: 'employee', employeeId: emp.id });
  assert.equal(r.assignedTo.name, 'Ana Cruz');
  r = await it('POST', `/api/assets/${a.id}/assign`, { type: 'department', name: 'Finance' });
  assert.match(r.history[0].detail, /Transferred from Ana Cruz to Finance/);
  r = await it('POST', `/api/assets/${a.id}/return`, { status: 'in_stock', condition: 'Fair' });
  assert.equal(r.status, 'in_stock');
  assert.equal(r.assignedTo, null);
  r = await it('POST', `/api/assets/${a.id}/status`, { status: 'retired' });
  assert.deepEqual(r.history.map((h) => h.action), ['status', 'returned', 'transferred', 'assigned', 'created']);
});

test('asset rules: unique serials, no assigning retired equipment', async () => {
  await assert.rejects(it('POST', '/api/assets', { name: 'Dup', category: 'Laptop', serialNumber: 'sn-1' }), /already registered/);
  const retired = db.data.assets.find((a) => a.status === 'retired');
  await assert.rejects(it('POST', `/api/assets/${retired.id}/assign`, { type: 'location', name: 'Lobby' }), /retired/);
});

test('inventory: receive, issue (not more than on hand) and count adjustments', async () => {
  const item = await it('POST', '/api/inventory', { name: 'Mouse', openingQuantity: 10, reorderLevel: 3 });
  let r = await it('POST', `/api/inventory/${item.id}/movements`, { type: 'out', quantity: 4, issuedTo: { type: 'employee', employeeId: emp.id } });
  assert.equal(r.item.quantity, 6);
  await assert.rejects(it('POST', `/api/inventory/${item.id}/movements`, { type: 'out', quantity: 7, issuedTo: { type: 'location', name: 'Lab' } }), /Only 6/);
  r = await it('POST', `/api/inventory/${item.id}/movements`, { type: 'adjust', countedQuantity: 5 });
  assert.equal(r.movement.quantity, -1);
  r = await it('POST', `/api/inventory/${item.id}/movements`, { type: 'in', quantity: 5 });
  assert.equal(r.item.quantity, 10);
  const moves = await it('GET', `/api/stock-movements?itemId=${item.id}`);
  assert.equal(moves.length, 4);
});

test('permissions: IT cannot see HR records; payroll cannot see assets', async () => {
  await assert.rejects(it('GET', '/api/employees'), /does not have access/);
  await assert.rejects(pay('GET', '/api/assets'), /does not have access/);
  const meta = await it('GET', '/api/asset-meta');
  assert.deepEqual(Object.keys(meta.employees[0]).sort(), ['department', 'employeeNo', 'id', 'name']);
});

test('issue reports: employees report their own equipment; IT and admins review and respond', async () => {
  await admin('POST', '/api/users', { name: 'Ana', username: 'ana', role: 'employee', employeeId: emp.id, password: 'secret123', mustChangePassword: false });
  const ana = client();
  await ana('POST', '/api/auth/login', { username: 'ana', password: 'secret123' });
  const laptop = await it('POST', '/api/assets', { name: 'Laptop B', category: 'Laptop' });
  const other = await it('POST', '/api/assets', { name: 'Laptop C', category: 'Laptop' });
  await it('POST', `/api/assets/${laptop.id}/assign`, { type: 'employee', employeeId: emp.id });

  const body = { assetId: laptop.id, type: 'malfunction', impact: 'limited', description: 'Keyboard keys stop working after an hour.' };
  await assert.rejects(ana('POST', '/api/me/asset-reports', { ...body, assetId: other.id }), /assigned to you/);
  await assert.rejects(ana('POST', '/api/me/asset-reports', { ...body, description: ' ' }), /Describe the problem/);
  await assert.rejects(ana('POST', '/api/me/asset-reports', { ...body, type: 'nope' }), /what is wrong/);
  const r = await ana('POST', '/api/me/asset-reports', body);
  assert.equal(r.number, 'IR-0001');
  assert.equal(r.status, 'open');
  assert.equal(r.reportedBy.name, 'Ana Cruz');
  await assert.rejects(ana('POST', '/api/me/asset-reports', body), /already has an open report \(IR-0001\)/);

  assert.deepEqual(await it('GET', '/api/asset-reports/summary'), { new: 1, active: 1 });
  assert.equal((await admin('GET', '/api/asset-reports')).length, 1);
  await assert.rejects(pay('GET', '/api/asset-reports'), /does not have access/);
  await assert.rejects(ana('POST', `/api/asset-reports/${r.id}/update`, { status: 'resolved' }), /does not have access/);
  await assert.rejects(it('POST', `/api/asset-reports/${r.id}/update`, {}), /Change the status or write a note/);

  let u = await it('POST', `/api/asset-reports/${r.id}/update`, { status: 'in_progress', note: 'Bring it to IT at 2 pm.' });
  assert.equal(u.status, 'in_progress');
  assert.deepEqual(await it('GET', '/api/asset-reports/summary'), { new: 0, active: 1 });
  u = await admin('POST', `/api/asset-reports/${r.id}/update`, { status: 'resolved', note: 'Keyboard replaced.' });
  assert.ok(u.closedAt);

  const mine = await ana('GET', '/api/me/assets');
  assert.deepEqual(mine.reports[0].updates.map((x) => x.note), ['Bring it to IT at 2 pm.', 'Keyboard replaced.']);
  const detail = await it('GET', `/api/assets/${laptop.id}`);
  assert.equal(detail.reports.length, 1);
  assert.deepEqual(detail.history.filter((h) => h.action === 'issue').map((h) => h.detail), [
    'Report IR-0001 marked resolved', 'Report IR-0001 marked being checked', 'Malfunction reported by Ana Cruz (IR-0001)',
  ]);
  // Once resolved, a new problem can be reported.
  assert.equal((await ana('POST', '/api/me/asset-reports', { ...body, type: 'damage' })).number, 'IR-0002');
});
