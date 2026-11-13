// Notifications: the bell in the top bar (a count of unread, a panel of the latest), and the full
// list at #/notifications. Items come from every module (GET /api/notifications); Project
// Management's are the same records as "For you" on My work, so reading one here reads it there.
// Every text is escaped (html``); a link is followed only when it is a CORE route ("#/…").
import { api } from './api.js';
import { ctx, mayUseModule } from './state.js';
import { html, mount, toast } from './ui.js';
import { icon, iconSvg } from './icons.js';
import { avatar } from './avatars.js';
import { SWITCHABLE } from './modules.js';
import { badgeText, bellLabel, safeLink, relTime, groupByDay } from './notify-format.js';

export const NOTIFY_MODULES = { hr: 'HR & Payroll', assets: 'IT Assets', helpdesk: 'Service Desk', crm: 'Sales & CRM', projects: 'Projects', system: 'System' };
const MODULE_ICON = { hr: 'users', assets: 'laptop', helpdesk: 'headset', crm: 'chart', projects: 'layers', system: 'settings' };
const POLL_MS = 60000;
const PANEL_SIZE = 20;
const PAGE_SIZE = 30;

// ----- One item, in the panel and on the page -----
function itemRow(n) {
  const unread = !n.readAt;
  const link = safeLink(n.link);
  const who = n.actorId ? avatar(n.actorId, n.actorName || '?', { cls: 'notif-av' }) : html`<span class="notif-av notif-mod" aria-hidden="true">${icon(MODULE_ICON[n.module] || 'bell', 18)}</span>`;
  return html`<li class="notif-item ${unread ? 'unread' : ''}" data-id="${n.id}">
    <a class="notif-open" href="${link || '#/notifications'}" data-id="${n.id}" ${link ? '' : 'data-nolink'}>
      ${who}
      <span class="notif-text">
        <span class="notif-title">${unread ? html`<span class="sr-only">Unread: </span>` : ''}${n.title}</span>
        ${n.body ? html`<span class="notif-body">${n.body}</span>` : ''}
        <small class="notif-meta">${NOTIFY_MODULES[n.module] || ''} · <time datetime="${n.at}" title="${new Date(n.at).toLocaleString('en-PH')}">${relTime(n.at)}</time></small>
      </span>
      ${unread ? html`<span class="notif-dot" aria-hidden="true"></span>` : ''}
    </a>
    ${unread ? html`<button type="button" class="icon-btn notif-tick" data-read="${n.id}" aria-label="Mark as read" title="Mark as read">${icon('check', 16)}</button>` : ''}
  </li>`;
}
const listOf = (items) => groupByDay(items).map(([day, list]) => html`<li class="notif-day" role="presentation"><h3>${day}</h3><ul class="notif-items">${list.map(itemRow)}</ul></li>`);

// ----- The count, kept fresh -----
let unread = 0;
let fetching = null;
let timer = null;
let bell = null; // { btn, count, pop, render, isOpen, close }
const changed = () => window.dispatchEvent(new Event('notifications:changed'));

function showCount(n) {
  unread = n;
  if (!bell) return;
  bell.count.textContent = n ? badgeText(n) : '';
  bell.count.hidden = !n;
  bell.btn.setAttribute('aria-label', bellLabel(n));
  bell.btn.title = n ? `Notifications (${badgeText(n)} unread)` : 'Notifications';
}
export function refreshCount() {
  if (!ctx.user || !bell) return Promise.resolve(unread);
  if (fetching) return fetching;
  fetching = api.get('/api/notifications/count')
    .then((r) => (showCount(r.unread), r.unread))
    .catch(() => unread)
    .finally(() => (fetching = null));
  return fetching;
}
async function markRead(body) {
  const r = await api.put('/api/notifications/read', body);
  showCount(r.unread);
  // My work's badge counts the same Project Management items.
  changed();
  return r;
}
// Opens an item: marked read on the way (a failure does not stop the way), then its page.
async function openItem(a, e, after) {
  const link = safeLink(a.getAttribute('href'));
  const wasUnread = Boolean(a.closest('.notif-item.unread'));
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) {
    if (wasUnread) markRead({ ids: [a.dataset.id] }).catch(() => {});
    return;
  }
  e.preventDefault();
  if (wasUnread) await markRead({ ids: [a.dataset.id] }).catch(() => {});
  after?.();
  if (!link || a.hasAttribute('data-nolink')) return;
  if (location.hash === link) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = link;
}
// The tick: read, without opening. The row stays where it is; focus goes to its link.
async function tick(btn) {
  const li = btn.closest('.notif-item');
  try {
    await markRead({ ids: [btn.dataset.read] });
  } catch (err) {
    return toast(err.message, 'error');
  }
  li.classList.remove('unread');
  li.querySelector('.notif-dot')?.remove();
  li.querySelector('.sr-only')?.remove();
  li.querySelector('.notif-open')?.focus();
  btn.remove();
}
// Up and down arrows (Home, End) between the items' links.
function arrowKeys(root, e) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const links = [...root.querySelectorAll('.notif-open')];
  const i = links.indexOf(document.activeElement);
  if (i < 0 && !e.target.closest('.notif-item')) return;
  e.preventDefault();
  const at = e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : Math.max(0, Math.min(links.length - 1, (i < 0 ? links.indexOf(e.target.closest('.notif-item').querySelector('.notif-open')) : i) + (e.key === 'ArrowDown' ? 1 : -1)));
  links[at]?.focus();
}

// ----- The bell and its panel -----
// box: the element to fill; onOpen: close the other top-bar menus first. Returns close().
export function mountBell(box, { onOpen = () => {} } = {}) {
  box.innerHTML = `<button type="button" class="round-btn notif-btn" id="notif-btn" aria-haspopup="dialog" aria-expanded="false" aria-controls="notif-pop">${iconSvg('bell', 18)}<span class="notif-count" hidden></span></button>
    <div class="notif-pop" id="notif-pop" role="dialog" aria-modal="false" aria-labelledby="notif-h" hidden></div>`;
  const btn = box.querySelector('#notif-btn');
  const pop = box.querySelector('#notif-pop');
  let unreadOnly = false;
  let seq = 0;
  const isOpen = () => !pop.hidden;
  function close({ focus = false } = {}) {
    if (pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('notif-shown');
    if (focus) btn.focus();
  }
  async function render({ focusFirst = false } = {}) {
    const mine = ++seq;
    if (!pop.querySelector('.notif-list')) {
      mount(pop, html`<div class="notif-head">
          <h2 id="notif-h">Notifications</h2>
          <button type="button" class="notif-close icon-btn" aria-label="Close notifications">${icon('x', 18)}</button>
        </div>
        <div class="notif-tools">
          <label class="check-inline notif-only"><input type="checkbox" id="notif-unread" ${unreadOnly ? 'checked' : ''} /><span>Unread only</span></label>
          <button type="button" class="btn small-btn" id="notif-readall">Mark all read</button>
        </div>
        <div class="notif-list" aria-live="polite"><p class="notif-empty muted">Loading…</p></div>
        <div class="notif-foot"><a href="#/notifications" id="notif-all">See all</a></div>`);
    }
    let data;
    try {
      data = await api.get(`/api/notifications?limit=${PANEL_SIZE}${unreadOnly ? '&unread=1' : ''}`);
    } catch (err) {
      if (mine === seq) mount(pop.querySelector('.notif-list'), html`<p class="notif-empty">${err.message}</p>`);
      return;
    }
    if (mine !== seq) return;
    showCount(data.unread);
    pop.querySelector('#notif-readall').disabled = !data.unread;
    mount(pop.querySelector('.notif-list'), data.items.length
      ? html`<ul class="notif-days">${listOf(data.items)}</ul>${data.more ? html`<p class="notif-more"><a href="#/notifications${unreadOnly ? '?unread=1' : ''}">Show all${unreadOnly ? ' unread' : ''}</a></p>` : ''}`
      : html`<div class="notif-empty">${icon('bell', 32)}<p><strong>${unreadOnly ? 'Nothing unread' : 'No notifications yet'}</strong></p><p class="muted small">${unreadOnly ? 'You are up to date.' : 'When someone asks for your approval, decides on your request, assigns you a ticket or a task, or replies to you, it shows here.'}</p></div>`);
    if (focusFirst) (pop.querySelector('.notif-open') || pop.querySelector('#notif-unread')).focus();
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen()) return close();
    onOpen();
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('notif-shown');
    pop.querySelector('.notif-close')?.focus();
    render({ focusFirst: true });
  });
  pop.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('.notif-close')) return close({ focus: true });
    const t = e.target.closest('[data-read]');
    if (t) return tick(t);
    if (e.target.closest('#notif-readall')) {
      return markRead({ all: true }).then(() => render()).then(() => (pop.querySelector('.notif-open') || pop.querySelector('#notif-unread'))?.focus()).catch((err) => toast(err.message, 'error'));
    }
    const a = e.target.closest('.notif-open');
    if (a) return openItem(a, e, () => close());
    if (e.target.closest('#notif-all, .notif-more a')) close();
  });
  pop.addEventListener('change', (e) => {
    if (e.target.id !== 'notif-unread') return;
    unreadOnly = e.target.checked;
    render();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      e.stopPropagation();
      return close({ focus: true });
    }
    if (isOpen()) arrowKeys(pop, e);
  });
  // A click anywhere else closes it.
  document.addEventListener('click', (e) => !box.contains(e.target) && close());
  bell = { btn, count: box.querySelector('.notif-count'), pop, render, isOpen, close };
  showCount(unread);
  return close;
}

// Fresh: every 60 s while the tab is shown, when it is shown again or gets focus, and after
// something that could change it (the caller: after navigation and actions).
export function startBell() {
  stopBell();
  refreshCount();
  timer = setInterval(() => document.visibilityState === 'visible' && refreshCount(), POLL_MS);
}
export function stopBell() {
  clearInterval(timer);
  timer = null;
  unread = 0;
  bell?.close();
  if (bell) showCount(0);
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && ctx.user && timer && refreshCount());
window.addEventListener('focus', () => ctx.user && timer && refreshCount());

// ----- The full list: #/notifications -----
export async function notificationsView(el, _params, query = {}) {
  const modules = Object.keys(NOTIFY_MODULES).filter((m) => !SWITCHABLE.includes(m) || mayUseModule(m));
  const state = { module: modules.includes(query.module) ? query.module : '', unread: query.unread === '1', items: [], more: false, unreadCount: 0 };
  mount(el, html`
    <header class="page-head">
      <div><h1>Notifications</h1><p class="muted">What others did that concerns you, from every module, newest first. Notifications older than 60 days are removed.</p></div>
      <div class="actions"><button type="button" class="btn" id="page-readall">Mark all read</button></div>
    </header>
    <section class="card notif-page">
      <div class="toolbar pad">
        <select id="nf-module" aria-label="Module"><option value="">All modules</option>${modules.map((m) => html`<option value="${m}" ${state.module === m ? 'selected' : ''}>${NOTIFY_MODULES[m]}</option>`)}</select>
        <label class="check-inline"><input type="checkbox" id="nf-unread" ${state.unread ? 'checked' : ''} /><span>Unread only</span></label>
        <span class="spacer"></span><span class="muted small" id="nf-sum" aria-live="polite"></span>
      </div>
      <div id="nf-list"></div>
    </section>`);
  const listEl = el.querySelector('#nf-list');
  const url = (offset) => `/api/notifications?limit=${PAGE_SIZE}&offset=${offset}${state.module ? `&module=${state.module}` : ''}${state.unread ? '&unread=1' : ''}`;
  function draw() {
    el.querySelector('#nf-sum').textContent = state.unreadCount ? `${state.unreadCount} unread` : 'All read';
    el.querySelector('#page-readall').disabled = !state.unreadCount;
    mount(listEl, state.items.length
      ? html`<ul class="notif-days page">${listOf(state.items)}</ul>${state.more ? html`<p class="notif-more"><button type="button" class="btn" id="nf-more">Show more</button></p>` : ''}`
      : html`<div class="empty">${icon('bell', 40)}<h2>${state.unread ? 'Nothing unread' : 'No notifications'}</h2><p>${state.module || state.unread ? 'Nothing matches these filters.' : 'When someone asks for your approval, decides on your request, assigns you a ticket or a task, or replies to you, it shows here.'}</p></div>`);
  }
  async function load({ append = false } = {}) {
    const r = await api.get(url(append ? state.items.length : 0));
    state.items = append ? [...state.items, ...r.items.filter((n) => !state.items.some((x) => x.id === n.id))] : r.items;
    state.more = r.more;
    state.unreadCount = r.unread;
    showCount(r.unread);
    draw();
  }
  const reload = () => {
    history.replaceState(null, '', `#/notifications${state.module || state.unread ? `?${new URLSearchParams({ ...(state.module ? { module: state.module } : {}), ...(state.unread ? { unread: '1' } : {}) })}` : ''}`);
    return load().catch((err) => toast(err.message, 'error'));
  };
  el.querySelector('#nf-module').addEventListener('change', (e) => ((state.module = e.target.value), reload()));
  el.querySelector('#nf-unread').addEventListener('change', (e) => ((state.unread = e.target.checked), reload()));
  el.querySelector('#page-readall').addEventListener('click', async () => {
    try {
      await markRead({ all: true });
      toast('All marked as read.');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  listEl.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-read]');
    if (t) {
      await tick(t);
      state.unreadCount = Math.max(0, state.unreadCount - 1);
      const n = state.items.find((x) => x.id === t.dataset.read);
      if (n) n.readAt = new Date().toISOString();
      el.querySelector('#nf-sum').textContent = state.unreadCount ? `${state.unreadCount} unread` : 'All read';
      return;
    }
    if (e.target.closest('#nf-more')) {
      const at = state.items.length;
      await load({ append: true }).catch((err) => toast(err.message, 'error'));
      return listEl.querySelectorAll('.notif-open')[at]?.focus();
    }
    const a = e.target.closest('.notif-open');
    if (a) openItem(a, e);
  });
  listEl.addEventListener('keydown', (e) => arrowKeys(listEl, e));
  await load();
}
