// Sets up ATLAS's client in Keycloak through Keycloak's admin REST API, so an administrator does
// not have to click through Keycloak's console: Admin panel → Single sign-on → Set up for me.
//
//   1. A token for a Keycloak account allowed to manage clients: an administrator's username and
//      password (through Keycloak's own admin-cli client), or a service account's client ID and
//      secret. These are used for this one request and never stored or logged.
//   2. The client (normally "atlas") in the school's realm is created, or, if it exists, brought in
//      line: confidential, standard flow with PKCE (S256), ATLAS's redirect and post-logout
//      addresses added, web origins "+". Anything else on an existing client is left alone.
//   3. The client's secret is read (made, if the client has none) and returned to ATLAS, which keeps
//      it outside the data file. An existing secret is kept, so nothing else using it breaks.
import { HttpError } from './util.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};

// https://sso.school.edu/realms/school (Keycloak 17+) or https://sso.school.edu/auth/realms/school.
export function parseIssuer(issuer) {
  const m = String(issuer || '').replace(/\/$/, '').match(/^(https?:\/\/[^\s]+?)\/realms\/([^/\s]+)$/);
  if (!m) fail('The issuer must be a Keycloak realm address, like https://sso.school.edu/realms/school.');
  return { base: m[1], realm: decodeURIComponent(m[2]) };
}

const list = (v) => (Array.isArray(v) ? v : []);
const union = (a, b) => [...new Set([...list(a), ...list(b)].filter(Boolean))];

export async function provisionKeycloakClient({ fetchImpl, issuer, auth = {}, clientId, redirectUri, postLogoutUri, origin }) {
  const { base, realm } = parseIssuer(issuer);
  const host = new URL(base).host;
  const call = async (url, opts = {}) => {
    let res;
    try {
      res = await fetchImpl(url, { ...opts, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    } catch (err) {
      fail(`Could not reach Keycloak (${host}): ${err.cause?.code || err.message}`, 502);
    }
    const raw = await res.text().catch(() => '');
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    return { status: res.status, ok: res.ok, body, location: res.headers.get('location') };
  };

  // 1. Signing in to Keycloak's admin API.
  const kind = auth.kind === 'client' ? 'client' : 'password';
  const authRealm = String(auth.realm || (kind === 'password' ? 'master' : realm)).trim();
  const form = kind === 'password'
    ? new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: String(auth.username || ''), password: String(auth.password || '') })
    : new URLSearchParams({ grant_type: 'client_credentials' });
  if (kind === 'password' && (!auth.username || !auth.password)) fail('Give the Keycloak administrator\'s username and password.');
  if (kind === 'client' && (!auth.clientId || !auth.clientSecret)) fail('Give the service account\'s client ID and secret.');
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (kind === 'client') headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(auth.clientId)}:${encodeURIComponent(auth.clientSecret)}`).toString('base64')}`;
  const tok = await call(`${base}/realms/${encodeURIComponent(authRealm)}/protocol/openid-connect/token`, { method: 'POST', headers, body: form.toString() });
  if (tok.status === 404) fail(`Keycloak has no realm "${authRealm}" to sign in to.`);
  if (!tok.ok || !tok.body?.access_token) {
    const why = String(tok.body?.error_description || tok.body?.error || '');
    if (/not fully set up/i.test(why)) fail('That Keycloak account has a required action pending (often two-step sign-in), so it cannot be used here. Use a service account instead.');
    fail(kind === 'password'
      ? `Keycloak did not accept that username and password in the "${authRealm}" realm${why ? ` (${why})` : ''}.`
      : `Keycloak did not accept that service account in the "${authRealm}" realm${why ? ` (${why})` : ''}.`);
  }
  const bearer = { Authorization: `Bearer ${tok.body.access_token}`, Accept: 'application/json' };
  const admin = `${base}/admin/realms/${encodeURIComponent(realm)}`;
  const denied = (r) => {
    if (r.status === 401 || r.status === 403) fail(`That Keycloak account may not manage clients in the "${realm}" realm. Give it the realm-management role "manage-clients", or use a realm administrator.`, 403);
    if (r.status === 404) fail(`Keycloak has no realm "${realm}".`);
    if (!r.ok) fail(`Keycloak answered ${r.status}${r.body?.errorMessage ? `: ${r.body.errorMessage}` : r.body?.error ? `: ${r.body.error}` : ''}.`, 502);
  };
  const find = async () => {
    const r = await call(`${admin}/clients?clientId=${encodeURIComponent(clientId)}`, { headers: bearer });
    denied(r);
    return list(r.body).find((c) => c.clientId === clientId) || null;
  };

  // 2. The client.
  let client = await find();
  const created = !client;
  const changes = [];
  if (created) {
    const rep = {
      clientId, name: 'ATLAS', description: 'Lancaster ATLAS (set up from ATLAS\'s admin panel)', protocol: 'openid-connect', enabled: true,
      publicClient: false, clientAuthenticatorType: 'client-secret', standardFlowEnabled: true, implicitFlowEnabled: false,
      directAccessGrantsEnabled: false, serviceAccountsEnabled: false, frontchannelLogout: true,
      rootUrl: origin, baseUrl: '/', redirectUris: [redirectUri], webOrigins: ['+'],
      attributes: { 'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': postLogoutUri },
    };
    const r = await call(`${admin}/clients`, { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: JSON.stringify(rep) });
    if (r.status === 409) fail(`Keycloak already has a client "${clientId}" that this account cannot see.`, 409);
    denied(r);
    client = await find();
    if (!client) fail('Keycloak made the client but does not list it. Try again.', 502);
    changes.push(`created the client "${clientId}"`);
  } else {
    const attrs = { ...(client.attributes || {}) };
    const logoutUris = union(String(attrs['post.logout.redirect.uris'] || '').split('##'), [postLogoutUri]);
    const next = {
      ...client,
      enabled: true,
      publicClient: false,
      clientAuthenticatorType: client.clientAuthenticatorType || 'client-secret',
      standardFlowEnabled: true,
      redirectUris: union(client.redirectUris, [redirectUri]),
      webOrigins: union(client.webOrigins, ['+']),
      attributes: { ...attrs, 'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': logoutUris.join('##') },
    };
    if (!client.enabled) changes.push('enabled the client');
    if (client.publicClient) changes.push('turned on client authentication');
    if (!client.standardFlowEnabled) changes.push('turned on the standard flow');
    if (!list(client.redirectUris).includes(redirectUri)) changes.push('added the redirect address');
    if (logoutUris.length !== String(attrs['post.logout.redirect.uris'] || '').split('##').filter(Boolean).length) changes.push('added the sign-out address');
    if (!list(client.webOrigins).includes('+')) changes.push('set web origins to "+"');
    if (attrs['pkce.code.challenge.method'] !== 'S256') changes.push('required PKCE (S256)');
    if (changes.length) {
      const r = await call(`${admin}/clients/${encodeURIComponent(client.id)}`, { method: 'PUT', headers: { ...bearer, 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      denied(r);
    }
  }

  // 3. The secret: the existing one, or a new one if the client has none.
  const secretUrl = `${admin}/clients/${encodeURIComponent(client.id)}/client-secret`;
  let s = await call(secretUrl, { headers: bearer });
  denied(s);
  if (!s.body?.value) {
    s = await call(secretUrl, { method: 'POST', headers: bearer });
    denied(s);
    changes.push('made a client secret');
  }
  if (!s.body?.value) fail('Keycloak did not give the client\'s secret.', 502);
  return { realm, created, changes, secret: s.body.value };
}
