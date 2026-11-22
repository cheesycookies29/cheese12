// PDF Studio (0.66): Rich Text (.rtf) documents — from Word, WordPad, macOS TextEdit and others — to
// the block model of server/pdf/layout.js. A tokenizer reads control words, symbols, groups and text;
// the reader keeps formatting per group and turns paragraphs, lists, tables, links and JPEG or PNG
// pictures into blocks. Destinations a PDF does not show (font and colour tables, headers and
// footers, footnotes, comments, document variables, embedded objects) are read past without
// keeping their text. Outlook's HTML wrapped in RTF (\fromhtml1) is unwrapped and read as HTML.
import { MAX_ROWS, fail, makeRun, isMonoFont } from './office-core.js';
import { htmlToBlocks } from './office-text.js';

// Whether a file is Rich Text: it starts with "{\rtf" (after a byte-order mark or blank space).
export function isRtf(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf ?? '').slice(0, 64), 'latin1');
  let i = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < 64 && (b[i] === 0x20 || b[i] === 0x0d || b[i] === 0x0a || b[i] === 0x09)) i++;
  return b.subarray(i, i + 5).toString('latin1') === '{\\rtf';
}

const MAX_DEPTH = 4000;
const MAX_PICT = 48 * 1024 * 1024; // hex digits of one picture

// Destinations whose text is never shown.
const SKIP = new Set([
  'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'annotation', 'atnid', 'atnauthor',
  'atndate', 'atnref', 'xe', 'tc', 'tcn', 'txe', 'rxe', 'template', 'filetbl', 'revtbl', 'rsidtbl', 'pgdsctbl', 'objdata', 'objclass',
  'objname', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'mmathPr', 'generator', 'fldtype', 'bkmkstart',
  'bkmkend', 'nonshppict', 'pn', 'pntxta', 'pntxtb', 'protusertbl', 'userprops', 'docvar', 'do', 'shp', 'NeXTGraphic',
  'leveltext', 'levelnumbers', 'listname', 'falt', 'panose', 'fname', 'expandedcolortbl', 'passwordhash', 'password', 'wgrffmtfilter',
  'pgptbl', 'ftnsep', 'ftnsepc', 'ftncn', 'aftnsep', 'aftnsepc', 'aftncn', 'ud', 'upr', 'macpict', 'sp', 'sn', 'sv', 'svb', 'blipuid',
]);
// Text of the document properties ({\info …}) that is not the title.
const INFO = new Set(['author', 'operator', 'keywords', 'comment', 'doccomm', 'subject', 'company', 'manager', 'category', 'creatim',
  'revtim', 'printim', 'buptim', 'hlinkbase', 'version', 'vern', 'edmins', 'nofpages', 'nofwords', 'nofchars', 'nofcharsws', 'id']);
// Code pages of the font character sets.
const CHARSETS = { 0: 0, 1: 0, 2: 'symbol', 77: 10000, 128: 932, 129: 949, 130: 1361, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250, 255: 437 };
const ENCODINGS = { 437: 'ibm866', 708: 'iso-8859-6', 850: 'windows-1252', 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 1361: 'euc-kr' };
const decoders = new Map();
function decoder(cp) {
  const label = ENCODINGS[cp] || (cp >= 1250 && cp <= 1258 ? `windows-${cp}` : 'windows-1252');
  if (!decoders.has(label)) {
    let d;
    try {
      d = new TextDecoder(label);
    } catch {
      d = new TextDecoder('latin1');
    }
    decoders.set(label, d);
  }
  return decoders.get(label);
}
const SYMBOLS = { emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ', zwj: '‍', zwnj: '‌', ltrmark: '', rtlmark: '', zwbo: '', zwnbo: '' };
const ALIGN = { ql: 'left', qc: 'center', qr: 'right', qj: 'justify', qd: 'justify' };

// The tokens of an RTF file, one at a time: { t: '{' | '}' | 'word' | 'hex' | 'text' | 'bin', … }.
function* tokens(src) {
  const len = src.length;
  let i = 0;
  while (i < len) {
    const c = src[i];
    if (c === 0x7b) { i++; yield { t: '{' }; continue; }
    if (c === 0x7d) { i++; yield { t: '}' }; continue; }
    if (c === 0x5c) {
      const d = src[i + 1];
      if (d === undefined) break;
      if ((d >= 0x61 && d <= 0x7a) || (d >= 0x41 && d <= 0x5a)) {
        let j = i + 1;
        while (j < len && j - i <= 32 && ((src[j] >= 0x61 && src[j] <= 0x7a) || (src[j] >= 0x41 && src[j] <= 0x5a))) j++;
        const word = src.toString('latin1', i + 1, j);
        let k = j;
        if (src[k] === 0x2d) k++;
        while (k < len && k - j <= 11 && src[k] >= 0x30 && src[k] <= 0x39) k++;
        let param = null;
        if (k > j && !(k === j + 1 && src[j] === 0x2d)) param = Number(src.toString('latin1', j, k));
        else k = j;
        if (src[k] === 0x20) k++;
        i = k;
        if (word === 'bin' && param > 0) {
          const n = Math.min(param, len - i);
          yield { t: 'bin', data: src.subarray(i, i + n) };
          i += n;
          continue;
        }
        yield { t: 'word', w: word, p: param };
        continue;
      }
      if (d === 0x27) {
        const h = parseInt(src.toString('latin1', i + 2, i + 4), 16);
        i += 4;
        if (Number.isFinite(h)) yield { t: 'hex', b: h };
        continue;
      }
      i += 2;
      if (d === 0x0a || d === 0x0d) yield { t: 'word', w: 'par', p: null };
      else yield { t: 'word', w: String.fromCharCode(d), p: null, symbol: true };
      continue;
    }
    if (c === 0x0d || c === 0x0a) { i++; continue; }
    let j = i;
    while (j < len && src[j] !== 0x7b && src[j] !== 0x7d && src[j] !== 0x5c && src[j] !== 0x0d && src[j] !== 0x0a) j++;
    yield { t: 'text', s: src.subarray(i, j) };
    i = j;
  }
}

const freshChar = () => ({ bold: false, italic: false, underline: false, hidden: false, size: 0, color: 0, font: -1 });
const freshPara = () => ({ align: undefined, style: 0, outline: undefined, list: 0, ilvl: 0, intbl: false });

class Reader {
  constructor(out) {
    this.out = out;
    this.codepage = 1252;
    this.defaultFont = 0;
    this.fonts = new Map();
    this.colors = [];
    this.styles = new Map();
    this.lists = new Map(); // listid → [ordered by level]
    this.overrides = new Map(); // ls → listid
    this.title = null;
    this.state = { dest: 'body', char: freshChar(), para: freshPara(), uc: 1, link: null, field: null };
    this.stack = [];
    this.depth = 0;
    this.pending = [];
    this.skipChars = 0;
    // The paragraph being read, the table being read, and pictures waiting for the table to end.
    this.runs = [];
    this.hint = null;
    this.table = null;
    this.rowDef = { cells: [], header: false, merge: null };
    this.cell = [];
    this.html = null;
    this.htmlParts = [];
    this.lostPictures = 0;
    this.shapes = 0;
    this.nextGraphics = 0;
  }

  // ---- text ----------------------------------------------------------------------------------
  flushBytes() {
    if (!this.pending.length) return;
    const bytes = Buffer.from(this.pending);
    this.pending = [];
    const font = this.fonts.get(this.state.char.font >= 0 ? this.state.char.font : this.defaultFont);
    let s;
    if (font?.cp === 'symbol') s = bytes.toString('latin1').replace(/·/g, '•');
    else s = decoder(font?.cp || this.codepage).decode(bytes);
    this.text(s);
  }
  byte(b) {
    if (this.skipChars > 0) {
      this.skipChars--;
      return;
    }
    this.pending.push(b);
  }
  text(s) {
    if (!s) return;
    const st = this.state;
    switch (st.dest) {
      case 'body': {
        if (this.html !== null) {
          if (!st.htmlrtf) this.htmlParts.push(s);
          return;
        }
        if (st.char.hidden) return;
        const c = st.char;
        const color = c.color ? this.colors[c.color] : null;
        const f = { bold: c.bold, italic: c.italic, underline: c.underline, size: c.size || undefined, color: color || undefined, link: st.link || undefined, mono: isMonoFont(this.fonts.get(c.font)?.name) || undefined };
        const last = this.runs[this.runs.length - 1];
        const run = makeRun(s, f);
        if (last && sameRun(last, run)) last.text += s;
        else this.runs.push(run);
        return;
      }
      case 'htmltag': this.htmlParts.push(s); return;
      case 'fonttbl': if (st.fontId !== undefined) {
        const f = this.fonts.get(st.fontId) || {};
        f.name = (f.name || '') + s;
        this.fonts.set(st.fontId, f);
      } return;
      case 'stylesheet': st.styleName = (st.styleName || '') + s; return;
      case 'colortbl': if (s.includes(';')) for (const _ of s.match(/;/g)) {
        this.colors.push(st.rgb && st.rgb.some((v) => v > 0) ? st.rgb.map((v) => Math.round((v / 255) * 1000) / 1000) : null);
        st.rgb = [0, 0, 0];
      } return;
      case 'title': this.title = ((this.title || '') + s).slice(0, 500); return;
      case 'fldinst': if (st.field && st.field.code.length < 4096) st.field.code += s; return;
      case 'listtext': this.hint = (this.hint || '') + s; return;
      default:
    }
  }

  // ---- blocks --------------------------------------------------------------------------------
  // The end of a paragraph (\par, \cell, the end of the file).
  endParagraph(how = 'par') {
    this.flushBytes();
    const runs = this.runs;
    this.runs = [];
    const hint = this.hint;
    this.hint = null;
    if (this.html !== null) return;
    const p = this.state.para;
    if (p.intbl || how === 'cell') {
      if (!this.table) this.table = { rows: [], cells: [], images: [] };
      if (runs.some((r) => r.text.trim())) {
        if (this.cell.length) this.cell.push({ text: '\n' });
        if (hint && /\S/.test(hint)) this.cell.push({ text: /^\s*[(]?(\d+|[a-z]{1,3})[.)]/i.test(hint) ? `${hint.trim()} ` : '• ' });
        this.cell.push(...runs);
      }
      if (how === 'cell') {
        this.table.cells.push({ runs: this.cell });
        this.cell = [];
      }
      return;
    }
    this.flushTable();
    if (p.breakBefore) this.out.pageBreak();
    const style = this.styles.get(p.style) || {};
    const level = p.outline !== undefined && p.outline < 9 ? p.outline + 1 : style.level;
    if (!runs.some((r) => r.text.trim())) {
      this.out.paragraph([]);
      return;
    }
    if (level) this.out.heading(Math.min(4, level), runs.map((r) => makeRun(r.text, { ...r, bold: false, size: undefined })));
    else if (hint !== null || p.list) {
      const nfc = this.lists.get(this.overrides.get(p.list))?.[p.ilvl];
      const ordered = hint !== null && /\S/.test(hint) ? /^\s*[(]?(\d+|[a-z]{1,3})[.)]/i.test(hint) && !/^\s*[•·o§]\s*$/.test(hint) : !!nfc?.ordered;
      this.out.listItem(ordered, runs, Math.min(4, p.ilvl || 0), nfc?.start ?? 1);
    } else this.out.paragraph(runs, { align: p.align });
  }
  endRow() {
    if (!this.table) this.table = { rows: [], cells: [], images: [] };
    if (this.runs.some((r) => r.text.trim())) this.endParagraph('cell');
    const defs = this.rowDef.cells;
    const cells = [];
    this.table.cells.forEach((c, i) => {
      const def = defs[i] || {};
      const prev = cells[cells.length - 1];
      if (def.merge === 'cont' && prev) prev.colspan = (prev.colspan || 1) + 1;
      else cells.push(c);
    });
    this.table.cells = [];
    this.cell = [];
    if (this.table.rows.length >= MAX_ROWS) {
      this.out.warn(`A table had more than ${MAX_ROWS.toLocaleString('en-US')} rows: only the first ${MAX_ROWS.toLocaleString('en-US')} were kept.`);
      return;
    }
    if (cells.length) this.table.rows.push(this.rowDef.header && !this.table.rows.some((r) => !r.header) ? { header: true, cells } : { cells });
  }
  flushTable() {
    const t = this.table;
    if (!t) return;
    this.table = null;
    if (t.cells.length) t.rows.push({ cells: t.cells });
    if (t.rows.length) {
      const width = Math.max(...t.rows.map((r) => r.cells.reduce((n, c) => n + (c.colspan || 1), 0)));
      for (const r of t.rows) {
        const w = r.cells.reduce((n, c) => n + (c.colspan || 1), 0);
        for (let k = w; k < width; k++) r.cells.push({ runs: [] });
      }
      this.out.add({ type: 'table', rows: t.rows });
    }
    for (const img of t.images) this.out.add(img);
  }
  picture(st) {
    const pict = st.pict;
    if (!pict.type) {
      this.out.unreadablePictures++;
      return;
    }
    let data = pict.bin;
    if (!data) {
      const hex = pict.hex.join('').replace(/[^0-9a-fA-F]/g, '');
      data = Buffer.from(hex.length % 2 ? hex.slice(0, -1) : hex, 'hex');
    }
    const sx = (pict.scalex || 100) / 100;
    const sy = (pict.scaley || 100) / 100;
    const width = pict.wgoal > 0 ? (pict.wgoal * sx) / 20 : undefined;
    const height = pict.hgoal > 0 ? (pict.hgoal * sy) / 20 : undefined;
    if (this.html !== null) return;
    const img = this.out.image(data, width && height ? { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 } : {});
    if (!img) return;
    if (this.state.para.intbl || this.table) {
      if (!this.table) this.table = { rows: [], cells: [], images: [] };
      this.table.images.push(img);
      return;
    }
    this.flushBytes();
    if (this.runs.some((r) => r.text.trim())) this.out.paragraph(this.runs, { align: this.state.para.align });
    this.runs = [];
    this.out.add(img);
  }

  // ---- groups and control words ---------------------------------------------------------------
  open() {
    this.flushBytes();
    this.skipChars = 0;
    this.depth++;
    if (this.depth > MAX_DEPTH) return;
    const st = this.state;
    this.stack.push(st);
    this.state = { ...st, char: { ...st.char }, para: st.para, paraOwn: false, first: true, starred: false };
  }
  close() {
    this.flushBytes();
    this.skipChars = 0;
    if (this.depth > MAX_DEPTH) {
      this.depth--;
      return;
    }
    this.depth--;
    const st = this.state;
    const parent = this.stack.pop();
    if (!parent) return;
    if (st.dest === 'pict' && st.pict && parent.dest !== 'pict') this.picture(st);
    if (st.dest === 'stylesheet' && st.styleId !== undefined && parent.dest === 'stylesheet') this.saveStyle(st);
    if (st.dest === 'stylesheet' && parent.dest !== 'stylesheet' && st.styleId !== undefined) this.saveStyle(st);
    if (st.dest === 'list' && parent.dest === 'listtable' && st.listId !== undefined) this.lists.set(st.listId, st.levels || []);
    if (st.dest === 'listlevel' && parent.dest === 'list') (parent.levels ||= []).push({ ordered: st.nfc !== 23 && st.nfc !== 255, start: st.start ?? 1 });
    if (st.dest === 'listoverride' && st.ls !== undefined) this.overrides.set(st.ls, st.listId);
    this.state = parent;
    // TextEdit follows a picture's group with a placeholder character, which is not shown.
    if (st.attachment && !parent.attachment) this.skipChars = 1;
  }
  saveStyle(st) {
    const name = (st.styleName || '').replace(/;\s*$/, '').trim();
    const m = /^heading\s*([1-9])$/i.exec(name);
    let level = m ? Number(m[1]) : /^title$/i.test(name) ? 1 : undefined;
    if (!level && st.styleOutline !== undefined && st.styleOutline < 9) level = st.styleOutline + 1;
    this.styles.set(st.styleId, { name, level });
    st.styleName = '';
  }
  destination(word) {
    const st = this.state;
    if (st.dest === 'skip') return true;
    switch (word) {
      case 'fonttbl': case 'colortbl': case 'stylesheet': case 'info': case 'listtable': case 'listoverridetable':
        st.dest = word === 'listoverridetable' ? 'listoverridetable' : word;
        if (word === 'colortbl') st.rgb = [0, 0, 0];
        return true;
      case 'list': if (st.dest === 'listtable') { st.dest = 'list'; return true; } break;
      case 'listlevel': if (st.dest === 'list') { st.dest = 'listlevel'; return true; } break;
      case 'listoverride': if (st.dest === 'listoverridetable') { st.dest = 'listoverride'; return true; } break;
      case 'title': if (st.dest === 'info') { st.dest = 'title'; this.title = ''; return true; } break;
      case 'pict': st.dest = 'pict'; st.pict = { hex: [], hexLen: 0, type: null }; return true;
      case 'shppict': return true; // the Word 97+ picture: read
      case 'field': st.field = { code: '' }; return true;
      case 'fldinst': st.dest = 'fldinst'; return true;
      case 'fldrslt': {
        const m = /^\s*HYPERLINK\s+(?:\\[a-z]\s+)*"?([^"\s]+)"?/i.exec(st.field?.code || '');
        if (m) st.link = m[1];
        return true;
      }
      case 'listtext': case 'pntext': st.dest = 'listtext'; this.hint = ''; return true;
      case 'htmltag': if (this.html !== null) { st.dest = 'htmltag'; return true; } break;
      case 'mhtmltag': if (this.html !== null) { st.dest = 'skip'; return true; } break;
      case 'shp': this.shapes++; st.dest = 'skip'; return true;
      case 'NeXTGraphic': this.nextGraphics++; st.dest = 'skip'; st.attachment = true; return true;
      case 'object': return true; // its \result is shown, its data skipped
      case 'result': return true;
      default:
    }
    if (st.dest === 'info' && INFO.has(word)) {
      st.dest = 'skip';
      return true;
    }
    if (SKIP.has(word) || st.starred) {
      st.dest = 'skip';
      return true;
    }
    return false;
  }
  word(w, p) {
    const st = this.state;
    if (st.first) {
      st.first = false;
      if (w === '*') {
        st.starred = true;
        st.first = true;
        return;
      }
      if (this.destination(w)) return;
      if (st.starred) {
        st.dest = 'skip';
        return;
      }
    }
    if (st.dest === 'skip') return;
    if (this.skipChars > 0 && w !== 'u') {
      this.skipChars--;
      return;
    }
    const on = p === null || p !== 0;
    const c = st.char;
    const para = () => {
      if (!st.paraOwn) {
        st.para = { ...st.para };
        st.paraOwn = true;
      }
      return st.para;
    };
    switch (st.dest) {
      case 'fonttbl':
        if (w === 'f') st.fontId = p;
        else if (w === 'fcharset' && st.fontId !== undefined) this.fonts.set(st.fontId, { ...(this.fonts.get(st.fontId) || {}), cp: CHARSETS[p] || 0 });
        else if (w === 'fmodern' && st.fontId !== undefined) this.fonts.set(st.fontId, { ...(this.fonts.get(st.fontId) || {}), modern: true });
        else if (w === 'cpg' && st.fontId !== undefined && p > 0) this.fonts.set(st.fontId, { ...(this.fonts.get(st.fontId) || {}), cp: p });
        return;
      case 'colortbl':
        if (w === 'red') st.rgb[0] = p;
        else if (w === 'green') st.rgb[1] = p;
        else if (w === 'blue') st.rgb[2] = p;
        return;
      case 'stylesheet':
        if (w === 's') st.styleId = p;
        else if (w === 'cs' || w === 'ds' || w === 'ts') st.styleId = undefined;
        else if (w === 'outlinelevel') st.styleOutline = p;
        return;
      case 'listlevel':
        if (w === 'levelnfc') st.nfc = p;
        else if (w === 'levelstartat') st.start = p;
        return;
      case 'list': if (w === 'listid') st.listId = p; return;
      case 'listoverride': if (w === 'listid') st.listId = p; else if (w === 'ls') st.ls = p; return;
      case 'pict': {
        const pict = st.pict;
        if (w === 'pngblip') pict.type = 'png';
        else if (w === 'jpegblip') pict.type = 'jpeg';
        else if (['emfblip', 'wmetafile', 'macpict', 'dibitmap', 'wbitmap', 'pmmetafile'].includes(w)) pict.type = null;
        else if (w === 'picwgoal') pict.wgoal = p;
        else if (w === 'pichgoal') pict.hgoal = p;
        else if (w === 'picscalex') pict.scalex = p;
        else if (w === 'picscaley') pict.scaley = p;
        return;
      }
      case 'info': case 'listtable': case 'listoverridetable': return;
      default:
    }
    switch (w) {
      // Document
      case 'ansicpg': if (p > 0) this.codepage = p; return;
      case 'mac': this.codepage = 10000; return;
      case 'pc': this.codepage = 437; return;
      case 'pca': this.codepage = 850; return;
      case 'deff': this.defaultFont = p ?? 0; return;
      case 'fromhtml': if (on && this.html === null) this.html = ''; return;
      case 'htmlrtf': st.htmlrtf = on; return;
      // Characters
      case 'u': {
        this.flushBytes();
        const code = p < 0 ? p + 65536 : p;
        if (this.html !== null && st.htmlrtf) { /* RTF-only text */ } else this.text(String.fromCharCode(code & 0xffff));
        this.skipChars = st.uc;
        return;
      }
      case 'uc': st.uc = Math.max(0, Math.min(p ?? 1, 8)); return;
      case 'par': case 'sect':
        if (this.html !== null) {
          if (!st.htmlrtf || st.dest === 'htmltag') this.htmlParts.push('\r\n');
          return;
        }
        this.endParagraph();
        return;
      case 'line': case 'softline': this.flushBytes(); this.text(this.html !== null ? '\r\n' : '\n'); return;
      case 'tab': this.flushBytes(); this.text('\t'); return;
      case 'page':
        if (this.html !== null) return;
        this.flushBytes();
        if (this.state.para.intbl || this.table) return;
        if (this.runs.some((r) => r.text.trim())) this.endParagraph();
        this.out.pageBreak();
        return;
      case '~': this.flushBytes(); this.text('\u00a0'); return;
      case '_': this.flushBytes(); this.text('-'); return;
      case '-': return;
      case '\\': case '{': case '}': this.flushBytes(); this.text(w); return;
      case 'plain': Object.assign(c, freshChar()); return;
      case 'b': c.bold = on; return;
      case 'i': c.italic = on; return;
      case 'ul': case 'uld': case 'uldash': case 'uldashd': case 'uldashdd': case 'uldb': case 'ulhwave': case 'ulldash': case 'ulth': case 'ulw': case 'ulwave': case 'ulthd': case 'ulthdash': c.underline = on; return;
      case 'ulnone': c.underline = false; return;
      case 'v': c.hidden = on; return;
      case 'fs': if (p > 0) c.size = p / 2; return;
      case 'cf': c.color = p || 0; return;
      case 'f': this.flushBytes(); c.font = p ?? -1; return;
      // Paragraphs
      case 'pard': st.para = freshPara(); st.paraOwn = true; return;
      case 'ql': case 'qc': case 'qr': case 'qj': case 'qd': para().align = ALIGN[w]; return;
      case 's': para().style = p ?? 0; return;
      case 'outlinelevel': para().outline = p; return;
      case 'ls': para().list = p; return;
      case 'ilvl': para().ilvl = p ?? 0; return;
      case 'intbl': para().intbl = true; return;
      case 'pagebb': para().breakBefore = on; return;
      case 'itap': para().intbl = p > 0; return;
      // Tables
      case 'trowd': this.rowDef = { cells: [], header: false, merge: null }; return;
      case 'trhdr': this.rowDef.header = true; return;
      case 'clmgf': this.rowDef.merge = 'first'; return;
      case 'clmrg': this.rowDef.merge = 'cont'; return;
      case 'cellx': this.rowDef.cells.push({ merge: this.rowDef.merge }); this.rowDef.merge = null; return;
      case 'cell': this.endParagraph('cell'); return;
      case 'row': this.endRow(); return;
      case 'nestcell': this.flushBytes(); this.text(' | '); return;
      case 'nestrow': this.flushBytes(); this.text('\n'); return;
      default:
        if (SYMBOLS[w] !== undefined) {
          this.flushBytes();
          this.text(SYMBOLS[w]);
        }
    }
  }

  run(src) {
    for (const tok of tokens(src)) {
      if (this.depth > MAX_DEPTH && tok.t !== '{' && tok.t !== '}') continue;
      switch (tok.t) {
        case '{': this.open(); break;
        case '}': this.close(); if (this.depth <= 0) return; break;
        case 'word': if (tok.symbol && !['\\', '{', '}', '~', '_', '-', '*'].includes(tok.w)) { this.state.first = false; break; } this.flushBytes(); this.word(tok.w, tok.p); break;
        case 'hex': {
          const st = this.state;
          st.first = false;
          if (st.dest === 'skip') break;
          if (st.dest === 'pict') break;
          this.byte(tok.b);
          break;
        }
        case 'bin': {
          const st = this.state;
          st.first = false;
          this.flushBytes();
          if (st.dest === 'pict' && st.pict) st.pict.bin = tok.data;
          break;
        }
        case 'text': {
          const st = this.state;
          st.first = false;
          if (st.dest === 'skip') break;
          if (st.dest === 'pict') {
            if (st.pict.hexLen < MAX_PICT) {
              st.pict.hex.push(tok.s.toString('latin1'));
              st.pict.hexLen += tok.s.length;
            }
            break;
          }
          for (const b of tok.s) this.byte(b);
          break;
        }
        default:
      }
    }
  }
  finish() {
    this.flushBytes();
    while (this.stack.length) this.close();
    if (this.html !== null) {
      htmlToBlocks(this.htmlParts.join(''), this.out);
      return;
    }
    if (this.runs.some((r) => r.text.trim())) this.endParagraph();
    else if (this.table && this.table.cells.length) this.endRow();
    this.flushTable();
    const title = (this.title || '').replace(/\s+/g, ' ').trim();
    if (title) this.out.title = title;
    if (this.shapes) this.out.warn('Shapes, text boxes and pictures that float over the text are left out.');
    if (this.nextGraphics) this.out.warn('Pictures of a TextEdit document are kept outside the .rtf file (in an .rtfd folder), so they were left out.');
  }
}
const sameRun = (a, b) => a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.mono === b.mono && a.size === b.size && a.link === b.link && String(a.color) === String(b.color);

export function rtfToBlocks(buf, out) {
  const src = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf ?? ''), 'latin1');
  if (!isRtf(src)) fail('This file is not a Rich Text document CORE can read: it may be damaged, or be another kind of file with the wrong name.');
  const r = new Reader(out);
  r.run(src.subarray(src.indexOf(0x7b)));
  r.finish();
}
