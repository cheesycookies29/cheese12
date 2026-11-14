// Members-only projects (0.25): a project is for the people on its member list (and administrators),
// whatever their account type: Project Managers and Sales Managers see only the projects they are
// on, anywhere a project shows (the portfolio, its pages and tasks, My work, Milestones, the
// timesheet, Sales & CRM, the Service Desk). Nobody shuts themselves out of a project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { addDays, projectAccess } from '../shared/projects.js';

const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-private-')), 'db.json'));
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
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
let empNo = 0;
async function account(username, role, name) {
  const [firstName, lastName] = name.split(' ');
  const employeeId = role === 'employee' ? (await admin('POST', '/api/employees', { employeeNo: `E-${++empNo}`, firstName, lastName, hireDate: '2020-01-01', payType: 'monthly', rate: 30000 })).id : null;
  const u = await admin('POST', '/api/users', { name, username, role, employeeId, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  c.id = u.id;
  return c;
}
const pia = await account('pia', 'pm', 'Pia Manager');
const pat = await account('pat', 'pm', 'Pat Other');
const juan = await account('juan', 'employee', 'Juan Cruz');
const ivan = await account('ivan', 'it', 'Ivan Agent');
const bea = await account('bea', 'salesmgr', 'Bea Sales');
await admin('PUT', `/api/pm/access/${bea.id}`, { access: true });
const day = (n) => addDays(localDate(), n);
const members = (p, list) => pia('PUT', `/api/pm/projects/${p.id}/members`, { members: list, version: p.version });

test('the rule: members by role, administrators everything; account types alone open nothing (templates: read to start from)', () => {
  const p = { members: [{ userId: 'm', role: 'manager' }, { userId: 'w', role: 'member' }, { userId: 'v', role: 'viewer' }] };
  assert.equal(projectAccess(p, { id: 'm', role: 'employee' }), 'manage');
  assert.equal(projectAccess(p, { id: 'w', role: 'employee' }), 'work');
  assert.equal(projectAccess(p, { id: 'v', role: 'employee' }), 'comment');
  assert.equal(projectAccess(p, { id: 'x', role: 'pm' }), null);
  assert.equal(projectAccess(p, { id: 'x', role: 'salesmgr' }), null);
  assert.equal(projectAccess(p, { id: 'x', role: 'admin' }), 'manage');
  assert.equal(projectAccess({ ...p, isTemplate: true }, { id: 'x', role: 'pm' }), 'read', 'a Project Manager starts from a template');
  assert.equal(projectAccess({ ...p, isTemplate: true }, { id: 'x', role: 'salesmgr' }), null);
});

test('a project is hidden from Project Managers who are not on it, and open to its members and administrators', async () => {
  const p = await pia('POST', '/api/pm/projects', { name: 'Board minutes archive', type: 'Internal', startDate: day(0) });
  const m = await members(p, [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }]);
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Scan the 2019 minutes', assigneeId: juan.id, dueDate: day(2) });
  await pia('POST', `/api/pm/projects/${p.id}/milestones`, { name: 'Scanned', dueDate: day(10) });

  // Pat (Project Manager, not on it): not in any list, not found anywhere.
  assert.ok(!(await pat('GET', '/api/pm/projects')).some((x) => x.id === p.id));
  assert.ok(!(await pat('GET', '/api/pm/overview')).projects.some((x) => x.id === p.id));
  const ms = await pat('GET', '/api/pm/milestones');
  assert.ok(!(ms.rows || ms).some((x) => x.projectId === p.id));
  assert.ok(((await juan('GET', '/api/pm/milestones')).rows || []).some((x) => x.projectId === p.id), 'the member sees its milestone');
  await fails(pat('GET', `/api/pm/projects/${p.id}`), 404);
  await fails(pat('GET', `/api/pm/tasks/${t.id}`), 404);
  await fails(pat('PUT', `/api/pm/projects/${p.id}`, { name: 'Taken over', version: m.version }), 404);
  await fails(pat('POST', `/api/pm/projects/${p.id}/copy`, { name: 'Copy', startDate: day(1) }), 404);
  await fails(pat('DELETE', `/api/pm/projects/${p.id}`), 404);
  // Bea (Sales Manager with Projects access): the same.
  await fails(bea('GET', `/api/pm/projects/${p.id}`), 404);

  // Juan (member) and the administrator see it.
  assert.ok((await juan('GET', '/api/pm/projects')).some((x) => x.id === p.id));
  assert.ok(Object.values(await juan('GET', '/api/pm/my-work')).flat().some((x) => x.id === t.id));
  assert.equal((await admin('GET', `/api/pm/projects/${p.id}`)).access, 'manage');
  assert.ok((await admin('GET', '/api/pm/overview')).projects.some((x) => x.id === p.id));

  // A Project Manager who is only a viewer on it cannot delete it.
  const v = await pia('GET', `/api/pm/projects/${p.id}`);
  await members(v, [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }, { userId: pat.id, role: 'viewer' }]);
  assert.equal((await pat('GET', `/api/pm/projects/${p.id}`)).access, 'comment');
  await fails(pat('DELETE', `/api/pm/projects/${p.id}`), 403);

  // Taken off the list: gone for Juan, My work included.
  const now = await pia('GET', `/api/pm/projects/${p.id}`);
  await members(now, [{ userId: pia.id, role: 'manager' }]);
  await fails(juan('GET', `/api/pm/projects/${p.id}`), 404);
  assert.ok(!Object.values(await juan('GET', '/api/pm/my-work')).flat().some((x) => x.id === t.id));
});

test('nobody shuts themselves out: starting a project for someone else keeps you on it as a manager; you cannot take yourself off', async () => {
  const p = await pia('POST', '/api/pm/projects', { name: 'For Pat', type: 'Internal', startDate: day(0), managerId: pat.id });
  assert.deepEqual(p.members.map((m) => [m.userId, m.role]).sort(), [[pat.id, 'manager'], [pia.id, 'manager']].sort());
  assert.equal((await pia('GET', `/api/pm/projects/${p.id}`)).access, 'manage');
  await fails(pia('PUT', `/api/pm/projects/${p.id}/members`, { version: p.version, members: [{ userId: pat.id, role: 'manager' }] }), 400, /keep yourself/);
  // Pat (its manager) can take Pia off; an administrator changes anything without being on it.
  const off = await pat('PUT', `/api/pm/projects/${p.id}/members`, { version: p.version, members: [{ userId: pat.id, role: 'manager' }] });
  await fails(pia('GET', `/api/pm/projects/${p.id}`), 404);
  const renamed = await admin('PUT', `/api/pm/projects/${p.id}`, { name: 'For Pat (renamed)', version: off.version });
  assert.equal(renamed.name, 'For Pat (renamed)');
});

test('Sales & CRM lists a deal\'s project only to those on it', async () => {
  const acct = await bea('POST', '/api/crm/accounts', { name: 'Province of Quezon', sector: 'government' });
  const deal = await bea('POST', '/api/crm/deals', { title: 'Quezon payroll', accountId: acct.id, value: 500000 });
  await bea('PUT', `/api/crm/deals/${deal.id}/stage`, { stage: 'won' });
  const p = await bea('POST', `/api/pm/projects/from-deal/${deal.id}`, { startDate: day(1) });
  assert.deepEqual((await bea('GET', `/api/crm/deals/${deal.id}`)).projects.map((x) => x.id), [p.id]);
  const marco = await account('marco', 'salesmgr', 'Marco Tan');
  await admin('PUT', `/api/pm/access/${marco.id}`, { access: true });
  assert.deepEqual((await marco('GET', `/api/crm/deals/${deal.id}`)).projects, []);
  // Starting another project for the deal does not name the one he is not on.
  await fails(marco('POST', `/api/pm/projects/from-deal/${deal.id}`, {}), 409, /A project you are not on already delivers this deal/);
});

test('the Service Desk shows a task in a project you are not on only as "a task in a project you are not on"', async () => {
  const p = await pia('POST', '/api/pm/projects', { name: 'Server room move', type: 'Internal', startDate: day(0) });
  await members(p, [{ userId: pia.id, role: 'manager' }, { userId: ivan.id, role: 'member' }]);
  const ticket = await ivan('POST', '/api/helpdesk/tickets', { requesterName: 'Facilities', subject: 'Move the rack', body: 'Before the 20th.', priority: 'normal', category: 'Hardware' });
  const t = await ivan('POST', `/api/pm/tasks/from-ticket/${ticket.id}`, { projectId: p.id });
  assert.deepEqual((await ivan('GET', `/api/helpdesk/tickets/${ticket.id}`)).projectTasks.map((x) => x.key), [t.key]);
  const other = await account('olga', 'it', 'Olga Agent');
  const seen = (await other('GET', `/api/helpdesk/tickets/${ticket.id}`)).projectTasks;
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].id, seen[0].key, seen[0].projectName, seen[0].title], [null, '', '', 'A task in a project you are not on']);
});

test('a new project can come with its members', async () => {
  const p = await pia('POST', '/api/pm/projects', { name: 'Grievance case 7', type: 'Internal', startDate: day(0), managerId: pat.id, members: [{ userId: pia.id, role: 'member' }, { userId: juan.id, role: 'viewer' }] });
  assert.deepEqual(p.members.map((m) => [m.userId, m.role]).sort(), [[juan.id, 'viewer'], [pat.id, 'manager'], [pia.id, 'member']].sort());
  assert.equal((await juan('GET', `/api/pm/projects/${p.id}`)).access, 'comment');
  const before = db.data.pmProjects.length;
  await fails(pia('POST', '/api/pm/projects', { name: 'X', type: 'Internal', startDate: day(0), members: [{ userId: 'ghost', role: 'member' }] }), 400, /active accounts/);
  await fails(pia('POST', '/api/pm/projects', { name: 'X', type: 'Internal', startDate: day(0), members: [{ userId: juan.id }, { userId: juan.id }] }), 400, /twice/);
  assert.equal(db.data.pmProjects.length, before);
});
