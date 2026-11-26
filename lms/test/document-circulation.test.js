// Document circulation (server/forms.js, shared/forms.js): every module's downloadable forms in one
// place. Uploads and versions with who and when, restore as a new version, file types from the bytes
// and the size limit, who sees what on each system's Forms & downloads page, public forms signed out,
// managers limited to their modules, Documents left out, retire, earlier versions for managers only,
// the audit log, encryption at rest, the Settings center, and the entry beside PDF Studio in Tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup } from './support.js';
import { hashPassword } from '../server/auth.js';
import { demoPdf, demoDocx, storedZip } from '../server/demo.js';
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
