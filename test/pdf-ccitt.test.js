// PDF Studio (0.66): the CCITT fax decoder (server/pdf/ccitt.js) and scanned pages drawn with it
// (server/pdf/render.js). The fixtures in scripts/fixtures/tiff were written by libtiff (through
// Pillow, scripts/fixtures/tiff/make-fixtures.py) from faxPattern() below, in every fax coding: Group
// 4, Group 3 one- and two-dimensional (with and without byte-aligned end-of-line codes) and Modified
// Huffman with byte-aligned rows. Their strips are decoded here and compared with the pattern pixel
// for pixel; then one is put in a PDF made by hand and drawn as a page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { decodeCcitt } from '../server/pdf/ccitt.js';
import { readPdf } from '../server/pdf/reader.js';
import { renderPage } from '../server/pdf/render.js';
import { faxPattern, tiffStrips } from './support/fax-fixtures.js';

const fixture = (f) => fs.readFileSync(new URL(`../scripts/fixtures/tiff/${f}`, import.meta.url));

const W = 2603;
const H = 240;
const PATTERN = faxPattern(W, H);

const bitAt = (bits, stride, x, y) => (bits[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;

// Pillow writes the fixtures with Photometric 1 (0 is black), so the fax code's white runs are the
// pattern's black pixels: with BlackIs1 false a white run decodes to 1 bits, so a decoded 1 is a
// black pixel of the pattern.
function decodeFixture(file, extra = {}) {
  const { tags, strips } = tiffStrips(fixture(file));
  const compression = tags[259][0];
  const t4 = tags[292]?.[0] ?? 0;
  const K = compression === 4 ? -1 : t4 & 1 ? 1 : 0;
  const stride = Math.ceil(W / 8);
  const out = Buffer.alloc(stride * H);
  const results = strips.map((s) => {
    const r = decodeCcitt(s.data, { K, columns: W, rows: s.rows, encodedByteAlign: compression === 2, ...extra });
    r.bits.copy(out, s.y * stride, 0, s.rows * stride);
    return r;
  });
  return { out, results, stride, K };
}

test('every fax coding libtiff writes decodes to the picture it was made from, pixel for pixel', () => {
  for (const file of ['fax-g4.tif', 'fax-g3.tif', 'fax-g3-2d.tif', 'fax-g3-2d-fill.tif', 'fax-mh.tif']) {
    const { out, results, stride, K } = decodeFixture(file);
    for (const r of results) {
      assert.equal(r.error, null, `${file}: no error`);
      assert.equal(r.width, W);
      assert.equal(r.bits.length, r.height * stride, `${file}: rows of ${stride} bytes`);
    }
    let wrong = 0;
    let first = null;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (bitAt(out, stride, x, y) !== PATTERN[y * W + x]) {
          wrong++;
          first ??= [x, y];
        }
      }
    }
    assert.equal(wrong, 0, `${file} (K ${K}): ${wrong} pixels differ, the first at ${first}`);
    // The padding bits at the end of each row are the code's white (1 with BlackIs1 false).
    const padMask = 0xff >> (W % 8);
    for (let y = 0; y < H; y++) assert.equal(out[y * stride + stride - 1] & padMask, padMask, 'padding');
  }
});

test('BlackIs1, an unknown number of rows, the end-of-block code and a stream cut short', () => {
  const { strips } = tiffStrips(fixture('fax-g4.tif'));
  const [first] = strips;
  const normal = decodeCcitt(first.data, { K: -1, columns: W, rows: first.rows });
  const inverted = decodeCcitt(first.data, { K: -1, columns: W, rows: first.rows, blackIs1: true });
  const stride = Math.ceil(W / 8);
  for (let i = 0; i < normal.bits.length; i++) {
    if (i % stride === stride - 1) continue; // the padding is white in both
    assert.equal(inverted.bits[i], normal.bits[i] ^ 0xff, 'BlackIs1 is the complement');
  }

  // Rows 0: decoded until the end-of-block code (libtiff ends Group 4 strips with one).
  const open = decodeCcitt(first.data, { K: -1, columns: W });
  assert.equal(open.height, first.rows);
  assert.equal(open.rows, first.rows);
  assert.equal(open.error, null);
  assert.ok(open.bits.equals(normal.bits));
  // EndOfBlock false with Rows: stops after Rows rows, whatever follows.
  const exact = decodeCcitt(Buffer.concat([first.data, Buffer.from('garbage after the picture')]), { K: -1, columns: W, rows: first.rows, endOfBlock: false });
  assert.ok(exact.bits.equals(normal.bits));
  // More rows asked for than there are: the rest is white.
  const more = decodeCcitt(first.data, { K: -1, columns: W, rows: first.rows + 10 });
  assert.equal(more.height, first.rows + 10);
  assert.ok(more.bits.subarray(0, normal.bits.length).equals(normal.bits));
  assert.ok(more.bits.subarray(normal.bits.length).every((b) => b === 0xff));

  // Cut in half: the rows before the cut are kept exactly, the rest are white, and there is no throw.
  const half = decodeCcitt(first.data.subarray(0, first.data.length >> 1), { K: -1, columns: W, rows: first.rows });
  assert.ok(half.rows > 20 && half.rows < first.rows, `${half.rows} rows decoded`);
  assert.ok(half.bits.subarray(0, (half.rows - 1) * stride).equals(normal.bits.subarray(0, (half.rows - 1) * stride)));
  assert.ok(half.bits.subarray((half.rows + 1) * stride).every((b) => b === 0xff));

  // Damaged in the middle: decoding stops at the first row that cannot be read, keeping the rows
  // before it, and says so.
  const damaged = Buffer.from(first.data);
  damaged.fill(0x00, 1500, 1520);
  const broken = decodeCcitt(damaged, { K: -1, columns: W, rows: first.rows });
  assert.match(broken.error || '', /^Row \d+: /);
  assert.ok(broken.rows > 10 && broken.rows < first.rows);
  assert.ok(broken.bits.subarray(0, (broken.rows - 2) * stride).equals(normal.bits.subarray(0, (broken.rows - 2) * stride)));
});

test('Group 3: end-of-line codes required (EndOfLine), byte alignment, and RTC', () => {
  // libtiff starts every Group 3 row with an end-of-line code and ends with RTC (six of them).
  const { strips } = tiffStrips(fixture('fax-g3.tif'));
  const [s] = strips;
  const a = decodeCcitt(s.data, { K: 0, columns: W, rows: s.rows });
  const b = decodeCcitt(s.data, { K: 0, columns: W, rows: s.rows, endOfLine: true });
  const c = decodeCcitt(s.data, { K: 0, columns: W });
  assert.ok(a.bits.equals(b.bits));
  assert.equal(c.rows, s.rows, 'RTC ends it');
  assert.ok(c.bits.equals(a.bits));
  // Modified Huffman (TIFF compression 2): rows on byte boundaries, no end-of-line codes. Read without
  // EncodedByteAlign it goes wrong (not a hang, not a throw).
  const mh = tiffStrips(fixture('fax-mh.tif')).strips[0];
  const wrong = decodeCcitt(mh.data, { K: 0, columns: W, rows: mh.rows });
  assert.ok(wrong.error || !wrong.bits.equals(a.bits));
});

test('hostile input: random bytes never throw or hang; impossible sizes are Errors', () => {
  let seed = 99;
  const rnd = (n) => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
  const started = Date.now();
  for (let i = 0; i < 200; i++) {
    const data = Buffer.alloc(rnd(4000));
    for (let j = 0; j < data.length; j++) data[j] = rnd(256);
    for (const K of [-1, 0, 2]) {
      const r = decodeCcitt(data, { K, columns: 1 + rnd(3000), encodedByteAlign: Boolean(i & 1), rows: i & 2 ? 0 : 1 + rnd(500) });
      assert.equal(r.bits.length, r.height * Math.ceil(r.width / 8));
    }
  }
  assert.ok(Date.now() - started < 5000, 'quick');
  assert.equal(decodeCcitt(Buffer.alloc(0), { K: -1, columns: 100, rows: 3 }).bits.length, 39, 'no data: white rows');
  assert.throws(() => decodeCcitt(Buffer.alloc(10), { columns: 0 }), /impossible width/);
  assert.throws(() => decodeCcitt(Buffer.alloc(10), { columns: 100_000, rows: 100_000 }), /too large/);
  // Unknown rows: bounded by maxPixels (one bit of all-V0 codes is a whole white row in Group 4).
  const v0 = decodeCcitt(Buffer.alloc(100_000, 0xff), { K: -1, columns: 1000, maxPixels: 1_000_000 });
  assert.equal(v0.height, 1000);
});

test('an A4 page scanned at 300 dpi decodes quickly', () => {
  const buf = fixture('scan-a4-2pages-g4.tif');
  const { strips, tags } = tiffStrips(buf);
  assert.equal(tags[256][0], 2480);
  const started = Date.now();
  let black = 0;
  for (const s of strips) {
    const r = decodeCcitt(s.data, { K: -1, columns: 2480, rows: s.rows, blackIs1: true });
    assert.equal(r.error, null);
    for (const b of r.bits) black += b ? 1 : 0;
  }
  assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
  assert.ok(black > 100, 'the pattern is on it');
});

// ---------- On a page ----------
class HandPdf {
  constructor() {
    this.parts = [];
    this.length = 0;
    this.offsets = {};
    this.text('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  }
  push(buf) { this.parts.push(buf); this.length += buf.length; return this; }
  text(s) { return this.push(Buffer.from(s, 'latin1')); }
  obj(num, body) { this.offsets[num] = this.length; return this.text(`${num} 0 obj\n${body}\nendobj\n`); }
  stream(num, dict, data) {
    this.offsets[num] = this.length;
    const buf = Buffer.from(data);
    return this.text(`${num} 0 obj\n<<${dict} /Length ${buf.length}>>\nstream\n`).push(buf).text('\nendstream\nendobj\n');
  }
  buffer(root = 1) {
    const at = this.length;
    const max = Math.max(...Object.keys(this.offsets).map(Number)) + 1;
    let s = `xref\n0 ${max}\n0000000000 65535 f \n`;
    for (let n = 1; n < max; n++) s += this.offsets[n] === undefined ? '0000000000 00000 f \n' : `${String(this.offsets[n]).padStart(10, '0')} 00000 n \n`;
    this.text(`${s}trailer\n<</Root ${root} 0 R /Size ${max}>>\nstartxref\n${at}\n%%EOF\n`);
    return Buffer.concat(this.parts);
  }
}
function readPng(buf) {
  let at = 8;
  let ihdr = null;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), type: data[9] };
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const channels = { 0: 1, 4: 2, 2: 3, 6: 4 }[ihdr.type];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  const pixels = Buffer.alloc(stride * ihdr.height);
  for (let y = 0; y < ihdr.height; y++) raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  return { ...ihdr, channels, pixels };
}
const pngs = (svg) => [...svg.matchAll(/href="data:image\/png;base64,([^"]+)"/g)].map((m) => readPng(Buffer.from(m[1], 'base64')));

// The first strip of the Group 4 fixture (2603 × 201) as pictures on a page: a DeviceGray image,
// a stencil mask in red, the same mask with Decode [1 0], and the image again behind Flate (DecodeParms
// an array, one entry a filter).
function scanPdf() {
  const [s] = tiffStrips(fixture('fax-g4.tif')).strips;
  const parms = `<< /K -1 /Columns ${W} /Rows ${s.rows} /BlackIs1 true >>`;
  const pdf = new HandPdf();
  pdf.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  pdf.obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  pdf.obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /G 4 0 R /M 5 0 R /N 6 0 R /F 7 0 R >> >> /Contents 8 0 R >>');
  pdf.stream(4, ` /Type /XObject /Subtype /Image /Width ${W} /Height ${s.rows} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms ${parms}`, s.data);
  pdf.stream(5, ` /Type /XObject /Subtype /Image /Width ${W} /Height ${s.rows} /ImageMask true /Filter /CCF /DP ${parms}`, s.data);
  pdf.stream(6, ` /Type /XObject /Subtype /Image /Width ${W} /Height ${s.rows} /ImageMask true /Decode [1 0] /Filter /CCITTFaxDecode /DecodeParms ${parms}`, s.data);
  pdf.stream(7, ` /Type /XObject /Subtype /Image /Width ${W} /Height ${s.rows} /ColorSpace /DeviceGray /Filter [/FlateDecode /CCITTFaxDecode] /DecodeParms [null ${parms}]`, deflateSync(s.data));
  pdf.stream(8, '', 'q 600 0 0 46 0 0 cm /G Do Q 1 0 0 rg q 600 0 0 46 0 100 cm /M Do Q q 600 0 0 46 0 200 cm /N Do Q q 600 0 0 46 0 300 cm /F Do Q');
  return { pdf: pdf.buffer(), rows: s.rows };
}

test('a scanned page (CCITTFaxDecode) is drawn, not a grey box: image, stencil, Decode [1 0], behind Flate', () => {
  const { pdf, rows } = scanPdf();
  const page = renderPage(readPdf(pdf), 0);
  assert.doesNotMatch(page.svg, /#d9d9d9/, 'no grey box');
  assert.equal(page.error, undefined);
  const images = pngs(page.svg);
  assert.equal(images.length, 4, 'four pictures');
  const [gray, mask, inverse, flate] = images;
  assert.deepEqual([gray.width, gray.height, gray.channels], [W, rows, 1]);
  let wrong = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < W; x++) {
      const black = PATTERN[y * W + x] === 1;
      const i = y * W + x;
      if ((gray.pixels[i] === 0) !== black) wrong++;
      if (flate.pixels[i] !== gray.pixels[i]) wrong++;
      // The stencil paints red where the pattern is black; Decode [1 0] where it is white.
      const m = mask.pixels.subarray(i * 4, i * 4 + 4);
      if (black ? m.join() !== '255,0,0,255' : m[3] !== 0) wrong++;
      if ((inverse.pixels[i * 4 + 3] === 255) === black) wrong++;
    }
  }
  assert.equal(wrong, 0, 'every pixel as the pattern has it');
});

test('a fax picture larger than the screen budget keeps its thin lines when made smaller', () => {
  const { pdf, rows } = scanPdf();
  // 2603 × 201 = 523,203 pixels shown in at most 60,000: every 3 × 3 block becomes one pixel, black
  // when any pixel in it is black (single dots and one-pixel lines survive).
  const page = renderPage(readPdf(pdf), 0, { maxImagePixels: 60_000 });
  const [gray, mask] = pngs(page.svg);
  const k = 3;
  const w = Math.ceil(W / k);
  const h = Math.ceil(rows / k);
  assert.deepEqual([gray.width, gray.height], [w, h]);
  let wrong = 0;
  for (let Y = 0; Y < h; Y++) {
    for (let X = 0; X < w; X++) {
      let any = false;
      for (let y = Y * k; y < Math.min(rows, Y * k + k) && !any; y++) for (let x = X * k; x < Math.min(W, X * k + k) && !any; x++) any = PATTERN[y * W + x] === 1;
      if ((gray.pixels[Y * w + X] === 0) !== any) wrong++;
      if ((mask.pixels[(Y * w + X) * 4 + 3] === 255) !== any) wrong++;
    }
  }
  assert.equal(wrong, 0);
  // A dot of the pattern (one pixel at 1994, 0) is still there.
  assert.equal(gray.pixels[Math.floor(1994 / k)], 0);
});

test('damaged fax data still draws the rows before the damage', () => {
  const [s] = tiffStrips(fixture('fax-g4.tif')).strips;
  const data = Buffer.from(s.data);
  data.fill(0, 1500);
  const pdf = new HandPdf();
  pdf.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  pdf.obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  pdf.obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /G 4 0 R >> >> /Contents 5 0 R >>');
  pdf.stream(4, ` /Type /XObject /Subtype /Image /Width ${W} /Height ${s.rows} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns ${W} /BlackIs1 true >>`, data);
  pdf.stream(5, '', 'q 600 0 0 46 0 0 cm /G Do Q');
  const page = renderPage(readPdf(pdf.buffer()), 0);
  const [gray] = pngs(page.svg);
  assert.equal(gray.height, s.rows, 'the full height');
  for (let x = 0; x < W; x++) assert.equal(gray.pixels[10 * W + x], 0, 'row 10 is black');
  // The rows after the damage are the code's white, which BlackIs1 true makes 0 bits: black in
  // DeviceGray (as in this fixture, whose black pixels are coded as white runs).
  assert.ok(gray.pixels.subarray(gray.pixels.length - W).every((v) => v === 0), 'the rows after the damage are the code\'s white');
  assert.ok(gray.pixels.subarray(gray.pixels.length - W * 30).every((v) => v === 0));
});
