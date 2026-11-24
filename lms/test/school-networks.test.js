// School networks (Admin panel → Sign-in and passwords): a campus reaches the internet through one or
// two addresses, so limits counted per address treated the whole campus as one visitor (thirty typos
// locked everyone out; sixty sign-ins a minute was the campus's limit). Listed networks get those
// limits multiplied; everywhere else they are unchanged, so password spraying from the internet still
// meets the usual limit, and one username still locks after its own wrong passwords.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './support.js';
import { parseNetwork, networkMatcher, networkOf } from '../server/ratelimit.js';

const CAMPUS = '203.0.113.7';
const HOME = '198.51.100.20';

async function school() {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123' });
  await admin.post('/api/admin/demo');
  // A request from `ip`, as Caddy on this computer passes it on (X-Forwarded-For from 127.0.0.1).
  const from = (ip) => async (method, path, body = {}) => {
    const res = await env.api({ method, headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: '127.0.0.1' } }, new URL(`http://localhost${path}`), body);
    return res.raw != null ? res : res.data;
  };
  const students = env.db.data.users.filter((u) => u.role === 'student').map((u) => u.username);
  const setNetworks = (schoolNetworks, extra = {}) => admin.put('/api/admin/settings', { security: { schoolNetworks, ...extra } });
  return { env, admin, from, students, setNetworks };
}
const status = (code, re) => (e) => e.status === code && (!re || re.test(e.message));

test('school networks: addresses and ranges, checked; IPv6 by its /64', () => {
  assert.deepEqual(parseNetwork(' 203.0.113.7 '), { cidr: '203.0.113.7/32', family: 'ipv4' });
  assert.deepEqual(parseNetwork('2001:DB8:1::/48'), { cidr: '2001:db8:1::/48', family: 'ipv6' });
  assert.throws(() => parseNetwork('10.0.0.0/8'), /too wide/);
  assert.throws(() => parseNetwork('2001:db8::/16'), /too wide/);
  assert.throws(() => parseNetwork('127.0.0.1'), /own address/);
  assert.throws(() => parseNetwork('::1'), /own address/);
  assert.throws(() => parseNetwork('campus'), /not an address/);
  assert.throws(() => parseNetwork('203.0.113.0/40'), /0 to 32/);
  const on = networkMatcher();
  const list = [{ cidr: '203.0.113.0/24' }, { cidr: '2001:db8:1::/48' }];
  assert.deepEqual([on(list, '203.0.113.200'), on(list, HOME), on(list, '2001:db8:1:7::9'), on(list, '2001:db8:2::1'), on(list, 'unknown')], [true, false, true, false, false]);
  assert.equal(networkOf('2001:db8:0:5:a:b:c:d'), '2001:db8:0:5::/64');
  assert.equal(networkOf(CAMPUS), CAMPUS);
});

test('a campus that shares one address: thirty typos lock it out unless it is a school network', async () => {
  const f = await school();
  const campus = f.from(CAMPUS);
  const typos = async () => {
    for (let i = 0; i < 30; i++) await assert.rejects(campus('POST', '/api/hub/login', { username: f.students[i % f.students.length], password: `typo-${i}` }), status(401));
  };
  // Not listed: as before, the whole campus waits.
  await typos();
  await assert.rejects(campus('POST', '/api/hub/login', { username: 'teacher.demo', password: 'demo1234' }), status(429, /wrong passwords from your network/));
  // Listed (a fresh school, so the counts start again): the teacher signs in.
  const g = await school();
  await g.setNetworks([{ cidr: '203.0.113.0/24', label: 'Main Campus' }]);
  const c2 = g.from(CAMPUS);
  for (let i = 0; i < 30; i++) await assert.rejects(c2('POST', '/api/hub/login', { username: g.students[i % g.students.length], password: `typo-${i}` }), status(401));
  assert.equal((await c2('POST', '/api/hub/login', { username: 'teacher.demo', password: 'demo1234' })).user.username, 'teacher.demo');
  // Somewhere else, the usual limit is unchanged.
  const home = g.from(HOME);
  for (let i = 0; i < 30; i++) await assert.rejects(home('POST', '/api/hub/login', { username: g.students[i % g.students.length], password: `typo-${i}` }), status(401));
  await assert.rejects(home('POST', '/api/hub/login', { username: 'teacher.demo', password: 'demo1234' }), status(429));
});

test('a school network still stops password spraying, at the multiplied limit; one username still locks', async () => {
  const f = await school();
  await f.setNetworks(['203.0.113.0/24'], { schoolNetworkFactor: 2, signInFailuresPerAddress: 10 });
  const campus = f.from(CAMPUS);
  // 10 wrong passwords per address × 2: the 21st try is refused, whoever it is for.
  for (let i = 0; i < 20; i++) await assert.rejects(campus('POST', '/api/hub/login', { username: `nobody${i}`, password: 'Spring2026!' }), status(401));
  await assert.rejects(campus('POST', '/api/hub/login', { username: 'nobody99', password: 'Spring2026!' }), status(429, /wrong passwords from your network/));
  // One username, from a school network: locked after its own wrong passwords, as anywhere.
  const g = await school();
  await g.setNetworks(['203.0.113.0/24']);
  const c2 = g.from(CAMPUS);
  for (let i = 0; i < 5; i++) await assert.rejects(c2('POST', '/api/hub/login', { username: 'teacher.demo', password: `wrong-${i}` }), status(401));
  await assert.rejects(c2('POST', '/api/hub/login', { username: 'teacher.demo', password: 'demo1234' }), status(429, /Too many failed attempts/));
});

test('sign-ins per minute: sixty for an address, many more for a school network', async () => {
  const f = await school();
  const campus = f.from(CAMPUS);
  for (let i = 0; i < 60; i++) await campus('POST', '/api/hub/login', { username: 'teacher.demo', password: 'demo1234' });
  await assert.rejects(campus('POST', '/api/hub/login', { username: 'teacher.demo', password: 'demo1234' }), status(429, /Too many requests/));
  const g = await school();
  await g.setNetworks([{ cidr: CAMPUS, label: 'Main Campus' }]);
  const c2 = g.from(CAMPUS);
  for (let i = 0; i < 150; i++) await c2('POST', '/api/hub/login', { username: 'teacher.demo', password: 'demo1234' });
  assert.equal((await c2('POST', '/api/hub/login', { username: 'teacher.demo', password: 'demo1234' })).user.username, 'teacher.demo');
});

test('Keycloak sign-ins have their own limit, not shared with calendar feeds and document checks', async () => {
  const f = await school();
  const campus = f.from(HOME);
  // Sixty calendar-feed fetches (made-up addresses: not found) use up the "lookup" limit…
  for (let i = 0; i < 60; i++) await assert.rejects(campus('GET', `/api/calendar/feed/${'0'.repeat(47)}${i % 10}.ics`), status(404));
  await assert.rejects(campus('GET', `/api/calendar/feed/${'1'.repeat(48)}.ics`), status(429));
  // …but Keycloak sign-in is not refused for it (here it is not set up, so it answers otherwise).
  await assert.rejects(campus('GET', '/api/sso/start'), (e) => e.status !== 429);
  // Its own limit: 120 a minute per address.
  for (let i = 0; i < 119; i++) await campus('GET', '/api/sso/start').catch(() => {});
  await assert.rejects(campus('GET', '/api/sso/start'), status(429));
});

test('settings: checked, de-duplicated, kept with a label; the suggestions are for administrators', async () => {
  const f = await school();
  await assert.rejects(f.setNetworks(['10.0.0.0/8']), status(400, /too wide/));
  await assert.rejects(f.setNetworks(['localhost']), status(400, /not an address/));
  await assert.rejects(f.setNetworks(Array.from({ length: 51 }, (_, i) => `203.0.${i}.0/24`)), status(400, /up to 50/));
  await assert.rejects(f.setNetworks([], { schoolNetworkFactor: 500 }), status(400));
  await f.setNetworks([{ cidr: '203.0.113.0/24', label: '  Main\nCampus ' }, '203.0.113.0/24', { cidr: '2001:db8:1::/48' }]);
  assert.deepEqual(f.env.db.data.settings.security.schoolNetworks, [{ cidr: '203.0.113.0/24', label: 'Main Campus' }, { cidr: '2001:db8:1::/48', label: '' }]);
  // Suggestions: this browser's address, and where people signed in from (with whether it is covered).
  for (const u of ['teacher.demo', 'student.demo', 'registrar.demo']) await f.from(CAMPUS)('POST', '/api/hub/login', { username: u, password: 'demo1234' });
  await f.from('192.0.2.50')('POST', '/api/hub/login', { username: 'staff.demo', password: 'demo1234' });
  const s = await f.admin.get('/api/admin/school-networks');
  assert.equal(s.factor, 20);
  const campus = s.busiest.find((b) => b.network === CAMPUS);
  assert.deepEqual([campus.people, campus.covered], [3, true]);
  assert.deepEqual(s.busiest.find((b) => b.network === '192.0.2.50').covered, false);
  const registrar = f.env.client();
  await registrar.post('/api/hub/login', { username: 'registrar.demo', password: 'demo1234' });
  await assert.rejects(registrar.get('/api/admin/school-networks'), status(403));
});
