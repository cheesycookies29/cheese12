// CUSTOM APP → events: the guest page (US-014 public verify, US-015 status token, US-016 presence key)
// and the event rate-limit buckets it uses (US-003, AC-016/017). Replies are compared as bytes; refusal
// reasons are read the way staff read them, by the referral code.
process.env.CUSTOMAPP_VERIFY_PAD_MS = '0';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { company, eventWith, openForGuests, pub } from './support/customapp-kit.js';
import { createPublicGate, tokenHashOf, qrKeyHashOf, PUBLIC_LIMITS } from '../server/customapp/events/public.js';
import { pagePolicy } from '../server/security.js';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROWS = [
  ['R1', 'Ana', 'Dela Cruz', 'Northbay Bank', 'Banking', 'ana@example.com', '+63 917 123 4417', 'regular', 'sam', '', ''],
  ['R2', 'Juan', 'Reyes', 'Palengke', 'Retail', 'juan@example.com', '0917 123 0004', 'regular', 'tess', '', ''],
  // Two guests the page cannot tell apart by surname and last 4 (the import check lists them).
  ['R3', 'Liza', 'Ocampo', 'Palengke', 'Retail', 'liza@example.com', '0917 555 7777', 'regular', '', '', ''],
  ['R4', 'Lito', 'Ocampo', 'Harbor Life', 'Insurance', 'lito@example.com', '0918 555 7777', 'regular', '', '', ''],
  ['P1', 'Maria', 'Santos', 'Northbay Bank', 'Banking', 'maria@example.com', '0917 000 1111', 'preferred', 'sam', '1', '4'],
  ['D1', 'Desk', 'Only', 'Acme', '', 'desk@example.com', '0917 000 2222', 'regular', '', '', ''],
];
async function setup({ rows = ROWS } = {}) {
  const c = await company();
  const e = await eventWith(c, { rows });
  const code = await openForGuests(c, e);
  const verify = (body, opts) => pub(c, 'POST', `/api/public/event/${code}/verify`, { elapsedMs: 3000, ...body }, opts);
  const status = (token, q = '', opts = {}) => pub(c, 'GET', `/api/public/event/${code}/status${q}`, {}, { ...opts, headers: { ...(opts.headers || {}), 'x-event-token': token } });
  const reason = async (ref) => (await c.as.lead('GET', `${e.base}/referral/${ref}`)).reason;
  return { c, e, code, verify, status, reason };
}
// A referral reply without its code: what must be the same, byte for byte.
const sansCode = (r) => JSON.stringify(r.body).replace(/"R-\d{4}"/, '"R-****"');

describe('US-014: Public verify with a uniform referral reply', () => {
  test('GIVEN a live event and an unknown code WHEN GET /api/public/event/:code is called THEN the live event returns only name, date, state and opensAt and nothing else', async () => {
    const { c, e, code } = await setup();
    const r = await pub(c, 'GET', `/api/public/event/${code}`);
    assert.deepEqual(Object.keys(r.body).sort(), ['date', 'name', 'opensAt', 'state']);
    assert.equal(r.body.state, 'open');
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.equal((await pub(c, 'GET', '/api/public/event/no-such-event')).status, 404);
    // Answered only while live.
    const ev = await c.as.lead('GET', e.base);
    await c.as.lead('PATCH', e.base, { rev: ev.rev, status: 'draft' });
    assert.equal((await pub(c, 'GET', `/api/public/event/${code}`)).status, 404);
  });

  test('GIVEN an open window and a guest on the list WHEN POST .../verify sends the exact normalised surname and last 4 THEN commit(selfCheckIn) runs with via self and the reply is token, state, firstName and table and seat if seated', async () => {
    const { c, e, verify } = await setup();
    const r = await verify({ surname: '  dela-cruz Jr. ', last4: '4417' });
    assert.equal(r.status, 200);
    assert.match(r.body.token, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual([r.body.state, r.body.firstName, r.body.table, r.body.seat], ['pending', 'Ana', null, null]);
    const g = e.guest('R1');
    assert.equal(g.arrival.state, 'checked_in');
    assert.equal(g.arrival.via, 'qr');
    const ch = c.db.data.caChanges.at(-1);
    assert.deepEqual([ch.type, ch.via, ch.actorId], ['selfCheckIn', 'self', null]);
    // A preferred guest with a reserved chair: retrieved and confirmed; the reply has the table and seat.
    const p = await verify({ surname: 'SANTOS', email: 'Maria@Example.com' });
    assert.deepEqual([p.body.state, p.body.table, p.body.seat], ['seated', 1, 4]);
    assert.equal(e.guest('P1').seat.status, 'confirmed');
    // The plan can only check in: the guest page never seats, moves or releases.
    const src = fs.readFileSync(path.join(ROOT, 'server/customapp/events/public.js'), 'utf8');
    assert.deepEqual([...src.matchAll(/type: '([a-zA-Z.]+)'/g)].map((m) => m[1]), ['selfCheckIn']);
  });

  test('GIVEN no match, an ambiguous pair, a capped surname, a malformed body, an unlisted name, a window closed mid-request, registrationOpen false and readOnly WHEN each verifies THEN every reply has the same status and a byte-identical body apart from the R-xxx code', async () => {
    const { c, e, verify, reason } = await setup();
    const replies = [];
    const expect = async (r, why) => {
      assert.equal(r.status, 200);
      assert.match(r.body.referral, /^R-\d{4}$/);
      assert.equal(await reason(r.body.referral), why);
      replies.push(r);
    };
    await expect(await verify({ surname: 'Reyes', last4: '9999' }), 'no_match');
    await expect(await verify({ surname: 'Ocampo', last4: '7777' }), 'ambiguous');
    for (let i = 0; i < 8; i++) await verify({ surname: 'Reyes', last4: `100${i}` });
    await expect(await verify({ surname: 'Reyes', last4: '0004' }), 'capped');
    await expect(await verify({ surname: 'Reyes', last4: '12' }), 'malformed');
    await expect(await verify({ surname: 'Nobody', last4: '1234' }), 'not_listed');
    await e.cmd('lead', { type: 'guest.update', guestId: e.guest('D1').id, deskOnly: true });
    await expect(await verify({ surname: 'Only', last4: '2222' }), 'desk_only');
    // The window closes (the clock passes closesAt while the guest types).
    c.db.data.caEvents[0].window = { ...c.db.data.caEvents[0].window, closesAt: new Date(Date.now() - 1000).toISOString() };
    await expect(await verify({ surname: 'Dela Cruz', last4: '4417' }), 'window');
    c.db.data.caEvents[0].window.closesAt = new Date(Date.now() + 3600000).toISOString();
    await e.cmd('lead', { type: 'setFlag', flag: 'registrationOpen', value: false });
    await expect(await verify({ surname: 'Dela Cruz', last4: '4417' }), 'registration_closed');
    await e.cmd('lead', { type: 'setFlag', flag: 'registrationOpen', value: true });
    await e.cmd('lead', { type: 'setFlag', flag: 'readOnly', value: true });
    await expect(await verify({ surname: 'Dela Cruz', last4: '4417' }), 'read_only');
    assert.equal(new Set(replies.map(sansCode)).size, 1, 'one reply for every failure');
    assert.equal(e.guest('R1').arrival.state, 'expected');
  });

  test('GIVEN load test 1 WHEN failing and succeeding verifies are timed THEN failure replies are padded to the success path\'s timing', async () => {
    process.env.CUSTOMAPP_VERIFY_PAD_MS = '150';
    try {
      const { verify } = await setup();
      const time = async (body) => {
        const t = process.hrtime.bigint();
        await verify(body);
        return Number(process.hrtime.bigint() - t) / 1e6;
      };
      const ok = await time({ surname: 'Dela Cruz', last4: '4417' });
      const fail = await time({ surname: 'Dela Cruz', last4: '0000' });
      for (const ms of [ok, fail]) assert.ok(ms >= 145 && ms < 400, `padded to about 150 ms (${ms})`);
      assert.ok(Math.abs(ok - fail) < 80, `success ${ok} ms and failure ${fail} ms look the same`);
    } finally {
      process.env.CUSTOMAPP_VERIFY_PAD_MS = '0';
    }
  });

  test('GIVEN a spy on db.save() WHEN 1,000 failed verifies are sent THEN save is called 0 times and the in-memory maps stay within TTL 3 h and 5,000 entries', async () => {
    const { c, verify } = await setup();
    const save = c.db.save;
    let saves = 0;
    c.db.save = function spy() {
      saves++;
      return save.call(this);
    };
    try {
      const rs = await Promise.all(Array.from({ length: 1000 }, (_, i) => verify({ surname: `Stranger${i % 50}`, last4: String(1000 + i) })));
      assert.ok(rs.every((r) => r.body.state === 'referred'));
    } finally {
      c.db.save = save;
    }
    assert.equal(saves, 0, 'a failed attempt never writes the data file');
    assert.equal(PUBLIC_LIMITS.ttlMs, 3 * 3600000);
    assert.equal(PUBLIC_LIMITS.maxEntries, 5000);
    // The maps forget: past 5,000 entries the oldest go, and after 3 hours everything does.
    let t = 0;
    const gate = createPublicGate({ now: () => t });
    for (let i = 0; i < 5200; i++) gate.refer({ id: 'ev' }, 'no_match', {}, `s${i}`);
    assert.ok(gate.referrals.size <= 5000, `${gate.referrals.size} referral codes kept`);
    t = PUBLIC_LIMITS.ttlMs + 1;
    gate.referrals.prune();
    assert.equal(gate.referrals.size, 0);
    gate.stop();
  });

  test('GIVEN one surname WHEN 8 distinct wrong last-4 values arrive in 15 minutes, a wrong value is repeated, 15 minutes pass, and staff clear the cap THEN the cap trips at 8 distinct values, a repeat counts once, it clears after 15 minutes or with one tap, and nobody else is locked', async () => {
    let t = 0;
    const gate = createPublicGate({ now: () => t });
    for (let i = 0; i < 7; i++) gate.addWrong('ev', 'reyes', `m:100${i}`);
    for (let i = 0; i < 5; i++) gate.addWrong('ev', 'reyes', 'm:1000');
    assert.equal(gate.isCapped('ev', 'reyes'), false, '7 different values, one typed six times: not capped');
    gate.addWrong('ev', 'reyes', 'm:2000');
    assert.equal(gate.isCapped('ev', 'reyes'), true, 'the 8th different value caps the surname');
    assert.equal(gate.isCapped('ev', 'santos'), false, 'another surname is not touched');
    t += PUBLIC_LIMITS.capWindowMs + 1;
    assert.equal(gate.isCapped('ev', 'reyes'), false, 'clears by itself after 15 minutes');
    gate.stop();
    // Through the API: the cap, then one tap at the desk.
    const { c, e, verify, reason } = await setup();
    for (let i = 0; i < 8; i++) await verify({ surname: 'Reyes', last4: `200${i}` });
    const capped = await verify({ surname: 'Reyes', last4: '0004' });
    assert.equal(await reason(capped.body.referral), 'capped');
    assert.equal((await verify({ surname: 'Dela Cruz', last4: '4417' })).body.state, 'pending', 'nobody else is locked out');
    assert.ok((await c.as.tess('GET', `${e.base}/guests/${e.guest('R2').id}`)).capped);
    assert.equal((await c.as.tess('POST', `${e.base}/caps/clear`, { code: capped.body.referral })).cleared, 1);
    assert.equal((await verify({ surname: 'Reyes', last4: '0004' })).body.state, 'pending');
  });

  test('GIVEN 31 failures within 5 minutes WHEN the next genuine guest verifies THEN an alarm is raised to the Super Administrator and the genuine guest still succeeds', async () => {
    const { c, e, verify } = await setup();
    for (let i = 0; i < 31; i++) await verify({ surname: `Nobody${i}`, last4: '1234' });
    const ev = await c.as.lead('GET', e.base);
    assert.ok(ev.alarm && ev.alarm.failures >= 31, JSON.stringify(ev.alarm));
    assert.equal((await c.as.sam('GET', e.base)).alarm, undefined, 'the alarm is the Super Administrator\'s');
    const board = (await c.as.lead('GET', `${e.base}/changes`)).board;
    assert.ok(board.alarm);
    assert.equal((await verify({ surname: 'Dela Cruz', last4: '4417' })).body.state, 'pending');
    const audit = fs.readFileSync(path.join(c.dir, 'audit-log.jsonl'), 'utf8');
    assert.equal(audit.split('\n').filter((l) => l.includes('"customapp.alarm"')).length, 1, 'once per 5 minutes in the audit log');
  });

  test('GIVEN window.opensAt WHEN verify arrives one second before and one second after THEN the first gets the uniform referral reply and the second proceeds', async () => {
    const { c, e, verify, reason } = await setup();
    const at = (ms) => new Date(Date.now() + ms).toISOString();
    c.db.data.caEvents[0].window = { opensAt: at(1000), closesAt: at(3600000) };
    const before = await verify({ surname: 'Dela Cruz', last4: '4417' });
    assert.equal(await reason(before.body.referral), 'window');
    assert.equal((await pub(c, 'GET', `/api/public/event/${c.db.data.caEvents[0].code}`)).body.state, 'closed');
    c.db.data.caEvents[0].window.opensAt = at(-1000);
    assert.equal((await verify({ surname: 'Dela Cruz', last4: '4417' })).body.state, 'pending');
    c.db.data.caEvents[0].window.closesAt = at(-1000);
    assert.equal(await reason((await verify({ surname: 'Reyes', last4: '0004' })).body.referral), 'window', 'after closesAt too');
    assert.equal(e.guest('R2').arrival.state, 'expected');
  });

  test('GIVEN a form-encoded body, a 2 KB body, an 81-character surname, last4 abc1, a partial email, a filled trap field and a denylisted user agent WHEN each verify THEN each gets the uniform reply, no field is echoed and the order is limiter, window, match', async () => {
    const { c, e, verify, reason } = await setup();
    const cases = [
      [{ __malformed: true }, 'malformed'], // what server.js passes for a form-encoded or a 2 KB body (checked over a socket below)
      [{ surname: 'x'.repeat(81), last4: '4417' }, 'malformed'],
      [{ surname: 'Dela Cruz', last4: 'abc1' }, 'malformed'],
      [{ surname: 'Dela Cruz', email: 'ana@' }, 'malformed'],
      [{ surname: 'Dela Cruz', last4: '4417', website: 'http://spam.example' }, 'bot'],
      [{ surname: 'Dela Cruz', last4: '4417', elapsedMs: 200 }, 'too_fast'],
    ];
    for (const [body, why] of cases) {
      const r = await verify(body);
      assert.equal(await reason(r.body.referral), why, JSON.stringify(body).slice(0, 60));
      assert.doesNotMatch(JSON.stringify(r.body), /Dela|abc1|spam|xxxx/, 'nothing typed comes back');
    }
    const ua = await verify({ surname: 'Dela Cruz', last4: '4417' }, { headers: { 'user-agent': 'python-requests/2.31' } });
    assert.equal(await reason(ua.body.referral), 'bot');
    // Order: the window is checked before the input, and the limiter before the window.
    await e.cmd('lead', { type: 'setFlag', flag: 'registrationOpen', value: false });
    assert.equal(await reason((await verify({ surname: 'x'.repeat(81) })).body.referral), 'registration_closed', 'window before input');
    const gate = c.handle.customapp.gate;
    assert.ok(gate);
    const src = fs.readFileSync(path.join(ROOT, 'server/customapp/events/public.js'), 'utf8');
    const at = (s) => src.indexOf(s);
    assert.ok(at("limits.hit('event-verify'") < at('const why = closedWhy(') && at('const why = closedWhy(') < at("refer(ev, 'malformed'") && at("refer(ev, 'malformed'") < at('const named ='), 'limiter → window → input → match');
    assert.equal(e.guest('R1').arrival.state, 'expected');
  });

  test('GIVEN limits ON and TRUST_PROXY=1 WHEN 300 verifies plus status polling arrive from one x-forwarded-for THEN there are zero 429s and the soft cap still trips for a brute-forced surname', async () => {
    const before = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = '1';
    try {
      const { c, e, code } = await setup();
      // Limits ON: a second CORE over the same data with rate limits, as in production.
      const handle = createApi(c.db, { rateLimits: true });
      const venue = { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Mozilla/5.0 (iPhone)' };
      const send = async (method, url, body = {}, headers = {}) => {
        try {
          const res = await handle({ method, headers: { ...venue, ...headers }, socket: { remoteAddress: '127.0.0.1' } }, new URL(url, 'http://localhost'), body);
          return { status: 200, body: res.data };
        } catch (err) {
          return { status: err.status || 500, body: { error: err.message } };
        }
      };
      const ok = await send('POST', `/api/public/event/${code}/verify`, { surname: 'Dela Cruz', last4: '4417', elapsedMs: 3000 });
      assert.ok(ok.body.token);
      const out = [];
      for (let b = 0; b < 6; b++) {
        out.push(...(await Promise.all(Array.from({ length: 50 }, (_, i) => send('POST', `/api/public/event/${code}/verify`, { surname: i % 10 === 0 ? 'Reyes' : `Guest${b}x${i}`, last4: String(3000 + b * 50 + i), elapsedMs: 3000 })))));
        out.push(...(await Promise.all(Array.from({ length: 50 }, () => send('GET', `/api/public/event/${code}/status`, {}, { 'x-event-token': ok.body.token })))));
        out.push(...(await Promise.all(Array.from({ length: 20 }, () => send('GET', `/api/public/event/${code}`)))));
      }
      assert.equal(out.length, 720, 'far over the 120 a minute of the signed-out bucket, and the 20 an hour of public-write');
      assert.equal(out.filter((r) => r.status === 429).length, 0, 'no 429 to anyone at the venue');
      const last = await send('POST', `/api/public/event/${code}/verify`, { surname: 'Reyes', last4: '0004', elapsedMs: 3000 });
      assert.equal(handle.customapp.gate.referrals.get(last.body.referral)?.reason, 'capped', `the soft cap still trips: ${JSON.stringify(last.body)}`);
      // The per-token bucket: a stuck page is answered without work, never refused.
      const polls = out.filter((r) => r.body && 'pollMs' in r.body);
      assert.ok(polls.some((r) => r.body.unchanged), 'over the token bucket: "unchanged", not 429');
      // The per-event ceiling turns into the same referral reply (busy), never a 429.
      const many = await Promise.all(Array.from({ length: 700 }, (_, i) => send('POST', `/api/public/event/${code}/verify`, { surname: `Many${i}`, last4: '1234', elapsedMs: 3000 })));
      assert.equal(many.filter((r) => r.status === 429).length, 0);
      assert.ok(many.every((r) => r.body.state === 'referred'));
      assert.equal(handle.customapp.gate.referrals.get(many.at(-1).body.referral)?.reason, 'busy', 'past the event\'s ceiling of 900 a minute');
      assert.ok(e.guest('R1').arrival.state === 'checked_in');
    } finally {
      if (before === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = before;
    }
  });

  test('GIVEN a referral code R-482 from a failed verify WHEN staff call GET .../referral/R-482 THEN they see the real reason and what the guest typed, masked', async () => {
    const { c, e, verify } = await setup();
    const r = await verify({ surname: 'Dela Cruz', last4: '4471' });
    const ref = await c.as.sam('GET', `${e.base}/referral/${r.body.referral}`);
    assert.equal(ref.reason, 'no_match');
    assert.ok(ref.reasonText.length > 10);
    assert.deepEqual(ref.typed, { surname: 'Dela Cruz', last4: '••71', email: '' });
    assert.deepEqual(ref.guests.map((g) => g.ref), [e.guest('R1').ref]);
    assert.equal(ref.guests[0].mobile, '•••• 4417', 'the owner sees the number masked');
    assert.equal((await c.as.tess('GET', `${e.base}/referral/${r.body.referral}`)).guests[0].mobile, undefined, 'another staffer sees no contact details');
    assert.equal((await c.as.sam('GET', `${e.base}/referral/R-0000`)).status, 404);
    assert.equal((await c.as.hana('GET', `${e.base}/referral/${r.body.referral}`)).status, 403);
  });
});

describe('US-015: Guest status page and status token', () => {
  test('GIVEN a successful verify WHEN the token is issued, a sixth device verifies, staff revoke one and the server restarts THEN the token is 32 random bytes stored as SHA-256, at most 5 are kept, the revoked one fails and the rest survive the restart', async () => {
    const { c, e, verify, status, code } = await setup();
    const tokens = [];
    for (let i = 0; i < 6; i++) tokens.push((await verify({ surname: 'Dela Cruz', last4: '4417' })).body.token);
    for (const t of tokens) assert.equal(Buffer.from(t, 'base64url').length, 32);
    const g = e.guest('R1');
    assert.equal(g.statusTokens.length, 5, 'one per device, at most 5');
    assert.deepEqual(g.statusTokens.map((x) => x.hash), tokens.slice(1).map(tokenHashOf));
    assert.ok(g.statusTokens.every((x) => /^[0-9a-f]{64}$/.test(x.hash)));
    const data = fs.readFileSync(path.join(c.dir, 'db.json'), 'utf8');
    for (const t of tokens) assert.ok(!data.includes(t), 'the token itself is never stored');
    assert.equal((await status(tokens[0])).body.state, 'see_desk', 'the oldest device was dropped');
    assert.equal((await status(tokens[5])).body.state, 'pending');
    // A restart: the same data file, a new CORE.
    c.db.save();
    const again = createApi(openDb(path.join(c.dir, 'db.json')));
    const after = await again({ method: 'GET', headers: { 'x-event-token': tokens[3] }, socket: {} }, new URL(`http://localhost/api/public/event/${code}/status`), {});
    assert.equal(after.data.state, 'pending', 'tokens are kept with the event');
    // Revoked by staff (the owner): every device goes to the desk.
    assert.equal((await e.cmd('tess', { type: 'revokeTokens', guestId: g.id })).code, 'out_of_scope');
    assert.ok((await e.cmd('sam', { type: 'revokeTokens', guestId: g.id })).ok);
    assert.equal((await status(tokens[5])).body.state, 'see_desk');
  });

  test('GIVEN a valid token WHEN GET .../status is called with the token in X-Event-Token, in the query string and with ?since=seq THEN only the header works and the reply holds only this guest\'s seq, pollMs, state, title, firstName, table and seat, or unchanged', async () => {
    const { c, e, code, verify, status } = await setup();
    const t = (await verify({ surname: 'Dela Cruz', last4: '4417' })).body.token;
    await verify({ surname: 'Reyes', last4: '0004' });
    const r = await status(t);
    assert.deepEqual(Object.keys(r.body).sort(), ['checkedInAt', 'emailed', 'firstName', 'pollMs', 'seat', 'seq', 'state', 'table', 'title']);
    assert.equal(r.body.firstName, 'Ana');
    assert.doesNotMatch(JSON.stringify(r.body), /Juan|Reyes|4417|example\.com/, 'no other guest, no contact details');
    const q = await pub(c, 'GET', `/api/public/event/${code}/status?t=${t}&token=${t}`);
    assert.equal(q.body.state, 'see_desk', 'the query string is not read');
    assert.deepEqual(Object.keys((await status(t, `?since=${r.body.seq}`)).body).sort(), ['pollMs', 'seq', 'unchanged']);
    // Seated by staff: the next poll says so, with a slower pace.
    await e.cmd('sam', { type: 'assign', guestId: e.guest('R1').id, tableId: e.tables[3], seatNo: 2 });
    const s = await status(t, `?since=${r.body.seq}`);
    assert.deepEqual([s.body.state, s.body.table, s.body.seat], ['seated', 3, 2]);
    assert.ok(s.body.pollMs >= 10000 && s.body.pollMs <= 11000);
  });

  test('GIVEN a verify and 20 status polls WHEN monitor, audit and devlog output are scanned THEN the token never appears and every reply carries Cache-Control no-store and Referrer-Policy no-referrer', async () => {
    const { c, verify, status } = await setup();
    const v = await verify({ surname: 'Dela Cruz', last4: '4417' });
    const t = v.body.token;
    const replies = [v];
    for (let i = 0; i < 20; i++) replies.push(await status(t, i % 2 ? `?since=${v.body.seq}` : ''));
    for (const r of replies) {
      assert.equal(r.headers['Cache-Control'], 'no-store');
      assert.equal(r.headers['Referrer-Policy'], 'no-referrer');
    }
    c.handle.monitor.flush();
    const files = ['audit-log.jsonl', 'db.json', 'monitor.json'].map((f) => path.join(c.dir, f)).filter((f) => fs.existsSync(f));
    for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes(t), `${path.basename(f)} never holds the token`);
    assert.ok(!JSON.stringify(c.db.data.devlog || []).includes(t));
  });

  test('GIVEN a guest already checked in on one phone WHEN they verify again from a second phone THEN there is no second check-in, the same status is returned and a reverified_other_device flag is added for staff', async () => {
    const { c, e, verify } = await setup();
    const one = await verify({ surname: 'Dela Cruz', last4: '4417' });
    const at = e.guest('R1').arrival.at;
    const changes = c.db.data.caChanges.length;
    const two = await verify({ surname: 'Dela Cruz', email: 'ana@example.com' });
    assert.equal(two.body.state, one.body.state);
    assert.notEqual(two.body.token, one.body.token);
    assert.equal(e.guest('R1').arrival.at, at, 'checked in once');
    assert.deepEqual(e.guest('R1').flags.map((f) => f.kind), ['reverified_other_device']);
    assert.equal(c.db.data.caChanges.length, changes + 1);
    const sheet = await c.as.sam('GET', `${e.base}/guests/${e.guest('R1').id}`);
    assert.equal(sheet.flags.length, 1);
    assert.equal(sheet.devices, 2);
    // The Super Administrator sees them in their queue (flagged) until marked as seen.
    assert.ok((await c.as.lead('GET', `${e.base}/changes`)).board.attention.some((g) => g.id === e.guest('R1').id) || (await c.as.lead('GET', `${e.base}/changes`)).board.waiting.some((g) => g.id === e.guest('R1').id && g.why.includes('flagged')));
    await e.cmd('lead', { type: 'guest.update', guestId: e.guest('R1').id, clearFlags: true });
    assert.deepEqual(e.guest('R1').flags, []);
  });

  test('GIVEN a live event WHEN /event/<code> is requested THEN public/event.html is served under 40 KB with its CSP hash in pagePolicy, noindex and no-store and no web fonts', async () => {
    const page = fs.readFileSync(path.join(ROOT, 'public/event.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'public/js/event.js'), 'utf8');
    assert.ok(Buffer.byteLength(page) + Buffer.byteLength(script) < 40 * 1024, 'the page and its script under 40 KB');
    assert.doesNotMatch(page, /@font-face|fonts\.googleapis|\.woff|\.ttf|styles\.css/);
    const inline = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.equal(inline.length, 1);
    assert.ok(pagePolicy(ROOT).includes(`'sha256-${createHash('sha256').update(inline[0]).digest('base64')}'`), 'its inline script is allowed by hash');
    // Over a socket: the page, its headers, and the request mistakes server.js answers for the API.
    const port = await new Promise((resolve) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-ca-page-'));
    const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_FILE: path.join(dir, 'db.json'), OPEN_BROWSER: '' }, stdio: 'ignore' });
    try {
      const base = `http://127.0.0.1:${port}`;
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(`${base}/api/public/health`)).ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      const r = await fetch(`${base}/event/year-end-party-k3f9`);
      assert.equal(r.status, 200);
      assert.match(await r.text(), /js\/event\.js/);
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
      assert.match(r.headers.get('content-security-policy'), /script-src 'self' [^;]*'sha256-/);
      // Not JSON, or too large: the module is off here, so both are refused like any module call
      // (403), never a 415 or 413 that tells the page something different.
      const form = await fetch(`${base}/api/public/event/abc-defg/verify`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'surname=x&last4=1' });
      const big = await fetch(`${base}/api/public/event/abc-defg/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surname: 'x'.repeat(2048) }) });
      assert.deepEqual([form.status, big.status], [403, 403]);
    } finally {
      server.kill();
    }
  });
});

describe('US-016: Zero-typing QR presence key (Should)', () => {
  test('GIVEN an event with qrKeyHash set WHEN verify is sent with the correct k, a wrong k and no k THEN the correct key proceeds and the others get the uniform referral reply, and the key is stored only as a hash', async () => {
    const { c, e, verify, reason } = await setup();
    assert.equal(c.db.data.caEvents[0].qrKeyHash, undefined, 'off by default');
    assert.equal((await c.as.sam('POST', `${e.base}/qr-key`, { on: true })).code, 'needs_super_admin');
    const on = await c.as.lead('POST', `${e.base}/qr-key`, { on: true });
    assert.match(on.key, /^[A-Za-z0-9_-]{24}$/);
    assert.match(on.url, new RegExp(`/event/${c.db.data.caEvents[0].code}#k=`));
    assert.equal(c.db.data.caEvents[0].qrKeyHash, qrKeyHashOf(on.key));
    assert.ok(!fs.readFileSync(path.join(c.dir, 'db.json'), 'utf8').includes(on.key), 'the key itself is not kept');
    assert.ok(!JSON.stringify(c.db.data.caChanges).includes(c.db.data.caEvents[0].qrKeyHash), 'nor its hash in the change log');
    assert.equal(await reason((await verify({ surname: 'Dela Cruz', last4: '4417' })).body.referral), 'presence_key');
    assert.equal(await reason((await verify({ surname: 'Dela Cruz', last4: '4417', k: 'wrong' })).body.referral), 'presence_key');
    assert.equal((await verify({ surname: 'Dela Cruz', last4: '4417', k: on.key })).body.state, 'pending');
    await c.as.lead('POST', `${e.base}/qr-key`, { on: false });
    assert.equal(c.db.data.caEvents[0].qrKeyHash, null);
    assert.equal((await verify({ surname: 'Reyes', last4: '0004' })).body.state, 'pending');
  });
});
