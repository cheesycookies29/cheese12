// PDF Studio (0.66): TIFF pictures read on the server (server/pdf/tiff.js) and made into PDFs
// (tiffToPdf in server/pdf/layout.js, embedImageObject in server/pdf/images.js).
// The fixtures in scripts/fixtures/tiff were written by Pillow (libtiff) and ImageMagick
// (make-fixtures.py) from pixel formulas repeated here, so the pixels read are checked exactly;
// what those tools do not write (WhiteIsZero, 2- and 4-bit samples, 16-bit big-endian, old-style
// LZW, FillOrder 2, YCbCr JPEG with JPEGTables, every orientation, broken files) is made by
// makeTiff() below. The PDFs are also drawn by poppler (pdftoppm) when it is installed, to check that
// another PDF reader sees the same pixels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inflateSync, deflateSync } from 'node:zlib';
import { readTiff, isTiff } from '../server/pdf/tiff.js';
import { tiffToPdf, imageToPdf } from '../server/pdf/layout.js';
import { jpegInfo } from '../server/pdf/images.js';
import { readPdf } from '../server/pdf/reader.js';
import { renderPage } from '../server/pdf/render.js';
import { faxPattern, tiffStrips } from './support/fax-fixtures.js';

const fixture = (f) => fs.readFileSync(new URL(`../scripts/fixtures/tiff/${f}`, import.meta.url));
const JPEG = fs.readFileSync(new URL('../scripts/fixtures/profile-sample.jpg', import.meta.url));
const POPPLER = spawnSync('pdftoppm', ['-v']).status === 0;

// The colour fixtures (70 × 50), as make-fixtures.py makes them.
const CW = 70;
const CH = 50;
const colour = (x, y) => [(x * 4 + y) & 255, (y * 5) & 255, ((x + y) * 3) & 255];
const PAL = (i) => [(i * 16) & 255, (255 - i * 16) & 255, (i * 37) & 255];
const palIndex = (x, y) => (Math.floor(x / 8) + Math.floor(y / 8)) % 16;

// ---------- A TIFF writer for the tests ----------
// pages: [{ tags: { tag: [type, values] }, strips: [Buffer], tiled, offsets, counts }]; strip offsets
// and byte counts are filled in unless given. options: le (byte order), next: (i, offsets) => the next-page offset of page i.
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const UNDEFINED = 7;
function makeTiff(pages, { le = true, next = null } = {}) {
  const parts = [];
  let len = 8;
  const add = (buf) => {
    const at = len;
    parts.push(buf);
    len += buf.length;
    if (len % 2) {
      parts.push(Buffer.alloc(1));
      len++;
    }
    return at;
  };
  const num = (v, size) => {
    const b = Buffer.alloc(size);
    if (size === 2) le ? b.writeUInt16LE(v) : b.writeUInt16BE(v);
    else le ? b.writeUInt32LE(v) : b.writeUInt32BE(v);
    return b;
  };
  const ifds = [];
  for (const page of pages) {
    const offsets = page.strips.map(add).map((at, i) => page.offsets?.[i] ?? at);
    const tags = { ...page.tags, [page.tiled ? 324 : 273]: [LONG, offsets], [page.tiled ? 325 : 279]: [LONG, page.counts || page.strips.map((s) => s.length)] };
    const entries = Object.entries(tags).map(([tag, [type, values]]) => {
      let data;
      if (type === UNDEFINED) data = Buffer.from(values);
      else if (type === RATIONAL) data = Buffer.concat(values.flatMap((v) => [num(Math.round(v * 1000), 4), num(1000, 4)]));
      else data = Buffer.concat(values.map((v) => num(v, type === SHORT ? 2 : 4)));
      const count = type === RATIONAL ? values.length : type === UNDEFINED ? data.length : values.length;
      return { tag: Number(tag), type, count, data };
    }).sort((a, b) => a.tag - b.tag);
    for (const e of entries) if (e.data.length > 4) e.at = add(e.data);
    const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
    num(entries.length, 2).copy(ifd, 0);
    entries.forEach((e, i) => {
      const o = 2 + i * 12;
      num(e.tag, 2).copy(ifd, o);
      num(e.type, 2).copy(ifd, o + 2);
      num(e.count, 4).copy(ifd, o + 4);
      if (e.at !== undefined) num(e.at, 4).copy(ifd, o + 8);
      else e.data.copy(ifd, o + 8);
    });
    ifds.push({ at: add(ifd), n: entries.length });
  }
  const out = Buffer.concat([Buffer.alloc(8), ...parts]);
  out.write(le ? 'II' : 'MM', 0, 'latin1');
  num(42, 2).copy(out, 2);
  num(ifds[0].at, 4).copy(out, 4);
  ifds.forEach((ifd, i) => {
    const target = next ? next(i, ifds.map((x) => x.at)) : ifds[i + 1]?.at ?? 0;
    num(target, 4).copy(out, ifd.at + 2 + ifd.n * 12);
  });
  return out;
}
// The usual fields of a page.
const fields = (W, H, { bps = [8], spp = 1, photometric = 1, compression = 1, rps = H, ...more } = {}) => ({
  256: [LONG, [W]], 257: [LONG, [H]], 258: [SHORT, bps], 259: [SHORT, [compression]], 262: [SHORT, [photometric]], 277: [SHORT, [spp]], 278: [LONG, [rps]], ...more,
});

// TIFF LZW (most significant bit first, early change); old: least significant first, no early change.
function lzwEncode(data, { old = false } = {}) {
  const out = [];
  let acc = 0;
  let have = 0;
  let bits = 9;
  const put = (code) => {
    if (old) {
      acc |= code << have;
      have += bits;
      while (have >= 8) { out.push(acc & 255); acc >>>= 8; have -= 8; }
    } else {
      acc = (acc << bits) | code;
      have += bits;
      while (have >= 8) { out.push((acc >>> (have - 8)) & 255); have -= 8; }
      acc &= (1 << have) - 1;
    }
  };
  let dict = new Map();
  let next = 258;
  const early = old ? 0 : 1;
  put(256);
  let w = '';
  for (const c of data.toString('latin1')) {
    const wc = w + c;
    if (wc.length === 1 || dict.has(wc)) { w = wc; continue; }
    put(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
    dict.set(wc, next++);
    if (next + early > 1 << bits && bits < 12) bits++;
    if (next >= 4094) { put(256); dict = new Map(); next = 258; bits = 9; }
    w = c;
  }
  if (w) put(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
  put(257);
  if (have) out.push(old ? acc & 255 : (acc << (8 - have)) & 255);
  return Buffer.from(out);
}
// PackBits: repeats of 3 or more as runs, the rest as literals.
function packBits(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (i + run < data.length && run < 128 && data[i + run] === data[i]) run++;
    if (run >= 3) {
      out.push(257 - run, data[i]);
      i += run;
      continue;
    }
    const start = i;
    while (i < data.length && i - start < 128 && !(data[i] === data[i + 1] && data[i] === data[i + 2])) i++;
    out.push(i - start - 1, ...data.subarray(start, i));
  }
  return Buffer.from(out);
}
const rawOf = (desc) => inflateSync(desc.data);

// ---------- Poppler ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-tiff-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
// Page `page` of a PDF drawn by pdftoppm at w × h pixels: { w, h, channels, px }.
function poppler(pdf, w, h, { page = 1, gray = false } = {}) {
  const file = path.join(tmp, `p${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(file, pdf);
  const r = spawnSync('pdftoppm', ['-f', String(page), '-l', String(page), '-scale-to-x', String(w), '-scale-to-y', String(h), ...(gray ? ['-gray'] : [])].concat([file]), { maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, String(r.stderr));
  const m = r.stdout.toString('latin1', 0, 40).match(/^P([56])\s+(\d+)\s+(\d+)\s+255\s/);
  return { w: +m[2], h: +m[3], channels: m[1] === '6' ? 3 : 1, px: r.stdout.subarray(m[0].length) };
}
// Each pixel of a W × H picture, sampled at its centre in a drawing 4 times as large (no blur from
// the edges between pixels): fn(x, y) → expected channels; returns the largest difference.
function largestDifference(pdf, W, H, fn, opts = {}) {
  const img = poppler(pdf, W * 4, H * 4, opts);
  let max = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const e = fn(x, y);
      for (let c = 0; c < img.channels; c++) max = Math.max(max, Math.abs(img.px[((y * 4 + 2) * img.w + x * 4 + 2) * img.channels + c] - e[c]));
    }
  }
  return max;
}
const AUTO = { size: 'auto', margin: 0 };
// The page content of a PDF from PdfWriter (its Flate streams, inflated), as text.
const contents = (pdf) => pdf.toString('latin1') + [...pdf.toString('latin1').matchAll(/\/Filter \/FlateDecode \/Length (\d+)>>\nstream\n/g)]
  .map((m) => {
    try {
      return inflateSync(Buffer.from(pdf.toString('latin1').substr(m.index + m[0].length, Number(m[1])), 'latin1')).toString('latin1');
    } catch {
      return '';
    }
  }).join('\n');

// ---------- Tests ----------
test('isTiff sniffs both byte orders', () => {
  assert.ok(isTiff(fixture('rgb-lzw-predictor.tif')));
  assert.ok(isTiff(fixture('rgb-mm-orient6.tif')));
  assert.equal(fixture('rgb-mm-orient6.tif').toString('latin1', 0, 2), 'MM');
  assert.ok(!isTiff(JPEG));
  assert.ok(!isTiff(Buffer.from('II*')));
});

test('the fixtures Pillow and ImageMagick wrote: every pixel as it was made', () => {
  const check = (file, channels, fn) => {
    const { pages, warnings } = readTiff(fixture(file));
    assert.deepEqual(warnings, [], file);
    assert.equal(pages.length, 1);
    const im = pages[0].image.type === 'group' ? pages[0].image.parts[0].image : pages[0].image;
    assert.equal(im.type, 'raw', file);
    const px = rawOf(im);
    assert.equal(px.length, CW * CH * channels, `${file}: ${channels} channels`);
    let wrong = 0;
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) fn(x, y).forEach((v, c) => { if (Math.abs(px[(y * CW + x) * channels + c] - v) > (file.startsWith('rgba') ? 1 : 0)) wrong++; });
    assert.equal(wrong, 0, `${file}: ${wrong} samples differ`);
    return { page: pages[0], im };
  };
  // LZW with horizontal differencing; tiles (32 × 32, reaching past the edges); separate planes
  // (Deflate); big-endian with an orientation.
  assert.equal(check('rgb-lzw-predictor.tif', 3, colour).im.colorSpace, 'DeviceRGB');
  check('rgb-tiles.tif', 3, colour);
  check('rgb-planar.tif', 3, colour);
  const turned = check('rgb-mm-orient6.tif', 3, colour);
  assert.deepEqual([turned.page.width, turned.page.height, turned.page.image.type, turned.page.image.orientation], [CH, CW, 'group', 6], 'stored as it is, turned when drawn');
  // CMYK as it is; 16-bit grey as 8 bits; alpha laid on white.
  assert.equal(check('cmyk-lzw.tif', 4, (x, y) => [(x * 4) & 255, (y * 5) & 255, (x + y) & 255, (x ^ y) & 63]).im.colorSpace, 'DeviceCMYK');
  assert.equal(check('gray16-deflate.tif', 1, (x, y) => [((x * 1000 + y * 300) & 0xffff) >> 8]).im.colorSpace, 'DeviceGray');
  check('rgba-deflate.tif', 3, (x, y) => {
    const a = (x * 8) & 255;
    return colour(x, y).map((v) => Math.round((v * a + 255 * (255 - a)) / 255));
  });
  // A palette (PackBits): the indexes as they are, the palette as an Indexed colour space.
  const { im } = check('palette-packbits.tif', 1, (x, y) => [palIndex(x, y)]);
  assert.equal(im.bpc, 8);
  for (let i = 0; i < 16; i++) assert.deepEqual([...im.colorSpace.indexed.subarray(i * 3, i * 3 + 3)], PAL(i));
});

test('fax and JPEG go into the PDF as they are, with the right parameters', () => {
  const expect = { 'fax-g4.tif': [-1, false], 'fax-g3.tif': [0, false], 'fax-g3-2d.tif': [4, false], 'fax-g3-2d-fill.tif': [4, false], 'fax-mh.tif': [0, true] };
  for (const [file, [K, aligned]] of Object.entries(expect)) {
    const buf = fixture(file);
    const { pages } = readTiff(buf);
    const { strips } = tiffStrips(buf);
    const g = pages[0].image;
    assert.equal(g.type, 'group', 'two strips');
    assert.equal(g.parts.length, strips.length);
    g.parts.forEach((p, i) => {
      assert.deepEqual([p.x, p.y, p.image.type, p.image.width, p.image.height, p.image.K, p.image.blackIs1, p.image.encodedByteAlign, p.image.endOfBlock], [0, strips[i].y, 'ccitt', 2603, strips[i].rows, K, true, aligned, !aligned], file);
      assert.ok(p.image.data.equals(strips[i].data), 'the bytes as they are');
    });
  }
  assert.deepEqual([readTiff(fixture('fax-g3.tif')).pages[0].xDpi, readTiff(fixture('fax-g3.tif')).pages[0].yDpi], [204, 98]);

  // JPEG: the shared tables (JPEGTables) put into each strip; RGB (Photometric 2) is not converted
  // from YCbCr (ColorTransform 0).
  const one = readTiff(fixture('rgb-jpeg.tif')).pages[0].image;
  assert.equal(one.type, 'jpeg');
  assert.equal(one.colorTransform, 0);
  assert.deepEqual(jpegInfo(one.data), { width: CW, height: CH, components: 3, adobe: one.data.includes(Buffer.from('Adobe')) });
  const strips = readTiff(fixture('rgb-jpeg-strips.tif')).pages[0].image;
  assert.deepEqual(strips.parts.map((p) => [p.y, p.h, p.image.type]), [[0, 16, 'jpeg'], [16, 16, 'jpeg'], [32, 16, 'jpeg'], [48, 2, 'jpeg']]);
});

test('made here: WhiteIsZero, 2- and 4-bit samples, 16-bit big-endian with prediction, old LZW, grey with alpha, FillOrder 2', () => {
  // 1-bit WhiteIsZero, big-endian, 13 pixels wide (rows padded to whole bytes, as PDF wants them).
  const bits = Buffer.from([0b10000000, 0b00001000, 0b01010101, 0b01010000, 0xff, 0xf8]); // 3 rows of 2 bytes
  let im = readTiff(makeTiff([{ tags: fields(13, 3, { bps: [1], photometric: 0 }), strips: [bits] }], { le: false })).pages[0].image;
  assert.deepEqual([im.colorSpace, im.bpc, im.decode], ['DeviceGray', 1, [1, 0]]);
  assert.ok(rawOf(im).equals(bits));
  // PackBits, 1-bit BlackIsZero in two strips.
  im = readTiff(makeTiff([{ tags: fields(13, 3, { bps: [1], compression: 32773, rps: 2 }), strips: [packBits(bits.subarray(0, 4)), packBits(bits.subarray(4))] }])).pages[0].image;
  assert.equal(im.decode, undefined);
  assert.ok(rawOf(im).equals(bits));

  // 2-bit grey and a 4-bit palette, LZW.
  const two = Buffer.from([0b00011011, 0b11100100]); // 0 1 2 3 / 3 2 1 0
  im = readTiff(makeTiff([{ tags: fields(4, 2, { bps: [2], compression: 5 }), strips: [lzwEncode(two)] }])).pages[0].image;
  assert.deepEqual([im.bpc, [...rawOf(im)]], [2, [...two]]);
  const map = [];
  for (let c = 0; c < 3; c++) for (let i = 0; i < 16; i++) map.push(PAL(i)[c] * 257);
  const nibbles = Buffer.from([0x01, 0x23, 0x45, 0xfe]);
  im = readTiff(makeTiff([{ tags: fields(4, 2, { bps: [4], photometric: 3, compression: 32773, 320: [SHORT, map] }), strips: [packBits(nibbles)] }])).pages[0].image;
  assert.equal(im.bpc, 4);
  assert.ok(rawOf(im).equals(nibbles));
  assert.deepEqual([...im.colorSpace.indexed.subarray(15 * 3, 16 * 3)], PAL(15));

  // 16-bit RGB with horizontal differencing, Deflate, in both byte orders: 8 bits each.
  for (const le of [true, false]) {
    const W = 5;
    const H = 3;
    const samples = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) samples.push((x * 9000 + y * 3000 + c * 20000) & 0xffff);
    const diff = Buffer.alloc(samples.length * 2);
    samples.forEach((v, i) => {
      const left = i % (W * 3) >= 3 ? samples[i - 3] : 0;
      const d = (v - left) & 0xffff;
      le ? diff.writeUInt16LE(d, i * 2) : diff.writeUInt16BE(d, i * 2);
    });
    im = readTiff(makeTiff([{ tags: fields(W, H, { bps: [16, 16, 16], spp: 3, photometric: 2, compression: 8, 317: [SHORT, [2]] }), strips: [deflateSync(diff)] }], { le })).pages[0].image;
    assert.deepEqual([...rawOf(im)], samples.map((v) => v >> 8), le ? 'little-endian' : 'big-endian');
  }

  // Old-style LZW (least significant bit first), 8-bit grey; long enough for 10- and 11-bit codes.
  const gray = Buffer.alloc(64 * 40);
  for (let i = 0; i < gray.length; i++) gray[i] = (i * 7 + (i >> 6) * 13) & 255;
  im = readTiff(makeTiff([{ tags: fields(64, 40, { compression: 5 }), strips: [lzwEncode(gray, { old: true })] }])).pages[0].image;
  assert.ok(rawOf(im).equals(gray), 'old-style LZW');
  im = readTiff(makeTiff([{ tags: fields(64, 40, { compression: 5 }), strips: [lzwEncode(gray)] }])).pages[0].image;
  assert.ok(rawOf(im).equals(gray), 'LZW');

  // Grey with straight alpha (ExtraSamples 2) laid on white; unspecified extra channels dropped.
  const ga = Buffer.from([0, 255, 0, 0, 100, 128]);
  im = readTiff(makeTiff([{ tags: fields(3, 1, { spp: 2, 338: [SHORT, [2]] }), strips: [ga] }])).pages[0].image;
  assert.deepEqual([...rawOf(im)], [0, 255, Math.round((100 * 128 + 255 * 127) / 255)]);
  im = readTiff(makeTiff([{ tags: fields(3, 1, { spp: 2, 338: [SHORT, [0]] }), strips: [ga] }])).pages[0].image;
  assert.deepEqual([...rawOf(im)], [0, 0, 100]);

  // FillOrder 2 (least significant bit first) fax data is turned round for the PDF.
  const [strip] = tiffStrips(fixture('fax-g4.tif')).strips;
  const reversed = Buffer.from(strip.data, 0).map((b) => parseInt(b.toString(2).padStart(8, '0').split('').reverse().join(''), 2));
  im = readTiff(makeTiff([{ tags: fields(2603, strip.rows, { bps: [1], compression: 4, 266: [SHORT, [2]] }), strips: [reversed] }])).pages[0].image;
  assert.equal(im.type, 'ccitt');
  assert.ok(im.data.equals(strip.data));
});

// A JFIF split the way TIFF stores JPEG: the tables (DQT, DHT) in JPEGTables, the rest in the strip.
function splitJpeg(jpeg) {
  const tables = [jpeg.subarray(0, 2)];
  const rest = [jpeg.subarray(0, 2)];
  let i = 2;
  while (i < jpeg.length) {
    const marker = jpeg[i + 1];
    if (marker === 0xda) {
      rest.push(jpeg.subarray(i));
      break;
    }
    const seg = jpeg.subarray(i, i + 2 + jpeg.readUInt16BE(i + 2));
    (marker === 0xdb || marker === 0xc4 ? tables : rest).push(seg);
    i += seg.length;
  }
  tables.push(Buffer.from([0xff, 0xd9]));
  return { tables: Buffer.concat(tables), strip: Buffer.concat(rest) };
}
const YCBCR_JPEG = (() => {
  const { tables, strip } = splitJpeg(JPEG);
  return makeTiff([{ tags: fields(640, 480, { bps: [8, 8, 8], spp: 3, photometric: 6, compression: 7, 347: [UNDEFINED, tables], 282: [RATIONAL, [72]], 283: [RATIONAL, [72]], 296: [SHORT, [2]] }), strips: [strip] }]);
})();

test('a YCbCr JPEG with its tables kept apart (JPEGTables), as scanners write it', () => {
  const { strip } = splitJpeg(JPEG);
  assert.throws(() => jpegInfo(Buffer.from('not')), /not a JPEG/);
  const im = readTiff(YCBCR_JPEG).pages[0].image;
  assert.equal(im.type, 'jpeg');
  assert.equal(im.colorTransform, 1, 'YCbCr is converted');
  assert.equal(im.data.length, JPEG.length, 'the tables put back');
  assert.ok(im.data.length > strip.length);
  assert.deepEqual(jpegInfo(im.data), jpegInfo(JPEG));
});

test('every orientation (1–8) and the YCbCr JPEG look right in poppler', { skip: !POPPLER && 'pdftoppm is not installed' }, () => {
  // A 7 × 5 RGB picture; display pixel (X, Y) shows stored pixel (c, r).
  const W = 7;
  const H = 5;
  const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.set([x * 36, y * 60, (x * 7 + y * 30) & 255], (y * W + x) * 3);
  const stored = {
    1: (X, Y) => [X, Y], 2: (X, Y) => [W - 1 - X, Y], 3: (X, Y) => [W - 1 - X, H - 1 - Y], 4: (X, Y) => [X, H - 1 - Y],
    5: (X, Y) => [Y, X], 6: (X, Y) => [Y, H - 1 - X], 7: (X, Y) => [W - 1 - Y, H - 1 - X], 8: (X, Y) => [W - 1 - Y, X],
  };
  for (let o = 1; o <= 8; o++) {
    const tiff = makeTiff([{ tags: fields(W, H, { bps: [8, 8, 8], spp: 3, photometric: 2, 274: [SHORT, [o]] }), strips: [px] }]);
    const { pdf } = tiffToPdf(tiff, AUTO);
    const [dw, dh] = o >= 5 ? [H, W] : [W, H];
    const diff = largestDifference(pdf, dw, dh, (X, Y) => {
      const [c, r] = stored[o](X, Y);
      return [...px.subarray((r * W + c) * 3, (r * W + c) * 3 + 3)];
    });
    assert.equal(diff, 0, `orientation ${o}`);
  }
  // The JPEG with JPEGTables draws as the JPEG itself does.
  const a = poppler(tiffToPdf(YCBCR_JPEG, AUTO).pdf, 160, 120);
  const b = poppler(imageToPdf(JPEG, { size: 'auto', margin: 0 }).pdf, 160, 120);
  let sum = 0;
  for (let i = 0; i < a.px.length; i++) sum += Math.abs(a.px[i] - b.px[i]);
  assert.ok(sum / a.px.length < 1, `mean difference ${sum / a.px.length}`);
});

test('the PDFs tiffToPdf writes look right in poppler: fax, palette, LZW, JPEG strips, CMYK', { skip: !POPPLER && 'pdftoppm is not installed' }, () => {
  // Fax pictures (passed through as CCITTFaxDecode): every pixel within one pixel of the pattern
  // (poppler smooths the edges of a 1-bit picture).
  const W = 2603;
  const H = 240;
  const pattern = faxPattern(W, H);
  for (const file of ['fax-g4.tif', 'fax-g3.tif', 'fax-g3-2d-fill.tif', 'fax-mh.tif']) {
    const img = poppler(tiffToPdf(fixture(file), AUTO).pdf, W, H, { gray: true });
    let far = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const black = img.px[y * W + x] < 128;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) near = Boolean(pattern[(y + dy) * W + x + dx]) === black && y + dy >= 0 && y + dy < H && x + dx >= 0 && x + dx < W;
        if (!near) far++;
      }
    }
    assert.equal(far, 0, `${file}: ${far} pixels are wrong`);
    for (let x = 0; x < W; x++) assert.ok(img.px[10 * W + x] < 128, 'row 10 is black');
  }
  assert.equal(largestDifference(tiffToPdf(fixture('palette-packbits.tif'), AUTO).pdf, CW, CH, (x, y) => PAL(palIndex(x, y))), 0, 'palette');
  assert.equal(largestDifference(tiffToPdf(fixture('rgb-tiles.tif'), AUTO).pdf, CW, CH, colour), 0, 'tiles');
  assert.equal(largestDifference(tiffToPdf(fixture('rgb-mm-orient6.tif'), AUTO).pdf, CH, CW, (X, Y) => colour(Y, CH - 1 - X)), 0, 'orientation 6');
  assert.ok(largestDifference(tiffToPdf(fixture('rgb-jpeg-strips.tif'), AUTO).pdf, CW, CH, colour) < 12, 'JPEG strips');
  assert.ok(largestDifference(tiffToPdf(fixture('rgb-jpeg.tif'), AUTO).pdf, CW, CH, colour) < 12, 'JPEG');
  // CMYK goes in as DeviceCMYK: cyan, magenta, yellow and black patches.
  const patches = [[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0], [0, 0, 0, 255]];
  const cmyk = Buffer.concat(patches.map((p) => Buffer.from(p)));
  const img = poppler(tiffToPdf(makeTiff([{ tags: fields(4, 1, { bps: [8, 8, 8, 8], spp: 4, photometric: 5 }), strips: [cmyk] }]), AUTO).pdf, 16, 4);
  const at = (i) => [...img.px.subarray((2 * img.w + i * 4 + 2) * 3, (2 * img.w + i * 4 + 2) * 3 + 3)];
  const [c, m, y, k] = [0, 1, 2, 3].map(at);
  assert.ok(c[0] < 60 && c[1] > 120 && c[2] > 180, `cyan ${c}`);
  assert.ok(m[1] < 60 && m[0] > 180, `magenta ${m}`);
  assert.ok(y[2] < 60 && y[0] > 180 && y[1] > 180, `yellow ${y}`);
  assert.ok(k.every((v) => v < 60), `black ${k}`);
});

test('tiffToPdf: page sizes from the resolution, every page, warnings', () => {
  // A two-page A4 scan at 300 dpi: two A4 pages with Picture size; on A4 with "actual" it fills it.
  const scan = fixture('scan-a4-2pages-g4.tif');
  const auto = tiffToPdf(scan, AUTO);
  assert.equal(auto.pages, 2);
  assert.deepEqual(auto.warnings, []);
  const doc = readPdf(auto.pdf);
  assert.equal(doc.pages.length, 2);
  const size = (pdf, i = 0) => {
    const box = String(pdf).match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)[i].match(/([\d.]+) ([\d.]+)\]$/);
    return [Number(box[1]), Number(box[2])];
  };
  const pdfText = auto.pdf.toString('latin1');
  assert.deepEqual(size(pdfText), [595.2, 841.92], 'A4 from 2480 × 3508 at 300 dpi');
  // On an A4 page with "actual", it is drawn at its own size (shrunk the 0.004 % that A4 in
  // points is shorter than 3508 pixels at 300 dpi).
  const drawn = contents(tiffToPdf(scan, { size: 'a4', fit: 'actual', margin: 0 }).pdf).match(/q ([\d.]+) 0 0 ([\d.]+) [-\d.]+ [-\d.]+ cm \/Im1 Do Q/);
  assert.ok(Math.abs(drawn[1] - 595.2) < 0.05 && Math.abs(drawn[2] - 841.89) < 0.05, drawn[0]);
  // Fax at 204 × 98 dpi is not stretched: 2603 / 204 by 240 / 98 inches.
  const fax = tiffToPdf(fixture('fax-g3.tif'), AUTO).pdf.toString('latin1');
  const [fw, fh] = size(fax);
  assert.ok(Math.abs(fw - (2603 / 204) * 72) < 0.01 && Math.abs(fh - (240 / 98) * 72) < 0.01, `${fw} × ${fh}`);
  // No resolution: 96 dpi, as other pictures.
  assert.deepEqual(size(tiffToPdf(fixture('rgb-jpeg.tif'), AUTO).pdf.toString('latin1')), [CW * 0.75, CH * 0.75]);
  // Centimetres: 118 pixels at 118.11 a centimetre.
  const cm = makeTiff([{ tags: fields(118, 59, { 282: [RATIONAL, [118.11]], 283: [RATIONAL, [118.11]], 296: [SHORT, [3]] }), strips: [Buffer.alloc(118 * 59, 200)] }]);
  const [cw, ch] = size(tiffToPdf(cm, AUTO).pdf.toString('latin1'));
  assert.ok(Math.abs(cw - 72 / 2.54) < 0.05 && Math.abs(ch - 36 / 2.54) < 0.05, `1 cm × half a cm: ${cw} × ${ch}`);

  // The pages of the scan drawn by PDF Studio: fax pictures, no grey boxes.
  const page = renderPage(doc, 1);
  assert.doesNotMatch(page.svg, /#d9d9d9/);
  assert.equal(page.error, undefined);
  assert.match(page.svg, /data:image\/png;base64/);
});

test('pages: a chain of pages, a loop, a thumbnail, the page cap, a page that cannot be read', () => {
  const page = (v) => ({ tags: fields(2, 2), strips: [Buffer.alloc(4, v)] });
  const three = makeTiff([page(10), page(20), page(30)]);
  const firstPixel = (r) => r.pages.map((p) => rawOf(p.image)[0]);
  assert.deepEqual(firstPixel(readTiff(three)), [10, 20, 30]);
  const capped = readTiff(three, { maxPages: 2 });
  assert.deepEqual(firstPixel(capped), [10, 20]);
  assert.match(capped.warnings[0], /more than 2 pages; only the first 2/);
  // Page 3 points back to page 2.
  const loop = readTiff(makeTiff([page(10), page(20), page(30)], { next: (i, at) => (i === 2 ? at[1] : at[i + 1]) }));
  assert.deepEqual(firstPixel(loop), [10, 20, 30]);
  assert.match(loop.warnings[0], /loops back on itself/);
  const self = readTiff(makeTiff([page(10)], { next: (i, at) => at[0] }));
  assert.equal(self.pages.length, 1);
  // A thumbnail (NewSubfileType 1) is not a page.
  const thumb = { tags: { ...fields(2, 2), 254: [LONG, [1]] }, strips: [Buffer.alloc(4, 99)] };
  assert.deepEqual(firstPixel(readTiff(makeTiff([page(10), thumb, page(30)]))), [10, 30]);
  // A page in old JPEG, one in JBIG: left out, saying why; the others are read.
  const oldJpeg = { tags: fields(2, 2, { compression: 6 }), strips: [Buffer.alloc(4)] };
  const jbig = { tags: fields(2, 2, { compression: 34661 }), strips: [Buffer.alloc(4)] };
  const mixed = readTiff(makeTiff([page(10), oldJpeg, page(30), jbig]));
  assert.deepEqual(firstPixel(mixed), [10, 30]);
  assert.match(mixed.warnings[0], /^Page 2 was left out\. This TIFF page uses the old TIFF JPEG compression/);
  assert.match(mixed.warnings[1], /^Page 4 was left out\. This TIFF page uses a compression CORE cannot read \(JBIG\)/);
  const viaPdf = tiffToPdf(makeTiff([page(10), oldJpeg]), AUTO);
  assert.equal(viaPdf.pages, 1);
  assert.equal(viaPdf.warnings.length, 1);
  // Only unreadable pages: the reason, as an Error.
  assert.throws(() => readTiff(makeTiff([oldJpeg])), (e) => e.status === 400 && /^This TIFF page uses the old TIFF JPEG/.test(e.message));
  assert.throws(() => readTiff(makeTiff([oldJpeg, jbig])), /None of the 2 pages of this TIFF could be read\. This TIFF page uses the old/);
});

test('hostile input: plain-English Errors, never a hang', () => {
  const good = makeTiff([{ tags: fields(4, 4), strips: [Buffer.alloc(16, 7)] }]);
  const cases = [
    [Buffer.from('not a tiff at all'), /not a TIFF/],
    [Buffer.from('II+\0\x08\0\0\0\0\0\0\0\0\0\0\0'), /BigTIFF/],
    [Buffer.concat([Buffer.from('II*\0'), Buffer.from([0xff, 0xff, 0, 0])]), /first page could not be found/],
    [good.subarray(0, 12), /first page could not be found|cut short/],
    [makeTiff([{ tags: fields(0, 4), strips: [Buffer.alloc(1)] }]), /has no size/],
    [makeTiff([{ tags: fields(4_000_000, 4_000_000), strips: [Buffer.alloc(1)] }]), /impossible size/],
    [makeTiff([{ tags: fields(100_000, 100_000), strips: [Buffer.alloc(1)] }]), /too large \(more than 60 megapixels\)/],
    [makeTiff([{ tags: fields(4, 4, { photometric: 8 }), strips: [Buffer.alloc(16)] }]), /colour model CORE cannot read \(CIE Lab\)/],
    [makeTiff([{ tags: fields(4, 4, { 339: [SHORT, [3]], bps: [16] }), strips: [Buffer.alloc(32)] }]), /floating-point/],
    [makeTiff([{ tags: fields(4, 4, { bps: [8, 8, 8], spp: 3, photometric: 6 }), strips: [Buffer.alloc(48)] }]), /YCbCr colours without JPEG/],
    [makeTiff([{ tags: fields(4, 4, { photometric: 3 }), strips: [Buffer.alloc(16)] }]), /palette is missing/],
    [makeTiff([{ tags: fields(4, 4, { rps: 1 }), strips: [Buffer.alloc(4)] }]), /should have 4 strips of pixels but lists 1/],
    [makeTiff([{ tags: fields(4, 4, { compression: 8 }), strips: [Buffer.from('not deflate')] }]), /compressed pixels cannot be read/],
    [makeTiff([{ tags: fields(4, 4, { compression: 8 }), strips: [deflateSync(Buffer.alloc(1_000_000))] }]), /more pixels than the page has room for/],
    [makeTiff([{ tags: fields(4, 4, { compression: 7 }), strips: [Buffer.from('nope')] }]), /JPEG strip is not a JPEG/],
    [makeTiff([{ tags: { ...fields(64, 64), 322: [SHORT, [0]], 323: [SHORT, [16]] }, strips: [Buffer.alloc(16)], tiled: true }]), /tiles have no size/],
    [makeTiff([{ tags: { ...fields(60_000, 1_000), 322: [SHORT, [16]], 323: [SHORT, [16]] }, strips: [Buffer.alloc(16)], tiled: true }]), /too large|should have/],
    [makeTiff([{ tags: { ...fields(7000, 7000, { bps: [1], compression: 4 }), 322: [SHORT, [1]], 323: [SHORT, [1]] }, strips: [Buffer.alloc(1)], tiled: true }]), /should have 49000000 tiles of pixels but lists 1/],
  ];
  // A strip that starts past the end of the file.
  cases.push([makeTiff([{ tags: fields(4, 4), strips: [Buffer.alloc(16)], offsets: [65535] }]), /pixels are past the end of the file/]);
  const started = Date.now();
  for (const [buf, re] of cases) {
    assert.throws(() => readTiff(buf), (e) => e.status === 400 && re.test(e.message), `${re}`);
  }
  // A strip cut short by the end of the file (its last 10 bytes, 16 said): what is there is kept,
  // with a warning.
  const end = makeTiff([{ tags: fields(4, 4), strips: [Buffer.alloc(16)], offsets: [good.length - 10], counts: [16] }]);
  assert.equal(end.length, good.length);
  const cut = readTiff(end);
  assert.match(cut.warnings.join(' '), /^Page 1: the file is cut short/);
  assert.deepEqual([...rawOf(cut.pages[0].image)], [...end.subarray(end.length - 10), ...Buffer.alloc(6, 0)]);

  // Every prefix and many damaged copies of the fixtures: an Error with a status, or pages.
  let seed = 3;
  const rnd = (n) => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
  for (const file of ['fax-g4.tif', 'rgb-tiles.tif', 'rgb-planar.tif', 'rgb-jpeg-strips.tif', 'palette-packbits.tif', 'rgb-mm-orient6.tif', 'rgba-deflate.tif']) {
    const buf = fixture(file);
    const tries = [];
    for (let n = 0; n < buf.length; n += Math.max(1, Math.floor(buf.length / 40))) tries.push(buf.subarray(0, n));
    for (let i = 0; i < 60; i++) {
      const b = Buffer.from(buf);
      for (let j = 0; j < 1 + rnd(5); j++) b[rnd(Math.min(b.length, 300))] = rnd(256);
      tries.push(b);
    }
    for (const b of tries) {
      try {
        tiffToPdf(b, {});
      } catch (e) {
        assert.equal(e.status, 400, `${file}: ${e.stack}`);
      }
    }
  }
  assert.ok(Date.now() - started < 10_000, `${Date.now() - started} ms`);
});
