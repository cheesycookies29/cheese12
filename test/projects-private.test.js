// Private projects (0.24): only the people on the member list (and administrators) can see one.
// Projects-wide access (Project Managers, pm.view grants) does not reach it, anywhere a project
// shows: the portfolio, its pages and tasks, My work, Milestones, the timesheet, Sales & CRM and
// the Service Desk. Nobody makes a project private and shuts themselves out.
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

test('the rule: members by role; Projects-wide access and pm.edit stop at a private project; administrators keep it', () => {
  const p = { private: true, members: [{ userId: 'm', role: 'manager' }, { userId: 'w', role: 'member' }, { userId: 'v', role: 'viewer' }] };
  assert.equal(projectAccess(p, { id: 'm', role: 'employee' }), 'manage');
  assert.equal(projectAccess(p, { id: 'w', role: 'employee' }), 'work');
  assert.equal(projectAccess(p, { id: 'v', role: 'employee' }), 'comment');
  assert.equal(projectAccess(p, { id: 'x', role: 'pm' }), null);
  assert.equal(projectAccess(p, { id: 'x', role: 'admin' }), 'manage');
  assert.equal(projectAccess({ ...p, private: false }, { id: 'x', role: 'pm' }), 'manage');
});

test('a private project is hidden from Project Managers who are not on it, and open to its members', async () => {
  const p = await pia('POST', '/api/pm/projects', { name: 'Board minutes archive', type: 'Internal', startDate: day(0), private: true });
  assert.equal(p.private, true);
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

  // Juan (member) and the administrator see it.
  assert.ok((await juan('GET', '/api/pm/projects')).some((x) => x.id === p.id));
  assert.ok(Object.values(await juan('GET', '/api/pm/my-work')).flat().some((x) => x.id === t.id));
  assert.equal((await admin('GET', `/api/pm/projects/${p.id}`)).id, p.id);

  // A Project Manager who is only a viewer of a private project cannot delete it.
  const v = await pia('GET', `/api/pm/projects/${p.id}`);
  await members(v, [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }, { userId: pat.id, role: 'viewer' }]);
  assert.equal((await pat('GET', `/api/pm/projects/${p.id}`)).access, 'comment');
  await fails(pat('DELETE', `/api/pm/projects/${p.id}`), 403);
  assert.ok(db.data.pmProjects.some((x) => x.id === p.id));
  // Taken off the list: gone for Juan too, My work included.
  const now = await pia('GET', `/api/pm/projects/${p.id}`);
  await members(now, [{ userId: pia.id, role: 'manager' }]);
  await fails(juan('GET', `/api/pm/projects/${p.id}`), 404);
  assert.ok(!Object.values(await juan('GET', '/api/pm/my-work')).flat().some((x) => x.id === t.id));
});

test('you cannot make a project private and shut yourself out (administrators always keep access)', async () => {
  // Creating it with someone else as manager, and yourself not on it.
  await fails(pia('POST', '/api/pm/projects', { name: 'Not mine', type: 'Internal', startDate: day(0), managerId: pat.id, private: true }), 400, /add yourself/);
  // Turning an open project private while you are not on it.
  const open = await pat('POST', '/api/pm/projects', { name: 'Open one', type: 'Internal', startDate: day(0) });
  await fails(pia('PUT', `/api/pm/projects/${open.id}`, { private: true, version: open.version }), 400, /add yourself/);
  assert.equal(db.data.pmProjects.find((x) => x.id === open.id).private, false, 'nothing changed');
  // Its manager can, and an administrator can without being on it.
  const priv = await pat('PUT', `/api/pm/projects/${open.id}`, { private: true, version: open.version });
  assert.equal(priv.private, true);
  await fails(pia('GET', `/api/pm/projects/${open.id}`), 404);
  const back = await admin('PUT', `/api/pm/projects/${open.id}`, { private: false, version: priv.version });
  assert.equal(back.private, false);
  assert.deepEqual(db.data.pmProjects.find((x) => x.id === open.id).history.filter((h) => h.field === 'private').map((h) => h.to), ['Yes', 'No']);
  // Only true or false.
  await fails(pat('PUT', `/api/pm/projects/${open.id}`, { private: 'yes', version: back.version }), 400);
});

test('a copy stays private unless told otherwise', async () => {
  const src = await pia('POST', '/api/pm/projects', { name: 'Salary review', type: 'Internal', startDate: day(0), private: true });
  const copy = await pia('POST', `/api/pm/projects/${src.id}/copy`, { name: 'Salary review 2027', startDate: day(30) });
  assert.equal(copy.private, true);
  const open = await pia('POST', `/api/pm/projects/${src.id}/copy`, { name: 'Salary review (open)', startDate: day(30), private: false });
  assert.equal(open.private, false);
});

test('Sales & CRM lists a deal\'s private project only to those who can open it', async () => {
  const acct = await bea('POST', '/api/crm/accounts', { name: 'Province of Quezon', sector: 'government' });
  const deal = await bea('POST', '/api/crm/deals', { title: 'Quezon payroll', accountId: acct.id, value: 500000 });
  await bea('PUT', `/api/crm/deals/${deal.id}/stage`, { stage: 'won' });
  const p = await bea('POST', `/api/pm/projects/from-deal/${deal.id}`, { startDate: day(1) });
  await bea('PUT', `/api/pm/projects/${p.id}`, { private: true, version: p.version });
  assert.deepEqual((await bea('GET', `/api/crm/deals/${deal.id}`)).projects.map((x) => x.id), [p.id]);
  const marco = await account('marco', 'salesmgr', 'Marco Tan');
  await admin('PUT', `/api/pm/access/${marco.id}`, { access: true });
  assert.deepEqual((await marco('GET', `/api/crm/deals/${deal.id}`)).projects, []);
  // Starting another project for the deal does not name the private one.
  await fails(marco('POST', `/api/pm/projects/from-deal/${deal.id}`, {}), 409, /A private project already delivers this deal/);
});

test('the Service Desk shows a task in a private project only as "a task in a private project"', async () => {
  const p = await pia('POST', '/api/pm/projects', { name: 'Server room move', type: 'Internal', startDate: day(0), private: true });
  await members(p, [{ userId: pia.id, role: 'manager' }, { userId: ivan.id, role: 'member' }]);
  const ticket = await ivan('POST', '/api/helpdesk/tickets', { requesterName: 'Facilities', subject: 'Move the rack', body: 'Before the 20th.', priority: 'normal', category: 'Hardware' });
  const t = await ivan('POST', `/api/pm/tasks/from-ticket/${ticket.id}`, { projectId: p.id });
  assert.deepEqual((await ivan('GET', `/api/helpdesk/tickets/${ticket.id}`)).projectTasks.map((x) => x.key), [t.key]);
  const other = await account('olga', 'it', 'Olga Agent');
  const seen = (await other('GET', `/api/helpdesk/tickets/${ticket.id}`)).projectTasks;
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].id, seen[0].key, seen[0].projectName, seen[0].title], [null, '', '', 'A task in a private project']);
});
