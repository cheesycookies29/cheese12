// Document circulation (server/forms.js, shared/forms.js): every module's downloadable forms in one
// place. Uploads and versions with who and when, restore as a new version, file types from the bytes
// and the size limit, who sees what on each system's Forms & downloads page, public forms signed out,
// managers limited to their modules, Documents left out, retire, earlier versions for managers only,
// the audit log, encryption at rest, the Settings center, and the entry beside PDF Studio in Tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { setup } from './support.js';
import { writeCfb } from './support/cfb-writer.js';
import { hashPassword } from '../server/auth.js';
import { demoPdf, demoDocx, storedZip } from '../server/demo.js';
import { checkFile, cleanName, contentDisposition, entryExts, ZIP_MAX_DEPTH, FAMILIES } from '../server/dms/types.js';
import { createDownloadGate } from '../server/download-gate.js';
import { clientIp } from '../server/ratelimit.js';
import { FORM_MODULES, FORM_MODULE_IDS, FORMS_PERMISSION_LABELS, managedModules } from '../shared/forms.js';
import { ROLES, can } from '../shared/roles.js';
import { SYSTEMS } from '../shared/systems.js';

const PW = 'password123';
const V1 = demoPdf('Leave application', ['Version one: name, office, dates. Marker LEAVE-V1-TEXT']);
const V2 = demoPdf('Leave application', ['Version two: signatories updated. Marker LEAVE-V2-TEXT']);
const DOCX = demoDocx(['Request for quotation', 'Items and prices']);
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, `${err.status}: ${err.message}`);
  if (re) assert.match(err.message, re);
  return true;
});

async function school() {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const campusIds = [(await admin.get('/api/admin/campuses'))[0].id];
  const mk = (role, username, name) => admin.post('/api/admin/users', { role, username, name, password: PW, mustChangePassword: false, campusIds });
  for (const [role, username, name] of [['teacher', 'tess', 'Tess Teacher'], ['student', 'sam', 'Sam Student'], ['guardian', 'gina', 'Gina Guardian'], ['registrar', 'rita', 'Rita Registrar']]) await mk(role, username, name);
  const hash = hashPassword(PW);
  for (const [role, username, name] of [['hr', 'hana', 'Hana HR'], ['accountant', 'alma', 'Alma Accountant'], ['staff', 'lito', 'Lito Staff']]) {
    env.db.data.users.push({ id: `u-${username}`, role, username, name, status: 'active', passwordHash: hash, mustChangePassword: false, campusIds, createdAt: new Date().toISOString() });
  }
  const signIn = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: PW });
    return c;
  };
  const P = {};
  for (const u of ['tess', 'sam', 'gina', 'rita', 'hana', 'alma', 'lito']) P[u] = await signIn(u);
  return { env, admin, P };
}
async function upload(c, name, buf, extra = {}) {
  const { id, chunkBytes } = await c.post('/api/forms/manage/uploads', { name, size: buf.length });
  for (let at = 0; at < buf.length; at += chunkBytes) await c.put(`/api/forms/manage/uploads/${id}`, { offset: at, data: buf.subarray(at, at + chunkBytes).toString('base64') });
  return c.post(`/api/forms/manage/uploads/${id}/finish`, extra);
}

const { env, admin, P } = await school();
const formsDir = env.api.forms.dir;
test.after(() => {
  fs.rmSync(formsDir, { recursive: true, force: true });
  fs.rmSync(env.api.documents.dir, { recursive: true, force: true });
});
const trail = () => env.api.audit.entries().filter((e) => e.system === 'forms');

test('the modules: every built-in system but ATLAS Documents, with the ATLAS home and Tools', () => {
  assert.deepEqual(FORM_MODULE_IDS, ['home', ...SYSTEMS.filter((s) => s.builtIn && s.id !== 'dms').map((s) => s.id), 'tools']);
  assert.ok(!FORM_MODULE_IDS.includes('dms'), 'Documents is the document management module: never covered');
  for (const id of ['uis', 'lms', 'hris', 'fmis']) assert.ok(FORM_MODULE_IDS.includes(id));
  // One permission per module, and forms.manage for all.
  assert.deepEqual(FORMS_PERMISSION_LABELS.map(([p]) => p), ['forms.manage', ...FORM_MODULE_IDS.map((id) => `forms.${id}`)]);
  // The default managers: the registrar Academic and Learn, HR People, the accountant Finance.
  assert.deepEqual(managedModules('registrar', (p) => can('registrar', p)), ['uis', 'lms']);
  assert.deepEqual(managedModules('hr', (p) => can('hr', p)), ['hris']);
  assert.deepEqual(managedModules('accountant', (p) => can('accountant', p)), ['fmis']);
  assert.deepEqual(managedModules('teacher', (p) => can('teacher', p)), []);
  assert.deepEqual(managedModules('admin', (p) => can('admin', p)), FORM_MODULE_IDS);
  assert.ok(FORM_MODULES.every((m) => m.audience.length));
});

test('upload and versions: who uploaded each and when; the type from the bytes; the size limit', async () => {
  const f = await upload(P.hana, 'Leave application.pdf', V1, { title: 'Leave application', module: 'hris', category: 'Leave', code: 'HR-F-012 Rev. 3', audience: ['teacher', 'staff'], description: 'The paper form.' });
  assert.deepEqual([f.status, f.module, f.code, f.current.no, f.current.byName, f.current.ext, f.current.size], ['draft', 'hris', 'HR-F-012 Rev. 3', 1, 'Hana HR', 'pdf', V1.length]);
  assert.equal(f.current.at, new Date('2026-08-10T10:00:00').toISOString(), 'when: the server\'s time');
  assert.equal(f.current.note, 'First version');
  assert.deepEqual(f.versions, [], 'no earlier versions yet');
  assert.equal(f.deletable, true);
  const two = await upload(P.hana, 'Leave application v2.pdf', V2, { formId: f.id, note: 'Signatories updated' });
  assert.deepEqual([two.current.no, two.current.note, two.versions.map((v) => v.no), two.versions[0].byName], [2, 'Signatories updated', [1], 'Hana HR']);
  // A new version may be another kind of file (a form moving from Word to PDF).
  const rfq = await upload(P.alma, 'RFQ.docx', DOCX, { title: 'Request for quotation', module: 'fmis', category: 'Procurement', audience: ['supply', 'accountant'], status: 'published' });
  assert.equal(rfq.current.ext, 'docx');
  assert.equal(rfq.status, 'published');
  // Refused: programs, web pages, macros, passwords, a name that lies, and kinds not ticked.
  await fails(upload(P.hana, 'tool.exe', Buffer.from('MZxxxx')), 400, /never accepted/);
  await fails(upload(P.hana, 'form.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 1)]), { title: 'x', module: 'hris', audience: ['staff'] }), 400, /program or a script/);
  await fails(upload(P.hana, 'page.pdf', Buffer.from('<!DOCTYPE html><script>alert(1)</script>'), { title: 'x', module: 'hris', audience: ['staff'] }), 400, /web page/);
  const macro = storedZip([{ name: '[Content_Types].xml', data: '<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>' }, { name: 'word/document.xml', data: '<w:document/>' }]);
  await fails(upload(P.hana, 'memo.docx', macro, { title: 'x', module: 'hris', audience: ['staff'] }), 400, /macros/);
  const locked = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504), Buffer.from('EncryptedPackage', 'utf16le')]);
  await fails(upload(P.hana, 'secret.docx', locked, { title: 'x', module: 'hris', audience: ['staff'] }), 400, /password/);
  await fails(upload(P.hana, 'photo.jpg', V1, { title: 'x', module: 'hris', audience: ['staff'] }), 400, /called \.jpg but it is a PDF/);
  await fails(upload(P.hana, 'notes.txt', Buffer.from('plain text'), { title: 'x', module: 'hris', audience: ['staff'] }), 400, /not accepted here/);
  // The size limit: 20 MB by default, 1 to 100.
  await fails(P.hana.post('/api/forms/manage/uploads', { name: 'big.pdf', size: 21 * 1024 * 1024 }), 400, /larger than 20 MB/);
  await admin.put('/api/forms/settings', { maxUploadMB: 1 });
  await fails(P.hana.post('/api/forms/manage/uploads', { name: 'big.pdf', size: 2 * 1024 * 1024 }), 400, /larger than 1 MB/);
  await fails(admin.put('/api/forms/settings', { maxUploadMB: 101 }), 400, /1 to 100/);
  await fails(admin.put('/api/forms/settings', { families: [] }), 400, /at least one/);
  await fails(P.hana.put('/api/forms/settings', { maxUploadMB: 50 }), 403, /administrators/);
  await admin.put('/api/forms/settings', { maxUploadMB: 20 });
  // A piece out of place; someone else's upload.
  const up = await P.hana.post('/api/forms/manage/uploads', { name: 'x.pdf', size: 10 });
  await fails(P.hana.put(`/api/forms/manage/uploads/${up.id}`, { offset: 4, data: 'YWJj' }), 409, /lost its place/);
  await fails(P.alma.put(`/api/forms/manage/uploads/${up.id}`, { offset: 0, data: 'YQ==' }), 404, /no longer on the server/);
  await P.hana.del(`/api/forms/manage/uploads/${up.id}`);
  // A big file in several pieces arrives whole.
  const big = Buffer.concat([V1.subarray(0, V1.length - 6), Buffer.alloc(9 * 1024 * 1024, 0x20), Buffer.from('\n%%EOF')]);
  const bigForm = await upload(admin, 'Handbook.pdf', big, { title: 'Handbook', module: 'home', audience: ['student'], status: 'published' });
  assert.equal(bigForm.current.size, big.length);
  assert.deepEqual((await admin.get(`/api/forms/manage/${bigForm.id}/versions/1/file`)).raw, big);
});

const formNamed = async (c, title) => (await c.get('/api/forms/manage')).forms.find((f) => f.title === title);

test('managers see and change only their modules; everyone else is refused', async () => {
  const hr = await P.hana.get('/api/forms/manage');
  assert.deepEqual(hr.modules.map((m) => m.id), ['hris'], 'an HR Manager sees People only');
  assert.ok(hr.forms.every((f) => f.module === 'hris'));
  assert.equal(hr.canSettings, false);
  assert.deepEqual((await P.rita.get('/api/forms/manage')).modules.map((m) => m.id), ['uis', 'lms']);
  assert.deepEqual((await P.alma.get('/api/forms/manage')).modules.map((m) => m.id), ['fmis']);
  const all = await admin.get('/api/forms/manage');
  assert.deepEqual(all.modules.map((m) => m.id), FORM_MODULE_IDS);
  assert.equal(all.canSettings, true);
  // Counts per module at the top.
  assert.deepEqual(all.modules.find((m) => m.id === 'hris').counts, { total: 1, published: 0, draft: 1, retired: 0 });
  // Not a manager: refused; another office's form: as if it were not there.
  for (const who of ['tess', 'sam', 'gina', 'lito']) await fails(P[who].get('/api/forms/manage'), 403, /keep the school's forms/);
  await fails(env.client().get('/api/forms/manage'), 401);
  const rfq = await formNamed(P.alma, 'Request for quotation');
  await fails(P.hana.put(`/api/forms/manage/${rfq.id}`, { title: 'Mine now' }), 404);
  await fails(P.hana.get(`/api/forms/manage/${rfq.id}/versions/1/file`), 404);
  await fails(upload(P.hana, 'RFQ.pdf', V1, { formId: rfq.id }), 404);
  await fails(upload(P.hana, 'x.pdf', V1, { title: 'x', module: 'fmis', audience: ['supply'] }), 403, /do not keep the forms of ATLAS Finance/);
  const leave = await formNamed(P.hana, 'Leave application');
  await fails(P.hana.put(`/api/forms/manage/${leave.id}`, { module: 'fmis' }), 403);
  // The permission: forms.manage gives every module; forms.<module> one.
  const lito = env.db.data.users.find((u) => u.username === 'lito');
  lito.access = { add: ['forms.tools'] };
  assert.deepEqual((await P.lito.get('/api/forms/manage')).modules.map((m) => m.id), ['tools']);
  lito.access = { add: ['forms.manage'] };
  assert.deepEqual((await P.lito.get('/api/forms/manage')).modules.map((m) => m.id), FORM_MODULE_IDS);
  delete lito.access;
  // Roles & permissions lists them, and they can be given to employee account types only.
  const roles = await admin.get('/api/admin/roles');
  const g = roles.groups.find((x) => x.id === 'forms');
  assert.deepEqual(g.permissions.map((p) => p.id), FORMS_PERMISSION_LABELS.map(([p]) => p));
  assert.ok(!g.roles.includes('student') && !g.roles.includes('guardian') && g.roles.includes('supply'));
  await admin.put('/api/admin/roles', { permissions: { supply: [...ROLES.supply.permissions, 'forms.fmis'] } });
  const sup = env.client();
  env.db.data.users.push({ id: 'u-sol', role: 'supply', username: 'sol', name: 'Sol Supply', status: 'active', passwordHash: hashPassword(PW), mustChangePassword: false, campusIds: [], createdAt: '' });
  await sup.post('/api/hub/login', { username: 'sol', password: PW });
  assert.deepEqual((await sup.get('/api/forms/manage')).modules.map((m) => m.id), ['fmis']);
  await fails(admin.put('/api/admin/roles', { permissions: { student: ['forms.lms'] } }), 400);
  await admin.put('/api/admin/roles', { permissions: { supply: ROLES.supply.permissions } });
});

test('Forms & downloads: the current published version, for the account types it is for; public ones signed out; the rest 404', async () => {
  const leave = await formNamed(P.hana, 'Leave application');
  // A draft is not shown to anyone.
  assert.equal((await P.tess.get('/api/forms?module=hris')).total, 0);
  await fails(P.tess.get(`/api/forms/${leave.id}/file`), 404);
  await P.hana.post(`/api/forms/manage/${leave.id}/publish`, {});
  // For teachers and staff: Tess (teacher) and Lito (staff) see it, with version 2's file; the accountant does not.
  const list = await P.tess.get('/api/forms?module=hris');
  assert.equal(list.total, 1);
  assert.deepEqual(list.categories.map((c) => c.name), ['Leave']);
  const row = list.categories[0].forms[0];
  assert.deepEqual([row.title, row.code, row.description, row.size], ['Leave application', 'HR-F-012 Rev. 3', 'The paper form.', V2.length]);
  assert.equal(row.versions, undefined, 'users never see earlier versions');
  assert.equal(row.by, undefined);
  assert.equal((await P.lito.get('/api/forms?module=hris')).total, 1);
  assert.equal((await P.alma.get('/api/forms?module=hris')).total, 0, 'not for accountants');
  await fails(P.alma.get(`/api/forms/${leave.id}/file`), 404);
  const file = await P.tess.get(`/api/forms/${leave.id}/file`);
  assert.deepEqual(file.raw, V2, 'the current version');
  assert.match(file.headers['Content-Disposition'], /^attachment; filename="Leave application v2.pdf"/);
  assert.equal(file.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(file.headers['Content-Security-Policy'], /sandbox/);
  assert.equal(file.type, 'application/pdf');
  // Other systems' pages do not list it; an unknown module is 404.
  assert.equal((await P.tess.get('/api/forms?module=lms')).total, 0);
  await fails(P.tess.get('/api/forms?module=dms'), 404);
  // Users cannot reach earlier versions.
  await fails(P.tess.get(`/api/forms/manage/${leave.id}/versions/1/file`), 403);
  // Signed out: nothing until a form is public; then that one only.
  const anon = env.client();
  const handbook = await formNamed(admin, 'Handbook');
  assert.equal((await anon.get('/api/public/forms')).total, 0);
  assert.equal((await anon.get('/api/hub/status')).publicForms, 0);
  await fails(anon.get(`/api/public/forms/${handbook.id}/file`), 404);
  await fails(anon.get(`/api/forms/${handbook.id}/file`), 401);
  await fails(anon.get(`/api/public/forms/${leave.id}/file`), 404);
  await fails(anon.get('/api/public/forms/not-a-form/file'), 404);
  await fails(anon.get('/api/public/forms/'), 404, /Not found/);
  const job = await upload(P.hana, 'Job application.pdf', V1, { title: 'Job application form', module: 'hris', category: 'Recruitment', audience: ['hr'], public: true, status: 'published' });
  const pub = await anon.get('/api/public/forms');
  assert.deepEqual(pub.modules.map((m) => [m.id, m.categories.map((c) => c.forms.map((f) => f.title))]), [['hris', [['Job application form']]]]);
  assert.equal((await anon.get('/api/hub/status')).publicForms, 1);
  assert.deepEqual((await anon.get(`/api/public/forms/${job.id}/file`)).raw, V1);
  // A public form is for everyone signed in to that system too.
  assert.ok((await P.alma.get('/api/forms?module=hris')).categories.some((c) => c.forms.some((f) => f.id === job.id)));
  // Public downloads are rate-limited per address.
  const crowd = env.client({ ip: '203.0.113.9' });
  let refused = null;
  for (let i = 0; i < 80 && !refused; i++) {
    try {
      await crowd.get(`/api/public/forms/${job.id}/file`);
    } catch (err) {
      refused = err;
    }
  }
  assert.equal(refused?.status, 429);
});

test('restore makes a new version that copies the old one; retire hides a form from users and keeps it; only a never-published draft can be deleted', async () => {
  const leave = await formNamed(P.hana, 'Leave application');
  const r = await P.hana.post(`/api/forms/manage/${leave.id}/restore`, { no: 1 });
  assert.deepEqual([r.current.no, r.current.restoredFrom, r.current.note, r.current.byName], [3, 1, 'Restored from version 1', 'Hana HR']);
  assert.deepEqual(r.versions.map((v) => v.no), [2, 1], 'history kept, nothing rewritten');
  assert.deepEqual((await P.tess.get(`/api/forms/${leave.id}/file`)).raw, V1, 'users now get version 1\'s file');
  await fails(P.hana.post(`/api/forms/manage/${leave.id}/restore`, { no: 3 }), 400, /current version already/);
  await fails(P.hana.post(`/api/forms/manage/${leave.id}/restore`, { no: 9 }), 400, /not there/);
  // Earlier versions download for managers (and go to the audit log).
  assert.deepEqual((await P.hana.get(`/api/forms/manage/${leave.id}/versions/2/file`)).raw, V2);
  // Details: title, code, category, who it is for.
  const edited = await P.hana.put(`/api/forms/manage/${leave.id}`, { title: 'Application for leave', code: 'HR-F-012 Rev. 4', audience: ['teacher', 'staff', 'hr', 'student'] });
  assert.deepEqual([edited.title, edited.code, edited.audience], ['Application for leave', 'HR-F-012 Rev. 4', ['teacher', 'staff', 'hr']], 'students are not People\'s: left out');
  await fails(P.hana.put(`/api/forms/manage/${leave.id}`, { title: '' }), 400, /title/);
  await fails(P.hana.put(`/api/forms/manage/${leave.id}`, { audience: [], public: false }), 400, /who the form is for/);
  // Retire: hidden from users, kept for managers with its versions; bring it back.
  await fails(P.hana.del(`/api/forms/manage/${leave.id}`), 400, /Retire this form instead/);
  const retired = await P.hana.post(`/api/forms/manage/${leave.id}/retire`, {});
  assert.equal(retired.status, 'retired');
  const shows = async () => (await P.tess.get('/api/forms?module=hris')).categories.some((c) => c.forms.some((f) => f.id === leave.id));
  assert.equal(await shows(), false);
  await fails(P.tess.get(`/api/forms/${leave.id}/file`), 404);
  assert.equal((await formNamed(P.hana, 'Application for leave')).versionCount, 3);
  assert.equal((await P.hana.post(`/api/forms/manage/${leave.id}/unretire`, {})).status, 'published');
  assert.equal(await shows(), true);
  // A draft never published can be deleted, with its files.
  const draft = await upload(P.rita, 'Shifting form.pdf', V1, { title: 'Shifting form', module: 'uis', audience: ['student'] });
  const blobId = env.db.data.forms.find((f) => f.id === draft.id).versions[0].blobId;
  assert.ok(env.api.forms.blobs.exists(blobId));
  await P.rita.del(`/api/forms/manage/${draft.id}`);
  assert.ok(!env.api.forms.blobs.exists(blobId));
  assert.ok(!(await P.rita.get('/api/forms/manage')).forms.some((f) => f.id === draft.id));
});

test('everything is in the audit log: uploads, versions, restores, details, publishing, retiring, deletes, downloads of versions, refusals, settings', () => {
  const actions = trail().map((e) => e.action);
  for (const a of ['Uploaded a new form (draft)', 'Uploaded version 2', 'Uploaded and published a new form', 'Published a form', 'Restored version 1 as version 3', 'Changed the details of a form', 'Retired a form', 'Brought back a retired form', 'Deleted a draft form', 'Downloaded an earlier version (2)', 'Upload refused', 'Changed the Document circulation settings']) {
    assert.ok(actions.includes(a), `${a} in ${JSON.stringify([...new Set(actions)])}`);
  }
  const restore = trail().find((e) => e.action.startsWith('Restored version'));
  assert.equal(restore.actor, 'Hana HR');
  assert.equal(restore.kind, 'document');
  const details = trail().find((e) => e.action === 'Changed the details of a form');
  assert.match(details.detail, /form code “HR-F-012 Rev\. 4”/);
});

test('encrypted at rest: the bytes on disk are not the file, and db.json has no file content', () => {
  const files = [];
  for (const sub of fs.readdirSync(formsDir).filter((x) => /^[0-9a-f]{2}$/.test(x))) for (const f of fs.readdirSync(path.join(formsDir, sub))) files.push(fs.readFileSync(path.join(formsDir, sub, f)));
  assert.ok(files.length >= 5);
  for (const raw of files) {
    assert.equal(raw.subarray(0, 4).toString('latin1'), 'CDM1', 'Documents\' blob format');
    assert.equal(raw.indexOf('%PDF-'), -1);
    assert.equal(raw.indexOf('LEAVE-V1-TEXT'), -1);
    assert.equal(raw.indexOf('LEAVE-V2-TEXT'), -1);
  }
  assert.ok(!JSON.stringify(env.db.data).includes('LEAVE-V'), 'no file content in the data file');
  // A key of its own: Documents' key cannot open it.
  assert.ok(env.db.data.forms.every((f) => f.versions.every((v) => /^[0-9a-f]{32}$/.test(v.blobId) && /^[0-9a-f]{64}$/.test(v.sha256))));
});

test('the Settings center lists the size limit and the types, and restores the default', async () => {
  const cfg = await admin.get('/api/admin/config');
  const area = cfg.areas.find((a) => a.id === 'forms');
  assert.deepEqual([area.label, area.screen, area.resettable], ['Document circulation', '/admin#/system/forms', true]);
  const size = cfg.settings.find((s) => s.area === 'forms' && s.path === 'maxUploadMB');
  assert.deepEqual([size.label, size.value, size.default], ['Largest form file (MB)', 20, 20]);
  const types = cfg.settings.find((s) => s.area === 'forms' && s.path === 'families');
  assert.ok(types.value.includes('pdf') && types.value.includes('archive'));
  await admin.put('/api/forms/settings', { maxUploadMB: 35, families: ['pdf', 'word'] });
  const changed = (await admin.get('/api/admin/config')).settings.find((s) => s.area === 'forms' && s.path === 'maxUploadMB');
  assert.equal(changed.changed, true);
  assert.ok((await admin.get('/api/admin/config/history?area=forms')).entries.length >= 1, 'saved on its screen: in the history');
  await admin.post('/api/admin/config/reset', { area: 'forms' });
  assert.deepEqual((await admin.get('/api/forms/settings')).maxUploadMB, 20);
  assert.equal((await admin.get('/api/forms/settings')).families.length, 8);
});

test('Tools: Document circulation beside PDF Studio for the people who keep forms only', async () => {
  for (const who of ['rita', 'hana', 'alma']) {
    assert.ok((await P[who].get('/api/hub/status')).tools.some((t) => t.id === 'forms'), `${who} sees the Tools entry on the home page`);
    assert.ok((await P[who].get('/api/tools/auth/status')).tools.some((t) => t.id === 'forms' && t.path === '/tools/#/system/forms'), `${who} in the Tools app`);
    assert.ok((await P[who].get('/api/hub/status')).user.manageForms.length);
  }
  assert.ok((await admin.get('/api/hub/status')).tools.some((t) => t.id === 'forms'));
  for (const who of ['tess', 'sam', 'gina', 'lito']) {
    const st = await P[who].get('/api/hub/status');
    assert.ok(!st.tools.some((t) => t.id === 'forms'), `${who} does not see it`);
    assert.deepEqual(st.user.manageForms, []);
    assert.ok(!(await P[who].get('/api/tools/auth/status')).tools.some((t) => t.id === 'forms'));
  }
  assert.ok((await P.tess.get('/api/hub/status')).tools.some((t) => t.id === 'pdf'), 'PDF Studio stays as it was');
  // The entry is not a switch per account type: Home page & systems → Tools still lists PDF Studio only.
  assert.deepEqual((await admin.get('/api/admin/tools')).tools.map((t) => t.id), ['pdf']);
});

test('demo forms: generated PDFs, one with three versions by different demo uploaders; removed with the demo', async () => {
  const env2 = setup();
  const a = env2.client();
  await a.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await a.post('/api/admin/demo', {});
  const demo = env2.db.data.forms;
  assert.ok(demo.length >= 8 && demo.every((f) => f.demo));
  for (const id of ['home', 'uis', 'lms', 'hris', 'fmis']) assert.ok(demo.some((f) => f.module === id), id);
  const three = demo.find((f) => f.versions.length === 3 && new Set(f.versions.map((v) => v.by)).size === 3);
  assert.ok(three, 'a form with three versions by three demo uploaders');
  assert.ok(three.versions.every((v) => env2.db.data.users.find((u) => u.id === v.by)?.demo));
  assert.ok(demo.some((f) => f.public) && demo.some((f) => f.status === 'draft') && demo.some((f) => f.status === 'retired'));
  const file = (await a.get(`/api/forms/manage/${three.id}/versions/1/file`)).raw;
  assert.match(file.toString('latin1'), /^%PDF-/);
  assert.match(file.toString('latin1'), /DEMO FORM/);
  assert.ok(!demo.some((f) => f.module === 'dms'));
  const blob = demo[0].versions[0].blobId;
  await a.del('/api/admin/demo');
  assert.deepEqual(env2.db.data.forms, []);
  assert.ok(!env2.api.forms.blobs.exists(blob));
  fs.rmSync(env2.api.forms.dir, { recursive: true, force: true });
  fs.rmSync(env2.api.documents.dir, { recursive: true, force: true });
});

// ----- Crafted files for the checks below (built here, with Node's zlib) -----
// A ZIP. Each entry: name, data, deflate, localName (the local header's own name), size (the size it
// states), method, flags.
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '');
    const packed = e.deflate ? deflateRawSync(data) : data;
    const method = e.method ?? (e.deflate ? 8 : 0);
    const cn = Buffer.from(e.name);
    const ln = Buffer.from(e.localName ?? e.name);
    const size = e.size ?? data.length;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(e.flags || 0, 6); h.writeUInt16LE(method, 8);
    h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(size, 22); h.writeUInt16LE(ln.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(e.flags || 0, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(cn.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, ln, packed);
    central.push(c, cn);
    offset += 30 + ln.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const WORD_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const contentTypes = (overrides = [], pad = '') => `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${WORD_MAIN}"/>${overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>${pad}`;
// A Word package: [Content_Types].xml (overrides, padding, how it is stored: ct) and more parts.
const docx = (parts = [], { overrides = [], pad = '', ct = {} } = {}) => zip([{ name: '[Content_Types].xml', data: contentTypes(overrides, pad), ...ct }, { name: 'word/document.xml', data: '<w:document/>' }, ...parts]);
// Excel 97–2003 (BIFF8 records in a Workbook stream): BOF, FILEPASS when encrypted, a BOUNDSHEET per
// sheet with its type (0 worksheet, 1 Excel 4.0 macro sheet, 6 VBA module), EOF.
const record = (type, body = Buffer.alloc(0)) => Buffer.concat([Buffer.from([type & 0xff, type >> 8, body.length & 0xff, body.length >> 8]), body]);
function xls({ sheets = [0], encrypted = false } = {}) {
  const bof = Buffer.alloc(16);
  bof.writeUInt16LE(0x0600, 0);
  bof.writeUInt16LE(0x0005, 2);
  const sheet = (dt, i) => record(0x0085, Buffer.concat([Buffer.alloc(4), Buffer.from([0, dt, 6, 0]), Buffer.from(`Sheet${i + 1}`, 'latin1')]));
  return writeCfb({ Workbook: Buffer.concat([record(0x0809, bof), ...(encrypted ? [record(0x002f, Buffer.alloc(54, 1))] : []), ...sheets.map(sheet), record(0x000a), Buffer.alloc(4096)]) });
}
// Word 97–2003: the file header (FIB) at the start of WordDocument; 0x0100 at 0x0A: encrypted.
function doc({ encrypted = false } = {}) {
  const fib = Buffer.alloc(1024);
  fib.writeUInt16LE(0xa5ec, 0);
  fib.writeUInt16LE(encrypted ? 0x0100 : 0, 0x0a);
  return writeCfb({ WordDocument: fib, '1Table': Buffer.alloc(64) });
}
const pdfWith = (body) => Buffer.from(`%PDF-1.7\n${body}\ntrailer<</Root 1 0 R>>\n%%EOF\n`, 'latin1');
const ALL = FAMILIES.map((f) => f.id);
const refused = (buf, name, re) => {
  const r = checkFile(buf, name, ALL);
  assert.equal(r.ok, false, `${name} was accepted`);
  if (re) assert.match(r.reason, re, name);
};
const accepted = (buf, name) => {
  const r = checkFile(buf, name, ALL);
  assert.ok(r.ok, `${name}: ${r.reason}`);
  return r;
};
const NEW_FORM = { title: 'Checked file', module: 'home', audience: ['student'] };

test('Office macros: found by part name and by content type; a [Content_Types].xml that cannot be read whole is refused; Excel 4.0 macro sheets', async () => {
  accepted(docx(), 'plain.docx');
  // [Content_Types].xml too large, unpacking past the size it states, or in a compression not read:
  // never taken as empty.
  refused(docx([], { pad: ' '.repeat(1100 * 1024), ct: { deflate: true } }), 'big-types.docx', /could not be checked/);
  refused(docx([], { pad: ' '.repeat(300 * 1024), ct: { deflate: true, size: 500 } }), 'lying-types.docx', /could not be checked/);
  refused(docx([], { ct: { method: 12 } }), 'bzip2-types.docx', /could not be checked/);
  // A VBA project under another name: its content type gives it away.
  refused(docx([{ name: 'word/media/data.dat', data: 'x' }], { overrides: [['/word/media/data.dat', 'application/vnd.ms-office.vbaProject']] }), 'renamed.docx', /macros/);
  refused(docx([{ name: 'word/media/c.xml', data: '<x/>' }], { overrides: [['/word/media/c.xml', 'application/vnd.ms-office.activeX+xml']] }), 'control.docx', /macros/);
  // By name, whatever [Content_Types].xml says.
  for (const part of ['word/vbaProject.bin', 'word/vbaData.xml', 'word/vbaData.bin', 'word/activeX/activeX1.xml', 'xl/macrosheets/sheet1.xml', 'xl/intl-macrosheets/sheet1.xml', 'ppt/x.bin', 'Word/VBAPROJECT.BIN']) {
    refused(docx([{ name: part, data: '<x/>' }]), 'parts.docx', /macros/);
  }
  // An Excel 4.0 macro sheet in a .xlsx, found by its content type.
  const xlsxTypes = '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/other/m.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/></Types>';
  refused(zip([{ name: '[Content_Types].xml', data: xlsxTypes }, { name: 'xl/workbook.xml', data: '<workbook/>' }, { name: 'xl/other/m.xml', data: '<xm:macrosheet/>' }]), 'xlm.xlsx', /macros/);
  // A VBA project kept as an embedded object (a compound file with a VBA storage).
  refused(docx([{ name: 'word/embeddings/oleObject1.bin', data: writeCfb({ 'VBA/dir': Buffer.alloc(64, 1), PROJECT: Buffer.from('ID="{0}"') }) }]), 'ole.docx', /macros/);
  // Excel 97–2003: a macro sheet or a VBA module sheet is refused, an ordinary workbook is not.
  assert.equal(accepted(xls(), 'book.xls').ext, 'xls');
  refused(xls({ sheets: [0, 1] }), 'xlm.xls', /macros/);
  refused(xls({ sheets: [6] }), 'module.xls', /macros/);
  // A compound file that cannot be read is not taken for a workbook.
  refused(Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(504), Buffer.from('Workbook', 'utf16le')]), 'fake.xls', /damaged/);
  // Through Document circulation: refused with the reason, and recorded.
  await fails(upload(admin, 'xlm.xls', xls({ sheets: [1] }), NEW_FORM), 400, /macros/);
  await fails(upload(admin, 'big-types.docx', docx([], { pad: ' '.repeat(1100 * 1024), ct: { deflate: true } }), NEW_FORM), 400, /could not be checked/);
  assert.ok(trail().some((e) => e.action === 'Upload refused' && /xlm\.xls/.test(e.detail)));
});

test('ZIP contents: archives inside archives, names as Windows saves them, more kinds of program, names that disagree, programs inside Office files', async () => {
  const exe = { name: 'evil.exe', data: 'MZ' };
  const nest = (inner, levels) => {
    let z = inner;
    for (let i = 0; i < levels; i++) z = zip([{ name: `level${i + 1}.zip`, data: z, deflate: i % 2 === 0 }]);
    return z;
  };
  refused(nest(zip([exe]), 1), 'nested.zip', /evil\.exe/);
  refused(nest(zip([{ name: 'a.txt', data: 'hello' }, { name: 'tool.dat', data: 'MZ\x90\x00' }]), 2), 'nested2.zip', /program/);
  assert.equal(accepted(nest(zip([{ name: 'a.txt', data: 'hello' }]), ZIP_MAX_DEPTH), 'deep.zip').ext, 'zip');
  refused(nest(zip([{ name: 'a.txt', data: 'hello' }]), ZIP_MAX_DEPTH + 1), 'deeper.zip', /more than 3 deep/);
  // Names: trailing dots and spaces, letter case, stream suffixes, direction characters.
  const rlo = String.fromCharCode(0x202e);
  assert.deepEqual(entryExts('a/evil.exe. . '), ['exe']);
  assert.deepEqual(entryExts('a.txt:evil.exe'), ['txt', 'exe']);
  for (const name of ['evil.exe.', 'evil.exe ', 'EVIL.EXE', 'evil.exe. . ', 'evil.exe::$DATA', `report${rlo}fdp.exe`, 'sub\\run.bat']) refused(zip([{ name, data: 'x' }]), 'names.zip', /never accepted/);
  // Programs and scripts beyond the old list, each on its own.
  for (const ext of ['pif', 'xll', 'msix', 'appx', 'vhdx', 'one', 'mht', 'iqy', 'slk', 'library-ms', 'xlsb', 'jnlp', 'appref-ms', 'settingcontent-ms', 'ps1xml', 'wsc', 'sct', 'xbap', 'application', 'gadget', 'msc', 'ade', 'mde', 'accde', 'scf', 'inf', 'lnk', 'reg', 'hta', 'cpl', 'iso', 'img']) {
    refused(zip([{ name: `x.${ext}`, data: 'x' }]), `${ext}.zip`, /never accepted/);
  }
  // Archives that cannot be looked into; a compression that cannot be read.
  for (const ext of ['7z', 'rar', 'cab', 'tar', 'gz']) refused(zip([{ name: `x.${ext}`, data: 'x' }]), `${ext}.zip`, /cannot be checked/);
  refused(zip([{ name: 'a.txt', data: 'x', method: 14 }]), 'lzma.zip', /compression/);
  // The local header names another file than the central directory; the same name twice.
  refused(zip([{ name: 'a.txt', localName: 'evil.exe', data: 'MZ' }]), 'mismatch.zip', /do not agree/);
  refused(zip([{ name: 'a.txt', data: 'x' }, { name: 'A.TXT', data: 'y' }]), 'twice.zip', /same name/);
  // The size limits stay: far more data than it holds, too many files.
  refused(zip([{ name: 'big.dat', data: 'x', size: 0x7ffffff0 }]), 'bomb.zip', /far more data/);
  refused(zip(Array.from({ length: 20001 }, (_, i) => ({ name: `f${i}.txt`, data: '' }))), 'many.zip', /damaged/);
  // Programs and scripts inside an Office file; the pictures it shows itself (SVG) and embedded
  // workbooks are fine.
  refused(docx([{ name: 'word/embeddings/evil.exe', data: 'MZ' }]), 'exe.docx', /evil\.exe/);
  refused(docx([{ name: 'payload.hta', data: '<script>' }]), 'hta.docx', /payload\.hta/);
  refused(docx([{ name: 'word/media/image1.png', data: 'MZ\x90\x00' }]), 'disguised.docx', /program/);
  const packaged = Buffer.concat([Buffer.alloc(6), Buffer.from('invoice.exe\0C:\\Temp\\invoice.exe\0', 'latin1'), Buffer.from('MZ')]);
  refused(docx([{ name: 'word/embeddings/oleObject1.bin', data: writeCfb({ [`${String.fromCharCode(1)}Ole10Native`]: packaged }) }]), 'packaged.docx', /packaged/);
  const book = zip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'xl/workbook.xml', data: '<workbook/>' }]);
  assert.equal(accepted(docx([{ name: 'word/media/image1.svg', data: '<svg/>' }, { name: 'word/embeddings/Book1.xlsx', data: book, deflate: true }]), 'icons.docx').ext, 'docx');
  // Through Document circulation (ZIP archives are on by default for forms).
  await fails(upload(admin, 'bundle.zip', nest(zip([exe]), 1), NEW_FORM), 400, /evil\.exe/);
  await fails(upload(admin, 'carrier.docx', docx([{ name: 'word/embeddings/evil.exe', data: 'MZ' }]), NEW_FORM), 400, /evil\.exe/);
  await fails(upload(admin, 'mismatch.zip', zip([{ name: 'a.txt', localName: 'evil.exe', data: 'MZ' }]), NEW_FORM), 400, /do not agree/);
});

test('PDF: it must start with %PDF-; encrypted PDFs and PDFs with JavaScript or automatic actions are refused; legacy Office encryption', async () => {
  // Markup before %PDF- is a web page, not a PDF; a byte-order mark before it is tolerated.
  refused(Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>\n%PDF-1.4\n%%EOF'), 'form.pdf', /web page/);
  refused(Buffer.from('Hello\n%PDF-1.4\n%%EOF'), 'note.pdf');
  refused(Buffer.concat([Buffer.alloc(12), V1]), 'far.pdf');
  assert.equal(accepted(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), V1]), 'bom.pdf').ext, 'pdf');
  // Encrypted; scripts and actions that run by themselves, however they are spelled.
  refused(pdfWith('1 0 obj<</Filter/Standard/V 2/R 3/O(x)/U(y)/P -4>>endobj\ntrailer<</Encrypt 1 0 R>>'), 'enc.pdf', /encrypted/);
  refused(pdfWith('1 0 obj<</Type/Catalog/OpenAction<</S/JavaScript/JS(app.alert(1))>>>>endobj'), 'js.pdf', /JavaScript/);
  refused(pdfWith('1 0 obj<</Type/Catalog/OpenAction 2 0 R>>endobj 2 0 obj<</S /Launch /F (cmd.exe)>>endobj'), 'launch.pdf', /actions/);
  refused(pdfWith('1 0 obj<</Type/Page/AA<</O 3 0 R>>>>endobj'), 'aa.pdf', /actions/);
  refused(pdfWith('1 0 obj<</Type/Catalog/Names<</J#61vaScript 4 0 R>>>>endobj'), 'spelled.pdf', /JavaScript/);
  refused(pdfWith('1 0 obj<</S/Rendition/JS %note\n 5 %note\n 0 R>>endobj'), 'comment.pdf', /JavaScript/);
  // In a compressed object stream too.
  const objects = deflateSync(Buffer.from('5 0 <</S/JavaScript/JS(app.alert(1))>>'));
  refused(Buffer.concat([Buffer.from(`%PDF-1.7\n9 0 obj<</Type/ObjStm/N 1/First 4/Filter/FlateDecode/Length ${objects.length}>>stream\n`), objects, Buffer.from('\nendstream\nendobj\n%%EOF\n')]), 'objstm.pdf', /JavaScript/);
  // Words that only look like the keys are fine: a link to a page about JavaScript, opening at a page.
  accepted(pdfWith('1 0 obj<</Type/Catalog/OpenAction<</S/GoTo/D[3 0 R/Fit]>>>>endobj 2 0 obj<</Type/Annot/Subtype/Link/A<</S/URI/URI(https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/JS)>>>>endobj'), 'link.pdf');
  accepted(V1, 'demo.pdf');
  // Word and Excel 97–2003: their own encryption flags.
  refused(doc({ encrypted: true }), 'locked.doc', /password/);
  assert.equal(accepted(doc(), 'old.doc').ext, 'doc');
  refused(xls({ encrypted: true }), 'locked.xls', /password/);
  // Through Document circulation.
  await fails(upload(admin, 'enc.pdf', pdfWith('trailer<</Encrypt 1 0 R>>'), NEW_FORM), 400, /encrypted/);
  await fails(upload(admin, 'js.pdf', pdfWith('1 0 obj<</OpenAction<</S/JavaScript/JS(x())>>>>endobj'), NEW_FORM), 400, /JavaScript/);
  await fails(upload(admin, 'form.pdf', Buffer.from('<html><script>1</script></html>\n%PDF-1.4'), NEW_FORM), 400, /web page/);
});

test('downloads: how many run at once is capped per address or person and in all, answered 429 with Retry-After', async () => {
  const gate = createDownloadGate({ perKey: 2, maxCount: 3, maxBytes: 100 });
  const a1 = gate.enter({ ip: '198.51.100.1' }, 10);
  const a2 = gate.enter({ ip: '198.51.100.1' }, 10);
  assert.throws(() => gate.enter({ ip: '198.51.100.1' }, 10), (e) => e.status === 429 && e.headers['Retry-After'] === '10' && /downloading 2 files/.test(e.message));
  const b1 = gate.enter({ user: { id: 'u1' }, ip: '198.51.100.1' }, 10); // a person signed in counts on their own
  assert.throws(() => gate.enter({ ip: '198.51.100.2' }, 10), (e) => e.status === 429 && /Many files/.test(e.message)); // three in all
  a1();
  a1(); // given back once only
  const c1 = gate.enter({ ip: '198.51.100.2' }, 70);
  assert.throws(() => gate.enter({ ip: '198.51.100.3' }, 1), /Many files/);
  a2();
  assert.throws(() => gate.enter({ ip: '198.51.100.3' }, 30), /Many files/, 'past the bytes in all');
  b1();
  c1();
  assert.equal(gate.active.count, 0);
  const big = gate.enter({ ip: '198.51.100.4' }, 1000); // one download always goes through, however large
  assert.throws(() => gate.enter({ ip: '198.51.100.5' }, 1), /Many files/);
  big();
  // An IPv6 visitor counts by their /64; a place not given back is freed in the end; school networks get more.
  const v6 = [gate.enter({ ip: '2001:db8:1:2::1' }), gate.enter({ ip: '2001:db8:1:2::2' })];
  assert.throws(() => gate.enter({ ip: '2001:db8:1:2::3' }), (e) => e.status === 429);
  v6.forEach((give) => give());
  let t = 0;
  const timed = createDownloadGate({ perKey: 1, holdMs: 1000, now: () => t });
  timed.enter({ ip: '198.51.100.6' });
  assert.throws(() => timed.enter({ ip: '198.51.100.6' }), /downloading 1 files/);
  t = 1001;
  timed.enter({ ip: '198.51.100.6' });
  const campus = createDownloadGate({ perKey: 1, scaleFor: (ip) => (ip === '203.0.113.7' ? 3 : 1) });
  for (let i = 0; i < 3; i++) campus.enter({ ip: '203.0.113.7' });
  assert.throws(() => campus.enter({ ip: '203.0.113.7' }), (e) => e.status === 429);

  // Through the API: a public form, four downloads from one address not yet sent, the fifth waits.
  const pub = await upload(admin, 'Public form.pdf', V1, { title: 'Public form', module: 'home', audience: ['student'], public: true, status: 'published' });
  const get = (ip) => env.api({ method: 'GET', headers: {}, socket: { remoteAddress: ip } }, new URL(`http://localhost/api/public/forms/${pub.id}/file`), {});
  const held = [];
  for (let i = 0; i < 4; i++) held.push(await get('198.51.100.60'));
  assert.ok(held.every((r) => typeof r.release === 'function' && r.raw.equals(V1)));
  const busy = await get('198.51.100.60').catch((e) => e);
  assert.equal(busy.status, 429);
  assert.equal(busy.headers['Retry-After'], '10');
  const other = await get('198.51.100.61');
  assert.ok(other.raw.equals(V1), 'another address still downloads');
  other.release();
  held.pop().release();
  (await get('198.51.100.60')).release();
  held.forEach((r) => r.release());
});

test('a download the visitor stops reading is dropped after a while without progress', async () => {
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const port = await new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: p } = s.address();
      s.close(() => resolve(p));
    });
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-idle-'));
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_FILE: path.join(dir, 'db.json'), RATE_LIMITS: 'off', OPEN_BROWSER: '', SETUP_CODE: '', RESPONSE_IDLE_MS: '1000' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/healthz`)).ok) break;
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    const setupRes = await fetch(`${base}/api/admin/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ada Admin', username: 'admin', password: PW }) });
    assert.equal(setupRes.status, 200);
    const cookie = setupRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const call = async (method, p, body) => {
      const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
      const out = await r.json();
      assert.ok(r.ok, out.error);
      return out;
    };
    const big = Buffer.concat([V1.subarray(0, V1.length - 6), Buffer.alloc(19 * 1024 * 1024, 0x20), Buffer.from('\n%%EOF')]);
    const { id, chunkBytes } = await call('POST', '/api/forms/manage/uploads', { name: 'Big.pdf', size: big.length });
    for (let at = 0; at < big.length; at += chunkBytes) await call('PUT', `/api/forms/manage/uploads/${id}`, { offset: at, data: big.subarray(at, at + chunkBytes).toString('base64') });
    const form = await call('POST', `/api/forms/manage/uploads/${id}/finish`, { title: 'Big', module: 'home', audience: ['student'], public: true, status: 'published' });
    // A visitor asks for the file, then reads nothing for four seconds.
    const received = await new Promise((resolve) => {
      let n = 0;
      const s = net.connect(port, '127.0.0.1', () => {
        s.write(`GET /api/public/forms/${form.id}/file HTTP/1.1\r\nHost: localhost\r\n\r\n`);
        s.pause();
        setTimeout(() => s.resume(), 4000);
      });
      s.on('data', (d) => (n += d.length));
      s.on('error', () => {});
      s.on('close', () => resolve(n));
    });
    assert.ok(received > 0 && received < big.length, `the server stopped sending: ${received} of ${big.length} bytes`);
  } finally {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uploads: only an accepted piece keeps one alive; abandoned ones are dropped without waiting for a new upload; limits per person and in all answer 429', async () => {
  let now = new Date('2026-08-10T10:00:00').getTime();
  const e3 = setup({ clock: () => new Date(now) });
  const a = e3.client();
  await a.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const hash = hashPassword(PW);
  for (const [role, username, name] of [['registrar', 'rita', 'Rita Registrar'], ['hr', 'hana', 'Hana HR'], ['accountant', 'alma', 'Alma Accountant']]) {
    e3.db.data.users.push({ id: `u-${username}`, role, username, name, status: 'active', passwordHash: hash, mustChangePassword: false, campusIds: [], createdAt: '' });
  }
  const signIn = async (username) => {
    const c = e3.client();
    await c.post('/api/hub/login', { username, password: PW });
    return c;
  };
  const piece = (c, id, offset) => c.put(`/api/forms/manage/uploads/${id}`, { offset, data: V1.subarray(offset, offset + 1).toString('base64') });
  // Requests that send no accepted piece do not keep an upload: after five minutes it is gone.
  const idle = await a.post('/api/forms/manage/uploads', { name: 'x.pdf', size: V1.length });
  for (let i = 0; i < 3; i++) {
    now += 100 * 1000;
    await fails(a.put(`/api/forms/manage/uploads/${idle.id}`, { junk: true }), 400, /Send a piece/);
  }
  now += 100 * 1000; // 400 s since the upload started, 100 s since the last request
  await fails(piece(a, idle.id, 0), 404, /no longer on the server/);
  // Accepted pieces keep it, up to 30 minutes in all.
  const live = await a.post('/api/forms/manage/uploads', { name: 'y.pdf', size: V1.length });
  for (let i = 0; i < 7; i++) {
    now += 4 * 60000;
    assert.equal((await piece(a, live.id, i)).received, i + 1);
  }
  now += 3 * 60000;
  await fails(piece(a, live.id, 7), 404, /no longer on the server/);
  // Three at once per person, then 429.
  const three = [];
  for (let i = 0; i < 3; i++) three.push(await a.post('/api/forms/manage/uploads', { name: `${i}.pdf`, size: 1000 }));
  await fails(a.post('/api/forms/manage/uploads', { name: '4.pdf', size: 1000 }), 429, /3 files being uploaded/);
  for (const x of three) await a.del(`/api/forms/manage/uploads/${x.id}`);
  // One person's share of the memory: a 100 MB file, but not another beside it.
  await a.put('/api/forms/settings', { maxUploadMB: 100 });
  const MB = 1024 * 1024;
  await a.post('/api/forms/manage/uploads', { name: 'big.pdf', size: 100 * MB });
  await fails(a.post('/api/forms/manage/uploads', { name: 'more.pdf', size: 10 * MB }), 429, /as large as one person/);
  // In all: three people's 100 MB files fill the pool; a fourth person waits.
  const [rita, hana, alma] = [await signIn('rita'), await signIn('hana'), await signIn('alma')];
  await rita.post('/api/forms/manage/uploads', { name: 'r.pdf', size: 100 * MB });
  await hana.post('/api/forms/manage/uploads', { name: 'h.pdf', size: 100 * MB });
  await fails(alma.post('/api/forms/manage/uploads', { name: 'a.pdf', size: 21 * MB }), 429, /Many large files/);
  // The abandoned ones are freed by time alone: the next request finds room.
  now += 6 * 60000;
  assert.ok((await alma.post('/api/forms/manage/uploads', { name: 'a.pdf', size: 21 * MB })).id);
  // Started and cancelled uploads are in the audit log.
  const log = e3.api.audit.entries().filter((e) => e.system === 'forms').map((e) => e.action);
  assert.ok(log.includes('Upload started') && log.includes('Upload cancelled'));
  fs.rmSync(e3.api.forms.dir, { recursive: true, force: true });
  fs.rmSync(e3.api.documents.dir, { recursive: true, force: true });
});

test('restore checks the earlier version against today\'s file types and size limit', async () => {
  const f = await upload(admin, 'bundle.zip', zip([{ name: 'a.txt', data: 'hello' }]), { title: 'Bundle', module: 'home', audience: ['student'] });
  await upload(admin, 'bundle.pdf', V1, { formId: f.id });
  await admin.put('/api/forms/settings', { families: ['pdf'] });
  await fails(admin.post(`/api/forms/manage/${f.id}/restore`, { no: 1 }), 400, /^Version 1 cannot be restored: ZIP archives files are not accepted here/);
  assert.ok(trail().some((e) => e.action === 'Restore refused' && e.outcome === 'refused' && /bundle\.zip/.test(e.detail)));
  // The size limit too.
  await admin.put('/api/forms/settings', { families: ['pdf', 'archive'], maxUploadMB: 20 });
  const big = Buffer.concat([V1.subarray(0, V1.length - 6), Buffer.alloc(2 * 1024 * 1024, 0x20), Buffer.from('\n%%EOF')]);
  await upload(admin, 'big.pdf', big, { formId: f.id });
  await upload(admin, 'small.pdf', V1, { formId: f.id });
  await admin.put('/api/forms/settings', { maxUploadMB: 1 });
  await fails(admin.post(`/api/forms/manage/${f.id}/restore`, { no: 3 }), 400, /cannot be restored: big\.pdf is larger than 1 MB/);
  // Allowed again: restored as before.
  await admin.post('/api/admin/config/reset', { area: 'forms' });
  assert.equal((await admin.post(`/api/forms/manage/${f.id}/restore`, { no: 1 })).current.restoredFrom, 1);
});

test('a manager sees the categories of their own modules\' forms only', async () => {
  const hr = await P.hana.get('/api/forms/manage');
  const mine = [...new Set(env.db.data.forms.filter((f) => f.module === 'hris').map((f) => f.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(hr.categories, mine);
  assert.ok(!hr.categories.includes('Procurement'), 'not Finance\'s');
  assert.ok((await admin.get('/api/forms/manage')).categories.includes('Procurement'));
});

test('file names: filename* encoded as RFC 8187 asks; direction and control characters taken out', async () => {
  assert.match(contentDisposition('attachment', 'it\'s (draft) v2*.pdf'), /filename\*=UTF-8''it%27s%20%28draft%29%20v2%2A\.pdf$/);
  const rlo = String.fromCharCode(0x202e);
  assert.equal(cleanName(`invoice${rlo}fdp.exe.pdf`), 'invoicefdp.exe.pdf');
  assert.equal(cleanName(`a${String.fromCharCode(0x2066)}b${String.fromCharCode(0x85)}c.pdf`), 'ab c.pdf');
  assert.doesNotMatch(contentDisposition('attachment', `old${rlo}name.pdf`), /%E2%80%AE/, 'names kept before are cleaned on the way out');
  const f = await upload(admin, `it's (draft)${rlo} v2.pdf`, V1, { ...NEW_FORM, title: 'Quoted name' });
  assert.equal(f.current.name, 'it\'s (draft) v2.pdf');
  const file = await admin.get(`/api/forms/manage/${f.id}/versions/1/file`);
  assert.match(file.headers['Content-Disposition'], /^attachment; filename="it's \(draft\) v2\.pdf"; filename\*=UTF-8''it%27s%20%28draft%29%20v2\.pdf$/);
});

test('the audit log also has: a manager reaching for another module\'s form, refused deletes, users\' downloads, public downloads counted per form', async () => {
  const rfq = env.db.data.forms.find((f) => f.title === 'Request for quotation');
  await fails(P.hana.get(`/api/forms/manage/${rfq.id}/versions/1/file`), 404);
  await fails(P.hana.post(`/api/forms/manage/${rfq.id}/retire`, {}), 404);
  const probes = trail().filter((e) => e.action === 'Refused: a form of a module they do not keep');
  assert.ok(probes.length >= 2 && probes.every((e) => e.outcome === 'refused' && e.actor === 'Hana HR'));
  const job = env.db.data.forms.find((f) => f.title === 'Job application form');
  await fails(P.hana.del(`/api/forms/manage/${job.id}`), 400, /Retire this form instead/);
  assert.ok(trail().some((e) => e.action === 'Delete refused' && e.actor === 'Hana HR' && e.outcome === 'refused'));
  // A user's download.
  const leave = env.db.data.forms.find((f) => f.title === 'Application for leave');
  await P.tess.get(`/api/forms/${leave.id}/file`);
  assert.ok(trail().some((e) => e.action === 'Downloaded a form' && e.actor === 'Tess Teacher'));
  // Public downloads: counted, then one entry per form and hour (not one per download).
  env.api.forms.flushPublicDownloads(true);
  const before = trail().filter((e) => e.action === 'Downloaded by the public').length;
  const [v1, v2] = [env.client({ ip: '198.51.100.70' }), env.client({ ip: '198.51.100.71' })];
  for (const c of [v1, v1, v2]) await c.get(`/api/public/forms/${job.id}/file`);
  assert.equal(trail().filter((e) => e.action === 'Downloaded by the public').length, before);
  env.api.forms.flushPublicDownloads(true);
  const tally = trail().filter((e) => e.action === 'Downloaded by the public').at(-1);
  assert.match(tally.detail, /^3 downloads from 2 addresses since /);
});

test('the public forms limit is multiplied on a school network; X-Forwarded-For is believed from this computer only, its last entry', async () => {
  const from = (peer, xff) => clientIp({ socket: { remoteAddress: peer }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(from('192.0.2.10', '1.2.3.4'), '192.0.2.10');
  assert.equal(from('127.0.0.1', '1.1.1.1, 203.0.113.77'), '203.0.113.77');
  assert.equal(from('::ffff:127.0.0.1', '203.0.113.78'), '203.0.113.78');
  await admin.put('/api/admin/settings', { security: { schoolNetworks: [{ cidr: '203.0.113.0/24', label: 'Main Campus' }] } });
  const count = async (c) => {
    for (let i = 0; i < 80; i++) {
      try {
        await c.get('/api/public/forms');
      } catch (err) {
        assert.equal(err.status, 429);
        return i;
      }
    }
    return 80;
  };
  assert.equal(await count(env.client({ ip: '203.0.113.50' })), 80, 'a campus is many visitors at one address');
  assert.equal(await count(env.client({ ip: '198.51.100.90' })), 60);
  await admin.put('/api/admin/settings', { security: { schoolNetworks: [] } });
});
