// ATLAS Tools → PDF Studio, ported from CORE ERP's (server/tools-pdf.js at the repository root):
// turns documents and pictures into PDF and puts PDFs together. For the account types an
// administrator switches it on for (Admin panel → Home page & systems → Tools; server/api.js
// 'tool:pdf' access); administrators always.
//
// How it works: each file uploaded becomes a *source*, kept as a PDF — a PDF as it came (a protected
// one as a plain copy of its pages); a picture or TIFF scan on pages (server/pdf/layout.js
// imageToPdf, tiffToPdf); a Word, Excel, PowerPoint (new and 97–2003), OpenDocument, RTF, text,
// Markdown, CSV, HTML or Outlook file read into blocks (server/pdf/office.js), or an e-book, e-mail
// or code file (server/pdf/office-extra.js), and laid out on pages (docToPdf). A ZIP adds each file
// it holds. Files of up to 100 MB arrive in pieces (/uploads) and wait on disk until whole. The browser arranges the pages of all sources (order, turn, remove, blank pages);
// the export copies those pages into one new PDF (server/pdf/build.js), with page numbers, a header,
// a footer or a watermark if asked, or splits it into several PDFs in a ZIP.
//
// Sources are a person's own and short-lived: kept in memory and in data/pdf-studio while in use,
// deleted after SOURCE_HOURS without use, on "Start over", and when the server restarts. Nothing
// else is stored. Uploads are not in the audit log; each export is (how many pages, from how many
// files, to which file name; never the contents).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash, randomInt } from 'node:crypto';
import os from 'node:os';
import { HttpError } from './util.js';
import { zipFiles } from './zip.js';
import * as office from './pdf/office.js';
import { readZip } from './pdf/office-core.js';
import { epubToDoc, emlToDoc, codeToDoc, looksLikeMail } from './pdf/office-extra.js';
import * as layoutModule from './pdf/layout.js';
import { readPdf, pageJpeg, pageText } from './pdf/reader.js';
import { buildPdf, NUMBER_FORMATS, NUMBER_POSITIONS } from './pdf/build.js';
import { renderPage } from './pdf/render.js';
import { cleanEdits, hasSignature, runScale } from './pdf/edits.js';
import { isJpeg, isPng } from './pdf/images.js';
import { PAGE_SIZES, missingChars, MISSING_NOTE } from './pdf/writer.js';
import { convertPdf, pageSvgs, MIME } from './pdf/convert.js';
import { PDF_LIMITS, PDF_DOC_EXTS, PDF_EXPORT_FORMATS } from '../shared/pdf-studio.js';

const MB = 1024 * 1024;
// A file on disk sent as the answer (a large export), streamed by server.js; remove: deleted once sent.
export class FileReply {
  constructor(file, { size = 0, remove = false } = {}) {
    this.path = file;
    this.size = size;
    this.remove = remove;
  }
  read() {
    return fs.readFileSync(this.path); // the bytes, for tests
  }
}
// An answer that is a file: ATLAS's request handler passes { raw, type, headers } on as it is.
const fileAnswer = (data, headers) => ({ raw: data, type: headers['Content-Type'], headers });
const { docToPdf, imageToPdf } = layoutModule;
const { toBlocks } = office;
const { maxConvertPages: MAX_CONVERT_PAGES, maxPicturePages: MAX_PICTURE_PAGES } = PDF_LIMITS;
// Another kind of file (0.68) is made in memory from pages of files of up to this size together,
// and pictures for the browser to draw are sent up to this size.
const CONVERT_BYTES = 150 * 1024 * 1024;
const MAX_SVG_REPLY = 120 * 1024 * 1024;
const { maxFileBytes: MAX_FILE_BYTES, chunkBytes: CHUNK_BYTES, maxSources: MAX_SOURCES, maxStoredBytes: MAX_STORED_BYTES, maxPages: MAX_PAGES, maxExportBytes: MAX_EXPORT_BYTES, maxArchiveFiles: MAX_ARCHIVE_FILES, sourceHours: SOURCE_HOURS } = PDF_LIMITS;
// The older way to upload (one request, base64 in JSON) takes files up to this size.
export const DIRECT_UPLOAD_BYTES = 25 * MB;
const TEXT_KINDS = { txt: 'txt', text: 'txt', md: 'md', markdown: 'md', csv: 'csv', tsv: 'csv', html: 'html', htm: 'html', xhtml: 'html' };
const CODE_EXTS = new Set(PDF_DOC_EXTS.text.filter((e) => !TEXT_KINDS[e]));
const FORMAT_NAME = {
  pdf: 'PDF', image: 'Picture', tiff: 'TIFF picture', docx: 'Word', doc: 'Word 97–2003', rtf: 'Rich Text', xlsx: 'Excel', xls: 'Excel 97–2003', pptx: 'PowerPoint', ppt: 'PowerPoint 97–2003',
  odt: 'OpenDocument text', ods: 'OpenDocument spreadsheet', odp: 'OpenDocument presentation', txt: 'Text', md: 'Markdown', csv: 'CSV', html: 'Web page', code: 'Code or data',
  epub: 'E-book', eml: 'E-mail', msg: 'Outlook e-mail', zip: 'ZIP',
};
// Opened PDFs kept in memory, all people together (0.66: files of up to 100 MB on a server with
// 1 GB): beyond this, the least recently used are closed and read again from disk when needed.
const OPEN_DOC_BYTES = 256 * MB;
// Uploads in pieces: a piece arrives within this time of the last, or the upload is dropped.
const UPLOAD_IDLE_MINUTES = 30;
// Room kept free on the server's disk.
const DISK_RESERVE_BYTES = Number(process.env.PDF_DISK_RESERVE_MB || 512) * MB;
const CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const isTiffBytes = (b) => b.length > 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42));
const ROTATIONS = [0, 90, 180, 270];
// An export taking more than this from its files is written to disk and sent from there.
const BIG_EXPORT_BYTES = 24 * MB;
// Titles programs put in a PDF by themselves, which say nothing: the file's name is better.
const GENERIC_TITLE = /^(untitled|untitled document|document\d*|presentation\d*|book\d*|microsoft (word|excel|powerpoint) - .*|.*\.(docx?|xlsx?|pptx?|pdf))$/i;
const bad = (msg) => new HttpError(400, msg);

// What a file is, by what it holds (never its name alone, except to tell text kinds apart).
export function formatOf(buf, fileName = '') {
  const ext = String(fileName).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
  const head = buf.subarray(0, 1024).toString('latin1');
  if (head.includes('%PDF-')) return 'pdf';
  if (isJpeg(buf) || isPng(buf)) return 'image';
  if (isTiffBytes(buf)) return 'tiff';
  // Word, Excel, PowerPoint 97–2003 and Outlook messages: "compound files", told apart by what they hold.
  if (buf.subarray(0, 8).equals(CFB)) {
    const kind = office.sniffCompound(buf);
    // A Word, Excel or PowerPoint file with a password: read as one, which says so.
    return kind === 'encrypted-ooxml' ? 'docx' : kind || null;
  }
  if (/^\s*\{\\rtf/.test(head)) return 'rtf';
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return zipKind(buf);
  if (!buf.length || buf.subarray(0, 8192).includes(0)) return null;
  if (['eml', 'msg', 'mht'].includes(ext)) return looksLikeMail(buf) ? 'eml' : null; // an e-mail saved as text, whatever its name
  if (TEXT_KINDS[ext]) return TEXT_KINDS[ext];
  if (CODE_EXTS.has(ext)) return 'code';
  return null;
}
// What a ZIP holds: a Word, Excel or PowerPoint file (with macros or a template too: read as the
// document, the macros never run), an OpenDocument file, an e-book, or other files (an archive).
function zipKind(buf) {
  let zip;
  try {
    zip = readZip(buf, { maxEntryBytes: 64 * 1024 });
  } catch {
    return null;
  }
  if (zip.has('word/document.xml') || zip.names.some((n) => /^word\/document\d*\.xml$/i.test(n))) return 'docx';
  if (zip.has('xl/workbook.xml')) return 'xlsx';
  if (zip.has('ppt/presentation.xml')) return 'pptx';
  if (zip.has('mimetype')) {
    let kind = '';
    try { kind = zip.read('mimetype').toString('latin1').trim(); } catch { kind = ''; }
    if (/opendocument\.text/.test(kind)) return 'odt';
    if (/opendocument\.spreadsheet/.test(kind)) return 'ods';
    if (/opendocument\.presentation/.test(kind)) return 'odp';
    if (kind === 'application/epub+zip') return 'epub';
  }
  if (zip.has('META-INF/container.xml') && zip.names.some((n) => /\.opf$/i.test(n))) return 'epub';
  if (zip.has('[Content_Types].xml')) return null; // an Office file of another kind (Visio, XPS…)
  return 'zip';
}

// Layout options as sent by the page: page size, orientation, margin (mm), font size, picture fit.
export function cleanLayout(o = {}) {
  const v = o && typeof o === 'object' ? o : {};
  return {
    size: Object.hasOwn(PAGE_SIZES, v.size) || v.size === 'auto' ? v.size : 'a4',
    orientation: ['portrait', 'landscape', 'auto'].includes(v.orientation) ? v.orientation : 'auto',
    margin: Number.isFinite(Number(v.margin)) ? Math.max(0, Math.min(40, Math.round(Number(v.margin)))) : 15,
    fontSize: Number.isFinite(Number(v.fontSize)) ? Math.max(8, Math.min(16, Number(v.fontSize))) : 11,
    fit: ['fit', 'fill', 'actual'].includes(v.fit) ? v.fit : 'fit',
  };
}
const text = (v, max) => (v == null || typeof v === 'object' ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
// A file name to save under: no path, no characters Windows refuses, ends in .pdf (or .zip).
export function safeFileName(v, fallback = 'document', ext = 'pdf') {
  const base = text(v, 120).replace(/\.(pdf|zip)$/i, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '').trim() || fallback;
  return `${base}.${ext}`;
}
const disposition = (name) => `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

// record(entry): writes an ATLAS audit trail entry. dir: where files wait (tests: a temporary folder).
export function registerPdfStudio(route, db, { record: log = () => {}, clock = () => new Date(), dir: baseDir = null } = {}) {
  const dir = baseDir || (db.dir ? path.join(db.dir, 'pdf-studio') : fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pdf-')));
  // Nothing survives a restart: the files of the last run go.
  fs.rmSync(dir, { recursive: true, force: true });
  const sources = new Map(); // id → source (with its parsed PDF in `doc` while in use)
  const fileOf = (s) => path.join(dir, `${s.id}.pdf`);
  const origOf = (s) => path.join(dir, `${s.id}.orig`);
  const mine = (u) => [...sources.values()].filter((s) => s.owner === u.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  function drop(s) {
    sources.delete(s.id);
    open.delete(s.id);
    s.doc = null;
    fs.rmSync(fileOf(s), { force: true });
    fs.rmSync(origOf(s), { force: true });
  }
  function find(id, u) {
    const s = sources.get(String(id || ''));
    // Someone else's source is "not found", as if it did not exist.
    if (!s || s.owner !== u.id) throw new HttpError(404, 'That file is no longer in PDF Studio (files are cleared after a few hours). Upload it again.');
    s.usedAt = Date.now();
    return s;
  }
  // Sources unused for SOURCE_HOURS go.
  const sweep = () => {
    const cutoff = Date.now() - SOURCE_HOURS * 3600 * 1000;
    for (const s of [...sources.values()]) if (s.usedAt < cutoff) drop(s);
    const idle = Date.now() - UPLOAD_IDLE_MINUTES * 60 * 1000;
    for (const x of [...uploads.values()]) if (x.usedAt < idle) dropUpload(x);
  };
  const timer = setInterval(sweep, 10 * 60 * 1000);
  timer.unref?.();

  // The PDF of a source, made (again) with the layout options.
  function render(s, orig, layout) {
    if (s.kind === 'pdf') return { pdf: orig, captions: null, warnings: [] };
    if (s.format === 'tiff') {
      if (!layoutModule.tiffToPdf) throw bad('TIFF pictures cannot be read yet. Save it as JPEG, PNG or PDF and try again.');
      let out;
      try {
        out = layoutModule.tiffToPdf(orig, layout, { title: s.title });
      } catch (err) {
        throw bad(err.message || 'This TIFF picture could not be read.');
      }
      return { pdf: out.pdf, captions: out.captions || null, warnings: out.warnings || [] };
    }
    if (s.kind === 'image') {
      const out = imageToPdf(orig, layout, { title: s.title });
      return { pdf: out.pdf, captions: [''], warnings: [] };
    }
    let doc;
    try {
      if (s.format === 'epub') doc = epubToDoc(orig, { fileName: s.name });
      else if (s.format === 'eml') doc = emlToDoc(orig, { fileName: s.name });
      else if (s.format === 'code') doc = codeToDoc(orig, { fileName: s.name });
      else doc = toBlocks(orig, s.format, { fileName: s.name });
    } catch (err) {
      throw bad(err.message || `ATLAS could not read this ${FORMAT_NAME[s.format]} file.`);
    }
    const out = docToPdf(doc, layout, { title: doc.title || s.title });
    if (doc.title && !s.title && !GENERIC_TITLE.test(doc.title.trim())) s.title = doc.title;
    // Letters the standard fonts lack (Greek, Chinese, emoji…) are said, not silently replaced.
    const all = [];
    const walk = (runs) => (runs || []).forEach((r) => all.push(r.text || ''));
    for (const b of doc.blocks || []) {
      walk(b.runs);
      if (b.type === 'code') all.push(b.text || '');
      (b.items || []).forEach((it) => walk(it.runs));
      (b.rows || []).forEach((row) => row.cells.forEach((c) => walk(c.runs)));
    }
    const missing = missingChars(all.join(' '));
    if (missing.length) (doc.warnings ||= []).push(MISSING_NOTE(missing));
    return { pdf: out.pdf, captions: out.captions, warnings: doc.warnings || [] };
  }
  // Reads the source's PDF and notes its pages: size, turn, a caption, and whether it has a picture
  // to show as its thumbnail (a picture; a scanned page).
  function load(s, pdf, captions, { password } = {}) {
    let doc;
    try {
      doc = readPdf(pdf, { maxPages: MAX_PAGES, ...(password ? { password } : {}) });
    } catch (err) {
      if (err?.code === 'password') throw Object.assign(bad(err.message), { needsPassword: true, wrongPassword: err.reason === 'wrong' || (Boolean(password) && err.reason !== 'needed') });
      if (err?.code === 'too-many-pages') throw bad(`This file has more than ${MAX_PAGES.toLocaleString('en-US')} pages, more than PDF Studio takes in one file. Split it first.`);
      throw bad(err.message || 'This PDF could not be read.');
    }
    if (!doc.pageCount) throw bad('This PDF has no pages.');
    if (doc.pageCount > MAX_PAGES) throw bad(`This file has ${doc.pageCount} pages; PDF Studio takes files of up to ${MAX_PAGES} pages.`);
    // A protected PDF (0.66), opened with its password or none (most only restrict printing or
    // copying): kept as a plain copy of its pages, so nothing later needs the password.
    if (doc.encrypted) {
      const title = doc.info?.title;
      pdf = buildPdf(doc.pages.map((_, index) => ({ doc, index, rotate: 0 })), {}, { title: title || '' });
      doc = readPdf(pdf, { maxPages: MAX_PAGES });
      if (title && !doc.info?.title) doc.info = { ...(doc.info || {}), title };
      s.unlocked = true;
    }
    s.doc = doc;
    opened(s);
    s.pages = doc.pages.map((p, i) => ({
      width: Math.round(p.width * 100) / 100, height: Math.round(p.height * 100) / 100, rotate: p.rotate || 0,
      caption: captions ? captions[i] || '' : i < 300 ? pageText(doc, i, 90) : '',
      // The picture itself (JPEG, PNG), or a page that is one JPEG; others (a TIFF, a fax scan) are drawn.
      thumb: s.format === 'image' || ((s.kind === 'pdf' || s.format === 'tiff') && i < 500 && Boolean(pageJpeg(doc, i))),
    }));
    if (s.kind === 'pdf' && !s.title && doc.info?.title && !GENERIC_TITLE.test(String(doc.info.title).trim())) s.title = String(doc.info.title).slice(0, 160);
    return pdf;
  }
  // Opened PDFs, least recently used first; beyond OPEN_DOC_BYTES the oldest are closed.
  const open = new Map();
  function opened(s) {
    open.delete(s.id);
    open.set(s.id, s);
    let bytes = 0;
    for (const x of open.values()) bytes += x.stored || x.size || 0;
    for (const [id, x] of open) {
      if (bytes <= OPEN_DOC_BYTES || x === s) break;
      bytes -= x.stored || x.size || 0;
      x.doc = null;
      open.delete(id);
    }
  }
  function docOf(s) {
    if (!s.doc) s.doc = readPdf(fs.readFileSync(fileOf(s)), { maxPages: MAX_PAGES });
    opened(s);
    return s.doc;
  }
  const out = (s) => ({ id: s.id, name: s.name, kind: s.kind, format: s.format, formatName: FORMAT_NAME[s.format] || s.format, size: s.size, title: s.title || '', layout: s.layout, pages: s.pages, warnings: s.warnings, createdAt: s.createdAt, canLayout: s.kind !== 'pdf' });
  const storedBy = (u) => mine(u).reduce((n, s) => n + s.stored, 0);

  // Every route: whoever may use PDF Studio; uploads and edits are not in the audit trail (exports are).
  const tool = (method, pattern, handler) => route(method, pattern, 'tool:pdf', handler, { audit: false });
  tool('GET', '/api/tools/pdf', ({ user: u }) => ({ sources: mine(u).map(out), limits: PDF_LIMITS, numberFormats: NUMBER_FORMATS, numberPositions: NUMBER_POSITIONS }));

  const UNKNOWN = (name) => `ATLAS cannot turn ${name} into a PDF. PDF Studio takes PDFs; pictures (JPEG, PNG, TIFF; WebP, GIF, HEIC and others your browser can open); Word, Excel and PowerPoint files, old (.doc, .xls, .ppt) and new; OpenDocument, RTF, text, Markdown, CSV, HTML, code and data files; e-books (EPUB), e-mails (.eml, .msg) and ZIPs of these.`;
  const roomOnDisk = (bytes) => {
    try {
      const st = fs.statfsSync(fs.existsSync(dir) ? dir : db.dir || os.tmpdir());
      return Number(st.bavail) * Number(st.bsize) - bytes > DISK_RESERVE_BYTES;
    } catch {
      return true;
    }
  };
  // Room for a file of `bytes` more (its PDF and the file itself are kept), or a message why not.
  function checkRoom(u, bytes, name = 'This file') {
    if (bytes > MAX_FILE_BYTES) throw bad(`${name} is larger than ${MAX_FILE_BYTES / MB} MB. Split it, or make its pictures smaller, and try again.`);
    if (mine(u).length + pendingOf(u).length >= MAX_SOURCES) throw bad(`PDF Studio holds up to ${MAX_SOURCES} files at a time. Remove some, or export and start over.`);
    if (storedBy(u) + pendingOf(u).reduce((n, x) => n + x.size, 0) + bytes * 2 > MAX_STORED_BYTES) throw bad(`Your files in PDF Studio would add up to more than ${MAX_STORED_BYTES / MB} MB. Remove some, or export and start over.`);
    if (!roomOnDisk(bytes * 3)) throw new HttpError(507, 'The server is short of disk space for this file right now. Try a smaller file, or ask your administrator.');
  }
  // A file becomes a source: read by what it holds, laid out, stored. `file`: where it already is
  // on disk (an upload in pieces), moved into place for a PDF rather than copied.
  function addSource(u, name, orig, layoutIn, { password, file } = {}) {
    if (!orig.length) throw bad(`${name} is empty.`);
    const format = formatOf(orig, name);
    if (!format) throw bad(UNKNOWN(name));
    if (format === 'zip') throw bad(`${name} is a ZIP inside a ZIP. Unpack it and add the files.`);
    const now = new Date(clock()).toISOString();
    const s = { id: randomUUID(), owner: u.id, name, format, kind: format === 'pdf' ? 'pdf' : format === 'image' || format === 'tiff' ? 'image' : 'doc', size: orig.length, title: '', createdAt: now, usedAt: Date.now(), layout: cleanLayout(layoutIn), warnings: [] };
    const made = render(s, orig, s.layout);
    const pdf = load(s, made.pdf, made.captions, { password });
    s.warnings = made.warnings;
    if (s.unlocked) s.warnings = [...s.warnings, 'This PDF was protected; PDF Studio keeps an unprotected copy of its pages while you work, and your export is not protected.'];
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (file && pdf === orig && s.kind === 'pdf') fs.renameSync(file, fileOf(s));
    else fs.writeFileSync(fileOf(s), pdf, { mode: 0o600 });
    if (s.kind !== 'pdf') fs.writeFileSync(origOf(s), orig, { mode: 0o600 });
    s.stored = pdf.length + (s.kind !== 'pdf' ? orig.length : 0);
    sources.set(s.id, s);
    return s;
  }
  // A ZIP of files (0.66): each file it holds that PDF Studio takes is added, in name order.
  function addArchive(u, name, buf, layoutIn) {
    let zip;
    try {
      zip = readZip(buf, { maxEntryBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_STORED_BYTES, maxEntries: 5000 });
    } catch (err) {
      throw bad(`${name}: ${err.message}`);
    }
    const names = zip.names.filter((n) => !/(^|\/)(__MACOSX|\.)/.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
    const added = [];
    const notes = [];
    const skipped = [];
    for (const n of names) {
      const base = n.split('/').pop();
      if (added.length >= MAX_ARCHIVE_FILES) {
        notes.push(`Only the first ${MAX_ARCHIVE_FILES} files of ${name} were added.`);
        break;
      }
      try {
        const data = zip.read(n);
        const fmt = formatOf(data, base);
        if (!fmt || fmt === 'zip') {
          skipped.push(base);
          continue;
        }
        checkRoom(u, data.length, base);
        added.push(addSource(u, base, data, layoutIn));
      } catch (err) {
        if (err?.needsPassword) skipped.push(`${base} (needs a password: add it on its own)`);
        else if (err?.status === 400 || err?.status === 507 || err?.message) skipped.push(`${base} (${String(err.message).replace(/\.$/, '')})`);
        if (err?.status === 507) break;
      }
    }
    if (skipped.length) notes.push(`From ${name}, not added: ${skipped.slice(0, 20).join('; ')}${skipped.length > 20 ? ` and ${skipped.length - 20} more` : ''}.`);
    if (!added.length) throw bad(`${name} holds no files PDF Studio takes.${skipped.length ? ` ${notes[notes.length - 1]}` : ''}`);
    return { added, notes };
  }
  // One upload, whole or from pieces: { sources: [...], notes: [...] }, or { needsPassword }.
  function finishUpload(u, name, buf, layoutIn, { password, file } = {}) {
    if (!buf.length) throw bad(`${name} is empty.`);
    if (formatOf(buf, name) === 'zip') {
      const { added, notes } = addArchive(u, name, buf, layoutIn);
      return { sources: added.map(out), notes };
    }
    try {
      return { sources: [out(addSource(u, name, buf, layoutIn, { password, file }))], notes: [] };
    } catch (err) {
      if (err?.needsPassword) return { needsPassword: true, wrongPassword: err.wrongPassword, error: err.message };
      throw err;
    }
  }

  // One file in one request: { file: { name, type, data (base64) }, layout } (files up to
  // DIRECT_UPLOAD_BYTES; larger ones come in pieces, below).
  tool('POST', '/api/tools/pdf/sources', ({ body, user: u }) => {
    const f = body?.file;
    if (!f || typeof f.data !== 'string') throw bad('Choose a file.');
    const name = text(f.name, 160) || 'file';
    if (!f.data) throw bad(`${name} is empty.`);
    const orig = Buffer.from(f.data, 'base64');
    if (!orig.length) throw bad(`${name} is empty.`);
    checkRoom(u, orig.length, name);
    const r = finishUpload(u, name, orig, body.layout, { password: typeof body.password === 'string' ? body.password.slice(0, 200) : undefined });
    if (r.needsPassword) throw bad(r.error);
    // One source back, as before; a ZIP gives its first, and the rest with GET /api/tools/pdf.
    return r.sources.length === 1 && !r.notes.length ? r.sources[0] : { ...r.sources[0], more: r.sources.slice(1), notes: r.notes };
  });

  // ----- Uploads in pieces (0.66) -----
  // POST /uploads { name, size } → { id, chunkBytes }; PUT /uploads/:id { offset, data (base64) },
  // the pieces in order (one sent again is accepted); POST /uploads/:id/finish { layout, password }
  // → { sources, notes } or { needsPassword } (the upload is kept, to try again with the password);
  // DELETE /uploads/:id stops it. Pieces wait in data/pdf-studio/uploads, never in memory.
  const uploads = new Map();
  const upDir = path.join(dir, 'uploads');
  const pendingOf = (u) => [...uploads.values()].filter((x) => x.owner === u.id);
  const dropUpload = (x) => {
    uploads.delete(x.id);
    fs.rmSync(x.path, { force: true });
  };
  const findUpload = (id, u) => {
    const x = uploads.get(String(id || ''));
    if (!x || x.owner !== u.id) throw new HttpError(404, 'That upload is no longer on the server (it waited too long). Add the file again.');
    x.usedAt = Date.now();
    return x;
  };
  tool('POST', '/api/tools/pdf/uploads', ({ body, user: u }) => {
    const name = text(body?.name, 160) || 'file';
    const size = Number(body?.size);
    if (!Number.isInteger(size) || size <= 0) throw bad(`${name} is empty.`);
    if (pendingOf(u).length >= 6) throw bad('Wait for the files being added to finish, then add more.');
    checkRoom(u, size, name);
    const x = { id: randomUUID(), owner: u.id, name, size, received: 0, usedAt: Date.now() };
    x.path = path.join(upDir, `${x.id}.part`);
    fs.mkdirSync(upDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(x.path, Buffer.alloc(0), { mode: 0o600 });
    uploads.set(x.id, x);
    return { id: x.id, chunkBytes: CHUNK_BYTES };
  });
  tool('PUT', '/api/tools/pdf/uploads/:id', ({ params, body, user: u }) => {
    const x = findUpload(params.id, u);
    const offset = Number(body?.offset);
    if (typeof body?.data !== 'string' || !Number.isInteger(offset) || offset < 0) throw bad('Send a piece of the file.');
    const piece = Buffer.from(body.data, 'base64');
    if (!piece.length || piece.length > CHUNK_BYTES) throw bad(`Send the file in pieces of up to ${CHUNK_BYTES / MB} MB.`);
    // A piece sent again after its answer was lost: already here.
    if (offset + piece.length <= x.received) return { received: x.received };
    if (offset !== x.received) throw new HttpError(409, `The upload of ${x.name} lost its place. Add the file again.`);
    if (x.received + piece.length > x.size) throw bad(`${x.name} is larger than it said it was. Add the file again.`);
    fs.appendFileSync(x.path, piece);
    x.received += piece.length;
    return { received: x.received };
  });
  tool('POST', '/api/tools/pdf/uploads/:id/finish', ({ params, body, user: u }) => {
    const x = findUpload(params.id, u);
    if (x.received !== x.size) throw bad(`${x.name} did not arrive whole (${x.received} of ${x.size} bytes). Add it again.`);
    const buf = fs.readFileSync(x.path);
    const password = typeof body?.password === 'string' ? body.password.slice(0, 200) : undefined;
    let r;
    try {
      r = finishUpload(u, x.name, buf, body?.layout, { password, file: x.path });
    } catch (err) {
      dropUpload(x);
      throw err;
    }
    if (r.needsPassword) return r; // kept, to try again with the password
    dropUpload(x);
    return r;
  });
  tool('DELETE', '/api/tools/pdf/uploads/:id', ({ params, user: u }) => {
    const x = uploads.get(String(params.id || ''));
    if (x && x.owner === u.id) dropUpload(x);
    return { ok: true };
  });

  // A picture or document laid out again with other options (page size, margins…).
  tool('POST', '/api/tools/pdf/sources/:id/layout', ({ params, body, user: u }) => {
    const s = find(params.id, u);
    if (s.kind === 'pdf') throw bad('A PDF keeps its own pages; its layout cannot be changed here. Turn or remove its pages instead.');
    const orig = fs.readFileSync(origOf(s));
    const layout = cleanLayout(body?.layout);
    const made = render(s, orig, layout);
    load(s, made.pdf, made.captions);
    s.layout = layout;
    s.version = (s.version || 0) + 1; // its pages are drawn again
    s.warnings = made.warnings;
    fs.writeFileSync(fileOf(s), made.pdf, { mode: 0o600 });
    s.stored = made.pdf.length + orig.length;
    return out(s);
  });

  tool('DELETE', '/api/tools/pdf/sources/:id', ({ params, user: u }) => {
    drop(find(params.id, u));
    return { ok: true };
  });
  // Start over: all my files go.
  tool('DELETE', '/api/tools/pdf/sources', ({ user: u }) => {
    const list = mine(u);
    list.forEach(drop);
    return { removed: list.length };
  });

  // ----- The page editor (0.65): a page drawn as SVG, and where its lines of text are -----
  // Drawn by server/pdf/render.js (the browser has no PDF renderer here), kept while in use: the
  // last RENDERS_KEPT pages drawn, for everyone.
  const RENDERS_KEPT = 150;
  const renders = new Map();
  function rendered(s, n) {
    const k = `${s.id}:${s.version || 0}:${n}`;
    if (renders.has(k)) {
      const r = renders.get(k);
      renders.delete(k);
      renders.set(k, r);
      return r;
    }
    const r = renderPage(docOf(s), n);
    renders.set(k, r);
    while (renders.size > RENDERS_KEPT) renders.delete(renders.keys().next().value);
    return r;
  }
  const pageOf = (s, n) => {
    const i = Number(n);
    if (!Number.isInteger(i) || i < 0 || i >= s.pages.length) throw new HttpError(404, 'That page is not in this file.');
    return i;
  };
  // The page as a picture (SVG drawn by ATLAS: no scripts, no links, pictures inside as data).
  tool('GET', '/api/tools/pdf/sources/:id/pages/:n/svg', ({ params, user: u }) => {
    const s = find(params.id, u);
    const r = rendered(s, pageOf(s, params.n));
    return fileAnswer(Buffer.from(r.svg, 'utf8'), { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Disposition': 'inline; filename="page.svg"', 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
  });
  // Its lines of text, to change them in the editor (invisible text over a scan is left out).
  tool('GET', '/api/tools/pdf/sources/:id/pages/:n/text', ({ params, user: u }) => {
    const s = find(params.id, u);
    const r = rendered(s, pageOf(s, params.n));
    return { width: r.width, height: r.height, rotate: r.rotate || 0, note: r.error || null, runs: (r.runs || []).filter((x) => !x.invisible && x.text.trim()).map((x) => ({ id: x.id, text: x.text, x: x.x, y: x.y, width: x.width, height: x.height, size: runScale(x).size, family: x.family, bold: Boolean(x.bold), italic: Boolean(x.italic), color: x.color, editable: x.editable !== false })) };
  });

  // A page's thumbnail: the picture itself, or the scan of a scanned PDF page.
  tool('GET', '/api/tools/pdf/sources/:id/pages/:n/thumb', ({ params, user: u }) => {
    const s = find(params.id, u);
    const n = Number(params.n);
    if (!Number.isInteger(n) || n < 0 || n >= s.pages.length || !s.pages[n].thumb) throw new HttpError(404, 'This page has no picture to show.');
    let data;
    let type = 'image/jpeg';
    if (s.format === 'image') {
      data = fs.readFileSync(origOf(s));
      type = isPng(data) ? 'image/png' : 'image/jpeg';
    } else data = pageJpeg(docOf(s), n);
    if (!data) throw new HttpError(404, 'This page has no picture to show.');
    return fileAnswer(data, { 'Content-Type': type, 'Content-Disposition': 'inline; filename="page"', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
  });

  // The export. { pages: [{ source, page, rotate } | { blank: true, size, orientation }],
  // stamp: { numbers, header, footer, watermark }, meta: { title, author, subject }, split, fileName }.
  tool('POST', '/api/tools/pdf/export', ({ body, user: u, ip, agent }) => {
    const list = Array.isArray(body?.pages) ? body.pages : [];
    if (!list.length) throw bad('Add at least one page.');
    if (list.length > MAX_PAGES * 2) throw bad(`An export can have up to ${MAX_PAGES * 2} pages.`);
    const used = new Map();
    // Not too much drawing for one export (QA 0.65.1: 20 pages of 300 long text boxes held the
    // server for half a minute): the text typed in the editor, all pages together.
    const typed = list.reduce((n, p) => n + (Array.isArray(p?.edits) ? p.edits.reduce((m, e) => m + (typeof e?.text === 'string' ? e.text.length : 0), 0) : 0), 0);
    if (typed > 200000) throw bad('The page editor\'s text adds up to more than 200,000 characters in this export. Split it into smaller PDFs.');
    const pages = list.map((p, i) => {
      if (!p || typeof p !== 'object' || Array.isArray(p) || (!p.blank && typeof p.source !== 'string')) throw bad(`Page ${i + 1}: not a page of a file or a blank page.`);
      if (!ROTATIONS.includes((((Number(p.rotate) || 0) % 360) + 360) % 360)) throw bad('Pages turn by 90°, 180° or 270°.');
      let edits;
      try {
        edits = cleanEdits(p.edits);
      } catch (err) {
        throw bad(`Page ${i + 1}: ${err.message}`);
      }
      if (p?.blank) {
        const size = PAGE_SIZES[p.size] || PAGE_SIZES.a4;
        const landscape = p.orientation === 'landscape';
        return { blank: { width: landscape ? size[1] : size[0], height: landscape ? size[0] : size[1] }, edits: edits.filter((e) => e.type !== 'replace'), rotate: Number(p.rotate) || 0 };
      }
      const s = find(p?.source, u);
      const index = Number(p.page);
      if (!Number.isInteger(index) || index < 0 || index >= s.pages.length) throw bad(`Page ${i + 1}: that page is not in ${s.name}. Reload PDF Studio.`);
      const rotate = Number(p.rotate) || 0;
      if (!ROTATIONS.includes(((rotate % 360) + 360) % 360)) throw bad('Pages turn by 90°, 180° or 270°.');
      used.set(s.id, s);
      return { doc: docOf(s), index, rotate, source: s, edits };
    });
    // What one export may take (0.66): the files its pages come from, together.
    const takes = [...used.values()].reduce((n, x) => n + (x.stored || 0), 0);
    if (takes > MAX_EXPORT_BYTES) throw bad(`These pages come from files of ${Math.round(takes / MB)} MB together, more than one export takes (${MAX_EXPORT_BYTES / MB} MB). Export them in two or more parts.`);
    if (!roomOnDisk(takes * 2)) throw new HttpError(507, 'The server is short of disk space for this export right now. Try fewer pages, or ask your administrator.');
    // Signed (0.65): pages with a signature drawn, typed or uploaded in the editor. With a record
    // (one PDF only), a last page says who signed, when, and the code that finds this record.
    const signedPages = pages.map((p, i) => (hasSignature(p.edits || []) ? i + 1 : null)).filter(Boolean);
    // What to make (0.68): a PDF, or a document, spreadsheet or pictures read back from it.
    const as = Object.hasOwn(PDF_EXPORT_FORMATS, body?.as) ? body.as : 'pdf';
    const fmt = PDF_EXPORT_FORMATS[as];
    const record = as === 'pdf' && signedPages.length && body?.sign?.record !== false && body?.split !== 'documents' && body?.split !== 'pages';
    // A preview shows the record page as it will be, but records nothing.
    const preview = body?.preview === true && as === 'pdf';
    const stamp = cleanStamp(body?.stamp);
    const meta = { title: text(body?.meta?.title, 160), author: text(body?.meta?.author, 120), subject: text(body?.meta?.subject, 200), keywords: text(body?.meta?.keywords, 200) };
    const first = [...used.values()][0];
    const base = safeFileName(body?.fileName || meta.title || first?.title || first?.name?.replace(/\.[a-z0-9]+$/i, ''), 'document').replace(/\.pdf$/, '');
    meta.file = `${base}.pdf`;
    const split = ['documents', 'pages'].includes(body?.split) ? body.split : 'none';
    // Several files in a ZIP: one per source document (blank pages go with the pages before them),
    // or one per page. Page numbers start again in each. Names without their extension.
    const groupsOf = () => {
      const groups = [];
      if (split === 'pages') pages.forEach((p, i) => groups.push({ name: `${base} - page ${String(i + 1).padStart(String(pages.length).length, '0')}`, pages: [p] }));
      else {
        const bySource = new Map();
        let last = null;
        for (const p of pages) {
          // Blank pages go with the document before them (those before the first, with the first).
          const key = p.source ? p.source.id : last || pages.find((x) => x.source)?.source.id;
          if (!key) continue;
          if (!bySource.has(key)) {
            const src = p.source || used.get(key);
            bySource.set(key, { name: safeFileName(src?.name.replace(/\.[a-z0-9]+$/i, '') || 'document').replace(/\.pdf$/, ''), pages: [] });
          }
          bySource.get(key).pages.push(p);
          last = key;
        }
        groups.push(...bySource.values());
      }
      return groups;
    };
    let result;
    const notes = new Set();
    if (as !== 'pdf') {
      // Another kind of file (0.68): the PDF is made in memory as for a download, then read back
      // and written as a document, a spreadsheet or pictures (server/pdf/convert.js).
      const pictures = fmt.group === 'Pictures of the pages';
      const most = fmt.browser ? MAX_PICTURE_PAGES : MAX_CONVERT_PAGES;
      if (pages.length > most) throw bad(`${fmt.label} can be made from up to ${most} pages at a time; these are ${pages.length}. Export them in parts.`);
      if (takes > CONVERT_BYTES) throw bad(`These pages come from files of ${Math.round(takes / MB)} MB together; ${fmt.label} can be made from up to ${CONVERT_BYTES / MB} MB at a time. Export them in parts.`);
      // Page numbers, header, footer and watermark are drawn on pages: on pictures, not in documents.
      const pageStamp = pictures ? stamp : {};
      if (fmt.browser) {
        // PNG and JPEG: the browser draws each page's SVG at the sharpness asked and saves them.
        const pdf = buildPdf(pages, pageStamp, meta);
        const list = pageSvgs(pdf);
        const total = list.reduce((n, x) => n + x.svg.length, 0);
        if (total > MAX_SVG_REPLY) throw bad(`These pages hold too many pictures to draw at once (${Math.round(total / MB)} MB). Export fewer pages at a time.`);
        for (const s of used.values()) s.usedAt = Date.now();
        log({ kind: 'document', system: 'tools', action: `Exported ${fmt.label} from PDF Studio`, actor: u, ip, agent, targetName: base, detail: `${list.length} page${list.length === 1 ? '' : 's'} from ${used.size} file${used.size === 1 ? '' : 's'}` });
        return { base, ext: fmt.ext, pages: list.map((x) => ({ svg: x.svg, width: x.width, height: x.height })) };
      }
      const groups = pictures || split === 'none' ? [{ name: base, pages }] : groupsOf();
      const files = [];
      let paths = false;
      for (const g of groups) {
        const pdf = buildPdf(g.pages, pageStamp, { ...meta, file: `${g.name}.pdf` });
        let r;
        try {
          r = convertPdf(pdf, as, g.name, { ...meta, title: meta.title || g.name });
        } catch (err) {
          throw bad(`${g.name}: ${fmt.label} could not be made (${err.message}).`);
        }
        r.notes.forEach((n) => notes.add(n));
        // Markdown with its pictures: each document in its own folder when there are several.
        if (r.paths) {
          paths = true;
          if (groups.length > 1) r.files.forEach((f) => { f.name = `${g.name}/${f.name}`; });
        }
        files.push(...r.files);
      }
      if (files.length === 1) result = { data: files[0].buffer, size: files[0].buffer.length, name: files[0].name, type: MIME[as] || files[0].type };
      else {
        const zip = zipFiles(files.map((f) => ({ ...f, at: new Date(clock()).toISOString() })), { paths });
        result = { data: zip, size: zip.length, name: `${base}.zip`, type: 'application/zip' };
      }
    } else if (split === 'none') {
      let sig = null;
      if (record) {
        sig = { code: preview ? 'PREVIEW (not recorded)' : signingCode(), userId: u.id, name: u.name, username: u.username, at: new Date(clock()).toISOString(), fileName: `${base}.pdf`, pages: pages.length + 1, signedPages, signatures: pages.reduce((n, p) => n + (p.edits || []).filter((e) => e.type === 'image' && e.signature).length, 0) };
        const rec = docToPdf(recordDoc(sig, meta), { size: 'a4', orientation: 'portrait', margin: 20 });
        pages.push({ doc: readPdf(rec.pdf), index: 0, rotate: 0, noStamp: true });
      }
      // A large PDF is written to disk and sent from there (0.66), never held whole in memory twice.
      if (takes > BIG_EXPORT_BYTES) {
        fs.mkdirSync(upDir, { recursive: true, mode: 0o700 });
        const file = path.join(upDir, `${randomUUID()}.export`);
        const { size, sha256 } = buildPdf(pages, stamp, meta, { file });
        result = { data: new FileReply(file, { size, remove: true }), size, sha256, name: `${base}.pdf`, type: 'application/pdf' };
      } else {
        const data = buildPdf(pages, stamp, meta);
        result = { data, size: data.length, name: `${base}.pdf`, type: 'application/pdf' };
      }
      if (sig && !preview) {
        sig.sha256 = result.sha256 || createHash('sha256').update(result.data).digest('hex');
        sig.size = result.size;
        db.data.pdfSignatures ||= [];
        db.data.pdfSignatures.push(sig);
        if (db.data.pdfSignatures.length > 50000) db.data.pdfSignatures.splice(0, db.data.pdfSignatures.length - 50000);
        db.save();
        log({ kind: 'document', system: 'tools', action: 'Signed a PDF in PDF Studio', actor: u, ip, agent, targetName: result.name, detail: `Signed on page${signedPages.length === 1 ? '' : 's'} ${signedPages.join(', ')}; record ${sig.code}` });
      }
    } else {
      const files = groupsOf().map((g) => ({ name: `${g.name}.pdf`, type: 'application/pdf', at: new Date(clock()).toISOString(), buffer: buildPdf(g.pages, stamp, { ...meta, file: `${g.name}.pdf` }) }));
      const zip = zipFiles(files);
      result = { data: zip, size: zip.length, name: `${base}.zip`, type: 'application/zip' };
    }
    for (const s of used.values()) s.usedAt = Date.now();
    // Text typed for this export that the standard fonts cannot show: said in a header the page reads.
    const typedText = [stamp.header, stamp.footer, stamp.watermark?.text, ...pages.flatMap((p) => (p.edits || []).map((e) => e.text || ''))].join(' ');
    const missing = missingChars(typedText);
    if (!preview) log({ kind: 'document', system: 'tools', action: as === 'pdf' ? 'Exported a PDF from PDF Studio' : `Exported ${fmt.label} from PDF Studio`, actor: u, ip, agent, targetName: result.name, detail: `${list.length} page${list.length === 1 ? '' : 's'} from ${used.size} file${used.size === 1 ? '' : 's'} (${Math.round(result.size / 1024)} KB)` });
    // What the reading back could not keep (0.68): said in a header the page shows with the download.
    return fileAnswer(result.data, { 'Content-Type': result.type, 'Content-Disposition': disposition(result.name), 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'X-Download-Options': 'noopen', 'Cache-Control': 'no-store', ...(missing.length && as === 'pdf' ? { 'X-Atlas-Warning': encodeURIComponent(MISSING_NOTE(missing)) } : {}), ...(notes.size ? { 'X-Atlas-Note': encodeURIComponent([...notes].join(' ')) } : {}) });
  });

  // ----- Is this the PDF that was signed? (0.65) -----
  // The file's SHA-256 is looked up among the signature records: the same bytes, the same record. A
  // file whose record page names a code that is known, but whose bytes differ, was changed since.
  tool('POST', '/api/tools/pdf/verify', ({ body, user: u }) => {
    // The file in the request, or (0.66) an upload in pieces, which goes once it is checked.
    let buf;
    if (typeof body?.upload === 'string') {
      const x = findUpload(body.upload, u);
      if (x.received !== x.size) throw bad('The file did not arrive whole. Choose it again.');
      buf = fs.readFileSync(x.path);
      dropUpload(x);
    } else {
      const f = body?.file;
      if (!f || typeof f.data !== 'string' || !f.data) throw bad('Choose the signed PDF.');
      buf = Buffer.from(f.data, 'base64');
    }
    if (buf.length > MAX_FILE_BYTES) throw bad(`The file is larger than ${MAX_FILE_BYTES / MB} MB.`);
    const sha = createHash('sha256').update(buf).digest('hex');
    const list = db.data.pdfSignatures || [];
    const show = (r) => ({ code: r.code, name: r.name, at: r.at, fileName: r.fileName, pages: r.pages, signedPages: r.signedPages, signatures: r.signatures });
    const same = list.find((r) => r.sha256 === sha);
    if (same) return { result: 'valid', record: show(same) };
    let code = null;
    try {
      const doc = readPdf(buf);
      for (let i = doc.pageCount - 1; i >= Math.max(0, doc.pageCount - 3) && !code; i--) code = pageText(doc, i, 2000).match(/ATLAS-[A-Z2-9]{4}-[A-Z2-9]{4}/)?.[0] || null;
    } catch {
      return { result: 'unknown', reason: 'This file is not a PDF ATLAS can read.' };
    }
    const named = code && list.find((r) => r.code === code);
    if (named) return { result: 'changed', record: show(named) };
    return { result: 'unknown', reason: code ? `This PDF names the record ${code}, which is not in this ATLAS.` : 'This PDF was not signed in this ATLAS\'s PDF Studio (or its record page was removed).' };
  });

  return { sweep, sources, uploads };
}

// A signature record's code: ATLAS-XXXX-XXXX, letters and digits that cannot be mistaken (no 0/O, 1/I).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const signingCode = () => `ATLAS-${Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + CODE_CHARS[randomInt(CODE_CHARS.length)]).join('')}`;
// The record page added at the end of a signed PDF.
function recordDoc(sig, meta) {
  const when = new Date(sig.at).toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short', timeZone: process.env.TZ || 'Asia/Manila' });
  const row = (k, v) => ({ cells: [{ runs: [{ text: k, bold: true }] }, { runs: [{ text: String(v) }] }] });
  return {
    title: 'Signature record',
    blocks: [
      { type: 'heading', level: 1, runs: [{ text: 'Signature record' }] },
      { type: 'paragraph', runs: [{ text: 'This page was added by ATLAS PDF Studio when the document was signed. It records who signed, when, and where.' }] },
      { type: 'table', widths: [1, 2], rows: [
        row('Document', meta.title || sig.fileName), row('File', sig.fileName), row('Signed by', `${sig.name} (${sig.username})`), row('Signed on', when),
        row('Signatures', `${sig.signatures} on page${sig.signedPages.length === 1 ? '' : 's'} ${sig.signedPages.join(', ')} of ${sig.pages}`), row('Record', sig.code),
      ] },
      { type: 'paragraph', runs: [{ text: 'To check that this file is the one that was signed, open ATLAS → Tools → PDF Studio → Verify a signed PDF, and choose this file. ATLAS compares its contents with what it recorded when it was signed: any change to the file since, however small, shows.' }] },
      { type: 'paragraph', runs: [{ text: `Record ${sig.code}`, mono: true, size: 14 }] },
    ],
  };
}

// Page numbers, header, footer and watermark, as sent by the page.
export function cleanStamp(v) {
  const s = v && typeof v === 'object' ? v : {};
  const out = {};
  if (s.numbers && typeof s.numbers === 'object') {
    const start = Number(s.numbers.start);
    out.numbers = {
      format: Object.hasOwn(NUMBER_FORMATS, s.numbers.format) ? s.numbers.format : 'of',
      position: Object.hasOwn(NUMBER_POSITIONS, s.numbers.position) ? s.numbers.position : 'bottom-center',
      start: Number.isInteger(start) && start >= 0 && start <= 100000 ? start : 1,
      skipFirst: s.numbers.skipFirst === true,
    };
  }
  const align = (a) => (['left', 'center', 'right'].includes(a) ? a : undefined);
  if (text(s.header, 120)) Object.assign(out, { header: text(s.header, 120), headerAlign: align(s.headerAlign) || 'center' });
  if (text(s.footer, 120)) Object.assign(out, { footer: text(s.footer, 120), footerAlign: align(s.footerAlign) || 'left' });
  if (s.watermark && text(s.watermark.text, 60)) {
    const o = Number(s.watermark.opacity);
    out.watermark = { text: text(s.watermark.text, 60), opacity: Number.isFinite(o) ? Math.max(0.05, Math.min(0.6, o)) : 0.15, color: ['gray', 'red', 'blue'].includes(s.watermark.color) ? s.watermark.color : 'gray' };
  }
  return out;
}
