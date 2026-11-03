// The public complaint and request form (/support): no account needed, tracked by a private link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { parseMessage } from '../server/mail/mime.js';
import { fakeSmtp } from './support/mail-servers.js';

const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ltdc-public-')), 'db.json'));
const handle = createApi(db);
// A visitor coming through the HTTPS proxy from a given address.
const visitor = (ip = '203.0.113.7') => async (method, url, body = {}) =>
  (await handle({ method, headers: { host: 'erp.company.com', 'x-forwarded-for': ip, 'x-forwarded-proto': 'https' }, socket: { remoteAddress: '127.0.0.1' } }, new URL(url, 'http://localhost'), body)).data;
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
const staff = await admin('POST', '/api/employees', { employeeNo: 'E-1', firstName: 'Ana', lastName: 'Reyes', email: 'ana@company.com', hireDate: '2024-01-01', payType: 'monthly', rate: 30000 });
await admin('POST', '/api/users', { name: 'Ana Reyes', username: 'ana', role: 'employee', employeeId: staff.id, password: 'secret123', mustChangePassword: false });
const ana = client();
await ana('POST', '/api/auth/login', { username: 'ana', password: 'secret123' });
const guest = visitor();
const complaint = (extra = {}) => ({ name: 'Pedro Penduko', email: 'Pedro@Customer.ph', phone: '+63 917 555 0101', organization: 'Penduko Trading', category: 'Customer complaint', subject: 'Late delivery of order 1042', message: 'Our order 1042 was promised for Monday and has not arrived.', elapsedMs: 9000, ...extra });

test('the form is off until an administrator turns it on', async () => {
  assert.equal((await guest('GET', '/api/public/helpdesk')).enabled, false);
  await assert.rejects(guest('POST', '/api/public/helpdesk/tickets', complaint()), /not accepting/);
  await assert.rejects(admin('PUT', '/api/helpdesk/settings/public-form', { enabled: true, categories: ['Nope'] }), /at least one category/);
  const s = await admin('PUT', '/api/helpdesk/settings/public-form', { enabled: true, title: 'Customer care', intro: 'Tell us what happened.', categories: ['Customer complaint', 'Other'], requirePhone: false, allowFiles: true });
  assert.equal(s.publicForm.enabled, true);
  const cfg = await guest('GET', '/api/public/helpdesk');
  assert.deepEqual([cfg.enabled, cfg.title, cfg.categories], [true, 'Customer care', ['Customer complaint', 'Other']]);
  assert.ok(!('mailbox' in cfg), 'nothing about the setup is exposed');
});

let token;
test('anyone can send a complaint and follow it with the private link', async () => {
  await assert.rejects(guest('POST', '/api/public/helpdesk/tickets', complaint({ email: 'nope' })), /valid email/);
  await assert.rejects(guest('POST', '/api/public/helpdesk/tickets', complaint({ category: 'Hardware' })), /what your message is about/);
  await assert.rejects(guest('POST', '/api/public/helpdesk/tickets', complaint({ elapsedMs: 300 })), /review your message/);
  const res = await guest('POST', '/api/public/helpdesk/tickets', complaint());
  assert.equal(res.ref, 'HD-000001');
  assert.match(res.trackUrl, /^https:\/\/erp\.company\.com\/support\/t\/[A-Za-z0-9_-]{32}$/, 'a link on the address the visitor used');
  token = res.token;
  const t = db.data.tickets[0];
  assert.deepEqual([t.channel, t.category, t.requester.email, t.requester.external, t.requester.organization], ['web', 'Customer complaint', 'pedro@customer.ph', true, 'Penduko Trading']);

  // Agents work it like any ticket; the visitor sees replies but never internal notes.
  await admin('POST', `/api/helpdesk/tickets/${t.id}/messages`, { kind: 'note', body: 'Courier says the truck broke down.' });
  await admin('POST', `/api/helpdesk/tickets/${t.id}/messages`, { kind: 'reply', body: 'Sorry for the delay. Your order will arrive tomorrow before noon.' });
  let view = await guest('GET', `/api/public/helpdesk/track/${token}`);
  assert.equal(view.status, 'pending');
  assert.ok(view.messages.some((m) => /arrive tomorrow/.test(m.body)));
  assert.ok(!JSON.stringify(view).includes('truck broke down'));
  assert.ok(!('publicToken' in view) && !('assigneeId' in view));
  // The visitor replies on the link: the ticket reopens.
  view = await guest('POST', `/api/public/helpdesk/track/${token}/messages`, { message: 'Thank you, we will wait.' });
  assert.equal(view.status, 'open');
  assert.equal((await admin('GET', `/api/helpdesk/tickets/${t.id}`)).publicUrl, res.trackUrl, 'agents can copy the link for the requester');
  await assert.rejects(guest('GET', '/api/public/helpdesk/track/not-a-real-token-123456789'), /not valid/);
});

test('people from the company are matched to their account', async () => {
  const res = await visitor('198.51.100.9')('POST', '/api/public/helpdesk/tickets', complaint({ name: 'Ana Reyes', email: 'ana@company.com', category: 'Other', subject: 'Parking access card' }));
  const t = db.data.tickets.find((x) => x.ref === res.ref);
  assert.equal(t.requester.external, false);
  assert.ok((await ana('GET', '/api/helpdesk/mine')).some((x) => x.ref === res.ref));
});

test('spam protection: trap field and limits per visitor', async () => {
  const before = db.data.tickets.length;
  const trap = await guest('POST', '/api/public/helpdesk/tickets', complaint({ website: 'http://spam.example' }));
  assert.equal(trap.ref, null);
  assert.equal(db.data.tickets.length, before, 'nothing is created, but the bot is not told');
  const busy = visitor('192.0.2.50');
  for (let i = 0; i < 5; i++) await busy('POST', '/api/public/helpdesk/tickets', complaint({ email: `c${i}@x.ph` }));
  await assert.rejects(busy('POST', '/api/public/helpdesk/tickets', complaint({ email: 'c9@x.ph' })), /several requests/);
  // A forged X-Forwarded-For from outside is ignored: the real address is limited.
  const forged = async (fake) => handle({ method: 'POST', headers: { 'x-forwarded-for': fake }, socket: { remoteAddress: '192.0.2.99' } }, new URL('http://localhost/api/public/helpdesk/tickets'), complaint({ email: `${fake}@x.ph` }));
  for (let i = 0; i < 5; i++) await forged(`10.0.0.${i}`);
  await assert.rejects(forged('10.0.0.200'), /several requests/);
});

test('the confirmation email carries the tracking link', async () => {
  const smtp = await fakeSmtp();
  await admin('PUT', '/api/helpdesk/settings/mailbox', { address: 'care@company.com', displayName: 'Customer Care', host: '127.0.0.1', port: 1, security: 'none', user: 'helpdesk@company.com', password: 'app-pass' });
  await admin('PUT', '/api/helpdesk/settings/outgoing', { enabled: true, host: '127.0.0.1', port: smtp.port, security: 'none', sameLogin: true });
  const res = await visitor('203.0.113.80')('POST', '/api/public/helpdesk/tickets', complaint({ email: 'maria@client.ph', subject: 'Wrong invoice amount' }));
  assert.equal(res.emailed, true);
  const mail = parseMessage(smtp.sent.at(-1).raw);
  assert.equal(mail.subject, `[${res.ref}] Wrong invoice amount`);
  assert.ok(mail.text.includes(res.trackUrl));
  smtp.server.close();
});
