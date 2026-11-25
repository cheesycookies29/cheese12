// Review of ATLAS's caching and rate limits (November 2026), findings 2 to 5:
// 2. IPv6 visitors are counted by their /64 (a phone or home has a whole /64 to send from);
// 3. a file's ETag still matches after Cloudflare or Caddy compressed it (weak comparison);
// 4. calendar feeds are counted per feed, not per address (calendar apps fetch from a few shared
//    addresses), and no longer share a limit with document checks or Keycloak;
// 5. the home page's figures are worked out at most once a minute per person and campus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { limitKey, createRateLimiter } from '../server/ratelimit.js';
import { createThrottle } from '../server/auth.js';
import { etagMatches } from '../server/util.js';

const status = (code, re) => (e) => e.status === code && (!re || re.test(e.message));
async function school() {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123' });
  await admin.post('/api/admin/demo');
  const from = (ip) => async (method, path, body = {}) => {
    const res = await env.api({ method, headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: '127.0.0.1' } }, new URL(`http://localhost${path}`), body);
    return res.raw != null ? res : res.data;
  };
  return { env, admin, from };
}

test('2. IPv6: counted by the /64, in every limit and lock; IPv4 and other keys as given', async () => {
  assert.equal(limitKey('2001:db8:0:5:a:b:c:d'), '2001:db8:0:5::/64');
  assert.equal(limitKey('user:maria@2001:db8:0:5::9'), 'user:maria@2001:db8:0:5::/64');
  assert.equal(limitKey('2001:db8:0:5::1|link-1'), '2001:db8:0:5::/64|link-1');
  assert.equal(limitKey('user:maria@203.0.113.7'), 'user:maria@203.0.113.7');
  assert.equal(limitKey('5f0c9a2e-uuid'), '5f0c9a2e-uuid');
  // The limiter and the lock count a new address in the same /64 as the same visitor.
  const limits = createRateLimiter({ x: { limit: 3, windowMs: 60000 } });
  for (const a of ['2001:db8:0:5::1', '2001:db8:0:5::2', '2001:db8:0:5:ffff::3']) limits.hit('x', a);
  assert.throws(() => limits.hit('x', '2001:db8:0:5::4'), (e) => e.status === 429);
  limits.hit('x', '2001:db8:0:6::1'); // another /64: another visitor
  const lock = createThrottle({ max: 2, lockMs: 60000 });
  lock.fail('user:maria@2001:db8:0:5::1');
  lock.fail('user:maria@2001:db8:0:5::2');
  assert.throws(() => lock.check('user:maria@2001:db8:0:5::77'), (e) => e.status === 429);
  // Through the API: thirty wrong passwords, each from a new address in one /64, pause the /64.
  const f = await school();
  const students = f.env.db.data.users.filter((u) => u.role === 'student').map((u) => u.username);
  for (let i = 0; i < 30; i++) await assert.rejects(f.from(`2001:db8:0:5::${(i + 1).toString(16)}`)('POST', '/api/hub/login', { username: students[i % students.length], password: `typo-${i}` }), status(401));
  await assert.rejects(f.from('2001:db8:0:5::abcd')('POST', '/api/hub/login', { username: 'teacher.demo', password: 'demo1234' }), status(429, /wrong passwords from your network/));
  assert.equal((await f.from('2001:db8:0:6::1')('POST', '/api/hub/login', { username: 'teacher.demo', password: 'demo1234' })).user.username, 'teacher.demo');
  // The audit trail keeps the full address.
  assert.ok(f.env.api.audit.entries().some((e) => e.ip === '2001:db8:0:5::abcd'));
});

test('3. If-None-Match: weak, listed, compressed by a proxy, or *', () => {
  const tag = '"kvy-mwutae0y"';
  for (const h of [tag, `W/${tag}`, '"kvy-mwutae0y-gzip"', 'W/"kvy-mwutae0y-br"', `"other", ${tag}`, '*']) assert.ok(etagMatches(h, tag), h);
  for (const h of ['', '"kvy-mwutae0z"', 'W/"kvy-mwutae0y-xz"', '"kvy"', undefined]) assert.ok(!etagMatches(h, tag), String(h));
});

test('4. calendar feeds: counted per feed, apart from document checks and Keycloak', async () => {
  const f = await school();
  const google = f.from('203.0.113.50'); // a calendar app fetching everyone's feeds from one address
  const feed = (n) => `/api/calendar/feed/${String(n).repeat(48).slice(0, 48)}.ics`;
  // Twenty fetches of one feed in 15 minutes, then it waits…
  for (let i = 0; i < 20; i++) await assert.rejects(google('GET', feed(1)), status(404));
  await assert.rejects(google('GET', feed(1)), status(429));
  // …while the same address fetches a hundred other feeds without waiting.
  for (let i = 0; i < 100; i++) await assert.rejects(google('GET', `/api/calendar/feed/${i.toString(16).padStart(48, 'a')}.ics`), status(404));
  // Document checks keep their own limit, and Keycloak sign-in is untouched by all of it.
  const notRefused = async (path) => assert.notEqual((await google('GET', path).catch((e) => e))?.status, 429, path);
  await notRefused('/api/verify/NOPE');
  await notRefused('/api/sso/start');
});

test('5. home page figures: worked out at most once a minute per person and campus', async () => {
  const f = await school();
  const hr = f.env.client();
  await hr.post('/api/hub/login', { username: 'hr.demo', password: 'demo1234' });
  const first = await hr.get('/api/hub/figures');
  const before = first.hris.find((x) => /leave requests? waiting/.test(x)) || '';
  // A new leave request comes in; within the minute the card still shows the figures worked out above.
  const teacher = f.env.client();
  await teacher.post('/api/hub/login', { username: 'teacher.demo', password: 'demo1234' });
  await teacher.post('/api/hris/me/requests', { kind: 'remote', startDate: '2026-09-14', endDate: '2026-09-14', reason: 'x' });
  assert.deepEqual(await hr.get('/api/hub/figures'), first, 'served from the minute-long cache');
  // Each person has their own (no one sees another's figures).
  const student = f.env.client();
  await student.post('/api/hub/login', { username: 'student.demo', password: 'demo1234' });
  assert.notDeepEqual(await student.get('/api/hub/figures'), first);
  assert.ok(before === '' || /waiting/.test(before));
});
