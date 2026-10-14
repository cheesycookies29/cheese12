// IT Asset Management: overview, asset register, asset form and asset detail.
import { api } from '../api.js';
import { can } from '../state.js';
import { ASSET_STATUS, ASSET_CONDITIONS, ASSET_CATEGORIES, ASSIGNEE_TYPES } from '/shared/assets.js';
import { html, mount, money, fmtDate, badge, toast, modal, confirmDialog, downloadFile, toCsv, today, addDays } from '../ui.js';

const STATUS_BADGE = { in_stock: 'green', assigned: 'blue', in_repair: 'amber', retired: 'gray', lost: 'gray' };
export const statusBadge = (s) => badge(ASSET_STATUS[s] || s, STATUS_BADGE[s]);
export const holderLabel = (h) => (h ? html`${h.name}<small>${ASSIGNEE_TYPES[h.type]}${h.employeeNo ? ` · ${h.employeeNo}` : ''}${h.department ? ` · ${h.department}` : ''}</small>` : html`<span class="muted">—</span>`);
const WARRANTY_SOON_DAYS = 60;

export function warrantyState(asset) {
  if (!asset.warrantyEnd || ['retired', 'lost'].includes(asset.status)) return null;
  if (asset.warrantyEnd < today()) return 'expired';
  if (asset.warrantyEnd <= addDays(today(), WARRANTY_SOON_DAYS)) return 'soon';
  return 'ok';
}
const warrantyCell = (a) => {
  const w = warrantyState(a);
  if (!a.warrantyEnd) return html`<span class="muted">—</span>`;
  return html`${fmtDate(a.warrantyEnd)}${w === 'expired' ? html` ${badge('Expired', 'gray')}` : w === 'soon' ? html` ${badge('Expiring', 'amber')}` : ''}`;
};

export const ASSET_CSV = [
  ['Asset Tag', (a) => a.assetTag], ['Name', (a) => a.name], ['Category', (a) => a.category], ['Brand', (a) => a.brand], ['Model', (a) => a.model],
  ['Serial Number', (a) => a.serialNumber], ['Specifications', (a) => a.specs], ['Status', (a) => ASSET_STATUS[a.status]], ['Condition', (a) => a.condition],
  ['Assigned To', (a) => a.assignedTo?.name || ''], ['Holder Type', (a) => (a.assignedTo ? ASSIGNEE_TYPES[a.assignedTo.type] : '')],
  ['Employee No', (a) => a.assignedTo?.employeeNo || ''], ['Holder Department', (a) => a.assignedTo?.department || ''],
  ['Assigned On', (a) => a.assignedAt?.slice(0, 10) || ''], ['Expected Return', (a) => a.expectedReturn || ''], ['Location', (a) => a.location],
  ['Purchase Date', (a) => a.purchaseDate || ''], ['Purchase Cost (PHP)', (a) => a.purchaseCost ?? ''], ['Supplier', (a) => a.supplier],
  ['Warranty End', (a) => a.warrantyEnd || ''], ['Notes', (a) => a.notes],
];
export const exportAssets = (list, name = 'it-assets') => downloadFile(`${name}-${today()}.csv`, toCsv([ASSET_CSV.map((c) => c[0]), ...list.map((a) => ASSET_CSV.map(([, f]) => f(a)))]));

// ---------- Overview ----------

export async function assetsDashboardView(el) {
  const [assets, items, history] = await Promise.all([api.get('/api/assets'), api.get('/api/inventory'), api.get('/api/asset-history')]);
  const active = assets.filter((a) => !['retired', 'lost'].includes(a.status));
  const count = (s) => assets.filter((a) => a.status === s).length;
  const value = active.reduce((sum, a) => sum + (a.purchaseCost || 0), 0);
  const expiring = active.filter((a) => warrantyState(a) === 'soon').sort((a, b) => a.warrantyEnd.localeCompare(b.warrantyEnd));
  const low = items.filter((i) => i.quantity <= i.reorderLevel);
  const overdue = assets.filter((a) => a.status === 'assigned' && a.expectedReturn && a.expectedReturn < today());
  const byCategory = Object.entries(active.reduce((m, a) => ((m[a.category] = m[a.category] || { total: 0, assigned: 0 }), m[a.category].total++, a.status === 'assigned' && m[a.category].assigned++, m), {}))
    .sort((a, b) => b[1].total - a[1].total);
  const maxCat = Math.max(1, ...byCategory.map(([, v]) => v.total));

  mount(el, html`
    <header class="page-head">
      <div><h1>IT Asset Management</h1><p class="muted">Equipment and consumable stock, who holds it and where it is.</p></div>
      <div class="actions">${can('assets.edit') ? html`<a class="btn" href="#/assets/inventory">Inventory</a><a class="btn primary" href="#/assets/new">+ Register asset</a>` : ''}</div>
    </header>
    <div class="stats">
      <a class="card" href="#/assets/list"><small>Assets in service</small><strong>${active.length}</strong></a>
      <a class="card" href="#/assets/list?status=assigned"><small>Assigned</small><strong>${count('assigned')}</strong></a>
      <a class="card" href="#/assets/list?status=in_stock"><small>Available in stock</small><strong>${count('in_stock')}</strong></a>
      <a class="card" href="#/assets/list?status=in_repair"><small>In repair</small><strong>${count('in_repair')}</strong></a>
      <a class="card ${low.length ? 'attention' : ''}" href="#/assets/inventory?low=1"><small>Low-stock items</small><strong>${low.length}</strong></a>
      <div class="card accent wide-figure"><small>Asset value (cost)</small><strong>${money(value)}</strong></div>
    </div>
    <div class="cols wide-left">
      <section class="card">
        <h2>Assets by category</h2>
        ${byCategory.length
          ? html`<ul class="bars stacked">${byCategory.map(([name, v]) => html`<li>
              <span>${name}</span>
              <div class="bar" title="${v.assigned} assigned of ${v.total}"><i style="width:${Math.round((v.total / maxCat) * 100)}%"><b style="width:${Math.round((v.assigned / v.total) * 100)}%"></b></i></div>
              <em>${v.assigned}/${v.total}</em></li>`)}</ul>
            <p class="muted small"><span class="key key-assigned"></span>assigned <span class="key key-free"></span>in stock or in repair</p>`
          : html`<p class="muted">No assets registered yet.</p>`}
      </section>
      <section class="card">
        <h2>Needs attention</h2>
        ${!expiring.length && !low.length && !overdue.length ? html`<p class="muted">Nothing needs attention right now.</p>` : ''}
        ${overdue.length ? html`<h3>Overdue returns</h3><ul class="link-list">${overdue.map((a) => html`<li><a href="#/assets/item/${a.id}">${a.assetTag}</a> ${a.name}<small class="muted"> · ${a.assignedTo.name}, due ${fmtDate(a.expectedReturn)}</small></li>`)}</ul>` : ''}
        ${low.length ? html`<h3>Low stock</h3><ul class="link-list">${low.map((i) => html`<li><a href="#/assets/inventory/${i.id}">${i.name}</a> <small class="muted">· ${i.quantity} ${i.unit} left, reorder at ${i.reorderLevel}</small></li>`)}</ul>` : ''}
        ${expiring.length ? html`<h3>Warranty ending within ${WARRANTY_SOON_DAYS} days</h3><ul class="link-list">${expiring.map((a) => html`<li><a href="#/assets/item/${a.id}">${a.assetTag}</a> ${a.name}<small class="muted"> · ${fmtDate(a.warrantyEnd)}</small></li>`)}</ul>` : ''}
      </section>
    </div>
    <section class="card">
      <h2>Recent activity</h2>
      ${history.length
        ? html`<ul class="timeline">${history.slice(0, 8).map((h) => html`<li class="ev-${h.action}">
            <time>${new Date(h.at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
            <div><a href="#/assets/item/${h.assetId}">${h.assetTag}</a> ${h.assetName}<span>${h.detail}${h.by ? ` · by ${h.by}` : ''}</span></div></li>`)}</ul>
          <a href="#/assets/activity">Full activity log →</a>`
        : html`<p class="muted">No activity yet.</p>`}
    </section>`);
}

// ---------- Register (list) ----------

export async function assetListView(el, _params, query) {
  const assets = await api.get('/api/assets');
  const categories = [...new Set(assets.map((a) => a.category))].sort();
  const state = { q: query.q || '', status: query.status || '', category: query.category || '', holder: '' };

  const rows = () => {
    const q = state.q.toLowerCase();
    return assets
      .filter((a) => (!state.status ? a.status !== 'retired' && a.status !== 'lost' : state.status === 'all' || a.status === state.status))
      .filter((a) => !state.category || a.category === state.category)
      .filter((a) => !state.holder || a.assignedTo?.type === state.holder)
      .filter((a) => !q || [a.assetTag, a.name, a.serialNumber, a.model, a.assignedTo?.name, a.location].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.assetTag.localeCompare(b.assetTag));
  };

  function render() {
    const list = rows();
    mount(el.querySelector('#asset-table'), list.length
      ? html`<table class="table clickable">
          <thead><tr><th>Tag</th><th>Asset</th><th>Category</th><th>Status</th><th>Assigned to</th><th>Location</th><th>Warranty</th><th class="num">Cost</th></tr></thead>
          <tbody>${list.map((a) => html`<tr data-href="#/assets/item/${a.id}">
            <td><strong class="mono">${a.assetTag}</strong></td>
            <td><strong>${a.name}</strong><small>${a.serialNumber ? `S/N ${a.serialNumber}` : ''}</small></td>
            <td>${a.category}</td>
            <td>${statusBadge(a.status)}</td>
            <td>${holderLabel(a.assignedTo)}</td>
            <td>${a.location || html`<span class="muted">—</span>`}</td>
            <td>${warrantyCell(a)}</td>
            <td class="num">${a.purchaseCost != null ? money(a.purchaseCost) : '—'}</td>
          </tr>`)}</tbody>
        </table>`
      : html`<div class="empty"><p>No assets match.</p></div>`);
    el.querySelector('#count').textContent = `${list.length} shown · ${assets.length} registered`;
  }

  mount(el, html`
    <header class="page-head">
      <div><h1>Assets</h1><p class="muted" id="count"></p></div>
      <div class="actions"><button class="btn" id="export">Export CSV</button>${can('assets.edit') ? html`<a class="btn primary" href="#/assets/new">+ Register asset</a>` : ''}</div>
    </header>
    <section class="card">
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search tag, name, serial, holder…" value="${state.q}" />
        <select id="f-status">
          <option value="">In service</option>
          ${Object.entries(ASSET_STATUS).map(([k, v]) => html`<option value="${k}" ${state.status === k ? 'selected' : ''}>${v}</option>`)}
          <option value="all" ${state.status === 'all' ? 'selected' : ''}>All, incl. retired and lost</option>
        </select>
        <select id="f-cat"><option value="">All categories</option>${categories.map((c) => html`<option ${state.category === c ? 'selected' : ''}>${c}</option>`)}</select>
        <select id="f-holder"><option value="">Any holder</option>${Object.entries(ASSIGNEE_TYPES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
      </div>
      <div id="asset-table"></div>
    </section>`);

  render();
  const on = (sel, key, ev = 'change') => el.querySelector(sel).addEventListener(ev, (e) => ((state[key] = e.target.value), render()));
  on('#q', 'q', 'input');
  on('#f-status', 'status');
  on('#f-cat', 'category');
  on('#f-holder', 'holder');
  el.querySelector('#asset-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
  el.querySelector('#export').addEventListener('click', () => exportAssets(rows()));
}

// ---------- Form ----------

const datalist = (id, values) => html`<datalist id="${id}">${values.map((v) => html`<option value="${v}"></option>`)}</datalist>`;

export async function assetFormView(el, { id }) {
  const isNew = !id;
  const [meta, asset] = await Promise.all([api.get('/api/asset-meta'), isNew ? {} : api.get(`/api/assets/${id}`)]);
  const a = { condition: 'New', location: 'IT Store Room', ...asset };
  const f = (label, name, opts = {}) => html`<label class="field ${opts.span ? `span-${opts.span}` : ''}"><span>${label}${opts.required ? html`<em>*</em>` : ''}</span>
    <input name="${name}" type="${opts.type || 'text'}" value="${a[name] ?? ''}" list="${opts.list || ''}" placeholder="${opts.placeholder || ''}" ${opts.type === 'number' ? 'min=0 step=0.01' : ''} />
    ${opts.hint ? html`<small class="muted">${opts.hint}</small>` : ''}</label>`;

  mount(el, html`
    <header class="page-head"><div><a class="back" href="${isNew ? '#/assets/list' : `#/assets/item/${id}`}">← Back</a><h1>${isNew ? 'Register asset' : `Edit ${a.assetTag}`}</h1></div></header>
    <form id="asset-form" class="stack" novalidate>
      <section class="card">
        <h2>Identification</h2>
        <div class="grid">
          <label class="field"><span>Asset tag</span><input name="assetTag" value="${a.assetTag || ''}" placeholder="${meta.nextAssetTag}" /><small class="muted">Leave blank to use ${meta.nextAssetTag}.</small></label>
          ${f('Name', 'name', { required: true, placeholder: 'e.g. Dell Latitude 7440' })}
          ${f('Category', 'category', { required: true, list: 'dl-cat' })}
          ${f('Brand', 'brand')}
          ${f('Model', 'model')}
          ${f('Serial number', 'serialNumber')}
          <label class="field span-3"><span>Specifications</span><textarea name="specs" rows="2" placeholder="CPU, memory, storage, size…">${a.specs || ''}</textarea></label>
        </div>
      </section>
      <section class="card">
        <h2>Purchase, warranty and location</h2>
        <div class="grid">
          ${f('Purchase date', 'purchaseDate', { type: 'date' })}
          ${f('Purchase cost (₱)', 'purchaseCost', { type: 'number' })}
          ${f('Supplier', 'supplier', { list: 'dl-sup' })}
          ${f('Warranty ends', 'warrantyEnd', { type: 'date' })}
          <label class="field"><span>Condition</span><select name="condition">${ASSET_CONDITIONS.map((c) => html`<option ${a.condition === c ? 'selected' : ''}>${c}</option>`)}</select></label>
          ${f('Storage location', 'location', { list: 'dl-loc', hint: 'Where it is kept when not assigned.' })}
          <label class="field span-3"><span>Notes</span><textarea name="notes" rows="2">${a.notes || ''}</textarea></label>
        </div>
      </section>
      ${datalist('dl-cat', [...new Set([...ASSET_CATEGORIES, ...meta.assetCategories])])}${datalist('dl-sup', meta.suppliers)}${datalist('dl-loc', meta.locations)}
      <p class="form-error" hidden></p>
      <div class="actions end"><a class="btn" href="${isNew ? '#/assets/list' : `#/assets/item/${id}`}">Cancel</a><button class="btn primary" type="submit">${isNew ? 'Register asset' : 'Save changes'}</button></div>
    </form>`);

  const form = el.querySelector('#asset-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(form));
      const saved = isNew ? await api.post('/api/assets', body) : await api.put(`/api/assets/${id}`, body);
      toast(isNew ? `Registered ${saved.assetTag}.` : 'Changes saved.');
      location.hash = `#/assets/item/${saved.id}`;
    } catch (err) {
      const errEl = form.querySelector('.form-error');
      errEl.textContent = err.message;
      errEl.hidden = false;
      errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

// ---------- Assign / return / status dialogs (shared with other screens) ----------

export function assigneeFields(meta, { label = 'Allocate to' } = {}) {
  return html`
    <label class="field span-2"><span>${label}</span>
      <div class="seg" role="radiogroup">${Object.entries(ASSIGNEE_TYPES).map(([k, v], i) => html`<label><input type="radio" name="type" value="${k}" ${i === 0 ? 'checked' : ''} /> ${v}</label>`)}</div>
    </label>
    <label class="field span-2 who who-employee"><span>Employee</span>
      <select name="employeeId"><option value="">Select…</option>${meta.employees.map((e) => html`<option value="${e.id}">${e.name} · ${e.employeeNo}${e.department ? ` · ${e.department}` : ''}</option>`)}</select></label>
    <label class="field span-2 who who-department" hidden><span>Department</span><input name="department" list="dl-dept" placeholder="e.g. Engineering" /></label>
    <label class="field span-2 who who-location" hidden><span>Location</span><input name="location" list="dl-loc2" placeholder="e.g. Boardroom" /></label>
    ${datalist('dl-dept', meta.departments)}${datalist('dl-loc2', meta.locations)}`;
}

export function wireAssignee(form) {
  const sync = () => {
    const type = form.querySelector('[name=type]:checked').value;
    form.querySelectorAll('.who').forEach((n) => (n.hidden = !n.classList.contains(`who-${type}`)));
  };
  form.querySelectorAll('[name=type]').forEach((r) => r.addEventListener('change', sync));
  sync();
}

export function readAssignee(fd) {
  const type = fd.get('type');
  return { type, employeeId: fd.get('employeeId'), name: type === 'department' ? fd.get('department') : fd.get('location') };
}

async function openAssign(asset, onDone) {
  const meta = await api.get('/api/asset-meta');
  const { form } = modal({
    title: `${asset.status === 'assigned' ? 'Transfer' : 'Assign'} ${asset.assetTag}`,
    submitLabel: asset.status === 'assigned' ? 'Transfer' : 'Assign',
    body: html`<p class="muted small">${asset.name}${asset.assignedTo ? html` · currently with <strong>${asset.assignedTo.name}</strong>` : ''}</p>
      <div class="grid two">
        ${assigneeFields(meta)}
        <label class="field"><span>Expected return (optional)</span><input type="date" name="expectedReturn" /></label>
        <label class="field span-2"><span>Notes</span><input name="notes" placeholder="e.g. new hire kit, ticket number" /></label>
      </div>`,
    onSubmit: async (f) => {
      const fd = new FormData(f);
      await api.post(`/api/assets/${asset.id}/assign`, { ...readAssignee(fd), expectedReturn: fd.get('expectedReturn'), notes: fd.get('notes') });
      toast(`${asset.assetTag} ${asset.status === 'assigned' ? 'transferred' : 'assigned'}.`);
      onDone();
    },
  });
  wireAssignee(form);
}

function openReturn(asset, onDone) {
  modal({
    title: `Return ${asset.assetTag}`,
    submitLabel: 'Record return',
    body: html`<p class="muted small">${asset.name} · from <strong>${asset.assignedTo.name}</strong></p>
      <div class="grid two">
        <label class="field"><span>Put back as</span><select name="status"><option value="in_stock">In stock (ready to reassign)</option><option value="in_repair">In repair</option></select></label>
        <label class="field"><span>Condition</span><select name="condition">${ASSET_CONDITIONS.map((c) => html`<option ${asset.condition === c ? 'selected' : ''}>${c}</option>`)}</select></label>
        <label class="field span-2"><span>Store at</span><input name="location" value="${asset.location || ''}" /></label>
        <label class="field span-2"><span>Notes</span><input name="notes" placeholder="e.g. missing charger, screen scratched" /></label>
      </div>`,
    onSubmit: async (f) => {
      await api.post(`/api/assets/${asset.id}/return`, Object.fromEntries(new FormData(f)));
      toast(`${asset.assetTag} returned.`);
      onDone();
    },
  });
}

function openStatus(asset, onDone) {
  const options = ['in_stock', 'in_repair', 'retired', 'lost'].filter((s) => s !== asset.status && (asset.status !== 'assigned' || ['retired', 'lost'].includes(s)));
  modal({
    title: `Change status of ${asset.assetTag}`,
    submitLabel: 'Change status',
    body: html`<div class="grid two">
      <label class="field span-2"><span>New status</span><select name="status">${options.map((s) => html`<option value="${s}">${ASSET_STATUS[s]}</option>`)}</select>
      ${asset.status === 'assigned' ? html`<small class="muted">To take it back normally, use Return instead. Retired or lost ends the current assignment.</small>` : ''}</label>
      <label class="field span-2"><span>Notes</span><input name="notes" placeholder="e.g. disposal reference, incident report no." /></label>
    </div>`,
    onSubmit: async (f) => {
      await api.post(`/api/assets/${asset.id}/status`, Object.fromEntries(new FormData(f)));
      toast('Status updated.');
      onDone();
    },
  });
}

// ---------- Detail ----------

const ACTION_LABEL = { created: 'Registered', edited: 'Edited', assigned: 'Assigned', transferred: 'Transferred', returned: 'Returned', status: 'Status change' };

export async function assetDetailView(el, { id }) {
  const a = await api.get(`/api/assets/${id}`);
  const edit = can('assets.edit');
  const reload = () => assetDetailView(el, { id });
  const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || html`<span class="muted">—</span>`}</dd></div>`;
  const w = warrantyState(a);

  mount(el, html`
    <header class="page-head">
      <div><a class="back" href="#/assets/list">← Assets</a>
        <p class="tag-line mono">${a.assetTag}</p>
        <h1>${a.name} ${statusBadge(a.status)}</h1>
        <p class="muted">${a.category}${a.serialNumber ? ` · S/N ${a.serialNumber}` : ''}</p></div>
      <div class="actions">
        ${edit && ['in_stock', 'assigned'].includes(a.status) ? html`<button class="btn primary" id="assign">${a.status === 'assigned' ? 'Transfer' : 'Assign'}</button>` : ''}
        ${edit && a.status === 'assigned' ? html`<button class="btn" id="return">Return</button>` : ''}
        ${edit ? html`<button class="btn" id="status">Change status</button><a class="btn" href="#/assets/item/${a.id}/edit">Edit</a>` : ''}
      </div>
    </header>
    <div class="cols">
      <section class="card holder-card ${a.assignedTo ? 'held' : ''}">
        <h2>Current holder</h2>
        ${a.assignedTo
          ? html`<p class="holder-name">${a.assignedTo.name}</p>
              <p class="muted">${ASSIGNEE_TYPES[a.assignedTo.type]}${a.assignedTo.employeeNo ? ` · ${a.assignedTo.employeeNo}` : ''}${a.assignedTo.department ? ` · ${a.assignedTo.department}` : ''}</p>
              <dl class="info-grid">${info('Since', fmtDate(a.assignedAt?.slice(0, 10)))}${info('Expected return', a.expectedReturn ? html`${fmtDate(a.expectedReturn)}${a.expectedReturn < today() ? html` ${badge('Overdue', 'amber')}` : ''}` : 'Open-ended')}</dl>`
          : html`<p class="holder-name muted">Not assigned</p><p class="muted">${ASSET_STATUS[a.status]}${a.location ? ` · stored at ${a.location}` : ''}</p>`}
      </section>
      <section class="card"><h2>Details</h2><dl class="info-grid">
        ${info('Brand', a.brand)}${info('Model', a.model)}${info('Condition', a.condition)}${info('Storage location', a.location)}
        ${info('Specifications', a.specs)}${info('Notes', a.notes)}
      </dl></section>
      <section class="card"><h2>Purchase &amp; warranty</h2><dl class="info-grid">
        ${info('Purchase date', fmtDate(a.purchaseDate))}${info('Cost', a.purchaseCost != null ? money(a.purchaseCost) : '')}${info('Supplier', a.supplier)}
        ${info('Warranty ends', a.warrantyEnd ? html`${fmtDate(a.warrantyEnd)}${w === 'expired' ? html` ${badge('Expired', 'gray')}` : w === 'soon' ? html` ${badge('Expiring soon', 'amber')}` : ''}` : '')}
      </dl></section>
    </div>
    <section class="card">
      <div class="card-head"><h2>History</h2><button class="btn small-btn" id="export-history">Export CSV</button></div>
      <ul class="timeline">${a.history.map((h) => html`<li class="ev-${h.action}">
        <time>${new Date(h.at).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
        <div><strong>${ACTION_LABEL[h.action] || h.action}</strong><span>${h.detail}${h.by ? ` · by ${h.by}` : ''}</span>${h.notes ? html`<em>“${h.notes}”</em>` : ''}</div>
      </li>`)}</ul>
    </section>
    ${edit && a.status !== 'assigned' ? html`<div class="danger-zone"><button class="btn danger ghost" id="delete">Delete asset</button><small class="muted">Deleting removes its history too. Prefer Retired for disposed equipment.</small></div>` : ''}`);

  el.querySelector('#assign')?.addEventListener('click', () => openAssign(a, reload));
  el.querySelector('#return')?.addEventListener('click', () => openReturn(a, reload));
  el.querySelector('#status')?.addEventListener('click', () => openStatus(a, reload));
  el.querySelector('#export-history').addEventListener('click', () =>
    downloadFile(`${a.assetTag}-history-${today()}.csv`, toCsv([
      ['Date', 'Asset Tag', 'Asset', 'Event', 'Detail', 'By', 'Notes'],
      ...a.history.map((h) => [h.at.replace('T', ' ').slice(0, 16), h.assetTag, h.assetName, ACTION_LABEL[h.action] || h.action, h.detail, h.by, h.notes || '']),
    ])),
  );
  el.querySelector('#delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete ${a.assetTag} (${a.name}) and its history? This cannot be undone.`))) return;
    await api.del(`/api/assets/${a.id}`);
    toast('Asset deleted.');
    location.hash = '#/assets/list';
  });
}
