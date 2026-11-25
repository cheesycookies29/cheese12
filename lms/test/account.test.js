// Your own account, after CORE ERP's (docs/account-profile.md): My profile, the title administrators
// give, profile pictures (checked by content, served safely, tidied after restore and deletion),
// where you are signed in, and Quick access's pinned pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup } from './support.js';
import { openDb } from '../server/db.js';
import { cleanTitle, cleanQuickLinks, sniffImage, AVATAR_MAX } from '../server/account.js';

const PW = 'password123';
const status = (code) => (e) => e.status === code;
// The smallest pictures of each kind (their first bytes are what the server checks).
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40, 1)]);
const JPEG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(40, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(40, 3)]);
const file = (buf, name = 'me.png') => ({ file: { name, data: buf.toString('base64') } });

async function school(env = setup()) {
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const make = async (role, username, extra = {}) => {
    // Students, teachers and parents are made in the Admin panel; staff in Users & Access.
    const where = ['student', 'teacher', 'guardian'].includes(role) ? '/api/admin/users' : '/api/system/users';
    const u = await admin.post(where, { role, username, name: `${username} Name`, password: PW, mustChangePassword: false, campusIds: [env.db.data.campuses[0].id], ...extra });
    return u;
  };
  const signIn = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: PW });
    return c;
  };
  return { env, admin, make, signIn };
}

test('title and quick links: what is accepted', () => {
  assert.equal(cleanTitle('  University\n  Registrar '), 'University Registrar');
  assert.equal(cleanTitle(''), null);
  assert.throws(() => cleanTitle('x'.repeat(81)), status(400));
  assert.throws(() => cleanTitle(5), status(400));
  assert.deepEqual(cleanQuickLinks([{ href: '/hris/#/me/payslips', label: ' My  payslips ' }, { href: '/hris/#/me/payslips', label: 'Again' }, { href: '/admin#/system/users?q=ana', label: 'Ana' }, { href: '/', label: 'Home' }]), [
    { href: '/hris/#/me/payslips', label: 'My payslips' }, { href: '/admin#/system/users?q=ana', label: 'Ana' }, { href: '/', label: 'Home' },
  ]);
  for (const href of ['javascript:alert(1)', 'https://evil.example/#/x', '//evil.example', '/hris/#/x"><script>', '/other/#/x', '#/profile']) {
    assert.throws(() => cleanQuickLinks([{ href, label: 'x' }]), status(400), href);
  }
  assert.throws(() => cleanQuickLinks([{ href: '/', label: '' }]), status(400));
  assert.throws(() => cleanQuickLinks(Array.from({ length: 13 }, (_, i) => ({ href: `/lms/#/p${i}`, label: `P${i}` }))), status(400));
  assert.throws(() => cleanQuickLinks('nope'), status(400));
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(WEBP), 'image/webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
});

test('My profile: your own account in any system; the school part by account type', async () => {
  const { env, admin, make, signIn } = await school();
  const prog = await admin.post('/api/admin/programs', { code: 'BSIT', name: 'Information Technology' }).catch(() => null);
  await make('student', 'stud', { programId: prog?.id, yearLevel: 2, studentNo: '2026-0001' });
  await make('teacher', 'teach', { department: 'Computing', employeeNo: 'T-1' });
  await make('hr', 'hrperson');
  const student = await signIn('stud');
  const p = await student.get('/api/me/profile');
  assert.equal(p.self, true);
  assert.equal(p.accountTypeLabel, 'Student');
  assert.equal(p.student.studentNo, '2026-0001');
  assert.equal(p.student.yearLevel, 2);
  assert.ok(p.systems.some((s) => s.url === '/lms/'), 'the systems the person can open');
  assert.ok(!('passwordHash' in p) && !JSON.stringify(p).includes('scrypt') && !JSON.stringify(p).includes('enc1$'));
  assert.equal(p.canEditTitle, false);
  // The same from People (an HR account's session) and Learn (a teacher's).
  assert.equal((await (await signIn('hrperson')).get('/api/me/profile')).accountTypeLabel, 'HR Manager');
  assert.equal((await (await signIn('teach')).get('/api/me/profile')).teacher.department, 'Computing');
  await assert.rejects(env.client().get('/api/me/profile'), status(401));
  // Someone else's profile: administrators only.
  const sid = env.db.data.users.find((u) => u.username === 'stud').id;
  await assert.rejects(student.get(`/api/system/users/${env.db.data.users.find((u) => u.username === 'teach').id}/profile`), (e) => [401, 403].includes(e.status));
  const seen = await admin.get(`/api/system/users/${sid}/profile`);
  assert.equal(seen.self, false);
  assert.equal(seen.canEditTitle, true);
});

test('title: given by administrators, cleaned, in the audit log, and shown with the account', async () => {
  const { env, admin, make, signIn } = await school();
  const u = await make('registrar', 'reg');
  const reg = await signIn('reg');
  await assert.rejects(reg.put(`/api/system/users/${u.id}/title`, { title: 'Supreme Leader' }), (e) => [401, 403].includes(e.status));
  assert.deepEqual(await admin.put(`/api/system/users/${u.id}/title`, { title: '  University   Registrar ' }), { title: 'University Registrar' });
  assert.equal((await reg.get('/api/me/profile')).title, 'University Registrar');
  assert.equal((await reg.get('/api/admin/auth/status')).user.title, 'University Registrar', 'the top bar shows it');
  assert.ok((await admin.get('/api/system/users?q=reg')).users[0].title === 'University Registrar');
  const entry = env.api.audit.entries().findLast((e) => e.changes?.some((c) => c.field === 'title'));
  assert.deepEqual(entry.changes[0], { field: 'title', from: '', to: 'University Registrar' });
  await admin.put(`/api/system/users/${u.id}/title`, { title: '' });
  assert.ok(!('title' in env.db.data.users.find((x) => x.id === u.id)), 'empty removes it');
  await assert.rejects(admin.put(`/api/system/users/${u.id}/title`, { title: 'x'.repeat(81) }), status(400));
});

test('pictures: photos only, checked by content, at most 300 KB, served safely to people with a reason to see them', async () => {
  const { env, admin, make, signIn } = await school();
  await make('teacher', 'teach');
  await make('student', 'stud');
  const t = await signIn('teach');
  const tid = env.db.data.users.find((u) => u.username === 'teach').id;
  for (const bad of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), Buffer.from('<html><script>alert(1)</script></html>'), Buffer.from('GIF89a......'), Buffer.from('%PDF-1.7 ......')]) {
    await assert.rejects(t.put('/api/me/avatar', file(bad, 'x.png')), status(400));
  }
  await assert.rejects(t.put('/api/me/avatar', file(Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX)]))), status(400));
  await assert.rejects(t.put('/api/me/avatar', { file: { name: 'x', data: '' } }), status(400));
  for (const pic of [PNG, JPEG, WEBP]) await t.put('/api/me/avatar', file(pic));
  const at = (await t.put('/api/me/avatar', file(PNG))).avatar;
  // The school's employees see it; a student with no class with this teacher does not, and nobody signed out.
  const s = await signIn('stud');
  assert.deepEqual(await s.get('/api/avatars'), {});
  await assert.rejects(s.get(`/api/users/${tid}/avatar`), status(404));
  const img = await admin.get(`/api/users/${tid}/avatar`);
  assert.equal(img.type, 'image/png');
  assert.ok(Buffer.from(img.raw).equals(PNG));
  assert.match(img.headers['Content-Security-Policy'], /sandbox/);
  assert.match(img.headers['Cache-Control'], /private/);
  await assert.rejects(env.client().get(`/api/users/${tid}/avatar`), status(401));
  await assert.rejects(s.get(`/api/users/${env.db.data.users.find((u) => u.username === 'stud').id}/avatar`), status(404));
  // Administrators remove anyone's (in the audit log); others cannot.
  await assert.rejects(s.del(`/api/system/users/${tid}/avatar`), (e) => [401, 403].includes(e.status));
  await admin.del(`/api/system/users/${tid}/avatar`);
  assert.ok(env.api.audit.entries().some((e) => e.action === "Removed an account's picture"));
  assert.deepEqual(await t.get('/api/avatars'), {});
  await t.del('/api/me/avatar'); // nothing to remove: fine
});

test('pictures: yourself, employees, family, classmates and teachers, and whoever is on your bell; never a list of everyone', async () => {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await admin.post('/api/admin/demo');
  const by = (n) => env.db.data.users.find((u) => u.username === n);
  const as = async (username) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password: 'demo1234' });
    return c;
  };
  // Everyone here adds a picture.
  const names = ['teacher.demo', 'lmercado.demo', 'student.demo', 'bea.demo', 'kevin.demo', 'parent.demo', 'registrar.demo'];
  const c = {};
  for (const n of names) {
    c[n] = await as(n);
    await c[n].put('/api/me/avatar', file(PNG));
  }
  const id = (n) => by(n).id;
  const sees = async (viewer, n) => {
    try {
      await c[viewer].get(`/api/users/${id(n)}/avatar`);
      return true;
    } catch (err) {
      assert.equal(err.status, 404, 'someone not to be seen has no picture, as far as the viewer knows');
      return false;
    }
  };
  // student.demo is taught by teacher.demo and shares a class with bea.demo; kevin.demo and lmercado.demo
  // (another teacher) are in none of their classes.
  assert.ok(await sees('student.demo', 'student.demo'));
  assert.ok(await sees('student.demo', 'teacher.demo'));
  assert.ok(await sees('student.demo', 'bea.demo'));
  assert.ok(await sees('teacher.demo', 'student.demo'));
  assert.ok(!(await sees('student.demo', 'kevin.demo')));
  assert.ok(!(await sees('student.demo', 'lmercado.demo')));
  // A parent sees their children, and the children them; not other people's.
  assert.ok(await sees('parent.demo', 'student.demo'));
  assert.ok(await sees('parent.demo', 'kevin.demo'));
  assert.ok(await sees('kevin.demo', 'parent.demo'));
  assert.ok(!(await sees('parent.demo', 'bea.demo')));
  assert.ok(!(await sees('parent.demo', 'teacher.demo')));
  // Employees see everyone's.
  assert.ok(await sees('registrar.demo', 'kevin.demo'));
  assert.ok(await sees('teacher.demo', 'kevin.demo'));
  // Someone who did something you were told about on the bell (the registrar decided an enrollment).
  assert.ok(await sees('student.demo', 'registrar.demo'));
  env.db.data.notifications.push({ id: 'n-share', userId: id('student.demo'), system: 'dms', kind: 'share', title: 'Kevin shared a file with you', body: '', link: '/documents/#/', actorId: id('kevin.demo'), at: new Date().toISOString(), readAt: null });
  assert.ok(await sees('student.demo', 'kevin.demo'));
  // The list has the people the pages show you (yourself, your family, your bell), never everyone's.
  assert.deepEqual(Object.keys(await c['student.demo'].get('/api/avatars')).sort(), ['student.demo', 'parent.demo', 'registrar.demo', 'teacher.demo', 'kevin.demo'].map(id).sort());
  assert.deepEqual(Object.keys(await c['parent.demo'].get('/api/avatars')).sort(), ['parent.demo', 'student.demo', 'kevin.demo'].map(id).sort());
  const staffList = Object.keys(await c['registrar.demo'].get('/api/avatars'));
  assert.ok(staffList.includes(id('registrar.demo')) && !staffList.includes(id('bea.demo')) && !staffList.includes(id('lmercado.demo')));
  assert.deepEqual(Object.keys(await admin.get('/api/avatars')), []);
  // Users & Access gives administrators each account's picture date with the row.
  const rows = await admin.get('/api/system/users?q=kevin.demo');
  assert.ok((rows.users || rows.items || rows).some?.((u) => u.username === 'kevin.demo' && u.avatar));
});

test('picture files: replaced and removed with the account; a restore keeps only pictures this server has', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-avatars-'));
  const { env, admin, make, signIn } = await school(setup({ db: openDb(path.join(dir, 'db.json')) }));
  const folder = path.join(dir, 'avatars');
  await make('teacher', 'teach');
  const t = await signIn('teach');
  await t.put('/api/me/avatar', file(PNG));
  await t.put('/api/me/avatar', file(JPEG));
  assert.equal(fs.readdirSync(folder).length, 1, 'the old file went with the old picture');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(folder, fs.readdirSync(folder)[0])).mode & 0o077, 0, 'readable by ATLAS only');
  // Restore: a picture whose file is here stays; a made-up one (or another type) is dropped.
  const backup = await admin.get('/api/admin/backup');
  const teach = backup.users.find((u) => u.username === 'teach');
  backup.users.push({ ...teach, id: 'ghost-1', username: 'ghost', avatar: { ...teach.avatar, id: '00000000-0000-4000-8000-000000000000' } });
  backup.users.push({ ...teach, id: 'twin-1', username: 'twin', avatar: { ...teach.avatar } });
  backup.users.push({ ...teach, id: 'liar-1', username: 'liar', quickLinks: [{ href: 'javascript:alert(1)', label: 'x' }], title: 'x'.repeat(500) });
  delete backup.users.at(-1).avatar;
  await admin.post('/api/admin/restore', backup);
  const by = (n) => env.db.data.users.find((u) => u.username === n);
  assert.equal(by('teach').avatar.type, 'image/jpeg');
  assert.ok(!by('ghost').avatar, 'no such file here');
  assert.ok(!by('twin').avatar, 'one file belongs to one account');
  assert.ok(!by('liar').quickLinks && !by('liar').title, 'bad pins and titles are dropped too');
  // Deleting the account deletes its picture.
  await admin.del(`/api/system/users/${by('teach').id}`);
  assert.equal(fs.readdirSync(folder).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('where you are signed in: your sessions in every system; sign out one or all the others', async () => {
  const { env, make, signIn } = await school();
  await make('teacher', 'teach');
  const laptop = await signIn('teach');
  const phone = await signIn('teach');
  const list = await laptop.get('/api/me/sessions');
  assert.equal(list.length, 2);
  assert.equal(list.filter((s) => s.current).length, 1);
  assert.ok(list.every((s) => s.side === 'Learn' && s.device && !('token' in s)));
  const mine = list.find((s) => s.current);
  await assert.rejects(laptop.del(`/api/me/sessions/${mine.id}`), status(400), 'not the device in use');
  const other = list.find((s) => !s.current);
  await laptop.del(`/api/me/sessions/${other.id}`);
  await assert.rejects(phone.get('/api/me/profile'), status(401), 'that device is signed out');
  // Sign out everywhere else; another person's sessions are never listed or touched.
  const tablet = await signIn('teach');
  await make('student', 'stud');
  const student = await signIn('stud');
  assert.equal((await student.get('/api/me/sessions')).length, 1);
  await assert.rejects(student.del(`/api/me/sessions/${mine.id}`), status(404));
  assert.deepEqual(await laptop.post('/api/me/sessions/sign-out-others', {}), { signedOut: 1 });
  await assert.rejects(tablet.get('/api/me/profile'), status(401));
  await laptop.get('/api/me/profile');
  assert.ok(env.api.audit.entries().some((e) => e.action === 'Signed out everywhere else'));
});

test('quick access: your pinned pages follow you; only pages in ATLAS; yours alone', async () => {
  const { make, signIn } = await school();
  await make('teacher', 'teach');
  await make('student', 'stud');
  const t = await signIn('teach');
  assert.deepEqual(await t.get('/api/me/quick-links'), { links: [] });
  const links = [{ href: '/lms/#/calendar', label: 'Learn · Calendar' }, { href: '/hris/#/me/payslips', label: 'My payslips' }];
  assert.deepEqual(await t.put('/api/me/quick-links', { links }), { links });
  assert.deepEqual(await (await signIn('teach')).get('/api/me/quick-links'), { links }, 'on another device too');
  assert.deepEqual(await (await signIn('stud')).get('/api/me/quick-links'), { links: [] });
  await assert.rejects(t.put('/api/me/quick-links', { links: [{ href: 'javascript:alert(1)', label: 'x' }] }), status(400));
  await assert.rejects(t.put('/api/me/quick-links', { links: Array.from({ length: 13 }, (_, i) => ({ href: `/lms/#/p${i}`, label: `P${i}` })) }), status(400));
  assert.deepEqual(await t.put('/api/me/quick-links', { links: [] }), { links: [] });
});
