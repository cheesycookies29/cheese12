// CUSTOM APP → events: the signed-in routes (design A5, Tier 0). Every write is registered through
// mutation(), which refuses an async handler when CORE starts and a handler that hands back a
// promise when it runs: a write must finish inside commit(), with nothing awaited, or two requests
// could both pass the checks before either wrote (the last-seat race).
//
// Who sees what (design A9): the Super Administrator everything of their event; staff their own
// guests and tables in full (contact details masked), other guests by name, company, industry and
// table only; a CORE administrator who is not the Super Administrator sees the event's summary and
// can only hand the Super Administrator over (audited, password asked again). Nobody else sees the
// event at all (404).
import { randomUUID } from 'node:crypto';
import { HttpError } from '../../util.js';
import { userCan, ROLES } from '../../../shared/roles.js';
import { tableCounts, classOK, takenSeats, isConfirmed, isReserved, recommend } from '../../../shared/customapp/seating.js';
import { randomBytes } from 'node:crypto';
import { checkInvariants } from '../../../shared/customapp/invariants.js';
import { commit, createEvent } from './commit.js';
import { mustEvent, eventsOf, stateOf, roleOf, guestView, refusal, bad, canonSurname, guestLabel } from './model.js';
import { roomOf, queueBoard, pollReply, queueOf, superQueue, isWaiting } from './board.js';
import { referralFor, qrKeyHashOf } from './public.js';
import { eventCan } from './engine.js';
import { historyOf } from './changes.js';
import { rowsOfUpload, previewImport, importIssues, eventExport, exportCsv, planHtml, IMPORT_LIMITS } from './io.js';

export function mutation(handler) {
  if (typeof handler !== 'function' || handler.constructor?.name === 'AsyncFunction') throw new Error('An event write must be a synchronous function (see mutation() in server/customapp/events/routes.js).');
  return (req) => {
    const out = handler(req);
    if (out && typeof out.then === 'function') throw new Error('An event write returned a promise: it must finish inside commit().');
    return out;
  };
}

// The counts on Event control (counts.js), here too for the older imports.
export { eventCounts } from './counts.js';
import { eventCounts } from './counts.js';

// opts: { ctx (commit context), audit, requirePassword(user, password), limits }
export function registerEventRoutes(route, db, { ctx, audit, requirePassword = () => {}, limits = { hit() {} }, gate = null, safety = null, clock = () => Date.now() }) {
  const users = () => db.data.users || [];
  const nameOf = (id) => users().find((u) => u.id === id)?.name || '';
  const canManage = (u) => userCan(u, 'customapp.manage');
  const base = '/api/customapp/events/:id';
  // The event for this account, with its role; an event they have no part in is not there.
  const access = (user, id, need = null) => {
    const ev = mustEvent(db, id);
    const role = roleOf(ev, user, canManage(user));
    if (!role) throw new HttpError(404, 'That event is not there, or you do not have access to it.');
    if (need === 'staff' && role !== 'staff' && role !== 'super') throw refusal('out_of_scope', undefined, 'You are not on this event\'s staff.');
    if (need === 'super' && role !== 'super') throw refusal('needs_super_admin');
    return { ev, role };
  };
  const tableOut = (t, guests, role, userId) => ({
    id: t.id, number: t.number, classification: t.classification, capacity: t.capacity, ownerUserId: t.ownerUserId || null, ownerName: nameOf(t.ownerUserId),
    active: t.active !== false, row: t.row ?? null, col: t.col ?? null, rev: t.rev || 0, ...tableCounts(t, guests),
    taken: [...takenSeats(t.id, guests)].sort((a, b) => a - b), mine: role === 'super' || (role === 'staff' && t.ownerUserId === userId),
  });
  const view = (g, ev, state, role, user, full = false) => guestView(g, { role, userId: user.id, tables: state.tables, industries: ev.industries, full });

  function eventOut(ev, role, user) {
    const state = stateOf(db, ev);
    const out = {
      id: ev.id, code: ev.code, name: ev.name, venue: ev.venue, date: ev.date, status: ev.status, role, rev: ev.rev || 0, seq: ev.seq || 0,
      superAdmin: { id: ev.superAdminUserId, name: nameOf(ev.superAdminUserId) }, window: ev.window, flags: ev.flags, room: ev.room || null,
      counts: eventCounts(state), demo: Boolean(ev.demo),
    };
    if (role === 'manager') return out;
    return {
      ...out, settings: ev.settings, industries: ev.industries || [], refPrefix: ev.refPrefix,
      staff: (ev.staff || []).map((s) => ({ userId: s.userId, name: nameOf(s.userId), active: s.active !== false })),
      tables: state.tables.sort((a, b) => a.number - b.number).map((t) => tableOut(t, state.guests, role, user.id)),
      issues: role === 'super' ? (({ total, ambiguous, noContact, duplicates, unknownIndustry }) => ({ total, ambiguous: ambiguous.length, noContact: noContact.length, duplicates: duplicates.length, unknownIndustry: unknownIndustry.length }))(importIssues(state)) : null,
      importAck: role === 'super' ? ev.importAck || null : null,
      ...(role === 'super' ? {
        // Event control (Tier 1): who has how many waiting, the guest page alarm, the safety nets.
        workload: [...(ev.staff || []).filter((x) => x.active !== false).map((x) => x.userId), ev.superAdminUserId].map((uid) => {
          const q = uid === ev.superAdminUserId ? superQueue(state).filter((x) => isWaiting(x.guest)).map((x) => x.guest) : queueOf(state, uid);
          return { userId: uid, name: nameOf(uid), isSuper: uid === ev.superAdminUserId, waiting: q.length, longestSince: q[0]?.arrival?.at || null, guests: state.guests.filter((g) => g.ownerUserId === uid).length, tables: state.tables.filter((t) => t.ownerUserId === uid).map((t) => t.number).sort((a, b) => a - b) };
        }),
        alarm: gate?.alarmOf(ev.id) || null, health: safety ? safety.health(ev.id) : null, qrKey: Boolean(ev.qrKeyHash),
      } : {}),
    };
  }

  // ----- Events -----
  route('GET', '/api/customapp/events', 'customapp.use', ({ user }) => ({
    events: eventsOf(db).map((ev) => ({ ev, role: roleOf(ev, user, canManage(user)) })).filter((x) => x.role)
      .map(({ ev, role }) => ({ id: ev.id, name: ev.name, venue: ev.venue, date: ev.date, status: ev.status, role, demo: Boolean(ev.demo), superAdmin: nameOf(ev.superAdminUserId), counts: eventCounts(stateOf(db, ev)) })),
    canCreate: canManage(user),
  }));
  route('POST', '/api/customapp/events', 'customapp.manage', mutation(({ user, body }) => {
    const ev = createEvent(ctx, user, body || {});
    return eventOut(ev, roleOf(ev, user, true), user);
  }));
  route('GET', base, 'customapp.use', ({ user, params }) => {
    const { ev, role } = access(user, params.id);
    return eventOut(ev, role, user);
  });
  // Name, venue, date, status, window, settings, industries and staff: the Super Administrator, with
  // the rev they saw (an older one gets 409 stale).
  route('PATCH', base, 'customapp.use', mutation(({ user, params, body }) => {
    const { ev } = access(user, params.id);
    if (!Number.isInteger(body?.rev)) throw bad('Send the event\'s rev with the change.');
    const { rev, opId, ...rest } = body;
    commit(ctx, ev.id, user, { ...rest, type: 'event.update', opId, expect: { [ev.id]: rev } });
    const now = mustEvent(db, ev.id);
    return eventOut(now, roleOf(now, user, canManage(user)), user);
  }));
  // The one event power of a CORE administrator: handing over the Super Administrator, with their
  // password asked again and a reason; the old holder is revoked in the same commit.
  route('POST', `${base}/super-admin`, 'customapp.manage', mutation(({ user, params, body }) => {
    limits.hit('sensitive', user.id, 'Too many attempts.');
    const { ev } = access(user, params.id);
    if (!body?.password) throw bad('Enter your password to change the Super Administrator.');
    requirePassword(user, body.password);
    const r = commit(ctx, ev.id, user, { type: 'setSuperAdmin', userId: body.userId, reason: body.reason, opId: body.opId });
    return { ...r, superAdmin: { id: r.superAdminUserId, name: nameOf(r.superAdminUserId) } };
  }));
  // Accounts that can be event staff (or the next Super Administrator).
  route('GET', `${base}/people`, 'customapp.use', ({ user, params }) => {
    const { role } = access(user, params.id);
    if (role !== 'super' && role !== 'manager') throw refusal('needs_super_admin');
    return { people: users().filter((u) => u.active !== false && userCan(u, 'customapp.use')).map((u) => ({ id: u.id, name: u.name, username: u.username, type: ROLES[u.role]?.label || u.role })) };
  });

  // ----- Guests -----
  // Find guest: partial name, company or ref; class, status (expected, checked_in, waiting, seated,
  // reserved) and table number. Staff see everyone by name (to check them in); contact details only
  // for their own guests, masked.
  route('GET', `${base}/guests`, 'customapp.use', ({ user, params, query }) => {
    const { ev, role } = access(user, params.id, 'staff');
    const state = stateOf(db, ev);
    const q = String(query.q || '').trim().toLowerCase().slice(0, 80);
    const qc = canonSurname(q);
    const num = query.table ? Number(query.table) : null;
    const t = num ? state.tables.find((x) => x.number === num) : null;
    const status = String(query.status || '');
    const list = state.guests.filter((g) => g.active !== false).filter((g) => {
      if (q && !(`${g.name?.display} ${g.company} ${g.ref}`.toLowerCase().includes(q) || (qc && (g.lookup?.surnames || []).some((s) => s.includes(qc))))) return false;
      if (query.class && g.classification !== query.class) return false;
      if (num && g.seat?.tableId !== t?.id) return false;
      if (query.mine === '1' && role === 'staff' && g.ownerUserId !== user.id) return false;
      if (status === 'expected' && g.arrival?.state !== 'expected') return false;
      if (status === 'checked_in' && g.arrival?.state !== 'checked_in') return false;
      if (status === 'waiting' && !(g.arrival?.state === 'checked_in' && !g.seat)) return false;
      if (status === 'seated' && !isConfirmed(g.seat)) return false;
      if (status === 'reserved' && !isReserved(g.seat)) return false;
      return true;
    });
    list.sort((a, b) => (a.name?.last || '').localeCompare(b.name?.last || '') || (a.name?.first || '').localeCompare(b.name?.first || ''));
    const limit = Math.min(Number(query.limit) || 50, 300);
    return { total: list.length, guests: list.slice(0, limit).map((g) => view(g, ev, state, role, user)) };
  });
  // The guest sheet: the guest, the tables they could sit at (with counts and free chairs; others'
  // tables read only) and their history.
  route('GET', `${base}/guests/:guestId`, 'customapp.use', ({ user, params }) => {
    const { ev, role } = access(user, params.id, 'staff');
    const state = stateOf(db, ev);
    const g = state.guests.find((x) => x.id === params.guestId);
    if (!g) throw new HttpError(404, 'That guest is not on this event\'s list.');
    const v = view(g, ev, state, role, user);
    // The tables this guest may sit at, ranked (US-018): recommended ones first with why, then the
    // rest (full ones too, shown as Full) by number.
    const ranked = new Map(recommend([g], ev, state.tables, state.guests).map((r, i) => [r.tableId, { rank: i + 1, tier: r.tier, reasons: r.reasons }]));
    const options = state.tables.filter((t) => t.active && classOK(t.classification, g, ev.settings?.mixedTables))
      .map((t) => ({ ...tableOut(t, state.guests, role, user.id), ...(ranked.get(t.id) || { rank: null, tier: null, reasons: [] }) }))
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.number - b.number);
    return {
      guest: v, options, seatNumbers: ev.settings?.seatNumbers || 'all',
      capped: Boolean(gate && (g.lookup?.surnames || []).some((sk) => gate.isCapped(ev.id, sk))),
      flags: v.mine ? (g.flags || []) : [], devices: v.mine ? (g.statusTokens || []).length : 0, role,
      staff: role === 'super' ? (ev.staff || []).filter((x) => x.active !== false).map((x) => ({ userId: x.userId, name: nameOf(x.userId) })) : [],
      history: v.mine ? historyOf(db, ev.id, g.id, { users: users() }) : [],
      canSeat: Boolean(v.mine), canRelease: role === 'super' || (Boolean(ev.settings?.releaseDelegable) && Boolean(v.mine)),
      releasedNeedsSuper: Boolean(g.released && g.classification === 'preferred' && !g.seat),
    };
  });

  // ----- Every write: one command through commit() -----
  route('POST', `${base}/commands`, 'customapp.use', mutation(({ user, params, body }) => {
    const ev = mustEvent(db, params.id);
    if (!roleOf(ev, user, canManage(user))) throw new HttpError(404, 'That event is not there, or you do not have access to it.');
    if (['setSuperAdmin', 'import', 'selfCheckIn', 'setQrKey'].includes(body?.type)) throw bad('Use the screen made for that.');
    const r = commit(ctx, ev.id, user, body);
    const now = mustEvent(db, ev.id);
    const state = stateOf(db, now);
    const role = roleOf(now, user, canManage(user));
    return { ok: true, ...r, guests: (r.guestIds || []).map((id) => state.guests.find((g) => g.id === id)).filter(Boolean).map((g) => view(g, now, state, role, user)) };
  }));

  // ----- Import: preview (nothing written), then apply (one commit) -----
  const jobs = new Map(); // jobId → { eventId, userId, at, adds, updates, capacity, report }
  const JOB_MS = 30 * 60000;
  route('POST', `${base}/import`, 'customapp.use', ({ user, params, body }) => {
    const { ev } = access(user, params.id, 'super');
    for (const [id, j] of jobs) if (Date.now() - j.at > JOB_MS) jobs.delete(id);
    const rows = rowsOfUpload({ format: body?.format === 'xlsx' ? 'xlsx' : 'csv', data: body?.data });
    const pv = previewImport(stateOf(db, ev), rows, { users: users(), now: ctx.now() });
    const jobId = randomUUID();
    jobs.set(jobId, { eventId: ev.id, userId: user.id, at: Date.now(), ...pv });
    const sample = pv.adds.slice(0, 8).map((g) => ({ ref: g.ref, name: g.name.display, company: g.company, classification: g.classification, seat: g.seat ? { number: stateOf(db, ev).tables.find((t) => t.id === g.seat.tableId)?.number, seatNo: g.seat.seatNo } : null }));
    audit?.record('customapp.import-preview', { entity: 'caEvent', entityId: ev.id, label: ev.name, note: `${pv.report.rows} rows read: ${pv.adds.length} new, ${pv.updates.length} changed, ${pv.report.blocking} to fix in the file` });
    return { jobId, report: pv.report, sample, limits: IMPORT_LIMITS };
  });
  route('POST', `${base}/import/:jobId/apply`, 'customapp.use', mutation(({ user, params }) => {
    const { ev } = access(user, params.id, 'super');
    const job = jobs.get(params.jobId);
    if (!job || job.eventId !== ev.id || job.userId !== user.id) throw new HttpError(404, 'That import is no longer there. Choose the file again.');
    if (job.report.blocking) throw bad(`Fix the ${job.report.blocking} problem${job.report.blocking === 1 ? '' : 's'} in the file first, then choose it again.`);
    const r = commit(ctx, ev.id, user, { type: 'import', opId: `import:${params.jobId}`, adds: job.adds, updates: job.updates, capacity: job.capacity });
    jobs.delete(params.jobId);
    return { ok: true, added: r.added ?? 0, updated: r.updated ?? 0, seq: r.seq };
  }));
  // The import check, guest by guest (Setup → Import check).
  route('GET', `${base}/issues`, 'customapp.use', ({ user, params }) => {
    const { ev } = access(user, params.id, 'super');
    const state = stateOf(db, ev);
    const issues = importIssues(state);
    const g = (id) => {
      const x = state.guests.find((y) => y.id === id);
      return x && { id: x.id, ref: x.ref, name: x.name?.display, company: x.company, hasEmail: Boolean(x.email), hasMobile: Boolean(x.lookup?.m4), deskOnly: Boolean(x.deskOnly), rev: x.rev || 0 };
    };
    return {
      total: issues.total, ack: ev.importAck || null,
      groups: [
        { kind: 'ambiguous', label: 'Same surname and last 4 digits', fix: 'Add a full email to both, a direct mobile, or mark one desk only.', items: issues.ambiguous.map((p) => p.map(g)) },
        { kind: 'noContact', label: 'No mobile and no email', fix: 'Add a mobile or email, or mark desk only.', items: issues.noContact.map((id) => [g(id)]) },
        { kind: 'duplicates', label: 'Possible duplicates', fix: 'Take one off the list if they are the same person.', items: issues.duplicates.map((p) => p.map(g)) },
        { kind: 'unknownIndustry', label: 'Industry not in the event\'s list', fix: 'Choose an industry, or add it under Industries.', items: issues.unknownIndustry.map((id) => [g(id)]) },
      ],
    };
  });

  // ----- Exports (the Super Administrator): JSON customapp.event/1, CSV, printable plan -----
  const theExport = (ev) => eventExport(db, ev, ctx.now());
  const names = () => Object.fromEntries(users().map((u) => [u.id, u.name]));
  const fileName = (ev, ext) => `${ev.code}-${ctx.now().slice(0, 16).replace(/[:T]/g, '')}.${ext}`;
  const download = (body, type, name) => ({ data: Buffer.from(body), headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
  route('GET', `${base}/export.json`, 'customapp.use', ({ user, params }) => {
    const { ev } = access(user, params.id, 'super');
    const exp = theExport(ev);
    audit?.record('customapp.export', { entity: 'caEvent', entityId: ev.id, label: ev.name, note: `JSON ${exp.format}, seq ${exp.seq}, ${exp.guests.length} guests` });
    return exp;
  });
  route('GET', `${base}/export.csv`, 'customapp.use', ({ user, params, query }) => {
    const { ev } = access(user, params.id, 'super');
    const kind = query.kind === 'seating' ? 'seating' : 'guests';
    const exp = theExport(ev);
    audit?.record('customapp.export', { entity: 'caEvent', entityId: ev.id, label: ev.name, note: `CSV (${kind}), seq ${exp.seq}` });
    return download(`﻿${exportCsv(exp, kind, { names: names() })}`, 'text/csv; charset=utf-8', fileName(ev, `${kind}.csv`));
  });
  route('GET', `${base}/plan.html`, 'customapp.use', ({ user, params }) => {
    const { ev } = access(user, params.id, 'super');
    const exp = theExport(ev);
    audit?.record('customapp.export', { entity: 'caEvent', entityId: ev.id, label: ev.name, note: `Printable seating plan, seq ${exp.seq}` });
    // A page of its own to print: no script, its own small style, never cached.
    return { data: Buffer.from(planHtml(exp, { names: names() })), headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } };
  });
  route('GET', `${base}/invariants`, 'customapp.use', ({ user, params }) => {
    const { ev } = access(user, params.id, 'super');
    return { seq: ev.seq || 0, violations: checkInvariants(stateOf(db, ev)) };
  });

  // ----- Tier 1 (0.72) -----
  // The Super Administrator's extras on the board: the failure alarm, the 5-minute copy and the
  // 60 s rules check (the health strip).
  const superExtra = (ev) => ({ alarm: gate?.alarmOf(ev.id) || null, health: safety ? safety.health(ev.id) : null, qrKey: Boolean(ev.qrKeyHash) });

  // Live sync (US-019): changes?since=<seq>. Unchanged: { seq, pollMs, unchanged } with no board
  // built; otherwise { seq, pollMs, board } for the screen (tab=room: the room plan; else My queue).
  route('GET', `${base}/changes`, 'customapp.use', ({ user, params, query }) => {
    const { ev, role } = access(user, params.id, 'staff');
    return pollReply(ev, query.since, () => {
      const state = stateOf(db, ev);
      if (query.tab === 'room') return roomOf(state, { role, userId: user.id, users: users() });
      return queueBoard(db, state, { role, user, users: users(), now: clock(), extra: role === 'super' ? superExtra(ev) : {} });
    });
  });

  // The room plan (US-031): every table where it stands, its chairs and who holds each.
  route('GET', `${base}/room`, 'customapp.use', ({ user, params }) => {
    const { ev, role } = access(user, params.id, 'staff');
    return roomOf(stateOf(db, ev), { role, userId: user.id, users: users() });
  });

  // Recommendations (US-018): eligible tables for these guests, best first, split into the ones
  // this account may use and the others (read only). Nothing anywhere: refer to the Super
  // Administrator.
  route('GET', `${base}/recommend`, 'customapp.use', ({ user, params, query }) => {
    const { ev, role } = access(user, params.id, 'staff');
    const state = stateOf(db, ev);
    const ids = String(query.guestIds || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50);
    const group = ids.map((id) => state.guests.find((g) => g.id === id && g.active !== false));
    if (!group.length || group.some((g) => !g)) throw bad('Choose guests of this event.');
    const actor = { id: user.id, role };
    const all = recommend(group, ev, state.tables, state.guests).map((r) => {
      const t = state.tables.find((x) => x.id === r.tableId);
      const selectable = group.every((g) => eventCan(actor, 'write', g)) && eventCan(actor, 'write', t);
      return { tableId: r.tableId, number: r.number, tier: r.tier, free: r.free, claims: r.claims, confirmed: r.confirmed, reserved: r.reserved, left: r.left, reasons: r.reasons, selectable, classification: t.classification, ownerName: nameOf(t.ownerUserId), taken: [...takenSeats(t.id, state.guests)].sort((a, b) => a - b) };
    });
    const mine = all.filter((r) => r.selectable);
    const othersReadOnly = all.filter((r) => !r.selectable);
    if (!mine.length) return { none: true, refer: 'super_admin', mine, othersReadOnly };
    return { mine, othersReadOnly };
  });

  // A referral code from the guest page (US-014): the real reason, what the guest typed (masked)
  // and the guests it could be, so the desk checks them in.
  route('GET', `${base}/referral/:code`, 'customapp.use', ({ user, params }) => {
    const { ev, role } = access(user, params.id, 'staff');
    const r = gate && referralFor(gate, db, ev, params.code);
    if (!r) throw new HttpError(404, 'No guest page attempt has that code (codes are kept for 3 hours, and until CORE restarts).');
    const state = stateOf(db, ev);
    return { ...r, surnameKey: undefined, guests: r.guests.map((g) => view(g, ev, state, role, user)) };
  });
  // Clear a surname's soft cap at the desk (one tap; in memory, nothing saved).
  route('POST', `${base}/caps/clear`, 'customapp.use', mutation(({ user, params, body }) => {
    const { ev } = access(user, params.id, 'staff');
    if (!gate) return { cleared: 0 };
    let keys = [];
    if (body?.code) keys = [referralFor(gate, db, ev, body.code)?.surnameKey].filter(Boolean);
    else if (body?.guestId) keys = stateOf(db, ev).guests.find((g) => g.id === body.guestId)?.lookup?.surnames || [];
    const cleared = gate.clearCap(ev.id, keys);
    if (cleared) audit?.record('customapp.cap-clear', { entity: 'caEvent', entityId: ev.id, label: ev.name, note: 'Guest page cap cleared at the desk' });
    return { cleared };
  }));
  // The presence key on the reception QR (US-016, off by default): a new key, shown once for the QR
  // sheet, kept only as its hash; or off.
  route('POST', `${base}/qr-key`, 'customapp.use', mutation(({ user, params, body, origin }) => {
    const { ev } = access(user, params.id, 'super');
    const key = body?.on ? randomBytes(18).toString('base64url') : null;
    const r = commit(ctx, ev.id, user, { type: 'setQrKey', keyHash: key ? qrKeyHashOf(key) : null, opId: body?.opId });
    const url = `${origin || ''}/event/${ev.code}${key ? `#k=${key}` : ''}`;
    return { ok: true, seq: r.seq, qrKey: Boolean(key), key, url };
  }));
}
