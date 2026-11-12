// Admin panel → System → Sign-in and passwords: the password rules, lock-out, idle sign-out and rate
// limits, for every system.
import { api } from '../../api.js';
import { html, mount, toast, formData } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';

export async function signInView(el) {
  const s = await api.get('/api/admin/settings');
  const v = s.security;
  mount(el, html`
    ${pageHead('Sign-in and passwords', 'Password rules, lock-out, idle sign-out and rate limits, for every system. Each change is in the Audit log with its old and new value.')}
    <div class="notice ${s.passwordEncryption?.on ? 'ok' : ''}">${icon('lock')}<p>${s.passwordEncryption?.on
      ? html`<strong>Passwords are encrypted.</strong> Each password is stored only as a one-way hash, and that hash is encrypted with the server's key (key ${s.passwordEncryption.keyId}). A copy of the data or a backup cannot be used to guess passwords without the key.`
      : html`<strong>Password hashes are not encrypted.</strong> Passwords are stored only as one-way hashes. Start the server with a key (PASSWORD_KEY) to encrypt them too.`}</p></div>
    <form class="card" id="sec">
      <h2>${icon('key')} Passwords</h2>
      <div class="grid">
        <label class="field"><span>Shortest password</span><input type="number" name="minPasswordLength" min="8" max="64" value="${v.minPasswordLength}" /><span class="hint">Characters, 8 to 64. 10 or more is recommended. Applies to new and changed passwords.</span></label>
        <label class="field check span-2"><input type="checkbox" name="requireLettersAndDigits" ${v.requireLettersAndDigits ? 'checked' : ''} /> <span><strong>Passwords mix letters and digits.</strong> A new password needs at least one of each.</span></label>
        <label class="field check span-3"><input type="checkbox" name="forcePasswordChange" ${v.forcePasswordChange ? 'checked' : ''} /> <span><strong>Always change the first password.</strong> New accounts and reset passwords must be changed at the first sign-in, in every system; staff cannot untick it.</span></label>
      </div>
      <h2>${icon('lock')} Lock-out and sessions</h2>
      <div class="grid">
        <label class="field"><span>Wrong passwords before locking</span><input type="number" name="lockoutAttempts" min="3" max="20" value="${v.lockoutAttempts}" /><span class="hint">In a row, for one username from one network address. Ten times as many lock it from everywhere.</span></label>
        <label class="field"><span>Minutes locked</span><input type="number" name="lockoutMinutes" min="1" max="120" value="${v.lockoutMinutes}" /></label>
        <label class="field"><span>Sign out after (hours idle)</span><input type="number" name="idleHours" min="1" max="72" value="${v.idleHours}" /><span class="hint">Without using ATLAS. Shorter is safer on shared computers.</span></label>
      </div>
      <h2>${icon('shield')} Rate limits</h2>
      <div class="grid">
        <label class="field"><span>Requests per person per minute</span><input type="number" name="requestsPerMinute" min="60" max="3000" value="${v.requestsPerMinute}" /><span class="hint">60 to 3000. Above this, ATLAS asks the person to wait a moment. Signed out, a network address gets four times as many.</span></label>
        <label class="field"><span>Wrong passwords per network address</span><input type="number" name="signInFailuresPerAddress" min="10" max="1000" value="${v.signInFailuresPerAddress}" /><span class="hint">In 15 minutes, across all usernames, before that address waits. Raise it if a whole campus shares one internet address.</span></label>
      </div>
      <div class="actions end"><button class="btn primary">Save</button></div>
    </form>`);
  el.querySelector('#sec').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    try {
      await api.put('/api/admin/settings', { security: {
        minPasswordLength: f.minPasswordLength, lockoutAttempts: f.lockoutAttempts, lockoutMinutes: f.lockoutMinutes, idleHours: f.idleHours,
        requireLettersAndDigits: Boolean(f.requireLettersAndDigits), forcePasswordChange: Boolean(f.forcePasswordChange),
        requestsPerMinute: f.requestsPerMinute, signInFailuresPerAddress: f.signInFailuresPerAddress,
      } });
      toast('Saved. The new rules apply now.');
      signInView(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
