// PDF Studio (0.65): drawing a page of a PDF as SVG on the server, so the browser can show it
// without a PDF renderer of its own, and finding the text on it so people can remove or replace
// a line and sign the page.
//
// The page's content streams are a little program: operators that move a pen, fill shapes, place
// pictures and show text. renderPage runs that program once, keeping the graphics state a PDF
// viewer would keep (transformations, colours, clipping, the text matrix), and writes what each
// operator draws as SVG in the page's own coordinates (its visible box, not turned: the browser
// turns the picture itself). It is a best-effort renderer, not a full one: fonts are not embedded
// (text is drawn in the browser's sans-serif, serif or monospace face, squeezed or stretched to the
// width the PDF's own font would take), gradients and patterns are drawn in one flat colour, and
// pictures in formats a browser cannot show (JPEG 2000, JBIG2, fax) are grey boxes.
//
// The text is also reported as "runs", one a line: its text, where it is, its size and face, and an
// id, the place of its first text-showing operator (Tj, TJ, ' or ") among the page's. removeTextOps
// uses the same ids to take chosen lines out of the page's content while leaving everything after
// them exactly where it was.
//
// The SVG is only ever shapes, text and pictures as data: URLs; nothing in it can run or load
// anything, whatever the PDF holds.
import { deflateSync, inflateSync } from 'node:zlib';
import * as zlib from 'node:zlib';
import { Name, Bytes, widthOf, encodeWinAnsi } from './writer.js';
import { pageInternals, pageAnnotations, Parser, PdfStream, Keyword, isDict, nameOf, toArray, toUnicode, inflate, ascii85, asciiHex, WHITE, isRegular, MAX_CONTENT_BYTES } from './reader.js';

const MAX_FORM_DEPTH = 6;
const LIGHT = [0.85, 0.85, 0.85]; // what a pattern, a gradient or a picture that cannot be shown becomes
const IDENTITY = [1, 0, 0, 1, 0, 0];

// ---------- Small helpers ----------
// Numbers in the SVG: three decimals are far below what a screen shows.
const n3 = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Number.isFinite(r) ? String(Object.is(r, -0) ? 0 : r) : '0';
};
// m × n for PDF matrices [a b c d e f] (a point is a row vector: p' = p × m).
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m, x, y) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
const matrixAttr = (m) => `matrix(${m.map(n3).join(' ')})`;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp01 = (v) => Math.min(1, Math.max(0, num(v)));
const hex = (rgb) => `#${rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('')}`;
// Text for XML: only characters XML allows (no control characters, no lone surrogates, nothing
// from the private use area, where symbol fonts put glyphs that would show as boxes), escaped.
const xmlText = (s) => String(s)
  .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/[-]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlAttr = (s) => xmlText(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;');

let crcTable = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A PNG of 8-bit pixels with 1 (grey), 2 (grey + alpha), 3 (RGB) or 4 (RGBA) channels.
function encodePng(width, height, channels, pixels) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); // filter 0: none
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels];
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Decoding streams ----------
// LZW (old PDFs and TIFF-style compression): 9 to 12-bit codes, 256 clears the table, 257 ends.
function lzw(data, limit, early = 1) {
  const out = [];
  let size = 0;
  let table;
  let next;
  let bits;
  const reset = () => {
    table = [];
    for (let i = 0; i < 256; i++) table[i] = Uint8Array.of(i);
    next = 258;
    bits = 9;
  };
  reset();
  let buf = 0;
  let have = 0;
  let pos = 0;
  let prev = null;
  for (;;) {
    while (have < bits && pos < data.length) { buf = ((buf << 8) | data[pos++]) >>> 0; have += 8; }
    if (have < bits) break;
    const code = (buf >>> (have - bits)) & ((1 << bits) - 1);
    have -= bits;
    buf &= (1 << have) - 1;
    if (code === 256) { reset(); prev = null; continue; }
    if (code === 257) break;
    let entry;
    if (code < next && table[code]) entry = table[code];
    else if (code === next && prev) { entry = new Uint8Array(prev.length + 1); entry.set(prev); entry[prev.length] = prev[0]; }
    else break;
    out.push(entry);
    size += entry.length;
    if (size > limit) throw new RangeError('Too large.');
    if (prev && next < 4096) {
      const e = new Uint8Array(prev.length + 1);
      e.set(prev);
      e[prev.length] = entry[0];
      table[next++] = e;
    }
    prev = entry;
    if (next + early >= 1 << bits && bits < 12) bits++;
  }
  return Buffer.concat(out);
}

function runLength(data, limit) {
  const out = [];
  let size = 0;
  for (let i = 0; i < data.length;) {
    const n = data[i++];
    if (n === 128) break;
    const chunk = n < 128 ? data.subarray(i, i + n + 1) : Buffer.alloc(257 - n, data[i]);
    i += n < 128 ? n + 1 : 1;
    out.push(chunk);
    size += chunk.length;
    if (size > limit) throw new RangeError('Too large.');
  }
  return Buffer.concat(out);
}

const FILTER = { Fl: 'FlateDecode', LZW: 'LZWDecode', A85: 'ASCII85Decode', AHx: 'ASCIIHexDecode', RL: 'RunLengthDecode', DCT: 'DCTDecode', CCF: 'CCITTFaxDecode' };
// A stream's bytes through its filters. For a picture, the last filter may be one only an image
// decoder undoes (DCTDecode, JPXDecode…): the bytes are returned before it, with its name.
function decodeStream(src, stream, limit, forImage = false) {
  const filters = toArray(src.resolve(stream.dict.Filter)).map((f) => nameOf(src.resolve(f)));
  const parms = toArray(src.resolve(stream.dict.DecodeParms ?? stream.dict.DP));
  let data = stream.raw;
  for (let i = 0; i < filters.length; i++) {
    const f = FILTER[filters[i]] || filters[i];
    const p = src.resolve(parms[i]);
    const pd = isDict(p) ? p : {};
    if (f === 'FlateDecode') data = src.unpredict(inflate(data, limit), pd);
    else if (f === 'LZWDecode') data = src.unpredict(lzw(data, limit, num(src.resolve(pd.EarlyChange), 1)), pd);
    else if (f === 'ASCII85Decode') data = ascii85(data);
    else if (f === 'ASCIIHexDecode') data = asciiHex(data);
    else if (f === 'RunLengthDecode') data = runLength(data, limit);
    else if (forImage && i === filters.length - 1) return { data, image: f };
    else throw new Error(`The ${f} filter is not supported.`);
  }
  return { data, image: null };
}

// ---------- Fonts ----------
// Glyph names (as in /Differences) for Latin text: ASCII, Latin-1 and the rest of WinAnsi.
const GLYPHS = (() => {
  const g = Object.create(null);
  const ascii = 'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at'.split(' ');
  ascii.forEach((n, i) => { g[n] = String.fromCharCode(32 + i); });
  for (let c = 65; c <= 90; c++) {
    g[String.fromCharCode(c)] = String.fromCharCode(c);
    g[String.fromCharCode(c + 32)] = String.fromCharCode(c + 32);
  }
  'bracketleft backslash bracketright asciicircum underscore grave'.split(' ').forEach((n, i) => { g[n] = String.fromCharCode(91 + i); });
  'braceleft bar braceright asciitilde'.split(' ').forEach((n, i) => { g[n] = String.fromCharCode(123 + i); });
  const latin1 = 'exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot sfthyphen registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis'.split(' ');
  latin1.forEach((n, i) => { g[n] = String.fromCharCode(0xa1 + i); });
  Object.assign(g, {
    Euro: '€', quotesinglbase: '‚', florin: 'ƒ', quotedblbase: '„', ellipsis: '…', dagger: '†', daggerdbl: '‡', circumflex: 'ˆ', perthousand: '‰', Scaron: 'Š', guilsinglleft: '‹', OE: 'Œ', Zcaron: 'Ž',
    quoteleft: '‘', quoteright: '’', quotedblleft: '“', quotedblright: '”', bullet: '•', endash: '–', emdash: '—', tilde: '˜', trademark: '™', scaron: 'š', guilsinglright: '›', oe: 'œ', zcaron: 'ž', Ydieresis: 'Ÿ',
    fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', dotlessi: 'ı', Lslash: 'Ł', lslash: 'ł', minus: '−', fraction: '⁄', nbspace: ' ', nonbreakingspace: ' ', uni00A0: ' ',
    breve: '˘', caron: 'ˇ', dotaccent: '˙', hungarumlaut: '˝', ogonek: '˛', ring: '˚', mu1: 'µ', Omega: 'Ω', Delta: 'Δ', copyrightsans: '©', registersans: '®', middot: '·', hyphentwo: '-', space1: ' ',
  });
  return g;
})();
// The text of a glyph name: from the table, "uniXXXX…", "uXXXX", or ligatures "f_f_i".
function glyphText(name) {
  if (GLYPHS[name] !== undefined) return GLYPHS[name];
  const base = name.split('.')[0];
  if (GLYPHS[base] !== undefined) return GLYPHS[base];
  let m = /^uni((?:[0-9A-F]{4})+)$/.exec(base);
  if (m) return m[1].match(/.{4}/g).map((h) => String.fromCharCode(parseInt(h, 16))).join('');
  m = /^u([0-9A-F]{4,6})$/.exec(base);
  if (m) {
    const cp = parseInt(m[1], 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  }
  if (base.includes('_')) return base.split('_').map((p) => GLYPHS[p] ?? '').join('');
  return undefined;
}

// The simple encodings, as 256 characters each.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';
const MAC_HIGH = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
const STD_HIGH = { 0xa1: '¡', 0xa2: '¢', 0xa3: '£', 0xa4: '⁄', 0xa5: '¥', 0xa6: 'ƒ', 0xa7: '§', 0xa8: '¤', 0xa9: "'", 0xaa: '“', 0xab: '«', 0xac: '‹', 0xad: '›', 0xae: 'fi', 0xaf: 'fl', 0xb1: '–', 0xb2: '†', 0xb3: '‡', 0xb4: '·', 0xb6: '¶', 0xb7: '•', 0xb8: '‚', 0xb9: '„', 0xba: '”', 0xbb: '»', 0xbc: '…', 0xbd: '‰', 0xbf: '¿', 0xc1: '`', 0xc2: '´', 0xc3: 'ˆ', 0xc4: '˜', 0xc5: '¯', 0xc6: '˘', 0xc7: '˙', 0xc8: '¨', 0xca: '˚', 0xcb: '¸', 0xcd: '˝', 0xce: '˛', 0xcf: 'ˇ', 0xd0: '—', 0xe1: 'Æ', 0xe3: 'ª', 0xe8: 'Ł', 0xe9: 'Ø', 0xea: 'Œ', 0xeb: 'º', 0xf1: 'æ', 0xf5: 'ı', 0xf8: 'ł', 0xf9: 'ø', 0xfa: 'œ', 0xfb: 'ß' };
const ENCODINGS = (() => {
  const ascii = (c) => (c >= 32 && c <= 126 ? String.fromCharCode(c) : '');
  const win = Array.from({ length: 256 }, (_, c) => (c >= 0x80 && c <= 0x9f ? CP1252[c - 0x80] : c >= 0xa0 ? String.fromCharCode(c) : ascii(c)));
  win[0xa0] = ' ';
  win[0xad] = '-';
  const std = Array.from({ length: 256 }, (_, c) => (c < 128 ? ascii(c) : STD_HIGH[c] || ''));
  std[0x27] = '’';
  std[0x60] = '‘';
  const mac = Array.from({ length: 256 }, (_, c) => (c < 128 ? ascii(c) : MAC_HIGH[c - 128]));
  return { WinAnsiEncoding: win, StandardEncoding: std, MacRomanEncoding: mac, PDFDocEncoding: win };
})();

// The three faces a browser always has, chosen from the font's name.
function familyOf(base) {
  if (/Courier|Mono|Consol|Typewriter/i.test(base)) return 'mono';
  if (/Sans/i.test(base)) return 'sans';
  if (/Times|Serif|Garamond|Georgia|Cambria|Book|Roman|Minion|Palatino|Baskerville/i.test(base)) return 'serif';
  return 'sans';
}
const CSS_FAMILY = { sans: 'sans-serif', serif: 'serif', mono: 'monospace' };

// What the renderer needs of a font: for each code, its text and its advance (in thousandths of
// the font size), how many bytes a code takes, and the face to draw it in.
function loadFont(src, dict) {
  const r = (v) => src.resolve(v);
  const subtype = nameOf(r(dict.Subtype));
  const type0 = subtype === 'Type0';
  const desc = type0 ? r(toArray(r(dict.DescendantFonts))[0]) : null;
  const fd = r((type0 && isDict(desc) ? desc : dict).FontDescriptor);
  const base = (nameOf(r(dict.BaseFont)) || nameOf(r(isDict(desc) ? desc.BaseFont : null)) || '').replace(/^[A-Z]{6}\+/, '');
  const flags = isDict(fd) ? num(r(fd.Flags)) : 0;
  const weight = isDict(fd) ? num(r(fd.FontWeight)) : 0;
  const bold = /Bold|Black|Heavy|Semibold|Demi/i.test(base) || (flags & (1 << 18)) !== 0 || weight >= 600;
  const italic = /Italic|Oblique/i.test(base) || (flags & (1 << 6)) !== 0 || (isDict(fd) && num(r(fd.ItalicAngle)) !== 0);
  let cmap = null;
  try { cmap = toUnicode(src, dict); } catch { cmap = null; }
  const font = { base, family: familyOf(base), bold, italic, bytes: type0 ? 2 : 1, glyphs: new Map(), cmap };

  if (type0) {
    // A CID font: /W lists widths as "c [w1 w2 …]" or "first last w"; /DW for the rest.
    const widths = new Map();
    const dw = isDict(desc) ? num(r(desc.DW), 1000) : 1000;
    const w = isDict(desc) ? toArray(r(desc.W)).map(r) : [];
    for (let i = 0; i < w.length && widths.size < 70000;) {
      const first = w[i];
      if (Array.isArray(w[i + 1])) {
        w[i + 1].forEach((x, k) => widths.set(first + k, num(r(x), dw)));
        i += 2;
      } else {
        const last = w[i + 1];
        const v = num(w[i + 2], dw);
        if (Number.isInteger(first) && Number.isInteger(last) && last - first < 70000) for (let c = first; c <= last; c++) widths.set(c, v);
        i += 3;
      }
    }
    // Only Identity encodings say which CID a code is (the code itself); for any other CMap the
    // default width is the best guess.
    const identity = /^Identity-[HV]$/.test(nameOf(r(dict.Encoding)) || '');
    font.width = (code) => (identity ? widths.get(code) ?? dw : dw);
    font.text = (code) => (cmap ? cmapText(cmap, code) : '');
    return font;
  }

  // A simple font: one byte a code; the encoding (a base encoding and /Differences) names glyphs.
  const enc = r(dict.Encoding);
  const symbolic = (flags & 4) !== 0 || /Symbol|Dingbat/i.test(base);
  let baseName = nameOf(isDict(enc) ? r(enc.BaseEncoding) : enc);
  if (!ENCODINGS[baseName]) baseName = subtype === 'Type1' && !symbolic ? 'StandardEncoding' : 'WinAnsiEncoding';
  const codes = ENCODINGS[baseName].slice();
  if (isDict(enc)) {
    let code = 0;
    for (const d of toArray(r(enc.Differences))) {
      const v = r(d);
      if (typeof v === 'number') code = v;
      else if (v instanceof Name && code >= 0 && code < 256) {
        const t = glyphText(v.v);
        codes[code] = t === undefined ? '' : t;
        code++;
      }
    }
  }
  const first = num(r(dict.FirstChar));
  const widths = toArray(r(dict.Widths)).map((x) => num(r(x)));
  const missing = isDict(fd) ? num(r(fd.MissingWidth), 0) : 0;
  // A Type3 font measures in its own glyph space; /FontMatrix turns that into text space.
  const scale = subtype === 'Type3' ? num(toArray(r(dict.FontMatrix)).map(r)[0], 0.001) * 1000 : 1;
  const standard = /^Courier/i.test(base) ? 'Courier' : /^(Times|TimesNewRoman)/i.test(base) ? (bold ? 'Times-Bold' : 'Times-Roman') : /^(Helvetica|Arial)/i.test(base) ? (bold ? 'Helvetica-Bold' : 'Helvetica') : null;
  font.width = (code) => {
    const i = code - first;
    if (widths.length) return (i >= 0 && i < widths.length ? widths[i] : missing) * scale;
    if (standard) {
      // One of the standard 14 fonts, which need not list widths: the widths of the real font.
      const b = encodeWinAnsi(codes[code] || ' ');
      return widthOf(b, standard, 1000) / Math.max(1, b.length);
    }
    return (missing || 500) * scale;
  };
  font.text = (code) => {
    const t = cmap ? cmapText(cmap, code) : undefined;
    return t !== undefined ? t : codes[code] || '';
  };
  return font;
}

// The text of one code in a ToUnicode map, or undefined when the map does not say.
function cmapText(cmap, code) {
  const t = cmap.chars.get(code);
  if (t !== undefined) return t;
  for (const r of cmap.ranges) {
    if (code < r.lo || code > r.hi) continue;
    if (r.dst instanceof Bytes && r.dst.b.length >= 2) {
      const d = Buffer.from(r.dst.b.subarray(0, r.dst.b.length & ~1));
      d.writeUInt16BE((d.readUInt16BE(d.length - 2) + code - r.lo) & 0xffff, d.length - 2);
      return d.swap16().toString('utf16le');
    }
    if (Array.isArray(r.dst) && r.dst[code - r.lo] instanceof Bytes) return Buffer.from(r.dst[code - r.lo].b.subarray(0, r.dst[code - r.lo].b.length & ~1)).swap16().toString('utf16le');
  }
  return undefined;
}

// The glyphs of a string: [{ code, text, w, space }] (w in thousandths of the font size).
function glyphsOf(font, b) {
  const out = [];
  const step = font.bytes;
  for (let i = 0; i + step <= b.length; i += step) {
    const code = step === 2 ? b[i] * 256 + b[i + 1] : b[i];
    let g = font.glyphs.get(code);
    if (!g) {
      g = { code, text: font.text(code).replace(/[\u0000-\u001f]/g, ''), w: font.width(code), space: step === 1 && code === 32 };
      if (font.glyphs.size < 70000) font.glyphs.set(code, g);
    }
    out.push(g);
  }
  return out;
}

const FALLBACK_FONT = loadFallback();
function loadFallback() {
  const codes = ENCODINGS.WinAnsiEncoding;
  return {
    base: 'Helvetica', family: 'sans', bold: false, italic: false, bytes: 1, glyphs: new Map(), cmap: null,
    width: (code) => widthOf(Buffer.from([code]), 'Helvetica', 1000),
    text: (code) => codes[code] || '',
  };
}

// ---------- Colour ----------
// A colour space as { kind, n } (+ base and lookup for Indexed). Unknown spaces count as grey.
function colorSpace(ctx, v, resources, depth = 0) {
  const r = (x) => ctx.src.resolve(x);
  v = r(v);
  if (depth > 4) return { kind: 'gray', n: 1 };
  const name = nameOf(v);
  if (name) {
    if (name === 'DeviceGray' || name === 'G' || name === 'CalGray') return { kind: 'gray', n: 1 };
    if (name === 'DeviceRGB' || name === 'RGB' || name === 'CalRGB') return { kind: 'rgb', n: 3 };
    if (name === 'DeviceCMYK' || name === 'CMYK') return { kind: 'cmyk', n: 4 };
    if (name === 'Pattern') return { kind: 'pattern', n: 0 };
    const named = isDict(resources) ? r(resources.ColorSpace) : null;
    if (isDict(named) && named[name] !== undefined) return colorSpace(ctx, named[name], resources, depth + 1);
    return { kind: 'gray', n: 1 };
  }
  if (!Array.isArray(v) || !v.length) return { kind: 'gray', n: 1 };
  const family = nameOf(r(v[0]));
  if (family === 'ICCBased') {
    const s = r(v[1]);
    const n = s instanceof PdfStream ? num(r(s.dict.N), 3) : 3;
    return n === 1 ? { kind: 'gray', n: 1 } : n === 4 ? { kind: 'cmyk', n: 4 } : { kind: 'rgb', n: 3 };
  }
  if (family === 'Indexed' || family === 'I') {
    const base = colorSpace(ctx, v[1], resources, depth + 1);
    const lookup = r(v[3]);
    let table = Buffer.alloc(0);
    if (lookup instanceof Bytes) table = lookup.b;
    else if (lookup instanceof PdfStream) { try { table = decodeStream(ctx.src, lookup, 1 << 20).data; } catch { table = Buffer.alloc(0); } }
    return { kind: 'indexed', n: 1, base, hival: num(r(v[2])), table };
  }
  if (family === 'Separation') return { kind: 'tint', n: 1 };
  if (family === 'DeviceN') return { kind: 'tint', n: Math.max(1, toArray(r(v[1])).length) };
  if (family === 'CalRGB') return { kind: 'rgb', n: 3 };
  if (family === 'CalGray') return { kind: 'gray', n: 1 };
  if (family === 'Lab') return { kind: 'lab', n: 3 };
  if (family === 'Pattern') return { kind: 'pattern', n: 0, base: v[1] ? colorSpace(ctx, v[1], resources, depth + 1) : null };
  return colorSpace(ctx, v[0], resources, depth + 1);
}

// Components (0–1, an index for Indexed) to RGB (0–1). CMYK is converted naively, and a spot
// colour (Separation, DeviceN) becomes the grey its tint would roughly print as.
function toRgb(cs, c) {
  const v = (i, d = 0) => num(c[i], d);
  switch (cs.kind) {
    case 'rgb': return [clamp01(v(0)), clamp01(v(1)), clamp01(v(2))];
    case 'cmyk': {
      const k = clamp01(v(3));
      return [(1 - clamp01(v(0))) * (1 - k), (1 - clamp01(v(1))) * (1 - k), (1 - clamp01(v(2))) * (1 - k)];
    }
    case 'indexed': {
      const i = Math.max(0, Math.min(cs.hival, Math.round(v(0))));
      const n = cs.base.n || 1;
      const comps = Array.from({ length: n }, (_, k) => (cs.table[i * n + k] ?? 0) / 255);
      return toRgb(cs.base, comps);
    }
    case 'tint': {
      let t = 0;
      for (let i = 0; i < cs.n; i++) t += clamp01(v(i));
      const g = 1 - Math.min(1, t / cs.n);
      return [g, g, g];
    }
    case 'lab': {
      const g = clamp01(v(0) / 100);
      return [g, g, g];
    }
    case 'pattern': return LIGHT;
    default: {
      const g = clamp01(v(0));
      return [g, g, g];
    }
  }
}
// The colour a space starts with when it is chosen (black, or a full tint).
const initialColor = (cs) => (cs.kind === 'cmyk' ? [0, 0, 0] : cs.kind === 'tint' ? [0, 0, 0] : cs.kind === 'pattern' ? LIGHT : toRgb(cs, [0, 0, 0, 1]));

// The first colour of a shading (or of the shading of a pattern): a flat stand-in for a gradient.
function shadingColor(ctx, sh, resources) {
  const r = (x) => ctx.src.resolve(x);
  sh = r(sh);
  const d = sh instanceof PdfStream ? sh.dict : sh;
  if (!isDict(d)) return LIGHT;
  const cs = colorSpace(ctx, d.ColorSpace ?? d.CS, resources);
  const first = (f, depth = 0) => {
    f = r(f);
    const fd = f instanceof PdfStream ? f.dict : f;
    if (!isDict(fd) || depth > 4) return null;
    const type = r(fd.FunctionType);
    if (type === 2) return toArray(r(fd.C0) ?? [0]).map(r);
    if (type === 3) return first(toArray(r(fd.Functions))[0], depth + 1);
    return null;
  };
  const fn = r(d.Function);
  const comps = Array.isArray(fn) ? fn.map((f) => (first(f) || [0])[0]) : first(fn);
  return comps ? toRgb(cs, comps) : LIGHT;
}

function patternColor(ctx, name, comps, cs, resources) {
  const r = (x) => ctx.src.resolve(x);
  const patterns = isDict(resources) ? r(resources.Pattern) : null;
  const pat = isDict(patterns) ? r(patterns[name]) : null;
  const d = pat instanceof PdfStream ? pat.dict : pat;
  if (!isDict(d)) return LIGHT;
  if (r(d.PatternType) === 2) return shadingColor(ctx, d.Shading, resources);
  // An uncoloured tiling pattern is drawn in the colour given with it; a coloured one, flat grey.
  if (r(d.PaintType) === 2 && cs.base && comps.length) return toRgb(cs.base, comps);
  return LIGHT;
}

// ---------- Pictures ----------
// Unpacks samples of 1, 2, 4, 8 or 16 bits into one byte each, scaled to 0–255 unless they are
// palette indexes.
function unpack(data, w, h, n, bpc, scale) {
  const out = Buffer.alloc(w * h * n);
  if (bpc === 8) {
    data.copy(out, 0, 0, Math.min(data.length, out.length));
    return out;
  }
  const stride = Math.ceil((w * n * bpc) / 8);
  const max = (1 << bpc) - 1;
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let i = 0; i < w * n; i++) {
      let v;
      if (bpc === 16) v = data[row + i * 2] ?? 0;
      else {
        const bit = i * bpc;
        const byte = data[row + (bit >> 3)] ?? 0;
        v = (byte >> (8 - bpc - (bit & 7))) & max;
        if (scale) v = Math.round((v * 255) / max);
      }
      out[y * w * n + i] = v;
    }
  }
  return out;
}

// A picture as a data: URL (a JPEG as it is; anything else as a PNG made here), or null when it
// cannot be shown (too large, or a format browsers do not read).
function imageUrl(ctx, stream, resources, fill) {
  const r = (x) => ctx.src.resolve(x);
  const d = stream.dict;
  const w = r(d.Width ?? d.W);
  const h = r(d.Height ?? d.H);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || w * h > ctx.maxImagePixels) return null;
  const mask = r(d.ImageMask ?? d.IM) === true;
  const { data, image } = decodeStream(ctx.src, stream, w * h * 4 * 2 + 1024 * 1024, true);
  if (image === 'DCTDecode') return data[0] === 0xff && data[1] === 0xd8 ? `data:image/jpeg;base64,${data.toString('base64')}` : null;
  if (image) return null; // JPX, JBIG2, CCITT: browsers cannot show them
  const decode = toArray(r(d.Decode ?? d.D)).map(r);
  const invert = decode.length >= 2 && num(decode[0]) > num(decode[1]);
  if (mask) {
    // A stencil: the fill colour where the bit is 0 (or 1 with Decode [1 0]), clear elsewhere.
    const bits = unpack(data, w, h, 1, 1, false);
    const px = Buffer.alloc(w * h * 4);
    const rgb = fill.map((c) => Math.round(clamp01(c) * 255));
    for (let i = 0; i < w * h; i++) {
      const paint = (bits[i] === 0) !== invert;
      if (paint) { px[i * 4] = rgb[0]; px[i * 4 + 1] = rgb[1]; px[i * 4 + 2] = rgb[2]; px[i * 4 + 3] = 255; }
    }
    return `data:image/png;base64,${encodePng(w, h, 4, px).toString('base64')}`;
  }
  const cs = colorSpace(ctx, d.ColorSpace ?? d.CS, resources);
  const bpc = num(r(d.BitsPerComponent ?? d.BPC), 8);
  if (![1, 2, 4, 8, 16].includes(bpc) || cs.kind === 'pattern') return null;
  const n = cs.n || 1;
  const s = unpack(data, w, h, n, bpc, cs.kind !== 'indexed');
  // To grey or RGB.
  let channels = cs.kind === 'gray' ? 1 : 3;
  let px;
  if (cs.kind === 'gray') {
    px = s;
    if (invert) for (let i = 0; i < px.length; i++) px[i] = 255 - px[i];
  } else if (cs.kind === 'rgb') px = s;
  else {
    px = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      const comps = [];
      for (let k = 0; k < n; k++) comps.push(cs.kind === 'indexed' ? s[i * n + k] : s[i * n + k] / 255);
      // Lab is drawn as the grey of its lightness.
      const v = cs.kind === 'lab' ? [comps[0], comps[0], comps[0]] : toRgb(cs, comps);
      px[i * 3] = Math.round(v[0] * 255);
      px[i * 3 + 1] = Math.round(v[1] * 255);
      px[i * 3 + 2] = Math.round(v[2] * 255);
    }
  }
  // A soft mask of the same size becomes the PNG's alpha.
  const sm = r(d.SMask);
  if (sm instanceof PdfStream && r(sm.dict.Width) === w && r(sm.dict.Height) === h) {
    try {
      const md = decodeStream(ctx.src, sm, w * h * 2 + 1024).data;
      const alpha = unpack(md, w, h, 1, num(r(sm.dict.BitsPerComponent), 8), true);
      const withAlpha = Buffer.alloc(w * h * (channels + 1));
      for (let i = 0; i < w * h; i++) {
        for (let k = 0; k < channels; k++) withAlpha[i * (channels + 1) + k] = px[i * channels + k];
        withAlpha[i * (channels + 1) + channels] = alpha[i];
      }
      px = withAlpha;
      channels += 1;
    } catch { /* drawn without its mask */ }
  }
  return `data:image/png;base64,${encodePng(w, h, channels, px).toString('base64')}`;
}

// ---------- Running a content stream ----------
function newState(ctm) {
  const black = { kind: 'gray', n: 1 };
  return {
    ctm, lw: 1, cap: 0, join: 0, dash: null, fillCS: black, strokeCS: black, fill: [0, 0, 0], stroke: [0, 0, 0], fa: 1, sa: 1,
    font: FALLBACK_FONT, size: 0, Tc: 0, Tw: 0, Th: 1, TL: 0, Ts: 0, Tr: 0, groups: 0,
  };
}

// Runs one content stream (the page's, or a form's) with its resources. `level` is 0 for the
// page itself, 1+ inside forms.
function interpret(ctx, data, resources, level) {
  const r = (x) => ctx.src.resolve(x);
  const out = ctx.out;
  const draw = ctx.draw;
  const stack = [];
  let gs = ctx.gs;
  let path = '';
  let cur = [0, 0]; // the current point in user space (for v and y)
  let start = [0, 0];
  let clip = null;
  let Tm = IDENTITY;
  let Tlm = IDENTITY;
  const res = isDict(resources) ? resources : {};
  const resDict = (key) => {
    const d = r(res[key]);
    return isDict(d) ? d : {};
  };
  const pt = (x, y) => apply(gs.ctm, num(x), num(y));
  const moveTo = (x, y) => { const p = pt(x, y); path += `M${n3(p[0])} ${n3(p[1])}`; cur = start = [num(x), num(y)]; };
  const lineTo = (x, y) => { const p = pt(x, y); path += `L${n3(p[0])} ${n3(p[1])}`; cur = [num(x), num(y)]; };
  const curveTo = (x1, y1, x2, y2, x3, y3) => {
    const a = pt(x1, y1);
    const b = pt(x2, y2);
    const c = pt(x3, y3);
    path += `C${n3(a[0])} ${n3(a[1])} ${n3(b[0])} ${n3(b[1])} ${n3(c[0])} ${n3(c[1])}`;
    cur = [num(x3), num(y3)];
  };
  const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const opacity = (name, a) => (a < 1 ? ` ${name}="${n3(a)}"` : '');

  const paint = (fill, stroke, evenOdd) => {
    if (draw && path && (fill || stroke)) {
      let s = `<path d="${path}" fill="${fill ? hex(gs.fill) : 'none'}"`;
      if (fill && evenOdd) s += ' fill-rule="evenodd"';
      if (fill) s += opacity('fill-opacity', gs.fa);
      if (stroke) {
        const sc = scaleOf(gs.ctm);
        s += ` stroke="${hex(gs.stroke)}" stroke-width="${n3(Math.max(gs.lw * sc, 0.3))}"`;
        if (gs.cap === 1) s += ' stroke-linecap="round"';
        else if (gs.cap === 2) s += ' stroke-linecap="square"';
        if (gs.join === 1) s += ' stroke-linejoin="round"';
        else if (gs.join === 2) s += ' stroke-linejoin="bevel"';
        if (gs.dash && gs.dash.length && gs.dash.some((x) => x > 0)) s += ` stroke-dasharray="${gs.dash.map((x) => n3(x * sc)).join(' ')}"`;
        s += opacity('stroke-opacity', gs.sa);
      }
      out.push(`${s}/>`);
    }
    if (clip && path) startClip(path, clip);
    path = '';
    clip = null;
  };
  // Drawing after a clip (until the Q that ends it) goes in a group clipped to the path.
  const startClip = (d, rule) => {
    if (!draw) return;
    const id = `c${ctx.ids++}`;
    out.push(`<clipPath id="${id}"><path d="${d}"${rule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath><g clip-path="url(#${id})">`);
    gs.groups++;
  };
  const polygon = (m, x0, y0, x1, y1) => {
    const ps = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => apply(m, x, y));
    return `M${ps.map((p) => `${n3(p[0])} ${n3(p[1])}`).join('L')}Z`;
  };
  const save = () => {
    stack.push(gs);
    gs = { ...gs, groups: 0 };
  };
  const restore = () => {
    if (!stack.length) return;
    if (draw) for (let i = 0; i < gs.groups; i++) out.push('</g>');
    gs = stack.pop();
  };
  const setColor = (which, cs, operands) => {
    const comps = operands.filter((x) => typeof x === 'number');
    const last = operands[operands.length - 1];
    const rgb = cs.kind === 'pattern' ? (last instanceof Name ? patternColor(ctx, last.v, comps, cs, res) : LIGHT) : toRgb(cs, comps);
    if (which === 'fill') gs.fill = rgb;
    else gs.stroke = rgb;
  };

  // ----- Text -----
  const showText = (items, op, startAt, endAt) => {
    const font = gs.font || FALLBACK_FONT;
    const size = gs.size;
    const th = gs.Th;
    const startTm = Tm;
    let total = 0; // advance along the text line, in text space (Tm units)
    let text = '';
    const pieces = [];
    let piece = null;
    for (const item of items) {
      if (typeof item === 'number') {
        const d = (-item / 1000) * size * th;
        // A large gap (a column, a word space) starts a new piece of SVG text, so the browser's
        // font cannot spread letters over it; kerning between letters stays inside the piece.
        if (Math.abs(item) > 200) piece = null;
        if (item < -200 && text && !/\s$/.test(text)) text += ' ';
        if (piece) piece.local += th ? d / th : d;
        total += d;
      } else if (item instanceof Bytes) {
        for (const g of glyphsOf(font, item.b)) {
          const tx = ((g.w / 1000) * size + gs.Tc + (g.space ? gs.Tw : 0)) * th;
          if (!piece) { piece = { at: total, text: '', local: 0 }; pieces.push(piece); }
          piece.text += g.text;
          piece.local += th ? tx / th : tx;
          total += tx;
          text += g.text;
        }
      }
    }
    Tm = mul([1, 0, 0, 1, total, 0], startTm);
    const invisible = gs.Tr === 3 || gs.Tr === 7;
    if (draw && !invisible) {
      const stroke = gs.Tr === 1 || gs.Tr === 2 || gs.Tr === 5 || gs.Tr === 6;
      const fillOn = gs.Tr !== 1 && gs.Tr !== 5;
      for (const p of pieces) {
        if (!p.text.trim()) continue;
        // Text space to the root group, with y turned over so the browser's glyphs stand up.
        let m = mul([1, 0, 0, -1, 0, 0], mul([th, 0, 0, 1, 0, gs.Ts], mul(mul([1, 0, 0, 1, p.at, 0], startTm), gs.ctm)));
        // Fold the scale into the font size, so the browser sees a sensible size (some
        // browsers will not draw text at 1px however much it is scaled up).
        const k = Math.hypot(m[2], m[3]) || 1;
        m = [m[0] / k, m[1] / k, m[2] / k, m[3] / k, m[4], m[5]];
        let s = `<text transform="${matrixAttr(m)}" font-family="${CSS_FAMILY[font.family]}" font-size="${n3(size * k)}"`;
        if (font.bold) s += ' font-weight="bold"';
        if (font.italic) s += ' font-style="italic"';
        s += fillOn ? ` fill="${hex(gs.fill)}"${opacity('fill-opacity', gs.fa)}` : ' fill="none"';
        if (stroke) s += ` stroke="${hex(gs.stroke)}" stroke-width="${n3(Math.max(0.3, gs.lw))}"`;
        const len = p.local * k;
        if (len > 0.01) s += ` textLength="${n3(len)}" lengthAdjust="spacingAndGlyphs"`;
        out.push(`${s} xml:space="preserve">${xmlText(p.text)}</text>`);
      }
    }
    // The run: where it starts (its matrix) and the box it covers, in the page box's space.
    const id = level === 0 ? ctx.textOps++ : -(++ctx.formRuns);
    if (level === 0) ctx.ops.push({ id, op, start: startAt, end: endAt, total, size, th });
    if (text.trim()) {
      const m = mul([1, 0, 0, 1, 0, gs.Ts], mul(startTm, gs.ctm));
      m[4] -= ctx.x0;
      m[5] -= ctx.y0;
      const corners = [[0, -0.2 * size], [total, -0.2 * size], [0, 0.8 * size], [total, 0.8 * size]].map(([x, y]) => apply(m, x, y));
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const round = (v) => Math.round(v * 1000) / 1000;
      ctx.runs.push({
        id, text: text.replace(/\s+/g, ' '), // trimmed once the line is put together
        x: round(Math.min(...xs)), y: round(Math.min(...ys)), width: round(Math.max(...xs) - Math.min(...xs)), height: round(Math.max(...ys) - Math.min(...ys)),
        size: round(size), family: font.family, bold: font.bold, italic: font.italic, color: gs.fill.map((c) => round(c)),
        matrix: m.map(round), invisible, editable: level === 0, ops: [id], adv: total,
      });
    }
  };
  const nextLine = () => {
    Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm);
    Tm = Tlm;
  };

  // ----- XObjects -----
  const doXObject = (key) => {
    const xo = r(resDict('XObject')[key]);
    if (!(xo instanceof PdfStream)) return;
    const sub = nameOf(r(xo.dict.Subtype));
    if (sub === 'Image') {
      if (!draw) return;
      const m = mul([1, 0, 0, -1, 0, 1], gs.ctm); // the unit square, first row at the top
      const isMask = r(xo.dict.ImageMask) === true;
      let id = isMask ? null : ctx.images.get(xo);
      if (id === undefined || id === null) {
        let url = null;
        try { url = imageUrl(ctx, xo, res, gs.fill); } catch { url = null; }
        if (!url) {
          id = false;
        } else {
          id = `i${ctx.ids++}`;
          out.push(`<defs><image id="${id}" width="1" height="1" preserveAspectRatio="none" href="${url}"/></defs>`);
        }
        if (!isMask) ctx.images.set(xo, id);
      }
      if (id) out.push(`<use href="#${id}" transform="${matrixAttr(m)}"${opacity('opacity', gs.fa)}/>`);
      else out.push(`<path d="${polygon(gs.ctm, 0, 0, 1, 1)}" fill="${hex(LIGHT)}"/>`);
    } else if ((sub === 'Form' || (sub === null && xo.dict.BBox !== undefined)) && level < MAX_FORM_DEPTH) {
      let content;
      try { content = decodeStream(ctx.src, xo, MAX_CONTENT_BYTES).data; } catch { return; }
      const matrix = toArray(r(xo.dict.Matrix)).map(r);
      save();
      if (matrix.length === 6 && matrix.every((x) => typeof x === 'number')) gs.ctm = mul(matrix, gs.ctm);
      const bbox = toArray(r(xo.dict.BBox)).map(r);
      if (bbox.length === 4 && bbox.every((x) => typeof x === 'number')) startClip(polygon(gs.ctm, Math.min(bbox[0], bbox[2]), Math.min(bbox[1], bbox[3]), Math.max(bbox[0], bbox[2]), Math.max(bbox[1], bbox[3])), 'nonzero');
      const inner = r(xo.dict.Resources);
      const saved = ctx.gs;
      ctx.gs = gs;
      interpret(ctx, content, isDict(inner) ? inner : res, level + 1);
      ctx.gs = saved;
      restore();
    }
  };

  // ----- The loop -----
  const p = new Parser(data);
  let operands = [];
  let opStart = 0;
  while (!ctx.stopped) {
    p.skipSpace();
    if (p.pos >= p.end) break;
    if (!operands.length) opStart = p.pos;
    let v;
    try { v = p.value(0); } catch { break; }
    if (!(v instanceof Keyword)) {
      if (operands.length < 64) operands.push(v);
      continue;
    }
    if (--ctx.opsLeft < 0) { ctx.stopped = true; break; }
    const op = v.v;
    const o = operands;
    const nums = () => o.map((x) => num(x));
    // An operator with operands it cannot use is skipped, as viewers do; the rest of the page is still drawn.
    try {
    switch (op) {
      case 'q': save(); break;
      case 'Q': restore(); break;
      case 'cm': if (o.length >= 6) gs.ctm = mul(nums().slice(-6), gs.ctm); break;
      case 'w': gs.lw = num(o[0], 1); break;
      case 'J': gs.cap = num(o[0]); break;
      case 'j': gs.join = num(o[0]); break;
      case 'd': gs.dash = Array.isArray(o[0]) ? o[0].map((x) => Math.abs(num(r(x)))) : null; break;
      case 'gs': {
        const e = r(resDict('ExtGState')[o[0] instanceof Name ? o[0].v : '']);
        if (isDict(e)) {
          if (typeof r(e.ca) === 'number') gs.fa = clamp01(r(e.ca));
          if (typeof r(e.CA) === 'number') gs.sa = clamp01(r(e.CA));
          if (typeof r(e.LW) === 'number') gs.lw = r(e.LW);
        }
        break;
      }
      // Colour
      case 'g': gs.fillCS = { kind: 'gray', n: 1 }; gs.fill = toRgb(gs.fillCS, nums()); break;
      case 'G': gs.strokeCS = { kind: 'gray', n: 1 }; gs.stroke = toRgb(gs.strokeCS, nums()); break;
      case 'rg': gs.fillCS = { kind: 'rgb', n: 3 }; gs.fill = toRgb(gs.fillCS, nums()); break;
      case 'RG': gs.strokeCS = { kind: 'rgb', n: 3 }; gs.stroke = toRgb(gs.strokeCS, nums()); break;
      case 'k': gs.fillCS = { kind: 'cmyk', n: 4 }; gs.fill = toRgb(gs.fillCS, nums()); break;
      case 'K': gs.strokeCS = { kind: 'cmyk', n: 4 }; gs.stroke = toRgb(gs.strokeCS, nums()); break;
      case 'cs': gs.fillCS = colorSpace(ctx, o[0], res); gs.fill = initialColor(gs.fillCS); break;
      case 'CS': gs.strokeCS = colorSpace(ctx, o[0], res); gs.stroke = initialColor(gs.strokeCS); break;
      case 'sc': case 'scn': setColor('fill', gs.fillCS, o); break;
      case 'SC': case 'SCN': setColor('stroke', gs.strokeCS, o); break;
      // Paths
      case 'm': moveTo(o[0], o[1]); break;
      case 'l': lineTo(o[0], o[1]); break;
      case 'c': curveTo(o[0], o[1], o[2], o[3], o[4], o[5]); break;
      case 'v': curveTo(cur[0], cur[1], o[0], o[1], o[2], o[3]); break;
      case 'y': curveTo(o[0], o[1], o[2], o[3], o[2], o[3]); break;
      case 'h': if (path) { path += 'Z'; cur = start; } break;
      case 're': {
        const [x, y, w, h] = nums();
        path += polygon(gs.ctm, x, y, x + w, y + h);
        cur = start = [x, y];
        break;
      }
      case 'S': paint(false, true, false); break;
      case 's': if (path) path += 'Z'; paint(false, true, false); break;
      case 'f': case 'F': paint(true, false, false); break;
      case 'f*': paint(true, false, true); break;
      case 'B': paint(true, true, false); break;
      case 'B*': paint(true, true, true); break;
      case 'b': if (path) path += 'Z'; paint(true, true, false); break;
      case 'b*': if (path) path += 'Z'; paint(true, true, true); break;
      case 'n': paint(false, false, false); break;
      case 'W': clip = 'nonzero'; break;
      case 'W*': clip = 'evenodd'; break;
      case 'sh': {
        if (!draw) break;
        const sh = r(resDict('Shading')[o[0] instanceof Name ? o[0].v : '']);
        const d = sh instanceof PdfStream ? sh.dict : sh;
        const bbox = isDict(d) ? toArray(r(d.BBox)).map(r) : [];
        const area = bbox.length === 4 && bbox.every((x) => typeof x === 'number')
          ? polygon(gs.ctm, bbox[0], bbox[1], bbox[2], bbox[3])
          : polygon(IDENTITY, ctx.x0, ctx.y0, ctx.x1, ctx.y1);
        out.push(`<path d="${area}" fill="${hex(shadingColor(ctx, sh, res))}"${opacity('fill-opacity', gs.fa)}/>`);
        break;
      }
      // Text
      case 'BT': Tm = Tlm = IDENTITY; break;
      case 'ET': break;
      case 'Tf': {
        const f = r(resDict('Font')[o[0] instanceof Name ? o[0].v : '']);
        if (isDict(f)) {
          let font = ctx.fonts.get(f);
          if (!font) {
            try { font = loadFont(ctx.src, f); } catch { font = FALLBACK_FONT; }
            ctx.fonts.set(f, font);
          }
          gs.font = font;
        } else gs.font = FALLBACK_FONT;
        gs.size = num(o[1]);
        break;
      }
      case 'Tc': gs.Tc = num(o[0]); break;
      case 'Tw': gs.Tw = num(o[0]); break;
      case 'Tz': gs.Th = num(o[0], 100) / 100; break;
      case 'TL': gs.TL = num(o[0]); break;
      case 'Ts': gs.Ts = num(o[0]); break;
      case 'Tr': gs.Tr = num(o[0]); break;
      case 'Td': Tlm = mul([1, 0, 0, 1, num(o[0]), num(o[1])], Tlm); Tm = Tlm; break;
      case 'TD': gs.TL = -num(o[1]); Tlm = mul([1, 0, 0, 1, num(o[0]), num(o[1])], Tlm); Tm = Tlm; break;
      case 'Tm': if (o.length >= 6) { Tm = Tlm = nums().slice(-6); } break;
      case 'T*': nextLine(); break;
      case 'Tj': showText([o[o.length - 1]], op, opStart, p.pos); break;
      case 'TJ': showText(Array.isArray(o[o.length - 1]) ? o[o.length - 1].map(r) : [], op, opStart, p.pos); break;
      case "'": nextLine(); showText([o[o.length - 1]], op, opStart, p.pos); break;
      case '"':
        gs.Tw = num(o[0]);
        gs.Tc = num(o[1]);
        nextLine();
        showText([o[2]], op, opStart, p.pos);
        break;
      // Pictures and forms
      case 'Do': if (o[0] instanceof Name) doXObject(o[0].v); break;
      case 'BI': {
        // An inline picture: its dictionary, "ID", the bytes, "EI". The bytes are skipped (their
        // length is known when they are not compressed; otherwise "EI" between white space is
        // looked for) and a grey box stands in for the picture.
        const dict = {};
        for (;;) {
          p.skipSpace();
          if (p.pos >= p.end) break;
          const k = p.value(0);
          if (k instanceof Keyword) break; // ID
          const val = p.value(0);
          if (k instanceof Name) dict[k.v] = val;
        }
        let at = p.pos + 1;
        const w = num(r(dict.W ?? dict.Width));
        const h = num(r(dict.H ?? dict.Height));
        const bpc = num(r(dict.BPC ?? dict.BitsPerComponent), 8);
        const csName = nameOf(r(dict.CS ?? dict.ColorSpace)) || 'G';
        const ncomp = r(dict.IM ?? dict.ImageMask) === true ? 1 : /RGB/.test(csName) ? 3 : /CMYK/.test(csName) ? 4 : 1;
        const known = !(dict.F ?? dict.Filter) ? Math.ceil((w * ncomp * (r(dict.IM ?? dict.ImageMask) === true ? 1 : bpc)) / 8) * h : -1;
        const endsAt = (i) => i >= 0 && WHITE[data[i - 1]] && data[i] === 0x45 && data[i + 1] === 0x49 && (i + 2 >= data.length || !isRegular(data[i + 2]));
        let ei = -1;
        if (known >= 0) {
          let j = at + known;
          while (j < data.length && WHITE[data[j]] && j < at + known + 4) j++;
          if (endsAt(j)) ei = j;
        }
        for (let i = at; ei < 0 && i < data.length;) {
          i = data.indexOf('EI', i, 'latin1');
          if (i < 0) break;
          if (endsAt(i)) ei = i;
          else i += 2;
        }
        p.pos = ei < 0 ? data.length : ei + 2;
        if (draw) out.push(`<path d="${polygon(gs.ctm, 0, 0, 1, 1)}" fill="${hex(LIGHT)}"/>`);
        break;
      }
      default: break; // marked content, compatibility sections, Type3 glyph operators: nothing to draw
    }
    } catch { /* see above */ }
    operands = [];
  }
  // Groups left open by a stream that does not restore what it saved.
  while (stack.length) restore();
  ctx.gs = gs;
}

// The page's content streams, decoded and joined (each followed by a line break, so an operator
// cannot run into the next stream's first one).
function pageContent(src, page) {
  const contents = src.resolve(page.dict.Contents);
  const streams = (Array.isArray(contents) ? contents.map((c) => src.resolve(c)) : [contents]).filter((s) => s instanceof PdfStream);
  const parts = [];
  let total = 0;
  for (const s of streams) {
    let data = Buffer.alloc(0);
    try { data = decodeStream(src, s, MAX_CONTENT_BYTES).data; } catch { data = Buffer.alloc(0); }
    total += data.length + 1;
    if (total > MAX_CONTENT_BYTES) throw new Error('This page is too large to draw.');
    parts.push(data, Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}

function runPage(doc, index, { maxImagePixels = 4_000_000, maxOps = 400_000, draw = true } = {}) {
  const info = pageInternals(doc, index);
  if (!info) throw new Error(`This document has no page ${Number(index) + 1}.`);
  const { src, page, media, crop, rotate } = info;
  const box = crop || media;
  const ctx = {
    src, draw, out: [], runs: [], ops: [], fonts: new Map(), images: new Map(), ids: 0, textOps: 0, formRuns: 0,
    opsLeft: maxOps, stopped: false, maxImagePixels, x0: box[0], y0: box[1], x1: box[2], y1: box[3], gs: newState(IDENTITY),
  };
  const data = pageContent(src, page);
  const resources = src.resolve(page.attrs.Resources);
  interpret(ctx, data, isDict(resources) ? resources : {}, 0);
  for (let i = 0; i < ctx.gs.groups; i++) ctx.out.push('</g>');
  // What the page's annotations show (filled-in fields, ticks, stamps), as the export draws them.
  if (draw) {
    const ann = pageAnnotations(doc, index);
    if (ann.length) {
      ctx.gs = newState(IDENTITY);
      interpret(ctx, Buffer.from(ann.map((a) => a.ops).join('\n'), 'latin1'), { XObject: Object.fromEntries(ann.map((a) => [a.key, a.stream])) }, 0);
      for (let i = 0; i < ctx.gs.groups; i++) ctx.out.push('</g>');
    }
  }
  ctx.runs = intoLines(ctx.runs);
  return { ctx, data, box, rotate };
}

// Text operators that make one line, joined into one run. Many programs (CORE's own layout among
// them) show a line a word or a few letters at a time; people mean the line when they change one.
// A run joins the one before when it is on the same baseline, in the same direction and size, and
// starts where that one ended (give or take a couple of spaces; a wider gap is another column).
// The joined run keeps the first operator's id and lists every operator in `ops`.
function intoLines(runs) {
  const out = [];
  for (const r of runs) {
    const a = out[out.length - 1];
    if (a && a.editable === r.editable && a.invisible === r.invisible && sameLine(a, r)) {
      const [u] = a.place;
      const gap = u - a.adv;
      const space = gap > 0.15 * a.size && !/\s$/.test(a.text) && !/^\s/.test(r.text);
      a.text = `${a.text}${space ? ' ' : ''}${r.text}`;
      const x1 = Math.max(a.x + a.width, r.x + r.width);
      const y1 = Math.max(a.y + a.height, r.y + r.height);
      a.x = Math.min(a.x, r.x);
      a.y = Math.min(a.y, r.y);
      a.width = Math.round((x1 - a.x) * 1000) / 1000;
      a.height = Math.round((y1 - a.y) * 1000) / 1000;
      a.adv = u + r.adv;
      a.ops.push(...r.ops);
    } else out.push(r);
  }
  for (const r of out) {
    r.text = r.text.trim();
    delete r.adv;
    delete r.place;
  }
  return out;
}
// Whether run b continues run a's line; a.place is set to b's start in a's text space.
function sameLine(a, b) {
  const ma = a.matrix;
  const mb = b.matrix;
  for (let i = 0; i < 4; i++) if (Math.abs(ma[i] * a.size - mb[i] * b.size) > 0.02 * Math.max(1, Math.abs(a.size * Math.hypot(ma[0], ma[1])))) return false;
  const det = ma[0] * ma[3] - ma[1] * ma[2];
  if (!det || !a.size) return false;
  // b's origin in a's text space (the inverse of a's matrix).
  const dx = mb[4] - ma[4];
  const dy = mb[5] - ma[5];
  const u = (dx * ma[3] - dy * ma[2]) / det;
  const v = (dy * ma[0] - dx * ma[1]) / det;
  a.place = [u, v];
  return Math.abs(v) < 0.2 * a.size && u > a.adv - 0.3 * a.size && u < a.adv + 1.5 * a.size;
}

const blankSvg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n3(w)} ${n3(h)}" width="${n3(w)}" height="${n3(h)}"><rect width="${n3(w)}" height="${n3(h)}" fill="#ffffff"/></svg>`;

// The page as SVG and its text runs. Never throws: a page that cannot be drawn is a white page
// with `error` saying why.
export function renderPage(doc, index, options = {}) {
  let width = 612;
  let height = 792;
  let rotate = 0;
  try {
    const info = pageInternals(doc, index);
    if (info) {
      const b = info.crop || info.media;
      width = b[2] - b[0];
      height = b[3] - b[1];
      rotate = info.rotate;
    }
    const { ctx, box } = runPage(doc, index, options);
    const w = n3(box[2] - box[0]);
    const h = n3(box[3] - box[1]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/><g transform="matrix(1 0 0 -1 ${n3(-box[0])} ${n3(box[3])})">${ctx.out.join('')}</g></svg>`;
    const result = { width: Math.round(width * 1000) / 1000, height: Math.round(height * 1000) / 1000, rotate, svg, runs: ctx.runs };
    if (ctx.stopped) result.error = 'This page has more drawing than can be shown; part of it is missing.';
    return result;
  } catch (err) {
    return { width: Math.round(width * 1000) / 1000, height: Math.round(height * 1000) / 1000, rotate, svg: blankSvg(width, height), runs: [], error: err && err.message ? err.message : 'This page could not be drawn.' };
  }
}

// A number for a content stream: at most four decimals, no exponent.
const fmt = (v) => {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
};

// The page's content with the text operators `ids` (renderPage's run ids) taken out: each is
// replaced by a TJ of one number that moves the text position as far as the text did, so what
// follows on the line stays where it was. Everything else is copied byte for byte. Returns the
// new content (uncompressed), for one new stream that replaces the page's /Contents.
export function removeTextOps(doc, index, ids) {
  const { ctx, data } = runPage(doc, index, { draw: false, maxOps: 10_000_000 });
  // A run's id stands for its whole line (every operator in it); any other id is one operator.
  const lines = new Map(ctx.runs.filter((r) => r.editable).map((r) => [r.id, r.ops]));
  const wanted = new Set();
  for (const id of Array.from(ids || [], Number)) for (const op of lines.get(id) || [id]) wanted.add(op);
  const parts = [];
  let at = 0;
  for (const op of ctx.ops) {
    if (!wanted.has(op.id)) continue;
    const scale = op.size * op.th;
    const move = scale ? `[${fmt((-op.total * 1000) / scale)}] TJ` : '[] TJ';
    let replacement = move;
    if (op.op === "'") replacement = `T* ${move}`;
    else if (op.op === '"') {
      // The two numbers before the string set word and character spacing, which still count.
      const p = new Parser(data, op.start, op.end);
      const aw = num(p.value(0));
      const ac = num(p.value(0));
      replacement = `${fmt(aw)} Tw ${fmt(ac)} Tc T* ${move}`;
    }
    parts.push(data.subarray(at, op.start), Buffer.from(replacement, 'latin1'));
    at = op.end;
  }
  parts.push(data.subarray(at));
  return Buffer.concat(parts);
}
