// PDF Studio (0.64): the PDF people download. Pages are taken from the sources (each upload is kept
// as a PDF: a PDF as it came, a picture or a document as CORE laid it out), in the order arranged,
// each turned as asked; blank pages can go in between. Then, on every page, what was asked for:
// page numbers, a header and a footer line, and a see-through watermark, upright however the page
// is turned. The result is one PDF, or (split) several: one per source document or one per page.
import { PdfWriter, Content, Ref, FONTS, ref, textWidth, PAGE_SIZES } from './writer.js';
import { importPages } from './reader.js';
import { renderPage, removeTextOps } from './render.js';
import { drawEdits, drawReplacements } from './edits.js';
import { embedImage } from './images.js';

export const NUMBER_FORMATS = { n: '1', of: 'Page 1 of 9', slash: '1 / 9' };
export const NUMBER_POSITIONS = { 'bottom-center': 'Bottom centre', 'bottom-right': 'Bottom right', 'bottom-left': 'Bottom left', 'top-right': 'Top right', 'top-center': 'Top centre' };
const EDGE = 22; // points from the edge of the page to the stamps

// A value in the writer: an object it holds, for a ref.
const deref = (writer, v) => (v instanceof Ref ? writer.objects[v.n] : v);
const box = (writer, dict) => {
  const b = deref(writer, dict.CropBox) || deref(writer, dict.MediaBox) || [0, 0, ...PAGE_SIZES.a4];
  const n = (b || []).map((x) => Number(deref(writer, x)) || 0);
  return { x: Math.min(n[0], n[2]), y: Math.min(n[1], n[3]), w: Math.abs(n[2] - n[0]) || PAGE_SIZES.a4[0], h: Math.abs(n[3] - n[1]) || PAGE_SIZES.a4[1] };
};

// The text of a header or footer, with {page}, {pages}, {title}, {date} and {file} filled in.
export const fillIn = (text, v) => String(text || '').replace(/\{(page|pages|title|date|file)\}/g, (all, k) => String(v[k] ?? ''));

// What is drawn over one page, in the page as it is shown (w × h, upright).
function stamps(c, w, h, s, v) {
  const gray = () => c.color(0.35, 0.36, 0.4);
  const size = 9;
  const put = (text, where, y) => {
    if (!text) return;
    const tw = textWidth(text, FONTS.regular, size);
    const x = where === 'right' ? w - EDGE - tw : where === 'left' ? EDGE : (w - tw) / 2;
    c.save();
    gray();
    c.text(Math.max(4, x), y, text, FONTS.regular, size);
    c.restore();
  };
  if (s.watermark?.text) {
    const text = String(s.watermark.text).slice(0, 60);
    const angle = Math.atan2(h, w);
    const diag = Math.hypot(w, h);
    const one = textWidth(text, FONTS.bold, 1) || 1;
    const fs = Math.max(12, Math.min(140, (diag * 0.7) / one));
    const tw = one * fs;
    const cx = w / 2;
    const cy = h / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = cx - (tw / 2) * cos + fs * 0.35 * sin;
    const y = cy - (tw / 2) * sin - fs * 0.35 * cos;
    c.save().opacity(Math.max(0.05, Math.min(0.6, Number(s.watermark.opacity) || 0.15)));
    const col = s.watermark.color === 'red' ? [0.75, 0.1, 0.1] : s.watermark.color === 'blue' ? [0.1, 0.3, 0.7] : [0.45, 0.45, 0.48];
    c.color(...col);
    c.textRotated(x, y, text, FONTS.bold, fs, (angle * 180) / Math.PI);
    c.restore();
  }
  if (s.header) put(fillIn(s.header, v), s.headerAlign || 'center', h - EDGE - size * 0.4);
  if (s.footer) put(fillIn(s.footer, v), s.footerAlign || 'left', EDGE - size * 0.2);
  if (s.numbers && v.numbered) {
    const text = s.numbers.format === 'of' ? `Page ${v.page} of ${v.pages}` : s.numbers.format === 'slash' ? `${v.page} / ${v.pages}` : String(v.page);
    const pos = s.numbers.position || 'bottom-center';
    const [vert, horiz] = pos.split('-');
    put(text, horiz === 'center' ? 'center' : horiz, vert === 'top' ? h - EDGE - size * 0.4 : EDGE - size * 0.2);
  }
}
const hasStamps = (s) => Boolean(s.numbers || s.header || s.footer || s.watermark?.text);

// pages: [{ doc, index, rotate, edits, noStamp } | { blank: { width, height }, edits }] (doc: from
// readPdf; edits: cleanEdits() of edits.js; noStamp: no page number etc. on it, e.g. a signature record).
// stamp: { numbers: { format, position, start, skipFirst }, header, headerAlign, footer, footerAlign,
// watermark: { text, opacity, color } }; meta: { title, author, subject, keywords, file }.
export function buildPdf(pages, stamp = {}, meta = {}) {
  const writer = new PdfWriter({ title: meta.title || '', author: meta.author || '', subject: meta.subject || '', keywords: meta.keywords || '' });
  const start = Number.isInteger(stamp.numbers?.start) ? stamp.numbers.start : 1;
  const skipFirst = Boolean(stamp.numbers?.skipFirst);
  const counted = pages.filter((p) => !p.noStamp).length - (skipFirst ? 1 : 0); // a signature record page is not counted
  const date = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: process.env.TZ || 'Asia/Manila' });
  // "q" and "Q" around a page's own drawing, so whatever it leaves changed does not move the stamps.
  let qq = null;
  pages.forEach((p, i) => {
    let dict;
    if (p.blank) dict = { MediaBox: [0, 0, p.blank.width, p.blank.height], Resources: {}, Contents: ref(writer.stream({}, Buffer.alloc(0), { compress: false })) };
    else [dict] = importPages(p.doc, writer, [p.index]);
    // Quarter turns only (a damaged /Rotate of 45 counts as none).
    const quarter = (v) => ((Math.round((Number(v) || 0) / 90) * 90) % 360 + 360) % 360;
    const own = quarter(deref(writer, dict.Rotate));
    const turn = quarter(own + quarter(p.rotate));
    if (turn) dict.Rotate = turn;
    else delete dict.Rotate;
    // Changes from the page editor (0.65): lines of text changed in the page itself, then what was
    // added on top (text, white-out, highlights, marks, signatures), then the stamps.
    const edits = p.edits || [];
    const replaces = edits.filter((e) => e.type === 'replace');
    let runs = new Map();
    if (replaces.length && p.doc) {
      runs = new Map((renderPage(p.doc, p.index).runs || []).filter((r) => r.editable !== false).map((r) => [r.id, r]));
      const ids = replaces.map((e) => e.run).filter((id) => runs.has(id));
      if (ids.length) dict.Contents = ref(writer.stream({}, removeTextOps(p.doc, p.index, ids)));
    }
    const stamped = hasStamps(stamp) && !p.noStamp;
    if (stamped || edits.length) {
      const b = box(writer, dict);
      const sideways = turn === 90 || turn === 270;
      const w = sideways ? b.h : b.w;
      const h = sideways ? b.w : b.h;
      const c = new Content({ prefix: 'Core' });
      const images = {};
      let imageNo = 0;
      drawReplacements(c, replaces, runs, b.x, b.y);
      // From the page as shown (upright) to the page as stored.
      const m = { 0: [1, 0, 0, 1, b.x, b.y], 90: [0, 1, -1, 0, b.x + b.w, b.y], 180: [-1, 0, 0, -1, b.x + b.w, b.y + b.h], 270: [0, -1, 1, 0, b.x, b.y + b.h] }[turn];
      c.save().transform(...m);
      drawEdits(c, edits.filter((e) => e.type !== 'text' || e.text.trim()), h, (data) => {
        const key = `Im${++imageNo}`;
        images[key] = embedImage(writer, data).id;
        return key;
      }, w);
      const numbered = !(skipFirst && i === 0);
      // A cover left unnumbered has no {page} in its header or footer either.
      if (stamped) stamps(c, w, h, stamp, { page: numbered ? start + i - (skipFirst ? 1 : 0) : '', pages: start - 1 + counted, numbered, title: meta.title || '', date, file: meta.file || '' });
      c.restore();
      if (!qq) qq = { q: writer.stream({}, Buffer.from('q'), { compress: false }), Q: writer.stream({}, Buffer.from('Q'), { compress: false }) };
      const overlay = writer.stream({}, c.toBuffer());
      const contents = deref(writer, dict.Contents);
      const list = Array.isArray(contents) ? contents : dict.Contents ? [dict.Contents] : [];
      dict.Contents = [ref(qq.q), ...list, ref(qq.Q), ref(overlay)];
      // The page's resources, with the stamps' fonts and pictures added under names of their own.
      const res = { ...(deref(writer, dict.Resources) || {}) };
      for (const k of ['Font', 'ExtGState', 'XObject']) if (res[k]) res[k] = { ...(deref(writer, res[k]) || {}) };
      dict.Resources = writer.resourcesFor(c, res, images);
    }
    writer.addPage(dict);
  });
  return writer.toBuffer();
}
