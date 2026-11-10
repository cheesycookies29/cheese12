// A small stand-in for Keycloak in tests: a real HTTP server on localhost with OpenID Connect
// discovery, a JWKS, a token endpoint that checks PKCE and the client secret and returns a
// signed ID token, and an end-session endpoint. authorize() plays the person signing in on
// Keycloak's page: it reads the authorization URL ATLAS sent the browser to and returns the
// callback URL Keycloak would send the browser back to.
import http from 'node:http';
import { generateKeyPairSync, createHash, sign, randomBytes } from 'node:crypto';

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

// users: { username: { password, claims } } for the sign-in page a browser sees (browser checks and demos).
// admin: the admin REST API (for "Set up for me"): an administrator in `admin.realm` (username,
// password), a service account (svcId, svcSecret) and whether they may manage clients. `clients`
// starts with the client ATLAS uses, as Keycloak would hold it, unless `noClient` (it is then
// made through the admin API, and its secret becomes the one the token endpoint checks).
export async function startProvider({ realm = 'school', clientId = 'atlas', secret: initialSecret = 's3cret', alg = 'RS256', users = {}, host = '127.0.0.1', port = 0, admin = {}, noClient = false, client = {} } = {}) {
  let secret = initialSecret;
  const adm = { realm: 'master', username: 'kcadmin', password: 'kc-pass', svcId: 'atlas-setup', svcSecret: 'svc-pass', canManage: true, otp: false, ...admin };
  const clients = noClient ? [] : [{ id: 'uuid-atlas', clientId, enabled: true, publicClient: false, standardFlowEnabled: true, redirectUris: [], webOrigins: [], attributes: {}, secret, ...client }];
  const adminLog = { calls: [] };
  const { privateKey, publicKey } = alg === 'ES256'
    ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
    : generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }); // an impostor's key
  const kid = 'key-1';
  const codes = new Map();
  const log = { tokenRequests: 0, lastAuth: null };
  let issuer = '';

  const sign_ = (claims, { key = privateKey, k = kid, a = alg } = {}) => {
    const head = b64url({ alg: a, typ: 'JWT', kid: k });
    const body = b64url(claims);
    const sig = sign('sha256', Buffer.from(`${head}.${body}`), a === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key);
    return `${head}.${body}.${sig.toString('base64url')}`;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const base = `/realms/${realm}`;
    const readBody = (fn) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => fn(raw));
    };
    // Admin sign-in: an administrator (password grant, admin-cli) or a service account (client credentials).
    const tokenIn = url.pathname.match(/^\/realms\/([^/]+)\/protocol\/openid-connect\/token$/);
    if (tokenIn && req.method === 'POST') {
      return readBody((raw) => {
        const p = new URLSearchParams(raw);
        const grant = p.get('grant_type');
        if (grant === 'password' || grant === 'client_credentials') {
          adminLog.calls.push(`token ${decodeURIComponent(tokenIn[1])} ${grant}`);
          if (decodeURIComponent(tokenIn[1]) !== adm.realm && decodeURIComponent(tokenIn[1]) !== realm) return json(404, { error: 'Realm does not exist' });
          if (grant === 'password') {
            if (p.get('client_id') !== 'admin-cli' || p.get('username') !== adm.username || p.get('password') !== adm.password) return json(401, { error: 'invalid_grant', error_description: 'Invalid user credentials' });
            if (adm.otp) return json(400, { error: 'invalid_grant', error_description: 'Account is not fully set up' });
          } else {
            const basic = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
            if (basic !== `${adm.svcId}:${adm.svcSecret}`) return json(401, { error: 'unauthorized_client', error_description: 'Invalid client or Invalid client credentials' });
          }
          return json(200, { access_token: 'admin-token', token_type: 'Bearer', expires_in: 60 });
        }
        if (tokenIn[1] !== realm) return json(400, { error: 'unsupported_grant_type' });
        return codeExchange(p);
      });
    }
    // The admin REST API, for the school's realm.
    if (url.pathname.startsWith('/admin/realms/')) {
      const parts = url.pathname.split('/').slice(3).map(decodeURIComponent); // [realm, 'clients', id?, 'client-secret'?]
      adminLog.calls.push(`${req.method} ${url.pathname}${url.search}`);
      if (req.headers.authorization !== 'Bearer admin-token') return json(401, { error: 'HTTP 401 Unauthorized' });
      if (parts[0] !== realm) return json(404, { error: 'Realm not found.' });
      if (!adm.canManage) return json(403, { error: 'HTTP 403 Forbidden' });
      if (parts[1] !== 'clients') return json(404, {});
      const pub = ({ secret: _s, ...c }) => c;
      if (parts.length === 2 && req.method === 'GET') return json(200, clients.filter((c) => !url.searchParams.get('clientId') || c.clientId === url.searchParams.get('clientId')).map(pub));
      if (parts.length === 2 && req.method === 'POST') {
        return readBody((raw) => {
          const rep = JSON.parse(raw);
          if (clients.some((c) => c.clientId === rep.clientId)) return json(409, { errorMessage: `Client ${rep.clientId} already exists` });
          const id = `uuid-${randomBytes(4).toString('hex')}`;
          clients.push({ ...rep, id, secret: '' });
          res.writeHead(201, { Location: `${issuer.replace(/\/realms\/.*/, '')}/admin/realms/${realm}/clients/${id}` });
          res.end();
        });
      }
      const c = clients.find((x) => x.id === parts[2]);
      if (!c) return json(404, { error: 'Could not find client' });
      if (parts.length === 3 && req.method === 'PUT') {
        return readBody((raw) => {
          Object.assign(c, JSON.parse(raw), { id: c.id, secret: c.secret });
          res.writeHead(204);
          res.end();
        });
      }
      if (parts[3] === 'client-secret') {
        if (req.method === 'POST') c.secret = randomBytes(16).toString('hex');
        if (c.clientId === clientId && c.secret) secret = c.secret; // the token endpoint checks the client's secret
        return json(200, c.secret ? { type: 'secret', value: c.secret } : { type: 'secret' });
      }
      return json(404, {});
    }
    if (url.pathname === `${base}/.well-known/openid-configuration`) {
      return json(200, {
        issuer, authorization_endpoint: `${issuer}/protocol/openid-connect/auth`, token_endpoint: `${issuer}/protocol/openid-connect/token`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`, end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
      });
    }
    // Keycloak's sign-in page, for a browser: a username and password from `users`.
    if (url.pathname === `${base}/protocol/openid-connect/auth`) {
      const q = Object.fromEntries(url.searchParams);
      const finish = (username) => {
        const u = users[username];
        const code = randomBytes(12).toString('hex');
        codes.set(code, { claims: u.claims, nonce: q.nonce, challenge: q.code_challenge, redirectUri: q.redirect_uri, tamper: {}, now: Date.now() });
        const back = new URL(q.redirect_uri);
        back.searchParams.set('code', code);
        back.searchParams.set('state', q.state);
        res.writeHead(302, { Location: back.toString() });
        res.end();
      };
      if (req.method === 'POST') {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          const f = new URLSearchParams(raw);
          const u = users[f.get('username')];
          if (u && u.password === f.get('password')) return finish(f.get('username'));
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(loginPage(q, 'Invalid username or password.'));
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(loginPage(q));
    }
    if (url.pathname === `${base}/protocol/openid-connect/logout`) {
      const to = url.searchParams.get('post_logout_redirect_uri') || '/';
      log.loggedOut = (log.loggedOut || 0) + 1;
      res.writeHead(302, { Location: to });
      return res.end();
    }
    if (url.pathname === `${base}/protocol/openid-connect/certs`) {
      return json(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg }] });
    }
    res.writeHead(404);
    res.end();

    function codeExchange(p) {
      {
        log.tokenRequests++;
        const basic = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
        if (secret && basic !== `${clientId}:${secret}`) return json(401, { error: 'unauthorized_client', error_description: 'Invalid client credentials' });
        const c = codes.get(p.get('code'));
        codes.delete(p.get('code'));
        if (!c) return json(400, { error: 'invalid_grant', error_description: 'Code not valid' });
        if (p.get('redirect_uri') !== c.redirectUri) return json(400, { error: 'invalid_grant', error_description: 'Incorrect redirect_uri' });
        const challenge = createHash('sha256').update(p.get('code_verifier') || '').digest('base64url');
        if (challenge !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        const now = Math.floor(c.now / 1000);
        const claims = { iss: issuer, aud: clientId, azp: clientId, sub: c.claims.sub, iat: now, exp: now + 300, nonce: c.nonce, ...c.claims, ...(c.tamper.claims || {}) };
        return json(200, { access_token: 'at', token_type: 'Bearer', id_token: sign_(claims, c.tamper.wrongKey ? { key: other.privateKey } : {}) });
      }
    }
  });
  await new Promise((r) => server.listen(port, host, r));
  issuer = `http://${host}:${server.address().port}/realms/${realm}`;

  return {
    issuer, clientId, log, clients, adminLog, admin: adm,
    get secret() {
      return secret;
    },
    // The person signs in as `claims` (sub, email, preferred_username…); tamper changes what comes back.
    authorize(authUrl, claims, { tamper = {}, now = Date.now() } = {}) {
      const u = new URL(authUrl);
      const q = Object.fromEntries(u.searchParams);
      log.lastAuth = q;
      if (q.client_id !== clientId || q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.scope.split(' ').includes('openid')) throw new Error(`bad authorization request: ${authUrl}`);
      const code = randomBytes(12).toString('hex');
      codes.set(code, { claims, nonce: tamper.nonce ?? q.nonce, challenge: q.code_challenge, redirectUri: q.redirect_uri, tamper, now });
      const back = new URL(q.redirect_uri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', tamper.state ?? q.state);
      return back.pathname + back.search;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Looks like a plain Keycloak sign-in page (only for tests and demos).
function loginPage(q, error = '') {
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Sign in to school</title>
<style>body{font-family:system-ui,sans-serif;background:#f0f0f0;display:grid;place-items:center;min-height:100vh;margin:0}form{background:#fff;padding:32px;border-top:4px solid #0066cc;width:340px;box-shadow:0 2px 8px #0002}h1{font-size:20px;margin:0 0 6px;color:#333}p.sub{color:#777;font-size:13px;margin:0 0 18px}label{display:block;font-size:13px;margin:12px 0 4px;color:#333}input{width:100%;padding:9px;box-sizing:border-box;border:1px solid #bbb}button{margin-top:18px;width:100%;padding:10px;background:#0066cc;color:#fff;border:0;font-size:15px}.err{background:#fde8e8;color:#a00;padding:8px;font-size:13px}</style></head>
<body><form method="post" action="?${esc(new URLSearchParams(q))}"><h1>Sign in to your account</h1><p class="sub">Keycloak (test stand-in) · client ${esc(q.client_id)}</p>${error ? `<p class="err">${esc(error)}</p>` : ''}
<label for="username">Username or email</label><input id="username" name="username" autofocus /><label for="password">Password</label><input id="password" name="password" type="password" /><button id="kc-login">Sign In</button></form></body></html>`;
}
