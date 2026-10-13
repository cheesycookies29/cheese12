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

// [path, view, permission needed]
const routes = [
  ['/dashboard', dashboardView, 'dashboard'],
  ['/employees', employeeListView, 'employees.view'],
  ['/employees/new', employeeFormView, 'employees.edit'],
  ['/employees/:id/edit', employeeFormView, 'employees.edit'],
  ['/employees/:id', employeeProfileView, 'employees.view'],
  ['/clock', clockView, 'clock.kiosk'],
  ['/dtr', dtrView, 'attendance.view'],
  ['/payroll', payrollListView, 'payroll.view'],
  ['/payroll/:id/payslip/:employeeId', payslipView, 'payroll.view'],
  ['/payroll/:id', payrollRunView, 'payroll.view'],
  ['/payroll-setup', payrollSetupView, 'payroll.config'],
  ['/leave', leaveView, 'leave.manage'],
  ['/users', usersView, 'users.manage'],
  ['/settings', settingsView, 'settings.edit'],
  ['/me', meHomeView, 'self'],
  ['/me/attendance', meAttendanceView, 'self'],
  ['/me/requests', meRequestsView, 'self'],
  ['/me/payslips', mePayslipsView, 'self'],
  ['/me/payslips/:runId', mePayslipView, 'self'],
  ['/me/profile', meProfileView, 'self'],
].map(([pattern, view, permission]) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  return { re, keys, view, permission };
});

const NAV = [
  { href: '/dashboard', label: 'Dashboard', permission: 'dashboard' },
  { href: '/employees', label: 'Employees', permission: 'employees.view' },
  { href: '/clock', label: 'Time Clock', permission: 'clock.kiosk' },
  { href: '/dtr', label: 'Attendance (DTR)', permission: 'attendance.view' },
  { href: '/leave', label: 'Leave & Requests', permission: 'leave.manage', badge: true },
  { href: '/payroll', label: 'Payroll', permission: 'payroll.view' },
  { href: '/payroll-setup', label: 'Payroll Setup', permission: 'payroll.config' },
  { href: '/users', label: 'Users & Access', permission: 'users.manage' },
  { href: '/settings', label: 'Settings', permission: 'settings.edit' },
  { heading: 'My account', permission: 'self' },
  { href: '/me', label: 'My Home', permission: 'self' },
  { href: '/me/attendance', label: 'My Attendance', permission: 'self' },
  { href: '/me/requests', label: 'My Requests', permission: 'self' },
  { href: '/me/payslips', label: 'My Payslips', permission: 'self' },
  { href: '/me/profile', label: 'My Profile', permission: 'self' },
];

// Self-service pages need a linked employee record. Staff accounts without one
// don't see them; employee accounts always do (and are told to ask for a link).
function allowed(permission) {
  if (permission === 'self') return can('self') && (Boolean(ctx.user.employeeId) || !can('dashboard'));
  return can(permission);
}

const homeRoute = () => (can('dashboard') ? '/dashboard' : '/me');

let cleanup = null;
const runCleanup = () => {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
};

function renderChrome() {
  mount(document.getElementById('nav'), NAV.filter((n) => allowed(n.permission)).map((n) =>
    n.heading ? html`<div class="nav-heading">${n.heading}</div>` : html`<a href="#${n.href}" data-href="${n.href}">${n.label}${n.badge ? html`<span class="nav-badge" hidden></span>` : ''}</a>`,
  ));
  refreshBadge();
  const u = ctx.user;
  const initials = u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  mount(document.getElementById('user-box'), html`
    <div class="user-id"><span class="avatar">${initials}</span><div><strong>${u.name}</strong><small>${roleLabel(u.role)} · ${u.username}</small></div></div>
    <div class="user-actions"><button class="link" id="change-pw">Change password</button><button class="link" id="sign-out">Sign out</button></div>`);
  document.getElementById('change-pw').addEventListener('click', openChangePassword);
  document.getElementById('sign-out').addEventListener('click', signOut);
}

// Pending-approval count next to "Leave & Requests" for approvers.
async function refreshBadge() {
  const el = document.querySelector('#nav .nav-badge');
  if (!el || !can('leave.approve')) return;
  const { pending } = await api.get('/api/requests/summary').catch(() => ({ pending: 0 }));
  el.textContent = pending;
  el.hidden = !pending;
}

async function navigate() {
  if (!ctx.user || ctx.user.mustChangePassword) return;
  const path = location.hash.replace(/^#/, '').split('?')[0] || homeRoute();
  const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  const match = routes.find((r) => r.re.test(path));
  if (!match || !allowed(match.permission)) return (location.hash = `#${homeRoute()}`);

  const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(path.match(match.re)[i + 1])]));
  // Highlight the most specific nav link that contains the current path.
  const links = [...document.querySelectorAll('#nav a')];
  const best = links.filter((a) => path === a.dataset.href || path.startsWith(a.dataset.href + '/')).sort((a, b) => b.dataset.href.length - a.dataset.href.length)[0];
  links.forEach((a) => a.classList.toggle('active', a === best));

  runCleanup();
  refreshBadge();
  const el = document.getElementById('app');
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
  renderChrome();
  if (fresh || !location.hash || location.hash === '#/') location.hash = `#${homeRoute()}`;
  navigate();
}

async function signOut() {
  await api.post('/api/auth/logout').catch(() => {});
  ctx.user = null;
  history.replaceState(null, '', location.pathname);
  boot();
}

window.addEventListener('hashchange', navigate);
window.addEventListener('requests:changed', refreshBadge);
window.addEventListener('auth:expired', () => {
  if (!ctx.user) return;
  ctx.user = null;
  toast('Your session has ended. Please sign in again.', 'error');
  boot();
});
boot();
