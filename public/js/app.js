import { api } from './api.js';
import { ctx, can, mayUseModule, moduleOn, panelAccess, shown } from './state.js';
import { html, mount, toast, today } from './ui.js';
import { icon, iconSvg } from './icons.js';
import { MODULES, SWITCHABLE, TOOLS } from './modules.js';
import { pdfStudioView } from './views/pdf-studio.js';
import { redirectOf } from '/shared/redirects.js';
import { nextInTrap } from './phone.js';
import { avatar, loadAvatars, editMyAvatar } from './avatars.js';
import { moduleAccess, companyRoleOf } from '/shared/profile.js';
import { myProfileView, personView } from './views/profile.js';
import { mountBell, startBell, stopBell, refreshCount, notificationsView } from './notifications.js';
import { dashboardView } from './views/dashboard.js';
import { employeeListView, employeeFormView, employeeProfileView } from './views/employees.js';
import { clockView, dtrView } from './views/time.js';
import { payrollListView, payrollRunView, payslipView } from './views/payroll.js';
import { settingsView, securityView } from './views/settings.js';
import { adminDashboardView } from './views/admin/dashboard.js';
import { rolesView } from './views/admin/roles.js';
import { accessView } from './views/admin/access.js';
import { configView } from './views/admin/config.js';
import { modulesView } from './views/admin/modules.js';
import { dataView, demoView } from './views/admin/data.js';
import { guidesAdminView } from './views/admin/guides.js';
import { monitorView } from './views/admin/monitor.js';
import { usersView } from './views/users.js';
import { meHomeView, meAttendanceView, mePayslipsView, mePayslipView, meProfileView, meRequestsView } from './views/self.js';
import { payrollSetupView } from './views/payroll-setup.js';
import { leaveView } from './views/leave.js';
import { loginView, setupView, forcePasswordView, forceTwoFactorView, openChangePassword } from './views/login.js';
import { securityView as mySecurityView } from './views/security.js';
import { launcherView } from './views/launcher.js';
import { assetsDashboardView, assetListView, assetFormView, assetDetailView, replicationView } from './views/assets.js';
import { inventoryView, inventoryItemView } from './views/inventory.js';
import { allocationsView, activityView, myAssetsView } from './views/allocations.js';
import { reportsView, reportDetailView } from './views/reports.js';
import { devlogView, unseenCount } from './views/devlog.js';
import { feedbackView, feedbackInboxView, feedbackDetailView } from './views/feedback.js';
import { clockLocationsView } from './views/locations.js';
import { approvalsView } from './views/approvals.js';
import { crmOverviewView, pipelineView, dealView, leadsView, leadView, accountsView, accountView, contactsView, contactView, bidsView, bidView, contractsView, contractView, activitiesView, crmSettingsView } from './views/crm.js';
import { holidaysView } from './views/holidays.js';
import { ytdView } from './views/ytd.js';
import { auditView } from './views/audit.js';
import { helpdeskHomeView, ticketQueueView, ticketView, newTicketView, myTicketsView, myTicketView, helpdeskSettingsView } from './views/helpdesk.js';
import { portfolioView, portfolioMilestonesView, projectOverviewView, boardView, listView, timelineView, projectTimeView, taskView, myWorkView, timesheetView, pmSettingsView, myWorkBadge, projectIcon, taskLinkView } from './views/projects.js';
import { automationsView } from './views/pm-automations.js';
import { myFilesView, folderView, sharedDocsView, recentDocsView, receivedDocsView, trashDocsView, searchDocsView, documentView, receivedCount } from './views/documents.js';
import { documentControlView } from './views/admin/documents.js';
import { formsView, formsAdminView } from './views/forms.js';
import { managedModules } from '/shared/forms.js';

// [path, view, permission needed, module]
const routes = [
  ['/launcher', launcherView, 'auth', null],
  // Human Resource Management
  ['/dashboard', dashboardView, 'dashboard', 'hr'],
  ['/employees', employeeListView, 'employees.view', 'hr'],
  ['/employees/new', employeeFormView, 'employees.edit', 'hr'],
  ['/employees/:id/edit', employeeFormView, 'employees.edit', 'hr'],
  ['/employees/:id', employeeProfileView, 'employees.view', 'hr'],
  ['/clock', clockView, 'clock.kiosk', 'hr'],
  ['/dtr', dtrView, 'attendance.view', 'hr'],
  ['/clock-locations', clockLocationsView, 'attendance.location', 'hr'],
  ['/payroll', payrollListView, 'payroll.view', 'hr'],
  ['/payroll/ytd', ytdView, 'payroll.view', 'hr'],
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
  ['/assets/replication', replicationView, 'assets.view', 'assets'],
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
  // Project Management ('projects': pm.view, or a member of a project)
  ['/projects', portfolioView, 'projects', 'projects'],
  ['/t/:key', taskLinkView, 'projects', 'projects'],
  ['/projects/my-work', myWorkView, 'projects', 'projects'],
  ['/projects/milestones', portfolioMilestonesView, 'projects', 'projects'],
  ['/projects/timesheet', timesheetView, 'timesheet', 'projects'],
  ['/projects/settings', pmSettingsView, 'pm.manage', 'projects'],
  ['/projects/:id/board', boardView, 'projects', 'projects'],
  ['/projects/:id/list', listView, 'projects', 'projects'],
  ['/projects/:id/timeline', timelineView, 'projects', 'projects'],
  ['/projects/:id/time', projectTimeView, 'projects', 'projects'],
  ['/projects/:id/automations', automationsView, 'projects', 'projects'],
  ['/projects/:projectId/tasks/:id', taskView, 'projects', 'projects'],
  ['/projects/:id', projectOverviewView, 'projects', 'projects'],
  // Document Management (0.67): everyone signed in has their own files and what is shared with them.
  ['/documents', myFilesView, 'auth', 'documents'],
  ['/documents/folder/:id', folderView, 'auth', 'documents'],
  ['/documents/shared', sharedDocsView, 'auth', 'documents'],
  ['/documents/recent', recentDocsView, 'auth', 'documents'],
  ['/documents/received', receivedDocsView, 'auth', 'documents'],
  ['/documents/trash', trashDocsView, 'auth', 'documents'],
  ['/documents/search', searchDocsView, 'auth', 'documents'],
  ['/documents/doc/:id', documentView, 'auth', 'documents'],
  // Tools (0.64)
  ['/tools/pdf', pdfStudioView, 'auth', 'pdf'],
  // Document circulation (0.70): a module's Forms & downloads, and the screen of those who keep its
  // forms. Shown inside the module that is open, like your own pages.
  ['/forms/:module', formsView, 'auth', 'user'],
  ['/circulation', formsAdminView, 'forms', 'user'],
  ['/circulation/:module', formsAdminView, 'forms', 'user'],
  // Admin panel ('system'): its own sidebar. Each page needs its own permission; 'panel' = any of them.
  ['/admin/dashboard', adminDashboardView, 'panel', 'system'],
  ['/admin/users', usersView, 'users.manage', 'system'],
  ['/admin/roles', rolesView, 'roles.manage', 'system'],
  ['/admin/access', accessView, 'users.manage', 'system'],
  ['/admin/config', configView, 'settings.center', 'system'],
  ['/admin/modules', modulesView, 'modules.config', 'system'],
  ['/admin/settings', settingsView, 'settings.edit', 'system'],
  ['/admin/security', securityView, 'users.manage', 'system'],
  ['/admin/guides', guidesAdminView, 'guides.edit', 'system'],
  ['/admin/documents', documentControlView, 'docs.manage', 'system'],
  ['/admin/circulation', formsAdminView, 'forms.manage', 'system'],
  ['/admin/audit', auditView, 'audit.view', 'system'],
  ['/admin/monitor', monitorView, 'security.monitor', 'system'],
  ['/admin/devlog', devlogView, 'devlog.view', 'system'],
  ['/admin/feedback', feedbackInboxView, 'feedback.view', 'system'],
  ['/admin/feedback/:id', feedbackDetailView, 'feedback.view', 'system'],
  ['/admin/data', dataView, 'data.manage', 'system'],
  ['/admin/demo', demoView, 'data.manage', 'system'],
  // Your own pages ('user'): shown inside whichever module is open.
  ['/feedback', feedbackView, 'auth', 'user'],
  ['/account/security', mySecurityView, 'auth', 'user'],
  ['/notifications', notificationsView, 'auth', 'user'],
  ['/profile', myProfileView, 'auth', 'user'],
  ['/people/:id', personView, 'auth', 'user'],
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
    { href: '/forms/hr', label: 'Forms & downloads', icon: 'download', permission: 'auth' },
    { href: '/circulation/hr', label: 'Document circulation', icon: 'folder', permission: 'forms:hr' },
    { heading: 'My account', permission: 'self' },
    { href: '/me', label: 'My Home', icon: 'home', permission: 'self', exact: true },
    { href: '/me/attendance', label: 'My Attendance', icon: 'calendar', permission: 'self' },
    { href: '/me/requests', label: 'My Requests', icon: 'inbox', permission: 'self' },
    { href: '/me/payslips', label: 'My Payslips', icon: 'receipt', permission: 'self' },
    { href: '/me/profile', label: 'My HR record', icon: 'user', permission: 'self' },
  ],
  assets: [
    { href: '/assets', label: 'Overview', icon: 'dashboard', permission: 'assets.view', exact: true },
    { href: '/assets/list', label: 'Assets', icon: 'laptop', permission: 'assets.view', also: ['/assets/item', '/assets/new'] },
    { href: '/assets/inventory', label: 'Inventory', icon: 'box', permission: 'assets.view' },
    { href: '/assets/reports', label: 'Problem reports', icon: 'alert', permission: 'assets.view', badge: 'reports' },
    { href: '/assets/allocations', label: 'Allocations', icon: 'userPlus', permission: 'assets.view' },
    { href: '/assets/activity', label: 'Activity log', icon: 'activity', permission: 'assets.view' },
    { href: '/assets/replication', label: 'Data replication', icon: 'database', permission: 'assets.view', soon: 'replication' },
    { href: '/forms/assets', label: 'Forms & downloads', icon: 'download', permission: 'auth' },
    { href: '/circulation/assets', label: 'Document circulation', icon: 'folder', permission: 'forms:assets' },
    { heading: 'My account', permission: 'self' },
    { href: '/assets/mine', label: 'My Assets', icon: 'laptop', permission: 'self' },
  ],
  helpdesk: [
    { href: '/helpdesk', label: 'Overview', icon: 'dashboard', permission: 'helpdesk.agent', exact: true },
    { href: '/helpdesk/tickets', label: 'Tickets', icon: 'ticket', permission: 'helpdesk.agent', badge: 'helpdesk' },
    { href: '/helpdesk/new', label: 'Log a ticket', icon: 'plus', permission: 'helpdesk.agent' },
    { href: '/helpdesk/settings', label: 'Service desk settings', icon: 'settings', permission: 'helpdesk.manage' },
    { href: '/forms/helpdesk', label: 'Forms & downloads', icon: 'download', permission: 'auth' },
    { href: '/circulation/helpdesk', label: 'Document circulation', icon: 'folder', permission: 'forms:helpdesk' },
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
    { href: '/forms/crm', label: 'Forms & downloads', icon: 'download', permission: 'crm.view' },
    { href: '/circulation/crm', label: 'Document circulation', icon: 'folder', permission: 'forms:crm' },
  ],
  projects: [
    { href: '/projects', label: 'Overview', icon: 'dashboard', permission: 'projects', also: ['/projects/milestones'] },
    { href: '/projects/my-work', label: 'My work', icon: 'task', permission: 'projects', badge: 'pmWork' },
    { href: '/projects/timesheet', label: 'Timesheet', icon: 'clock', permission: 'timesheet' },
    { href: '/projects/settings', label: 'Projects setup', icon: 'settings', permission: 'pm.manage' },
    { href: '/forms/projects', label: 'Forms & downloads', icon: 'download', permission: 'projects' },
    { href: '/circulation/projects', label: 'Document circulation', icon: 'folder', permission: 'forms:projects' },
    // The projects this person starred (0.51), filled in once the menu is drawn.
    { favorites: true, permission: 'projects' },
  ],
  documents: [
    { href: '/documents', label: 'My files', icon: 'folder', permission: 'auth', also: ['/documents/folder', '/documents/doc'] },
    { href: '/documents/shared', label: 'Shared with me', icon: 'users', permission: 'auth' },
    { href: '/documents/recent', label: 'Recent', icon: 'clock', permission: 'auth' },
    { href: '/documents/received', label: 'Received', icon: 'inbox', permission: 'auth', badge: 'docsReceived' },
    { href: '/documents/trash', label: 'Trash', icon: 'trash', permission: 'auth' },
    { href: '/admin/documents', label: 'Document control', icon: 'shield', permission: 'docs.manage' },
  ],
  // The Admin panel's own sidebar (ported from Lancaster ATLAS). A heading shows when something under it does.
  system: [
    { href: '/admin/dashboard', label: 'Dashboard', icon: 'dashboard', permission: 'panel' },
    { heading: 'People' },
    { href: '/admin/users', label: 'Users & Access', icon: 'users', permission: 'users.manage' },
    { href: '/admin/roles', label: 'Roles & permissions', icon: 'lock', permission: 'roles.manage' },
    { href: '/admin/access', label: 'Access grants', icon: 'key', permission: 'users.manage' },
    { heading: 'Configuration' },
    { href: '/admin/config', label: 'Settings center', icon: 'search', permission: 'settings.center' },
    { href: '/admin/modules', label: 'Modules', icon: 'grid', permission: 'modules.config' },
    { href: '/admin/settings', label: 'Settings & branding', icon: 'toggles', permission: 'settings.edit' },
    { href: '/admin/security', label: 'Sign-in & security', icon: 'shield', permission: 'users.manage' },
    { href: '/admin/guides', label: 'Help & guides', icon: 'help', permission: 'guides.edit' },
    { href: '/admin/documents', label: 'Document control', icon: 'folder', permission: 'docs.manage' },
    { href: '/admin/circulation', label: 'Document circulation', icon: 'download', permission: 'forms.manage' },
    { heading: 'Records' },
    { href: '/admin/monitor', label: 'Security monitor', icon: 'eye', permission: 'security.monitor' },
    { href: '/admin/audit', label: 'Audit log', icon: 'activity', permission: 'audit.view' },
    { href: '/admin/devlog', label: 'Dev log', icon: 'code', permission: 'devlog.view', badge: 'devlog' },
    { href: '/admin/feedback', label: 'Feedback inbox', icon: 'message', permission: 'feedback.view', badge: 'feedback' },
    { heading: 'Data' },
    { href: '/admin/data', label: 'Backup & restore', icon: 'database', permission: 'data.manage' },
    { href: '/admin/demo', label: 'Demo data', icon: 'sparkle', permission: 'data.manage' },
    { heading: 'Elsewhere' },
    { href: '/launcher', label: 'CORE home', icon: 'home', permission: 'auth' },
    { href: '/feedback', label: 'Send feedback', icon: 'comment', permission: 'auth', exact: true },
  ],
  // Tools (0.64): each has its own short menu.
  pdf: [
    { href: '/tools/pdf', label: 'PDF Studio', icon: 'filePdf', permission: 'auth' },
    { href: '/launcher', label: 'CORE home', icon: 'home', permission: 'auth' },
  ],
  // At the end of every module's menu: the way into the Admin panel (for accounts with any admin
  // permission), then Send feedback.
  common: [
    { heading: 'Administration', permission: 'panel' },
    { href: '/admin/dashboard', label: 'Admin panel', icon: 'settings', permission: 'panel', badge: 'admin' },
    { heading: 'Help', permission: 'auth' },
    { href: '/feedback', label: 'Send feedback', icon: 'comment', permission: 'auth', exact: true },
  ],
};


// Self-service pages need a linked employee record. Staff accounts without one
// don't see them; employee accounts always do (and are told to ask for a link).
function allowed(permission) {
  if (permission === 'auth') return true;
  if (permission === 'panel') return panelAccess();
  // Supervisors (even on an Employee account), named approvers and HR see the Approval Center.
  if (permission === 'approver') return Boolean(ctx.user.isApprover);
  if (permission === 'self') return can('self') && (Boolean(ctx.user.employeeId) || ctx.user.role === 'employee');
  // Projects: everyone who sees every project, and the members of any project.
  if (permission === 'projects') return can('pm.view') || Boolean(ctx.user.inProjects);
  // The weekly Timesheet: members of a project that tracks time, and those who manage one.
  if (permission === 'timesheet') return Boolean(ctx.user.timesheet);
  // Document circulation (0.70): 'forms' = keeps the forms of any module; 'forms:hr' = of that one.
  if (permission === 'forms' || permission.startsWith('forms:')) {
    const kept = managedModules(ctx.user.role, can);
    return permission === 'forms' ? kept.length > 0 : kept.includes(permission.slice(6));
  }
  return can(permission);
}

// Where each module opens for this user; null = no access (or the module is turned off for the
// company: then only administrators open it).
// The same rules give the "What you can open" list on a profile (shared/profile.js).
function moduleHome(id) {
  return moduleAccess(ctx.user, { modules: ctx.modules, inProjects: ctx.user.inProjects, isApprover: ctx.user.isApprover }).find((m) => m.id === id)?.home || null;
}

const homeRoute = () => '/launcher';
const liveModules = () => MODULES.filter((m) => m.status === 'live');
const moduleOf = (id) => MODULES.find((m) => m.id === id) || TOOLS.find((t) => t.id === id);
const body = document.body;

let cleanup = null;
const runCleanup = () => {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
};

// ----- Top bar -----
function renderBrandSub() {
  const m = moduleOf(ctx.module);
  const inApp = !body.classList.contains('launcher-mode');
  document.getElementById('brand-sub').textContent = inApp && ctx.module === 'system' ? 'Admin panel' : m && inApp ? m.name : ctx.settings?.companyName || 'Lancaster Technology and Development Corporation';
}

const isDark = () => document.documentElement.dataset.theme === 'dark';
const themeBtn = document.getElementById('theme-btn');
function renderThemeButton() {
  themeBtn.innerHTML = iconSvg(isDark() ? 'sun' : 'moon');
  themeBtn.title = isDark() ? 'Light mode' : 'Dark mode';
  themeBtn.setAttribute('aria-label', themeBtn.title);
}
function toggleTheme() {
  if (isDark()) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = 'dark';
  try {
    localStorage.setItem('core-theme', isDark() ? 'dark' : 'light');
  } catch {}
  renderThemeButton();
  const item = document.getElementById('theme-item');
  if (item) mount(item, themeItem());
}
// On phones the theme button is in the menu under your name (the top bar keeps room for the bell).
const themeItem = () => html`${icon(isDark() ? 'sun' : 'moon')} ${isDark() ? 'Light mode' : 'Dark mode'}`;
themeBtn.addEventListener('click', toggleTheme);
renderThemeButton();

// Help & guides: opens the guide for this person's job in the module they are in (shared/help.js).
themeBtn.insertAdjacentHTML('beforebegin', `<a class="round-btn" id="help-btn" href="/help/" target="_blank" rel="noopener" title="Help & guides" aria-label="Help and guides">${iconSvg('help')}</a>`);
document.getElementById('help-btn').addEventListener('click', (e) => {
  e.currentTarget.href = `/help/?from=${encodeURIComponent(body.classList.contains('launcher-mode') ? 'home' : ctx.module || 'home')}`;
});

// Notifications: the bell, before Help (public/js/notifications.js).
document.getElementById('help-btn').insertAdjacentHTML('beforebegin', '<div class="notif-box" id="notif-box"></div>');
const closeBell = mountBell(document.getElementById('notif-box'), {
  onOpen: () => {
    pops.forEach((close) => close());
    setMenu(false);
  },
});

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
    // Opened from the keyboard (Enter or Space): into the menu, on its first item.
    if (open && e.detail === 0) items()[0]?.focus();
  });
  pop.addEventListener('click', (e) => e.target.closest('a, button') && close());
  // In the menu (0.47): the arrow keys, Home and End move between its items; Escape closes it and
  // goes back to the button that opened it.
  const items = () => [...pop.querySelectorAll('a[role="menuitem"], button[role="menuitem"]')].filter((x) => x.offsetParent !== null);
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      btn.focus();
      return;
    }
    const list = items();
    const at = list.indexOf(document.activeElement);
    const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: list.length - 1 }[e.key];
    if (to === undefined || !list.length) return;
    e.preventDefault();
    list[(to + list.length) % list.length].focus();
  });
  pops.push(close);
}
const pops = [];
const closePops = () => {
  pops.forEach((close) => close());
  closeBell();
};
document.addEventListener('click', (e) => !e.target.closest('.user-menu, .mod-switch') && closePops());

// The grid button: every module at a glance, as compact tiles (0.45). The ones this account opens
// come first (pinned ones leading, as on the CORE home), then locked ones and those coming soon,
// greyed out; C-suite has its gold accent.
function renderModuleSwitch() {
  const box = document.getElementById('mod-switch');
  const live = liveModules().filter((m) => mayUseModule(m.id)).map((m) => ({ ...m, home: moduleHome(m.id) }));
  const pins = (ctx.user?.favoriteModules || []).filter((id) => live.some((m) => m.id === id && m.home));
  const open = [...pins.map((id) => live.find((m) => m.id === id)), ...live.filter((m) => m.home && !pins.includes(m.id))];
  const locked = live.filter((m) => !m.home);
  const soon = MODULES.filter((m) => m.status !== 'live' && shown(m.id));
  const tools = TOOLS.filter((t) => mayUseModule(t.id));
  const tile = (m, kind) => {
    const cls = `mod-tile ${kind}${m.accent ? ` accent-${m.accent}` : ''}`;
    const inner = html`<span class="mod-ic">${icon(m.glyph, 20)}</span><span class="mod-name">${m.short || m.name}</span>${kind === 'soon' ? html`<span class="mod-tag">Soon</span>` : kind === 'locked' ? html`<span class="mod-tag">${icon('lock', 9)} No access</span>` : pins.includes(m.id) ? html`<span class="mod-pin" aria-hidden="true">${icon('star', 10)}</span>` : ''}`;
    if (kind === 'open') return html`<a role="menuitem" class="${cls}" href="#${m.home}" data-mod="${m.id}" title="${m.name}: ${moduleOn(m.id) ? m.tagline : 'off for the company, administrators only'}">${inner}</a>`;
    return html`<span role="menuitem" aria-disabled="true" class="${cls}" title="${m.name}: ${kind === 'soon' ? 'coming soon' : 'no access, ask your administrator'}">${inner}</span>`;
  };
  mount(box, html`
    <button type="button" class="round-btn" id="mod-btn" title="Modules" aria-label="Modules" aria-haspopup="menu" aria-expanded="false">${icon('grid', 18)}</button>
    <div class="menu-pop mod-pop" id="mod-pop" role="menu" hidden>
      <div class="menu-label">CORE modules</div>
      <div class="mod-grid">${open.map((m) => tile(m, 'open'))}${locked.map((m) => tile(m, 'locked'))}${soon.map((m) => tile(m, 'soon'))}</div>
      ${tools.length ? html`<div class="menu-label">Tools</div><div class="mod-grid">${tools.map((t) => html`<a role="menuitem" class="mod-tile open" href="#${t.home}" data-mod="${t.id}" title="${t.name}: ${moduleOn(t.id) ? t.tagline : 'off for the company, administrators only'}"><span class="mod-ic">${icon(t.glyph, 20)}</span><span class="mod-name">${t.short || t.name}</span></a>`)}</div>` : ''}
      ${panelAccess() ? html`<div class="menu-sep"></div><a role="menuitem" class="mod-row" href="#/admin/dashboard" data-mod="system"><span class="mod-ic">${icon('settings', 16)}</span><span class="grow"><strong>Admin panel</strong></span></a>` : ''}
      <a role="menuitem" class="mod-row" href="#/launcher"><span class="mod-ic">${icon('home', 16)}</span><span class="grow"><strong>CORE home</strong></span></a>
    </div>`);
  popover(box, box.querySelector('#mod-btn'), box.querySelector('#mod-pop'));
  markModuleSwitch();
}
function markModuleSwitch() {
  document.querySelectorAll('#mod-pop a[data-mod]').forEach((a) => a.classList.toggle('on', !body.classList.contains('launcher-mode') && a.dataset.mod === ctx.module));
}

function renderUserBox() {
  const u = ctx.user;
  const box = document.getElementById('user-box');
  mount(box, html`
    <button type="button" class="user-btn" id="user-btn" aria-haspopup="menu" aria-expanded="false">
      ${avatar(u.id, u.name)}
      <span class="who-text"><strong>${u.name}</strong><small>${companyRoleOf(u)}</small></span>
      ${icon('chevronDown', 16)}
    </button>
    <div class="menu-pop" id="user-pop" role="menu" hidden>
      <div class="who who-pic">${avatar(u.id, u.name, { size: 'lg' })}<div><strong>${u.name}</strong><small>${companyRoleOf(u)}</small><small>${u.username}</small></div></div>
      <a role="menuitem" href="#/profile">${icon('user')} My profile</a>
      <button type="button" role="menuitem" id="my-picture">${icon('image')} ${ctx.avatars?.[u.id] ? 'Change my picture' : 'Add my picture'}</button>
      <button type="button" role="menuitem" id="theme-item" class="phone-only">${themeItem()}</button>
      <a role="menuitem" href="#/feedback">${icon('comment')} Send feedback</a>
      <a role="menuitem" href="#/account/security">${icon('shield')} My security</a>
      <button type="button" role="menuitem" id="change-pw">${icon('key')} Change password</button>
      <button type="button" role="menuitem" id="sign-out">${icon('logout')} Sign out</button>
    </div>`);
  popover(box, box.querySelector('#user-btn'), box.querySelector('#user-pop'));
  box.querySelector('#change-pw').addEventListener('click', openChangePassword);
  box.querySelector('#theme-item').addEventListener('click', toggleTheme);
  // After a new picture: the top bar, and the page (its lists show the new one).
  box.querySelector('#my-picture').addEventListener('click', () => editMyAvatar(() => {
    renderUserBox();
    navigate();
  }));
  box.querySelector('#sign-out').addEventListener('click', signOut);
}

// ----- Sidebar -----
function renderNav(module, force = false) {
  if (!force && module === ctx.module && document.querySelector('#nav a')) return;
  ctx.module = module;
  const m = moduleOf(module);
  const panel = module === 'system';
  // A heading shows only when something under it does.
  // A coming-soon page (soon: its roadmap id) an administrator hid is left out (0.63).
  const visible = (panel ? NAV.system : [...(NAV[module] || []), ...NAV.common]).filter((n) => allowed(n.permission || 'auth') && (!n.soon || shown(n.soon)));
  const items = visible.filter((n, i) => !n.heading || (visible[i + 1] && !visible[i + 1].heading));
  mount(document.getElementById('nav'), html`
    ${panel ? html`<div class="nav-module" title="Admin panel"><span class="mod-ic">${icon('settings', 18)}</span><span><strong>Admin panel</strong><small>CORE · Administration</small></span></div>` : ''}
    ${m ? html`<div class="nav-module" title="${m.name}"><span class="mod-ic">${icon(m.glyph, 18)}</span><span><strong>${m.name}</strong><small>${m.code}${moduleOn(m.id) ? '' : ' · Off for the company'}</small></span></div>` : ''}
    ${items.map((n) =>
      n.favorites
        ? html`<div id="nav-favs" class="nav-favs"></div>`
        : n.heading
        ? html`<div class="nav-heading">${n.heading}</div>`
        : html`<a href="#${n.href}" title="${n.soon ? `${n.label} (coming soon)` : n.label}" data-href="${n.href}" data-also="${(n.also || []).join(' ')}" ${n.exact ? 'data-exact' : ''}>${icon(n.icon || 'file')}<span class="label">${n.label}</span>${n.soon ? html`<span class="nav-soon">Soon</span>` : ''}${n.badge ? html`<span class="nav-badge" data-badge="${n.badge}" hidden></span>` : ''}</a>`,
    )}`);
  refreshBadge();
  if (document.getElementById('nav-favs')) loadNavFavorites();
}
// Favorite projects in the Projects side menu (0.51), in the order starred, each with its icon.
async function loadNavFavorites(list) {
  const box = document.getElementById('nav-favs');
  if (!box) return;
  let favs = list;
  if (!favs) {
    try {
      favs = (await api.get('/api/pm/favorites')).favorites;
    } catch {
      favs = [];
    }
  }
  if (box !== document.getElementById('nav-favs')) return; // the menu was redrawn meanwhile
  mount(box, favs.length ? html`<div class="nav-heading">Favorites</div>${favs.map((p) => html`<a href="#/projects/${p.id}" class="nav-fav" title="${p.name}" data-href="/projects/${p.id}" data-also="">${projectIcon(p, 'sm')}<span class="label">${p.name}</span></a>`)}` : '');
  markNav();
}
window.addEventListener('pm-favorites:changed', (e) => loadNavFavorites(e.detail?.favorites));
// Highlight the most specific nav link that contains the current path.
function markNav() {
  const path = location.hash.replace(/^#/, '').split('?')[0] || homeRoute();
  const links = [...document.querySelectorAll('#nav a[data-href]')];
  const hits = (a) => {
    const prefixes = [a.dataset.href, ...a.dataset.also.split(' ').filter(Boolean)];
    return prefixes.some((p) => path === p || (!a.hasAttribute('data-exact') && path.startsWith(p + '/')));
  };
  const best = links.filter(hits).sort((a, b) => b.dataset.href.length - a.dataset.href.length)[0];
  links.forEach((a) => a.classList.toggle('active', a === best));
}

// Counts next to menu items: pending leave approvals, new equipment problem reports, unread dev log releases, new feedback.
const BADGES = {
  approvals: () => (ctx.user.isApprover ? api.get('/api/approvals/summary').then((r) => r.pending) : 0),
  reports: () => api.get('/api/asset-reports/summary').then((r) => r.new),
  devlog: () => unseenCount(),
  feedback: () => api.get('/api/feedback/summary').then((r) => r.new),
  // On the "Admin panel" link: new feedback and dev log releases not opened yet.
  admin: () => Promise.all([can('feedback.view') ? BADGES.feedback().catch(() => 0) : 0, can('devlog.view') ? unseenCount().catch(() => 0) : 0]).then(([a, b]) => a + b),
  helpdesk: () => api.get('/api/helpdesk/summary').then((r) => r.awaiting),
  leads: () => api.get('/api/crm/overview').then((r) => r.newLeads),
  crmTasks: () => api.get('/api/crm/activities?mine=1&open=1').then((list) => list.filter((a) => a.dueDate && a.dueDate <= today()).length),
  pmWork: () => myWorkBadge(),
  docsReceived: () => receivedCount(),
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
  // The drawer becomes focusable once it is shown: focus its active link a frame later.
  if (open) requestAnimationFrame(() => requestAnimationFrame(() => body.classList.contains('nav-open') && document.querySelector('#nav a.active, #nav a')?.focus({ preventScroll: true })));
}
// Until someone folds or unfolds it, the sidebar is icons only on a small laptop or a tablet held
// sideways (961–1199px), so the page keeps room for its tables; full on a larger screen (0.47).
const midScreen = matchMedia('(min-width: 961px) and (max-width: 1199px)');
let navChoice = null;
try {
  navChoice = localStorage.getItem('core-nav');
} catch {}
// Folding or unfolding by the menu button (0.70): the sidebar glides to its new width while its words
// fade (styles.css, body.nav-anim); icons only once it has folded. With reduced motion, at once.
const NAV_MS = 240;
let navTimer = 0;
const navFolded = () => body.classList.contains('nav-mini') || body.classList.contains('nav-closing');
function foldNav(mini) {
  clearTimeout(navTimer);
  body.classList.remove('nav-closing', 'nav-opening');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    body.classList.remove('nav-anim');
    body.classList.toggle('nav-mini', mini);
    return;
  }
  body.classList.add('nav-anim');
  if (mini) body.classList.add('nav-closing');
  else {
    body.classList.remove('nav-mini');
    body.classList.add('nav-opening');
  }
  navTimer = setTimeout(() => {
    body.classList.toggle('nav-mini', mini);
    body.classList.remove('nav-anim', 'nav-closing', 'nav-opening');
  }, NAV_MS);
}
const applyNav = () => {
  clearTimeout(navTimer);
  body.classList.remove('nav-anim', 'nav-closing', 'nav-opening');
  body.classList.toggle('nav-mini', navChoice === 'mini' || navChoice === 'full' ? navChoice === 'mini' : midScreen.matches);
  if (!phone()) menuBtn.setAttribute('aria-expanded', String(!body.classList.contains('nav-mini')));
};
applyNav();
midScreen.addEventListener('change', applyNav);
menuBtn.addEventListener('click', () => {
  closePops();
  if (phone()) return setMenu(!body.classList.contains('nav-open'));
  const mini = !navFolded();
  foldNav(mini);
  menuBtn.setAttribute('aria-expanded', String(!mini));
  navChoice = mini ? 'mini' : 'full';
  try {
    localStorage.setItem('core-nav', navChoice);
  } catch {}
});
scrim.addEventListener('click', () => setMenu(false));
document.getElementById('sidebar').addEventListener('click', (e) => {
  if (e.target.closest('a[href]')) setMenu(false);
});
// While the drawer is open on a phone, Tab stays in it (and on the menu button that closes it).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !body.classList.contains('nav-open') || document.querySelector('.modal-backdrop')) return;
  const items = [menuBtn, ...document.querySelectorAll('#sidebar a[href], #sidebar button')].filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  // Always moved by hand: the menu button is not next to the drawer's links in the page, so the
  // browser's own Tab order would leave the drawer from it.
  e.preventDefault();
  items[nextInTrap(items.indexOf(document.activeElement), items.length, e.shiftKey)].focus();
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
  const search = location.hash.split('?')[1] || '';
  // A page that moved (e.g. #/settings to the Admin panel): open it where it is now.
  const moved = redirectOf(path);
  if (moved) return location.replace(`#${moved}${search ? `?${search}` : ''}`);
  const query = Object.fromEntries(new URLSearchParams(search));
  const match = routes.find((r) => r.re.test(path));
  if (!match) return (location.hash = `#${homeRoute()}`);
  // A module the company turned off: only administrators open it.
  if (SWITCHABLE.includes(match.module) && !mayUseModule(match.module)) {
    toast(`${moduleOf(match.module).name} is turned off for the company.`, 'error');
    return (location.hash = `#${homeRoute()}`);
  }
  if (!allowed(match.permission)) {
    // A link or bookmark to a page this account may not open: stay in the module when possible.
    const home = match.module === 'system' ? (panelAccess() ? '/admin/dashboard' : null) : match.module && match.module !== 'user' && moduleHome(match.module);
    // Said even when the way back is CORE home (an inbox link for someone without the Admin panel).
    if (home !== path) toast('Your account type cannot open that page.', 'error');
    return (location.hash = `#${home && home !== path ? home : homeRoute()}`);
  }

  const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(path.match(match.re)[i + 1])]));
  // The launcher has no sidebar; the Admin panel has its own; your own pages (feedback, security)
  // keep the menu of the module they were opened from.
  body.classList.toggle('launcher-mode', !match.module);
  const firstModule = () => ['hr', 'assets', 'crm', 'projects', 'helpdesk'].find((m) => moduleHome(m)) || (panelAccess() ? 'system' : 'helpdesk');
  if (match.module) renderNav(match.module === 'user' ? (ctx.module && ctx.module !== 'user' ? ctx.module : firstModule()) : match.module);
  renderBrandSub();
  markModuleSwitch();
  markNav();

  runCleanup();
  refreshBadge();
  refreshCount();
  // A fresh container per page, so listeners a view attached to it can't fire on the next page.
  const old = document.getElementById('app');
  const el = old.cloneNode(false);
  old.replaceWith(el);
  window.scrollTo(0, 0);
  try {
    cleanup = await match.view(el, params, query);
  } catch (err) {
    // A deleted record or an old link: a way back into the module, not out of CORE.
    const home = (match.module === 'system' ? '/admin/dashboard' : match.module && moduleHome(match.module === 'user' ? ctx.module : match.module)) || homeRoute();
    if (err.status === 404) mount(el, html`<div class="card empty">${icon('flag', 40)}<h2>${err.message}</h2><p>It may have been deleted, or the link is out of date.</p><p><a class="btn" href="#${home}">Back to the module</a></p></div>`);
    if (err.status !== 404) mount(el, html`<div class="card empty">${icon('flag', 40)}<h2>Something went wrong</h2><p>${err.message}</p><p class="muted">Is the server still running? Check the window it was started from.</p></div>`);
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
  // The branding (sign-in page too), the company's changes to the account types, the modules that are on.
  ctx.applyStatus(status);
  if (!ctx.user) return showAuth(status.setupRequired ? setupView : loginView);
  if (ctx.user.mustChangePassword) return showAuth(forcePasswordView);
  if (ctx.user.twoFactorSetupRequired) return showAuth(forceTwoFactorView);

  await Promise.all([ctx.refreshSettings(), mayUseModule('hr') ? ctx.refreshLeaveTypes() : (ctx.leaveTypes = []), ctx.refreshHolidays(), loadAvatars()]);
  setMode(null);
  mount(document.getElementById('auth'), '');
  ctx.module = null;
  pops.length = 0;
  renderUserBox();
  renderModuleSwitch();
  startBell();
  // Just signed in: the CORE home, unless they came by a task's link (/t/LEA-12), which opens it.
  if ((fresh && !/^#\/t\/[A-Za-z0-9-]+$/.test(location.hash)) || !location.hash || location.hash === '#/') location.hash = `#${homeRoute()}`;
  navigate();
}

async function signOut() {
  await api.post('/api/auth/logout').catch(() => {});
  ctx.user = null;
  stopBell();
  history.replaceState(null, '', location.pathname);
  boot();
}
ctx.signOut = signOut;
ctx.moduleHome = moduleHome;
ctx.changePassword = openChangePassword;

// A dialog belongs to the page it was opened on: changing page closes it.
window.addEventListener('hashchange', () => document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove()));
window.addEventListener('hashchange', navigate);
window.addEventListener('requests:changed', refreshBadge);
window.addEventListener('reports:changed', refreshBadge);
window.addEventListener('devlog:seen', refreshBadge);
window.addEventListener('feedback:changed', refreshBadge);
window.addEventListener('helpdesk:changed', refreshBadge);
window.addEventListener('crm:changed', refreshBadge);
window.addEventListener('pm:changed', refreshBadge);
window.addEventListener('documents:changed', refreshBadge);
// The bell: read there, My work's badge follows; something done here may change its count.
window.addEventListener('notifications:changed', refreshBadge);
for (const ev of ['requests:changed', 'reports:changed', 'feedback:changed', 'helpdesk:changed', 'crm:changed', 'pm:changed']) window.addEventListener(ev, () => refreshCount());
// A new picture or role in the company (from the profile page): the top bar shows it.
window.addEventListener('avatar:changed', () => {
  if (!ctx.user) return;
  pops.length = 0;
  renderUserBox();
});
// A module turned on or off, or roles changed, here: the menus follow at once.
window.addEventListener('modules:changed', () => {
  if (!ctx.user) return;
  pops.length = 0;
  renderModuleSwitch();
  renderUserBox();
  if (ctx.module) renderNav(ctx.module, true);
  markModuleSwitch();
  const links = [...document.querySelectorAll('#nav a[data-href]')];
  const path = location.hash.replace(/^#/, '').split('?')[0];
  links.forEach((a) => a.classList.toggle('active', a.dataset.href === path));
});
window.addEventListener('auth:expired', () => {
  if (!ctx.user) return;
  ctx.user = null;
  stopBell();
  toast('Your session has ended. Please sign in again.', 'error');
  boot();
});
boot();
