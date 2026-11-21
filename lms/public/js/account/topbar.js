// The top bar's quick access, after CORE ERP's top bar (public/js/app.js at the repository root),
// for every ATLAS system and the home page:
//   Systems       the grid: the ATLAS systems you can open, the home page and Help
//   Quick access  the lightning: pages you pinned (kept on the server, so they follow you), pages you
//                 opened recently (this browser), suggestions until you pin any; pin this page
//   your name     picture, name and title; My profile, Add/Change my picture, My security, Change
//                 password, Dark mode (phones), Switch campus, Sign out
import { api } from '../api.js';
import { html, mount, toast } from '../ui.js';
import { icon, iconSvg } from '../icons.js';
import { roleLabel, ROLES } from '/shared/roles.js';
import { orderSystems, canOpen } from '/shared/systems.js';
import { avatar, avatarAt, editMyAvatar, loadAvatars } from './avatars.js';

const QUICK_MAX = 12;
const RECENT_KEEP = 12;
const RECENT_SHOW = 6;
// Where each account type's own pages (profile, security) are: the system it signs in to.
const HOME_APP = { portal: '/lms/', admin: '/admin', hris: '/hris/' };
export const accountHref = (user, page, here = null) => {
  const app = HOME_APP[ROLES[user?.role]?.side] || HOME_APP.portal;
  return here && here === app ? `#/${page}` : `${app}#/${page}`;
};

// ----- Popovers: one open at a time; Escape, a click outside or another page closes -----
const open = new Set();
window.addEventListener('hashchange', () => [...open].forEach((close) => close()));
function popover(btn, pop, { onOpen } = {}) {
  const close = (focus = false) => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    open.delete(close);
    if (focus) btn.focus();
  };
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!pop.hidden) return close();
    for (const other of [...open]) other();
    document.body.classList.remove('nav-open'); // the phone drawer would cover it
    await onOpen?.();
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    open.add(close);
  });
  document.addEventListener('click', (e) => !pop.hidden && !pop.contains(e.target) && !btn.contains(e.target) && close());
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    const items = [...pop.querySelectorAll('a[href], button:not([disabled])')];
    const i = items.indexOf(document.activeElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined || !items.length) return;
    e.preventDefault();
    items[(next + items.length) % items.length].focus();
  });
  return close;
}

// ----- Systems: every ATLAS system as a tile, as CORE's modules menu (0.45) -----
// Openable first (pinned ones lead, with a star; the one you are in highlighted), then the ones
// coming soon, greyed; ATLAS home and Help below. Pinned with the star on the ATLAS home.
const shortName = (s) => (s.product.length > 12 ? s.short || s.product : s.product);
export function mountSystems(beforeEl) {
  const wrap = document.createElement('div');
  wrap.className = 'top-pop-wrap';
  wrap.innerHTML = `<button type="button" class="round-btn" id="sys-btn" title="ATLAS systems" aria-label="ATLAS systems" aria-haspopup="menu" aria-expanded="false">${iconSvg('grid')}</button><div class="menu-pop top-pop sys-pop" id="sys-pop" role="menu" hidden></div>`;
  beforeEl.before(wrap);
  const pop = wrap.querySelector('#sys-pop');
  let status = null;
  window.addEventListener('systems:changed', () => (status = null));
  popover(wrap.querySelector('#sys-btn'), pop, {
    async onOpen() {
      if (!status) status = await api.get('/api/hub/status').catch(() => ({ systems: [] }));
      const pins = status.user?.favoriteSystems || [];
      const here = location.pathname.replace(/\/+$/, '/');
      const isHere = (s) => s.url && s.url !== '/' && (here === s.url || here.startsWith(s.url) || (s.url === '/admin' && here.startsWith('/admin')));
      const tile = (s) => {
        if (!canOpen(s)) return html`<span class="mod-tile soon" role="menuitem" aria-disabled="true" title="${s.product}: coming soon"><span class="mod-ic">${icon(s.icon || 'grid', 20)}</span><span class="mod-name">${shortName(s)}</span><span class="mod-tag">Soon</span></span>`;
        const on = isHere(s);
        return html`<a role="menuitem" class="mod-tile${on ? ' on' : ''}" href="${s.url}" ${on ? 'aria-current="page"' : ''} title="${s.name}${pins.includes(s.id) ? ' · pinned' : ''}" ${s.external ? html`target="_blank" rel="noopener"` : ''}>${pins.includes(s.id) ? html`<span class="mod-pin" aria-hidden="true">${icon('star', 12)}</span>` : ''}<span class="mod-ic">${icon(s.icon || 'grid', 20)}</span><span class="mod-name">${shortName(s)}</span></a>`;
      };
      mount(pop, html`<div class="menu-label">ATLAS systems</div>
        <div class="mod-grid">${orderSystems(status.systems || [], pins).map(tile)}</div>
        <div class="menu-sep"></div>
        <a role="menuitem" href="/">${icon('home')}<span class="grow">ATLAS home</span></a>
        <a role="menuitem" href="/help/" target="_blank" rel="noopener">${icon('help')}<span class="grow">Help &amp; guides</span></a>`);
    },
  });
}

// ----- Quick access -----
const recentKey = (user) => `atlas-recent:${user.id}`;
function readRecent(user) {
  try {
    const list = JSON.parse(localStorage.getItem(recentKey(user)) || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x?.href === 'string' && typeof x?.label === 'string') : [];
  } catch {
    return [];
  }
}
// A page just opened (newest first, once each). Only pages inside ATLAS's systems.
export function recordVisit(user, page) {
  if (!user || !page?.href || !page.label || !/^\/(lms\/|admin|hris\/|academic\/|finance\/)#\//.test(page.href)) return;
  const list = [page, ...readRecent(user).filter((x) => x.href !== page.href)].slice(0, RECENT_KEEP);
  try {
    localStorage.setItem(recentKey(user), JSON.stringify(list));
  } catch {}
}

// current(): { href, label } of the page on screen (null where nothing can be pinned).
// suggestions(): [{ href, label, icon }] shown until something is pinned.
export function mountQuick(beforeEl, { user, current = () => null, suggestions = () => [] }) {
  const wrap = document.createElement('div');
  wrap.className = 'top-pop-wrap';
  wrap.innerHTML = `<button type="button" class="round-btn" id="quick-btn" title="Quick access" aria-label="Quick access" aria-haspopup="dialog" aria-expanded="false">${iconSvg('bolt')}</button><div class="menu-pop top-pop quick-pop" id="quick-pop" role="dialog" aria-label="Quick access" hidden></div>`;
  beforeEl.before(wrap);
  const pop = wrap.querySelector('#quick-pop');
  let pins = null;
  const save = async (next) => {
    pins = (await api.put('/api/me/quick-links', { links: next })).links;
    draw();
  };
  const link = (x, extra = '') => html`<a href="${x.href}" class="quick-link">${icon(x.icon || 'link')}<span class="grow">${x.label}</span></a>${extra}`;
  function draw() {
    const here = current();
    const pinned = here && pins.some((x) => x.href === here.href);
    const recent = readRecent(user).filter((x) => !pins.some((p) => p.href === x.href) && x.href !== here?.href).slice(0, RECENT_SHOW);
    const full = pins.length >= QUICK_MAX;
    mount(pop, html`<div class="quick-head"><strong>Quick access</strong></div>
      <div class="menu-label">Pinned</div>
      ${pins.length ? html`<ul class="quick-list">${pins.map((x, i) => html`<li>${link({ ...x, icon: 'pin' }, html`<button type="button" class="quick-x" data-unpin="${i}" aria-label="Unpin ${x.label}" title="Unpin">×</button>`)}</li>`)}</ul>`
        : html`<p class="menu-note">Pin the pages you use most: open one, then choose <strong>Pin this page</strong>.</p>`}
      ${recent.length ? html`<div class="menu-label">Recent</div><ul class="quick-list">${recent.map((x) => html`<li>${link({ ...x, icon: 'clock' })}</li>`)}</ul>` : ''}
      ${!pins.length ? html`<div class="menu-label">Suggested</div><ul class="quick-list">${suggestions().map((x) => html`<li>${link(x)}</li>`)}</ul>` : ''}
      <div class="menu-sep"></div>
      <button type="button" id="quick-pin" ${!here || (!pinned && full) ? 'disabled' : ''} title="${!here ? 'This page cannot be pinned.' : !pinned && full ? `You can pin up to ${QUICK_MAX} pages. Unpin one first.` : ''}">${icon('pin')}<span class="grow">${pinned ? 'Unpin this page' : 'Pin this page'}</span></button>`);
    pop.querySelector('#quick-pin').addEventListener('click', async () => {
      try {
        await save(pinned ? pins.filter((x) => x.href !== here.href) : [...pins, here]);
        toast(pinned ? 'Unpinned.' : 'Pinned to Quick access.');
        pop.querySelector('#quick-pin')?.focus();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    pop.querySelectorAll('[data-unpin]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await save(pins.filter((_, i) => i !== Number(b.dataset.unpin)));
      } catch (err) {
        toast(err.message, 'error');
      }
    }));
  }
  const close = popover(wrap.querySelector('#quick-btn'), pop, {
    async onOpen() {
      if (!pins) pins = (await api.get('/api/me/quick-links').catch(() => ({ links: [] }))).links;
      draw();
    },
  });
  pop.addEventListener('click', (e) => e.target.closest('a.quick-link') && close());
}

// ----- The menu under your name -----
// opts: { info (campuses), here (this app's path: '/lms/', '/admin'…), onPassword, onSignOut,
//         campusMenu (html), wireCampus(root), onTheme (phones) }
export async function mountUserMenu(box, user, opts) {
  await loadAvatars();
  const draw = () => {
    const subtitle = user.title || roleLabel(user.role);
    mount(box, html`
      <button type="button" class="user-btn" id="user-btn" aria-haspopup="menu" aria-expanded="false">
        ${avatar(user.id, user.name)}
        <span class="who-text"><strong>${user.name}</strong><small>${subtitle}${opts.info?.campusName ? ` · ${opts.info.campusName}` : ''}</small></span>
        ${icon('chevronDown', 16)}
      </button>
      <div class="menu-pop" id="user-pop" role="menu" hidden>
        <div class="who who-pic">${avatar(user.id, user.name, { size: 'lg' })}<span><strong>${user.name}</strong><small>${subtitle}</small><small>${user.username}${user.email ? ` · ${user.email}` : ''}</small></span></div>
        <a role="menuitem" href="${accountHref(user, 'profile', opts.here)}">${icon('user')} My profile</a>
        <button type="button" role="menuitem" id="my-picture">${icon('image')} ${avatarAt(user.id) ? 'Change my picture' : 'Add my picture'}</button>
        <a role="menuitem" href="${accountHref(user, 'security', opts.here)}">${icon('shield')} My security</a>
        <button type="button" role="menuitem" id="change-pw">${icon('key')} Change password</button>
        <button type="button" role="menuitem" id="theme-item" class="phone-only">${icon('moon')} Dark mode</button>
        <button type="button" role="menuitem" id="sign-out">${icon('logout')} Sign out</button>
        ${opts.campusMenu || ''}
      </div>`);
    opts.wireCampus?.(box);
    const close = popover(box.querySelector('#user-btn'), box.querySelector('#user-pop'));
    box.querySelector('#my-picture').addEventListener('click', () => {
      close();
      editMyAvatar(user);
    });
    box.querySelector('#change-pw').addEventListener('click', () => {
      close();
      opts.onPassword();
    });
    box.querySelector('#theme-item').addEventListener('click', () => {
      close();
      opts.onTheme?.();
    });
    box.querySelector('#sign-out').addEventListener('click', opts.onSignOut);
    box.querySelectorAll('#user-pop a').forEach((a) => a.addEventListener('click', () => close()));
  };
  draw();
  window.addEventListener('avatar:changed', (e) => {
    if (!e.detail?.userId || e.detail.userId === user.id) draw();
  });
}
