// PDF Studio (0.64): OpenDocument text (.odt), spreadsheet (.ods) and presentation (.odp) files, as
// LibreOffice and Google Docs save them, to the block model of server/pdf/layout.js. The content is
// in content.xml, the named styles in styles.xml and the title in meta.xml; pictures are in Pictures/.
import {
  MAX_COLS, MAX_ROWS, ReadError, blockHasContent, fail, hexColor, isMonoFont, kid, kids, lengthToPt, makeRun,
  propsTitle, safeLink, sheetTable, sniffImage, textOf, xmlPart,
} from './office-core.js';

const ALIGN = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', justify: 'justify' };

// Styles by name, from styles.xml and content.xml: the formatting each gives, with what it inherits
// from its parent style, and the list styles (numbered or bulleted, level by level).
function odfStyles(roots) {
  const raw = new Map();
  const lists = new Map();
  for (const root of roots) {
    for (const holder of [kid(root, 'office:styles'), kid(root, 'office:automatic-styles')]) {
      for (const s of kids(holder)) {
        const name = s.attrs['style:name'];
        if (!name) continue;
        if (s.name === 'text:list-style') {
          const levels = new Map();
          for (const l of kids(s)) {
            const kind = l.name === 'text:list-level-style-number' ? 'number' : 'bullet';
            levels.set(Number(l.attrs['text:level']) || 1, { kind, start: Number(l.attrs['text:start-value']) || 1 });
          }
          lists.set(name, levels);
          continue;
        }
        if (s.name !== 'style:style') continue;
        const tp = kid(s, 'style:text-properties');
        const pp = kid(s, 'style:paragraph-properties');
        const f = {};
        if (tp) {
          const a = tp.attrs;
          if (a['fo:font-weight']) f.bold = a['fo:font-weight'] === 'bold' || Number(a['fo:font-weight']) >= 600;
          if (a['fo:font-style']) f.italic = a['fo:font-style'] === 'italic' || a['fo:font-style'] === 'oblique';
          if (a['style:text-underline-style']) f.underline = a['style:text-underline-style'] !== 'none';
          const font = a['style:font-name'] || a['fo:font-family'];
          if (font) f.mono = isMonoFont(font);
          if (/pt$/.test(a['fo:font-size'] || '')) f.size = parseFloat(a['fo:font-size']);
          if (a['fo:color']) f.color = hexColor(a['fo:color']);
        }
        raw.set(name, {
          title: name === 'Title' || s.attrs['style:display-name'] === 'Title',
          parent: s.attrs['style:parent-style-name'],
          f,
          align: ALIGN[pp?.attrs['fo:text-align']],
          list: s.attrs['style:list-style-name'],
          hidden: kid(s, 'style:table-properties')?.attrs['table:display'] === 'false',
        });
      }
    }
  }
  const done = new Map();
  const get = (name, depth = 0) => {
    if (!name || !raw.has(name)) return null;
    if (done.has(name)) return done.get(name);
    const s = raw.get(name);
    const base = depth < 20 ? get(s.parent, depth + 1) : null;
    const style = { f: { ...(base?.f || {}), ...s.f }, align: s.align || base?.align, list: s.list || base?.list, hidden: s.hidden, title: s.title || base?.title };
    done.set(name, style);
    return style;
  };
  return { get, lists };
}

// A picture of a draw:frame, from the package (Pictures/…). Links to pictures outside the file are
// never fetched.
function odfPicture(frame, ctx) {
  const info = {
    width: lengthToPt(frame.attrs['svg:width']),
    height: lengthToPt(frame.attrs['svg:height']),
    alt: textOf(kid(frame, 'svg:title')) || textOf(kid(frame, 'svg:desc')),
  };
  // A frame may hold the same picture in several formats: the first a PDF can hold is used.
  let other = null;
  for (const img of kids(frame, 'draw:image')) {
    const href = String(img.attrs['xlink:href'] || '').replace(/^\.\//, '');
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || !ctx.zip.has(href)) continue;
    let data;
    try {
      data = ctx.zip.read(href);
    } catch (err) {
      if (!(err instanceof ReadError)) throw err;
      ctx.out.warn(`A picture could not be read and was left out. ${err.message}`);
      return null;
    }
    if (sniffImage(data)) return ctx.out.image(data, info);
    other = data;
  }
  return other ? ctx.out.image(other, info) : null; // counted as a picture a PDF cannot hold
}

// What a paragraph holds: runs, pictures, and text boxes kept to come after it.
class Parts {
  constructor() {
    this.list = [];
    this.runs = [];
    this.after = [];
  }
  get last() {
    return this.runs.length ? this.runs[this.runs.length - 1].text : '';
  }
  text(text, f) {
    if (text) this.runs.push(makeRun(text, f));
  }
  mark(part) {
    this.list.push({ runs: this.runs }, part);
    this.runs = [];
  }
  done() {
    const last = this.runs[this.runs.length - 1];
    if (last) last.text = last.text.replace(/ +$/, '');
    this.list.push({ runs: this.runs });
    return this.list;
  }
}

// The inline contents of text:p and text:h. White space in the XML collapses to one space, as
// OpenDocument says; text:s, text:tab and text:line-break are the spaces and breaks meant.
function odfInline(children, ctx, f, parts) {
  for (const c of children) {
    if (typeof c === 'string') {
      let t = c.replace(/[ \t\r\n]+/g, ' ');
      if (!parts.last || / $|\n$/.test(parts.last)) t = t.replace(/^ /, '');
      parts.text(t, f);
      continue;
    }
    switch (c.name) {
      case 'text:span': odfInline(c.children, ctx, { ...f, ...(ctx.styles.get(c.attrs['text:style-name'])?.f || {}) }, parts); break;
      case 'text:a': {
        const link = safeLink(c.attrs['xlink:href']);
        odfInline(c.children, ctx, link ? { ...f, link } : f, parts);
        break;
      }
      case 'text:s': parts.text(' '.repeat(Math.min(200, Number(c.attrs['text:c']) || 1)), f); break;
      case 'text:tab': parts.text('    ', f); break;
      case 'text:line-break': parts.text('\n', f); break;
      case 'draw:frame': {
        const img = odfPicture(c, ctx);
        if (img) parts.mark({ image: img });
        const box = kid(c, 'draw:text-box');
        if (box) parts.after.push(box);
        break;
      }
      case 'draw:a': odfInline(c.children, ctx, f, parts); break;
      case 'text:note': case 'office:annotation': case 'office:annotation-end': case 'text:bookmark':
      case 'text:bookmark-start': case 'text:bookmark-end': case 'text:soft-page-break': case 'text:change':
      case 'text:change-start': case 'text:change-end': case 'text:reference-mark': case 'text:toc-mark':
      case 'text:alphabetical-index-mark': case 'draw:g': case 'draw:custom-shape':
        break;
      default:
        // Fields (dates, page numbers, sequences) and other inline elements: their displayed text.
        if (c.name.startsWith('text:')) odfInline(c.children, ctx, f, parts);
    }
  }
}

// A heading's style (bold, larger) is the heading's own look, so only paragraphs pass it on to runs.
function odfParagraphParts(p, ctx) {
  const style = ctx.styles.get(p.attrs['text:style-name']);
  const parts = new Parts();
  const own = p.name === 'text:h' || style?.title ? {} : { bold: style?.f.bold, italic: style?.f.italic, underline: style?.f.underline, mono: style?.f.mono };
  odfInline(p.children, ctx, own, parts);
  return { parts: parts.done(), after: parts.after, style };
}

// Runs of one or more paragraphs, joined by line breaks (table cells, titles, list items).
function odfRunsOf(children, ctx, images) {
  const runs = [];
  const line = (more) => {
    if (!more.some((r) => r.text.trim())) return;
    if (runs.length) runs.push({ text: '\n' });
    runs.push(...more);
  };
  for (const el of children) {
    if (typeof el === 'string') continue;
    if (el.name === 'text:p' || el.name === 'text:h') {
      const { parts, after } = odfParagraphParts(el, ctx);
      for (const part of parts) {
        if (part.runs) line(part.runs);
        else if (part.image && images) images.push(part.image);
      }
      for (const box of after) line(odfRunsOf(box.children, ctx, images));
    } else if (el.name === 'text:list') {
      for (const item of kids(el)) line(odfRunsOf(item.children, ctx, images));
    } else if (el.name === 'text:section') line(odfRunsOf(el.children, ctx, images));
  }
  return runs;
}

function odfParagraph(p, ctx, emit) {
  const { parts, after, style } = odfParagraphParts(p, ctx);
  let shown = false;
  for (const part of parts) {
    if (part.runs) {
      if (part.runs.some((r) => r.text.trim())) {
        emit(part.runs, style);
        shown = true;
      }
    } else if (part.image) {
      ctx.out.add(part.image);
      shown = true;
    }
  }
  if (!shown && !emit.skipEmpty) ctx.out.paragraph([]);
  for (const box of after) odfBody(box.children, ctx);
}

// A text:list: each item's paragraphs make one item; nested lists go one level deeper.
function odfList(list, ctx, level, inherited) {
  const name = list.attrs['text:style-name'] || inherited;
  const kind = (styleName) => {
    const levels = ctx.styles.lists.get(styleName);
    return levels?.get(Math.min(10, level + 1)) || levels?.get(1) || { kind: ctx.defaultList || 'bullet', start: 1 };
  };
  for (const item of kids(list)) {
    if (item.name !== 'text:list-item' && item.name !== 'text:list-header') continue;
    let runs = [];
    let styleName = name;
    const flush = () => {
      if (!runs.length) return;
      const k = kind(styleName);
      const start = Number(item.attrs['text:start-value']) || k.start;
      ctx.out.listItem(k.kind === 'number', runs, level, start);
      runs = [];
    };
    for (const el of kids(item)) {
      if (el.name === 'text:p' || el.name === 'text:h') {
        const { parts, after, style } = odfParagraphParts(el, ctx);
        if (!list.attrs['text:style-name'] && !inherited && style?.list) styleName = style.list;
        for (const part of parts) {
          if (part.runs && part.runs.some((r) => r.text.trim())) {
            if (runs.length) runs.push({ text: '\n' });
            runs.push(...part.runs);
          } else if (part.image) {
            flush();
            ctx.out.add(part.image);
          }
        }
        for (const box of after) {
          flush();
          odfBody(box.children, ctx);
        }
      } else if (el.name === 'text:list') {
        flush();
        odfList(el, ctx, level + 1, styleName);
      } else if (el.name === 'table:table') {
        flush();
        odfTable(el, ctx);
      }
    }
    flush();
  }
}

// The rows of a table:table as a grid of cells; repeated rows and columns are written out, up to the
// limits (spreadsheets repeat empty cells to the end of the sheet).
function odfGrid(table, ctx, cellOf) {
  const grid = [];
  const headers = new Set();
  let cut = false;
  const rowsOf = (el, header) => {
    for (const r of kids(el)) {
      if (grid.length > MAX_ROWS) {
        cut = true;
        return;
      }
      if (r.name === 'table:table-header-rows') rowsOf(r, true);
      else if (r.name === 'table:table-rows' || r.name === 'table:table-row-group') rowsOf(r, header);
      else if (r.name === 'table:table-row') {
        const cells = [];
        for (const c of kids(r)) {
          if (c.name !== 'table:table-cell' && c.name !== 'table:covered-table-cell') continue;
          const times = Math.min(Number(c.attrs['table:number-columns-repeated']) || 1, MAX_COLS + 1 - cells.length);
          if (times <= 0) break;
          const cell = c.name === 'table:covered-table-cell' ? null : cellOf(c);
          for (let n = 0; n < times; n++) cells.push(cell);
        }
        const empty = !cells.some((c) => c && c.runs.some((x) => x.text.trim()));
        const times = Math.min(Number(r.attrs['table:number-rows-repeated']) || 1, MAX_ROWS + 1 - grid.length);
        for (let n = 0; n < times; n++) {
          if (header) headers.add(grid.length);
          grid.push(empty ? [] : cells);
        }
      }
    }
  };
  rowsOf(table, false);
  return { grid, headers, cut };
}

function odfCell(c, ctx, images) {
  const runs = odfRunsOf(c.children, ctx, images);
  const cell = { runs };
  const span = Number(c.attrs['table:number-columns-spanned']);
  if (span > 1) cell.colspan = span;
  return cell;
}

// A table in a text document.
function odfTable(table, ctx) {
  const images = [];
  const { grid, headers } = odfGrid(table, ctx, (c) => odfCell(c, ctx, images));
  const t = sheetTable(grid, ctx.out, null, { header: headers });
  if (t) ctx.out.add(t.block);
  for (const img of images) ctx.out.add(img);
}

function odfBody(children, ctx) {
  for (const el of children) {
    if (typeof el === 'string') continue;
    switch (el.name) {
      case 'text:h': {
        const level = Math.min(4, Math.max(1, Number(el.attrs['text:outline-level']) || 1));
        const emit = (runs) => ctx.out.heading(level, runs);
        emit.skipEmpty = true;
        odfParagraph(el, ctx, emit);
        break;
      }
      case 'text:p': {
        // A paragraph in the Title style is the document's main heading.
        const emit = (runs, style) => (style?.title ? ctx.out.heading(1, runs) : ctx.out.paragraph(runs, { align: style?.align }));
        odfParagraph(el, ctx, emit);
        break;
      }
      case 'text:list': odfList(el, ctx, 0, null); break;
      case 'table:table': odfTable(el, ctx); break;
      case 'draw:frame': {
        const img = odfPicture(el, ctx);
        if (img) ctx.out.add(img);
        const box = kid(el, 'draw:text-box');
        if (box) odfBody(box.children, ctx);
        break;
      }
      case 'text:section': case 'text:index-body': case 'text:index-title': case 'draw:text-box': case 'draw:a':
        odfBody(el.children, ctx);
        break;
      case 'text:table-of-content': case 'text:alphabetical-index': case 'text:illustration-index':
      case 'text:table-index': case 'text:object-index': case 'text:user-index': case 'text:bibliography':
        odfBody(kid(el, 'text:index-body')?.children || [], ctx);
        break;
      default: // tracked changes, forms, variable declarations: nothing to show
    }
  }
}

// A sheet of a spreadsheet: displayed text of each cell, numbers aligned right.
function odsSheet(table, ctx) {
  const name = table.attrs['table:name'] || 'Sheet';
  const { grid, cut } = odfGrid(table, ctx, (c) => {
    let runs = odfRunsOf(c.children, ctx, null);
    const type = c.attrs['office:value-type'];
    if (!runs.length) {
      const v = c.attrs['office:date-value'] || c.attrs['office:time-value'] || c.attrs['office:value'] || c.attrs['office:boolean-value'] || c.attrs['office:string-value'];
      if (v) runs = [{ text: type === 'date' ? v.replace(/T00:00:00(\.0+)?$/, '') : v }];
    }
    const cell = { runs };
    if (['float', 'percentage', 'currency', 'date', 'time'].includes(type)) cell.align = 'right';
    const span = Number(c.attrs['table:number-columns-spanned']);
    if (span > 1) cell.colspan = span;
    return cell;
  });
  const t = sheetTable(grid, ctx.out, name);
  if (cut) ctx.out.warn(`Sheet ${name}: only the first ${MAX_ROWS.toLocaleString('en-US')} rows were kept.`);
  return { name, t };
}

// A slide (draw:page): the title first, then text boxes, tables and pictures in order.
function odpPage(page, ctx, number) {
  const titles = [];
  const items = [];
  const skip = ['page-number', 'footer', 'date-time', 'header'];
  const walk = (children) => {
    for (const el of children) {
      if (typeof el === 'string') continue;
      if (el.name === 'draw:g') walk(el.children);
      else if (el.name === 'draw:frame') {
        const cls = el.attrs['presentation:class'];
        if (skip.includes(cls)) continue;
        const box = kid(el, 'draw:text-box');
        if (box && cls === 'title') titles.push(box);
        else items.push({ frame: el, box, outline: cls === 'outline' });
      } else if (/^draw:(custom-shape|rect|ellipse|polygon|path|caption|circle)$/.test(el.name)) items.push({ box: el });
    }
  };
  walk(page.children);
  const from = ctx.out.blocks.length;
  for (const t of titles) ctx.out.heading(1, odfRunsOf(t.children, ctx, null));
  for (const item of items) {
    if (item.frame) {
      const img = odfPicture(item.frame, ctx);
      if (img) ctx.out.add(img);
      const tbl = kid(item.frame, 'table:table');
      if (tbl) odfTable(tbl, ctx);
    }
    if (item.box) {
      ctx.defaultList = item.outline ? 'bullet' : null;
      odfBody(item.box.children, ctx);
      ctx.out.paragraph([]);
    }
  }
  if (!ctx.out.blocks.slice(from).some(blockHasContent)) {
    ctx.out.blocks.length = from;
    ctx.out.paragraph([{ text: `(Slide ${number} has no text)`, italic: true }]);
  }
}

const NAMES = { odt: 'an OpenDocument text', ods: 'an OpenDocument spreadsheet', odp: 'an OpenDocument presentation' };

export function odfToBlocks(zip, out, label, kind) {
  const manifest = zip.has('META-INF/manifest.xml') ? zip.read('META-INF/manifest.xml').toString('utf8') : '';
  if (/encryption-data/.test(manifest)) fail(`${label} is protected with a password. Remove the password, save it again and upload that copy.`);
  const content = xmlPart(zip, 'content.xml', out, `${label} is not ${NAMES[kind]} CORE can read: its main part (content.xml) is missing. Open it, save it again and try once more.`);
  const styles = odfStyles([xmlPart(zip, 'styles.xml', out), content].filter(Boolean));
  out.title = propsTitle(zip, out, 'meta.xml');
  const ctx = { zip, out, styles };
  const body = kid(content, 'office:body');
  // The kind is taken from what the file holds, whatever its name says.
  const text = kid(body, 'office:text');
  const sheet = kid(body, 'office:spreadsheet');
  const show = kid(body, 'office:presentation') || kid(body, 'office:drawing');
  if (text) odfBody(text.children, ctx);
  else if (sheet) {
    let shown = 0;
    let hidden = 0;
    for (const table of kids(sheet, 'table:table')) {
      if (styles.get(table.attrs['table:style-name'])?.hidden) {
        hidden++;
        continue;
      }
      if (shown++) out.pageBreak();
      const { name, t } = odsSheet(table, ctx);
      out.heading(2, [{ text: name }]);
      if (t) {
        out.add(t.block);
        if (t.columns > 6) out.landscape = true;
      } else out.paragraph([{ text: '(This sheet is empty.)', italic: true }]);
    }
    if (hidden) out.warn(hidden === 1 ? '1 hidden sheet was left out.' : `${hidden} hidden sheets were left out.`);
  } else if (show) {
    out.landscape = true;
    kids(show, 'draw:page').forEach((page, i) => {
      if (i) out.pageBreak();
      odpPage(page, ctx, i + 1);
    });
  } else fail(`${label} is not ${NAMES[kind]} CORE can read: it holds no text, sheets or slides.`);
}
