// Budget: appropriations, allotments and NCAs; obligation requests (ORS for fund 01, BURS for
// the other funds) with Box B; and the budget reports (SAAODB / FAR No. 1, RAOD, aging of
// obligations / FAR No. 3, SCBAA).
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, modal, toast, formData, option, fmtDate, downloadFile, toCsv } from '../../ui.js';
import { today as localDate } from '../../ui.js';
import { fundName, obligationForm, classOf } from '/shared/finance.js';
import { fin, can, money, num, fy, fundOptions, officeOptions, papOptions, classOptions, accountOptions, cardOptions, linesTable, wireLines, readLines, clickableRows, orsBadge, amt, infoGrid, printLink , trackChanges, busy } from '../state.js';

const today = () => localDate(); // the browser's own date, not UTC
// Who may prepare and change obligation requests (as the server allows).
const preparer = () => ['finance.budget', 'finance.procure', 'finance.disburse', 'finance.accounts', 'finance.inventory'].some((p) => can(p));
const papName = (code) => fin.settings.paps.find((p) => p.code === code)?.name || code;

// ----- Appropriations, allotments and NCAs -----
export async function budgetView(el, _p, query) {
  const tab = query.tab || 'allotments';
  const year = Number(query.fy) || fy();
  const fund = query.fund || '';
  const [opts, aps, als, ncas] = await Promise.all([
    api.get('/api/finance/budget/options'),
    api.get(`/api/finance/appropriations?fy=${year}${fund ? `&fund=${fund}` : ''}`),
    api.get(`/api/finance/allotments?fy=${year}${fund ? `&fund=${fund}` : ''}`),
    api.get('/api/finance/ncas'),
  ]);
  const edit = can('finance.budget');
  const reload = () => budgetView(el, _p, query);
  // Go to a tab, or redraw when already on it (setting the same address does nothing).
  const showTab = (t) => {
    const h = `#/budget?tab=${t}&fy=${year}&fund=${fund}`;
    if (location.hash === h) reload();
    else location.hash = h;
  };
  const sumOf = (l, k) => l.reduce((s, x) => s + x[k], 0);
  mount(el, html`
    ${pageHead('Budget and allotments', `Fiscal year ${year}. The authority to spend: appropriations (GAA, board-approved budgets) are released as allotments, which obligations are charged to.`, edit ? html`<button class="btn" id="add-ap">${icon('plus', 16)} Appropriation</button><button class="btn primary" id="add-al">${icon('plus', 16)} Allotment</button>${fin.settings.funds.includes('01') ? html`<button class="btn" id="add-nca">${icon('plus', 16)} NCA</button>` : ''}` : '')}
    <nav class="tabs">${[['allotments', 'Allotments'], ['appropriations', 'Appropriations'], ['ncas', 'Cash allocations (NCA)']].map(([k, l]) => html`<a href="#/budget?tab=${k}&fy=${year}&fund=${fund}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</nav>
    ${tab !== 'ncas' ? html`<form class="toolbar" id="f"><input type="hidden" name="tab" value="${tab}" /><input type="number" name="fy" value="${year}" min="2000" max="2100" aria-label="Fiscal year" style="width:110px" /><select name="fund">${fundOptions(fund, { all: true })}</select><button class="btn">Show</button></form>` : ''}
    ${tab === 'allotments' ? (als.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>Reference</th><th>Fund</th><th>PAP</th><th>Class</th><th class="num">Allotment</th><th class="num">Obligated</th><th class="num">Balance</th>${edit ? html`<th></th>` : ''}</tr></thead>
      <tbody>${als.map((a) => html`<tr><td><strong>${a.ref || '—'}</strong><small>${a.kind} · ${fmtDate(a.date)}</small></td><td>${a.fund}</td><td>${a.pap}<small>${a.papName}</small></td><td>${a.cls}</td>${amt(a.amount)}${amt(a.obligated)}${amt(a.balance, { strong: true })}
        ${edit ? html`<td class="row-actions">${a.obligated ? '' : html`<button class="btn sm danger ghost" data-del="${a.id}">Remove</button>`}</td>` : ''}</tr>`)}</tbody>
      <tfoot><tr><td colspan="4">Total</td>${amt(sumOf(als, 'amount'), { strong: true })}${amt(sumOf(als, 'obligated'), { strong: true })}${amt(sumOf(als, 'balance'), { strong: true })}${edit ? html`<td></td>` : ''}</tr></tfoot></table></div></div>`
      : html`<div class="card empty">${icon('wallet', 40)}<h2>No allotments for ${year}</h2><p>Record the GARO/SARO/ABM releases and board-approved budgets.</p></div>`) : ''}
    ${tab === 'appropriations' ? (aps.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>Reference</th><th>Fund</th><th>PAP</th><th>Class</th><th class="num">Appropriation</th><th class="num">Allotted</th><th class="num">Unreleased</th></tr></thead>
      <tbody>${aps.map((a) => html`<tr><td><strong>${a.ref || '—'}</strong><small>${a.kind}</small></td><td>${a.fund}</td><td>${a.pap}<small>${a.papName}</small></td><td>${a.cls}</td>${amt(a.amount)}${amt(a.allotted)}${amt(a.unreleased, { strong: true })}</tr>`)}</tbody>
      <tfoot><tr><td colspan="4">Total</td>${amt(sumOf(aps, 'amount'), { strong: true })}${amt(sumOf(aps, 'allotted'), { strong: true })}${amt(sumOf(aps, 'unreleased'), { strong: true })}</tr></tfoot></table></div></div>`
      : html`<div class="card empty">${icon('wallet', 40)}<h2>No appropriations for ${year}</h2><p>Record the GAA lines for the school, and the board-approved IGF/STF budget.</p></div>`) : ''}
    ${tab === 'ncas' ? html`<div class="stats"><div class="card"><small>NCAs received this year</small><strong>${money(ncas.received)}</strong></div><div class="card accent"><small>Cash – MDS, Regular (balance)</small><strong>${money(ncas.balance)}</strong></div></div>
      ${ncas.list.length ? html`<div class="card"><table class="table"><thead><tr><th>NCA no.</th><th>Date</th><th>Valid until</th><th>Particulars</th><th class="num">Amount</th><th>JEV</th></tr></thead>
      <tbody>${ncas.list.map((n) => html`<tr><td><strong>${n.no}</strong></td><td>${fmtDate(n.date)}</td><td>${fmtDate(n.validUntil)}</td><td>${n.particulars}</td>${amt(n.amount)}<td><a href="#/journals/${n.journalId}">${n.jevNo}</a></td></tr>`)}</tbody></table></div>` : html`<div class="card empty"><p>No NCAs recorded.</p></div>`}` : ''}`);
  el.querySelector('#f')?.addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/budget?${new URLSearchParams(formData(e.target))}`;
  });
  el.onclick = async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    try {
      await api.del(`/api/finance/allotments/${b.dataset.del}`);
      toast('Allotment removed.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const lineFields = (kinds, extra = '') => html`<div class="grid two">
    <label class="field"><span>Fiscal year</span><input type="number" name="fy" value="${year}" /></label>
    <label class="field"><span>Fund cluster</span><select name="fund">${fundOptions(fund || fin.settings.funds[0])}</select></label>
    <label class="field span-2"><span>Program / activity / project</span><select name="pap" required>${papOptions()}</select></label>
    <label class="field"><span>Allotment class</span><select name="cls">${classOptions('MOOE')}</select></label>
    <label class="field"><span>Kind</span><select name="kind">${kinds.map((k) => option(k, k))}</select></label>
    <label class="field"><span>Reference (GAA item, SARO/GARO no., board resolution)</span><input name="ref" required /></label>
    <label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label>
    <label class="field"><span>Amount</span><input type="number" step="0.01" min="0" name="amount" required /></label>
    ${extra}
    <label class="field span-2"><span>Particulars</span><input name="particulars" /></label></div>`;
  el.querySelector('#add-ap')?.addEventListener('click', () => modal({
    title: 'Record an appropriation', wide: true, submitLabel: 'Record',
    body: fin.settings.paps.length ? lineFields(opts.appropriationKinds) : html`<p>Add the school's programs/activities/projects (PAP) in the Control panel first.</p>`,
    async onSubmit(form) {
      await api.post('/api/finance/appropriations', formData(form));
      toast('Appropriation recorded.');
      showTab('appropriations');
    },
  }));
  el.querySelector('#add-al')?.addEventListener('click', () => modal({
    title: 'Record an allotment', wide: true, submitLabel: 'Record',
    body: fin.settings.paps.length ? lineFields(opts.allotmentKinds, html`<label class="field span-2"><span>Against appropriation (optional)</span><select name="appropriationId"><option value="">None (e.g. sub-allotment received)</option>${aps.map((a) => option(a.id, `${a.ref} · fund ${a.fund} · ${a.pap} · ${a.cls} · ${num(a.unreleased)} unreleased`))}</select></label>`) : html`<p>Add the school's programs/activities/projects (PAP) in the Control panel first.</p>`,
    async onSubmit(form) {
      await api.post('/api/finance/allotments', formData(form));
      toast('Allotment recorded.');
      showTab('allotments');
    },
  }));
  el.querySelector('#add-nca')?.addEventListener('click', () => modal({
    title: 'Notice of Cash Allocation received', submitLabel: 'Record',
    body: html`<p class="muted small">Posts Dr Cash – MDS, Regular / Cr Subsidy from National Government (fund 01).</p>
      <label class="field"><span>NCA number</span><input name="no" required /></label><label class="field"><span>Date received</span><input type="date" name="date" value="${today()}" /></label>
      <label class="field"><span>Amount</span><input type="number" step="0.01" min="0" name="amount" required /></label><label class="field"><span>Valid until</span><input type="date" name="validUntil" /></label>
      <label class="field"><span>Particulars</span><input name="particulars" placeholder="e.g. NCA for January–March MOOE" /></label>`,
    async onSubmit(form) {
      await api.post('/api/finance/ncas', formData(form));
      toast('NCA recorded.');
      showTab('ncas');
    },
  }));
}

// ----- Obligations -----
export async function obligationListView(el, _p, query) {
  const status = query.status ?? (can('finance.budget') ? 'pending' : '');
  const list = await api.get(`/api/finance/obligations?${new URLSearchParams({ status, q: query.q || '' })}`);
  mount(el, html`
    ${pageHead('Obligations', 'ORS for the Regular Agency Fund (GAA), BURS for internally generated, trust and other funds. Box B certifies that the allotment is available and obligated.', preparer() ? html`<a class="btn primary" href="#/obligations/new">${icon('plus', 16)} New request</a>` : '')}
    <nav class="tabs">${[['pending', 'For obligation'], ['draft', 'Drafts'], ['obligated', 'Obligated'], ['unpaid', 'Unpaid'], ['cancelled', 'Cancelled'], ['', 'All']].map(([v, l]) => html`<a href="#/obligations?status=${v}" class="${v === status ? 'active' : ''}">${l}</a>`)}</nav>
    <form class="toolbar" id="f"><input type="search" name="q" value="${query.q || ''}" placeholder="Number, payee or particulars" /><button class="btn">${icon('search', 16)} Find</button></form>
    ${list.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>Number</th><th>Payee</th><th>Particulars</th><th class="num">Amount</th><th class="num">Unpaid</th><th>Status</th></tr></thead>
      <tbody>${list.map((o) => html`<tr data-href="/obligations/${o.id}"><td class="nowrap"><a href="#/obligations/${o.id}"><strong>${o.form} ${o.no || ''}</strong></a>${o.no ? '' : html` <span class="muted small">not yet numbered</span>`}<small>Fund ${o.fund} · ${fmtDate(o.obligatedDate || o.date)}</small></td><td>${o.payeeName}</td><td>${o.particulars}</td>${o.status === 'obligated' ? amt(o.obligatedAmount) : html`<td class="num muted" title="Requested; not yet obligated">${num(o.total)}</td>`}${o.status === 'obligated' ? amt(o.unpaid) : html`<td class="num muted">—</td>`}<td>${orsBadge(o)}</td></tr>`)}</tbody></table></div></div>`
      : html`<div class="card empty">${icon('clipboard', 40)}<h2>${{ pending: 'No requests waiting for Box B', draft: 'No drafts', obligated: 'Nothing obligated yet', unpaid: 'Nothing left to pay', cancelled: 'Nothing cancelled' }[status] || 'No obligation requests'}</h2><p>${query.q ? 'Nothing matches the search — clear it to see all.' : status === 'pending' ? 'Requests submitted by the offices appear here for the budget office to certify.' : ''}</p></div>`}`);
  clickableRows(el);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/obligations?${new URLSearchParams({ status, q: formData(e.target).q })}`;
  };
}

export async function obligationFormView(el, _p, query) {
  const existing = query.id ? await api.get(`/api/finance/obligations/${query.id}`) : null;
  const [chart, cards, als] = await Promise.all([fin.chart(), fin.cardList(), api.get(`/api/finance/allotments?fy=${existing ? 'all' : fy()}`)]);
  const o = existing || { fund: query.fund || fin.settings.funds[0], payeeId: query.payeeId || '', date: today(), office: '', particulars: '', requestedBy: {}, lines: [] };
  const budgetable = (a) => ['PS', 'MOOE', 'FE', 'CO'].includes(classOf(a.code));
  const alOptions = (v) => html`<option value="">Allotment…</option>${als.map((a) => option(a.id, `${a.fund} · ${a.ref}${a.continuing && a.fy !== fy() ? ` (continuing, ${a.fy})` : ''} · ${a.cls} · ${num(a.balance)} left`, a.id === v))}`;
  const cols = [
    { key: 'allotmentId', label: 'Allotment (fund · class · balance)', type: 'select', options: alOptions, width: '36%' },
    { key: 'code', label: 'Object code', type: 'select', options: (v) => accountOptions(chart, v, budgetable) },
    { key: 'amount', label: 'Amount', type: 'number' },
  ];
  mount(el, html`
    ${pageHead(existing ? `Edit ${existing.form} (draft)` : 'New obligation request', 'Box A: the requesting office certifies that the charges are necessary, lawful and under its direct supervision. Box B is the budget office\'s.', '', ['/obligations', 'Obligations'])}
    <form class="card" id="ors">
      <div class="grid">
        <label class="field"><span>Fund cluster</span><select name="fund" id="fund">${fundOptions(o.fund)}</select><span class="hint" id="form-kind"></span></label>
        <label class="field"><span>Date</span><input type="date" name="date" value="${o.date}" /></label>
        <label class="field"><span>Responsibility center</span><select name="office">${officeOptions(o.office)}</select></label>
        <label class="field span-2"><span>Payee</span><select name="payeeId" required>${cardOptions(cards, o.payeeId)}</select></label>
        <p class="field hint">Not in the card file? <a href="#/cards">Add a card</a> first.</p>
        <label class="field span-3"><span>Particulars</span><textarea name="particulars" rows="2" required>${o.particulars}</textarea></label>
        <label class="field"><span>Box A: requested by</span><input name="rbName" value="${o.requestedBy?.name || ''}" placeholder="Head of the requesting office" /></label>
        <label class="field"><span>Position</span><input name="rbTitle" value="${o.requestedBy?.title || ''}" /></label>
      </div>
      <h3 class="sub-h">Charges</h3>
      ${linesTable('lines', cols, o.lines, { total: true })}
      <div class="actions end"><button class="btn" type="submit" value="draft">Save draft</button><button class="btn primary" type="submit" value="submit">Submit for obligation</button></div>
    </form>`);
  const kind = () => (el.querySelector('#form-kind').textContent = `${obligationForm(el.querySelector('#fund').value)} — ${fundName(el.querySelector('#fund').value)}`);
  el.querySelector('#fund').addEventListener('change', kind);
  kind();
  wireLines(el, 'lines', (rows) => `Total ${money(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0))}`);
  const changes = trackChanges(el.querySelector('#ors'));
  el.querySelector('#ors').onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(e.target);
    const body = { ...v, requestedBy: { name: v.rbName, title: v.rbTitle }, lines: readLines(el, 'lines'), submit: e.submitter?.value === 'submit' };
    await busy(e.target, async () => {
    try {
      const out = existing ? await api.put(`/api/finance/obligations/${existing.id}`, body) : await api.post('/api/finance/obligations', body);
      toast(body.submit ? 'Submitted to the budget office.' : 'Draft saved.');
      changes.saved();
      location.hash = `#/obligations/${out.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
    });
  };
}

export async function obligationView(el, params) {
  const o = await api.get(`/api/finance/obligations/${params.id}`);
  const reload = () => obligationView(el, params);
  const act = async (path, body, msg) => {
    try {
      await api.post(`/api/finance/obligations/${o.id}/${path}`, body);
      toast(msg);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  mount(el, html`
    ${pageHead(html`${o.form} ${o.no || html`<span class="muted">· numbered when obligated</span>`} ${orsBadge(o)}`, `${o.payeeName} · Fund ${o.fund} · ${fundName(o.fund)}`, html`
      ${o.status === 'obligated' ? printLink('ors', o.id) : ''}
      ${o.status === 'draft' && preparer() && !o.po ? html`<a class="btn" href="#/obligations/new?id=${o.id}">${icon('edit', 16)} Edit</a>` : ''}
      ${o.status === 'draft' && can('finance.budget') ? html`<button class="btn primary" id="obligate">Certify and obligate (Box B)</button>` : ''}
      ${o.status === 'obligated' && o.unpaid > 0 && can('finance.disburse') ? (o.po ? html`<a class="btn primary" href="#/pos/${o.po.id}">${icon('truck', 16)} Pay through PO ${o.po.no}'s deliveries</a>` : html`<a class="btn primary" href="#/dvs/new?orsId=${o.id}">${icon('file', 16)} Prepare voucher</a>`) : ''}
      ${o.status === 'obligated' && can('finance.budget') ? html`<button class="btn" id="adjust">Adjust</button>` : ''}
      ${o.status !== 'cancelled' && !o.dvs.some((d) => d.status !== 'cancelled') && (o.status === 'draft' ? preparer() : can('finance.budget')) ? html`<button class="btn danger ghost push-right" id="cancel">Cancel request…</button>` : ''}`, ['/obligations', 'Obligations'])}
    <section class="card">${infoGrid([
      ['Date', fmtDate(o.obligatedDate || o.date)], ['Responsibility center', o.officeName || '—'], ['Particulars', o.particulars],
      ['Box A: requested by', [o.requestedBy?.name, o.requestedBy?.title].filter(Boolean).join(', ') || '—'], ['Box B: certified by', o.certifiedBy ? `${o.certifiedBy.name}, ${o.certifiedBy.title}` : '—'],
      o.po && ['Purchase order', html`<a href="#/pos/${o.po.id}">PO ${o.po.no}</a>`], o.cancelReason && ['Cancelled', o.cancelReason],
    ])}</section>
    <section class="card"><h2>Status of obligation</h2><div class="table-scroll"><table class="table compact">
      <thead><tr><th>PAP</th><th>UACS object code</th><th>Allotment</th><th class="num">${o.status === 'obligated' ? 'Obligated' : 'Requested'}</th><th class="num">Disbursed</th><th class="num">On vouchers</th><th class="num">Available</th></tr></thead>
      <tbody>${o.lines.map((l) => html`<tr><td>${l.pap}<small>${papName(l.pap)}</small></td><td>${l.uacs}<small>${l.title}</small></td><td>${l.allotmentRef}<small>${l.cls}</small></td>${amt(l.obligated)}${amt(l.disbursed)}${amt(l.pending, { blankZero: true })}${amt(l.available, { strong: true })}</tr>`)}</tbody>
      <tfoot><tr><td colspan="3">Total</td>${amt(o.lines.reduce((t, l) => t + l.obligated, 0), { strong: true })}${amt(o.disbursed, { strong: true })}${amt(o.lines.reduce((t, l) => t + l.pending, 0), { blankZero: true })}${amt(o.lines.reduce((t, l) => t + l.available, 0), { strong: true })}</tr></tfoot></table></div>
      ${o.status !== 'obligated' ? html`<p class="muted small">Requested amounts: not obligated until the budget office certifies Box B.</p>` : ''}
      ${o.adjustments.length ? html`<h3 class="sub-h">Adjustments</h3><ul class="tight">${o.adjustments.map((a) => html`<li>${fmtDate(a.date)}: ${money(a.amount)} on ${o.lines[a.line].title} — ${a.reason} (${a.by})</li>`)}</ul>` : ''}
    </section>
    ${o.dvs.length ? html`<section class="card"><h2>Vouchers</h2><table class="table compact"><thead><tr><th>DV</th><th>Date</th><th class="num">Gross</th><th>Status</th></tr></thead><tbody>${o.dvs.map((d) => html`<tr><td><a href="#/dvs/${d.id}">${d.no || 'Draft'}</a></td><td>${fmtDate(d.paidDate || d.date)}</td>${amt(d.gross)}<td>${d.status}</td></tr>`)}</tbody></table></section>` : ''}`);
  el.querySelector('#obligate')?.addEventListener('click', () => modal({
    title: `Box B: obligate ${o.form}`, submitLabel: 'Obligate',
    body: html`<p>Certified: allotment available and obligated for the purpose/adjustment necessary as indicated above.</p><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label>`,
    onSubmit: (form) => act('obligate', formData(form), 'Obligated.'),
  }));
  el.querySelector('#adjust')?.addEventListener('click', () => modal({
    title: `Adjust ${o.form} ${o.no}`, submitLabel: 'Adjust',
    body: html`<label class="field"><span>Line</span><select name="line">${o.lines.map((l, i) => option(i, `${l.code} ${l.title} · ${num(l.available)} available`))}</select></label>
      <label class="field"><span>Amount (negative to reduce)</span><input type="number" step="0.01" name="amount" required /></label><label class="field"><span>Reason</span><input name="reason" required /></label>`,
    onSubmit: (form) => act('adjust', formData(form), 'Adjusted.'),
  }));
  el.querySelector('#cancel')?.addEventListener('click', () => modal({
    title: `Cancel ${o.form} ${o.no || ''}`.trim(), submitLabel: 'Cancel request', cancelLabel: 'Keep it',
    body: html`<label class="field"><span>Reason</span><input name="reason" required /></label>`,
    onSubmit: (form) => act('cancel', formData(form), 'Cancelled.'),
  }));
}

// ----- Budget reports -----
export async function budgetReportsView(el, _p, query) {
  const tab = query.tab || 'saaodb';
  const year = Number(query.fy) || fy();
  const fund = query.fund ?? (tab === 'raod' ? fin.settings.funds[0] : '');
  const cls = query.cls || 'MOOE';
  const asOf = query.asOf || today();
  const url = { saaodb: '/api/finance/budget/saaodb', raod: '/api/finance/budget/raod', aging: '/api/finance/budget/aging', scbaa: '/api/finance/budget/scbaa' }[tab];
  const d = await api.get(`${url}?${new URLSearchParams({ fy: year, fund, cls, asOf })}`);
  const head = (title, sub) => html`<div class="print-head"><strong>${fin.settings.entity.name}</strong><span>${title}</span><span>${sub}</span></div>`;
  let body;
  let csv;
  if (tab === 'saaodb') {
    body = html`${head('Statement of Appropriations, Allotments, Obligations, Disbursements and Balances (FAR No. 1)', `${d.fundName} · FY ${year}`)}
      <div class="table-scroll"><table class="table compact report"><thead><tr><th>PAP</th><th>Class</th><th class="num">Appropriations</th><th class="num">Allotments</th><th class="num" data-label="Obligations Q1">Obligations Q1</th><th class="num" data-label="Obligations Q2">Q2</th><th class="num" data-label="Obligations Q3">Q3</th><th class="num" data-label="Obligations Q4">Q4</th><th class="num">Total obligations</th><th class="num">Disbursements</th><th class="num">Unreleased appropriations</th><th class="num">Unobligated allotments</th><th class="num">Unpaid obligations</th></tr></thead>
      <tbody>${d.rows.map((r) => html`<tr><td>${r.pap}<small>${r.papName}</small></td><td>${r.cls}</td>${amt(r.appropriation)}${amt(r.allotment)}${r.obligations.map((x) => amt(x, { blankZero: true }))}${amt(r.totalObligations, { strong: true })}${amt(r.totalDisbursements)}${amt(r.unreleased)}${amt(r.unobligated)}${amt(r.unpaid)}</tr>`)}</tbody>
      <tfoot><tr><td colspan="2">Total</td>${amt(d.totals.appropriation, { strong: true })}${amt(d.totals.allotment, { strong: true })}${[0, 1, 2, 3].map((qi) => amt(d.rows.reduce((t, r) => t + r.obligations[qi], 0), { strong: true }))}${amt(d.totals.totalObligations, { strong: true })}${amt(d.totals.totalDisbursements, { strong: true })}${amt(d.totals.unreleased, { strong: true })}${amt(d.totals.unobligated, { strong: true })}${amt(d.totals.unpaid, { strong: true })}</tr></tfoot></table></div>
      ${d.prior.length ? html`<h3 class="sub-h">Prior years' obligations: adjusted and paid in ${year}</h3><table class="table compact report"><thead><tr><th>PAP</th><th>Class</th><th class="num">Adjustments</th><th class="num">Paid Q1</th><th class="num">Q2</th><th class="num">Q3</th><th class="num">Q4</th><th class="num">Total paid</th></tr></thead>
      <tbody>${d.prior.map((r) => html`<tr><td>${r.pap}<small>${r.papName}</small></td><td>${r.cls}</td>${amt(r.adjustments, { blankZero: true })}${r.disbursements.map((x) => amt(x, { blankZero: true }))}${amt(r.total)}</tr>`)}</tbody><tfoot><tr><td colspan="7">Total</td>${amt(d.totals.priorDisbursements, { strong: true })}</tr></tfoot></table>` : ''}`;
    csv = [['PAP', 'Class', 'Appropriations', 'Allotments', 'Obligations Q1', 'Q2', 'Q3', 'Q4', 'Disbursements', 'Unreleased', 'Unobligated', 'Unpaid'], ...d.rows.map((r) => [r.pap, r.cls, r.appropriation, r.allotment, ...r.obligations, r.totalDisbursements, r.unreleased, r.unobligated, r.unpaid]),
      ...(d.prior.length ? [[], [`Prior years' obligations: adjusted and paid in ${year}`], ['PAP', 'Class', 'Adjustments', 'Paid Q1', 'Q2', 'Q3', 'Q4', 'Total paid'], ...d.prior.map((r) => [r.pap, r.cls, r.adjustments, ...r.disbursements, r.total])] : [])];
  } else if (tab === 'raod') {
    body = html`${head(`Registry of Allotments, Obligations and Disbursements – ${d.classLabel}`, `${d.fundName} · FY ${year}`)}
      <div class="table-scroll"><table class="table compact report"><thead><tr><th>Date</th><th>Reference</th><th>Particulars</th><th>UACS</th><th class="num">Allotments</th><th class="num">Obligations</th><th class="num">Unobligated balance</th><th class="num">Disbursements</th><th class="num">Unpaid obligations</th></tr></thead>
      <tbody>${d.rows.map((r) => html`<tr><td>${fmtDate(r.date)}</td><td>${r.kind ? html`<a href="#/${r.kind === 'dv' ? 'dvs' : 'obligations'}/${r.id}">${r.ref}</a>` : r.ref}</td><td title="${r.particulars}">${r.particulars.length > 90 ? `${r.particulars.slice(0, 88)}…` : r.particulars}</td><td>${r.code}<small>${r.title}</small></td>${amt(r.allotment, { blankZero: true })}${amt(r.obligation, { blankZero: true })}${amt(r.unobligated)}${amt(r.disbursement, { blankZero: true })}${amt(r.unpaid)}</tr>`)}</tbody>
      <tfoot><tr><td colspan="4">Total</td>${amt(d.totals.allotment, { strong: true })}${amt(d.totals.obligations, { strong: true })}${amt(d.totals.unobligated, { strong: true })}${amt(d.totals.disbursements, { strong: true })}${amt(d.totals.unpaid, { strong: true })}</tr></tfoot></table></div>
      ${d.prior.length ? html`<h3 class="sub-h">Earlier years' obligations: adjusted and paid in ${year}</h3><div class="table-scroll"><table class="table compact report"><thead><tr><th>Date</th><th>Reference</th><th>Obligation</th><th>Particulars</th><th>UACS</th><th class="num">Adjustment</th><th class="num">Disbursement</th></tr></thead>
        <tbody>${d.prior.map((r) => html`<tr><td>${fmtDate(r.date)}</td><td><a href="#/${r.kind === 'dv' ? 'dvs' : 'obligations'}/${r.id}">${r.ref}</a></td><td>${r.obligationNo}</td><td>${r.particulars}</td><td>${r.code}<small>${r.title}</small></td>${amt(r.adjustment, { blankZero: true })}${amt(r.disbursement, { blankZero: true })}</tr>`)}</tbody></table></div>` : ''}
      ${d.codes.length ? html`<h3 class="sub-h">By object code</h3><table class="table compact"><thead><tr><th>Object code</th><th class="num">Obligations</th><th class="num">Disbursements</th></tr></thead><tbody>${d.codes.map((c) => html`<tr><td>${c.code} · ${c.title}</td>${amt(c.obligations)}${amt(c.disbursements)}</tr>`)}</tbody></table>` : ''}`;
    csv = [['Date', 'Reference', 'Particulars', 'Object code', 'Allotments', 'Obligations', 'Unobligated', 'Disbursements', 'Unpaid'], ...d.rows.map((r) => [r.date, r.ref, r.particulars, r.code, r.allotment, r.obligation, r.unobligated, r.disbursement, r.unpaid])];
  } else if (tab === 'aging') {
    body = html`${head('Aging of Due and Demandable Obligations (FAR No. 3)', `As of ${fmtDate(d.asOf)}`)}
      <div class="stats">${d.buckets.map((b) => html`<div class="card"><small>${b.label}</small><strong>${money(b.amount)}</strong><span class="muted small">${b.count} obligation${b.count === 1 ? '' : 's'}</span></div>`)}</div>
      <div class="table-scroll"><table class="table compact report"><thead><tr><th>Obligation</th><th>Date</th><th>Payee</th><th>Particulars</th><th class="num">Days</th><th class="num">Unpaid</th></tr></thead>
      <tbody>${d.rows.map((r) => html`<tr><td><a href="#/obligations/${r.id}">${r.form} ${r.no}</a></td><td>${fmtDate(r.date)}</td><td>${r.payee}</td><td>${r.particulars}</td><td class="num">${r.age}</td>${amt(r.unpaid)}</tr>`)}</tbody>
      <tfoot><tr><td colspan="5">Total</td>${amt(d.total, { strong: true })}</tr></tfoot></table></div>`;
    csv = [['Obligation', 'Date', 'Payee', 'Particulars', 'Days', 'Unpaid'], ...d.rows.map((r) => [`${r.form} ${r.no}`, r.date, r.payee, r.particulars, r.age, r.unpaid])];
  } else {
    body = html`${head('Statement of Comparison of Budget and Actual Amounts', `${d.fundName} · FY ${year}`)}
      <table class="table compact report"><thead><tr><th>Particulars</th><th class="num">Original budget</th><th class="num">Adjustments</th><th class="num">Final budget</th><th class="num">Actual (obligations)</th><th class="num">Difference, final and actual</th></tr></thead>
      <tbody>${d.rows.map((r) => html`<tr><td>${r.label}</td>${amt(r.original)}${amt(r.adjustments)}${amt(r.final)}${amt(r.actual)}${amt(r.difference)}</tr>`)}</tbody>
      <tfoot><tr><td>Total</td>${amt(d.totals.original, { strong: true })}${amt(d.totals.adjustments, { strong: true })}${amt(d.totals.final, { strong: true })}${amt(d.totals.actual, { strong: true })}${amt(d.totals.difference, { strong: true })}</tr></tfoot></table>`;
    csv = [['Particulars', 'Original', 'Adjustments', 'Final', 'Actual', 'Difference'], ...d.rows.map((r) => [r.label, r.original, r.adjustments, r.final, r.actual, r.difference])];
  }
  mount(el, html`
    ${pageHead('Budget reports', 'Budget and Financial Accountability Reports (COA-DBM Joint Circular 2019-1) and the registries.', html`<button class="btn" id="csv">${icon('download', 16)} CSV</button><button class="btn" onclick="print()">${icon('file', 16)} Print</button>`)}
    <nav class="tabs">${[['saaodb', 'SAAODB (FAR 1)', 'Statement of Appropriations, Allotments, Obligations, Disbursements and Balances'], ['raod', 'RAOD', 'Registry of Allotments, Obligations and Disbursements'], ['aging', 'Aging (FAR 3)', 'Aging of Due and Demandable Obligations'], ['scbaa', 'SCBAA', 'Statement of Comparison of Budget and Actual Amounts']].map(([k, l, t]) => html`<a href="#/budget-reports?tab=${k}&fy=${year}" class="${k === tab ? 'active' : ''}" title="${t}">${l}</a>`)}</nav>
    <form class="toolbar" id="f"><input type="hidden" name="tab" value="${tab}" />${tab === 'aging' ? html`<label>As of <input type="date" name="asOf" value="${asOf}" /></label>` : html`<input type="number" name="fy" value="${year}" style="width:110px" aria-label="Fiscal year" />`}<select name="fund">${fundOptions(fund, { all: tab !== 'raod' })}</select>${tab === 'raod' ? html`<select name="cls">${classOptions(cls)}</select>` : ''}<button class="btn">Show</button></form>
    <div class="card">${body}</div>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/budget-reports?${new URLSearchParams(formData(e.target))}`;
  };
  el.querySelector('#csv').addEventListener('click', () => downloadFile(`${tab}-${year}.csv`, toCsv(csv)));
}
