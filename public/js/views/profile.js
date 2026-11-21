// Everyone's profile (0.32). Anyone signed in sees a person's picture, name, role in the company and
// department. Their own profile, and anyone's for an administrator, also shows the account (username,
// account type, 2-step sign-in), the employment details, and what the person can open in each module.
// Only administrators change the role in the company.
import { api } from '../api.js';
import { ctx } from '../state.js';
import { html, mount, toast, modal, fmtDate } from '../ui.js';
import { icon } from '../icons.js';
import { avatar, editMyAvatar } from '../avatars.js';
import { openChangePassword } from './login.js';
import { COMPANY_ROLE_MAX, DEFAULT_COMPANY_ROLE } from '/shared/profile.js';

const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || value === 0 ? value : html`<span class="muted">—</span>`}</dd></div>`;

// #/profile is your own; #/people/:id anyone's (yours too).
export const myProfileView = (el) => personView(el, { id: ctx.user.id });

export async function personView(el, { id }) {
  const p = await api.get(`/api/people/${encodeURIComponent(id)}`);
  const full = Boolean(p.username);
  const open = (p.modules || []).filter((m) => m.home);
  const shut = (p.modules || []).filter((m) => !m.home);
  mount(el, html`<div class="profile-page">
    <header class="profile-head">
      ${avatar(p.id, p.name, { size: 'xl' })}
      <div class="profile-id">
        <h1>${p.name}</h1>
        <p class="profile-role">${p.companyRole}${p.department ? html`<span class="muted"> · ${p.department}</span>` : ''}</p>
        ${p.active ? '' : html`<p><span class="badge gray">Account disabled</span></p>`}
      </div>
      <div class="actions">
        ${p.self ? html`<button class="btn" id="my-pic">${icon('image', 16)} ${ctx.avatars?.[p.id] ? 'Change my picture' : 'Add my picture'}</button>` : ''}
        ${p.canEditRole ? html`<button class="btn" id="edit-role">${icon('edit', 16)} Change role in the company</button>` : ''}
      </div>
    </header>
    ${full ? html`
    <div class="profile-grid">
      <section class="card">
        <h2>${icon('user')} Account</h2>
        <dl class="info-grid">
          ${info('Role in the company', p.companyRole)}
          ${info('Username', html`<span class="mono">${p.username}</span>`)}
          ${info('Account type', p.accountTypeLabel)}
          ${info('2-step sign-in', p.twoFactorEnabled ? html`<span class="badge green">On</span>` : html`<span class="badge gray">Off</span>`)}
          ${info('In CORE since', p.createdAt ? fmtDate(p.createdAt.slice(0, 10)) : '')}
        </dl>
        <p class="muted small profile-note">The role in the company is set by an administrator. The account type decides what ${p.self ? 'you' : 'they'} can open in CORE.</p>
        ${p.self ? html`<div class="profile-links"><a class="btn small-btn" href="#/account/security">${icon('shield', 14)} My security</a><button type="button" class="btn small-btn" id="change-pw">${icon('key', 14)} Change password</button></div>` : ''}
      </section>
      <section class="card">
        <h2>${icon('briefcase')} Employment</h2>
        ${p.employee ? html`<dl class="info-grid">
          ${info('Employee no.', html`<span class="mono">${p.employee.employeeNo}</span>`)}
          ${info('Position (HR)', p.employee.position)}
          ${info('Department', p.employee.department)}
          ${info('Status', p.employee.employmentStatus)}
          ${info('Date hired', p.employee.hireDate ? fmtDate(p.employee.hireDate) : '')}
          ${info('Supervisor', p.employee.supervisor)}
        </dl>
        ${p.self ? html`<p class="muted small profile-note">Personal details, government IDs and bank: <a href="#/me/profile">My HR record</a>. To change them, contact HR.</p>` : ''}`
        : html`<p class="muted small">${p.self ? 'Your account' : 'This account'} is not linked to an employee record${p.self ? '' : ' (or Human Resource Management is off)'}.</p>`}
      </section>
      <section class="card profile-access">
        <h2>${icon('grid')} What ${p.self ? 'you' : 'they'} can open</h2>
        <ul class="access-list">
          ${open.map((m) => html`<li>
            <span class="mod-ic">${icon(m.glyph, 18)}</span>
            <span class="grow"><strong>${m.name}</strong><small>${m.detail}${m.off ? ' · off for the company, open to administrators' : ''}</small></span>
            ${p.self ? html`<a class="btn small-btn" href="#${m.home}">Open</a>` : html`<span class="badge green">Access</span>`}
          </li>`)}
          ${p.adminPanel ? html`<li><span class="mod-ic">${icon('settings', 18)}</span><span class="grow"><strong>Admin panel</strong><small>${p.accountType === 'admin' ? 'Everything: users, roles, modules, settings and data' : 'Some administration pages'}</small></span>${p.self ? html`<a class="btn small-btn" href="#/admin/dashboard">Open</a>` : html`<span class="badge green">Access</span>`}</li>` : ''}
          ${shut.map((m) => html`<li class="shut">
            <span class="mod-ic">${icon(m.glyph, 18)}</span>
            <span class="grow"><strong>${m.name}</strong><small>${m.detail}</small></span>
            <span class="badge gray">${icon('lock', 12)} ${m.off ? 'Off' : 'No access'}</span>
          </li>`)}
        </ul>
        <p class="muted small profile-note">${p.self ? 'Need another module? Ask an administrator.' : 'Change what they can open under Admin panel → Users & Access or Roles & permissions.'}${p.approver ? ` ${p.self ? 'You are' : 'They are'} on an approval route, so the Approval Center is open to ${p.self ? 'you' : 'them'}.` : ''}</p>
      </section>
    </div>` : html`
    <div class="profile-grid">
      <section class="card">
        <h2>${icon('briefcase')} In the company</h2>
        <dl class="info-grid">
          ${info('Role in the company', p.companyRole)}
          ${info('Department', p.department)}
          ${info('Supervisor', p.supervisor)}
        </dl>
      </section>
      <section class="card">
        <h2>${icon('layers')} Projects you are both on</h2>
        ${p.sharedProjects?.length ? html`<ul class="link-list">${p.sharedProjects.map((x) => html`<li><a href="#/projects/${x.id}">${x.name}</a> <small class="muted mono">${x.code}</small></li>`)}</ul>` : html`<p class="muted small">None.</p>`}
      </section>
    </div>
    <p class="muted small profile-public-note">${icon('user', 14)} This is ${p.name}'s profile as everyone in the company sees it.</p>`}
  </div>`);

  el.querySelector('#my-pic')?.addEventListener('click', () => editMyAvatar(() => {
    window.dispatchEvent(new Event('avatar:changed'));
    personView(el, { id });
  }));
  el.querySelector('#change-pw')?.addEventListener('click', openChangePassword);
  el.querySelector('#edit-role')?.addEventListener('click', () => {
    const now = p.companyRole === DEFAULT_COMPANY_ROLE ? '' : p.companyRole;
    const listId = `roles-${p.id}`;
    modal({
      title: 'Role in the company', submitLabel: 'Save role',
      subtitle: `${p.name}'s role, as everyone in CORE sees it. It does not change what they can open: that is their account type.`,
      body: html`<label class="field"><span>Role in the company</span><input name="companyRole" value="${now}" maxlength="${COMPANY_ROLE_MAX}" placeholder="${DEFAULT_COMPANY_ROLE}" list="${listId}" autocomplete="off" />
        <small class="hint">For example Software Engineer or Finance Officer. Leave it empty for ${DEFAULT_COMPANY_ROLE}.</small></label>
        <datalist id="${listId}">${(p.roleSuggestions || []).map((r) => html`<option value="${r}"></option>`)}</datalist>`,
      onSubmit: async (f) => {
        const saved = await api.put(`/api/people/${encodeURIComponent(p.id)}/company-role`, { companyRole: f.companyRole.value });
        toast('Role saved.');
        if (p.self) {
          ctx.user.companyRole = saved.companyRole;
          window.dispatchEvent(new Event('avatar:changed'));
        }
        personView(el, { id });
      },
    });
  });
}
