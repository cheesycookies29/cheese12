// CUSTOM APP → events through CORE's API (handle()): the module shell (US-005), event routes
// (US-006), the unit of work's guarantees (US-007), Find guest (US-010), the Super Administrator
// handover (US-011) and the module switch during an event (US-002). Codes are asserted, never text.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { company, eventWith, PW } from './support/customapp-kit.js';
import { HttpError, errorBody } from '../server/util.js';
import { mutation } from '../server/customapp/events/routes.js';
import { REFUSALS, REFUSAL_CODES } from '../shared/customapp/refusals.js';
import { APPS } from '../server/customapp/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Every refusal code this file sees, with its status: checked against the catalogue at the end.
const seen = new Map();
const saw = (r) => {
  if (r?.code && REFUSALS[r.code]) seen.set(r.code, r.status);
  return r;
};
const auditLines = (c) => fs.readFileSync(path.join(c.dir, 'audit-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const ROWS = [
  ['P1', 'Maria', 'Santos', 'Northbay Bank', 'Banking', 'maria@example.com', '+63 917 123 4417', 'preferred', 'sam', '1', '1'],
  ['P2', 'Jose', 'Reyes', 'Harbor Life', 'Insurance', 'jose@example.com', '09171230002', 'preferred', '', '1', '2'],
  ['R1', 'Ana', 'Cruz', 'Northbay Bank', 'Banking', 'ana@example.com', '0917 123 0003', 'regular', 'sam', '', ''],
  ['R2', 'Juan', 'Dela Cruz', 'Palengke', 'Retail', 'juan@example.com', '0917 123 0004', 'regular', 'tess', '', ''],
  ['R3', 'Liza', 'Ocampo', 'Palengke', 'Retail', 'liza@example.com', '0917 123 0005', 'regular', '', '', ''],
  ['E1', 'Paolo', 'Tan', 'Host Co', '', 'paolo@example.com', '0917 123 0006', 'employee', '', '', ''],
];

describe('US-005: CUSTOM APP module shell and the Event staff account type', async () => {
  const c = await company();
  test('GIVEN a signed-in user with customapp.use WHEN GET /api/customapp/apps is called THEN the registry lists exactly one app, events', async () => {
    const r = await c.as.sam('GET', '/api/customapp/apps');
    assert.deepEqual(r.apps.map((a) => a.id), ['events']);
    assert.deepEqual(APPS.map((a) => a.id), ['events']);
    assert.equal((await c.as.hana('GET', '/api/customapp/apps')).status, 403, 'an HR Manager has no customapp.use');
  });
  test('GIVEN the module switched off WHEN /api/customapp/* or /api/public/event/* is called THEN both refuse', async () => {
    await c.admin('PUT', '/api/admin/modules', { modules: { customapp: false } });
    assert.equal((await c.as.sam('GET', '/api/customapp/apps')).status, 403);
    // The guest pages (/api/public/event/…, Tier 1) belong to the module, so they are refused with it.
    const { moduleOfApi } = await import('../shared/modules.js');
    assert.equal(moduleOfApi('POST', '/api/public/event/some-code/verify'), 'customapp');
    // With the guest page's routes in place (Tier 1), it is a 403 with the module's message, never a 404.
    for (const [m, u] of [['GET', '/api/public/event/some-code'], ['POST', '/api/public/event/some-code/verify'], ['GET', '/api/public/event/some-code/status']]) {
      const r = await c.client()(m, u, { surname: 'x', last4: '1234' });
      assert.equal(r.status, 403, `${m} ${u}`);
      assert.match(r.error, /Corp Comm YEP tool is turned off/);
    }
    assert.ok((await c.admin('GET', '/api/customapp/apps')).apps, 'administrators still open a module that is off');
    await c.admin('PUT', '/api/admin/modules', { modules: { customapp: true } });
    assert.ok((await c.as.sam('GET', '/api/customapp/apps')).apps);
  });
});

describe('US-006: Event, table and industry setup', async () => {
  const c = await company();
  test('GIVEN users with and without a role in an event WHEN they call GET/POST /api/customapp/events and PATCH /:id with an old rev THEN create needs customapp.manage, the list shows only their events and the stale PATCH gets 409 stale', async () => {
    assert.equal((await c.as.lead('POST', '/api/customapp/events', { name: 'Mine' })).status, 403, 'creating needs customapp.manage');
    const e = await eventWith(c, { rows: ROWS });
    assert.deepEqual((await c.as.sam('GET', '/api/customapp/events')).events.map((x) => [x.id, x.role]), [[e.id, 'staff']]);
    assert.deepEqual((await c.as.lead('GET', '/api/customapp/events')).events.map((x) => x.role), ['super']);
    assert.deepEqual((await c.admin('GET', '/api/customapp/events')).events.map((x) => x.role), ['manager'], 'a CORE administrator sees it, with no seating role');
    await c.admin('POST', '/api/users', { name: 'Olga', username: 'olga', role: 'eventstaff', password: PW, mustChangePassword: false });
    const olga = c.client();
    await olga('POST', '/api/auth/login', { username: 'olga', password: PW });
    assert.deepEqual((await olga('GET', '/api/customapp/events')).events, [], 'not on the staff: no event');
    assert.equal((await olga('GET', e.base)).status, 404);
    const ev = await c.as.lead('GET', e.base);
    const ok = await c.as.lead('PATCH', e.base, { rev: ev.rev, venue: 'Grand Ballroom' });
    assert.equal(ok.venue, 'Grand Ballroom');
    assert.equal(ok.rev, ev.rev + 1);
    assert.equal(saw(await c.as.lead('PATCH', e.base, { rev: ev.rev, venue: 'Old' })).code, 'stale');
    assert.equal(saw(await c.as.sam('PATCH', e.base, { rev: ok.rev, venue: 'Mine now' })).code, 'needs_super_admin');
    assert.equal((await c.as.lead('PATCH', e.base, { venue: 'No rev' })).status, 400);
  });
});

describe('US-007: commit() unit of work, claimsAt(), invariants and typed refusals', async () => {
  const c = await company();
  const e = await eventWith(c, { rows: ROWS });
  test('GIVEN server/customapp/events/commit.js and engine.js WHEN their source is searched THEN neither contains await', () => {
    for (const f of ['commit.js', 'engine.js']) {
      const src = fs.readFileSync(path.join(ROOT, 'server/customapp/events', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
      assert.doesNotMatch(src, /\bawait\b|\basync\b|\.then\(/, f);
    }
  });
  test('GIVEN mutation() WHEN it is given an AsyncFunction at startup or a handler that returns a thenable at run time THEN it refuses both', () => {
    assert.throws(() => mutation(async () => ({})), /synchronous/);
    const late = mutation(() => Promise.resolve({}));
    assert.throws(() => late({}), /promise/);
    assert.deepEqual(mutation(() => ({ ok: 1 }))({}), { ok: 1 });
  });
  test('GIVEN db.save() stubbed to throw WHEN a command is posted THEN the reply is 503 not_saved, the in-memory state is unchanged, nothing is audited and nothing is queued', async () => {
    const g = e.guest('R1');
    const before = JSON.stringify([c.db.data.caGuests, c.db.data.caEvents, c.db.data.caChanges]);
    const lines = auditLines(c).length;
    const save = c.db.save;
    c.db.save = () => {
      throw new Error('disk full');
    };
    const r = saw(await e.cmd('sam', { type: 'checkIn', guestId: g.id, opId: 'save-fails' }));
    c.db.save = save;
    assert.equal(r.status, 503);
    assert.equal(r.code, 'not_saved');
    assert.equal(JSON.stringify([c.db.data.caGuests, c.db.data.caEvents, c.db.data.caChanges]), before, 'nothing changed in memory');
    assert.equal(auditLines(c).length, lines, 'nothing audited');
    assert.equal(c.db.data.caOutbox.length, 0, 'nothing queued');
    // The same opId works once the disk does: the failed attempt left no trace.
    assert.ok((await e.cmd('sam', { type: 'checkIn', guestId: g.id, opId: 'save-fails' })).ok);
  });
  test('GIVEN a successful command WHEN the audit log is read THEN there is exactly one entry, labelled with the guest ref and a masked name and never the mobile or email', async () => {
    const g = e.guest('R2');
    const lines = auditLines(c).length;
    assert.ok((await e.cmd('tess', { type: 'checkIn', guestId: g.id })).ok);
    const added = auditLines(c).slice(lines);
    assert.equal(added.length, 1);
    assert.equal(added[0].action, 'customapp.check-in');
    assert.equal(added[0].label, `${g.ref} Juan D.`);
    const text = JSON.stringify(added[0]);
    assert.ok(!text.includes('juan@example.com') && !text.includes('1230004') && !text.includes('123 0004') && !text.includes('Dela Cruz'), text);
  });
  test('GIVEN the frozen refusal catalogue WHEN the suite runs THEN every code in shared/customapp/refusals.js is produced by at least one test with its catalogue status', async () => {
    assert.ok(Object.isFrozen(REFUSALS));
    assert.deepEqual(REFUSAL_CODES, ['stale', 'table_full', 'seat_taken', 'not_eligible', 'no_eligible_seat', 'already_checked_in', 'guest_moved', 'table_has_claims', 'op_replay_mismatch', 'read_only', 'registration_closed', 'rsvp_closed', 'out_of_scope', 'needs_super_admin', 'not_saved']);
    // The codes not produced above, through the API, each by the situation that should produce it.
    const t = e.tables;
    const p1 = e.guest('P1');
    const r3 = e.guest('R3');
    const e1 = e.guest('E1');
    saw(await e.cmd('sam', { type: 'checkIn', guestId: p1.id }));
    saw(await e.cmd('sam', { type: 'checkIn', guestId: p1.id }));
    saw(await e.cmd('lead', { type: 'checkIn', guestId: r3.id }));
    saw(await e.cmd('lead', { type: 'checkIn', guestId: e1.id }));
    saw(await e.cmd('lead', { type: 'assign', guestId: r3.id, tableId: t[1], seatNo: 5 })); // not_eligible: a preferred table
    saw(await e.cmd('lead', { type: 'assign', guestId: r3.id, tableId: t[3], seatNo: 1, opId: 'o1' }));
    saw(await e.cmd('lead', { type: 'assign', guestId: r3.id, tableId: t[3], seatNo: 2, opId: 'o1' })); // op_replay_mismatch
    saw(await e.cmd('lead', { type: 'assign', guestId: r3.id, tableId: t[3], seatNo: 2 })); // guest_moved
    saw(await e.cmd('lead', { type: 'assign', guestId: e1.id, tableId: t[6], seatNo: 1 }));
    const r1 = e.guest('R1');
    saw(await e.cmd('sam', { type: 'assign', guestId: r1.id, tableId: t[3], seatNo: 1 })); // seat_taken
    saw(await e.cmd('sam', { type: 'assign', guestId: r1.id, tableId: t[5], seatNo: 1 })); // out_of_scope (tess's table)
    saw(await e.cmd('lead', { type: 'table.update', tableId: t[3], active: false })); // table_has_claims
    // table_full and no_eligible_seat: a one-chair employee table, then the last chair taken.
    await e.cmd('lead', { type: 'table.update', tableId: t[6], capacity: 1 });
    await c.as.lead('PATCH', e.base, { rev: (await c.as.lead('GET', e.base)).rev, settings: { mixedTables: true } });
    await e.cmd('lead', { type: 'table.update', tableId: t[4], classification: 'mixed', capacity: 1 });
    await e.cmd('lead', { type: 'table.update', tableId: t[3], capacity: 1 });
    const extra = (await c.as.lead('POST', `${e.base}/import`, { format: 'csv', data: 'Ref,First name,Surname,Classification\nE2,Kim,Lee,employee\nE3,Rio,Go,employee' })).jobId;
    await c.as.lead('POST', `${e.base}/import/${extra}/apply`, {});
    const e2 = e.guest('E2');
    const e3 = e.guest('E3');
    await e.cmd('lead', { type: 'checkIn', guestId: e2.id });
    await e.cmd('lead', { type: 'checkIn', guestId: e3.id });
    saw(await e.cmd('lead', { type: 'assign', guestId: e2.id, tableId: t[6], seatNo: 1 })); // table_full: table 4 (mixed) has room
    await e.cmd('lead', { type: 'assign', guestId: e2.id, tableId: t[4], seatNo: 1 });
    saw(await e.cmd('lead', { type: 'assign', guestId: e3.id, tableId: t[6], seatNo: 1 })); // no_eligible_seat
    // read_only and registration_closed: the switches (registration_closed comes from the engine's
    // guest-page check-in, Tier 1, through the same commit).
    await e.cmd('lead', { type: 'setFlag', flag: 'readOnly', value: true });
    saw(await e.cmd('sam', { type: 'checkIn', guestId: e.guest('R2').id }));
    await e.cmd('lead', { type: 'setFlag', flag: 'readOnly', value: false });
    const { commit } = await import('../server/customapp/events/commit.js');
    const { createCommitContext } = await import('../server/customapp/events/commit.js');
    try {
      commit(createCommitContext(c.db), e.id, { synthetic: 'self' }, { type: 'selfCheckIn', guestId: e.guest('R2').id });
    } catch (err) {
      saw({ code: err.code, status: err.status });
    }
    // rsvp_closed (0.74): a reply on an invitation link after replies closed (the deadline passed).
    const { inviteHashOf } = await import('../server/customapp/events/model.js');
    const r4 = c.db.data.caGuests.find((g) => g.eventId === e.id && g.arrival?.state !== 'checked_in' && g.classification !== 'unlisted');
    const ev0 = await c.as.lead('GET', e.base);
    await c.as.lead('PATCH', e.base, { rev: ev0.rev, settings: { invitation: { rsvpDeadline: '2026-01-01T09:00' } } });
    c.db.data.caGuests = c.db.data.caGuests.map((g) => (g.id === r4.id ? { ...g, invite: { hash: inviteHashOf('t'.repeat(43)), state: 'sent' } } : g));
    try {
      commit(createCommitContext(c.db), e.id, { synthetic: 'rsvp' }, { type: 'rsvp', guestId: r4.id, answer: 'yes', inviteHash: inviteHashOf('t'.repeat(43)) });
    } catch (err) {
      saw({ code: err.code, status: err.status });
    }
    for (const code of REFUSAL_CODES) {
      assert.ok(seen.has(code), `no test produced ${code}`);
      assert.equal(seen.get(code), REFUSALS[code].status, `${code} answered ${seen.get(code)}`);
    }
  });
  test('GIVEN HttpError(status, message, {code, fresh}) and an existing two-argument caller WHEN handle() serialises them THEN the reply is {error, code, fresh} and the old callers are unchanged', () => {
    const old = new HttpError(400, 'Bad');
    assert.deepEqual([old.status, old.message, 'code' in old, 'fresh' in old], [400, 'Bad', false, false]);
    assert.deepEqual(errorBody(old), { error: 'Bad' });
    assert.deepEqual(errorBody(new HttpError(409, 'Full', { code: 'table_full', fresh: { seq: 3 } })), { error: 'Full', code: 'table_full', fresh: { seq: 3 } });
    assert.deepEqual(errorBody(Object.assign(new Error('ENOENT: /secret/path'), { code: 'ENOENT' })), { error: 'Something went wrong. Check the terminal for details.' }, 'a crash says nothing about itself');
    assert.deepEqual(errorBody(Object.assign(new Error('Too large'), { status: 413, code: 'X' })), { error: 'Too large' }, 'only CORE\'s HttpError carries a code');
    assert.match(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'), /send\(res, status, errorBody\(err\)/);
  });
  test('GIVEN a committed command with opId X WHEN it is replayed with the same body, with a different body, and after a restart THEN the same body returns the prior result without a write, a different body gets op_replay_mismatch, and the map is rebuilt from caChanges', async () => {
    const g = e.guest('R2');
    await c.as.lead('POST', `${e.base}/commands`, { type: 'checkIn', guestId: g.id }).catch(() => {});
    const body = { type: 'assign', guestId: g.id, tableId: e.tables[5], seatNo: 4, opId: 'wifi-retry' };
    const first = await e.cmd('tess', body);
    assert.ok(first.ok, JSON.stringify(first));
    const n = c.db.data.caChanges.length;
    const seq = c.db.data.caEvents[0].seq;
    const again = await e.cmd('tess', body);
    assert.equal(again.replay, true);
    assert.equal(again.seq, first.seq);
    assert.deepEqual(again.seats, first.seats);
    assert.equal(c.db.data.caChanges.length, n, 'no second write');
    assert.equal(c.db.data.caEvents[0].seq, seq);
    assert.equal(saw(await e.cmd('tess', { ...body, seatNo: 5 })).code, 'op_replay_mismatch');
    // After a restart: a new CORE on the same data file knows the opId from caChanges.
    const c2 = await company({ file: c.db.file, accounts: [['tess', 'eventstaff']], moduleOn: false });
    const replay = await c2.as.tess('POST', `${e.base}/commands`, body);
    assert.equal(replay.replay, true);
    assert.equal((await c2.as.tess('POST', `${e.base}/commands`, { ...body, seatNo: 6 })).code, 'op_replay_mismatch');
  });
});

describe('US-010: Staff Find guest and seating screens', async () => {
  const c = await company();
  const e = await eventWith(c, { rows: ROWS });
  test('GIVEN an owner and a non-owner staffer WHEN they search GET .../guests?q=&class=&status=&table= by partial name or company THEN the owner sees masked contact fields and the non-owner sees name, company, industry and table only', async () => {
    const mine = (await c.as.sam('GET', `${e.base}/guests?q=sant`)).guests;
    assert.deepEqual(mine.map((g) => g.ref), [e.guest('P1').ref], 'partial surname');
    assert.equal(mine[0].mobile, '•••• 4417');
    assert.equal(mine[0].email, 'm•••@example.com');
    const theirs = (await c.as.tess('GET', `${e.base}/guests?q=sant`)).guests[0];
    assert.equal(theirs.limited, true);
    assert.deepEqual([theirs.displayName, theirs.company, theirs.industry, theirs.seat.number], ['Maria Santos', 'Northbay Bank', 'Banking', 1]);
    for (const k of ['mobile', 'email', 'designation', 'externalKey']) assert.ok(!(k in theirs), `${k} is not shown to a non-owner`);
    assert.equal((await c.as.tess('GET', `${e.base}/guests?q=northbay`)).total, 2, 'by company');
    assert.equal((await c.as.tess('GET', `${e.base}/guests?q=delacruz`)).total, 1, 'a surname typed without its space');
    assert.equal((await c.as.tess('GET', `${e.base}/guests?class=preferred`)).total, 2);
    assert.equal((await c.as.tess('GET', `${e.base}/guests?table=1`)).total, 2);
    assert.equal((await c.as.tess('GET', `${e.base}/guests?status=reserved`)).total, 2);
    assert.equal((await c.admin('GET', `${e.base}/guests?q=a`)).code, 'out_of_scope', 'a CORE administrator is not event staff');
  });
  test('GIVEN a staffer who does not own the guest WHEN they check the guest in and then try to seat them THEN check-in succeeds and seating is refused with out_of_scope', async () => {
    const r1 = e.guest('R1'); // sam's guest
    assert.ok((await e.cmd('tess', { type: 'checkIn', guestId: r1.id })).ok);
    assert.equal((await e.cmd('tess', { type: 'assign', guestId: r1.id, tableId: e.tables[5], seatNo: 1 })).code, 'out_of_scope');
    assert.ok((await e.cmd('sam', { type: 'assign', guestId: r1.id, tableId: e.tables[3], seatNo: 1 })).ok);
    const sheet = await c.as.tess('GET', `${e.base}/guests/${r1.id}`);
    assert.equal(sheet.canSeat, false);
    assert.deepEqual(sheet.history, [], 'history is for the owner');
    const own = await c.as.sam('GET', `${e.base}/guests/${r1.id}`);
    assert.deepEqual(own.history.map((h) => h.type), ['assign', 'checkIn']);
  });
});

describe('US-011: Event Super Administrator and runtime flags', async () => {
  const c = await company();
  const e = await eventWith(c, { rows: ROWS });
  test('GIVEN a CORE admin WHEN POST .../super-admin is called without customapp.manage, without password re-entry, without a reason, and then with all three THEN only the last succeeds, the old holder is revoked in the same commit, it is audited and exactly one Super Administrator remains', async () => {
    const url = `${e.base}/super-admin`;
    assert.equal((await c.as.lead('POST', url, { userId: c.ids.sam, password: PW, reason: 'x' })).status, 403, 'the Super Administrator cannot hand it over: customapp.manage');
    assert.equal((await c.admin('POST', url, { userId: c.ids.sam, reason: 'Lea is ill' })).status, 400, 'password');
    assert.equal((await c.admin('POST', url, { userId: c.ids.sam, password: 'wrong', reason: 'Lea is ill' })).status, 400, 'right password');
    assert.equal((await c.admin('POST', url, { userId: c.ids.sam, password: PW })).status, 400, 'reason');
    assert.equal(c.db.data.caEvents[0].superAdminUserId, c.ids.lead);
    // Lea owns table 6 (so the handover's revocation has something to take back).
    const lines = fs.readFileSync(path.join(c.dir, 'audit-log.jsonl'), 'utf8').split('\n').length;
    const r = await c.admin('POST', url, { userId: c.ids.sam, password: PW, reason: 'Lea is ill' });
    assert.equal(r.superAdmin.name, 'Sam');
    const ev = c.db.data.caEvents[0];
    assert.equal(ev.superAdminUserId, c.ids.sam);
    assert.ok(!ev.staff.some((s) => s.userId === c.ids.lead || s.userId === c.ids.sam), 'Lea revoked, Sam no longer listed as staff');
    assert.equal((await c.as.lead('GET', e.base)).status, 404, 'the old holder lost the event at once');
    assert.equal((await e.cmd('lead', { type: 'checkIn', guestId: e.guest('R3').id })).status, 404);
    assert.equal(c.db.data.caChanges.at(-1).type, 'setSuperAdmin');
    const audit = fs.readFileSync(path.join(c.dir, 'audit-log.jsonl'), 'utf8').split('\n').slice(lines - 1).filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(audit.filter((a) => a.action === 'customapp.super-admin').length, 1);
    assert.deepEqual((await c.as.sam('GET', `${e.base}/invariants`)).violations, []);
    // A CORE administrator's '*' still gives no seat authority.
    assert.equal((await e.cmd('admin', { type: 'checkIn', guestId: e.guest('R3').id })).code, 'out_of_scope');
  });
});

describe('US-002: Restore carve-out keeps live event data', async () => {
  const c = await company();
  const e = await eventWith(c, { rows: ROWS });
  test('GIVEN an event whose window is open WHEN Admin panel Modules tries to switch CUSTOM APP off THEN it is refused unless the event Super Administrator confirms', async () => {
    // A live event whose doors opened an hour ago.
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const ev = await c.as.lead('GET', e.base);
    await c.as.lead('PATCH', e.base, { rev: ev.rev, status: 'live', window: { opensAt: iso(now - 3600000), closesAt: iso(now + 3600000) } });
    const off = await c.admin('PUT', '/api/admin/modules', { modules: { customapp: false } });
    assert.equal(off.status, 409);
    assert.equal(off.code, 'event_window_open');
    assert.equal((await c.admin('PUT', '/api/admin/modules', { modules: { customapp: false }, confirmEventOff: true })).status, 409, 'a confirmation by someone who is not the Super Administrator does not count');
    assert.equal(c.db.data.modules.customapp, true);
    // The Super Administrator (an administrator here, designated through the audited handover) confirms.
    await c.admin('POST', `${e.base}/super-admin`, { userId: c.ids.admin, password: PW, reason: 'Switch-off drill' });
    assert.equal((await c.admin('PUT', '/api/admin/modules', { modules: { customapp: false } })).status, 409, 'still needs the confirmation');
    assert.equal((await c.admin('PUT', '/api/admin/modules', { modules: { customapp: false }, confirmEventOff: true })).config.customapp, false);
    // Outside the window, it switches like any module.
    await c.admin('PUT', '/api/admin/modules', { modules: { customapp: true } });
    const ev2 = await c.admin('GET', e.base);
    await c.admin('PATCH', e.base, { rev: ev2.rev, status: 'closed' });
    assert.equal((await c.admin('PUT', '/api/admin/modules', { modules: { customapp: false } })).config.customapp, false);
  });
});

describe('US-022: Unlisted guests and substitutes (API)', () => {
  test('GIVEN an approval and a substitution WHEN the guest\'s history is read THEN it lists each approval and change with actor and time from caChanges', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    const w = await e.cmd('sam', { type: 'createUnlisted', guest: { first: 'Lorna', last: 'Bautista', company: 'Northbay Bank' }, note: 'At the desk' });
    await e.cmd('lead', { type: 'approve', guestId: w.guestId, classification: 'regular', ownerUserId: c.ids.sam, note: 'Host confirmed' });
    const hist = (await c.as.lead('GET', `${e.base}/guests/${w.guestId}`)).history;
    assert.deepEqual(hist.map((h) => [h.type, h.by]), [['approve', 'Lead'], ['createUnlisted', 'Sam']], 'newest first, each with who');
    assert.ok(hist.every((h) => /^\d{4}-\d{2}-\d{2}T/.test(h.at)), 'and when');
    assert.equal(hist[0].reason, 'Host confirmed');
    assert.ok(hist[0].diff.some((d) => d.f === 'approval' && d.to === 'approved'));
    // A substitute for a preferred guest with a reserved seat: recorded by staff, approved by the
    // Super Administrator; both guests' histories show both steps, from caChanges.
    const s = await e.cmd('tess', { type: 'substitute', originalId: e.guest('P2').id, newGuest: { first: 'Juan', last: 'Reyes' }, note: 'Jose is unwell' });
    await e.cmd('lead', { type: 'approve', guestId: s.guestId });
    const orig = (await c.as.lead('GET', `${e.base}/guests/${e.guest('P2').id}`)).history;
    assert.deepEqual(orig.slice(0, 2).map((h) => [h.type, h.by]), [['approve', 'Lead'], ['substitute', 'Tess']]);
    const sheet = await c.as.lead('GET', `${e.base}/guests/${s.guestId}`);
    assert.equal(sheet.substitute.line, 'Seat 1-2: Juan Reyes replaces Jose Reyes');
    const changes = c.db.data.caChanges.filter((x) => x.guestIds.includes(s.guestId));
    assert.deepEqual(changes.map((x) => [x.type, x.actorId]), [['substitute', c.ids.tess], ['approve', c.ids.lead]]);
    const audit = auditLines(c).map((a) => a.action);
    for (const a of ['customapp.walkin', 'customapp.approve', 'customapp.substitute']) assert.ok(audit.includes(a), a);
  });
});

describe('US-024: Event control dashboard', () => {
  test('GIVEN a fixture event WHEN the dashboard data is requested THEN Invited, Checked in, Not yet arrived, Waiting for table, Needs approval and Seats left match a recount from the source', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('P1').id });
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('R1').id });
    await e.cmd('tess', { type: 'checkIn', guestId: e.guest('R2').id });
    await e.cmd('sam', { type: 'assign', guestId: e.guest('R1').id, tableId: e.tables[3], seatNo: 1 });
    await e.cmd('sam', { type: 'createUnlisted', guest: { last: 'Walkin' }, note: 'x' });
    const w2 = await e.cmd('sam', { type: 'createUnlisted', guest: { last: 'Approved' }, note: 'x' });
    await e.cmd('lead', { type: 'approve', guestId: w2.guestId, classification: 'regular' });
    const board = (await c.as.lead('GET', `${e.base}/changes?tab=control`)).board;
    const ev = await c.as.lead('GET', e.base);
    // The recount, straight from the data file.
    const gs = c.db.data.caGuests.filter((g) => g.eventId === e.id && g.active !== false);
    const listed = gs.filter((g) => g.classification !== 'unlisted');
    const here = gs.filter((g) => g.arrival.state === 'checked_in');
    const cap = c.db.data.caTables.filter((t) => t.eventId === e.id && t.active).reduce((n, t) => n + t.capacity, 0);
    const want = { invited: listed.length, checkedIn: here.length, notArrived: listed.filter((g) => g.arrival.state === 'expected').length, waiting: here.filter((g) => !g.seat).length, needsApproval: gs.filter((g) => g.approval?.state === 'pending').length, seatsLeft: cap - gs.filter((g) => g.seat).length };
    for (const counts of [board.counts, ev.counts]) for (const [k, v] of Object.entries(want)) assert.equal(counts[k], v, k);
    assert.deepEqual([want.invited, want.checkedIn, want.notArrived, want.waiting, want.needsApproval], [6, 4, 3, 2, 1]);
    assert.equal((await c.as.sam('GET', `${e.base}/changes?tab=control`)).code, 'needs_super_admin', 'Event control\'s board is the Super Administrator\'s');
  });

  test('GIVEN a walk-in, a substitute, a No seat in scope referral, a released reservation whose guest arrived, a capped surname and a failure-rate alarm WHEN the exceptions inbox is read THEN each appears', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    await e.cmd('sam', { type: 'createUnlisted', guest: { first: 'Lorna', last: 'Bautista' }, note: 'Walk-in' });
    await e.cmd('tess', { type: 'substitute', originalId: e.guest('P2').id, newGuest: { first: 'Juan', last: 'Reyes' }, note: 'Unwell' });
    // Sam owns the employee E1 but no employee table: no seat in his scope.
    await e.cmd('lead', { type: 'guest.update', guestId: e.guest('E1').id, ownerUserId: c.ids.sam });
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('E1').id });
    // A preferred guest whose reservation was released, who then arrives.
    await e.cmd('lead', { type: 'release', guestId: e.guest('P1').id, reason: 'No-show' });
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('P1').id });
    // A capped surname and the failure alarm, as the guest page's gate keeps them.
    const gate = c.handle.customapp.gate;
    const ev = c.db.data.caEvents.find((x) => x.id === e.id);
    for (let i = 0; i < 8; i++) gate.addWrong(ev.id, 'delacruz', `l:${1000 + i}`);
    for (let i = 0; i < 31; i++) gate.refer(ev, 'no_match', {}, 'zzz');
    const items = (await c.as.lead('GET', `${e.base}/exceptions`)).items;
    const kinds = items.map((i) => i.kind);
    for (const k of ['walkin', 'substitute', 'no_seat_in_scope', 'released_arrived', 'capped', 'alarm']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
    assert.equal(kinds[0], 'alarm', 'the alarm on top');
    assert.equal(items.find((i) => i.kind === 'substitute').title, 'Seat 1-2: Juan Reyes replaces Jose Reyes');
    assert.deepEqual(items.find((i) => i.kind === 'capped').guestIds, [e.guest('R2').id], 'the guests with that surname');
    assert.deepEqual(items.find((i) => i.kind === 'no_seat_in_scope').guestIds, [e.guest('E1').id]);
    assert.deepEqual(items.find((i) => i.kind === 'released_arrived').guestIds, [e.guest('P1').id]);
    // The same inbox is on Event control's board, and only the Super Administrator's.
    assert.deepEqual((await c.as.lead('GET', e.base)).exceptions.map((i) => i.kind), kinds);
    assert.equal((await c.as.sam('GET', `${e.base}/exceptions`)).code, 'needs_super_admin');
  });

  test('GIVEN a running event WHEN the health strip is read THEN it shows seq, save p95, outbox depth, the age of the newest export, the 429 count and the self-check result, and a violation raises the banner', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    let ev = await c.as.lead('GET', e.base);
    await c.as.lead('PATCH', e.base, { rev: ev.rev, status: 'live' });
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('R1').id });
    await e.cmd('sam', { type: 'assign', guestId: e.guest('R1').id, tableId: e.tables[3], seatNo: 1 });
    const { safety, note429 } = c.handle.customapp;
    safety.writeCopies();
    safety.selfCheck();
    note429(`/api/customapp/events/${e.id}/changes`);
    note429(`/api/public/event/${c.db.data.caEvents.find((x) => x.id === e.id).code}/verify`);
    const h = (await c.as.lead('GET', `${e.base}/changes?tab=control`)).board.health;
    ev = await c.as.lead('GET', e.base);
    assert.equal(h.seq, ev.seq);
    assert.ok(typeof h.saveP95Ms === 'number' && h.saveP95Ms >= 0 && h.saves > 0, 'save p95 from the real saves');
    assert.deepEqual(h.outbox, { queued: 1, sending: 0, sent: 0, failed: 0 }, 'the seat email waits (email is paused)');
    assert.ok(h.copy.at && h.copy.seq === ev.seq, 'the newest 5-minute copy');
    assert.equal(h.tooMany, 2, '429s on this event in the last 15 minutes');
    assert.deepEqual(h.check.violations, []);
    // A violation (forced by hand: never possible through commit()) raises the banner.
    c.db.data.caGuests.find((g) => g.id === e.guest('R1').id).seat = { tableId: e.tables[3], seatNo: 11, status: 'confirmed' };
    safety.selfCheck();
    const bad = (await c.as.lead('GET', e.base)).health;
    assert.deepEqual(bad.check.violations.map((v) => v.rule), ['I3']);
  });
});

describe('US-025: Offline pack and paper reconciliation (API)', () => {
  test('GIVEN paper entries including one that would overbook a table WHEN Reconcile paper seating replays them THEN each goes through commit() with via reconcile, occurredAt and an opId, and the overbooking is refused and listed as a recovery card', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    await e.cmd('lead', { type: 'table.update', tableId: e.tables[3], capacity: 2 });
    // Working on paper: the event is read only; the Super Administrator still enters the sheets.
    await e.cmd('lead', { type: 'setFlag', flag: 'readOnly', value: true });
    const text = ['# Sam\'s sheet', '19:05, R1, 3, 1', '19:06, R3, 3, 2', '19:07, R2, 3, 1', '19:08, E1', 'nonsense line'].join('\n');
    assert.equal((await c.as.sam('POST', `${e.base}/reconcile`, { text })).code, 'needs_super_admin');
    const n0 = c.db.data.caChanges.length;
    const r = await c.as.lead('POST', `${e.base}/reconcile`, { text });
    assert.equal(r.lines, 5);
    assert.deepEqual(r.cards.map((x) => [x.line, x.code]), [[4, 'table_full'], [6, 'unknown_guest']], 'the overbooking is a recovery card, not applied (and a line that names nobody too)');
    assert.equal(r.applied, 6, 'R1 and R3 in and seated, R2 checked in, E1 checked in');
    assert.equal(e.guest('R2').seat, null, 'R2 was not put on the full table');
    assert.equal(c.db.data.caTables.filter((t) => t.id === e.tables[3]).length, 1);
    assert.equal(c.db.data.caGuests.filter((g) => g.seat?.tableId === e.tables[3]).length, 2, 'never over the table\'s 2 chairs');
    const made = c.db.data.caChanges.slice(n0);
    assert.equal(made.length, 6);
    for (const ch of made) {
      assert.equal(ch.via, 'reconcile');
      assert.match(ch.opId, /^paper:[0-9a-f]{24}:(in|seat)$/);
      assert.match(ch.occurredAt, /^2026-12-09T11:0[5-8]:00\.000Z$/, 'the time on the paper (Manila), as UTC');
    }
    assert.equal(e.guest('R1').arrival.via, 'reconcile');
    assert.equal(e.guest('R1').arrival.at, '2026-12-09T11:05:00.000Z');
    assert.deepEqual((await c.as.lead('GET', `${e.base}/invariants`)).violations, []);
  });

  test('GIVEN a paper sheet already reconciled WHEN it is entered again THEN no duplicate check-in or seat is created', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    const text = '19:05, R1, 3, 1\n19:06, R3, 3, 2\n19:08, E1';
    const first = await c.as.lead('POST', `${e.base}/reconcile`, { text });
    assert.deepEqual([first.applied, first.already, first.cards.length], [5, 0, 0]);
    const data = JSON.stringify(c.db.data.caGuests);
    const n = c.db.data.caChanges.length;
    const again = await c.as.lead('POST', `${e.base}/reconcile`, { text });
    assert.deepEqual([again.applied, again.cards.length], [0, 0], 'nothing new');
    assert.equal(again.already, 3);
    assert.equal(c.db.data.caChanges.length, n, 'no change recorded');
    assert.equal(JSON.stringify(c.db.data.caGuests), data, 'no duplicate check-in or seat');
    // The same entries as a list (opIds from the line): still nothing new.
    const list = await c.as.lead('POST', `${e.base}/reconcile`, { entries: [{ time: '19:05', ref: 'R1', table: 3, seat: 1 }] });
    assert.deepEqual([list.applied, list.already], [0, 1]);
  });
});

after(() => {});
