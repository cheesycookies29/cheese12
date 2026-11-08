// Single sign-on with Keycloak (or any OpenID Connect provider), without dependencies.
//
// The authorization code flow with PKCE:
//   1. GET /api/sso/start?next=/academic/  → a state, nonce and code verifier are kept for 10 minutes
//      (the state is also in a short-lived cookie, so the answer must come back to this browser),
//      and the browser goes to Keycloak's sign-in page.
//   2. Keycloak sends the browser to GET /api/sso/callback?code&state. ATLAS exchanges the code at
//      Keycloak's token endpoint (with the client secret, server to server), checks the ID token's
//      signature against Keycloak's published keys (JWKS), its issuer, audience, expiry and nonce,
//      then finds the ATLAS account: the one already linked to this Keycloak user, else the active
//      account with the same email (verified) or username, and links it.
//   3. The session cookie is set as for a password sign-in. Signing out of ATLAS also ends the
//      Keycloak session (RP-initiated logout).
//
// Only people who already have an ATLAS account can sign in; Keycloak proves who they are, ATLAS
// decides what they may do. Settings live in data.settings.sso (Admin panel → Single sign-on);
// the client secret only in the environment (OIDC_CLIENT_SECRET), never in the data file or backups.
import { randomBytes, createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { HttpError, text } from './util.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
export const SSO_STATE_COOKIE = 'ltdc_sso_state';
export const DEFAULT_SSO = { enabled: false, issuer: '', clientId: '', label: 'Sign in with Keycloak', matchBy: 'email', allowPasswords: true };
const NEXT_OK = ['/', '/lms/', '/admin', '/hris/', '/academic/'];
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(String(s), 'base64url');

export function mergeSso(s = {}) {
  return { ...DEFAULT_SSO, ...s };
}

// A small HTML page: shows a message, then goes on to `to` from this site (so the
// SameSite=Strict session cookie set with it is sent on the next request).
function page(title, message, to) {
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(title)} · ATLAS</title>
<meta http-equiv="refresh" content="0;url=${esc(to)}" /><link rel="stylesheet" href="/css/styles.css" /></head>
<body style="min-height:100vh;display:grid;place-items:center;background:var(--bg)"><div class="card" style="max-width:420px;text-align:center"><h2>${esc(title)}</h2><p class="muted">${esc(message)}</p><p><a href="${esc(to)}">Continue</a></p></div>
<script>location.replace(${JSON.stringify(to)})</script></body></html>`;
}

export function registerSsoRoutes(route, ctx, { startSession, secret = process.env.OIDC_CLIENT_SECRET || '', fetchImpl = (...a) => fetch(...a) }) {
  const data = () => ctx.db.data;
  const cfg = () => data().settings.sso;
  const pending = new Map(); // state → { nonce, verifier, next, redirectUri, at }
  const cache = { discovery: null, discoveryAt: 0, jwks: null, jwksAt: 0, issuer: '' };

  const getJson = async (url, opts = {}) => {
    let res;
    try {
      res = await fetchImpl(url, { ...opts, signal: AbortSignal.timeout(10000) });
    } catch (err) {
      fail(`Could not reach Keycloak (${new URL(url).host}): ${err.cause?.code || err.message}`, 502);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) fail(`Keycloak answered ${res.status}${body?.error_description ? `: ${body.error_description}` : body?.error ? `: ${body.error}` : ''}.`, 502);
    if (!body) fail('Keycloak did not answer with JSON.', 502);
    return body;
  };

  async function discovery(issuer = cfg().issuer, fresh = false) {
    if (!issuer) fail('Single sign-on is not set up.', 503);
    if (!fresh && cache.discovery && cache.issuer === issuer && Date.now() - cache.discoveryAt < 10 * 60 * 1000) return cache.discovery;
    const d = await getJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
    for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (!d[k]) fail(`Keycloak's configuration has no ${k}.`, 502);
    if (d.issuer.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) fail(`The issuer Keycloak reports (${d.issuer}) is not the one configured (${issuer}).`, 502);
    Object.assign(cache, { discovery: d, discoveryAt: Date.now(), issuer, jwks: issuer === cache.issuer ? cache.jwks : null });
    return d;
  }

  async function keyFor(kid, alg) {
    const d = await discovery();
    const find = () => cache.jwks?.keys?.find((k) => (!kid || k.kid === kid) && (k.use || 'sig') === 'sig' && (!k.alg || k.alg === alg));
    if (!find() || Date.now() - cache.jwksAt > 60 * 60 * 1000) {
      cache.jwks = await getJson(d.jwks_uri);
      cache.jwksAt = Date.now();
    }
    const jwk = find();
    if (!jwk) fail('The ID token was signed with a key Keycloak does not publish.', 401);
    return createPublicKey({ key: jwk, format: 'jwk' });
  }

  // Check an ID token: signature (RS256/PS256/ES256), issuer, audience, time, nonce.
  async function verifyIdToken(token, nonce) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) fail('Keycloak sent no valid ID token.', 401);
    let header;
    let claims;
    try {
      header = JSON.parse(fromB64url(parts[0]));
      claims = JSON.parse(fromB64url(parts[1]));
    } catch {
      fail('Keycloak sent an unreadable ID token.', 401);
    }
    const ALGS = { RS256: ['sha256', {}], PS256: ['sha256', { padding: 6, saltLength: 32 }], ES256: ['sha256', { dsaEncoding: 'ieee-p1363' }] };
    if (!ALGS[header.alg]) fail(`ID tokens signed with ${header.alg} are not accepted.`, 401);
    const key = await keyFor(header.kid, header.alg);
    const [hash, opts] = ALGS[header.alg];
    const ok = cryptoVerify(hash, Buffer.from(`${parts[0]}.${parts[1]}`), { key, ...opts }, fromB64url(parts[2]));
    if (!ok) fail('The ID token signature is not valid.', 401);
    const d = await discovery();
    const now = Math.floor(ctx.now().getTime() / 1000);
    const aud = [claims.aud].flat();
    if (claims.iss !== d.issuer) fail('The ID token is from another issuer.', 401);
    if (!aud.includes(cfg().clientId) || (claims.azp && claims.azp !== cfg().clientId)) fail('The ID token is for another client.', 401);
    if (!(claims.exp > now - 60)) fail('The ID token has expired. Try signing in again.', 401);
    if (claims.iat && claims.iat > now + 120) fail('The ID token is from the future: check the server clocks.', 401);
    if (claims.nonce !== nonce) fail('The sign-in response does not match this request. Try again.', 401);
    return claims;
  }

  // The ATLAS account for a Keycloak user: linked before, else by email or username.
  function accountFor(claims) {
    const subject = `${claims.iss}|${claims.sub}`;
    const all = data().users;
    let user = all.find((u) => u.ssoSubject === subject);
    if (!user) {
      if (cfg().matchBy === 'username') {
        const name = String(claims.preferred_username || '').trim().toLowerCase();
        user = name ? all.find((u) => u.username === name) : null;
      } else {
        const email = String(claims.email || '').trim().toLowerCase();
        if (email && claims.email_verified === false) fail(`Your Keycloak email ${email} is not verified yet. Verify it in Keycloak, then try again.`, 403);
        const matches = email ? all.filter((u) => String(u.email || '').toLowerCase() === email) : [];
        if (matches.length > 1) fail(`More than one ATLAS account uses ${email}. Ask the registrar to fix the duplicate.`, 409);
        user = matches[0];
      }
      if (user?.ssoSubject && user.ssoSubject !== subject) fail('That ATLAS account is linked to another Keycloak user.', 409);
    }
    const who = cfg().matchBy === 'username' ? claims.preferred_username : claims.email;
    if (!user) fail(`There is no ATLAS account for ${who || 'your Keycloak user'}. Ask the registrar or HR to create one${cfg().matchBy === 'email' ? ' with this email' : ''}.`, 403);
    if (user.status === 'pending') fail('Your application is still being reviewed. You can sign in once the registrar admits you.', 403);
    if (user.status !== 'active') fail('This ATLAS account is disabled. Contact the registrar.', 403);
    if (!user.ssoSubject) {
      user.ssoSubject = subject;
      user.ssoLinkedAt = new Date().toISOString();
    }
    user.ssoName = text(claims.preferred_username || claims.email || claims.sub, 120);
    user.mustChangePassword = false; // they sign in with Keycloak; the ATLAS password is not used
    return user;
  }

  const stateCookie = (state, maxAge = 600) => `${SSO_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/api/sso; Max-Age=${maxAge}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`;

  // ----- Routes -----
  route('GET', '/api/sso/start', 'public', async ({ query, origin }) => {
    if (!cfg().enabled) fail('Single sign-on is off.', 404);
    const d = await discovery();
    for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60 * 1000) pending.delete(k);
    if (pending.size > 5000) fail('Too many sign-ins in progress. Try again in a minute.', 429);
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    const next = NEXT_OK.includes(query.next) ? query.next : '/';
    const redirectUri = `${origin}/api/sso/callback`;
    pending.set(state, { nonce, verifier, next, redirectUri, at: Date.now() });
    const u = new URL(d.authorization_endpoint);
    for (const [k, v] of Object.entries({
      response_type: 'code', client_id: cfg().clientId, redirect_uri: redirectUri, scope: 'openid email profile',
      state, nonce, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    })) u.searchParams.set(k, v);
    return { raw: '', type: 'text/plain', status: 302, headers: { Location: u.toString(), 'Set-Cookie': stateCookie(state) } };
  });

  route('GET', '/api/sso/callback', 'public', async ({ query, cookies, tokens }) => {
    const back = (msg) => ({ raw: page('Sign-in did not finish', msg, `/?ssoError=${encodeURIComponent(msg)}`), type: 'text/html', headers: { 'Set-Cookie': stateCookie('', 0) } });
    const st = pending.get(String(query.state || ''));
    if (query.error) {
      if (st) pending.delete(query.state);
      return back(query.error === 'access_denied' ? 'Keycloak sign-in was cancelled.' : `Keycloak said: ${text(query.error_description || query.error, 200)}`);
    }
    if (!st || cookies[SSO_STATE_COOKIE] !== query.state) return back('This sign-in link has expired or was opened in another browser. Start again.');
    pending.delete(query.state);
    try {
      const d = await discovery();
      const form = new URLSearchParams({ grant_type: 'authorization_code', code: String(query.code || ''), redirect_uri: st.redirectUri, code_verifier: st.verifier, client_id: cfg().clientId });
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
      if (secret) headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(cfg().clientId)}:${encodeURIComponent(secret)}`).toString('base64')}`;
      const tok = await getJson(d.token_endpoint, { method: 'POST', headers, body: form.toString() });
      const claims = await verifyIdToken(tok.id_token, st.nonce);
      const user = accountFor(claims);
      const session = startSession(user, tokens, { sso: true, idToken: tok.id_token });
      ctx.db.save();
      return {
        raw: page('Signed in', `Welcome, ${user.name}.`, st.next),
        type: 'text/html',
        headers: { 'Set-Cookie': [...session, stateCookie('', 0)] },
      };
    } catch (err) {
      if (!(err instanceof HttpError) || err.status >= 500 && err.status !== 502 && err.status !== 503) console.error('SSO callback:', err);
      return back(err instanceof HttpError ? err.message : 'Something went wrong while signing in.');
    }
  });

  // Where to send the browser after an ATLAS sign-out, to end the Keycloak session too.
  function logoutUrl(session, origin) {
    const d = cache.discovery;
    if (!session?.sso || !cfg().enabled || !d?.end_session_endpoint) return null;
    const u = new URL(d.end_session_endpoint);
    u.searchParams.set('client_id', cfg().clientId);
    u.searchParams.set('post_logout_redirect_uri', `${origin}/`);
    if (session.idToken) u.searchParams.set('id_token_hint', session.idToken);
    return u.toString();
  }

  // ----- Settings (Admin panel → Single sign-on) -----
  const view = (origin) => ({ ...cfg(), secretSet: Boolean(secret), redirectUri: `${origin}/api/sso/callback`, postLogoutUri: `${origin}/`, linked: data().users.filter((u) => u.ssoSubject).length });
  route('GET', '/api/admin/sso', 'admin:settings.edit', ({ origin }) => view(origin));
  route('POST', '/api/admin/sso/test', 'admin:settings.edit', async ({ body }) => {
    const d = await discovery(text(body.issuer, 300) || cfg().issuer, true);
    return { ok: true, issuer: d.issuer, authorization: d.authorization_endpoint, token: d.token_endpoint, logout: d.end_session_endpoint || null, keys: (await getJson(d.jwks_uri)).keys?.length || 0 };
  });
  route('PUT', '/api/admin/sso', 'admin:settings.edit', async ({ body, origin }) => {
    const s = cfg();
    if ('issuer' in body) {
      const issuer = text(body.issuer, 300).replace(/\/$/, '');
      if (issuer && !/^https?:\/\/[^\s]+$/.test(issuer)) fail('The issuer is an address like https://sso.school.edu/realms/school.');
      if (issuer.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${issuer}/`)) fail('Use https for Keycloak (http only for a Keycloak on this same machine).');
      s.issuer = issuer;
    }
    if ('clientId' in body) s.clientId = text(body.clientId, 120);
    if ('label' in body) s.label = text(body.label, 60) || DEFAULT_SSO.label;
    if ('matchBy' in body) s.matchBy = body.matchBy === 'username' ? 'username' : 'email';
    if ('allowPasswords' in body) s.allowPasswords = Boolean(body.allowPasswords);
    if ('enabled' in body) {
      if (body.enabled) {
        if (!s.issuer || !s.clientId) fail('Give the issuer and the client ID first.');
        await discovery(s.issuer, true); // refuse to switch on a Keycloak that cannot be reached
      }
      s.enabled = Boolean(body.enabled);
    }
    if (!s.enabled) s.allowPasswords = true; // passwords are the only way in without SSO
    ctx.db.save();
    return view(origin);
  });

  return { logoutUrl, publicInfo: () => (cfg().enabled ? { enabled: true, label: cfg().label, passwords: cfg().allowPasswords } : { enabled: false, passwords: true }) };
}
