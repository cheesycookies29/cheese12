// Leave types limited by gender, and the medical certificate rules on sick leave.
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
  await admin('POST', `/api/requests/${filed.id}/reject`, { note: 'Not eligible for paternity leave' });
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

test('sick leave of 4 or more days needs a medical certificate', async () => {
  const sl = (await admin('GET', '/api/leave-types')).find((t) => t.id === 'sl');
  assert.equal(sl.certificateFromDays, 4);
  assert.equal(sl.certificateAfterCount, null);
  const short = await asMaria('POST', '/api/me/requests', leave('sl', '2026-03-03'));
  assert.equal(short.certificateRequired, false, '2 days: no certificate needed');
  await asMaria('POST', `/api/me/requests/${short.id}/cancel`);

  await assert.rejects(asMaria('POST', '/api/me/requests', leave('sl', '2026-03-06')), /Sick Leave of 4 or more work days needs a medical certificate \(this request is 5 work days\)/);
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
  await admin('PUT', '/api/leave-types/sl', { ...sl, certificateFromDays: '' });
  const filed = await asMaria('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'sl', startDate: '2026-04-06', endDate: '2026-04-10' });
  await admin('PUT', '/api/leave-types/sl', { ...sl, certificateFromDays: 4 });
  await assert.rejects(admin('POST', `/api/requests/${filed.id}/approve`), /needs a medical certificate/);
  await asMaria('PUT', `/api/me/requests/${filed.id}/attachment`, { attachment: PDF });
  assert.equal((await admin('POST', `/api/requests/${filed.id}/approve`)).status, 'approved');
});

test('leave types saved by older builds get the rules from the built-in defaults', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-old-')), 'db.json');
  const old = openDb(file);
  for (const t of old.data.leaveTypes) {
    delete t.gender;
    delete t.certificateFromDays;
    delete t.certificateAfterCount;
    delete t.certificatePeriod;
  }
  // a type saved with the old rule, "longer than N days"
  Object.assign(old.data.leaveTypes.find((t) => t.id === 'el'), { certificateAfterDays: 0 });
  old.data.leaveTypes.push({ id: 'custom', code: 'BL', name: 'Birthday Leave', paid: true, annualCredits: 1, active: true });
  old.save();
  const reopened = openDb(file);
  createApi(reopened);
  const byId = Object.fromEntries(reopened.data.leaveTypes.map((t) => [t.id, t]));
  assert.equal(byId.ml.gender, 'Female');
  assert.equal(byId.pl.gender, 'Male');
  assert.equal(byId.sl.certificateFromDays, 4);
  assert.equal(byId.el.certificateFromDays, 1, 'longer than 0 days = every request');
  assert.ok(!('certificateAfterDays' in byId.el));
  assert.equal(byId.sl.certificateAfterCount, null);
  assert.equal(byId.sl.certificatePeriod, 'year');
  assert.equal(byId.custom.gender, null);
  assert.equal(byId.custom.certificateFromDays, null);
});

// The admin sets how many sick leaves need a medical certificate: by days in one request, by the number
// of requests filed in a year or month, or both. Without the certificate the filing is refused.
const setSl = async (rules) => {
  const sl = (await admin('GET', '/api/leave-types')).find((t) => t.id === 'sl');
  return admin('PUT', '/api/leave-types/sl', { ...sl, certificateFromDays: '', certificateAfterCount: '', certificatePeriod: 'year', ...rules });
};
const cancelAll = async (c) => {
  for (const r of await c('GET', '/api/me/requests')) if (['pending', 'returned'].includes(r.status)) await c('POST', `/api/me/requests/${r.id}/cancel`);
};
const day = (date, extra = {}) => ({ kind: 'leave', leaveTypeId: 'sl', startDate: date, endDate: date, ...extra });

test('a certificate from 1 day means every sick leave, half days included', async () => {
  await setSl({ certificateFromDays: 1 });
  assert.equal((await admin('GET', '/api/leave-types')).find((t) => t.id === 'sl').certificateFromDays, 1);
  await assert.rejects(asJose('POST', '/api/me/requests', day('2026-05-04')), /Every Sick Leave request needs a medical certificate/);
  await assert.rejects(asJose('POST', '/api/me/requests', day('2026-05-04', { portions: { '2026-05-04': 'am' } })), /Every Sick Leave request/);
  const ok = await asJose('POST', '/api/me/requests', day('2026-05-04', { attachment: PDF }));
  assert.equal(ok.certificateRequired, true);
  await cancelAll(asJose);
  // 2 days: one-day requests pass, two-day ones need it
  await setSl({ certificateFromDays: 2 });
  const one = await asJose('POST', '/api/me/requests', day('2026-05-05'));
  assert.equal(one.certificateRequired, false);
  await assert.rejects(asJose('POST', '/api/me/requests', leave('sl', '2026-03-03', { startDate: '2026-05-11', endDate: '2026-05-12' })), /Sick Leave of 2 or more work days needs a medical certificate/);
  await cancelAll(asJose);
  await assert.rejects(setSl({ certificateFromDays: 0 }), /from 1 \(every request\)/);
  await assert.rejects(setSl({ certificateAfterCount: -1 }), /from 0 \(every request\)/);
});

test('after N sick leaves in a year, every further one needs a certificate', async () => {
  await setSl({ certificateAfterCount: 2, certificatePeriod: 'year' });
  const a = await asJose('POST', '/api/me/requests', day('2026-06-01'));
  const b = await asJose('POST', '/api/me/requests', day('2026-07-06'));
  assert.equal(a.certificateRequired, false);
  assert.equal(b.certificateRequired, false);
  // the employee's balances carry the rule and the counted requests, so the form can say so ahead
  const bal = (await asJose('GET', '/api/me/leave-balances?year=2026')).find((x) => x.leaveTypeId === 'sl');
  assert.equal(bal.certificateAfterCount, 2);
  assert.equal(bal.filings.length, 2);
  await assert.rejects(asJose('POST', '/api/me/requests', day('2026-08-03')), /already filed 2 Sick Leave requests this year; after 2, every further one needs a medical certificate/);
  const c = await asJose('POST', '/api/me/requests', day('2026-08-03', { attachment: PDF }));
  assert.equal(c.certificateRequired, true);
  // a cancelled or rejected request does not count
  await asJose('POST', `/api/me/requests/${c.id}/cancel`);
  await admin('POST', `/api/requests/${b.id}/reject`, { note: 'Wrong dates' });
  const d = await asJose('POST', '/api/me/requests', day('2026-08-04'));
  assert.equal(d.certificateRequired, false, 'only one other counted request this year');
  // another year starts the count again
  const next = await asJose('POST', '/api/me/requests', day('2027-01-04'));
  assert.equal(next.certificateRequired, false);
  await cancelAll(asJose);
});

test('counted per month, and the first requests stay approvable', async () => {
  await setSl({ certificateAfterCount: 1, certificatePeriod: 'month' });
  const first = await asAlex('POST', '/api/me/requests', day('2026-09-01'));
  await assert.rejects(asAlex('POST', '/api/me/requests', day('2026-09-02')), /already filed 1 Sick Leave request this month/);
  const second = await asAlex('POST', '/api/me/requests', day('2026-09-02', { attachment: PDF }));
  const october = await asAlex('POST', '/api/me/requests', day('2026-10-01'));
  assert.equal(october.certificateRequired, false, 'a new month');
  // the first one of the month does not need one, even with a later request filed
  assert.equal((await admin('POST', `/api/requests/${first.id}/approve`)).status, 'approved');
  assert.equal((await admin('POST', `/api/requests/${second.id}/approve`)).status, 'approved');
  // editing the first request in the month keeps it first; moving a later one into a busy month needs one
  await assert.rejects(asAlex('PUT', `/api/me/requests/${october.id}`, day('2026-09-03')), /already filed 2 Sick Leave requests this month/);
  await cancelAll(asAlex);
});

test('a request that now needs a certificate cannot be approved without one', async () => {
  await setSl({});
  const a = await asMaria('POST', '/api/me/requests', day('2027-11-04'));
  const b = await asMaria('POST', '/api/me/requests', day('2027-11-05'));
  await setSl({ certificateAfterCount: 1 });
  assert.equal((await admin('POST', `/api/requests/${a.id}/approve`)).status, 'approved');
  await assert.rejects(admin('POST', `/api/requests/${b.id}/approve`), /Cannot approve yet: The employee has already filed 1 Sick Leave request this year/);
  await asMaria('PUT', `/api/me/requests/${b.id}/attachment`, { attachment: PDF });
  assert.equal((await admin('POST', `/api/requests/${b.id}/approve`)).status, 'approved');
  // an older client sending the old field still sets the same rule
  const sl = (await admin('GET', '/api/leave-types')).find((t) => t.id === 'sl');
  const { certificateFromDays, ...rest } = sl;
  await admin('PUT', '/api/leave-types/sl', { ...rest, certificateAfterDays: 3 });
  assert.equal((await admin('GET', '/api/leave-types')).find((t) => t.id === 'sl').certificateFromDays, 4);
  await setSl({ certificateFromDays: 4 });
});
