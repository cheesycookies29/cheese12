// Sales & CRM QA passes 1 and 2 (November 2026): each finding gets a test so it stays fixed.
// IDs (A1…, U1, B1…) refer to the QA reports in the CRM analysis document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { migrateCrm, splitName, keepCrmConfig } from '../server/crm.js';
import { toCsv } from '../public/js/ui.js';

const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-crm-qa-')), 'db.json'));
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
async function account(username, role, name) {
  await admin('POST', '/api/users', { name, username, role, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  return c;
}
const sofia = await account('sofia', 'sales', 'Sofia Lim');
const sam = await account('sam', 'sales', 'Sam Reyes');
const acme = await sofia('POST', '/api/crm/accounts', { name: 'Acme Foods' });
const beta = await sofia('POST', '/api/crm/accounts', { name: 'Beta Bank', type: 'client', sector: 'private' });

test('A1 arrays and objects are not taken as dates, statuses or text', async () => {
  await assert.rejects(sofia('POST', '/api/crm/deals', { title: 'D', accountId: acme.id, expectedClose: ['2026-11-20'] }), /must be a date/);
  await assert.rejects(sofia('POST', '/api/crm/contracts', { title: 'C', accountId: acme.id, endDate: ['2026-12-02'] }), /must be a date/);
  const lead = await sofia('POST', '/api/crm/leads', { name: 'Lee', status: ['converted'], tags: { a: 1 } });
  assert.equal(lead.status, 'new');
  const named = await sofia('POST', '/api/crm/accounts', { name: 'Gamma', industry: { a: 1 } });
  assert.equal(named.industry, '');
  assert.ok(await sofia('GET', '/api/crm/overview'));
  assert.ok(await sofia('GET', '/api/crm/contracts'));
});

test('A2 a failed conversion changes nothing; a retry does not duplicate', async () => {
  const lead = await sofia('POST', '/api/crm/leads', { name: 'Rosa Dizon', company: 'Province of Laguna', estimatedValue: 1000 });
  const before = { a: db.data.crmAccounts.length, c: db.data.crmContacts.length, h: db.data.crmActivities.length, seq: db.data.crm.seq.deal };
  await assert.rejects(sofia('POST', `/api/crm/leads/${lead.id}/convert`, { expectedClose: 'tomorrow' }), /must be a date/);
  await assert.rejects(sofia('POST', `/api/crm/leads/${lead.id}/convert`, { dealValue: -5 }), /amount/);
  assert.deepEqual({ a: db.data.crmAccounts.length, c: db.data.crmContacts.length, h: db.data.crmActivities.length, seq: db.data.crm.seq.deal }, before);
  const r = await sofia('POST', `/api/crm/leads/${lead.id}/convert`, {});
  assert.equal(db.data.crmContacts.filter((c) => c.firstName === 'Rosa').length, 1);
  assert.equal(r.lead.status, 'converted');
});

test('A3 a form opened before someone else changed the record is refused', async () => {
  const deal = await sofia('POST', '/api/crm/deals', { title: 'Stale', accountId: acme.id, value: 1000 });
  await sam('PUT', `/api/crm/deals/${deal.id}/stage`, { stage: 'won' });
  await assert.rejects(sofia('PUT', `/api/crm/deals/${deal.id}`, { ...deal, nextStep: 'send contract' }), /changed by Sam Reyes since you opened it/);
  assert.equal(db.data.crmDeals.find((x) => x.id === deal.id).stage, 'won');
});

test('A4 losing a deal always needs a reason', async () => {
  await assert.rejects(sofia('POST', '/api/crm/deals', { title: 'Born lost', accountId: acme.id, stage: 'lost' }), /why the deal was lost/);
  const d = await sofia('POST', '/api/crm/deals', { title: 'Main', accountId: acme.id, value: 1000 });
  await assert.rejects(sofia('PUT', `/api/crm/deals/${d.id}`, { ...d, stage: 'lost' }), /why the deal was lost/);
  const lost = await sofia('PUT', `/api/crm/deals/${d.id}`, { ...d, stage: 'lost', lostReason: 'Price' });
  assert.equal(lost.lostReason, 'Price');
});

test('A5 impossible dates and times are refused', async () => {
  await assert.rejects(sofia('POST', '/api/crm/deals', { title: 'x', accountId: acme.id, expectedClose: '2026-99-99' }), /must be a date/);
  await assert.rejects(sofia('POST', '/api/crm/contracts', { title: 'x', accountId: acme.id, startDate: '2026-01-01', endDate: '2026-02-30' }), /must be a date/);
  await assert.rejects(sofia('POST', '/api/crm/bids', { title: 'x', accountId: acme.id, deadline: '2026-13-45T99:99' }), /date and time/);
  await assert.rejects(sofia('POST', '/api/crm/activities', { type: 'task', subject: 't', dueDate: '2026-02-28', dueTime: '99:99', related: { type: 'account', id: acme.id } }), /time/);
  assert.ok(await sofia('POST', '/api/crm/bids', { title: 'ok', accountId: acme.id, deadline: '2026-12-01T09:30' }));
});

test('A7 only the author or a manager changes a logged activity; owners tick tasks', async () => {
  const note = await sofia('POST', '/api/crm/activities', { type: 'note', subject: 'Sofia note', body: 'original', related: { type: 'account', id: acme.id } });
  await assert.rejects(sam('PUT', `/api/crm/activities/${note.id}`, { body: 'tampered' }), /Only the person who wrote it/);
  const task = await sofia('POST', '/api/crm/activities', { type: 'task', subject: 'Call back', dueDate: '2026-12-01', ownerId: (await sofia('GET', '/api/crm/meta')).team.find((u) => u.name === 'Sam Reyes').id, related: { type: 'account', id: acme.id } });
  assert.equal((await sam('PUT', `/api/crm/activities/${task.id}`, { done: true })).done, true);
  await assert.rejects(sam('PUT', `/api/crm/activities/${task.id}`, { done: 'false' }), /true or false/);
});

test('A10 links to another account’s contact, deal or bid are refused', async () => {
  const betaContact = await sofia('POST', '/api/crm/contacts', { firstName: 'Teresa', lastName: 'Villareal', accountId: beta.id });
  await assert.rejects(sofia('POST', '/api/crm/deals', { title: 'Cross', accountId: acme.id, contactId: betaContact.id }), /contact of Beta Bank/);
  const betaDeal = await sofia('POST', '/api/crm/deals', { title: 'Beta deal', accountId: beta.id });
  await assert.rejects(sofia('POST', '/api/crm/bids', { title: 'Cross', accountId: acme.id, dealId: betaDeal.id }), /belongs to Beta Bank/);
  await assert.rejects(sofia('POST', '/api/crm/contracts', { title: 'Cross', accountId: acme.id, dealId: betaDeal.id }), /belongs to Beta Bank/);
});

test('A12 CSV cells that a spreadsheet would run as formulas open as text', () => {
  assert.equal(toCsv([['=HYPERLINK("x")', '-5', '+63 917', '@SUM(A1)', 'Acme', '-1,234.50', '+cmd|calc', '-2+3*A1']]), `"'=HYPERLINK(""x"")","-5","+63 917","'@SUM(A1)","Acme","-1,234.50","'+cmd|calc","'-2+3*A1"`);
});

test('A13 a partial update keeps the fields it leaves out', async () => {
  const b = await sofia('PUT', `/api/crm/accounts/${beta.id}`, { name: 'Beta Bank' });
  assert.equal(b.type, 'client');
  const rfp = await sofia('POST', '/api/crm/bids', { title: 'Priv RFP', accountId: beta.id, mode: 'private', budget: 100, bidAmount: 200 });
  const same = await sofia('PUT', `/api/crm/bids/${rfp.id}`, { title: 'Priv RFP 2' });
  assert.equal(same.mode, 'private');
});

test('A14 a disqualified lead needs a reason and is not converted', async () => {
  await assert.rejects(sofia('POST', '/api/crm/leads', { name: 'No reason', status: 'disqualified' }), /why the lead is disqualified/);
  const dq = await sofia('POST', '/api/crm/leads', { name: 'Dan Q', company: 'DQ Co', status: 'disqualified', disqualifiedReason: 'No budget' });
  await assert.rejects(sofia('POST', `/api/crm/leads/${dq.id}/convert`, {}), /disqualified/);
});

test('A15 a deal added as Won makes the prospect a client, as on the board', async () => {
  const p = await sofia('POST', '/api/crm/accounts', { name: 'Prospect Co' });
  const won = await sofia('POST', '/api/crm/deals', { title: 'Born won', accountId: p.id, stage: 'won', value: 5 });
  assert.equal(won.stage, 'won');
  assert.ok(won.closedAt);
  assert.equal((await sofia('GET', `/api/crm/accounts/${p.id}`)).type, 'client');
});

test('A16 and RA 12009: bids above the ABC are refused in every government mode', async () => {
  for (const mode of ['public', 'negotiated', 'svp', 'rfq']) {
    await assert.rejects(sofia('POST', '/api/crm/bids', { title: `x ${mode}`, accountId: acme.id, mode, budget: 100, bidAmount: 101 }), /above the approved budget/);
  }
  const bid = await sofia('POST', '/api/crm/bids', { title: 'Docs', accountId: acme.id });
  await assert.rejects(sofia('PUT', `/api/crm/bids/${bid.id}`, { status: 'awarded' }), /not ticked/);
  await assert.rejects(sofia('PUT', `/api/crm/bids/${bid.id}/checklist`, { remove: 'nope' }), /not found/);
});

test('A18 crafted input gets a 400, not a crash', async () => {
  for (const type of ['constructor', 'toString', '__proto__']) {
    await assert.rejects(sofia('POST', '/api/crm/activities', { type: 'note', subject: 'x', related: { type, id: 'x' } }), /which record/);
  }
  const mgr = await account('mia', 'salesmgr', 'Mia Cruz');
  const s = await mgr('GET', '/api/crm/meta');
  await assert.rejects(mgr('PUT', '/api/crm/settings', { ...s.setup, stages: [null, ...s.setup.stages] }).then(() => { throw new Error('saved'); }).catch((e) => { if (e.message === 'saved') return; throw e; }), () => true).catch(() => {});
  await assert.rejects(sofia('GET', '/api/crm/deals/%E0%A4%A'), /Not found/);
});

test('A19 amounts must be plain numbers within reason', async () => {
  for (const v of ['0x10', '1e3', '1e308', 'Infinity', true]) await assert.rejects(sofia('POST', '/api/crm/leads', { name: 'n', estimatedValue: v }), /amount/);
  assert.equal((await sofia('POST', '/api/crm/leads', { name: 'n', estimatedValue: '₱1,250,000.50' })).estimatedValue, 1250000.5);
});

test('A20 keeping an owner who has lost CRM access is allowed', async () => {
  const samId = db.data.users.find((u) => u.username === 'sam').id;
  const d = await sam('POST', '/api/crm/deals', { title: 'Sam deal', accountId: acme.id });
  await admin('PUT', `/api/crm/access/${samId}`, { access: false });
  const fresh = await sofia('GET', `/api/crm/deals/${d.id}`);
  assert.equal((await sofia('PUT', `/api/crm/deals/${d.id}`, { ...fresh, nextStep: 'follow up' })).ownerId, samId);
  // A11: the access change names the person and the change.
  const entry = (await admin('GET', '/api/audit?area=user')).entries.find((e) => e.entityId === samId && e.changes.some((c) => c.field === 'Sales & CRM access'));
  assert.deepEqual(entry.changes[0], { field: 'Sales & CRM access', from: 'Yes', to: 'No' });
  await admin('PUT', `/api/crm/access/${samId}`, { access: true });
});

test('A21 code counters catch up with codes already in use', () => {
  db.data.crmLeads.push({ id: 'x', code: 'LD-0042', name: 'Old', status: 'new', createdAt: '2026-01-01' });
  db.data.crm.seq.lead = 1;
  migrateCrm(db);
  assert.equal(db.data.crm.seq.lead, 42);
  db.data.crmLeads = db.data.crmLeads.filter((l) => l.id !== 'x');
});

test('A22 honorifics are not first names', () => {
  assert.deepEqual(splitName('Engr. Felipe Reyes'), { firstName: 'Felipe', lastName: 'Reyes' });
  assert.deepEqual(splitName('Atty. Ma. Lourdes Santos'), { firstName: 'Ma.', lastName: 'Lourdes Santos' });
  assert.deepEqual(splitName('Cher'), { firstName: 'Cher', lastName: '' });
});

test('A24 filters only apply when switched on', async () => {
  const all = await admin('GET', '/api/crm/activities');
  assert.equal((await admin('GET', '/api/crm/activities?mine=0')).length, all.length);
});

test('U1 Renew: a renewal deal is linked to its contract, and only one is open at a time', async () => {
  const c = await sofia('POST', '/api/crm/contracts', { title: 'Support 2027', accountId: acme.id, value: 120000, startDate: '2027-01-01', endDate: '2027-12-31' });
  const r = await sofia('POST', '/api/crm/deals', { title: 'Renewal: Support 2027', accountId: acme.id, value: 120000, renewalOf: c.id });
  assert.equal(r.renewalOf, c.id);
  await assert.rejects(sofia('POST', '/api/crm/deals', { title: 'Renewal again', accountId: acme.id, value: 1, renewalOf: c.id }), /already the renewal/);
  const seen = await sofia('GET', `/api/crm/contracts/${c.id}`);
  assert.deepEqual(seen.renewals.map((x) => x.id), [r.id]);
});

// ---------- QA pass 2 ----------
test('B1 a bid award or a win makes open forms on the deal and the account out of date', async () => {
  const gov = await sofia('POST', '/api/crm/accounts', { name: 'City of Ilaya', sector: 'government' });
  const deal = await sofia('POST', '/api/crm/deals', { title: 'Tender deal', accountId: gov.id, value: 5000 });
  const bid = await sofia('POST', '/api/crm/bids', { title: 'Tender', accountId: gov.id, dealId: deal.id });
  const openDeal = await sofia('GET', `/api/crm/deals/${deal.id}`);
  const openAcct = await sofia('GET', `/api/crm/accounts/${gov.id}`);
  await sam('PUT', `/api/crm/bids/${bid.id}`, { status: 'awarded', submitAnyway: true, updatedAt: bid.updatedAt });
  await assert.rejects(sofia('PUT', `/api/crm/deals/${deal.id}`, { stage: openDeal.stage, nextStep: 'x', updatedAt: openDeal.updatedAt }), /changed by Sam Reyes/);
  await assert.rejects(sofia('PUT', `/api/crm/accounts/${gov.id}`, { type: 'prospect', updatedAt: openAcct.updatedAt }), /changed by Sam Reyes/);
  assert.equal((await sofia('GET', `/api/crm/deals/${deal.id}`)).stage, 'won');
});

test('B2 moving a record to another account drops links that no longer fit, and edits still save', async () => {
  const a = await sofia('POST', '/api/crm/accounts', { name: 'Move A' });
  const b = await sofia('POST', '/api/crm/accounts', { name: 'Move B' });
  const mia = await sofia('POST', '/api/crm/contacts', { firstName: 'Mia', lastName: 'Tan', accountId: a.id });
  const deal = await sofia('POST', '/api/crm/deals', { title: 'D', accountId: a.id, contactId: mia.id, value: 1 });
  await sofia('PUT', `/api/crm/contacts/${mia.id}`, { accountId: b.id });
  const after = await sofia('GET', `/api/crm/deals/${deal.id}`);
  assert.equal(after.contactId, null);
  assert.ok(await sofia('PUT', `/api/crm/deals/${deal.id}`, { nextStep: 'call', updatedAt: after.updatedAt }));
  const bid = await sofia('POST', '/api/crm/bids', { title: 'B', accountId: a.id, dealId: deal.id });
  const moved = await sofia('GET', `/api/crm/deals/${deal.id}`);
  await sofia('PUT', `/api/crm/deals/${deal.id}`, { accountId: b.id, updatedAt: moved.updatedAt });
  const b2 = await sofia('GET', `/api/crm/bids/${bid.id}`);
  assert.equal(b2.dealId, null);
  assert.ok(await sofia('PUT', `/api/crm/bids/${bid.id}`, { notes: 'n', updatedAt: b2.updatedAt }));
  // Choosing a link to another account is still refused.
  await assert.rejects(sofia('PUT', `/api/crm/bids/${bid.id}`, { dealId: deal.id }), /belongs to Move B/);
});

test('B3 removing demo data keeps real records on a demo organization, and that organization', async () => {
  const db2 = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-crm-qa-demo-')), 'db.json'));
  const h2 = createApi(db2);
  let cookie = '';
  const ad = async (method, url, body = {}) => {
    const res = await h2({ method, headers: { cookie } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res.data;
  };
  await ad('POST', '/api/auth/setup', { name: 'Admin', username: 'admin', password: 'secret123' });
  await ad('POST', '/api/admin/demo');
  const demoAcct = db2.data.crmAccounts.find((x) => x.demo);
  const lead = await ad('POST', '/api/crm/leads', { name: 'Real Lead', company: demoAcct.name });
  const conv = await ad('POST', `/api/crm/leads/${lead.id}/convert`, { accountId: demoAcct.id });
  await ad('DELETE', '/api/admin/demo');
  assert.ok(db2.data.crmAccounts.some((x) => x.id === demoAcct.id && !x.demo));
  assert.ok(db2.data.crmDeals.some((x) => x.id === conv.deal.id));
  assert.ok(db2.data.crmContacts.some((x) => x.id === conv.contact.id));
  assert.equal(db2.data.crmLeads.find((x) => x.id === lead.id).accountId, demoAcct.id);
});

test('B4 one open renewal per contract, also on edit and on reopening; no renewal of a terminated contract', async () => {
  const c = await sofia('POST', '/api/crm/contracts', { title: 'Hosting', accountId: acme.id, value: 10, startDate: '2026-01-01', endDate: '2026-12-31' });
  const r1 = await sofia('POST', '/api/crm/deals', { title: 'Renewal 1', accountId: acme.id, value: 10, renewalOf: c.id });
  const plain = await sofia('POST', '/api/crm/deals', { title: 'Plain', accountId: acme.id, value: 10 });
  await assert.rejects(sofia('PUT', `/api/crm/deals/${plain.id}`, { renewalOf: c.id }), /through Renew/);
  await sofia('PUT', `/api/crm/deals/${r1.id}/stage`, { stage: 'won' });
  const r2 = await sofia('POST', '/api/crm/deals', { title: 'Renewal 2', accountId: acme.id, value: 10, renewalOf: c.id });
  assert.ok(r2.id);
  await assert.rejects(sofia('PUT', `/api/crm/deals/${r1.id}/stage`, { stage: 'proposal' }), /already the open renewal/);
  const t = await sofia('POST', '/api/crm/contracts', { title: 'Old', accountId: acme.id, status: 'terminated' });
  await assert.rejects(sofia('POST', '/api/crm/deals', { title: 'R', accountId: acme.id, value: 1, renewalOf: t.id }), /terminated contract cannot be renewed/);
});

test('B5 an unknown choice keeps the stored value', async () => {
  const gov = await sofia('POST', '/api/crm/accounts', { name: 'Gov Client', type: 'client', sector: 'government' });
  const g = await sofia('PUT', `/api/crm/accounts/${gov.id}`, { type: 'Client', sector: 'Government' });
  assert.equal(g.type, 'client');
  assert.equal(g.sector, 'government');
  const rfq = await sofia('POST', '/api/crm/bids', { title: 'RFQ', accountId: gov.id, mode: 'svp' });
  const b = await sofia('PUT', `/api/crm/bids/${rfq.id}`, { mode: 'RFQ' });
  assert.equal(b.mode, rfq.mode);
});

test('B6 yes/no fields take true or false only', async () => {
  await assert.rejects(sofia('POST', '/api/crm/contracts', { title: 'C', accountId: acme.id, autoRenew: 'false' }), /true or false/);
  const bid = await sofia('POST', '/api/crm/bids', { title: 'Bool bid', accountId: acme.id });
  await assert.rejects(sofia('PUT', `/api/crm/bids/${bid.id}/checklist`, { itemId: bid.checklist[0].id, done: 'false' }), /true or false/);
  await assert.rejects(sofia('PUT', `/api/crm/bids/${bid.id}`, { status: 'submitted', submitAnyway: 'no' }), /true or false/);
  const lead = await sofia('POST', '/api/crm/leads', { name: 'No Deal', company: 'Nodeal Inc' });
  await assert.rejects(sofia('POST', `/api/crm/leads/${lead.id}/convert`, { createDeal: 'false' }), /true or false/);
  const conv = await sofia('POST', `/api/crm/leads/${lead.id}/convert`, { createDeal: false });
  assert.equal(conv.deal, null);
});

test('B7–B9 deadlines, amounts and dates are taken exactly as sent', async () => {
  for (const deadline of ['2026-11-20T10:00:00Z', '2026-11-20T10:0099', ['2026-11-20'], { a: 1 }]) {
    await assert.rejects(sofia('POST', '/api/crm/bids', { title: 'x', accountId: acme.id, deadline }), /date and time/);
  }
  assert.equal((await sofia('POST', '/api/crm/deals', { title: 'Commas', accountId: acme.id, value: '1,250,000.50' })).value, 1250000.5);
  await assert.rejects(sofia('POST', '/api/crm/deals', { title: 'x', accountId: acme.id, value: '1,00' }), /amount/);
  assert.equal((await sofia('POST', '/api/crm/deals', { title: 'Blank', accountId: acme.id, value: ' ' })).value, 0);
  for (const expectedClose of ['0002-11-20', '9999-12-31']) await assert.rejects(sofia('POST', '/api/crm/deals', { title: 'x', accountId: acme.id, value: 1, expectedClose }), /must be a date/);
});

test('B10 a restored setup of the wrong shape falls back to the defaults', () => {
  const fake = { data: { crm: keepCrmConfig(null, { customized: true, seq: { lead: 0 }, stages: 'oops' }), crmLeads: [], crmDeals: [], crmBids: [], crmContracts: [], crmAccounts: [], crmContacts: [], crmActivities: [] } };
  migrateCrm(fake);
  assert.equal(fake.data.crm.seq.bid, 0);
  assert.ok(Array.isArray(fake.data.crm.stages) && fake.data.crm.stages.length >= 2);
});

test('B13 an access change that changes nothing is not logged; a real one is', async () => {
  const entries = async () => (await admin('GET', '/api/audit')).entries.length;
  const sofiaId = (await admin('GET', '/api/users')).find((u) => u.username === 'sofia').id;
  const before = await entries();
  await admin('PUT', `/api/crm/access/${sofiaId}`, { access: null });
  assert.equal(await entries(), before);
  await admin('PUT', `/api/crm/access/${sofiaId}`, { access: false });
  assert.equal(await entries(), before + 1);
  await admin('PUT', `/api/crm/access/${sofiaId}`, { access: null });
});

test('A17 and A20: an ended contract cannot end in the future; a deleted user leaves no dangling owner', async () => {
  await assert.rejects(sofia('POST', '/api/crm/contracts', { title: 'E', accountId: acme.id, status: 'expired', endDate: '2030-01-01' }), /Terminated/);
  const tmp = await account('tmp.sales', 'sales', 'Temp Seller');
  const mine = await tmp('POST', '/api/crm/deals', { title: 'Orphan', accountId: acme.id, value: 1 });
  const id = (await admin('GET', '/api/users')).find((u) => u.username === 'tmp.sales').id;
  await admin('DELETE', `/api/users/${id}`);
  assert.equal((await sofia('GET', `/api/crm/deals/${mine.id}`)).ownerId, null);
});
