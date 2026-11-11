// ATLAS Control (/control/): the administrators' control panel for the whole of ATLAS. Access to
// every system (Access map, Roles & permissions, Sign-in and passwords, Single sign-on), every
// account (Accounts, Sessions, Locked sign-ins) and the Audit trail. Only administrators open it;
// it signs in with their admin-panel session (server/control.js).
import { startApp, authScreen } from '../shell.js';
import { html } from '../ui.js';
import { api } from '../api.js';
import { roleLabel } from '/shared/roles.js';
import { overviewView } from './views/overview.js';
import { accountsView, accountView } from './views/accounts.js';
import { sessionsView, locksView } from './views/sessions.js';
import { accessView, signInView } from './views/access.js';
import { auditView } from './views/audit.js';
import { rolesView } from '../admin/views/roles.js';
import { ssoView } from '../admin/views/sso.js';

const routes = [
  ['/overview', overviewView],
  ['/accounts', accountsView],
  ['/accounts/:id', accountView],
  ['/sessions', sessionsView],
  ['/locks', locksView],
  ['/access', accessView],
  ['/roles', rolesView],
  ['/sign-in', signInView],
  ['/sso', ssoView],
  ['/audit', auditView],
];

const nav = () => [
  { href: '/overview', label: 'Overview', icon: 'home' },
  { heading: 'Users' },
  { href: '/accounts', label: 'Accounts', icon: 'users' },
  { href: '/sessions', label: 'Sessions', icon: 'laptop' },
  { href: '/locks', label: 'Locked sign-ins', icon: 'lock', badge: 'locks' },
  { heading: 'Access' },
  { href: '/access', label: 'Access map', icon: 'grid' },
  { href: '/roles', label: 'Roles & permissions', icon: 'shield' },
  { href: '/sign-in', label: 'Sign-in and passwords', icon: 'key' },
  { href: '/sso', label: 'Single sign-on', icon: 'link' },
  { heading: 'Audit' },
  { href: '/audit', label: 'Audit trail', icon: 'search' },
  { heading: 'Elsewhere' },
  { href: '/admin', label: 'Admin panel', icon: 'settings', external: true },
  { href: '/', label: 'ATLAS home', icon: 'grid', external: true },
];

// Everyone signs in on the ATLAS home page; it sends administrators back here.
function signedOutView(el, { status }) {
  if (status.deniedUser) {
    return authScreen(el, {}, html`<div class="auth-card"><h2>Control is for administrators</h2>
      <p class="muted">You are signed in as ${status.deniedUser.name} (${roleLabel(status.deniedUser.role)}). ATLAS Control holds access to every system, every account and the audit trail, so only administrators open it. Your systems are on the ATLAS home page.</p>
      <a class="btn primary block" href="/">Back to ATLAS home</a></div>`);
  }
  location.replace(`/?next=${encodeURIComponent('/control/')}`);
}

let counts = null;
const overview = async () => {
  if (!counts || Date.now() - counts.at > 4000) counts = { at: Date.now(), d: await api.get('/api/control/overview') };
  return counts.d;
};

startApp({
  side: 'admin',
  authBase: '/api/control/auth',
  product: 'Control',
  brandLine: 'Control',
  routes,
  nav,
  home: () => '/overview',
  signedOutView,
  badges: {
    locks: async () => (await overview()).locks,
  },
});
