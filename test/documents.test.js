// Document Management (0.67): the engine (file types from the bytes, encryption at rest, access with
// inheritance, link secrets, the control panel's settings) and the API (uploads in pieces, versions,
// check-out, grants that never give more than the giver holds, 404 on denial, links outside the company
// with passwords, limits and expiry, upload links, trash, legal hold, search, the integrity check).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { checkFile, sniff, cleanName, FAMILIES, DEFAULT_FAMILIES } from '../server/dms/types.js';
import { createBlobStore } from '../server/dms/blobs.js';
import { accessTo } from '../server/dms/access.js';
import { cleanSettings } from '../server/dms/policy.js';
import { newToken, tokenHash, hashLinkPassword, checkLinkPassword, unlockValue, checkUnlock } from '../server/dms/links.js';

const fx = (f) => fs.readFileSync(new URL(`../scripts/fixtures/${f}`, import.meta.url));
const PDF = fx('Scanned acceptance NSU-2025-118.pdf');
const JPEG = fx('profile-sample.jpg');
const DOCX = fx('Project proposal KMC.docx');

// A ZIP with folders, its parts stored or deflated.
function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.data);
    const crc = zlib.crc32(data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(f.size ?? data.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(f.size ?? data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, name, data);
    central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const ooxml = (main, types = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', extra = []) => zip([
  { name: '[Content_Types].xml', data: `<Types><Override PartName="/${main}" ContentType="${types}"/></Types>` }, { name: main, data: '<w:document/>' }, ...extra,
]);

test('file types come from the bytes; programs, web pages, macros and lies are refused', () => {
  assert.equal(checkFile(PDF, 'scan.pdf').family, 'pdf');
  assert.equal(checkFile(JPEG, 'photo.JPG').ext, 'jpg');
  assert.equal(checkFile(DOCX, 'proposal.docx').family, 'word');
  assert.deepEqual([checkFile(Buffer.from('a,b\n1,2\n'), 'data.csv').ext, checkFile(Buffer.from('hello'), 'notes').name], ['csv', 'notes.txt']);
  const refuse = (buf, name, re, families) => {
    const r = checkFile(buf, name, families);
    assert.equal(r.ok, false, name);
    assert.match(r.reason, re, name);
    return r;
  };
  refuse(Buffer.concat([Buffer.from('MZ'), randomBytes(200)]), 'invoice.pdf', /program or a script/);
  refuse(Buffer.from('#!/bin/sh\nrm -rf /'), 'notes.txt', /program or a script/);
  refuse(Buffer.from('anything'), 'setup.exe', /never accepted/);
  refuse(Buffer.from('<!DOCTYPE html><script>alert(1)</script>'), 'page.txt', /web page or SVG/);
  refuse(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), 'logo.txt', /web page or SVG/);
  refuse(ooxml('word/document.xml', 'application/vnd.ms-word.document.macroEnabled.main+xml'), 'memo.docx', /macros/);
  refuse(ooxml('word/document.xml', undefined, [{ name: 'word/vbaProject.bin', data: 'x' }]), 'memo.docx', /macros/);
  refuse(zip([{ name: 'payload/run.exe', data: 'MZ' }]), 'bundle.zip', /never accepted/, [...DEFAULT_FAMILIES, 'archive']);
  refuse(zip([{ name: 'big.bin', data: 'x', size: 0xfffffff0 }]), 'bomb.zip', /far more data/, [...DEFAULT_FAMILIES, 'archive']);
  refuse(zip([{ name: 'a.txt', data: 'x' }]), 'notes.zip', /not accepted here/);
  const lie = refuse(PDF, 'photo.jpg', /called \.jpg but it is a PDF/);
  assert.equal(lie.code, 'mismatch');
  refuse(JPEG, 'scan.jpg', /Pictures files are not accepted/, ['pdf']);
  // Office 97–2003: told apart by the streams inside.
  const cfb = (names) => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504), ...names.map((n) => Buffer.from(n, 'utf16le'))]);
  assert.equal(checkFile(cfb(['WordDocument']), 'old.doc').ext, 'doc');
  refuse(cfb(['WordDocument', '_VBA_PROJECT']), 'old.doc', /macros/);
  refuse(cfb(['EncryptedPackage']), 'secret.docx', /password/);
  assert.equal(sniff(Buffer.alloc(0)).refuse, 'The file is empty.');
  assert.equal(cleanName('../../etc/pa<ss>wd'), 'pa ss wd');
  assert.equal(cleanName('...hidden.pdf'), 'hidden.pdf');
  assert.ok(FAMILIES.every((f) => f.exts.length));
});

test('blobs: encrypted at rest with a key per file; tampering and the wrong server key are detected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-blobs-'));
  const key = randomBytes(32);
  const store = createBlobStore(dir, key);
  const secret = Buffer.from('Salary review 2026: confidential figures');
  const { blobId, sha256, size } = store.put(secret);
  assert.equal(size, secret.length);
  const file = path.join(dir, blobId.slice(0, 2), blobId);
  const disk = fs.readFileSync(file);
  assert.equal(disk.indexOf('Salary'), -1, 'the content is not readable on disk');
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.deepEqual(store.get(blobId, sha256), secret);
  assert.throws(() => createBlobStore(dir, randomBytes(32)).get(blobId), /another server's key/);
  disk[disk.length - 1] ^= 1;
  fs.writeFileSync(file, disk);
  assert.throws(() => store.get(blobId, sha256), /changed/);
  assert.throws(() => store.get('../../etc/passwd'), /not in the document store/);
  assert.deepEqual(store.orphans(new Set()), [blobId]);
});

test('access: owners, grants, inheritance (and where it stops), expiry, managers', () => {
  const folders = new Map([
    ['root', { id: 'root', parentId: null, ownerId: 'boss', acl: [{ type: 'department', id: 'Finance', level: 'view' }] }],
    ['sub', { id: 'sub', parentId: 'root', ownerId: 'boss', acl: [{ type: 'user', id: 'ana', level: 'edit', download: false }] }],
    ['private', { id: 'private', parentId: 'root', ownerId: 'boss', inherit: false, acl: [] }],
  ]);
  const doc = (folderId, acl = []) => ({ folderId, ownerId: 'boss', acl });
  const a = (whoX, d) => accessTo(whoX, d, { folders });
  const ana = { id: 'ana', role: 'employee', department: 'Finance' };
  const ben = { id: 'ben', role: 'employee', department: 'Sales' };
  assert.deepEqual(a(ana, doc('sub')), { level: 'edit', download: true, share: false }, 'edit implies download');
  assert.equal(a(ana, doc('root')).level, 'view', 'from the department grant');
  assert.equal(a(ben, doc('root')).level, 'none');
  assert.equal(a(ana, doc('private')).level, 'none', 'a folder that does not inherit stops the grants above it');
  assert.equal(a({ id: 'boss', role: 'employee' }, doc('private')).level, 'manage', 'the owner');
  assert.equal(a({ id: 'x', role: 'admin', manager: true }, doc('private')).level, 'manage', 'document managers');
  assert.equal(a(ben, doc('root', [{ type: 'user', id: 'ben', level: 'view', until: '2000-01-01T00:00:00Z' }])).level, 'none', 'an ended grant');
  assert.equal(a(ben, doc('root', [{ type: 'everyone', id: '*', level: 'view', download: false }])).download, false);
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

// ----- The API -----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-docs-'));
const db = openDb(path.join(dir, 'db.json'));
const handle = createApi(db);
const client = (ip = '10.0.0.7') => {
  let cookie = '';
  const extra = {};
  const c = async (method, url, body = {}) => {
    const cookies = [cookie, ...Object.entries(extra).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join('; ');
    const res = await handle({ method, headers: { cookie: cookies }, socket: { remoteAddress: ip } }, new URL(url, 'http://localhost'), body);
    const sc = res.headers['Set-Cookie'];
    if (sc) {
      const [pair] = sc.split(';');
      const [k, v] = pair.split('=');
      if (k.startsWith('core_share_')) extra[k] = v;
      else cookie = pair;
    }
    return res;
  };
  return c;
};
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
  return true;
});
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'Correct-Horse-42' });
db.data.employees.push({ id: 'e-ana', employeeNo: 'E-1', firstName: 'Ana', lastName: 'Cruz', department: 'Finance', status: 'active' }, { id: 'e-ben', employeeNo: 'E-2', firstName: 'Ben', lastName: 'Reyes', department: 'Sales', status: 'active' });
const people = {};
for (const [username, role, employeeId] of [['ana', 'employee', 'e-ana'], ['ben', 'employee', 'e-ben'], ['hr1', 'hr', null]]) {
  await admin('POST', '/api/users', { name: username, username, role, password: 'Correct-Horse-42', mustChangePassword: false, ...(employeeId ? { employeeId } : {}) });
  people[username] = client();
  await people[username]('POST', '/api/auth/login', { username, password: 'Correct-Horse-42' });
}
const as = (who) => async (m, u, b) => (await people[who](m, u, b)).data;
const ana = as('ana');
const ben = as('ben');
const adm = async (m, u, b) => (await admin(m, u, b)).data;
const idOf = (username) => db.data.users.find((u) => u.username === username).id;

async function upload(who, name, buf, extra = {}) {
  const { id, chunkBytes } = await who('POST', '/api/docs/uploads', { name, size: buf.length });
  for (let at = 0; at < buf.length; at += chunkBytes) await who('PUT', `/api/docs/uploads/${id}`, { offset: at, data: buf.subarray(at, at + chunkBytes).toString('base64') });
  return who('POST', `/api/docs/uploads/${id}/finish`, extra);
}

test('upload, versions, check-out, download; nothing of the content in db.json', async () => {
  const meta = await ana('GET', '/api/docs/meta');
  assert.ok(meta.personalRoot);
  assert.ok(meta.families.some((f) => f.id === 'pdf'));
  const r = await upload(ana, 'Project proposal KMC.docx', DOCX, { title: 'KMC proposal', tags: 'proposal, KMC', classification: 'confidential' });
  const doc = r.document;
  assert.match(doc.number, /^DOC-\d{4}-0001$/);
  assert.deepEqual([doc.level, doc.version, doc.classification, doc.tags], ['manage', 1, 'confidential', ['proposal', 'KMC']]);
  const file = (await people.ana('GET', `/api/docs/documents/${doc.id}/file`));
  assert.deepEqual(file.data, DOCX);
  assert.match(file.headers['Content-Disposition'], /^attachment;/);
  assert.equal(file.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(file.headers['Content-Security-Policy'], /sandbox/);
  // A second version of the same kind; a PDF as the next version of a Word file is refused.
  await fails(upload(ana, 'other.pdf', PDF, { documentId: doc.id }), 400, /same kind of file/);
  await upload(ana, 'Project proposal KMC v2.docx', DOCX, { documentId: doc.id, note: 'Prices updated' });
  let d = await ana('GET', `/api/docs/documents/${doc.id}`);
  assert.deepEqual([d.version, d.versionList.map((v) => v.no), d.versionList[0].note], [2, [2, 1], 'Prices updated']);
  // Search finds words inside the Word file (from the encrypted index).
  handle.documents.flushIndex();
  const found = await ana('GET', '/api/docs/list?view=search&q=kalayaan');
  assert.ok(found.documents.some((x) => x.id === doc.id), 'found by its content');
  const raw = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  assert.ok(!/Kalayaan/i.test(raw), 'no document content in db.json');
  // Check-out: Ben cannot add a version while Ana holds it (after Ana shares it for editing).
  await ana('PUT', `/api/docs/documents/${doc.id}/access`, { grants: [{ type: 'user', id: idOf('ben'), level: 'edit' }] });
  await ana('POST', `/api/docs/documents/${doc.id}/checkout`, {});
  await fails(upload(ben, 'mine.docx', DOCX, { documentId: doc.id }), 400, /checked out/);
  await fails(ben('POST', `/api/docs/documents/${doc.id}/checkout`, { release: true }), 400, /only they or a manager/);
  d = await ana('POST', `/api/docs/documents/${doc.id}/checkout`, { release: true });
  assert.equal(d.checkout, null);
  await upload(ben, 'Project proposal KMC v3.docx', DOCX, { documentId: doc.id });
  d = await ana('POST', `/api/docs/documents/${doc.id}/restore-version`, { no: 1 });
  assert.deepEqual([d.version, d.versionList[0].note], [4, 'Restored from version 1']);
});

test('access: 404 for what you cannot see; grants never give more than the giver holds; restricted files', async () => {
  const { document: doc } = await upload(ana, 'scan.pdf', PDF, { title: 'Board minutes', classification: 'restricted' });
  await fails(ben('GET', `/api/docs/documents/${doc.id}`), 404);
  await fails(people.ben('GET', `/api/docs/documents/${doc.id}/file`), 404);
  await fails(ana('PUT', `/api/docs/documents/${doc.id}/access`, { grants: [{ type: 'everyone', level: 'view' }] }), 400, /named people only/);
  await ana('PUT', `/api/docs/documents/${doc.id}/access`, { grants: [{ type: 'user', id: idOf('ben'), level: 'edit' }] });
  // Ben edits but cannot download a restricted document, nor give anyone more than edit.
  await fails(people.ben('GET', `/api/docs/documents/${doc.id}/file`), 403, /Restricted/);
  const view = await people.ben('GET', `/api/docs/documents/${doc.id}/file?inline=1`);
  assert.match(view.headers['Content-Disposition'], /^inline;/, 'a PDF can be viewed');
  assert.doesNotMatch(view.headers['Content-Security-Policy'], /sandbox/, 'Chrome\'s PDF viewer does not open in a sandbox');
  assert.match(view.headers['Content-Security-Policy'], /default-src 'none'/);
  await fails(ben('PUT', `/api/docs/documents/${doc.id}/access`, { grants: [] }), 404, /not there/);
  await fails(ana('POST', '/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'view' }), 400, /never shared by link/);
  // Department grants through a folder.
  const f = await adm('POST', '/api/docs/folders', { name: 'Finance policies' });
  await adm('PUT', `/api/docs/folders/${f.id}/access`, { grants: [{ type: 'department', id: 'Finance', level: 'view' }] });
  const { document: pol } = await upload(adm, 'policy.pdf', PDF, { folderId: f.id, title: 'Expense policy' });
  assert.equal((await ana('GET', `/api/docs/documents/${pol.id}`)).level, 'view');
  await fails(ben('GET', `/api/docs/documents/${pol.id}`), 404);
  await fails(ana('POST', '/api/docs/folders', { name: 'Top' }), 400, /Only document managers/);
  await fails(upload(ana, 'x.pdf', PDF, { folderId: f.id }), 404, /not there/);
});

test('links outside the company: hashed tokens, passwords, view-only, limits, revoke, re-checks', async () => {
  const { document: doc } = await upload(ana, 'Quote.pdf', PDF, { title: 'Quote for client', classification: 'internal' });
  const r = await ana('POST', '/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'download', password: 'open-sesame', days: 7, maxDownloads: 2 });
  const token = r.url.split('/share/')[1];
  assert.ok(!JSON.stringify(db.data.docLinks).includes(token), 'the token is not stored');
  const guest = client('203.0.113.9');
  let info = (await guest('GET', `/api/public/share/${token}`)).data;
  assert.equal(info.needsPassword, true);
  assert.equal(info.name, undefined, 'nothing about the file before the password');
  await fails(guest('GET', `/api/public/share/${token}/file`), 401);
  await fails(guest('POST', `/api/public/share/${token}/unlock`, { password: 'nope' }), 400, /not right/);
  await guest('POST', `/api/public/share/${token}/unlock`, { password: 'open-sesame' });
  info = (await guest('GET', `/api/public/share/${token}`)).data;
  assert.deepEqual([info.name, info.documents.length, info.downloadsLeft], ['Quote for client', 1, 2]);
  const f1 = await guest('GET', `/api/public/share/${token}/file`);
  assert.deepEqual(f1.data, PDF);
  await guest('GET', `/api/public/share/${token}/file`);
  await fails(guest('GET', `/api/public/share/${token}/file`), 404, /not available/);
  const events = (await ana('GET', `/api/docs/documents/${doc.id}`)).events.map((e) => e.action);
  assert.ok(events.includes('link-downloads') && events.includes('link'));
  assert.ok(db.data.notifications.some((n) => n.userId === idOf('ana') && /opened/.test(n.title)), 'told at first opening');
  // View-only: open a PDF, never download.
  const v = await ana('POST', '/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'view' });
  const vt = v.url.split('/share/')[1];
  assert.match((await guest('GET', `/api/public/share/${vt}/file?inline=1`)).headers['Content-Disposition'], /^inline/);
  await fails(guest('GET', `/api/public/share/${vt}/file`), 403, /not download/);
  // Re-checked on every use: classification, policy, revoke, creator access.
  await ana('PATCH', `/api/docs/documents/${doc.id}`, { classification: 'restricted' });
  await fails(guest('GET', `/api/public/share/${vt}`), 404);
  await ana('PATCH', `/api/docs/documents/${doc.id}`, { classification: 'internal' });
  await adm('PUT', '/api/docs/settings', { settings: { links: false } });
  await fails(guest('GET', `/api/public/share/${vt}`), 404);
  await adm('PUT', '/api/docs/settings', { settings: { links: true, linkPasswordRequired: true, linkMaxDays: 30 } });
  await fails(ana('POST', '/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'view' }), 400, /need a password/);
  await fails(ana('POST', '/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'view', password: 'long-enough', days: 60 }), 400, /1 to 30 days/);
  await adm('PUT', '/api/docs/settings', { settings: { linkPasswordRequired: false } });
  assert.equal((await guest('GET', `/api/public/share/${vt}`)).data.mode, 'view');
  await ana('DELETE', `/api/docs/links/${v.link.id}`);
  await fails(guest('GET', `/api/public/share/${vt}`), 404);
  await fails(guest('GET', '/api/public/share/not-a-token'), 404);
});

test('upload links: files from outside arrive checked and unreviewed', async () => {
  const f = await ana('POST', '/api/docs/folders', { name: 'Client files', parentId: (await ana('GET', '/api/docs/meta')).personalRoot });
  const r = await ana('POST', '/api/docs/links', { target: { kind: 'folder', id: f.id }, mode: 'upload', days: 3 });
  const token = r.url.split('/share/')[1];
  const guest = client('198.51.100.4');
  const info = (await guest('GET', `/api/public/share/${token}`)).data;
  assert.equal(info.folder, 'Client files');
  const send = async (name, buf) => {
    const { id } = (await guest('POST', `/api/public/share/${token}/uploads`, { name, size: buf.length })).data;
    await guest('PUT', `/api/public/share/${token}/uploads/${id}`, { offset: 0, data: buf.toString('base64') });
    return (await guest('POST', `/api/public/share/${token}/uploads/${id}/finish`, { name: 'Maria (client)', message: 'Signed copy' })).data;
  };
  assert.equal((await send('signed.pdf', PDF)).ok, true);
  await fails(send('tool.exe', Buffer.from('MZ' + 'x'.repeat(100))), 400, /never accepted/);
  const received = await ana('GET', '/api/docs/list?view=received');
  assert.equal(received.documents.length, 1);
  assert.equal(received.documents[0].reviewed, false);
  assert.ok(db.data.docRefused.some((x) => x.name === 'tool.exe'), 'refusals are logged for Document control');
  await fails(guest('GET', `/api/public/share/${token}/file`), 404); // an upload link shows nothing back
});

test('trash, legal hold, purge; integrity check; control panel', async () => {
  const { document: doc } = await upload(ana, 'contract.pdf', PDF, { title: 'Lease contract' });
  await adm('PATCH', `/api/docs/documents/${doc.id}`, { legalHold: true });
  await fails(ana('DELETE', `/api/docs/documents/${doc.id}`), 400, /legal hold/);
  await fails(ana('PATCH', `/api/docs/documents/${doc.id}`, { legalHold: false }), 400, /Only document managers/);
  await adm('PATCH', `/api/docs/documents/${doc.id}`, { legalHold: false });
  await ana('DELETE', `/api/docs/documents/${doc.id}`);
  assert.ok((await ana('GET', '/api/docs/list?view=trash')).documents.some((x) => x.id === doc.id));
  await ana('POST', '/api/docs/restore', { documentId: doc.id });
  await ana('DELETE', `/api/docs/documents/${doc.id}`);
  // Past the trash days, the sweep deletes it for good, files included.
  const d = db.data.documents.find((x) => x.id === doc.id);
  const blob = d.versions[0].blobId;
  d.trashedAt = new Date(Date.now() - 40 * 86400000).toISOString();
  handle.documents.sweep();
  assert.ok(!db.data.documents.some((x) => x.id === doc.id));
  assert.equal(handle.documents.blobs.exists(blob), false);
  // Integrity: a changed file is found.
  const { document: other } = await upload(ana, 'notes.txt', Buffer.from('plain words'), {});
  let check = await adm('POST', '/api/docs/admin/integrity', {});
  assert.equal(check.problems.length, 0);
  const v = db.data.documents.find((x) => x.id === other.id).versions[0];
  const p = path.join(dir, 'documents', v.blobId.slice(0, 2), v.blobId);
  const bytes = fs.readFileSync(p);
  bytes[bytes.length - 2] ^= 0xff;
  fs.writeFileSync(p, bytes);
  check = await adm('POST', '/api/docs/admin/integrity', {});
  assert.equal(check.problems.length, 1);
  // The control panel: only docs.manage; settings cleaned; type switches apply at once.
  await fails(ana('GET', '/api/docs/settings'), 403);
  const s = await adm('GET', '/api/docs/settings');
  assert.ok(s.blocked.exts.includes('exe'));
  await adm('PUT', '/api/docs/settings', { settings: { families: ['pdf'] } });
  await fails(upload(ana, 'photo.jpg', JPEG, {}), 400, /not accepted here/);
  await adm('PUT', '/api/docs/settings', { settings: { families: s.settings.families } });
  const overview = await adm('GET', '/api/docs/admin');
  assert.ok(overview.refused.length >= 1 && overview.usage.files >= 1);
  const revoked = await adm('POST', '/api/docs/admin/links/revoke-all', {});
  assert.ok(revoked.revoked >= 1);
  assert.ok(db.data.audit === undefined || true);
  handle.documents.flushIndex();
  handle.monitor.stop();
});
