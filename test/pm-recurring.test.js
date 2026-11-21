// Recurring tasks (0.61): a project's managers set up tasks CORE makes on a schedule; each run is
// in the project's run log. The schedule (shared/pm-recurring.js), then the API with a test clock:
// made once a day at most, holidays, skipping while the last one is open, a server that was off,
// pause and resume, "Make one now", who may do what, failures, copies, templates and deletion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { removeUserFromProjects, migratePm } from '../server/projects.js';
import { pruneRuns, RUNS_KEEP } from '../server/pm-automation.js';
import { workCalendar } from '../shared/projects.js';
import { cleanSchedule, nextOccurrence, upcoming, describeSchedule } from '../shared/pm-recurring.js';

const HOLIDAYS = [{ date: '2026-11-30', name: 'Bonifacio Day', type: 'regular' }, { date: '2026-12-25', name: 'Christmas Day', type: 'regular' }];
const sched = (raw) => {
  const r = cleanSchedule(raw);
  assert.ok(r.schedule, r.error);
  return r.schedule;
};

test('schedule: checks, words and dates', () => {
  const cal = workCalendar({}, HOLIDAYS);
  for (const [raw, re] of [
    [null, /how often/], [{ freq: 'hourly', start: '2026-11-23' }, /daily, weekly or monthly/], [{ freq: 'daily', every: 31, start: '2026-11-23' }, /1 to 30 days/],
    [{ freq: 'weekly', start: '2026-11-23' }, /at least one day/], [{ freq: 'monthly', monthDay: 32, start: '2026-11-23' }, /day of the month/],
    [{ freq: 'daily', start: '2026-02-30' }, /date it starts/], [{ freq: 'daily', start: '2026-11-23', until: '2026-11-01' }, /before the start/],
  ]) assert.match(cleanSchedule(raw).error, re);
  // Every working day: weekends and the holiday are skipped.
  const daily = sched({ freq: 'daily', start: '2026-11-26' });
  assert.equal(describeSchedule(daily), 'Every working day');
  assert.deepEqual(upcoming(daily, '2026-11-26', 4, cal), ['2026-11-26', '2026-11-27', '2026-12-01', '2026-12-02']);
  // Weekly on Monday: the holiday Monday moves to Tuesday; weekends are counted from the start week.
  const mon = sched({ freq: 'weekly', days: [1], start: '2026-11-23' });
  assert.equal(describeSchedule(mon), 'Every week on Monday');
  assert.deepEqual(upcoming(mon, '2026-11-23', 3, cal), ['2026-11-23', '2026-12-01', '2026-12-07']);
  const fortnight = sched({ freq: 'weekly', every: 2, days: [5, 2], start: '2026-11-23' });
  assert.equal(describeSchedule(fortnight), 'Every 2 weeks on Tuesday and Friday');
  assert.deepEqual(upcoming(fortnight, '2026-11-23', 4, cal), ['2026-11-24', '2026-11-27', '2026-12-08', '2026-12-11']);
  assert.equal(describeSchedule(sched({ freq: 'weekly', days: [1, 2, 3, 4, 5], start: '2026-11-23' })), 'Every weekday (Monday to Friday)');
  // Monthly on the 31st: a short month uses its last day; a weekend moves to Monday unless turned off.
  assert.deepEqual(upcoming(sched({ freq: 'monthly', monthDay: 31, start: '2026-11-01', workingDays: false }), '2026-11-01', 3, cal), ['2026-11-30', '2026-12-31', '2027-01-31']);
  assert.deepEqual(upcoming(sched({ freq: 'monthly', monthDay: 31, start: '2026-11-01' }), '2026-11-01', 3, cal), ['2026-12-01', '2026-12-31', '2027-02-01']);
  // The last working day of the month, and the first one (1 January is a working day here).
  const last = sched({ freq: 'monthly', monthDay: 'last-work', start: '2026-11-01' });
  assert.equal(describeSchedule(last), 'Every month on the last working day');
  assert.deepEqual(upcoming(last, '2026-11-01', 2, cal), ['2026-11-27', '2026-12-31']);
  assert.deepEqual(upcoming(sched({ freq: 'monthly', monthDay: 'first-work', every: 3, start: '2026-12-01' }), '2026-12-01', 2, cal), ['2026-12-01', '2027-03-01']);
  // An end date stops it; nothing is made before the start.
  const short = sched({ freq: 'daily', start: '2026-11-26', until: '2026-11-27' });
  assert.deepEqual(upcoming(short, '2026-11-01', 5, cal), ['2026-11-26', '2026-11-27']);
  assert.equal(nextOccurrence(short, '2026-11-27', cal), null);
});

test('run log: 90 days, and each project\'s newest 200', () => {
  const at = (n) => new Date(Date.UTC(2026, 10, 21) - n * 60000).toISOString();
  const list = [...Array.from({ length: RUNS_KEEP + 5 }, (_, i) => ({ projectId: 'a', at: at(i) })), { projectId: 'b', at: at(1) }, { projectId: 'b', at: '2026-01-01T00:00:00.000Z' }];
  const kept = pruneRuns(list, Date.UTC(2026, 10, 21));
  assert.equal(kept.filter((x) => x.projectId === 'a').length, RUNS_KEEP);
  assert.ok(kept.filter((x) => x.projectId === 'a').every((x) => x.at >= at(RUNS_KEEP - 1)), 'the newest stay');
  assert.equal(kept.filter((x) => x.projectId === 'b').length, 1);
  const small = [{ projectId: 'a', at: at(1) }];
  assert.equal(pruneRuns(small, Date.UTC(2026, 10, 21)), small, 'unchanged: the same list');
});

let clockAt = new Date(2026, 10, 23, 9, 0); // Monday 23 November 2026
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-rec-'));
const db = openDb(path.join(dir, 'db.json'));
db.data.holidays = HOLIDAYS;
const handle = createApi(db, { digestClock: () => clockAt });
const at = (y, m, d, h = 9) => (clockAt = new Date(y, m - 1, d, h, 0));
const run = () => handle.projects.runRecurring();
function client() {
  let cookie = '';
  const c = async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.9' } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
  return c;
}
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
  return true;
});
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'Correct-Horse-42' });
let empNo = 0;
async function account(username, role, name) {
  const [firstName, lastName] = name.split(' ');
  const employeeId = (await admin('POST', '/api/employees', { employeeNo: `E-${++empNo}`, firstName, lastName, hireDate: '2020-01-01', payType: 'monthly', rate: 30000, email: `${username}@example.com` })).id;
  const u = await admin('POST', '/api/users', { name, username, role, employeeId, password: 'Correct-Horse-42', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'Correct-Horse-42' });
  c.id = u.id;
  return c;
}
const pia = await account('pia', 'pm', 'Pia Manager');
const juan = await account('juan', 'employee', 'Juan Cruz');
const ana = await account('ana', 'employee', 'Ana Reyes');
const vic = await account('vic', 'employee', 'Vic Viewer');
const nora = await account('nora', 'employee', 'Nora Outsider');
const proj = await pia('POST', '/api/pm/projects', { name: 'Clinic rollout', type: 'Client', status: 'active', startDate: '2026-11-02', endDate: '2027-03-31' });
const v = (await pia('GET', `/api/pm/projects/${proj.id}`)).version;
await pia('PUT', `/api/pm/projects/${proj.id}/members`, { version: v, members: [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }, { userId: ana.id, role: 'member' }, { userId: vic.id, role: 'viewer' }] });
const base = `/api/pm/projects/${proj.id}`;
const taskOf = (id) => db.data.pmTasks.find((t) => t.id === id);
const runsOf = (rid) => db.data.pmRuns.filter((x) => x.sourceId === rid).sort((a, b) => a.at.localeCompare(b.at));
const close = (t) => pia('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'done' });
const weekly = { title: 'Weekly status report', schedule: { freq: 'weekly', days: [1, 4], start: '2026-11-23' }, assigneeId: null, dueIn: 2, size: 'S', checklist: ['Progress', 'Risks'], description: 'For the **client**.' };

test('who may: managers set them up; members and viewers read; others see nothing', async () => {
  await fails(juan('POST', `${base}/recurring`, weekly), 403, /managers/);
  await fails(nora('GET', `${base}/automations`), 404);
  const seen = await vic('GET', `${base}/automations`);
  assert.equal(seen.canManage, false);
  assert.deepEqual(seen.recurring, []);
  assert.equal(seen.open, true);
  await fails(pia('POST', `${base}/recurring`, { ...weekly, title: ' ' }), 400, /title/);
  await fails(pia('POST', `${base}/recurring`, { ...weekly, schedule: { freq: 'weekly', start: '2026-11-23' } }), 400, /day of the week/);
  await fails(pia('POST', `${base}/recurring`, { ...weekly, assigneeId: vic.id }), 400, /members \(not its viewers\)/);
  await fails(pia('POST', `${base}/recurring`, { ...weekly, assigneeId: nora.id }), 400, /members/);
  await fails(pia('POST', `${base}/recurring`, { ...weekly, statusId: 'nope' }), 400, /status/);
  await fails(pia('POST', `${base}/recurring`, { ...weekly, dueIn: 61 }), 400, /0 to 60/);
  await fails(pia('POST', `${base}/recurring`, { ...weekly, size: 'XXL' }), 400, /Size/);
  assert.equal(db.data.pmRecurring.length, 0);
});

let rec;
test('made on the day, once: due today is made at once, with the checklist, by CORE', async () => {
  at(2026, 11, 23);
  rec = await pia('POST', `${base}/recurring`, { ...weekly, assigneeId: juan.id });
  assert.ok(rec.madeTask, 'Monday: made now');
  assert.equal(rec.scheduleText, 'Every week on Monday and Thursday');
  assert.equal(rec.nextOn, '2026-11-26');
  assert.deepEqual(rec.upcoming, ['2026-11-26', '2026-12-01', '2026-12-03'], 'Monday 30 November is a holiday: Tuesday');
  const t = taskOf(rec.madeTask.taskId);
  assert.equal(t.title, 'Weekly status report');
  assert.equal(t.description, 'For the **client**.');
  assert.equal(t.assigneeId, juan.id);
  assert.equal(t.startDate, '2026-11-23');
  assert.equal(t.dueDate, '2026-11-25');
  assert.equal(t.size, 'S');
  assert.deepEqual(t.checklist.map((i) => [i.text, i.done]), [['Progress', false], ['Risks', false]]);
  assert.equal(t.recurringId, rec.id);
  assert.equal(t.createdBy, null);
  const full = await juan('GET', `/api/pm/tasks/${t.id}`);
  assert.equal(full.history[0].byName, 'CORE');
  assert.equal(full.history[0].to, 'repeats: Weekly status report');
  // Juan hears of it from CORE, in For you and the bell.
  const note = (await juan('GET', '/api/pm/notifications')).items?.find?.((n) => n.taskId === t.id) || (await juan('GET', '/api/pm/notifications')).find?.((n) => n.taskId === t.id);
  assert.ok(note, 'Juan is told');
  assert.equal(note.actorName, 'CORE');
  // The timer the same day makes nothing more.
  assert.deepEqual(await run(), { day: '2026-11-23', made: 0, skipped: 0, failed: 0 });
  at(2026, 11, 23, 23);
  assert.equal((await run()).made, 0);
  assert.equal(db.data.pmTasks.filter((x) => x.recurringId === rec.id).length, 1);
  const log = runsOf(rec.id);
  assert.equal(log.length, 1);
  assert.equal(log[0].result, 'done');
});

test('skipped while the last one is open; made again once it is done; a holiday moves the day', async () => {
  at(2026, 11, 26);
  assert.deepEqual(await run(), { day: '2026-11-26', made: 0, skipped: 1, failed: 0 });
  const skip = runsOf(rec.id).pop();
  assert.equal(skip.result, 'skipped');
  assert.equal(skip.note, 'The task made last time is still open.');
  await close(taskOf(db.data.pmRecurring[0].lastTaskId));
  // Monday 30 November is a holiday: nothing; Tuesday 1 December: made, starting that day.
  at(2026, 11, 30);
  assert.equal((await run()).made, 0);
  at(2026, 12, 1);
  assert.equal((await run()).made, 1);
  const t = taskOf(db.data.pmRecurring[0].lastTaskId);
  assert.equal(t.startDate, '2026-12-01');
  assert.equal(t.dueDate, '2026-12-03');
  const read = await vic('GET', `${base}/automations`);
  assert.equal(read.recurring[0].made, 2);
  assert.equal(read.recurring[0].lastTask.key, t.key);
  assert.equal(read.runs[0].result, 'done');
  assert.equal(read.runs[0].taskKey, t.key);
  assert.equal(read.runs[0].byName, 'CORE');
});

test('a server that was off makes one task for the latest day it missed', async () => {
  const r = db.data.pmRecurring[0];
  rec = await pia('PUT', `${base}/recurring/${r.id}`, { ...weekly, assigneeId: juan.id, skipIfOpen: false, version: r.version });
  assert.equal(rec.skipIfOpen, false);
  // Off from Thursday 3 to Thursday 17 December: 3, 7, 10, 14 and 17 December passed.
  at(2026, 12, 17);
  const before = db.data.pmTasks.filter((x) => x.recurringId === r.id).length;
  assert.equal((await run()).made, 1);
  assert.equal(db.data.pmTasks.filter((x) => x.recurringId === r.id).length, before + 1);
  const last = runsOf(r.id).pop();
  assert.equal(last.day, '2026-12-17');
  assert.match(last.note, /4 earlier days were missed while CORE was off/);
  assert.equal(r.nextOn, '2026-12-21');
});

test('pause and resume: nothing while paused, no catching up after', async () => {
  const r = db.data.pmRecurring[0];
  const paused = await pia('PUT', `${base}/recurring/${r.id}`, { active: false, version: r.version });
  assert.equal(paused.active, false);
  assert.equal(paused.nextOn, null);
  await fails(pia('PUT', `${base}/recurring/${r.id}`, { active: 'no' }), 400);
  const count = db.data.pmTasks.filter((x) => x.recurringId === r.id).length;
  at(2026, 12, 21);
  assert.equal((await run()).made, 0);
  at(2026, 12, 23);
  const on = await pia('PUT', `${base}/recurring/${r.id}`, { active: true, version: r.version });
  assert.equal(on.madeTask, null, 'Wednesday: not a day of the schedule');
  assert.equal(on.nextOn, '2026-12-24');
  assert.equal(db.data.pmTasks.filter((x) => x.recurringId === r.id).length, count, 'the paused Monday is not made');
  // A stale form is refused.
  await fails(pia('PUT', `${base}/recurring/${r.id}`, { active: false, version: 1 }), 409);
});

test('make one now: today, by the manager; today\'s scheduled one is not made again', async () => {
  const r = db.data.pmRecurring[0];
  at(2026, 12, 24, 7);
  await fails(juan('POST', `${base}/recurring/${r.id}/run`, {}), 403);
  const out = await pia('POST', `${base}/recurring/${r.id}/run`, {});
  assert.equal(out.madeTask.byName, 'Pia Manager');
  assert.match(out.madeTask.note, /Made by hand/);
  assert.equal(taskOf(out.madeTask.taskId).createdBy, pia.id);
  assert.equal(out.nextOn, '2026-12-28');
  assert.equal((await run()).made, 0, 'Thursday\'s is the one made by hand');
});

test('an assignee who left: made unassigned, with a note; the managers are not alarmed', async () => {
  const r = db.data.pmRecurring[0];
  const pv = (await pia('GET', base)).version;
  await pia('PUT', `${base}/members`, { version: pv, members: [{ userId: pia.id, role: 'manager' }, { userId: ana.id, role: 'member' }, { userId: vic.id, role: 'viewer' }] });
  assert.equal((await pia('GET', `${base}/automations`)).recurring[0].assigneeOk, false);
  at(2026, 12, 28);
  assert.equal((await run()).made, 1);
  const last = runsOf(r.id).pop();
  assert.equal(last.result, 'warning');
  assert.match(last.note, /Juan Cruz is no longer a member who can take tasks, so it is unassigned/);
  assert.equal(taskOf(last.taskId).assigneeId, null);
  // A deleted account: off the recurring task too.
  r.assigneeId = juan.id;
  removeUserFromProjects(db, juan.id);
  assert.equal(r.assigneeId, null);
});

test('a project on hold: the days pass, nothing is made or logged', async () => {
  const r = db.data.pmRecurring[0];
  const p = db.data.pmProjects.find((x) => x.id === proj.id);
  p.status = 'on_hold';
  const runs = db.data.pmRuns.length;
  const tasks = db.data.pmTasks.length;
  at(2026, 12, 31);
  assert.equal((await run()).made, 0);
  assert.equal(db.data.pmRuns.length, runs);
  assert.equal(db.data.pmTasks.length, tasks);
  assert.equal(r.lastOn, '2026-12-31');
  assert.match((await pia('GET', `${base}/automations`)).projectStatus, /On hold/);
  p.status = 'active';
});

test('a failure: logged, the managers told (For you and the bell), the audit log', async () => {
  const r = db.data.pmRecurring[0];
  r.checklist = null; // a damaged record
  at(2027, 1, 4);
  assert.equal((await run()).failed, 1);
  const last = runsOf(r.id).pop();
  assert.equal(last.result, 'failed');
  const notes = await pia('GET', '/api/pm/notifications');
  const list = Array.isArray(notes) ? notes : notes.items || notes.notifications || [];
  const alert = list.find((n) => n.kind === 'automation');
  assert.ok(alert, JSON.stringify(notes).slice(0, 300));
  assert.equal(alert.actorName, 'CORE');
  assert.match(alert.text, /could not make the recurring task “Weekly status report”/);
  assert.match(fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8'), /projects\.automation-failed/);
  r.checklist = [];
  // The timer goes on: the next day is not lost.
  assert.equal(r.nextOn, '2027-01-07');
});

test('daily, with an end date; templates do not run; copies start from the new project', async () => {
  at(2027, 1, 5);
  const d1 = await pia('POST', `${base}/recurring`, { title: 'Stand-up notes', schedule: { freq: 'daily', start: '2027-01-05', until: '2027-01-06' }, skipIfOpen: false });
  assert.ok(d1.madeTask);
  at(2027, 1, 6);
  assert.equal((await run()).made, 1);
  at(2027, 1, 7);
  assert.equal((await run()).made, 1, 'only the weekly one');
  assert.equal((await pia('GET', `${base}/automations`)).recurring.find((x) => x.id === d1.id).ended, true);
  // A template's recurring tasks never run.
  const tpl = await pia('POST', '/api/pm/projects', { name: 'Rollout template', type: 'Client', startDate: '2027-01-04' });
  await pia('PUT', `/api/pm/projects/${tpl.id}`, { isTemplate: true, version: (await pia('GET', `/api/pm/projects/${tpl.id}`)).version });
  const tr = await pia('POST', `/api/pm/projects/${tpl.id}/recurring`, { title: 'Monthly client report', schedule: { freq: 'monthly', monthDay: 'last-work', start: '2027-01-04' }, dueIn: 3 });
  assert.equal(tr.madeTask, null);
  await fails(pia('POST', `/api/pm/projects/${tpl.id}/recurring/${tr.id}/run`, {}), 400, /template/);
  at(2027, 1, 29);
  await run();
  assert.equal(db.data.pmTasks.filter((x) => x.recurringId === tr.id).length, 0);
  // A project from the template gets it, starting from its own start date, without an assignee.
  const made = await pia('POST', `/api/pm/projects/${tpl.id}/copy`, { name: 'Hospital rollout', startDate: '2027-02-01' });
  const copy = db.data.pmRecurring.find((x) => x.projectId === made.id);
  assert.ok(copy);
  assert.equal(copy.schedule.start, '2027-02-01');
  assert.equal(copy.assigneeId, null);
  assert.equal(copy.nextOn, '2027-02-26');
  assert.equal(copy.made, 0);
});

test('deleting: the recurring task goes, its tasks stay; a deleted project takes its runs', async () => {
  const d1 = db.data.pmRecurring.find((x) => x.title === 'Stand-up notes');
  const tasks = db.data.pmTasks.filter((x) => x.recurringId === d1.id).length;
  await fails(juan('DELETE', `${base}/recurring/${d1.id}`), 404); // no longer on the project
  await fails(ana('DELETE', `${base}/recurring/${d1.id}`), 403);
  assert.deepEqual(await pia('DELETE', `${base}/recurring/${d1.id}`), { ok: true });
  assert.equal(db.data.pmTasks.filter((x) => x.recurringId === d1.id).length, tasks);
  await fails(pia('DELETE', `${base}/recurring/${d1.id}`), 404);
  // Admin deletes the project: its recurring tasks and run log go with it.
  await admin('DELETE', base);
  assert.equal(db.data.pmRecurring.filter((x) => x.projectId === proj.id).length, 0);
  assert.equal(db.data.pmRuns.filter((x) => x.projectId === proj.id).length, 0);
  // Old data without the collections is mended.
  delete db.data.pmRecurring;
  delete db.data.pmRuns;
  migratePm(db);
  assert.deepEqual([db.data.pmRecurring, db.data.pmRuns], [[], []]);
});

test('module off: nothing runs', async () => {
  db.data.modules = { ...(db.data.modules || {}), projects: false };
  assert.equal((await run()).reason, 'module off');
  db.data.modules.projects = true;
});

test('demo data: recurring tasks with their tasks and runs, linked to the demo people, and removed with them', async () => {
  await admin('POST', '/api/admin/demo');
  const demo = db.data.pmRecurring.filter((x) => x.demo);
  assert.equal(demo.length, 3);
  for (const r of demo) {
    assert.ok(db.data.users.some((u) => u.id === r.assigneeId), 'assignee is a demo account');
    assert.ok(r.nextOn, 'has a next day');
    assert.ok(db.data.pmTasks.some((t) => t.recurringId === r.id), 'made tasks');
  }
  assert.ok(db.data.pmRuns.some((x) => x.demo && x.result === 'skipped'));
  await admin('DELETE', '/api/admin/demo');
  assert.equal(db.data.pmRecurring.filter((x) => x.demo).length, 0);
  assert.equal(db.data.pmRuns.filter((x) => x.demo).length, 0);
  handle.monitor.stop();
});
