// CUSTOM APP → events: the unit of work (design A4). Every change to an event goes through commit(),
// and commit() is synchronous from the first check to db.save(): Node runs one piece of JavaScript at
// a time, so nothing can change the event between the checks and the write. That is what makes "the
// last seat goes to exactly one person", atomic swaps and "a permission change applies at once" hold.
// There is no await in this file (test/customapp-api.test.js reads it to be sure).
//
// In order: the event; the actor's role in it, read again now; the readOnly switch; the opId (a
// retry of a change already made returns its result, nothing is written twice); the plan (engine.js,
// pure); the revisions the screen expected; the invariants on the state the change would produce;
// then the change, copy-on-write, one caChanges entry, seq + 1, and db.save(). If the save throws,
// everything is put back as it was and the answer is 503 not_saved. Then one audit entry.
import { createHash, randomUUID } from 'node:crypto';
import { cleanRoom, roomTables, DEFAULT_ROOM } from '../../../shared/customapp/room.js';
import { HARD_LIMIT } from '../../../shared/customapp/statuses.js';
import { toUtc } from '../../../shared/customapp/time.js';
import { cleanText, newEventCode } from './model.js';
import { cleanIndustries } from './engine.js';
import { checkInvariants } from '../../../shared/customapp/invariants.js';
import { userCan } from '../../../shared/roles.js';
import { plan, freshFor } from './engine.js';
import { mustEvent, stateOf, roleOf, refusal, bad, maskEmail, maskMobile } from './model.js';

// Commands allowed while the event is read only: turning the switch back off, handing over the
// Super Administrator (break-glass), and the Super Administrator's paper reconciliation.
const READ_ONLY_EXEMPT = new Set(['setFlag', 'setSuperAdmin']);

// ctx: { db, audit, now () → ISO time }; the opId map is kept on it.
export function createCommitContext(db, { audit = null, now = () => new Date().toISOString() } = {}) {
  return { db, audit, now, idem: { list: null, length: 0, map: new Map() } };
}

// A command's fingerprint for opId replays: the command without its opId, keys in order.
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
export const commandHash = (cmd) => createHash('sha256').update(stable({ ...cmd, opId: undefined })).digest('hex').slice(0, 32);

// opId → the change it made, rebuilt from caChanges whenever that list was replaced (a start, a
// restore, an undo after a failed save).
function idemMap(ctx) {
  const list = ctx.db.data.caChanges || [];
  const st = ctx.idem;
  if (st.list !== list || list.length < st.length) {
    st.map = new Map();
    for (const c of list) if (c.opId) st.map.set(`${c.eventId}|${c.opId}`, c);
  } else for (let i = st.length; i < list.length; i++) if (list[i].opId) st.map.set(`${list[i].eventId}|${list[i].opId}`, list[i]);
  st.list = list;
  st.length = list.length;
  return st.map;
}

// The state after the change, without touching the live one (copy-on-write).
function project(state, changes) {
  let event = state.event;
  const tables = new Map(state.tables.map((t) => [t.id, t]));
  const guests = new Map(state.guests.map((g) => [g.id, g]));
  const maps = { caTables: tables, caGuests: guests };
  for (const c of changes) {
    if (c.coll === 'caEvents') event = { ...event, ...c.patch };
    else if (c.op === 'add') maps[c.coll].set(c.record.id, c.record);
    else if (c.op === 'remove') maps[c.coll].delete(c.id);
    else maps[c.coll].set(c.id, { ...maps[c.coll].get(c.id), ...c.patch });
  }
  return { event, tables: [...tables.values()], guests: [...guests.values()] };
}

// A short, safe record of what changed (contact details masked, structures reduced).
const brief = (k, v) => {
  if (v == null) return v ?? null;
  if (k === 'email') return maskEmail(v);
  if (k === 'mobile') return maskMobile(v);
  if (k === 'seat') return { t: v.tableId, s: v.seatNo ?? null, st: v.status };
  if (k === 'arrival') return v.state;
  if (k === 'released') return { at: v.at };
  if (typeof v === 'object') return Array.isArray(v) ? v.length : '…';
  return v;
};
function autoDiff(state, changes) {
  const out = [];
  for (const c of changes) {
    if (c.op !== 'set') continue;
    const before = (c.coll === 'caEvents' ? [state.event] : c.coll === 'caTables' ? state.tables : state.guests).find((x) => x.id === c.id) || {};
    for (const [k, v] of Object.entries(c.patch)) if (k !== 'lookup') out.push({ id: c.id, f: k, from: brief(k, before[k]), to: brief(k, v) });
  }
  return out.slice(0, 60);
}

// user: the signed-in account, or { synthetic: 'self' } for the guest page (Tier 1).
export function commit(ctx, eventId, user, cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) throw bad('Send a command.');
  const { db } = ctx;
  const ev = mustEvent(db, eventId);
  const self = user?.synthetic === 'self';
  const canManage = !self && userCan(user, 'customapp.manage');
  const actor = { id: self ? null : user?.id || null, name: self ? 'Guest page' : user?.name || '', role: self ? 'self' : roleOf(ev, user, canManage), canManage };
  if (self !== (cmd.type === 'selfCheckIn')) throw bad(self ? 'The guest page can only check a guest in.' : 'Use checkIn.');
  const reconcile = cmd.via === 'reconcile';
  if (ev.flags?.readOnly && !READ_ONLY_EXEMPT.has(cmd.type) && !(reconcile && actor.role === 'super')) throw refusal('read_only', { seq: ev.seq || 0 });
  if (reconcile && actor.role !== 'super') throw refusal('needs_super_admin', { seq: ev.seq || 0 }, 'Paper reconciliation is entered by the Super Administrator.');

  // A retry of a change already made: the same answer, nothing written twice.
  const opId = cmd.opId == null || cmd.opId === '' ? null : String(cmd.opId).slice(0, 100);
  const h = commandHash(cmd);
  if (opId) {
    const prior = idemMap(ctx).get(`${ev.id}|${opId}`);
    if (prior) {
      if (prior.h !== h) throw refusal('op_replay_mismatch', { seq: ev.seq || 0 });
      return { ...(prior.result || {}), seq: prior.seq, replay: true };
    }
  }

  const now = ctx.now();
  const state = { ...stateOf(db, ev), users: (db.data.users || []).map((u) => ({ id: u.id, name: u.name, active: u.active !== false, canUse: userCan(u, 'customapp.use') })) };
  const p = plan(state, cmd, actor, now);
  if (p.noop) return { ...(p.result || {}), seq: ev.seq || 0, unchanged: true };

  // The revisions the screen saw: a record changed since is refused, with how it is now.
  const expect = cmd.expect && typeof cmd.expect === 'object' && !Array.isArray(cmd.expect) ? cmd.expect : {};
  for (const [id, rev] of Object.entries(expect)) {
    const rec = id === ev.id ? ev : state.guests.find((g) => g.id === id) || state.tables.find((t) => t.id === id);
    if (rec && Number(rev) !== (rec.rev || 0)) {
      const g = state.guests.filter((x) => Object.hasOwn(expect, x.id) || p.guestIds.includes(x.id)).map((x) => x.id);
      throw refusal('stale', freshFor(state, g, state.tables.filter((t) => Object.hasOwn(expect, t.id) || p.tableIds.includes(t.id)).map((t) => t.id)));
    }
  }

  // The invariants on the state this would make. Only new breaks stop it: one already in the data
  // (never expected) must not stop every other change on the night.
  const post = project(state, p.changes);
  const key = (v) => `${v.rule}:${v.ids.join(',')}`;
  const before = new Set(checkInvariants(state).map(key));
  const broken = checkInvariants(post, { write: p.write || null }).filter((v) => !before.has(key(v)));
  if (broken.length) {
    console.error('CUSTOM APP: a change would break', broken);
    throw new Error(`Event invariant ${broken[0].rule}: ${broken[0].detail}`);
  }

  // Apply, copy-on-write: the arrays as they were are kept, so an undo is putting them back.
  const d = db.data;
  const saved = { caEvents: d.caEvents, caTables: d.caTables, caGuests: d.caGuests, caChanges: d.caChanges };
  const seq = (ev.seq || 0) + 1;
  const revs = {};
  d.caTables = [...(d.caTables || [])];
  d.caGuests = [...(d.caGuests || [])];
  d.caChanges = [...(d.caChanges || [])];
  let evNext = { ...ev, seq };
  for (const c of p.changes) {
    if (c.coll === 'caEvents') {
      evNext = { ...evNext, ...c.patch };
      continue;
    }
    const arr = d[c.coll];
    if (c.op === 'add') {
      arr.push(c.record);
      revs[c.record.id] = c.record.rev || 0;
    } else if (c.op === 'remove') {
      const i = arr.findIndex((x) => x.id === c.id);
      if (i >= 0) arr.splice(i, 1);
    } else {
      const i = arr.findIndex((x) => x.id === c.id);
      arr[i] = { ...arr[i], ...c.patch, rev: (arr[i].rev || 0) + 1 };
      revs[c.id] = arr[i].rev;
    }
  }
  if (p.changes.some((c) => c.coll === 'caEvents')) evNext.rev = (ev.rev || 0) + 1;
  revs[ev.id] = evNext.rev || 0;
  d.caEvents = d.caEvents.map((x) => (x.id === ev.id ? evNext : x));
  const change = {
    seq, eventId: ev.id, at: now, ...(reconcile && cmd.occurredAt ? { occurredAt: String(cmd.occurredAt).slice(0, 40) } : {}),
    actorId: actor.id, via: self ? 'self' : reconcile ? 'reconcile' : 'staff', type: p.type, opId, h,
    guestIds: p.guestIds, tableIds: p.tableIds, diff: p.diff || autoDiff(state, p.changes), reason: p.reason || '', result: p.result || null,
  };
  d.caChanges.push(change);
  try {
    db.save();
  } catch (err) {
    Object.assign(d, saved);
    console.error('CUSTOM APP: the change was not saved:', err.message);
    throw refusal('not_saved', { seq: ev.seq || 0 });
  }
  // After the save: the audit log (its own file), once per change.
  if (ctx.audit && p.audit) {
    try {
      ctx.audit.record(`customapp.${p.audit.action}`, { entity: 'caEvent', entityId: p.audit.entityId || ev.id, label: p.audit.label || ev.name, note: p.audit.note || '' });
    } catch (err) {
      console.error('CUSTOM APP: audit entry not written:', err.message);
    }
  }
  return { ...(p.result || {}), seq, revs, guestIds: p.guestIds, tableIds: p.tableIds };
}

// A new event (customapp.manage), with its tables made from the room. The one write that is not a
// command on an existing event, kept here so it follows the same rules: synchronous, put back as it
// was if the save fails, one caChanges entry (seq 1), one audit entry.
export function createEvent(ctx, user, input = {}) {
  const { db } = ctx;
  if (!input.demo && !userCan(user, 'customapp.manage')) throw refusal('needs_super_admin', undefined, 'Creating an event needs CUSTOM APP management.');
  const name = cleanText(input.name, 120);
  if (!name) throw bad('Give the event a name.');
  if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.date))) throw bad('Write the date as YYYY-MM-DD.');
  let room;
  let window;
  try {
    room = cleanRoom(input.room || DEFAULT_ROOM);
    window = { opensAt: toUtc(input.window?.opensAt), closesAt: toUtc(input.window?.closesAt) };
  } catch (err) {
    throw bad(err.message);
  }
  const superAdminUserId = input.superAdminUserId ? String(input.superAdminUserId) : user.id;
  const sa = (db.data.users || []).find((u) => u.id === superAdminUserId && u.active !== false);
  if (!sa || !userCan(sa, 'customapp.use')) throw bad('The Super Administrator must be an active account that can use CUSTOM APP.');
  const now = ctx.now();
  const seatNumbers = ['all', 'preferred', 'none'].includes(input.settings?.seatNumbers) ? input.settings.seatNumbers : 'all';
  const refPrefix = cleanText(input.refPrefix, 6).toUpperCase().replace(/[^A-Z0-9]/g, '') || name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'G';
  const ev = {
    id: randomUUID(), app: 'events', code: newEventCode(name), name, venue: cleanText(input.venue, 160), date: input.date ? String(input.date) : '', status: 'draft',
    superAdminUserId, staff: [], industries: cleanIndustries(Array.isArray(input.industries) ? input.industries : []),
    settings: { hardLimit: HARD_LIMIT, seatNumbers, mixedTables: Boolean(input.settings?.mixedTables), releaseDelegable: Boolean(input.settings?.releaseDelegable), emailFrom: '', replyTo: '' },
    window, flags: { registrationOpen: false, emailPaused: true, readOnly: false, pollMs: 2000 }, room, refPrefix, importAck: null,
    seq: 1, rev: 0, createdAt: now, createdBy: user.id, ...(input.demo ? { demo: true } : {}),
  };
  const tables = roomTables(room).map((p) => ({ id: randomUUID(), eventId: ev.id, number: p.number, classification: 'regular', capacity: room.chairsPerTable, ownerUserId: null, tags: [], active: true, row: p.row, col: p.col, rev: 0, ...(input.demo ? { demo: true } : {}) }));
  const d = db.data;
  const saved = { caEvents: d.caEvents, caTables: d.caTables, caChanges: d.caChanges };
  d.caEvents = [...(d.caEvents || []), ev];
  d.caTables = [...(d.caTables || []), ...tables];
  d.caChanges = [...(d.caChanges || []), { seq: 1, eventId: ev.id, at: now, actorId: user.id, via: 'staff', type: 'event.create', opId: null, h: null, guestIds: [], tableIds: [], diff: [{ id: ev.id, f: 'room', from: null, to: `${room.rows}x${room.cols}x${room.chairsPerTable}` }], reason: '', result: { eventId: ev.id } }];
  try {
    if (!input.noSave) db.save();
  } catch (err) {
    Object.assign(d, saved);
    throw refusal('not_saved', undefined);
  }
  if (ctx.audit && !input.demo) ctx.audit.record('customapp.event', { entity: 'caEvent', entityId: ev.id, label: name, note: `Created: ${tables.length} tables from the room (${room.rows} x ${room.cols}, ${room.chairsPerTable} chairs), Super Administrator ${sa.name}` });
  return ev;
}
