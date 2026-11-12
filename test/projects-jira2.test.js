// Project Management 0.15: watchers and the daily digest, bulk edit on the List, files on tasks
// and milestones, milestones across projects with the billing forecast, and importing tasks from a
// CSV file, with who may read and change each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';
import { migratePm } from '../server/projects.js';
import { digestEmail } from '../server/pm-digest.js';
import { composeMessage } from '../server/mail/compose.js';
import { toCsv } from '../public/js/ui.js';
import { parseCsv, csvSeparator } from '../shared/csv.js';
import {
  addDays, workCalendar, digestFor, digestDue, billingAmount, billingForecast, forecastCsvRows, guessImportMapping, importPlan, parseImportDate,
  DEFAULT_STATUSES, IMPORT_TEMPLATE,
} from '../shared/projects.js';

// A fake mail server and a clock the digest reads.
const outbox = [];
let failNext = false;
let clockAt = new Date(2026, 11, 1, 6, 0);
const fakeSend = async (opts, mail) => {
  if (failNext) {
    failNext = false;
    throw new Error('Sending failed: 550 mailbox unavailable');
  }
  outbox.push({ opts, ...mail });
};

function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pm15-'));
  const db = openDb(path.join(dir, 'db.json'));
  const handle = createApi(db, { digestMail: fakeSend, digestClock: () => clockAt });
  const client = () => {
    let cookie = '';
    const c = async (method, url, body = {}) => {
      const res = await handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
      if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
      return res.data;
    };
    c.raw = async (method, url, body = {}) => handle({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    return c;
  };
  return { db, dir, handle, client };
}
const { db, dir, handle, client } = server();
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
let empNo = 0;
async function account(username, role, name, email = `${username}@example.com`) {
  const [firstName, lastName] = name.split(' ');
  const employeeId = (await admin('POST', '/api/employees', { employeeNo: `E-${++empNo}`, firstName, lastName, hireDate: '2020-01-01', payType: 'monthly', rate: 30000, email })).id;
  const u = await admin('POST', '/api/users', { name, username, role, employeeId, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  c.id = u.id;
  return c;
}
const pia = await account('pia', 'pm', 'Pia Manager');
const juan = await account('juan', 'employee', 'Juan Cruz');
const ana = await account('ana', 'employee', 'Ana Reyes');
const vic = await account('vic', 'employee', 'Vic Viewer');
const nora = await account('nora', 'employee', 'Nora Outsider');
const marco = await account('marco', 'salesmgr', 'Marco Tan');
const today = localDate();
const day = (n) => addDays(today, n);
const fails = async (promise, status, re) => {
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, status, err.message);
    if (re) assert.match(err.message, re);
    return true;
  });
};
async function project(name, extra = {}) {
  const p = await pia('POST', '/api/pm/projects', { name, type: 'Client', startDate: day(-20), endDate: day(60), ...extra });
  const v = (await pia('GET', `/api/pm/projects/${p.id}`)).version;
  await pia('PUT', `/api/pm/projects/${p.id}/members`, { version: v, members: [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }, { userId: ana.id, role: 'member' }, { userId: vic.id, role: 'viewer' }] });
  return p;
}
const p = await project('Clinic rollout');
const notes = async (c) => (await c('GET', '/api/pm/notifications')).items;
const pdf = (text = 'hello') => ({ name: 'Acceptance certificate.pdf', data: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`).toString('base64') });

// ===== Watchers =====
test('watchers: the creator and the assignee watch; a commenter joins unless they stopped watching', async () => {
  const t = await juan('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Install servers', assigneeId: ana.id });
  assert.deepEqual(new Set(t.watchers), new Set([juan.id, ana.id]));
  await vic('POST', `/api/pm/tasks/${t.id}/comments`, { body: 'Which rack?' });
  let full = await pia('GET', `/api/pm/tasks/${t.id}`);
  assert.ok(full.watchers.includes(vic.id), 'a viewer who comments watches');
  assert.equal(full.watching, false);
  // Vic stops watching; commenting again does not bring him back. Watch brings him back.
  assert.equal((await vic('PUT', `/api/pm/tasks/${t.id}/watch`, { watching: false })).watching, false);
  await vic('POST', `/api/pm/tasks/${t.id}/comments`, { body: 'Thanks' });
  full = await vic('GET', `/api/pm/tasks/${t.id}`);
  assert.equal(full.watching, false);
  assert.ok(!full.unwatchedBy, 'who stopped watching is not sent');
  await vic('PUT', `/api/pm/tasks/${t.id}/watch`, { watching: true });
  assert.equal((await vic('GET', `/api/pm/tasks/${t.id}`)).watching, true);
  // Marco sees every project (pm.view) without being a member: he can watch too.
  await marco('PUT', `/api/pm/tasks/${t.id}/watch`, { watching: true });
  // Someone who cannot open the project: not found.
  await fails(nora('PUT', `/api/pm/tasks/${t.id}/watch`, { watching: true }), 404);
  await fails(juan('PUT', `/api/pm/tasks/${t.id}/watch`, { watching: 'yes' }), 400);
  // Being assigned starts watching again, even after stopping.
  await pia('PUT', `/api/pm/tasks/${t.id}/watch`, { watching: false });
  const v = (await pia('GET', `/api/pm/tasks/${t.id}`)).version;
  await juan('PUT', `/api/pm/tasks/${t.id}`, { assigneeId: pia.id, version: v });
  assert.ok((await pia('GET', `/api/pm/tasks/${t.id}`)).watching);
});

test('watchers hear of comments and of the task done or cancelled, once each; never the actor', async () => {
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Order cables', assigneeId: juan.id });
  await ana('PUT', `/api/pm/tasks/${t.id}/watch`, { watching: true });
  await marco('PUT', `/api/pm/tasks/${t.id}/watch`, { watching: true });
  // Juan mentions Ana: she gets the mention only, not also a comment; Pia (creator) and Marco a comment.
  await juan('POST', `/api/pm/tasks/${t.id}/comments`, { body: '@ana can you check the quote?' });
  const mine = async (c) => (await notes(c)).filter((n) => n.taskId === t.id);
  assert.deepEqual((await mine(ana)).map((n) => n.kind), ['mentioned']);
  assert.deepEqual((await mine(pia)).map((n) => n.kind), ['commented']);
  assert.deepEqual((await mine(marco)).map((n) => n.kind), ['commented']);
  assert.deepEqual((await mine(juan)).map((n) => n.kind), ['assigned'], 'the commenter is not told of their own comment');
  // Ana moves it to Done: the assignee and the other watchers hear once; Ana does not.
  await ana('PUT', `/api/pm/tasks/${t.id}/move`, { statusId: 'done' });
  assert.equal((await mine(juan)).filter((n) => n.kind === 'status').length, 1);
  assert.equal((await mine(marco)).filter((n) => n.kind === 'status').length, 1);
  assert.equal((await mine(ana)).filter((n) => n.kind === 'status').length, 0);
});

test('watchers: someone taken off the project stops watching; a deleted account too', async () => {
  const q = await project('Watch test');
  const t = await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'A', assigneeId: ana.id });
  await juan('PUT', `/api/pm/tasks/${t.id}/watch`, { watching: true });
  const v = (await pia('GET', `/api/pm/projects/${q.id}`)).version;
  await pia('PUT', `/api/pm/projects/${q.id}/members`, { version: v, members: [{ userId: pia.id, role: 'manager' }, { userId: ana.id, role: 'member' }] });
  const w = (await pia('GET', `/api/pm/tasks/${t.id}`)).watchers;
  assert.ok(!w.includes(juan.id) && !w.includes(vic.id) && w.includes(ana.id));
  // Tasks from before 0.15 watch their creator and assignee.
  const raw = db.data.pmTasks.find((x) => x.id === t.id);
  delete raw.watchers;
  migratePm(db);
  assert.deepEqual(new Set(raw.watchers), new Set([pia.id, ana.id]));
});

// ===== The daily digest =====
test('digestFor: overdue, due within 3 working days (holidays skipped), milestones at risk, unread', () => {
  const cal = workCalendar({}, [{ date: '2026-11-30', type: 'regular' }]);
  // Friday 27 Nov 2026: due soon runs to Thursday 3 Dec (Monday 30 Nov is a holiday).
  const tasks = [['a', '2026-11-26'], ['b', '2026-11-27'], ['c', '2026-12-03'], ['d', '2026-12-04'], ['e', null]].map(([key, dueDate]) => ({ key, title: key, dueDate }));
  const dg = digestFor({ tasks, milestones: [{ name: 'M1', value: 'green', dueDate: '2026-12-01' }, { name: 'M2', value: 'amber', dueDate: '2026-12-10' }, { name: 'M3', value: 'red', dueDate: '2026-12-20' }], unread: 2, today: '2026-11-27', cal });
  assert.deepEqual(dg.overdue.map((t) => t.key), ['a']);
  assert.deepEqual(dg.dueSoon.map((t) => t.key), ['b', 'c']);
  assert.deepEqual(dg.atRisk.map((m) => m.name), ['M3', 'M2'], 'off track first');
  assert.equal(dg.empty, false);
  assert.equal(digestFor({ tasks: [], milestones: [], unread: 0, today: '2026-11-27', cal }).empty, true);
  // Due: on or after the time, on working days only when asked.
  const s = { enabled: true, time: '07:30', workingDaysOnly: true };
  assert.equal(digestDue(s, '2026-12-01', '07:29', cal), false);
  assert.equal(digestDue(s, '2026-12-01', '07:30', cal), true);
  assert.equal(digestDue(s, '2026-11-30', '09:00', cal), false, 'a holiday');
  assert.equal(digestDue(s, '2026-11-29', '09:00', cal), false, 'a Sunday');
  assert.equal(digestDue({ ...s, workingDaysOnly: false }, '2026-11-29', '09:00', cal), true);
  assert.equal(digestDue({ ...s, enabled: false }, '2026-12-01', '09:00', cal), false);
});

test('digest email: plain text and HTML, everything escaped, links only with a known address', () => {
  const dg = { today: '2026-12-01', overdue: [{ id: 't1', key: 'PRJ-1-1', title: '<script>alert(1)</script> & co', dueDate: '2026-11-27', projectId: 'p1', projectName: 'A "B"' }], dueSoon: [], atRisk: [], unread: 3, empty: false };
  const m = digestEmail(dg, { name: 'Juan Cruz', company: 'Lancaster', origin: null });
  assert.match(m.subject, /1 overdue, 3 unread/);
  assert.match(m.text, /Hello Juan,/);
  assert.match(m.text, /PRJ-1-1 <script>/);
  assert.ok(!/http/.test(m.text) && !/href/.test(m.html), 'no links without an address');
  assert.ok(!m.html.includes('<script>'), 'escaped in the HTML');
  assert.match(m.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; co/);
  const linked = digestEmail(dg, { name: 'Juan', origin: 'https://core.example.com' });
  assert.match(linked.text, /https:\/\/core\.example\.com\/#\/projects\/p1\/tasks\/t1/);
  assert.match(linked.html, /href="https:\/\/core\.example\.com\/#\/projects\/my-work"/);
  // composeMessage: both parts, as multipart/alternative.
  const raw = composeMessage({ from: { email: 'desk@example.com' }, to: [{ email: 'juan@example.com' }], subject: m.subject, text: m.text, html: m.html, messageId: '<x@example.com>', auto: 'generated' });
  assert.match(raw, /Content-Type: multipart\/alternative; boundary="core-/);
  assert.match(raw, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(raw, /Content-Type: text\/html; charset=utf-8/);
  assert.match(raw, /Auto-Submitted: auto-generated/);
});

test('digest: once a working day at the set time, through the Service Desk mail, only what each person can open', async () => {
  const q = await project('Digest project', { startDate: '2026-11-02', endDate: '2027-02-01' });
  const qv = (await pia('GET', `/api/pm/projects/${q.id}`)).version;
  // Nora is not on this project: her digest must not show it.
  await pia('PUT', `/api/pm/projects/${q.id}/members`, { version: qv, members: [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }] });
  const late = await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'Late <task>', assigneeId: juan.id, dueDate: '2026-11-25' });
  await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'Soon', assigneeId: juan.id, dueDate: '2026-12-03' });
  await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'Later', assigneeId: juan.id, dueDate: '2026-12-20' });
  const ms = await pia('POST', `/api/pm/projects/${q.id}/milestones`, { name: 'Build', dueDate: '2026-12-10' });
  await pia('PUT', `/api/pm/tasks/${late.id}`, { milestoneId: ms.id });
  // Before outgoing mail and the company setting: nothing is sent; the digest is on My work.
  const mine = await juan('GET', '/api/pm/digest');
  assert.ok(mine.email.preference);
  assert.equal(mine.email.emailing, false);
  clockAt = new Date(2026, 11, 1, 8, 0);
  assert.equal((await handle.projects.runDigest()).sent, 0);
  assert.equal(outbox.length, 0);
  // Setup: Projects setup needs pm.manage.
  await fails(juan('PUT', '/api/pm/settings/digest', { enabled: true }), 403);
  await fails(pia('PUT', '/api/pm/settings/digest', { enabled: true, time: '7:30' }), 400);
  const set = await pia('PUT', '/api/pm/settings/digest', { enabled: true, time: '07:30', workingDaysOnly: true });
  assert.equal(set.canEmail, false);
  // Outgoing mail as the Service Desk has it.
  Object.assign(db.data.helpdesk.mailbox, { address: 'desk@example.com', user: 'desk@example.com' });
  Object.assign(db.data.helpdesk.outgoing, { enabled: true, host: 'smtp.example.com', port: 587, security: 'starttls', sameLogin: true });
  assert.equal((await juan('GET', '/api/pm/digest')).email.emailing, true);
  // Nora turns it off; Ana's account is disabled; Vic has no email address; Marco has read his For you.
  await nora('PUT', '/api/pm/digest/preference', { email: false });
  await marco('PUT', '/api/pm/notifications/read', { all: true });
  db.data.users.find((u) => u.id === ana.id).active = false;
  const vicEmp = db.data.employees.find((e) => e.id === db.data.users.find((u) => u.id === vic.id).employeeId);
  vicEmp.email = '';
  try {
    // 07:00 on Tuesday 1 Dec: not yet.
    clockAt = new Date(2026, 11, 1, 7, 0);
    assert.equal((await handle.projects.runDigest()).reason, 'not due');
    // 07:31: Juan (tasks) and Pia (a milestone at risk) get one each; nobody else.
    clockAt = new Date(2026, 11, 1, 7, 31);
    const r = await handle.projects.runDigest();
    const to = outbox.map((m) => m.to[0]).sort();
    assert.ok(to.includes('juan@example.com') && to.includes('pia@example.com'), to.join());
    for (const who of ['nora', 'ana', 'vic', 'marco']) assert.ok(!to.includes(`${who}@example.com`), `${who} gets none`);
    assert.equal(r.sent, outbox.length);
    const juanMail = outbox.find((m) => m.to[0] === 'juan@example.com');
    assert.equal(juanMail.from, 'desk@example.com');
    assert.equal(juanMail.opts.host, 'smtp.example.com');
    const body = Buffer.from(juanMail.raw.split('Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('--core-')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');
    assert.match(body, /OVERDUE \(\d+\)/);
    assert.match(body, /Late <task>/);
    assert.match(body, /DUE IN THE NEXT 3 WORKING DAYS[\s\S]*Soon/);
    assert.ok(!/Later/.test(body), 'not due soon');
    // Once a day: running again (later, or after a restart) sends nothing more.
    const before = outbox.length;
    clockAt = new Date(2026, 11, 1, 16, 0);
    assert.equal((await handle.projects.runDigest()).sent, 0);
    assert.equal(outbox.length, before);
    assert.equal(db.data.pm.digest.sent[juan.id], '2026-12-01');
    // A server that was off at 07:30 on Wednesday catches up at 10:15, once.
    clockAt = new Date(2026, 11, 2, 10, 15);
    assert.ok((await handle.projects.runDigest()).sent >= 1);
    assert.equal(outbox.filter((m) => m.to[0] === 'juan@example.com').length, 2);
    // Saturday: no digest (working days only).
    clockAt = new Date(2026, 11, 5, 9, 0);
    assert.equal((await handle.projects.runDigest()).reason, 'not due');
    // A failed send is recorded once (no retries the same day), without the sign-in.
    failNext = true;
    clockAt = new Date(2026, 11, 3, 7, 40);
    const fr = await handle.projects.runDigest();
    assert.equal(fr.failed, 1);
    assert.match(db.data.pm.digest.lastRun.error, /550/);
    const again = outbox.length;
    await handle.projects.runDigest();
    assert.equal(outbox.length, again, 'no retry');
    const log = fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8');
    assert.match(log, /projects\.digest-failed/);
    // Nora's digest (in the app) has none of this project's tasks.
    const nd = await nora('GET', '/api/pm/digest');
    assert.equal(nd.email.preference, false);
    assert.ok(![...nd.overdue, ...nd.dueSoon].some((t) => t.projectId === q.id));
    // The preference only takes true or false.
    await fails(nora('PUT', '/api/pm/digest/preference', { email: 'no' }), 400);
  } finally {
    db.data.users.find((u) => u.id === ana.id).active = true;
    vicEmp.email = 'vic@example.com';
    Object.assign(db.data.helpdesk.outgoing, { enabled: false });
  }
});

// ===== Bulk edit =====
test('bulk edit: status, assignee, milestone and priority for many tasks, each with its history', async () => {
  const q = await project('Bulk project');
  const ms = await pia('POST', `/api/pm/projects/${q.id}/milestones`, { name: 'Phase 1', dueDate: day(30) });
  const ts = [];
  for (const title of ['A', 'B', 'C']) ts.push(await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title, assigneeId: ana.id }));
  const r = await juan('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: ts.map((t) => t.id), set: { statusId: 'done', assigneeId: juan.id, milestoneId: ms.id, priority: 'high', title: 'ignored' } });
  assert.equal(r.changed, 3);
  for (const t of ts) {
    const x = await pia('GET', `/api/pm/tasks/${t.id}`);
    assert.equal(x.statusId, 'done');
    assert.equal(x.assigneeId, juan.id);
    assert.equal(x.milestoneId, ms.id);
    assert.equal(x.priority, 'high');
    assert.equal(x.title, t.title, 'only the four fields');
    assert.ok(x.completedAt);
    assert.equal(x.version, t.version + 1);
    assert.deepEqual(new Set(x.history.map((h) => h.field)), new Set(['created', 'status', 'assignee', 'milestone', 'priority']));
  }
  // Grouped notifications: Ana (no longer assignee, still watching) hears once that 3 tasks are done.
  const anaNotes = (await notes(ana)).filter((n) => n.projectId === q.id && n.kind === 'status');
  assert.equal(anaNotes.length, 1);
  assert.match(anaNotes[0].text, /moved 3 tasks to Done:/);
  // One audit entry for the change.
  assert.equal(fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8').split('\n').filter((l) => l.includes('projects.bulk') && l.includes('3 tasks')).length, 1);
  // Assignee: members only (not a viewer, not someone off the project), even for a manager.
  await fails(pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [ts[0].id], set: { assigneeId: vic.id } }), 400, /members/);
  await fails(pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [ts[0].id], set: { assigneeId: nora.id } }), 400);
  await fails(pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [ts[0].id], set: { statusId: 'nope' } }), 400);
  await fails(pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [ts[0].id], set: {} }), 400, /Choose a change/);
  // Who: members change tasks; viewers and outsiders do not.
  await fails(vic('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [ts[0].id], set: { priority: 'low' } }), 403);
  await fails(nora('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [ts[0].id], set: { priority: 'low' } }), 404);
  // A task of another project: not found, and nothing changes.
  const other = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Elsewhere' });
  await fails(pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [ts[0].id, other.id], set: { priority: 'low' } }), 404);
  assert.equal((await pia('GET', `/api/pm/tasks/${ts[0].id}`)).priority, 'high');
  // At most 200 tasks.
  await fails(pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: Array.from({ length: 201 }, (_, i) => `x${i}`), set: { priority: 'low' } }), 400, /200/);
});

test('bulk edit: all or nothing; dates move in working days over holidays', async () => {
  const q = await project('Shift project');
  // Wed 25 Nov 2026 → +3 working days: Thu 26, Fri 27, (Mon 30 is a holiday) Tue 1 Dec.
  const a = await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'A', startDate: '2026-11-24', dueDate: '2026-11-25' });
  const b = await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'B', dueDate: '2026-11-27' });
  const c = await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'C' });
  await pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [a.id, b.id, c.id], shiftDays: 3 });
  assert.equal((await pia('GET', `/api/pm/tasks/${a.id}`)).startDate, '2026-11-27');
  assert.equal((await pia('GET', `/api/pm/tasks/${a.id}`)).dueDate, '2026-12-01');
  assert.equal((await pia('GET', `/api/pm/tasks/${b.id}`)).dueDate, '2026-12-03');
  assert.equal((await pia('GET', `/api/pm/tasks/${c.id}`)).dueDate, null, 'no date stays without one');
  await pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [a.id], shiftDays: -3 });
  assert.equal((await pia('GET', `/api/pm/tasks/${a.id}`)).dueDate, '2026-11-25');
  await fails(pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [a.id], shiftDays: 1.5 }), 400);
  // One task cannot take the change (here its parent is gone): nothing is saved, for any task.
  const sub = await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'Sub', parentId: b.id });
  const raw = db.data.pmTasks.find((x) => x.id === sub.id);
  raw.parentId = 'gone';
  await fails(pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [a.id, sub.id], set: { priority: 'urgent' } }), 400, /Nothing was changed: one task cannot take this change\. .*-\d+: Pick a parent task/);
  assert.equal((await pia('GET', `/api/pm/tasks/${a.id}`)).priority, 'normal', 'the valid task was not changed either');
  raw.parentId = b.id;
});

test('bulk: watchers (yourself, or anyone for a manager) and delete (managers, or tasks you added)', async () => {
  const q = await project('Bulk delete');
  const mineA = await juan('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'Juan 1' });
  const mineB = await juan('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'Juan 2' });
  const hers = await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'Pia 1' });
  const sub = await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'Sub of Juan 1', parentId: mineA.id });
  // Watchers: Juan adds himself; adding Ana is for managers; Pia adds Ana.
  await juan('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [hers.id], watchers: { add: [juan.id] } });
  assert.ok((await juan('GET', `/api/pm/tasks/${hers.id}`)).watching);
  await fails(juan('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [hers.id], watchers: { add: [ana.id] } }), 403);
  await pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [hers.id, mineA.id], watchers: { add: [ana.id], remove: [juan.id] } });
  assert.ok((await ana('GET', `/api/pm/tasks/${mineA.id}`)).watching);
  assert.equal((await juan('GET', `/api/pm/tasks/${hers.id}`)).watching, false);
  await fails(pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [hers.id], watchers: { add: [nora.id] } }), 400, /cannot open/);
  // Delete: one task Juan did not add refuses the whole batch.
  await fails(juan('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [mineA.id, hers.id], delete: true }), 403, /Nothing was deleted/);
  assert.equal((await pia('GET', `/api/pm/projects/${q.id}/tasks`)).length, 4);
  const r = await juan('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [mineA.id, mineB.id], delete: true });
  assert.equal(r.removed, 3, 'the subtask goes with its parent');
  await fails(pia('GET', `/api/pm/tasks/${sub.id}`), 404);
  await pia('POST', `/api/pm/projects/${q.id}/tasks/bulk`, { ids: [hers.id], delete: true });
  assert.equal((await pia('GET', `/api/pm/projects/${q.id}/tasks`)).length, 0);
});

// ===== Files =====
test('files on a task: PDF and images only (by content), 5 at most, downloaded as a file, by who may', async () => {
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Site survey', assigneeId: juan.id });
  const up = await juan('POST', `/api/pm/tasks/${t.id}/attachments`, { file: pdf('survey') });
  assert.equal(up.attachments.length, 1);
  const a = up.attachments[0];
  assert.equal(a.type, 'application/pdf');
  assert.equal(a.byName, 'Juan Cruz');
  // Text pretending to be a PDF, and an empty file, are refused.
  await fails(juan('POST', `/api/pm/tasks/${t.id}/attachments`, { file: { name: 'x.pdf', data: Buffer.from('<html>hi</html>').toString('base64') } }), 400, /PDF or a photo/);
  await fails(juan('POST', `/api/pm/tasks/${t.id}/attachments`, { file: { name: 'x.pdf', data: '' } }), 400);
  // Over 5 MB.
  await fails(juan('POST', `/api/pm/tasks/${t.id}/attachments`, { file: { name: 'big.pdf', data: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') } }), 400, /too large/);
  // Viewers download but do not upload; outsiders get not found.
  await fails(vic('POST', `/api/pm/tasks/${t.id}/attachments`, { file: pdf() }), 403);
  const res = await vic.raw('GET', `/api/pm/tasks/${t.id}/attachments/${a.id}`);
  assert.ok(Buffer.isBuffer(res.data));
  assert.match(res.data.toString(), /^%PDF-1\.4\n% survey/);
  assert.equal(res.headers['Content-Type'], 'application/octet-stream');
  assert.match(res.headers['Content-Disposition'], /^attachment; filename="Acceptance certificate\.pdf"; filename\*=UTF-8''Acceptance%20certificate\.pdf$/);
  assert.match(res.headers['Content-Security-Policy'], /sandbox/);
  await fails(nora.raw('GET', `/api/pm/tasks/${t.id}/attachments/${a.id}`), 404);
  await fails(marco.raw('GET', `/api/pm/tasks/${t.id}/attachments/nope`), 404);
  // The task's history says so, and the overview's activity shows it.
  const full = await pia('GET', `/api/pm/tasks/${t.id}`);
  assert.ok(full.history.some((h) => h.field === 'file added' && h.to === 'Acceptance certificate.pdf'));
  assert.ok((await pia('GET', `/api/pm/projects/${p.id}`)).activity.some((x) => x.field === 'file added'));
  // At most 5.
  for (let i = 0; i < 4; i++) await juan('POST', `/api/pm/tasks/${t.id}/attachments`, { file: pdf(String(i)) });
  await fails(juan('POST', `/api/pm/tasks/${t.id}/attachments`, { file: pdf() }), 400, /5 files/);
  // Removing: the uploader or a manager; another member cannot.
  await fails(ana('DELETE', `/api/pm/tasks/${t.id}/attachments/${a.id}`), 403);
  const file = path.join(dir, 'attachments', a.id);
  assert.ok(fs.existsSync(file));
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  await juan('DELETE', `/api/pm/tasks/${t.id}/attachments/${a.id}`);
  assert.ok(!fs.existsSync(file), 'the file is gone from the disk');
  const second = (await pia('GET', `/api/pm/tasks/${t.id}`)).attachments[0];
  await pia('DELETE', `/api/pm/tasks/${t.id}/attachments/${second.id}`);
  // Deleting the task removes its files.
  const left = (await pia('GET', `/api/pm/tasks/${t.id}`)).attachments.map((x) => path.join(dir, 'attachments', x.id));
  assert.ok(left.every((f) => fs.existsSync(f)));
  await pia('DELETE', `/api/pm/tasks/${t.id}`);
  assert.ok(left.every((f) => !fs.existsSync(f)));
});

test('files on a deliverable: the acceptance document; removed with the milestone and the project', async () => {
  const q = await project('Files project');
  const m = await pia('POST', `/api/pm/projects/${q.id}/milestones`, { name: 'Go-live', dueDate: day(10), deliverable: true, billingPercent: 50 });
  const r = await juan('POST', `/api/pm/projects/${q.id}/milestones/${m.id}/attachments`, { file: pdf('cert') });
  const a = r.attachments[0];
  const ov = await vic('GET', `/api/pm/projects/${q.id}`);
  assert.equal(ov.milestones.find((x) => x.id === m.id).attachments[0].name, 'Acceptance certificate.pdf');
  assert.ok(ov.history.some((h) => h.field === 'Go-live: file added'));
  const dl = await vic.raw('GET', `/api/pm/projects/${q.id}/milestones/${m.id}/attachments/${a.id}`);
  assert.match(dl.data.toString(), /% cert/);
  await fails(nora.raw('GET', `/api/pm/projects/${q.id}/milestones/${m.id}/attachments/${a.id}`), 404);
  await fails(vic('POST', `/api/pm/projects/${q.id}/milestones/${m.id}/attachments`, { file: pdf() }), 403);
  await fails(ana('DELETE', `/api/pm/projects/${q.id}/milestones/${m.id}/attachments/${a.id}`), 403);
  // Deleting the milestone removes its file; a task's file goes with the project.
  await pia('DELETE', `/api/pm/projects/${q.id}/milestones/${m.id}`);
  assert.ok(!fs.existsSync(path.join(dir, 'attachments', a.id)));
  const t = await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'With a file' });
  const tf = (await pia('POST', `/api/pm/tasks/${t.id}/attachments`, { file: pdf() })).attachments[0];
  const m2 = await pia('POST', `/api/pm/projects/${q.id}/milestones`, { name: 'Sign-off', dueDate: day(20) });
  const mf = (await pia('POST', `/api/pm/projects/${q.id}/milestones/${m2.id}/attachments`, { file: pdf() })).attachments[0];
  await pia('DELETE', `/api/pm/projects/${q.id}`);
  assert.ok(!fs.existsSync(path.join(dir, 'attachments', tf.id)) && !fs.existsSync(path.join(dir, 'attachments', mf.id)));
});

// ===== Milestones across projects, and the billing forecast =====
test('billing: amounts from the contract (or the deal), by month, earned and overdue', () => {
  assert.equal(billingAmount({ deliverable: true, billingPercent: 30 }, 1650000), 495000);
  assert.equal(billingAmount({ deliverable: true, billingPercent: 30 }, null), null);
  assert.equal(billingAmount({ deliverable: false, billingPercent: 30 }, 100), null);
  const f = billingForecast([
    { dueDate: '2026-10-20', acceptedAt: '2026-11-02', amount: 100 },
    { dueDate: '2026-11-05', acceptedAt: null, amount: 200 },
    { dueDate: '2026-11-25', acceptedAt: null, amount: 50 },
    { dueDate: '2026-12-15', acceptedAt: null, amount: null },
  ], '2026-11-11');
  assert.deepEqual(f.months.map((m) => [m.month, m.expected, m.earned, m.overdue, m.count, m.noValue]), [['2026-11', 250, 100, 200, 3, 0], ['2026-12', 0, 0, 0, 1, 1]]);
  assert.deepEqual(f.total, { expected: 250, earned: 100, overdue: 200, count: 4, noValue: 1 });
  // The CSV keeps a cell that looks like a formula as text.
  const csv = toCsv(forecastCsvRows({ months: [{ month: '=cmd|calc', expected: 1, overdue: 0, earned: 0, count: 1, noValue: 0 }], total: f.total }));
  assert.match(csv, /"'=cmd\|calc"/);
});

test('milestones across projects: members see their own; amounts only with Sales & CRM access, enforced by the API', async () => {
  const acct = await admin('POST', '/api/crm/accounts', { name: 'Northfield University', sector: 'education' });
  const contract = await admin('POST', '/api/crm/contracts', { title: 'LMS', accountId: acct.id, value: 1000000, startDate: day(-30), endDate: day(200), status: 'active' });
  const q = await admin('POST', '/api/pm/projects', { name: 'Billing project', type: 'Client', startDate: day(-30), endDate: day(120), managerId: pia.id, accountId: acct.id, contractId: contract.id });
  const qv = (await pia('GET', `/api/pm/projects/${q.id}`)).version;
  await pia('PUT', `/api/pm/projects/${q.id}/members`, { version: qv, members: [{ userId: pia.id, role: 'manager' }, { userId: juan.id, role: 'member' }] });
  const m1 = await pia('POST', `/api/pm/projects/${q.id}/milestones`, { name: 'Design sign-off', dueDate: day(-5), deliverable: true, billingPercent: 30 });
  await pia('POST', `/api/pm/projects/${q.id}/milestones`, { name: 'Go-live', dueDate: day(40), deliverable: true, billingPercent: 70 });
  await pia('POST', `/api/pm/projects/${q.id}/milestones`, { name: 'Internal review', dueDate: day(20) });
  // Marco (Sales Manager: pm.view and crm.view) sees amounts and the forecast.
  const mk = await marco('GET', '/api/pm/milestones');
  const rows = mk.rows.filter((r) => r.projectId === q.id);
  assert.equal(rows.length, 3);
  assert.equal(mk.amounts, true);
  const ds = rows.find((r) => r.id === m1.id);
  assert.equal(ds.amount, 300000);
  assert.equal(ds.overdue, true);
  assert.equal(ds.accountName, 'Northfield University');
  assert.match(ds.valueFrom, /^contract /);
  assert.ok(mk.forecast.total.expected >= 1000000);
  assert.ok(mk.forecast.total.overdue >= 300000);
  // Pia (Project Manager, no Sales & CRM): every project, no amounts at all.
  const pk = await pia('GET', '/api/pm/milestones');
  assert.equal(pk.amounts, false);
  assert.equal(pk.forecast, null);
  assert.ok(pk.rows.some((r) => r.projectId === q.id));
  assert.ok(pk.rows.every((r) => !('amount' in r) && !('valueFrom' in r)));
  // Juan (a member, no pm.view): only his projects; Nora: none of these.
  const jk = await juan('GET', '/api/pm/milestones');
  assert.ok(jk.rows.some((r) => r.projectId === q.id));
  assert.ok(jk.rows.every((r) => !('amount' in r)));
  assert.ok(!(await nora('GET', '/api/pm/milestones')).rows.some((r) => r.projectId === q.id));
  // Accepted: earned in the month it was accepted, no longer overdue.
  await pia('PUT', `/api/pm/projects/${q.id}/milestones/${m1.id}`, { acceptedAt: today });
  const after = (await marco('GET', '/api/pm/milestones'));
  assert.equal(after.rows.find((r) => r.id === m1.id).overdue, false);
  assert.ok(after.forecast.months.find((m) => m.month === today.slice(0, 7)).earned >= 300000);
});

// ===== CSV import =====
test('CSV parser: quotes, line breaks in fields, doubled quotes, a BOM, commas or semicolons', () => {
  const { rows } = parseCsv('﻿Title,Description\r\n"Install, test","Line 1\nLine 2"\r\n"Say ""hi""",=SUM(A1)\n\n');
  assert.deepEqual(rows, [['Title', 'Description'], ['Install, test', 'Line 1\nLine 2'], ['Say "hi"', '=SUM(A1)']]);
  assert.equal(csvSeparator('a;b;"c,d"\n1;2;3'), ';');
  assert.deepEqual(parseCsv('Title;Estimate (h)\nA;1,5').rows, [['Title', 'Estimate (h)'], ['A', '1,5']]);
  assert.match(parseCsv('a,b\n"open,2').error, /line 2 is never closed/);
  assert.equal(parseImportDate('2026-12-01'), '2026-12-01');
  assert.equal(parseImportDate('4/12/2026'), '2026-12-04');
  assert.equal(parseImportDate('31/02/2026'), undefined);
  assert.equal(parseImportDate(''), null);
  assert.deepEqual(guessImportMapping(IMPORT_TEMPLATE[0]), { title: 0, description: 1, status: 2, assignee: 3, start: 4, due: 5, size: 6, priority: 7, milestone: 8, parent: 9, checklist: 10 });
});

test('importPlan: every row checked; parents by row number or title, one level; milestones to create', () => {
  const project = { statuses: DEFAULT_STATUSES, endDate: null };
  const members = [{ userId: 'u1', username: 'juan', name: 'Juan Cruz', role: 'member', active: true }, { userId: 'u2', username: 'vic', name: 'Vic Viewer', role: 'viewer', active: true }];
  const map = guessImportMapping(IMPORT_TEMPLATE[0]);
  const row = (o) => IMPORT_TEMPLATE[0].map((h) => o[h] ?? '');
  const plan = importPlan([
    row({ Title: 'Parent', Assignee: 'Juan Cruz', Due: '2026-12-10', Milestone: 'New phase', Checklist: 'a; b ;' }),
    row({ Title: 'Child', Parent: '2', Status: 'in progress', Priority: 'High', Size: 'Medium' }),
    row({ Title: 'Grandchild', Parent: 'Child' }),
    row({ Title: '', Assignee: 'vic', Start: '2026-12-05', Due: '2026-12-01', Priority: 'Top', Status: 'Nope' }),
  ], map, { project, members, milestones: [], createMilestones: true });
  assert.deepEqual(plan.rows[0].errors, []);
  assert.equal(plan.tasks[0].assigneeId, 'u1');
  assert.deepEqual(plan.tasks[0].checklist, ['a', 'b']);
  assert.equal(plan.tasks[1].parentRow, 2);
  assert.equal(plan.tasks[1].statusId, 'doing');
  assert.equal(plan.tasks[1].size, 'M');
  assert.match(plan.rows[2].errors.join(), /Row 3 is itself a subtask/);
  assert.equal(plan.rows[3].errors.length, 5, plan.rows[3].errors.join(' | '));
  assert.deepEqual(plan.newMilestones, [{ name: 'New phase', dueDate: '2026-12-10', tasks: 1 }]);
  assert.equal(plan.errorCount, 2);
  // Without "create": an unknown milestone is an error.
  assert.match(importPlan([row({ Title: 'X', Milestone: 'Nope' })], map, { project, members }).rows[0].errors[0], /No milestone "Nope"/);
});

test('import: managers only; preview, check (nothing saved), then all or nothing, with history and one audit entry', async () => {
  const q = await project('Import project');
  const ms = await pia('POST', `/api/pm/projects/${q.id}/milestones`, { name: 'Design', dueDate: day(30) });
  const csv = [
    'Task;Notes;Owner;Due;Estimate (h);Milestone;Parent;Checklist',
    'Workshop;"With the deans; bring ""the"" slides";juan;04/12/2026;8;Design;;"Room;Agenda"',
    'Minutes;;Ana Reyes;2026-12-05;2;design;2;',
    '=HYPERLINK("x");formula kept as text;;;;New phase;;',
  ].join('\n');
  await fails(juan('POST', `/api/pm/projects/${q.id}/import/preview`, { csv }), 403);
  await fails(nora('POST', `/api/pm/projects/${q.id}/import/preview`, { csv }), 404);
  const pv = await pia('POST', `/api/pm/projects/${q.id}/import/preview`, { csv });
  assert.deepEqual(pv.headers, ['Task', 'Notes', 'Owner', 'Due', 'Estimate (h)', 'Milestone', 'Parent', 'Checklist']);
  assert.equal(pv.count, 3);
  assert.deepEqual(pv.mapping, { title: 0, description: 1, assignee: 2, due: 3, estimate: 4, milestone: 5, parent: 6, checklist: 7 });
  // Without creating milestones, row 4 fails; the check saves nothing; the import refuses.
  const check = await pia('POST', `/api/pm/projects/${q.id}/import`, { csv, mapping: pv.mapping, dryRun: true });
  assert.equal(check.errorCount, 1);
  assert.match(check.rows[2].errors[0], /No milestone "New phase"/);
  // An "Estimate (h)" column still works: each estimate becomes a size, noted on its row.
  assert.equal(check.fromHours, 2);
  assert.match(check.rows[0].warnings.join(), /Size S · Small, from the estimate of 8 h/);
  assert.equal((await pia('GET', `/api/pm/projects/${q.id}/tasks`)).length, 0);
  await fails(pia('POST', `/api/pm/projects/${q.id}/import`, { csv, mapping: pv.mapping }), 400, /Nothing was imported/);
  assert.equal((await pia('GET', `/api/pm/projects/${q.id}/tasks`)).length, 0);
  // With creating milestones (the new one takes the project's end date: its task has no due date).
  const ok = await pia('POST', `/api/pm/projects/${q.id}/import`, { csv, mapping: pv.mapping, createMilestones: true, fileName: 'plan.csv' });
  assert.deepEqual(ok, { imported: 3, milestones: 1 });
  const tasks = (await pia('GET', `/api/pm/projects/${q.id}/tasks`)).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  assert.deepEqual(tasks.map((t) => t.key), [`${q.code}-1`, `${q.code}-2`, `${q.code}-3`]);
  const [w, mi, f] = tasks;
  assert.equal(w.description, 'With the deans; bring "the" slides');
  assert.deepEqual([w.size, mi.size, f.size], ['S', 'XS', null]);
  assert.equal(w.assigneeId, juan.id);
  assert.equal(w.dueDate, '2026-12-04');
  assert.equal(w.milestoneId, ms.id);
  assert.deepEqual(w.checklist.map((c) => c.text), ['Room', 'Agenda']);
  assert.equal(mi.parentId, w.id);
  assert.equal(mi.milestoneId, ms.id, 'milestones match without case');
  assert.equal(f.title, '=HYPERLINK("x")', 'kept as text');
  const newMs = (await pia('GET', `/api/pm/projects/${q.id}/milestones`)).find((m) => m.name === 'New phase');
  assert.equal(newMs.dueDate, day(60));
  assert.equal(f.milestoneId, newMs.id);
  assert.equal((await pia('GET', `/api/pm/tasks/${w.id}`)).history[0].to, 'imported from a CSV file');
  assert.equal(fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8').split('\n').filter((l) => l.includes('projects.import')).length, 1);
  // Juan hears once of his assignment; keys are never reused.
  assert.ok((await notes(juan)).some((n) => n.projectId === q.id && n.kind === 'assigned'));
  await pia('DELETE', `/api/pm/tasks/${f.id}`);
  const next = await pia('POST', `/api/pm/projects/${q.id}/tasks`, { title: 'After' });
  assert.equal(next.key, `${q.code}-4`);
  // An assignee who is not on the project (or a viewer) is an error; the limits hold.
  const bad = await pia('POST', `/api/pm/projects/${q.id}/import`, { csv: 'Title,Assignee\nA,nora\nB,vic', mapping: { title: 0, assignee: 1 }, dryRun: true });
  assert.equal(bad.errorCount, 2);
  await fails(pia('POST', `/api/pm/projects/${q.id}/import`, { csv: 'Title\nA', mapping: { assignee: 0 }, dryRun: true }), 400, /titles/);
  await fails(pia('POST', `/api/pm/projects/${q.id}/import`, { csv: 'Title\nA', mapping: { title: 3 }, dryRun: true }), 400);
  await fails(pia('POST', `/api/pm/projects/${q.id}/import/preview`, { csv: `Title\n${'A\n'.repeat(2001)}` }), 400, /2,000/);
  await fails(pia('POST', `/api/pm/projects/${q.id}/import/preview`, { csv: `Title\n${'x'.repeat(2 * 1024 * 1024)}` }), 400, /2 MB/);
  await fails(pia('POST', `/api/pm/projects/${q.id}/import/preview`, { csv: 'Title' }), 400, /no task rows/);
});

test('demo data: watchers on the demo tasks, billing through the linked contracts, no email, files cleared with it', async () => {
  const { client: c2, db: d2, dir: dir2 } = server();
  const a = c2();
  await a('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
  await a('POST', '/api/admin/demo');
  const sent = outbox.length;
  const tasks = d2.data.pmTasks.filter((t) => t.demo);
  assert.ok(tasks.length && tasks.every((t) => Array.isArray(t.watchers) && t.watchers.every((id) => d2.data.users.some((u) => u.id === id))));
  const sales = d2.data.users.find((u) => u.username === 'sales.demo');
  assert.ok(tasks.some((t) => t.watchers.includes(sales.id)));
  const ms = await a('GET', '/api/pm/milestones');
  assert.ok(ms.rows.some((r) => r.amount > 0 && /^contract /.test(r.valueFrom)));
  assert.ok(ms.rows.some((r) => r.amount > 0 && /^deal /.test(r.valueFrom)), 'a project with a deal but no contract');
  assert.equal(d2.data.pm.digest.enabled, false, 'demo data turns nothing on');
  // A file added to a demo task goes when the demo data is removed.
  const t = tasks[0];
  const f = (await a('POST', `/api/pm/tasks/${t.id}/attachments`, { file: pdf() })).attachments[0];
  await a('DELETE', '/api/admin/demo');
  assert.ok(!fs.existsSync(path.join(dir2, 'attachments', f.id)));
  assert.equal(outbox.length, sent);
});
