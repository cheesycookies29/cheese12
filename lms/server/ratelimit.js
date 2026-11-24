// Rate limits: how many requests one person, or one network address, may make in a stretch of
// time. Counts are kept in memory (one server process), in a sliding window, so a burst at the
// edge of a minute is not let through twice. No dependencies.
import net from 'node:net';
import { HttpError } from './util.js';

// The visitor's address. Behind Caddy (or any proxy on this computer) every connection comes from
// 127.0.0.1, and the proxy puts the visitor's address last in X-Forwarded-For; the header is only
// believed from a proxy on this computer, so someone on the internet cannot make up an address.
export function clientIp(req) {
  const peer = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const fromProxy = peer === '127.0.0.1' || peer === '::1';
  const forwarded = fromProxy && String(req.headers?.['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean).pop();
  return (forwarded || peer || 'unknown').replace(/^::ffff:/, '');
}

// rules: { name: { limit, windowMs } } or a function returning them (read at each request, so
// Settings apply at once). maxKeys bounds memory however many addresses come by.
export function createRateLimiter(rules, { now = () => Date.now(), maxKeys = 50000 } = {}) {
  const buckets = new Map(); // `${rule}|${key}` → { start, prev, count } (two fixed windows, weighted)
  const ruleOf = (name) => (typeof rules === 'function' ? rules() : rules)[name];
  const state = (name, key, windowMs) => {
    const id = `${name}|${key}`;
    const t = now();
    let b = buckets.get(id);
    if (!b) {
      if (buckets.size >= maxKeys) prune(true);
      b = { start: t - (t % windowMs), prev: 0, count: 0 };
      buckets.set(id, b);
    }
    // Move the window along: the last window's count fades out as the new one fills.
    const elapsed = t - b.start;
    if (elapsed >= windowMs) {
      b.prev = elapsed >= 2 * windowMs ? 0 : b.count;
      b.count = 0;
      b.start = t - (t % windowMs);
    }
    const weight = 1 - (t - b.start) / windowMs;
    return { b, used: b.prev * weight + b.count, resetMs: windowMs - (t - b.start) };
  };
  function prune(hard = false) {
    const t = now();
    for (const [id, b] of buckets) {
      const name = id.slice(0, id.indexOf('|'));
      const windowMs = ruleOf(name)?.windowMs || 60000;
      if (t - b.start >= 2 * windowMs) buckets.delete(id);
    }
    // Still full (a flood of new addresses): forget the oldest half rather than grow without end.
    if (hard && buckets.size >= maxKeys) {
      let n = Math.floor(buckets.size / 2);
      for (const id of buckets.keys()) {
        if (n-- <= 0) break;
        buckets.delete(id);
      }
    }
  }
  const timer = setInterval(() => prune(), 60000);
  timer.unref?.();
  const tooMany = (resetMs, message) => {
    const secs = Math.max(1, Math.ceil(resetMs / 1000));
    const wait = secs >= 90 ? `${Math.ceil(secs / 60)} minutes` : `${secs} second${secs > 1 ? 's' : ''}`;
    return Object.assign(new HttpError(429, `${message || 'Too many requests.'} Try again in ${wait}.`), { headers: { 'Retry-After': String(secs) } });
  };
  return {
    // Count one request; throws 429 (with Retry-After) once the limit is passed.
    hit(name, key, message) {
      const rule = ruleOf(name);
      if (!rule || !(rule.limit > 0)) return;
      const { b, used, resetMs } = state(name, key, rule.windowMs);
      if (used + 1 > rule.limit) throw tooMany(resetMs, message);
      b.count += 1;
    },
    // Only look (for counts that grow elsewhere, e.g. failed sign-ins): throws while over the limit.
    check(name, key, message) {
      const rule = ruleOf(name);
      if (!rule || !(rule.limit > 0)) return;
      const { used, resetMs } = state(name, key, rule.windowMs);
      if (used >= rule.limit) throw tooMany(resetMs, message);
    },
    add(name, key) {
      const rule = ruleOf(name);
      if (!rule || !(rule.limit > 0)) return;
      state(name, key, rule.windowMs).b.count += 1;
    },
    get size() {
      return buckets.size;
    },
    prune,
  };
}

// ----- School networks: the addresses a campus reaches the internet through -----
// A whole campus often shares one or two public addresses (NAT), so limits counted per address would
// treat a thousand students as one visitor. Addresses an administrator lists here get the per-address
// limits multiplied (api.js); everything else is unchanged, so password spraying from the internet
// still meets the usual limit. An entry is one address or a range in CIDR form.
export const SCHOOL_NETWORKS_MAX = 50;
const MIN_PREFIX = { ipv4: 16, ipv6: 32 }; // nothing wider than a /16 (65,536 addresses) or an IPv6 /32
// '203.0.113.7' → { cidr: '203.0.113.7/32', family: 'ipv4' }; throws a plain Error for anything else.
export function parseNetwork(text) {
  const raw = String(text ?? '').trim();
  const [addr, bits, extra] = raw.split('/');
  const v = net.isIP(addr || '');
  if (!v || extra !== undefined) throw new Error(`“${raw.slice(0, 60)}” is not an address or a range such as 203.0.113.0/24.`);
  const family = v === 4 ? 'ipv4' : 'ipv6';
  const max = v === 4 ? 32 : 128;
  const prefix = bits === undefined ? max : /^\d{1,3}$/.test(bits) ? Number(bits) : NaN;
  if (!(prefix >= 0 && prefix <= max)) throw new Error(`“${raw.slice(0, 60)}”: the part after / must be 0 to ${max}.`);
  if (prefix < MIN_PREFIX[family]) throw new Error(`“${raw}” is too wide: a school network is at most a /${MIN_PREFIX[family]}${family === 'ipv6' ? ' for IPv6' : ''}.`);
  const probe = new net.BlockList();
  probe.addSubnet(addr, prefix, family);
  if (probe.check(family === 'ipv4' ? '127.0.0.1' : '::1', family) || probe.check(family === 'ipv4' ? '0.0.0.0' : '::', family)) throw new Error(`“${raw}” is this computer's own address, not a school network.`);
  return { cidr: `${addr.toLowerCase()}/${prefix}`, family };
}
// A checker for a list of { cidr }: is this address on a school network? Rebuilt only when the list changes.
export function networkMatcher() {
  let key = null;
  let list = null;
  return (entries, ip) => {
    const k = JSON.stringify((entries || []).map((e) => e.cidr));
    if (k !== key) {
      key = k;
      list = new net.BlockList();
      for (const e of entries || []) {
        try {
          const { cidr, family } = parseNetwork(e.cidr);
          const [a, b] = cidr.split('/');
          list.addSubnet(a, Number(b), family);
        } catch {
          // an entry that no longer passes the checks is skipped
        }
      }
    }
    const v = net.isIP(String(ip || ''));
    return v ? list.check(String(ip), v === 4 ? 'ipv4' : 'ipv6') : false;
  };
}

// The network an address belongs to, as an entry would name it: an IPv4 address itself, or the /64
// of an IPv6 address (a campus's devices change their own part of it).
export function networkOf(ip) {
  const v = net.isIP(String(ip || ''));
  if (v === 4) return String(ip);
  if (v !== 6) return null;
  const [head, tail = ''] = String(ip).toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = String(ip).includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
