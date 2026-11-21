// Files attached to records (medical certificates on leave requests, service desk tickets, project
// tasks and milestones). Each file is kept in an "attachments" folder next to the data file, named
// by its id, so the database itself stays small. Uploads arrive as base64 inside the JSON request.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { HttpError, keepPrivate } from './util.js';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '../shared/leave.js';
import { DOCX, XLSX } from '../shared/crm.js';

const ID_RE = /^[0-9a-f-]{36}$/;

// The real type, from the first bytes of the file rather than what the browser claims.
function sniff(buf) {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (/^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  return null;
}

// A Word (.docx) or Excel (.xlsx) file: a ZIP whose [Content_Types].xml names the main document part.
// Macro-enabled files (.docm, .xlsm, anything with a VBA project) and anything else are refused.
// Only the central directory and that one small part are read; nothing else is unpacked.
export function sniffOffice(buf) {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return null;
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) return null;
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  let types = null;
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    if (/vba/i.test(name)) return null; // a macro project: never
    if (name === '[Content_Types].xml') types = { method, packed, size, local: buf.readUInt32LE(at + 42) };
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  if (!types || types.size > 1024 * 1024 || types.local + 30 > buf.length || buf.readUInt32LE(types.local) !== 0x04034b50) return null;
  const start = types.local + 30 + buf.readUInt16LE(types.local + 26) + buf.readUInt16LE(types.local + 28);
  const raw = buf.subarray(start, start + types.packed);
  let xml;
  try {
    xml = (types.method === 0 ? raw : types.method === 8 ? inflateRawSync(raw, { maxOutputLength: 1024 * 1024 }) : null)?.toString('utf8');
  } catch {
    return null;
  }
  if (!xml || /macroEnabled|vbaProject/i.test(xml)) return null;
  if (xml.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) return DOCX;
  if (xml.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) return XLSX;
  return null;
}

// Animated pictures (profile pictures and project icons only, never attachments): a GIF of at most
// GIF_MAX_BYTES, its canvas at most GIF_MAX_SIDE pixels each way (read from its header).
export const GIF_MAX_BYTES = 1024 * 1024;
export const GIF_MAX_SIDE = 1024;
export const GIF_MAX_FRAMES = 1000;
// The GIF is read block by block (VAPT 0.33): each frame's own size is checked too (not only the
// canvas in the header), the number of frames is capped, and a file that does not hold together
// (cut short, an unknown block) is refused before anyone's browser tries to play it.
export function checkGif(buffer) {
  const unreadable = () => new HttpError(400, 'This GIF could not be read. Choose it again or use another.');
  if (buffer.length < 13) throw unreadable();
  if (buffer.length > GIF_MAX_BYTES) throw new HttpError(400, `The GIF is too large (${(buffer.length / 1048576).toFixed(1)} MB). The limit is 1 MB: use a shorter or smaller one.`);
  const w = buffer.readUInt16LE(6);
  const h = buffer.readUInt16LE(8);
  if (!w || !h) throw unreadable();
  const tooBig = (fw, fh) => new HttpError(400, `The GIF is too big (${fw} × ${fh} pixels). Use one of at most ${GIF_MAX_SIDE} × ${GIF_MAX_SIDE}.`);
  if (w > GIF_MAX_SIDE || h > GIF_MAX_SIDE) throw tooBig(w, h);
  let at = 13;
  const packed = buffer[10];
  if (packed & 0x80) at += 3 * 2 ** ((packed & 7) + 1);
  const subBlocks = () => {
    for (;;) {
      if (at >= buffer.length) throw unreadable();
      const size = buffer[at];
      at += 1 + size;
      if (size === 0) return;
    }
  };
  let frames = 0;
  for (;;) {
    if (at >= buffer.length) throw unreadable();
    const block = buffer[at];
    if (block === 0x3b) break; // the end
    if (block === 0x21) {
      at += 2; // extension: its label, then its data
      subBlocks();
    } else if (block === 0x2c) {
      if (at + 10 > buffer.length) throw unreadable();
      const fw = buffer.readUInt16LE(at + 5);
      const fh = buffer.readUInt16LE(at + 7);
      if (fw > GIF_MAX_SIDE || fh > GIF_MAX_SIDE) throw tooBig(fw, fh);
      const local = buffer[at + 9];
      at += 10;
      if (local & 0x80) at += 3 * 2 ** ((local & 7) + 1);
      at += 1; // the LZW code size
      subBlocks();
      if (++frames > GIF_MAX_FRAMES) throw new HttpError(400, `This GIF has more than ${GIF_MAX_FRAMES} frames. Use a shorter one.`);
    } else throw unreadable();
  }
  if (!frames) throw unreadable();
}

// { name, data: base64 } from the browser -> { name, type, buffer }, or a 400 explaining what's wrong.
// pictures: the picture types taken instead of the attachment types (a profile picture, an icon).
// documents: { types, maxBytes, hint } for another set of file types (a contract's documents).
export function parseUpload(input, { pictures = null, documents = null } = {}) {
  if (!input || typeof input.data !== 'string') throw new HttpError(400, 'The attached file could not be read. Please choose it again.');
  return uploadFromBuffer(input.name, Buffer.from(input.data.replace(/^data:[^,]*,/, ''), 'base64'), { pictures, documents });
}

// A long file name is cut to 120 characters before its extension, which it keeps (".pdf",
// ".docx"), so the file still opens with the right program once downloaded (0.47).
export function shortName(name, max = 120) {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
  return `${name.slice(0, max - ext.length - 1).trimEnd()}…${ext}`;
}

// A file from any source (e.g. an email attachment) -> { name, type, buffer }, checked the same way.
export function uploadFromBuffer(name, buffer, { pictures = null, documents = null } = {}) {
  if (!buffer.length) throw new HttpError(400, 'The attached file is empty.');
  const max = documents?.maxBytes || MAX_ATTACHMENT_BYTES;
  if (buffer.length > max) throw new HttpError(400, `The file is too large (${(buffer.length / 1048576).toFixed(1)} MB). The limit is ${max / 1048576} MB.`);
  const type = sniff(buffer) || (documents ? sniffOffice(buffer) : null);
  if (documents) {
    if (!documents.types[type]) throw new HttpError(400, documents.hint);
  } else if (pictures) {
    if (!pictures.includes(type)) throw new HttpError(400, `Use a picture: ${pictures.includes('image/gif') ? 'JPEG, PNG, WebP or GIF' : 'JPEG, PNG or WebP'}.`);
    if (type === 'image/gif') checkGif(buffer);
  } else if (!ATTACHMENT_TYPES[type]) throw new HttpError(400, 'Attach a PDF or a photo (JPEG, PNG or WebP).');
  const safeName = shortName(String(name || 'attachment').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()) || 'attachment';
  return { name: safeName, type, buffer };
}

export function createAttachments(dir) {
  const fileOf = (id) => {
    if (!ID_RE.test(id || '')) throw new HttpError(404, 'File not found.');
    return path.join(dir, id);
  };
  // Files kept by older builds were readable by other accounts on the computer: close them.
  if (fs.existsSync(dir)) {
    keepPrivate(dir, 0o700);
    try {
      for (const name of fs.readdirSync(dir)) if (ID_RE.test(name)) keepPrivate(path.join(dir, name));
    } catch {}
  }
  return {
    // Stores an upload; returns the metadata kept on the record.
    save({ name, type, buffer }) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const id = randomUUID();
      fs.writeFileSync(fileOf(id), buffer, { mode: 0o600 });
      return { id, name, type, size: buffer.length, uploadedAt: new Date().toISOString() };
    },
    read(meta) {
      const file = fileOf(meta?.id);
      if (!fs.existsSync(file)) throw new HttpError(404, 'The file is missing from the server. It may not have been included when data was restored.');
      return { name: meta.name, type: meta.type, size: meta.size, data: fs.readFileSync(file).toString('base64') };
    },
    // The file's bytes, for a download (Project Management sends them as a file, not inside JSON).
    buffer(meta) {
      const file = fileOf(meta?.id);
      if (!fs.existsSync(file)) throw new HttpError(404, 'The file is missing from the server. It may not have been included when data was restored.');
      return fs.readFileSync(file);
    },
    // Files are not removed when data is replaced (demo data, restore), so restoring a backup brings them back.
    remove(meta) {
      if (meta?.id && ID_RE.test(meta.id)) fs.rmSync(path.join(dir, meta.id), { force: true });
    },
  };
}

// The picture inside a PDF, for its preview (0.54): a scanned or photographed document is a PDF
// holding a JPEG of each page. Returns [start, end) of the first good-sized JPEG image stream (the
// first page, as a rule), else the largest; null when the PDF has none (a typed document). Only
// plain DCTDecode streams count (no other filter on top), and the bytes must begin and end as a
// JPEG does. Looks at most at the first 60 images.
export function pdfJpegRange(buf) {
  if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
  const s = buf.toString('latin1');
  const found = [];
  let at = 0;
  for (let n = 0; n < 60; n++) {
    const i = s.indexOf('/DCTDecode', at);
    if (i < 0) break;
    at = i + 10;
    const dictStart = s.lastIndexOf('<<', i);
    const head = s.slice(Math.max(dictStart, i - 600), i);
    const kw = s.indexOf('stream', i);
    if (kw < 0) break;
    const dict = head + s.slice(i, kw);
    if (!/\/Subtype\s*\/Image/.test(dict) || /Flate|LZW|ASCII|RunLength|JBIG|JPX/.test(dict)) continue;
    let start = kw + 6;
    if (s[start] === '\r') start++;
    if (s[start] === '\n') start++;
    const stop = s.indexOf('endstream', start);
    if (stop < 0) break;
    let end = stop;
    while (end > start && (s[end - 1] === '\n' || s[end - 1] === '\r')) end--;
    if (buf[start] !== 0xff || buf[start + 1] !== 0xd8 || buf[start + 2] !== 0xff || buf[end - 2] !== 0xff || buf[end - 1] !== 0xd9) continue;
    found.push([start, end]);
    at = stop;
  }
  if (!found.length) return null;
  return found.find(([a, b]) => b - a >= 15 * 1024) || found.reduce((x, y) => (y[1] - y[0] > x[1] - x[0] ? y : x));
}
