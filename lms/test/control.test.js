// ATLAS Control (/control/): administrators only; every account in one list with its actions;
// sessions and locked sign-ins; the access map; and the audit trail (sign-ins, failed sign-ins,
// changes and refusals in every system, with the Settings, Finance and Academic logs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup, seed } from './support.js';
import { memoryDb } from '../server/db.js';

const PW = 'password123';

async function school() {
  const env = setup();
  const s = await seed(env);
  const mk = (role, username, extra = {}) => s.admin.post('/api/admin/users', { role, username, name: username, password: PW, mustChangePassword: false, ...extra });
  const reg = await mk('registrar', 'rosa', { email: 'rosa@school.edu' });
  const signIn = async (username, password = PW) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password });
    return c;
  };
  return { ...s, env, reg, signIn, trail: () => env.api.audit.entries() };
}

test('Control is for administrators only, and only they see it on the ATLAS home page', async () => {
  const f = await school();
  const ov = await f.admin.get('/api/control/overview');
  assert.ok(ov.accounts.total >= 7);
  assert.ok(ov.checks.some((c) => c.id === 'admins' && !c.ok), 'one administrator is flagged');
  // A registrar has an admin-panel session, but Control is for administrators, even with the settings permission.
  await f.admin.put('/api/admin/roles', { overrides: { registrar: { add: ['settings.edit'] } } });
  const reg = await f.signIn('rosa');
  await assert.rejects(reg.get('/api/control/overview'), (e) => e.status === 403);
  await assert.rejects(reg.get('/api/control/users'), (e) => e.status === 403);
  const st = await reg.get('/api/control/auth/status');
  assert.deepEqual([st.user, st.deniedUser.name], [null, 'rosa']);
  // Teachers and students have no admin-panel session at all.
  const t = await f.signIn('teach1');
  await assert.rejects(t.get('/api/control/overview'), (e) => e.status === 401);
  // The ATLAS home page: the Control tile for administrators only, and not before signing in.
  const tiles = async (c) => (await c.get('/api/hub/status')).systems.map((x) => x.id);
  assert.ok((await tiles(f.admin)).includes('control'));
  assert.equal((await f.admin.get('/api/hub/status')).systems.find((x) => x.id === 'control').url, '/control/');
  assert.equal((await tiles(reg)).includes('control'), false);
  assert.equal((await tiles(t)).includes('control'), false);
  assert.equal((await tiles(f.env.client())).includes('control'), false);
  // The refusals are in the audit trail.
  const refused = f.trail().filter((e) => e.outcome === 'refused' && e.actorId === f.reg.id);
  assert.ok(refused.length >= 2);
  assert.match(refused[0].detail, /\/api\/control\/overview/);
});

test('the audit trail has sign-ins, failed sign-ins and changes, and never a password', async () => {
  const f = await school();
  await f.signIn('rosa');
  const ok = f.trail().filter((e) => e.kind === 'signin' && e.outcome === 'ok' && e.actorId === f.reg.id);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].action, 'Signed in');
  // Wrong passwords: for a real account the account is named; a made-up username is not written down.
  await assert.rejects(f.env.client().post('/api/hub/login', { username: 'rosa', password: 'wrong-pass' }), /Incorrect/);
  await assert.rejects(f.env.client().post('/api/hub/login', { username: 'Secret-Pass-99', password: 'x' }), /Incorrect/);
  const failed = f.trail().filter((e) => e.kind === 'signin' && e.outcome === 'failed');
  assert.deepEqual(failed.map((e) => [e.action, e.targetId, e.target]), [
    ['Sign-in failed: wrong password', f.reg.id, 'rosa'],
    ['Sign-in failed: no such account', null, '(unknown username)'],
  ]);
  assert.equal(JSON.stringify(f.trail()).toLowerCase().includes('secret-pass-99'), false);
  // A disabled account is refused, and says so in the trail.
  const t = (await f.admin.get('/api/control/users?q=teach2')).users[0];
  await f.admin.put(`/api/control/users/${t.id}`, { status: 'disabled' });
  await assert.rejects(f.env.client().post('/api/hub/login', { username: 'teach2', password: PW }), /disabled/);
  assert.equal(f.trail().at(-1).action, 'Sign-in refused: account disabled');
  // A change by staff, anywhere: who, what and about which record.
  await f.admin.post('/api/admin/courses', { code: 'HIST', title: 'History', units: 3 });
  const added = f.trail().at(-1);
  assert.deepEqual([added.kind, added.action, added.actor, added.system], ['change', 'Added · courses', 'Ada Admin', 'admin']);
  await f.admin.post(`/api/admin/users/${t.id}/reset-password`, { password: 'another-pass-1' });
  assert.deepEqual([f.trail().at(-1).action, f.trail().at(-1).target], ['Reset password · users', 'teach2']);
  // A settings change is in the Settings history (with its old and new value), not twice.
  const before = f.trail().length;
  await f.admin.put('/api/admin/settings', { security: { minPasswordLength: 10 } });
  assert.equal(f.trail().length, before, 'the Settings history has it');
  const view = await f.admin.get('/api/control/audit?source=settings');
  assert.match(view.entries[0].action, /Changed Sign-in and passwords/);
  assert.deepEqual(view.entries[0].changes, [{ field: 'Shortest password', from: '8', to: '10' }]);
  // Changing one's own password, and signing out.
  const rosa = await f.signIn('rosa');
  await rosa.post('/api/admin/auth/change-password', { currentPassword: PW, newPassword: 'rosa-new-pass-2' });
  await rosa.post('/api/hub/logout');
  assert.deepEqual(f.trail().slice(-2).map((e) => e.action), ['Changed their password', 'Signed out']);
  // No password or hash, ever.
  const all = JSON.stringify(f.trail());
  for (const p of [PW, 'wrong-pass', 'another-pass-1', 'rosa-new-pass-2', 'scrypt$', 'enc1$']) assert.equal(all.includes(p), false, p);
});

test('the combined trail filters, pages and exports to a safe CSV', async () => {
  const f = await school();
  await assert.rejects(f.env.client().post('/api/hub/login', { username: 'rosa', password: 'nope' }));
  await f.signIn('rosa');
  const failed = await f.admin.get('/api/control/audit?kind=signin&outcome=failed');
  assert.equal(failed.total, 1);
  const forRosa = await f.admin.get(`/api/control/audit?userId=${f.reg.id}`);
  assert.equal(forRosa.user.name, 'rosa');
  assert.ok(forRosa.entries.every((e) => e.actorId === f.reg.id || e.targetId === f.reg.id));
  assert.ok(forRosa.entries.some((e) => /Made a|Added · users/.test(e.action)), 'the account being made is about rosa');
  const q = await f.admin.get('/api/control/audit?q=wrong%20password');
  assert.equal(q.total, 1);
  // Paging: 50 a page, newest first.
  for (let i = 0; i < 60; i++) await f.admin.post('/api/admin/courses', { code: `C${i}`, title: `Course ${i}`, units: 1 });
  const p1 = await f.admin.get('/api/control/audit?kind=change');
  const p2 = await f.admin.get('/api/control/audit?kind=change&page=2');
  assert.deepEqual([p1.entries.length, p1.pages, p2.page], [50, Math.ceil(p1.total / 50), 2]);
  assert.ok(p1.entries[0].at >= p1.entries.at(-1).at);
  // CSV: one row per entry, and a name that looks like a formula is made text.
  await f.admin.post('/api/control/users', { role: 'staff', username: 'formula', name: '=HYPERLINK("x")', password: PW, campusIds: [f.env.db.data.campuses[0].id] });
  const csv = await f.admin.get('/api/control/audit?format=csv&kind=account');
  assert.equal(csv.type, 'text/csv');
  assert.match(csv.headers['Content-Disposition'], /atlas-audit-trail-\d{4}-\d{2}-\d{2}\.csv/);
  assert.match(csv.raw, /"'=HYPERLINK\(""x""\)"/);
});

test('accounts: one list for every system, staff accounts made here, and the rules on changing them', async () => {
  const f = await school();
  const campus = f.env.db.data.campuses[0].id;
  const all = await f.admin.get('/api/control/users');
  assert.equal(all.total, f.env.db.data.users.length);
  assert.ok(all.users.every((u) => !('passwordHash' in u) && !('ssoSubject' in u) && !('calendarToken' in u)));
  assert.deepEqual((await f.admin.get('/api/control/users?role=student')).users.map((u) => u.username).sort(), ['stud1', 'stud2', 'stud3']);
  // Staff accounts of any type; students and parents are the registrar's.
  const hr = await f.admin.post('/api/control/users', { role: 'hr', username: 'hana', name: 'Hana Cruz', password: PW, campusIds: [campus], mustChangePassword: false });
  assert.equal(hr.role, 'hr');
  await assert.rejects(f.admin.post('/api/control/users', { role: 'student', username: 'kid', name: 'Kid', password: PW, campusIds: [campus] }), /Admin panel/);
  await assert.rejects(f.admin.post('/api/control/users', { role: 'cashier', username: 'nocampus', name: 'No Campus', password: PW }), /campus/);
  // Changing the account type ends its sessions (it signs in elsewhere, with other permissions).
  const rosa = await f.signIn('rosa');
  const d = await f.admin.put(`/api/control/users/${f.reg.id}`, { role: 'dean' });
  assert.equal(d.role, 'dean');
  await assert.rejects(rosa.get('/api/admin/dashboard'), (e) => e.status === 401);
  assert.deepEqual(f.trail().at(-1).changes, [{ field: 'account type', from: 'Registrar', to: 'Dean / Program chair' }]);
  // Guards: not your own type, not the last administrator, not a teacher who still has sections, not a student.
  const me = f.env.db.data.users.find((u) => u.username === 'admin');
  await assert.rejects(f.admin.put(`/api/control/users/${me.id}`, { role: 'registrar' }), /your own account type/);
  await assert.rejects(f.admin.put(`/api/control/users/${me.id}`, { status: 'disabled' }), /your own account/);
  await assert.rejects(f.admin.put(`/api/control/users/${f.teachers.t1.id}`, { role: 'staff' }), /has sections/);
  await assert.rejects(f.admin.put(`/api/control/users/${f.students.s1.id}`, { role: 'staff' }), /keep their account type/);
  const second = await f.admin.post('/api/control/users', { role: 'admin', username: 'admin2', name: 'Second Admin', password: PW, mustChangePassword: false });
  assert.deepEqual(second.campusIds, [], 'administrators reach every campus');
  await f.admin.put(`/api/control/users/${second.id}`, { status: 'disabled' });
  // Campuses and names.
  const moved = await f.admin.put(`/api/control/users/${hr.id}`, { name: 'Hana Dela Cruz', campusIds: [campus] });
  assert.equal(moved.name, 'Hana Dela Cruz');
  await assert.rejects(f.admin.put(`/api/control/users/${hr.id}`, { username: 'rosa' }), /already taken/);
  // The account page: what it can open, its sessions and its trail.
  const p = await f.admin.get(`/api/control/users/${f.teachers.t1.id}`);
  assert.ok(p.systems.some((s) => s.id === 'lms') && !p.systems.some((s) => s.id === 'control'));
  assert.ok(p.modules.length > 0, 'teachers have Learn modules');
  assert.equal(p.canChangeRole, true);
  assert.equal(p.links.sections > 0, true);
});

test('passwords, sessions, locks and Keycloak links, from Control', async () => {
  const f = await school();
  const rosa = await f.signIn('rosa');
  // Everyone signed in, with their system; ending one session signs that browser out.
  const sessions = await f.admin.get('/api/control/sessions');
  const hers = sessions.find((s) => s.userId === f.reg.id);
  const mine = sessions.find((s) => s.mine);
  assert.ok(hers && mine);
  assert.equal(hers.sideLabel, 'Admin panel');
  assert.equal(JSON.stringify(sessions).includes(f.env.db.data.users[0].passwordHash), false);
  await assert.rejects(f.admin.del(`/api/control/sessions/${mine.id}`), /sign out instead/);
  await f.admin.del(`/api/control/sessions/${hers.id}`);
  await assert.rejects(rosa.get('/api/admin/dashboard'), (e) => e.status === 401);
  // End everyone else's: mine stays.
  const t1 = await f.signIn('teach1');
  const out = await f.admin.post('/api/control/sessions/end-others');
  assert.ok(out.ended >= 1);
  await assert.rejects(t1.get('/api/lms/home').catch((e) => { throw e; }), (e) => e.status === 401 || e.status === 404);
  assert.ok((await f.admin.get('/api/control/sessions')).every((s) => s.mine));
  // Five wrong passwords lock the username on that address; Control lists it and unlocks it.
  for (let i = 0; i < 5; i++) await assert.rejects(f.env.client().post('/api/hub/login', { username: 'rosa', password: 'wrong' }));
  await assert.rejects(f.env.client().post('/api/hub/login', { username: 'rosa', password: PW }), /Too many failed attempts/);
  assert.equal(f.trail().at(-1).action, 'Sign-in refused: username locked');
  const locks = await f.admin.get('/api/control/locks');
  assert.equal(locks[0].username, 'rosa');
  assert.equal((await f.admin.get('/api/control/users?flag=locked')).users[0].username, 'rosa');
  await f.admin.post('/api/control/locks/clear', { key: locks[0].key });
  await f.signIn('rosa');
  // Reset a password: changed at the next sign-in, sessions ended, unlocked.
  const again = await f.signIn('rosa');
  await f.admin.post(`/api/control/users/${f.reg.id}/reset-password`, { password: 'temporary-pass-7' });
  await assert.rejects(again.get('/api/admin/dashboard'), (e) => e.status === 401);
  const fresh = await f.signIn('rosa', 'temporary-pass-7');
  assert.equal((await fresh.get('/api/hub/status')).user.mustChangePassword, true);
  const me = f.env.db.data.users.find((u) => u.username === 'admin');
  await assert.rejects(f.admin.post(`/api/control/users/${me.id}/reset-password`, { password: 'whatever-pass-1' }), /your own password/);
  // Unlink from Keycloak.
  f.env.db.data.users.find((u) => u.id === f.reg.id).ssoSubject = 'https://kc/realms/x|abc';
  assert.equal((await f.admin.get('/api/control/users?flag=sso')).total, 1);
  const unlinked = await f.admin.post(`/api/control/users/${f.reg.id}/unlink-sso`);
  assert.equal(unlinked.sso, false);
  await assert.rejects(f.admin.post(`/api/control/users/${f.reg.id}/unlink-sso`), /not linked/);
  // Each of these is in the trail, done by the administrator, about rosa.
  const done = f.trail().filter((e) => e.system === 'control' && e.targetId === f.reg.id).map((e) => e.action);
  assert.deepEqual(done, ['Ended a session', 'Unlocked a username', 'Reset a password', 'Unlinked an account from Keycloak']);
});

test('the access map: which account types open which systems and modules', async () => {
  const f = await school();
  const a = await f.admin.get('/api/control/access');
  const role = (id) => a.roles.find((r) => r.id === id);
  assert.ok(role('admin').systems.includes('control'));
  assert.ok(a.roles.filter((r) => r.id !== 'admin').every((r) => !r.systems.includes('control')));
  assert.equal(role('admin').permissions, null, 'administrators have everything');
  assert.ok(role('student').modules.length > 0);
  assert.equal(role('registrar').modules, null, 'Learn modules are for students, teachers and parents');
  await f.admin.put('/api/admin/roles', { overrides: { registrar: { add: ['settings.edit'] } } });
  assert.equal((await f.admin.get('/api/control/access')).roles.find((r) => r.id === 'registrar').changed, true);
});

test('the demo school brings a few days of trail, and takes it away again', async () => {
  const f = await school();
  await f.admin.post('/api/admin/demo');
  const demo = f.env.db.data.auditDemo;
  assert.ok(demo.length >= 15);
  assert.ok(demo.some((e) => e.outcome === 'failed') && demo.some((e) => e.outcome === 'refused'));
  const failed = await f.admin.get('/api/control/audit?kind=signin&outcome=failed&q=203.0.113.45');
  assert.ok(failed.total >= 5);
  await f.admin.del('/api/admin/demo');
  assert.equal(f.env.db.data.auditDemo.length, 0);
  assert.ok(f.env.api.audit.entries().length > 0, 'the real trail stays');
});

// After CORE ERP's Users & Access: one account's own access, on top of its account type.
test('own access: give one account a permission, or take one away, without changing its account type', async () => {
  const f = await school();
  const campus = [f.env.db.data.campuses[0].id];
  const staff = await f.admin.post('/api/control/users', { role: 'staff', username: 'sam', name: 'Sam Staff', password: PW, campusIds: campus, mustChangePassword: false });
  const hr = await f.admin.post('/api/control/users', { role: 'hr', username: 'hana', name: 'Hana HR', password: PW, campusIds: campus, mustChangePassword: false });
  const sam = await f.signIn('sam');
  await assert.rejects(sam.get('/api/finance/collectors'), (e) => e.status === 403);
  // The account page offers the permission groups for its type, with what the type gives.
  const page = await f.admin.get(`/api/control/users/${staff.id}`);
  assert.deepEqual(page.accessGroups.map((g) => g.id), ['people', 'finance'], 'staff: People and Finance permissions; not the Admin panel or Academic');
  assert.ok(page.accessGroups.flatMap((g) => g.permissions).every((p) => !p.byType));
  // Give Sam Finance's view: it works at once, and Finance's own status shows it.
  const after = await f.admin.put(`/api/control/users/${staff.id}/access`, { permissions: ['finance.view'] });
  assert.deepEqual(after.ownAccess, { add: ['finance.view'], remove: [] });
  assert.deepEqual(after.permissions, ['finance.view']);
  assert.ok(Array.isArray(await sam.get('/api/finance/collectors')));
  assert.ok((await sam.get('/api/finance/auth/status')).permissions.includes('finance.view'));
  const entry = f.trail().at(-1);
  assert.deepEqual([entry.action, entry.target, entry.changes], ["Changed an account's own access", 'Sam Staff', [{ field: 'Finance dashboard, books and reports', from: 'No', to: 'Yes' }]]);
  // Take approving leave away from one HR manager only.
  const hana = await f.signIn('hana');
  const hrType = (await f.admin.get(`/api/control/users/${hr.id}`)).permissions;
  await f.admin.put(`/api/control/users/${hr.id}/access`, { permissions: hrType.filter((p) => p !== 'leave.approve') });
  await assert.rejects(hana.post('/api/hris/requests/x/approve', {}), (e) => e.status === 403);
  assert.ok(Array.isArray(await hana.get('/api/hris/employees')), 'the rest of HR stays');
  // What cannot be given: Admin-panel permissions to a People account, administrators' own, anything to students.
  await assert.rejects(f.admin.put(`/api/control/users/${staff.id}/access`, { permissions: ['students.manage'] }), /cannot be given/);
  await assert.rejects(f.admin.put(`/api/control/users/${staff.id}/access`, { permissions: ['admins.manage'] }), /cannot be given/);
  await assert.rejects(f.admin.put(`/api/control/users/${f.students.s1.id}/access`, { permissions: ['finance.view'] }), /no permissions/);
  const me = f.env.db.data.users.find((u) => u.username === 'admin');
  await assert.rejects(f.admin.put(`/api/control/users/${me.id}/access`, { permissions: [] }), /every permission/);
  // Changing the account type drops its own access (it belonged to the old type).
  const moved = await f.admin.put(`/api/control/users/${staff.id}`, { role: 'payroll' });
  assert.deepEqual(moved.ownAccess, { add: [], remove: [] });
  assert.ok(f.trail().at(-1).changes.some((c) => c.field === 'own access'));
  // Back to what the type gives: nothing is kept on the account.
  await f.admin.put(`/api/control/users/${hr.id}/access`, { permissions: hrType });
  assert.equal(f.env.db.data.users.find((u) => u.id === hr.id).access, undefined);
  assert.equal((await f.admin.get('/api/control/users?q=hana')).users[0].ownAccess, 0);
});

test('the audit log is its own file, chained like CORE\'s: kept across restores, and tampering shows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-audit-'));
  try {
    const db = memoryDb();
    db.dir = dir;
    // An older ATLAS kept the trail inside the data: it moves into the file once.
    db.data.auditTrail = [{ id: 'old-1', at: '2026-01-01T00:00:00.000Z', kind: 'signin', system: 'admin', action: 'Signed in', actorId: null, actor: 'Someone', outcome: 'ok' }];
    const env = setup({ db });
    const s = await seed(env);
    assert.equal(db.data.auditTrail, undefined);
    const file = path.join(dir, 'audit-log.jsonl');
    const lines = () => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines()[0].action, 'Signed in');
    assert.deepEqual(lines().map((e) => e.seq), lines().map((_, i) => i + 1));
    assert.ok(lines().every((e, i) => e.prev === (i ? lines()[i - 1].hash : '')));
    let view = await s.admin.get('/api/control/audit');
    assert.deepEqual([view.check.ok, view.check.count], [true, lines().length]);
    // A backup holds no trail, and restoring one (even an old one with a trail inside) changes nothing in it.
    const count = lines().length;
    const backup = await s.admin.get('/api/admin/backup');
    assert.equal('auditTrail' in backup, false);
    await s.admin.post('/api/admin/restore', { ...backup, auditTrail: [{ id: 'x', at: '2020-01-01T00:00:00Z', action: 'Fake' }] });
    assert.ok(lines().length >= count);
    assert.equal(lines().some((e) => e.action === 'Fake'), false);
    // Someone edits the file by hand: the Audit trail page says so, and from which entry.
    const all = lines();
    all[2].action = 'Something else';
    fs.writeFileSync(file, `${all.map((e) => JSON.stringify(e)).join('\n')}\n`);
    view = await s.admin.get('/api/control/audit');
    assert.deepEqual([view.check.ok, view.check.brokenAt], [false, 3]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('delete an unused account, link a staff account to its employee record', async () => {
  const f = await school();
  const campus = [f.env.db.data.campuses[0].id];
  const temp = await f.admin.post('/api/control/users', { role: 'staff', username: 'temp', name: 'Temp Account', password: PW, campusIds: campus });
  await f.admin.del(`/api/control/users/${temp.id}`);
  assert.equal(f.env.db.data.users.some((u) => u.id === temp.id), false);
  assert.deepEqual([f.trail().at(-1).action, f.trail().at(-1).target], ['Deleted an account', 'Temp Account (temp, Staff)']);
  // An account that made changes, or has sections, is disabled instead.
  await assert.rejects(f.admin.del(`/api/control/users/${f.teachers.t1.id}`), /sections.*Disable it instead/);
  const me = f.env.db.data.users.find((u) => u.username === 'admin');
  await assert.rejects(f.admin.del(`/api/control/users/${me.id}`), /your own account/);
  const busy = await f.admin.post('/api/control/users', { role: 'registrar', username: 'busy', name: 'Busy Registrar', password: PW, campusIds: campus, mustChangePassword: false });
  const b = await f.signIn('busy');
  await b.post('/api/admin/courses', { code: 'BUSY', title: 'Busy course', units: 1 });
  await assert.rejects(f.admin.del(`/api/control/users/${busy.id}`), /changes in the audit trail/);
  // Employee records: one account each, as in CORE.
  const emp = await f.admin.post('/api/hris/employees', { firstName: 'Hana', lastName: 'Cruz', hireDate: '2026-01-05', payType: 'monthly', rate: 30000 });
  {
    const hr = await f.admin.post('/api/control/users', { role: 'hr', username: 'hana', name: 'Hana Cruz', password: PW, campusIds: campus });
    const linked = await f.admin.put(`/api/control/users/${hr.id}`, { employeeId: emp.id });
    assert.equal(linked.employee.id, emp.id);
    assert.deepEqual(f.trail().at(-1).changes, [{ field: 'employee record', from: '', to: 'Hana Cruz' }]);
    await assert.rejects(f.admin.put(`/api/control/users/${f.reg.id}`, { employeeId: emp.id }), /already linked to the account "hana"/);
  }
});
