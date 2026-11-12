// Admin panel → Backup & restore (with Erase all data) and Demo data: the controls that were under
// Settings → Data and Demo data, moved here unchanged.
import { api } from '../../api.js';
import { ctx } from '../../state.js';
import { html, mount, toast, confirmDialog, modal, downloadFile, today, badge } from '../../ui.js';
import { icon } from '../../icons.js';
import { pageHead, timeAgo, fmtDateTime } from './common.js';

export async function dataView(el) {
  const d = await api.get('/api/admin/dashboard');
  const last = d.data?.lastBackupAt;
  mount(el, html`
    ${pageHead('Backup & restore', 'Download all the company\'s data as one file, put a backup back, or erase everything.')}
    <section class="card">
      <h2>${icon('download')} Backup</h2>
      <p>Everything is stored on the computer CORE runs on, in <code>data/db.json</code>. Download a backup regularly and keep it somewhere safe and private: it holds pay, government IDs, bank accounts and the user accounts (passwords as secure hashes).</p>
      <p class="muted small">Attached files (medical certificates, ticket and project files) are kept in <code>data/attachments</code>, and the audit log in <code>data/audit-log.jsonl</code>: they are not in the backup file, so copy the <code>data</code> folder too.</p>
      <p class="small">Last backup downloaded: ${last ? html`<strong title="${fmtDateTime(last)}">${timeAgo(last)}</strong>${d.data.lastBackupBy ? `, by ${d.data.lastBackupBy}` : ''}` : html`<strong class="warn">never, from this server</strong>`}</p>
      <div class="actions">
        <button type="button" class="btn primary" id="backup">${icon('download', 16)} Download backup</button>
        <label class="btn">${icon('upload', 16)} Restore backup… <input type="file" id="restore" accept="application/json,.json" hidden /></label>
      </div>
    </section>
    <section class="card erase-card">
      <h2>${icon('alert')} Erase all data</h2>
      <p>Permanently removes all employees, attendance, leave, payroll runs, IT assets and stock, service desk tickets, Sales & CRM records, projects and the company settings. User accounts are kept (except demo accounts), and so are the audit log, the dev log, feedback, guide edits, the service desk mail setup, the sales setup, roles & permissions and which modules are on. Download a backup first.</p>
      <div class="actions"><button type="button" class="btn danger ghost" id="reset">Erase all data</button></div>
    </section>`);

  el.querySelector('#backup').addEventListener('click', async () => {
    const data = await api.get('/api/admin/export');
    downloadFile(`core-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('Backup downloaded.');
    dataView(el);
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
        await Promise.all([ctx.refreshSettings(), ctx.refreshStatus()]);
        toast('Backup restored.');
        location.hash = '#/launcher';
      },
    });
    form.querySelector('[type=submit]').classList.add('danger');
  });

  el.querySelector('#reset').addEventListener('click', async () => {
    if (!(await confirmDialog('Permanently erase all company data: employees, attendance, leave, payroll runs, IT assets and stock, service desk tickets, Sales & CRM records, projects and settings? User accounts are kept (except demo accounts), and so are the audit log, the dev log, feedback, guide edits, the service desk mail setup and the sales setup.', { confirmLabel: 'Erase everything' }))) return;
    await api.post('/api/admin/reset');
    await Promise.all([ctx.refreshSettings(), ctx.refreshStatus()]);
    toast('All data erased.');
    location.hash = '#/launcher';
  });
}

export async function demoView(el) {
  const demo = await api.get('/api/admin/demo');
  mount(el, html`
    ${pageHead('Demo data', 'Sample records to try CORE safely, next to your own data.')}
    <section class="card">
      <div class="card-head"><h2>${icon('sparkle')} Demo data</h2>${demo.loaded ? badge('Loaded', 'amber') : badge('Not loaded', 'gray')}</div>
      <p>Adds sample employees with attendance, leave requests, IT assets, stock, service desk tickets, Sales & CRM records and projects <strong>next to your own data</strong>. Demo records are numbered DEMO-0001, DEMO-IT-0001 and so on, and nothing you entered is changed. The demo sign-in accounts <code>hr.demo</code>, <code>payroll.demo</code>, <code>it.demo</code>, <code>sales.demo</code>, <code>pm.demo</code> and <code>employee.demo</code> use the password <code>demo1234</code>.</p>
      ${demo.loaded ? html`<p class="small">Loaded now: ${demo.counts.employees} demo employees, ${demo.counts.assets} assets, ${demo.counts.inventoryItems} stock items, ${demo.counts.tickets} tickets. Demo employees are included in new payroll runs until you remove them, so remove the demo data before the first real payroll.</p>` : ''}
      <div class="actions">
        <button type="button" class="btn" id="demo">${demo.loaded ? 'Reload demo data' : 'Add demo data'}</button>
        ${demo.loaded ? html`<button type="button" class="btn danger ghost" id="remove-demo">Remove demo data</button>` : ''}
      </div>
    </section>`);

  el.querySelector('#demo').addEventListener('click', async () => {
    const message = demo.loaded
      ? 'The current demo records are replaced with a fresh set (changes made to demo records are lost). Your own data is not touched.'
      : 'Sample employees, attendance, leave requests, IT assets, stock, service desk tickets, Sales & CRM records and projects are added next to your data, plus six demo sign-in accounts (password demo1234). Your own data is not changed, and you can remove the demo records at any time.';
    if (!(await confirmDialog(message, { title: demo.loaded ? 'Reload demo data' : 'Add demo data', confirmLabel: demo.loaded ? 'Reload demo data' : 'Add demo data', danger: false }))) return;
    const res = await api.post('/api/admin/demo');
    toast(`Demo data added: ${res.counts.employees} employees, ${res.counts.assets} assets, ${res.counts.tickets} tickets. Demo accounts use the password demo1234.`);
    demoView(el);
  });
  el.querySelector('#remove-demo')?.addEventListener('click', async () => {
    if (!(await confirmDialog('All demo employees (with their attendance, leave and payslips in draft runs), demo assets, stock, problem reports and tickets, and the demo sign-in accounts are removed. So are the demo sales records and projects. Your own records stay, and a demo organization that your own sales records use stays as a real account; real equipment lent to a demo employee goes back to stock. Finalized payroll runs are not changed.', { title: 'Remove demo data', confirmLabel: 'Remove demo data' }))) return;
    const res = await api.del('/api/admin/demo');
    toast(`Demo data removed: ${res.removed.employees} employees, ${res.removed.assets} assets, ${res.removed.tickets} tickets, ${res.removed.accounts} accounts.`);
    demoView(el);
  });
}
