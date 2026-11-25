// Notifications, after CORE ERP's (public/js/notifications.js at the repository root): the bell in
// the top bar of every ATLAS system and the home page (a count of unread, a panel of the latest 20
// by day), and the full list at #/notifications in every system (accountRoutes()). Items come from
// every system (GET /api/me/notifications); each belongs to the signed-in account.
// Every text is escaped (html``); a link is followed only when it is a page in ATLAS.
import { api } from '../api.js';
import { html, mount, toast } from '../ui.js';
import { icon, iconSvg } from '../icons.js';
import { ctx, pageHead } from '../shell.js';
import { SYSTEMS } from '/shared/systems.js';
import { NOTIFY_SYSTEMS, isAtlasLink } from '/shared/notifications.js';
import { avatar, loadAvatars } from './avatars.js';
import { popover, accountHref } from './topbar.js';
import { badgeText, bellLabel, relTime, groupByDay } from './notify-format.js';
import { brand } from '../brand.js';

const POLL_MS = 60000;
const PANEL_SIZE = 20;
const PAGE_SIZE = 30;
const SYSTEM = Object.fromEntries(NOTIFY_SYSTEMS.map((s) => [s.id, s]));
const EMPTY_TEXT = 'When someone asks for your decision, or decides on something you asked for or handed in, it shows here.';

// ----- One item, in the panel and on the page -----
const safeLink = (link) => (isAtlasLink(link) ? link : null);
function itemRow(n) {
  const unread = !n.readAt;
  const link = safeLink(n.link);
  const sys = SYSTEM[n.system];
  const who = n.actorId ? avatar(n.actorId, n.actorName || '?') : html`<span class="avatar notif-sys" aria-hidden="true">${icon(sys?.icon || 'flag', 18)}</span>`;
  return html`<li class="notif-item${unread ? ' unread' : ''}">
    <a class="notif-open" href="${link || '#/notifications'}" data-id="${n.id}" ${link ? '' : 'data-nolink'}>
      ${who}
      <span class="notif-text">
        <span class="notif-title">${unread ? html`<span class="sr-only">Unread: </span>` : ''}${n.title}</span>
        ${n.body ? html`<span class="notif-body">${n.body}</span>` : ''}
        <small class="notif-meta">${sys?.label || ''} · <time datetime="${n.at}" title="${new Date(n.at).toLocaleString('en-PH')}">${relTime(n.at)}</time></small>
      </span>
      ${unread ? html`<span class="notif-dot" aria-hidden="true"></span>` : ''}
    </a>
    ${unread ? html`<button type="button" class="icon-btn notif-tick" data-read="${n.id}" aria-label="Mark as read" title="Mark as read">${icon('check', 16)}</button>` : ''}
  </li>`;
}
const listOf = (items) => groupByDay(items).map(([day, list]) => html`<li class="notif-day"><h3>${day}</h3><ul class="notif-items">${list.map(itemRow)}</ul></li>`);

// ----- The count, kept fresh -----
let unread = 0;
let fetching = null;
let bell = null; // { btn, count, pop, isOpen, render }
// Badges elsewhere (and the other half of this page: the bell or the full list) follow the count.
const changed = (source) => window.dispatchEvent(new CustomEvent('notifications:changed', { detail: { unread, source } }));

function showCount(n) {
  unread = Math.max(0, n | 0);
  if (!bell) return;
  bell.count.textContent = unread ? badgeText(unread) : '';
  bell.count.hidden = !unread;
  bell.btn.setAttribute('aria-label', bellLabel(unread));
  bell.btn.title = unread ? `Notifications (${badgeText(unread)} unread)` : 'Notifications';
}
export function refreshCount() {
  if (!bell) return Promise.resolve(unread);
  if (fetching) return fetching;
  fetching = api.get('/api/me/notifications/count')
    .then((r) => {
      const before = unread;
      showCount(r.unread);
      if (r.unread !== before && bell.isOpen()) bell.render();
      return r.unread;
    })
    .catch(() => unread)
    .finally(() => (fetching = null));
  return fetching;
}
async function markRead(body, source) {
  const r = await api.put('/api/me/notifications/read', body);
  showCount(r.unread);
  changed(source);
  return r;
}
// Opens an item: marked read on the way (a failure does not stop the way), then its page, in this
// system or another. A click with Ctrl, Cmd or Shift (a new tab) only marks it read.
async function openItem(a, e, source, after) {
  const link = a.hasAttribute('data-nolink') ? null : safeLink(a.getAttribute('href'));
  const wasUnread = Boolean(a.closest('.notif-item.unread'));
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) {
    if (wasUnread) markRead({ ids: [a.dataset.id] }, source).catch(() => {});
    return;
  }
  e.preventDefault();
  if (wasUnread) await markRead({ ids: [a.dataset.id] }, source).catch(() => {});
  after?.();
  if (!link) return;
  if (`${location.pathname}${location.hash}` === link) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.assign(link);
}
// The tick: read, without opening. The row stays where it is; focus goes to its link.
async function tick(btn, source) {
  const li = btn.closest('.notif-item');
  try {
    await markRead({ ids: [btn.dataset.read] }, source);
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
  li.classList.remove('unread');
  li.querySelector('.notif-dot')?.remove();
  li.querySelector('.sr-only')?.remove();
  li.querySelector('.notif-open')?.focus();
  btn.remove();
  return true;
}

// ----- The bell and its panel -----
// beforeEl: the top-bar button it goes before (Help). user: the signed-in account. here: this app's
// address ('/lms/', '/admin'…, '/' on the home page), for the link to the full list.
export function mountBell(beforeEl, { user, here = null }) {
  if (document.getElementById('notif-btn')) return;
  const wrap = document.createElement('div');
  wrap.className = 'top-pop-wrap notif-box';
  wrap.innerHTML = `<button type="button" class="round-btn notif-btn" id="notif-btn" aria-haspopup="dialog" aria-expanded="false" aria-controls="notif-pop" aria-label="Notifications" title="Notifications">${iconSvg('bell')}<span class="notif-count" hidden></span></button>
    <div class="notif-pop" id="notif-pop" role="dialog" aria-labelledby="notif-h" hidden></div>`;
  beforeEl.before(wrap);
  const btn = wrap.querySelector('#notif-btn');
  const pop = wrap.querySelector('#notif-pop');
  const allHref = here === '/' ? accountHref(user, 'notifications') : '#/notifications';
  let unreadOnly = false;
  let seq = 0;
  async function render({ focusFirst = false } = {}) {
    const mine = ++seq;
    if (!pop.querySelector('.notif-list')) {
      mount(pop, html`<div class="notif-head">
          <h2 id="notif-h">Notifications</h2>
          <button type="button" class="icon-btn notif-close" aria-label="Close notifications">${icon('x', 18)}</button>
        </div>
        <div class="notif-tools">
          <label class="check-inline"><input type="checkbox" id="notif-unread" /><span>Unread only</span></label>
          <button type="button" class="btn sm" id="notif-readall" disabled>Mark all as read</button>
        </div>
        <div class="notif-list" aria-live="polite"><p class="notif-empty">Loading…</p></div>
        <div class="notif-foot"><a href="${allHref}" id="notif-all">See all notifications</a></div>`);
    }
    let data;
    try {
      [data] = await Promise.all([api.get(`/api/me/notifications?limit=${PANEL_SIZE}${unreadOnly ? '&unread=1' : ''}`), loadAvatars()]);
    } catch (err) {
      if (mine === seq) mount(pop.querySelector('.notif-list'), html`<p class="notif-empty">${err.message}</p>`);
      return;
    }
    if (mine !== seq) return;
    showCount(data.unread);
    pop.querySelector('#notif-readall').disabled = !data.unread;
    mount(pop.querySelector('.notif-list'), data.items.length
      ? html`<ul class="notif-days">${listOf(data.items)}</ul>${data.more ? html`<p class="notif-more"><a href="${allHref}${unreadOnly ? (allHref.includes('?') ? '&' : '?') + 'unread=1' : ''}">Show all${unreadOnly ? ' unread' : ''}</a></p>` : ''}`
      : html`<div class="notif-empty">${icon('bell', 32)}<p><strong>${unreadOnly ? 'Nothing unread' : 'No notifications yet'}</strong></p><p class="small">${unreadOnly ? 'You are up to date.' : EMPTY_TEXT}</p></div>`);
    if (focusFirst) (pop.querySelector('.notif-open') || pop.querySelector('#notif-unread'))?.focus();
  }
  const close = popover(btn, pop, {
    onOpen() {
      render();
      // Focus the first item once the panel shows (the popover shows it after this returns).
      requestAnimationFrame(() => !pop.hidden && (pop.querySelector('.notif-open') || pop.querySelector('.notif-close'))?.focus());
    },
  });
  pop.addEventListener('click', (e) => {
    if (e.target.closest('.notif-close')) return close(true);
    const t = e.target.closest('[data-read]');
    if (t) return tick(t, 'bell');
    if (e.target.closest('#notif-readall')) {
      return markRead({ all: true }, 'bell').then(() => render({ focusFirst: true })).catch((err) => toast(err.message, 'error'));
    }
    const a = e.target.closest('.notif-open');
    if (a) return openItem(a, e, 'bell', () => close());
    if (e.target.closest('#notif-all, .notif-more a')) close();
  });
  pop.addEventListener('change', (e) => {
    if (e.target.id !== 'notif-unread') return;
    unreadOnly = e.target.checked;
    render();
  });
  bell = { btn, count: wrap.querySelector('.notif-count'), pop, render, isOpen: () => !pop.hidden };
  showCount(unread);
  startPolling();
}

// Fresh: every 60 s while the tab is shown, when it is shown again, and after moving to another page.
let timer = null;
function startPolling() {
  refreshCount();
  if (timer) return;
  timer = setInterval(() => document.visibilityState === 'visible' && refreshCount(), POLL_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshCount());
  window.addEventListener('hashchange', () => refreshCount());
  window.addEventListener('notifications:changed', (e) => {
    if (e.detail?.source === 'bell') return;
    if (bell?.isOpen()) bell.render();
  });
}

// ----- The full list: #/notifications -----
export async function notificationsView(el, _params, query = {}) {
  const role = ctx.user?.role;
  const systems = NOTIFY_SYSTEMS.filter((s) => s.id === 'account' || SYSTEMS.find((x) => x.id === s.id)?.audience.includes(role));
  const state = { system: systems.some((s) => s.id === query.system) ? query.system : '', unread: query.unread === '1', items: [], more: false, unreadCount: 0 };
  mount(el, html`
    ${pageHead('Notifications', 'What others did that concerns you, from every ${brand()} system, newest first. Notifications older than 60 days are removed.', html`<button type="button" class="btn" id="nf-readall" disabled>${icon('check', 16)} Mark all as read</button>`)}
    <section class="card notif-page">
      <div class="toolbar">
        ${systems.length > 1 ? html`<select id="nf-system" aria-label="System"><option value="">All systems</option>${systems.map((s) => html`<option value="${s.id}" ${state.system === s.id ? 'selected' : ''}>${s.label}</option>`)}</select>` : ''}
        <label class="check-inline"><input type="checkbox" id="nf-unread" ${state.unread ? 'checked' : ''} /><span>Unread only</span></label>
        <span class="spacer"></span><span class="muted small" id="nf-sum" aria-live="polite"></span>
      </div>
      <div id="nf-list"><p class="notif-empty">Loading…</p></div>
    </section>`);
  const listEl = el.querySelector('#nf-list');
  const url = (offset) => `/api/me/notifications?limit=${PAGE_SIZE}&offset=${offset}${state.system ? `&system=${state.system}` : ''}${state.unread ? '&unread=1' : ''}`;
  const summary = () => {
    el.querySelector('#nf-sum').textContent = state.unreadCount ? `${state.unreadCount} unread` : 'All read';
    el.querySelector('#nf-readall').disabled = !state.unreadCount;
  };
  function draw() {
    summary();
    mount(listEl, state.items.length
      ? html`<ul class="notif-days">${listOf(state.items)}</ul>${state.more ? html`<p class="notif-more"><button type="button" class="btn" id="nf-more">Show more</button></p>` : ''}`
      : html`<div class="empty">${icon('bell', 40)}<h2>${state.unread ? 'Nothing unread' : 'No notifications'}</h2><p>${state.system || state.unread ? 'Nothing matches these filters.' : EMPTY_TEXT}</p></div>`);
  }
  async function load({ append = false } = {}) {
    const [r] = await Promise.all([api.get(url(append ? state.items.length : 0)), loadAvatars()]);
    state.items = append ? [...state.items, ...r.items.filter((n) => !state.items.some((x) => x.id === n.id))] : r.items;
    state.more = r.more;
    state.unreadCount = r.unread;
    showCount(r.unread);
    draw();
  }
  const reload = () => {
    const q = new URLSearchParams({ ...(state.system ? { system: state.system } : {}), ...(state.unread ? { unread: '1' } : {}) });
    history.replaceState(null, '', `${location.pathname}#/notifications${q.size ? `?${q}` : ''}`);
    return load().catch((err) => toast(err.message, 'error'));
  };
  el.querySelector('#nf-system')?.addEventListener('change', (e) => ((state.system = e.target.value), reload()));
  el.querySelector('#nf-unread').addEventListener('change', (e) => ((state.unread = e.target.checked), reload()));
  el.querySelector('#nf-readall').addEventListener('click', async () => {
    try {
      await markRead({ all: true }, 'page');
      toast('All marked as read.');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  listEl.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-read]');
    if (t) {
      const id = t.dataset.read;
      if (!(await tick(t, 'page'))) return;
      const n = state.items.find((x) => x.id === id);
      if (n) n.readAt = new Date().toISOString();
      state.unreadCount = unread;
      return summary();
    }
    if (e.target.closest('#nf-more')) {
      const at = state.items.length;
      await load({ append: true }).catch((err) => toast(err.message, 'error'));
      return listEl.querySelectorAll('.notif-open')[at]?.focus();
    }
    const a = e.target.closest('.notif-open');
    if (a) openItem(a, e, 'page');
  });
  // Read in the bell while this page is open: the list follows.
  const onChanged = (e) => e.detail?.source !== 'page' && load().catch(() => {});
  window.addEventListener('notifications:changed', onChanged);
  await load();
  return () => window.removeEventListener('notifications:changed', onChanged);
}
