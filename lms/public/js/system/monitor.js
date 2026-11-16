// System → Security monitor, after CORE ERP's (public/js/views/admin/monitor.js at the repository
// root): the software's status, the API's security, the traffic and who is using ATLAS, for a
// period (last hour to 30 days). Administrators only. Refreshes every minute while open.
import { api } from '../api.js';
import { html, mount, badge, toast, confirmDialog, fmtDateTime, timeAgo, fmtSize } from '../ui.js';
import { icon } from '../icons.js';
import { chart, wireCharts, rankBar } from './charts.js';

const TABS = [
  ['status', 'Software status', 'checkCircle'],
  ['api', 'API security', 'shield'],
  ['traffic', 'Traffic', 'chart'],
  ['activity', 'User activity', 'users'],
];
const RANGES = [['1h', 'Last hour'], ['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days']];
const RANGE_TEXT = { '1h': 'in the last hour', '24h': 'in the last 24 hours', '7d': 'in the last 7 days', '30d': 'in the last 30 days' };
const STATE = {
  ok: ['Fine', 'checkCircle'],
  warn: ['Look at this', 'flag'],
  bad: ['Problem', 'flag'],
  info: ['Note', 'circle'],
};
const ORDER = { bad: 0, warn: 1, info: 2, ok: 3 };
const AREAS = [['software', 'Software and server'], ['data', 'Data and records'], ['access', 'Sign-in and access']];
const SIDES = { portal: 'Learn', admin: 'Admin panel', hris: 'People' };
const num = new Intl.NumberFormat('en-PH');
const n = (v) => num.format(v || 0);
const plural = (v, one, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const ms = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`);
const big = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)} GB` : fmtSize(v || 0));
const pctOf = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
// A short name for a browser, from what it says it is.
function device(agent = '') {
  const a = String(agent);
  const browser = /Edg\//.test(a) ? 'Edge' : /OPR\//.test(a) ? 'Opera' : /Firefox\//.test(a) ? 'Firefox' : /Chrome\//.test(a) ? 'Chrome' : /Safari\//.test(a) ? 'Safari' : '';
  const os = /Android/.test(a) ? 'Android' : /iPhone|iPad/.test(a) ? 'iPhone or iPad' : /Windows/.test(a) ? 'Windows' : /Mac OS X/.test(a) ? 'Mac' : /Linux/.test(a) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ') || 'Unknown device';
}
const person = (id, name) => (id ? html`<a href="#/system/users?q=${encodeURIComponent(name)}">${name}</a>` : html`<span class="mono">${name}</span>`);
const state = (s) => html`<span class="mon-state ${s}">${icon(STATE[s][1], 14)} ${STATE[s][0]}</span>`;

// Axis and readout labels for each tier.
function labels(tier, range) {
  const d = (t) => new Date(t);
  const hm = (t) => d(t).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = (t) => d(t).toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short' });
  if (tier === 'minute') return { short: hm, label: (t) => `${day(t)}, ${hm(t)}` };
  if (tier === 'hour') return { short: range === '7d' ? (t) => d(t).toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric' }) : hm, label: (t) => `${day(t)}, ${hm(t)} to ${hm(t + 3600000)}` };
  return { short: (t) => d(t).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' }), label: day };
}

export async function monitorView(el, params, q = {}) {
  const tab = TABS.some(([id]) => id === q.tab) ? q.tab : 'status';
  const range = RANGES.some(([id]) => id === q.range) ? q.range : '24h';
  let token = null; // a metrics token just made: shown once
  const hrefOf = (t, r) => `#/system/monitor?tab=${t}&range=${r}`;

  async function draw() {
    const v = await api.get(`/api/system/monitor?range=${range}`);
    if (!el.isConnected) return;
    const lab = labels(v.tier, range);
    const pts = (key, scale = 1) => v.series.map((b) => ({ label: lab.label(b.t), short: lab.short(b.t), v: b[key] == null ? null : b[key] / scale }));
    const s = v.status.summary;
    const refused = v.traffic.totals.refused;
    const failed = v.api.signIn.reduce((a, x) => a + x.count, 0);
    const body = { status: statusTab, api: apiTab, traffic: trafficTab, activity: activityTab }[tab](v, pts);
    mount(el, html`
      <header class="page-head">
        <div><h1>Security monitor</h1>
          <p class="muted">This server, ${RANGE_TEXT[range]} · updated ${new Date(v.generatedAt).toLocaleTimeString('en-PH')}, again every minute. Counted on the server: no tracking script, and never what people type.</p></div>
        <div class="actions"><button type="button" class="btn" id="mon-refresh">${icon('clock', 16)} Refresh</button></div>
      </header>
      <div class="chips mon-filter" role="group" aria-label="Period">${RANGES.map(([id, label]) => html`<button type="button" data-range="${id}" class="chip ${id === range ? 'on' : ''}" aria-pressed="${id === range}">${label}</button>`)}</div>
      <div class="stats mon-stats">
        <a class="card ${s.bad ? 'attention' : ''}" href="${hrefOf('status', range)}"><small>Software status</small><strong class="${s.bad ? 'mon-bad' : s.warn ? 'mon-warn' : 'mon-ok'}">${s.bad ? plural(s.bad, 'problem') : s.warn ? `${s.warn} to look at` : 'All fine'}</strong><span class="muted small block">${s.ok} of ${s.ok + s.warn + s.bad} checks fine</span></a>
        <a class="card ${refused + failed > 100 ? 'attention' : ''}" href="${hrefOf('api', range)}"><small>Refused requests</small><strong>${n(refused)}</strong><span class="muted small block">${plural(failed, 'sign-in problem')}${v.api.watch.length ? ` · ${plural(v.api.watch.length, 'address', 'addresses')} to watch` : ''}</span></a>
        <a class="card" href="${hrefOf('traffic', range)}"><small>Requests</small><strong>${n(v.traffic.totals.requests)}</strong><span class="muted small block">API p95 ${ms(v.traffic.latency.p95)} · ${pctOf(v.traffic.totals.status[5], v.traffic.totals.api)} errors</span></a>
        <a class="card" href="${hrefOf('activity', range)}"><small>Signed in now</small><strong>${n(v.activity.now.people)}</strong><span class="muted small block">${plural(v.activity.now.sessions, 'session')} · ${n(v.activity.active.d1)} active today</span></a>
      </div>
      <nav class="tabs" aria-label="Security monitor">${TABS.map(([id, label, ic]) => html`<a href="${hrefOf(id, range)}" class="${id === tab ? 'active' : ''}" ${id === tab ? 'aria-current="page"' : ''}>${icon(ic, 16)} ${label}</a>`)}</nav>
      ${body}`);
    wireCharts(el);
    el.querySelector('#mon-refresh').addEventListener('click', () => draw().catch((err) => toast(err.message, 'error')));
    el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => (location.hash = hrefOf(tab, b.dataset.range))));
    el.querySelector('#mon-token-new')?.addEventListener('click', async () => {
      if (v.api.metrics?.token && !(await confirmDialog('Replace the metrics token? The old one stops working at once.', { confirmLabel: 'Replace', title: 'Replace the token' }))) return;
      try {
        token = await api.post('/api/system/monitor/token', {});
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    el.querySelector('#mon-token-revoke')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Revoke the metrics token? Collecting metrics stops until a new one is made.', { confirmLabel: 'Revoke', title: 'Revoke the token' }))) return;
      await api.del('/api/system/monitor/token');
      token = null;
      toast('Metrics token revoked.');
      draw();
    });
    el.querySelector('#mon-token-copy')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(token.token);
        toast('Token copied.');
      } catch {
        toast('Select the token and copy it.', 'error');
      }
    });
  }

  // ----- Software status -----
  function statusTab(v, pts) {
    const p = v.status.process;
    const upDays = (Date.now() - Date.parse(v.status.startedAt)) / 86400000;
    return html`
      <div class="mon-checks">${AREAS.map(([area, title]) => {
        const list = v.status.checks.filter((c) => c.area === area).sort((a, b) => ORDER[a.state] - ORDER[b.state]);
        return list.length ? html`<section class="card" aria-labelledby="mon-${area}">
          <h2 id="mon-${area}">${title}</h2>
          <ul class="mon-list">${list.map((c) => html`<li class="mon-check st-${c.state}">
            ${state(c.state)}
            <span class="grow"><strong>${c.label}</strong><small>${c.detail}</small></span>
            ${c.href ? html`<a class="small" href="${c.href}">Open ${icon('chevronRight', 14)}</a>` : ''}
          </li>`)}</ul>
        </section>` : '';
      })}</div>
      <div class="cols">
        <section class="card" aria-labelledby="mon-server">
          <h2 id="mon-server">${icon('laptop')} This server</h2>
          <dl class="mon-info">
            <div><dt>ATLAS</dt><dd>${v.status.version || '—'}</dd></div>
            <div><dt>Node.js</dt><dd>${v.status.node}</dd></div>
            <div><dt>System</dt><dd>${v.status.host.platform} · ${v.status.host.arch} · ${plural(v.status.host.cpus, 'processor')} · ${big(v.status.host.memory)} memory</dd></div>
            <div><dt>Running since</dt><dd>${fmtDateTime(v.status.startedAt)} (${upDays >= 1 ? plural(Math.floor(upDays), 'day') : timeAgo(v.status.startedAt).replace(' ago', '')})</dd></div>
            <div><dt>Memory in use</dt><dd>${big(p.rss)} · data ${p.heapUsedOfLimit}% of its limit</dd></div>
            <div><dt>CPU, last minute</dt><dd>${p.cpu}% of one processor</dd></div>
            <div><dt>Disk</dt><dd>${v.status.disk ? `${big(v.status.disk.free)} free of ${big(v.status.disk.total)}` : '—'}</dd></div>
            <div><dt>Files</dt><dd>data ${big(v.status.files.db)} · audit log ${big(v.status.files.audit)} · monitor ${big(v.status.files.monitor)}</dd></div>
          </dl>
        </section>
        <section class="card">
          ${v.tier === 'day' ? html`<h2>Server load</h2><p class="muted small">Memory and responsiveness are kept for 7 days. Choose 7 days or less to see them.</p>`
          : html`${chart({ title: 'Memory in use (MB)', note: v.tier === 'hour' ? 'highest in each hour' : '', points: pts('rss', 1048576), kind: 'line', fmt: (x) => `${n(Math.round(x))} MB`, empty: 'Sampled each minute: shows after the first minute.' })}
            ${chart({ title: 'Event loop delay, p99 (ms)', note: 'how long work waited to run', points: pts('lag'), kind: 'line', fmt: (x) => `${x} ms`, empty: 'Sampled each minute: shows after the first minute.' })}`}
        </section>
      </div>`;
  }

  // ----- API security -----
  function apiTab(v, pts) {
    const a = v.api;
    const maxR = Math.max(0, ...a.refusals.map((r) => r.count));
    const maxS = Math.max(0, ...a.signIn.map((r) => r.count));
    const rows = (list, max) => [...list].sort((x, y) => y.count - x.count).map((r) => html`<tr class="${r.count ? '' : 'mon-zero'}"><td>${r.label}</td><td><span class="mono small">${r.owasp || '—'}</span></td><td class="num">${n(r.count)}</td><td class="mon-bar">${rankBar(r.count, max)}</td></tr>`);
    const inv = a.inventory;
    return html`
      <div class="cols">
        <section class="card">${chart({ title: 'Refused requests', points: pts('refused'), empty: 'No requests refused in this period.' })}</section>
        <section class="card">${chart({ title: 'Failed and refused sign-ins', points: pts('failed'), empty: 'None in this period.' })}</section>
      </div>
      <section class="card" aria-labelledby="mon-watch">
        <div class="card-head"><h2 id="mon-watch">${icon('flag')} Addresses to watch</h2><span class="muted small">Kept for 7 days${range === '30d' ? ': this list covers the last 7 days' : ''}</span></div>
        ${a.watch.length ? html`<div class="scroll-x"><table class="table">
          <thead><tr><th>Network address</th><th class="num">Refused</th><th class="num">Sign-in problems</th><th>Mostly</th><th class="num">Requests</th><th>Last seen</th></tr></thead>
          <tbody>${a.watch.map((w) => html`<tr><td class="mono">${w.ip}</td><td class="num">${n(w.refused)}</td><td class="num">${n(w.failed)}${w.locked ? html` ${badge(plural(w.locked, 'lock'), 'red')}` : ''}</td><td>${w.top}</td><td class="num">${n(w.requests)}</td><td>${w.lastAt ? timeAgo(w.lastAt) : '—'}</td></tr>`)}</tbody>
        </table></div>
        <p class="muted small">A campus, a computer lab or a dormitory shares one address, so look before blocking: the <a href="#/system/audit">Audit log</a> shows who used it. Block an address at the firewall, in AWS or in Cloudflare, not in ATLAS.</p>`
        : html`<p class="muted small">No address passed the thresholds ${RANGE_TEXT[range]}: 20 refused requests, 5 sign-in problems, or a locked username.</p>`}
      </section>
      <div class="cols">
        <section class="card" aria-labelledby="mon-refusals">
          <h2 id="mon-refusals">Refusals by kind</h2>
          <div class="scroll-x"><table class="table mon-rank-table"><thead><tr><th>Kind</th><th>OWASP API</th><th class="num">Count</th><th><span class="sr-only">Share</span></th></tr></thead><tbody>${rows(a.refusals, maxR)}</tbody></table></div>
          <p class="muted small">OWASP API Security Top 10 (2023): API1 object-level access, API2 authentication, API3 object properties, API4 resource use, API5 function-level access, API7 server-side request forgery, API8 configuration, API9 inventory.</p>
        </section>
        <section class="card" aria-labelledby="mon-signin">
          <div class="card-head"><h2 id="mon-signin">Sign-in events</h2><a class="small" href="#/system/audit?kind=signin">Audit log ${icon('chevronRight', 14)}</a></div>
          <div class="scroll-x"><table class="table mon-rank-table"><thead><tr><th>Event</th><th>OWASP API</th><th class="num">Count</th><th><span class="sr-only">Share</span></th></tr></thead><tbody>${rows(a.signIn, maxS)}</tbody></table></div>
        </section>
      </div>
      <div class="cols">
        <section class="card" aria-labelledby="mon-controls">
          <div class="card-head"><h2 id="mon-controls">${icon('lock')} Controls in force</h2><a class="small" href="/admin#/sign-in">Sign-in and passwords ${icon('chevronRight', 14)}</a></div>
          <ul class="mon-list">${a.controls.map((c) => html`<li class="mon-check st-${c.state}">${state(c.state)}<span class="grow"><strong>${c.label}</strong><small>${c.detail}</small></span></li>`)}</ul>
        </section>
        <section class="card" aria-labelledby="mon-inventory">
          <h2 id="mon-inventory">${icon('database')} API inventory</h2>
          <p><strong>${n(inv.total)}</strong> API addresses: <strong>${inv.public.length}</strong> open without signing in, <strong>${n(inv.signedIn)}</strong> for anyone signed in to that side, <strong>${n(inv.permission)}</strong> that need a permission or account type. Each one also checks the record it is asked for.</p>
          <ul class="mon-areas">${inv.byArea.map((x) => html`<li>${x.area}<strong>${n(x.n)}</strong></li>`)}</ul>
          <details class="mon-public"><summary>The ${inv.public.length} addresses open without signing in</summary><ul>${inv.public.map((r) => html`<li><code>${r}</code></li>`)}</ul></details>
        </section>
      </div>
      ${metricsCard(a.metrics)}`;
  }

  function metricsCard(m) {
    const origin = location.origin;
    return html`<section class="card" aria-labelledby="mon-metrics">
      <h2 id="mon-metrics">${icon('external')} Monitoring from another tool</h2>
      <p class="muted small">For an uptime checker (such as Uptime Kuma or an AWS load balancer) and a metrics server (Prometheus, then Grafana). Neither shows names or network addresses.</p>
      <dl class="mon-info">
        <div><dt>Health check</dt><dd><code>${origin}/healthz</code><small class="block muted">Answers {"ok":true} while ATLAS runs; needs no sign-in.</small></dd></div>
        <div><dt>Metrics</dt><dd><code>${origin}/api/system/monitor/metrics</code><small class="block muted">Prometheus text format, with the token as <code>Authorization: Bearer</code>.</small></dd></div>
        <div><dt>Token</dt><dd>${m.token ? html`Made ${fmtDateTime(m.token.createdAt)} by ${m.token.createdBy}` : html`<span class="muted">None: metrics are off</span>`}</dd></div>
      </dl>
      ${token ? html`<div class="mon-token" role="status"><p><strong>Copy this token now.</strong> ATLAS keeps only a fingerprint of it and cannot show it again.</p><code class="mon-token-value">${token.token}</code><button type="button" class="btn sm" id="mon-token-copy">${icon('clipboard', 14)} Copy</button></div>` : ''}
      <div class="actions"><button type="button" class="btn" id="mon-token-new">${icon('key', 16)} ${m.token ? 'Replace the token' : 'Make a token'}</button>${m.token ? html`<button type="button" class="btn danger ghost" id="mon-token-revoke">${icon('x', 16)} Revoke</button>` : ''}</div>
    </section>`;
  }

  // ----- Traffic -----
  function trafficTab(v, pts) {
    const t = v.traffic;
    const st = t.totals.status;
    const maxS = Math.max(st[2], st[3], st[4], st[5]);
    const routeTable = (list, empty) => (list.length ? html`<div class="scroll-x"><table class="table"><thead><tr><th>Route</th><th class="num">Requests</th><th class="num">Errors</th><th class="num">p95</th></tr></thead>
      <tbody>${list.map((r) => html`<tr><td><code class="mon-route">${r.route}</code></td><td class="num">${n(r.n)}</td><td class="num">${r.errors ? html`<span class="mon-bad">${n(r.errors)}</span>` : '0'}</td><td class="num">${ms(r.p95)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted small">${empty}</p>`);
    return html`
      <div class="stats">
        <div class="card"><small>Page views</small><strong>${n(t.totals.pages)}</strong><span class="muted small block">ATLAS opened or reloaded</span></div>
        <div class="card"><small>API response time</small><strong>${ms(t.latency.p95)}</strong><span class="muted small block">p95 · median ${ms(t.latency.p50)} · p99 ${ms(t.latency.p99)}</span></div>
        <div class="card"><small>Server errors</small><strong class="${st[5] ? 'mon-bad' : ''}">${n(st[5])}</strong><span class="muted small block">${pctOf(st[5], t.totals.api)} of API requests</span></div>
        <div class="card"><small>Data sent</small><strong>${big(t.totals.out)}</strong><span class="muted small block">${t.totals.requests ? `${pctOf(t.totals.https, t.totals.requests)} over HTTPS` : ''}</span></div>
      </div>
      <div class="cols">
        <section class="card">${chart({ title: 'Requests', note: 'pages, files and API', points: pts('n') })}</section>
        <section class="card">${chart({ title: 'API response time, p95', note: 'ms; 95% of requests were this fast or faster', points: pts('p95'), kind: 'line', fmt: (x) => ms(x) })}</section>
      </div>
      <div class="cols">
        <section class="card" aria-labelledby="mon-busy"><h2 id="mon-busy">Busiest API routes</h2>${routeTable(t.topRoutes, 'No API requests in this period.')}</section>
        <section class="card" aria-labelledby="mon-slow"><h2 id="mon-slow">Slowest API routes</h2>${routeTable(t.slowRoutes, 'Routes show here after 5 requests.')}
          <h3 class="mon-sub">Answers by status</h3>
          <table class="table mon-rank-table"><tbody>${[[2, 'Done (2xx)'], [3, 'Redirected (3xx)'], [4, 'Refused or not found (4xx)'], [5, 'Server error (5xx)']].map(([k, l]) => html`<tr><td>${l}</td><td class="num">${n(st[k])}</td><td class="mon-bar">${rankBar(st[k], maxS)}</td></tr>`)}</tbody></table>
        </section>
      </div>`;
  }

  // ----- User activity -----
  function activityTab(v, pts) {
    const a = v.activity;
    const maxA = Math.max(0, ...a.byArea.map((x) => x.n));
    const OUT = { 'signed-in': ['Signed in', 'green'], failed: ['Failed', 'amber'], locked: ['Locked', 'red'] };
    return html`
      <div class="stats">
        <div class="card"><small>Signed in now</small><strong>${n(a.now.people)}</strong><span class="muted small block">${plural(a.now.sessions, 'session')}</span></div>
        <div class="card"><small>Active today</small><strong>${n(a.active.d1)}</strong><span class="muted small block">used ATLAS in the last 24 hours</span></div>
        <div class="card"><small>This week</small><strong>${n(a.active.d7)}</strong><span class="muted small block">last 7 days</span></div>
        <div class="card"><small>This month</small><strong>${n(a.active.d30)}</strong><span class="muted small block">last 30 days</span></div>
      </div>
      <div class="cols">
        <section class="card">${chart({ title: 'Sign-ins', points: pts('signIns'), empty: 'No sign-ins in this period.' })}</section>
        <section class="card">${chart({ title: 'Changes made', note: 'saves, approvals and uploads by signed-in people', points: pts('actions') })}</section>
      </div>
      <section class="card" aria-labelledby="mon-live">
        <h2 id="mon-live">${icon('user')} Signed in now</h2>
        ${a.live.length ? html`<div class="scroll-x"><table class="table"><thead><tr><th>Person</th><th>Account type</th><th>Signed in to</th><th>Device</th><th>Network address</th><th>Signed in</th><th>Last active</th></tr></thead>
          <tbody>${a.live.map((s) => html`<tr><td>${person(s.userId, s.name)}</td><td>${s.role}</td><td>${SIDES[s.side] || s.side}</td><td>${device(s.agent)}</td><td class="mono">${s.ip || '—'}</td><td>${fmtDateTime(s.signedInAt)}</td><td>${timeAgo(s.lastSeenAt)}</td></tr>`)}</tbody></table></div>
          <p class="muted small">To end someone's sessions: <a href="#/system/users">Users &amp; Access</a> → the person → Sign out everywhere.</p>`
        : html`<p class="muted small">Nobody is signed in.</p>`}
      </section>
      <div class="cols">
        <section class="card" aria-labelledby="mon-areas">
          <h2 id="mon-areas">Where people made changes</h2>
          ${a.byArea.length ? html`<table class="table mon-rank-table"><thead><tr><th>System</th><th class="num">Changes</th><th><span class="sr-only">Share</span></th></tr></thead><tbody>${a.byArea.slice(0, 12).map((x) => html`<tr><td>${x.label}</td><td class="num">${n(x.n)}</td><td class="mon-bar">${rankBar(x.n, maxA)}</td></tr>`)}</tbody></table>` : html`<p class="muted small">No changes in this period.</p>`}
        </section>
        <section class="card" aria-labelledby="mon-people">
          <h2 id="mon-people">Most active</h2>
          ${a.topPeople.length ? html`<table class="table"><thead><tr><th>Person</th><th class="num">Changes</th><th class="num">Requests</th></tr></thead><tbody>${a.topPeople.map((x) => html`<tr><td>${person(x.id, x.name)}<small class="block muted">${x.role}</small></td><td class="num">${n(x.actions)}</td><td class="num">${n(x.requests)}</td></tr>`)}</tbody></table>` : html`<p class="muted small">Nobody in this period.</p>`}
        </section>
      </div>
      <section class="card" aria-labelledby="mon-signins">
        <div class="card-head"><h2 id="mon-signins">Recent sign-ins</h2><a class="small" href="#/system/audit?kind=signin">Audit log ${icon('chevronRight', 14)}</a></div>
        ${a.signInLog.length ? html`<div class="scroll-x"><table class="table"><thead><tr><th>When</th><th>Who</th><th>Network address</th><th>Result</th></tr></thead>
          <tbody>${a.signInLog.map((e) => html`<tr><td>${fmtDateTime(e.at)}</td><td>${person(e.userId, e.name)}</td><td class="mono">${e.ip || '—'}</td><td>${badge(OUT[e.outcome][0], OUT[e.outcome][1])}${e.note ? html` <small class="muted">${e.note}</small>` : ''}</td></tr>`)}</tbody></table></div>`
        : html`<p class="muted small">No sign-ins recorded yet.</p>`}
      </section>`;
  }

  await draw();
  // Every minute while the page is open and the window is visible.
  const timer = setInterval(() => {
    if (!el.isConnected) return clearInterval(timer);
    if (document.visibilityState === 'visible') draw().catch(() => {});
  }, 60000);
  return () => clearInterval(timer);
}
