// CUSTOM APP → events: the email outbox (US-023, design A11). The seat email is queued after
// commit() has saved the seat, and sent later, one at a time, outside commit(), through CORE's one
// mail transport (the IT Service Desk's outgoing email). A failed email never touches the seat or the
// check-in; emailPaused queues without sending; Resend is a new attempt. Codes and states are
// asserted, never wording (apart from the headers the AC names).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { company, eventWith, fixture, newCtx, commitAs, USERS, codeOf } from './support/customapp-kit.js';
import { fakeSmtp } from './support/mail-servers.js';
import { parseMessage } from '../server/mail/mime.js';
import { createOutbox, isTransient, OUTBOX } from '../server/customapp/events/outbox.js';
import { createCommitContext } from '../server/customapp/events/commit.js';
import { mailTransport } from '../server/mail/transport.js';

const ROOT = new URL('..', import.meta.url);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// A transport that can send (as if Outgoing email were set up), and a send() that records.
const okTransport = (mailbox = 'helpdesk@company.com') => ({ canSend: () => true, options: () => ({ host: 'mail.test', port: 25 }), mailboxAddress: () => mailbox });
function recorder(fail = () => null) {
  const sent = [];
  const send = async (opts, mail) => {
    const err = fail(sent.length, mail);
    if (err) {
      sent.push({ ...mail, failed: err });
      throw new Error(err);
    }
    sent.push(mail);
  };
  return { sent, send };
}
// An event in memory with the outbox wired as in registerCustomApp.
function world({ guests, flags = { emailPaused: false }, settings = { emailFrom: 'gala@events.example', replyTo: 'rsvp@events.example' }, outbox = {} } = {}) {
  const db = fixture({ tables: [{ n: 1, owner: 'sam' }, { n: 2, owner: 'sam' }], guests, settings, flags });
  const rec = recorder(outbox.fail);
  const ob = createOutbox(db, { transport: outbox.transport || okTransport(), send: rec.send, saveEveryMs: 20, backoffMs: [5, 10, 15], ...outbox });
  const ctx = createCommitContext(db, { now: () => '2026-12-09T11:00:00.000Z', afterCommit: ob.afterCommit });
  const as = (who) => (cmd) => commitAs(ctx, 'ev1', USERS[who], cmd);
  return { db, ob, rec, ctx, lead: as('lead'), sam: as('sam'), g: (ref) => db.data.caGuests.find((x) => x.ref === ref), msgs: () => db.data.caOutbox };
}

describe('US-023: Email outbox', () => {
  test('GIVEN server/helpdesk.js WHEN smtpOptions() and canEmail() are extracted into mailTransport(db) THEN the helpdesk and the outbox use the same transport and the helpdesk tests stay green', async () => {
    const c = await company();
    const hd = c.handle.helpdesk;
    assert.ok(hd.transport, 'the helpdesk exposes its transport');
    assert.equal(c.handle.customapp.outbox.transport, hd.transport, 'the event outbox uses the very same object');
    assert.equal(hd.mailer.transport, hd.transport);
    const src = fs.readFileSync(new URL('server/helpdesk.js', ROOT), 'utf8');
    assert.match(src, /mailTransport\(db, \{ secrets/);
    assert.match(src, /const smtpOptions = \(\) => transport\.options\(\);/);
    assert.match(src, /const canEmail = \(\) => transport\.canSend\(\)/);
    // The transport reads the Service Desk's outgoing settings as they are at each call.
    const db = { data: { helpdesk: { mailbox: { address: 'HD@company.com', user: 'hd', passwordSealed: 'x' }, outgoing: { enabled: true, host: 'smtp.company.com', port: 587, security: 'starttls', sameLogin: true } } } };
    const t = mailTransport(db, { secrets: { open: (s) => (s === 'x' ? 'pw' : '') } });
    assert.deepEqual(t.options(), { host: 'smtp.company.com', port: 587, secure: false, starttls: true, user: 'hd', password: 'pw', tlsOptions: undefined });
    assert.equal(t.canSend(), true);
    assert.equal(t.mailboxAddress(), 'hd@company.com');
    db.data.helpdesk.outgoing.enabled = false;
    assert.equal(t.canSend(), false);
    assert.equal(c.handle.customapp.outbox.transport.canSend(), false, 'no outgoing email set up in a new CORE');
  });

  test('GIVEN a seat confirmed or changed for guests with and without an address WHEN afterCommit runs THEN an assignment or update message is queued after the save with a body from the seat snapshot, and the guest with no address is marked not applicable', () => {
    const w = world({ flags: { emailPaused: true }, guests: [{ ref: 'A', first: 'Maria', last: 'Santos', arrived: true, owner: 'sam' }, { ref: 'B', arrived: true, owner: 'sam', email: '' }, { ref: 'P', cls: 'preferred', owner: 'sam', seat: [1, 9, 'reserved'] }] });
    const atSave = [];
    const save = w.db.save.bind(w.db);
    w.db.save = () => {
      atSave.push(w.msgs().length);
      save();
    };
    w.sam({ type: 'assign', guestId: 'g-A', tableId: 't1', seatNo: 2 });
    assert.deepEqual(atSave, [0], 'the seat was saved before anything was queued');
    assert.equal(w.msgs().length, 1);
    const m = w.msgs()[0];
    assert.deepEqual([m.kind, m.to, m.state, m.attempts, m.guestId], ['assignment', 'A@example.com', 'queued', 0, 'g-A']);
    assert.deepEqual(m.seat, { tableId: 't1', number: 1, seatNo: 2 });
    assert.match(m.body, /Table 1, seat 2/);
    assert.match(m.subject, /^Test Gala: your table \(Table 1, seat 2\)$/);
    assert.equal(w.g('A').notify.state, 'queued');
    // A move: an update, rendered from the new seat; the first message keeps its own snapshot.
    w.sam({ type: 'transfer', guestId: 'g-A', tableId: 't2', seatNo: 5 });
    assert.deepEqual(w.msgs().map((x) => [x.kind, x.seat.number, x.seat.seatNo]), [['assignment', 1, 2], ['update', 2, 5]]);
    assert.match(w.msgs()[0].body, /Table 1, seat 2/, 'a snapshot: never edited afterwards');
    // No address: nothing queued, the notification is not applicable.
    w.sam({ type: 'assign', guestId: 'g-B', tableId: 't1', seatNo: 3 });
    assert.equal(w.msgs().length, 2);
    assert.equal(w.g('B').notify.state, 'not_applicable');
    // A preferred guest's reservation confirmed at check-in is an assignment too.
    w.sam({ type: 'checkIn', guestId: 'g-P' });
    assert.deepEqual(w.msgs().at(-1).kind, 'assignment');
    // The email status never bumps the guest's revision (a screen's revision never goes stale for it).
    const rev = w.g('A').rev;
    w.ob.queueFor(w.db.data.caEvents[0], w.g('A'), 'resend');
    assert.equal(w.g('A').rev, rev);
  });

  test('GIVEN three queued messages and fakeSmtp WHEN the drain runs THEN they are sent one at a time in order, outside commit(), as queued to sending to sent, and status writes are debounced to one save every 2 s', async () => {
    assert.equal(OUTBOX.saveEveryMs, 2000);
    const src = fs.readFileSync(new URL('server/customapp/events/commit.js', ROOT), 'utf8');
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /\bawait\b/, 'commit() awaits nothing: the email is sent outside it');
    // Integration: CORE's helpdesk outgoing email pointed at a fake SMTP server.
    const smtp = await fakeSmtp();
    const c = await company();
    await c.admin('PUT', '/api/helpdesk/settings/mailbox', { enabled: false, address: 'helpdesk@company.com', displayName: 'IT Service Desk', host: '127.0.0.1', port: 993, security: 'none', user: 'helpdesk@company.com', password: 'app-pass', pollMinutes: 5, defaultCategory: 'Other' });
    const o = await c.admin('PUT', '/api/helpdesk/settings/outgoing', { enabled: true, host: '127.0.0.1', port: smtp.port, security: 'none', sameLogin: true });
    assert.ok(o.outgoing?.enabled ?? true, JSON.stringify(o));
    const e = await eventWith(c, { rows: ['A1', 'A2', 'A3'].map((r, i) => [r, `First${i}`, `Last${i}`, 'Acme', '', `${r.toLowerCase()}@guest.example`, `0917 000 000${i}`, 'regular', 'sam', '', '']) });
    let ev = await c.as.lead('GET', e.base);
    ev = await c.as.lead('PATCH', e.base, { rev: ev.rev, settings: { emailFrom: 'gala@events.example', replyTo: 'rsvp@events.example' } });
    await e.cmd('lead', { type: 'setFlag', flag: 'emailPaused', value: false });
    const order = [];
    for (const [i, r] of ['A1', 'A2', 'A3'].entries()) {
      await e.cmd('sam', { type: 'checkIn', guestId: e.guest(r).id });
      const res = await e.cmd('sam', { type: 'assign', guestId: e.guest(r).id, tableId: e.tables[3], seatNo: i + 1 });
      assert.ok(res.ok);
      // The command has answered; the message is queued, not sent yet (sending is outside commit()).
      order.push(c.db.data.caOutbox.find((m) => m.guestId === e.guest(r).id).state);
    }
    assert.deepEqual(order, ['queued', 'queued', 'queued']);
    await c.handle.customapp.outbox.drain();
    assert.deepEqual(smtp.sent.map((m) => m.to[0]), ['a1@guest.example', 'a2@guest.example', 'a3@guest.example'], 'in order');
    assert.deepEqual(c.db.data.caOutbox.map((m) => [m.state, m.attempts]), [['sent', 1], ['sent', 1], ['sent', 1]]);
    assert.deepEqual(['A1', 'A2', 'A3'].map((r) => e.guest(r).notify.state), ['sent', 'sent', 'sent']);
    assert.equal(smtp.sent[0].from, 'gala@events.example');
    smtp.server.close();
    // Debounced status writes and one at a time (capacity 1), with a slow send.
    const w = world({ guests: ['A', 'B', 'C'].map((ref) => ({ ref, arrived: true, owner: 'sam' })), outbox: { send: async () => {} } });
    let busy = 0;
    let most = 0;
    const slow = createOutbox(w.db, { transport: okTransport(), saveEveryMs: 60, send: async () => {
      busy++;
      most = Math.max(most, busy);
      await wait(5);
      busy--;
    } });
    w.ctx.afterCommit = slow.afterCommit;
    for (const [i, r] of ['A', 'B', 'C'].entries()) w.sam({ type: 'assign', guestId: `g-${r}`, tableId: 't1', seatNo: i + 1 });
    const savesBefore = w.db.saves;
    await Promise.all([slow.drain(), slow.drain()]);
    assert.equal(most, 1, 'never two at once');
    assert.equal(w.db.saves, savesBefore, 'status writes wait for the debounce');
    await wait(120);
    assert.equal(w.db.saves - savesBefore, 1, 'one save for all the status writes');
    assert.deepEqual(w.msgs().map((m) => m.state), ['sent', 'sent', 'sent']);
  });

  test('GIVEN fakeSmtp failing transiently and then permanently WHEN a message is drained THEN it is retried three times with backoff and seat and arrival are untouched', async () => {
    assert.equal(isTransient(new Error('MAIL FROM failed: 451 try later')), true);
    assert.equal(isTransient(new Error('The mail server did not respond in time.')), true);
    assert.equal(isTransient(new Error('RCPT TO failed: 550 no such user')), false);
    const w = world({ guests: [{ ref: 'A', arrived: true, owner: 'sam' }, { ref: 'B', arrived: true, owner: 'sam' }], outbox: { fail: () => 'MAIL FROM failed: 451 greylisted' } });
    w.sam({ type: 'assign', guestId: 'g-A', tableId: 't1', seatNo: 1 });
    const seat = JSON.stringify(w.g('A').seat);
    const arrival = JSON.stringify(w.g('A').arrival);
    const nexts = [];
    for (let i = 0; i < 6; i++) {
      await w.ob.drain();
      if (w.msgs()[0].nextAt) nexts.push(Date.parse(w.msgs()[0].nextAt) - Date.now());
      await wait(30);
    }
    const m = w.msgs()[0];
    assert.equal(w.rec.sent.length, 4, 'the first try and three retries');
    assert.deepEqual([m.state, m.attempts], ['failed', 4]);
    assert.match(m.lastError, /451/);
    assert.ok(nexts.length >= 2 && nexts[1] > nexts[0] - 5, `waiting longer each time (${nexts})`);
    assert.equal(JSON.stringify(w.g('A').seat), seat, 'the seat is untouched');
    assert.equal(JSON.stringify(w.g('A').arrival), arrival, 'the check-in is untouched');
    assert.equal(w.g('A').notify.state, 'failed');
    // A permanent failure (5xx) is not retried.
    const p = world({ guests: [{ ref: 'A', arrived: true, owner: 'sam' }], outbox: { fail: () => 'RCPT TO failed: 550 mailbox unavailable' } });
    p.sam({ type: 'assign', guestId: 'g-A', tableId: 't1', seatNo: 1 });
    await p.ob.drain();
    assert.deepEqual([p.msgs()[0].state, p.msgs()[0].attempts, p.rec.sent.length], ['failed', 1, 1]);
    assert.equal(p.g('A').seat.status, 'confirmed');
  });

  test('GIVEN a failed message WHEN staff press Resend THEN a notify command creates a new attempt', async () => {
    const w = world({ guests: [{ ref: 'A', arrived: true, owner: 'sam' }, { ref: 'B', arrived: true, owner: 'tess' }], outbox: { fail: (n) => (n === 0 ? 'RCPT TO failed: 550 full' : null) } });
    w.sam({ type: 'assign', guestId: 'g-A', tableId: 't1', seatNo: 1 });
    await w.ob.drain();
    assert.equal(w.msgs()[0].state, 'failed');
    const seq = w.db.data.caEvents[0].seq;
    const r = w.sam({ type: 'notify', guestId: 'g-A' });
    assert.equal(w.db.data.caEvents[0].seq, seq + 1, 'a command, through commit()');
    assert.equal(w.db.data.caChanges.at(-1).type, 'notify');
    assert.equal(w.msgs().length, 2, 'a new message: the failed one is kept as it was');
    assert.deepEqual([w.msgs()[1].id, w.msgs()[1].kind, w.msgs()[1].state, w.msgs()[1].attempts], [r.messageId, 'resend', 'queued', 0]);
    await w.ob.drain();
    assert.deepEqual(w.msgs().map((m) => m.state), ['failed', 'sent']);
    assert.equal(w.g('A').notify.state, 'sent');
    assert.equal(codeOf(() => w.sam({ type: 'notify', guestId: 'g-B' })), 'out_of_scope', 'the guest\'s owner or the Super Administrator');
    assert.equal(codeOf(() => w.lead({ type: 'notify', guestId: 'g-B' })), 'guest_moved', 'a guest with no confirmed seat has nothing to send');
    // Through the API: the guest sheet offers Resend while email is on.
    const c = await company();
    const e = await eventWith(c, { rows: [['A1', 'Ana', 'Cruz', 'Acme', '', 'ana@guest.example', '0917 000 0001', 'regular', 'sam', '', '']] });
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('A1').id });
    await e.cmd('sam', { type: 'assign', guestId: e.guest('A1').id, tableId: e.tables[3], seatNo: 1 });
    let sheet = await c.as.sam('GET', `${e.base}/guests/${e.guest('A1').id}`);
    assert.deepEqual(sheet.email, { paused: true }, 'email paused (the default): the email parts are hidden');
    await e.cmd('lead', { type: 'setFlag', flag: 'emailPaused', value: false });
    sheet = await c.as.sam('GET', `${e.base}/guests/${e.guest('A1').id}`);
    assert.equal(sheet.email.canResend, true);
    assert.ok((await e.cmd('sam', { type: 'notify', guestId: e.guest('A1').id })).ok);
    assert.equal(c.db.data.caOutbox.filter((m) => m.guestId === e.guest('A1').id).length, 2);
  });

  test('GIVEN emailPaused true WHEN seats are confirmed THEN messages are queued and none is sent', async () => {
    const w = world({ flags: { emailPaused: true }, guests: ['A', 'B'].map((ref) => ({ ref, arrived: true, owner: 'sam' })) });
    w.sam({ type: 'assign', guestId: 'g-A', tableId: 't1', seatNo: 1 });
    w.sam({ type: 'assign', guestId: 'g-B', tableId: 't1', seatNo: 2 });
    await w.ob.drain();
    assert.deepEqual(w.msgs().map((m) => m.state), ['queued', 'queued']);
    assert.equal(w.rec.sent.length, 0);
    // Turned back on: they go.
    w.lead({ type: 'setFlag', flag: 'emailPaused', value: false });
    await w.ob.drain();
    assert.deepEqual(w.msgs().map((m) => m.state), ['sent', 'sent']);
    assert.equal(w.rec.sent.length, 2);
    // A new event starts paused.
    const c = await company();
    const e = await eventWith(c);
    assert.equal((await c.as.lead('GET', e.base)).flags.emailPaused, true);
  });

  test('GIVEN a message left in sending for 3 minutes WHEN the server restarts THEN it is queued again', () => {
    const w = world({ guests: [{ ref: 'A', arrived: true, owner: 'sam' }, { ref: 'B', arrived: true, owner: 'sam' }] });
    const now = Date.parse('2026-12-09T11:00:00.000Z');
    w.db.data.caOutbox.push(
      { id: 'm1', eventId: 'ev1', guestId: 'g-A', kind: 'assignment', to: 'a@x.example', subject: 's', body: 'b', state: 'sending', attempts: 1, sendingAt: new Date(now - 3 * 60000).toISOString(), createdAt: new Date(now - 4 * 60000).toISOString() },
      { id: 'm2', eventId: 'ev1', guestId: 'g-B', kind: 'assignment', to: 'b@x.example', subject: 's', body: 'b', state: 'sending', attempts: 1, sendingAt: new Date(now - 60000).toISOString(), createdAt: new Date(now - 90000).toISOString() },
    );
    // The process after a restart: a new outbox over the same data.
    const after = createOutbox(w.db, { transport: okTransport(), now: () => now, send: async () => {} });
    assert.equal(OUTBOX.staleSendingMs, 120000);
    assert.equal(after.requeueStale(), 1);
    assert.deepEqual(w.msgs().map((m) => [m.id, m.state]), [['m1', 'queued'], ['m2', 'sending']], 'more than 2 minutes in sending: queued again; under 2 minutes: left for now');
    const later = createOutbox(w.db, { transport: okTransport(), now: () => now + 2 * 60000, send: async () => {} });
    assert.equal(later.requeueStale(), 1, 'its turn comes once it is 2 minutes old');
  });

  test('GIVEN an event with emailFrom and replyTo and a guest named José Ñúñez WHEN the message is composed THEN it uses the event\'s From and Reply-To, never the helpdesk mailbox, and the name is an encoded word', async () => {
    const w = world({ guests: [{ ref: 'J', first: 'José', last: 'Ñúñez', arrived: true, owner: 'sam' }] });
    w.sam({ type: 'assign', guestId: 'g-J', tableId: 't1', seatNo: 4 });
    await w.ob.drain();
    const raw = w.rec.sent[0].raw;
    const head = raw.slice(0, raw.indexOf('\r\n\r\n'));
    assert.match(head, /^From: "Test Gala" <gala@events\.example>$/m);
    assert.match(head, /^Reply-To: "Test Gala" <rsvp@events\.example>$/m);
    assert.match(head, /^To: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <J@example\.com>$/m, 'the name as an encoded word');
    assert.equal(Buffer.from(head.match(/^To: =\?UTF-8\?B\?([^?]+)\?=/m)[1], 'base64').toString(), 'José Ñúñez');
    assert.doesNotMatch(head, /helpdesk@company\.com/);
    assert.equal(w.rec.sent[0].from, 'gala@events.example', 'the envelope too');
    assert.match(parseMessage(raw).text, /Table 1, seat 4/);
    // The helpdesk mailbox as From: refused when set, and never used if it got there.
    const h = world({ guests: [{ ref: 'A', arrived: true, owner: 'sam' }], settings: { emailFrom: 'helpdesk@company.com' } });
    h.sam({ type: 'assign', guestId: 'g-A', tableId: 't1', seatNo: 1 });
    await h.ob.drain();
    assert.deepEqual([h.msgs()[0].state, h.rec.sent.length], ['failed', 0]);
    const c = await company();
    await c.admin('PUT', '/api/helpdesk/settings/mailbox', { enabled: false, address: 'helpdesk@company.com', displayName: 'IT Service Desk', host: '127.0.0.1', port: 993, security: 'none', user: 'helpdesk@company.com', password: 'app-pass', pollMinutes: 5, defaultCategory: 'Other' });
    const e = await eventWith(c);
    const ev = await c.as.lead('GET', e.base);
    const r = await c.as.lead('PATCH', e.base, { rev: ev.rev, settings: { emailFrom: 'Helpdesk@Company.com' } });
    assert.equal(r.status, 400, 'the event cannot send as the helpdesk mailbox');
    assert.equal((await c.as.lead('PATCH', e.base, { rev: ev.rev, settings: { emailFrom: 'not an address' } })).status, 400);
    assert.equal((await c.as.lead('PATCH', e.base, { rev: ev.rev, settings: { emailFrom: 'gala@events.example', replyTo: 'rsvp@events.example' } })).settings.emailFrom, 'gala@events.example');
  });
});
