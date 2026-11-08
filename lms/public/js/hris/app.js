// ATLAS People, the HRIS (/hris/): employee self-service for everyone with an employee record, and the
// HR screens (employees, attendance, leave, payroll) for HR managers, payroll officers
// and administrators. Screens and rules come from the Lancaster ERP's HR & Payroll module.
import { startApp, authScreen, authLogo } from '../shell.js';
import { html } from '../ui.js';
import { hr, can, isEmployee } from './state.js';
import { api } from '../api.js';
import { dashboardView } from './views/dashboard.js';
import { employeeListView, employeeFormView, employeeProfileView } from './views/employees.js';
import { dtrView } from './views/time.js';
import { clockView, clockLocationsView } from './views/clock.js';
import { leaveView } from './views/leave.js';
import { payrollListView, payrollRunView, payslipView } from './views/payroll.js';
import { payrollSetupView } from './views/payroll-setup.js';
import { hrSettingsView } from './views/settings.js';
import { meHomeView, meAttendanceView, meRequestsView, mePayslipsView, mePayslipView, meProfileView, notLinkedView } from './views/self.js';

const perm = (p) => () => can(p);
const emp = () => isEmployee();

const routes = [
  ['/dashboard', dashboardView, perm('hris.dashboard')],
  ['/employees', employeeListView, perm('employees.view')],
  ['/employees/new', (el) => employeeFormView(el, {}), perm('employees.edit')],
  ['/employees/:id', employeeProfileView, perm('employees.view')],
  ['/employees/:id/edit', employeeFormView, perm('employees.edit')],
  ['/dtr', dtrView, perm('attendance.view')],
  ['/clock', clockView, perm('clock.kiosk')],
  ['/clock-locations', clockLocationsView, perm('attendance.location')],
  ['/leave', leaveView, perm('leave.manage')],
  ['/payroll', payrollListView, perm('payroll.view')],
  ['/payroll/:id', payrollRunView, perm('payroll.view')],
  ['/payroll/:id/payslip/:employeeId', payslipView, perm('payroll.view')],
  ['/payroll-setup', payrollSetupView, perm('payroll.config')],
  ['/settings', hrSettingsView, perm('hris.settings')],
  ['/me', meHomeView, emp],
  ['/me/attendance', meAttendanceView, emp],
  ['/me/requests', meRequestsView, emp],
  ['/me/payslips', mePayslipsView, emp],
  ['/me/payslips/:runId', mePayslipView, emp],
  ['/me/profile', meProfileView, emp],
  ['/not-linked', notLinkedView, () => !isEmployee()],
];

function nav() {
  const hrScreens = ['hris.dashboard', 'employees.view', 'attendance.view', 'clock.kiosk', 'leave.manage', 'payroll.view'].some(can);
  return [
    isEmployee() && { heading: 'Me' },
    isEmployee() && { href: '/me', label: 'My day', icon: 'clock', exact: true },
    isEmployee() && { href: '/me/attendance', label: 'My attendance', icon: 'calendar' },
    isEmployee() && { href: '/me/requests', label: 'Leave & requests', icon: 'inbox' },
    isEmployee() && { href: '/me/payslips', label: 'My payslips', icon: 'wallet' },
    isEmployee() && { href: '/me/profile', label: 'My profile', icon: 'user' },
    !isEmployee() && !hrScreens && { href: '/not-linked', label: 'Getting started', icon: 'flag' },
    hrScreens && { heading: 'Human resources' },
    can('hris.dashboard') && { href: '/dashboard', label: 'HR dashboard', icon: 'chart' },
    can('employees.view') && { href: '/employees', label: 'Employees', icon: 'users' },
    can('attendance.view') && { href: '/dtr', label: 'Attendance (DTR)', icon: 'clock' },
    can('clock.kiosk') && { href: '/clock', label: 'Time clock', icon: 'grid' },
    can('attendance.location') && { href: '/clock-locations', label: 'Clock-in locations', icon: 'mapPin' },
    can('leave.manage') && { href: '/leave', label: 'Leave & approvals', icon: 'clipboard', badge: 'requests' },
    can('payroll.view') && { href: '/payroll', label: 'Payroll', icon: 'wallet' },
    (can('payroll.config') || can('hris.settings')) && { heading: 'Setup' },
    can('payroll.config') && { href: '/payroll-setup', label: 'Payroll setup', icon: 'settings' },
    can('hris.settings') && { href: '/settings', label: 'HR settings', icon: 'building' },
  ].filter(Boolean);
}

const home = () => (can('hris.dashboard') ? '/dashboard' : isEmployee() ? '/me' : can('employees.view') ? '/employees' : '/not-linked');

// Everyone signs in once, on the University Portal (/); it sends them back here.
// Students have no HRIS: say so instead.
function signedOutView(el, { status }) {
  if (status.deniedUser) {
    return authScreen(el, {}, html`<div class="auth-card">${authLogo()}<h2>People is for school employees</h2>
      <p class="muted">You are signed in as ${status.deniedUser.name}, a student account. Your systems are on the ATLAS home page.</p>
      <a class="btn primary block" href="/">Back to ATLAS home</a></div>`);
  }
  location.replace(`/?next=${encodeURIComponent('/hris/')}`);
}

startApp({
  side: 'hris',
  authBase: '/api/hris/auth',
  product: 'People',
  routes,
  nav,
  home,
  signedOutView,
  // A password set by someone else is replaced on the University Portal, which then comes back here.
  passwordView: () => location.replace(`/?next=${encodeURIComponent('/hris/')}`),
  async onSignedIn() {
    await Promise.all([hr.refreshSettings(), hr.refreshLeaveTypes()]);
  },
  badges: {
    // Only for those who can act on them (as in the ERP): approvers, not everyone who can see leave.
    requests: async () => (can('leave.approve') ? (await api.get('/api/hris/requests/summary')).pending : 0),
  },
});
