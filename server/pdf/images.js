// PDF Studio (0.64): pictures into a PDF. A JPEG goes in as it is (PDFs read JPEG themselves); a
// PNG is unpacked here (node:zlib) and its pixels go in deflated, with its transparency as a soft
// mask. Other kinds (WebP, GIF, HEIC…) are turned into PNG in the browser before they are sent.
import { inflateSync } from 'node:zlib';
import { name, ref } from './writer.js';

export const MAX_PIXELS = 60_000_000; // e.g. 10,000 × 6,000
const fail = (msg) => {
  throw Object.assign(new Error(msg), { status: 400 });
};

// Width, height and colour channels of a JPEG, from its frame header.
export function jpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) fail('This picture is not a JPEG CORE can read.');
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
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) fail('This picture is not a PNG CORE can read.');
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
  if (!perPixel || ![1, 2, 4, 8, 16].includes(depth) || (depth < 8 && color !== 0 && color !== 3) || (depth === 16 && color === 3)) fail('This PNG uses a colour format CORE cannot read.');
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
