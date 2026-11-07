// Revenue: official receipts (Accountable Form 51) issued from each collector's booklet; the
// Report of Collections and Deposits (RCD, GAM Appendix 26) and the deposit; accountable forms and
// the RAAF (Appendix 67); revenue monitoring against targets.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, modal, toast, formData, option, fmtDate, badge, downloadFile, toCsv } from '../../ui.js';
import { today as localDate } from '../../ui.js';
import { fin, can, money, num, fy, fundOptions, accountOptions, cardOptions, linesTable, wireLines, readLines, clickableRows, amt, infoGrid, printLink } from '../state.js';

const today = () => localDate(); // the browser's own date, not UTC
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function receiptListView(el, _p, query) {
  // The last 30 days by default (a whole year of receipts is too long to read); a date or a search narrows it.
  const date = query.date ?? '';
  const from = query.from ?? (date || query.q ? '' : localDate(new Date(Date.now() - 30 * 86400000)));
  const list = await api.get(`/api/finance/receipts?${new URLSearchParams({ date, from, q: query.q || '' })}`);
  const reload = () => receiptListView(el, _p, query);
  mount(el, html`
    ${pageHead('Official receipts', 'Every collection gets an official receipt from the collector\'s booklet. Cancelled receipts keep all copies.', can('finance.collect') ? html`<button class="btn primary" id="issue">${icon('plus', 16)} Issue O.R.</button>` : '')}
    <form class="toolbar" id="f"><label>Date <input type="date" name="date" value="${date}" /></label><input type="search" name="q" value="${query.q || ''}" placeholder="O.R. no. or payor" /><button class="btn">Show</button>${from ? html`<span class="muted small">Showing the last 30 days · <a href="#/receipts?from=">show all</a></span>` : ''}</form>
    ${list.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>O.R. no.</th><th>Date</th><th>Payor</th><th>Nature of collection</th><th>Fund</th><th class="num">Amount</th><th>Collector</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((r) => html`<tr><td><strong>${r.no}</strong></td><td class="nowrap">${fmtDate(r.date)}</td><td>${r.payorName}</td><td>${r.lines.map((l) => l.description).join(', ')}</td><td>${r.fund}</td>${amt(r.total)}<td>${r.collectorName}</td>
        <td>${r.status === 'cancelled' ? badge('Cancelled', 'gray') : r.rcdNo ? html`${badge('Reported', 'green')}<small class="nowrap"><a href="#/rcds/${r.rcdId}">RCD ${r.rcdNo}</a></small>` : badge('Not yet reported', 'amber')}</td>
        <td class="row-actions"><a class="btn sm" href="#/print/or/${r.id}" title="Print O.R. ${r.no}">${icon('file', 14)} Print</a>${r.status === 'issued' && !r.rcdId && r.collectorId === ctx.user.id ? html`<button class="btn sm danger ghost" data-cancel="${r.id}">Cancel</button>` : ''}</td></tr>`)}</tbody></table></div></div>`
      : html`<div class="card empty">${icon('receipt', 40)}<h2>No receipts</h2><p>${date ? 'None on that day.' : 'Receipts appear here once issued.'}</p></div>`}`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/receipts?${new URLSearchParams(formData(e.target))}`;
  };
  el.querySelector('#issue')?.addEventListener('click', () => issueReceipt(reload));
  el.onclick = (e) => {
    const b = e.target.closest('[data-cancel]');
    if (!b) return;
    modal({ title: 'Cancel official receipt', submitLabel: 'Cancel O.R.', cancelLabel: 'Keep it', body: html`<p class="muted small">Write "Cancelled" on all copies and keep them in the booklet.</p><label class="field"><span>Reason</span><input name="reason" required /></label>`, async onSubmit(f) {
      await api.post(`/api/finance/receipts/${b.dataset.cancel}/cancel`, formData(f));
      toast('Receipt cancelled.');
      reload();
    } });
  };
}

export async function issueReceipt(done) {
  const [cards, chart] = await Promise.all([fin.cardList(), fin.chart()]);
  const items = fin.settings.revenueItems;
  const cols = [
    { key: 'itemId', label: 'Fee', type: 'select', options: (v) => html`<option value="" ${v === undefined ? 'selected' : ''} disabled>Pick a fee…</option>${items.map((i) => option(i.id, `${i.name}${i.amount ? ` · ${num(i.amount)}` : ''}`, i.id === v))}<option value="__other">Other (pick the account)</option>`, width: '30%' },
    { key: 'code', label: 'Account (for other)', type: 'select', options: (v) => accountOptions(chart, v, (a) => a.group === 4 || /^(103|199|202|204)/.test(a.code)) },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'number' },
  ];
  const m = modal({
    title: 'Issue an official receipt', wide: true, submitLabel: 'Issue O.R.',
    body: html`<div class="grid">
      <label class="field"><span>Fund cluster</span><select name="fund">${fundOptions(fin.settings.funds.includes('05') ? '05' : fin.settings.funds[0])}</select></label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${today()}" max="${today()}" /></label>
      <label class="field"><span>Mode</span><select name="mode">${option('cash', 'Cash')}${option('check', 'Check')}${option('online', 'Online / bank transfer')}</select></label>
      <label class="field"><span>Student (search name or number)</span><input id="stud-q" placeholder="Type 2 letters…" autocomplete="off" /><select name="studentId" id="stud"><option value="">Not a student</option></select></label>
      <label class="field"><span>Or a card (supplier, employee, officer…)</span><select name="payorCardId">${html`<option value="">None</option>`}${cardOptions(cards, '')}</select></label>
      <label class="field"><span>Payor name (as printed)</span><input name="payorName" /></label>
      <label class="field check-only" hidden><span>Check no.</span><input name="checkNo" /></label><label class="field check-only" hidden><span>Bank</span><input name="bank" /></label>
    </div>
    <h3 class="sub-h">Nature of collection</h3>${linesTable('or-lines', cols, [], { total: true })}`,
    async onSubmit(form) {
      const r = await api.post('/api/finance/receipts', { ...formData(form), lines: readLines(form, 'or-lines').map((l) => ({ ...l, itemId: l.itemId === '__other' ? '' : l.itemId, amount: l.amount || items.find((i) => i.id === l.itemId)?.amount })) });
      toast(`O.R. ${r.no} issued: ${money(r.total)}.`);
      location.hash = `#/print/or/${r.id}`;
      done?.();
    },
  });
  wireLines(m.form, 'or-lines', (rows) => `Total ${money(rows.reduce((t, r) => t + (Number(r.amount) || Number(items.find((i) => i.id === r.itemId)?.amount) || 0), 0))}`);
  // Check number and bank only for checks; the account only for an "Other" line.
  const showCheck = () => m.form.querySelectorAll('.check-only').forEach((x) => (x.hidden = m.form.mode.value !== 'check'));
  m.form.mode.addEventListener('change', showCheck);
  const accountFor = () => m.form.querySelectorAll('#or-lines tr[data-line]').forEach((tr) => {
    const other = tr.querySelector('[data-k=itemId]').value === '__other';
    const code = tr.querySelector('[data-k=code]');
    code.disabled = !other;
    if (!other) code.value = '';
  });
  m.form.querySelector('#or-lines').addEventListener('change', accountFor);
  m.form.querySelector('#or-lines').addEventListener('click', () => setTimeout(accountFor));
  accountFor();
  m.form.querySelector('#or-lines').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-k=itemId]');
    const it = sel && items.find((i) => i.id === sel.value);
    if (it?.amount) sel.closest('tr').querySelector('[data-k=amount]').value = it.amount;
  });
  let timer;
  m.form.querySelector('#stud-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const list = await api.get(`/api/finance/students?q=${encodeURIComponent(e.target.value)}`).catch(() => []);
      const sel = m.form.querySelector('#stud');
      sel.innerHTML = `<option value="">Not a student</option>${list.map((s) => `<option value="${s.id}">${s.name}${s.studentNo ? ` · ${s.studentNo}` : ''}</option>`).join('')}`;
      if (list.length === 1) {
        sel.value = list[0].id;
        m.form.payorName.value ||= list[0].name;
      }
    }, 250);
  });
  m.form.querySelector('#stud').addEventListener('change', (e) => {
    if (e.target.value) m.form.payorName.value = e.target.selectedOptions[0].textContent.split(' · ')[0];
  });
}

export async function rcdListView(el) {
  const list = await api.get('/api/finance/rcds');
  const unreported = can('finance.collect') ? await api.get(`/api/finance/receipts?unreported=1&collectorId=${ctx.user.id}`) : [];
  const mine = unreported.filter((r) => !r.rcdId);
  mount(el, html`
    ${pageHead('Collections and deposits', 'Each collector reports their receipts on an RCD (posted to the Cash Receipts Journal), then deposits the collections intact.', can('finance.collect') ? html`<button class="btn primary" id="new" ${mine.length ? '' : 'disabled'}>${icon('plus', 16)} Prepare RCD (${mine.length} receipt${mine.length === 1 ? '' : 's'})</button>` : '')}
    ${list.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>RCD no.</th><th>Date</th><th>Collector</th><th>O.R. range</th><th class="num">Receipts</th><th class="num">Total</th><th>Deposit</th></tr></thead>
      <tbody>${list.map((c) => html`<tr data-href="/rcds/${c.id}"><td><a href="#/rcds/${c.id}"><strong>${c.no}</strong></a><small>Fund ${c.fund}</small></td><td class="nowrap">${fmtDate(c.date)}</td><td>${c.collectorName}</td><td>${c.from}–${c.to}</td><td class="num">${c.count}</td>${amt(c.total)}
        <td>${c.deposit ? html`${badge('Deposited', 'green')}<small>${fmtDate(c.deposit.date)} · ${c.deposit.slipNo}</small>` : c.overdue ? badge('Undeposited – late', 'red') : badge('Undeposited', 'amber')}</td></tr>`)}</tbody></table></div></div>`
      : html`<div class="card empty">${icon('bank', 40)}<h2>No reports yet</h2></div>`}`);
  clickableRows(el);
  el.querySelector('#new')?.addEventListener('click', () => modal({
    title: 'Report of Collections and Deposits', submitLabel: 'Prepare and post',
    body: html`<p class="muted small">Your unreported receipts through the date are listed on the report; the collections are posted (Dr Cash – Collecting Officers, Cr revenue).</p>
      <label class="field"><span>Fund cluster</span><select name="fund">${fundOptions([...new Set(mine.map((r) => r.fund))][0])}</select></label><label class="field"><span>Through</span><input type="date" name="date" value="${today()}" /></label>`,
    async onSubmit(form) {
      const c = await api.post('/api/finance/rcds', formData(form));
      toast(`RCD ${c.no}: ${money(c.total)}.`);
      location.hash = `#/rcds/${c.id}`;
    },
  }));
}

export async function rcdView(el, params) {
  const c = await api.get(`/api/finance/rcds/${params.id}`);
  const banks = fin.settings.bankAccounts.filter((b) => b.fund === c.fund);
  mount(el, html`
    ${pageHead(html`RCD ${c.no} ${c.deposit ? badge('Deposited', 'green') : badge('Undeposited', c.overdue ? 'red' : 'amber')}`, `${c.collectorName} · Fund ${c.fund} · ${fmtDate(c.date)}`, html`${printLink('rcd', c.id)}${!c.deposit && can('finance.collect') ? html`<button class="btn primary" id="dep">Record deposit</button>` : ''}`, ['/rcds', 'Collections & deposits'])}
    <section class="card">${infoGrid([['Receipts', `${c.from} to ${c.to} (${c.count} issued)`], ['Total collections', money(c.total)], ['Collections entry', html`<a href="#/journals/${c.journalId}">JEV ${c.jevNo}</a>`], c.deposit && ['Deposit', html`${fmtDate(c.deposit.date)} · ${c.bank?.name || ''} ${c.bank?.number || ''} · slip ${c.deposit.slipNo} · <a href="#/journals/${c.deposit.journalId}">JEV ${c.depositJevNo}</a>`]])}</section>
    <section class="card"><table class="table compact"><thead><tr><th>O.R. no.</th><th>Date</th><th>Payor</th><th>Nature of collection</th><th class="num">Amount</th></tr></thead>
      <tbody>${c.receipts.map((r) => html`<tr class="${r.status === 'cancelled' ? 'muted' : ''}"><td>${r.no}</td><td class="nowrap">${fmtDate(r.date)}</td><td>${r.status === 'cancelled' ? 'CANCELLED' : r.payorName}</td><td>${r.lines.map((l) => l.description).join(', ')}</td>${amt(r.total)}</tr>`)}</tbody>
      <tfoot><tr><td colspan="4">Total</td>${amt(c.total, { strong: true })}</tr></tfoot></table></section>`);
  el.querySelector('#dep')?.addEventListener('click', () => modal({
    title: `Deposit of RCD ${c.no}`, submitLabel: 'Record deposit',
    body: banks.length ? html`<label class="field"><span>Bank account</span><select name="bankId">${banks.map((b) => option(b.id, `${b.name} ${b.number}`))}</select></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label><label class="field"><span>Validated deposit slip no.</span><input name="slipNo" required /></label>`
      : html`<p>No bank account for Fund ${c.fund}. Add it in the Control panel.</p>`,
    async onSubmit(form) {
      await api.post(`/api/finance/rcds/${c.id}/deposit`, formData(form));
      toast('Deposit recorded.');
      rcdView(el, params);
    },
  }));
}

export async function bookletsView(el) {
  const list = await api.get('/api/finance/booklets');
  const users = can('finance.collect') ? await api.get('/api/finance/collectors') : [];
  mount(el, html`
    ${pageHead('Accountable forms', 'Official receipt booklets (Accountable Form 51) issued to collecting officers, and what is left of each — the basis of the Report of Accountability for Accountable Forms (RAAF).', can('finance.collect') ? html`<button class="btn primary" id="add">${icon('plus', 16)} Issue a booklet</button>` : '')}
    ${list.length ? html`<div class="card"><div class="print-head"><strong>${fin.settings.entity.name}</strong><span>Report of Accountability for Accountable Forms · ${fmtDate(today())}</span></div>
      <table class="table"><thead><tr><th>Form</th><th>Serial numbers</th><th>Collector</th><th>Fund</th><th>Issued</th><th class="num">Qty</th><th class="num">Used</th><th class="num">Cancelled</th><th class="num">Remaining</th><th>Status</th></tr></thead>
      <tbody>${list.map((b) => html`<tr><td>AF ${b.form}</td><td>${String(b.from).padStart(7, '0')}–${String(b.to).padStart(7, '0')}${b.status === 'active' ? html`<small>next ${String(b.next).padStart(7, '0')}</small>` : ''}</td><td>${b.collectorName}</td><td>${b.fund}</td><td class="nowrap">${fmtDate(b.issuedDate)}</td><td class="num">${b.quantity}</td><td class="num">${b.issued}</td><td class="num">${b.cancelled}</td><td class="num">${b.remaining}</td><td>${b.status === 'active' ? badge('In use', 'green') : badge('Used up', 'gray')}</td></tr>`)}</tbody></table></div>`
      : html`<div class="card empty">${icon('book', 40)}<h2>No booklets</h2><p>Issue official receipt booklets to the collecting officers.</p></div>`}`);
  el.querySelector('#add')?.addEventListener('click', () => modal({
    title: 'Issue an O.R. booklet', submitLabel: 'Issue',
    body: html`<div class="grid two"><label class="field"><span>Form</span><input name="form" value="51" /></label><label class="field"><span>Fund cluster</span><select name="fund">${fundOptions(fin.settings.funds.includes('05') ? '05' : fin.settings.funds[0])}</select></label>
      <label class="field"><span>Serial from</span><input type="number" name="from" required /></label><label class="field"><span>Serial to</span><input type="number" name="to" required /></label>
      <label class="field span-2"><span>Collecting officer</span><select name="collectorId">${users.map((u) => option(u.id, u.name))}</select></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label></div>`,
    async onSubmit(form) {
      await api.post('/api/finance/booklets', formData(form));
      toast('Booklet issued.');
      bookletsView(el);
    },
  }));
}

export async function revenueView(el, _p, query) {
  const year = Number(query.fy) || fy();
  const fund = query.fund || '';
  const [d, chart] = await Promise.all([api.get(`/api/finance/revenue?${new URLSearchParams({ fy: year, fund })}`), fin.chart()]);
  const editTargets = (can('finance.collect') || can('finance.budget'));
  mount(el, html`
    ${pageHead('Revenue monitoring', `Fiscal year ${year}: the school's own income (not subsidies from the national government) by account and month, against the targets (the basis of FAR No. 5).`, html`${editTargets ? html`<button class="btn" id="targets">${icon('edit', 16)} Targets</button>` : ''}<button class="btn" id="csv">${icon('download', 16)} CSV</button><button class="btn" onclick="print()">${icon('file', 16)} Print</button>`)}
    <form class="toolbar" id="f"><input type="number" name="fy" value="${year}" style="width:100px" aria-label="Fiscal year" /><select name="fund">${fundOptions(fund, { all: true })}</select><button class="btn">Show</button></form>
    <div class="stats"><div class="card"><small>Target</small><strong>${money(d.totals.target)}</strong></div><div class="card accent"><small>Actual</small><strong>${money(d.totals.actual)}</strong></div><div class="card"><small>Achieved</small><strong>${d.totals.target ? `${Math.round((d.totals.actual / d.totals.target) * 1000) / 10}%` : '—'}</strong></div></div>
    <div class="card"><div class="table-scroll"><table class="table compact report"><thead><tr><th>Account</th>${MONTHS.map((m) => html`<th class="num">${m}</th>`)}<th class="num">Total</th><th class="num">Target</th><th class="num">%</th></tr></thead>
      <tbody>${d.rows.map((r) => html`<tr><td>${r.code}<small>${r.title}</small></td>${r.months.map((v) => amt(v, { blankZero: true }))}${amt(r.total, { strong: true })}${amt(r.target, { blankZero: true })}<td class="num">${r.percent == null ? '' : `${r.percent}%`}</td></tr>`)}</tbody>
      <tfoot><tr><td>Total</td>${d.totals.months.map((v) => amt(v, { blankZero: true }))}${amt(d.totals.actual, { strong: true })}${amt(d.totals.target, { strong: true })}<td></td></tr></tfoot></table></div></div>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/revenue?${new URLSearchParams(formData(e.target))}`;
  };
  el.querySelector('#csv').addEventListener('click', () => downloadFile(`revenue-${year}.csv`, toCsv([['Account', 'Title', ...MONTHS, 'Total', 'Target'], ...d.rows.map((r) => [r.code, r.title, ...r.months, r.total, r.target])])));
  el.querySelector('#targets')?.addEventListener('click', async () => {
    // Targets are set per fund: the dialog shows the picked fund's own targets (never the all-funds sum).
    const rev = chart.filter((a) => a.group === 4 && a.active && !a.code.startsWith('403'));
    const tFund = fund || (fin.settings.funds.includes('05') ? '05' : fin.settings.funds[0]);
    const targetsOf = async (f) => Object.fromEntries((await api.get(`/api/finance/revenue?${new URLSearchParams({ fy: year, fund: f })}`)).rows.map((r) => [r.code, r.target]));
    const t0 = await targetsOf(tFund);
    const m = modal({
      title: `Revenue targets ${year}`, wide: true, submitLabel: 'Save targets',
      body: html`<label class="field"><span>Fund cluster</span><select name="fund">${fundOptions(tFund)}</select></label>
        <div class="table-scroll" style="max-height:50vh"><table class="table compact"><tbody>${rev.map((a) => html`<tr><td>${a.code} · ${a.title}</td><td class="num"><input type="number" step="0.01" min="0" name="t${a.code}" value="${t0[a.code] || ''}" /></td></tr>`)}</tbody></table></div>`,
      async onSubmit(form) {
        const v = formData(form);
        await api.put('/api/finance/revenue/targets', { fy: year, fund: v.fund, targets: Object.fromEntries(Object.entries(v).filter(([k, x]) => k.startsWith('t') && x).map(([k, x]) => [k.slice(1), Number(x)])) });
        toast('Targets saved.');
        revenueView(el, _p, query);
      },
    });
    m.form.fund.addEventListener('change', async () => {
      const t = await targetsOf(m.form.fund.value);
      m.form.querySelectorAll('input[name^="t"]').forEach((i) => (i.value = t[i.name.slice(1)] || ''));
    });
  });
}
