// 2-step verification in the browser, after CORE ERP's (public/js/views/security.js and login.js at the
// repository root): setting up the authenticator app (QR code, first code, recovery codes shown once),
// the My security card, the code step of a sign-in, and the set-up an account is sent to when the school
// requires it. Shared by My security (account/profile.js), the ATLAS home sign-in (hub/app.js), the Admin
// panel's sign-in (admin/app.js) and every system's start-up (shell.js).
import { api } from '../api.js';
import { html, raw, mount, badge, toast, modal, downloadFile, fmtDateTime } from '../ui.js';
import { icon } from '../icons.js';
import { ctx, authScreen, onFormSubmit } from '../shell.js';
import qrcode from '../vendor/qrcode.js';

const grouped = (secret) => secret.replace(/(.{4})/g, '$1 ').trim();

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return raw(q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR code for the authenticator app' }));
}

// The recovery codes, shown once: copy, download, and confirm they are kept somewhere safe.
function recoveryCodesBlock(codes) {
  return html`<div class="recovery">
    <p>Keep these <strong>recovery codes</strong> somewhere safe, away from your phone: in a password manager, or printed and locked away. Each one signs you in once if you lose your phone. They are shown only now.</p>
    <ol class="recovery-codes">${codes.map((c) => html`<li><code>${c}</code></li>`)}</ol>
    <div class="actions">
      <button type="button" class="btn" data-copy>${icon('clipboard', 16)} Copy</button>
      <button type="button" class="btn" data-download>${icon('download', 16)} Download</button>
    </div>
    <label class="check"><input type="checkbox" name="saved" /> I have saved my recovery codes</label>
  </div>`;
}
function wireRecovery(root, codes, onSaved) {
  const school = ctx.info?.branding?.schoolName || ctx.info?.schoolName || '';
  const text = `ATLAS recovery codes for ${ctx.user?.username || 'your account'}${school ? ` at ${school}` : ''}\nEach code works once.\n\n${codes.join('\n')}\n`;
  root.querySelector('[data-copy]').addEventListener('click', () => {
    const copied = navigator.clipboard?.writeText(text);
    if (!copied) return toast('Select the codes and copy them.', 'error');
    copied.then(() => toast('Recovery codes copied.')).catch(() => toast('Select the codes and copy them.', 'error'));
  });
  root.querySelector('[data-download]').addEventListener('click', () => downloadFile('atlas-recovery-codes.txt', text, 'text/plain'));
  const box = root.querySelector('[name=saved]');
  box.addEventListener('change', () => onSaved(box.checked));
}

// Set up 2-step verification inside `box`: the password, then the QR code and the first code from the
// app, then the recovery codes. onDone(result) when finished. The steps are plain blocks (not forms) so
// they can sit inside a dialog or a sign-in card; Enter in a field runs the step's button.
export function twoFactorSetup(box, { onDone, onCancel } = {}) {
  const step = (content, action) => {
    mount(box, html`<div class="tfa-step">${content}</div>`);
    const go = box.querySelector('[data-go]');
    const err = box.querySelector('.form-error');
    box.querySelector('[data-cancel]')?.addEventListener('click', () => onCancel?.());
    if (!go) return;
    const run = async () => {
      go.disabled = true;
      if (err) err.hidden = true;
      try {
        await action();
      } catch (e) {
        if (err) {
          err.textContent = e.message;
          err.hidden = false;
        }
      } finally {
        if (go.isConnected) go.disabled = false;
      }
    };
    go.addEventListener('click', run);
    box.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        run();
      }
    }));
    box.querySelector('input')?.focus();
  };
  const buttons = (label) => html`<p class="form-error" hidden></p>
    <div class="actions">${onCancel ? html`<button type="button" class="btn" data-cancel>Cancel</button>` : ''}<button type="button" class="btn primary" data-go>${label}</button></div>`;

  function passwordStep() {
    step(html`
      <p>2-step verification asks for a code from an app on your phone each time you sign in, so a stolen password alone is not enough.</p>
      <p class="muted small">You need an authenticator app, for example Google Authenticator, Microsoft Authenticator or 1Password.</p>
      <label class="field"><span>Your password</span><input type="password" name="tfa-password" autocomplete="current-password" /></label>
      ${buttons('Continue')}`,
    async () => scanStep(await api.post('/api/me/2fa/setup', { password: box.querySelector('[name=tfa-password]').value })));
  }

  function scanStep({ secret, otpauthUrl }) {
    step(html`
      <ol class="tfa-steps"><li>Open your authenticator app and add an account (often a <strong>+</strong> button), then scan this code.</li></ol>
      <div class="tfa-qr">${qrSvg(otpauthUrl)}</div>
      <p class="muted small">Can't scan it? Choose to enter a setup key, and type <code class="tfa-key">${grouped(secret)}</code> (time-based).</p>
      <ol class="tfa-steps" start="2"><li>Enter the 6-digit code the app shows for <strong>ATLAS</strong>.</li></ol>
      <label class="field"><span>Code from the app</span><input name="tfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" /></label>
      ${buttons('Turn on')}`,
    async () => {
      const res = await api.post('/api/me/2fa/enable', { code: box.querySelector('[name=tfa-code]').value });
      codesStep(res);
    });
  }

  function codesStep(res) {
    step(html`
      <p class="notice ok small">${icon('shield', 16)} 2-step verification is on.</p>
      ${recoveryCodesBlock(res.recoveryCodes)}
      <div class="actions"><button type="button" class="btn primary" data-done disabled>Done</button></div>`);
    const done = box.querySelector('[data-done]');
    wireRecovery(box, res.recoveryCodes, (ok) => (done.disabled = !ok));
    done.addEventListener('click', () => onDone?.(res));
  }

  passwordStep();
}

// Asks for the password and a current code (or a recovery code), for turning it off or new codes.
function confirmWithCode({ title, submitLabel, note, onSubmit }) {
  modal({
    title, submitLabel,
    body: html`<div class="stack tight">
      ${note ? html`<p class="muted small">${note}</p>` : ''}
      <label class="field"><span>Your password</span><input type="password" name="password" autocomplete="current-password" required /></label>
      <label class="field"><span>Code from the app, or a recovery code</span><input name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required /></label>
    </div>`,
    onSubmit: (f) => onSubmit({ password: f.password.value, code: f.code.value }),
  });
}

// ----- My security: the 2-step verification card -----
export function twoFactorCard(tfa) {
  const state = tfa.enabled ? badge('On', 'green') : tfa.required ? badge('Required', 'amber') : badge('Off', 'gray');
  const sso = tfa.sso?.linked || tfa.sso?.thisSession
    ? html`<p class="muted small">${icon('key', 14)} Your account is linked to Keycloak. When you sign in with Keycloak, Keycloak asks for its own second step and ATLAS does not ask for this code; it applies when you sign in with your ATLAS password.</p>`
    : '';
  const body = tfa.enabled
    ? html`<p>When you sign in with your password, ATLAS asks for the code from your authenticator app. On since ${fmtDateTime(tfa.enabledAt)}.</p>
      <p class="muted small">${tfa.recoveryLeft} of ${tfa.recoveryTotal} recovery codes left.${tfa.recoveryLeft <= 3 ? ' Make new ones so you are not locked out.' : ''}</p>
      ${sso}
      <div class="actions">
        <button type="button" class="btn" id="tfa-new-codes">${icon('key', 16)} New recovery codes</button>
        ${tfa.required ? html`<span class="muted small">Your school requires it for your account.</span>` : html`<button type="button" class="btn danger" id="tfa-off">Turn off</button>`}
      </div>`
    : html`<p>Ask for a code from an app on your phone each time you sign in, so a stolen password alone is not enough.${tfa.required ? ' Your school requires it for your account.' : ''}</p>
      ${sso}
      ${tfa.available ? html`<div class="actions"><button type="button" class="btn primary" id="tfa-on">${icon('shield', 16)} Set up 2-step verification</button></div>`
        : html`<p class="muted small">This server has no password key, so it cannot keep the app's secret encrypted. Ask the person who runs ATLAS.</p>`}`;
  return html`<section class="card" aria-labelledby="sec-tfa">
    <div class="card-head"><h2 id="sec-tfa">${icon('shield')} 2-step verification</h2>${state}</div>
    ${body}
  </section>`;
}

export function wireTwoFactorCard(el, reload) {
  el.querySelector('#tfa-on')?.addEventListener('click', () => {
    const { form, close } = modal({ title: 'Set up 2-step verification', submitLabel: null, body: html`<div class="tfa-box"></div>` });
    form.querySelector('footer').hidden = true; // each step has its own buttons
    twoFactorSetup(form.querySelector('.tfa-box'), {
      onCancel: close,
      onDone: (res) => {
        close();
        Object.assign(ctx.user, res.user);
        toast('2-step verification is on. Your other devices were signed out.');
        reload();
      },
    });
  });
  el.querySelector('#tfa-off')?.addEventListener('click', () => confirmWithCode({
    title: 'Turn off 2-step verification', submitLabel: 'Turn off',
    note: 'Without it, your password alone signs in to ATLAS.',
    onSubmit: async (body) => {
      const res = await api.post('/api/me/2fa/disable', body);
      Object.assign(ctx.user, res.user);
      toast('2-step verification is off.');
      reload();
    },
  }));
  el.querySelector('#tfa-new-codes')?.addEventListener('click', () => confirmWithCode({
    title: 'New recovery codes', submitLabel: 'Make new codes',
    note: 'Your old recovery codes stop working.',
    onSubmit: async (body) => {
      const { recoveryCodes } = await api.post('/api/me/2fa/recovery-codes', body);
      setTimeout(() => { // after this dialog has closed
        const { form, close } = modal({ title: 'Your new recovery codes', submitLabel: null, body: html`<div>${recoveryCodesBlock(recoveryCodes)}<div class="actions end"><button type="button" class="btn primary" data-done disabled>Done</button></div></div>` });
        form.querySelector('footer').hidden = true;
        const done = form.querySelector('[data-done]');
        wireRecovery(form, recoveryCodes, (ok) => (done.disabled = !ok));
        done.addEventListener('click', () => {
          close();
          reload();
        });
      });
    },
  }));
}

// ----- Signing in: the code after the password -----
// render(card): draws the sign-in screen with this card and returns its form (the ATLAS home page and
// the Admin panel each have their own). verifyUrl: the verify route of the sign-in that was started.
// onSignedIn(): the session is open; onBack(): back to the username and password.
export function codeStep({ render, verifyUrl, challenge, onSignedIn, onBack }) {
  const form = render(html`
    <form class="auth-card" novalidate>
      <h2>Enter your code</h2>
      <p class="muted code-hint">Open your authenticator app and enter the 6&#8209;digit code for <strong>ATLAS</strong>. Lost your phone? Enter one of your recovery codes instead.</p>
      <label class="field"><span>Code from the app, or a recovery code</span><input name="code" inputmode="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="20" required /></label>
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Verify and sign in</button>
      <p class="auth-foot">The code changes every 30 seconds; each one works once. A recovery code, such as K7QPM-2XW4D, also works once.</p>
      <p class="auth-switch"><button type="button" class="link" id="tfa-back">${icon('chevronLeft', 14)} Back to sign in</button></p>
    </form>`);
  form.querySelector('[name=code]').focus();
  form.querySelector('#tfa-back').addEventListener('click', onBack);
  onFormSubmit(form, async ({ code }) => {
    if (!String(code || '').trim()) throw new Error('Enter the code from your app, or a recovery code.');
    try {
      await api.post(verifyUrl, { challenge, code });
    } catch (err) {
      // The sign-in expired, or too many wrong codes: back to the password.
      if (/username and password again/.test(err.message) || err.status === 429) {
        onBack();
        toast(err.message, 'error');
        return;
      }
      throw err;
    }
    onSignedIn();
  });
  return form;
}

// The school requires 2-step verification for this account and it is not set up yet: only that,
// before anything else (as the forced password change).
export function forceTwoFactorView(el, { admin = false, render = null, onDone, onSignOut }) {
  const card = html`
    <div class="auth-card">
      <h2>Set up 2-step verification</h2>
      <p class="muted">Hi ${ctx.user?.name || ''}. Your school requires 2-step verification for your account. It takes a minute, with an app on your phone.</p>
      <div class="tfa-box"></div>
      <p class="auth-foot"><button type="button" class="link" id="tfa-sign-out">Sign out</button></p>
    </div>`;
  if (render) render(card);
  else authScreen(el, { admin }, card);
  el.querySelector('#tfa-sign-out').addEventListener('click', onSignOut);
  twoFactorSetup(el.querySelector('.tfa-box'), {
    onDone: () => {
      toast('2-step verification is on.');
      onDone();
    },
  });
}
