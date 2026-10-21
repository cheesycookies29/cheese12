// Payroll Setup: pay rules, deductions, government rates and tax tables.
import { api } from '../api.js';
import { ctx } from '../state.js';
import { DEFAULT_RATES, sssContribution, philhealthContribution, pagibigContribution, withholdingTax, round2 } from '/shared/calc.js';
import { html, mount, toast, amount, confirmDialog } from '../ui.js';

const pct = (rate) => round2(rate * 100 * 100) / 100; // 0.05 -> 5
const numField = (label, name, value, { step = 'any', suffix = '', hint } = {}) => html`
  <label class="field"><span>${label}</span>
    <div class="input-suffix"><input type="number" name="${name}" value="${value}" step="${step}" min="0" required />${suffix ? html`<em>${suffix}</em>` : ''}</div>
    ${hint ? html`<small class="muted">${hint}</small>` : ''}
  </label>`;

function taxRows(rows, freq) {
  return html`${rows.map((r, i) => html`<tr>
    <td><div class="input-suffix"><em class="pre">₱</em><input type="number" step="any" min="0" data-tax="${freq}" data-col="over" data-row="${i}" value="${r.over}" /></div></td>
    <td><div class="input-suffix"><em class="pre">₱</em><input type="number" step="any" min="0" data-tax="${freq}" data-col="base" data-row="${i}" value="${r.base}" /></div></td>
    <td><div class="input-suffix"><input type="number" step="any" min="0" max="100" data-tax="${freq}" data-col="rate" data-row="${i}" value="${pct(r.rate)}" /><em>%</em></div></td>
    <td class="row-actions">${rows.length > 1 ? html`<button type="button" class="link danger" data-remove-row="${freq}:${i}">Remove</button>` : ''}</td>
  </tr>`)}`;
}

export async function payrollSetupView(el) {
  const s = await api.get('/api/settings');
  const rates = structuredClone(s.rates);
  const tax = { 'semi-monthly': structuredClone(rates.tax['semi-monthly']), monthly: structuredClone(rates.tax.monthly) };
  const checked = (b) => (b ? 'checked' : '');

  mount(el, html`
    <header class="page-head">
      <div><h1>Payroll Setup</h1>
        <p class="muted">How pay and deductions are computed. Changes apply to new payroll runs and to drafts when recomputed; finalized runs never change.</p>
        ${s.payrollConfigUpdatedAt ? html`<p class="muted small">Last changed by ${s.payrollConfigUpdatedBy} on ${new Date(s.payrollConfigUpdatedAt).toLocaleString('en-PH')}</p>` : ''}
      </div>
    </header>
    <form id="setup-form" class="stack" novalidate>
      <section class="card">
        <h2>Pay rules</h2>
        <div class="grid">
          <label class="field"><span>Pay frequency</span>
            <select name="payFrequency"><option value="semi-monthly" ${s.payFrequency === 'semi-monthly' ? 'selected' : ''}>Semi-monthly (15th and end of month)</option><option value="monthly" ${s.payFrequency === 'monthly' ? 'selected' : ''}>Monthly</option></select>
          </label>
          ${numField('Work days per year', 'workDaysPerYear', s.workDaysPerYear, { step: 1, hint: 'Daily rate = monthly × 12 ÷ this. Company policy: 312 (6 days × 52 weeks). 261 would suit a 5-day week.' })}
          ${numField('Late grace period', 'gracePeriodMinutes', s.gracePeriodMinutes, { step: 1, suffix: 'min' })}
          ${numField('Minimum overtime', 'minimumOvertimeMinutes', s.minimumOvertimeMinutes, { step: 1, suffix: 'min', hint: 'Shorter overtime on regular days is ignored.' })}
          ${numField('Overtime rate', 'overtimeMultiplier', s.overtimeMultiplier, { step: 0.01, suffix: '× hourly', hint: '1.25 = 125% of the hourly rate' })}
          ${numField('Rest day work rate', 'restDayMultiplier', s.restDayMultiplier, { step: 0.01, suffix: '× hourly', hint: '1.30 = 130% of the hourly rate' })}
        </div>
        <h3>Deductions to compute</h3>
        <div class="checks">
          <label><input type="checkbox" name="c_sss" ${checked(s.contributions.sss)} /> SSS</label>
          <label><input type="checkbox" name="c_philhealth" ${checked(s.contributions.philhealth)} /> PhilHealth</label>
          <label><input type="checkbox" name="c_pagibig" ${checked(s.contributions.pagibig)} /> Pag-IBIG</label>
          <label><input type="checkbox" name="c_withholdingTax" ${checked(s.contributions.withholdingTax)} /> BIR withholding tax</label>
        </div>
      </section>

      <section class="card" id="gov-rates"></section>

      <section class="card">
        <h2>Withholding tax tables</h2>
        <p class="muted small">Tax = base tax + (taxable income − “over”) × rate. Taxable income = gross pay − employee SSS, PhilHealth and Pag-IBIG.</p>
        <div class="cols tax-cols">
          ${['semi-monthly', 'monthly'].map((freq) => html`<div>
            <h3>${freq === 'monthly' ? 'Monthly' : 'Semi-monthly'}</h3>
            <table class="table compact edit-table"><thead><tr><th>Over</th><th>Base tax</th><th>Rate</th><th></th></tr></thead><tbody id="tax-${freq}"></tbody></table>
            <button type="button" class="link" data-add-row="${freq}">+ Add bracket</button>
          </div>`)}
        </div>
      </section>

      <section class="card">
        <h2>Try it</h2>
        <p class="muted small">Deductions for one pay period at a monthly salary, using the values on this page (saved or not).</p>
        <div class="toolbar"><label class="inline">Monthly salary ₱ <input type="number" id="try-salary" value="30000" min="0" step="any" /></label></div>
        <div id="try-result"></div>
      </section>

      <p class="form-error" hidden></p>
      <div class="actions end">
        <button type="button" class="btn" id="restore">Restore 2025 government rates</button>
        <button class="btn primary" type="submit">Save payroll setup</button>
      </div>
    </form>`);

  const form = el.querySelector('#setup-form');

  function renderGov() {
    const { sss, philhealth: ph, pagibig: hdmf } = rates;
    mount(el.querySelector('#gov-rates'), html`
      <h2>Government contributions</h2>
      <h3>SSS</h3>
      <div class="grid four">
        ${numField('Employee share', 'sss.eeRate', pct(sss.eeRate), { suffix: '%' })}
        ${numField('Employer share', 'sss.erRate', pct(sss.erRate), { suffix: '%' })}
        ${numField('Minimum salary credit', 'sss.minMsc', sss.minMsc, { suffix: '₱' })}
        ${numField('Maximum salary credit', 'sss.maxMsc', sss.maxMsc, { suffix: '₱' })}
        ${numField('Salary credit step', 'sss.mscStep', sss.mscStep, { suffix: '₱' })}
        ${numField('EC below threshold', 'sss.ecLow', sss.ecLow, { suffix: '₱' })}
        ${numField('EC at/above threshold', 'sss.ecHigh', sss.ecHigh, { suffix: '₱' })}
        ${numField('EC threshold (salary credit)', 'sss.ecThreshold', sss.ecThreshold, { suffix: '₱' })}
      </div>
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
      contributions: Object.fromEntries(['sss', 'philhealth', 'pagibig', 'withholdingTax'].map((k) => [k, fd.has(`c_${k}`)])),
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

  renderGov();
  renderTax();
  renderTry();
  form.addEventListener('input', renderTry);
  form.addEventListener('change', renderTry);

  form.addEventListener('click', (e) => {
    const add = e.target.dataset.addRow;
    const remove = e.target.dataset.removeRow;
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
    if (!(await confirmDialog('Fill in the 2025 SSS, PhilHealth and Pag-IBIG rates and the TRAIN tax tables? Nothing is saved until you click Save.', { confirmLabel: 'Fill in', danger: false }))) return;
    Object.assign(rates, structuredClone(DEFAULT_RATES));
    tax['semi-monthly'] = structuredClone(DEFAULT_RATES.tax['semi-monthly']);
    tax.monthly = structuredClone(DEFAULT_RATES.tax.monthly);
    renderGov();
    renderTax();
    renderTry();
    toast('Default rates filled in. Review, then save.');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('.form-error');
    try {
      await api.put('/api/payroll-config', collect());
      await ctx.refreshSettings();
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
