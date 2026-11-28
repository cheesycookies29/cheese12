// Document circulation (0.70; after Lancaster ATLAS's): every downloadable form and file the company
// gives its people, kept in one place, and handed out on each module's "Forms & downloads" page
// (public/js/views/forms.js). shared/forms.js has the modules, permissions and settings.
//
//  - A form: title, module (or the CORE home, for company-wide forms), category, description, its form
//    code / revision label (as an ISO-controlled company numbers its forms), who it is for (account
//    types), and a status: draft, published or retired. Each upload is a new version, recording the
//    file (name, size and type, the type from its bytes: server/dms/types.js), who uploaded it, when,
//    and a short note. Restoring an earlier version makes a new version that copies it, so the history
//    is never rewritten. Retiring hides a form from users and keeps it, with its versions. Only a draft
//    that was never published may be deleted.
//  - The files never sit in db.json: each version is a blob encrypted at rest in Document Management's
//    store (server/dms/blobs.js, data/documents), so the hourly off-server copy, the nightly copy and
//    the restore steps keep them with the documents. Pieces of an upload are kept in memory until the
//    file is whole, never on disk unencrypted.
//  - Who manages: administrators and forms.manage every module; forms.<module> one module (by default
//    the HR Manager HR's, the IT Asset Manager IT assets' and the Service Desk's, the Sales Manager
//    Sales & CRM's, the Project Manager Projects'). A manager sees only the modules they keep; anything
//    else answers 404.
//  - Users see only the current published version of the forms for their account type, of the modules
//    they open (a CRM form never reaches someone without CRM), never earlier versions; managers
//    download those. This is the ERP's version: no forms for signed-out visitors. Every file goes out
//    as an attachment with nosniff and a sandbox.
//  - Everything is in the audit log: uploads (and refused ones), restores, detail changes, publishing,
//    retiring, deletes, managers' downloads of versions, and the settings.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { noAudit } from './audit.js';
import { userCan, ROLES } from '../shared/roles.js';
import { BlobError } from './dms/blobs.js';
import { checkFile, cleanName, extOf, BLOCKED_EXTS, BLOCKED_LABEL, FAMILY } from './dms/types.js';
import {
  FORM_MODULES, FORM_MODULE_IDS, FORM_AUDIENCE, formModule, formModuleName, managedModules, FORMS_ALL, LIMITS, FORM_FAMILIES,
  mergeFormSettings, statusLabel, MAX_UPLOAD_RANGE,
} from '../shared/forms.js';

const MB = 1024 * 1024;
export const FORMS_CHUNK_BYTES = 4 * MB; // a piece of an upload (about 5.4 MB as base64, under the signed-in body limit)
const UPLOAD_IDLE_MS = 5 * 60000;
const MAX_UPLOADS_EACH = 3;
const MAX_IN_FLIGHT = 320 * MB; // every unfinished upload together, in memory
const BLOCKED = new Set(BLOCKED_EXTS);
const NOT_FOUND = 'That form is not there, or you do not have access to it.';
const roleLabel = (r) => ROLES[r]?.label || r;

const bad = (msg) => new HttpError(400, msg);
const missing = () => new HttpError(404, NOT_FOUND);
const clean = (v, max) => (v == null || typeof v === 'object' ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const longText = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '');
// The engine's messages point at Document control; here they point at this screen's settings.
const here = (s) => String(s).replace(/ An administrator can allow them in Document control\./, ' An administrator can allow them in the Document circulation settings.');
const disposition = (name) => `attachment; filename="${String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
// A stored file as a download: always an attachment, never sniffed, never run, never cached.
const fileResponse = (v, data) => ({
  data,
  headers: {
    'Content-Type': v.mime,
    'Content-Disposition': disposition(v.name),
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff', 'X-Download-Options': 'noopen', 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'same-origin',
  },
});

// options: blobs (Document Management's store), opensModule(user, moduleId) → boolean, clock () → ms,
// audit ({ record }).
export function registerForms(route, db, { blobs, opensModule = () => true, clock = () => Date.now(), audit = null } = {}) {
  // db.data is replaced when a backup is restored: always read the current one.
  const forms = () => (Array.isArray(db.data.forms) ? db.data.forms : (db.data.forms = []));
  const settings = () => mergeFormSettings(db.data.formSettings);
  const now = () => new Date(clock()).toISOString();
  const userById = (id) => (db.data.users || []).find((u) => u.id === id) || null;
  const nameOf = (id, fallback = '') => userById(id)?.name || fallback || 'Former user';
  const managed = (u) => (u && !u.disabled ? managedModules(u.role, (p) => userCan(u, p)) : []);
  const mayManage = (u, moduleId) => managed(u).includes(moduleId);
  const current = (f) => f.versions.find((v) => v.no === f.currentVersion) || f.versions.at(-1) || null;
  const log = (action, f, note = '') => audit?.record(`forms.${action}`, { entity: 'form', entityId: f?.id || '', label: f ? `${f.title}${f.code ? ` (${f.code})` : ''}` : 'Document circulation', note: String(note).slice(0, 400) });

  // ----- Who a form is for -----
  const audienceOf = (list) => [...new Set((Array.isArray(list) ? list : String(list || '').split(',')).map((x) => String(x).trim()).filter((r) => FORM_AUDIENCE.includes(r)))];
  const opens = (u, moduleId) => moduleId === 'home' || Boolean(opensModule(u, moduleId));
  const visibleTo = (f, u) => f.status === 'published' && Boolean(current(f)) && Boolean(u) && f.audience.includes(u.role) && opens(u, f.module);
  const audienceText = (f) => (f.audience.length === FORM_AUDIENCE.length ? `Everyone who opens ${formModuleName(f.module)}` : f.audience.map(roleLabel).join(', '));

  // ----- What leaves the server -----
  const versionOut = (v) => ({ no: v.no, name: v.name, ext: v.ext, size: v.size, at: v.at, by: v.by, byName: nameOf(v.by, v.byName), note: v.note || '', restoredFrom: v.restoredFrom || null });
  const manageRow = (f) => {
    const cur = current(f);
    return {
      id: f.id, title: f.title, code: f.code || '', module: f.module, moduleName: formModuleName(f.module), category: f.category || '', description: f.description || '',
      audience: f.audience, everyone: f.audience.length === FORM_AUDIENCE.length, audienceText: audienceText(f), status: f.status, statusLabel: statusLabel(f.status),
      current: cur ? versionOut(cur) : null,
      versions: f.versions.filter((v) => v !== cur).map(versionOut).reverse(), // earlier versions, newest first
      versionCount: f.versions.length, everPublished: Boolean(f.everPublished), deletable: f.status === 'draft' && !f.everPublished,
      createdAt: f.createdAt, updatedAt: f.updatedAt, updatedByName: nameOf(f.updatedBy), demo: Boolean(f.demo),
    };
  };
  const userRow = (f) => {
    const cur = current(f);
    return {
      id: f.id, title: f.title, code: f.code || '', module: f.module, moduleName: formModuleName(f.module), category: f.category || 'Other forms', description: f.description || '',
      updatedAt: cur.at, name: cur.name, ext: cur.ext, size: cur.size,
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
  const formFor = (u, id) => {
    const f = forms().find((x) => x.id === String(id || ''));
    if (!f || !mayManage(u, f.module)) throw missing();
    return f;
  };

  // ----- Uploads in pieces: start, pieces, finish (kept in memory until whole) -----
  const uploads = new Map();
  const inFlight = () => [...uploads.values()].reduce((n, x) => n + x.size, 0);
  const sweep = () => {
    const t = clock();
    for (const x of [...uploads.values()]) if (t - x.usedAt > UPLOAD_IDLE_MS) uploads.delete(x.id);
  };
  const tooBig = (name, s) => `${name} is larger than ${s.maxUploadMB} MB, the most a form may be. Make the file smaller (save it as PDF, or with smaller pictures), or ask an administrator.`;
  const managerOnly = (u) => {
    if (!managed(u).length) throw new HttpError(403, 'Document circulation is for the people who keep the company\'s forms. Ask an administrator.');
  };
  // Every route that manages: no automatic entry in the audit log (each records a clearer one).
  const manage = (method, pattern, handler) => route(method, pattern, 'auth', (a) => {
    noAudit();
    managerOnly(a.user);
    return handler(a);
  });

  manage('POST', '/api/forms/manage/uploads', ({ user, body }) => {
    const s = settings();
    const name = cleanName(clean(body?.name, 200) || 'file');
    const size = Number(body?.size);
    if (!Number.isInteger(size) || size <= 0) throw bad(`${name} is empty.`);
    if (size > s.maxUploadMB * MB) throw bad(tooBig(name, s));
    if (BLOCKED.has(extOf(name))) throw bad(`.${extOf(name)} files are never accepted (${BLOCKED_LABEL.charAt(0).toLowerCase()}${BLOCKED_LABEL.slice(1)}).`);
    sweep();
    if ([...uploads.values()].filter((x) => x.owner === user.id).length >= MAX_UPLOADS_EACH) throw bad('Wait for the files being uploaded to finish, then add more.');
    if (inFlight() + size > MAX_IN_FLIGHT) throw new HttpError(429, 'Many large files are being uploaded right now. Try again in a minute.');
    const x = { id: randomUUID(), owner: user.id, name, size, pieces: [], received: 0, usedAt: clock() };
    uploads.set(x.id, x);
    return { id: x.id, chunkBytes: FORMS_CHUNK_BYTES };
  });
  manage('PUT', '/api/forms/manage/uploads/:id', ({ user, params, body }) => {
    const x = uploads.get(String(params.id || ''));
    if (!x || x.owner !== user.id) throw new HttpError(404, 'That upload is no longer on the server. Add the file again.');
    x.usedAt = clock();
    const offset = Number(body?.offset);
    if (typeof body?.data !== 'string' || !Number.isInteger(offset) || offset < 0) throw bad('Send a piece of the file.');
    const piece = Buffer.from(body.data, 'base64');
    if (!piece.length || piece.length > FORMS_CHUNK_BYTES) throw bad('Send the file in pieces of up to 4 MB.');
    if (offset + piece.length <= x.received) return { received: x.received }; // a piece sent again
    if (offset !== x.received) throw new HttpError(409, `The upload of ${x.name} lost its place. Add the file again.`);
    if (x.received + piece.length > x.size) throw bad(`${x.name} is larger than it said it was.`);
    x.pieces.push(piece);
    x.received += piece.length;
    return { received: x.received };
  });
  manage('DELETE', '/api/forms/manage/uploads/:id', ({ user, params }) => {
    const x = uploads.get(String(params.id || ''));
    if (x && x.owner === user.id) uploads.delete(x.id);
    return { ok: true };
  });
  // The file is checked before anything is kept: its kind from its bytes, against the settings.
  function vet(buf, name, f = null) {
    const s = settings();
    const refuse = (reason) => {
      log('refused', f, `${name}: ${reason}`);
      throw bad(reason);
    };
    if (buf.length > s.maxUploadMB * MB) refuse(tooBig(name, s));
    const c = checkFile(buf, name, s.families);
    if (!c.ok) refuse(here(c.reason));
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
  function details(user, input, f = null) {
    const out = {};
    const has = (k) => Object.hasOwn(input || {}, k);
    if (!f || has('title')) {
      out.title = clean(input.title, LIMITS.title);
      if (!out.title) throw bad('Give the form a title.');
    }
    if (!f || has('module')) {
      const m = String(input.module || '');
      if (!FORM_MODULE_IDS.includes(m)) throw bad('Choose the module the form belongs to.');
      if (!mayManage(user, m)) throw new HttpError(403, `You do not keep the forms of ${formModuleName(m)}.`);
      out.module = m;
    }
    if (!f || has('category')) out.category = clean(input.category, LIMITS.category);
    if (!f || has('description')) out.description = longText(input.description, LIMITS.description);
    if (!f || has('code')) out.code = clean(input.code, LIMITS.code);
    if (!f || has('audience')) out.audience = has('audience') ? audienceOf(input.audience) : [...FORM_AUDIENCE];
    if ((out.audience ?? f?.audience).length === 0) throw bad('Choose who the form is for: at least one account type.');
    return out;
  }
  const describeChanges = (f, next) => Object.entries(next).filter(([k, v]) => JSON.stringify(f[k] ?? '') !== JSON.stringify(v ?? '')).map(([k, v]) => {
    if (k === 'module') return `module ${formModuleName(f.module)} → ${formModuleName(v)}`;
    if (k === 'audience') return `who it is for: ${v.length === FORM_AUDIENCE.length ? 'everyone who opens the module' : v.map(roleLabel).join(', ')}`;
    if (k === 'description') return 'description';
    return `${{ title: 'title', category: 'category', code: 'form code' }[k] || k} “${v}”`;
  });
  const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

  // finish { formId } → a new version of that form (note); else a new form with its details (status
  // draft or published, note).
  manage('POST', '/api/forms/manage/uploads/:id/finish', ({ user, params, body = {} }) => {
    const x = uploads.get(String(params.id || ''));
    if (!x || x.owner !== user.id) throw new HttpError(404, 'That upload is no longer on the server. Add the file again.');
    if (x.received !== x.size) throw bad(`${x.name} did not arrive whole. Add it again.`);
    uploads.delete(x.id);
    const buf = Buffer.concat(x.pieces);
    if (body.formId) {
      const f = formFor(user, body.formId);
      const c = vet(buf, x.name, f);
      const v = addVersion(f, buf, c, user.id, body.note);
      db.save();
      log('version', f, `Version ${v.no}: ${c.name} (${kb(buf.length)})${v.note ? ` · ${v.note}` : ''} · ${formModuleName(f.module)}`);
      return manageRow(f);
    }
    const d = details(user, body);
    const c = vet(buf, x.name);
    const status = body.status === 'published' ? 'published' : 'draft';
    const f = { id: randomUUID(), ...d, status, everPublished: status === 'published', versions: [], currentVersion: 0, createdBy: user.id, createdAt: now(), updatedAt: now(), updatedBy: user.id };
    addVersion(f, buf, c, user.id, body.note || 'First version');
    forms().push(f);
    db.save();
    log('upload', f, `${c.name} (${kb(buf.length)}) · ${formModuleName(f.module)} · ${status === 'published' ? 'published' : 'draft'}`);
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
        return { id: m.id, name: m.name, short: m.short, counts: { total: of.length, published: of.filter((f) => f.status === 'published').length, draft: of.filter((f) => f.status === 'draft').length, retired: of.filter((f) => f.status === 'retired').length } };
      }),
      forms: list.map(manageRow).sort((a, b) => FORM_MODULE_IDS.indexOf(a.module) - FORM_MODULE_IDS.indexOf(b.module) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title, 'en', { numeric: true })),
      categories: [...new Set(forms().map((f) => f.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      roles: FORM_AUDIENCE.map((r) => ({ id: r, label: roleLabel(r) })),
      settings: { ...s, chunkBytes: FORMS_CHUNK_BYTES, familyLabels: FORM_FAMILIES.map((id) => ({ id, label: FAMILY[id].label, exts: FAMILY[id].exts })), range: MAX_UPLOAD_RANGE },
      accept: s.families.flatMap((id) => FAMILY[id].exts.map((e) => `.${e}`)).join(','),
      canSettings: user.role === 'admin' || userCan(user, FORMS_ALL),
    };
  });

  // ----- One form: details, publish, retire, restore, delete -----
  manage('PUT', '/api/forms/manage/:id', ({ user, params, body = {} }) => {
    const f = formFor(user, params.id);
    const next = details(user, body, f);
    const changes = describeChanges(f, next);
    if (!changes.length) return manageRow(f);
    Object.assign(f, next, { updatedAt: now(), updatedBy: user.id });
    db.save();
    log('change', f, changes.join('; '));
    return manageRow(f);
  });
  const setStatus = (to) => ({ user, params }) => {
    const f = formFor(user, params.id);
    const from = f.status;
    if (to === 'published' && from === 'published') return manageRow(f);
    if (to === 'retired' && from !== 'published') throw bad(from === 'retired' ? 'This form is retired already.' : 'Only a published form can be retired. A draft that was never published can be deleted.');
    if (to === 'published' && !current(f)) throw bad('Upload a file first.');
    f.status = to;
    if (to === 'published') f.everPublished = true;
    f.retiredAt = to === 'retired' ? now() : null;
    f.updatedAt = now();
    f.updatedBy = user.id;
    db.save();
    log(to === 'retired' ? 'retire' : 'publish', f, `${statusLabel(from)} → ${statusLabel(to)} · ${formModuleName(f.module)}`);
    return manageRow(f);
  };
  manage('POST', '/api/forms/manage/:id/publish', setStatus('published'));
  manage('POST', '/api/forms/manage/:id/retire', setStatus('retired'));
  manage('POST', '/api/forms/manage/:id/unretire', setStatus('published'));
  // Restore: an earlier version becomes current again as a new version that copies it.
  manage('POST', '/api/forms/manage/:id/restore', ({ user, params, body = {} }) => {
    const f = formFor(user, params.id);
    const v = f.versions.find((x) => x.no === Number(body.no));
    if (!v) throw bad('That version is not there.');
    if (v.no === f.currentVersion) throw bad(`Version ${v.no} is the current version already.`);
    const buf = readBlob(v);
    const made = addVersion(f, buf, { name: v.name, ext: v.ext, family: v.family, mime: v.mime }, user.id, clean(body.note, LIMITS.note) || `Restored from version ${v.no}`, { restoredFrom: v.no });
    db.save();
    log('restore', f, `Version ${v.no} restored as version ${made.no} · ${v.name} · ${formModuleName(f.module)}`);
    return manageRow(f);
  });
  manage('DELETE', '/api/forms/manage/:id', ({ user, params }) => {
    const f = formFor(user, params.id);
    if (f.status !== 'draft' || f.everPublished) throw bad('Only a draft that was never published can be deleted. Retire this form instead: it is kept, with its versions, and hidden from users.');
    for (const v of f.versions) blobs.remove(v.blobId);
    db.data.forms = forms().filter((x) => x !== f);
    db.save();
    log('delete', f, `${f.versions.length} version${f.versions.length === 1 ? '' : 's'} · ${formModuleName(f.module)}`);
    return { ok: true };
  });
  function readBlob(v) {
    try {
      return blobs.get(v.blobId, v.sha256);
    } catch (err) {
      if (err instanceof BlobError) throw new HttpError(err.code === 'missing' ? 410 : 500, err.message);
      throw err;
    }
  }
  // Any version, for managers (the Versions list). Recorded in the audit log.
  manage('GET', '/api/forms/manage/:id/versions/:no/file', ({ user, params }) => {
    const f = formFor(user, params.id);
    const v = f.versions.find((x) => x.no === Number(params.no));
    if (!v) throw missing();
    const data = readBlob(v);
    log('download-version', f, `Version ${v.no}${v.no === f.currentVersion ? ' (current)' : ''} · ${v.name} · ${formModuleName(f.module)}`);
    return fileResponse(v, data);
  });

  // ----- Settings (administrators and forms.manage) -----
  const settingsOut = () => ({ ...settings(), familyLabels: FORM_FAMILIES.map((id) => ({ id, label: FAMILY[id].label, exts: FAMILY[id].exts })), range: MAX_UPLOAD_RANGE });
  manage('GET', '/api/forms/settings', () => settingsOut());
  manage('PUT', '/api/forms/settings', ({ user, body = {} }) => {
    if (!(user.role === 'admin' || userCan(user, FORMS_ALL))) throw new HttpError(403, 'Only administrators (and those given forms.manage) change the Document circulation settings.');
    const was = settings();
    const mb = Number(body.maxUploadMB ?? was.maxUploadMB);
    if (!Number.isInteger(mb) || mb < MAX_UPLOAD_RANGE[0] || mb > MAX_UPLOAD_RANGE[1]) throw bad(`The largest file is ${MAX_UPLOAD_RANGE[0]} to ${MAX_UPLOAD_RANGE[1]} MB.`);
    const families = Array.isArray(body.families) ? body.families.map(String) : was.families;
    const unknown = families.find((x) => !FORM_FAMILIES.includes(x));
    if (unknown) throw bad(`${unknown} is not a kind of file a form may be.`);
    if (!families.length) throw bad('Tick at least one kind of file.');
    db.data.formSettings = mergeFormSettings({ maxUploadMB: mb, families });
    db.save();
    const next = settings();
    if (JSON.stringify(next) !== JSON.stringify(was)) log('settings', null, `Largest file ${next.maxUploadMB} MB; types: ${next.families.map((id) => FAMILY[id].label).join(', ')}`);
    return settingsOut();
  });

  // ----- Forms & downloads: what each module shows its people -----
  // The current published version of the module's forms for this account type, if they open the
  // module. Never earlier versions.
  route('GET', '/api/forms', 'auth', ({ user, query }) => {
    noAudit();
    const m = String(query.module || '');
    if (!FORM_MODULE_IDS.includes(m) || !opens(user, m)) throw new HttpError(404, 'There are no forms for that module.');
    const rows = forms().filter((f) => f.module === m && visibleTo(f, user)).map(userRow);
    return { module: m, moduleName: formModuleName(m), total: rows.length, categories: byCategory(rows), manages: mayManage(user, m) };
  });
  route('GET', '/api/forms/:id/file', 'auth', ({ user, params }) => {
    noAudit();
    const f = forms().find((x) => x.id === String(params.id || ''));
    if (!f || !visibleTo(f, user)) throw missing();
    const v = current(f);
    return fileResponse(v, readBlob(v));
  });

  // ----- Demo forms: small generated PDFs, never real forms (marked demo, removed with the demo) -----
  // pdf(title, lines) → Buffer.
  function addDemo(pdf) {
    removeDemo();
    const by = (username) => (db.data.users || []).find((u) => u.username === username) || (db.data.users || []).find((u) => u.role === 'admin');
    const day = (n) => new Date(clock() - n * 86400000).toISOString();
    const EVERYONE = [...FORM_AUDIENCE];
    const make = ({ title, module, category, code = '', description = '', audience = EVERYONE, status = 'published', versions }) => {
      const f = { id: randomUUID(), title, code, module, category, description, audience: audienceOf(audience), status, everPublished: status !== 'draft', versions: [], currentVersion: 0, createdBy: null, createdAt: '', updatedAt: '', updatedBy: null, demo: true };
      versions.forEach(([username, ago, note, lines], i) => {
        const u = by(username);
        const buf = pdf(`${title} (demo, version ${i + 1})`, [...lines, 'DEMO FORM: made up for the demo company. Not a real form.']);
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
    make({
      title: 'Clearance form', module: 'home', category: 'Separation', code: 'GEN-F-001 Rev. 2',
      description: 'For employees leaving the company: have each department sign its block, then hand it to HR.',
      versions: [
        ['hr.demo', 120, 'First issue', ['Name, employee number, last day, reason', 'Blocks: IT, Finance, HR, immediate head']],
        ['it.demo', 60, 'IT block: equipment and accounts returned', ['Name, employee number, last day, reason', 'IT: laptop, ID and accounts returned (asset tags)']],
        ['hr.demo', 9, 'HR block: final pay and certificate of employment', ['Name, employee number, last day, reason', 'HR: final pay computed; certificate of employment requested']],
      ],
    });
    make({
      title: 'Company ID request', module: 'home', category: 'Requests', code: 'GEN-F-004',
      description: 'For a new, lost or damaged company ID. Attach an affidavit of loss for a lost ID.',
      versions: [['hr.demo', 40, 'First issue', ['Name, employee number, department, reason (new, lost, damaged)', 'Signature and date']]],
    });
    // More company-wide forms (0.75.1), so the home shows them as a sliding row.
    make({
      title: 'Reimbursement claim', module: 'home', category: 'Requests', code: 'GEN-F-007',
      description: 'For expenses paid for the company: attach the official receipts and have your head sign.',
      versions: [['hr.demo', 30, 'First issue', ['Name, department, date, purpose', 'Expenses with official receipt numbers', 'Approved by the department head']]],
    });
    make({
      title: 'Gate pass', module: 'home', category: 'Requests', code: 'GEN-F-009',
      description: 'For taking company property out of the office: list each item and its asset tag.',
      versions: [['it.demo', 25, 'First issue', ['Name, date, destination', 'Items and asset tags', 'Approved by IT and the guard on duty']]],
    });
    make({
      title: 'Change of personal information', module: 'home', category: 'Records', code: 'GEN-F-011',
      description: 'For a new address, civil status, contact number or emergency contact. Attach proof where asked.',
      versions: [['hr.demo', 20, 'First issue', ['Name, employee number', 'What changes, from and to', 'Proof attached (marriage certificate, billing statement)']]],
    });
    make({
      title: 'Incident report', module: 'home', category: 'Records', code: 'GEN-F-014',
      description: 'For an accident, a near miss, damaged property or a security incident at work.',
      versions: [['hr.demo', 12, 'First issue', ['When and where, who was involved', 'What happened, in order', 'Witnesses and the action taken']]],
    });
    make({
      title: 'Leave application form', module: 'hr', category: 'Leave', code: 'HR-F-012 Rev. 3',
      description: 'The paper form, for leave filed on paper. You can also file leave in Human Resource Management → My Requests.',
      versions: [
        ['hr.demo', 200, 'First issue', ['Name, department, position, kind of leave, dates', 'Leave credits certified by HR']],
        ['hr.demo', 75, 'Kinds of leave updated', ['Name, department, position, kind of leave, dates', 'Kinds: vacation, sick, emergency, others']],
        ['hr.demo', 15, 'Signatories updated', ['Name, department, position, kind of leave, dates', 'Recommending approval, approved by']],
      ],
    });
    make({
      title: 'Overtime authorization', module: 'hr', category: 'Attendance', code: 'HR-F-018',
      description: 'Have overtime approved by your head before you work it; HR counts only approved overtime in payroll.',
      versions: [['hr.demo', 50, 'First issue', ['Name, date, hours, reason', 'Approved by the immediate head']]],
    });
    make({
      title: 'Travel order request (old form)', module: 'hr', category: 'Travel', code: 'HR-F-031', status: 'retired',
      description: 'Replaced by the new travel request.',
      versions: [['hr.demo', 300, 'First issue', ['Name, destination, dates, purpose']]],
    });
    make({
      title: 'Equipment request form', module: 'assets', category: 'Requests', code: 'IT-F-002 Rev. 1',
      description: 'To ask for a laptop, monitor, phone or other equipment for a new hire or a replacement.',
      versions: [
        ['it.demo', 80, 'First issue', ['Requested for, department, items, reason', 'Approved by the department head']],
        ['it.demo', 12, 'Replacement reason added', ['Requested for, department, items, reason', 'For a replacement: asset tag and what is wrong']],
      ],
    });
    make({
      title: 'Asset return slip', module: 'assets', category: 'Returns', code: 'IT-F-006', audience: ['it', 'support', 'hr', 'admin'],
      description: 'Filled in by IT when equipment comes back; a copy goes with the clearance.',
      versions: [['it.demo', 35, 'First issue', ['Asset tag, description, condition', 'Received by, date']]],
    });
    make({
      title: 'Access request form', module: 'helpdesk', category: 'Accounts', code: 'IT-F-010',
      description: 'For access to a system, shared folder or mailbox. Attach it to a ticket in IT Service Desk.',
      versions: [['it.demo', 30, 'First issue', ['System or folder, access needed, until when', 'Approved by the head and the owner of the system']]],
    });
    make({
      title: 'Client onboarding checklist', module: 'crm', category: 'Clients', code: 'SAL-F-003', audience: ['sales', 'salesmgr', 'admin'],
      description: 'What to collect from a new client before the contract is signed.',
      versions: [['sales.demo', 45, 'First issue', ['Company details, contacts, billing', 'Signed NDA, purchase order, accreditation']]],
    });
    make({
      title: 'Quotation template', module: 'crm', category: 'Quotations', code: 'SAL-F-007 Rev. 2', audience: ['sales', 'salesmgr', 'admin'],
      versions: [
        ['sales.demo', 90, 'First issue', ['Client, items, quantities, unit prices', 'Validity, payment terms']],
        ['sales.demo', 20, 'VAT line added', ['Client, items, quantities, unit prices', 'VAT 12%, validity, payment terms']],
      ],
    });
    make({
      title: 'Project acceptance form', module: 'projects', category: 'Closing', code: 'PM-F-004',
      description: 'For the client to sign when a milestone or the whole project is delivered.',
      versions: [['pm.demo', 25, 'First issue', ['Project, milestone, what was delivered', 'Accepted by (client), date']]],
    });
    make({
      title: 'Change request form', module: 'projects', category: 'Scope', code: 'PM-F-009', status: 'draft',
      description: 'For a change in scope, time or cost. Not out yet: the project managers are still reviewing it.',
      versions: [['pm.demo', 2, 'Draft for review', ['Project, change asked for, reason', 'Effect on time and cost; approvals']]],
    });
    db.save();
  }
  function removeDemo() {
    for (const f of forms().filter((x) => x.demo)) for (const v of f.versions) blobs.remove(v.blobId);
    db.data.forms = forms().filter((x) => !x.demo);
  }

  return { settings, managed, addDemo, removeDemo, blobIds: () => forms().flatMap((f) => f.versions.map((v) => v.blobId)) };
}
