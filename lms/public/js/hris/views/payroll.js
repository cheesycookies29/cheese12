// Payroll runs, the payroll register and payslips. From the Lancaster ERP
// (public/js/views/payroll.js there); runs are per campus.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { currentPeriod } from '/shared/calc.js';
import { html, mount, money, amount, fmtDate, fmtMinutes, badge, toast, modal, confirmDialog, downloadFile, toCsv, today } from '../../ui.js';
import { hr, can, clickableRows } from '../state.js';
import { BONUS_KINDS } from '/shared/gov-pay.js';
import { govRegister, govNotices, govPayslipCard, generalPayroll, remittancesView, downloadRemittance, GOV_REGISTER_CSV, runTitle, isBonusRun, financeView } from './payroll-gov.js';

const isGov = () => hr.settings.payrollSystem === 'government';

const statusBadge = (s) => (s === 'finalized' ? badge('Finalized', 'green') : badge('Draft', 'amber'));
const periodLabel = (r) => (isBonusRun(r) ? runTitle(r) : `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}`);

export async function payrollListView(el) {
  const runs = await api.get('/api/hris/payroll-runs');

  mount(el, html`
    ${pageHead('Payroll', isGov()
      ? `${hr.settings.payFrequency === 'monthly' ? 'Monthly' : 'Semi-monthly'} government payroll for ${ctx.info.campusName || 'this campus'}: salary grades, PERA and RATA, GSIS, PhilHealth, Pag-IBIG, BIR withholding tax and loans; and the mid-year and year-end bonuses, cash gift, PEI and clothing allowance.`
      : `${hr.settings.payFrequency === 'monthly' ? 'Monthly' : 'Semi-monthly'} payroll for ${ctx.info.campusName || 'this campus'}, with SSS, PhilHealth, Pag-IBIG and BIR withholding tax.`, can('payroll.edit') ? html`<button class="btn primary" id="new-run">${icon('plus', 16)} New payroll run</button>` : '')}
    <section class="card">
      ${runs.length
        ? html`<table class="table clickable">
            <thead><tr><th>Pay period</th><th>Pay date</th><th class="num">Employees</th><th class="num">Gross pay</th><th class="num">Deductions</th><th class="num">Net pay</th><th>Status</th></tr></thead>
            <tbody>${runs.map((r) => html`<tr data-href="#/payroll/${r.id}">
              <td><strong>${periodLabel(r)}</strong>${isBonusRun(r) ? html` ${badge('Bonus', 'blue')}` : ''}</td><td>${fmtDate(r.payDate)}</td>
              <td class="num">${r.totals.employees}</td><td class="num">${money(r.totals.grossPay)}</td>
              <td class="num">${money(r.totals.totalDeductions)}</td><td class="num"><strong>${money(r.totals.netPay)}</strong></td>
              <td>${statusBadge(r.status)}</td></tr>`)}</tbody>
          </table>`
        : html`<div class="empty"><h2>No payroll runs yet</h2><p>Create a run for a pay period. Pay is computed from each employee's rate and their attendance records at this campus.</p></div>`}
    </section>`);

  clickableRows(el);

  el.querySelector('#new-run')?.addEventListener('click', () => {
    const p = currentPeriod(today(), hr.settings.payFrequency);
    const year = Number(today().slice(0, 4));
    const bonusDate = { 'mid-year': `${year}-05-15`, 'year-end': `${year}-11-15`, pei: `${year}-12-15`, clothing: today() };
    const { form } = modal({
      title: 'New payroll run',
      submitLabel: 'Compute payroll',
      body: html`
        ${isGov() ? html`<label class="field"><span>Kind</span><select name="kind">
          <option value="regular">Regular payroll (salary, PERA, RATA)</option>
          ${Object.entries(BONUS_KINDS).map(([k, b]) => html`<option value="${k}">${b.name}</option>`)}
        </select></label>
        <div class="grid two bonus-only" hidden>
          <label class="field"><span>Year</span><input type="number" name="year" value="${year}" min="2000" max="2100" /></label>
          <label class="field"><span>Pay date</span><input type="date" name="bonusPayDate" value="${bonusDate['year-end']}" /><span class="hint">Mid-year bonus not before 15 May; year-end bonus and cash gift not before 15 November.</span></label>
        </div>` : ''}
        <div class="grid two regular-only">
          <label class="field"><span>Period start</span><input type="date" name="periodStart" value="${p.start}" required /></label>
          <label class="field"><span>Period end</span><input type="date" name="periodEnd" value="${p.end}" required /></label>
          <label class="field"><span>Pay date</span><input type="date" name="payDate" value="${p.end}" required /></label>
        </div>
        <p class="muted small regular-only">All active employees at ${ctx.info.campusName || 'this campus'} are included. Scheduled work days without an attendance record count as absences, so record leave before running payroll, and run it once the period has ended.</p>
        <p class="muted small bonus-only" hidden>All active employees are listed; each one's eligibility (months of service by the cut-off date) is worked out, with prorated cash gift and PEI for less than four months.</p>`,
      onSubmit: async (f) => {
        const body = Object.fromEntries(new FormData(f));
        if (body.kind && body.kind !== 'regular') body.payDate = body.bonusPayDate;
        const run = await api.post('/api/hris/payroll-runs', body);
        toast('Payroll computed.');
        location.hash = `#/payroll/${run.id}`;
      },
    });
    const kindSel = form.querySelector('[name=kind]');
    kindSel?.addEventListener('change', () => {
      const bonus = kindSel.value !== 'regular';
      form.querySelectorAll('.bonus-only').forEach((n) => (n.hidden = !bonus));
      form.querySelectorAll('.regular-only').forEach((n) => (n.hidden = bonus));
      form.querySelectorAll('.regular-only input').forEach((n) => (n.required = !bonus));
      if (bonus) form.bonusPayDate.value = bonusDate[kindSel.value];
    });
    const start = form.querySelector('[name=periodStart]');
    start.addEventListener('change', () => {
      const np = currentPeriod(start.value, hr.settings.payFrequency);
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
  let run = await api.get(`/api/hris/payroll-runs/${id}`);
  // Pending leave / remote-work requests inside the period change pay once decided.
  const pendingRequests = can('leave.manage')
    ? (await api.get('/api/hris/requests?status=pending')).filter((r) => r.startDate <= run.periodEnd && r.endDate >= run.periodStart)
    : [];

  let tab = 'register';
  let fin = null; // the run's documents in Finance (loaded when the tab opens)
  function render() {
    if (run.system === 'government') return renderGov();
    const draft = run.status === 'draft';
    const editable = draft && can('payroll.edit');
    const open = run.payslips.filter((p) => p.attendance.openEntries).length;
    const absent = run.payslips.reduce((a, p) => a + p.attendance.absentDays, 0);
    const pendingOt = run.payslips.filter((p) => p.attendance.unapprovedOvertimeMinutes).length;
    const t = run.totals;

    mount(el, html`
      ${pageHead(html`${periodLabel(run)} ${statusBadge(run.status)}`,
        `Pay date ${fmtDate(run.payDate)} · ${run.payFrequency} · ${draft ? 'Draft: recompute after changing attendance or employee data.' : `Finalized ${new Date(run.finalizedAt).toLocaleString('en-PH')}${run.finalizedBy ? ` by ${run.finalizedBy}` : ''}`}`,
        html`<button class="btn" id="export">${icon('download', 16)} Export register</button>
          <a class="btn" href="#/payroll/${run.id}/payslip/all">Print payslips</a>
          ${editable ? html`<button class="btn" id="recompute">Recompute</button><button class="btn gold" id="finalize">Finalize</button>` : ''}`,
        ['/payroll', 'Payroll'])}
      <div class="stats">
        <div class="card"><small>Employees</small><strong>${t.employees}</strong></div>
        <div class="card"><small>Gross pay</small><strong>${money(t.grossPay)}</strong></div>
        <div class="card"><small>Total deductions</small><strong>${money(t.totalDeductions)}</strong></div>
        <div class="card accent"><small>Net pay</small><strong>${money(t.netPay)}</strong></div>
        <div class="card"><small>Employer contributions</small><strong>${money(t.employerContributions)}</strong></div>
      </div>
      ${draft && (open || absent || pendingOt || pendingRequests.length)
        ? html`<div class="notice stack-notice">
            ${open ? html`<p><strong>${open}</strong> employee(s) have open attendance records (no clock-out). Those days are not paid until fixed in <a href="#/dtr?from=${run.periodStart}&to=${run.periodEnd}">Attendance</a>.</p>` : ''}
            ${absent ? html`<p><strong>${absent}</strong> scheduled work day(s) have no attendance record and were counted as absences.</p>` : ''}
            ${pendingOt ? html`<p><strong>${pendingOt}</strong> employee(s) have overtime awaiting approval; it is not paid until approved.</p>` : ''}
            ${pendingRequests.length ? html`<p><strong>${pendingRequests.length}</strong> leave or remote-work request(s) in this period are still pending. <a href="#/leave">Review them</a>, then recompute.</p>` : ''}
          </div>`
        : ''}
      <section class="card scroll-x">
        <table class="table register no-stack">
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
      ${can('payroll.edit') ? html`<div class="danger-zone"><button class="btn danger ghost" id="delete">${icon('trash', 16)} Delete payroll run</button></div>` : ''}`);
    bind();
  }

  // Government payroll: register, remittances and the General Payroll (GAM Appendix 33).
  function renderGov() {
    const draft = run.status === 'draft';
    const editable = draft && can('payroll.edit');
    const bonus = isBonusRun(run);
    const t = run.totals;
    const open = bonus ? 0 : run.payslips.filter((p) => p.attendance.openEntries).length;
    const absent = bonus ? 0 : run.payslips.reduce((a, p) => a + p.attendance.absentDays, 0);
    const notes = [
      open ? html`<p><strong>${open}</strong> employee(s) have open attendance records (no clock-out). Those days are not paid until fixed in <a href="#/dtr?from=${run.periodStart}&to=${run.periodEnd}">Attendance</a>.</p>` : '',
      absent ? html`<p><strong>${absent}</strong> scheduled work day(s) have no attendance record and were counted as absences without pay.</p>` : '',
      !bonus && pendingRequests.length ? html`<p><strong>${pendingRequests.length}</strong> leave or remote-work request(s) in this period are still pending. <a href="#/leave">Review them</a>, then recompute.</p>` : '',
      ...govNotices(run),
    ].filter(Boolean);
    mount(el, html`
      ${pageHead(html`${runTitle(run)} ${statusBadge(run.status)}`,
        `${bonus ? '' : `${run.payFrequency} · `}pay date ${fmtDate(run.payDate)} · ${draft ? 'Draft: recompute after changing attendance, loans or employee data.' : `Finalized ${new Date(run.finalizedAt).toLocaleString('en-PH')}${run.finalizedBy ? ` by ${run.finalizedBy}` : ''}`}`,
        html`<button class="btn" id="export">${icon('download', 16)} Export register</button>
          <a class="btn" href="#/payroll/${run.id}/payslip/all">Print payslips</a>
          ${editable ? html`<button class="btn" id="recompute">Recompute</button><button class="btn gold" id="finalize">Finalize</button>` : ''}`,
        ['/payroll', 'Payroll'])}
      <div class="stats">
        <div class="card"><small>Employees</small><strong>${run.payslips.filter((p) => p.grossPay).length}</strong>${bonus ? html`<span class="muted small">of ${t.employees} listed</span>` : ''}</div>
        <div class="card"><small>Gross</small><strong>${money(t.grossPay)}</strong></div>
        <div class="card"><small>Deductions</small><strong>${money(t.totalDeductions)}</strong></div>
        <div class="card accent"><small>Net pay</small><strong>${money(t.netPay)}</strong></div>
        ${bonus ? '' : html`<div class="card"><small>Government share</small><strong>${money(t.employerContributions)}</strong><span class="muted small">GSIS, ECC, PhilHealth, Pag-IBIG</span></div>`}
      </div>
      ${draft && notes.length ? html`<div class="notice stack-notice">${notes}</div>` : ''}
      <nav class="tabs no-print">${[['register', 'Register'], ['remit', 'Remittances'], ['gp', 'General Payroll'], ['finance', 'Finance']].map(([k, l]) => html`<a href="javascript:void 0" role="button" data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</a>`)}</nav>
      ${tab === 'register' ? html`<section class="card scroll-x">${govRegister(run, { editable })}</section>` : ''}
      ${tab === 'remit' ? html`<section class="card">${remittancesView(run)}</section>` : ''}
      ${tab === 'finance' ? html`<section class="card" id="fin-box">${fin ? financeView(run, fin, { canEdit: can('payroll.edit') }) : html`<p class="muted">Loading…</p>`}</section>` : ''}
      ${tab === 'gp' ? html`<div class="actions end no-print"><button class="btn primary" id="print-gp">${icon('file', 16)} Print General Payroll</button></div><section class="card">${generalPayroll(run)}</section>` : ''}
      ${can('payroll.edit') ? html`<div class="danger-zone no-print"><button class="btn danger ghost" id="delete">${icon('trash', 16)} Delete payroll run</button></div>` : ''}`);
    el.querySelectorAll('[data-tab]').forEach((a) => a.addEventListener('click', async (e) => {
      e.preventDefault();
      tab = a.dataset.tab;
      render();
      if (tab === 'finance') {
        try {
          fin = await api.get(`/api/hris/payroll-runs/${id}/finance`);
        } catch (err) {
          fin = null;
          toast(err.message, 'error');
        }
        render();
      }
    }));
    // Finance steps: each calls People, which prepares the document in Finance.
    const finStep = async (path, body, done) => {
      try {
        fin = { ...fin, ...(await api.post(`/api/hris/payroll-runs/${id}/finance/${path}`, body)) };
        fin = await api.get(`/api/hris/payroll-runs/${id}/finance`);
        toast(done);
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    el.querySelector('#fin-ors')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      finStep('ors', { allotments: { PS: fd.get('PS'), MOOE: fd.get('MOOE') } }, 'Obligation request sent to the budget office.');
    });
    el.querySelector('#fin-dv')?.addEventListener('submit', (e) => {
      e.preventDefault();
      finStep('dv', { mode: new FormData(e.target).get('mode') }, 'Voucher sent to the accountant (Box C).');
    });
    el.querySelector('#fin-remit')?.addEventListener('click', () => finStep('remittances', {}, 'Remittance vouchers sent to the accountant.'));
    el.querySelector('#print-gp')?.addEventListener('click', () => window.print());
    el.querySelectorAll('[data-remit]').forEach((b) => b.addEventListener('click', () => downloadRemittance(run, b.dataset.remit)));
    bind();
  }

  function bind() {
    el.querySelector('#export').addEventListener('click', () => {
      const cols = run.system === 'government' ? GOV_REGISTER_CSV : REGISTER_COLUMNS;
      const data = [cols.map((c) => c[0]), ...run.payslips.map((p) => cols.map(([, f]) => f(p)))];
      downloadFile(isBonusRun(run) ? `${run.kind}-${run.year}.csv` : `payroll-register-${run.periodStart}-to-${run.periodEnd}.csv`, toCsv(data));
    });
    el.querySelector('#recompute')?.addEventListener('click', async () => {
      run = await api.post(`/api/hris/payroll-runs/${id}/recompute`);
      toast('Payroll recomputed from the latest data.');
      render();
    });
    el.querySelector('#finalize')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Finalize this payroll run? It will be recomputed one last time and then locked.', { confirmLabel: 'Finalize', danger: false }))) return;
      run = await api.post(`/api/hris/payroll-runs/${id}/finalize`);
      toast('Payroll finalized.');
      render();
    });
    el.querySelector('#delete')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete the payroll run for ${periodLabel(run)}? This cannot be undone.`))) return;
      await api.del(`/api/hris/payroll-runs/${id}`);
      toast('Payroll run deleted.');
      location.hash = '#/payroll';
    });
    el.querySelectorAll('[data-adjust]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = run.payslips.find((x) => x.employeeId === b.dataset.adjust);
        modal({
          title: `Adjust pay: ${p.employee.name}`,
          body: html`<div class="grid two">
            ${run.system === 'government' ? html`<label class="field check span-2"><input type="checkbox" name="excluded" ${p.adjustments.excluded ? 'checked' : ''} /> <span>Leave out of this run${isBonusRun(run) ? ' (e.g. a performance rating below Satisfactory, or under investigation)' : ' (e.g. on leave without pay, paid elsewhere)'}; give the reason in the remarks</span></label>` : ''}
            <label class="field"><span>Other earnings (₱, taxable)</span><input type="number" min="0" step="0.01" name="otherEarnings" value="${p.adjustments.otherEarnings || ''}" /><small class="muted">Bonus, commission, holiday pay, etc.</small></label>
            <label class="field"><span>Other deductions (₱)</span><input type="number" min="0" step="0.01" name="otherDeductions" value="${p.adjustments.otherDeductions || ''}" /><small class="muted">Loans, cash advances, etc.</small></label>
            <label class="field span-2"><span>Remarks (shown on payslip)</span><input name="remarks" value="${p.adjustments.remarks}" /></label>
          </div>`,
          onSubmit: async (f) => {
            run = await api.put(`/api/hris/payroll-runs/${id}/payslips/${p.employeeId}`, Object.fromEntries(new FormData(f)));
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
  if (p.system === 'government') return govPayslipCard(run, p, settings, { slipNumber, pesosInWords, periodLabel });
  const a = p.attendance;
  // Amounts taken off are shown in parentheses, as on a statement.
  const row = (label, value, { sub = false, note = '' } = {}) => html`<tr class="${sub ? 'sub' : ''}"><td>${label}${note ? html`<small>${note}</small>` : ''}</td><td class="num">${value < 0 ? `(${amount(-value)})` : amount(value)}</td></tr>`;
  const optional = (label, value, opts) => (value ? row(label, value, opts) : '');
  const field = (label, value) => html`<div><dt>${label}</dt><dd>${value || '—'}</dd></div>`;
  const employerTotal = p.employerShare.sss + p.employerShare.sssEc + p.employerShare.philhealth + p.employerShare.pagibig;
  return html`
    <article class="payslip ${run.status === 'draft' ? 'is-draft' : ''}">
      ${run.status === 'draft' ? html`<div class="ps-watermark" aria-hidden="true" data-text="DRAFT"></div>` : ''}
      <header class="ps-head">
        <div class="ps-company">
          ${ctx.info.branding?.logo ? html`<img src="${ctx.info.branding.logo}" alt="" />` : ''}
          <div><strong>${settings.employerName}</strong>${run.campusName ? html`<span>${run.campusName}</span>` : ''}${settings.employerAddress ? html`<span>${settings.employerAddress}</span>` : ''}${settings.employerTin ? html`<span>TIN ${settings.employerTin}</span>` : ''}</div>
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
        <p>This payslip is system-generated by ${settings.employerName} and is valid without a signature. Employer contributions are shown for information and are not deducted from pay. Report discrepancies to HR within 5 working days of the pay date.</p>
      </footer>
    </article>`;
}

export async function payslipView(el, { id, employeeId }) {
  const run = await api.get(`/api/hris/payroll-runs/${id}`);
  const slips = employeeId === 'all' ? run.payslips : run.payslips.filter((p) => p.employeeId === employeeId);
  if (!slips.length) throw new Error('Payslip not found.');

  mount(el, html`
    <div class="no-print">${pageHead(slips.length > 1 ? `Payslips (${slips.length})` : 'Payslip', '', html`<button class="btn primary" id="print">${icon('download', 16)} Print / Save as PDF</button>`, [['/payroll', 'Payroll'], [`/payroll/${run.id}`, periodLabel(run)]])}</div>
    <div class="payslips">${slips.map((p) => payslipCard(run, p, hr.settings))}</div>`);
  el.querySelector('#print').addEventListener('click', () => window.print());
}
