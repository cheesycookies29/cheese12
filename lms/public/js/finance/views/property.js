// Property: PPE and semi-expendable property — the register, each item's property card with its
// PAR/ICS, transfers (PTR/ITR), returns and disposal (IIRUP); monthly depreciation; the reports on
// the physical count of PPE (RPCPPE) and of semi-expendable property (RPCSP).
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, modal, toast, formData, option, fmtDate, badge, downloadFile, toCsv } from '../../ui.js';
import { today as localDate } from '../../ui.js';
import { fin, can, money, num, monthName, fundOptions, officeOptions, accountOptions, cardOptions, clickableRows, amt, infoGrid, printLink } from '../state.js';

const today = () => localDate(); // the browser's own date, not UTC
const lastMonth = () => {
  const d = new Date();
  d.setDate(0);
  return localDate(d).slice(0, 7);
};
const statusBadge = (s) => badge({ 'in-stock': 'In stock', issued: 'Issued', returned: 'Returned', disposed: 'Disposed' }[s] || s, { 'in-stock': 'blue', issued: 'green', returned: 'amber', disposed: 'gray' }[s]);

export async function propertyListView(el, _p, query) {
  const type = query.type || 'ppe';
  const status = query.status ?? 'active';
  const list = await api.get(`/api/finance/property?${new URLSearchParams({ type, status, q: query.q || '' })}`);
  const chart = await fin.chart();
  const edit = can('finance.property');
  mount(el, html`
    ${pageHead('Property', `PPE (unit cost of ${money(fin.settings.capitalization)} or more) is depreciated; semi-expendable property is expensed when issued and tracked on an ICS.`, html`<a class="btn" href="#/property-reports?type=${type}">${icon('clipboard', 16)} Physical count report</a>${edit ? html`<button class="btn primary" id="add">${icon('plus', 16)} Register existing property</button>` : ''}`)}
    <nav class="tabs">${[['ppe', 'Property, plant and equipment'], ['semi', 'Semi-expendable']].map(([k, l]) => html`<a href="#/property?type=${k}" class="${k === type ? 'active' : ''}">${l}</a>`)}</nav>
    <form class="toolbar" id="f"><input type="hidden" name="type" value="${type}" /><select name="status">${[['active', 'Not disposed'], ['in-stock', 'In stock'], ['issued', 'Issued'], ['returned', 'Returned'], ['disposed', 'Disposed'], ['', 'All']].map(([v, l]) => option(v, l, v === status))}</select>
      <input type="search" name="q" value="${query.q || ''}" placeholder="Property no., description, serial, custodian" /><button class="btn">${icon('search', 16)} Find</button></form>
    ${list.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>Property no.</th><th>Description</th><th>Account</th><th>Acquired</th><th class="num">Cost</th>${type === 'ppe' ? html`<th class="num">Book value</th>` : html`<th>Value class</th>`}<th>Custodian</th><th>Status</th></tr></thead>
      <tbody>${list.map((p) => html`<tr data-href="/property/${p.id}"><td><a href="#/property/${p.id}"><strong>${p.propertyNo}</strong></a>${p.serialNo ? html`<small>S/N ${p.serialNo}</small>` : ''}</td><td>${p.description}</td><td><small>${p.accountTitle}</small></td><td class="nowrap">${fmtDate(p.acquired)}</td>${amt(p.cost)}
        ${type === 'ppe' ? amt(p.bookValue) : html`<td><small>${p.valueClass}</small></td>`}<td>${p.custodianName || '—'}${p.docNo ? html`<small>${type === 'ppe' ? 'PAR' : 'ICS'} ${p.docNo}</small>` : ''}</td><td>${statusBadge(p.status)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="4">${list.length} item${list.length === 1 ? '' : 's'}</td>${amt(list.reduce((s, p) => s + p.cost, 0), { strong: true })}${type === 'ppe' ? amt(list.reduce((s, p) => s + p.bookValue, 0), { strong: true }) : html`<td></td>`}<td colspan="2"></td></tr></tfoot></table></div></div>`
      : html`<div class="card empty">${icon('building', 40)}<h2>No property</h2><p>Property comes in through deliveries (IAR); register what the school already has.</p></div>`}`);
  clickableRows(el);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/property?${new URLSearchParams(formData(e.target))}`;
  };
  el.querySelector('#add')?.addEventListener('click', () => {
    const codes = type === 'ppe' ? fin.settings.ppeClasses.map((c) => c.code) : fin.settings.semiClasses.map((c) => c.code);
    modal({
      title: type === 'ppe' ? 'Register existing PPE' : 'Register existing semi-expendable property', wide: true, submitLabel: 'Register',
      body: html`<p class="muted small">For property already in the books (beginning balances). New purchases are registered automatically when their delivery is accepted.</p>
        <div class="grid two"><input type="hidden" name="type" value="${type}" />
        <label class="field span-2"><span>Description</span><input name="description" required /></label>
        <label class="field"><span>Account</span><select name="code">${accountOptions(chart, codes[0], (a) => codes.includes(a.code))}</select></label>
        <label class="field"><span>Property number (blank: next number)</span><input name="propertyNo" /></label>
        <label class="field"><span>Acquisition cost</span><input type="number" step="0.01" name="cost" required /></label>
        <label class="field"><span>Date acquired</span><input type="date" name="acquired" required /></label>
        <label class="field"><span>Fund cluster</span><select name="fund">${fundOptions(fin.settings.funds[0])}</select></label>
        <label class="field"><span>Serial number</span><input name="serialNo" /></label>
        ${type === 'ppe' ? html`<label class="field"><span>Useful life in years (blank: COA schedule)</span><input type="number" name="life" min="1" max="60" /></label><label class="field"><span>Accumulated depreciation already booked</span><input type="number" step="0.01" name="depBooked" value="0" /></label>` : html`<label class="field check"><input type="checkbox" name="expensed" checked /> <span>Already expensed (issued before)</span></label>`}
        <label class="field"><span>Office</span><select name="office">${officeOptions('')}</select></label><label class="field"><span>Location</span><input name="location" /></label></div>`,
      async onSubmit(form) {
        const v = formData(form);
        const p = await api.post('/api/finance/property', { ...v, expensed: Boolean(v.expensed) });
        toast(`Registered as ${p.propertyNo}.`);
        location.hash = `#/property/${p.id}`;
      },
    });
  });
}

export async function propertyView(el, params) {
  const p = await api.get(`/api/finance/property/${params.id}`);
  const cards = await fin.cardList();
  const reload = () => propertyView(el, params);
  const edit = can('finance.property') && p.status !== 'disposed';
  const doc = p.type === 'ppe' ? 'PAR' : 'ICS';
  const act = (action, title, body, submitLabel) => modal({
    title, submitLabel, body,
    async onSubmit(form) {
      await api.post(`/api/finance/property/${p.id}/${action}`, formData(form));
      toast('Done.');
      reload();
    },
  });
  const custodians = cardOptions(cards, '', ['employee', 'officer']);
  mount(el, html`
    ${pageHead(html`${p.propertyNo} ${statusBadge(p.status)}`, `${p.description} · ${p.accountTitle}`, html`
      ${p.status === 'issued' ? printLink(p.type === 'ppe' ? 'par' : 'ics', p.id, `Print ${doc}`) : ''}
      ${edit && ['in-stock', 'returned'].includes(p.status) ? html`<button class="btn primary" id="issue">Issue (${doc})</button>` : ''}
      ${edit && p.status === 'issued' ? html`<button class="btn" id="transfer">Transfer</button><button class="btn" id="return">Return</button>` : ''}
      ${edit ? html`<button class="btn danger ghost" id="dispose">Dispose (IIRUP)</button>` : ''}`, [`/property?type=${p.type}`, 'Property'])}
    <section class="card">${infoGrid([
      ['Acquisition cost', money(p.cost)], ['Date acquired', fmtDate(p.acquired)], ['Fund', p.fund], ['Source', p.source?.no ? `IAR ${p.source.no}` : 'Registered'],
      p.type === 'ppe' && ['Useful life', `${p.life} years`], p.type === 'ppe' && ['Residual value', money(p.residual)], p.type === 'ppe' && ['Monthly depreciation', money(p.monthly)],
      p.type === 'ppe' && ['Accumulated depreciation (booked)', money(p.depBooked)], p.type === 'ppe' && ['Book value', html`<strong>${money(p.bookValue)}</strong>`],
      p.type === 'semi' && ['Value class', p.valueClass], p.type === 'semi' && ['Expensed', p.expensed ? 'Yes (on issue)' : 'Not yet'],
      ['Custodian', p.custodianName ? html`<a href="#/cards/${p.custodianId}">${p.custodianName}</a> · ${doc} ${p.docNo}` : '—'], ['Office / location', [p.officeName, p.location].filter(Boolean).join(' · ') || '—'], p.serialNo && ['Serial no.', p.serialNo],
    ])}</section>
    <section class="card"><h2>Property card</h2><div class="table-scroll"><table class="table compact"><thead><tr><th>Date</th><th>Action</th><th>Reference</th><th>To</th><th>By</th><th>Remarks</th></tr></thead>
      <tbody>${p.history.map((h) => html`<tr><td class="nowrap">${fmtDate(h.date)}</td><td>${h.action}</td><td class="nowrap">${h.docNo ? `${h.action === 'Received' ? 'IAR' : h.action.startsWith('Disposed') ? 'IIRUP' : p.type === 'ppe' ? 'PAR' : 'ICS'} ${h.docNo}` : ''}</td><td>${h.to || ''}</td><td>${h.by}</td><td>${h.note || ''}${h.condition ? ` (${h.condition})` : ''}</td></tr>`)}</tbody></table></div></section>
    ${p.schedule ? html`<section class="card"><h2>Depreciation schedule</h2><p class="muted small">Straight line: (cost − ${fin.settings.residualRate}% residual) ÷ ${p.life * 12} months, from the month it is available for use (on or before the 15th) or the next month.</p>
      <table class="table compact"><thead><tr><th>End of</th><th class="num">Accumulated</th><th class="num">Book value</th></tr></thead><tbody>${p.schedule.map((s) => html`<tr><td>${s.year}</td>${amt(s.accumulated)}${amt(s.bookValue)}</tr>`)}</tbody></table></section>` : ''}`);
  el.querySelector('#issue')?.addEventListener('click', () => act('issue', `Issue ${p.propertyNo} (${doc})`, html`<label class="field"><span>Custodian (accountable employee)</span><select name="custodianId" required>${custodians}</select></label><label class="field"><span>Office</span><select name="office">${officeOptions(p.office)}</select></label><label class="field"><span>Location</span><input name="location" value="${p.location || ''}" /></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label>${p.type === 'semi' && !p.expensed ? html`<p class="notice info">Issuing semi-expendable property charges it to expense (Dr ${p.code.startsWith('10406') ? '50203220' : '50203210'} / Cr ${p.code}).</p>` : ''}`, 'Issue'));
  el.querySelector('#transfer')?.addEventListener('click', () => act('transfer', `Transfer ${p.propertyNo}`, html`<label class="field"><span>New custodian</span><select name="custodianId" required>${custodians}</select></label><label class="field"><span>Office</span><select name="office">${officeOptions(p.office)}</select></label><label class="field"><span>Reason (reassignment, relocation…)</span><input name="reason" required /></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label>`, 'Transfer'));
  el.querySelector('#return')?.addEventListener('click', () => act('return', `Return ${p.propertyNo}`, html`<label class="field"><span>Condition</span><select name="condition">${['Serviceable', 'Unserviceable', 'For repair'].map((c) => option(c, c))}</select></label><label class="field"><span>Remarks</span><input name="reason" /></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label>`, 'Return'));
  el.querySelector('#dispose')?.addEventListener('click', () => act('dispose', `Dispose of ${p.propertyNo}`, html`<p class="muted small">Inventory and Inspection Report of Unserviceable Property. ${p.type === 'ppe' ? 'The asset and its accumulated depreciation are taken off the books; the book value is a loss.' : ''}</p>
    <label class="field"><span>Mode of disposal</span><select name="mode">${['Destruction (beyond repair)', 'Sale at public auction', 'Sale through negotiation', 'Transfer to another agency', 'Donation', 'Loss (RLSDDP)'].map((m) => option(m, m))}</select></label>
    <label class="field"><span>Appraised value</span><input type="number" step="0.01" name="appraised" /></label><label class="field"><span>Remarks</span><input name="reason" /></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label>`, 'Dispose'));
}

export async function depreciationView(el, _p, query) {
  const month = query.month || lastMonth();
  const d = await api.get(`/api/finance/depreciation?month=${month}`);
  const reload = () => depreciationView(el, _p, query);
  mount(el, html`
    ${pageHead('Depreciation', 'Straight-line, monthly, by PPE class and fund: Dr depreciation expense, Cr accumulated depreciation. Months not yet booked are caught up.', html`<a class="btn" href="#/property-reports">${icon('clipboard', 16)} Physical count reports</a>`)}
    <form class="toolbar" id="f"><label>Through <input type="month" name="month" value="${month}" /></label><button class="btn">Preview</button>
      ${d.rows.length && can('finance.property') ? html`<span class="grow"></span><button type="button" class="btn primary" id="run">Book ${money(d.total)} through ${monthName(month)}</button>` : ''}</form>
    <div class="card">${d.rows.length ? html`<table class="table compact"><thead><tr><th>Fund</th><th>PPE account</th><th>Debit</th><th>Credit</th><th class="num">Items</th><th class="num">Amount</th></tr></thead>
      <tbody>${d.rows.map((r) => html`<tr><td>${r.fund}</td><td>${r.code} ${r.title}</td><td>${r.expense}</td><td>${r.accum}</td><td class="num">${r.items}</td>${amt(r.amount)}</tr>`)}</tbody><tfoot><tr><td colspan="5">Total</td>${amt(d.total, { strong: true })}</tr></tfoot></table>`
      : html`<div class="notice ok">${icon('checkCircle')}<p>Depreciation through ${monthName(month)} is fully booked.</p></div>`}</div>
    ${d.runs.length ? html`<section class="card"><h2>Booked</h2><table class="table compact"><thead><tr><th>Through</th><th>Fund</th><th class="num">Items</th><th class="num">Amount</th><th>JEV</th><th>By</th></tr></thead>
      <tbody>${d.runs.map((r) => html`<tr><td>${monthName(r.month)}</td><td>${r.fund}</td><td class="num">${r.items}</td>${amt(r.amount)}<td><a href="#/journals/${r.journalId}">${r.jevNo}</a></td><td>${r.by}</td></tr>`)}</tbody></table></section>` : ''}`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/depreciation?${new URLSearchParams(formData(e.target))}`;
  };
  el.querySelector('#run')?.addEventListener('click', async () => {
    try {
      const runs = await api.post('/api/finance/depreciation', { month });
      toast(`Booked: ${runs.map((r) => `fund ${r.fund} ${money(r.amount)}`).join(', ')}.`);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export async function propertyReportsView(el, _p, query) {
  const type = query.type === 'semi' ? 'semi' : 'ppe';
  const fund = query.fund || '';
  const asOf = query.asOf || today();
  const d = await api.get(`/api/finance/property-count?${new URLSearchParams({ type, fund, asOf })}`);
  const title = type === 'ppe' ? 'Report on the Physical Count of Property, Plant and Equipment' : 'Report on the Physical Count of Semi-Expendable Property';
  const sig = fin.settings.signatories;
  mount(el, html`
    ${pageHead('Property reports', `${type === 'ppe' ? 'RPCPPE' : 'RPCSP'}: ${title}${type === 'ppe' ? ' (GAM Appendix 74)' : ''}, the list the inventory committee counts against.`, html`<button class="btn" id="csv">${icon('download', 16)} CSV</button><button class="btn" onclick="print()">${icon('file', 16)} Print</button>`)}
    <nav class="tabs">${[['ppe', 'PPE'], ['semi', 'Semi-expendable']].map(([k, l]) => html`<a href="#/property-reports?type=${k}" class="${k === type ? 'active' : ''}">${l}</a>`)}</nav>
    <form class="toolbar" id="f"><input type="hidden" name="type" value="${type}" /><select name="fund">${fundOptions(fund, { all: true })}</select><label>As of <input type="date" name="asOf" value="${asOf}" /></label><button class="btn">Show</button></form>
    <div class="card"><div class="print-head"><strong>${fin.settings.entity.name}</strong><span>${title}</span><span>As of ${fmtDate(d.asOf)}${fund ? ` · fund ${fund}` : ''}</span></div>
      <div class="table-scroll"><table class="table compact"><thead><tr><th>Article / description</th><th>Property no.</th><th>Unit value</th><th>Custodian</th><th>Location</th><th>Per count</th><th>Shortage / overage</th><th>Remarks</th></tr></thead>
      <tbody>${d.groups.map((g) => html`<tr class="term-row"><td colspan="8">${g.code} · ${g.title} — ${g.items.length} item${g.items.length === 1 ? '' : 's'}, ${money(g.total)}</td></tr>${g.items.map((p) => html`<tr><td>${p.description}${p.serialNo ? html`<small>S/N ${p.serialNo}</small>` : ''}</td><td>${p.propertyNo}</td><td class="num">${num(p.cost)}</td><td>${p.custodianName || 'Supply office'}</td><td>${p.location || p.officeName || ''}</td><td></td><td></td><td></td></tr>`)}`)}</tbody>
      <tfoot><tr><td colspan="2">${d.count} items</td><td class="num"><strong>${num(d.total)}</strong></td><td colspan="5"></td></tr></tfoot></table></div>
      <div class="sign-row print-only"><div>Certified correct by:<br /><br />Inventory committee</div><div>Approved by:<br /><br /><strong>${sig.head.name}</strong><br />${sig.head.title}</div><div>Verified by:<br /><br />COA representative</div></div></div>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/property-reports?${new URLSearchParams(formData(e.target))}`;
  };
  el.querySelector('#csv').addEventListener('click', () => downloadFile(`${type === 'ppe' ? 'rpcppe' : 'rpcsp'}.csv`, toCsv([['Account', 'Description', 'Property no.', 'Unit value', 'Custodian', 'Location'], ...d.groups.flatMap((g) => g.items.map((p) => [g.code, p.description, p.propertyNo, p.cost, p.custodianName, p.location]))])));
}
