// PDF Studio (0.64): reading PDF files with Node's standard library only, so their pages can be
// shown (size, turn, a thumbnail of a scan, a line of text) and copied into a new PDF made with
// PdfWriter (server/pdf/writer.js).
//
// A PDF is a heap of numbered objects with a table at the end saying where each one starts. The
// reader finds that table (a classic "xref" table, a compressed cross-reference stream, or both, and
// the older tables of earlier revisions through /Prev), then parses objects only when they are asked
// for and keeps them. When the table is missing or points to the wrong places, as in files cut short
// or edited by careless tools, it rebuilds one by looking through the file for "12 0 obj".
//
// Values come out in the writer's model (Name, Bytes, numbers, arrays, plain objects for
// dictionaries), except references, which stay the reader's own PdfRef until they are copied:
// writer.ref(n) always means the writer's numbering, and the two must never be mixed up. Streams are
// kept as they are in the file (still compressed); importPages copies them byte for byte, so
// fonts, pictures and drawings come through exactly as they were. Encrypted PDFs are refused, since
// their strings and streams cannot be read without the password.
import { inflateSync, inflateRawSync, constants as zlibConstants } from 'node:zlib';
import { Name, Ref, Bytes, Stream, ref } from './writer.js';

const MB = 1024 * 1024;
// Decoded content (the drawing of one page) is read only for a caption, so 20 MB is plenty; the
// cross-reference and object streams that hold the file's structure may be larger.
const MAX_CONTENT_BYTES = 20 * MB;
const MAX_STRUCTURE_BYTES = 64 * MB;
// Object streams are kept decoded once read; all of a file's together may hold this much, so a
// file cannot fill the server's memory by spreading its pages over many huge ones.
const MAX_OBJSTM_TOTAL = 256 * MB;
// How deeply arrays and dictionaries may nest, and how deep the page tree may go. Real files stay
// far below both; the limits keep a hostile file from exhausting the stack.
const MAX_NESTING = 100;
const MAX_TREE_DEPTH = 64;
// A page with no MediaBox anywhere is US Letter, as viewers assume.
const DEFAULT_BOX = [0, 0, 612, 792];

const MESSAGES = {
  notPdf: 'This file is not a PDF. Choose a PDF file and upload it again.',
  encrypted: 'This PDF is protected with a password or encryption. Save an unprotected copy and upload that.',
  damaged: 'This PDF is damaged and cannot be read. Open it in a PDF viewer, save or print it as a new PDF, and upload that.',
};
function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}
// The codes of the errors above, which are passed on to the caller as they are.
const MESSAGE_CODES = new Set(['not-pdf', 'encrypted', 'damaged', 'too-many-pages', 'too-many-objects']);

// A reference to another object of the file being read ("12 0 R"). It is deliberately not the
// writer's Ref: a page copied into a new PDF gets new numbers there, so every PdfRef is translated
// on the way out (see importPages).
class PdfRef { constructor(num, gen) { this.num = num; this.gen = gen; } }
// A stream as it is in the file: its dictionary and its bytes, still encoded.
class PdfStream { constructor(dict, raw) { this.dict = dict; this.raw = raw; } }
// A bare word that is not a value: an operator in page content ("Tj", "re") or a structural word
// ("endobj", "stream") met where a value was expected.
class Keyword { constructor(v) { this.v = v; } }

const isDict = (v) => v !== null && typeof v === 'object' && v.constructor === Object;
const nameOf = (v) => (v instanceof Name ? v.v : null);
const toArray = (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);

// ---------- Reading values ----------
const WHITE = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WHITE[c] = 1;
const DELIM = new Uint8Array(256);
for (const c of '()<>[]{}/%') DELIM[c.charCodeAt(0)] = 1;
const isRegular = (c) => c !== undefined && !WHITE[c] && !DELIM[c];
const HEX = (c) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);
const DIGITS = /^\d+$/;
// Words that end an object: met inside an array or dictionary, they mean it was never closed.
const ENDS = new Set(['endobj', 'stream', 'endstream', 'obj', 'xref', 'trailer']);

// Reads PDF values from a buffer, from `pos` up to `end`. `doc` (optional) resolves a stream's
// /Length when it is a reference to another object.
class Parser {
  constructor(buf, pos = 0, end = buf.length, doc = null) {
    this.buf = buf;
    this.pos = pos;
    this.end = Math.min(end, buf.length);
    this.doc = doc;
  }

  // Skips white space and comments (% to the end of the line).
  skipSpace() {
    const { buf, end } = this;
    while (this.pos < end) {
      const c = buf[this.pos];
      if (WHITE[c]) this.pos++;
      else if (c === 0x25) {
        while (this.pos < end && buf[this.pos] !== 10 && buf[this.pos] !== 13) this.pos++;
      } else break;
    }
  }

  // A run of regular characters: a number or a keyword.
  word() {
    const start = this.pos;
    while (this.pos < this.end && isRegular(this.buf[this.pos])) this.pos++;
    return this.buf.toString('latin1', start, this.pos);
  }

  // A whole number (for cross-reference tables and object headers), or null.
  int() {
    this.skipSpace();
    const w = this.word();
    return DIGITS.test(w) ? Number(w) : null;
  }

  startsWith(s) {
    for (let i = 0; i < s.length; i++) if (this.buf[this.pos + i] !== s.charCodeAt(i)) return false;
    return true;
  }

  value(depth = 0) {
    if (depth > MAX_NESTING) throw new Error('Values nested too deeply.');
    this.skipSpace();
    if (this.pos >= this.end) throw new Error('Unexpected end of data.');
    const c = this.buf[this.pos];
    if (c === 0x2f) return this.name();
    if (c === 0x28) return this.literal();
    if (c === 0x3c) return this.buf[this.pos + 1] === 0x3c ? this.dict(depth) : this.hex();
    if (c === 0x5b) return this.array(depth);
    if (!isRegular(c)) {
      // A stray ")", ">", "]", "{" or "}": step over it so reading always moves on.
      this.pos++;
      return new Keyword(String.fromCharCode(c));
    }
    const w = this.word();
    const first = w.charCodeAt(0);
    if ((first >= 48 && first <= 57) || first === 43 || first === 45 || first === 46) {
      // A whole number may be the start of a reference, "12 0 R".
      if (DIGITS.test(w)) {
        const save = this.pos;
        this.skipSpace();
        const gen = this.word();
        if (DIGITS.test(gen)) {
          this.skipSpace();
          if (this.buf[this.pos] === 0x52 && !isRegular(this.buf[this.pos + 1])) {
            this.pos++;
            return new PdfRef(Number(w), Number(gen));
          }
        }
        this.pos = save;
        return Number(w);
      }
      // "+3", ".5", "-.5"; a malformed number ("--5", "1.2.3") reads as what it starts with, or 0.
      const n = parseFloat(w.replace(/^([+-])[+-]+/, '$1'));
      return Number.isFinite(n) ? n : 0;
    }
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return new Keyword(w);
  }

  // /Name, with #xx escapes. Names are kept as UTF-8 text, the way the writer writes them back.
  name() {
    this.pos++;
    const bytes = [];
    while (this.pos < this.end && isRegular(this.buf[this.pos])) {
      const c = this.buf[this.pos++];
      if (c === 0x23) {
        const h = HEX(this.buf[this.pos]);
        const l = HEX(this.buf[this.pos + 1]);
        if (h >= 0 && l >= 0) {
          bytes.push(h * 16 + l);
          this.pos += 2;
          continue;
        }
      }
      bytes.push(c);
    }
    return new Name(Buffer.from(bytes).toString(bytes.every((b) => b < 0x80) ? 'latin1' : 'utf8'));
  }

  // (A literal string), with nested parentheses and backslash escapes.
  literal() {
    const { buf, end } = this;
    this.pos++;
    const out = [];
    let depth = 1;
    while (this.pos < end) {
      const c = buf[this.pos++];
      if (c === 0x28) { depth++; out.push(c); }
      else if (c === 0x29) {
        if (--depth === 0) break;
        out.push(c);
      } else if (c === 0x5c) {
        const n = buf[this.pos++];
        if (n === 0x6e) out.push(10);
        else if (n === 0x72) out.push(13);
        else if (n === 0x74) out.push(9);
        else if (n === 0x62) out.push(8);
        else if (n === 0x66) out.push(12);
        else if (n >= 0x30 && n <= 0x37) {
          // Up to three octal digits.
          let v = n - 0x30;
          for (let k = 0; k < 2 && buf[this.pos] >= 0x30 && buf[this.pos] <= 0x37; k++) v = v * 8 + buf[this.pos++] - 0x30;
          out.push(v & 0xff);
        } else if (n === 0x0d) {
          // A backslash at the end of a line continues the string on the next.
          if (buf[this.pos] === 0x0a) this.pos++;
        } else if (n === 0x0a) {
          // (as above)
        } else if (n !== undefined) out.push(n); // \( \) \\ and an unknown escape: the character itself
      } else if (c === 0x0d) {
        // An end of line inside a string is a line feed, whichever kind the file uses.
        out.push(10);
        if (buf[this.pos] === 0x0a) this.pos++;
      } else out.push(c);
    }
    return new Bytes(out);
  }

  // <48656C6C6F>: hex digits, white space ignored, an odd last digit followed by 0.
  hex() {
    this.pos++;
    const out = [];
    let high = -1;
    while (this.pos < this.end) {
      const c = this.buf[this.pos++];
      if (c === 0x3e) break;
      const v = HEX(c);
      if (v < 0) continue;
      if (high < 0) high = v;
      else { out.push(high * 16 + v); high = -1; }
    }
    if (high >= 0) out.push(high * 16);
    return new Bytes(out);
  }

  array(depth) {
    this.pos++;
    const out = [];
    for (;;) {
      this.skipSpace();
      if (this.pos >= this.end) break;
      if (this.buf[this.pos] === 0x5d) { this.pos++; break; }
      const save = this.pos;
      const v = this.value(depth + 1);
      if (v instanceof Keyword) {
        if (ENDS.has(v.v)) { this.pos = save; break; }
        continue;
      }
      out.push(v);
    }
    return out;
  }

  dict(depth) {
    this.pos += 2;
    const out = {};
    for (;;) {
      this.skipSpace();
      if (this.pos >= this.end) break;
      if (this.buf[this.pos] === 0x3e && this.buf[this.pos + 1] === 0x3e) { this.pos += 2; break; }
      const save = this.pos;
      const key = this.value(depth + 1);
      if (!(key instanceof Name)) {
        // Not a key: a broken dictionary. Stop at a word that ends the object; skip anything else.
        if (key instanceof Keyword && ENDS.has(key.v)) { this.pos = save; break; }
        continue;
      }
      this.skipSpace();
      if (this.buf[this.pos] === 0x3e && this.buf[this.pos + 1] === 0x3e) { this.pos += 2; break; }
      const valueAt = this.pos;
      let v = this.value(depth + 1);
      if (v instanceof Keyword) {
        if (ENDS.has(v.v)) { this.pos = valueAt; break; }
        v = null;
      }
      // "__proto__" would change the object rather than add a key; no real PDF uses it.
      if (key.v !== '__proto__') out[key.v] = v;
    }
    return out;
  }

  // "12 0 obj … endobj" here: { num, gen, value }, or null when there is no object header here.
  indirect() {
    const num = this.int();
    const gen = this.int();
    this.skipSpace();
    if (num === null || gen === null || this.word() !== 'obj') return null;
    let value = this.value(0);
    if (value instanceof Keyword) value = null;
    if (isDict(value)) {
      this.skipSpace();
      if (this.startsWith('stream')) {
        this.pos += 6;
        // The keyword is followed by CR LF or LF (a lone CR is tolerated) and then the data.
        if (this.buf[this.pos] === 0x0d) this.pos++;
        if (this.buf[this.pos] === 0x0a) this.pos++;
        value = new PdfStream(value, this.streamData(value, this.pos));
      }
    }
    return { num, gen, value };
  }

  // A stream's bytes. /Length is trusted only when "endstream" really follows where it says; a
  // wrong length (a common fault of files edited by hand or by careless tools) falls back to the
  // next "endstream" in the file.
  streamData(dict, start) {
    let len = dict.Length;
    if (len instanceof PdfRef && this.doc) len = this.doc.resolve(len);
    if (Number.isInteger(len) && len >= 0 && start + len <= this.buf.length) {
      let at = start + len;
      while (at < this.buf.length && at < start + len + 4 && WHITE[this.buf[at]]) at++;
      if (this.buf.toString('latin1', at, at + 9) === 'endstream') return this.buf.subarray(start, start + len);
    }
    let stop = this.buf.indexOf('endstream', start, 'latin1');
    if (stop < 0) stop = this.buf.length;
    if (this.buf[stop - 1] === 0x0a) stop--;
    if (this.buf[stop - 1] === 0x0d) stop--;
    return this.buf.subarray(start, Math.max(start, stop));
  }
}

// ---------- Decoding streams ----------
// zlib data, tolerating a stream cut short or written without its zlib header.
function inflate(data, limit) {
  const tooLarge = (err) => err && err.code === 'ERR_BUFFER_TOO_LARGE';
  try { return inflateSync(data, { maxOutputLength: limit }); } catch (err) { if (tooLarge(err)) throw err; }
  try { return inflateSync(data, { maxOutputLength: limit, finishFlush: zlibConstants.Z_SYNC_FLUSH }); } catch (err) { if (tooLarge(err)) throw err; }
  return inflateRawSync(data, { maxOutputLength: limit, finishFlush: zlibConstants.Z_SYNC_FLUSH });
}

// PNG predictors (10–15): each row starts with a byte saying how it was predicted from the row
// above and the byte to its left. Cross-reference streams almost always use "Up" (12).
function unpredictPng(data, colors, bpc, columns) {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  if (rowLen <= 0) return data;
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = Buffer.alloc(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1;
    const dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const raw = data[src + i];
      const left = i >= bpp ? out[dst + i - bpp] : 0;
      const up = r > 0 ? out[dst - rowLen + i] : 0;
      const upLeft = r > 0 && i >= bpp ? out[dst - rowLen + i - bpp] : 0;
      let v = raw;
      if (type === 1) v = raw + left;
      else if (type === 2) v = raw + up;
      else if (type === 3) v = raw + ((left + up) >> 1);
      else if (type === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      out[dst + i] = v; // a Uint8Array keeps the low 8 bits
    }
  }
  return out;
}

// The TIFF predictor (2), for 8 bits per component: each byte is the difference from the one to its left.
function unpredictTiff(data, colors, bpc, columns) {
  if (bpc !== 8) return data;
  const rowLen = colors * columns;
  const out = Buffer.from(data);
  for (let r = 0; r + rowLen <= out.length; r += rowLen) for (let i = colors; i < rowLen; i++) out[r + i] += out[r + i - colors];
  return out;
}

function asciiHex(data) {
  return new Parser(Buffer.concat([Buffer.from('<'), data, Buffer.from('>')])).hex().b;
}

function ascii85(data) {
  const out = [];
  let group = [];
  const flush = (n, count) => {
    const bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    for (let k = 0; k < count; k++) out.push(bytes[k]);
  };
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 0x7e) break; // "~>" ends the data
    if (c === 0x7a && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    if (c < 0x21 || c > 0x75) continue;
    group.push(c - 33);
    if (group.length === 5) {
      flush(group.reduce((n, g) => n * 85 + g, 0), 4);
      group = [];
    }
  }
  if (group.length > 1) {
    const count = group.length - 1;
    while (group.length < 5) group.push(84);
    flush(group.reduce((n, g) => n * 85 + g, 0), count);
  }
  return Buffer.from(out);
}

// ---------- Text strings (document title and author) ----------
// PDFDocEncoding is Latin-1 except for these.
const PDFDOC = {
  0x18: 0x02d8, 0x19: 0x02c7, 0x1a: 0x02c6, 0x1b: 0x02d9, 0x1c: 0x02dd, 0x1d: 0x02db, 0x1e: 0x02da, 0x1f: 0x02dc,
  0x80: 0x2022, 0x81: 0x2020, 0x82: 0x2021, 0x83: 0x2026, 0x84: 0x2014, 0x85: 0x2013, 0x86: 0x0192, 0x87: 0x2044,
  0x88: 0x2039, 0x89: 0x203a, 0x8a: 0x2212, 0x8b: 0x2030, 0x8c: 0x201e, 0x8d: 0x201c, 0x8e: 0x201d, 0x8f: 0x2018,
  0x90: 0x2019, 0x91: 0x201a, 0x92: 0x2122, 0x93: 0xfb01, 0x94: 0xfb02, 0x95: 0x0141, 0x96: 0x0152, 0x97: 0x0160,
  0x98: 0x0178, 0x99: 0x017d, 0x9a: 0x0131, 0x9b: 0x0142, 0x9c: 0x0153, 0x9d: 0x0161, 0x9e: 0x017e, 0xa0: 0x20ac,
};
// Windows-1252 for 0x80–0x9F, the usual encoding of simple fonts' text (for captions).
const CP1252 = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function decodeText(v) {
  if (v instanceof Name) return v.v || null;
  if (!(v instanceof Bytes)) return null;
  const b = v.b;
  let s;
  if (b[0] === 0xfe && b[1] === 0xff) {
    const body = Buffer.from(b.subarray(2, 2 + ((b.length - 2) & ~1)));
    // UTF-16 text may carry language marks between two ESC characters; they are not text.
    s = body.swap16().toString('utf16le').replace(/\u001b[^\u001b]*\u001b/g, '');
  } else if (b[0] === 0xff && b[1] === 0xfe) s = b.subarray(2).toString('utf16le');
  else if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) s = b.subarray(3).toString('utf8');
  else s = String.fromCodePoint(...Array.from(b, (c) => PDFDOC[c] || c));
  s = s.replace(/\u0000/g, '').trim();
  return s || null;
}

// ---------- The document ----------
// What readPdf knows about a file, kept out of sight of callers (who get the plain handle).
const internals = new WeakMap();

class Source {
  constructor(buf, { maxObjects, maxPages }) {
    this.buf = buf;
    this.maxObjects = maxObjects;
    this.maxPages = maxPages;
    this.entries = new Map(); // object number → { type: 1, offset } or { type: 2, stream, index }
    this.trailer = {};
    this.cache = new Map(); // object number → parsed value (null when it cannot be read)
    this.loading = new Set(); // objects being parsed now, to stop an object that needs itself
    this.objStms = new Map(); // object stream number → { data, first, offsets } or null
    this.objStmBytes = 0; // how much the decoded object streams hold
    this.found = null; // object number → offset, from looking through the whole file (made once)
    this.copies = new WeakMap(); // writer → (object number here → object id there), for importPages
  }

  setEntry(num, entry) {
    if (this.entries.has(num)) return; // a later revision has already said where this object is
    this.entries.set(num, entry);
    if (this.entries.size > this.maxObjects) throw tooManyObjects(this.maxObjects);
  }

  resolve(v) {
    // A reference may lead to another reference; a few steps are allowed, a loop is not.
    for (let i = 0; i < 8 && v instanceof PdfRef; i++) v = this.get(v.num);
    return v instanceof PdfRef ? null : v === undefined ? null : v;
  }

  get(num) {
    if (this.cache.has(num)) return this.cache.get(num);
    if (this.loading.has(num)) return null;
    this.loading.add(num);
    let value = null;
    try { value = this.load(num); } catch { value = null; } finally { this.loading.delete(num); }
    this.cache.set(num, value);
    return value;
  }

  load(num) {
    const entry = this.entries.get(num);
    if (entry && entry.type === 2) return this.fromObjStm(entry.stream, num);
    if (entry && entry.type === 1) {
      const v = this.parseAt(entry.offset, num);
      if (v !== undefined) return v;
    }
    // The table is wrong about this object, or does not list it: look for "num gen obj" in the file.
    const at = this.findObjects().get(num);
    if (at !== undefined && (!entry || at !== entry.offset)) {
      const v = this.parseAt(at, num);
      if (v !== undefined) return v;
    }
    return null;
  }

  // The object at `offset`, if the header there is the one expected; undefined otherwise.
  parseAt(offset, num) {
    if (!(offset >= 0 && offset < this.buf.length)) return undefined;
    try {
      const found = new Parser(this.buf, offset, this.buf.length, this).indirect();
      if (!found || found.num !== num) return undefined;
      return found.value;
    } catch {
      return null;
    }
  }

  fromObjStm(stmNum, num) {
    if (!this.objStms.has(stmNum)) {
      let loaded = null;
      try { loaded = this.loadObjStm(stmNum); } catch { loaded = null; }
      this.objStms.set(stmNum, loaded);
    }
    const s = this.objStms.get(stmNum);
    const at = s && s.offsets.get(num);
    if (at === undefined) return null;
    const v = new Parser(s.data, s.first + at, s.data.length, this).value(0);
    return v instanceof Keyword ? null : v;
  }

  // An object stream: N pairs "object-number offset", then the objects themselves from /First.
  loadObjStm(stmNum) {
    const stream = this.get(stmNum);
    if (!(stream instanceof PdfStream)) return null;
    const n = this.resolve(stream.dict.N);
    const first = this.resolve(stream.dict.First);
    if (!Number.isInteger(n) || !Number.isInteger(first) || n < 0 || first < 0 || n > this.maxObjects) return null;
    const data = this.decode(stream, Math.min(MAX_STRUCTURE_BYTES, MAX_OBJSTM_TOTAL - this.objStmBytes));
    this.objStmBytes += data.length;
    const p = new Parser(data, 0, Math.min(first, data.length));
    const offsets = new Map();
    for (let i = 0; i < n; i++) {
      const objNum = p.int();
      const at = p.int();
      if (objNum === null || at === null) break;
      if (!offsets.has(objNum)) offsets.set(objNum, at);
    }
    return { data, first, offsets };
  }

  // A stream's decoded bytes. Only the filters that structure and text use are known; anything
  // else (pictures, LZW from very old files) throws, and callers treat that as "cannot read".
  decode(stream, limit) {
    const filters = toArray(this.resolve(stream.dict.Filter)).map((f) => nameOf(this.resolve(f)));
    const parms = toArray(this.resolve(stream.dict.DecodeParms ?? stream.dict.DP));
    let data = stream.raw;
    filters.forEach((f, i) => {
      const p = this.resolve(parms[i]);
      if (f === 'FlateDecode' || f === 'Fl') data = this.unpredict(inflate(data, limit), isDict(p) ? p : {});
      else if (f === 'ASCIIHexDecode' || f === 'AHx') data = asciiHex(data);
      else if (f === 'ASCII85Decode' || f === 'A85') data = ascii85(data);
      else throw new Error(`The ${f} filter is not supported.`);
    });
    return data;
  }

  unpredict(data, parms) {
    const num = (v, d) => { const n = this.resolve(v); return Number.isInteger(n) && n > 0 ? n : d; };
    const predictor = num(parms.Predictor, 1);
    const colors = num(parms.Colors, 1);
    const bpc = num(parms.BitsPerComponent, 8);
    const columns = num(parms.Columns, 1);
    if (predictor >= 10) return unpredictPng(data, colors, bpc, columns);
    if (predictor === 2) return unpredictTiff(data, colors, bpc, columns);
    return data;
  }

  // ---------- The cross-reference table ----------
  // Reads every revision's table, newest first (so a later revision wins), and the trailers.
  // Returns false when the file's own tables cannot be used at all.
  loadXref() {
    const tail = this.buf.subarray(Math.max(0, this.buf.length - 2048));
    const at = tail.lastIndexOf('startxref', undefined, 'latin1');
    if (at < 0) return false;
    let offset = new Parser(tail, at + 9).int();
    const seen = new Set();
    let sections = 0;
    while (offset !== null && !seen.has(offset) && sections < 1000) {
      seen.add(offset);
      sections++;
      const trailer = this.readSection(offset);
      if (!trailer) return sections > 1; // an older revision unreadable: keep what the newer ones said
      // A hybrid file keeps the objects of its object streams in a cross-reference stream named by
      // /XRefStm; those entries come after the table's own and before the older revisions'.
      const stm = this.resolve(trailer.XRefStm);
      if (Number.isInteger(stm) && !seen.has(stm)) {
        seen.add(stm);
        this.readSection(stm);
      }
      for (const [k, v] of Object.entries(trailer)) if (!(k in this.trailer)) this.trailer[k] = v;
      const prev = trailer.Prev;
      offset = Number.isInteger(prev) ? prev : null;
    }
    return true;
  }

  // One cross-reference section at `offset`: a classic table or a cross-reference stream.
  // Returns its trailer dictionary, or null when there is none there.
  readSection(offset) {
    if (!(offset >= 0 && offset < this.buf.length)) return null;
    const p = new Parser(this.buf, offset, this.buf.length, this);
    p.skipSpace();
    try {
      if (p.startsWith('xref')) return this.readTable(p);
      const found = p.indirect();
      if (found && found.value instanceof PdfStream) return this.readXrefStream(found.value);
    } catch (err) {
      if (MESSAGE_CODES.has(err?.code)) throw err; // too many objects
    }
    return null;
  }

  // "xref", then subsections "first count" each followed by entries "offset gen n|f", then "trailer <<…>>".
  // Entries are read word by word rather than as 20-byte lines, since some writers use one-byte
  // line ends.
  readTable(p) {
    p.pos += 4;
    for (;;) {
      p.skipSpace();
      if (p.startsWith('trailer')) {
        p.pos += 7;
        const trailer = p.value(0);
        return isDict(trailer) ? trailer : null;
      }
      let first = p.int();
      const count = p.int();
      if (first === null || count === null) return null;
      if (count > this.maxObjects) throw tooManyObjects(this.maxObjects);
      for (let i = 0; i < count; i++) {
        const at = p.pos;
        const off = p.int();
        const gen = p.int();
        p.skipSpace();
        const kind = p.buf[p.pos++];
        if (off === null || gen === null) {
          // Fewer entries than the subsection claims: go on from what follows them.
          p.pos = at;
          break;
        }
        // A common mistake: the table starts at 1 though its first entry is object 0's.
        if (i === 0 && first === 1 && kind === 0x66 && off === 0 && gen === 65535) first = 0;
        // Free entries ("f") are not recorded, so a hybrid file's stream can still say where they are.
        if (kind === 0x6e) this.setEntry(first + i, { type: 1, offset: off });
      }
    }
  }

  // A cross-reference stream (PDF 1.5+): rows of /W [type field2 field3] big-endian numbers.
  readXrefStream(stream) {
    const dict = stream.dict;
    const w = toArray(this.resolve(dict.W)).map((x) => this.resolve(x));
    if (w.length < 3 || !w.every((x) => Number.isInteger(x) && x >= 0 && x <= 8)) return null;
    const size = this.resolve(dict.Size);
    const index = toArray(this.resolve(dict.Index ?? [0, size])).map((x) => this.resolve(x));
    const data = this.decode(stream, MAX_STRUCTURE_BYTES);
    const rowLen = w[0] + w[1] + w[2];
    let pos = 0;
    const read = (n, d) => {
      if (n === 0) return d;
      let v = 0;
      for (let k = 0; k < n; k++) v = v * 256 + data[pos++];
      return v;
    };
    for (let s = 0; s + 1 < index.length; s += 2) {
      const first = index[s];
      const count = index[s + 1];
      if (!Number.isInteger(first) || !Number.isInteger(count)) break;
      if (count > this.maxObjects) throw tooManyObjects(this.maxObjects);
      for (let i = 0; i < count && pos + rowLen <= data.length; i++) {
        const type = read(w[0], 1);
        const f2 = read(w[1], 0);
        const f3 = read(w[2], 0);
        if (type === 1) this.setEntry(first + i, { type: 1, offset: f2 });
        else if (type === 2) this.setEntry(first + i, { type: 2, stream: f2, index: f3 });
      }
    }
    return dict;
  }

  // Every "num gen obj" in the file, the last one of each number winning (it was written later).
  findObjects() {
    if (this.found) return this.found;
    this.found = new Map();
    const text = this.buf.toString('latin1');
    const re = /(?<![0-9])(\d{1,10})[\0\t\n\f\r ]+(\d{1,5})[\0\t\n\f\r ]+obj(?![A-Za-z])/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      this.found.set(Number(m[1]), m.index);
      if (this.found.size > this.maxObjects) throw tooManyObjects(this.maxObjects);
    }
    this.text = text;
    return this.found;
  }

  // Rebuilds the table from the objects found in the file, for files whose own table is missing
  // or wrong. Objects inside object streams are added from those streams; the trailer comes from
  // the "trailer" dictionaries and cross-reference streams found, or failing those, the catalog.
  rebuild() {
    this.entries = new Map();
    this.cache = new Map();
    this.objStms = new Map();
    this.trailer = {};
    const found = this.findObjects();
    for (const [num, offset] of found) this.setEntry(num, { type: 1, offset });
    const text = this.text;
    const trailers = [];
    let catalog = null;
    for (const [num, offset] of found) {
      // The dictionary of an object stream, a cross-reference stream or the catalog is short and
      // comes first; a look at the start of each object is enough to find them.
      const head = text.slice(offset, offset + 512);
      if (/\/Type\s*\/ObjStm\b/.test(head)) {
        let s = null;
        try { s = this.loadObjStm(num); } catch { s = null; }
        this.objStms.set(num, s);
        if (s) for (const objNum of s.offsets.keys()) if (!this.entries.has(objNum)) this.setEntry(objNum, { type: 2, stream: num });
      } else if (/\/Type\s*\/XRef\b/.test(head)) {
        const v = this.get(num);
        if (v instanceof PdfStream) trailers.push({ at: offset, dict: v.dict });
      } else if (/\/Type\s*\/Catalog\b/.test(head)) catalog = num;
    }
    const re = /trailer[\0\t\n\f\r ]*<</g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      try {
        const dict = new Parser(this.buf, m.index + 7, this.buf.length, this).value(0);
        if (isDict(dict)) trailers.push({ at: m.index, dict });
      } catch { /* not a trailer after all */ }
    }
    // The cache may hold objects read before the object streams were known.
    this.cache = new Map();
    trailers.sort((a, b) => b.at - a.at);
    for (const { dict } of trailers) {
      for (const [k, v] of Object.entries(dict)) {
        if (k in this.trailer) continue;
        if (k === 'Root' && !isDict(this.resolve(v))) continue;
        this.trailer[k] = v;
      }
    }
    if (!this.trailer.Root && catalog !== null) this.trailer.Root = new PdfRef(catalog, 0);
  }

  // The catalog, when it leads to a page tree.
  catalog() {
    const root = this.resolve(this.trailer.Root);
    return isDict(root) && isDict(this.resolve(root.Pages)) ? root : null;
  }

  // ---------- Pages ----------
  // The pages in order, depth first through the page tree, each with the attributes it inherits
  // from the nodes above it. /Count is not trusted; loops and very deep trees are cut off.
  collectPages(root) {
    const pages = [];
    const visited = new Set();
    const walk = (node, inherited, depth) => {
      if (depth > MAX_TREE_DEPTH) return;
      if (node instanceof PdfRef) {
        if (visited.has(node.num)) return;
        visited.add(node.num);
      }
      const dict = this.resolve(node);
      if (!isDict(dict)) return;
      const attrs = { ...inherited };
      for (const k of INHERITED) if (dict[k] !== undefined && dict[k] !== null) attrs[k] = dict[k];
      const type = nameOf(this.resolve(dict.Type));
      const kids = this.resolve(dict.Kids);
      if (type === 'Pages' || (type !== 'Page' && Array.isArray(kids))) {
        for (const kid of toArray(kids)) walk(kid, attrs, depth + 1);
        return;
      }
      if (pages.length >= this.maxPages) throw fail('too-many-pages', `This PDF has more than ${this.maxPages} pages, more than PDF Studio can take in one file. Split it into smaller PDFs and upload those.`);
      pages.push({ dict, attrs });
    };
    walk(root.Pages, {}, 0);
    return pages;
  }

  // [x1 y1 x2 y2] with x1 < x2 and y1 < y2, or null when `v` is not a box.
  box(v) {
    const a = this.resolve(v);
    if (!Array.isArray(a) || a.length < 4) return null;
    const n = a.slice(0, 4).map((x) => this.resolve(x));
    if (!n.every(Number.isFinite)) return null;
    return [Math.min(n[0], n[2]), Math.min(n[1], n[3]), Math.max(n[0], n[2]), Math.max(n[1], n[3])];
  }

  // The page's boxes and turn: the MediaBox, the CropBox within it (when they overlap) and /Rotate
  // as 0, 90, 180 or 270.
  geometry(page) {
    const media = this.box(page.attrs.MediaBox) || DEFAULT_BOX;
    let crop = this.box(page.attrs.CropBox);
    if (crop) {
      crop = [Math.max(media[0], crop[0]), Math.max(media[1], crop[1]), Math.min(media[2], crop[2]), Math.min(media[3], crop[3])];
      if (crop[2] <= crop[0] || crop[3] <= crop[1]) crop = null;
    }
    const r = this.resolve(page.attrs.Rotate);
    const rotate = Number.isFinite(r) ? ((((Math.round(r / 90) * 90) % 360) + 360) % 360) : 0;
    return { media, crop, rotate };
  }
}
const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
const tooManyObjects = (max) => fail('too-many-objects', `This PDF is too complex to open here (it has more than ${max} objects). Split it into smaller PDFs and upload those.`);
const round = (n) => Math.round(n * 1000) / 1000;

// Reads a PDF. Returns a handle for importPages, pageJpeg and pageText, with what the caller shows:
// { pageCount, pages: [{ width, height, rotate }], info: { title, author }, version }.
export function readPdf(buffer, { maxObjects = 200000, maxPages = 2000 } = {}) {
  let buf;
  if (Buffer.isBuffer(buffer)) buf = buffer;
  else if (ArrayBuffer.isView(buffer)) buf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  else if (buffer instanceof ArrayBuffer) buf = Buffer.from(buffer);
  else throw fail('not-pdf', MESSAGES.notPdf);
  // Some files have a few bytes (a mail header, a BOM) before "%PDF-"; their offsets count from it.
  const start = buf.subarray(0, 1024).indexOf('%PDF-', 0, 'latin1');
  if (start < 0) throw fail('not-pdf', MESSAGES.notPdf);
  if (start > 0) buf = buf.subarray(start);
  try {
    return open(buf, { maxObjects, maxPages });
  } catch (err) {
    // The errors above are for the person uploading; anything else this file managed to provoke
    // (a structure no rule here foresaw) means the same to them as damage.
    if (MESSAGE_CODES.has(err?.code)) throw err;
    throw fail('damaged', MESSAGES.damaged);
  }
}

function open(buf, { maxObjects, maxPages }) {
  const src = new Source(buf, { maxObjects, maxPages });

  const encrypted = () => {
    const e = src.trailer.Encrypt;
    if (e !== undefined && e !== null) throw fail('encrypted', MESSAGES.encrypted);
  };
  let usable = false;
  try { usable = src.loadXref(); } catch (err) { if (MESSAGE_CODES.has(err?.code)) throw err; usable = false; }
  encrypted();
  let root = usable ? src.catalog() : null;
  if (!root) {
    src.rebuild();
    encrypted();
    root = src.catalog();
  }
  if (!root) throw fail('damaged', MESSAGES.damaged);

  const pages = src.collectPages(root);
  src.pages = pages;
  const header = /^%PDF-(\d\.\d)/.exec(buf.toString('latin1', 0, 16));
  let version = header ? header[1] : '1.4';
  // A later revision may raise the version in the catalog rather than rewrite the header.
  const catVersion = nameOf(src.resolve(root.Version));
  if (catVersion && /^\d\.\d$/.test(catVersion) && Number(catVersion) > Number(version)) version = catVersion;
  const info = src.resolve(src.trailer.Info);

  const doc = {
    pageCount: pages.length,
    pages: pages.map((page) => {
      const { media, crop, rotate } = src.geometry(page);
      const b = crop || media;
      return { width: round(b[2] - b[0]), height: round(b[3] - b[1]), rotate };
    }),
    info: {
      title: isDict(info) ? decodeText(src.resolve(info.Title)) : null,
      author: isDict(info) ? decodeText(src.resolve(info.Author)) : null,
    },
    version,
  };
  internals.set(doc, src);
  return doc;
}

function sourceOf(doc) {
  const src = internals.get(doc);
  if (!src) throw new Error('Not a document from readPdf.');
  return src;
}

// ---------- Copying pages into a new PDF ----------
// Keys of a page that are not copied: the page tree and annotations (links, form fields and their
// scripts are out of scope, and they point back at pages), the logical structure (the new file has
// no structure tree), and leftovers of the authoring program.
const PAGE_DROP = new Set(['Type', 'Parent', 'Annots', 'AA', 'B', 'PieceInfo', 'Metadata', 'Thumb', 'StructParents', 'SeparationInfo', 'DPart', ...INHERITED, 'Contents']);
// Keys dropped from every copied dictionary: they lead back up a tree that is not copied.
const ALWAYS_DROP = new Set(['Parent', 'StructParent', 'StructParents']);
const isPageNode = (v) => isDict(v) && ['Page', 'Pages', 'Catalog'].includes(nameOf(v.Type));

// The pages at `indexes` (0-based; one may repeat) as page dictionaries for writer.addPage, with
// everything they use copied into `writer` once: an object shared by several pages, or imported
// again by a later call with the same writer, is copied only the first time.
export function importPages(doc, writer, indexes) {
  const src = sourceOf(doc);
  let memo = src.copies.get(writer);
  if (!memo) { memo = new Map(); src.copies.set(writer, memo); }
  const pending = [];

  // An object of the source as a reference in the writer: it gets its number now and is copied
  // later from `pending`, so long chains of references never deepen the stack. A reference to a
  // page or the page tree (from a stray /P or /Dest) becomes null rather than pull in every page.
  const refTo = (num) => {
    if (memo.has(num)) {
      const id = memo.get(num);
      return id === null ? null : ref(id);
    }
    const value = src.get(num);
    if (value === null || value === undefined || value instanceof Keyword || isPageNode(value)) {
      memo.set(num, null);
      return null;
    }
    const id = writer.alloc();
    memo.set(num, id);
    pending.push([id, value]);
    return ref(id);
  };
  const copy = (v, depth = 0) => {
    if (depth > MAX_NESTING) return null;
    if (v instanceof PdfRef) return refTo(v.num);
    if (Array.isArray(v)) return v.map((x) => copy(x, depth + 1));
    if (v instanceof PdfStream) return ref(writer.set(writer.alloc(), copyStream(v)));
    if (isDict(v)) {
      // An entry whose value is null (or an object that cannot be read) is the same as no entry.
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (ALWAYS_DROP.has(k)) continue;
        const c = copy(x, depth + 1);
        if (c !== null) out[k] = c;
      }
      return out;
    }
    return v instanceof Keyword ? null : v; // names, strings, numbers, booleans, null
  };
  // The bytes as they are (still compressed); the writer sets /Length, which in the source may
  // have been a reference to another object.
  const copyStream = (s) => {
    const { Length, ...dict } = s.dict;
    return new Stream(copy(dict), s.raw);
  };
  const drain = () => {
    while (pending.length) {
      const [id, value] = pending.pop();
      writer.set(id, value instanceof PdfStream ? copyStream(value) : copy(value));
    }
  };

  const out = indexes.map((index) => {
    const page = src.pages[index];
    if (!page) throw new Error(`This document has no page ${Number(index) + 1}.`);
    const { media, crop, rotate } = src.geometry(page);
    const dict = { MediaBox: media.map(round) };
    if (crop) dict.CropBox = crop.map(round);
    if (rotate) dict.Rotate = rotate;
    const resources = copy(page.attrs.Resources);
    dict.Resources = isDict(resources) || resources instanceof Ref ? resources : {};
    // /Contents is a stream or an array of them. An array kept in an object of its own is written
    // inline, since not every viewer follows a reference to an array there, and anything in it
    // that is not a stream (in a damaged file) is left out.
    const contents = page.dict.Contents;
    const resolved = contents instanceof PdfRef ? src.resolve(contents) : contents;
    const list = (Array.isArray(resolved) ? resolved : [contents]).filter((c) => c instanceof PdfRef && src.resolve(c) instanceof PdfStream).map((c) => copy(c));
    if (list.length === 1 && !Array.isArray(resolved)) dict.Contents = list[0];
    else if (list.length) dict.Contents = list;
    for (const [k, v] of Object.entries(page.dict)) {
      if (PAGE_DROP.has(k)) continue;
      const c = copy(v);
      if (c !== null) dict[k] = c;
    }
    return dict;
  });
  drain();
  return out;
}

// ---------- Thumbnails and captions ----------
const xobjectsOf = (src, resources) => {
  const xo = isDict(resources) ? src.resolve(resources.XObject) : null;
  if (!isDict(xo)) return [];
  return Object.entries(xo).map(([key, v]) => [key, src.resolve(v)]).filter(([, s]) => s instanceof PdfStream);
};

// The one picture a page is made of, looking one level into a form that wraps it.
function soleImage(src, resources, depth) {
  const all = xobjectsOf(src, resources);
  const images = all.filter(([, s]) => nameOf(src.resolve(s.dict.Subtype)) === 'Image');
  const forms = all.filter(([, s]) => nameOf(src.resolve(s.dict.Subtype)) === 'Form');
  if (images.length === 1 && forms.length === 0) return images[0][1];
  if (images.length === 0 && forms.length === 1 && depth === 0) return soleImage(src, src.resolve(forms[0][1].dict.Resources), 1);
  return null;
}

// The JPEG a scanned page is made of, to show as its thumbnail; null for any other page.
export function pageJpeg(doc, index) {
  try {
    const src = sourceOf(doc);
    const page = src.pages[index];
    if (!page) return null;
    const image = soleImage(src, src.resolve(page.attrs.Resources), 0);
    if (!image) return null;
    const filters = toArray(src.resolve(image.dict.Filter)).map((f) => nameOf(src.resolve(f)));
    if (filters.length !== 1 || filters[0] !== 'DCTDecode') return null;
    const raw = image.raw;
    if (raw[0] !== 0xff || raw[1] !== 0xd8 || raw[2] !== 0xff) return null;
    return Buffer.from(raw);
  } catch {
    return null;
  }
}

// A font's /ToUnicode CMap: which characters each code stands for. Most PDFs made by office
// programs use subset fonts whose codes are not letters (1, 2, 3… in the order glyphs were first
// used), and this map is the only way back to the text. Returns { width, chars, ranges } or null.
function toUnicode(src, font) {
  const stream = src.resolve(font.ToUnicode);
  if (!(stream instanceof PdfStream)) return null;
  const p = new Parser(src.decode(stream, MB));
  const cmap = { width: 1, chars: new Map(), ranges: [] };
  const code = (b) => b.b.reduce((n, x) => n * 256 + x, 0);
  let operands = [];
  for (let ops = 0; ops < 100000; ops++) {
    let v;
    try { v = p.value(0); } catch { break; }
    if (!(v instanceof Keyword)) {
      if (operands.length < 1000) operands.push(v);
      continue;
    }
    if (v.v === 'endcodespacerange' && operands[0] instanceof Bytes) cmap.width = Math.min(4, Math.max(1, operands[0].b.length));
    else if (v.v === 'endbfchar') {
      for (let i = 0; i + 1 < operands.length; i += 2) if (operands[i] instanceof Bytes && operands[i + 1] instanceof Bytes) cmap.chars.set(code(operands[i]), utf16(operands[i + 1].b));
    } else if (v.v === 'endbfrange') {
      for (let i = 0; i + 2 < operands.length; i += 3) {
        const [lo, hi, dst] = operands.slice(i, i + 3);
        if (lo instanceof Bytes && hi instanceof Bytes) cmap.ranges.push({ lo: code(lo), hi: code(hi), dst });
      }
    }
    operands = [];
  }
  return cmap;
}
const utf16 = (b) => Buffer.from(b.subarray(0, b.length & ~1)).swap16().toString('utf16le');
// The text of a string shown in a font with a ToUnicode map.
function mapped(cmap, bytes) {
  let s = '';
  const b = bytes.b;
  for (let i = 0; i + cmap.width <= b.length; i += cmap.width) {
    let c = 0;
    for (let k = 0; k < cmap.width; k++) c = c * 256 + b[i + k];
    let ch = cmap.chars.get(c);
    if (ch === undefined) {
      const r = cmap.ranges.find((x) => c >= x.lo && c <= x.hi);
      if (r && r.dst instanceof Bytes && r.dst.b.length >= 2) {
        // The range's first character, counted up: the last UTF-16 unit grows with the code.
        const d = Buffer.from(r.dst.b.subarray(0, r.dst.b.length & ~1));
        d.writeUInt16BE((d.readUInt16BE(d.length - 2) + c - r.lo) & 0xffff, d.length - 2);
        ch = utf16(d);
      } else if (r && Array.isArray(r.dst) && r.dst[c - r.lo] instanceof Bytes) ch = utf16(r.dst[c - r.lo].b);
    }
    if (ch) s += ch.replace(/[\u0000-\u001f]/g, '');
  }
  return s;
}

// How the strings of each font of the page become text: through its ToUnicode map when it has
// one; as Windows-1252 bytes for simple fonts; not at all for Type0 (Identity-H/V) fonts without a
// map, whose strings are glyph numbers rather than letters.
function fontReaders(src, resources) {
  const readers = new Map();
  const fonts = isDict(resources) ? src.resolve(resources.Font) : null;
  if (!isDict(fonts)) return readers;
  for (const [key, v] of Object.entries(fonts)) {
    const f = src.resolve(v);
    if (!isDict(f)) continue;
    let cmap = null;
    try { cmap = toUnicode(src, f); } catch { cmap = null; }
    const enc = nameOf(src.resolve(f.Encoding));
    if (cmap) readers.set(key, (b) => mapped(cmap, b));
    else if (nameOf(src.resolve(f.Subtype)) === 'Type0' || enc === 'Identity-H' || enc === 'Identity-V') readers.set(key, () => '');
  }
  return readers;
}

const textOf = (b) => {
  let s = '';
  for (const c of b.b) if (c >= 32) s += String.fromCharCode(CP1252[c] || c);
  return s;
};
// The pieces of text found so far, and how many characters they hold.
class TextOut {
  constructor() { this.parts = []; this.chars = 0; }
  push(s) { this.parts.push(s); this.chars += s.length; }
}

// The text shown by content streams: the strings of Tj, TJ, ' and ", read in the font in use (see
// fontReaders). Text drawn by a form XObject is followed one level down. `out` collects the pieces.
function collectText(src, data, resources, out, budget, depth) {
  const readers = fontReaders(src, resources);
  const p = new Parser(data);
  let operands = [];
  let read = textOf;
  for (let ops = 0; ops < 200000 && out.chars < budget; ops++) {
    let v;
    try { v = p.value(0); } catch { break; }
    if (!(v instanceof Keyword)) {
      if (operands.length < 64) operands.push(v);
      continue;
    }
    const op = v.v;
    const last = operands[operands.length - 1];
    if (op === 'Tf') read = (operands[0] instanceof Name && readers.get(operands[0].v)) || textOf;
    else if (op === 'Tj' || op === "'" || op === '"') {
      if (op !== 'Tj') out.push(' ');
      if (last instanceof Bytes) out.push(read(last));
    } else if (op === 'TJ') {
      if (Array.isArray(last)) {
        for (const x of last) {
          if (x instanceof Bytes) out.push(read(x));
          else if (typeof x === 'number' && x < -250) out.push(' '); // a gap as wide as a space
        }
      }
    } else if (op === 'Td' || op === 'TD' || op === 'T*' || op === 'Tm' || op === 'BT' || op === 'ET') out.push(' ');
    else if (op === 'ID') {
      // An inline image: its bytes run up to "EI" between white space and are not operators.
      let at = p.pos + 1;
      for (;;) {
        at = data.indexOf('EI', at, 'latin1');
        if (at < 0) { at = data.length; break; }
        if (WHITE[data[at - 1]] && (at + 2 >= data.length || !isRegular(data[at + 2]))) break;
        at += 2;
      }
      p.pos = at + 2;
    } else if (op === 'Do' && depth === 0 && last instanceof Name) {
      const xo = isDict(resources) ? src.resolve(resources.XObject) : null;
      const form = isDict(xo) ? src.resolve(xo[last.v]) : null;
      if (form instanceof PdfStream && nameOf(src.resolve(form.dict.Subtype)) === 'Form') {
        try {
          const inner = src.resolve(form.dict.Resources);
          collectText(src, src.decode(form, MAX_CONTENT_BYTES), isDict(inner) ? inner : resources, out, budget, 1);
        } catch { /* a form that cannot be read adds nothing */ }
      }
    }
    operands = [];
  }
}

// A short piece of the page's text, for a caption under its thumbnail; '' when there is none to
// be had. It never throws: a page that cannot be read simply has no caption.
export function pageText(doc, index, max = 200) {
  try {
    const src = sourceOf(doc);
    const page = src.pages[index];
    if (!page) return '';
    const resources = src.resolve(page.attrs.Resources);
    const contents = src.resolve(page.dict.Contents);
    const streams = (Array.isArray(contents) ? contents.map((c) => src.resolve(c)) : [contents]).filter((s) => s instanceof PdfStream);
    const parts = [];
    let total = 0;
    for (const s of streams) {
      try {
        const data = src.decode(s, MAX_CONTENT_BYTES);
        total += data.length;
        if (total > MAX_CONTENT_BYTES) break;
        parts.push(data, Buffer.from('\n'));
      } catch { /* skip a stream that cannot be decoded */ }
    }
    const out = new TextOut();
    collectText(src, Buffer.concat(parts), isDict(resources) ? resources : null, out, max * 4, 0);
    return out.parts.join('').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  } catch {
    return '';
  }
}
