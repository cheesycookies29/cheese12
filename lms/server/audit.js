// The audit log (System → Audit log, in every system's sidebar for administrators): who signed in and who failed to, from where; who
// changed what in every system, field by field where it can say; requests that were refused.
// Passwords, tokens and what was typed into forms are never recorded.
//
// Kept as CORE ERP keeps its audit log (server/audit.js at the repository root): appended to
// audit-log.jsonl beside the data file, a file of its own, so restoring a backup or removing the demo
// school never rewrites it. Each entry carries a number and the hash of the one before, so an edited,
// removed or reordered line breaks the chain, and Control's Audit trail page says so.
//
// The trail shown to administrators also brings in the logs each system already keeps, so there is
// one place to look: the Settings center's history (settingsLog, with old and new values), Finance's
// audit (finAudit) and Academic's (auditLog).
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ROLES, roleLabel } from '../shared/roles.js';

export const AUDIT_FILE = 'audit-log.jsonl';
const hashOf = (prev, entry) => createHash('sha256').update(`${prev}\n${JSON.stringify(entry)}`).digest('hex');

export const SYSTEM_LABELS = { home: 'ATLAS home', learn: 'Learn', admin: 'Admin panel', academic: 'Academic', people: 'People', finance: 'Finance', control: 'Users & Access', system: 'Users & Access', help: 'Help' };
export const KIND_LABELS = { signin: 'Sign-in', signout: 'Sign-out', password: 'Password', account: 'Account', access: 'Access', session: 'Session', settings: 'Settings', change: 'Change', refused: 'Refused', data: 'Data' };
export const SOURCE_LABELS = { trail: 'Access & changes', settings: 'Settings history', finance: 'Finance audit', academic: 'Academic log' };

// Which system an API address belongs to.
export function systemOf(pathname) {
  const p = String(pathname || '');
  if (p.startsWith('/api/system/')) return 'system';
  if (p.startsWith('/api/admin/')) return 'admin';
  if (p.startsWith('/api/hris/')) return 'people';
  if (p.startsWith('/api/finance/')) return 'finance';
  if (p.startsWith('/api/academic/')) return 'academic';
  if (p.startsWith('/api/hub/') || p.startsWith('/api/sso/')) return 'home';
  if (p.startsWith('/api/guides')) return 'help';
  return 'learn';
}

const VERB = { GET: 'Opened', POST: 'Added', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Deleted' };
const words = (s) => s.replace(/[-_]/g, ' ');
// A short description of a request from its route, e.g. POST /api/finance/dvs/:id/certify → "Certify · dvs",
// PUT /api/admin/users/:id → "Changed · users".
export function describeRoute(method, pattern) {
  const parts = String(pattern).replace(/^\/api\/(admin|hris|finance|academic|control|hub)\//, '/').replace(/^\/api\//, '/').split('/').filter(Boolean);
  const fixed = parts.filter((x) => !x.startsWith(':'));
  const last = parts.at(-1);
  // A POST that ends in a word after an id is an action on that thing: approve, certify, reset-password…
  if (method === 'POST' && parts.length >= 3 && parts.at(-2)?.startsWith(':') && !last.startsWith(':')) {
    const what = fixed.slice(0, -1).map(words).join(' › ');
    return `${words(last).replace(/^./, (c) => c.toUpperCase())}${what ? ` · ${what}` : ''}`;
  }
  return `${VERB[method] || method} · ${fixed.map(words).join(' › ') || 'record'}`;
}

// db: the database (its folder holds the file; in memory in tests). Returns { record, entries,
// verify, file }.
export function createAudit(db) {
  const file = db.dir ? path.join(db.dir, AUDIT_FILE) : null;
  const entries = []; // oldest first, as in the file
  if (file && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // a damaged line: verify() reports where the chain breaks
      }
    }
  }
  let last = entries.length ? { seq: entries.at(-1).seq || entries.length, hash: entries.at(-1).hash || '' } : { seq: 0, hash: '' };
  const append = (fields) => {
    const entry = { seq: last.seq + 1, ...fields, prev: last.hash };
    entry.hash = hashOf(last.hash, entry);
    if (file) fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o640 });
    entries.push(entry);
    last = { seq: entry.seq, hash: entry.hash };
    return entry;
  };
  // A trail kept inside the data file by an earlier ATLAS moves into the file, once; its demo
  // entries stay with the demo school (auditDemo).
  if (Array.isArray(db.data.auditTrail)) {
    const old = db.data.auditTrail;
    db.data.auditDemo = [...(db.data.auditDemo || []), ...old.filter((e) => e.demo)];
    for (const e of old.filter((x) => !x.demo).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
      const { id, at, ...rest } = e;
      append({ id: id || randomUUID(), at, ...rest });
    }
    delete db.data.auditTrail;
    db.save();
  }
  const text = (v, n) => String(v ?? '').slice(0, n);
  return {
    file,
    // e: { kind, action, system, actor (a user or null), target (a user, or { id, name }), targetName,
    // ip, agent, outcome, detail, changes: [{ field, from, to }] }
    record(e) {
      const actor = e.actor || null;
      const target = e.target || null;
      return append({
        id: randomUUID(),
        at: new Date().toISOString(),
        kind: e.kind || 'change',
        system: e.system || 'home',
        action: text(e.action, 200),
        actorId: actor?.id || null,
        actor: actor ? actor.name : '',
        actorRole: actor?.role || '',
        targetId: target?.id || null,
        target: target ? text(target.name || target.username, 160) : text(e.targetName, 160),
        targetUser: Boolean(target?.username), // the target is an account (Control links to it)
        ip: text(e.ip, 64),
        agent: text(e.agent, 160),
        outcome: e.outcome || 'ok',
        detail: text(e.detail, 400),
        changes: (Array.isArray(e.changes) ? e.changes : []).slice(0, 60).map((c) => ({ field: text(c.field, 120), from: text(c.from, 200), to: text(c.to, 200) })),
      });
    },
    entries: () => entries,
    count: () => last.seq,
    // Re-computes the chain from the file: ok when no entry was changed, removed or reordered.
    verify() {
      let lines;
      if (file) lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()) : [];
      else lines = entries.map((x) => JSON.stringify(x));
      let prev = '';
      let seq = 0;
      for (const line of lines) {
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          return { ok: false, count: seq, brokenAt: seq + 1, at: null };
        }
        const { hash, ...rest } = e;
        if (e.prev !== prev || e.seq !== seq + 1 || hashOf(prev, rest) !== hash) return { ok: false, count: seq, brokenAt: e.seq ?? seq + 1, at: e.at || null };
        prev = hash;
        seq = e.seq;
      }
      return { ok: true, count: seq };
    },
  };
}

// ----- The combined trail, for Control → Audit trail -----
const short = (v) => {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') return v.omitted ? '(a picture)' : JSON.stringify(v).slice(0, 80);
  return String(v).slice(0, 80);
};

// Every source in one shape: { id, at, source, kind, system, action, actor, actorId, actorRole,
// target, targetId, ip, agent, outcome, detail }.
export function combinedTrail(data, trail = []) {
  const users = new Map(data.users.map((u) => [u.id, u]));
  const role = (id) => users.get(id)?.role || '';
  const out = [];
  for (const e of trail) out.push({ ...e, source: 'trail' });
  for (const e of data.auditDemo || []) out.push({ ...e, source: 'trail' });
  for (const e of data.settingsLog) {
    out.push({
      id: e.id, at: e.at, source: 'settings', kind: 'settings', system: e.module === 'admin' ? 'admin' : e.module === 'hris' ? 'people' : e.module || 'admin',
      action: `${{ undo: 'Undid a change to', reset: 'Restored a default in', 'reset-all': 'Restored the defaults of', import: 'Imported' }[e.via] || 'Changed'} ${e.areaLabel}`,
      actor: e.by, actorId: e.byId, actorRole: role(e.byId), target: e.areaLabel, targetId: null, targetUser: false, ip: '', agent: '', outcome: 'ok',
      detail: '', changes: e.changes.map((c) => ({ field: c.label, from: short(c.from), to: short(c.to) })),
    });
  }
  for (const e of data.finAudit) {
    out.push({ id: e.id, at: e.at, source: 'finance', kind: 'change', system: 'finance', action: String(e.action || '').slice(0, 200), actor: e.by, actorId: e.byId, actorRole: role(e.byId), target: '', targetId: e.ref || null, targetUser: false, ip: '', agent: '', outcome: 'ok', detail: '' });
  }
  for (const e of data.auditLog) {
    const st = e.studentId ? users.get(e.studentId) : null;
    out.push({ id: e.id || `${e.at}-${e.action}`, at: e.at, source: 'academic', kind: 'change', system: 'academic', action: String(e.action || '').slice(0, 200), actor: e.by, actorId: e.byId || null, actorRole: role(e.byId), target: st?.name || '', targetId: e.studentId || null, targetUser: Boolean(st), ip: '', agent: '', outcome: 'ok', detail: e.detail ? String(e.detail).slice(0, 400) : '' });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// Filters: q (any text), source, kind, system, outcome, actorId (did it), userId (did it or was it
// done to), from / to (dates, YYYY-MM-DD, in the server's time).
export function filterTrail(list, f = {}) {
  const q = String(f.q || '').trim().toLowerCase();
  return list.filter((e) => (!f.source || e.source === f.source)
    && (!f.kind || e.kind === f.kind)
    && (!f.system || e.system === f.system)
    && (!f.outcome || e.outcome === f.outcome)
    && (!f.actorId || e.actorId === f.actorId)
    && (!f.userId || e.actorId === f.userId || e.targetId === f.userId)
    && (!f.from || e.at.slice(0, 10) >= f.from)
    && (!f.to || e.at.slice(0, 10) <= f.to)
    && (!q || `${e.action} ${e.actor} ${e.target} ${e.detail} ${e.ip} ${(e.changes || []).map((c) => `${c.field} ${c.from} ${c.to}`).join(' ')}`.toLowerCase().includes(q)));
}

// CSV, with formula-looking cells made text (as in the browser's toCsv).
export function trailCsv(list) {
  const cell = (c) => {
    const s = String(c ?? '');
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = [['#', 'When (UTC)', 'Source', 'System', 'Kind', 'What', 'Who', 'Account type', 'About', 'Outcome', 'Address', 'Changes', 'Details']];
  for (const e of list) rows.push([e.seq || '', e.at, SOURCE_LABELS[e.source] || e.source, SYSTEM_LABELS[e.system] || e.system, KIND_LABELS[e.kind] || e.kind, e.action, e.actor, e.actorRole ? roleLabel(e.actorRole) : '', e.target, e.outcome, e.ip, (e.changes || []).map((c) => `${c.field}: ${c.from || '(empty)'} -> ${c.to || '(empty)'}`).join('; '), e.detail]);
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

export const sideLabel = (side) => ({ portal: 'Learn', admin: 'Admin panel', hris: 'People' }[side] || side);
export const isStaff = (u) => Boolean(u && ROLES[u.role] && !['student', 'guardian'].includes(u.role));

// ----- The demo school's trail (Admin panel → Demo data): a few days of sign-ins, a run of wrong
// passwords from one address, a refused request and some changes, so Control has something to show.
// Every entry has demo: true and goes when the demo school is removed. Addresses are from the ranges
// kept for examples (192.0.2.x, 198.51.100.x, 203.0.113.x).
export function removeAuditDemo(data) {
  data.auditDemo = [];
}
export function addAuditDemo(data, now = Date.now()) {
  removeAuditDemo(data);
  const user = (username) => data.users.find((u) => u.username === username);
  const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  const out = [];
  const at = (hoursAgo) => new Date(now - hoursAgo * 3600 * 1000).toISOString();
  const add = (hoursAgo, e) => {
    const a = e.actor ? user(e.actor) : null;
    const t = e.target ? user(e.target) : null;
    if ((e.actor && !a) || (e.target && !t)) return;
    out.push({
      id: randomUUID(), demo: true, at: at(hoursAgo), kind: e.kind, system: e.system, action: e.action,
      actorId: a?.id || null, actor: a?.name || '', actorRole: a?.role || '', targetId: t?.id || null, target: t?.name || e.targetName || '', targetUser: Boolean(t),
      ip: e.ip || '', agent: e.agent || '', outcome: e.outcome || 'ok', detail: e.detail || '',
    });
  };
  const signIn = (h, username, system, side, ip, agent) => add(h, { kind: 'signin', system, action: 'Signed in', actor: username, target: username, ip, agent, detail: `${side} · password` });
  signIn(70, 'registrar.demo', 'admin', 'Admin panel', '192.0.2.14', PC);
  signIn(69, 'teacher.demo', 'learn', 'Learn', '192.0.2.31', PC);
  signIn(66, 'student.demo', 'learn', 'Learn', '198.51.100.23', PHONE);
  signIn(52, 'payroll.demo', 'people', 'People', '192.0.2.40', PC);
  add(51.5, { kind: 'change', system: 'people', action: 'Finalize · payroll', actor: 'payroll.demo', ip: '192.0.2.40', agent: PC, detail: 'POST /api/hris/payroll/…/finalize' });
  signIn(48, 'accountant.demo', 'people', 'People', '192.0.2.41', PC);
  add(46, { kind: 'signin', system: 'learn', action: 'Sign-in failed: wrong password', target: 'parent.demo', ip: '198.51.100.77', agent: ANDROID, outcome: 'failed', detail: 'Learn' });
  signIn(45.9, 'parent.demo', 'learn', 'Learn', '198.51.100.77', ANDROID);
  signIn(30, 'teacher.demo', 'learn', 'Learn', '192.0.2.31', PC);
  add(29.5, { kind: 'refused', system: 'admin', action: 'Refused: Opened · users', actor: 'teacher.demo', ip: '192.0.2.31', agent: PC, outcome: 'refused', detail: 'GET /api/admin/users · Please sign in to the admin panel.' });
  signIn(26, 'hr.demo', 'people', 'People', '192.0.2.42', PC);
  add(25.5, { kind: 'change', system: 'people', action: 'Changed · leave', actor: 'hr.demo', ip: '192.0.2.42', agent: PC, detail: 'PUT /api/hris/leave/…' });
  for (const [h, n] of [[5.2, 1], [5.15, 2], [5.1, 3], [5.05, 4], [5.0, 5]]) add(h, { kind: 'signin', system: 'admin', action: 'Sign-in failed: wrong password', target: 'registrar.demo', ip: '203.0.113.45', agent: 'python-requests/2.32', outcome: 'failed', detail: `Admin panel · attempt ${n}` });
  add(4.95, { kind: 'signin', system: 'admin', action: 'Sign-in refused: username locked', target: 'registrar.demo', ip: '203.0.113.45', agent: 'python-requests/2.32', outcome: 'failed', detail: 'Admin panel' });
  add(4.9, { kind: 'signin', system: 'learn', action: 'Sign-in failed: no such account', targetName: '(unknown username)', ip: '203.0.113.45', agent: 'python-requests/2.32', outcome: 'failed', detail: 'Learn' });
  signIn(3, 'registrar.demo', 'admin', 'Admin panel', '192.0.2.14', PC);
  signIn(2, 'student.demo', 'learn', 'Learn', '198.51.100.23', PHONE);
  add(1.9, { kind: 'password', system: 'learn', action: 'Changed their password', actor: 'student.demo', target: 'student.demo', ip: '198.51.100.23', agent: PHONE, detail: 'Their other sessions were ended.' });
  data.auditDemo = out;
}
