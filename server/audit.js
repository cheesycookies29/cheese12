// Audit trail (Data Privacy Act, RA 10173: accountability for who saw or changed personal data).
// Entries are appended to data/audit-log.jsonl, a file of its own: restoring a backup, loading
// demo data or erasing all data never rewrites it. Each entry carries the hash of the one before
// it, so an edited or deleted line breaks the chain and the Audit log page says so. The chain is
// sealed with a key made from the server key (data/secret.key), so someone who can only write the
// log file cannot rebuild it. Logs begun by older builds keep their unkeyed entries: the number
// of the first keyed entry is kept in the settings, and every entry from there on must be keyed.
//
// The signed-in user and their address come from the request being handled (AsyncLocalStorage),
// so any module can call audit.record() without passing them along.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { keepPrivate } from './util.js';
import { AsyncLocalStorage } from 'node:async_hooks';

const actorStore = new AsyncLocalStorage();
export const withActor = (actor, fn) => actorStore.run(actor, fn);
// Who is acting right now (null outside a request, e.g. at start-up).
export const currentActor = () => actorStore.getStore() || null;

// Entries written before 0.12.1: a plain hash of the entry and the hash before it.
const hashOf = (prev, entry) => createHash('sha256').update(`${prev}\n${JSON.stringify(entry)}`).digest('hex');
// Entries since (marked k: 1): the same, sealed with the audit key.
const macOf = (key, prev, entry) => createHmac('sha256', key).update(`${prev}\n${JSON.stringify(entry)}`).digest('hex');
const same = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

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

// key: () => the audit key (server/secrets.js derive()). keyedFrom / setKeyedFrom: read and store
// the number of the first keyed entry (kept in the settings). Without a key the chain is unkeyed.
export function createAudit(dir, { key = null, keyedFrom = () => null, setKeyedFrom = () => {} } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'audit-log.jsonl');
  let last = { seq: 0, hash: '' };
  let firstKeyed = null;
  if (fs.existsSync(file)) {
    keepPrivate(file);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    const tail = lines.length && JSON.parse(lines.at(-1));
    if (tail) last = { seq: tail.seq, hash: tail.hash };
    firstKeyed = lines.map((l) => JSON.parse(l)).find((e) => e.k === 1)?.seq ?? null;
  }
  // First start with a key: a new log is keyed from entry 1, an older one from its next entry.
  if (key && !Number.isInteger(keyedFrom())) setKeyedFrom(firstKeyed ?? last.seq + 1);
  let auditKey = null;
  const getKey = () => (auditKey ||= key());
  const recentViews = new Map(); // `${user}:${what}` -> time, so repeated views log once in 10 minutes

  // action: e.g. 'employee.update'. entity / entityId: the record. label: a readable name for it.
  function record(action, { entity = '', entityId = '', label = '', changes = [], note = '', actor = currentActor() } = {}) {
    const a = actor || {};
    const entry = {
      seq: last.seq + 1, id: randomUUID(), at: new Date().toISOString(),
      userId: a.user?.id || null, userName: a.user?.name || a.name || 'System', role: a.user?.role || '', ip: a.ip || '',
      action, entity, entityId: entityId || '', label: label || '', changes, note: note || '', prev: last.hash,
    };
    if (key) entry.k = 1;
    entry.hash = key ? macOf(getKey(), last.hash, entry) : hashOf(last.hash, entry);
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
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

  // Re-computes the chain: ok when no entry was changed, removed or reordered. Entries before
  // keyedFrom are checked by their plain hash; from keyedFrom on each must be keyed and sealed
  // with the audit key, so a chain rebuilt without the key (or with the key missing) fails.
  function verify() {
    const from = key && Number.isInteger(keyedFrom()) ? keyedFrom() : null;
    let prev = '';
    let seq = 0;
    let secret = null;
    for (const e of all()) {
      const { hash, ...rest } = e;
      const broken = { ok: false, count: seq, brokenAt: e.seq ?? seq + 1, at: e.at, keyedFrom: from };
      if (e.prev !== prev || e.seq !== seq + 1) return broken;
      const keyed = from !== null && e.seq >= from;
      if (keyed !== (e.k === 1)) return broken;
      if (keyed) {
        try {
          secret ||= getKey();
        } catch {
          return { ...broken, keyMissing: true };
        }
      }
      if (!same(hash, keyed ? macOf(secret, prev, rest) : hashOf(prev, rest))) return broken;
      prev = hash;
      seq = e.seq;
    }
    return { ok: true, count: seq, keyedFrom: from };
  }

  return { record, view, list, verify, file, count: () => last.seq };
}

// A request that turned out to change nothing (e.g. access set to what it already was): no
// generic "changed" entry for it either.
export const noAudit = () => {
  const a = currentActor();
  if (a) a.before = -1;
};
