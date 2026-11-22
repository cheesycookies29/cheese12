// PDF Studio (0.66): Outlook messages (.msg) to the block model of server/pdf/layout.js. A .msg is a
// compound file (server/pdf/office-cfb.js) of MAPI properties: "__substg1.0_TTTTYYYY" streams hold
// strings and binary values (TTTT the property, YYYY its type), "__properties_version1.0" the fixed
// size ones (dates, numbers), and storages hold the recipients and the attachments.
//
// The PDF shows the subject as a heading, a small table of From, To, Cc and Date, the body (its HTML
// when there is one, else its RTF, else its plain text), the names of the attachments and, after them,
// the attached JPEG and PNG pictures.
import { fail, makeRun, sniffImage } from './office-core.js';
import { htmlToBlocks, txtToBlocks } from './office-text.js';
import { rtfToBlocks } from './office-rtf.js';

const MAX_RTF = 32 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------
// Compressed RTF (MS-OXRTFCP, "LZFu"): a 4 KB dictionary that starts with RTF boilerplate.

const PREBUF = '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx';

export function decompressRtf(buf) {
  const DAMAGED = 'The text of this message (compressed RTF) is damaged.';
  if (!buf || buf.length < 16) fail(DAMAGED);
  const compSize = buf.readUInt32LE(0);
  const rawSize = buf.readUInt32LE(4);
  const magic = buf.readUInt32LE(8);
  if (rawSize > MAX_RTF) fail('The text of this message is far larger than a message should be, so CORE stopped reading it.');
  if (magic === 0x414c454d) return buf.subarray(16, Math.min(buf.length, 16 + rawSize)); // "MELA": not compressed
  if (magic !== 0x75465a4c) fail(DAMAGED); // "LZFu"
  const dict = Buffer.alloc(4096);
  dict.write(PREBUF, 'latin1');
  let w = PREBUF.length;
  const out = Buffer.alloc(rawSize);
  let o = 0;
  let i = 16;
  const end = Math.min(buf.length, compSize + 4);
  outer: while (i < end) {
    const control = buf[i++];
    for (let bit = 0; bit < 8; bit++) {
      if (i >= end) break outer;
      if (control & (1 << bit)) {
        if (i + 1 >= end) break outer;
        const ref = (buf[i] << 8) | buf[i + 1];
        i += 2;
        const offset = ref >> 4;
        const length = (ref & 0xf) + 2;
        if (offset === w) break outer; // the end marker
        for (let k = 0; k < length; k++) {
          if (o >= out.length) break outer;
          const b = dict[(offset + k) & 0xfff];
          out[o++] = b;
          dict[w] = b;
          w = (w + 1) & 0xfff;
        }
      } else {
        if (o >= out.length) break outer;
        const b = buf[i++];
        out[o++] = b;
        dict[w] = b;
        w = (w + 1) & 0xfff;
      }
    }
  }
  return out.subarray(0, o);
}

// ---------------------------------------------------------------------------------------------
// Properties

const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const ENCODINGS = { 65001: 'utf-8', 1200: 'utf-16le', 20127: 'us-ascii', 28591: 'iso-8859-1', 28592: 'iso-8859-2', 28605: 'iso-8859-15', 50220: 'iso-2022-jp', 51932: 'euc-jp', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 874: 'windows-874', 10000: 'macintosh' };
function decodeWith(bytes, codepage) {
  const label = ENCODINGS[codepage] || (codepage >= 1250 && codepage <= 1258 ? `windows-${codepage}` : 'windows-1252');
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return bytes.toString('latin1');
  }
}

// The properties of one object (the message, a recipient or an attachment) under a storage prefix.
function props(cfb, prefix, headerSize) {
  const fixed = new Map();
  const name = `${prefix}__properties_version1.0`;
  if (cfb.has(name)) {
    try {
      const b = cfb.read(name);
      for (let at = headerSize; at + 16 <= b.length; at += 16) {
        const tag = b.readUInt32LE(at);
        fixed.set(tag >>> 16, { type: tag & 0xffff, value: b.subarray(at + 8, at + 16) });
      }
    } catch { /* fixed properties stay unknown */ }
  }
  const codepage = (() => {
    for (const id of [0x3fde, 0x3ffd]) {
      const p = fixed.get(id);
      if (p && p.type === 0x0003) return p.value.readUInt32LE(0);
    }
    return 1252;
  })();
  const read = (n) => {
    try {
      return cfb.read(n);
    } catch {
      return null;
    }
  };
  return {
    codepage,
    has: (id, type) => cfb.has(`${prefix}__substg1.0_${hex4(id)}${hex4(type)}`),
    binary(id) {
      const n = `${prefix}__substg1.0_${hex4(id)}0102`;
      return cfb.has(n) ? read(n) : null;
    },
    string(id) {
      const w = `${prefix}__substg1.0_${hex4(id)}001F`;
      if (cfb.has(w)) {
        const b = read(w);
        return b ? b.toString('utf16le', 0, b.length & ~1).replace(/\0+$/, '') : null;
      }
      const a = `${prefix}__substg1.0_${hex4(id)}001E`;
      if (cfb.has(a)) {
        const b = read(a);
        return b ? decodeWith(b, codepage).replace(/\0+$/, '') : null;
      }
      return null;
    },
    long(id) {
      const p = fixed.get(id);
      return p && (p.type === 0x0003 || p.type === 0x000b) ? p.value.readInt32LE(0) : null;
    },
    time(id) {
      const p = fixed.get(id);
      if (!p || p.type !== 0x0040) return null;
      const ft = p.value.readUInt32LE(4) * 4294967296 + p.value.readUInt32LE(0);
      const ms = ft / 10000 - 11644473600000;
      return Number.isFinite(ms) && ms > 0 && ms < 8.64e15 ? new Date(ms) : null;
    },
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n) => String(n).padStart(2, '0');
const showDate = (d) => `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
const clean = (s) => String(s || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
const isMail = (s) => /^[^\s@<>]+@[^\s@<>]+$/.test(String(s || '').trim());
function person(name, email) {
  const n = clean(name);
  const e = isMail(email) ? email.trim() : '';
  if (n && e && n.toLowerCase() !== e.toLowerCase()) return `${n} <${e}>`;
  return n || e;
}
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);

export function msgToBlocks(cfb, out, label) {
  const top = cfb.names.filter((n) => !n.includes('/'));
  if (!top.some((n) => n.startsWith('__substg1.0_')) && !cfb.has('__properties_version1.0')) {
    fail(`${label} is not an Outlook message CORE can read: it may be damaged, or be another kind of file with the wrong name.`);
  }
  const msg = props(cfb, '', 32);
  const subject = clean(msg.string(0x0037));
  out.title = subject || null;
  const kind = msg.string(0x001a) || '';
  if (/SMIME/i.test(kind) && !/MultipartSigned/i.test(kind)) out.warn('This message is encrypted (S/MIME): its text could not be read.');

  // Who sent it and to whom.
  const from = person(msg.string(0x0c1a) || msg.string(0x0042), [msg.string(0x5d01), msg.string(0x0c1f), msg.string(0x5d02), msg.string(0x0065)].find(isMail));
  const to = [];
  const cc = [];
  const recipients = cfb.storages.filter((s) => /^__recip_version1\.0_#[0-9A-F]{8}$/i.test(s)).sort();
  for (const r of recipients.slice(0, 500)) {
    const p = props(cfb, `${r}/`, 8);
    const who = person(p.string(0x3001), [p.string(0x39fe), p.string(0x3003)].find(isMail));
    if (!who) continue;
    const type = p.long(0x0c15);
    if (type === 2) cc.push(who);
    else if (type !== 3) to.push(who);
  }
  const toText = to.length ? to.join('; ') : clean(msg.string(0x0e04));
  const ccText = cc.length ? cc.join('; ') : clean(msg.string(0x0e03));
  const date = msg.time(0x0039) || msg.time(0x0e06);
  const rows = [['From', from], ['To', toText], ['Cc', ccText], ['Date', date ? showDate(date) : '']]
    .filter(([, v]) => v)
    .map(([k, v]) => ({ cells: [{ runs: [makeRun(k, { bold: true })] }, { runs: [makeRun(v)] }] }));
  out.heading(1, [{ text: subject || '(No subject)' }]);
  if (rows.length) out.add({ type: 'table', rows, widths: [1, 5] });
  out.add({ type: 'rule' });

  // The body: HTML, else RTF (often HTML wrapped in RTF), else plain text.
  const title = out.title;
  const html = msg.binary(0x1013);
  const htmlText = html ? decodeWith(html, msg.codepage) : msg.string(0x1013);
  const rtf = msg.binary(0x1009);
  const plain = msg.string(0x1000);
  if (htmlText && htmlText.trim()) htmlToBlocks(htmlText, out);
  else if (rtf) {
    let raw = null;
    try {
      raw = decompressRtf(rtf);
    } catch (err) {
      if (!plain) throw err;
    }
    if (raw && raw.length) rtfToBlocks(raw, out);
    else if (plain) txtToBlocks(plain, out);
  } else if (plain && plain.trim()) txtToBlocks(plain, out);
  else out.paragraph([{ text: '(This message has no text.)', italic: true }]);
  out.title = title;

  // Attachments: listed by name; JPEG and PNG pictures shown after the list.
  const attachments = cfb.storages.filter((s) => /^__attach_version1\.0_#[0-9A-F]{8}$/i.test(s)).sort();
  const names = [];
  const pictures = [];
  let messages = 0;
  for (const a of attachments.slice(0, 500)) {
    const p = props(cfb, `${a}/`, 8);
    const name = clean(p.string(0x3707) || p.string(0x3704) || p.string(0x3001)) || 'Unnamed attachment';
    const data = p.binary(0x3701);
    const embedded = cfb.storages.includes(`${a}/__substg1.0_3701000D`);
    if (embedded) messages++;
    names.push(data ? `${name} (${size(data.length)})` : name);
    if (data && sniffImage(data)) pictures.push({ data, name });
  }
  if (names.length) {
    out.paragraph([]);
    out.paragraph([makeRun(names.length === 1 ? 'Attachment: ' : 'Attachments: ', { bold: true }), makeRun(names.join(', '))]);
  }
  for (const pic of pictures) {
    const img = out.image(pic.data, { alt: pic.name });
    if (img) out.add(img);
  }
  if (messages) out.warn(messages === 1 ? 'An attached e-mail message is listed by name only.' : `${messages} attached e-mail messages are listed by name only.`);
  if (names.length > pictures.length) out.warn('Attachments other than JPEG and PNG pictures are listed by name only.');
}
