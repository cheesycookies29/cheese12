// PDF Studio (0.64): pictures into a PDF. A JPEG goes in as it is (PDFs read JPEG themselves); a
// PNG is unpacked here (node:zlib) and its pixels go in deflated, with its transparency as a soft
// mask. Other kinds (WebP, GIF, HEIC…) are turned into PNG in the browser before they are sent.
import { inflateSync } from 'node:zlib';
import { name, ref, bytes } from './writer.js';

export const MAX_PIXELS = 60_000_000; // e.g. 10,000 × 6,000
const fail = (msg) => {
  throw Object.assign(new Error(msg), { status: 400 });
};

// Width, height and colour channels of a JPEG, from its frame header.
export function jpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) fail('This picture is not a JPEG ATLAS can read.');
  let i = 2;
  let adobe = false;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
      i += marker === 0xff ? 1 : 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xee && buf.subarray(i + 4, i + 9).toString('latin1') === 'Adobe') adobe = true;
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      const components = buf[i + 9];
      if (!width || !height) fail('This JPEG has no size.');
      if (width * height > MAX_PIXELS) fail('This picture is too large (more than 60 megapixels). Make it smaller and try again.');
      return { width, height, components, adobe };
    }
    i += 2 + len;
  }
  fail('This JPEG is damaged: its size could not be found.');
}

// A PNG's pixels: { width, height, channels: 1 | 3, pixels: Buffer, alpha: Buffer | null }, 8 bits each.
export function decodePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) fail('This picture is not a PNG ATLAS can read.');
  let i = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (!ihdr || !idat.length) fail('This PNG is damaged.');
  const { width, height, depth, color, interlace } = ihdr;
  if (!width || !height) fail('This PNG has no size.');
  if (width * height > MAX_PIXELS) fail('This picture is too large (more than 60 megapixels). Make it smaller and try again.');
  if (interlace) fail('This PNG is interlaced. Open it in an image editor, save it again without interlacing, and try again.');
  const perPixel = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!perPixel || ![1, 2, 4, 8, 16].includes(depth) || (depth < 8 && color !== 0 && color !== 3) || (depth === 16 && color === 3)) fail('This PNG uses a colour format ATLAS cannot read.');
  const bitsPerPixel = perPixel * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height + 1024 });
  if (raw.length < (stride + 1) * height) fail('This PNG is damaged: its pixels are cut short.');
  // Undo the per-row filters (None, Sub, Up, Average, Paeth).
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y ? out[prev + x] : 0;
      const c = y && x >= bpp ? out[prev + x - bpp] : 0;
      let p;
      if (f === 0) p = 0;
      else if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else fail('This PNG is damaged: a row has an unknown filter.');
      out[row + x] = (v + p) & 0xff;
    }
  }
  // Each sample as 8 bits.
  const sample = (row, n) => {
    if (depth === 8) return out[row + n];
    if (depth === 16) return out[row + n * 2];
    const perByte = 8 / depth;
    const byte = out[row + Math.floor(n / perByte)];
    const shift = 8 - depth * ((n % perByte) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const gray = color === 0 || color === 4;
  const channels = gray ? 1 : 3;
  const pixels = Buffer.alloc(width * height * channels);
  const hasAlpha = color === 4 || color === 6 || Boolean(trns);
  const alpha = hasAlpha ? Buffer.alloc(width * height, 255) : null;
  const scale = depth < 8 && color === 0 ? 255 / ((1 << depth) - 1) : 1;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      if (color === 3) {
        const idx = sample(row, x);
        pixels[at * 3] = palette?.[idx * 3] ?? 0;
        pixels[at * 3 + 1] = palette?.[idx * 3 + 1] ?? 0;
        pixels[at * 3 + 2] = palette?.[idx * 3 + 2] ?? 0;
        if (alpha && trns) alpha[at] = idx < trns.length ? trns[idx] : 255;
      } else if (gray) {
        const g = sample(row, x * perPixel);
        pixels[at] = Math.round(g * scale);
        if (color === 4) alpha[at] = sample(row, x * 2 + 1);
        else if (trns && trns.length >= 2 && g === trns.readUInt16BE(0) >> (depth === 16 ? 8 : 0)) alpha[at] = 0;
      } else {
        const r = sample(row, x * perPixel);
        const g = sample(row, x * perPixel + 1);
        const b = sample(row, x * perPixel + 2);
        pixels[at * 3] = r;
        pixels[at * 3 + 1] = g;
        pixels[at * 3 + 2] = b;
        if (color === 6) alpha[at] = sample(row, x * 4 + 3);
        else if (trns && trns.length >= 6 && r === trns[depth === 16 ? 0 : 1] && g === trns[depth === 16 ? 2 : 3] && b === trns[depth === 16 ? 4 : 5]) alpha[at] = 0;
      }
    }
  }
  // Fully opaque after all: no mask.
  const opaque = !alpha || alpha.every((a) => a === 255);
  return { width, height, channels, pixels, alpha: opaque ? null : alpha };
}

export const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
export const isPng = (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;

// An image XObject in the writer: { id, width, height } (pixels).
export function embedImage(writer, data) {
  const buf = Buffer.from(data);
  if (isJpeg(buf)) {
    const j = jpegInfo(buf);
    const cs = j.components === 1 ? 'DeviceGray' : j.components === 4 ? 'DeviceCMYK' : 'DeviceRGB';
    const id = writer.stream({ Type: name('XObject'), Subtype: name('Image'), Width: j.width, Height: j.height, ColorSpace: name(cs), BitsPerComponent: 8, Filter: name('DCTDecode'), ...(j.components === 4 && j.adobe ? { Decode: [1, 0, 1, 0, 1, 0, 1, 0] } : {}) }, buf, { compress: false });
    return { id, width: j.width, height: j.height };
  }
  if (isPng(buf)) {
    const p = decodePng(buf);
    const mask = p.alpha ? writer.stream({ Type: name('XObject'), Subtype: name('Image'), Width: p.width, Height: p.height, ColorSpace: name('DeviceGray'), BitsPerComponent: 8 }, p.alpha) : null;
    const id = writer.stream({ Type: name('XObject'), Subtype: name('Image'), Width: p.width, Height: p.height, ColorSpace: name(p.channels === 1 ? 'DeviceGray' : 'DeviceRGB'), BitsPerComponent: 8, ...(mask ? { SMask: ref(mask) } : {}) }, p.pixels);
    return { id, width: p.width, height: p.height };
  }
  fail('Only JPEG and PNG pictures go into a PDF here.');
}

// The size of a picture without reading its pixels (for the layout before embedding).
export function imageSize(data) {
  const buf = Buffer.from(data);
  if (isJpeg(buf)) {
    const j = jpegInfo(buf);
    return { width: j.width, height: j.height };
  }
  if (isPng(buf)) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  return null;
}

// ---------- Pictures described by server/pdf/tiff.js (0.66) ----------
// The PDF matrix that turns the unit square a picture is drawn in by a TIFF Orientation (1–8): the
// picture's first row is at the top (1), the bottom (3, 4), the right (6, 7) or the left (5, 8).
const ORIENT = { 1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, 1, 0], 3: [-1, 0, 0, -1, 1, 1], 4: [1, 0, 0, -1, 0, 1], 5: [0, -1, -1, 0, 1, 1], 6: [0, -1, 1, 0, 0, 1], 7: [0, 1, 1, 0, 0, 0], 8: [0, 1, -1, 0, 1, 0] };
const n6 = (v) => String(Math.round(v * 1e6) / 1e6);

// An image (or form) XObject in the writer from a picture description (see readTiff):
// { id, width, height }, the width and height being the picture's as it is meant to be seen.
export function embedImageObject(writer, desc) {
  const image = { Type: name('XObject'), Subtype: name('Image') };
  if (desc.type === 'raw') {
    const cs = desc.colorSpace?.indexed ? [name('Indexed'), name('DeviceRGB'), desc.colorSpace.indexed.length / 3 - 1, bytes(desc.colorSpace.indexed)] : name(desc.colorSpace);
    const id = writer.stream({ ...image, Width: desc.width, Height: desc.height, ColorSpace: cs, BitsPerComponent: desc.bpc, ...(desc.decode ? { Decode: desc.decode } : {}), Filter: name('FlateDecode') }, desc.data, { compress: false });
    return { id, width: desc.width, height: desc.height };
  }
  if (desc.type === 'jpeg') {
    const j = jpegInfo(desc.data);
    const cs = j.components === 1 ? 'DeviceGray' : j.components === 4 ? 'DeviceCMYK' : 'DeviceRGB';
    const parms = desc.colorTransform !== undefined ? { DecodeParms: { ColorTransform: desc.colorTransform } } : {};
    const id = writer.stream({ ...image, Width: j.width, Height: j.height, ColorSpace: name(cs), BitsPerComponent: 8, Filter: name('DCTDecode'), ...parms, ...(j.components === 4 && j.adobe ? { Decode: [1, 0, 1, 0, 1, 0, 1, 0] } : {}) }, desc.data, { compress: false });
    return { id, width: j.width, height: j.height };
  }
  if (desc.type === 'ccitt') {
    const parms = { K: desc.K, Columns: desc.width, Rows: desc.height, ...(desc.blackIs1 ? { BlackIs1: true } : {}), ...(desc.encodedByteAlign ? { EncodedByteAlign: true } : {}), ...(desc.endOfBlock === false ? { EndOfBlock: false } : {}) };
    const id = writer.stream({ ...image, Width: desc.width, Height: desc.height, ColorSpace: name('DeviceGray'), BitsPerComponent: 1, Filter: name('CCITTFaxDecode'), DecodeParms: parms }, desc.data, { compress: false });
    return { id, width: desc.width, height: desc.height };
  }
  if (desc.type === 'group') {
    // A form drawing each part into its place in the unit square, turned by the orientation and
    // clipped to the picture (tiles and strips can reach past its edges).
    const W = desc.width;
    const H = desc.height;
    const ops = [`${(ORIENT[desc.orientation] || ORIENT[1]).join(' ')} cm`, '0 0 1 1 re W n'];
    const xobjects = {};
    desc.parts.forEach((p, i) => {
      const part = embedImageObject(writer, p.image);
      xobjects[`P${i + 1}`] = ref(part.id);
      const w = p.w ?? part.width;
      const h = p.h ?? part.height;
      ops.push(`q ${n6(w / W)} 0 0 ${n6(h / H)} ${n6(p.x / W)} ${n6(1 - (p.y + h) / H)} cm /P${i + 1} Do Q`);
    });
    const id = writer.stream({ Type: name('XObject'), Subtype: name('Form'), BBox: [0, 0, 1, 1], Resources: { XObject: xobjects, ProcSet: [name('PDF'), name('ImageB'), name('ImageC'), name('ImageI')] } }, Buffer.from(ops.join('\n'), 'latin1'));
    const turned = desc.orientation >= 5;
    return { id, width: turned ? H : W, height: turned ? W : H };
  }
  fail('This picture cannot go into a PDF.');
}
