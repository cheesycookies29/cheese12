// PDF Studio (0.64): writing PDF files with Node's standard library only.
//
// The object model, shared with the reader (server/pdf/reader.js) so a page read from one PDF can be
// written into another:
//   name('Type')        a name: /Type
//   ref(12)             an indirect reference: 12 0 R (this writer's numbering)
//   str('text')         a text string (written as UTF-16 when it needs to be, for metadata)
//   bytes(Buffer)       a string of raw bytes: (…) as it was in the file
//   num(0.5) or 0.5     a number; true / false / null as they are
//   [ … ]               an array
//   { Type: name('Page'), … }   a dictionary (plain object, keys without the slash, in order)
//   new Stream(dict, Buffer)    a stream (its /Length is set when written)
// Content (page drawing) is built with Content; text uses the standard 14 fonts (Helvetica,
// Courier…) with WinAnsiEncoding, so nothing has to be embedded: encodeWinAnsi() maps what it can
// and replaces the rest.
import { deflateSync } from 'node:zlib';

export class Name { constructor(v) { this.v = String(v); } }
export class Ref { constructor(n) { this.n = n; } }
export class Str { constructor(v) { this.v = String(v); } }
export class Bytes { constructor(b) { this.b = Buffer.from(b); } }
export class Stream { constructor(dict, data) { this.dict = dict || {}; this.data = Buffer.from(data || ''); } }
export const name = (v) => new Name(v);
export const ref = (n) => new Ref(n);
export const str = (v) => new Str(v);
export const bytes = (b) => new Bytes(b);

// Page sizes in points (1/72 inch), portrait.
export const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a5: [419.53, 595.28] };

// Numbers as PDF writes them: never in exponent notation; up to 6 decimals (copied fonts can have
// matrices of 0.00048828125, which 3 decimals would turn into 0).
const fmt = (n) => {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(Math.abs(n) < 1 ? 10 : 6).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' || s === '' ? '0' : s;
};
// Characters a name may hold as they are (others as #xx).
const nameOut = (v) => `/${Buffer.from(v, 'utf8').toString('latin1').replace(/[^!-~]|[#%()<>[\]{}/]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;
const literal = (buf) => {
  let out = '(';
  for (const b of buf) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
    else if (b === 0x0a) out += '\\n';
    else if (b === 0x0d) out += '\\r';
    else if (b < 0x20 || b > 0x7e) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  return `${out})`;
};
// A text string: PDFDocEncoding (≈ Latin-1) when it fits, else UTF-16BE with a byte-order mark.
const textString = (s) => (/^[\x20-\x7e\xa0-\xff\n\t]*$/.test(s) ? literal(Buffer.from(s, 'latin1')) : `<FEFF${Buffer.from(s, 'utf16le').swap16().toString('hex').toUpperCase()}>`);

// One object, as PDF syntax.
export function serialize(v) {
  if (v === null || v === undefined) return 'null';
  if (v === true || v === false) return String(v);
  if (typeof v === 'number') return fmt(v);
  if (v instanceof Name) return nameOut(v.v);
  if (v instanceof Ref) return `${v.n} 0 R`;
  if (v instanceof Str) return textString(v.v);
  if (v instanceof Bytes) return literal(v.b);
  if (Array.isArray(v)) return `[${v.map(serialize).join(' ')}]`;
  if (v instanceof Stream) throw new Error('A stream must be its own object.');
  if (typeof v === 'object') return `<<${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${nameOut(k)} ${serialize(x)}`).join(' ')}>>`;
  if (typeof v === 'string') return nameOut(v); // a bare string is a name (convenience)
  throw new Error(`Cannot write ${typeof v} into a PDF.`);
}

// ---------- Text in the standard fonts ----------
// Windows-1252 for 0x80–0x9F; Latin-1 above. ₱ (not in the encoding) becomes "PHP ".
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
const REPLACE = { '₱': 'PHP ', '−': '-', '‐': '-', '‑': '-', '­': '', '​': '', '﻿': '', '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '≠': '!=', '✓': 'v', '✔': 'v', '✕': 'x', '☐': '[ ]', '☑': '[x]', '●': '•', '▪': '•', '‣': '•', '⁃': '-', ' ': ' ', ' ': ' ', ' ': ' ', '\t': '    ' };
export function encodeWinAnsi(s) {
  const out = [];
  for (const ch of String(s ?? '').normalize('NFC')) {
    const rep = REPLACE[ch];
    if (rep !== undefined) {
      for (const c of rep) out.push(c === '•' ? 0x95 : c.charCodeAt(0));
      continue;
    }
    const cp = ch.codePointAt(0);
    if (cp >= 0x20 && cp <= 0x7e) out.push(cp);
    else if (cp >= 0xa0 && cp <= 0xff) out.push(cp);
    else if (CP1252[cp]) out.push(CP1252[cp]);
    else if (cp >= 0x300 && cp <= 0x36f) continue; // a combining mark left after NFC
    else {
      // A letter with an accent the encoding lacks: the letter without it; otherwise "?".
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const b = base.codePointAt(0);
      out.push(base.length === 1 && b >= 0x20 && b <= 0x7e ? b : 0x3f);
    }
  }
  return Buffer.from(out);
}

// The characters of a text that the standard fonts cannot show (they come out as "?"), at most
// `max` of them, each once: for saying so (QA 0.65.1: they were replaced silently).
export function missingChars(text, max = 8) {
  const out = new Set();
  for (const ch of String(text ?? '')) {
    if (ch === '?' || ch.codePointAt(0) < 0x80) continue;
    const enc = encodeWinAnsi(ch);
    if (enc.length === 1 && enc[0] === 0x3f) out.add(ch);
    if (out.size >= max) break;
  }
  return [...out];
}
const MISSING_NOTE = (chars) => `Some characters cannot be shown in the PDF's standard fonts and appear as “?”: ${chars.join(' ')}.`;
export { MISSING_NOTE };

// Glyph widths (per 1000 units of the font size) of Helvetica and Helvetica-Bold for 32–126, from
// the Adobe font metrics; the oblique faces have the same widths; Courier is 600 throughout.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// 128–255 (WinAnsi): an accented letter is as wide as its letter; the rest, roughly.
const HIGH = { 0x80: 556, 0x82: 222, 0x83: 556, 0x84: 333, 0x85: 1000, 0x86: 556, 0x87: 556, 0x88: 333, 0x89: 1000, 0x8b: 333, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x98: 333, 0x99: 1000, 0x9b: 333, 0xa0: 278, 0xa9: 737, 0xab: 556, 0xae: 737, 0xb0: 400, 0xb7: 278, 0xbb: 556, 0xd7: 584, 0xdf: 611, 0xf7: 584 };
const latinBase = (b) => {
  const ch = Buffer.from([b]).toString('latin1');
  const base = (b >= 0x80 && b <= 0x9f ? '' : ch.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  return base.length === 1 && base.charCodeAt(0) < 0x7f ? base.charCodeAt(0) : null;
};
// Times (0.65, for text edited in a serif document): widths of Times-Roman and Times-Bold; the
// italic faces are close enough to them for laying out a line.
const TIMES = [250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541];
const TIMESB = [250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500, 930, 722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778, 611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667, 333, 278, 333, 581, 500, 333, 500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500, 556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520];
// New faces go at the end: a face's resource name (F1, F2…) is its place in this list.
export const FONTS = {
  regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique', mono: 'Courier', monoBold: 'Courier-Bold',
  serif: 'Times-Roman', serifBold: 'Times-Bold', serifItalic: 'Times-Italic', serifBoldItalic: 'Times-BoldItalic', monoItalic: 'Courier-Oblique', monoBoldItalic: 'Courier-BoldOblique',
};
// The face for a family ('sans' | 'serif' | 'mono') with bold and italic.
export function faceOf(family, bold, italic) {
  if (family === 'serif') return bold && italic ? FONTS.serifBoldItalic : bold ? FONTS.serifBold : italic ? FONTS.serifItalic : FONTS.serif;
  if (family === 'mono') return bold && italic ? FONTS.monoBoldItalic : bold ? FONTS.monoBold : italic ? FONTS.monoItalic : FONTS.mono;
  return bold && italic ? FONTS.boldItalic : bold ? FONTS.bold : italic ? FONTS.italic : FONTS.regular;
}
const isBold = (font) => /Bold/.test(font);
// Width of encoded bytes in a font, in points at `size`.
export function widthOf(buf, font, size) {
  if (/^Courier/.test(font)) return buf.length * 600 * size / 1000;
  const table = /^Times/.test(font) ? (isBold(font) ? TIMESB : TIMES) : isBold(font) ? HELVB : HELV;
  let w = 0;
  for (const b of buf) {
    if (b >= 32 && b <= 126) w += table[b - 32];
    else if (HIGH[b]) w += HIGH[b];
    else {
      const base = latinBase(b);
      w += base ? table[base - 32] : 556;
    }
  }
  return (w * size) / 1000;
}
export const textWidth = (s, font, size) => widthOf(encodeWinAnsi(s), font, size);

// ---------- Drawing on a page ----------
// y is from the bottom of the page (PDF's way); `top()` helpers in the layout turn it around.
// prefix: put before every resource name it uses (an overlay on a page read from another PDF uses
// 'Core', so its fonts never clash with the page's own /F1).
export class Content {
  constructor({ prefix = '' } = {}) { this.ops = []; this.fonts = new Set(); this.images = new Set(); this.states = new Set(); this.prefix = prefix; }
  raw(s) { this.ops.push(s); return this; }
  save() { return this.raw('q'); }
  restore() { return this.raw('Q'); }
  color(r, g, b) { return this.raw(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`); }
  stroke(r, g, b) { return this.raw(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG`); }
  lineWidth(w) { return this.raw(`${fmt(w)} w`); }
  // Fill and/or outline a rectangle (x, y from the bottom left).
  rect(x, y, w, h, { fill = false, stroke = true } = {}) { return this.raw(`${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`); }
  line(x1, y1, x2, y2) { return this.raw(`${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S`); }
  // Text in one of FONTS' faces (by the base font name), at the baseline (x, y).
  text(x, y, s, font = FONTS.regular, size = 11, { underline = false } = {}) {
    const buf = Buffer.isBuffer(s) ? s : encodeWinAnsi(s);
    if (!buf.length) return this;
    this.fonts.add(font);
    this.raw(`BT /${this.prefix}${fontKey(font)} ${fmt(size)} Tf ${fmt(x)} ${fmt(y)} Td ${literal(buf)} Tj ET`);
    if (underline) this.save().lineWidth(Math.max(0.5, size / 18)).line(x, y - size * 0.12, x + widthOf(buf, font, size), y - size * 0.12).restore();
    return this;
  }
  // Text turned by `angle` degrees about (x, y) (a watermark).
  textRotated(x, y, s, font, size, angle) {
    const buf = encodeWinAnsi(s);
    this.fonts.add(font);
    const a = (angle * Math.PI) / 180;
    return this.raw(`BT /${this.prefix}${fontKey(font)} ${fmt(size)} Tf ${fmt(Math.cos(a))} ${fmt(Math.sin(a))} ${fmt(-Math.sin(a))} ${fmt(Math.cos(a))} ${fmt(x)} ${fmt(y)} Tm ${literal(buf)} Tj ET`);
  }
  // An image XObject (by its resource key) drawn into the box.
  image(key, x, y, w, h) { this.images.add(key); return this.raw(`q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(y)} cm /${this.prefix}${key} Do Q`); }
  // Everything after this is drawn through the matrix [a b c d e f] (until restore()).
  transform(a, b, c, d, e, f) { return this.raw(`${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)} ${fmt(e)} ${fmt(f)} cm`); }
  // See-through fill and stroke (0–1), through an ExtGState.
  // multiply: the colour darkens what is under it, as a highlighter does (text stays crisp).
  opacity(a, { multiply = false } = {}) {
    const key = `${multiply ? 'GM' : 'GA'}${Math.round(a * 100)}`;
    this.states.add(key);
    return this.raw(`/${this.prefix}${key} gs`);
  }
  toBuffer() { return Buffer.from(this.ops.join('\n'), 'latin1'); }
}
const fontKey = (font) => `F${Object.values(FONTS).indexOf(font) + 1 || 1}`;

// ---------- The file ----------
export class PdfWriter {
  constructor({ title = '', author = '', subject = '', keywords = '', creator = 'CORE PDF Studio' } = {}) {
    this.objects = [null]; // 1-based; null: reserved, not yet set
    this.pages = [];
    this.info = { title, author, subject, keywords, creator };
    this.catalog = this.alloc();
    this.pageTree = this.alloc();
    this.fontRefs = {};
    this.stateRefs = {};
  }
  alloc() { this.objects.push(null); return this.objects.length - 1; }
  set(id, value) { this.objects[id] = value; return id; }
  add(value) { return this.set(this.alloc(), value); }
  // A stream, deflated unless it is already compressed (a JPEG) or says it has a filter.
  stream(dict, data, { compress = true } = {}) {
    const buf = Buffer.from(data);
    if (compress && !dict.Filter && buf.length > 64) return this.add(new Stream({ ...dict, Filter: name('FlateDecode') }, deflateSync(buf)));
    return this.add(new Stream(dict, buf));
  }
  font(base) {
    if (!this.fontRefs[base]) this.fontRefs[base] = this.add({ Type: name('Font'), Subtype: name('Type1'), BaseFont: name(base), ...(/^(Symbol|ZapfDingbats)$/.test(base) ? {} : { Encoding: name('WinAnsiEncoding') }) });
    return ref(this.fontRefs[base]);
  }
  extGState(key) {
    if (!this.stateRefs[key]) {
      const a = Number(key.slice(2)) / 100;
      this.stateRefs[key] = this.add({ Type: name('ExtGState'), ca: a, CA: a, ...(key.startsWith('GM') ? { BM: name('Multiply') } : {}) });
    }
    return ref(this.stateRefs[key]);
  }
  // The resources a Content uses, merged into `base` (a page's own resources, for an overlay).
  resourcesFor(content, base = {}, images = {}) {
    const res = { ...base };
    const p = content.prefix;
    if (content.fonts.size) {
      res.Font = { ...(res.Font || {}) };
      for (const f of content.fonts) res.Font[`${p}${fontKey(f)}`] = this.font(f);
    }
    if (content.states.size) {
      res.ExtGState = { ...(res.ExtGState || {}) };
      for (const s of content.states) res.ExtGState[`${p}${s}`] = this.extGState(s);
    }
    if (content.images.size) {
      res.XObject = { ...(res.XObject || {}) };
      for (const k of content.images) res.XObject[`${p}${k}`] = ref(images[k]);
    }
    if (!res.ProcSet) res.ProcSet = [name('PDF'), name('Text'), name('ImageB'), name('ImageC')];
    return res;
  }
  // A page from Content: size [w, h]; images: { key: object id } it draws.
  addContentPage(content, size, { images = {}, rotate = 0 } = {}) {
    const contents = this.stream({}, content.toBuffer());
    return this.addPage({ MediaBox: [0, 0, size[0], size[1]], Resources: this.resourcesFor(content, {}, images), Contents: ref(contents), ...(rotate ? { Rotate: rotate } : {}) });
  }
  // A page dictionary (Parent is set here). Returns its object id.
  addPage(dict) {
    const id = this.add({ Type: name('Page'), Parent: ref(this.pageTree), ...dict });
    this.pages.push(id);
    return id;
  }
  toBuffer() {
    this.set(this.pageTree, { Type: name('Pages'), Kids: this.pages.map(ref), Count: this.pages.length });
    this.set(this.catalog, { Type: name('Catalog'), Pages: ref(this.pageTree) });
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const date = `D:${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    const info = this.add({
      ...(this.info.title ? { Title: str(this.info.title) } : {}), ...(this.info.author ? { Author: str(this.info.author) } : {}),
      ...(this.info.subject ? { Subject: str(this.info.subject) } : {}), ...(this.info.keywords ? { Keywords: str(this.info.keywords) } : {}),
      Creator: str(this.info.creator), Producer: str('CORE PDF Studio (Lancaster)'), CreationDate: bytes(Buffer.from(date)), ModDate: bytes(Buffer.from(date)),
    });
    const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = parts[0].length;
    const offsets = [0];
    for (let i = 1; i < this.objects.length; i++) {
      const v = this.objects[i];
      let chunk;
      if (v instanceof Stream) {
        const head = Buffer.from(`${i} 0 obj\n${serialize({ ...v.dict, Length: v.data.length })}\nstream\n`, 'latin1');
        chunk = Buffer.concat([head, v.data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      } else chunk = Buffer.from(`${i} 0 obj\n${serialize(v === undefined ? null : v)}\nendobj\n`, 'latin1');
      offsets.push(offset);
      parts.push(chunk);
      offset += chunk.length;
    }
    const xref = [`xref\n0 ${this.objects.length}\n0000000000 65535 f \n`, ...offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    const id = Buffer.from(`${now.getTime()}-${this.objects.length}`).toString('hex').slice(0, 32).padEnd(32, '0');
    parts.push(Buffer.from(`${xref}trailer\n<</Size ${this.objects.length} /Root ${this.catalog} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>]>>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(parts);
  }
}
