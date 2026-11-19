// The CRM change history (0.42): every change to a deal, lead, account, contact, bid or contract is
// in the record's history with who made it, and an edit lists each field it changed, old → new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const PW = 'Correct-Horse-42';
async function company() {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'core-crm-history-')), 'db.json'));
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    return async (method, url, body = {}) => {
      try {
        const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.5' } }, new URL(url, 'http://localhost'), body);
        if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
        return res.data;
      } catch (err) {
        return { status: err.status, error: err.message };
      }
    };
  };
  const admin = client();
  await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  await admin('POST', '/api/users', { name: 'Sam Sales', username: 'sam', role: 'sales', password: PW, mustChangePassword: false });
  await admin('POST', '/api/users', { name: 'Mia Manager', username: 'mia', role: 'salesmgr', password: PW, mustChangePassword: false });
  const sam = client();
  await sam('POST', '/api/auth/login', { username: 'sam', password: PW });
  const mia = client();
  await mia('POST', '/api/auth/login', { username: 'mia', password: PW });
  return { db, handle, admin, sam, mia };
}
const historyOf = async (who, type, id) => (await who('GET', `/api/crm/activities?type=${type}&id=${id}`)).filter((a) => a.type === 'event');

test('a deal\'s history says who created it, who edited which field (old → new) and who moved it', async () => {
  const { handle, sam, mia, db } = await company();
  const acct = await sam('POST', '/api/crm/accounts', { name: 'Harbor Point Shipping Lines' });
  const ana = await sam('POST', '/api/crm/contacts', { firstName: 'Ana', lastName: 'Reyes', accountId: acct.id });
  const deal = await sam('POST', '/api/crm/deals', { title: 'Crew payroll', accountId: acct.id, value: 1200000, expectedClose: '2026-12-01' });
  assert.ok(deal.id, deal.error);

  // Mia edits two fields at once; Sam then changes one.
  const e1 = await mia('PUT', `/api/crm/deals/${deal.id}`, { value: 1500000, expectedClose: '2026-12-20', updatedAt: deal.updatedAt });
  assert.ok(!e1.error, e1.error);
  const e2 = await sam('PUT', `/api/crm/deals/${deal.id}`, { contactId: ana.id, updatedAt: e1.updatedAt });
  assert.ok(!e2.error, e2.error);
  // A save that changes nothing adds nothing.
  const e3 = await sam('PUT', `/api/crm/deals/${deal.id}`, { title: 'Crew payroll', updatedAt: e2.updatedAt });
  // Mia drags it on the board, then marks it lost.
  await mia('PUT', `/api/crm/deals/${deal.id}/stage`, { stage: 'proposal' });
  await mia('PUT', `/api/crm/deals/${deal.id}/stage`, { stage: 'lost', lostReason: 'Price' });
  const e4 = await sam('GET', `/api/crm/deals/${deal.id}`);
  await mia('PUT', `/api/crm/deals/${deal.id}`, { lostReason: 'Timing', updatedAt: e4.updatedAt });

  const h = await historyOf(sam, 'deal', deal.id);
  const by = (subject) => h.find((a) => a.subject.startsWith(subject));
  assert.equal(by('Deal created').createdByName, 'Sam Sales');
  const both = by('Edited value and expected close');
  assert.ok(both, JSON.stringify(h.map((a) => a.subject)));
  assert.equal(both.createdByName, 'Mia Manager');
  assert.equal(both.body, 'Value: ₱1,200,000 → ₱1,500,000\nExpected close: Dec 1, 2026 → Dec 20, 2026');
  assert.equal(by('Main contact').subject, 'Main contact: (none) → Ana Reyes');
  assert.equal(by('Main contact').createdByName, 'Sam Sales');
  assert.equal(by('Stage:').createdByName, 'Mia Manager');
  assert.match(by('Lost (').subject, /Lost \(Price\) · from Proposal/);
  assert.equal(by('Lost reason').subject, 'Lost reason: Price → Timing');
  assert.deepEqual(h.map((a) => `${a.createdByName}: ${a.subject}`).sort(), [
    'Mia Manager: Edited value and expected close', 'Mia Manager: Lost (Price) · from Proposal', 'Mia Manager: Lost reason: Price → Timing',
    'Mia Manager: Stage: Qualification → Proposal', 'Sam Sales: Deal created in Qualification', 'Sam Sales: Main contact: (none) → Ana Reyes',
  ].sort(), 'one entry per change, and none for the save that changed nothing');
  assert.ok(h.every((a) => a.createdByName), 'every entry names a person');
  assert.ok(e3.updatedAt);

  // The name stays after the account is removed.
  const miaId = db.data.users.find((u) => u.username === 'mia').id;
  db.data.users = db.data.users.filter((u) => u.id !== miaId);
  const later = await historyOf(sam, 'deal', deal.id);
  assert.equal(later.find((a) => a.subject.startsWith('Edited value')).createdByName, 'Mia Manager');
  handle.monitor.stop();
});

test('owner changes, bid checklists and contract edits are in the history with who did them', async () => {
  const { handle, sam, mia } = await company();
  const acct = await sam('POST', '/api/crm/accounts', { name: 'Silangan Water District', sector: 'government' });
  const miaUser = (await mia('GET', '/api/auth/status')).user;
  const a2 = await mia('PUT', `/api/crm/accounts/${acct.id}`, { ownerId: miaUser.id, tags: ['public sector'], notes: 'Budget in Q1.', updatedAt: acct.updatedAt });
  assert.ok(!a2.error, a2.error);
  const ah = await historyOf(sam, 'account', acct.id);
  const edit = ah.find((x) => x.subject.startsWith('Edited'));
  assert.equal(edit.subject, 'Edited owner, tags and notes');
  assert.equal(edit.body, 'Owner: Sam Sales → Mia Manager\nTags: (none) → public sector\nNotes edited');
  assert.equal(edit.createdByName, 'Mia Manager');

  const bid = await sam('POST', '/api/crm/bids', { title: 'Billing portal', accountId: acct.id, mode: 'public', budget: 3000000 });
  await mia('PUT', `/api/crm/bids/${bid.id}/checklist`, { itemId: bid.checklist[0].id, done: true });
  await sam('PUT', `/api/crm/bids/${bid.id}/checklist`, { add: 'Sworn statement on site inspection' });
  const bh = await historyOf(sam, 'bid', bid.id);
  const tick = bh.find((x) => x.subject.startsWith('Checklist: ticked'));
  assert.equal(tick.createdByName, 'Mia Manager');
  assert.equal(bh.find((x) => x.subject.startsWith('Checklist: added')).createdByName, 'Sam Sales');

  const c = await sam('POST', '/api/crm/contracts', { title: 'Support', accountId: acct.id, value: 100000, startDate: '2026-01-01', endDate: '2026-12-31' });
  assert.ok(c.id, c.error);
  await mia('PUT', `/api/crm/contracts/${c.id}`, { endDate: '2027-06-30', autoRenew: true, updatedAt: c.updatedAt });
  const ch = await historyOf(sam, 'contract', c.id);
  const ce = ch.find((x) => x.subject.startsWith('Edited'));
  assert.equal(ce.subject, 'Edited end date and renews automatically');
  assert.equal(ce.body, 'End date: Dec 31, 2026 → Jun 30, 2027\nRenews automatically: No → Yes');
  assert.equal(ce.createdByName, 'Mia Manager');
  handle.monitor.stop();
});
