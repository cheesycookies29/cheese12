// ATLAS Tools (/tools/): everyday tools for the school's people, open to the account types an
// administrator chooses (Admin panel → Home page & systems → Tools). PDF Studio is ported from CORE
// ERP: make PDFs from photos, scans and office files, join, reorder, edit, sign and verify them.
// The pages call /api/tools/ (server/tools-pdf.js); signing in happens on the ATLAS home page.
import { startApp, pageHead, ctx } from '../shell.js';
import { systemRoutes, systemNav } from '../system/index.js';
import { html, mount } from '../ui.js';
import { pdfStudioView } from './views/pdf-studio.js';
import { brandHome } from '../brand.js';
import { formsView } from '../forms.js';

const has = (id) => (ctx.info?.tools || []).some((t) => t.id === id);

const routes = [
  ['/pdf', (el, p) => (has('pdf') ? pdfStudioView(el, p) : offView(el))],
  ['/forms', (el) => formsView(el, 'tools')], // Forms & downloads: the files Tools gives its users
  ...systemRoutes(),
];

const nav = () => [
  { heading: 'Tools' },
  { href: '/pdf', label: 'PDF Studio', icon: 'filePdf' },
  // Document circulation (the management screen, System → Document circulation): for those who keep forms.
  has('forms') && { href: '/system/forms', label: 'Document circulation', icon: 'folder' },
  { heading: 'Help' },
  { href: '/forms', label: 'Forms & downloads', icon: 'download' },
  ...systemNav([], { forms: false }),
].filter(Boolean);

function signedOutView() {
  location.replace(`/?next=${encodeURIComponent('/tools/')}`);
}

// A tool an administrator has not switched on for this account type: say so, and where to go.
function offView(el) {
  mount(el, html`${pageHead('PDF Studio')}<div class="card"><h2>Not switched on for your account</h2>
    <p class="muted">An administrator chooses which account types can use each tool (Admin panel → Home page &amp; systems → Tools). Your other systems are on the ${brandHome()} page.</p>
    <a class="btn primary" href="/">Back to ${brandHome()}</a></div>`);
}

startApp({
  side: 'tools',
  authBase: '/api/tools/auth',
  product: 'Tools',
  routes,
  nav,
  home: () => (!has('pdf') && has('forms') ? '/system/forms' : '/pdf'),
  signedOutView,
  passwordView: () => location.replace(`/?next=${encodeURIComponent('/tools/')}`),
});
