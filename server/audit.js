// Audit trail (Data Privacy Act, RA 10173: accountability for who saw or changed personal data).
// Entries are appended to data/audit-log.jsonl, a file of its own: restoring a backup, loading
// demo data or erasing all data never rewrites it. Each entry carries the hash of the one before
// it, so an edited or deleted line breaks the chain and the Audit log page says so.
//
// The signed-in user and their address come from the request being handled (AsyncLocalStorage),
// so any module can call audit.record() without passing them along.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const actorStore = new AsyncLocalStorage();
export const withActor = (actor, fn) => actorStore.run(actor, fn);
// Who is acting right now (null outside a request, e.g. at start-up).
export const currentActor = () => actorStore.getStore() || null;

const hashOf = (prev, entry) => createHash('sha256').update(`${prev}\n${JSON.stringify(entry)}`).digest('hex');

// Government ID numbers and bank accounts are kept to their last 4 characters in the log.
export const MASKED_FIELDS = ['tin', 'sssNo', 'philhealthNo', 'pagibigNo', 'bankAccount'];
export const mask = (v) => {
  const s = String(v ?? '');
  return s.length > 4 ? `••••${s.slice(-4)}` : s ? '••••' : '';
};

const blank = (v) => v === undefined || v === null || v === '' || v === false;
const show = (v) => (v === true ? 'Yes' : v === false ? 'No' : blank(v) ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
// Field-by-field differences between two records, e.g. [{ field: 'rate', from: '30000', to: '32000' }].
export function diff(before = {}, after = {}, fields = null, { masked = MASKED_FIELDS } = {}) {
  const keys = fields || [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  const out = [];
  for (const k of keys) {
    if (['updatedAt', 'createdAt', 'updatedBy', 'createdBy', 'passwordHash'].includes(k)) continue;
    if (blank(before?.[k]) && blank(after?.[k])) continue; // missing and "no" are the same
    const a = show(before?.[k]);
    const b = show(after?.[k]);
    if (a === b) continue;
    out.push(masked.includes(k) ? { field: k, from: mask(a), to: mask(b) } : { field: k, from: a, to: b });
  }
  return out;
}

// Nested settings flattened to dotted paths, so a change reads "premiums.regular.day: 2 → 2.1".
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

export function createAudit(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'audit-log.jsonl');
  let last = { seq: 0, hash: '' };
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    const tail = lines.length && JSON.parse(lines.at(-1));
    if (tail) last = { seq: tail.seq, hash: tail.hash };
  }
  const recentViews = new Map(); // `${user}:${what}` -> time, so repeated views log once in 10 minutes

  // action: e.g. 'employee.update'. entity / entityId: the record. label: a readable name for it.
  function record(action, { entity = '', entityId = '', label = '', changes = [], note = '', actor = currentActor() } = {}) {
    const a = actor || {};
    const entry = {
      seq: last.seq + 1, id: randomUUID(), at: new Date().toISOString(),
      userId: a.user?.id || null, userName: a.user?.name || a.name || 'System', role: a.user?.role || '', ip: a.ip || '',
      action, entity, entityId: entityId || '', label: label || '', changes, note: note || '', prev: last.hash,
    };
    entry.hash = hashOf(last.hash, entry);
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
    last = { seq: entry.seq, hash: entry.hash };
    return entry;
  }

  // Viewing personal data is logged too, but once per user and record in 10 minutes.
  function view(action, opts = {}) {
    const a = opts.actor || currentActor();
    const key = `${a?.user?.id}:${action}:${opts.entityId || ''}`;
    const nowMs = Date.now();
    if (nowMs - (recentViews.get(key) || 0) < 10 * 60 * 1000) return null;
    recentViews.set(key, nowMs);
    return record(action, opts);
  }

  function all() {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  // Newest first, filtered: from / to (YYYY-MM-DD), userId, area (the action's first part), q (text).
  function list({ from, to, userId, area, q, limit = 500 } = {}) {
    const text = String(q || '').trim().toLowerCase();
    const rows = all().filter((e) => (!from || e.at.slice(0, 10) >= from) && (!to || e.at.slice(0, 10) <= to)
      && (!userId || e.userId === userId) && (!area || e.action.split('.')[0] === area)
      && (!text || `${e.userName} ${e.action} ${e.label} ${e.note} ${e.changes.map((c) => `${c.field} ${c.from} ${c.to}`).join(' ')}`.toLowerCase().includes(text)));
    return { total: rows.length, entries: rows.reverse().slice(0, Math.min(Number(limit) || 500, 5000)) };
  }

  // Re-computes the chain: ok when no entry was changed, removed or reordered.
  function verify() {
    let prev = '';
    let seq = 0;
    for (const e of all()) {
      const { hash, ...rest } = e;
      if (e.prev !== prev || e.seq !== seq + 1 || hashOf(prev, rest) !== hash) return { ok: false, count: seq, brokenAt: e.seq ?? seq + 1, at: e.at };
      prev = hash;
      seq = e.seq;
    }
    return { ok: true, count: seq };
  }

  return { record, view, list, verify, file, count: () => last.seq };
}

// A request that turned out to change nothing (e.g. access set to what it already was): no
// generic "changed" entry for it either.
export const noAudit = () => {
  const a = currentActor();
  if (a) a.before = -1;
};
