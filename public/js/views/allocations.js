// Allocations by holder, the combined activity log, and the employee's own equipment.
import { api } from '../api.js';
import { ASSIGNEE_TYPES, ASSET_STATUS, ISSUE_TYPES, ISSUE_STATUS, ACTIVE_ISSUE } from '/shared/assets.js';
import { html, mount, fmtDate, badge, downloadFile, toCsv, today, addDays } from '../ui.js';
import { statusBadge, issueStatusBadge } from './assets.js';
import { openReportProblem, reportTimeline } from './reports.js';

const when = (iso) => new Date(iso).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const holderKey = (h) => `${h.type}:${h.id || h.name.toLowerCase()}`;

// ---------- Allocations ----------

export async function allocationsView(el) {
  const [assets, moves] = await Promise.all([api.get('/api/assets'), api.get('/api/stock-movements')]);
  const holders = new Map();
  const holder = (h) => {
    const key = holderKey(h);
    if (!holders.has(key)) holders.set(key, { ...h, assets: [], items: new Map() });
    return holders.get(key);
  };
  for (const a of assets.filter((x) => x.status === 'assigned' && x.assignedTo)) holder(a.assignedTo).assets.push(a);
  for (const m of moves.filter((x) => x.type === 'out' && x.issuedTo)) {
    const h = holder(m.issuedTo);
    const agg = h.items.get(m.itemId) || { sku: m.sku, name: m.itemName, unit: m.unit, qty: 0, last: m.at };
    agg.qty += -m.quantity;
    if (m.at > agg.last) agg.last = m.at;
    h.items.set(m.itemId, agg);
  }
  const all = [...holders.values()].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  const state = { type: '', q: '' };

  const rows = () => {
    const q = state.q.toLowerCase();
    return all.filter((h) => (!state.type || h.type === state.type) && (!q || [h.name, h.employeeNo, h.department, ...h.assets.map((a) => `${a.assetTag} ${a.name}`)].join(' ').toLowerCase().includes(q)));
  };

  function render() {
    const list = rows();
    mount(el.querySelector('#holders'), list.length
      ? list.map((h) => html`<section class="card holder">
          <header><div><span class="badge ${h.type === 'employee' ? 'blue' : 'gray'}">${ASSIGNEE_TYPES[h.type]}</span>
            <h2>${h.name}</h2><p class="muted small">${[h.employeeNo, h.department].filter(Boolean).join(' · ')}</p></div>
            <div class="holder-count"><strong>${h.assets.length}</strong><span>asset${h.assets.length === 1 ? '' : 's'}</span></div></header>
          ${h.assets.length
            ? html`<table class="table compact"><thead><tr><th>Tag</th><th>Asset</th><th>Category</th><th>Since</th><th>Return by</th></tr></thead>
                <tbody>${h.assets.map((a) => html`<tr><td><a class="mono" href="#/assets/item/${a.id}">${a.assetTag}</a></td><td>${a.name}</td><td>${a.category}</td>
                  <td>${fmtDate(a.assignedAt?.slice(0, 10))}</td><td>${a.expectedReturn ? html`${fmtDate(a.expectedReturn)}${a.expectedReturn < today() ? html` ${badge('Overdue', 'amber')}` : ''}` : html`<span class="muted">—</span>`}</td></tr>`)}</tbody></table>`
            : ''}
          ${h.items.size
            ? html`<p class="consumed"><span class="muted small">Consumables issued:</span> ${[...h.items.values()].map((i) => html`<span class="chip">${i.qty} ${i.unit} · ${i.name}</span>`)}</p>`
            : ''}
        </section>`)
      : html`<div class="card empty"><p>No allocations match.</p></div>`);
  }

  mount(el, html`
    <header class="page-head">
      <div><h1>Allocations</h1><p class="muted">Who and where every assigned asset and issued consumable is: ${all.length} holders.</p></div>
      <div class="actions"><button class="btn" id="export">Export CSV</button></div>
    </header>
    <section class="card"><div class="toolbar">
      <input type="search" id="q" placeholder="Search holder, tag or asset…" />
      <select id="f-type"><option value="">All holders</option>${Object.entries(ASSIGNEE_TYPES).map(([k, v]) => html`<option value="${k}">${v}s</option>`)}</select>
    </div></section>
    <div id="holders" class="holders"></div>`);

  render();
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value), render()));
  el.querySelector('#f-type').addEventListener('change', (e) => ((state.type = e.target.value), render()));
  el.querySelector('#export').addEventListener('click', () => {
    const out = [['Holder Type', 'Holder', 'Employee No', 'Department', 'Kind', 'Tag / SKU', 'Item', 'Category', 'Quantity', 'Since / Last Issued', 'Expected Return']];
    for (const h of rows()) {
      for (const a of h.assets) out.push([ASSIGNEE_TYPES[h.type], h.name, h.employeeNo || '', h.department || '', 'Asset', a.assetTag, a.name, a.category, 1, a.assignedAt?.slice(0, 10) || '', a.expectedReturn || '']);
      for (const i of h.items.values()) out.push([ASSIGNEE_TYPES[h.type], h.name, h.employeeNo || '', h.department || '', 'Consumable', i.sku, i.name, '', i.qty, i.last.slice(0, 10), '']);
    }
    downloadFile(`allocations-${today()}.csv`, toCsv(out));
  });
}

// ---------- Activity log ----------

const ASSET_EVENT = { created: 'Registered', edited: 'Edited', assigned: 'Assigned', transferred: 'Transferred', returned: 'Returned', status: 'Status change', issue: 'Problem report' };
const STOCK_EVENT = { in: 'Stock received', out: 'Stock issued', adjust: 'Stock count' };

export async function activityView(el) {
  const state = { from: addDays(today(), -30), to: today(), kind: '' };

  async function load() {
    const qs = `from=${state.from}&to=${state.to}`;
    const [history, moves] = await Promise.all([api.get(`/api/asset-history?${qs}`), api.get(`/api/stock-movements?${qs}`)]);
    const events = [
      ...history.map((h) => ({ at: h.at, kind: 'asset', event: ASSET_EVENT[h.action] || h.action, ref: h.assetTag, item: h.assetName, link: `#/assets/item/${h.assetId}`, detail: h.detail, qty: '', by: h.by, notes: h.notes || '' })),
      ...moves.map((m) => ({ at: m.at, kind: 'stock', event: STOCK_EVENT[m.type], ref: m.sku, item: m.itemName, link: `#/assets/inventory/${m.itemId}`,
        detail: m.issuedTo ? `To ${m.issuedTo.name}` : m.reference, qty: `${m.quantity > 0 ? '+' : ''}${m.quantity} ${m.unit}`, by: m.by, notes: [m.reference, m.notes].filter(Boolean).join(' · ') })),
    ].filter((e) => !state.kind || e.kind === state.kind).sort((a, b) => b.at.localeCompare(a.at));

    mount(el.querySelector('#log'), events.length
      ? html`<table class="table">
          <thead><tr><th>When</th><th>Event</th><th>Tag / SKU</th><th>Item</th><th>Detail</th><th class="num">Qty</th><th>By</th></tr></thead>
          <tbody>${events.map((e) => html`<tr>
            <td>${when(e.at)}</td><td>${badge(e.event, e.kind === 'asset' ? 'blue' : 'gray')}</td>
            <td><a class="mono" href="${e.link}">${e.ref}</a></td><td>${e.item}</td><td>${e.detail}${e.notes && e.kind === 'asset' ? html`<small>${e.notes}</small>` : ''}</td>
            <td class="num">${e.qty}</td><td>${e.by}</td></tr>`)}</tbody>
        </table>`
      : html`<div class="empty"><p>No activity in this range.</p></div>`);
    el.querySelector('#export').onclick = () =>
      downloadFile(`asset-activity-${state.from}-to-${state.to}.csv`, toCsv([
        ['Date', 'Area', 'Event', 'Tag / SKU', 'Item', 'Detail', 'Quantity', 'By', 'Notes'],
        ...events.map((e) => [e.at.replace('T', ' ').slice(0, 16), e.kind === 'asset' ? 'Asset' : 'Inventory', e.event, e.ref, e.item, e.detail, e.qty, e.by, e.notes]),
      ]));
  }

  mount(el, html`
    <header class="page-head">
      <div><h1>Activity log</h1><p class="muted">Every registration, assignment, return, status change, problem report and stock movement.</p></div>
      <div class="actions"><button class="btn" id="export">Export CSV</button></div>
    </header>
    <section class="card scroll-x">
      <div class="toolbar pad">
        <label class="inline">From <input type="date" id="f-from" value="${state.from}" /></label>
        <label class="inline">To <input type="date" id="f-to" value="${state.to}" /></label>
        <select id="f-kind"><option value="">Assets and inventory</option><option value="asset">Assets only</option><option value="stock">Inventory only</option></select>
      </div>
      <div id="log"></div>
    </section>`);
  for (const [sel, key] of [['#f-from', 'from'], ['#f-to', 'to'], ['#f-kind', 'kind']]) {
    el.querySelector(sel).addEventListener('change', (e) => ((state[key] = e.target.value), load()));
  }
  await load();
}

// ---------- My assets (self-service) ----------

export async function myAssetsView(el) {
  const { assets, issued, reports } = await api.get('/api/me/assets');
  const activeFor = (a) => reports.find((r) => r.assetId === a.id && ACTIVE_ISSUE.includes(r.status));
  const reload = () => myAssetsView(el);
  mount(el, html`
    <header class="page-head">
      <div><h1>My Assets</h1><p class="muted">Company equipment assigned to you. If something stops working, gets damaged or goes missing, report it here so IT can check it.</p></div>
      <div class="actions"><button class="btn" id="export">Export CSV</button></div>
    </header>
    ${assets.length
      ? html`<div class="asset-cards">${assets.map((a) => {
          const open = activeFor(a);
          return html`<article class="card asset-card">
            <p class="tag-line mono">${a.assetTag}</p><h2>${a.name}</h2>
            <p class="muted">${a.category}${a.serialNumber ? ` · S/N ${a.serialNumber}` : ''}</p>
            <dl class="info-grid">
              <div class="info"><dt>Since</dt><dd>${fmtDate(a.assignedAt?.slice(0, 10))}</dd></div>
              <div class="info"><dt>Return by</dt><dd>${a.expectedReturn ? fmtDate(a.expectedReturn) : 'No end date'}</dd></div>
              <div class="info"><dt>Condition</dt><dd>${a.condition}</dd></div>
              <div class="info"><dt>Status</dt><dd>${statusBadge(a.status)}</dd></div>
            </dl>
            ${a.specs ? html`<p class="small muted">${a.specs}</p>` : ''}
            <footer class="asset-card-foot">${open
              ? html`<button type="button" class="link report-flag" data-scroll="report-${open.id}">${issueStatusBadge(open.status)} Problem reported · ${open.number}</button>`
              : html`<button class="btn small-btn" data-report="${a.id}">Report a problem</button>`}</footer>
          </article>`;
        })}</div>`
      : html`<section class="card empty"><p>No equipment is assigned to you.</p></section>`}
    <section class="card">
      <h2>My problem reports</h2>
      ${reports.length
        ? html`<div class="my-reports">${reports.map((r) => html`<article class="my-report" id="report-${r.id}">
            <header><div><strong>${r.number}</strong> · ${ISSUE_TYPES[r.type]} · <span class="mono">${r.assetTag}</span> ${r.assetName}</div>${issueStatusBadge(r.status)}</header>
            <p class="report-text">${r.description}</p>
            ${reportTimeline(r)}
          </article>`)}</div>`
        : html`<p class="muted">You haven't reported any problems.</p>`}
    </section>
    <section class="card">
      <h2>Supplies issued to you</h2>
      ${issued.length
        ? html`<table class="table compact"><thead><tr><th>Date</th><th>Item</th><th class="num">Qty</th><th>Reference</th></tr></thead>
            <tbody>${issued.map((m) => html`<tr><td>${fmtDate(m.at.slice(0, 10))}</td><td>${m.itemName}</td><td class="num">${-m.quantity} ${m.unit}</td><td>${m.reference}</td></tr>`)}</tbody></table>`
        : html`<p class="muted">None yet.</p>`}
    </section>`);
  // Hash links would trigger the router, so jump to the report by script.
  el.querySelectorAll('[data-scroll]').forEach((b) => b.addEventListener('click', () => document.getElementById(b.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  el.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () => openReportProblem(assets.find((a) => a.id === b.dataset.report), reload)));
  el.querySelector('#export').addEventListener('click', () => {
    downloadFile(`my-assets-${today()}.csv`, toCsv([
      ['Kind', 'Tag / SKU', 'Item', 'Category', 'Serial Number', 'Quantity', 'Since / Date', 'Status'],
      ...assets.map((a) => ['Asset', a.assetTag, a.name, a.category, a.serialNumber, 1, a.assignedAt?.slice(0, 10) || '', ASSET_STATUS[a.status]]),
      ...issued.map((m) => ['Consumable', m.sku, m.itemName, '', '', -m.quantity, m.at.slice(0, 10), 'Issued']),
      ...reports.map((r) => ['Problem report', r.number, `${r.assetTag} ${r.assetName}`, ISSUE_TYPES[r.type], r.serialNumber, '', r.reportedAt.slice(0, 10), ISSUE_STATUS[r.status]]),
    ]));
  });
}
