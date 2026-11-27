// Document circulation: every downloadable form and file the systems give their people, kept in one
// place (Admin panel → System → Document circulation, and ATLAS Tools; public/js/system/forms.js),
// and handed out on each system's "Forms & downloads" page (public/js/forms.js). shared/forms.js has
// the modules, permissions and settings.
//
//  - A form: title, module, category, description, its form code / revision label (as an ISO-controlled
//    school numbers its forms), who it is for (account types, and optionally anyone signed out:
//    public), and a status: draft, published or retired. Each upload is a new version, recording the
//    file (name, size and type, the type from its bytes: server/dms/types.js), who uploaded it, when,
//    and a short note. Restoring an earlier version makes a new version that copies it, so the history
//    is never rewritten. Retiring hides a form from users and keeps it, with its versions. Only a
//    draft that was never published may be deleted.
//  - The files never sit in db.json: each version is a blob encrypted at rest with ATLAS Documents'
//    store (server/dms/blobs.js) under a key of its own derived from the server key (server/secrets.js),
//    in data/forms. Pieces of an upload are kept in memory until the file is whole, never on disk
//    unencrypted.
//  - Who manages: administrators and forms.manage every module; forms.<module> one module (the
//    registrar Academic's and Learn's, the HR Manager People's, the Chief Accountant Finance's, by
//    default). A manager sees only the modules they may manage; anything else answers 404.
//  - Users see only the current published version of the forms for their account type (or public),
//    never earlier versions; managers download those in the tool. Public forms can be listed and
//    downloaded signed out, with a rate limit per address. Every file goes out as an attachment with
//    nosniff and a sandbox; there is no listing of the stored files.
//  - Everything is in the audit log: uploads (started, cancelled, refused), restores, detail changes,
//    publishing, retiring, deletes (and refused ones), managers' downloads of versions, users'
//    downloads, public downloads (counted per form and hour), a manager reaching for another module's
//    form, and the settings.
//  - A restore is checked like an upload, against today's settings. Downloads running at once are
//    capped (server/download-gate.js), as each holds its whole file in memory until it is sent.
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { userCan, ROLES, roleLabel } from '../shared/roles.js';
import { createBlobStore, BlobError } from './dms/blobs.js';
import { checkFile, cleanName, extOf, contentDisposition, BLOCKED_EXTS, BLOCKED_LABEL, FAMILY } from './dms/types.js';
import {
  FORM_MODULES, FORM_MODULE_IDS, formModule, formModuleName, managedModules, FORMS_ALL, LIMITS, FORM_FAMILIES,
  mergeFormSettings, statusLabel, MAX_UPLOAD_RANGE,
} from '../shared/forms.js';

const MB = 1024 * 1024;
export const FORMS_CHUNK_BYTES = 4 * MB; // a piece of an upload (about 5.4 MB as base64, under the signed-in body limit)
const UPLOAD_IDLE_MS = 5 * 60000; // an upload no accepted piece reached in this time is dropped
const UPLOAD_LIFE_MS = 30 * 60000; // and every upload after this, however active
const MAX_UPLOADS_EACH = 3;
const MAX_UPLOADS_ALL = 24;
const MAX_IN_FLIGHT = 320 * MB; // every unfinished upload together, in memory
const MAX_IN_FLIGHT_EACH = Math.floor(MAX_IN_FLIGHT / 3); // one person's share of it (a 100 MB file fits)
const PUBLIC_TALLY_MS = 60 * 60000; // public downloads go to the audit log as one entry per form per hour
const BLOCKED = new Set(BLOCKED_EXTS);
const NOT_FOUND = 'That form is not there, or you do not have access to it.';

const bad = (msg) => new HttpError(400, msg);
const missing = () => new HttpError(404, NOT_FOUND);
const clean = (v, max) => (v == null || typeof v === 'object' ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const longText = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '');
// The engine's messages name CORE and Document control; here they name ATLAS and this screen's settings.
const atlas = (s) => String(s).replace(/\bCORE\b/g, 'ATLAS').replace(/web pages and svg, and office files/, 'web pages and SVG, and Office files')
  .replace(/ An administrator can allow them in Document control\./, ' An administrator can allow them in the Document circulation settings.');
// A stored file as a download: always an attachment, never sniffed, never run, never cached.
// release: gives back the download's place (server/download-gate.js) once the answer is sent.
const fileResponse = (v, data, release) => ({
  raw: data,
  type: v.mime,
  release,
  headers: {
    'Content-Disposition': contentDisposition('attachment', v.name),
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'X-Content-Type-Options': 'nosniff', 'X-Download-Options': 'noopen', 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'same-origin',
  },
});

// options: secrets ({ derive }), dir (default: data/forms beside db.json; a temporary folder when the
// database is in memory), clock () => Date, audit(entry).
export function registerForms(route, ctx, { secrets, dir = null, clock = () => new Date(), audit = () => {} } = {}) {
  const db = ctx.db;
  const formsDir = dir || (db.dir ? path.join(db.dir, 'forms') : path.join(os.tmpdir(), `atlas-forms-${randomUUID()}`));
  const blobs = createBlobStore(formsDir, secrets.derive('forms.master-key'));
  // db.data is replaced when a backup is restored: always read the current one.
  const forms = () => (Array.isArray(db.data.forms) ? db.data.forms : (db.data.forms = []));
  const settings = () => mergeFormSettings(db.data.formSettings);
  const now = () => clock().toISOString();
  const branding = () => db.data.settings?.branding;
  const moduleName = (id) => formModuleName(id, branding());
  const userById = (id) => db.data.users.find((u) => u.id === id) || null;
  const nameOf = (id, fallback = '') => userById(id)?.name || fallback || 'Former user';
  const managed = (u) => (u && ROLES[u.role] && !ROLES[u.role].external ? managedModules(u.role, (p) => userCan(u, p)) : []);
  const mayManage = (u, moduleId) => managed(u).includes(moduleId);
  const current = (f) => f.versions.find((v) => v.no === f.currentVersion) || f.versions.at(-1) || null;
  const log = (a, action, f, detail = '', outcome = 'ok') => audit({
    kind: 'document', system: 'forms', action, actor: a.user || null, target: f ? { id: f.id, name: f.title } : null, ip: a.ip, agent: a.agent, outcome, detail: String(detail).slice(0, 400),
  });

  // ----- Who a form is for -----
  const audienceOf = (moduleId, list) => {
    const allowed = formModule(moduleId).audience;
    return [...new Set((Array.isArray(list) ? list : String(list || '').split(',')).map((x) => String(x).trim()).filter((r) => allowed.includes(r)))];
  };
  const visibleTo = (f, u) => f.status === 'published' && Boolean(current(f)) && (f.public || (u && f.audience.includes(u.role)));
  const audienceText = (f) => [f.public ? 'Public (signed out too)' : '', ...f.audience.map(roleLabel)].filter(Boolean).join(', ');

  // ----- What leaves the server -----
  const versionOut = (v) => ({ no: v.no, name: v.name, ext: v.ext, size: v.size, at: v.at, by: v.by, byName: nameOf(v.by, v.byName), note: v.note || '', restoredFrom: v.restoredFrom || null });
  const manageRow = (f) => {
    const cur = current(f);
    return {
      id: f.id, title: f.title, code: f.code || '', module: f.module, moduleName: moduleName(f.module), category: f.category || '', description: f.description || '',
      audience: f.audience, public: Boolean(f.public), audienceText: audienceText(f), status: f.status, statusLabel: statusLabel(f.status),
      current: cur ? versionOut(cur) : null,
      versions: f.versions.filter((v) => v !== cur).map(versionOut).reverse(), // earlier versions, newest first
      versionCount: f.versions.length, everPublished: Boolean(f.everPublished), deletable: f.status === 'draft' && !f.everPublished,
      createdAt: f.createdAt, updatedAt: f.updatedAt, updatedByName: nameOf(f.updatedBy), demo: Boolean(f.demo),
    };
  };
  const userRow = (f) => {
    const cur = current(f);
    return {
      id: f.id, title: f.title, code: f.code || '', module: f.module, moduleName: moduleName(f.module), category: f.category || 'Other forms', description: f.description || '',
      updatedAt: cur.at, name: cur.name, ext: cur.ext, size: cur.size, public: Boolean(f.public),
    };
  };
  const byCategory = (rows) => {
    const groups = new Map();
    for (const r of rows.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title, 'en', { numeric: true }))) {
      if (!groups.has(r.category)) groups.set(r.category, []);
      groups.get(r.category).push(r);
    }
    return [...groups].map(([name, list]) => ({ name, forms: list }));
  };
  // A form the manager keeps. A form of another module answers as if it were not there, and the
  // attempt is recorded.
  const formFor = (a, id) => {
    const f = forms().find((x) => x.id === String(id || ''));
    if (f && !mayManage(a.user, f.module)) log(a, 'Refused: a form of a module they do not keep', f, moduleName(f.module), 'refused');
    if (!f || !mayManage(a.user, f.module)) throw missing();
    return f;
  };

  // ----- Uploads in pieces: start, pieces, finish (kept in memory until whole) -----
  // An upload is kept while accepted pieces arrive (at most UPLOAD_LIFE_MS in all); abandoned ones are
  // dropped by a timer as well as by every upload request, so their memory does not wait for the next.
  const uploads = new Map();
  const inFlight = (owner = null) => [...uploads.values()].filter((x) => !owner || x.owner === owner).reduce((n, x) => n + x.size, 0);
  const sweep = () => {
    const t = clock().getTime();
    for (const x of [...uploads.values()]) if (t - x.usedAt > UPLOAD_IDLE_MS || t - x.startedAt > UPLOAD_LIFE_MS) uploads.delete(x.id);
  };
  setInterval(sweep, 60000).unref?.();
  const tooBig = (name, s) => `${name} is larger than ${s.maxUploadMB} MB, the most a form may be. Make the file smaller (save it as PDF, or with smaller pictures), or ask an administrator.`;
  const managerOnly = (u) => {
    if (!managed(u).length) throw new HttpError(403, 'Document circulation is for the people who keep the school\'s forms. Ask an administrator.');
  };
  // Every route that manages: no entry of its own in the audit trail (each records a clearer one).
  const manage = (method, pattern, handler, opts = {}) => route(method, pattern, 'me', (a) => {
    managerOnly(a.user);
    return handler(a);
  }, { audit: false, ...opts });

  const busy = (message) => Object.assign(new HttpError(429, message), { headers: { 'Retry-After': '60' } });
  manage('POST', '/api/forms/manage/uploads', (a) => {
    const { user, body } = a;
    const s = settings();
    const name = cleanName(clean(body.name, 200) || 'file');
    const size = Number(body.size);
    if (!Number.isInteger(size) || size <= 0) throw bad(`${name} is empty.`);
    if (size > s.maxUploadMB * MB) throw bad(tooBig(name, s));
    if (BLOCKED.has(extOf(name))) throw bad(`.${extOf(name)} files are never accepted (${BLOCKED_LABEL.charAt(0).toLowerCase()}${BLOCKED_LABEL.slice(1)}).`);
    sweep();
    const mine = [...uploads.values()].filter((x) => x.owner === user.id);
    if (mine.length >= MAX_UPLOADS_EACH) throw busy(`You have ${mine.length} files being uploaded already. Wait for them to finish, then add more.`);
    if (mine.length && inFlight(user.id) + size > MAX_IN_FLIGHT_EACH) throw busy('Your files being uploaded are as large as one person may send at once. Wait for them to finish, then add this one.');
    if (uploads.size >= MAX_UPLOADS_ALL || inFlight() + size > MAX_IN_FLIGHT) throw busy('Many large files are being uploaded right now. Try again in a minute.');
    const t = clock().getTime();
    const x = { id: randomUUID(), owner: user.id, name, size, pieces: [], received: 0, startedAt: t, usedAt: t };
    uploads.set(x.id, x);
    log(a, 'Upload started', null, `${name} (${Math.max(1, Math.round(size / 1024))} KB)`);
    return { id: x.id, chunkBytes: FORMS_CHUNK_BYTES };
  });
  manage('PUT', '/api/forms/manage/uploads/:id', ({ user, params, body }) => {
    sweep();
    const x = uploads.get(String(params.id || ''));
    if (!x || x.owner !== user.id) throw new HttpError(404, 'That upload is no longer on the server. Add the file again.');
    const offset = Number(body.offset);
    if (typeof body.data !== 'string' || !Number.isInteger(offset) || offset < 0) throw bad('Send a piece of the file.');
    const piece = Buffer.from(body.data, 'base64');
    if (!piece.length || piece.length > FORMS_CHUNK_BYTES) throw bad('Send the file in pieces of up to 4 MB.');
    if (offset + piece.length <= x.received) return { received: x.received }; // a piece sent again
    if (offset !== x.received) throw new HttpError(409, `The upload of ${x.name} lost its place. Add the file again.`);
    if (x.received + piece.length > x.size) throw bad(`${x.name} is larger than it said it was.`);
    x.pieces.push(piece);
    x.received += piece.length;
    x.usedAt = clock().getTime(); // only an accepted piece keeps the upload alive
    return { received: x.received };
  });
  manage('DELETE', '/api/forms/manage/uploads/:id', (a) => {
    sweep();
    const x = uploads.get(String(a.params.id || ''));
    if (x && x.owner === a.user.id) {
      uploads.delete(x.id);
      log(a, 'Upload cancelled', null, `${x.name} (${Math.round(x.received / 1024)} of ${Math.max(1, Math.round(x.size / 1024))} KB)`);
    }
    return { ok: true };
  });
  // The file is checked before anything is kept: its kind from its bytes, against the settings. A
  // restored version is checked the same way, against today's settings.
  function vet(a, buf, name, f = null, { action = 'Upload refused', prefix = '' } = {}) {
    const s = settings();
    const refuse = (reason) => {
      log(a, action, f, `${name}: ${reason}`, 'refused');
      throw bad(`${prefix}${reason}`);
    };
    if (buf.length > s.maxUploadMB * MB) refuse(tooBig(name, s));
    const c = checkFile(buf, name, s.families);
    if (!c.ok) refuse(atlas(c.reason));
    return c;
  }
  function addVersion(f, buf, c, by, note, extra = {}) {
    const { blobId, sha256, size } = blobs.put(buf);
    const no = f.versions.reduce((n, v) => Math.max(n, v.no), 0) + 1;
    const byUser = userById(by);
    f.versions.push({ no, blobId, sha256, name: c.name, ext: c.ext, family: c.family, mime: c.mime, size, by, byName: byUser?.name || '', at: now(), note: clean(note, LIMITS.note), ...extra });
    f.currentVersion = no;
    f.updatedAt = now();
    f.updatedBy = by;
    return f.versions.at(-1);
  }
  // The details a manager may set: title, module, category, description, code, who it is for.
  function details(a, input, f = null) {
    const out = {};
    const has = (k) => Object.hasOwn(input, k);
    if (!f || has('title')) {
      out.title = clean(input.title, LIMITS.title);
      if (!out.title) throw bad('Give the form a title.');
    }
    if (!f || has('module')) {
      const m = String(input.module || '');
      if (!FORM_MODULE_IDS.includes(m)) throw bad('Choose the module the form belongs to.');
      if (!mayManage(a.user, m)) throw new HttpError(403, `You do not keep the forms of ${moduleName(m)}.`);
      out.module = m;
    }
    const moduleId = out.module || f.module;
    if (!f || has('category')) out.category = clean(input.category, LIMITS.category);
    if (!f || has('description')) out.description = longText(input.description, LIMITS.description);
    if (!f || has('code')) out.code = clean(input.code, LIMITS.code);
    if (!f || has('public')) out.public = input.public === true || input.public === 'true' || input.public === 'on';
    if (!f || has('audience') || out.module) out.audience = audienceOf(moduleId, has('audience') ? input.audience : f?.audience || formModule(moduleId).audience);
    if ((out.audience ?? f?.audience).length === 0 && !(out.public ?? f?.public)) throw bad('Choose who the form is for: at least one account type, or Public.');
    return out;
  }
  const describeChanges = (f, next) => Object.entries(next).filter(([k, v]) => JSON.stringify(f[k] ?? '') !== JSON.stringify(v ?? '')).map(([k, v]) => {
    const label = { title: 'title', module: 'module', category: 'category', description: 'description', code: 'form code', public: 'public', audience: 'who it is for' }[k] || k;
    if (k === 'module') return `module ${moduleName(f.module)} → ${moduleName(v)}`;
    if (k === 'audience') return `who it is for: ${v.map(roleLabel).join(', ') || 'nobody signed in'}`;
    if (k === 'public') return v ? 'now public' : 'no longer public';
    if (k === 'description') return 'description';
    return `${label} “${v}”`;
  });

  // finish { formId } → a new version of that form (note); else a new form with its details (status
  // draft or published, note).
  manage('POST', '/api/forms/manage/uploads/:id/finish', (a) => {
    const { user, params, body } = a;
    sweep();
    const x = uploads.get(String(params.id || ''));
    if (!x || x.owner !== user.id) throw new HttpError(404, 'That upload is no longer on the server. Add the file again.');
    if (x.received !== x.size) throw bad(`${x.name} did not arrive whole. Add it again.`);
    uploads.delete(x.id);
    const buf = Buffer.concat(x.pieces);
    if (body.formId) {
      const f = formFor(a, body.formId);
      const c = vet(a, buf, x.name, f);
      const v = addVersion(f, buf, c, user.id, body.note);
      db.save();
      log(a, `Uploaded version ${v.no}`, f, `${c.name} (${Math.max(1, Math.round(buf.length / 1024))} KB)${v.note ? ` · ${v.note}` : ''} · ${moduleName(f.module)}`);
      return manageRow(f);
    }
    const d = details(a, body);
    const c = vet(a, buf, x.name);
    const status = body.status === 'published' ? 'published' : 'draft';
    const f = { id: randomUUID(), ...d, status, everPublished: status === 'published', versions: [], currentVersion: 0, createdBy: user.id, createdAt: now(), updatedAt: now(), updatedBy: user.id };
    addVersion(f, buf, c, user.id, body.note || 'First version');
    forms().push(f);
    db.save();
    log(a, status === 'published' ? 'Uploaded and published a new form' : 'Uploaded a new form (draft)', f, `${c.name} (${Math.max(1, Math.round(buf.length / 1024))} KB) · ${moduleName(f.module)}${f.code ? ` · ${f.code}` : ''}`);
    return manageRow(f);
  });

  // ----- The overview -----
  manage('GET', '/api/forms/manage', ({ user }) => {
    const mine = managed(user);
    const list = forms().filter((f) => mine.includes(f.module));
    const s = settings();
    return {
      modules: FORM_MODULES.filter((m) => mine.includes(m.id)).map((m) => {
        const of = list.filter((f) => f.module === m.id);
        return {
          id: m.id, name: moduleName(m.id),
          audience: m.audience.map((r) => ({ id: r, label: roleLabel(r) })),
          counts: { total: of.length, published: of.filter((f) => f.status === 'published').length, draft: of.filter((f) => f.status === 'draft').length, retired: of.filter((f) => f.status === 'retired').length },
        };
      }),
      forms: list.map(manageRow).sort((a, b) => FORM_MODULE_IDS.indexOf(a.module) - FORM_MODULE_IDS.indexOf(b.module) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title, 'en', { numeric: true })),
      categories: [...new Set(list.map((f) => f.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), // of their modules' forms only
      roles: [...new Set(FORM_MODULES.filter((m) => mine.includes(m.id)).flatMap((m) => m.audience))].map((r) => ({ id: r, label: roleLabel(r) })),
      settings: { ...s, chunkBytes: FORMS_CHUNK_BYTES, familyLabels: FORM_FAMILIES.map((id) => ({ id, label: FAMILY[id].label, exts: FAMILY[id].exts })), range: MAX_UPLOAD_RANGE },
      accept: s.families.flatMap((id) => FAMILY[id].exts.map((e) => `.${e}`)).join(','),
      canSettings: user.role === 'admin' || userCan(user, FORMS_ALL),
    };
  });

  // ----- One form: details, publish, retire, restore, delete -----
  manage('PUT', '/api/forms/manage/:id', (a) => {
    const f = formFor(a, a.params.id);
    const next = details(a, a.body, f);
    const changes = describeChanges(f, next);
    if (!changes.length) return manageRow(f);
    Object.assign(f, next, { updatedAt: now(), updatedBy: a.user.id });
    db.save();
    log(a, 'Changed the details of a form', f, changes.join('; '));
    return manageRow(f);
  });
  const setStatus = (to, verb) => (a) => {
    const f = formFor(a, a.params.id);
    const from = f.status;
    if (to === 'published' && from === 'published') return manageRow(f);
    if (to === 'retired' && from !== 'published') throw bad(from === 'retired' ? 'This form is retired already.' : 'Only a published form can be retired. A draft that was never published can be deleted.');
    if (to === 'published' && !current(f)) throw bad('Upload a file first.');
    f.status = to;
    if (to === 'published') f.everPublished = true;
    f.retiredAt = to === 'retired' ? now() : null;
    f.updatedAt = now();
    f.updatedBy = a.user.id;
    db.save();
    log(a, verb(from), f, `${statusLabel(from)} → ${statusLabel(to)} · ${moduleName(f.module)}`);
    return manageRow(f);
  };
  manage('POST', '/api/forms/manage/:id/publish', setStatus('published', (from) => (from === 'retired' ? 'Brought back a retired form' : 'Published a form')));
  manage('POST', '/api/forms/manage/:id/retire', setStatus('retired', () => 'Retired a form'));
  manage('POST', '/api/forms/manage/:id/unretire', setStatus('published', () => 'Brought back a retired form'));
  // Restore: an earlier version becomes current again as a new version that copies it.
  manage('POST', '/api/forms/manage/:id/restore', (a) => {
    const f = formFor(a, a.params.id);
    const no = Number(a.body.no);
    const v = f.versions.find((x) => x.no === no) || (() => { throw bad('That version is not there.'); })();
    if (v.no === f.currentVersion) throw bad(`Version ${v.no} is the current version already.`);
    const buf = readBlob(v);
    const c = vet(a, buf, v.name, f, { action: 'Restore refused', prefix: `Version ${v.no} cannot be restored: ` });
    const made = addVersion(f, buf, c, a.user.id, clean(a.body.note, LIMITS.note) || `Restored from version ${v.no}`, { restoredFrom: v.no });
    db.save();
    log(a, `Restored version ${v.no} as version ${made.no}`, f, `${v.name} · ${moduleName(f.module)}`);
    return manageRow(f);
  });
  manage('DELETE', '/api/forms/manage/:id', (a) => {
    const f = formFor(a, a.params.id);
    if (f.status !== 'draft' || f.everPublished) {
      log(a, 'Delete refused', f, `${statusLabel(f.status)}${f.everPublished ? ', published before' : ''} · ${moduleName(f.module)}`, 'refused');
      throw bad('Only a draft that was never published can be deleted. Retire this form instead: it is kept, with its versions, and hidden from users.');
    }
    for (const v of f.versions) blobs.remove(v.blobId);
    db.data.forms = forms().filter((x) => x !== f);
    db.save();
    log(a, 'Deleted a draft form', f, `${f.versions.length} version${f.versions.length === 1 ? '' : 's'} · ${moduleName(f.module)}`);
    return { ok: true };
  });
  function readBlob(v) {
    try {
      return blobs.get(v.blobId, v.sha256);
    } catch (err) {
      if (err instanceof BlobError) throw new HttpError(err.code === 'missing' ? 404 : 500, err.message);
      throw err;
    }
  }
  // A version as a download, holding a place among the downloads that run at once (each holds the
  // whole file in memory until it is sent; server/download-gate.js).
  function download(a, v) {
    const release = ctx.downloads ? ctx.downloads.enter({ user: a.user, ip: a.ip }, v.size) : () => {};
    try {
      return fileResponse(v, readBlob(v), release);
    } catch (err) {
      release();
      throw err;
    }
  }
  // Any version, for managers (the Versions list in the tool). Recorded in the audit log.
  manage('GET', '/api/forms/manage/:id/versions/:no/file', (a) => {
    const f = formFor(a, a.params.id);
    const v = f.versions.find((x) => x.no === Number(a.params.no)) || (() => { throw missing(); })();
    const out = download(a, v);
    log(a, v.no === f.currentVersion ? `Downloaded version ${v.no} (current)` : `Downloaded an earlier version (${v.no})`, f, `${v.name} · ${moduleName(f.module)}`);
    return out;
  });

  // ----- Settings (also in the Settings center) -----
  const settingsOut = () => ({ ...settings(), familyLabels: FORM_FAMILIES.map((id) => ({ id, label: FAMILY[id].label })), range: MAX_UPLOAD_RANGE });
  const settingsAdmin = (u) => {
    if (!(u?.role === 'admin' || userCan(u, FORMS_ALL))) throw new HttpError(403, 'Only administrators (and those given forms.manage) change the Document circulation settings.');
  };
  route('GET', '/api/forms/settings', 'me', ({ user }) => {
    managerOnly(user);
    return settingsOut();
  }, { audit: false });
  route('PUT', '/api/forms/settings', 'me', (a) => {
    settingsAdmin(a.user);
    const b = a.body || {};
    const was = settings();
    const mb = Number(b.maxUploadMB ?? was.maxUploadMB);
    if (!Number.isInteger(mb) || mb < MAX_UPLOAD_RANGE[0] || mb > MAX_UPLOAD_RANGE[1]) throw bad(`The largest file is ${MAX_UPLOAD_RANGE[0]} to ${MAX_UPLOAD_RANGE[1]} MB.`);
    const families = Array.isArray(b.families) ? b.families.map(String) : was.families;
    const unknown = families.find((x) => !FORM_FAMILIES.includes(x));
    if (unknown) throw bad(`${unknown} is not a kind of file a form may be.`);
    if (!families.length) throw bad('Tick at least one kind of file.');
    db.data.formSettings = mergeFormSettings({ maxUploadMB: mb, families });
    db.save();
    const now2 = settings();
    if (JSON.stringify(now2) !== JSON.stringify(was)) log(a, 'Changed the Document circulation settings', null, `Largest file ${now2.maxUploadMB} MB; types: ${now2.families.map((id) => FAMILY[id].label).join(', ')}`);
    return settingsOut();
  }, { audit: false });

  // ----- Forms & downloads: what each system shows its people -----
  // The current published version of the module's forms for this account type (or public). Never
  // earlier versions.
  route('GET', '/api/forms', 'me', ({ user, query }) => {
    const m = String(query.module || '');
    if (!FORM_MODULE_IDS.includes(m)) throw new HttpError(404, 'There are no forms for that system.');
    const rows = forms().filter((f) => f.module === m && visibleTo(f, user)).map(userRow);
    return { module: m, moduleName: moduleName(m), total: rows.length, categories: byCategory(rows) };
  }, { audit: false });
  route('GET', '/api/forms/:id/file', 'me', (a) => {
    const f = forms().find((x) => x.id === String(a.params.id || ''));
    if (!f || !visibleTo(f, a.user)) throw missing();
    const v = current(f);
    const out = download(a, v);
    log(a, 'Downloaded a form', f, `Version ${v.no} · ${v.name} · ${moduleName(f.module)}`);
    return out;
  }, { audit: false });
  // Signed out: the public forms (the ATLAS home's Forms page), rate-limited per address.
  const publicForms = () => forms().filter((f) => f.public && visibleTo(f, null));
  route('GET', '/api/public/forms', 'public', () => {
    const rows = publicForms().map(userRow);
    return {
      total: rows.length,
      modules: FORM_MODULES.map((m) => ({ id: m.id, name: moduleName(m.id), categories: byCategory(rows.filter((r) => r.module === m.id)) })).filter((m) => m.categories.length),
    };
  }, { limit: 'publicForms', audit: false });
  route('GET', '/api/public/forms/:id/file', 'public', (a) => {
    const f = publicForms().find((x) => x.id === String(a.params.id || ''));
    if (!f) throw missing();
    const v = current(f);
    const out = download({ ip: a.ip }, v);
    tallyPublic(f, a.ip);
    return out;
  }, { limit: 'publicForms', audit: false });
  // Public downloads are counted rather than recorded one by one (anyone may fetch them, as often as
  // the rate limit allows, which would flood the audit log): one entry per form and hour, with how
  // many downloads from how many addresses.
  const publicTally = new Map(); // form id → { name, since, count, addresses }
  function tallyPublic(f, ip) {
    flushPublicDownloads();
    const x = publicTally.get(f.id) || { name: f.title, since: clock().getTime(), count: 0, addresses: new Set() };
    x.count += 1;
    if (x.addresses.size < 10000) x.addresses.add(String(ip || 'unknown'));
    publicTally.set(f.id, x);
  }
  function flushPublicDownloads(all = false) {
    const t = clock().getTime();
    for (const [id, x] of publicTally) {
      if (!all && t - x.since < PUBLIC_TALLY_MS) continue;
      publicTally.delete(id);
      const n = x.addresses.size;
      log({ user: null, ip: null, agent: '' }, 'Downloaded by the public', { id, title: x.name }, `${x.count} download${x.count === 1 ? '' : 's'} from ${n}${n >= 10000 ? '+' : ''} address${n === 1 ? '' : 'es'} since ${new Date(x.since).toISOString()}`);
    }
  }
  setInterval(() => flushPublicDownloads(), 5 * 60000).unref?.();

  // ----- Demo forms: small generated PDFs, never real forms (marked demo, removed with the demo) -----
  function addDemo(pdf) {
    removeDemo();
    const by = (username) => db.data.users.find((u) => u.username === username) || db.data.users.find((u) => u.role === 'admin');
    const admin = db.data.users.find((u) => u.role === 'admin');
    const day = (n) => new Date(clock().getTime() - n * 86400000).toISOString();
    const make = ({ title, module, category, code = '', description = '', audience, public: pub = false, status = 'published', versions }) => {
      const f = { id: randomUUID(), title, code, module, category, description, audience: audienceOf(module, audience), public: pub, status, everPublished: status !== 'draft', versions: [], currentVersion: 0, createdBy: null, createdAt: '', updatedAt: '', updatedBy: null, demo: true };
      versions.forEach(([username, ago, note, lines], i) => {
        const u = by(username) || admin;
        const buf = pdf(`${title} (demo, version ${i + 1})`, [...lines, 'DEMO FORM: made up for the demo school. Not a real form.']);
        const c = checkFile(buf, `${title}.pdf`, ['pdf']);
        const { blobId, sha256, size } = blobs.put(buf);
        f.versions.push({ no: i + 1, blobId, sha256, name: c.name, ext: c.ext, family: c.family, mime: c.mime, size, by: u?.id || null, byName: u?.name || '', at: day(ago), note });
      });
      f.currentVersion = f.versions.length;
      f.createdBy = f.versions[0].by;
      f.createdAt = f.versions[0].at;
      f.updatedAt = f.versions.at(-1).at;
      f.updatedBy = f.versions.at(-1).by;
      if (status === 'retired') f.retiredAt = day(5);
      forms().push(f);
    };
    const STAFF = ['admin', 'registrar', 'dean', 'teacher', 'hr', 'payroll', 'staff', 'accountant', 'budget', 'cashier', 'supply', 'approver'];
    make({
      title: 'Clearance form', module: 'home', category: 'Clearance', code: 'GEN-F-001 Rev. 2', audience: [...STAFF, 'student'],
      description: 'For students leaving or graduating and employees leaving or retiring: have each office sign its block, then hand it to the registrar or HR.',
      versions: [
        ['registrar.demo', 120, 'First issue', ['Name, student or employee number, reason for clearance', 'Blocks: Library, Registrar, Accounting, HR, Supply']],
        ['accountant.demo', 60, 'Accounting block: unliquidated cash advances added', ['Name, student or employee number, reason for clearance', 'Accounting: no unliquidated cash advance, no balance due']],
        ['hr.demo', 9, 'HR block: return of ID and property added', ['Name, student or employee number, reason for clearance', 'HR: ID returned; Supply: property returned (PAR/ICS)']],
      ],
    });
    make({
      title: 'Request for ID replacement', module: 'home', category: 'Requests', code: 'GEN-F-004', audience: [...STAFF, 'student'],
      description: 'For a lost or damaged school ID. Attach an affidavit of loss for a lost ID.',
      versions: [['registrar.demo', 40, 'First issue', ['Name, number, reason (lost or damaged)', 'Signature and date']]],
    });
    make({
      title: 'Enrollment form', module: 'uis', category: 'Enrollment', code: 'REG-F-001 Rev. 1', audience: ['student', 'registrar', 'admin'], public: true,
      description: 'For new students and transferees: fill it in and bring it to the registrar with your requirements.',
      versions: [
        ['registrar.demo', 90, 'First issue', ['Personal details, program, year level', 'Requirements: Form 138 or transcript, birth certificate, two pictures']],
        ['registrar.demo', 20, 'Guardian contact added', ['Personal details, program, year level, parent or guardian to contact', 'Requirements: Form 138 or transcript, birth certificate, two pictures']],
      ],
    });
    make({
      title: 'Request for a document', module: 'uis', category: 'Records', code: 'REG-F-007', audience: ['student', 'registrar', 'admin'],
      description: 'To ask for a transcript, certificate or authenticated copy on paper (or use Document requests in Academic).',
      versions: [['registrar.demo', 30, 'First issue', ['Document asked for, number of copies, purpose', 'Claim stub']]],
    });
    make({
      title: 'Shifting form', module: 'uis', category: 'Enrollment', code: 'REG-F-010', audience: ['student', 'registrar', 'admin'], status: 'draft',
      description: 'To move to another program. Not out yet: the registrar is still reviewing it.',
      versions: [['registrar.demo', 2, 'Draft for review', ['Present program, program wanted, reason', 'Approvals: present and new program chairs']]],
    });
    make({
      title: 'Excuse letter template', module: 'lms', category: 'Attendance', code: 'LRN-F-002', audience: ['student', 'guardian', 'teacher'],
      description: 'For an absence: the parent or guardian fills it in and the student gives it to the adviser.',
      versions: [['registrar.demo', 50, 'First issue', ['Student, section, dates absent, reason', 'Signature of the parent or guardian']]],
    });
    make({
      title: 'Class observation form', module: 'lms', category: 'Teaching', code: 'LRN-F-011', audience: ['teacher', 'registrar', 'admin'],
      description: 'Used by the program chair when observing a class.',
      versions: [['registrar.demo', 45, 'First issue', ['Teacher, subject, section, date', 'Ratings: preparation, delivery, class management']]],
    });
    make({
      title: 'Leave application form', module: 'hris', category: 'Leave', code: 'HR-F-012 Rev. 3', audience: ['teacher', 'registrar', 'dean', 'hr', 'payroll', 'staff', 'accountant', 'budget', 'cashier', 'supply', 'approver', 'admin'],
      description: 'The paper form, for a leave filed on paper. You can also file leave in People → Leave & requests.',
      versions: [
        ['hr.demo', 200, 'First issue', ['Name, office, position, kind of leave, dates', 'Certification of leave credits by HR']],
        ['hr.demo', 75, 'Kinds of leave updated', ['Name, office, position, kind of leave, dates', 'Kinds: vacation, sick, special privilege, others']],
        ['hr.demo', 15, 'Signatories updated', ['Name, office, position, kind of leave, dates', 'Recommending approval, approved by']],
      ],
    });
    make({
      title: 'Job application form', module: 'hris', category: 'Recruitment', code: 'HR-F-020', audience: ['hr', 'admin'], public: true,
      description: 'For people applying to the school: fill it in and upload it with your application.',
      versions: [['hr.demo', 25, 'First issue', ['Name, contact details, position applied for', 'Education, eligibility, experience']]],
    });
    make({
      title: 'Travel order request (old form)', module: 'hris', category: 'Travel', code: 'HR-F-031', audience: ['teacher', 'staff', 'hr', 'admin'], status: 'retired',
      description: 'Replaced by the travel request in Finance.',
      versions: [['hr.demo', 300, 'First issue', ['Name, destination, dates, purpose']]],
    });
    make({
      title: 'Request for quotation', module: 'fmis', category: 'Procurement', code: 'FIN-F-005 Rev. 1', audience: ['supply', 'approver', 'accountant', 'budget', 'cashier', 'admin'],
      description: 'Sent to suppliers for small value procurement: items, quantities and the deadline for quotations.',
      versions: [
        ['accountant.demo', 80, 'First issue', ['Items, quantity, unit, description', 'Supplier name, price, delivery period']],
        ['accountant.demo', 12, 'Deadline line added', ['Items, quantity, unit, description', 'Quotations must reach the BAC Secretariat by the date shown']],
      ],
    });
    make({
      title: 'Cash advance request', module: 'fmis', category: 'Disbursement', code: 'FIN-F-009', audience: ['teacher', 'staff', 'registrar', 'dean', 'hr', 'payroll', 'accountant', 'budget', 'cashier', 'supply', 'approver', 'admin'],
      description: 'For travel or a special purpose. Liquidate within the days the rules allow.',
      versions: [['accountant.demo', 35, 'First issue', ['Name, purpose, amount, date needed', 'Certified by the accountant, approved by the head']]],
    });
    make({
      title: 'Scanning guide for PDF Studio', module: 'tools', category: 'Guides', code: '', audience: ['teacher', 'staff', 'registrar', 'hr', 'admin'],
      description: 'How to scan paper forms on the office scanner so PDF Studio can join and sign them.',
      versions: [['registrar.demo', 18, 'First issue', ['Scan at 200 dpi, in colour for signatures', 'Save as PDF, one file per form']]],
    });
    db.save();
  }
  function removeDemo() {
    for (const f of forms().filter((x) => x.demo)) for (const v of f.versions) blobs.remove(v.blobId);
    db.data.forms = forms().filter((x) => !x.demo);
  }

  return {
    blobs, dir: formsDir, settings, managed, addDemo, removeDemo, flushPublicDownloads,
    publicCount: () => publicForms().length,
  };
}
