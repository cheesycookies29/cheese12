// Files attached to records (medical certificates on leave requests). Each file is
// kept in an "attachments" folder next to the data file, named by its id, so the
// database itself stays small. Uploads arrive as base64 inside the JSON request.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '../shared/leave.js';

const ID_RE = /^[0-9a-f-]{36}$/;

// The real type, from the first bytes of the file rather than what the browser claims.
function sniff(buf) {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// { name, data: base64 } from the browser -> { name, type, buffer }, or a 400 explaining what's wrong.
export function parseUpload(input) {
  if (!input || typeof input.data !== 'string') throw new HttpError(400, 'The attached file could not be read. Please choose it again.');
  return uploadFromBuffer(input.name, Buffer.from(input.data.replace(/^data:[^,]*,/, ''), 'base64'));
}

// A file from any source (e.g. an email attachment) -> { name, type, buffer }, checked the same way.
export function uploadFromBuffer(name, buffer) {
  if (!buffer.length) throw new HttpError(400, 'The attached file is empty.');
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new HttpError(400, `The file is too large (${(buffer.length / 1048576).toFixed(1)} MB). The limit is ${MAX_ATTACHMENT_BYTES / 1048576} MB.`);
  const type = sniff(buffer);
  if (!ATTACHMENT_TYPES[type]) throw new HttpError(400, 'Attach a PDF or a photo (JPEG, PNG or WebP).');
  const safeName = String(name || 'attachment').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'attachment';
  return { name: safeName, type, buffer };
}

export function createAttachments(dir) {
  const fileOf = (id) => {
    if (!ID_RE.test(id || '')) throw new HttpError(404, 'File not found.');
    return path.join(dir, id);
  };
  return {
    // Stores an upload; returns the metadata kept on the record.
    save({ name, type, buffer }) {
      fs.mkdirSync(dir, { recursive: true });
      const id = randomUUID();
      fs.writeFileSync(fileOf(id), buffer);
      return { id, name, type, size: buffer.length, uploadedAt: new Date().toISOString() };
    },
    read(meta) {
      const file = fileOf(meta?.id);
      if (!fs.existsSync(file)) throw new HttpError(404, 'The file is missing from the server. It may not have been included when data was restored.');
      return { name: meta.name, type: meta.type, size: meta.size, data: fs.readFileSync(file).toString('base64') };
    },
    // Files are not removed when data is replaced (demo data, restore), so restoring a backup brings them back.
    remove(meta) {
      if (meta?.id && ID_RE.test(meta.id)) fs.rmSync(path.join(dir, meta.id), { force: true });
    },
  };
}
