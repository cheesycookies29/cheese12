// Feedback: any user sends it; only administrators read and answer it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-feedback-')), 'db.json'));
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
const accounts = {};
for (const role of ['hr', 'it', 'payroll']) {
  await admin('POST', '/api/users', { name: `${role} user`, username: `${role}user`, role, password: 'secret123', mustChangePassword: false });
  accounts[role] = client();
  await accounts[role]('POST', '/api/auth/login', { username: `${role}user`, password: 'secret123' });
}

test('every user can send feedback and see their own, with replies', async () => {
  await assert.rejects(accounts.it('POST', '/api/feedback', { type: 'bug', subject: '', message: 'Something broke' }), /subject/);
  await assert.rejects(accounts.it('POST', '/api/feedback', { type: 'nope', subject: 'x', message: 'Something broke here' }), /what kind/);
  const sent = await accounts.it('POST', '/api/feedback', { type: 'bug', area: 'assets', subject: 'Export is empty', message: 'The CSV export on Inventory has no rows.' });
  assert.equal(sent.number, 'FB-0001');
  assert.equal(sent.status, 'new');
  assert.equal(sent.roleLabel, 'IT Asset Manager');
  await accounts.hr('POST', '/api/feedback', { type: 'idea', subject: 'Bulk approve', message: 'Approve several leave requests at once.' });

  const mine = await accounts.it('GET', '/api/me/feedback');
  assert.deepEqual(mine.map((f) => f.subject), ['Export is empty']);
  assert.equal((await accounts.payroll('GET', '/api/me/feedback')).length, 0);
});

test('only administrators can read all feedback and reply', async () => {
  for (const c of Object.values(accounts)) {
    await assert.rejects(c('GET', '/api/feedback'), /does not have access/);
    await assert.rejects(c('GET', '/api/feedback/summary'), /does not have access/);
  }
  const all = await admin('GET', '/api/feedback');
  assert.deepEqual(all.map((f) => f.number), ['FB-0002', 'FB-0001'], 'newest first');
  assert.equal((await admin('GET', '/api/feedback/summary')).new, 2);

  const bug = all.find((f) => f.number === 'FB-0001');
  await assert.rejects(accounts.it('POST', `/api/feedback/${bug.id}/update`, { status: 'resolved' }), /does not have access/);
  await assert.rejects(admin('POST', `/api/feedback/${bug.id}/update`, { status: 'new' }), /Change the status or write a reply/);
  const updated = await admin('POST', `/api/feedback/${bug.id}/update`, { status: 'resolved', note: 'Fixed in the next build.' });
  assert.equal(updated.status, 'resolved');
  assert.equal((await admin('GET', '/api/feedback/summary')).new, 1);
  const [mine] = await accounts.it('GET', '/api/me/feedback');
  assert.equal(mine.status, 'resolved');
  assert.equal(mine.updates[0].note, 'Fixed in the next build.');
});

test('loading demo data or erasing company data keeps feedback', async () => {
  await admin('POST', '/api/admin/demo');
  assert.equal((await admin('GET', '/api/feedback')).length, 2);
  await admin('POST', '/api/admin/reset');
  assert.equal((await admin('GET', '/api/feedback')).length, 2);
  const [first] = await admin('GET', '/api/feedback');
  await admin('DELETE', `/api/feedback/${first.id}`);
  assert.equal((await admin('GET', '/api/feedback')).length, 1);
});

test('feedback and responses written in the visual editor: kept as Markdown, counted and notified as text', async () => {
  // Marks alone do not make a message.
  await assert.rejects(accounts.hr('POST', '/api/feedback', { type: 'bug', subject: 'Short', message: '**a** _b_ `c`' }), /sentence or two/);
  const md = '**Steps**\n\n1. Open *Payroll*\n2. Click **Export**\n\n| Expected | Actual |\n| --- | --- |\n| Rows | Empty |';
  const sent = await accounts.hr('POST', '/api/feedback', { type: 'bug', area: 'hr', subject: 'Formatted', message: md });
  assert.equal(sent.message, md, 'stored as written');
  await admin('POST', `/api/feedback/${sent.id}/update`, { status: 'reviewing', note: 'Thanks, **looking at it** now: [the guide](https://example.org)' });
  const notes = JSON.stringify(await accounts.hr('GET', '/api/notifications'));
  assert.match(notes, /Thanks, looking at it now: the guide \(https:\/\/example\.org\)/, 'the bell shows the words, not the marks');
  assert.ok(!notes.includes('**'));
});

test('a response made only of formatting is no response (QA 0.36)', async () => {
  const sent = await accounts.payroll('POST', '/api/feedback', { type: 'question', subject: 'Empty reply', message: 'Will an empty list count as a reply?' });
  await assert.rejects(admin('POST', `/api/feedback/${sent.id}/update`, { status: sent.status, note: '-\n-' }), /Change the status or write a reply/);
  await assert.rejects(admin('POST', `/api/feedback/${sent.id}/update`, { note: '** **' }), /Change the status or write a reply/);
  const changed = await admin('POST', `/api/feedback/${sent.id}/update`, { status: 'reviewing', note: '- \n- ' });
  assert.equal(changed.updates.at(-1).note, '', 'a status change with an empty list saves no response');
});

test('QA 0.37: only listed types, modules and statuses; text fields are text', async () => {
  const ok = { subject: 'A subject', message: 'A message long enough to count.' };
  for (const type of ['constructor', 'toString', '__proto__', ['bug'], { bug: 1 }]) {
    await assert.rejects(accounts.hr('POST', '/api/feedback', { ...ok, type }), /what kind/, JSON.stringify(type));
  }
  const odd = await accounts.hr('POST', '/api/feedback', { ...ok, type: 'bug', area: 'toString' });
  assert.equal(odd.area, 'general', 'an unknown module is General');
  assert.equal((await accounts.hr('POST', '/api/feedback', { ...ok, type: 'bug', area: ['hr'] })).area, 'general');
  await assert.rejects(accounts.hr('POST', '/api/feedback', { ...ok, type: 'bug', subject: { a: 1 } }), /subject as text/);
  await assert.rejects(accounts.hr('POST', '/api/feedback', { ...ok, type: 'bug', message: ['a long', 'enough message'] }), /details as text/);
  for (const status of ['constructor', ['closed'], 'nope']) {
    await assert.rejects(admin('POST', `/api/feedback/${odd.id}/update`, { status }), /status from the list/, JSON.stringify(status));
  }
  await assert.rejects(admin('POST', `/api/feedback/${odd.id}/update`, { note: { x: 1 } }), /response as text/);
});

test('QA 0.37: numbers are never given twice; replies, status changes and deletions are audited', async () => {
  const ok = { type: 'idea', subject: 'Numbering', message: 'Each feedback keeps its own number.' };
  const a = await accounts.it('POST', '/api/feedback', ok);
  await admin('DELETE', `/api/feedback/${a.id}`);
  const b = await accounts.it('POST', '/api/feedback', ok);
  assert.ok(Number(b.number.slice(3)) > Number(a.number.slice(3)), `${b.number} after deleting ${a.number}`);
  const replied = await admin('POST', `/api/feedback/${b.id}/update`, { status: 'resolved', note: 'Done in **0.37**.' });
  assert.equal(replied.status, 'resolved');
  await admin('DELETE', `/api/feedback/${b.id}`);
  const log = (await admin('GET', '/api/audit?area=feedback')).entries;
  const update = log.find((e) => e.action === 'feedback.update' && e.entityId === b.id);
  assert.deepEqual(update.changes, [{ field: 'status', from: 'New', to: 'Resolved' }]);
  assert.ok(!JSON.stringify(update).includes('0.37'), 'the text of a response is not in the log');
  assert.ok(log.some((e) => e.action === 'feedback.delete' && e.entityId === a.id));
  // The sender is told of both the reply and the new status.
  const bell = JSON.stringify(await accounts.it('GET', '/api/notifications'));
  assert.match(bell, new RegExp(`replied to your feedback ${b.number} and marked it Resolved`));
});

test('QA 0.37: a damaged feedback record in a restored backup does not stop feedback', async () => {
  const backup = structuredClone(await admin('GET', '/api/admin/export'));
  backup.feedback = [{ id: 'x1', subject: 's', message: 'm', userId: 'nobody' }, { id: 'x1' }, null, 'junk', { id: 'x2', number: 'FB-0099', status: 'constructor', updates: 'no' }];
  await admin('POST', '/api/admin/import', { ...backup, password: 'secret123' });
  const kept = await admin('GET', '/api/feedback');
  assert.deepEqual(kept.map((f) => f.id).sort(), ['x1', 'x2']);
  assert.ok(kept.every((f) => Array.isArray(f.updates) && f.status === 'new' && f.createdAt));
  const next = await accounts.hr('POST', '/api/feedback', { type: 'bug', subject: 'After restore', message: 'Feedback still works after a restore.' });
  assert.ok(Number(next.number.slice(3)) >= 100, `continues after the highest number: ${next.number}`);
  await admin('POST', '/api/feedback/x1/update', { status: 'closed' });
});
