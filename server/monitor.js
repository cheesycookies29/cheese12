// The security monitor's collector (0.34): what the server sees, counted in buckets of fixed size.
// Sources: every request (server.js reports it when the answer is sent), every audit log entry,
// and the process itself, sampled each minute. Nothing is read from request bodies or queries.
//
// Kept in three tiers, as Netdata does, so the history never grows: a minute for an hour, an hour
// for a week, a day for 90 days. Routes are counted by template (/api/employees/:id), never by the
// raw path (OpenTelemetry's http.route), and network addresses are capped per bucket and kept a
// week. Saved each minute to monitor.json in the data folder (not part of backups: it describes this
// server, not the company's data). design notes: docs/security-monitor.md
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import v8 from 'node:v8';
import { monitorEventLoopDelay } from 'node:perf_hooks';

// OpenTelemetry's recommended boundaries for http.server.request.duration, in milliseconds; one
// more bucket counts everything over 10 seconds.
export const DURATION_BOUNDS_MS = [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];
const HIST = DURATION_BOUNDS_MS.length + 1;
export const TIERS = {
  minute: { ms: 60000, keep: 60 },
  hour: { ms: 3600000, keep: 168 },
  day: { ms: 86400000, keep: 90 },
};
export const MAX_ADDRESSES = 300; // per bucket; the rest are counted as OTHERS
export const OTHERS = '(others)';
export const UNKNOWN_ROUTE = '(unknown)';
const FILE_VERSION = 1;

// The refusals and sign-in events counted as signals, with the OWASP API Security Top 10 (2023)
// category each one guards. Modules can add their own with monitor.signal().
const BUILT_IN_SIGNALS = [
  ['unauthenticated', { label: 'Not signed in', group: 'api', owasp: 'API2' }],
  ['denied', { label: 'Not allowed (permission or record rule)', group: 'api', owasp: 'API1 · API5' }],
  ['rate-limited', { label: 'Too many requests', group: 'api', owasp: 'API4' }],
  ['too-large', { label: 'Request too large', group: 'api', owasp: 'API4' }],
  ['not-json', { label: 'Not JSON', group: 'api', owasp: 'API8' }],
  ['bad-json', { label: 'Malformed JSON', group: 'api', owasp: 'API8' }],
  ['cross-site', { label: 'From another site (CSRF)', group: 'api', owasp: 'API8' }],
  ['wrong-host', { label: 'Wrong host name (DNS rebinding)', group: 'api', owasp: 'API8' }],
  ['unknown-route', { label: 'Unknown API address', group: 'api', owasp: 'API9' }],
  ['probe', { label: 'Scanner paths (/.env, /wp-admin, .php)', group: 'api', owasp: 'API8' }],
  ['login-failed', { label: 'Failed sign-ins', group: 'auth', owasp: 'API2' }],
  ['locked', { label: 'Usernames locked', group: 'auth', owasp: 'API2' }],
  ['code-failed', { label: 'Wrong 2-step codes', group: 'auth', owasp: 'API2' }],
  ['recovery-used', { label: 'Recovery codes used', group: 'auth', owasp: 'API2' }],
  ['audit-gap', { label: 'Audit entries missing', group: 'auth', owasp: '' }],
];
// Audit actions that are signals.
const AUDIT_SIGNALS = { 'auth.login-failed': 'login-failed', 'auth.locked': 'locked', 'auth.2fa-failed': 'code-failed', 'auth.recovery-used': 'recovery-used', 'audit.gap': 'audit-gap' };
// Paths only scanners ask for (CORE has no PHP, WordPress or dot files to serve).
const PROBE = /(^|\/)\.(env|git|aws|ssh|htaccess|htpasswd|DS_Store)|wp-(admin|login|content|includes)|phpmyadmin|\.(php|asp|aspx|jsp|cgi)$|\/cgi-bin\/|\/actuator\b|\/server-status|\/vendor\/phpunit|\/boaform|\/\.well-known\/(?!security\.txt)/i;
export const isProbe = (pathname) => PROBE.test(pathname || '');

// The status code says what kind of refusal it was; the sign-in routes' 401 is the audit's
// "failed sign-in", not counted twice.
export function signalOf({ status, kind, route, method, path: p }) {
  if (isProbe(p)) return 'probe';
  if (kind !== 'api') return null;
  if (status === 401) return method === 'POST' && /^\/api\/auth\/(login|2fa)$/.test(route || '') ? null : 'unauthenticated';
  if (status === 403) return 'denied';
  if (status === 429) return 'rate-limited';
  if (status === 413) return 'too-large';
  if (status === 415) return 'not-json';
  if (status === 404 && route === UNKNOWN_ROUTE) return 'unknown-route';
  return null;
}

const histIndex = (ms) => {
  const i = DURATION_BOUNDS_MS.findIndex((b) => ms <= b);
  return i === -1 ? HIST - 1 : i;
};
// A percentile from a histogram, interpolated inside its bucket (as Prometheus's histogram_quantile).
export function percentile(hist, p) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const rank = (p / 100) * total;
  let cum = 0;
  for (let i = 0; i < HIST; i++) {
    if (!hist[i]) continue;
    if (cum + hist[i] >= rank) {
      if (i === HIST - 1) return DURATION_BOUNDS_MS.at(-1);
      const lo = i ? DURATION_BOUNDS_MS[i - 1] : 0;
      return Math.round((lo + (DURATION_BOUNDS_MS[i] - lo) * ((rank - cum) / hist[i])) * 10) / 10;
    }
    cum += hist[i];
  }
  return DURATION_BOUNDS_MS.at(-1);
}

// Where a bucket starts. Days start at local midnight (the server runs in the company's time zone).
export function bucketStart(tier, t) {
  if (tier === 'day') {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return t - (t % TIERS[tier].ms);
}

const emptyBucket = (tier, t) => ({
  t, n: 0, s: { 2: 0, 3: 0, 4: 0, 5: 0 }, pages: 0, api: 0, files: 0, https: 0, plainNet: 0, out: 0,
  lat: Array(HIST).fill(0), sig: {}, act: {}, users: {}, actors: {}, signIns: 0, routes: {},
  ...(tier === 'day' ? {} : { ips: {} }),
  sys: null,
});

const add = (obj, key, n = 1) => {
  obj[key] = (obj[key] || 0) + n;
};
const isLoopback = (ip) => /^(127\.|::1$|::ffff:127\.)/.test(ip || '');

// The process now: memory, CPU since the last sample, the event loop's delay, the disk.
let loopDelay = null;
function loopHistogram() {
  if (!loopDelay) {
    loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();
  }
  return loopDelay;
}

export function diskOf(dir) {
  try {
    const s = fs.statfsSync(dir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null; // older Node, or not supported here
  }
}

// dir: the data folder. sessions: () => the open sessions (for the per-minute sample).
export function createMonitor(dir, { sessions = () => [], now = () => Date.now(), persist = true } = {}) {
  const file = path.join(dir, 'monitor.json');
  const startedAt = now();
  const tiers = { minute: [], hour: [], day: [] };
  let token = null; // { hash, createdAt, createdBy }: the metrics scrape token (only its hash)
  // Since this process started, for the metrics export (Prometheus counters only go up).
  const totals = { http: new Map(), hist: new Map(), signals: {}, actions: 0, signIns: 0 };
  let dirty = false;
  const signals = new Map(BUILT_IN_SIGNALS);
  const checks = new Map();

  // ----- Saved state -----
  function load() {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved?.v !== FILE_VERSION) return;
      const t = now();
      for (const tier of Object.keys(TIERS)) {
        const oldest = bucketStart(tier, t) - TIERS[tier].ms * (TIERS[tier].keep - 1) - (tier === 'day' ? 3600000 : 0);
        tiers[tier] = (Array.isArray(saved[tier]) ? saved[tier] : []).filter((b) => b && Number.isFinite(b.t) && b.t >= oldest && b.t <= t && Array.isArray(b.lat) && b.lat.length === HIST).map((b) => ({ ...emptyBucket(tier, b.t), ...b }));
      }
      if (saved.token && typeof saved.token.hash === 'string') token = saved.token;
    } catch {
      // No file yet, or unreadable: start empty.
    }
  }
  function save() {
    if (!persist) return;
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ v: FILE_VERSION, savedAt: new Date(now()).toISOString(), token, ...tiers }), { mode: 0o600 });
      fs.renameSync(tmp, file);
      dirty = false;
    } catch (err) {
      console.error('Security monitor: could not save monitor.json:', err.message);
    }
  }
  if (persist) load();

  // The bucket of each tier for time t, made (and old ones dropped) as time moves on.
  function current(tier, t) {
    const list = tiers[tier];
    const start = bucketStart(tier, t);
    let b = list.at(-1);
    if (!b || b.t < start) {
      b = emptyBucket(tier, start);
      list.push(b);
      const keep = TIERS[tier].keep;
      if (list.length > keep) list.splice(0, list.length - keep);
      const oldest = start - TIERS[tier].ms * (keep - 1) - (tier === 'day' ? 3600000 : 0);
      while (list.length && list[0].t < oldest) list.shift();
    }
    return b;
  }
  const buckets = (t) => Object.keys(TIERS).map((tier) => current(tier, t));

  function countSignal(b, name, ip, n = 1) {
    add(b.sig, name, n);
    if (b.ips && ip) address(b, ip).s[name] = (address(b, ip).s[name] || 0) + n;
  }
  function address(b, ip) {
    let a = b.ips[ip];
    if (!a) {
      const key = Object.keys(b.ips).length >= MAX_ADDRESSES ? OTHERS : ip;
      a = b.ips[key] ||= { n: 0, s: {}, last: 0 };
    }
    return a;
  }

  // One finished request. o: { method, route, kind: 'api' | 'page' | 'file', path, status, ms,
  // out (bytes sent), https, userId, ip, signal (when the server named the refusal) }.
  function observe(o) {
    const t = now();
    const route = o.kind === 'api' ? o.route || UNKNOWN_ROUTE : o.kind === 'page' ? '(pages)' : '(files)';
    const status = Number(o.status) || 0;
    const cls = Math.floor(status / 100);
    const sig = o.signal || signalOf({ ...o, route });
    const ms = Math.max(0, Number(o.ms) || 0);
    const routeKey = `${o.method} ${route}`;
    for (const b of buckets(t)) {
      b.n += 1;
      if (b.s[cls] !== undefined) b.s[cls] += 1;
      b[o.kind === 'api' ? 'api' : o.kind === 'page' ? 'pages' : 'files'] += 1;
      if (o.https) b.https += 1;
      else if (!isLoopback(o.ip)) b.plainNet += 1;
      b.out += Number(o.out) || 0;
      if (o.kind === 'api') {
        b.lat[histIndex(ms)] += 1;
        const r = (b.routes[routeKey] ||= { n: 0, e: 0, lat: Array(HIST).fill(0) });
        r.n += 1;
        if (cls === 5) r.e += 1;
        r.lat[histIndex(ms)] += 1;
      }
      if (o.userId) add(b.users, o.userId);
      if (b.ips && o.ip) {
        const a = address(b, o.ip);
        a.n += 1;
        a.last = t;
      }
      if (sig) countSignal(b, sig, o.ip);
    }
    // Since start, for the metrics export.
    const httpKey = `${o.method}|${route}|${status}`;
    totals.http.set(httpKey, (totals.http.get(httpKey) || 0) + 1);
    if (o.kind === 'api') {
      const h = totals.hist.get(`${o.method}|${route}`) || { lat: Array(HIST).fill(0), sum: 0, n: 0 };
      h.lat[histIndex(ms)] += 1;
      h.sum += ms;
      h.n += 1;
      totals.hist.set(`${o.method}|${route}`, h);
    }
    if (sig) add(totals.signals, sig);
    dirty = true;
  }

  // One audit log entry: what area people work in, sign-ins, and the sign-in signals.
  function audit(entry) {
    if (!entry?.action) return;
    const t = now();
    const area = String(entry.action).split('.')[0];
    const sig = AUDIT_SIGNALS[entry.action];
    for (const b of buckets(t)) {
      add(b.act, area);
      if (entry.userId) add(b.actors, entry.userId);
      if (entry.action === 'auth.login') b.signIns += 1;
      if (sig) countSignal(b, sig, entry.ip);
    }
    totals.actions += 1;
    if (entry.action === 'auth.login') totals.signIns += 1;
    if (sig) add(totals.signals, sig);
    dirty = true;
  }

  // ----- The process, sampled every minute -----
  let lastSample = null;
  let lastCpu = process.cpuUsage();
  let lastCpuAt = now();
  function sample() {
    const t = now();
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage(lastCpu);
    const elapsed = Math.max(1, t - lastCpuAt) * 1000; // µs
    lastCpu = process.cpuUsage();
    lastCpuAt = t;
    const loop = loopHistogram();
    const lagMs = loop.count ? Math.round((loop.percentile(99) / 1e6) * 10) / 10 : 0;
    loop.reset();
    const open = sessions();
    const s = {
      at: t, rss: mem.rss, heap: mem.heapUsed, heapLimit: v8.getHeapStatistics().heap_size_limit,
      cpu: Math.round(((cpu.user + cpu.system) / elapsed) * 1000) / 10, // % of one core
      lag: lagMs, sessions: open.length, people: new Set(open.map((x) => x.userId)).size,
    };
    lastSample = s;
    const [m, h] = buckets(t);
    m.sys = s;
    // An hour keeps its highest values.
    h.sys = h.sys ? { at: t, rss: Math.max(h.sys.rss, s.rss), heap: Math.max(h.sys.heap, s.heap), heapLimit: s.heapLimit, cpu: Math.max(h.sys.cpu, s.cpu), lag: Math.max(h.sys.lag, s.lag), sessions: Math.max(h.sys.sessions, s.sessions), people: Math.max(h.sys.people, s.people) } : s;
    dirty = true;
    return s;
  }
  const timer = setInterval(() => {
    sample();
    if (dirty) save();
  }, 60000);
  timer.unref?.();

  // ----- Reading -----
  // The buckets of a range, oldest first, with empty ones filled in so a chart has no holes.
  const RANGES = { '1h': ['minute', 60], '24h': ['hour', 24], '7d': ['hour', 168], '30d': ['day', 30] };
  function series(range, t = now()) {
    const [tier, count] = RANGES[range] || RANGES['24h'];
    const byStart = new Map(tiers[tier].map((b) => [b.t, b]));
    const out = [];
    let start = bucketStart(tier, t);
    for (let i = 0; i < count; i++) {
      out.unshift(byStart.get(start) || emptyBucket(tier, start));
      start = tier === 'day' ? bucketStart('day', start - 3600000) : start - TIERS[tier].ms;
    }
    return { tier, buckets: out };
  }
  // Buckets merged into one (counts added, histograms added, maps merged).
  function merge(list) {
    const m = emptyBucket('minute', list[0]?.t || 0);
    m.ips = {};
    for (const b of list) {
      m.n += b.n;
      for (const k of Object.keys(m.s)) m.s[k] += b.s?.[k] || 0;
      for (const k of ['pages', 'api', 'files', 'https', 'plainNet', 'out', 'signIns']) m[k] += b[k] || 0;
      b.lat.forEach((v, i) => (m.lat[i] += v));
      for (const key of ['sig', 'act', 'users', 'actors']) for (const [k, v] of Object.entries(b[key] || {})) add(m[key], k, v);
      for (const [k, r] of Object.entries(b.routes || {})) {
        const x = (m.routes[k] ||= { n: 0, e: 0, lat: Array(HIST).fill(0) });
        x.n += r.n;
        x.e += r.e;
        r.lat.forEach((v, i) => (x.lat[i] += v));
      }
      for (const [ip, a] of Object.entries(b.ips || {})) {
        const x = (m.ips[ip] ||= { n: 0, s: {}, last: 0 });
        x.n += a.n;
        x.last = Math.max(x.last, a.last || 0);
        for (const [k, v] of Object.entries(a.s || {})) add(x.s, k, v);
      }
    }
    return m;
  }
  // Network addresses for a range: from the minute or hour tier (days keep none: a week at most).
  function addressBuckets(range, t = now()) {
    if (range === '1h') return series('1h', t).buckets;
    return series(range === '24h' ? '24h' : '7d', t).buckets;
  }

  return {
    file,
    startedAt,
    observe,
    audit,
    sample,
    lastSample: () => lastSample || sample(),
    series,
    merge,
    addressBuckets,
    totals,
    // Registries: a module adds its own checks and signals, and the page shows them unchanged.
    // check(id, fn): fn(ctx) returns { area, label, state: 'ok' | 'warn' | 'bad' | 'info', detail, href },
    // a list of them, or null when it does not apply.
    check(id, fn) {
      checks.set(id, fn);
    },
    signal(name, def) {
      signals.set(name, { group: 'api', owasp: '', ...def });
    },
    signals: () => [...signals].map(([name, def]) => ({ name, ...def })),
    runChecks(ctx) {
      const out = [];
      for (const [id, fn] of checks) {
        try {
          const r = fn(ctx);
          for (const c of [r].flat().filter(Boolean)) out.push({ id: c.id || id, area: 'software', state: 'info', detail: '', href: '', ...c });
        } catch (err) {
          out.push({ id, area: 'software', label: id, state: 'warn', detail: `This check could not run: ${err.message}`, href: '' });
        }
      }
      return out;
    },
    token: () => token,
    setToken(t) {
      token = t;
      save();
    },
    flush: save,
    stop() {
      clearInterval(timer);
      if (dirty) save();
    },
  };
}

// Host facts for the status page.
export const hostInfo = () => ({ platform: `${os.type()} ${os.release()}`, arch: os.arch(), cpus: os.cpus().length, memory: os.totalmem(), load: os.loadavg().map((x) => Math.round(x * 100) / 100) });
