// CUSTOM APP → events: personal invitations, the guest's reply with the seat reserved at once on Yes,
// and the door check-in by the same link (0.74). Refusal codes and states are asserted, never the
// wording (apart from what a guest must be told: the table and the seat).
process.env.CUSTOMAPP_VERIFY_PAD_MS = '0';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { company, eventWith, openForGuests, pub, fixture, newCtx, commitAs, USERS, codeOf } from './support/customapp-kit.js';
import { fakeSmtp } from './support/mail-servers.js';
import { parseMessage } from '../server/mail/mime.js';
import { composeMessage } from '../server/mail/compose.js';
import { inviteHashOf } from '../server/customapp/events/model.js';
import { exceptionsOf } from '../server/customapp/events/board.js';
import { checkInvariants } from '../shared/customapp/invariants.js';
import { claimsAt } from '../shared/customapp/seating.js';
import { RSVP_ACTOR } from '../shared/customapp/statuses.js';
import { qrPng } from '../server/customapp/qr.js';
import { eventExport } from '../server/customapp/events/io.js';
import { createOutbox } from '../server/customapp/events/outbox.js';
import { createCommitContext } from '../server/customapp/events/commit.js';

const ROOT = new URL('..', import.meta.url);
const tok = (n) => `tok${String(n)}`.padEnd(43, 'x');
const stateOfFixture = (db) => ({ event: db.data.caEvents[0], tables: db.data.caTables, guests: db.data.caGuests });

// ----- Pure: the rsvp command through commit(), in memory -----
function world({ tables, guests, settings = {}, flags = {} }) {
  const db = fixture({ tables, guests, settings: { autoSeatOnConfirm: true, ...settings }, flags });
  for (const [i, g] of db.data.caGuests.entries()) g.invite = { hash: inviteHashOf(tok(i)), state: 'sent', base: 'https://ltdc-core.com', messageId: null };
  let now = '2026-12-01T03:00:00.000Z';
  const ctx = newCtx(db, () => now);
  const idx = (ref) => db.data.caGuests.findIndex((g) => g.ref === ref);
  return {
    db, ctx, setNow: (t) => (now = t),
    g: (ref) => db.data.caGuests.find((x) => x.ref === ref),
    reply: (ref, answer, extra = {}) => commitAs(ctx, 'ev1', { synthetic: 'rsvp' }, { type: 'rsvp', guestId: `g-${ref}`, answer, inviteHash: inviteHashOf(tok(idx(ref))), ...extra }),
    as: (who, cmd) => commitAs(ctx, 'ev1', USERS[who], cmd),
    rules: () => checkInvariants(stateOfFixture(db)),
  };
}

describe('Seat on confirmation: the rsvp command', () => {
  test('GIVEN a regular guest WHEN they say Yes THEN they get the top recommended table and its lowest open chair as a reservation, by the system actor, counted by claimsAt, owners unchanged', () => {
    const w = world({
      tables: [{ n: 1, cls: 'preferred' }, { n: 3, owner: 'sam', cap: 4 }, { n: 4, owner: 'tess', cap: 4 }],
      guests: [{ ref: 'A', owner: 'tess' }, { ref: 'B', owner: 'sam', seat: [3, 1, 'reserved'] }, { ref: 'C', owner: 'sam', seat: [3, 2, 'reserved'] }],
    });
    // Same industry beats an empty table (recommend()'s tier 1).
    w.db.data.caEvents[0].industries = [{ id: 'bank', name: 'Banking', related: [] }];
    for (const r of ['A', 'B']) w.g(r).industryId = 'bank';
    const r = w.reply('A', 'yes');
    assert.equal(r.outcome, 'seated');
    const a = w.g('A');
    assert.deepEqual([a.seat.tableId, a.seat.seatNo, a.seat.status, a.seat.via, a.seat.by], ['t3', 3, 'reserved', 'rsvp', RSVP_ACTOR]);
    assert.equal(a.arrival.state, 'expected', 'confirmed to attend, not checked in');
    assert.deepEqual([a.rsvp, a.rsvpReply.answer, a.rsvpReply.via], ['yes', 'yes', 'link']);
    assert.equal(a.ownerUserId, USERS.tess.id, 'the guest keeps their owner; the seat is a system action');
    assert.equal(claimsAt('t3', w.db.data.caGuests), 3);
    const ch = w.db.data.caChanges.at(-1);
    assert.deepEqual([ch.type, ch.actorId, ch.via], ['rsvp', RSVP_ACTOR, 'invite']);
    assert.deepEqual(w.rules(), []);
  });

  test('GIVEN a Yes WHEN Yes again, then No, then Yes THEN nothing is written twice, No releases the seat its Yes made, and Yes seats again without ever holding two chairs', () => {
    const w = world({ tables: [{ n: 3, cap: 2 }, { n: 4, cap: 2 }], guests: [{ ref: 'A' }] });
    w.reply('A', 'yes');
    const seq = w.db.data.caEvents[0].seq;
    assert.equal(w.reply('A', 'yes').unchanged, true);
    assert.equal(w.db.data.caEvents[0].seq, seq, 'a double tap writes nothing');
    assert.equal(w.reply('A', 'no').outcome, 'released');
    assert.equal(w.g('A').seat, null);
    assert.equal(w.g('A').rsvp, 'no');
    assert.equal(w.reply('A', 'yes').outcome, 'seated');
    assert.equal(w.db.data.caGuests.filter((g) => g.seat).length, 1);
    assert.deepEqual(w.rules(), []);
  });

  test('GIVEN a preferred guest with a reserved chair WHEN they say Yes and then No THEN the reservation is kept both times (never released by the system) and the No is flagged for the Super Administrator, who releases it by hand', () => {
    const w = world({ tables: [{ n: 1, cls: 'preferred' }, { n: 3 }], guests: [{ ref: 'P', cls: 'preferred', seat: [1, 4, 'reserved'] }, { ref: 'Q', cls: 'preferred' }] });
    assert.equal(w.reply('P', 'yes').outcome, 'kept');
    assert.deepEqual([w.g('P').seat.tableId, w.g('P').seat.seatNo, w.g('P').seat.status, w.g('P').arrival.state], ['t1', 4, 'reserved', 'expected']);
    assert.equal(w.reply('P', 'no').outcome, 'kept_flagged');
    assert.deepEqual([w.g('P').seat.tableId, w.g('P').seat.seatNo], ['t1', 4], 'a preferred reservation is never auto-released');
    assert.ok(w.g('P').flags.some((f) => f.kind === 'rsvp_no_with_seat'));
    // A preferred guest without a reservation is not placed by the system: they wait for the Super Administrator.
    assert.equal(w.reply('Q', 'yes').outcome, 'preferred_waiting');
    assert.equal(w.g('Q').seat, null);
    const kinds = exceptionsOf(stateOfFixture(w.db)).map((x) => `${x.kind}:${x.guestIds[0]}`);
    assert.ok(kinds.includes('rsvp_no_reserved:g-P') && kinds.includes('rsvp_no_seat:g-Q'), kinds.join(' '));
    w.as('lead', { type: 'release', guestId: 'g-P', reason: 'Said no' });
    assert.equal(w.g('P').seat, null);
    // Yes again clears the flag.
    w.reply('P', 'yes');
    assert.ok(!(w.g('P').flags || []).some((f) => f.kind === 'rsvp_no_with_seat'));
  });

  test('GIVEN 3 chairs for regular guests WHEN 5 say Yes THEN 3 are seated, 2 are told their table follows and appear in the exceptions inbox, and no table is ever over its chairs', () => {
    const w = world({ tables: [{ n: 1, cls: 'preferred' }, { n: 3, cap: 2 }, { n: 4, cap: 1 }, { n: 6, cls: 'employee' }], guests: ['A', 'B', 'C', 'D', 'E'].map((ref) => ({ ref })) });
    const out = ['A', 'B', 'C', 'D', 'E'].map((r) => w.reply(r, 'yes').outcome);
    assert.deepEqual(out, ['seated', 'seated', 'seated', 'no_seat', 'no_seat']);
    assert.equal(claimsAt('t3', w.db.data.caGuests), 2);
    assert.equal(claimsAt('t4', w.db.data.caGuests), 1);
    assert.equal(w.db.data.caGuests.filter((g) => g.seat).length, 3);
    assert.deepEqual(exceptionsOf(stateOfFixture(w.db)).filter((x) => x.kind === 'rsvp_no_seat').map((x) => x.guestIds[0]), ['g-D', 'g-E']);
    // A No frees a chair; the next Yes (or the Super Administrator) takes it.
    w.reply('A', 'no');
    assert.equal(w.reply('D', 'yes').outcome, 'seated');
    assert.deepEqual(w.rules(), []);
  });

  test('GIVEN seating on Yes off, a revoked link, the deadline passed, a checked-in guest and a staff account WHEN they reply THEN no seat, a 400, rsvp_closed, already_checked_in, and the system actor can only reply', () => {
    const off = world({ tables: [{ n: 3 }], guests: [{ ref: 'A' }], settings: { autoSeatOnConfirm: false } });
    assert.equal(off.reply('A', 'yes').outcome, 'manual');
    assert.equal(off.g('A').seat, null);
    const w = world({ tables: [{ n: 3 }], guests: [{ ref: 'A' }, { ref: 'B', arrived: true }, { ref: 'C' }], settings: { invitation: { rsvpDeadline: '2026-12-05T15:59:00.000Z' } } });
    w.g('A').invite = { ...w.g('A').invite, hash: inviteHashOf('another-link'.padEnd(43, 'y')) };
    assert.equal(codeOf(() => w.reply('A', 'yes')), 'http400', 'a link that is no longer the guest\'s');
    assert.equal(codeOf(() => w.reply('B', 'yes')), 'already_checked_in');
    w.setNow('2026-12-06T00:00:00.000Z');
    assert.equal(codeOf(() => w.reply('C', 'yes')), 'rsvp_closed');
    // The Super Administrator can still record an answer given another way; staff cannot.
    assert.equal(w.as('lead', { type: 'rsvp', guestId: 'g-C', answer: 'yes' }).outcome, 'seated');
    assert.equal(codeOf(() => w.as('sam', { type: 'rsvp', guestId: 'g-C', answer: 'no' })), 'needs_super_admin');
    assert.equal(codeOf(() => commitAs(w.ctx, 'ev1', { synthetic: 'rsvp' }, { type: 'assign', guestId: 'g-C', tableId: 't3', seatNo: 9 })), 'http400');
    assert.equal(codeOf(() => w.as('lead', { type: 'inviteOpened', guestId: 'g-C' })), 'http400');
  });

  test('GIVEN a Yes with an email address WHEN committed THEN the reply email is queued by the command itself with the seat snapshot, and with the link sealed only when the request carried it', () => {
    const w = world({ tables: [{ n: 3 }], guests: [{ ref: 'A', first: 'Maria' }, { ref: 'B', email: '' }] });
    w.reply('A', 'yes', { tokenSealed: 'mem:sealed' });
    const m = w.db.data.caOutbox.at(-1);
    assert.deepEqual([m.kind, m.guestId, m.state, m.tokenSealed, m.linkBase], ['rsvp', 'g-A', 'queued', 'mem:sealed', 'https://ltdc-core.com']);
    assert.deepEqual(m.seat, { tableId: 't3', number: 3, seatNo: 1 });
    assert.match(m.body, /Table 3, seat 1/);
    assert.equal(w.g('A').notify.state, 'queued');
    w.reply('B', 'yes');
    assert.equal(w.db.data.caOutbox.length, 1, 'no address, no email');
  });
});

// ----- Inline pictures in email -----
describe('Email with an inline picture (multipart/related)', () => {
  test('GIVEN text, HTML and an inline PNG WHEN composed THEN it is multipart/related holding multipart/alternative (text first) and the image part with its Content-ID, and existing callers are unchanged', () => {
    const png = qrPng('https://ltdc-core.com');
    const raw = composeMessage({ from: { name: 'Gala', email: 'events@ltdc-core.com' }, to: [{ name: 'Ana Ñ', email: 'ana@example.com' }], subject: 'Invitation', text: 'Hello\nLink: https://x', html: '<p>Hello</p><img src="cid:qr.1@ltdc-core.com">', inline: [{ cid: 'qr.1@ltdc-core.com', type: 'image/png', name: 'qr-code.png', data: png }], messageId: '<m@ltdc-core.com>' });
    const head = raw.slice(0, raw.indexOf('\r\n\r\n'));
    assert.match(head, /^Content-Type: multipart\/related; boundary="core-rel-[^"]+"; type="multipart\/alternative"$/m);
    const body = raw.slice(raw.indexOf('\r\n\r\n'));
    const iAlt = body.indexOf('Content-Type: multipart/alternative');
    const iText = body.indexOf('Content-Type: text/plain');
    const iHtml = body.indexOf('Content-Type: text/html');
    const iImg = body.indexOf('Content-Type: image/png');
    assert.ok(iAlt > 0 && iAlt < iText && iText < iHtml && iHtml < iImg, 'related → alternative(text, html) → image');
    assert.match(body, /Content-ID: <qr\.1@ltdc-core\.com>\r\nContent-Disposition: inline; filename="qr-code\.png"/);
    const msg = parseMessage(raw);
    assert.equal(msg.text, 'Hello\nLink: https://x');
    assert.equal(msg.attachments.length, 1);
    assert.deepEqual(msg.attachments[0].data, png);
    assert.doesNotMatch(raw, /data:image/);
    // Without pictures: exactly as before (alternative, or plain text).
    const alt = composeMessage({ from: { email: 'a@b.c' }, to: [{ email: 'd@e.f' }], subject: 's', text: 't', html: '<p>t</p>', messageId: '<x@b.c>' });
    assert.match(alt, /^Content-Type: multipart\/alternative; boundary="core-[^"]+"$/m);
    assert.doesNotMatch(alt, /multipart\/related/);
    const plain = composeMessage({ from: { email: 'a@b.c' }, to: [{ email: 'd@e.f' }], subject: 's', text: 't', inline: [{ cid: 'x', data: png }], messageId: '<x@b.c>' });
    assert.match(plain, /^Content-Type: text\/plain; charset=utf-8$/m, 'no HTML: plain text, pictures ignored');
  });
});

// ----- Through CORE: send, open, reply, door -----
const ROWS = [
  ['A1', 'Ana', 'Dela Cruz', 'Northbay Bank', 'Banking', 'ana@guest.example', '0917 111 0001', 'regular', 'sam', '', ''],
  ['A2', 'Ben', 'Reyes', 'Palengke', 'Retail', 'ben@guest.example', '0917 111 0002', 'regular', 'tess', '', ''],
  ['A3', 'Cora', 'Lim', 'Palengke', 'Retail', 'cora@guest.example', '0917 111 0003', 'regular', '', '', ''],
  ['P1', 'Maria', 'Santos', 'Northbay Bank', 'Banking', 'maria@guest.example', '0917 111 0004', 'preferred', '', '1', '4'],
  ['N1', 'No', 'Email', 'Acme', '', '', '0917 111 0005', 'regular', '', '', ''],
];
async function setup({ paused = true } = {}) {
  const smtp = await fakeSmtp();
  const c = await company();
  await c.admin('PUT', '/api/helpdesk/settings/mailbox', { enabled: false, address: 'helpdesk@company.com', displayName: 'IT Service Desk', host: '127.0.0.1', port: 993, security: 'none', user: 'helpdesk@company.com', password: 'app-pass', pollMinutes: 5, defaultCategory: 'Other' });
  await c.admin('PUT', '/api/helpdesk/settings/outgoing', { enabled: true, host: '127.0.0.1', port: smtp.port, security: 'none', sameLogin: true });
  const e = await eventWith(c, { rows: ROWS });
  let ev = await c.as.lead('GET', e.base);
  ev = await c.as.lead('PATCH', e.base, { rev: ev.rev, status: 'live', settings: { emailFrom: 'events@ltdc-core.com', replyTo: 'rsvp@ltdc-core.com', autoSeatOnConfirm: true, invitation: { subject: 'You are invited', intro: 'Join us.', dressCode: 'Cocktail', time: '6:00 PM' } } });
  if (!paused) await e.cmd('lead', { type: 'setFlag', flag: 'emailPaused', value: false });
  const lead = (method, path, body) => c.as.lead(method, `${e.base}${path}`, body);
  const linkOf = (raw) => parseMessage(raw).text.match(/https?:\/\/\S+#i=[A-Za-z0-9_-]{43}/)?.[0];
  const tokenOf = (link) => link.split('#i=')[1];
  const as = (token) => ({ 'x-event-invite': token });
  const open = (token) => pub(c, 'GET', `/api/public/event/${ev.code}/invite`, {}, { headers: as(token) });
  const reply = (token, answer) => pub(c, 'POST', `/api/public/event/${ev.code}/rsvp`, { answer }, { headers: as(token) });
  const door = (token) => pub(c, 'POST', `/api/public/event/${ev.code}/checkin`, {}, { headers: as(token) });
  const drain = () => c.handle.customapp.outbox.drain();
  const sentTo = (addr) => smtp.sent.filter((m) => m.to.includes(addr));
  return { c, e, ev, smtp, lead, linkOf, tokenOf, open, reply, door, drain, sentTo, done: () => smtp.server.close() };
}

describe('Invitations through CORE', () => {
  test('GIVEN guests with and without an address WHEN Send invitations runs with email paused, then on THEN each guest with an address gets a queued invitation, those without are listed, counts move from queued to sent, and the email has the link as text, a button and an inline QR code of that same link', async () => {
    const t = await setup();
    try {
      const o = await t.lead('GET', '/invitations', undefined);
      assert.deepEqual(o.warnings.filter((w) => w.level === 'block'), []);
      assert.ok(o.warnings.some((w) => w.code === 'paused'));
      assert.equal(o.linkBase, 'http://localhost', 'the address CORE was reached on (https://ltdc-core.com in production)');
      assert.ok(o.warnings.some((w) => w.code === 'local_link'));
      assert.deepEqual(o.guests.filter((g) => !g.hasEmail).map((g) => g.ref), ['TG-0005']);
      const r = await t.lead('POST', '/invitations/send', {});
      assert.ok(r.ok, JSON.stringify(r));
      assert.deepEqual([r.queued, r.counts.queued, r.counts.sent, r.counts.noEmail, r.counts.notInvited], [4, 4, 0, 1, 0]);
      await t.drain();
      assert.equal(t.smtp.sent.length, 0, 'email paused: nothing goes');
      // Only the hash is stored; the token is sealed in the outbox until it is sent, and no export carries either.
      const g1 = t.e.guest('A1');
      assert.match(g1.invite.hash, /^[0-9a-f]{64}$/);
      const m1 = t.c.db.data.caOutbox.find((m) => m.guestId === g1.id && m.kind === 'invitation');
      assert.match(m1.tokenSealed, /^v1:/);
      const exp = JSON.stringify(eventExport(t.c.db, t.c.db.data.caEvents[0], new Date().toISOString()));
      assert.ok(!exp.includes(g1.invite.hash) && !exp.includes('tokenSealed') && !exp.includes(m1.tokenSealed));
      await t.e.cmd('lead', { type: 'setFlag', flag: 'emailPaused', value: false });
      await t.drain();
      assert.equal(t.smtp.sent.length, 4);
      assert.ok(!t.c.db.data.caOutbox.some((m) => m.tokenSealed), 'the sealed tokens are gone once sent');
      const after = await t.lead('GET', '/invitations', undefined);
      assert.deepEqual([after.counts.queued, after.counts.sent, after.counts.failed, after.counts.noReply], [0, 4, 0, 4]);
      const mail = t.sentTo('ana@guest.example')[0];
      assert.equal(mail.from, 'events@ltdc-core.com');
      const msg = parseMessage(mail.raw);
      assert.equal(msg.subject, 'You are invited');
      const link = t.linkOf(mail.raw);
      assert.match(link, /^http:\/\/localhost\/event\/test-gala-[a-z0-9]+#i=[A-Za-z0-9_-]{43}$/);
      assert.equal(inviteHashOf(t.tokenOf(link)), t.e.guest('A1').invite.hash);
      assert.ok(!JSON.stringify(t.c.db.data).includes(t.tokenOf(link)), 'the token itself is nowhere in the data');
      assert.match(mail.raw, /multipart\/related/);
      assert.equal(msg.attachments.length, 1);
      assert.deepEqual(msg.attachments[0].data, qrPng(link, { scale: 6 }), 'the QR code encodes the personal link');
      const html = mail.raw.match(/Content-Type: text\/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/)[1];
      const htmlText = Buffer.from(html.replace(/\s+/g, ''), 'base64').toString('utf8');
      assert.match(htmlText, /<img src="cid:qr\.[^"]+"/);
      assert.ok(htmlText.includes(`href="${link}"`));
      assert.equal(t.e.guest('A1').invite.state, 'sent');
      // Nobody left to invite: Send again needs a choice.
      assert.equal((await t.lead('POST', '/invitations/send', {})).status, 400);
    } finally {
      t.done();
    }
  });

  test('GIVEN a sent invitation WHEN the guest opens it and says Yes THEN Opened then Yes are recorded, the seat is reserved at once, the reply email gives the table and seat with the same QR code, and Find guest filters by RSVP', async () => {
    const t = await setup({ paused: false });
    try {
      await t.lead('POST', '/invitations/send', {});
      await t.drain();
      const link = t.linkOf(t.sentTo('ana@guest.example')[0].raw);
      const token = t.tokenOf(link);
      const v = await t.open(token);
      assert.equal(v.body.state, 'invite');
      assert.deepEqual([v.body.guest.name, v.body.rsvp, v.body.canAnswer, v.body.seat], ['Ana Dela Cruz', null, true, null]);
      assert.ok(v.body.event.details.some((l) => /Dress code: Cocktail/.test(l)));
      assert.equal(v.headers['Cache-Control'], 'no-store');
      assert.ok(t.e.guest('A1').invite.openedAt);
      assert.equal((await t.lead('GET', '/invitations', undefined)).counts.opened, 1);
      const yes = await t.reply(token, 'yes');
      assert.equal(yes.body.rsvp, 'yes');
      assert.equal(yes.body.seat.status, 'reserved');
      const a1 = t.e.guest('A1');
      assert.deepEqual([a1.seat.status, a1.seat.via, a1.arrival.state], ['reserved', 'rsvp', 'expected']);
      assert.equal(yes.body.seat.table, t.c.db.data.caTables.find((x) => x.id === a1.seat.tableId).number);
      await t.drain();
      const reply = t.sentTo('ana@guest.example').at(-1);
      const text = parseMessage(reply.raw).text;
      assert.match(text, new RegExp(`Table ${yes.body.seat.table}, seat ${yes.body.seat.seat}`));
      assert.equal(t.linkOf(reply.raw), link, 'the same personal link');
      assert.deepEqual(parseMessage(reply.raw).attachments[0].data, qrPng(link, { scale: 6 }));
      // Staff: the RSVP filter and the history's actor.
      const found = await t.c.as.lead('GET', `${t.e.base}/guests?rsvp=yes`);
      assert.deepEqual(found.guests.map((g) => g.ref), [a1.ref]);
      assert.equal(found.guests[0].rsvpStatus, 'yes');
      const sheet = await t.c.as.lead('GET', `${t.e.base}/guests/${a1.id}`);
      assert.equal(sheet.history[0].by, 'The guest\'s invitation link');
      const noReply = await t.c.as.lead('GET', `${t.e.base}/guests?rsvp=noreply`);
      assert.equal(noReply.total, 3);
      // The room plan shows the chair as reserved, and as the guest's own Yes.
      const room = await t.c.as.lead('GET', `${t.e.base}/room`);
      const chair = room.tables.flatMap((x) => x.chairs).find((x) => x.guestId === a1.id);
      assert.deepEqual([chair.status, chair.rsvp], ['reserved', true]);
      // No: the seat its Yes made is released.
      const no = await t.reply(token, 'no');
      assert.deepEqual([no.body.rsvp, no.body.seat], ['no', null]);
      assert.equal(t.e.guest('A1').seat, null);
    } finally {
      t.done();
    }
  });

  test('GIVEN an invalid, malformed, revoked or replaced link, or an event code that does not exist WHEN the page asks THEN every reply has the same status and the same bytes apart from its referral code, and staff read the reason by the code', async () => {
    const t = await setup({ paused: false });
    try {
      await t.lead('POST', '/invitations/send', {});
      await t.drain();
      const tokA = t.tokenOf(t.linkOf(t.sentTo('ana@guest.example')[0].raw));
      const tokB = t.tokenOf(t.linkOf(t.sentTo('ben@guest.example')[0].raw));
      // Send A1's again: a new link; the first one stops working. Revoke B's.
      const again = await t.lead('POST', '/invitations/send', { guestIds: [t.e.guest('A1').id] });
      assert.deepEqual([again.queued, again.again], [1, 1]);
      await t.drain();
      const tokA2 = t.tokenOf(t.linkOf(t.sentTo('ana@guest.example').at(-1).raw));
      assert.notEqual(tokA2, tokA);
      assert.ok((await t.e.cmd('lead', { type: 'revokeInvite', guestId: t.e.guest('A2').id })).ok);
      const replies = [
        await t.open(tokA), await t.open(tokB), await t.open('x'.repeat(43)), await t.open('short'),
        await t.reply(tokA, 'yes'), await t.door(tokB),
        await pub(t.c, 'GET', '/api/public/event/no-such-event/invite', {}, { headers: { 'x-event-invite': tokA2 } }),
      ];
      const norm = (b) => JSON.stringify({ ...b, referral: 'R-0000' });
      for (const r of replies) {
        assert.equal(r.status, 200);
        assert.equal(r.body.state, 'referred');
        assert.match(r.body.referral, /^R-\d{4}$/);
        assert.equal(norm(r.body), norm(replies[0].body), 'byte-identical apart from the code');
      }
      const why = await t.c.as.lead('GET', `${t.e.base}/referral/${replies[0].body.referral}`);
      assert.equal(why.reason, 'invite_invalid');
      assert.equal(t.e.guest('A1').seat, null, 'the old link changed nothing');
      assert.equal((await t.open(tokA2)).body.state, 'invite', 'the new link works');
    } finally {
      t.done();
    }
  });

  test('GIVEN two guests and one chair left for them WHEN both say Yes at the same moment THEN exactly one gets the chair and the other is told the table follows and is in the exceptions inbox', async () => {
    const t = await setup({ paused: false });
    try {
      // The regular tables (3, 4 and 5) leave one chair for regular guests: tables 3 and 4 of one
      // chair each, A3 holding table 4's, and table 5 out of use.
      for (const n of [3, 4]) await t.e.cmd('lead', { type: 'table.update', tableId: t.e.tables[n], capacity: 1 });
      await t.e.cmd('lead', { type: 'reserve', guestId: t.e.guest('A3').id, tableId: t.e.tables[4], seatNo: 1, reason: 'test' });
      await t.e.cmd('lead', { type: 'table.update', tableId: t.e.tables[5], active: false });
      await t.lead('POST', '/invitations/send', {});
      await t.drain();
      const ta = t.tokenOf(t.linkOf(t.sentTo('ana@guest.example')[0].raw));
      const tb = t.tokenOf(t.linkOf(t.sentTo('ben@guest.example')[0].raw));
      const [ra, rb] = await Promise.all([t.reply(ta, 'yes'), t.reply(tb, 'yes')]);
      const seated = [ra, rb].filter((r) => r.body.seat);
      const waiting = [ra, rb].filter((r) => r.body.waitingTable);
      assert.equal(seated.length, 1, 'exactly one gets the last chair');
      assert.equal(waiting.length, 1);
      assert.equal(claimsAt(t.e.tables[3], t.c.db.data.caGuests), 1);
      const ex = await t.c.as.lead('GET', `${t.e.base}/exceptions`);
      assert.equal(ex.items.filter((x) => x.kind === 'rsvp_no_seat').length, 1);
      assert.deepEqual((await t.c.as.lead('GET', `${t.e.base}/invariants`)).violations, []);
      // The Super Administrator reserves a chair for the one waiting: their reply email goes then.
      const who = [t.e.guest('A1'), t.e.guest('A2')].find((g) => !g.seat);
      await t.e.cmd('lead', { type: 'table.update', tableId: t.e.tables[4], capacity: 2 });
      await t.e.cmd('lead', { type: 'reserve', guestId: who.id, tableId: t.e.tables[4], seatNo: 2, reason: 'Said yes' });
      await t.drain();
      assert.match(parseMessage(t.sentTo(who.email).at(-1).raw).text, /Table 4, seat 2/);
    } finally {
      t.done();
    }
  });

  test('GIVEN a guest who said Yes WHEN they open their link at the door while self check-in is open THEN Check in is offered, the token is the proof (no surname), the reserved seat becomes seated, and the link before the doors open says the door is closed', async () => {
    const t = await setup({ paused: false });
    try {
      await t.lead('POST', '/invitations/send', {});
      await t.drain();
      const tok = t.tokenOf(t.linkOf(t.sentTo('maria@guest.example')[0].raw));
      const yes = await t.reply(tok, 'yes');
      assert.deepEqual([yes.body.seat.table, yes.body.seat.seat, yes.body.seat.status], [1, 4, 'reserved'], 'a preferred guest keeps their reservation');
      assert.equal(yes.body.door.open, false);
      assert.equal((await t.door(tok)).body.notice, 'door_closed');
      await openForGuests(t.c, t.e);
      const v = await t.open(tok);
      assert.deepEqual([v.body.door.open, v.body.canAnswer], [true, false], 'replies close when the doors open');
      const inside = await t.door(tok);
      assert.deepEqual([inside.body.door.checkedIn, inside.body.seat.table, inside.body.seat.seat, inside.body.seat.status], [true, 1, 4, 'seated']);
      const p1 = t.e.guest('P1');
      assert.deepEqual([p1.arrival.state, p1.arrival.via, p1.seat.status, (p1.statusTokens || []).length], ['checked_in', 'qr', 'confirmed', 0]);
      const ch = t.c.db.data.caChanges.at(-1);
      assert.deepEqual([ch.type, ch.via], ['selfCheckIn', 'self']);
      // Again: nothing changes (a double tap, or the usher scanning it twice).
      const seq = t.c.db.data.caEvents[0].seq;
      assert.equal((await t.door(tok)).body.door.checkedIn, true);
      assert.equal(t.c.db.data.caEvents[0].seq, seq);
      // The surname check-in still works for everyone else.
      const s = await pub(t.c, 'POST', `/api/public/event/${t.ev.code}/verify`, { surname: 'Reyes', last4: '0002', elapsedMs: 3000 });
      assert.match(s.body.token, /^[A-Za-z0-9_-]{43}$/);
    } finally {
      t.done();
    }
  });

  test('GIVEN the event setup WHEN invitations would go from a wrong place THEN a missing From, the helpdesk mailbox and an event not live block Send, another domain and a local address warn, and the guest page routes can only reply, record an open and check in', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    const get = () => c.as.lead('GET', `${e.base}/invitations`);
    let w = await get();
    assert.deepEqual(w.warnings.filter((x) => x.level === 'block').map((x) => x.code).sort(), ['no_from', 'not_live']);
    assert.equal(w.warnings.find((x) => x.code === 'no_transport').level, 'warn', 'email paused: invitations may wait for the mail server');
    assert.equal((await c.as.lead('POST', `${e.base}/invitations/send`, {})).status, 400);
    await c.admin('PUT', '/api/helpdesk/settings/mailbox', { enabled: false, address: 'helpdesk@company.com', displayName: 'IT Service Desk', host: '127.0.0.1', port: 993, security: 'none', user: 'helpdesk@company.com', password: 'app-pass', pollMinutes: 5, defaultCategory: 'Other' });
    let ev = await c.as.lead('GET', e.base);
    assert.equal((await c.as.lead('PATCH', e.base, { rev: ev.rev, settings: { emailFrom: 'helpdesk@company.com' } })).status, 400, 'the helpdesk mailbox is refused as the From');
    ev = await c.as.lead('PATCH', e.base, { rev: ev.rev, status: 'live', settings: { emailFrom: 'events@other.example', invitation: { publicUrl: 'https://ltdc-core.com' } } });
    w = await get();
    assert.equal(w.linkBase, 'https://ltdc-core.com', 'an explicit public address wins over the one CORE was reached on');
    assert.deepEqual(w.warnings.map((x) => x.code).filter((x) => ['other_domain', 'local_link'].includes(x)), ['other_domain']);
    assert.equal((await c.as.lead('PATCH', e.base, { rev: ev.rev, settings: { invitation: { publicUrl: 'ltdc-core.com/x' } } })).status, 400);
    // Staff and other accounts cannot see or send invitations.
    assert.equal((await c.as.sam('GET', `${e.base}/invitations`)).code, 'needs_super_admin');
    assert.equal((await c.as.sam('POST', `${e.base}/commands`, { type: 'invite', issues: [] })).status, 400);
    const src = fs.readFileSync(new URL('server/customapp/events/invite.js', ROOT), 'utf8');
    assert.deepEqual([...new Set([...src.matchAll(/type: '([a-zA-Z.]+)'/g)].map((m) => m[1]))].sort(), ['invite', 'inviteOpened', 'rsvp', 'selfCheckIn']);
  });

  test('GIVEN an invitation whose link was replaced before it went WHEN the outbox reaches the old message THEN it is not sent, and a failed send never touches the seat', async () => {
    const db = fixture({ tables: [{ n: 3 }], guests: [{ ref: 'A' }], settings: { emailFrom: 'events@ltdc-core.com', autoSeatOnConfirm: true }, flags: { emailPaused: false } });
    db.data.caEvents[0].status = 'live';
    const sent = [];
    const ob = createOutbox(db, { transport: { canSend: () => true, canSendEvents: () => true, options: () => ({}), mailboxAddress: () => 'helpdesk@company.com' }, send: async (o, m) => sent.push(m), saveEveryMs: 10 });
    const ctx = createCommitContext(db, { now: () => '2026-12-01T03:00:00.000Z', afterCommit: ob.afterCommit });
    const issue = (n) => ({ guestId: 'g-A', hash: inviteHashOf(tok(n)), sealed: ob.vault.seal(tok(n)) });
    commitAs(ctx, 'ev1', USERS.lead, { type: 'invite', issues: [issue(1)], base: 'https://ltdc-core.com' });
    commitAs(ctx, 'ev1', USERS.lead, { type: 'invite', issues: [issue(2)], base: 'https://ltdc-core.com' });
    await ob.drain();
    const msgs = db.data.caOutbox.filter((m) => m.kind === 'invitation');
    assert.deepEqual(msgs.map((m) => m.state), ['failed', 'sent'], 'only the newest link goes');
    assert.equal(sent.length, 1);
    assert.ok(sent[0].raw.includes(tok(2)) || parseMessage(sent[0].raw).text.includes(tok(2)));
    assert.equal(db.data.caGuests[0].invite.state, 'sent');
    // A reply email whose link was replaced before it went still goes, without the link, pointing to the invitation.
    commitAs(ctx, 'ev1', { synthetic: 'rsvp' }, { type: 'rsvp', guestId: 'g-A', answer: 'yes', inviteHash: inviteHashOf(tok(2)), tokenSealed: ob.vault.seal(tok(1)) });
    await ob.drain();
    assert.equal(sent.length, 2);
    const replyText = parseMessage(sent[1].raw).text;
    assert.ok(!replyText.includes(tok(1)) && /QR code in your invitation email/.test(replyText) && !/\{\{/.test(replyText), replyText);
    assert.equal(parseMessage(sent[1].raw).attachments.length, 0);
    commitAs(ctx, 'ev1', { synthetic: 'rsvp' }, { type: 'rsvp', guestId: 'g-A', answer: 'no', inviteHash: inviteHashOf(tok(2)) });
    // A Yes, then the reply email fails: the seat stays.
    const failing = createOutbox(db, { transport: { canSend: () => true, canSendEvents: () => true, options: () => ({}), mailboxAddress: () => '' }, send: async () => { throw new Error('Sending failed: 554 rejected'); }, saveEveryMs: 10 });
    const ctx2 = createCommitContext(db, { now: () => '2026-12-01T04:00:00.000Z', afterCommit: failing.afterCommit });
    commitAs(ctx2, 'ev1', { synthetic: 'rsvp' }, { type: 'rsvp', guestId: 'g-A', answer: 'yes', inviteHash: inviteHashOf(tok(2)) });
    await failing.drain();
    assert.equal(db.data.caOutbox.at(-1).state, 'failed');
    assert.equal(db.data.caGuests[0].seat.status, 'reserved');
    ob.stop();
    failing.stop();
  });
});

test('seat on Yes: an event made before 0.74 (no setting) seats on Yes too; only an explicit off stops it', async () => {
  const { seatsOnYes } = await import('../server/customapp/events/model.js');
  assert.equal(seatsOnYes({ settings: {} }), true);
  assert.equal(seatsOnYes({}), true);
  assert.equal(seatsOnYes({ settings: { autoSeatOnConfirm: true } }), true);
  assert.equal(seatsOnYes({ settings: { autoSeatOnConfirm: false } }), false);
});

test('0.74.2: the opening text and closing note are formatted text: HTML in the email and on the page, plain text in the text part', async () => {
  const { invitationMessage, rsvpMessage, textWithLink, messageHtml, plainRich } = await import('../server/customapp/events/message.js');
  const { cleanInvitation } = await import('../server/customapp/events/engine.js');
  // Saved as the editor writes it: line breaks and list indentation kept, control characters out.
  const inv = cleanInvitation({ intro: 'Join us **this year**.\r\n\r\n- Dinner\n  - Main course\n- Awards\u0007\n\n<img src=x onerror=alert(1)> [our site](https://ltdc-core.com) [bad](javascript:alert(1))', closing: '*This email is sent automatically. Please do not reply.*' });
  assert.match(inv.intro, /\n {2}- Main course/);
  assert.doesNotMatch(inv.intro, /\u0007|\r/);
  const ev = { name: 'Legati YEP', date: '2026-12-09', venue: 'Shangri-La', settings: { invitation: inv } };
  const g = { id: 'g1', name: { first: 'Ana', last: 'Cruz', display: 'Ana Cruz' }, email: 'ana@example.com' };
  const msg = invitationMessage(ev, g);
  const text = textWithLink(msg.body, 'https://ltdc-core.com/event/yep#i=tok');
  assert.match(text, /Join us this year\.\n\n• Dinner\n {2}• Main course\n• Awards/);
  assert.match(text, /This email is sent automatically\. Please do not reply\.\n\nLegati YEP$/);
  assert.doesNotMatch(text, /\{\{\/?rich\}\}|\*\*/);
  const html = messageHtml(ev, msg.body, { link: 'https://ltdc-core.com/event/yep#i=tok', qrCid: 'q1' });
  assert.match(html, /Join us <strong>this year<\/strong>\./);
  assert.match(html, /<ul style="[^"]+"><li style="[^"]+">Dinner<ul style="[^"]+"><li style="[^"]+">Main course<\/li><\/ul><\/li>/);
  assert.match(html, /<a style="color:#5d0013;text-decoration:underline" href="https:\/\/ltdc-core\.com\/?"[^>]*>our site<\/a>/);
  assert.match(html, /<em>This email is sent automatically\. Please do not reply\.<\/em>/);
  // Nothing typed becomes HTML: the tag is shown as text, the javascript: link as its words.
  assert.doesNotMatch(html, /<img src=x|href="javascript/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /\{\{\/?rich\}\}/);
  // The seat email ends with the same closing note.
  const yes = rsvpMessage(ev, { ...g, seat: { tableId: 't', seatNo: 3 } }, { number: 7 }, { withLink: true });
  assert.match(textWithLink(yes.body, 'https://x'), /Please do not reply\.\n\nLegati YEP$/);
  assert.match(messageHtml(ev, yes.body, { link: 'https://x' }), /<em>This email is sent automatically/);
  // Text queued before 0.74.2 (no formatted blocks) is sent as it was.
  assert.equal(plainRich('Dear Ana,\n\nJoin us.\n'), 'Dear Ana,\n\nJoin us.\n');
  // No opening text: the default sentence; no closing note: nothing extra.
  const plain = textWithLink(invitationMessage({ ...ev, settings: { invitation: {} } }, g).body, 'https://x');
  assert.match(plain, /Dear Ana Cruz,\n\nYou are invited to Legati YEP\.\n\n/);
  assert.match(plain, /check in\.\n\nLegati YEP$/);
});
