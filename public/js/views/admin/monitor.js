// Admin panel → Security monitor (0.34): the software's status, the API's security, the traffic and
// who is using CORE, for a period (last hour to 30 days). Refreshes every minute while open.
import { api } from '../../api.js';
import { can } from '../../state.js';
import { html, mount, badge, toast } from '../../ui.js';
import { icon } from '../../icons.js';
import { chart, wireCharts, rankBar } from '../../charts.js';
import { pageHead, fmtDateTime, timeAgo, bytes, plural } from './common.js';

const TABS = [
  ['status', 'Software status', 'checkCircle'],
  ['api', 'API security', 'shield'],
  ['traffic', 'Traffic', 'activity'],
  ['activity', 'User activity', 'users'],
];
const RANGES = [['1h', 'Last hour'], ['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days']];
const RANGE_TEXT = { '1h': 'in the last hour', '24h': 'in the last 24 hours', '7d': 'in the last 7 days', '30d': 'in the last 30 days' };
const STATE = {
  ok: ['Fine', 'checkCircle'],
  warn: ['Look at this', 'alert'],
  bad: ['Problem', 'alert'],
  info: ['Note', 'circle'],
};
const ORDER = { bad: 0, warn: 1, info: 2, ok: 3 };
const AREAS = [['software', 'Software and server'], ['data', 'Data and records'], ['access', 'Sign-in and access']];
const num = new Intl.NumberFormat('en-PH');
const n = (v) => num.format(v || 0);
const ms = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`);
const big = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)} GB` : bytes(v));
const pctOf = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');

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
  const hrefOf = (t, r) => `#/admin/monitor?tab=${t}&range=${r}`;

  async function draw() {
    const v = await api.get(`/api/admin/monitor?range=${range}`);
    if (!el.isConnected) return;
    const lab = labels(v.tier, range);
    const pts = (key, scale = 1) => v.series.map((b) => ({ label: lab.label(b.t), short: lab.short(b.t), v: b[key] == null ? null : b[key] / scale }));
    const s = v.status.summary;
    const refused = v.traffic.totals.refused;
    const failed = v.api.signIn.reduce((a, x) => a + x.count, 0);
    const body = { status: statusTab, api: apiTab, traffic: trafficTab, activity: activityTab }[tab](v, pts);
    mount(el, html`
      ${pageHead('Security monitor', html`This server, ${RANGE_TEXT[range]} · updated ${new Date(v.generatedAt).toLocaleTimeString('en-PH')}, again every minute`, html`<button type="button" class="btn" id="mon-refresh">${icon('undo', 16)} Refresh</button>`)}
      <div class="mon-filter">
        <div class="seg-btns" role="group" aria-label="Period">${RANGES.map(([id, label]) => html`<button type="button" data-range="${id}" class="${id === range ? 'active' : ''}" aria-pressed="${id === range}">${label}</button>`)}</div>
      </div>
      <div class="stats mon-stats">
        <a class="card ${s.bad ? 'attention' : ''}" href="${hrefOf('status', range)}"><small>Software status</small><strong class="${s.bad ? 'bad-text' : s.warn ? 'warn' : 'ok-text'}">${s.bad ? plural(s.bad, 'problem') : s.warn ? `${s.warn} to look at` : 'All fine'}</strong><span class="muted small block">${s.ok} of ${s.ok + s.warn + s.bad} checks fine</span></a>
        <a class="card ${refused + failed > 100 ? 'attention' : ''}" href="${hrefOf('api', range)}"><small>Refused requests</small><strong>${n(refused)}</strong><span class="muted small block">${plural(failed, 'failed sign-in event')}${v.api.watch.length ? ` · ${plural(v.api.watch.length, 'address', 'addresses')} to watch` : ''}</span></a>
        <a class="card" href="${hrefOf('traffic', range)}"><small>Requests</small><strong>${n(v.traffic.totals.requests)}</strong><span class="muted small block">API p95 ${ms(v.traffic.latency.p95)} · ${pctOf(v.traffic.totals.status[5], v.traffic.totals.api)} errors</span></a>
        <a class="card" href="${hrefOf('activity', range)}"><small>Signed in now</small><strong>${n(v.activity.now.people)}</strong><span class="muted small block">${plural(v.activity.now.sessions, 'session')} · ${n(v.activity.active.d1)} active today</span></a>
      </div>
      <nav class="tabs" aria-label="Security monitor">${TABS.map(([id, label, ic]) => html`<a href="${hrefOf(id, range)}" class="${id === tab ? 'active' : ''}" ${id === tab ? 'aria-current="page"' : ''}>${icon(ic, 16)} ${label}</a>`)}</nav>
      ${body}`);
    wireCharts(el);
    el.querySelector('#mon-refresh').addEventListener('click', draw);
    el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => (location.hash = hrefOf(tab, b.dataset.range))));
    el.querySelector('#mon-token-new')?.addEventListener('click', async () => {
      if (v.api.metrics?.token && !confirm('Replace the metrics token? The old one stops working at once.')) return;
      token = await api.post('/api/admin/monitor/token', {});
      draw();
    });
    el.querySelector('#mon-token-revoke')?.addEventListener('click', async () => {
      if (!confirm('Revoke the metrics token? Collecting metrics stops until a new one is made.')) return;
      await api.del('/api/admin/monitor/token');
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
            ${c.href ? html`<a class="small" href="#${c.href}">Open ${icon('chevronRight', 14)}</a>` : ''}
          </li>`)}</ul>
        </section>` : '';
      })}</div>
      <div class="cols">
        <section class="card" aria-labelledby="mon-server">
          <h2 id="mon-server">${icon('laptop')} This server</h2>
          <dl class="info-grid">
            <div class="info"><dt>CORE</dt><dd>${v.status.version}${v.status.build.commit ? html` · <code>${v.status.build.commit.slice(0, 7)}</code>` : ''} · ${v.status.build.channel}</dd></div>
            <div class="info"><dt>Node.js</dt><dd>${v.status.build.node}</dd></div>
            <div class="info"><dt>System</dt><dd>${v.status.host.platform} · ${v.status.host.arch} · ${plural(v.status.host.cpus, 'processor')} · ${big(v.status.host.memory)} memory</dd></div>
            <div class="info"><dt>Running since</dt><dd>${fmtDateTime(v.status.startedAt)} (${upDays >= 1 ? plural(Math.floor(upDays), 'day') : timeAgo(v.status.startedAt).replace(' ago', '')})</dd></div>
            <div class="info"><dt>Memory in use</dt><dd>${bytes(p.rss)} · data ${p.heapUsedOfLimit}% of its limit</dd></div>
            <div class="info"><dt>CPU, last minute</dt><dd>${p.cpu}% of one processor</dd></div>
            <div class="info"><dt>Disk</dt><dd>${v.status.disk ? `${big(v.status.disk.free)} free of ${big(v.status.disk.total)}` : '—'}</dd></div>
            <div class="info"><dt>Files</dt><dd>data ${bytes(v.status.files.db)} · audit log ${bytes(v.status.files.audit)} · monitor ${bytes(v.status.files.monitor)}</dd></div>
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
    const rows = (list, max) => [...list].sort((x, y) => y.count - x.count).map((r) => html`<tr class="${r.count ? '' : 'muted'}"><td>${r.label}</td><td><span class="mono small">${r.owasp || '—'}</span></td><td class="num">${n(r.count)}</td><td class="mon-bar">${rankBar(r.count, max)}</td></tr>`);
    const inv = a.inventory;
    return html`
      <div class="cols">
        <section class="card">${chart({ title: 'Refused requests', points: pts('refused'), empty: 'No requests refused in this period.' })}</section>
        <section class="card">${chart({ title: 'Failed sign-ins and 2-step codes', points: pts('failed'), empty: 'None in this period.' })}</section>
      </div>
      <section class="card" aria-labelledby="mon-watch">
        <div class="card-head"><h2 id="mon-watch">${icon('flag')} Addresses to watch</h2><span class="muted small">Kept for 7 days${a.addressesKept === '7d' && range === '30d' ? ': this list covers the last 7 days' : ''}</span></div>
        ${a.watch.length ? html`<div class="table-scroll"><table class="table">
          <thead><tr><th>Network address</th><th class="num">Refused</th><th class="num">Failed sign-ins</th><th>Mostly</th><th class="num">Requests</th><th>Last seen</th></tr></thead>
          <tbody>${a.watch.map((w) => html`<tr><td class="mono">${w.ip}</td><td class="num">${n(w.refused)}</td><td class="num">${n(w.failed)}${w.locked ? html` ${badge(plural(w.locked, 'lock'), 'red')}` : ''}</td><td>${w.top}</td><td class="num">${n(w.requests)}</td><td>${w.lastAt ? timeAgo(w.lastAt) : '—'}</td></tr>`)}</tbody>
        </table></div>
        <p class="muted small">An office shares one address, so look before blocking: check the audit log for who used it. Block an address at the firewall or in AWS, not in CORE.</p>`
        : html`<p class="muted small">No address passed the thresholds ${RANGE_TEXT[range]}: 20 refused requests, 5 failed sign-ins, or a locked username.</p>`}
      </section>
      <div class="cols">
        <section class="card" aria-labelledby="mon-refusals">
          <h2 id="mon-refusals">Refusals by kind</h2>
          <div class="table-scroll"><table class="table mon-rank-table"><thead><tr><th>Kind</th><th>OWASP API</th><th class="num">Count</th><th><span class="sr-only">Share</span></th></tr></thead><tbody>${rows(a.refusals, maxR)}</tbody></table></div>
          <p class="muted small">OWASP API Security Top 10 (2023): API1 object-level access, API2 authentication, API4 resource use, API5 function-level access, API8 configuration, API9 inventory.</p>
        </section>
        <section class="card" aria-labelledby="mon-signin">
          <div class="card-head"><h2 id="mon-signin">Sign-in events</h2><a class="small" href="#/admin/audit?area=auth">Audit log ${icon('chevronRight', 14)}</a></div>
          <div class="table-scroll"><table class="table mon-rank-table"><thead><tr><th>Event</th><th>OWASP API</th><th class="num">Count</th><th><span class="sr-only">Share</span></th></tr></thead><tbody>${rows(a.signIn, maxS)}</tbody></table></div>
        </section>
      </div>
      <div class="cols">
        <section class="card" aria-labelledby="mon-controls">
          <div class="card-head"><h2 id="mon-controls">${icon('lock')} Controls in force</h2>${can('users.manage') ? html`<a class="small" href="#/admin/security">Sign-in & security ${icon('chevronRight', 14)}</a>` : ''}</div>
          <ul class="mon-list">${a.controls.map((c) => html`<li class="mon-check st-${c.state}">${state(c.state)}<span class="grow"><strong>${c.label}</strong><small>${c.detail}</small></span></li>`)}</ul>
        </section>
        <section class="card" aria-labelledby="mon-inventory">
          <h2 id="mon-inventory">${icon('code')} API inventory</h2>
          <p><strong>${n(inv.total)}</strong> API addresses: <strong>${inv.public.length}</strong> open without signing in, <strong>${n(inv.signedIn)}</strong> for anyone signed in, <strong>${n(inv.permission)}</strong> that need a permission. Each one also checks the record it is asked for.</p>
          <ul class="dash-list">${inv.byArea.map((x) => html`<li>${x.area}<span class="spacer"></span><strong>${n(x.n)}</strong></li>`)}</ul>
          <details class="mon-public"><summary>The ${inv.public.length} addresses open without signing in</summary><ul>${inv.public.map((r) => html`<li><code>${r}</code></li>`)}</ul></details>
        </section>
      </div>
      ${a.metrics ? metricsCard(a.metrics) : ''}`;
  }

  function metricsCard(m) {
    const origin = location.origin;
    return html`<section class="card" aria-labelledby="mon-metrics">
      <h2 id="mon-metrics">${icon('external')} Monitoring from another tool</h2>
      <p class="muted small">For an uptime checker (such as Uptime Kuma or an AWS load balancer) and a metrics server (Prometheus, then Grafana). Neither shows names or network addresses.</p>
      <dl class="info-grid">
        <div class="info"><dt>Health check</dt><dd><code>${origin}/api/public/health</code><small class="block muted">Answers {"status":"ok"} while CORE runs; needs no sign-in.</small></dd></div>
        <div class="info"><dt>Metrics</dt><dd><code>${origin}/api/admin/monitor/metrics</code><small class="block muted">Prometheus text format, with the token as <code>Authorization: Bearer</code>.</small></dd></div>
        <div class="info"><dt>Token</dt><dd>${m.token ? html`Made ${fmtDateTime(m.token.createdAt)} by ${m.token.createdBy}` : html`<span class="muted">None: metrics are off</span>`}</dd></div>
      </dl>
      ${token ? html`<div class="mon-token" role="status"><p><strong>Copy this token now.</strong> CORE keeps only a fingerprint of it and cannot show it again.</p><code class="mon-token-value">${token.token}</code><button type="button" class="btn small-btn" id="mon-token-copy">${icon('copy', 14)} Copy</button></div>` : ''}
      <div class="actions"><button type="button" class="btn" id="mon-token-new">${icon('key', 16)} ${m.token ? 'Replace the token' : 'Make a token'}</button>${m.token ? html`<button type="button" class="btn danger ghost" id="mon-token-revoke">${icon('x', 16)} Revoke</button>` : ''}</div>
    </section>`;
  }

  // ----- Traffic -----
  function trafficTab(v, pts) {
    const t = v.traffic;
    const st = t.totals.status;
    const maxS = Math.max(st[2], st[3], st[4], st[5]);
    const routeTable = (list, empty) => (list.length ? html`<div class="table-scroll"><table class="table"><thead><tr><th>Route</th><th class="num">Requests</th><th class="num">Errors</th><th class="num">p95</th></tr></thead>
      <tbody>${list.map((r) => html`<tr><td><code class="mon-route">${r.route}</code></td><td class="num">${n(r.n)}</td><td class="num">${r.errors ? html`<span class="bad-text">${n(r.errors)}</span>` : '0'}</td><td class="num">${ms(r.p95)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted small">${empty}</p>`);
    return html`
      <div class="stats">
        <div class="card"><small>Page views</small><strong>${n(t.totals.pages)}</strong><span class="muted small block">CORE opened or reloaded</span></div>
        <div class="card"><small>API response time</small><strong>${ms(t.latency.p95)}</strong><span class="muted small block">p95 · median ${ms(t.latency.p50)} · p99 ${ms(t.latency.p99)}</span></div>
        <div class="card"><small>Server errors</small><strong class="${st[5] ? 'bad-text' : ''}">${n(st[5])}</strong><span class="muted small block">${pctOf(st[5], t.totals.api)} of API requests</span></div>
        <div class="card"><small>Data sent</small><strong>${big(t.totals.out)}</strong><span class="muted small block">${t.totals.requests ? `${pctOf(t.totals.https, t.totals.requests)} over HTTPS` : ''}</span></div>
      </div>
      <div class="cols">
        <section class="card">${chart({ title: 'Requests', note: 'pages, files and API', points: pts('n') })}</section>
        <section class="card">${chart({ title: 'API response time, p95', note: 'ms; 95% of requests were this fast or faster', points: pts('p95'), kind: 'line', fmt: (x) => ms(x) })}</section>
      </div>
      <div class="cols">
        <section class="card" aria-labelledby="mon-busy"><h2 id="mon-busy">Busiest API routes</h2>${routeTable(t.topRoutes, 'No API requests in this period.')}</section>
        <section class="card" aria-labelledby="mon-slow"><h2 id="mon-slow">Slowest API routes</h2>${routeTable(t.slowRoutes, 'Routes show here after 5 requests.')}
          <h3 class="dash-sub">Answers by status</h3>
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
        <div class="card"><small>Active today</small><strong>${n(a.active.d1)}</strong><span class="muted small block">used CORE in the last 24 hours</span></div>
        <div class="card"><small>This week</small><strong>${n(a.active.d7)}</strong><span class="muted small block">last 7 days</span></div>
        <div class="card"><small>This month</small><strong>${n(a.active.d30)}</strong><span class="muted small block">last 30 days</span></div>
      </div>
      <div class="cols">
        <section class="card">${chart({ title: 'Sign-ins', points: pts('signIns'), empty: 'No sign-ins in this period.' })}</section>
        <section class="card">${chart({ title: 'Actions recorded', note: 'audit log entries: changes, views of personal data, exports', points: pts('actions') })}</section>
      </div>
      <section class="card" aria-labelledby="mon-live">
        <h2 id="mon-live">${icon('user')} Signed in now</h2>
        ${a.live.length ? html`<div class="table-scroll"><table class="table"><thead><tr><th>Person</th><th>Account type</th><th>Device</th><th>Network address</th><th>Signed in</th><th>Last active</th></tr></thead>
          <tbody>${a.live.map((s) => html`<tr><td><a href="#/people/${s.userId}">${s.name}</a></td><td>${s.role}</td><td>${s.device}</td><td class="mono">${s.ip}</td><td>${fmtDateTime(s.signedInAt)}</td><td>${timeAgo(s.lastSeenAt)}</td></tr>`)}</tbody></table></div>
          ${can('users.manage') ? html`<p class="muted small">To end someone's sessions: Users & Access → the person → Sign out everywhere.</p>` : ''}`
        : html`<p class="muted small">Nobody is signed in.</p>`}
      </section>
      <div class="cols">
        <section class="card" aria-labelledby="mon-areas">
          <h2 id="mon-areas">What people worked on</h2>
          ${a.byArea.length ? html`<table class="table mon-rank-table"><thead><tr><th>Area</th><th class="num">Actions</th><th><span class="sr-only">Share</span></th></tr></thead><tbody>${a.byArea.slice(0, 12).map((x) => html`<tr><td>${x.label}</td><td class="num">${n(x.n)}</td><td class="mon-bar">${rankBar(x.n, maxA)}</td></tr>`)}</tbody></table>` : html`<p class="muted small">Nothing recorded in this period.</p>`}
        </section>
        <section class="card" aria-labelledby="mon-people">
          <h2 id="mon-people">Most active</h2>
          ${a.topPeople.length ? html`<table class="table"><thead><tr><th>Person</th><th class="num">Actions</th><th class="num">Requests</th></tr></thead><tbody>${a.topPeople.map((x) => html`<tr><td><a href="#/people/${x.id}">${x.name}</a><small class="block muted">${x.role}</small></td><td class="num">${n(x.actions)}</td><td class="num">${n(x.requests)}</td></tr>`)}</tbody></table>` : html`<p class="muted small">Nobody in this period.</p>`}
        </section>
      </div>
      <section class="card" aria-labelledby="mon-signins">
        <div class="card-head"><h2 id="mon-signins">Recent sign-ins</h2>${can('audit.view') ? html`<a class="small" href="#/admin/audit?area=auth">Audit log ${icon('chevronRight', 14)}</a>` : ''}</div>
        ${a.signInLog.length ? html`<div class="table-scroll"><table class="table"><thead><tr><th>When</th><th>Who</th><th>Network address</th><th>Result</th></tr></thead>
          <tbody>${a.signInLog.map((e) => html`<tr><td>${fmtDateTime(e.at)}</td><td>${e.userId ? html`<a href="#/people/${e.userId}">${e.name}</a>` : html`<span class="mono">${e.name}</span>`}</td><td class="mono">${e.ip || '—'}</td><td>${badge(OUT[e.outcome][0], OUT[e.outcome][1])}${e.note && e.outcome !== 'signed-in' ? html` <small class="muted">${e.note}</small>` : ''}</td></tr>`)}</tbody></table></div>`
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
