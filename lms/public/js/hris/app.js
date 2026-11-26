// ATLAS People, the HRIS (/hris/): employee self-service for everyone with an employee record, and the
// HR screens (employees, attendance, leave, payroll) for HR managers, payroll officers
// and administrators. Screens and rules come from the Lancaster ERP's HR & Payroll module.
// Recruitment: HR posts job openings; employees and job applicants (people outside the school, with a
// temporary account) apply. An applicant sees only Job openings, My applications and their account.
import { startApp, authScreen } from '../shell.js';
import { systemRoutes, systemNav } from '../system/index.js';
import { html } from '../ui.js';
import { hr, can, isEmployee, isApplicant } from './state.js';
import { ctx } from '../shell.js';
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
import { brandHome } from '../brand.js';
import { jobsView, jobView, myApplicationsView, applicationView } from './views/jobs.js';
import { openingsView, openingFormView, openingView, applicantsView } from './views/recruitment.js';
import { ratingView, comparativeView, profileView, poolView } from './views/assess.js';
import { ratingsToDoView, boardOpeningView } from './views/board.js';
import { documentsReviewView } from './views/documents.js';
import { plantillaListView, plantillaItemView, plantillaFormView, psipopView } from './views/plantilla.js';
import { appointView, paperView, myPaperView } from './views/appointment.js';
import { myWorkExperienceView, workExperienceSheetView } from './work-experience.js';
import { formsView } from '../forms.js';
import { dueDatesView } from './views/due-dates.js';

const perm = (p) => () => can(p);
const emp = () => isEmployee();
// Job openings: employees (self-service) and job applicants.
const seeker = () => isEmployee() || isApplicant();
const staffOnly = (check) => () => !isApplicant() && check();
// Named on a selection board (PL-021): Ratings to do, for any staff account HR names.
const assessor = () => !isApplicant() && Boolean(ctx.info?.assessor);
// The plantilla register: HR (hris.plantilla) keeps it; anyone who views employee records reads it.
const plantilla = () => can('hris.plantilla') || can('employees.view');

const routes = [
  ['/dashboard', dashboardView, perm('hris.dashboard')],
  ['/employees', employeeListView, perm('employees.view')],
  ['/employees/new', (el) => employeeFormView(el, {}), perm('employees.edit')],
  ['/employees/:id', employeeProfileView, perm('employees.view')],
  ['/employees/:id/edit', employeeFormView, perm('employees.edit')],
  ['/employees/:id/sheet', (el, { id }) => workExperienceSheetView(el, { url: `/api/hris/employees/${id}/work-experience/sheet`, back: [['/employees', 'Employees'], [`/employees/${id}`, 'Employee record']], edit: `/employees/${id}` }), perm('employees.view')],
  ['/due-dates', dueDatesView, perm('hris.due')],
  ['/plantilla', plantillaListView, plantilla],
  ['/plantilla/new', (el) => plantillaFormView(el, {}), perm('hris.plantilla')],
  ['/plantilla/psipop', psipopView, plantilla],
  ['/plantilla/:id', plantillaItemView, plantilla],
  ['/plantilla/:id/edit', plantillaFormView, perm('hris.plantilla')],
  ['/dtr', dtrView, perm('attendance.view')],
  ['/clock', clockView, perm('clock.kiosk')],
  ['/clock-locations', clockLocationsView, perm('attendance.location')],
  ['/leave', leaveView, perm('leave.manage')],
  ['/payroll', payrollListView, perm('payroll.view')],
  ['/payroll/:id', payrollRunView, perm('payroll.view')],
  ['/payroll/:id/payslip/:employeeId', payslipView, perm('payroll.view')],
  ['/payroll-setup', payrollSetupView, perm('payroll.config')],
  ['/settings', hrSettingsView, perm('hris.settings')],
  ['/recruitment', openingsView, perm('hris.recruitment')],
  ['/recruitment/new', (el, _params, query) => openingFormView(el, {}, query), perm('hris.recruitment')],
  ['/recruitment/applicants', applicantsView, perm('hris.recruitment')],
  ['/recruitment/pool', poolView, perm('hris.recruitment')],
  ['/recruitment/profile/:userId', profileView, perm('hris.recruitment')],
  ['/recruitment/:id', openingView, perm('hris.recruitment')],
  ['/recruitment/:id/edit', openingFormView, perm('hris.recruitment')],
  ['/recruitment/:id/comparative', comparativeView, perm('hris.recruitment')],
  ['/recruitment/:id/rate/:appId', ratingView, perm('hris.recruitment')],
  ['/recruitment/:id/documents/:appId', documentsReviewView, perm('hris.recruitment')],
  ['/recruitment/:id/appoint/:appId', appointView, () => can('hris.recruitment') && can('hris.appoint')],
  ['/recruitment/:id/wes/:appId', (el, { id, appId }) => workExperienceSheetView(el, { url: `/api/hris/recruitment/applications/${appId}/work-experience/sheet`, back: [['/recruitment', 'Job openings'], [`/recruitment/${id}`, 'The opening']] }), perm('hris.recruitment')],
  ['/recruitment/profile/:userId/wes', (el, { userId }) => workExperienceSheetView(el, { url: `/api/hris/recruitment/people/${userId}/work-experience/sheet`, back: [['/recruitment/applicants', 'Applicant accounts'], [`/recruitment/profile/${userId}`, 'Applicant profile']], edit: `/recruitment/profile/${userId}` }), perm('hris.recruitment')],
  ['/appointments/:apptId/paper/:paperId', paperView, () => can('hris.recruitment') && can('hris.appoint')],
  ['/assess', ratingsToDoView, assessor],
  ['/assess/:id', boardOpeningView, () => assessor() || can('hris.recruitment')],
  ['/assess/:id/rate/:appId', (el, params, query) => ratingView(el, params, query, { board: true }), () => assessor() || can('hris.recruitment')],
  ['/assess/:id/documents/:appId', (el, params, query) => documentsReviewView(el, params, query, { board: true }), () => assessor() || can('hris.recruitment')],
  ['/jobs', jobsView, seeker],
  ['/jobs/mine', myApplicationsView, seeker],
  ['/jobs/mine/:id', applicationView, seeker],
  ['/jobs/experience', myWorkExperienceView, isApplicant],
  ['/jobs/experience/sheet', (el) => workExperienceSheetView(el, { url: '/api/hris/me/work-experience/sheet', back: [['/jobs/experience', 'My work experience']], edit: '/jobs/experience' }), isApplicant],
  ['/jobs/:id', jobView, seeker],
  ['/me', meHomeView, emp],
  ['/me/attendance', meAttendanceView, emp],
  ['/me/requests', meRequestsView, emp],
  ['/me/payslips', mePayslipsView, emp],
  ['/me/payslips/:runId', mePayslipView, emp],
  ['/me/profile', meProfileView, emp],
  ['/me/profile/sheet', (el) => workExperienceSheetView(el, { url: '/api/hris/me/work-experience/sheet', back: [['/me/profile', 'My HR record']], edit: '/me/profile' }), emp],
  ['/me/papers/:paperId', myPaperView, emp],
  ['/not-linked', notLinkedView, staffOnly(() => !isEmployee())],
  ['/forms', (el) => formsView(el, 'hris')], // Forms & downloads (Document circulation)
  ...systemRoutes(),
];

function nav() {
  // A job applicant: the jobs area only (and their own account, in the menu under their name).
  if (isApplicant()) {
    return [
      { heading: 'Jobs' },
      { href: '/jobs', label: 'Job openings', icon: 'briefcase' },
      { href: '/jobs/mine', label: 'My applications', icon: 'inbox' },
      { href: '/jobs/experience', label: 'My work experience', icon: 'layers' },
    ];
  }
  const hrScreens = ['hris.dashboard', 'employees.view', 'hris.due', 'hris.plantilla', 'attendance.view', 'clock.kiosk', 'leave.manage', 'payroll.view'].some(can);
  return [
    isEmployee() && { heading: 'Me' },
    isEmployee() && { href: '/me', label: 'My day', icon: 'clock', exact: true },
    isEmployee() && { href: '/me/attendance', label: 'My attendance', icon: 'calendar' },
    isEmployee() && { href: '/me/requests', label: 'Leave & requests', icon: 'inbox' },
    isEmployee() && { href: '/me/payslips', label: 'My payslips', icon: 'wallet' },
    isEmployee() && { href: '/me/profile', label: 'My HR record', icon: 'user' },
    isEmployee() && { href: '/jobs', label: 'Job openings', icon: 'briefcase' },
    { href: '/forms', label: 'Forms & downloads', icon: 'download' },
    !isEmployee() && !hrScreens && !assessor() && { href: '/not-linked', label: 'Getting started', icon: 'flag' },
    hrScreens && { heading: 'Human resources' },
    can('hris.dashboard') && { href: '/dashboard', label: 'HR dashboard', icon: 'chart' },
    can('employees.view') && { href: '/employees', label: 'Employees', icon: 'users' },
    can('hris.due') && { href: '/due-dates', label: 'Due dates', icon: 'bell', badge: 'due' },
    plantilla() && { href: '/plantilla', label: 'Plantilla', icon: 'layers' },
    can('attendance.view') && { href: '/dtr', label: 'Attendance (DTR)', icon: 'clock' },
    can('clock.kiosk') && { href: '/clock', label: 'Time clock', icon: 'grid' },
    can('attendance.location') && { href: '/clock-locations', label: 'Clock-in locations', icon: 'mapPin' },
    can('leave.manage') && { href: '/leave', label: 'Leave & approvals', icon: 'clipboard', badge: 'requests' },
    can('payroll.view') && { href: '/payroll', label: 'Payroll', icon: 'wallet' },
    can('hris.recruitment') && { heading: 'Recruitment' },
    can('hris.recruitment') && { href: '/recruitment', label: 'Job openings', icon: 'briefcase' },
    can('hris.recruitment') && { href: '/recruitment/applicants', label: 'Applicant accounts', icon: 'users' },
    can('hris.recruitment') && { href: '/recruitment/pool', label: 'Pool of applicants', icon: 'layers' },
    assessor() && { heading: 'Selection board' },
    assessor() && { href: '/assess', label: 'Ratings to do', icon: 'clipboard', badge: 'ratings' },
    (can('payroll.config') || can('hris.settings')) && { heading: 'Setup' },
    can('payroll.config') && { href: '/payroll-setup', label: 'Payroll setup', icon: 'settings' },
    can('hris.settings') && { href: '/settings', label: 'HR settings', icon: 'building' },
    ...systemNav(),
  ].filter(Boolean);
}

const home = () => (isApplicant() ? '/jobs' : can('hris.dashboard') ? '/dashboard' : isEmployee() ? '/me' : can('employees.view') ? '/employees' : assessor() ? '/assess' : '/not-linked');

// Everyone signs in once, on the University Portal (/); it sends them back here.
// Students have no HRIS: say so instead.
function signedOutView(el, { status }) {
  if (status.deniedUser) {
    return authScreen(el, {}, html`<div class="auth-card"><h2>People is for school employees</h2>
      <p class="muted">You are signed in as ${status.deniedUser.name}, a ${status.deniedUser.role === 'guardian' ? 'parent or guardian' : 'student'} account. Your systems are on the ${brandHome()} page.</p>
      <a class="btn primary block" href="/">Back to ${brandHome()}</a></div>`);
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
    if (isApplicant()) return; // the jobs area needs neither
    await Promise.all([hr.refreshSettings(), hr.refreshLeaveTypes()]);
  },
  badges: {
    // Only for those who can act on them (as in the ERP): approvers, not everyone who can see leave.
    requests: async () => (can('leave.approve') ? (await api.get('/api/hris/requests/summary')).pending : 0),
    // Due dates: overdue and due in the next 30 days at their campuses (PL-053).
    due: async () => (can('hris.due') ? (await api.get('/api/hris/due-dates/summary')).soon : 0),
    // Applicants still to rate on the boards this person is on.
    ratings: async () => (assessor() ? (await api.get('/api/hris/assess')).openings.filter((o) => o.status !== 'closed').reduce((n, o) => n + o.toDo, 0) : 0),
  },
});
