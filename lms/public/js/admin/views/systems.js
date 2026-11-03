// Admin: the systems on the University Portal. The LMS is built in; HRIS, FMIS and UIS
// show as "Coming soon" until an administrator switches them on with their address.
import { api } from '../../api.js';
import { html, mount, toast } from '../../ui.js';
import { pageHead, ctx } from '../../shell.js';
import { can, roleLabel } from '/shared/roles.js';
import { icon } from '../../icons.js';

const STATUS = [['soon', 'Coming soon (greyed out)'], ['live', 'Live: open it from the portal'], ['hidden', 'Hidden']];

export async function systemsView(el) {
  const { systems, settings } = await api.get('/api/admin/systems');
  const editable = can(ctx.user.role, 'settings.edit');
  mount(el, html`
    ${pageHead('Portal & systems', html`Everyone signs in once at the <a href="/" target="_blank" rel="noopener">University Portal</a> and sees a tile for each system they may use.`)}
    <form id="systems" class="stack">
      ${systems.map((s) => html`<section class="card">
        <div class="card-head"><h2><span class="item-ic">${icon(s.icon)}</span> ${s.name} <span class="muted" style="font-weight:500">${s.title}</span></h2>
          ${s.builtIn ? html`<span class="badge green">Live · built in</span>` : ''}</div>
        <p class="muted" style="margin:-4px 0 12px">${s.description}</p>
        <p class="hint" style="margin-bottom:12px">Shown to: ${s.audience.map((r) => roleLabel(r)).join(', ')}.</p>
        ${s.builtIn
          ? html`<p class="small">${s.id === 'lms'
            ? html`Students and teachers open the learning portal (<code>/lms/</code>); administrators and registrars open this admin panel.`
            : html`Runs at <code>${s.path}</code>. HR managers and payroll officers get its HR screens; anyone with an employee record (teachers, registrars, staff) gets self-service. Accounts for HR, payroll and staff are made in the HRIS, on an employee's record.`}</p>`
          : html`<div class="grid">
              <label class="field"><span>Status</span><select name="${s.id}-status" ${editable ? '' : 'disabled'}>${STATUS.map(([k, l]) => html`<option value="${k}" ${settings[s.id]?.status === k ? 'selected' : ''}>${l}</option>`)}</select></label>
              <label class="field span-2"><span>Address</span><input name="${s.id}-url" value="${settings[s.id]?.url || ''}" placeholder="https://${s.id}.example.edu or /${s.id}/" ${editable ? '' : 'disabled'} /><span class="hint">Where the system runs. Until single sign-on is connected, people sign in to it separately.</span></label>
            </div>`}
      </section>`)}
      ${editable ? html`<div class="actions end"><button class="btn primary" type="submit">Save</button></div>` : html`<div class="notice">${icon('lock')}<p>Only administrators can change these.</p></div>`}
    </form>`);
  el.querySelector('#systems').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    const next = Object.fromEntries(systems.filter((s) => !s.builtIn).map((s) => [s.id, { status: v[`${s.id}-status`], url: v[`${s.id}-url`] }]));
    try {
      await api.put('/api/admin/systems', { settings: next });
      toast('Saved. The portal shows the change right away.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
