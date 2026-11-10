// Card file: suppliers and contractors, employees, accountable officers (with their fidelity
// bond), government agencies and individuals. Each card shows its subsidiary ledgers (payables,
// advances, receivables), its documents and the taxes withheld from it.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, modal, toast, formData, option, badge, fmtDate } from '../../ui.js';
import { today as localDate } from '../../ui.js';
import { fin, can, money, num, infoGrid, officeOptions, clickableRows, dvBadge, poBadge, orsBadge, amt } from '../state.js';

const kindLabel = (k) => fin.settings.cardKinds.find(([v]) => v === k)?.[1] || k;

export async function cardListView(el, _p, query) {
  const kind = query.kind || '';
  const list = await api.get(`/api/finance/cards?${new URLSearchParams({ kind, q: query.q || '', ...(query.all ? { all: 1 } : {}) })}`);
  const edit = can('finance.cardfile');
  mount(el, html`
    ${pageHead('Card file', 'Everyone the school pays or collects from: suppliers, employees, accountable officers, agencies and individuals, each with its own subsidiary ledger.', edit ? html`<button class="btn primary" id="add">${icon('plus', 16)} New card</button>` : '')}
    <nav class="tabs">${[['', 'All'], ...fin.settings.cardKinds].map(([v, l]) => html`<a href="#/cards?kind=${v}" class="${v === kind ? 'active' : ''}">${l.split(' /')[0]}</a>`)}</nav>
    <form class="toolbar" id="find"><input type="search" name="q" value="${query.q || ''}" placeholder="Name, TIN or address" /><label class="check-row inline"><input type="checkbox" name="all" ${query.all ? 'checked' : ''} /> Include inactive</label><button class="btn">${icon('search', 16)} Find</button></form>
    ${list.length ? html`<div class="card"><div class="table-scroll"><table class="table" id="rows">
      <thead><tr><th>Name</th><th>Kind</th><th>TIN</th><th>Tax</th><th class="num">Payable</th><th class="num">Advances</th><th class="num">Receivable</th></tr></thead>
      <tbody>${list.map((c) => html`<tr data-href="/cards/${c.id}"><td><a href="#/cards/${c.id}"><strong>${c.name}</strong></a>${c.status !== 'active' ? html` ${badge(c.status, c.status === 'blacklisted' ? 'red' : 'gray')}` : ''}<small>${c.address || c.userName || ''}</small></td>
        <td>${kindLabel(c.kind)}</td><td class="nowrap">${c.tin || '—'}</td><td>${c.vat === 'vat' ? 'VAT' : c.vat === 'nonvat' ? 'Non-VAT' : 'Exempt'}<small>${c.taxType === 'corporation' ? 'Corporation' : 'Individual'}</small></td>
        ${amt(c.payable, { blankZero: true })}${amt(c.advances, { blankZero: true })}${amt(c.receivable, { blankZero: true })}</tr>`)}</tbody></table></div></div>`
      : html`<div class="card empty">${icon('users', 40)}<h2>No cards</h2><p>${query.q ? 'Nothing matches.' : 'Add suppliers, employees and officers as the school deals with them.'}</p></div>`}`);
  clickableRows(el);
  el.querySelector('#find').onsubmit = (e) => {
    e.preventDefault();
    const v = formData(e.target);
    location.hash = `#/cards?${new URLSearchParams({ kind, q: v.q, ...(v.all ? { all: 1 } : {}) })}`;
  };
  el.querySelector('#add')?.addEventListener('click', () => cardForm(null, () => cardListView(el, _p, query)));
}

export async function cardForm(card, done) {
  const c = card || { kind: 'supplier', vat: 'vat', taxType: 'corporation', nature: 'goods', status: 'active', bond: {} };
  // ATLAS accounts that can be linked (loaded first, so saving never drops the current link).
  const users = await api.get('/api/finance/cards/linkable').catch(() => []);
  if (c.userId && !users.some((u) => u.id === c.userId)) users.unshift({ id: c.userId, name: c.userName || 'Linked account', roleLabel: 'current link' });
  // On an existing card, what decides who is paid (name, bank details, status, bond) is changed
  // by the Chief Accountant or an administrator only.
  const lock = card && !can('finance.accounts') ? 'disabled' : '';
  modal({
    title: card ? `Edit ${card.name}` : 'New card', wide: true, submitLabel: card ? 'Save' : 'Add card',
    body: html`${lock ? html`<p class="hint" style="margin-bottom:12px">${icon('lock', 14)} The name, bank details, status and bond are changed by the Chief Accountant or an administrator: they decide who is paid.</p>` : ''}<div class="grid two">
      <label class="field"><span>Kind</span><select name="kind">${fin.settings.cardKinds.map(([v, l]) => option(v, l, v === c.kind))}</select></label>
      <label class="field"><span>Status</span><select name="status" ${lock}>${[['active', 'Active'], ['inactive', 'Inactive'], ['blacklisted', 'Blacklisted (no orders or payments)']].map(([v, l]) => option(v, l, v === c.status))}</select></label>
      <label class="field span-2"><span>Name (registered name for suppliers)</span><input name="name" value="${c.name || ''}" required ${lock} /></label>
      <label class="field"><span>TIN</span><input name="tin" value="${c.tin || ''}" placeholder="123-456-789-000" /></label>
      <label class="field"><span>Tax status</span><select name="vat">${fin.settings.vatStatus.map(([v, l]) => option(v, l, v === c.vat))}</select></label>
      <label class="field"><span>Taxpayer type</span><select name="taxType">${option('corporation', 'Corporation / partnership', c.taxType === 'corporation')}${option('individual', 'Individual (incl. sole proprietor)', c.taxType === 'individual')}</select></label>
      <label class="field"><span>Usual payments (for withholding)</span><select name="nature">${fin.settings.natures.map(([v, l]) => option(v, l, v === c.nature))}</select></label>
      <label class="field span-2"><span>Address</span><input name="address" value="${c.address || ''}" /></label>
      <label class="field"><span>Contact person</span><input name="contact" value="${c.contact || ''}" /></label>
      <label class="field"><span>Phone</span><input name="phone" value="${c.phone || ''}" /></label>
      <label class="field"><span>Email</span><input name="email" type="email" value="${c.email || ''}" /></label>
      <label class="field"><span>Position (employees and officers)</span><input name="position" value="${c.position || ''}" /></label>
      <label class="field"><span>Bank</span><input name="bankName" value="${c.bankName || ''}" ${lock} /></label>
      <label class="field"><span>Bank account number (for LDDAP-ADA)</span><input name="bankAccount" value="${c.bankAccount || ''}" ${lock} /></label>
      <label class="field"><span>Office</span><select name="office">${officeOptions(c.office)}</select></label>
      <label class="field"><span>ATLAS account (employees: self-service)</span><select name="userId"><option value="">None</option>${users.map((u) => option(u.id, `${u.name} · ${u.roleLabel}`, u.id === c.userId))}</select></label>
      <fieldset class="field span-2 bond"><legend>Fidelity bond (accountable officers)</legend><div class="grid three-tight">
        <label class="field"><span>Amount</span><input name="bondAmount" type="number" step="0.01" min="0" value="${c.bond?.amount || ''}" ${lock} /></label>
        <label class="field"><span>Expires</span><input name="bondExpires" type="date" value="${c.bond?.expires || ''}" ${lock} /></label>
        <label class="field"><span>Bond / policy no.</span><input name="bondPolicy" value="${c.bond?.policy || ''}" ${lock} /></label></div></fieldset>
      <label class="field span-2"><span>Notes</span><textarea name="notes" rows="2">${c.notes || ''}</textarea></label>
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const body = lock ? v : { ...v, bond: { amount: Number(v.bondAmount) || 0, expires: v.bondExpires, policy: v.bondPolicy } };
      if (card) await api.put(`/api/finance/cards/${card.id}`, body);
      else await api.post('/api/finance/cards', body);
      fin.forget();
      toast(card ? 'Card saved.' : 'Card added.');
      done();
    },
  });
}

export async function cardView(el, params, query) {
  const d = await api.get(`/api/finance/cards/${params.id}`);
  const c = d.card;
  const tab = query.tab || 'ledger';
  const reload = () => cardView(el, params, query);
  const bondOk = c.bond?.amount > 0 && c.bond.expires >= localDate();
  mount(el, html`
    ${pageHead(html`${c.name} ${c.status !== 'active' ? badge(c.status, c.status === 'blacklisted' ? 'red' : 'gray') : ''}`, kindLabel(c.kind), can('finance.cardfile') ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit</button>` : '', ['/cards', 'Card file'])}
    <section class="card">${infoGrid([
      ['TIN', c.tin], ['Tax', `${c.vat === 'vat' ? 'VAT-registered' : c.vat === 'nonvat' ? 'Non-VAT' : 'Exempt'} · ${c.taxType}`], ['Address', c.address], ['Contact', [c.contact, c.phone, c.email].filter(Boolean).join(' · ')],
      ['Bank', [c.bankName, c.bankAccount].filter(Boolean).join(' · ')], c.userName && ['ATLAS account', c.userName], c.position && ['Position', c.position],
      ['officer', 'employee'].includes(c.kind) && ['Fidelity bond', c.bond?.amount ? html`${money(c.bond.amount)} until ${fmtDate(c.bond.expires)} ${bondOk ? badge('Valid', 'green') : badge('Expired', 'red')}` : 'None'],
    ])}</section>
    <nav class="tabs">${[['ledger', 'Subsidiary ledgers'], ['docs', 'Documents'], ['taxes', 'Taxes withheld'], ['property', `Property (${d.property.length})`]].map(([k, l]) => html`<a href="#/cards/${c.id}?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</nav>
    ${tab === 'ledger' ? (d.ledgers.length ? d.ledgers.map((g) => html`<section class="card"><div class="card-head"><h2>${g.code} · ${g.title}</h2><strong>${money(g.balance)}</strong></div>
      <div class="table-scroll"><table class="table compact"><thead><tr><th>Date</th><th>JEV</th><th>Particulars</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
      <tbody>${g.rows.map((r) => html`<tr><td class="nowrap">${fmtDate(r.date)}</td><td><a href="#/journals/${r.journalId}">${r.jevNo}</a></td><td>${r.particulars}</td>${amt(r.debit, { blankZero: true })}${amt(r.credit, { blankZero: true })}${amt(r.balance)}</tr>`)}</tbody></table></div></section>`) : html`<div class="card empty"><p>No entries on this card yet.</p></div>`) : ''}
    ${tab === 'docs' ? html`
      <section class="card"><h2>Disbursement vouchers</h2>${d.dvs.length ? html`<table class="table compact"><thead><tr><th>DV</th><th>Date</th><th>Particulars</th><th class="num">Gross</th><th class="num">Net</th><th>Status</th></tr></thead><tbody>${d.dvs.map((x) => html`<tr><td><a href="#/dvs/${x.id}">${x.no || 'Draft'}</a></td><td class="nowrap">${fmtDate(x.date)}</td><td>${x.particulars}</td>${amt(x.gross)}${amt(x.net)}<td>${dvBadge(x)}</td></tr>`)}</tbody></table>` : html`<p class="muted">None.</p>`}</section>
      <section class="card"><h2>Obligations</h2>${d.obligations.length ? html`<table class="table compact"><thead><tr><th>No.</th><th>Date</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${d.obligations.map((x) => html`<tr><td><a href="#/obligations/${x.id}">${x.form} ${x.no || '(draft)'}</a></td><td class="nowrap">${fmtDate(x.date)}</td>${amt(x.amount)}<td>${orsBadge(x)}</td></tr>`)}</tbody></table>` : html`<p class="muted">None.</p>`}</section>
      <section class="card"><h2>Purchase orders</h2>${d.pos.length ? html`<table class="table compact"><thead><tr><th>PO</th><th>Date</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>${d.pos.map((x) => html`<tr><td><a href="#/pos/${x.id}">${x.no}</a></td><td class="nowrap">${fmtDate(x.date)}</td>${amt(x.total)}<td>${poBadge(x.status)}</td></tr>`)}</tbody></table>` : html`<p class="muted">None.</p>`}</section>
      <section class="card"><h2>Official receipts</h2>${d.receipts.length ? html`<table class="table compact"><thead><tr><th>O.R.</th><th>Date</th><th class="num">Amount</th></tr></thead><tbody>${d.receipts.map((x) => html`<tr><td><a href="#/print/or/${x.id}">${x.no}</a> ${x.status === 'cancelled' ? badge('Cancelled', 'gray') : ''}</td><td class="nowrap">${fmtDate(x.date)}</td>${amt(x.total)}</tr>`)}</tbody></table>` : html`<p class="muted">None.</p>`}</section>` : ''}
    ${tab === 'taxes' ? html`<section class="card"><h2>Taxes withheld, by quarter</h2>${d.taxes.length ? html`<table class="table compact"><thead><tr><th>Quarter</th><th>ATC</th><th class="num">Income payment</th><th class="num">Tax withheld</th><th></th></tr></thead>
      <tbody>${d.taxes.map((t) => html`<tr><td>${t.quarter}</td><td>${t.atc}</td>${amt(t.base)}${amt(t.amount)}<td><a class="btn sm" href="#/print/2307/${c.id}?year=${t.quarter.slice(0, 4)}&quarter=${t.quarter.slice(-1)}${/^WV|^WB/.test(t.atc) ? '&kind=vat' : ''}">${icon('file', 14)} BIR 2307</a></td></tr>`)}</tbody></table>` : html`<p class="muted">Nothing withheld from this payee yet.</p>`}</section>` : ''}
    ${tab === 'property' ? html`<section class="card"><h2>Property in their custody</h2>${d.property.length ? html`<table class="table compact"><thead><tr><th>Property no.</th><th>Description</th><th>PAR / ICS</th><th class="num">Cost</th></tr></thead><tbody>${d.property.map((p) => html`<tr><td><a href="#/property/${p.id}">${p.propertyNo}</a></td><td>${p.description}</td><td>${p.type === 'ppe' ? 'PAR' : 'ICS'} ${p.docNo}</td>${amt(p.cost)}</tr>`)}</tbody></table>` : html`<p class="muted">None.</p>`}</section>` : ''}`);
  el.querySelector('#edit')?.addEventListener('click', () => cardForm(c, reload));
  void ctx;
  void num;
}
