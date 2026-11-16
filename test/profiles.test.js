// Everyone's profile (0.32): a role in the company ("Employee" until an administrator sets one),
// shown to everyone signed in with the picture, name and department; the account, employment and
// module access only to the person and to administrators. Only administrators change the role.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { cleanCompanyRole, companyRoleOf, moduleAccess, DEFAULT_COMPANY_ROLE } from '../shared/profile.js';

const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-profile-')), 'db.json'));
const handle = createApi(db);
const client = () => {
  let cookie = '';
  return async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
};
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
  return true;
});
const PW = 'Correct-Horse-42';
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
const emp = await admin('POST', '/api/employees', { employeeNo: 'E-1', firstName: 'Juan', lastName: 'Cruz', hireDate: '2020-01-01', payType: 'monthly', rate: 30000, position: 'Software Engineer', department: 'Engineering' });
async function account(username, role, name, extra = {}) {
  const u = await admin('POST', '/api/users', { name, username, role, password: PW, mustChangePassword: false, ...extra });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: PW });
  c.id = u.id;
  return c;
}
const juan = await account('juan', 'employee', 'Juan Cruz', { employeeId: emp.id });
const pia = await account('pia', 'pm', 'Pia Manager', { companyRole: '  Delivery   Lead ' });

test('the role in the company: "Employee" until set; one cleaned line of text', () => {
  assert.equal(companyRoleOf({}), DEFAULT_COMPANY_ROLE);
  assert.equal(cleanCompanyRole('  Software\tEngineer  '), 'Software Engineer');
  assert.equal(cleanCompanyRole(''), null);
  assert.equal(cleanCompanyRole('employee'), null, 'the default is stored as nothing');
  assert.equal(cleanCompanyRole(null), null);
  assert.throws(() => cleanCompanyRole('x'.repeat(61)), /up to 60/);
  assert.throws(() => cleanCompanyRole({ a: 1 }), /as text/);
});

test('a new account is an Employee; set when created; the sign-in status carries it', async () => {
  assert.equal((await juan('GET', `/api/people/${juan.id}`)).companyRole, 'Employee');
  assert.equal((await pia('GET', `/api/people/${pia.id}`)).companyRole, 'Delivery Lead');
  assert.equal((await pia('GET', '/api/auth/status')).user.companyRole, 'Delivery Lead');
});

test('everyone signed in sees the public profile; only the person and administrators see the rest', async () => {
  const pub = await pia('GET', `/api/people/${juan.id}`);
  assert.deepEqual(Object.keys(pub).sort(), ['active', 'canEditRole', 'companyRole', 'department', 'id', 'name', 'self', 'sharedProjects', 'supervisor'].sort());
  assert.equal(pub.department, 'Engineering');
  assert.equal(pub.canEditRole, false);
  for (const [who, viewer] of [['own', juan], ['admin', admin]]) {
    const full = await viewer('GET', `/api/people/${juan.id}`);
    assert.equal(full.username, 'juan', who);
    assert.equal(full.accountType, 'employee', who);
    assert.equal(full.employee.position, 'Software Engineer', who);
    assert.ok(Array.isArray(full.modules), who);
    assert.equal(full.passwordHash, undefined, who);
    assert.equal(full.twoFactor, undefined, who);
  }
  assert.ok((await admin('GET', `/api/people/${juan.id}`)).roleSuggestions.includes('Delivery Lead'));
  assert.equal((await juan('GET', `/api/people/${juan.id}`)).roleSuggestions, undefined, 'suggestions only for administrators');
  await fails(juan('GET', '/api/people/nobody'), 404);
  await fails(client()('GET', `/api/people/${juan.id}`), 401);
});

test('module access on the profile follows the account type, grants, project membership and modules turned off', async () => {
  const mine = await juan('GET', `/api/people/${juan.id}`);
  const by = Object.fromEntries(mine.modules.map((m) => [m.id, m]));
  assert.equal(by.hr.home, '/me');
  assert.match(by.hr.detail, /Self-service/);
  assert.equal(by.assets.home, '/assets/mine');
  assert.equal(by.helpdesk.home, '/helpdesk/mine');
  assert.equal(by.crm.home, null);
  assert.equal(by.crm.detail, 'No access');
  assert.equal(by.projects.home, null);
  assert.equal(mine.adminPanel, false);
  // Added to a project: Projects opens.
  const p = await pia('POST', '/api/pm/projects', { name: 'Rollout', type: 'Internal', startDate: '2026-11-02' });
  await pia('PUT', `/api/pm/projects/${p.id}/members`, { version: p.version, members: [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }] });
  assert.equal((await juan('GET', `/api/people/${juan.id}`)).modules.find((m) => m.id === 'projects').home, '/projects');
  // On each other's profile: the project they share; nobody else sees it there.
  assert.deepEqual((await pia('GET', `/api/people/${juan.id}`)).sharedProjects.map((x) => x.name), ['Rollout']);
  assert.deepEqual((await admin('GET', `/api/people/${juan.id}`)).sharedProjects, [], 'not a member: none shared');
  // A grant: Sales & CRM for one person.
  await admin('PUT', `/api/crm/access/${juan.id}`, { access: true });
  assert.equal((await juan('GET', `/api/people/${juan.id}`)).modules.find((m) => m.id === 'crm').home, '/crm', 'a grant opens it');
  // Sales & CRM turned off for the company: closed for Juan, still open for the administrator.
  await admin('PUT', '/api/admin/modules', { modules: { crm: false } });
  assert.equal((await juan('GET', `/api/people/${juan.id}`)).modules.find((m) => m.id === 'crm').detail, 'Off for the company');
  const adm = (await admin('GET', `/api/people/${(await admin('GET', '/api/auth/status')).user.id}`));
  assert.equal(adm.modules.find((m) => m.id === 'crm').home, '/crm');
  assert.equal(adm.adminPanel, true);
  await admin('PUT', '/api/admin/modules', { modules: { crm: true } });
  // The same rules as the shared function the browser uses.
  const shared = moduleAccess({ role: 'sales' }, { modules: {} }).find((m) => m.id === 'crm');
  assert.equal(shared.home, '/crm');
});

test('only administrators change the role in the company; it is audited; cleared means Employee', async () => {
  await fails(juan('PUT', `/api/people/${juan.id}/company-role`, { companyRole: 'CEO' }), 403);
  await fails(pia('PUT', `/api/people/${juan.id}/company-role`, { companyRole: 'CEO' }), 403);
  await fails(admin('PUT', `/api/people/${juan.id}/company-role`, { companyRole: 'x'.repeat(61) }), 400, /up to 60/);
  const set = await admin('PUT', `/api/people/${juan.id}/company-role`, { companyRole: 'Team Lead' });
  assert.equal(set.companyRole, 'Team Lead');
  assert.equal((await pia('GET', `/api/people/${juan.id}`)).companyRole, 'Team Lead', 'everyone sees it');
  assert.ok(JSON.stringify(await admin('GET', '/api/audit')).includes('Team Lead'), 'the change is in the audit log');
  // The users edit form also sets it; leaving it out keeps it.
  const list = await admin('GET', '/api/users');
  const j = list.find((u) => u.username === 'juan');
  await admin('PUT', `/api/users/${juan.id}`, { name: j.name, username: j.username, role: j.role, employeeId: j.employeeId, active: true });
  assert.equal(db.data.users.find((u) => u.id === juan.id).companyRole, 'Team Lead');
  await admin('PUT', `/api/users/${juan.id}`, { name: j.name, username: j.username, role: j.role, employeeId: j.employeeId, active: true, companyRole: '' });
  assert.equal(db.data.users.find((u) => u.id === juan.id).companyRole, undefined);
  assert.equal((await juan('GET', `/api/people/${juan.id}`)).companyRole, 'Employee');
});

test('a disabled account: profile for administrators only', async () => {
  const off = await account('olga', 'employee', 'Olga Out', { employeeId: (await admin('POST', '/api/employees', { employeeNo: 'E-2', firstName: 'Olga', lastName: 'Out', hireDate: '2020-01-01', payType: 'monthly', rate: 20000 })).id });
  const list = await admin('GET', '/api/users');
  const o = list.find((u) => u.username === 'olga');
  await admin('PUT', `/api/users/${off.id}`, { name: o.name, username: o.username, role: o.role, employeeId: o.employeeId, active: false });
  await fails(pia('GET', `/api/people/${off.id}`), 404);
  assert.equal((await admin('GET', `/api/people/${off.id}`)).active, false);
});

test('the role in the company survives a backup and restore', async () => {
  await admin('PUT', `/api/people/${pia.id}/company-role`, { companyRole: 'Head of Delivery' });
  const backup = structuredClone(await admin('GET', '/api/admin/export'));
  await admin('POST', '/api/admin/import', { ...backup, password: PW });
  assert.equal(db.data.users.find((u) => u.username === 'pia').companyRole, 'Head of Delivery');
  const bad = structuredClone(backup);
  bad.users.find((u) => u.username === 'pia').companyRole = 'x'.repeat(300);
  await fails(admin('POST', '/api/admin/import', { ...bad, password: PW }), 400, /role in the company/);
});
