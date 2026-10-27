// ERP launcher: the first page after sign-in. Users pick a module; modules on
// the roadmap are listed but disabled. Styled after lancastertechdev.com.
import { api } from '../api.js';
import { ctx, can, roleLabel } from '../state.js';
import { MODULES, ICONS } from '../modules.js';
import { unseenCount } from './devlog.js';
import { html, raw, mount } from '../ui.js';

const icon = (name) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// A few live figures per module, only from data this user may see.
async function moduleStats() {
  const get = (url) => api.get(url).catch(() => null);
  const [employees, requests, assets, inventory, mine, reports, desk, myTickets] = await Promise.all([
    can('employees.view') ? get('/api/employees') : null,
    can('leave.manage') ? get('/api/requests/summary') : null,
    can('assets.view') ? get('/api/assets') : null,
    can('assets.view') ? get('/api/inventory') : null,
    !can('assets.view') && ctx.user.employeeId ? get('/api/me/assets') : null,
    can('assets.view') ? get('/api/asset-reports/summary') : null,
    can('helpdesk.agent') ? get('/api/helpdesk/summary') : null,
    can('helpdesk.agent') ? null : get('/api/helpdesk/mine'),
  ]);
  const hr = [];
  if (employees) hr.push(`${employees.filter((e) => e.status === 'Active').length} active employees`);
  if (requests?.pending) hr.push(`${requests.pending} pending request${requests.pending === 1 ? '' : 's'}`);
  const assetsOut = [];
  if (assets) assetsOut.push(`${assets.filter((a) => a.status !== 'retired' && a.status !== 'lost').length} assets`, `${assets.filter((a) => a.status === 'assigned').length} assigned`);
  const low = inventory?.filter((i) => i.quantity <= i.reorderLevel).length;
  if (low) assetsOut.push(`${low} low stock`);
  if (reports?.active) assetsOut.push(`${reports.active} open problem report${reports.active === 1 ? '' : 's'}`);
  if (mine) assetsOut.push(`${mine.assets.length} item${mine.assets.length === 1 ? '' : 's'} assigned to you`);
  const helpdesk = [];
  if (desk) helpdesk.push(`${desk.open} open ticket${desk.open === 1 ? '' : 's'}`, ...(desk.awaiting ? [`${desk.awaiting} awaiting reply`] : []), ...(desk.overdue ? [`${desk.overdue} overdue`] : []));
  const myOpen = myTickets?.filter((t) => !['resolved', 'closed'].includes(t.status)).length;
  if (myOpen) helpdesk.push(`${myOpen} open ticket${myOpen === 1 ? '' : 's'} of yours`);
  return { hr, assets: assetsOut, helpdesk };
}

export async function launcherView(el) {
  const u = ctx.user;
  const [stats, devlogNew, feedbackNew] = await Promise.all([
    moduleStats(),
    can('devlog.view') ? unseenCount().catch(() => 0) : 0,
    can('feedback.view') ? api.get('/api/feedback/summary').then((r) => r.new).catch(() => 0) : 0,
  ]);
  const live = MODULES.filter((m) => m.status === 'live');
  const soon = MODULES.filter((m) => m.status !== 'live');
  const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const card = (m) => {
    const home = ctx.moduleHome(m.id);
    const figures = stats[m.id] || [];
    return home
      ? html`<a class="lc-card" href="#${home}" data-module="${m.id}">
          <div class="lc-card-icon">${icon(m.icon)}</div>
          <h3>${m.name}</h3>
          <p>${m.description}</p>
          ${figures.length ? html`<ul class="lc-figures">${figures.map((f) => html`<li>${f}</li>`)}</ul>` : ''}
          <span class="lc-open">Open module <span aria-hidden="true">↗</span></span>
        </a>`
      : html`<div class="lc-card locked" data-module="${m.id}" aria-disabled="true">
          <div class="lc-card-icon">${icon(m.icon)}</div>
          <h3>${m.name}</h3>
          <p>${m.description}</p>
          <span class="lc-note">Your account does not have access. Contact your administrator.</span>
        </div>`;
  };

  mount(el, html`
    <div class="lc">
      <header class="lc-header">
        <img src="/img/logo.png" alt="Lancaster Technology and Development" />
        <div class="lc-user">
          <div><strong>${u.name}</strong><small>${roleLabel(u.role)}</small></div>
          <a class="link" href="#/feedback">Send feedback</a>
          <button class="link" id="lc-pw">Change password</button>
          <button class="btn small-btn" id="lc-out">Sign out</button>
        </div>
      </header>

      <section class="lc-hero">
        <p class="lc-date">${today}</p>
        <h1>${greeting()}, <span>${u.name.split(' ')[0]}</span></h1>
        <p class="lc-lead">Welcome to the LTDC Enterprise Resource Planning system. Choose a module to continue.</p>
      </section>

      <section class="lc-section">
        <h2 class="lc-title"><span>Your</span> Modules</h2>
        <div class="lc-grid">${live.map(card)}</div>
      </section>

      <section class="lc-section">
        <h2 class="lc-title small"><span>Coming</span> Soon</h2>
        <div class="lc-grid soon">${soon.map((m) => html`<div class="lc-card soon" aria-disabled="true">
          <div class="lc-card-icon">${icon(m.icon)}</div>
          <h3>${m.name}</h3>
          <p>${m.description}</p>
          <span class="lc-pill">In development</span>
        </div>`)}</div>
      </section>

      ${can('users.manage')
        ? html`<section class="lc-band">
            <div>
              <h2>System Administration</h2>
              <p>Manage user accounts and access, company details and data backups for all modules, see what changed in each release, and read feedback from users.</p>
            </div>
            <div class="lc-band-actions"><a class="lc-band-btn" href="#/users">Users &amp; Access</a><a class="lc-band-btn" href="#/settings">Settings &amp; Backups</a>${can('devlog.view') ? html`<a class="lc-band-btn" href="#/devlog">Dev log${devlogNew ? html`<span class="lc-band-count">${devlogNew} new</span>` : ''}</a>` : ''}${can('feedback.view') ? html`<a class="lc-band-btn" href="#/feedback/inbox">Feedback${feedbackNew ? html`<span class="lc-band-count">${feedbackNew} new</span>` : ''}</a>` : ''}</div>
          </section>`
        : ''}

      <footer class="lc-footer">
        <img src="/img/logo-white.png" alt="" />
        <span>${ctx.settings.companyName}</span>
        <span class="lc-footer-tag">Nation building through technology and development</span>
      </footer>
    </div>`);

  el.querySelector('#lc-out').addEventListener('click', () => ctx.signOut());
  el.querySelector('#lc-pw').addEventListener('click', () => ctx.changePassword());
}
