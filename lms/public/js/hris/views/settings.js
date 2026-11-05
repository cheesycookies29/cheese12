// HR settings: the employer details printed on payslips, and the default work schedule
// for new employee records.
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { html, mount, toast, WEEKDAYS } from '../../ui.js';
import { hr } from '../state.js';

export async function hrSettingsView(el) {
  await hr.refreshSettings();
  const s = hr.settings;
  mount(el, html`
    ${pageHead('HR settings', 'Used at every campus. Pay rules, contributions and tax tables are under Payroll setup.')}
    <form id="hr-form" class="stack" novalidate>
      <section class="card">
        <h2>Employer on payslips</h2>
        <div class="grid">
          <label class="field"><span>Employer name</span><input value="${s.employerName}" disabled /><span class="hint">The school name, set by an administrator in the Learn admin panel.</span></label>
          <label class="field span-2"><span>Address</span><input name="employerAddress" value="${s.employerAddress}" maxlength="300" placeholder="e.g. San Jose, Pili, Camarines Sur 4418" /></label>
          <label class="field"><span>Employer TIN</span><input name="employerTin" value="${s.employerTin}" maxlength="40" /></label>
        </div>
      </section>
      <section class="card">
        <h2>Default work schedule</h2>
        <p class="muted small">Filled in on new employee records; each record can have its own.</p>
        <div class="grid">
          <label class="field"><span>Shift start</span><input type="time" name="shiftStart" value="${s.schedule.shiftStart}" required /></label>
          <label class="field"><span>Shift end</span><input type="time" name="shiftEnd" value="${s.schedule.shiftEnd}" required /></label>
          <label class="field"><span>Unpaid break (minutes)</span><input type="number" name="breakMinutes" min="0" max="240" step="5" value="${s.schedule.breakMinutes}" /></label>
          <div class="field span-3"><span>Work days</span>
            <div class="days">${WEEKDAYS.map((d, i) => html`<label><input type="checkbox" name="workDays" value="${i}" ${s.schedule.workDays.includes(i) ? 'checked' : ''} /> ${d}</label>`)}</div>
          </div>
        </div>
      </section>
      ${s.updatedAt ? html`<p class="muted small">Last changed by ${s.updatedBy} on ${new Date(s.updatedAt).toLocaleString('en-PH')}.</p>` : ''}
      <p class="form-error" hidden></p>
      <div class="actions end"><button class="btn primary" type="submit">Save HR settings</button></div>
    </form>`);
  const form = el.querySelector('#hr-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const errEl = form.querySelector('.form-error');
    try {
      await api.put('/api/hris/settings', {
        employerAddress: fd.get('employerAddress'), employerTin: fd.get('employerTin'),
        schedule: { shiftStart: fd.get('shiftStart'), shiftEnd: fd.get('shiftEnd'), breakMinutes: fd.get('breakMinutes'), workDays: fd.getAll('workDays').map(Number) },
      });
      errEl.hidden = true;
      toast('HR settings saved.');
      hrSettingsView(el);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });
}
