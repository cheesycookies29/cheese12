// Sales & CRM: access, records, lead conversion, the pipeline, bids, contracts, activities,
// the sales setup and service desk hand-off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { localDate } from '../server/util.js';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-crm-')), 'db.json');
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
await admin('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
async function account(username, role, name = username) {
  await admin('POST', '/api/users', { name, username, role, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  return c;
}
const sales = await account('sofia', 'sales', 'Sofia Lim');
const manager = await account('marco', 'salesmgr', 'Marco Tan');
const hr = await account('hanna', 'hr');
const addDays = (n) => {
  const d = new Date(`${localDate()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test('only CRM accounts can use the CRM; administrators can grant or remove access', async () => {
  await assert.rejects(hr('GET', '/api/crm/deals'), /does not have access/);
  assert.deepEqual(await sales('GET', '/api/crm/deals'), []);
  const meta = await sales('GET', '/api/crm/meta');
  assert.equal(meta.setup.stages.length, 4);
  assert.deepEqual(meta.team.map((u) => u.name).sort(), ['Admin', 'Marco Tan', 'Sofia Lim']);
  // Sales officers cannot change the setup or delete; managers can.
  await assert.rejects(sales('PUT', '/api/crm/settings', meta.setup), /does not have access/);
  const users = await admin('GET', '/api/users');
  const hanna = users.find((u) => u.username === 'hanna');
  await admin('PUT', `/api/crm/access/${hanna.id}`, { access: true });
  assert.ok(Array.isArray(await hr('GET', '/api/crm/deals')));
  await admin('PUT', `/api/crm/access/${hanna.id}`, { access: null });
  await assert.rejects(hr('GET', '/api/crm/deals'), /does not have access/);
  await assert.rejects(admin('PUT', `/api/crm/access/${users.find((u) => u.username === 'admin').id}`, { access: false }), /always have CRM access/);
});

test('a lead is qualified and converted into an account, a contact and a deal', async () => {
  await assert.rejects(sales('POST', '/api/crm/leads', { name: '' }), /name/);
  const lead = await sales('POST', '/api/crm/leads', { name: 'Rosa Dizon', company: 'Province of Laguna', email: 'rosa@laguna.gov.ph', source: 'Referral', estimatedValue: '1,250,000', interest: 'HRIS for 1,200 employees' });
  assert.equal(lead.code, 'LD-0001');
  assert.equal(lead.estimatedValue, 1250000);
  const contacted = await sales('PUT', `/api/crm/leads/${lead.id}`, { ...lead, status: 'qualified' });
  assert.equal(contacted.status, 'qualified');
  await assert.rejects(sales('PUT', `/api/crm/leads/${lead.id}`, { ...lead, status: 'converted' }), /Use Convert/);
  // A follow-up task on the lead moves to the deal on conversion.
  await sales('POST', '/api/crm/activities', { type: 'task', subject: 'Send capability deck', dueDate: addDays(1), related: { type: 'lead', id: lead.id } });
  const r = await sales('POST', `/api/crm/leads/${lead.id}/convert`, { dealTitle: 'Laguna HRIS' });
  assert.equal(r.lead.status, 'converted');
  assert.equal(r.account.name, 'Province of Laguna');
  assert.equal(r.contact.name, 'Rosa Dizon');
  assert.equal(r.contact.accountName, 'Province of Laguna');
  assert.equal(r.deal.code, 'DL-0001');
  assert.equal(r.deal.value, 1250000);
  assert.equal(r.deal.stage, 'qualify');
  assert.equal(r.deal.probability, 10);
  const timeline = await sales('GET', `/api/crm/activities?type=deal&id=${r.deal.id}`);
  assert.ok(timeline.some((a) => a.subject === 'Send capability deck'));
  await assert.rejects(sales('POST', `/api/crm/leads/${lead.id}/convert`, {}), /already converted/);
  await assert.rejects(sales('PUT', `/api/crm/leads/${lead.id}`, { ...lead }), /converted/);
});

test('deals move through the pipeline; winning makes the prospect a client', async () => {
  const [deal] = await sales('GET', '/api/crm/deals');
  await assert.rejects(sales('POST', '/api/crm/deals', { title: 'No account' }), /account/);
  await assert.rejects(sales('PUT', `/api/crm/deals/${deal.id}/stage`, { stage: 'nope' }), /valid stage/);
  const moved = await sales('PUT', `/api/crm/deals/${deal.id}/stage`, { stage: 'proposal' });
  assert.equal(moved.probability, 50);
  assert.equal(moved.weighted, 625000);
  await assert.rejects(sales('PUT', `/api/crm/deals/${deal.id}/stage`, { stage: 'lost' }), /why/);
  const won = await sales('PUT', `/api/crm/deals/${deal.id}/stage`, { stage: 'won' });
  assert.equal(won.probability, 100);
  assert.ok(won.closedAt);
  const acct = await sales('GET', `/api/crm/accounts/${deal.accountId}`);
  assert.equal(acct.type, 'client');
  assert.equal(acct.wonValue, 1250000);
  const history = await sales('GET', `/api/crm/activities?type=account&id=${deal.accountId}`);
  assert.ok(history.some((a) => a.type === 'event' && /Qualification → Proposal/.test(a.subject)));
  assert.ok(history.some((a) => /Now a client/.test(a.subject)));
  const ov = await sales('GET', '/api/crm/overview');
  assert.equal(ov.wonMonth.count, 1);
  assert.equal(ov.wonMonth.value, 1250000);
  assert.equal(ov.winRate, 100);
});

test('bids: approved budget check, document checklist, award closes the linked deal', async () => {
  const acct = await sales('POST', '/api/crm/accounts', { name: 'Department of Education', type: 'prospect', sector: 'government' });
  await assert.rejects(sales('POST', '/api/crm/accounts', { name: 'department of education' }), /already exists/);
  const deal = await sales('POST', '/api/crm/deals', { title: 'DepEd LMS rollout', accountId: acct.id, value: 4800000, stage: 'proposal' });
  await assert.rejects(sales('POST', '/api/crm/bids', { title: 'LMS', accountId: acct.id, budget: 5000000, bidAmount: 5200000 }), /above the approved budget/);
  const bid = await sales('POST', '/api/crm/bids', { title: 'Supply and delivery of an LMS', accountId: acct.id, dealId: deal.id, reference: 'PB-2026-114', budget: 5000000, bidAmount: 4800000, deadline: `${addDays(5)}T10:00` });
  assert.equal(bid.code, 'BID-0001');
  assert.equal(bid.checklist.length, 10);
  assert.equal(bid.daysLeft, 5);
  // Submitting with documents still unticked needs a confirmation.
  await assert.rejects(sales('PUT', `/api/crm/bids/${bid.id}`, { ...bid, status: 'submitted' }), /not ticked/);
  for (const item of bid.checklist) await sales('PUT', `/api/crm/bids/${bid.id}/checklist`, { itemId: item.id, done: true });
  const extra = await sales('PUT', `/api/crm/bids/${bid.id}/checklist`, { add: 'Certificate of site inspection' });
  assert.equal(extra.checklist.length, 11);
  const sent = await sales('PUT', `/api/crm/bids/${bid.id}`, { ...bid, status: 'submitted', submitAnyway: true });
  assert.equal(sent.status, 'submitted');
  await sales('PUT', `/api/crm/bids/${bid.id}`, { ...sent, status: 'awarded' });
  const after = await sales('GET', `/api/crm/deals/${deal.id}`);
  assert.equal(after.stage, 'won');
  assert.equal(after.bids.length, 1);
});

test('contracts: renewal window on the overview; tasks due show for their owner', async () => {
  const [acct] = (await sales('GET', '/api/crm/accounts')).filter((a) => a.name === 'Department of Education');
  await assert.rejects(sales('POST', '/api/crm/contracts', { title: 'x', accountId: acct.id, startDate: '2026-05-01', endDate: '2026-01-01' }), /before the start/);
  const c = await sales('POST', '/api/crm/contracts', { title: 'LMS support and maintenance', accountId: acct.id, value: 600000, startDate: addDays(-300), endDate: addDays(45), status: 'active' });
  assert.equal(c.code, 'CT-0001');
  assert.equal(c.daysLeft, 45);
  await sales('POST', '/api/crm/activities', { type: 'task', subject: 'Prepare renewal quote', dueDate: localDate(), related: { type: 'contract', id: c.id } });
  await assert.rejects(sales('POST', '/api/crm/activities', { type: 'task', subject: 'No date', related: { type: 'contract', id: c.id } }), /due date/);
  const ov = await sales('GET', '/api/crm/overview');
  assert.equal(ov.contracts.length, 1);
  assert.ok(ov.myTasks.some((t) => t.subject === 'Prepare renewal quote'));
  assert.equal((await manager('GET', '/api/crm/overview')).myTasks.length, 0);
  const task = ov.myTasks.find((t) => t.subject === 'Prepare renewal quote');
  await sales('PUT', `/api/crm/activities/${task.id}`, { done: true });
  assert.equal((await sales('GET', '/api/crm/overview')).myTasks.filter((t) => t.subject === 'Prepare renewal quote').length, 0);
  const note = await sales('POST', '/api/crm/activities', { type: 'note', body: 'Client asked about a 3-year term.', related: { type: 'contract', id: c.id } });
  assert.equal(note.done, true);
  // Only the writer or a CRM manager can delete an activity.
  const other = await account('sam', 'sales', 'Sam Uy');
  await assert.rejects(other('DELETE', `/api/crm/activities/${note.id}`), /Only the person who wrote it/);
  await sales('DELETE', `/api/crm/activities/${note.id}`);
  await manager('DELETE', `/api/crm/activities/${task.id}`);
  assert.ok(!(await sales('GET', `/api/crm/activities?type=contract&id=${c.id}`)).some((a) => a.id === task.id || a.id === note.id));
});

test('sales setup: stages in use cannot be removed; managers delete, officers cannot', async () => {
  const { setup } = await manager('GET', '/api/crm/meta');
  const [, , proposal] = setup.stages;
  const acct = await sales('POST', '/api/crm/accounts', { name: 'Acme Logistics' });
  const deal = await sales('POST', '/api/crm/deals', { title: 'Fleet portal', accountId: acct.id, value: 900000, stage: proposal.id });
  await assert.rejects(manager('PUT', '/api/crm/settings', { ...setup, stages: setup.stages.filter((s) => s.id !== proposal.id) }), /1 deal is in "Proposal"/);
  await manager('PUT', '/api/crm/settings', { ...setup, stages: [...setup.stages, { name: 'Contract review', probability: 90 }], renewalNoticeDays: 90 });
  const meta = await sales('GET', '/api/crm/meta');
  assert.equal(meta.setup.stages.length, 5);
  assert.equal(meta.setup.renewalNoticeDays, 90);
  await assert.rejects(sales('DELETE', `/api/crm/deals/${deal.id}`), /does not have access/);
  await assert.rejects(manager('DELETE', `/api/crm/accounts/${acct.id}`), /has 1 deal/);
  await manager('DELETE', `/api/crm/deals/${deal.id}`);
  await manager('DELETE', `/api/crm/accounts/${acct.id}`);
  assert.equal((await sales('GET', '/api/crm/search?q=acme')).length, 0);
  assert.ok((await sales('GET', '/api/crm/search?q=educ')).some((r) => r.type === 'account'));
});

test('a service desk ticket becomes a lead once', async () => {
  db.data.tickets.push({ id: 't1', number: 'HD-000099', subject: 'Quote for a payroll system', channel: 'web', requester: { name: 'Lea Cruz', email: 'lea@acme.ph', phone: '0917 000 0000', organization: 'Acme Foods' }, messages: [{ id: 'm1', kind: 'message', body: 'We have 300 staff.' }] });
  const lead = await sales('POST', '/api/crm/leads/from-ticket/t1');
  assert.equal(lead.source, 'Public form');
  assert.equal(lead.company, 'Acme Foods');
  assert.match(lead.interest, /300 staff/);
  const again = await sales('POST', '/api/crm/leads/from-ticket/t1');
  assert.equal(again.id, lead.id);
  assert.ok(db.data.tickets[0].messages.some((m) => m.kind === 'event' && /Sales & CRM/.test(m.body)));
});

test('the sales setup survives erasing all data; records do not', async () => {
  assert.equal(db.data.crm.stages.length, 5);
  await admin('POST', '/api/admin/reset');
  assert.equal(db.data.crmDeals.length, 0);
  assert.equal(db.data.crmAccounts.length, 0);
  assert.equal(db.data.crm.stages.length, 5);
  assert.equal(db.data.crm.renewalNoticeDays, 90);
  assert.equal(db.data.crm.seq.deal, 0);
});
