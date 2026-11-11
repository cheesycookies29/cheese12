// CORE home: the first page after sign-in. A greeting, the modules this account can open
// (with a few live figures), the roadmap, and administration shortcuts.
import { api } from '../api.js';
import { ctx, can, roleLabel } from '../state.js';
import { MODULES } from '../modules.js';
import { unseenCount } from './devlog.js';
import { html, mount } from '../ui.js';
import { icon } from '../icons.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// A few live figures per module, only from data this user may see.
async function moduleStats() {
  const get = (url) => api.get(url).catch(() => null);
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
  const u = ctx.user;
  const [stats, devlogNew, feedbackNew] = await Promise.all([
    moduleStats(),
    can('devlog.view') ? unseenCount().catch(() => 0) : 0,
    can('feedback.view') ? api.get('/api/feedback/summary').then((r) => r.new).catch(() => 0) : 0,
  ]);
  const live = MODULES.filter((m) => m.status === 'live');
  const soon = MODULES.filter((m) => m.status !== 'live');
  const open = live.filter((m) => ctx.moduleHome(m.id)).length;
  const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const card = (m) => {
    const home = ctx.moduleHome(m.id);
    const figures = stats[m.id] || [];
    const top = html`<span class="sys-top"><span class="sys-ic">${icon(m.glyph, 26)}</span><span class="sys-code">${m.code}</span></span>`;
    return home
      ? html`<a class="sys-card" href="#${home}" data-module="${m.id}">
          ${top}
          <strong class="sys-name" style="font-size:20px">${m.name}</strong>
          <p>${m.description}</p>
          ${figures.length ? html`<ul class="sys-figs">${figures.map((f) => html`<li>${f}</li>`)}</ul>` : ''}
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
  const soonCard = (m) => html`<div class="sys-card soon" data-module="${m.id}" aria-disabled="true" title="${m.name} is coming soon">
      <span class="sys-top"><span class="sys-ic">${icon(m.glyph, 26)}</span><span class="badge gray">${icon('lock', 12)} Coming soon</span></span>
      <strong class="sys-name" style="font-size:20px">${m.name}</strong>
      <p>${m.description}</p>
      <span class="sys-open">Not available yet</span>
    </div>`;
  // The ones this account can open come first, then locked ones, then the roadmap.
  const ordered = [...live.filter((m) => ctx.moduleHome(m.id)), ...live.filter((m) => !ctx.moduleHome(m.id))];

  const admin = [
    can('users.manage') && ['/users', 'shield', 'Users & Access', 'Accounts, roles and agents'],
    can('settings.edit') && ['/settings', 'toggles', 'Settings & Backups', 'Company details and data'],
    can('devlog.view') && ['/devlog', 'code', 'Dev log', 'What changed in each release', devlogNew],
    can('feedback.view') && ['/feedback/inbox', 'message', 'Feedback inbox', 'What users are telling you', feedbackNew],
  ].filter(Boolean);

  mount(el, html`
    <section class="hub-hero">
      <img class="hero-mark" src="/img/core-mark.svg" alt="" />
      <div class="hub-wrap">
        <p class="hub-kicker">${today}</p>
        <h1>${greeting()}, ${u.name.split(' ')[0]}</h1>
        <p>Welcome to CORE, the ERP of ${ctx.settings.companyName}. Choose a module to continue.</p>
        <span class="hub-role">${icon('user', 14)} ${roleLabel(u.role)}</span>
      </div>
    </section>

    <section class="hub-wrap">
      <div class="card-head"><h2 id="sys-heading">${icon('grid')} Your modules</h2>
        <div class="sys-nav"><span class="muted small">${open} of ${live.length} available to you${soon.length ? ` · ${soon.length} coming soon` : ''}</span>
          <span class="sys-arrows" hidden><button type="button" class="icon-btn" id="sys-prev" aria-label="Previous modules" aria-controls="sys-track">${icon('chevronLeft', 18)}</button><button type="button" class="icon-btn" id="sys-next" aria-label="More modules" aria-controls="sys-track">${icon('chevronRight', 18)}</button></span></div></div>
      <div class="sys-carousel" id="sys-carousel">
        <div class="sys-track" id="sys-track" role="region" aria-labelledby="sys-heading" tabindex="0">${ordered.map(card)}${soon.map(soonCard)}</div>
      </div>
      <div class="sys-dots" id="sys-dots" hidden></div>
    </section>

    ${admin.length
      ? html`<section class="hub-wrap">
          <div class="card-head"><h2>${icon('settings')} Administration</h2><span class="muted small">Applies to every module</span></div>
          <div class="admin-tiles">${admin.map(([href, ic, title, sub, count]) => html`<a class="admin-tile" href="#${href}"><span class="ic-box">${icon(ic, 20)}</span><span class="grow"><strong>${title}</strong><small>${sub}</small></span>${count ? html`<span class="count">${count} new</span>` : icon('chevronRight', 16)}</a>`)}</div>
        </section>`
      : ''}

    <footer class="hub-foot"><div class="hub-wrap">
      <span class="core-foot"><img src="/img/core-mark-brand.svg" alt="" /> CORE · ERP by Lancaster</span>
      <span>© ${new Date().getFullYear()} ${ctx.settings.companyName}</span>
    </div></footer>`);
  modulesCarousel(el.querySelector('#sys-carousel'));
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
    const card = e.target.closest('.sys-card');
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
}