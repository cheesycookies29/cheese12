// ATLAS Documents: the rules that hold however an item is reached. Legal hold holds everything below
// a held folder (moves, versions, the trash and its sweep); docs.manage follows each account's own
// access; link passwords are checked on every use; restricted documents reach named people only;
// download limits count views; search keeps to what the person may download; the Activity list,
// idle uploads, the quota on restored versions, wrong link passwords, repeated share notices and
// the search index written once for a burst of uploads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup } from './support.js';
import { hashPassword } from '../server/auth.js';
import { demoPdf, demoDocx } from '../server/demo.js';

const PW = 'password123';
const PDF = demoPdf('Case notes', ['Hearing on Monday.']);
const DOCX = demoDocx(['Minutes', 'The board approved the dormitory repairs']);
const MIN = 60000;

let now = new Date('2026-08-10T10:00:00');
const env = setup({ clock: () => now });
const admin = env.client();
await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
const campusIds = [(await admin.get('/api/admin/campuses'))[0].id];
const ids = {};
for (const [role, username, name] of [['teacher', 'tess', 'Tess Teacher'], ['teacher', 'tom', 'Tom Teacher'], ['student', 'sam', 'Sam Student'], ['registrar', 'rita', 'Rita Registrar']]) {
  ids[username] = (await admin.post('/api/admin/users', { role, username, name, password: PW, mustChangePassword: false, campusIds })).id;
}
for (const [role, username, name] of [['staff', 'lito', 'Lito Librarian']]) {
  const u = { id: `u-${username}`, role, username, name, status: 'active', passwordHash: hashPassword(PW), mustChangePassword: false, campusIds, createdAt: new Date().toISOString() };
  env.db.data.users.push(u);
  ids[username] = u.id;
}
env.db.data.employees.push({ id: 'e-tess', employeeNo: 'e-tess', firstName: 'Tess', lastName: 'X', department: 'College of Computing', status: 'active', campusId: campusIds[0] });
env.db.data.users.find((u) => u.username === 'tess').employeeId = 'e-tess';
const signIn = async (username) => {
  const c = env.client();
  await c.post('/api/hub/login', { username, password: PW });
  return c;
};
const P = {};
for (const u of Object.keys(ids)) P[u] = await signIn(u);
const docsDir = env.api.documents.dir;
test.after(() => fs.rmSync(docsDir, { recursive: true, force: true }));

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
const tokenOf = (r) => r.url.split('/share/')[1];
const rootOf = async (c) => (await c.get('/api/docs/meta')).personalRoot;

test('legal hold on a folder holds everything below it: no moving out, no lost versions', async () => {
  const f = await admin.post('/api/docs/folders', { name: 'Audit 2026' });
  await admin.put(`/api/docs/folders/${f.id}/access`, { grants: [{ type: 'user', id: ids.tess, level: 'edit' }] });
  const inner = await P.tess.post('/api/docs/folders', { name: 'Receipts', parentId: f.id });
  const { document: doc } = await upload(P.tess, 'ledger.csv', Buffer.from('a,b\n1,2\n'), { folderId: f.id });
  await admin.put(`/api/docs/folders/${f.id}`, { legalHold: true });
  const mine = await rootOf(P.tess);
  await fails(P.tess.del(`/api/docs/documents/${doc.id}`), 400, /legal hold/);
  await fails(P.tess.put(`/api/docs/documents/${doc.id}`, { folderId: mine }), 400, /legal hold/);
  await fails(P.tess.put(`/api/docs/folders/${inner.id}`, { parentId: mine }), 400, /legal hold/);
  // Inside the held folder, things can still be arranged.
  assert.equal((await P.tess.put(`/api/docs/documents/${doc.id}`, { folderId: inner.id })).folderId, inner.id);
  // New versions never push old ones out while the document is held (here through its folder).
  await admin.put('/api/docs/settings', { settings: { versionsKept: 2 } });
  for (let i = 2; i <= 4; i++) await upload(P.tess, 'ledger.csv', Buffer.from(`a,b\n${i},2\n`), { documentId: doc.id });
  assert.deepEqual((await P.tess.get(`/api/docs/documents/${doc.id}`)).versionList.map((v) => v.no), [4, 3, 2, 1]);
  // Once the hold is lifted, the usual number of versions is kept again.
  await admin.put(`/api/docs/folders/${f.id}`, { legalHold: false });
  await upload(P.tess, 'ledger.csv', Buffer.from('a,b\n5,2\n'), { documentId: doc.id });
  assert.deepEqual((await P.tess.get(`/api/docs/documents/${doc.id}`)).versionList.map((v) => v.no), [5, 4]);
  await admin.put('/api/docs/settings', { settings: { versionsKept: 20 } });
});

test('legal hold below a folder: the folder above cannot be trashed, and the trash never empties it', async () => {
  const top = await admin.post('/api/docs/folders', { name: 'Case files' });
  const caseFolder = await admin.post('/api/docs/folders', { name: 'Litigation', parentId: top.id });
  const { document: evidence } = await upload(admin, 'evidence.txt', Buffer.from('evidence'), { folderId: caseFolder.id });
  await admin.put(`/api/docs/folders/${caseFolder.id}`, { legalHold: true });
  await fails(admin.del(`/api/docs/folders/${caseFolder.id}`), 400, /legal hold/);
  await fails(admin.del(`/api/docs/folders/${top.id}`), 400, /legal hold/);
  // A folder already in the trash when something inside it was put on hold is kept by the sweep.
  const other = await admin.post('/api/docs/folders', { name: 'Old cases' });
  const deep = await admin.post('/api/docs/folders', { name: 'Case 7', parentId: other.id });
  const { document: memo } = await upload(admin, 'memo.txt', Buffer.from('memo'), { folderId: deep.id });
  await admin.put(`/api/docs/documents/${memo.id}`, { legalHold: true });
  await fails(admin.del(`/api/docs/folders/${other.id}`), 400, /legal hold/);
  env.db.data.docFolders.find((x) => x.id === other.id).trashedAt = now.toISOString();
  env.db.data.docFolders.find((x) => x.id === top.id).trashedAt = now.toISOString();
  const was = now;
  now = new Date(was.getTime() + 40 * 86400000);
  try {
    env.api.documents.sweep();
  } finally {
    now = was;
  }
  for (const id of [evidence.id, memo.id]) assert.ok(env.db.data.documents.some((d) => d.id === id), 'held documents stay');
  for (const id of [caseFolder.id, deep.id, top.id, other.id]) assert.ok(env.db.data.docFolders.some((x) => x.id === id), 'and the folders around them');
});

test('docs.manage follows each account\'s own access, as every other permission', async () => {
  const { document: quiz } = await upload(P.tess, 'Quiz bank.txt', Buffer.from('Question 1'), { classification: 'confidential' });
  const roles = await admin.get('/api/admin/roles');
  await admin.put('/api/admin/roles', { permissions: { registrar: [...roles.roles.find((r) => r.id === 'registrar').permissions, 'docs.manage'] } });
  P.rita = await signIn('rita');
  assert.equal((await P.rita.get(`/api/docs/documents/${quiz.id}`)).level, 'manage', 'given to the account type');
  // Taken from this one account: no settings, and no manager's reach into other people's files.
  const keep = (await admin.get('/api/admin/roles')).roles.find((r) => r.id === 'registrar').permissions.filter((p) => p !== 'docs.manage');
  await admin.put(`/api/system/users/${ids.rita}/access`, { permissions: keep });
  P.rita = await signIn('rita');
  await fails(P.rita.get('/api/docs/settings'), 403);
  assert.equal((await P.rita.get('/api/docs/meta')).manager, false);
  await fails(P.rita.get(`/api/docs/documents/${quiz.id}`), 404);
  await fails(P.rita.get(`/api/docs/documents/${quiz.id}/file`), 404);
  await fails(P.rita.put(`/api/docs/documents/${quiz.id}`, { legalHold: true }), 404);
  await admin.put(`/api/system/users/${ids.rita}/access`, { permissions: [...keep, 'docs.manage'] });
  await admin.post('/api/admin/config/reset', { area: 'roles' });
  // Given to one staff account only: the whole of a manager's rights, not only the settings.
  await admin.put(`/api/system/users/${ids.lito}/access`, { permissions: ['docs.manage'] });
  P.lito = await signIn('lito');
  assert.equal((await P.lito.get('/api/docs/meta')).manager, true);
  assert.ok((await P.lito.get('/api/docs/settings')).settings);
  assert.equal((await P.lito.get(`/api/docs/documents/${quiz.id}`)).level, 'manage');
  await admin.put(`/api/system/users/${ids.lito}/access`, { permissions: [] });
  P.lito = await signIn('lito');
  await fails(P.lito.get(`/api/docs/documents/${quiz.id}`), 404);
});

test('link passwords are checked on every use: folder links, reclassified documents, a later rule', async () => {
  const guest = env.client();
  // A folder link without a password leaves the confidential documents out.
  const f = await P.tess.post('/api/docs/folders', { name: 'Payroll working files', parentId: await rootOf(P.tess) });
  const { document: salaries } = await upload(P.tess, 'salaries.csv', Buffer.from('name,pay\nA,1\n'), { folderId: f.id, classification: 'confidential' });
  const { document: memo } = await upload(P.tess, 'memo.pdf', PDF, { folderId: f.id });
  const open = tokenOf(await P.tess.post('/api/docs/links', { target: { kind: 'folder', id: f.id }, mode: 'download' }));
  assert.deepEqual((await guest.get(`/api/public/share/${open}`)).documents.map((d) => d.id), [memo.id]);
  await fails(guest.get(`/api/public/share/${open}/file?doc=${salaries.id}`), 404, /not available/);
  // With a password, the folder link serves them.
  const locked = tokenOf(await P.tess.post('/api/docs/links', { target: { kind: 'folder', id: f.id }, mode: 'download', password: 'payroll-2026' }));
  await guest.post(`/api/public/share/${locked}/unlock`, { password: 'payroll-2026' });
  assert.equal((await guest.get(`/api/public/share/${locked}`)).documents.length, 2);
  // A document link made while it was internal stops when it becomes confidential.
  const { document: plan } = await upload(P.tess, 'plan.pdf', PDF);
  const link = await P.tess.post('/api/docs/links', { target: { kind: 'document', id: plan.id }, mode: 'download' });
  const t = tokenOf(link);
  assert.equal((await guest.get(`/api/public/share/${t}`)).documents.length, 1);
  await P.tess.put(`/api/docs/documents/${plan.id}`, { classification: 'confidential' });
  await fails(guest.get(`/api/public/share/${t}`), 404);
  await fails(guest.get(`/api/public/share/${t}/file`), 404);
  assert.equal((await P.tess.get('/api/docs/links')).links.find((l) => l.id === link.link.id).state, 'password');
  await P.tess.put(`/api/docs/documents/${plan.id}`, { classification: 'internal' });
  assert.equal((await guest.get(`/api/public/share/${t}`)).documents.length, 1);
  // Links that need a password from Document control: those made before without one stop too.
  await admin.put('/api/docs/settings', { settings: { linkPasswordRequired: true } });
  try {
    await fails(guest.get(`/api/public/share/${t}`), 404);
    await fails(guest.get(`/api/public/share/${open}`), 404);
    assert.equal((await guest.get(`/api/public/share/${locked}`)).documents.length, 2, 'links with a password go on working');
  } finally {
    await admin.put('/api/docs/settings', { settings: { linkPasswordRequired: false } });
  }
  assert.equal((await guest.get(`/api/public/share/${t}`)).documents.length, 1);
});

test('restricted documents reach named people only: not groups, and not the grants of their folder', async () => {
  const f = await admin.post('/api/docs/folders', { name: 'School policies (all)' });
  await admin.put(`/api/docs/folders/${f.id}/access`, { grants: [{ type: 'everyone', id: '*', level: 'view' }, { type: 'user', id: ids.tom, level: 'manage' }] });
  const { document: cases } = await upload(admin, 'disciplinary-cases.txt', Buffer.from('Case 1: pin 4417'), { folderId: f.id, classification: 'restricted' });
  const { document: open } = await upload(admin, 'handbook.pdf', PDF, { folderId: f.id });
  assert.equal((await P.sam.get(`/api/docs/documents/${open.id}`)).level, 'view', 'the folder\'s grants reach its other documents');
  await fails(P.sam.get(`/api/docs/documents/${cases.id}`), 404);
  await fails(P.tom.get(`/api/docs/documents/${cases.id}`), 404, /not there/);
  assert.ok(!(await P.sam.get(`/api/docs/list?folder=${f.id}`)).documents.some((d) => d.id === cases.id));
  assert.ok(!(await P.sam.get('/api/docs/list?view=search&q=disciplinary')).documents.length);
  for (const g of [{ type: 'role', id: 'student', level: 'view' }, { type: 'department', id: 'College of Computing', level: 'view' }, { type: 'everyone', id: '*', level: 'view' }]) {
    await fails(admin.put(`/api/docs/documents/${cases.id}/access`, { grants: [g] }), 400, /named people only/);
  }
  // Named on the document: its details, but not its file, which only those who manage it get.
  await admin.put(`/api/docs/documents/${cases.id}/access`, { grants: [{ type: 'user', id: ids.sam, level: 'view' }] });
  const seen = await P.sam.get(`/api/docs/documents/${cases.id}`);
  assert.deepEqual([seen.level, seen.canDownload, seen.canOpen], ['view', false, false]);
  await fails(P.sam.get(`/api/docs/documents/${cases.id}/file`), 403, /Restricted/);
  // A document shared with a group cannot become restricted until the group is taken off.
  const { document: minutes } = await upload(admin, 'minutes.pdf', PDF, { folderId: f.id });
  await admin.put(`/api/docs/documents/${minutes.id}/access`, { grants: [{ type: 'role', id: 'teacher', level: 'view' }] });
  await fails(admin.put(`/api/docs/documents/${minutes.id}`, { classification: 'restricted' }), 400, /named people only/);
  await admin.put(`/api/docs/documents/${minutes.id}/access`, { grants: [] });
  assert.equal((await admin.put(`/api/docs/documents/${minutes.id}`, { classification: 'restricted' })).classification, 'restricted');
});

test('download limits count views; search keeps to the words of files the person may download', async () => {
  const guest = env.client();
  const { document: doc } = await upload(P.tess, 'Quote.pdf', PDF, { title: 'Supplier quote' });
  const t = tokenOf(await P.tess.post('/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'download', maxDownloads: 2 }));
  assert.equal((await guest.get(`/api/public/share/${t}/file?inline=1`)).headers['Content-Disposition'].split(';')[0], 'inline');
  assert.equal((await guest.get(`/api/public/share/${t}`)).downloadsLeft, 1);
  await guest.get(`/api/public/share/${t}/file`);
  await fails(guest.get(`/api/public/share/${t}/file?inline=1`), 404, /not available/);
  await fails(guest.get(`/api/public/share/${t}/file`), 404, /not available/);
  // A person who may view but not download a file does not find it by the words inside it.
  const { document: answers } = await upload(P.tess, 'exam-answers.docx', DOCX, { title: 'Exam key' });
  await P.tess.put(`/api/docs/documents/${answers.id}/access`, { grants: [{ type: 'user', id: ids.tom, level: 'view', download: false }] });
  assert.ok(!(await P.tom.get('/api/docs/list?view=search&q=dormitory')).documents.some((d) => d.id === answers.id));
  assert.ok((await P.tom.get('/api/docs/list?view=search&q=exam key')).documents.some((d) => d.id === answers.id), 'still found by its title');
  await P.tess.put(`/api/docs/documents/${answers.id}/access`, { grants: [{ type: 'user', id: ids.tom, level: 'view' }] });
  assert.ok((await P.tom.get('/api/docs/list?view=search&q=dormitory')).documents.some((d) => d.id === answers.id));
});

test('the Activity list shows who else has access only to those who manage the document', async () => {
  const { document: doc } = await upload(P.tess, 'Board minutes.pdf', PDF);
  await P.tess.put(`/api/docs/documents/${doc.id}/access`, { grants: [{ type: 'user', id: ids.tom, level: 'view' }, { type: 'user', id: ids.lito, level: 'view', download: false }] });
  const forTom = await P.tom.get(`/api/docs/documents/${doc.id}`);
  assert.equal(forTom.acl, undefined);
  const access = forTom.events.filter((e) => e.action === 'access');
  assert.ok(access.length && access.every((e) => e.note === ''));
  assert.match((await P.tess.get(`/api/docs/documents/${doc.id}`)).events.find((e) => e.action === 'access').note, /Lito Librarian/);
});

test('unfinished uploads stop holding a place after a few idle minutes', async () => {
  for (let i = 0; i < 8; i++) await P.tom.post('/api/docs/uploads', { name: `big-${i}.pdf`, size: 1000 });
  await fails(P.tom.post('/api/docs/uploads', { name: 'next.pdf', size: 1000 }), 400, /Wait for the files/);
  const was = now;
  now = new Date(was.getTime() + 6 * MIN);
  try {
    assert.ok((await P.tom.post('/api/docs/uploads', { name: 'next.pdf', size: 1000 })).id);
  } finally {
    now = was;
  }
});

test('restoring an old version counts against the storage each person may keep', async () => {
  const big = Buffer.concat([Buffer.from('a,b\n'), Buffer.alloc(700 * 1024, 'x,y\n')]);
  const { document: doc } = await upload(P.lito, 'inventory.csv', big);
  await upload(P.lito, 'inventory.csv', Buffer.from('a,b\n1,2\n'), { documentId: doc.id });
  await admin.put('/api/docs/settings', { settings: { quotaMB: 1 } });
  try {
    await fails(P.lito.post(`/api/docs/documents/${doc.id}/restore-version`, { no: 1 }), 400, /over the 1 MB/);
    assert.equal((await P.lito.get(`/api/docs/documents/${doc.id}`)).versions, 2);
  } finally {
    await admin.put('/api/docs/settings', { settings: { quotaMB: 2048 } });
  }
  assert.equal((await P.lito.post(`/api/docs/documents/${doc.id}/restore-version`, { no: 1 })).version, 3);
});

test('wrong link passwords: limited before the check, and the data file is not rewritten for each', async () => {
  const { document: doc } = await upload(P.tess, 'Contract.pdf', PDF);
  const t = tokenOf(await P.tess.post('/api/docs/links', { target: { kind: 'document', id: doc.id }, mode: 'view', password: 'right-password' }));
  const guest = env.client();
  const save = env.db.save;
  let saves = 0;
  env.db.save = (...a) => {
    saves++;
    return save.apply(env.db, a);
  };
  try {
    for (let i = 0; i < 3; i++) await fails(guest.post(`/api/public/share/${t}/unlock`, { password: `guess-${i}` }), 400, /not right/);
  } finally {
    env.db.save = save;
  }
  assert.equal(saves, 0);
  const wrong = (await P.tess.get(`/api/docs/documents/${doc.id}`)).events.filter((e) => e.action === 'link-password-wrong');
  assert.equal(wrong.length, 1, 'one entry for a run of wrong passwords');
  for (let i = 3; i < 10; i++) await fails(guest.post(`/api/public/share/${t}/unlock`, { password: `guess-${i}` }), 400);
  await fails(guest.post(`/api/public/share/${t}/unlock`, { password: 'right-password' }), 429, /Too many wrong passwords/);
});

test('shared again with the same person soon after: one notification, not one each time', async () => {
  const { document: doc } = await upload(P.sam, 'Essay.docx', DOCX, { title: 'Essay draft' });
  const told = async () => (await P.tess.get('/api/me/notifications')).items.filter((n) => n.kind === 'docs-shared' && n.link === `/documents/#/doc/${doc.id}`).length;
  for (let i = 0; i < 3; i++) {
    await P.sam.put(`/api/docs/documents/${doc.id}/access`, { grants: [] });
    await P.sam.put(`/api/docs/documents/${doc.id}/access`, { grants: [{ type: 'user', id: ids.tess, level: 'view' }] });
  }
  assert.equal(await told(), 1);
  const was = now;
  now = new Date(was.getTime() + 2 * 60 * MIN);
  try {
    await P.sam.put(`/api/docs/documents/${doc.id}/access`, { grants: [] });
    await P.sam.put(`/api/docs/documents/${doc.id}/access`, { grants: [{ type: 'user', id: ids.tess, level: 'view' }] });
    assert.equal(await told(), 2, 'told again later');
  } finally {
    now = was;
  }
});

test('a burst of uploads writes the search index once', async () => {
  env.api.documents.flushIndex();
  const before = env.db.data.docIndexBlob;
  for (let i = 0; i < 4; i++) await upload(admin, `notes-${i}.txt`, Buffer.from(`burst words ${i}`));
  assert.equal(env.db.data.docIndexBlob, before, 'not written for each upload');
  env.api.documents.flushIndex();
  assert.notEqual(env.db.data.docIndexBlob, before);
  assert.equal((await admin.get('/api/docs/list?view=search&q=burst')).documents.length, 4);
});
