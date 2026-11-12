// The System group, as in CORE ERP: Users & Access and the Audit log, shown to administrators in the
// sidebar of whichever ATLAS system is open (the Admin panel, People, Academic and Finance). Each app
// adds these routes and sidebar items; the pages call /api/system/ (server/system.js).
import { ctx } from '../shell.js';
import { usersView } from './users.js';
import { auditView } from './audit.js';

export { usersView, auditView };
const isAdmin = () => ctx.user?.role === 'admin';

export const systemRoutes = () => [
  ['/system/users', usersView, isAdmin],
  ['/system/audit', auditView, isAdmin],
];

// extra: more System items for this app (the Admin panel adds its access settings).
export const systemNav = (extra = []) => (isAdmin() ? [
  { heading: 'System' },
  { href: '/system/users', label: 'Users & Access', icon: 'shield' },
  ...extra,
  { href: '/system/audit', label: 'Audit log', icon: 'search' },
] : []);
