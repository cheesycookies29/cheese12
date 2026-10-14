// ERP launcher: the first page after sign-in. Users pick a module; modules on
// the roadmap are shown but disabled.
import { api } from '../api.js';
import { ctx, can, roleLabel } from '../state.js';
import { MODULES, ICONS } from '../modules.js';
import { html, raw, mount } from '../ui.js';

const icon = (name) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// A few live figures per module, only from data this user may see.
async function moduleStats() {
  const get = (url) => api.get(url).catch(() => null);
  const [employees, requests, assets, inventory, mine] = await Promise.all([
    can('employees.view') ? get('/api/employees') : null,
    can('leave.manage') ? get('/api/requests/summary') : null,
    can('assets.view') ? get('/api/assets') : null,
    can('assets.view') ? get('/api/inventory') : null,
    !can('assets.view') && ctx.user.employeeId ? get('/api/me/assets') : null,
  ]);
  const hr = [];
  if (employees) hr.push(`${employees.filter((e) => e.status === 'Active').length} active staff`);
  if (requests) hr.push(`${requests.pending} pending request${requests.pending === 1 ? '' : 's'}`);
  const it = [];
  if (assets) {
    it.push(`${assets.filter((a) => a.status !== 'retired').length} assets`);
    it.push(`${assets.filter((a) => a.status === 'assigned').length} assigned`);
  }
  if (inventory) {
    const low = inventory.filter((i) => i.quantity <= i.reorderLevel).length;
    if (low) it.push(`${low} low stock`);
  }
  if (mine) it.push(`${mine.assets.length} item${mine.assets.length === 1 ? '' : 's'} with you`);
  return { hr, assets: it, alerts: { hr: Boolean(requests?.pending), assets: Boolean(inventory?.some((i) => i.quantity <= i.reorderLevel)) } };
}

export async function launcherView(el) {
  const u = ctx.user;
  const live = MODULES.filter((m) => m.status === 'live');
  const stats = await moduleStats();
  const initials = u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  mount(el, html`
    <div class="launcher">
      <header class="lx-bar">
        <div class="lx-brand"><img src="/img/logo-white.png" alt="Lancaster Technology and Development" /><span class="lx-divider"></span><span class="lx-system">Enterprise Resource Planning</span></div>
        <div class="lx-clock" id="lx-clock" aria-live="off"></div>
        <div class="lx-user">
          <span class="lx-avatar">${initials}</span>
          <div><strong>${u.name}</strong><small>${roleLabel(u.role)}</small></div>
          <button class="lx-btn ghost" id="lx-pw">Password</button>
          <button class="lx-btn ghost" id="lx-out">Sign out</button>
        </div>
      </header>

      <section class="lx-hero">
        <div>
          <p class="lx-eyebrow"><span class="lx-hazard"></span>Control center · ${ctx.settings.companyName}</p>
          <h1>${greeting()}, ${u.name.split(' ')[0]}.</h1>
          <p class="lx-lead">Select a module to begin.</p>
        </div>
        <dl class="lx-status">
          <div><dt>System</dt><dd><span class="lx-led on"></span>Online</dd></div>
          <div><dt>Modules live</dt><dd>${live.length} / ${MODULES.length}</dd></div>
          <div><dt>Access level</dt><dd>${roleLabel(u.role)}</dd></div>
        </dl>
      </section>

      <section class="lx-grid" aria-label="Modules">
        ${MODULES.map((m) => {
          const home = m.status === 'live' ? ctx.moduleHome(m.id) : null;
          const state = m.status !== 'live' ? 'soon' : home ? 'open' : 'locked';
          const figures = stats[m.id] || [];
          return html`
            <article class="lx-tile ${state}" data-module="${m.id}">
              ${state === 'soon' ? html`<span class="lx-tag">Coming soon</span>` : ''}
              <div class="lx-tile-top">
                <span class="lx-code">${m.code}</span>
                <span class="lx-state">${state === 'open' ? html`<span class="lx-led on ${stats.alerts[m.id] ? 'warn' : ''}"></span>Online` : state === 'locked' ? html`<span class="lx-led"></span>No access` : html`<span class="lx-led"></span>Standby`}</span>
              </div>
              <div class="lx-icon">${icon(m.icon)}</div>
              <h2>${m.name}</h2>
              <p>${m.description}</p>
              <div class="lx-figures">${state === 'open' && figures.length ? figures.map((f) => html`<span>${f}</span>`) : ''}</div>
              ${state === 'open'
                ? html`<a class="lx-enter" href="#${home}">Enter module <span aria-hidden="true">→</span></a>`
                : html`<span class="lx-enter disabled" aria-disabled="true">${state === 'soon' ? 'In development' : 'Ask your administrator for access'}</span>`}
            </article>`;
        })}
      </section>

      ${can('users.manage')
        ? html`<section class="lx-admin">
            <span class="lx-eyebrow small">System administration</span>
            <a href="#/users">Users &amp; Access</a>
            <a href="#/settings">Company settings &amp; backups</a>
          </section>`
        : ''}

      <footer class="lx-foot">
        <span>Lancaster Technology and Development Corporation</span>
        <span>Nation building through technology and development</span>
      </footer>
    </div>`);

  el.querySelector('#lx-out').addEventListener('click', () => ctx.signOut());
  el.querySelector('#lx-pw').addEventListener('click', () => ctx.changePassword());
  const clock = el.querySelector('#lx-clock');
  const tick = () => {
    const d = new Date();
    clock.innerHTML = `<span>${d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase()}</span><strong>${d.toLocaleTimeString('en-PH', { hour12: false })}</strong>`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
