// Parsing of incoming email (RFC 5322 / MIME): headers, encoded words, multipart
// bodies, transfer encodings, charsets and attachments. Raw messages are handled as
// 'latin1' strings so every byte survives until a part is decoded.

const decoderFor = (charset) => {
  try {
    return new TextDecoder(String(charset || 'utf-8').trim().toLowerCase().replace(/^(us-ascii|ascii)$/, 'utf-8'));
  } catch {
    return new TextDecoder('utf-8');
  }
};
const bytes = (s) => Buffer.from(s, 'latin1');
export const decodeCharset = (buf, charset) => decoderFor(charset).decode(buf);

function decodeQP(s) {
  const out = [];
  const src = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(src.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

export function decodeTransfer(body, encoding) {
  const enc = String(encoding || '').trim().toLowerCase();
  if (enc === 'base64') return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (enc === 'quoted-printable') return decodeQP(body);
  return bytes(body);
}

// RFC 2047: =?utf-8?B?...?= and =?iso-8859-1?Q?...?=; whitespace between encoded words is dropped.
export function decodeWords(value) {
  return String(value || '')
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?[^?]+\?[BbQq]\?[^?]*\?=)/g, '$1')
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
      const buf = enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : decodeQP(text.replace(/_/g, ' '));
      return decodeCharset(buf, charset);
    });
}

export function parseHeaders(text) {
  const headers = {};
  const unfolded = text.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    (headers[name] ||= []).push(line.slice(i + 1).trim());
  }
  return headers;
}
const first = (headers, name) => headers[name]?.[0] || '';

// 'text/plain; charset="utf-8"' -> { value: 'text/plain', params: { charset: 'utf-8' } }, including RFC 2231 name*=.
export function parseParams(header) {
  const [value, ...rest] = splitOutsideQuotes(header, ';');
  const params = {};
  for (const p of rest) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    let key = p.slice(0, i).trim().toLowerCase();
    let val = p.slice(i + 1).trim().replace(/^"(.*)"$/s, '$1').replace(/\\(.)/g, '$1');
    // RFC 2231: name*=utf-8''%E2%82%AC.pdf (encoded) and name*0=, name*1= (continued).
    const ext = key.match(/^([^*]+)\*(\d+)?(\*)?$/);
    if (ext) {
      key = ext[1];
      const encoded = ext[3] || !ext[2];
      if (encoded) {
        const m = val.match(/^([^']*)'[^']*'(.*)$/);
        const pct = (t) => Buffer.from(t.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
        val = m ? decodeCharset(pct(m[2]), m[1] || 'utf-8') : decodeCharset(pct(val), 'utf-8');
      }
      params[key] = ext[2] && ext[2] !== '0' && params[key] ? params[key] + val : val;
    } else params[key] = val;
  }
  return { value: value.trim().toLowerCase(), params };
}

function splitOutsideQuotes(s, sep) {
  const parts = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== '\\') quoted = !quoted;
    if (c === sep && !quoted) parts.push(cur), (cur = '');
    else cur += c;
  }
  parts.push(cur);
  return parts;
}

// 'Ana Cruz <ana@x.com>, "Dela Cruz, Juan" <juan@x.com>' -> [{ name, email }]
export function parseAddresses(value) {
  return splitOutsideQuotes(decodeWords(value), ',')
    .map((part) => {
      const m = part.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
      const email = (m ? m[2] : part).trim().replace(/^mailto:/i, '').toLowerCase();
      return { name: (m ? m[1] : '').trim(), email };
    })
    .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parsePart(raw, out, depth = 0) {
  const split = raw.search(/\r?\n\r?\n/);
  const headText = split < 0 ? raw : raw.slice(0, split);
  const body = split < 0 ? '' : raw.slice(split).replace(/^\r?\n\r?\n/, '');
  const headers = parseHeaders(headText);
  const type = parseParams(first(headers, 'content-type') || 'text/plain; charset=us-ascii');
  const disposition = parseParams(first(headers, 'content-disposition') || '');
  const encoding = first(headers, 'content-transfer-encoding');
  const filename = decodeWords(disposition.params.filename || type.params.name || '');

  if (type.value.startsWith('multipart/') && type.params.boundary && depth < 10) {
    const b = `--${type.params.boundary}`;
    const pieces = body.split(new RegExp(`\\r?\\n?${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`));
    for (const piece of pieces.slice(1)) if (piece.trim()) parsePart(piece, out, depth + 1);
    return headers;
  }
  const data = decodeTransfer(body, encoding);
  const isAttachment = disposition.value === 'attachment' || (filename && !type.value.startsWith('text/')) || type.value === 'message/rfc822';
  if (isAttachment) out.attachments.push({ filename: filename || 'attachment', contentType: type.value, data });
  else if (type.value === 'text/plain' && !out.textSet) (out.text = decodeCharset(data, type.params.charset)), (out.textSet = true);
  else if (type.value === 'text/html' && !out.htmlSet) (out.html = decodeCharset(data, type.params.charset)), (out.htmlSet = true);
  else if (filename) out.attachments.push({ filename, contentType: type.value, data });
  return headers;
}

const ids = (v) => (String(v || '').match(/<[^<>\s]+>/g) || []).map((x) => x.toLowerCase());

// Raw message (Buffer or string) -> the fields the helpdesk uses.
export function parseMessage(raw) {
  const src = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw);
  const out = { text: '', html: '', attachments: [] };
  const headers = parsePart(src, out);
  const text = out.text || (out.html ? htmlToText(out.html) : '');
  return {
    headers,
    from: parseAddresses(first(headers, 'from'))[0] || null,
    replyTo: parseAddresses(first(headers, 'reply-to'))[0] || null,
    to: parseAddresses((headers.to || []).join(', ')),
    cc: parseAddresses((headers.cc || []).join(', ')),
    subject: decodeWords(first(headers, 'subject')).replace(/\s+/g, ' ').trim(),
    messageId: ids(first(headers, 'message-id'))[0] || null,
    inReplyTo: ids(first(headers, 'in-reply-to')),
    references: ids((headers.references || []).join(' ')),
    date: first(headers, 'date'),
    text: text.replace(/\r\n/g, '\n'),
    attachments: out.attachments,
  };
}

// Automatic mail (out-of-office, bounces, lists) that must not open or update tickets.
export function isAutomated(msg) {
  const h = (n) => first(msg.headers, n).toLowerCase();
  if (h('auto-submitted') && h('auto-submitted') !== 'no') return true;
  if (/^(bulk|junk|list|auto_reply)$/.test(h('precedence'))) return true;
  if (h('x-autoreply') || h('x-autorespond') || h('x-auto-response-suppress').includes('all')) return true;
  if (msg.headers['list-id'] || msg.headers['list-unsubscribe']) return true;
  const from = msg.from?.email || '';
  return /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(from);
}

// The new part of an email reply: cut at our marker, "On ... wrote:", Outlook headers or trailing quotes.
export const REPLY_MARKER = '##- Please type your reply above this line -##';
export function stripQuoted(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.includes(REPLY_MARKER) || /^-{2,}\s*original message\s*-{2,}$/i.test(l) || /^_{10,}$/.test(l)
      || /^on\b.{0,200}\bwrote:$/i.test(l) || (/^from:\s/i.test(l) && /^(sent|date):\s/i.test(lines[i + 1]?.trim() || ''))) {
      end = i;
      break;
    }
  }
  const kept = lines.slice(0, end);
  while (kept.length && (/^>/.test(kept.at(-1).trim()) || !kept.at(-1).trim())) kept.pop();
  return kept.join('\n').trim();
}
