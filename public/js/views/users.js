import { api } from '../api.js';
import { ctx, roleLabel } from '../state.js';
import { ROLES, PERMISSION_LABELS, can as roleCan } from '/shared/roles.js';
import { html, mount, badge, toast, modal, confirmDialog } from '../ui.js';

const ROLE_BADGE = { admin: 'maroon', hr: 'blue', payroll: 'amber', it: 'green', support: 'maroon-soft', employee: 'gray' };

function fmtWhen(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function userForm(user, employees, isNew) {
  const role = user.role || 'employee';
  return html`
    <div class="grid two">
      <label class="field span-2"><span>Full name</span><input name="name" value="${user.name || ''}" required /></label>
      <label class="field"><span>Username</span><input name="username" value="${user.username || ''}" autocapitalize="none" spellcheck="false" required /></label>
      <label class="field"><span>Account type</span>
        <select name="role" ${user.id === ctx.user.id ? 'disabled' : ''}>${Object.entries(ROLES).map(([key, r]) => html`<option value="${key}" ${key === role ? 'selected' : ''}>${r.label}</option>`)}</select>
      </label>
      <p class="muted small span-2 role-hint"></p>
      <label class="field span-2"><span>Linked employee record <small class="muted link-note"></small></span>
        <select name="employeeId">
          <option value="">— None —</option>
          ${employees.map((e) => html`<option value="${e.id}" ${e.id === user.employeeId ? 'selected' : ''}>${e.lastName}, ${e.firstName} (${e.employeeNo})</option>`)}
        </select>
        <small class="muted">Lets the person see their own attendance and payslips.</small>
      </label>
      ${isNew
        ? html`
          <label class="field"><span>Temporary password</span><input type="text" name="password" autocomplete="off" required /><small class="muted">At least 8 characters. Share it with the person privately.</small></label>
          <label class="field check span-2"><input type="checkbox" name="mustChangePassword" checked /> <span>Ask them to choose a new password at first sign-in</span></label>`
        : html`<label class="field check span-2"><input type="checkbox" name="active" ${user.active ? 'checked' : ''} ${user.id === ctx.user.id ? 'disabled' : ''} /> <span>Account is active (can sign in)</span></label>`}
    </div>`;
}

function wireRoleHints(form) {
  const roleSel = form.querySelector('[name=role]');
  const sync = () => {
    form.querySelector('.role-hint').textContent = ROLES[roleSel.value].description;
    form.querySelector('.link-note').textContent = roleSel.value === 'employee' ? '(required)' : '(optional)';
  };
  roleSel.addEventListener('change', sync);
  sync();
}

export async function usersView(el) {
  const [users, employees] = await Promise.all([api.get('/api/users'), api.get('/api/employees')]);
  employees.sort((a, b) => a.lastName.localeCompare(b.lastName));
  const empById = new Map(employees.map((e) => [e.id, e]));
  const reload = () => usersView(el);
  users.sort((a, b) => Object.keys(ROLES).indexOf(a.role) - Object.keys(ROLES).indexOf(b.role) || a.name.localeCompare(b.name));

  mount(el, html`
    <header class="page-head">
      <div><h1>Users &amp; Access</h1><p class="muted">Who can sign in, and what each account type can do.</p></div>
      <div class="actions"><button class="btn primary" id="add-user">+ Add user</button></div>
    </header>
    <section class="card scroll-x">
      <table class="table">
        <thead><tr><th>User</th><th>Account type</th><th>Linked employee</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>${users.map((u) => {
          const emp = empById.get(u.employeeId);
          return html`<tr>
            <td><div class="person"><span class="avatar">${u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
              <div><strong>${u.name}${u.id === ctx.user.id ? html` <span class="muted you">(you)</span>` : ''}</strong><small>${u.username}</small></div></div></td>
            <td>${badge(roleLabel(u.role), ROLE_BADGE[u.role])}${u.role !== 'admin' && typeof u.helpdeskAgent === 'boolean' ? html`<small><a href="#/helpdesk/settings?tab=agents">${u.helpdeskAgent ? '+ Helpdesk agent' : 'Helpdesk agent access removed'}</a></small>` : ''}</td>
            <td>${emp ? html`<a href="#/employees/${emp.id}">${emp.firstName} ${emp.lastName}</a>` : html`<span class="muted">—</span>`}</td>
            <td>${u.active ? badge('Active', 'green') : badge('Disabled', 'gray')} ${u.mustChangePassword ? badge('Temp. password', 'amber') : ''} ${u.demo ? badge('Demo', 'gray') : ''}</td>
            <td>${fmtWhen(u.lastLoginAt)}</td>
            <td class="row-actions">
              <button class="link" data-edit="${u.id}">Edit</button>
              <button class="link" data-reset="${u.id}">Reset password</button>
              ${u.id === ctx.user.id ? '' : html`<button class="link danger" data-delete="${u.id}">Delete</button>`}
            </td>
          </tr>`;
        })}</tbody>
      </table>
    </section>
    <section class="card">
      <h2>Account types</h2>
      <div class="scroll-x flat">
        <table class="table matrix">
          <thead><tr><th>Access</th>${Object.values(ROLES).map((r) => html`<th class="center">${r.label}</th>`)}</tr></thead>
          <tbody>${PERMISSION_LABELS.map(([perm, label]) => html`<tr><td>${label}</td>${Object.keys(ROLES).map((role) => html`<td class="center">${roleCan(role, perm) ? html`<span class="yes" aria-label="Yes">✓</span>` : html`<span class="no" aria-label="No">—</span>`}</td>`)}</tr>`)}</tbody>
        </table>
      </div>
      <p class="muted small">HR Managers and Payroll Officers linked to an employee record also get the “My account” pages.</p>
    </section>`);

  el.querySelector('#add-user').addEventListener('click', () => {
    const { form } = modal({
      title: 'Add user',
      submitLabel: 'Create user',
      body: userForm({}, employees, true),
      onSubmit: async (f) => {
        const fd = new FormData(f);
        await api.post('/api/users', {
          name: fd.get('name'), username: fd.get('username'), role: fd.get('role'), employeeId: fd.get('employeeId'),
          password: fd.get('password'), mustChangePassword: fd.has('mustChangePassword'),
        });
        toast(`User ${fd.get('username')} created.`);
        reload();
      },
    });
    wireRoleHints(form);
    // Pre-fill the name when an employee is picked first.
    form.querySelector('[name=employeeId]').addEventListener('change', (e) => {
      const emp = empById.get(e.target.value);
      const name = form.querySelector('[name=name]');
      if (emp && !name.value) name.value = `${emp.firstName} ${emp.lastName}`;
    });
  });

  el.querySelector('tbody').addEventListener('click', async (e) => {
    const t = e.target;
    const user = users.find((u) => u.id === (t.dataset.edit || t.dataset.reset || t.dataset.delete));
    if (!user) return;

    if (t.dataset.edit) {
      const { form } = modal({
        title: `Edit ${user.name}`,
        body: userForm(user, employees, false),
        onSubmit: async (f) => {
          const fd = new FormData(f);
          await api.put(`/api/users/${user.id}`, {
            name: fd.get('name'), username: fd.get('username'), employeeId: fd.get('employeeId'),
            role: user.id === ctx.user.id ? user.role : fd.get('role'),
            active: user.id === ctx.user.id ? true : fd.has('active'),
          });
          toast('User updated.');
          if (user.id === ctx.user.id) return location.reload();
          reload();
        },
      });
      wireRoleHints(form);
    }

    if (t.dataset.reset) {
      modal({
        title: `Reset password: ${user.name}`,
        submitLabel: 'Reset password',
        body: html`<label class="field"><span>New temporary password</span><input type="text" name="password" autocomplete="off" required /></label>
          <p class="muted small">${user.username} will be signed out and asked to choose a new password the next time they sign in.</p>`,
        onSubmit: async (f) => {
          await api.post(`/api/users/${user.id}/reset-password`, { password: new FormData(f).get('password') });
          toast('Password reset.');
          reload();
        },
      });
    }

    if (t.dataset.delete && (await confirmDialog(`Delete the account "${user.username}"? They will no longer be able to sign in. Their employee record is not affected.`))) {
      try {
        await api.del(`/api/users/${user.id}`);
        toast('User deleted.');
        reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
}
