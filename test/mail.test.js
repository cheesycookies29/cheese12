// The helpdesk's mail layer: parsing incoming email, and the IMAP and SMTP clients.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, stripQuoted, isAutomated, htmlToText, REPLY_MARKER } from '../server/mail/mime.js';
import { withImap } from '../server/mail/imap.js';
import { sendMail } from '../server/mail/smtp.js';
import { composeMessage } from '../server/mail/compose.js';
import { fakeImap, fakeSmtp, rawEmail } from './support/mail-servers.js';

test('parses encoded subjects, quoted-printable text and attachments', () => {
  const raw = [
    'From: =?UTF-8?Q?Jos=C3=A9_Rizal?= <Jose.Rizal@Company.com>',
    'To: helpdesk@company.com, "Dela Cruz, Juan" <juan@company.com>',
    'Subject: =?UTF-8?B?UHJpbnRlciBub3Qgd29ya2luZyDigJQgM0Y=?=',
    'Message-ID: <ABC@mail.company.com>',
    'In-Reply-To: <prev@x>',
    'References: <a@x> <prev@x>',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: multipart/alternative; boundary="b2"',
    '',
    '--b2',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'The 3F printer shows =E2=80=9Cpaper jam=E2=80=9D but there is no pa=',
    'per inside.',
    '--b2',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>ignored because plain text exists</p>',
    '--b2--',
    '--b1',
    "Content-Type: application/pdf; name*=utf-8''r%C3%A9sum%C3%A9.pdf",
    'Content-Disposition: attachment',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('%PDF-1.4 test').toString('base64'),
    '--b1--',
  ].join('\r\n');
  const m = parseMessage(raw);
  assert.deepEqual(m.from, { name: 'José Rizal', email: 'jose.rizal@company.com' });
  assert.equal(m.subject, 'Printer not working — 3F');
  assert.equal(m.messageId, '<abc@mail.company.com>');
  assert.deepEqual(m.references, ['<a@x>', '<prev@x>']);
  assert.equal(m.to.length, 2);
  assert.equal(m.text, 'The 3F printer shows “paper jam” but there is no paper inside.');
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'résumé.pdf');
  assert.equal(m.attachments[0].data.toString(), '%PDF-1.4 test');
});

test('falls back to HTML converted to text', () => {
  const m = parseMessage('From: a@b.co\r\nContent-Type: text/html\r\n\r\n<style>p{}</style><p>Hello&nbsp;IT,</p><p>My <b>VPN</b> fails.<br>Thanks</p>');
  assert.equal(m.text, 'Hello IT,\nMy VPN fails.\nThanks');
  assert.equal(htmlToText('<li>One</li><li>Two &amp; three</li>'), '• One\n• Two & three');
});

test('keeps only the new part of a reply', () => {
  assert.equal(stripQuoted(`It works now, thanks.\n\n${REPLY_MARKER}\nolder text`), 'It works now, thanks.');
  assert.equal(stripQuoted('Still broken.\n\nOn Mon, 26 Oct 2026 at 09:00, IT Service Desk <helpdesk@company.com> wrote:\n> We replaced the cable.'), 'Still broken.');
  assert.equal(stripQuoted('See attached.\n\nFrom: IT Service Desk\nSent: Monday\nSubject: x'), 'See attached.');
  assert.equal(stripQuoted('Yes\n> quoted\n> more'), 'Yes');
});

test('recognises automatic mail', () => {
  const auto = (headers, from = 'ana@company.com') => isAutomated(parseMessage(`From: ${from}\r\n${headers}\r\n\r\nx`));
  assert.equal(auto('Auto-Submitted: auto-replied'), true);
  assert.equal(auto('Precedence: bulk'), true);
  assert.equal(auto('List-Id: <news.company.com>'), true);
  assert.equal(auto('', 'MAILER-DAEMON@mx.company.com'), true);
  assert.equal(auto('Auto-Submitted: no'), false);
  assert.equal(auto('X-Mailer: Outlook'), false);
});

test('IMAP client lists, downloads and marks messages read', async () => {
  const imap = await fakeImap({ messages: [rawEmail({ from: 'a@x.com', subject: 'One', body: 'first', messageId: '<1@x>' }), rawEmail({ from: 'b@x.com', subject: 'Two', body: 'second', messageId: '<2@x>' })] });
  const opts = { host: '127.0.0.1', port: imap.port, secure: false, user: 'helpdesk@company.com', password: 'app-pass', folder: 'INBOX' };
  const got = await withImap(opts, async (c) => {
    const uids = await c.searchUnseen();
    const raw = await c.fetch(uids[1]);
    await c.markSeen(uids[1]);
    return { uids, subject: parseMessage(raw).subject };
  });
  assert.deepEqual(got, { uids: [1, 2], subject: 'Two' });
  assert.deepEqual(imap.box.messages.map((m) => m.seen), [false, true]);
  await assert.rejects(withImap({ ...opts, password: 'wrong' }, () => {}), /Sign-in to the mailbox failed/);
  imap.server.close();
});

test('SMTP client signs in and delivers a composed message', async () => {
  const smtp = await fakeSmtp();
  const raw = composeMessage({ from: { name: 'IT Service Desk', email: 'helpdesk@company.com' }, to: [{ name: 'Ana Ñ', email: 'ana@company.com' }], subject: 'Ré: [HD-000001] Laptop', text: 'Line one\n.\nLine three', messageId: '<m1@company.com>', inReplyTo: '<x@y>', references: ['<x@y>'], auto: true });
  await sendMail({ host: '127.0.0.1', port: smtp.port, secure: false, starttls: false, user: 'helpdesk@company.com', password: 'app-pass' }, { from: 'helpdesk@company.com', to: ['ana@company.com'], raw });
  assert.equal(smtp.sent.length, 1);
  const back = parseMessage(smtp.sent[0].raw);
  assert.equal(back.subject, 'Ré: [HD-000001] Laptop');
  assert.equal(back.text.trim(), 'Line one\n.\nLine three', 'dot-stuffing round-trips');
  assert.equal(back.headers['auto-submitted'][0], 'auto-replied');
  assert.deepEqual(back.inReplyTo, ['<x@y>']);
  await assert.rejects(sendMail({ host: '127.0.0.1', port: smtp.port, secure: false, starttls: false, user: 'helpdesk@company.com', password: 'nope' }, { from: 'a@b.co', to: ['c@d.co'], raw }), /Sign-in failed: 535/);
  smtp.server.close();
});
