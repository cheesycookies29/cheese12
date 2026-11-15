// The Admin panel (0.16): the dashboard's figures, Roles & permissions (overrides that never lock
// out administrators or give away admin-only powers, enforced the same on server and browser),
// Modules (a module that is off is refused), the Settings center (catalog, defaults, history, undo,
// export / import without secrets, all or nothing), branding checks and the old addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { ROLES, PERMISSION_LABELS, PERMISSION_GROUPS, ADMIN_ONLY_PERMISSIONS, cleanOverrides, setRoleOverrides, userCan, usesAdminPanel } from '../shared/roles.js';
import { moduleOn, moduleOfApi, SWITCHABLE, cleanModuleConfig } from '../shared/modules.js';
import { AREAS, SETTINGS } from '../shared/settings-catalog.js';
import { THEMES, contrast, readableOnBrand, themeColors } from '../shared/brand.js';
import { validateBranding, checkLogo, sniffImage } from '../server/branding.js';
import { redirectOf } from '../shared/redirects.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = 'Correct-Horse-42';
const newDb = () => openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-admin16-')), 'db.json'));

// A browser: keeps its cookie and reports errors as { status, error }.
function browser(handle, { ip = '10.0.0.5' } = {}) {
  let cookie = '';
  const call = async (method, url, body = {}) => {
    try {
      const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: ip } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res.headers['Content-Type'] ? res : res.data;
    } catch (err) {
      return { status: err.status, error: err.message };
    }
  };
  return call;
}

async function company({ demo = false } = {}) {
  const db = newDb();
  const handle = createApi(db);
  const admin = browser(handle);
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  if (demo) await admin('POST', '/api/admin/demo');
  const signIn = async (username, password = 'demo1234') => {
    const b = browser(handle, { ip: `10.0.1.${Math.floor(Math.random() * 200)}` });
    const r = await b('POST', '/api/auth/login', { username, password });
    assert.ok(r.user, `${username} signs in: ${r.error}`);
    return b;
  };
  return { db, handle, admin, signIn };
}
const audited = (db) => fs.readFileSync(path.join(db.dir, 'audit-log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---------- Dashboard ----------
test('dashboard: accounts, sign-ins, 2-step, temporary passwords, failed sign-ins, the audit check, modules, feedback, data', async () => {
  const { db, handle, admin, signIn } = await company({ demo: true });
  await admin('POST', '/api/users', { name: 'Rosa Lim', username: 'rosa.lim', role: 'hrstaff', password: 'Welcome-2026-x', mustChangePassword: true });
  const off = await admin('POST', '/api/users', { name: 'Old Hand', username: 'old.hand', role: 'it', password: 'Welcome-2026-x', mustChangePassword: false });
  await admin('PUT', `/api/users/${off.id}`, { ...off, active: false });
  await signIn('hr.demo');
  // Wrong passwords: five in a row lock the username.
  const stranger = browser(handle, { ip: '10.9.9.9' });
  for (let i = 0; i < 5; i++) await stranger('POST', '/api/auth/login', { username: 'payroll.demo', password: 'nope-nope' });
  const emp = await signIn('employee.demo');
  await emp('POST', '/api/feedback', { type: 'idea', area: 'general', subject: 'More colours', message: 'Could CORE use our colours?' });

  const d = await admin('GET', '/api/admin/dashboard');
  const active = db.data.users.filter((u) => u.active);
  assert.equal(d.people.active, active.length);
  assert.equal(d.people.disabled, 1);
  assert.equal(d.people.byRole.reduce((n, r) => n + r.count, 0), active.length);
  assert.equal(d.people.byRole.find((r) => r.role === 'hrstaff').count, 1);
  assert.equal(d.people.signedIn, 3, 'admin, hr.demo and employee.demo are signed in');
  assert.equal(d.people.tempPasswords, 1);
  assert.deepEqual(d.people.twoFactor, { on: 0, required: 0, off: active.length, policy: 'off' });
  assert.equal(d.security.failedSignIns, 5);
  assert.equal(d.security.locks, 1);
  assert.equal(d.security.chain.ok, true);
  assert.deepEqual(d.modules, { hr: true, assets: true, helpdesk: true, crm: true, projects: true });
  assert.equal(d.feedback.awaiting, 1);
  assert.equal(d.data.demo, true);
  assert.equal(d.data.lastBackupAt, null);
  assert.ok(d.data.dbBytes > 1000);
  assert.ok(d.build.node && d.version);

  // 2-step required for everyone: the administrator has it on, everyone else must still set it up.
  const me = db.data.users.find((u) => u.username === 'admin');
  me.twoFactor = { secret: 'x', enabledAt: new Date().toISOString(), lastStep: -1, recovery: [] };
  db.data.settings.security = { ...db.data.settings.security, twoFactor: 'all' };
  const d2 = await admin('GET', '/api/admin/dashboard');
  assert.deepEqual(d2.people.twoFactor, { on: 1, required: active.length - 1, off: 0, policy: 'all' });
  db.data.settings.security.twoFactor = 'off';
  delete me.twoFactor;

  // A backup download is remembered, with who.
  await admin('GET', '/api/admin/export');
  const d3 = await admin('GET', '/api/admin/dashboard');
  assert.ok(Date.now() - Date.parse(d3.data.lastBackupAt) < 60000);
  assert.equal(d3.data.lastBackupBy, 'Ada Admin');

  // Without any admin permission: no dashboard. With audit.view only: the security part, nothing else.
  assert.equal((await emp('GET', '/api/admin/dashboard')).status, 403);
  await admin('PUT', '/api/admin/roles', { permissions: { hr: [...ROLES.hr.permissions, 'audit.view'] } });
  const hr = await signIn('hr.demo');
  const dh = await hr('GET', '/api/admin/dashboard');
  assert.ok(dh.security && !dh.people && !dh.data && !dh.build && !dh.feedback);
});

// ---------- Roles & permissions ----------
test('roles: grant and revoke for an account type, recorded in the history and the audit log', async () => {
  const { db, admin, signIn } = await company({ demo: true });
  const hr = await signIn('hr.demo');
  assert.equal((await hr('GET', '/api/audit')).status, 403);
  const empId = db.data.employees[0].id;
  assert.ok((await hr('GET', `/api/employees/${empId}`)).id);

  const hrNow = ROLES.hr.permissions.filter((p) => p !== 'employees.edit');
  const out = await admin('PUT', '/api/admin/roles', { permissions: { hr: [...hrNow, 'audit.view'] } });
  const row = out.roles.find((r) => r.id === 'hr');
  assert.equal(row.changed, true);
  assert.ok(row.permissions.includes('audit.view') && !row.permissions.includes('employees.edit'));
  assert.deepEqual(db.data.roleOverrides.hr, { add: ['audit.view'], remove: ['employees.edit'] });

  // Granted at once on the server; revoked too.
  assert.ok(Array.isArray((await hr('GET', '/api/audit')).entries));
  assert.equal((await hr('POST', '/api/employees', { employeeNo: 'X-1', firstName: 'A', lastName: 'B', hireDate: '2026-01-05', payType: 'monthly', rate: 30000 })).status, 403);
  // The browser gets the same overrides with the signed-in status.
  const status = await hr('GET', '/api/auth/status');
  assert.deepEqual(status.roleOverrides.hr, { add: ['audit.view'], remove: ['employees.edit'] });
  assert.equal(usesAdminPanel(status.user), true);

  // History: who changed which permission; the audit log says the same.
  const h = await admin('GET', '/api/admin/config/history?area=roles');
  assert.equal(h.entries[0].via, 'screen');
  assert.equal(h.entries[0].by, 'Ada Admin');
  const entry = audited(db).filter((e) => e.action === 'settings.roles').at(-1);
  assert.ok(entry.changes.some((c) => c.field === 'HR Manager: Audit log: who viewed or changed personal data, payroll and settings' && c.to === 'Yes'));
  assert.ok(entry.changes.some((c) => c.field === 'HR Manager: Add and edit employees' && c.to === 'No'));

  // Restore defaults for the type.
  await admin('PUT', '/api/admin/roles', { permissions: { hr: ROLES.hr.permissions } });
  assert.equal(db.data.roleOverrides.hr, undefined);
  assert.equal((await hr('GET', '/api/audit')).status, 403);
  // Only administrators see or change roles.
  assert.equal((await hr('GET', '/api/admin/roles')).status, 403);
  assert.equal((await hr('PUT', '/api/admin/roles', { permissions: { hr: [...ROLES.hr.permissions, 'audit.view'] } })).status, 403);
});

test('roles: administrators cannot be locked out, admin-only permissions are never given, tampered data is ignored', async () => {
  const { db, admin, signIn } = await company({ demo: true });
  assert.match((await admin('PUT', '/api/admin/roles', { permissions: { admin: ['self'] } })).error, /Administrators always have every permission/);
  assert.match((await admin('PUT', '/api/admin/roles', { overrides: { admin: { remove: ['users.manage'] } } })).error, /Administrators always/);
  for (const p of ADMIN_ONLY_PERMISSIONS) {
    const r = await admin('PUT', '/api/admin/roles', { permissions: { hr: [...ROLES.hr.permissions, p] } });
    assert.equal(r.status, 400, p);
    assert.match(r.error, /stays with administrators/);
  }
  assert.match((await admin('PUT', '/api/admin/roles', { permissions: { hr: ['nonsense.perm'] } })).error, /no permission/);
  assert.match((await admin('PUT', '/api/admin/roles', { permissions: { wizard: ['self'] } })).error, /Unknown account type/);
  assert.equal((await admin('PUT', '/api/admin/roles', { permissions: { hr: 'audit.view' } })).status, 400);
  assert.deepEqual(db.data.roleOverrides, {}, 'nothing was saved');

  // Removing everything from every other type leaves the administrator with everything.
  await admin('PUT', '/api/admin/roles', { permissions: Object.fromEntries(Object.keys(ROLES).filter((r) => r !== 'admin').map((r) => [r, []])) });
  for (const url of ['/api/users', '/api/admin/roles', '/api/security-settings', '/api/admin/demo', '/api/audit']) assert.ok(!(await admin('GET', url)).status, url);
  assert.equal((await (await signIn('employee.demo'))('GET', '/api/me/profile')).status, 403, 'self taken from employees');
  await admin('PUT', '/api/admin/roles', { overrides: {} });

  // A data file or backup edited by hand cannot give an admin-only power or change administrators.
  assert.deepEqual(cleanOverrides({ hr: { add: ['users.manage', 'data.manage', 'audit.view', 'bogus'] }, admin: { remove: ['*'] }, ghost: { add: ['self'] } }), { hr: { add: ['audit.view'], remove: [] } });
  db.data.roleOverrides = { employee: { add: ['users.manage', 'roles.manage', 'data.manage'] } };
  const emp = await signIn('employee.demo');
  assert.equal((await emp('GET', '/api/users')).status, 403);
  assert.equal((await emp('GET', '/api/admin/roles')).status, 403);
  db.data.roleOverrides = {};

  // A restored backup brings its roles only as CORE writes them.
  const backup = await admin('GET', '/api/admin/export');
  await admin('POST', '/api/admin/import', { ...backup, roleOverrides: { employee: { add: ['users.manage', 'audit.view'] } }, password: PW });
  assert.deepEqual(db.data.roleOverrides, { employee: { add: ['audit.view'], remove: [] } });
});

test('roles: the browser and the server agree, and per-person grants still apply on top', async () => {
  const { db, admin, signIn } = await company({ demo: true });
  await admin('PUT', '/api/admin/roles', { permissions: { salesmgr: ROLES.salesmgr.permissions.filter((p) => !['crm.view', 'crm.edit'].includes(p)), it: [...ROLES.it.permissions, 'feedback.view', 'settings.center'] } });
  const it = await signIn('it.demo');
  const status = await it('GET', '/api/auth/status');
  // The browser's copy of shared/roles.js, with the overrides from the status...
  setRoleOverrides(status.roleOverrides);
  const browserSays = Object.fromEntries(PERMISSION_LABELS.map(([p]) => [p, userCan(status.user, p)]));
  // ...and what the server lets it do.
  const probes = { 'feedback.view': ['GET', '/api/feedback/summary'], 'settings.center': ['GET', '/api/admin/config'], 'audit.view': ['GET', '/api/audit'], 'users.manage': ['GET', '/api/users'], 'assets.view': ['GET', '/api/assets'], 'crm.view': ['GET', '/api/crm/overview'], 'employees.view': ['GET', '/api/employees'], 'modules.config': ['GET', '/api/admin/modules'], 'data.manage': ['GET', '/api/admin/demo'] };
  for (const [perm, [method, url]] of Object.entries(probes)) {
    const r = await it(method, url);
    assert.equal(r?.status !== 403, browserSays[perm], `${perm}: browser ${browserSays[perm]}, server ${r?.status ?? 200}`);
  }
  setRoleOverrides(db.data.roleOverrides);
  // Sales Managers lost Sales & CRM; one of them is given it back personally.
  const sales = await signIn('sales.demo');
  assert.equal((await sales('GET', '/api/crm/overview')).status, 403);
  const salesUser = db.data.users.find((u) => u.username === 'sales.demo');
  await admin('PUT', `/api/crm/access/${salesUser.id}`, { access: true });
  assert.ok((await sales('GET', '/api/crm/overview')).openCount >= 0);
  // The matrix lists every permission once.
  assert.deepEqual(PERMISSION_GROUPS.flatMap((g) => g.permissions).sort(), PERMISSION_LABELS.map(([p]) => p).sort());
});

// ---------- Modules ----------
test('modules: a module that is off is refused (with a clear message) for everyone but administrators; nothing is deleted', async () => {
  const { db, admin, signIn } = await company({ demo: true });
  const sales = await signIn('sales.demo');
  const emp = await signIn('employee.demo');
  const deals = db.data.crmDeals.length;
  assert.ok((await sales('GET', '/api/crm/overview')).openCount >= 0);

  const r = await admin('PUT', '/api/admin/modules', { modules: { crm: false, hr: false } });
  assert.deepEqual(r.config, { hr: false, assets: true, helpdesk: true, crm: false, projects: true });
  const refused = await sales('GET', '/api/crm/overview');
  assert.equal(refused.status, 403);
  assert.match(refused.error, /Sales & CRM is turned off for the company/);
  assert.equal((await sales('POST', '/api/crm/leads', { name: 'X' })).status, 403);
  // Administrators still open it and its settings.
  assert.ok((await admin('GET', '/api/crm/overview')).openCount >= 0);
  assert.ok(Array.isArray((await admin('GET', '/api/crm/settings')).stages) || (await admin('GET', '/api/crm/meta')));
  // HR & Payroll off: the self-service that belongs to it goes too; My Assets, My tickets and the holiday calendar stay.
  assert.equal((await emp('POST', '/api/me/clock', { action: 'in' })).status, 403);
  assert.equal((await emp('GET', '/api/me/payslips')).status, 403);
  assert.equal((await emp('GET', '/api/leave-types')).status, 403);
  assert.ok(Array.isArray(await emp('GET', '/api/holidays')));
  assert.ok((await emp('GET', '/api/me/assets')).assets);
  assert.ok(Array.isArray(await emp('GET', '/api/helpdesk/mine')));
  // What the CORE home is built from: the status says which modules are on.
  const status = await emp('GET', '/api/auth/status');
  assert.deepEqual(status.modules, r.config);
  assert.equal(moduleOn(status.modules, 'hr'), false);
  assert.equal(moduleOn(status.modules, 'assets'), true);
  assert.equal(moduleOn(status.modules, 'finance'), true, 'roadmap modules are not switched');
  // The service desk off: the public form is refused too.
  await admin('PUT', '/api/admin/modules', { modules: { helpdesk: false } });
  assert.equal((await browser(createApi(db))('GET', '/api/public/helpdesk')).status, 403);
  // Back on: everything is there.
  await admin('PUT', '/api/admin/modules', { modules: { crm: true, hr: true, helpdesk: true } });
  assert.ok((await sales('GET', '/api/crm/overview')).openCount >= 0);
  assert.equal(db.data.crmDeals.length, deals);
  assert.ok(Array.isArray(await emp('GET', '/api/me/payslips')));
  // Only modules.config may switch; only known modules and booleans.
  assert.equal((await sales('PUT', '/api/admin/modules', { modules: { crm: false } })).status, 403);
  assert.match((await admin('PUT', '/api/admin/modules', { modules: { finance: false } })).error, /no module/);
  assert.match((await admin('PUT', '/api/admin/modules', { modules: { crm: 'no' } })).error, /on or off/);
  assert.deepEqual(cleanModuleConfig({ crm: false, hr: 'x', __proto__: { a: 1 } }), { hr: true, assets: true, helpdesk: true, crm: false, projects: true });
  // Every module's API is known; the holiday calendar is readable whatever is off.
  assert.equal(moduleOfApi('GET', '/api/pm/overview'), 'projects');
  assert.equal(moduleOfApi('GET', '/api/clock-locations'), 'hr');
  assert.equal(moduleOfApi('POST', '/api/holidays'), 'hr');
  assert.equal(moduleOfApi('GET', '/api/holidays'), null);
  assert.equal(moduleOfApi('GET', '/api/settings'), null);
  assert.deepEqual(SWITCHABLE, ['hr', 'assets', 'helpdesk', 'crm', 'projects']);
  // Recorded in the audit log.
  assert.ok(audited(db).some((e) => e.action === 'settings.modules' && e.changes.some((c) => c.field === 'Sales & CRM' && c.to === 'Off')));
});

// ---------- Settings center ----------
test('settings center: every setting with its value and default, history of screen saves, undo, restore defaults', async () => {
  const { db, admin, signIn } = await company({ demo: true });
  const cfg = await admin('GET', '/api/admin/config');
  assert.deepEqual(cfg.areas.map((a) => a.id), AREAS.map(([id]) => id));
  assert.equal(cfg.settings.length, SETTINGS.length);
  assert.ok(cfg.settings.every((s) => !s.changed), 'a new company has nothing changed');
  const idle = cfg.settings.find((s) => s.area === 'security' && s.path === 'sessionIdleMinutes');
  assert.deepEqual([idle.value, idle.default, idle.changed, idle.resettable], [480, 480, false, true]);
  assert.equal(cfg.settings.find((s) => s.path === 'companyName').hasDefault, false);
  assert.equal(cfg.areas.find((a) => a.id === 'payroll').importable, false, 'payroll setup: summary and link only');

  // A save on the module's own screen lands in the history.
  const crm = db.data.crm;
  await admin('PUT', '/api/crm/settings', { stages: crm.stages, sources: crm.sources, lostReasons: crm.lostReasons, industries: crm.industries, bidChecklist: crm.bidChecklist, renewalNoticeDays: 30 });
  await admin('PUT', '/api/security-settings', { sessionIdleMinutes: 60 });
  await admin('PUT', '/api/payroll-config', { gracePeriodMinutes: 10 });
  let h = await admin('GET', '/api/admin/config/history');
  const crmEntry = h.entries.find((e) => e.area === 'crm');
  assert.deepEqual(crmEntry.changes, [{ path: 'renewalNoticeDays', label: 'Contract renewal notice (days)', from: 60, to: 30 }]);
  assert.equal(crmEntry.undoable, true);
  assert.equal(h.entries.find((e) => e.area === 'payroll').undoable, false, 'payroll changes are on Payroll Setup');
  const cfg2 = await admin('GET', '/api/admin/config');
  const renew = cfg2.settings.find((s) => s.area === 'crm' && s.path === 'renewalNoticeDays');
  assert.deepEqual([renew.value, renew.default, renew.changed, renew.lastChange.by], [30, 60, true, 'Ada Admin']);

  // Undo puts the value back, and is recorded; the change undone cannot be undone twice.
  await admin('POST', `/api/admin/config/history/${crmEntry.id}/undo`);
  assert.equal(db.data.crm.renewalNoticeDays, 60);
  h = await admin('GET', '/api/admin/config/history?area=crm');
  assert.equal(h.entries[0].via, 'undo');
  assert.equal(h.entries[0].undoable, false);
  assert.match((await admin('POST', `/api/admin/config/history/${crmEntry.id}/undo`)).error, /changed again since/);

  // Restore one default, then a whole area.
  await admin('POST', '/api/admin/config/reset', { area: 'security', path: 'sessionIdleMinutes' });
  assert.equal(db.data.settings.security.sessionIdleMinutes, 480);
  await admin('PUT', '/api/location-settings', { officeLabel: 'HQ', officeLat: null, officeLng: null, radius: 300, retentionDays: 90 });
  await admin('POST', '/api/admin/config/reset', { area: 'location' });
  assert.deepEqual([db.data.settings.location.radius, db.data.settings.location.retentionDays, db.data.settings.location.officeLabel], [150, 365, 'Office']);
  assert.match((await admin('POST', '/api/admin/config/reset', { area: 'company' })).error, /no built-in defaults/);
  assert.match((await admin('POST', '/api/admin/config/reset', { area: 'security', path: '__proto__' })).error, /Unknown setting/);
  assert.equal((await admin('POST', '/api/admin/config/reset', { area: 'nope' })).status, 404);
  assert.ok(audited(db).some((e) => e.action === 'settings.center' && /Default restored/.test(e.note)));

  // Only settings.center opens it; an account with it sees only the areas it may change itself.
  const hr = await signIn('hr.demo');
  assert.equal((await hr('GET', '/api/admin/config')).status, 403);
  await admin('PUT', '/api/admin/roles', { permissions: { hr: [...ROLES.hr.permissions, 'settings.center'] } });
  const hrCfg = await hr('GET', '/api/admin/config');
  assert.deepEqual(hrCfg.areas.map((a) => a.id).sort(), ['approvals', 'leaveTypes', 'location', 'payroll'].sort());
  assert.equal((await hr('POST', '/api/admin/config/reset', { area: 'security' })).status, 403);
});

test('settings center: export and import round trip, no secrets, a preview, all or nothing', async () => {
  const { db, admin, signIn } = await company({ demo: true });
  // A mailbox password is saved (sealed): it must never be exported.
  await admin('PUT', '/api/helpdesk/settings/mailbox', { address: 'help@ltdc.ph', host: 'imap.ltdc.ph', user: 'help@ltdc.ph', password: 'Mailbox-Secret-99', port: 993 });
  const file = await admin('GET', '/api/admin/config/export');
  const text = JSON.stringify(file);
  assert.equal(file.coreSettings, 1);
  for (const secret of ['Mailbox-Secret-99', 'passwordSealed', 'passwordHash', 'imap.ltdc.ph', 'secret']) assert.ok(!text.includes(secret), `no ${secret} in the export`);
  assert.ok(!('helpdeskMail' in file.areas) && !('payroll' in file.areas) && !('leaveTypes' in file.areas));
  assert.ok(file.areas.crm && file.areas.security && file.areas.roles && file.areas.branding);

  // Change some settings, then bring the file back.
  await admin('PUT', '/api/security-settings', { sessionIdleMinutes: 30, requestsPerMinute: 900 });
  await admin('PUT', '/api/settings', { companyName: 'Someone Else Inc.', branding: { theme: 'navy', headline: 'Hello' } });
  await admin('PUT', '/api/admin/modules', { modules: { projects: false } });
  const preview = await admin('POST', '/api/admin/config/import/preview', { file });
  const sec = preview.areas.find((a) => a.id === 'security');
  assert.deepEqual(sec.changes.map((c) => [c.path, c.from, c.to]).sort(), [['requestsPerMinute', 900, 300], ['sessionIdleMinutes', 30, 480]]);
  assert.equal(db.data.settings.security.sessionIdleMinutes, 30, 'a preview saves nothing');
  const r = await admin('POST', '/api/admin/config/import', { file, areas: ['security', 'company', 'branding', 'modules'] });
  assert.equal(r.areas, 4);
  assert.equal(db.data.settings.security.sessionIdleMinutes, 480);
  assert.equal(db.data.settings.companyName, file.areas.company.companyName);
  assert.equal(db.data.settings.branding.theme, 'core');
  assert.equal(db.data.modules.projects, true);
  assert.ok((await admin('GET', '/api/admin/config/history')).entries.some((e) => e.via === 'import' && e.area === 'security'));
  assert.equal(db.data.helpdesk.mailbox.host, 'imap.ltdc.ph', 'mail settings stay as they are');

  // One bad group refuses the whole import, and nothing is changed.
  const before = JSON.stringify([db.data.crm, db.data.settings, db.data.modules]);
  const bad = structuredClone(file);
  bad.areas.crm.renewalNoticeDays = 30;
  bad.areas.security.sessionIdleMinutes = 3; // below the screen's minimum of 5
  const refused = await admin('POST', '/api/admin/config/import', { file: bad, areas: ['crm', 'security'] });
  assert.equal(refused.status, 400);
  assert.match(refused.error, /Sign-in & security: .*Nothing was imported/);
  assert.equal(JSON.stringify([db.data.crm, db.data.settings, db.data.modules]), before);
  // A branding the screen would refuse is refused here too (same validator).
  const ugly = structuredClone(file);
  ugly.areas.branding = { theme: 'custom', color: '#ffff00' };
  assert.match((await admin('POST', '/api/admin/config/import', { file: ugly, areas: ['branding'] })).error, /hard to read/);
  // Not a settings file; nothing ticked; roles in a file cannot give admin-only powers.
  assert.match((await admin('POST', '/api/admin/config/import', { file: { hello: 1 }, areas: ['crm'] })).error, /not a CORE settings file/);
  assert.match((await admin('POST', '/api/admin/config/import', { file, areas: [] })).error, /at least one/);
  const sneaky = structuredClone(file);
  sneaky.areas.roles = { employee: { add: ['users.manage'], remove: [] } };
  assert.match((await admin('POST', '/api/admin/config/import', { file: sneaky, areas: ['roles'] })).error, /stays with administrators/);
  assert.deepEqual(db.data.roleOverrides, {});
  // An account that may not change a group cannot import it.
  await admin('PUT', '/api/admin/roles', { permissions: { hr: [...ROLES.hr.permissions, 'settings.center'] } });
  const hr = await signIn('hr.demo');
  assert.match((await hr('POST', '/api/admin/config/import', { file, areas: ['security'] })).error, /cannot change these/);
  assert.equal((await hr('GET', '/api/admin/config/export')).areas.security, undefined);
});

// ---------- Branding ----------
test('branding: presets and a readable company colour, the headline, and a logo checked by its bytes and served safely', async () => {
  // CORE maroon stays the default, with the gold accent.
  assert.deepEqual(themeColors({}), { brand: '#5d0013', accent: '#c28618' });
  for (const t of Object.values(THEMES)) assert.ok(readableOnBrand(t.brand), `${t.label} is readable with white text`);
  assert.ok(contrast('#5d0013', '#ffffff') > 12);
  assert.deepEqual(validateBranding({ theme: 'custom', color: '#1E3A5F', headline: '  Our  people,  one core. ' }), { theme: 'custom', color: '#1e3a5f', logo: '', headline: 'Our people, one core.' });
  assert.throws(() => validateBranding({ theme: 'custom', color: '#f5f5f5' }), /hard to read/);
  assert.throws(() => validateBranding({ theme: 'custom', color: 'red' }), /#5d0013/);
  assert.throws(() => validateBranding({ theme: 'custom', color: '' }), /Pick the company colour/);
  assert.throws(() => validateBranding({ theme: 'hotpink' }), /Choose one of the colours/);
  assert.throws(() => validateBranding({ headline: 'x'.repeat(200) }), /under 120/);
  assert.equal(validateBranding({ theme: 'navy', color: '#123456' }).color, '', 'a preset keeps no colour of its own');

  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
  const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(40)]);
  const url = (type, buf) => `data:${type};base64,${buf.toString('base64')}`;
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(WEBP), 'image/webp');
  assert.equal(checkLogo(url('image/png', PNG)), url('image/png', PNG));
  assert.equal(checkLogo(''), '');
  assert.throws(() => checkLogo(url('image/svg+xml', Buffer.from('<svg onload="alert(1)"/>'))), /PNG, JPEG or WebP/);
  assert.throws(() => checkLogo(url('image/png', Buffer.from('<script>alert(1)</script>xxxxxxxxxx'))), /not a PNG, JPEG or WebP/);
  assert.throws(() => checkLogo(url('image/png', JPEG)), /is a JPEG, not the PNG/);
  assert.throws(() => checkLogo(url('image/png', Buffer.concat([PNG, Buffer.alloc(310 * 1024)]))), /too large/);
  assert.throws(() => checkLogo('https://evil.example/logo.png'), /PNG, JPEG or WebP/);
  assert.throws(() => checkLogo(42), /PNG, JPEG or WebP/);

  const { db, admin, signIn } = await company({ demo: true });
  const saved = await admin('PUT', '/api/settings', { branding: { theme: 'custom', color: '#0f766e', headline: 'Built in Taguig.', logo: url('image/png', PNG) } });
  assert.match(saved.branding.logo, /^\/api\/public\/brand\/logo\?v=[0-9a-f]{12}$/, 'the browser gets the address, not the picture');
  assert.ok(db.data.settings.branding.logo.startsWith('data:image/png;base64,'));
  assert.ok(!JSON.stringify(await admin('GET', '/api/settings')).includes('base64'));
  // Before sign-in: the colours, headline and logo address for the sign-in page.
  const anon = browser(createApi(db));
  const status = await anon('GET', '/api/auth/status');
  assert.deepEqual([status.brand.brand, status.brand.accent, status.brand.headline], ['#0f766e', '#c28618', 'Built in Taguig.']);
  assert.equal(status.roleOverrides, undefined, 'nothing else before sign-in');
  // The logo: an image of its own type that cannot run anything.
  const logo = await anon('GET', '/api/public/brand/logo');
  assert.deepEqual(logo.data, PNG);
  assert.equal(logo.headers['Content-Type'], 'image/png');
  assert.match(logo.headers['Content-Security-Policy'], /default-src 'none'; sandbox/);
  assert.match(logo.headers['Content-Disposition'], /^inline; filename="logo.png"$/);
  // Refused on the screen: a light colour; an SVG. Only settings.edit may change it.
  assert.match((await admin('PUT', '/api/settings', { branding: { theme: 'custom', color: '#fde68a' } })).error, /hard to read/);
  assert.match((await admin('PUT', '/api/settings', { branding: { logo: url('image/svg+xml', Buffer.from('<svg/>')) } })).error, /PNG, JPEG or WebP/);
  assert.equal(db.data.settings.branding.color, '#0f766e', 'a refused save changes nothing');
  assert.equal((await (await signIn('hr.demo'))('PUT', '/api/settings', { branding: { theme: 'navy' } })).status, 403);
  // Removing the logo; the history keeps no picture.
  await admin('PUT', '/api/settings', { branding: { logo: '' } });
  assert.equal((await anon('GET', '/api/public/brand/logo')).status, 404);
  const h = await admin('GET', '/api/admin/config/history?area=branding');
  assert.ok(h.entries.length >= 2);
  // The CSP of CORE's pages still allows images only from CORE itself, data: and blob:.
  const { pagePolicy } = await import('../server/security.js');
  assert.match(pagePolicy(ROOT), /img-src 'self' data: blob:;/);
});

// ---------- Old addresses ----------
test('old addresses open the page where it is now, and every Admin panel page has a route', () => {
  assert.equal(redirectOf('/users'), '/admin/users');
  assert.equal(redirectOf('/settings'), '/admin/settings');
  assert.equal(redirectOf('/audit'), '/admin/audit');
  assert.equal(redirectOf('/devlog'), '/admin/devlog');
  assert.equal(redirectOf('/feedback/inbox'), '/admin/feedback');
  assert.equal(redirectOf('/feedback/inbox/abc-123'), '/admin/feedback/abc-123');
  assert.equal(redirectOf('/admin'), '/admin/dashboard');
  assert.equal(redirectOf('/feedback'), null, 'Send feedback stays where it is');
  assert.equal(redirectOf('/dashboard'), null);
  const app = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  for (const p of ['/admin/dashboard', '/admin/users', '/admin/roles', '/admin/access', '/admin/config', '/admin/modules', '/admin/settings', '/admin/security', '/admin/guides', '/admin/audit', '/admin/devlog', '/admin/feedback', '/admin/feedback/:id', '/admin/data', '/admin/demo']) {
    assert.ok(app.includes(`['${p}', `), `route ${p}`);
  }
  // The pages each keep their permission (the roles screen is administrators' only).
  assert.match(app, /\['\/admin\/roles', rolesView, 'roles\.manage'/);
  assert.match(app, /\['\/admin\/security', securityView, 'users\.manage'/);
  assert.ok(ADMIN_ONLY_PERMISSIONS.includes('roles.manage'));
});
