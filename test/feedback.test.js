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
