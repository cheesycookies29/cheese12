// Put ATLAS behind Cloudflare: Admin panel → System → Cloudflare → Set up for me.
//
// Two halves, which meet only through two small files in the data folder:
//   - ATLAS (this file) uses an API token the administrator pastes once, for that one request (it is
//     never stored, logged or sent back), to set the school's domain up in Cloudflare: a proxied A
//     record for the new hostname pointing at this server, SSL/TLS "Full (strict)" and TLS 1.2 or
//     newer. It then writes cloudflare.json, asking the server to switch over.
//   - A root helper on the server (/usr/local/sbin/ltdc-lms-cloudflare, from deploy/aws) reads
//     cloudflare.json, changes Caddy, the app's settings (ALLOWED_HOSTS, PUBLIC_URL) and, when asked,
//     the firewall, then writes cloudflare-status.json, which ATLAS shows.
//
// cloudflare.json (written here, atomically, mode 0640):
//   { version: 1, hostname: "atlas.school.edu.ph" | "" (off), lockOrigin, requestedAt, requestedBy }
// cloudflare-status.json (written by the helper; may be absent):
//   { version: 1, state: "active" | "failed" | "off", hostname, requestedAt, appliedAt, certificate,
//     throughCloudflare, originLocked, message }
// The request is pending while the status's requestedAt is not the request's.
//
// ATLAS does not turn on Cloudflare's "Always Use HTTPS": Caddy redirects to HTTPS itself, and the
// certificate's renewals reach Caddy over plain HTTP through Cloudflare.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { HttpError } from './util.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
export const CLOUDFLARE_REQUEST_FILE = 'cloudflare.json';
export const CLOUDFLARE_STATUS_FILE = 'cloudflare-status.json';
export const CLOUDFLARE_HELPER = '/usr/local/sbin/ltdc-lms-cloudflare';
const IMDS = 'http://169.254.169.254/latest';
export const PERMISSIONS = 'Zone · Zone · Read, Zone · DNS · Edit and Zone · Zone Settings · Edit';
export const DEFAULT_CLOUDFLARE = { hostname: '', zoneId: '', zoneName: '', originIp: '', lockOrigin: false, setupAt: null, setupBy: '', changes: [], warnings: [] };

export function mergeCloudflare(s = {}) {
  return { ...structuredClone(DEFAULT_CLOUDFLARE), ...(s && typeof s === 'object' && !Array.isArray(s) ? s : {}) };
}

// ----- What the administrator types -----

// A DNS name on a domain the school has on Cloudflare: lowercase letters, digits and hyphens.
export function checkHostname(value) {
  const h = String(value ?? '').trim().toLowerCase();
  const labels = h.split('.');
  const ok = h.length > 0 && h.length <= 253 && labels.length >= 2
    && labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))
    && !/^[0-9]+$/.test(labels.at(-1)); // not an IP address (or a name ending in digits)
  if (!ok) fail('Type the new address as a name like atlas.school.edu.ph: letters, digits and hyphens, with at least one dot.');
  if (h === 'duckdns.org' || h.endsWith('.duckdns.org')) fail('A duckdns.org address cannot go on Cloudflare. Use a name on the school\'s own domain, like atlas.school.edu.ph.');
  return h;
}

const PRIVATE_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const toInt = (ip) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);

// A public IPv4 address (not a private, shared, loopback, link-local, test or multicast one).
export function isPublicIpv4(value) {
  const ip = String(value ?? '').trim();
  if (!/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip)) return false;
  const n = toInt(ip);
  return !PRIVATE_V4.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(toInt(base) / 2 ** (32 - bits)));
}

export function checkOriginIp(value) {
  const ip = String(value ?? '').trim();
  if (!isPublicIpv4(ip)) fail('The server address must be this server\'s public IPv4 address, like 54.169.10.20 (not a private address such as 10.x.x.x or 192.168.x.x).');
  return ip;
}

export function checkToken(value) {
  const t = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(t)) fail('Paste the Cloudflare API token: the long code Cloudflare shows once when you create it.');
  return t;
}

// The names the zone could be, longest first: the hostname itself (a site on the bare domain), then
// each parent with at least two labels (atlas.school.edu.ph → school.edu.ph → edu.ph).
export function zoneCandidates(host) {
  const labels = host.split('.');
  const out = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
  return out;
}

// ----- Cloudflare's API -----

const SSL_LABELS = { off: 'Off', flexible: 'Flexible', full: 'Full', strict: 'Full (strict)', origin_pull: 'Strict (SSL-Only Origin Pull)' };
const INVALID_CODES = [1000, 6003, 6111, 9103, 9106];
const DENIED_CODES = [9109, 10000];
const isId = (v) => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const list = (v) => (Array.isArray(v) ? v : []);
const INVALID_TOKEN = 'Cloudflare did not accept this API token. Check that you copied all of it, and that it is not expired or switched off in Cloudflare → My Profile → API Tokens.';
const permissionMessage = (zone) => `This Cloudflare token may not do that for ${zone}. Edit the token in Cloudflare → My Profile → API Tokens and give it these permissions: ${PERMISSIONS}, with Zone Resources: Include · Specific zone · ${zone}.`;

function apiClient(fetchImpl, token) {
  return async (method, p, body) => {
    let res;
    try {
      res = await fetchImpl(`${CLOUDFLARE_API}${p}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      fail(`Could not reach Cloudflare (api.cloudflare.com): ${err?.name === 'TimeoutError' ? 'no answer in 15 seconds' : err?.cause?.code || err?.message || 'no answer'}. Try again in a minute.`, 502);
    }
    const raw = await res.text().catch(() => '');
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    const errors = list(json?.errors).filter((e) => e && typeof e === 'object');
    return { status: res.status, ok: res.ok && json?.success === true, result: json?.result, errors, codes: errors.map((e) => Number(e.code)) };
  };
}
const said = (r) => r.errors.map((e) => `${String(e.message || '').slice(0, 200)}${e.code ? ` (${e.code})` : ''}`).join('; ').slice(0, 400);
const isInvalid = (r) => r.status === 401 || r.codes.some((c) => INVALID_CODES.includes(c));
const isDenied = (r) => r.status === 403 || r.codes.some((c) => DENIED_CODES.includes(c));

// Sets up `hostname` in the school's Cloudflare zone, pointing at originIp. Everything is read and
// checked first; only then are settings and the DNS record changed (SSL/TLS before the record, so
// the name never goes through Cloudflare with a weaker mode). Returns what it changed, in words.
export async function provisionCloudflare({ fetchImpl, token, hostname, originIp }) {
  const host = checkHostname(hostname);
  const ip = checkOriginIp(originIp);
  const key = checkToken(token);
  const done = [];
  try {
    return await provision(apiClient(fetchImpl, key), host, ip, done);
  } catch (err) {
    // Never let the token out in a message (Cloudflare's own words are passed on).
    const scrub = (s) => String(s || '').split(key).join('[token]');
    const msg = err instanceof HttpError ? scrub(err.message) : `Something went wrong while talking to Cloudflare: ${scrub(err?.message)}`;
    throw new HttpError(err instanceof HttpError ? err.status : 502, done.length ? `${msg} (Already done in Cloudflare: ${done.join(', ')}.)` : msg);
  }
}

async function provision(call, host, ip, done) {
  const changes = [];
  const warnings = [];
  const parent = host.split('.').length > 2 ? host.split('.').slice(1).join('.') : host;
  const check = (r, zone, doing) => {
    if (r.ok) return r;
    if (isInvalid(r)) fail(INVALID_TOKEN);
    if (isDenied(r)) fail(permissionMessage(zone));
    fail(`Cloudflare answered ${r.status} while ${doing}${r.errors.length ? `: ${said(r)}` : ''}.`, 502);
  };

  // a. The token. An account-owned token cannot be checked here: the zone lookup decides.
  let rejected = false;
  const v = await call('GET', '/user/tokens/verify');
  if (v.ok && v.result?.status && v.result.status !== 'active') fail(`This Cloudflare API token is ${String(v.result.status).slice(0, 20)}. Make a new one (see the steps on this page).`);
  if (!v.ok && isInvalid(v)) rejected = true;

  // b. The zone: the longest name Cloudflare has.
  let zone = null;
  for (const name of zoneCandidates(host)) {
    const r = await call('GET', `/zones?name=${encodeURIComponent(name)}&per_page=50`);
    if (!r.ok && (isInvalid(r) || (rejected && isDenied(r)))) fail(INVALID_TOKEN);
    check(r, name, 'looking for the domain');
    const found = list(r.result).filter((z) => z && z.name === name && isId(z.id));
    if (found.length) {
      zone = found.find((z) => z.status === 'active') || found[0];
      break;
    }
  }
  if (!zone) fail(rejected ? INVALID_TOKEN : `Cloudflare has no domain for ${host} that this token can see. Add the school's domain (probably ${parent}) to Cloudflare, and give the token access to it (Zone Resources: Include · Specific zone · ${parent}).`);
  const zoneName = zone.name;
  const ns = list(zone.name_servers).filter((s) => typeof s === 'string').slice(0, 4).join(' and ');
  if (zone.status === 'pending' || zone.status === 'initializing') {
    fail(`Cloudflare has not activated ${zoneName} yet. Where the domain is registered, set its nameservers to ${ns || 'the two Cloudflare shows for it'}, wait until Cloudflare shows the domain as Active (from minutes to a day), then try again.`, 409);
  }
  if (zone.status === 'moved') fail(`Cloudflare says ${zoneName} has moved: its nameservers no longer point to Cloudflare. Set them back to ${ns || 'Cloudflare\'s'}, wait until it shows as Active, then try again.`, 409);
  if (zone.status !== 'active') fail(`Cloudflare shows ${zoneName} as "${String(zone.status).slice(0, 30)}". It must be Active.`, 409);
  const zid = zone.id;

  // c. DNS: what is there for the name already (read only, for now).
  const d = check(await call('GET', `/zones/${zid}/dns_records?name=${encodeURIComponent(host)}&per_page=100`), zoneName, 'reading the DNS records');
  const records = list(d.result).filter((r) => r && String(r.name).toLowerCase() === host);
  const blocking = records.find((r) => r.type === 'CNAME' || r.type === 'NS');
  if (blocking) fail(`${host} already has a ${blocking.type} record in Cloudflare (pointing to ${String(blocking.content).slice(0, 120)}). ATLAS changed nothing. If the name is free for ATLAS, delete that record in Cloudflare → DNS and try again, or choose another name.`, 409);
  const a = records.filter((r) => r.type === 'A');
  if (a.length > 1) fail(`${host} has ${a.length} A records in Cloudflare (${a.map((r) => r.content).join(', ').slice(0, 200)}). ATLAS changed nothing. Delete all but one in Cloudflare → DNS, then try again.`, 409);
  if (a[0] && !isId(a[0].id)) fail('Cloudflare sent a DNS record ATLAS does not understand.', 502);
  for (const r of records.filter((x) => x.type === 'AAAA')) {
    warnings.push(`${host} also has an IPv6 (AAAA) record, ${String(r.content).slice(0, 60)}. Visitors may be sent there instead of this server: delete it in Cloudflare → DNS unless it is this server.`);
  }

  // d. Settings (read): SSL/TLS mode, the oldest TLS version allowed, Always Use HTTPS.
  const setting = async (id) => check(await call('GET', `/zones/${zid}/settings/${id}`), zoneName, `reading the ${id} setting`).result?.value;
  const ssl = await setting('ssl');
  const tls = await setting('min_tls_version');
  const always = await setting('always_use_https');

  // Now the changes: settings first, then the record.
  const patch = async (id, value, phrase) => {
    check(await call('PATCH', `/zones/${zid}/settings/${id}`, { value }), zoneName, `changing the ${id} setting`);
    changes.push(phrase);
    done.push(phrase);
  };
  if (ssl !== 'strict') {
    await patch('ssl', 'strict', `set SSL/TLS encryption to Full (strict)${ssl ? ` (was ${SSL_LABELS[ssl] || ssl})` : ''}`);
    if (ssl && ssl !== 'origin_pull') warnings.push(`SSL/TLS encryption is set for the whole of ${zoneName}, so any other website on it that goes through Cloudflare now needs a valid HTTPS certificate too (it was ${SSL_LABELS[ssl] || ssl}).`);
  }
  if (['1.0', '1.1'].includes(tls)) await patch('min_tls_version', '1.2', `raised the minimum TLS version to 1.2 (was ${tls})`);
  if (always === 'on') warnings.push('"Always Use HTTPS" is on in Cloudflare (SSL/TLS → Edge Certificates). It may block the server\'s certificate renewals, which come in over plain HTTP. You can turn it off: ATLAS sends visitors to HTTPS itself.');

  let created = false;
  if (!a[0]) {
    check(await call('POST', `/zones/${zid}/dns_records`, { type: 'A', name: host, content: ip, proxied: true, ttl: 1, comment: 'Lancaster ATLAS (set up from the Admin panel)' }), zoneName, 'adding the DNS record');
    created = true;
    const phrase = `added the DNS record ${host} → ${ip}, proxied through Cloudflare`;
    changes.unshift(phrase);
    done.push(phrase);
  } else if (a[0].content !== ip || a[0].proxied !== true) {
    check(await call('PATCH', `/zones/${zid}/dns_records/${a[0].id}`, { content: ip, proxied: true }), zoneName, 'changing the DNS record');
    const phrase = a[0].content !== ip ? `pointed ${host} at ${ip} (was ${String(a[0].content).slice(0, 60)})${a[0].proxied !== true ? ', proxied through Cloudflare' : ''}` : `turned on the Cloudflare proxy for ${host}`;
    changes.unshift(phrase);
    done.push(phrase);
  }
  return { zoneId: zid, zoneName, created, changes, warnings };
}

// ----- The two files beside the data -----

// A small JSON file, never through a link (missing, a link, too big or unreadable: null).
function readJsonFile(file, maxBytes = 64 * 1024) {
  let fd;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > maxBytes) return null;
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
export function validRequest(r) {
  if (!r || typeof r !== 'object' || r.version !== 1 || typeof r.hostname !== 'string' || typeof r.lockOrigin !== 'boolean' || typeof r.requestedAt !== 'string') return null;
  return { version: 1, hostname: r.hostname.slice(0, 253), lockOrigin: r.lockOrigin, requestedAt: r.requestedAt.slice(0, 40), requestedBy: str(r.requestedBy, 120) || '' };
}
export function validStatus(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || s.version !== 1 || !['active', 'failed', 'off'].includes(s.state)) return null;
  if (typeof s.hostname !== 'string' || typeof s.requestedAt !== 'string') return null;
  for (const k of ['appliedAt', 'message']) if (s[k] != null && typeof s[k] !== 'string') return null;
  for (const k of ['certificate', 'throughCloudflare', 'originLocked']) if (s[k] != null && typeof s[k] !== 'boolean') return null;
  return {
    version: 1, state: s.state, hostname: s.hostname.slice(0, 253), requestedAt: s.requestedAt.slice(0, 40), appliedAt: str(s.appliedAt, 40),
    certificate: s.certificate === true, throughCloudflare: s.throughCloudflare === true, originLocked: s.originLocked === true, message: str(s.message, 500) || '',
  };
}

// ----- Routes (administrators only) -----

// fetchImpl: Cloudflare's API and the AWS instance metadata (for the server's public address).
// helperPath: where the server's root helper is installed. env: for the DuckDNS address.
export function registerCloudflareRoutes(route, ctx, { fetchImpl = (...a) => fetch(...a), helperPath = CLOUDFLARE_HELPER, env = process.env } = {}) {
  const cfg = () => ctx.db.data.settings.cloudflare || (ctx.db.data.settings.cloudflare = mergeCloudflare());
  const fileOf = (name) => (ctx.db.dir ? path.join(ctx.db.dir, name) : null);
  let memoryRequest = null; // the in-memory database has no folder: the request is kept here
  let lastRequestedAt = '';
  const only = (user) => {
    if (user?.role !== 'admin') fail('Only an administrator can set up Cloudflare.', 403);
  };

  const readRequest = () => (fileOf(CLOUDFLARE_REQUEST_FILE) ? validRequest(readJsonFile(fileOf(CLOUDFLARE_REQUEST_FILE))) : memoryRequest);
  const readStatus = () => (fileOf(CLOUDFLARE_STATUS_FILE) ? validStatus(readJsonFile(fileOf(CLOUDFLARE_STATUS_FILE))) : null);
  // The request file must be a plain file (or not there yet): never write through a link.
  const refuseLink = () => {
    const file = fileOf(CLOUDFLARE_REQUEST_FILE);
    if (!file) return;
    let st;
    try {
      st = fs.lstatSync(file);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    if (!st.isFile()) fail(`The file ${CLOUDFLARE_REQUEST_FILE} in ATLAS's data folder is a link or not a plain file, so ATLAS will not write it. Ask whoever looks after the server to delete it, then try again.`, 409);
  };
  // Each request gets a new requestedAt (later than the last, even within one millisecond).
  const stamp = () => {
    let t = new Date();
    if (lastRequestedAt && t.toISOString() <= lastRequestedAt) t = new Date(Date.parse(lastRequestedAt) + 1);
    lastRequestedAt = t.toISOString();
    return lastRequestedAt;
  };
  const writeRequest = (hostname, lockOrigin, user) => {
    const req = { version: 1, hostname, lockOrigin: Boolean(lockOrigin), requestedAt: stamp(), requestedBy: String(user.name || user.username || '').slice(0, 120) };
    const file = fileOf(CLOUDFLARE_REQUEST_FILE);
    if (!file) {
      memoryRequest = req;
      return req;
    }
    refuseLink();
    // A new file beside it (never an existing one, never through a link), then renamed over it.
    const tmp = path.join(ctx.db.dir, `.${CLOUDFLARE_REQUEST_FILE}.${randomBytes(6).toString('hex')}.tmp`);
    const fd = fs.openSync(tmp, 'wx', 0o640);
    try {
      fs.fchmodSync(fd, 0o640);
      fs.writeSync(fd, `${JSON.stringify(req, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.renameSync(tmp, file);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
    return req;
  };

  // The server's public IPv4 address, from AWS's instance metadata (IMDSv2), to fill in the form.
  let ipCache = { at: 0, value: undefined };
  const suggestedIp = async () => {
    if (ipCache.value || (ipCache.value === null && Date.now() - ipCache.at < 10 * 60 * 1000)) return ipCache.value;
    let value = null;
    try {
      const t = await fetchImpl(`${IMDS}/api/token`, { method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' }, redirect: 'manual', signal: AbortSignal.timeout(1000) });
      const token = t.ok ? (await t.text()).trim().slice(0, 200) : '';
      if (token) {
        const r = await fetchImpl(`${IMDS}/meta-data/public-ipv4`, { headers: { 'X-aws-ec2-metadata-token': token }, redirect: 'manual', signal: AbortSignal.timeout(1000) });
        const ip = r.ok ? (await r.text()).trim() : '';
        if (isPublicIpv4(ip)) value = ip;
      }
    } catch {
      value = null;
    }
    ipCache = { at: Date.now(), value };
    return value;
  };
  const duckdns = () => [...String(env.ALLOWED_HOSTS || '').split(','), (() => {
    try {
      return new URL(env.PUBLIC_URL || '').hostname;
    } catch {
      return '';
    }
  })()].map((h) => h.trim().toLowerCase()).find((h) => h.endsWith('.duckdns.org')) || null;

  const view = async () => {
    const s = cfg();
    const request = readRequest();
    const status = readStatus();
    const pending = Boolean(request && (!status || status.requestedAt !== request.requestedAt));
    const state = pending ? 'pending' : status ? status.state : 'none';
    return {
      settings: { hostname: s.hostname, zoneName: s.zoneName, originIp: s.originIp, lockOrigin: Boolean(s.lockOrigin), setupAt: s.setupAt, setupBy: s.setupBy, changes: list(s.changes), warnings: list(s.warnings) },
      request, status, pending, state,
      helperInstalled: fs.existsSync(helperPath),
      suggestedIp: await suggestedIp(),
      duckdns: duckdns(),
    };
  };

  route('GET', '/api/admin/cloudflare', 'admin', async ({ user }) => {
    only(user);
    return view();
  });

  // Set up for me. The token in the body is used for this request only: never stored, logged or sent back.
  route('POST', '/api/admin/cloudflare/setup', 'admin', async ({ body, user, ip, agent }) => {
    only(user);
    refuseLink(); // before anything changes in Cloudflare
    const out = await provisionCloudflare({ fetchImpl, token: body.token, hostname: body.hostname, originIp: body.originIp });
    const hostname = checkHostname(body.hostname);
    const originIp = checkOriginIp(body.originIp);
    const lockOrigin = Boolean(body.lockOrigin);
    writeRequest(hostname, lockOrigin, user);
    Object.assign(cfg(), { hostname, zoneId: out.zoneId, zoneName: out.zoneName, originIp, lockOrigin, setupAt: new Date().toISOString(), setupBy: user.name, changes: out.changes, warnings: out.warnings });
    ctx.audit?.({ kind: 'access', system: 'admin', action: 'Set up Cloudflare', actor: user, ip, agent, detail: `${hostname} on ${out.zoneName} → ${originIp}: ${out.changes.length ? out.changes.join(', ') : 'nothing to change in Cloudflare'}${lockOrigin ? '; only through Cloudflare' : ''}` });
    ctx.db.save();
    console.log(`Cloudflare: ${hostname} (zone ${out.zoneName}) set up by ${user.username}${out.changes.length ? ` (${out.changes.join(', ')})` : ' (nothing to change)'}; waiting for the server to switch over.`);
    return { ...(await view()), changes: out.changes, warnings: out.warnings };
  }, { limit: 'password', audit: false });

  // Only accept visitors through Cloudflare (or from anywhere again). No token needed.
  route('POST', '/api/admin/cloudflare/lock', 'admin', async ({ body, user, ip, agent }) => {
    only(user);
    const s = cfg();
    if (!s.hostname) fail('Set Cloudflare up first.', 409);
    const lockOrigin = Boolean(body.lockOrigin);
    writeRequest(s.hostname, lockOrigin, user);
    s.lockOrigin = lockOrigin;
    ctx.audit?.({ kind: 'access', system: 'admin', action: lockOrigin ? 'Cloudflare: only accept visitors through Cloudflare' : 'Cloudflare: accept visitors from anywhere', actor: user, ip, agent, detail: s.hostname });
    ctx.db.save();
    return view();
  }, { audit: false });

  // Back to the DuckDNS address only. Cloudflare itself is not changed: the DNS record stays there.
  route('POST', '/api/admin/cloudflare/off', 'admin', async ({ user, ip, agent }) => {
    only(user);
    const s = cfg();
    const was = s.hostname;
    writeRequest('', false, user);
    Object.assign(s, { hostname: '', lockOrigin: false });
    ctx.audit?.({ kind: 'access', system: 'admin', action: 'Switched Cloudflare off', actor: user, ip, agent, detail: was ? `${was} (its DNS record stays in Cloudflare)` : '' });
    ctx.db.save();
    return { ...(await view()), note: `The DNS record${was ? ` for ${was}` : ''} stays in Cloudflare; delete it there if you no longer need it.` };
  }, { audit: false });
}
