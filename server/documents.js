// Document Management (MOD-08, 0.67): folders, documents with versions, check-out, sharing inside the
// company and by link outside it, and the Document control panel. The plan and the references it is
// based on are in docs/DOCUMENTS-PLAN.md; the engine (file types, encryption, access, link secrets,
// settings) is in server/dms/ and is the same in ATLAS.
//
// Files never sit in db.json: each version is a blob in data/documents, encrypted with its own key
// (server/dms/blobs.js). The search text of each version is kept in an encrypted index blob too, so the
// data file holds no document content at all. Every refusal of access answers 404, as if the item did
// not exist.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { HttpError } from './util.js';
import { noAudit } from './audit.js';
import { can } from '../shared/roles.js';
import { notify } from './notifications.js';
import { checkFile, FAMILIES, FAMILY, BLOCKED_EXTS, BLOCKED_LABEL, isInline } from './dms/types.js';
import { createBlobStore, BlobError } from './dms/blobs.js';
import { accessTo, atLeast, chain, RANK } from './dms/access.js';
import { cleanSettings, CLASSIFICATIONS, CLASS_IDS, LEVELS, LINK_MODES, MAX_UPLOAD_MB, DEFAULT_SETTINGS } from './dms/policy.js';
import { newToken, tokenHash, looksLikeToken, hashLinkPassword, checkLinkPassword, unlockValue, checkUnlock, cookieName } from './dms/links.js';

const MB = 1024 * 1024;
export const DOCS_CHUNK_BYTES = 4 * MB;
const UPLOAD_IDLE_MS = 30 * 60000;
const EVENTS_KEPT = 20000;
const REFUSED_KEPT = 300;
const TEXT_KEPT = 60 * 1024; // characters of search text kept per document
const NOT_FOUND = 'That document or folder is not there, or you do not have access to it.';
const bad = (msg) => new HttpError(400, msg);
const missing = () => new HttpError(404, NOT_FOUND);
const text = (v, max) => (v == null || typeof v === 'object' ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const longText = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const disposition = (kind, name) => `${kind}; filename="${String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
const fileHeaders = (v, inline) => ({
  'Content-Type': v.mime, 'Content-Disposition': disposition(inline ? 'inline' : 'attachment', v.name),
  'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff',
  'X-Download-Options': 'noopen', 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'same-origin',
});
const parseCookies = (h = '') => Object.fromEntries(String(h).split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

// extractText(buffer, ext) → string: the words of a file for search (the app supplies it; CORE reads
// PDFs and Office files with server/pdf, ATLAS plain text only).
export function registerDocuments(route, db, { secrets, audit, limits, extractText = () => '', clock = () => Date.now(), departmentOf = () => '' } = {}) {
  const dir = path.join(db.dir, 'documents');
  const blobs = createBlobStore(dir, secrets.derive('documents.master-key'));
  const cookieKey = secrets.derive('documents.link-cookie');
  const D = db.data;
  for (const k of ['docFolders', 'documents', 'docLinks', 'docEvents', 'docRefused']) if (!Array.isArray(D[k])) D[k] = [];
  const settings = () => cleanSettings(D.docSettings || {});
  const now = () => new Date(clock()).toISOString();
  const userById = (id) => D.users.find((u) => u.id === id) || null;
  const nameOf = (id) => (id?.startsWith?.('link:') ? 'Someone with a link' : userById(id)?.name || 'Former user');
  const who = (u) => ({ id: u.id, role: u.role, department: departmentOf(u) || '', manager: can(u.role, 'docs.manage') });
  const folderMap = () => new Map(D.docFolders.map((f) => [f.id, f]));
  const docById = (id) => D.documents.find((d) => d.id === id) || null;
  const folderById = (id) => D.docFolders.find((f) => f.id === id) || null;
  const current = (d) => d.versions.find((v) => v.no === d.currentVersion) || d.versions[d.versions.length - 1];

  // ----- The search index: encrypted, kept as one blob, loaded once -----
  let index = null;
  const loadIndex = () => {
    if (index) return index;
    index = new Map();
    try {
      if (D.docIndexBlob && blobs.exists(D.docIndexBlob)) for (const [k, v] of JSON.parse(blobs.get(D.docIndexBlob).toString('utf8'))) index.set(k, v);
    } catch { /* rebuilt as documents change */ }
    return index;
  };
  let indexTimer = null;
  const saveIndex = () => {
    clearTimeout(indexTimer);
    indexTimer = setTimeout(() => {
      const old = D.docIndexBlob;
      D.docIndexBlob = blobs.put(Buffer.from(JSON.stringify([...loadIndex()]), 'utf8')).blobId;
      db.save();
      if (old) blobs.remove(old);
    }, 1500);
    indexTimer.unref?.();
  };

  // ----- Events: the document's activity, and the company audit log -----
  function event(action, { doc = null, folder = null, link = null, by, ip = '', note = '', label = '' }) {
    D.docEvents.push({ at: now(), action, docId: doc?.id || null, folderId: folder?.id || null, linkId: link?.id || null, by: by || null, ip: ip || '', note: note || '' });
    if (D.docEvents.length > EVENTS_KEPT) D.docEvents.splice(0, D.docEvents.length - EVENTS_KEPT);
    audit?.record(`documents.${action}`, { entity: doc ? 'document' : folder ? 'folder' : 'link', entityId: doc?.id || folder?.id || link?.id || '', label: label || (doc ? `${doc.number} ${doc.title}` : folder ? folder.name : 'Link'), note });
  }

  // ----- Access -----
  const ctx = () => ({ folders: folderMap(), now: clock() });
  function accessOf(u, item, kind) {
    const a = accessTo(who(u), item, { ...ctx(), kind });
    // Restricted documents: only managers of the document download them.
    if (kind === 'document' && item.classification === 'restricted' && a.level !== 'manage') a.download = false;
    return a;
  }
  const inTrash = (item, kind) => {
    if (item.trashedAt) return true;
    const start = kind === 'document' ? item.folderId : item.parentId;
    return chain(folderMap(), start).some((f) => f.trashedAt);
  };
  // The document or folder when `u` holds at least `level` on it; 404 otherwise (or while in trash,
  // unless `trash` is asked for).
  function needDoc(u, id, level = 'view', { trash = false } = {}) {
    const d = docById(String(id || ''));
    if (!d) throw missing();
    const a = accessOf(u, d, 'document');
    if (!atLeast(a.level, level) || (!trash && inTrash(d, 'document'))) throw missing();
    return { d, a };
  }
  function needFolder(u, id, level = 'view', { trash = false } = {}) {
    const f = folderById(String(id || ''));
    if (!f) throw missing();
    const a = accessOf(u, f, 'folder');
    if (!atLeast(a.level, level) || (!trash && inTrash(f, 'folder'))) throw missing();
    return { f, a };
  }
  // Everyone's own folder, made the first time it is needed.
  function personalRoot(u) {
    let f = D.docFolders.find((x) => x.kind === 'personal' && x.ownerId === u.id && !x.parentId);
    if (!f) {
      f = { id: randomUUID(), parentId: null, name: 'My files', kind: 'personal', ownerId: u.id, acl: [], inherit: true, createdAt: now(), createdBy: u.id, trashedAt: null, legalHold: false };
      D.docFolders.push(f);
      db.save();
    }
    return f;
  }
  const isPersonal = (f) => chain(folderMap(), f.id).some((x) => x.kind === 'personal');

  // ----- What the browser sees -----
  const versionOut = (v) => ({ no: v.no, name: v.name, ext: v.ext, family: v.family, size: v.size, sha256: v.sha256, by: v.by, byName: nameOf(v.by), at: v.at, note: v.note || '' });
  function docOut(u, d, a = accessOf(u, d, 'document'), { full = false } = {}) {
    const v = current(d);
    const out = {
      id: d.id, number: d.number, title: d.title, folderId: d.folderId, tags: d.tags || [], classification: d.classification, status: d.status,
      ownerId: d.ownerId, ownerName: nameOf(d.ownerId), name: v?.name, ext: v?.ext, family: v?.family, size: v?.size, version: d.currentVersion,
      versions: d.versions.length, updatedAt: d.updatedAt, createdAt: d.createdAt, checkout: d.checkout && Date.parse(d.checkout.until) > clock() ? { ...d.checkout, name: nameOf(d.checkout.userId) } : null,
      legalHold: Boolean(d.legalHold), trashedAt: d.trashedAt || null, reviewed: d.reviewed !== false, source: d.source || 'upload',
      level: a.level, canDownload: a.download, canShare: a.share && a.level !== 'none', inline: Boolean(v && isInline(v.ext)),
    };
    // For the people who manage it: whether it is shared, and with how many working links (list badges).
    if (a.level === 'manage') out.sharing = { grants: (d.acl || []).length, links: D.docLinks.filter((l) => !l.revokedAt && l.target.kind === 'document' && l.target.id === d.id && linkState(l).state === 'active').length };
    if (full) {
      out.description = d.description || '';
      // Who sent a file in through an upload link (as they typed it), for the "Received" notice.
      if (d.source === 'link-upload') out.sender = { name: d.sender?.name || '', email: d.sender?.email || '' };
      out.versionList = [...d.versions].reverse().map(versionOut);
      out.path = pathOf(u, d.folderId);
      if (a.level === 'manage') {
        out.acl = (d.acl || []).map(grantOut);
        out.links = D.docLinks.filter((l) => l.target.kind === 'document' && l.target.id === d.id && !l.revokedAt).map(linkOut);
      }
      out.events = D.docEvents.filter((e) => e.docId === d.id).slice(-60).reverse().map((e) => ({ ...e, byName: nameOf(e.by), ip: a.level === 'manage' ? e.ip : '' }));
    }
    return out;
  }
  const grantOut = (g) => ({ type: g.type, id: g.id, level: g.level, download: g.download !== false, share: Boolean(g.share), until: g.until || null, label: grantLabel(g) });
  function grantLabel(g) {
    if (g.type === 'everyone') return 'Everyone signed in';
    if (g.type === 'user') return userById(g.id)?.name || 'Former user';
    if (g.type === 'role') return `${g.id} (account type)`;
    return `${g.id} (department)`;
  }
  function folderOut(u, f, a = accessOf(u, f, 'folder')) {
    const out = { id: f.id, name: f.name, parentId: f.parentId, kind: f.kind, ownerId: f.ownerId, ownerName: nameOf(f.ownerId), inherit: f.inherit !== false, level: a.level, canShare: a.share, trashedAt: f.trashedAt || null, legalHold: Boolean(f.legalHold), personal: isPersonal(f) };
    if (a.level === 'manage') {
      out.acl = (f.acl || []).map(grantOut);
      out.links = D.docLinks.filter((l) => l.target.kind === 'folder' && l.target.id === f.id && !l.revokedAt).map(linkOut);
    }
    return out;
  }
  function pathOf(u, folderId) {
    const out = [];
    for (const f of chain(folderMap(), folderId)) {
      if (!atLeast(accessOf(u, f, 'folder').level, 'view')) break;
      out.unshift({ id: f.id, name: f.name });
    }
    return out;
  }
  function linkOut(l) {
    const t = l.target.kind === 'document' ? docById(l.target.id) : folderById(l.target.id);
    return {
      id: l.id, hint: l.hint, mode: l.mode, target: { kind: l.target.kind, id: l.target.id, name: t ? (l.target.kind === 'document' ? t.title : t.name) : '(removed)' },
      hasPassword: Boolean(l.passwordHash), expiresAt: l.expiresAt, maxDownloads: l.maxDownloads || 0, downloads: l.downloads || 0, views: l.views || 0, uploads: l.uploads || 0,
      note: l.note || '', createdBy: l.createdBy, createdByName: nameOf(l.createdBy), createdAt: l.createdAt, lastAccessAt: l.lastAccessAt || null, state: linkState(l).state,
    };
  }

  // ----- Meta: what the page needs to know -----
  const usedBy = (userId) => {
    let n = 0;
    for (const d of D.documents) if (d.ownerId === userId) for (const v of d.versions) n += v.size;
    return n;
  };
  route('GET', '/api/docs/meta', 'auth', ({ user: u }) => {
    noAudit();
    const s = settings();
    const root = personalRoot(u);
    const departments = [...new Set(D.employees.map((e) => e.department).filter(Boolean))].sort();
    return {
      personalRoot: root.id, manager: can(u.role, 'docs.manage'),
      families: FAMILIES.filter((f) => s.families.includes(f.id)).map((f) => ({ id: f.id, label: f.label, exts: f.exts })),
      maxUploadMB: s.maxUploadMB, quotaMB: s.quotaMB, usedBytes: usedBy(u.id), chunkBytes: DOCS_CHUNK_BYTES, trashDays: s.trashDays, checkoutHours: s.checkoutHours,
      classifications: CLASSIFICATIONS, levels: LEVELS,
      sharing: { internal: s.internalSharing, everyone: s.shareWithEveryone, links: s.links && (s.linkCreators === 'all' || can(u.role, 'docs.manage')), uploadLinks: s.uploadLinks,
        passwordRequired: s.linkPasswordRequired, passwordMin: s.linkPasswordMin, defaultDays: s.linkDefaultDays, maxDays: s.linkMaxDays, maxDownloads: s.linkMaxDownloads, classifications: s.linkClassifications },
      people: D.users.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, role: x.role })).sort((a, b) => a.name.localeCompare(b.name)),
      departments,
    };
  });

  // ----- Folders -----
  // The folders a person can see: their own tree, and every folder they can view (a folder shared with
  // them shows at the top level when its parent is not visible to them).
  route('GET', '/api/docs/folders', 'auth', ({ user: u }) => {
    noAudit();
    personalRoot(u);
    const out = [];
    for (const f of D.docFolders) {
      if (f.trashedAt || inTrash(f, 'folder')) continue;
      const a = accessOf(u, f, 'folder');
      if (!atLeast(a.level, 'view')) continue;
      // Other people's personal folders appear only when shared with this person.
      out.push(folderOut(u, f, a));
    }
    const visible = new Set(out.map((f) => f.id));
    for (const f of out) if (f.parentId && !visible.has(f.parentId)) f.sharedRoot = true;
    return { folders: out };
  });
  route('POST', '/api/docs/folders', 'auth', ({ body, user: u }) => {
    noAudit();
    const name = text(body?.name, 120).replace(/[\\/]/g, '-');
    if (!name) throw bad('Name the folder.');
    let parentId = body?.parentId ? String(body.parentId) : null;
    if (parentId) needFolder(u, parentId, 'edit');
    else if (!can(u.role, 'docs.manage')) throw bad('Only document managers add folders at the top level. Add it inside a folder you can edit, or in My files.');
    if (D.docFolders.some((f) => f.parentId === parentId && !f.trashedAt && f.name.toLowerCase() === name.toLowerCase())) throw bad(`There is already a folder called “${name}” here.`);
    const f = { id: randomUUID(), parentId, name, kind: 'shared', ownerId: u.id, acl: [], inherit: true, createdAt: now(), createdBy: u.id, trashedAt: null, legalHold: false };
    D.docFolders.push(f);
    event('folder-create', { folder: f, by: u.id });
    db.save();
    return folderOut(u, f);
  });
  route('PATCH', '/api/docs/folders/:id', 'auth', ({ params, body, user: u }) => {
    noAudit();
    const { f } = needFolder(u, params.id, 'manage');
    if ('name' in (body || {})) {
      const name = text(body.name, 120).replace(/[\\/]/g, '-');
      if (!name) throw bad('Name the folder.');
      if (f.kind === 'personal' && !f.parentId) throw bad('My files keeps its name.');
      f.name = name;
    }
    if ('parentId' in (body || {})) moveFolder(u, f, body.parentId ? String(body.parentId) : null);
    if (typeof body?.legalHold === 'boolean') {
      if (!can(u.role, 'docs.manage')) throw bad('Only document managers place or lift a legal hold.');
      f.legalHold = body.legalHold;
      event(body.legalHold ? 'hold' : 'unhold', { folder: f, by: u.id });
    }
    event('folder-change', { folder: f, by: u.id });
    db.save();
    return folderOut(u, f);
  });
  function moveFolder(u, f, parentId) {
    if (f.kind === 'personal' && !f.parentId) throw bad('My files cannot be moved.');
    if (parentId) {
      needFolder(u, parentId, 'edit');
      if (chain(folderMap(), parentId).some((x) => x.id === f.id)) throw bad('A folder cannot go inside itself.');
    } else if (!can(u.role, 'docs.manage')) throw bad('Only document managers keep folders at the top level.');
    f.parentId = parentId;
  }
  route('PUT', '/api/docs/folders/:id/access', 'auth', ({ params, body, user: u }) => {
    noAudit();
    const { f, a } = needFolder(u, params.id, 'manage');
    if (isPersonal(f) && !f.parentId) throw bad('My files is yours only. Share a folder inside it, or a document.');
    f.acl = cleanGrants(u, body?.grants, a);
    if (typeof body?.inherit === 'boolean') f.inherit = body.inherit;
    event('access', { folder: f, by: u.id, note: summary(f.acl) });
    db.save();
    return folderOut(u, f);
  });

  // ----- Listing and search -----
  // view: 'folder' (with folder), 'shared' (shared with me), 'recent', 'mine', 'received' (by upload
  // links, not reviewed), 'trash'. q: words in the title, name, tags, number or content.
  route('GET', '/api/docs/list', 'auth', ({ query, user: u }) => {
    noAudit();
    const view = ['folder', 'shared', 'recent', 'mine', 'received', 'trash', 'search'].includes(query.view) ? query.view : 'folder';
    const q = text(query.q, 120).toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const cls = CLASS_IDS.includes(query.classification) ? query.classification : null;
    const tag = text(query.tag, 40).toLowerCase();
    let folderId = null;
    let folders = [];
    let level = null;
    let pathOut = [];
    if (view === 'folder') {
      const { f, a } = needFolder(u, query.folder || personalRoot(u).id);
      folderId = f.id;
      level = a.level;
      pathOut = pathOf(u, f.id);
      folders = D.docFolders.filter((x) => x.parentId === f.id && !x.trashedAt).map((x) => [x, accessOf(u, x, 'folder')]).filter(([, xa]) => atLeast(xa.level, 'view')).map(([x, xa]) => folderOut(u, x, xa));
    }
    const idx = words.length ? loadIndex() : null;
    const out = [];
    for (const d of D.documents) {
      if (view === 'trash' ? !d.trashedAt : inTrash(d, 'document')) continue;
      if (view === 'folder' && d.folderId !== folderId) continue;
      const a = accessOf(u, d, 'document');
      if (!atLeast(a.level, 'view')) continue;
      if (view === 'trash' && a.level !== 'manage') continue;
      if (view === 'mine' && d.ownerId !== u.id) continue;
      if (view === 'received' && (d.reviewed !== false || a.level !== 'manage')) continue;
      if (view === 'shared') {
        if (d.ownerId === u.id) continue;
        if (chain(folderMap(), d.folderId).some((f) => f.ownerId === u.id && f.kind === 'personal')) continue;
      }
      if (cls && d.classification !== cls) continue;
      if (tag && !(d.tags || []).some((t) => t.toLowerCase() === tag)) continue;
      if (words.length) {
        const v = current(d);
        const hay = `${d.number} ${d.title} ${v?.name || ''} ${(d.tags || []).join(' ')} ${d.description || ''} ${idx.get(d.id) || ''}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
      }
      out.push(docOut(u, d, a));
    }
    out.sort(view === 'recent' ? (a, b) => b.updatedAt.localeCompare(a.updatedAt) : (a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
    if (view === 'trash') folders = D.docFolders.filter((f) => f.trashedAt).map((f) => [f, accessOf(u, f, 'folder')]).filter(([, a]) => a.level === 'manage').map(([f, a]) => folderOut(u, f, a));
    return { view, folderId, level, path: pathOut, folders, documents: view === 'recent' ? out.slice(0, 50) : out.slice(0, 2000) };
  });

  // ----- Uploads in pieces (as PDF Studio): start, pieces, finish -----
  const uploads = new Map();
  const upDir = path.join(dir, 'uploads');
  const dropUpload = (x) => {
    uploads.delete(x.id);
    fs.rmSync(x.path, { force: true });
  };
  function startUpload(owner, name, size) {
    const s = settings();
    if (!Number.isInteger(size) || size <= 0) throw bad(`${name} is empty.`);
    if (size > s.maxUploadMB * MB) throw bad(`${name} is larger than ${s.maxUploadMB} MB, the most accepted here.`);
    if ([...uploads.values()].filter((x) => x.owner === owner).length >= 8) throw bad('Wait for the files being uploaded to finish, then add more.');
    const x = { id: randomUUID(), owner, name, size, received: 0, usedAt: clock() };
    x.path = path.join(upDir, `${x.id}.part`);
    fs.mkdirSync(upDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(x.path, Buffer.alloc(0), { mode: 0o600 });
    uploads.set(x.id, x);
    return { id: x.id, chunkBytes: DOCS_CHUNK_BYTES };
  }
  function putPiece(owner, id, body) {
    const x = uploads.get(String(id || ''));
    if (!x || x.owner !== owner) throw new HttpError(404, 'That upload is no longer on the server. Add the file again.');
    x.usedAt = clock();
    const offset = Number(body?.offset);
    if (typeof body?.data !== 'string' || !Number.isInteger(offset) || offset < 0) throw bad('Send a piece of the file.');
    const piece = Buffer.from(body.data, 'base64');
    if (!piece.length || piece.length > DOCS_CHUNK_BYTES) throw bad('Send the file in pieces of up to 4 MB.');
    if (offset + piece.length <= x.received) return { received: x.received };
    if (offset !== x.received) throw new HttpError(409, `The upload of ${x.name} lost its place. Add the file again.`);
    if (x.received + piece.length > x.size) throw bad(`${x.name} is larger than it said it was.`);
    fs.appendFileSync(x.path, piece);
    x.received += piece.length;
    return { received: x.received };
  }
  function takeUpload(owner, id) {
    const x = uploads.get(String(id || ''));
    if (!x || x.owner !== owner) throw new HttpError(404, 'That upload is no longer on the server. Add the file again.');
    if (x.received !== x.size) throw bad(`${x.name} did not arrive whole. Add it again.`);
    const buf = fs.readFileSync(x.path);
    dropUpload(x);
    return { name: x.name, buf };
  }
  // A file is checked before anything is kept: its kind from its bytes against the control panel, and
  // the uploader's room. Refusals are logged for the control panel.
  function vet(buf, name, byId, ownerId) {
    const s = settings();
    if (buf.length > s.maxUploadMB * MB) refuse(name, byId, 'size', `${name} is larger than ${s.maxUploadMB} MB, the most accepted here.`);
    const c = checkFile(buf, name, s.families);
    if (!c.ok) refuse(name, byId, c.code, c.reason);
    if (s.quotaMB && usedBy(ownerId) + buf.length > s.quotaMB * MB) refuse(name, byId, 'quota', `This would go over the ${s.quotaMB} MB of documents each person may keep. Remove old versions or documents, or ask an administrator.`);
    return c;
  }
  function refuse(name, byId, code, reason) {
    D.docRefused.push({ at: now(), name: text(name, 200), by: byId, code, reason });
    if (D.docRefused.length > REFUSED_KEPT) D.docRefused.splice(0, D.docRefused.length - REFUSED_KEPT);
    audit?.record('documents.refused', { entity: 'document', label: text(name, 120), note: reason });
    db.save();
    throw bad(reason);
  }
  function addVersion(d, buf, c, byId, note) {
    const { blobId, sha256, size } = blobs.put(buf);
    const no = (d.versions.reduce((n, v) => Math.max(n, v.no), 0) || 0) + 1;
    d.versions.push({ no, blobId, name: c.name, ext: c.ext, family: c.family, mime: c.mime, size, sha256, by: byId, at: now(), note: text(note, 300) });
    d.currentVersion = no;
    d.updatedAt = now();
    // Old versions beyond what the control panel keeps go (not while on legal hold).
    const keep = settings().versionsKept;
    if (!d.legalHold) while (d.versions.length > keep) blobs.remove(d.versions.shift().blobId);
    const words = extractSafely(buf, c.ext);
    const idx = loadIndex();
    if (words) idx.set(d.id, words.slice(0, TEXT_KEPT));
    else idx.delete(d.id);
    saveIndex();
    return sha256;
  }
  function extractSafely(buf, ext) {
    try {
      return String(extractText(buf, ext) || '').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }
  function nextNumber() {
    const year = new Date(clock()).getFullYear();
    D.docSeq = D.docSeq && D.docSeq.year === year ? { year, n: D.docSeq.n + 1 } : { year, n: 1 };
    return `DOC-${year}-${String(D.docSeq.n).padStart(4, '0')}`;
  }
  const duplicateIn = (folderId, sha, exceptId = null) => D.documents.find((d) => d.id !== exceptId && d.folderId === folderId && !d.trashedAt && d.versions.some((v) => v.sha256 === sha));

  route('POST', '/api/docs/uploads', 'auth', ({ body, user: u }) => {
    noAudit();
    return startUpload(u.id, text(body?.name, 200) || 'file', Number(body?.size));
  });
  route('PUT', '/api/docs/uploads/:id', 'auth', ({ params, body, user: u }) => {
    noAudit();
    return putPiece(u.id, params.id, body);
  });
  // finish { folderId, title, classification, tags, description, note } → a new document; with
  // documentId → a new version of it (edit access; not while someone else has it checked out).
  route('POST', '/api/docs/uploads/:id/finish', 'auth', ({ params, body, user: u, ip }) => {
    noAudit();
    const { name, buf } = takeUpload(u.id, params.id);
    if (body?.documentId) {
      const { d } = needDoc(u, body.documentId, 'edit');
      const co = d.checkout && Date.parse(d.checkout.until) > clock() ? d.checkout : null;
      if (co && co.userId !== u.id) throw bad(`${nameOf(co.userId)} has this document checked out until ${new Date(co.until).toLocaleString('en-PH')}. Ask them to check it in.`);
      const c = vet(buf, name, u.id, d.ownerId);
      const cur = current(d);
      if (cur && c.family !== cur.family) refuse(name, u.id, 'mismatch', `A new version must be the same kind of file as the document (${FAMILY[cur.family].label}).`);
      const sha = addVersion(d, buf, c, u.id, body.note);
      if (body.checkin && co) d.checkout = null;
      event('version', { doc: d, by: u.id, ip, note: `Version ${d.currentVersion}: ${c.name}` });
      db.save();
      return { document: docOut(u, d), duplicate: duplicateIn(d.folderId, sha, d.id)?.number || null };
    }
    const { f } = needFolder(u, body?.folderId || personalRoot(u).id, 'edit');
    const c = vet(buf, name, u.id, u.id);
    const s = settings();
    const classification = CLASS_IDS.includes(body?.classification) ? body.classification : 'internal';
    const d = {
      id: randomUUID(), number: nextNumber(), folderId: f.id, title: text(body?.title, 200) || c.name.replace(/\.[^.]+$/, ''), description: longText(body?.description, 4000),
      tags: cleanTags(body?.tags), classification, status: 'draft', ownerId: u.id, versions: [], currentVersion: 0, checkout: null, acl: [],
      legalHold: false, retainUntil: null, source: 'upload', reviewed: true, createdAt: now(), updatedAt: now(), trashedAt: null, trashedBy: null,
    };
    // Same content already in this folder: refused or flagged, as the control panel says.
    const dup = duplicateIn(f.id, createHash('sha256').update(buf).digest('hex'));
    if (dup && s.duplicates === 'refuse') refuse(name, u.id, 'duplicate', `This file is already in this folder as ${dup.number} “${dup.title}”.`);
    addVersion(d, buf, c, u.id, body?.note || 'First version');
    D.documents.push(d);
    event('upload', { doc: d, by: u.id, ip, note: `${c.name} (${Math.max(1, Math.round(buf.length / 1024))} KB) into ${f.name}` });
    db.save();
    return { document: docOut(u, d), duplicate: dup ? dup.number : null };
  });
  route('DELETE', '/api/docs/uploads/:id', 'auth', ({ params, user: u }) => {
    noAudit();
    const x = uploads.get(String(params.id || ''));
    if (x && x.owner === u.id) dropUpload(x);
    return { ok: true };
  });

  // ----- One document -----
  route('GET', '/api/docs/documents/:id', 'auth', ({ params, user: u }) => {
    noAudit();
    const { d, a } = needDoc(u, params.id, 'view', { trash: true });
    if (d.trashedAt && a.level !== 'manage') throw missing();
    return docOut(u, d, a, { full: true });
  });
  route('PATCH', '/api/docs/documents/:id', 'auth', ({ params, body, user: u }) => {
    noAudit();
    const { d, a } = needDoc(u, params.id, 'edit');
    const b = body || {};
    const changes = [];
    if ('title' in b) {
      const t = text(b.title, 200);
      if (!t) throw bad('Give the document a title.');
      if (t !== d.title) changes.push(`title “${t}”`);
      d.title = t;
    }
    if ('description' in b) d.description = longText(b.description, 4000);
    if ('tags' in b) d.tags = cleanTags(b.tags);
    if ('status' in b) {
      if (!['draft', 'final', 'obsolete'].includes(b.status)) throw bad('Status is draft, final or obsolete.');
      if (b.status !== d.status) changes.push(`status ${b.status}`);
      d.status = b.status;
    }
    if ('classification' in b) {
      if (!CLASS_IDS.includes(b.classification)) throw bad('Choose a classification.');
      if (a.level !== 'manage') throw bad('Only people who manage the document change its classification.');
      if (b.classification !== d.classification) changes.push(`classification ${b.classification}`);
      d.classification = b.classification;
    }
    if ('folderId' in b && b.folderId !== d.folderId) {
      if (a.level !== 'manage') throw bad('Only people who manage the document move it.');
      const { f } = needFolder(u, b.folderId, 'edit');
      changes.push(`moved to ${f.name}`);
      d.folderId = f.id;
    }
    if (typeof b.legalHold === 'boolean' && b.legalHold !== Boolean(d.legalHold)) {
      if (!can(u.role, 'docs.manage')) throw bad('Only document managers place or lift a legal hold.');
      d.legalHold = b.legalHold;
      event(b.legalHold ? 'hold' : 'unhold', { doc: d, by: u.id });
    }
    if (b.reviewed === true && d.reviewed === false) {
      d.reviewed = true;
      changes.push('reviewed');
    }
    d.updatedAt = now();
    if (changes.length) event('change', { doc: d, by: u.id, note: changes.join('; ') });
    db.save();
    return docOut(u, d, accessOf(u, d, 'document'), { full: true });
  });
  // The file of a version (the current one unless v= says). inline=1 opens a PDF or picture in the
  // browser; everything else always downloads.
  route('GET', '/api/docs/documents/:id/file', 'auth', ({ params, query, user: u, ip }) => {
    noAudit();
    const { d, a } = needDoc(u, params.id, 'view');
    const v = query.v ? d.versions.find((x) => x.no === Number(query.v)) : current(d);
    if (!v) throw missing();
    const inline = query.inline === '1' && isInline(v.ext);
    if (!inline && !a.download) throw new HttpError(403, d.classification === 'restricted' ? 'Restricted documents are downloaded only by the people who manage them.' : 'You can view this document but not download it.');
    if (inline && !a.download && !isInline(v.ext)) throw new HttpError(403, 'You can view this document but not download it.');
    const data = readBlob(v);
    event(inline ? 'view' : 'download', { doc: d, by: u.id, ip, note: `Version ${v.no}` });
    db.save();
    return { data, headers: fileHeaders(v, inline) };
  });
  function readBlob(v) {
    try {
      return blobs.get(v.blobId, v.sha256);
    } catch (err) {
      if (err instanceof BlobError) throw new HttpError(err.code === 'missing' ? 410 : 500, err.message);
      throw err;
    }
  }
  route('POST', '/api/docs/documents/:id/restore-version', 'auth', ({ params, body, user: u }) => {
    noAudit();
    const { d } = needDoc(u, params.id, 'edit');
    const v = d.versions.find((x) => x.no === Number(body?.no));
    if (!v) throw bad('That version is not kept any more.');
    const co = d.checkout && Date.parse(d.checkout.until) > clock() ? d.checkout : null;
    if (co && co.userId !== u.id) throw bad(`${nameOf(co.userId)} has this document checked out.`);
    const buf = readBlob(v);
    addVersion(d, buf, { name: v.name, ext: v.ext, family: v.family, mime: v.mime }, u.id, `Restored from version ${v.no}`);
    event('version', { doc: d, by: u.id, note: `Version ${d.currentVersion} restored from version ${v.no}` });
    db.save();
    return docOut(u, d, accessOf(u, d, 'document'), { full: true });
  });
  // Check-out: one person edits; others wait. It ends by itself after the control panel's hours; managers
  // can end someone else's.
  route('POST', '/api/docs/documents/:id/checkout', 'auth', ({ params, body, user: u }) => {
    noAudit();
    const { d, a } = needDoc(u, params.id, 'edit');
    const co = d.checkout && Date.parse(d.checkout.until) > clock() ? d.checkout : null;
    if (body?.release) {
      if (!co) return docOut(u, d, a, { full: true });
      if (co.userId !== u.id && a.level !== 'manage') throw bad(`${nameOf(co.userId)} has it checked out; only they or a manager of the document can check it in.`);
      d.checkout = null;
      event('checkin', { doc: d, by: u.id, note: co.userId !== u.id ? `Checked in for ${nameOf(co.userId)}` : '' });
    } else {
      if (co && co.userId !== u.id) throw bad(`${nameOf(co.userId)} already has it checked out.`);
      d.checkout = { userId: u.id, at: now(), until: new Date(clock() + settings().checkoutHours * 3600000).toISOString() };
      event('checkout', { doc: d, by: u.id });
    }
    db.save();
    return docOut(u, d, a, { full: true });
  });
  route('PUT', '/api/docs/documents/:id/access', 'auth', ({ params, body, user: u }) => {
    noAudit();
    const { d, a } = needDoc(u, params.id, 'manage');
    d.acl = cleanGrants(u, body?.grants, a, d.classification);
    event('access', { doc: d, by: u.id, note: summary(d.acl) });
    db.save();
    return docOut(u, d, a, { full: true });
  });

  // ----- Trash, restore, purge -----
  const held = (item, kind) => item.legalHold || chain(folderMap(), kind === 'document' ? item.folderId : item.id).some((f) => f.legalHold);
  route('DELETE', '/api/docs/documents/:id', 'auth', ({ params, user: u }) => {
    noAudit();
    const { d } = needDoc(u, params.id, 'manage');
    if (held(d, 'document')) throw bad('This document is on legal hold, so it cannot be deleted.');
    d.trashedAt = now();
    d.trashedBy = u.id;
    event('trash', { doc: d, by: u.id });
    db.save();
    return { ok: true };
  });
  route('DELETE', '/api/docs/folders/:id', 'auth', ({ params, user: u }) => {
    noAudit();
    const { f } = needFolder(u, params.id, 'manage');
    if (f.kind === 'personal' && !f.parentId) throw bad('My files cannot be deleted.');
    if (held(f, 'folder') || D.documents.some((d) => !d.trashedAt && d.legalHold && chain(folderMap(), d.folderId).some((x) => x.id === f.id))) throw bad('This folder or a document in it is on legal hold, so it cannot be deleted.');
    f.trashedAt = now();
    f.trashedBy = u.id;
    event('trash', { folder: f, by: u.id });
    db.save();
    return { ok: true };
  });
  route('POST', '/api/docs/restore', 'auth', ({ body, user: u }) => {
    noAudit();
    if (body?.documentId) {
      const { d } = needDoc(u, body.documentId, 'manage', { trash: true });
      if (!d.trashedAt) return { ok: true };
      // Back where it was, or into My files when that folder is gone or in the trash.
      const parentGone = !folderById(d.folderId) || inTrash(folderById(d.folderId), 'folder');
      if (parentGone) d.folderId = personalRoot(u).id;
      d.trashedAt = null;
      d.trashedBy = null;
      event('restore', { doc: d, by: u.id });
    } else {
      const { f } = needFolder(u, body?.folderId, 'manage', { trash: true });
      f.trashedAt = null;
      f.trashedBy = null;
      if (f.parentId && (!folderById(f.parentId) || inTrash(folderById(f.parentId), 'folder'))) f.parentId = personalRoot(u).id;
      event('restore', { folder: f, by: u.id });
    }
    db.save();
    return { ok: true };
  });
  function purgeDoc(d, byId) {
    for (const v of d.versions) blobs.remove(v.blobId);
    loadIndex().delete(d.id);
    saveIndex();
    for (const l of D.docLinks) if (l.target.kind === 'document' && l.target.id === d.id && !l.revokedAt) (l.revokedAt = now()), (l.revokedBy = byId);
    D.documents = D.documents.filter((x) => x.id !== d.id);
    event('purge', { doc: d, by: byId, note: `${d.versions.length} version(s) removed` });
  }
  route('DELETE', '/api/docs/documents/:id/purge', 'auth', ({ params, user: u }) => {
    noAudit();
    const { d } = needDoc(u, params.id, 'manage', { trash: true });
    if (!d.trashedAt) throw bad('Move the document to the trash first.');
    if (held(d, 'document')) throw bad('This document is on legal hold.');
    purgeDoc(d, u.id);
    db.save();
    return { ok: true };
  });

  // ----- Grants -----
  function cleanGrants(u, list, a, classification = null) {
    const s = settings();
    if (!s.internalSharing && !can(u.role, 'docs.manage')) throw bad('Sharing inside the company is turned off. Ask an administrator.');
    if (!Array.isArray(list)) throw bad('Send the list of people and groups.');
    if (list.length > 200) throw bad('A document or folder can be shared with up to 200 people and groups.');
    const users = new Set(D.users.map((x) => x.id));
    const departments = new Set(D.employees.map((e) => e.department).filter(Boolean));
    const out = [];
    for (const g of list) {
      const type = ['user', 'role', 'department', 'everyone'].includes(g?.type) ? g.type : null;
      if (!type) throw bad('Share with a person, an account type, a department or everyone.');
      if (type === 'everyone' && !s.shareWithEveryone) throw bad('Sharing with everyone is turned off in Document control.');
      if (type === 'everyone' && classification === 'restricted') throw bad('Restricted documents are shared with named people only.');
      const id = type === 'everyone' ? '*' : text(g.id, 80);
      if (type === 'user' && !users.has(id)) throw bad('That person is not in CORE.');
      if (type === 'department' && !departments.has(id)) throw bad(`There is no department called “${id}”.`);
      if (type === 'role' && !id) throw bad('Choose an account type.');
      const level = LEVELS.includes(g.level) ? g.level : 'view';
      // A grant never gives more than the giver holds.
      if (RANK[level] > RANK[a.level]) throw bad('You cannot give more access than you have.');
      const until = g.until && !Number.isNaN(Date.parse(g.until)) ? new Date(g.until).toISOString() : null;
      out.push({ type, id, level, download: g.download !== false, share: Boolean(g.share) && level !== 'manage' ? true : level === 'manage', by: u.id, at: now(), until });
    }
    return out;
  }
  const summary = (acl) => acl.map((g) => `${grantLabel(g)}: ${g.level}${g.download ? '' : ' (no download)'}`).join('; ') || 'No one besides the owner';
  const cleanTags = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((t) => text(t, 40)).filter(Boolean))].slice(0, 20);

  // ----- Links outside the company -----
  // Whether a link works now; every rule is checked again on every use (Nextcloud).
  function linkState(l) {
    const s = settings();
    if (l.revokedAt) return { state: 'revoked' };
    if (l.expiresAt && Date.parse(l.expiresAt) < clock()) return { state: 'expired' };
    if (!s.links || (l.mode === 'upload' && !s.uploadLinks)) return { state: 'off' };
    const creator = userById(l.createdBy);
    if (!creator || !creator.active) return { state: 'creator' };
    if (s.linkCreators === 'managers' && !can(creator.role, 'docs.manage')) return { state: 'creator' };
    const item = l.target.kind === 'document' ? docById(l.target.id) : folderById(l.target.id);
    if (!item || inTrash(item, l.target.kind)) return { state: 'gone' };
    const a = accessOf(creator, item, l.target.kind);
    if (!a.share || (l.mode !== 'view' && l.mode !== 'upload' && !a.download)) return { state: 'creator' };
    if (l.target.kind === 'document' && !s.linkClassifications.includes(item.classification)) return { state: 'classification' };
    if (l.maxDownloads && (l.downloads || 0) >= l.maxDownloads && l.mode === 'download') return { state: 'used' };
    return { state: 'active', item, creator };
  }
  route('POST', '/api/docs/links', 'auth', ({ body, user: u, origin }) => {
    noAudit();
    const s = settings();
    if (!s.links) throw bad('Links for people outside the company are turned off in Document control.');
    if (s.linkCreators === 'managers' && !can(u.role, 'docs.manage')) throw bad('Only document managers make links for people outside the company.');
    const kind = body?.target?.kind === 'folder' ? 'folder' : 'document';
    const mode = LINK_MODES.includes(body?.mode) ? body.mode : 'download';
    const { item, a } = kind === 'document' ? (({ d, a: x }) => ({ item: d, a: x }))(needDoc(u, body?.target?.id, 'view')) : (({ f, a: x }) => ({ item: f, a: x }))(needFolder(u, body?.target?.id, 'view'));
    if (!a.share) throw bad('You can see this but not share it. Ask the person who manages it.');
    if (mode === 'upload' && (kind !== 'folder' || !s.uploadLinks)) throw bad(kind !== 'folder' ? 'Upload links are made for folders.' : 'Upload links are turned off in Document control.');
    if (mode === 'upload' && !atLeast(a.level, 'edit')) throw bad('You need edit access to the folder to collect files into it.');
    if (mode === 'download' && !a.download) throw bad('You cannot download this, so you cannot share it for download.');
    if (kind === 'document' && !s.linkClassifications.includes(item.classification)) throw bad(item.classification === 'restricted' ? 'Restricted documents are never shared by link.' : `${item.classification[0].toUpperCase()}${item.classification.slice(1)} documents are not shared by link here (Document control).`);
    if (kind === 'folder' && isPersonal(item) && !item.parentId) throw bad('My files as a whole cannot be shared. Share a folder inside it, or a document.');
    const password = typeof body?.password === 'string' ? body.password : '';
    const needsPassword = s.linkPasswordRequired || (kind === 'document' && item.classification === 'confidential');
    if (needsPassword && !password) throw bad(s.linkPasswordRequired ? 'Links need a password (Document control).' : 'Links to confidential documents need a password.');
    if (password && password.length < s.linkPasswordMin) throw bad(`The link password needs at least ${s.linkPasswordMin} characters.`);
    const days = Number(body?.days ?? s.linkDefaultDays);
    if (!Number.isFinite(days) || days < 1 || days > s.linkMaxDays) throw bad(`A link lasts 1 to ${s.linkMaxDays} days.`);
    const token = newToken();
    const l = {
      id: randomUUID(), tokenHash: tokenHash(token), hint: token.slice(-4), target: { kind, id: item.id }, mode, passwordHash: password ? hashLinkPassword(password) : null,
      linkVersion: 1, expiresAt: new Date(clock() + Math.round(days) * 86400000).toISOString(), maxDownloads: Math.max(0, Math.min(100000, Math.round(Number(body?.maxDownloads ?? s.linkMaxDownloads) || 0))),
      downloads: 0, views: 0, uploads: 0, note: text(body?.note, 200), createdBy: u.id, createdAt: now(), revokedAt: null, revokedBy: null, lastAccessAt: null,
    };
    D.docLinks.push(l);
    event('link', { ...(kind === 'document' ? { doc: item } : { folder: item }), link: l, by: u.id, note: `${mode} link, ${Math.round(days)} days${l.passwordHash ? ', password' : ''}${l.maxDownloads ? `, ${l.maxDownloads} downloads` : ''}` });
    db.save();
    return { link: linkOut(l), url: `${origin || ''}/share/${token}` };
  });
  route('DELETE', '/api/docs/links/:id', 'auth', ({ params, user: u }) => {
    noAudit();
    const l = D.docLinks.find((x) => x.id === params.id);
    if (!l || l.revokedAt) throw missing();
    const item = l.target.kind === 'document' ? docById(l.target.id) : folderById(l.target.id);
    const a = item ? accessOf(u, item, l.target.kind) : { level: 'none' };
    if (l.createdBy !== u.id && a.level !== 'manage') throw missing();
    revoke(l, u.id);
    db.save();
    return { ok: true };
  });
  function revoke(l, byId) {
    l.revokedAt = now();
    l.revokedBy = byId;
    l.linkVersion = (l.linkVersion || 1) + 1;
    event('unlink', { link: l, by: byId, label: `Link …${l.hint}` });
  }
  route('GET', '/api/docs/links', 'auth', ({ user: u }) => {
    noAudit();
    return { links: D.docLinks.filter((l) => l.createdBy === u.id && !l.revokedAt).map(linkOut) };
  });

  // ----- The public side of a link: /share/<token> -----
  function linkFor(token) {
    if (!looksLikeToken(token)) return null;
    return D.docLinks.find((l) => l.tokenHash === tokenHash(token)) || null;
  }
  const UNAVAILABLE = 'This link is not available. It may have expired or been turned off; ask the person who sent it for a new one.';
  function openLink(token, headers, ip, { unlocked = true } = {}) {
    limits?.hit('share-access', ip || 'unknown', 'Too many requests. Wait a minute and try again.');
    const l = linkFor(token);
    const st = l ? linkState(l) : { state: 'missing' };
    if (!l || st.state !== 'active') throw new HttpError(404, UNAVAILABLE);
    const ok = !l.passwordHash || checkUnlock(cookieKey, l, parseCookies(headers?.cookie)[cookieName(l.id)]);
    if (unlocked && !ok) throw new HttpError(401, 'This link needs its password.');
    return { l, ...st, unlockedNow: ok };
  }
  const linkDocs = (l, item) => (l.target.kind === 'document' ? [item] : D.documents.filter((d) => d.folderId === item.id && !d.trashedAt && settings().linkClassifications.includes(d.classification)));
  function touch(l, field, ip, note) {
    l[field] = (l[field] || 0) + 1;
    const first = !l.lastAccessAt;
    l.lastAccessAt = now();
    D.docEvents.push({ at: now(), action: `link-${field}`, docId: l.target.kind === 'document' ? l.target.id : null, folderId: l.target.kind === 'folder' ? l.target.id : null, linkId: l.id, by: `link:${l.id}`, ip, note });
    if (first) {
      try {
        notify(db, [l.createdBy], { module: 'system', kind: 'documents.link-opened', title: 'Your document link was opened for the first time', body: note, link: l.target.kind === 'document' ? `#/documents/doc/${l.target.id}` : `#/documents/folder/${l.target.id}` });
      } catch { /* notifications are a courtesy */ }
    }
  }
  route('GET', '/api/public/share/:token', 'public', ({ params, headers, ip }) => {
    noAudit();
    const { l, item, unlockedNow } = openLink(params.token, headers, ip, { unlocked: false });
    const s = settings();
    const base = { mode: l.mode, kind: l.target.kind, needsPassword: Boolean(l.passwordHash) && !unlockedNow, expiresAt: l.expiresAt, company: D.settings?.companyName || '' };
    if (base.needsPassword) return base;
    if (l.mode === 'upload') return { ...base, folder: item.name, maxUploadMB: s.maxUploadMB, chunkBytes: DOCS_CHUNK_BYTES, families: FAMILIES.filter((f) => s.families.includes(f.id)).map((f) => ({ label: f.label, exts: f.exts })) };
    const docs = linkDocs(l, item).map((d) => {
      const v = current(d);
      return { id: d.id, title: d.title, name: v.name, ext: v.ext, size: v.size, updatedAt: d.updatedAt, inline: isInline(v.ext) };
    });
    l.views = (l.views || 0) + 1;
    touch(l, 'opens', ip, `${l.target.kind === 'document' ? item.title : item.name} opened through a link`);
    db.save();
    return { ...base, name: l.target.kind === 'document' ? item.title : item.name, note: l.note, documents: docs, downloadsLeft: l.mode === 'download' && l.maxDownloads ? l.maxDownloads - (l.downloads || 0) : null };
  });
  route('POST', '/api/public/share/:token/unlock', 'public', ({ params, body, headers, ip }) => {
    noAudit();
    const { l } = openLink(params.token, headers, ip, { unlocked: false });
    if (!l.passwordHash) return { ok: true };
    limits?.hit('share-password', `${ip}|${l.id}`, 'Too many wrong passwords. Wait a few minutes and try again.');
    if (!checkLinkPassword(body?.password, l.passwordHash)) {
      D.docEvents.push({ at: now(), action: 'link-password-wrong', linkId: l.id, by: `link:${l.id}`, ip, note: '' });
      db.save();
      throw bad('That password is not right.');
    }
    return { data: { ok: true }, headers: { 'Set-Cookie': `${cookieName(l.id)}=${unlockValue(cookieKey, l)}; Path=/api/public/share/${params.token}; HttpOnly; SameSite=Strict; Max-Age=${12 * 3600}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}` } };
  });
  route('GET', '/api/public/share/:token/file', 'public', ({ params, query, headers, ip }) => {
    noAudit();
    const { l, item } = openLink(params.token, headers, ip);
    if (l.mode === 'upload') throw new HttpError(404, UNAVAILABLE);
    const d = linkDocs(l, item).find((x) => x.id === String(query.doc || item.id));
    if (!d) throw new HttpError(404, UNAVAILABLE);
    const v = current(d);
    const inline = query.inline === '1' && isInline(v.ext);
    if (l.mode === 'view' && !inline) throw new HttpError(403, 'This link lets you view the document, not download it.');
    if (!inline && l.maxDownloads && (l.downloads || 0) >= l.maxDownloads) throw new HttpError(404, UNAVAILABLE);
    const data = readBlob(v);
    touch(l, inline ? 'views' : 'downloads', ip, `${d.number} ${d.title}, version ${v.no}`);
    audit?.record(`documents.link-${inline ? 'view' : 'download'}`, { entity: 'document', entityId: d.id, label: `${d.number} ${d.title}`, note: `Through link …${l.hint}`, actor: { name: 'Someone with a link', ip } });
    db.save();
    return { data, headers: fileHeaders(v, inline) };
  });
  // Upload links: files from outside go into the folder as "received, not reviewed", owned by the person
  // who made the link, with every check an upload from inside gets.
  route('POST', '/api/public/share/:token/uploads', 'public', ({ params, body, headers, ip }) => {
    noAudit();
    const { l } = openLink(params.token, headers, ip);
    if (l.mode !== 'upload') throw new HttpError(404, UNAVAILABLE);
    limits?.hit('share-upload', ip || 'unknown', 'Too many files sent from this network. Try again later.');
    return startUpload(`link:${l.id}`, text(body?.name, 200) || 'file', Number(body?.size));
  });
  route('PUT', '/api/public/share/:token/uploads/:id', 'public', ({ params, body, headers, ip }) => {
    noAudit();
    const { l } = openLink(params.token, headers, ip);
    return putPiece(`link:${l.id}`, params.id, body);
  });
  route('POST', '/api/public/share/:token/uploads/:id/finish', 'public', ({ params, body, headers, ip }) => {
    noAudit();
    const { l, item, creator } = openLink(params.token, headers, ip);
    if (l.mode !== 'upload') throw new HttpError(404, UNAVAILABLE);
    const { name, buf } = takeUpload(`link:${l.id}`, params.id);
    const c = vet(buf, name, `link:${l.id}`, creator.id);
    const sender = text(body?.name, 100);
    const d = {
      id: randomUUID(), number: nextNumber(), folderId: item.id, title: c.name.replace(/\.[^.]+$/, ''), description: longText(body?.message, 2000),
      tags: [], classification: 'internal', status: 'draft', ownerId: creator.id, versions: [], currentVersion: 0, checkout: null, acl: [],
      legalHold: false, retainUntil: null, source: 'link-upload', sender: { name: sender, email: text(body?.email, 160) }, reviewed: false,
      createdAt: now(), updatedAt: now(), trashedAt: null, trashedBy: null,
    };
    addVersion(d, buf, c, `link:${l.id}`, `Sent through a link${sender ? ` by ${sender}` : ''}`);
    D.documents.push(d);
    touch(l, 'uploads', ip, `${c.name}${sender ? ` from ${sender}` : ''}`);
    audit?.record('documents.link-upload', { entity: 'document', entityId: d.id, label: `${d.number} ${d.title}`, note: `Into ${item.name} through link …${l.hint}${sender ? `, from ${sender}` : ''}`, actor: { name: sender || 'Someone with a link', ip } });
    try {
      notify(db, [creator.id], { module: 'system', kind: 'documents.received', title: `A file arrived in ${item.name}`, body: `${c.name}${sender ? ` from ${sender}` : ''}. Review it before sharing it further.`, link: `#/documents/doc/${d.id}` });
    } catch { /* a courtesy */ }
    db.save();
    return { ok: true, name: c.name };
  });

  // ----- Document control (docs.manage) -----
  route('GET', '/api/docs/settings', 'docs.manage', () => {
    noAudit();
    return { settings: settings(), defaults: DEFAULT_SETTINGS, families: FAMILIES, blocked: { exts: BLOCKED_EXTS, label: BLOCKED_LABEL }, classifications: CLASSIFICATIONS, maxUploadMB: MAX_UPLOAD_MB };
  });
  route('PUT', '/api/docs/settings', 'docs.manage', ({ body }) => {
    noAudit();
    const before = settings();
    const after = cleanSettings({ ...before, ...(body?.settings || {}) });
    D.docSettings = after;
    const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    if (changed.length) audit?.record('documents.settings', { entity: 'settings', label: 'Document control', note: changed.map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`).join('; ').slice(0, 1500) });
    db.save();
    return { settings: after };
  });
  route('GET', '/api/docs/admin', 'docs.manage', () => {
    noAudit();
    const usage = blobs.usage();
    const active = D.docLinks.filter((l) => !l.revokedAt).map(linkOut).filter((l) => l.state === 'active' || l.state === 'used');
    return {
      usage, documents: D.documents.filter((d) => !d.trashedAt).length, trashed: D.documents.filter((d) => d.trashedAt).length, folders: D.docFolders.filter((f) => !f.trashedAt).length,
      versions: D.documents.reduce((n, d) => n + d.versions.length, 0), held: D.documents.filter((d) => d.legalHold).length, unreviewed: D.documents.filter((d) => d.reviewed === false && !d.trashedAt).length,
      links: active, refused: [...D.docRefused].reverse().slice(0, 100).map((r) => ({ ...r, byName: nameOf(r.by) })), integrity: D.docIntegrity || null,
    };
  });
  route('POST', '/api/docs/admin/integrity', 'docs.manage', ({ user: u }) => {
    noAudit();
    const problems = [];
    let checked = 0;
    const known = new Set([D.docIndexBlob].filter(Boolean));
    for (const d of D.documents) {
      for (const v of d.versions) {
        known.add(v.blobId);
        checked++;
        try {
          blobs.get(v.blobId, v.sha256);
        } catch (err) {
          problems.push({ document: `${d.number} ${d.title}`, version: v.no, problem: err.message });
        }
      }
    }
    const orphans = blobs.orphans(known);
    D.docIntegrity = { at: now(), by: u.id, checked, problems: problems.slice(0, 200), orphans: orphans.length };
    audit?.record('documents.integrity', { entity: 'settings', label: 'Document control', note: `${checked} file(s) checked, ${problems.length} problem(s), ${orphans.length} unused file(s)` });
    db.save();
    return D.docIntegrity;
  });
  route('POST', '/api/docs/admin/links/revoke-all', 'docs.manage', ({ user: u }) => {
    noAudit();
    let n = 0;
    for (const l of D.docLinks) if (!l.revokedAt) (revoke(l, u.id), n++);
    db.save();
    return { revoked: n };
  });
  route('DELETE', '/api/docs/admin/links/:id', 'docs.manage', ({ params, user: u }) => {
    noAudit();
    const l = D.docLinks.find((x) => x.id === params.id && !x.revokedAt);
    if (!l) throw missing();
    revoke(l, u.id);
    db.save();
    return { ok: true };
  });

  // ----- Housekeeping: trash past its days, finished check-outs, idle uploads -----
  function sweep() {
    const s = settings();
    const cutoff = clock() - s.trashDays * 86400000;
    let changed = false;
    for (const d of [...D.documents]) if (d.trashedAt && Date.parse(d.trashedAt) < cutoff && !held(d, 'document')) (purgeDoc(d, null), (changed = true));
    for (const f of [...D.docFolders]) {
      if (!f.trashedAt || Date.parse(f.trashedAt) >= cutoff || held(f, 'folder')) continue;
      const inside = new Set(D.docFolders.filter((x) => chain(folderMap(), x.id).some((y) => y.id === f.id)).map((x) => x.id));
      for (const d of [...D.documents]) if (inside.has(d.folderId) && !d.legalHold) purgeDoc(d, null);
      if (!D.documents.some((d) => inside.has(d.folderId))) D.docFolders = D.docFolders.filter((x) => !inside.has(x.id));
      changed = true;
    }
    for (const d of D.documents) if (d.checkout && Date.parse(d.checkout.until) < clock()) (d.checkout = null), (changed = true);
    for (const x of [...uploads.values()]) if (clock() - x.usedAt > UPLOAD_IDLE_MS) dropUpload(x);
    if (changed) db.save();
  }
  const timer = setInterval(sweep, 60 * 60000);
  timer.unref?.();
  return { sweep, blobs, uploads, settings, flushIndex: () => { clearTimeout(indexTimer); } };
}
