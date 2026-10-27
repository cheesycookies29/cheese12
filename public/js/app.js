import { api } from './api.js';
import { ctx, can, roleLabel } from './state.js';
import { html, mount, toast } from './ui.js';
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
  ['/leave', leaveView, 'leave.manage', 'hr'],
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
    { href: '/dashboard', label: 'Dashboard', permission: 'dashboard' },
    { href: '/employees', label: 'Employees', permission: 'employees.view' },
    { href: '/clock', label: 'Time Clock', permission: 'clock.kiosk' },
    { href: '/dtr', label: 'Attendance (DTR)', permission: 'attendance.view' },
    { href: '/clock-locations', label: 'Clock-in locations', permission: 'attendance.location' },
    { href: '/leave', label: 'Leave & Requests', permission: 'leave.manage', badge: 'requests' },
    { href: '/payroll', label: 'Payroll', permission: 'payroll.view' },
    { href: '/payroll-setup', label: 'Payroll Setup', permission: 'payroll.config' },
    { heading: 'My account', permission: 'self' },
    { href: '/me', label: 'My Home', permission: 'self' },
    { href: '/me/attendance', label: 'My Attendance', permission: 'self' },
    { href: '/me/requests', label: 'My Requests', permission: 'self' },
    { href: '/me/payslips', label: 'My Payslips', permission: 'self' },
    { href: '/me/profile', label: 'My Profile', permission: 'self' },
  ],
  assets: [
    { href: '/assets', label: 'Overview', permission: 'assets.view', exact: true },
    { href: '/assets/list', label: 'Assets', permission: 'assets.view', also: ['/assets/item', '/assets/new'] },
    { href: '/assets/inventory', label: 'Inventory', permission: 'assets.view' },
    { href: '/assets/reports', label: 'Problem reports', permission: 'assets.view', badge: 'reports' },
    { href: '/assets/allocations', label: 'Allocations', permission: 'assets.view' },
    { href: '/assets/activity', label: 'Activity log', permission: 'assets.view' },
    { heading: 'My account', permission: 'self' },
    { href: '/assets/mine', label: 'My Assets', permission: 'self' },
  ],
  helpdesk: [
    { href: '/helpdesk', label: 'Overview', permission: 'helpdesk.agent', exact: true },
    { href: '/helpdesk/tickets', label: 'Tickets', permission: 'helpdesk.agent', badge: 'helpdesk' },
    { href: '/helpdesk/new', label: 'Log a ticket', permission: 'helpdesk.agent' },
    { href: '/helpdesk/settings', label: 'Service desk settings', permission: 'helpdesk.manage' },
    { heading: 'My account', permission: 'auth' },
    { href: '/helpdesk/mine', label: 'My tickets', permission: 'auth' },
  ],
  system: [
    { heading: 'System', permission: 'users.manage' },
    { href: '/users', label: 'Users & Access', permission: 'users.manage' },
    { href: '/settings', label: 'Settings', permission: 'settings.edit' },
    { href: '/devlog', label: 'Dev log', permission: 'devlog.view', badge: 'devlog' },
    { href: '/feedback/inbox', label: 'Feedback inbox', permission: 'feedback.view', badge: 'feedback' },
    { heading: 'Help', permission: 'auth' },
    { href: '/feedback', label: 'Send feedback', permission: 'auth', exact: true },
  ],
};

// Self-service pages need a linked employee record. Staff accounts without one
// don't see them; employee accounts always do (and are told to ask for a link).
function allowed(permission) {
  if (permission === 'auth') return true;
  if (permission === 'self') return can('self') && (Boolean(ctx.user.employeeId) || ctx.user.role === 'employee');
  return can(permission);
}

// Where each module opens for this user; null = no access.
function moduleHome(id) {
  if (id === 'hr') return can('dashboard') ? '/dashboard' : allowed('self') ? '/me' : null;
  if (id === 'assets') return can('assets.view') ? '/assets' : allowed('self') ? '/assets/mine' : null;
  if (id === 'helpdesk') return can('helpdesk.agent') ? '/helpdesk' : '/helpdesk/mine';
  return null;
}

const homeRoute = () => '/launcher';
const MODULE_NAMES = { hr: 'HR & Payroll', assets: 'IT Asset Management', helpdesk: 'IT Service Desk' };

let cleanup = null;
const runCleanup = () => {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
};

function renderNav(module) {
  if (module === ctx.module && document.querySelector('#nav a')) return;
  ctx.module = module;
  document.getElementById('module-name').textContent = MODULE_NAMES[module] || '';
  document.getElementById('topbar-module').textContent = MODULE_NAMES[module] || '';
  const items = [...(NAV[module] || []), ...NAV.system].filter((n) => allowed(n.permission));
  mount(document.getElementById('nav'), html`
    <a href="#/launcher" class="nav-switch">← All modules</a>
    ${items.map((n) =>
      n.heading ? html`<div class="nav-heading">${n.heading}</div>` : html`<a href="#${n.href}" data-href="${n.href}" data-also="${(n.also || []).join(' ')}" ${n.exact ? 'data-exact' : ''}>${n.label}${n.badge ? html`<span class="nav-badge" data-badge="${n.badge}" hidden></span>` : ''}</a>`,
    )}`);
  refreshBadge();
}

function renderUserBox() {
  const u = ctx.user;
  const initials = u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  mount(document.getElementById('user-box'), html`
    <div class="user-id"><span class="avatar">${initials}</span><div><strong>${u.name}</strong><small>${roleLabel(u.role)} · ${u.username}</small></div></div>
    <div class="user-actions"><button class="link" id="change-pw">Change password</button><button class="link" id="sign-out">Sign out</button></div>`);
  document.getElementById('change-pw').addEventListener('click', openChangePassword);
  document.getElementById('sign-out').addEventListener('click', signOut);
}

// Counts next to menu items: pending leave approvals, new equipment problem reports, unread dev log releases, new feedback.
const BADGES = {
  requests: () => (can('leave.approve') ? api.get('/api/requests/summary').then((r) => r.pending) : 0),
  reports: () => api.get('/api/asset-reports/summary').then((r) => r.new),
  devlog: () => unseenCount(),
  feedback: () => api.get('/api/feedback/summary').then((r) => r.new),
  helpdesk: () => api.get('/api/helpdesk/summary').then((r) => r.awaiting),
};
async function refreshBadge() {
  for (const el of document.querySelectorAll('#nav .nav-badge[data-badge]')) {
    const n = await Promise.resolve(BADGES[el.dataset.badge]?.()).catch(() => 0);
    el.textContent = n || '';
    el.hidden = !n;
  }
  // On phones the menu is folded away; a dot on the menu button says something is waiting.
  document.querySelector('#menu-btn .menu-dot').hidden = !document.querySelector('#nav .nav-badge:not([hidden])');
}

// ----- Phone menu: the sidebar slides in as a drawer -----
const menuBtn = document.getElementById('menu-btn');
const scrim = document.getElementById('nav-scrim');
function setMenu(open) {
  document.body.classList.toggle('nav-open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  scrim.hidden = !open;
  if (open) document.querySelector('#nav a.active, #nav a')?.focus({ preventScroll: true });
}
menuBtn.addEventListener('click', () => setMenu(!document.body.classList.contains('nav-open')));
scrim.addEventListener('click', () => setMenu(false));
document.getElementById('sidebar').addEventListener('click', (e) => {
  if (e.target.closest('a[href], #sign-out')) setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('nav-open')) {
    setMenu(false);
    menuBtn.focus();
  }
});

async function navigate() {
  if (!ctx.user || ctx.user.mustChangePassword) return;
  setMenu(false);
  const path = location.hash.replace(/^#/, '').split('?')[0] || homeRoute();
  const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  const match = routes.find((r) => r.re.test(path));
  if (!match || !allowed(match.permission)) return (location.hash = `#${homeRoute()}`);

  const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(path.match(match.re)[i + 1])]));
  // The launcher has no sidebar; system pages keep the menu of the module they were opened from.
  document.body.classList.toggle('launcher-mode', !match.module);
  if (match.module) renderNav(match.module === 'system' ? ctx.module || (moduleHome('hr') ? 'hr' : 'assets') : match.module);
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
    mount(el, html`<div class="empty"><h2>Something went wrong</h2><p>${err.message}</p><p class="muted">Is the server still running? Check the terminal window.</p></div>`);
  }
}

function showAuth(view) {
  runCleanup();
  document.body.className = 'auth-mode';
  mount(document.getElementById('app'), '');
  view(document.getElementById('auth'), { onSignedIn: () => boot({ fresh: true }), onSignOut: signOut });
}

async function boot({ fresh = false } = {}) {
  let status;
  try {
    status = await api.get('/api/auth/status');
  } catch {
    document.body.className = 'auth-mode';
    return mount(document.getElementById('auth'), html`<div class="empty"><h2>Cannot reach the server</h2><p>Start it with <code>npm start</code>, then reload this page.</p></div>`);
  }
  ctx.user = status.user;
  if (!ctx.user) return showAuth(status.setupRequired ? setupView : loginView);
  if (ctx.user.mustChangePassword) return showAuth(forcePasswordView);

  await Promise.all([ctx.refreshSettings(), ctx.refreshLeaveTypes()]);
  document.body.className = '';
  mount(document.getElementById('auth'), '');
  ctx.module = null;
  renderUserBox();
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
window.addEventListener('auth:expired', () => {
  if (!ctx.user) return;
  ctx.user = null;
  toast('Your session has ended. Please sign in again.', 'error');
  boot();
});
boot();
