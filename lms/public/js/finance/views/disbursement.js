// Disbursement: vouchers (DV, GAM Appendix 32) through Box A–E, LDDAP-ADA (Appendix 42), cash
// advances and liquidation (Appendix 44), and BIR withholding: the monthly summary by ATC,
// remittances (TRA for fund 01), the quarterly alphalist and BIR Form 2307.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, modal, toast, formData, option, fmtDate, badge, downloadFile, toCsv } from '../../ui.js';
import { today as localDate } from '../../ui.js';
import { fin, can, money, num, monthName, fundOptions, officeOptions, accountOptions, cardOptions, linesTable, wireLines, readLines, clickableRows, dvBadge, amt, infoGrid, printLink , trackChanges, busy } from '../state.js';

const today = () => localDate(); // the browser's own date, not UTC
const lastMonth = () => {
  const d = new Date();
  d.setDate(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export async function dvListView(el, _p, query) {
  const status = query.status ?? (can('finance.accounts') ? 'pending' : can('finance.approve') ? 'certified' : 'open');
  const list = await api.get(`/api/finance/dvs?${new URLSearchParams({ status, q: query.q || '', kind: query.kind || '' })}`);
  mount(el, html`
    ${pageHead('Disbursement vouchers', 'Box A requesting office · Box B accounting entry · Box C certified by the accountant · Box D approved by the head of agency · Box E receipt of payment.', can('finance.disburse') ? html`<a class="btn primary" href="#/dvs/new">${icon('plus', 16)} New voucher</a>` : '')}
    <nav class="tabs">${[['open', 'Open'], ['draft', 'Drafts'], ['pending', 'For certification (Box C)'], ['certified', 'For approval (Box D)'], ['approved', 'To pay'], ['paid', 'Paid'], ['cancelled', 'Cancelled'], ['', 'All']].map(([v, l]) => html`<a href="#/dvs?status=${v}" class="${v === status ? 'active' : ''}">${l}</a>`)}</nav>
    <form class="toolbar" id="f"><input type="search" name="q" value="${query.q || ''}" placeholder="DV no., payee or particulars" /><select name="kind">${option('', 'Payments and advances', !query.kind)}${option('payment', 'Payments', query.kind === 'payment')}${option('advance', 'Cash advances', query.kind === 'advance')}</select><button class="btn">${icon('search', 16)} Find</button></form>
    ${list.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>DV no.</th><th>Payee</th><th>Particulars</th><th>Mode</th><th class="num">Gross</th><th class="num">Taxes</th><th class="num">Net</th><th>Status</th></tr></thead>
      <tbody>${list.map((d) => html`<tr data-href="/dvs/${d.id}"><td class="nowrap"><a href="#/dvs/${d.id}"><strong>${d.no || 'Unnumbered'}</strong></a><small>Fund ${d.fund} · ${fmtDate(d.paidDate || d.date)}</small></td><td>${d.payee.name}${d.kind === 'advance' ? html` <span class="badge blue">Advance</span>` : ''}</td><td>${d.particulars}</td><td><small>${d.modeLabel}${d.checkNo ? ` ${d.checkNo}` : ''}</small></td>${amt(d.gross)}${amt(d.taxTotal, { blankZero: true })}${amt(d.net, { strong: true })}<td>${dvBadge(d)}</td></tr>`)}</tbody></table></div></div>`
      : html`<div class="card empty">${icon('file', 40)}<h2>${{ pending: 'No vouchers waiting for certification', certified: 'No vouchers waiting for approval', approved: 'No vouchers waiting for payment', draft: 'No drafts', paid: 'No paid vouchers yet', open: 'No open vouchers' }[status] || 'No vouchers'}</h2><p>${query.q || query.kind ? 'Nothing matches the search — clear it to see all.' : ''}</p></div>`}`);
  clickableRows(el);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/dvs?${new URLSearchParams({ status, ...formData(e.target) })}`;
  };
}

export async function dvFormView(el, _p, query) {
  const existing = query.id ? await api.get(`/api/finance/dvs/${query.id}`) : null;
  const [cards, chart, obligations, iar] = await Promise.all([fin.cardList(), fin.chart(), api.get('/api/finance/obligations?status=unpaid'), query.iarId ? api.get(`/api/finance/iars/${query.iarId}`) : null]);
  const ors = query.orsId ? await api.get(`/api/finance/obligations/${query.orsId}`) : null;
  const s = fin.settings;
  const d = existing || {
    fund: ors?.fund || s.funds[0], payeeId: ors?.payeeId || '', orsId: ors?.id || '', iarId: iar?.id || '', kind: query.kind === 'advance' ? 'advance' : 'payment', nature: cards.find((c) => c.id === ors?.payeeId)?.nature || (iar ? 'goods' : ''),
    gross: iar ? iar.total : ors ? ors.unpaid - ors.lines.reduce((t, l) => t + l.pending, 0) : '', particulars: iar ? `Payment for delivery per IAR ${iar.no}, PO ${iar.po.no}, invoice ${iar.invoiceNo}` : ors ? ors.particulars : '',
    mode: (ors?.fund || s.funds[0]) === '01' ? 'check' : 'bank', office: ors?.office || '', deductions: iar?.liquidatedDamages ? [{ code: s.acct.fines, label: `Liquidated damages (${iar.daysLate} days late)`, amount: iar.liquidatedDamages }] : [], boxA: ors?.requestedBy || {},
  };
  mount(el, html`
    ${pageHead(existing ? `Edit DV (draft)` : 'New disbursement voucher', 'Taxes are computed from the payee\'s card and the nature of the payment; check them in the preview before submitting.', '', ['/dvs', 'Disbursement vouchers'])}
    <form class="card" id="dv">
      <div class="grid">
        <label class="field"><span>Kind</span><select name="kind" id="kind">${option('payment', 'Payment', d.kind === 'payment')}${option('advance', 'Cash advance', d.kind === 'advance')}</select></label>
        <label class="field"><span>Fund cluster</span><select name="fund">${fundOptions(d.fund)}</select></label>
        <label class="field"><span>Date</span><input type="date" name="date" value="${d.date || today()}" /></label>
        <label class="field span-2"><span>Obligation (ORS/BURS)</span><select name="orsId"><option value="">None (non-budgetary: remittances, trust, prior-year payables)</option>${obligations.map((o) => option(o.id, `${o.form} ${o.no} · ${o.payeeName} · ${num(o.unpaid)} unpaid`, o.id === d.orsId))}</select></label>
        <label class="field"><span>Payee</span><select name="payeeId" required>${cardOptions(cards, d.payeeId)}</select></label>
        <label class="field"><span>Gross amount (₱)</span><input type="number" step="0.01" min="0" name="gross" value="${d.gross}" required inputmode="decimal" /></label>
        <label class="field adv-only"><span>Advance for</span><select name="advanceType">${s.advanceTypes.map(([k, l]) => option(k, l, k === d.advanceType))}</select></label>
        <label class="field pay-only"><span>Nature of payment (decides the taxes withheld)</span><select name="nature">${d.nature ? '' : html`<option value="" selected disabled>Choose…</option>`}${s.natures.map(([k, l]) => option(k, l, k === d.nature))}</select></label>
        <label class="field"><span>Mode of payment</span><select name="mode">${s.paymentModes.map(([k, l]) => option(k, l, k === d.mode))}</select></label>
        <label class="field cash-only"><span>Paid by (special disbursing officer)</span><select name="officerId">${cardOptions(cards, d.officerId, ['officer'])}</select></label>
        <label class="field"><span>Bank account (agency checks)</span><select name="bankId"><option value="">Fund's account</option>${s.bankAccounts.map((b) => option(b.id, `${b.name} ${b.number} (fund ${b.fund})`, b.id === d.bankId))}</select></label>
        <label class="field"><span>Responsibility center</span><select name="office">${officeOptions(d.office)}</select></label>
        <label class="field adv-only"><span>Liquidate by (blank: the rule's days)</span><input type="date" name="liquidateBy" value="${d.liquidateBy || ''}" /></label>
        <label class="field span-3"><span>Particulars</span><textarea name="particulars" rows="2" required>${d.particulars}</textarea></label>
        <label class="field"><span>Box A: certified by</span><input name="boxAName" value="${d.boxA?.name || ''}" placeholder="Head of the requesting office" /></label>
        <label class="field"><span>Position</span><input name="boxATitle" value="${d.boxA?.title || ''}" /></label>
      </div>
      <input type="hidden" name="iarId" value="${d.iarId || ''}" />
      <details class="quotes pay-only" ${d.deductions.length ? 'open' : ''}><summary>Other deductions (liquidated damages, refunds…)</summary>
        ${linesTable('ded', [{ key: 'label', label: 'Deduction', type: 'text' }, { key: 'code', label: 'Credit to', type: 'select', options: (v) => accountOptions(chart, v || s.acct.fines, (a) => a.group === 4 || a.code.startsWith('20') || a.code.startsWith('103')) }, { key: 'amount', label: 'Amount', type: 'number' }], d.deductions, { min: 1, addLabel: 'Add deduction' })}
      </details>
      <details class="quotes" id="nonbud" ${d.orsId ? '' : 'open'}><summary>Debits (only for payments without an obligation)</summary>
        ${linesTable('debits', [{ key: 'code', label: 'Account', type: 'select', options: (v) => accountOptions(chart, v, (a) => !a.cls && a.group !== 5) }, { key: 'cardId', label: 'Subsidiary', type: 'select', options: (v) => html`<option value="">—</option>${cardOptions(cards, v)}` }, { key: 'amount', label: 'Amount', type: 'number' }], d.orsId ? [] : d.debits || [], { min: 1 })}
      </details>
      <div class="actions end"><button type="button" class="btn" id="preview">${icon('search', 16)} Preview taxes and entry</button><button class="btn" type="submit" value="draft">Save draft</button><button class="btn primary" type="submit" value="submit">Submit to accounting</button></div>
      <div id="pv"></div>
    </form>`);
  const form = el.querySelector('#dv');
  const toggle = () => {
    const adv = form.kind.value === 'advance';
    form.querySelectorAll('.adv-only').forEach((x) => (x.hidden = !adv));
    form.querySelectorAll('.pay-only').forEach((x) => (x.hidden = adv));
    form.nature.required = !adv; // the taxes depend on it: no silent default
  };
  form.kind.addEventListener('change', toggle);
  const cashOnly = () => form.querySelectorAll('.cash-only').forEach((x) => (x.hidden = form.mode.value !== 'cash'));
  form.mode.addEventListener('change', cashOnly);
  cashOnly();
  toggle();
  wireLines(el, 'ded');
  wireLines(el, 'debits');
  const body = () => {
    const v = formData(form);
    return { ...v, boxA: { name: v.boxAName, title: v.boxATitle }, deductions: form.kind.value === 'advance' ? [] : readLines(el, 'ded').filter((x) => Number(x.amount) > 0), debits: v.orsId ? undefined : readLines(el, 'debits') };
  };
  el.querySelector('#preview').addEventListener('click', async () => {
    if (form.kind.value !== 'advance' && !form.nature.value) return mount(el.querySelector('#pv'), html`<p class="notice bad">Choose the nature of payment first: it decides the taxes withheld.</p>`);
    try {
      const p = await api.post('/api/finance/dvs/preview', body());
      mount(el.querySelector('#pv'), html`<div class="preview"><h3 class="sub-h">Preview</h3>
        <table class="table compact"><tbody><tr><td>Gross</td>${amt(p.gross)}</tr>${p.taxes.map((t) => html`<tr><td>Less ${t.atc} ${t.rate}% of ${num(t.base)} (${t.kind === 'ewt' ? 'expanded withholding' : t.kind === 'vat' ? 'VAT withheld' : 'percentage tax'})</td>${amt(-t.amount)}</tr>`)}${p.deductions.map((x) => html`<tr><td>Less ${x.label}</td>${amt(-x.amount)}</tr>`)}<tr class="st-total"><td>Net amount</td>${amt(p.net, { strong: true })}</tr></tbody></table>
        <h3 class="sub-h">Box B: accounting entry</h3><table class="table compact"><thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>${p.entry.map((l) => html`<tr><td>${l.code} ${l.title}</td>${amt(l.debit, { blankZero: true })}${amt(l.credit, { blankZero: true })}</tr>`)}</tbody></table></div>`);
    } catch (err) {
      mount(el.querySelector('#pv'), html`<p class="notice bad">${err.message}</p>`);
    }
  });
  const changes = trackChanges(form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = { ...body(), submit: e.submitter?.value === 'submit' };
    await busy(e.target, async () => {
    try {
      const out = existing ? await api.put(`/api/finance/dvs/${existing.id}`, b) : await api.post('/api/finance/dvs', b);
      toast(b.submit ? 'Submitted to accounting for Box C.' : 'Draft saved.');
      changes.saved();
      location.hash = `#/dvs/${out.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
    });
  };
}

export async function dvView(el, params) {
  const d = await api.get(`/api/finance/dvs/${params.id}`);
  const reload = () => dvView(el, params);
  const post = async (path, body, msg) => {
    try {
      await api.post(`/api/finance/dvs/${d.id}/${path}`, body);
      toast(msg);
      ctx.refreshBadges?.();
      reload();
    } catch (err) {
      toast(err.message, 'error');
      throw err;
    }
  };
  const box = (label, done, who) => html`<div class="box ${done ? 'done' : ''}"><strong>${label}</strong><span>${done ? who : label.startsWith('B') ? 'Prepared (posted on payment)' : 'Pending'}</span></div>`;
  mount(el, html`
    ${pageHead(html`DV ${d.no || html`<span class="muted">· numbered at certification</span>`} ${dvBadge(d)}`, `${d.payee.name} · ${d.kind === 'advance' ? 'cash advance' : d.natureLabel} · Fund ${d.fund}`, html`
      ${d.no ? printLink('dv', d.id) : ''}
      ${d.status === 'draft' && can('finance.disburse') ? html`<a class="btn" href="#/dvs/new?id=${d.id}">${icon('edit', 16)} Edit</a>` : ''}
      ${d.status === 'draft' && !d.submitted && can('finance.disburse') ? html`<button class="btn primary" id="submit">Submit to accounting</button>` : ''}
      ${d.status === 'draft' && d.submitted && can('finance.accounts') ? html`<button class="btn primary" id="certify">Certify (Box C)</button>` : ''}
      ${d.status === 'certified' && can('finance.approve') ? html`<button class="btn primary" id="approve">Approve (Box D)</button>` : ''}
      ${d.status === 'approved' && can('finance.disburse') && d.mode !== 'ada' ? html`<button class="btn primary" id="pay">Pay</button>` : ''}
      ${d.status === 'approved' && d.mode === 'ada' && can('finance.disburse') ? html`<a class="btn primary" href="#/lddap">Put on an LDDAP-ADA</a>` : ''}
      ${d.status === 'paid' && can('finance.disburse') && !d.receipt ? html`<button class="btn" id="receipt">Box E: receipt</button>` : ''}
      ${d.status === 'paid' && !d.lddapId && can('finance.accounts') ? html`<button class="btn danger ghost" id="void">Void payment</button>` : ''}
      ${!['paid', 'cancelled'].includes(d.status) && (can('finance.disburse') || can('finance.accounts')) ? html`<button class="btn danger ghost push-right" id="cancel">Cancel voucher…</button>` : ''}`, ['/dvs', 'Disbursement vouchers'])}
    ${d.payToChanged ? html`<div class="notice">${icon('flag')}<p><strong>The payee's card now shows another bank account</strong> (${[d.payToChanged.bankName, d.payToChanged.bankAccount].filter(Boolean).join(' · ') || 'none'}). This voucher pays the account it was certified with: ${[d.payee.bankName, d.payee.bankAccount].filter(Boolean).join(' · ') || 'none'}. To pay another account, cancel this voucher and prepare it again.</p></div>` : ''}
    <div class="boxes">${box('A · Requesting office', true, d.boxA.name || '—')}${box('B · Accounting entry', d.status === 'paid', d.jevNo ? `Posted, JEV ${d.jevNo}` : 'Prepared')}${box('C · Accountant', d.certifiedBy, d.certifiedBy?.name)}${box('D · Approving officer', d.approvedBy, d.approvedBy?.name)}${box('Paid', d.status === 'paid', `${d.checkNo ? `Check ${d.checkNo}` : d.lddapNo ? `LDDAP-ADA ${d.lddapNo}` : ''} ${fmtDate(d.paidDate)}`)}${box('E · Received', d.receipt, d.receipt ? `${d.receipt.receivedBy}, ${fmtDate(d.receipt.date)}` : '')}</div>
    <section class="card">${infoGrid([
      ['Payee', html`<a href="#/cards/${d.payee.id}">${d.payee.name}</a>`], ['TIN', d.payee.tin], ['Obligation', d.ors ? html`<a href="#/obligations/${d.ors.id}">${d.ors.form} ${d.ors.no}</a>` : 'None (non-budgetary)'],
      d.iar && ['Delivery', html`IAR ${d.iar.no}`], ['Mode', d.modeLabel], ['Responsibility center', d.officeName || '—'], ['Particulars', d.particulars],
      d.kind === 'advance' && ['Advance for', fin.settings.advanceTypes.find(([k]) => k === d.advanceType)?.[1] || d.advanceType], d.voided?.length && ['Voided checks', d.voided.map((v) => `${v.checkNo} (${v.reason})`).join('; ')], d.cancelReason && ['Cancelled', d.cancelReason],
    ])}</section>
    <div class="cols">
      <section class="card"><h2>Amount</h2><table class="table compact"><tbody><tr><td>Gross amount</td>${amt(d.gross)}</tr>
        ${d.taxes.map((t) => html`<tr><td>Less ${{ ewt: 'expanded withholding tax', vat: 'VAT withheld', pt: 'percentage tax withheld' }[t.kind] || 'tax'} <span class="muted">(${t.atc}, ${t.rate}% of ${num(t.base)})</span></td>${amt(-t.amount)}</tr>`)}${d.deductions.map((x) => html`<tr><td>Less ${x.label}</td>${amt(-x.amount)}</tr>`)}
        <tr class="st-grand"><td>Net amount</td>${amt(d.net, { strong: true })}</tr></tbody></table></section>
      <section class="card"><h2>Box B · Accounting entry</h2><table class="table compact"><thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${d.entry.map((l) => html`<tr><td>${l.code} ${l.title}</td>${amt(l.debit, { blankZero: true })}${amt(l.credit, { blankZero: true })}</tr>`)}</tbody></table>
        ${d.jevNo ? html`<p class="muted small">Posted as <a href="#/journals/${d.journalId}">JEV ${d.jevNo}</a>.</p>` : ''}</section>
    </div>`);
  el.querySelector('#submit')?.addEventListener('click', async () => {
    try {
      await api.put(`/api/finance/dvs/${d.id}`, { submit: true });
      toast('Submitted.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#certify')?.addEventListener('click', () => modal({
    title: `Box C: certify DV`, submitLabel: 'Certify',
    body: html`<label class="field check"><input type="checkbox" name="docsComplete" required /> <span>Cash available; subject to Authority to Debit Account (when applicable); supporting documents complete and amount claimed proper.</span></label>`,
    onSubmit: (f) => post('certify', { docsComplete: Boolean(formData(f).docsComplete) }, 'Certified (Box C).'),
  }));
  el.querySelector('#approve')?.addEventListener('click', () => modal({ title: `Box D: approve DV ${d.no}`, submitLabel: 'Approve for payment', body: html`<p>Approved for payment: <strong>${money(d.net)}</strong> to ${d.payee.name}.</p>`, onSubmit: () => post('approve', {}, 'Approved for payment.') }));
  el.querySelector('#pay')?.addEventListener('click', () => modal({
    title: `Pay DV ${d.no}`, submitLabel: 'Record payment',
    body: html`${['check', 'bank'].includes(d.mode) ? html`<label class="field"><span>Check number</span><input name="checkNo" required /></label>` : ''}<label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label><p class="muted small">Posts the entry in Box B to the ${['check', 'bank'].includes(d.mode) ? 'Check' : 'Cash'} Disbursements Journal.</p>`,
    onSubmit: (f) => post('pay', formData(f), 'Paid.'),
  }));
  el.querySelector('#receipt')?.addEventListener('click', () => modal({ title: 'Box E: receipt of payment', submitLabel: 'Save', body: html`<label class="field"><span>Received by</span><input name="receivedBy" value="${d.payee.name}" /></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label><label class="field"><span>Payee's O.R. / invoice no.</span><input name="orNo" /></label>`, onSubmit: (f) => post('receipt', formData(f), 'Saved.') }));
  el.querySelector('#void')?.addEventListener('click', () => modal({ title: `Void the payment of DV ${d.no}`, submitLabel: 'Void payment', body: html`<p class="muted small">The payment entry is reversed and the voucher goes back to "to pay".</p><label class="field"><span>Reason</span><select name="reason">${['spoiled', 'stale (over six months)', 'cancelled', 'lost'].map((r) => option(r, r))}</select></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label>`, onSubmit: (f) => post('void-payment', formData(f), 'Payment voided.') }));
  el.querySelector('#cancel')?.addEventListener('click', () => modal({ title: 'Cancel voucher', submitLabel: 'Cancel voucher', cancelLabel: 'Keep it', body: html`<p class="muted small">The voucher is kept, marked cancelled, and its charges are released back to the obligation.</p><label class="field"><span>Reason</span><input name="reason" required /></label>`, onSubmit: (f) => (formData(f).reason.trim() ? post('cancel', formData(f), 'Voucher cancelled.') : Promise.reject(new Error('Give the reason for cancelling.'))) }));
}

// ----- LDDAP-ADA -----
export async function lddapView(el) {
  const [list, ready] = await Promise.all([api.get('/api/finance/lddaps'), api.get('/api/finance/dvs?status=approved')]);
  const ada = ready.filter((d) => d.mode === 'ada');
  mount(el, html`
    ${pageHead('LDDAP-ADA', 'List of Due and Demandable Accounts Payable – Advice to Debit Account: approved ADA vouchers paid straight to payees\' bank accounts through the MDS.', can('finance.disburse') && ada.length ? html`<button class="btn primary" id="new">${icon('plus', 16)} New LDDAP-ADA (${ada.length} ready)</button>` : '')}
    ${list.length ? html`<div class="card"><table class="table"><thead><tr><th>LDDAP-ADA no.</th><th>Date</th><th>Fund</th><th class="num">Vouchers</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${list.map((l) => html`<tr><td><strong>${l.no}</strong></td><td class="nowrap">${fmtDate(l.date)}</td><td>${l.fund}</td><td class="num">${l.dvs.length}</td>${amt(l.total)}<td class="row-actions">${printLink('lddap', l.id)}</td></tr>`)}</tbody></table></div>`
      : html`<div class="card empty">${icon('bank', 40)}<h2>No LDDAP-ADAs</h2><p>Approved vouchers with mode "LDDAP-ADA" are listed here for payment.</p></div>`}`);
  // One list per fund cluster: the dialog shows one fund's approved ADA vouchers at a time.
  const funds = [...new Set(ada.map((d) => d.fund))];
  el.querySelector('#new')?.addEventListener('click', () => {
    const m = modal({
      title: 'New LDDAP-ADA', wide: true, submitLabel: 'Issue',
      body: html`<div class="grid two"><label class="field"><span>Fund cluster</span><select name="fund">${funds.map((f) => option(f, `${f} · ${ada.filter((d) => d.fund === f).length} voucher(s)`))}</select></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label>
        <label class="field span-2"><span>MDS-GSB branch / account debited</span><select name="bankId"><option value="">Not recorded</option>${fin.settings.bankAccounts.map((b) => html`<option value="${b.id}" data-fund="${b.fund}">${b.name} ${b.number}</option>`)}</select></label></div>
        <table class="table compact"><thead><tr><th></th><th>DV</th><th>Payee</th><th>Bank account</th><th class="num">Net</th></tr></thead><tbody>${ada.map((d) => html`<tr data-fund="${d.fund}"><td><input type="checkbox" name="dv" value="${d.id}" checked aria-label="Include" /></td><td>${d.no} · fund ${d.fund}</td><td>${d.payee.name}</td><td>${d.payee.bankName || ''} ${d.payee.bankAccount || html`<span class="badge red">None</span>`}</td>${amt(d.net)}</tr>`)}</tbody></table>
        <p class="muted small">Posts each voucher's entry in the Cash Disbursements Journal.</p>`,
      async onSubmit(form) {
        const l = await api.post('/api/finance/lddaps', { date: form.date.value, bankId: form.bankId.value || null, dvIds: [...form.querySelectorAll('tr:not([hidden]) input[name=dv]:checked')].map((i) => i.value) });
        toast(`LDDAP-ADA ${l.no} issued.`);
        lddapView(el);
      },
    });
    const showFund = () => {
      m.form.querySelectorAll('tr[data-fund]').forEach((tr) => (tr.hidden = tr.dataset.fund !== m.form.fund.value));
      m.form.querySelectorAll('select[name=bankId] option[data-fund]').forEach((o) => (o.hidden = o.disabled = o.dataset.fund !== m.form.fund.value));
      if (m.form.bankId.selectedOptions[0]?.disabled) m.form.bankId.value = '';
    };
    m.form.fund.addEventListener('change', showFund);
    showFund();
  });
}

// ----- Cash advances -----
export async function advancesView(el, _p, query) {
  const all = Boolean(query.all);
  const list = await api.get(`/api/finance/advances${all ? '?all=1' : ''}`);
  const chart = await fin.chart();
  mount(el, html`
    ${pageHead('Cash advances', 'Advances to officers and employees (COA Circular 97-002): liquidate on time; no new advance while one is unsettled.', html`${can('finance.disburse') ? html`<a class="btn primary" href="#/dvs/new?kind=advance">${icon('plus', 16)} New advance (DV)</a>` : ''}`)}
    <nav class="tabs"><a href="#/advances" class="${all ? '' : 'active'}">Outstanding</a><a href="#/advances?all=1" class="${all ? 'active' : ''}">All, including settled</a></nav>
    ${list.length ? html`<div class="card"><div class="table-scroll"><table class="table"><thead><tr><th>DV</th><th>Officer</th><th>Purpose</th><th>Granted</th><th>Liquidate by</th><th class="num">Amount</th><th class="num">Liquidated</th><th class="num">Refunded</th><th class="num">Outstanding</th>${can('finance.accounts') ? html`<th></th>` : ''}</tr></thead>
      <tbody>${list.map((a) => html`<tr><td><a href="#/dvs/${a.id}">${a.no}</a></td><td><a href="#/cards/${a.payeeId}">${a.payee}</a><small>${a.typeLabel}</small></td><td>${a.particulars}</td><td class="nowrap">${fmtDate(a.paidDate)}<small>${a.daysOut} days ago</small></td><td class="nowrap">${fmtDate(a.due)} ${a.overdue ? badge('Overdue', 'red') : ''}</td>${amt(a.amount)}${amt(a.liquidated, { blankZero: true })}${amt(a.refunded, { blankZero: true })}${amt(a.outstanding, { strong: true })}
        ${can('finance.accounts') ? html`<td class="row-actions">${a.outstanding > 0 ? html`<button class="btn sm primary" data-liq="${a.id}">Liquidate</button>` : badge('Settled', 'green')}</td>` : ''}</tr>`)}</tbody></table></div></div>`
      : html`<div class="card empty">${icon('coins', 40)}<h2>No outstanding cash advances</h2></div>`}`);
  el.onclick = async (e) => {
    const b = e.target.closest('[data-liq]');
    if (!b) return;
    const a = list.find((x) => x.id === b.dataset.liq);
    const dv = await api.get(`/api/finance/dvs/${a.id}`);
    const ors = dv.ors ? await api.get(`/api/finance/obligations/${dv.ors.id}`) : null;
    const codes = new Set((ors?.lines || []).map((l) => l.code));
    const receipts = (await api.get('/api/finance/receipts?unreported=')).filter((r) => r.status === 'issued' && r.payorCardId === a.payeeId);
    const m = modal({
      title: `Liquidation of ${a.no}`, subtitle: `${a.payee} · outstanding ${money(a.outstanding)}`, wide: true, submitLabel: 'Post liquidation',
      body: html`<label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label>
        <h3 class="sub-h">Expenses (Liquidation Report, Appendix 44)</h3>
        ${linesTable('liq', [{ key: 'code', label: 'Expense account', type: 'select', options: (v) => accountOptions(chart, v, (x) => !codes.size || codes.has(x.code)) }, { key: 'particulars', label: 'Particulars', type: 'text' }, { key: 'amount', label: 'Amount', type: 'number' }], [], { total: true })}
        <label class="field"><span>Refund of the unused balance: official receipt</span><select name="receiptId"><option value="">No refund</option>${receipts.map((r) => option(r.id, `O.R. ${r.no} · ${fmtDate(r.date)} · ${num(r.total)}`))}</select><span class="hint">Issue the O.R. first (Revenue → Official receipts), crediting ${a.typeLabel.toLowerCase().includes('special') ? 'Advances to Special Disbursing Officers' : 'the advance account'} with the officer's card.</span></label>`,
      async onSubmit(form) {
        await api.post('/api/finance/liquidations', { dvId: a.id, date: form.date.value, receiptId: form.receiptId.value, lines: readLines(form, 'liq') });
        toast('Liquidation posted.');
        ctx.refreshBadges?.();
        advancesView(el, _p, query);
      },
    });
    wireLines(m.form, 'liq', (rows) => `Total ${money(rows.reduce((t, r) => t + (Number(r.amount) || 0), 0))}`);
  };
}

// ----- Taxes -----
export async function taxesView(el, _p, query) {
  const tab = query.tab || 'month';
  const month = query.month || lastMonth(); // taxes are summarized and remitted for the month just ended
  const year = Number(query.year) || new Date().getFullYear();
  const quarter = Number(query.quarter) || Math.ceil((new Date().getMonth() + 1) / 3);
  const kind = query.kind || 'ewt';
  const [d, cards] = await Promise.all([
    tab === 'month' ? api.get(`/api/finance/taxes?month=${month}`) : api.get(`/api/finance/taxes/alphalist?${new URLSearchParams({ year, quarter, kind })}`),
    fin.cardList(),
  ]);
  const reload = () => taxesView(el, _p, query);
  const KIND = { ewt: 'Expanded withholding (1601-EQ / 0619-E)', vat: 'VAT withheld (1600-VT)', pt: 'Percentage tax withheld (1600-PT)' };
  mount(el, html`
    ${pageHead('Taxes withheld', 'Withholding on government money payments: creditable expanded withholding tax, creditable VAT (5%) and percentage tax (3%), with BIR Form 2307 for each payee.', html`<button class="btn" id="csv">${icon('download', 16)} CSV</button><button class="btn" onclick="print()">${icon('file', 16)} Print</button>`)}
    <nav class="tabs">${[['month', 'Monthly summary and remittance'], ['alpha', 'Quarterly alphalist and 2307']].map(([k, l]) => html`<a href="#/taxes?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</nav>
    ${tab === 'month' ? html`
      <form class="toolbar" id="f"><input type="hidden" name="tab" value="month" /><input type="month" name="month" value="${month}" /><button class="btn">Show</button>
        ${can('finance.disburse') && d.rows.length ? html`<span class="grow"></span><button type="button" class="btn primary" id="remit">Record remittance</button>` : ''}</form>
      <div class="card"><div class="print-head"><strong>${fin.settings.entity.name}</strong><span>Summary of taxes withheld · ${monthName(month)}</span></div>
        ${d.rows.length ? html`<table class="table compact"><thead><tr><th>Fund</th><th>ATC</th><th>Nature of payment</th><th class="num">Payees</th><th class="num">Tax base</th><th class="num">Rate</th><th class="num">Tax withheld</th></tr></thead>
        <tbody>${d.rows.map((r) => html`<tr><td>${r.fund}</td><td><strong>${r.atc}</strong><small>${KIND[r.kind]}</small></td><td>${r.label}</td><td class="num">${r.payees}</td>${amt(r.base)}<td class="num">${r.rate}%</td>${amt(r.amount)}</tr>`)}</tbody>
        <tfoot><tr><td colspan="6">Total</td>${amt(d.total, { strong: true })}</tr></tfoot></table>` : html`<p class="muted">Nothing withheld in ${monthName(month)}.</p>`}
        <h3 class="sub-h">Remittances</h3>${d.remittances.length ? html`<table class="table compact"><thead><tr><th>Date</th><th>Fund</th><th>Mode</th><th>Reference</th><th class="num">Amount</th><th>JEV</th></tr></thead><tbody>${d.remittances.map((r) => html`<tr><td class="nowrap">${fmtDate(r.date)}</td><td>${r.fund}</td><td>${r.mode === 'tra' ? 'Tax Remittance Advice' : 'Bank / eFPS'}</td><td>${r.ref}</td>${amt(r.amount)}<td><a href="#/journals/${r.journalId}">${r.jevNo}</a></td></tr>`)}</tbody></table>` : html`<p class="muted">None yet. Due by the 10th of the next month (0619-E, 1600-VT, 1600-PT).</p>`}
        ${d.toRemit.some((x) => x.due > 0)
          ? html`<div class="notice">${icon('clock')}<p><strong>Still to remit for ${monthName(month)}, due ${fmtDate(d.dueDate)}:</strong> ${d.toRemit.filter((x) => x.due > 0).map((x) => `Fund ${x.fund} ${money(x.due)}`).join(' · ')} (0619-E, 1600-VT, 1600-PT).</p></div>`
          : d.toRemit.length ? html`<div class="notice ok">${icon('checkCircle')}<p>Everything withheld in ${monthName(month)} has been remitted.</p></div>` : ''}
        ${d.dueBir.some((x) => x.balance > 0) ? html`<p class="muted small">Due to BIR on the books today (all months, including withholdings not yet due): ${d.dueBir.filter((x) => x.balance > 0).map((x) => `Fund ${x.fund} ${money(x.balance)}`).join(' · ')}.</p>` : ''}</div>`
    : html`
      <form class="toolbar" id="f"><input type="hidden" name="tab" value="alpha" /><input type="number" name="year" value="${year}" style="width:100px" aria-label="Year" /><select name="quarter">${[1, 2, 3, 4].map((n) => option(n, `Quarter ${n}`, n === quarter))}</select><select name="kind">${option('ewt', 'Expanded withholding', kind === 'ewt')}${option('vat', 'VAT and percentage tax', kind === 'vat')}</select><button class="btn">Show</button></form>
      <div class="card"><div class="print-head"><strong>${fin.settings.entity.name}</strong><span>Quarterly Alphalist of Payees · ${year} Q${quarter} · ${kind === 'ewt' ? 'expanded withholding' : 'VAT and percentage tax withheld'}</span></div>
        ${d.rows.length ? html`<table class="table compact"><thead><tr><th>TIN</th><th>Payee</th><th>ATC</th><th class="num">Income payment</th><th class="num">Rate</th><th class="num">Tax withheld</th><th></th></tr></thead>
        <tbody>${d.rows.map((r) => html`<tr><td>${r.tin || html`<span class="badge red">No TIN</span>`}</td><td>${r.name}</td><td>${r.atc}</td>${amt(r.base)}<td class="num">${r.rate}%</td>${amt(r.amount)}<td><a class="btn sm" href="#/print/2307/${r.payeeId}?year=${year}&quarter=${quarter}&kind=${kind}">${icon('file', 14)} 2307</a></td></tr>`)}</tbody>
        <tfoot><tr><td colspan="3">Total</td>${amt(d.base, { strong: true })}<td></td>${amt(d.total, { strong: true })}<td></td></tr></tfoot></table>` : html`<p class="muted">Nothing withheld in the quarter.</p>`}</div>`}`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/taxes?${new URLSearchParams(formData(e.target))}`;
  };
  el.querySelector('#csv').addEventListener('click', () => downloadFile(tab === 'month' ? `taxes-${month}.csv` : `alphalist-${year}-Q${quarter}.csv`, toCsv(tab === 'month'
    ? [['Fund', 'ATC', 'Nature', 'Payees', 'Base', 'Rate', 'Tax'], ...d.rows.map((r) => [r.fund, r.atc, r.label, r.payees, r.base, r.rate, r.amount])]
    : [['TIN', 'Payee', 'ATC', 'Income payment', 'Rate', 'Tax withheld'], ...d.rows.map((r) => [r.tin, r.name, r.atc, r.base, r.rate, r.amount])])));
  el.querySelector('#remit')?.addEventListener('click', () => modal({
    title: `Remit taxes withheld in ${monthName(month)}`, submitLabel: 'Record remittance',
    body: html`<label class="field"><span>Fund cluster</span><select name="fund">${fundOptions(fin.settings.funds[0])}</select><span class="hint">Fund 01 remits through a Tax Remittance Advice (TRA); other funds pay from their bank account (eFPS).</span></label>
      <label class="field"><span>TRA no. / payment reference</span><input name="ref" required /></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" /></label>`,
    async onSubmit(form) {
      const r = await api.post('/api/finance/remittances', { ...formData(form), month });
      toast(`Remitted ${money(r.amount)}.`);
      reload();
    },
  }));
  void cards;
}
