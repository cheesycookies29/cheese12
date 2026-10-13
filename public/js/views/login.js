import { api } from '../api.js';
import { ctx } from '../state.js';
import { html, mount, modal, toast } from '../ui.js';

function authScreen(el, card) {
  mount(el, html`
    <div class="auth-screen">
      <section class="auth-hero">
        <img src="/img/logo-white.png" alt="Lancaster Technology and Development" />
        <div>
          <h1>Let's take <span>HR</span> further</h1>
          <p>Employee records, time tracking and payroll, in one place.</p>
        </div>
        <small>Nation building through technology and development.</small>
      </section>
      <section class="auth-panel">${card}</section>
    </div>`);
  const form = el.querySelector('form');
  form.querySelector('input')?.focus();
  form.querySelectorAll('[data-toggle-pw]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
    }),
  );
  return form;
}

const passwordField = (label, name, autocomplete) => html`
  <label class="field"><span>${label}</span>
    <div class="pw-wrap"><input type="password" name="${name}" autocomplete="${autocomplete}" required /><button type="button" class="link" data-toggle-pw>Show</button></div>
  </label>`;

function onSubmit(form, handler) {
  const errorEl = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    errorEl.hidden = true;
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });
}

export function loginView(el, { onSignedIn }) {
  const form = authScreen(el, html`
    <form class="auth-card" novalidate>
      <img class="auth-logo" src="/img/logo.png" alt="Lancaster Technology and Development" />
      <h2>Sign in</h2>
      <p class="muted">Use the account given to you by your administrator.</p>
      <label class="field"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      ${passwordField('Password', 'password', 'current-password')}
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Sign in</button>
      <p class="auth-foot">Forgot your password? Ask your administrator to reset it.</p>
    </form>`);
  onSubmit(form, async ({ username, password }) => {
    if (!username || !password) throw new Error('Enter your username and password.');
    await api.post('/api/auth/login', { username, password });
    onSignedIn();
  });
}

export function setupView(el, { onSignedIn }) {
  const form = authScreen(el, html`
    <form class="auth-card" novalidate>
      <img class="auth-logo" src="/img/logo.png" alt="Lancaster Technology and Development" />
      <h2>Welcome! Let's get set up</h2>
      <p class="muted">Create the first <strong>Administrator</strong> account. You can add HR, payroll and employee accounts after signing in.</p>
      <label class="field"><span>Your full name</span><input name="name" autocomplete="name" required /></label>
      <label class="field"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="e.g. admin" required /></label>
      ${passwordField('Password (at least 8 characters)', 'password', 'new-password')}
      ${passwordField('Confirm password', 'confirm', 'new-password')}
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Create account and sign in</button>
    </form>`);
  onSubmit(form, async ({ name, username, password, confirm }) => {
    if (password !== confirm) throw new Error('The passwords do not match.');
    await api.post('/api/auth/setup', { name, username, password });
    toast('Administrator account created.');
    onSignedIn();
  });
}

export function forcePasswordView(el, { onSignedIn, onSignOut }) {
  const form = authScreen(el, html`
    <form class="auth-card" novalidate>
      <img class="auth-logo" src="/img/logo.png" alt="Lancaster Technology and Development" />
      <h2>Choose a new password</h2>
      <p class="muted">Hi ${ctx.user.name}. Your password was set by an administrator, so please replace it before continuing.</p>
      ${passwordField('Current (temporary) password', 'currentPassword', 'current-password')}
      ${passwordField('New password (at least 8 characters)', 'newPassword', 'new-password')}
      ${passwordField('Confirm new password', 'confirm', 'new-password')}
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Save and continue</button>
      <p class="auth-foot"><button type="button" class="link" id="sign-out-link">Sign out</button></p>
    </form>`);
  form.querySelector('#sign-out-link').addEventListener('click', onSignOut);
  onSubmit(form, async ({ currentPassword, newPassword, confirm }) => {
    if (newPassword !== confirm) throw new Error('The new passwords do not match.');
    await api.post('/api/auth/change-password', { currentPassword, newPassword });
    toast('Password changed.');
    onSignedIn();
  });
}

export function openChangePassword() {
  modal({
    title: 'Change password',
    submitLabel: 'Change password',
    body: html`<div class="stack tight">
      <label class="field"><span>Current password</span><input type="password" name="currentPassword" autocomplete="current-password" required /></label>
      <label class="field"><span>New password (at least 8 characters)</span><input type="password" name="newPassword" autocomplete="new-password" required /></label>
      <label class="field"><span>Confirm new password</span><input type="password" name="confirm" autocomplete="new-password" required /></label>
    </div>`,
    onSubmit: async (f) => {
      const { currentPassword, newPassword, confirm } = Object.fromEntries(new FormData(f));
      if (newPassword !== confirm) throw new Error('The new passwords do not match.');
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      toast('Password changed. Other devices have been signed out.');
    },
  });
}
