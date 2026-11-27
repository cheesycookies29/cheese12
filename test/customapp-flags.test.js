// CUSTOM APP → events: the runtime switches (US-011): registrationOpen, emailPaused, readOnly and
// pollMs, changed by the event's Super Administrator alone, audited, applied on the next request.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, newCtx, commitAs, codeOf, USERS, company, eventWith } from './support/customapp-kit.js';
import { FLAGS } from '../shared/customapp/statuses.js';

describe('US-011: Event Super Administrator and runtime flags', () => {
  test('GIVEN a staffer and the Super Administrator WHEN each sends setFlag for registrationOpen, emailPaused, readOnly and pollMs THEN only the Super Administrator succeeds and each change is audited', async () => {
    assert.deepEqual([...FLAGS], ['registrationOpen', 'emailPaused', 'readOnly', 'pollMs']);
    const c = await company();
    const e = await eventWith(c);
    const values = { registrationOpen: true, emailPaused: false, readOnly: true, pollMs: 4000 };
    const before = fs.readFileSync(path.join(c.dir, 'audit-log.jsonl'), 'utf8').split('\n').length;
    for (const [flag, value] of Object.entries(values)) {
      assert.equal((await e.cmd('sam', { type: 'setFlag', flag, value })).code, 'needs_super_admin', flag);
      assert.equal((await e.cmd('admin', { type: 'setFlag', flag, value })).code, 'needs_super_admin', `${flag}: not a CORE administrator either`);
      assert.ok((await e.cmd('lead', { type: 'setFlag', flag, value })).ok, flag);
    }
    assert.deepEqual(c.db.data.caEvents[0].flags, values);
    const audit = fs.readFileSync(path.join(c.dir, 'audit-log.jsonl'), 'utf8').split('\n').slice(before - 1).filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a.action === 'customapp.flag');
    assert.deepEqual(audit.map((a) => a.note.split(':')[0]), Object.keys(values));
    assert.equal((await e.cmd('lead', { type: 'setFlag', flag: 'pollMs', value: 50 })).status, 400, 'pollMs has bounds');
    assert.equal((await e.cmd('lead', { type: 'setFlag', flag: 'selfDestruct', value: true })).status, 400);
  });

  test('GIVEN each of the four flags WHEN its effect is traced THEN it is checked inside commit() or returned in the poll reply', () => {
    const src = fs.readFileSync(new URL('../server/customapp/events/commit.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../server/customapp/events/engine.js', import.meta.url), 'utf8');
    assert.match(src, /flags\?\.readOnly/, 'readOnly: commit()');
    assert.match(src, /flags\?\.registrationOpen/, 'registrationOpen: the guest-page check-in in the engine');
    // emailPaused and pollMs have no effect in Tier 0 beyond being carried: emailPaused is read by
    // the outbox (Tier 2) and pollMs is returned with the event (and in every poll reply, Tier 1).
    const db = fixture({ guests: [{ ref: 'A' }] });
    const self = (cmd) => commitAs(newCtx(db), 'ev1', { synthetic: 'self' }, cmd);
    assert.equal(codeOf(() => self({ type: 'selfCheckIn', guestId: 'g-A' })), 'registration_closed');
    db.data.caEvents[0].flags.registrationOpen = true;
    self({ type: 'selfCheckIn', guestId: 'g-A' });
    // A window that has not opened yet keeps it closed even when the switch is on.
    const db2 = fixture({ guests: [{ ref: 'A' }], flags: { registrationOpen: true } });
    assert.equal(codeOf(() => commitAs(newCtx(db2, () => '2026-12-09T09:00:00.000Z'), 'ev1', { synthetic: 'self' }, { type: 'selfCheckIn', guestId: 'g-A' })), 'registration_closed');
  });

  test('GIVEN readOnly is on WHEN staff post any command, the Super Administrator posts a reconcile command and anyone reads THEN commands get 409 read_only, the reconcile command is accepted and reads are served', () => {
    const db = fixture({ tables: [{ n: 1, owner: 'sam' }], guests: [{ ref: 'A', owner: 'sam' }, { ref: 'B', owner: 'sam' }], flags: { readOnly: true } });
    const ctx = newCtx(db);
    const as = (who) => (cmd) => commitAs(ctx, 'ev1', USERS[who], cmd);
    for (const cmd of [{ type: 'checkIn', guestId: 'g-A' }, { type: 'assign', guestId: 'g-A', tableId: 't1', seatNo: 1 }, { type: 'table.add', number: 7 }]) {
      assert.equal(codeOf(() => as('sam')(cmd)), 'read_only', cmd.type);
      assert.equal(codeOf(() => as('lead')(cmd)), 'read_only', `${cmd.type}: the Super Administrator too, unless reconciling`);
    }
    assert.equal(codeOf(() => as('sam')({ type: 'checkIn', guestId: 'g-A', via: 'reconcile' })), 'read_only', 'reconciling is the Super Administrator\'s');
    as('lead')({ type: 'checkIn', guestId: 'g-A', via: 'reconcile', occurredAt: '2026-12-09T10:55:00.000Z', opId: 'paper-1' });
    const g = db.data.caGuests[0];
    assert.deepEqual([g.arrival.state, g.arrival.via, g.arrival.at], ['checked_in', 'reconcile', '2026-12-09T10:55:00.000Z']);
    assert.equal(db.data.caChanges.at(-1).occurredAt, '2026-12-09T10:55:00.000Z');
    assert.equal(db.data.caChanges.at(-1).via, 'reconcile');
    // The switch itself can still be turned off.
    as('lead')({ type: 'setFlag', flag: 'readOnly', value: false });
    as('sam')({ type: 'checkIn', guestId: 'g-B' });
  });

  test('GIVEN a running server WHEN a flag is changed THEN the next request reflects it with no restart or deploy', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: [['A1', 'Ana', 'Cruz', 'Acme', '', 'ana@example.com', '0917 000 1111', 'regular', 'sam', '', '']] });
    const g = e.guest('A1');
    await e.cmd('lead', { type: 'setFlag', flag: 'readOnly', value: true });
    assert.equal((await e.cmd('sam', { type: 'checkIn', guestId: g.id })).code, 'read_only');
    assert.equal((await c.as.sam('GET', `${e.base}/guests?q=cruz`)).total, 1, 'reads are served');
    assert.equal((await c.as.sam('GET', e.base)).flags.readOnly, true);
    await e.cmd('lead', { type: 'setFlag', flag: 'readOnly', value: false });
    assert.ok((await e.cmd('sam', { type: 'checkIn', guestId: g.id })).ok);
    await e.cmd('lead', { type: 'setFlag', flag: 'pollMs', value: 8000 });
    assert.equal((await c.as.sam('GET', e.base)).flags.pollMs, 8000);
  });
});
