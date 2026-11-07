// Self-service. Employees: the property in their custody (PAR/ICS) and their cash advances, and
// their supply requisitions and purchase requests. Students: their official receipts.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, fmtDate, badge } from '../../ui.js';
import { money, isStudent, amt, prBadge, risBadge, clickableRows } from '../state.js';
import { risForm, prForm } from './inventory.js';

export async function myView(el) {
  const d = await api.get('/api/finance/my');
  const receipts = html`<section class="card">${isStudent() ? '' : html`<h2>${icon('receipt')} Official receipts issued to me</h2>`}
    ${d.receipts.length ? html`<div class="table-scroll"><table class="table"><thead><tr><th>O.R. no.</th><th>Date</th><th>For</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>${d.receipts.map((r) => html`<tr><td><strong>${r.no}</strong></td><td>${fmtDate(r.date)}</td><td>${r.lines.map((l) => l.description).join(', ')}</td>${amt(r.total)}<td><a class="btn sm" href="#/print/or/${r.id}">${icon('file', 14)} View</a></td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">No payments recorded yet. Receipts issued by the cashier in your name appear here.</p>`}</section>`;
  if (isStudent()) {
    mount(el, html`${pageHead('My payments', `${ctx.user.name}${ctx.user.studentNo ? ` · ${ctx.user.studentNo}` : ''}`)}${receipts}`);
    return;
  }
  const total = d.property.reduce((s, p) => s + p.cost, 0);
  mount(el, html`
    ${pageHead('My accountabilities', ctx.user.name, html`<a class="btn" href="#/me/requests">${icon('cart', 16)} Supply & purchase requests</a>`)}
    ${!d.card ? html`<div class="notice info">${icon('flag')}<p>Your account is not linked to a card in the Finance card file yet, so no property or cash advance is shown. Ask the accounting office to link it.</p></div>` : ''}
    <div class="stats"><div class="card"><small>Property in my custody</small><strong>${d.property.length}</strong><span class="muted small">${money(total)}</span></div>
      <div class="card ${d.advances.some((a) => a.overdue) ? 'warn' : ''}"><small>Unliquidated cash advances</small><strong>${money(d.advances.reduce((s, a) => s + a.outstanding, 0))}</strong><span class="muted small">${d.advances.length} advance${d.advances.length === 1 ? '' : 's'}</span></div>
      <div class="card"><small>My requisitions</small><strong>${d.requisitions}</strong></div></div>
    <section class="card"><h2>${icon('building')} Property in my custody</h2>
      ${d.property.length ? html`<div class="table-scroll"><table class="table"><thead><tr><th>Property no.</th><th>Description</th><th>Receipt</th><th>Acquired</th><th class="num">Cost</th></tr></thead>
      <tbody>${d.property.map((p) => html`<tr><td><strong>${p.propertyNo}</strong>${p.serialNo ? html`<small>S/N ${p.serialNo}</small>` : ''}</td><td>${p.description}</td><td>${p.type === 'ppe' ? 'PAR' : 'ICS'} ${p.docNo}</td><td>${fmtDate(p.acquired)}</td>${amt(p.cost)}</tr>`)}</tbody></table></div>
      <p class="muted small">You are accountable for these until they are returned to the supply office or transferred on a PTR/ITR.</p>` : html`<p class="muted">None.</p>`}</section>
    <section class="card"><h2>${icon('coins')} Cash advances</h2>
      ${d.advances.length ? html`<table class="table"><thead><tr><th>DV</th><th>Purpose</th><th>Granted</th><th>Liquidate by</th><th class="num">Outstanding</th></tr></thead>
      <tbody>${d.advances.map((a) => html`<tr><td>${a.no}</td><td>${a.particulars}</td><td>${fmtDate(a.paidDate)}</td><td>${fmtDate(a.due)} ${a.overdue ? badge('Overdue', 'red') : ''}</td>${amt(a.outstanding)}</tr>`)}</tbody></table>` : html`<p class="muted">None outstanding.</p>`}</section>
    ${receipts}`);
}

export async function myRequestsView(el) {
  const [ris, prs] = await Promise.all([api.get('/api/finance/ris'), api.get('/api/finance/prs')]);
  const mine = (l) => l.filter((x) => x.requestedBy.userId === ctx.user.id);
  mount(el, html`
    ${pageHead('Supply & purchase requests', 'Ask the supply office for supplies in stock (RIS), or for something to be bought (PR).', html`<button class="btn" id="pr">${icon('cart', 16)} Purchase request</button><button class="btn primary" id="ris">${icon('inbox', 16)} Request supplies</button>`)}
    <section class="card"><h2>Requisitions (RIS)</h2>${mine(ris).length ? html`<table class="table"><thead><tr><th>RIS no.</th><th>Purpose</th><th>Items</th><th>Status</th></tr></thead>
      <tbody>${mine(ris).map((r) => html`<tr data-href="/ris/${r.id}"><td><a href="#/ris/${r.id}">${r.no}</a><small>${fmtDate(r.date)}</small></td><td>${r.purpose}</td><td>${r.items.map((i) => `${i.qty} ${i.unit} ${i.description}`).join(', ')}</td><td>${risBadge(r.status)}</td></tr>`)}</tbody></table>` : html`<p class="muted">None yet.</p>`}</section>
    <section class="card"><h2>Purchase requests (PR)</h2>${mine(prs).length ? html`<table class="table"><thead><tr><th>PR no.</th><th>Purpose</th><th class="num">Estimate</th><th>Status</th></tr></thead>
      <tbody>${mine(prs).map((p) => html`<tr data-href="/prs/${p.id}"><td><a href="#/prs/${p.id}">${p.no}</a><small>${fmtDate(p.date)}</small></td><td>${p.purpose}</td>${amt(p.total)}<td>${prBadge(p.status)}</td></tr>`)}</tbody></table>` : html`<p class="muted">None yet.</p>`}</section>`);
  clickableRows(el);
  el.querySelector('#ris').addEventListener('click', () => risForm());
  el.querySelector('#pr').addEventListener('click', () => prForm());
}
