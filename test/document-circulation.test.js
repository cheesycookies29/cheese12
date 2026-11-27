// Document circulation (0.70; after Lancaster ATLAS's): every module's downloadable forms in one place,
// with versions, who uploaded them and when; each module's Forms & downloads page; who keeps which
// module's forms; what users see (published, current version, their account type, modules they open);
// refused files; the audit log; the demo forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { docToPdf } from '../server/pdf/layout.js';
import { FORM_MODULE_IDS, managedModules, FORMS_ALL } from '../shared/forms.js';
import { ROLES, can, PERMISSION_LABELS, PERMISSION_GROUPS } from '../shared/roles.js';

const pdf = (text) => docToPdf({ title: text, blocks: [{ type: 'paragraph', runs: [{ text }] }] }, { size: 'a4' }).pdf;

test('the modules covered, the permissions and who keeps which forms by default', () => {
  assert.deepEqual(FORM_MODULE_IDS, ['home', 'hr', 'assets', 'helpdesk', 'crm', 'projects']);
  const labels = new Set(PERMISSION_LABELS.map(([p]) => p));
  for (const id of FORM_MODULE_IDS) assert.ok(labels.has(`forms.${id}`), `forms.${id} has a label`);
  assert.ok(labels.has(FORMS_ALL));
  assert.ok(PERMISSION_GROUPS.some((g) => g.permissions.includes('forms.hr')));
  const kept = (role) => managedModules(role, (p) => can(role, p));
  assert.deepEqual(kept('admin'), FORM_MODULE_IDS);
  assert.deepEqual(kept('hr'), ['hr']);
  assert.deepEqual(kept('it'), ['assets', 'helpdesk']);
  assert.deepEqual(kept('salesmgr'), ['crm']);
  assert.deepEqual(kept('pm'), ['projects']);
  for (const r of ['employee', 'sales', 'support', 'hrstaff', 'payroll']) assert.deepEqual(kept(r), [], r);
  assert.ok(Object.keys(ROLES).length >= 10);
});

// ----- The API -----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-forms-'));
const db = openDb(path.join(dir, 'db.json'));
const handle = createApi(db);
const client = () => {
  let cookie = '';
  return async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.7' } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res;
  };
};
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
  return true;
});
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'Correct-Horse-42' });
const as = {};
const emp = (await admin('POST', '/api/employees', { employeeNo: 'E-1', firstName: 'Emil', lastName: 'Cruz', hireDate: '2024-01-01', payType: 'monthly', rate: 30000 })).data;
for (const [username, role] of [['hope', 'hr'], ['emil', 'employee'], ['sal', 'sales']]) {
  await admin('POST', '/api/users', { name: username, username, role, password: 'Correct-Horse-42', mustChangePassword: false, ...(role === 'employee' ? { employeeId: emp.id } : {}) });
  as[username] = client();
  await as[username]('POST', '/api/auth/login', { username, password: 'Correct-Horse-42' });
}
const data = async (who, m, u, b) => (await who(m, u, b)).data;
// An upload in pieces, then finish.
async function upload(who, name, buf, finish) {
  const { id, chunkBytes } = await data(who, 'POST', '/api/forms/manage/uploads', { name, size: buf.length });
  for (let off = 0; off < buf.length; off += chunkBytes) await who('PUT', `/api/forms/manage/uploads/${id}`, { offset: off, data: buf.subarray(off, off + chunkBytes).toString('base64') });
  return data(who, 'POST', `/api/forms/manage/uploads/${id}/finish`, finish);
}
const auditLog = () => fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8');

test('a form: draft, published, new versions, restore; users get the current one only', async () => {
  const v1 = pdf('Leave form v1');
  const f = await upload(as.hope, 'Leave application.pdf', v1, { title: 'Leave application form', module: 'hr', category: 'Leave', code: 'HR-F-012', note: 'First issue' });
  assert.equal(f.status, 'draft');
  assert.equal(f.current.no, 1);
  assert.equal(f.everyone, true, 'for everyone who opens HR until narrowed');
  // A draft reaches nobody.
  assert.equal((await data(as.emil, 'GET', '/api/forms?module=hr')).total, 0);
  await fails(as.emil('GET', `/api/forms/${f.id}/file`), 404);
  // Published: the employee (self-service in HR) downloads it, as an attachment, never sniffed.
  await as.hope('POST', `/api/forms/manage/${f.id}/publish`, {});
  const list = await data(as.emil, 'GET', '/api/forms?module=hr');
  assert.equal(list.total, 1);
  assert.equal(list.categories[0].name, 'Leave');
  assert.equal(list.categories[0].forms[0].code, 'HR-F-012');
  assert.equal(list.manages, false);
  const file = await as.emil('GET', `/api/forms/${f.id}/file`);
  assert.ok(Buffer.from(file.data).equals(v1));
  assert.match(file.headers['Content-Disposition'], /^attachment; filename="Leave application\.pdf"/);
  assert.equal(file.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(file.headers['Content-Security-Policy'], /sandbox/);
  // Version 2: users get it; version 1 is for the people who keep the forms.
  const v2 = pdf('Leave form v2');
  const after = await upload(as.hope, 'Leave application v2.pdf', v2, { formId: f.id, note: 'Signatories updated' });
  assert.equal(after.current.no, 2);
  assert.deepEqual(after.versions.map((v) => v.no), [1]);
  assert.ok(Buffer.from((await as.emil('GET', `/api/forms/${f.id}/file`)).data).equals(v2));
  await fails(as.emil('GET', `/api/forms/manage/${f.id}/versions/1/file`), 403, /people who keep the company's forms/);
  assert.ok(Buffer.from((await as.hope('GET', `/api/forms/manage/${f.id}/versions/1/file`)).data).equals(v1));
  // Restore version 1: version 3, a copy; nothing is rewritten.
  const restored = await data(as.hope, 'POST', `/api/forms/manage/${f.id}/restore`, { no: 1 });
  assert.equal(restored.current.no, 3);
  assert.equal(restored.current.restoredFrom, 1);
  assert.equal(restored.versionCount, 3);
  assert.ok(Buffer.from((await as.emil('GET', `/api/forms/${f.id}/file`)).data).equals(v1));
  await fails(as.hope('POST', `/api/forms/manage/${f.id}/restore`, { no: 3 }), 400, /current version already/);
  // Retire: hidden from users, kept with its versions; a published form cannot be deleted.
  await fails(as.hope('DELETE', `/api/forms/manage/${f.id}`), 400, /Retire this form instead/);
  await as.hope('POST', `/api/forms/manage/${f.id}/retire`, {});
  assert.equal((await data(as.emil, 'GET', '/api/forms?module=hr')).total, 0);
  const back = await data(as.hope, 'POST', `/api/forms/manage/${f.id}/unretire`, {});
  assert.equal(back.status, 'published');
  // In the audit log, under Document circulation.
  const log = auditLog();
  for (const a of ['forms.upload', 'forms.version', 'forms.publish', 'forms.restore', 'forms.retire', 'forms.download-version']) assert.match(log, new RegExp(`"${a.replace('.', '\\.')}"`), a);
  assert.match(log, /Leave application form \(HR-F-012\)/);
});

test('who sees a form: its account types, and only if they open its module', async () => {
  // A Sales & CRM form for everyone still reaches only those who open Sales & CRM.
  const crm = await upload(admin, 'Quotation.pdf', pdf('Quotation'), { title: 'Quotation template', module: 'crm', status: 'published' });
  assert.equal((await data(as.sal, 'GET', '/api/forms?module=crm')).total, 1);
  await fails(as.emil('GET', '/api/forms?module=crm'), 404, /no forms for that module/);
  await fails(as.emil('GET', `/api/forms/${crm.id}/file`), 404);
  // Narrowed to HR Managers: the employee no longer sees an HR form.
  const hrOnly = await upload(as.hope, 'Payroll checklist.pdf', pdf('Checklist'), { title: 'Payroll checklist', module: 'hr', status: 'published', audience: ['hr'] });
  assert.equal(hrOnly.everyone, false);
  const titles = async (who, m) => (await data(who, 'GET', `/api/forms?module=${m}`)).categories.flatMap((c) => c.forms.map((x) => x.title));
  assert.ok(!(await titles(as.emil, 'hr')).includes('Payroll checklist'));
  assert.ok((await titles(as.hope, 'hr')).includes('Payroll checklist'));
  // Company-wide forms (the CORE home) reach everyone signed in.
  await upload(admin, 'Clearance.pdf', pdf('Clearance'), { title: 'Clearance form', module: 'home', status: 'published' });
  assert.deepEqual(await titles(as.sal, 'home'), ['Clearance form']);
  assert.deepEqual(await titles(as.emil, 'home'), ['Clearance form']);
  await fails(as.hope('PUT', `/api/forms/manage/${hrOnly.id}`, { audience: [] }), 400, /at least one account type/);
});

test('who keeps which forms: their modules only; settings for administrators', async () => {
  const mine = await data(as.hope, 'GET', '/api/forms/manage');
  assert.deepEqual(mine.modules.map((m) => m.id), ['hr']);
  assert.ok(mine.forms.every((f) => f.module === 'hr'));
  assert.equal(mine.canSettings, false);
  const crm = (await data(admin, 'GET', '/api/forms/manage')).forms.find((f) => f.module === 'crm');
  await fails(as.hope('PUT', `/api/forms/manage/${crm.id}`, { title: 'Mine now' }), 404);
  await fails(upload(as.hope, 'x.pdf', pdf('x'), { title: 'Not mine', module: 'crm' }), 403, /do not keep the forms of Sales & CRM/);
  await fails(as.emil('GET', '/api/forms/manage'), 403, /people who keep the company's forms/);
  await fails(as.sal('POST', '/api/forms/manage/uploads', { name: 'a.pdf', size: 10 }), 403);
  await fails(as.hope('PUT', '/api/forms/settings', { maxUploadMB: 5 }), 403, /Only administrators/);
  const s = await data(admin, 'PUT', '/api/forms/settings', { maxUploadMB: 5, families: ['pdf', 'word'] });
  assert.equal(s.maxUploadMB, 5);
  await fails(admin('PUT', '/api/forms/settings', { families: [] }), 400, /at least one kind/);
  // A file over the size or of a kind not ticked is refused, and the refusal recorded.
  await fails(as.hope('POST', '/api/forms/manage/uploads', { name: 'big.pdf', size: 6 * 1024 * 1024 }), 400, /larger than 5 MB/);
  await fails(upload(as.hope, 'photo.png', Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f80f0400010501020000000049454e44ae426082', 'hex'), { title: 'A picture', module: 'hr' }), 400);
  assert.match(auditLog(), /"forms\.refused"/);
  await admin('PUT', '/api/forms/settings', { maxUploadMB: 20, families: ['pdf', 'word', 'excel', 'powerpoint', 'legacy', 'opendocument', 'image', 'archive'] });
});

test('never accepted: programs, scripts and web pages; a draft never published can be deleted', async () => {
  await fails(as.hope('POST', '/api/forms/manage/uploads', { name: 'setup.exe', size: 100 }), 400, /never accepted/);
  await fails(upload(as.hope, 'form.pdf', Buffer.from('<html><script>alert(1)</script></html>'), { title: 'Sneaky', module: 'hr' }), 400);
  const d = await upload(as.hope, 'Draft.pdf', pdf('Draft'), { title: 'A draft', module: 'hr' });
  assert.equal(d.deletable, true);
  await as.hope('DELETE', `/api/forms/manage/${d.id}`);
  assert.ok(!(await data(as.hope, 'GET', '/api/forms/manage')).forms.some((f) => f.id === d.id));
  assert.match(auditLog(), /"forms\.delete"/);
});

test('the demo forms: generated PDFs in every module, one with three versions by two people, removed with the demo', async () => {
  await admin('POST', '/api/admin/demo');
  const all = (await data(admin, 'GET', '/api/forms/manage')).forms.filter((f) => f.demo);
  assert.ok(all.length >= 10);
  assert.deepEqual([...new Set(all.map((f) => f.module))].sort(), [...FORM_MODULE_IDS].sort());
  const clearance = all.find((f) => f.title === 'Clearance form' && f.demo);
  assert.equal(clearance.versionCount, 3);
  assert.equal(new Set([clearance.current.byName, ...clearance.versions.map((v) => v.byName)]).size, 2);
  assert.ok(all.some((f) => f.status === 'draft') && all.some((f) => f.status === 'retired'));
  const file = await admin('GET', `/api/forms/manage/${clearance.id}/versions/1/file`);
  assert.match(Buffer.from(file.data).subarray(0, 8).toString('latin1'), /%PDF-/);
  // Kept in Document Management's store: Documents' integrity check does not call them unused.
  const check = await data(admin, 'POST', '/api/docs/admin/integrity', {});
  assert.equal(check.orphans, 0);
  assert.equal(check.problems.length, 0);
  await admin('DELETE', '/api/admin/demo');
  assert.equal((await data(admin, 'GET', '/api/forms/manage')).forms.filter((f) => f.demo).length, 0);
});
