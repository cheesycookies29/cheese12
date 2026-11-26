// My profile and My security, after CORE ERP's (public/js/views/profile.js and security.js at the
// repository root), in every ATLAS system. Administrators also open anyone's profile from Users &
// Access (#/profile/<id>).
import { api } from '../api.js';
import { html, mount, badge, toast, modal, confirmDialog, fmtDateTime, fmtDate, timeAgo } from '../ui.js';
import { icon } from '../icons.js';
import { ctx, openChangePassword } from '../shell.js';
import { avatar, editMyAvatar, loadAvatars } from './avatars.js';
import { twoFactorCard, wireTwoFactorCard } from './two-factor.js';
import { notificationsView } from './notifications.js';

const row = (label, value) => html`<div><dt>${label}</dt><dd>${value || html`<span class="muted">—</span>`}</dd></div>`;
// The change-password address for this system (each system checks its own session).
const authBase = () => ctx.authBase || '/api/auth';

export async function profileView(el, params = {}) {
  const other = params.id && params.id !== ctx.user.id;
  const [p] = await Promise.all([api.get(other ? `/api/system/users/${encodeURIComponent(params.id)}/profile` : '/api/me/profile'), loadAvatars()]);
  const reload = () => profileView(el, params);
  const who = p.self ? 'you' : 'they';
  mount(el, html`
    ${other ? html`<nav class="crumbs" aria-label="Breadcrumb"><a href="#/system/users">Users &amp; Access</a>${icon('chevronRight', 14)}<span class="cur">${p.name}</span></nav>` : ''}
    <section class="card profile-head">
      ${avatar(p.id, p.name, { size: 'xl', at: p.avatar })}
      <div class="profile-id">
        <h1>${p.name}</h1>
        <p class="profile-role">${p.title || p.accountTypeLabel}${p.title ? html` <span class="muted">· ${p.accountTypeLabel}</span>` : ''}${p.activeCampus ? html` <span class="muted">· ${p.activeCampus}</span>` : ''}</p>
        ${p.status !== 'active' ? badge(p.status === 'disabled' ? 'Account disabled' : p.status, 'red') : ''}
      </div>
      <div class="actions">
        ${p.self ? html`<button type="button" class="btn" id="my-pic">${icon('image', 16)} ${p.avatar ? 'Change my picture' : 'Add my picture'}</button>` : ''}
        ${p.canEditTitle ? html`<button type="button" class="btn" id="edit-title">${icon('edit', 16)} ${p.title ? 'Change title' : 'Give a title'}</button>` : ''}
      </div>
    </section>
    <div class="cols profile-grid">
      <section class="card" aria-labelledby="pf-account">
        <h2 id="pf-account">${icon('user')} Account</h2>
        <dl class="profile-dl">
          ${row('Title', p.title || html`<span class="muted">None yet: the account type shows instead</span>`)}
          ${row('Account type', p.accountTypeLabel)}
          ${row('Username', html`<span class="mono">${p.username}</span>`)}
          ${row('Email', p.email)}
          ${p.phone ? row('Phone', p.phone) : ''}
          ${row(p.campuses.length > 1 ? 'Campuses' : 'Campus', p.campuses.join(', '))}
          ${row('Single sign-on', p.sso ? `Linked to Keycloak${p.sso.name ? ` as ${p.sso.name}` : ''}` : 'Not linked: signs in with an ATLAS password')}
          ${row('In ATLAS since', p.createdAt ? fmtDate(p.createdAt.slice(0, 10)) : '')}
          ${row('Last sign-in', p.lastLoginAt ? fmtDateTime(p.lastLoginAt) : 'Never')}
        </dl>
        <p class="muted small">The title is the position in the school (for example <em>University Registrar</em> or <em>Instructor I</em>), given by an administrator. The account type decides what ${who} can do in ATLAS.${p.self ? ' To correct your name or email, ask the registrar (students and parents) or HR (employees).' : ''}</p>
        ${p.self ? html`<div class="actions"><a class="btn" href="#/security">${icon('shield', 16)} My security</a><button type="button" class="btn" id="pf-password">${icon('key', 16)} Change password</button></div>` : ''}
      </section>
      ${schoolCard(p)}
    </div>
    <section class="card" aria-labelledby="pf-open">
      <h2 id="pf-open">${icon('grid')} What ${who} can open</h2>
      ${p.systems.length ? html`<ul class="access-list">${p.systems.map((s) => html`<li><span class="grow"><strong>${s.name}</strong><small class="muted block">${s.tagline}</small></span>${p.self ? html`<a class="btn sm" href="${s.url}">Open ${icon('chevronRight', 14)}</a>` : badge('Access', 'green')}</li>`)}</ul>`
        : html`<p class="muted">No ATLAS system yet.</p>`}
      <p class="muted small">What each account type may do is set by administrators in Roles &amp; permissions; one account can also be given more or less.</p>
    </section>`);
  el.querySelector('#my-pic')?.addEventListener('click', () => editMyAvatar(ctx.user, reload));
  el.querySelector('#pf-password')?.addEventListener('click', () => openChangePassword(authBase()));
  el.querySelector('#edit-title')?.addEventListener('click', () => modal({
    title: p.title ? 'Change title' : 'Give a title',
    subtitle: `${p.name}'s position in the school, shown beside their name. It does not change what they can do.`,
    submitLabel: 'Save title',
    body: html`<label class="field"><span>Title</span><input name="title" maxlength="80" value="${p.title || ''}" placeholder="${p.accountTypeLabel}" /><small class="hint">For example: University Registrar, Instructor I, Budget Officer III. Leave it empty to show the account type.</small></label>`,
    async onSubmit(form) {
      const { title } = await api.put(`/api/system/users/${encodeURIComponent(p.id)}/title`, { title: form.title.value });
      if (p.self) ctx.user.title = title;
      window.dispatchEvent(new CustomEvent('avatar:changed', { detail: { userId: p.id } }));
      toast('Title saved.');
      reload();
    },
  }));
}

function schoolCard(p) {
  const s = p.student;
  const t = p.teacher;
  const e = p.employee;
  const kids = p.children;
  const a = p.applicant; // a job applicant: what they gave at sign-up (PL-016)
  if (a) {
    return html`<section class="card" aria-labelledby="pf-school">
      <h2 id="pf-school">${icon('briefcase')} Given at sign-up</h2>
      <dl class="profile-dl">${a.sexLabel ? row('Sex', a.sexLabel) : ''}${a.birthDate ? row('Date of birth', fmtDate(a.birthDate)) : ''}${a.address ? row('Home address', a.address) : ''}${a.educationLabel ? row('Highest educational attainment', a.educationLabel) : ''}${a.campusName ? row('Preferred campus', a.campusName) : ''}</dl>
      <p class="muted small">Only the school's HR staff see these. To correct them, or to have them removed, ask the HR office.</p>
    </section>`;
  }
  if (!s && !t && !e && !kids) return '';
  return html`<section class="card" aria-labelledby="pf-school">
    <h2 id="pf-school">${icon(s ? 'cap' : kids ? 'users' : 'building')} ${s ? 'Studies' : kids ? 'Children' : 'Work'}</h2>
    ${s ? html`<dl class="profile-dl">${row('Student number', s.studentNo)}${row('Program', s.program)}${row('Year level', s.yearLevel ? `Year ${s.yearLevel}` : '')}</dl>
      ${p.self ? html`<div class="actions"><a class="btn" href="/academic/#/me">${icon('clipboard', 16)} My academic record</a></div>` : ''}` : ''}
    ${t && !e ? html`<dl class="profile-dl">${row('Department', t.department)}${row('Employee number', t.employeeNo)}</dl>` : ''}
    ${e ? html`<dl class="profile-dl">${row('Position', e.position)}${row('Department', e.department)}${row('Employee number', e.employeeNo)}${row('Employment', e.status)}${row('Date hired', e.hireDate ? fmtDate(e.hireDate) : '')}${row('Campus', e.campus)}</dl>
      ${p.self ? html`<div class="actions"><a class="btn" href="/hris/#/me/profile">${icon('users', 16)} My HR record</a></div>` : ''}` : ''}
    ${kids ? (kids.length ? html`<ul class="access-list">${kids.map((k) => html`<li><span class="grow"><strong>${k.name}</strong>${k.relationship ? html`<small class="muted block">${k.relationship}</small>` : ''}</span></li>`)}</ul>` : html`<p class="muted">No student linked yet. The registrar links parents to their children.</p>`) : ''}
  </section>`;
}

// ----- My security -----
export async function securityView(el) {
  const [sessions, tfa] = await Promise.all([api.get('/api/me/sessions'), api.get('/api/me/2fa')]);
  const reload = () => securityView(el);
  const others = sessions.filter((s) => !s.current).length;
  const sso = ctx.user.ssoName || ctx.user.ssoLinkedAt;
  mount(el, html`
    <header class="page-head"><div><h1>My security</h1><p class="muted">Your password, 2-step verification and where you are signed in to ATLAS.</p></div></header>
    <section class="card">
      <div class="card-head"><h2>${icon('key')} Password</h2></div>
      <p class="muted">Use a password you use nowhere else: three unrelated words make a strong one. Changing it signs you out everywhere else.${sso ? ' You can also sign in with Keycloak.' : ''}</p>
      <div class="actions"><button type="button" class="btn" id="sec-password">${icon('key', 16)} Change password</button></div>
    </section>
    ${twoFactorCard(tfa)}
    <section class="card">
      <div class="card-head"><h2>${icon('laptop')} Where you are signed in</h2>${others ? html`<button type="button" class="btn" id="sign-out-others">Sign out everywhere else</button>` : ''}</div>
      <div class="scroll-x"><table class="table">
        <thead><tr><th>Device</th><th>Signed in to</th><th>Network address</th><th>Signed in</th><th>Last active</th><th><span class="sr-only">Action</span></th></tr></thead>
        <tbody>${sessions.map((s) => html`<tr>
          <td data-label="Device"><strong>${s.device}</strong>${s.current ? html` ${badge('This device', 'green')}` : ''}${s.sso ? html` ${badge('Keycloak', 'blue')}` : ''}</td>
          <td data-label="Signed in to">${s.side}</td>
          <td data-label="Network address" class="mono">${s.ip || '—'}</td>
          <td data-label="Signed in">${fmtDateTime(s.signedInAt)}</td>
          <td data-label="Last active">${timeAgo(s.lastSeenAt)}</td>
          <td class="row-actions">${s.current ? '' : html`<button type="button" class="btn sm" data-end="${s.id}">Sign out</button>`}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="muted small">You are signed out after a while without using ATLAS, and after the longest time your school allows. A device you do not recognise? Sign it out and change your password.</p>
    </section>`);
  el.querySelector('#sec-password').addEventListener('click', () => openChangePassword(authBase()));
  wireTwoFactorCard(el, reload);
  el.querySelector('#sign-out-others')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Sign out of ATLAS on ${others} other device${others === 1 ? '' : 's'}?`, { confirmLabel: 'Sign out', title: 'Sign out everywhere else' }))) return;
    const { signedOut } = await api.post('/api/me/sessions/sign-out-others', {});
    toast(`Signed out of ${signedOut} other device${signedOut === 1 ? '' : 's'}.`);
    reload();
  });
  el.querySelector('tbody').addEventListener('click', async (e) => {
    const id = e.target.closest('[data-end]')?.dataset.end;
    if (!id) return;
    try {
      await api.del(`/api/me/sessions/${id}`);
      toast('Signed out of that device.');
    } catch (err) {
      toast(err.message, 'error');
    }
    reload();
  });
}

export const accountRoutes = () => [
  ['/profile', profileView],
  ['/profile/:id', profileView, (u) => u.role === 'admin'],
  ['/security', securityView],
  ['/notifications', notificationsView], // the bell's full list (public/js/account/notifications.js)
];
