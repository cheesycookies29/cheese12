// The Lancaster ATLAS app frame, shared by ATLAS Learn (portal and admin panel) and ATLAS People: branding, sign-in
// screens, top bar with the user menu, icon sidebar (a drawer on phones), hash router.
import { api } from './api.js';
import { html, mount, modal, toast, initials, formData, raw } from './ui.js';
import { icon, iconSvg } from './icons.js';
import { roleLabel, setRoleOverrides } from '/shared/roles.js';

// App-wide state for the current page set (one per app, since each is its own page).
export const ctx = { user: null, info: null };

// ----- Branding and dark mode -----
export function applyBranding(b = {}) {
  const root = document.documentElement.style;
  if (b.brand) root.setProperty('--brand', b.brand);
  if (b.accent) root.setProperty('--accent', b.accent);
  const meta = document.querySelector('meta[name=theme-color]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
  meta.content = b.brand || '#5d0013';
  const app = document.body.dataset.app || 'ATLAS';
  document.title = b.schoolName ? `${app} · ${b.schoolName}` : app;
}

// ----- ATLAS identity (docs/BRAND.md) -----
// Kept quiet, as in CORE: one small wordmark per screen, plain product names everywhere else.
export const BYLINE = 'Education platform by Lancaster';
// The mark: the light version (grey ribbon, charcoal pages) or the one for dark backgrounds.
export const markSrc = (onDark = false) => `/img/brand/atlas-mark${onDark ? '-dark' : ''}.svg`;
// The school's own logo when an administrator uploaded one, else the ATLAS mark.
export const logoSrc = (b = ctx.info?.branding, onDark = false) => b?.logo || markSrc(onDark);
// The wordmark in the top bar: ATLAS, then the open product (or the byline on the home page).
export const atlasWord = (sub = BYLINE) => html`<span class="atlas-word"><strong>ATLAS</strong>${sub ? html`<em>${sub}</em>` : ''}</span>`;
// The mark in light and dark versions; CSS shows the one that fits the theme.
const themedMark = (cls = '') => html`<img class="${cls} mark-lt" src="${markSrc(false)}" alt="" /><img class="${cls} mark-dk" src="${markSrc(true)}" alt="" />`;

export const isDark = () => document.documentElement.dataset.theme === 'dark';
export function setTheme(dark) {
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem('lms-theme', dark ? 'dark' : 'light');
  } catch {}
  renderThemeButton();
}
export function renderThemeButton() {
  const btn = document.getElementById('theme-btn');
  btn.innerHTML = iconSvg(isDark() ? 'sun' : 'moon');
  btn.title = isDark() ? 'Light mode' : 'Dark mode';
  const logo = document.getElementById('brand-logo');
  if (logo) logo.src = markSrc(isDark());
}

// ----- Sign-in screens -----
const PORTAL_POINTS = [['cap', 'Enrollment', 'Request classes and follow each request'], ['book', 'Classes', 'Lessons, files and announcements'], ['quiz', 'Quizzes', 'Timed exams with instant results'], ['chart', 'Grades', 'Grades, attendance and your schedule']];
const ADMIN_POINTS = [['clipboard', 'Enrollment', 'Requests, waitlists and applicants'], ['layers', 'Catalog', 'Courses, terms and sections'], ['toggles', 'Modules', 'What students, teachers and parents can use'], ['settings', 'Settings', 'Branding, grading and school rules']];

// The burgundy panel beside every sign-in form, laid out like CORE's: the wordmark, a short
// line about this system, what it covers, and the school. The mark sits faintly in the corner.
export function authHero({ kicker = '', title, text, points = [] }) {
  const b = ctx.info?.branding || {};
  return html`<section class="auth-hero">
    <img class="hero-mark" src="/img/brand/atlas-mark-white.svg" alt="" />
    <div class="seal"><img src="${markSrc(true)}" alt="" /><div><strong>ATLAS</strong><small>${BYLINE}</small></div></div>
    <div style="position:relative;z-index:1">
      ${kicker ? html`<p class="auth-kicker">${kicker}</p>` : ''}
      <h1>${title}</h1>
      <p>${text}</p>
      ${points.length ? html`<ul class="auth-points">${points.map(([i, name, t]) => html`<li>${icon(i, 30)} <span><strong>${name}</strong>${t ? html` · ${t}` : ''}</span></li>`)}</ul>` : ''}
    </div>
    <small class="hero-foot">${b.logo ? html`<img src="${b.logo}" alt="" />` : ''}© ${new Date().getFullYear()} ${b.schoolName || 'Lancaster Technology and Development Corporation'}</small>
  </section>`;
}

export function authScreen(el, { admin = false } = {}, card) {
  const b = ctx.info?.branding || {};
  mount(el, html`
    <div class="auth-screen">
      ${authHero(admin
        ? { kicker: 'Learn · Admin panel', title: 'Run the school side.', text: `Enrollment, the catalog and accounts${b.schoolName ? ` for ${b.schoolName}` : ''}.`, points: ADMIN_POINTS }
        : { kicker: 'Learn', title: b.tagline || 'Learning, all in one place.', text: 'Classes, lessons, quizzes, grades and attendance, for students, teachers and parents.', points: PORTAL_POINTS })}
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

// "Switch campus" in the user menu, for accounts that work at more than one campus.
export function campusMenu(info) {
  if (!(info?.campuses?.length > 1)) return '';
  return html`<div class="menu-sep"></div><div class="menu-label">Switch campus</div>
    ${info.campuses.map((c) => html`<button type="button" role="menuitemradio" aria-checked="${c.id === info.activeCampusId}" class="${c.id === info.activeCampusId ? 'on' : ''}" data-campus="${c.id}">${icon('building')} <span class="grow">${c.name}</span>${c.id === info.activeCampusId ? icon('check') : ''}</button>`)}`;
}
export function wireCampusMenu(root, authBase) {
  root.querySelectorAll('[data-campus]').forEach((b) => b.addEventListener('click', async () => {
    if (b.classList.contains('on')) return;
    try {
      const r = await api.post(`${authBase}/campus`, { campusId: b.dataset.campus });
      try {
        sessionStorage.setItem('lms-campus-toast', `Switched to ${r.campusName}.`);
      } catch {}
      location.reload(); // every list follows the campus
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}
// After a switch, say so once the page has reloaded.
try {
  const msg = sessionStorage.getItem('lms-campus-toast');
  if (msg) {
    sessionStorage.removeItem('lms-campus-toast');
    setTimeout(() => toast(msg), 300);
  }
} catch {}

// Single sign-on (Keycloak): the button above the password form, and the password fields under it.
// With passwords switched off, the fields fold away under "Administrator sign-in" (a way in if Keycloak is down).
export function ssoBlock(sso, next = '/') {
  if (!sso?.enabled) return '';
  return html`<a class="btn primary block sso-btn" href="/api/sso/start?next=${encodeURIComponent(next)}">${icon('key', 18)} ${sso.label}</a>
    ${sso.passwords ? html`<div class="auth-or"><span>or with your ATLAS password</span></div>` : ''}`;
}
export const passwordFields = (sso, fields) => (sso?.enabled && !sso.passwords
  ? html`<details class="pw-details"><summary>Administrator sign-in</summary><div class="stack">${fields}</div></details>`
  : fields);
// A sign-in that came back from Keycloak with an error (?ssoError=…): show it on the form once.
export function showSsoError(form) {
  const params = new URLSearchParams(location.search);
  const msg = params.get('ssoError');
  if (!msg || !form) return;
  const box = form.querySelector('.form-error');
  box.textContent = msg;
  box.hidden = false;
  params.delete('ssoError');
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
}

// Above the sign-in form on phones, where the burgundy panel is hidden (as in CORE).
export const authLogo = () => html`<div class="auth-brand">${themedMark('auth-mark')}<strong>ATLAS</strong><small>${BYLINE}</small></div>`;

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
      ${authLogo()}
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
//   side: 'admin' | 'portal' | 'hris'; authBase: '/api/admin/auth' | '/api/auth' | '/api/hris/auth'
//   product: the ATLAS system shown in the top bar ('Learn', 'People')
//   passwordView(el): replaces the built-in "choose a new password" screen
//   routes: [[pattern, view, allowed(user, info) => bool]]
//   nav(): [{ href, label, icon, heading, badge, exact, also, external }]
//   home(): default path; signedOutView(el, { status, boot }); badges: { name: () => Promise<number> }
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
  const menuBtn = document.getElementById('menu-btn');
  menuBtn.innerHTML = iconSvg('menu', 20);

  function renderTop() {
    const b = ctx.info.branding;
    applyBranding(b);
    mount(document.getElementById('school-name'), atlasWord(config.side === 'admin' ? 'Learn · Admin' : config.product || 'Learn'));
    mount(document.getElementById('brand-sub'), html`${b.schoolName}${ctx.info.campusName ? html` · <strong class="campus-name">${ctx.info.campusName}</strong>` : ''}${b.termName ? ` · ${b.termName}` : ''}`);
    renderThemeButton();
  }

  function renderNav() {
    const items = config.nav();
    mount(document.getElementById('nav'), html`${items.map((n) =>
      n.heading
        ? html`<div class="nav-heading">${n.heading}</div>`
        : n.external
          ? html`<a href="${n.href}" target="_blank" rel="noopener" title="${n.label}">${icon(n.icon || 'external')}<span class="label">${n.label}</span></a>`
          : html`<a href="#${n.href}" title="${n.label}" data-href="${n.href}" data-also="${(n.also || []).join(' ')}" ${n.exact ? 'data-exact' : ''}>${icon(n.icon || 'file')}<span class="label">${n.label}</span>${n.badge ? html`<span class="nav-badge" data-badge="${n.badge}" hidden></span>` : ''}</a>`,
    )}`);
    document.getElementById('side-foot').textContent = `ATLAS · ${BYLINE}`;
  }

  function renderUserBox() {
    const u = ctx.user;
    const box = document.getElementById('user-box');
    mount(box, html`
      <button type="button" class="user-btn" id="user-btn" aria-haspopup="menu" aria-expanded="false">
        <span class="avatar">${initials(u.name)}</span>
        <span class="who-text"><strong>${u.name}</strong><small>${roleLabel(u.role)}${ctx.info.campusName ? ` · ${ctx.info.campusName}` : ''}</small></span>
        ${icon('chevronDown', 16)}
      </button>
      <div class="menu-pop" id="user-pop" role="menu" hidden>
        <div class="who"><strong>${u.name}</strong><small>${u.username}${u.email ? ` · ${u.email}` : ''}</small><small>${roleLabel(u.role)}${u.studentNo ? ` · ${u.studentNo}` : ''}</small></div>
        <button type="button" id="change-pw">${icon('key')} Change password</button>
        <button type="button" id="sign-out">${icon('logout')} Sign out</button>
        ${campusMenu(ctx.info)}
      </div>`);
    wireCampusMenu(box, config.authBase);
    const pop = box.querySelector('#user-pop');
    const btn = box.querySelector('#user-btn');
    const close = () => {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setDrawer(false); // on phones the menu drawer would cover it
      pop.hidden = !pop.hidden;
      btn.setAttribute('aria-expanded', String(!pop.hidden));
    });
    document.addEventListener('click', (e) => !box.contains(e.target) && close());
    box.querySelector('#change-pw').addEventListener('click', () => {
      close();
      openChangePassword(config.authBase);
    });
    box.querySelector('#sign-out').addEventListener('click', signOut);
  }

  async function refreshBadges() {
    for (const el of document.querySelectorAll('#nav .nav-badge[data-badge]')) {
      const v = await Promise.resolve(config.badges?.[el.dataset.badge]?.()).catch(() => 0);
      // A badge is a count: anything else (a bug upstream) shows nothing rather than garbage.
      const n = Number.isFinite(v) && v > 0 ? v : 0;
      el.textContent = n || '';
      el.hidden = !n;
    }
  }

  // Menu button: folds the sidebar to icons on wide screens, opens it as a drawer on phones.
  const scrim = document.getElementById('nav-scrim');
  const phone = () => matchMedia('(max-width: 960px)').matches;
  function setDrawer(open) {
    document.body.classList.toggle('nav-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    scrim.hidden = !open;
  }
  try {
    if (localStorage.getItem('lms-nav') === 'mini') document.body.classList.add('nav-mini');
  } catch {}
  menuBtn.addEventListener('click', () => {
    if (phone()) return setDrawer(!document.body.classList.contains('nav-open'));
    const mini = document.body.classList.toggle('nav-mini');
    try {
      localStorage.setItem('lms-nav', mini ? 'mini' : 'full');
    } catch {}
  });
  scrim.addEventListener('click', () => setDrawer(false));
  document.getElementById('sidebar').addEventListener('click', (e) => e.target.closest('a[href]') && setDrawer(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setDrawer(false));
  document.getElementById('theme-btn').addEventListener('click', () => setTheme(!isDark()));
  // Back to the University Portal, where the other systems are.
  document.getElementById('theme-btn').insertAdjacentHTML('beforebegin', `<a class="round-btn" href="/" title="All systems" aria-label="All systems">${iconSvg('grid')}</a>`);
  // Help & guides: opens the guide for this person in this system (shared/help.js).
  document.getElementById('theme-btn').insertAdjacentHTML('beforebegin', `<a class="round-btn" id="help-btn" href="/help/?from=${encodeURIComponent(config.side)}" target="_blank" rel="noopener" title="Help & guides" aria-label="Help and guides">${iconSvg('help')}</a>`);

  // A view with unsaved work sets ctx.dirty = () => true; leaving it asks first (and the address goes back).
  let lastHash = location.hash;
  let skipNext = false;
  const leaveOk = () => !ctx.dirty?.() || window.confirm('You have unsaved changes on this page. Leave without saving?');
  window.addEventListener('beforeunload', (e) => {
    if (ctx.dirty?.()) e.preventDefault();
  });
  async function navigate() {
    if (!ctx.user || ctx.user.mustChangePassword) return;
    if (skipNext) {
      skipNext = false;
      return;
    }
    if (location.hash !== lastHash && !leaveOk()) {
      skipNext = true;
      location.hash = lastHash;
      return;
    }
    ctx.dirty = null;
    lastHash = location.hash;
    setDrawer(false);
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); // a dialog belongs to the page it was opened on
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
    // A page that takes a moment says so, instead of staying blank.
    const loading = setTimeout(() => !el.childElementCount && mount(el, html`<p class="page-loading" role="status">Loading…</p>`), 250);
    try {
      cleanup = await match.view(el, params, query);
    } catch (err) {
      mount(el, html`<div class="card empty">${icon('flag', 40)}<h2>Something went wrong</h2><p>${err.message}</p><p class="muted">Is the server still running? Check the window it was started from.</p></div>`);
    } finally {
      clearTimeout(loading);
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
      return mount(document.getElementById('auth'), html`<div class="empty"><h2>Cannot reach the server</h2><p>Start ATLAS (double-click “Start ATLAS”, or <code>npm start</code>), then reload this page.</p></div>`);
    }
    ctx.info = status;
    ctx.user = status.user;
    if (status.roleOverrides) setRoleOverrides(status.roleOverrides); // Roles & permissions (the Admin panel's can())
    applyBranding(status.branding);
    if (!ctx.user) return showAuth((el) => config.signedOutView(el, { status, boot: () => boot({ fresh: true }) }));
    if (ctx.user.mustChangePassword && config.passwordView) return showAuth(config.passwordView);
    if (ctx.user.mustChangePassword) {
      return showAuth((el) => forcePasswordView(el, { admin: config.side === 'admin', authBase: config.authBase, onDone: () => boot({ fresh: true }), onSignOut: signOut }));
    }
    await config.onSignedIn?.();
    document.body.classList.remove('auth-mode', 'booting');
    mount(document.getElementById('auth'), '');
    renderTop();
    renderNav();
    renderUserBox();
    if (fresh || !location.hash || location.hash === '#/') location.hash = `#${config.home()}`;
    navigate();
  }

  // Signing out ends every session (portal and admin) and returns to the University Portal.
  async function signOut() {
    ctx.dirty = null; // signing out on purpose: no "unsaved changes" question
    const out = await api.post('/api/hub/logout').catch(() => ({}));
    ctx.user = null;
    location.href = out?.ssoLogout || '/'; // a Keycloak session ends at Keycloak, which comes back to /
  }

  ctx.refreshBadges = refreshBadges;
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

// Page header: breadcrumbs (when `back` is given), title, a line under it, actions on the right.
// back: [href, label] or a list of them.
export const pageHead = (title, sub = '', actions = '', back = '') => {
  const trail = !back ? [] : Array.isArray(back[0]) ? back : [back];
  return html`
  <div class="page-head">
    <div>
      ${trail.length ? html`<nav class="crumbs" aria-label="Breadcrumb">${trail.map(([href, label]) => html`<a href="#${href}">${label}</a>${icon('chevronRight', 14)}`)}<span class="cur">${typeof title === 'string' ? title : raw(String(title).replace(/<span class="badge[^"]*">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').trim())}</span></nav>` : ''}
      <h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}
    </div>
    ${actions ? html`<div class="actions">${actions}</div>` : ''}
  </div>`;
};

export const badgesChanged = () => window.dispatchEvent(new Event('badges:changed'));
export { raw };
