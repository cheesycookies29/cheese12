// PDF Studio (0.68): the export in other kinds of file. The PDF the export makes (with the pages
// arranged, turned and changed in the page editor) is read again, page by page
// (server/pdf/render.js), and written as:
//
//   - a document to go on working on: Word (.docx), OpenDocument text (.odt), Rich Text (.rtf), a
//     web page (.html), Markdown (.md) or plain text (.txt). The lines of each page are put back
//     together into paragraphs, headings (larger text), tables (text in columns) and pictures, in
//     reading order, one page after another with a page break between them;
//   - a spreadsheet: Excel (.xlsx) or CSV, every line a row, text that lines up in columns in
//     columns, numbers as numbers;
//   - pictures of the pages: SVG here; PNG and JPEG are drawn by the browser from the same SVG
//     (CORE has no picture renderer of its own), see public/js/views/pdf-studio.js.
//
// A PDF is a picture of pages, not a document: what comes back is the best reading of it, not the
// file it was made from. A scan without its text recognised has no text to take; it becomes a
// picture (or, in text and spreadsheets, nothing, which the export says).
import { createHash } from 'node:crypto';
import { readPdf } from './reader.js';
import { renderPage } from './render.js';
import { runScale } from './edits.js';
import { zipFiles } from '../zip.js';
import { PDF_EXPORT_FORMATS } from '../../shared/pdf-studio.js';

export const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  svg: 'image/svg+xml',
  zip: 'application/zip',
};

// ---------- Text that is safe in XML ----------
const clean = (s) => String(s ?? '')
  .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/[\uE000-\uF8FF]/g, '');
const esc = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');
const pt2 = (v) => Math.round(v * 100) / 100;

// ---------- Reading the pages ----------
// Each page: { width, height, rotate, lines, pictures, hasText, note }.
export function readPages(pdf, { pictures = true } = {}) {
  const doc = readPdf(pdf);
  const pages = [];
  for (let i = 0; i < doc.pageCount; i++) {
    const r = renderPage(doc, i, { draw: pictures, pictures, lines: false });
    pages.push(pageOf(r, pictures));
  }
  return pages;
}

function pageOf(r, withPictures) {
  const runs = (r.runs || []).filter((x) => x.text && x.text.trim() && x.height > 0).map((x) => {
    const { size, matrix } = runScale(x);
    return {
      text: x.text, x: x.x, right: x.x + x.width, bottom: x.y, top: x.y + x.height, size: size > 0.5 ? size : x.height,
      bold: Boolean(x.bold), italic: Boolean(x.italic), color: x.color, invisible: Boolean(x.invisible),
      upright: Math.abs(matrix[1]) < 0.2 && matrix[0] > 0,
    };
  });
  const lines = linesOf(runs);
  const hasText = runs.length > 0;
  const recognised = runs.some((x) => x.invisible);
  let pics = [];
  if (withPictures) {
    const area = r.width * r.height;
    pics = (r.pictures || []).filter((p) => p.width >= 12 && p.height >= 12)
      // A scan with its text recognised: the text is the page; its picture would only repeat it.
      .filter((p) => !(recognised && p.width * p.height > 0.5 * area))
      .map((p) => pictureOf(p)).filter(Boolean);
  }
  return { width: r.width, height: r.height, rotate: r.rotate || 0, lines, pictures: pics, hasText, note: r.error || null };
}

function pictureOf(p) {
  const m = String(p.url).match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  return { type: 'image', mime: `image/${m[1]}`, ext: m[1] === 'jpeg' ? 'jpg' : 'png', data, width: p.width, height: p.height, top: p.y + p.height, x: p.x, hash: createHash('sha1').update(data).digest('hex') };
}

// Runs into lines (top of the page first), and each line into cells: text far enough apart is
// another column. A cell is a list of pieces of text with their own bold and italic.
function linesOf(runs) {
  const sorted = [...runs].sort((a, b) => b.top - a.top || a.x - b.x);
  const lines = [];
  for (const r of sorted) {
    const mid = (r.top + r.bottom) / 2;
    const line = lines.find((l) => Math.abs(l.mid - mid) < 0.45 * Math.min(l.size, r.size) && l.upright === r.upright);
    if (line) {
      line.runs.push(r);
      line.size = Math.max(line.size, r.size);
      line.top = Math.max(line.top, r.top);
      line.bottom = Math.min(line.bottom, r.bottom);
    } else lines.push({ mid, size: r.size, top: r.top, bottom: r.bottom, upright: r.upright, runs: [r] });
  }
  for (const l of lines) {
    l.runs.sort((a, b) => a.x - b.x);
    l.cells = [];
    let cell = null;
    let last = null;
    for (const r of l.runs) {
      const gap = last ? r.x - last.right : 0;
      if (!cell || gap > 1.2 * Math.max(r.size, last.size)) {
        cell = { x: r.x, right: r.right, pieces: [] };
        l.cells.push(cell);
      } else if (gap > 0.12 * r.size && !/\s$/.test(cell.pieces.at(-1)?.text || '') && !/^\s/.test(r.text)) cell.pieces.at(-1).text += ' ';
      const prev = cell.pieces.at(-1);
      if (prev && prev.bold === r.bold && prev.italic === r.italic && sameColor(prev.color, r.color)) prev.text += r.text;
      else cell.pieces.push({ text: r.text, bold: r.bold, italic: r.italic, color: r.color, size: r.size });
      cell.right = Math.max(cell.right, r.right);
      last = r;
    }
    // No spaces at the edges of a cell.
    for (const c of l.cells) {
      c.pieces[0].text = c.pieces[0].text.trimStart();
      c.pieces.at(-1).text = c.pieces.at(-1).text.trimEnd();
      c.pieces = c.pieces.filter((p) => p.text);
    }
    l.cells = l.cells.filter((c) => c.pieces.length);
    l.x = l.cells[0].x;
    l.right = Math.max(...l.cells.map((c) => c.right));
    l.text = l.cells.map(cellText).join(' ');
    l.bold = l.runs.every((r) => r.bold);
  }
  lines.sort((a, b) => b.top - a.top || a.x - b.x);
  return lines;
}
const sameColor = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
const cellText = (c) => c.pieces.map((p) => p.text).join('');

// The size of most of the text, all pages together: what "body text" is.
function bodySize(pages) {
  const count = new Map();
  for (const p of pages) for (const l of p.lines) for (const r of l.runs) {
    const k = Math.round(r.size * 2) / 2;
    count.set(k, (count.get(k) || 0) + r.text.length);
  }
  let best = 11;
  let most = -1;
  for (const [k, n] of count) if (n > most) [best, most] = [k, n];
  return best || 11;
}

// ---------- Lines into blocks: headings, paragraphs, tables and pictures ----------
const BULLET = /^([•◦▪▫‣⁃●○■□–—*-]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|[ivxIVX]{1,4}[.)])\s/;
export function blocksOf(page, body) {
  const blocks = [];
  const lines = page.lines;
  const usedAsTable = new Set();
  // Tables: two lines or more in a row, each with two cells or more, that line up.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].cells.length < 2 || !lines[i].upright) continue;
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].cells.length >= 2 && lines[j + 1].upright && lines[j].bottom - lines[j + 1].top < 2.5 * Math.max(lines[j].size, lines[j + 1].size)) j++;
    if (j > i) {
      const rows = lines.slice(i, j + 1);
      const table = tableOf(rows);
      if (table) {
        rows.forEach((l) => usedAsTable.add(l));
        blocks.push({ type: 'table', top: rows[0].top, rows: table });
      }
      i = j;
    }
  }
  let para = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (usedAsTable.has(l)) {
      para = null;
      continue;
    }
    const ratio = l.size / body;
    const heading = ratio >= 1.25 && l.text.length < 200 ? (ratio >= 1.8 ? 1 : ratio >= 1.4 ? 2 : 3) : 0;
    const pieces = l.cells.flatMap((c, k) => (k ? [{ text: '\t' }, ...c.pieces] : c.pieces));
    const prev = para?.last;
    const joins = para && !heading === !para.level && (!heading || para.level === heading)
      && Math.abs(l.size - prev.size) < 0.15 * prev.size
      && prev.bottom - l.top < 0.75 * l.size
      && !BULLET.test(l.text)
      && Math.abs(l.x - prev.x) < 2.5 * l.size
      && !(prev.right < para.right - 4 * l.size && /[.!?:;]$/.test(prev.text));
    if (joins) {
      const tail = para.runs.at(-1);
      if (/[a-z]-$/i.test(tail.text) && /^[a-z]/.test(pieces[0].text)) tail.text = tail.text.slice(0, -1);
      else tail.text += ' ';
      for (const p of pieces) para.runs.push({ ...p });
      para.last = l;
      para.right = Math.max(para.right, l.right);
      para.lines++;
    } else {
      para = { type: heading ? 'heading' : 'paragraph', level: heading || undefined, top: l.top, runs: pieces.map((p) => ({ ...p })), last: l, right: l.right, size: l.size, x: l.x, lines: 1 };
      const center = (l.x + l.right) / 2;
      if (Math.abs(center - page.width / 2) < 0.04 * page.width && l.x > 0.2 * page.width) para.align = 'center';
      blocks.push(para);
    }
  }
  for (const p of page.pictures) blocks.push(p);
  blocks.sort((a, b) => b.top - a.top);
  for (const b of blocks) {
    if (b.runs) {
      b.runs = merge(b.runs);
      // A heading's style gives its size and weight.
      if (b.type === 'heading') b.runs.forEach((r) => { r.bold = false; r.size = 0; });
      delete b.last;
    }
  }
  return blocks.filter((b) => b.type !== 'paragraph' || b.runs.some((r) => r.text.trim()));
}
// Neighbouring pieces with the same look, as one.
function merge(runs) {
  const out = [];
  for (const r of runs) {
    const p = out.at(-1);
    if (p && p.bold === r.bold && p.italic === r.italic && sameColor(p.color, r.color)) p.text += r.text;
    else out.push({ text: r.text, bold: Boolean(r.bold), italic: Boolean(r.italic), color: r.color, size: r.size });
  }
  return out;
}

// Rows of cells into a grid: each cell under the column whose left edge it is nearest.
function tableOf(rows) {
  const tol = Math.max(6, ...rows.map((l) => l.size));
  const starts = [];
  for (const l of rows) for (const c of l.cells) {
    const s = starts.find((x) => Math.abs(x.at - c.x) < tol || (c.x < x.right && c.right > x.at && Math.abs(x.at - c.x) < 3 * tol));
    if (s) {
      s.at = Math.min(s.at, c.x);
      s.right = Math.max(s.right, c.right);
    } else starts.push({ at: c.x, right: c.right });
  }
  starts.sort((a, b) => a.at - b.at);
  if (starts.length < 2 || starts.length > 30) return null;
  const grid = rows.map((l) => {
    const row = starts.map(() => []);
    for (const c of l.cells) {
      let k = 0;
      for (let i = 0; i < starts.length; i++) if (starts[i].at <= c.x + tol / 2) k = i;
      row[k].push(...c.pieces);
    }
    return row.map((pieces) => merge(pieces.map((p, i) => (i && !/\s$/.test(pieces[i - 1].text) ? { ...p, text: ` ${p.text}` } : p))));
  });
  return grid;
}

// Every line as a row, its cells in columns that line up across the page (for spreadsheets).
function sheetRows(page) {
  const all = page.lines.flatMap((l) => l.cells.map((c) => ({ x: c.x, size: l.size })));
  const tol = Math.max(8, ...all.map((c) => c.size * 1.5));
  const starts = [];
  for (const c of [...all].sort((a, b) => a.x - b.x)) {
    if (!starts.length || c.x - starts.at(-1) > tol) starts.push(c.x);
  }
  return page.lines.map((l) => {
    const row = [];
    for (const c of l.cells) {
      let k = 0;
      for (let i = 0; i < starts.length; i++) if (starts[i] <= c.x + tol / 2) k = i;
      while (row[k] !== undefined && k < 200) k++;
      row[k] = cellText(c).trim();
    }
    return Array.from({ length: row.length }, (_, i) => row[i] ?? '');
  });
}
// A number written as people write them in reports: 1,234.50 · (1,234.50) · -12 · 15% · ₱ 1,200.
export function numberOf(s) {
  const t = String(s).trim();
  const m = t.match(/^(\(?)\s*([-+]?)\s*(?:[₱$€£¥]|PHP|USD)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(\.[0-9]+)?\s*(%?)\s*(\)?)$/);
  if (!m || (m[1] && !m[6]) || (!m[1] && m[6])) return null;
  if (/^0[0-9]/.test(m[3]) && !m[4]) return null; // 0012: a code, not a number
  if (m[3].replace(/,/g, '').length > 15) return null; // an account or reference number
  let v = Number(`${m[3].replace(/,/g, '')}${m[4] || ''}`);
  if (!Number.isFinite(v)) return null;
  if (m[2] === '-' || m[1]) v = -v;
  if (m[5]) v /= 100;
  return { value: v, percent: Boolean(m[5]) };
}

// ---------- The document: pages of blocks ----------
function documentOf(pages) {
  const body = bodySize(pages);
  return { body, pages: pages.map((p) => ({ width: p.width, height: p.height, blocks: blocksOf(p, body) })) };
}

// ---------- Word (.docx) ----------
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const hexColor = (c) => (Array.isArray(c) && c.length === 3 ? c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase() : null);
const isDark = (h) => !h || h === '000000';
// A picture's size on the page, made to fit between the margins.
const fit = (b, maxW, maxH) => {
  const k = Math.min(1, maxW / b.width, maxH / b.height);
  return { w: b.width * k, h: b.height * k };
};
function coreXml(meta) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title || '')}</dc:title><dc:creator>${esc(meta.author || '')}</dc:creator><dc:description>Made by CORE PDF Studio</dc:description><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

export function toDocx(d, meta = {}) {
  const first = d.pages[0] || { width: 595, height: 842 };
  const margin = 72;
  const maxW = Math.max(72, first.width - 2 * margin);
  const maxH = Math.max(72, first.height - 2 * margin);
  const media = new Map();
  let drawings = 0;
  const run = (r) => {
    const props = [];
    if (r.bold) props.push('<w:b/>');
    if (r.italic) props.push('<w:i/>');
    const c = hexColor(r.color);
    if (!isDark(c)) props.push(`<w:color w:val="${c}"/>`);
    if (r.size && Math.abs(r.size - d.body) >= 0.75) props.push(`<w:sz w:val="${Math.round(Math.min(144, Math.max(4, r.size)) * 2)}"/>`);
    return String(r.text).split('\t').map((t, i) => `${i ? '<w:r><w:tab/></w:r>' : ''}${t ? `<w:r>${props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>` : ''}`).join('');
  };
  const para = (b, pageBreak) => {
    const ppr = [];
    if (b.type === 'heading') ppr.push(`<w:pStyle w:val="Heading${b.level}"/>`);
    if (pageBreak) ppr.push('<w:pageBreakBefore/>');
    if (b.align === 'center') ppr.push('<w:jc w:val="center"/>');
    return `<w:p>${ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''}${b.runs.map(run).join('')}</w:p>`;
  };
  const picture = (b, pageBreak) => {
    if (!media.has(b.hash)) media.set(b.hash, { id: `rIdImg${media.size + 1}`, name: `media/image${media.size + 1}.${b.ext}`, data: b.data, ext: b.ext });
    const m = media.get(b.hash);
    const { w, h } = fit(b, maxW, maxH);
    const cx = Math.round(w * 12700);
    const cy = Math.round(h * 12700);
    const n = ++drawings;
    return `<w:p>${pageBreak ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : ''}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="Picture ${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${m.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  };
  const table = (b, pageBreak) => {
    const cols = Math.max(...b.rows.map((r) => r.length));
    const width = Math.round((maxW * 20) / cols);
    const rows = b.rows.map((r, i) => `<w:tr>${i === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${Array.from({ length: cols }, (_, k) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p>${(r[k] || []).map(run).join('')}</w:p></w:tc>`).join('')}</w:tr>`).join('');
    return `${pageBreak ? '<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>' : ''}<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
  };
  const body = [];
  d.pages.forEach((p, i) => {
    const pageBreak = i > 0;
    if (!p.blocks.length) {
      body.push(`<w:p>${pageBreak ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : ''}</w:p>`);
      return;
    }
    p.blocks.forEach((b, k) => {
      const brk = pageBreak && k === 0;
      body.push(b.type === 'image' ? picture(b, brk) : b.type === 'table' ? table(b, brk) : para(b, brk));
    });
  });
  const landscape = first.width > first.height;
  const sect = `<w:sectPr><w:pgSz w:w="${Math.round(first.width * 20)}" w:h="${Math.round(first.height * 20)}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${margin * 20}" w:right="${margin * 20}" w:bottom="${margin * 20}" w:left="${margin * 20}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const document = `${XML}<w:document ${W_NS}><w:body>${body.join('')}${sect}</w:body></w:document>`;
  const half = Math.round(d.body * 2);
  const heading = (n, size) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles = `${XML}<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/><w:lang w:val="en-PH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, Math.round(d.body * 4))}${heading(2, Math.round(d.body * 3))}${heading(3, Math.round(d.body * 2.5))}<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:left w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:right w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/></w:tblBorders></w:tblPr></w:style></w:styles>`;
  const exts = new Set([...media.values()].map((m) => m.ext));
  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.has('png') ? '<Default Extension="png" ContentType="image/png"/>' : ''}${exts.has('jpg') ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const docRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${[...media.values()].map((m) => `<Relationship Id="${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.name}"/>`).join('')}</Relationships>`;
  const x = (name, s) => ({ name, type: 'application/xml', buffer: Buffer.from(s, 'utf8') });
  return zipFiles([
    x('[Content_Types].xml', types), x('_rels/.rels', rels), x('docProps/core.xml', coreXml(meta)),
    x('word/document.xml', document), x('word/styles.xml', styles), x('word/_rels/document.xml.rels', docRels),
    ...[...media.values()].map((m) => ({ name: `word/${m.name}`, type: `image/${m.ext}`, buffer: m.data })),
  ], { paths: true });
}

// ---------- OpenDocument text (.odt) ----------
export function toOdt(d, meta = {}) {
  const first = d.pages[0] || { width: 595, height: 842 };
  const maxW = Math.max(72, first.width - 144);
  const maxH = Math.max(72, first.height - 144);
  const media = new Map();
  const autos = new Map(); // text looks → automatic style name
  const tstyle = (r) => {
    const c = hexColor(r.color);
    const size = r.size && Math.abs(r.size - d.body) >= 0.75 ? pt2(Math.min(144, Math.max(4, r.size))) : null;
    const key = `${r.bold ? 'b' : ''}${r.italic ? 'i' : ''}${isDark(c) ? '' : c}${size ? `s${size}` : ''}`;
    if (!key) return null;
    if (!autos.has(key)) autos.set(key, { name: `T${autos.size + 1}`, xml: `${r.bold ? ' fo:font-weight="bold"' : ''}${r.italic ? ' fo:font-style="italic"' : ''}${isDark(c) ? '' : ` fo:color="#${c}"`}${size ? ` fo:font-size="${size}pt"` : ''}` });
    return autos.get(key).name;
  };
  const span = (r) => String(r.text).split('\t').map((t, i) => {
    const s = tstyle(r);
    const body = esc(t).replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`);
    return `${i ? '<text:tab/>' : ''}${t ? (s ? `<text:span text:style-name="${s}">${body}</text:span>` : body) : ''}`;
  }).join('');
  let pics = 0;
  let tables = 0;
  const pstyle = (b, brk) => (brk ? (b.align === 'center' ? 'PBreakCenter' : 'PBreak') : b.align === 'center' ? 'PCenter' : 'Standard');
  const out = [];
  d.pages.forEach((p, i) => {
    if (!p.blocks.length) {
      out.push(`<text:p text:style-name="${i ? 'PBreak' : 'Standard'}"/>`);
      return;
    }
    p.blocks.forEach((b, k) => {
      const brk = i > 0 && k === 0;
      if (b.type === 'heading') out.push(`<text:h text:style-name="${brk ? `H${b.level}Break` : `Heading_20_${b.level}`}" text:outline-level="${b.level}">${b.runs.map(span).join('')}</text:h>`);
      else if (b.type === 'paragraph') out.push(`<text:p text:style-name="${pstyle(b, brk)}">${b.runs.map(span).join('')}</text:p>`);
      else if (b.type === 'image') {
        if (!media.has(b.hash)) media.set(b.hash, { name: `Pictures/image${media.size + 1}.${b.ext}`, data: b.data, mime: b.mime });
        const m = media.get(b.hash);
        const { w, h } = fit(b, maxW, maxH);
        pics++;
        out.push(`<text:p text:style-name="${brk ? 'PBreak' : 'Standard'}"><draw:frame draw:name="Picture ${pics}" text:anchor-type="as-char" svg:width="${pt2(w)}pt" svg:height="${pt2(h)}pt" draw:z-index="0"><draw:image xlink:href="${m.name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`);
      } else if (b.type === 'table') {
        const cols = Math.max(...b.rows.map((r) => r.length));
        tables++;
        if (brk) out.push('<text:p text:style-name="PBreak"/>');
        out.push(`<table:table table:name="Table${tables}" table:style-name="Tbl"><table:table-column table:number-columns-repeated="${cols}"/>${b.rows.map((r) => `<table:table-row>${Array.from({ length: cols }, (_, c) => `<table:table-cell table:style-name="Cell" office:value-type="string"><text:p text:style-name="Standard">${(r[c] || []).map(span).join('')}</text:p></table:table-cell>`).join('')}</table:table-row>`).join('')}</table:table>`);
      }
    });
  });
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
  const heads = [1, 2, 3].map((n) => `<style:style style:name="H${n}Break" style:family="paragraph" style:parent-style-name="Heading_20_${n}"><style:paragraph-properties fo:break-before="page"/></style:style>`).join('');
  const content = `${XML}<office:document-content ${NS} office:version="1.3"><office:automatic-styles><style:style style:name="PBreak" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style><style:style style:name="PCenter" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/></style:style><style:style style:name="PBreakCenter" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page" fo:text-align="center"/></style:style>${heads}<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="${pt2(maxW)}pt" table:align="left"/></style:style><style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="2pt" fo:border="0.5pt solid #a6a6a6"/></style:style>${[...autos.values()].map((a) => `<style:style style:name="${a.name}" style:family="text"><style:text-properties${a.xml}/></style:style>`).join('')}</office:automatic-styles><office:body><office:text>${out.join('')}</office:text></office:body></office:document-content>`;
  const heading = (n, size) => `<style:style style:name="Heading_20_${n}" style:display-name="Heading ${n}" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:default-outline-level="${n}" style:class="text"><style:paragraph-properties fo:margin-top="12pt" fo:margin-bottom="6pt" fo:keep-with-next="always"/><style:text-properties fo:font-size="${size}pt" fo:font-weight="bold"/></style:style>`;
  const styles = `${XML}<office:document-styles ${NS} office:version="1.3"><office:styles><style:default-style style:family="paragraph"><style:text-properties style:font-name="Liberation Sans" fo:font-family="Carlito, Calibri, 'Liberation Sans', sans-serif" fo:font-size="${pt2(d.body)}pt" fo:language="en" fo:country="PH"/></style:default-style><style:style style:name="Standard" style:family="paragraph" style:class="text"><style:paragraph-properties fo:margin-bottom="6pt"/></style:style>${heading(1, pt2(d.body * 2))}${heading(2, pt2(d.body * 1.5))}${heading(3, pt2(d.body * 1.25))}</office:styles><office:automatic-styles><style:page-layout style:name="PL"><style:page-layout-properties fo:page-width="${pt2(first.width)}pt" fo:page-height="${pt2(first.height)}pt" style:print-orientation="${first.width > first.height ? 'landscape' : 'portrait'}" fo:margin-top="72pt" fo:margin-bottom="72pt" fo:margin-left="72pt" fo:margin-right="72pt"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="PL"/></office:master-styles></office:document-styles>`;
  const metaXml = `${XML}<office:document-meta ${NS} office:version="1.3"><office:meta><dc:title>${esc(meta.title || '')}</dc:title><meta:initial-creator>${esc(meta.author || '')}</meta:initial-creator><meta:generator>CORE PDF Studio</meta:generator><meta:creation-date>${new Date().toISOString().replace(/\.\d+Z$/, '')}</meta:creation-date></office:meta></office:document-meta>`;
  const manifest = `${XML}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${MIME.odt}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${[...media.values()].map((m) => `<manifest:file-entry manifest:full-path="${m.name}" manifest:media-type="${m.mime}"/>`).join('')}</manifest:manifest>`;
  const x = (name, s) => ({ name, type: 'text/xml', buffer: Buffer.from(s, 'utf8') });
  return zipFiles([
    { name: 'mimetype', type: MIME.odt, store: true, buffer: Buffer.from(MIME.odt, 'ascii') },
    x('content.xml', content), x('styles.xml', styles), x('meta.xml', metaXml), x('META-INF/manifest.xml', manifest),
    ...[...media.values()].map((m) => ({ name: m.name, type: m.mime, buffer: m.data })),
  ], { paths: true });
}

// ---------- Rich Text (.rtf) ----------
const rtfText = (s) => clean(s).replace(/[\\{}]/g, (c) => `\\${c}`).replace(/\t/g, '\\tab ').replace(/[^\x20-\x7e]/gu, (ch) => {
  let out = '';
  for (const unit of ch.split('')) {
    const code = unit.charCodeAt(0);
    out += `\\u${code > 32767 ? code - 65536 : code}?`;
  }
  return out;
});
export function toRtf(d, meta = {}) {
  const first = d.pages[0] || { width: 595, height: 842 };
  const maxW = Math.max(72, first.width - 144);
  const maxH = Math.max(72, first.height - 144);
  const colors = ['000000'];
  const colorOf = (r) => {
    const c = hexColor(r.color);
    if (isDark(c)) return 0;
    if (!colors.includes(c)) colors.push(c);
    return colors.indexOf(c);
  };
  const half = Math.round(d.body * 2);
  const run = (r) => {
    const c = colorOf(r);
    const size = r.size && Math.abs(r.size - d.body) >= 0.75 ? Math.round(Math.min(144, Math.max(4, r.size)) * 2) : 0;
    const t = rtfText(r.text);
    if (!r.bold && !r.italic && !c && !size) return t;
    return `{${r.bold ? '\\b' : ''}${r.italic ? '\\i' : ''}${c ? `\\cf${c + 1}` : ''}${size ? `\\fs${size}` : ''} ${t}}`;
  };
  const out = [];
  const HEAD = { 1: 2, 2: 1.5, 3: 1.25 };
  d.pages.forEach((p, i) => {
    if (i > 0) out.push('\\page\n');
    for (const b of p.blocks) {
      if (b.type === 'heading') out.push(`\\pard\\plain\\s${b.level}\\keepn\\sb240\\sa120\\outlinelevel${b.level - 1}\\b\\fs${Math.round(d.body * 2 * HEAD[b.level])} ${b.runs.map((r) => run({ ...r, size: 0 })).join('')}\\par\n`);
      else if (b.type === 'paragraph') out.push(`\\pard\\plain\\sa120${b.align === 'center' ? '\\qc' : ''}\\fs${half} ${b.runs.map(run).join('')}\\par\n`);
      else if (b.type === 'image') {
        const { w, h } = fit(b, maxW, maxH);
        out.push(`\\pard\\plain{\\pict\\${b.ext === 'png' ? 'pngblip' : 'jpegblip'}\\picw${Math.round(b.width)}\\pich${Math.round(b.height)}\\picwgoal${Math.round(w * 20)}\\pichgoal${Math.round(h * 20)}\n${b.data.toString('hex').replace(/(.{128})/g, '$1\n')}}\\par\n`);
      } else if (b.type === 'table') {
        const cols = Math.max(...b.rows.map((r) => r.length));
        const cw = Math.round((maxW * 20) / cols);
        const border = '\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10';
        for (const r of b.rows) {
          out.push(`\\trowd\\trgaph108${Array.from({ length: cols }, (_, k) => `${border}\\cellx${cw * (k + 1)}`).join('')}\n`);
          out.push(`${Array.from({ length: cols }, (_, k) => `\\pard\\plain\\intbl\\fs${half} ${(r[k] || []).map(run).join('')}\\cell`).join(' ')}\\row\n`);
        }
        out.push('\\pard\\plain\\par\n');
      }
    }
  });
  const info = `{\\info{\\title ${rtfText(meta.title || '')}}{\\author ${rtfText(meta.author || '')}}{\\doccomm Made by CORE PDF Studio}}`;
  const head = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl{\\f0\\fswiss Calibri;}}{\\colortbl;${colors.map((c) => `\\red${parseInt(c.slice(0, 2), 16)}\\green${parseInt(c.slice(2, 4), 16)}\\blue${parseInt(c.slice(4), 16)};`).join('')}}${info}\\paperw${Math.round(first.width * 20)}\\paperh${Math.round(first.height * 20)}${first.width > first.height ? '\\landscape' : ''}\\margl1440\\margr1440\\margt1440\\margb1440\\f0\\fs${half}\n`;
  // \colortbl starts with an empty entry (automatic), so colours[n] is \cf(n + 1).
  return Buffer.from(`${head}${out.join('')}}`, 'latin1');
}

// ---------- Web page (.html) ----------
export function toHtml(d, meta = {}) {
  const run = (r) => {
    let t = esc(r.text).replace(/\t/g, ' &emsp; ');
    const c = hexColor(r.color);
    if (!isDark(c)) t = `<span style="color:#${c}">${t}</span>`;
    if (r.italic) t = `<em>${t}</em>`;
    if (r.bold) t = `<strong>${t}</strong>`;
    return t;
  };
  const pages = d.pages.map((p, i) => {
    const body = p.blocks.map((b) => {
      if (b.type === 'heading') return `<h${b.level}>${b.runs.map(run).join('')}</h${b.level}>`;
      if (b.type === 'paragraph') return `<p${b.align === 'center' ? ' class="c"' : ''}>${b.runs.map(run).join('')}</p>`;
      if (b.type === 'image') return `<p class="pic"><img src="data:${b.mime};base64,${b.data.toString('base64')}" width="${Math.round(b.width)}" height="${Math.round(b.height)}" alt="Picture"></p>`;
      if (b.type === 'table') {
        const cols = Math.max(...b.rows.map((r) => r.length));
        return `<table>${b.rows.map((r) => `<tr>${Array.from({ length: cols }, (_, k) => `<td>${(r[k] || []).map(run).join('')}</td>`).join('')}</tr>`).join('')}</table>`;
      }
      return '';
    }).join('\n');
    return `<section class="page" aria-label="Page ${i + 1}">\n${body}\n</section>`;
  });
  const title = esc(meta.title || 'Document');
  return Buffer.from(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="CORE PDF Studio">${meta.author ? `\n<meta name="author" content="${attr(meta.author)}">` : ''}
<title>${title}</title>
<style>
body { font: ${pt2(d.body)}pt/1.45 Calibri, Carlito, "Segoe UI", system-ui, sans-serif; color: #1a1a1a; background: #fff; margin: 0; padding: 24px 16px; }
.page { max-width: 46em; margin: 0 auto; }
.page + .page { border-top: 1px dashed #bbb; margin-top: 2.5em; padding-top: 2em; }
h1, h2, h3 { line-height: 1.25; margin: 1em 0 .4em; }
p { margin: 0 0 .7em; white-space: pre-wrap; }
p.c { text-align: center; }
.pic img { max-width: 100%; height: auto; }
table { border-collapse: collapse; margin: 0 0 1em; max-width: 100%; display: block; overflow-x: auto; }
td { border: 1px solid #bbb; padding: 3px 8px; vertical-align: top; }
@media print { .page + .page { border: 0; break-before: page; margin: 0; padding: 0; } body { padding: 0; } }
</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>
`, 'utf8');
}

// ---------- Markdown (.md) and text (.txt) ----------
const mdEsc = (s) => clean(s).replace(/([\\`*_[\]<>|])/g, '\\$1').replace(/^(\s*)([#+-]|\d+\.)(\s)/, '$1\\$2$3');
// Markdown with its pictures beside it: { text, pictures: [{ name, buffer, type }] }.
export function toMarkdown(d) {
  const pictures = new Map();
  const run = (r) => {
    const t = mdEsc(r.text).replace(/\t/g, ' ');
    if (!t.trim()) return t;
    const lead = t.match(/^\s*/)[0];
    const trail = t.match(/\s*$/)[0];
    const core = t.trim();
    const mark = r.bold && r.italic ? '***' : r.bold ? '**' : r.italic ? '*' : '';
    return `${lead}${mark}${core}${mark}${trail}`;
  };
  const line = (runs) => runs.map(run).join('').replace(/\*\*\*\*|\*\*(\s*)\*\*/g, '$1').trim();
  const parts = d.pages.map((p) => p.blocks.map((b) => {
    if (b.type === 'heading') return `${'#'.repeat(b.level)} ${line(b.runs)}`;
    if (b.type === 'paragraph') return line(b.runs);
    if (b.type === 'image') {
      if (!pictures.has(b.hash)) pictures.set(b.hash, { name: `pictures/picture-${pictures.size + 1}.${b.ext}`, buffer: b.data, type: b.mime });
      return `![Picture](${pictures.get(b.hash).name})`;
    }
    if (b.type === 'table') {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const cell = (r, k) => line(r[k] || []).replace(/\n/g, ' ') || ' ';
      const rows = b.rows.map((r) => `| ${Array.from({ length: cols }, (_, k) => cell(r, k)).join(' | ')} |`);
      rows.splice(1, 0, `|${' --- |'.repeat(cols)}`);
      return rows.join('\n');
    }
    return '';
  }).filter(Boolean).join('\n\n'));
  return { text: `${parts.join('\n\n---\n\n')}\n`, pictures: [...pictures.values()] };
}
export function toText(d) {
  const line = (runs) => runs.map((r) => clean(r.text)).join('').trim();
  const parts = d.pages.map((p) => p.blocks.map((b) => {
    if (b.type === 'heading' || b.type === 'paragraph') return line(b.runs);
    if (b.type === 'table') return b.rows.map((r) => r.map((c) => line(c)).join('\t')).join('\n');
    return '';
  }).filter(Boolean).join('\n\n'));
  // Pages apart with a form feed, which printers and many editors take as a new page.
  return Buffer.from(`${parts.join('\n\n\f')}\n`, 'utf8');
}

// ---------- Spreadsheets: Excel (.xlsx) and CSV ----------
const colName = (n) => {
  let s = '';
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
};
export function toXlsx(pages, meta = {}) {
  // A sheet for each page (up to 60), else one sheet with every page under the one before.
  const perPage = pages.length <= 60;
  const sheets = perPage
    ? pages.map((p, i) => ({ name: `Page ${i + 1}`, rows: sheetRows(p) }))
    : [{ name: 'Pages', rows: pages.flatMap((p, i) => [...(i ? [[]] : []), ...sheetRows(p)]) }];
  const sheetXml = (s) => {
    const widths = [];
    const rows = s.rows.slice(0, 1048576).map((r, i) => {
      const cells = r.map((v, k) => {
        if (v === '') return '';
        widths[k] = Math.max(widths[k] || 8, Math.min(60, String(v).length + 2));
        const ref = `${colName(k)}${i + 1}`;
        const n = numberOf(v);
        if (n) return `<c r="${ref}"${n.percent ? ' s="1"' : /,|\.\d\d$/.test(v) ? ' s="2"' : ''}><v>${n.value}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v).slice(0, 32767))}</t></is></c>`;
      }).join('');
      return `<row r="${i + 1}">${cells}</row>`;
    }).join('');
    const cols = widths.length ? `<cols>${widths.map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w || 8}" customWidth="1"/>`).join('')}</cols>` : '';
    return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${cols}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const workbook = `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${attr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const wbRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const x = (name, s) => ({ name, type: 'application/xml', buffer: Buffer.from(s, 'utf8') });
  return zipFiles([
    x('[Content_Types].xml', types), x('_rels/.rels', rels), x('docProps/core.xml', coreXml(meta)), x('xl/workbook.xml', workbook),
    x('xl/_rels/workbook.xml.rels', wbRels), x('xl/styles.xml', styles), ...sheets.map((s, i) => x(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s))),
  ], { paths: true });
}
export function toCsv(pages) {
  const q = (v) => {
    const s = clean(v);
    // A cell a spreadsheet would run as a formula starts with a quote mark instead.
    const safe = /^[=+\-@\t\r]/.test(s) && !numberOf(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = pages.flatMap((p, i) => [...(i ? [[]] : []), ...sheetRows(p)]);
  return Buffer.from(`\uFEFF${rows.map((r) => r.map(q).join(',')).join('\r\n')}\r\n`, 'utf8');
}

// ---------- Pictures of the pages (SVG; the browser makes PNG and JPEG from them) ----------
// The page turned as it is shown (its /Rotate), as SVG.
export function pageSvgs(pdf) {
  const doc = readPdf(pdf);
  const out = [];
  for (let i = 0; i < doc.pageCount; i++) {
    const r = renderPage(doc, i);
    const rot = (((r.rotate || 0) % 360) + 360) % 360;
    let svg = r.svg;
    let { width, height } = r;
    if (rot) {
      const w = width;
      const h = height;
      const turned = rot === 180 ? { W: w, H: h, t: `translate(${w} ${h}) rotate(180)` } : rot === 90 ? { W: h, H: w, t: `translate(${h} 0) rotate(90)` } : { W: h, H: w, t: `translate(0 ${w}) rotate(270)` };
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pt2(turned.W)} ${pt2(turned.H)}" width="${pt2(turned.W)}" height="${pt2(turned.H)}"><g transform="${turned.t}">${r.svg}</g></svg>`;
      width = turned.W;
      height = turned.H;
    }
    out.push({ svg, width, height, note: r.error || null });
  }
  return out;
}

// ---------- One file in the asked format, from the PDF the export made ----------
// → { files: [{ name, buffer, type }], notes: [] } (more than one file goes in a ZIP).
export function convertPdf(pdf, as, base, meta = {}) {
  const f = PDF_EXPORT_FORMATS[as];
  if (!f || as === 'pdf' || f.browser) throw new Error(`CORE cannot make ${as} files here.`);
  if (as === 'svg') {
    const pages = pageSvgs(pdf);
    const pad = String(pages.length).length;
    return {
      files: pages.map((p, i) => ({ name: pages.length === 1 ? `${base}.svg` : `${base} - page ${String(i + 1).padStart(pad, '0')}.svg`, type: MIME.svg, buffer: Buffer.from(p.svg, 'utf8') })),
      notes: [],
    };
  }
  const pictures = ['docx', 'odt', 'rtf', 'html', 'md'].includes(as);
  const pages = readPages(pdf, { pictures });
  const empty = pages.filter((p) => !p.hasText).length;
  const notes = [];
  if (empty && pages.length) {
    const what = pictures ? `${empty === 1 ? 'is' : 'are'} in the file as ${empty === 1 ? 'a picture' : 'pictures'}` : `${empty === 1 ? 'is' : 'are'} left empty`;
    notes.push(`${empty === pages.length ? (pages.length === 1 ? 'The page has' : 'The pages have') : `${empty} of ${pages.length} pages have`} no text to take (a scan, or text drawn as shapes): ${empty === pages.length && pages.length === 1 ? 'it' : 'they'} ${what}.`);
  }
  if (as === 'xlsx') return { files: [{ name: `${base}.xlsx`, type: MIME.xlsx, buffer: toXlsx(pages, meta) }], notes };
  if (as === 'csv') return { files: [{ name: `${base}.csv`, type: MIME.csv, buffer: toCsv(pages) }], notes };
  const d = documentOf(pages);
  if (as === 'docx') return { files: [{ name: `${base}.docx`, type: MIME.docx, buffer: toDocx(d, meta) }], notes };
  if (as === 'odt') return { files: [{ name: `${base}.odt`, type: MIME.odt, buffer: toOdt(d, meta) }], notes };
  if (as === 'rtf') return { files: [{ name: `${base}.rtf`, type: MIME.rtf, buffer: toRtf(d, meta) }], notes };
  if (as === 'html') return { files: [{ name: `${base}.html`, type: 'text/html', buffer: toHtml(d, meta) }], notes };
  if (as === 'txt') return { files: [{ name: `${base}.txt`, type: 'text/plain', buffer: toText(d) }], notes };
  // Markdown: its pictures beside it, in a ZIP, when there are any.
  const md = toMarkdown(d);
  return { files: [{ name: `${base}.md`, type: 'text/markdown', buffer: Buffer.from(md.text, 'utf8') }, ...md.pictures.map((p) => ({ name: p.name, type: p.type, buffer: p.buffer }))], notes, paths: md.pictures.length > 0 };
}
