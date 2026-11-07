// Payroll setup: pay rules, deductions, government rates and tax tables.
// From the Lancaster ERP (public/js/views/payroll-setup.js there).
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { DEFAULT_RATES, sssContribution, philhealthContribution, pagibigContribution, withholdingTax, round2 } from '/shared/calc.js';
import { html, mount, toast, amount, money, confirmDialog, today } from '../../ui.js';
import { SALARY_SCHEDULES, scheduleOn, salaryFor, DEFAULT_GOV } from '/shared/gov-pay.js';
import { hr } from '../state.js';

const pct = (rate) => round2(rate * 100 * 100) / 100; // 0.05 -> 5
const numField = (label, name, value, { step = 'any', suffix = '', hint } = {}) => html`
  <label class="field"><span>${label}</span>
    <div class="input-suffix"><input type="number" name="${name}" value="${value}" step="${step}" min="0" required />${suffix ? html`<em>${suffix}</em>` : ''}</div>
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </label>`;

function taxRows(rows, freq) {
  return html`${rows.map((r, i) => html`<tr>
    <td><div class="input-suffix"><em class="pre">₱</em><input type="number" step="any" min="0" data-tax="${freq}" data-col="over" data-row="${i}" value="${r.over}" /></div></td>
    <td><div class="input-suffix"><em class="pre">₱</em><input type="number" step="any" min="0" data-tax="${freq}" data-col="base" data-row="${i}" value="${r.base}" /></div></td>
    <td><div class="input-suffix"><input type="number" step="any" min="0" max="100" data-tax="${freq}" data-col="rate" data-row="${i}" value="${pct(r.rate)}" /><em>%</em></div></td>
    <td class="row-actions">${rows.length > 1 ? html`<button type="button" class="icon-btn danger" data-remove-row="${freq}:${i}" aria-label="Remove bracket" title="Remove bracket">${icon('trash', 16)}</button>` : ''}</td>
  </tr>`)}`;
}

export async function payrollSetupView(el) {
  const s = await api.get('/api/hris/settings');
  const rates = structuredClone(s.rates);
  const tax = { 'semi-monthly': structuredClone(rates.tax['semi-monthly']), monthly: structuredClone(rates.tax.monthly) };
  const checked = (b) => (b ? 'checked' : '');
  const g = { ...DEFAULT_GOV, ...(s.gov || {}) };
  let system = s.payrollSystem || 'government';
  const gov = () => system === 'government';

  mount(el, html`
    ${pageHead('Payroll setup', html`How pay and deductions are computed, at every campus. Changes apply to new payroll runs and to drafts when recomputed; finalized runs never change.${s.payrollConfigUpdatedAt ? html`<br /><span class="small">Last changed by ${s.payrollConfigUpdatedBy} on ${new Date(s.payrollConfigUpdatedAt).toLocaleString('en-PH')}</span>` : ''}`)}
    <form id="setup-form" class="stack" novalidate>
      <section class="card">
        <h2>Payroll system</h2>
        <div class="grid">
          <label class="field span-2"><span>Rules</span>
            <select name="payrollSystem">
              <option value="government" ${system === 'government' ? 'selected' : ''}>Government (state university or college): salary grades, GSIS, PERA, RATA, bonuses</option>
              <option value="private" ${system === 'private' ? 'selected' : ''}>Private school: SSS, PhilHealth, Pag-IBIG (the Lancaster ERP's rules)</option>
            </select>
            <span class="hint">Applies to new payroll runs. Finalized runs keep the rules they were computed with.</span>
          </label>
        </div>
      </section>
      <section class="card gov-only" id="gov-setup"></section>
      <section class="card gov-only" id="ssl"></section>
      <section class="card">
        <h2>Pay rules</h2>
        <div class="grid">
          <label class="field"><span>Pay frequency</span>
            <select name="payFrequency"><option value="semi-monthly" ${s.payFrequency === 'semi-monthly' ? 'selected' : ''}>Semi-monthly (15th and end of month)</option><option value="monthly" ${s.payFrequency === 'monthly' ? 'selected' : ''}>Monthly</option></select>
          </label>
          <div class="private-only" style="display:contents">${numField('Work days per year', 'workDaysPerYear', s.workDaysPerYear, { step: 1, hint: 'Daily rate = monthly × 12 ÷ this. 261 suits a 5-day week (Monday to Friday); 313 a 6-day week.' })}</div>
          ${numField('Late grace period', 'gracePeriodMinutes', s.gracePeriodMinutes, { step: 1, suffix: 'min' })}
          ${numField('Minimum overtime', 'minimumOvertimeMinutes', s.minimumOvertimeMinutes, { step: 1, suffix: 'min', hint: 'Shorter overtime on regular days is ignored.' })}
          <div class="private-only" style="display:contents">
          ${numField('Overtime rate', 'overtimeMultiplier', s.overtimeMultiplier, { step: 0.01, suffix: '× hourly', hint: '1.25 = 125% of the hourly rate' })}
          ${numField('Rest day work rate', 'restDayMultiplier', s.restDayMultiplier, { step: 0.01, suffix: '× hourly', hint: '1.30 = 130% of the hourly rate' })}</div>
        </div>
        <h3>Deductions to compute</h3>
        <div class="checks">
          <label class="gov-only"><input type="checkbox" name="c_gsis" ${checked(s.contributions.gsis !== false)} /> GSIS</label>
          <label class="private-only"><input type="checkbox" name="c_sss" ${checked(s.contributions.sss)} /> SSS</label>
          <label><input type="checkbox" name="c_philhealth" ${checked(s.contributions.philhealth)} /> PhilHealth</label>
          <label><input type="checkbox" name="c_pagibig" ${checked(s.contributions.pagibig)} /> Pag-IBIG</label>
          <label><input type="checkbox" name="c_withholdingTax" ${checked(s.contributions.withholdingTax)} /> BIR withholding tax</label>
        </div>
      </section>

      <section class="card" id="gov-rates"></section>

      <section class="card">
        <h2>Withholding tax tables</h2>
        <p class="muted small">Tax = base tax + (taxable income − “over”) × rate. Taxable income = gross pay − the employee's ${html`<span class="gov-only">GSIS</span><span class="private-only">SSS</span>`}, PhilHealth and Pag-IBIG shares${html`<span class="gov-only"> (PERA and RATA are not taxable; 13th-month pay and other benefits are exempt up to ₱${Number(g.benefitsExemptCeiling).toLocaleString()} a year)</span>`}.</p>
        <div class="cols tax-cols">
          ${['semi-monthly', 'monthly'].map((freq) => html`<div>
            <h3>${freq === 'monthly' ? 'Monthly' : 'Semi-monthly'}</h3>
            <table class="table compact edit-table no-stack"><thead><tr><th>Over (₱)</th><th>Base tax (₱)</th><th>Rate (%)</th><th></th></tr></thead><tbody id="tax-${freq}"></tbody></table>
            <button type="button" class="link" data-add-row="${freq}">+ Add bracket</button>
          </div>`)}
        </div>
      </section>

      <section class="card">
        <h2>Try it</h2>
        <p class="muted small">Deductions for one pay period at a monthly salary, using the values on this page (saved or not).</p>
        <div class="toolbar">
          <label class="inline private-only">Monthly salary ₱ <input type="number" id="try-salary" value="30000" min="0" step="any" /></label>
          <label class="inline gov-only">Salary grade <select id="try-sg">${Array.from({ length: 33 }, (_, i) => html`<option value="${i + 1}" ${i + 1 === 12 ? 'selected' : ''}>SG ${i + 1}</option>`)}</select></label>
          <label class="inline gov-only">Step <select id="try-step">${Array.from({ length: 8 }, (_, i) => html`<option value="${i + 1}">${i + 1}</option>`)}</select></label>
        </div>
        <div id="try-result"></div>
      </section>

      <p class="form-error" hidden></p>
      <div class="actions end">
        <button type="button" class="btn" id="restore">Restore default rates</button>
        <button class="btn primary" type="submit">Save payroll setup</button>
      </div>
    </form>`);

  const form = el.querySelector('#setup-form');

  function renderGov() {
    const { sss, philhealth: ph, pagibig: hdmf } = rates;
    mount(el.querySelector('#gov-rates'), html`
      <h2>Contributions</h2>
      <div id="sss-block"><h3>SSS</h3>
      <div class="grid four">
        ${numField('Employee share', 'sss.eeRate', pct(sss.eeRate), { suffix: '%' })}
        ${numField('Employer share', 'sss.erRate', pct(sss.erRate), { suffix: '%' })}
        ${numField('Minimum salary credit', 'sss.minMsc', sss.minMsc, { suffix: '₱' })}
        ${numField('Maximum salary credit', 'sss.maxMsc', sss.maxMsc, { suffix: '₱' })}
        ${numField('Salary credit step', 'sss.mscStep', sss.mscStep, { suffix: '₱' })}
        ${numField('EC below threshold', 'sss.ecLow', sss.ecLow, { suffix: '₱' })}
        ${numField('EC at/above threshold', 'sss.ecHigh', sss.ecHigh, { suffix: '₱' })}
        ${numField('EC threshold (salary credit)', 'sss.ecThreshold', sss.ecThreshold, { suffix: '₱' })}
      </div></div>
      <h3>PhilHealth</h3>
      <div class="grid four">
        ${numField('Premium rate (total)', 'philhealth.rate', pct(ph.rate), { suffix: '%', hint: 'Split equally between employee and employer.' })}
        ${numField('Salary floor', 'philhealth.floor', ph.floor, { suffix: '₱' })}
        ${numField('Salary ceiling', 'philhealth.ceiling', ph.ceiling, { suffix: '₱' })}
      </div>
      <h3>Pag-IBIG (HDMF)</h3>
      <div class="grid four">
        ${numField('Employee rate', 'pagibig.eeRate', pct(hdmf.eeRate), { suffix: '%' })}
        ${numField('Employee rate, low income', 'pagibig.eeLowRate', pct(hdmf.eeLowRate), { suffix: '%' })}
        ${numField('Low-income threshold', 'pagibig.lowThreshold', hdmf.lowThreshold, { suffix: '₱' })}
        ${numField('Employer rate', 'pagibig.erRate', pct(hdmf.erRate), { suffix: '%' })}
        ${numField('Maximum fund salary', 'pagibig.maxFundSalary', hdmf.maxFundSalary, { suffix: '₱' })}
      </div>`);
  }

  // Government payroll settings.
  function renderGovSetup() {
    const pick = (name, value, options) => html`<select name="${name}">${options.map(([v, l]) => html`<option value="${v}" ${String(value) === String(v) ? 'selected' : ''}>${l}</option>`)}</select>`;
    mount(el.querySelector('#gov-setup'), html`
      <h2>Government payroll</h2>
      <h3>GSIS (RA 8291)</h3>
      <div class="grid four">
        ${numField('Personal share', 'gov.gsisPersonal', pct(g.gsisPersonal), { suffix: '%', hint: 'Of the monthly basic salary' })}
        ${numField('Government share', 'gov.gsisGovernment', pct(g.gsisGovernment), { suffix: '%' })}
        ${numField('Employees\' Compensation', 'gov.ecc', g.ecc, { suffix: '₱/month', hint: 'Paid by the government' })}
      </div>
      <h3>Allowances</h3>
      <div class="grid four">
        ${numField('PERA', 'gov.pera', g.pera, { suffix: '₱/month', hint: 'Less 1/22 per day of absence without pay' })}
        <label class="field check"><input type="checkbox" name="gov.peraTaxable" ${checked(g.peraTaxable)} /> <span>PERA is taxable</span></label>
        ${numField('Working days a month', 'gov.workingDaysPerMonth', g.workingDaysPerMonth, { step: 1, hint: 'Daily rate = monthly salary ÷ this (22, CSC/DBM)' })}
        ${numField('Minimum net pay', 'gov.netPayFloor', g.netPayFloor, { suffix: '₱/month', hint: 'GAA: loans that would go below this are not taken' })}
      </div>
      <h3>Time</h3>
      <div class="grid four">
        <label class="field"><span>Tardiness and undertime</span>${pick('gov.tardiness', g.tardiness, [['leave', 'Charged to vacation leave first (CSC)'], ['salary', 'Deducted from pay']])}</label>
        <label class="field"><span>Overtime</span>${pick('gov.overtime', g.overtime, [['cto', 'Compensatory time-off (COC), not paid'], ['pay', 'Paid (CSC-DBM JC 2, 2015)']])}</label>
        ${numField('Overtime rate, work days', 'gov.overtimeRegular', g.overtimeRegular, { step: 0.01, suffix: '× hourly' })}
        ${numField('Overtime rate, rest days', 'gov.overtimeRestDay', g.overtimeRestDay, { step: 0.01, suffix: '× hourly' })}
        ${numField('Overtime cap', 'gov.overtimeCapPercent', g.overtimeCapPercent, { suffix: '% of monthly', step: 1 })}
      </div>
      <h3>Bonuses and benefits</h3>
      <div class="grid four">
        ${numField('Cash gift', 'gov.cashGift', g.cashGift, { suffix: '₱', hint: 'With the year-end bonus' })}
        ${numField('PEI', 'gov.pei', g.pei, { suffix: '₱', hint: 'Productivity Enhancement Incentive' })}
        ${numField('Clothing allowance', 'gov.clothingAllowance', g.clothingAllowance, { suffix: '₱/year' })}
        ${numField('Clothing: tax-exempt up to', 'gov.clothingExemptCeiling', g.clothingExemptCeiling, { suffix: '₱', hint: 'De minimis ceiling (BIR RR 29-2025)' })}
        ${numField('Clothing: months of service', 'gov.clothingMinMonths', g.clothingMinMonths, { step: 1 })}
        ${numField('13th-month and other benefits exempt up to', 'gov.benefitsExemptCeiling', g.benefitsExemptCeiling, { suffix: '₱/year' })}
      </div>
      <h3>Job order and contract of service</h3>
      <div class="grid four">
        ${numField('Withholding tax', 'gov.jobOrderEwt', pct(g.jobOrderEwt), { suffix: '%', hint: '0 if the worker gave a sworn declaration' })}
        ${numField('Percentage tax', 'gov.jobOrderPercentageTax', pct(g.jobOrderPercentageTax), { suffix: '%', hint: 'Non-VAT workers' })}
      </div>`);
  }

  // The salary schedule (read-only): EO 64 tranches, with the one in force today marked.
  function renderSsl(effective = scheduleOn(today()).effective) {
    const sched = SALARY_SCHEDULES.find((x) => x.effective === effective);
    mount(el.querySelector('#ssl'), html`
      <div class="card-head"><h2>Salary schedule</h2>
        <select id="ssl-pick" aria-label="Salary schedule">${SALARY_SCHEDULES.map((x) => html`<option value="${x.effective}" ${x.effective === effective ? 'selected' : ''}>${x.name}${x.effective === scheduleOn(today()).effective ? ' · in force' : ''}</option>`)}</select></div>
      <p class="muted small">Monthly salary by salary grade and step, from ${sched.effective}. Payroll uses the schedule in force at the end of each pay period, so January payroll moves to the next tranche by itself.</p>
      <div class="table-scroll ssl-table"><table class="table compact no-stack"><thead><tr><th>SG</th>${Array.from({ length: 8 }, (_, i) => html`<th class="num">Step ${i + 1}</th>`)}</tr></thead>
        <tbody>${Object.entries(sched.grades).map(([sg, row]) => html`<tr><th>${sg}</th>${Array.from({ length: 8 }, (_, i) => html`<td class="num">${row[i] ? row[i].toLocaleString('en-PH') : ''}</td>`)}</tr>`)}</tbody></table></div>`);
    el.querySelector('#ssl-pick').addEventListener('change', (e) => renderSsl(e.target.value));
  }

  function showSystem() {
    // Wrappers shown with display: contents are hidden by style (the hidden attribute does not apply to them).
    const show = (n, on) => (n.style.display === 'contents' || n.dataset.contents ? ((n.dataset.contents = '1'), (n.style.display = on ? 'contents' : 'none')) : (n.hidden = !on));
    for (const n of el.querySelectorAll('.gov-only')) show(n, gov());
    for (const n of el.querySelectorAll('.private-only')) show(n, !gov());
    const sssBlock = el.querySelector('#sss-block');
    if (sssBlock) sssBlock.hidden = gov();
  }

  function renderTax() {
    for (const freq of ['semi-monthly', 'monthly']) mount(el.querySelector(`#tax-${freq}`), taxRows(tax[freq], freq));
  }

  // Read the form back into numbers (percent fields → fractions).
  function collect() {
    const fd = new FormData(form);
    const n = (k) => Number(fd.get(k));
    const p = (k) => n(k) / 100;
    for (const input of form.querySelectorAll('[data-tax]')) {
      const row = tax[input.dataset.tax][Number(input.dataset.row)];
      row[input.dataset.col] = input.dataset.col === 'rate' ? Number(input.value) / 100 : Number(input.value);
    }
    return {
      payFrequency: fd.get('payFrequency'),
      workDaysPerYear: fd.get('workDaysPerYear'),
      gracePeriodMinutes: fd.get('gracePeriodMinutes'),
      minimumOvertimeMinutes: fd.get('minimumOvertimeMinutes'),
      overtimeMultiplier: fd.get('overtimeMultiplier'),
      restDayMultiplier: fd.get('restDayMultiplier'),
      payrollSystem: fd.get('payrollSystem'),
      contributions: Object.fromEntries(['gsis', 'sss', 'philhealth', 'pagibig', 'withholdingTax'].map((k) => [k, fd.has(`c_${k}`)])),
      gov: {
        gsisPersonal: p('gov.gsisPersonal'), gsisGovernment: p('gov.gsisGovernment'), ecc: n('gov.ecc'),
        pera: n('gov.pera'), peraTaxable: fd.has('gov.peraTaxable'), workingDaysPerMonth: n('gov.workingDaysPerMonth'), netPayFloor: n('gov.netPayFloor'),
        tardiness: fd.get('gov.tardiness'), overtime: fd.get('gov.overtime'), overtimeRegular: n('gov.overtimeRegular'), overtimeRestDay: n('gov.overtimeRestDay'), overtimeCapPercent: n('gov.overtimeCapPercent'),
        cashGift: n('gov.cashGift'), pei: n('gov.pei'), clothingAllowance: n('gov.clothingAllowance'), clothingExemptCeiling: n('gov.clothingExemptCeiling'), clothingMinMonths: n('gov.clothingMinMonths'),
        benefitsExemptCeiling: n('gov.benefitsExemptCeiling'), jobOrderEwt: p('gov.jobOrderEwt'), jobOrderPercentageTax: p('gov.jobOrderPercentageTax'),
      },
      rates: {
        sss: { eeRate: p('sss.eeRate'), erRate: p('sss.erRate'), minMsc: n('sss.minMsc'), maxMsc: n('sss.maxMsc'), mscStep: n('sss.mscStep'), ecLow: n('sss.ecLow'), ecHigh: n('sss.ecHigh'), ecThreshold: n('sss.ecThreshold') },
        philhealth: { rate: p('philhealth.rate'), floor: n('philhealth.floor'), ceiling: n('philhealth.ceiling') },
        pagibig: { eeRate: p('pagibig.eeRate'), eeLowRate: p('pagibig.eeLowRate'), lowThreshold: n('pagibig.lowThreshold'), erRate: p('pagibig.erRate'), maxFundSalary: n('pagibig.maxFundSalary') },
        tax: structuredClone(tax),
      },
    };
  }

  function renderTry() {
    const cfg = collect();
    if (gov()) return renderTryGov(cfg);
    const salary = Number(el.querySelector('#try-salary').value) || 0;
    const div = cfg.payFrequency === 'monthly' ? 1 : 2;
    const c = cfg.contributions;
    const sss = c.sss ? sssContribution(salary, cfg.rates.sss) : { ee: 0, er: 0, ec: 0, msc: 0 };
    const ph = c.philhealth ? philhealthContribution(salary, cfg.rates.philhealth) : { ee: 0, er: 0 };
    const hd = c.pagibig ? pagibigContribution(salary, cfg.rates.pagibig) : { ee: 0, er: 0 };
    const gross = salary / div;
    const taxable = Math.max(0, gross - (sss.ee + ph.ee + hd.ee) / div);
    const tax = c.withholdingTax ? withholdingTax(taxable, cfg.payFrequency, cfg.rates.tax) : 0;
    const net = gross - (sss.ee + ph.ee + hd.ee) / div - tax;
    mount(el.querySelector('#try-result'), html`<table class="table compact try">
      <thead><tr><th>Per ${cfg.payFrequency === 'monthly' ? 'month' : 'cutoff'}</th><th class="num">Employee</th><th class="num">Employer</th></tr></thead>
      <tbody>
        <tr><td>Basic pay</td><td class="num">${amount(gross)}</td><td></td></tr>
        <tr><td>SSS ${sss.msc ? html`<small class="muted">(salary credit ${amount(sss.msc)})</small>` : ''}</td><td class="num">${amount(sss.ee / div)}</td><td class="num">${amount((sss.er + sss.ec) / div)}</td></tr>
        <tr><td>PhilHealth</td><td class="num">${amount(ph.ee / div)}</td><td class="num">${amount(ph.er / div)}</td></tr>
        <tr><td>Pag-IBIG</td><td class="num">${amount(hd.ee / div)}</td><td class="num">${amount(hd.er / div)}</td></tr>
        <tr><td>Withholding tax <small class="muted">(taxable ${amount(taxable)})</small></td><td class="num">${amount(tax)}</td><td></td></tr>
      </tbody>
      <tfoot><tr><td><strong>Take-home (before allowances and adjustments)</strong></td><td class="num"><strong>${amount(net)}</strong></td><td></td></tr></tfoot>
    </table>`);
  }

  // One pay period at a salary grade and step, with no absences, tardiness or loans.
  function renderTryGov(cfg) {
    const sg = el.querySelector('#try-sg').value;
    const step = el.querySelector('#try-step').value;
    const monthly = salaryFor(sg, step, today()) || 0;
    const div = cfg.payFrequency === 'monthly' ? 1 : 2;
    const c = cfg.contributions;
    const G = cfg.gov;
    const gsis = c.gsis ? (monthly * G.gsisPersonal) / div : 0;
    const gs = c.gsis ? (monthly * G.gsisGovernment) / div : 0;
    const ph = c.philhealth ? philhealthContribution(monthly, cfg.rates.philhealth) : { ee: 0, er: 0 };
    const hd = c.pagibig ? pagibigContribution(monthly, cfg.rates.pagibig) : { ee: 0, er: 0 };
    const basic = monthly / div;
    const pera = G.pera / div;
    const taxable = Math.max(0, basic + (G.peraTaxable ? pera : 0) - gsis - (ph.ee + hd.ee) / div);
    const tax = c.withholdingTax ? withholdingTax(taxable, cfg.payFrequency, cfg.rates.tax) : 0;
    const net = basic + pera - gsis - (ph.ee + hd.ee) / div - tax;
    mount(el.querySelector('#try-result'), html`<table class="table compact try">
      <thead><tr><th>Per ${cfg.payFrequency === 'monthly' ? 'month' : 'half-month'} · SG ${sg}-${step}, ${money(monthly)} a month</th><th class="num">Employee</th><th class="num">Government</th></tr></thead>
      <tbody>
        <tr><td>Basic salary</td><td class="num">${amount(basic)}</td><td></td></tr>
        <tr><td>PERA</td><td class="num">${amount(pera)}</td><td></td></tr>
        <tr><td>GSIS</td><td class="num">${amount(gsis)}</td><td class="num">${amount(gs + (c.gsis ? G.ecc / div : 0))}</td></tr>
        <tr><td>PhilHealth</td><td class="num">${amount(ph.ee / div)}</td><td class="num">${amount(ph.er / div)}</td></tr>
        <tr><td>Pag-IBIG</td><td class="num">${amount(hd.ee / div)}</td><td class="num">${amount(hd.er / div)}</td></tr>
        <tr><td>Withholding tax <small class="muted">(taxable ${amount(taxable)})</small></td><td class="num">${amount(tax)}</td><td></td></tr>
      </tbody>
      <tfoot><tr><td><strong>Take-home (before loans and RATA)</strong></td><td class="num"><strong>${amount(net)}</strong></td><td></td></tr></tfoot>
    </table>`);
  }

  renderGovSetup();
  renderSsl();
  renderGov();
  renderTax();
  showSystem();
  renderTry();
  form.payrollSystem.addEventListener('change', () => {
    system = form.payrollSystem.value;
    showSystem();
    renderTry();
  });
  form.addEventListener('input', renderTry);
  form.addEventListener('change', renderTry);

  form.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-row]')?.dataset.addRow;
    const remove = e.target.closest('[data-remove-row]')?.dataset.removeRow;
    if (!add && !remove) return;
    collect();
    if (add) {
      const last = tax[add].at(-1);
      tax[add].push({ over: last.over + 1, base: last.base, rate: last.rate });
    } else {
      const [freq, i] = remove.split(':');
      tax[freq].splice(Number(i), 1);
    }
    renderTax();
    renderTry();
  });

  el.querySelector('#restore').addEventListener('click', async () => {
    if (!(await confirmDialog('Fill in the current GSIS, SSS, PhilHealth and Pag-IBIG rates, PERA and bonus amounts, and the TRAIN tax tables? Nothing is saved until you click Save.', { confirmLabel: 'Fill in', danger: false }))) return;
    Object.assign(rates, structuredClone(DEFAULT_RATES));
    Object.assign(g, structuredClone(DEFAULT_GOV));
    renderGovSetup();
    tax['semi-monthly'] = structuredClone(DEFAULT_RATES.tax['semi-monthly']);
    tax.monthly = structuredClone(DEFAULT_RATES.tax.monthly);
    renderGov();
    renderTax();
    showSystem();
    renderTry();
    toast('Default rates filled in. Review, then save.');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('.form-error');
    try {
      await api.put('/api/hris/payroll-config', collect());
      await hr.refreshSettings();
      errEl.hidden = true;
      toast('Payroll setup saved. Recompute draft payroll runs to apply it.');
      payrollSetupView(el);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}
