// The System group, as in CORE ERP: Users & Access, Document circulation, the Audit log and the Security monitor, shown to administrators in the
// sidebar of whichever ATLAS system is open (the Admin panel, People, Academic and Finance). Each app
// adds these routes and sidebar items; the pages call /api/system/ (server/system.js) and /api/forms/
// (server/forms.js). The people who keep a module's forms (the registrar, HR, the accountant, by
// default) see System → Document circulation alone.
import { ctx } from '../shell.js';
import { usersView } from './users.js';
import { auditView } from './audit.js';
import { monitorView } from './monitor.js';
import { formsAdminView } from './forms.js';

export { usersView, auditView, monitorView, formsAdminView };
const isAdmin = () => ctx.user?.role === 'admin';
// The modules whose forms this account keeps (the server sends them with the account).
export const keepsForms = () => isAdmin() || (ctx.user?.manageForms || []).length > 0;

export const systemRoutes = () => [
  ['/system/users', usersView, isAdmin],
  ['/system/forms', formsAdminView, keepsForms],
  ['/system/audit', auditView, isAdmin],
  ['/system/monitor', monitorView, isAdmin],
];

// extra: more System items for this app (the Admin panel adds its access settings).
// forms: false leaves Document circulation out (ATLAS Tools lists it beside PDF Studio instead).
const formsItem = { href: '/system/forms', label: 'Document circulation', icon: 'folder' };
export const systemNav = (extra = [], { forms = true } = {}) => {
  if (!isAdmin()) return forms && keepsForms() ? [{ heading: 'System' }, formsItem] : [];
  return [
    { heading: 'System' },
    { href: '/system/users', label: 'Users & Access', icon: 'shield' },
    forms && formsItem,
    ...extra,
    { href: '/system/audit', label: 'Audit log', icon: 'search' },
    { href: '/system/monitor', label: 'Security monitor', icon: 'chart' },
  ].filter(Boolean);
};
