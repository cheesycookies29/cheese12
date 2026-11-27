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
    assert.ok([403, 404].includes((await c.client()('GET', '/api/public/event/some-code')).status));
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
    assert.deepEqual(REFUSAL_CODES, ['stale', 'table_full', 'seat_taken', 'not_eligible', 'no_eligible_seat', 'already_checked_in', 'guest_moved', 'table_has_claims', 'op_replay_mismatch', 'read_only', 'registration_closed', 'out_of_scope', 'needs_super_admin', 'not_saved']);
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

after(() => {});
