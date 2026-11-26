// Applicants' documents (HRIS request PL-022, with PL-006 and PL-007 as settings): file types from the
// bytes (a renamed program, Office files with macros and password-protected ones refused), the size
// cap and its message, the count cap, the checklist's statuses and the bell, replacing files before
// the opening closes and not after (except a file HR asked for), who may open the files (HR, the
// opening's assessors; nobody else), completeness and "required documents before applying",
// encryption at rest, the purge with the account and the pool, and the upload body-size limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { setup } from './support.js';
import { demoPdf, demoDocx, storedZip } from '../server/demo.js';
import { MAX_BODY_SIGNED_IN, MAX_BODY_SIGNED_OUT, MAX_BODY_APPLICANT, MAX_ATTACH_PIECE_BODY } from '../server/api.js';
import { ATTACH_CHUNK_BYTES } from '../server/recruitment-docs.js';
import { DEFAULT_POLICY, DEFAULT_CHECKLISTS, sizeMessage, countMessage, completeness, itemStatus, mergeApplicantDocs } from '../shared/recruitment-docs.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;
const PDF = demoPdf('Transcript of records', ['A generated test file.']);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
const DOCX = demoDocx(['Personal Data Sheet']);
const ooxml = (main, types, extra = []) => storedZip([{ name: '[Content_Types].xml', data: `<Types><Override PartName="/${main}" ContentType="${types}"/></Types>` }, { name: main, data: '<w:document/>' }, ...extra]);
const MACRO_DOCX = ooxml('word/document.xml', 'application/vnd.ms-word.document.macroEnabled.main+xml');
const VBA_DOCX = ooxml('word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', [{ name: 'word/vbaProject.bin', data: 'x' }]);
const cfb = (names) => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504), ...names.map((n) => Buffer.from(n, 'utf16le'))]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(400, 1)]);
// A real PDF header, padded out to `mb` megabytes.
const bigPdf = (mb) => Buffer.concat([PDF, Buffer.alloc(Math.round(mb * 1024 * 1024) - PDF.length, 0x20)]);

async function school() {
  let now = Date.parse('2026-11-03T10:00:00');
  const env = setup({ clock: () => new Date(now), options: { rateLimits: 'off' } });
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const signIn = async (username, password = PW) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password });
    return c;
  };
  const staff = async (first, last, role, username) => {
    const e = await admin.post('/api/hris/employees', { firstName: first, lastName: last, gender: 'Female', hireDate: '2020-01-06', payType: 'monthly', rate: 26100, position: 'Clerk', department: 'Registrar' });
    await admin.post(`/api/hris/employees/${e.id}/account`, { role, username, password: PW, mustChangePassword: false });
  };
  await staff('Hana', 'Reyes', 'hr', 'hana');
  await staff('Ana', 'Lopez', 'staff', 'ana');
  await staff('Dan', 'Uy', 'staff', 'dan');
  await staff('Eli', 'Cruz', 'staff', 'eli');
  const hr = await signIn('hana');
  const opening = (extra = {}) => hr.post('/api/hris/recruitment/openings', {
    title: 'Instructor I', salaryGrade: 12, education: "Master's degree", vacancies: 1, closingDate: '2026-12-20', audience: 'all', status: 'open', categoryId: 'faculty', ...extra,
  });
  let n = 0;
  const signUp = async (name) => {
    const username = `app${++n}`;
    const c = env.client();
    await c.post('/api/jobs/signup', { name, email: `${username}@example.com`, username, password: 'longenough1', consent: true });
    await c.post('/api/hub/login', { username, password: 'longenough1' });
    return Object.assign(c, { username });
  };
  // Upload `buf` as `name` against a checklist item, in pieces, as the browser does.
  const upload = async (c, job, reqId, name, buf, { replace = null, size = buf.length } = {}) => {
    const base = `/api/hris/jobs/${job.id}/documents/uploads`;
    const up = await c.post(base, { reqId, name, size, ...(replace ? { replace } : {}) });
    for (let at = 0; at < buf.length; at += up.chunkBytes) await c.put(`${base}/${up.id}`, { offset: at, data: buf.subarray(at, at + up.chunkBytes).toString('base64') });
    return c.post(`${base}/${up.id}/finish`, {});
  };
  const docsOf = (c, job) => c.get(`/api/hris/jobs/${job.id}/documents`);
  const item = (v, id) => v.requirements.find((r) => r.id === id);
  const user = (username) => env.db.data.users.find((u) => u.username === username);
  return { env, admin, hr, signIn, opening, signUp, upload, docsOf, item, user, clock: { add: (ms) => (now += ms), set: (ms) => (now = ms) } };
}

test('the defaults: PDF, Word, Excel and pictures; 2 MB a file; 15 files; example checklists per position category', async () => {
  assert.deepEqual([DEFAULT_POLICY.types, DEFAULT_POLICY.maxMb, DEFAULT_POLICY.maxFiles], [['pdf', 'word', 'excel', 'image'], 2, 15]);
  assert.match(DEFAULT_POLICY.help, /split/);
  assert.deepEqual(Object.keys(DEFAULT_CHECKLISTS), ['faculty', 'non-teaching']);
  assert.deepEqual(mergeApplicantDocs().examples, ['faculty', 'non-teaching']);
  assert.equal(sizeMessage(3.4 * 1024 * 1024, 2), 'This file is 3.4 MB; the limit is 2 MB. Save it as PDF with a smaller size, scan at a lower resolution, or split it.');
  assert.equal(itemStatus([], null), 'missing');
  assert.equal(itemStatus([{}], null), 'uploaded');
  assert.equal(itemStatus([{}], { status: 'accepted' }), 'accepted');
  assert.equal(itemStatus([{}], { status: 'needs-new' }), 'needs-new');
  assert.deepEqual(completeness([{ id: 'a', name: 'A', required: true }, { id: 'b', name: 'B', required: false }], () => []), { required: 1, missing: 1, missingNames: ['A'], complete: false });
  // The opening copies its category's checklist; HR edits it there.
  const s = await school();
  const job = await s.opening();
  assert.deepEqual(job.requirements.map((r) => [r.id, r.required]), DEFAULT_CHECKLISTS.faculty.map((r) => [r.id, r.required]));
  const edited = await s.hr.put(`/api/hris/recruitment/openings/${job.id}`, { requirements: [...job.requirements, { name: 'Teaching portfolio', note: 'Syllabi you wrote.', required: false }], requireDocsBeforeApply: false });
  assert.deepEqual(edited.requirements.at(-1), { id: 'teaching-portfolio', name: 'Teaching portfolio', note: 'Syllabi you wrote.', required: false });
  await assert.rejects(s.hr.put(`/api/hris/recruitment/openings/${job.id}`, { requirements: [{ name: 'PDS' }, { name: 'pds' }] }), /twice/);
  await assert.rejects(s.hr.put(`/api/hris/recruitment/openings/${job.id}`, { requirements: [{ name: '' }] }), /needs a name/);
  // HR settings: the policy and the default checklists, within their ranges; the Settings center lists them.
  const set = await s.admin.get('/api/hris/recruitment/documents-settings');
  assert.deepEqual([set.maxMb, set.maxFiles, set.types.length], [2, 15, 4]);
  await assert.rejects(s.admin.put('/api/hris/recruitment/documents-settings', { maxMb: 11 }), /Largest file: 1 to 10 MB/);
  await assert.rejects(s.admin.put('/api/hris/recruitment/documents-settings', { maxFiles: 0 }), /1 to 50 files/);
  await assert.rejects(s.admin.put('/api/hris/recruitment/documents-settings', { types: [] }), /at least one file type/);
  await assert.rejects(s.admin.put('/api/hris/recruitment/documents-settings', { types: ['exe'] }), /not a file type/);
  await assert.rejects((await s.signIn('dan')).put('/api/hris/recruitment/documents-settings', { maxMb: 5 }), status(403));
  const saved = await s.admin.put('/api/hris/recruitment/documents-settings', { checklists: { faculty: [{ name: 'Personal Data Sheet', required: true }], 'non-teaching': DEFAULT_CHECKLISTS['non-teaching'] } });
  assert.deepEqual([saved.checklists.faculty.length, saved.examples], [1, ['non-teaching']], 'a changed list is no longer an example');
  const config = await s.admin.get('/api/admin/config');
  assert.deepEqual(config.settings.filter((x) => x.area === 'applicantDocs').map((x) => [x.path, x.changed]), [['types', false], ['maxMb', false], ['maxFiles', false], ['help', false], ['checklists', true]]);
});

test('type sniffing: the type comes from the bytes; a renamed program, macros and password-protected files are refused', async () => {
  const s = await school();
  const job = await s.opening();
  const carla = await s.signUp('Carla Mendiola');
  await s.upload(carla, job, 'pds', 'PDS.pdf', PDF);
  await s.upload(carla, job, 'tor', 'TOR.docx', DOCX);
  const v = await s.upload(carla, job, 'training', 'certificate.png', PNG);
  assert.deepEqual(v.requirements.filter((r) => r.files.length).map((r) => [r.id, r.files[0].ext, r.status]), [['pds', 'pdf', 'uploaded'], ['tor', 'docx', 'uploaded'], ['training', 'png', 'uploaded']]);
  // A program renamed .pdf: refused by its bytes, not its name.
  await assert.rejects(s.upload(carla, job, 'diploma', 'diploma.pdf', EXE), /The file is a program or a script, which is never accepted/);
  // Programs by name, before a byte is sent.
  await assert.rejects(carla.post(`/api/hris/jobs/${job.id}/documents/uploads`, { reqId: 'diploma', name: 'setup.exe', size: 10 }), /\.exe files are never accepted/);
  await assert.rejects(carla.post(`/api/hris/jobs/${job.id}/documents/uploads`, { reqId: 'diploma', name: 'cv.docm', size: 10 }), /never accepted/);
  // Office files with macros, and password-protected ones.
  await assert.rejects(s.upload(carla, job, 'diploma', 'diploma.docx', MACRO_DOCX), /contains macros, which are never accepted/);
  await assert.rejects(s.upload(carla, job, 'diploma', 'diploma.docx', VBA_DOCX), /contains macros/);
  await assert.rejects(s.upload(carla, job, 'diploma', 'old.doc', cfb(['WordDocument', '_VBA_PROJECT'])), /contains macros/);
  await assert.rejects(s.upload(carla, job, 'diploma', 'locked.docx', cfb(['EncryptedPackage'])), /protected with a password/);
  // A file whose name and bytes disagree; a web page; a kind not allowed.
  await assert.rejects(s.upload(carla, job, 'diploma', 'photo.png', PDF), /called \.png but it is a PDF file/);
  await assert.rejects(s.upload(carla, job, 'diploma', 'cv.txt', Buffer.from('<html><script>x</script>')), /Upload PDF, Word \(DOC, DOCX\), Excel \(XLS, XLSX\) or Pictures \(JPEG, PNG, GIF\) files only/);
  // With only PDF allowed (PL-006 as a setting), a picture is refused.
  await s.admin.put('/api/hris/recruitment/documents-settings', { types: ['pdf'] });
  await assert.rejects(s.upload(carla, job, 'diploma', 'diploma.png', PNG), /Upload PDF files only/);
  await assert.rejects(s.upload(carla, job, 'diploma', 'diploma', PNG), /Upload PDF files only/, 'no extension: the bytes decide');
  assert.equal((await s.docsOf(carla, job)).count, 3, 'nothing refused was kept');
});

test('the size cap (2 MB by default) and its message; the count cap (15 by default)', async () => {
  const s = await school();
  const job = await s.opening();
  const carla = await s.signUp('Carla Mendiola');
  // Refused when the upload starts (the size it declares) and again on the bytes that arrived.
  await assert.rejects(carla.post(`/api/hris/jobs/${job.id}/documents/uploads`, { reqId: 'pds', name: 'PDS.pdf', size: Math.round(3.4 * 1024 * 1024) }), (e) => e.message === 'This file is 3.4 MB; the limit is 2 MB. Save it as PDF with a smaller size, scan at a lower resolution, or split it.');
  await assert.rejects(s.upload(carla, job, 'pds', 'PDS.pdf', bigPdf(2.5), { size: 1000 }), /larger than it said it was/);
  // Exactly 2 MB is accepted; the setting raises it (1 to 10).
  const two = await s.upload(carla, job, 'pds', 'PDS.pdf', bigPdf(2));
  assert.equal(two.requirements[0].files[0].size, 2 * 1024 * 1024);
  await s.admin.put('/api/hris/recruitment/documents-settings', { maxMb: 5 });
  await s.upload(carla, job, 'tor', 'TOR.pdf', bigPdf(3.4));
  await s.admin.put('/api/hris/recruitment/documents-settings', { maxMb: 2 });
  // The count cap.
  await s.admin.put('/api/hris/recruitment/documents-settings', { maxFiles: 3 });
  await s.upload(carla, job, 'training', 'a.pdf', PDF);
  await assert.rejects(s.upload(carla, job, 'training', 'b.pdf', PDF), (e) => e.message === countMessage(3));
  assert.match(countMessage(3), /at most 3 files\. Remove one you no longer need, or combine pages into one PDF/);
  // Replacing a file does not count as one more.
  const v = await s.docsOf(carla, job);
  const old = s.item(v, 'training').files[0];
  const after = await s.upload(carla, job, 'training', 'a2.pdf', PDF, { replace: old.id });
  assert.deepEqual(s.item(after, 'training').files.map((f) => f.name), ['a2.pdf']);
  assert.equal(after.count, 3);
});

test('checklist statuses and the bell: uploaded, accepted, needs a new file (with HR\'s note), uploaded again', async () => {
  const s = await school();
  const job = await s.opening();
  const carla = await s.signUp('Carla Mendiola');
  let v = await s.docsOf(carla, job);
  assert.ok(v.requirements.every((r) => r.status === 'missing' && r.statusLabel === 'Not yet uploaded'));
  assert.deepEqual([v.completeness.complete, v.completeness.missing, v.policy.maxMb, v.policy.maxFiles], [false, 3, 2, 15]);
  await s.upload(carla, job, 'pds', 'PDS.pdf', PDF);
  await s.upload(carla, job, 'tor', 'TOR.pdf', PDF);
  const app = await carla.post(`/api/hris/jobs/${job.id}/apply`, { note: '' }); // incomplete: allowed by default
  // HR's list: complete / missing N required.
  let detail = await s.hr.get(`/api/hris/recruitment/openings/${job.id}`);
  assert.deepEqual([detail.applications[0].documents.complete, detail.applications[0].documents.missing, detail.applications[0].documents.toCheck], [false, 1, 2]);
  // HR accepts one and asks for a new file for the other.
  await s.hr.put(`/api/hris/recruitment/applications/${app.id}/documents/pds`, { status: 'accepted' });
  await assert.rejects(s.hr.put(`/api/hris/recruitment/applications/${app.id}/documents/tor`, { status: 'needs-new' }), /Write a note to the applicant/);
  await assert.rejects(s.hr.put(`/api/hris/recruitment/applications/${app.id}/documents/diploma`, { status: 'accepted' }), /has no file yet/);
  await s.hr.put(`/api/hris/recruitment/applications/${app.id}/documents/tor`, { status: 'needs-new', note: 'The scan is cut off: upload every page.' });
  v = await s.docsOf(carla, job);
  assert.deepEqual([s.item(v, 'pds').statusLabel, s.item(v, 'tor').statusLabel, s.item(v, 'tor').review.note, s.item(v, 'tor').review.from], ['Accepted', 'Needs a new file', 'The scan is cut off: upload every page.', 'HR office']);
  assert.doesNotMatch(JSON.stringify(v), /Hana/, 'the applicant never sees who in HR');
  const bell = (await carla.get('/api/me/notifications')).items;
  const asked = bell.find((x) => x.kind === 'job.document.needs-new');
  assert.ok(asked && /HR asks for a new file: Transcript of records/.test(asked.title) && /The scan is cut off/.test(asked.body) && asked.link === `/hris/#/jobs/mine/${app.id}`);
  assert.ok(bell.some((x) => x.kind === 'job.document.accepted' && /Personal Data Sheet/.test(x.title)));
  assert.equal(asked.actorId, null);
  // A needs-new item counts as missing until a new file comes.
  detail = await s.hr.get(`/api/hris/recruitment/openings/${job.id}`);
  assert.deepEqual([detail.applications[0].documents.missing, detail.applications[0].documents.needsNew], [2, 1]);
  // The new file: Uploaded again (for HR to check), and HR is told.
  v = await s.upload(carla, job, 'tor', 'TOR-full.pdf', PDF);
  assert.deepEqual([s.item(v, 'tor').status, s.item(v, 'tor').review], ['uploaded', null]);
  assert.ok((await s.hr.get('/api/me/notifications')).items.some((x) => x.kind === 'job.document' && /uploaded a new file for Transcript of records/.test(x.title)));
  // Audit.
  const log = s.env.api.audit.entries().filter((e) => e.targetId === app.id).map((e) => e.action);
  assert.deepEqual(log, ['Accepted a document of a job application', 'Asked for a new file for a job application', 'Uploaded a document to a job application']);
});

test('the applicant replaces or removes files before the opening closes, not after (except a file HR asked for)', async () => {
  const s = await school();
  const job = await s.opening({ closingDate: '2026-11-10' });
  const carla = await s.signUp('Carla Mendiola');
  let v = await s.upload(carla, job, 'pds', 'PDS.pdf', PDF);
  await s.upload(carla, job, 'tor', 'TOR.pdf', PDF);
  v = await s.upload(carla, job, 'training', 'cert.pdf', PDF);
  const app = await carla.post(`/api/hris/jobs/${job.id}/apply`, { note: '' });
  v = await s.upload(carla, job, 'pds', 'PDS-signed.pdf', PDF, { replace: s.item(v, 'pds').files[0].id });
  assert.deepEqual(s.item(v, 'pds').files.map((f) => f.name), ['PDS-signed.pdf']);
  v = await carla.del(`/api/hris/jobs/${job.id}/documents/files/${s.item(v, 'training').files[0].id}`);
  assert.equal(s.item(v, 'training').files.length, 0);
  await s.hr.put(`/api/hris/recruitment/applications/${app.id}/documents/tor`, { status: 'needs-new', note: 'Upload the signed copy.' });
  // After the closing date: nothing changes, except the item HR sent back.
  s.clock.set(Date.parse('2026-11-11T10:00:00'));
  v = await s.docsOf(carla, job);
  assert.deepEqual([v.open, v.canChange, s.item(v, 'pds').canUpload, s.item(v, 'tor').canUpload], [false, false, false, true]);
  assert.match(v.closedWhy, /closed, so its documents can no longer change/);
  await assert.rejects(s.upload(carla, job, 'pds', 'again.pdf', PDF, { replace: s.item(v, 'pds').files[0].id }), status(403));
  await assert.rejects(s.upload(carla, job, 'diploma', 'Diploma.pdf', PDF), status(403));
  await assert.rejects(carla.del(`/api/hris/jobs/${job.id}/documents/files/${s.item(v, 'pds').files[0].id}`), status(403));
  v = await s.upload(carla, job, 'tor', 'TOR-signed.pdf', PDF);
  assert.deepEqual(s.item(v, 'tor').files.map((f) => f.name), ['TOR.pdf', 'TOR-signed.pdf']);
  assert.ok(s.env.api.audit.entries().some((e) => e.targetId === app.id && /after the closing date, as HR asked/.test(e.detail)));
  // Once uploaded, that item is closed too.
  await assert.rejects(s.upload(carla, job, 'tor', 'third.pdf', PDF), status(403));
  // A decided application: nothing changes.
  s.clock.set(Date.parse('2026-11-05T10:00:00'));
  await s.hr.put(`/api/hris/recruitment/applications/${app.id}`, { stage: 'not-selected' });
  await assert.rejects(s.upload(carla, job, 'diploma', 'Diploma.pdf', PDF), /HR has decided on your application/);
});

test('who may open the files: the applicant, HR, the opening\'s assessors (read-only); anyone else gets 404 or 403', async () => {
  const s = await school();
  const job = await s.opening();
  const other = await s.opening({ title: 'Instructor II' });
  const carla = await s.signUp('Carla Mendiola');
  const bea = await s.signUp('Bea Ramos');
  const v = await s.upload(carla, job, 'pds', 'PDS Carla.pdf', PDF);
  const file = s.item(v, 'pds').files[0];
  // Before applying, HR does not see them.
  await assert.rejects(s.hr.get(`/api/hris/recruitment/documents/${file.id}`), status(404));
  const app = await carla.post(`/api/hris/jobs/${job.id}/apply`, { note: '' });
  await bea.post(`/api/hris/jobs/${job.id}/apply`, { note: '' });
  // The applicant downloads their own: an attachment, nosniff, never inline.
  const own = await carla.get(`/api/hris/jobs/${job.id}/documents/files/${file.id}`);
  assert.ok(Buffer.from(own.raw).equals(PDF));
  assert.match(own.headers['Content-Disposition'], /^attachment; filename="PDS Carla.pdf"/);
  assert.equal(own.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(own.headers['Content-Security-Policy'], /sandbox/);
  assert.equal(own.type, 'application/pdf');
  // Another applicant: 404, through either opening; and never HR's route.
  await assert.rejects(bea.get(`/api/hris/jobs/${job.id}/documents/files/${file.id}`), status(404));
  await assert.rejects(bea.get(`/api/hris/jobs/${other.id}/documents/files/${file.id}`), status(404));
  await assert.rejects(bea.get(`/api/hris/recruitment/documents/${file.id}`), status(403));
  await assert.rejects(bea.del(`/api/hris/jobs/${job.id}/documents/files/${file.id}`), status(404));
  await assert.rejects(bea.get(`/api/hris/recruitment/applications/${app.id}/documents`), status(403));
  // HR at the campus: the list and the file, logged.
  const list = await s.hr.get(`/api/hris/recruitment/applications/${app.id}/documents`);
  assert.deepEqual([list.readOnly, list.requirements[0].files[0].name, list.summary.missing], [false, 'PDS Carla.pdf', 2]);
  const got = await s.hr.get(`/api/hris/recruitment/documents/${file.id}`);
  assert.ok(Buffer.from(got.raw).equals(PDF));
  assert.match(got.headers['Content-Disposition'], /^attachment;/);
  assert.ok(s.env.api.audit.entries().some((e) => e.action === 'Downloaded a document of a job application' && e.actor === 'Hana Reyes'));
  // Staff not on the panel: refused. Named on the panel: read-only.
  const ana = await s.signIn('ana');
  await assert.rejects(ana.get(`/api/hris/recruitment/documents/${file.id}`), status(403));
  await s.hr.put(`/api/hris/recruitment/openings/${job.id}/panel`, { assessors: [{ userId: s.user('ana').id }] });
  const ro = await ana.get(`/api/hris/recruitment/applications/${app.id}/documents`);
  assert.equal(ro.readOnly, true);
  assert.ok(Buffer.from((await ana.get(`/api/hris/recruitment/documents/${file.id}`)).raw).equals(PDF));
  await assert.rejects(ana.put(`/api/hris/recruitment/applications/${app.id}/documents/pds`, { status: 'accepted' }), status(403));
  assert.ok(s.env.api.audit.entries().some((e) => e.action === 'Downloaded a document of a job application (assessor)' && e.actor === 'Ana Lopez'));
  // An assessor of another opening only: refused.
  await s.hr.put(`/api/hris/recruitment/openings/${job.id}/panel`, { assessors: [] });
  await s.hr.put(`/api/hris/recruitment/openings/${other.id}/panel`, { assessors: [{ userId: s.user('ana').id }] });
  await assert.rejects(ana.get(`/api/hris/recruitment/documents/${file.id}`), status(403));
  // Signed out: no file, and no public link.
  await assert.rejects(s.env.client().get(`/api/hris/recruitment/documents/${file.id}`), status(401));
  await assert.rejects(s.env.client().get(`/api/hris/jobs/${job.id}/documents/files/${file.id}`), status(401));
  // The applicant profile lists the documents.
  const prof = await s.hr.get(`/api/hris/recruitment/profiles/${s.user(carla.username).id}`);
  assert.deepEqual(prof.applications[0].documents.find((d) => d.id === 'pds').files.map((f) => f.name), ['PDS Carla.pdf']);
});

test('completeness, and "required documents must be uploaded before applying" (off by default)', async () => {
  const s = await school();
  const job = await s.opening({ requireDocsBeforeApply: true });
  assert.equal(job.requireDocsBeforeApply, true);
  const carla = await s.signUp('Carla Mendiola');
  const v = await s.docsOf(carla, job);
  assert.equal(v.requireBeforeApply, true);
  await assert.rejects(carla.post(`/api/hris/jobs/${job.id}/apply`, { note: '' }), (e) => e.status === 409 && e.message === 'Upload these required documents before applying: Personal Data Sheet (CS Form 212), Transcript of records, Diploma.');
  await s.upload(carla, job, 'pds', 'PDS.pdf', PDF);
  await s.upload(carla, job, 'tor', 'TOR.pdf', PDF);
  await assert.rejects(carla.post(`/api/hris/jobs/${job.id}/apply`, { note: '' }), /before applying: Diploma\./);
  const done = await s.upload(carla, job, 'diploma', 'Diploma.pdf', PDF);
  assert.deepEqual([done.completeness.complete, done.completeness.missing], [true, 0]);
  const app = await carla.post(`/api/hris/jobs/${job.id}/apply`, { note: '' });
  assert.equal(app.status, 'in-progress');
  const detail = await s.hr.get(`/api/hris/recruitment/openings/${job.id}`);
  assert.deepEqual([detail.applications[0].documents.complete, detail.requireDocsBeforeApply], [true, true]);
  // Off by default; internal applicants follow the same rules.
  const free = await s.opening({ title: 'Instructor II', audience: 'internal' });
  assert.equal(free.requireDocsBeforeApply, false);
  const eli = await s.signIn('eli');
  const ev = await s.upload(eli, free, 'pds', 'PDS.pdf', PDF);
  assert.equal(ev.requirements[0].status, 'uploaded');
  assert.equal((await eli.post(`/api/hris/jobs/${free.id}/apply`, { note: '' })).internal, true);
});

test('encryption at rest: the bytes on disk are not the file, and db.json holds no file', async () => {
  const s = await school();
  const job = await s.opening();
  const carla = await s.signUp('Carla Mendiola');
  const secret = demoPdf('Transcript', ['UNIQUE-MARKER-7731 grade 1.25']);
  await s.upload(carla, job, 'tor', 'TOR.pdf', secret);
  const rec = s.env.db.data.jobDocuments[0];
  const { dir } = s.env.api.recruitment.docs;
  const onDisk = fs.readFileSync(path.join(dir, rec.blobId.slice(0, 2), rec.blobId));
  assert.equal(onDisk.subarray(0, 4).toString(), 'CDM1');
  assert.equal(onDisk.indexOf(Buffer.from('UNIQUE-MARKER-7731')), -1);
  assert.equal(onDisk.indexOf(Buffer.from('%PDF')), -1);
  assert.ok(!JSON.stringify(s.env.db.data).includes('UNIQUE-MARKER-7731'));
  assert.ok(!JSON.stringify(s.env.db.data).includes(secret.toString('base64').slice(0, 40)));
  assert.deepEqual(Object.keys(rec).sort(), ['at', 'blobId', 'ext', 'id', 'mime', 'name', 'openingId', 'reqId', 'sha256', 'size', 'userId']);
  // Changed on disk: refused, not served.
  onDisk[onDisk.length - 1] ^= 0xff;
  fs.writeFileSync(path.join(dir, rec.blobId.slice(0, 2), rec.blobId), onDisk);
  await assert.rejects(carla.get(`/api/hris/jobs/${job.id}/documents/files/${rec.id}`), status(410));
});

test('the purge: files go with the applicant account; Selected applicants keep theirs; the pool keeps no files', async () => {
  const s = await school();
  const job = await s.opening();
  const carla = await s.signUp('Carla Mendiola');
  const bea = await s.signUp('Bea Ramos');
  await s.upload(carla, job, 'pds', 'PDS.pdf', PDF);
  await s.upload(bea, job, 'pds', 'PDS.pdf', PDF);
  const a = await carla.post(`/api/hris/jobs/${job.id}/apply`, { note: '' });
  const b = await bea.post(`/api/hris/jobs/${job.id}/apply`, { note: '' });
  const ids = { [carla.username]: s.user(carla.username).id, [bea.username]: s.user(bea.username).id };
  const blobOf = (u) => s.env.db.data.jobDocuments.filter((d) => d.userId === ids[u]);
  const { dir } = s.env.api.recruitment.docs;
  const exists = (d) => fs.existsSync(path.join(dir, d.blobId.slice(0, 2), d.blobId));
  const carlaFiles = blobOf(carla.username);
  assert.ok(carlaFiles.every(exists));
  // Bea is selected; Carla is not. The accounts close and the sweep removes Carla's 30 days later.
  await s.hr.put(`/api/hris/recruitment/applications/${b.id}`, { stage: 'selected' });
  await s.hr.put(`/api/hris/recruitment/applications/${a.id}`, { stage: 'not-selected' });
  s.clock.add((365 + 31) * 86400000);
  s.env.api.recruitment.sweep();
  assert.equal(blobOf(carla.username).length, 0, 'Carla\'s account was removed, and her files');
  assert.ok(carlaFiles.every((d) => !exists(d)), 'deleted from disk');
  assert.equal(s.env.db.data.jobDocuments.filter((d) => d.openingId === job.id).length, 1, 'Bea (Selected) keeps hers, as she keeps her account');
  // HR removing an account removes its files.
  await s.hr.del(`/api/hris/recruitment/applicants/${ids[bea.username]}`);
  assert.equal(s.env.db.data.jobDocuments.length, 0);
});

test('the pool keeps no files: leaving it deletes the files of applications that ended; unapplied uploads go when the opening closes', async () => {
  const s = await school();
  const job = await s.opening({ audience: 'internal', closingDate: '2026-11-20' });
  const eli = await s.signIn('eli');
  await eli.put('/api/hris/my-pool', { optIn: true });
  await s.upload(eli, job, 'pds', 'PDS.pdf', PDF);
  const app = await eli.post(`/api/hris/jobs/${job.id}/apply`, { note: '' });
  await s.hr.put(`/api/hris/recruitment/applications/${app.id}`, { stage: 'not-selected' });
  assert.equal((await eli.get('/api/hris/my-pool')).inPool, true);
  assert.equal(s.env.db.data.jobDocuments.length, 1, 'kept while in the pool');
  await eli.put('/api/hris/my-pool', { optIn: false });
  assert.equal(s.env.db.data.jobDocuments.length, 0, 'gone when they leave it');
  // Uploaded for an opening never applied to: removed once it stops taking applications.
  const other = await s.opening({ title: 'Instructor II', audience: 'internal', closingDate: '2026-11-20' });
  await s.upload(eli, other, 'pds', 'PDS.pdf', PDF);
  s.env.api.recruitment.sweep();
  assert.equal(s.env.db.data.jobDocuments.length, 1);
  s.clock.add(30 * 86400000);
  s.env.api.recruitment.sweep();
  assert.equal(s.env.db.data.jobDocuments.length, 0);
  // Deleting an opening without applications deletes its files.
  const third = await s.opening({ title: 'Instructor III' });
  const carla = await s.signUp('Carla Mendiola');
  await s.upload(carla, third, 'pds', 'PDS.pdf', PDF);
  await s.hr.del(`/api/hris/recruitment/openings/${third.id}`);
  assert.equal(s.env.db.data.jobDocuments.length, 0);
});

test('upload body-size limits: pieces of 1 MB for someone signed in; a job applicant sends nothing else large', async () => {
  const s = await school();
  const job = await s.opening();
  await s.signUp('Carla Mendiola');
  const cookieOf = async (username, password) => {
    const res = await s.env.api({ method: 'POST', headers: {} }, new URL('http://localhost/api/hub/login'), { username, password });
    return [res.headers['Set-Cookie']].flat().map((c) => c.split(';')[0]).join('; ');
  };
  const limit = (method, url, cookie = '') => s.env.api.prepare({ method, url, headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } }).maxBody;
  const piece = `/api/hris/jobs/${job.id}/documents/uploads/abc`;
  const applicant = await cookieOf('app1', 'longenough1');
  const staff = await cookieOf('ana', PW);
  assert.equal(MAX_ATTACH_PIECE_BODY, Math.ceil(ATTACH_CHUNK_BYTES / 3) * 4 + 16 * 1024);
  assert.ok(MAX_ATTACH_PIECE_BODY > MAX_BODY_APPLICANT && MAX_BODY_APPLICANT > MAX_BODY_SIGNED_OUT);
  assert.equal(limit('PUT', piece), MAX_BODY_SIGNED_OUT, 'signed out: the small limit');
  assert.equal(limit('PUT', piece, applicant), MAX_ATTACH_PIECE_BODY, 'a signed-in applicant: a piece');
  assert.equal(limit('PUT', piece, staff), MAX_ATTACH_PIECE_BODY);
  assert.equal(limit('POST', `/api/hris/jobs/${job.id}/apply`, applicant), MAX_BODY_APPLICANT, 'anything else from an applicant: small');
  assert.equal(limit('PUT', '/api/hris/my-pool', applicant), MAX_BODY_APPLICANT);
  assert.equal(limit('POST', '/api/hris/employees', staff), MAX_BODY_SIGNED_IN, 'staff as before');
  // A piece larger than 1 MB is refused by the route too.
  const carla = await s.signIn('app1', 'longenough1');
  const up = await carla.post(`/api/hris/jobs/${job.id}/documents/uploads`, { reqId: 'pds', name: 'PDS.pdf', size: 2 * 1024 * 1024 });
  await assert.rejects(carla.put(`/api/hris/jobs/${job.id}/documents/uploads/${up.id}`, { offset: 0, data: Buffer.alloc(ATTACH_CHUNK_BYTES + 10).toString('base64') }), /pieces of up to 1 MB|too long/);
  // Someone else's upload is not theirs to add to.
  const bea = await s.signUp('Bea Ramos');
  await assert.rejects(bea.put(`/api/hris/jobs/${job.id}/documents/uploads/${up.id}`, { offset: 0, data: PDF.toString('base64') }), status(404));
});

test('demo documents: small generated PDFs, encrypted, marked demo, one accepted and one sent back', async () => {
  const s = await school();
  await s.admin.post('/api/admin/demo');
  const d = s.env.db.data;
  assert.ok(d.jobDocuments.length >= 6 && d.jobDocuments.every((x) => x.demo && x.ext === 'pdf'));
  const carla = await s.signIn('applicant.demo', 'demo1234');
  const mine = await carla.get('/api/hris/my-applications');
  const app = mine.applications.find((a) => a.title === 'Instructor I');
  const v = await carla.get(`/api/hris/jobs/${app.openingId}/documents`);
  assert.deepEqual([s.item(v, 'pds').status, s.item(v, 'tor').status], ['accepted', 'needs-new']);
  const f = await carla.get(`/api/hris/jobs/${app.openingId}/documents/files/${s.item(v, 'pds').files[0].id}`);
  assert.match(Buffer.from(f.raw).toString('latin1'), /^%PDF/);
  assert.match(Buffer.from(f.raw).toString('latin1'), /not a real document/);
  await s.admin.del('/api/admin/demo');
  assert.equal(s.env.db.data.jobDocuments.length, 0);
});
