// The Settings center: every module's settings in one list with their defaults, a change history
// with undo, restore defaults, export/import, and roles & permissions; plus the settings that used
// to be fixed in the code (passwords and sign-in, uploads, quizzes, numbering).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { createFileStore } from '../server/files.js';
import { memoryDb } from '../server/db.js';

const PW = 'password123';
const status = (code) => (err) => err.status === code;

async function school(env = setup()) {
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  const mk = (role, username) => admin.post('/api/admin/users', { role, username, name: username, password: PW, mustChangePassword: false });
  const signIn = async (username, password = PW) => {
    const c = env.client();
    await c.post('/api/hub/login', { username, password });
    return c;
  };
  return { env, admin, mk, signIn };
}

test('Settings center: every setting with its default, what changed, and who changed it', async () => {
  const { admin } = await school();
  let c = await admin.get('/api/admin/config');
  const find = (area, path) => c.settings.find((s) => s.area === area && s.path === path);
  for (const m of ['admin', 'learn', 'academic', 'people', 'finance']) assert.ok(c.areas.some((a) => a.module === m), `areas for ${m}`);
  assert.equal(find('enrollment', 'enrollment.maxUnits').value, 24);
  assert.equal(find('enrollment', 'enrollment.maxUnits').changed, false);
  assert.equal(find('payroll', 'gov.pera').default, 2000);

  // A change on its own screen is recorded with the value before and after.
  await admin.put('/api/admin/settings', { enrollment: { requireApproval: true, allowWaitlist: true, waitlistLimit: 10, maxUnits: 21 } });
  c = await admin.get('/api/admin/config');
  assert.equal(find('enrollment', 'enrollment.maxUnits').changed, true);
  assert.equal(find('enrollment', 'enrollment.maxUnits').lastChange.by, 'Ada Admin');
  let h = await admin.get('/api/admin/config/history');
  assert.equal(h.entries[0].area, 'enrollment');
  assert.deepEqual(h.entries[0].changes.map((x) => [x.label, x.from, x.to]), [['Maximum units per term', 24, 21]]);

  // Changes in other modules are recorded too (Academic, People, Finance).
  await admin.put('/api/academic/settings', { incDays: 200 });
  await admin.put('/api/hris/payroll-config', { gov: { pera: 2500 } });
  await admin.put('/api/finance/settings', { depositDays: 3 });
  h = await admin.get('/api/admin/config/history');
  assert.deepEqual(h.entries.slice(0, 3).map((e) => e.module), ['finance', 'people', 'academic']);
  assert.equal((await admin.get('/api/admin/config/history?module=people')).entries[0].changes[0].label, 'PERA');

  // Undo puts the old value back, through the module's own checks, and is recorded.
  await admin.post(`/api/admin/config/history/${h.entries[1].id}/undo`);
  assert.equal((await admin.get('/api/hris/settings')).gov.pera, 2000);
  assert.equal((await admin.get('/api/admin/config/history')).entries[0].via, 'undo');
  // An undo is refused when the setting has changed again since.
  await admin.put('/api/academic/settings', { incDays: 250 });
  await assert.rejects(admin.post(`/api/admin/config/history/${h.entries[2].id}/undo`), /changed again/);

  // Restore one setting, or a whole group, to its default.
  await admin.post('/api/admin/config/reset', { area: 'enrollment', path: 'enrollment.maxUnits' });
  assert.equal((await admin.get('/api/admin/settings')).enrollment.maxUnits, 24);
  await admin.post('/api/admin/config/reset', { area: 'academic' });
  assert.equal((await admin.get('/api/academic/settings')).incDays, 365);
  // Groups without built-in defaults (the school's own offices, banks…) cannot be reset.
  await assert.rejects(admin.post('/api/admin/config/reset', { area: 'finance' }), /no built-in defaults/);
});

test('settings export and import: preview first, all or nothing', async () => {
  const a = await school();
  await a.admin.put('/api/admin/settings', { security: { minPasswordLength: 12 }, numbering: { studentNo: 'S{YY}-{N5}' } });
  await a.admin.put('/api/academic/settings', { incDays: 180 });
  const file = await a.admin.get('/api/admin/config/export');
  assert.equal(file.atlasSettings, 1);
  assert.equal(file.areas.security.minPasswordLength, 12);
  assert.equal(file.areas.school.currentTermId, undefined); // terms are each school's own

  const b = await school();
  const preview = await b.admin.post('/api/admin/config/import/preview', { file });
  const sec = preview.areas.find((x) => x.id === 'security');
  assert.deepEqual(sec.changes.map((x) => [x.path, x.from, x.to]), [['minPasswordLength', 8, 12]]);
  assert.equal((await b.admin.get('/api/admin/settings')).security.minPasswordLength, 8); // a preview saves nothing

  // One bad group: nothing at all is imported.
  const bad = structuredClone(file);
  bad.areas.academic.scale = [{ min: 90, grade: 1, remark: 'x' }]; // no 0% band
  await assert.rejects(b.admin.post('/api/admin/config/import', { file: bad, areas: ['security', 'academic'] }), /Academic settings: .*0%.*Nothing was imported/);
  assert.equal((await b.admin.get('/api/admin/settings')).security.minPasswordLength, 8);

  const r = await b.admin.post('/api/admin/config/import', { file, areas: ['security', 'numbering', 'academic'] });
  assert.equal(r.areas, 3);
  assert.equal((await b.admin.get('/api/admin/settings')).numbering.studentNo, 'S{YY}-{N5}');
  assert.equal((await b.admin.get('/api/academic/settings')).incDays, 180);
  assert.ok((await b.admin.get('/api/admin/config/history')).entries.some((e) => e.via === 'import'));
  await assert.rejects(b.admin.post('/api/admin/config/import/preview', { file: { hello: 1 } }), /not an ATLAS settings file/);
});

test('roles & permissions: administrators change what each account type may do, within limits', async () => {
  const { admin, mk, signIn } = await school();
  await mk('registrar', 'reg');
  await admin.post('/api/finance/users', { role: 'accountant', username: 'acct', name: 'Alma', password: PW, mustChangePassword: false });
  const reg = await signIn('reg');
  const acct = await signIn('acct');

  // A registrar has Academic settings by default; take it away.
  await reg.put('/api/academic/settings', { incDays: 300 });
  const roles = await admin.get('/api/admin/roles');
  const registrar = roles.roles.find((r) => r.id === 'registrar');
  await admin.put('/api/admin/roles', { permissions: { registrar: registrar.permissions.filter((p) => p !== 'academic.settings') } });
  await assert.rejects(reg.put('/api/academic/settings', { incDays: 301 }), status(403));
  assert.ok(!(await reg.get('/api/academic/auth/status')).permissions.includes('academic.settings'));

  // Give the registrar a Finance permission: Finance opens for them.
  assert.ok(!(await reg.get('/api/finance/auth/status')).permissions.includes('finance.view'));
  await admin.put('/api/admin/roles', { permissions: { registrar: [...registrar.permissions.filter((p) => p !== 'academic.settings'), 'finance.view'] } });
  assert.ok((await reg.get('/api/finance/auth/status')).permissions.includes('finance.view'));

  // Limits: administrators' own powers, Admin-panel powers for accounts outside it, and the admin role.
  await assert.rejects(admin.put('/api/admin/roles', { permissions: { registrar: [...registrar.permissions, 'admins.manage'] } }), /cannot be given/);
  await assert.rejects(admin.put('/api/admin/roles', { permissions: { accountant: ['finance.view', 'catalog.manage'] } }), /cannot be given/);
  await assert.rejects(admin.put('/api/admin/roles', { permissions: { admin: [] } }), /every permission/);
  await assert.rejects(reg.put('/api/admin/roles', { permissions: { registrar: [] } }), status(403));
  await assert.rejects(acct.get('/api/admin/roles'), status(401));

  // Recorded, shown as changed, and undone by restoring the defaults.
  const h = await admin.get('/api/admin/config/history?area=roles');
  assert.equal(h.entries.length, 2);
  assert.ok((await admin.get('/api/admin/roles')).roles.find((r) => r.id === 'registrar').changed);
  await admin.post('/api/admin/config/reset', { area: 'roles' });
  await reg.put('/api/academic/settings', { incDays: 302 });
});

test('sign-in and passwords: length, letters and digits, lockout, first-sign-in change', async () => {
  const { admin, mk, env } = await school();
  await assert.rejects(admin.put('/api/admin/settings', { security: { minPasswordLength: 6 } }), /between 8 and 64/);
  await admin.put('/api/admin/settings', { security: { minPasswordLength: 12, requireLettersAndDigits: true, lockoutAttempts: 3, lockoutMinutes: 10, forcePasswordChange: true } });
  await assert.rejects(mk('teacher', 'tea1'), /at least 12 characters/);
  await assert.rejects(admin.post('/api/admin/users', { role: 'teacher', username: 'tea1', name: 'T', password: 'longpassword', mustChangePassword: false }), /letters and digits/);
  const t = await admin.post('/api/admin/users', { role: 'teacher', username: 'tea1', name: 'T', password: 'longpassword1', mustChangePassword: false });
  assert.equal(t.mustChangePassword, true); // the school requires it, whatever the box said

  const c = env.client();
  for (let i = 0; i < 3; i++) await assert.rejects(c.post('/api/hub/login', { username: 'tea1', password: 'wrong' }));
  await assert.rejects(c.post('/api/hub/login', { username: 'tea1', password: 'longpassword1' }), /Try again in 10 minutes/);
});

test('numbering formats: student, employee and document request numbers, with a preview', async () => {
  const { admin, mk } = await school();
  await assert.rejects(admin.put('/api/admin/settings', { numbering: { studentNo: 'STUDENT' } }), /needs a serial/);
  await assert.rejects(admin.put('/api/admin/settings', { numbering: { studentNo: '{YYYY}-{X}-{N}' } }), /unknown/);
  assert.deepEqual(await admin.get(`/api/admin/numbering-preview?kind=studentNo&format=${encodeURIComponent('S{YY}-{N5}')}`), { next: `S${String(new Date().getFullYear()).slice(2)}-00001` });
  await admin.put('/api/admin/settings', { numbering: { studentNo: 'S{YY}-{N5}', employeeNo: 'LA-{N3}' } });
  const s1 = await mk('student', 'stu1');
  const s2 = await mk('student', 'stu2');
  const yy = String(new Date().getFullYear()).slice(2);
  assert.equal(s1.studentNo, `S${yy}-00001`);
  assert.equal(s2.studentNo, `S${yy}-00002`);
  const e = await admin.post('/api/hris/employees', { firstName: 'Ana', lastName: 'Cruz', hireDate: '2026-01-05', payType: 'monthly', rate: 30000 });
  assert.equal(e.employeeNo, 'LA-001');
  assert.equal((await admin.get('/api/admin/settings')).numberingNext.studentNo, `S${yy}-00003`);
});

test('uploads, quizzes and parent alerts follow the Learn settings', async () => {
  const db = memoryDb();
  db.data.settings.learn.maxUploadMb = 1;
  const store = createFileStore(db);
  const big = Buffer.alloc(1.5 * 1024 * 1024).toString('base64');
  assert.throws(() => store.save({ name: 'a.pdf', type: 'application/pdf', data: big }, { owner: { id: 'u' } }), /at most 1 MB/);
  db.data.settings.learn.maxUploadMb = 2;
  assert.ok(store.save({ name: 'a.pdf', type: 'application/pdf', data: big }, { owner: { id: 'u' } }).id);

  const { admin } = await school();
  await assert.rejects(admin.put('/api/admin/settings', { learn: { maxUploadMb: 50 } }), /between 1 and 15/);
  await admin.put('/api/admin/settings', { learn: { maxUploadMb: 5, quizGraceSeconds: 60, absenceAlert: 5 } });
  assert.equal((await admin.get('/api/auth/status')).maxUploadMb, 5); // Learn's screens say the limit
});

test('stricter checks: scale order, honors, school name, archived current term, Finance rules', async () => {
  const { admin } = await school();
  const scale = (await admin.get('/api/academic/settings')).scale;
  await assert.rejects(admin.put('/api/academic/settings', { scale: [{ min: 90, grade: 2, remark: '' }, { min: 80, grade: 1.5, remark: '' }, { min: 0, grade: 5, remark: '' }] }), /better grade/);
  await assert.rejects(admin.put('/api/academic/settings', { scale: [...scale, { min: 99, grade: 1.25, remark: 'dup' }] }), /same percentage/);
  await assert.rejects(admin.put('/api/academic/settings', { honors: { maxGwa: -1 } }), /between 1 and 5/);
  await assert.rejects(admin.put('/api/academic/settings', { honors: { worstGrade: 5 } }), /failing grade/);
  // A new band, and a different lowest passing grade.
  await admin.put('/api/academic/settings', { passingGrade: 2.75, scale: [...scale.filter((b) => b.min !== 75), { min: 75, grade: 3, remark: 'Conditional' }] });
  const s = await admin.get('/api/academic/settings');
  assert.equal(s.passingGrade, 2.75);
  assert.equal(s.scalePassing, 78); // Learn passes at 75%: the screen warns they differ
  assert.equal(s.learnPassing, 75);

  await assert.rejects(admin.put('/api/admin/settings', { schoolName: '  ' }), /Give the school a name/);
  await assert.rejects(admin.put('/api/admin/settings', { enrollment: { waitlistLimit: 10, maxUnits: 999 } }), /between 0 and 60/);
  await admin.post('/api/admin/terms', { name: 'Now', startDate: '2026-08-15', endDate: '2026-12-15', enrollStart: '2026-08-01', enrollEnd: '2026-08-20' });
  const old = { name: 'Old', startDate: '2020-01-01', endDate: '2020-05-01', enrollStart: '2019-12-01', enrollEnd: '2019-12-10' };
  const term = await admin.post('/api/admin/terms', old);
  await admin.put(`/api/admin/terms/${term.id}`, { ...old, status: 'archived' });
  await assert.rejects(admin.put('/api/admin/settings', { currentTermId: term.id }), /archived/);

  await assert.rejects(admin.put('/api/finance/settings', { semiHighValue: 60000 }), /below the capitalization/);
  await assert.rejects(admin.put('/api/finance/settings', { liquidationDays: { opex: 500 } }), /1 to 365/);
  await assert.rejects(admin.put('/api/finance/settings', { revenueItems: [{ name: 'Fee', code: '40201040', amount: -5, fund: '05' }] }), /0 or more/);
  const taxes = (await admin.get('/api/finance/settings')).taxes;
  await assert.rejects(admin.put('/api/finance/settings', { taxes: [...taxes, taxes[0]] }), /listed twice/);

  // An office a purchase request uses cannot be removed.
  await admin.put('/api/finance/settings', { offices: [{ code: 'CCS', name: 'Computing' }, { code: 'ADM', name: 'Admin' }] });
  await admin.post('/api/finance/prs', { office: 'CCS', fund: '01', purpose: 'Chairs', items: [{ description: 'Chair', unit: 'pc', qty: 2, unitCost: 1000 }] });
  await assert.rejects(admin.put('/api/finance/settings', { offices: [{ code: 'ADM', name: 'Admin' }] }), /Office CCS is used by documents/);
  await admin.put('/api/finance/settings', { offices: [{ code: 'CCS', name: 'Computing Studies' }] }); // ADM is unused
});
