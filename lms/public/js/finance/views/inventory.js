// Inventory: stock items and stock cards; purchase requests (PR), purchase orders (PO) with their
// obligation request and deliveries (IAR); requisitions (RIS); the RSMI and the physical count (RPCI).
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, modal, toast, formData, option, fmtDate, downloadFile, toCsv } from '../../ui.js';
import { classOf } from '/shared/finance.js';
import { fin, can, money, num, thisMonth, monthName, fundOptions, officeOptions, accountOptions, cardOptions, linesTable, wireLines, readLines, clickableRows, prBadge, poBadge, risBadge, amt, infoGrid, printLink } from '../state.js';

const today = () => new Date().toISOString().slice(0, 10);
const supplyAccounts = () => fin.settings.supplyClasses.map((c) => c.code);

// ----- Stock items -----
export async function itemListView(el, _p, query) {
  const [list, chart] = await Promise.all([api.get(`/api/finance/items?${new URLSearchParams({ q: query.q || '', ...(query.all ? { all: 1 } : {}) })}`), fin.chart()]);
  const shown = query.low ? list.filter((i) => i.low) : list;
  const edit = can('finance.inventory');
  const reload = () => itemListView(el, _p, query);
  mount(el, html`
    ${pageHead('Stock', 'Supplies and materials kept in the supply office: stock cards with FIFO cost, reorder points.', html`<a class="btn" href="#/inventory-reports">${icon('chart', 16)} RSMI and physical count</a>${edit ? html`<button class="btn primary" id="add">${icon('plus', 16)} New item</button>` : ''}`)}
    <form class="toolbar" id="f"><input type="search" name="q" value="${query.q || ''}" placeholder="Stock no. or description" /><label class="check-row inline"><input type="checkbox" name="low" ${query.low ? 'checked' : ''} /> Low stock only</label><button class="btn">${icon('search', 16)} Find</button></form>
    ${shown.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>Stock no.</th><th>Description</th><th>Account</th><th class="num">On hand</th><th class="num">Value</th><th class="num">Reorder at</th>${edit ? html`<th></th>` : ''}</tr></thead>
      <tbody>${shown.map((i) => html`<tr data-href="/items/${i.id}"><td><a href="#/items/${i.id}"><strong>${i.stockNo}</strong></a></td><td>${i.description}${i.active ? '' : html` <span class="badge gray">Off</span>`}</td><td><small>${i.code} · ${i.accountTitle}</small></td>
        <td class="num">${num(i.onHand).replace(/\.00$/, '')} ${i.unit} ${i.low ? html`<span class="badge amber">Low</span>` : ''}</td>${amt(i.value)}<td class="num">${i.reorderPoint || ''}</td>${edit ? html`<td class="row-actions"><button class="btn sm" data-edit="${i.id}">Edit</button></td>` : ''}</tr>`)}</tbody></table></div></div>`
      : html`<div class="card empty">${icon('box', 40)}<h2>No stock items</h2><p>Add the supplies the school keeps, then receive them through purchase orders.</p></div>`}`);
  clickableRows(el);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const v = formData(e.target);
    location.hash = `#/items?${new URLSearchParams({ q: v.q, ...(v.low ? { low: 1 } : {}) })}`;
  };
  const form = (it) => modal({
    title: it ? `Edit ${it.stockNo}` : 'New stock item', submitLabel: it ? 'Save' : 'Add',
    body: html`<div class="grid two"><label class="field"><span>Stock number</span><input name="stockNo" value="${it?.stockNo || ''}" required /></label><label class="field"><span>Unit</span><input name="unit" value="${it?.unit || ''}" placeholder="ream, box, piece" required /></label>
      <label class="field span-2"><span>Description</span><input name="description" value="${it?.description || ''}" required /></label>
      <label class="field span-2"><span>Inventory account</span><select name="code">${accountOptions(chart, it?.code || '10404010', (a) => supplyAccounts().includes(a.code))}</select></label>
      <label class="field"><span>Reorder point</span><input type="number" min="0" name="reorderPoint" value="${it?.reorderPoint || ''}" /></label>
      <label class="field check"><input type="checkbox" name="active" ${it?.active === false ? '' : 'checked'} /> <span>In use</span></label></div>`,
    async onSubmit(f) {
      const body = { ...formData(f), active: Boolean(formData(f).active) };
      if (it) await api.put(`/api/finance/items/${it.id}`, body);
      else await api.post('/api/finance/items', body);
      toast('Saved.');
      reload();
    },
  });
  el.querySelector('#add')?.addEventListener('click', () => form(null));
  el.onclick = (e) => {
    const b = e.target.closest('[data-edit]');
    if (b) form(list.find((i) => i.id === b.dataset.edit));
  };
}

export async function stockCardView(el, params) {
  const d = await api.get(`/api/finance/items/${params.id}/card`);
  const i = d.item;
  mount(el, html`
    ${pageHead(`${i.stockNo} · ${i.description}`, `Stock card (GAM Appendix 58) and supplies ledger card (Appendix 57) · ${i.code} ${i.accountTitle}`, html`<button class="btn" onclick="print()">${icon('file', 16)} Print</button>`, ['/items', 'Stock'])}
    <div class="stats"><div class="card"><small>On hand</small><strong>${num(i.onHand).replace(/\.00$/, '')} ${i.unit}</strong></div><div class="card accent"><small>Value (FIFO)</small><strong>${money(i.value)}</strong></div><div class="card"><small>Reorder point</small><strong>${i.reorderPoint || '—'}</strong></div></div>
    <div class="card"><div class="print-head"><strong>${fin.settings.entity.name}</strong><span>Stock Card · ${i.stockNo} ${i.description} (${i.unit})</span></div>
    <div class="table-scroll"><table class="table compact"><thead><tr><th>Date</th><th>Reference</th><th>Office</th><th class="num">Receipt</th><th class="num">Issue</th><th class="num">Unit cost</th><th class="num">Amount</th><th class="num">Balance qty</th><th class="num">Balance value</th></tr></thead>
    <tbody>${d.rows.map((r) => html`<tr><td>${fmtDate(r.date)}</td><td>${r.ref ? `${r.ref.kind.toUpperCase()} ${r.ref.no}` : r.kind}</td><td>${r.office}</td><td class="num">${r.in || ''}</td><td class="num">${r.out || ''}</td>${amt(r.unitCost)}${amt(Math.abs(r.total))}<td class="num">${r.balance}</td>${amt(r.value)}</tr>`)}</tbody></table></div></div>`);
}

// ----- Purchase requests -----
export async function prListView(el, _p, query) {
  const status = query.status || '';
  const list = await api.get(`/api/finance/prs${status ? `?status=${status}` : ''}`);
  mount(el, html`
    ${pageHead('Purchase requests', 'Requests from the school\'s offices (GAM Appendix 60), approved by the head of agency, then ordered.', html`<button class="btn primary" id="add">${icon('plus', 16)} New request</button>`)}
    <nav class="tabs">${[['', 'All'], ['submitted', 'For approval'], ['approved', 'Approved'], ['ordered', 'Ordered'], ['draft', 'Drafts'], ['cancelled', 'Cancelled']].map(([v, l]) => html`<a href="#/prs?status=${v}" class="${v === status ? 'active' : ''}">${l}</a>`)}</nav>
    ${list.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>PR no.</th><th>Office</th><th>Purpose</th><th>Requested by</th><th class="num">Estimate</th><th>Status</th></tr></thead>
      <tbody>${list.map((p) => html`<tr data-href="/prs/${p.id}"><td><a href="#/prs/${p.id}"><strong>${p.no}</strong></a><small>${fmtDate(p.date)}</small></td><td>${p.officeName}</td><td>${p.purpose}</td><td>${p.requestedBy.name}</td>${amt(p.total)}<td>${prBadge(p.status)}</td></tr>`)}</tbody></table></div></div>`
      : html`<div class="card empty">${icon('cart', 40)}<h2>No purchase requests</h2></div>`}`);
  clickableRows(el);
  el.querySelector('#add').addEventListener('click', () => prForm());
}

export async function prForm() {
  const items = await api.get('/api/finance/items');
  const cols = [
    { key: 'itemId', label: 'Stock item (or describe below)', type: 'select', options: (v) => html`<option value="">Not a stock item</option>${items.map((i) => option(i.id, `${i.stockNo} · ${i.description} (${i.unit})`, i.id === v))}`, width: '30%' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'text', width: '80px' },
    { key: 'qty', label: 'Qty', type: 'number', step: '1', width: '80px' },
    { key: 'unitCost', label: 'Est. unit cost', type: 'number' },
  ];
  const m = modal({
    title: 'New purchase request', wide: true, submitLabel: 'Submit',
    body: html`<div class="grid"><label class="field"><span>Office</span><select name="office">${officeOptions('', { blank: '' })}</select></label><label class="field"><span>Fund cluster</span><select name="fund">${fundOptions(fin.settings.funds[0])}</select></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label>
      <label class="field span-3"><span>Purpose</span><input name="purpose" required /></label><label class="field"><span>Your position</span><input name="requesterTitle" /></label></div>
      <h3 class="sub-h">Items</h3>${linesTable('pr-lines', cols, [], { total: true })}`,
    async onSubmit(form) {
      const body = { ...formData(form), submit: true, items: readLines(form, 'pr-lines') };
      const p = await api.post('/api/finance/prs', body);
      toast(`PR ${p.no} submitted.`);
      location.hash = `#/prs/${p.id}`;
    },
  });
  wireLines(m.form, 'pr-lines', (rows) => `Estimated total ${money(rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitCost) || 0), 0))}`);
}

export async function prView(el, params) {
  const p = await api.get(`/api/finance/prs/${params.id}`);
  const reload = () => prView(el, params);
  const act = async (a, body = {}) => {
    try {
      await api.post(`/api/finance/prs/${p.id}/${a}`, body);
      toast('Done.');
      ctx.refreshBadges?.();
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const mine = p.requestedBy.userId === ctx.user.id;
  mount(el, html`
    ${pageHead(html`PR ${p.no} ${prBadge(p.status)}`, `${p.officeName || 'No office'} · ${fmtDate(p.date)} · fund ${p.fund}`, html`
      ${printLink('pr', p.id)}
      ${p.status === 'draft' && (mine || can('finance.procure')) ? html`<button class="btn primary" data-a="submit">Submit</button>` : ''}
      ${p.status === 'submitted' && can('finance.approve') && !mine ? html`<button class="btn primary" data-a="approve">Approve</button>` : ''}
      ${p.status === 'approved' && can('finance.procure') ? html`<a class="btn primary" href="#/pos/new?prId=${p.id}">${icon('truck', 16)} Prepare PO</a>` : ''}
      ${['draft', 'submitted', 'approved'].includes(p.status) ? html`<button class="btn danger ghost" data-a="cancel">Cancel</button>` : ''}`, can('finance.view') ? ['/prs', 'Purchase requests'] : ['/me/requests', 'My requests'])}
    <section class="card">${infoGrid([['Purpose', p.purpose], ['Requested by', `${p.requestedBy.name}${p.requestedBy.title ? `, ${p.requestedBy.title}` : ''}`], ['Approved by', p.approvedBy ? `${p.approvedBy.name}, ${p.approvedBy.title}` : '—'], p.poNos.length && ['Purchase orders', html`${p.poNos.map((o) => html`<a href="#/pos/${o.id}">PO ${o.no}</a> `)}`], p.cancelReason && ['Cancelled', p.cancelReason]])}</section>
    <section class="card"><table class="table compact"><thead><tr><th>Unit</th><th>Description</th><th class="num">Qty</th><th class="num">Est. unit cost</th><th class="num">Est. cost</th></tr></thead>
      <tbody>${p.items.map((i) => html`<tr><td>${i.unit}</td><td>${i.description}</td><td class="num">${i.qty}</td>${amt(i.unitCost)}${amt(i.amount)}</tr>`)}</tbody><tfoot><tr><td colspan="4">Total</td>${amt(p.total, { strong: true })}</tr></tfoot></table></section>`);
  el.onclick = (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'cancel') return modal({ title: `Cancel PR ${p.no}`, submitLabel: 'Cancel request', cancelLabel: 'Keep it', body: html`<label class="field"><span>Reason</span><input name="reason" /></label>`, onSubmit: (f) => act('cancel', formData(f)) });
    act(b.dataset.a);
  };
}

// ----- Purchase orders -----
export async function poListView(el, _p, query) {
  const status = query.status || '';
  const list = await api.get(`/api/finance/pos${status ? `?status=${status}` : ''}`);
  mount(el, html`
    ${pageHead('Purchase orders', 'Orders to suppliers (GAM Appendix 61) under the New Government Procurement Act (RA 12009), each obligated before it is approved.', can('finance.procure') ? html`<a class="btn primary" href="#/pos/new">${icon('plus', 16)} New PO</a>` : '')}
    <nav class="tabs">${[['', 'All'], ['draft', 'Drafts'], ['open', 'Waiting for delivery'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']].map(([v, l]) => html`<a href="#/pos?status=${v}" class="${v === status ? 'active' : ''}">${l}</a>`)}</nav>
    ${list.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>PO no.</th><th>Supplier</th><th>Mode</th><th>Deliver by</th><th class="num">Total</th><th>ORS</th><th>Status</th></tr></thead>
      <tbody>${list.map((o) => html`<tr data-href="/pos/${o.id}"><td><a href="#/pos/${o.id}"><strong>${o.no}</strong></a><small>${fmtDate(o.date)}${o.prNo ? ` · PR ${o.prNo}` : ''}</small></td><td>${o.supplierName}</td><td><small>${o.mode}</small></td><td>${fmtDate(o.deliveryDate)}</td>${amt(o.total)}<td>${o.ors ? `${o.ors.no || 'draft'}` : '—'}</td><td>${poBadge(o.status)}</td></tr>`)}</tbody></table></div></div>`
      : html`<div class="card empty">${icon('truck', 40)}<h2>No purchase orders</h2></div>`}`);
  clickableRows(el);
}

export async function poFormView(el, _p, query) {
  const [chart, cards, items, pr] = await Promise.all([fin.chart(), fin.cardList(), api.get('/api/finance/items'), query.prId ? api.get(`/api/finance/prs/${query.prId}`) : null]);
  const s = fin.settings;
  const accountsFor = (a) => [...s.supplyClasses.map((c) => c.code), ...s.semiClasses.map((c) => c.code), ...s.ppeClasses.map((c) => c.code)].includes(a.code) || classOf(a.code) === 'MOOE';
  const guessCat = (i) => (i.itemId ? 'supply' : i.unitCost >= s.capitalization ? 'ppe' : 'semi');
  const cols = [
    { key: 'itemId', label: 'Stock item', type: 'select', options: (v) => html`<option value="">—</option>${items.map((i) => option(i.id, `${i.stockNo} · ${i.description}`, i.id === v))}`, width: '20%' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'category', label: 'Kind', type: 'select', options: (v) => html`${[['supply', 'Supply'], ['semi', 'Semi-expendable'], ['ppe', 'PPE'], ['service', 'Service']].map(([k, l]) => option(k, l, k === v))}` },
    { key: 'code', label: 'Account', type: 'select', options: (v) => accountOptions(chart, v, accountsFor) },
    { key: 'unit', label: 'Unit', type: 'text', width: '70px' },
    { key: 'qty', label: 'Qty', type: 'number', step: '1', width: '70px' },
    { key: 'unitCost', label: 'Unit cost', type: 'number' },
  ];
  const rows = (pr?.items || []).map((i) => ({ ...i, category: guessCat(i), code: i.itemId ? items.find((x) => x.id === i.itemId)?.code : '' }));
  mount(el, html`
    ${pageHead(pr ? `Purchase order for PR ${pr.no}` : 'New purchase order', `Small Value Procurement up to ${money(s.svpLimit)}; Direct Acquisition up to ${money(s.directAcquisitionLimit)}. PPE: unit cost of ${money(s.capitalization)} or more.`, '', ['/pos', 'Purchase orders'])}
    <form class="card" id="po">
      <div class="grid">
        <label class="field span-2"><span>Supplier</span><select name="supplierId" required>${cardOptions(cards.filter((c) => c.status === 'active'), '', ['supplier', 'agency', 'individual'])}</select></label>
        <label class="field"><span>Mode of procurement</span><select name="mode">${s.procurementModes.map((m) => option(m, m))}</select></label>
        <label class="field"><span>PO date</span><input type="date" name="date" value="${today()}" /></label>
        <label class="field"><span>Deliver by</span><input type="date" name="deliveryDate" required /></label>
        <label class="field"><span>Fund cluster</span><select name="fund">${fundOptions(pr?.fund || s.funds[0])}</select></label>
        <label class="field"><span>Office</span><select name="office">${officeOptions(pr?.office)}</select></label>
        <label class="field"><span>Place of delivery</span><input name="place" value="Supply Office" /></label>
        <label class="field"><span>Payment term</span><input name="paymentTerm" value="Upon complete delivery and acceptance" /></label>
      </div>
      <h3 class="sub-h">Items</h3>
      ${linesTable('po-lines', cols, rows, { total: true })}
      <details class="quotes"><summary>Abstract of quotations (optional)</summary>
        ${linesTable('quotes', [{ key: 'supplierId', label: 'Supplier', type: 'select', options: (v) => cardOptions(cards, v, ['supplier']) }, { key: 'amount', label: 'Quoted total', type: 'number' }], [], { min: 1, addLabel: 'Add quotation' })}
      </details>
      <input type="hidden" name="prId" value="${pr?.id || ''}" />
      <div class="actions end"><button class="btn primary">Save PO</button></div>
    </form>`);
  wireLines(el, 'po-lines', (r) => `Total ${money(r.reduce((t, x) => t + (Number(x.qty) || 0) * (Number(x.unitCost) || 0), 0))}`);
  wireLines(el, 'quotes');
  el.querySelector('#po-lines').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-k=itemId]');
    if (!sel || !sel.value) return;
    const it = items.find((i) => i.id === sel.value);
    const tr = sel.closest('tr');
    tr.querySelector('[data-k=description]').value = it.description;
    tr.querySelector('[data-k=unit]').value = it.unit;
    tr.querySelector('[data-k=category]').value = 'supply';
  });
  el.querySelector('#po').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const o = await api.post('/api/finance/pos', { ...formData(e.target), items: readLines(el, 'po-lines').map((l) => ({ ...l, code: l.code || items.find((i) => i.id === l.itemId)?.code })), quotes: readLines(el, 'quotes') });
      toast(`PO ${o.no} saved. Next: its obligation request.`);
      location.hash = `#/pos/${o.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

export async function poView(el, params) {
  const o = await api.get(`/api/finance/pos/${params.id}`);
  const reload = () => poView(el, params);
  const late = o.status !== 'delivered' && o.status !== 'cancelled' && today() > o.deliveryDate;
  mount(el, html`
    ${pageHead(html`PO ${o.no} ${poBadge(o.status)} ${late ? html`<span class="badge red">Late</span>` : ''}`, `${o.supplierName} · ${o.mode} · deliver by ${fmtDate(o.deliveryDate)}`, html`
      ${printLink('po', o.id)}
      ${o.status === 'draft' && (!o.ors || o.ors.status === 'cancelled') && can('finance.procure') ? html`<button class="btn primary" id="ors">${icon('clipboard', 16)} Request obligation</button>` : ''}
      ${o.status === 'draft' && o.ors?.status === 'obligated' && can('finance.approve') ? html`<button class="btn primary" id="approve">Approve PO</button>` : ''}
      ${['approved', 'partial'].includes(o.status) && can('finance.inventory') ? html`<button class="btn primary" id="iar">${icon('check', 16)} Inspect and accept delivery</button>` : ''}
      ${['draft', 'approved'].includes(o.status) && !o.iars.length && can('finance.procure') ? html`<button class="btn danger ghost" id="cancel">Cancel</button>` : ''}`, ['/pos', 'Purchase orders'])}
    <section class="card">${infoGrid([
      ['Supplier', html`<a href="#/cards/${o.supplierId}">${o.supplierName}</a>`], ['Purchase request', o.prNo ? html`<a href="#/prs/${o.prId}">PR ${o.prNo}</a>` : '—'], ['Fund', o.fund],
      ['Obligation', o.ors ? html`<a href="#/obligations/${o.ors.id}">${o.ors.form} ${o.ors.no || '(waiting for Box B)'}</a> · ${o.ors.status}` : 'Not yet requested'],
      ['Place of delivery', o.place], ['Payment term', o.paymentTerm], o.approvedBy && ['Approved by', `${o.approvedBy.name}, ${o.approvedBy.title}`],
    ])}</section>
    <section class="card"><table class="table compact"><thead><tr><th>Description</th><th>Kind / account</th><th class="num">Qty</th><th class="num">Delivered</th><th class="num">Unit cost</th><th class="num">Amount</th></tr></thead>
      <tbody>${o.items.map((i) => html`<tr><td>${i.description}</td><td><small>${i.category} · ${i.code} ${i.accountTitle} · object ${i.objectCode}</small></td><td class="num">${i.qty} ${i.unit}</td><td class="num">${i.delivered}</td>${amt(i.unitCost)}${amt(i.amount)}</tr>`)}</tbody>
      <tfoot><tr><td colspan="5">Total</td>${amt(o.total, { strong: true })}</tr></tfoot></table>
      ${o.quotes.length ? html`<p class="muted small">Quotations: ${o.quotes.map((q) => `${fin.cards?.find((c) => c.id === q.supplierId)?.name || 'supplier'} ${num(q.amount)}`).join(' · ')}</p>` : ''}</section>
    ${o.iars.length ? html`<section class="card"><h2>Deliveries (IAR)</h2><table class="table compact"><thead><tr><th>IAR no.</th><th>Date</th><th class="num">Accepted</th><th class="num">Liquidated damages</th><th></th></tr></thead>
      <tbody>${o.iars.map((i) => html`<tr><td>${i.no}</td><td>${fmtDate(i.date)}</td>${amt(i.total)}${amt(i.liquidatedDamages, { blankZero: true })}<td class="row-actions"><a class="btn sm" href="#/print/iar/${i.id}">${icon('file', 14)} IAR</a>${can('finance.disburse') && o.ors?.status === 'obligated' ? html`<a class="btn sm primary" href="#/dvs/new?orsId=${o.ors.id}&iarId=${i.id}">Voucher</a>` : ''}</td></tr>`)}</tbody></table></section>` : ''}`);
  el.querySelector('#ors')?.addEventListener('click', async () => {
    const als = (await api.get(`/api/finance/allotments?fund=${o.fund}`)).filter((a) => a.balance > 0);
    const classes = [...new Set(o.items.map((i) => classOf(i.objectCode)))];
    modal({
      title: `Obligation request for PO ${o.no}`, submitLabel: 'Send to the budget office',
      body: html`<p class="muted small">The PO's object codes are grouped and charged to the allotments you pick; the budget office certifies Box B.</p>${classes.map((c) => html`<label class="field"><span>${c} allotment</span><select name="${c}" required>${als.filter((a) => a.cls === c).map((a) => option(a.id, `${a.ref} · ${a.pap} · ${num(a.balance)} left`))}</select></label>`)}`,
      async onSubmit(form) {
        await api.post(`/api/finance/pos/${o.id}/ors`, { allotments: formData(form) });
        toast('Sent to the budget office.');
        reload();
      },
    });
  });
  el.querySelector('#approve')?.addEventListener('click', async () => {
    try {
      await api.post(`/api/finance/pos/${o.id}/approve`);
      toast('PO approved; serve it to the supplier.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#cancel')?.addEventListener('click', () => modal({ title: `Cancel PO ${o.no}`, submitLabel: 'Cancel PO', cancelLabel: 'Keep it', body: html`<label class="field"><span>Reason</span><input name="reason" /></label>`, async onSubmit(f) {
    await api.post(`/api/finance/pos/${o.id}/cancel`, formData(f));
    reload();
  } }));
  el.querySelector('#iar')?.addEventListener('click', () => modal({
    title: `Inspection and acceptance: PO ${o.no}`, wide: true, submitLabel: 'Accept delivery',
    body: html`<div class="grid two"><label class="field"><span>Date accepted</span><input type="date" name="date" value="${today()}" /></label><label class="field"><span>Supplier's invoice no.</span><input name="invoiceNo" required /></label>
      <label class="field"><span>Invoice date</span><input type="date" name="invoiceDate" value="${today()}" /></label><label class="field"><span>Inspected by</span><input name="inspectedBy" value="${fin.settings.signatories.inspector.name}" required /></label></div>
      <table class="table compact"><thead><tr><th>Item</th><th class="num">Undelivered</th><th class="num">Delivered now</th></tr></thead>
      <tbody>${o.items.map((i, n) => html`<tr><td>${i.description}<small>${i.category}</small></td><td class="num">${i.qty - i.delivered} ${i.unit}</td><td class="num"><input type="number" min="0" max="${i.qty - i.delivered}" step="${i.category === 'supply' ? 'any' : '1'}" name="q${n}" value="${i.qty - i.delivered}" /></td></tr>`)}</tbody></table>
      ${late ? html`<p class="notice bad">Delivered after ${fmtDate(o.deliveryDate)}: liquidated damages of 1/10 of 1% a day of the late items are computed (up to 10% of the contract).</p>` : ''}`,
    async onSubmit(form) {
      const v = formData(form);
      const r = await api.post('/api/finance/iars', { ...v, poId: o.id, lines: o.items.map((_, n) => ({ line: n, qty: Number(v[`q${n}`]) || 0 })) });
      toast(`IAR ${r.no}: ${money(r.total)} accepted${r.liquidatedDamages ? `, ${money(r.liquidatedDamages)} liquidated damages` : ''}.`);
      reload();
    },
  }));
}

// ----- Requisitions -----
export async function risListView(el, _p, query) {
  const status = query.status || '';
  const list = await api.get(`/api/finance/ris${status ? `?status=${status}` : ''}`);
  mount(el, html`
    ${pageHead('Requisition and issue slips', 'Supplies requested by the offices and issued from stock (GAM Appendix 63).', html`<button class="btn primary" id="add">${icon('plus', 16)} New requisition</button>`)}
    <nav class="tabs">${[['', 'All'], ['open', 'To issue'], ['issued', 'Issued'], ['cancelled', 'Cancelled']].map(([v, l]) => html`<a href="#/ris?status=${v}" class="${v === status ? 'active' : ''}">${l}</a>`)}</nav>
    ${list.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>RIS no.</th><th>Office</th><th>Purpose</th><th>Requested by</th><th>Items</th><th>Status</th></tr></thead>
      <tbody>${list.map((r) => html`<tr data-href="/ris/${r.id}"><td><a href="#/ris/${r.id}"><strong>${r.no}</strong></a><small>${fmtDate(r.date)}</small></td><td>${r.officeName}</td><td>${r.purpose}</td><td>${r.requestedBy.name}</td><td>${r.items.length}</td><td>${risBadge(r.status)}</td></tr>`)}</tbody></table></div></div>`
      : html`<div class="card empty">${icon('inbox', 40)}<h2>No requisitions</h2></div>`}`);
  clickableRows(el);
  el.querySelector('#add').addEventListener('click', () => risForm());
}

export async function risForm() {
  const items = await api.get('/api/finance/items');
  const cols = [
    { key: 'itemId', label: 'Item', type: 'select', options: (v) => html`<option value="">Pick an item…</option>${items.map((i) => option(i.id, `${i.stockNo} · ${i.description} (${i.unit}) · ${i.onHand} in stock`, i.id === v))}`, width: '70%' },
    { key: 'qty', label: 'Quantity', type: 'number', step: '1' },
  ];
  const m = modal({
    title: 'Request supplies', wide: true, submitLabel: 'Request',
    body: html`<div class="grid two"><label class="field"><span>Office</span><select name="office">${officeOptions('', { blank: '' })}</select></label><label class="field"><span>Purpose</span><input name="purpose" required /></label></div>${linesTable('ris-lines', cols, [])}`,
    async onSubmit(form) {
      const r = await api.post('/api/finance/ris', { ...formData(form), items: readLines(form, 'ris-lines') });
      toast(`RIS ${r.no} sent to the supply office.`);
      location.hash = `#/ris/${r.id}`;
    },
  });
  wireLines(m.form, 'ris-lines');
}

export async function risView(el, params) {
  const r = await api.get(`/api/finance/ris/${params.id}`);
  const reload = () => risView(el, params);
  const act = async (a, body = {}) => {
    try {
      await api.post(`/api/finance/ris/${r.id}/${a}`, body);
      toast('Done.');
      ctx.refreshBadges?.();
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const open = ['requested', 'approved'].includes(r.status);
  mount(el, html`
    ${pageHead(html`RIS ${r.no} ${risBadge(r.status)}`, `${r.officeName || 'No office'} · ${fmtDate(r.date)} · ${r.purpose}`, html`
      ${printLink('ris', r.id)}
      ${r.status === 'requested' && can('finance.inventory') ? html`<button class="btn" data-a="approve">Approve</button>` : ''}
      ${open && can('finance.inventory') ? html`<button class="btn primary" data-a="issue">Issue</button>` : ''}
      ${open ? html`<button class="btn danger ghost" data-a="cancel">Cancel</button>` : ''}`, can('finance.view') ? ['/ris', 'Requisitions'] : ['/me/requests', 'My requests'])}
    <section class="card">${infoGrid([['Requested by', r.requestedBy.name], ['Approved by', r.approvedBy || '—'], ['Issued by', r.issuedBy ? `${r.issuedBy}, ${fmtDate(r.issuedDate)}` : '—'], ['Received by', r.receivedBy || '—']])}
      <table class="table compact"><thead><tr><th>Stock no.</th><th>Description</th><th>Unit</th><th class="num">Requested</th><th class="num">In stock</th><th class="num">Issued</th></tr></thead>
      <tbody>${r.items.map((i) => html`<tr><td>${i.stockNo}</td><td>${i.description}</td><td>${i.unit}</td><td class="num">${i.qty}</td><td class="num">${i.onHand}</td><td class="num">${r.status === 'issued' ? i.issued : ''}</td></tr>`)}</tbody></table></section>`);
  el.onclick = (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'issue') {
      return modal({
        title: `Issue RIS ${r.no}`, submitLabel: 'Issue',
        body: html`<table class="table compact"><thead><tr><th>Item</th><th class="num">Requested</th><th class="num">Issue</th></tr></thead><tbody>${r.items.map((i) => html`<tr><td>${i.description}</td><td class="num">${i.qty}</td><td class="num"><input type="number" min="0" max="${Math.min(i.qty, i.onHand)}" name="${i.itemId}" value="${Math.min(i.qty, i.onHand)}" /></td></tr>`)}</tbody></table>
          <label class="field"><span>Received by</span><input name="receivedBy" value="${r.requestedBy.name}" /></label>`,
        onSubmit: (f) => {
          const v = formData(f);
          return act('issue', { receivedBy: v.receivedBy, qty: Object.fromEntries(r.items.map((i) => [i.itemId, Number(v[i.itemId]) || 0])) });
        },
      });
    }
    if (b.dataset.a === 'cancel') return modal({ title: `Cancel RIS ${r.no}`, submitLabel: 'Cancel', cancelLabel: 'Keep it', body: html`<label class="field"><span>Reason</span><input name="reason" /></label>`, onSubmit: (f) => act('cancel', formData(f)) });
    act(b.dataset.a);
  };
}

// ----- RSMI and physical count -----
export async function inventoryReportsView(el, _p, query) {
  const tab = query.tab || 'rsmi';
  const month = query.month || thisMonth();
  const asOf = query.asOf || today();
  const d = tab === 'rsmi' ? await api.get(`/api/finance/rsmi?month=${month}`) : await api.get(`/api/finance/inventory-count?asOf=${asOf}`);
  const reload = () => inventoryReportsView(el, _p, query);
  mount(el, html`
    ${pageHead('Inventory reports', tab === 'rsmi' ? 'Report of Supplies and Materials Issued (Appendix 64): the month\'s issues, and the entry that charges them to expense.' : 'Report on the Physical Count of Inventories (Appendix 66): count, then book shortages and overages.', html`<button class="btn" id="csv">${icon('download', 16)} CSV</button><button class="btn" onclick="print()">${icon('file', 16)} Print</button>`, ['/items', 'Stock'])}
    <nav class="tabs">${[['rsmi', 'RSMI'], ['count', 'Physical count (RPCI)']].map(([k, l]) => html`<a href="#/inventory-reports?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</nav>
    ${tab === 'rsmi' ? html`
      <form class="toolbar" id="f"><input type="hidden" name="tab" value="rsmi" /><input type="month" name="month" value="${month}" /><button class="btn">Show</button>
        ${d.unposted && can('finance.inventory') ? html`<span class="grow"></span><select id="post-fund">${fundOptions(fin.settings.funds[0])}</select><button type="button" class="btn primary" id="post">Book ${d.unposted} issue${d.unposted === 1 ? '' : 's'} (JEV)</button>` : ''}</form>
      <div class="card"><div class="print-head"><strong>${fin.settings.entity.name}</strong><span>Report of Supplies and Materials Issued · ${monthName(month)}</span></div>
        <div class="table-scroll"><table class="table compact"><thead><tr><th>RIS no.</th><th>Office</th><th>Stock no.</th><th>Item</th><th>Unit</th><th class="num">Qty issued</th><th class="num">Unit cost</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${d.rows.map((r) => html`<tr><td>${r.risNo}</td><td>${r.office}</td><td>${r.stockNo}</td><td>${r.description}</td><td>${r.unit}</td><td class="num">${r.qty}</td>${amt(r.unitCost)}${amt(r.amount)}<td>${r.posted ? html`<span class="badge green">Booked</span>` : ''}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="7">Total</td>${amt(d.total, { strong: true })}<td></td></tr></tfoot></table></div>
        ${d.recap.length ? html`<h3 class="sub-h">Recapitulation</h3><table class="table compact"><thead><tr><th>Expense (debit)</th><th>Inventory (credit)</th><th class="num">Amount</th></tr></thead><tbody>${d.recap.map((r) => html`<tr><td>${r.expense} ${r.expenseTitle}</td><td>${r.code} ${r.title}</td>${amt(r.amount)}</tr>`)}</tbody></table>` : ''}
        ${d.jevNos.length ? html`<p class="muted small">Booked in JEV ${d.jevNos.join(', ')}.</p>` : ''}</div>`
    : html`
      <form class="toolbar" id="f"><input type="hidden" name="tab" value="count" /><label>As of <input type="date" name="asOf" value="${asOf}" /></label><button class="btn">Show</button></form>
      <form class="card" id="count"><div class="print-head"><strong>${fin.settings.entity.name}</strong><span>Report on the Physical Count of Inventories · as of ${fmtDate(asOf)}</span></div>
        <div class="table-scroll"><table class="table compact"><thead><tr><th>Account</th><th>Stock no.</th><th>Article</th><th>Unit</th><th class="num">Unit value</th><th class="num">Per stock card</th><th class="num">Per count</th><th class="num">Value</th></tr></thead>
        <tbody>${d.rows.map((r) => html`<tr><td><small>${r.code}</small></td><td>${r.stockNo}</td><td>${r.description}</td><td>${r.unit}</td>${amt(r.unitValue)}<td class="num">${r.qty}</td><td class="num">${can('finance.inventory') ? html`<input type="number" min="0" step="any" name="${r.id}" value="${r.qty}" class="count-in" aria-label="Count" />` : ''}</td>${amt(r.value)}</tr>`)}</tbody></table></div>
        ${can('finance.inventory') ? html`<div class="actions end"><select name="fund">${fundOptions(fin.settings.funds[0])}</select><button class="btn primary">Record count and book differences</button></div>` : ''}
        ${d.counts.length ? html`<h3 class="sub-h">Earlier counts</h3><ul class="tight">${d.counts.map((c) => html`<li>${fmtDate(c.asOf)} by ${c.by}: ${c.diffs.length ? c.diffs.map((x) => `${x.description} ${x.diff > 0 ? '+' : ''}${x.diff}`).join(', ') : 'no differences'}</li>`)}</ul>` : ''}
        <div class="sign-row print-only"><div>Certified correct by:<br /><br />Inventory committee</div><div>Approved by:<br /><br /><strong>${fin.settings.signatories.head.name}</strong></div><div>Verified by:<br /><br />COA representative</div></div></form>`}`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/inventory-reports?${new URLSearchParams(formData(e.target))}`;
  };
  el.querySelector('#post')?.addEventListener('click', async () => {
    try {
      const j = await api.post('/api/finance/rsmi', { month, fund: el.querySelector('#post-fund').value });
      toast(`Booked in JEV ${j.jevNo}.`);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  const countForm = el.querySelector('#count');
  if (countForm) {
    countForm.onsubmit = async (e) => {
      e.preventDefault();
      const v = formData(countForm);
      const counts = Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'fund'));
      try {
        const r = await api.post('/api/finance/inventory-count', { asOf, fund: v.fund, counts });
        toast(r.diffs.length ? `${r.diffs.length} difference${r.diffs.length === 1 ? '' : 's'} booked.` : 'Count recorded: no differences.');
        reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
  el.querySelector('#csv').addEventListener('click', () => downloadFile(`${tab}.csv`, toCsv(tab === 'rsmi' ? [['RIS', 'Office', 'Stock no.', 'Item', 'Unit', 'Qty', 'Unit cost', 'Amount'], ...d.rows.map((r) => [r.risNo, r.office, r.stockNo, r.description, r.unit, r.qty, r.unitCost, r.amount])] : [['Account', 'Stock no.', 'Article', 'Unit', 'Unit value', 'Balance per card', 'Value'], ...d.rows.map((r) => [r.code, r.stockNo, r.description, r.unit, r.unitValue, r.qty, r.value])])));
}
