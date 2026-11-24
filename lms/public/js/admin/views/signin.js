// Admin panel → System → Sign-in and passwords: the password rules, lock-out, idle sign-out and rate
// limits, for every system.
import { api } from '../../api.js';
import { html, mount, toast, formData, option } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { TWO_FACTOR_POLICIES } from '/shared/two-factor.js';

export async function signInView(el) {
  const s = await api.get('/api/admin/settings');
  const v = s.security;
  // Where a campus's addresses may be found: this browser's, and the busiest of the week.
  const nets = await api.get('/api/admin/school-networks').catch(() => null);
  const netRow = (n = {}) => html`<div class="sn-row">
      <label class="field"><span>Address or range</span><input name="sn-cidr" value="${n.cidr || ''}" placeholder="203.0.113.0/24" autocomplete="off" spellcheck="false" /></label>
      <label class="field"><span>Campus or note</span><input name="sn-label" value="${n.label || ''}" placeholder="Main Campus" maxlength="60" /></label>
      <button type="button" class="btn sn-remove" aria-label="Remove this network">${icon('trash', 16)} Remove</button>
    </div>`;
  mount(el, html`
    ${pageHead('Sign-in and passwords', 'Password rules, 2-step verification, lock-out, idle sign-out and rate limits, for every system. Each change is in the Audit log with its old and new value.')}
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
      <h2>${icon('shield')} 2-step verification</h2>
      <div class="grid">
        <label class="field span-2"><span>Who must use 2-step verification</span><select name="twoFactor">${Object.entries(TWO_FACTOR_POLICIES).map(([k, label]) => option(k, label, (v.twoFactor || 'off') === k))}</select>
          <span class="hint">A code from an authenticator app after the password, set up under My security. Employees are every account but students and parents. Someone who must use it and has not set it up is asked to, right after signing in. Keycloak sign-ins skip it: Keycloak asks for its own. To require it of administrators, turn it on for your own account first.</span></label>
      </div>
      <h2>${icon('lock')} Lock-out and sessions</h2>
      <div class="grid">
        <label class="field"><span>Wrong passwords before locking</span><input type="number" name="lockoutAttempts" min="3" max="20" value="${v.lockoutAttempts}" /><span class="hint">In a row, for one username from one network address. Ten times as many lock it from everywhere.</span></label>
        <label class="field"><span>Minutes locked</span><input type="number" name="lockoutMinutes" min="1" max="120" value="${v.lockoutMinutes}" /></label>
        <label class="field"><span>Sign out after (hours idle)</span><input type="number" name="idleHours" min="1" max="72" value="${v.idleHours}" /><span class="hint">Without using ATLAS. Shorter is safer on shared computers.</span></label>
        <label class="field"><span>Sign out after (hours signed in)</span><input type="number" name="maxSessionHours" min="1" max="168" value="${v.maxSessionHours ?? 12}" /><span class="hint">However busy. A stolen session stops working by then. Never sooner than the idle time.</span></label>
      </div>
      <h2>${icon('shield')} Rate limits</h2>
      <div class="grid">
        <label class="field"><span>Requests per person per minute</span><input type="number" name="requestsPerMinute" min="60" max="3000" value="${v.requestsPerMinute}" /><span class="hint">60 to 3000. Above this, ATLAS asks the person to wait a moment. Signed out, a network address gets four times as many.</span></label>
        <label class="field"><span>Wrong passwords per network address</span><input type="number" name="signInFailuresPerAddress" min="10" max="1000" value="${v.signInFailuresPerAddress}" /><span class="hint">In 15 minutes, across all usernames, before that address waits. For a campus that shares one internet address, list it under School networks below rather than raising this for everyone.</span></label>
      </div>
      <h2 id="school-networks">${icon('building')} School networks</h2>
      <p class="muted">A campus usually reaches the internet through one or two addresses, so everyone there looks like one visitor to the limits above. List those addresses: from them, the limits counted per address (sign-ins, wrong passwords, signed-out requests, applications and Keycloak sign-ins) are multiplied. Everywhere else they stay as they are, so password guessing from the internet still meets the usual limit.</p>
      ${nets ? html`<div class="notice ${nets.yourAddressCovered ? 'ok' : ''}">${icon('link')}<p>You are reaching ATLAS from <code>${nets.yourAddress}</code>${nets.yourAddressCovered ? ', which is on a school network.' : nets.yourNetworkCanAdd ? html`. If this is a campus connection, <button type="button" class="link" data-add-net="${nets.yourNetwork}">add it</button>.` : ' (this server’s own address: not one to list).'}</p></div>` : ''}
      <div id="sn-rows" class="sn-rows">${(v.schoolNetworks || []).map(netRow)}</div>
      ${(v.schoolNetworks || []).length ? '' : html`<p class="muted small" id="sn-none">No school networks listed yet: every campus shares the usual limits.</p>`}
      <div class="actions"><button type="button" class="btn" id="sn-add">${icon('plus', 16)} Add a network</button></div>
      ${nets?.busiest?.length ? html`<h3 class="sn-sub">Where people signed in from in the last 7 days</h3>
        <div class="table-wrap"><table class="table"><thead><tr><th>Network</th><th class="num">People</th><th class="num">Sign-ins</th><th></th></tr></thead><tbody>
        ${nets.busiest.map((b) => html`<tr><td><code>${b.network}</code></td><td class="num">${b.people}</td><td class="num">${b.signIns}</td><td>${b.covered ? html`<span class="badge green">School network</span>` : b.canAdd ? html`<button type="button" class="link" data-add-net="${b.network}">Add</button>` : ''}</td></tr>`)}
        </tbody></table></div>
        <p class="hint">Many people signing in from one network usually means a campus connection. Add only addresses that belong to the school.</p>` : ''}
      <div class="grid">
        <label class="field"><span>Limits on school networks (times)</span><input type="number" name="schoolNetworkFactor" min="1" max="100" value="${v.schoolNetworkFactor ?? 20}" /><span class="hint">1 to 100. At ${v.schoolNetworkFactor ?? 20}, a school network may make ${60 * (v.schoolNetworkFactor ?? 20)} sign-ins a minute and have ${(v.signInFailuresPerAddress || 30) * (v.schoolNetworkFactor ?? 20)} wrong passwords in 15 minutes before it waits. One username still locks after its own wrong passwords.</span></label>
      </div>
      <div class="actions end"><button class="btn primary">Save</button></div>
    </form>`);
  // School networks: add a row (empty, or filled from a suggestion), remove one.
  const rows = el.querySelector('#sn-rows');
  const addRow = (cidr = '') => {
    el.querySelector('#sn-none')?.remove();
    rows.insertAdjacentHTML('beforeend', String(netRow({ cidr })));
    rows.lastElementChild.querySelector(cidr ? '[name=sn-label]' : '[name=sn-cidr]').focus();
  };
  el.querySelector('#sn-add').addEventListener('click', () => addRow());
  el.querySelectorAll('[data-add-net]').forEach((b) => b.addEventListener('click', () => {
    addRow(b.dataset.addNet);
    b.replaceWith(Object.assign(document.createElement('span'), { className: 'muted', textContent: 'Added below: save to apply' }));
  }));
  rows.addEventListener('click', (e) => e.target.closest('.sn-remove')?.closest('.sn-row').remove());
  el.querySelector('#sec').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    try {
      await api.put('/api/admin/settings', { security: {
        minPasswordLength: f.minPasswordLength, lockoutAttempts: f.lockoutAttempts, lockoutMinutes: f.lockoutMinutes, idleHours: f.idleHours, maxSessionHours: f.maxSessionHours,
        requireLettersAndDigits: Boolean(f.requireLettersAndDigits), forcePasswordChange: Boolean(f.forcePasswordChange),
        requestsPerMinute: f.requestsPerMinute, signInFailuresPerAddress: f.signInFailuresPerAddress, twoFactor: f.twoFactor,
        schoolNetworks: [...el.querySelectorAll('.sn-row')].map((r) => ({ cidr: r.querySelector('[name=sn-cidr]').value.trim(), label: r.querySelector('[name=sn-label]').value.trim() })).filter((n) => n.cidr),
        schoolNetworkFactor: f.schoolNetworkFactor,
      } });
      toast('Saved. The new rules apply now.');
      signInView(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
