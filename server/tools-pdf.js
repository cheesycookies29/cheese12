// PDF Studio (0.64): the tool on the CORE home that turns documents and pictures into PDF and puts
// PDFs together. Anyone signed in can use it while it is on for the company (Admin panel →
// Modules); off, the server refuses it for everyone but administrators (shared/modules.js).
//
// How it works: each file uploaded becomes a *source*, kept as a PDF — a PDF as it came; a picture
// on a page (server/pdf/layout.js imageToPdf); a Word, Excel, PowerPoint, OpenDocument, text,
// Markdown, CSV or HTML file read into blocks (server/pdf/office.js) and laid out on pages
// (docToPdf). The browser arranges the pages of all sources (order, turn, remove, blank pages);
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
import { HttpError } from './util.js';
import { noAudit } from './audit.js';
import { sniffOffice } from './attachments.js';
import { DOCX, XLSX, PPTX, ODT, ODS, ODP } from '../shared/files.js';
import { zipFiles } from './zip.js';
import { toBlocks } from './pdf/office.js';
import { docToPdf, imageToPdf } from './pdf/layout.js';
import { readPdf, pageJpeg, pageText } from './pdf/reader.js';
import { buildPdf, NUMBER_FORMATS, NUMBER_POSITIONS } from './pdf/build.js';
import { renderPage } from './pdf/render.js';
import { cleanEdits, hasSignature } from './pdf/edits.js';
import { isJpeg, isPng } from './pdf/images.js';
import { PAGE_SIZES } from './pdf/writer.js';
import { PDF_LIMITS } from '../shared/pdf-studio.js';

const MB = 1024 * 1024;
const { maxFileBytes: MAX_FILE_BYTES, maxSources: MAX_SOURCES, maxStoredBytes: MAX_STORED_BYTES, maxPages: MAX_PAGES, sourceHours: SOURCE_HOURS } = PDF_LIMITS;
const OFFICE = { [DOCX]: 'docx', [XLSX]: 'xlsx', [PPTX]: 'pptx', [ODT]: 'odt', [ODS]: 'ods', [ODP]: 'odp' };
const TEXT_KINDS = { txt: 'txt', text: 'txt', md: 'md', markdown: 'md', csv: 'csv', html: 'html', htm: 'html' };
const FORMAT_NAME = { pdf: 'PDF', image: 'Picture', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', odt: 'OpenDocument text', ods: 'OpenDocument spreadsheet', odp: 'OpenDocument presentation', txt: 'Text', md: 'Markdown', csv: 'CSV', html: 'Web page' };
const ROTATIONS = [0, 90, 180, 270];
const bad = (msg) => new HttpError(400, msg);

// What a file is, by what it holds (never its name alone, except to tell text kinds apart).
export function formatOf(buf, fileName = '') {
  const head = buf.subarray(0, 1024).toString('latin1');
  if (head.includes('%PDF-')) return 'pdf';
  if (isJpeg(buf) || isPng(buf)) return 'image';
  const office = sniffOffice(buf);
  if (office) return OFFICE[office] || null;
  const ext = String(fileName).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (ext && TEXT_KINDS[ext] && buf.length && !buf.subarray(0, 8192).includes(0)) return TEXT_KINDS[ext];
  return null;
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

export function registerPdfStudio(route, db, { audit, clock = () => new Date() } = {}) {
  const dir = path.join(db.dir, 'pdf-studio');
  // Nothing survives a restart: the files of the last run go.
  fs.rmSync(dir, { recursive: true, force: true });
  const sources = new Map(); // id → source (with its parsed PDF in `doc` while in use)
  const fileOf = (s) => path.join(dir, `${s.id}.pdf`);
  const origOf = (s) => path.join(dir, `${s.id}.orig`);
  const mine = (u) => [...sources.values()].filter((s) => s.owner === u.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  function drop(s) {
    sources.delete(s.id);
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
  };
  const timer = setInterval(sweep, 10 * 60 * 1000);
  timer.unref?.();

  // The PDF of a source, made (again) with the layout options.
  function render(s, orig, layout) {
    if (s.kind === 'pdf') return { pdf: orig, captions: null, warnings: [] };
    if (s.kind === 'image') {
      const out = imageToPdf(orig, layout, { title: s.title });
      return { pdf: out.pdf, captions: [''], warnings: [] };
    }
    let doc;
    try {
      doc = toBlocks(orig, s.format, { fileName: s.name });
    } catch (err) {
      throw bad(err.message || `CORE could not read this ${FORMAT_NAME[s.format]} file.`);
    }
    const out = docToPdf(doc, layout, { title: doc.title || s.title });
    if (doc.title && !s.title) s.title = doc.title;
    return { pdf: out.pdf, captions: out.captions, warnings: doc.warnings || [] };
  }
  // Reads the source's PDF and notes its pages: size, turn, a caption, and whether it has a picture
  // to show as its thumbnail (a picture; a scanned page).
  function load(s, pdf, captions) {
    let doc;
    try {
      doc = readPdf(pdf);
    } catch (err) {
      throw bad(err.message || 'This PDF could not be read.');
    }
    if (!doc.pageCount) throw bad('This PDF has no pages.');
    if (doc.pageCount > MAX_PAGES) throw bad(`This file has ${doc.pageCount} pages; PDF Studio takes files of up to ${MAX_PAGES} pages.`);
    s.doc = doc;
    s.pages = doc.pages.map((p, i) => ({
      width: Math.round(p.width * 100) / 100, height: Math.round(p.height * 100) / 100, rotate: p.rotate || 0,
      caption: captions ? captions[i] || '' : i < 300 ? pageText(doc, i, 90) : '',
      thumb: s.kind === 'image' || (s.kind === 'pdf' && i < 500 && Boolean(pageJpeg(doc, i))),
    }));
    if (s.kind === 'pdf' && !s.title && doc.info?.title) s.title = String(doc.info.title).slice(0, 160);
  }
  const out = (s) => ({ id: s.id, name: s.name, kind: s.kind, format: s.format, formatName: FORMAT_NAME[s.format] || s.format, size: s.size, title: s.title || '', layout: s.layout, pages: s.pages, warnings: s.warnings, createdAt: s.createdAt, canLayout: s.kind !== 'pdf' });
  const storedBy = (u) => mine(u).reduce((n, s) => n + s.stored, 0);

  route('GET', '/api/tools/pdf', 'auth', ({ user: u }) => ({ sources: mine(u).map(out), limits: PDF_LIMITS, numberFormats: NUMBER_FORMATS, numberPositions: NUMBER_POSITIONS }));

  // One file: { file: { name, type, data (base64) }, layout }.
  route('POST', '/api/tools/pdf/sources', 'auth', ({ body, user: u }) => {
    noAudit();
    const f = body?.file;
    if (!f || typeof f.data !== 'string' || !f.data) throw bad('Choose a file.');
    const name = text(f.name, 160) || 'file';
    const orig = Buffer.from(f.data, 'base64');
    if (!orig.length) throw bad(`${name} is empty.`);
    if (orig.length > MAX_FILE_BYTES) throw bad(`${name} is larger than ${MAX_FILE_BYTES / MB} MB. Split it, or make its pictures smaller, and try again.`);
    if (mine(u).length >= MAX_SOURCES) throw bad(`PDF Studio holds up to ${MAX_SOURCES} files at a time. Remove some, or export and start over.`);
    if (storedBy(u) + orig.length * 2 > MAX_STORED_BYTES) throw bad(`Your files in PDF Studio add up to more than ${MAX_STORED_BYTES / MB} MB. Remove some, or export and start over.`);
    const format = formatOf(orig, name);
    if (!format) throw bad(`CORE cannot turn ${name} into a PDF. It takes PDFs, pictures (JPEG, PNG; others are converted in your browser), Word, Excel and PowerPoint files (.docx, .xlsx, .pptx), OpenDocument files (.odt, .ods, .odp), text, Markdown, CSV and HTML files. Older Office files (.doc, .xls, .ppt): save them in the newer format first.`);
    const now = new Date(clock()).toISOString();
    const s = { id: randomUUID(), owner: u.id, name, format, kind: format === 'pdf' ? 'pdf' : format === 'image' ? 'image' : 'doc', size: orig.length, title: '', createdAt: now, usedAt: Date.now(), layout: cleanLayout(body.layout), warnings: [] };
    const made = render(s, orig, s.layout);
    load(s, made.pdf, made.captions);
    s.warnings = made.warnings;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(fileOf(s), made.pdf, { mode: 0o600 });
    if (s.kind !== 'pdf') fs.writeFileSync(origOf(s), orig, { mode: 0o600 });
    s.stored = made.pdf.length + (s.kind !== 'pdf' ? orig.length : 0);
    sources.set(s.id, s);
    return out(s);
  });

  // A picture or document laid out again with other options (page size, margins…).
  route('POST', '/api/tools/pdf/sources/:id/layout', 'auth', ({ params, body, user: u }) => {
    noAudit();
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

  route('DELETE', '/api/tools/pdf/sources/:id', 'auth', ({ params, user: u }) => {
    noAudit();
    drop(find(params.id, u));
    return { ok: true };
  });
  // Start over: all my files go.
  route('DELETE', '/api/tools/pdf/sources', 'auth', ({ user: u }) => {
    noAudit();
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
    if (!s.doc) s.doc = readPdf(fs.readFileSync(fileOf(s)));
    const r = renderPage(s.doc, n);
    renders.set(k, r);
    while (renders.size > RENDERS_KEPT) renders.delete(renders.keys().next().value);
    return r;
  }
  const pageOf = (s, n) => {
    const i = Number(n);
    if (!Number.isInteger(i) || i < 0 || i >= s.pages.length) throw new HttpError(404, 'That page is not in this file.');
    return i;
  };
  // The page as a picture (SVG drawn by CORE: no scripts, no links, pictures inside as data).
  route('GET', '/api/tools/pdf/sources/:id/pages/:n/svg', 'auth', ({ params, user: u }) => {
    const s = find(params.id, u);
    const r = rendered(s, pageOf(s, params.n));
    return { data: Buffer.from(r.svg, 'utf8'), headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Disposition': 'inline; filename="page.svg"', 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' } };
  });
  // Its lines of text, to change them in the editor (invisible text over a scan is left out).
  route('GET', '/api/tools/pdf/sources/:id/pages/:n/text', 'auth', ({ params, user: u }) => {
    const s = find(params.id, u);
    const r = rendered(s, pageOf(s, params.n));
    return { width: r.width, height: r.height, rotate: r.rotate || 0, runs: (r.runs || []).filter((x) => !x.invisible && x.text.trim()).map((x) => ({ id: x.id, text: x.text, x: x.x, y: x.y, width: x.width, height: x.height, size: x.size, family: x.family, bold: Boolean(x.bold), italic: Boolean(x.italic), color: x.color, editable: x.editable !== false })) };
  });

  // A page's thumbnail: the picture itself, or the scan of a scanned PDF page.
  route('GET', '/api/tools/pdf/sources/:id/pages/:n/thumb', 'auth', ({ params, user: u }) => {
    const s = find(params.id, u);
    const n = Number(params.n);
    if (!Number.isInteger(n) || n < 0 || n >= s.pages.length || !s.pages[n].thumb) throw new HttpError(404, 'This page has no picture to show.');
    let data;
    let type = 'image/jpeg';
    if (s.kind === 'image') {
      data = fs.readFileSync(origOf(s));
      type = isPng(data) ? 'image/png' : 'image/jpeg';
    } else data = pageJpeg(s.doc || readPdf(fs.readFileSync(fileOf(s))), n);
    if (!data) throw new HttpError(404, 'This page has no picture to show.');
    return { data, headers: { 'Content-Type': type, 'Content-Disposition': 'inline; filename="page"', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' } };
  });

  // The export. { pages: [{ source, page, rotate } | { blank: true, size, orientation }],
  // stamp: { numbers, header, footer, watermark }, meta: { title, author, subject }, split, fileName }.
  route('POST', '/api/tools/pdf/export', 'auth', ({ body, user: u }) => {
    const list = Array.isArray(body?.pages) ? body.pages : [];
    if (!list.length) throw bad('Add at least one page.');
    if (list.length > MAX_PAGES * 2) throw bad(`An export can have up to ${MAX_PAGES * 2} pages.`);
    const used = new Map();
    const pages = list.map((p, i) => {
      const edits = cleanEdits(p?.edits);
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
      if (!s.doc) s.doc = readPdf(fs.readFileSync(fileOf(s)));
      used.set(s.id, s);
      return { doc: s.doc, index, rotate, source: s, edits };
    });
    // Signed (0.65): pages with a signature drawn, typed or uploaded in the editor. With a record
    // (one PDF only), a last page says who signed, when, and the code that finds this record.
    const signedPages = pages.map((p, i) => (hasSignature(p.edits || []) ? i + 1 : null)).filter(Boolean);
    const record = signedPages.length && body?.sign?.record !== false && body?.split !== 'documents' && body?.split !== 'pages';
    const stamp = cleanStamp(body?.stamp);
    const meta = { title: text(body?.meta?.title, 160), author: text(body?.meta?.author, 120), subject: text(body?.meta?.subject, 200), keywords: text(body?.meta?.keywords, 200) };
    const first = [...used.values()][0];
    const base = safeFileName(body?.fileName || meta.title || first?.title || first?.name?.replace(/\.[a-z0-9]+$/i, ''), 'document').replace(/\.pdf$/, '');
    meta.file = `${base}.pdf`;
    const split = ['documents', 'pages'].includes(body?.split) ? body.split : 'none';
    let result;
    if (split === 'none') {
      let sig = null;
      if (record) {
        sig = { code: signingCode(), userId: u.id, name: u.name, username: u.username, at: new Date(clock()).toISOString(), fileName: `${base}.pdf`, pages: pages.length + 1, signedPages, signatures: pages.reduce((n, p) => n + (p.edits || []).filter((e) => e.type === 'image' && e.signature).length, 0) };
        const rec = docToPdf(recordDoc(sig, meta), { size: 'a4', orientation: 'portrait', margin: 20 });
        pages.push({ doc: readPdf(rec.pdf), index: 0, rotate: 0, noStamp: true });
      }
      result = { data: buildPdf(pages, stamp, meta), name: `${base}.pdf`, type: 'application/pdf' };
      if (sig) {
        sig.sha256 = createHash('sha256').update(result.data).digest('hex');
        sig.size = result.data.length;
        db.data.pdfSignatures ||= [];
        db.data.pdfSignatures.push(sig);
        if (db.data.pdfSignatures.length > 50000) db.data.pdfSignatures.splice(0, db.data.pdfSignatures.length - 50000);
        db.save();
        audit?.record('tools.pdf-signed', { label: 'PDF Studio', note: `${result.name} signed on page${signedPages.length === 1 ? '' : 's'} ${signedPages.join(', ')}; record ${sig.code}` });
      }
    } else {
      // Several PDFs in a ZIP: one per source document (blank pages go with the pages before them),
      // or one per page. Page numbers start again in each.
      const groups = [];
      if (split === 'pages') pages.forEach((p, i) => groups.push({ name: `${base} - page ${String(i + 1).padStart(String(pages.length).length, '0')}.pdf`, pages: [p] }));
      else {
        const bySource = new Map();
        let last = null;
        for (const p of pages) {
          const key = p.source ? p.source.id : last;
          if (!key) continue; // blank pages before any document
          if (!bySource.has(key)) bySource.set(key, { name: safeFileName(p.source?.name.replace(/\.[a-z0-9]+$/i, '') || 'document'), pages: [] });
          bySource.get(key).pages.push(p);
          last = key;
        }
        groups.push(...bySource.values());
      }
      const files = groups.map((g) => ({ name: g.name, type: 'application/pdf', at: new Date(clock()).toISOString(), buffer: buildPdf(g.pages, stamp, { ...meta, file: g.name }) }));
      result = { data: zipFiles(files), name: `${base}.zip`, type: 'application/zip' };
    }
    for (const s of used.values()) s.usedAt = Date.now();
    audit?.record('tools.pdf-export', { label: 'PDF Studio', note: `${list.length} page${list.length === 1 ? '' : 's'} from ${used.size} file${used.size === 1 ? '' : 's'} → ${result.name} (${Math.round(result.data.length / 1024)} KB)` });
    return { data: result.data, headers: { 'Content-Type': result.type, 'Content-Disposition': disposition(result.name), 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'X-Download-Options': 'noopen', 'Cache-Control': 'no-store' } };
  });

  // ----- Is this the PDF that was signed? (0.65) -----
  // The file's SHA-256 is looked up among the signature records: the same bytes, the same record. A
  // file whose record page names a code that is known, but whose bytes differ, was changed since.
  route('POST', '/api/tools/pdf/verify', 'auth', ({ body }) => {
    noAudit();
    const f = body?.file;
    if (!f || typeof f.data !== 'string' || !f.data) throw bad('Choose the signed PDF.');
    const buf = Buffer.from(f.data, 'base64');
    if (buf.length > MAX_FILE_BYTES) throw bad(`The file is larger than ${MAX_FILE_BYTES / MB} MB.`);
    const sha = createHash('sha256').update(buf).digest('hex');
    const list = db.data.pdfSignatures || [];
    const show = (r) => ({ code: r.code, name: r.name, at: r.at, fileName: r.fileName, pages: r.pages, signedPages: r.signedPages, signatures: r.signatures });
    const same = list.find((r) => r.sha256 === sha);
    if (same) return { result: 'valid', record: show(same) };
    let code = null;
    try {
      const doc = readPdf(buf);
      for (let i = doc.pageCount - 1; i >= Math.max(0, doc.pageCount - 3) && !code; i--) code = pageText(doc, i, 2000).match(/CORE-[A-Z2-9]{4}-[A-Z2-9]{4}/)?.[0] || null;
    } catch {
      return { result: 'unknown', reason: 'This file is not a PDF CORE can read.' };
    }
    const named = code && list.find((r) => r.code === code);
    if (named) return { result: 'changed', record: show(named) };
    return { result: 'unknown', reason: code ? `This PDF names the record ${code}, which is not in this CORE.` : 'This PDF was not signed in this CORE\'s PDF Studio (or its record page was removed).' };
  });

  return { sweep, sources };
}

// A signature record's code: CORE-XXXX-XXXX, letters and digits that cannot be mistaken (no 0/O, 1/I).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const signingCode = () => `CORE-${Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + CODE_CHARS[randomInt(CODE_CHARS.length)]).join('')}`;
// The record page added at the end of a signed PDF.
function recordDoc(sig, meta) {
  const when = new Date(sig.at).toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short', timeZone: process.env.TZ || 'Asia/Manila' });
  const row = (k, v) => ({ cells: [{ runs: [{ text: k, bold: true }] }, { runs: [{ text: String(v) }] }] });
  return {
    title: 'Signature record',
    blocks: [
      { type: 'heading', level: 1, runs: [{ text: 'Signature record' }] },
      { type: 'paragraph', runs: [{ text: 'This page was added by CORE PDF Studio when the document was signed. It records who signed, when, and where.' }] },
      { type: 'table', widths: [1, 2], rows: [
        row('Document', meta.title || sig.fileName), row('File', sig.fileName), row('Signed by', `${sig.name} (${sig.username})`), row('Signed on', when),
        row('Signatures', `${sig.signatures} on page${sig.signedPages.length === 1 ? '' : 's'} ${sig.signedPages.join(', ')} of ${sig.pages}`), row('Record', sig.code),
      ] },
      { type: 'paragraph', runs: [{ text: 'To check that this file is the one that was signed, open CORE → PDF Studio → Verify a signed PDF, and choose this file. CORE compares its contents with what it recorded when it was signed: any change to the file since, however small, shows.' }] },
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
