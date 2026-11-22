// PDF Studio (0.66): a CCITT fax decoder (ITU-T T.4 Group 3 and T.6 Group 4), as PDF's
// CCITTFaxDecode filter decodes it (PDF 32000-1 §7.4.6). Scanners and fax software store bilevel
// (black-and-white) pages this way, in PDFs and in TIFF files; browsers cannot read it, so pages
// scanned like this were grey boxes in PDF Studio.
//
// decodeCcitt(data, options) → { width, height, bits, rows, error }
//   options (the filter's DecodeParms, in lower camel case):
//     K                 < 0: Group 4 (two-dimensional only); 0: Group 3 one-dimensional (Modified
//                       Huffman); > 0: Group 3 mixed, each line one- or two-dimensional (a tag bit
//                       after each end-of-line code says which)
//     columns           pixels in a row (default 1728, a fax line)
//     rows              rows in the picture; 0 = until the data or an end-of-block code ends
//     blackIs1          false (the default): a 0 bit is black in the output, as PDF says
//     encodedByteAlign  every coded line starts on a byte boundary
//     endOfBlock        the data may end with an end-of-block code (RTC in Group 3, EOFB in Group 4)
//     endOfLine         every line starts with an end-of-line code (they are skipped either way)
//     maxPixels         the most pixels decoded (default 100 million; a larger picture is an Error)
//   bits: the picture, one bit a pixel, rows packed from the most significant bit and padded to a
//   whole byte (Math.ceil(width / 8) bytes a row): exactly the bytes CCITTFaxDecode puts out, so a
//   1-bit DeviceGray image or an image mask reads them as they are.
//   height: `rows` when it was given (rows the data did not reach are white), else the rows decoded.
//   rows: the rows actually decoded. error: why decoding stopped early (damaged data), or null.
//
// Damaged data never throws: decoding stops at the first row that cannot be read and keeps the rows
// before it. Only impossible parameters (no columns, too many pixels) are Errors.

const fail = (msg) => {
  throw Object.assign(new Error(msg), { status: 400 });
};

// ---------- Code tables (T.4 tables 2 and 3, and the extended make-up codes of table 3a) ----------
const WHITE_TERM = [
  '00110101', '000111', '0111', '1000', '1011', '1100', '1110', '1111', '10011', '10100', '00111', '01000', '001000', '000011', '110100', '110101',
  '101010', '101011', '0100111', '0001100', '0001000', '0010111', '0000011', '0000100', '0101000', '0101011', '0010011', '0100100', '0011000', '00000010', '00000011', '00011010',
  '00011011', '00010010', '00010011', '00010100', '00010101', '00010110', '00010111', '00101000', '00101001', '00101010', '00101011', '00101100', '00101101', '00000100', '00000101', '00001010',
  '00001011', '01010010', '01010011', '01010100', '01010101', '00100100', '00100101', '01011000', '01011001', '01011010', '01011011', '01001010', '01001011', '00110010', '00110011', '00110100',
];
const WHITE_MAKEUP = [ // 64, 128, … 1728
  '11011', '10010', '010111', '0110111', '00110110', '00110111', '01100100', '01100101', '01101000', '01100111', '011001100', '011001101', '011010010', '011010011',
  '011010100', '011010101', '011010110', '011010111', '011011000', '011011001', '011011010', '011011011', '010011000', '010011001', '010011010', '011000', '010011011',
];
const BLACK_TERM = [
  '0000110111', '010', '11', '10', '011', '0011', '0010', '00011', '000101', '000100', '0000100', '0000101', '0000111', '00000100', '00000111', '000011000',
  '0000010111', '0000011000', '0000001000', '00001100111', '00001101000', '00001101100', '00000110111', '00000101000', '00000010111', '00000011000', '000011001010', '000011001011', '000011001100', '000011001101', '000001101000', '000001101001',
  '000001101010', '000001101011', '000011010010', '000011010011', '000011010100', '000011010101', '000011010110', '000011010111', '000001101100', '000001101101', '000011011010', '000011011011', '000001010100', '000001010101', '000001010110', '000001010111',
  '000001100100', '000001100101', '000001010010', '000001010011', '000000100100', '000000110111', '000000111000', '000000100111', '000000101000', '000001011000', '000001011001', '000000101011', '000000101100', '000001011010', '000001100110', '000001100111',
];
const BLACK_MAKEUP = [ // 64, 128, … 1728
  '0000001111', '000011001000', '000011001001', '000001011011', '000000110011', '000000110100', '000000110101', '0000001101100', '0000001101101', '0000001001010', '0000001001011', '0000001001100', '0000001001101', '0000001110010',
  '0000001110011', '0000001110100', '0000001110101', '0000001110110', '0000001110111', '0000001010010', '0000001010011', '0000001010100', '0000001010101', '0000001011010', '0000001011011', '0000001100100', '0000001100101',
];
const EXT_MAKEUP = [ // 1792, 1856, … 2560: the same for both colours
  '00000001000', '00000001100', '00000001101', '000000010010', '000000010011', '000000010100', '000000010101', '000000010110', '000000010111', '000000011100', '000000011101', '000000011110', '000000011111',
];
const PEEK = 13; // the longest run-length code (black make-up) is 13 bits

// A table indexed by the next 13 bits: run * 16 + code length, or -1.
function runTable(term, makeup) {
  const t = new Int32Array(1 << PEEK).fill(-1);
  const put = (code, run) => {
    const len = code.length;
    const v = parseInt(code, 2) << (PEEK - len);
    for (let i = 0; i < 1 << (PEEK - len); i++) t[v + i] = run * 16 + len;
  };
  term.forEach((c, i) => put(c, i));
  makeup.forEach((c, i) => put(c, (i + 1) * 64));
  EXT_MAKEUP.forEach((c, i) => put(c, 1792 + i * 64));
  return t;
}
let WHITE = null;
let BLACK = null;

// Two-dimensional mode codes (T.4 table 4), by the next 7 bits: mode * 8 + code length.
const PASS = 1;
const HORIZ = 2; // the vertical modes, a1 = b1 + d for d in -3…3, are stored as 10 + d
const MODES = (() => {
  const t = new Int16Array(128).fill(-1);
  const put = (code, mode) => {
    const v = parseInt(code, 2) << (7 - code.length);
    for (let i = 0; i < 1 << (7 - code.length); i++) t[v + i] = mode * 8 + code.length;
  };
  put('0001', PASS);
  put('001', HORIZ);
  put('1', 10);
  put('011', 11); put('000011', 12); put('0000011', 13);
  put('010', 9); put('000010', 8); put('0000010', 7);
  return t;
})();
const EOL = 1; // 000000000001

export function decodeCcitt(data, { K = 0, columns = 1728, rows = 0, blackIs1 = false, encodedByteAlign = false, endOfBlock = true, endOfLine = false, maxPixels = 100_000_000 } = {}) {
  if (!WHITE) {
    WHITE = runTable(WHITE_TERM, WHITE_MAKEUP);
    BLACK = runTable(BLACK_TERM, BLACK_MAKEUP);
  }
  const buf = data instanceof Uint8Array ? data : Buffer.from(data || []);
  const width = Math.floor(Number(columns));
  const wantRows = Math.max(0, Math.floor(Number(rows) || 0));
  if (!Number.isFinite(width) || width < 1 || width > 1_000_000) fail('This fax picture has an impossible width.');
  if (wantRows && width * wantRows > maxPixels) fail(`This fax picture is too large (more than ${Math.round(maxPixels / 1e6)} megapixels).`);
  const maxRows = wantRows || Math.max(1, Math.floor(maxPixels / width));
  const k = Math.floor(Number(K) || 0);
  const stride = (width + 7) >> 3;
  const whiteByte = blackIs1 ? 0x00 : 0xff;
  let out = Buffer.alloc(stride * (wantRows || Math.min(maxRows, 64)), whiteByte);

  // ----- Bits, most significant first; past the end they read as 0 -----
  const totalBits = buf.length * 8;
  let pos = 0;
  const peek = (n) => {
    const i = pos >>> 3;
    const v = ((buf[i] ?? 0) << 16) | ((buf[i + 1] ?? 0) << 8) | (buf[i + 2] ?? 0);
    return (v >>> (24 - (pos & 7) - n)) & ((1 << n) - 1);
  };
  const skip = (n) => { pos += n; };
  // Only zero bits from here to the end (padding after the last row).
  const restIsZero = () => {
    if (pos >= totalBits) return true;
    if (buf[pos >>> 3] & (0xff >> (pos & 7))) return false;
    for (let i = (pos >>> 3) + 1; i < buf.length; i++) if (buf[i]) return false;
    return true;
  };
  const align = () => { pos = (pos + 7) & ~7; };
  // Zero bits (fill) up to an end-of-line code: true when one was found and skipped.
  const skipEol = (anyBits) => {
    if (anyBits) {
      while (pos < totalBits && peek(12) !== EOL) pos++;
    } else {
      while (pos < totalBits && peek(12) === 0) pos++;
    }
    if (pos < totalBits && peek(12) === EOL) {
      pos += 12;
      return true;
    }
    return false;
  };

  // One run (make-up codes and the terminating code after them); -1 when no code matches.
  const run = (black) => {
    const table = black ? BLACK : WHITE;
    let total = 0;
    for (;;) {
      if (pos >= totalBits) return -1;
      const e = table[peek(PEEK)];
      if (e < 0) return -1;
      pos += e & 15;
      const n = e >> 4;
      total += n;
      if (n < 64) return total;
      if (total > width + 2560) return -1;
    }
  };

  // ----- Rows as lists of changing elements (where the colour changes) -----
  let ref = new Int32Array(width + 4);
  let cur = new Int32Array(width + 4);
  ref[0] = width; ref[1] = width; // the line above the first: all white
  let refLen = 2;
  let curLen = 0;
  const push = (x) => {
    if (curLen >= width + 2) return false;
    cur[curLen++] = Math.min(x, width);
    return true;
  };

  // A one-dimensional (Modified Huffman) row. Returns null or why it failed.
  const row1D = () => {
    let a0 = 0;
    let black = false;
    while (a0 < width) {
      if (peek(12) === EOL) { // a row cut short: the rest is white, as fax machines print it
        if (black) push(a0);
        break;
      }
      const n = run(black);
      if (n < 0) return 'a run-length code is not valid';
      a0 += n;
      if (!push(a0)) return 'a row has too many changes';
      black = !black;
    }
    return null;
  };
  // A two-dimensional row, coded against the row above (ref).
  const row2D = () => {
    let a0 = -1;
    let black = false;
    let i = 0; // where to look for b1 on the reference row
    while (a0 < width) {
      // b1: the first change on the reference row right of a0 to the opposite colour of a0's
      // (changes alternate white→black, black→white, so it is an even one when a0 is white).
      while (i > 0 && ref[i - 1] > a0) i--;
      while (i < refLen && (ref[i] <= a0 || (i & 1) !== (black ? 1 : 0))) i++;
      const b1 = i < refLen ? ref[i] : width;
      const b2 = i + 1 < refLen ? ref[i + 1] : width;
      if (pos >= totalBits) return 'the data ends in the middle of a row';
      if (peek(12) === EOL) { // cut short (see row1D)
        if (black) push(Math.max(0, a0));
        break;
      }
      const m = MODES[peek(7)];
      if (m < 0) return 'a coding mode is not valid';
      pos += m & 7;
      const mode = m >> 3;
      if (mode === PASS) {
        a0 = b2;
      } else if (mode === HORIZ) {
        const start = Math.max(0, a0);
        const r1 = run(black);
        const r2 = r1 < 0 ? -1 : run(!black);
        if (r1 < 0 || r2 < 0) return 'a run-length code is not valid';
        const a1 = start + r1;
        const a2 = a1 + r2;
        if (!push(a1) || !push(a2)) return 'a row has too many changes';
        a0 = a2;
      } else {
        const a1 = b1 + (mode - 10);
        if (a1 < Math.max(0, a0) || a1 > width) return 'a vertical code points outside the row';
        if (!push(a1)) return 'a row has too many changes';
        a0 = a1;
        black = !black;
      }
    }
    return null;
  };
  // The row's pixels into the output.
  const paint = (y) => {
    const base = y * stride;
    for (let j = 0; j < curLen; j += 2) {
      const s = cur[j];
      const e = j + 1 < curLen ? cur[j + 1] : width;
      if (e > s) setRun(out, base, s, Math.min(e, width), !blackIs1);
    }
  };

  // ----- The rows -----
  let error = null;
  let y = 0;
  let eolSeen = Boolean(endOfLine);
  // Zero fill and an end-of-line code before the first row.
  while (pos < totalBits && peek(12) === 0) pos++;
  if (pos < totalBits && peek(12) === EOL) {
    pos += 12;
    eolSeen = true;
  }
  let twoD = k < 0;
  if (k > 0) {
    twoD = peek(1) === 0;
    skip(1);
  }
  while (y < maxRows) {
    if (pos >= totalBits || (peek(12) === 0 && restIsZero())) break;
    curLen = 0;
    const why = twoD ? row2D() : row1D();
    if (why) {
      error = `Row ${y + 1}: ${why}.`;
      break;
    }
    if (y * stride + stride > out.length) {
      const grown = Buffer.alloc(Math.min(maxRows, Math.max(y + 1, (out.length / stride) * 2)) * stride, whiteByte);
      out.copy(grown);
      out = grown;
    }
    paint(y);
    y++;
    // This row is the next one's reference.
    const t = ref;
    ref = cur;
    cur = t;
    refLen = curLen;
    ref[refLen] = width;
    ref[refLen + 1] = width;
    refLen += 2;
    if (!endOfBlock && wantRows && y >= wantRows) break;
    // End of line, fill bits, byte alignment, end of block.
    let gotEol = false;
    // (With EncodedByteAlign and no end-of-line codes, zeros at the end of a row are fill: an
    // end-of-line code is only looked for when there are some.)
    if (eolSeen || !encodedByteAlign) gotEol = skipEol(Boolean(endOfLine));
    if (encodedByteAlign && !gotEol) align();
    if (gotEol) {
      eolSeen = true;
      if (peek(12) === EOL || (k > 0 && peek(13) === ((1 << 12) | EOL))) break; // RTC or EOFB
    } else if (endOfBlock && peek(12) === EOL) break;
    if (k > 0) {
      twoD = peek(1) === 0;
      skip(1);
    } else if (k === 0) twoD = false;
  }

  const height = wantRows || y;
  if (out.length !== height * stride) {
    const fit = Buffer.alloc(height * stride, whiteByte);
    out.copy(fit, 0, 0, Math.min(out.length, fit.length));
    out = fit;
  }
  return { width, height, bits: out, rows: y, error };
}

// Sets pixels [s, e) of the row at `base` to black: bit 0 (blackIs0) or bit 1.
function setRun(out, base, s, e, blackIs0) {
  let i = base + (s >> 3);
  const last = base + ((e - 1) >> 3);
  const head = 0xff >> (s & 7);
  const tail = (0xff << (7 - ((e - 1) & 7))) & 0xff;
  if (i === last) {
    const m = head & tail;
    out[i] = blackIs0 ? out[i] & ~m : out[i] | m;
    return;
  }
  out[i] = blackIs0 ? out[i] & ~head : out[i] | head;
  for (i++; i < last; i++) out[i] = blackIs0 ? 0x00 : 0xff;
  out[last] = blackIs0 ? out[last] & ~tail : out[last] | tail;
}
