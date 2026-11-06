// Single sign-on with Keycloak (OpenID Connect): the sign-in round trip against a stand-in
// Keycloak (test/oidc-provider.js), how accounts are found and linked, every check on the
// ID token, the settings, password sign-in when SSO is on, and signing out of Keycloak too.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seed, TODAY } from './support.js';
import { startProvider } from './oidc-provider.js';

const PW = 'password123';
const NOW = Date.parse(`${TODAY}T10:00:00`);
const providers = [];
after(() => Promise.all(providers.map((p) => p.close())));

async function school({ providerOptions = {}, matchBy = 'email' } = {}) {
  const kc = await startProvider(providerOptions);
  providers.push(kc);
  const env = setup({ options: { ssoSecret: kc.secret } });
  const s = await seed(env);
  // Accounts with emails, as the school's Keycloak has them.
  const stud = await s.admin.post('/api/admin/users', { role: 'student', username: 'carlo', name: 'Carlo Reyes', email: 'carlo@school.edu', password: PW, mustChangePassword: true });
  await s.admin.post('/api/admin/users', { role: 'registrar', username: 'rosa', name: 'Rosa Villanueva', email: 'rosa@school.edu', password: PW, mustChangePassword: false });
  await s.admin.put('/api/admin/sso', { issuer: kc.issuer, clientId: kc.clientId, matchBy, enabled: true });
  // One browser signing in through Keycloak as `claims`; returns the callback response.
  const ssoSignIn = async (claims, { next = '/', tamper, client = env.client(), now = NOW } = {}) => {
    const start = await client.get(`/api/sso/start?next=${encodeURIComponent(next)}`);
    assert.equal(start.status, 302);
    const back = kc.authorize(start.headers.Location, claims, { tamper, now });
    return { res: await client.get(back), client, start };
  };
  return { ...s, env, kc, stud, ssoSignIn };
}

test('a student signs in with Keycloak: matched by email, linked, and sent back to the system they came from', async () => {
  const f = await school();
  const { res, client, start } = await f.ssoSignIn({ sub: 'kc-001', email: 'carlo@school.edu', email_verified: true, preferred_username: 'carlo.reyes' }, { next: '/academic/' });
  // The request to Keycloak: code flow with PKCE (S256), a state and a nonce; the state also in a cookie.
  const q = f.kc.log.lastAuth;
  assert.deepEqual([q.response_type, q.code_challenge_method, q.redirect_uri], ['code', 'S256', 'http://localhost/api/sso/callback']);
  assert.ok(q.state && q.nonce && q.code_challenge);
  assert.match([start.headers['Set-Cookie']].flat()[0], /^ltdc_sso_state=.+SameSite=Lax; Path=\/api\/sso/);
  // The answer: a page that continues to /academic/ on this site, with the portal session cookie.
  assert.equal(res.type, 'text/html');
  assert.match(res.raw, /location\.replace\("\/academic\/"\)/);
  const st = await client.get('/api/hub/status');
  assert.equal(st.user.username, 'carlo');
  assert.equal(st.user.mustChangePassword, false, 'a Keycloak user is not asked to change an ATLAS password');
  assert.equal(st.side, 'portal');
  const u = f.env.db.data.users.find((x) => x.username === 'carlo');
  assert.equal(u.ssoSubject, `${f.kc.issuer}|kc-001`);
  // Later, with a new email in Keycloak, the link (the Keycloak user id) still finds the account.
  const again = await f.ssoSignIn({ sub: 'kc-001', email: 'carlo.reyes@newmail.edu', email_verified: true });
  assert.equal((await again.client.get('/api/hub/status')).user.username, 'carlo');
  // Staff land on their own side (the admin-panel session).
  const reg = await f.ssoSignIn({ sub: 'kc-777', email: 'ROSA@school.edu', email_verified: true }, { next: '/admin' });
  assert.equal((await reg.client.get('/api/hub/status')).side, 'admin');
  assert.match(reg.res.raw, /location\.replace\("\/admin"\)/);
  // Anything other than an ATLAS page as `next` goes home instead.
  const odd = await f.ssoSignIn({ sub: 'kc-001', email: 'carlo@school.edu' }, { next: 'https://evil.example/' });
  assert.match(odd.res.raw, /location\.replace\("\/"\)/);
});

test('every check on the way back: state, signature, audience, expiry, nonce, account', async () => {
  const f = await school();
  const carlo = { sub: 'kc-001', email: 'carlo@school.edu', email_verified: true };
  const refused = async (claims, opts, pattern) => {
    const { res, client } = await f.ssoSignIn(claims, opts);
    assert.match(decodeURIComponent(res.raw), pattern);
    assert.equal((await client.get('/api/hub/status')).user, null, 'not signed in');
  };
  await refused(carlo, { tamper: { wrongKey: true } }, /signature is not valid/);
  await refused(carlo, { tamper: { claims: { aud: 'another-app' } } }, /for another client/);
  await refused(carlo, { tamper: { claims: { iss: 'https://evil.example/realms/x' } } }, /another issuer/);
  await refused(carlo, { tamper: { claims: { exp: Math.floor(NOW / 1000) - 3600 } } }, /expired/);
  await refused(carlo, { tamper: { nonce: 'replayed' } }, /does not match this request/);
  await refused({ sub: 'kc-9', email: 'nobody@school.edu', email_verified: true }, {}, /no ATLAS account for nobody@school\.edu/);
  await refused({ sub: 'kc-1', email: 'carlo@school.edu', email_verified: false }, {}, /not verified/);
  // The answer must come back to the browser that started (the state cookie), once.
  const start = await f.env.client().get('/api/sso/start');
  const back = f.kc.authorize(start.headers.Location, carlo);
  const other = await f.env.client().get(back);
  assert.match(decodeURIComponent(other.raw), /expired or was opened in another browser/);
  // A cancelled sign-in on Keycloak's page.
  const c = f.env.client();
  const s2 = await c.get('/api/sso/start');
  const state = new URL(s2.headers.Location).searchParams.get('state');
  assert.match(decodeURIComponent((await c.get(`/api/sso/callback?error=access_denied&state=${state}`)).raw), /cancelled/);
  // Disabled accounts and applicants cannot get in through Keycloak either.
  const u = f.env.db.data.users.find((x) => x.username === 'carlo');
  u.status = 'disabled';
  await refused(carlo, {}, /disabled/);
  u.status = 'active';
  // Two accounts with the same email: nobody is guessed.
  await f.admin.post('/api/admin/users', { role: 'student', username: 'carlo2', name: 'Carlo Two', email: 'carlo@school.edu', password: PW, mustChangePassword: false }).catch(() => {});
  if (f.env.db.data.users.filter((x) => x.email === 'carlo@school.edu').length > 1) {
    u.ssoSubject = undefined;
    await refused({ sub: 'kc-5', email: 'carlo@school.edu', email_verified: true }, {}, /More than one ATLAS account/);
  }
});

test('settings: the secret is never shown, Keycloak must answer before SSO turns on, passwords can be switched off', async () => {
  const f = await school();
  const s = await f.admin.get('/api/admin/sso');
  assert.equal(s.secretSet, true);
  assert.equal(JSON.stringify(s).includes(f.kc.secret), false, 'the client secret stays in the environment');
  assert.equal(s.redirectUri, 'http://localhost/api/sso/callback');
  const t = await f.admin.post('/api/admin/sso/test', {});
  assert.deepEqual([t.ok, t.issuer, t.keys], [true, f.kc.issuer, 1]);
  await assert.rejects(f.admin.put('/api/admin/sso', { issuer: 'http://sso.example.edu/realms/x' }), /Use https/);
  await assert.rejects(f.admin.put('/api/admin/sso', { issuer: 'http://127.0.0.1:1/realms/none', enabled: true }), /Could not reach Keycloak/);
  await f.admin.put('/api/admin/sso', { issuer: f.kc.issuer, enabled: true, label: 'Sign in with your school account' });
  assert.deepEqual((await f.env.client().get('/api/hub/status')).sso, { enabled: true, label: 'Sign in with your school account', passwords: true });
  // Passwords off: everyone but administrators signs in with Keycloak.
  await f.admin.put('/api/admin/sso', { allowPasswords: false });
  await assert.rejects(f.env.client().post('/api/hub/login', { username: 'rosa', password: PW }), /signs in with Keycloak/);
  await f.env.client().post('/api/hub/login', { username: 'admin', password: PW }); // a way in if Keycloak is down
  // Registrars cannot change SSO.
  const reg = f.env.client();
  await f.admin.put('/api/admin/sso', { allowPasswords: true });
  await reg.post('/api/hub/login', { username: 'rosa', password: PW });
  await assert.rejects(reg.get('/api/admin/sso'), (e) => e.status === 403);
  // Switched off: the start link is gone and passwords are back.
  await f.admin.put('/api/admin/sso', { enabled: false, allowPasswords: false });
  assert.equal((await f.admin.get('/api/admin/sso')).allowPasswords, true);
  await assert.rejects(f.env.client().get('/api/sso/start'), (e) => e.status === 404);
});

test('signing out of ATLAS also ends the Keycloak session', async () => {
  const f = await school();
  const { client } = await f.ssoSignIn({ sub: 'kc-001', email: 'carlo@school.edu', email_verified: true });
  const out = await client.post('/api/hub/logout');
  const u = new URL(out.ssoLogout);
  assert.equal(`${u.origin}${u.pathname}`, `${f.kc.issuer}/protocol/openid-connect/logout`);
  assert.equal(u.searchParams.get('client_id'), 'atlas');
  assert.equal(u.searchParams.get('post_logout_redirect_uri'), 'http://localhost/');
  assert.ok(u.searchParams.get('id_token_hint'));
  assert.equal((await client.get('/api/hub/status')).user, null);
  // A password session signs out without visiting Keycloak.
  const pw = f.env.client();
  await pw.post('/api/hub/login', { username: 'rosa', password: PW });
  assert.equal((await pw.post('/api/hub/logout')).ssoLogout, null);
});

test('ES256-signed tokens and matching by username work too', async () => {
  const f = await school({ providerOptions: { alg: 'ES256' }, matchBy: 'username' });
  const { client } = await f.ssoSignIn({ sub: 'kc-42', preferred_username: 'Rosa', email: 'someone-else@school.edu' });
  assert.equal((await client.get('/api/hub/status')).user.username, 'rosa');
});
