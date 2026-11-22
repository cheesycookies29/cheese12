// PDF Studio (0.64): Word (.docx), Excel (.xlsx) and PowerPoint (.pptx) files to the block model of
// server/pdf/layout.js. Each reads the parts it needs from the package (readZip) and adds blocks to
// an Out collector (server/pdf/office-core.js). What a PDF cannot show (headers and footers,
// comments, charts, speaker notes, field codes) is left out; text that was deleted with "track
// changes" on stays deleted and inserted text is kept.
import {
  MAX_ROWS, ReadError, at, dropPrefixes, emuToPt, fail, find, findAll, hexColor, isMonoFont, isOn, kid, kids,
  makeRun, mainPart, propsTitle, readRels, relOfType, safeLink, sheetTable, textOf, xmlPart, blockHasContent,
} from './office-core.js';

const dirOf = (part) => part.slice(0, part.lastIndexOf('/') + 1);

// A picture from the package (a path from the relationships), when it is JPEG or PNG.
function picture(zip, out, path, info) {
  if (!path || !zip.has(path)) {
    out.warn('A picture this file refers to is missing from it and was left out.');
    return null;
  }
  try {
    return out.image(zip.read(path), info);
  } catch (err) {
    if (!(err instanceof ReadError)) throw err;
    out.warn(`A picture could not be read and was left out. ${err.message}`);
    return null;
  }
}
// mc:AlternateContent holds the same thing twice, for new and old programs: the first choice is used.
const alternative = (el) => kid(el, 'mc:Choice') || kid(el, 'mc:Fallback') || { children: [] };

// =============================================================================================
// Word

const ALIGN = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify', justify: 'justify' };

// Run formatting from a w:rPr, on top of what the run inherits (f).
function wordRunFormat(rPr, ctx, f) {
  if (!rPr) return f;
  const g = { ...f };
  const charStyle = kid(rPr, 'w:rStyle');
  if (charStyle) Object.assign(g, ctx.style(charStyle.attrs['w:val'])?.rpr || {});
  for (const c of rPr.children) {
    if (typeof c === 'string') continue;
    const v = c.attrs['w:val'];
    switch (c.name) {
      case 'w:b': g.bold = isOn(v); break;
      case 'w:i': g.italic = isOn(v); break;
      case 'w:u': g.underline = !!v ? v !== 'none' : true; break;
      case 'w:sz': if (Number(v) > 0) g.size = Number(v) / 2; break;
      case 'w:color': g.color = v === 'auto' ? null : hexColor(v); break;
      case 'w:rFonts': g.mono = isMonoFont(c.attrs['w:ascii'] || c.attrs['w:hAnsi'] || c.attrs['w:cs']); break;
      case 'w:vanish': g.hidden = isOn(v); break;
      default:
    }
  }
  return g;
}

// Paragraph and character styles (word/styles.xml): heading level, list numbering, alignment and the
// run formatting each gives, with what it inherits from the style it is based on.
function wordStyles(root) {
  const raw = new Map();
  let defaultPara = null;
  for (const s of kids(root, 'w:style')) {
    const id = s.attrs['w:styleId'];
    if (!id) continue;
    const name = (kid(s, 'w:name')?.attrs['w:val'] || '').toLowerCase();
    const pPr = kid(s, 'w:pPr');
    let heading = 0;
    const m = /^heading\s*([1-9])$/.exec(name) || /^heading([1-9])$/i.exec(id);
    if (m) heading = Number(m[1]);
    else if (name === 'title' || id === 'Title') heading = 1;
    const outline = kid(pPr, 'w:outlineLvl')?.attrs['w:val'];
    if (!heading && outline !== undefined && Number(outline) < 9) heading = Number(outline) + 1;
    const numPr = kid(pPr, 'w:numPr');
    // "List Bullet 2", "List Number 3": built-in list styles one level deeper each.
    const listLevel = /^list (bullet|number)\s*([2-5])$/.exec(name);
    raw.set(id, {
      basedOn: kid(s, 'w:basedOn')?.attrs['w:val'],
      heading,
      jc: kid(pPr, 'w:jc')?.attrs['w:val'],
      numId: kid(numPr, 'w:numId')?.attrs['w:val'],
      ilvl: kid(numPr, 'w:ilvl')?.attrs['w:val'] ?? (listLevel ? String(Number(listLevel[2]) - 1) : undefined),
      rPr: kid(s, 'w:rPr'),
    });
    if (s.attrs['w:type'] === 'paragraph' && isOn(s.attrs['w:default']) && s.attrs['w:default'] !== undefined) defaultPara = id;
  }
  const done = new Map();
  const resolve = (id, depth = 0) => {
    if (!id || !raw.has(id)) return null;
    if (done.has(id)) return done.get(id);
    const s = raw.get(id);
    const base = depth < 20 ? resolve(s.basedOn, depth + 1) : null;
    const style = {
      heading: s.heading || base?.heading || 0,
      jc: s.jc || base?.jc,
      numId: s.numId ?? base?.numId,
      ilvl: s.ilvl ?? base?.ilvl,
      rpr: { ...(base?.rpr || {}) },
    };
    const f = wordRunFormat(s.rPr, { style: () => null }, {});
    for (const k of ['bold', 'italic', 'underline', 'mono']) if (f[k] !== undefined) style.rpr[k] = f[k];
    done.set(id, style);
    return style;
  };
  return { get: resolve, defaultPara };
}

// Numbering (word/numbering.xml): whether a list is numbered or bulleted, and where it starts.
function wordNumbering(root) {
  const abstract = new Map();
  for (const a of kids(root, 'w:abstractNum')) {
    const levels = new Map();
    for (const l of kids(a, 'w:lvl')) {
      levels.set(Number(l.attrs['w:ilvl']) || 0, {
        fmt: kid(l, 'w:numFmt')?.attrs['w:val'] || 'decimal',
        start: Number(kid(l, 'w:start')?.attrs['w:val'] ?? 1),
      });
    }
    abstract.set(a.attrs['w:abstractNumId'], levels);
  }
  const nums = new Map();
  for (const n of kids(root, 'w:num')) {
    const overrides = new Map();
    for (const o of kids(n, 'w:lvlOverride')) {
      const s = kid(o, 'w:startOverride')?.attrs['w:val'];
      if (s !== undefined) overrides.set(Number(o.attrs['w:ilvl']) || 0, Number(s));
    }
    nums.set(n.attrs['w:numId'], { levels: abstract.get(kid(n, 'w:abstractNumId')?.attrs['w:val']), overrides });
  }
  return (numId, ilvl) => {
    const n = nums.get(numId);
    const lvl = n?.levels?.get(ilvl) || n?.levels?.get(0);
    const fmt = lvl?.fmt || 'bullet';
    return { kind: fmt === 'none' ? 'none' : fmt === 'bullet' ? 'bullet' : 'number', start: n?.overrides.get(ilvl) ?? lvl?.start ?? 1 };
  };
}

// What a paragraph holds, in order: runs of text, page breaks and pictures. Text boxes are kept to
// come after the paragraph.
class Parts {
  constructor() {
    this.list = [];
    this.runs = [];
    this.after = [];
  }
  text(text, f) {
    if (text && !f.hidden) this.runs.push(makeRun(text, f));
  }
  mark(part) {
    this.list.push({ runs: this.runs }, part);
    this.runs = [];
  }
  done() {
    this.list.push({ runs: this.runs });
    this.runs = [];
    return this.list;
  }
}

function wordDrawing(d, ctx, parts) {
  const holder = kid(d, 'wp:inline') || kid(d, 'wp:anchor');
  const ext = kid(holder, 'wp:extent');
  const docPr = kid(holder, 'wp:docPr');
  const blips = findAll(d, 'a:blip');
  for (const blip of blips) {
    const rel = ctx.rels.get(blip.attrs['r:embed']);
    if (!rel || rel.external) continue; // linked pictures live outside the file: never fetched
    const one = blips.length === 1;
    const img = picture(ctx.zip, ctx.out, rel.path, {
      width: one ? emuToPt(ext?.attrs.cx) : undefined,
      height: one ? emuToPt(ext?.attrs.cy) : undefined,
      alt: docPr?.attrs.descr || docPr?.attrs.title,
    });
    if (img) parts.mark({ image: img });
  }
  parts.after.push(...findAll(d, 'w:txbxContent'));
}
// Old-style (VML) pictures and text boxes: w:pict and w:object.
function wordVml(el, ctx, parts) {
  for (const img of findAll(el, 'v:imagedata')) {
    const rel = ctx.rels.get(img.attrs['r:id']);
    if (!rel || rel.external) continue;
    const shape = find(el, 'v:shape');
    const style = shape?.attrs.style || '';
    const size = (k) => {
      const m = new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([\\d.]+)(pt|in|px)?`, 'i').exec(style);
      return m ? Number(m[1]) * ({ in: 72, px: 0.75 }[(m[2] || 'pt').toLowerCase()] || 1) : undefined;
    };
    const b = picture(ctx.zip, ctx.out, rel.path, { width: size('width'), height: size('height'), alt: shape?.attrs.alt });
    if (b) parts.mark({ image: b });
  }
  parts.after.push(...findAll(el, 'w:txbxContent'));
}

// The contents of a w:r.
function wordRun(r, ctx, fmt, parts) {
  const f = wordRunFormat(kid(r, 'w:rPr'), ctx, fmt);
  const field = ctx.fields[ctx.fields.length - 1];
  const inCode = ctx.fields.some((x) => !x.result); // between a field's begin and separate: its code
  if (field && field.result && field.link && !f.link) f.link = field.link;
  const each = (children) => {
    for (const c of children) {
      if (typeof c === 'string') continue;
      switch (c.name) {
        case 'w:t': if (!inCode) parts.text(textOf(c), f); break;
        case 'w:tab': case 'w:ptab': if (!inCode) parts.text('    ', f); break;
        case 'w:br':
          if (inCode) break;
          if (c.attrs['w:type'] === 'page') parts.mark({ pagebreak: true });
          else parts.text('\n', f);
          break;
        case 'w:cr': if (!inCode) parts.text('\n', f); break;
        case 'w:noBreakHyphen': if (!inCode) parts.text('-', f); break;
        case 'w:fldChar': {
          const type = c.attrs['w:fldCharType'];
          if (type === 'begin') ctx.fields.push({ code: '', result: false, link: null });
          else if (type === 'separate' && ctx.fields.length) {
            const top = ctx.fields[ctx.fields.length - 1];
            top.result = true;
            const m = /HYPERLINK\s+"([^"]+)"/i.exec(top.code);
            if (m && !/\\l\b/.test(top.code.slice(0, m.index))) top.link = safeLink(m[1]);
          } else if (type === 'end') ctx.fields.pop();
          break;
        }
        case 'w:instrText': if (field && !field.result) field.code += textOf(c); break;
        case 'w:drawing': if (!inCode) wordDrawing(c, ctx, parts); break;
        case 'w:pict': case 'w:object': if (!inCode) wordVml(c, ctx, parts); break;
        case 'mc:AlternateContent': each(alternative(c).children); break;
        default:
      }
    }
  };
  each(r.children);
}

// The inline contents of a paragraph (runs, links, inserted text, content controls, simple fields).
function wordInline(children, ctx, fmt, parts) {
  for (const el of children) {
    if (typeof el === 'string') continue;
    switch (el.name) {
      case 'w:r': wordRun(el, ctx, fmt, parts); break;
      case 'w:hyperlink': {
        const rel = ctx.rels.get(el.attrs['r:id']);
        const link = rel && rel.external ? safeLink(rel.target) : null;
        wordInline(el.children, ctx, link ? { ...fmt, link } : fmt, parts);
        break;
      }
      case 'w:fldSimple': {
        const m = /HYPERLINK\s+"([^"]+)"/i.exec(el.attrs['w:instr'] || '');
        const link = m ? safeLink(m[1]) : null;
        wordInline(el.children, ctx, link ? { ...fmt, link } : fmt, parts);
        break;
      }
      case 'w:sdt': wordInline(kid(el, 'w:sdtContent')?.children || [], ctx, fmt, parts); break;
      case 'w:ins': case 'w:moveTo': case 'w:smartTag': case 'w:customXml': case 'w:dir': case 'w:bdo':
        wordInline(el.children, ctx, fmt, parts);
        break;
      case 'mc:AlternateContent': wordInline(alternative(el).children, ctx, fmt, parts); break;
      case 'm:oMathPara': case 'm:oMath': parts.text(findAll(el, 'm:t').map(textOf).join(''), fmt); break;
      default: // w:del, w:moveFrom, bookmarks, comments: nothing to show
    }
  }
}

// How a paragraph is shown: heading level, list, alignment, indent, and the formatting its style
// gives to its runs.
function wordParagraphProps(p, ctx) {
  const pPr = kid(p, 'w:pPr');
  const style = ctx.style(kid(pPr, 'w:pStyle')?.attrs['w:val'] || ctx.defaultPara) || {};
  let level = style.heading || 0;
  const outline = kid(pPr, 'w:outlineLvl')?.attrs['w:val'];
  if (outline !== undefined) level = Number(outline) < 9 ? Number(outline) + 1 : 0;
  const numPr = kid(pPr, 'w:numPr');
  const numId = kid(numPr, 'w:numId')?.attrs['w:val'] ?? style.numId;
  const ilvl = Number(kid(numPr, 'w:ilvl')?.attrs['w:val'] ?? style.ilvl ?? 0) || 0;
  let list = null;
  if (numId !== undefined && numId !== '0' && !level) {
    const n = ctx.numbering(numId, ilvl);
    if (n.kind !== 'none') list = { ordered: n.kind === 'number', level: ilvl, start: n.start };
  }
  const ind = kid(pPr, 'w:ind');
  const left = Number(ind?.attrs['w:left'] ?? ind?.attrs['w:start'] ?? 0);
  return {
    level: Math.min(4, level),
    list,
    align: ALIGN[kid(pPr, 'w:jc')?.attrs['w:val'] || style.jc] || undefined,
    indent: left > 0 ? Math.min(6, Math.round(left / 720)) : 0,
    fmt: level ? {} : { ...(style.rpr || {}) },
    breakBefore: isOn(kid(pPr, 'w:pageBreakBefore')?.attrs['w:val']) && !!kid(pPr, 'w:pageBreakBefore'),
  };
}

function wordParagraph(p, ctx) {
  const props = wordParagraphProps(p, ctx);
  const parts = new Parts();
  wordInline(p.children, ctx, props.fmt, parts);
  const { out } = ctx;
  if (props.breakBefore) out.pageBreak();
  const emit = (runs) => {
    if (props.level) out.heading(props.level, runs);
    else if (props.list) out.listItem(props.list.ordered, runs, props.list.level, props.list.start);
    else out.paragraph(runs, props);
  };
  let shown = false;
  for (const part of parts.done()) {
    if (part.runs) {
      if (part.runs.some((r) => r.text.trim())) {
        emit(part.runs);
        shown = true;
      }
    } else if (part.pagebreak) {
      out.pageBreak();
      shown = true;
    } else if (part.image) {
      out.add(part.image);
      shown = true;
    }
  }
  if (!shown && !props.level && !props.list) out.paragraph([]);
  for (const box of parts.after) wordBody(box.children, ctx);
}

// The text of a table cell: its paragraphs joined by line breaks (nested tables row by row).
// Pictures in cells are kept to come after the table.
function wordCellRuns(children, ctx, images) {
  const runs = [];
  let align;
  const line = (more) => {
    if (!more.some((r) => r.text.trim())) return;
    if (runs.length) runs.push({ text: '\n' });
    runs.push(...more);
  };
  for (const el of children) {
    if (typeof el === 'string') continue;
    if (el.name === 'w:p') {
      const props = wordParagraphProps(el, ctx);
      if (align === undefined) align = props.align || null;
      const parts = new Parts();
      wordInline(el.children, ctx, props.fmt, parts);
      const prefix = props.list ? [{ text: props.list.ordered ? '' : '• ' }] : [];
      for (const part of parts.done()) {
        if (part.runs) line([...prefix, ...part.runs].filter((r) => r.text));
        else if (part.image) images.push(part.image);
      }
      for (const box of parts.after) line(wordCellRuns(box.children, ctx, images).runs);
    } else if (el.name === 'w:tbl') {
      for (const tr of wordRows(el)) {
        const cells = wordCells(tr).map((tc) => wordCellRuns(tc.children, ctx, images).runs);
        const row = [];
        cells.filter((c) => c.length).forEach((c, i) => row.push(...(i ? [{ text: ' | ' }] : []), ...c.map((r) => ({ ...r, text: r.text.replace(/\n/g, ' ') }))));
        line(row);
      }
    } else if (el.name === 'w:sdt' || el.name === 'w:customXml') {
      line(wordCellRuns(el.name === 'w:sdt' ? kid(el, 'w:sdtContent')?.children || [] : el.children, ctx, images).runs);
    }
  }
  return { runs, align: align === 'justify' ? null : align };
}
// Rows and cells, also when wrapped in content controls.
function wordRows(tbl) {
  const rows = [];
  for (const el of kids(tbl)) {
    if (el.name === 'w:tr') rows.push(el);
    else if (el.name === 'w:sdt') rows.push(...kids(kid(el, 'w:sdtContent'), 'w:tr'));
    else if (el.name === 'w:customXml') rows.push(...kids(el, 'w:tr'));
  }
  return rows;
}
function wordCells(tr) {
  const cells = [];
  for (const el of kids(tr)) {
    if (el.name === 'w:tc') cells.push(el);
    else if (el.name === 'w:sdt') cells.push(...kids(kid(el, 'w:sdtContent'), 'w:tc'));
    else if (el.name === 'w:customXml') cells.push(...kids(el, 'w:tc'));
  }
  return cells;
}

function wordTable(tbl, ctx) {
  const widths = kids(kid(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => Number(g.attrs['w:w']) || 0);
  const images = [];
  const rows = [];
  for (const tr of wordRows(tbl)) {
    if (rows.length >= MAX_ROWS) {
      ctx.out.warn(`A table had more than ${MAX_ROWS.toLocaleString('en-US')} rows: only the first ${MAX_ROWS.toLocaleString('en-US')} were kept.`);
      break;
    }
    const header = kid(kid(tr, 'w:trPr'), 'w:tblHeader');
    const cells = wordCells(tr).map((tc) => {
      const { runs, align } = wordCellRuns(tc.children, ctx, images);
      const cell = { runs };
      const span = Number(at(tc, 'w:tcPr', 'w:gridSpan')?.attrs['w:val']);
      if (span > 1) cell.colspan = span;
      if (align && align !== 'left') cell.align = align;
      return cell;
    });
    if (!cells.length) continue;
    rows.push(header && isOn(header.attrs['w:val']) ? { header: true, cells } : { cells });
  }
  if (rows.length) {
    const block = { type: 'table', rows };
    if (widths.length && widths.every((w) => w > 0)) block.widths = widths;
    ctx.out.add(block);
  }
  for (const img of images) ctx.out.add(img);
}

function wordBody(children, ctx) {
  for (const el of children) {
    if (typeof el === 'string') continue;
    switch (el.name) {
      case 'w:p': wordParagraph(el, ctx); break;
      case 'w:tbl': wordTable(el, ctx); break;
      case 'w:sdt': wordBody(kid(el, 'w:sdtContent')?.children || [], ctx); break;
      case 'w:customXml': case 'w:ins': case 'w:moveTo': wordBody(el.children, ctx); break;
      case 'mc:AlternateContent': wordBody(alternative(el).children, ctx); break;
      default:
    }
  }
}

export function docxToBlocks(zip, out, label) {
  const missing = `${label} is not a Word document CORE can read: its main text (word/document.xml) is missing. Open it in Word, save it as .docx and try again.`;
  const main = mainPart(zip, out, 'word/document.xml');
  const doc = xmlPart(zip, main, out, missing);
  const body = kid(doc, 'w:body');
  if (!body) fail(missing);
  const dir = dirOf(main);
  const rels = readRels(zip, main, out);
  const styles = wordStyles(xmlPart(zip, relOfType(rels, 'styles') || `${dir}styles.xml`, out));
  const numbering = wordNumbering(xmlPart(zip, relOfType(rels, 'numbering') || `${dir}numbering.xml`, out));
  out.title = propsTitle(zip, out);
  const sections = findAll(body, 'w:sectPr');
  const pgSz = kid(kid(body, 'w:sectPr') || sections[sections.length - 1], 'w:pgSz');
  if (pgSz) out.landscape = pgSz.attrs['w:orient'] === 'landscape' || Number(pgSz.attrs['w:w']) > Number(pgSz.attrs['w:h']);
  const ctx = { zip, out, rels, style: styles.get, defaultPara: styles.defaultPara, numbering, fields: [] };
  wordBody(body.children, ctx);
}

// =============================================================================================
// Excel

// Built-in number formats that show dates or times.
const BUILTIN_FORMATS = { 14: 'date', 15: 'date', 16: 'date', 17: 'date', 18: 'time', 19: 'time', 20: 'time', 21: 'time', 22: 'datetime', 45: 'time', 46: 'time', 47: 'time', 9: 'percent', 10: 'percent' };

// What a number format shows: a date, a time, both, a percentage or a plain number. Text in quotes,
// [colours and locales], escaped characters and padding are not part of the pattern.
function formatKind(id, code) {
  if (code !== undefined) {
    const bare = code.split(';')[0].replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/[\\_*]./g, '');
    if (/%/.test(bare)) return 'percent';
    const time = /[hs]/i.test(bare);
    const date = /[dy]/i.test(bare) || (/m/i.test(bare) && !time);
    if (date && time) return 'datetime';
    if (date) return 'date';
    if (time && /[hs]/i.test(bare) && !/[#0?]/.test(bare)) return 'time';
    if (BUILTIN_FORMATS[id] && !/[#0?]/.test(bare)) return BUILTIN_FORMATS[id];
    return 'number';
  }
  return BUILTIN_FORMATS[id] || 'number';
}
// A number without float noise: 0.30000000000000004 → "0.3".
export const plainNumber = (n) => {
  const v = Number(n.toPrecision(12));
  return Object.is(v, -0) ? '0' : String(v);
};
const pad = (n) => String(n).padStart(2, '0');
// An Excel serial date as YYYY-MM-DD (and HH:MM when it has a time). In the 1900 system Excel counts
// 29 February 1900, a day that never was, so serials from 61 on are one day ahead.
function excelDate(serial, kind, date1904) {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958466) return null;
  let day = Math.floor(serial);
  const secs = Math.round((serial - day) * 86400);
  const time = `${pad(Math.floor(secs / 3600) % 24)}:${pad(Math.floor(secs / 60) % 60)}`;
  if (kind === 'time') return secs % 60 ? `${time}:${pad(secs % 60)}` : time;
  let ms;
  if (date1904) ms = Date.UTC(1904, 0, 1) + day * 86400000;
  else {
    if (day >= 61) day -= 1;
    ms = Date.UTC(1899, 11, 31) + day * 86400000;
  }
  const d = new Date(ms + (secs >= 86400 ? 86400000 : 0));
  const date = `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return kind === 'datetime' && secs % 86400 ? `${date} ${time}` : date;
}

function excelStyles(root) {
  const custom = new Map();
  for (const f of kids(kid(root, 'numFmts'), 'numFmt')) custom.set(Number(f.attrs.numFmtId), f.attrs.formatCode || '');
  const fonts = kids(kid(root, 'fonts'), 'font').map((f) => ({ bold: !!kid(f, 'b') && isOn(kid(f, 'b').attrs.val), italic: !!kid(f, 'i') && isOn(kid(f, 'i').attrs.val) }));
  return kids(kid(root, 'cellXfs'), 'xf').map((xf) => {
    const id = Number(xf.attrs.numFmtId) || 0;
    const font = fonts[Number(xf.attrs.fontId) || 0] || {};
    return { kind: formatKind(id, custom.get(id)), bold: font.bold, italic: font.italic };
  });
}

// Text of a shared or inline string, rich text included; phonetic guides (rPh) are not shown.
function stringText(si) {
  const parts = [];
  const walk = (el) => {
    for (const c of el.children) {
      if (typeof c === 'string') continue;
      if (c.name === 't') parts.push(textOf(c));
      else if (c.name !== 'rPh') walk(c);
    }
  };
  if (si) walk(si);
  return parts.join('');
}

const colIndex = (letters) => {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// A cell's value as shown: { text, numeric }.
function excelValue(c, ctx) {
  const t = c.attrs.t || 'n';
  const v = kid(c, 'v');
  const raw = v ? textOf(v) : null;
  switch (t) {
    case 's': return { text: ctx.shared[Number(raw)] ?? '' };
    case 'inlineStr': return { text: stringText(kid(c, 'is')) };
    case 'b': return { text: raw === null ? '' : raw === '1' || raw === 'true' ? 'TRUE' : 'FALSE' };
    case 'e': case 'str': return { text: raw ?? '' };
    case 'd': {
      const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(raw || '');
      return { text: m ? (m[2] && m[2] !== '00:00' ? `${m[1]} ${m[2]}` : m[1]) : raw || '', numeric: true };
    }
    default: {
      if (raw === null || raw.trim() === '') return { text: '' };
      const n = Number(raw);
      if (!Number.isFinite(n)) return { text: raw };
      const kind = ctx.styles[Number(c.attrs.s) || 0]?.kind || 'number';
      if (kind === 'percent') return { text: `${plainNumber(n * 100)}%`, numeric: true };
      if (kind !== 'number') {
        const d = excelDate(n, kind, ctx.date1904);
        if (d) return { text: d, numeric: true };
      }
      return { text: plainNumber(n), numeric: true };
    }
  }
}

function excelSheet(root, name, ctx) {
  const grid = [];
  let first = -1;
  let next = 0;
  let cut = false;
  for (const row of kids(kid(root, 'sheetData'), 'row')) {
    const r = Number(row.attrs.r) > 0 ? Number(row.attrs.r) - 1 : next;
    next = r + 1;
    if (first >= 0 && r - first >= MAX_ROWS) {
      cut = true;
      break;
    }
    let col = 0;
    for (const c of kids(row, 'c')) {
      const m = /^([A-Z]{1,3})(\d+)$/i.exec(c.attrs.r || '');
      const k = m ? colIndex(m[1]) : col;
      col = k + 1;
      if (k > 16383) continue;
      const { text, numeric } = excelValue(c, ctx);
      if (!text) continue;
      if (first < 0) first = r;
      const st = ctx.styles[Number(c.attrs.s) || 0] || {};
      (grid[r] ||= [])[k] = { runs: [makeRun(text, { bold: st.bold, italic: st.italic })], align: numeric ? 'right' : undefined };
    }
  }
  // Merged cells: the first one spans the columns; the others are covered.
  for (const mc of kids(kid(root, 'mergeCells'), 'mergeCell')) {
    const m = /^([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)$/i.exec(mc.attrs.ref || '');
    if (!m) continue;
    const [c1, r1, c2, r2] = [colIndex(m[1]), Number(m[2]) - 1, colIndex(m[3]), Number(m[4]) - 1];
    if (c2 <= c1 || c2 - c1 > 16384 || r2 < r1) continue;
    for (let r = r1; r <= Math.min(r2, r1 + MAX_ROWS); r++) {
      const row = (grid[r] ||= []);
      row[c1] = { ...(row[c1] || { runs: [] }), colspan: c2 - c1 + 1 };
      if (r > r1) row[c1].runs = [];
      for (let k = c1 + 1; k <= c2; k++) row[k] = null;
    }
  }
  const t = sheetTable(grid, ctx.out, name);
  if (cut) ctx.out.warn(`Sheet ${name}: only the first ${MAX_ROWS.toLocaleString('en-US')} rows were kept.`);
  return t;
}

export function xlsxToBlocks(zip, out, label) {
  const missing = `${label} is not an Excel workbook CORE can read: its list of sheets (xl/workbook.xml) is missing. Open it in Excel, save it as .xlsx and try again.`;
  const main = mainPart(zip, out, 'xl/workbook.xml');
  const wb = dropPrefixes(xmlPart(zip, main, out, missing));
  const dir = dirOf(main);
  const rels = readRels(zip, main, out);
  const part = (type, fallback) => {
    const root = xmlPart(zip, relOfType(rels, type) || `${dir}${fallback}`, out);
    return root ? dropPrefixes(root) : null;
  };
  const sst = part('sharedStrings', 'sharedStrings.xml');
  const ctx = {
    out,
    shared: kids(sst, 'si').map(stringText),
    styles: excelStyles(part('styles', 'styles.xml')),
    date1904: (() => { const v = kid(wb, 'workbookPr')?.attrs.date1904; return v !== undefined && isOn(v); })(),
  };
  out.title = propsTitle(zip, out);
  let shown = 0;
  let hidden = 0;
  for (const sh of kids(kid(wb, 'sheets'), 'sheet')) {
    const name = sh.attrs.name || `Sheet ${shown + hidden + 1}`;
    if (sh.attrs.state === 'hidden' || sh.attrs.state === 'veryHidden') {
      hidden++;
      continue;
    }
    const rel = rels.get(sh.attrs['r:id'] ?? Object.entries(sh.attrs).find(([k]) => /:id$/.test(k))?.[1]);
    if (rel && /\/chartsheet$/.test(rel.type)) {
      out.warn(`Sheet ${name} is a chart, which CORE cannot put in a PDF; it was left out.`);
      continue;
    }
    const root = rel?.path ? xmlPart(zip, rel.path, out) : null;
    if (!root) {
      out.warn(`Sheet ${name} could not be read and was left out.`);
      continue;
    }
    if (shown++) out.pageBreak();
    out.heading(2, [{ text: name }]);
    const t = excelSheet(dropPrefixes(root), name, ctx);
    if (t) {
      out.add(t.block);
      if (t.columns > 6) out.landscape = true;
    } else out.paragraph([{ text: '(This sheet is empty.)', italic: true }]);
  }
  if (hidden) out.warn(hidden === 1 ? '1 hidden sheet was left out.' : `${hidden} hidden sheets were left out.`);
  if (!shown) out.paragraph([{ text: '(This workbook has no sheets to show.)', italic: true }]);
}

// =============================================================================================
// PowerPoint

const SLIDE_ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };

function slideRunFormat(rPr, rels, base = {}) {
  if (!rPr) return base;
  const f = { ...base };
  const a = rPr.attrs;
  if (a.b !== undefined) f.bold = a.b === '1' || a.b === 'true';
  if (a.i !== undefined) f.italic = a.i === '1' || a.i === 'true';
  if (a.u !== undefined) f.underline = a.u !== 'none';
  if (Number(a.sz) > 0) f.size = Number(a.sz) / 100;
  const fill = at(rPr, 'a:solidFill', 'a:srgbClr');
  if (fill) f.color = hexColor(fill.attrs.val);
  const latin = kid(rPr, 'a:latin');
  if (latin) f.mono = isMonoFont(latin.attrs.typeface);
  const click = kid(rPr, 'a:hlinkClick');
  const rel = click && rels.get(click.attrs['r:id']);
  if (rel && rel.external) f.link = safeLink(rel.target);
  return f;
}
// The runs of a:p: text, fields (slide numbers, dates) and line breaks.
function slideRuns(p, rels) {
  const runs = [];
  for (const c of kids(p)) {
    if (c.name === 'a:r' || c.name === 'a:fld') runs.push(makeRun(textOf(kid(c, 'a:t')), slideRunFormat(kid(c, 'a:rPr'), rels)));
    else if (c.name === 'a:br') runs.push(makeRun('\n', slideRunFormat(kid(c, 'a:rPr'), rels)));
  }
  return runs;
}
function slideText(txBody, rels, out, bullets) {
  for (const p of kids(txBody, 'a:p')) {
    const pPr = kid(p, 'a:pPr');
    const runs = slideRuns(p, rels);
    const level = Number(pPr?.attrs.lvl) || 0;
    const auto = kid(pPr, 'a:buAutoNum');
    const bullet = !kid(pPr, 'a:buNone') && (auto || kid(pPr, 'a:buChar') || kid(pPr, 'a:buBlip') || bullets);
    if (bullet && runs.some((r) => r.text.trim())) out.listItem(!!auto, runs, level, Number(auto?.attrs.startAt) || 1);
    else out.paragraph(runs, { align: SLIDE_ALIGN[pPr?.attrs.algn] });
  }
}
function slideTable(tbl, rels, out) {
  const widths = kids(kid(tbl, 'a:tblGrid'), 'a:gridCol').map((g) => Number(g.attrs.w) || 0);
  const firstRow = kid(tbl, 'a:tblPr')?.attrs.firstRow;
  const rows = kids(tbl, 'a:tr').slice(0, MAX_ROWS).map((tr, i) => {
    const cells = [];
    for (const tc of kids(tr, 'a:tc')) {
      if (isOn(tc.attrs.hMerge) && tc.attrs.hMerge !== undefined) continue;
      const runs = [];
      let align;
      for (const p of kids(kid(tc, 'a:txBody'), 'a:p')) {
        const more = slideRuns(p, rels);
        if (align === undefined) align = SLIDE_ALIGN[kid(p, 'a:pPr')?.attrs.algn] || null;
        if (!more.some((r) => r.text.trim())) continue;
        if (runs.length) runs.push({ text: '\n' });
        runs.push(...more);
      }
      const cell = { runs };
      if (Number(tc.attrs.gridSpan) > 1) cell.colspan = Number(tc.attrs.gridSpan);
      if (align && align !== 'left' && align !== 'justify') cell.align = align;
      cells.push(cell);
    }
    return i === 0 && firstRow !== undefined && isOn(firstRow) ? { header: true, cells } : { cells };
  });
  if (!rows.length) return;
  const block = { type: 'table', rows };
  if (widths.length && widths.every((w) => w > 0)) block.widths = widths;
  out.add(block);
}

function slideBlocks(slide, rels, zip, out, number) {
  const titles = [];
  const items = [];
  const placeholderKinds = ['dt', 'ftr', 'sldNum', 'hdr'];
  const shapes = (children) => {
    for (const el of children) {
      if (typeof el === 'string') continue;
      switch (el.name) {
        case 'p:sp': {
          const ph = at(el, 'p:nvSpPr', 'p:nvPr', 'p:ph');
          const type = ph?.attrs.type;
          if (placeholderKinds.includes(type)) break;
          const body = kid(el, 'p:txBody');
          if (!body) break;
          if (type === 'title' || type === 'ctrTitle') titles.push(body);
          else items.push({ text: body, bullets: !!ph && (!type || type === 'body' || type === 'obj') });
          break;
        }
        case 'p:grpSp': shapes(el.children); break;
        case 'p:graphicFrame': {
          const tbl = find(el, 'a:tbl');
          if (tbl) items.push({ table: tbl });
          break;
        }
        case 'p:pic': items.push({ pic: el }); break;
        case 'mc:AlternateContent': shapes(alternative(el).children); break;
        default:
      }
    }
  };
  shapes(at(slide, 'p:cSld', 'p:spTree')?.children || []);
  const from = out.blocks.length;
  for (const t of titles) {
    const runs = [];
    for (const p of kids(t, 'a:p')) {
      const more = slideRuns(p, rels);
      if (!more.some((r) => r.text.trim())) continue;
      if (runs.length) runs.push({ text: '\n' });
      runs.push(...more);
    }
    out.heading(1, runs);
  }
  for (const item of items) {
    if (item.text) {
      slideText(item.text, rels, out, item.bullets);
      out.paragraph([]);
    } else if (item.table) slideTable(item.table, rels, out);
    else if (item.pic) {
      const rel = rels.get(find(item.pic, 'a:blip')?.attrs['r:embed']);
      if (!rel || rel.external) continue;
      const ext = at(item.pic, 'p:spPr', 'a:xfrm', 'a:ext');
      const img = picture(zip, out, rel.path, {
        width: emuToPt(ext?.attrs.cx),
        height: emuToPt(ext?.attrs.cy),
        alt: at(item.pic, 'p:nvPicPr', 'p:cNvPr')?.attrs.descr,
      });
      if (img) out.add(img);
    }
  }
  if (!out.blocks.slice(from).some(blockHasContent)) {
    out.blocks.length = from;
    out.paragraph([{ text: `(Slide ${number} has no text)`, italic: true }]);
  }
}

export function pptxToBlocks(zip, out, label) {
  const missing = `${label} is not a PowerPoint presentation CORE can read: its list of slides (ppt/presentation.xml) is missing. Open it in PowerPoint, save it as .pptx and try again.`;
  const main = mainPart(zip, out, 'ppt/presentation.xml');
  const pres = xmlPart(zip, main, out, missing);
  const rels = readRels(zip, main, out);
  out.landscape = true;
  out.title = propsTitle(zip, out);
  let number = 0;
  let shown = 0;
  let hidden = 0;
  for (const s of kids(kid(pres, 'p:sldIdLst'), 'p:sldId')) {
    number++;
    const rel = rels.get(s.attrs['r:id']);
    const slide = rel?.path ? xmlPart(zip, rel.path, out) : null;
    if (!slide) {
      out.warn(`Slide ${number} could not be read and was left out.`);
      continue;
    }
    if (slide.attrs.show === '0' || slide.attrs.show === 'false') {
      hidden++;
      continue;
    }
    if (shown++) out.pageBreak();
    slideBlocks(slide, readRels(zip, rel.path, out), zip, out, number);
  }
  if (hidden) out.warn(hidden === 1 ? '1 hidden slide was left out.' : `${hidden} hidden slides were left out.`);
  if (!shown) out.paragraph([{ text: '(This presentation has no slides.)', italic: true }]);
}
