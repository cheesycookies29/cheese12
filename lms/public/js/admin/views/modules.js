// Turn learning-portal modules on or off for students and for teachers.
import { api } from '../../api.js';
import { html, mount, toast } from '../../ui.js';
import { pageHead, ctx } from '../../shell.js';
import { can } from '/shared/roles.js';

const toggle = (id, role, on, disabled) => html`
  <label class="switch"><input type="checkbox" data-module="${id}" data-role="${role}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''} /><span class="track"></span><span class="state">${on ? 'On' : 'Off'}</span></label>`;

export async function modulesView(el) {
  const { modules, config } = await api.get('/api/admin/modules');
  const editable = can(ctx.user.role, 'modules.config');
  mount(el, html`
    ${pageHead('Modules', 'Choose what students and teachers get in the learning portal. A module that is off disappears from their menu and the server refuses it.')}
    ${!editable ? html`<div class="notice"><p>Only administrators can change these.</p></div>` : ''}
    <div class="card scroll-x"><table class="table no-stack">
      <thead><tr><th>Module</th><th>Students</th><th>Teachers</th></tr></thead>
      <tbody>${modules.map((m) => html`<tr class="module-row">
        <td><strong>${m.label}</strong></td>
        <td>${toggle(m.id, 'student', config[m.id]?.student !== false, !editable)}<div class="desc">${m.student}</div></td>
        <td>${toggle(m.id, 'teacher', config[m.id]?.teacher !== false, !editable)}<div class="desc">${m.teacher}</div></td>
      </tr>`)}</tbody>
    </table></div>
    <p class="hint">Changes apply the next time a student or teacher opens a page. Turning a module off never deletes anything; turning it back on shows everything again.</p>
    <p class="hint">Tip: switch <strong>Enrollment</strong> off for students outside enrollment season so only the registrar can add or drop classes.</p>`);

  el.querySelectorAll('input[data-module]').forEach((input) => input.addEventListener('change', async () => {
    const next = structuredClone(config);
    next[input.dataset.module] = { ...next[input.dataset.module], [input.dataset.role]: input.checked };
    try {
      const saved = await api.put('/api/admin/modules', { config: next });
      Object.assign(config, saved.config);
      input.parentElement.querySelector('.state').textContent = input.checked ? 'On' : 'Off';
      const m = modules.find((x) => x.id === input.dataset.module);
      toast(`${m.label} is now ${input.checked ? 'on' : 'off'} for ${input.dataset.role}s.`);
    } catch (err) {
      input.checked = !input.checked;
      toast(err.message, 'error');
    }
  }));
}
