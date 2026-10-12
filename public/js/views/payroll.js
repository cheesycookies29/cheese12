import { api } from '../api.js';
import { ctx } from '../state.js';
import { currentPeriod } from '/shared/calc.js';
import { html, mount, money, amount, fmtDate, fmtMinutes, badge, toast, modal, confirmDialog, downloadFile, toCsv, today } from '../ui.js';

const statusBadge = (s) => (s === 'finalized' ? badge('Finalized', 'green') : badge('Draft', 'amber'));
const periodLabel = (r) => `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}`;

export async function payrollListView(el) {
  const runs = await api.get('/api/payroll-runs');

  mount(el, html`
    <header class="page-head">
      <div><h1>Payroll</h1><p class="muted">${ctx.settings.payFrequency === 'monthly' ? 'Monthly' : 'Semi-monthly'} payroll with SSS, PhilHealth, Pag-IBIG and BIR withholding tax.</p></div>
      <div class="actions"><button class="btn primary" id="new-run">+ New payroll run</button></div>
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

  el.querySelector('#new-run').addEventListener('click', () => {
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

  function render() {
    const draft = run.status === 'draft';
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
          ${draft ? html`<button class="btn" id="recompute">Recompute</button><button class="btn primary" id="finalize">Finalize</button>` : ''}
        </div>
      </header>
      <div class="stats">
        <div class="card"><small>Employees</small><strong>${t.employees}</strong></div>
        <div class="card"><small>Gross pay</small><strong>${money(t.grossPay)}</strong></div>
        <div class="card"><small>Total deductions</small><strong>${money(t.totalDeductions)}</strong></div>
        <div class="card accent"><small>Net pay</small><strong>${money(t.netPay)}</strong></div>
        <div class="card"><small>Employer contributions</small><strong>${money(t.employerContributions)}</strong></div>
      </div>
      ${draft && (open || absent || pendingOt)
        ? html`<div class="notice">
            ${open ? html`<p><strong>${open}</strong> employee(s) have open attendance records (no clock-out). Those days are not paid until fixed in <a href="#/dtr?from=${run.periodStart}&to=${run.periodEnd}">Attendance</a>.</p>` : ''}
            ${absent ? html`<p><strong>${absent}</strong> scheduled work day(s) have no attendance record and were counted as absences.</p>` : ''}
            ${pendingOt ? html`<p><strong>${pendingOt}</strong> employee(s) have overtime awaiting approval; it is not paid until approved.</p>` : ''}
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
            <td class="row-actions">${draft ? html`<button class="link" data-adjust="${p.employeeId}">Adjust</button>` : ''}<a class="link" href="#/payroll/${run.id}/payslip/${p.employeeId}">Payslip</a></td>
          </tr>`)}</tbody>
          <tfoot><tr><td><strong>Total</strong></td><td colspan="7"></td><td class="num"><strong>${amount(t.grossPay)}</strong></td>
            ${['sss', 'philhealth', 'pagibig', 'withholdingTax', 'otherDeductions'].map((k) => html`<td class="num">${amount(run.payslips.reduce((a, p) => a + p.deductions[k], 0))}</td>`)}
            <td class="num">${amount(run.payslips.reduce((a, p) => a + p.allowance, 0))}</td><td class="num"><strong>${amount(t.netPay)}</strong></td><td></td></tr></tfoot>
        </table>
      </section>
      <div class="danger-zone"><button class="btn danger ghost" id="delete">Delete payroll run</button></div>`);
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
    el.querySelector('#delete').addEventListener('click', async () => {
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

function payslipCard(run, p, settings) {
  const line = (label, value, cls = '') => (value ? html`<tr class="${cls}"><td>${label}</td><td class="num">${amount(value)}</td></tr>` : '');
  const a = p.attendance;
  return html`
    <article class="payslip">
      <header>
        <div><h2>${settings.companyName}</h2><p>${settings.companyAddress}</p>${settings.companyTin ? html`<p>TIN ${settings.companyTin}</p>` : ''}</div>
        <div class="right"><h3>PAYSLIP</h3><p>${periodLabel(run)}</p><p>Pay date: ${fmtDate(run.payDate)}</p>${run.status === 'draft' ? html`<p class="draft-mark">DRAFT</p>` : ''}</div>
      </header>
      <dl class="slip-info">
        <div><dt>Employee</dt><dd>${p.employee.name}</dd></div>
        <div><dt>Employee no.</dt><dd>${p.employee.employeeNo}</dd></div>
        <div><dt>Position</dt><dd>${p.employee.position || '—'}</dd></div>
        <div><dt>Department</dt><dd>${p.employee.department || '—'}</dd></div>
        <div><dt>Rate</dt><dd>${money(p.employee.rate)} / ${p.employee.payType === 'daily' ? 'day' : 'month'}</dd></div>
        <div><dt>TIN</dt><dd>${p.employee.tin || '—'}</dd></div>
      </dl>
      <div class="slip-cols">
        <table>
          <thead><tr><th>Earnings</th><th class="num">Amount</th></tr></thead>
          <tbody>
            <tr><td>Basic pay</td><td class="num">${amount(p.earnings.basePay)}</td></tr>
            ${line(`  less absences (${a.absentDays} day/s)`, -p.earnings.absenceDeduction, 'sub')}
            ${line(`  less late/undertime (${fmtMinutes(a.lateMinutes + a.undertimeMinutes)})`, -p.earnings.tardinessDeduction, 'sub')}
            ${line(`Overtime (${fmtMinutes(a.overtimeMinutes)})`, p.earnings.overtimePay)}
            ${line(`Rest day work (${fmtMinutes(a.restDayMinutes)})`, p.earnings.restDayPay)}
            ${line('Other earnings', p.earnings.otherEarnings)}
          </tbody>
          <tfoot><tr><td>Gross pay</td><td class="num">${amount(p.grossPay)}</td></tr>
          ${p.allowance ? html`<tr><td>Allowance (non-taxable)</td><td class="num">${amount(p.allowance)}</td></tr>` : ''}</tfoot>
        </table>
        <table>
          <thead><tr><th>Deductions</th><th class="num">Amount</th></tr></thead>
          <tbody>
            <tr><td>SSS</td><td class="num">${amount(p.deductions.sss)}</td></tr>
            <tr><td>PhilHealth</td><td class="num">${amount(p.deductions.philhealth)}</td></tr>
            <tr><td>Pag-IBIG</td><td class="num">${amount(p.deductions.pagibig)}</td></tr>
            <tr><td>Withholding tax</td><td class="num">${amount(p.deductions.withholdingTax)}</td></tr>
            ${line('Other deductions', p.deductions.otherDeductions)}
          </tbody>
          <tfoot><tr><td>Total deductions</td><td class="num">${amount(p.totalDeductions)}</td></tr></tfoot>
        </table>
      </div>
      <div class="net"><span>NET PAY</span><strong>${money(p.netPay)}</strong></div>
      <p class="slip-foot">Days paid: ${a.daysPresent + a.leaveDays} of ${a.scheduledDays} (leave: ${a.leaveDays}) · Taxable income: ${amount(p.taxableIncome)}
        · Employer share: SSS ${amount(p.employerShare.sss + p.employerShare.sssEc)}, PhilHealth ${amount(p.employerShare.philhealth)}, Pag-IBIG ${amount(p.employerShare.pagibig)}
        ${p.employee.bankAccount ? html` · Credited to ${p.employee.bankName} ${p.employee.bankAccount}` : ''}</p>
      ${p.adjustments.remarks ? html`<p class="slip-foot"><strong>Remarks:</strong> ${p.adjustments.remarks}</p>` : ''}
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
