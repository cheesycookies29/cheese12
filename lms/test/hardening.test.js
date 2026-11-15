// The API hardening of November 2026 (items 1–5 of the API security review): one test per
// protection, so each stays in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync, randomBytes } from 'node:crypto';
import { setup } from './support.js';
import { checkStructure, checkBody, safeReviver, t } from '../server/validate.js';
import { parseCookies, createSessions, cookieName, sessionCookie, needsRehash, verifyPassword, hashPassword } from '../server/auth.js';
import { privateAddress } from '../server/sso.js';

const PW = 'password123';
const status = (code) => (e) => e.status === code;

async function school(options = {}) {
  const env = setup({ options });
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: PW });
  return { env, admin };
}
// One request with the headers given (a browser's, say), straight to the API.
const raw = (env, method, path, body, headers = {}, socket) => env.api({ method, headers, socket }, new URL(`http://localhost${path}`), body);

// ----- 1. Input validation -----
test('1. bodies: prototype keys are dropped or refused, nesting and size are bounded, declared fields only', async () => {
  // The JSON reader leaves out keys that could reach a prototype.
  const parsed = JSON.parse('{"__proto__":{"polluted":1},"a":{"constructor":{"prototype":{"x":1}}},"b":2}', safeReviver);
  assert.deepEqual(Object.keys(parsed), ['a', 'b']);
  assert.deepEqual(parsed.a, {});
  assert.equal(({}).polluted, undefined);

  // Any body that reaches the dispatcher another way is checked too.
  assert.throws(() => checkStructure([1, 2]), /JSON object/);
  assert.throws(() => checkStructure(JSON.parse('{"x":{"constructor":1}}')), /does not accept \(constructor\)/);
  let deep = {};
  const top = deep;
  for (let i = 0; i < 14; i++) deep = deep.n = {};
  assert.throws(() => checkStructure(top), /nested too deeply/);
  assert.throws(() => checkStructure({ ['k'.repeat(201)]: 1 }), /field name that is too long/);

  // A route's own fields: types and sizes checked, anything else removed.
  const spec = { name: t.str(10), n: t.int(0, 5), on: t.bool(), tags: t.arr(t.str(5), 2), sub: t.obj({ a: t.str(3) }) };
  assert.deepEqual(checkBody({ name: 'Ana', n: '3', on: 'true', tags: ['x'], sub: { a: 'y', b: 'z' }, role: 'admin' }, spec), { name: 'Ana', n: 3, on: true, tags: ['x'], sub: { a: 'y' } });
  assert.throws(() => checkBody({ name: 'x'.repeat(11) }, spec), /too long/);
  assert.throws(() => checkBody({ n: 9 }, spec), /between 0 and 5/);
  assert.throws(() => checkBody({ tags: ['a', 'b', 'c'] }, spec), /too many items/);
  assert.throws(() => checkBody({ name: { $gt: '' } }, spec), /must be text/);

  // Through the API: an account made with extra fields gets none of them.
  const { env, admin } = await school();
  const campus = [env.db.data.campuses[0].id];
  const u = await admin.post('/api/system/users', { role: 'staff', username: 'sam', name: 'Sam', password: PW, campusIds: campus, status: 'disabled', passwordHash: 'x', access: { add: ['finance.view'] }, mustChangePassword: false });
  const stored = env.db.data.users.find((x) => x.id === u.id);
  assert.equal(stored.status, 'active');
  assert.equal(stored.access, undefined);
  assert.notEqual(stored.passwordHash, 'x');
  await assert.rejects(admin.post('/api/system/users', { role: 'staff', username: { $ne: 1 }, name: 'X', password: PW, campusIds: campus }), (e) => e.status === 400 && /username must be text/.test(e.message));
  await assert.rejects(raw(env, 'POST', '/api/hub/login', [{ username: 'admin' }]), status(400));
});

test('1. settings paths: no way to the prototype through Restore defaults or the history', async () => {
  const { admin } = await school();
  for (const path of ['__proto__.polluted', 'constructor.prototype.polluted', 'security.__proto__', 'security.nope', 'security.idleHours.x']) {
    await assert.rejects(admin.post('/api/admin/config/reset', { area: 'security', path }), (e) => e.status === 400 && /does not exist/.test(e.message), path);
  }
  assert.equal(({}).polluted, undefined);
  await admin.put('/api/admin/settings', { security: { idleHours: 3 } });
  await admin.post('/api/admin/config/reset', { area: 'security', path: 'idleHours' });
  assert.equal((await admin.get('/api/admin/settings')).security.idleHours, 8, 'a real setting is still reset');
});

// ----- 2. Cross-site requests -----
test('2. a change asked for by another website is refused; the same site, and requests without a browser, go through', async () => {
  const { env } = await school();
  const login = { username: 'admin', password: PW };
  const refused = (e) => e.status === 403 && /another website/.test(e.message);
  await assert.rejects(raw(env, 'POST', '/api/hub/login', login, { 'sec-fetch-site': 'cross-site' }), refused);
  await assert.rejects(raw(env, 'POST', '/api/hub/login', login, { 'sec-fetch-site': 'same-site' }), refused);
  await assert.rejects(raw(env, 'POST', '/api/hub/login', login, { host: 'atlas.school.edu', origin: 'https://evil.example' }), refused);
  await assert.rejects(raw(env, 'POST', '/api/hub/login', login, { host: 'atlas.school.edu', origin: 'null' }), refused);
  assert.ok((await raw(env, 'POST', '/api/hub/login', login, { 'sec-fetch-site': 'same-origin' })).data.user);
  assert.ok((await raw(env, 'POST', '/api/hub/login', login, { host: 'atlas.school.edu', origin: 'https://atlas.school.edu' })).data.user);
  assert.ok((await raw(env, 'POST', '/api/hub/login', login, {})).data.user, 'a script (no browser headers)');
  assert.ok((await raw(env, 'GET', '/api/hub/status', {}, { 'sec-fetch-site': 'cross-site' })).data, 'reading is not a change');
});

// ----- 3. Sessions and cookies -----
test('3. cookies: "__Host-" and Secure over HTTPS, plain names over HTTP', async () => {
  assert.equal(cookieName('ltdc_lms_admin', true), '__Host-ltdc_lms_admin');
  assert.equal(cookieName('ltdc_lms_admin', false), 'ltdc_lms_admin');
  assert.match(sessionCookie('__Host-x', 'tok', 3600000, true), /^__Host-x=tok; HttpOnly; SameSite=Strict; Path=\/; Max-Age=3600; Secure$/);
  const { env } = await school({ secureCookies: true });
  const res = await raw(env, 'POST', '/api/admin/auth/login', { username: 'admin', password: PW });
  const set = [res.headers['Set-Cookie']].flat().join('\n');
  assert.match(set, /^__Host-ltdc_lms_admin=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure$/m);
  const token = set.match(/__Host-ltdc_lms_admin=([0-9a-f]+)/)[1];
  assert.equal((await raw(env, 'GET', '/api/admin/auth/status', {}, { cookie: `__Host-ltdc_lms_admin=${token}` })).data.user.username, 'admin');
  assert.equal((await raw(env, 'GET', '/api/admin/auth/status', {}, { cookie: `ltdc_lms_admin=${token}` })).data.user, null, 'the plain name is not read over HTTPS');
});

test('3. sessions: ended at the longest lifetime however busy, at most ten per account, and the setting is checked', async () => {
  const s = createSessions(() => 60000, () => 40);
  const tok = s.create('u1');
  assert.ok(s.get(tok));
  await new Promise((r) => setTimeout(r, 25));
  assert.ok(s.get(tok), 'busy and young: still on');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.get(tok), null, 'past the longest lifetime, even though it was just used');

  const many = createSessions();
  const tokens = Array.from({ length: 12 }, () => many.create('u2'));
  many.create('u3');
  assert.equal(many.list().filter((x) => x.userId === 'u2').length, 10);
  assert.equal(many.get(tokens[0]), null, 'the oldest ended first');
  assert.ok(many.get(tokens[11]));

  const { admin } = await school();
  await admin.put('/api/admin/settings', { security: { maxSessionHours: 24 } });
  assert.equal((await admin.get('/api/admin/settings')).security.maxSessionHours, 24);
  await assert.rejects(admin.put('/api/admin/settings', { security: { maxSessionHours: 500 } }), /hours signed in/);
});

// ----- 4. Passwords -----
test('4. password hashes carry their cost; an old-style hash still signs in and is redone on the way', async () => {
  const h = hashPassword('correct horse');
  assert.match(h, /^s2\$10\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/, 'tests run at 2^10; the server at 2^17');
  assert.equal(verifyPassword('correct horse', h), true);
  assert.equal(verifyPassword('wrong horse', h), false);
  assert.equal(needsRehash(h), false);

  const { env, admin } = await school();
  await admin.post('/api/system/users', { role: 'staff', username: 'olde', name: 'Olde', password: PW, campusIds: [env.db.data.campuses[0].id], mustChangePassword: false });
  const u = env.db.data.users.find((x) => x.username === 'olde');
  const salt = randomBytes(16).toString('hex');
  u.passwordHash = `scrypt$${salt}$${scryptSync(PW, salt, 64).toString('hex')}`; // as before November 2026
  assert.equal(needsRehash(u.passwordHash), true);
  await env.client().post('/api/hub/login', { username: 'olde', password: PW });
  for (let i = 0; i < 50 && !u.passwordHash.startsWith('s2$'); i++) await new Promise((r) => setTimeout(r, 10));
  assert.match(u.passwordHash, /^s2\$/, 'redone at today\'s cost');
  await env.client().post('/api/hub/login', { username: 'olde', password: PW });
});

test('4. lockout: fifty guesses at once still lock after five, and the lock holds on every sign-in page', async () => {
  const { env, admin } = await school();
  await admin.post('/api/system/users', { role: 'staff', username: 'tess', name: 'Tess', password: PW, campusIds: [env.db.data.campuses[0].id], mustChangePassword: false });
  const socket = { remoteAddress: '203.0.113.9' };
  const guesses = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => raw(env, 'POST', '/api/hub/login', { username: 'tess', password: `guess-${i}` }, {}, socket)));
  const codes = guesses.map((g) => g.reason?.status);
  assert.equal(codes.filter((c) => c === 401).length, 5, 'only five were checked');
  assert.equal(codes.filter((c) => c === 429).length, 45);
  // Locked for this address, whichever page: the right password is refused too.
  for (const path of ['/api/hub/login', '/api/auth/login', '/api/admin/auth/login']) {
    await assert.rejects(raw(env, 'POST', path, { username: 'tess', password: PW }, {}, socket), status(429), path);
  }
});

// ----- 5. Small fixes -----
test('5. a mangled cookie is skipped, not an error', async () => {
  assert.deepEqual(parseCookies('a=%E0%A4%A; b=1; =x; c'), { b: '1' });
  const { env } = await school();
  assert.ok((await raw(env, 'GET', '/api/hub/status', {}, { cookie: 'ltdc_lms_admin=%E0%A4%A' })).data.branding);
});

test('5. the app\'s own address: forwarded headers only from the proxy on this computer, and only for its own names', async () => {
  const { env } = await school();
  const signIn = await raw(env, 'POST', '/api/admin/auth/login', { username: 'admin', password: PW });
  const cookie = [signIn.headers['Set-Cookie']].flat()[0].split(';')[0];
  const view = async (headers, socket) => (await raw(env, 'GET', '/api/admin/sso', {}, { ...headers, cookie }, socket)).data.redirectUri;
  assert.equal(await view({ 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }), 'http://localhost/api/sso/callback', 'a visitor cannot choose it');
  assert.equal(await view({ 'x-forwarded-host': 'evil.example' }, { remoteAddress: '127.0.0.1' }), 'http://localhost/api/sso/callback', 'nor through the proxy, for a name ATLAS does not answer to');
  assert.equal(await view({ 'x-forwarded-host': '10.0.0.5', 'x-forwarded-proto': 'https' }, { remoteAddress: '127.0.0.1' }), 'https://10.0.0.5/api/sso/callback', 'the proxy passes the real one');
});

test('5. Keycloak tests: administrators only, never to a private address, and Keycloak\'s own words are not passed on', async () => {
  const lookups = [];
  const lookup = async (host) => {
    lookups.push(host);
    return host === 'kc.internal.example' ? [{ address: '10.1.2.3', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];
  };
  const answers = {
    'https://kc.public.example/realms/s/.well-known/openid-configuration': [400, { error: 'invalid_request', error_description: 'SECRET-INTERNAL-DETAIL' }],
    'https://kc.jump.example/realms/s/.well-known/openid-configuration': [200, { issuer: 'https://kc.jump.example/realms/s', authorization_endpoint: 'https://kc.jump.example/a', token_endpoint: 'https://kc.jump.example/t', jwks_uri: 'http://127.0.0.1:9931/keys' }],
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const [code, body] = answers[url] || [404, {}];
    return new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
  };
  const { env, admin } = await school({ ssoFetch: fetchImpl, ssoLookup: lookup });
  await assert.rejects(admin.post('/api/admin/sso/test', { issuer: 'https://kc.internal.example/realms/s' }), (e) => e.status === 400 && /private network/.test(e.message));
  assert.equal(calls.length, 0, 'nothing was sent to the private address');
  await assert.rejects(admin.post('/api/admin/sso/test', { issuer: 'https://kc.public.example/realms/s' }), (e) => e.status === 502 && /answered 400: invalid_request/.test(e.message) && !/SECRET/.test(e.message));
  await assert.rejects(admin.post('/api/admin/sso/test', { issuer: 'https://kc.jump.example/realms/s' }), (e) => /on this server/.test(e.message), 'a remote Keycloak cannot send ATLAS to its own ports');
  assert.ok(!calls.some((u) => u.includes('127.0.0.1')));
  // Someone who may change settings but is not an administrator cannot run the test at all.
  await admin.post('/api/system/users', { role: 'registrar', username: 'reg', name: 'Reg', password: PW, campusIds: [env.db.data.campuses[0].id], mustChangePassword: false });
  const reg = env.client();
  await reg.post('/api/admin/auth/login', { username: 'reg', password: PW });
  const regUser = env.db.data.users.find((u) => u.username === 'reg');
  regUser.access = { add: ['settings.edit'], remove: [] };
  await assert.rejects(reg.post('/api/admin/sso/test', { issuer: 'https://kc.public.example/realms/s' }), status(403));
  assert.ok(privateAddress('::ffff:192.168.1.1', 6) && privateAddress('fe80::1', 6) && privateAddress('169.254.169.254', 4) && !privateAddress('93.184.216.34', 4));
});
