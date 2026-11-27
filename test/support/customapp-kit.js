// Helpers for the CUSTOM APP tests (test/customapp-*.test.js): a throw-away CORE with accounts, an
// event made through the API, guests imported from a CSV, and an in-memory engine state for the pure
// tests. Not a test itself (node --test runs it and finds none).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openDb } from '../../server/db.js';
import { createApi } from '../../server/api.js';
import { createCommitContext, commit } from '../../server/customapp/events/commit.js';

export const PW = 'Correct-Horse-42';

// A company: { db, dir, handle, client, admin, as: { username: client }, ids: { username: id } }.
export async function company({ accounts = [['lead', 'eventstaff'], ['sam', 'eventstaff'], ['tess', 'eventstaff'], ['hana', 'hr']], moduleOn = true, file } = {}) {
  const dir = file ? path.dirname(file) : fs.mkdtempSync(path.join(os.tmpdir(), 'core-ca-'));
  const db = openDb(file || path.join(dir, 'db.json'));
  const handle = createApi(db);
  const client = () => {
    let cookie = '';
    return async (method, url, body = {}) => {
      try {
        const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.9' } }, new URL(url, 'http://localhost'), body);
        if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
        return Buffer.isBuffer(res.data) ? Object.assign(res.data, { headers: res.headers }) : res.data;
      } catch (err) {
        if (!err.status) throw err;
        return { status: err.status, error: err.message, code: err.code, fresh: err.fresh };
      }
    };
  };
  const admin = client();
  if (!db.data.users.length) await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  else await admin('POST', '/api/auth/login', { username: 'admin', password: PW });
  const as = { admin };
  const ids = { admin: db.data.users.find((u) => u.username === 'admin').id };
  for (const [username, role] of accounts) {
    if (!db.data.users.some((u) => u.username === username)) await admin('POST', '/api/users', { name: username[0].toUpperCase() + username.slice(1), username, role, password: PW, mustChangePassword: false });
    as[username] = client();
    await as[username]('POST', '/api/auth/login', { username, password: PW });
    ids[username] = db.data.users.find((u) => u.username === username).id;
  }
  if (moduleOn) await admin('PUT', '/api/admin/modules', { modules: { customapp: true } });
  return { db, dir, handle, client, admin, as, ids };
}

// A guest list as CSV: rows of [ref, first, surname, company, industry, email, mobile, class, personnel, table, seat].
export const csvOf = (rows) => ['Ref,First name,Surname,Company,Industry,Email,Mobile,Classification,Personnel,Table,Seat', ...rows.map((r) => r.map((c) => (/[",\r\n]/.test(String(c ?? '')) ? `"${String(c).replace(/"/g, '""')}"` : c ?? '')).join(','))].join('\n');

// An event of rows x cols tables (lead is its Super Administrator, sam and tess staff), tables 1-2
// preferred, the last one employee, sam owning 3-4 and tess 5; guests imported from `rows`.
export async function eventWith(c, { rows = [], room = { rows: 2, cols: 3, chairsPerTable: 10, stageSide: 'right' }, settings = {} } = {}) {
  const ev = await c.admin('POST', '/api/customapp/events', { name: 'Test Gala', date: '2026-12-09', room, superAdminUserId: c.ids.lead, settings, window: { opensAt: '2026-12-09T18:00', closesAt: '2026-12-09T23:00' }, industries: [{ name: 'Banking', related: ['Insurance'] }, { name: 'Insurance' }, { name: 'Retail' }] });
  assert.ok(ev.id, JSON.stringify(ev));
  const lead = c.as.lead;
  const base = `/api/customapp/events/${ev.id}`;
  let e = await lead('GET', base);
  e = await lead('PATCH', base, { rev: e.rev, staff: [{ userId: c.ids.sam }, { userId: c.ids.tess }] });
  const n = room.rows * room.cols;
  for (const t of e.tables) {
    const classification = t.number <= 2 ? 'preferred' : t.number === n ? 'employee' : 'regular';
    const ownerUserId = t.number === 3 || t.number === 4 ? c.ids.sam : t.number === 5 ? c.ids.tess : null;
    const r = await lead('POST', `${base}/commands`, { type: 'table.update', tableId: t.id, classification, ownerUserId });
    assert.ok(r.ok, JSON.stringify(r));
  }
  if (rows.length) {
    const pv = await lead('POST', `${base}/import`, { format: 'csv', data: csvOf(rows) });
    assert.equal(pv.report.blocking, 0, JSON.stringify(pv.report));
    const ap = await lead('POST', `${base}/import/${pv.jobId}/apply`, {});
    assert.ok(ap.ok, JSON.stringify(ap));
  }
  const tables = Object.fromEntries((await lead('GET', base)).tables.map((t) => [t.number, t.id]));
  const guest = (ref) => c.db.data.caGuests.find((g) => g.eventId === ev.id && g.externalKey === ref);
  const cmd = (who, body) => c.as[who]('POST', `${base}/commands`, body);
  return { id: ev.id, base, tables, guest, cmd };
}

// For the pure engine and fuzz tests: a db that never touches the disk, with an event built by hand.
export function memoryDb(data) {
  return { dir: os.tmpdir(), data, saves: 0, save() { this.saves++; } };
}
export const commitAs = (ctx, eventId, user, cmd) => commit(ctx, eventId, user, cmd);
export const newCtx = (db, now = () => '2026-12-09T11:00:00.000Z') => createCommitContext(db, { now });

// The refusal code of a throw (or null when it did not throw).
export function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err.code || `http${err.status || 500}`;
  }
}

// An event built by hand in memory. Users: lead (Super Administrator), sam and tess (staff), ada (a
// CORE administrator who is not designated). tables: [{ n, cls, cap, owner }]; guests: [{ ref, cls,
// owner, arrived, seat: [tableNumber, seatNo, status] }].
export const USERS = {
  lead: { id: 'u-lead', name: 'Lea Lead', username: 'lead', role: 'eventstaff', active: true },
  sam: { id: 'u-sam', name: 'Sam Staff', username: 'sam', role: 'eventstaff', active: true },
  tess: { id: 'u-tess', name: 'Tess Staff', username: 'tess', role: 'eventstaff', active: true },
  ada: { id: 'u-ada', name: 'Ada Admin', username: 'ada', role: 'admin', active: true },
};
export function fixture({ tables = [], guests = [], settings = {}, flags = {} } = {}) {
  const ev = {
    id: 'ev1', app: 'events', code: 'test-gala-abcd', name: 'Test Gala', status: 'live', superAdminUserId: USERS.lead.id,
    staff: [{ userId: USERS.sam.id, role: 'staff', active: true }, { userId: USERS.tess.id, role: 'staff', active: true }],
    industries: [], settings: { hardLimit: 10, seatNumbers: 'all', mixedTables: false, releaseDelegable: false, ...settings },
    window: { opensAt: '2026-12-09T10:00:00.000Z', closesAt: '2026-12-09T15:00:00.000Z' }, flags: { registrationOpen: false, emailPaused: true, readOnly: false, pollMs: 2000, ...flags },
    room: null, refPrefix: 'TG', seq: 0, rev: 0,
  };
  const tid = (n) => `t${n}`;
  const caTables = tables.map((t) => ({ id: tid(t.n), eventId: 'ev1', number: t.n, classification: t.cls || 'regular', capacity: t.cap ?? 10, ownerUserId: t.owner ? USERS[t.owner].id : null, tags: [], active: t.active !== false, rev: 0 }));
  const caGuests = guests.map((g, i) => ({
    id: `g-${g.ref}`, eventId: 'ev1', ref: g.ref, externalKey: g.ref, name: { first: g.first || `First${i}`, last: g.last || `Last${i}`, display: `${g.first || `First${i}`} ${g.last || `Last${i}`}` },
    company: g.company || 'Acme', classification: g.cls || 'regular', ownerUserId: g.owner ? USERS[g.owner].id : null, email: g.email ?? `${g.ref}@example.com`, mobile: g.mobile ?? `0917000${String(1000 + i)}`,
    lookup: { surnames: [String(g.last || `last${i}`).toLowerCase()], m4: String(1000 + i) },
    arrival: g.arrived ? { state: 'checked_in', at: '2026-12-09T10:30:00.000Z', by: USERS.lead.id, via: 'desk' } : { state: 'expected', at: null, by: null, via: null },
    seat: g.seat ? { tableId: tid(g.seat[0]), seatNo: g.seat[1] ?? null, status: g.seat[2] || (g.arrived ? 'confirmed' : 'reserved'), at: '2026-12-09T09:00:00.000Z', by: USERS.lead.id } : null,
    released: g.released || null, approval: { state: 'none' }, active: true, rev: 0,
  }));
  const data = { users: Object.values(USERS).map((u) => ({ ...u })), caEvents: [ev], caTables, caGuests, caChanges: [], caOutbox: [] };
  return memoryDb(data);
}
