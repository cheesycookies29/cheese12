// PDF Studio (0.64): plain text, Markdown, CSV and HTML files to the block model of
// server/pdf/layout.js. Nothing in a file is ever run or fetched: links stay links, pictures that live
// on the web are shown by their description, and an HTML page's scripts and styles are dropped unread.
import { parseCsv, csvSeparator } from '../../shared/csv.js';
import { MAX_COLS, MAX_ROWS, decodeText, makeRun, safeLink, sheetTable } from './office-core.js';
import { CP1252_CHARS } from './cp1252.js';

const lines = (buf) => decodeText(buf).replace(/\r\n?/g, '\n');

// =============================================================================================
// Plain text

// Whether a chunk of lines is laid out in columns (a report, a listing, a table drawn with spaces)
// and so must keep its spacing in a fixed-width font: several lines whose words after a run of two or
// more spaces start at the same column, box-drawing borders, all lines indented like code, or long
// lines that are not sentences (data, logs).
function looksFixedWidth(chunk) {
  const full = chunk.filter((l) => l.trim());
  if (full.some((l) => l.length > 200 && (l.match(/ /g) || []).length < l.length / 20)) return true;
  if (full.length < 2) return false;
  if (full.some((l) => /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝]/.test(l) || /^\s*[+|][-=+|]{3,}/.test(l))) return true;
  if (full.every((l) => /^(\t| {4})/.test(l))) return true;
  const starts = new Map();
  let gapped = 0;
  for (const l of full) {
    const re = /\S(?: {2,}|\t+)(?=\S)/g;
    let m;
    let any = false;
    while ((m = re.exec(l))) {
      const col = m.index + m[0].length;
      starts.set(col, (starts.get(col) || 0) + 1);
      any = true;
    }
    if (any) gapped++;
  }
  const need = Math.max(2, Math.ceil(full.length / 2));
  return gapped >= need && Math.max(0, ...starts.values()) >= need;
}

export function txtToBlocks(buf, out) {
  const text = lines(buf);
  if (!text.trim()) {
    out.warn('The file is empty.');
    return;
  }
  let code = null;
  for (const chunk of text.split(/\n[ \t]*\n/)) {
    const ls = chunk.replace(/^\n+|\n+$/g, '').split('\n').map((l) => l.replace(/\s+$/, ''));
    if (!ls.some((l) => l.trim())) continue;
    if (looksFixedWidth(ls)) {
      code = code === null ? ls.join('\n') : `${code}\n\n${ls.join('\n')}`;
      continue;
    }
    if (code !== null) out.add({ type: 'code', text: code });
    code = null;
    out.paragraph([{ text: ls.join('\n') }]);
  }
  if (code !== null) out.add({ type: 'code', text: code });
}

// =============================================================================================
// Markdown

// [text](url "title") from the [ at i: { text, url, end }, or null when it is not a link.
function parseLink(src, i) {
  let depth = 0;
  let j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') j++;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
  }
  if (j >= src.length || src[j + 1] !== '(') return null;
  let k = j + 2;
  depth = 1;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '\\') k++;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) break;
  }
  if (k >= src.length) return null;
  const inside = src.slice(j + 2, k).trim();
  const url = inside.startsWith('<') ? inside.slice(1, inside.indexOf('>') > 0 ? inside.indexOf('>') : undefined) : inside.split(/\s+/)[0];
  return { text: src.slice(i + 1, j), url, end: k + 1 };
}

// Inline Markdown: **bold**, *italic* and _italic_, `code`, [links](…), ![pictures](…) (their
// description, in italics), <https://autolinks> and backslash escapes.
function mdInline(src, base = {}) {
  const runs = [];
  const st = { bold: false, italic: false };
  let buf = '';
  const fmt = () => ({ ...base, bold: base.bold || st.bold, italic: base.italic || st.italic });
  const flush = () => {
    if (buf) runs.push(makeRun(buf, fmt()));
    buf = '';
  };
  for (let i = 0; i < src.length;) {
    const ch = src[i];
    if (ch === '\\' && /[!-/:-@[-`{-~]/.test(src[i + 1] || '')) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      let n = 1;
      while (src[i + n] === '`') n++;
      const end = src.indexOf('`'.repeat(n), i + n);
      if (end > 0) {
        flush();
        let code = src.slice(i + n, end).replace(/\n/g, ' ');
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        runs.push(makeRun(code, { ...fmt(), mono: true }));
        i = end + n;
      } else {
        buf += '`'.repeat(n);
        i += n;
      }
      continue;
    }
    if ((ch === '!' && src[i + 1] === '[') || ch === '[') {
      const l = parseLink(src, ch === '!' ? i + 1 : i);
      if (l) {
        flush();
        if (ch === '!') {
          if (l.text.trim()) runs.push(makeRun(l.text, { ...fmt(), italic: true }));
        } else {
          const link = safeLink(l.url);
          runs.push(...mdInline(l.text, link ? { ...fmt(), link } : fmt()));
        }
        i = l.end;
        continue;
      }
    }
    if (ch === '<') {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(src.slice(i, i + 2100));
      if (m) {
        flush();
        runs.push(makeRun(m[1], { ...fmt(), link: m[1] }));
        i += m[0].length;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      let n = 1;
      while (src[i + n] === ch) n++;
      const before = src[i - 1] || ' ';
      const after = src[i + n] || ' ';
      // snake_case and 2 * 3 stay as they are.
      if (ch === '_' && /\w/.test(before) && /\w/.test(after)) {
        buf += ch.repeat(n);
        i += n;
        continue;
      }
      const canOpen = !/\s/.test(after);
      const canClose = !/\s/.test(before);
      let k = n;
      while (k > 0) {
        if (k >= 2 && ((st.bold && canClose) || (!st.bold && canOpen && src.indexOf(ch + ch, i + n) > 0))) {
          flush();
          st.bold = !st.bold;
          k -= 2;
        } else if ((st.italic && canClose) || (!st.italic && canOpen && src.indexOf(ch, i + n) > 0)) {
          flush();
          st.italic = !st.italic;
          k -= 1;
        } else {
          buf += ch.repeat(k);
          k = 0;
        }
      }
      i += n;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return runs;
}

// Lines of a paragraph: a line ending in two spaces or a backslash breaks; others join with a space.
function mdLines(ls, base) {
  const text = ls.map((l, i) => {
    const t = l.replace(/^\s+/, '');
    if (i === ls.length - 1) return t.replace(/\s+$/, '');
    if (/ {2,}$/.test(t)) return `${t.replace(/\s+$/, '')}\n`;
    if (/\\$/.test(t)) return `${t.slice(0, -1)}\n`;
    return `${t.replace(/\s+$/, '')} `;
  }).join('');
  return mdInline(text, base);
}

const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const width = (s) => s.replace(/\t/g, '    ').length;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

function mdTable(ls, i, out) {
  const head = splitRow(ls[i]).slice(0, MAX_COLS);
  const aligns = splitRow(ls[i + 1]).map((a) => (a.startsWith(':') && a.endsWith(':') ? 'center' : a.endsWith(':') ? 'right' : a.startsWith(':') ? 'left' : null));
  const row = (cells) => head.map((_, k) => {
    const cell = { runs: mdInline(cells[k] || '') };
    if (aligns[k]) cell.align = aligns[k];
    return cell;
  });
  if (splitRow(ls[i]).length > MAX_COLS) out.warn(`A table had more than ${MAX_COLS} columns: only the first ${MAX_COLS} were kept.`);
  const rows = [{ header: true, cells: row(head) }];
  i += 2;
  for (; i < ls.length && ls[i].trim() && ls[i].includes('|'); i++) {
    if (rows.length > MAX_ROWS) {
      out.warn(`A table had more than ${MAX_ROWS.toLocaleString('en-US')} rows: only the first ${MAX_ROWS.toLocaleString('en-US')} were kept.`);
      while (i < ls.length && ls[i].trim() && ls[i].includes('|')) i++;
      break;
    }
    rows.push({ cells: row(splitRow(ls[i])) });
  }
  out.add({ type: 'table', rows });
  return i;
}

// A list, nested by indentation: each deeper indent is one level more (at most 4).
function mdList(ls, i, out) {
  const indents = [];
  let item = null;
  const flush = () => {
    if (item) out.listItem(item.ordered, mdLines(item.lines.length ? item.lines : [''], {}), item.level, item.start);
    item = null;
  };
  while (i < ls.length) {
    const line = ls[i];
    if (RULE.test(line)) break;
    const m = ITEM.exec(line);
    if (m) {
      const indent = width(m[1]);
      while (indents.length && indent < indents[indents.length - 1] - 1) indents.pop();
      if (!indents.length || indent > indents[indents.length - 1] + 1) indents.push(indent);
      flush();
      const ordered = /\d/.test(m[2]);
      item = { lines: m[3] ? [m[3]] : [], level: Math.min(4, indents.length - 1), ordered, start: ordered ? parseInt(m[2], 10) : 1 };
      i++;
      continue;
    }
    if (!line.trim()) {
      let j = i + 1;
      while (j < ls.length && !ls[j].trim()) j++;
      if (j < ls.length && !RULE.test(ls[j]) && (ITEM.test(ls[j]) || /^( {2,}|\t)/.test(ls[j]))) {
        if (item && !ITEM.test(ls[j])) item.lines.push('\\');
        i = j;
        continue;
      }
      break;
    }
    if (/^ {0,3}(#{1,6}(\s|$)|>)/.test(line) || FENCE.test(line)) break;
    if (item) item.lines.push(line.trim());
    i++;
  }
  flush();
  return i;
}

export function mdToBlocks(buf, out) {
  const ls = lines(buf).split('\n');
  let para = [];
  const flush = () => {
    if (para.length) out.paragraph(mdLines(para, {}));
    para = [];
  };
  let i = 0;
  while (i < ls.length) {
    const line = ls[i];
    let m;
    if (!line.trim()) {
      flush();
      i++;
    } else if ((m = FENCE.exec(line))) {
      flush();
      const close = new RegExp(`^ {0,3}${m[1][0] === '`' ? '`' : '~'}{${m[1].length},}\\s*$`);
      const body = [];
      for (i++; i < ls.length && !close.test(ls[i]); i++) body.push(ls[i]);
      i++;
      out.add({ type: 'code', text: body.join('\n') });
    } else if ((m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line))) {
      flush();
      const runs = mdInline(m[2] || '');
      const level = Math.min(4, m[1].length);
      out.heading(level, runs);
      if (level === 1 && !out.title) out.title = runs.map((r) => r.text).join('').trim() || null;
      i++;
    } else if (para.length && /^ {0,3}(=+|-+)[ \t]*$/.test(line)) {
      // A line of = or - under a paragraph makes it a heading.
      const runs = mdLines(para, {});
      const level = line.trim()[0] === '=' ? 1 : 2;
      out.heading(level, runs);
      if (level === 1 && !out.title) out.title = runs.map((r) => r.text).join('').trim() || null;
      para = [];
      i++;
    } else if (RULE.test(line)) {
      flush();
      out.add({ type: 'rule' });
      i++;
    } else if (line.includes('|') && i + 1 < ls.length && ls[i + 1].includes('-') && ls[i + 1].includes('|') && SEPARATOR.test(ls[i + 1])) {
      flush();
      i = mdTable(ls, i, out);
    } else if (/^ {0,3}>/.test(line)) {
      flush();
      const quote = [];
      for (; i < ls.length && /^ {0,3}>/.test(ls[i]); i++) quote.push(ls[i].replace(/^ {0,3}>( ?>)* ?/, ''));
      let group = [];
      const flushQuote = () => {
        if (group.length) out.paragraph(mdLines(group, { italic: true }), { indent: 1 });
        group = [];
      };
      for (const q of quote) q.trim() ? group.push(q) : flushQuote();
      flushQuote();
    } else if (ITEM.test(line)) {
      flush();
      i = mdList(ls, i, out);
    } else if (!para.length && /^( {4}|\t)/.test(line)) {
      const body = [];
      for (; i < ls.length && (/^( {4}|\t)/.test(ls[i]) || !ls[i].trim()); i++) body.push(ls[i].replace(/^( {4}|\t)/, ''));
      out.add({ type: 'code', text: body.join('\n').replace(/\n+$/, '') });
    } else {
      para.push(line);
      i++;
    }
  }
  flush();
}

// =============================================================================================
// CSV

const NUMERIC = /^(?:[-+(]?[$€£¥₱]?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?\)?|[-+]?\.\d+%?|[-+]?\d{1,3}(?:\.\d{3})*,\d+)$/;

// The separator: a comma or semicolon (shared/csv.js), or a tab when the first line has more tabs.
function separatorOf(text) {
  const sep = csvSeparator(text);
  let quoted = false;
  let tabs = 0;
  let seps = 0;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch === '\t') tabs++;
    else if (!quoted && ch === sep) seps++;
  }
  return tabs > seps ? '\t' : sep;
}

export function csvToBlocks(buf, out) {
  const text = decodeText(buf);
  if (!text.trim()) {
    out.warn('The file is empty.');
    return;
  }
  const { rows, error } = parseCsv(text, { separator: separatorOf(text) });
  if (error) out.warn(`${error} The rest of the file was left out.`);
  const grid = rows.map((row, r) => row.map((c) => ({ runs: c ? [{ text: c }] : [], align: r > 0 && NUMERIC.test(c.trim()) ? 'right' : undefined })));
  const t = sheetTable(grid, out, null);
  if (!t) return;
  out.add(t.block);
  if (t.columns > 6) out.landscape = true;
}

// =============================================================================================
// HTML

const ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sbquo: '‚', bdquo: '„', laquo: '«', raquo: '»', copy: '©',
  reg: '®', trade: '™', euro: '€', peso: '₱', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶',
  middot: '·', bull: '•', deg: '°', plusmn: '±', times: '×', divide: '÷', frac12: '½', frac14: '¼',
  frac34: '¾', iexcl: '¡', iquest: '¿', shy: '', ensp: ' ', emsp: ' ', thinsp: ' ',
  zwnj: '', zwj: '', lrm: '', rlm: '', dagger: '†', Dagger: '‡', permil: '‰', prime: '′', Prime: '″',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', le: '≤', ge: '≥', ne: '≠', minus: '−', micro: 'µ',
  ordf: 'ª', ordm: 'º', sup1: '¹', sup2: '²', sup3: '³', acute: '´', uml: '¨', cedil: '¸', macr: '¯', not: '¬',
  curren: '¤', brvbar: '¦', szlig: 'ß', aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å',
  eth: 'ð', ETH: 'Ð', thorn: 'þ', THORN: 'Þ', oelig: 'œ', OElig: 'Œ', scaron: 'š', Scaron: 'Š', yuml: 'ÿ', Yuml: 'Ÿ',
};
// The accented letters: &eacute; &Ntilde; &uuml; and the like.
const MARKS = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', cedil: '̧', ring: '̊' };
function decodeHtml(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g, (m, hex, dec, name) => {
    if (name) {
      if (Object.hasOwn(ENTITIES, name)) return ENTITIES[name];
      const a = /^([a-zA-Z])(acute|grave|circ|tilde|uml|cedil|ring)$/.exec(name);
      return a ? `${a[1]}${MARKS[a[2]]}`.normalize('NFC') : m;
    }
    const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
    // Numbers 128–159 mean the Windows-1252 characters (€, “, ”) in HTML.
    if (cp >= 128 && cp < 160) return CP1252_CHARS[cp];
    return String.fromCodePoint(cp);
  });
}
function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}
const alignOf = (a) => {
  const v = (a.align || (/text-align\s*:\s*(left|center|right|justify)/i.exec(a.style || '') || [])[1] || '').toLowerCase();
  return ['left', 'center', 'right', 'justify'].includes(v) ? v : undefined;
};
const trimRuns = (runs) => {
  while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop();
  while (runs.length && !runs[0].text.trim()) runs.shift();
  if (runs.length) {
    runs[0] = { ...runs[0], text: runs[0].text.replace(/^[\s]+/, '') };
    const last = runs.length - 1;
    runs[last] = { ...runs[last], text: runs[last].text.replace(/[\s]+$/, '') };
  }
  return runs;
};

// Elements whose contents are never shown (and never run): skipped to their end tag.
const SKIP = new Set(['script', 'style', 'title', 'head', 'noscript', 'template', 'svg', 'math', 'iframe', 'object', 'select', 'textarea', 'canvas', 'video', 'audio', 'map']);
const BLOCKS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'address', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'center', 'form', 'fieldset', 'details', 'summary', 'caption', 'body', 'html', 'legend']);
const INLINE = { b: 'bold', strong: 'bold', i: 'italic', em: 'italic', cite: 'italic', var: 'italic', dfn: 'italic', u: 'underline', ins: 'underline', code: 'mono', kbd: 'mono', samp: 'mono', tt: 'mono' };

// The page as it is read, tag by tag: where text goes (a paragraph, a list item or a table cell)
// and the formatting in force.
class HtmlReader {
  constructor(out) {
    this.out = out;
    this.runs = [];
    this.heading = 0;
    this.align = undefined;
    this.quote = 0;
    this.count = { bold: 0, italic: 0, underline: 0, mono: 0 };
    this.links = [];
    this.lists = [];
    this.item = null;
    this.table = null; // the outermost table; tables inside it become lines of its cells
    this.nested = 0;
    this.cellLists = 0;
  }
  format() {
    const c = this.count;
    return { bold: c.bold > 0 || this.table?.cell?.th, italic: c.italic > 0, underline: c.underline > 0, mono: c.mono > 0, link: this.links[this.links.length - 1] };
  }
  target() {
    if (this.table) return this.table.cell ? this.table.cell.runs : null;
    if (!this.item && this.lists.length) {
      const l = this.lists[this.lists.length - 1];
      this.item = { runs: [], level: this.lists.length - 1, ordered: l.ordered, start: l.start };
    }
    return this.item ? this.item.runs : this.runs;
  }
  text(raw) {
    const runs = this.target();
    if (!runs) return;
    let t = decodeHtml(raw).replace(/[ \t\r\n\f]+/g, ' ');
    const last = runs.length ? runs[runs.length - 1].text : '';
    if (!last || / $|\n$/.test(last)) t = t.replace(/^ /, '');
    if (t) runs.push(makeRun(t, this.format()));
  }
  newline() {
    const runs = this.target();
    if (runs && runs.length && !/\n$/.test(runs[runs.length - 1].text)) runs.push({ text: '\n' });
  }
  flushParagraph() {
    const runs = trimRuns(this.runs);
    this.runs = [];
    if (!runs.length) return;
    if (this.heading) this.out.heading(this.heading, runs);
    else this.out.paragraph(runs, { align: this.align, indent: this.quote ? Math.min(6, this.quote) : 0 });
  }
  flushItem() {
    if (!this.item) return;
    const { runs, ordered, level, start } = this.item;
    this.item = null;
    trimRuns(runs);
    if (runs.length) this.out.listItem(ordered, runs, level, start);
  }
  // A block starts or ends: the text so far is a paragraph, or a new line in an item or a cell.
  boundary() {
    if (this.table || this.item) this.newline();
    else this.flushParagraph();
  }
  // A block (picture, code, rule) that stands on its own.
  standalone(block) {
    if (this.table) {
      this.table.after.push(block);
      return;
    }
    this.flushParagraph();
    this.flushItem();
    this.out.add(block);
  }
  image(a) {
    const m = /^data:image\/(png|jpe?g);base64,([a-z0-9+/=\s]+)$/i.exec((a.src || '').trim());
    const data = m ? Buffer.from(m[2].replace(/\s+/g, ''), 'base64') : null;
    const px = (v) => (Number(v) > 0 ? Math.round(Number(v) * 75) / 100 : undefined);
    const block = data ? this.out.image(data, { width: px(a.width), height: px(a.height), alt: a.alt }) : null;
    if (block) this.standalone(block);
    else if ((a.alt || '').trim()) {
      const runs = this.target();
      if (runs) runs.push(makeRun(a.alt.trim(), { ...this.format(), italic: true }));
    }
  }
  code(text) {
    if (this.table) {
      const runs = this.table.cell?.runs;
      if (runs) {
        this.newline();
        runs.push(makeRun(text, { mono: true }));
      }
      return;
    }
    this.standalone({ type: 'code', text });
  }
  closeCell() {
    const t = this.table;
    if (!t.cell) return;
    if (!t.row) t.row = { cells: [], header: t.head };
    trimRuns(t.cell.runs);
    const cell = { runs: t.cell.runs };
    if (t.cell.colspan > 1) cell.colspan = Math.min(MAX_COLS, t.cell.colspan);
    if (t.cell.align && t.cell.align !== 'justify') cell.align = t.cell.align;
    t.row.cells.push(cell);
    t.row.th = (t.row.th ?? true) && t.cell.th;
    t.cell = null;
  }
  closeRow() {
    const t = this.table;
    this.closeCell();
    if (!t.row) return;
    if (t.row.cells.length) {
      if (t.rows.length >= MAX_ROWS) t.cut = true;
      else t.rows.push(t.row.header || t.row.th ? { header: true, cells: t.row.cells.slice(0, MAX_COLS) } : { cells: t.row.cells.slice(0, MAX_COLS) });
      if (t.row.cells.length > MAX_COLS) this.out.warn(`A table had more than ${MAX_COLS} columns: only the first ${MAX_COLS} were kept.`);
    }
    t.row = null;
  }
  closeTable() {
    const t = this.table;
    this.closeRow();
    this.table = null;
    if (t.cut) this.out.warn(`A table had more than ${MAX_ROWS.toLocaleString('en-US')} rows: only the first ${MAX_ROWS.toLocaleString('en-US')} were kept.`);
    if (t.rows.length) this.out.add({ type: 'table', rows: t.rows });
    for (const b of t.after) this.out.add(b);
  }
  open(name, a) {
    if (INLINE[name]) {
      this.count[INLINE[name]]++;
      return;
    }
    if (name === 'a') {
      this.links.push(safeLink(a.href) || undefined);
      return;
    }
    if (name === 'br') {
      const runs = this.target();
      if (runs && runs.length) runs.push({ text: '\n' });
      return;
    }
    if (name === 'img') return this.image(a);
    if (name === 'hr') return this.table ? this.newline() : this.standalone({ type: 'rule' });
    if (/^h[1-6]$/.test(name)) {
      this.boundary();
      if (!this.table && !this.item) this.heading = Math.min(4, Number(name[1]));
      else this.count.bold++;
      return;
    }
    if (name === 'blockquote') {
      this.boundary();
      this.quote++;
      return;
    }
    if (BLOCKS.has(name)) {
      this.boundary();
      if (!this.table && !this.item) this.align = name === 'center' ? 'center' : alignOf(a);
      return;
    }
    if (name === 'ul' || name === 'ol') {
      if (this.table) {
        this.cellLists++;
        this.newline();
        return;
      }
      this.flushParagraph();
      this.flushItem();
      this.lists.push({ ordered: name === 'ol', start: Number(a.start) || 1 });
      return;
    }
    if (name === 'li') {
      if (this.table) {
        this.newline();
        const runs = this.target();
        if (runs) runs.push({ text: '• ' });
        return;
      }
      this.flushParagraph();
      this.flushItem();
      if (!this.lists.length) this.lists.push({ ordered: false, start: 1, implied: true });
      this.target();
      return;
    }
    if (name === 'table') {
      if (this.table) {
        this.nested++;
        this.newline();
        return;
      }
      this.flushParagraph();
      this.flushItem();
      this.table = { rows: [], row: null, cell: null, head: false, after: [] };
      return;
    }
    if (!this.table) return;
    if (this.nested) {
      if (name === 'tr') this.newline();
      else if (name === 'td' || name === 'th') {
        const runs = this.target();
        if (runs && runs.length && !/\n$/.test(runs[runs.length - 1].text)) runs.push({ text: ' | ' });
      }
      return;
    }
    if (name === 'thead') this.table.head = true;
    else if (name === 'tbody' || name === 'tfoot') this.table.head = false;
    else if (name === 'tr') {
      this.closeRow();
      this.table.row = { cells: [], header: this.table.head };
    } else if (name === 'td' || name === 'th') {
      this.closeCell();
      if (!this.table.row) this.table.row = { cells: [], header: this.table.head };
      this.table.cell = { runs: [], colspan: Number(a.colspan) || 1, align: alignOf(a), th: name === 'th' };
    }
  }
  close(name) {
    if (INLINE[name]) {
      this.count[INLINE[name]] = Math.max(0, this.count[INLINE[name]] - 1);
      return;
    }
    if (name === 'a') {
      this.links.pop();
      return;
    }
    if (/^h[1-6]$/.test(name)) {
      if (this.table || this.item) {
        this.count.bold = Math.max(0, this.count.bold - 1);
        this.newline();
      } else {
        this.flushParagraph();
        this.heading = 0;
      }
      return;
    }
    if (name === 'blockquote') {
      this.boundary();
      this.quote = Math.max(0, this.quote - 1);
      return;
    }
    if (BLOCKS.has(name)) {
      this.boundary();
      if (!this.table && !this.item) this.align = undefined;
      return;
    }
    if (name === 'ul' || name === 'ol') {
      if (this.table) {
        this.cellLists = Math.max(0, this.cellLists - 1);
        this.newline();
        return;
      }
      this.flushItem();
      this.lists.pop();
      return;
    }
    if (name === 'li') {
      if (this.table) this.newline();
      else this.flushItem();
      return;
    }
    if (!this.table) return;
    if (this.nested) {
      if (name === 'table') {
        this.nested--;
        this.newline();
      }
      return;
    }
    if (name === 'td' || name === 'th') this.closeCell();
    else if (name === 'tr') this.closeRow();
    else if (name === 'thead') this.table.head = false;
    else if (name === 'table') this.closeTable();
  }
  end() {
    if (this.table) this.closeTable();
    this.flushParagraph();
    this.flushItem();
  }
}

export function htmlToBlocks(buf, out) {
  const src = decodeText(buf);
  const title = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(src);
  if (title) out.title = decodeHtml(title[1]).replace(/\s+/g, ' ').trim() || null;
  const h = new HtmlReader(out);
  const len = src.length;
  let i = 0;
  while (i < len) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      h.text(src.slice(i));
      break;
    }
    if (lt > i) h.text(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? len : e + 3;
      continue;
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const e = src.indexOf('>', lt);
      i = e < 0 ? len : e + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(src.slice(lt, lt + 64));
    if (!m) {
      h.text('<');
      i = lt + 1;
      continue;
    }
    // The end of the tag, with > inside quoted attribute values skipped.
    let j = lt + m[0].length;
    let quote = '';
    for (; j < len; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    const inner = src.slice(lt + m[0].length, j);
    i = j + 1;
    const name = m[2].toLowerCase();
    if (m[1]) {
      h.close(name);
      continue;
    }
    if (SKIP.has(name) && !/\/\s*$/.test(inner)) {
      const re = new RegExp(`</${name}\\s*>`, 'ig');
      re.lastIndex = i;
      const e = re.exec(src);
      if (e) i = e.index + e[0].length;
      else if (name === 'script' || name === 'style') i = len;
      continue;
    }
    if (name === 'pre') {
      const re = /<\/pre\s*>/ig;
      re.lastIndex = i;
      const e = re.exec(src);
      const raw = src.slice(i, e ? e.index : len);
      i = e ? e.index + e[0].length : len;
      const text = decodeHtml(raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/^\n/, '').replace(/\s+$/, '');
      if (text) h.code(text);
      continue;
    }
    h.open(name, parseAttrs(inner));
  }
  h.end();
}
