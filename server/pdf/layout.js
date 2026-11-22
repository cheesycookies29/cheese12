// PDF Studio (0.64): laying a document out on pages. A document is the block model that
// server/pdf/office.js makes from Word, Excel, PowerPoint, OpenDocument, text, Markdown, CSV and
// HTML files: headings, paragraphs of styled runs, lists, tables, pictures, code, rules and page
// breaks. This module wraps the text in the standard PDF fonts, flows it down the page and on to the
// next, repeats a table's header rows on each page, and scales pictures to fit. It also makes the
// one-page PDF of a picture (imageToPdf).
import { PdfWriter, Content, FONTS, PAGE_SIZES, encodeWinAnsi, widthOf } from './writer.js';
import { embedImage, imageSize } from './images.js';

// Page geometry from the options: size ('a4' | 'letter' | 'legal' | 'a5'), orientation
// ('portrait' | 'landscape' | 'auto' with the document's own preference), margin in millimetres.
export function pageGeometry({ size = 'a4', orientation = 'auto', margin = 18 } = {}, preferLandscape = false) {
  const [w, h] = PAGE_SIZES[size] || PAGE_SIZES.a4;
  const landscape = orientation === 'landscape' || (orientation === 'auto' && preferLandscape);
  const m = Math.max(0, Math.min(50, Number(margin) || 0)) * (72 / 25.4);
  return { width: landscape ? h : w, height: landscape ? w : h, margin: m };
}

const HEADING = { 1: 20, 2: 16, 3: 13.5, 4: 12 };
const fontOf = (run) => (run.mono ? (run.bold ? FONTS.monoBold : FONTS.mono) : run.bold && run.italic ? FONTS.boldItalic : run.bold ? FONTS.bold : run.italic ? FONTS.italic : FONTS.regular);
const LINK = [0.05, 0.33, 0.66];

// ---------- Text into lines ----------
// Pieces of text with one font each, split at spaces so lines can break between them. A piece:
// { buf, font, size, color, underline, space: true when it is a run of spaces, br: a line break }.
function pieces(runs, base) {
  const out = [];
  for (const r of runs || []) {
    const size = r.size ? Math.max(5, Math.min(48, r.size)) * (base / 11) : base;
    const font = fontOf(r);
    const color = r.link ? LINK : r.color || null;
    const underline = Boolean(r.underline || r.link);
    for (const part of String(r.text ?? '').split(/(\n| +)/)) {
      if (!part) continue;
      if (part === '\n') out.push({ br: true, size });
      else out.push({ buf: encodeWinAnsi(part), font, size, color, underline, space: part[0] === ' ' });
    }
  }
  for (const p of out) if (p.buf) p.w = widthOf(p.buf, p.font, p.size);
  return out;
}
// Lines no wider than `width`: [{ items: [piece], w, h (line height), asc }]. A word wider than a
// whole line is cut into pieces that fit.
function wrap(list, width, lineGap = 1.3) {
  const lines = [];
  let cur = [];
  let w = 0;
  const finish = () => {
    while (cur.length && cur[cur.length - 1].space) w -= cur.pop().w; // no trailing spaces
    const size = cur.reduce((m, p) => Math.max(m, p.size), list.find((p) => p.size)?.size || 11);
    lines.push({ items: cur, w, h: size * lineGap, asc: size * 0.8 });
    cur = [];
    w = 0;
  };
  for (const p of list) {
    if (p.br) {
      finish();
      continue;
    }
    if (p.space && !cur.length) continue; // no leading spaces on a wrapped line
    if (w + p.w <= width + 0.01 || !cur.length) {
      if (p.w > width && !p.space) {
        // Too long for any line: cut it where it fits.
        let rest = p.buf;
        while (rest.length) {
          let n = rest.length;
          while (n > 1 && widthOf(rest.subarray(0, n), p.font, p.size) > width - w) n--;
          const part = { ...p, buf: rest.subarray(0, n), w: widthOf(rest.subarray(0, n), p.font, p.size) };
          cur.push(part);
          w += part.w;
          rest = rest.subarray(n);
          if (rest.length) finish();
        }
        continue;
      }
      cur.push(p);
      w += p.w;
    } else {
      finish();
      if (!p.space) {
        cur.push(p);
        w += p.w;
      }
    }
  }
  if (cur.length || !lines.length) finish();
  return lines;
}
// Draws a line's pieces starting at x on the baseline y.
function drawLine(c, line, x, y, align = 'left', width = 0) {
  let at = align === 'center' ? x + (width - line.w) / 2 : align === 'right' ? x + width - line.w : x;
  for (const p of line.items) {
    if (!p.space) {
      if (p.color) c.save().color(...p.color);
      c.text(at, y, p.buf, p.font, p.size, { underline: p.underline });
      if (p.color) c.restore();
    }
    at += p.w;
  }
}
const plainText = (runs) => (runs || []).map((r) => r.text || '').join('');

// ---------- A document on pages ----------
// doc: { title, blocks, landscape }; options: page size, orientation, margin, fontSize (10–14).
// Returns { pdf: Buffer, pages: n, captions: [first words of each page] }.
export function docToPdf(doc, options = {}, meta = {}) {
  const g = pageGeometry(options, Boolean(doc.landscape));
  const base = Math.max(8, Math.min(16, Number(options.fontSize) || 11));
  const writer = new PdfWriter({ title: meta.title || doc.title || '', author: meta.author || '' });
  const left = g.margin;
  const width = g.width - 2 * g.margin;
  const bottom = g.margin;
  const top = g.height - g.margin;
  const pages = [];
  let c = null;
  let y = top;
  let images = {};
  let caption = '';
  let imageNo = 0;
  const newPage = () => {
    if (c) pages.push({ c, images, caption });
    c = new Content();
    images = {};
    caption = '';
    y = top;
  };
  const fresh = () => y === top;
  // Room for h more points on this page, or a new page.
  const need = (h) => {
    if (y - h < bottom - 0.01 && !fresh()) newPage();
  };
  const note = (t) => {
    if (!caption && t.trim()) caption = t.trim().replace(/\s+/g, ' ').slice(0, 90);
  };
  newPage();

  const paragraph = (runs, { size = base, indent = 0, align = 'left', before = 0, after = base * 0.55, bullet = null, lineGap = 1.3 } = {}) => {
    const x = left + indent;
    const w = width - indent;
    const lines = wrap(pieces(runs, size), w, lineGap);
    if (!fresh()) y -= before;
    lines.forEach((line, i) => {
      need(line.h);
      if (i === 0 && bullet) c.text(x - bullet.w - 4, y - line.asc, bullet.buf, FONTS.regular, size);
      drawLine(c, line, x, y - line.asc, align, w);
      y -= line.h;
    });
    note(plainText(runs));
    y -= after;
  };

  for (const b of doc.blocks || []) {
    if (b.type === 'pagebreak') {
      if (!fresh()) newPage();
    } else if (b.type === 'heading') {
      const size = (HEADING[b.level] || 12) * (base / 11);
      // A heading is not left alone at the bottom of a page.
      need(size * 1.3 + base * 2.6);
      paragraph((b.runs || []).map((r) => ({ ...r, bold: true, size: undefined })), { size, before: size * 0.7, after: size * 0.35 });
    } else if (b.type === 'paragraph') {
      if (!(b.runs || []).some((r) => (r.text || '').trim())) {
        if (!fresh()) y -= base * 0.8;
        continue;
      }
      paragraph(b.runs, { indent: Math.min(6, b.indent || 0) * 18, align: b.align === 'justify' ? 'left' : b.align || 'left' });
    } else if (b.type === 'list') {
      let n = Number.isInteger(b.start) ? b.start : 1;
      const counters = [];
      (b.items || []).forEach((item) => {
        const level = Math.max(0, Math.min(4, item.level || 0));
        counters.length = level + 1;
        counters[level] = (counters[level] || (level === 0 ? n - 1 : 0)) + 1;
        const label = b.ordered ? `${counters[level]}.` : level % 2 ? '–' : '•';
        const buf = encodeWinAnsi(label);
        paragraph(item.runs, { indent: 18 + level * 18, after: base * 0.25, bullet: { buf, w: widthOf(buf, FONTS.regular, base) } });
      });
      n = 1;
      y -= base * 0.3;
    } else if (b.type === 'code') {
      const size = base * 0.85;
      const lines = String(b.text || '').replace(/\t/g, '    ').split('\n');
      const charsPerLine = Math.max(10, Math.floor((width - 12) / (size * 0.6)));
      const wrapped = lines.flatMap((l) => (l.length ? l.match(new RegExp(`.{1,${charsPerLine}}`, 'g')) : ['']));
      const lh = size * 1.35;
      let i = 0;
      while (i < wrapped.length) {
        need(lh + 8);
        const fit = Math.max(1, Math.floor((y - bottom - 8) / lh));
        const chunk = wrapped.slice(i, i + fit);
        const h = chunk.length * lh + 8;
        c.save().color(0.95, 0.95, 0.96).rect(left, y - h, width, h, { fill: true, stroke: false }).restore();
        chunk.forEach((l, k) => c.text(left + 6, y - 4 - size * 0.85 - k * lh, l, FONTS.mono, size));
        note(chunk.join(' '));
        y -= h;
        i += chunk.length;
      }
      y -= base * 0.55;
    } else if (b.type === 'rule') {
      need(base);
      y -= base * 0.4;
      c.save().stroke(0.75, 0.75, 0.78).lineWidth(0.75).line(left, y, left + width, y).restore();
      y -= base * 0.6;
    } else if (b.type === 'image') {
      const size = imageSize(b.data);
      if (!size) continue;
      // Its own size in points when known; else its pixels at 96 dpi; never wider or taller than the page.
      let w = b.width || (size.width * 72) / 96;
      let h = b.height || (size.height * 72) / 96;
      const maxH = top - bottom;
      const scale = Math.min(1, width / w, maxH / h);
      w *= scale;
      h *= scale;
      need(h + 4);
      const key = `Im${++imageNo}`;
      const img = embedImage(writer, b.data);
      images[key] = img.id;
      c.image(key, left + (width - w) / 2, y - h, w, h);
      y -= h + base * 0.6;
      note(b.alt || '');
    } else if (b.type === 'table') {
      table(b);
    }
  }

  // ----- Tables -----
  function table(b) {
    const rows = (b.rows || []).filter((r) => r.cells?.length);
    if (!rows.length) return;
    const cols = Math.max(...rows.map((r) => r.cells.reduce((n, cell) => n + Math.max(1, cell.colspan || 1), 0)));
    const size = base * (cols > 8 ? 0.72 : cols > 5 ? 0.8 : 0.88);
    const pad = 3;
    // Column widths: as the document says, else from the text (each column at least its longest
    // word, the rest shared by how much text each has).
    let widths;
    if (Array.isArray(b.widths) && b.widths.length === cols && b.widths.every((x) => x > 0)) {
      const sum = b.widths.reduce((a, x) => a + x, 0);
      widths = b.widths.map((x) => (x / sum) * width);
    } else {
      const longest = Array(cols).fill(0);
      const total = Array(cols).fill(0);
      for (const r of rows) {
        let col = 0;
        for (const cell of r.cells) {
          const span = Math.max(1, cell.colspan || 1);
          if (span === 1 && col < cols) {
            const ps = pieces(cell.runs, size);
            const words = ps.filter((p) => p.buf && !p.space);
            longest[col] = Math.max(longest[col], ...words.map((p) => p.w), 12);
            total[col] = Math.max(total[col], ps.reduce((n, p) => n + (p.w || 0), 0));
          }
          col += span;
        }
      }
      const min = longest.map((x) => Math.min(x + 2 * pad, width / cols * 1.6));
      const want = total.map((x, i) => Math.max(min[i], x + 2 * pad));
      const wantSum = want.reduce((a, x) => a + x, 0);
      if (wantSum <= width) widths = want.map((x) => x * (width / wantSum));
      else {
        const minSum = min.reduce((a, x) => a + x, 0);
        if (minSum >= width) widths = min.map((x) => x * (width / minSum));
        else {
          const extra = width - minSum;
          const over = want.map((x, i) => x - min[i]);
          const overSum = over.reduce((a, x) => a + x, 0) || 1;
          widths = min.map((x, i) => x + (over[i] / overSum) * extra);
        }
      }
    }
    const lay = (r) => {
      let col = 0;
      const cells = r.cells.map((cell) => {
        const span = Math.max(1, cell.colspan || 1);
        const w = widths.slice(col, col + span).reduce((a, x) => a + x, 0);
        const x = left + widths.slice(0, col).reduce((a, v) => a + v, 0);
        col += span;
        const runs = r.header ? (cell.runs || []).map((x2) => ({ ...x2, bold: true })) : cell.runs;
        const lines = wrap(pieces(runs, size), Math.max(4, w - 2 * pad), 1.25);
        return { x, w, lines, align: cell.align || 'left', h: lines.reduce((a, l) => a + l.h, 0) + 2 * pad };
      });
      return { header: Boolean(r.header), cells, h: Math.max(size * 1.25 + 2 * pad, ...cells.map((x) => x.h)) };
    };
    const laid = rows.map(lay);
    const headers = [];
    for (const r of laid) {
      if (r.header) headers.push(r);
      else break;
    }
    const maxH = top - bottom;
    const drawRow = (r) => {
      // A row taller than a page keeps the lines that fit.
      const h = Math.min(r.h, maxH);
      if (r.header) c.save().color(0.93, 0.94, 0.96).rect(left, y - h, widths.reduce((a, x) => a + x, 0), h, { fill: true, stroke: false }).restore();
      c.save().stroke(0.72, 0.74, 0.78).lineWidth(0.5);
      for (const cell of r.cells) {
        c.rect(cell.x, y - h, cell.w, h);
        let ty = y - pad;
        for (const line of cell.lines) {
          if (ty - line.h < y - h) break;
          drawLine(c, line, cell.x + pad, ty - line.asc, cell.align, cell.w - 2 * pad);
          ty -= line.h;
        }
      }
      c.restore();
      note(r.cells.map((x) => x.lines.map((l) => l.items.map((p) => p.buf?.toString('latin1') || '').join('')).join(' ')).join(' '));
      y -= h;
    };
    if (!fresh()) y -= base * 0.3;
    laid.forEach((r, i) => {
      const isHeader = i < headers.length;
      // Keep the header rows with the first body row.
      const first = isHeader ? headers.reduce((a, x) => a + x.h, 0) + (laid[headers.length]?.h || 0) : Math.min(r.h, maxH);
      if (y - first < bottom - 0.01 && !fresh()) {
        newPage();
        if (!isHeader) headers.forEach(drawRow);
      }
      drawRow(r);
    });
    y -= base * 0.7;
  }

  newPage();
  // A document with nothing on it still makes one page.
  if (!pages.length) pages.push({ c: new Content(), images: {}, caption: '' });
  const captions = [];
  for (const p of pages.filter((x, i) => x.c.ops.length || i === 0)) {
    writer.addContentPage(p.c, [g.width, g.height], { images: p.images });
    captions.push(p.caption);
  }
  return { pdf: writer.toBuffer(), pages: captions.length, captions };
}

// ---------- A picture on a page ----------
// fit: 'fit' (whole picture, within the margins), 'fill' (the whole page, cropped), 'actual' (its own
// size at 96 dpi, centred, shrunk only if larger than the page); size 'auto': the page is the
// picture's own size (at 96 dpi) plus the margin. Orientation 'auto' follows the picture.
export function imageToPdf(data, { size = 'a4', orientation = 'auto', margin = 10, fit = 'fit' } = {}, meta = {}) {
  const writer = new PdfWriter({ title: meta.title || '', author: meta.author || '' });
  const img = embedImage(writer, data);
  const wide = img.width > img.height;
  let g;
  if (size === 'auto') {
    const m = Math.max(0, Math.min(50, Number(margin) || 0)) * (72 / 25.4);
    g = { width: (img.width * 72) / 96 + 2 * m, height: (img.height * 72) / 96 + 2 * m, margin: m };
  } else g = pageGeometry({ size, orientation, margin }, wide);
  const c = new Content();
  const boxW = g.width - 2 * g.margin;
  const boxH = g.height - 2 * g.margin;
  const iw = (img.width * 72) / 96;
  const ih = (img.height * 72) / 96;
  let w;
  let h;
  if (fit === 'fill') {
    const s = Math.max(g.width / iw, g.height / ih);
    w = iw * s;
    h = ih * s;
    c.save().raw(`0 0 ${g.width} ${g.height} re W n`);
    c.image('Im1', (g.width - w) / 2, (g.height - h) / 2, w, h).restore();
  } else {
    const s = fit === 'actual' ? Math.min(1, boxW / iw, boxH / ih) : Math.min(boxW / iw, boxH / ih);
    w = iw * s;
    h = ih * s;
    c.image('Im1', g.margin + (boxW - w) / 2, g.margin + (boxH - h) / 2, w, h);
  }
  writer.addContentPage(c, [g.width, g.height], { images: { Im1: img.id } });
  return { pdf: writer.toBuffer(), pages: 1, captions: [''], width: img.width, height: img.height };
}
