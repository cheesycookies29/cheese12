// Admin panel (/admin): Administrators and Registrars.
import { api } from '../api.js';
import { html, toast } from '../ui.js';
import { ctx, startApp, authScreen, passwordField, onFormSubmit, authLogo } from '../shell.js';
import { can } from '/shared/roles.js';
import { dashboardView } from './views/dashboard.js';
import { enrollmentQueueView } from './views/enrollment.js';
import { peopleView, personView } from './views/people.js';
import { coursesView, programsView, termsView } from './views/catalog.js';
import { sectionsView, sectionView } from './views/sections.js';
import { modulesView } from './views/modules.js';
import { settingsView, dataView, gradingView } from './views/settings.js';
import { newsAdminView } from './views/news.js';
import { systemsView } from './views/systems.js';
import { campusesView } from './views/campuses.js';
import { guardiansView, guardianView } from './views/guardians.js';

const p = (permission) => (user) => can(user.role, permission);

const routes = [
  ['/dashboard', dashboardView, p('dashboard')],
  ['/enrollment', enrollmentQueueView, p('enrollment.manage')],
  ['/students', (el, params, q) => peopleView(el, { kind: 'student' }, q), p('students.manage')],
  ['/applicants', (el, params, q) => peopleView(el, { kind: 'applicant' }, q), p('students.manage')],
  ['/teachers', (el, params, q) => peopleView(el, { kind: 'teacher' }, q), p('teachers.view')],
  ['/staff', (el, params, q) => peopleView(el, { kind: 'staff' }, q), p('admins.manage')],
  ['/guardians', guardiansView, p('guardians.manage')],
  ['/guardians/:id', guardianView, p('guardians.manage')],
  ['/people/:id', personView, (u) => can(u.role, 'students.manage') || can(u.role, 'teachers.view')],
  ['/courses', coursesView, p('dashboard')],
  ['/sections', sectionsView, p('dashboard')],
  ['/sections/:id', sectionView, p('dashboard')],
  ['/terms', termsView, p('dashboard')],
  ['/programs', programsView, p('dashboard')],
  ['/modules', modulesView, p('dashboard')],
  ['/settings', settingsView, p('dashboard')],
  ['/grading', gradingView, p('dashboard')],
  ['/news', newsAdminView, p('news.manage')],
  ['/systems', systemsView, p('dashboard')],
  ['/campuses', campusesView, p('dashboard')],
  ['/data', dataView, p('data.manage')],
];

function nav() {
  const c = (perm) => can(ctx.user.role, perm);
  return [
    { href: '/dashboard', label: 'Dashboard', icon: 'home' },
    { heading: 'Enrollment' },
    c('enrollment.manage') && { href: '/enrollment', label: 'Enrollment requests', icon: 'clipboard', badge: 'enrollment' },
    c('students.manage') && { href: '/applicants', label: 'Applicants', icon: 'userPlus', badge: 'applicants' },
    c('students.manage') && { href: '/students', label: 'Students', icon: 'cap', also: ['/people'] },
    c('guardians.manage') && { href: '/guardians', label: 'Parents & guardians', icon: 'user' },
    c('teachers.view') && { href: '/teachers', label: 'Teachers', icon: 'users' },
    { heading: 'Catalog' },
    { href: '/sections', label: 'Sections', icon: 'layers' },
    { href: '/courses', label: 'Courses', icon: 'book' },
    { href: '/terms', label: 'Terms', icon: 'calendar' },
    { href: '/programs', label: 'Programs', icon: 'folder' },
    { heading: 'Communication' },
    c('news.manage') && { href: '/news', label: 'News & events', icon: 'megaphone' },
    { heading: 'Configuration' },
    { href: '/campuses', label: 'Campuses', icon: 'building' },
    { href: '/modules', label: 'Modules', icon: 'toggles' },
    { href: '/grading', label: 'Activity types & grading', icon: 'chart' },
    { href: '/settings', label: 'Settings & branding', icon: 'settings' },
    { href: '/systems', label: 'Home page & systems', icon: 'grid' },
    c('admins.manage') && { href: '/staff', label: 'Admins, registrars & deans', icon: 'shield' },
    c('data.manage') && { href: '/data', label: 'Demo data & backup', icon: 'database' },
    { heading: 'Elsewhere' },
    { href: '/', label: 'ATLAS home', icon: 'grid', external: true },
  ].filter(Boolean);
}

function signedOutView(el, { status, boot }) {
  if (status.setupRequired) {
    const form = authScreen(el, { admin: true }, html`
      <form class="auth-card" novalidate>
        ${authLogo()}
        <h2>Welcome! Let's set up ATLAS</h2>
        <p class="muted">Create the first <strong>Administrator</strong>. You can add registrars, teachers and students after signing in.</p>
        ${status.setupCodeRequired ? html`<label class="field"><span>Setup code</span><input name="setupCode" autocomplete="off" required /><span class="hint">The code chosen when this server was created.</span></label>` : ''}
        <label class="field"><span>School name</span><input name="schoolName" value="${status.schoolName}" required /></label>
        <label class="field"><span>Campus name</span><input name="campusName" value="Main Campus" required /><span class="hint">Add more campuses later under Campuses.</span></label>
        <label class="field"><span>Your full name</span><input name="name" autocomplete="name" required /></label>
        <label class="field"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="e.g. admin" required /></label>
        ${passwordField('Password (at least 8 characters)', 'password', 'new-password')}
        ${passwordField('Confirm password', 'confirm', 'new-password')}
        <p class="form-error" hidden></p>
        <button class="btn primary block" type="submit">Create account and sign in</button>
      </form>`);
    return onFormSubmit(form, async (v) => {
      if (v.password !== v.confirm) throw new Error('The passwords do not match.');
      await api.post('/api/admin/auth/setup', v);
      toast('Administrator account created.');
      boot();
    });
  }
  const form = authScreen(el, { admin: true }, html`
    <form class="auth-card" novalidate>
      ${authLogo()}
      <h2>Admin panel</h2>
      <p class="muted">${status.schoolName}: for administrators and registrars.</p>
      <label class="field"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      ${passwordField('Password', 'password', 'current-password')}
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Sign in</button>
      <p class="auth-switch">Teacher, student or parent? <a href="/">Sign in on the ATLAS home page</a></p>
    </form>`);
  onFormSubmit(form, async ({ username, password }) => {
    if (!username || !password) throw new Error('Enter your username and password.');
    await api.post('/api/admin/auth/login', { username, password });
    boot();
  });
}

startApp({
  side: 'admin',
  authBase: '/api/admin/auth',
  product: 'Learn',
  routes,
  nav,
  home: () => '/dashboard',
  signedOutView,
  badges: {
    enrollment: () => api.get('/api/admin/enrollments/summary').then((s) => s.pending),
    applicants: () => api.get('/api/admin/enrollments/summary').then((s) => s.applicants),
  },
});
