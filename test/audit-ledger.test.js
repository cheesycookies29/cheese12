// 0.11: the audit log, the year-to-date ledger, locked (voidable) payroll runs, and limits on
// sensitive employee data (pay, government IDs, bank accounts, medical certificates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-audit-'));
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
async function login(username, role, employeeId = null) {
  await admin('POST', '/api/users', { name: username, username, role, employeeId, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  return c;
}
const boss = await admin('POST', '/api/employees', { employeeNo: 'E-1', firstName: 'Lea', lastName: 'Reyes', hireDate: '2024-01-01', payType: 'monthly', rate: 40000, gender: 'Female' });
const ana = await admin('POST', '/api/employees', {
  employeeNo: 'E-2', firstName: 'Ana', lastName: 'Cruz', hireDate: '2024-01-01', payType: 'monthly', rate: 30000, gender: 'Female',
  tin: '123-456-789-000', sssNo: '34-1234567-8', bankName: 'BDO', bankAccount: '001234567890', supervisorId: boss.id,
});
const hr = await login('hana', 'hr');
const staff = await login('stella', 'hrstaff');
const asAna = await login('ana', 'employee', ana.id);
const asLea = await login('lea', 'employee', boss.id);
const log = async (q = '') => (await admin('GET', `/api/audit${q}`)).entries;

test('government IDs and bank accounts are masked; full numbers come on request and are logged', async () => {
  const list = await hr('GET', '/api/employees');
  const a = list.find((e) => e.id === ana.id);
  assert.equal(a.tin, '••••-000');
  assert.equal(a.bankAccount, '••••7890');
  assert.equal(a.rate, 30000, 'HR still sees pay');
  const full = await hr('GET', `/api/employees/${ana.id}/private?purpose=edit`);
  assert.equal(full.tin, '123-456-789-000');
  assert.equal(full.sssNo, '34-1234567-8');
  const reveal = (await log('?area=employee')).find((e) => e.action === 'employee.reveal');
  assert.equal(reveal.userName, 'hana');
  assert.match(reveal.label, /Ana Cruz/);
  assert.equal(reveal.note, 'Opened for editing');
  // Saving the record with the masked numbers keeps the real ones.
  await hr('PUT', `/api/employees/${ana.id}`, { ...a, position: 'Analyst' });
  assert.equal(db.data.employees.find((e) => e.id === ana.id).tin, '123-456-789-000');
  const upd = (await log('?area=employee')).find((e) => e.action === 'employee.update');
  assert.deepEqual(upd.changes, [{ field: 'position', from: '', to: 'Analyst' }]);
});

test('HR Staff see employee records without pay, government IDs or bank details', async () => {
  const a = (await staff('GET', '/api/employees')).find((e) => e.id === ana.id);
  assert.equal(a.restricted, true);
  for (const f of ['rate', 'allowance', 'tin', 'sssNo', 'bankAccount', 'bankName']) assert.equal(f in a, false, f);
  assert.equal(a.firstName, 'Ana');
  await assert.rejects(staff('GET', `/api/employees/${ana.id}/private`), /does not have access/);
  await assert.rejects(staff('GET', '/api/employees/export'), /does not have access/);
  await assert.rejects(staff('GET', '/api/payroll-runs'), /does not have access/);
  await assert.rejects(staff('GET', '/api/audit'), /does not have access/);
});

test('changes to pay are logged field by field, with ID numbers masked', async () => {
  const before = (await admin('GET', `/api/employees/${ana.id}`));
  await admin('PUT', `/api/employees/${ana.id}`, { ...before, rate: 32000, tin: '999-888-777-000' });
  const e = (await log('?q=ana')).find((x) => x.action === 'employee.update' && x.changes.some((c) => c.field === 'rate'));
  assert.deepEqual(e.changes.find((c) => c.field === 'rate'), { field: 'rate', from: '30000', to: '32000' });
  assert.deepEqual(e.changes.find((c) => c.field === 'tin'), { field: 'tin', from: '••••-000', to: '••••-000' });
  assert.equal(e.userName, 'Admin');
});

test('sign-ins, failed sign-ins and changes without their own entry are logged', async () => {
  const c = client();
  await assert.rejects(c('POST', '/api/auth/login', { username: 'ana', password: 'wrong-one' }), /Incorrect/);
  const failed = (await log('?area=auth')).find((e) => e.action === 'auth.login-failed');
  assert.equal(failed.userName, 'Unknown (ana)');
  assert.ok((await log('?area=auth')).some((e) => e.action === 'auth.login' && e.userName === 'hana'));
  // Leave credits have no detailed entry: the generic one names the route.
  await hr('PUT', '/api/leave-credits', { employeeId: ana.id, year: 2027, leaveTypeId: 'vl', credits: 16 });
  const generic = (await log('?area=leave')).find((e) => e.action === 'leave.change');
  assert.equal(generic.label, 'PUT /api/leave-credits');
  assert.equal(generic.userName, 'hana');
});

test('payroll: finalizing posts the year to date; a finalized run is voided, never deleted', async () => {
  // Present every work day of the first half of January 2027 (Jan 1 is New Year's Day).
  for (const d of ['04', '05', '06', '07', '08', '11', '12', '13', '14', '15']) {
    for (const emp of [ana, boss]) await admin('POST', '/api/time-entries', { employeeId: emp.id, date: `2027-01-${d}`, type: 'work', timeIn: '09:00', timeOut: '18:00' });
  }
  const run = await admin('POST', '/api/payroll-runs', { periodStart: '2027-01-01', periodEnd: '2027-01-15', payDate: '2027-01-15' });
  await admin('PUT', `/api/payroll-runs/${run.id}/payslips/${ana.id}`, { otherEarnings: 1000, remarks: 'Referral bonus' });
  const adj = (await log('?area=payroll')).find((e) => e.action === 'payroll.run.adjust');
  assert.deepEqual(adj.changes.map((c) => c.field), ['otherEarnings', 'remarks']);
  assert.equal((await admin('GET', '/api/payroll-ledger?year=2027')).totals.length, 0, 'drafts are not in the year to date');

  const fin = await admin('POST', `/api/payroll-runs/${run.id}/finalize`);
  assert.equal(fin.finalizedBy, 'Admin');
  const ytd = await admin('GET', '/api/payroll-ledger?year=2027');
  const t = ytd.totals.find((x) => x.employeeId === ana.id);
  const slip = fin.payslips.find((p) => p.employeeId === ana.id);
  assert.equal(t.runs, 1);
  assert.equal(t.grossPay, slip.grossPay);
  assert.equal(t.otherEarnings, 1000);
  assert.equal(t.withholdingTax, slip.deductions.withholdingTax);
  assert.equal(t.thirteenthBasis, slip.earnings.basicPay);
  assert.equal(t.thirteenthMonthSoFar, Math.round((slip.earnings.basicPay / 12) * 100) / 100);
  assert.deepEqual(await asAna('GET', '/api/me/ytd?year=2027').then((r) => r.totals.grossPay), slip.grossPay);
  await assert.rejects(admin('PUT', `/api/payroll-runs/${run.id}/payslips/${ana.id}`, { otherEarnings: 5 }), /finalized/);

  // Editing attendance inside the finalized period is allowed, flagged and logged.
  const entry = db.data.timeEntries.find((e) => e.employeeId === ana.id && e.date === '2027-01-05');
  const changed = await admin('PUT', `/api/time-entries/${entry.id}`, { ...entry, timeOut: '17:00' });
  assert.match(changed.warning, /finalized payroll for 2027-01-01 to 2027-01-15/);
  assert.match((await log('?area=attendance')).find((e) => e.action === 'attendance.update').note, /does not change/);

  await assert.rejects(admin('DELETE', `/api/payroll-runs/${run.id}`), /Void it instead/);
  await assert.rejects(admin('POST', `/api/payroll-runs/${run.id}/void`, {}), /reason for voiding/);
  const v = await admin('POST', `/api/payroll-runs/${run.id}/void`, { reason: 'Wrong pay date; reissued' });
  assert.equal(v.status, 'voided');
  assert.equal((await admin('GET', '/api/payroll-ledger?year=2027')).totals.length, 0, 'voided payslips leave the year to date');
  const mine = await asAna('GET', '/api/me/payslips');
  assert.equal(mine[0].status, 'voided', 'the employee still sees it, marked voided');
  assert.match((await log('?area=payroll')).find((e) => e.action === 'payroll.run.void').note, /Wrong pay date/);
});

test('opening balances: earlier pay at LTDC counts toward the 13th month; a previous employer’s does not', async () => {
  await assert.rejects(admin('POST', '/api/payroll-ledger/openings', { employeeId: ana.id, year: 2027, source: 'previous-employer', grossPay: 50000 }), /Add a note/);
  await admin('POST', '/api/payroll-ledger/openings', { employeeId: ana.id, year: 2027, source: 'previous-employer', grossPay: 60000, basicPay: 60000, taxableIncome: 55000, withholdingTax: 2500, note: 'BIR 2316 from ABC Corp.' });
  const o2 = await admin('POST', '/api/payroll-ledger/openings', { employeeId: boss.id, year: 2027, source: 'before-core', grossPay: 40000, basicPay: 40000, note: 'January, old payroll' });
  const ytd = await admin('GET', '/api/payroll-ledger?year=2027');
  const a = ytd.totals.find((t) => t.employeeId === ana.id);
  const l = ytd.totals.find((t) => t.employeeId === boss.id);
  assert.deepEqual([a.grossPay, a.withholdingTax, a.thirteenthBasis], [60000, 2500, 0]);
  assert.deepEqual([l.grossPay, l.thirteenthBasis], [40000, 40000]);
  assert.equal(ytd.openings.length, 2);
  await admin('DELETE', `/api/payroll-ledger/openings/${o2.id}`, { reason: 'Entered twice' });
  assert.equal((await admin('GET', '/api/payroll-ledger?year=2027')).totals.some((t) => t.employeeId === boss.id), false);
  await assert.rejects(hr('POST', '/api/payroll-ledger/openings', { employeeId: ana.id, year: 2027, source: 'before-core', grossPay: 1, note: 'x' }), /does not have access/);
});

test('medical certificates: HR opens them; other approvers only if the approval flow allows', async () => {
  const PDF = { name: 'certificate.pdf', data: Buffer.from('%PDF-1.4\n% medical certificate\n').toString('base64') };
  const r = await asAna('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'sl', startDate: '2027-02-02', endDate: '2027-02-05', reason: 'Flu', attachment: PDF });
  const seen = (await asLea('GET', '/api/approvals')).find((x) => x.id === r.id);
  assert.equal(seen.attachmentLocked, true);
  await assert.rejects(asLea('GET', `/api/approvals/${r.id}/attachment`), /Only HR can open medical certificates/);
  assert.ok(await hr('GET', `/api/requests/${r.id}/attachment`));
  const flow = await admin('GET', '/api/approval-flow');
  await admin('PUT', '/api/approval-flow', { flow: flow.flow, levels: flow.levels, attachmentsToApprovers: true });
  assert.ok(await asLea('GET', `/api/approvals/${r.id}/attachment`));
  assert.ok((await log('?area=leave')).some((e) => e.action === 'leave.attachment' && e.userName === 'lea'));
});

test('the audit log is a hash chain: an edited line is detected', async () => {
  const ok = await admin('GET', '/api/audit/verify');
  assert.equal(ok.ok, true);
  assert.ok(ok.count > 20);
  assert.ok((await log()).some((e) => e.action === 'data.export') === false);
  await admin('GET', '/api/admin/export');
  assert.equal((await log())[0].action, 'data.export', 'newest first');
  // Erasing all data keeps the audit log.
  await admin('POST', '/api/admin/reset');
  assert.equal((await log())[0].action, 'data.reset');
  assert.equal((await admin('GET', '/api/audit/verify')).ok, true);
  const file = path.join(dir, 'audit-log.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const third = JSON.parse(lines[2]);
  lines[2] = JSON.stringify({ ...third, userName: 'Someone else' });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const bad = await admin('GET', '/api/audit/verify');
  assert.equal(bad.ok, false);
  assert.equal(bad.brokenAt, 3);
});
