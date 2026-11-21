// CORE home: the first page after sign-in. A greeting, the modules this account can open
// (with a few live figures), the roadmap, and administration shortcuts.
import { api } from '../api.js';
import { ctx, can, mayUseModule, moduleOn, panelAccess } from '../state.js';
import { companyRoleOf } from '/shared/profile.js';
import { MODULES, INTEGRATIONS } from '../modules.js';
import { roleOverrides } from '/shared/roles.js';
import { unseenCount } from './devlog.js';
import { html, mount, toast } from '../ui.js';
import { icon } from '../icons.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// A few live figures per module, only from data this user may see (none from a module turned off).
async function moduleStats() {
  const MOD = [[/^\/api\/(employees|requests)/, 'hr'], [/^\/api\/(assets|inventory|asset-reports|me\/assets)/, 'assets'], [/^\/api\/helpdesk/, 'helpdesk'], [/^\/api\/crm/, 'crm'], [/^\/api\/pm/, 'projects']];
  const get = (url) => (mayUseModule(MOD.find(([re]) => re.test(url))?.[1]) ? api.get(url).catch(() => null) : null);
  const [employees, requests, assets, inventory, mine, reports, desk, myTickets, crm, pm] = await Promise.all([
    can('employees.view') ? get('/api/employees') : null,
    can('leave.manage') ? get('/api/requests/summary') : null,
    can('assets.view') ? get('/api/assets') : null,
    can('assets.view') ? get('/api/inventory') : null,
    !can('assets.view') && ctx.user.employeeId ? get('/api/me/assets') : null,
    can('assets.view') ? get('/api/asset-reports/summary') : null,
    can('helpdesk.agent') ? get('/api/helpdesk/summary') : null,
    can('helpdesk.agent') ? null : get('/api/helpdesk/mine'),
    can('crm.view') ? get('/api/crm/overview') : null,
    can('pm.view') || ctx.user.inProjects ? get('/api/pm/overview') : null,
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
  const sales = [];
  const peso = (n) => (n >= 1e6 ? `₱${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : `₱${Math.round(n / 1000)}K`);
  if (crm) {
    sales.push(`${peso(crm.openValue)} open pipeline in ${crm.openCount} deal${crm.openCount === 1 ? '' : 's'}`);
    if (crm.bids.length) sales.push(`${crm.bids.length} bid${crm.bids.length === 1 ? '' : 's'} being prepared`);
    if (crm.myTasks.length) sales.push(`${crm.myTasks.length} task${crm.myTasks.length === 1 ? '' : 's'} due for you`);
    if (crm.newLeads) sales.push(`${crm.newLeads} new lead${crm.newLeads === 1 ? '' : 's'}`);
  }
  const projects = [];
  if (pm) {
    const n = pm.counts.open;
    projects.push(`${n} open project${n === 1 ? '' : 's'}`);
    if (pm.counts.amber + pm.counts.red) projects.push(`${pm.counts.amber + pm.counts.red} at risk or off track`);
    if (pm.counts.myOpen) projects.push(`${pm.counts.myOpen} task${pm.counts.myOpen === 1 ? '' : 's'} of yours${pm.counts.myOverdue ? `, ${pm.counts.myOverdue} overdue` : ''}`);
  }
  return { hr, assets: assetsOut, helpdesk, crm: sales, projects };
}

export async function launcherView(el) {
  // The CORE home always shows the modules and access as they are now (an administrator may have
  // turned a module off or changed an account type since this page was loaded).
  const was = JSON.stringify([ctx.modules, roleOverrides()]);
  await ctx.refreshStatus().catch(() => {});
  if (JSON.stringify([ctx.modules, roleOverrides()]) !== was) window.dispatchEvent(new Event('modules:changed'));
  const u = ctx.user;
  const [stats, devlogNew, feedbackNew] = await Promise.all([
    moduleStats(),
    can('devlog.view') ? unseenCount().catch(() => 0) : 0,
    can('feedback.view') ? api.get('/api/feedback/summary').then((r) => r.new).catch(() => 0) : 0,
  ]);
  // A module the company turned off is gone, except for administrators, who see it marked Off.
  const live = MODULES.filter((m) => m.status === 'live' && mayUseModule(m.id));
  const soon = MODULES.filter((m) => m.status !== 'live');
  const open = live.filter((m) => ctx.moduleHome(m.id)).length;
  const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const card = (m) => {
    const home = ctx.moduleHome(m.id);
    const figures = stats[m.id] || [];
    const off = !moduleOn(m.id);
    const top = html`<span class="sys-top"><span class="sys-ic">${icon(m.glyph, 26)}</span>${off ? html`<span class="badge gray" title="Turned off for the company: only administrators see it">${icon('lock', 12)} Off</span>` : html`<span class="sys-code">${m.code}</span>`}</span>`;
    return home
      ? html`<a class="sys-card" href="#${home}" data-module="${m.id}">
          ${top}
          <strong class="sys-name" style="font-size:20px">${m.name}</strong>
          <p>${m.description}</p>
          ${off ? html`<ul class="sys-figs"><li>Off for the company. Only administrators see it; turn it on under Admin panel → Modules.</li></ul>` : figures.length ? html`<ul class="sys-figs">${figures.map((f) => html`<li>${f}</li>`)}</ul>` : ''}
          <span class="sys-open">Open ${m.name} ${icon('chevronRight', 16)}</span>
        </a>`
      : html`<div class="sys-card locked" data-module="${m.id}" aria-disabled="true">
          ${top}
          <strong class="sys-name" style="font-size:20px">${m.name}</strong>
          <p>${m.description}</p>
          <span class="sys-open">${icon('lock', 14)} No access · ask your administrator</span>
        </div>`;
  };
  // A module still in development: greyed out at the end of the row, as on the ATLAS home.
  // C-suite (accent: gold) has a gold accent: the executive module.
  const soonCard = (m) => html`<div class="sys-card soon${m.accent ? ` accent-${m.accent}` : ''}" data-module="${m.id}" aria-disabled="true" title="${m.name} is coming soon">
      <span class="sys-top"><span class="sys-ic">${icon(m.glyph, 26)}</span><span class="badge ${m.accent === 'gold' ? 'gold' : 'gray'}">${icon('lock', 12)} Coming soon</span></span>${m.tagline ? html`<span class="sys-tagline">${m.tagline}</span>` : ''}
      <strong class="sys-name" style="font-size:20px">${m.name}</strong>
      <p>${m.description}</p>
      <span class="sys-open">Not available yet</span>
    </div>`;
  // A module this account can open, with its star: pinned ones come first on this page (0.40).
  const pinned = () => (ctx.user.favoriteModules || []).filter((id) => live.some((m) => m.id === id && ctx.moduleHome(id)));
  const slot = (m) => {
    const on = pinned().includes(m.id);
    return html`<div class="sys-slot${on ? ' pinned' : ''}" data-module="${m.id}">${card(m)}
      <button type="button" class="sys-pin" data-pin="${m.id}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${on ? `Unpin ${m.name}` : `Pin ${m.name} to the front`}" title="${on ? 'Pinned to the front: click to unpin' : 'Pin to the front'}">${icon('star', 18)}</button></div>`;
  };
  // Pinned modules first (in the order pinned), then the others this account can open, then locked
  // ones, then the roadmap.
  const ordered = () => {
    const openable = live.filter((m) => ctx.moduleHome(m.id));
    const first = pinned().map((id) => openable.find((m) => m.id === id));
    return [...first, ...openable.filter((m) => !first.includes(m)), ...live.filter((m) => !ctx.moduleHome(m.id))];
  };
  const trackItems = () => html`${ordered().map((m) => (ctx.moduleHome(m.id) ? slot(m) : card(m)))}${soon.map(soonCard)}`;

  // The compact view (0.46): every module at once as a small tile in a grid, in the same order,
  // with the same star; the first live figure (or what the module is) under its name.
  const mini = (m) => {
    const home = ctx.moduleHome(m.id);
    const on = pinned().includes(m.id);
    const soonOne = m.status !== 'live';
    const off = !soonOne && !moduleOn(m.id);
    const sub = soonOne ? 'Coming soon' : !home ? 'No access' : off ? 'Off for the company' : (stats[m.id] || [])[0] || m.tagline;
    const cls = `sys-mini${soonOne ? ' soon' : !home ? ' locked' : ''}${m.accent ? ` accent-${m.accent}` : ''}`;
    const inner = html`<span class="sys-ic">${icon(m.glyph, 20)}</span><span class="grow"><strong>${m.name}</strong><small>${soonOne || !home ? html`${icon('lock', 11)} ` : ''}${sub}</small></span>`;
    if (!home) return html`<div class="${cls}" data-module="${m.id}" aria-disabled="true" title="${m.name}: ${soonOne ? 'coming soon' : 'no access, ask your administrator'}">${inner}</div>`;
    return html`<div class="sys-mini-slot${on ? ' pinned' : ''}" data-module="${m.id}"><a class="${cls}" href="#${home}" title="Open ${m.name}">${inner}</a>
      <button type="button" class="sys-pin" data-pin="${m.id}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${on ? `Unpin ${m.name}` : `Pin ${m.name} to the front`}" title="${on ? 'Pinned to the front: click to unpin' : 'Pin to the front'}">${icon('star', 16)}</button></div>`;
  };
  const compactItems = () => html`${ordered().map(mini)}${soon.map(mini)}`;
  // Integrations (0.49): the services CORE will connect to, under Your modules, as cards (or tiles
  // in the compact view) coming soon, like the modules on the roadmap. Nothing to open yet.
  const intCard = (i) => html`<div class="sys-card soon int-card" data-integration="${i.id}" aria-disabled="true" title="${i.name} is coming soon">
      <span class="sys-top"><span class="sys-ic">${icon(i.glyph, 26)}</span><span class="badge gray">${icon('lock', 12)} Coming soon</span></span><span class="sys-tagline">${i.tagline}</span>
      <strong class="sys-name" style="font-size:20px">${i.name}</strong>
      <p>${i.description}</p>
      <span class="sys-open">Not available yet</span>
    </div>`;
  const intMini = (i) => html`<div class="sys-mini soon" data-integration="${i.id}" aria-disabled="true" title="${i.name}: coming soon"><span class="sys-ic">${icon(i.glyph, 20)}</span><span class="grow"><strong>${i.name}</strong><small>${icon('lock', 11)} Coming soon</small></span></div>`;
  // Cards (the sliding row) or Compact (all at once): kept in this browser, like the theme. Until
  // someone chooses, a phone starts in Compact (0.47) and a larger screen in Cards.
  const VIEW_KEY = 'core-home-view';
  let view = window.matchMedia('(max-width: 760px)').matches ? 'compact' : 'cards';
  try {
    const chosen = localStorage.getItem(VIEW_KEY);
    if (chosen === 'compact' || chosen === 'cards') view = chosen;
  } catch {}
  const viewSwitch = () => html`<div class="seg-btns sys-view" role="group" aria-label="How to show the modules">${[['cards', 'Cards'], ['compact', 'Compact']].map(([k, label]) => html`<button type="button" data-view="${k}" class="${view === k ? 'active' : ''}" aria-pressed="${view === k ? 'true' : 'false'}" title="${k === 'compact' ? 'Every module at once, in a grid' : 'Large cards with live figures, in a sliding row'}">${label}</button>`)}</div>`;

  // Administration: the Admin panel first, then shortcuts to the pages used most.
  const admin = [
    can('users.manage') && ['/admin/users', 'users', 'Users & Access', 'Accounts, sign-in and 2-step'],
    can('settings.center') && ['/admin/config', 'search', 'Settings center', 'Every setting, its history and undo'],
    can('devlog.view') && ['/admin/devlog', 'code', 'Dev log', 'What changed in each release', devlogNew],
    can('feedback.view') && ['/admin/feedback', 'message', 'Feedback inbox', 'What users are telling you', feedbackNew],
  ].filter(Boolean);
  const offCount = MODULES.filter((m) => m.status === 'live' && !moduleOn(m.id)).length;

  mount(el, html`
    <section class="hub-hero">
      <img class="hero-mark" src="/img/core-mark.svg" alt="" />
      <div class="hub-wrap">
        ${ctx.brand?.logo ? html`<img class="hub-logo" src="${ctx.brand.logo}" alt="${ctx.settings.companyName}" />` : ''}
        <p class="hub-kicker">${today}</p>
        <h1>${greeting()}, ${u.name.split(' ')[0]}</h1>
        <p>Welcome to CORE, the ERP of ${ctx.settings.companyName}. Choose a module to continue.</p>
        <a class="hub-role" href="#/profile" title="Your profile">${icon('user', 14)} ${companyRoleOf(u)}</a>
      </div>
    </section>

    <section class="hub-wrap sys-section${view === 'compact' ? ' compact' : ''}" id="sys-section">
      <div class="card-head"><h2 id="sys-heading">${icon('grid')} Your modules</h2>
        <div class="sys-nav"><span class="muted small sys-count">${open} of ${live.length} available to you${soon.length ? ` · ${soon.length} coming soon` : ''}</span>${viewSwitch()}
          <span class="sys-arrows" hidden><button type="button" class="icon-btn" id="sys-prev" aria-label="Previous modules" aria-controls="sys-track">${icon('chevronLeft', 18)}</button><button type="button" class="icon-btn" id="sys-next" aria-label="More modules" aria-controls="sys-track">${icon('chevronRight', 18)}</button></span></div></div>
      <div class="sys-carousel" id="sys-carousel">
        <div class="sys-track" id="sys-track" role="region" aria-labelledby="sys-heading" tabindex="0">${trackItems()}</div>
      </div>
      <div class="sys-dots" id="sys-dots" hidden></div>
      <div class="sys-compact" id="sys-compact" role="region" aria-labelledby="sys-heading">${compactItems()}</div>
    </section>

    <section class="hub-wrap sys-section int-section${view === 'compact' ? ' compact' : ''}" id="int-section" aria-labelledby="int-heading">
      <div class="card-head"><h2 id="int-heading">${icon('link')} Integrations</h2><span class="muted small">Services CORE will connect to · ${INTEGRATIONS.length} coming soon</span></div>
      <div class="int-grid">${INTEGRATIONS.map(intCard)}</div>
      <div class="sys-compact">${INTEGRATIONS.map(intMini)}</div>
    </section>

    ${panelAccess()
      ? html`<section class="hub-wrap">
          <div class="card-head"><h2>${icon('settings')} Administration</h2><span class="muted small">Applies to every module</span></div>
          <a class="admin-panel-card" href="#/admin/dashboard" data-module="admin">
            <span class="ic-box">${icon('shield', 26)}</span>
            <span class="grow"><strong>Admin panel</strong><small>Users and roles, modules, the Settings center, branding, sign-in security, records and backups${offCount ? ` · ${offCount} module${offCount === 1 ? '' : 's'} off` : ''}</small></span>
            <span class="sys-open">Open ${icon('chevronRight', 16)}</span>
          </a>
          ${admin.length ? html`<div class="admin-tiles">${admin.map(([href, ic, title, sub, count]) => html`<a class="admin-tile" href="#${href}"><span class="ic-box">${icon(ic, 20)}</span><span class="grow"><strong>${title}</strong><small>${sub}</small></span>${count ? html`<span class="count">${count} new</span>` : icon('chevronRight', 16)}</a>`)}</div>` : ''}
        </section>`
      : ''}

    <footer class="hub-foot"><div class="hub-wrap">
      <span class="core-foot"><img src="/img/core-mark-brand.svg" alt="" /> CORE · ERP by Lancaster</span>
      <span>© ${new Date().getFullYear()} ${ctx.settings.companyName}</span>
    </div></footer>`);
  const refresh = modulesCarousel(el.querySelector('#sys-carousel'));

  // Pin or unpin: saved on the account (so it follows you to other devices), then the row is
  // redrawn in its new order with the focus kept on the same star.
  const track = el.querySelector('#sys-track');
  const compact = el.querySelector('#sys-compact');
  const section = el.querySelector('#sys-section');
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {}
    section.classList.toggle('compact', view === 'compact');
    el.querySelector('#int-section').classList.toggle('compact', view === 'compact');
    el.querySelectorAll('[data-view]').forEach((x) => {
      x.classList.toggle('active', x.dataset.view === view);
      x.setAttribute('aria-pressed', String(x.dataset.view === view));
    });
    if (view === 'cards') refresh();
  }));
  const onPin = async (e) => {
    const btn = e.target.closest('[data-pin]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.dataset.pin;
    const was = pinned();
    const next = was.includes(id) ? was.filter((x) => x !== id) : [...was, id];
    btn.disabled = true;
    try {
      const r = await api.put('/api/me/favorite-modules', { modules: next });
      ctx.user.favoriteModules = r.favoriteModules;
      window.dispatchEvent(new Event('modules:changed')); // the modules menu puts pinned ones first too
    } catch (err) {
      btn.disabled = false;
      toast(err.message || 'Could not save your pinned modules.', 'error');
      return;
    }
    mount(track, trackItems());
    mount(compact, compactItems());
    track.scrollTo({ left: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    refresh();
    (view === 'compact' ? compact : track).querySelector(`[data-pin="${id}"]`)?.focus({ preventScroll: true });
    const name = MODULES.find((m) => m.id === id)?.name || id;
    toast(next.includes(id) ? `${name} is pinned: it comes first on your CORE home.` : `${name} is no longer pinned.`);
  };
  track.addEventListener('click', onPin);
  compact.addEventListener('click', onPin);
}

// "Your modules" as a carousel, as on the ATLAS home: the cards scroll sideways and snap into place
// (swipe on a phone, arrows or dots elsewhere, or arrow keys once the row has focus). The arrows
// and dots only show when some cards are out of view.
function modulesCarousel(wrap) {
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
    if (!track.isConnected) return;
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
      dots.innerHTML = Array.from({ length: drawn }, (_, i) => `<button type="button" data-page="${i}" aria-label="Modules, page ${i + 1} of ${drawn}"></button>`).join('');
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
    if (card) card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth() });
  });
  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  }, { passive: true });
  const ro = new ResizeObserver(() => (track.isConnected ? update() : ro.disconnect()));
  ro.observe(track);
  update();
  // Called after the cards are redrawn (a module pinned or unpinned): the dots are counted again.
  return () => {
    drawn = -1;
    update();
  };
}