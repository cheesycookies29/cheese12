// ATLAS Documents (/documents/): folders, documents with versions, check-out, sharing inside the
// school and by link outside it, and the Document control panel (Admin panel → Document control).
// The same module as CORE's Document Management (server/documents.js there), adapted to ATLAS: the
// plan is in docs/DOCUMENTS-PLAN.md of the CORE repository, and the engine (file types from the
// bytes, encryption at rest, access with inheritance, link secrets, the control panel's settings) is
// in server/dms/, the same files as CORE's server/dms/ (test/documents.test.js checks they agree).
//
// Who uses it ('documents' routes, see server/api.js): every signed-in employee, teacher, registrar,
// dean, administrator and officer, and students; parents and guardians do not. Students keep their
// own files and open what is shared with them: they share only with named people, and never make
// links for outside the school. Holders of docs.manage (administrators) manage everything.
//
// Files never sit in db.json: each version is a blob in data/documents, encrypted with its own key
// (server/dms/blobs.js) under a key derived from the server key (server/secrets.js). The search
// text of each version is kept in an encrypted index blob too. Every refusal of access answers 404,
// as if the item did not exist.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { HttpError } from './util.js';
import { userCan, ROLES } from '../shared/roles.js';
import { checkFile, FAMILIES, FAMILY, BLOCKED_EXTS, BLOCKED_LABEL, isInline } from './dms/types.js';
import { createBlobStore, BlobError } from './dms/blobs.js';
import { accessTo, atLeast, chain, RANK } from './dms/access.js';
import { cleanSettings, CLASSIFICATIONS, CLASS_IDS, LEVELS, LINK_MODES, MAX_UPLOAD_MB, DEFAULT_SETTINGS } from './dms/policy.js';
import { newToken, tokenHash, looksLikeToken, hashLinkPassword, checkLinkPassword, unlockValue, checkUnlock, cookieName } from './dms/links.js';
import { extractText as defaultExtract } from './documents-text.js';

const MB = 1024 * 1024;
export const DOCS_CHUNK_BYTES = 4 * MB;
const UPLOAD_IDLE_MS = 5 * 60000; // an upload with no piece for this long is dropped, and stops counting
const RESHARE_QUIET_MS = 60 * 60000; // shared again with the same person within this time: no second notification
const WRONG_PASSWORD_LOG_MS = 15 * 60000; // at most one "wrong link password" entry per link in this time
const EVENTS_KEPT = 20000;
const REFUSED_KEPT = 300;
const NOTICES_KEPT = 3000;
const TEXT_KEPT = 60 * 1024; // characters of search text kept per document
const NOT_FOUND = 'That document or folder is not there, or you do not have access to it.';
const UNAVAILABLE = 'This link is not available. It may have expired or been turned off; ask the person who sent it for a new one.';
const bad = (msg) => new HttpError(400, msg);
const missing = () => new HttpError(404, NOT_FOUND);
const text = (v, max) => (v == null || typeof v === 'object' ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const longText = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '');
// The engine's messages name CORE; in ATLAS they name ATLAS.
const atlas = (s) => String(s).replace(/\bCORE\b/g, 'ATLAS').replace('web pages and svg, and office files', 'web pages and SVG, and Office files');
const disposition = (kind, name) => `${kind}; filename="${String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
// A stored file as a response. Every file is sandboxed, except a PDF shown in the browser (Chrome's
// PDF viewer does not open in a sandboxed response; as server/files.js), which still may load nothing.
function fileResponse(v, data, inline) {
  const sandbox = !(inline && v.ext === 'pdf');
  return {
    raw: data,
    type: v.mime,
    headers: {
      'Content-Disposition': disposition(inline ? 'inline' : 'attachment', v.name),
      'Content-Security-Policy': `${sandbox ? 'sandbox; ' : ''}default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'`,
      'X-Content-Type-Options': 'nosniff', 'X-Download-Options': 'noopen', 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'same-origin',
    },
  };
}
const isStudent = (u) => u?.role === 'student';
const isGuardian = (u) => u?.role === 'guardian';

// options:
//   secrets: { derive(label) } (server/secrets.js); limits: the rate limiter (server/ratelimit.js)
//   dir: where the encrypted files live (default: data/documents beside db.json; a temporary folder
//        when the database is in memory, as in tests)
//   extractText(buffer, ext): the words of a file for search (server/documents-text.js)
//   clock: () => milliseconds
// notify(userIds, entry, opts): the bell (server/notifications.js), for a share and Documents' own notices.
export function registerDocuments(route, db, { secrets, limits = null, dir = null, extractText = defaultExtract, clock = () => Date.now(), notify = null } = {}) {
  const docDir = dir || (db.dir ? path.join(db.dir, 'documents') : path.join(os.tmpdir(), `atlas-documents-${randomUUID()}`));
  const blobs = createBlobStore(docDir, secrets.derive('documents.master-key'));
  const cookieKey = secrets.derive('documents.link-cookie');
  // db.data is replaced when a backup is restored: always read the current one.
  const D = new Proxy({}, { get: (_, k) => db.data[k], set: (_, k, v) => ((db.data[k] = v), true) });
  const ensure = () => {
    for (const k of ['docFolders', 'documents', 'docLinks', 'docEvents', 'docRefused', 'docNotices']) if (!Array.isArray(D[k])) D[k] = [];
  };
  ensure();
  const settings = () => cleanSettings(D.docSettings || {});
  const now = () => new Date(clock()).toISOString();
  const userById = (id) => D.users.find((u) => u.id === id) || null;
  const active = (u) => Boolean(u) && u.status === 'active';
  const nameOf = (id) => (String(id || '').startsWith('link:') ? 'Someone with a link' : userById(id)?.name || 'Former user');
  // Departments come from the HRIS employee record linked to the account (else the account's own).
  const departmentOf = (u) => (u?.employeeId && D.employees.find((e) => e.id === u.employeeId)?.department) || u?.department || '';
  const departments = () => [...new Set([...D.employees.map((e) => e.department), ...D.users.filter(active).map((u) => u.department)].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  // docs.manage as every other per-person check in ATLAS: the account type's permissions with this
  // account's own changes (System → Users & Access → Access), through userCan.
  const manager = (u) => userCan(u, 'docs.manage');
  const who = (u, asManager = true) => ({ id: u.id, role: u.role, department: departmentOf(u), manager: asManager && manager(u) });
  const folderMap = () => new Map(D.docFolders.map((f) => [f.id, f]));
  const docById = (id) => D.documents.find((d) => d.id === id) || null;
  const folderById = (id) => D.docFolders.find((f) => f.id === id) || null;
  const current = (d) => d.versions.find((v) => v.no === d.currentVersion) || d.versions[d.versions.length - 1];

  // ----- The search index: encrypted, kept as one blob, loaded once -----
  let index = null;
  let indexOf = null; // the data the index was loaded for (a restore starts again)
  const loadIndex = () => {
    if (index && indexOf === db.data) return index;
    index = new Map();
    indexOf = db.data;
    try {
      if (D.docIndexBlob && blobs.exists(D.docIndexBlob)) for (const [k, v] of JSON.parse(blobs.get(D.docIndexBlob).toString('utf8'))) index.set(k, v);
    } catch { /* rebuilt as documents change */ }
    return index;
  };
  let indexTimer = null;
  const writeIndex = () => {
    clearTimeout(indexTimer);
    indexTimer = null;
    const old = D.docIndexBlob;
    D.docIndexBlob = blobs.put(Buffer.from(JSON.stringify([...loadIndex()]), 'utf8')).blobId;
    db.save();
    if (old) blobs.remove(old);
  };
  // Written a few seconds after the first change, and not again until then: a burst of uploads
  // writes the index once, not once per file.
  const saveIndex = () => {
    if (indexTimer) return;
    indexTimer = setTimeout(writeIndex, 5000);
    indexTimer.unref?.();
  };

  // ----- Events: each document's and folder's activity; notices for the people concerned -----
  function event(action, { doc = null, folder = null, link = null, by, ip = '', note = '' }) {
    D.docEvents.push({ at: now(), action, docId: doc?.id || (link?.target.kind === 'document' ? link.target.id : null), folderId: folder?.id || (link?.target.kind === 'folder' ? link.target.id : null), linkId: link?.id || null, by: by || null, ip: ip || '', note: note || '' });
    if (D.docEvents.length > EVENTS_KEPT) D.docEvents.splice(0, D.docEvents.length - EVENTS_KEPT);
  }
  function notice(userId, title, body, link) {
    D.docNotices.push({ id: randomUUID(), userId, at: now(), title, body, link, readAt: null });
    if (D.docNotices.length > NOTICES_KEPT) D.docNotices.splice(0, D.docNotices.length - NOTICES_KEPT);
    tell([userId], { kind: 'docs-notice', title, body, link: `/documents/${link}` });
  }
  // The bell, in every ATLAS system (a no-op in tests that leave notify out).
  function tell(userIds, entry, actorId = null) {
    if (!notify) return;
    try {
      notify(userIds, { system: 'dms', ...entry }, { actorId });
    } catch (err) {
      console.error('  Documents: notification not written:', err.message);
    }
  }
  // Shared with someone by name (not a department, a class or everyone): they are told once, when
  // added. Taken off and added again within RESHARE_QUIET_MS, they are not told again.
  const LEVEL_WORDS = { view: 'You can open it', edit: 'You can open and change it', manage: 'You can change and share it' };
  const toldShared = new Map(); // `${link}|${userId}` → when they were last told
  function tellShared(before, after, u, what, link) {
    const had = new Set((before || []).filter((g) => g.type === 'user').map((g) => g.id));
    const t = clock();
    if (toldShared.size > 5000) for (const [k, at] of toldShared) if (t - at > RESHARE_QUIET_MS) toldShared.delete(k);
    for (const g of after || []) {
      if (g.type !== 'user' || had.has(g.id) || g.id === u.id) continue;
      const key = `${link}|${g.id}`;
      if (t - (toldShared.get(key) ?? -Infinity) < RESHARE_QUIET_MS) continue;
      toldShared.set(key, t);
      tell([g.id], { kind: 'docs-shared', title: `${u.name} shared ${what} with you`, body: `${LEVEL_WORDS[g.level] || 'You can open it'}${g.until ? ` until ${String(g.until).slice(0, 10)}` : ''}.`, link }, u.id);
    }
  }

  // ----- Access -----
  // asManager false: what the person holds themselves (owner, grants), without docs.manage; used for
  // the lists (Shared with me, Recent, Trash), so a manager's lists are not the whole school's.
  //
  // Restricted documents are for named people only: they are reached by their owner, the people
  // named on the document itself and document managers. Grants to an account type, a department or
  // everyone, and every grant of the folders above, do not reach them. Only those who manage a
  // restricted document get its file (shown in the browser or downloaded); the others named on it
  // see its details. `open` says whether the file reaches the person at all.
  function accessOf(u, item, kind, { asManager = true } = {}) {
    const restricted = kind === 'document' && item.classification === 'restricted';
    const target = restricted ? { ...item, acl: (item.acl || []).filter((g) => g.type === 'user') } : item;
    const a = accessTo(who(u, asManager), target, { folders: restricted ? new Map() : folderMap(), now: clock(), kind });
    if (restricted && a.level !== 'manage') a.download = false;
    a.open = atLeast(a.level, 'view') && (!restricted || a.level === 'manage');
    // Students never pass a document on outside the people it was shared with.
    if (isStudent(u) && a.level !== 'manage') a.share = false;
    return a;
  }
  const inTrash = (item, kind) => {
    if (item.trashedAt) return true;
    const start = kind === 'document' ? item.folderId : item.parentId;
    return chain(folderMap(), start).some((f) => f.trashedAt);
  };
  // ----- Legal hold -----
  // A hold on a folder holds everything below it, however deep: its documents, its folders and
  // theirs. Nothing held is deleted (trash, purge, the sweep), loses versions, or is moved out from
  // under the held folder.
  const heldAbove = (item, kind) => chain(folderMap(), kind === 'document' ? item.folderId : item.parentId).filter((f) => f.legalHold);
  const held = (item, kind) => Boolean(item.legalHold) || heldAbove(item, kind).length > 0;
  // Whether a folder holds, anywhere below it, a folder or a document with its own hold.
  const holdBelow = (f) => {
    const m = folderMap();
    const under = (folderId) => chain(m, folderId).some((x) => x.id === f.id);
    return D.docFolders.some((x) => x.legalHold && x.id !== f.id && under(x.id)) || D.documents.some((d) => d.legalHold && under(d.folderId));
  };
  // The hold as the browser sees it, so the pages offer only what a hold allows: null when nothing
  // holds the item; else whether it has its own hold and the nearest held folder above it (its name
  // only for someone who can open that folder).
  function holdOut(u, item, kind) {
    const above = heldAbove(item, kind)[0] || null;
    if (!item.legalHold && !above) return null;
    const seen = above && atLeast(accessOf(u, above, 'folder').level, 'view');
    return { own: Boolean(item.legalHold), folder: above ? { id: above.id, name: seen ? above.name : '' } : null };
  }
  // A move (or a restore elsewhere) keeps every held folder above the item above it.
  function keepHold(item, kind, newParentId) {
    const above = heldAbove(item, kind);
    if (!above.length) return;
    const after = new Set(chain(folderMap(), newParentId).map((f) => f.id));
    if (above.some((f) => !after.has(f.id))) throw bad(`This ${kind === 'document' ? 'document' : 'folder'} is in a folder on legal hold, so it stays inside that folder.`);
  }

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
  const personalOwner = (f) => chain(folderMap(), f.id).find((x) => x.kind === 'personal')?.ownerId || null;
  const isPersonal = (f) => Boolean(personalOwner(f));
  // Someone else's personal files, which a manager reaches but does not see in their own lists.
  const othersPersonal = (u, folderId) => {
    const root = chain(folderMap(), folderId).find((x) => x.kind === 'personal');
    return Boolean(root) && root.ownerId !== u.id;
  };

  // ----- What the browser sees -----
  const versionOut = (v) => ({ no: v.no, name: v.name, ext: v.ext, family: v.family, size: v.size, sha256: v.sha256, by: v.by, byName: nameOf(v.by), at: v.at, note: v.note || '' });
  const checkoutOf = (d) => (d.checkout && Date.parse(d.checkout.until) > clock() ? d.checkout : null);
  function docOut(u, d, a = accessOf(u, d, 'document'), { full = false } = {}) {
    const v = current(d);
    const co = checkoutOf(d);
    const out = {
      id: d.id, number: d.number, title: d.title, folderId: d.folderId, tags: d.tags || [], classification: d.classification, status: d.status,
      ownerId: d.ownerId, ownerName: nameOf(d.ownerId), name: v?.name, ext: v?.ext, family: v?.family, size: v?.size, version: d.currentVersion,
      versions: d.versions.length, updatedAt: d.updatedAt, createdAt: d.createdAt, checkout: co ? { ...co, name: nameOf(co.userId) } : null,
      legalHold: Boolean(d.legalHold), held: holdOut(u, d, 'document'), trashedAt: d.trashedAt || null, reviewed: d.reviewed !== false, source: d.source || 'upload',
      level: a.level, canDownload: a.download, canOpen: a.open !== false, canShare: a.share && a.level !== 'none', inline: Boolean(v && isInline(v.ext)) && a.open !== false,
    };
    if (full) {
      out.description = d.description || '';
      out.sender = d.sender || null;
      out.versionList = [...d.versions].reverse().map(versionOut);
      out.path = pathOf(u, d.folderId);
      if (a.level === 'manage') {
        out.acl = (d.acl || []).map(grantOut);
        out.links = D.docLinks.filter((l) => l.target.kind === 'document' && l.target.id === d.id && !l.revokedAt).map(linkOut);
      }
      // Who else has access (the notes of sharing and link entries) is for those who manage it.
      const mine = a.level === 'manage';
      out.events = D.docEvents.filter((e) => e.docId === d.id).slice(-60).reverse().map((e) => ({ ...e, byName: nameOf(e.by), ip: mine ? e.ip : '', note: mine || !SHARING_EVENTS.has(e.action) ? e.note : '' }));
    }
    return out;
  }
  const SHARING_EVENTS = new Set(['access', 'link', 'unlink']);
  const grantOut = (g) => ({ type: g.type, id: g.id, level: g.level, download: g.download !== false, share: Boolean(g.share), until: g.until || null, label: grantLabel(g) });
  function grantLabel(g) {
    if (g.type === 'everyone') return 'Everyone signed in';
    if (g.type === 'user') {
      const x = userById(g.id);
      return x ? `${x.name} (${ROLES[x.role]?.label || x.role})` : 'Former user';
    }
    if (g.type === 'role') return `Every ${ROLES[g.id]?.label || g.id} (account type)`;
    return `${g.id} (department)`;
  }
  // `detail`: the folder being opened, with whether anything inside it is on hold (which keeps the
  // folder out of the trash); the lists leave that out.
  function folderOut(u, f, a = accessOf(u, f, 'folder'), { detail = false } = {}) {
    const out = { id: f.id, name: f.name, parentId: f.parentId, kind: f.kind, ownerId: f.ownerId, ownerName: nameOf(f.ownerId), inherit: f.inherit !== false, level: a.level, canShare: a.share, trashedAt: f.trashedAt || null, legalHold: Boolean(f.legalHold), held: holdOut(u, f, 'folder'), personal: isPersonal(f) };
    if (detail) out.holdInside = holdBelow(f);
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
      hasPassword: Boolean(l.passwordHash), expiresAt: l.expiresAt, maxDownloads: l.maxDownloads || 0, downloads: l.downloads || 0, views: l.views || 0, opens: l.opens || 0, uploads: l.uploads || 0,
      note: l.note || '', createdBy: l.createdBy, createdByName: nameOf(l.createdBy), createdAt: l.createdAt, lastAccessAt: l.lastAccessAt || null, state: linkState(l).state,
    };
  }

  // ----- Meta: what the page needs to know -----
  const usedBy = (userId) => {
    let n = 0;
    for (const d of D.documents) if (d.ownerId === userId) for (const v of d.versions) n += v.size;
    return n;
  };
  const mayLink = (u, s = settings()) => !isStudent(u) && s.links && (s.linkCreators === 'all' || manager(u));
  route('GET', '/api/docs/meta', 'documents', ({ user: u }) => {
    const s = settings();
    const root = personalRoot(u);
    const student = isStudent(u);
    return {
      personalRoot: root.id, manager: manager(u), student,
      families: FAMILIES.filter((f) => s.families.includes(f.id)).map((f) => ({ id: f.id, label: f.label, exts: f.exts })),
      maxUploadMB: s.maxUploadMB, quotaMB: s.quotaMB, usedBytes: usedBy(u.id), chunkBytes: DOCS_CHUNK_BYTES, trashDays: s.trashDays, checkoutHours: s.checkoutHours,
      classifications: CLASSIFICATIONS, levels: LEVELS,
      sharing: {
        internal: s.internalSharing || manager(u), everyone: s.shareWithEveryone && !student, groups: !student, links: mayLink(u, s), uploadLinks: s.uploadLinks && mayLink(u, s),
        passwordRequired: s.linkPasswordRequired, passwordMin: s.linkPasswordMin, defaultDays: s.linkDefaultDays, maxDays: s.linkMaxDays, maxDownloads: s.linkMaxDownloads, classifications: s.linkClassifications,
      },
      roles: student ? [] : Object.entries(ROLES).filter(([id]) => id !== 'guardian').map(([id, r]) => ({ id, label: r.label })),
      departments: student ? [] : departments(),
      notices: D.docNotices.filter((n) => n.userId === u.id && !n.readAt).slice(-20).reverse(),
    };
  });
  route('POST', '/api/docs/notices/read', 'documents', ({ user: u }) => {
    for (const n of D.docNotices) if (n.userId === u.id && !n.readAt) n.readAt = now();
    db.save();
    return { ok: true };
  });
  // People to share with, by name or username. Staff find every account except parents; students
  // find staff and the classmates they share a section with.
  route('GET', '/api/docs/people', 'documents', ({ query, user: u }) => {
    const q = text(query.q, 60).toLowerCase();
    if (q.length < 2) return { people: [] };
    let pool = D.users.filter((x) => active(x) && !isGuardian(x) && x.id !== u.id);
    if (isStudent(u)) {
      const mine = new Set(D.enrollments.filter((e) => e.studentId === u.id && ['enrolled', 'completed'].includes(e.status)).map((e) => e.sectionId));
      const classmates = new Set(D.enrollments.filter((e) => mine.has(e.sectionId) && ['enrolled', 'completed'].includes(e.status)).map((e) => e.studentId));
      pool = pool.filter((x) => !isStudent(x) || classmates.has(x.id));
    }
    const hits = pool.filter((x) => `${x.name} ${x.username}`.toLowerCase().includes(q)).slice(0, 20);
    return { people: hits.map((x) => ({ id: x.id, name: x.name, role: x.role, roleLabel: ROLES[x.role]?.label || x.role, department: departmentOf(x) })) };
  });

  // ----- Folders -----
  // The folders a person can see: their own tree, and every folder shared with them (shown at the top
  // when its parent is not visible to them). Managers reach everyone's, but other people's personal
  // folders are listed only when shared with the manager.
  route('GET', '/api/docs/folders', 'documents', ({ user: u }) => {
    personalRoot(u);
    const out = [];
    for (const f of D.docFolders) {
      if (inTrash(f, 'folder')) continue;
      const a = accessOf(u, f, 'folder');
      if (!atLeast(a.level, 'view')) continue;
      if (othersPersonal(u, f.id) && !atLeast(accessOf(u, f, 'folder', { asManager: false }).level, 'view')) continue;
      out.push(folderOut(u, f, a));
    }
    const visible = new Set(out.map((f) => f.id));
    for (const f of out) if (f.parentId && !visible.has(f.parentId)) f.sharedRoot = true;
    return { folders: out };
  });
  route('POST', '/api/docs/folders', 'documents', ({ body, user: u }) => {
    const name = text(body.name, 120).replace(/[\\/]/g, '-');
    if (!name) throw bad('Name the folder.');
    const parentId = body.parentId ? String(body.parentId) : null;
    if (parentId) needFolder(u, parentId, 'edit');
    else if (!manager(u)) throw bad('Only document managers add folders at the top level. Add it inside a folder you can edit, or in My files.');
    if (D.docFolders.some((f) => f.parentId === parentId && !f.trashedAt && f.name.toLowerCase() === name.toLowerCase())) throw bad(`There is already a folder called “${name}” here.`);
    const f = { id: randomUUID(), parentId, name, kind: 'shared', ownerId: u.id, acl: [], inherit: true, createdAt: now(), createdBy: u.id, trashedAt: null, legalHold: false };
    D.docFolders.push(f);
    event('folder-create', { folder: f, by: u.id });
    db.save();
    return folderOut(u, f);
  });
  route('PUT', '/api/docs/folders/:id', 'documents', ({ params, body, user: u }) => {
    const { f } = needFolder(u, params.id, 'manage');
    if ('name' in body) {
      const name = text(body.name, 120).replace(/[\\/]/g, '-');
      if (!name) throw bad('Name the folder.');
      if (f.kind === 'personal' && !f.parentId) throw bad('My files keeps its name.');
      f.name = name;
    }
    if ('parentId' in body) moveFolder(u, f, body.parentId ? String(body.parentId) : null);
    if (typeof body.legalHold === 'boolean') {
      if (!manager(u)) throw bad('Only document managers place or lift a legal hold.');
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
    } else if (!manager(u)) throw bad('Only document managers keep folders at the top level.');
    keepHold(f, 'folder', parentId);
    f.parentId = parentId;
  }
  route('PUT', '/api/docs/folders/:id/access', 'documents', ({ params, body, user: u }) => {
    const { f, a } = needFolder(u, params.id, 'manage');
    if (f.kind === 'personal' && !f.parentId) throw bad('My files is yours only. Share a folder inside it, or a document.');
    const was = f.acl;
    f.acl = cleanGrants(u, body.grants, a);
    tellShared(was, f.acl, u, `the folder “${f.name}”`, `/documents/#/folder/${f.id}`);
    if (typeof body.inherit === 'boolean') f.inherit = body.inherit;
    event('access', { folder: f, by: u.id, note: summary(f.acl) });
    db.save();
    return folderOut(u, f);
  });

  // ----- Listing and search -----
  // view: 'folder' (with folder), 'shared' (shared with me), 'recent', 'mine', 'received' (by upload
  // links, not reviewed), 'trash', 'search'. q: words in the title, name, tags, number or content.
  route('GET', '/api/docs/list', 'documents', ({ query, user: u }) => {
    const view = ['folder', 'shared', 'recent', 'mine', 'received', 'trash', 'search'].includes(query.view) ? query.view : 'folder';
    const q = text(query.q, 120).toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const cls = CLASS_IDS.includes(query.classification) ? query.classification : null;
    const tag = text(query.tag, 40).toLowerCase();
    let folderId = null;
    let folders = [];
    let level = null;
    let pathOut = [];
    let folder = null;
    if (view === 'folder') {
      const { f, a } = needFolder(u, query.folder || personalRoot(u).id);
      folderId = f.id;
      level = a.level;
      pathOut = pathOf(u, f.id);
      folder = folderOut(u, f, a, { detail: true });
      folders = D.docFolders.filter((x) => x.parentId === f.id && !x.trashedAt).map((x) => [x, accessOf(u, x, 'folder')]).filter(([, xa]) => atLeast(xa.level, 'view')).map(([x, xa]) => folderOut(u, x, xa))
        .sort((x, y) => x.name.localeCompare(y.name, 'en', { numeric: true }));
    }
    const personalLists = ['shared', 'recent', 'mine', 'received', 'trash'].includes(view);
    const idx = words.length ? loadIndex() : null;
    const out = [];
    for (const d of D.documents) {
      if (view === 'trash' ? !d.trashedAt : inTrash(d, 'document')) continue;
      if (view === 'folder' && d.folderId !== folderId) continue;
      const a = accessOf(u, d, 'document', { asManager: !personalLists });
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
      const full = personalLists ? accessOf(u, d, 'document') : a;
      if (words.length) {
        const v = current(d);
        // The words inside the file count only for people who may download it: search never tells
        // anyone else what a file says.
        const hay = `${d.number} ${d.title} ${v?.name || ''} ${(d.tags || []).join(' ')} ${d.description || ''} ${full.download ? idx.get(d.id) || '' : ''}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
      }
      out.push(docOut(u, d, full));
    }
    out.sort(view === 'recent' ? (a, b) => b.updatedAt.localeCompare(a.updatedAt) : view === 'trash' ? (a, b) => (b.trashedAt || '').localeCompare(a.trashedAt || '') : (a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
    if (view === 'trash') folders = D.docFolders.filter((f) => f.trashedAt).map((f) => [f, accessOf(u, f, 'folder', { asManager: false })]).filter(([, a]) => a.level === 'manage').map(([f]) => folderOut(u, f));
    return { view, folderId, folder, level, path: pathOut, folders, documents: view === 'recent' ? out.slice(0, 50) : out.slice(0, 2000), trashDays: settings().trashDays };
  });

  // ----- Uploads in pieces: start, pieces, finish -----
  const uploads = new Map();
  const upDir = path.join(docDir, 'uploads');
  const dropUpload = (x) => {
    uploads.delete(x.id);
    fs.rmSync(x.path, { force: true });
  };
  function startUpload(owner, name, size) {
    const s = settings();
    if (!Number.isInteger(size) || size <= 0) throw bad(`${name} is empty.`);
    if (size > s.maxUploadMB * MB) throw bad(`${name} is larger than ${s.maxUploadMB} MB, the most accepted here.`);
    // Uploads left unfinished (no piece for a few minutes) are dropped here, so they do not hold a place.
    for (const x of [...uploads.values()]) if (clock() - x.usedAt > UPLOAD_IDLE_MS) dropUpload(x);
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
    const offset = Number(body.offset);
    if (typeof body.data !== 'string' || !Number.isInteger(offset) || offset < 0) throw bad('Send a piece of the file.');
    const piece = Buffer.from(body.data, 'base64');
    if (!piece.length || piece.length > DOCS_CHUNK_BYTES) throw bad('Send the file in pieces of up to 4 MB.');
    if (offset + piece.length <= x.received) return { received: x.received }; // a piece sent again
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
  // the owner's room. Refusals are logged for the control panel.
  function vet(buf, name, byId, ownerId) {
    const s = settings();
    if (buf.length > s.maxUploadMB * MB) refuse(name, byId, 'size', `${name} is larger than ${s.maxUploadMB} MB, the most accepted here.`);
    const c = checkFile(buf, name, s.families);
    if (!c.ok) refuse(name, byId, c.code, atlas(c.reason));
    checkQuota(name, byId, ownerId, buf.length);
    return c;
  }
  function checkQuota(name, byId, ownerId, bytes) {
    const s = settings();
    if (s.quotaMB && usedBy(ownerId) + bytes > s.quotaMB * MB) refuse(name, byId, 'quota', `This would go over the ${s.quotaMB} MB of documents each person may keep. Remove old versions or documents, or ask an administrator.`);
  }
  function refuse(name, byId, code, reason) {
    D.docRefused.push({ at: now(), name: text(name, 200), by: byId, code, reason });
    if (D.docRefused.length > REFUSED_KEPT) D.docRefused.splice(0, D.docRefused.length - REFUSED_KEPT);
    db.save();
    throw bad(reason);
  }
  function addVersion(d, buf, c, byId, note) {
    const { blobId, sha256, size } = blobs.put(buf);
    const no = (d.versions.reduce((n, v) => Math.max(n, v.no), 0) || 0) + 1;
    d.versions.push({ no, blobId, name: c.name, ext: c.ext, family: c.family, mime: c.mime, size, sha256, by: byId, at: now(), note: text(note, 300) });
    d.currentVersion = no;
    d.updatedAt = now();
    // Old versions beyond what the control panel keeps go (never while the document, or a folder
    // above it, is on legal hold).
    const keep = settings().versionsKept;
    if (!held(d, 'document')) while (d.versions.length > keep) blobs.remove(d.versions.shift().blobId);
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
  const newDoc = (fields) => ({
    id: randomUUID(), number: nextNumber(), description: '', tags: [], classification: 'internal', status: 'draft', versions: [], currentVersion: 0, checkout: null, acl: [],
    legalHold: false, retainUntil: null, source: 'upload', reviewed: true, createdAt: now(), updatedAt: now(), trashedAt: null, trashedBy: null, ...fields,
  });

  route('POST', '/api/docs/uploads', 'documents', ({ body, user: u }) => startUpload(u.id, text(body.name, 200) || 'file', Number(body.size)));
  route('PUT', '/api/docs/uploads/:id', 'documents', ({ params, body, user: u }) => putPiece(u.id, params.id, body));
  // finish { folderId, title, classification, tags, description, note } → a new document; with
  // documentId → a new version of it (edit access; not while someone else has it checked out).
  route('POST', '/api/docs/uploads/:id/finish', 'documents', ({ params, body, user: u, ip }) => {
    const { name, buf } = takeUpload(u.id, params.id);
    if (body.documentId) {
      const { d } = needDoc(u, body.documentId, 'edit');
      const co = checkoutOf(d);
      if (co && co.userId !== u.id) throw bad(`${nameOf(co.userId)} has this document checked out until ${new Date(co.until).toLocaleString('en-PH')}. Ask them to check it in.`);
      const c = vet(buf, name, u.id, d.ownerId);
      const cur = current(d);
      if (cur && c.family !== cur.family) refuse(name, u.id, 'kind', `A new version must be the same kind of file as the document (${FAMILY[cur.family].label}).`);
      const sha = addVersion(d, buf, c, u.id, body.note);
      if (body.checkin && co) d.checkout = null;
      event('version', { doc: d, by: u.id, ip, note: `Version ${d.currentVersion}: ${c.name}` });
      db.save();
      return { document: docOut(u, d), duplicate: duplicateIn(d.folderId, sha, d.id)?.number || null };
    }
    const { f } = needFolder(u, body.folderId || personalRoot(u).id, 'edit');
    const c = vet(buf, name, u.id, u.id);
    const s = settings();
    const dup = duplicateIn(f.id, createHash('sha256').update(buf).digest('hex'));
    if (dup && s.duplicates === 'refuse') refuse(name, u.id, 'duplicate', `This file is already in this folder as ${dup.number} “${dup.title}”.`);
    const d = newDoc({
      folderId: f.id, title: text(body.title, 200) || c.name.replace(/\.[^.]+$/, ''), description: longText(body.description, 4000), tags: cleanTags(body.tags),
      classification: CLASS_IDS.includes(body.classification) ? body.classification : 'internal', ownerId: u.id,
    });
    addVersion(d, buf, c, u.id, body.note || 'First version');
    D.documents.push(d);
    event('upload', { doc: d, by: u.id, ip, note: `${c.name} (${Math.max(1, Math.round(buf.length / 1024))} KB) into ${f.name}` });
    db.save();
    return { document: docOut(u, d), duplicate: dup ? dup.number : null };
  });
  route('DELETE', '/api/docs/uploads/:id', 'documents', ({ params, user: u }) => {
    const x = uploads.get(String(params.id || ''));
    if (x && x.owner === u.id) dropUpload(x);
    return { ok: true };
  });

  // ----- One document -----
  route('GET', '/api/docs/documents/:id', 'documents', ({ params, user: u }) => {
    const { d, a } = needDoc(u, params.id, 'view', { trash: true });
    if (inTrash(d, 'document') && a.level !== 'manage') throw missing();
    return docOut(u, d, a, { full: true });
  });
  route('PUT', '/api/docs/documents/:id', 'documents', ({ params, body: b, user: u }) => {
    const { d, a } = needDoc(u, params.id, 'edit');
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
    if ('classification' in b && b.classification !== d.classification) {
      if (!CLASS_IDS.includes(b.classification)) throw bad('Choose a classification.');
      if (a.level !== 'manage') throw bad('Only people who manage the document change its classification.');
      if (b.classification === 'restricted' && (d.acl || []).some((g) => g.type !== 'user')) throw bad('Restricted documents are shared with named people only. Under Share, remove the account types, departments and everyone first.');
      changes.push(`classification ${b.classification}`);
      d.classification = b.classification;
    }
    if ('folderId' in b && b.folderId !== d.folderId) {
      if (a.level !== 'manage') throw bad('Only people who manage the document move it.');
      const { f } = needFolder(u, b.folderId, 'edit');
      keepHold(d, 'document', f.id);
      changes.push(`moved to ${f.name}`);
      d.folderId = f.id;
    }
    if (typeof b.legalHold === 'boolean' && b.legalHold !== Boolean(d.legalHold)) {
      if (!manager(u)) throw bad('Only document managers place or lift a legal hold.');
      d.legalHold = b.legalHold;
      event(b.legalHold ? 'hold' : 'unhold', { doc: d, by: u.id });
    }
    if (b.reviewed === true && d.reviewed === false) {
      if (a.level !== 'manage') throw bad('Only people who manage the document mark it reviewed.');
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
  //
  // What "no download" (a grant with Download unticked) promises: no Download button and no
  // attachment response. Showing a PDF or picture on the page sends the whole file to the browser,
  // so it cannot stop a viewer saving what they see. Restricted documents go further: their file
  // reaches only those who manage them, shown or downloaded.
  route('GET', '/api/docs/documents/:id/file', 'documents', ({ params, query, user: u, ip }) => {
    const { d, a } = needDoc(u, params.id, 'view');
    const v = query.v ? d.versions.find((x) => x.no === Number(query.v)) : current(d);
    if (!v) throw missing();
    if (!a.open) throw new HttpError(403, 'Restricted documents are opened and downloaded only by the people who manage them.');
    const inline = query.inline === '1' && isInline(v.ext);
    if (!inline && !a.download) throw new HttpError(403, d.classification === 'restricted' ? 'Restricted documents are downloaded only by the people who manage them.' : 'You can view this document but not download it.');
    const data = readBlob(v);
    event(inline ? 'view' : 'download', { doc: d, by: u.id, ip, note: `Version ${v.no}` });
    db.save();
    return fileResponse(v, data, inline);
  });
  function readBlob(v) {
    try {
      return blobs.get(v.blobId, v.sha256);
    } catch (err) {
      if (err instanceof BlobError) throw new HttpError(err.code === 'missing' ? 410 : 500, err.message);
      throw err;
    }
  }
  route('POST', '/api/docs/documents/:id/restore-version', 'documents', ({ params, body, user: u }) => {
    const { d } = needDoc(u, params.id, 'edit');
    const v = d.versions.find((x) => x.no === Number(body.no));
    if (!v) throw bad('That version is not kept any more.');
    const co = checkoutOf(d);
    if (co && co.userId !== u.id) throw bad(`${nameOf(co.userId)} has this document checked out.`);
    checkQuota(v.name, u.id, d.ownerId, v.size);
    const buf = readBlob(v);
    addVersion(d, buf, { name: v.name, ext: v.ext, family: v.family, mime: v.mime }, u.id, `Restored from version ${v.no}`);
    event('version', { doc: d, by: u.id, note: `Version ${d.currentVersion} restored from version ${v.no}` });
    db.save();
    return docOut(u, d, accessOf(u, d, 'document'), { full: true });
  });
  // Check-out: one person edits; others wait. It ends by itself after the control panel's hours;
  // managers of the document can end someone else's.
  route('POST', '/api/docs/documents/:id/checkout', 'documents', ({ params, body, user: u }) => {
    const { d, a } = needDoc(u, params.id, 'edit');
    const co = checkoutOf(d);
    if (body.release) {
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
  route('PUT', '/api/docs/documents/:id/access', 'documents', ({ params, body, user: u }) => {
    const { d, a } = needDoc(u, params.id, 'manage');
    const was = d.acl;
    d.acl = cleanGrants(u, body.grants, a, d.classification);
    tellShared(was, d.acl, u, `“${d.title || current(d)?.name || 'a document'}”`, `/documents/#/doc/${d.id}`);
    event('access', { doc: d, by: u.id, note: summary(d.acl) });
    db.save();
    return docOut(u, d, a, { full: true });
  });

  // ----- Trash, restore, purge -----
  route('DELETE', '/api/docs/documents/:id', 'documents', ({ params, user: u }) => {
    const { d } = needDoc(u, params.id, 'manage');
    if (held(d, 'document')) throw bad('This document is on legal hold, so it cannot be deleted.');
    d.trashedAt = now();
    d.trashedBy = u.id;
    event('trash', { doc: d, by: u.id });
    db.save();
    return { ok: true };
  });
  route('DELETE', '/api/docs/folders/:id', 'documents', ({ params, user: u }) => {
    const { f } = needFolder(u, params.id, 'manage');
    if (f.kind === 'personal' && !f.parentId) throw bad('My files cannot be deleted.');
    if (held(f, 'folder') || holdBelow(f)) throw bad('This folder or a document in it is on legal hold, so it cannot be deleted.');
    f.trashedAt = now();
    f.trashedBy = u.id;
    event('trash', { folder: f, by: u.id });
    db.save();
    return { ok: true };
  });
  route('POST', '/api/docs/restore', 'documents', ({ body, user: u }) => {
    if (body.documentId) {
      const { d } = needDoc(u, body.documentId, 'manage', { trash: true });
      if (!d.trashedAt) return { ok: true };
      // Back where it was, or into My files when that folder is gone or in the trash.
      const parent = folderById(d.folderId);
      if (!parent || inTrash(parent, 'folder')) {
        keepHold(d, 'document', personalRoot(u).id);
        d.folderId = personalRoot(u).id;
      }
      d.trashedAt = null;
      d.trashedBy = null;
      event('restore', { doc: d, by: u.id });
    } else {
      const { f } = needFolder(u, body.folderId, 'manage', { trash: true });
      const parent = f.parentId && folderById(f.parentId);
      if (f.parentId && (!parent || inTrash(parent, 'folder'))) {
        keepHold(f, 'folder', personalRoot(u).id);
        f.parentId = personalRoot(u).id;
      }
      f.trashedAt = null;
      f.trashedBy = null;
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
    event('purge', { doc: d, by: byId, note: `${d.number} ${d.title}: ${d.versions.length === 1 ? '1 version' : `${d.versions.length} versions`} removed` });
  }
  route('DELETE', '/api/docs/documents/:id/purge', 'documents', ({ params, user: u }) => {
    const { d } = needDoc(u, params.id, 'manage', { trash: true });
    if (!d.trashedAt) throw bad('Move the document to the trash first.');
    if (held(d, 'document')) throw bad('This document is on legal hold.');
    purgeDoc(d, u.id);
    db.save();
    return { ok: true };
  });

  // ----- Grants -----
  // A grant never gives more than the giver holds. Students share only with named people (staff and
  // their classmates), never with a group or everyone; nobody shares with parents and guardians.
  function cleanGrants(u, list, a, classification = null) {
    const s = settings();
    if (!s.internalSharing && !manager(u)) throw bad('Sharing inside the school is turned off. Ask an administrator.');
    if (!Array.isArray(list)) throw bad('Send the list of people and groups.');
    if (list.length > 200) throw bad('A document or folder can be shared with up to 200 people and groups.');
    const depts = new Set(departments());
    const out = [];
    for (const g of list) {
      const type = ['user', 'role', 'department', 'everyone'].includes(g?.type) ? g.type : null;
      if (!type) throw bad('Share with a person, an account type, a department or everyone.');
      if (isStudent(u) && type !== 'user') throw bad('Students share with named people only, not with groups or everyone.');
      if (type === 'everyone' && !s.shareWithEveryone) throw bad('Sharing with everyone is turned off in Document control.');
      if (type !== 'user' && classification === 'restricted') throw bad('Restricted documents are shared with named people only, not with account types, departments or everyone.');
      const id = type === 'everyone' ? '*' : text(g.id, 80);
      if (type === 'user') {
        const x = userById(id);
        if (!x || !active(x)) throw bad('That person is not in ATLAS.');
        if (isGuardian(x)) throw bad('Parents and guardians do not use ATLAS Documents.');
      }
      if (type === 'department' && !depts.has(id)) throw bad(`There is no department called “${id}”.`);
      if (type === 'role' && (!ROLES[id] || id === 'guardian')) throw bad('Choose an account type.');
      const level = LEVELS.includes(g.level) ? g.level : 'view';
      if (RANK[level] > RANK[a.level]) throw bad('You cannot give more access than you have.');
      const until = g.until && !Number.isNaN(Date.parse(g.until)) ? new Date(g.until).toISOString() : null;
      out.push({ type, id, level, download: g.download !== false, share: level === 'manage' || Boolean(g.share), by: u.id, at: now(), until });
    }
    return out;
  }
  const summary = (acl) => acl.map((g) => `${grantLabel(g)}: ${g.level}${g.download ? '' : ' (no download)'}`).join('; ') || 'No one besides the owner';
  const cleanTags = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((t) => text(t, 40)).filter(Boolean))].slice(0, 20);

  // ----- Links outside the school -----
  // A download link's limit counts every time a file goes out through it: shown in the browser or
  // downloaded (a file shown in the browser has reached the person as much as a download has).
  const linkUses = (l) => (l.downloads || 0) + (l.views || 0);
  // Whether a link works now; every rule is checked again on every use.
  function linkState(l) {
    const s = settings();
    if (l.revokedAt) return { state: 'revoked' };
    if (l.expiresAt && Date.parse(l.expiresAt) < clock()) return { state: 'expired' };
    if (!s.links || (l.mode === 'upload' && !s.uploadLinks)) return { state: 'off' };
    const creator = userById(l.createdBy);
    if (!active(creator) || isStudent(creator) || isGuardian(creator)) return { state: 'creator' };
    if (s.linkCreators === 'managers' && !manager(creator)) return { state: 'creator' };
    const item = l.target.kind === 'document' ? docById(l.target.id) : folderById(l.target.id);
    if (!item || inTrash(item, l.target.kind)) return { state: 'gone' };
    const a = accessOf(creator, item, l.target.kind);
    if (!a.share || (l.mode === 'download' && !a.download) || (l.mode === 'upload' && !atLeast(a.level, 'edit'))) return { state: 'creator' };
    if (l.target.kind === 'document' && !s.linkClassifications.includes(item.classification)) return { state: 'classification' };
    // The password rules hold on every use, not only when the link is made: a link without a
    // password stops when Document control starts asking for one on every link, or when its document
    // becomes confidential. (A folder link without one leaves the confidential documents out.)
    if (!l.passwordHash && (s.linkPasswordRequired || (l.target.kind === 'document' && item.classification === 'confidential'))) return { state: 'password' };
    if (l.mode === 'download' && l.maxDownloads && linkUses(l) >= l.maxDownloads) return { state: 'used' };
    return { state: 'active', item, creator };
  }
  route('POST', '/api/docs/links', 'documents', ({ body, user: u, origin }) => {
    const s = settings();
    if (isStudent(u)) throw bad('Students cannot make links for people outside the school. Share the file with a teacher or classmate instead.');
    if (!s.links) throw bad('Links for people outside the school are turned off in Document control.');
    if (s.linkCreators === 'managers' && !manager(u)) throw bad('Only document managers make links for people outside the school.');
    const kind = body.target?.kind === 'folder' ? 'folder' : 'document';
    const mode = LINK_MODES.includes(body.mode) ? body.mode : 'download';
    const found = kind === 'document' ? needDoc(u, body.target?.id, 'view') : needFolder(u, body.target?.id, 'view');
    const item = kind === 'document' ? found.d : found.f;
    const { a } = found;
    if (!a.share) throw bad('You can see this but not share it. Ask the person who manages it.');
    if (mode === 'upload' && (kind !== 'folder' || !s.uploadLinks)) throw bad(kind !== 'folder' ? 'Upload links are made for folders.' : 'Upload links are turned off in Document control.');
    if (mode === 'upload' && !atLeast(a.level, 'edit')) throw bad('You need edit access to the folder to collect files into it.');
    if (mode === 'download' && !a.download) throw bad('You cannot download this, so you cannot share it for download.');
    if (kind === 'document' && !s.linkClassifications.includes(item.classification)) throw bad(item.classification === 'restricted' ? 'Restricted documents are never shared by link.' : `${item.classification[0].toUpperCase()}${item.classification.slice(1)} documents are not shared by link here (Document control).`);
    if (kind === 'folder' && item.kind === 'personal' && !item.parentId) throw bad('My files as a whole cannot be shared. Share a folder inside it, or a document.');
    const password = typeof body.password === 'string' ? body.password : '';
    const needsPassword = s.linkPasswordRequired || (kind === 'document' && item.classification === 'confidential');
    if (needsPassword && !password) throw bad(s.linkPasswordRequired ? 'Links need a password (Document control).' : 'Links to confidential documents need a password.');
    if (password && password.length < s.linkPasswordMin) throw bad(`The link password needs at least ${s.linkPasswordMin} characters.`);
    if (password.length > 200) throw bad('The link password is too long.');
    const days = Number(body.days ?? s.linkDefaultDays);
    if (!Number.isFinite(days) || days < 1 || days > s.linkMaxDays) throw bad(`A link lasts 1 to ${s.linkMaxDays} days.`);
    const token = newToken();
    const l = {
      id: randomUUID(), tokenHash: tokenHash(token), hint: token.slice(-4), target: { kind, id: item.id }, mode, passwordHash: password ? hashLinkPassword(password) : null,
      linkVersion: 1, expiresAt: new Date(clock() + Math.round(days) * 86400000).toISOString(), maxDownloads: mode === 'download' ? Math.max(0, Math.min(100000, Math.round(Number(body.maxDownloads ?? s.linkMaxDownloads) || 0))) : 0,
      downloads: 0, views: 0, uploads: 0, opens: 0, note: text(body.note, 200), createdBy: u.id, createdAt: now(), revokedAt: null, revokedBy: null, lastAccessAt: null,
    };
    D.docLinks.push(l);
    event('link', { ...(kind === 'document' ? { doc: item } : { folder: item }), link: l, by: u.id, note: `${mode} link, ${Math.round(days)} days${l.passwordHash ? ', password' : ''}${l.maxDownloads ? `, ${l.maxDownloads} downloads` : ''}` });
    db.save();
    return { link: linkOut(l), url: `${origin || ''}/share/${token}` };
  });
  route('DELETE', '/api/docs/links/:id', 'documents', ({ params, user: u }) => {
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
    event('unlink', { link: l, by: byId, note: `Link …${l.hint}` });
  }
  route('GET', '/api/docs/links', 'documents', ({ user: u }) => ({ links: D.docLinks.filter((l) => l.createdBy === u.id && !l.revokedAt).map(linkOut) }));

  // ----- The public side of a link: /share/<token> -----
  const linkFor = (token) => (looksLikeToken(token) ? D.docLinks.find((l) => l.tokenHash === tokenHash(token)) || null : null);
  function openLink(token, cookies, ip, { unlocked = true } = {}) {
    limits?.hit('shareAccess', ip || 'unknown', 'Too many requests from your network.');
    const l = linkFor(token);
    if (l) limits?.hit('shareLink', l.id, 'This link is being opened too often.');
    const st = l ? linkState(l) : { state: 'missing' };
    if (!l || st.state !== 'active') throw new HttpError(404, UNAVAILABLE);
    const ok = !l.passwordHash || checkUnlock(cookieKey, l, cookies?.[cookieName(l.id)]);
    if (unlocked && !ok) throw new HttpError(401, 'This link needs its password.');
    return { l, ...st, unlockedNow: ok };
  }
  // The documents a link serves. A folder link serves the documents in the folder that may go out by
  // link; without a password, never the confidential ones.
  const linkDocs = (l, item) => (l.target.kind === 'document' ? [item] : D.documents.filter((d) => d.folderId === item.id && !d.trashedAt && settings().linkClassifications.includes(d.classification) && (l.passwordHash || d.classification !== 'confidential')));
  // The first open of a view or download link is on the maker's bell. An upload link says nothing
  // here: each file that arrives through it has its own bell item ("A file arrived in …").
  function touch(l, field, ip, note) {
    l[field] = (l[field] || 0) + 1;
    const first = !l.lastAccessAt;
    l.lastAccessAt = now();
    event(`link-${field}`, { link: l, by: `link:${l.id}`, ip, note });
    if (first && l.mode !== 'upload') notice(l.createdBy, 'Your link was opened for the first time', note, l.target.kind === 'document' ? `#/doc/${l.target.id}` : `#/folder/${l.target.id}`);
  }
  route('GET', '/api/public/share/:token', 'public', ({ params, cookies, ip }) => {
    const { l, item, unlockedNow } = openLink(params.token, cookies, ip, { unlocked: false });
    const s = settings();
    const base = { mode: l.mode, kind: l.target.kind, needsPassword: Boolean(l.passwordHash) && !unlockedNow, expiresAt: l.expiresAt, school: D.settings?.schoolName || '' };
    if (base.needsPassword) return base;
    if (l.mode === 'upload') return { ...base, folder: item.name, note: l.note, maxUploadMB: s.maxUploadMB, chunkBytes: DOCS_CHUNK_BYTES, families: FAMILIES.filter((f) => s.families.includes(f.id)).map((f) => ({ label: f.label, exts: f.exts })) };
    const docs = linkDocs(l, item).map((d) => {
      const v = current(d);
      return { id: d.id, title: d.title, name: v.name, ext: v.ext, size: v.size, updatedAt: d.updatedAt, inline: isInline(v.ext) };
    });
    touch(l, 'opens', ip, `${l.target.kind === 'document' ? item.title : item.name} opened through a link`);
    db.save();
    return { ...base, name: l.target.kind === 'document' ? item.title : item.name, note: l.note, documents: docs, downloadsLeft: l.mode === 'download' && l.maxDownloads ? Math.max(0, l.maxDownloads - linkUses(l)) : null };
  });
  // Wrong passwords are counted in memory: the link's activity gets at most one entry per link every
  // WRONG_PASSWORD_LOG_MS (with how many came since the last), kept with the next save of the data.
  const wrongTries = new Map(); // link id → { at, n }
  function wrongPassword(l, ip) {
    const w = wrongTries.get(l.id);
    if (w && clock() - w.at < WRONG_PASSWORD_LOG_MS) {
      w.n++;
      return;
    }
    if (wrongTries.size > 5000) wrongTries.clear();
    wrongTries.set(l.id, { at: clock(), n: 0 });
    event('link-password-wrong', { link: l, by: `link:${l.id}`, ip, note: w?.n ? `${w.n} more wrong ${w.n === 1 ? 'password' : 'passwords'} since the last entry` : '' });
  }
  route('POST', '/api/public/share/:token/unlock', 'public', ({ params, body, cookies, ip }) => {
    const { l } = openLink(params.token, cookies, ip, { unlocked: false });
    if (!l.passwordHash) return { ok: true };
    // The limits (per address, per link, and wrong passwords per address and link) all apply before
    // the password is checked.
    const key = `${ip}|${l.id}`;
    limits?.check('sharePasswordFail', key, 'Too many wrong passwords.');
    if (!checkLinkPassword(body.password, l.passwordHash)) {
      limits?.add('sharePasswordFail', key);
      wrongPassword(l, ip);
      throw bad('That password is not right.');
    }
    return { data: { ok: true }, headers: { 'Set-Cookie': `${cookieName(l.id)}=${unlockValue(cookieKey, l)}; Path=/api/public/share/${params.token}; HttpOnly; SameSite=Strict; Max-Age=${12 * 3600}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}` } };
  });
  route('GET', '/api/public/share/:token/file', 'public', ({ params, query, cookies, ip }) => {
    const { l, item } = openLink(params.token, cookies, ip);
    if (l.mode === 'upload') throw new HttpError(404, UNAVAILABLE);
    const d = linkDocs(l, item).find((x) => x.id === String(query.doc || item.id));
    if (!d) throw new HttpError(404, UNAVAILABLE);
    const v = current(d);
    const inline = query.inline === '1' && isInline(v.ext);
    // A view-only link gives no download, but what it shows in the browser does reach the browser:
    // it keeps honest people to viewing, it does not stop a copy being kept.
    if (l.mode === 'view' && !inline) throw new HttpError(403, 'This link lets you view the document, not download it.');
    if (l.mode === 'download' && l.maxDownloads && linkUses(l) >= l.maxDownloads) throw new HttpError(404, UNAVAILABLE);
    const data = readBlob(v);
    touch(l, inline ? 'views' : 'downloads', ip, `${d.number} ${d.title}, version ${v.no}`);
    db.save();
    return fileResponse(v, data, inline);
  });
  // Upload links: files from outside go into the folder as "received, not reviewed", owned by the
  // person who made the link, with every check an upload from inside gets.
  route('POST', '/api/public/share/:token/uploads', 'public', ({ params, body, cookies, ip }) => {
    const { l } = openLink(params.token, cookies, ip);
    if (l.mode !== 'upload') throw new HttpError(404, UNAVAILABLE);
    limits?.hit('shareUpload', ip || 'unknown', 'Too many files sent from your network.');
    return startUpload(`link:${l.id}`, text(body.name, 200) || 'file', Number(body.size));
  });
  route('PUT', '/api/public/share/:token/uploads/:id', 'public', ({ params, body, cookies, ip }) => {
    const { l } = openLink(params.token, cookies, ip);
    if (l.mode !== 'upload') throw new HttpError(404, UNAVAILABLE);
    return putPiece(`link:${l.id}`, params.id, body);
  });
  route('DELETE', '/api/public/share/:token/uploads/:id', 'public', ({ params, cookies, ip }) => {
    const { l } = openLink(params.token, cookies, ip);
    const x = uploads.get(String(params.id || ''));
    if (x && x.owner === `link:${l.id}`) dropUpload(x);
    return { ok: true };
  });
  route('POST', '/api/public/share/:token/uploads/:id/finish', 'public', ({ params, body, cookies, ip }) => {
    const { l, item, creator } = openLink(params.token, cookies, ip);
    if (l.mode !== 'upload') throw new HttpError(404, UNAVAILABLE);
    const { name, buf } = takeUpload(`link:${l.id}`, params.id);
    const c = vet(buf, name, `link:${l.id}`, creator.id);
    const sender = text(body.name, 100);
    const d = newDoc({
      folderId: item.id, title: c.name.replace(/\.[^.]+$/, ''), description: longText(body.message, 2000), ownerId: creator.id,
      source: 'link-upload', sender: { name: sender, email: text(body.email, 160) }, reviewed: false,
    });
    addVersion(d, buf, c, `link:${l.id}`, `Sent through a link${sender ? ` by ${sender}` : ''}`);
    D.documents.push(d);
    event('upload', { doc: d, by: `link:${l.id}`, ip, note: `${c.name} into ${item.name} through link …${l.hint}${sender ? `, from ${sender}` : ''}` });
    touch(l, 'uploads', ip, `${c.name}${sender ? ` from ${sender}` : ''}`);
    notice(creator.id, `A file arrived in ${item.name}`, `${c.name}${sender ? ` from ${sender}` : ''}. Review it before sharing it further.`, `#/doc/${d.id}`);
    db.save();
    return { ok: true, name: c.name };
  });

  // ----- Document control (docs.manage): Admin panel → Document control -----
  route('GET', '/api/docs/settings', 'documents:docs.manage', () => ({ settings: settings(), defaults: DEFAULT_SETTINGS, families: FAMILIES, blocked: { exts: BLOCKED_EXTS, label: BLOCKED_LABEL }, classifications: CLASSIFICATIONS, maxUploadMB: MAX_UPLOAD_MB }));
  // Changes are recorded in the Settings center's history (server/config.js, area "documents").
  route('PUT', '/api/docs/settings', 'documents:docs.manage', ({ body }) => {
    D.docSettings = cleanSettings({ ...settings(), ...(body.settings && typeof body.settings === 'object' ? body.settings : {}) });
    db.save();
    return { settings: D.docSettings };
  });
  route('GET', '/api/docs/admin', 'documents:docs.manage', () => {
    const usage = blobs.usage();
    const links = D.docLinks.filter((l) => !l.revokedAt).map(linkOut).filter((l) => l.state === 'active' || l.state === 'used');
    const live = D.documents.filter((d) => !d.trashedAt);
    return {
      usage, documents: live.length, trashed: D.documents.length - live.length, folders: D.docFolders.filter((f) => !f.trashedAt).length,
      versions: D.documents.reduce((n, d) => n + d.versions.length, 0), held: D.documents.filter((d) => d.legalHold).length, unreviewed: live.filter((d) => d.reviewed === false).length,
      people: new Set(D.documents.map((d) => d.ownerId)).size,
      links, refused: [...D.docRefused].reverse().slice(0, 100).map((r) => ({ ...r, byName: nameOf(r.by) })), integrity: D.docIntegrity ? { ...D.docIntegrity, byName: nameOf(D.docIntegrity.by) } : null,
    };
  });
  route('POST', '/api/docs/admin/integrity', 'documents:docs.manage', ({ user: u }) => {
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
          problems.push({ document: `${d.number} ${d.title}`, documentId: d.id, version: v.no, problem: err.message });
        }
      }
    }
    const orphans = blobs.orphans(known);
    D.docIntegrity = { at: now(), by: u.id, checked, problems: problems.slice(0, 200), orphans: orphans.length };
    db.save();
    return { ...D.docIntegrity, byName: nameOf(u.id) };
  });
  route('POST', '/api/docs/admin/links/revoke-all', 'documents:docs.manage', ({ user: u }) => {
    let n = 0;
    for (const l of D.docLinks) if (!l.revokedAt) (revoke(l, u.id), n++);
    db.save();
    return { revoked: n };
  });
  route('DELETE', '/api/docs/admin/links/:id', 'documents:docs.manage', ({ params, user: u }) => {
    const l = D.docLinks.find((x) => x.id === params.id && !x.revokedAt);
    if (!l) throw missing();
    revoke(l, u.id);
    db.save();
    return { ok: true };
  });

  // ----- Housekeeping: trash past its days, finished check-outs, idle uploads -----
  function sweep() {
    ensure();
    const s = settings();
    const cutoff = clock() - s.trashDays * 86400000;
    let changed = false;
    for (const d of [...D.documents]) if (d.trashedAt && Date.parse(d.trashedAt) < cutoff && !held(d, 'document')) (purgeDoc(d, null), (changed = true));
    for (const f of [...D.docFolders]) {
      // A folder with anything on legal hold in it, or under a held folder, stays whole.
      if (!f.trashedAt || Date.parse(f.trashedAt) >= cutoff || !folderById(f.id) || held(f, 'folder') || holdBelow(f)) continue;
      const inside = new Set(D.docFolders.filter((x) => chain(folderMap(), x.id).some((y) => y.id === f.id)).map((x) => x.id));
      for (const d of [...D.documents]) if (inside.has(d.folderId) && !held(d, 'document')) purgeDoc(d, null);
      if (!D.documents.some((d) => inside.has(d.folderId))) D.docFolders = D.docFolders.filter((x) => !inside.has(x.id));
      changed = true;
    }
    for (const d of D.documents) if (d.checkout && Date.parse(d.checkout.until) < clock()) (d.checkout = null), (changed = true);
    for (const x of [...uploads.values()]) if (clock() - x.usedAt > UPLOAD_IDLE_MS) dropUpload(x);
    if (changed) db.save();
  }
  const timer = setInterval(sweep, 60 * 60000);
  timer.unref?.();

  // ----- Demo data (Admin panel → Demo data & backup): a few folders and files for the demo school -----
  function addDemo({ pdf, docx } = {}) {
    ensure();
    if (D.documents.some((d) => d.demo)) return;
    const by = (username) => D.users.find((x) => x.username === username && x.demo);
    const registrar = by('registrar.demo');
    const maria = by('teacher.demo');
    const juan = by('jdelacruz.demo');
    const carlo = by('student.demo');
    if (!registrar || !maria || !carlo) return;
    const folder = (name, owner, parentId = null, acl = []) => {
      const f = { id: randomUUID(), parentId, name, kind: 'shared', ownerId: owner.id, acl, inherit: true, createdAt: now(), createdBy: owner.id, trashedAt: null, legalHold: false, demo: true };
      D.docFolders.push(f);
      return f;
    };
    const grant = (type, id, level, extra = {}) => ({ type, id, level, download: true, share: level === 'manage', by: registrar.id, at: now(), until: null, ...extra });
    const file = (f, owner, name, buf, fields = {}) => {
      const c = checkFile(buf, name, DEFAULT_SETTINGS.families);
      if (!c.ok) return null;
      const d = newDoc({ folderId: f.id, title: name.replace(/\.[^.]+$/, ''), ownerId: owner.id, demo: true, ...fields });
      addVersion(d, buf, c, owner.id, 'First version');
      D.documents.push(d);
      event('upload', { doc: d, by: owner.id, note: `${c.name} into ${f.name}` });
      return d;
    };
    const policies = folder('School policies', registrar, null, [grant('everyone', '*', 'view')]);
    file(policies, registrar, 'Student handbook 2026.pdf', pdf('Student handbook 2026', ['Attendance: be in class on time; three absences are reported to your adviser.', 'Grading: final grades are percentages; 75 passes.', 'Conduct: be honest in your work and kind to others.']), { classification: 'public', status: 'final', tags: ['handbook', 'policy'] });
    file(policies, registrar, 'Data privacy notice.pdf', pdf('Data privacy notice', ['The school keeps your records under the Data Privacy Act of 2012 (RA 10173).', 'Ask the registrar to see or correct your records.']), { classification: 'public', status: 'final', tags: ['policy', 'privacy'] });
    const registrarFiles = folder("Registrar's Office", registrar, null, [grant('department', "Registrar's Office", 'edit')]);
    file(registrarFiles, registrar, 'Enrollment checklist.txt', Buffer.from('Enrollment checklist\n\n1. Form 138 or transcript of records\n2. Certificate of good moral character\n3. PSA birth certificate\n4. Two 2x2 pictures\n'), { tags: ['enrollment'] });
    file(registrarFiles, registrar, 'Graduation candidates 2026.csv', Buffer.from('Student no.,Name,Program,Units earned\nDEMO-0101,Bea Mendoza,BSIT,142\nDEMO-0102,Paolo Garcia,BSIT,139\n'), { classification: 'confidential', tags: ['graduation'] });
    const received = folder('Enrollment documents (received)', registrar, registrarFiles.id);
    file(received, registrar, 'Form 138 - Lea Fernandez.pdf', pdf('Form 138 (report card)', ['Learner: Lea Fernandez', 'Grade 12, STEM', 'General average: 91']), { source: 'link-upload', reviewed: false, sender: { name: 'Lea Fernandez', email: 'lea.fernandez@example.com' }, description: 'My report card for enrollment. Thank you!' });
    const computing = folder('College of Computing', maria, null, [grant('department', 'College of Computing', 'edit')]);
    const outline = file(computing, maria, 'IT 101 course outline.docx', docx(['IT 101 Introduction to Computing', 'Course outline, first semester', 'Week 1: computers and society', 'Week 2: number systems', 'Grading: assignments 30%, quizzes 40%, examination 30%']), { status: 'final', tags: ['IT 101', 'syllabus'] });
    file(computing, maria, 'Laboratory schedule.csv', Buffer.from('Room,Monday,Wednesday,Friday\nLab 1,IT 101 A,IT 101 A,Open lab\nLab 2,CS 201 A,CS 201 A,Open lab\n'), { tags: ['laboratory'] });
    const mariaRoot = personalRoot(maria);
    const plans = folder('Class materials', maria, mariaRoot.id);
    const plan = file(plans, maria, 'Lesson plan week 5.docx', docx(['Lesson plan, week 5', 'Topic: algorithms and flowcharts', 'Activity: draw the flowchart of a rice cooker']), { tags: ['lesson plan'] });
    if (plan && juan) plan.acl = [grant('user', juan.id, 'edit', { by: maria.id })];
    const reading = file(plans, maria, 'Reading list IT 101.pdf', pdf('IT 101 reading list', ['Chapter 1: what a computer is', 'Chapter 2: how numbers are stored', 'Chapter 3: algorithms']), { classification: 'public', tags: ['IT 101'] });
    if (reading) reading.acl = [grant('user', carlo.id, 'view', { by: maria.id })];
    file({ id: mariaRoot.id, name: 'My files' }, maria, 'Quiz bank - number systems.txt', Buffer.from('Quiz bank: number systems\n\n1. Convert 1011 (binary) to decimal.\n2. Convert 25 to binary.\n3. What is a byte?\n'), { classification: 'confidential', tags: ['quiz'] });
    const carloRoot = personalRoot(carlo);
    const proposal = file({ id: carloRoot.id, name: 'My files' }, carlo, 'Capstone proposal draft.docx', docx(['Capstone proposal (draft)', 'Title: an attendance app for barangay schools', 'Adviser: Maria Santos']), { tags: ['capstone'] });
    if (proposal) proposal.acl = [grant('user', maria.id, 'view', { by: carlo.id, download: true })];
    file({ id: carloRoot.id, name: 'My files' }, carlo, 'Notes IT 101.txt', Buffer.from('IT 101 notes\n\nA bit is a 0 or a 1. Eight bits make a byte.\n'), {});
    // Two links for people outside (their addresses were never shown: they are examples), and a refusal.
    const link = (target, owner, mode, extra) => D.docLinks.push({
      id: randomUUID(), tokenHash: tokenHash(newToken()), hint: newToken().slice(-4), target, mode, passwordHash: null, linkVersion: 1, expiresAt: new Date(clock() + 14 * 86400000).toISOString(),
      maxDownloads: 0, downloads: 0, views: 0, uploads: 0, opens: 0, note: '', createdBy: owner.id, createdAt: now(), revokedAt: null, revokedBy: null, lastAccessAt: null, demo: true, ...extra,
    });
    if (outline) link({ kind: 'document', id: outline.id }, maria, 'download', { passwordHash: hashLinkPassword(randomUUID()), maxDownloads: 20, downloads: 3, opens: 4, note: 'Course outline for the accreditation visit', lastAccessAt: now() });
    link({ kind: 'folder', id: received.id }, registrar, 'upload', { uploads: 1, opens: 2, note: 'Send your Form 138 and birth certificate.', lastAccessAt: now() });
    D.docRefused.push({ at: now(), name: 'Grade computation.xlsm', by: carlo.id, code: 'blocked', reason: atlas(checkFile(Buffer.from('x'), 'Grade computation.xlsm').reason), demo: true });
    db.save();
  }
  function removeDemo() {
    ensure();
    const demoUsers = new Set(D.users.filter((u) => u.demo).map((u) => u.id));
    const gone = new Set(D.docFolders.filter((f) => f.demo || (demoUsers.has(f.ownerId) && f.kind === 'personal')).map((f) => f.id));
    for (const f of D.docFolders) if (chain(folderMap(), f.id).some((x) => gone.has(x.id))) gone.add(f.id);
    for (const d of D.documents.filter((x) => x.demo || gone.has(x.folderId))) {
      for (const v of d.versions) blobs.remove(v.blobId);
      loadIndex().delete(d.id);
    }
    const docs = new Set(D.documents.filter((x) => x.demo || gone.has(x.folderId)).map((d) => d.id));
    D.documents = D.documents.filter((d) => !docs.has(d.id));
    D.docFolders = D.docFolders.filter((f) => !gone.has(f.id));
    D.docLinks = D.docLinks.filter((l) => !l.demo && !docs.has(l.target.id) && !gone.has(l.target.id) && !demoUsers.has(l.createdBy));
    D.docRefused = D.docRefused.filter((r) => !r.demo);
    D.docEvents = D.docEvents.filter((e) => !docs.has(e.docId) && !gone.has(e.folderId));
    D.docNotices = D.docNotices.filter((n) => !demoUsers.has(n.userId));
    for (const x of [...D.documents, ...D.docFolders]) if (x.acl?.length) x.acl = x.acl.filter((g) => !(g.type === 'user' && demoUsers.has(g.id)));
    saveIndex();
  }

  // For the web server, before it reads a body: may this address send a large upload piece? Only
  // for an upload link that works now; anything else gets the small signed-out limit.
  const uploadLinkOpen = (token) => {
    const l = linkFor(token);
    return Boolean(l && l.mode === 'upload' && linkState(l).state === 'active');
  };
  // The figures on the Documents card of the ATLAS home (server/api.js figuresFor, cached a minute per
  // person): from the person's own work, in one pass over the documents. What waits for them comes
  // first: files received through their upload links and not reviewed, files checked out to them;
  // then the documents named people shared with them this week; with none of these, how many
  // documents they own.
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  function figures(u) {
    const t = clock();
    let received = 0;
    let checkedOut = 0;
    let shared = 0;
    let own = 0;
    for (const d of D.documents) {
      if (d.trashedAt) continue;
      if (d.ownerId === u.id) {
        own++;
        if (d.reviewed === false) received++;
      }
      if (d.checkout?.userId === u.id && Date.parse(d.checkout.until) > t) checkedOut++;
      else if (d.ownerId !== u.id && (d.acl || []).some((g) => g.type === 'user' && g.id === u.id && t - Date.parse(g.at) < WEEK_MS && (!g.until || Date.parse(g.until) > t))) shared++;
    }
    const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
    const out = [];
    if (received) out.push(`${n(received, 'file')} received, not reviewed`);
    if (checkedOut) out.push(`${n(checkedOut, 'file')} checked out to you`);
    if (shared) out.push(`${n(shared, 'document')} shared with you this week`);
    if (!out.length) out.push(own ? `${n(own, 'document')} you own` : 'No documents of yours yet');
    return out;
  }
  return { sweep, blobs, uploads, settings, addDemo, removeDemo, uploadLinkOpen, figures, flushIndex: () => indexTimer && writeIndex(), dir: docDir };
}
