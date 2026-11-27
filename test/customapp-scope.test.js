// CUSTOM APP → events: who may do what (Tier 0 part): the Event staff account type opens CUSTOM APP
// only (US-005), and a CORE administrator's '*' gives no guest or table writes (US-011).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { company, eventWith } from './support/customapp-kit.js';
import { ROLES, can, PERMISSION_LABELS, PERMISSION_GROUPS, confinedTo } from '../shared/roles.js';
import { moduleAccess } from '../shared/profile.js';
import { guideFor } from '../shared/help.js';

describe('US-005: CUSTOM APP module shell and the Event staff account type', () => {
  test('GIVEN an eventstaff user WHEN they call other module APIs and open the app THEN they see only CUSTOM APP and other modules answer 403', async () => {
    assert.deepEqual(ROLES.eventstaff.permissions, ['customapp.use']);
    assert.equal(ROLES.eventstaff.label, 'Event staff');
    assert.deepEqual(confinedTo({ role: 'eventstaff' }), ['customapp']);
    assert.equal(confinedTo({ role: 'admin' }), null);
    const labels = new Set(PERMISSION_LABELS.map(([p]) => p));
    assert.ok(labels.has('customapp.use') && labels.has('customapp.manage'));
    assert.deepEqual(PERMISSION_GROUPS.find((g) => g.id === 'customapp').permissions, ['customapp.use', 'customapp.manage']);
    assert.ok(can('admin', 'customapp.manage') && !can('eventstaff', 'customapp.manage') && !can('hr', 'customapp.use'));
    assert.equal(guideFor('customapp', 'eventstaff'), 'custom-app-events');
    assert.equal(guideFor('home', 'eventstaff'), 'custom-app-events');
    // Where each module opens: CUSTOM APP only (Documents and the service desk open for everyone else).
    const homes = moduleAccess({ role: 'eventstaff', id: 'x' }, { modules: { customapp: true } }).filter((m) => m.home);
    assert.deepEqual(homes.map((m) => [m.id, m.home]), [['customapp', '/customapp/queue']], 'Event staff land on My queue (Tier 1)');
    assert.ok(moduleAccess({ role: 'employee', employeeId: 'e' }, { modules: { customapp: true } }).some((m) => m.id === 'documents' && m.home), 'others still open Documents');
    const c = await company();
    const sam = c.as.sam;
    for (const url of ['/api/employees', '/api/me/profile', '/api/assets', '/api/helpdesk/mine', '/api/crm/overview', '/api/pm/overview', '/api/docs/list?view=mine', '/api/tools/pdf']) {
      const r = await sam('GET', url);
      assert.equal(r.status, 403, `${url}: ${JSON.stringify(r).slice(0, 120)}`);
    }
    assert.ok((await sam('GET', '/api/customapp/apps')).apps);
    // Even a permission the company adds to Event staff does not open another module.
    await c.admin('PUT', '/api/admin/roles', { overrides: { eventstaff: { add: ['crm.view'] } } });
    assert.equal((await sam('GET', '/api/crm/overview')).status, 403);
    // What the browser is told: the account type, so the launcher and menus show CUSTOM APP only.
    assert.equal((await sam('GET', '/api/auth/status')).user.role, 'eventstaff');
  });
});

describe('US-011: Event Super Administrator and runtime flags', () => {
  test('GIVEN a CORE admin with * who is not the event\'s superAdminUserId WHEN they post a seat command THEN it is refused with 403', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: [['A1', 'Ana', 'Cruz', 'Acme', '', 'ana@example.com', '0917 000 1111', 'regular', '', '', '']] });
    const g = e.guest('A1');
    for (const cmd of [{ type: 'checkIn', guestId: g.id }, { type: 'reserve', guestId: g.id, tableId: e.tables[3], seatNo: 1 }, { type: 'table.update', tableId: e.tables[3], capacity: 8 }]) {
      const r = await e.cmd('admin', cmd);
      assert.equal(r.status, 403, cmd.type);
      assert.ok(['out_of_scope', 'needs_super_admin'].includes(r.code), cmd.type);
    }
    assert.equal(c.db.data.caEvents[0].superAdminUserId, c.ids.lead, 'exactly one Super Administrator, and it is not the CORE administrator');
    assert.equal(g.seat, null);
  });
});

describe('US-003 (wired in 0.71): the staff sign-in allowance follows the events\' windows', () => {
  test('GIVEN events in every state WHEN windowOpen is asked THEN only a live event from 6 hours before it opens until it closes counts', async () => {
    const { windowOpen, WINDOW_LEAD_MS } = await import('../server/customapp/index.js');
    const opens = Date.parse('2026-12-09T10:00:00.000Z');
    const ev = { status: 'live', window: { opensAt: '2026-12-09T10:00:00.000Z', closesAt: '2026-12-09T15:00:00.000Z' } };
    assert.equal(WINDOW_LEAD_MS, 6 * 3600000);
    assert.equal(windowOpen(ev, opens - WINDOW_LEAD_MS - 1), false);
    assert.equal(windowOpen(ev, opens - WINDOW_LEAD_MS), true);
    assert.equal(windowOpen(ev, Date.parse('2026-12-09T15:00:00.000Z')), true);
    assert.equal(windowOpen(ev, Date.parse('2026-12-09T15:00:01.000Z')), false);
    assert.equal(windowOpen({ ...ev, status: 'draft' }, opens), false);
    assert.equal(windowOpen({ status: 'live', window: {} }, opens), false);
    const src = (await import('node:fs')).readFileSync(new URL('../server/api.js', import.meta.url), 'utf8');
    assert.match(src, /eventWindowOpen = customapp\.eventWindowOpen;/, 'the rate limits read it');
  });
});

describe('US-017: Delegation, scope enforcement and My queue', () => {
  const ROWS = [
    ['A1', 'Ana', 'Cruz', 'Acme', '', 'a1@example.com', '0917 000 0001', 'regular', 'sam', '', ''],
    ['A2', 'Ben', 'Lim', 'Acme', '', 'a2@example.com', '0917 000 0002', 'regular', 'sam', '', ''],
    ['B1', 'Cora', 'Tan', 'Acme', '', 'b1@example.com', '0917 000 0003', 'regular', 'tess', '', ''],
    ['N1', 'Dan', 'Uy', 'Acme', '', 'n1@example.com', '0917 000 0004', 'regular', '', '', ''],
  ];
  test('GIVEN guests and tables WHEN the Super Administrator delegates them and a staffer tries to delegate THEN each has at most one active owner, only the Super Administrator can delegate and no seat changes', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('A1').id });
    await e.cmd('sam', { type: 'assign', guestId: e.guest('A1').id, tableId: e.tables[3], seatNo: 2 });
    const seat = { ...e.guest('A1').seat };
    assert.equal((await e.cmd('sam', { type: 'delegateGuests', ids: [e.guest('B1').id], ownerUserId: c.ids.sam })).code, 'needs_super_admin');
    assert.equal((await e.cmd('sam', { type: 'delegateTables', ids: [e.tables[5]], ownerUserId: c.ids.sam })).code, 'needs_super_admin');
    assert.equal((await e.cmd('lead', { type: 'delegateGuests', ids: [e.guest('A1').id], ownerUserId: c.ids.hana })).status, 400, 'only active event staff can own');
    const r = await e.cmd('lead', { type: 'delegateGuests', ids: [e.guest('A1').id, e.guest('N1').id], ownerUserId: c.ids.tess });
    assert.equal(r.moved, 2);
    assert.deepEqual(e.guest('A1').seat, seat, 'the seat is not touched');
    assert.equal(e.guest('A1').ownerUserId, c.ids.tess);
    assert.ok((await e.cmd('lead', { type: 'delegateTables', ids: [e.tables[3]], ownerUserId: c.ids.tess })).ok);
    assert.equal(c.db.data.caTables.find((t) => t.id === e.tables[3]).ownerUserId, c.ids.tess, 'one owner field: never two');
    assert.deepEqual((await c.as.lead('GET', `${e.base}/invariants`)).violations, []);
  });

  test('GIVEN a transfer whose destination table belongs to another staffer WHEN the plan is checked THEN eventCan rejects the whole plan with out_of_scope or needs_super_admin', async () => {
    const { eventCan } = await import('../server/customapp/events/engine.js');
    const sam = { id: 'u-sam', role: 'staff' };
    assert.equal(eventCan(sam, 'write', { ownerUserId: 'u-sam' }), true);
    assert.equal(eventCan(sam, 'write', { ownerUserId: 'u-tess' }), false);
    assert.equal(eventCan(sam, 'checkIn', { ownerUserId: 'u-tess' }), true, 'any staffer checks anyone in');
    assert.equal(eventCan(sam, 'delegate'), false);
    assert.equal(eventCan({ id: 'u-ada', role: 'manager' }, 'write', { ownerUserId: null }), false, 'a CORE administrator is not the Super Administrator');
    assert.equal(eventCan({ id: 'x', role: 'super' }, 'delegate'), true);
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('A1').id });
    await e.cmd('sam', { type: 'assign', guestId: e.guest('A1').id, tableId: e.tables[3], seatNo: 1 });
    const t = await e.cmd('sam', { type: 'transfer', guestId: e.guest('A1').id, tableId: e.tables[5], seatNo: 1 });
    assert.equal(t.code, 'out_of_scope', 'Tess\'s table 5');
    assert.equal(e.guest('A1').seat.tableId, e.tables[3], 'nothing of the plan applied');
    // A group with one guest out of scope: the whole plan is refused.
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('A2').id });
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('B1').id });
    const g = await e.cmd('sam', { type: 'assign', placements: [{ guestId: e.guest('A2').id, tableId: e.tables[4], seatNo: 1 }, { guestId: e.guest('B1').id, tableId: e.tables[4], seatNo: 2 }] });
    assert.equal(g.code, 'out_of_scope');
    assert.equal(e.guest('A2').seat, null);
  });

  test('GIVEN staffer A owns guests and tables WHEN the Super Administrator reallocates them to B THEN A\'s next write gets 403, B can write and confirmed claims stay intact', async () => {
    const c = await company();
    const e = await eventWith(c, { rows: ROWS });
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('A1').id });
    await e.cmd('sam', { type: 'assign', guestId: e.guest('A1').id, tableId: e.tables[3], seatNo: 1 });
    await e.cmd('sam', { type: 'checkIn', guestId: e.guest('A2').id });
    await e.cmd('lead', { type: 'delegateGuests', fromUserId: c.ids.sam, ownerUserId: c.ids.tess });
    await e.cmd('lead', { type: 'delegateTables', fromUserId: c.ids.sam, ownerUserId: c.ids.tess });
    const a = await e.cmd('sam', { type: 'assign', guestId: e.guest('A2').id, tableId: e.tables[4], seatNo: 1 });
    assert.deepEqual([a.status, a.code], [403, 'out_of_scope'], 'the very next request');
    assert.ok((await e.cmd('tess', { type: 'assign', guestId: e.guest('A2').id, tableId: e.tables[4], seatNo: 1 })).ok);
    assert.deepEqual([e.guest('A1').seat.tableId, e.guest('A1').seat.seatNo, e.guest('A1').seat.status], [e.tables[3], 1, 'confirmed']);
  });

  test('GIVEN owned and unowned guests, an unlisted pending guest, a flagged guest and a released preferred guest who arrived WHEN queues are derived THEN owned guests are in their owner\'s queue and the rest in the Super Administrator\'s queue', async () => {
    const { queueOf, superQueue } = await import('../server/customapp/events/board.js');
    const at = (m) => `2026-12-09T10:${String(m).padStart(2, '0')}:00.000Z`;
    const here = (m) => ({ state: 'checked_in', at: at(m) });
    const g = (id, extra) => ({ id, ref: id, eventId: 'e', active: true, classification: 'regular', arrival: { state: 'expected' }, seat: null, ...extra });
    const state = {
      event: { id: 'e', superAdminUserId: 'lead', staff: [{ userId: 'sam', active: true }, { userId: 'gone', active: false }] },
      tables: [],
      guests: [
        g('s2', { ownerUserId: 'sam', arrival: here(20) }), g('s1', { ownerUserId: 'sam', arrival: here(5) }),
        g('seated', { ownerUserId: 'sam', arrival: here(1), seat: { tableId: 't', status: 'confirmed' } }),
        g('none', { arrival: here(3) }), g('orphan', { ownerUserId: 'gone', arrival: here(4) }),
        g('unl', { classification: 'unlisted', approval: { state: 'pending' } }),
        g('flag', { ownerUserId: 'sam', arrival: here(6), seat: { tableId: 't', status: 'confirmed' }, flags: [{ kind: 'reverified_other_device', at: at(7) }] }),
        g('rel', { classification: 'preferred', ownerUserId: 'sam', arrival: here(8), released: { at: at(2) } }),
      ],
    };
    assert.deepEqual(queueOf(state, 'sam').map((x) => x.id), ['s1', 's2'], 'oldest first; the released preferred guest is not theirs to seat');
    assert.deepEqual(superQueue(state).map((x) => [x.guest.id, x.why.join()]), [['unl', 'unlisted'], ['none', 'no_owner'], ['orphan', 'no_owner'], ['flag', 'flagged'], ['rel', 'released']]);
  });
});
