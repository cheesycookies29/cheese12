// Consumable inventory: stock list, receive / issue / count, movement history.
import { api } from '../api.js';
import { can } from '../state.js';
import { ITEM_CATEGORIES, ASSIGNEE_TYPES } from '/shared/assets.js';
import { html, mount, money, badge, toast, modal, confirmDialog, downloadFile, toCsv, today } from '../ui.js';
import { assigneeFields, wireAssignee, readAssignee } from './assets.js';

const MOVE_LABEL = { in: 'Received', out: 'Issued', adjust: 'Count adjustment' };
const isLow = (i) => i.quantity <= i.reorderLevel;
const stockBadge = (i) => (i.quantity === 0 ? badge('Out of stock', 'gray') : isLow(i) ? badge('Low', 'amber') : '');
const when = (iso) => new Date(iso).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const MOVEMENT_CSV = [
  ['Date', (m) => m.at.replace('T', ' ').slice(0, 16)], ['SKU', (m) => m.sku], ['Item', (m) => m.itemName], ['Movement', (m) => MOVE_LABEL[m.type]],
  ['Quantity', (m) => m.quantity], ['Unit', (m) => m.unit], ['Balance After', (m) => m.balanceAfter],
  ['Issued To', (m) => m.issuedTo?.name || ''], ['Holder Type', (m) => (m.issuedTo ? ASSIGNEE_TYPES[m.issuedTo.type] : '')], ['Employee No', (m) => m.issuedTo?.employeeNo || ''],
  ['Reference', (m) => m.reference], ['Notes', (m) => m.notes], ['By', (m) => m.by],
];
export const exportMovements = (list, name) => downloadFile(`${name}-${today()}.csv`, toCsv([MOVEMENT_CSV.map((c) => c[0]), ...list.map((m) => MOVEMENT_CSV.map(([, f]) => f(m)))]));

const ITEM_CSV = [
  ['SKU', (i) => i.sku], ['Item', (i) => i.name], ['Category', (i) => i.category], ['On Hand', (i) => i.quantity], ['Unit', (i) => i.unit],
  ['Reorder Level', (i) => i.reorderLevel], ['Status', (i) => (i.quantity === 0 ? 'Out of stock' : isLow(i) ? 'Low' : 'OK')], ['Location', (i) => i.location],
  ['Unit Cost (PHP)', (i) => i.unitCost ?? ''], ['Stock Value (PHP)', (i) => (i.unitCost != null ? Math.round(i.unitCost * i.quantity * 100) / 100 : '')], ['Supplier', (i) => i.supplier], ['Notes', (i) => i.notes],
];

// ---------- Dialogs ----------

async function openMovement(item, type, onDone) {
  const meta = type === 'out' ? await api.get('/api/asset-meta') : null;
  const titles = { in: `Receive stock: ${item.name}`, out: `Issue: ${item.name}`, adjust: `Stock count: ${item.name}` };
  const { form } = modal({
    title: titles[type],
    submitLabel: { in: 'Add to stock', out: 'Issue', adjust: 'Save count' }[type],
    body: html`<p class="muted small">${item.sku} · ${item.quantity} ${item.unit} on hand</p>
      <div class="grid two">
        ${type === 'adjust'
          ? html`<label class="field span-2"><span>Counted quantity (${item.unit})</span><input type="number" name="countedQuantity" min="0" step="1" value="${item.quantity}" required /><small class="muted">The physical count. The difference is recorded as an adjustment.</small></label>`
          : html`<label class="field"><span>Quantity (${item.unit})</span><input type="number" name="quantity" min="1" step="1" ${type === 'out' ? `max=${item.quantity}` : ''} value="1" required /></label>`}
        ${type === 'out' ? assigneeFields(meta, { label: 'Issue to' }) : ''}
        <label class="field ${type === 'adjust' ? 'span-2' : ''}"><span>Reference</span><input name="reference" placeholder="${type === 'in' ? 'Delivery receipt / PO no.' : type === 'out' ? 'Request or ticket no.' : 'e.g. Q4 count'}" /></label>
        <label class="field span-2"><span>Notes</span><input name="notes" /></label>
      </div>`,
    onSubmit: async (f) => {
      const fd = new FormData(f);
      await api.post(`/api/inventory/${item.id}/movements`, {
        type, quantity: fd.get('quantity'), countedQuantity: fd.get('countedQuantity'), reference: fd.get('reference'), notes: fd.get('notes'),
        issuedTo: type === 'out' ? readAssignee(fd) : null,
      });
      toast({ in: 'Stock received.', out: 'Stock issued.', adjust: 'Count saved.' }[type]);
      onDone();
    },
  });
  if (type === 'out') wireAssignee(form);
}

async function openItemForm(item, onDone) {
  const meta = await api.get('/api/asset-meta');
  const i = item || { unit: 'pcs', reorderLevel: 5, location: 'IT Store Room' };
  modal({
    title: item ? `Edit ${item.name}` : 'Add inventory item',
    submitLabel: item ? 'Save' : 'Add item',
    wide: true,
    body: html`<div class="grid">
      <label class="field"><span>SKU</span><input name="sku" value="${i.sku || ''}" placeholder="${meta.nextSku}" /></label>
      <label class="field span-2"><span>Item name<em>*</em></span><input name="name" value="${i.name || ''}" placeholder="e.g. USB-C to HDMI adapter" required /></label>
      <label class="field"><span>Category</span><input name="category" value="${i.category || ''}" list="dl-icat" /></label>
      <label class="field"><span>Unit</span><input name="unit" value="${i.unit}" placeholder="pcs, boxes, bottles" /></label>
      <label class="field"><span>Reorder level</span><input type="number" name="reorderLevel" min="0" step="1" value="${i.reorderLevel}" /><small class="muted">Flagged as low at or below this.</small></label>
      <label class="field"><span>Location</span><input name="location" value="${i.location || ''}" list="dl-iloc" /></label>
      <label class="field"><span>Unit cost (₱)</span><input type="number" name="unitCost" min="0" step="0.01" value="${i.unitCost ?? ''}" /></label>
      <label class="field"><span>Supplier</span><input name="supplier" value="${i.supplier || ''}" list="dl-isup" /></label>
      ${item ? '' : html`<label class="field"><span>Opening quantity</span><input type="number" name="openingQuantity" min="0" step="1" value="0" /></label>`}
      <label class="field span-3"><span>Notes</span><input name="notes" value="${i.notes || ''}" /></label>
    </div>
    <datalist id="dl-icat">${[...new Set([...ITEM_CATEGORIES, ...meta.itemCategories])].map((c) => html`<option value="${c}"></option>`)}</datalist>
    <datalist id="dl-iloc">${meta.locations.map((c) => html`<option value="${c}"></option>`)}</datalist>
    <datalist id="dl-isup">${meta.suppliers.map((c) => html`<option value="${c}"></option>`)}</datalist>`,
    onSubmit: async (f) => {
      const body = Object.fromEntries(new FormData(f));
      const saved = item ? await api.put(`/api/inventory/${item.id}`, body) : await api.post('/api/inventory', body);
      toast(item ? 'Item saved.' : `Added ${saved.sku}.`);
      onDone(saved);
    },
  });
}

// ---------- List ----------

export async function inventoryView(el, _params, query) {
  const items = await api.get('/api/inventory');
  const edit = can('assets.edit');
  const state = { q: '', lowOnly: Boolean(query.low), category: '' };
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();
  const reload = () => inventoryView(el, {}, { low: state.lowOnly ? '1' : '' });

  const rows = () => {
    const q = state.q.toLowerCase();
    return items
      .filter((i) => (!state.lowOnly || isLow(i)) && (!state.category || i.category === state.category))
      .filter((i) => !q || [i.sku, i.name, i.category, i.location, i.supplier].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  const totalValue = items.reduce((s, i) => s + (i.unitCost || 0) * i.quantity, 0);

  function render() {
    const list = rows();
    mount(el.querySelector('#inv-table'), list.length
      ? html`<table class="table">
          <thead><tr><th>SKU</th><th>Item</th><th>Category</th><th class="num">On hand</th><th class="num">Reorder at</th><th>Location</th><th class="num">Unit cost</th><th class="num">Stock value</th><th></th></tr></thead>
          <tbody>${list.map((i) => html`<tr class="${isLow(i) ? 'row-low' : ''}">
            <td><a class="mono" href="#/assets/inventory/${i.id}">${i.sku}</a></td>
            <td><a href="#/assets/inventory/${i.id}"><strong>${i.name}</strong></a></td>
            <td>${i.category || html`<span class="muted">—</span>`}</td>
            <td class="num"><strong>${i.quantity}</strong> <small>${i.unit}</small> ${stockBadge(i)}</td>
            <td class="num">${i.reorderLevel}</td>
            <td>${i.location}</td>
            <td class="num">${i.unitCost != null ? money(i.unitCost) : '—'}</td>
            <td class="num">${i.unitCost != null ? money(i.unitCost * i.quantity) : '—'}</td>
            <td class="row-actions">${edit ? html`<button class="link" data-in="${i.id}">Receive</button><button class="link" data-out="${i.id}" ${i.quantity ? '' : 'disabled'}>Issue</button><button class="link" data-adjust="${i.id}">Count</button>` : ''}</td>
          </tr>`)}</tbody>
        </table>`
      : html`<div class="empty"><p>${items.length ? 'No items match.' : 'No inventory items yet.'}</p></div>`);
  }

  mount(el, html`
    <header class="page-head">
      <div><h1>Inventory</h1><p class="muted">Consumables and spare parts: ${items.length} items · stock value ${money(totalValue)}</p></div>
      <div class="actions"><button class="btn" id="export">Export CSV</button><button class="btn" id="export-moves">Export movements</button>${edit ? html`<button class="btn primary" id="add">+ Add item</button>` : ''}</div>
    </header>
    <section class="card scroll-x">
      <div class="toolbar pad">
        <input type="search" id="q" placeholder="Search SKU, item, supplier…" />
        <select id="f-cat"><option value="">All categories</option>${categories.map((c) => html`<option>${c}</option>`)}</select>
        <label class="inline"><input type="checkbox" id="f-low" ${state.lowOnly ? 'checked' : ''} /> Low stock only</label>
      </div>
      <div id="inv-table"></div>
    </section>`);

  render();
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value), render()));
  el.querySelector('#f-cat').addEventListener('change', (e) => ((state.category = e.target.value), render()));
  el.querySelector('#f-low').addEventListener('change', (e) => ((state.lowOnly = e.target.checked), render()));
  el.querySelector('#export').addEventListener('click', () => downloadFile(`inventory-${today()}.csv`, toCsv([ITEM_CSV.map((c) => c[0]), ...rows().map((i) => ITEM_CSV.map(([, f]) => f(i)))])));
  el.querySelector('#export-moves').addEventListener('click', async () => exportMovements(await api.get('/api/stock-movements'), 'stock-movements'));
  el.querySelector('#add')?.addEventListener('click', () => openItemForm(null, (saved) => (location.hash = `#/assets/inventory/${saved.id}`)));
  el.querySelector('#inv-table').addEventListener('click', (e) => {
    const t = e.target;
    const id = t.dataset.in || t.dataset.out || t.dataset.adjust;
    if (!id) return;
    openMovement(items.find((i) => i.id === id), t.dataset.in ? 'in' : t.dataset.out ? 'out' : 'adjust', reload);
  });
}

// ---------- Item detail ----------

export async function inventoryItemView(el, { id }) {
  const [items, moves] = await Promise.all([api.get('/api/inventory'), api.get(`/api/stock-movements?itemId=${id}`)]);
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error('Inventory item not found.');
  const edit = can('assets.edit');
  const reload = () => inventoryItemView(el, { id });
  const issued = moves.filter((m) => m.type === 'out').reduce((s, m) => s - m.quantity, 0);

  mount(el, html`
    <header class="page-head">
      <div><a class="back" href="#/assets/inventory">← Inventory</a><p class="tag-line mono">${item.sku}</p><h1>${item.name} ${stockBadge(item)}</h1>
        <p class="muted">${item.category || 'Uncategorized'} · ${item.location || 'No location'}${item.supplier ? ` · ${item.supplier}` : ''}</p></div>
      <div class="actions">${edit ? html`<button class="btn primary" id="in">Receive</button><button class="btn" id="out" ${item.quantity ? '' : 'disabled'}>Issue</button><button class="btn" id="adjust">Count</button><button class="btn" id="edit">Edit</button>` : ''}</div>
    </header>
    <div class="stats">
      <div class="card ${isLow(item) ? 'attention' : ''}"><small>On hand</small><strong>${item.quantity} <small class="unit">${item.unit}</small></strong></div>
      <div class="card"><small>Reorder level</small><strong>${item.reorderLevel}</strong></div>
      <div class="card"><small>Issued to date</small><strong>${issued}</strong></div>
      <div class="card"><small>Stock value</small><strong>${item.unitCost != null ? money(item.unitCost * item.quantity) : '—'}</strong></div>
    </div>
    <section class="card scroll-x">
      <div class="card-head pad"><h2>Movements</h2><button class="btn small-btn" id="export">Export CSV</button></div>
      ${moves.length
        ? html`<table class="table">
            <thead><tr><th>Date</th><th>Movement</th><th class="num">Qty</th><th class="num">Balance</th><th>Issued to</th><th>Reference</th><th>By</th></tr></thead>
            <tbody>${moves.map((m) => html`<tr>
              <td>${when(m.at)}</td>
              <td>${badge(MOVE_LABEL[m.type], m.type === 'in' ? 'green' : m.type === 'out' ? 'blue' : 'gray')}</td>
              <td class="num ${m.quantity < 0 ? 'neg' : 'pos'}">${m.quantity > 0 ? '+' : ''}${m.quantity}</td>
              <td class="num">${m.balanceAfter}</td>
              <td>${m.issuedTo ? html`${m.issuedTo.name}<small>${ASSIGNEE_TYPES[m.issuedTo.type]}</small>` : html`<span class="muted">—</span>`}</td>
              <td>${m.reference}${m.notes ? html`<small>${m.notes}</small>` : ''}</td>
              <td>${m.by}</td>
            </tr>`)}</tbody>
          </table>`
        : html`<div class="empty"><p>No movements yet.</p></div>`}
    </section>
    ${edit ? html`<div class="danger-zone"><button class="btn danger ghost" id="delete">Delete item</button><small class="muted">Only possible when stock is zero. Its movement records are kept in the activity log.</small></div>` : ''}`);

  el.querySelector('#in')?.addEventListener('click', () => openMovement(item, 'in', reload));
  el.querySelector('#out')?.addEventListener('click', () => openMovement(item, 'out', reload));
  el.querySelector('#adjust')?.addEventListener('click', () => openMovement(item, 'adjust', reload));
  el.querySelector('#edit')?.addEventListener('click', () => openItemForm(item, reload));
  el.querySelector('#export').addEventListener('click', () => exportMovements(moves, `${item.sku}-movements`));
  el.querySelector('#delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete ${item.name}?`))) return;
    try {
      await api.del(`/api/inventory/${item.id}`);
      toast('Item deleted.');
      location.hash = '#/assets/inventory';
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
