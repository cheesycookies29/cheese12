// Admin panel → Security monitor (0.34): the software's status (checks), the API's security (the
// route inventory, the controls in force, refusals and the addresses behind them), the traffic and
// what people do. The data comes from server/monitor.js; design notes: docs/security-monitor.md
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError } from './util.js';
import { APP_VERSION } from '../shared/devlog.js';
import { ROLES, userCan } from '../shared/roles.js';
import { moduleOfApi, moduleName } from '../shared/modules.js';
import { TWO_FACTOR_POLICIES, twoFactorRequired } from './security.js';
import { buildInfo } from './build.js';
import { hasDemo } from './demo.js';
import { DURATION_BOUNDS_MS, percentile, diskOf, hostInfo, OTHERS } from './monitor.js';

const DAY = 86400000;
const ROOT = process.env.CORE_APP_DIR || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const RANGES = ['1h', '24h', '7d', '30d'];

// When each Node.js release line stops getting security fixes (nodejs.org/en/about/previous-releases).
// Odd-numbered lines are short-lived and never long-term support.
export const NODE_END_OF_LIFE = { 18: '2025-04-30', 20: '2026-04-30', 22: '2027-04-30', 24: '2028-04-30', 26: '2029-04-30' };

// The audit log's areas (the first part of an action), named as the screens name them.
const AREA_LABELS = {
  auth: 'Sign-in and 2-step', user: 'User accounts', employee: 'Employee records', attendance: 'Attendance', payroll: 'Payroll',
  leave: 'Leave', request: 'Requests', requests: 'Requests', approval: 'Approvals', approvals: 'Approvals', holidays: 'Holidays', holiday: 'Holidays',
  asset: 'IT assets', assets: 'IT assets', inventory: 'Inventory', helpdesk: 'Service desk', ticket: 'Service desk', crm: 'Sales & CRM', pm: 'Projects', project: 'Projects',
  settings: 'Settings', roles: 'Roles & permissions', modules: 'Modules', data: 'Backup & data', audit: 'Audit log', devlog: 'Dev log', feedback: 'Feedback',
  guides: 'Help & guides', monitor: 'Security monitor', me: 'Self-service', clock: 'Time clock', location: 'Clock-in locations',
};
export const areaLabel = (a) => AREA_LABELS[a] || a.charAt(0).toUpperCase() + a.slice(1).replace(/-/g, ' ');

const sizeOf = (f) => {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
};
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`);
const fmtDay = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });

// ----- The built-in checks. Each module can add its own: monitor.check(id, fn). -----
export function registerBuiltInChecks(monitor) {
  monitor.check('version', ({ build }) => ({ area: 'software', label: `CORE ${APP_VERSION}`, state: 'ok', detail: [build.channel, build.commit && `build ${build.commit.slice(0, 7)}`, build.installedAt && `installed ${build.installedAt.slice(0, 10)}`].filter(Boolean).join(' · '), href: '/admin/devlog' }));
  monitor.check('node', ({ now }) => {
    const major = Number(process.versions.node.split('.')[0]);
    const eol = NODE_END_OF_LIFE[major];
    const base = { area: 'software', label: `Node.js ${process.versions.node}` };
    if (!eol) return { ...base, state: 'warn', detail: major % 2 ? 'Not a long-term support release: use an even-numbered version (22 or 24).' : 'A version CORE does not know the support dates of yet.' };
    const left = Math.round((Date.parse(`${eol}T00:00:00Z`) - now) / DAY);
    if (left < 0) return { ...base, state: 'bad', detail: `Security fixes for Node.js ${major} ended on ${fmtDay(eol)}. Move to a supported version.` };
    if (left <= 180) return { ...base, state: 'warn', detail: `Security fixes end on ${fmtDay(eol)}, in ${left} days. Plan the move to Node.js ${major + 2}.` };
    return { ...base, state: 'ok', detail: `Supported with security fixes until ${fmtDay(eol)}.` };
  });
  monitor.check('dependencies', () => {
    let deps = null;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      deps = Object.keys(pkg.dependencies || {});
    } catch {
      return null; // the packaged app has no package.json beside it
    }
    return deps.length
      ? { area: 'software', label: 'Third-party packages', state: 'warn', detail: `${deps.length} package${deps.length === 1 ? '' : 's'} to keep patched: ${deps.join(', ')}.` }
      : { area: 'software', label: 'Third-party packages', state: 'ok', detail: 'None: CORE uses only Node.js itself, so there is nothing else to patch.' };
  });
  monitor.check('errors', ({ monitor: m, now }) => {
    const b = m.merge(m.series('1h', now).buckets);
    const rate = pct(b.s[5], b.api);
    const base = { area: 'software', label: 'Server errors, last hour', href: '/admin/monitor?tab=traffic' };
    if (b.api < 20) return { ...base, state: b.s[5] ? 'warn' : 'ok', detail: b.s[5] ? `${b.s[5]} of ${b.api} requests failed with a server error. Check the server's log.` : 'None.' };
    return { ...base, state: rate >= 5 ? 'bad' : rate >= 1 ? 'warn' : 'ok', detail: `${rate}% of ${b.api.toLocaleString('en-PH')} requests (${b.s[5]}).${rate >= 1 ? " Check the server's log." : ''}` };
  });
  monitor.check('memory', ({ sample }) => {
    const used = pct(sample.heap, sample.heapLimit);
    return { area: 'software', label: 'Memory', state: used >= 90 ? 'bad' : used >= 70 ? 'warn' : 'ok', detail: `${fmtBytes(sample.rss)} in use; ${used}% of the space for data.` };
  });
  monitor.check('event-loop', ({ sample }) => ({ area: 'software', label: 'Responsiveness (event loop)', state: sample.lag >= 500 ? 'bad' : sample.lag >= 100 ? 'warn' : 'ok', detail: `Slowest 1% of the last minute waited ${sample.lag} ms before running.` }));
  monitor.check('disk', ({ db }) => {
    const d = diskOf(db.dir);
    if (!d) return null;
    const free = pct(d.free, d.total);
    return { area: 'software', label: 'Disk space', state: free < 5 || d.free < 500e6 ? 'bad' : free < 15 || d.free < 2e9 ? 'warn' : 'ok', detail: `${fmtBytes(d.free)} free of ${fmtBytes(d.total)} (${free}%).` };
  });

  monitor.check('audit-chain', ({ audit }) => {
    const c = audit.verify();
    return { area: 'data', label: 'Audit log check', state: c.ok ? 'ok' : 'bad', detail: c.ok ? `Intact: ${c.count.toLocaleString('en-PH')} entries, none changed or missing.` : c.keyMissing ? 'The key that seals the log cannot be read.' : c.missingFrom ? `Entries missing from ${c.missingFrom}.` : `Altered at entry ${c.brokenAt}.`, href: '/admin/audit' };
  });
  monitor.check('backup', ({ db, now }) => {
    const at = db.data.adminState?.lastBackupAt;
    const days = at ? Math.floor((now - Date.parse(at)) / DAY) : null;
    const base = { area: 'data', label: 'Backup', href: '/admin/data' };
    if (days === null) return { ...base, state: 'warn', detail: 'No backup has been downloaded from this server. A server set up with deploy/aws keeps its own nightly copy.' };
    return { ...base, state: days > 30 ? 'bad' : days > 7 ? 'warn' : 'ok', detail: `Last downloaded ${days ? `${days} day${days === 1 ? '' : 's'} ago` : 'today'}${db.data.adminState.lastBackupBy ? `, by ${db.data.adminState.lastBackupBy}` : ''}.` };
  });
  monitor.check('file-permissions', ({ db }) => {
    if (process.platform === 'win32') return null;
    const open = [db.file, path.join(db.dir, 'audit-log.jsonl'), path.join(db.dir, 'secret.key'), path.join(db.dir, 'monitor.json')].filter((f) => {
      try {
        return (fs.statSync(f).mode & 0o077) !== 0;
      } catch {
        return false;
      }
    });
    return { area: 'data', label: 'Data file permissions', state: open.length ? 'bad' : 'ok', detail: open.length ? `Readable by other accounts on the server: ${open.map((f) => path.basename(f)).join(', ')}. CORE fixes this at its next start.` : 'Only CORE can read the data, the audit log and the keys.' };
  });
  monitor.check('demo', ({ db }) => (hasDemo(db) ? { area: 'data', label: 'Demo data', state: 'warn', detail: 'Demo people and records are loaded. Remove them before the company uses CORE.', href: '/admin/demo' } : null));

  monitor.check('https', ({ monitor: m, now }) => {
    const b = m.merge(m.series('24h', now).buckets);
    const base = { area: 'access', label: 'Encrypted connections (HTTPS)', href: '' };
    if (!b.n) return { ...base, state: 'info', detail: 'No requests in the last 24 hours.' };
    if (b.plainNet) return { ...base, state: 'bad', detail: `${b.plainNet.toLocaleString('en-PH')} requests in the last 24 hours came over plain HTTP from the network: passwords and sign-in cookies can be read on the way. Use the HTTPS set-up (deploy/aws/EC2.md).` };
    if (!b.https) return { ...base, state: 'info', detail: 'Used only on this computer, so nothing travels over the network.' };
    return { ...base, state: 'ok', detail: `${pct(b.https, b.n)}% of requests over HTTPS; the rest from this computer.` };
  });
  monitor.check('rate-limits', ({ rateLimits, sec }) => ({ area: 'access', label: 'Rate limits', state: rateLimits ? 'ok' : 'bad', detail: rateLimits ? `On: ${sec.requestsPerMinute} requests a minute per person; ${sec.signInFailuresPerAddress} failed sign-ins per address in 15 minutes.` : 'Off (RATE_LIMITS=off): only for scripted test runs, never on a live server.', href: '/admin/security' }));
  monitor.check('two-factor', ({ db, sec }) => {
    const active = db.data.users.filter((u) => u.active);
    const admins = active.filter((u) => u.role === 'admin');
    const adminsOff = admins.filter((u) => !u.twoFactor?.enabledAt).length;
    const policy = { area: 'access', label: '2-step verification policy', href: '/admin/security', state: sec.twoFactor === 'off' ? 'warn' : 'ok', detail: `${TWO_FACTOR_POLICIES[sec.twoFactor]}. ${active.filter((u) => u.twoFactor?.enabledAt).length} of ${active.length} active accounts use it.` };
    const adm = { id: 'two-factor-admins', area: 'access', label: 'Administrators with 2-step verification', href: '/admin/users', state: adminsOff ? 'warn' : 'ok', detail: adminsOff ? `${adminsOff} of ${admins.length} administrators sign in with a password alone. Require it under Sign-in & security.` : `All ${admins.length}.` };
    return [policy, adm];
  });
  monitor.check('admins', ({ db }) => {
    const n = db.data.users.filter((u) => u.active && u.role === 'admin').length;
    return { area: 'access', label: 'Administrators', state: n > 5 ? 'warn' : 'ok', detail: n > 5 ? `${n} active administrators. Keep full access to a few people; give others only the Admin panel pages they need.` : `${n} active.`, href: '/admin/users' };
  });
  monitor.check('temp-passwords', ({ db }) => {
    const n = db.data.users.filter((u) => u.active && u.mustChangePassword).length;
    return { area: 'access', label: 'Temporary passwords', state: n ? 'warn' : 'ok', detail: n ? `${n} account${n === 1 ? '' : 's'} still on the password an administrator gave.` : 'None waiting to be changed.', href: '/admin/users' };
  });
  monitor.check('unused-accounts', ({ db, now }) => {
    const stale = db.data.users.filter((u) => u.active && now - Date.parse(u.lastLoginAt || u.createdAt || 0) > 90 * DAY);
    return { area: 'access', label: 'Unused accounts', state: stale.length ? 'warn' : 'ok', detail: stale.length ? `${stale.length} active account${stale.length === 1 ? ' has' : 's have'} not signed in for 90 days: ${stale.slice(0, 5).map((u) => u.username).join(', ')}${stale.length > 5 ? '…' : ''}. Disable the ones no longer needed.` : 'Every active account signed in within 90 days.', href: '/admin/users' };
  });
  monitor.check('passwords', ({ sec }) => ({ area: 'access', label: 'Common passwords', state: sec.blockCommonPasswords ? 'ok' : 'warn', detail: sec.blockCommonPasswords ? 'Refused when a password is set.' : 'Allowed. Turn the check on under Sign-in & security.', href: '/admin/security' }));
}

// The controls in force on the API, as configured now.
function controls({ sec, rateLimits, monitorBucket: b }) {
  const https = b.https > 0 && !b.plainNet;
  return [
    { label: 'Requests from other sites refused (CSRF)', state: 'ok', detail: `Every change must come from CORE's own pages. ${b.sig['cross-site'] || 0} refused in this period.` },
    { label: 'Host name check (DNS rebinding)', state: 'ok', detail: `Only localhost, an IP address${process.env.ALLOWED_HOSTS ? ` or ${process.env.ALLOWED_HOSTS.split(',').join(', ')}` : ''}.` },
    { label: 'JSON only', state: 'ok', detail: 'Changes must be sent as application/json; forms from other sites cannot post.' },
    { label: 'Request size limits', state: 'ok', detail: '1 MB before signing in; 12 MB signed in; 50 MB for a backup or settings file.' },
    { label: 'Rate limits', state: rateLimits ? 'ok' : 'bad', detail: rateLimits ? `${sec.requestsPerMinute} a minute per person, 120 per address signed out, 20 sign-in attempts a minute per address.` : 'Off on this server.' },
    { label: 'Sign-in lockout', state: 'ok', detail: `A username locks after 5 failures (15, then 60 minutes); an address stops after ${sec.signInFailuresPerAddress} failures in 15 minutes.` },
    { label: 'Sessions', state: 'ok', detail: `Cookie readable by no script, sent by no other site${https ? ', HTTPS only' : ''}; ends after ${sec.sessionIdleMinutes} idle minutes or ${sec.sessionMaxHours} hours.` },
    { label: '2-step verification', state: sec.twoFactor === 'off' ? 'warn' : 'ok', detail: TWO_FACTOR_POLICIES[sec.twoFactor] + '.' },
    { label: 'Content Security Policy and security headers', state: 'ok', detail: "Scripts only from CORE; no framing, no MIME sniffing; data answers can't run as pages." },
    { label: 'Strict Transport Security (HSTS)', state: https ? 'ok' : 'info', detail: https ? 'Browsers stay on HTTPS for a year.' : 'Sent only over HTTPS.' },
  ];
}

// The route inventory (OWASP API9): every API address CORE answers, by who may call it.
function inventory(routes) {
  const api = routes.filter((r) => r.pattern.startsWith('/api/'));
  const byArea = {};
  for (const r of api) {
    const mod = moduleOfApi(r.method, r.pattern.replace(/:\w+/g, 'x'));
    const area = mod ? moduleName(mod) : r.pattern.startsWith('/api/admin') ? 'Admin panel' : r.pattern.startsWith('/api/me') ? 'Self-service' : 'Core (sign-in, users, settings)';
    byArea[area] = (byArea[area] || 0) + 1;
  }
  return {
    total: api.length,
    public: api.filter((r) => r.permission === 'public').map((r) => `${r.method} ${r.pattern}`),
    signedIn: api.filter((r) => r.permission === 'auth').length,
    permission: api.filter((r) => !['public', 'auth'].includes(r.permission)).length,
    byArea: Object.entries(byArea).map(([area, n]) => ({ area, n })).sort((a, b) => b.n - a.n),
  };
}

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

// The page's data for one range.
export function monitorView({ db, monitor, audit, sec, rateLimits, routes, sessions, user, now = Date.now(), range = '24h' }) {
  if (!RANGES.includes(range)) range = '24h';
  const sample = monitor.lastSample(); // first, so a new server's first minute has its sample
  const { tier, buckets } = monitor.series(range, now);
  const m = monitor.merge(buckets);
  const build = { node: process.version, ...buildInfo() };
  const byId = new Map(db.data.users.map((u) => [u.id, u]));
  const nameOf = (id) => byId.get(id)?.name || 'Removed account';
  const signals = monitor.signals();
  const apiSignals = signals.filter((s) => s.group === 'api');
  const authSignals = signals.filter((s) => s.group === 'auth');
  const refusalsOf = (b) => apiSignals.reduce((a, s) => a + (b.sig[s.name] || 0), 0);

  // Software status
  const checks = monitor.runChecks({ db, monitor, audit, sec, rateLimits, build, sample, now });
  const disk = diskOf(db.dir);

  // Addresses to watch: many refusals, or any lock, in the period (the week at most).
  const addr = monitor.merge(monitor.addressBuckets(range, now)).ips;
  const watch = Object.entries(addr)
    .map(([ip, a]) => {
      const refused = apiSignals.reduce((x, s) => x + (a.s[s.name] || 0), 0);
      const failed = authSignals.reduce((x, s) => x + (a.s[s.name] || 0), 0);
      const top = Object.entries(a.s).sort((x, y) => y[1] - x[1])[0];
      return { ip, requests: a.n, refused, failed, locked: a.s.locked || 0, top: top ? signals.find((s) => s.name === top[0])?.label || top[0] : '', lastAt: a.last ? new Date(a.last).toISOString() : null };
    })
    .filter((a) => a.ip !== OTHERS && (a.refused >= 20 || a.failed >= 5 || a.locked > 0 || a.refused + a.failed >= 10))
    .sort((x, y) => y.refused + y.failed - (x.refused + x.failed))
    .slice(0, 15);

  // Routes
  const routeRows = Object.entries(m.routes).map(([key, r]) => ({ route: key, n: r.n, errors: r.e, p95: percentile(r.lat, 95) }));
  const topRoutes = [...routeRows].sort((a, b) => b.n - a.n).slice(0, 10);
  const slowRoutes = routeRows.filter((r) => r.n >= 5).sort((a, b) => b.p95 - a.p95).slice(0, 5);

  // People
  const open = sessions();
  const daysBack = (n) => monitor.merge(monitor.series('30d', now).buckets.slice(-n)).users;
  const active24 = Object.keys(monitor.merge(monitor.series('24h', now).buckets).users).length;
  const topPeople = [...new Set([...Object.keys(m.users), ...Object.keys(m.actors)])]
    .map((id) => ({ id, name: nameOf(id), role: ROLES[byId.get(id)?.role]?.label || '', requests: m.users[id] || 0, actions: m.actors[id] || 0 }))
    .sort((a, b) => b.actions - a.actions || b.requests - a.requests)
    .slice(0, 10);
  const signInLog = audit.list({ area: 'auth', limit: 300 }).entries.filter((e) => ['auth.login', 'auth.login-failed', 'auth.locked'].includes(e.action)).slice(0, 15)
    .map((e) => ({ at: e.at, name: e.action === 'auth.login' ? e.userName : e.label, userId: e.action === 'auth.login' ? e.userId : null, ip: e.ip, outcome: e.action === 'auth.login' ? 'signed-in' : e.action === 'auth.locked' ? 'locked' : 'failed', note: e.note }));

  return {
    generatedAt: new Date(now).toISOString(),
    range, tier,
    bounds: DURATION_BOUNDS_MS,
    status: {
      version: APP_VERSION, build,
      startedAt: new Date(monitor.startedAt).toISOString(),
      host: hostInfo(),
      process: { rss: sample.rss, heap: sample.heap, heapLimit: sample.heapLimit, cpu: sample.cpu, lag: sample.lag, heapUsedOfLimit: pct(sample.heap, sample.heapLimit), v8HeapTotal: v8.getHeapStatistics().total_heap_size },
      disk,
      files: { db: sizeOf(db.file), audit: sizeOf(audit.file), monitor: sizeOf(monitor.file) },
      checks,
      summary: { ok: checks.filter((c) => c.state === 'ok').length, warn: checks.filter((c) => c.state === 'warn').length, bad: checks.filter((c) => c.state === 'bad').length },
    },
    api: {
      inventory: inventory(routes),
      controls: controls({ sec, rateLimits, monitorBucket: m }),
      refusals: apiSignals.map((s) => ({ ...s, count: m.sig[s.name] || 0 })),
      signIn: authSignals.map((s) => ({ ...s, count: m.sig[s.name] || 0 })),
      watch,
      addressesKept: range === '30d' ? '7d' : range,
      metrics: userCan(user, 'users.manage') ? { token: monitor.token() ? { createdAt: monitor.token().createdAt, createdBy: monitor.token().createdBy } : null } : undefined,
    },
    traffic: {
      totals: { requests: m.n, api: m.api, pages: m.pages, files: m.files, status: m.s, out: m.out, https: m.https, plainNet: m.plainNet, refused: refusalsOf(m) },
      latency: { p50: percentile(m.lat, 50), p95: percentile(m.lat, 95), p99: percentile(m.lat, 99) },
      topRoutes, slowRoutes,
    },
    activity: {
      now: { sessions: open.length, people: new Set(open.map((s) => s.userId)).size },
      live: open.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 50).map((s) => ({ userId: s.userId, name: nameOf(s.userId), role: ROLES[byId.get(s.userId)?.role]?.label || '', device: s.device, ip: s.ip, signedInAt: new Date(s.created).toISOString(), lastSeenAt: new Date(s.lastSeen).toISOString() })),
      active: { d1: active24, d7: Object.keys(daysBack(7)).length, d30: Object.keys(daysBack(30)).length },
      signIns: m.signIns, actions: sum(m.act),
      byArea: Object.entries(m.act).map(([area, n]) => ({ area, label: areaLabel(area), n })).sort((a, b) => b.n - a.n),
      topPeople, signInLog,
    },
    series: buckets.map((b) => ({
      t: b.t, n: b.n, api: b.api, pages: b.pages, e4: b.s[4], e5: b.s[5], p95: percentile(b.lat, 95),
      refused: refusalsOf(b), failed: authSignals.reduce((a, s) => a + (b.sig[s.name] || 0), 0),
      signIns: b.signIns, actions: sum(b.act), people: Object.keys(b.users).length,
      rss: b.sys?.rss ?? null, lag: b.sys?.lag ?? null, cpu: b.sys?.cpu ?? null,
    })),
  };
}

// ----- The metrics export (Prometheus text format, OpenTelemetry names) -----
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
export function prometheusText({ monitor, db, audit, sessions, checks }) {
  const lines = [];
  const metric = (name, type, help, rows) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of rows) lines.push(`${name}${labels ? `{${Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}` : ''} ${value}`);
  };
  const s = monitor.lastSample();
  metric('core_build_info', 'gauge', 'The CORE version and Node.js version running.', [[{ version: APP_VERSION, nodejs: process.versions.node }, 1]]);
  metric('process_start_time_seconds', 'gauge', 'When this process started, in seconds since 1970.', [[null, Math.round(monitor.startedAt / 1000)]]);
  metric('process_resident_memory_bytes', 'gauge', 'Resident memory.', [[null, s.rss]]);
  metric('nodejs_heap_size_used_bytes', 'gauge', 'Heap in use.', [[null, s.heap]]);
  metric('nodejs_eventloop_lag_p99_seconds', 'gauge', 'Event loop delay, 99th percentile of the last minute.', [[null, s.lag / 1000]]);
  const http = [...monitor.totals.http].map(([k, n]) => {
    const [method, route, status] = k.split('|');
    return [{ http_request_method: method, http_route: route, http_response_status_code: status }, n];
  });
  metric('http_server_requests_total', 'counter', 'Requests answered, by route template and status.', http);
  lines.push('# HELP http_server_request_duration_seconds API request duration.', '# TYPE http_server_request_duration_seconds histogram');
  for (const [k, h] of monitor.totals.hist) {
    const [method, route] = k.split('|');
    const base = `http_request_method="${esc(method)}",http_route="${esc(route)}"`;
    let cum = 0;
    DURATION_BOUNDS_MS.forEach((b, i) => {
      cum += h.lat[i];
      lines.push(`http_server_request_duration_seconds_bucket{${base},le="${b / 1000}"} ${cum}`);
    });
    lines.push(`http_server_request_duration_seconds_bucket{${base},le="+Inf"} ${h.n}`, `http_server_request_duration_seconds_sum{${base}} ${Math.round(h.sum) / 1000}`, `http_server_request_duration_seconds_count{${base}} ${h.n}`);
  }
  metric('core_security_events_total', 'counter', 'Refusals and sign-in events, by kind.', monitor.signals().map((x) => [{ signal: x.name, owasp: x.owasp }, monitor.totals.signals[x.name] || 0]));
  metric('core_audit_entries_total', 'counter', 'Audit log entries written since start.', [[null, monitor.totals.actions]]);
  metric('core_sign_ins_total', 'counter', 'Successful sign-ins since start.', [[null, monitor.totals.signIns]]);
  const open = sessions();
  metric('core_sessions_open', 'gauge', 'Sessions open now.', [[null, open.length]]);
  metric('core_people_signed_in', 'gauge', 'People signed in now.', [[null, new Set(open.map((x) => x.userId)).size]]);
  metric('core_users_active', 'gauge', 'Active accounts.', [[null, db.data.users.filter((u) => u.active).length]]);
  metric('core_audit_chain_intact', 'gauge', '1 when the audit log check passes.', [[null, audit.verify().ok ? 1 : 0]]);
  const level = { ok: 0, info: 0, warn: 1, bad: 2 };
  metric('core_check_status', 'gauge', 'Each status check: 0 fine, 1 needs attention, 2 a problem.', checks.map((c) => [{ check: c.id, area: c.area }, level[c.state] ?? 0]));
  return `${lines.join('\n')}\n`;
}

// ----- The scrape token: shown once, only its hash kept -----
const hashToken = (t) => createHash('sha256').update(String(t)).digest();
export function newToken(user) {
  const token = `core_mt_${randomBytes(32).toString('base64url')}`;
  return { token, saved: { hash: hashToken(token).toString('hex'), createdAt: new Date().toISOString(), createdBy: user.name } };
}
export function tokenMatches(saved, header) {
  const given = String(header || '').match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!saved?.hash || !given) return false;
  const a = hashToken(given);
  const b = Buffer.from(saved.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// The routes: the page's data, the health check, the metrics export and its token.
export function registerMonitorRoutes(route, { db, monitor, audit: auditLog, sec, rateLimits, routes, sessions }) {
  registerBuiltInChecks(monitor);
  // The chain check reads the whole log: a page refreshing every minute and a metrics server
  // collecting every 15 seconds reuse the last result while no entry was added, for up to a minute.
  let last = null;
  const audit = {
    ...auditLog,
    verify() {
      const now = Date.now();
      if (!last || last.count !== auditLog.count() || now - last.at > 60000) last = { at: now, count: auditLog.count(), result: auditLog.verify() };
      return last.result;
    },
  };
  const ctx = () => ({ db, monitor, audit, sec: sec(), rateLimits, build: { node: process.version, ...buildInfo() }, sample: monitor.lastSample(), now: Date.now() });
  route('GET', '/api/admin/monitor', 'security.monitor', ({ user, query }) => monitorView({ db, monitor, audit, sec: sec(), rateLimits, routes, sessions, user, range: query.range }));
  // For uptime checkers and load balancers: nothing about the server but that it answers.
  route('GET', '/api/public/health', 'public', () => ({ status: 'ok' }));
  route('GET', '/api/admin/monitor/metrics', 'public', ({ headers }) => {
    const saved = monitor.token();
    if (!saved) throw new HttpError(404, 'Not found.');
    if (!tokenMatches(saved, headers?.authorization)) throw new HttpError(401, 'A valid metrics token is needed.');
    const text = prometheusText({ monitor, db, audit, sessions, checks: monitor.runChecks(ctx()) });
    return { data: Buffer.from(text), headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' } };
  });
  route('POST', '/api/admin/monitor/token', 'users.manage', ({ user }) => {
    const { token, saved } = newToken(user);
    const replaced = Boolean(monitor.token());
    monitor.setToken(saved);
    audit.record('monitor.token', { entity: 'settings', label: 'Metrics export token', note: replaced ? 'Replaced; the old token stopped working' : 'Created' });
    return { token, createdAt: saved.createdAt, createdBy: saved.createdBy };
  });
  route('DELETE', '/api/admin/monitor/token', 'users.manage', () => {
    if (!monitor.token()) throw new HttpError(404, 'There is no metrics token.');
    monitor.setToken(null);
    audit.record('monitor.token', { entity: 'settings', label: 'Metrics export token', note: 'Revoked' });
    return { ok: true };
  });
}
