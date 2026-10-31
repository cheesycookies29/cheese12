// The app frame shared by the admin panel and the learning portal: sign-in screens,
// sidebar menu (a drawer on phones), hash router, and the signed-in user box.
import { api } from './api.js';
import { html, mount, modal, toast, initials, formData } from './ui.js';
import { roleLabel } from '/shared/roles.js';

// App-wide state for the current page set (one per app, since each is its own page).
export const ctx = { user: null, info: null };

// ----- Sign-in screens -----
export function authScreen(el, { admin = false } = {}, card) {
  mount(el, html`
    <div class="auth-screen">
      <section class="auth-hero ${admin ? 'admin' : ''}">
        <img src="/img/logo-white.png" alt="Lancaster Technology and Development" />
        <div>
          <p class="auth-kicker">${admin ? 'LTDC LMS · Admin panel' : 'LTDC Learning Management System'}</p>
          ${admin
            ? html`<h1>Run the <span>school</span> side</h1><p>Enrollment, courses, sections, accounts and which modules students and teachers get.</p>`
            : html`<h1>Let's take <span>learning</span> further</h1><p>Enroll in classes, follow lessons, hand in work and see your grades, all in one place.</p>`}
        </div>
        <small>Nation building through technology and development.</small>
      </section>
      <section class="auth-panel">${card}</section>
    </div>`);
  const form = el.querySelector('form');
  form?.querySelector('input')?.focus();
  el.querySelectorAll('[data-toggle-pw]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
    }),
  );
  return form;
}

export const passwordField = (label, name, autocomplete) => html`
  <label class="field"><span>${label}</span>
    <div class="pw-wrap"><input type="password" name="${name}" autocomplete="${autocomplete}" required /><button type="button" class="link" data-toggle-pw>Show</button></div>
  </label>`;

export function onFormSubmit(form, handler) {
  const errorEl = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    errorEl.hidden = true;
    try {
      await handler(formData(form));
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });
}

export function forcePasswordView(el, { admin, authBase, onDone, onSignOut }) {
  const form = authScreen(el, { admin }, html`
    <form class="auth-card" novalidate>
      <img class="auth-logo" src="/img/logo.png" alt="Lancaster Technology and Development" />
      <h2>Choose a new password</h2>
      <p class="muted">Hi ${ctx.user.name}. Your password was set by someone else, so please replace it before continuing.</p>
      ${passwordField('Current (temporary) password', 'currentPassword', 'current-password')}
      ${passwordField('New password (at least 8 characters)', 'newPassword', 'new-password')}
      ${passwordField('Confirm new password', 'confirm', 'new-password')}
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Save and continue</button>
      <p class="auth-foot"><button type="button" class="link" id="sign-out-link">Sign out</button></p>
    </form>`);
  form.querySelector('#sign-out-link').addEventListener('click', onSignOut);
  onFormSubmit(form, async ({ currentPassword, newPassword, confirm }) => {
    if (newPassword !== confirm) throw new Error('The new passwords do not match.');
    await api.post(`${authBase}/change-password`, { currentPassword, newPassword });
    toast('Password changed.');
    onDone();
  });
}

export function openChangePassword(authBase) {
  modal({
    title: 'Change password',
    submitLabel: 'Change password',
    body: html`<div class="stack tight">
      <label class="field"><span>Current password</span><input type="password" name="currentPassword" autocomplete="current-password" required /></label>
      <label class="field"><span>New password (at least 8 characters)</span><input type="password" name="newPassword" autocomplete="new-password" required /></label>
      <label class="field"><span>Confirm new password</span><input type="password" name="confirm" autocomplete="new-password" required /></label>
    </div>`,
    async onSubmit(form) {
      const { currentPassword, newPassword, confirm } = formData(form);
      if (newPassword !== confirm) throw new Error('The new passwords do not match.');
      await api.post(`${authBase}/change-password`, { currentPassword, newPassword });
      toast('Password changed.');
    },
  });
}

// ----- The app -----
// config:
//   side: 'admin' | 'portal'
//   authBase: '/api/admin/auth' | '/api/auth'
//   appName: shown under the logo
//   routes: [[pattern, view, allowed(user, info) => bool]]
//   nav(): [{ href, label, heading, badge, exact, also }]
//   home(): default path
//   signedOutView(el, { status, boot }): renders sign-in / setup screens
//   badges: { name: () => Promise<number> }
export function startApp(config) {
  const routes = config.routes.map(([pattern, view, allowed = () => true]) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    return { re, keys, view, allowed };
  });
  let cleanup = null;
  const runCleanup = () => {
    if (typeof cleanup === 'function') cleanup();
    cleanup = null;
  };

  function renderNav() {
    document.getElementById('module-name').innerHTML = '';
    mount(document.getElementById('module-name'), html`${config.appName}${config.side === 'admin' ? html`<span class="side-tag">ADMIN</span>` : ''}`);
    document.getElementById('topbar-module').textContent = config.appName;
    document.getElementById('school-name').textContent = ctx.info?.schoolName || '';
    const items = config.nav();
    mount(document.getElementById('nav'), html`${items.map((n) =>
      n.heading
        ? html`<div class="nav-heading">${n.heading}</div>`
        : n.external
        ? html`<a href="${n.href}" target="_blank" rel="noopener">${n.label}</a>`
        : html`<a href="#${n.href}" data-href="${n.href}" data-also="${(n.also || []).join(' ')}" ${n.exact ? 'data-exact' : ''}>${n.label}${n.badge ? html`<span class="nav-badge" data-badge="${n.badge}" hidden></span>` : ''}</a>`,
    )}`);
  }

  function renderUserBox() {
    const u = ctx.user;
    mount(document.getElementById('user-box'), html`
      <div class="user-id"><span class="avatar">${initials(u.name)}</span><div><strong>${u.name}</strong><small>${roleLabel(u.role)} · ${u.username}</small></div></div>
      <div class="user-actions"><button class="link" id="change-pw">Change password</button><button class="link" id="sign-out">Sign out</button></div>`);
    document.getElementById('change-pw').addEventListener('click', () => openChangePassword(config.authBase));
    document.getElementById('sign-out').addEventListener('click', signOut);
  }

  async function refreshBadges() {
    for (const el of document.querySelectorAll('#nav .nav-badge[data-badge]')) {
      const n = await Promise.resolve(config.badges?.[el.dataset.badge]?.()).catch(() => 0);
      el.textContent = n || '';
      el.hidden = !n;
    }
    document.querySelector('#menu-btn .menu-dot').hidden = !document.querySelector('#nav .nav-badge:not([hidden])');
  }

  // Phone menu: the sidebar slides in as a drawer.
  const menuBtn = document.getElementById('menu-btn');
  const scrim = document.getElementById('nav-scrim');
  function setMenu(open) {
    document.body.classList.toggle('nav-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    scrim.hidden = !open;
  }
  menuBtn.addEventListener('click', () => setMenu(!document.body.classList.contains('nav-open')));
  scrim.addEventListener('click', () => setMenu(false));
  document.getElementById('sidebar').addEventListener('click', (e) => {
    if (e.target.closest('a[href], #sign-out')) setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setMenu(false);
  });

  async function navigate() {
    if (!ctx.user || ctx.user.mustChangePassword) return;
    setMenu(false);
    const path = location.hash.replace(/^#/, '').split('?')[0] || config.home();
    const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
    const match = routes.find((r) => r.re.test(path));
    if (!match || !match.allowed(ctx.user, ctx.info)) return (location.hash = `#${config.home()}`);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(path.match(match.re)[i + 1])]));

    const links = [...document.querySelectorAll('#nav a[data-href]')];
    const hits = (a) => [a.dataset.href, ...a.dataset.also.split(' ').filter(Boolean)].some((p) => path === p || (!a.hasAttribute('data-exact') && path.startsWith(p + '/')));
    const best = links.filter(hits).sort((a, b) => b.dataset.href.length - a.dataset.href.length)[0];
    links.forEach((a) => a.classList.toggle('active', a === best));

    runCleanup();
    refreshBadges();
    const old = document.getElementById('app');
    const el = old.cloneNode(false);
    old.replaceWith(el);
    window.scrollTo(0, 0);
    try {
      cleanup = await match.view(el, params, query);
    } catch (err) {
      mount(el, html`<div class="empty"><h2>Something went wrong</h2><p>${err.message}</p><p class="muted">Is the server still running? Check the terminal window.</p></div>`);
    }
  }

  function showAuth(view) {
    runCleanup();
    document.body.classList.add('auth-mode');
    document.body.classList.remove('booting');
    mount(document.getElementById('app'), '');
    view(document.getElementById('auth'));
  }

  async function boot({ fresh = false } = {}) {
    let status;
    try {
      status = await api.get(`${config.authBase}/status`);
    } catch {
      document.body.classList.add('auth-mode');
      document.body.classList.remove('booting');
      return mount(document.getElementById('auth'), html`<div class="empty"><h2>Cannot reach the server</h2><p>Start it with <code>npm start</code>, then reload this page.</p></div>`);
    }
    ctx.info = status;
    ctx.user = status.user;
    if (!ctx.user) return showAuth((el) => config.signedOutView(el, { status, boot: () => boot({ fresh: true }) }));
    if (ctx.user.mustChangePassword) {
      return showAuth((el) => forcePasswordView(el, { admin: config.side === 'admin', authBase: config.authBase, onDone: () => boot({ fresh: true }), onSignOut: signOut }));
    }
    await config.onSignedIn?.();
    document.body.classList.remove('auth-mode', 'booting');
    mount(document.getElementById('auth'), '');
    renderNav();
    renderUserBox();
    if (fresh || !location.hash || location.hash === '#/') location.hash = `#${config.home()}`;
    navigate();
  }

  async function signOut() {
    await api.post(`${config.authBase}/logout`).catch(() => {});
    ctx.user = null;
    history.replaceState(null, '', location.pathname);
    boot();
  }

  ctx.refreshBadges = refreshBadges;
  ctx.refreshNav = () => {
    renderNav();
    navigate();
  };
  ctx.reload = () => boot();
  window.addEventListener('hashchange', navigate);
  window.addEventListener('badges:changed', refreshBadges);
  window.addEventListener('auth:expired', () => {
    if (!ctx.user) return;
    ctx.user = null;
    toast('Your session has ended. Please sign in again.', 'error');
    boot();
  });
  boot();
}

// A page header with a title, an optional line under it and actions on the right.
export const pageHead = (title, sub = '', actions = '', back = '') => html`
  <div class="page-head">
    <div>${back ? html`<a class="back" href="#${back[0]}">← ${back[1]}</a>` : ''}<h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>
    ${actions ? html`<div class="actions">${actions}</div>` : ''}
  </div>`;

export const badgesChanged = () => window.dispatchEvent(new Event('badges:changed'));
