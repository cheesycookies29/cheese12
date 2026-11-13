// Notifications for every account (the bell, 0.23): what each module tells whom, never the person
// who acted; only your own; Project Management's "For you" merged in and read in both places; the
// per-person cap, age pruning, modules turned off, text lengths and links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { notify, validLink, migrateNotifications, NOTIFY_KEEP, TITLE_MAX, BODY_MAX } from '../server/notifications.js';
import { localDate } from '../server/util.js';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-notifications-')), 'db.json');
const db = openDb(file);
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
await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'secret123' });
const person = (no, firstName, extra = {}) => admin('POST', '/api/employees', { employeeNo: no, firstName, lastName: 'Reyes', hireDate: '2024-01-01', payType: 'monthly', rate: 30000, gender: 'Female', email: `${firstName.toLowerCase()}@company.com`, ...extra });
async function account(username, role, name, employeeId = null) {
  const u = await admin('POST', '/api/users', { name, username, role, employeeId, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  c.id = u.id;
  return c;
}
// Lea (director) ← Ben (team lead) ← Ana (staff). Hana is HR, Paolo payroll, Ivan IT, Sara and
// Marco sales, Pia a project manager.
const lea = await person('E-1', 'Lea');
const ben = await person('E-2', 'Ben', { supervisorId: lea.id });
const ana = await person('E-3', 'Ana', { supervisorId: ben.id });
const asLea = await account('lea', 'employee', 'Lea Reyes', lea.id);
const asBen = await account('ben', 'employee', 'Ben Reyes', ben.id);
const asAna = await account('ana', 'employee', 'Ana Reyes', ana.id);
const hr = await account('hana', 'hr', 'Hana HR');
const pay = await account('paolo', 'payroll', 'Paolo Pay');
const ivan = await account('ivan', 'it', 'Ivan IT');
const sid = await account('sid', 'support', 'Sid Support');
const sara = await account('sara', 'sales', 'Sara Sales');
const marco = await account('marco', 'salesmgr', 'Marco Manager');
const pia = await account('pia', 'pm', 'Pia Manager');
const day = (n) => `2026-12-${String(n).padStart(2, '0')}`; // December 2026: the 1st is a Tuesday

const list = (c, q = '') => c('GET', `/api/notifications${q}`);
const titles = async (c, q = '') => (await list(c, q)).items.map((n) => n.title);
const count = async (c) => (await c('GET', '/api/notifications/count')).unread;
const newest = async (c) => (await list(c)).items[0];
const readAll = (c) => c('PUT', '/api/notifications/read', { all: true });
const clear = async () => {
  for (const c of [admin, asLea, asBen, asAna, hr, pay, ivan, sid, sara, marco, pia]) await readAll(c);
};

test('HR: the approver of the current step hears of a new request; the employee of the decision', async () => {
  await clear();
  const r = await asAna('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: day(9), endDate: day(10), reason: 'Family matters: private' });
  // Ben (immediate supervisor) is up first; Lea and HR are not yet; Ana is not told of her own.
  const n = await newest(asBen);
  assert.equal(n.title, 'Ana Reyes asked for 2 days of Vacation Leave');
  assert.match(n.body, /Dec 9, 2026 to Dec 10, 2026 · Waiting for your approval/);
  assert.equal(n.link, `#/approvals?open=${r.id}`);
  assert.equal(n.module, 'hr');
  assert.ok(n.id.startsWith('n:'));
  assert.ok(!JSON.stringify(n).includes('private'), 'the approver is not told the reason');
  assert.equal(await count(asAna), 0);
  assert.equal(await count(hr), 0);
  // Ben approves: HR (the next level) is told, Ana not yet (and Ben not of his own action).
  await asBen('POST', `/api/approvals/${r.id}/approve`, { note: 'Fine' });
  assert.equal(await count(asBen), 1, 'only the request, not his own approval');
  assert.equal((await newest(hr)).title, 'Ben Reyes approved Ana Reyes\'s request for 2 days of Vacation Leave');
  assert.match((await newest(hr)).body, /Now waiting for your approval/);
  assert.equal(await count(asAna), 0);
  // HR approves: Ana hears of it, with a link to her request.
  await hr('POST', `/api/approvals/${r.id}/approve`);
  const done = await newest(asAna);
  assert.equal(done.title, 'Hana HR approved your request for 2 days of Vacation Leave');
  assert.equal(done.link, `#/me/requests?open=${r.id}`);
  assert.equal(done.actorName, 'Hana HR');
  assert.equal(await count(hr), 1);
});

test('HR: rejected and returned requests tell the employee; a revision goes back to the approver', async () => {
  await clear();
  const r = await asAna('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: day(14), endDate: day(14), reason: 'x' });
  await asBen('POST', `/api/approvals/${r.id}/return`, { note: 'Please file the 15th instead' });
  const back = await newest(asAna);
  assert.equal(back.title, 'Ben Reyes returned your request for 1 day of Vacation Leave for revision');
  assert.match(back.body, /Please file the 15th instead/);
  await asAna('PUT', `/api/me/requests/${r.id}`, { kind: 'leave', leaveTypeId: 'vl', startDate: day(15), endDate: day(15), reason: 'x' });
  assert.equal((await newest(asBen)).title, 'Ana Reyes revised and resubmitted a request for 1 day of Vacation Leave');
  await asBen('POST', `/api/approvals/${r.id}/reject`, { note: 'Year-end close' });
  const no = await newest(asAna);
  assert.equal(no.title, 'Ben Reyes rejected your request for 1 day of Vacation Leave');
  assert.match(no.body, /Reason: Year-end close/);
  // Work from home is worded as such.
  await asAna('POST', '/api/me/requests', { kind: 'remote', startDate: day(16), endDate: day(16), reason: 'x' });
  assert.equal((await newest(asBen)).title, 'Ana Reyes asked for 1 day of work from home');
});

test('HR: a request withdrawn while it waits for someone tells them; HR cancelling tells the employee', async () => {
  await clear();
  const r = await asAna('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: day(21), endDate: day(21), reason: 'x' });
  await readAll(asBen);
  await asAna('POST', `/api/me/requests/${r.id}/cancel`, { reason: 'Plans changed' });
  const n = await newest(asBen);
  assert.equal(n.title, 'Ana Reyes withdrew a request for 1 day of Vacation Leave');
  assert.match(n.body, /no longer needs your approval/);
  assert.equal(await count(asAna), 0, 'not told of her own withdrawal');
  // Approved, then cancelled by HR: Ana is told, with the reason.
  const r2 = await asAna('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: day(22), endDate: day(22), reason: 'x' });
  await hr('POST', `/api/approvals/${r2.id}/approve`);
  await readAll(asAna);
  await readAll(asBen);
  // Pending at Ben's step, HR cancels it: Ben (who was waited on) and Ana are told; HR is not.
  const r3 = await asAna('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: day(23), endDate: day(23), reason: 'x' });
  await readAll(asBen);
  await hr('POST', `/api/requests/${r3.id}/cancel`, { note: 'Filed twice' });
  assert.equal((await newest(asBen)).title, 'Hana HR cancelled Ana Reyes\'s request for 1 day of Vacation Leave');
  assert.equal((await newest(asAna)).title, 'Hana HR cancelled your request for 1 day of Vacation Leave');
  assert.match((await newest(asAna)).body, /Reason: Filed twice/);
  assert.equal(await count(hr), 0);
});

test('Payroll: finalizing a run tells each employee in it who has an account, not the officer', async () => {
  await clear();
  const run = await pay('POST', '/api/payroll-runs', { periodStart: '2026-11-01', periodEnd: '2026-11-15', payDate: '2026-11-20' });
  await pay('POST', `/api/payroll-runs/${run.id}/finalize`);
  for (const c of [asAna, asBen, asLea]) {
    const n = await newest(c);
    assert.equal(n.title, 'Your payslip for Nov 1, 2026 to Nov 15, 2026 is ready');
    assert.equal(n.link, `#/me/payslips/${run.id}`);
    assert.doesNotMatch(n.body, /₱|\d{2},\d{3}/, 'no amounts in the text');
  }
  assert.equal(await count(pay), 0);
  assert.equal(await count(hr), 0, 'HR has no employee record in the run');
});

test('Service Desk: assignment, the requester\'s replies to the assignee, agents\' replies and resolving to the requester', async () => {
  await clear();
  const t = await asAna('POST', '/api/helpdesk/mine', { subject: 'Laptop will not charge', body: 'The charger light is off since this morning.', category: 'Hardware' });
  assert.equal(await count(ivan) + await count(sid), 0, 'a new ticket is the queue\'s, not a notification');
  // Ivan assigns it to Sid: Sid is told; Ivan assigning one to himself tells nobody.
  await ivan('PUT', `/api/helpdesk/tickets/${t.id}`, { assigneeId: sid.id });
  const a = await newest(sid);
  assert.equal(a.title, `Ivan IT assigned ticket ${t.ref} to you`);
  assert.equal(a.link, `#/helpdesk/tickets/${t.id}`);
  assert.equal(a.module, 'helpdesk');
  // An internal note tells the requester nothing; a public reply does.
  await sid('POST', `/api/helpdesk/tickets/${t.id}/messages`, { kind: 'note', body: 'Probably the adapter. Secret stock note.' });
  assert.equal(await count(asAna), 0);
  await sid('POST', `/api/helpdesk/tickets/${t.id}/messages`, { kind: 'reply', body: 'Please bring it to the IT room at 2 pm.', email: false });
  const r = await newest(asAna);
  assert.equal(r.title, `Sid Support replied to your ticket ${t.ref}`);
  assert.match(r.body, /Please bring it to the IT room/);
  assert.equal(r.link, `#/helpdesk/mine/${t.id}`);
  // Ana replies: only Sid (the assignee) hears of it.
  await asAna('POST', `/api/helpdesk/mine/${t.id}/messages`, { body: 'I will be there.' });
  assert.equal((await newest(sid)).title, `Ana Reyes replied on ticket ${t.ref}`);
  assert.equal(await count(ivan), 0);
  assert.equal(await count(asAna), 1, 'not told of her own reply');
  // Resolved: Ana is told.
  await sid('PUT', `/api/helpdesk/tickets/${t.id}`, { status: 'resolved' });
  assert.equal((await newest(asAna)).title, `Sid Support resolved your ticket ${t.ref}`);
  await sid('PUT', `/api/helpdesk/tickets/${t.id}`, { assigneeId: sid.id, status: 'closed' });
  assert.equal((await newest(asAna)).title, `Sid Support closed your ticket ${t.ref}`);
  assert.equal((await list(sid)).items.filter((n) => /assigned/.test(n.title)).length, 1);
});

test('IT Assets: equipment assigned and supplies issued to an employee tell their account', async () => {
  await clear();
  const a = await ivan('POST', '/api/assets', { name: 'Laptop A', category: 'Laptop', serialNumber: 'SN-N1' });
  await ivan('POST', `/api/assets/${a.id}/assign`, { type: 'employee', employeeId: ana.id, expectedReturn: '2027-06-30' });
  const n = await newest(asAna);
  assert.equal(n.title, `Ivan IT assigned ${a.assetTag} Laptop A to you`);
  assert.match(n.body, /Laptop · Return by Jun 30, 2027/);
  assert.equal(n.link, '#/assets/mine');
  assert.equal(n.module, 'assets');
  // To a department: nobody in particular.
  const b = await ivan('POST', '/api/assets', { name: 'Projector', category: 'Other', serialNumber: 'SN-N2' });
  await ivan('POST', `/api/assets/${b.id}/assign`, { type: 'department', name: 'Sales' });
  const item = await ivan('POST', '/api/inventory', { name: 'Mouse', openingQuantity: 10, reorderLevel: 3 });
  await ivan('POST', `/api/inventory/${item.item?.id || item.id}/movements`, { type: 'out', quantity: 2, issuedTo: { type: 'employee', employeeId: ana.id } });
  assert.match((await newest(asAna)).title, /^Ivan IT issued you 2 .* of Mouse$/);
  assert.equal(await count(ivan), 0);
});

test('Sales & CRM: a record given a new owner by someone else tells the new owner, never yourself', async () => {
  await clear();
  const acct = await sara('POST', '/api/crm/accounts', { name: 'Province of Laguna', type: 'prospect', sector: 'government' });
  assert.equal(await count(sara), 0, 'her own record');
  const lead = await sara('POST', '/api/crm/leads', { name: 'Rosa Dizon', company: 'Province of Laguna', ownerId: marco.id });
  const n = await newest(marco);
  assert.equal(n.title, `Sara Sales made you the owner of lead ${lead.code} Rosa Dizon`);
  assert.equal(n.link, `#/crm/leads/${lead.id}`);
  assert.equal(n.module, 'crm');
  const deal = await marco('POST', '/api/crm/deals', { title: 'HRIS for Laguna', accountId: acct.id, value: 1000000 });
  await marco('PUT', `/api/crm/deals/${deal.id}`, { ownerId: sara.id });
  assert.equal((await newest(sara)).title, `Marco Manager made you the owner of deal ${deal.code} HRIS for Laguna`);
  assert.equal((await newest(sara)).body, 'Province of Laguna');
  // Saving without changing the owner, or taking it yourself, tells nobody.
  await readAll(sara);
  await readAll(marco);
  await marco('PUT', `/api/crm/deals/${deal.id}`, { nextStep: 'Call Rosa' });
  await sara('PUT', `/api/crm/deals/${deal.id}`, { ownerId: sara.id });
  assert.equal(await count(sara), 0);
  await sara('PUT', `/api/crm/accounts/${acct.id}`, { ownerId: marco.id });
  assert.equal((await newest(marco)).title, 'Sara Sales made you the owner of account Province of Laguna');
  const c = await sara('POST', '/api/crm/contacts', { firstName: 'Rosa', lastName: 'Dizon', accountId: acct.id, ownerId: marco.id });
  assert.equal((await newest(marco)).link, `#/crm/contacts/${c.id}`);
});

test('System: an administrator\'s answer to feedback tells the sender, without naming the administrator', async () => {
  await clear();
  const f = await asAna('POST', '/api/feedback', { type: 'bug', area: 'general', subject: 'Clock button', message: 'The clock button is hard to find.' });
  await admin('POST', `/api/feedback/${f.id}/update`, { status: 'planned', note: 'Thanks, we will move it.' });
  const n = await newest(asAna);
  assert.equal(n.title, `An administrator replied to your feedback ${f.number}`);
  assert.match(n.body, /Clock button: “Thanks, we will move it.”/);
  assert.equal(n.link, `#/feedback?open=${f.id}`);
  assert.equal(n.actorId, null);
  assert.equal(n.actorName, null);
  assert.equal(n.module, 'system');
  await admin('POST', `/api/feedback/${f.id}/update`, { status: 'resolved' });
  assert.equal((await newest(asAna)).title, `An administrator marked your feedback ${f.number} as Resolved`);
  // Their own feedback, answered by themselves: no notification.
  const own = await admin('POST', '/api/feedback', { type: 'idea', area: 'general', subject: 'Mine', message: 'A note to myself here.' });
  await admin('POST', `/api/feedback/${own.id}/update`, { note: 'Done.' });
  assert.equal(await count(admin), 0);
});

test('only your own: others\' items are invisible and cannot be marked read', async () => {
  await clear();
  await asAna('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: day(28), endDate: day(28), reason: 'x' });
  const bens = await list(asBen, '?unread=1');
  assert.equal(bens.unread, 1);
  const id = bens.items[0].id;
  // Ana sees nothing of Ben's and cannot mark it read; Ben's stays unread.
  assert.ok(!(await list(asAna)).items.some((n) => n.id === id));
  const r = await asAna('PUT', '/api/notifications/read', { ids: [id, 'n:not-a-real-id', 'pm:nope'] });
  assert.equal(r.marked, 0);
  assert.equal(await count(asBen), 1);
  await assert.rejects(asAna('PUT', '/api/notifications/read', { ids: 'all' }), /mark as read/);
  await assert.rejects(asAna('PUT', '/api/notifications/read', { ids: [42] }), /mark as read/);
  await assert.rejects(asAna('PUT', '/api/notifications/read', {}), /mark as read/);
  await assert.rejects(client()('GET', '/api/notifications'), /sign in/i);
  // Ben marks it read.
  assert.equal((await asBen('PUT', '/api/notifications/read', { ids: [id] })).marked, 1);
  assert.equal(await count(asBen), 0);
  assert.equal((await list(asBen, '?unread=1')).items.length, 0);
  assert.ok((await list(asBen)).items.find((n) => n.id === id).readAt);
  // Reading is not recorded in the audit log as a change.
  const log = (await admin('GET', '/api/audit')).entries;
  assert.ok(!log.some((e) => /notifications/.test(e.label || '')));
});

test('Project Management items are merged in; reading one in the bell reads it on My work, and back', async () => {
  await clear();
  const p = await pia('POST', '/api/pm/projects', { name: 'Clinic rollout', type: 'Client', startDate: localDate() });
  const full = await pia('GET', `/api/pm/projects/${p.id}`);
  await pia('PUT', `/api/pm/projects/${p.id}/members`, { version: full.version, members: [{ userId: pia.id, role: 'manager' }, { userId: asAna.id, role: 'member' }] });
  const t = await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Install servers', assigneeId: asAna.id });
  const bell = await list(asAna);
  const pm = bell.items.filter((n) => n.id.startsWith('pm:'));
  assert.equal(pm.length, 2, 'added to the project, and assigned the task');
  const assigned = pm.find((n) => n.kind === 'assigned');
  assert.equal(assigned.title, `Pia Manager assigned you ${t.key} Install servers`);
  assert.equal(assigned.module, 'projects');
  assert.equal(assigned.link, `#/projects/${p.id}/tasks/${t.id}`);
  assert.equal(assigned.actorId, pia.id);
  assert.equal(pm.find((n) => n.kind === 'added').link, `#/projects/${p.id}`);
  // Newest first across both stores.
  const ats = bell.items.map((n) => n.at);
  assert.deepEqual(ats, [...ats].sort().reverse());
  // A comment: the quote goes under the title.
  await pia('POST', `/api/pm/tasks/${t.id}/comments`, { body: 'Can you start on Monday?' });
  const said = (await list(asAna)).items.find((n) => n.kind === 'commented');
  assert.equal(said.title, `Pia Manager commented on ${t.key}`);
  assert.match(said.body, /^“Can you start on Monday\?” · /);
  // Read in the bell → read on My work.
  await asAna('PUT', '/api/notifications/read', { ids: [assigned.id] });
  const forYou = await asAna('GET', '/api/pm/notifications');
  assert.ok(forYou.items.find((n) => n.id === assigned.id.slice(3)).readAt);
  // Read on My work → read in the bell.
  await asAna('PUT', '/api/pm/notifications/read', { ids: [said.id.slice(3)] });
  assert.ok((await list(asAna)).items.find((n) => n.id === said.id).readAt);
  assert.equal(await count(asAna), (await asAna('GET', '/api/pm/notifications/summary')).unread + (await list(asAna, '?unread=1')).items.filter((n) => n.id.startsWith('n:')).length);
  // Read all marks both stores.
  await asAna('POST', '/api/me/requests', { kind: 'leave', leaveTypeId: 'vl', startDate: day(29), endDate: day(29), reason: 'x' }); // (Ben's, not Ana's)
  await pia('POST', `/api/pm/projects/${p.id}/tasks`, { title: 'Train staff', assigneeId: asAna.id });
  assert.ok(await count(asAna) > 0);
  const r = await readAll(asAna);
  assert.ok(r.marked >= 1);
  assert.equal(r.unread, 0);
  assert.equal((await asAna('GET', '/api/pm/notifications/summary')).unread, 0);
  // The module filter and paging.
  assert.ok((await list(asAna, '?module=projects')).items.every((n) => n.module === 'projects'));
  const page = await list(asAna, '?limit=1');
  assert.equal(page.items.length, 1);
  assert.equal(page.more, true);
  const next = await list(asAna, '?limit=1&offset=1');
  assert.notEqual(next.items[0].id, page.items[0].id);
});

test('a module turned off hides its items, except from administrators', async () => {
  await clear();
  const t = await asAna('POST', '/api/helpdesk/mine', { subject: 'Printer jam', body: 'The second floor printer jams on every page.', category: 'Hardware' });
  // Helpdesk off: the agent's reply notice is hidden from Ana, but kept.
  await ivan('POST', `/api/helpdesk/tickets/${t.id}/messages`, { kind: 'reply', body: 'On my way.', email: false });
  assert.equal(await count(asAna), 1);
  await admin('PUT', '/api/admin/modules', { modules: { helpdesk: false } });
  assert.equal(await count(asAna), 0);
  assert.equal((await list(asAna)).items.filter((n) => n.module === 'helpdesk' && !n.readAt).length, 0);
  // An administrator still sees a turned-off module's items.
  notify(db, [db.data.users.find((u) => u.username === 'admin').id], { module: 'helpdesk', kind: 'ticket.assigned', title: 'Test', body: '', link: '#/helpdesk/tickets' });
  assert.equal(await count(admin), 1);
  await admin('PUT', '/api/admin/modules', { modules: { helpdesk: true } });
  assert.equal(await count(asAna), 1);
  await readAll(admin);
});

test('notify(): skips the actor, missing, disabled and repeated accounts; checks the module and link; trims text', () => {
  const anaId = asAna.id;
  const before = db.data.notifications.length;
  const rows = notify(db, [anaId, anaId, asBen.id, 'nobody', null], { module: 'system', kind: 'x', title: 'T', body: 'B', link: '#/feedback' }, { actorId: asBen.id });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, anaId);
  assert.equal(db.data.notifications.length, before + 1);
  const off = db.data.users.find((u) => u.username === 'lea');
  off.active = false;
  assert.equal(notify(db, [off.id], { module: 'system', title: 'T', link: '#/feedback' }).length, 0);
  off.active = true;
  // Lengths: one line, title 160, body 300, with an ellipsis.
  const [long] = notify(db, [anaId], { module: 'hr', title: `A ${'very '.repeat(80)}long\ntitle`, body: 'b'.repeat(1000), link: '#/me/requests' });
  assert.equal(long.title.length, TITLE_MAX);
  assert.ok(long.title.endsWith('…'));
  assert.equal(long.body.length, BODY_MAX);
  assert.doesNotMatch(long.title, /\n/);
  // Links: only CORE's own "#/" routes.
  for (const bad of ['https://evil.example/', 'javascript:alert(1)', '/#/x', '#x', '#/a b', '#/"><img', '', null, `#/${'a'.repeat(400)}`]) {
    assert.equal(validLink(bad), false, String(bad));
    assert.throws(() => notify(db, [anaId], { module: 'hr', title: 'T', link: bad }), /route/);
  }
  assert.ok(validLink('#/approvals?open=0b1c-2d'));
  assert.throws(() => notify(db, [anaId], { module: 'finance', title: 'T', link: '#/x' }), /module/);
  assert.throws(() => notify(db, [anaId], { module: 'hr', title: '  ', link: '#/x' }), /title/);
});

test('each person keeps their newest 200, nothing older than 60 days; old databases get the collection', async () => {
  const anaId = asAna.id;
  const benBefore = db.data.notifications.filter((n) => n.userId === asBen.id).length;
  const old = new Date(Date.now() - 61 * 86400000).toISOString();
  db.data.notifications.push({ id: 'ancient', userId: anaId, module: 'hr', kind: 'x', title: 'Old', body: '', link: '#/me', actorId: null, at: old, readAt: null });
  for (let i = 0; i < NOTIFY_KEEP + 5; i++) notify(db, [anaId], { module: 'system', kind: 'x', title: `N${i}`, link: '#/feedback' }, { at: new Date(Date.now() - (NOTIFY_KEEP + 5 - i) * 1000).toISOString() });
  const mine = db.data.notifications.filter((n) => n.userId === anaId);
  assert.equal(mine.length, NOTIFY_KEEP);
  assert.ok(!mine.some((n) => n.id === 'ancient'), 'older than 60 days: gone');
  assert.ok(mine.some((n) => n.title === `N${NOTIFY_KEEP + 4}`) && !mine.some((n) => n.title === 'N0'), 'the oldest went');
  assert.equal(db.data.notifications.filter((n) => n.userId === asBen.id).length, benBefore, 'others keep theirs');
  // The API pages through them.
  const first = await list(asAna, '?limit=100');
  assert.equal(first.items.length, 100);
  assert.equal(first.more, true);
  // An older database: the collection is added.
  const legacy = { data: { users: [] } };
  assert.equal(migrateNotifications(legacy), true);
  assert.deepEqual(legacy.data.notifications, []);
  assert.equal(migrateNotifications(legacy), false);
  db.data.notifications = db.data.notifications.filter((n) => n.userId !== anaId);
});

test('a deleted account takes its notifications, and is no longer named in others\'', async () => {
  const temp = await account('temp', 'salesmgr', 'Temp Owner');
  const lead = await temp('POST', '/api/crm/leads', { name: 'Lito', ownerId: marco.id });
  assert.ok((await list(marco)).items.some((n) => n.link === `#/crm/leads/${lead.id}` && n.actorId === temp.id));
  await sara('POST', '/api/crm/leads', { name: 'Mina', ownerId: temp.id });
  await admin('DELETE', `/api/users/${temp.id}`);
  assert.ok(!db.data.notifications.some((n) => n.userId === temp.id || n.actorId === temp.id));
  assert.ok((await list(marco)).items.some((n) => n.link === `#/crm/leads/${lead.id}` && n.actorId === null));
});

test('the bell: badge text, its label, links it follows, relative times and day groups', async () => {
  const { badgeText, bellLabel, safeLink, relTime, dayGroup, groupByDay } = await import('../public/js/notify-format.js');
  assert.equal(badgeText(0), '0');
  assert.equal(badgeText(7), '7');
  assert.equal(badgeText(99), '99');
  assert.equal(badgeText(100), '99+');
  assert.equal(bellLabel(3), 'Notifications, 3 unread');
  assert.equal(safeLink('#/approvals?open=abc'), '#/approvals?open=abc');
  for (const bad of ['javascript:alert(1)', 'https://example.org', '#/a"onmouseover', '//evil', null, 42]) assert.equal(safeLink(bad), null);
  const now = new Date(2026, 10, 13, 15, 0).getTime(); // Nov 13, 2026, 3 pm where the browser is
  const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();
  assert.equal(relTime(new Date(now - 20000).toISOString(), now), 'Just now');
  assert.equal(relTime(at(13, 14, 55), now), '5 min ago');
  assert.equal(relTime(at(13, 9), now), '6 h ago');
  assert.equal(relTime(at(12, 23), now), 'Yesterday');
  assert.match(relTime(at(3, 9), now), /Nov\s+3/);
  assert.match(relTime(new Date(2025, 10, 3).toISOString(), now), /2025/);
  assert.equal(dayGroup(at(13, 0, 1), now), 'Today');
  assert.equal(dayGroup(at(12, 0, 1), now), 'Yesterday');
  assert.equal(dayGroup(at(11, 23), now), 'Earlier');
  const groups = groupByDay([{ at: at(13, 10) }, { at: at(13, 8) }, { at: at(12, 9) }, { at: at(1, 9) }], now);
  assert.deepEqual(groups.map(([g, l]) => [g, l.length]), [['Today', 2], ['Yesterday', 1], ['Earlier', 1]]);
});
