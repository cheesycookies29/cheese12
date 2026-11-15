// Project Management 0.17: effort sizes instead of hours. Size weights in progress and the burn-up,
// time tracking per project (off by default),
// the weekly Timesheet (upsert, limits, membership, attendance shown for comparison only), the
// migration of hour estimates, CSV import of Size and Estimate (h), and the wording of the sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { migratePm, migrateEffort } from '../server/projects.js';
import {
  SIZES, SIZE_KEYS, sizeFromHours, parseSize, sizeName, cleanSizeNotes, progressOf, workCalendar,
  importPlan, guessImportMapping, cleanViewQuery, taskCsvRows, DEFAULT_STATUSES, addDays, weekStart,
} from '../shared/projects.js';

function server(file) {
  const db = openDb(file || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm17-')), 'db.json'));
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    const c = async (method, url, body = {}) => {
      const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      if (res.status >= 400) {
        const err = new Error(res.data?.error || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return res.data;
    };
    return c;
  };
  return { db, client };
}
const fails = async (p, status, re) => {
  const err = await p.then(() => null, (e) => e);
  assert.ok(err, 'expected a refusal');
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
};

const { db, client } = server();
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
let empNo = 0;
async function account(username, role, name, { employee = role === 'employee' } = {}) {
  let employeeId = null;
  if (employee) {
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
const ana = await account('ana', 'employee', 'Ana Reyes');
const vic = await account('vic', 'employee', 'Vic Viewer');
const nora = await account('nora', 'employee', 'Nora Outsider');
const hana = await account('hana', 'hr', 'Hana HR');
const today = localDate();
const day = (n) => addDays(today, n);
const week = weekStart(today);
// A day of this week that is not in the future (today, or Monday).
const past = week < today ? week : today;

async function project(name, extra = {}) {
  const p = await pia('POST', '/api/pm/projects', { name, type: 'Client', startDate: day(-30), endDate: day(60), ...extra });
  const now = await pia('GET', `/api/pm/projects/${p.id}`);
  await pia('PUT', `/api/pm/projects/${p.id}/members`, { version: now.version, members: [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }, { userId: ana.id, role: 'member' }, { userId: vic.id, role: 'viewer' }] });
  return pia('GET', `/api/pm/projects/${p.id}`);
}

// ===== Sizes =====
test('sizes: the table, hours to sizes, reading a size, the wording the setup may change', () => {
  assert.deepEqual(SIZE_KEYS, ['XS', 'S', 'M', 'L', 'XL']);
  assert.deepEqual(SIZE_KEYS.map((k) => SIZES[k].weight), [1, 2, 3, 5, 8]);
  assert.equal(sizeName('M'), 'M · Medium');
  // Up to 2 h XS, up to 8 h S, up to 24 h M, up to 48 h L, more XL; no estimate, no size.
  const cases = [[0.5, 'XS'], [2, 'XS'], [2.25, 'S'], [8, 'S'], [8.5, 'M'], [24, 'M'], [25, 'L'], [48, 'L'], [48.5, 'XL'], [400, 'XL'], [0, null], [null, null], ['', null], [-3, null]];
  for (const [h, s] of cases) assert.equal(sizeFromHours(h), s, `${h} h`);
  for (const [v, s] of [['M', 'M'], ['xl', 'XL'], ['Extra small', 'XS'], ['extra-large', 'XL'], ['L · Large', 'L'], ['  small ', 'S'], ['', null], ['Huge', undefined], ['XXL', undefined]]) assert.equal(parseSize(v), s, v);
  assert.equal(cleanSizeNotes({ ...Object.fromEntries(SIZE_KEYS.map((k) => [k, 'x'])), M: '' }).problem.includes('size M'), true);
  assert.match(cleanSizeNotes({ XS: 'a', S: 'b', M: 'c', L: 'd', XL: 'e'.repeat(61) }).problem, /60 characters/);
  assert.deepEqual(cleanSizeNotes({ XS: ' an hour ', S: 'b', M: 'c', L: 'd', XL: 'e', extra: 'no' }).notes, { XS: 'an hour', S: 'b', M: 'c', L: 'd', XL: 'e' });
});

test('progress by size weights: the 60% rule, the average for unsized tasks, through the API', async () => {
  const proj = { statuses: DEFAULT_STATUSES };
  const t = (id, statusId, size) => ({ id, statusId, size });
  // 3 of 5 sized is exactly 60%: by size. Done: XL (8) and the unsized one at the average (13/3).
  const leaves = [t('a', 'done', 'XL'), t('b', 'todo', 'XS'), t('c', 'todo', 'L'), t('d', 'done', null), t('e', 'todo', null)];
  const avg = (8 + 1 + 5) / 3;
  assert.deepEqual(progressOf(leaves, proj), { percent: Math.round(((8 + avg) / (8 + 1 + 5 + 2 * avg)) * 100), basis: 'size', done: 2, total: 5, sized: 3 });
  // 2 of 5: by count.
  assert.equal(progressOf(leaves.map((x) => (x.id === 'c' ? { ...x, size: null } : x)), proj).basis, 'count');
  // A size that is not one (an old or broken value) counts as none.
  assert.equal(progressOf([t('a', 'done', 'XXL'), t('b', 'todo', null)], proj).basis, 'count');
  // Through the API: a big task done weighs more than a small one.
  const p = await project('Weights');
  const big = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Big', size: 'XL' });
  await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Small', size: 'XS' });
  await pia('PUT', `/api/pm/tasks/${big.id}/move`, { statusId: 'done' });
  const ov = await pia('GET', `/api/pm/projects/${p.id}`);
  assert.deepEqual([ov.progress.percent, ov.progress.basis], [89, 'size']);
  assert.deepEqual(ov.effort, { tasks: 2, sized: 2, points: 9 });
});

// ===== Load levels =====
// ===== Time tracking per project =====
test('time tracking: off by default; managers turn it on with the budget; off hides the hours but keeps them', async () => {
  const p = await project('Fixed price');
  assert.deepEqual([p.timeTracking, p.budgetHours, p.time], [false, null, null]);
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Work', size: 'S' });
  await fails(juan('POST', `/api/pm/projects/${p.id}/time`, { date: today, hours: 1 }), 400, /does not track time/);
  await fails(juan('PUT', `/api/pm/projects/${p.id}`, { timeTracking: true }), 403);
  await fails(pia('PUT', `/api/pm/projects/${p.id}`, { timeTracking: 'yes' }), 400, /true or false/);
  let x = await pia('PUT', `/api/pm/projects/${p.id}`, { timeTracking: true, budgetHours: 80 });
  assert.deepEqual([x.timeTracking, x.budgetHours], [true, 80]);
  await juan('POST', `/api/pm/projects/${p.id}/time`, { date: today, hours: 2, taskId: t.id });
  const ov = await pia('GET', `/api/pm/projects/${p.id}`);
  assert.deepEqual(ov.time, { logged: 2, budget: 80 });
  assert.ok(ov.history.some((h) => h.field === 'time tracking' && h.from === 'Off' && h.to === 'On'));
  assert.equal((await juan('GET', `/api/pm/tasks/${t.id}`)).loggedHours, 2);
  const time = await pia('GET', `/api/pm/projects/${p.id}/time`);
  assert.deepEqual([time.total, time.budget, time.byTask[0].size], [2, 80, 'S']);
  assert.ok(!('estimate' in time) && !('left' in time.byTask[0]));
  // Off again: no hours anywhere, nothing deleted; the budget goes.
  x = await pia('PUT', `/api/pm/projects/${p.id}`, { timeTracking: false, budgetHours: 80 });
  assert.deepEqual([x.timeTracking, x.budgetHours], [false, null]);
  assert.equal((await pia('GET', `/api/pm/projects/${p.id}`)).time, null);
  assert.ok(!('loggedHours' in (await juan('GET', `/api/pm/projects/${p.id}/tasks`))[0]));
  assert.equal((await juan('GET', `/api/pm/tasks/${t.id}`)).time, null);
  await fails(pia('GET', `/api/pm/projects/${p.id}/time`), 400, /does not track time/);
  assert.ok(db.data.pmTimeLogs.some((l) => l.projectId === p.id), 'kept');
  const csv = taskCsvRows([{ key: 'K-1', title: 'A', size: 'M', loggedHours: 3, checklist: [] }]);
  assert.deepEqual(csv[0].slice(9, 11), ['Size', 'Checklist']);
  assert.equal(csv[1][9], 'M · Medium');
  assert.deepEqual(taskCsvRows([{ key: 'K-1', title: 'A', size: null, loggedHours: 3, checklist: [] }], [], { time: true })[0].slice(9, 11), ['Size', 'Logged (h)']);
});

test('bulk edit sets the size of many tasks at once, or clears it', async () => {
  const p = await project('Bulk sizes');
  const a = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'A' });
  const b = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'B', size: 'XS' });
  const r = await juan('POST', `/api/pm/projects/${p.id}/tasks/bulk`, { ids: [a.id, b.id], set: { size: 'L' } });
  assert.deepEqual(r.tasks.map((t) => t.size), ['L', 'L']);
  assert.ok((await pia('GET', `/api/pm/tasks/${b.id}`)).history.some((h) => h.field === 'size' && h.to === 'L · Large'));
  await fails(juan('POST', `/api/pm/projects/${p.id}/tasks/bulk`, { ids: [a.id], set: { size: 'XXL' } }), 400, /Size/);
  assert.equal((await juan('POST', `/api/pm/projects/${p.id}/tasks/bulk`, { ids: [a.id], set: { size: null } })).tasks[0].size, null);
});

// ===== Timesheet =====
test('timesheet: upsert one entry per project, task and day; limits; only your own; membership and tracking required', async () => {
  const p = await project('Support hours', { timeTracking: true });
  const q = await project('Second contract', { timeTracking: true });
  const off = await project('No hours');
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Patch', size: 'S' });
  const other = await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'Elsewhere' });
  // In the menu for members of a project that tracks time.
  assert.equal((await juan('GET', '/api/auth/status')).user.timesheet, true);
  assert.equal((await nora('GET', '/api/auth/status')).user.timesheet, false);
  const sheet = await juan('GET', `/api/pm/timesheet?week=${today}`);
  assert.equal(sheet.week, week);
  assert.equal(sheet.days.length, 7);
  assert.deepEqual(sheet.projects.map((x) => x.id).sort(), [p.id, q.id].sort(), 'only the projects that track time');
  assert.ok(sheet.rows.every((r) => r.taskId === null && r.total === 0), 'a row for each project to start with');
  assert.equal(sheet.editable, true);
  // Save: two cells; then change one (upsert: still one entry), clear the other.
  let r = await juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: t.id, date: past, hours: 2.5 }, { projectId: q.id, taskId: null, date: past, hours: '1.25' }] });
  assert.equal(r.saved, 2);
  const mine = () => db.data.pmTimeLogs.filter((l) => l.userId === juan.id && l.date === past && [p.id, q.id].includes(l.projectId));
  assert.deepEqual(mine().map((l) => l.hours).sort(), [1.25, 2.5]);
  const first = mine().find((l) => l.projectId === p.id).id;
  r = await juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: t.id, date: past, hours: 4 }] });
  assert.equal(mine().filter((l) => l.projectId === p.id).length, 1);
  assert.deepEqual([mine().find((l) => l.projectId === p.id).id, mine().find((l) => l.projectId === p.id).hours], [first, 4], 'the same entry, updated');
  assert.equal(r.rows.find((x) => x.taskId === t.id).hours[sheet.days.indexOf(past)], 4);
  assert.equal(r.totals[sheet.days.indexOf(past)], 5.25);
  // Two entries logged the old way on one cell become one when the cell changes.
  await juan('POST', `/api/pm/projects/${p.id}/time`, { date: past, hours: 1, taskId: t.id, note: 'Call' });
  assert.equal(mine().filter((l) => l.projectId === p.id).length, 2);
  await juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: t.id, date: past, hours: 3 }] });
  assert.deepEqual(mine().filter((l) => l.projectId === p.id).map((l) => [l.hours, l.note]), [[3, 'Call']]);
  // Unchanged cells are not touched; zero or empty clears.
  assert.equal((await juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: t.id, date: past, hours: 3 }] })).saved, 0);
  await juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: q.id, taskId: null, date: past, hours: '' }] });
  assert.equal(mine().filter((l) => l.projectId === q.id).length, 0);
  // Checks: quarter hours, today or earlier, the week shown, at most 24 h a day across projects.
  for (const hours of [0.1, 1.3, 25, -1, 'abc', '1e1']) await fails(juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: null, date: past, hours }] }), 400, /quarter hours/);
  if (addDays(week, 6) > today) await fails(juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: null, date: addDays(week, 6), hours: 1 }] }), 400, /today or earlier/);
  await fails(juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: null, date: addDays(week, -1), hours: 1 }] }), 400, /in the week shown/);
  await fails(juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: null, date: past, hours: 12 }, { projectId: q.id, taskId: null, date: past, hours: 10 }] }), 400, /more than 24 hours/);
  assert.equal(mine().filter((l) => l.projectId === q.id).length, 0, 'all or nothing');
  await fails(juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: other.id, date: past, hours: 1 }] }), 400, /task of/);
  await fails(juan('PUT', '/api/pm/timesheet', { week: 'soon', cells: [] }), 400, /which week/);
  await fails(juan('PUT', '/api/pm/timesheet', { week, cells: [] }), 400, /cells that changed/);
  // A project without tracking, one you only view, one you are not on: refused.
  await fails(juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: off.id, taskId: null, date: past, hours: 1 }] }), 400, /does not track time/);
  await fails(vic('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: null, date: past, hours: 1 }] }), 403, /Only the members/);
  await fails(nora('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: null, date: past, hours: 1 }] }), 404, /Project not found/);
  // Never for someone else: a userId in the body is ignored; the entry is the sender's own.
  const before = db.data.pmTimeLogs.filter((l) => l.userId === ana.id).length;
  await juan('PUT', '/api/pm/timesheet', { week, userId: ana.id, user: ana.id, cells: [{ projectId: q.id, taskId: null, date: past, hours: 1, userId: ana.id }] });
  assert.equal(db.data.pmTimeLogs.filter((l) => l.userId === ana.id).length, before);
  assert.ok(mine().some((l) => l.projectId === q.id && l.hours === 1));
  // Templates and closed tracking are refused too.
  const tpl = await pia('PUT', `/api/pm/projects/${q.id}`, { isTemplate: true });
  assert.equal(tpl.isTemplate, true);
  await fails(juan('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: q.id, taskId: null, date: past, hours: 2 }] }), 400, /template/);
  assert.ok(!(await juan('GET', '/api/pm/timesheet')).projects.some((x) => x.id === q.id));
  await pia('PUT', `/api/pm/projects/${q.id}`, { isTemplate: false });
});

test('timesheet: managers read their members\' timesheets; the DTR row is for the person, managers and attendance.view only', async () => {
  const p = await project('Time and materials', { timeTracking: true });
  // Ana attended 4 hours on `past` (DTR) and logs 6 project hours: saved, flagged for information.
  const ana2 = await account('ana2', 'employee', 'Ana Dos');
  const now = await pia('GET', `/api/pm/projects/${p.id}`);
  await pia('PUT', `/api/pm/projects/${p.id}/members`, { version: now.version, members: [...now.members.map(({ userId, role }) => ({ userId, role })), { userId: ana2.id, role: 'member' }] });
  await admin('POST', '/api/time-entries', { employeeId: ana2.employeeId, date: past, type: 'work', timeIn: '08:00', timeOut: '12:00' });
  const r = await ana2('PUT', '/api/pm/timesheet', { week, cells: [{ projectId: p.id, taskId: null, date: past, hours: 6 }] });
  const i = r.days.indexOf(past);
  assert.equal(r.attendance[i], 4);
  assert.equal(r.over[i], true);
  assert.match(r.warnings.join(), /more than the 4 h your attendance shows/);
  assert.ok(db.data.pmTimeLogs.some((l) => l.userId === ana2.id && l.hours === 6), 'nothing is refused or filled in from the DTR');
  // The project's manager: read only, with the DTR row.
  const asPia = await pia('GET', `/api/pm/timesheet?week=${week}&user=${ana2.id}`);
  assert.deepEqual([asPia.self, asPia.editable, asPia.user.id, asPia.attendance[i]], [false, false, ana2.id, 4]);
  assert.equal(asPia.rows.find((x) => x.projectId === p.id).hours[i], 6);
  assert.ok(asPia.people.some((x) => x.id === ana2.id));
  // Another member, someone not on the project, HR without the project: not found.
  await fails(juan('GET', `/api/pm/timesheet?user=${ana2.id}`), 404, /Timesheet not found/);
  await fails(nora('GET', `/api/pm/timesheet?user=${ana2.id}`), 404);
  await fails(hana('GET', `/api/pm/timesheet?user=${ana2.id}`), 404);
  // Only the person writes their hours: a manager's save goes to their own timesheet, never Ana's.
  await pia('PUT', '/api/pm/timesheet', { week, user: ana2.id, userId: ana2.id, cells: [{ projectId: p.id, taskId: null, date: past, hours: 1 }] });
  assert.ok(db.data.pmTimeLogs.some((l) => l.projectId === p.id && l.userId === pia.id && l.hours === 1));
  assert.deepEqual(db.data.pmTimeLogs.filter((l) => l.projectId === p.id && l.userId === ana2.id).map((l) => l.hours), [6]);
  // On the Time tab the same rule: another member sees no attendance of a colleague.
  const asJuan = await juan('GET', `/api/pm/projects/${p.id}/time`);
  const entry = asJuan.entries.find((x) => x.userId === ana2.id);
  assert.equal(entry.attended, undefined);
  assert.equal((await pia('GET', `/api/pm/projects/${p.id}/time`)).entries.find((x) => x.userId === ana2.id).attended, 4);
  // Without an employee record, there is no attendance to compare (null), and no flag.
  const sheet = await pia('GET', '/api/pm/timesheet');
  assert.ok(sheet.attendance.every((x) => x === null));
});

// ===== Migration =====
test('migration: hour estimates become sizes, hours left go, time tracking only where time was logged, views cleaned; once', () => {
  const at = '2026-10-01T08:00:00.000Z';
  const task = (id, projectId, estimateHours, extra = {}) => ({ id, projectId, key: id, title: id, statusId: 'todo', estimateHours, remainingHours: extra.left ?? null, history: [{ at, by: 'u', field: 'created', from: '', to: '' }], watchers: [], ...extra });
  const data = {
    pm: { statuses: structuredClone(DEFAULT_STATUSES), types: ['Client'], seq: { project: 3 }, templatesSeeded: true },
    pmProjects: [
      { id: 'logged', code: 'PRJ-0001', members: [], budgetHours: 300 },
      { id: 'quiet', code: 'PRJ-0002', members: [], budgetHours: 120 },
      { id: 'tpl', code: 'TPL-0001', members: [], isTemplate: true, budgetHours: null },
    ],
    pmTasks: [task('a', 'logged', 2), task('b', 'logged', 8, { left: 3 }), task('c', 'quiet', 24), task('d', 'quiet', 40), task('e', 'quiet', 100), task('f', 'quiet', null), task('g', 'tpl', 6), task('h', 'quiet', 0)],
    pmTimeLogs: [{ id: 'l1', projectId: 'logged', taskId: 'a', userId: 'u', date: '2026-09-30', hours: 3, note: '', createdAt: at }],
    pmMilestones: [], pmComments: [], pmNotifications: [],
    pmViews: [
      { id: 'v1', projectId: 'logged', userId: null, tab: 'list', name: 'By estimate', query: 'sort=estimate&dir=desc', createdAt: at },
      { id: 'v2', projectId: 'logged', userId: null, tab: 'list', name: 'Hours left', query: 'f=mine&sort=left&dir=desc', createdAt: at },
      { id: 'v3', projectId: 'logged', userId: null, tab: 'board', name: 'Mine', query: 'f=mine', createdAt: at },
    ],
  };
  const fake = { data };
  assert.equal(migratePm(fake), true);
  const t = Object.fromEntries(data.pmTasks.map((x) => [x.id, x]));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => t[id].size), ['XS', 'S', 'M', 'L', 'XL', null, 'S', null]);
  assert.ok(data.pmTasks.every((x) => !('estimateHours' in x) && !('remainingHours' in x)));
  assert.deepEqual(t.c.history.at(-1), { at: t.c.history.at(-1).at, by: null, field: 'size from the hour estimate', from: '24 h', to: 'M · Medium' });
  assert.equal(t.f.history.length, 1, 'no estimate: no size, no history line');
  const p = Object.fromEntries(data.pmProjects.map((x) => [x.id, x]));
  assert.deepEqual([p.logged.timeTracking, p.logged.budgetHours], [true, 300], 'time logged: it tracks time and keeps its budget');
  assert.deepEqual([p.quiet.timeTracking, p.quiet.budgetHours], [false, null]);
  assert.equal(p.tpl.timeTracking, false);
  assert.ok(p.logged.history.some((h) => h.field === 'time tracking'));
  assert.deepEqual(data.pmViews.map((v) => v.query), ['sort=size&dir=desc', 'f=mine', 'f=mine']);
  assert.deepEqual(data.pm.sizes, Object.fromEntries(SIZE_KEYS.map((k) => [k, SIZES[k].effort])));
  // Once: nothing changes the second time, and a size set since is kept.
  const snapshot = JSON.stringify(data);
  assert.equal(migratePm(fake), false);
  assert.equal(JSON.stringify(data), snapshot);
  assert.equal(migrateEffort(data), false);
  // The views' cleaning is the same as when a view is saved.
  assert.equal(cleanViewQuery('list', 'sort=left&dir=desc&group=status'), 'group=status');
  assert.equal(cleanViewQuery('list', 'sort=size&dir=up'), 'sort=size');
});

test('migration of a database written by 0.16: CORE starts on it, converts it once, and serves sizes and timesheets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm17-old-'));
  const file = path.join(dir, 'db.json');
  // A 0.16 database: a project with hour estimates, hours left and logged time, and one without.
  const first = server(file);
  const a = first.client();
  await a('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
  const p1 = await a('POST', '/api/pm/projects', { name: 'Old with time', startDate: day(-10) });
  const p2 = await a('POST', '/api/pm/projects', { name: 'Old without time', startDate: day(-10) });
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const adminId = raw.users[0].id;
  const old = (id, projectId, est, left) => ({ id, projectId, key: `${id}`, title: id, description: '', statusId: 'todo', priority: 'normal', assigneeId: null, startDate: null, dueDate: null, estimateHours: est, remainingHours: left, milestoneId: null, parentId: null, checklist: [], blockedBy: [], ticketId: null, rank: 1024, completedAt: null, watchers: [], version: 1, createdAt: new Date().toISOString(), createdBy: adminId, history: [] });
  for (const pr of raw.pmProjects) if (pr.id === p1.id || pr.id === p2.id) (delete pr.timeTracking, (pr.budgetHours = 200));
  raw.pmTasks.push(old('t1', p1.id, 16, 4), old('t2', p2.id, 60, null));
  raw.pmTimeLogs.push({ id: 'log1', projectId: p1.id, taskId: 't1', userId: adminId, date: day(-1), hours: 6, note: 'Old log', createdAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(raw));
  // Started again on it: converted once, saved.
  const second = server(file);
  const b = second.client();
  await b('POST', '/api/auth/login', { username: 'admin', password: 'secret123' });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const st = (id) => saved.pmTasks.find((x) => x.id === id);
  assert.deepEqual([st('t1').size, st('t2').size, 'estimateHours' in st('t1'), 'remainingHours' in st('t1')], ['M', 'XL', false, false]);
  const pr = (id) => saved.pmProjects.find((x) => x.id === id);
  assert.deepEqual([pr(p1.id).timeTracking, pr(p1.id).budgetHours, pr(p2.id).timeTracking, pr(p2.id).budgetHours], [true, 200, false, null]);
  assert.deepEqual((await b('GET', `/api/pm/projects/${p1.id}`)).time, { logged: 6, budget: 200 });
  assert.equal((await b('GET', `/api/pm/tasks/t1`)).history.at(-1).to, 'M · Medium');
  assert.equal((await b('GET', `/api/pm/projects/${p1.id}/time`)).entries[0].note, 'Old log', 'the history stays visible');
  // A third start changes nothing.
  const bytes = fs.readFileSync(file, 'utf8');
  server(file);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pmTasks.find((x) => x.id === 't1').history.length, JSON.parse(bytes).pmTasks.find((x) => x.id === 't1').history.length);
});

// ===== CSV import =====
test('CSV import: a Size column (letters or names), and an Estimate (h) column converted with the same rule', async () => {
  const proj = { statuses: DEFAULT_STATUSES, endDate: null };
  const headers = ['Title', 'Size', 'Estimate (h)'];
  const map = guessImportMapping(headers);
  assert.deepEqual(map, { title: 0, size: 1, estimate: 2 });
  const plan = importPlan([
    ['Letters', 'xl', ''], ['Name', 'Extra small', ''], ['Exported', 'M · Medium', ''], ['From hours', '', '30'], ['Decimal comma', '', '1,5'],
    ['Both', 'S', '40'], ['Neither', '', ''], ['Bad size', 'Huge', ''], ['Bad hours', '', 'lots'],
  ], map, { project: proj });
  assert.deepEqual(plan.tasks.map((t) => t.size), ['XL', 'XS', 'M', 'L', 'XS', 'S', null, null, null]);
  assert.match(plan.rows[3].warnings[0], /Size L · Large, from the estimate of 30 h/);
  assert.match(plan.rows[5].warnings[0], /estimate of 40 h is left out: the row has a size \(S\)/);
  assert.match(plan.rows[7].errors[0], /Size "Huge": use XS, S, M, L, XL/);
  assert.match(plan.rows[8].errors[0], /not a number of hours/);
  assert.deepEqual([plan.fromHours, plan.errorCount], [2, 2]);
  // Through the API: the sizes are saved; nothing of the hours is kept.
  const p = await project('Import sizes');
  const csv = 'Title,Size,Estimate (h)\nOne,L,\nTwo,,6\n';
  const pv = await pia('POST', `/api/pm/projects/${p.id}/import/preview`, { csv });
  const check = await pia('POST', `/api/pm/projects/${p.id}/import`, { csv, mapping: pv.mapping, dryRun: true });
  assert.equal(check.fromHours, 1);
  await pia('POST', `/api/pm/projects/${p.id}/import`, { csv, mapping: pv.mapping });
  const tasks = await pia('GET', `/api/pm/projects/${p.id}/tasks`);
  assert.deepEqual(tasks.map((t) => [t.title, t.size]).sort(), [['One', 'L'], ['Two', 'S']]);
  assert.ok(tasks.every((t) => !('estimateHours' in t)));
});

// ===== The wording of the sizes (Projects setup) =====
test('Projects setup: the sizes\' descriptions can be reworded, not the sizes or weights; in the Settings center', async () => {
  const s = await pia('GET', '/api/pm/settings');
  assert.equal(s.sizes.S, 'about a day');
  const sizes = { ...s.sizes, XS: 'an hour or two' };
  const r = await pia('PUT', '/api/pm/settings', { statuses: s.statuses, types: s.types, sizes });
  assert.equal(r.sizes.XS, 'an hour or two');
  assert.equal((await juan('GET', '/api/pm/meta')).sizes.XS, 'an hour or two');
  await fails(pia('PUT', '/api/pm/settings', { statuses: s.statuses, types: s.types, sizes: { ...sizes, M: '' } }), 400, /Describe size M/);
  await fails(pia('PUT', '/api/pm/settings', { statuses: s.statuses, types: s.types, sizes: ['a'] }), 400);
  await fails(juan('PUT', '/api/pm/settings', { statuses: s.statuses, types: s.types, sizes }), 403);
  // Saving statuses and types without sizes keeps them; weights are never part of the setup.
  assert.equal((await pia('PUT', '/api/pm/settings', { statuses: s.statuses, types: s.types })).sizes.XS, 'an hour or two');
  await pia('PUT', '/api/pm/settings', { statuses: s.statuses, types: s.types, sizes: { ...sizes, XS: 'under half a day' }, weights: { XS: 99 } });
  assert.equal(SIZES.XS.weight, 1);
  assert.ok(!('weights' in db.data.pm));
  const cfg = await admin('GET', '/api/admin/config');
  const setting = cfg.settings.find((x) => x.area === 'projects' && x.path === 'sizes');
  assert.ok(setting && setting.value.S === 'about a day');
});
