// Quick access (0.35): the lightning button in the top bar, after the modules button. Its panel
// has the pages this person pinned (kept with their account on the server, so they follow them to
// any browser), the pages they opened last in this browser (Recent), and, while nothing is
// pinned, a few suggestions. "Pin this page" at the bottom pins or unpins the page that is open.
// The rules (what a page may be, its name, the lists) are in shared/quick.js.
import { api } from './api.js';
import { ctx } from './state.js';
import { html, mount, toast } from './ui.js';
import { icon, iconSvg } from './icons.js';
import { addRecent, readRecent, recentToShow, suggestedLinks, pinButton } from '/shared/quick.js';

const recentKey = () => `core-recent:${ctx.user?.id}`;
function loadRecent() {
  try {
    return readRecent(localStorage.getItem(recentKey()));
  } catch {
    return [];
  }
}

// After each page opens (the router): the page goes first in Recent. Not the CORE home, nor the
// notifications page (the bell is there for it).
export function recordVisit(page) {
  if (!ctx.user || !page || page.launcher || /^#\/notifications(\?|$)/.test(page.href)) return;
  try {
    localStorage.setItem(recentKey(), JSON.stringify(addRecent(loadRecent(), page)));
  } catch {}
}

// box: the element to fill. popover(root, btn, pop): the top bar's drop-down rules (opening it
// closes the others; a click outside or Escape closes it); returns close(). page(): the page that
// is open, { href, label, launcher }. access(): the modules this person can open (moduleAccess).
export function mountQuick(box, { popover, page, access }) {
  box.innerHTML = `<button type="button" class="round-btn quick-btn" id="quick-btn" title="Quick access" aria-label="Quick access" aria-haspopup="dialog" aria-expanded="false" aria-controls="quick-pop">${iconSvg('bolt', 18)}</button>
    <div class="quick-pop" id="quick-pop" role="dialog" aria-modal="false" aria-label="Quick access" hidden><div class="quick-inner"></div><p class="sr-only" aria-live="polite" id="quick-said"></p></div>`;
  const btn = box.querySelector('#quick-btn');
  const pop = box.querySelector('#quick-pop');
  const inner = pop.querySelector('.quick-inner');
  const said = pop.querySelector('#quick-said');
  const close = popover(box, btn, pop);
  const isOpen = () => !pop.hidden;
  let busy = false;
  let loading = null;

  const item = (l, kind, cur) => html`<li class="quick-item">
      <a class="quick-link ${l.href === cur ? 'on' : ''}" href="${l.href}" ${l.href === cur ? html`aria-current="page"` : ''}>
        <span class="quick-ic" aria-hidden="true">${icon(kind === 'pinned' ? 'pin' : kind === 'recent' ? 'clock' : l.glyph || 'file', 16)}</span>
        <span class="quick-text">${l.label}</span>
      </a>
      ${kind === 'pinned' ? html`<button type="button" class="icon-btn quick-unpin" data-unpin="${l.href}" aria-label="Unpin ${l.label}" title="Unpin ${l.label}">${icon('x', 14)}</button>` : ''}
    </li>`;
  const section = (id, title, body) => html`<section class="quick-sec" aria-labelledby="quick-${id}-h"><h3 class="quick-label" id="quick-${id}-h">${title}</h3>${body}</section>`;

  function draw() {
    const pinned = ctx.quickLinks || [];
    const cur = page();
    const recent = recentToShow(loadRecent(), { pinned, current: cur.href });
    const pin = pinButton({ page: cur, pinned });
    mount(inner, html`
      <div class="quick-head">
        <h2>Quick access</h2>
        <button type="button" class="icon-btn quick-close" aria-label="Close quick access">${icon('x', 18)}</button>
      </div>
      <div class="quick-body">
        ${section('pinned', 'Pinned', ctx.quickLinks == null
          ? html`<p class="quick-empty">Loading…</p>`
          : pinned.length
            ? html`<ul class="quick-list">${pinned.map((l) => item(l, 'pinned', cur.href))}</ul>`
            : html`<p class="quick-empty">Pin the pages you use most: open one, then choose <strong>Pin this page</strong>.</p>`)}
        ${recent.length ? section('recent', 'Recent', html`<ul class="quick-list">${recent.map((l) => item(l, 'recent', cur.href))}</ul>`) : ''}
        ${ctx.quickLinks && !pinned.length ? section('suggested', 'Suggested', html`<ul class="quick-list">${suggestedLinks(access()).map((l) => item(l, 'suggested', cur.href))}</ul>`) : ''}
      </div>
      <div class="quick-foot">
        <button type="button" class="btn small-btn quick-pin" id="quick-pin" data-action="${pin.action}" ${pin.disabled ? 'disabled' : ''} ${pin.why ? html`title="${pin.why}"` : ''}>${icon('pin', 16)} ${pin.text}</button>
        ${pin.why ? html`<small class="quick-why">${pin.why}</small>` : ''}
      </div>`);
  }
  // Drawn again with the focus where it was (the same link or button, else the first item).
  function redraw({ focus = null } = {}) {
    const a = document.activeElement;
    const was = pop.contains(a) ? (a.dataset.unpin ? `[data-unpin="${CSS.escape(a.dataset.unpin)}"]` : a.id ? `#${a.id}` : a.matches('a[href]') ? `a[href="${CSS.escape(a.getAttribute('href'))}"]` : null) : null;
    draw();
    const target = (focus && pop.querySelector(focus)) || (was && pop.querySelector(was)) || (pop.contains(a) || focus ? firstItem() : null);
    target?.focus();
  }
  const items = () => [...pop.querySelectorAll('a[href], button:not([disabled])')].filter((x) => x.offsetParent !== null);
  // The first page in the panel (on a phone the × comes before it).
  const firstItem = () => items().find((x) => !x.matches('.quick-close'));

  // The pinned pages: from the server the first time the panel opens, then kept (ctx.quickLinks)
  // and refreshed in the background at each opening.
  function load() {
    loading ||= api.get('/api/me/quick-links')
      .then((r) => {
        const same = JSON.stringify(r.links) === JSON.stringify(ctx.quickLinks);
        // The first time, nothing could take the focus yet: the first page does now.
        const waiting = document.activeElement === btn;
        ctx.quickLinks = r.links;
        if (isOpen() && !same) redraw();
        if (isOpen() && waiting) firstItem()?.focus();
      })
      .catch((err) => {
        if (ctx.quickLinks == null) ctx.quickLinks = [];
        if (isOpen()) {
          redraw();
          toast(err.message, 'error');
        }
      })
      .finally(() => (loading = null));
    return loading;
  }

  async function save(links, message, focus) {
    if (busy) return;
    busy = true;
    try {
      ctx.quickLinks = (await api.put('/api/me/quick-links', { links })).links;
      said.textContent = message;
      redraw({ focus });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy = false;
    }
  }

  // Opened (popover() has shown it already): drawn at once from what is known, then refreshed.
  btn.addEventListener('click', () => {
    if (!isOpen()) return;
    said.textContent = '';
    draw();
    firstItem()?.focus();
    load();
  });
  // Unpinning and pinning keep the panel open (popover() closes it on any other link or button).
  inner.addEventListener('click', (e) => {
    const un = e.target.closest('[data-unpin]');
    const pinBtn = e.target.closest('#quick-pin');
    if (e.target.closest('.quick-close')) {
      close();
      return btn.focus();
    }
    if (!un && !pinBtn) return;
    e.stopPropagation();
    const pinned = ctx.quickLinks || [];
    if (un) {
      const href = un.dataset.unpin;
      const label = pinned.find((l) => l.href === href)?.label || '';
      // The focus goes to the next pinned page (or the one before, or the Pin button).
      const rows = [...pop.querySelectorAll('[data-unpin]')];
      const i = rows.indexOf(un);
      const next = rows[i + 1] || rows[i - 1];
      return save(pinned.filter((l) => l.href !== href), `Unpinned ${label}.`, next ? `[data-unpin="${CSS.escape(next.dataset.unpin)}"]` : '#quick-pin');
    }
    const cur = page();
    if (pinBtn.dataset.action === 'unpin') return save(pinned.filter((l) => l.href !== cur.href), `Unpinned ${cur.label}.`, '#quick-pin');
    return save([...pinned, { href: cur.href, label: cur.label }], `Pinned ${cur.label}.`, '#quick-pin');
  });
  // Escape closes it and the focus goes back to the button; the arrows (Home, End) move between
  // its links and buttons.
  // (On the button and the panel, which are new at each mount: not on the box, which stays.)
  const onKey = (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return btn.focus();
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const list = items();
    if (!list.length) return;
    e.preventDefault();
    const i = list.indexOf(document.activeElement);
    const at = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : i < 0 ? (e.key === 'ArrowDown' ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    list[at].focus();
  };
  btn.addEventListener('keydown', onKey);
  pop.addEventListener('keydown', onKey);
  return { btn, pop, close };
}
