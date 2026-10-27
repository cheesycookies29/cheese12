// IT Service Desk: portal tickets, agent workflow and permissions, settings, and email in and out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { parseMessage } from '../server/mail/mime.js';
import { fakeImap, fakeSmtp, rawEmail } from './support/mail-servers.js';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-helpdesk-')), 'db.json');
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
async function person(no, firstName, email) {
  return admin('POST', '/api/employees', { employeeNo: no, firstName, lastName: 'Reyes', email, hireDate: '2024-01-01', payType: 'monthly', rate: 30000 });
}
async function account(username, role, employeeId) {
  await admin('POST', '/api/users', { name: username === 'ana' ? 'Ana Reyes' : username, username, role, employeeId, password: 'secret123', mustChangePassword: false });
  const c = client();
  await c('POST', '/api/auth/login', { username, password: 'secret123' });
  return c;
}
const ana = await person('E-1', 'Ana', 'ana@company.com');
const ben = await person('E-2', 'Ben', 'ben@company.com');
const asAna = await account('ana', 'employee', ana.id);
const asBen = await account('ben', 'employee', ben.id);
const it = await account('itguy', 'it');
const agent = await account('agent1', 'support');
const payroll = await account('pay', 'payroll');
const users = await admin('GET', '/api/users');
const agentId = users.find((u) => u.username === 'agent1').id;

test('anyone can open a ticket and follow it; agents see the queue', async () => {
  await assert.rejects(asAna('POST', '/api/helpdesk/mine', { subject: 'x', body: 'short', category: 'Hardware' }), /sentence or two/);
  const t = await asAna('POST', '/api/helpdesk/mine', { subject: 'Laptop will not charge', body: 'The charger light is off since this morning.', category: 'Hardware', priority: 'high' });
  assert.equal(t.ref, 'HD-000001');
  assert.equal(t.status, 'new');
  assert.equal(t.requester.email, 'ana@company.com');
  assert.ok(t.firstResponseDue && t.resolutionDue);
  assert.equal((await asAna('GET', '/api/helpdesk/mine')).length, 1);
  assert.equal((await asBen('GET', '/api/helpdesk/mine')).length, 0);
  await assert.rejects(asBen('GET', `/api/helpdesk/mine/${t.id}`), /not found/i);
  for (const c of [asAna, payroll]) await assert.rejects(c('GET', '/api/helpdesk/tickets'), /does not have access/);
  for (const c of [it, agent, admin]) assert.equal((await c('GET', '/api/helpdesk/tickets')).length, 1);
  assert.deepEqual(await agent('GET', '/api/helpdesk/summary'), { new: 1, unassigned: 1, mine: 0, overdue: 0, awaiting: 1, open: 1 });
});

test('agents reply, add internal notes, assign and change status', async () => {
  const [t] = await agent('GET', '/api/helpdesk/tickets');
  await agent('POST', `/api/helpdesk/tickets/${t.id}/messages`, { kind: 'note', body: 'Probably the adapter; we have spares.' });
  let full = await agent('POST', `/api/helpdesk/tickets/${t.id}/messages`, { kind: 'reply', body: 'Please bring it to the IT room at 2 pm.' });
  assert.equal(full.status, 'pending', 'a reply waits on the requester');
  assert.equal(full.assignee.id, agentId, 'the first agent to reply takes the ticket');
  assert.ok(full.firstResponseAt);
  // The requester never sees internal notes or internal history.
  const mine = await asAna('GET', `/api/helpdesk/mine/${t.id}`);
  assert.ok(!mine.messages.some((m) => m.kind === 'note' || /Assigned/.test(m.body)));
  assert.ok(mine.messages.some((m) => m.body === 'Please bring it to the IT room at 2 pm.'));
  // The requester's reply reopens it.
  full = await asAna('POST', `/api/helpdesk/mine/${t.id}/messages`, { body: 'OK, see you then.' });
  assert.equal(full.status, 'open');
  full = await it('PUT', `/api/helpdesk/tickets/${t.id}`, { status: 'resolved', priority: 'urgent' });
  assert.equal(full.status, 'resolved');
  assert.equal(full.priority, 'urgent');
  await assert.rejects(agent('PUT', `/api/helpdesk/tickets/${t.id}`, { assigneeId: users.find((u) => u.username === 'pay').id }), /not a helpdesk agent/);
  await assert.rejects(agent('DELETE', `/api/helpdesk/tickets/${t.id}`), /does not have access/);
});

test('administrators choose which accounts are helpdesk agents', async () => {
  const id = (username) => users.find((u) => u.username === username).id;
  const access = async () => Object.fromEntries((await admin('GET', '/api/helpdesk/agent-access')).map((u) => [u.username, u]));
  await assert.rejects(it('GET', '/api/helpdesk/agent-access'), /does not have access/, 'agents cannot change who is an agent');
  let list = await access();
  assert.deepEqual([list.admin.agent, list.itguy.agent, list.agent1.agent, list.pay.agent], [true, true, true, false]);
  assert.equal(list.admin.locked, true);

  // Grant a payroll officer, remove the IT account.
  await admin('PUT', `/api/helpdesk/agent-access/${id('pay')}`, { access: true });
  list = Object.fromEntries((await admin('PUT', `/api/helpdesk/agent-access/${id('itguy')}`, { access: false })).map((u) => [u.username, u]));
  assert.deepEqual([list.pay.agent, list.pay.override, list.itguy.agent, list.itguy.byRole], [true, true, false, true]);
  assert.ok(Array.isArray(await payroll('GET', '/api/helpdesk/tickets')), 'the granted account works tickets');
  await assert.rejects(it('GET', '/api/helpdesk/tickets'), /does not have access/, 'the removed account no longer can');
  const agentIds = (await admin('GET', '/api/helpdesk/agents')).map((u) => u.id);
  assert.ok(agentIds.includes(id('pay')) && !agentIds.includes(id('itguy')));
  // The browser gets the override with the account, so menus follow it.
  assert.equal((await payroll('GET', '/api/auth/status')).user.helpdeskAgent, true);
  await assert.rejects(admin('PUT', `/api/helpdesk/agent-access/${id('admin')}`, { access: false }), /always have helpdesk access/);

  // Back to the account type: choosing the default clears the override.
  await admin('PUT', `/api/helpdesk/agent-access/${id('itguy')}`, { access: true });
  await admin('PUT', `/api/helpdesk/agent-access/${id('pay')}`, { access: null });
  list = await access();
  assert.deepEqual([list.itguy.override, list.itguy.agent, list.pay.override, list.pay.agent], [null, true, null, false]);
});

test('resolved tickets close automatically after the set days', async () => {
  const t = db.data.tickets[0];
  t.resolvedAt = new Date(Date.now() - 8 * 86400000).toISOString();
  assert.equal(handle.helpdesk.autoClose(), true);
  assert.equal(t.status, 'closed');
  await assert.rejects(asAna('POST', `/api/helpdesk/mine/${t.id}/messages`, { body: 'one more thing' }), /closed/);
});

test('mailbox settings: administrators only, password never sent back or stored in plain text', async () => {
  await assert.rejects(it('GET', '/api/helpdesk/settings'), /does not have access/);
  await assert.rejects(admin('PUT', '/api/helpdesk/settings/mailbox', { address: 'not-an-email' }), /helpdesk email address/);
  await assert.rejects(admin('PUT', '/api/helpdesk/settings/mailbox', { address: 'helpdesk@company.com', enabled: true, host: 'imap.company.com', user: 'helpdesk@company.com' }), /password/);
  const s = await admin('PUT', '/api/helpdesk/settings/mailbox', { address: 'Helpdesk@Company.com', host: 'imap.company.com', port: 993, security: 'tls', user: 'helpdesk@company.com', password: 'super-secret-pw' });
  assert.equal(s.mailbox.address, 'helpdesk@company.com');
  assert.equal(s.mailbox.hasPassword, true);
  assert.ok(!JSON.stringify(s).includes('super-secret-pw'));
  assert.ok(!fs.readFileSync(file, 'utf8').includes('super-secret-pw'), 'sealed in db.json');
  assert.ok(!JSON.stringify(await admin('GET', '/api/admin/export')).includes('super-secret-pw'), 'not in backups');
  // Saving again without a password keeps the stored one.
  assert.equal((await admin('PUT', '/api/helpdesk/settings/mailbox', { ...s.mailbox, password: '' })).mailbox.hasPassword, true);
  assert.equal((await asAna('GET', '/api/helpdesk/info')).mailboxAddress, null, 'not shown to users until receiving is turned on');
});

test('email: new mail opens tickets, replies thread back, and agents reply by email', async () => {
  const pdf = Buffer.from('%PDF-1.4 screenshot of error');
  const imap = await fakeImap({ messages: [
    rawEmail({ from: 'Ana Reyes <ana@company.com>', subject: 'VPN keeps disconnecting', body: 'Since Monday the VPN drops every 10 minutes.', messageId: '<m1@company.com>', attachments: [{ name: 'error.pdf', type: 'application/pdf', data: pdf }, { name: 'tool.exe', type: 'application/octet-stream', data: Buffer.from('MZ...') }] }),
    rawEmail({ from: 'ana@company.com', subject: 'Out of office', body: 'I am away.', messageId: '<ooo@company.com>', headers: ['Auto-Submitted: auto-replied'] }),
    rawEmail({ from: 'IT Service Desk <helpdesk@company.com>', subject: 'loop', body: 'from ourselves', messageId: '<self@company.com>' }),
  ] });
  const smtp = await fakeSmtp();
  handle.helpdesk.setTlsForTests(undefined);
  await admin('PUT', '/api/helpdesk/settings/mailbox', { enabled: true, address: 'helpdesk@company.com', displayName: 'LTDC IT Service Desk', host: '127.0.0.1', port: imap.port, security: 'none', user: 'helpdesk@company.com', password: 'app-pass', pollMinutes: 5, defaultCategory: 'Network and internet' });
  await admin('PUT', '/api/helpdesk/settings/outgoing', { enabled: true, host: '127.0.0.1', port: smtp.port, security: 'none', sameLogin: true });
  assert.match((await admin('POST', '/api/helpdesk/settings/mailbox/test')).message, /3 unread message/);

  let res = await admin('POST', '/api/helpdesk/settings/mailbox/poll');
  assert.equal(res.error, null);
  assert.deepEqual(res.results.map((r) => r.action), ['created', 'skipped', 'skipped']);
  assert.ok(imap.box.messages.every((m) => m.seen), 'everything handled is marked read');
  const t = db.data.tickets.find((x) => x.channel === 'email');
  assert.equal(t.subject, 'VPN keeps disconnecting');
  assert.equal(t.category, 'Network and internet');
  assert.equal(t.requester.userId, users.find((u) => u.username === 'ana').id, 'matched to the employee by email');
  assert.equal(t.messages[0].attachments.length, 1);
  assert.match(t.messages[0].body, /Not imported: tool\.exe/);
  // Acknowledgement went out, threaded with the ticket number.
  assert.equal(smtp.sent.length, 1);
  const ack = parseMessage(smtp.sent[0].raw);
  assert.match(ack.subject, /^\[HD-000002\] VPN keeps disconnecting$/);
  assert.deepEqual(smtp.sent[0].to, ['ana@company.com']);
  // Ana sees it in her portal too.
  assert.ok((await asAna('GET', '/api/helpdesk/mine')).some((x) => x.id === t.id));

  // Ana replies to the acknowledgement: it lands on the same ticket, quoted text removed.
  imap.add(rawEmail({ from: 'ana@company.com', subject: `Re: ${ack.subject}`, inReplyTo: ack.messageId, messageId: '<m2@company.com>', body: `It dropped again at 10:05.\n\nOn Tue, IT Service Desk wrote:\n> ${'##- Please type your reply above this line -##'}\n> old text` }));
  // Someone else quoting the ticket number does not get into Ana's ticket.
  imap.add(rawEmail({ from: 'mallory@elsewhere.net', subject: 'Re: [HD-000002] VPN keeps disconnecting', messageId: '<evil@x>', body: 'Let me in' }));
  // The same message delivered twice is imported once.
  imap.add(rawEmail({ from: 'ana@company.com', subject: `Re: ${ack.subject}`, inReplyTo: ack.messageId, messageId: '<m2@company.com>', body: 'duplicate' }));
  res = await admin('POST', '/api/helpdesk/settings/mailbox/poll');
  assert.deepEqual(res.results.map((r) => r.action), ['replied', 'created', 'skipped']);
  assert.equal(t.messages.filter((m) => m.kind === 'reply').at(-1).body, 'It dropped again at 10:05.');
  assert.equal(db.data.tickets.find((x) => x.requester.email === 'mallory@elsewhere.net').ref, 'HD-000003');

  // An agent's reply is emailed to the requester, threaded.
  const full = await agent('POST', `/api/helpdesk/tickets/${t.id}/messages`, { kind: 'reply', body: 'We pushed a new VPN profile; please restart.' });
  assert.equal(full.messages.find((m) => m.body.startsWith('We pushed')).email.status, 'sent');
  const out = parseMessage(smtp.sent.at(-1).raw);
  assert.equal(out.subject, 'Re: [HD-000002] VPN keeps disconnecting');
  assert.ok(out.references.includes('<m2@company.com>'));
  assert.match(out.text, /We pushed a new VPN profile/);
  // Notes are never emailed.
  const before = smtp.sent.length;
  await agent('POST', `/api/helpdesk/tickets/${t.id}/messages`, { kind: 'note', body: 'internal only' });
  assert.equal(smtp.sent.length, before);

  // Allowed domains: outside senders are ignored.
  await admin('PUT', '/api/helpdesk/settings/mailbox', { ...(await admin('GET', '/api/helpdesk/settings')).mailbox, allowedSenders: 'domains', allowedDomains: 'company.com' });
  imap.add(rawEmail({ from: 'spam@elsewhere.net', subject: 'Cheap watches', messageId: '<spam@x>', body: 'Buy now' }));
  res = await admin('POST', '/api/helpdesk/settings/mailbox/poll');
  assert.equal(res.results[0].action, 'skipped');
  assert.match(res.results[0].reason, /not from an allowed domain/);

  // A wrong password is reported, not thrown away silently.
  await admin('PUT', '/api/helpdesk/settings/mailbox', { ...(await admin('GET', '/api/helpdesk/settings')).mailbox, password: 'wrong' });
  res = await admin('POST', '/api/helpdesk/settings/mailbox/poll');
  assert.match(res.error, /Sign-in to the mailbox failed/);
  assert.match((await admin('GET', '/api/helpdesk/settings')).mailState.lastError, /Invalid credentials/);
  imap.server.close();
  smtp.server.close();
});

test('mail setup survives demo data and erase; tickets do not', async () => {
  await admin('POST', '/api/admin/reset');
  const s = await admin('GET', '/api/helpdesk/settings');
  assert.equal(s.mailbox.address, 'helpdesk@company.com');
  assert.equal(s.mailbox.hasPassword, true);
  assert.equal(db.data.tickets.length, 0);
});
