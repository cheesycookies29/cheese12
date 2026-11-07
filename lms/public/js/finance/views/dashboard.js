// The finance offices' home: what is waiting for each office, cash by fund, budget utilization
// by allotment class and collections against the revenue target.
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, timeAgo, fmtDate } from '../../ui.js';
import { can, money, num, monthName, clickableRows } from '../state.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const compact = (v) => (v >= 1e6 ? `₱${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `₱${Math.round(v / 1e3)}K` : `₱${Math.round(v)}`);

export async function dashboardView(el) {
  const d = await api.get('/api/finance/dashboard');
  const q = d.queue;
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const items = [
    can('finance.budget') && q.orsToObligate && ['clipboard', `${plural(q.orsToObligate, 'obligation request')} to certify (Box B)`, 'Check the allotment and obligate.', '#/obligations?status=pending'],
    can('finance.accounts') && q.dvToCertify && ['file', `${plural(q.dvToCertify, 'voucher')} to certify (Box C)`, 'Cash available, documents complete, amount proper.', '#/dvs?status=pending'],
    can('finance.approve') && q.dvToApprove && ['check', `${plural(q.dvToApprove, 'voucher')} to approve (Box D)`, 'Certified by the accountant.', '#/dvs?status=certified'],
    can('finance.disburse') && q.dvToPay && ['bank', `${plural(q.dvToPay, 'voucher')} to pay`, 'Approved: issue the check or put them on an LDDAP-ADA.', '#/dvs?status=approved'],
    can('finance.approve') && q.prToApprove && ['cart', `${plural(q.prToApprove, 'purchase request')} to approve`, 'From the school\'s offices.', '#/prs?status=submitted'],
    can('finance.approve') && q.poToApprove && ['truck', `${plural(q.poToApprove, 'purchase order')} to approve`, 'Funds are obligated.', '#/pos?status=draft'],
    can('finance.inventory') && q.risToIssue && ['inbox', `${plural(q.risToIssue, 'requisition')} to issue`, 'Supplies requested by offices.', '#/ris?status=open'],
    can('finance.accounts') && q.draftJournals && ['book', `${plural(q.draftJournals, 'draft journal entry', 'draft journal entries')}`, 'Post or delete them.', '#/journals?status=draft'],
    can('finance.collect') && q.unreported && ['receipt', `${plural(q.unreported, 'official receipt')} not yet reported`, 'Prepare the Report of Collections and Deposits.', '#/rcds'],
    can('finance.collect') && q.undeposited && ['bank', `${plural(q.undeposited, 'collection report')} not deposited`, 'Collections are deposited intact, the next banking day at the latest.', '#/rcds'],
    (can('finance.disburse') || can('finance.accounts')) && q.advancesOverdue && ['flag', `${plural(q.advancesOverdue, 'cash advance')} past due for liquidation`, 'No new advance for these officers until settled.', '#/advances'],
    can('finance.property') && q.depreciationDue && ['down', `Depreciation not yet booked for ${plural(q.depreciationDue, 'item')}`, 'Run it for last month.', '#/depreciation'],
    (can('finance.inventory') || can('finance.procure')) && q.lowStock && ['box', `${plural(q.lowStock, 'stock item')} at or below the reorder point`, 'Time for a purchase request.', '#/items?low=1'],
  ].filter(Boolean);
  const totalCash = d.cash.reduce((s, f) => s + f.total, 0);
  const allot = d.budget.reduce((s, r) => s + r.allotment, 0);
  const oblig = d.budget.reduce((s, r) => s + r.obligations, 0);
  const disb = d.budget.reduce((s, r) => s + r.disbursements, 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const maxRev = Math.max(1, ...d.revenue.months);
  mount(el, html`
    ${pageHead('Finance dashboard', `Fiscal year ${d.year}${d.lockedThrough ? ` · books closed through ${monthName(d.lockedThrough)}` : ''}`)}
    <div class="stats">
      <a class="card" href="#/trial-balance"><small>Cash, all funds</small><strong>${money(totalCash)}</strong><span class="muted small">${d.cash.length} fund cluster${d.cash.length === 1 ? '' : 's'}</span></a>
      <a class="card" href="#/budget"><small>Allotments obligated</small><strong>${pct(oblig, allot)}%</strong><span class="muted small">${money(oblig)} of ${money(allot)}</span></a>
      <a class="card" href="#/budget-reports"><small>Obligations paid</small><strong>${pct(disb, oblig)}%</strong><span class="muted small">${money(disb)} disbursed</span></a>
      <a class="card" href="#/revenue"><small>Collections this year</small><strong>${money(d.revenue.total)}</strong><span class="muted small">${d.revenue.target ? `${pct(d.revenue.total, d.revenue.target)}% of the ${money(d.revenue.target)} target` : 'No target set'}</span></a>
    </div>
    <div class="cols wide-left">
      <section class="card">
        <div class="card-head"><h2>${icon('inbox')} Waiting for you</h2></div>
        ${items.length
          ? html`<div class="list">${items.map(([ic, title, text, href]) => html`<a class="list-item" href="${href}"><span class="item-ic">${icon(ic, 16)}</span><span class="grow"><strong>${title}</strong><small>${text}</small></span>${icon('chevronRight', 16)}</a>`)}</div>`
          : html`<div class="notice ok">${icon('checkCircle')}<p>Nothing is waiting for you.</p></div>`}
        <h3 class="sub-h">Budget utilization, ${d.year}</h3>
        ${d.budget.length ? html`<div class="table-scroll"><table class="table compact">
          <thead><tr><th>Class</th><th class="num">Allotment</th><th class="num">Obligations</th><th class="num">Disbursements</th><th class="num">Unobligated</th><th class="util">Used</th></tr></thead>
          <tbody>${d.budget.map((r) => html`<tr><td><strong>${r.cls}</strong><small>${r.label}</small></td><td class="num">${num(r.allotment)}</td><td class="num">${num(r.obligations)}</td><td class="num">${num(r.disbursements)}</td><td class="num">${num(r.unobligated)}</td>
            <td class="util"><span class="util-v"><span class="meter" aria-hidden="true"><i style="width:${Math.min(100, pct(r.obligations, r.allotment))}%"></i><b style="width:${Math.min(100, pct(r.disbursements, r.allotment))}%"></b></span><span class="num">${pct(r.obligations, r.allotment)}%</span></span></td></tr>`)}</tbody></table></div>
          <div class="legend"><span><i class="s-approved"></i>Obligated</span><span><i class="s-posted"></i>Disbursed</span></div>` : html`<p class="muted">No allotments recorded for ${d.year}. <a href="#/budget">Record them</a>.</p>`}
      </section>
      <div class="stack">
        <section class="card">
          <div class="card-head"><h2>${icon('bank')} Cash by fund</h2><a href="#/trial-balance">Trial balance ${icon('chevronRight', 14)}</a></div>
          ${d.cash.map((f) => html`<div class="fund-cash"><div class="fund-row"><strong>Fund ${f.fund}</strong><span>${money(f.total)}</span></div><small class="muted">${f.name}</small>
            ${f.accounts.map((a) => html`<div class="fund-acct"><a href="#/ledger/${a.code}?fund=${f.fund}">${a.title}</a><span>${num(a.balance)}</span></div>`)}</div>`)}
        </section>
        <section class="card">
          <div class="card-head"><h2>${icon('receipt')} Collections by month</h2><strong class="num">${money(d.revenue.total)}</strong></div>
          <div class="bars" role="img" aria-label="Collections by month: ${d.revenue.months.map((v, i) => `${MONTHS[i]} ${money(v)}`).join(', ')}">${d.revenue.months.map((v, i) => html`<div class="bar" title="${MONTHS[i]}: ${money(v)}">${v === maxRev && v > 0 ? html`<em>${compact(v)}</em>` : ''}<i style="height:${Math.round((v / maxRev) * 100)}%"></i><span>${MONTHS[i]}</span></div>`)}</div>
          <p class="muted small">Own-source collections on official receipts. Point at a month for its amount.</p>
        </section>
      </div>
    </div>
    <section class="card">
      <div class="card-head"><h2>${icon('clock')} Recent activity</h2><a href="#/audit">Audit trail ${icon('chevronRight', 14)}</a></div>
      ${d.recent.length ? html`<div class="list">${d.recent.map((a) => html`<div class="list-item"><span class="item-ic">${icon('edit', 16)}</span><span class="grow"><strong>${a.action}</strong><small>${a.by} · ${timeAgo(a.at)}</small></span></div>`)}</div>` : html`<p class="muted">Nothing yet.</p>`}
    </section>`);
}

// Find a document by its number: DV, JEV, ORS/BURS, PR, PO, IAR, RIS, O.R., RCD, LDDAP-ADA, property, or a payee.
export async function findView(el, _p, query) {
  const q = query.q || '';
  const list = q.length >= 2 ? await api.get(`/api/finance/find?q=${encodeURIComponent(q)}`) : [];
  mount(el, html`
    ${pageHead('Find a document', 'Type a number from the paper form (DV, JEV, ORS/BURS, PR, PO, IAR, RIS, O.R., RCD, LDDAP-ADA, property or PAR/ICS no.), a check number, or a payee or supplier\'s name.')}
    <form class="toolbar find-bar" id="f" role="search"><input type="search" name="q" value="${q}" placeholder="e.g. 01-2026-11-0001, 4512031, Bicol Office" aria-label="Document number or name" autofocus /><button class="btn primary">${icon('search', 16)} Find</button></form>
    ${q.length >= 2 ? (list.length ? html`<div class="card"><table class="table"><thead><tr><th>Document</th><th>Number</th><th>Date</th><th>Details</th></tr></thead>
      <tbody>${list.map((r) => html`<tr data-href="${r.href}"><td>${r.kind}</td><td class="nowrap"><a href="#${r.href}"><strong>${r.no}</strong></a></td><td class="nowrap">${r.date ? fmtDate(r.date) : ''}</td><td>${r.text}</td></tr>`)}</tbody></table>
      ${list.length === 60 ? html`<p class="muted small">Showing the 60 most recent matches; type more of the number to narrow it down.</p>` : ''}</div>`
      : html`<div class="card empty">${icon('search', 40)}<h2>Nothing found for “${q}”</h2><p>Check the number, or search by the payee's name.</p></div>`) : ''}`);
  clickableRows(el);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const v = new FormData(e.target).get('q').trim();
    location.hash = `#/find?q=${encodeURIComponent(v)}`;
  };
}
