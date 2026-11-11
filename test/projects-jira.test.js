// Project Management 0.14: "For you" notifications, remaining hours, quick filters and saved
// views, project templates and the milestone burn-up, with who may read and change each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { migratePm, pruneNotifications } from '../server/projects.js';
import { STARTER_KEYS } from '../server/pm-templates.js';
import {
  remainingOf, plannedDays, workload, workCalendar, taskMatches, parseFilters, cleanViewQuery, groupNotifications, mentionedUsernames,
  milestoneBurnup, shiftWorkDays, addWorkDays, addDays, weekStart, DEFAULT_STATUSES, NOTIFY_KEEP,
} from '../shared/projects.js';

function server() {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm14-')), 'db.json'));
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    const c = async (method, url, body = {}) => {
      const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res.data;
    };
    return c;
  };
  return { db, client };
}
const { db, client } = server();
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
let empNo = 0;
async function account(username, role, name) {
  let employeeId = null;
  if (role === 'employee') {
    const [firstName, lastName] = name.split(' ');
    employeeId = (await admin('POST', '/api/employees', { employeeNo: `E-${++empNo}`, firstName, lastName, hireDate: '2020-01-01', payType: 'monthly', rate: 30000 })).id;
  }
  const u = await admin('POST', '/api/users', { name, username, role, employeeId, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  c.id = u.id;
  return c;
}
const pia = await account('pia', 'pm', 'Pia Manager');
const juan = await account('juan', 'employee', 'Juan Cruz');
const vic = await account('vic', 'employee', 'Vic Viewer');
const nora = await account('nora', 'employee', 'Nora Outsider');
const marco = await account('marco', 'salesmgr', 'Marco Tan');
const today = localDate();
const day = (n) => addDays(today, n);
const p = await pia('POST', '/api/pm/projects', { name: 'Clinic rollout', type: 'Client', startDate: day(-20), endDate: day(60) });
const members = async (list) => pia('PUT', `/api/pm/projects/${p.id}/members`, { version: (await pia('GET', `/api/pm/projects/${p.id}`)).version, members: list });
await members([{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }, { userId: vic.id, role: 'viewer' }]);
const notes = async (c) => c('GET', '/api/pm/notifications');

// ===== Q1. For you =====
test('notifications: added to a project, assigned, mentioned, commented on, done by someone else; never the actor', async () => {
  // Being added: Juan and Vic were told; Pia (who added them) was not.
  assert.ok((await notes(juan)).items.some((n) => n.kind === 'added' && /added you to PRJ-0001 Clinic rollout as member/.test(n.text)));
  assert.ok((await notes(vic)).items.some((n) => n.kind === 'added' && /as viewer/.test(n.text)));
  assert.equal((await notes(pia)).items.length, 0);
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Install servers', assigneeId: juan.id });
  const mine = (await notes(juan)).items.filter((n) => n.taskId === t.id);
  assert.deepEqual(mine.map((n) => [n.kind, n.actorName, n.taskKey, n.projectCode]), [['assigned', 'Pia Manager', t.key, 'PRJ-0001']]);
  // Juan assigns himself a task: nobody is told.
  const own = await juan('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Own task', assigneeId: juan.id });
  assert.ok(!(await notes(juan)).items.some((n) => n.taskId === own.id));
  // A mention of a member (any case) notifies them; of someone not on the project, nobody.
  await vic('POST', `/api/pm/tasks/${t.id}/comments`, { body: 'Ask @PIA and @nora about it.' });
  assert.ok((await notes(pia)).items.some((n) => n.kind === 'mentioned' && n.taskId === t.id && /“Ask @PIA and @nora about it.”/.test(n.text)));
  assert.equal((await notes(nora)).items.length, 0, 'not a member: no notification');
  // The same comment told the assignee (Juan) as a comment; Pia, who added the task and was
  // mentioned, got only the mention.
  assert.ok((await notes(juan)).items.some((n) => n.kind === 'commented' && n.taskId === t.id));
  assert.equal((await notes(pia)).items.filter((n) => n.taskId === t.id).length, 1);
  // Status: moved to Done by someone else → the assignee hears; moving it back does not tell anyone.
  await pia('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'done' });
  assert.ok((await notes(juan)).items.some((n) => n.kind === 'status' && /to Done$/.test(n.text)));
  const before = (await notes(juan)).items.length;
  await pia('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'doing' });
  await pia('PUT', `/api/pm/tasks/${t.id}`, { statusId: 'cancelled' });
  const after = (await notes(juan)).items;
  assert.equal(after.length, before + 1);
  assert.match(after[0].text, /to Cancelled$/);
  await juan('PUT', `/api/pm/tasks/${own.id}/move`, { statusId: 'done' });
  assert.equal((await notes(juan)).items.length, before + 1, 'his own move: nothing');
  // Reassigning tells the new assignee only.
  const t2 = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Second' });
  await pia('PUT', `/api/pm/tasks/${t2.id}`, { assigneeId: juan.id });
  assert.ok((await notes(juan)).items.some((n) => n.kind === 'assigned' && n.taskId === t2.id));
});

test('notifications: only the owner reads or marks them; leaving a project hides its ones; deleting a task removes them', async () => {
  const mineIds = (await notes(juan)).items.map((n) => n.id);
  assert.ok(mineIds.length >= 3);
  // Vic cannot mark Juan's as read (IDOR): the ids are ignored.
  const r = await vic('PUT', '/api/pm/notifications/read', { ids: mineIds });
  assert.equal(r.marked, 0);
  assert.equal((await notes(juan)).unread, mineIds.length);
  await assert.rejects(juan('PUT', '/api/pm/notifications/read', { ids: 'all' }), /mark as read/);
  await assert.rejects(juan('PUT', '/api/pm/notifications/read', {}), /mark as read/);
  const one = await juan('PUT', '/api/pm/notifications/read', { ids: [mineIds[0]] });
  assert.equal(one.marked, 1);
  assert.equal(one.unread, mineIds.length - 1);
  assert.equal((await juan('GET', '/api/pm/notifications/summary')).unread, mineIds.length - 1);
  assert.equal((await juan('GET', '/api/pm/notifications?unread=1')).items.length, mineIds.length - 1);
  await juan('PUT', '/api/pm/notifications/read', { all: true });
  assert.equal((await notes(juan)).unread, 0);
  // Marking read is not a change in the audit log.
  assert.ok(!(await admin('GET', '/api/audit?area=projects')).entries.some((e) => /notifications/.test(e.label || '')));
  // Taken off the project: the notifications about it are no longer shown (and none are made).
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'For Vic to read' });
  await pia('POST', `/api/pm/tasks/${t.id}/comments`, { body: '@vic please look' });
  assert.ok((await notes(vic)).items.some((n) => n.taskId === t.id));
  await members([{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }]);
  assert.equal((await notes(vic)).items.length, 0);
  await pia('POST', `/api/pm/tasks/${t.id}/comments`, { body: '@vic again' });
  assert.equal(db.data.pmNotifications.filter((n) => n.userId === vic.id && n.taskId === t.id).length, 1, 'no new one for a former member');
  // Deleting the task deletes its notifications.
  await pia('DELETE', `/api/pm/tasks/${t.id}`);
  assert.ok(!db.data.pmNotifications.some((n) => n.taskId === t.id));
  await members([{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }, { userId: vic.id, role: 'viewer' }]);
});

test('notifications: similar ones are grouped; 200 per person and 60 days are kept', () => {
  const n = (id, kind, taskId, readAt = null, actorName = 'Ana') => ({ id, kind, taskId, projectId: 'p', readAt, actorName });
  const g = groupNotifications([n('1', 'commented', 't1'), n('2', 'commented', 't1', null, 'Ben'), n('3', 'commented', 't1'), n('4', 'assigned', 't1'), n('5', 'commented', 't2'), n('6', 'commented', 't1', 'x')]);
  assert.deepEqual(g.map((x) => [x.kind, x.count, x.unread]), [['commented', 3, true], ['assigned', 1, true], ['commented', 1, true], ['commented', 1, false]]);
  assert.deepEqual(g[0].actors, ['Ana', 'Ben']);
  assert.deepEqual(g[0].ids, ['1', '2', '3']);
  assert.deepEqual(mentionedUsernames('Hi @Pia, @pia and @juan. @ghost', ['pia', 'juan']), ['pia', 'juan']);
  const now = Date.parse('2026-11-11T00:00:00Z');
  const at = (days) => new Date(now - days * 86400000).toISOString();
  const list = [...Array.from({ length: NOTIFY_KEEP + 5 }, (_, i) => ({ id: `a${i}`, userId: 'a', at: at(i / 10) })), { id: 'old', userId: 'b', at: at(61) }, { id: 'b1', userId: 'b', at: at(59) }];
  const kept = pruneNotifications(list, now);
  assert.equal(kept.filter((x) => x.userId === 'a').length, NOTIFY_KEEP);
  assert.ok(!kept.some((x) => ['a200', 'a204', 'old'].includes(x.id)), 'the oldest over the cap and those past 60 days go');
  assert.ok(kept.some((x) => x.id === 'a0') && kept.some((x) => x.id === 'b1'));
});

// ===== Q2. Remaining hours =====
test('remaining hours: estimate less logged, an override someone working on it sets, 0 when done; Workload plans what is left', async () => {
  assert.equal(remainingOf({ estimateHours: 40 }, 30, 'active'), 10);
  assert.equal(remainingOf({ estimateHours: 10 }, 12, 'active'), 0, 'never below 0');
  assert.equal(remainingOf({ estimateHours: 40, remainingHours: 25 }, 30, 'todo'), 25);
  assert.equal(remainingOf({ estimateHours: 40, remainingHours: 25 }, 30, 'done'), 0);
  assert.equal(remainingOf({ estimateHours: 40 }, 0, 'cancelled'), 0);
  assert.equal(remainingOf({}, 3, 'todo'), null);
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Data migration', assigneeId: juan.id, estimateHours: 40 });
  assert.deepEqual([t.remaining, t.loggedHours, t.remainingOverride], [40, 0, false]);
  await juan('POST', `/api/pm/projects/${p.id}/time`, { date: day(-1), hours: 8, taskId: t.id });
  let x = (await juan('GET', `/api/pm/projects/${p.id}/tasks`)).find((y) => y.id === t.id);
  assert.deepEqual([x.remaining, x.loggedHours], [32, 8]);
  // "Hours left after this" when logging, quarter hours; only for time on a task.
  for (const bad of [-1, 0.3, 'abc', '1e2', 10000]) await assert.rejects(juan('POST', `/api/pm/projects/${p.id}/time`, { date: day(-1), hours: 1, taskId: t.id, remainingHours: bad }), /Hours left/);
  await assert.rejects(juan('POST', `/api/pm/projects/${p.id}/time`, { date: day(-1), hours: 1, remainingHours: 5 }), /on a task/);
  await juan('POST', `/api/pm/projects/${p.id}/time`, { date: day(-1), hours: 2, taskId: t.id, remainingHours: '20.5' });
  x = await juan('GET', `/api/pm/tasks/${t.id}`);
  assert.deepEqual([x.remaining, x.remainingHours, x.remainingOverride, x.loggedHours], [20.5, 20.5, true, 10]);
  assert.ok(x.history.some((h) => h.field === 'hours left' && h.to === '20.5 h'));
  // Set on the task; a viewer cannot; a new estimate starts the count again.
  await assert.rejects(vic('PUT', `/api/pm/tasks/${t.id}`, { remainingHours: 5 }), /read and comment/);
  await assert.rejects(juan('PUT', `/api/pm/tasks/${t.id}`, { remainingHours: 1.1 }), /quarter hours/);
  x = await juan('PUT', `/api/pm/tasks/${t.id}`, { remainingHours: 12 });
  assert.equal(x.remaining, 12);
  x = await juan('PUT', `/api/pm/tasks/${t.id}`, { title: 'Data migration (all sites)' });
  assert.equal(x.remaining, 12, 'other edits keep it');
  x = await juan('PUT', `/api/pm/tasks/${t.id}`, { estimateHours: 50 });
  assert.deepEqual([x.remaining, x.remainingHours], [40, null], 'a new estimate clears it');
  x = await juan('PUT', `/api/pm/tasks/${t.id}`, { remainingHours: 30 });
  x = await juan('PUT', `/api/pm/tasks/${t.id}`, { remainingHours: '' });
  assert.deepEqual([x.remaining, x.remainingOverride], [40, false], 'emptied: estimate less logged again');
  // The project's overview and the Time tab show it too.
  const ov = await pia('GET', `/api/pm/projects/${p.id}`);
  assert.ok(ov.hours.remaining >= 40);
  const time = await pia('GET', `/api/pm/projects/${p.id}/time`);
  assert.equal(time.byTask.find((y) => y.taskId === t.id).left, 40);
  // Done: 0 left.
  x = await juan('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'done' });
  assert.equal(x.remaining, 0);
  await juan('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'doing' });
});

test('Workload spreads what is left over the working days still to go', async () => {
  const cal = workCalendar({ schedule: { workDays: [1, 2, 3, 4, 5] } }, []);
  // 40 h over Mon 23 to Fri 27 Nov, half logged: 4 h a day instead of 8.
  const task = { estimateHours: 40, remaining: 20, startDate: '2026-11-23', dueDate: '2026-11-27' };
  assert.deepEqual(plannedDays(task, cal, '2026-11-23').map((x) => x.hours), [4, 4, 4, 4, 4]);
  assert.deepEqual(plannedDays({ ...task, remaining: undefined }, cal, '2026-11-23').map((x) => x.hours), [8, 8, 8, 8, 8], 'no remaining given: the estimate');
  // Overdue with hours left: on the first day planned (the existing rule).
  assert.deepEqual(plannedDays({ remaining: 6, dueDate: '2026-11-02' }, cal, '2026-11-25'), [{ date: '2026-11-25', hours: 6 }]);
  // From Wednesday: the days before it this week are past, so what is left goes on Wed to Fri.
  const grid = workload({ people: [{ id: 'u', name: 'U' }], tasks: [{ ...task, id: 't', assigneeId: 'u', remaining: 12 }, { id: 'n', assigneeId: 'u', estimateHours: 9, remaining: 3 }], from: '2026-11-25', weeks: 1, cal });
  assert.equal(grid.rows[0].cells[0].planned, 12);
  assert.deepEqual(grid.rows[0].cells[0].tasks.map((x) => x.hours), [12]);
  assert.equal(grid.rows[0].unscheduled, 3);
  // Through the API: a half-logged task loads half its estimate.
  const monday = weekStart(day(21));
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Half done', assigneeId: juan.id, estimateHours: 30, startDate: monday, dueDate: addDays(monday, 4) });
  const cell = async () => (await pia('GET', `/api/pm/workload?from=${monday}&weeks=1`)).rows.find((r) => r.id === juan.id).cells[0].tasks.find((x) => x.id === t.id).hours;
  assert.equal(await cell(), 30);
  await juan('POST', `/api/pm/projects/${p.id}/time`, { date: day(-2), hours: 15, taskId: t.id });
  assert.equal(await cell(), 15);
});

// ===== Q3. Quick filters and saved views =====
test('quick filters: each chip, Mine and Unassigned widen each other, the rest narrow; search by key, title or assignee', () => {
  const t0 = '2026-11-11'; // a Wednesday
  const base = { key: 'PRJ-0001-1', title: 'Install', category: 'todo', priority: 'normal', assigneeId: 'u' };
  const m = (t, chips, q = '') => taskMatches({ ...base, ...t }, { chips, q }, { today: t0, userId: 'u' });
  assert.ok(m({}, ['mine']) && !m({ assigneeId: 'v' }, ['mine']));
  assert.ok(m({ assigneeId: null }, ['unassigned']) && !m({}, ['unassigned']));
  assert.ok(m({}, ['mine', 'unassigned']) && m({ assigneeId: null }, ['mine', 'unassigned']) && !m({ assigneeId: 'v' }, ['mine', 'unassigned']));
  assert.ok(m({ overdue: true }, ['overdue']) && !m({}, ['overdue']));
  assert.ok(m({ dueDate: '2026-11-09' }, ['week']) && m({ dueDate: '2026-11-15' }, ['week']), 'Monday to Sunday of this week');
  assert.ok(!m({ dueDate: '2026-11-16' }, ['week']) && !m({ dueDate: '2026-11-08' }, ['week']) && !m({ dueDate: '2026-11-12', category: 'done' }, ['week']));
  assert.ok(m({ blocked: true }, ['blocked']) && !m({}, ['blocked']));
  assert.ok(m({ priority: 'high' }, ['high']) && m({ priority: 'urgent' }, ['high']) && !m({}, ['high']));
  assert.ok(!m({ overdue: true }, ['overdue', 'blocked']) && m({ overdue: true, blocked: true }, ['overdue', 'blocked']), 'combined with AND');
  assert.ok(m({}, [], 'prj-0001-1') && m({}, [], 'INST') && m({ assigneeName: 'Juan' }, [], 'juan') && !m({}, [], 'nothing'));
  assert.deepEqual(parseFilters('mine,bogus,overdue,mine'), ['mine', 'overdue']);
  // A saved view keeps only the tab's own keys, short values and known chips.
  assert.equal(cleanViewQuery('board', 'f=mine,evil&who=me&q=x&sort=due&admin=1'), 'f=mine&q=x&who=me');
  assert.equal(cleanViewQuery('list', `?group=status&sort=due&dir=desc&q=${'y'.repeat(300)}&cancelled=1`), `q=${'y'.repeat(100)}&group=status&sort=due&dir=desc`);
  assert.equal(cleanViewQuery('timeline', 'f=mine'), '');
});

test('saved views: mine for anyone on the project, shared ones for managers; others\' private views are not found', async () => {
  const url = `/api/pm/projects/${p.id}/views`;
  const v1 = await vic('POST', url, { tab: 'board', name: 'My blocked', query: 'f=blocked&evil=1' });
  assert.deepEqual([v1.shared, v1.query, v1.canDelete], [false, 'f=blocked', true]);
  await assert.rejects(vic('POST', url, { tab: 'board', name: 'For all', query: '', shared: true }), /Only the project's managers/);
  await assert.rejects(juan('POST', url, { tab: 'calendar', name: 'X', query: '' }), /Tab: pick one/);
  await assert.rejects(juan('POST', url, { tab: 'list', name: '  ', query: '' }), /Name the view/);
  await assert.rejects(juan('POST', url, { tab: 'list', name: 'X', query: { f: 'mine' } }), /missing or too long/);
  await assert.rejects(juan('POST', url, { tab: 'list', name: 'X', query: '', shared: 'yes' }), /true or false/);
  const shared = await pia('POST', url, { tab: 'list', name: 'Overdue for the client', query: 'f=overdue&group=status', shared: true });
  assert.equal(shared.shared, true);
  await assert.rejects(pia('POST', url, { tab: 'list', name: 'overdue FOR the client', query: '', shared: true }), /already a view/);
  // Juan sees the shared view, not Vic's private one; Marco (reads every project) sees the shared one.
  assert.deepEqual((await juan('GET', url)).map((v) => v.name), ['Overdue for the client']);
  assert.deepEqual((await vic('GET', url)).map((v) => v.name), ['Overdue for the client', 'My blocked']);
  assert.ok((await marco('GET', url)).some((v) => v.id === shared.id));
  await assert.rejects(juan('DELETE', `${url}/${v1.id}`), /View not found/);
  await assert.rejects(juan('DELETE', `${url}/${shared.id}`), /Only the person who saved/);
  // Not on the project: not found, for every views route.
  await assert.rejects(nora('GET', url), /Project not found/);
  await assert.rejects(nora('POST', url, { tab: 'board', name: 'X', query: '' }), /Project not found/);
  await assert.rejects(nora('DELETE', `${url}/${shared.id}`), /Project not found/);
  // A view id of another project is not found here.
  const other = await pia('POST', '/api/pm/projects', { name: 'Other', startDate: today });
  await assert.rejects(pia('DELETE', `/api/pm/projects/${other.id}/views/${shared.id}`), /View not found/);
  assert.ok((await vic('DELETE', `${url}/${v1.id}`)).ok);
  assert.ok((await pia('DELETE', `${url}/${shared.id}`)).ok);
  await pia('DELETE', `/api/pm/projects/${other.id}`);
});

// ===== Q4. Templates =====
test('starter templates: made once (TPL codes, no project code), not made again after deletion', async () => {
  const starters = db.data.pmProjects.filter((x) => x.starter);
  assert.deepEqual(starters.map((x) => x.starter).sort(), [...STARTER_KEYS].sort());
  assert.ok(starters.every((x) => x.isTemplate && /^TPL-\d{4}$/.test(x.code)));
  assert.equal(p.code, 'PRJ-0001', 'templates do not take project codes');
  const gov = starters.find((x) => x.starter === 'government-contract');
  const ms = db.data.pmMilestones.filter((m) => m.projectId === gov.id);
  assert.equal(ms.filter((m) => m.deliverable).reduce((n, m) => n + m.billingPercent, 0), 100);
  const list = await pia('GET', '/api/pm/templates');
  assert.deepEqual(list.map((x) => x.name), ['Client implementation', 'Government contract (with deliverables)', 'Internal IT project']);
  await assert.rejects(juan('GET', '/api/pm/templates'), /does not have access/);
  // Deleted: not made again by the next migration.
  const internal = starters.find((x) => x.starter === 'internal-it');
  await pia('DELETE', `/api/pm/projects/${internal.id}`);
  assert.equal(migratePm(db), false);
  assert.ok(!db.data.pmProjects.some((x) => x.starter === 'internal-it'));
  assert.ok(!db.data.pmTasks.some((t) => t.projectId === internal.id));
});

test('templates: marking one (managers), left out of the portfolio, My work, Workload and health; a new project from one', async () => {
  const src = await pia('POST', '/api/pm/projects', { name: 'Rollout pattern', type: 'Government', startDate: '2026-11-23', endDate: '2026-12-31' });
  await pia('PUT', `/api/pm/projects/${src.id}/members`, { version: (await pia('GET', `/api/pm/projects/${src.id}`)).version, members: [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }] });
  const m1 = await pia('POST', `/api/pm/projects/${src.id}/milestones`, { name: 'Inception', dueDate: '2026-12-01', deliverable: true, billingPercent: 15 });
  const a = await pia('POST', `/api/pm/projects/${src.id}/tasks`, { title: 'A', startDate: '2026-11-27', dueDate: '2026-11-30', milestoneId: m1.id, assigneeId: juan.id, estimateHours: 8, checklist: ['one'] });
  const b = await pia('POST', `/api/pm/projects/${src.id}/tasks`, { title: 'B', dueDate: '2026-12-02', parentId: a.id, estimateHours: 4 });
  const c = await pia('POST', `/api/pm/projects/${src.id}/tasks`, { title: 'C', dueDate: '2026-12-04' });
  await pia('PUT', `/api/pm/tasks/${c.id}`, { blockedBy: [a.id] });
  await pia('PUT', `/api/pm/tasks/${a.id}/checklist`, { itemId: (await pia('GET', `/api/pm/tasks/${a.id}`)).checklist[0].id, done: true });
  await juan('POST', `/api/pm/projects/${src.id}/time`, { date: day(-1), hours: 2, taskId: a.id });
  // Only a manager of the project marks it; the value must be true or false.
  await assert.rejects(juan('PUT', `/api/pm/projects/${src.id}`, { isTemplate: true }), /Only the project's managers/);
  await assert.rejects(pia('PUT', `/api/pm/projects/${src.id}`, { isTemplate: 'yes' }), /true or false/);
  const marked = await pia('PUT', `/api/pm/projects/${src.id}`, { isTemplate: true });
  assert.deepEqual([marked.isTemplate, marked.health], [true, null]);
  assert.ok((await pia('GET', `/api/pm/projects/${src.id}`)).history.some((h) => h.field === 'template' && h.to === 'Yes'));
  // Left out of every list (a member can still open it), and offered under Templates.
  for (const c2 of [pia, juan]) {
    const ov = await c2('GET', '/api/pm/overview');
    assert.ok(!ov.projects.some((x) => x.id === src.id));
    assert.ok(ov.templates.some((x) => x.id === src.id));
    assert.ok(!(await c2('GET', '/api/pm/projects')).some((x) => x.id === src.id));
    assert.ok(!Object.values(await c2('GET', '/api/pm/my-work')).flat().some((x) => x.projectId === src.id));
  }
  assert.equal((await juan('GET', `/api/pm/projects/${src.id}`)).access, 'work');
  assert.ok(!(await pia('GET', `/api/pm/workload?from=2026-11-23&weeks=4`)).rows.flatMap((r) => r.cells.flatMap((x) => x.tasks)).some((x) => x.projectId === src.id));
  assert.equal((await nora('GET', '/api/pm/overview')).templates.length, 0, 'not on it, no pm.view: no templates either');
  // From the template: working days from its start (Mon 23 Nov 2026), so weekends and the
  // 30 November holiday (Bonifacio Day) are skipped; the new start is Mon 4 Jan 2027.
  const n = await pia('POST', `/api/pm/projects/${src.id}/copy`, { name: 'Laguna rollout', startDate: '2027-01-04', managerId: juan.id, isTemplate: true, id: 'x' });
  assert.deepEqual([n.code.startsWith('PRJ-'), n.isTemplate, n.type, n.status, n.managerId], [true, false, 'Government', 'planning', juan.id]);
  assert.ok((await notes(juan)).items.some((x) => x.kind === 'added' && x.projectId === n.id), 'the manager given is told');
  const cal = workCalendar(db.data.settings, db.data.holidays);
  const mv = (d) => shiftWorkDays(d, '2026-11-23', '2027-01-04', cal);
  const tasks = await pia('GET', `/api/pm/projects/${n.id}/tasks`);
  const [na, nb, nc] = ['A', 'B', 'C'].map((x) => tasks.find((t) => t.title === x));
  assert.deepEqual([na.startDate, na.dueDate, nb.dueDate, nc.dueDate], [mv('2026-11-27'), mv('2026-11-30'), mv('2026-12-02'), mv('2026-12-04')]);
  assert.equal(na.startDate, '2027-01-08', 'Fri 27 Nov is 4 working days after the start, so Fri 8 Jan');
  assert.deepEqual([nb.parentId, nc.blockedBy, na.assigneeId, na.loggedHours, na.checklist.map((i) => i.done), na.estimateHours, na.statusId], [na.id, [na.id], null, 0, [false], 8, 'todo']);
  const nm = (await pia('GET', `/api/pm/projects/${n.id}`)).milestones[0];
  assert.deepEqual([nm.name, nm.dueDate, nm.deliverable, nm.billingPercent, na.milestoneId], ['Inception', mv('2026-12-01'), true, 15, nm.id]);
  assert.deepEqual(await pia('GET', `/api/pm/tasks/${na.id}/comments`), []);
  // Client links need Sales & CRM access; a manager who is not an active account is refused.
  await assert.rejects(pia('POST', `/api/pm/projects/${src.id}/copy`, { name: 'X', startDate: '2027-01-04', accountId: 'acct' }), /Sales & CRM access/);
  await assert.rejects(pia('POST', `/api/pm/projects/${src.id}/copy`, { name: 'X', startDate: '2027-01-04', managerId: 'ghost' }), /active accounts/);
  await assert.rejects(juan('POST', `/api/pm/projects/${src.id}/copy`, { name: 'X', startDate: '2027-01-04' }), /does not have access/);
  // Unmarking brings it back to the portfolio.
  const back = await pia('PUT', `/api/pm/projects/${src.id}`, { isTemplate: false });
  assert.equal(back.isTemplate, false);
  assert.ok((await pia('GET', '/api/pm/projects')).some((x) => x.id === src.id));
  void b;
  for (const id of [src.id, n.id]) await pia('DELETE', `/api/pm/projects/${id}`);
});

test('working days: moving a date keeps its place in working days, holidays and weekends skipped', () => {
  const cal = workCalendar({}, [{ date: '2026-11-30', type: 'regular' }]);
  assert.equal(addWorkDays('2026-11-27', 1, cal), '2026-12-01', 'Friday + 1: past the weekend and the holiday');
  assert.equal(addWorkDays('2026-12-01', -1, cal), '2026-11-27');
  assert.equal(addWorkDays('2026-12-01', 0, cal), '2026-12-01');
  assert.equal(shiftWorkDays('2026-11-25', '2026-11-23', '2026-11-26', cal), '2026-12-01');
  assert.equal(shiftWorkDays('2026-11-28', '2026-11-23', '2026-11-23', cal), '2026-11-27', 'a Saturday lands on the Friday');
  assert.equal(shiftWorkDays('2026-11-20', '2026-11-23', '2026-12-01', cal), '2026-11-27', 'before the start: counted back');
  assert.equal(shiftWorkDays(null, '2026-11-23', '2026-12-01', cal), null);
});

// ===== N4. Burn-up =====
test('burn-up: scope and done by working day, reopened tasks, scope added later, the basis of progress', () => {
  const cal = workCalendar({}, [{ date: '2026-11-30', type: 'regular' }]);
  const project = { startDate: '2026-11-23', statuses: DEFAULT_STATUSES };
  const m = { id: 'm', dueDate: '2026-12-04' };
  const h = (at, from, to) => ({ at: `${at}T09:00:00`, field: 'status', from, to });
  const tasks = [
    { id: 'a', milestoneId: 'm', statusId: 'done', estimateHours: 10, startDate: '2026-11-23', createdAt: '2026-11-20T08:00:00', completedAt: '2026-11-25T10:00:00', history: [h('2026-11-24', 'To do', 'In progress')] },
    // Done on the 24th, reopened on the 26th, done again on 2 Dec.
    { id: 'b', milestoneId: 'm', statusId: 'done', estimateHours: 6, createdAt: '2026-11-20T08:00:00', completedAt: '2026-12-02T10:00:00', history: [h('2026-11-24', 'To do', 'Done'), h('2026-11-26', 'Done', 'In progress'), h('2026-12-02', 'In progress', 'Done')] },
    // Added on the 26th.
    { id: 'c', milestoneId: 'm', statusId: 'doing', estimateHours: 4, createdAt: '2026-11-26T08:00:00', history: [] },
    // Cancelled on the 27th: out of scope from then.
    { id: 'd', milestoneId: 'm', statusId: 'cancelled', estimateHours: 8, createdAt: '2026-11-20T08:00:00', history: [h('2026-11-27', 'To do', 'Cancelled')] },
    // A parent: its subtask counts instead (one level).
    { id: 'p', milestoneId: 'm', statusId: 'todo', estimateHours: 99, createdAt: '2026-11-20T08:00:00', history: [] },
    { id: 's', parentId: 'p', statusId: 'todo', estimateHours: 2, createdAt: '2026-11-20T08:00:00', history: [] },
    { id: 'x', milestoneId: 'other', statusId: 'todo', estimateHours: 50, createdAt: '2026-11-20T08:00:00', history: [] },
  ];
  const ctx = { project, tasks, tasksById: new Map(tasks.map((t) => [t.id, t])), today: '2026-12-02', cal };
  const b = milestoneBurnup(m, ctx);
  assert.equal(b.basis, 'hours');
  // Working days only: no weekend, no 30 Nov.
  assert.deepEqual(b.points.map((x) => x.date), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']);
  const at = (d) => b.points.find((x) => x.date === d);
  assert.deepEqual([at('2026-11-23').scope, at('2026-11-23').done], [26, 0], 'a, b, d and s');
  assert.equal(at('2026-11-24').done, 6, 'b done on the 24th');
  assert.equal(at('2026-11-25').done, 16, 'a done on the 25th (its completedAt)');
  assert.deepEqual([at('2026-11-26').scope, at('2026-11-26').done], [30, 10], 'c added, b reopened');
  assert.equal(at('2026-11-27').scope, 22, 'd cancelled');
  assert.equal(at('2026-12-02').done, 16);
  assert.equal(at('2026-12-03').done, null, 'nothing drawn after today');
  assert.equal(at('2026-12-04').expected, 22, 'the expected line reaches the scope on the due date');
  assert.equal(at('2026-11-23').expected, 0);
  assert.deepEqual([b.scope, b.done, b.added], [22, 16, 4]);
  // Fewer than 60% estimated: counted in tasks.
  const few = tasks.map((t) => (['a', 'b', 'c'].includes(t.id) ? { ...t, estimateHours: null } : t));
  const c = milestoneBurnup(m, { ...ctx, tasks: few, tasksById: new Map(few.map((t) => [t.id, t])) });
  assert.equal(c.basis, 'count');
  assert.equal(c.points.at(-1).scope, 4);
  // Past its due date and not finished: the chart runs to today.
  const late = milestoneBurnup(m, { ...ctx, today: '2026-12-08' });
  assert.equal(late.points.at(-1).date, '2026-12-08');
});

test('burn-up through the API: members and readers of the project; others get "not found"', async () => {
  const ms = await pia('POST', `/api/pm/projects/${p.id}/milestones`, { name: 'Go-live', dueDate: day(20) });
  await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Cut-over', milestoneId: ms.id, startDate: day(-5), dueDate: day(10), estimateHours: 8 });
  const b = await juan('GET', `/api/pm/projects/${p.id}/milestones/${ms.id}/burnup`);
  assert.deepEqual([b.name, b.basis, b.scope, b.due], ['Go-live', 'hours', 8, day(20)]);
  assert.ok(b.points.length > 2 && b.points.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date)));
  assert.ok((await marco('GET', `/api/pm/projects/${p.id}/milestones/${ms.id}/burnup`)).points.length);
  await assert.rejects(nora('GET', `/api/pm/projects/${p.id}/milestones/${ms.id}/burnup`), /Project not found/);
  await assert.rejects(juan('GET', `/api/pm/projects/${p.id}/milestones/nope/burnup`), /Milestone not found/);
});

// ===== Demo data =====
test('demo data: unread "For you" items for employee.demo, shared views, the starter templates; all removed with the demo', async () => {
  const s = server();
  const a = s.client();
  await a('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
  const real = await a('POST', '/api/pm/projects', { name: 'Real project', startDate: today });
  // The starter templates were deleted here: the demo brings them back as demo records.
  for (const t of s.db.data.pmProjects.filter((x) => x.starter)) await a('DELETE', `/api/pm/projects/${t.id}`);
  await a('POST', '/api/admin/demo');
  assert.equal(s.db.data.pmProjects.filter((x) => x.starter && x.demo).length, 3);
  const emp = s.client();
  await emp('POST', '/api/auth/login', { username: 'employee.demo', password: 'demo1234' });
  const n = await emp('GET', '/api/pm/notifications');
  assert.ok(n.unread >= 3);
  assert.ok(['mentioned', 'commented', 'assigned', 'status', 'added'].every((k) => n.items.some((x) => x.kind === k)));
  assert.ok(n.items.every((x) => x.actorName && x.actorName !== 'Someone'));
  assert.ok(s.db.data.pmViews.some((v) => v.demo && v.userId === null && s.db.data.users.some((u) => u.id === v.createdBy)));
  // A real person's notification from a demo account on a real project stays, without the name.
  const demoPm = s.db.data.users.find((u) => u.username === 'pm.demo');
  const rp = await a('GET', `/api/pm/projects/${real.id}`);
  await a('PUT', `/api/pm/projects/${real.id}/members`, { version: rp.version, members: [...rp.members.map(({ userId, role }) => ({ userId, role })), { userId: demoPm.id, role: 'manager' }] });
  const pmd = s.client();
  await pmd('POST', '/api/auth/login', { username: 'pm.demo', password: 'demo1234' });
  const adminId = s.db.data.users.find((u) => u.username === 'admin').id;
  await pmd('POST', `/api/pm/projects/${real.id}/tasks`, { title: 'For the admin', assigneeId: adminId });
  assert.ok((await a('GET', '/api/pm/notifications')).items.some((x) => x.kind === 'assigned'));
  await a('DELETE', '/api/admin/demo');
  assert.ok(!s.db.data.pmNotifications.some((x) => x.demo || !s.db.data.users.some((u) => u.id === x.userId)));
  assert.ok(!s.db.data.pmViews.some((v) => v.demo));
  assert.equal(s.db.data.pmProjects.filter((x) => x.starter).length, 0, 'demo templates go with the demo');
  const left = (await a('GET', '/api/pm/notifications')).items.find((x) => x.kind === 'assigned');
  assert.equal(left.actorName, 'Someone');
});
