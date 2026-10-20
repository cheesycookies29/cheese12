// Administrators adjusting one employee's leave: types offered, adjustments, recorded days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-leave-')), 'db.json'));
const handle = createApi(db);
function client() {
  let cookie = '';
  return async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
}
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
const emp = await admin('POST', '/api/employees', { employeeNo: 'E-1', firstName: 'Ana', lastName: 'Cruz', gender: 'Female', hireDate: '2024-01-01', payType: 'monthly', rate: 30000 });
await admin('POST', '/api/users', { name: 'Ana', username: 'ana', role: 'employee', employeeId: emp.id, password: 'secret123', mustChangePassword: false });
await admin('POST', '/api/users', { name: 'HR', username: 'hrboss', role: 'hr', password: 'secret123', mustChangePassword: false });
const ana = client();
await ana('POST', '/api/auth/login', { username: 'ana', password: 'secret123' });
const hr = client();
await hr('POST', '/api/auth/login', { username: 'hrboss', password: 'secret123' });
const YEAR = 2026;
const bal = (data, code) => data.balances.find((b) => b.code === code);
const myCodes = async () => (await ana('GET', `/api/me/leave-balances?year=${YEAR}`)).map((b) => b.code);

test('leave types can be offered to everyone or only to selected employees, and taken away per person', async () => {
  const study = await admin('POST', '/api/leave-types', { code: 'STL', name: 'Study Leave', annualCredits: 5, paid: true, active: true, appliesTo: 'selected' });
  assert.ok(!(await myCodes()).includes('STL'), 'selected-only types are not offered by default');
  const req = { kind: 'leave', leaveTypeId: study.id, startDate: '2026-03-02', endDate: '2026-03-02' };
  await assert.rejects(ana('POST', '/api/me/requests', req), /not available to you/);

  let data = await admin('PUT', `/api/employees/${emp.id}/leave-access`, { leaveTypeId: study.id, offered: true, year: YEAR });
  assert.equal(bal(data, 'STL').offered, true);
  assert.ok((await myCodes()).includes('STL'));
  const filed = await ana('POST', '/api/me/requests', req);
  await ana('POST', `/api/me/requests/${filed.id}/cancel`);

  const ml = db.data.leaveTypes.find((t) => t.code === 'ML');
  data = await admin('PUT', `/api/employees/${emp.id}/leave-access`, { leaveTypeId: ml.id, offered: false, year: YEAR });
  assert.equal(bal(data, 'ML').offered, false);
  assert.ok(!(await myCodes()).includes('ML'));
  data = await admin('PUT', `/api/employees/${emp.id}/leave-access`, { leaveTypeId: ml.id, offered: null, year: YEAR });
  assert.equal(bal(data, 'ML').offered, true, 'back to the default');
});

test('adjustments add or take away days with a reason', async () => {
  const vl = db.data.leaveTypes.find((t) => t.code === 'VL');
  let data = await admin('POST', `/api/employees/${emp.id}/leave-adjustments`, { leaveTypeId: vl.id, year: YEAR, days: 2.5, reason: 'Carry-over from 2025' });
  assert.equal(bal(data, 'VL').adjusted, 2.5);
  assert.equal(bal(data, 'VL').remaining, 17.5);
  data = await admin('POST', `/api/employees/${emp.id}/leave-adjustments`, { leaveTypeId: vl.id, year: YEAR, days: -1, reason: 'Correction' });
  assert.equal(bal(data, 'VL').remaining, 16.5);
  assert.equal(data.adjustments.length, 2);
  await assert.rejects(admin('POST', `/api/employees/${emp.id}/leave-adjustments`, { leaveTypeId: vl.id, year: YEAR, days: 1, reason: '' }), /Say why/);
  await assert.rejects(admin('POST', `/api/employees/${emp.id}/leave-adjustments`, { leaveTypeId: vl.id, year: YEAR, days: 0.3, reason: 'x' }), /half days/);
  const lwop = db.data.leaveTypes.find((t) => t.code === 'LWOP');
  await assert.rejects(admin('POST', `/api/employees/${emp.id}/leave-adjustments`, { leaveTypeId: lwop.id, year: YEAR, days: 1, reason: 'x' }), /no day limit/);
  assert.equal(data.adjustments[0].days, -1, 'newest first');
  data = await admin('DELETE', `/api/employees/${emp.id}/leave-adjustments/${data.adjustments.find((a) => a.days === -1).id}`);
  assert.equal(bal(data, 'VL').remaining, 17.5);
});

test('administrators record and remove leave days directly', async () => {
  const el = db.data.leaveTypes.find((t) => t.code === 'EL'); // 3 days a year
  const days = (start, end, extra = {}) => admin('POST', `/api/employees/${emp.id}/leave-days`, { leaveTypeId: el.id, startDate: start, endDate: end, note: 'Typhoon', ...extra });
  let data = await days('2026-03-09', '2026-03-10'); // Mon-Tue
  assert.equal(data.recorded, 2);
  assert.equal(bal(data, 'EL').used, 2);
  assert.equal(data.leaveDays.filter((d) => d.source === 'admin').length, 2);
  await assert.rejects(days('2026-03-10', '2026-03-10'), /already recorded on 2026-03-10/);
  await assert.rejects(days('2026-03-16', '2026-03-17'), /only 1 Emergency Leave day/);
  data = await days('2026-03-16', '2026-03-17', { allowOverdraw: true });
  assert.equal(bal(data, 'EL').remaining, -1);
  await assert.rejects(days('2026-12-31', '2027-01-01'), /one calendar year at a time/);
  data = await admin('DELETE', `/api/employees/${emp.id}/leave-days/${data.leaveDays[0].id}`);
  assert.equal(bal(data, 'EL').used, 3);

  // Days from an approved request are cancelled through the request instead.
  const req = await ana('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: db.data.leaveTypes.find((t) => t.code === 'SL').id, startDate: '2026-04-06', endDate: '2026-04-06' });
  await admin('POST', `/api/requests/${req.id}/approve`);
  data = await admin('GET', `/api/employees/${emp.id}/leave?year=${YEAR}`);
  const fromRequest = data.leaveDays.find((d) => d.source === 'request');
  await assert.rejects(admin('DELETE', `/api/employees/${emp.id}/leave-days/${fromRequest.id}`), /Cancel the request/);
});

test('only administrators can adjust an employee\'s leave', async () => {
  await assert.rejects(hr('GET', `/api/employees/${emp.id}/leave?year=${YEAR}`), /does not have access/);
  await assert.rejects(hr('POST', `/api/employees/${emp.id}/leave-adjustments`, {}), /does not have access/);
  await assert.rejects(ana('PUT', `/api/employees/${emp.id}/leave-access`, {}), /does not have access/);
  assert.ok(Array.isArray(await hr('GET', `/api/leave-balances?year=${YEAR}`)), 'HR keeps the balances overview');
});
