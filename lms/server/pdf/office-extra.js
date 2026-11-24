// PDF Studio (0.66): more kinds of file read into the block model of server/pdf/layout.js, built
// on the readers that exist (office-text.js for HTML and text, office-core.js for ZIP and XML):
//
//   epubToDoc(buffer)          an e-book: its chapters in reading order, with their pictures
//   emlToDoc(buffer)           an e-mail saved as .eml: subject, who and when, the message, and its
//                              pictures; other attachments are named
//   codeToDoc(buffer, name)    code, data and log files (.json, .xml, .sql, .py, .log…): the text as
//                              it is, in a fixed-width font, JSON laid out if it was on one line
//
// Each returns { title, blocks, landscape, warnings } like office.js toBlocks, and throws an Error
// whose message is for the person uploading when the file cannot be read at all.
import { Out, ReadError, STOP, readZip, parseXml, findAll, find, decodeText, dropPrefixes, textOf } from './office-core.js';
import { decodeAs } from './cp1252.js';
import { htmlToBlocks, txtToBlocks } from './office-text.js';

const MAX_CODE_LINES = 120_000; // about 2,000 pages
const MAX_MAIL_PARTS = 200;

function run(label, what, fill) {
  const out = new Out();
  try {
    fill(out);
  } catch (err) {
    if (err === STOP) { /* long: what was read is kept */ } else if (err instanceof ReadError) throw new Error(err.message.replace(/^This file\b/, label));
    else if (err?.userMessage) throw new Error(err.userMessage);
    else throw new Error(`${label} could not be read as ${what}: it seems to be damaged.`, { cause: err });
  }
  return out.result();
}
const userError = (message) => Object.assign(new Error(message), { userMessage: message });

// ---------------------------------------------------------------------------------------------
// E-books (EPUB 2 and 3)

const resolve = (base, href) => {
  const parts = (base ? `${base}/${href}` : href).split('#')[0].split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  try {
    return decodeURIComponent(out.join('/'));
  } catch {
    return out.join('/');
  }
};
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export function epubToDoc(buffer, { fileName } = {}) {
  const label = fileName ? `“${String(fileName).slice(0, 120)}”` : 'This e-book';
  return run(label, 'an e-book', (out) => {
    const zip = readZip(buffer, { maxTotalBytes: 300 * 1024 * 1024 });
    if (zip.has('META-INF/encryption.xml') && /EncryptedData/.test(zip.read('META-INF/encryption.xml').toString('utf8')) && !/obfuscation/i.test(zip.read('META-INF/encryption.xml').toString('utf8'))) {
      throw userError(`${label} is protected (DRM), so its chapters cannot be read. Only e-books without DRM can be turned into a PDF.`);
    }
    if (!zip.has('META-INF/container.xml')) throw userError(`${label} is not an e-book ATLAS can read (its table of contents is missing).`);
    const container = dropPrefixes(parseXml(zip.read('META-INF/container.xml')));
    const rootfile = findAll(container, 'rootfile')[0]?.attrs?.['full-path'];
    if (!rootfile || !zip.has(rootfile)) throw userError(`${label} is not an e-book ATLAS can read (its table of contents is missing).`);
    const opf = dropPrefixes(parseXml(zip.read(rootfile)));
    const base = dirOf(rootfile);
    const title = find(opf, 'title');
    const titleText = title ? textOf(title).replace(/\s+/g, ' ').trim() : '';
    if (titleText) out.title = titleText;
    const manifest = new Map();
    for (const item of findAll(opf, 'item')) manifest.set(item.attrs.id, { href: resolve(base, item.attrs.href || ''), type: item.attrs['media-type'] || '' });
    const spine = findAll(opf, 'itemref').filter((r) => r.attrs.linear !== 'no').map((r) => manifest.get(r.attrs.idref)).filter(Boolean);
    if (!spine.length) throw userError(`${label} has no chapters ATLAS can read.`);
    let skipped = 0;
    spine.forEach((item, i) => {
      if (!/html|xml/.test(item.type) || !zip.has(item.href)) return;
      let html = decodeText(zip.read(item.href));
      // Pictures inside the book become data: addresses the HTML reader takes (JPEG and PNG).
      const dir = dirOf(item.href);
      html = html.replace(/(<(?:img|image)\b[^>]*?\s(?:src|xlink:href|href)\s*=\s*)(["'])([^"']+)\2/gi, (m, pre, q, src) => {
        if (/^(data|https?):/i.test(src)) return m;
        const p = resolve(dir, src);
        if (!zip.has(p)) return m;
        const data = zip.read(p);
        const type = data[0] === 0xff && data[1] === 0xd8 ? 'jpeg' : data.readUInt32BE(0) === 0x89504e47 ? 'png' : null;
        if (!type) {
          skipped += 1;
          return m;
        }
        return `<img src=${q}data:image/${type};base64,${data.toString('base64')}${q}`;
      });
      if (i > 0) out.add({ type: 'pagebreak' });
      const t = out.title;
      htmlToBlocks(Buffer.from(html, 'utf8'), out);
      out.title = t; // the book's title, not the chapter's
    });
    if (skipped) out.warn(`${skipped} picture${skipped === 1 ? ' is' : 's are'} in a format a PDF cannot hold here and ${skipped === 1 ? 'was' : 'were'} left out.`);
  });
}

// ---------------------------------------------------------------------------------------------
// E-mail (.eml, RFC 5322 with MIME)

function splitHeaders(buf) {
  const s = buf.toString('latin1');
  const m = /\r?\n\r?\n/.exec(s);
  const head = m ? s.slice(0, m.index) : s;
  const body = m ? buf.subarray(m.index + m[0].length) : Buffer.alloc(0);
  const headers = new Map();
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    if (!headers.has(k)) headers.set(k, line.slice(i + 1).trim());
  }
  return { headers, body };
}
const charsetDecode = (bytes, charset) => {
  try {
    return decodeAs((charset || 'utf-8').toLowerCase(), bytes);
  } catch {
    return decodeText(bytes);
  }
};
// =?utf-8?B?…?= and =?iso-8859-1?Q?…?= in a header.
function decodeWords(v) {
  return String(v || '').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=(\s+(?==\?))?/gi, (m, cs, enc, text) => {
    const bytes = enc.toLowerCase() === 'b' ? Buffer.from(text, 'base64') : qp(text.replace(/_/g, ' '));
    return charsetDecode(bytes, cs);
  });
}
function qp(s) {
  const out = [];
  const src = String(s).replace(/=\r?\n/g, '');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '=' && /^[0-9a-f]{2}$/i.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(src.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}
const param = (v, name) => {
  const m = new RegExp(`(?:^|;)\\s*${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(v || '');
  const raw = m ? (m[1] ?? m[2]) : null;
  if (raw && /^[\w-]+''/.test(raw)) {
    try {
      return decodeURIComponent(raw.replace(/^[\w-]+''/, ''));
    } catch { return raw; }
  }
  return raw ? decodeWords(raw) : null;
};
function parts(buf, depth = 0, list = []) {
  if (list.length > MAX_MAIL_PARTS || depth > 10) return list;
  const { headers, body } = splitHeaders(buf);
  const type = (headers.get('content-type') || 'text/plain').split(';')[0].trim().toLowerCase();
  const boundary = param(headers.get('content-type'), 'boundary');
  if (type.startsWith('multipart/') && boundary) {
    const s = body.toString('latin1');
    const marker = `--${boundary}`;
    const pieces = s.split(marker).slice(1);
    for (const piece of pieces) {
      if (piece.startsWith('--')) break;
      parts(Buffer.from(piece.replace(/^\r?\n/, ''), 'latin1'), depth + 1, list);
    }
    return list;
  }
  if (type === 'message/rfc822') {
    list.push({ type, headers, data: body });
    return list;
  }
  const enc = (headers.get('content-transfer-encoding') || '').trim().toLowerCase();
  let data = body;
  if (enc === 'base64') data = Buffer.from(body.toString('latin1').replace(/[^a-z0-9+/=]/gi, ''), 'base64');
  else if (enc === 'quoted-printable') data = qp(body.toString('latin1'));
  const disposition = headers.get('content-disposition') || '';
  const name = param(disposition, 'filename') || param(headers.get('content-type'), 'name');
  list.push({ type, headers, data, charset: param(headers.get('content-type'), 'charset'), name, attachment: /^attachment/i.test(disposition), cid: (headers.get('content-id') || '').replace(/^<|>$/g, '') });
  return list;
}
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function emlToDoc(buffer, { fileName } = {}) {
  const label = fileName ? `“${String(fileName).slice(0, 120)}”` : 'This e-mail';
  return run(label, 'an e-mail', (out) => {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    const { headers } = splitHeaders(buf);
    if (!headers.has('from') && !headers.has('subject') && !headers.has('to')) throw userError(`${label} is not an e-mail ATLAS can read: it has no sender, recipient or subject.`);
    const subject = decodeWords(headers.get('subject') || '') || '(no subject)';
    out.title = subject;
    out.heading(1, [{ text: subject }]);
    const rows = [['From', headers.get('from')], ['To', headers.get('to')], ['Cc', headers.get('cc')], ['Date', headers.get('date')]].filter(([, v]) => v);
    if (rows.length) {
      out.add({
        type: 'table',
        rows: rows.map(([k, v]) => ({ cells: [{ runs: [{ text: k, bold: true }] }, { runs: [{ text: decodeWords(v) }] }] })),
      });
    }
    const all = parts(buf);
    const html = all.find((p) => p.type === 'text/html' && !p.attachment);
    const plain = all.find((p) => p.type === 'text/plain' && !p.attachment);
    const used = new Set();
    if (html) {
      let source = charsetDecode(html.data, html.charset);
      // Pictures inside the message (cid:) become data: addresses.
      source = source.replace(/(["'])cid:([^"']+)\1/gi, (m, q, id) => {
        const p = all.find((x) => x.cid && x.cid === id);
        if (!p || !/^image\/(jpe?g|png)$/.test(p.type)) return m;
        used.add(p);
        return `${q}data:${p.type.replace('jpg', 'jpeg')};base64,${p.data.toString('base64')}${q}`;
      });
      const t = out.title;
      htmlToBlocks(Buffer.from(source, 'utf8'), out);
      out.title = t;
    } else if (plain) {
      txtToBlocks(Buffer.from(charsetDecode(plain.data, plain.charset), 'utf8'), out);
    } else out.warn('The message has no text ATLAS can show.');
    const files = all.filter((p) => !used.has(p) && p !== html && p !== plain && (p.attachment || p.name || p.type === 'message/rfc822'));
    if (files.length) {
      out.heading(2, [{ text: files.length === 1 ? 'Attachment' : `Attachments (${files.length})` }]);
      for (const f of files) {
        const n = f.name || (f.type === 'message/rfc822' ? 'Forwarded message' : 'attachment');
        if (/^image\/(jpe?g|png)$/.test(f.type) && f.data.length) {
          out.paragraph([{ text: n, bold: true }]);
          const b = out.image(f.data);
          if (b) out.add(b);
        } else out.paragraph([{ text: `${n}${f.data?.length ? ` (${Math.max(1, Math.round(f.data.length / 1024))} KB)` : ''}` }]);
      }
      if (files.some((f) => !/^image\/(jpe?g|png)$/.test(f.type))) out.warn('Attachments that are not pictures are named, not included: save them from your mail program and add them to PDF Studio.');
    }
  });
}
export const looksLikeMail = (buf) => {
  const head = buf.subarray(0, 4096).toString('latin1');
  return /^(received|from|to|subject|date|message-id|mime-version|return-path|delivered-to|x-[\w-]+):/im.test(head) && /^(from|subject|to):/im.test(head);
};

// ---------------------------------------------------------------------------------------------
// Code, data and logs

export function codeToDoc(buffer, { fileName } = {}) {
  const out = new Out();
  let text = decodeText(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const name = String(fileName || '').slice(0, 160);
  if (/\.json$/i.test(name) && text.length < 20 * 1024 * 1024) {
    // JSON on one long line (as programs save it) is laid out to be read.
    try {
      const v = JSON.parse(text);
      if (text.split('\n').length < 3 || text.length / text.split('\n').length > 200) text = JSON.stringify(v, null, 2);
    } catch { /* shown as it is */ }
  }
  if (!text.trim()) {
    out.warn('The file is empty.');
    return out.result();
  }
  if (name) out.title = name;
  let lines = text.split('\n');
  if (lines.length > MAX_CODE_LINES) {
    out.warn(`The file has ${lines.length.toLocaleString('en-US')} lines; the first ${MAX_CODE_LINES.toLocaleString('en-US')} are in the PDF.`);
    lines = lines.slice(0, MAX_CODE_LINES);
  }
  // Very long lines are cut so a line fits on the page; the PDF says where.
  let cut = 0;
  lines = lines.map((l) => {
    if (l.length <= 400) return l;
    cut += 1;
    return `${l.slice(0, 400)} …`;
  });
  if (cut) out.warn(`${cut.toLocaleString('en-US')} very long line${cut === 1 ? ' was' : 's were'} shortened to 400 characters.`);
  try {
    // In pieces, so the layout breaks pages between them.
    for (let i = 0; i < lines.length; i += 50) out.add({ type: 'code', text: lines.slice(i, i + 50).join('\n') });
  } catch (err) {
    if (err !== STOP) throw err;
  }
  return out.result();
}
