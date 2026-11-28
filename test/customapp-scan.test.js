// CUSTOM APP → events: Scan QR (0.75). Staff scan a guest's invitation QR inside CORE: the link is
// parsed (only this site's event links, or a bare token), the token hashed and the guest found, or a
// plain message that names nobody. Refusal codes are asserted, and the messages the brief asked for.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { company, eventWith } from './support/customapp-kit.js';
import { parseScan, eventHosts, registerScanRoutes, SCAN_MESSAGES } from '../server/customapp/events/scan.js';
import { inviteHashOf, earlierKey } from '../server/customapp/events/model.js';
import { createRateLimiter } from '../server/ratelimit.js';
import { qrPng } from '../server/customapp/qr.js';
import { decodePng } from '../server/pdf/images.js';
import jsQR from '../public/js/vendor/jsQR.js';
import { readFrame } from '../public/js/views/customapp-scan-worker.js';

const tok = (c) => `${c}`.repeat(43).slice(0, 43);
const HOST = 'http://localhost'; // the test client's origin (no Host header)

describe('parseScan: what a scanned text is', () => {
  test('GIVEN an event link with #i=<token> WHEN parsed THEN host, code and token; the code is lower-cased and a slash at the end is fine', () => {
    assert.deepEqual(parseScan(`https://ltdc-core.com/event/Gala-K3F9#i=${tok('a')}`), { kind: 'invite', host: 'ltdc-core.com', code: 'gala-k3f9', token: tok('a') });
    assert.deepEqual(parseScan(`  http://127.0.0.1:3000/event/gala-k3f9/#i=${tok('b')}\n`), { kind: 'invite', host: '127.0.0.1:3000', code: 'gala-k3f9', token: tok('b') });
  });
  test('GIVEN a bare token WHEN parsed THEN it is a token', () => {
    assert.deepEqual(parseScan(tok('Z')), { kind: 'token', token: tok('Z') });
  });
  test('GIVEN the reception QR (with or without its presence key) WHEN parsed THEN reception', () => {
    assert.equal(parseScan('https://ltdc-core.com/event/gala-k3f9').kind, 'reception');
    assert.equal(parseScan('https://ltdc-core.com/event/gala-k3f9#k=abcdef').kind, 'reception');
  });
  test('GIVEN anything else WHEN parsed THEN garbage, another link, a bad link or empty, never a token', () => {
    assert.equal(parseScan('').kind, 'empty');
    assert.equal(parseScan(null).kind, 'empty');
    assert.equal(parseScan('WIFI:S:Venue;T:WPA;P:secret;;').kind, 'garbage');
    assert.equal(parseScan('hello world').kind, 'garbage');
    assert.equal(parseScan(`javascript:alert(1)//#i=${tok('a')}`).kind, 'garbage');
    assert.equal(parseScan(`ftp://ltdc-core.com/event/x#i=${tok('a')}`).kind, 'garbage');
    assert.equal(parseScan('x'.repeat(2001)).kind, 'garbage');
    assert.equal(parseScan(`https://ltdc-core.com/events/gala#i=${tok('a')}`).kind, 'other_link');
    assert.equal(parseScan(`https://ltdc-core.com/event/gala/extra#i=${tok('a')}`).kind, 'other_link');
    assert.equal(parseScan(`https://user:pw@ltdc-core.com/event/gala#i=${tok('a')}`).kind, 'other_link');
    assert.equal(parseScan('https://ltdc-core.com/event/gala#i=short').kind, 'bad_link');
    assert.equal(parseScan(`https://ltdc-core.com/event/gala#i=${tok('a')}x`).kind, 'bad_link');
    assert.equal(parseScan(`${tok('a')}!`).kind, 'garbage');
  });
  test('GIVEN an event WHEN its hosts are listed THEN the address in use, its public address and the ones its invitations went out on', () => {
    const hosts = eventHosts({ settings: { invitation: { publicUrl: 'https://events.example.com' } } }, [{ invite: { base: 'https://ltdc-core.com' } }, { invite: { base: '' } }, {}], 'http://10.0.0.5:3000');
    assert.deepEqual([...hosts].sort(), ['10.0.0.5:3000', 'events.example.com', 'ltdc-core.com']);
  });
});

describe('POST /api/customapp/events/:id/scan', () => {
  async function setup() {
    const c = await company({ accounts: [['lead', 'eventstaff'], ['sam', 'eventstaff'], ['tess', 'eventstaff'], ['olga', 'eventstaff'], ['hana', 'hr']] });
    const e = await eventWith(c, {
      rows: [
        ['A1', 'Ana', 'Santos', 'Northbay', '', 'ana@x.example', '09171110001', 'regular', 'sam', '', ''],
        ['A2', 'Ben', 'Reyes', 'Northbay', '', 'ben@x.example', '09171110002', 'regular', 'tess', '', ''],
        ['A3', 'Cora', 'Cruz', 'Northbay', '', 'cora@x.example', '09171110003', 'regular', 'sam', '', ''],
      ],
    });
    const ev = c.db.data.caEvents.find((x) => x.id === e.id);
    // Invitations as the invite command leaves them: only the hash is on the guest.
    const give = (ref, token, base = HOST) => (e.guest(ref).invite = { hash: inviteHashOf(token), state: 'sent', base, count: 1 });
    give('A1', tok('a'));
    give('A2', tok('b'));
    give('A3', tok('c'));
    const link = (token, code = ev.code, host = HOST) => `${host}/event/${code}#i=${token}`;
    const scan = (who, text) => c.as[who]('POST', `${e.base}/scan`, { text });
    return { c, e, ev, link, scan };
  }

  test('GIVEN a guest\'s invitation link WHEN a staff member scans it THEN the guest is found: their id and the sheet\'s view (contact details only for their own), never the token', async () => {
    const { c, e, link, scan } = await setup();
    const r = await scan('tess', link(tok('a')));
    assert.equal(r.found, true, JSON.stringify(r));
    assert.equal(r.guestId, e.guest('A1').id);
    assert.equal(r.guest.displayName, 'Ana Santos');
    assert.equal(r.guest.limited, true, 'not tess\'s guest: name, company and table only');
    assert.equal(r.guest.mobile, undefined);
    assert.equal(r.notice, undefined);
    const own = await scan('sam', link(tok('a')));
    assert.equal(own.guest.mine, true);
    assert.match(own.guest.mobile, /•••• 0001/);
    // A bare token, as some scanners give only the text after #i=.
    assert.equal((await scan('lead', tok('b'))).guestId, e.guest('A2').id, 'the Super Administrator too');
    for (const x of [r, own]) assert.ok(!JSON.stringify(x).includes(tok('a')), 'the token never comes back');
    assert.ok(!JSON.stringify(r).includes(e.guest('A1').invite.hash), 'nor its hash');
    // A lookup writes nothing: no change, no audit line (Find guest is not audited either).
    const audit = fs.readFileSync(path.join(c.dir, 'audit-log.jsonl'), 'utf8');
    assert.ok(!audit.includes(tok('a')) && !audit.includes(tok('b')), 'the token is not in the audit log');
    assert.ok(!/scan/i.test(audit.split('\n').filter((l) => l.includes(e.id)).map((l) => JSON.parse(l).action).join(' ')), 'scans are not audited');
  });

  test('GIVEN a guest already checked in WHEN scanned THEN they are found with "Already checked in at <time> by <who>", and checking in again is still refused by the command', async () => {
    const { e, link, scan } = await setup();
    assert.ok((await e.cmd('sam', { type: 'checkIn', guestId: e.guest('A3').id })).ok);
    const r = await scan('tess', link(tok('c')));
    assert.equal(r.found, true);
    assert.equal(r.notice.code, 'already_checked_in');
    assert.match(r.notice.text, /^Already checked in at \d{1,2}:\d{2}\s?[AP]M by Sam\.$/);
    assert.equal((await e.cmd('tess', { type: 'checkIn', guestId: e.guest('A3').id })).code, 'already_checked_in');
  });

  test('GIVEN an invitee with a substitute waiting, then approved WHEN their QR is scanned THEN found, with "Walk-in or substitute: …"', async () => {
    const { e, link, scan } = await setup();
    const s0 = await e.cmd('sam', { type: 'substitute', originalId: e.guest('A1').id, newGuest: { first: 'Sol', last: 'Santos', company: 'Northbay' }, note: 'Ana is unwell' });
    assert.ok(s0.ok, JSON.stringify(s0));
    const pending = await scan('sam', link(tok('a')));
    assert.equal(pending.found, true);
    assert.equal(pending.notice.code, 'substitute_pending');
    assert.match(pending.notice.text, /^Walk-in or substitute: Sol Santos is waiting for the Super Administrator's approval/);
    assert.ok((await e.cmd('lead', { type: 'approve', guestId: s0.guestId })).ok);
    const approved = await scan('tess', link(tok('a')));
    assert.equal(approved.found, true);
    assert.equal(approved.guestId, e.guest('A1').id, 'the invitee\'s sheet, which shows the substitute');
    assert.equal(approved.notice.code, 'substituted');
    assert.match(approved.notice.text, /^Walk-in or substitute: Sol Santos came in this guest's place/);
  });

  test('GIVEN a link sent again, or revoked WHEN the old QR is scanned THEN "replaced" or "revoked", naming nobody; the new link finds the guest', async () => {
    const { c, e, ev, link, scan } = await setup();
    // Sent again through the real command: the earlier hash is kept as "replaced".
    ev.settings = { ...ev.settings, emailFrom: 'events@x.example' };
    ev.status = 'live';
    const sealed = 'mem:x';
    const r1 = await c.as.lead('POST', `${e.base}/commands`, { type: 'invite', base: HOST, issues: [{ guestId: e.guest('A1').id, hash: inviteHashOf(tok('n')), sealed }] });
    assert.equal(r1.status, 400, 'invite is not a command for /commands');
    const { commit } = await import('../server/customapp/events/commit.js');
    const { createCommitContext } = await import('../server/customapp/events/commit.js');
    const ctx = createCommitContext(c.db, { now: () => new Date().toISOString() });
    const lead = c.db.data.users.find((u) => u.username === 'lead');
    commit(ctx, e.id, lead, { type: 'invite', base: HOST, issues: [{ guestId: e.guest('A1').id, hash: inviteHashOf(tok('n')), sealed }] });
    assert.deepEqual(e.guest('A1').invite.earlier, [{ h: earlierKey(inviteHashOf(tok('a'))), why: 'replaced' }]);
    const old = await scan('sam', link(tok('a')));
    assert.deepEqual([old.found, old.code, old.message], [false, 'replaced', SCAN_MESSAGES.replaced]);
    assert.match(old.message, /^This invitation link was replaced \(a newer one was sent\)/);
    assert.equal((await scan('sam', link(tok('n')))).guestId, e.guest('A1').id);
    // Revoked: the current link stops, and says so.
    assert.ok((await e.cmd('lead', { type: 'revokeInvite', guestId: e.guest('A1').id, reason: 'Forwarded' })).ok);
    const rev = await scan('sam', link(tok('n')));
    assert.deepEqual([rev.found, rev.code], [false, 'revoked']);
    assert.equal((await scan('sam', link(tok('a')))).code, 'replaced', 'the older one is still "replaced"');
    for (const x of [old, rev]) {
      assert.deepEqual(Object.keys(x).sort(), ['code', 'found', 'message'], 'nothing about the guest');
      assert.ok(!/Ana|Santos|A1/.test(JSON.stringify(x)));
    }
    // Neither the hash nor the earlier ones leave in an export.
    const exp = await c.as.lead('GET', `${e.base}/export.json`);
    const g = exp.guests.find((x) => x.id === e.guest('A1').id);
    assert.ok(g.invite && !('hash' in g.invite) && !('earlier' in g.invite), JSON.stringify(g.invite));
  });

  test('GIVEN another event\'s link, the reception QR, another site, garbage or an unknown token WHEN scanned THEN a plain refusal that reveals no guest', async () => {
    const { c, e, ev, link, scan } = await setup();
    // A second event with its own guest whose token is known.
    const other = await c.admin('POST', '/api/customapp/events', { name: 'Other Gala', date: '2026-12-10', room: { rows: 1, cols: 2, chairsPerTable: 10, stageSide: 'right' }, superAdminUserId: c.ids.lead });
    const otherEv = c.db.data.caEvents.find((x) => x.id === other.id);
    c.db.data.caGuests.push({ ...structuredClone(e.guest('A2')), id: 'other-g', eventId: other.id, invite: { hash: inviteHashOf(tok('o')), state: 'sent', base: HOST } });
    const cases = [
      [link(tok('o'), otherEv.code), 'other_event'],
      [tok('o'), 'not_invitation'], // the other event's token, bare: not this event's
      [link(tok('a'), otherEv.code), 'other_event'], // this event's token on another event's link
      [`${HOST}/event/${ev.code}`, 'reception'],
      [`${HOST}/event/${ev.code}#k=presencekey`, 'reception'],
      [link(tok('a'), ev.code, 'https://evil.example'), 'not_invitation'],
      [link(tok('z')), 'not_invitation'],
      ['WIFI:S:Ballroom;T:WPA;P:pw;;', 'not_invitation'],
      ['https://example.com/promo', 'not_invitation'],
      [`${HOST}/event/${ev.code}#i=tooshort`, 'not_invitation'],
      ['', 'empty'],
    ];
    for (const [text, code] of cases) {
      const r = await scan('sam', text);
      assert.equal(r.found, false, `${text}: ${JSON.stringify(r)}`);
      assert.equal(r.code, code, text);
      assert.equal(r.message, SCAN_MESSAGES[code]);
      assert.deepEqual(Object.keys(r).sort(), ['code', 'found', 'message']);
    }
    assert.equal(SCAN_MESSAGES.reception, 'That is the reception QR; scan the guest\'s invitation QR, or use Find guest.');
    assert.match(SCAN_MESSAGES.not_invitation, /^Not an invitation for this event/);
    assert.match(SCAN_MESSAGES.other_event, /^Not an invitation for this event/);
    // The event's public address counts as this site.
    ev.settings = { ...ev.settings, invitation: { ...(ev.settings?.invitation || {}), publicUrl: 'https://events.example.com' } };
    assert.equal((await scan('sam', link(tok('a'), ev.code, 'https://events.example.com'))).found, true);
    // A guest taken off the list is not found by their link.
    e.guest('A2').active = false;
    assert.equal((await scan('sam', link(tok('b')))).code, 'not_invitation');
  });

  test('GIVEN accounts outside the event\'s staff WHEN they scan THEN refused: no Corp Comm access 403, a CORE administrator who is not on the staff 403, an account with no part in the event 404', async () => {
    const { c, link, scan } = await setup();
    const text = link(tok('a'));
    assert.equal((await scan('hana', text)).status, 403, 'no customapp.use');
    const admin = await scan('admin', text);
    assert.equal(admin.status, 403, 'manager of events, not staff');
    assert.equal(admin.code, 'out_of_scope');
    assert.equal((await scan('olga', text)).status, 404, 'Event staff, but not on this event');
    for (const r of [admin]) assert.ok(!JSON.stringify(r).includes('Ana'));
    // Signed out: refused before anything is looked up.
    const anon = c.client();
    assert.equal((await anon('POST', `/api/customapp/events/${c.db.data.caEvents[0].id}/scan`, { text })).status, 401);
  });

  test('GIVEN one staff member WHEN they scan more than 60 times in a minute THEN 429 for them, and not for another', async () => {
    const { c, e } = await setup();
    const routes = [];
    const limits = createRateLimiter({ 'event-scan': { limit: 60, windowMs: 60000 } });
    registerScanRoutes((method, pattern, permission, handler) => routes.push({ method, pattern, handler }), c.db, { limits });
    const h = routes.find((r) => r.pattern === '/api/customapp/events/:id/scan').handler;
    const as = (u) => ({ user: c.db.data.users.find((x) => x.username === u), params: { id: e.id }, body: { text: 'nothing' }, origin: HOST });
    for (let i = 0; i < 60; i++) assert.equal(h(as('sam')).code, 'not_invitation');
    assert.throws(() => h(as('sam')), (err) => err.status === 429 && /Too many scans/.test(err.message));
    assert.equal(h(as('tess')).code, 'not_invitation');
  });
});

describe('jsQR (public/js/vendor/jsQR.js) reads CORE\'s own QR codes', () => {
  const rgba = (png) => {
    const d = decodePng(png);
    const out = new Uint8ClampedArray(d.width * d.height * 4);
    for (let i = 0; i < d.width * d.height; i++) {
      const v = d.pixels[i * d.channels];
      out.set([v, v, v, 255], i * 4);
    }
    return { data: out, width: d.width, height: d.height };
  };
  test('GIVEN invitation links, a reception link and a short text made into PNGs by server/customapp/qr.js WHEN jsQR reads them THEN it gives back the same text', () => {
    const texts = [
      `https://ltdc-core.com/event/yearend-gala-k3f9#i=${'Ab9_-'.repeat(9).slice(0, 43)}`,
      `http://127.0.0.1:41234/event/demo-gala-x7p2#i=demo-invitation-link-for-the-guides-0000001`,
      'https://ltdc-core.com/event/yearend-gala-k3f9',
      'G-0012',
    ];
    for (const text of texts) {
      for (const scale of [3, 6]) {
        const img = rgba(qrPng(text, { scale }));
        const r = jsQR(img.data, img.width, img.height);
        assert.equal(r?.data, text, `scale ${scale}`);
      }
    }
  });
  test('GIVEN a code shown inverted (a phone in dark mode) WHEN the worker\'s readFrame reads it THEN the inverted pass reads it and the plain pass does not', () => {
    const text = `https://ltdc-core.com/event/yearend-gala-k3f9#i=${'x'.repeat(43)}`;
    const img = rgba(qrPng(text, { scale: 4 }));
    for (let i = 0; i < img.data.length; i += 4) for (let k = 0; k < 3; k++) img.data[i + k] = 255 - img.data[i + k];
    const frame = (invert) => ({ width: img.width, height: img.height, data: img.data.slice().buffer, invert });
    assert.equal(readFrame(frame(true)), text);
    assert.equal(readFrame(frame(false)), null);
    assert.equal(readFrame({ width: 4, height: 4, data: new Uint8ClampedArray(64).buffer }), null, 'nothing to read: null, never a throw');
  });
  test('GIVEN the vendored file WHEN read THEN its header names the project, version, license and source, and says what changed', () => {
    const src = fs.readFileSync(new URL('../public/js/vendor/jsQR.js', import.meta.url), 'utf8');
    const head = src.split('\n').slice(0, 16).join('\n');
    assert.match(head, /jsQR 1\.4\.0/);
    assert.match(head, /Apache License 2\.0/);
    assert.match(head, /https:\/\/github\.com\/cozmo\/jsQR/);
    assert.match(head, /vendored unchanged except/);
    assert.ok(fs.existsSync(new URL('../public/js/vendor/jsQR.LICENSE.txt', import.meta.url)));
    assert.match(src, /export default jsQRHolder\.jsQR;\s*$/);
  });
});
