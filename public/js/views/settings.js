import { api } from '../api.js';
import { ctx } from '../state.js';
import { html, mount, toast, confirmDialog, downloadFile, today, WEEKDAYS } from '../ui.js';

export async function settingsView(el) {
  const s = await api.get('/api/settings');
  const checked = (b) => (b ? 'checked' : '');

  mount(el, html`
    <header class="page-head"><div><h1>Settings</h1><p class="muted">Company details, payroll rules and data management.</p></div></header>
    <form id="settings-form" class="stack" novalidate>
      <section class="card">
        <h2>Company</h2>
        <div class="grid">
          <label class="field"><span>Company name</span><input name="companyName" value="${s.companyName}" required /></label>
          <label class="field"><span>TIN</span><input name="companyTin" value="${s.companyTin}" /></label>
          <label class="field span-3"><span>Address</span><input name="companyAddress" value="${s.companyAddress}" /></label>
        </div>
      </section>
      <section class="card">
        <h2>Payroll rules</h2>
        <div class="grid">
          <label class="field"><span>Pay frequency</span>
            <select name="payFrequency"><option value="semi-monthly" ${s.payFrequency === 'semi-monthly' ? 'selected' : ''}>Semi-monthly (15th &amp; end of month)</option><option value="monthly" ${s.payFrequency === 'monthly' ? 'selected' : ''}>Monthly</option></select>
          </label>
          <label class="field"><span>Work days per year</span><input type="number" name="workDaysPerYear" value="${s.workDaysPerYear}" min="200" max="366" />
            <small class="muted">Daily rate = monthly × 12 ÷ this. 261 for 5-day weeks, 313 for 6-day weeks.</small></label>
          <label class="field"><span>Late grace period (minutes)</span><input type="number" name="gracePeriodMinutes" value="${s.gracePeriodMinutes}" min="0" /></label>
          <label class="field"><span>Minimum overtime (minutes)</span><input type="number" name="minimumOvertimeMinutes" value="${s.minimumOvertimeMinutes}" min="0" /><small class="muted">Shorter overtime on regular days is ignored.</small></label>
          <label class="field"><span>Overtime rate</span><input type="number" step="0.01" name="overtimeMultiplier" value="${s.overtimeMultiplier}" /><small class="muted">1.25 = 125% of hourly rate</small></label>
          <label class="field"><span>Rest day work rate</span><input type="number" step="0.01" name="restDayMultiplier" value="${s.restDayMultiplier}" /><small class="muted">1.30 = 130% of hourly rate</small></label>
        </div>
        <h3>Deductions to compute</h3>
        <div class="checks">
          <label><input type="checkbox" name="c_sss" ${checked(s.contributions.sss)} /> SSS (2025 table: 5% employee / 10% employer)</label>
          <label><input type="checkbox" name="c_philhealth" ${checked(s.contributions.philhealth)} /> PhilHealth (5%, shared equally)</label>
          <label><input type="checkbox" name="c_pagibig" ${checked(s.contributions.pagibig)} /> Pag-IBIG (2%, max ₱200 each)</label>
          <label><input type="checkbox" name="c_withholdingTax" ${checked(s.contributions.withholdingTax)} /> BIR withholding tax (TRAIN 2023 table)</label>
        </div>
      </section>
      <section class="card">
        <h2>Default work schedule</h2>
        <p class="muted small">Used for new employees. Each employee can have their own schedule.</p>
        <div class="grid">
          <label class="field"><span>Shift start</span><input type="time" name="shiftStart" value="${s.schedule.shiftStart}" /></label>
          <label class="field"><span>Shift end</span><input type="time" name="shiftEnd" value="${s.schedule.shiftEnd}" /></label>
          <label class="field"><span>Unpaid break (minutes)</span><input type="number" name="breakMinutes" value="${s.schedule.breakMinutes}" min="0" /></label>
          <div class="field span-3"><span>Work days</span>
            <div class="days">${WEEKDAYS.map((d, i) => html`<label><input type="checkbox" name="workDays" value="${i}" ${checked(s.schedule.workDays.includes(i))} /> ${d}</label>`)}</div>
          </div>
        </div>
      </section>
      <p class="form-error" hidden></p>
      <div class="actions end"><button class="btn primary" type="submit">Save settings</button></div>
    </form>

    <section class="card">
      <h2>Data</h2>
      <p class="muted small">Everything is stored on this computer in <code>data/db.json</code> inside the app folder. Download a backup regularly.</p>
      <div class="actions">
        <button class="btn" id="backup">Download backup</button>
        <label class="btn">Restore backup… <input type="file" id="restore" accept="application/json,.json" hidden /></label>
        <button class="btn" id="demo">Load demo data</button>
        <button class="btn danger ghost" id="reset">Erase all data</button>
      </div>
    </section>`);

  const form = el.querySelector('#settings-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      companyName: fd.get('companyName'),
      companyTin: fd.get('companyTin'),
      companyAddress: fd.get('companyAddress'),
      payFrequency: fd.get('payFrequency'),
      workDaysPerYear: fd.get('workDaysPerYear'),
      gracePeriodMinutes: fd.get('gracePeriodMinutes'),
      minimumOvertimeMinutes: fd.get('minimumOvertimeMinutes'),
      overtimeMultiplier: fd.get('overtimeMultiplier'),
      restDayMultiplier: fd.get('restDayMultiplier'),
      contributions: Object.fromEntries(['sss', 'philhealth', 'pagibig', 'withholdingTax'].map((k) => [k, fd.has(`c_${k}`)])),
      schedule: { shiftStart: fd.get('shiftStart'), shiftEnd: fd.get('shiftEnd'), breakMinutes: fd.get('breakMinutes'), workDays: fd.getAll('workDays').map(Number) },
    };
    try {
      await api.put('/api/settings', body);
      await ctx.refreshSettings();
      form.querySelector('.form-error').hidden = true;
      toast('Settings saved.');
    } catch (err) {
      const errEl = form.querySelector('.form-error');
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  el.querySelector('#backup').addEventListener('click', async () => {
    const data = await api.get('/api/admin/export');
    downloadFile(`ltdc-hr-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
  });

  el.querySelector('#restore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !(await confirmDialog('Replace ALL current data with this backup?', { confirmLabel: 'Restore' }))) return;
    try {
      await api.post('/api/admin/import', JSON.parse(await file.text()));
      await ctx.refreshSettings();
      toast('Backup restored.');
      location.hash = '#/dashboard';
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 'error');
    }
  });

  el.querySelector('#demo').addEventListener('click', async () => {
    if (!(await confirmDialog('Replace ALL current data with demo employees and attendance?', { confirmLabel: 'Load demo data' }))) return;
    await api.post('/api/admin/demo');
    await ctx.refreshSettings();
    toast('Demo data loaded.');
    location.hash = '#/dashboard';
  });

  el.querySelector('#reset').addEventListener('click', async () => {
    if (!(await confirmDialog('Permanently erase all employees, attendance, payroll runs and settings?', { confirmLabel: 'Erase everything' }))) return;
    await api.post('/api/admin/reset');
    await ctx.refreshSettings();
    toast('All data erased.');
    location.hash = '#/dashboard';
  });
}
