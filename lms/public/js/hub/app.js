// ATLAS home (/): one sign-in, then a card for each system the account may use (Academic,
// Learn, People, Finance, Facilities). Systems that are not built yet show as "Coming soon".
import { api } from '../api.js';
import { html, mount, option, initials, timeAgo, fmtDate, toast } from '../ui.js';
import { ctx, applyBranding, failureNotice, authPlate, atlasWord, markSrc, BYLINE, poweredBy, ssoBlock, passwordFields, showSsoError, passwordField, onFormSubmit, forcePasswordView, openChangePassword, setTheme, isDark, renderThemeButton, campusMenu, wireCampusMenu } from '../shell.js';
import { icon, iconSvg } from '../icons.js';
import { roleLabel, userCan } from '/shared/roles.js';
import { mountUserMenu, mountQuick, mountSystems, accountHref } from '../account/topbar.js';
import { mountBell } from '../account/notifications.js';
import { orderSystems, canOpen } from '/shared/systems.js';
import { codeStep, forceTwoFactorView } from '../account/two-factor.js';
import { schoolBrand, brand, brandHome, brandText } from '../brand.js';

const authEl = document.getElementById('auth');
const appEl = document.getElementById('app');
const NEXT_OK = { portal: ['/lms/', '/hris/', '/academic/', '/finance/', '/tools/', '/documents/', '/help/'], admin: ['/admin', '/hris/', '/academic/', '/finance/', '/tools/', '/documents/', '/help/'], hris: ['/hris/', '/finance/', '/tools/', '/documents/', '/help/'] };
const next = new URLSearchParams(location.search).get('next');

document.getElementById('theme-btn').addEventListener('click', () => setTheme(!isDark()));

function showAuth(render) {
  document.body.classList.add('auth-mode');
  document.body.classList.remove('booting');
  render(authEl);
}

// ----- Signed out -----
function hubScreen(card, systems, line) {
  return authPlate(authEl, {
    line,
    card,
    ledger: [...systems.filter((s) => s.status === 'live'), ...systems.filter((s) => s.status !== 'live')].map((s) => [s.product, s.status !== 'live']),
  });
}

function signInView(status) {
  if (status.setupRequired) {
    return hubScreen(html`<div class="auth-card"><h2>Not set up yet</h2><p class="muted">An administrator needs to set up the system first: create the administrator account and name the school.</p><a class="btn primary block" href="/admin">Set up in the admin panel</a></div>`, status.systems);
  }
  const form = hubScreen(html`
    <form class="auth-card" novalidate>
      <h2 class="sr-only">Sign in</h2>
      ${ssoBlock(status.sso, next || '/')}
      ${passwordFields(status.sso, html`<label class="field"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      ${passwordField('Password', 'password', 'current-password')}
      <button class="btn ${status.sso?.enabled ? '' : 'primary'} block" type="submit">Sign in</button>`)}
      <p class="form-error" hidden></p>
      ${status.registrationOpen ? html`<p class="auth-switch">New student? <button type="button" class="link" id="apply">Apply for admission</button></p>` : ''}
      <p class="auth-foot">${status.sso?.enabled && !status.sso.passwords ? 'Trouble signing in? Ask the registrar or your administrator.' : 'Forgot your password? Ask the registrar or your administrator to reset it.'}</p>
    </form>`, status.systems, brandText('ATLAS · Sign in'));
  form.querySelector('#apply')?.addEventListener('click', () => applyView(status));
  showSsoError(form);
  onFormSubmit(form, async ({ username, password }) => {
    if (!username || !password) throw new Error('Enter your username and password.');
    const res = await api.post('/api/hub/login', { username, password });
    // With 2-step verification on, the code from the authenticator app comes next.
    if (res.twoFactorRequired) {
      return codeStep({ render: (card) => hubScreen(card, status.systems, brandText('ATLAS · Sign in')), verifyUrl: '/api/hub/login/verify', challenge: res.challenge, onSignedIn: boot, onBack: () => signInView(status) });
    }
    boot();
  });
}

function applyView(status) {
  const back = () => signInView(status);
  const form = hubScreen(html`
    <form class="auth-card" novalidate>
      <h2 class="sr-only">Apply for admission</h2>
      <p class="muted">The registrar reviews your application; you can sign in once you are admitted.</p>
      <label class="field"><span>Full name</span><input name="name" autocomplete="name" required /></label>
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required /></label>
      <label class="field" id="campus-field" hidden><span>Campus</span><select name="campusId" id="campuses"></select></label>
      <label class="field"><span>Program</span><select name="programId" id="programs">${option('', 'Undecided')}</select></label>
      <label class="field"><span>Year level</span><select name="yearLevel">${[1, 2, 3, 4, 5].map((y) => option(y, `Year ${y}`))}</select></label>
      <label class="field"><span>Choose a username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      ${passwordField('Choose a password (at least 8 characters)', 'password', 'new-password')}
      <label class="field"><span>Anything the registrar should know? (optional)</span><textarea name="note" style="min-height:70px"></textarea></label>
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Send application</button>
      <p class="auth-switch"><button type="button" class="link" id="back">← Back to sign in</button></p>
    </form>`, status.systems, brandText('ATLAS · Apply for admission'));
  api.get('/api/auth/programs').then((programs) => {
    form.querySelector('#programs').insertAdjacentHTML('beforeend', String(html`${programs.map((p) => option(p.id, `${p.code} · ${p.name}`))}`));
  });
  api.get('/api/auth/campuses').then((campuses) => {
    if (campuses.length < 2) return;
    form.querySelector('#campus-field').hidden = false;
    form.querySelector('#campuses').innerHTML = String(html`${option('', 'Choose a campus…')}${campuses.map((c) => option(c.id, c.name))}`);
  });
  form.querySelector('#back').addEventListener('click', back);
  onFormSubmit(form, async (v) => {
    await api.post('/api/auth/apply', v);
    hubScreen(html`<div class="auth-card"><h2>Application sent</h2><p>Thank you, ${v.name}. The registrar will review it; once you are admitted, sign in here with the username <strong>${v.username.toLowerCase()}</strong>.</p><button class="btn primary block" id="ok">Back to sign in</button></div>`, status.systems);
    authEl.querySelector('#ok').addEventListener('click', back);
  });
}

// ----- Signed in -----
// The menu under your name and Quick access, as in every system (public/js/account/topbar.js).
function userMenu(status) {
  mountUserMenu(document.getElementById('user-box'), status.user, {
    info: status,
    here: '/',
    onPassword: () => openChangePassword(status.authBase),
    onSignOut: signOut,
    onTheme: () => setTheme(!isDark()),
    campusMenu: campusMenu(status),
    wireCampus: (root) => wireCampusMenu(root, status.authBase),
  });
  if (document.getElementById('quick-btn')) return;
  mountSystems(document.getElementById('help-btn'));
  mountQuick(document.getElementById('help-btn'), {
    user: status.user,
    current: () => null, // the home page itself is one click away (the mark in the top bar)
    suggestions: () => [
      ...status.systems.filter((s) => s.status === 'live' && s.url && !s.external).map((s) => ({ href: s.url, label: s.product, icon: s.icon })),
      ...(status.tools || []).map((t) => ({ href: t.path, label: t.product, icon: t.icon })),
      { href: accountHref(status.user, 'profile'), label: 'My profile', icon: 'user' },
      { href: accountHref(status.user, 'security'), label: 'My security', icon: 'shield' },
    ],
  });
  mountBell(document.getElementById('help-btn'), { user: status.user, here: '/' }); // after Quick access
}

const dateBox = (ymd) => {
  const d = new Date(`${ymd}T00:00:00`);
  return html`<div class="date-box"><b>${d.toLocaleDateString('en-PH', { month: 'short' })}</b><span>${d.getDate()}</span></div>`;
};

// A name never breaks at its hyphen ("e-Reader" stays whole): the hyphens become non-breaking ones.
const noBreak = (name) => String(name).replace(/-/g, '\u2011');

function systemCard(s, side, figures = []) {
  const live = s.status === 'live' && s.url;
  // The admin panel has its own place under Administration; from here it is where Learn is run.
  const openLabel = s.id === 'lms' && side === 'admin' ? 'Manage Learn' : `Open ${s.product}`;
  const body = html`
    <span class="sys-top"><span class="sys-ic">${icon(s.icon, 26)}</span>${live ? html`<span class="sys-code">${s.short}</span>` : html`<span class="badge gray">${icon('lock', 12)} Coming soon</span>`}</span>
    <span class="sys-name" title="${s.title}">${noBreak(s.product)}</span>
    <p>${s.description}</p>
    ${live && figures.length ? html`<ul class="sys-figs">${figures.map((f) => html`<li>${f}</li>`)}</ul>` : ''}
    <span class="sys-open">${live ? html`${openLabel} ${icon(s.external ? 'external' : 'chevronRight', 16)}` : 'Not available yet'}</span>`;
  return live
    ? html`<a class="sys-card" href="${s.url}" data-system="${s.id}" ${s.external ? html`target="_blank" rel="noopener"` : ''}>${body}</a>`
    : html`<div class="sys-card soon" data-system="${s.id}" aria-disabled="true" title="${s.product} is coming soon">${body}</div>`;
}

// The star that pins a system to the front (after CORE's home, 0.40).
const pinButton = (s, on, size = 18) => html`<button type="button" class="sys-pin" data-pin="${s.id}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${on ? `Unpin ${s.product}` : `Pin ${s.product} to the front`}" title="${on ? 'Pinned to the front: click to unpin' : 'Pin to the front'}">${icon('star', size)}</button>`;
// A card in the sliding row: a system you can open has its star.
const cardSlot = (s, side, figures, on) => (canOpen(s) ? html`<div class="sys-slot${on ? ' pinned' : ''}" data-system="${s.id}">${systemCard(s, side, figures)}${pinButton(s, on)}</div>` : systemCard(s, side));
// A tile in the compact view (CORE 0.46): every system at once, the first figure (or what it is) under its name.
function miniTile(s, figures, on) {
  if (!canOpen(s)) return html`<div class="sys-mini soon" data-system="${s.id}" aria-disabled="true" title="${s.product}: coming soon"><span class="sys-ic">${icon(s.icon, 20)}</span><span class="grow"><strong>${noBreak(s.product)}</strong><small>${icon('lock', 11)} Coming soon</small></span></div>`;
  return html`<div class="sys-mini-slot${on ? ' pinned' : ''}" data-system="${s.id}"><a class="sys-mini" href="${s.url}" title="Open ${s.product}" ${s.external ? html`target="_blank" rel="noopener"` : ''}><span class="sys-ic">${icon(s.icon, 20)}</span><span class="grow"><strong>${noBreak(s.product)}</strong><small>${figures[0] || s.title}</small></span></a>${pinButton(s, on, 16)}</div>`;
}

// "Your systems" as a carousel: the cards scroll sideways and snap into place (swipe on a phone,
// arrows or dots elsewhere, or arrow keys once the row has focus). Live systems come first.
// The arrows and dots only show when some cards are out of view.
// Returns a function to call after the cards are redrawn (a system pinned or unpinned).
function systemsCarousel(wrap) {
  const track = wrap.querySelector('#sys-track');
  const arrows = document.querySelector('.sys-arrows');
  const prev = document.getElementById('sys-prev');
  const next = document.getElementById('sys-next');
  const dots = document.getElementById('sys-dots');
  const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  const cardStep = () => (track.children[1] ? track.children[1].offsetLeft - track.children[0].offsetLeft : track.clientWidth);
  const perPage = () => Math.max(1, Math.round(track.clientWidth / cardStep()));
  const pages = () => Math.max(1, Math.ceil(track.children.length / perPage() - 0.01));
  const atEnd = () => track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
  const pageNow = () => (atEnd() ? pages() - 1 : Math.min(pages() - 1, Math.round(track.scrollLeft / (cardStep() * perPage()))));
  const goPage = (n) => track.scrollTo({ left: Math.max(0, n) * cardStep() * perPage(), behavior: smooth() });
  let drawn = -1;
  const update = () => {
    const overflow = track.scrollWidth > track.clientWidth + 2;
    arrows.hidden = !overflow;
    dots.hidden = !overflow;
    wrap.classList.toggle('more-left', overflow && track.scrollLeft > 4);
    wrap.classList.toggle('more-right', overflow && track.scrollLeft + track.clientWidth < track.scrollWidth - 4);
    prev.disabled = track.scrollLeft <= 4;
    next.disabled = atEnd();
    if (!overflow) return;
    if (drawn !== pages()) {
      drawn = pages();
      dots.innerHTML = Array.from({ length: drawn }, (_, i) => `<button type="button" data-page="${i}" aria-label="Systems, page ${i + 1} of ${drawn}"></button>`).join('');
    }
    [...dots.children].forEach((d, i) => d.setAttribute('aria-current', i === pageNow() ? 'true' : 'false'));
  };
  prev.addEventListener('click', () => goPage(pageNow() - 1));
  next.addEventListener('click', () => goPage(pageNow() + 1));
  dots.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) goPage(Number(b.dataset.page));
  });
  track.addEventListener('keydown', (e) => {
    if (e.target !== track || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    track.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * cardStep(), behavior: smooth() });
  });
  // A card reached with Tab is brought fully into view.
  track.addEventListener('focusin', (e) => {
    const card = e.target.closest('.sys-slot, .sys-card');
    if (card && card !== track) card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth() });
  });
  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  }, { passive: true });
  new ResizeObserver(update).observe(track);
  update();
  return () => {
    drawn = -1;
    update();
  };
}

// Administration, as on CORE's home page: the admin panel, and shortcuts to the pages in it that
// apply to every system. Only for accounts that open the admin panel (administrators, registrars),
// and each shortcut only for those whose account may open that page.
function administration(status) {
  const u = status.user;
  if (status.side !== 'admin' || !userCan(u, 'dashboard')) return '';
  const admin = u.role === 'admin';
  const tiles = [
    admin && ['/admin#/system/users', 'users', 'Users & Access', 'Every account, its access and sign-in'],
    userCan(u, 'settings.edit') && ['/admin#/config', 'search', 'Settings center', 'Every setting, its history and undo'],
    admin && ['/admin#/system/audit', 'table', 'Audit log', 'Sign-ins, changes and refused requests'],
    userCan(u, 'enrollment.manage') && ['/admin#/enrollment', 'clipboard', 'Enrollment requests', 'Waiting for the registrar'],
    userCan(u, 'students.manage') && ['/admin#/applicants', 'userPlus', 'Applicants', 'Applications for admission'],
  ].filter(Boolean).slice(0, 3);
  tiles.push(['/help/#/whats-new', 'sparkle', 'What\'s new', 'What changed in each update']);
  const covers = admin
    ? 'Users and access, campuses, the catalog, modules, the Settings center, branding, sign-in security, data and backups'
    : 'Enrollment, applicants and students, the catalog, terms and sections, news and the school calendar';
  return html`<section class="hub-wrap" aria-labelledby="admin-heading">
    <div class="card-head"><h2 id="admin-heading">${icon('settings')} Administration</h2><span class="muted small">Applies to every system</span></div>
    <a class="admin-hero" href="/admin">
      <span class="admin-hero-ic">${icon('shield', 26)}</span>
      <span class="grow"><strong>Admin panel</strong><small>${covers}</small></span>
      <span class="admin-hero-open">Open ${icon('chevronRight', 16)}</span>
    </a>
    <div class="admin-tiles">${tiles.map(([href, ic, title, sub]) => html`<a class="admin-tile" href="${href}"><span class="ic-box">${icon(ic, 20)}</span><span class="grow"><strong>${title}</strong><small>${sub}</small></span>${icon('chevronRight', 16)}</a>`)}</div>
  </section>`;
}

// Tools (/tools/): PDF Studio and the like, for the account types an administrator switched them on
// for (Admin panel → Home page & systems → Tools). One tile each, under the systems.
function toolsSection(status, view) {
  const tools = status.tools || [];
  if (!tools.length) return '';
  const card = (t) => html`<a class="sys-card tool-card int-${t.accent || 'red'}" href="${t.path}" data-tool="${t.id}">
      <span class="sys-top"><span class="sys-ic">${icon(t.icon || 'file', 24)}</span><span class="tool-badge">${t.code}</span></span>
      <span class="sys-name">${t.product}</span>
      <p>${t.description}</p>
      ${(t.features || []).length ? html`<ul class="tool-feats" aria-label="What it does">${t.features.map((f) => html`<li>${f}</li>`)}</ul>` : ''}
      <span class="sys-open">Open ${t.product} ${icon('chevronRight', 16)}</span>
    </a>`;
  const mini = (t) => html`<a class="sys-mini tool-mini int-${t.accent || 'red'}" href="${t.path}" data-tool="${t.id}"><span class="sys-ic">${icon(t.icon || 'file', 20)}</span><span class="grow"><strong>${t.product}</strong><small>${t.title}</small></span></a>`;
  return html`<section class="hub-wrap sys-section tool-section${view === 'compact' ? ' compact' : ''}" id="tool-section" aria-labelledby="tools-heading">
    <div class="card-head"><h2 id="tools-heading">${icon('grid')} Tools</h2><span class="muted small">For any work, in any system</span></div>
    <div class="tool-grid">${tools.map(card)}</div>
    <div class="sys-compact">${tools.map(mini)}</div>
  </section>`;
}

async function homeView(status) {
  const u = status.user;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  // Pinned first (in the order pinned), then the others you can open, then coming soon (shared/systems.js).
  const pinned = () => (u.favoriteSystems || []).filter((id) => status.systems.some((s) => s.id === id && canOpen(s)));
  const ordered = () => orderSystems(status.systems, pinned());
  const live = status.systems.filter(canOpen).length;
  const soon = status.systems.length - live;
  let figures = {};
  const trackItems = () => html`${ordered().map((s) => cardSlot(s, status.side, figures[s.id] || [], pinned().includes(s.id)))}`;
  const compactItems = () => html`${ordered().map((s) => miniTile(s, figures[s.id] || [], pinned().includes(s.id)))}`;
  // Cards (the sliding row) or Compact (all at once), kept in this browser; a phone starts in Compact.
  const VIEW_KEY = 'atlas-home-view';
  let view = matchMedia('(max-width: 760px)').matches ? 'compact' : 'cards';
  try {
    const chosen = localStorage.getItem(VIEW_KEY);
    if (chosen === 'compact' || chosen === 'cards') view = chosen;
  } catch {}
  mount(appEl, html`
    <section class="hub-hero">${schoolBrand() ? (status.branding.logo ? html`<img class="hero-mark hero-seal" src="${status.branding.logo}" alt="" />` : '') : html`<img class="hero-mark" src="/img/brand/atlas-mark-white.svg" alt="" />`}<div class="hub-wrap">
      <p class="hub-kicker">${new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${status.branding.termName ? ` · ${status.branding.termName}` : ''}</p>
      <h1>${hello}, ${u.name.split(' ')[0]}</h1>
      <p>${schoolBrand() ? `Welcome to ${brand()}'s online services. Choose a system to continue.` : `Welcome to ATLAS, the education platform of ${status.branding.schoolName}. Choose a system to continue.`}</p>
      <a class="hub-role" href="${accountHref(u, 'profile')}" title="My profile">${icon('user', 14)} ${u.title || roleLabel(u.role)}${u.studentNo ? ` · ${u.studentNo}` : ''}</a>
      ${status.campusName ? html`<span class="hub-role">${icon('building', 14)} ${status.campusName}${status.campuses.length > 1 ? html` · <button type="button" class="link hub-switch" id="hub-switch">switch</button>` : ''}</span>` : ''}
    </div></section>
    <section class="hub-wrap sys-section${view === 'compact' ? ' compact' : ''}" id="sys-section">
      <div class="card-head"><h2 id="sys-heading">${icon('grid')} Your systems</h2>
        <div class="sys-nav"><span class="muted small sys-count">${live} available to you${soon ? ` · ${soon} coming soon` : ''}</span>
          <div class="seg-btns sys-view" role="group" aria-label="How to show the systems">${[['cards', 'Cards', 'Large cards with live figures, in a sliding row'], ['compact', 'Compact', 'Every system at once, in a grid']].map(([k, label, title]) => html`<button type="button" data-view="${k}" class="${view === k ? 'active' : ''}" aria-pressed="${view === k ? 'true' : 'false'}" title="${title}">${label}</button>`)}</div>
          <span class="sys-arrows" hidden><button type="button" class="icon-btn" id="sys-prev" aria-label="Previous systems" aria-controls="sys-track">${icon('chevronLeft', 18)}</button><button type="button" class="icon-btn" id="sys-next" aria-label="More systems" aria-controls="sys-track">${icon('chevronRight', 18)}</button></span></div></div>
      <div class="sys-carousel" id="sys-carousel">
        <div class="sys-track" id="sys-track" role="region" aria-labelledby="sys-heading" tabindex="0">${trackItems()}</div>
      </div>
      <div class="sys-dots" id="sys-dots" hidden></div>
      <div class="sys-compact" id="sys-compact" role="region" aria-labelledby="sys-heading">${compactItems()}</div>
    </section>
    ${toolsSection(status, view)}
    ${administration(status)}
    <section class="hub-wrap cols wide-left" id="feed"></section>
    <footer class="hub-foot"><div class="hub-wrap"><span>© ${new Date().getFullYear()} ${status.branding.schoolName}</span>${schoolBrand() ? html`<span class="atlas-foot">${poweredBy()}</span>` : html`<span class="atlas-foot"><img src="${markSrc(isDark())}" alt="" />ATLAS · ${BYLINE}</span>`}</div></footer>`);
  const refresh = systemsCarousel(appEl.querySelector('#sys-carousel'));
  const track = appEl.querySelector('#sys-track');
  const compact = appEl.querySelector('#sys-compact');
  const section = appEl.querySelector('#sys-section');
  const redraw = () => {
    mount(track, trackItems());
    mount(compact, compactItems());
    refresh();
  };
  appEl.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {}
    section.classList.toggle('compact', view === 'compact');
    appEl.querySelector('#tool-section')?.classList.toggle('compact', view === 'compact');
    appEl.querySelectorAll('[data-view]').forEach((x) => {
      x.classList.toggle('active', x.dataset.view === view);
      x.setAttribute('aria-pressed', String(x.dataset.view === view));
    });
    if (view === 'cards') refresh();
  }));
  // Pin or unpin: saved on the account (it follows you), then both views are redrawn in the new
  // order with the focus kept on the same star.
  const onPin = async (e) => {
    const btn = e.target.closest('[data-pin]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.dataset.pin;
    const was = pinned();
    const next = was.includes(id) ? was.filter((x) => x !== id) : [...was, id];
    btn.disabled = true;
    try {
      u.favoriteSystems = (await api.put('/api/me/favorite-systems', { systems: next })).favoriteSystems;
    } catch (err) {
      btn.disabled = false;
      return toast(err.message || 'Could not save your pinned systems.', 'error');
    }
    redraw();
    track.scrollTo({ left: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    (view === 'compact' ? compact : track).querySelector(`[data-pin="${id}"]`)?.focus({ preventScroll: true });
    window.dispatchEvent(new Event('systems:changed')); // the Systems menu puts pinned ones first too
    const name = status.systems.find((s) => s.id === id)?.product || id;
    toast(next.includes(id) ? `${name} is pinned: it comes first on your ${brandHome()}.` : `${name} is no longer pinned.`);
  };
  track.addEventListener('click', onPin);
  compact.addEventListener('click', onPin);
  // A few live figures on each card, once they are worked out (the page does not wait for them).
  api.get('/api/hub/figures').then((f) => {
    figures = f || {};
    if (appEl.contains(track)) redraw();
  }).catch(() => {});
  appEl.querySelector('#hub-switch')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('user-pop').hidden = false;
  });
  const feed = await api.get('/api/hub/feed').catch(() => ({ news: [], events: [] }));
  if (!feed.news.length && !feed.events.length) return appEl.querySelector('#feed').remove();
  mount(appEl.querySelector('#feed'), html`
    <section class="card"><div class="card-head"><h2>${icon('news')} Announcements</h2></div>
      ${feed.news.length ? html`<div class="list">${feed.news.map((n) => html`<div class="list-item"><span class="item-ic">${icon(n.pinned ? 'pin' : 'megaphone')}</span>
        <span class="grow"><strong>${n.title}</strong><small>${n.authorName} · ${timeAgo(n.createdAt)}${n.comments ? ` · ${n.comments} comment${n.comments === 1 ? '' : 's'}` : ''}</small>${n.body ? html`<p class="small pre" style="margin:6px 0 0">${n.body}${n.body.length >= 280 ? '…' : ''}</p>` : ''}</span></div>`)}</div>` : html`<p class="muted">No announcements.</p>`}
    </section>
    <section class="card"><div class="card-head"><h2>${icon('calendar')} Upcoming events</h2></div>
      ${feed.events.length ? html`<div class="list">${feed.events.map((e) => html`<div class="list-item">${dateBox(e.startDate)}<span class="grow"><strong>${e.title}</strong><small>${fmtDate(e.startDate)}${e.endDate && e.endDate !== e.startDate ? ` – ${fmtDate(e.endDate)}` : ''}${e.location ? ` · ${e.location}` : ''}</small></span></div>`)}</div>` : html`<p class="muted">Nothing scheduled.</p>`}
    </section>`);
}

async function signOut() {
  const out = await api.post('/api/hub/logout').catch(() => ({}));
  location.href = out?.ssoLogout || '/'; // a Keycloak session ends at Keycloak, which comes back here
}

async function boot() {
  let status;
  try {
    status = await api.get('/api/hub/status');
  } catch (err) {
    return showAuth((el) => mount(el, failureNotice(err)));
  }
  ctx.info = status;
  ctx.user = status.user;
  applyBranding(status.branding);
  document.title = `${brand()} · ${status.branding.schoolName}`;
  if (!status.user) return showAuth(() => signInView(status));
  if (status.user.mustChangePassword) {
    return showAuth((el) => forcePasswordView(el, { admin: status.side === 'admin', authBase: status.authBase, onDone: boot, onSignOut: signOut }));
  }
  if (status.user.twoFactorSetupRequired) {
    return showAuth((el) => forceTwoFactorView(el, { render: (card) => hubScreen(card, status.systems, brandText('ATLAS · 2-step verification')), onDone: boot, onSignOut: signOut }));
  }
  // Came from a system that needed a sign-in: go straight back there.
  if (next && NEXT_OK[status.side]?.includes(next)) return location.replace(next);
  document.body.classList.remove('auth-mode', 'booting');
  mount(authEl, '');
  mount(document.getElementById('school-name'), atlasWord());
  mount(document.getElementById('brand-sub'), html`${status.branding.schoolName}${status.campusName ? html` · <strong class="campus-name">${status.campusName}</strong>` : ''}${status.branding.termName ? ` · ${status.branding.termName}` : ''}`);
  renderThemeButton();
  const helpBtn = document.getElementById('help-btn');
  helpBtn.innerHTML = iconSvg('help');
  helpBtn.hidden = false;
  userMenu(status);
  homeView(status);
}

window.addEventListener('auth:expired', () => boot());
boot();
