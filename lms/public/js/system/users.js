// System → Users & Access, after CORE ERP's (public/js/views/users.js at the repository root): who
// can sign in to ATLAS and what each account type can do, on one page. Administrators see it in the
// sidebar of whichever system they have open (public/js/system/index.js).
//   - The accounts: every account in every system, with its type, linked employee, status and last
//     sign-in, and Edit, Access, Reset password, Unlock, Sign out, Audit log and Delete.
//   - Account types: what each may do, by system (changed under Roles & permissions).
import { api } from '../api.js';
import { html, mount, modal, toast, confirmDialog, badge, option, formData, initials, fmtDateTime } from '../ui.js';
import { ctx } from '../shell.js';
import { icon } from '../icons.js';
import { ROLES } from '/shared/roles.js';

const ROLE_BADGE = { admin: 'maroon', registrar: 'blue', dean: 'blue', teacher: 'green', hr: 'amber', payroll: 'amber', accountant: 'brand', budget: 'brand', cashier: 'brand', supply: 'brand', approver: 'brand', staff: 'gray', student: 'gray', guardian: 'gray' };
const when = (iso) => (iso ? html`<span title="${fmtDateTime(iso)}">${fmtDateTime(iso)}</span>` : html`<span class="muted">Never</span>`);
// Where the Admin panel is: the pages for account types live there.
const adminPage = (hash) => (location.pathname.startsWith('/admin') ? `#${hash}` : `/admin#${hash}`);

export async function usersView(el, params, q) {
  const [d, types] = await Promise.all([api.get(`/api/system/users?${new URLSearchParams(q)}`), api.get('/api/admin/roles')]);
  const reload = () => usersView(el, params, q);
  const go = (next) => (location.hash = `#/system/users?${new URLSearchParams(Object.fromEntries(Object.entries({ ...q, ...next, page: next.page || '' }).filter(([, v]) => v)))}`);

  mount(el, html`
    <header class="page-head">
      <div><h1>Users &amp; Access</h1><p class="muted">Who can sign in to ATLAS, and what each account type can do.</p></div>
      <div class="actions"><button class="btn primary" id="add-user">+ Add user</button></div>
    </header>
    <section class="card scroll-x">
      <form class="toolbar" id="filter">
        <input type="search" name="q" value="${q.q || ''}" placeholder="Search name, username, email or student number" aria-label="Search users" />
        <select name="role" aria-label="Account type">${option('', 'All account types', !q.role)}${option('staff', 'All staff', q.role === 'staff')}${d.roles.map((r) => option(r.id, r.label, q.role === r.id))}</select>
        <select name="status" aria-label="Status">${[['', 'Any status'], ['active', 'Active'], ['disabled', 'Disabled'], ['pending', 'Applied']].map(([k, l]) => option(k, l, (q.status || '') === k))}</select>
        <select name="flag" aria-label="Show">${[['', 'Everyone'], ['online', 'Signed in now'], ['locked', 'Locked'], ['own-access', 'Own access'], ['must-change', 'Temporary password'], ['sso', 'Linked to Keycloak']].map(([k, l]) => option(k, l, (q.flag || q.signin || '') === k))}</select>
        <span class="spacer"></span><span class="muted">${d.total.toLocaleString()} user${d.total === 1 ? '' : 's'}</span>
      </form>
      <table class="table users-table">
        <thead><tr><th>User</th><th>Account type</th><th>Linked employee</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>${d.users.length ? d.users.map((u) => html`<tr>
          <td data-label="User"><div class="person"><span class="avatar">${initials(u.name)}</span>
            <div><strong>${u.name}${u.id === ctx.user.id ? html` <span class="muted you">(you)</span>` : ''}</strong><small>${u.username}${u.studentNo ? ` · ${u.studentNo}` : ''}</small></div></div></td>
          <td data-label="Account type">${badge(u.roleLabel, ROLE_BADGE[u.role] || 'gray')}${u.ownAccess ? html`<small><a href="#" data-access="${u.id}">+ own access (${u.ownAccess})</a></small>` : ''}</td>
          <td data-label="Linked employee">${u.employee ? html`<a href="/hris/#/employees/${u.employee.id}">${u.employee.name}</a>` : html`<span class="muted">—</span>`}</td>
          <td data-label="Status">${u.status === 'active' ? badge('Active', 'green') : u.status === 'pending' ? badge('Applied', 'amber') : badge(u.status === 'rejected' ? 'Not admitted' : 'Disabled', 'gray')}
            ${u.mustChangePassword ? badge('Temp. password', 'amber') : ''} ${u.locked ? badge('Locked', 'red') : ''} ${u.sessions ? badge('Signed in', 'blue') : ''} ${u.sso ? badge('Keycloak', 'blue') : ''} ${u.demo ? badge('Demo', 'gray') : ''}</td>
          <td data-label="Last sign-in">${when(u.lastLoginAt)}</td>
          <td class="row-actions">
            <button class="link" data-edit="${u.id}">Edit</button>
            ${u.staff && u.role !== 'admin' && u.id !== ctx.user.id ? html`<button class="link" data-access="${u.id}">Access</button>` : ''}
            ${u.id !== ctx.user.id ? html`<button class="link" data-reset="${u.id}">Reset password</button>` : ''}
            ${u.locked ? html`<button class="link" data-unlock="${u.id}">Unlock</button>` : ''}
            ${u.sessions && u.id !== ctx.user.id ? html`<button class="link" data-signout="${u.id}">Sign out</button>` : ''}
            <a class="link" href="#/system/audit?userId=${u.id}">Audit log</a>
            ${u.id === ctx.user.id ? '' : html`<button class="link danger" data-delete="${u.id}">Delete</button>`}
          </td>
        </tr>`) : html`<tr><td colspan="6" class="muted">No user matches.</td></tr>`}</tbody>
      </table>
      ${d.pages > 1 ? html`<nav class="pager" aria-label="Pages">
        ${d.page > 1 ? html`<button class="btn sm" data-page="${d.page - 1}">${icon('chevronLeft', 14)} Previous</button>` : html`<span></span>`}
        <span class="muted small">Page ${d.page} of ${d.pages}</span>
        ${d.page < d.pages ? html`<button class="btn sm" data-page="${d.page + 1}">Next ${icon('chevronRight', 14)}</button>` : html`<span></span>`}</nav>` : ''}
    </section>
    <section class="card">
      <h2>Account types</h2>
      ${types.groups.map((g) => {
        const roles = ['admin', ...g.roles];
        return html`<details class="types-group" ${g.id === 'admin' ? 'open' : ''}><summary><strong>${g.label}</strong></summary>
          <div class="scroll-x flat"><table class="table matrix">
            <thead><tr><th>Access</th>${roles.map((r) => html`<th class="center">${ROLES[r].label}</th>`)}</tr></thead>
            <tbody>${g.permissions.map((p) => html`<tr><td>${p.label}</td>${roles.map((r) => {
              const yes = r === 'admin' || types.roles.find((x) => x.id === r)?.permissions.includes(p.id);
              return html`<td class="center">${yes ? html`<span class="yes" aria-label="Yes">✓</span>` : html`<span class="no" aria-label="No">—</span>`}</td>`;
            })}</tr>`)}</tbody></table></div></details>`;
      })}
      <p class="muted small">Administrators can do everything. Students and parents have no permissions: what they see is set by Learn modules and parent links. Change what an account type may do under <a href="${adminPage('/roles')}">Roles &amp; permissions</a>; give one person a permission more or less with <strong>Access</strong> on their row.</p>
    </section>`);

  const filter = el.querySelector('#filter');
  const apply = () => {
    const v = formData(filter);
    const online = v.flag === 'online';
    go({ q: v.q, role: v.role, status: v.status, flag: online ? '' : v.flag, signin: online ? 'online' : '' });
  };
  filter.addEventListener('submit', (e) => (e.preventDefault(), apply()));
  filter.querySelectorAll('select').forEach((s) => s.addEventListener('change', apply));
  el.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => go({ page: b.dataset.page })));

  el.querySelector('#add-user').addEventListener('click', () => addUserDialog(d, reload));
  el.querySelector('tbody').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-edit], [data-access], [data-reset], [data-unlock], [data-signout], [data-delete]');
    if (!t) return;
    e.preventDefault();
    const id = t.dataset.edit || t.dataset.access || t.dataset.reset || t.dataset.unlock || t.dataset.signout || t.dataset.delete;
    const row = d.users.find((u) => u.id === id);
    const run = async (fn, done) => {
      try {
        await fn();
        toast(done);
        reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    if (t.dataset.edit) return editDialog(await api.get(`/api/system/users/${id}`), reload);
    if (t.dataset.access) return accessDialog(await api.get(`/api/system/users/${id}`), reload);
    if (t.dataset.reset) return resetDialog(row, reload);
    if (t.dataset.unlock) return run(() => api.post(`/api/system/users/${id}/unlock`), 'Unlocked.');
    if (t.dataset.signout && (await confirmDialog(`Sign ${row.name} out everywhere? They sign in again.`, { confirmLabel: 'Sign out', title: 'Sign out' }))) return run(() => api.post(`/api/system/users/${id}/sign-out`), 'Signed out everywhere.');
    if (t.dataset.delete && (await confirmDialog(`Delete the account "${row.username}"? They will no longer be able to sign in. An account with records (enrollment, sections, changes in any system) cannot be deleted: disable it instead, so the records keep who made them.`))) return run(() => api.del(`/api/system/users/${id}`), 'User deleted.');
  });
}

// A temporary password: 14 characters, letters and digits, without look-alikes (0/O, 1/l).
function temporaryPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pick = (set) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(letters), pick(digits), ...Array.from({ length: 12 }, () => pick(letters + digits))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
const passwordInput = (label) => html`<label class="field"><span>${label}</span>
  <span class="copy-row"><input type="text" name="password" value="${temporaryPassword()}" minlength="8" required autocomplete="off" spellcheck="false" class="mono" /><button type="button" class="btn sm" data-new-pw>New</button></span>
  <small class="muted">At least 8 characters. Share it with the person privately.</small></label>`;
const wireNewPassword = () => {
  const m = [...document.querySelectorAll('.modal')].at(-1);
  m.querySelector('[data-new-pw]')?.addEventListener('click', () => (m.querySelector('[name=password]').value = temporaryPassword()));
  return m;
};
const campusChecks = (campuses, chosen) => html`<fieldset class="field span-2 plain"><span>Works at</span>
  <div class="days">${campuses.map((c) => html`<label><input type="checkbox" name="campusIds" value="${c.id}" ${chosen.includes(c.id) ? 'checked' : ''} /> ${c.name}</label>`)}</div>
  <small class="muted">Administrators reach every campus.</small></fieldset>`;
const pickedCampuses = (form) => [...form.querySelectorAll('[name=campusIds]:checked')].map((i) => i.value);
// The account type's description under its picker, as in CORE.
function wireRoleHint(m) {
  const sel = m.querySelector('[name=role]');
  const hint = m.querySelector('.role-hint');
  if (!sel || !hint) return;
  const sync = () => (hint.textContent = ROLES[sel.value]?.description || '');
  sel.addEventListener('change', sync);
  sync();
}

function addUserDialog(d, onDone) {
  modal({
    title: 'Add user',
    subtitle: 'Staff accounts of any type. Students and parents are added by the registrar (Admin panel → Students, Parents & guardians).',
    submitLabel: 'Create user',
    wide: true,
    body: html`<div class="grid two">
      <label class="field span-2"><span>Full name</span><input name="name" required /></label>
      <label class="field"><span>Username</span><input name="username" autocapitalize="none" spellcheck="false" required /></label>
      <label class="field"><span>Account type</span><select name="role">${d.roles.filter((r) => r.staff).map((r) => option(r.id, r.label, r.id === 'staff'))}</select></label>
      <p class="muted small span-2 role-hint"></p>
      <label class="field span-2"><span>Email</span><input type="email" name="email" /><small class="muted">Needed to link a teacher, registrar, dean, administrator or officer to Keycloak.</small></label>
      ${campusChecks(d.campuses, d.campuses.slice(0, 1).map((c) => c.id))}
      ${passwordInput('Temporary password')}
      <label class="field check span-2"><input type="checkbox" name="mustChangePassword" checked disabled /> <span>They choose a new password at first sign-in</span></label>
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const u = await api.post('/api/system/users', { ...v, campusIds: pickedCampuses(form), mustChangePassword: true });
      toast(`User ${u.username} created.`);
      onDone();
    },
  });
  const m = wireNewPassword();
  wireRoleHint(m);
}

function editDialog(u, onDone) {
  const me = u.id === ctx.user.id;
  modal({
    title: `Edit ${u.name}`,
    wide: true,
    body: html`<div class="grid two">
      <label class="field span-2"><span>Full name</span><input name="name" value="${u.name}" required /></label>
      <label class="field"><span>Username</span><input name="username" value="${u.username}" autocapitalize="none" spellcheck="false" required /></label>
      ${u.canChangeRole ? html`<label class="field"><span>Account type</span><select name="role" ${me ? 'disabled' : ''}>${u.assignableRoles.map((r) => option(r.id, r.label, r.id === u.role))}</select></label>
        <p class="muted small span-2 role-hint"></p>` : html`<label class="field"><span>Account type</span><input value="${u.roleLabel}" disabled /></label>`}
      <label class="field span-2"><span>Email</span><input type="email" name="email" value="${u.email}" /></label>
      ${u.canChangeRole ? html`<label class="field span-2"><span>Linked employee record <small class="muted">(optional)</small></span><select name="employeeId">${option('', '— None —', !u.employeeId)}${u.employees.map((e) => option(e.id, `${e.name}${e.no ? ` (${e.no})` : ''}`, e.id === u.employeeId))}</select>
        <small class="muted">Lets the person see their own attendance, leave and payslips in People. One account per employee.</small></label>` : ''}
      ${u.canChangeRole && u.role !== 'admin' ? campusChecks(u.allCampuses, u.campusIds) : ''}
      ${['active', 'disabled'].includes(u.status) ? html`<label class="field check span-2"><input type="checkbox" name="active" ${u.status === 'active' ? 'checked' : ''} ${me ? 'disabled' : ''} /> <span>Account is active (can sign in)</span></label>` : ''}
      ${u.sso ? html`<p class="small span-2">Linked to Keycloak as <strong>${u.ssoName || 'a Keycloak user'}</strong>. <button type="button" class="link" id="unlink">Unlink</button></p>` : ''}
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const body = { name: v.name, username: v.username, email: v.email };
      if (v.role && v.role !== u.role) body.role = v.role;
      if (form.querySelector('[name=campusIds]')) body.campusIds = pickedCampuses(form);
      if (form.querySelector('[name=employeeId]')) body.employeeId = v.employeeId || null;
      if (!me && ['active', 'disabled'].includes(u.status)) body.status = form.querySelector('[name=active]').checked ? 'active' : 'disabled';
      await api.put(`/api/system/users/${u.id}`, body);
      toast('User updated.');
      if (me) return location.reload();
      onDone();
    },
  });
  const m = [...document.querySelectorAll('.modal')].at(-1);
  wireRoleHint(m);
  m.querySelector('#unlink')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Unlink ${u.name} from Keycloak? Their sessions end; the next Keycloak sign-in links the account again by its email or username.`, { confirmLabel: 'Unlink', title: 'Unlink from Keycloak' }))) return;
    try {
      await api.post(`/api/system/users/${u.id}/unlink-sso`);
      toast('Unlinked.');
      m.closest('.modal-backdrop')?.remove();
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function resetDialog(u, onDone) {
  modal({
    title: `Reset password: ${u.name}`,
    submitLabel: 'Reset password',
    body: html`<div class="grid">${passwordInput('New temporary password')}</div>
      <p class="muted small">${u.username} will be signed out, unlocked, and asked to choose a new password the next time they sign in.</p>`,
    async onSubmit(form) {
      await api.post(`/api/system/users/${u.id}/reset-password`, { password: formData(form).password });
      toast('Password reset.');
      onDone();
    },
  });
  wireNewPassword();
}

// One person's own access (CORE's per-user grants): every permission their account type may be
// given, ticked when they have it. Shaded rows differ from the account type.
function accessDialog(u, onDone) {
  modal({
    title: `Access: ${u.name}`,
    subtitle: `What this ${u.roleLabel} may do. Shaded rows are this person's own, different from the account type; set a row back to match the type to follow it again. Changes apply at once.`,
    wide: true,
    submitLabel: 'Save access',
    body: html`<div class="access-edit">${u.accessGroups.map((g) => html`<fieldset class="plain"><legend><strong>${g.label}</strong></legend>
      ${g.permissions.map((p) => html`<label class="check-row ${p.now !== p.byType ? 'own' : ''}" data-type="${p.byType ? 1 : 0}"><input type="checkbox" name="perm" value="${p.id}" ${p.now ? 'checked' : ''} ${p.adminOnly ? 'disabled' : ''} />
        <span>${p.label}<small class="muted block">${p.adminOnly ? 'Administrators only' : p.byType ? `A ${u.roleLabel} has this` : `Not part of a ${u.roleLabel}'s access`}</small></span></label>`)}</fieldset>`)}</div>`,
    async onSubmit(form) {
      const permissions = [...form.querySelectorAll('[name=perm]:checked')].map((i) => i.value);
      await api.put(`/api/system/users/${u.id}/access`, { permissions });
      toast('Access saved.');
      onDone();
    },
  });
  [...document.querySelectorAll('.modal .access-edit')].at(-1).addEventListener('change', (e) => {
    const row = e.target.closest('.check-row');
    if (row) row.classList.toggle('own', e.target.checked !== (row.dataset.type === '1'));
  });
}
