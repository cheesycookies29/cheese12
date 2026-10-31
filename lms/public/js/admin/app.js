// Admin panel (/admin): Administrators and Registrars.
import { api } from '../api.js';
import { html, toast } from '../ui.js';
import { ctx, startApp, authScreen, passwordField, onFormSubmit } from '../shell.js';
import { can } from '/shared/roles.js';
import { dashboardView } from './views/dashboard.js';
import { enrollmentQueueView } from './views/enrollment.js';
import { peopleView, personView } from './views/people.js';
import { coursesView, programsView, termsView } from './views/catalog.js';
import { sectionsView, sectionView } from './views/sections.js';
import { modulesView } from './views/modules.js';
import { settingsView, dataView } from './views/settings.js';

const p = (permission) => (user) => can(user.role, permission);

const routes = [
  ['/dashboard', dashboardView, p('dashboard')],
  ['/enrollment', enrollmentQueueView, p('enrollment.manage')],
  ['/students', (el, params, q) => peopleView(el, { kind: 'student' }, q), p('students.manage')],
  ['/applicants', (el, params, q) => peopleView(el, { kind: 'applicant' }, q), p('students.manage')],
  ['/teachers', (el, params, q) => peopleView(el, { kind: 'teacher' }, q), p('teachers.view')],
  ['/staff', (el, params, q) => peopleView(el, { kind: 'staff' }, q), p('admins.manage')],
  ['/people/:id', personView, (u) => can(u.role, 'students.manage') || can(u.role, 'teachers.view')],
  ['/courses', coursesView, p('dashboard')],
  ['/sections', sectionsView, p('dashboard')],
  ['/sections/:id', sectionView, p('dashboard')],
  ['/terms', termsView, p('dashboard')],
  ['/programs', programsView, p('dashboard')],
  ['/modules', modulesView, p('dashboard')],
  ['/settings', settingsView, p('dashboard')],
  ['/data', dataView, p('data.manage')],
];

function nav() {
  const c = (perm) => can(ctx.user.role, perm);
  return [
    { href: '/dashboard', label: 'Dashboard' },
    { heading: 'Enrollment' },
    c('enrollment.manage') && { href: '/enrollment', label: 'Enrollment requests', badge: 'enrollment' },
    c('students.manage') && { href: '/applicants', label: 'Applicants', badge: 'applicants' },
    c('students.manage') && { href: '/students', label: 'Students', also: ['/people'] },
    c('teachers.view') && { href: '/teachers', label: 'Teachers' },
    { heading: 'Catalog' },
    { href: '/sections', label: 'Sections' },
    { href: '/courses', label: 'Courses' },
    { href: '/terms', label: 'Terms' },
    { href: '/programs', label: 'Programs' },
    { heading: 'Configuration' },
    { href: '/modules', label: 'Modules' },
    { href: '/settings', label: 'Settings' },
    c('admins.manage') && { href: '/staff', label: 'Admins & registrars' },
    c('data.manage') && { href: '/data', label: 'Demo data & backup' },
    { heading: 'Elsewhere' },
    { href: '/', label: 'Open the learning portal ↗', external: true },
  ].filter(Boolean);
}

function signedOutView(el, { status, boot }) {
  if (status.setupRequired) {
    const form = authScreen(el, { admin: true }, html`
      <form class="auth-card" novalidate>
        <img class="auth-logo" src="/img/logo.png" alt="Lancaster Technology and Development" />
        <h2>Welcome! Let's set up the LMS</h2>
        <p class="muted">Create the first <strong>Administrator</strong>. You can add registrars, teachers and students after signing in.</p>
        <label class="field"><span>School name</span><input name="schoolName" value="${status.schoolName}" required /></label>
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
      <img class="auth-logo" src="/img/logo.png" alt="Lancaster Technology and Development" />
      <h2>Admin panel</h2>
      <p class="muted">${status.schoolName}: for administrators and registrars.</p>
      <label class="field"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      ${passwordField('Password', 'password', 'current-password')}
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Sign in</button>
      <p class="auth-switch">Teacher or student? <a href="/">Go to the learning portal</a></p>
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
  appName: 'Admin panel',
  routes,
  nav,
  home: () => '/dashboard',
  signedOutView,
  badges: {
    enrollment: () => api.get('/api/admin/enrollments/summary').then((s) => s.pending),
    applicants: () => api.get('/api/admin/enrollments/summary').then((s) => s.applicants),
  },
});
