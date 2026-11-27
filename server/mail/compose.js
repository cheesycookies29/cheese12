// Building outgoing email (UTF-8, base64 body) with threading headers: plain text, or plain text
// with a simple HTML version (multipart/alternative) when `html` is given, and, when `inline`
// images are given too, the HTML and its pictures together (multipart/related, each picture a part
// with a Content-ID that the HTML shows as <img src="cid:…">). There is always a plain-text part.
// Pictures go as parts, never as data: addresses in the HTML: Gmail and Outlook do not show those.
//
//   multipart/related; type="multipart/alternative"      (only with inline images)
//     multipart/alternative
//       text/plain
//       text/html
//     image/png  Content-ID: <qr@…>  Content-Disposition: inline
import { randomUUID } from 'node:crypto';

const ascii = (s) => /^[\x20-\x7e]*$/.test(s);
const encodeWord = (s) => (ascii(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const address = ({ name, email }) => (name ? `${ascii(name) ? `"${name.replace(/["\\]/g, '')}"` : encodeWord(name)} <${email}>` : `<${email}>`);
const wrap = (b64) => b64.replace(/.{1,76}/g, '$&\r\n');

export const newMessageId = (email) => `<${randomUUID()}@${String(email).split('@')[1] || 'localhost'}>`;
// A Content-ID for an inline picture: unique, and on the sender's domain.
export const newContentId = (name, email) => `${String(name || 'img').replace(/[^A-Za-z0-9.-]/g, '').slice(0, 30) || 'img'}.${randomUUID()}@${String(email || '').split('@')[1] || 'localhost'}`;

const b64 = (s) => wrap(Buffer.from(s.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'));
const fileName = (s) => String(s || 'image').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'image';

// { from: {name,email}, to: [{name,email}], replyTo?: {name,email}, subject, text, html?,
//   inline?: [{ cid, type: 'image/png', data: Buffer, name? }], messageId, inReplyTo, references: [], auto }
export function composeMessage(m) {
  const inline = m.html && Array.isArray(m.inline) ? m.inline.filter((x) => x && x.cid && Buffer.isBuffer(x.data)) : [];
  const boundary = m.html ? `core-${randomUUID()}` : null;
  const related = inline.length ? `core-rel-${randomUUID()}` : null;
  const headers = [
    `From: ${address(m.from)}`,
    `To: ${m.to.map(address).join(', ')}`,
    // Replies go here instead of From (an event's own reply address).
    ...(m.replyTo?.email ? [`Reply-To: ${address(m.replyTo)}`] : []),
    `Subject: ${encodeWord(m.subject.replace(/[\r\n]+/g, ' '))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${m.messageId}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references?.length ? [`References: ${m.references.join(' ')}`] : []),
    'MIME-Version: 1.0',
    ...(related ? [`Content-Type: multipart/related; boundary="${related}"; type="multipart/alternative"`]
      : boundary ? [`Content-Type: multipart/alternative; boundary="${boundary}"`] : ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64']),
    // Ask other systems not to send out-of-office replies back (prevents loops).
    'X-Auto-Response-Suppress: All',
    // auto: true for an automatic reply, 'generated' for a scheduled message (the Projects digest).
    ...(m.auto ? [`Auto-Submitted: ${m.auto === 'generated' ? 'auto-generated' : 'auto-replied'}`] : []),
  ];
  if (!boundary) return `${headers.join('\r\n')}\r\n\r\n${b64(m.text)}`;
  const part = (type, body) => `--${boundary}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(body)}`;
  const alternative = `${part('text/plain', m.text)}${part('text/html', m.html)}--${boundary}--\r\n`;
  if (!related) return `${headers.join('\r\n')}\r\n\r\n${alternative}`;
  const pictures = inline.map((x) => {
    const type = /^image\/(png|jpeg|gif)$/.test(x.type) ? x.type : 'image/png';
    const name = fileName(x.name || `${x.cid.split('@')[0]}.png`);
    return `--${related}\r\nContent-Type: ${type}; name="${name}"\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <${x.cid}>\r\nContent-Disposition: inline; filename="${name}"\r\n\r\n${wrap(x.data.toString('base64'))}`;
  }).join('');
  return `${headers.join('\r\n')}\r\n\r\n--${related}\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n${alternative}${pictures}--${related}--\r\n`;
}
