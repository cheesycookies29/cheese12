// Dev log storage. Entries live in the database so administrators can edit
// them. Each build's own entry (shared/devlog.js) is imported once, the first
// time the server runs that build. Built-in entries nobody has edited follow
// later wording changes in shared/devlog.js; edited and deleted entries are left
// as the administrator left them.
import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';
import { DEVLOG, DEVLOG_MODULES, CHANGE_TYPES, compareVersions } from '../shared/devlog.js';

const VERSION_RE = /^\d+\.\d+\.\d+(-(alpha|beta|rc)(\.\d+)?)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const newestFirst = (a, b) => compareVersions(b.version, a.version) || b.date.localeCompare(a.date);

const CONTENT = ['date', 'title', 'notes', 'changes', 'known', 'modules'];
const field = (e, k) => structuredClone(e[k] ?? (k === 'known' ? [] : null));
const sameContent = (a, b) => CONTENT.every((k) => JSON.stringify(field(a, k)) === JSON.stringify(field(b, k)));

// Adds built-in entries this database hasn't seen yet and refreshes unedited ones.
// Returns true if it changed anything.
export function syncDevlog(db) {
  const data = db.data;
  data.devlog ||= {};
  const log = data.devlog;
  log.entries ||= [];
  log.imported ||= [];
  log.author ??= null;
  let changed = false;
  for (const e of DEVLOG) {
    if (log.imported.includes(e.version)) {
      const stored = log.entries.find((x) => x.version === e.version && x.source === 'release' && !x.updatedAt);
      if (stored && !sameContent(stored, e)) {
        for (const k of CONTENT) stored[k] = field(e, k);
        changed = true;
      }
      continue;
    }
    log.imported.push(e.version);
    if (!log.entries.some((x) => x.version === e.version)) {
      log.entries.push({ id: randomUUID(), ...structuredClone(e), source: 'release', createdAt: new Date().toISOString(), updatedAt: null });
    }
    changed = true;
  }
  return changed;
}

function validateEntry(input, log, existingId) {
  const e = {
    version: str(input.version, 30).replace(/^v/i, ''),
    date: str(input.date, 10),
    title: str(input.title, 120),
    notes: str(input.notes, 2000),
    changes: (Array.isArray(input.changes) ? input.changes : [])
      .map((c) => [c?.[0], c?.[1], str(c?.[2], 400)])
      .filter((c) => c[2]),
    known: (Array.isArray(input.known) ? input.known : String(input.known ?? '').split('\n'))
      .map((k) => str(k, 300))
      .filter(Boolean)
      .slice(0, 10),
  };
  if (!VERSION_RE.test(e.version)) throw new HttpError(400, 'Version must look like 0.2.4-alpha (numbers, then an optional -alpha, -beta or -rc).');
  if (log.entries.some((x) => x.version === e.version && x.id !== existingId)) throw new HttpError(400, `There is already an entry for ${e.version}.`);
  if (!DATE_RE.test(e.date)) throw new HttpError(400, 'Pick the date of the build.');
  if (!e.title) throw new HttpError(400, 'Give the build a title.');
  if (!e.notes) throw new HttpError(400, 'Write a short note about the build.');
  if (!e.changes.length) throw new HttpError(400, 'Add at least one change.');
  for (const [type, module] of e.changes) {
    if (!CHANGE_TYPES[type]) throw new HttpError(400, 'Each change needs a type: Added, Changed or Fixed.');
    if (!DEVLOG_MODULES[module]) throw new HttpError(400, 'Each change needs a module.');
  }
  // Modules are whatever the changes touch, in the usual order.
  e.modules = Object.keys(DEVLOG_MODULES).filter((m) => e.changes.some((c) => c[1] === m));
  return e;
}

export function registerDevlogRoutes(route, db) {
  const log = () => db.data.devlog;
  const author = () => log().author || db.data.users.filter((u) => u.role === 'admin').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))[0]?.name || 'The developer';
  const find = (id) => {
    const e = log().entries.find((x) => x.id === id);
    if (!e) throw new HttpError(404, 'Dev log entry not found.');
    return e;
  };
  const list = () => ({ author: author(), entries: [...log().entries].sort(newestFirst) });

  route('GET', '/api/devlog', 'devlog.view', list);
  route('POST', '/api/devlog', 'devlog.edit', ({ body }) => {
    const now = new Date().toISOString();
    log().entries.push({ id: randomUUID(), ...validateEntry(body, log()), source: 'admin', createdAt: now, updatedAt: null });
    db.save();
    return list();
  });
  route('PUT', '/api/devlog/:id', 'devlog.edit', ({ params, body }) => {
    const entry = find(params.id);
    Object.assign(entry, validateEntry(body, log(), entry.id), { updatedAt: new Date().toISOString() });
    db.save();
    return list();
  });
  route('DELETE', '/api/devlog/:id', 'devlog.edit', ({ params }) => {
    const entry = find(params.id);
    log().entries = log().entries.filter((x) => x.id !== entry.id);
    db.save();
    return list();
  });
  route('PUT', '/api/devlog-author', 'devlog.edit', ({ body }) => {
    const name = str(body.name, 80);
    if (!name) throw new HttpError(400, 'Enter the name shown on the dev log.');
    log().author = name;
    db.save();
    return list();
  });
}
