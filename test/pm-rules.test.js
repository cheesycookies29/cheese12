// Automation rules (0.62): "When a task … If … Then …" per project. The rule checks and words
// (shared/pm-rules.js), then the API: who may set them up, each kind of event and action, chains
// and loops, overdue once per due date, failures, copies, templates and the run log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { DEFAULT_STATUSES } from '../shared/projects.js';
import { cleanRule, matches, describeRule, MAX_DEPTH } from '../shared/pm-rules.js';

const ctx = { statuses: DEFAULT_STATUSES, takers: ['u1', 'u2'], members: ['u1', 'u2', 'v1'], milestones: ['m1'] };
const rule = (raw) => {
  const r = cleanRule(raw, ctx);
  assert.ok(r.rule, r.error);
  return r.rule;
};

test('rules: checks, conditions and words', () => {
  const ok = { name: 'Done', when: { event: 'status', statusId: 'done' }, actions: [{ type: 'notify', to: 'managers', text: 'it is done' }] };
  for (const [raw, re] of [
    [{ ...ok, name: '' }, /Name the rule/], [{ ...ok, when: { event: 'deleted' } }, /pick what happens/], [{ ...ok, when: { event: 'status', statusId: 'nope' } }, /status of this project/],
    [{ ...ok, actions: [] }, /at least one action/], [{ ...ok, actions: [{ type: 'explode' }] }, /what each action does/],
    [{ ...ok, conditions: [{ field: 'title', op: 'is', value: 'x' }] }, /cannot be tested that way/], [{ ...ok, conditions: [{ field: 'priority', op: 'is', value: 'huge' }] }, /priority to compare/],
    [{ ...ok, conditions: [{ field: 'assignee', op: 'is', value: 'stranger' }] }, /assignee to compare/],
    [{ ...ok, actions: [{ type: 'assign', to: 'v1' }] }, /member who can take tasks/], [{ ...ok, actions: [{ type: 'notify', to: 'managers', text: ' ' }] }, /message/],
    [{ ...ok, actions: [{ type: 'status', statusId: 'done' }] }, /already moved to that status/], [{ ...ok, actions: [{ type: 'due', days: 61 }] }, /0 to 60/],
    [{ ...ok, actions: [{ type: 'checklist', items: '' }] }, /1 to 20 checklist items/], [{ ...ok, actions: [{ type: 'task', title: '' }] }, /title/],
    [{ ...ok, actions: Array(7).fill(ok.actions[0]) }, /up to 6 actions/],
  ]) assert.match(cleanRule(raw, ctx).error, re, JSON.stringify(raw).slice(0, 80));
  // Text is trimmed and capped; extra keys are dropped.
  const r = rule({ ...ok, name: '  Done  ', evil: 1, conditions: [{ field: 'title', op: 'contains', value: ' Client ', x: 1 }], actions: [{ type: 'checklist', items: 'A\n\n B ' }, { type: 'task', title: 'Follow up', to: 'manager', dueIn: '2', subtask: true }] });
  assert.equal(r.name, 'Done');
  assert.equal(r.evil, undefined);
  assert.deepEqual(r.conditions, [{ field: 'title', op: 'contains', value: 'Client' }]);
  assert.deepEqual(r.actions, [{ type: 'checklist', items: ['A', 'B'] }, { type: 'task', title: 'Follow up', to: 'manager', dueIn: 2, subtask: true }]);
  // Conditions.
  const t = { title: 'Send the client report', priority: 'high', assigneeId: null, statusId: 'doing', milestoneId: 'm1', size: 'M', parentId: 'x', recurringId: null };
  const m = (conditions) => matches(rule({ ...ok, conditions }), t);
  assert.equal(m([]), true);
  assert.equal(m([{ field: 'title', op: 'contains', value: 'CLIENT' }]), true);
  assert.equal(m([{ field: 'title', op: 'notContains', value: 'client' }]), false);
  assert.equal(m([{ field: 'assignee', op: 'empty' }, { field: 'priority', op: 'is', value: 'high' }]), true);
  assert.equal(m([{ field: 'assignee', op: 'set' }]), false);
  assert.equal(m([{ field: 'kind', op: 'is', value: 'subtask' }]), true);
  assert.equal(m([{ field: 'kind', op: 'isNot', value: 'recurring' }]), true);
  assert.equal(m([{ field: 'size', op: 'isNot', value: 'M' }]), false);
  assert.equal(m([{ field: 'milestone', op: 'is', value: 'm1' }, { field: 'status', op: 'is', value: 'doing' }]), true);
  // In words.
  const p = { statuses: DEFAULT_STATUSES };
  const names = { person: (id) => ({ u1: 'Pia' })[id] || 'someone', milestone: () => 'Build' };
  const w = describeRule(rule({ ...ok, conditions: [{ field: 'priority', op: 'is', value: 'urgent' }, { field: 'kind', op: 'is', value: 'top' }], actions: [{ type: 'assign', to: 'u1' }, { type: 'due', days: 2 }, { type: 'task', title: 'Invoice', to: 'manager', subtask: true }] }), p, names);
  assert.equal(w.when, 'When a task moves to Done');
  assert.deepEqual(w.conditions, ['priority is Urgent', 'it is not a subtask']);
  assert.deepEqual(w.actions, ['assign it to Pia', 'make it due 2 working days later', 'create a subtask “Invoice” for the project manager']);
  assert.equal(describeRule(rule({ ...ok, when: { event: 'overdue' } }), p, names).when, 'When a task becomes overdue');
  assert.equal(MAX_DEPTH, 3);
});

let clockAt = new Date(2026, 10, 23, 9, 0); // Monday 23 November 2026
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm-rules-'));
const db = openDb(path.join(dir, 'db.json'));
db.data.holidays = [];
const handle = createApi(db, { digestClock: () => clockAt });
const at = (y, m, d, h = 9) => (clockAt = new Date(y, m - 1, d, h, 0));
function client() {
  let cookie = '';
  return async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.7' } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
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
async function project(name) {
  const p = await pia('POST', '/api/pm/projects', { name, type: 'Client', status: 'active', startDate: '2026-11-02', endDate: '2027-03-31' });
  const v = (await pia('GET', `/api/pm/projects/${p.id}`)).version;
  await pia('PUT', `/api/pm/projects/${p.id}/members`, { version: v, members: [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }, { userId: ana.id, role: 'member' }, { userId: vic.id, role: 'viewer' }] });
  return p;
}
const proj = await project('Clinic rollout');
const base = `/api/pm/projects/${proj.id}`;
const taskOf = (id) => db.data.pmTasks.find((t) => t.id === id);
const runsOf = (ruleId) => db.data.pmRuns.filter((x) => x.sourceId === ruleId).sort((a, b) => a.at.localeCompare(b.at));
const notes = async (c) => {
  const r = await c('GET', '/api/pm/notifications');
  return Array.isArray(r) ? r : r.items || [];
};

let doneRule;
test('who may: managers add rules; members and viewers read them', async () => {
  const body = { name: 'Tell the managers when a task is done', when: { event: 'status', statusId: 'done' }, actions: [{ type: 'notify', to: 'managers', text: 'it is done' }] };
  await fails(juan('POST', `${base}/rules`, body), 403);
  await fails(pia('POST', `${base}/rules`, { ...body, actions: [{ type: 'assign', to: vic.id }] }), 400, /member who can take tasks/);
  doneRule = await pia('POST', `${base}/rules`, body);
  assert.equal(doneRule.text.when, 'When a task moves to Done');
  assert.deepEqual(doneRule.text.actions, ['notify the project\'s managers']);
  const seen = await vic('GET', `${base}/automations`);
  assert.equal(seen.rules.length, 1);
  assert.equal(seen.canManage, false);
});

test('status: a task moved to Done tells the managers, from CORE, and is in the run log', async () => {
  const t = await juan('POST', `${base}/tasks`, { title: 'Install the lab printers', assigneeId: juan.id });
  await juan('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'done' });
  const n = (await notes(pia)).find((x) => x.kind === 'rule' && x.taskId === t.id);
  assert.ok(n, 'Pia is told');
  assert.equal(n.actorName, 'CORE');
  assert.equal(n.text, `about ${t.key}: it is done`);
  assert.ok(!(await notes(juan)).some((x) => x.kind === 'rule'), 'Juan is not a manager');
  const run = runsOf(doneRule.id).pop();
  assert.equal(run.result, 'done');
  assert.equal(run.taskId, t.id);
  assert.equal(run.note, 'Notified Pia Manager');
  // Moved elsewhere: nothing. Back to Done through the form: it runs again.
  await juan('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'doing' });
  assert.equal(runsOf(doneRule.id).length, 1);
  const full = await juan('GET', `/api/pm/tasks/${t.id}`);
  await juan('PUT', `/api/pm/tasks/${t.id}`, { ...full, statusId: 'done' });
  assert.equal(runsOf(doneRule.id).length, 2);
  assert.equal((await pia('GET', `${base}/automations`)).rules[0].runs, 2);
});

let triage;
test('created: tasks added without an assignee go to the project manager (not those with one)', async () => {
  triage = await pia('POST', `${base}/rules`, { name: 'Unassigned to the manager', when: { event: 'created' }, conditions: [{ field: 'assignee', op: 'empty' }], actions: [{ type: 'assign', to: 'manager' }, { type: 'watch', to: ana.id }] });
  const t = await juan('POST', `${base}/tasks`, { title: 'Order the label printer' });
  assert.equal(t.assigneeId, pia.id, 'the response has the rule\'s change');
  assert.ok(taskOf(t.id).watchers.includes(ana.id));
  assert.ok((await notes(pia)).some((x) => x.kind === 'assigned' && x.taskId === t.id && x.actorName === 'CORE'));
  const hist = (await pia('GET', `/api/pm/tasks/${t.id}`)).history.find((h) => h.field === 'assignee');
  assert.equal(hist.byName, 'CORE');
  const mine = await juan('POST', `${base}/tasks`, { title: 'Mine', assigneeId: juan.id });
  assert.equal(mine.assigneeId, juan.id);
  assert.equal(runsOf(triage.id).length, 1);
  // Imported tasks and tasks from bulk changes set rules off too.
  const csv = 'Title,Assignee\nImported one,\nImported two,juan\n';
  const out = await pia('POST', `${base}/import`, { csv, mapping: { title: 0, assignee: 1 } });
  assert.equal(out.imported, 2, JSON.stringify(out));
  assert.equal(db.data.pmTasks.find((x) => x.title === 'Imported one').assigneeId, pia.id);
  assert.equal(db.data.pmTasks.find((x) => x.title === 'Imported two').assigneeId, juan.id);
  const both = db.data.pmTasks.filter((x) => x.title.startsWith('Imported')).map((x) => x.id);
  const before = runsOf(doneRule.id).length;
  await pia('POST', `${base}/tasks/bulk`, { ids: both, set: { statusId: 'done' } });
  assert.equal(runsOf(doneRule.id).length, before + 2);
  // Off: nothing.
  const off = await pia('PUT', `${base}/rules/${triage.id}`, { active: false, version: triage.version });
  assert.equal(off.active, false);
  assert.equal((await juan('POST', `${base}/tasks`, { title: 'While off' })).assigneeId, null);
  await fails(pia('PUT', `${base}/rules/${triage.id}`, { active: true, version: 1 }), 409);
});

test('subtasks done → the parent moves to review → a second rule adds its checklist (a chain)', async () => {
  const toReview = await pia('POST', `${base}/rules`, { name: 'Parent to review', when: { event: 'subtasksDone' }, actions: [{ type: 'status', statusId: 'review' }] });
  const checklist = await pia('POST', `${base}/rules`, { name: 'Review checklist', when: { event: 'status', statusId: 'review' }, conditions: [{ field: 'kind', op: 'is', value: 'top' }], actions: [{ type: 'checklist', items: ['Tested', 'Client notes'] }, { type: 'comment', text: 'Ready for review: please check it.' }] });
  const parent = await juan('POST', `${base}/tasks`, { title: 'Train the nurses', assigneeId: juan.id });
  const a = await juan('POST', `${base}/tasks`, { title: 'Ward A', parentId: parent.id, assigneeId: juan.id });
  const b = await juan('POST', `${base}/tasks`, { title: 'Ward B', parentId: parent.id, assigneeId: juan.id });
  await juan('PUT', `/api/pm/tasks/${a.id}/move`, { statusId: 'done' });
  assert.equal(taskOf(parent.id).statusId, 'todo', 'one subtask still open');
  await juan('PUT', `/api/pm/tasks/${b.id}/move`, { statusId: 'cancelled' });
  assert.equal(taskOf(parent.id).statusId, 'review');
  assert.deepEqual(taskOf(parent.id).checklist.map((i) => i.text), ['Tested', 'Client notes']);
  assert.equal(runsOf(toReview.id).pop().note, 'Moved to For review');
  // The rule's comment: by CORE, which nobody can edit; the watchers hear of it.
  const comments = await juan('GET', `/api/pm/tasks/${parent.id}/comments`);
  const c = comments.find((x) => x.body === 'Ready for review: please check it.');
  assert.equal(c.userName, 'CORE');
  assert.equal(c.canEdit, false);
  assert.ok((await notes(juan)).some((x) => x.kind === 'commented' && x.taskId === parent.id && x.actorName === 'CORE'));
  // A subtask moved to review: not the checklist rule (only top-level tasks).
  await juan('PUT', `/api/pm/tasks/${a.id}/move`, { statusId: 'review' });
  assert.equal(taskOf(a.id).checklist.length, 0);
  await pia('DELETE', `${base}/rules/${toReview.id}`);
  await pia('DELETE', `${base}/rules/${checklist.id}`);
});

test('a loop stops: once per rule and task, and at most three steps deep', async () => {
  const q = await project('Loop project');
  const qb = `/api/pm/projects/${q.id}`;
  // Ping-pong: each rule runs once for the task, then it stops.
  await pia('POST', `${qb}/rules`, { name: 'Ping', when: { event: 'status', statusId: 'doing' }, actions: [{ type: 'status', statusId: 'waiting' }] });
  await pia('POST', `${qb}/rules`, { name: 'Pong', when: { event: 'status', statusId: 'waiting' }, actions: [{ type: 'status', statusId: 'doing' }] });
  const t = await juan('POST', `${qb}/tasks`, { title: 'Loop', assigneeId: juan.id });
  await juan('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'doing' });
  assert.equal(taskOf(t.id).statusId, 'doing', 'Ping → waiting, Pong → doing, Ping does not run twice');
  // A longer chain: doing → waiting (Ping) → review → done → (notify: too deep).
  for (const r of db.data.pmRules.filter((x) => x.projectId === q.id && x.name === 'Pong')) await pia('DELETE', `${qb}/rules/${r.id}`);
  await pia('POST', `${qb}/rules`, { name: 'Step 2', when: { event: 'status', statusId: 'waiting' }, actions: [{ type: 'status', statusId: 'review' }] });
  await pia('POST', `${qb}/rules`, { name: 'Step 3', when: { event: 'status', statusId: 'review' }, actions: [{ type: 'status', statusId: 'done' }] });
  const last = await pia('POST', `${qb}/rules`, { name: 'Step 4', when: { event: 'status', statusId: 'done' }, actions: [{ type: 'notify', to: 'managers', text: 'done' }] });
  const t2 = await juan('POST', `${qb}/tasks`, { title: 'Chain', assigneeId: juan.id });
  await juan('PUT', `/api/pm/tasks/${t2.id}/move`, { statusId: 'doing' });
  assert.equal(taskOf(t2.id).statusId, 'done');
  const r4 = runsOf(last.id).pop();
  assert.equal(r4.result, 'skipped');
  assert.match(r4.note, /rules set each other off more than 3 times in a row/);
});

test('overdue: once per task and due date, not for tasks already late; a new due date counts again', async () => {
  const late = await juan('POST', `${base}/tasks`, { title: 'Already late', assigneeId: juan.id, dueDate: '2026-11-20' });
  const rule = await pia('POST', `${base}/rules`, { name: 'Raise overdue tasks', when: { event: 'overdue' }, actions: [{ type: 'priority', priority: 'high' }, { type: 'notify', to: 'assignee', text: 'it is overdue' }] });
  const soon = await juan('POST', `${base}/tasks`, { title: 'Due Tuesday', assigneeId: juan.id, dueDate: '2026-11-24' });
  assert.equal((await handle.projects.runOverdue()).tasks, 0, 'Monday: nothing new is late');
  at(2026, 11, 25);
  assert.equal((await handle.projects.runOverdue()).tasks, 1);
  assert.equal(taskOf(soon.id).priority, 'high');
  assert.equal(taskOf(late.id).priority, 'normal', 'late before the rule: left alone');
  assert.ok((await notes(juan)).some((x) => x.kind === 'rule' && x.text === `about ${soon.key}: it is overdue`));
  assert.equal((await handle.projects.runOverdue()).tasks, 0, 'once');
  // A new due date that passes again: again. A done task: never.
  const full = await juan('GET', `/api/pm/tasks/${soon.id}`);
  await juan('PUT', `/api/pm/tasks/${soon.id}`, { ...full, dueDate: '2026-11-26', priority: 'normal' });
  at(2026, 11, 27);
  assert.equal((await handle.projects.runOverdue()).tasks, 1);
  assert.equal(runsOf(rule.id).length, 2);
  const done = await juan('POST', `${base}/tasks`, { title: 'Done early', assigneeId: juan.id, dueDate: '2026-11-27' });
  await juan('PUT', `/api/pm/tasks/${done.id}/move`, { statusId: 'done' });
  at(2026, 11, 30);
  await handle.projects.runOverdue();
  assert.equal(taskOf(done.id).overdueSeen, undefined);
  await pia('DELETE', `${base}/rules/${rule.id}`);
});

test('comments and new tasks: a comment on a client task adds a follow-up subtask, made by CORE', async () => {
  const r = await pia('POST', `${base}/rules`, { name: 'Follow up client comments', when: { event: 'commented' }, conditions: [{ field: 'title', op: 'contains', value: 'client' }],
    actions: [{ type: 'task', title: 'Answer the client', to: 'creator', dueIn: 1, subtask: true }, { type: 'due', days: 3 }] });
  const t = await juan('POST', `${base}/tasks`, { title: 'Client sign-off', assigneeId: juan.id, startDate: '2026-12-10' });
  await ana('POST', `/api/pm/tasks/${t.id}/comments`, { body: 'The client asked about the date.' });
  const sub = db.data.pmTasks.find((x) => x.parentId === t.id && x.title === 'Answer the client');
  assert.ok(sub);
  assert.equal(sub.assigneeId, juan.id, 'who added the task');
  assert.equal(sub.createdBy, null);
  assert.equal(sub.ruleId, r.id);
  assert.equal(sub.startDate, '2026-11-30');
  assert.equal(sub.dueDate, '2026-12-01');
  assert.equal(taskOf(t.id).dueDate, '2026-12-03');
  assert.equal(taskOf(t.id).startDate, '2026-12-03', 'the start moves back to the due date');
  assert.match(runsOf(r.id).pop().note, new RegExp(`^Made ${sub.key}\\. Due 2026-12-03$`));
  // A comment on another task: nothing.
  const other = await juan('POST', `${base}/tasks`, { title: 'Internal note', assigneeId: juan.id });
  await ana('POST', `/api/pm/tasks/${other.id}/comments`, { body: 'Hello' });
  assert.equal(runsOf(r.id).length, 1);
  await pia('DELETE', `${base}/rules/${r.id}`);
});

test('a failure: logged, the managers told; what was done before it stays', async () => {
  const r = await pia('POST', `${base}/rules`, { name: 'Breaks', when: { event: 'created' }, actions: [{ type: 'priority', priority: 'urgent' }, { type: 'checklist', items: ['x'] }] });
  db.data.pmRules.find((x) => x.id === r.id).actions[1].items = null; // a damaged record
  const t = await juan('POST', `${base}/tasks`, { title: 'Set off the broken rule', assigneeId: juan.id });
  assert.equal(taskOf(t.id).priority, 'urgent');
  const run = runsOf(r.id).pop();
  assert.equal(run.result, 'failed');
  assert.match(run.note, /^Priority Urgent\. Stopped: /);
  assert.ok((await notes(pia)).some((x) => x.kind === 'automation' && /could not finish the rule “Breaks” on/.test(x.text)));
  assert.match(fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8'), /projects\.automation-failed/);
  await pia('DELETE', `${base}/rules/${r.id}`);
});

test('templates do not run rules; a copy gets the rules that name no one', async () => {
  const tpl = await pia('POST', '/api/pm/projects', { name: 'Rollout template', type: 'Client', startDate: '2026-11-02' });
  await pia('PUT', `/api/pm/projects/${tpl.id}`, { isTemplate: true, version: (await pia('GET', `/api/pm/projects/${tpl.id}`)).version });
  const ms = await pia('POST', `/api/pm/projects/${tpl.id}/milestones`, { name: 'Go-live', dueDate: '2026-12-15' });
  await pia('POST', `/api/pm/projects/${tpl.id}/rules`, { name: 'Generic', when: { event: 'created' }, conditions: [{ field: 'milestone', op: 'is', value: ms.id }], actions: [{ type: 'priority', priority: 'high' }, { type: 'watch', to: 'manager' }] });
  await pia('POST', `/api/pm/projects/${tpl.id}/rules`, { name: 'Names Pia', when: { event: 'created' }, actions: [{ type: 'assign', to: pia.id }] });
  const t = await pia('POST', `/api/pm/projects/${tpl.id}/tasks`, { title: 'Pattern task', milestoneId: ms.id });
  assert.equal(taskOf(t.id).priority, 'normal', 'not in a template');
  const made = await pia('POST', `/api/pm/projects/${tpl.id}/copy`, { name: 'Hospital rollout', startDate: '2027-01-04' });
  const copies = db.data.pmRules.filter((x) => x.projectId === made.id);
  assert.deepEqual(copies.map((x) => x.name), ['Generic']);
  const newMs = db.data.pmMilestones.find((m) => m.projectId === made.id);
  assert.equal(copies[0].conditions[0].value, newMs.id);
  assert.equal(copies[0].runs, 0);
});

test('deleting a project takes its rules; module off: rules do not run', async () => {
  const q = await project('Short-lived');
  await pia('POST', `/api/pm/projects/${q.id}/rules`, { name: 'Any', when: { event: 'created' }, actions: [{ type: 'priority', priority: 'low' }] });
  db.data.modules = { ...(db.data.modules || {}), projects: false };
  assert.equal((await handle.projects.runOverdue()).reason, 'module off');
  db.data.modules.projects = true;
  await admin('DELETE', `/api/pm/projects/${q.id}`);
  assert.equal(db.data.pmRules.filter((x) => x.projectId === q.id).length, 0);
  handle.monitor.stop();
});
