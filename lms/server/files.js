// Uploaded files (class resources, handed-in work) and class resources (a file or a link).
// Files arrive as base64 in JSON (up to 10 MB each) and are kept in data/files/<id>.
// They are served back with nosniff and a sandbox policy; only PDFs, pictures, audio
// and video open in the browser, everything else downloads, so an uploaded web page
// can never run as part of the LMS.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError, text } from './util.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp)|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm|mp4))$/;

// Kinds used for the filter chips and icons.
export function fileCategory(name = '', mime = '') {
  const ext = path.extname(name).toLowerCase();
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (['.ppt', '.pptx', '.odp', '.key'].includes(ext)) return 'presentation';
  if (['.xls', '.xlsx', '.ods', '.csv'].includes(ext)) return 'spreadsheet';
  if (['.doc', '.docx', '.odt', '.rtf', '.txt', '.md'].includes(ext)) return 'document';
  if (['.zip', '.rar', '.7z', '.gz'].includes(ext)) return 'archive';
  return 'other';
}

export function createFileStore(db) {
  const memory = new Map(); // tests (no data folder)
  const dir = db.dir ? path.join(db.dir, 'files') : null;
  if (dir) fs.mkdirSync(dir, { recursive: true });
  return {
    // input: { name, type, data (base64) }
    save(input, { sectionId = null, owner }) {
      const name = text(input?.name, 200).replace(/[\\/:*?"<>|]+/g, '_');
      if (!name || typeof input?.data !== 'string') fail('Choose a file.');
      const bytes = Buffer.from(input.data.replace(/^data:[^,]*,/, ''), 'base64');
      if (!bytes.length) fail('That file is empty.');
      if (bytes.length > MAX_FILE_BYTES) fail('Files can be at most 10 MB.');
      const meta = {
        id: randomUUID(), name, mime: /^[\w.+-]+\/[\w.+-]+$/.test(input.type || '') ? input.type : 'application/octet-stream',
        size: bytes.length, sectionId, ownerId: owner.id, createdAt: new Date().toISOString(),
      };
      meta.category = fileCategory(name, meta.mime);
      if (dir) fs.writeFileSync(path.join(dir, meta.id), bytes);
      else memory.set(meta.id, bytes);
      db.data.files.push(meta);
      return meta;
    },
    read(id) {
      const meta = db.data.files.find((f) => f.id === id);
      if (!meta) fail('File not found.', 404);
      const bytes = dir ? (fs.existsSync(path.join(dir, id)) ? fs.readFileSync(path.join(dir, id)) : null) : memory.get(id);
      if (!bytes) fail('This file is missing from the server.', 404);
      return { meta, bytes };
    },
    remove(id) {
      db.data.files = db.data.files.filter((f) => f.id !== id);
      if (dir) fs.rmSync(path.join(dir, id), { force: true });
      else memory.delete(id);
    },
  };
}

export const fileInfo = (f) => (f ? { id: f.id, name: f.name, mime: f.mime, size: f.size, category: f.category } : null);

// A file as an HTTP response.
export function fileResponse({ meta, bytes }, download) {
  const inline = !download && INLINE.test(meta.mime);
  const encoded = encodeURIComponent(meta.name);
  return {
    raw: bytes,
    type: inline ? meta.mime : 'application/octet-stream',
    headers: {
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
      // Chrome will not open its PDF viewer in a sandboxed response, so PDFs get every restriction except the sandbox.
      'Content-Security-Policy': `${meta.mime === 'application/pdf' && inline ? '' : 'sandbox; '}default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'`,
      'Cache-Control': 'private, max-age=3600',
    },
  };
}

export function registerResourceRoutes(route, ctx, { access, files }) {
  const { db } = ctx;
  const data = () => db.data;
  const save = () => db.save();
  const view = (r) => ({ ...r, file: fileInfo(data().files.find((f) => f.id === r.fileId)) });
  const find = (id) => data().resources.find((r) => r.id === id) || fail('Resource not found.', 404);

  route('GET', '/api/classes/:id/resources', 'portal', ({ user, params }) => {
    const a = access(user, params.id);
    return data().resources.filter((r) => r.sectionId === a.section.id && (a.teacher || r.published)).sort((x, y) => x.order - y.order).map(view);
  }, { module: 'resources' });

  route('POST', '/api/classes/:id/resources', 'teacher', ({ user, params, body }) => {
    const a = access(user, params.id);
    const r = {
      id: randomUUID(), sectionId: a.section.id, title: text(body.title, 200), description: text(body.description, 2000),
      published: body.published !== false, createdAt: new Date().toISOString(), createdBy: user.name,
      order: Math.max(0, ...data().resources.filter((x) => x.sectionId === a.section.id).map((x) => x.order)) + 1,
    };
    if (body.url) {
      r.kind = 'link';
      r.url = text(body.url, 1000);
      if (!/^https?:\/\//i.test(r.url)) fail('Links must start with http:// or https://');
      r.category = /youtu\.?be|vimeo/.test(r.url) ? 'video' : 'link';
      r.title ||= r.url.replace(/^https?:\/\//, '').slice(0, 80);
    } else {
      const f = files.save(body.file, { sectionId: a.section.id, owner: user });
      r.kind = 'file';
      r.fileId = f.id;
      r.category = f.category;
      r.title ||= f.name;
    }
    data().resources.push(r);
    save();
    return view(r);
  }, { module: 'resources' });

  route('PUT', '/api/resources/:id', 'teacher', ({ user, params, body }) => {
    const r = find(params.id);
    access(user, r.sectionId);
    if ('title' in body) r.title = text(body.title, 200) || r.title;
    if ('description' in body) r.description = text(body.description, 2000);
    if ('published' in body) r.published = Boolean(body.published);
    if (body.move === 'up' || body.move === 'down') {
      const list = data().resources.filter((x) => x.sectionId === r.sectionId).sort((x, y) => x.order - y.order);
      const i = list.indexOf(r);
      const other = list[body.move === 'up' ? i - 1 : i + 1];
      if (other) [r.order, other.order] = [other.order, r.order];
    }
    save();
    return view(r);
  }, { module: 'resources' });

  route('DELETE', '/api/resources/:id', 'teacher', ({ user, params }) => {
    const r = find(params.id);
    access(user, r.sectionId);
    data().resources.splice(data().resources.indexOf(r), 1);
    if (r.fileId) files.remove(r.fileId);
    save();
    return { ok: true };
  }, { module: 'resources' });

  // Any file belonging to a class: its teacher and students may open it.
  route('GET', '/api/files/:id', 'portal', ({ user, params, query }) => {
    const meta = data().files.find((f) => f.id === params.id) || fail('File not found.', 404);
    if (!meta.sectionId) fail('File not found.', 404);
    access(user, meta.sectionId);
    // Students only see their own handed-in files, not classmates'.
    if (user.role === 'student' && meta.private && meta.ownerId !== user.id) fail('File not found.', 404);
    return fileResponse(files.read(meta.id), query.download === '1');
  });
}
