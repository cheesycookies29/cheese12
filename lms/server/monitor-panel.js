// System → Security monitor, after CORE ERP's (server/monitor-panel.js at the repository root): the
// software's status (checks), the API's security (the route inventory, the controls in force,
// refusals and the addresses behind them), the traffic and what people do. Administrators only,
// like the rest of System. The data comes from server/monitor.js; design notes: docs/security-monitor.md
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError } from './util.js';
import { roleLabel } from '../shared/roles.js';
import { passwordEncryption, passwordCost } from './auth.js';
import { TWO_FACTOR_POLICIES } from '../shared/two-factor.js';
import { demoStatus } from './demo.js';
import { systemOf, SYSTEM_LABELS } from './audit.js';
import { DURATION_BOUNDS_MS, percentile, diskOf, hostInfo, OTHERS } from './monitor.js';

const DAY = 86400000;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const RANGES = ['1h', '24h', '7d', '30d'];

// When each Node.js release line stops getting security fixes (nodejs.org/en/about/previous-releases).
// Odd-numbered lines are short-lived and never long-term support.
export const NODE_END_OF_LIFE = { 18: '2025-04-30', 20: '2026-04-30', 22: '2027-04-30', 24: '2028-04-30', 26: '2029-04-30' };

// Where each check's fix is: System pages are in every app's sidebar; settings are in the Admin panel.
const LINK = {
  signIn: '/admin#/sign-in', data: '/admin#/data', sso: '/admin#/sso', cloudflare: '/admin#/cloudflare',
  users: '#/system/users', audit: '#/system/audit', traffic: '#/system/monitor?tab=traffic',
};

const sizeOf = (f) => {
  try {
    return f ? fs.statSync(f).size : 0;
  } catch {
    return 0;
  }
};
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`);
const fmtDay = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-PH')} ${n === 1 ? one : many}`;
const active = (db) => db.data.users.filter((u) => u.status === 'active');

// The newest nightly copy the AWS set-up makes (deploy/aws/ltdc-lms-backup.cron), if this server has one.
function newestNightlyCopy(dir) {
  try {
    const folder = path.join(dir, 'backups');
    const files = fs.readdirSync(folder).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f));
    return files.length ? Math.max(...files.map((f) => fs.statSync(path.join(folder, f)).mtimeMs)) : null;
  } catch {
    return null;
  }
}

// ----- The built-in checks. Each system can add its own: monitor.check(id, fn). -----
export function registerBuiltInChecks(monitor) {
  monitor.check('version', ({ version }) => ({ area: 'software', label: `ATLAS ${version || ''}`.trim(), state: 'ok', detail: `Running on Node.js ${process.versions.node}.` }));
  monitor.check('node', ({ now }) => {
    const major = Number(process.versions.node.split('.')[0]);
    const eol = NODE_END_OF_LIFE[major];
    const base = { area: 'software', label: `Node.js ${process.versions.node}` };
    if (!eol) return { ...base, state: 'warn', detail: major % 2 ? 'Not a long-term support release: use an even-numbered version (22 or 24).' : 'A version ATLAS does not know the support dates of yet.' };
    const left = Math.round((Date.parse(`${eol}T00:00:00Z`) - now) / DAY);
    if (left < 0) return { ...base, state: 'bad', detail: `Security fixes for Node.js ${major} ended on ${fmtDay(eol)}. Move to a supported version (on the AWS server: deploy/aws/upgrade-server.sh).` };
    if (left <= 180) return { ...base, state: 'warn', detail: `Security fixes end on ${fmtDay(eol)}, in ${left} days. Plan the move to Node.js ${major + 2}.` };
    return { ...base, state: 'ok', detail: `Supported with security fixes until ${fmtDay(eol)}.` };
  });
  monitor.check('dependencies', () => {
    let deps = null;
    try {
      deps = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies || {});
    } catch {
      return null;
    }
    return deps.length
      ? { area: 'software', label: 'Third-party packages', state: 'warn', detail: `${plural(deps.length, 'package')} to keep patched: ${deps.join(', ')}.` }
      : { area: 'software', label: 'Third-party packages', state: 'ok', detail: 'None: ATLAS uses only Node.js itself, so there is nothing else to patch.' };
  });
  monitor.check('errors', ({ monitor: m, now }) => {
    const b = m.merge(m.series('1h', now).buckets);
    const rate = pct(b.s[5], b.api);
    const base = { area: 'software', label: 'Server errors, last hour', href: LINK.traffic };
    if (b.api < 20) return { ...base, state: b.s[5] ? 'warn' : 'ok', detail: b.s[5] ? `${b.s[5]} of ${b.api} requests failed with a server error. Check the server's log.` : 'None.' };
    return { ...base, state: rate >= 5 ? 'bad' : rate >= 1 ? 'warn' : 'ok', detail: `${rate}% of ${b.api.toLocaleString('en-PH')} requests (${b.s[5]}).${rate >= 1 ? " Check the server's log." : ''}` };
  });
  monitor.check('memory', ({ sample }) => {
    const used = pct(sample.heap, sample.heapLimit);
    return { area: 'software', label: 'Memory', state: used >= 90 ? 'bad' : used >= 70 ? 'warn' : 'ok', detail: `${fmtBytes(sample.rss)} in use; ${used}% of the space for data.` };
  });
  monitor.check('event-loop', ({ sample }) => ({ area: 'software', label: 'Responsiveness (event loop)', state: sample.lag >= 500 ? 'bad' : sample.lag >= 100 ? 'warn' : 'ok', detail: `The slowest 1% of the last minute waited ${sample.lag} ms before running.` }));
  monitor.check('disk', ({ db }) => {
    const d = db.dir && diskOf(db.dir);
    if (!d) return null;
    const free = pct(d.free, d.total);
    return { area: 'software', label: 'Disk space', state: free < 5 || d.free < 500e6 ? 'bad' : free < 15 || d.free < 2e9 ? 'warn' : 'ok', detail: `${fmtBytes(d.free)} free of ${fmtBytes(d.total)} (${free}%).` };
  });

  monitor.check('audit-chain', ({ audit }) => {
    const c = audit.verify();
    return { area: 'data', label: 'Audit log check', state: c.ok ? 'ok' : 'bad', detail: c.ok ? `Intact: ${c.count.toLocaleString('en-PH')} entries, none changed, removed or reordered.` : `Altered at entry ${c.brokenAt}: the file was edited outside ATLAS. Keep a copy of audit-log.jsonl and investigate.`, href: LINK.audit };
  });
  monitor.check('backup', ({ db, monitor: m, now }) => {
    if (!db.dir) return null;
    const nightly = newestNightlyCopy(db.dir);
    const downloaded = m.backup();
    const last = Math.max(nightly || 0, downloaded ? Date.parse(downloaded.at) : 0) || null;
    const base = { area: 'data', label: 'Backup', href: LINK.data };
    if (!last) return { ...base, state: 'warn', detail: 'No backup downloaded from this server, and no nightly copy beside the data. A server set up with deploy/aws makes one each night.' };
    const days = Math.floor((now - last) / DAY);
    const how = nightly && nightly >= (downloaded ? Date.parse(downloaded.at) : 0) ? 'Nightly copy' : `Downloaded${downloaded?.by ? ` by ${downloaded.by}` : ''}`;
    return { ...base, state: days > 30 ? 'bad' : days > 7 ? 'warn' : 'ok', detail: `${how}, ${days ? `${plural(days, 'day')} ago` : 'today'}.` };
  });
  monitor.check('file-permissions', ({ db, monitor: m, audit }) => {
    if (process.platform === 'win32' || !db.dir) return null;
    const open = [db.file, audit.file, m.file, path.join(db.dir, 'password.key')].filter((f) => {
      try {
        return f && (fs.statSync(f).mode & 0o007) !== 0;
      } catch {
        return false;
      }
    });
    return { area: 'data', label: 'Data file permissions', state: open.length ? 'bad' : 'ok', detail: open.length ? `Readable by every account on the server: ${open.map((f) => path.basename(f)).join(', ')}. ATLAS saves the data file privately from its next change; for the others run chmod o-rwx on them.` : 'Other accounts on the server cannot read the data, the audit log or the keys.' };
  });
  monitor.check('password-key', ({ db }) => {
    const enc = passwordEncryption();
    return { area: 'data', label: 'Password key', state: enc.on ? 'ok' : 'warn', detail: enc.on ? `Password hashes are encrypted with a key kept outside the data (${db.dir ? 'password.key or PASSWORD_KEY' : 'PASSWORD_KEY'}).` : 'Password hashes are stored without the extra encryption. Set PASSWORD_KEY, or let ATLAS make password.key at its next start.' };
  });
  monitor.check('demo', ({ db }) => (demoStatus(db.data).loaded ? { area: 'data', label: 'Demo data', state: 'warn', detail: 'The demo school\'s people and records are loaded. Remove them before the school uses ATLAS.', href: LINK.data } : null));

  monitor.check('https', ({ monitor: m, now }) => {
    const b = m.merge(m.series('24h', now).buckets);
    const base = { area: 'access', label: 'Encrypted connections (HTTPS)' };
    if (!b.n) return { ...base, state: 'info', detail: 'No requests in the last 24 hours.' };
    if (b.plainNet) return { ...base, state: 'bad', detail: `${b.plainNet.toLocaleString('en-PH')} requests in the last 24 hours came over plain HTTP from the network: passwords and sign-in cookies can be read on the way. Use the HTTPS set-up (deploy/aws/EC2.md) or Cloudflare.`, href: LINK.cloudflare };
    if (!b.https) return { ...base, state: 'info', detail: 'Used only on this computer, so nothing travels over the network.' };
    return { ...base, state: 'ok', detail: `${pct(b.https, b.n)}% of requests over HTTPS; the rest from this computer.` };
  });
  monitor.check('rate-limits', ({ rateLimits, sec }) => ({ area: 'access', label: 'Rate limits', state: rateLimits ? 'ok' : 'bad', detail: rateLimits ? `On: ${sec.requestsPerMinute} requests a minute per person; ${sec.signInFailuresPerAddress} wrong passwords per address in 15 minutes.` : 'Off (RATE_LIMITS=off): only for scripted test runs, never on a live server.', href: LINK.signIn }));
  monitor.check('admins', ({ db }) => {
    const n = active(db).filter((u) => u.role === 'admin').length;
    return { area: 'access', label: 'Administrators', state: n > 5 ? 'warn' : 'ok', detail: n > 5 ? `${n} active administrators. Keep full access to a few people; give others a registrar account or only the access they need.` : `${n} active.`, href: LINK.users };
  });
  monitor.check('temp-passwords', ({ db }) => {
    const n = active(db).filter((u) => u.mustChangePassword).length;
    return { area: 'access', label: 'Temporary passwords', state: n ? 'warn' : 'ok', detail: n ? `${plural(n, 'account')} still on the password the school gave.` : 'None waiting to be changed.', href: LINK.users };
  });
  monitor.check('unused-accounts', ({ db, now }) => {
    const stale = active(db).filter((u) => !u.demo && now - Date.parse(u.lastLoginAt || u.createdAt || 0) > 90 * DAY && ['admin', 'registrar', 'hr', 'staff', 'teacher'].includes(u.role));
    return { area: 'access', label: 'Unused staff accounts', state: stale.length ? 'warn' : 'ok', detail: stale.length ? `${plural(stale.length, 'active staff account has', 'active staff accounts have')} not signed in for 90 days: ${stale.slice(0, 5).map((u) => u.username).join(', ')}${stale.length > 5 ? '…' : ''}. Disable the ones no longer needed.` : 'Every active staff account signed in within 90 days.', href: LINK.users };
  });
  // 2-step verification (server/two-factor.js): administrators without it, while nobody must use it.
  monitor.check('two-factor', ({ db, sec }) => {
    const policy = sec.twoFactor || 'off';
    const base = { area: 'access', label: '2-step verification', href: LINK.signIn };
    if (policy !== 'off') return { ...base, state: 'ok', detail: `${TWO_FACTOR_POLICIES[policy]}.` };
    const without = active(db).filter((u) => u.role === 'admin' && !u.twoFactor?.enabledAt);
    if (!without.length) return { ...base, state: 'ok', detail: 'Optional; every active administrator uses it.' };
    return { ...base, state: 'warn', detail: `Optional, and ${plural(without.length, 'administrator does', 'administrators do')} not use it: ${without.slice(0, 5).map((u) => u.username).join(', ')}${without.length > 5 ? '…' : ''}. A stolen administrator password opens everything; ask them to set it up under My security, or require it.` };
  });
  monitor.check('password-rules', ({ sec }) => {
    const weak = sec.minPasswordLength < 10 && !sec.requireLettersAndDigits;
    return { area: 'access', label: 'Password rules', state: weak ? 'warn' : 'ok', detail: `At least ${sec.minPasswordLength} characters${sec.requireLettersAndDigits ? ', with letters and digits' : ''}. ${weak ? 'Ask for 10 or more, or letters and digits.' : ''}`.trim(), href: LINK.signIn };
  });
  monitor.check('sso', ({ db }) => {
    const s = db.data.settings.sso || {};
    if (!s.enabled) return { area: 'access', label: 'Single sign-on (Keycloak)', state: 'info', detail: 'Off: everyone signs in with an ATLAS password.', href: LINK.sso };
    return { area: 'access', label: 'Single sign-on (Keycloak)', state: process.env.OIDC_CLIENT_SECRET ? 'ok' : 'bad', detail: process.env.OIDC_CLIENT_SECRET ? `On${s.allowPasswords ? '; ATLAS passwords also work' : '; only administrators keep a password'}.` : 'On, but the client secret (OIDC_CLIENT_SECRET) is not set on the server.', href: LINK.sso };
  });
}

// The controls in force on the API, as configured now.
function controls({ sec, rateLimits, bucket: b, db }) {
  const https = b.https > 0 && !b.plainNet;
  const allowed = String(process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
  const enc = passwordEncryption();
  return [
    { label: 'Requests from other websites refused (CSRF)', state: 'ok', detail: `A change must come from ATLAS's own pages (Sec-Fetch-Site, Origin). ${(b.sig['cross-site'] || 0).toLocaleString('en-PH')} refused in this period.` },
    { label: 'Host name check (DNS rebinding)', state: 'ok', detail: `Only localhost, an IP address${allowed.length ? ` or ${allowed.join(', ')}` : ''}.` },
    { label: 'JSON only, checked', state: 'ok', detail: 'Changes are sent as JSON; keys that reach a prototype are dropped, nesting and size are bounded, and a route takes only the fields it declares.' },
    { label: 'Request size limits', state: 'ok', detail: '256 KB before signing in; 20 MB signed in (files travel inside the request).' },
    { label: 'Rate limits', state: rateLimits ? 'ok' : 'bad', detail: rateLimits ? `${sec.requestsPerMinute} a minute per person, ${sec.requestsPerMinute * 4} per address signed out, 60 sign-in attempts a minute per address.` : 'Off on this server.' },
    { label: 'Sign-in lockout', state: 'ok', detail: `A username locks for ${sec.lockoutMinutes} minutes after ${sec.lockoutAttempts} wrong passwords from one address (${sec.lockoutAttempts * 10} from anywhere); an address pauses after ${sec.signInFailuresPerAddress} wrong passwords in 15 minutes.` },
    { label: 'Sessions', state: 'ok', detail: `Cookie readable by no script, sent by no other site${https ? ', HTTPS only' : ''}; ends after ${sec.idleHours} idle hours or ${sec.maxSessionHours} hours in all; at most 10 per account.` },
    { label: 'Password storage', state: enc.on ? 'ok' : 'warn', detail: `scrypt at N = 2^${passwordCost()}${enc.on ? ', encrypted with the password key' : ', without the password key'}; at most two checks at once, so a flood of sign-ins cannot exhaust memory.` },
    { label: 'Calls to Keycloak (SSRF)', state: 'ok', detail: `Only https addresses on the internet, or this server's own Keycloak; the address is checked as the connection opens. ${(b.sig['outbound-blocked'] || 0).toLocaleString('en-PH')} refused in this period.` },
    { label: 'Content Security Policy and security headers', state: 'ok', detail: "Scripts only from ATLAS; no other site may frame it; no MIME sniffing." },
    { label: 'Strict Transport Security (HSTS)', state: https ? 'ok' : 'info', detail: https ? 'Added by the HTTPS proxy (Caddy) or Cloudflare: browsers stay on HTTPS.' : 'Comes with HTTPS.' },
    { label: 'Single sign-on', state: db.data.settings.sso?.enabled ? 'ok' : 'info', detail: db.data.settings.sso?.enabled ? 'Keycloak signs people in; passwords stay for administrators.' : 'Off.' },
  ];
}

// Who may call a route, in words.
const accessKind = (access) => (access === 'public' ? 'public' : access.includes(':') || ['teacher', 'student', 'guardian'].includes(access) ? 'permission' : 'signedIn');
// The route inventory (OWASP API9): every API address ATLAS answers, by who may call it.
function inventory(routes) {
  const api = routes.filter((r) => r.pattern.startsWith('/api/'));
  const byArea = {};
  for (const r of api) {
    const area = SYSTEM_LABELS[systemOf(r.pattern)] || 'Other';
    byArea[area] = (byArea[area] || 0) + 1;
  }
  return {
    total: api.length,
    public: api.filter((r) => accessKind(r.access) === 'public').map((r) => `${r.method} ${r.pattern}`),
    signedIn: api.filter((r) => accessKind(r.access) === 'signedIn').length,
    permission: api.filter((r) => accessKind(r.access) === 'permission').length,
    byArea: Object.entries(byArea).map(([area, n]) => ({ area, n })).sort((a, b) => b.n - a.n),
  };
}

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

// The page's data for one range.
export function monitorView({ db, monitor, audit, sec, rateLimits, routes, sessions, version, now = Date.now(), range = '24h' }) {
  if (!RANGES.includes(range)) range = '24h';
  const sample = monitor.lastSample(); // first, so a new server's first minute has its sample
  const { tier, buckets } = monitor.series(range, now);
  const m = monitor.merge(buckets);
  const byId = new Map(db.data.users.map((u) => [u.id, u]));
  const nameOf = (id) => byId.get(id)?.name || 'Removed account';
  const roleOf = (id) => (byId.get(id) ? roleLabel(byId.get(id).role) : '');
  const signals = monitor.signals();
  const apiSignals = signals.filter((s) => s.group === 'api');
  const authSignals = signals.filter((s) => s.group === 'auth');
  const refusalsOf = (b) => apiSignals.reduce((a, s) => a + (b.sig[s.name] || 0), 0);

  const checks = monitor.runChecks({ db, monitor, audit, sec, rateLimits, version, sample, now });

  // Addresses to watch: many refusals, or any lock, in the period (the week at most).
  const addr = monitor.merge(monitor.addressBuckets(range, now)).ips;
  const watch = Object.entries(addr)
    .map(([ip, a]) => {
      const refused = apiSignals.reduce((x, s) => x + (a.s[s.name] || 0), 0);
      const failed = authSignals.reduce((x, s) => x + (a.s[s.name] || 0), 0);
      const top = Object.entries(a.s).sort((x, y) => y[1] - x[1])[0];
      return { ip, requests: a.n, refused, failed, locked: (a.s.locked || 0) + (a.s['address-paused'] || 0), top: top ? signals.find((s) => s.name === top[0])?.label || top[0] : '', lastAt: a.last ? new Date(a.last).toISOString() : null };
    })
    .filter((a) => a.ip !== OTHERS && (a.refused >= 20 || a.failed >= 5 || a.locked > 0 || a.refused + a.failed >= 10))
    .sort((x, y) => y.refused + y.failed - (x.refused + x.failed))
    .slice(0, 15);

  const routeRows = Object.entries(m.routes).map(([key, r]) => ({ route: key, n: r.n, errors: r.e, p95: percentile(r.lat, 95) }));
  const topRoutes = [...routeRows].sort((a, b) => b.n - a.n).slice(0, 10);
  const slowRoutes = routeRows.filter((r) => r.n >= 5).sort((a, b) => b.p95 - a.p95).slice(0, 5);

  // People
  const open = sessions();
  const daysBack = (n) => monitor.merge(monitor.series('30d', now).buckets.slice(-n)).users;
  const active24 = Object.keys(monitor.merge(monitor.series('24h', now).buckets).users).length;
  const topPeople = [...new Set([...Object.keys(m.users), ...Object.keys(m.actors)])]
    .map((id) => ({ id, name: nameOf(id), role: roleOf(id), requests: m.users[id] || 0, actions: m.actors[id] || 0 }))
    .sort((a, b) => b.actions - a.actions || b.requests - a.requests)
    .slice(0, 10);
  const signInLog = audit.entries().slice(-2000).filter((e) => e.kind === 'signin').slice(-15).reverse()
    .map((e) => ({ at: e.at, name: e.actor || e.target || '(unknown username)', userId: e.outcome === 'ok' ? e.actorId : null, ip: e.ip, outcome: e.outcome === 'ok' ? 'signed-in' : /locked|from this address/.test(e.action) ? 'locked' : 'failed', note: e.outcome === 'ok' ? e.detail : e.action.replace(/^Sign-in (failed|refused): /, '') }));

  return {
    generatedAt: new Date(now).toISOString(),
    range, tier,
    bounds: DURATION_BOUNDS_MS,
    status: {
      version, node: process.version,
      startedAt: new Date(monitor.startedAt).toISOString(),
      host: hostInfo(),
      process: { rss: sample.rss, heap: sample.heap, heapLimit: sample.heapLimit, cpu: sample.cpu, lag: sample.lag, heapUsedOfLimit: pct(sample.heap, sample.heapLimit), v8HeapTotal: v8.getHeapStatistics().total_heap_size },
      disk: db.dir ? diskOf(db.dir) : null,
      files: { db: sizeOf(db.file), audit: sizeOf(audit.file), monitor: sizeOf(monitor.file) },
      checks,
      summary: { ok: checks.filter((c) => c.state === 'ok').length, warn: checks.filter((c) => c.state === 'warn').length, bad: checks.filter((c) => c.state === 'bad').length },
    },
    api: {
      inventory: inventory(routes),
      controls: controls({ sec, rateLimits, bucket: m, db }),
      refusals: apiSignals.map((s) => ({ ...s, count: m.sig[s.name] || 0 })),
      signIn: authSignals.map((s) => ({ ...s, count: m.sig[s.name] || 0 })),
      watch,
      addressesKept: range === '30d' ? '7d' : range,
      metrics: { token: monitor.token() ? { createdAt: monitor.token().createdAt, createdBy: monitor.token().createdBy } : null },
    },
    traffic: {
      totals: { requests: m.n, api: m.api, pages: m.pages, files: m.files, status: m.s, out: m.out, https: m.https, plainNet: m.plainNet, refused: refusalsOf(m) },
      latency: { p50: percentile(m.lat, 50), p95: percentile(m.lat, 95), p99: percentile(m.lat, 99) },
      topRoutes, slowRoutes,
    },
    activity: {
      now: { sessions: open.length, people: new Set(open.map((s) => s.userId)).size },
      live: [...open].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 50).map((s) => ({ userId: s.userId, name: nameOf(s.userId), role: roleOf(s.userId), side: s.side, agent: s.agent, ip: s.ip, signedInAt: new Date(s.createdAt).toISOString(), lastSeenAt: new Date(s.lastSeen).toISOString() })),
      active: { d1: active24, d7: Object.keys(daysBack(7)).length, d30: Object.keys(daysBack(30)).length },
      signIns: m.signIns, actions: sum(m.act),
      byArea: Object.entries(m.act).map(([area, n]) => ({ area, label: SYSTEM_LABELS[area] || area, n })).sort((a, b) => b.n - a.n),
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
export function prometheusText({ monitor, db, audit, sessions, checks, version }) {
  const lines = [];
  const metric = (name, type, help, rows) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of rows) lines.push(`${name}${labels ? `{${Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}` : ''} ${value}`);
  };
  const s = monitor.lastSample();
  metric('atlas_build_info', 'gauge', 'The ATLAS version and Node.js version running.', [[{ version: version || '', nodejs: process.versions.node }, 1]]);
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
  metric('atlas_security_events_total', 'counter', 'Refusals and sign-in events, by kind.', monitor.signals().map((x) => [{ signal: x.name, owasp: x.owasp }, monitor.totals.signals[x.name] || 0]));
  metric('atlas_changes_total', 'counter', 'Changes made by signed-in people since start.', [[null, monitor.totals.actions]]);
  metric('atlas_sign_ins_total', 'counter', 'Successful sign-ins since start.', [[null, monitor.totals.signIns]]);
  const open = sessions();
  metric('atlas_sessions_open', 'gauge', 'Sessions open now.', [[null, open.length]]);
  metric('atlas_people_signed_in', 'gauge', 'People signed in now.', [[null, new Set(open.map((x) => x.userId)).size]]);
  metric('atlas_users_active', 'gauge', 'Active accounts.', [[null, active(db).length]]);
  metric('atlas_audit_chain_intact', 'gauge', '1 when the audit log check passes.', [[null, audit.verify().ok ? 1 : 0]]);
  const level = { ok: 0, info: 0, warn: 1, bad: 2 };
  metric('atlas_check_status', 'gauge', 'Each status check: 0 fine, 1 needs attention, 2 a problem.', checks.map((c) => [{ check: c.id, area: c.area }, level[c.state] ?? 0]));
  return `${lines.join('\n')}\n`;
}

// ----- The scrape token: shown once, only its hash kept -----
const hashToken = (t) => createHash('sha256').update(String(t)).digest();
export function newToken(user) {
  const token = `atlas_mt_${randomBytes(32).toString('base64url')}`;
  return { token, saved: { hash: hashToken(token).toString('hex'), createdAt: new Date().toISOString(), createdBy: user.name } };
}
export function tokenMatches(saved, header) {
  const given = String(header || '').match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!saved?.hash || !given) return false;
  const a = hashToken(given);
  const b = Buffer.from(saved.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// The routes: the page's data, the metrics export and its token. (The health check, /healthz, is
// answered by server.js before anything else.)
// sessions: () => every open session ({ userId, side, createdAt, lastSeen, ip, agent }).
export function registerMonitorRoutes(route, { db, monitor, audit: auditLog, record, sec, rateLimits, routes, sessions, version }) {
  registerBuiltInChecks(monitor);
  // The chain check reads the whole log when the file changed: a page refreshing every minute and a
  // metrics server collecting every 15 seconds reuse the last result for up to a minute.
  let last = null;
  const audit = {
    ...auditLog,
    verify() {
      const t = Date.now();
      if (!last || last.count !== auditLog.count() || t - last.at > 60000) last = { at: t, count: auditLog.count(), result: auditLog.verify() };
      return last.result;
    },
  };
  const only = (user) => {
    if (user?.role !== 'admin') throw new HttpError(403, 'The Security monitor is for administrators.');
  };
  const ctx = () => ({ db, monitor, audit, sec: sec(), rateLimits, version, sample: monitor.lastSample(), now: Date.now() });
  route('GET', '/api/system/monitor', 'admin', ({ user, query }) => {
    only(user);
    return monitorView({ db, monitor, audit, sec: sec(), rateLimits, routes, sessions, version, range: query.range });
  }, { audit: false });
  route('GET', '/api/system/monitor/metrics', 'public', ({ headers }) => {
    const saved = monitor.token();
    if (!saved) throw new HttpError(404, 'Not found.');
    if (!tokenMatches(saved, headers?.authorization)) throw new HttpError(401, 'A valid metrics token is needed.');
    const text = prometheusText({ monitor, db, audit, sessions, checks: monitor.runChecks(ctx()), version });
    return { raw: text, type: 'text/plain; version=0.0.4', headers: {} };
  }, { audit: false });
  route('POST', '/api/system/monitor/token', 'admin', ({ user, ip, agent }) => {
    only(user);
    const { token, saved } = newToken(user);
    const replaced = Boolean(monitor.token());
    monitor.setToken(saved);
    record({ kind: 'access', system: 'system', action: replaced ? 'Replaced the metrics token (the old one stopped working)' : 'Made a metrics token', actor: user, ip, agent, targetName: 'Security monitor' });
    return { token, createdAt: saved.createdAt, createdBy: saved.createdBy };
  }, { audit: false });
  route('DELETE', '/api/system/monitor/token', 'admin', ({ user, ip, agent }) => {
    only(user);
    if (!monitor.token()) throw new HttpError(404, 'There is no metrics token.');
    monitor.setToken(null);
    record({ kind: 'access', system: 'system', action: 'Revoked the metrics token', actor: user, ip, agent, targetName: 'Security monitor' });
    return { ok: true };
  }, { audit: false });
}

