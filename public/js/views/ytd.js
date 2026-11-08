// Year to date: each employee's totals for the year from finalized payslips, plus opening
// balances (pay earlier in the year before CORE, or from a previous employer's BIR 2316).
// The 13th month pay, tax annualization, BIR 2316 and the alphalist are built from these totals.
import { api } from '../api.js';
import { can } from '../state.js';
import { html, mount, money, amount, fmtDate, toast, modal, downloadFile, toCsv } from '../ui.js';

const LABELS = {
  basicPay: 'Basic pay', overtimePay: 'Overtime', restDayPay: 'Rest day pay', holidayPay: 'Holiday pay', nightDiffPay: 'Night differential',
  otherEarnings: 'Other earnings', grossPay: 'Gross pay', nonTaxable: 'Non-taxable', taxableIncome: 'Taxable pay', sss: 'SSS', philhealth: 'PhilHealth',
  pagibig: 'Pag-IBIG', withholdingTax: 'Tax withheld', otherDeductions: 'Other deductions', netPay: 'Net pay', erSss: 'Employer SSS (incl. EC)',
  erPhilhealth: 'Employer PhilHealth', erPagibig: 'Employer Pag-IBIG',
};
const premiums = (t) => t.overtimePay + t.restDayPay + t.holidayPay + t.nightDiffPay;

function openingForm(employees, year, sources, after) {
  const num = (name, label, hint = '') => html`<label class="field"><span>${label}</span><div class="input-suffix"><em class="pre">₱</em><input type="number" min="0" step="0.01" name="${name}" /></div>${hint ? html`<small class="muted">${hint}</small>` : ''}</label>`;
  modal({
    title: `Add an opening balance for ${year}`,
    subtitle: 'Pay this year that CORE did not compute: earlier months at LTDC, or a new hire’s previous employer (from their BIR 2316).',
    wide: true,
    submitLabel: 'Add opening balance',
    body: html`<div class="grid">
      <label class="field"><span>Employee</span><select name="employeeId" required><option value="">Choose…</option>${employees.map((e) => html`<option value="${e.id}">${e.lastName}, ${e.firstName} (${e.employeeNo})</option>`)}</select></label>
      <label class="field"><span>Source</span><select name="source">${Object.entries(sources).map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></label>
      <label class="field"><span>Covers pay up to</span><input type="date" name="asOf" value="${year}-01-01" /></label>
      ${num('grossPay', 'Gross pay', 'Total compensation')}
      ${num('basicPay', 'Basic pay', 'Counts toward LTDC’s 13th month only when earned at LTDC')}
      ${num('nonTaxable', 'Non-taxable pay', '13th month and other benefits up to ₱90,000, de minimis, contributions')}
      ${num('taxableIncome', 'Taxable pay')}
      ${num('withholdingTax', 'Tax withheld')}
      ${num('sss', 'SSS (employee)')}${num('philhealth', 'PhilHealth (employee)')}${num('pagibig', 'Pag-IBIG (employee)')}
      <label class="field span-3"><span>Note (recorded in the audit log)</span><input name="note" maxlength="300" placeholder="e.g. BIR 2316 from ABC Corp., January to March" required /></label>
    </div>`,
    onSubmit: async (f) => {
      await api.post('/api/payroll-ledger/openings', { ...Object.fromEntries(new FormData(f)), year });
      toast('Opening balance added.');
      after();
    },
  });
}

export async function ytdView(el, _params, query) {
  const d = await api.get(`/api/payroll-ledger?year=${Number(query.year) || new Date().getFullYear()}`);
  const { year, totals, openings, sources } = d;
  const sum = (f) => totals.reduce((a, t) => a + (typeof f === 'function' ? f(t) : t[f]), 0);
  mount(el, html`
    <header class="page-head">
      <div><a class="back" href="#/payroll">← Payroll</a><h1>Year to date</h1>
        <p class="muted">Totals from finalized payslips, plus opening balances. Draft and voided runs are not counted. The 13th month so far is 1/12 of the basic pay earned at LTDC.</p></div>
      <div class="actions">
        <button class="btn" id="export" ${totals.length ? '' : 'disabled'}>Export CSV</button>
        ${can('payroll.edit') ? html`<button class="btn primary" id="add-opening">+ Opening balance</button>` : ''}
      </div>
    </header>
    <nav class="tabs">${d.years.map((y) => html`<a href="#/payroll/ytd?year=${y}" class="${y === year ? 'active' : ''}">${y}</a>`)}</nav>
    <div class="stats">
      <div class="card"><small>Gross pay</small><strong>${money(sum('grossPay'))}</strong></div>
      <div class="card"><small>Tax withheld</small><strong>${money(sum('withholdingTax'))}</strong></div>
      <div class="card"><small>Employee contributions</small><strong>${money(sum((t) => t.sss + t.philhealth + t.pagibig))}</strong></div>
      <div class="card"><small>13th month accrued</small><strong>${money(sum('thirteenthMonthSoFar'))}</strong></div>
    </div>
    <section class="card scroll-x">
      ${totals.length ? html`<table class="table ytd-table">
        <thead><tr><th>Employee</th><th class="num">Payslips</th><th class="num">Basic pay</th><th class="num">Premiums</th><th class="num">Other earn.</th><th class="num">Gross</th><th class="num">Non-taxable</th><th class="num">Taxable</th><th class="num">SSS</th><th class="num">PhilHealth</th><th class="num">Pag-IBIG</th><th class="num">Tax withheld</th><th class="num">Net</th><th class="num">13th month so far</th></tr></thead>
        <tbody>${totals.map((t) => html`<tr>
          <td><strong>${t.name}</strong><small>${t.employeeNo}${t.openings ? ` · ${t.openings} opening balance${t.openings === 1 ? '' : 's'}` : ''}</small></td>
          <td class="num">${t.runs}</td><td class="num">${amount(t.basicPay)}</td><td class="num">${amount(premiums(t))}</td><td class="num">${amount(t.otherEarnings)}</td>
          <td class="num"><strong>${amount(t.grossPay)}</strong></td><td class="num">${amount(t.nonTaxable)}</td><td class="num">${amount(t.taxableIncome)}</td>
          <td class="num">${amount(t.sss)}</td><td class="num">${amount(t.philhealth)}</td><td class="num">${amount(t.pagibig)}</td>
          <td class="num">${amount(t.withholdingTax)}</td><td class="num">${amount(t.netPay)}</td><td class="num"><strong>${amount(t.thirteenthMonthSoFar)}</strong></td>
        </tr>`)}</tbody></table>`
        : html`<div class="empty"><p>Nothing for ${year} yet. Totals appear when a payroll run is finalized.</p></div>`}
    </section>
    <section class="card scroll-x">
      <h2>Opening balances, ${year}</h2>
      ${openings.length ? html`<table class="table">
        <thead><tr><th>Employee</th><th>Source</th><th>Up to</th><th class="num">Gross</th><th class="num">Taxable</th><th class="num">Tax withheld</th><th>Note</th><th></th></tr></thead>
        <tbody>${openings.map((o) => html`<tr>
          <td>${o.name}</td><td>${sources[o.source]}</td><td>${fmtDate(o.payDate)}</td><td class="num">${amount(o.grossPay)}</td><td class="num">${amount(o.taxableIncome)}</td><td class="num">${amount(o.withholdingTax)}</td>
          <td><small>${o.note}</small><small class="muted">Added by ${o.postedBy || '—'}</small></td>
          <td class="row-actions">${can('payroll.edit') ? html`<button class="link danger" data-remove="${o.id}">Remove</button>` : ''}</td>
        </tr>`)}</tbody></table>`
        : html`<p class="muted">None. Add one for an employee hired this year who brings a BIR 2316 from a previous employer, or for months paid before CORE.</p>`}
    </section>`);

  const reload = () => ytdView(el, _params, { year });
  el.querySelector('#add-opening')?.addEventListener('click', async () => {
    const employees = (await api.get('/api/employees')).sort((a, b) => a.lastName.localeCompare(b.lastName));
    openingForm(employees, year, sources, reload);
  });
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => modal({
    title: 'Remove this opening balance?',
    submitLabel: 'Remove',
    body: html`<label class="field"><span>Reason (recorded in the audit log)</span><input name="reason" maxlength="300" /></label>`,
    onSubmit: async (f) => {
      await api.del(`/api/payroll-ledger/openings/${b.dataset.remove}?reason=${encodeURIComponent(f.reason.value)}`);
      toast('Opening balance removed.');
      reload();
    },
  })));
  el.querySelector('#export').addEventListener('click', () => {
    const fields = d.fields;
    const rows = [['Employee No', 'Employee', 'Department', 'Payslips', 'Opening balances', ...fields.map((f) => LABELS[f] || f), '13th Month Basis', '13th Month So Far'],
      ...totals.map((t) => [t.employeeNo, t.name, t.department, t.runs, t.openings, ...fields.map((f) => t[f]), t.thirteenthBasis, t.thirteenthMonthSoFar])];
    downloadFile(`year-to-date-${year}.csv`, toCsv(rows));
  });
}
