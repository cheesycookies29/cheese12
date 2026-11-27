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
import { tableCounts, classOK, takenSeats, isConfirmed, isReserved, recommend, splitSuggestions, seatClassOf } from '../../../shared/customapp/seating.js';
import { toUtc } from '../../../shared/customapp/time.js';
import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { checkInvariants } from '../../../shared/customapp/invariants.js';
import { commit, createEvent, saveP95 } from './commit.js';
import { mustEvent, eventsOf, stateOf, roleOf, guestView, refusal, bad, canonSurname, guestLabel, rsvpStatusOf } from './model.js';
import { roomOf, queueBoard, pollReply, exceptionsOf, workloadOf, substituteLine } from './board.js';
import { referralFor, qrKeyHashOf } from './public.js';
import { eventCan } from './engine.js';
import { historyOf } from './changes.js';
import { rowsOfUpload, previewImport, importIssues, eventExport, exportCsv, planHtml, packHtml, IMPORT_LIMITS } from './io.js';

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
export function registerEventRoutes(route, db, { ctx, audit, requirePassword = () => {}, limits = { hit() {} }, gate = null, safety = null, clock = () => Date.now(), outbox = null, count429 = () => 0 }) {
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

  // The health strip (US-024): the change number, the save p95, the outbox, the newest 5-minute copy,
  // the 429s in the last 15 minutes and the 60 s rules check (a violation shows a banner).
  const healthOf = (ev) => ({
    seq: ev.seq || 0, saveP95Ms: saveP95(ctx), saves: ctx.saveMs?.length || 0, outbox: outbox ? outbox.depth(ev.id) : null,
    emailPaused: Boolean(ev.flags?.emailPaused), canEmail: Boolean(outbox?.transport?.canSend()), tooMany: count429(ev.id),
    ...(safety ? safety.health(ev.id) : { copy: null, check: null }),
  });

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
        // Event control: who has how many waiting (and since when, and when they last did anything),
        // the exceptions inbox, the guest page alarm and the health strip.
        workload: workloadOf(db, state, users()),
        exceptions: exceptionsOf(state, { gate, users: users(), outbox: db.data.caOutbox || [] }),
        alarm: gate?.alarmOf(ev.id) || null, health: healthOf(ev), qrKey: Boolean(ev.qrKeyHash),
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
    const rsvp = ['yes', 'no', 'noreply', 'opened', 'invited', 'not_invited'].includes(query.rsvp) ? query.rsvp : '';
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
      // RSVP (0.74): yes, no, noreply (invited or opened, no answer), not_invited.
      if (rsvp) {
        const st = rsvpStatusOf(g);
        if (rsvp === 'noreply' ? !['invited', 'opened'].includes(st) : st !== rsvp) return false;
      }
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
      canSeat: Boolean(v.mine) && !(g.classification === 'unlisted' && g.approval?.state !== 'approved'), canRelease: role === 'super' || (Boolean(ev.settings?.releaseDelegable) && Boolean(v.mine)),
      releasedNeedsSuper: Boolean(g.released && g.classification === 'preferred' && !g.seat),
      // Tier 2: walk-ins and substitutes, and the seat email (hidden while email is paused).
      approval: g.classification === 'unlisted' ? { state: g.approval?.state || 'pending', kind: g.approval?.kind || (g.substituteFor ? 'substitute' : 'walkin'), at: g.approval?.at || g.approval?.requestedAt || null, note: v.mine ? g.approval?.note || '' : '', classification: g.approval?.classification || null } : null,
      substitute: g.substituteFor || g.substitutedBy ? (() => {
        const o = state.guests.find((x) => x.id === (g.substituteFor || g.substitutedBy));
        const seatOf = (x) => (x?.seat ? { number: state.tables.find((t) => t.id === x.seat.tableId)?.number ?? null, seatNo: x.seat.seatNo ?? null, status: x.seat.status } : null);
        return { role: g.substituteFor ? 'substitute' : 'original', other: o ? { id: o.id, name: o.name?.display || '' } : null, otherSeat: seatOf(o), line: o ? (g.substituteFor ? substituteLine(state, g, o) : substituteLine(state, o, g)) : '' };
      })() : null,
      industries: role === 'super' ? (ev.industries || []) : [],
      canSubstitute: g.classification !== 'unlisted' && g.arrival?.state !== 'checked_in' && !g.substitutedBy && g.active !== false,
      email: ev.flags?.emailPaused ? { paused: true } : { paused: false, state: v.mine ? g.notify?.state || 'none' : null, lastAt: v.mine ? g.notify?.lastAt || null : null, lastError: v.mine ? g.notify?.lastError || '' : '', canResend: Boolean(v.mine) && Boolean(g.email) && isConfirmed(g.seat) },
    };
  });

  // ----- Every write: one command through commit() -----
  route('POST', `${base}/commands`, 'customapp.use', mutation(({ user, params, body }) => {
    const ev = mustEvent(db, params.id);
    if (!roleOf(ev, user, canManage(user))) throw new HttpError(404, 'That event is not there, or you do not have access to it.');
    if (['setSuperAdmin', 'import', 'selfCheckIn', 'setQrKey', 'invite', 'inviteOpened'].includes(body?.type)) throw bad('Use the screen made for that.');
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
  // The offline pack (US-025): the room drawing, an A–Z list, a sheet per table and per staff
  // member, every page stamped "as of HH:MM", from the same export.
  route('GET', `${base}/pack.html`, 'customapp.use', ({ user, params, query }) => {
    const { ev } = access(user, params.id, 'super');
    const exp = theExport(ev);
    audit?.record('customapp.export', { entity: 'caEvent', entityId: ev.id, label: ev.name, note: `Offline pack, seq ${exp.seq}` });
    return { data: Buffer.from(packHtml(exp, { names: names(), standby: String(query.standby || '').slice(0, 120) })), headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } };
  });

  // Reconcile paper seating (US-025): each line of the paper sheets ("19:05, G-0012, 5, 3": the
  // time, the guest's ref, the table and the chair; table and chair empty for a check-in only) is
  // entered through the same commands as on screen, with via 'reconcile', the time it happened and
  // an opId made from the line, through commit(). Entering a sheet twice changes nothing the second
  // time; a line that would overbook a table (or a chair taken online) is refused and comes back
  // as a recovery card, never applied. The Super Administrator only (also while read only is on).
  route('POST', `${base}/reconcile`, 'customapp.use', mutation(({ user, params, body }) => {
    const { ev } = access(user, params.id, 'super');
    const entries = paperEntries(body);
    if (!entries.length) throw bad('Write one line per paper entry: time, ref, table, chair.');
    if (entries.length > 500) throw bad('At most 500 lines at a time.');
    const out = { lines: entries.length, applied: 0, already: 0, cards: [] };
    for (const en of entries) {
      const state = stateOf(db, mustEvent(db, ev.id));
      const card = (code, message, extra = {}) => out.cards.push({ line: en.line, text: en.text, ref: en.ref, code, message, ...extra });
      if (en.error) {
        card('unreadable', en.error);
        continue;
      }
      const g = state.guests.find((x) => x.active !== false && (String(x.ref).toLowerCase() === en.ref.toLowerCase() || String(x.externalKey || '').toLowerCase() === en.ref.toLowerCase()));
      if (!g) {
        card('unknown_guest', `No guest has the ref ${en.ref}.`);
        continue;
      }
      let occurredAt;
      try {
        occurredAt = en.time ? (/^\d{1,2}:\d{2}$/.test(en.time) ? toUtc(`${ev.date || ctx.now().slice(0, 10)}T${en.time.padStart(5, '0')}`) : toUtc(en.time)) : null;
      } catch {
        card('unreadable', `The time "${en.time}" is not HH:MM.`, { name: g.name?.display });
        continue;
      }
      const key = createHash('sha256').update([ev.id, g.id, en.table ?? '', en.seat ?? '', occurredAt || ''].join('|')).digest('hex').slice(0, 24);
      const run = (cmd) => {
        try {
          const r = commit(ctx, ev.id, user, { ...cmd, via: 'reconcile', ...(occurredAt ? { occurredAt } : {}) });
          if (r.replay || r.unchanged) out.already++;
          else out.applied++;
          return true;
        } catch (err) {
          if (!err.status || (err.status >= 500 && err.code !== 'not_saved')) throw err;
          return { code: err.code || 'invalid', message: err.message, fresh: err.fresh };
        }
      };
      let did = false;
      if (g.arrival?.state !== 'checked_in') {
        const r = run({ type: 'checkIn', guestId: g.id, opId: `paper:${key}:in` });
        if (r !== true && r.code !== 'already_checked_in') {
          card(r.code, r.message, { name: g.name?.display, fresh: r.fresh });
          continue;
        }
        did = true;
      } else if (en.table == null) {
        out.already++;
        continue;
      }
      if (en.table == null) continue;
      const now = stateOf(db, mustEvent(db, ev.id));
      const t = now.tables.find((x) => x.number === en.table);
      const gNow = now.guests.find((x) => x.id === g.id);
      if (!t) {
        card('unknown_table', `There is no table ${en.table}.`, { name: g.name?.display });
        continue;
      }
      if (gNow.seat && gNow.seat.tableId === t.id && (en.seat == null || gNow.seat.seatNo === en.seat)) {
        if (!did) out.already++;
        continue;
      }
      if (gNow.seat) {
        card('guest_moved', `${g.name?.display} is already at table ${now.tables.find((x) => x.id === gNow.seat.tableId)?.number}${gNow.seat.seatNo ? `, seat ${gNow.seat.seatNo}` : ''} online; the paper says table ${en.table}${en.seat ? `, seat ${en.seat}` : ''}. Nothing was changed: move them on screen if the paper is right.`, { name: g.name?.display });
        continue;
      }
      const r = run({ type: 'assign', placements: [{ guestId: g.id, tableId: t.id, seatNo: en.seat ?? undefined }], opId: `paper:${key}:seat` });
      if (r !== true) card(r.code, r.message, { name: g.name?.display, table: en.table, seat: en.seat, fresh: r.fresh });
    }
    if (out.lines) audit?.record('customapp.reconcile', { entity: 'caEvent', entityId: ev.id, label: ev.name, note: `Paper seating: ${out.lines} lines, ${out.applied} changes entered, ${out.already} already in, ${out.cards.length} to resolve` });
    return out;
  }));

  // The Super Administrator's exceptions inbox, on its own.
  route('GET', `${base}/exceptions`, 'customapp.use', ({ user, params }) => {
    const { ev } = access(user, params.id, 'super');
    return { seq: ev.seq || 0, items: exceptionsOf(stateOf(db, ev), { gate, users: users(), outbox: db.data.caOutbox || [] }) };
  });

  route('GET', `${base}/invariants`, 'customapp.use', ({ user, params }) => {
    const { ev } = access(user, params.id, 'super');
    return { seq: ev.seq || 0, violations: checkInvariants(stateOf(db, ev)) };
  });

  // ----- Tier 1 (0.72) -----
  // The Super Administrator's extras on the board: the failure alarm, the 5-minute copy and the
  // 60 s rules check (the health strip).
  const superExtra = (ev) => ({ alarm: gate?.alarmOf(ev.id) || null, health: healthOf(ev), qrKey: Boolean(ev.qrKeyHash) });
  // Event control's board (tab=control, the Super Administrator): the counts, the exceptions inbox,
  // the workload and the health strip, refreshed by the same short poll as every screen.
  const controlBoard = (ev, user) => {
    const state = stateOf(db, ev);
    return { event: { id: ev.id, name: ev.name, status: ev.status, flags: ev.flags }, counts: eventCounts(state), exceptions: exceptionsOf(state, { gate, users: users(), outbox: db.data.caOutbox || [] }), workload: workloadOf(db, state, users()), alarm: gate?.alarmOf(ev.id) || null, health: healthOf(ev), me: { id: user.id, role: 'super' } };
  };

  // Live sync (US-019): changes?since=<seq>. Unchanged: { seq, pollMs, unchanged } with no board
  // built; otherwise { seq, pollMs, board } for the screen (tab=room: the room plan; else My queue).
  route('GET', `${base}/changes`, 'customapp.use', ({ user, params, query }) => {
    const { ev, role } = access(user, params.id, 'staff');
    return pollReply(ev, query.since, () => {
      const state = stateOf(db, ev);
      if (query.tab === 'room') return roomOf(state, { role, userId: user.id, users: users() });
      if (query.tab === 'control') {
        if (role !== 'super') throw refusal('needs_super_admin');
        return controlBoard(ev, user);
      }
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
    // A group (US-021): whether its members have different owners (then only the Super
    // Administrator seats it), and, when no table of this account fits everyone, the largest parts
    // that fit (a split needs the explicit "Split group" confirm: assign with allowSplit).
    const group2 = group.length > 1;
    const mixedOwners = group2 && new Set(group.map((g) => g.ownerUserId || null)).size > 1;
    const canSeatGroup = role === 'super' || (!mixedOwners && group.every((g) => eventCan(actor, 'write', g)));
    const usable = state.tables.filter((t) => eventCan(actor, 'write', t));
    const split = group2 && !mine.length && canSeatGroup ? (splitSuggestions(group, ev, usable, state.guests) || []).map((p) => ({ ...p, taken: [...takenSeats(p.tableId, state.guests)].sort((a, b) => a - b) })) : [];
    const extra = group2 ? { group: { size: group.length, mixedOwners, canSeat: canSeatGroup, split } } : {};
    const seats = { seatNumbers: ev.settings?.seatNumbers || 'all', seatNoRequired: group.map((g) => ({ guestId: g.id, required: seatClassOf(g) === 'preferred' || (ev.settings?.seatNumbers || 'all') === 'all' })) };
    if (!mine.length) return { none: true, refer: 'super_admin', mine, othersReadOnly, ...extra, ...seats };
    return { mine, othersReadOnly, ...extra, ...seats };
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

// The paper lines: { text: "19:05, G-0012, 5, 3\n…" } or { entries: [{ time, ref, table, seat }] }.
// → [{ line, text, time, ref, table|null, seat|null, error? }]
export function paperEntries(body) {
  if (Array.isArray(body?.entries)) {
    return body.entries.slice(0, 501).map((e, i) => {
      const table = e.table === '' || e.table == null ? null : Number(e.table);
      const seat = e.seat === '' || e.seat == null ? null : Number(e.seat);
      const out = { line: i + 1, text: [e.time, e.ref, e.table, e.seat].filter((x) => x != null && x !== '').join(', '), time: String(e.time || '').trim(), ref: String(e.ref || '').trim(), table, seat };
      if (!out.ref || (table != null && !Number.isInteger(table)) || (seat != null && !Number.isInteger(seat))) out.error = 'Each line needs a ref, and whole numbers for the table and chair.';
      return out;
    });
  }
  const lines = String(body?.text || '').split(/\r?\n/).slice(0, 501);
  const out = [];
  lines.forEach((raw, i) => {
    const text = raw.trim();
    if (!text || text.startsWith('#')) return;
    const parts = text.split(/[,;\t]/).map((x) => x.trim());
    const [time, ref, table, seat] = /^\d{1,2}:\d{2}$|^\d{4}-\d{2}-\d{2}T/.test(parts[0]) ? parts : ['', ...parts];
    const e = { line: i + 1, text, time: time || '', ref: ref || '', table: table ? Number(table) : null, seat: seat ? Number(seat) : null };
    if (!e.ref || (e.table != null && !Number.isInteger(e.table)) || (e.seat != null && !Number.isInteger(e.seat))) e.error = 'Write the line as: time, ref, table, chair (for example 19:05, G-0012, 5, 3).';
    out.push(e);
  });
  return out;
}
