// Admin panel → Modules: turn each live module on or off for the company, as ATLAS does per audience.
// A module that is off disappears from the CORE home, the module switcher and the menus, and the
// server refuses its API, for everyone but administrators (who see it marked Off). Nothing is deleted.
import { api } from '../../api.js';
import { ctx, can } from '../../state.js';
import { html, mount, toast, confirmDialog } from '../../ui.js';
import { icon } from '../../icons.js';
import { MODULES, SWITCHABLE, MODULE_PARTS } from '/shared/modules.js';
import { pageHead } from './common.js';

export async function modulesView(el) {
  const { config } = await api.get('/api/admin/modules');
  const editable = can('modules.config');
  const live = MODULES.filter((m) => SWITCHABLE.includes(m.id));
  mount(el, html`
    ${pageHead('Modules', 'Choose which modules the company uses. A module that is off disappears from the CORE home, the module switcher and the menus, and CORE refuses it, for everyone except administrators.')}
    <div class="card scroll-x"><table class="table">
      <thead><tr><th>Module</th><th>For the company</th><th>What turning it off takes away</th></tr></thead>
      <tbody>${live.map((m) => html`<tr class="module-row">
        <td><span class="mod-name"><span class="mod-ic">${icon(m.glyph, 18)}</span><span><strong>${m.name}</strong><small class="muted block">${m.code}</small></span></span></td>
        <td><label class="switch"><input type="checkbox" data-module="${m.id}" ${config[m.id] !== false ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="${m.name}" /> <span class="state">${config[m.id] !== false ? 'On' : 'Off'}</span></label></td>
        <td><div class="desc">${MODULE_PARTS[m.id]}</div></td>
      </tr>`)}</tbody>
    </table></div>
    <p class="muted small page-note">Turning a module off never deletes anything: its records, settings and files stay, and turning it back on shows everything again. While it is off, administrators still see it (marked <strong>Off</strong>) and can open its settings; its background work (reading the service desk mailbox, the Projects daily digest) waits. Changes apply the next time someone opens a page.</p>
    <p class="muted small page-note">Self-service belongs to the module it is part of: with <strong>HR & Payroll</strong> off, employees no longer clock in or out, file leave or see payslips in CORE; My Assets and My tickets stay with their modules. The holiday calendar stays visible, because Projects counts working days by it.</p>`);

  el.querySelectorAll('input[data-module]').forEach((input) => input.addEventListener('change', async () => {
    const m = live.find((x) => x.id === input.dataset.module);
    if (!input.checked && !(await confirmDialog(`Turn ${m.name} off for the company? Nobody but administrators can open it until it is turned on again. Nothing is deleted.`, { confirmLabel: `Turn ${m.name} off`, title: 'Turn a module off' }))) {
      input.checked = true;
      return;
    }
    try {
      const saved = await api.put('/api/admin/modules', { modules: { [m.id]: input.checked } });
      Object.assign(config, saved.config);
      ctx.modules = saved.config;
      input.closest('label').querySelector('.state').textContent = input.checked ? 'On' : 'Off';
      window.dispatchEvent(new Event('modules:changed'));
      toast(`${m.name} is now ${input.checked ? 'on' : 'off'} for the company.`);
    } catch (err) {
      input.checked = !input.checked;
      toast(err.message, 'error');
    }
  }));
}
