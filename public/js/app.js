import { api } from './api.js';
import { ctx, can, roleLabel } from './state.js';
import { html, mount, toast, today } from './ui.js';
import { icon, iconSvg } from './icons.js';
import { MODULES } from './modules.js';
import { dashboardView } from './views/dashboard.js';
import { employeeListView, employeeFormView, employeeProfileView } from './views/employees.js';
import { clockView, dtrView } from './views/time.js';
import { payrollListView, payrollRunView, payslipView } from './views/payroll.js';
import { settingsView } from './views/settings.js';
import { usersView } from './views/users.js';
import { meHomeView, meAttendanceView, mePayslipsView, mePayslipView, meProfileView, meRequestsView } from './views/self.js';
import { payrollSetupView } from './views/payroll-setup.js';
import { leaveView } from './views/leave.js';
import { loginView, setupView, forcePasswordView, openChangePassword } from './views/login.js';
import { launcherView } from './views/launcher.js';
import { assetsDashboardView, assetListView, assetFormView, assetDetailView } from './views/assets.js';
import { inventoryView, inventoryItemView } from './views/inventory.js';
import { allocationsView, activityView, myAssetsView } from './views/allocations.js';
import { reportsView, reportDetailView } from './views/reports.js';
import { devlogView, unseenCount } from './views/devlog.js';
import { feedbackView, feedbackInboxView, feedbackDetailView } from './views/feedback.js';
import { clockLocationsView } from './views/locations.js';
import { approvalsView } from './views/approvals.js';
import { crmOverviewView, pipelineView, dealView, leadsView, leadView, accountsView, accountView, contactsView, contactView, bidsView, bidView, contractsView, contractView, activitiesView, crmSettingsView } from './views/crm.js';
import { holidaysView } from './views/holidays.js';
import { helpdeskHomeView, ticketQueueView, ticketView, newTicketView, myTicketsView, myTicketView, helpdeskSettingsView } from './views/helpdesk.js';

// [path, view, permission needed, module]
const routes = [
  ['/launcher', launcherView, 'auth', null],
  // HR & Payroll
  ['/dashboard', dashboardView, 'dashboard', 'hr'],
  ['/employees', employeeListView, 'employees.view', 'hr'],
  ['/employees/new', employeeFormView, 'employees.edit', 'hr'],
  ['/employees/:id/edit', employeeFormView, 'employees.edit', 'hr'],
  ['/employees/:id', employeeProfileView, 'employees.view', 'hr'],
  ['/clock', clockView, 'clock.kiosk', 'hr'],
  ['/dtr', dtrView, 'attendance.view', 'hr'],
  ['/clock-locations', clockLocationsView, 'attendance.location', 'hr'],
  ['/payroll', payrollListView, 'payroll.view', 'hr'],
  ['/payroll/:id/payslip/:employeeId', payslipView, 'payroll.view', 'hr'],
  ['/payroll/:id', payrollRunView, 'payroll.view', 'hr'],
  ['/payroll-setup', payrollSetupView, 'payroll.config', 'hr'],
  ['/holidays', holidaysView, 'holidays.manage', 'hr'],
  ['/leave', leaveView, 'leave.manage', 'hr'],
  ['/approvals', approvalsView, 'approver', 'hr'],
  ['/me', meHomeView, 'self', 'hr'],
  ['/me/attendance', meAttendanceView, 'self', 'hr'],
  ['/me/requests', meRequestsView, 'self', 'hr'],
  ['/me/payslips', mePayslipsView, 'self', 'hr'],
  ['/me/payslips/:runId', mePayslipView, 'self', 'hr'],
  ['/me/profile', meProfileView, 'self', 'hr'],
  // IT Asset Management
  ['/assets', assetsDashboardView, 'assets.view', 'assets'],
  ['/assets/list', assetListView, 'assets.view', 'assets'],
  ['/assets/new', assetFormView, 'assets.edit', 'assets'],
  ['/assets/item/:id/edit', assetFormView, 'assets.edit', 'assets'],
  ['/assets/item/:id', assetDetailView, 'assets.view', 'assets'],
  ['/assets/inventory', inventoryView, 'assets.view', 'assets'],
  ['/assets/inventory/:id', inventoryItemView, 'assets.view', 'assets'],
  ['/assets/allocations', allocationsView, 'assets.view', 'assets'],
  ['/assets/activity', activityView, 'assets.view', 'assets'],
  ['/assets/reports', reportsView, 'assets.view', 'assets'],
  ['/assets/reports/:id', reportDetailView, 'assets.view', 'assets'],
  ['/assets/mine', myAssetsView, 'self', 'assets'],
  // IT Service Desk
  ['/helpdesk', helpdeskHomeView, 'helpdesk.agent', 'helpdesk'],
  ['/helpdesk/tickets', ticketQueueView, 'helpdesk.agent', 'helpdesk'],
  ['/helpdesk/new', newTicketView, 'helpdesk.agent', 'helpdesk'],
  ['/helpdesk/tickets/:id', ticketView, 'helpdesk.agent', 'helpdesk'],
  ['/helpdesk/mine', myTicketsView, 'auth', 'helpdesk'],
  ['/helpdesk/mine/:id', myTicketView, 'auth', 'helpdesk'],
  ['/helpdesk/settings', helpdeskSettingsView, 'helpdesk.manage', 'helpdesk'],
  // Sales & CRM
  ['/crm', crmOverviewView, 'crm.view', 'crm'],
  ['/crm/pipeline', pipelineView, 'crm.view', 'crm'],
  ['/crm/deals/:id', dealView, 'crm.view', 'crm'],
  ['/crm/leads', leadsView, 'crm.view', 'crm'],
  ['/crm/leads/:id', leadView, 'crm.view', 'crm'],
  ['/crm/accounts', accountsView, 'crm.view', 'crm'],
  ['/crm/accounts/:id', accountView, 'crm.view', 'crm'],
  ['/crm/contacts', contactsView, 'crm.view', 'crm'],
  ['/crm/contacts/:id', contactView, 'crm.view', 'crm'],
  ['/crm/bids', bidsView, 'crm.view', 'crm'],
  ['/crm/bids/:id', bidView, 'crm.view', 'crm'],
  ['/crm/contracts', contractsView, 'crm.view', 'crm'],
  ['/crm/contracts/:id', contractView, 'crm.view', 'crm'],
  ['/crm/activities', activitiesView, 'crm.view', 'crm'],
  ['/crm/settings', crmSettingsView, 'crm.manage', 'crm'],
  // System (shown inside whichever module is open)
  ['/users', usersView, 'users.manage', 'system'],
  ['/settings', settingsView, 'settings.edit', 'system'],
  ['/devlog', devlogView, 'devlog.view', 'system'],
  ['/feedback', feedbackView, 'auth', 'system'],
  ['/feedback/inbox', feedbackInboxView, 'feedback.view', 'system'],
  ['/feedback/inbox/:id', feedbackDetailView, 'feedback.view', 'system'],
].map(([pattern, view, permission, module]) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  return { re, keys, view, permission, module };
});

// Sidebar menus per module. `also` lists other paths that light up the same item.
const NAV = {
  hr: [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard' },
    { href: '/employees', label: 'Employees', icon: 'users', permission: 'employees.view' },
    { href: '/clock', label: 'Time Clock', icon: 'clock', permission: 'clock.kiosk' },
    { href: '/dtr', label: 'Attendance (DTR)', icon: 'table', permission: 'attendance.view' },
    { href: '/clock-locations', label: 'Clock-in locations', icon: 'mapPin', permission: 'attendance.location' },
    { href: '/approvals', label: 'Approvals', icon: 'checkCircle', permission: 'approver', badge: 'approvals' },
    { href: '/leave', label: 'Leave & Requests', icon: 'clipboard', permission: 'leave.manage' },
    { href: '/payroll', label: 'Payroll', icon: 'wallet', permission: 'payroll.view' },
    { href: '/payroll-setup', label: 'Payroll Setup', icon: 'settings', permission: 'payroll.config' },
    { href: '/holidays', label: 'Holidays', icon: 'flag', permission: 'holidays.manage' },
    { heading: 'My account', permission: 'self' },
    { href: '/me', label: 'My Home', icon: 'home', permission: 'self', exact: true },
    { href: '/me/attendance', label: 'My Attendance', icon: 'calendar', permission: 'self' },
    { href: '/me/requests', label: 'My Requests', icon: 'inbox', permission: 'self' },
    { href: '/me/payslips', label: 'My Payslips', icon: 'receipt', permission: 'self' },
    { href: '/me/profile', label: 'My Profile', icon: 'user', permission: 'self' },
  ],
  assets: [
    { href: '/assets', label: 'Overview', icon: 'dashboard', permission: 'assets.view', exact: true },
    { href: '/assets/list', label: 'Assets', icon: 'laptop', permission: 'assets.view', also: ['/assets/item', '/assets/new'] },
    { href: '/assets/inventory', label: 'Inventory', icon: 'box', permission: 'assets.view' },
    { href: '/assets/reports', label: 'Problem reports', icon: 'alert', permission: 'assets.view', badge: 'reports' },
    { href: '/assets/allocations', label: 'Allocations', icon: 'userPlus', permission: 'assets.view' },
    { href: '/assets/activity', label: 'Activity log', icon: 'activity', permission: 'assets.view' },
    { heading: 'My account', permission: 'self' },
    { href: '/assets/mine', label: 'My Assets', icon: 'laptop', permission: 'self' },
  ],
  helpdesk: [
    { href: '/helpdesk', label: 'Overview', icon: 'dashboard', permission: 'helpdesk.agent', exact: true },
    { href: '/helpdesk/tickets', label: 'Tickets', icon: 'ticket', permission: 'helpdesk.agent', badge: 'helpdesk' },
    { href: '/helpdesk/new', label: 'Log a ticket', icon: 'plus', permission: 'helpdesk.agent' },
    { href: '/helpdesk/settings', label: 'Service desk settings', icon: 'settings', permission: 'helpdesk.manage' },
    { heading: 'My account', permission: 'auth' },
    { href: '/helpdesk/mine', label: 'My tickets', icon: 'inbox', permission: 'auth' },
  ],
  crm: [
    { href: '/crm', label: 'Overview', icon: 'dashboard', permission: 'crm.view', exact: true },
    { href: '/crm/pipeline', label: 'Pipeline', icon: 'chart', permission: 'crm.view', also: ['/crm/deals'] },
    { href: '/crm/leads', label: 'Leads', icon: 'userPlus', permission: 'crm.view', badge: 'leads' },
    { href: '/crm/accounts', label: 'Accounts', icon: 'building', permission: 'crm.view' },
    { href: '/crm/contacts', label: 'Contacts', icon: 'users', permission: 'crm.view' },
    { href: '/crm/bids', label: 'Bids', icon: 'clipboard', permission: 'crm.view' },
    { href: '/crm/contracts', label: 'Contracts', icon: 'file', permission: 'crm.view' },
    { href: '/crm/activities', label: 'Activities', icon: 'calendar', permission: 'crm.view', badge: 'crmTasks' },
    { href: '/crm/settings', label: 'Sales setup', icon: 'settings', permission: 'crm.manage' },
  ],
  system: [
    { heading: 'System', permission: 'users.manage' },
    { href: '/users', label: 'Users & Access', icon: 'shield', permission: 'users.manage' },
    { href: '/settings', label: 'Settings', icon: 'toggles', permission: 'settings.edit' },
    { href: '/devlog', label: 'Dev log', icon: 'code', permission: 'devlog.view', badge: 'devlog' },
    { href: '/feedback/inbox', label: 'Feedback inbox', icon: 'message', permission: 'feedback.view', badge: 'feedback' },
    { heading: 'Help', permission: 'auth' },
    { href: '/feedback', label: 'Send feedback', icon: 'comment', permission: 'auth', exact: true },
  ],
};

// Self-service pages need a linked employee record. Staff accounts without one
// don't see them; employee accounts always do (and are told to ask for a link).
function allowed(permission) {
  if (permission === 'auth') return true;
  // Supervisors (even on an Employee account), named approvers and HR see the Approval Center.
  if (permission === 'approver') return Boolean(ctx.user.isApprover);
  if (permission === 'self') return can('self') && (Boolean(ctx.user.employeeId) || ctx.user.role === 'employee');
  return can(permission);
}

// Where each module opens for this user; null = no access.
function moduleHome(id) {
  if (id === 'hr') return can('dashboard') ? '/dashboard' : allowed('self') ? '/me' : allowed('approver') ? '/approvals' : null;
  if (id === 'assets') return can('assets.view') ? '/assets' : allowed('self') ? '/assets/mine' : null;
  if (id === 'helpdesk') return can('helpdesk.agent') ? '/helpdesk' : '/helpdesk/mine';
  if (id === 'crm') return can('crm.view') ? '/crm' : null;
  return null;
}

const homeRoute = () => '/launcher';
const liveModules = () => MODULES.filter((m) => m.status === 'live');
const moduleOf = (id) => MODULES.find((m) => m.id === id);
const body = document.body;

let cleanup = null;
const runCleanup = () => {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
};

// ----- Top bar -----
function renderBrandSub() {
  const m = moduleOf(ctx.module);
  document.getElementById('brand-sub').textContent = m && !body.classList.contains('launcher-mode') ? m.name : ctx.settings?.companyName || 'Lancaster Technology and Development Corporation';
}

const isDark = () => document.documentElement.dataset.theme === 'dark';
const themeBtn = document.getElementById('theme-btn');
function renderThemeButton() {
  themeBtn.innerHTML = iconSvg(isDark() ? 'sun' : 'moon');
  themeBtn.title = isDark() ? 'Light mode' : 'Dark mode';
  themeBtn.setAttribute('aria-label', themeBtn.title);
}
themeBtn.addEventListener('click', () => {
  if (isDark()) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = 'dark';
  try {
    localStorage.setItem('core-theme', isDark() ? 'dark' : 'light');
  } catch {}
  renderThemeButton();
});
renderThemeButton();

// A drop-down opened from a top-bar button; closes on outside click or Escape.
function popover(root, btn, pop) {
  const close = () => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    closePops();
    setMenu(false);
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  pop.addEventListener('click', (e) => e.target.closest('a, button') && close());
  pops.push(close);
}
const pops = [];
const closePops = () => pops.forEach((close) => close());
document.addEventListener('click', (e) => !e.target.closest('.user-menu, .mod-switch') && closePops());

// The grid button: jump between modules without going back to the launcher.
function renderModuleSwitch() {
  const box = document.getElementById('mod-switch');
  const items = liveModules().map((m) => ({ ...m, home: moduleHome(m.id) })).filter((m) => m.home);
  mount(box, html`
    <button type="button" class="round-btn" id="mod-btn" title="Modules" aria-label="Modules" aria-haspopup="menu" aria-expanded="false">${icon('grid', 18)}</button>
    <div class="menu-pop mod-pop" id="mod-pop" role="menu" hidden>
      <div class="menu-label">CORE modules</div>
      ${items.map((m) => html`<a role="menuitem" href="#${m.home}" data-mod="${m.id}"><span class="mod-ic">${icon(m.glyph, 18)}</span><span class="grow"><strong>${m.name}</strong><small>${m.tagline}</small></span></a>`)}
      <div class="menu-sep"></div>
      <a role="menuitem" href="#/launcher">${icon('home')} <span class="grow">All modules</span></a>
    </div>`);
  popover(box, box.querySelector('#mod-btn'), box.querySelector('#mod-pop'));
}
function markModuleSwitch() {
  document.querySelectorAll('#mod-pop a[data-mod]').forEach((a) => a.classList.toggle('on', !body.classList.contains('launcher-mode') && a.dataset.mod === ctx.module));
}

function renderUserBox() {
  const u = ctx.user;
  const initials = u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const box = document.getElementById('user-box');
  mount(box, html`
    <button type="button" class="user-btn" id="user-btn" aria-haspopup="menu" aria-expanded="false">
      <span class="avatar">${initials}</span>
      <span class="who-text"><strong>${u.name}</strong><small>${roleLabel(u.role)}</small></span>
      ${icon('chevronDown', 16)}
    </button>
    <div class="menu-pop" id="user-pop" role="menu" hidden>
      <div class="who"><strong>${u.name}</strong><small>${u.username}</small><small>${roleLabel(u.role)}</small></div>
      <a role="menuitem" href="#/feedback">${icon('comment')} Send feedback</a>
      <button type="button" role="menuitem" id="change-pw">${icon('key')} Change password</button>
      <button type="button" role="menuitem" id="sign-out">${icon('logout')} Sign out</button>
    </div>`);
  popover(box, box.querySelector('#user-btn'), box.querySelector('#user-pop'));
  box.querySelector('#change-pw').addEventListener('click', openChangePassword);
  box.querySelector('#sign-out').addEventListener('click', signOut);
}

// ----- Sidebar -----
function renderNav(module) {
  if (module === ctx.module && document.querySelector('#nav a')) return;
  ctx.module = module;
  const m = moduleOf(module);
  const items = [...(NAV[module] || []), ...NAV.system].filter((n) => allowed(n.permission));
  mount(document.getElementById('nav'), html`
    ${m ? html`<div class="nav-module" title="${m.name}"><span class="mod-ic">${icon(m.glyph, 18)}</span><span><strong>${m.name}</strong><small>${m.code}</small></span></div>` : ''}
    ${items.map((n) =>
      n.heading
        ? html`<div class="nav-heading">${n.heading}</div>`
        : html`<a href="#${n.href}" title="${n.label}" data-href="${n.href}" data-also="${(n.also || []).join(' ')}" ${n.exact ? 'data-exact' : ''}>${icon(n.icon || 'file')}<span class="label">${n.label}</span>${n.badge ? html`<span class="nav-badge" data-badge="${n.badge}" hidden></span>` : ''}</a>`,
    )}`);
  refreshBadge();
}

// Counts next to menu items: pending leave approvals, new equipment problem reports, unread dev log releases, new feedback.
const BADGES = {
  approvals: () => (ctx.user.isApprover ? api.get('/api/approvals/summary').then((r) => r.pending) : 0),
  reports: () => api.get('/api/asset-reports/summary').then((r) => r.new),
  devlog: () => unseenCount(),
  feedback: () => api.get('/api/feedback/summary').then((r) => r.new),
  helpdesk: () => api.get('/api/helpdesk/summary').then((r) => r.awaiting),
  leads: () => api.get('/api/crm/overview').then((r) => r.newLeads),
  crmTasks: () => api.get('/api/crm/activities?mine=1&open=1').then((list) => list.filter((a) => a.dueDate && a.dueDate <= today()).length),
};
async function refreshBadge() {
  for (const el of document.querySelectorAll('#nav .nav-badge[data-badge]')) {
    const n = await Promise.resolve(BADGES[el.dataset.badge]?.()).catch(() => 0);
    el.textContent = n || '';
    el.hidden = !n;
  }
  // When the menu is folded away, a dot on the menu button says something is waiting.
  menuDot.hidden = !document.querySelector('#nav .nav-badge:not([hidden])');
}

// ----- Menu button: folds the sidebar to icons on wide screens, a drawer on phones -----
const menuBtn = document.getElementById('menu-btn');
menuBtn.innerHTML = `${iconSvg('menu', 20)}<span class="dot" hidden></span>`;
const menuDot = menuBtn.querySelector('.dot');
const scrim = document.getElementById('nav-scrim');
const phone = () => matchMedia('(max-width: 960px)').matches;
function setMenu(open) {
  body.classList.toggle('nav-open', open);
  menuBtn.setAttribute('aria-expanded', String(phone() ? open : !body.classList.contains('nav-mini')));
  scrim.hidden = !open;
  if (open) document.querySelector('#nav a.active, #nav a')?.focus({ preventScroll: true });
}
try {
  if (localStorage.getItem('core-nav') === 'mini') body.classList.add('nav-mini');
} catch {}
menuBtn.addEventListener('click', () => {
  closePops();
  if (phone()) return setMenu(!body.classList.contains('nav-open'));
  const mini = body.classList.toggle('nav-mini');
  menuBtn.setAttribute('aria-expanded', String(!mini));
  try {
    localStorage.setItem('core-nav', mini ? 'mini' : 'full');
  } catch {}
});
scrim.addEventListener('click', () => setMenu(false));
document.getElementById('sidebar').addEventListener('click', (e) => {
  if (e.target.closest('a[href]')) setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closePops();
  if (body.classList.contains('nav-open')) {
    setMenu(false);
    menuBtn.focus();
  }
});

async function navigate() {
  if (!ctx.user || ctx.user.mustChangePassword) return;
  setMenu(false);
  closePops();
  const path = location.hash.replace(/^#/, '').split('?')[0] || homeRoute();
  const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  const match = routes.find((r) => r.re.test(path));
  if (!match || !allowed(match.permission)) return (location.hash = `#${homeRoute()}`);

  const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(path.match(match.re)[i + 1])]));
  // The launcher has no sidebar; system pages keep the menu of the module they were opened from.
  body.classList.toggle('launcher-mode', !match.module);
  if (match.module) renderNav(match.module === 'system' ? ctx.module || ['hr', 'assets', 'crm', 'helpdesk'].find((m) => moduleHome(m)) : match.module);
  renderBrandSub();
  markModuleSwitch();
  // Highlight the most specific nav link that contains the current path.
  const links = [...document.querySelectorAll('#nav a[data-href]')];
  const hits = (a) => {
    const prefixes = [a.dataset.href, ...a.dataset.also.split(' ').filter(Boolean)];
    return prefixes.some((p) => path === p || (!a.hasAttribute('data-exact') && path.startsWith(p + '/')));
  };
  const best = links.filter(hits).sort((a, b) => b.dataset.href.length - a.dataset.href.length)[0];
  links.forEach((a) => a.classList.toggle('active', a === best));

  runCleanup();
  refreshBadge();
  // A fresh container per page, so listeners a view attached to it can't fire on the next page.
  const old = document.getElementById('app');
  const el = old.cloneNode(false);
  old.replaceWith(el);
  window.scrollTo(0, 0);
  try {
    cleanup = await match.view(el, params, query);
  } catch (err) {
    mount(el, html`<div class="card empty">${icon('flag', 40)}<h2>Something went wrong</h2><p>${err.message}</p><p class="muted">Is the server still running? Check the window it was started from.</p></div>`);
  }
}

function setMode(mode) {
  body.classList.remove('booting', 'auth-mode', 'launcher-mode', 'nav-open');
  if (mode) body.classList.add(mode);
}

function showAuth(view) {
  runCleanup();
  setMode('auth-mode');
  mount(document.getElementById('app'), '');
  view(document.getElementById('auth'), { onSignedIn: () => boot({ fresh: true }), onSignOut: signOut });
}

async function boot({ fresh = false } = {}) {
  let status;
  try {
    status = await api.get('/api/auth/status');
  } catch {
    setMode('auth-mode');
    return mount(document.getElementById('auth'), html`<div class="empty"><h2>Cannot reach the server</h2><p>Start CORE (double-click “Start CORE ERP”, or <code>npm start</code>), then reload this page.</p></div>`);
  }
  ctx.user = status.user;
  if (!ctx.user) return showAuth(status.setupRequired ? setupView : loginView);
  if (ctx.user.mustChangePassword) return showAuth(forcePasswordView);

  await Promise.all([ctx.refreshSettings(), ctx.refreshLeaveTypes(), ctx.refreshHolidays()]);
  setMode(null);
  mount(document.getElementById('auth'), '');
  ctx.module = null;
  pops.length = 0;
  renderUserBox();
  renderModuleSwitch();
  if (fresh || !location.hash || location.hash === '#/') location.hash = `#${homeRoute()}`;
  navigate();
}

async function signOut() {
  await api.post('/api/auth/logout').catch(() => {});
  ctx.user = null;
  history.replaceState(null, '', location.pathname);
  boot();
}
ctx.signOut = signOut;
ctx.moduleHome = moduleHome;
ctx.changePassword = openChangePassword;

window.addEventListener('hashchange', navigate);
window.addEventListener('requests:changed', refreshBadge);
window.addEventListener('reports:changed', refreshBadge);
window.addEventListener('devlog:seen', refreshBadge);
window.addEventListener('feedback:changed', refreshBadge);
window.addEventListener('helpdesk:changed', refreshBadge);
window.addEventListener('crm:changed', refreshBadge);
window.addEventListener('auth:expired', () => {
  if (!ctx.user) return;
  ctx.user = null;
  toast('Your session has ended. Please sign in again.', 'error');
  boot();
});
boot();
