// The Lancaster ATLAS app frame, shared by ATLAS Learn (portal and admin panel) and ATLAS People: branding, sign-in
// screens, top bar with the user menu, icon sidebar (a drawer on phones), hash router.
import { api } from './api.js';
import { html, mount, modal, toast, initials, formData, raw } from './ui.js';
import { icon, iconSvg } from './icons.js';
import { setRoleOverrides } from '/shared/roles.js';
import { accountRoutes } from './account/profile.js';
import { forceTwoFactorView } from './account/two-factor.js';
import { mountSystems, mountQuick, mountUserMenu, recordVisit } from './account/topbar.js';
import { mountBell } from './account/notifications.js';
import { setBrand, currentBrand, schoolBrand, brand, brandText } from './brand.js';
import { inkOn, readableOn } from '/shared/themes.js';

// App-wide state for the current page set (one per app, since each is its own page).
export const ctx = { user: null, info: null };

// ----- Branding and dark mode -----
// b: the branding the server sends (server/api.js branding()): colours, logo, school name, and
// whose brand leads (mode, shortName: public/js/brand.js).
export function applyBranding(b = {}) {
  setBrand(b);
  const root = document.documentElement.style;
  if (b.brand) root.setProperty('--brand', b.brand);
  if (b.accent) root.setProperty('--accent', b.accent);
  // A school's own accent may be light (a yellow): the text on it and the accent used as text are
  // worked out from it, with a contrast check (shared/themes.js). The presets keep their CSS colours.
  if (b.theme === 'custom' && b.accent) {
    root.setProperty('--accent-ink', inkOn(b.accent));
    root.setProperty('--accent-deep', readableOn(b.accent, '#ffffff', 4.5));
  } else {
    root.removeProperty('--accent-ink');
    root.removeProperty('--accent-deep');
  }
  const meta = document.querySelector('meta[name=theme-color]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
  meta.content = b.brand || '#5d0013';
  const app = brandText(document.body.dataset.app || 'ATLAS');
  document.title = b.schoolName ? `${app} · ${b.schoolName}` : app;
  document.documentElement.classList.toggle('school-brand', schoolBrand());
  setIcons(b);
  const logo = document.getElementById('brand-logo');
  if (logo) drawTopLogo(logo);
  const systems = document.getElementById('sys-btn'); // the Systems menu, made before the branding came
  if (systems) for (const a of ['title', 'aria-label']) systems.setAttribute(a, `${brand()} systems`);
}

// The browser tab's icon and the phone's home-screen icon: the school's seal when its brand leads,
// else ATLAS's (the ones in each page's <head>, kept to switch back).
function setIcons(b) {
  const seal = schoolBrand() && b.logo ? b.logo : '';
  for (const link of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')) {
    if (link.dataset.atlasHref === undefined) {
      link.dataset.atlasHref = link.getAttribute('href') || '';
      link.dataset.atlasType = link.getAttribute('type') || '';
      link.dataset.atlasSizes = link.getAttribute('sizes') || '';
    }
    link.href = seal || link.dataset.atlasHref;
    if (link.dataset.atlasType) link.type = seal ? seal.slice(5, seal.indexOf(';')) : link.dataset.atlasType;
    if (link.dataset.atlasSizes) {
      if (seal) link.removeAttribute('sizes');
      else link.setAttribute('sizes', link.dataset.atlasSizes);
    }
  }
}

// ----- ATLAS identity (docs/BRAND.md) -----
// Kept quiet, as in CORE: one small wordmark per screen, plain product names everywhere else.
export const BYLINE = 'Education platform by Lancaster';
// The mark: the light version (grey ribbon, charcoal pages) or the one for dark backgrounds.
export const markSrc = (onDark = false) => `/img/brand/atlas-mark${onDark ? '-dark' : ''}.svg`;
// The school's own logo when an administrator uploaded one, else the ATLAS mark.
export const logoSrc = (b = ctx.info?.branding, onDark = false) => b?.logo || markSrc(onDark);
// The wordmark in the top bar: ATLAS, then the open product (or the byline on the home page).
// When the school's brand leads, its short name instead ("<short> Learn"), and no byline.
export const atlasWord = (sub) => {
  const line = sub === undefined ? (schoolBrand() ? '' : BYLINE) : sub;
  return html`<span class="atlas-word${schoolBrand() ? ' school-word' : ''}"><strong>${brand()}</strong>${line ? html`<em>${line}</em>` : ''}</span>`;
};
// The mark in light and dark versions; CSS shows the one that fits the theme.
const themedMark = (cls = '') => html`<img class="${cls} mark-lt" src="${markSrc(false)}" alt="" /><img class="${cls} mark-dk" src="${markSrc(true)}" alt="" />`;
// "Powered by ATLAS" with the small mark: the only ATLAS credit when the school's brand leads.
export const poweredBy = (cls = '') => html`<span class="powered-by ${cls}">${themedMark('powered-mark')}<span>Powered by ATLAS</span></span>`;
// The top bar's picture: ATLAS's mark (light or dark), or the school's seal as uploaded when its
// brand leads (none until one is uploaded: the short name stands alone).
function drawTopLogo(img) {
  const seal = schoolBrand() ? currentBrand().logo || '' : '';
  img.src = seal || markSrc(isDark());
  img.classList.toggle('seal', Boolean(seal));
  img.hidden = schoolBrand() && !seal;
}

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
  if (!btn) return;
  btn.innerHTML = iconSvg(isDark() ? 'sun' : 'moon');
  btn.title = isDark() ? 'Light mode' : 'Dark mode';
  const logo = document.getElementById('brand-logo');
  if (logo) drawTopLogo(logo);
}

// ----- Sign-in screens -----
const PORTAL_POINTS = [['cap', 'Enrollment'], ['book', 'Classes'], ['quiz', 'Quizzes'], ['chart', 'Grades']];
const ADMIN_POINTS = [['clipboard', 'Enrollment'], ['layers', 'Catalog'], ['toggles', 'Modules'], ['settings', 'Settings']];

// Every sign-in screen is a bookplate on paper: the school's seal and name at the top, the form
// inside a double rule, and what this sign-in opens along the bottom. Help and dark mode sit above.
const appLine = () => {
  const app = document.body.dataset.app || 'ATLAS';
  return brandText(app === 'ATLAS' ? 'ATLAS' : app.replace(/^ATLAS /, 'ATLAS · ').replace(/ · Admin$/, ' · Admin panel'));
};
// links: more links for the bar at the top (the ATLAS home adds Job openings).
// wide: a plate for a longer form with fields side by side (Create student account).
export function authPlate(el, { line = appLine(), ledger = [], card, links = '', wide = false }) {
  const b = ctx.info?.branding || {};
  const campus = ctx.info?.campusName;
  const open = ledger.filter(([, later]) => !later);
  const soon = ledger.filter(([, later]) => later);
  // The lockup: ATLAS's mark and name, or the school's seal and short name when its brand leads.
  const school = schoolBrand();
  const lockup = school
    ? html`${b.logo ? html`<img class="auth-bar-mark seal" src="${b.logo}" alt="" />` : ''}<strong class="school-lockup">${brand()}</strong>`
    : html`${themedMark('auth-bar-mark')}<strong>ATLAS</strong>`;
  const seal = b.logo
    ? html`<img src="${b.logo}" alt="" />`
    : school ? html`<span class="plate-initials">${brand()}</span>` : html`<img src="/img/brand/atlas-mark-white.svg" alt="" />`;
  mount(el, html`
    <div class="auth-screen">
      <header class="auth-bar">
        <a class="auth-lockup" href="/">${lockup}</a>
        <nav class="auth-links" aria-label="Help and display">
          ${links}
          <a href="/help/" aria-label="Help and guides">${icon('help', 16)} <span>Help &amp; guides</span></a>
          <button type="button" class="link auth-theme" id="auth-theme"></button>
        </nav>
      </header>
      <main class="auth-panel">
        <div class="plate${wide ? ' wide' : ''}">
          <div class="plate-seal${b.logo ? ' own' : ''}">${seal}</div>
          <div class="plate-frame">
            <p class="plate-ex">Ex libris</p>
            <h1 class="plate-school">${b.schoolName || 'ATLAS'}</h1>
            <p class="plate-line">${line}</p>
            <div class="plate-rule" aria-hidden="true"><span></span></div>
            ${b.tagline ? html`<p class="plate-tag">${b.tagline}</p>` : ''}
            ${card}
            ${school ? html`<p class="auth-powered">${poweredBy()}</p>` : ''}
          </div>
        </div>
      </main>
      <footer class="auth-footer">
        ${open.length ? html`<ul class="auth-ledger" aria-label="What this sign-in opens">${open.map(([name]) => html`<li>${name}</li>`)}</ul>` : ''}
        ${soon.length ? html`<p class="auth-soon">Coming soon: ${soon.map(([name]) => name).join(', ')}</p>` : ''}
        <p class="auth-copy">© ${new Date().getFullYear()} ${b.schoolName || 'Lancaster Technology and Development Corporation'}${campus ? ` · ${campus}` : ''}</p>
      </footer>
    </div>`);
  const theme = el.querySelector('#auth-theme');
  const drawTheme = () => {
    const label = isDark() ? 'Light mode' : 'Dark mode';
    theme.innerHTML = `${iconSvg(isDark() ? 'sun' : 'moon', 16)} <span>${label}</span>`;
    theme.setAttribute('aria-label', label);
  };
  drawTheme();
  theme.addEventListener('click', () => {
    setTheme(!isDark());
    drawTheme();
  });
  el.querySelectorAll('[data-toggle-pw]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
    }),
  );
  const form = el.querySelector('form');
  form?.querySelector('input')?.focus();
  return form;
}

export function authScreen(el, { admin = false } = {}, card) {
  const learn = document.body.dataset.app === 'ATLAS Learn';
  const ledger = (admin ? ADMIN_POINTS : learn ? PORTAL_POINTS : []).map(([, name]) => [name]);
  return authPlate(el, { ledger, card });
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
// A message that must outlive a change of page (a session that ended takes the person to the
// sign-in page, which would otherwise say nothing). Shown once, if the page changed just now.
export function toastOnNextPage(message, kind = 'error') {
  try {
    sessionStorage.setItem('atlas-next-toast', JSON.stringify({ message, kind, at: Date.now() }));
  } catch {}
}
try {
  const next = JSON.parse(sessionStorage.getItem('atlas-next-toast') || 'null');
  sessionStorage.removeItem('atlas-next-toast');
  if (next && Date.now() - next.at < 10000) setTimeout(() => toast(next.message, next.kind), 400);
} catch {}

// What to show when a page or the first request fails. The server answered (err.status): say what
// it said; too many requests is a short wait, not a fault. No answer at all: the server cannot be reached.
export function failureNotice(err, { page = false } = {}) {
  if (err?.status === 429) {
    return html`<div class="${page ? 'card ' : ''}empty">${icon('clock', 40)}<h2>Please wait a moment</h2><p>${err.message}</p><p class="muted">ATLAS limits how many requests one person or one network can send in a minute. Nothing is lost.</p><p><button type="button" class="btn primary" data-reload>Try again</button></p></div>`;
  }
  if (err?.status) return html`<div class="${page ? 'card ' : ''}empty">${icon('flag', 40)}<h2>Something went wrong</h2><p>${err.message}</p><p><button type="button" class="btn" data-reload>Try again</button></p></div>`;
  return html`<div class="${page ? 'card ' : ''}empty">${icon('flag', 40)}<h2>Cannot reach the server</h2><p>Check your internet connection, then try again. If ATLAS runs on this computer, start it (double-click “Start ATLAS”, or <code>npm start</code>).</p><p><button type="button" class="btn primary" data-reload>Try again</button></p></div>`;
}
document.addEventListener('click', (e) => e.target.closest?.('[data-reload]') && location.reload());
// A button whose request the server refuses must say why: when nothing else showed the answer,
// it is shown here (otherwise the screen would just do nothing).
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  if (!err?.status || err.status === 401 || !err.message) return;
  e.preventDefault();
  toast(err.message, 'error');
});

// Single sign-on (Keycloak): the button above the password form, and the password fields under it.
// With passwords switched off, the fields fold away under "Administrator sign-in" (a way in if Keycloak is down).
export function ssoBlock(sso, next = '/') {
  if (!sso?.enabled) return '';
  return html`<a class="btn primary block sso-btn" href="/api/sso/start?next=${encodeURIComponent(next)}">${icon('key', 18)} ${sso.label}</a>
    ${sso.passwords ? html`<div class="auth-or"><span>or with your ${schoolBrand() ? '' : 'ATLAS '}password</span></div>` : ''}`;
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
  ctx.authBase = config.authBase;
  // My profile and My security, in every system (public/js/account/).
  const routes = [...accountRoutes(), ...config.routes].map(([pattern, view, allowed = () => true]) => {
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
    mount(document.getElementById('school-name'), atlasWord(config.brandLine || (config.side === 'admin' ? 'Learn · Admin' : config.product || 'Learn')));
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
    document.getElementById('side-foot').textContent = schoolBrand() ? 'Powered by ATLAS' : `ATLAS · ${BYLINE}`;
  }

  // The sidebar item of the page on screen.
  function highlightNav(path) {
    const links = [...document.querySelectorAll('#nav a[data-href]')];
    const hits = (a) => [a.dataset.href, ...a.dataset.also.split(' ').filter(Boolean)].some((p) => path === p || (!a.hasAttribute('data-exact') && path.startsWith(p + '/')));
    const best = links.filter(hits).sort((a, b) => b.dataset.href.length - a.dataset.href.length)[0];
    links.forEach((a) => a.classList.toggle('active', a === best));
  }

  // This app's address, as Quick access keeps it ('/lms/', '/admin', '/hris/'…).
  const appPath = () => (location.pathname.replace(/\/+$/, '') === '/admin' ? '/admin' : location.pathname);
  const productName = () => (config.side === 'admin' && !config.product ? 'Admin panel' : config.product || 'Learn');
  // The page on screen, for Quick access: its sidebar name (or its heading), with the system's name.
  function currentPage() {
    const path = location.hash.replace(/^#/, '').split('?')[0];
    if (!path || !ctx.user) return null;
    const own = { '/profile': 'My profile', '/security': 'My security' }[path];
    const nav = document.querySelector('#nav a.active .label')?.textContent?.trim();
    const h1 = document.querySelector('#app h1')?.textContent?.trim();
    const name = own || (nav && h1 && nav !== h1 && h1.length <= 60 ? `${nav} · ${h1}` : nav || h1);
    if (!name) return null;
    return { href: `${appPath()}${location.hash}`, label: own ? name : `${productName()} · ${name}`.slice(0, 80) };
  }

  function renderUserBox() {
    mountUserMenu(document.getElementById('user-box'), ctx.user, {
      info: ctx.info,
      here: appPath(),
      onPassword: () => openChangePassword(config.authBase),
      onSignOut: signOut,
      onTheme: () => setTheme(!isDark()),
      campusMenu: campusMenu(ctx.info),
      wireCampus: (root) => wireCampusMenu(root, config.authBase),
    });
    if (!document.getElementById('quick-btn')) {
      mountQuick(document.getElementById('help-btn'), {
        user: ctx.user,
        current: currentPage,
        suggestions: () => [
          ...config.nav().filter((n) => n.href && !n.heading && !n.external).slice(0, 4).map((n) => ({ href: `${appPath()}#${n.href}`, label: `${productName()} · ${n.label}`, icon: n.icon })),
          { href: '#/profile', label: 'My profile', icon: 'user' },
          { href: '#/security', label: 'My security', icon: 'shield' },
        ],
      });
    }
    mountBell(document.getElementById('help-btn'), { user: ctx.user, here: appPath() }); // after Quick access
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
  let navAnimTimer = 0;
  menuBtn.addEventListener('click', () => {
    if (phone()) return setDrawer(!document.body.classList.contains('nav-open'));
    // A short transition only when the button is used (not when the page opens folded).
    document.body.classList.add('nav-anim');
    clearTimeout(navAnimTimer);
    navAnimTimer = setTimeout(() => document.body.classList.remove('nav-anim'), 400);
    const mini = document.body.classList.toggle('nav-mini');
    try {
      localStorage.setItem('lms-nav', mini ? 'mini' : 'full');
    } catch {}
  });
  scrim.addEventListener('click', () => setDrawer(false));
  document.getElementById('sidebar').addEventListener('click', (e) => e.target.closest('a[href]') && setDrawer(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setDrawer(false));
  document.getElementById('theme-btn').addEventListener('click', () => setTheme(!isDark()));
  // Help & guides: opens the guide for this person in this system (shared/help.js).
  document.getElementById('theme-btn').insertAdjacentHTML('beforebegin', `<a class="round-btn" id="help-btn" href="/help/?from=${encodeURIComponent(config.side)}" target="_blank" rel="noopener" title="Help & guides" aria-label="Help and guides">${iconSvg('help')}</a>`);
  // The ATLAS systems you can open, the home page and Help (Quick access joins it once signed in).
  mountSystems(document.getElementById('help-btn'));

  // A view with unsaved work sets ctx.dirty = () => true; leaving it asks first (and the address goes back).
  let lastHash = location.hash;
  let skipNext = false;
  const leaveOk = () => !ctx.dirty?.() || window.confirm('You have unsaved changes on this page. Leave without saving?');
  window.addEventListener('beforeunload', (e) => {
    if (ctx.dirty?.()) e.preventDefault();
  });
  async function navigate() {
    if (!ctx.user || ctx.user.mustChangePassword || ctx.user.twoFactorSetupRequired) return;
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

    highlightNav(path);

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
      recordVisit(ctx.user, currentPage()); // Quick access → Recent
    } catch (err) {
      mount(el, failureNotice(err, { page: true }));
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
    } catch (err) {
      document.body.classList.add('auth-mode');
      document.body.classList.remove('booting');
      return mount(document.getElementById('auth'), failureNotice(err));
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
    // The school requires 2-step verification of this account: set it up first (account/two-factor.js).
    if (ctx.user.twoFactorSetupRequired) {
      return showAuth((el) => forceTwoFactorView(el, { admin: config.side === 'admin', onDone: () => boot({ fresh: true }), onSignOut: signOut }));
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
  // The top bar and the sidebar again, in new branding (Settings → Branding), the page staying as it is.
  ctx.redrawFrame = (branding) => {
    if (branding) ctx.info.branding = branding;
    renderTop();
    renderNav();
    highlightNav(location.hash.replace(/^#/, '').split('?')[0] || config.home());
    refreshBadges();
  };
  window.addEventListener('hashchange', navigate);
  window.addEventListener('badges:changed', refreshBadges);
  window.addEventListener('auth:expired', () => {
    if (!ctx.user) return;
    ctx.user = null;
    toast('Your session has ended. Please sign in again.', 'error');
    toastOnNextPage('Your session has ended. Please sign in again.'); // Learn, People, Academic and Finance go to the home page to sign in
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
