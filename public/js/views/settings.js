import { api } from '../api.js';
import { ctx } from '../state.js';
import { html, mount, toast, confirmDialog, downloadFile, today, WEEKDAYS } from '../ui.js';

export async function settingsView(el) {
  const [s, demo] = await Promise.all([api.get('/api/settings'), api.get('/api/admin/demo')]);
  const checked = (b) => (b ? 'checked' : '');

  mount(el, html`
    <header class="page-head"><div><h1>Settings</h1><p class="muted">Company details, default schedule and data management.</p></div></header>
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
        <p class="muted small">Pay frequency, overtime rates, government contribution rates and tax tables are in <a href="#/payroll-setup">Payroll Setup</a>, where HR Managers and Payroll Officers can also adjust them.</p>
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
      <p class="muted small">Everything is stored on this computer in <code>data/db.json</code> inside the app folder. Download a backup regularly. Medical certificates attached to leave requests are kept as files in <code>data/attachments</code> and are not in the backup file; copy that folder too.</p>
      <div class="actions">
        <button class="btn" id="backup">Download backup</button>
        <label class="btn">Restore backup… <input type="file" id="restore" accept="application/json,.json" hidden /></label>
        <button class="btn danger ghost" id="reset">Erase all data</button>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Demo data</h2>${demo.loaded ? html`<span class="badge amber">Loaded</span>` : ''}</div>
      <p class="muted">Adds sample employees with attendance, leave requests, IT assets, stock and helpdesk tickets <strong>next to your own data</strong>, so you can try features safely. Demo records are numbered DEMO-0001, DEMO-IT-0001 and so on, and nothing you entered is changed. Demo sign-in accounts hr.demo, payroll.demo, it.demo and employee.demo use the password <code>demo1234</code>.</p>
      ${demo.loaded ? html`<p class="small">Loaded now: ${demo.counts.employees} demo employees, ${demo.counts.assets} assets, ${demo.counts.inventoryItems} stock items, ${demo.counts.tickets} tickets. Demo employees are included in new payroll runs until you remove them.</p>` : ''}
      <div class="actions">
        <button class="btn" id="demo">${demo.loaded ? 'Reload demo data' : 'Add demo data'}</button>
        ${demo.loaded ? html`<button class="btn danger ghost" id="remove-demo">Remove demo data</button>` : ''}
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
    const message = demo.loaded
      ? 'The current demo records are replaced with a fresh set (changes made to demo records are lost). Your own data is not touched.'
      : 'Sample employees, attendance, leave requests, IT assets, stock and helpdesk tickets are added next to your data, plus four demo sign-in accounts (password demo1234). Your own data is not changed, and you can remove the demo records at any time.';
    if (!(await confirmDialog(message, { title: demo.loaded ? 'Reload demo data' : 'Add demo data', confirmLabel: demo.loaded ? 'Reload demo data' : 'Add demo data', danger: false }))) return;
    const res = await api.post('/api/admin/demo');
    toast(`Demo data added: ${res.counts.employees} employees, ${res.counts.assets} assets, ${res.counts.tickets} tickets. Demo accounts use the password demo1234.`);
    settingsView(el);
  });
  el.querySelector('#remove-demo')?.addEventListener('click', async () => {
    if (!(await confirmDialog('All demo employees (with their attendance, leave and payslips in draft runs), demo assets, stock, problem reports and tickets, and the demo sign-in accounts are removed. Your own records stay; real equipment lent to a demo employee goes back to stock. Finalized payroll runs are not changed.', { title: 'Remove demo data', confirmLabel: 'Remove demo data' }))) return;
    const res = await api.del('/api/admin/demo');
    toast(`Demo data removed: ${res.removed.employees} employees, ${res.removed.assets} assets, ${res.removed.tickets} tickets, ${res.removed.accounts} accounts.`);
    settingsView(el);
  });

  el.querySelector('#reset').addEventListener('click', async () => {
    if (!(await confirmDialog('Permanently erase all employees, attendance, payroll runs and settings? User accounts are kept, except demo accounts.', { confirmLabel: 'Erase everything' }))) return;
    await api.post('/api/admin/reset');
    await ctx.refreshSettings();
    toast('All data erased.');
    location.hash = '#/dashboard';
  });
}
