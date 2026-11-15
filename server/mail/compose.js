// Building outgoing email (UTF-8, base64 body) with threading headers: plain text, or plain text
// with a simple HTML version (multipart/alternative) when `html` is given.
import { randomUUID } from 'node:crypto';

const ascii = (s) => /^[\x20-\x7e]*$/.test(s);
const encodeWord = (s) => (ascii(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const address = ({ name, email }) => (name ? `${ascii(name) ? `"${name.replace(/["\\]/g, '')}"` : encodeWord(name)} <${email}>` : `<${email}>`);
const wrap = (b64) => b64.replace(/.{1,76}/g, '$&\r\n');

export const newMessageId = (email) => `<${randomUUID()}@${String(email).split('@')[1] || 'localhost'}>`;

const b64 = (s) => wrap(Buffer.from(s.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'));

// { from: {name,email}, to: [{name,email}], subject, text, html?, messageId, inReplyTo, references: [], auto }
export function composeMessage(m) {
  const boundary = m.html ? `core-${randomUUID()}` : null;
  const headers = [
    `From: ${address(m.from)}`,
    `To: ${m.to.map(address).join(', ')}`,
    `Subject: ${encodeWord(m.subject.replace(/[\r\n]+/g, ' '))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${m.messageId}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references?.length ? [`References: ${m.references.join(' ')}`] : []),
    'MIME-Version: 1.0',
    ...(boundary ? [`Content-Type: multipart/alternative; boundary="${boundary}"`] : ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64']),
    // Ask other systems not to send out-of-office replies back (prevents loops).
    'X-Auto-Response-Suppress: All',
    // auto: true for an automatic reply, 'generated' for a scheduled message (the Projects digest).
    ...(m.auto ? [`Auto-Submitted: ${m.auto === 'generated' ? 'auto-generated' : 'auto-replied'}`] : []),
  ];
  if (!boundary) return `${headers.join('\r\n')}\r\n\r\n${b64(m.text)}`;
  const part = (type, body) => `--${boundary}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(body)}`;
  return `${headers.join('\r\n')}\r\n\r\n${part('text/plain', m.text)}${part('text/html', m.html)}--${boundary}--\r\n`;
}
