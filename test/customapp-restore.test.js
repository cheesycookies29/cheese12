// CUSTOM APP → events: a CORE restore, "Erase all data" and demo data never roll back a live
// event (US-002, design A7), and the full backup leaves a live event's guest list out unless asked.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { company, eventWith, PW } from './support/customapp-kit.js';
import { eventDataFor } from '../server/api.js';
import { CA_COLLECTIONS } from '../server/customapp/events/model.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROWS = Array.from({ length: 12 }, (_, i) => [`R${i}`, `First${i}`, `Last${i}`, 'Acme', '', `r${i}@example.com`, `0917 000 ${1000 + i}`, 'regular', 'sam', '', '']);
const caOf = (db) => JSON.stringify(CA_COLLECTIONS.map((k) => db.data[k]));

async function liveEvent() {
  const c = await company();
  const e = await eventWith(c, { rows: ROWS });
  const ev = await c.as.lead('GET', e.base);
  await c.as.lead('PATCH', e.base, { rev: ev.rev, status: 'live' });
  return { c, e };
}

describe('US-002: Restore carve-out keeps live event data', () => {
  test('GIVEN live data with an event at seq 120 WHEN a backup taken at seq 50 is restored through replaceData() THEN caEvents, caTables, caGuests, caChanges, caOutbox and seq are unchanged', async () => {
    const { c, e } = await liveEvent();
    const backup = structuredClone(await c.admin('GET', '/api/admin/export?includeEvents=1'));
    // The event moves on after the backup: check-ins and seats up to seq 120.
    let k = 0;
    while (c.db.data.caEvents[0].seq < 120) {
      const g = e.guest(`R${k % 12}`);
      await e.cmd('sam', g.arrival.state === 'checked_in' ? { type: 'undoCheckIn', guestId: g.id } : { type: 'checkIn', guestId: g.id });
      k++;
    }
    backup.caEvents[0].seq = 50; // as the older copy says
    const live = caOf(c.db);
    assert.equal(c.db.data.caEvents[0].seq, 120);
    const r = await c.admin('POST', '/api/admin/import', { ...backup, password: PW });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(caOf(c.db), live, 'every ca* collection as it was');
    assert.equal(c.db.data.caEvents[0].seq, 120);
    assert.deepEqual(eventDataFor({ caEvents: [{ id: 'live', demo: true }] }, { caEvents: [{ id: 'b' }] }).caEvents, [{ id: 'b' }], 'only the demo event: the backup\'s is taken');
  });

  test('GIVEN a live event WHEN an admin runs Erase all data or loads demo data THEN the live ca* collections and seq are untouched', async () => {
    const { c } = await liveEvent();
    const live = caOf(c.db);
    assert.ok((await c.admin('POST', '/api/admin/demo')).ok);
    assert.equal(caOf(c.db), live, 'demo data adds no demo event beside a real one');
    assert.ok((await c.admin('DELETE', '/api/admin/demo')).ok);
    assert.equal(caOf(c.db), live);
    assert.ok((await c.admin('POST', '/api/admin/reset')).ok);
    assert.equal(caOf(c.db), live, 'erasing all data leaves the event as it is');
    assert.equal(c.db.data.employees.length, 0, 'while the rest is erased');
  });

  test('GIVEN live data with no events (the standby) WHEN a backup that holds an event is restored THEN the backup\'s ca* collections are taken', async () => {
    const { c } = await liveEvent();
    const backup = structuredClone(await c.admin('GET', '/api/admin/export?includeEvents=1'));
    const standby = await company({ accounts: [] });
    assert.equal(standby.db.data.caEvents.length, 0);
    const r = await standby.admin('POST', '/api/admin/import', { ...backup, password: PW });
    assert.ok(r.ok, JSON.stringify(r));
    for (const k of CA_COLLECTIONS) assert.equal(JSON.stringify(standby.db.data[k]), JSON.stringify(backup[k]), k);
    // A demo event on the standby does not count as an event of its own.
    const s2 = await company({ accounts: [] });
    await s2.admin('POST', '/api/admin/demo');
    assert.equal(s2.db.data.caEvents.length, 1);
    await s2.admin('POST', '/api/admin/import', { ...backup, password: PW });
    assert.deepEqual(s2.db.data.caEvents.map((x) => x.name), ['Test Gala']);
  });

  test('GIVEN deploy/aws/RESTORE.md WHEN section 1 is read THEN it carries the boxed warning that it is forbidden while an event is live', () => {
    const md = fs.readFileSync(path.join(ROOT, 'deploy/aws/RESTORE.md'), 'utf8');
    const s1 = md.slice(md.indexOf('## 1. '), md.indexOf('## 2. '));
    assert.match(s1, /^> \*\*FORBIDDEN WHILE AN EVENT IS LIVE \(CUSTOM APP\)\.\*\*/m, 'a boxed warning (a quote block) at the top of section 1');
    assert.ok(s1.indexOf('FORBIDDEN') < s1.indexOf('1. In the AWS console'), 'before the first step');
  });

  test('GIVEN a live event WHEN /api/admin/export is downloaded with and without include events THEN event PII is left out by default and ticking include events adds it and writes an audit entry', async () => {
    const { c } = await liveEvent();
    const plain = await c.admin('GET', '/api/admin/export');
    for (const k of CA_COLLECTIONS) assert.deepEqual(plain[k], [], k);
    assert.ok(!JSON.stringify(plain).includes('r3@example.com'));
    assert.deepEqual(plain.eventsOmitted.events, ['Test Gala']);
    assert.equal(c.db.data.caGuests.length, 12, 'only the download leaves it out');
    const full = await c.admin('GET', '/api/admin/export?includeEvents=1');
    assert.equal(full.caGuests.length, 12);
    const audit = fs.readFileSync(path.join(c.dir, 'audit-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(audit.filter((a) => a.action === 'data.export').length, 1);
    assert.equal(audit.filter((a) => a.action === 'data.export-events').length, 1, 'ticking include events is recorded as such');
    // Restoring a backup that left the event out does not empty the event.
    await c.admin('POST', '/api/admin/import', { ...plain, password: PW });
    assert.equal(c.db.data.caGuests.length, 12);
    // The restore screen says so while an event is live (the page reads the events list).
    assert.match(fs.readFileSync(path.join(ROOT, 'public/js/views/admin/data.js'), 'utf8'), /Event data is not part of a CORE restore/);
  });
});
