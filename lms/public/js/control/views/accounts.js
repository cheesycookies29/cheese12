// Control → Accounts: every account in every system in one list, and one account's page: what it
// can open, its sessions and its trail, with the administrator's actions on it.
import { api } from '../../api.js';
import { html, mount, modal, toast, confirmDialog, badge, option, formData, fmtDateTime } from '../../ui.js';
import { pageHead, ctx } from '../../shell.js';
import { icon } from '../../icons.js';
import { when, statusBadge, browserOf, pager, wireFilter, trailHead, trailRow } from '../common.js';

const SIGNIN = [['', 'Any sign-in'], ['online', 'Signed in now'], ['never', 'Never signed in'], ['stale', 'Staff, not in 90 days']];
const FLAGS = [['', 'Anything'], ['locked', 'Locked'], ['must-change', 'Must change password'], ['sso', 'Linked to Keycloak']];
const SORTS = [['name', 'Name'], ['recent', 'Last sign-in'], ['role', 'Account type'], ['created', 'Newest']];

export async function accountsView(el, params, q) {
  const d = await api.get(`/api/control/users?${new URLSearchParams(q)}`);
  const flags = (u) => [
    u.sessions ? badge(`Signed in${u.sessions > 1 ? ` ×${u.sessions}` : ''}`, 'green') : '',
    u.locked ? badge('Locked', 'red') : '',
    u.sso ? badge('Keycloak', 'blue') : '',
    u.mustChangePassword ? badge('New password due', 'amber') : '',
  ];
  mount(el, html`
    ${pageHead('Accounts', 'Every account in every system: students, parents, teachers and staff. Open one to see what it can reach, its sessions and its trail.', html`<button class="btn primary" id="add">${icon('userPlus', 16)} New staff account</button>`)}
    <form class="toolbar filters" id="filter">
      <input type="search" name="q" value="${q.q || ''}" placeholder="Name, username, email or student number" aria-label="Search accounts" />
      <select name="role" aria-label="Account type">${option('', 'Every account type', !q.role)}${option('staff', 'All staff', q.role === 'staff')}${d.roles.map((r) => option(r.id, r.label, q.role === r.id))}</select>
      <select name="status" aria-label="Status">${[['', 'Any status'], ['active', 'Active'], ['disabled', 'Disabled'], ['pending', 'Applied']].map(([k, l]) => option(k, l, (q.status || '') === k))}</select>
      ${d.campuses.length > 1 ? html`<select name="campusId" aria-label="Campus">${option('', 'Every campus', !q.campusId)}${d.campuses.map((c) => option(c.id, c.name, q.campusId === c.id))}</select>` : ''}
      <select name="signin" aria-label="Sign-in">${SIGNIN.map(([k, l]) => option(k, l, (q.signin || '') === k))}</select>
      <select name="flag" aria-label="Flag">${FLAGS.map(([k, l]) => option(k, l, (q.flag || '') === k))}</select>
      <select name="sort" aria-label="Sort by">${SORTS.map(([k, l]) => option(k, `Sort: ${l}`, (q.sort || 'name') === k))}</select>
      <button class="btn">Search</button>
      <span class="spacer"></span><span class="muted">${d.total.toLocaleString()} account${d.total === 1 ? '' : 's'}</span>
    </form>
    ${d.users.length ? html`<div class="card flush"><div class="table-scroll"><table class="table accounts">
      <thead><tr><th>Name</th><th>Account type</th><th>Status</th><th>Campuses</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody>${d.users.map((u) => html`<tr data-href="/accounts/${u.id}">
        <td data-label="Name"><a href="#/accounts/${u.id}"><strong>${u.name}</strong></a><small class="muted block">${u.username}${u.studentNo ? ` · ${u.studentNo}` : ''}${u.email ? ` · ${u.email}` : ''}</small></td>
        <td data-label="Account type">${u.roleLabel}</td>
        <td data-label="Status">${statusBadge(u.status)}</td>
        <td data-label="Campuses"><small>${u.campuses.join(', ') || '—'}</small></td>
        <td data-label="Last sign-in" class="nowrap">${when(u.lastLoginAt)}</td>
        <td class="row-flags">${flags(u)}</td></tr>`)}</tbody></table></div></div>
      ${pager(d, q, '/accounts', ['Previous', 'Next'])}`
    : html`<div class="card empty">${icon('users', 32)}<p>No account matches.</p></div>`}`);
  wireFilter(el.querySelector('#filter'), '/accounts');
  el.querySelector('tbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a, button')) location.hash = `#${tr.dataset.href}`;
  });
  el.querySelector('#add').addEventListener('click', () => newStaffDialog(d, (u) => (location.hash = `#/accounts/${u.id}`)));
}

// A temporary password: 14 characters, letters and digits, without look-alikes (0/O, 1/l).
function temporaryPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const pick = (set) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(letters), pick(digits), ...Array.from({ length: 12 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
const passwordInput = (label) => html`<label class="field"><span>${label}<em>*</em></span>
  <span class="copy-row"><input name="password" value="${temporaryPassword()}" minlength="8" required autocomplete="off" spellcheck="false" class="mono" /><button type="button" class="btn sm" data-new-pw>${icon('sparkle', 14)} New</button></span>
  <span class="hint">Give it to the person; they choose their own when they first sign in.</span></label>`;
const wireNewPassword = (root) => root.querySelector('[data-new-pw]')?.addEventListener('click', () => (root.querySelector('[name=password]').value = temporaryPassword()));

const campusChecks = (campuses, chosen) => html`<fieldset class="field span-2 plain"><span>Works at</span>
  <div class="days">${campuses.map((c) => html`<label><input type="checkbox" name="campusIds" value="${c.id}" ${chosen.includes(c.id) ? 'checked' : ''} /> ${c.name}</label>`)}</div>
  <span class="hint">Administrators reach every campus.</span></fieldset>`;
const pickedCampuses = (form) => [...form.querySelectorAll('[name=campusIds]:checked')].map((i) => i.value);

function newStaffDialog(d, onDone) {
  const staff = d.roles.filter((r) => r.staff);
  modal({
    title: 'New staff account',
    subtitle: 'Teachers, registrars, deans, HR, payroll, Finance offices, staff and administrators. Students and parents are added by the registrar in the Admin panel.',
    wide: true,
    submitLabel: 'Make the account',
    body: html`<div class="grid">
      <label class="field"><span>Account type<em>*</em></span><select name="role">${staff.map((r) => option(r.id, r.label, r.id === 'staff'))}</select></label>
      <label class="field span-2"><span>Full name<em>*</em></span><input name="name" required /></label>
      <label class="field"><span>Username<em>*</em></span><input name="username" autocapitalize="none" spellcheck="false" required /></label>
      <label class="field span-2"><span>Email</span><input type="email" name="email" /><span class="hint">Needed to link a teacher, registrar, dean, administrator or officer to Keycloak.</span></label>
      ${campusChecks(d.campuses, d.campuses.slice(0, 1).map((c) => c.id))}
      ${passwordInput('Temporary password')}
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const u = await api.post('/api/control/users', { ...v, campusIds: pickedCampuses(form), mustChangePassword: true });
      toast(`${u.name} can sign in now with the temporary password.`);
      onDone(u);
    },
  });
  wireNewPassword(document.querySelector('.modal'));
}

export async function accountView(el, { id }) {
  const u = await api.get(`/api/control/users/${id}`);
  const campuses = u.allCampuses;
  const me = u.id === ctx.user.id;
  const reload = () => accountView(el, { id });
  const act = async (fn, done) => {
    try {
      await fn();
      if (done) toast(done);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  mount(el, html`
    ${pageHead(html`${u.name} ${statusBadge(u.status)}`, html`${u.roleLabel} · ${u.username}${u.email ? ` · ${u.email}` : ''}`, html`<button class="btn" id="edit">${icon('edit', 16)} Edit</button>`, ['/accounts', 'Accounts'])}
    <div class="action-bar">
      ${!me ? html`<button class="btn" id="reset">${icon('key', 16)} Reset password</button>` : ''}
      ${!me && u.sessions ? html`<button class="btn" id="signout">${icon('logout', 16)} End ${u.sessions} session${u.sessions === 1 ? '' : 's'}</button>` : ''}
      ${u.locked ? html`<button class="btn" id="unlock">${icon('lock', 16)} Unlock</button>` : ''}
      ${!me && !u.mustChangePassword && !u.sso ? html`<button class="btn" id="must">${icon('flag', 16)} Ask for a new password</button>` : ''}
      ${u.sso ? html`<button class="btn" id="unlink">${icon('link', 16)} Unlink from Keycloak</button>` : ''}
      ${!me && ['active', 'disabled'].includes(u.status) ? html`<button class="btn ${u.status === 'active' ? 'danger' : ''}" id="status">${u.status === 'active' ? html`${icon('x', 16)} Disable` : html`${icon('check', 16)} Enable`}</button>` : ''}
      <a class="btn ghost" href="#/audit?userId=${u.id}">${icon('search', 16)} Full trail</a>
    </div>
    <div class="cols wide-left">
      <div class="stack">
        <section class="card"><h2>${icon('user')} Account</h2>
          <dl class="info-grid">
            <div class="info"><dt>Account type</dt><dd>${u.roleLabel}</dd></div>
            <div class="info"><dt>Signs in to</dt><dd>${u.side === 'admin' ? 'Admin panel session' : u.side === 'hris' ? 'People session' : 'Learn session'}</dd></div>
            <div class="info"><dt>Campuses</dt><dd>${u.campuses.join(', ') || '—'}</dd></div>
            <div class="info"><dt>Last sign-in</dt><dd>${when(u.lastLoginAt)}</dd></div>
            <div class="info"><dt>Made</dt><dd>${u.createdAt ? fmtDateTime(u.createdAt) : '—'}</dd></div>
            <div class="info"><dt>Password</dt><dd>${u.sso && !u.mustChangePassword ? 'Signs in with Keycloak' : u.mustChangePassword ? badge('To change at the next sign-in', 'amber') : 'Set by the person'}</dd></div>
            ${u.sso ? html`<div class="info"><dt>Keycloak</dt><dd>${u.ssoName || 'Linked'}${u.ssoLinkedAt ? html` <small class="muted">since ${fmtDateTime(u.ssoLinkedAt)}</small>` : ''}</dd></div>` : ''}
            ${u.employee ? html`<div class="info"><dt>Employee record</dt><dd><a href="/hris/#/employees/${u.employee.id}">${u.employee.name || 'Open in People'}</a>${u.employee.no ? ` · ${u.employee.no}` : ''}</dd></div>` : ''}
            ${u.studentNo ? html`<div class="info"><dt>Student number</dt><dd>${u.studentNo}</dd></div>` : ''}
            ${u.links.guardianLinks ? html`<div class="info"><dt>Parent links</dt><dd>${u.links.guardianLinks}</dd></div>` : ''}
            ${u.links.sections ? html`<div class="info"><dt>Sections taught</dt><dd>${u.links.sections}</dd></div>` : ''}
          </dl>
          ${u.locks.length ? html`<div class="notice">${icon('lock')}<p><strong>Locked after wrong passwords</strong> ${u.locks.map((l) => (l.ip ? `on ${l.ip}` : 'everywhere')).join(', ')}, until ${fmtDateTime(u.locks[0].until)}.</p></div>` : ''}
        </section>
      </div>
      <div class="stack">
        <section class="card"><h2>${icon('grid')} Can open</h2>
          <ul class="sys-list">${u.systems.map((s) => html`<li>${s.name}${s.status !== 'live' ? html` ${badge('Coming soon', 'gray')}` : ''}</li>`)}</ul>
          ${u.modules ? html`<p class="small"><strong>Learn modules:</strong> ${u.modules.join(', ') || 'none'}</p>` : ''}
          <p class="small">${u.permissions.includes('*') ? html`<strong>Every permission</strong> (administrator).` : html`<strong>${u.permissions.length} permission${u.permissions.length === 1 ? '' : 's'}</strong> as ${u.roleLabel}.`} <a href="#/roles">Roles & permissions</a></p>
        </section>
        <section class="card"><h2>${icon('laptop')} Sessions</h2>
          ${u.sessionList.length ? html`<ul class="session-list">${u.sessionList.map((s) => html`<li><strong>${s.sideLabel}</strong>${s.sso ? html` ${badge('Keycloak', 'blue')}` : ''}<small class="muted block">${browserOf(s.agent) || 'Browser not known'}${s.ip ? ` · ${s.ip}` : ''}</small><small class="muted block">Signed in ${when(s.createdAt)} · last active ${when(s.lastSeen)}</small></li>`)}</ul>` : html`<p class="muted">Not signed in.</p>`}
        </section>
      </div>
    </div>
    <section class="card"><div class="card-head"><h2>${icon('clock')} Trail</h2><a href="#/audit?userId=${u.id}">See all</a></div>
      ${u.trail.length ? html`<div class="table-scroll"><table class="table compact trail">${trailHead()}<tbody>${u.trail.slice(0, 15).map((e) => trailRow(e))}</tbody></table></div>` : html`<p class="muted">Nothing recorded for this account yet.</p>`}
    </section>`);

  el.querySelector('#edit').addEventListener('click', () => editDialog(u, campuses, reload));
  el.querySelector('#reset')?.addEventListener('click', () => {
    modal({
      title: `Reset ${u.name}'s password`,
      subtitle: 'Their sessions end and the username is unlocked. They choose their own password at the next sign-in.',
      submitLabel: 'Reset password',
      body: html`<div class="grid">${passwordInput('Temporary password')}</div>`,
      async onSubmit(form) {
        await api.post(`/api/control/users/${u.id}/reset-password`, { password: formData(form).password });
        toast('Password reset. Give the temporary password to the person.');
        reload();
      },
    });
    wireNewPassword(document.querySelector('.modal'));
  });
  el.querySelector('#signout')?.addEventListener('click', async () => {
    if (await confirmDialog(`End every session of ${u.name}? They are signed out everywhere and sign in again.`, { confirmLabel: 'End sessions', title: 'End sessions' })) act(() => api.post(`/api/control/users/${u.id}/sign-out`), 'Signed out everywhere.');
  });
  el.querySelector('#unlock')?.addEventListener('click', () => act(() => api.post(`/api/control/users/${u.id}/unlock`), 'Unlocked.'));
  el.querySelector('#must')?.addEventListener('click', () => act(() => api.post(`/api/control/users/${u.id}/require-password-change`), 'They choose a new password at the next sign-in.'));
  el.querySelector('#unlink')?.addEventListener('click', async () => {
    if (await confirmDialog(`Unlink ${u.name} from Keycloak? Their sessions end. The next Keycloak sign-in links the account again by its email or username.`, { confirmLabel: 'Unlink', title: 'Unlink from Keycloak' })) act(() => api.post(`/api/control/users/${u.id}/unlink-sso`), 'Unlinked.');
  });
  el.querySelector('#status')?.addEventListener('click', async () => {
    const off = u.status === 'active';
    if (off && !(await confirmDialog(`Disable ${u.name}? They are signed out everywhere and cannot sign in until an administrator enables the account again. Their records stay.`, { confirmLabel: 'Disable', title: 'Disable account' }))) return;
    act(() => api.put(`/api/control/users/${u.id}`, { status: off ? 'disabled' : 'active' }), off ? 'Disabled.' : 'Enabled.');
  });
}

function editDialog(u, campuses, onDone) {
  modal({
    title: `Edit ${u.name}`,
    wide: true,
    body: html`<div class="grid">
      <label class="field span-2"><span>Full name<em>*</em></span><input name="name" value="${u.name}" required /></label>
      <label class="field"><span>Username<em>*</em></span><input name="username" value="${u.username}" autocapitalize="none" spellcheck="false" required /></label>
      <label class="field span-2"><span>Email</span><input type="email" name="email" value="${u.email}" /></label>
      ${u.canChangeRole ? html`<label class="field"><span>Account type</span><select name="role" ${u.id === ctx.user.id ? 'disabled' : ''}>${u.assignableRoles.map((r) => option(r.id, r.label, r.id === u.role))}</select>
        <span class="hint">${u.id === ctx.user.id ? 'Another administrator can change yours.' : 'Changing it signs them out; they sign in again with the new permissions.'}</span></label>` : ''}
      ${u.canChangeRole && u.role !== 'admin' ? campusChecks(campuses, u.campusIds) : ''}
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const body = { name: v.name, username: v.username, email: v.email };
      if (v.role && v.role !== u.role) body.role = v.role;
      if (form.querySelector('[name=campusIds]')) body.campusIds = pickedCampuses(form);
      await api.put(`/api/control/users/${u.id}`, body);
      toast('Saved.');
      onDone();
    },
  });
}
