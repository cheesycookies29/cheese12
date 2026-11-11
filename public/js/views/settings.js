import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { html, mount, toast, confirmDialog, modal, downloadFile, today, WEEKDAYS } from '../ui.js';

export async function settingsView(el) {
  const [s, demo, security] = await Promise.all([api.get('/api/settings'), api.get('/api/admin/demo'), can('users.manage') ? api.get('/api/security-settings') : null]);
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

    ${security ? html`<form id="security-form" class="card" novalidate>
      <h2>Sign-in &amp; security</h2>
      <p class="muted small">Who must use 2-step verification, how long people stay signed in, and the limits that slow down password guessing and floods of requests. Each person sets up 2-step verification under their name → <strong>My security</strong>.</p>
      <div class="grid">
        <label class="field span-3"><span>2-step verification</span>
          <select name="twoFactor">${Object.entries(security.policies).map(([k, v]) => html`<option value="${k}" ${security.twoFactor === k ? 'selected' : ''}>${v}</option>`)}</select>
          <small class="muted">When required, people without it set it up the next time they sign in. Turn it on for your own account first.</small></label>
        <label class="field"><span>Sign out after (idle minutes)</span><input type="number" name="sessionIdleMinutes" min="5" max="1440" value="${security.sessionIdleMinutes}" /><small class="muted">Without using CORE. 480 = 8 hours.</small></label>
        <label class="field"><span>Longest session (hours)</span><input type="number" name="sessionMaxHours" min="1" max="720" value="${security.sessionMaxHours}" /><small class="muted">Then sign in again, even if in use.</small></label>
        <label class="field"><span>Requests per minute, per person</span><input type="number" name="requestsPerMinute" min="60" max="5000" value="${security.requestsPerMinute}" /><small class="muted">More than this is refused for a moment. 300 is plenty for normal use.</small></label>
        <label class="field"><span>Failed sign-ins per network address</span><input type="number" name="signInFailuresPerAddress" min="5" max="1000" value="${security.signInFailuresPerAddress}" /><small class="muted">In 15 minutes, any usernames. Then that address waits. An office behind one address may need more.</small></label>
        <label class="field check span-2"><input type="checkbox" name="blockCommonPasswords" ${checked(security.blockCommonPasswords)} /> <span>Refuse common passwords and passwords with the username or name</span></label>
      </div>
      <p class="muted small">Always on: a username is locked for 5, then 15, then 60 minutes after 5 wrong passwords in a row; changing a password, a role or 2-step verification signs the account out elsewhere; every sign-in, failure and lock is in the <a href="#/audit">Audit log</a>.</p>
      <p class="form-error" hidden></p>
      <div class="actions end"><button class="btn primary" type="submit">Save sign-in settings</button></div>
    </form>` : ''}

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
      <p class="muted">Adds sample employees with attendance, leave requests, IT assets, stock, helpdesk tickets and Sales & CRM records <strong>next to your own data</strong>, so you can try features safely. Demo records are numbered DEMO-0001, DEMO-IT-0001 and so on, and nothing you entered is changed. Demo sign-in accounts hr.demo, payroll.demo, it.demo, sales.demo and employee.demo use the password <code>demo1234</code>.</p>
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

  el.querySelector('#security-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const errEl = f.querySelector('.form-error');
    try {
      await api.put('/api/security-settings', {
        twoFactor: f.twoFactor.value, sessionIdleMinutes: Number(f.sessionIdleMinutes.value), sessionMaxHours: Number(f.sessionMaxHours.value),
        requestsPerMinute: Number(f.requestsPerMinute.value), signInFailuresPerAddress: Number(f.signInFailuresPerAddress.value),
        blockCommonPasswords: f.blockCommonPasswords.checked,
      });
      errEl.hidden = true;
      toast('Sign-in settings saved.');
    } catch (err) {
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
    if (!file) return;
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      return toast('That file is not valid JSON.', 'error');
    }
    // A restore replaces everything, the accounts included, so it asks for the password again.
    const { form } = modal({
      title: 'Restore backup',
      body: html`<p>Replace ALL current data with this backup? The user accounts in the backup replace the current ones.</p>
        <label class="field"><span>Your password</span><input type="password" name="password" autocomplete="current-password" required /></label>`,
      submitLabel: 'Restore',
      onSubmit: async (f) => {
        await api.post('/api/admin/import', { ...backup, password: f.password.value });
        await ctx.refreshSettings();
        toast('Backup restored.');
        location.hash = '#/dashboard';
      },
    });
    form.querySelector('[type=submit]').classList.add('danger');
  });

  el.querySelector('#demo').addEventListener('click', async () => {
    const message = demo.loaded
      ? 'The current demo records are replaced with a fresh set (changes made to demo records are lost). Your own data is not touched.'
      : 'Sample employees, attendance, leave requests, IT assets, stock, helpdesk tickets and Sales & CRM records are added next to your data, plus five demo sign-in accounts (password demo1234). Your own data is not changed, and you can remove the demo records at any time.';
    if (!(await confirmDialog(message, { title: demo.loaded ? 'Reload demo data' : 'Add demo data', confirmLabel: demo.loaded ? 'Reload demo data' : 'Add demo data', danger: false }))) return;
    const res = await api.post('/api/admin/demo');
    toast(`Demo data added: ${res.counts.employees} employees, ${res.counts.assets} assets, ${res.counts.tickets} tickets. Demo accounts use the password demo1234.`);
    settingsView(el);
  });
  el.querySelector('#remove-demo')?.addEventListener('click', async () => {
    if (!(await confirmDialog('All demo employees (with their attendance, leave and payslips in draft runs), demo assets, stock, problem reports and tickets, and the demo sign-in accounts are removed. So are the demo sales records. Your own records stay, and a demo organization that your own sales records use stays as a real account; real equipment lent to a demo employee goes back to stock. Finalized payroll runs are not changed.', { title: 'Remove demo data', confirmLabel: 'Remove demo data' }))) return;
    const res = await api.del('/api/admin/demo');
    toast(`Demo data removed: ${res.removed.employees} employees, ${res.removed.assets} assets, ${res.removed.tickets} tickets, ${res.removed.accounts} accounts.`);
    settingsView(el);
  });

  el.querySelector('#reset').addEventListener('click', async () => {
    if (!(await confirmDialog('Permanently erase all company data: employees, attendance, leave, payroll runs, IT assets and stock, service desk tickets, Sales & CRM records and settings? User accounts are kept (except demo accounts), and so are the audit log, the dev log, feedback, guide edits, the service desk mail setup and the sales setup.', { confirmLabel: 'Erase everything' }))) return;
    await api.post('/api/admin/reset');
    await ctx.refreshSettings();
    toast('All data erased.');
    location.hash = '#/dashboard';
  });
}
