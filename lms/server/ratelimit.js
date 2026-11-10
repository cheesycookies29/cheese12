// Rate limits: how many requests one person, or one network address, may make in a stretch of
// time. Counts are kept in memory (one server process), in a sliding window, so a burst at the
// edge of a minute is not let through twice. No dependencies.
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
