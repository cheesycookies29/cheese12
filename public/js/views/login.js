import { api } from '../api.js';
import { ctx } from '../state.js';
import { html, mount, modal, toast } from '../ui.js';
import { twoFactorSetup } from './security.js';

const MODULES = ['HR & Payroll', 'IT Assets', 'Service Desk', 'Sales & CRM', 'Projects'];

// The sign-in screens: CORE's own ground (the brand colour, the mark drawn large in the accent's
// line) beside a cream panel that holds the form. On a phone the ground shrinks to a band above the
// form. The colour, the company's logo and the headline come from Admin panel → Settings & branding.
function authScreen(el, card) {
  const b = ctx.brand || {};
  const company = b.companyName || 'Lancaster Technology and Development Corporation';
  mount(el, html`
    <div class="auth-screen">
      <section class="auth-stage">
        <img class="auth-stage-mark" src="/img/core-mark-line.svg" alt="" />
        <div class="auth-wordmark"><img src="/img/core-mark.svg" alt="" /><span>CORE</span>${b.logo ? html`<img class="auth-logo" src="${b.logo}" alt="${company}" />` : ''}</div>
        <div class="auth-intro">
          <p class="auth-kicker">ERP by Lancaster</p>
          <h1>${b.headline || 'Every part of the company, on one core.'}</h1>
          <p>One sign-in for the people, equipment, service, sales and project work of ${company}.</p>
        </div>
        <ul class="auth-modules" aria-label="Modules">${MODULES.map((m) => html`<li>${m}</li>`)}</ul>
      </section>
      <section class="auth-panel">
        ${card}
        <p class="auth-legal">© ${new Date().getFullYear()} ${company}</p>
      </section>
    </div>`);
  const form = el.querySelector('.auth-card');
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
      <h2>Sign in</h2>
      <p class="muted">Use the account your administrator gave you.</p>
      <label class="field"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      ${passwordField('Password', 'password', 'current-password')}
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Sign in to CORE</button>
      <p class="auth-foot">Forgot your password? Ask your administrator to reset it.</p>
    </form>`);
  onSubmit(form, async ({ username, password }) => {
    if (!username || !password) throw new Error('Enter your username and password.');
    const res = await api.post('/api/auth/login', { username, password });
    // With 2-step verification on, the code from the authenticator app comes next.
    if (res.twoFactorRequired) return codeView(el, { challenge: res.challenge, onSignedIn });
    onSignedIn();
  });
}

// The second step of signing in: the 6-digit code from the authenticator app, or a recovery code.
function codeView(el, { challenge, onSignedIn }) {
  const form = authScreen(el, html`
    <form class="auth-card" novalidate>
      <h2>Enter your code</h2>
      <p class="muted code-hint">Open your authenticator app and enter the 6&#8209;digit code for <strong>CORE ERP</strong>.</p>
      <label class="field"><span class="code-label">Code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required /></label>
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Verify and sign in</button>
      <p class="auth-foot"><button type="button" class="link" id="use-recovery">Lost your phone? Use a recovery code</button></p>
      <p class="auth-foot"><button type="button" class="link" id="start-over">Back to sign in</button></p>
    </form>`);
  const input = form.querySelector('[name=code]');
  form.querySelector('#use-recovery').addEventListener('click', (e) => {
    input.setAttribute('inputmode', 'text');
    input.removeAttribute('maxlength');
    input.setAttribute('autocomplete', 'off');
    form.querySelector('.code-label').textContent = 'Recovery code';
    form.querySelector('.code-hint').textContent = 'Enter one of the recovery codes you saved, for example K7QPM-2XW4D. Each works once.';
    e.target.hidden = true;
    // The old error said to use a recovery code: it no longer applies.
    const err = form.querySelector('.form-error');
    err.hidden = true;
    err.textContent = '';
    input.value = '';
    input.focus();
  });
  form.querySelector('#start-over').addEventListener('click', () => loginView(el, { onSignedIn }));
  onSubmit(form, async ({ code }) => {
    if (!String(code || '').trim()) throw new Error('Enter the code.');
    try {
      await api.post('/api/auth/2fa', { challenge, code });
    } catch (err) {
      // The sign-in expired or too many wrong codes: back to the password.
      if (/username and password again/.test(err.message)) {
        loginView(el, { onSignedIn });
        toast(err.message, 'error');
        return;
      }
      throw err;
    }
    onSignedIn();
  });
}

// The company requires 2-step verification for this account and it is not set up yet.
export function forceTwoFactorView(el, { onSignedIn, onSignOut }) {
  const card = authScreen(el, html`
    <div class="auth-card">
      <h2>Set up 2-step verification</h2>
      <p class="muted">Your company requires 2-step verification for your account. It takes a minute, with an app on your phone.</p>
      <div class="tfa-box"></div>
      <p class="auth-foot"><button type="button" class="link" id="sign-out-link">Sign out</button></p>
    </div>`);
  card.querySelector('#sign-out-link').addEventListener('click', onSignOut);
  twoFactorSetup(card.querySelector('.tfa-box'), { onDone: () => onSignedIn() });
}

export function setupView(el, { onSignedIn }) {
  const form = authScreen(el, html`
    <form class="auth-card" novalidate>
      <h2>Welcome! Let's get set up</h2>
      <p class="muted">Create the first <strong>Administrator</strong> account. You can add HR, payroll, IT and employee accounts after signing in.</p>
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
