// Admin panel → Roles & permissions (administrators only): what each account type may do. Tick or
// untick a permission for an account type; the built-in setting is marked, and each type can go back
// to it. Ported from Lancaster ATLAS (lms/public/js/admin/views/roles.js).
import { api } from '../../api.js';
import { ctx } from '../../state.js';
import { html, mount, toast, confirmDialog, badge } from '../../ui.js';
import { icon } from '../../icons.js';
import { setRoleOverrides } from '/shared/roles.js';
import { pageHead } from './common.js';

export async function rolesView(el) {
  const d = await api.get('/api/admin/roles');
  const role = Object.fromEntries(d.roles.map((r) => [r.id, r]));
  const editable = d.roles.filter((r) => !r.fixed);
  // What is ticked now: role → Set of permissions.
  const ticked = Object.fromEntries(d.roles.map((r) => [r.id, new Set(r.permissions)]));
  const key = (list) => [...list].sort().join();
  const dirty = () => editable.some((r) => key(ticked[r.id]) !== key(r.permissions));

  mount(el, html`
    ${pageHead('Roles & permissions', 'What each account type may do. A change applies to everyone with that account type the next time they open a page.')}
    <div class="notice info">${icon('shield')}<p>Administrators always have every permission. Managing user accounts and sign-in security, changing roles, and backing up or replacing data stay with administrators. Access given to one person (<a href="#/admin/access">Access grants</a>) still applies on top. Every change is in the <a href="#/admin/config?tab=history&area=roles">Settings center's history</a> and the <a href="#/admin/audit?area=settings">audit log</a>.</p></div>
    <section class="card"><h2>Account types</h2>
      <div class="scroll-x flat"><table class="table">
        <thead><tr><th>Account type</th><th>Active accounts</th><th>Permissions</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${d.roles.map((r) => html`<tr>
          <td><strong>${r.label}</strong>${r.changed ? html` ${badge('Changed', 'amber')}` : ''}<small class="muted block">${r.description}</small></td>
          <td>${r.accounts}</td>
          <td>${r.fixed ? 'Everything' : ticked[r.id].size}</td>
          <td class="row-actions">${r.changed ? html`<button type="button" class="btn sm" data-restore="${r.id}">Restore defaults</button>` : ''}</td></tr>`)}</tbody></table></div>
    </section>
    ${d.groups.map((g) => html`<section class="card roles-group">
      <h2>${g.label}</h2>
      <div class="table-scroll"><table class="table no-stack matrix roles-matrix">
        <caption class="sr-only">${g.label}: which account types have each permission</caption>
        <thead><tr><th scope="col">Permission</th><th scope="col" class="center">Administrator</th>${editable.map((r) => html`<th scope="col" class="center">${r.label}</th>`)}</tr></thead>
        <tbody>${g.permissions.map((p) => html`<tr>
          <th scope="row"><span class="perm-label">${p.label}</span>${p.adminOnly ? html` ${badge('Administrators only', 'gray')}` : ''}<small class="muted block"><code>${p.id}</code></small></th>
          <td class="center">${icon('check', 16)}<span class="sr-only">always</span></td>
          ${editable.map((r) => {
            const builtIn = r.builtIn.includes(p.id);
            const on = ticked[r.id].has(p.id);
            const changed = on !== builtIn;
            const locked = p.adminOnly && !builtIn;
            return html`<td class="center ${changed ? 'perm-changed' : ''}"><label class="perm-box"><input type="checkbox" data-role="${r.id}" data-perm="${p.id}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''}
              aria-label="${r.label}: ${p.label}${builtIn ? ' (default: yes)' : ' (default: no)'}" title="${locked ? 'Stays with administrators' : changed ? (builtIn ? 'Default: on. Changed: off.' : 'Default: off. Changed: on.') : builtIn ? 'Default' : ''}" />${builtIn ? html`<span class="perm-default" aria-hidden="true">default</span>` : ''}</label></td>`;
          })}</tr>`)}</tbody></table></div>
    </section>`)}
    <p class="muted small"><span class="perm-changed-key"></span> A shaded box differs from the default. <em>default</em> marks what CORE gives that account type.</p>
    <div class="actions end sticky-actions" id="save-bar" hidden><span class="muted small">Unsaved changes</span><button type="button" class="btn" id="discard">Discard</button><button type="button" class="btn primary" id="save">Save permissions</button></div>`);

  el.onchange = (e) => {
    const box = e.target.closest('[data-perm]');
    if (!box) return;
    ticked[box.dataset.role][box.checked ? 'add' : 'delete'](box.dataset.perm);
    const builtIn = role[box.dataset.role].builtIn.includes(box.dataset.perm);
    box.closest('td').classList.toggle('perm-changed', box.checked !== builtIn);
    el.querySelector('#save-bar').hidden = !dirty();
  };
  const saveRoles = async (permissions, msg) => {
    try {
      const fresh = await api.put('/api/admin/roles', { permissions });
      // This browser follows at once; everyone else at their next page.
      setRoleOverrides(Object.fromEntries(fresh.roles.filter((r) => r.changed).map((r) => [r.id, { add: r.permissions.filter((p) => !r.builtIn.includes(p)), remove: r.builtIn.filter((p) => !r.permissions.includes(p)) }])));
      await ctx.refreshStatus().catch(() => {});
      toast(msg);
      rolesView(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  el.onclick = async (e) => {
    if (e.target.closest('#discard')) return rolesView(el);
    if (e.target.closest('#save')) {
      const changed = editable.filter((r) => key(ticked[r.id]) !== key(r.permissions));
      const losing = changed.filter((r) => r.accounts && r.permissions.some((p) => !ticked[r.id].has(p)));
      if (losing.length && !(await confirmDialog(`${losing.map((r) => `${r.accounts} ${r.label} account${r.accounts === 1 ? '' : 's'}`).join(', ')} will lose permissions they have now. Save?`, { confirmLabel: 'Save', danger: false, title: 'Save permissions' }))) return;
      return saveRoles(Object.fromEntries(changed.map((r) => [r.id, [...ticked[r.id]]])), 'Permissions saved.');
    }
    const id = e.target.closest('[data-restore]')?.dataset.restore;
    if (id && (await confirmDialog(`Give ${role[id].label} accounts their default permissions again?`, { confirmLabel: 'Restore defaults', danger: false, title: 'Restore default permissions' }))) {
      saveRoles({ [id]: role[id].builtIn }, `${role[id].label}: default permissions restored.`);
    }
  };
}
