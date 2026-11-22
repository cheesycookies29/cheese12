// PDF Studio (0.66): the older binary Office formats to the block model of server/pdf/layout.js —
// Word 97–2003 (.doc), Excel 97–2003 (.xls, BIFF8) and PowerPoint 97–2003 (.ppt). Each is a compound
// file (server/pdf/office-cfb.js) whose streams are read here, record by record, with every offset
// checked against the stream it points into. What a PDF cannot show plainly (headers and footers,
// footnotes, comments, charts, speaker notes, shapes that float over the text) is left out with a
// warning; text that was deleted with "track changes" on stays deleted.
import { MAX_ROWS, fail, makeRun, sheetTable, blockHasContent, sniffImage } from './office-core.js';
import { formatExcel, BUILTIN_CODES } from './xlsx-format.js';
import { plainNumber } from './office-ooxml.js';

const PASSWORD = (label, app, ext) => `${label} is protected with a password: open it in ${app}, remove the password, save it (as ${ext} if you can) and upload it again.`;

// Windows-1252, the code page of 8-bit text in these files.
const CP1252 = (() => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  try {
    return new TextDecoder('windows-1252').decode(all);
  } catch {
    return Buffer.from(all).toString('latin1');
  }
})();
const decode8 = (buf, start, end) => {
  let s = '';
  for (let i = start; i < end; i++) s += CP1252[buf[i]];
  return s;
};
// A stream as a buffer, or null when the file does not have it. A stream the document cannot do
// without (no `out`) that is damaged stops with the reason; any other is left out with a warning.
function stream(cfb, name, out) {
  if (!cfb.has(name)) return null;
  if (!out) return cfb.read(name);
  try {
    return cfb.read(name);
  } catch {
    out.warn(`A part of this file (${name.replace(/[\u0000-\u001f]/g, '')}) could not be read and was left out.`);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Document properties (the "\x05SummaryInformation" property set): the title, when there is one.

export function propertyTitle(cfb) {
  try {
    const b = stream(cfb, '\u0005SummaryInformation');
    if (!b || b.length < 48 || b.readUInt16LE(0) !== 0xfffe) return null;
    const sec = b.readUInt32LE(44);
    if (sec + 8 > b.length) return null;
    const count = Math.min(b.readUInt32LE(sec + 4), 200);
    let codepage = 1252;
    let title = null;
    for (let i = 0; i < count; i++) {
      const at = sec + 8 + i * 8;
      if (at + 8 > b.length) break;
      const pid = b.readUInt32LE(at);
      const off = sec + b.readUInt32LE(at + 4);
      if (off + 8 > b.length) continue;
      const type = b.readUInt32LE(off);
      if (pid === 1 && type === 2) codepage = b.readUInt16LE(off + 4);
      if (pid === 2 && (type === 0x1e || type === 0x1f)) title = { type, off };
    }
    if (!title) return null;
    const n = b.readUInt32LE(title.off + 4);
    const start = title.off + 8;
    let text;
    if (title.type === 0x1f || codepage === 1200) text = b.toString('utf16le', start, Math.min(b.length, start + n * 2));
    else if (codepage === 65001) text = b.toString('utf8', start, Math.min(b.length, start + n));
    else text = decode8(b, start, Math.min(b.length, start + n));
    text = text.replace(/\0[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
    return text || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Office drawing ("OfficeArt") records, where Word and PowerPoint keep their pictures. A picture
// ("blip") record holds the image bytes after one or two 16-byte ids and, for bitmaps, a tag byte.

const BITMAP_BLIPS = new Set([0xf01d, 0xf01e, 0xf01f, 0xf029, 0xf02a]);
const ALL_BLIPS = new Set([0xf01a, 0xf01b, 0xf01c, ...BITMAP_BLIPS]);

// The image in the blip record at `at`: { data } (data null when it is not JPEG or PNG), or null
// when there is no blip record there.
export function blipAt(buf, at, end = buf.length) {
  if (at < 0 || at + 8 > end) return null;
  const inst = buf.readUInt16LE(at) >> 4;
  const type = buf.readUInt16LE(at + 2);
  if (!ALL_BLIPS.has(type)) return null;
  const bodyEnd = Math.min(end, at + 8 + buf.readUInt32LE(at + 4));
  if (!BITMAP_BLIPS.has(type)) return { data: null };
  const skip = 16 * (inst & 1 ? 2 : 1) + 1;
  const data = buf.subarray(at + 8 + skip, bodyEnd);
  return { data: sniffImage(data) ? data : null };
}

// Every blip inside the records from start to end (containers opened, depth limited).
export function findBlips(buf, start, end, found = [], depth = 0) {
  let at = start;
  end = Math.min(end, buf.length);
  while (at + 8 <= end && depth < 16 && found.length < 1000) {
    const ver = buf.readUInt16LE(at) & 0xf;
    const type = buf.readUInt16LE(at + 2);
    const len = buf.readUInt32LE(at + 4);
    const bodyEnd = Math.min(end, at + 8 + len);
    if (type < 0xf000) break; // not a drawing record
    if (ver === 0xf) findBlips(buf, at + 8, bodyEnd, found, depth + 1);
    else if (type === 0xf007 && at + 8 + 36 <= bodyEnd) findBlips(buf, at + 8 + 36 + buf[at + 8 + 33], bodyEnd, found, depth + 1);
    else {
      const b = blipAt(buf, at, bodyEnd);
      if (b) found.push(b);
    }
    at = bodyEnd;
  }
  return found;
}

// =============================================================================================
// Word 97–2003 (.doc)

// Property modifiers ("sprms"): [opcode, operand offset, operand size] of a grpprl.
function sprms(g, from = 0) {
  const list = [];
  let i = from;
  while (i + 2 <= g.length && list.length < 2000) {
    const op = g.readUInt16LE(i);
    i += 2;
    let len;
    switch (op >> 13) {
      case 0: case 1: len = 1; break;
      case 2: case 4: case 5: len = 2; break;
      case 3: len = 4; break;
      case 7: len = 3; break;
      default:
        if (op === 0xd608 || op === 0xd606) len = i + 2 <= g.length ? g.readUInt16LE(i) + 1 : g.length;
        else if (op === 0xc615 && g[i] === 255) len = g.length; // tab changes with deleted tabs: the rest is skipped
        else len = (g[i] ?? 0) + 1;
    }
    if (i + len > g.length) break;
    list.push([op, i, len]);
    i += len;
  }
  return list;
}
const operand = (g, at, len) => (len === 1 ? g[at] : len === 2 ? g.readUInt16LE(at) : len === 4 ? g.readUInt32LE(at) : g[at]);

// Runs of a formatting table (CHPX or PAPX): [{ start, end, grpprl }] by file position, sorted.
function fkpRuns(wd, table, fc, lcb, papx) {
  const runs = [];
  if (!lcb || fc + lcb > table.length || lcb < 12) return runs;
  const n = Math.floor((lcb - 4) / 8);
  for (let k = 0; k < n && k < 65536; k++) {
    const pn = table.readUInt32LE(fc + (n + 1) * 4 + k * 4) & 0x3fffff;
    const page = wd.subarray(pn * 512, pn * 512 + 512);
    if (page.length < 512) continue;
    const crun = page[511];
    if (crun < 1 || (crun + 1) * 4 + crun * (papx ? 13 : 1) > 511) continue;
    for (let i = 0; i < crun; i++) {
      const start = page.readUInt32LE(i * 4);
      const end = page.readUInt32LE((i + 1) * 4);
      let grpprl = Buffer.alloc(0);
      let istd = 0;
      if (papx) {
        const off = page[(crun + 1) * 4 + i * 13] * 2;
        if (off) {
          const cb = page[off];
          const at = cb ? off + 1 : off + 2;
          const len = cb ? 2 * cb - 1 : 2 * page[off + 1];
          const data = page.subarray(at, Math.min(511, at + len));
          if (data.length >= 2) {
            istd = data.readUInt16LE(0);
            grpprl = data.subarray(2);
          }
        }
      } else {
        const off = page[(crun + 1) * 4 + i] * 2;
        if (off) grpprl = page.subarray(off + 1, Math.min(511, off + 1 + page[off]));
      }
      if (end > start) runs.push({ start, end, grpprl, istd });
    }
  }
  runs.sort((a, b) => a.start - b.start);
  return runs;
}
function findRun(runs, fc) {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = runs[mid];
    if (fc < r.start) hi = mid - 1;
    else if (fc >= r.end) lo = mid + 1;
    else return r;
  }
  return null;
}

// Character formatting of a CHPX run (cached on the run).
const ICO = [null, null, [0, 0, 1], [0, 1, 1], [0, 1, 0], [1, 0, 1], [1, 0, 0], [1, 1, 0], null, [0, 0, 0.5], [0, 0.5, 0.5], [0, 0.5, 0], [0.5, 0, 0.5], [0.5, 0, 0], [0.5, 0.5, 0], [0.5, 0.5, 0.5], [0.75, 0.75, 0.75]];
const NO_PROPS = Object.freeze({});
function charProps(run, fonts) {
  if (!run) return NO_PROPS;
  if (run.props) return run.props;
  const f = {};
  const g = run.grpprl;
  for (const [op, at, len] of sprms(g)) {
    const v = operand(g, at, len);
    switch (op) {
      case 0x0835: f.bold = v === 1 || v === 0x81; break;
      case 0x0836: f.italic = v === 1 || v === 0x81; break;
      case 0x2a3e: f.underline = v !== 0; break;
      case 0x083c: f.hidden = v === 1 || v === 0x81; break;
      case 0x0800: f.deleted = v === 1; break;
      case 0x0855: f.special = v === 1; break;
      case 0x6a03: f.pic = v; break;
      case 0x4a43: if (v > 0) f.size = v / 2; break;
      case 0x2a42: f.color = ICO[v] || null; break;
      case 0x6870: if (!(g[at + 3] & 0xff)) f.color = [g[at], g[at + 1], g[at + 2]].map((c) => Math.round((c / 255) * 1000) / 1000); break;
      case 0x4a4f: f.mono = !!fonts[v]?.mono; break;
      default:
    }
  }
  run.props = f;
  return f;
}
// Paragraph properties of a PAPX run.
function paraProps(run) {
  if (!run) return { istd: 0 };
  if (run.props) return run.props;
  const p = { istd: run.istd };
  const g = run.grpprl;
  for (const [op, at, len] of sprms(g)) {
    const v = operand(g, at, len);
    switch (op) {
      case 0x2416: p.inTable = v !== 0; break;
      case 0x2417: p.ttp = v !== 0; break;
      case 0x6649: p.itap = v; break;
      case 0x244b: p.innerCell = v !== 0; break;
      case 0x244c: p.innerTtp = v !== 0; break;
      case 0x2403: case 0x2461: p.jc = v; break;
      case 0x2640: p.outline = v; break;
      case 0x460b: p.ilfo = v; break;
      case 0x260a: p.ilvl = v; break;
      case 0x3404: p.header = v !== 0; break;
      case 0x2407: p.breakBefore = v !== 0; break;
      default:
    }
  }
  run.props = p;
  return p;
}

// The styles (STSH): for each style index, its heading level and list, from its built-in id or
// name ("heading 2") or its outline level.
function wordStyles(table, fc, lcb) {
  const styles = [];
  if (!lcb || fc + lcb > table.length || lcb < 6) return styles;
  const end = fc + lcb;
  const cbStshi = table.readUInt16LE(fc);
  const cstd = table.readUInt16LE(fc + 2);
  const cbBase = table.readUInt16LE(fc + 4) || 10;
  let at = fc + 2 + cbStshi;
  for (let istd = 0; istd < cstd && istd < 4096 && at + 2 <= end; istd++) {
    const cbStd = table.readUInt16LE(at);
    const std = table.subarray(at + 2, Math.min(end, at + 2 + cbStd));
    at += 2 + cbStd;
    if (cbStd < 10 || std.length < cbStd) continue;
    const sti = std.readUInt16LE(0) & 0xfff;
    const stk = std.readUInt16LE(2) & 0xf;
    let p = cbBase;
    let name = '';
    if (p + 2 <= std.length) {
      const cch = std.readUInt16LE(p);
      name = std.toString('utf16le', p + 2, Math.min(std.length, p + 2 + cch * 2));
      p += 2 + cch * 2 + 2;
    }
    const s = { name };
    const m = /^heading\s*([1-9])$/i.exec(name.trim());
    if (sti >= 1 && sti <= 9) s.level = sti;
    else if (m) s.level = Number(m[1]);
    else if (sti === 62 || /^title$/i.test(name.trim())) s.level = 1;
    // A paragraph style's first property block is its paragraph properties.
    if (stk === 1 && p + 4 <= std.length) {
      if (p % 2) p++;
      const cb = std.readUInt16LE(p);
      const upx = std.subarray(p + 4, Math.min(std.length, p + 2 + cb));
      const props = paraProps({ istd, grpprl: upx });
      if (!s.level && props.outline !== undefined && props.outline < 9) s.level = props.outline + 1;
      if (props.ilfo) s.ilfo = props.ilfo;
      if (props.ilvl !== undefined) s.ilvl = props.ilvl;
    }
    styles[istd] = s;
  }
  return styles;
}

// Font names (SttbfFfn): which fonts are fixed-width.
function wordFonts(table, fc, lcb) {
  const fonts = [];
  if (!lcb || fc + lcb > table.length || lcb < 4) return fonts;
  const count = table.readUInt16LE(fc);
  let at = fc + 4;
  const end = fc + lcb;
  for (let i = 0; i < count && i < 4096 && at < end; i++) {
    const size = table[at] + 1;
    const ffn = table.subarray(at + 1, Math.min(end, at + size));
    at += size;
    if (ffn.length < 40) {
      fonts.push({});
      continue;
    }
    const name = ffn.toString('utf16le', 39, ffn.length - ((ffn.length - 39) % 2)).split('\0')[0];
    fonts.push({ mono: /courier|consolas|mono|lucida console|andale/i.test(name) || ((ffn[0] & 3) === 1 && /^(Fixedsys|Terminal)$/i.test(name)) });
  }
  return fonts;
}

// Lists: for each list format override (ilfo, from 1), whether each level is numbered and where it
// starts. Bullets are levels whose number format is 23 (a bullet) or 255 (nothing).
function wordLists(table, fcLst, lcbLst, fcLfo, lcbLfo) {
  const byLsid = new Map();
  const lfos = [];
  try {
    if (lcbLst >= 2 && fcLst + lcbLst <= table.length) {
      const n = table.readInt16LE(fcLst);
      let at = fcLst + 2 + n * 28;
      const lists = [];
      for (let i = 0; i < n && i < 2048; i++) {
        const l = fcLst + 2 + i * 28;
        lists.push({ lsid: table.readInt32LE(l), simple: table[l + 26] & 1 });
      }
      // The levels follow the list table, in the same order (they may run past lcbLst).
      for (const l of lists) {
        const levels = [];
        for (let k = 0; k < (l.simple ? 1 : 9); k++) {
          if (at + 28 > table.length) break;
          const start = table.readInt32LE(at);
          const nfc = table[at + 4];
          const cbChpx = table[at + 24];
          const cbPapx = table[at + 25];
          at += 28 + cbPapx + cbChpx;
          if (at + 2 > table.length) break;
          at += 2 + table.readUInt16LE(at) * 2;
          levels.push({ ordered: nfc !== 23 && nfc !== 255, start });
        }
        byLsid.set(l.lsid, levels);
      }
    }
    if (lcbLfo >= 4 && fcLfo + lcbLfo <= table.length) {
      const n = table.readInt32LE(fcLfo);
      for (let i = 0; i < n && i < 2048 && fcLfo + 4 + i * 16 + 16 <= table.length; i++) lfos.push(byLsid.get(table.readInt32LE(fcLfo + 4 + i * 16)) || null);
    }
  } catch { /* lists stay bullets */ }
  return lfos;
}

// The URL in a HYPERLINK field code.
function fieldLink(code) {
  const m = /^\s*HYPERLINK\s+(?:\\[a-z]\s+)*"?([^"\s]+)"?/i.exec(code);
  return m ? m[1] : null;
}

export function docToBlocks(cfb, out, label) {
  const NOT_WORD = `${label} is not a Word document CORE can read: it may be damaged, or be another kind of file with the wrong name.`;
  const wd = stream(cfb, 'WordDocument');
  if (!wd || wd.length < 0x9a || wd.readUInt16LE(0) !== 0xa5ec) fail(NOT_WORD);
  const nFib = wd.readUInt16LE(2);
  const flags = wd.readUInt16LE(0x0a);
  if (flags & 0x0100) fail(PASSWORD(label, 'Word', '.docx'));
  if (nFib < 0xc1) fail(`${label} was saved by Word 95 or older, which CORE cannot read. Open it in Word, save it as .docx and upload that copy.`);
  const table = stream(cfb, flags & 0x0200 ? '1Table' : '0Table');
  if (!table) fail(NOT_WORD);
  // The FIB: its counts (rgLw) and the positions of the tables in the Table stream (rgFcLcb).
  const csw = wd.readUInt16LE(0x20);
  const cslwAt = 0x22 + csw * 2;
  if (cslwAt + 2 > wd.length) fail(NOT_WORD);
  const cslw = wd.readUInt16LE(cslwAt);
  const lwAt = cslwAt + 2;
  const fcAt = lwAt + cslw * 4;
  if (fcAt + 2 > wd.length) fail(NOT_WORD);
  const cbRgFcLcb = wd.readUInt16LE(fcAt);
  const lw = (i) => (i < cslw && lwAt + i * 4 + 4 <= wd.length ? wd.readInt32LE(lwAt + i * 4) : 0);
  const fcLcb = (i) => (i < cbRgFcLcb && fcAt + 2 + i * 8 + 8 <= wd.length ? [wd.readUInt32LE(fcAt + 2 + i * 8), wd.readUInt32LE(fcAt + 2 + i * 8 + 4)] : [0, 0]);
  const ccpText = Math.max(0, lw(3));
  if (lw(4) > 0 || lw(8) > 0) out.warn('Footnotes and endnotes in older Word files are left out.');
  if (lw(7) > 0) out.warn('Comments are left out.');
  if (lw(9) > 0) out.warn('Text boxes in older Word files are left out.');

  // The piece table (CLX): where each stretch of text is in the WordDocument stream, and whether it
  // is stored as 8-bit (Windows-1252) or 16-bit characters.
  const [fcClx, lcbClx] = fcLcb(33);
  if (!lcbClx || fcClx + lcbClx > table.length) fail(NOT_WORD);
  let at = fcClx;
  const clxEnd = fcClx + lcbClx;
  let plc = null;
  while (at < clxEnd) {
    if (table[at] === 1 && at + 3 <= clxEnd) at += 3 + table.readUInt16LE(at + 1);
    else if (table[at] === 2 && at + 5 <= clxEnd) {
      const len = table.readUInt32LE(at + 1);
      if (at + 5 + len > table.length || len < 16) fail(NOT_WORD);
      plc = { start: at + 5, n: Math.floor((len - 4) / 12) };
      break;
    } else fail(NOT_WORD);
  }
  if (!plc) fail(NOT_WORD);
  // Every character takes at least one byte of the stream, so the stream's size bounds the text.
  const limit = Math.min(ccpText, 8 * 1024 * 1024, wd.length);
  if (ccpText > 8 * 1024 * 1024) out.warn('This document is very long: only its first part was kept.');
  const codes = new Uint16Array(limit);
  const fcs = new Uint32Array(limit);
  let cp = 0;
  for (let k = 0; k < plc.n && cp < limit; k++) {
    const cpStart = table.readUInt32LE(plc.start + k * 4);
    const cpEnd = table.readUInt32LE(plc.start + (k + 1) * 4);
    const raw = table.readUInt32LE(plc.start + (plc.n + 1) * 4 + k * 8 + 2);
    const compressed = (raw & 0x40000000) !== 0;
    const fc = compressed ? (raw & 0x3fffffff) / 2 : raw & 0x3fffffff;
    if (cpEnd <= cpStart || cpStart > cp) fail(NOT_WORD);
    for (let c = Math.max(cp, cpStart); c < cpEnd && cp < limit; c++) {
      const pos = fc + (c - cpStart) * (compressed ? 1 : 2);
      if (pos + (compressed ? 1 : 2) > wd.length) fail(NOT_WORD);
      codes[cp] = compressed ? CP1252.charCodeAt(wd[pos]) : wd.readUInt16LE(pos);
      fcs[cp] = pos;
      cp++;
    }
  }
  const textLength = cp;

  const [fcStshf, lcbStshf] = fcLcb(1);
  const [fcChpx, lcbChpx] = fcLcb(12);
  const [fcPapx, lcbPapx] = fcLcb(13);
  const [fcFfn, lcbFfn] = fcLcb(15);
  const [fcLst, lcbLst] = fcLcb(73);
  const [fcLfo, lcbLfo] = fcLcb(74);
  const styles = wordStyles(table, fcStshf, lcbStshf);
  const fonts = wordFonts(table, fcFfn, lcbFfn);
  const lists = wordLists(table, fcLst, lcbLst, fcLfo, lcbLfo);
  const chpx = fkpRuns(wd, table, fcChpx, lcbChpx, false);
  const papx = fkpRuns(wd, table, fcPapx, lcbPapx, true);
  const data = cfb.has('Data') ? stream(cfb, 'Data', out) : null;
  out.title = propertyTitle(cfb);

  let runs = [];
  let text = '';
  let fmt = {};
  let fmtProps = null;
  const flushText = () => {
    if (text) runs.push(makeRun(text, fmt));
    text = '';
  };
  const fields = [];
  let table_ = null; // { rows, cells, cell, images }
  let floating = 0;
  let dropped = 0;

  const flushTable = () => {
    if (!table_) return;
    const { rows, images } = table_;
    table_ = null;
    if (rows.length) {
      const width = Math.max(...rows.map((r) => r.cells.length));
      for (const r of rows) while (r.cells.length < width) r.cells.push({ runs: [] });
      out.add({ type: 'table', rows: rows.slice(0, MAX_ROWS) });
      if (rows.length > MAX_ROWS) out.warn(`A table had more than ${MAX_ROWS.toLocaleString('en-US')} rows: only the first ${MAX_ROWS.toLocaleString('en-US')} were kept.`);
    }
    for (const img of images) out.add(img);
  };
  const picture = (props) => {
    if (!data || !(props.pic >= 0) || props.pic + 0x44 > data.length) {
      dropped++;
      return null;
    }
    const lcb = data.readUInt32LE(props.pic);
    const cbHeader = data.readUInt16LE(props.pic + 4);
    const end = Math.min(data.length, props.pic + lcb);
    if (cbHeader < 0x44 || props.pic + cbHeader > end) {
      dropped++;
      return null;
    }
    let start = props.pic + cbHeader;
    if (data.readInt16LE(props.pic + 6) === 0x66) start += 1 + data[start];
    const blip = findBlips(data, start, end).find((b) => b.data) || null;
    if (!blip) {
      out.unreadablePictures++;
      return null;
    }
    const mx = data.readUInt16LE(props.pic + 0x20) || 1000;
    const my = data.readUInt16LE(props.pic + 0x22) || 1000;
    const width = (data.readInt16LE(props.pic + 0x1c) * mx) / 1000 / 20;
    const height = (data.readInt16LE(props.pic + 0x1e) * my) / 1000 / 20;
    return out.image(blip.data, width > 0 && height > 0 ? { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 } : {});
  };
  // A finished paragraph: in a table cell, or a heading, list item or paragraph of its own.
  const endParagraph = (fcMark, cellMark) => {
    flushText();
    const para = runs;
    runs = [];
    const p = paraProps(findRun(papx, fcMark));
    const style = styles[p.istd] || {};
    const inTable = p.inTable || p.itap > 0 || cellMark;
    if (inTable) {
      if (!table_) table_ = { rows: [], cells: [], cell: [], images: [] };
      const add = (more, sep) => {
        if (!more.some((r) => r.text.trim())) return;
        if (table_.cell.length) table_.cell.push({ text: table_.sep || sep });
        table_.sep = null;
        table_.cell.push(...more);
      };
      // Without paragraph formatting tables, a cell mark right after a cell mark ends the row.
      const rowEnd = p.ttp || (!papx.length && !para.length && table_.lastWasCell);
      table_.lastWasCell = cellMark && !rowEnd;
      if (cellMark && rowEnd) {
        // The end of a row: its cells are complete.
        if (table_.cells.length) table_.rows.push(p.header && !table_.rows.some((r) => !r.header) ? { header: true, cells: table_.cells } : { cells: table_.cells });
        table_.cells = [];
        table_.cell = [];
      } else if (cellMark) {
        add(para, '\n');
        table_.cells.push({ runs: table_.cell });
        table_.cell = [];
      } else if (p.itap > 1 && p.innerTtp) table_.sep = '\n'; // a table inside a cell: its rows on lines
      else if (p.itap > 1 && p.innerCell) add(para, ' | ');
      else add(para, '\n');
      return;
    }
    flushTable();
    if (p.breakBefore) out.pageBreak();
    const level = style.level;
    const ilfo = p.ilfo ?? style.ilfo;
    const ilvl = p.ilvl ?? style.ilvl ?? 0;
    if (level && para.some((r) => r.text.trim())) out.heading(Math.min(4, level), para.map((r) => ({ ...r, bold: undefined, size: undefined })).map((r) => makeRun(r.text, r)));
    else if (ilfo > 0 && ilfo !== 2047 && para.some((r) => r.text.trim())) {
      const lvl = lists[ilfo - 1]?.[ilvl] || lists[ilfo - 1]?.[0];
      out.listItem(!!lvl?.ordered, para, Math.min(4, ilvl), lvl?.start ?? 1);
    } else out.paragraph(para, { align: { 1: 'center', 2: 'right', 3: 'justify', 4: 'justify' }[p.jc] });
  };

  for (let i = 0; i < textLength; i++) {
    const ch = codes[i];
    // Fields: { code \x14 result \x15 }: the result is kept, a HYPERLINK makes it a link.
    if (ch === 0x13) {
      fields.push({ code: '', result: false, link: null });
      continue;
    }
    if (ch === 0x14 && fields.length) {
      const f = fields[fields.length - 1];
      f.result = true;
      f.link = fieldLink(f.code);
      continue;
    }
    if (ch === 0x15 && fields.length) {
      fields.pop();
      continue;
    }
    const inCode = fields.length ? fields.find((f) => !f.result) : null;
    if (inCode && ch !== 0x0d && ch !== 0x07) {
      if (inCode.code.length < 4096) inCode.code += String.fromCharCode(ch);
      continue;
    }
    const props = charProps(findRun(chpx, fcs[i]), fonts);
    if (ch === 0x0d || ch === 0x07) {
      endParagraph(fcs[i], ch === 0x07);
      continue;
    }
    if (props.deleted || props.hidden) continue;
    if (ch === 0x0c) {
      if (table_ && (table_.cells.length || table_.cell.length || paraProps(findRun(papx, fcs[i])).inTable)) continue;
      endParagraph(fcs[i], false);
      out.pageBreak();
      continue;
    }
    if (props.special && ch < 0x20) {
      if (ch === 0x01) {
        const img = picture(props);
        if (img) {
          const inTable = paraProps(findRun(papx, fcs[i])).inTable || (!papx.length && table_ && table_.cells.length);
          if (table_ && !inTable) flushTable();
          if (table_) table_.images.push(img);
          else {
            flushText();
            if (runs.some((r) => r.text.trim())) out.paragraph(runs);
            runs = [];
            out.add(img);
          }
        }
      } else if (ch === 0x08) floating++;
      continue;
    }
    let c = String.fromCharCode(ch);
    if (ch === 0x0b || ch === 0x0e) c = '\n';
    else if (ch === 0x1e) c = '-';
    else if (ch === 0x1f || ch === 0x01 || ch === 0x08) c = '';
    if (!c) continue;
    const link = fields.length ? fields.findLast((f) => f.link)?.link : undefined;
    if (props !== fmtProps || link !== fmt.link) {
      const next = { bold: props.bold, italic: props.italic, underline: props.underline, mono: props.mono, size: props.size, color: props.color, link };
      if (!sameFmt(fmt, next)) {
        flushText();
        fmt = next;
      }
      fmtProps = props;
    }
    text += c;
  }
  flushText();
  if (runs.length) endParagraph(-1, false);
  flushTable();
  if (floating) out.warn('Pictures and shapes that float over the text in older Word files are left out.');
  if (dropped) out.warn(dropped === 1 ? '1 picture could not be read and was left out.' : `${dropped} pictures could not be read and were left out.`);
  if (!out.blocks.some(blockHasContent)) out.warn('The document has no text.');
}
const sameFmt = (a, b) => a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.mono === b.mono && a.size === b.size && String(a.color) === String(b.color) && a.link === b.link;

// =============================================================================================
// Excel 97–2003 (.xls): the BIFF8 records of the Workbook stream.

// A record and the CONTINUE records after it, as one reader that knows where each part ends:
// a string whose characters run into the next part starts that part with a byte saying whether
// the rest is 8-bit or 16-bit.
const END = Symbol('end of record');
class Parts {
  constructor(parts) {
    this.s = parts;
    this.i = 0;
    this.p = 0;
  }
  next() {
    while (this.i < this.s.length && this.p >= this.s[this.i].length) {
      this.i++;
      this.p = 0;
    }
    if (this.i >= this.s.length) throw END;
  }
  u8() {
    this.next();
    return this.s[this.i][this.p++];
  }
  u16() {
    return this.u8() | (this.u8() << 8);
  }
  u32() {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n) {
    while (n > 0) {
      this.next();
      const k = Math.min(n, this.s[this.i].length - this.p);
      this.p += k;
      n -= k;
    }
  }
  chars(cch, high) {
    let s = '';
    let guard = 0;
    while (cch > 0) {
      if (++guard > 100000) throw END;
      if (this.i >= this.s.length) throw END;
      const seg = this.s[this.i];
      if (this.p >= seg.length) {
        this.i++;
        this.p = 0;
        if (this.i >= this.s.length || !this.s[this.i].length) throw END;
        high = this.s[this.i][this.p++] & 1;
        continue;
      }
      const room = high ? (seg.length - this.p) >> 1 : seg.length - this.p;
      const k = Math.min(cch, room);
      if (!k) {
        this.p = seg.length;
        continue;
      }
      s += high ? seg.toString('utf16le', this.p, this.p + 2 * k) : seg.toString('latin1', this.p, this.p + k);
      this.p += high ? 2 * k : k;
      cch -= k;
    }
    return s;
  }
  // An XLUnicodeString (cch 16-bit) or ShortXLUnicodeString (cch 8-bit); rich text and phonetic
  // parts are skipped.
  string(short = false) {
    const cch = short ? this.u8() : this.u16();
    const flags = this.u8();
    const runs = flags & 0x08 ? this.u16() : 0;
    const ext = flags & 0x04 ? this.u32() : 0;
    const s = this.chars(cch, flags & 1);
    if (runs) this.skip(runs * 4);
    if (ext) this.skip(ext);
    return s;
  }
}

function biffRecords(buf, start) {
  const list = [];
  let at = start;
  while (at + 4 <= buf.length && list.length < 4_000_000) {
    const type = buf.readUInt16LE(at);
    const len = buf.readUInt16LE(at + 2);
    const data = buf.subarray(at + 4, Math.min(buf.length, at + 4 + len));
    list.push({ type, data, at });
    at += 4 + len;
    if (type === 0x000a) break; // EOF of this part
  }
  return list;
}
// A record with its CONTINUE records, from list[i], starting `from` bytes into the record.
function withContinues(list, i, from = 0) {
  const parts = [list[i].data.subarray(from)];
  for (let k = i + 1; k < list.length && list[k].type === 0x003c; k++) parts.push(list[k].data);
  return new Parts(parts);
}

const XLS_ERRORS = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0f: '#VALUE!', 0x17: '#REF!', 0x1d: '#NAME?', 0x24: '#NUM!', 0x2a: '#N/A', 0x2b: '#GETTING_DATA' };
function rk(v) {
  let n;
  if (v & 2) n = v >> 2;
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((v & 0xfffffffc) >>> 0, 4);
    n = b.readDoubleLE(0);
  }
  return v & 1 ? n / 100 : n;
}

export function xlsToBlocks(cfb, out, label) {
  const OLD = `${label} was saved in the Excel 95 format or older, which CORE cannot read. Open it in Excel, save it as .xlsx and upload that copy.`;
  const NOT_XLS = `${label} is not an Excel workbook CORE can read: it may be damaged, or be another kind of file with the wrong name.`;
  const wb = stream(cfb, 'Workbook') || (cfb.has('Book') ? fail(OLD) : fail(NOT_XLS));
  if (wb.length < 8 || ![0x0809, 0x0009, 0x0209, 0x0409].includes(wb.readUInt16LE(0))) fail(NOT_XLS);
  if (wb.readUInt16LE(0) !== 0x0809 || wb.readUInt16LE(4) !== 0x0600) fail(OLD);
  const globals = biffRecords(wb, 0);
  const fonts = [];
  const formats = new Map();
  const xfs = [];
  const sheets = [];
  const shared = [];
  let date1904 = false;
  for (let i = 0; i < globals.length; i++) {
    const { type, data } = globals[i];
    try {
      switch (type) {
        case 0x002f: fail(PASSWORD(label, 'Excel', '.xlsx')); break;
        case 0x0022: date1904 = data.length >= 2 && data.readUInt16LE(0) === 1; break;
        case 0x0031: if (data.length >= 8) fonts.push({ italic: !!(data.readUInt16LE(2) & 2), bold: data.readUInt16LE(6) >= 700 }); break;
        case 0x041e: if (data.length >= 5) formats.set(data.readUInt16LE(0), withContinues(globals, i, 2).string()); break;
        case 0x00e0: if (data.length >= 6) xfs.push({ font: data.readUInt16LE(0), fmt: data.readUInt16LE(2) }); break;
        case 0x0085: if (data.length >= 8) {
          const p = new Parts([data.subarray(6)]);
          sheets.push({ pos: data.readUInt32LE(0), state: data[4] & 3, kind: data[5], name: p.string(true) });
        } break;
        case 0x00fc: {
          const p = withContinues(globals, i);
          p.u32();
          const unique = Math.min(p.u32(), 4_000_000);
          try {
            for (let k = 0; k < unique; k++) shared.push(p.string());
          } catch (err) {
            if (err !== END) throw err;
          }
          break;
        }
        default:
      }
    } catch (err) {
      if (err !== END) throw err;
    }
  }
  const fontOf = (i) => fonts[i < 4 ? i : i - 1] || {};
  const styles = xfs.map((x) => ({ ...fontOf(x.font), code: formats.get(x.fmt) ?? BUILTIN_CODES[x.fmt] }));
  out.title = propertyTitle(cfb);

  const number = (n, xf) => {
    const code = styles[xf]?.code;
    const shown = code ? formatExcel(n, code, date1904) : null;
    return shown !== null && shown !== '' ? shown : plainNumber(n);
  };
  let shown = 0;
  let hidden = 0;
  for (const sh of sheets) {
    const name = sh.name || `Sheet ${shown + hidden + 1}`;
    if (sh.state) {
      hidden++;
      continue;
    }
    if (sh.kind === 2) {
      out.warn(`Sheet ${name} is a chart, which CORE cannot put in a PDF; it was left out.`);
      continue;
    }
    if (sh.kind !== 0) {
      if (sh.kind === 1) out.warn(`Sheet ${name} is a macro sheet; it was left out.`);
      continue;
    }
    if (sh.pos + 8 > wb.length || wb.readUInt16LE(sh.pos) !== 0x0809) {
      out.warn(`Sheet ${name} could not be read and was left out.`);
      continue;
    }
    const recs = [];
    // The sheet's records up to its own EOF; charts embedded in it have their own BOF … EOF.
    let depth = 0;
    let at = sh.pos;
    while (at + 4 <= wb.length && recs.length < 4_000_000) {
      const type = wb.readUInt16LE(at);
      const len = wb.readUInt16LE(at + 2);
      const rec = { type, data: wb.subarray(at + 4, Math.min(wb.length, at + 4 + len)), depth };
      at += 4 + len;
      if (type === 0x0809) depth++;
      rec.depth = depth;
      recs.push(rec);
      if (type === 0x000a && --depth <= 0) break;
    }
    const grid = [];
    let first = -1;
    let cut = false;
    let pending = null;
    const put = (r, c, text, xf, numeric) => {
      if (c > 255 || !text) return;
      if (first >= 0 && r - first >= MAX_ROWS) {
        cut = true;
        return;
      }
      if (first < 0 || r < first) first = r;
      const st = styles[xf] || {};
      (grid[r] ||= [])[c] = { runs: [makeRun(text, { bold: st.bold, italic: st.italic })], align: numeric ? 'right' : undefined };
    };
    const merges = [];
    for (let i = 0; i < recs.length; i++) {
      const { type, data } = recs[i];
      if (recs[i].depth !== 1) continue;
      try {
        const r = data.length >= 6 ? data.readUInt16LE(0) : 0;
        const c = data.length >= 6 ? data.readUInt16LE(2) : 0;
        const xf = data.length >= 6 ? data.readUInt16LE(4) : 0;
        switch (type) {
          case 0x00fd: if (data.length >= 10) put(r, c, shared[data.readUInt32LE(6)] ?? '', xf); break;
          case 0x0204: case 0x00d6: if (data.length >= 9) put(r, c, withContinues(recs, i, 6).string(), xf); break;
          case 0x0203: if (data.length >= 14) put(r, c, number(data.readDoubleLE(6), xf), xf, true); break;
          case 0x027e: if (data.length >= 10) put(r, c, number(rk(data.readUInt32LE(6)), xf), xf, true); break;
          case 0x00bd: {
            const n = Math.floor((data.length - 6) / 6);
            for (let k = 0; k < n && c + k < 256; k++) {
              const x = data.readUInt16LE(4 + k * 6);
              put(r, c + k, number(rk(data.readUInt32LE(6 + k * 6)), x), x, true);
            }
            break;
          }
          case 0x0205: if (data.length >= 8) put(r, c, data[7] ? XLS_ERRORS[data[6]] || '#ERROR' : data[6] ? 'TRUE' : 'FALSE', xf, !data[7]); break;
          case 0x0006: {
            if (data.length < 20) break;
            if (data.readUInt16LE(12) === 0xffff) {
              const kind = data[6];
              if (kind === 0) pending = { r, c, xf };
              else if (kind === 1) put(r, c, data[8] ? 'TRUE' : 'FALSE', xf, true);
              else if (kind === 2) put(r, c, XLS_ERRORS[data[8]] || '#ERROR', xf);
            } else put(r, c, number(data.readDoubleLE(6), xf), xf, true);
            break;
          }
          case 0x0207: if (pending) {
            put(pending.r, pending.c, withContinues(recs, i).string(), pending.xf);
            pending = null;
          } break;
          case 0x00e5: {
            const n = data.length >= 2 ? data.readUInt16LE(0) : 0;
            for (let k = 0; k < n && 2 + k * 8 + 8 <= data.length; k++) {
              const o = 2 + k * 8;
              merges.push([data.readUInt16LE(o), data.readUInt16LE(o + 2), data.readUInt16LE(o + 4), data.readUInt16LE(o + 6)]);
            }
            break;
          }
          default:
        }
      } catch (err) {
        if (err !== END) throw err;
      }
    }
    // Merged cells: the first one spans the columns; the others are covered. Only merges in the rows
    // that are kept count, and only so many cells are touched in all.
    let work = 2_000_000;
    for (const [r1, r2, c1, c2] of merges) {
      if (c2 <= c1 || c2 > 255 || r2 < r1 || (first >= 0 && (r1 >= first + MAX_ROWS || r2 < first))) continue;
      work -= (Math.min(r2, r1 + MAX_ROWS) - r1 + 1) * (c2 - c1 + 1);
      if (work < 0) break;
      for (let r = r1; r <= Math.min(r2, r1 + MAX_ROWS); r++) {
        const row = (grid[r] ||= []);
        row[c1] = { ...(row[c1] || { runs: [] }), colspan: c2 - c1 + 1 };
        if (r > r1) row[c1].runs = [];
        for (let k = c1 + 1; k <= c2; k++) row[k] = null;
      }
    }
    if (shown++) out.pageBreak();
    out.heading(2, [{ text: name }]);
    const t = sheetTable(grid, out, name);
    if (cut) out.warn(`Sheet ${name}: only the first ${MAX_ROWS.toLocaleString('en-US')} rows were kept.`);
    if (t) {
      out.add(t.block);
      if (t.columns > 6) out.landscape = true;
    } else out.paragraph([{ text: '(This sheet is empty.)', italic: true }]);
  }
  if (hidden) out.warn(hidden === 1 ? '1 hidden sheet was left out.' : `${hidden} hidden sheets were left out.`);
  if (!shown) out.paragraph([{ text: '(This workbook has no sheets to show.)', italic: true }]);
}

// =============================================================================================
// PowerPoint 97–2003 (.ppt): the record tree of the "PowerPoint Document" stream. The slides are
// listed, in order, in the document's slide list; each one's place in the stream comes from the
// persist directory of the last save ("Current User" → UserEditAtom → PersistDirectoryAtom).

// A record header at `at`: { ver, inst, type, body, end }, or null past the end.
function rec(buf, at, end = buf.length) {
  if (at < 0 || at + 8 > end) return null;
  const vi = buf.readUInt16LE(at);
  const len = buf.readUInt32LE(at + 4);
  return { ver: vi & 0xf, inst: vi >> 4, type: buf.readUInt16LE(at + 2), at, body: at + 8, end: Math.min(end, at + 8 + len), len };
}
// Records read in all, so that a file whose records point into each other cannot keep the reader busy.
let budget = Infinity;
function children(buf, r) {
  const list = [];
  let at = r.body;
  while (at + 8 <= r.end && list.length < 100000) {
    if (--budget < 0) fail('This presentation is built in a way CORE cannot follow (it may be damaged). Open it in PowerPoint, save it as .pptx and upload that copy.');
    const c = rec(buf, at, r.end);
    list.push(c);
    at = c.end;
    if (c.end < c.body) break;
  }
  return list;
}
const kidOf = (buf, r, type, inst) => (r ? children(buf, r).find((c) => c.type === type && (inst === undefined || c.inst === inst)) : null);

// Text of a TextCharsAtom (UTF-16) or TextBytesAtom (8-bit).
function atomText(buf, r) {
  if (r.type === 0x0fa0) return buf.toString('utf16le', r.body, r.body + ((r.end - r.body) & ~1));
  if (r.type === 0x0fa8) return buf.toString('latin1', r.body, r.end);
  return null;
}

// The paragraph and character runs of a StyleTextPropAtom, for text of `length` characters:
// { paras: [{ count, level, bullet, align }], chars: [{ count, bold, italic, underline }] }, or null
// when the record cannot be followed.
const PF_FIELDS = [[0x0f, 2], [0x80, 2], [0x10, 2], [0x40, 2], [0x20, 4], [0x800, 2], [0x1000, 2], [0x2000, 2], [0x4000, 2], [0x100, 2], [0x400, 2], [0x8000, 2], [0x100000, 'tabs'], [0x10000, 2], [0xe0000, 2], [0x200000, 2]];
const CF_FIELDS = [[0x3cb7, 2], [0x10000, 2], [0x200000, 2], [0x400000, 2], [0x800000, 2], [0x20000, 2], [0x40000, 4], [0x80000, 2], [0x100000, 4], [0x1000000, 2], [0x2000000, 2], [0x4000000, 4]];
function textStyles(buf, r, length) {
  if (!r || r.type !== 0x0fa1) return null;
  const end = r.end;
  let at = r.body;
  const paras = [];
  const chars = [];
  try {
    for (let done = 0; done <= length && at + 10 <= end && paras.length < 10000;) {
      const count = buf.readUInt32LE(at);
      const level = buf.readUInt16LE(at + 4);
      const masks = buf.readUInt32LE(at + 6);
      at += 10;
      const p = { count, level, bullet: undefined, align: undefined };
      for (const [mask, size] of PF_FIELDS) {
        if (!(masks & mask)) continue;
        if (mask === 0x0f) p.bullet = !!(buf.readUInt16LE(at) & 1) || undefined;
        if (mask === 0x0f && masks & 1) p.bullet = !!(buf.readUInt16LE(at) & 1);
        if (mask === 0x800) p.align = buf.readUInt16LE(at);
        at += size === 'tabs' ? 2 + buf.readUInt16LE(at) * 4 : size;
      }
      if (at > end || !count) return null;
      paras.push(p);
      done += count;
      if (done >= length + 1) break;
    }
    for (let done = 0; done <= length && at + 8 <= end && chars.length < 100000;) {
      const count = buf.readUInt32LE(at);
      const masks = buf.readUInt32LE(at + 4);
      at += 8;
      const c = { count };
      for (const [mask, size] of CF_FIELDS) {
        if (!(masks & mask)) continue;
        if (mask === 0x3cb7) {
          const style = buf.readUInt16LE(at);
          if (masks & 1) c.bold = !!(style & 1);
          if (masks & 2) c.italic = !!(style & 2);
          if (masks & 4) c.underline = !!(style & 4);
        }
        at += size;
      }
      if (at > end || !count) break;
      chars.push(c);
      done += count;
      if (done >= length + 1) break;
    }
  } catch {
    return paras.length ? { paras, chars: [] } : null;
  }
  return { paras, chars };
}

// The paragraphs of a text: [{ runs, level, bullet, align }] by its style runs ("\r" ends a
// paragraph, "\v" breaks a line).
function styledParagraphs(text, styles) {
  const out = [];
  const pAt = (pos, list) => {
    let n = 0;
    for (const p of list || []) {
      n += p.count;
      if (pos < n) return p;
    }
    return (list || [])[list?.length - 1] || {};
  };
  let pos = 0;
  for (const line of text.split('\r')) {
    const pf = pAt(pos, styles?.paras);
    const runs = [];
    let cur = null;
    for (let i = 0; i < line.length; i++) {
      const cf = pAt(pos + i, styles?.chars);
      const ch = line[i] === '\v' ? '\n' : line[i];
      if (cur && cur.cf === cf) cur.text += ch;
      else {
        cur = { cf, text: ch };
        runs.push(cur);
      }
    }
    out.push({ runs: runs.map((r) => makeRun(r.text, r.cf)), level: Math.min(4, pf.level || 0), bullet: pf.bullet, align: { 1: 'center', 2: 'right', 3: 'justify' }[pf.align] });
    pos += line.length + 1;
  }
  return out;
}

// The slides in the order of the slide list: [{ persist, texts: [{ type, text }] }].
function slideList(buf, docRec) {
  const slides = [];
  const list = docRec && kidOf(buf, docRec, 0x0ff0, 0);
  if (!list) return slides;
  let cur = null;
  let type = 4;
  for (const c of children(buf, list)) {
    if (c.type === 0x03f3 && c.body + 4 <= c.end) {
      cur = { persist: buf.readUInt32LE(c.body), texts: [] };
      slides.push(cur);
    } else if (c.type === 0x0f9f && c.body + 4 <= c.end) type = buf.readUInt32LE(c.body);
    else if (cur && (c.type === 0x0fa0 || c.type === 0x0fa8)) cur.texts.push({ type, text: atomText(buf, c) });
    else if (cur && c.type === 0x0fa1 && cur.texts.length) {
      const t = cur.texts[cur.texts.length - 1];
      t.styles = textStyles(buf, c, t.text.length);
    }
  }
  return slides;
}

const TITLE_TYPES = new Set([0, 6]);
const BULLET_TYPES = new Set([1, 7, 8]);
const TITLE_PLACEHOLDERS = new Set([0x0d, 0x0f, 0x11]);
const SKIP_PLACEHOLDERS = new Set([0x07, 0x08, 0x09, 0x0a]);

// The shapes of a slide's drawing, in order: { title, bullets, text } or { pib } (a picture).
function slideShapes(buf, slide, slideTexts) {
  const shapes = [];
  const walk = (r, depth) => {
    if (depth > 32) return;
    for (const c of children(buf, r)) {
      if (c.type === 0xf004) shape(c);
      else if (c.ver === 0xf) walk(c, depth + 1);
    }
  };
  const shape = (sp) => {
    let placeholder = null;
    let textType = null;
    let text = null;
    let styles = null;
    let pib = 0;
    let box = null;
    for (const c of children(buf, sp)) {
      if (c.type === 0xf003) walk(c, 1); // a group inside a shape container
      else if (c.type === 0xf011) {
        const ph = kidOf(buf, c, 0x0bc3);
        if (ph && ph.body + 5 <= ph.end) placeholder = buf[ph.body + 4];
      } else if (c.type === 0xf00d) {
        for (const t of children(buf, c)) {
          if (t.type === 0x0f9f && t.body + 4 <= t.end) textType = buf.readUInt32LE(t.body);
          else if (t.type === 0x0fa0 || t.type === 0x0fa8) text = atomText(buf, t);
          else if (t.type === 0x0fa1 && text !== null) styles = textStyles(buf, t, text.length);
          else if (t.type === 0x0f9e && t.body + 4 <= t.end) {
            const ref = slideTexts[buf.readUInt32LE(t.body)];
            if (ref) {
              text = ref.text;
              textType = ref.type;
              styles = ref.styles;
            }
          }
        }
      } else if (c.type === 0xf010 && c.len === 8 && c.body + 8 <= c.end) {
        // The shape's place on the slide, in master units (576 an inch): top, left, right, bottom.
        const [top, left, right, bottom] = [0, 2, 4, 6].map((o) => buf.readInt16LE(c.body + o));
        box = { width: (right - left) / 8, height: (bottom - top) / 8 };
      } else if (c.type === 0xf010 && c.len === 16 && c.body + 16 <= c.end) {
        const [top, left, right, bottom] = [0, 4, 8, 12].map((o) => buf.readInt32LE(c.body + o));
        box = { width: (right - left) / 8, height: (bottom - top) / 8 };
      } else if (c.type === 0xf00b || c.type === 0xf122) {
        const n = c.inst;
        for (let k = 0; k < n && c.body + k * 6 + 6 <= c.end; k++) {
          const pid = buf.readUInt16LE(c.body + k * 6) & 0x3fff;
          if (pid === 0x0104) pib = buf.readUInt32LE(c.body + k * 6 + 2);
        }
      }
    }
    if (placeholder !== null && SKIP_PLACEHOLDERS.has(placeholder)) return;
    if (text !== null) {
      const title = TITLE_PLACEHOLDERS.has(placeholder) || TITLE_TYPES.has(textType);
      const bullets = !title && (BULLET_TYPES.has(textType) || placeholder === 0x0e || placeholder === 0x12);
      if (textType !== 2) shapes.push({ text, title, bullets, styles });
    } else if (pib) shapes.push({ pib, box: box && box.width > 0 && box.height > 0 ? box : null });
  };
  const drawing = kidOf(buf, slide, 0x040c);
  if (drawing) walk(drawing, 0);
  return shapes;
}

export function pptToBlocks(cfb, out, label) {
  const NOT_PPT = `${label} is not a PowerPoint presentation CORE can read: it may be damaged, or be another kind of file with the wrong name.`;
  const doc = stream(cfb, 'PowerPoint Document');
  if (!doc) fail(cfb.has('PP97_DUALSTORAGE') || cfb.storages.some((s) => /^PP\d/.test(s)) ? `${label} was saved by PowerPoint 95 or older, which CORE cannot read. Open it in PowerPoint, save it as .pptx and upload that copy.` : NOT_PPT);
  if (cfb.has('EncryptedSummary')) fail(PASSWORD(label, 'PowerPoint', '.pptx'));
  out.landscape = true;
  out.title = propertyTitle(cfb);
  budget = 4 * doc.length + 100000;
  // The persist directory: where each object (the document, each slide) is, newest save first.
  const persist = new Map();
  let docOffset = null;
  let user = null;
  try {
    user = stream(cfb, 'Current User');
  } catch { /* the slides are then found in the order they were written */ }
  if (user && user.length >= 20) {
    if (user.readUInt32LE(12) === 0xf3d1c4df) fail(PASSWORD(label, 'PowerPoint', '.pptx'));
    let edit = user.readUInt32LE(16);
    const seen = new Set();
    while (edit > 0 && !seen.has(edit) && seen.size < 1000) {
      seen.add(edit);
      const e = rec(doc, edit);
      if (!e || e.type !== 0x0ff5 || e.body + 28 > e.end) break;
      if (e.body + 32 <= e.end && doc.readUInt32LE(e.body + 28)) fail(PASSWORD(label, 'PowerPoint', '.pptx'));
      const dir = rec(doc, doc.readUInt32LE(e.body + 12));
      if (docOffset === null) docOffset = { ref: doc.readUInt32LE(e.body + 16) };
      if (dir && dir.type === 0x1772) {
        let at = dir.body;
        while (at + 4 <= dir.end) {
          const info = doc.readUInt32LE(at);
          const first = info & 0xfffff;
          const count = info >>> 20;
          at += 4;
          for (let k = 0; k < count && at + 4 <= dir.end; k++, at += 4) if (!persist.has(first + k)) persist.set(first + k, doc.readUInt32LE(at));
        }
      }
      edit = doc.readUInt32LE(e.body + 8);
    }
  }
  const atPersist = (id, type) => {
    const r = persist.has(id) ? rec(doc, persist.get(id)) : null;
    return r && r.type === type ? r : null;
  };
  let docRec = docOffset ? atPersist(docOffset.ref, 0x03e8) : null;
  // Without a usable directory, the records of the stream are read in the order they were written.
  const topSlides = [];
  if (!docRec || !persist.size) {
    let at = 0;
    let guard = 0;
    while (at + 8 <= doc.length && guard++ < 1_000_000) {
      const r = rec(doc, at);
      if (r.type === 0x03e8) docRec = r;
      else if (r.type === 0x03ee) topSlides.push(r);
      if (r.end <= at) break;
      at = r.end;
    }
  }
  if (!docRec) fail(NOT_PPT);
  const list = slideList(doc, docRec);
  // The pictures of the presentation (the "BStore" of its drawing group).
  const pictures = stream(cfb, 'Pictures', out);
  const store = [];
  const group = kidOf(doc, docRec, 0x040b);
  const dgg = group && kidOf(doc, group, 0xf000);
  const bstore = dgg && kidOf(doc, dgg, 0xf001);
  if (bstore) for (const f of children(doc, bstore)) store.push(f.type === 0xf007 ? f : null);
  const blip = (pib) => {
    const f = store[pib - 1];
    if (!f || f.body + 36 > f.end) return null;
    const inner = f.body + 36 + doc[f.body + 33];
    const embedded = inner + 8 <= f.end ? blipAt(doc, inner, f.end) : null;
    if (embedded) return embedded;
    return pictures ? blipAt(pictures, doc.readUInt32LE(f.body + 28)) : null;
  };

  // Each slide of the list, found through the persist directory; without one, the slide records
  // are taken in the order they were written.
  const slides = list.length
    ? list.map((s, i) => ({ ...s, rec: atPersist(s.persist, 0x03ee) || (persist.size ? null : topSlides[i] || null) }))
    : topSlides.map((r) => ({ texts: [], rec: r }));
  let shown = 0;
  let hidden = 0;
  slides.forEach((s, i) => {
    const number = i + 1;
    if (s.rec) {
      const info = kidOf(doc, s.rec, 0x03f9);
      if (info && info.body + 12 <= info.end && doc.readUInt16LE(info.body + 10) & 0x4) {
        hidden++;
        return;
      }
    }
    let shapes = s.rec ? slideShapes(doc, s.rec, s.texts) : [];
    if (!shapes.some((sh) => sh.text) && s.texts.length) {
      shapes = shapes.concat(s.texts.filter((t) => t.type !== 2).map((t) => ({ text: t.text, title: TITLE_TYPES.has(t.type), bullets: BULLET_TYPES.has(t.type), styles: t.styles })));
    }
    if (shown++) out.pageBreak();
    const from = out.blocks.length;
    for (const sh of shapes.filter((x) => x.title)) {
      const runs = [];
      for (const para of styledParagraphs(sh.text, sh.styles)) {
        if (!para.runs.some((r) => r.text.trim())) continue;
        if (runs.length) runs.push({ text: '\n' });
        runs.push(...para.runs.map((r) => makeRun(r.text, { italic: r.italic, underline: r.underline })));
      }
      out.heading(1, runs);
    }
    for (const sh of shapes) {
      if (sh.title) continue;
      if (sh.text !== undefined) {
        for (const para of styledParagraphs(sh.text, sh.styles)) {
          const bullet = para.bullet ?? sh.bullets;
          if (bullet && para.runs.some((r) => r.text.trim())) out.listItem(false, para.runs, para.level);
          else out.paragraph(para.runs, { align: para.align });
        }
        out.paragraph([]);
      } else if (sh.pib) {
        const b = blip(sh.pib);
        if (!b) continue;
        if (b.data) {
          const img = out.image(b.data, sh.box || {});
          if (img) out.add(img);
        } else out.unreadablePictures++;
      }
    }
    if (!out.blocks.slice(from).some(blockHasContent)) {
      out.blocks.length = from;
      out.paragraph([{ text: `(Slide ${number} has no text)`, italic: true }]);
    }
  });
  if (hidden) out.warn(hidden === 1 ? '1 hidden slide was left out.' : `${hidden} hidden slides were left out.`);
  if (!shown) out.paragraph([{ text: '(This presentation has no slides.)', italic: true }]);
}
