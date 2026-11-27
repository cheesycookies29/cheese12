// QR codes for CUSTOM APP's event invitations (0.74): ISO/IEC 18004 Model 2, byte mode, error
// correction L, M, Q or H (M by default), the smallest version 1 to 40 that holds the text, all
// eight masks scored with the four penalty rules and the lowest chosen, and the format and version
// information with their BCH codes. Pure JavaScript, no dependency.
//
//   qrMatrix(text, { ecl, mask }) → { version, ecl, mask, size, modules: boolean[size][size] }
//   qrSvg(text, { scale, quiet, ... })  an SVG string (one path), with the quiet zone
//   qrPng(text, { scale, quiet, ... })  a PNG Buffer, black on white, with the quiet zone
// The quiet zone is 4 modules on every side (the standard's minimum). The browser has its own copy
// of a QR encoder (public/js/vendor/qrcode.js); test/customapp-qr.test.js checks the two agree.
import { encodePng } from '../pdf/render.js';

const ECL = Object.freeze({ L: 0, M: 1, Q: 2, H: 3 });
const FORMAT_BITS = [1, 0, 3, 2]; // L, M, Q, H as the format information writes them
// Error correction codewords per block, and number of blocks, by level then version (ISO/IEC
// 18004:2015, table 9). Index 0 is unused.
const ECC_PER_BLOCK = [
  [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const BLOCKS = [
  [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
const PENALTY = Object.freeze({ N1: 3, N2: 3, N3: 40, N4: 10 });
export const QR_QUIET = 4;

// Modules that carry data (and error correction) in a version: all of them minus the function
// patterns (finders with separators, timing, alignment, format and version information).
export function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
export const dataCodewords = (ver, ecl) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * BLOCKS[ecl][ver];
// Byte mode: a 4-bit mode, then the byte count in 8 bits (versions 1 to 9) or 16 bits (10 to 40).
const countBits = (ver) => (ver <= 9 ? 8 : 16);
export const capacityBytes = (ver, ecl) => Math.floor((dataCodewords(ver, ecl) * 8 - 4 - countBits(ver)) / 8);

// ----- Reed-Solomon over GF(256), polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d) -----
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const out = new Array(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < out.length) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return out;
}
function rsRemainder(data, divisor) {
  const out = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ out.shift();
    out.push(0);
    for (let i = 0; i < divisor.length; i++) out[i] ^= gfMul(divisor[i], factor);
  }
  return out;
}

// The codewords of the symbol in their final order: data in byte mode, terminator and padding, split
// into blocks, each block's error correction, then interleaved.
function codewords(bytes, ver, ecl) {
  const bits = [];
  const put = (v, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, countBits(ver));
  for (const b of bytes) put(b, 8);
  const capBits = dataCodewords(ver, ecl) * 8;
  put(0, Math.min(4, capBits - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCodewords(ver, ecl); pad ^= 0xec ^ 0x11) data.push(pad);

  const nBlocks = BLOCKS[ecl][ver];
  const eccLen = ECC_PER_BLOCK[ecl][ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const nShort = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const len = shortLen - eccLen + (i < nShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    blocks.push({ dat, ecc: rsRemainder(dat, divisor) });
  }
  const out = [];
  const longest = shortLen - eccLen + 1;
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.dat.length) out.push(b.dat[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.ecc[i]);
  return out;
}

export function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

// The 15 format bits (level and mask, BCH(15,5), XOR 0x5412) and the 18 version bits (BCH(18,6)).
export function formatBits(ecl, mask) {
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}
export function versionBits(ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | (rem & 0xfff);
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// The symbol before masking: function patterns placed (and marked), the codewords laid in the
// two-column zigzag from the bottom right. Format bits are drawn per mask.
function baseSymbol(ver, cw) {
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    m[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = alignmentPositions(ver);
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // Reserve the format areas (drawn per mask below) and the dark module.
  drawFormat(set, size, 0);
  if (ver >= 7) {
    const bits = versionBits(ver);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && i < cw.length * 8) {
          m[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
  return { size, m, fn };
}
function drawFormat(set, size, bits) {
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}
function applyMask(base, ecl, mask) {
  const { size, m, fn } = base;
  const out = m.map((row, y) => row.map((v, x) => (fn[y][x] ? v : v !== MASKS[mask](x, y))));
  drawFormat((x, y, dark) => (out[y][x] = dark), size, formatBits(ecl, mask));
  return out;
}

// The four penalty rules of ISO/IEC 18004 7.8.3, read as Project Nayuki's reference encoder reads
// them: a run of five or more modules of one colour scores N1 plus 1 per module over five; each 2 x 2
// block of one colour N2; each finder-like pattern N3, that is dark, light, dark, light, dark runs in
// the ratio 1:1:3:1:1 bounded by light, with a light run of at least 4 (times the unit) on one side
// (outside the symbol counts as light, as the quiet zone is); and N4 for each full 5% the dark share
// is away from 50%.
export function penalty(mod) {
  const size = mod.length;
  let score = 0;
  const addHistory = (len, h) => {
    if (h[0] === 0) len += size; // the light border before the first run
    h.pop();
    h.unshift(len);
  };
  const countPatterns = (h) => {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  };
  const line = (get) => {
    let color = false;
    let run = 0;
    const h = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < size; i++) {
      if (get(i) === color) {
        run++;
        if (run === 5) score += PENALTY.N1;
        else if (run > 5) score++;
      } else {
        addHistory(run, h);
        if (!color) score += countPatterns(h) * PENALTY.N3;
        color = get(i);
        run = 1;
      }
    }
    // The end of the line: close a dark run, then the light border after it.
    if (color) {
      addHistory(run, h);
      run = 0;
    }
    addHistory(run + size, h);
    score += countPatterns(h) * PENALTY.N3;
  };
  for (let y = 0; y < size; y++) line((x) => mod[y][x]);
  for (let x = 0; x < size; x++) line((y) => mod[y][x]);
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = mod[y][x];
    if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += PENALTY.N2;
  }
  let dark = 0;
  for (const row of mod) for (const v of row) if (v) dark++;
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * PENALTY.N4;
  return score;
}

// The symbol for `text` (UTF-8 bytes). ecl: 'L' | 'M' | 'Q' | 'H'; mask: 0 to 7 to force one
// (tests), otherwise the one with the lowest penalty (the lowest number on a tie).
export function qrMatrix(text, { ecl = 'M', mask = null, minVersion = 1 } = {}) {
  const level = ECL[String(ecl).toUpperCase()];
  if (level === undefined) throw new Error('The error correction level is L, M, Q or H.');
  const bytes = Buffer.isBuffer(text) ? [...text] : [...Buffer.from(String(text), 'utf8')];
  let ver = Math.max(1, Math.min(40, minVersion | 0));
  while (ver <= 40 && capacityBytes(ver, level) < bytes.length) ver++;
  if (ver > 40) throw new Error('The text is too long for a QR code.');
  const base = baseSymbol(ver, codewords(bytes, ver, level));
  let best = null;
  for (let k = 0; k < 8; k++) {
    if (mask != null && k !== mask) continue;
    const mod = applyMask(base, level, k);
    const p = penalty(mod);
    if (!best || p < best.p) best = { k, mod, p };
  }
  return { version: ver, ecl: 'LMQH'[level], mask: best.k, size: base.size, penalty: best.p, modules: best.mod };
}

// An SVG of the symbol: one path of unit squares, scaled, on a white square with the quiet zone.
export function qrSvg(text, { scale = 4, quiet = QR_QUIET, ecl = 'M', label = 'QR code', dark = '#000', light = '#fff' } = {}) {
  const q = qrMatrix(text, { ecl });
  const n = q.size + quiet * 2;
  let d = '';
  q.modules.forEach((row, y) => row.forEach((v, x) => {
    if (v) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  }));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * scale}" height="${n * scale}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${light}"/><path fill="${dark}" d="${d}"/></svg>`;
}

// A greyscale PNG: `scale` pixels per module, the quiet zone included.
export function qrPng(text, { scale = 8, quiet = QR_QUIET, ecl = 'M' } = {}) {
  const q = qrMatrix(text, { ecl });
  return matrixPng(q.modules, { scale, quiet });
}
export function matrixPng(modules, { scale = 8, quiet = QR_QUIET } = {}) {
  const n = (modules.length + quiet * 2) * scale;
  const px = Buffer.alloc(n * n, 0xff);
  modules.forEach((row, y) => row.forEach((v, x) => {
    if (!v) return;
    for (let dy = 0; dy < scale; dy++) px.fill(0, ((y + quiet) * scale + dy) * n + (x + quiet) * scale, ((y + quiet) * scale + dy) * n + (x + quiet + 1) * scale);
  }));
  return encodePng(n, n, 1, px);
}
