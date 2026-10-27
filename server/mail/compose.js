// Building outgoing plain-text email (UTF-8, base64 body) with threading headers.
import { randomUUID } from 'node:crypto';

const ascii = (s) => /^[\x20-\x7e]*$/.test(s);
const encodeWord = (s) => (ascii(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const address = ({ name, email }) => (name ? `${ascii(name) ? `"${name.replace(/["\\]/g, '')}"` : encodeWord(name)} <${email}>` : `<${email}>`);
const wrap = (b64) => b64.replace(/.{1,76}/g, '$&\r\n');

export const newMessageId = (email) => `<${randomUUID()}@${String(email).split('@')[1] || 'localhost'}>`;

// { from: {name,email}, to: [{name,email}], subject, text, messageId, inReplyTo, references: [], auto }
export function composeMessage(m) {
  const headers = [
    `From: ${address(m.from)}`,
    `To: ${m.to.map(address).join(', ')}`,
    `Subject: ${encodeWord(m.subject.replace(/[\r\n]+/g, ' '))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${m.messageId}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references?.length ? [`References: ${m.references.join(' ')}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    // Ask other systems not to send out-of-office replies back (prevents loops).
    'X-Auto-Response-Suppress: All',
    ...(m.auto ? ['Auto-Submitted: auto-replied'] : []),
  ];
  return `${headers.join('\r\n')}\r\n\r\n${wrap(Buffer.from(m.text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'))}`;
}
