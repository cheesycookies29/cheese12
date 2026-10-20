// Leave types limited by gender, and medical certificates on long sick leave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-rules-'));
const db = openDb(path.join(dir, 'db.json'));
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
const person = (no, firstName, gender) => admin('POST', '/api/employees', { employeeNo: no, firstName, lastName: 'Reyes', gender, hireDate: '2024-01-01', payType: 'monthly', rate: 30000 });
const [maria, jose, alex] = [await person('E-1', 'Maria', 'Female'), await person('E-2', 'Jose', 'Male'), await person('E-3', 'Alex', '')];
async function login(username, emp) {
  await admin('POST', '/api/users', { name: emp.firstName, username, role: 'employee', employeeId: emp.id, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  return c;
}
const asMaria = await login('maria', maria);
const asJose = await login('jose', jose);
const asAlex = await login('alex', alex);
const codes = async (c) => (await c('GET', '/api/me/leave-balances?year=2026')).map((b) => b.code);
// Mon 2 to Fri 6 March 2026: 5 work days; Mon 2 to Tue 3: 2 days.
const leave = (leaveTypeId, endDate = '2026-03-03', extra = {}) => ({ kind: 'leave', leaveTypeId, startDate: '2026-03-02', endDate, ...extra });
const PDF = { name: 'certificate.pdf', data: Buffer.from('%PDF-1.4\n% medical certificate\n').toString('base64') };

test('maternity leave is offered to women only and paternity leave to men only', async () => {
  assert.ok((await codes(asMaria)).includes('ML') && !(await codes(asMaria)).includes('PL'));
  assert.ok((await codes(asJose)).includes('PL') && !(await codes(asJose)).includes('ML'));
  const alexCodes = await codes(asAlex);
  assert.ok(!alexCodes.includes('ML') && !alexCodes.includes('PL'), 'no gender on record: neither');

  await assert.rejects(asJose('POST', '/api/me/requests', leave('ml')), /for female employees only/);
  await assert.rejects(asMaria('POST', '/api/me/requests', leave('pl')), /for male employees only/);
  await assert.rejects(asAlex('POST', '/api/me/requests', leave('ml')), /no gender/);
  // Administrators can't give it to the wrong person or record it for them either.
  await assert.rejects(admin('PUT', `/api/employees/${jose.id}/leave-access`, { leaveTypeId: 'ml', offered: true, year: 2026 }), /record says Male/);
  await assert.rejects(admin('POST', `/api/employees/${maria.id}/leave-days`, { leaveTypeId: 'pl', startDate: '2026-03-02', endDate: '2026-03-02' }), /male employees only/);
  const grid = await admin('GET', '/api/leave-balances?year=2026');
  const ml = (emp) => grid.find((r) => r.employeeId === emp.id).balances.find((b) => b.code === 'ML');
  assert.equal(ml(maria).offered, true);
  assert.equal(ml(jose).offered, false);
  assert.equal(ml(jose).eligible, false);

  const filed = await asJose('POST', '/api/me/requests', leave('pl'));
  assert.equal(filed.status, 'pending');
  // If the record changes before approval, the request can't be approved.
  await admin('PUT', `/api/employees/${jose.id}`, { ...(await admin('GET', `/api/employees/${jose.id}`)), gender: 'Female' });
  await assert.rejects(admin('POST', `/api/requests/${filed.id}/approve`), /Cannot approve: Paternity Leave/);
  await admin('PUT', `/api/employees/${jose.id}`, { ...(await admin('GET', `/api/employees/${jose.id}`)), gender: 'Male' });
  await admin('POST', `/api/requests/${filed.id}/reject`);
});

test('the gender limit is a leave type setting', async () => {
  const types = await admin('GET', '/api/leave-types');
  assert.equal(types.find((t) => t.id === 'ml').gender, 'Female');
  assert.equal(types.find((t) => t.id === 'vl').gender, null);
  const ml = types.find((t) => t.id === 'ml');
  await admin('PUT', '/api/leave-types/ml', { ...ml, gender: '' });
  assert.ok((await codes(asJose)).includes('ML'));
  await admin('PUT', '/api/leave-types/ml', { ...ml, gender: 'Female' });
  assert.ok(!(await codes(asJose)).includes('ML'));
});

test('sick leave longer than 3 days needs a medical certificate', async () => {
  const sl = (await admin('GET', '/api/leave-types')).find((t) => t.id === 'sl');
  assert.equal(sl.certificateAfterDays, 3);
  const short = await asMaria('POST', '/api/me/requests', leave('sl', '2026-03-03'));
  assert.equal(short.certificateRequired, false, '2 days: no certificate needed');
  await asMaria('POST', `/api/me/requests/${short.id}/cancel`);

  await assert.rejects(asMaria('POST', '/api/me/requests', leave('sl', '2026-03-06')), /needs a medical certificate/);
  await assert.rejects(asMaria('POST', '/api/me/requests', leave('sl', '2026-03-06', { attachment: { name: 'x.txt', data: Buffer.from('hello world').toString('base64') } })), /PDF or a photo/);
  const big = Buffer.alloc(6 * 1024 * 1024);
  big.write('%PDF-');
  await assert.rejects(asMaria('POST', '/api/me/requests', leave('sl', '2026-03-06', { attachment: { name: 'big.pdf', data: big.toString('base64') } })), /too large/);

  const filed = await asMaria('POST', '/api/me/requests', leave('sl', '2026-03-06', { attachment: PDF }));
  assert.equal(filed.days, 5);
  assert.equal(filed.certificateRequired, true);
  assert.equal(filed.attachment.type, 'application/pdf');
  assert.ok(fs.existsSync(path.join(dir, 'attachments', filed.attachment.id)), 'stored next to the data file');
  assert.ok(!JSON.stringify(db.data).includes(PDF.data), 'the file is not inside the database');

  const file = await admin('GET', `/api/requests/${filed.id}/attachment`);
  assert.equal(Buffer.from(file.data, 'base64').toString(), '%PDF-1.4\n% medical certificate\n');
  assert.equal((await asMaria('GET', `/api/me/requests/${filed.id}/attachment`)).name, 'certificate.pdf');
  await assert.rejects(asJose('GET', `/api/me/requests/${filed.id}/attachment`), /not found/i);
  await assert.rejects(asJose('GET', `/api/requests/${filed.id}/attachment`), /does not have access/);

  // Replacing it while pending removes the old file.
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest')]);
  const replaced = await asMaria('PUT', `/api/me/requests/${filed.id}/attachment`, { attachment: { name: 'photo.png', data: png.toString('base64') } });
  assert.equal(replaced.attachment.type, 'image/png');
  assert.ok(!fs.existsSync(path.join(dir, 'attachments', filed.attachment.id)));
  const approved = await admin('POST', `/api/requests/${filed.id}/approve`);
  assert.equal(approved.status, 'approved');
  await assert.rejects(asMaria('PUT', `/api/me/requests/${filed.id}/attachment`, { attachment: PDF }), /only be changed while the request is pending/);
});

test('a long sick leave filed without a certificate cannot be approved until one is attached', async () => {
  // e.g. filed before the rule was switched on
  const sl = (await admin('GET', '/api/leave-types')).find((t) => t.id === 'sl');
  await admin('PUT', '/api/leave-types/sl', { ...sl, certificateAfterDays: '' });
  const filed = await asMaria('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'sl', startDate: '2026-04-06', endDate: '2026-04-10' });
  await admin('PUT', '/api/leave-types/sl', { ...sl, certificateAfterDays: 3 });
  await assert.rejects(admin('POST', `/api/requests/${filed.id}/approve`), /needs a medical certificate/);
  await asMaria('PUT', `/api/me/requests/${filed.id}/attachment`, { attachment: PDF });
  assert.equal((await admin('POST', `/api/requests/${filed.id}/approve`)).status, 'approved');
});

test('leave types saved by older builds get the rules from the built-in defaults', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-old-')), 'db.json');
  const old = openDb(file);
  for (const t of old.data.leaveTypes) {
    delete t.gender;
    delete t.certificateAfterDays;
  }
  old.data.leaveTypes.push({ id: 'custom', code: 'BL', name: 'Birthday Leave', paid: true, annualCredits: 1, active: true });
  old.save();
  const reopened = openDb(file);
  createApi(reopened);
  const byId = Object.fromEntries(reopened.data.leaveTypes.map((t) => [t.id, t]));
  assert.equal(byId.ml.gender, 'Female');
  assert.equal(byId.pl.gender, 'Male');
  assert.equal(byId.sl.certificateAfterDays, 3);
  assert.equal(byId.custom.gender, null);
  assert.equal(byId.custom.certificateAfterDays, null);
});
