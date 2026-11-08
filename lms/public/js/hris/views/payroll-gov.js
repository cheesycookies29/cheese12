// Government payroll screens: the register (regular and bonus runs), the payslip, the
// General Payroll (COA GAM Appendix 33) and the remittance summary (GSIS, PhilHealth,
// Pag-IBIG, BIR, loans). The rules are in shared/gov-pay.js.
import { ctx } from '../../shell.js';
import { html, money, amount, fmtDate, fmtMinutes, badge, downloadFile, toCsv } from '../../ui.js';
import { BONUS_KINDS } from '/shared/gov-pay.js';

export const runTitle = (r) => r.name || `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}`;
export const isBonusRun = (r) => r.kind && r.kind !== 'regular';
const sg = (p) => (p.employee.salaryGrade ? `SG ${p.employee.salaryGrade}-${p.employee.step}` : p.employee.appointment || '');
const loans = (p) => (p.deductions.items || []).reduce((a, d) => a + d.amount, 0);
const rata = (p) => (p.earnings.representation || 0) + (p.earnings.transportation || 0);
const sumOf = (run, f) => run.payslips.reduce((a, p) => a + (Number(f(p)) || 0), 0);
const er = (p) => p.employerShare || {};

// ----- Register -----
export function govRegister(run, { editable }) {
  if (isBonusRun(run)) {
    const codes = [...new Set(run.payslips.flatMap((p) => p.earnings.items.map((i) => i.code)))];
    const label = { MYB: 'Mid-year bonus', YEB: 'Year-end bonus', CG: 'Cash gift', PEI: 'PEI', CLOTH: 'Clothing', OTHER: 'Other' };
    return html`<table class="table register no-stack">
      <thead><tr><th>Employee</th><th>SG</th><th class="num">Months</th>${codes.map((c) => html`<th class="num">${label[c] || c}</th>`)}<th class="num">Gross</th><th class="num">Tax</th><th class="num">Net</th><th>Note</th><th></th></tr></thead>
      <tbody>${run.payslips.map((p) => html`<tr class="${p.grossPay ? '' : 'muted-row'}">
        <td><strong>${p.employee.name}</strong><small>${p.employee.employeeNo}</small></td><td>${sg(p)}</td><td class="num">${p.eligibility.months.toFixed(1)}</td>
        ${codes.map((c) => html`<td class="num">${amount(p.earnings.items.filter((i) => i.code === c).reduce((a, i) => a + i.amount, 0))}</td>`)}
        <td class="num"><strong>${amount(p.grossPay)}</strong></td><td class="num">${amount(p.deductions.withholdingTax)}</td><td class="num"><strong>${amount(p.netPay)}</strong></td>
        <td class="small">${p.eligibility.note}</td>
        <td class="row-actions">${editable ? html`<button class="link" data-adjust="${p.employeeId}">Adjust</button>` : ''}<a class="link" href="#/payroll/${run.id}/payslip/${p.employeeId}">Payslip</a></td></tr>`)}</tbody>
      <tfoot><tr><td colspan="3"><strong>Total</strong></td>${codes.map((c) => html`<td class="num">${amount(sumOf(run, (p) => p.earnings.items.filter((i) => i.code === c).reduce((a, i) => a + i.amount, 0)))}</td>`)}
        <td class="num"><strong>${amount(run.totals.grossPay)}</strong></td><td class="num">${amount(sumOf(run, (p) => p.deductions.withholdingTax))}</td><td class="num"><strong>${amount(run.totals.netPay)}</strong></td><td colspan="2"></td></tr></tfoot>
    </table>`;
  }
  return html`<table class="table register no-stack">
    <thead><tr>
      <th>Employee</th><th>SG</th><th class="num">Days</th><th class="num">Absent</th><th class="num">Late/UT</th>
      <th class="num">Basic</th><th class="num">PERA</th><th class="num">RATA</th><th class="num">Other</th><th class="num">Gross</th>
      <th class="num">GSIS</th><th class="num">PhilHealth</th><th class="num">Pag-IBIG</th><th class="num">Tax</th><th class="num">Loans &amp; others</th>
      <th class="num">Net pay</th><th></th>
    </tr></thead>
    <tbody>${run.payslips.map((p) => html`<tr class="${p.adjustments.excluded ? 'muted-row' : ''}">
      <td><strong>${p.employee.name}</strong><small>${p.employee.employeeNo}${p.employee.position ? ` · ${p.employee.position}` : ''}</small></td>
      <td class="nowrap">${sg(p)}</td>
      <td class="num">${p.attendance.daysPresent + p.attendance.leaveDays}/${p.attendance.scheduledDays}</td>
      <td class="num ${p.attendance.absentDays ? 'warn' : ''}">${p.attendance.absentDays || '—'}</td>
      <td class="num">${p.leave.tardinessMinutes ? html`${fmtMinutes(p.leave.tardinessMinutes)}${p.leave.chargedToLeaveDays ? html`<small>VL ${p.leave.chargedToLeaveDays}</small>` : ''}` : '—'}</td>
      <td class="num">${amount(p.earnings.basicPay)}</td>
      <td class="num">${amount(p.earnings.pera)}</td>
      <td class="num">${amount(rata(p))}</td>
      <td class="num">${amount(p.earnings.allowance + p.earnings.overtimePay + p.earnings.otherEarnings)}</td>
      <td class="num"><strong>${amount(p.grossPay)}</strong></td>
      <td class="num">${amount(p.deductions.gsis)}</td>
      <td class="num">${amount(p.deductions.philhealth)}</td>
      <td class="num">${amount(p.deductions.pagibig)}</td>
      <td class="num">${amount(p.deductions.withholdingTax + p.deductions.percentageTax)}</td>
      <td class="num">${amount(loans(p) + p.deductions.otherDeductions)}${p.skippedDeductions.length ? html`<small class="warn">${p.skippedDeductions.length} held back</small>` : ''}</td>
      <td class="num"><strong>${amount(p.netPay)}</strong></td>
      <td class="row-actions">${editable ? html`<button class="link" data-adjust="${p.employeeId}">Adjust</button>` : ''}<a class="link" href="#/payroll/${run.id}/payslip/${p.employeeId}">Payslip</a></td>
    </tr>`)}</tbody>
    <tfoot><tr><td colspan="5"><strong>Total</strong></td>
      ${[(p) => p.earnings.basicPay, (p) => p.earnings.pera, rata, (p) => p.earnings.allowance + p.earnings.overtimePay + p.earnings.otherEarnings].map((f) => html`<td class="num">${amount(sumOf(run, f))}</td>`)}
      <td class="num"><strong>${amount(run.totals.grossPay)}</strong></td>
      ${[(p) => p.deductions.gsis, (p) => p.deductions.philhealth, (p) => p.deductions.pagibig, (p) => p.deductions.withholdingTax + p.deductions.percentageTax, (p) => loans(p) + p.deductions.otherDeductions].map((f) => html`<td class="num">${amount(sumOf(run, f))}</td>`)}
      <td class="num"><strong>${amount(run.totals.netPay)}</strong></td><td></td></tr></tfoot>
  </table>`;
}

// Notices for a draft regular run: loans held back by the P5,000 floor, leave charged.
export function govNotices(run) {
  if (isBonusRun(run)) {
    const out = run.payslips.filter((p) => !p.grossPay).length;
    return out ? [html`<p><strong>${out}</strong> employee(s) get nothing in this run (see the notes): not enough service by the cut-off, not in service, or a job order.</p>`] : [];
  }
  const held = run.payslips.filter((p) => p.skippedDeductions.length);
  const vl = run.payslips.filter((p) => p.leave.chargedToLeaveDays);
  return [
    held.length ? html`<p><strong>${held.length}</strong> employee(s) have loans or deductions held back so that net pay stays at the minimum: ${held.map((p) => `${p.employee.name} (${p.skippedDeductions.map((d) => d.name).join(', ')})`).join('; ')}.</p>` : '',
    vl.length ? html`<p>Tardiness and undertime of <strong>${vl.length}</strong> employee(s) is charged to vacation leave (${vl.reduce((a, p) => a + p.leave.chargedToLeaveDays, 0).toFixed(3)} days in all) when the run is finalized.</p>` : '',
  ].filter(Boolean);
}

export const GOV_REGISTER_CSV = [
  ['Employee No', (p) => p.employee.employeeNo], ['Employee', (p) => p.employee.name], ['Position', (p) => p.employee.position], ['SG-Step', sg], ['Item No', (p) => p.employee.itemNo],
  ['Monthly Salary', (p) => p.rates?.monthly ?? p.employee.rate], ['Days Present', (p) => p.attendance?.daysPresent ?? ''], ['Absences', (p) => p.attendance?.absentDays ?? ''],
  ['Late+UT (min)', (p) => p.leave?.tardinessMinutes ?? ''], ['Charged to VL (days)', (p) => p.leave?.chargedToLeaveDays ?? ''],
  ['Basic Salary', (p) => p.earnings.basicPay ?? ''], ['PERA', (p) => p.earnings.pera ?? ''], ['Representation', (p) => p.earnings.representation ?? ''], ['Transportation', (p) => p.earnings.transportation ?? ''],
  ['Other Allowance', (p) => p.earnings.allowance ?? ''], ['Overtime', (p) => p.earnings.overtimePay ?? ''], ['Other Earnings', (p) => p.earnings.otherEarnings ?? ''],
  ['Bonus', (p) => (p.earnings.items ? p.earnings.items.reduce((a, i) => a + i.amount, 0) : '')], ['Gross', (p) => p.grossPay],
  ['GSIS PS', (p) => p.deductions.gsis ?? ''], ['PhilHealth', (p) => p.deductions.philhealth ?? ''], ['Pag-IBIG', (p) => p.deductions.pagibig ?? ''],
  ['Withholding Tax', (p) => p.deductions.withholdingTax], ['Percentage Tax', (p) => p.deductions.percentageTax ?? ''], ['Loans and Others', (p) => loans(p) + (p.deductions.otherDeductions || 0)],
  ['Total Deductions', (p) => p.totalDeductions], ['Net Pay', (p) => p.netPay],
  ['GSIS GS', (p) => er(p).gsis ?? ''], ['ECC', (p) => er(p).ecc ?? ''], ['PhilHealth ER', (p) => er(p).philhealth ?? ''], ['Pag-IBIG ER', (p) => er(p).pagibig ?? ''],
  ['Bank', (p) => p.employee.bankName], ['Account No', (p) => p.employee.bankAccount],
];

// ----- Remittances -----
// Per agency: employee and government shares and loans, with a per-employee list for the remittance file.
export function remittanceGroups(run) {
  const groups = new Map();
  const add = (agency, line, p, amt) => {
    if (!amt) return;
    if (!groups.has(agency)) groups.set(agency, { agency, lines: new Map(), people: new Map() });
    const g = groups.get(agency);
    g.lines.set(line, Math.round(((g.lines.get(line) || 0) + amt) * 100) / 100);
    const person = g.people.get(p.employeeId) || { name: p.employee.name, no: p.employee.employeeNo, id: { GSIS: p.employee.gsisNo, PhilHealth: p.employee.philhealthNo, 'Pag-IBIG': p.employee.pagibigNo, BIR: p.employee.tin }[agency] || '', lines: {} };
    person.lines[line] = Math.round(((person.lines[line] || 0) + amt) * 100) / 100;
    g.people.set(p.employeeId, person);
  };
  for (const p of run.payslips) {
    add('GSIS', 'Personal share (9%)', p, p.deductions.gsis);
    add('GSIS', 'Government share (12%)', p, er(p).gsis);
    add('GSIS', "Employees' Compensation", p, er(p).ecc);
    add('PhilHealth', 'Employee share', p, p.deductions.philhealth);
    add('PhilHealth', 'Employer share', p, er(p).philhealth);
    add('Pag-IBIG', 'Employee share', p, p.deductions.pagibig);
    add('Pag-IBIG', 'Employer share', p, er(p).pagibig);
    add('BIR', 'Withholding tax on compensation (1601-C)', p, p.deductions.withholdingTax);
    add('BIR', 'Percentage tax withheld (job orders)', p, p.deductions.percentageTax);
    for (const d of p.deductions.items || []) add(d.remit, d.name, p, d.amount);
  }
  return [...groups.values()].map((g) => ({ ...g, total: [...g.lines.values()].reduce((a, v) => a + v, 0) }));
}

export function remittancesView(run) {
  const groups = remittanceGroups(run);
  if (!groups.length) return html`<p class="muted">Nothing to remit from this run.</p>`;
  return html`<p class="muted small">What to remit from this run, and to whom. GSIS, PhilHealth and Pag-IBIG are due by the 10th of the following month; BIR Form 1601-C by the 10th (the 15th for eFPS filers). Download a list per agency for its remittance file.</p>
    <div class="remit-grid">${groups.map((g) => html`<section class="remit-card">
      <div class="card-head"><h3>${g.agency}</h3><button type="button" class="btn sm" data-remit="${g.agency}">CSV</button></div>
      <table class="table compact"><tbody>${[...g.lines].map(([l, v]) => html`<tr><td>${l}</td><td class="num">${amount(v)}</td></tr>`)}</tbody>
      <tfoot><tr><td><strong>Total to remit</strong></td><td class="num"><strong>${amount(g.total)}</strong></td></tr></tfoot></table>
      <p class="muted small">${g.people.size} employee${g.people.size === 1 ? '' : 's'}</p>
    </section>`)}</div>`;
}

export function downloadRemittance(run, agency) {
  const g = remittanceGroups(run).find((x) => x.agency === agency);
  if (!g) return;
  const lines = [...g.lines.keys()];
  const idLabel = { GSIS: 'GSIS BP No', PhilHealth: 'PhilHealth No', 'Pag-IBIG': 'Pag-IBIG MID', BIR: 'TIN' }[agency] || 'ID';
  downloadFile(`${agency.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${run.periodStart}-to-${run.periodEnd}.csv`, toCsv([
    ['Employee No', 'Employee', idLabel, ...lines, 'Total'],
    ...[...g.people.values()].map((p) => [p.no, p.name, p.id, ...lines.map((l) => p.lines[l] || 0), Math.round(lines.reduce((a, l) => a + (p.lines[l] || 0), 0) * 100) / 100]),
  ]));
}

// ----- General Payroll (GAM Appendix 33) -----
export function generalPayroll(run) {
  const f = run.forms || {};
  const bonus = isBonusRun(run);
  const sign = (label, who, cap) => html`<div class="gp-box"><span class="gp-label">${label}</span><span class="gp-line">${who?.name || ''}</span><span class="gp-cap">${who?.title || cap}</span><span class="gp-date">Date</span></div>`;
  return html`<article class="gov-form general-payroll">
    <p class="f-appendix">Appendix 33</p>
    <header class="f-head"><h1>General Payroll</h1>
      <div class="f-entity"><span>Entity name: <strong>${f.entity || ctx.info.schoolName || ''}</strong></span><span>Fund cluster: <strong>01</strong></span></div>
      <div class="f-entity"><span>${bonus ? html`<strong>${run.name}</strong> · pay date ${fmtDate(run.payDate)}` : html`For the period <strong>${fmtDate(run.periodStart)} – ${fmtDate(run.periodEnd)}</strong>`}</span><span>${run.campusName || ''}</span><span>Payroll no. ${run.id.slice(0, 8).toUpperCase()}</span></div>
      <p class="f-small">We acknowledge receipt of cash shown opposite our name as full compensation for services rendered for the period covered.</p>
    </header>
    <div class="table-scroll" tabindex="0" role="region" aria-label="General Payroll"><table class="f-table gp-table">
      <thead>
        <tr><th rowspan="2">No.</th><th rowspan="2">Name</th><th rowspan="2">Position</th><th rowspan="2" class="num">${bonus ? 'Monthly salary' : 'Salary rate'}</th>
          <th colspan="${bonus ? 1 : 4}">Compensation</th><th colspan="${bonus ? 1 : 5}">Deductions</th><th rowspan="2" class="num">Net amount due</th><th rowspan="2">Signature of recipient</th></tr>
        <tr>${bonus ? html`<th class="num">Amount</th><th class="num">Tax</th>` : html`<th class="num">Basic salary</th><th class="num">PERA</th><th class="num">Others</th><th class="num">Gross</th>
          <th class="num">GSIS</th><th class="num">PhilHealth</th><th class="num">Pag-IBIG</th><th class="num">Tax</th><th class="num">Loans/others</th>`}</tr>
      </thead>
      <tbody>${run.payslips.filter((p) => p.grossPay).map((p, i) => html`<tr>
        <td>${i + 1}</td><td>${p.employee.name}</td><td>${p.employee.position}${p.employee.salaryGrade ? html`<br /><small>SG ${p.employee.salaryGrade}-${p.employee.step}</small>` : ''}</td>
        <td class="num">${amount(p.rates?.monthly || p.employee.rate)}</td>
        ${bonus ? html`<td class="num">${amount(p.grossPay)}</td><td class="num">${amount(p.deductions.withholdingTax)}</td>`
          : html`<td class="num">${amount(p.earnings.basicPay)}</td><td class="num">${amount(p.earnings.pera)}</td><td class="num">${amount(rata(p) + p.earnings.allowance + p.earnings.overtimePay + p.earnings.otherEarnings)}</td><td class="num">${amount(p.grossPay)}</td>
            <td class="num">${amount(p.deductions.gsis)}</td><td class="num">${amount(p.deductions.philhealth)}</td><td class="num">${amount(p.deductions.pagibig)}</td><td class="num">${amount(p.deductions.withholdingTax + p.deductions.percentageTax)}</td><td class="num">${amount(loans(p) + p.deductions.otherDeductions)}</td>`}
        <td class="num"><strong>${amount(p.netPay)}</strong></td><td class="gp-sig"></td></tr>`)}</tbody>
      <tfoot><tr><td colspan="4">Total</td>
        ${bonus ? html`<td class="num">${amount(run.totals.grossPay)}</td><td class="num">${amount(sumOf(run, (p) => p.deductions.withholdingTax))}</td>`
          : html`${[(p) => p.earnings.basicPay, (p) => p.earnings.pera, (p) => rata(p) + p.earnings.allowance + p.earnings.overtimePay + p.earnings.otherEarnings, (p) => p.grossPay, (p) => p.deductions.gsis, (p) => p.deductions.philhealth, (p) => p.deductions.pagibig, (p) => p.deductions.withholdingTax + p.deductions.percentageTax, (p) => loans(p) + p.deductions.otherDeductions].map((fn) => html`<td class="num">${amount(sumOf(run, fn))}</td>`)}`}
        <td class="num">${amount(run.totals.netPay)}</td><td></td></tr></tfoot>
    </table></div>
    <div class="gp-signs">
      ${sign('A. Certified: services duly rendered as stated.', null, 'Head of office / HRMO')}
      ${sign('B. Certified: supporting documents complete and proper; cash available.', f.accountant, 'Chief Accountant')}
      ${sign('C. Approved for payment.', f.head, 'Head of Agency')}
      ${sign('D. Certified: each employee whose name appears above has been paid the amount indicated opposite his/her name.', f.cashier, 'Disbursing Officer')}
    </div>
    <div class="f-entity gp-refs"><span>E. ORS/BURS no.: ____________</span><span>Date: ________</span><span>JEV no.: ____________</span><span>Date: ________</span></div>
  </article>`;
}

// ----- Payslip -----
export function govPayslipCard(run, p, settings, { slipNumber, pesosInWords, periodLabel }) {
  const row = (label, value, { sub = false, note = '' } = {}) => html`<tr class="${sub ? 'sub' : ''}"><td>${label}${note ? html`<small>${note}</small>` : ''}</td><td class="num">${value < 0 ? `(${amount(-value)})` : amount(value)}</td></tr>`;
  const optional = (label, value, opts) => (value ? row(label, value, opts) : '');
  const field = (label, value) => html`<div><dt>${label}</dt><dd>${value || '—'}</dd></div>`;
  const bonus = isBonusRun(run);
  const e = p.employee;
  const s = er(p);
  const employerTotal = Object.values(s).reduce((a, v) => a + (Number(v) || 0), 0);
  const a = p.attendance;
  return html`
    <article class="payslip ${run.status === 'draft' ? 'is-draft' : ''}">
      ${run.status === 'draft' ? html`<div class="ps-watermark" aria-hidden="true" data-text="DRAFT"></div>` : ''}
      <header class="ps-head">
        <div class="ps-company">
          ${ctx.info.branding?.logo ? html`<img src="${ctx.info.branding.logo}" alt="" />` : ''}
          <div><strong>${settings.employerName}</strong>${run.campusName ? html`<span>${run.campusName}</span>` : ''}${settings.employerAddress ? html`<span>${settings.employerAddress}</span>` : ''}${settings.employerTin ? html`<span>TIN ${settings.employerTin}</span>` : ''}</div>
        </div>
        <div class="ps-title"><h2>Payslip</h2><p class="ps-ref">${slipNumber(run, p)}</p><p class="ps-conf">Private and confidential</p></div>
      </header>
      <dl class="ps-meta">
        <div><dt>${bonus ? 'Benefit' : 'Pay period'}</dt><dd>${bonus ? BONUS_KINDS[run.kind]?.name || run.name : periodLabel(run)}</dd></div>
        <div><dt>Pay date</dt><dd>${fmtDate(run.payDate)}</dd></div>
        <div><dt>${bonus ? 'Year' : 'Pay frequency'}</dt><dd>${bonus ? run.year : run.payFrequency === 'monthly' ? 'Monthly' : 'Semi-monthly'}</dd></div>
        <div><dt>Status</dt><dd>${run.status === 'draft' ? 'Draft, not final' : 'Final'}</dd></div>
      </dl>
      <section class="ps-block">
        <h3>Employee information</h3>
        <dl class="ps-fields">
          ${field('Employee name', e.name)}${field('Employee no.', e.employeeNo)}
          ${field('Position', e.position)}${field('Office', e.department)}
          ${field('Salary grade', e.salaryGrade ? `SG ${e.salaryGrade}, step ${e.step} · ${money(p.rates?.monthly || e.rate)} a month` : `${money(e.rate)} per ${e.payType === 'daily' ? 'day' : 'month'}`)}${field('Appointment', [e.appointment, e.itemNo ? `item ${e.itemNo}` : ''].filter(Boolean).join(' · '))}
          ${field('TIN', e.tin)}${field('GSIS BP no.', e.gsisNo)}
          ${field('PhilHealth no.', e.philhealthNo)}${field('Pag-IBIG MID no.', e.pagibigNo)}
          ${field('Paid to', e.bankAccount ? `${e.bankName} ${e.bankAccount}` : 'Cash / check')}${bonus ? field('Service by cut-off', `${p.eligibility.months.toFixed(1)} months (${fmtDate(p.eligibility.cutoff)})`) : field('Salary schedule', e.schedule)}
        </dl>
      </section>
      <div class="ps-ledger">
        <table class="ps-table">
          <thead><tr><th>Earnings</th><th class="num">Amount (PHP)</th></tr></thead>
          <tbody>
            ${bonus
              ? html`${p.earnings.items.length ? p.earnings.items.map((i) => row(i.name, i.amount)) : html`<tr><td colspan="2" class="muted">${p.eligibility.note || 'Nothing due'}</td></tr>`}`
              : html`
                ${row('Basic salary', p.earnings.basePay, { note: e.payType === 'daily' ? `${a.daysPresent} day/s at ${amount(p.rates.daily)}` : '' })}
                ${optional('Less: absences without pay', -p.earnings.absenceDeduction, { sub: true, note: `${a.absentDays + a.unpaidLeaveDays} day/s at ${amount(p.rates.daily)}` })}
                ${optional('Less: tardiness and undertime', -p.earnings.tardinessDeduction, { sub: true, note: `${fmtMinutes(p.leave.salaryMinutes)} not covered by leave credits` })}
                ${optional('PERA', p.earnings.pera)}
                ${optional('Representation allowance', p.earnings.representation, { note: p.earnings.rataDays != null ? `${p.earnings.rataDays} days of actual work in the month (${p.earnings.rataShare * 100}%)` : '' })}
                ${optional('Transportation allowance', p.earnings.transportation)}
                ${optional('Other allowance', p.earnings.allowance)}
                ${optional('Overtime', p.earnings.overtimePay, { note: fmtMinutes(a.overtimeMinutes + a.restDayMinutes) })}
                ${optional('Other earnings', p.earnings.otherEarnings)}`}
          </tbody>
          <tfoot><tr><td>Gross pay</td><td class="num">${amount(p.grossPay)}</td></tr></tfoot>
        </table>
        <table class="ps-table">
          <thead><tr><th>Deductions</th><th class="num">Amount (PHP)</th></tr></thead>
          <tbody>
            ${bonus ? '' : html`${optional('GSIS personal share', p.deductions.gsis)}${optional('PhilHealth', p.deductions.philhealth)}${optional('Pag-IBIG', p.deductions.pagibig)}`}
            ${row('Withholding tax', p.deductions.withholdingTax, { note: p.deductions.withholdingTax ? (bonus ? 'on the part above the ₱90,000 exemption' : '') : bonus ? `within the ₱${Number(settings.gov?.benefitsExemptCeiling || 90000).toLocaleString()} exemption` : 'exempt / below threshold' })}
            ${optional('Percentage tax', p.deductions.percentageTax)}
            ${(p.deductions.items || []).map((d) => row(d.name, d.amount, { note: d.remit }))}
            ${optional('Other deductions', p.deductions.otherDeductions)}
          </tbody>
          <tfoot><tr><td>Total deductions</td><td class="num">${amount(p.totalDeductions)}</td></tr></tfoot>
        </table>
      </div>
      ${p.skippedDeductions?.length ? html`<div class="notice"><p>Not deducted this time, so that net pay stays at the minimum (GAA): ${p.skippedDeductions.map((d) => `${d.name} ${amount(d.amount)}`).join(', ')}.</p></div>` : ''}
      <section class="ps-summary">
        <dl>
          <div><dt>Gross pay</dt><dd>${amount(p.grossPay)}</dd></div>
          <div><dt>Less: total deductions</dt><dd>(${amount(p.totalDeductions)})</dd></div>
          <div><dt>Taxable ${bonus ? '(above the exemption)' : 'compensation'}</dt><dd>${amount(p.taxableIncome)}</dd></div>
        </dl>
        <div class="ps-net"><span>Net pay</span><strong>${money(p.netPay)}</strong><em>${pesosInWords(p.netPay)}</em></div>
      </section>
      ${bonus ? '' : html`<div class="ps-ledger ps-small">
        <table class="ps-table">
          <thead><tr><th>Attendance</th><th class="num">Count</th></tr></thead>
          <tbody>
            <tr><td>Scheduled work days</td><td class="num">${a.scheduledDays}</td></tr>
            <tr><td>Days present${a.remoteDays ? html`<small>incl. ${a.remoteDays} remote</small>` : ''}</td><td class="num">${a.daysPresent}</td></tr>
            <tr><td>Leave with pay</td><td class="num">${a.leaveDays}</td></tr>
            <tr><td>Absences / leave without pay</td><td class="num">${a.absentDays + a.unpaidLeaveDays}</td></tr>
            <tr><td>Tardiness and undertime${p.leave.chargedToLeaveDays ? html`<small>${p.leave.chargedToLeaveDays} day charged to vacation leave</small>` : ''}</td><td class="num">${a.flex ? 'Flexible time' : fmtMinutes(p.leave.tardinessMinutes) || '—'}</td></tr>
            ${p.leave.cocHours ? html`<tr><td>Compensatory overtime credits (COC) earned</td><td class="num">${p.leave.cocHours} h</td></tr>` : ''}
          </tbody>
        </table>
        <table class="ps-table">
          <thead><tr><th>Government share</th><th class="num">Amount (PHP)</th></tr></thead>
          <tbody>
            <tr><td>GSIS government share</td><td class="num">${amount(s.gsis || 0)}</td></tr>
            <tr><td>Employees' Compensation</td><td class="num">${amount(s.ecc || 0)}</td></tr>
            <tr><td>PhilHealth</td><td class="num">${amount(s.philhealth || 0)}</td></tr>
            <tr><td>Pag-IBIG</td><td class="num">${amount(s.pagibig || 0)}</td></tr>
          </tbody>
          <tfoot><tr><td>Total government share</td><td class="num">${amount(employerTotal)}</td></tr></tfoot>
        </table>
      </div>`}
      ${p.adjustments.remarks ? html`<section class="ps-remarks"><h3>Remarks</h3><p>${p.adjustments.remarks}</p></section>` : ''}
      <footer class="ps-foot">
        <div class="ps-sign"><span></span>Received by (signature over printed name)</div>
        <div class="ps-sign"><span></span>Date received</div>
        <p>This payslip is system-generated by ${settings.employerName} and is valid without a signature. Government shares are shown for information and are not deducted from pay. Report discrepancies to HR within 5 working days of the pay date.</p>
      </footer>
    </article>`;
}

// ----- To Finance: obligation request, payroll voucher, remittances -----
const STATUS = { draft: ['Waiting', 'amber'], obligated: ['Obligated', 'green'], certified: ['Certified (Box C)', 'blue'], approved: ['Approved (Box D)', 'blue'], paid: ['Paid', 'green'], cancelled: ['Cancelled', 'gray'] };
const docBadge = (d) => (d ? badge(...(STATUS[d.status] || [d.status, 'gray'])) : '');
// The document in ATLAS Finance: a link for those who can open it there (administrators), its
// number otherwise (Finance's officers find it under the same number).
const finLink = (path, label) => (ctx.user?.role === 'admin' ? html`<a href="/finance/#${path}" target="_blank" rel="noopener">${label}</a>` : html`<strong>${label}</strong>`);

export function financeView(run, f, { canEdit }) {
  if (run.status !== 'finalized') return html`<p class="muted">Finalize the run first. A finalized government payroll goes to Finance as an obligation request, then a disbursement voucher.</p>`;
  const e = f.entry;
  const step = (n, title, body, done) => html`<li class="fin-step ${done ? 'done' : ''}"><span class="fin-n">${n}</span><div><h3>${title}</h3>${body}</div></li>`;
  const ors = f.ors && f.ors.status !== 'cancelled' ? f.ors : null;
  const dv = f.dv && f.dv.status !== 'cancelled' ? f.dv : null;
  const classes = [...new Set(e.lines.map((l) => l.cls))];
  return html`
    <p class="muted small">How this payroll is paid in ATLAS Finance (COA): the payroll office prepares the obligation request and the voucher (Box A); the budget office obligates (Box B); the accountant certifies (Box C), the head of agency approves (Box D) and the cashier pays by LDDAP-ADA, which posts the journal entry. Then what was withheld is remitted.</p>
    <ol class="fin-steps">
      ${step(1, 'Obligation request', ors
        ? html`<p>${finLink(`/obligations/${ors.id}`, `${ors.form} ${ors.no || '(number given when obligated)'}`)} · ${money(ors.amount)} ${docBadge(ors)}${ors.status === 'draft' ? html` <span class="muted small">with the budget office for Box B</span>` : ''}</p>`
        : canEdit ? html`<form id="fin-ors" class="fin-form">
            ${classes.map((c) => html`<label class="field"><span>${c === 'PS' ? 'Personnel services' : 'MOOE (job orders)'} allotment</span><select name="${c}" required>${f.allotments.filter((a) => a.cls === c).map((a) => html`<option value="${a.id}">${a.ref} · ${a.pap}${a.papName ? ` ${a.papName}` : ''} · ${money(a.balance)} left</option>`)}</select></label>`)}
            ${classes.some((c) => !f.allotments.some((a) => a.cls === c)) ? html`<p class="notice small">No ${classes.filter((c) => !f.allotments.some((a) => a.cls === c)).join(' or ')} allotment in fund ${f.fund} for ${run.payDate.slice(0, 4)}. The budget office records it in Finance first.</p>` : html`<button class="btn primary">Prepare the obligation request</button>`}
          </form>` : html`<p class="muted">Not yet prepared.</p>`, Boolean(ors && ors.status === 'obligated'))}
      ${step(2, 'Payroll voucher', dv
        ? html`<p>${finLink(`/dvs/${dv.id}`, `DV ${dv.no || '(numbered at certification)'}`)} · ${money(dv.amount)} ${docBadge(dv)}${dv.jevNo ? html` · JEV ${dv.jevNo}` : ''}</p>`
        : ors?.status === 'obligated' && canEdit ? html`<form id="fin-dv" class="fin-form"><label class="field"><span>Paid by</span><select name="mode"><option value="ada">LDDAP-ADA (credited to the employees' accounts)</option><option value="check">MDS check</option></select></label><button class="btn primary">Prepare the voucher</button></form>`
        : html`<p class="muted">${ors ? 'After the budget office obligates the request.' : 'After the obligation request.'}</p>`, dv?.status === 'paid')}
      ${step(3, 'Remittances', f.remittances.length
        ? html`<ul class="link-list">${f.remittances.map((r) => html`<li>${r.agency}: ${finLink(`/dvs/${r.id}`, `DV ${r.no || '(draft)'}`)} · ${money(r.amount)} ${docBadge(r)}</li>`)}</ul>`
        : dv?.status === 'paid' && canEdit ? html`<button class="btn primary" id="fin-remit">Prepare remittance vouchers (GSIS, PhilHealth, Pag-IBIG, BIR)</button><p class="muted small">Cooperative, provident fund and other deductions are remitted with a voucher to each creditor in Finance.</p>`
        : html`<p class="muted">After the payroll voucher is paid.</p>`, f.remittances.length && f.remittances.every((r) => r.status === 'paid'))}
    </ol>
    <h3 class="sub-h">Accounting entry</h3>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Accounting entry"><table class="table compact">
      <thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
      <tbody>
        ${e.lines.map((l) => html`<tr><td>${l.code} ${l.title}<small>${l.cls}</small></td><td class="num">${amount(l.amount)}</td><td></td></tr>`)}
        ${e.deductions.map((d) => html`<tr><td class="indent">${d.code} ${d.title}<small>${d.label}</small></td><td></td><td class="num">${amount(d.amount)}</td></tr>`)}
        <tr><td class="indent">Cash (net pay to the employees)</td><td></td><td class="num">${amount(e.net)}</td></tr>
      </tbody>
      <tfoot><tr><td>Total</td><td class="num">${amount(e.gross)}</td><td class="num">${amount(e.gross)}</td></tr></tfoot>
    </table></div>`;
}
