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
