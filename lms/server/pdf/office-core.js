// PDF Studio (0.64): the pieces the document converters (server/pdf/office.js) share. A ZIP reader
// for Office and OpenDocument files, a small XML parser, and the collector that gathers the blocks
// the layout engine (server/pdf/layout.js) draws. Node's standard library only.
//
// Uploaded files are never trusted: the ZIP reader refuses passwords, ZIP64, unsafe names and parts
// that unpack to more than the limits allow (a "zip bomb"); the XML parser never reads a DOCTYPE, so
// a file cannot define its own entities (no "billion laughs", no reading files from the server).
import { inflateRawSync } from 'node:zlib';
import { decodeCp1252 } from './cp1252.js';

export const MAX_BLOCKS = 20000;
export const MAX_IMAGES = 300;
export const MAX_ROWS = 2000;
export const MAX_COLS = 40;
const MAX_DEPTH = 1000;

// An error whose message a user can read as it is.
export class ReadError extends Error {}
export function fail(message) {
  throw new ReadError(message);
}
// Thrown once the document has as many blocks as a PDF may take: the converter stops there and what
// it has so far is kept.
export const STOP = Symbol('enough blocks');

// ---------------------------------------------------------------------------------------------
// ZIP

const DAMAGED = 'This file is not a package ATLAS can read: it is damaged or was only partly uploaded.';
const ZIP64 = 'This file is too large or uses a ZIP format (ZIP64) ATLAS does not read. Save it again in a smaller form and try once more.';
const PASSWORD = 'This file is protected with a password. Remove the password, save it again and upload that copy.';
const TOO_BIG = 'This file unpacks to far more data than a document should hold, so ATLAS stopped reading it.';

// The parts of a ZIP file, read from its central directory. Each part is unpacked only when asked
// for, at most once, and never beyond maxEntryBytes (one part) or maxTotalBytes (all parts together).
export function readZip(buffer, { maxEntryBytes = 40 * 1024 * 1024, maxTotalBytes = 150 * 1024 * 1024, maxEntries = 5000 } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (buf.length < 22) fail(DAMAGED);
  // The end-of-central-directory record is in the last 22 bytes, or up to 64 KB earlier when the
  // archive has a comment.
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) fail(DAMAGED);
  if (end >= 20 && buf.readUInt32LE(end - 20) === 0x07064b50) fail(ZIP64);
  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  let at = buf.readUInt32LE(end + 16);
  if (count === 0xffff || cdSize === 0xffffffff || at === 0xffffffff) fail(ZIP64);
  if (count > maxEntries) fail(`This file holds ${count.toLocaleString('en-US')} parts, more than the ${maxEntries.toLocaleString('en-US')} ATLAS reads in one document.`);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) fail(DAMAGED);
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const skip = nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    if (at + 46 + nameLen > buf.length) fail(DAMAGED);
    const raw = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    at += 46 + skip;
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) fail(ZIP64);
    if (flags & 1) fail(PASSWORD);
    const name = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    if (name.split('/').includes('..')) fail('This file holds a part with an unsafe name (one that points outside the file), so ATLAS will not open it.');
    if (!name || name.endsWith('/')) continue; // a folder
    entries.set(name, { method, packed, size, local });
  }
  // Office part names are not case-sensitive, so a lookup falls back to the name in lower case.
  const lower = new Map([...entries.keys()].map((k) => [k.toLowerCase(), k]));
  const key = (name) => {
    const n = String(name).replace(/^\/+/, '');
    return entries.has(n) ? n : lower.get(n.toLowerCase());
  };
  const cache = new Map();
  let total = 0;
  return {
    names: [...entries.keys()],
    has: (name) => key(name) !== undefined,
    read(name) {
      const k = key(name);
      if (k === undefined) fail(`A part of this file (${name}) is missing.`);
      if (cache.has(k)) return cache.get(k);
      const e = entries.get(k);
      if (e.size > maxEntryBytes || total + e.size > maxTotalBytes) fail(TOO_BIG);
      if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) fail(DAMAGED);
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      if (start + e.packed > buf.length) fail(DAMAGED);
      const raw = buf.subarray(start, start + e.packed);
      let data;
      if (e.method === 0) {
        data = raw;
        if (data.length > maxEntryBytes) fail(TOO_BIG);
      } else if (e.method === 8) {
        // The sizes in the directory may lie, so inflating itself stops at the limit.
        const room = Math.max(1, Math.min(maxEntryBytes, maxTotalBytes - total));
        try {
          data = inflateRawSync(raw, { maxOutputLength: room });
        } catch (err) {
          if (err && (err.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError)) fail(TOO_BIG);
          fail(DAMAGED);
        }
      } else {
        fail(`This file is packed with a method ATLAS cannot unpack (method ${e.method}). Open it and save it again, then upload that copy.`);
      }
      total += data.length;
      if (total > maxTotalBytes) fail(TOO_BIG);
      cache.set(k, data);
      return data;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// XML

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const charFor = (cp) => (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '�');

// The five entities every XML file knows and numeric references; anything else stays as written.
export function decodeXmlEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos));/g, (m, hex, dec, named) =>
    named ? XML_ENTITIES[named] : charFor(hex ? parseInt(hex, 16) : parseInt(dec, 10)));
}

// Text of a part: UTF-8 (or UTF-16 when it starts with that byte-order mark), without the mark.
export function xmlText(buf) {
  if (typeof buf === 'string') return buf.replace(/^﻿/, '');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return buf.toString('utf8').replace(/^﻿/, '');
}

const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 13;

// Skips a <!DOCTYPE …> or other <!…> declaration, internal subset included, without reading it.
function skipDeclaration(s, i) {
  let depth = 0;
  let quote = 0;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 34 || c === 39) quote = c;
    else if (c === 91) depth++; // [
    else if (c === 93) depth = Math.max(0, depth - 1); // ]
    else if (c === 62 && depth === 0) return i + 1; // >
  }
  return s.length;
}

// A small XML tree: { name, attrs, children } for each element, strings for text. Names keep their
// prefix (w:p). Processing instructions, comments and the DOCTYPE are dropped; CDATA becomes text.
// Lenient with closing tags that do not match, so a slightly broken part still gives its text.
export function parseXml(input) {
  const s = Buffer.isBuffer(input) ? xmlText(input) : String(input ?? '').replace(/^﻿/, '');
  const doc = { name: '#document', attrs: {}, children: [] };
  const stack = [doc];
  let top = doc;
  const len = s.length;
  let i = 0;
  while (i < len) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      if (top !== doc) top.children.push(decodeXmlEntities(s.slice(i)));
      break;
    }
    if (lt > i && top !== doc) top.children.push(decodeXmlEntities(s.slice(i, lt)));
    const c = s.charCodeAt(lt + 1);
    if (c === 63) { // <? … ?>
      const e = s.indexOf('?>', lt + 2);
      i = e < 0 ? len : e + 2;
      continue;
    }
    if (c === 33) { // <! … >
      if (s.startsWith('!--', lt + 1)) {
        const e = s.indexOf('-->', lt + 4);
        i = e < 0 ? len : e + 3;
      } else if (s.startsWith('![CDATA[', lt + 1)) {
        const e = s.indexOf(']]>', lt + 9);
        if (top !== doc) top.children.push(s.slice(lt + 9, e < 0 ? len : e));
        i = e < 0 ? len : e + 3;
      } else i = skipDeclaration(s, lt + 2);
      continue;
    }
    if (c === 47) { // </name>
      const e = s.indexOf('>', lt + 2);
      const name = s.slice(lt + 2, e < 0 ? len : e).trim();
      i = e < 0 ? len : e + 1;
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          top = stack[k - 1];
          break;
        }
      }
      continue;
    }
    // A start tag: its name, then attributes up to > or />.
    let j = lt + 1;
    while (j < len) {
      const ch = s.charCodeAt(j);
      if (isSpace(ch) || ch === 62 || ch === 47) break;
      j++;
    }
    const name = s.slice(lt + 1, j);
    if (!name) {
      if (top !== doc) top.children.push('<');
      i = lt + 1;
      continue;
    }
    const attrs = {};
    let selfClosing = false;
    let closed = false;
    while (j < len) {
      let ch = s.charCodeAt(j);
      if (isSpace(ch)) { j++; continue; }
      if (ch === 62) { j++; closed = true; break; }
      if (ch === 47) {
        if (s.charCodeAt(j + 1) === 62) { j += 2; selfClosing = true; closed = true; break; }
        j++;
        continue;
      }
      const a = j;
      while (j < len) {
        ch = s.charCodeAt(j);
        if (isSpace(ch) || ch === 61 || ch === 62 || ch === 47) break;
        j++;
      }
      const attr = s.slice(a, j);
      while (j < len && isSpace(s.charCodeAt(j))) j++;
      let value = '';
      if (s.charCodeAt(j) === 61) { // =
        j++;
        while (j < len && isSpace(s.charCodeAt(j))) j++;
        const q = s.charCodeAt(j);
        if (q === 34 || q === 39) {
          const e = s.indexOf(q === 34 ? '"' : "'", j + 1);
          value = s.slice(j + 1, e < 0 ? len : e);
          j = e < 0 ? len : e + 1;
        } else {
          const v = j;
          while (j < len && !isSpace(s.charCodeAt(j)) && s.charCodeAt(j) !== 62) j++;
          value = s.slice(v, j);
        }
      }
      if (attr) attrs[attr] = decodeXmlEntities(value);
    }
    if (!closed) break; // the file ends inside a tag
    const el = { name, attrs, children: [] };
    if (top !== doc || !doc.children.length) top.children.push(el);
    else continue; // a second root element: ignored
    if (!selfClosing && stack.length < MAX_DEPTH) {
      stack.push(el);
      top = el;
    }
    i = j;
  }
  const root = doc.children.find((n) => typeof n !== 'string');
  if (!root) throw new Error('This is not an XML document.');
  return root;
}

// Walking the tree.
export function kid(el, name) {
  if (!el) return null;
  for (const c of el.children) if (typeof c !== 'string' && c.name === name) return c;
  return null;
}
export function kids(el, name) {
  if (!el) return [];
  return el.children.filter((c) => typeof c !== 'string' && (!name || c.name === name));
}
export const at = (el, ...names) => names.reduce((e, n) => kid(e, n), el);
export function find(el, name) {
  if (!el) return null;
  for (const c of el.children) {
    if (typeof c === 'string') continue;
    if (c.name === name) return c;
    const f = find(c, name);
    if (f) return f;
  }
  return null;
}
export function findAll(el, name, out = []) {
  if (!el) return out;
  for (const c of el.children) {
    if (typeof c === 'string') continue;
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
export function textOf(el) {
  if (!el) return '';
  if (typeof el === 'string') return el;
  const parts = [];
  const walk = (e) => {
    for (const c of e.children) typeof c === 'string' ? parts.push(c) : walk(c);
  };
  walk(el);
  return parts.join('');
}
// Removes namespace prefixes from element names (x:row → row), for producers that add them.
export function dropPrefixes(el) {
  const i = el.name.indexOf(':');
  if (i >= 0) el.name = el.name.slice(i + 1);
  for (const c of el.children) if (typeof c !== 'string') dropPrefixes(c);
  return el;
}
// An on/off value as Office writes it: absent value means on; "0", "false" and "off" mean off.
export const isOn = (v) => v === undefined || v === null || !/^(0|false|off|none)$/i.test(String(v));

// A part of the package as a tree. A part that cannot be parsed is left out with a warning, or, when
// the document cannot do without it, stops with the given message.
export function xmlPart(zip, name, out, required = null) {
  try {
    if (!zip.has(name)) {
      if (required) fail(required);
      return null;
    }
    return parseXml(xmlText(zip.read(name)));
  } catch (err) {
    if (err instanceof ReadError && !required) {
      out.warn(err.message);
      return null;
    }
    if (err instanceof ReadError) throw err;
    if (required) fail(required);
    out.warn(`A part of this file (${name}) could not be read and was left out.`);
    return null;
  }
}

// A path inside the package, from a relationship target relative to a folder ("word/").
export function resolvePart(dir, target) {
  let t = String(target || '').split('#')[0];
  try {
    t = decodeURIComponent(t);
  } catch { /* keep it as written */ }
  const parts = (t.startsWith('/') ? t.slice(1) : dir + t).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}
// The relationships of a part (word/_rels/document.xml.rels): id → { target, external, type, path }.
export function readRels(zip, part, out) {
  const dir = part.slice(0, part.lastIndexOf('/') + 1);
  const map = new Map();
  const root = xmlPart(zip, `${dir}_rels/${part.slice(dir.length)}.rels`, out);
  for (const r of kids(root)) {
    if (!/(^|:)Relationship$/.test(r.name)) continue;
    const external = r.attrs.TargetMode === 'External';
    map.set(r.attrs.Id, { target: r.attrs.Target || '', external, type: r.attrs.Type || '', path: external ? null : resolvePart(dir, r.attrs.Target) });
  }
  return map;
}
export function relOfType(rels, suffix) {
  for (const r of rels.values()) if (!r.external && r.type.endsWith(`/${suffix}`)) return r.path;
  return null;
}
// The main part of an Office file, from the package's own relationships (_rels/.rels).
export function mainPart(zip, out, fallback) {
  const root = xmlPart(zip, '_rels/.rels', out);
  for (const r of kids(root)) if (/\/officeDocument$/.test(r.attrs.Type || '') && r.attrs.TargetMode !== 'External') {
    const p = resolvePart('', r.attrs.Target);
    if (zip.has(p)) return p;
  }
  return fallback;
}
// The title in the document's properties (docProps/core.xml or meta.xml), when it has one.
export function propsTitle(zip, out, part = 'docProps/core.xml') {
  const root = xmlPart(zip, part, out);
  const t = textOf(find(root, 'dc:title')).replace(/\s+/g, ' ').trim();
  return t || null;
}

// ---------------------------------------------------------------------------------------------
// Runs and blocks

const MONO = /courier|consolas|mono|menlo|monaco|lucida console|lucida sans typewriter|source code|fira code|inconsolata|andale/i;
export const isMonoFont = (name) => MONO.test(String(name || ''));

// Only web and mail links are kept; anything else (file:, javascript:, internal anchors) is dropped.
export function safeLink(url) {
  const s = String(url || '').trim();
  return s.length < 2048 && /^(https?:\/\/|mailto:)\S/i.test(s) ? s : null;
}
// "1F4E79" → [r, g, b] from 0 to 1, or null for black, "auto" and anything unreadable.
export function hexColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m || /^0{6}$/.test(m[1])) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round((v / 255) * 1000) / 1000);
}
const round2 = (n) => Math.round(n * 100) / 100;
// EMU (Office drawing units, 914,400 an inch) to points; undefined when unknown.
export function emuToPt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? round2(n / 12700) : undefined;
}
// A CSS-like length ("2.5cm", "1in", "12pt", "100px") to points; undefined when unknown.
export function lengthToPt(v) {
  const m = /^\s*([\d.]+)\s*(cm|mm|in|pt|pc|px)?\s*$/i.exec(String(v || ''));
  if (!m) return undefined;
  const n = Number(m[1]) * ({ cm: 72 / 2.54, mm: 72 / 25.4, in: 72, pt: 1, pc: 12, px: 0.75 }[(m[2] || 'pt').toLowerCase()]);
  return Number.isFinite(n) && n > 0 ? round2(n) : undefined;
}

// A run with only the keys that are set. f: { bold, italic, underline, mono, size, link, color }.
export function makeRun(text, f = {}) {
  const r = { text: String(text) };
  if (f.bold) r.bold = true;
  if (f.italic) r.italic = true;
  if (f.underline) r.underline = true;
  if (f.mono) r.mono = true;
  if (Number.isFinite(f.size) && f.size > 0) r.size = round2(f.size);
  const link = safeLink(f.link);
  if (link) r.link = link;
  if (Array.isArray(f.color) && f.color.length === 3 && f.color.some((v) => v > 0)) r.color = f.color;
  return r;
}
const sameFormat = (a, b) => a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.mono === b.mono
  && a.size === b.size && a.link === b.link && String(a.color) === String(b.color);
// Control characters a PDF cannot show are dropped; tabs become four spaces.
const cleanText = (t) => String(t).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\u0000-\u0008\u000b-\u001f\u007f￾￿]/g, '');
// Runs with empty text are dropped and neighbours with the same formatting are joined.
export function cleanRuns(runs) {
  const out = [];
  for (const r of runs || []) {
    const text = cleanText(r.text);
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && sameFormat(prev, r)) prev.text += text;
    else out.push({ ...r, text });
  }
  return out;
}
export const runsText = (runs) => (runs || []).map((r) => r.text).join('');
const blank = (runs) => !runsText(runs).trim();
export function sniffImage(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  return null;
}
// Whether a block shows anything: text or a picture.
export function blockHasContent(b) {
  if (b.type === 'image') return true;
  if (b.type === 'code') return !!b.text.trim();
  if (b.type === 'heading' || b.type === 'paragraph') return !blank(b.runs);
  if (b.type === 'list') return b.items.some((i) => !blank(i.runs));
  if (b.type === 'table') return b.rows.some((r) => r.cells.some((c) => !blank(c.runs)));
  return false;
}

// The blocks of one document, as a converter finds them, with the warnings for the user.
export class Out {
  constructor() {
    this.blocks = [];
    this.warnings = [];
    this.title = null;
    this.landscape = false;
    this.images = 0;
    this.unreadablePictures = 0;
    this.extraItems = 0;
  }
  warn(message) {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }
  // Stops the converter once the document holds as much as a PDF may take (list items count too).
  room() {
    if (this.blocks.length + this.extraItems >= MAX_BLOCKS) {
      this.warn(`This document is very long: only its first ${MAX_BLOCKS.toLocaleString('en-US')} paragraphs, tables and pictures were kept.`);
      throw STOP;
    }
  }
  add(block) {
    this.room();
    this.blocks.push(block);
    return block;
  }
  paragraph(runs, { align, indent } = {}) {
    const b = { type: 'paragraph', runs };
    if (align && align !== 'left' && !blank(runs)) b.align = align;
    if (indent > 0 && !blank(runs)) b.indent = Math.min(6, Math.round(indent));
    return this.add(b);
  }
  heading(level, runs) {
    if (blank(runs)) return null;
    return this.add({ type: 'heading', level: Math.max(1, Math.min(4, level || 1)), runs });
  }
  // A list item joins the list just before it when that list is of the same kind, or when it is a
  // nested item (bullets under a numbered point stay in the numbered list).
  listItem(ordered, runs, level = 0, start = 1) {
    if (blank(runs)) return;
    const item = { runs, level: Math.max(0, Math.min(4, level | 0)) };
    const last = this.blocks[this.blocks.length - 1];
    if (last && last.type === 'list' && (last.ordered === !!ordered || item.level > 0)) {
      this.room();
      this.extraItems++;
      last.items.push(item);
      return;
    }
    const b = { type: 'list', ordered: !!ordered };
    if (ordered && Number.isFinite(start) && start !== 1 && start >= 0) b.start = start;
    b.items = [item];
    this.add(b);
  }
  pageBreak() {
    while (this.blocks.length) {
      const last = this.blocks[this.blocks.length - 1];
      if (last.type === 'paragraph' && blank(last.runs)) this.blocks.pop();
      else break;
    }
    const last = this.blocks[this.blocks.length - 1];
    if (last && last.type !== 'pagebreak') this.add({ type: 'pagebreak' });
  }
  // A picture, when its bytes really are JPEG or PNG; others are counted for one warning at the end.
  image(data, { width, height, alt } = {}) {
    const mime = sniffImage(data);
    if (!mime) {
      this.unreadablePictures++;
      return null;
    }
    if (this.images >= MAX_IMAGES) {
      this.warn(`Only the first ${MAX_IMAGES} pictures were kept.`);
      return null;
    }
    this.images++;
    const b = { type: 'image', data, mime };
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      b.width = width;
      b.height = height;
    }
    const a = String(alt || '').replace(/\s+/g, ' ').trim();
    if (a) b.alt = a;
    return b;
  }
  result() {
    if (this.unreadablePictures) {
      const n = this.unreadablePictures;
      this.warn(n === 1
        ? '1 picture in a format a PDF cannot hold (EMF, WMF, GIF, SVG…) was left out.'
        : `${n} pictures in a format a PDF cannot hold (EMF, WMF, GIF, SVG…) were left out.`);
    }
    return { title: this.title || null, blocks: finish(this.blocks), landscape: !!this.landscape, warnings: this.warnings };
  }
}

// The final tidy-up: clean runs, drop empty headings, items and tables, keep at most one empty
// paragraph in a row, and none (nor page breaks) at the start or the end.
export function finish(blocks) {
  const out = [];
  const emptyPara = (b) => b && b.type === 'paragraph' && !b.runs.length;
  for (const b of blocks) {
    if (!b) continue;
    let block = b;
    if (b.type === 'paragraph') {
      const runs = cleanRuns(b.runs);
      block = blank(runs) ? { type: 'paragraph', runs: [] } : { ...b, runs };
    } else if (b.type === 'heading') {
      const runs = cleanRuns(b.runs);
      if (blank(runs)) continue;
      block = { type: 'heading', level: b.level, runs };
    } else if (b.type === 'list') {
      const items = b.items.map((i) => ({ runs: cleanRuns(i.runs), level: i.level })).filter((i) => !blank(i.runs));
      if (!items.length) continue;
      block = { ...b, items };
    } else if (b.type === 'table') {
      const rows = b.rows.map((r) => ({ ...r, cells: r.cells.map((c) => {
        const cell = { ...c, runs: cleanRuns(c.runs) };
        if (cell.runs.length && blank(cell.runs)) cell.runs = [];
        return cell;
      }) })).filter((r) => r.cells.length);
      if (!rows.length || !rows.some((r) => r.cells.some((c) => c.runs.length))) continue;
      block = { ...b, rows };
      const cols = rows[0].cells.reduce((n, c) => n + (c.colspan || 1), 0);
      if (!b.widths || b.widths.length !== cols || !b.widths.every((w) => Number.isFinite(w) && w > 0)) delete block.widths;
    } else if (b.type === 'code') {
      const text = String(b.text).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, (c) => (c === '\t' ? c : ''));
      if (!text.trim()) continue;
      block = { type: 'code', text: expandTabs(text).replace(/\s+$/, '') };
    }
    const prev = out[out.length - 1];
    if (emptyPara(block) && (!prev || emptyPara(prev) || prev.type === 'pagebreak')) continue;
    if (block.type === 'pagebreak') {
      while (emptyPara(out[out.length - 1])) out.pop();
      if (!out.length || out[out.length - 1].type === 'pagebreak') continue;
    }
    out.push(block);
  }
  while (out.length && (emptyPara(out[out.length - 1]) || out[out.length - 1].type === 'pagebreak')) out.pop();
  return out;
}
// Tabs in code to spaces, at stops every four columns.
function expandTabs(text) {
  if (text.indexOf('\t') < 0) return text;
  return text.split('\n').map((line) => {
    let s = '';
    for (const ch of line) s += ch === '\t' ? ' '.repeat(4 - (s.length % 4)) : ch;
    return s;
  }).join('\n');
}

// A table of cells as a spreadsheet gives it: grid[row][col] = { runs, align?, colspan? }, null for
// a cell another one covers, undefined or empty runs for an empty cell. Empty rows and columns at
// the edges are trimmed and at most MAX_ROWS × MAX_COLS are kept. header: true makes the first row
// the header; a Set names the rows (grid indexes) that are headers.
export function sheetTable(grid, out, name, { header = true } = {}) {
  const filled = (c) => c && c.runs && c.runs.some((r) => r.text.trim());
  let top = -1;
  let bottom = -1;
  let left = Infinity;
  let right = -1;
  grid.forEach((row, r) => {
    (row || []).forEach((c, k) => {
      if (!filled(c)) return;
      if (top < 0) top = r;
      bottom = r;
      left = Math.min(left, k);
      right = Math.max(right, k + (c.colspan || 1) - 1);
    });
  });
  if (top < 0) return null;
  const label = name ? `Sheet ${name}: o` : 'O';
  if (bottom - top + 1 > MAX_ROWS) {
    bottom = top + MAX_ROWS - 1;
    out.warn(`${label}nly the first ${MAX_ROWS.toLocaleString('en-US')} rows were kept.`);
  }
  if (right - left + 1 > MAX_COLS) {
    right = left + MAX_COLS - 1;
    out.warn(`${label}nly the first ${MAX_COLS} columns were kept.`);
  }
  const rows = [];
  for (let r = top; r <= bottom; r++) {
    const row = grid[r] || [];
    const cells = [];
    for (let k = left; k <= right; k++) {
      const c = row[k];
      if (c === null) continue;
      const cell = { runs: (c && c.runs) || [] };
      if (c && c.colspan > 1) cell.colspan = Math.min(c.colspan, right - k + 1);
      if (c && c.align && c.align !== 'left' && filled(c)) cell.align = c.align;
      if (cell.colspan === 1) delete cell.colspan;
      cells.push(cell);
    }
    const isHeader = header instanceof Set ? header.has(r) : header && r === top;
    rows.push(isHeader ? { header: true, cells } : { cells });
  }
  return { block: { type: 'table', rows }, columns: right - left + 1 };
}

// Text of a plain file: UTF-8 without its byte-order mark, UTF-16 when it starts with that mark, and
// Windows-1252 (Latin-1) when the bytes are not valid UTF-8.
export function decodeText(buf) {
  if (typeof buf === 'string') return buf.replace(/^﻿/, '');
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return decodeCp1252(buf);
  }
}
