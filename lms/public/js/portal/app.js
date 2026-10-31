// Learning portal (/): Teachers and Students. What each sees depends on the
// modules an administrator has switched on for their account type.
import { api } from '../api.js';
import { html, option } from '../ui.js';
import { has } from './common.js';
import { ctx, startApp, authScreen, passwordField, onFormSubmit } from '../shell.js';
import { homeView } from './views/home.js';
import { catalogView, myEnrollmentView } from './views/enroll.js';
import { classesView, classView } from './views/classes.js';
import { assignmentView } from './views/assignment.js';
import { scheduleView } from './views/schedule.js';
import { gradesView } from './views/grades.js';

const student = (u) => u.role === 'student';
const mod = (m, extra = () => true) => (u, info) => info.modules.includes(m) && extra(u);

const routes = [
  ['/home', homeView],
  ['/enroll', catalogView, mod('enrollment', student)],
  ['/enroll/mine', myEnrollmentView, mod('enrollment', student)],
  ['/classes', classesView],
  ['/classes/:id', classView],
  ['/classes/:id/:tab', classView],
  ['/assignments/:id', assignmentView, mod('assignments')],
  ['/schedule', scheduleView, mod('schedule')],
  ['/grades', gradesView, mod('grades', student)],
];

function nav() {
  const isStudent = ctx.user.role === 'student';
  return [
    { href: '/home', label: 'Home' },
    isStudent && has('enrollment') && { href: '/enroll', label: 'Enrollment', also: ['/enroll/mine'] },
    { href: '/classes', label: isStudent ? 'My classes' : 'My sections', also: ['/assignments'] },
    has('schedule') && { href: '/schedule', label: 'Schedule' },
    isStudent && has('grades') && { href: '/grades', label: 'Grades' },
  ].filter(Boolean);
}

function applyView(el, { status, back }) {
  const form = authScreen(el, {}, html`
    <form class="auth-card" novalidate>
      <img class="auth-logo" src="/img/logo.png" alt="Lancaster Technology and Development" />
      <h2>Apply as a student</h2>
      <p class="muted">${status.schoolName}. The registrar reviews your application; you can sign in once you are admitted.</p>
      <label class="field"><span>Full name</span><input name="name" autocomplete="name" required /></label>
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required /></label>
      <label class="field"><span>Program</span><select name="programId" id="programs">${option('', 'Undecided')}</select></label>
      <label class="field"><span>Year level</span><select name="yearLevel">${[1, 2, 3, 4, 5].map((y) => option(y, `Year ${y}`))}</select></label>
      <label class="field"><span>Choose a username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      ${passwordField('Choose a password (at least 8 characters)', 'password', 'new-password')}
      <label class="field"><span>Anything the registrar should know? (optional)</span><textarea name="note" style="min-height:70px"></textarea></label>
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Send application</button>
      <p class="auth-switch"><button type="button" class="link" id="back">← Back to sign in</button></p>
    </form>`);
  api.get('/api/auth/programs').then((programs) => {
    form.querySelector('#programs').insertAdjacentHTML('beforeend', programs.map((p) => `<option value="${p.id}">${p.code} · ${p.name.replace(/</g, '&lt;')}</option>`).join(''));
  });
  form.querySelector('#back').addEventListener('click', back);
  onFormSubmit(form, async (v) => {
    await api.post('/api/auth/apply', v);
    authScreen(el, {}, html`<div class="auth-card"><h2>Application sent</h2><p>Thank you, ${v.name}. The registrar will review it; once you are admitted, sign in with the username <strong>${v.username.toLowerCase()}</strong>.</p><button class="btn primary block" id="ok">Back to sign in</button></div>`);
    el.querySelector('#ok').addEventListener('click', back);
  });
}

function signedOutView(el, { status, boot }) {
  if (status.setupRequired) {
    return authScreen(el, {}, html`<div class="auth-card"><h2>Not set up yet</h2><p>An administrator needs to set up the LMS first.</p><a class="btn primary block" href="/admin">Open the admin panel</a></div>`);
  }
  const form = authScreen(el, {}, html`
    <form class="auth-card" novalidate>
      <img class="auth-logo" src="/img/logo.png" alt="Lancaster Technology and Development" />
      <h2>Sign in</h2>
      <p class="muted">${status.schoolName} learning portal, for students and teachers.</p>
      <label class="field"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      ${passwordField('Password', 'password', 'current-password')}
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Sign in</button>
      ${status.registrationOpen ? html`<p class="auth-switch">New student? <button type="button" class="link" id="apply">Apply as a student</button></p>` : ''}
      <p class="auth-foot">Forgot your password? Ask the registrar to reset it. · <a href="/admin">Admin panel</a></p>
    </form>`);
  form.querySelector('#apply')?.addEventListener('click', () => applyView(el, { status, back: () => signedOutView(el, { status, boot }) }));
  onFormSubmit(form, async ({ username, password }) => {
    if (!username || !password) throw new Error('Enter your username and password.');
    await api.post('/api/auth/login', { username, password });
    boot();
  });
}

startApp({
  side: 'portal',
  authBase: '/api/auth',
  appName: 'Learning portal',
  routes,
  nav,
  home: () => '/home',
  signedOutView,
  badges: {},
});
