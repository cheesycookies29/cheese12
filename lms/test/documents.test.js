// ATLAS Documents: the engine (the same files as CORE's server/dms, and the same answers), file
// types from the bytes, encryption at rest, access with inheritance and 404 on denial, grants that
// never give more than the giver holds, what students may and may not do, parents kept out, links
// outside the school with passwords, limits, expiry and revoke, upload links, trash and legal hold,
// search in the files' words, Document control and the integrity check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setup } from './support.js';
import { hashPassword } from '../server/auth.js';
import { demoPdf, demoDocx, storedZip } from '../server/demo.js';
import { checkFile, sniff, cleanName, isInline, FAMILIES, DEFAULT_FAMILIES } from '../server/dms/types.js';
import { createBlobStore } from '../server/dms/blobs.js';
import { accessTo } from '../server/dms/access.js';
import { cleanSettings } from '../server/dms/policy.js';
import { newToken, tokenHash, hashLinkPassword, checkLinkPassword, unlockValue, checkUnlock } from '../server/dms/links.js';
import { extractText } from '../server/documents-text.js';
import { createSecrets } from '../server/secrets.js';

const LMS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = ['types.js', 'blobs.js', 'access.js', 'links.js', 'policy.js'];

const PDF = demoPdf('Quarterly report', ['Enrollment rose in Kalayaan campus.']);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0'), randomBytes(200), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
const DOCX = demoDocx(['Project proposal', 'Kalayaan learning hub for the barangay']);
const ooxml = (main, types = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', extra = []) => storedZip([
  { name: '[Content_Types].xml', data: `<Types><Override PartName="/${main}" ContentType="${types}"/></Types>` }, { name: main, data: '<w:document/>' }, ...extra,
]);
const cfb = (names) => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504), ...names.map((n) => Buffer.from(n, 'utf16le'))]);
// A ZIP entry that says it unpacks to almost 4 GB.
function bomb() {
  const z = storedZip([{ name: 'big.bin', data: 'x' }]);
  const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  z.writeUInt32LE(0xfffffff0, cd + 24);
  return z;
}

// The fixture set both engines must answer the same way: [name, bytes, families].
const FIXTURES = [
  ['scan.pdf', PDF], ['photo.JPG', JPEG], ['logo.png', PNG], ['proposal.docx', DOCX], ['data.csv', Buffer.from('a,b\n1,2\n')], ['notes', Buffer.from('hello')],
  ['invoice.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)])], ['notes.txt', Buffer.from('#!/bin/sh\nrm -rf /')], ['setup.exe', Buffer.from('anything')],
  ['page.txt', Buffer.from('<!DOCTYPE html><script>alert(1)</script>')], ['logo.txt', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
  ['memo.docx', ooxml('word/document.xml', 'application/vnd.ms-word.document.macroEnabled.main+xml')], ['memo2.docx', ooxml('word/document.xml', undefined, [{ name: 'word/vbaProject.bin', data: 'x' }])],
  ['bundle.zip', storedZip([{ name: 'payload/run.exe', data: 'MZ' }]), [...DEFAULT_FAMILIES, 'archive']], ['bomb.zip', bomb(), [...DEFAULT_FAMILIES, 'archive']],
  ['notes.zip', storedZip([{ name: 'a.txt', data: 'x' }])], ['photo.jpg', PDF], ['scan.jpg', JPEG, ['pdf']], ['old.doc', cfb(['WordDocument'])], ['old2.doc', cfb(['WordDocument', '_VBA_PROJECT'])],
  ['secret.docx', cfb(['EncryptedPackage'])], ['mail.eml', Buffer.from('From: a@b.c\nSubject: Hi\n\nHello')], ['sheet.xlsx', ooxml('xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')],
  ['../../etc/pa<ss>wd.txt', Buffer.from('x')], ['empty.pdf', Buffer.alloc(0)],
];
const answers = (check) => FIXTURES.map(([name, buf, fam]) => {
  const r = check(buf, name, fam);
  return r.ok ? [name, r.ext, r.family, r.name, r.mime] : [name, r.code, r.reason];
});
// What the engine answers today. A change to the engine (here or in CORE) that changes an answer
// fails this test: make the change in both copies and update this list on purpose.
const EXPECTED = [
  ['scan.pdf', 'pdf', 'pdf', 'scan.pdf', 'application/pdf'], ['photo.JPG', 'jpg', 'image', 'photo.JPG', 'image/jpeg'], ['logo.png', 'png', 'image', 'logo.png', 'image/png'],
  ['proposal.docx', 'docx', 'word', 'proposal.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['data.csv', 'csv', 'text', 'data.csv', 'text/csv'], ['notes', 'txt', 'text', 'notes.txt', 'text/plain'],
  ['invoice.pdf', 'content', 'The file is a program or a script, which is never accepted.'], ['notes.txt', 'content', 'The file is a program or a script, which is never accepted.'],
  ['setup.exe', 'blocked', '.exe files are never accepted (programs and scripts, web pages and svg, and office files with macros).'],
  ['page.txt', 'content', 'The file is a web page or SVG drawing, which can run code in a browser, so it is never accepted. Save it as PDF and upload that.'],
  ['logo.txt', 'content', 'The file is a web page or SVG drawing, which can run code in a browser, so it is never accepted. Save it as PDF and upload that.'],
  ['memo.docx', 'content', 'The file contains macros, which are never accepted. Save it without macros and upload it again.'],
  ['memo2.docx', 'content', 'The file contains macros, which are never accepted. Save it without macros (.docx, .xlsx, .pptx) and upload it again.'],
  ['bundle.zip', 'content', 'The ZIP file contains “run.exe”, a kind of file that is never accepted (programs, scripts and web pages).'],
  ['bomb.zip', 'content', 'The ZIP file unpacks to far more data than it holds, so it is refused.'],
  ['notes.zip', 'type', 'ZIP archives files are not accepted here. An administrator can allow them in Document control.'],
  ['photo.jpg', 'mismatch', 'The file is called .jpg but it is a PDF file. Check that it is the right file, and upload it with its real extension.'],
  ['scan.jpg', 'type', 'Pictures files are not accepted here. An administrator can allow them in Document control.'],
  ['old.doc', 'doc', 'legacy', 'old.doc', 'application/msword'],
  ['old2.doc', 'content', 'The file contains macros, which are never accepted. Save it without macros and upload it again.'],
  ['secret.docx', 'content', 'The file is protected with a password. Remove the password and upload it again.'],
  ['mail.eml', 'eml', 'email', 'mail.eml', 'message/rfc822'], ['sheet.xlsx', 'xlsx', 'excel', 'sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['../../etc/pa<ss>wd.txt', 'txt', 'text', 'pa ss wd.txt', 'text/plain'], ['empty.pdf', 'content', 'The file is empty.'],
];

test('the engine is CORE\'s: the same files, and the same answers for the same files', async () => {
  const core = path.join(LMS, '..', 'server', 'dms');
  if (fs.existsSync(core)) {
    for (const f of ENGINE) {
      const ours = fs.readFileSync(path.join(LMS, 'server', 'dms', f), 'utf8');
      const theirs = fs.readFileSync(path.join(core, f), 'utf8');
      assert.equal(createHash('sha256').update(ours).digest('hex'), createHash('sha256').update(theirs).digest('hex'), `lms/server/dms/${f} differs from server/dms/${f}: the engine is shared, change both copies`);
    }
    const coreTypes = await import(new URL(`file://${path.join(core, 'types.js')}`));
    assert.deepEqual(answers(coreTypes.checkFile), answers(checkFile), 'CORE and ATLAS answer the same');
  }
  assert.deepEqual(answers(checkFile), EXPECTED);
  // The engine imports nothing from either app.
  for (const f of ENGINE) {
    const src = fs.readFileSync(path.join(LMS, 'server', 'dms', f), 'utf8');
    for (const m of src.matchAll(/^import .* from '([^']+)'/gm)) assert.ok(m[1].startsWith('node:') || m[1].startsWith('./'), `${f} imports ${m[1]}`);
  }
});

test('file types come from the bytes; programs, web pages, macros and lies are refused', () => {
  assert.equal(checkFile(PDF, 'scan.pdf').family, 'pdf');
  assert.equal(checkFile(JPEG, 'photo.JPG').ext, 'jpg');
  assert.equal(checkFile(DOCX, 'proposal.docx').family, 'word');
  assert.deepEqual([checkFile(Buffer.from('a,b\n1,2\n'), 'data.csv').ext, checkFile(Buffer.from('hello'), 'notes').name], ['csv', 'notes.txt']);
  assert.equal(sniff(Buffer.alloc(0)).refuse, 'The file is empty.');
  assert.equal(cleanName('...hidden.pdf'), 'hidden.pdf');
  assert.ok(FAMILIES.every((f) => f.exts.length));
  assert.deepEqual(['pdf', 'jpg', 'png', 'tif', 'docx', 'txt'].map(isInline), [true, true, true, false, false, false], 'only PDF and common pictures open in the browser');
});

test('blobs: encrypted at rest with a key per file; tampering and the wrong server key are detected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-blobs-'));
  const key = randomBytes(32);
  const store = createBlobStore(dir, key);
  const secret = Buffer.from('Salary review 2026: confidential figures');
  const { blobId, sha256, size } = store.put(secret);
  assert.equal(size, secret.length);
  const file = path.join(dir, blobId.slice(0, 2), blobId);
  const disk = fs.readFileSync(file);
  assert.equal(disk.indexOf('Salary'), -1, 'the content is not readable on disk');
  if (process.platform !== 'win32') assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.deepEqual(store.get(blobId, sha256), secret);
  assert.throws(() => createBlobStore(dir, randomBytes(32)).get(blobId), /another server's key/);
  disk[disk.length - 1] ^= 1;
  fs.writeFileSync(file, disk);
  assert.throws(() => store.get(blobId, sha256), /changed/);
  assert.throws(() => store.get('../../etc/passwd'), /not in the document store/);
  assert.deepEqual(store.orphans(new Set()), [blobId]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the server key: made once beside the data file, private, and a separate key per purpose', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-key-'));
  const a = createSecrets(dir, {});
  const k1 = a.derive('documents.master-key');
  const file = path.join(dir, 'server.key');
  assert.match(fs.readFileSync(file, 'utf8').trim(), /^[0-9a-f]{64}$/);
  if (process.platform !== 'win32') assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.deepEqual(createSecrets(dir, {}).derive('documents.master-key'), k1, 'the same key after a restart');
  assert.notDeepEqual(a.derive('documents.link-cookie'), k1);
  assert.equal(k1.length, 32);
  const fromEnv = createSecrets(dir, { SERVER_KEY: 'ab'.repeat(32) });
  assert.notDeepEqual(fromEnv.derive('documents.master-key'), k1, 'SERVER_KEY wins over the file');
  assert.throws(() => createSecrets(null, { SERVER_KEY: 'short' }).derive('x'), /64 hexadecimal/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('access: owners, grants, inheritance (and where it stops), expiry, managers', () => {
  const folders = new Map([
    ['root', { id: 'root', parentId: null, ownerId: 'boss', acl: [{ type: 'department', id: 'Finance', level: 'view' }] }],
    ['sub', { id: 'sub', parentId: 'root', ownerId: 'boss', acl: [{ type: 'user', id: 'ana', level: 'edit', download: false }] }],
    ['private', { id: 'private', parentId: 'root', ownerId: 'boss', inherit: false, acl: [] }],
  ]);
  const doc = (folderId, acl = []) => ({ folderId, ownerId: 'boss', acl });
  const a = (whoX, d) => accessTo(whoX, d, { folders });
  const ana = { id: 'ana', role: 'teacher', department: 'Finance' };
  const ben = { id: 'ben', role: 'staff', department: 'Library' };
  assert.deepEqual(a(ana, doc('sub')), { level: 'edit', download: true, share: false }, 'edit implies download');
  assert.equal(a(ana, doc('root')).level, 'view', 'from the department grant');
  assert.equal(a(ben, doc('root')).level, 'none');
  assert.equal(a(ana, doc('private')).level, 'none', 'a folder that does not inherit stops the grants above it');
  assert.equal(a({ id: 'boss', role: 'staff' }, doc('private')).level, 'manage', 'the owner');
  assert.equal(a({ id: 'x', role: 'admin', manager: true }, doc('private')).level, 'manage', 'document managers');
  assert.equal(a(ben, doc('root', [{ type: 'user', id: 'ben', level: 'view', until: '2000-01-01T00:00:00Z' }])).level, 'none', 'an ended grant');
  assert.equal(a(ben, doc('root', [{ type: 'everyone', id: '*', level: 'view', download: false }])).download, false);
  assert.equal(a({ id: 's1', role: 'student' }, doc('root', [{ type: 'role', id: 'student', level: 'view' }])).level, 'view', 'account types');
});

test('link secrets and settings', () => {
  const t = newToken();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(tokenHash(t), t);
  const h = hashLinkPassword('correct horse');
  assert.ok(checkLinkPassword('correct horse', h));
  assert.ok(!checkLinkPassword('wrong', h));
  const key = randomBytes(32);
  const l = { id: 'l1', passwordHash: h, linkVersion: 1 };
  const v = unlockValue(key, l);
  assert.ok(checkUnlock(key, l, v));
  assert.ok(!checkUnlock(key, { ...l, linkVersion: 2 }, v), 'a revoked or changed link signs everyone out');
  const s = cleanSettings({ maxUploadMB: 5000, families: ['pdf', 'exe'], linkClassifications: ['restricted', 'public'], linkDefaultDays: 400, linkMaxDays: 30, duplicates: 'sometimes' });
  assert.deepEqual([s.maxUploadMB, s.families, s.linkClassifications, s.linkDefaultDays, s.duplicates], [100, ['pdf'], ['public'], 30, 'warn']);
});

test('search words: plain text, e-mail, and the text of Word, Excel, PowerPoint and OpenDocument files', () => {
  assert.equal(extractText(Buffer.from('Hello\r\n  world'), 'txt'), 'Hello world');
  assert.equal(extractText(Buffer.from('﻿Name,Ana'), 'csv'), 'Name,Ana');
  assert.equal(extractText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Kumusta', 'utf16le')]), 'txt'), 'Kumusta');
  assert.equal(extractText(Buffer.from('<a>Tom &amp; Jerry</a>'), 'xml'), 'Tom & Jerry');
  assert.match(extractText(DOCX, 'docx'), /Kalayaan learning hub/);
  const xlsx = storedZip([{ name: 'xl/sharedStrings.xml', data: '<sst><si><t>Budget</t></si><si><t>Dormitory repairs</t></si></sst>' }]);
  assert.equal(extractText(xlsx, 'xlsx'), 'Budget Dormitory repairs');
  const pptx = storedZip([{ name: 'ppt/slides/slide2.xml', data: '<p:sld><a:t>Second</a:t></p:sld>' }, { name: 'ppt/slides/slide1.xml', data: '<p:sld><a:t>First</a:t></p:sld>' }]);
  assert.equal(extractText(pptx, 'pptx'), 'First Second');
  assert.equal(extractText(storedZip([{ name: 'content.xml', data: '<office:text><text:p>Minutes of the meeting</text:p></office:text>' }]), 'odt'), 'Minutes of the meeting');
  assert.equal(extractText(PDF, 'pdf'), '', 'no PDF reader in ATLAS');
  assert.equal(extractText(Buffer.from('PK broken'), 'docx'), '');
});

// ----- The API -----
const PW = 'password123';
async function school() {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const campusIds = [(await admin.get('/api/admin/campuses'))[0].id];
  const mk = (role, username, name = username) => admin.post('/api/admin/users', { role, username, name, password: PW, mustChangePassword: false, campusIds });
  const ids = {};
  for (const [role, username, name] of [['teacher', 'tess', 'Tess Teacher'], ['teacher', 'tom', 'Tom Teacher'], ['student', 'sam', 'Sam Student'], ['student', 'sue', 'Sue Student'], ['guardian', 'gina', 'Gina Guardian'], ['registrar', 'rita', 'Rita Registrar']]) ids[username] = (await mk(role, username, name)).id;
  // An HR officer and a librarian (HRIS accounts), and employee records with departments.
  const hash = hashPassword(PW);
  for (const [role, username, name] of [['hr', 'hana', 'Hana HR'], ['staff', 'lito', 'Lito Librarian']]) {
    const u = { id: `u-${username}`, role, username, name, status: 'active', passwordHash: hash, mustChangePassword: false, campusIds, createdAt: new Date().toISOString() };
    env.db.data.users.push(u);
    ids[username] = u.id;
  }
  const emp = (id, department) => ({ id, employeeNo: id, firstName: id, lastName: 'X', department, status: 'active', campusId: campusIds[0] });
  env.db.data.employees.push(emp('e-tess', 'College of Computing'), emp('e-tom', 'General Education'), emp('e-lito', 'Library'));
  env.db.data.users.find((u) => u.username === 'tess').employeeId = 'e-tess';
  env.db.data.users.find((u) => u.username === 'tom').employeeId = 'e-tom';
  env.db.data.users.find((u) => u.username === 'lito').employeeId = 'e-lito';
  const signIn = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: PW });
    return c;
  };
  const people = {};
  for (const u of Object.keys(ids)) people[u] = await signIn(u);
  return { env, admin, people, ids };
}
async function upload(c, name, buf, extra = {}) {
  const { id, chunkBytes } = await c.post('/api/docs/uploads', { name, size: buf.length });
  for (let at = 0; at < buf.length; at += chunkBytes) await c.put(`/api/docs/uploads/${id}`, { offset: at, data: buf.subarray(at, at + chunkBytes).toString('base64') });
  return c.post(`/api/docs/uploads/${id}/finish`, extra);
}
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, `${err.status}: ${err.message}`);
  if (re) assert.match(err.message, re);
  return true;
});

const S = await school();
const { env, admin, people: P, ids } = S;
const docsDir = env.api.documents.dir;
test.after(() => fs.rmSync(docsDir, { recursive: true, force: true }));

test('who opens ATLAS Documents: employees and students, with whichever session they have; parents never', async () => {
  for (const u of ['tess', 'sam', 'rita', 'hana', 'lito']) {
    const st = await P[u].get('/api/docs/auth/status');
    assert.equal(st.user?.username, u, u);
    assert.ok((await P[u].get('/api/docs/meta')).personalRoot);
  }
  assert.deepEqual((await admin.get('/api/docs/auth/status')).permissions, ['docs.manage']);
  assert.deepEqual((await P.rita.get('/api/docs/auth/status')).permissions, [], 'registrars do not manage documents unless given docs.manage');
  const g = await P.gina.get('/api/docs/auth/status');
  assert.equal(g.user, null);
  assert.equal(g.deniedUser.name, 'Gina Guardian');
  await fails(P.gina.get('/api/docs/meta'), 403, /employees and students/);
  await fails(env.client().get('/api/docs/meta'), 401);
  const hub = await P.sam.get('/api/hub/status');
  assert.equal(hub.systems.find((s) => s.id === 'dms').url, '/documents/');
  assert.ok(!(await P.gina.get('/api/hub/status')).systems.some((s) => s.id === 'dms'), 'no Documents tile for parents');
});

test('upload in pieces, versions, check-out, download; no content in the data file', async () => {
  const meta = await P.tess.get('/api/docs/meta');
  assert.ok(meta.families.some((f) => f.id === 'pdf'));
  assert.equal(meta.sharing.links, true);
  const r = await upload(P.tess, 'Project proposal KMC.docx', DOCX, { title: 'KMC proposal', tags: 'proposal, KMC', classification: 'confidential' });
  const doc = r.document;
  assert.match(doc.number, /^DOC-2026-\d{4}$/);
  assert.deepEqual([doc.level, doc.version, doc.classification, doc.tags], ['manage', 1, 'confidential', ['proposal', 'KMC']]);
  const file = await P.tess.get(`/api/docs/documents/${doc.id}/file`);
  assert.deepEqual(file.raw, DOCX);
  assert.match(file.headers['Content-Disposition'], /^attachment;/);
  assert.equal(file.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(file.headers['Content-Security-Policy'], /sandbox/);
  assert.equal(file.headers['Cache-Control'], 'private, no-store');
  // A big file in several pieces arrives whole.
  const big = Buffer.concat([Buffer.from('a,b\n'), Buffer.alloc(9 * 1024 * 1024, 'x,y\n')]);
  const bigDoc = (await upload(P.tess, 'big.csv', big)).document;
  assert.equal(bigDoc.size, big.length);
  assert.deepEqual((await P.tess.get(`/api/docs/documents/${bigDoc.id}/file`)).raw, big);
  // A piece out of place, a piece too big.
  const up = await P.tess.post('/api/docs/uploads', { name: 'x.txt', size: 10 });
  await fails(P.tess.put(`/api/docs/uploads/${up.id}`, { offset: 4, data: Buffer.from('abc').toString('base64') }), 409, /lost its place/);
  await fails(P.sam.put(`/api/docs/uploads/${up.id}`, { offset: 0, data: 'YQ==' }), 404, /no longer on the server/);
  await fails(P.tess.post('/api/docs/uploads', { name: 'huge.pdf', size: 500 * 1024 * 1024 }), 400, /larger than 50 MB/);
  // A second version of the same kind; a PDF as the next version of a Word file is refused.
  await fails(upload(P.tess, 'other.pdf', PDF, { documentId: doc.id }), 400, /same kind of file/);
  await upload(P.tess, 'Project proposal KMC v2.docx', DOCX, { documentId: doc.id, note: 'Prices updated' });
  let d = await P.tess.get(`/api/docs/documents/${doc.id}`);
  assert.deepEqual([d.version, d.versionList.map((v) => v.no), d.versionList[0].note], [2, [2, 1], 'Prices updated']);
  // Search finds words inside the Word file (from the encrypted index), not in the data file.
  const found = await P.tess.get('/api/docs/list?view=search&q=kalayaan');
  assert.ok(found.documents.some((x) => x.id === doc.id), 'found by its content');
  env.api.documents.flushIndex();
  assert.ok(!/Kalayaan/i.test(JSON.stringify(env.db.data)), 'no document content in db.json');
  for (const sub of fs.readdirSync(docsDir).filter((x) => /^[0-9a-f]{2}$/.test(x))) for (const f of fs.readdirSync(path.join(docsDir, sub))) assert.equal(fs.readFileSync(path.join(docsDir, sub, f)).indexOf('Kalayaan'), -1, 'nor on disk');
  // Check-out: Tom cannot add a version while Tess holds it (after Tess shares it for editing).
  await P.tess.put(`/api/docs/documents/${doc.id}/access`, { grants: [{ type: 'user', id: ids.tom, level: 'edit' }] });
  // Tom is told on the bell (Documents), once, with a link to the document; Tess, who shared it, is not.
  const sharedWithTom = (await P.tom.get('/api/me/notifications')).items.filter((n) => n.kind === 'docs-shared');
  assert.equal(sharedWithTom.length, 1);
  assert.equal(sharedWithTom[0].system, 'dms');
  assert.equal(sharedWithTom[0].link, `/documents/#/doc/${doc.id}`);
  assert.match(sharedWithTom[0].title, /shared “.+” with you$/);
  assert.equal(sharedWithTom[0].body, 'You can open and change it.');
  await P.tess.put(`/api/docs/documents/${doc.id}/access`, { grants: [{ type: 'user', id: ids.tom, level: 'edit' }] });
  assert.equal((await P.tom.get('/api/me/notifications')).items.filter((n) => n.kind === 'docs-shared').length, 1, 'shared again: not told twice');
  assert.equal((await P.tess.get('/api/me/notifications')).items.filter((n) => n.kind === 'docs-shared').length, 0);
  await P.tess.post(`/api/docs/documents/${doc.id}/checkout`, {});
  await fails(upload(P.tom, 'mine.docx', DOCX, { documentId: doc.id }), 400, /checked out/);
  await fails(P.tom.post(`/api/docs/documents/${doc.id}/checkout`, { release: true }), 400, /only they or a manager/);
  d = await P.tess.post(`/api/docs/documents/${doc.id}/checkout`, { release: true });
  assert.equal(d.checkout, null);
  await upload(P.tom, 'Project proposal KMC v3.docx', DOCX, { documentId: doc.id });
  d = await P.tess.post(`/api/docs/documents/${doc.id}/restore-version`, { no: 1 });
  assert.deepEqual([d.version, d.versionList[0].note], [4, 'Restored from version 1']);
  assert.ok((await P.tom.get('/api/docs/list?view=shared')).documents.some((x) => x.id === doc.id), 'in Tom\'s Shared with me');
  assert.ok(d.events.some((e) => e.action === 'checkout') && d.events.some((e) => e.action === 'download'));
  // Refused uploads say why.
  await fails(upload(P.tess, 'tool.pdf', Buffer.from('MZ' + 'x'.repeat(50))), 400, /program or a script/);
  await fails(upload(P.tess, 'mystery.bin', randomBytes(64).fill(0, 0, 8)), 400, /ATLAS could not tell/);
});

test('access: 404 for what you cannot see; grants never give more than the giver holds; restricted files; departments', async () => {
  const { document: doc } = await upload(P.tess, 'scan.pdf', PDF, { title: 'Board minutes', classification: 'restricted' });
  await fails(P.tom.get(`/api/docs/documents/${doc.id}`), 404);
  await fails(P.tom.get(`/api/docs/documents/${doc.id}/file`), 404);
  await fails(P.tess.put(`/api/docs/documents/${doc.id}/access`, { grants: [{ type: 'everyone', level: 'view' }] }), 400, /named people only/);
  await fails(P.tess.put(`/api/docs/documents/${doc.id}/access`, { grants: [{ type: 'user', id: ids.gina, level: 'view' }] }), 400, /Parents and guardians/);
  await P.tess.put(`/api/docs/documents/${doc.id}/access`, { grants: [{ type: 'user', id: ids.tom, level: 'edit' }] });
  // Tom edits but cannot download a restricted document, nor share it further.
  await fails(P.tom.get(`/api/docs/documents/${doc.id}/file`), 403, /Restricted/);
  const view = await P.tom.get(`/api/docs/documents/${doc.id}/file?inline=1`);
  assert.match(view.headers['Content-Disposition'], /^inline;/, 'a PDF can be viewed');
  assert.doesNotMatch(view.headers['Content-Security-Policy'], /sandbox/, 'the PDF viewer needs an unsandboxed response');
  await fails(P.tom.put(`/api/docs/documents/${doc.id}/access`, { grants: [] }), 404, /not there/);
  await fails(P.tess.post('/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'view' }), 400, /never shared by link/);
  // Department grants through a folder (departments from the HRIS employee records).
  const f = await admin.post('/api/docs/folders', { name: 'Computing syllabi' });
  await admin.put(`/api/docs/folders/${f.id}/access`, { grants: [{ type: 'department', id: 'College of Computing', level: 'view' }] });
  await fails(admin.put(`/api/docs/folders/${f.id}/access`, { grants: [{ type: 'department', id: 'Nowhere', level: 'view' }] }), 400, /no department/);
  const { document: pol } = await upload(admin, 'syllabus.pdf', PDF, { folderId: f.id, title: 'IT 101 syllabus' });
  assert.equal((await P.tess.get(`/api/docs/documents/${pol.id}`)).level, 'view');
  await fails(P.tom.get(`/api/docs/documents/${pol.id}`), 404);
  await fails(P.tess.post('/api/docs/folders', { name: 'Top' }), 400, /Only document managers/);
  await fails(upload(P.tess, 'x.pdf', PDF, { folderId: f.id }), 404, /not there/);
  // A grant of edit lets Tess add files and folders there, never give manage.
  await admin.put(`/api/docs/folders/${f.id}/access`, { grants: [{ type: 'department', id: 'College of Computing', level: 'edit' }] });
  const sub = await P.tess.post('/api/docs/folders', { name: 'IT 101', parentId: f.id });
  assert.equal(sub.level, 'manage', 'her own folder');
  await fails(P.tess.put(`/api/docs/folders/${f.id}/access`, { grants: [] }), 404);
  await fails(P.tess.put(`/api/docs/documents/${pol.id}/access`, { grants: [{ type: 'user', id: ids.tom, level: 'manage' }] }), 404);
  // Account types (roles) as grants; the folder list shows a shared folder at the top.
  await admin.put(`/api/docs/folders/${f.id}/access`, { grants: [{ type: 'role', id: 'staff', level: 'view' }] });
  assert.ok((await P.lito.get('/api/docs/folders')).folders.some((x) => x.id === f.id && !x.parentId));
  await fails(admin.put(`/api/docs/folders/${f.id}/access`, { grants: [{ type: 'role', id: 'guardian', level: 'view' }] }), 400, /account type/);
  // An administrator's lists are their own, though they can open everyone's documents.
  assert.ok(!(await admin.get('/api/docs/list?view=shared')).documents.some((x) => x.id === doc.id));
  assert.equal((await admin.get(`/api/docs/documents/${doc.id}`)).level, 'manage');
  assert.ok(!(await admin.get('/api/docs/folders')).folders.some((x) => x.personal && x.ownerId === ids.tess), 'others\' My files are not listed');
});

test('students: their own files, what is shared with them; no links, no groups, no everyone', async () => {
  const meta = await P.sam.get('/api/docs/meta');
  assert.deepEqual([meta.student, meta.sharing.links, meta.sharing.everyone, meta.sharing.groups, meta.departments, meta.roles], [true, false, false, false, [], []]);
  const { document: essay } = await upload(P.sam, 'Essay.docx', DOCX, { title: 'My essay' });
  assert.equal(essay.level, 'manage');
  await fails(P.sam.post('/api/docs/links', { target: { kind: 'document', id: essay.id }, mode: 'view' }), 400, /Students cannot make links/);
  await fails(P.sam.put(`/api/docs/documents/${essay.id}/access`, { grants: [{ type: 'everyone', level: 'view' }] }), 400, /named people only/);
  await fails(P.sam.put(`/api/docs/documents/${essay.id}/access`, { grants: [{ type: 'role', id: 'student', level: 'view' }] }), 400, /named people only/);
  await fails(P.sam.put(`/api/docs/documents/${essay.id}/access`, { grants: [{ type: 'department', id: 'Library', level: 'view' }] }), 400, /named people only/);
  await fails(P.sam.post('/api/docs/folders', { name: 'Shared top' }), 400, /Only document managers/);
  const mine = await P.sam.post('/api/docs/folders', { name: 'Thesis', parentId: meta.personalRoot });
  assert.equal(mine.personal, true);
  // Sam hands the essay to his teacher; Sue (another student) sees nothing of it.
  await P.sam.put(`/api/docs/documents/${essay.id}/access`, { grants: [{ type: 'user', id: ids.tess, level: 'view' }] });
  assert.equal((await P.tess.get(`/api/docs/documents/${essay.id}`)).level, 'view');
  await fails(P.sue.get(`/api/docs/documents/${essay.id}`), 404);
  await fails(P.sue.get('/api/docs/list?folder=' + meta.personalRoot), 404);
  // A teacher shares a reading with a student: it is in Shared with me; the student cannot pass it on.
  const { document: reading } = await upload(P.tess, 'Reading.pdf', PDF, { title: 'Reading list', classification: 'public' });
  await P.tess.put(`/api/docs/documents/${reading.id}/access`, { grants: [{ type: 'user', id: ids.sam, level: 'edit', share: true }] });
  const shared = await P.sam.get('/api/docs/list?view=shared');
  assert.ok(shared.documents.some((x) => x.id === reading.id && !x.canShare), 'a student never shares further');
  await fails(P.sam.post('/api/docs/links', { target: { kind: 'document', id: reading.id }, mode: 'download' }), 400, /Students cannot/);
  // People search: staff find everyone but parents; students find staff (and classmates only).
  const forStaff = (await P.tess.get('/api/docs/people?q=su')).people.map((x) => x.name);
  assert.ok(forStaff.includes('Sue Student'));
  assert.ok(!(await P.tess.get('/api/docs/people?q=gina')).people.length, 'no parents');
  const forStudent = await P.sam.get('/api/docs/people?q=te');
  assert.ok(forStudent.people.some((x) => x.name === 'Tess Teacher'));
  assert.ok(!forStudent.people.some((x) => x.role === 'student'), 'no classmates in common: no students');
  // A link a student made before (by data) never works.
  env.db.data.docLinks.push({ id: 'l-stu', tokenHash: tokenHash('A'.repeat(43)), hint: 'AAAA', target: { kind: 'document', id: essay.id }, mode: 'view', passwordHash: null, linkVersion: 1, expiresAt: '2099-01-01T00:00:00Z', createdBy: ids.sam, createdAt: '2026-01-01T00:00:00Z' });
  await fails(env.client().get(`/api/public/share/${'A'.repeat(43)}`), 404, /not available/);
});

test('links outside the school: hashed tokens, passwords, view-only, limits, revoke, re-checks', async () => {
  const { document: doc } = await upload(P.tess, 'Quote.pdf', PDF, { title: 'Quote for supplier', classification: 'internal' });
  const r = await P.tess.post('/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'download', password: 'open-sesame', days: 7, maxDownloads: 2 });
  assert.match(r.url, /^http:\/\/localhost\/share\/[A-Za-z0-9_-]{43}$/);
  const token = r.url.split('/share/')[1];
  assert.ok(!JSON.stringify(env.db.data.docLinks).includes(token), 'the token is not stored');
  const guest = env.client(); // a person outside the school: no ATLAS session
  let info = await guest.get(`/api/public/share/${token}`);
  assert.equal(info.needsPassword, true);
  assert.equal(info.name, undefined, 'nothing about the file before the password');
  await fails(guest.get(`/api/public/share/${token}/file`), 401);
  await fails(guest.post(`/api/public/share/${token}/unlock`, { password: 'nope' }), 400, /not right/);
  await guest.post(`/api/public/share/${token}/unlock`, { password: 'open-sesame' });
  info = await guest.get(`/api/public/share/${token}`);
  assert.deepEqual([info.name, info.documents.length, info.downloadsLeft], ['Quote for supplier', 1, 2]);
  const f1 = await guest.get(`/api/public/share/${token}/file`);
  assert.deepEqual(f1.raw, PDF);
  await guest.get(`/api/public/share/${token}/file`);
  await fails(guest.get(`/api/public/share/${token}/file`), 404, /not available/);
  const events = (await P.tess.get(`/api/docs/documents/${doc.id}`)).events.map((e) => e.action);
  assert.ok(events.includes('link-downloads') && events.includes('link'));
  const notices = (await P.tess.get('/api/docs/meta')).notices;
  assert.ok(notices.some((n) => /opened for the first time/.test(n.title)), 'told at first opening');
  await P.tess.post('/api/docs/notices/read', {});
  assert.equal((await P.tess.get('/api/docs/meta')).notices.length, 0);
  // Wrong passwords are limited per address and link.
  const p2 = (await P.tess.post('/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'view', password: 'another-secret' })).url.split('/share/')[1];
  for (let i = 0; i < 10; i++) await fails(guest.post(`/api/public/share/${p2}/unlock`, { password: `guess-${i}` }), 400);
  await fails(guest.post(`/api/public/share/${p2}/unlock`, { password: 'another-secret' }), 429, /Too many wrong passwords/);
  // View-only: open a PDF, never download.
  const v = await P.tess.post('/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'view' });
  const vt = v.url.split('/share/')[1];
  assert.match((await guest.get(`/api/public/share/${vt}/file?inline=1`)).headers['Content-Disposition'], /^inline/);
  await fails(guest.get(`/api/public/share/${vt}/file`), 403, /not download/);
  // Re-checked on every use: classification, policy, revoke, the creator's access.
  await P.tess.put(`/api/docs/documents/${doc.id}`, { classification: 'restricted' });
  await fails(guest.get(`/api/public/share/${vt}`), 404);
  await P.tess.put(`/api/docs/documents/${doc.id}`, { classification: 'internal' });
  await admin.put('/api/docs/settings', { settings: { links: false } });
  await fails(guest.get(`/api/public/share/${vt}`), 404);
  await admin.put('/api/docs/settings', { settings: { links: true, linkPasswordRequired: true, linkMaxDays: 30 } });
  await fails(P.tess.post('/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'view' }), 400, /need a password/);
  await fails(P.tess.post('/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'view', password: 'long-enough', days: 60 }), 400, /1 to 30 days/);
  await admin.put('/api/docs/settings', { settings: { linkPasswordRequired: false } });
  assert.equal((await guest.get(`/api/public/share/${vt}`)).mode, 'view');
  await P.tess.del(`/api/docs/links/${v.link.id}`);
  await fails(guest.get(`/api/public/share/${vt}`), 404);
  await fails(guest.get('/api/public/share/not-a-token'), 404);
  // Confidential documents need a password; a disabled creator's links stop.
  const { document: conf } = await upload(P.tess, 'Grades.csv', Buffer.from('a,b\n1,2\n'), { classification: 'confidential' });
  await fails(P.tess.post('/api/docs/links', { target: { kind: 'document', id: conf.id }, mode: 'download' }), 400, /confidential documents need a password/);
  const c = await P.tom.post('/api/docs/links', { target: { kind: 'document', id: (await upload(P.tom, 'Notice.pdf', PDF)).document.id }, mode: 'download' });
  const ct = c.url.split('/share/')[1];
  assert.equal((await guest.get(`/api/public/share/${ct}`)).documents.length, 1);
  env.db.data.users.find((u) => u.id === ids.tom).status = 'disabled';
  await fails(guest.get(`/api/public/share/${ct}`), 404);
  env.db.data.users.find((u) => u.id === ids.tom).status = 'active';
});

test('upload links: files from outside arrive checked and unreviewed', async () => {
  const f = await P.lito.post('/api/docs/folders', { name: 'Book donations', parentId: (await P.lito.get('/api/docs/meta')).personalRoot });
  const r = await P.lito.post('/api/docs/links', { target: { kind: 'folder', id: f.id }, mode: 'upload', days: 3, note: 'Send the list of books you are donating.' });
  const token = r.url.split('/share/')[1];
  const guest = env.client();
  const info = await guest.get(`/api/public/share/${token}`);
  assert.deepEqual([info.folder, info.mode, info.documents], ['Book donations', 'upload', undefined]);
  const send = async (name, buf) => {
    const { id } = await guest.post(`/api/public/share/${token}/uploads`, { name, size: buf.length });
    await guest.put(`/api/public/share/${token}/uploads/${id}`, { offset: 0, data: buf.toString('base64') });
    return guest.post(`/api/public/share/${token}/uploads/${id}/finish`, { name: 'Maria (donor)', message: 'Twenty books' });
  };
  assert.equal((await send('books.pdf', PDF)).ok, true);
  await fails(send('tool.exe', Buffer.from('MZ' + 'x'.repeat(100))), 400, /never accepted/);
  const received = await P.lito.get('/api/docs/list?view=received');
  assert.equal(received.documents.length, 1);
  assert.equal(received.documents[0].reviewed, false);
  const d = await P.lito.get(`/api/docs/documents/${received.documents[0].id}`);
  assert.deepEqual([d.sender.name, d.description, d.ownerId], ['Maria (donor)', 'Twenty books', ids.lito]);
  await P.lito.put(`/api/docs/documents/${d.id}`, { reviewed: true });
  assert.equal((await P.lito.get('/api/docs/list?view=received')).documents.length, 0);
  assert.ok(env.db.data.docRefused.some((x) => x.name === 'tool.exe'), 'refusals are logged for Document control');
  assert.ok((await P.lito.get('/api/docs/meta')).notices.some((n) => /arrived in Book donations/.test(n.title)));
  await fails(guest.get(`/api/public/share/${token}/file`), 404); // an upload link shows nothing back
  await fails(P.lito.post('/api/docs/links', { target: { kind: 'document', id: d.id }, mode: 'upload' }), 400, /made for folders/);
});

test('trash, legal hold, purge; integrity check; Document control', async () => {
  const { document: doc } = await upload(P.tess, 'contract.pdf', PDF, { title: 'Lease contract' });
  await admin.put(`/api/docs/documents/${doc.id}`, { legalHold: true });
  await fails(P.tess.del(`/api/docs/documents/${doc.id}`), 400, /legal hold/);
  await fails(P.tess.put(`/api/docs/documents/${doc.id}`, { legalHold: false }), 400, /Only document managers/);
  await admin.put(`/api/docs/documents/${doc.id}`, { legalHold: false });
  await P.tess.del(`/api/docs/documents/${doc.id}`);
  assert.ok((await P.tess.get('/api/docs/list?view=trash')).documents.some((x) => x.id === doc.id));
  await fails(P.tess.get(`/api/docs/documents/${doc.id}/file`), 404, /not there/);
  await P.tess.post('/api/docs/restore', { documentId: doc.id });
  await P.tess.del(`/api/docs/documents/${doc.id}`);
  // Past the trash days, the sweep deletes it for good, files included.
  const d = env.db.data.documents.find((x) => x.id === doc.id);
  const blob = d.versions[0].blobId;
  d.trashedAt = new Date(Date.parse('2026-08-10T10:00:00') - 40 * 86400000).toISOString();
  env.api.documents.sweep();
  assert.ok(!env.db.data.documents.some((x) => x.id === doc.id));
  assert.equal(env.api.documents.blobs.exists(blob), false);
  // Integrity: a changed file is found.
  const { document: other } = await upload(P.tess, 'notes.txt', Buffer.from('plain words'), {});
  let check = await admin.post('/api/docs/admin/integrity', {});
  assert.equal(check.problems.length, 0);
  const v = env.db.data.documents.find((x) => x.id === other.id).versions[0];
  const p = path.join(docsDir, v.blobId.slice(0, 2), v.blobId);
  const bytes = fs.readFileSync(p);
  bytes[bytes.length - 2] ^= 0xff;
  fs.writeFileSync(p, bytes);
  check = await admin.post('/api/docs/admin/integrity', {});
  assert.equal(check.problems.length, 1);
  await fails(P.tess.get(`/api/docs/documents/${other.id}/file`), 500, /changed/);
  // Document control: only docs.manage; settings cleaned; type switches apply at once.
  await fails(P.tess.get('/api/docs/settings'), 403);
  await fails(P.rita.get('/api/docs/admin'), 403);
  const s = await admin.get('/api/docs/settings');
  assert.ok(s.blocked.exts.includes('exe'));
  await admin.put('/api/docs/settings', { settings: { families: ['pdf'], maxUploadMB: 900 } });
  assert.equal((await admin.get('/api/docs/settings')).settings.maxUploadMB, 100);
  await fails(upload(P.tess, 'photo.jpg', JPEG, {}), 400, /not accepted here/);
  await admin.put('/api/docs/settings', { settings: { families: s.settings.families, maxUploadMB: 50 } });
  // Recorded in the Settings center's history.
  const h = await admin.get('/api/admin/config/history?area=documents');
  assert.ok(h.entries.some((e) => e.changes.some((c) => c.label === 'File types accepted')));
  const overview = await admin.get('/api/docs/admin');
  assert.ok(overview.refused.length >= 1 && overview.usage.files >= 1 && overview.links.length >= 1);
  // A registrar given docs.manage under Roles & permissions opens Document control.
  const roles = await admin.get('/api/admin/roles');
  await admin.put('/api/admin/roles', { permissions: { registrar: [...roles.roles.find((r) => r.id === 'registrar').permissions, 'docs.manage'] } });
  assert.ok((await P.rita.get('/api/docs/admin')).documents >= 1);
  await admin.post('/api/admin/config/reset', { area: 'roles' });
  const revoked = await admin.post('/api/docs/admin/links/revoke-all', {});
  assert.ok(revoked.revoked >= 1);
  assert.equal((await admin.get('/api/docs/admin')).links.length, 0);
});

test('demo documents: added with the demo school, removed with it', async () => {
  const demo = setup();
  const a = demo.client();
  await a.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await a.post('/api/admin/demo');
  const n = demo.db.data.documents.filter((d) => d.demo).length;
  assert.ok(n >= 8, `${n} demo documents`);
  const student = demo.client();
  await student.post('/api/hub/login', { username: 'student.demo', password: 'demo1234' });
  assert.ok((await student.get('/api/docs/list?view=shared')).documents.some((d) => d.title === 'Reading list IT 101'));
  assert.ok((await student.get('/api/docs/list?view=search&q=handbook')).documents.length >= 1, 'everyone sees the school policies');
  const teacher = demo.client();
  await teacher.post('/api/hub/login', { username: 'teacher.demo', password: 'demo1234' });
  assert.ok((await teacher.get('/api/docs/list?view=search&q=flowchart')).documents.some((d) => d.title === 'Lesson plan week 5'), 'found by the words in the Word file');
  await a.del('/api/admin/demo');
  assert.equal(demo.db.data.documents.length, 0);
  assert.equal(demo.db.data.docFolders.filter((f) => f.demo).length, 0);
  fs.rmSync(demo.api.documents.dir, { recursive: true, force: true });
});
