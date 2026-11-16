// Files attached to records (medical certificates on leave requests, service desk tickets, project
// tasks and milestones). Each file is kept in an "attachments" folder next to the data file, named
// by its id, so the database itself stays small. Uploads arrive as base64 inside the JSON request.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError, keepPrivate } from './util.js';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '../shared/leave.js';

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
export function parseUpload(input, { pictures = null } = {}) {
  if (!input || typeof input.data !== 'string') throw new HttpError(400, 'The attached file could not be read. Please choose it again.');
  return uploadFromBuffer(input.name, Buffer.from(input.data.replace(/^data:[^,]*,/, ''), 'base64'), { pictures });
}

// A file from any source (e.g. an email attachment) -> { name, type, buffer }, checked the same way.
export function uploadFromBuffer(name, buffer, { pictures = null } = {}) {
  if (!buffer.length) throw new HttpError(400, 'The attached file is empty.');
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new HttpError(400, `The file is too large (${(buffer.length / 1048576).toFixed(1)} MB). The limit is ${MAX_ATTACHMENT_BYTES / 1048576} MB.`);
  const type = sniff(buffer);
  if (pictures) {
    if (!pictures.includes(type)) throw new HttpError(400, `Use a picture: ${pictures.includes('image/gif') ? 'JPEG, PNG, WebP or GIF' : 'JPEG, PNG or WebP'}.`);
    if (type === 'image/gif') checkGif(buffer);
  } else if (!ATTACHMENT_TYPES[type]) throw new HttpError(400, 'Attach a PDF or a photo (JPEG, PNG or WebP).');
  const safeName = String(name || 'attachment').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'attachment';
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
