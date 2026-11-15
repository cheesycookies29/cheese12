// My security: password, 2-step verification (an authenticator app, with recovery codes) and where
// the account is signed in. The set-up steps are shared with the sign-in screen, for accounts the
// company requires to use 2-step verification.
import { api } from '../api.js';
import { ctx } from '../state.js';
import { html, raw, mount, badge, toast, modal, confirmDialog, downloadFile } from '../ui.js';
import { icon } from '../icons.js';
import qrcode from '../vendor/qrcode.js';

const when = (iso) => new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
      <button type="button" class="btn" data-copy>${icon('copy', 16)} Copy</button>
      <button type="button" class="btn" data-download>${icon('download', 16)} Download</button>
    </div>
    <label class="check"><input type="checkbox" name="saved" /> I have saved my recovery codes</label>
  </div>`;
}
function wireRecovery(root, codes, onSaved) {
  const text = `CORE ERP recovery codes for ${ctx.user?.username || 'your account'}\nEach code works once.\n\n${codes.join('\n')}\n`;
  root.querySelector('[data-copy]').addEventListener('click', () => navigator.clipboard?.writeText(text).then(() => toast('Recovery codes copied.')).catch(() => toast('Select the codes and copy them.', 'error')));
  root.querySelector('[data-download]').addEventListener('click', () => downloadFile('core-recovery-codes.txt', text, 'text/plain'));
  const box = root.querySelector('[name=saved]');
  box.addEventListener('change', () => onSaved(box.checked));
}

// Set up 2-step verification inside `box`: the password, then the QR code and the first code from the
// app, then the recovery codes. onDone(user) when finished. The steps are plain blocks (not forms) so
// they can sit inside a dialog or the sign-in card; Enter in a field runs the step's button.
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
      <ol class="tfa-steps" start="2"><li>Enter the 6-digit code the app shows for <strong>CORE ERP</strong>.</li></ol>
      <label class="field"><span>Code from the app</span><input name="tfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" /></label>
      ${buttons('Turn on')}`,
    async () => {
      const res = await api.post('/api/me/2fa/enable', { code: box.querySelector('[name=tfa-code]').value });
      codesStep(res.recoveryCodes, res.user);
    });
  }

  function codesStep(codes, user) {
    step(html`
      <p class="notice ok small">${icon('shield', 16)} 2-step verification is on.</p>
      ${recoveryCodesBlock(codes)}
      <div class="actions"><button type="button" class="btn primary" data-done disabled>Done</button></div>`);
    const done = box.querySelector('[data-done]');
    wireRecovery(box, codes, (ok) => (done.disabled = !ok));
    done.addEventListener('click', () => onDone?.(user));
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
      <label class="field"><span>Code from the app, or a recovery code</span><input name="code" autocomplete="one-time-code" required /></label>
    </div>`,
    onSubmit: (f) => onSubmit({ password: f.password.value, code: f.code.value }),
  });
}

export async function securityView(el) {
  const [tfa, sessions] = await Promise.all([api.get('/api/me/2fa'), api.get('/api/me/sessions')]);
  const reload = () => securityView(el);
  const others = sessions.filter((s) => !s.current).length;
  mount(el, html`
    <header class="page-head"><div><h1>My security</h1><p class="muted">Your password, 2-step verification and where you are signed in.</p></div></header>
    <section class="card">
      <div class="card-head"><h2>Password</h2></div>
      <p class="muted">Use a password you use nowhere else: three unrelated words make a strong one.</p>
      <div class="actions"><button class="btn" id="change-pw">${icon('key', 16)} Change password</button></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>2-step verification</h2>${tfa.enabled ? badge('On', 'green') : tfa.required ? badge('Required', 'amber') : badge('Off', 'gray')}</div>
      ${tfa.enabled
        ? html`<p>When you sign in, CORE asks for the code from your authenticator app. On since ${when(tfa.enabledAt)}.</p>
          <p class="muted small">${tfa.recoveryLeft} of 10 recovery codes left.${tfa.recoveryLeft <= 3 ? ' Make new ones so you are not locked out.' : ''}</p>
          <div class="actions">
            <button class="btn" id="new-codes">New recovery codes</button>
            ${tfa.required ? html`<span class="muted small">Your company requires it for your account.</span>` : html`<button class="btn danger ghost" id="tfa-off">Turn off</button>`}
          </div>`
        : html`<p>Ask for a code from an app on your phone each time you sign in, so a stolen password alone is not enough.${tfa.required ? ' Your company requires it for your account.' : ''}</p>
          <div class="actions"><button class="btn primary" id="tfa-on">${icon('shield', 16)} Set up 2-step verification</button></div>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>Where you are signed in</h2>${others ? html`<button class="btn" id="sign-out-others">Sign out everywhere else</button>` : ''}</div>
      <div class="scroll-x flat"><table class="table">
        <thead><tr><th>Device</th><th>Network address</th><th>Signed in</th><th>Last active</th><th></th></tr></thead>
        <tbody>${sessions.map((s) => html`<tr>
          <td><strong>${s.device}</strong>${s.current ? html` ${badge('This device', 'green')}` : ''}</td>
          <td>${s.ip || '—'}</td><td>${when(s.signedInAt)}</td><td>${when(s.lastSeenAt)}</td>
          <td class="row-actions">${s.current ? '' : html`<button class="link danger" data-end="${s.id}">Sign out</button>`}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="muted small">You are signed out after a while without using CORE, and after the longest session your administrator allows. Changing your password signs out every other device.</p>
    </section>`);

  el.querySelector('#change-pw').addEventListener('click', () => ctx.changePassword());
  el.querySelector('#tfa-on')?.addEventListener('click', () => {
    const { form, close } = modal({ title: 'Set up 2-step verification', submitLabel: null, body: html`<div class="tfa-box"></div>` });
    form.querySelector('footer').hidden = true; // each step has its own buttons
    twoFactorSetup(form.querySelector('.tfa-box'), {
      onCancel: close,
      onDone: (user) => {
        close();
        Object.assign(ctx.user, user);
        toast('2-step verification is on. Other devices were signed out.');
        reload();
      },
    });
  });
  el.querySelector('#tfa-off')?.addEventListener('click', () => confirmWithCode({
    title: 'Turn off 2-step verification', submitLabel: 'Turn off',
    note: 'Without it, your password alone signs in to CORE.',
    onSubmit: async (body) => {
      await api.post('/api/me/2fa/disable', body);
      toast('2-step verification is off.');
      reload();
    },
  }));
  el.querySelector('#new-codes')?.addEventListener('click', () => confirmWithCode({
    title: 'New recovery codes', submitLabel: 'Make new codes',
    note: 'Your old recovery codes stop working.',
    onSubmit: async (body) => {
      const { recoveryCodes } = await api.post('/api/me/2fa/recovery-codes', body);
      setTimeout(() => {
        const { form, close } = modal({ title: 'Your new recovery codes', submitLabel: null, body: html`<div>${recoveryCodesBlock(recoveryCodes)}<div class="actions end"><button type="button" class="btn primary" data-done disabled>Done</button></div></div>` });
        form.querySelector('footer').hidden = true;
        const done = form.querySelector('[data-done]');
        wireRecovery(form, recoveryCodes, (ok) => (done.disabled = !ok));
        done.addEventListener('click', () => { close(); reload(); });
      });
    },
  }));
  el.querySelector('#sign-out-others')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Sign out of CORE on ${others} other device${others === 1 ? '' : 's'}?`, { confirmLabel: 'Sign out', title: 'Sign out everywhere else' }))) return;
    const { signedOut } = await api.post('/api/me/sessions/sign-out-others');
    toast(`Signed out of ${signedOut} other device${signedOut === 1 ? '' : 's'}.`);
    reload();
  });
  el.querySelector('tbody').addEventListener('click', async (e) => {
    const id = e.target.dataset.end;
    if (!id) return;
    await api.del(`/api/me/sessions/${id}`).catch((err) => toast(err.message, 'error'));
    reload();
  });
}
