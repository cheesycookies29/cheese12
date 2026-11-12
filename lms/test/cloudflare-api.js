// A stand-in for Cloudflare's API v4 (and AWS's instance metadata) in tests: a fetch-compatible
// function that answers the calls "Set up Cloudflare for me" makes, from zones, DNS records and
// settings held in memory, and records every call (method, path, body, headers, options).
//   token: the token it accepts. accountToken: /user/tokens/verify refuses it (as for a token owned
//   by an account), but the zone calls work. tokenStatus: what verify says ('active', 'disabled'…).
//   zones: [{ name, status, name_servers }]. records: [{ type, name, content, proxied }] in the first zone.
//   settings: the first zone's settings (ssl, min_tls_version, always_use_https).
//   can: { zoneRead, dnsEdit, settingsEdit }: the token's permissions.
//   ip: the public IPv4 the instance metadata gives (null: no metadata service, as off AWS).
import { randomBytes } from 'node:crypto';

export const TOKEN = 'cf_TestToken_abcdefghijklmnopqrstuvwxyz0123';
const hex = () => randomBytes(16).toString('hex');

export function fakeCloudflare({ token = TOKEN, accountToken = false, tokenStatus = 'active', zones = [{ name: 'school.edu.ph' }], records = [], settings = {}, can = {}, ip = '54.169.10.20' } = {}) {
  const perms = { zoneRead: true, dnsEdit: true, settingsEdit: true, ...can };
  const zs = zones.map((z) => ({ id: hex(), status: 'active', name_servers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'], ...z }));
  const dns = records.map((r) => ({ id: hex(), proxied: false, ttl: 1, ...r, zone: zs[0]?.id }));
  const zoneSettings = Object.fromEntries(zs.map((z, i) => [z.id, { ssl: 'full', min_tls_version: '1.0', always_use_https: 'off', ...(i === 0 ? settings : {}) }]));
  const calls = [];

  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const ok = (result) => reply(200, { success: true, errors: [], messages: [], result });
  const err = (status, code, message) => reply(status, { success: false, errors: [{ code, message }], messages: [], result: null });

  async function cfFetch(input, opts = {}) {
    const url = new URL(String(input));
    const method = (opts.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = opts.body ? JSON.parse(opts.body) : null;
    const call = { method, host: url.host, path: `${url.pathname}${url.search}`, body, headers, redirect: opts.redirect, signal: Boolean(opts.signal) };
    calls.push(call);

    // AWS instance metadata (IMDSv2).
    if (url.host === '169.254.169.254') {
      if (!ip) throw new TypeError('fetch failed');
      if (method === 'PUT' && url.pathname === '/latest/api/token' && headers['x-aws-ec2-metadata-token-ttl-seconds']) return new Response('imds-token');
      if (method === 'GET' && url.pathname === '/latest/meta-data/public-ipv4' && headers['x-aws-ec2-metadata-token'] === 'imds-token') return new Response(ip);
      return new Response('', { status: 401 });
    }
    if (url.host !== 'api.cloudflare.com' || !url.pathname.startsWith('/client/v4/')) return new Response('not found', { status: 404 });
    const p = url.pathname.slice('/client/v4'.length);
    const valid = headers.authorization === `Bearer ${token}`;

    if (p === '/user/tokens/verify' && method === 'GET') {
      if (!valid || accountToken) return err(401, 1000, 'Invalid API Token');
      return ok({ id: hex(), status: tokenStatus });
    }
    if (!valid) return err(401, 10000, 'Authentication error');

    if (p === '/zones' && method === 'GET') {
      if (!perms.zoneRead) return ok([]); // Cloudflare lists only the zones a token may read
      return ok(zs.filter((z) => z.name === url.searchParams.get('name')).map(({ id, name, status, name_servers }) => ({ id, name, status, name_servers })));
    }
    const m = p.match(/^\/zones\/([a-f0-9]{32})\/(dns_records|settings)(?:\/([\w]+))?$/);
    const zone = m && zs.find((z) => z.id === m[1]);
    if (!zone) return err(404, 7003, 'Could not route to the zone');
    if (m[2] === 'dns_records') {
      if (!perms.dnsEdit) return err(403, 10000, 'Authentication error');
      if (method === 'GET' && !m[3]) return ok(dns.filter((r) => r.zone === zone.id && (!url.searchParams.get('name') || r.name === url.searchParams.get('name'))));
      if (method === 'POST' && !m[3]) {
        const r = { id: hex(), ...body, zone: zone.id };
        dns.push(r);
        return ok(r);
      }
      const r = dns.find((x) => x.id === m[3] && x.zone === zone.id);
      if (method === 'PATCH' && r) {
        Object.assign(r, body);
        return ok(r);
      }
      return err(404, 81044, 'Record does not exist.');
    }
    if (!perms.settingsEdit) return err(403, 9109, 'Unauthorized to access requested resource');
    const id = m[3];
    if (!(id in zoneSettings[zone.id])) return err(404, 1003, 'Invalid or missing setting');
    if (method === 'PATCH') zoneSettings[zone.id][id] = body.value;
    return ok({ id, value: zoneSettings[zone.id][id], editable: true });
  }

  return {
    fetch: cfFetch,
    calls,
    zones: zs,
    records: dns,
    settings: (i = 0) => zoneSettings[zs[i].id],
    // Calls to Cloudflare itself (not the instance metadata), and the ones that change something.
    api: () => calls.filter((c) => c.host === 'api.cloudflare.com'),
    writes: () => calls.filter((c) => c.host === 'api.cloudflare.com' && c.method !== 'GET'),
  };
}
