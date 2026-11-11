// Roles & permissions: what each account type may do, by system. Administrators tick or untick a
// permission for an account type (e.g. let deans see Finance's reports, or keep Academic settings
// with the registrar's head only); built-in defaults are marked, and each type can go back to them.
// After Moodle's "Define roles" and Frappe's Role Permission Manager.
import { api } from '../../api.js';
import { html, mount, toast, confirmDialog, badge } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { setRoleOverrides } from '/shared/roles.js';

export async function rolesView(el) {
  const d = await api.get('/api/admin/roles');
  const role = Object.fromEntries(d.roles.map((r) => [r.id, r]));
  // What is ticked now: role → Set of permissions.
  const ticked = Object.fromEntries(d.roles.map((r) => [r.id, new Set(r.permissions)]));
  const dirty = () => d.roles.some((r) => !r.fixed && [...ticked[r.id]].sort().join() !== [...r.permissions].sort().join());

  const draw = () => {
    mount(el, html`
      ${pageHead('Roles & permissions', 'What each kind of account may do in each system. Changes apply at the next page load for everyone with that kind of account.')}
      <div class="notice info">${icon('shield')}<p>Administrators always have every permission. Managing administrator accounts and replacing data stay with administrators, and Admin-panel permissions go only to accounts that use the Admin panel. Every change is recorded in the <a href="#/audit?source=settings&q=Roles">audit trail</a>, with the permissions before and after.</p></div>
      <section class="card"><h2>Account types</h2>
        <div class="table-scroll"><table class="table compact">
          <thead><tr><th>Account type</th><th>Accounts</th><th>Permissions</th><th></th></tr></thead>
          <tbody>${d.roles.filter((r) => !['student', 'guardian'].includes(r.id)).map((r) => html`<tr>
            <td data-label="Account type"><strong>${r.label}</strong>${r.changed ? html` ${badge('Changed', 'amber')}` : ''}<small class="muted block">${r.description}</small></td>
            <td data-label="Accounts">${r.accounts}</td>
            <td data-label="Permissions">${r.fixed ? 'Everything' : ticked[r.id].size}</td>
            <td class="row-actions">${r.changed ? html`<button class="btn sm" data-restore="${r.id}">Restore built-in</button>` : ''}</td></tr>`)}</tbody></table></div>
        <p class="muted small">Students and parents & guardians have no permissions to give: what they see is set under Modules and on each parent's link.</p>
      </section>
      ${d.groups.map((g) => html`<section class="card roles-group">
        <h2>${g.label}</h2>
        <div class="table-scroll"><table class="table compact no-stack matrix roles-matrix">
          <caption class="sr-only">${g.label}: which account types have each permission</caption>
          <thead><tr><th scope="col">Permission</th><th scope="col" class="center">Administrator</th>${g.roles.map((r) => html`<th scope="col" class="center">${role[r].label}</th>`)}</tr></thead>
          <tbody>${g.permissions.map((p) => html`<tr>
            <th scope="row"><span class="perm-label">${p.label}</span>${p.adminOnly ? html` ${badge('Administrators only', 'gray')}` : ''}<small class="muted block"><code>${p.id}</code></small></th>
            <td class="center">${icon('check', 16)}<span class="sr-only">always</span></td>
            ${g.roles.map((r) => {
              const builtIn = role[r].builtIn.includes(p.id);
              const on = ticked[r].has(p.id);
              const changed = on !== builtIn;
              return html`<td class="center ${changed ? 'perm-changed' : ''}"><input type="checkbox" data-role="${r}" data-perm="${p.id}" ${on ? 'checked' : ''} ${p.adminOnly ? 'disabled' : ''}
                aria-label="${role[r].label}: ${p.label}${changed ? ' (changed from the built-in)' : ''}" title="${changed ? (builtIn ? 'Built-in: on. Changed: off.' : 'Built-in: off. Changed: on.') : builtIn ? 'Built-in' : ''}" /></td>`;
            })}</tr>`)}</tbody></table></div>
      </section>`)}
      <p class="muted small"><span class="perm-changed-key"></span> A shaded box differs from the built-in setting.</p>
      <div class="actions end sticky-actions" id="save-bar" ${dirty() ? '' : 'hidden'}><span class="muted small">Unsaved changes</span><button class="btn primary" id="save">Save permissions</button></div>`);
  };
  draw();

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
      setRoleOverrides(Object.fromEntries(fresh.roles.filter((r) => r.changed).map((r) => [r.id, { add: r.permissions.filter((p) => !r.builtIn.includes(p)), remove: r.builtIn.filter((p) => !r.permissions.includes(p)) }])));
      toast(msg);
      rolesView(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  el.onclick = async (e) => {
    if (e.target.closest('#save')) {
      const changed = d.roles.filter((r) => !r.fixed && [...ticked[r.id]].sort().join() !== [...r.permissions].sort().join());
      const lost = changed.flatMap((r) => r.permissions.filter((p) => !ticked[r.id].has(p)).map(() => r)).filter((r, i, a) => a.indexOf(r) === i && r.accounts);
      if (lost.length && !(await confirmDialog(`${lost.map((r) => `${r.accounts} ${r.label} account${r.accounts === 1 ? '' : 's'}`).join(', ')} will lose permissions they have now. Save?`, { confirmLabel: 'Save', danger: false, title: 'Save permissions' }))) return;
      return saveRoles(Object.fromEntries(changed.map((r) => [r.id, [...ticked[r.id]]])), 'Permissions saved.');
    }
    const id = e.target.closest('[data-restore]')?.dataset.restore;
    if (id && (await confirmDialog(`Give ${role[id].label} accounts their built-in permissions again?`, { confirmLabel: 'Restore', danger: false, title: 'Restore built-in permissions' }))) {
      saveRoles({ [id]: role[id].builtIn }, `${role[id].label}: built-in permissions restored.`);
    }
  };
}
