import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { currentPeriod } from '/shared/calc.js';
import { html, mount, money, amount, fmtDate, fmtMinutes, badge, toast, modal, confirmDialog, downloadFile, toCsv, today } from '../ui.js';

const statusBadge = (s) => (s === 'finalized' ? badge('Finalized', 'green') : badge('Draft', 'amber'));
const periodLabel = (r) => `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}`;

export async function payrollListView(el) {
  const runs = await api.get('/api/payroll-runs');

  mount(el, html`
    <header class="page-head">
      <div><h1>Payroll</h1><p class="muted">${ctx.settings.payFrequency === 'monthly' ? 'Monthly' : 'Semi-monthly'} payroll with SSS, PhilHealth, Pag-IBIG and BIR withholding tax.</p></div>
      <div class="actions">${can('payroll.edit') ? html`<button class="btn primary" id="new-run">+ New payroll run</button>` : ''}</div>
    </header>
    <section class="card">
      ${runs.length
        ? html`<table class="table clickable">
            <thead><tr><th>Pay period</th><th>Pay date</th><th class="num">Employees</th><th class="num">Gross pay</th><th class="num">Deductions</th><th class="num">Net pay</th><th>Status</th></tr></thead>
            <tbody>${runs.map((r) => html`<tr data-href="#/payroll/${r.id}">
              <td><strong>${periodLabel(r)}</strong></td><td>${fmtDate(r.payDate)}</td>
              <td class="num">${r.totals.employees}</td><td class="num">${money(r.totals.grossPay)}</td>
              <td class="num">${money(r.totals.totalDeductions)}</td><td class="num"><strong>${money(r.totals.netPay)}</strong></td>
              <td>${statusBadge(r.status)}</td></tr>`)}</tbody>
          </table>`
        : html`<div class="empty"><h2>No payroll runs yet</h2><p>Create a run for a pay period. Pay is computed from each employee's rate and their attendance records.</p></div>`}
    </section>`);

  el.querySelector('tbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });

  el.querySelector('#new-run')?.addEventListener('click', () => {
    const p = currentPeriod(today(), ctx.settings.payFrequency);
    const { form } = modal({
      title: 'New payroll run',
      submitLabel: 'Compute payroll',
      body: html`
        <div class="grid two">
          <label class="field"><span>Period start</span><input type="date" name="periodStart" value="${p.start}" required /></label>
          <label class="field"><span>Period end</span><input type="date" name="periodEnd" value="${p.end}" required /></label>
          <label class="field"><span>Pay date</span><input type="date" name="payDate" value="${p.end}" required /></label>
        </div>
        <p class="muted small">All active employees are included. Scheduled work days without an attendance record count as absences, so record leaves before running payroll.</p>`,
      onSubmit: async (f) => {
        const run = await api.post('/api/payroll-runs', Object.fromEntries(new FormData(f)));
        toast('Payroll computed.');
        location.hash = `#/payroll/${run.id}`;
      },
    });
    const start = form.querySelector('[name=periodStart]');
    start.addEventListener('change', () => {
      const np = currentPeriod(start.value, ctx.settings.payFrequency);
      form.querySelector('[name=periodEnd]').value = np.end;
      form.querySelector('[name=payDate]').value = np.end;
    });
  });
}

const REGISTER_COLUMNS = [
  ['Employee No', (p) => p.employee.employeeNo], ['Employee', (p) => p.employee.name], ['Department', (p) => p.employee.department],
  ['Days Present', (p) => p.attendance.daysPresent], ['Leave Days', (p) => p.attendance.leaveDays], ['Absences', (p) => p.attendance.absentDays],
  ['Late+UT (min)', (p) => p.attendance.lateMinutes + p.attendance.undertimeMinutes], ['OT (min)', (p) => p.attendance.overtimeMinutes + p.attendance.restDayMinutes],
  ['Basic Pay', (p) => p.earnings.basicPay], ['Overtime Pay', (p) => p.earnings.overtimePay + p.earnings.restDayPay], ['Other Earnings', (p) => p.earnings.otherEarnings],
  ['Gross Pay', (p) => p.grossPay], ['SSS', (p) => p.deductions.sss], ['PhilHealth', (p) => p.deductions.philhealth], ['Pag-IBIG', (p) => p.deductions.pagibig],
  ['Withholding Tax', (p) => p.deductions.withholdingTax], ['Other Deductions', (p) => p.deductions.otherDeductions], ['Allowance', (p) => p.allowance],
  ['Net Pay', (p) => p.netPay], ['Bank', (p) => p.employee.bankName], ['Account No', (p) => p.employee.bankAccount],
];

export async function payrollRunView(el, { id }) {
  let run = await api.get(`/api/payroll-runs/${id}`);
  // Pending leave / remote-work requests inside the period change pay once decided.
  const pendingRequests = can('leave.manage')
    ? (await api.get('/api/requests?status=pending')).filter((r) => r.startDate <= run.periodEnd && r.endDate >= run.periodStart)
    : [];

  function render() {
    const draft = run.status === 'draft';
    const editable = draft && can('payroll.edit');
    const open = run.payslips.filter((p) => p.attendance.openEntries).length;
    const absent = run.payslips.reduce((a, p) => a + p.attendance.absentDays, 0);
    const pendingOt = run.payslips.filter((p) => p.attendance.unapprovedOvertimeMinutes).length;
    const t = run.totals;

    mount(el, html`
      <header class="page-head">
        <div><a class="back" href="#/payroll">← Payroll</a><h1>${periodLabel(run)} ${statusBadge(run.status)}</h1>
          <p class="muted">Pay date ${fmtDate(run.payDate)} · ${run.payFrequency} · ${draft ? 'Draft: recompute after changing attendance or employee data.' : `Finalized ${new Date(run.finalizedAt).toLocaleString('en-PH')}`}</p></div>
        <div class="actions">
          <button class="btn" id="export">Export register</button>
          <a class="btn" href="#/payroll/${run.id}/payslip/all">Print payslips</a>
          ${editable ? html`<button class="btn" id="recompute">Recompute</button><button class="btn gold" id="finalize">Finalize</button>` : ''}
        </div>
      </header>
      <div class="stats">
        <div class="card"><small>Employees</small><strong>${t.employees}</strong></div>
        <div class="card"><small>Gross pay</small><strong>${money(t.grossPay)}</strong></div>
        <div class="card"><small>Total deductions</small><strong>${money(t.totalDeductions)}</strong></div>
        <div class="card accent"><small>Net pay</small><strong>${money(t.netPay)}</strong></div>
        <div class="card"><small>Employer contributions</small><strong>${money(t.employerContributions)}</strong></div>
      </div>
      ${draft && (open || absent || pendingOt || pendingRequests.length)
        ? html`<div class="notice">
            ${open ? html`<p><strong>${open}</strong> employee(s) have open attendance records (no clock-out). Those days are not paid until fixed in <a href="#/dtr?from=${run.periodStart}&to=${run.periodEnd}">Attendance</a>.</p>` : ''}
            ${absent ? html`<p><strong>${absent}</strong> scheduled work day(s) have no attendance record and were counted as absences.</p>` : ''}
            ${pendingOt ? html`<p><strong>${pendingOt}</strong> employee(s) have overtime awaiting approval; it is not paid until approved.</p>` : ''}
            ${pendingRequests.length ? html`<p><strong>${pendingRequests.length}</strong> leave or remote-work request(s) in this period are still pending. <a href="#/leave">Review them</a>, then recompute.</p>` : ''}
          </div>`
        : ''}
      <section class="card scroll-x">
        <table class="table register">
          <thead><tr>
            <th>Employee</th><th class="num">Days</th><th class="num">Absent</th><th class="num">Late/UT</th><th class="num">OT</th>
            <th class="num">Basic</th><th class="num">OT pay</th><th class="num">Other earn.</th><th class="num">Gross</th>
            <th class="num">SSS</th><th class="num">PhilHealth</th><th class="num">Pag-IBIG</th><th class="num">Tax</th><th class="num">Other ded.</th>
            <th class="num">Allowance</th><th class="num">Net pay</th><th></th>
          </tr></thead>
          <tbody>${run.payslips.map((p) => html`<tr>
            <td><strong>${p.employee.name}</strong><small>${p.employee.employeeNo}</small></td>
            <td class="num">${p.attendance.daysPresent + p.attendance.leaveDays}/${p.attendance.scheduledDays}</td>
            <td class="num ${p.attendance.absentDays ? 'warn' : ''}">${p.attendance.absentDays || '—'}</td>
            <td class="num">${fmtMinutes(p.attendance.lateMinutes + p.attendance.undertimeMinutes)}</td>
            <td class="num">${fmtMinutes(p.attendance.overtimeMinutes + p.attendance.restDayMinutes)}</td>
            <td class="num">${amount(p.earnings.basicPay)}</td>
            <td class="num">${amount(p.earnings.overtimePay + p.earnings.restDayPay)}</td>
            <td class="num">${amount(p.earnings.otherEarnings)}</td>
            <td class="num"><strong>${amount(p.grossPay)}</strong></td>
            <td class="num">${amount(p.deductions.sss)}</td>
            <td class="num">${amount(p.deductions.philhealth)}</td>
            <td class="num">${amount(p.deductions.pagibig)}</td>
            <td class="num">${amount(p.deductions.withholdingTax)}</td>
            <td class="num">${amount(p.deductions.otherDeductions)}</td>
            <td class="num">${amount(p.allowance)}</td>
            <td class="num"><strong>${amount(p.netPay)}</strong></td>
            <td class="row-actions">${editable ? html`<button class="link" data-adjust="${p.employeeId}">Adjust</button>` : ''}<a class="link" href="#/payroll/${run.id}/payslip/${p.employeeId}">Payslip</a></td>
          </tr>`)}</tbody>
          <tfoot><tr><td><strong>Total</strong></td><td colspan="7"></td><td class="num"><strong>${amount(t.grossPay)}</strong></td>
            ${['sss', 'philhealth', 'pagibig', 'withholdingTax', 'otherDeductions'].map((k) => html`<td class="num">${amount(run.payslips.reduce((a, p) => a + p.deductions[k], 0))}</td>`)}
            <td class="num">${amount(run.payslips.reduce((a, p) => a + p.allowance, 0))}</td><td class="num"><strong>${amount(t.netPay)}</strong></td><td></td></tr></tfoot>
        </table>
      </section>
      ${can('payroll.edit') ? html`<div class="danger-zone"><button class="btn danger ghost" id="delete">Delete payroll run</button></div>` : ''}`);
    bind();
  }

  function bind() {
    el.querySelector('#export').addEventListener('click', () => {
      const data = [REGISTER_COLUMNS.map((c) => c[0]), ...run.payslips.map((p) => REGISTER_COLUMNS.map(([, f]) => f(p)))];
      downloadFile(`payroll-register-${run.periodStart}-to-${run.periodEnd}.csv`, toCsv(data));
    });
    el.querySelector('#recompute')?.addEventListener('click', async () => {
      run = await api.post(`/api/payroll-runs/${id}/recompute`);
      toast('Payroll recomputed from the latest data.');
      render();
    });
    el.querySelector('#finalize')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Finalize this payroll run? It will be recomputed one last time and then locked.', { confirmLabel: 'Finalize', danger: false }))) return;
      run = await api.post(`/api/payroll-runs/${id}/finalize`);
      toast('Payroll finalized.');
      render();
    });
    el.querySelector('#delete')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete the payroll run for ${periodLabel(run)}? This cannot be undone.`))) return;
      await api.del(`/api/payroll-runs/${id}`);
      toast('Payroll run deleted.');
      location.hash = '#/payroll';
    });
    el.querySelectorAll('[data-adjust]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = run.payslips.find((x) => x.employeeId === b.dataset.adjust);
        modal({
          title: `Adjust pay: ${p.employee.name}`,
          body: html`<div class="grid two">
            <label class="field"><span>Other earnings (₱, taxable)</span><input type="number" min="0" step="0.01" name="otherEarnings" value="${p.adjustments.otherEarnings || ''}" /><small class="muted">Bonus, commission, holiday pay, etc.</small></label>
            <label class="field"><span>Other deductions (₱)</span><input type="number" min="0" step="0.01" name="otherDeductions" value="${p.adjustments.otherDeductions || ''}" /><small class="muted">Loans, cash advances, etc.</small></label>
            <label class="field span-2"><span>Remarks (shown on payslip)</span><input name="remarks" value="${p.adjustments.remarks}" /></label>
          </div>`,
          onSubmit: async (f) => {
            run = await api.put(`/api/payroll-runs/${id}/payslips/${p.employeeId}`, Object.fromEntries(new FormData(f)));
            toast('Adjustment saved.');
            render();
          },
        });
      }),
    );
  }

  render();
}

// Amount in words for the payslip, e.g. 20782.48 -> "Twenty thousand seven hundred eighty-two pesos and 48/100".
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function under1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : '');
  return [h ? `${ONES[h]} hundred` : '', rest].filter(Boolean).join(' ');
}
export function pesosInWords(value) {
  const cents = Math.round(Math.abs(value) * 100);
  let whole = Math.floor(cents / 100);
  const parts = [];
  for (const unit of ['', 'thousand', 'million', 'billion']) {
    const chunk = whole % 1000;
    if (chunk) parts.unshift(`${under1000(chunk)}${unit ? ` ${unit}` : ''}`);
    whole = Math.floor(whole / 1000);
    if (!whole) break;
  }
  const words = parts.join(' ') || 'zero';
  return `${words[0].toUpperCase()}${words.slice(1)} peso${Math.floor(cents / 100) === 1 ? '' : 's'} and ${String(cents % 100).padStart(2, '0')}/100`;
}

// Reference printed on the payslip: period start and employee number, e.g. PS-20261001-EMP-0002.
const slipNumber = (run, p) => `PS-${run.periodStart.replaceAll('-', '')}-${p.employee.employeeNo}`;

export function payslipCard(run, p, settings) {
  const a = p.attendance;
  // Amounts taken off are shown in parentheses, as on a statement.
  const row = (label, value, { sub = false, note = '' } = {}) => html`<tr class="${sub ? 'sub' : ''}"><td>${label}${note ? html`<small>${note}</small>` : ''}</td><td class="num">${value < 0 ? `(${amount(-value)})` : amount(value)}</td></tr>`;
  const optional = (label, value, opts) => (value ? row(label, value, opts) : '');
  const field = (label, value) => html`<div><dt>${label}</dt><dd>${value || '—'}</dd></div>`;
  const employerTotal = p.employerShare.sss + p.employerShare.sssEc + p.employerShare.philhealth + p.employerShare.pagibig;
  return html`
    <article class="payslip ${run.status === 'draft' ? 'is-draft' : ''}">
      ${run.status === 'draft' ? html`<div class="ps-watermark" aria-hidden="true">DRAFT</div>` : ''}
      <header class="ps-head">
        <div class="ps-company">
          <img src="/img/logo.png" alt="" />
          <div><strong>${settings.companyName}</strong><span>${settings.companyAddress}</span>${settings.companyTin ? html`<span>TIN ${settings.companyTin}</span>` : ''}</div>
        </div>
        <div class="ps-title">
          <h2>Payslip</h2>
          <p class="ps-ref">${slipNumber(run, p)}</p>
          <p class="ps-conf">Private and confidential</p>
        </div>
      </header>

      <dl class="ps-meta">
        <div><dt>Pay period</dt><dd>${periodLabel(run)}</dd></div>
        <div><dt>Pay date</dt><dd>${fmtDate(run.payDate)}</dd></div>
        <div><dt>Pay frequency</dt><dd>${run.payFrequency === 'monthly' ? 'Monthly' : 'Semi-monthly'}</dd></div>
        <div><dt>Status</dt><dd>${run.status === 'draft' ? 'Draft, not final' : 'Final'}</dd></div>
      </dl>

      <section class="ps-block">
        <h3>Employee information</h3>
        <dl class="ps-fields">
          ${field('Employee name', p.employee.name)}${field('Employee no.', p.employee.employeeNo)}
          ${field('Position', p.employee.position)}${field('Department', p.employee.department)}
          ${field('Rate', `${money(p.employee.rate)} per ${p.employee.payType === 'daily' ? 'day' : 'month'}${a.flex ? ' · Flexible time' : ''}`)}${field('TIN', p.employee.tin)}
          ${field('SSS no.', p.employee.sssNo)}${field('PhilHealth no.', p.employee.philhealthNo)}
          ${field('Pag-IBIG no.', p.employee.pagibigNo)}${field('Paid to', p.employee.bankAccount ? `${p.employee.bankName} ${p.employee.bankAccount}` : 'Cash / cheque')}
        </dl>
      </section>

      <div class="ps-ledger">
        <table class="ps-table">
          <thead><tr><th>Earnings</th><th class="num">Amount (PHP)</th></tr></thead>
          <tbody>
            ${row('Basic pay', p.earnings.basePay, { note: p.employee.payType === 'daily' ? `${a.daysPresent + a.leaveDays} day/s` : '' })}
            ${optional('Less: absences', -p.earnings.absenceDeduction, { sub: true, note: `${a.absentDays} day/s${a.unpaidLeaveDays ? `, unpaid leave ${a.unpaidLeaveDays}` : ''}` })}
            ${a.flex ? '' : optional('Less: late and undertime', -p.earnings.tardinessDeduction, { sub: true, note: fmtMinutes(a.lateMinutes + a.undertimeMinutes) })}
            ${optional('Overtime', p.earnings.overtimePay, { note: fmtMinutes(a.overtimeMinutes) })}
            ${optional('Rest day work', p.earnings.restDayPay, { note: fmtMinutes(a.restDayMinutes) })}
            ${optional('Other earnings', p.earnings.otherEarnings)}
          </tbody>
          <tfoot><tr><td>Gross pay</td><td class="num">${amount(p.grossPay)}</td></tr></tfoot>
        </table>
        <table class="ps-table">
          <thead><tr><th>Deductions</th><th class="num">Amount (PHP)</th></tr></thead>
          <tbody>
            ${row('SSS contribution', p.deductions.sss)}
            ${row('PhilHealth contribution', p.deductions.philhealth)}
            ${row('Pag-IBIG contribution', p.deductions.pagibig)}
            ${row('Withholding tax', p.deductions.withholdingTax, { note: p.deductions.withholdingTax ? '' : 'exempt / below threshold' })}
            ${optional('Other deductions', p.deductions.otherDeductions)}
          </tbody>
          <tfoot><tr><td>Total deductions</td><td class="num">${amount(p.totalDeductions)}</td></tr></tfoot>
        </table>
      </div>

      <section class="ps-summary">
        <dl>
          <div><dt>Gross pay</dt><dd>${amount(p.grossPay)}</dd></div>
          <div><dt>Less: total deductions</dt><dd>(${amount(p.totalDeductions)})</dd></div>
          ${p.allowance ? html`<div><dt>Add: allowance (non-taxable)</dt><dd>${amount(p.allowance)}</dd></div>` : ''}
          <div><dt>Taxable income</dt><dd>${amount(p.taxableIncome)}</dd></div>
        </dl>
        <div class="ps-net">
          <span>Net pay</span>
          <strong>${money(p.netPay)}</strong>
          <em>${pesosInWords(p.netPay)}</em>
        </div>
      </section>

      <div class="ps-ledger ps-small">
        <table class="ps-table">
          <thead><tr><th>Attendance</th><th class="num">Count</th></tr></thead>
          <tbody>
            <tr><td>Scheduled work days</td><td class="num">${a.scheduledDays}</td></tr>
            <tr><td>Days present${a.remoteDays ? html`<small>incl. ${a.remoteDays} remote</small>` : ''}</td><td class="num">${a.daysPresent}</td></tr>
            <tr><td>Paid leave</td><td class="num">${a.leaveDays}</td></tr>
            <tr><td>Absences / unpaid leave</td><td class="num">${a.absentDays + a.unpaidLeaveDays}</td></tr>
            <tr><td>Late and undertime</td><td class="num">${a.flex ? 'Not applicable' : fmtMinutes(a.lateMinutes + a.undertimeMinutes) || '—'}</td></tr>
            <tr><td>Approved overtime</td><td class="num">${fmtMinutes(a.overtimeMinutes + a.restDayMinutes) || '—'}</td></tr>
          </tbody>
        </table>
        <table class="ps-table">
          <thead><tr><th>Employer contributions</th><th class="num">Amount (PHP)</th></tr></thead>
          <tbody>
            <tr><td>SSS<small>incl. EC ${amount(p.employerShare.sssEc)}</small></td><td class="num">${amount(p.employerShare.sss + p.employerShare.sssEc)}</td></tr>
            <tr><td>PhilHealth</td><td class="num">${amount(p.employerShare.philhealth)}</td></tr>
            <tr><td>Pag-IBIG</td><td class="num">${amount(p.employerShare.pagibig)}</td></tr>
          </tbody>
          <tfoot><tr><td>Total employer share</td><td class="num">${amount(employerTotal)}</td></tr></tfoot>
        </table>
      </div>

      ${p.adjustments.remarks ? html`<section class="ps-remarks"><h3>Remarks</h3><p>${p.adjustments.remarks}</p></section>` : ''}

      <footer class="ps-foot">
        <div class="ps-sign"><span></span>Received by (signature over printed name)</div>
        <div class="ps-sign"><span></span>Date received</div>
        <p>This payslip is system-generated by ${settings.companyName} and is valid without a signature. Employer contributions are shown for information and are not deducted from pay. Report discrepancies to HR within 5 working days of the pay date.</p>
      </footer>
    </article>`;
}

export async function payslipView(el, { id, employeeId }) {
  const run = await api.get(`/api/payroll-runs/${id}`);
  const slips = employeeId === 'all' ? run.payslips : run.payslips.filter((p) => p.employeeId === employeeId);
  if (!slips.length) throw new Error('Payslip not found.');

  mount(el, html`
    <header class="page-head no-print">
      <div><a class="back" href="#/payroll/${run.id}">← ${periodLabel(run)}</a><h1>${slips.length > 1 ? `Payslips (${slips.length})` : 'Payslip'}</h1></div>
      <div class="actions"><button class="btn primary" id="print">Print / Save as PDF</button></div>
    </header>
    <div class="payslips">${slips.map((p) => payslipCard(run, p, ctx.settings))}</div>`);
  el.querySelector('#print').addEventListener('click', () => window.print());
}
