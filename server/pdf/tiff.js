// PDF Studio (0.66): TIFF pictures, as office scanners and fax software make them (often several
// pages in one file, often black-and-white fax compression). Only Safari can show a TIFF, so they
// are read here, on the server, with Node's standard library only.
//
// readTiff(buf, { maxPixels, maxPages }) → { pages: [{ width, height, xDpi, yDpi, image }], warnings }
//   width, height: the page in pixels, the way up it is meant to be seen (Orientation applied);
//   xDpi, yDpi: its resolution across and down (null when the file does not say), so a 300 dpi A4
//   scan is an A4 page; image: a picture description for embedImageObject (server/pdf/images.js):
//     { type: 'raw', width, height, colorSpace, bpc, decode?, data }   pixels, deflated (FlateDecode);
//         colorSpace 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK' | { indexed: Buffer (RGB triples) }
//     { type: 'ccitt', width, height, data, K, blackIs1, encodedByteAlign, endOfBlock }
//         fax data as it is in the file (CCITTFaxDecode): nothing is decoded
//     { type: 'jpeg', data, colorTransform? }   a JPEG as it is in the file, with its tables (DCTDecode)
//     { type: 'group', width, height, orientation, parts: [{ x, y, image }] }   several pictures
//         (strips, tiles) placed in one width × height picture, turned by the TIFF Orientation (1–8)
//   warnings: plain sentences about what was left out or could not be read.
// A page that cannot be read is left out with a warning; when no page can be read, the reason is
// an Error (status 400) in the same plain words.
//
// Read: byte orders II and MM; every page of the file (at most maxPages; a list of pages that loops
// is stopped); strips and tiles; no compression, PackBits, LZW (also the old LZW of early 1990s
// files), Deflate, with horizontal differencing (Predictor 2); CCITT fax (Modified Huffman, Group 3,
// Group 4) and JPEG (with its JPEGTables), both passed into the PDF as they are; black-and-white,
// grey, RGB, palette and CMYK pictures of 1, 2, 4, 8 or 16 bits (16 becomes 8), stored chunky or in
// separate planes; an alpha channel is laid on white; Orientation; resolution.
// Not read (the page is left out, saying why): old-style JPEG (compression 6), other compressions
// (JBIG, JPEG 2000, LZMA, Zstandard, WebP…), floating-point samples, YCbCr outside JPEG, CIE Lab,
// Predictor 3 and Predictor 2 on samples of fewer than 8 bits. Thumbnails (reduced-resolution
// pictures) are not pages and are skipped.
import { deflateSync, inflateSync, constants as Z } from 'node:zlib';
import { MAX_PIXELS, jpegInfo } from './images.js';

const MAX_PAGES = 500;
const MAX_SIDE = 1 << 20;
const fail = (msg) => {
  throw Object.assign(new Error(msg), { status: 400 });
};

export const isTiff = (b) => b && b.length >= 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a));

// Field types: bytes per value.
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
const COMPRESSION_NAMES = { 6: 'old-style JPEG', 9: 'JBIG', 10: 'JBIG', 32766: 'NeXT', 32809: 'ThunderScan', 34661: 'JBIG', 34676: 'SGI LogLuv', 34677: 'SGI LogLuv', 34712: 'JPEG 2000', 34887: 'LERC', 34925: 'LZMA', 50000: 'Zstandard', 50001: 'WebP', 50002: 'JPEG XL' };

export function readTiff(input, { maxPixels = MAX_PIXELS, maxPages = MAX_PAGES } = {}) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!isTiff(buf)) {
    if (buf.length >= 4 && ((buf[0] === 0x49 && buf[2] === 0x2b) || (buf[0] === 0x4d && buf[3] === 0x2b))) fail('This is a BigTIFF file, which CORE cannot read. Save it as a standard TIFF (or as PDF or PNG) and try again.');
    fail('This picture is not a TIFF CORE can read.');
  }
  const le = buf[0] === 0x49;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const warnings = [];
  const warn = (w) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  const pages = [];
  const errors = [];
  const seen = new Set();
  let off = u32(4);
  let index = 0;
  while (off) {
    if (seen.has(off)) {
      warn('The list of pages in this TIFF loops back on itself; the pages before the loop were read.');
      break;
    }
    seen.add(off);
    if (off < 8 || off + 2 > buf.length) {
      if (index === 0) fail('This TIFF is damaged: its first page could not be found.');
      warn(`This TIFF is cut short: only the first ${index} page${index === 1 ? '' : 's'} could be read.`);
      break;
    }
    const n = u16(off);
    if (off + 2 + n * 12 > buf.length) {
      if (index === 0) fail('This TIFF is damaged: the description of its first page is cut short.');
      warn(`This TIFF is cut short: only the first ${index} page${index === 1 ? '' : 's'} could be read.`);
      break;
    }
    // The fields, read when asked for.
    const fields = new Map();
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      fields.set(u16(e), { type: u16(e + 2), count: u32(e + 4), e });
    }
    const next = off + 6 + n * 12 <= buf.length ? u32(off + 2 + n * 12) : 0;
    const ifd = ifdReader(buf, fields, u16, u32);
    // A reduced-resolution copy (a thumbnail) is not a page.
    if (!(ifd.value(254, 0) & 1) && ifd.value(255, 1) !== 2) {
      index++;
      if (index > maxPages) {
        warn(`This TIFF has more than ${maxPages} pages; only the first ${maxPages} were read.`);
        break;
      }
      try {
        pages.push(readPage(buf, ifd, le, { maxPixels, warn: (w) => warn(`Page ${index}: ${w}`) }));
      } catch (err) {
        if (!err.status) throw err;
        errors.push(err);
        warn(`Page ${index} was left out. ${err.message}`);
      }
    }
    off = next;
  }
  if (!pages.length) {
    if (errors.length) {
      const e = errors[0];
      if (index > 1) e.message = `None of the ${index} pages of this TIFF could be read. ${e.message}`;
      throw e;
    }
    fail('This TIFF has no pictures in it.');
  }
  return { pages, warnings };
}

// Field values: value(tag, default) → the first; values(tag) → all (or null); bytes(tag) → raw.
function ifdReader(buf, fields, u16, u32) {
  const at = (f) => {
    const size = (TYPE_SIZE[f.type] || 1) * f.count;
    const o = size <= 4 ? f.e + 8 : u32(f.e + 8);
    if (o + size > buf.length) fail('This TIFF is damaged: a field points past the end of the file.');
    return { o, size };
  };
  const values = (tag) => {
    const f = fields.get(tag);
    if (!f || !f.count) return null;
    if (f.count > 1 << 22) fail('This TIFF is damaged: a field is impossibly long.');
    const { o } = at(f);
    const out = new Array(f.count);
    for (let i = 0; i < f.count; i++) {
      if (f.type === 3 || f.type === 8) out[i] = u16(o + i * 2);
      else if (f.type === 4 || f.type === 9 || f.type === 13) out[i] = u32(o + i * 4);
      else if (f.type === 5 || f.type === 10) {
        const d = u32(o + i * 8 + 4);
        out[i] = d ? u32(o + i * 8) / d : 0;
      } else if (f.type === 11) out[i] = floatAt(o + i * 4, u32);
      else if (f.type === 12) out[i] = 0; // doubles: no field read here uses them
      else out[i] = buf[o + i];
    }
    return out;
  };
  return {
    has: (tag) => fields.has(tag),
    values,
    value: (tag, d = null) => values(tag)?.[0] ?? d,
    bytes: (tag) => {
      const f = fields.get(tag);
      if (!f) return null;
      const { o, size } = at(f);
      return buf.subarray(o, o + size);
    },
  };
}
const floatAt = (o, u32) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(u32(o));
  return b.readFloatBE(0);
};

// One page (one IFD).
function readPage(buf, ifd, le, { maxPixels, warn }) {
  const W = ifd.value(256);
  const H = ifd.value(257);
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 1 || H < 1) fail('This TIFF page has no size.');
  if (W > MAX_SIDE || H > MAX_SIDE) fail('This TIFF page has an impossible size.');
  const compression = ifd.value(259, 1);
  const spp = ifd.value(277, 1);
  const bpsAll = ifd.values(258) || [1];
  const bps = bpsAll[0];
  const planar = ifd.value(284, 1) === 2 && spp > 1 ? 2 : 1;
  const fax = compression === 2 || compression === 3 || compression === 4 || compression === 32771;
  let photometric = ifd.value(262, null);
  if (photometric === null) photometric = fax ? 0 : spp >= 3 ? 2 : 1;
  const orientation = Math.max(1, Math.min(8, ifd.value(274, 1) || 1));
  // Resolution, in dots per inch; null when unknown.
  const unit = ifd.value(296, 2);
  const res = (v) => {
    if (!(v > 0) || unit === 1) return null;
    const dpi = unit === 3 ? v * 2.54 : v;
    return dpi >= 1 && dpi <= 100_000 ? dpi : null;
  };
  let xDpi = res(ifd.value(282));
  let yDpi = res(ifd.value(283));
  if (!xDpi && yDpi) xDpi = yDpi;
  if (!yDpi && xDpi) yDpi = xDpi;

  if (spp < 1 || spp > 16) fail('This TIFF page has an impossible number of colour channels.');
  if (bpsAll.some((b) => b !== bps)) fail('This TIFF page stores its colour channels with different numbers of bits, which CORE cannot read.');
  // Fax data is passed into the PDF as it is, at one bit a pixel: four times as many are allowed.
  const cap = fax ? maxPixels * 4 : maxPixels;
  if (W * H > cap) fail(`This picture is too large (more than ${Math.round(cap / 1e6)} megapixels). Make it smaller and try again.`);
  const chunks = chunkList(ifd, W, H, planar === 2 ? spp : 1);
  const fillOrder = ifd.value(266, 1);
  const data = (c) => chunkBytes(buf, c, warn);

  let image;
  if (fax) {
    if (spp !== 1 || bps !== 1) fail('This TIFF page is damaged: fax compression is only for black-and-white pictures.');
    const t4 = ifd.value(292, 0);
    const t6 = ifd.value(293, 0);
    if ((compression === 3 && t4 & 2) || (compression === 4 && t6 & 2)) warn('it may use uncompressed fax mode, which is passed into the PDF as it is but which some PDF readers cannot show.');
    const K = compression === 4 ? -1 : compression === 3 && t4 & 1 ? 4 : 0;
    const parts = chunks.map((c) => {
      let bytes = data(c);
      if (fillOrder === 2) bytes = reverseBits(bytes);
      return {
        x: c.x, y: c.y,
        image: {
          type: 'ccitt', width: c.w, height: c.h, data: bytes, K,
          // TIFF fax data codes white runs as 0 bits when 0 is white (Photometric 0).
          blackIs1: photometric === 1,
          encodedByteAlign: compression === 2 || compression === 32771,
          endOfBlock: compression !== 2 && compression !== 32771,
        },
      };
    });
    image = assemble(W, H, orientation, parts);
  } else if (compression === 7) {
    if (planar === 2) fail('This TIFF page stores JPEG colour channels in separate planes, which CORE cannot read.');
    if (photometric === 6 || photometric === 2) {
      if (spp < 3) fail('This TIFF page is damaged: a colour picture with fewer than three channels.');
    }
    const tables = ifd.bytes(347);
    const parts = chunks.map((c) => {
      const jpeg = withTables(data(c), tables);
      const info = jpegInfo(jpeg);
      return { x: c.x, y: c.y, w: info.width, h: info.height, image: { type: 'jpeg', data: jpeg, colorTransform: info.components === 3 ? (photometric === 2 ? 0 : 1) : undefined } };
    });
    image = assemble(W, H, orientation, parts);
  } else if (compression === 6) {
    fail('This TIFF page uses the old TIFF JPEG compression (from before 1995), which CORE cannot read. Open it in an image editor, save it as a new TIFF or as PNG, and try again.');
  } else if ([1, 5, 8, 32946, 32773].includes(compression)) {
    image = rawImage(ifd, { W, H, spp, bps, planar, photometric, compression, fillOrder, chunks, data, le, maxPixels, warn });
    image = assemble(W, H, orientation, [{ x: 0, y: 0, image }]);
  } else {
    fail(`This TIFF page uses a compression CORE cannot read (${COMPRESSION_NAMES[compression] || `number ${compression}`}). Save it as a TIFF with LZW, ZIP or no compression, or as PNG, and try again.`);
  }
  const turned = orientation >= 5;
  return { width: turned ? H : W, height: turned ? W : H, xDpi: turned ? yDpi : xDpi, yDpi: turned ? xDpi : yDpi, image };
}

// One picture, or a group of strips and tiles turned by the orientation.
function assemble(W, H, orientation, parts) {
  if (parts.length === 1 && orientation === 1) {
    const p = parts[0];
    const im = p.image;
    const w = p.w ?? im.width;
    const h = p.h ?? im.height;
    if (p.x === 0 && p.y === 0 && w === W && h === H) return im;
  }
  return { type: 'group', width: W, height: H, orientation, parts: parts.map((p) => ({ x: p.x, y: p.y, w: p.w ?? p.image.width, h: p.h ?? p.image.height, image: p.image })) };
}

// Strips or tiles: [{ x, y, w, h, plane, offset, count }].
function chunkList(ifd, W, H, planes) {
  const tiled = ifd.has(322) || ifd.has(324);
  let list = [];
  let offsets;
  let counts;
  if (tiled) {
    const tw = ifd.value(322, 0);
    const th = ifd.value(323, 0);
    if (!(tw >= 1 && th >= 1 && tw <= 65536 && th <= 65536)) fail('This TIFF page is damaged: its tiles have no size.');
    offsets = ifd.values(324) || ifd.values(273);
    counts = ifd.values(325) || ifd.values(279);
    const across = Math.ceil(W / tw);
    const down = Math.ceil(H / th);
    if (!offsets || offsets.length < across * down * planes) fail(`This TIFF page is damaged: it should have ${across * down * planes} tiles of pixels but lists ${offsets?.length || 0}.`);
    for (let p = 0; p < planes; p++) for (let r = 0; r < down; r++) for (let c = 0; c < across; c++) list.push({ x: c * tw, y: r * th, w: tw, h: th, plane: p });
  } else {
    let rps = ifd.value(278, H);
    if (!(rps >= 1) || rps > H) rps = H;
    offsets = ifd.values(273);
    counts = ifd.values(279);
    const down = Math.ceil(H / rps);
    if (!offsets || offsets.length < down * planes) fail(`This TIFF page is damaged: it should have ${down * planes} strips of pixels but lists ${offsets?.length || 0}.`);
    for (let p = 0; p < planes; p++) for (let r = 0; r < down; r++) list.push({ x: 0, y: r * rps, w: W, h: Math.min(rps, H - r * rps), plane: p });
  }
  list = list.map((c, i) => ({ ...c, offset: offsets[i], count: counts?.[i] ?? null }));
  return list;
}

function chunkBytes(buf, c, warn) {
  if (c.offset >= buf.length || (c.count === 0 && c.offset === 0)) fail('This TIFF is damaged: its pixels are past the end of the file.');
  const end = c.count === null ? buf.length : c.offset + c.count;
  if (end > buf.length) warn('the file is cut short, so the end of the page is missing.');
  return buf.subarray(c.offset, Math.min(end, buf.length));
}

// A TIFF JPEG strip or tile with the shared tables (JPEGTables) put in after its SOI.
function withTables(jpeg, tables) {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) fail('This TIFF page is damaged: a JPEG strip is not a JPEG.');
  if (!tables || tables.length < 4 || tables[0] !== 0xff || tables[1] !== 0xd8) return jpeg;
  let end = tables.length;
  if (tables[end - 2] === 0xff && tables[end - 1] === 0xd9) end -= 2;
  return Buffer.concat([jpeg.subarray(0, 2), tables.subarray(2, end), jpeg.subarray(2)]);
}

const REVERSE = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let r = 0;
    for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 0x80 >> b;
    t[i] = r;
  }
  return t;
})();
const reverseBits = (b) => {
  const out = Buffer.alloc(b.length);
  for (let i = 0; i < b.length; i++) out[i] = REVERSE[b[i]];
  return out;
};

// ---------- Pixels decoded here ----------
function rawImage(ifd, { W, H, spp, bps, planar, photometric, compression, fillOrder, chunks, data, le, maxPixels, warn }) {
  const format = ifd.value(339, 1);
  if (format === 3) fail('This TIFF page has floating-point pixels (as HDR and scientific pictures do), which CORE cannot read.');
  if (format !== 1 && format !== 4) fail('This TIFF page has signed pixel values, which CORE cannot read.');
  if (![1, 2, 4, 8, 16].includes(bps)) fail(`This TIFF page has ${bps}-bit colour channels, which CORE cannot read.`);
  if (photometric === 6) fail('This TIFF page stores YCbCr colours without JPEG compression, which CORE cannot read. Save it again as RGB and try again.');
  if (photometric === 4) fail('This TIFF page is a transparency mask, not a picture.');
  const nc = { 0: 1, 1: 1, 2: 3, 3: 1, 5: 4 }[photometric];
  if (!nc) fail(`This TIFF page uses a colour model CORE cannot read (${{ 8: 'CIE Lab', 9: 'ICC Lab', 10: 'ITU Lab', 32844: 'LogL', 32845: 'LogLuv', 34892: 'linear raw' }[photometric] || `number ${photometric}`}).`);
  if (photometric === 5 && ifd.value(332, 1) === 2) fail('This TIFF page uses ink colours other than CMYK, which CORE cannot read.');
  if (spp < nc) fail('This TIFF page is damaged: it has fewer colour channels than its colour model needs.');
  if (W * H > maxPixels) fail(`This picture is too large (more than ${Math.round(maxPixels / 1e6)} megapixels). Make it smaller and try again.`);
  const predictor = ifd.value(317, 1);
  if (predictor === 3) fail('This TIFF page uses floating-point prediction, which CORE cannot read.');
  if (predictor === 2 && bps < 8) fail('This TIFF page uses prediction on pixels of fewer than 8 bits, which CORE cannot read.');
  if (predictor !== 1 && predictor !== 2) warn(`its unknown predictor (${predictor}) was ignored.`);
  const extra = spp - nc;
  const extraKinds = ifd.values(338) || [];
  const alphaKind = extra > 0 ? extraKinds[0] ?? 0 : 0; // 1: premultiplied, 2: straight, 0: unknown (ignored)
  let palette = null;
  if (photometric === 3) {
    const map = ifd.values(320);
    const size = 1 << bps;
    if (!map || map.length < size * 3) fail('This TIFF page is damaged: its colour palette is missing.');
    // 16-bit entries; some writers put 8-bit values in them.
    const eight = map.slice(0, size * 3).every((v) => v < 256);
    palette = Buffer.alloc(size * 3);
    for (let i = 0; i < size; i++) for (let c = 0; c < 3; c++) palette[i * 3 + c] = eight ? map[c * size + i] : map[c * size + i] >> 8;
  }

  // The page's samples as stored: rows of whole bytes, one plane after another.
  const planes = planar === 2 ? spp : 1;
  const perPixel = planar === 2 ? 1 : spp;
  const stride = Math.ceil((W * perPixel * bps) / 8);
  const raster = Buffer.alloc(stride * H * planes);
  let short = false;
  for (const c of chunks) {
    const rowBytes = Math.ceil((c.w * perPixel * bps) / 8);
    const expected = rowBytes * c.h;
    let raw = data(c);
    if (fillOrder === 2 && bps < 8 && compression === 1) raw = reverseBits(raw);
    let px = decompress(raw, compression, expected);
    if (px.length < expected) {
      short = true;
      const padded = Buffer.alloc(expected);
      px.copy(padded);
      px = padded;
    }
    if (predictor === 2) undoPredictor(px, rowBytes, c.h, perPixel, bps, le);
    const xb = (c.x * perPixel * bps) / 8;
    const n = Math.min(rowBytes, stride - xb);
    const base = c.plane * stride * H;
    for (let r = 0; r < c.h && c.y + r < H; r++) px.copy(raster, base + (c.y + r) * stride + xb, r * rowBytes, r * rowBytes + n);
  }
  if (short) warn('some of its pixels are missing (the file is damaged or cut short), so part of the page is blank.');

  // As they are, when PDF can take them so (rows of whole bytes, as TIFF has them).
  if (planes === 1 && extra === 0 && bps <= 8) {
    const colorSpace = photometric === 3 ? { indexed: palette } : nc === 1 ? 'DeviceGray' : nc === 3 ? 'DeviceRGB' : 'DeviceCMYK';
    return { type: 'raw', width: W, height: H, colorSpace, bpc: bps, decode: photometric === 0 ? [1, 0] : undefined, data: deflateSync(raster) };
  }
  // Otherwise as 8 bits a channel, chunky, without the extra channels (alpha laid on white).
  const outC = palette ? 3 : nc;
  const out = Buffer.alloc(W * H * outC);
  const max = (1 << bps) - 1;
  const sample = (plane, y, i) => {
    const row = plane * stride * H + y * stride;
    if (bps === 8) return raster[row + i];
    if (bps === 16) return raster[row + i * 2 + (le ? 1 : 0)];
    const bit = i * bps;
    const v = (raster[row + (bit >> 3)] >> (8 - bps - (bit & 7))) & max;
    return v;
  };
  const scale = (v) => (bps === 8 || bps === 16 ? v : Math.round((v * 255) / max));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const get = (ch) => (planar === 2 ? sample(ch, y, x) : sample(0, y, x * spp + ch));
      const o = (y * W + x) * outC;
      let a = 255;
      if (alphaKind === 1 || alphaKind === 2) a = scale(get(nc));
      if (palette) {
        // Palette indexes are never scaled; 16-bit ones were read as their high byte above, so
        // read them whole here.
        const idx = bps === 16 ? (planar === 2 ? raw16(raster, stride, H, 0, y, x, le) : raw16(raster, stride, H, 0, y, x * spp, le)) : get(0);
        for (let c = 0; c < 3; c++) out[o + c] = onWhite(palette[Math.min(idx, palette.length / 3 - 1) * 3 + c], a, alphaKind, false);
        continue;
      }
      for (let c = 0; c < nc; c++) {
        let v = scale(get(c));
        if (photometric === 0) v = 255 - v;
        out[o + c] = onWhite(v, a, alphaKind, nc === 4);
      }
    }
  }
  const colorSpace = outC === 1 ? 'DeviceGray' : outC === 3 ? 'DeviceRGB' : 'DeviceCMYK';
  return { type: 'raw', width: W, height: H, colorSpace, bpc: 8, data: deflateSync(out) };
}
const raw16 = (raster, stride, H, plane, y, i, le) => {
  const o = plane * stride * H + y * stride + i * 2;
  return le ? raster[o] | (raster[o + 1] << 8) : (raster[o] << 8) | raster[o + 1];
};
// A channel value seen on white paper through alpha a (premultiplied: kind 1; straight: kind 2).
// White is 255 in grey and RGB, 0 in CMYK.
function onWhite(v, a, kind, cmyk) {
  if (kind !== 1 && kind !== 2) return v;
  if (cmyk) return kind === 1 ? v : Math.round((v * a) / 255);
  return kind === 1 ? Math.min(255, v + 255 - a) : Math.round((v * a + 255 * (255 - a)) / 255);
}

function decompress(raw, compression, expected) {
  if (compression === 1) return raw.subarray(0, expected);
  if (compression === 32773) return packBits(raw, expected);
  if (compression === 5) return lzw(raw, expected);
  // Deflate (8, and 32946 from before it had a number): what can be read of a damaged stream.
  try {
    return inflateSync(raw, { finishFlush: Z.Z_SYNC_FLUSH, maxOutputLength: expected + 65536 });
  } catch (err) {
    if (err.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) fail('This TIFF page is damaged: a strip holds more pixels than the page has room for.');
    fail('This TIFF page is damaged: its compressed pixels cannot be read.');
  }
}

function packBits(src, expected) {
  const out = Buffer.alloc(expected);
  let o = 0;
  let i = 0;
  while (i < src.length && o < expected) {
    const n = src[i++];
    if (n < 128) {
      const len = Math.min(n + 1, src.length - i, expected - o);
      src.copy(out, o, i, i + len);
      o += len;
      i += n + 1;
    } else if (n > 128) {
      const len = Math.min(257 - n, expected - o);
      if (i < src.length) out.fill(src[i], o, o + len);
      o += len;
      i++;
    }
  }
  return out.subarray(0, o);
}

// TIFF LZW: codes of 9 to 12 bits, most significant bit first, one code early in changing width;
// old-style LZW (files from before TIFF 6) is least significant bit first, without the early change.
function lzw(src, expected) {
  const old = src.length >= 2 && src[0] === 0 && (src[1] & 1) === 1;
  const early = old ? 0 : 1;
  const out = Buffer.alloc(expected);
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) {
    suffix[i] = i;
    first[i] = i;
    length[i] = 1;
  }
  let o = 0;
  let next = 258;
  let width = 9;
  let prev = -1;
  let acc = 0;
  let have = 0;
  let i = 0;
  const emit = (code) => {
    const len = length[code];
    let at = o + len - 1;
    let c = code;
    while (c >= 0 && at >= o) {
      if (at < expected) out[at] = suffix[c];
      at--;
      c = c < 258 ? -1 : prefix[c];
    }
    o += len;
  };
  while (o < expected) {
    while (have < width && i < src.length) {
      if (old) acc |= src[i++] << have;
      else acc = ((acc << 8) | src[i++]) >>> 0;
      have += 8;
    }
    if (have < width) break;
    let code;
    if (old) {
      code = acc & ((1 << width) - 1);
      acc >>>= width;
    } else {
      code = (acc >>> (have - width)) & ((1 << width) - 1);
      acc &= (1 << (have - width)) - 1;
    }
    have -= width;
    if (code === 256) {
      next = 258;
      width = 9;
      prev = -1;
      continue;
    }
    if (code === 257) break;
    if (prev < 0) {
      if (code > 255) break; // damaged
      emit(code);
      prev = code;
      continue;
    }
    // The new entry is the previous string and the first character of this one (of the previous
    // one when this code is the entry being made).
    let firstChar;
    if (code < next) firstChar = first[code];
    else if (code === next) firstChar = first[prev];
    else break; // damaged
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = firstChar;
      first[next] = first[prev];
      length[next] = Math.min(65535, length[prev] + 1);
      next++;
    }
    emit(code);
    if (next + early >= 1 << width && width < 12) width++;
    prev = code;
  }
  return out.subarray(0, Math.min(o, expected));
}

// Horizontal differencing: each sample is stored as the difference from the one to its left.
function undoPredictor(px, rowBytes, rows, spp, bps, le) {
  if (bps === 8) {
    for (let r = 0; r < rows; r++) {
      const s = r * rowBytes;
      for (let i = s + spp; i < s + rowBytes; i++) px[i] = (px[i] + px[i - spp]) & 255;
    }
  } else if (bps === 16) {
    for (let r = 0; r < rows; r++) {
      const s = r * rowBytes;
      for (let i = s + spp * 2; i + 1 < s + rowBytes; i += 2) {
        const p = i - spp * 2;
        const prev = le ? px[p] | (px[p + 1] << 8) : (px[p] << 8) | px[p + 1];
        const cur = le ? px[i] | (px[i + 1] << 8) : (px[i] << 8) | px[i + 1];
        const v = (prev + cur) & 0xffff;
        if (le) { px[i] = v & 255; px[i + 1] = v >> 8; } else { px[i] = v >> 8; px[i + 1] = v & 255; }
      }
    }
  }
}
