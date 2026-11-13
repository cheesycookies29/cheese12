// Project Management (MOD-05): who can see and change what, input checks, board order, version
// conflicts, progress, health, copying, the Sales & CRM and Service Desk hand-offs,
// CSV safety, demo data, migration and the audit log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { migratePm, keepPmConfig, emptyPm } from '../server/projects.js';
import { areaOfPath } from '../shared/audit.js';
import { toCsv } from '../public/js/ui.js';
import {
  DEFAULT_STATUSES, placeInColumn, progressOf, leafTasks, expectedPercent, milestoneStatus, projectStatus, workCalendar,
  makesCycle, myWorkGroup, mentionParts, taskCsvRows, statusSetProblem, addDays, weekStart, validHours,
} from '../shared/projects.js';

const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-')), 'db.json'));
const handle = createApi(db);
function client() {
  let cookie = '';
  return async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
}
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
let empNo = 0;
async function account(username, role, name, { employee = false } = {}) {
  let employeeId = null;
  if (employee || role === 'employee') {
    const [firstName, lastName] = name.split(' ');
    employeeId = (await admin('POST', '/api/employees', { employeeNo: `E-${++empNo}`, firstName, lastName, hireDate: '2020-01-01', payType: 'monthly', rate: 30000 })).id;
  }
  const u = await admin('POST', '/api/users', { name, username, role, employeeId, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  c.id = u.id;
  c.employeeId = employeeId;
  return c;
}
const pia = await account('pia', 'pm', 'Pia Manager');
const juan = await account('juan', 'employee', 'Juan Cruz');
const vic = await account('vic', 'employee', 'Vic Viewer');
const hana = await account('hana', 'hr', 'Hana HR');
const marco = await account('marco', 'salesmgr', 'Marco Tan');
const sofia = await account('sofia', 'sales', 'Sofia Lim');
const ivan = await account('ivan', 'it', 'Ivan Agent');
const today = localDate();
const day = (n) => addDays(today, n);
const settings = () => db.data.settings;

// It tracks time, so its members log hours (a project does not, unless a manager turns it on).
const base = await pia('POST', '/api/pm/projects', { name: 'Clinic system rollout', type: 'Client', startDate: day(-20), endDate: day(60), timeTracking: true });

test('Project Managers create projects; members open theirs by role; everyone else gets "not found"', async () => {
  assert.equal(base.code, 'PRJ-0001');
  assert.equal(base.access, 'manage');
  assert.deepEqual(base.members.map((m) => [m.name, m.role]), [['Pia Manager', 'manager']]);
  // Sales officers, HR and employees cannot create projects or see this one.
  for (const c of [sofia, hana, juan]) {
    await assert.rejects(c('POST', '/api/pm/projects', { name: 'X', startDate: today }), /does not have access/);
    await assert.rejects(c('GET', `/api/pm/projects/${base.id}`), /Project not found/);
    assert.deepEqual((await c('GET', '/api/pm/overview')).projects, []);
  }
  const t = await pia('POST', `/api/pm/projects/${base.id}/tasks`, { title: 'Install servers' });
  // A task id guessed by a non-member is "not found" too, for every task route (no IDOR).
  for (const [m, u, b] of [['GET', `/api/pm/tasks/${t.id}`], ['PUT', `/api/pm/tasks/${t.id}`, { title: 'x' }], ['PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'done' }], ['GET', `/api/pm/tasks/${t.id}/comments`], ['POST', `/api/pm/tasks/${t.id}/comments`, { body: 'hi' }], ['DELETE', `/api/pm/tasks/${t.id}`], ['GET', `/api/pm/projects/${base.id}/time`], ['POST', `/api/pm/projects/${base.id}/time`, { date: today, hours: 1 }]]) {
    await assert.rejects(juan(m, u, b), /not found/, `${m} ${u}`);
  }
  // Members: Juan works on tasks, Vic only reads and comments.
  await pia('PUT', `/api/pm/projects/${base.id}/members`, { version: (await pia('GET', `/api/pm/projects/${base.id}`)).version, members: [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }, { userId: vic.id, role: 'viewer' }] });
  assert.equal((await juan('GET', `/api/pm/projects/${base.id}`)).access, 'work');
  assert.equal((await juan('GET', '/api/pm/overview')).projects.length, 1);
  assert.equal((await juan('GET', '/api/auth/status')).user.inProjects, true);
  const mine = await juan('POST', `/api/pm/projects/${base.id}/tasks`, { title: 'Configure printers' });
  await juan('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'doing' });
  await juan('POST', `/api/pm/tasks/${t.id}/comments`, { body: 'Started.' });
  await juan('POST', `/api/pm/projects/${base.id}/time`, { date: today, hours: 1, taskId: t.id });
  await assert.rejects(juan('PUT', `/api/pm/projects/${base.id}`, { name: 'Renamed' }), /Only the project's managers/);
  await assert.rejects(juan('PUT', `/api/pm/projects/${base.id}/members`, { members: [] }), /Only the project's managers/);
  await assert.rejects(juan('DELETE', `/api/pm/tasks/${t.id}`), /Only the person who added the task/);
  assert.ok((await juan('DELETE', `/api/pm/tasks/${mine.id}`)).ok, 'the person who added a task can delete it');
  assert.equal((await vic('GET', `/api/pm/projects/${base.id}`)).access, 'comment');
  await vic('POST', `/api/pm/tasks/${t.id}/comments`, { body: 'Looks good.' });
  await assert.rejects(vic('POST', `/api/pm/projects/${base.id}/tasks`, { title: 'X' }), /read and comment/);
  await assert.rejects(vic('PUT', `/api/pm/tasks/${t.id}`, { title: 'X' }), /read and comment/);
  await assert.rejects(vic('POST', `/api/pm/projects/${base.id}/time`, { date: today, hours: 1 }), /read and comment/);
  // The Sales Manager sees every project, read only.
  assert.equal((await marco('GET', `/api/pm/projects/${base.id}`)).access, 'read');
  await assert.rejects(marco('POST', `/api/pm/tasks/${t.id}/comments`, { body: 'x' }), /not comment/);
  await assert.rejects(marco('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'done' }), /not change its tasks/);
  await assert.rejects(marco('POST', '/api/pm/projects', { name: 'X', startDate: today }), /does not have access/);
  // Deleting projects and the setup: pm.manage only.
  await assert.rejects(marco('DELETE', `/api/pm/projects/${base.id}`), /does not have access/);
  await assert.rejects(juan('GET', '/api/pm/settings'), /does not have access/);
  assert.ok((await pia('GET', '/api/pm/settings')).statuses.length);
  // Workload was removed (0.17.1): its route is gone for everyone.
  await assert.rejects(marco('GET', '/api/pm/workload'), /Not found/);
});

test('administrators give or remove Projects access per account, like CRM access', async () => {
  const users = await admin('GET', '/api/users');
  const hanaId = users.find((u) => u.username === 'hana').id;
  await admin('PUT', `/api/pm/access/${hanaId}`, { access: true });
  assert.equal((await hana('GET', '/api/pm/overview')).projects.length, 1, 'access shows every project');
  const own = await hana('POST', '/api/pm/projects', { name: 'HR onboarding revamp', type: 'Internal', startDate: today });
  await assert.rejects(hana('DELETE', `/api/pm/projects/${own.id}`), /does not have access/, 'access does not include deleting');
  assert.equal(db.data.users.find((u) => u.id === hanaId).pmAccess, true);
  // Removing it from a Project Manager also takes away deleting and the setup.
  await admin('PUT', `/api/pm/access/${pia.id}`, { access: false });
  await assert.rejects(pia('GET', '/api/pm/settings'), /does not have access/);
  await assert.rejects(pia('POST', '/api/pm/projects', { name: 'X', startDate: today }), /does not have access/);
  // Pia still manages the project she is the manager of: membership opens it.
  assert.equal((await pia('GET', `/api/pm/projects/${base.id}`)).access, 'manage');
  await assert.rejects(pia('GET', `/api/pm/projects/${own.id}`), /not found/);
  const list = await admin('GET', '/api/pm/access');
  assert.equal(list.find((x) => x.id === pia.id).override, false);
  await admin('PUT', `/api/pm/access/${pia.id}`, { access: null });
  await admin('PUT', `/api/pm/access/${hanaId}`, { access: null });
  assert.ok((await pia('GET', '/api/pm/settings')).types);
  // Hana keeps the project she started: she is its manager, and members open their projects.
  assert.equal((await hana('GET', `/api/pm/projects/${own.id}`)).access, 'manage');
  await assert.rejects(hana('GET', `/api/pm/projects/${base.id}`), /not found/);
  await assert.rejects(admin('PUT', `/api/pm/access/${users.find((u) => u.username === 'admin').id}`, { access: false }), /Administrators always/);
  await assert.rejects(admin('PUT', `/api/pm/access/${hanaId}`, { access: 'yes' }), /Choose whether/);
  await assert.rejects(pia('GET', '/api/pm/access'), /does not have access/);
  const log = (await admin('GET', '/api/audit?area=user')).entries.filter((e) => e.changes?.some((c) => c.field === 'Projects access'));
  assert.ok(log.length >= 2);
  await admin('DELETE', `/api/pm/projects/${own.id}`);
});

test('inputs are checked: dates, choices, hours, lengths, one level of subtasks, blocked-by rules, no extra fields', async () => {
  const p = base.id;
  for (const bad of ['2026-02-30', 'tomorrow', ['2026-11-20'], { d: 1 }, '2026-13-01']) {
    await assert.rejects(pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'T', dueDate: bad }), /must be a date/);
  }
  await assert.rejects(pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'T', startDate: day(5), dueDate: day(1) }), /before the start/);
  await assert.rejects(pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'T', priority: 'asap' }), /Priority: pick one/);
  await assert.rejects(pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'T', statusId: 'nope' }), /status from this project/);
  for (const size of ['XXL', 'm', 8, ['M'], { M: 1 }]) await assert.rejects(pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'T', size }), /Size: pick XS, S, M, L, XL/);
  assert.equal((await pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'Sized', size: 'L' })).size, 'L');
  // Hours are not a task field any more: an estimate sent is ignored.
  assert.equal((await pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'Old form', estimateHours: 8 })).estimateHours, undefined);
  await assert.rejects(pia('POST', `/api/pm/projects/${p}/tasks`, { title: '   ' }), /title/);
  await assert.rejects(pia('PUT', `/api/pm/projects/${p}`, { status: 'archived' }), /Status: pick one/);
  await assert.rejects(pia('PUT', `/api/pm/projects/${p}`, { endDate: day(-100) }), /end date is before/);
  await assert.rejects(pia('POST', '/api/pm/projects', { name: 'No start' }), /start date/);
  // Lengths are cut, not stored whole.
  const long = await pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'x'.repeat(500), description: { evil: true } });
  assert.equal(long.title.length, 200);
  assert.equal(long.description, '');
  // No mass assignment: ids, keys, projects and versions come from the server.
  const sneaky = await pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'Sneaky', id: 'mine', key: 'PRJ-9999-1', projectId: 'other', version: 99, completedAt: 'x', ticketId: 'x' });
  assert.notEqual(sneaky.id, 'mine');
  assert.match(sneaky.key, /^PRJ-0001-\d+$/);
  assert.equal(sneaky.projectId, p);
  assert.equal(sneaky.version, 1);
  assert.equal(sneaky.ticketId, null);
  const before = await pia('GET', `/api/pm/projects/${p}`);
  await pia('PUT', `/api/pm/projects/${p}`, { code: 'HACK', members: [], statuses: [], taskSeq: 0, createdBy: 'x', version: before.version });
  const after = await pia('GET', `/api/pm/projects/${p}`);
  assert.equal(after.code, 'PRJ-0001');
  assert.equal(after.members.length, 3);
  assert.equal(after.statuses.length, 6);
  // Subtasks: one level only.
  const parent = await pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'Parent' });
  const child = await pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'Child', parentId: parent.id });
  await assert.rejects(pia('POST', `/api/pm/projects/${p}/tasks`, { title: 'Grandchild', parentId: child.id }), /one level deep/);
  await assert.rejects(pia('PUT', `/api/pm/tasks/${parent.id}`, { parentId: sneaky.id }), /has subtasks of its own/);
  await assert.rejects(pia('PUT', `/api/pm/tasks/${sneaky.id}`, { parentId: sneaky.id }), /own subtask/);
  // Blocked by: same project, no loops.
  const other = await pia('POST', '/api/pm/projects', { name: 'Other', startDate: today });
  const elsewhere = await pia('POST', `/api/pm/projects/${other.id}/tasks`, { title: 'Elsewhere' });
  await assert.rejects(pia('PUT', `/api/pm/tasks/${sneaky.id}`, { blockedBy: [elsewhere.id] }), /same project/);
  await assert.rejects(pia('PUT', `/api/pm/tasks/${sneaky.id}`, { blockedBy: [sneaky.id] }), /wait for itself/);
  await pia('PUT', `/api/pm/tasks/${sneaky.id}`, { blockedBy: [parent.id] });
  await assert.rejects(pia('PUT', `/api/pm/tasks/${parent.id}`, { blockedBy: [sneaky.id] }), /loop/);
  await assert.rejects(pia('PUT', `/api/pm/tasks/${sneaky.id}`, { blockedBy: 'nope' }), /Blocked by/);
  const blocked = (await pia('GET', `/api/pm/projects/${p}/tasks`)).find((t) => t.id === sneaky.id);
  assert.equal(blocked.blocked, true);
  await pia('PUT', `/api/pm/tasks/${parent.id}/move`, { statusId: 'done' });
  assert.equal((await pia('GET', `/api/pm/projects/${p}/tasks`)).find((t) => t.id === sneaky.id).blocked, false, 'a done blocker no longer blocks');
  // Assignees: members only; a manager's pick of someone new adds them as a member.
  await assert.rejects(juan('PUT', `/api/pm/tasks/${sneaky.id}`, { assigneeId: hana.id }), /not on this project/);
  await assert.rejects(pia('PUT', `/api/pm/tasks/${sneaky.id}`, { assigneeId: vic.id }), /viewer/);
  await pia('PUT', `/api/pm/tasks/${sneaky.id}`, { assigneeId: ivan.id });
  assert.ok((await pia('GET', `/api/pm/projects/${p}`)).members.some((m) => m.userId === ivan.id && m.role === 'member'));
  // Time: quarter hours from 0.25 to 24, today or earlier.
  for (const hours of [0, 0.1, 1.3, 25, '2e1', 'abc', -1]) await assert.rejects(juan('POST', `/api/pm/projects/${p}/time`, { date: day(-1), hours }), /quarter hours/);
  await assert.rejects(juan('POST', `/api/pm/projects/${p}/time`, { date: day(1), hours: 1 }), /today or earlier/);
  await assert.rejects(juan('POST', `/api/pm/projects/${p}/time`, { date: day(-1), hours: 1, taskId: elsewhere.id }), /task of this project/);
  assert.equal((await juan('POST', `/api/pm/projects/${p}/time`, { date: day(-1), hours: '1.75' })).hours, 1.75);
  assert.ok(validHours(0.25) && validHours(24) && !validHours(24.25) && !validHours(0.3));
  // Statuses: at least one To do and one Done; tasks in a removed status need somewhere to go.
  const statuses = after.statuses;
  await assert.rejects(pia('PUT', `/api/pm/projects/${p}/statuses`, { statuses: statuses.filter((s) => s.category !== 'done') }), /"Done" category/);
  await assert.rejects(pia('PUT', `/api/pm/projects/${p}/statuses`, { statuses: statuses.filter((s) => s.category !== 'todo') }), /"To do" category/);
  await assert.rejects(pia('PUT', `/api/pm/projects/${p}/statuses`, { statuses: statuses.map((s) => ({ ...s, name: 'Same' })) }), /same name/);
  await assert.rejects(pia('PUT', `/api/pm/projects/${p}/statuses`, { statuses: statuses.map((s) => ({ ...s, color: 'url(evil)' })) }), /Colour/);
  await assert.rejects(pia('PUT', `/api/pm/projects/${p}/statuses`, { statuses: statuses.filter((s) => s.id !== 'doing') }), /in "In progress". Choose the status/);
  const moved = await pia('PUT', `/api/pm/projects/${p}/statuses`, { statuses: statuses.filter((s) => s.id !== 'review'), moveTo: {} });
  assert.equal(moved.statuses.length, 5);
  const fewer = statuses.filter((s) => !['waiting', 'review'].includes(s.id)).map((s) => (s.id === 'doing' ? { ...s, wipLimit: 2 } : s));
  await pia('PUT', `/api/pm/projects/${p}/statuses`, { statuses: [...fewer, { name: 'On site', category: 'active', color: 'teal' }] });
  const now = await pia('GET', `/api/pm/projects/${p}`);
  assert.equal(now.statuses.length, 5);
  assert.ok(now.statuses.find((s) => s.name === 'On site').id.startsWith('st-'));
  assert.equal(now.statuses.find((s) => s.id === 'doing').wipLimit, 2);
  assert.ok(statusSetProblem([{ name: 'A', category: 'todo' }]));
  await pia('DELETE', `/api/pm/projects/${other.id}`);
});

test('board order: the midpoint of the neighbours, the ends, and renumbering when gaps run out', async () => {
  const col = [{ id: 'a', rank: 1024 }, { id: 'b', rank: 2048 }, { id: 'c', rank: 3072 }];
  assert.deepEqual(placeInColumn(col, 'a', 'b'), { rank: 1536, position: 1, renumber: null });
  assert.equal(placeInColumn(col, null, 'a').rank, 0, 'at the top: 1024 before the first');
  assert.equal(placeInColumn(col, 'c', null).rank, 4096, 'at the bottom: 1024 after the last');
  assert.equal(placeInColumn([], null, null).rank, 1024);
  assert.equal(placeInColumn(col, 'gone', null).rank, 4096, 'a neighbour no longer there: the bottom');
  const tight = [{ id: 'a', rank: 1 }, { id: 'b', rank: 1 + 1e-7 }];
  const r = placeInColumn(tight, 'a', 'b');
  assert.deepEqual([...r.renumber.entries()], [['a', 1024], [null, 2048], ['b', 3072]]);
  assert.equal(r.rank, 2048);
  // Through the API: drop between two cards, then squeeze until the column is renumbered.
  const p = await pia('POST', '/api/pm/projects', { name: 'Order test', startDate: today });
  const ts = [];
  for (const title of ['One', 'Two', 'Three']) ts.push(await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title }));
  const order = async () => (await pia('GET', `/api/pm/projects/${p.id}/tasks`)).filter((t) => t.statusId === 'todo').map((t) => t.title);
  assert.deepEqual(await order(), ['One', 'Two', 'Three']);
  await pia('PUT', `/api/pm/tasks/${ts[2].id}/move`, { statusId: 'todo', beforeId: ts[0].id, afterId: ts[1].id });
  assert.deepEqual(await order(), ['One', 'Three', 'Two']);
  const top = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Top', position: 'top' });
  assert.deepEqual(await order(), ['Top', 'One', 'Three', 'Two']);
  // Squeeze two cards in turn between "One" and each other: the gap halves each time until the
  // column is renumbered, and the order stays right throughout.
  for (let i = 0; i < 40; i++) {
    const [a, b] = i % 2 ? [ts[2], top] : [top, ts[2]];
    await pia('PUT', `/api/pm/tasks/${a.id}/move`, { statusId: 'todo', beforeId: ts[0].id, afterId: b.id });
  }
  assert.deepEqual(await order(), ['One', 'Three', 'Top', 'Two']);
  const ranks = db.data.pmTasks.filter((t) => t.projectId === p.id && t.statusId === 'todo').map((t) => t.rank).sort((x, y) => x - y);
  assert.ok(ranks.every(Number.isFinite));
  assert.ok(ranks.every((r, i) => !i || r - ranks[i - 1] > 1e-6), 'no two cards end up on the same place');
  // Moving into Done stamps completedAt; out of it clears it. A WIP limit warns, never refuses.
  const moved = await pia('PUT', `/api/pm/tasks/${ts[1].id}/move`, { statusId: 'done' });
  assert.ok(moved.completedAt);
  assert.equal((await pia('PUT', `/api/pm/tasks/${ts[1].id}/move`, { statusId: 'doing' })).completedAt, null);
  const st = (await pia('GET', `/api/pm/projects/${p.id}`)).statuses.map((s) => (s.id === 'doing' ? { ...s, wipLimit: 1 } : s));
  await pia('PUT', `/api/pm/projects/${p.id}/statuses`, { statuses: st });
  const over = await pia('PUT', `/api/pm/tasks/${ts[0].id}/move`, { statusId: 'doing' });
  assert.match(over.wipWarning, /limit is 1/);
  await pia('DELETE', `/api/pm/projects/${p.id}`);
});

test('a stale form is refused with who changed it; board moves skip the check but bump the version', async () => {
  const t = await pia('POST', `/api/pm/projects/${base.id}/tasks`, { title: 'Versioned' });
  const saved = await juan('PUT', `/api/pm/tasks/${t.id}`, { title: 'Versioned (Juan)', version: t.version });
  assert.equal(saved.version, 2);
  await assert.rejects(pia('PUT', `/api/pm/tasks/${t.id}`, { title: 'Versioned (Pia)', version: t.version }), /changed by Juan Cruz since you opened it/);
  const moved = await pia('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'doing' });
  assert.equal(moved.version, 3);
  await assert.rejects(juan('PUT', `/api/pm/tasks/${t.id}`, { title: 'Late', version: 2 }), /changed by Pia Manager/);
  const p = await pia('GET', `/api/pm/projects/${base.id}`);
  await pia('PUT', `/api/pm/projects/${base.id}`, { description: 'v', version: p.version });
  await assert.rejects(pia('PUT', `/api/pm/projects/${base.id}`, { description: 'w', version: p.version }), /changed by/);
  // History keeps who changed the status.
  const full = await pia('GET', `/api/pm/tasks/${t.id}`);
  assert.ok(full.history.some((h) => h.field === 'status' && h.to === 'In progress' && h.byName === 'Pia Manager'));
});

const project = { statuses: DEFAULT_STATUSES, startDate: '2026-11-02' };
const task = (id, statusId, extra = {}) => ({ id, statusId, ...extra });

test('progress: by size when 60% of leaf tasks have one (the rest at the average weight), else by count', () => {
  // 2 of 4 sized (50%): by count. Cancelled tasks are left out.
  let leaves = leafTasks([task('a', 'done', { size: 'S' }), task('b', 'todo', { size: 'L' }), task('c', 'todo'), task('d', 'done'), task('x', 'cancelled', { size: 'XL' })], project);
  assert.deepEqual(progressOf(leaves, project), { percent: 50, basis: 'count', done: 2, total: 4, sized: 2 });
  // 3 of 4 sized: by size weights (S 2, L 5, M 3); the unsized one counts at their average (10/3).
  leaves = leafTasks([task('a', 'done', { size: 'S' }), task('b', 'todo', { size: 'L' }), task('c', 'todo', { size: 'M' }), task('d', 'done')], project);
  assert.deepEqual(progressOf(leaves, project), { percent: Math.round(((2 + 10 / 3) / (2 + 5 + 3 + 10 / 3)) * 100), basis: 'size', done: 2, total: 4, sized: 3 });
  assert.equal(progressOf(leaves, project).percent, 40);
  // A task with subtasks is measured by its subtasks.
  leaves = leafTasks([task('p', 'todo', { size: 'XL' }), task('s1', 'done', { parentId: 'p' }), task('s2', 'todo', { parentId: 'p' })], project);
  assert.deepEqual(leaves.map((t) => t.id), ['s1', 's2']);
  assert.equal(progressOf(leaves, project).percent, 50);
  assert.equal(progressOf([], project).percent, null);
});

test('health: late milestones are red; overdue or late tasks and falling behind the line (working days, holidays) are amber', () => {
  const cal = workCalendar({ schedule: { workDays: [1, 2, 3, 4, 5] } }, [{ date: '2026-11-04', type: 'regular' }]);
  // After Mon 2 Nov up to Fri 13 Nov: 8 working days (Wed 4 Nov is a holiday); by Fri 6 Nov, 3 of them: 38%.
  assert.equal(expectedPercent('2026-11-02', '2026-11-13', '2026-11-06', cal), 38);
  assert.equal(expectedPercent('2026-11-02', '2026-11-13', '2026-11-01', cal), 0);
  assert.equal(expectedPercent('2026-11-02', '2026-11-13', '2026-11-20', cal), 100);
  const m = { id: 'm1', name: 'Design', dueDate: '2026-11-13' };
  const ctx = (tasks, today) => ({ project, tasks, tasksById: new Map(tasks.map((t) => [t.id, t])), today, cal });
  const on = (tasks, today) => milestoneStatus(m, ctx(tasks, today));
  // On track: half done when 38% is expected.
  assert.equal(on([task('a', 'done', { milestoneId: 'm1' }), task('b', 'todo', { milestoneId: 'm1', dueDate: '2026-11-12' })], '2026-11-06').value, 'green');
  // Behind the line by more than 15 points: 0% when 38% is expected.
  const behind = on([task('a', 'todo', { milestoneId: 'm1', dueDate: '2026-11-12' }), task('b', 'todo', { milestoneId: 'm1', dueDate: '2026-11-12' })], '2026-11-06');
  assert.equal(behind.value, 'amber');
  assert.match(behind.reasons[0], /0% done; 38% expected/);
  // An overdue task; a task due after the milestone.
  assert.match(on([task('a', 'done', { milestoneId: 'm1' }), task('b', 'todo', { milestoneId: 'm1', dueDate: '2026-11-05' })], '2026-11-06').reasons[0], /1 overdue task/);
  assert.match(on([task('a', 'done', { milestoneId: 'm1' }), task('b', 'todo', { milestoneId: 'm1', dueDate: '2026-11-20' })], '2026-11-06').reasons[0], /due after the milestone/);
  // Past its date with open work: red. All done, or accepted: green.
  assert.equal(on([task('a', 'doing', { milestoneId: 'm1' })], '2026-11-16').value, 'red');
  assert.equal(on([task('a', 'done', { milestoneId: 'm1' })], '2026-11-16').value, 'green');
  assert.equal(milestoneStatus({ ...m, acceptedAt: '2026-11-12' }, ctx([task('a', 'doing', { milestoneId: 'm1' })], '2026-11-16')).value, 'green');
  // Subtasks follow their parent's milestone.
  assert.equal(on([task('p', 'todo', { milestoneId: 'm1' }), task('s', 'done', { parentId: 'p' })], '2026-11-06').progress.percent, 100);
  // The project: its worst milestone; amber with any overdue task; red past its end date with work open.
  const p = { ...project, status: 'active', endDate: '2026-11-30' };
  assert.equal(projectStatus(p, [m], [task('a', 'doing', { milestoneId: 'm1' })], '2026-11-16', cal).value, 'red');
  const one = projectStatus(p, [], [task('a', 'todo', { dueDate: '2026-11-10' }), task('b', 'todo')], '2026-11-16', cal);
  assert.equal(one.value, 'amber');
  assert.match(one.reasons[0], /1 of 2 open tasks is overdue/);
  assert.equal(projectStatus({ ...p, endDate: '2026-11-15' }, [], [task('b', 'todo')], '2026-11-16', cal).value, 'red');
  assert.equal(projectStatus({ ...p, status: 'completed' }, [], [task('b', 'todo')], '2026-11-16', cal).value, null);
});

test('health through the API: a manager\'s reading is kept next to the computed health', async () => {
  const p = await pia('POST', '/api/pm/projects', { name: 'Health check', startDate: day(-10), endDate: day(30) });
  await pia('POST', `/api/pm/projects/${p.id}/milestones`, { name: 'Late one', dueDate: day(-1) });
  await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Open work', milestoneId: (await pia('GET', `/api/pm/projects/${p.id}`)).milestones[0].id });
  await assert.rejects(pia('PUT', `/api/pm/projects/${p.id}/health`, { value: 'green' }), /Say why/);
  await assert.rejects(pia('PUT', `/api/pm/projects/${p.id}/health`, { value: 'blue', note: 'x' }), /Health: pick one/);
  await pia('PUT', `/api/pm/projects/${p.id}/health`, { value: 'amber', note: 'Client accepted a new date' });
  const got = await pia('GET', `/api/pm/projects/${p.id}`);
  assert.equal(got.health, 'red', 'the computed health stays');
  assert.equal(got.healthOverride.value, 'amber');
  assert.equal(got.healthOverride.byName, 'Pia Manager');
  await pia('PUT', `/api/pm/projects/${p.id}/health`, { value: null });
  assert.equal((await pia('GET', `/api/pm/projects/${p.id}`)).healthOverride, null);
  // Deliverables: billing at most 100%; a deliverable after the contract end is flagged (see the CRM test).
  await pia('POST', `/api/pm/projects/${p.id}/milestones`, { name: 'D1', dueDate: day(10), deliverable: true, billingPercent: 60 });
  await assert.rejects(pia('POST', `/api/pm/projects/${p.id}/milestones`, { name: 'D2', dueDate: day(20), deliverable: true, billingPercent: 50 }), /110%/);
  await assert.rejects(pia('POST', `/api/pm/projects/${p.id}/milestones`, { name: 'D2', dueDate: day(20), deliverable: 'yes' }), /true or false/);
  await assert.rejects(pia('POST', `/api/pm/projects/${p.id}/milestones`, { name: 'D2', dueDate: day(20), submittedAt: day(5), acceptedAt: day(1) }), /before it was submitted/);
  await pia('DELETE', `/api/pm/projects/${p.id}`);
});

test('copying a project as a template moves every date by the same number of days', async () => {
  const src = await pia('POST', '/api/pm/projects', { name: 'Template', startDate: '2026-01-05', endDate: '2026-03-31' });
  const ms = await pia('POST', `/api/pm/projects/${src.id}/milestones`, { name: 'Phase 1', dueDate: '2026-02-02', deliverable: true, billingPercent: 40, submittedAt: '2026-02-01', acceptedAt: '2026-02-03' });
  const a = await pia('POST', `/api/pm/projects/${src.id}/tasks`, { title: 'A', startDate: '2026-01-05', dueDate: '2026-01-09', milestoneId: ms.id, assigneeId: pia.id, size: 'S', checklist: ['one', 'two'] });
  const b = await pia('POST', `/api/pm/projects/${src.id}/tasks`, { title: 'B', dueDate: '2026-01-20', parentId: a.id });
  await pia('PUT', `/api/pm/tasks/${a.id}/move`, { statusId: 'done' });
  await pia('POST', `/api/pm/tasks/${a.id}/comments`, { body: 'Not copied' });
  const c = await pia('POST', `/api/pm/projects/${src.id}/copy`, { name: 'From template', startDate: '2026-04-06' });
  assert.notEqual(c.code, src.code);
  assert.equal(c.endDate, '2026-06-30');
  assert.equal(c.status, 'planning');
  const tasks = await pia('GET', `/api/pm/projects/${c.id}/tasks`);
  const ca = tasks.find((t) => t.title === 'A');
  const cb = tasks.find((t) => t.title === 'B');
  assert.deepEqual([ca.startDate, ca.dueDate, cb.dueDate], ['2026-04-06', '2026-04-10', '2026-04-21']);
  assert.equal(cb.parentId, ca.id);
  assert.equal(ca.assigneeId, null);
  assert.equal(ca.statusId, 'todo');
  assert.deepEqual(ca.checklist.map((i) => [i.text, i.done]), [['one', false], ['two', false]]);
  assert.deepEqual([ca.size, cb.size], ['S', null]);
  const cm = (await pia('GET', `/api/pm/projects/${c.id}`)).milestones[0];
  assert.deepEqual([cm.dueDate, cm.billingPercent, cm.acceptedAt, cm.submittedAt], ['2026-05-04', 40, null, null]);
  assert.equal(ca.milestoneId, cm.id);
  assert.deepEqual(await pia('GET', `/api/pm/tasks/${ca.id}/comments`), []);
  await assert.rejects(juan('POST', `/api/pm/projects/${src.id}/copy`, { name: 'X', startDate: today }), /does not have access/);
  void b;
  for (const id of [src.id, c.id]) await pia('DELETE', `/api/pm/projects/${id}`);
});

test('from Sales & CRM: a won deal or a contract starts a linked project, once', async () => {
  const acct = await marco('POST', '/api/crm/accounts', { name: 'Province of Laguna', sector: 'government' });
  const deal = await marco('POST', '/api/crm/deals', { title: 'Laguna HRIS', accountId: acct.id, value: 1000000 });
  await assert.rejects(pia('POST', `/api/pm/projects/from-deal/${deal.id}`, {}), /needs Sales & CRM access/, 'pm.edit alone is not enough');
  const both = await account('bea', 'salesmgr', 'Bea Both');
  await admin('PUT', `/api/pm/access/${both.id}`, { access: true });
  await assert.rejects(both('POST', `/api/pm/projects/from-deal/${deal.id}`, {}), /Only a won deal/);
  await assert.rejects(sofia('POST', `/api/pm/projects/from-deal/${deal.id}`, {}), /does not have access/);
  await marco('PUT', `/api/crm/deals/${deal.id}/stage`, { stage: 'won' });
  const contract = await marco('POST', '/api/crm/contracts', { title: 'Laguna HRIS contract', accountId: acct.id, dealId: deal.id, value: 1000000, startDate: day(-5), endDate: day(40) });
  const p = await both('POST', `/api/pm/projects/from-deal/${deal.id}`, { startDate: day(1) });
  assert.equal(p.name, 'Laguna HRIS');
  assert.equal(p.type, 'Government');
  assert.deepEqual([p.accountId, p.dealId, p.contractId, p.endDate], [acct.id, deal.id, contract.id, day(40)]);
  assert.equal(p.managerId, both.id);
  await assert.rejects(both('POST', `/api/pm/projects/from-deal/${deal.id}`, {}), /already the project for this deal/);
  const again = await both('POST', `/api/pm/projects/from-deal/${deal.id}`, { force: true, name: 'Laguna HRIS, phase 2' });
  assert.equal(again.dealId, deal.id);
  // The deal and the contract show their projects.
  assert.equal((await marco('GET', `/api/crm/deals/${deal.id}`)).projects.length, 2);
  await assert.rejects(both('POST', `/api/pm/projects/from-contract/${contract.id}`, {}), /already the project for this contract/);
  const c2 = await marco('POST', '/api/crm/contracts', { title: 'Support', accountId: acct.id, startDate: day(-1), endDate: day(10) });
  const fromC = await both('POST', `/api/pm/projects/from-contract/${c2.id}`, {});
  assert.equal(fromC.contractId, c2.id);
  // A deliverable due after the contract ends is flagged.
  await both('POST', `/api/pm/projects/${fromC.id}/milestones`, { name: 'Late deliverable', dueDate: day(20), deliverable: true });
  assert.equal((await both('GET', `/api/pm/projects/${fromC.id}`)).milestones[0].afterContract, true);
  const ended = await marco('POST', '/api/crm/contracts', { title: 'Old', accountId: acct.id, status: 'terminated' });
  await assert.rejects(both('POST', `/api/pm/projects/from-contract/${ended.id}`, {}), /has ended/);
  await assert.rejects(both('POST', '/api/pm/projects/from-deal/nope', {}), /Deal not found/);
  // Someone without CRM access cannot link CRM records by id.
  await assert.rejects(pia('PUT', `/api/pm/projects/${base.id}`, { accountId: acct.id }), /Sales & CRM access/);
  // Deleting the contract keeps the project, without the link.
  await marco('DELETE', `/api/crm/contracts/${c2.id}`);
  assert.equal(db.data.pmProjects.find((x) => x.id === fromC.id).contractId, null);
  for (const x of [p, again, fromC]) await admin('DELETE', `/api/pm/projects/${x.id}`);
});

test('from the Service Desk: an agent who is a member adds a ticket to a project; both link to each other', async () => {
  const ticket = await ivan('POST', '/api/helpdesk/tickets', { requesterName: 'Clinic staff', subject: 'Printer in clinic 2 offline', body: 'Since the new network.', priority: 'high', category: 'Hardware' });
  const outsider = await account('olga', 'support', 'Olga Outside');
  await assert.rejects(outsider('POST', `/api/pm/tasks/from-ticket/${ticket.id}`, { projectId: base.id }), /Project not found/);
  await assert.rejects(juan('POST', `/api/pm/tasks/from-ticket/${ticket.id}`, { projectId: base.id }), /does not have access/);
  const t = await ivan('POST', `/api/pm/tasks/from-ticket/${ticket.id}`, { projectId: base.id });
  assert.equal(t.title, 'Printer in clinic 2 offline');
  assert.equal(t.priority, 'high');
  assert.equal(t.ticket.ref, ticket.ref);
  assert.equal(t.ticket.statusName, 'New');
  const again = await ivan('POST', `/api/pm/tasks/from-ticket/${ticket.id}`, { projectId: base.id });
  assert.equal(again.id, t.id);
  assert.equal(again.existing, true);
  const seen = await ivan('GET', `/api/helpdesk/tickets/${ticket.id}`);
  assert.deepEqual(seen.projectTasks.map((x) => x.key), [t.key]);
  assert.ok(seen.messages.some((m) => m.kind === 'event' && m.body === `Added to project PRJ-0001 as task ${t.key}` && !m.public));
  // The task shows the ticket's status as it changes; the requester never sees the project.
  await ivan('PUT', `/api/helpdesk/tickets/${ticket.id}`, { status: 'resolved' });
  assert.equal((await juan('GET', `/api/pm/tasks/${t.id}`)).ticket.statusName, 'Resolved');
  // The project overview lists open tickets for agents only.
  assert.equal((await juan('GET', `/api/pm/projects/${base.id}`)).tickets, null);
});

test('CSV export of tasks: cells that look like formulas open as text', () => {
  const rows = taskCsvRows([{ key: 'PRJ-0001-1', title: '=HYPERLINK("http://evil","x")', statusName: '+Done', priority: 'high', assigneeName: '@admin', checklist: [], dueDate: '2026-11-20' }], []);
  const csv = toCsv(rows);
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil"",""x""\)"/);
  assert.match(csv, /"'\+Done"/);
  assert.match(csv, /"'@admin"/);
  assert.match(csv.split('\n')[0], /^"Key","Task","Parent","Status"/);
});

test('comments with @mentions, own deletes; time over the attended hours is flagged, not refused', async () => {
  const t = await pia('POST', `/api/pm/projects/${base.id}/tasks`, { title: 'Discuss' });
  const c = await juan('POST', `/api/pm/tasks/${t.id}/comments`, { body: 'Ask @pia about it, not @nobody.' });
  assert.deepEqual(mentionParts(c.body, ['pia', 'juan']), [{ text: 'Ask ' }, { mention: 'pia' }, { text: ' about it, not @nobody.' }]);
  await assert.rejects(vic('DELETE', `/api/pm/comments/${c.id}`), /your own comments/);
  await assert.rejects(hana('DELETE', `/api/pm/comments/${c.id}`), /Comment not found/);
  await juan('DELETE', `/api/pm/comments/${c.id}`);
  await assert.rejects(juan('POST', `/api/pm/tasks/${t.id}/comments`, { body: '  ' }), /Write the comment/);
  // Juan attended 4 hours yesterday (DTR); logging 5 hours is saved and flagged.
  const date = day(-3);
  await admin('POST', '/api/time-entries', { employeeId: juan.employeeId, date, type: 'work', timeIn: '09:00', timeOut: '13:00' });
  const r = await juan('POST', `/api/pm/projects/${base.id}/time`, { date, hours: 5, note: 'Long day' });
  assert.match(r.warning, /more than the 4 h your attendance shows. It is saved; this is only for your information/);
  const time = await pia('GET', `/api/pm/projects/${base.id}/time`);
  const entry = time.entries.find((x) => x.id === r.id);
  assert.equal(entry.overAttended, true);
  assert.equal(entry.attended, 4);
  // Another member does not see a colleague's attendance; the entry's owner and managers can delete.
  const asVic = await vic('GET', `/api/pm/projects/${base.id}/time`);
  assert.equal(asVic.entries.find((x) => x.id === r.id).attended, undefined);
  await assert.rejects(vic('DELETE', `/api/pm/projects/${base.id}/time/${r.id}`), /your own time entries/);
  await assert.rejects(juan('POST', `/api/pm/projects/${base.id}/time`, { date, hours: 20 }), /more than 24 hours/);
  await pia('DELETE', `/api/pm/projects/${base.id}/time/${r.id}`);
});

test('My work groups my open tasks: overdue, today, this week, later, no date', async () => {
  assert.equal(myWorkGroup({ dueDate: '2026-11-10' }, '2026-11-11'), 'overdue');
  assert.equal(myWorkGroup({ dueDate: '2026-11-11' }, '2026-11-11'), 'today');
  assert.equal(myWorkGroup({ dueDate: '2026-11-15' }, '2026-11-11'), 'week', 'through Sunday');
  assert.equal(myWorkGroup({ dueDate: '2026-11-16' }, '2026-11-11'), 'later');
  assert.equal(myWorkGroup({}, '2026-11-11'), 'none');
  const t = await pia('POST', `/api/pm/projects/${base.id}/tasks`, { title: 'For Juan, overdue', assigneeId: juan.id, dueDate: day(-1) });
  await pia('POST', `/api/pm/projects/${base.id}/tasks`, { title: 'For Juan, undated', assigneeId: juan.id });
  const g = await juan('GET', '/api/pm/my-work');
  assert.ok(g.overdue.some((x) => x.id === t.id && x.project.code === 'PRJ-0001'));
  assert.ok(g.none.some((x) => x.title === 'For Juan, undated'));
  await juan('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'done' });
  assert.ok(!(await juan('GET', '/api/pm/my-work')).overdue.some((x) => x.id === t.id), 'done tasks leave My work');
  assert.ok(makesCycle(new Map([['a', { blockedBy: ['b'] }], ['b', { blockedBy: [] }]]), 'b', ['a']));
});

test('changes are in the audit log under Projects; a deleted account leaves its projects', async () => {
  assert.equal(areaOfPath('/api/pm/tasks/abc/move'), 'projects');
  assert.equal(areaOfPath('/api/pm/projects'), 'projects');
  const entries = (await admin('GET', '/api/audit?area=projects')).entries;
  assert.ok(entries.some((e) => e.action === 'projects.change' && /\/api\/pm\/projects\/:id\/tasks/.test(e.label)));
  const temp = await account('tess', 'employee', 'Tess Temp');
  const p = await pia('GET', `/api/pm/projects/${base.id}`);
  await pia('PUT', `/api/pm/projects/${base.id}/members`, { version: p.version, members: [...p.members.map(({ userId, role }) => ({ userId, role })), { userId: temp.id, role: 'member' }] });
  const t = await pia('POST', `/api/pm/projects/${base.id}/tasks`, { title: 'Temp work', assigneeId: temp.id });
  await admin('DELETE', `/api/users/${temp.id}`);
  assert.ok(!db.data.pmProjects.find((x) => x.id === base.id).members.some((m) => m.userId === temp.id));
  assert.equal(db.data.pmTasks.find((x) => x.id === t.id).assigneeId, null);
  // Removing a member unassigns their open tasks.
  const t2 = await pia('POST', `/api/pm/projects/${base.id}/tasks`, { title: 'Ivan work', assigneeId: ivan.id });
  const p2 = await pia('GET', `/api/pm/projects/${base.id}`);
  const r = await pia('PUT', `/api/pm/projects/${base.id}/members`, { version: p2.version, members: p2.members.filter((m) => m.userId !== ivan.id).map(({ userId, role }) => ({ userId, role })) });
  assert.ok(r.unassigned >= 1);
  assert.equal(db.data.pmTasks.find((x) => x.id === t2.id).assigneeId, null);
  await assert.rejects(pia('PUT', `/api/pm/projects/${base.id}/members`, { members: [{ userId: juan.id, role: 'viewer' }, { userId: juan.id, role: 'member' }] }), /twice/);
  await assert.rejects(pia('PUT', `/api/pm/projects/${base.id}/members`, { members: [{ userId: 'ghost', role: 'member' }] }), /active accounts/);
});

test('migration and the setup: collections are made, counters catch up, the setup survives demo data and erase', async () => {
  const fake = { data: { pmProjects: [{ code: 'PRJ-0042', members: [] }], pm: { statuses: [{ name: 'Only', category: 'active' }], types: 'x', seq: { project: 3 } } } };
  assert.equal(migratePm(fake), true);
  assert.ok(Array.isArray(fake.data.pmTasks) && Array.isArray(fake.data.pmTimeLogs));
  assert.equal(fake.data.pm.statuses.length, 6, 'a broken status list falls back to the defaults');
  assert.deepEqual(fake.data.pm.types, ['Client', 'Government', 'Internal']);
  assert.equal(fake.data.pm.seq.project, 42);
  assert.equal(migratePm(fake), false);
  const custom = { ...emptyPm(), types: ['Mine'], customized: true, seq: { project: 7 } };
  assert.deepEqual(keepPmConfig(custom, { ...emptyPm(), seq: { project: 2 } }).types, ['Mine']);
  assert.equal(keepPmConfig(custom, { ...emptyPm(), seq: { project: 2 } }).seq.project, 2);
  // Through the API: a saved setup is kept when all data is erased.
  await pia('PUT', '/api/pm/settings', { statuses: DEFAULT_STATUSES, types: ['Client', 'Government', 'Internal', 'R&D'] });
  await assert.rejects(pia('PUT', '/api/pm/settings', { statuses: DEFAULT_STATUSES, types: [] }), /1 to 20 project types/);
  const db2 = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-erase-')), 'db.json'));
  const h2 = createApi(db2);
  let cookie = '';
  const a2 = async (method, url, body = {}) => {
    const r = await h2({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (r.headers['Set-Cookie']) cookie = r.headers['Set-Cookie'].split(';')[0];
    return r.data;
  };
  await a2('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
  await a2('PUT', '/api/pm/settings', { statuses: DEFAULT_STATUSES, types: ['Only type'] });
  await a2('POST', '/api/pm/projects', { name: 'Gone after erase', type: 'Only type', startDate: today });
  await a2('POST', '/api/admin/reset');
  assert.deepEqual(db2.data.pm.types, ['Only type']);
  assert.equal(db2.data.pmProjects.filter((p) => !p.isTemplate).length, 0);
  assert.equal(db2.data.pmProjects.filter((p) => p.starter).length, 3, 'erased data gets the starter templates again');
  const again = await a2('POST', '/api/pm/projects', { name: 'After erase', type: 'Only type', startDate: today });
  assert.equal(again.code, 'PRJ-0001');
});

test('demo data: ten projects with the demo accounts as members, removed cleanly', async () => {
  const db3 = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-demo-')), 'db.json'));
  const h3 = createApi(db3);
  const c3 = () => {
    let cookie = '';
    return async (method, url, body = {}) => {
      const r = await h3({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
      if (r.headers['Set-Cookie']) cookie = r.headers['Set-Cookie'].split(';')[0];
      return r.data;
    };
  };
  const a3 = c3();
  await a3('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
  const real = await a3('POST', '/api/pm/projects', { name: 'Real project', startDate: today });
  const res = await a3('POST', '/api/admin/demo');
  assert.equal(res.counts.pmProjects, 10);
  assert.ok(res.demoAccounts.some((x) => x.username === 'pm.demo' && x.role === 'pm'));
  const pmd = c3();
  await pmd('POST', '/api/auth/login', { username: 'pm.demo', password: 'demo1234' });
  const me = (await pmd('GET', '/api/auth/status')).user;
  assert.equal(me.role, 'pm');
  assert.ok(me.employeeId, 'pm.demo is linked to a demo employee');
  const ov = await pmd('GET', '/api/pm/overview');
  assert.equal(ov.projects.length, 11, 'the ten demo projects and the real one');
  // Every project state, both kinds of health reading, a WIP limit, custom statuses and a ticket link.
  assert.deepEqual(new Set(db3.data.pmProjects.filter((p) => p.demo).map((p) => p.status)), new Set(['planning', 'active', 'on_hold', 'completed', 'cancelled']));
  assert.ok(db3.data.pmProjects.some((p) => p.demo && p.healthOverride && db3.data.users.some((u) => u.id === p.healthOverride.by)), 'override by a real account id');
  assert.ok(db3.data.pmProjects.some((p) => p.demo && p.statuses.some((x) => x.wipLimit)));
  assert.ok(db3.data.pmProjects.some((p) => p.demo && p.statuses.some((x) => x.name === 'Client sign-off')));
  const linked = db3.data.pmTasks.find((t) => t.demo && t.ticketId);
  assert.ok(linked && db3.data.tickets.some((x) => x.id === linked.ticketId), 'a demo task linked to a demo ticket');
  assert.ok(ov.projects.some((p) => p.health === 'red'), 'one is off track');
  const lms = ov.projects.find((p) => p.name === 'Learning management system, phase 2');
  assert.equal(lms.status, 'active');
  assert.equal(lms.health, 'amber');
  assert.ok(lms.dealId && lms.contractId && lms.accountName === 'Northfield State University');
  const full = await pmd('GET', `/api/pm/projects/${lms.id}`);
  assert.equal(full.milestones.length, 4);
  assert.equal(full.milestones.filter((m) => m.deliverable).length, 2);
  assert.ok(full.counts.overdue >= 2 && full.counts.blocked === 1);
  assert.equal(full.time, null, 'the LMS project does not track time');
  assert.equal(full.timeTracking, false);
  assert.ok(full.effort.sized > 20 && full.progress.basis === 'size');
  // Only the SIS support contract tracks time, and only it has time logged.
  const tracked = db3.data.pmProjects.filter((p) => p.demo && p.timeTracking);
  assert.deepEqual(tracked.map((p) => p.name), ['SIS support and maintenance, 2025–2026']);
  assert.ok(db3.data.pmTimeLogs.length > 0 && db3.data.pmTimeLogs.every((x) => x.projectId === tracked[0].id));
  assert.ok(db3.data.pmProjects.filter((p) => p.demo && !p.timeTracking).every((p) => p.budgetHours == null));
  assert.ok(db3.data.pmTasks.every((t) => !('estimateHours' in t) && !('remainingHours' in t)), 'sizes, not hours');
  assert.ok(db3.data.pmTasks.filter((t) => t.demo && !t.isTemplate).filter((t) => t.size).length > 60);
  const tasks = await pmd('GET', `/api/pm/projects/${lms.id}/tasks`);
  assert.ok(tasks.length >= 25);
  assert.ok(new Set(tasks.map((t) => t.statusId)).size >= 5, 'tasks across the statuses');
  assert.ok(db3.data.pmProjects.every((p) => p.members.every((m) => !String(m.userId).startsWith('demo-user:'))));
  assert.ok(db3.data.pmTasks.every((t) => !String(t.assigneeId || '').startsWith('demo-user:')));
  assert.ok(ov.projects.some((p) => p.name === 'Provincial helpdesk and asset tracking' && p.status === 'planning' && p.type === 'Government'));
  assert.ok(ov.projects.some((p) => p.name === 'Office network refresh' && p.type === 'Internal'));
  const emp = c3();
  await emp('POST', '/api/auth/login', { username: 'employee.demo', password: 'demo1234' });
  assert.ok(Object.values(await emp('GET', '/api/pm/my-work')).flat().length > 0);
  // A real project with a demo member and a demo client link keeps going without them.
  const pmDemoId = db3.data.users.find((u) => u.username === 'pm.demo').id;
  const rp = await a3('GET', `/api/pm/projects/${real.id}`);
  await a3('PUT', `/api/pm/projects/${real.id}/members`, { version: rp.version, members: [...rp.members.map(({ userId, role }) => ({ userId, role })), { userId: pmDemoId, role: 'member' }] });
  await a3('PUT', `/api/pm/projects/${real.id}`, { accountId: db3.data.crmAccounts.find((a) => a.demo && a.name === 'Luzon Health Partners').id });
  await a3('POST', `/api/pm/projects/${real.id}/tasks`, { title: 'Real task for the demo PM', assigneeId: pmDemoId });
  await a3('DELETE', '/api/admin/demo');
  assert.deepEqual(db3.data.pmProjects.filter((p) => !p.isTemplate).map((p) => p.name), ['Real project']);
  const left = db3.data.pmProjects[0];
  assert.ok(!left.members.some((m) => m.userId === pmDemoId));
  assert.equal(left.accountId, null);
  const kept = new Set(db3.data.pmProjects.map((p) => p.id));
  assert.ok(db3.data.pmTasks.filter((t) => t.projectId === real.id).every((t) => t.assigneeId === null));
  assert.ok(db3.data.pmTasks.every((t) => kept.has(t.projectId)));
  assert.ok([...db3.data.pmMilestones, ...db3.data.pmComments, ...db3.data.pmTimeLogs].every((x) => kept.has(x.projectId)));
  assert.ok([...db3.data.pmComments, ...db3.data.pmTimeLogs].every((x) => x.projectId === real.id));
});
