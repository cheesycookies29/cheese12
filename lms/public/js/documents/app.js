// ATLAS Documents (/documents/): everyone's files and the school's documents, for every employee
// and student (parents and guardians do not use it). My files, School folders, Shared with me,
// Recent, Received (files sent through upload links), My links, Trash, search; each document with
// its versions, check-out, sharing and activity. Holders of docs.manage also find Document control
// here (the same page as in the Admin panel). The server enforces every rule; the pages only show
// what the person may do.
import { startApp, authScreen, ctx } from '../shell.js';
import { html } from '../ui.js';
import { api } from '../api.js';
import { docs, isStudent, isManager } from './state.js';
import { folderView, schoolFoldersView, listView, linksView } from './views/files.js';
import { documentView } from './views/document.js';
import { documentControlView } from '../admin/views/documents.js';

const staff = () => !isStudent();
const routes = [
  ['/files', (el) => folderView(el, {})],
  ['/folder/:id', folderView],
  ['/folders', schoolFoldersView],
  ['/shared', (el) => listView(el, 'shared')],
  ['/recent', (el) => listView(el, 'recent')],
  ['/received', (el) => listView(el, 'received'), staff],
  ['/links', linksView, staff],
  ['/trash', (el) => listView(el, 'trash')],
  ['/search', (el, p, q) => listView(el, 'search', q)],
  ['/doc/:id', documentView],
  ['/control', (el, p, q) => documentControlView(el, p, q, { base: '#/control' }), () => isManager()],
];

function nav() {
  return [
    { heading: 'Documents' },
    { href: '/files', label: 'My files', icon: 'folder' },
    { href: '/folders', label: 'School folders', icon: 'building' },
    { href: '/shared', label: 'Shared with me', icon: 'users' },
    { href: '/recent', label: 'Recent', icon: 'clock' },
    staff() && { href: '/received', label: 'Received', icon: 'inbox', badge: 'received' },
    staff() && { href: '/links', label: 'My links', icon: 'link' },
    { href: '/trash', label: 'Trash', icon: 'trash' },
    isManager() && { heading: 'Administration' },
    isManager() && { href: '/control', label: 'Document control', icon: 'shield' },
  ].filter(Boolean);
}

function signedOutView(el, { status }) {
  if (status.deniedUser) {
    return authScreen(el, {}, html`<div class="auth-card"><h2>Documents is for the school</h2>
      <p class="muted">You are signed in as ${status.deniedUser.name}. ATLAS Documents is for the school's employees and students. Your systems are on the ATLAS home page.</p>
      <a class="btn primary block" href="/">Back to ATLAS home</a></div>`);
  }
  location.replace(`/?next=${encodeURIComponent('/documents/')}`);
}

startApp({
  side: 'documents',
  authBase: '/api/docs/auth',
  product: 'Documents',
  routes,
  nav,
  home: () => '/files',
  signedOutView,
  passwordView: () => location.replace(`/?next=${encodeURIComponent('/documents/')}`),
  async onSignedIn() {
    await docs.refresh();
  },
  badges: {
    received: async () => (staff() ? (await api.get('/api/docs/list?view=received')).documents.length : 0),
  },
});
export { ctx };
