// Control → Sessions (everyone signed in now) and Locked sign-ins (usernames locked after wrong passwords).
import { api } from '../../api.js';
import { html, mount, toast, confirmDialog, badge, fmtDateTime } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { when, browserOf } from '../common.js';

export async function sessionsView(el) {
  const list = await api.get('/api/control/sessions');
  const people = new Set(list.map((s) => s.userId)).size;
  const others = list.filter((s) => !s.mine).length;
  mount(el, html`
    ${pageHead('Sessions', `Everyone signed in now: ${list.length} session${list.length === 1 ? '' : 's'} for ${people} ${people === 1 ? 'person' : 'people'}. A session ends after the idle time set under Sign-in and passwords, or when its person signs out.`,
      others ? html`<button class="btn danger" id="end-others">${icon('logout', 16)} End everyone else's</button>` : '')}
    <div class="card flush"><div class="table-scroll"><table class="table">
      <thead><tr><th>Person</th><th>System</th><th>Browser</th><th>Address</th><th>Signed in</th><th>Last active</th><th></th></tr></thead>
      <tbody>${list.map((s) => html`<tr>
        <td data-label="Person"><a href="#/accounts/${s.userId}"><strong>${s.name}</strong></a><small class="muted block">${s.roleLabel} · ${s.username}</small></td>
        <td data-label="System">${s.sideLabel}${s.sso ? html` ${badge('Keycloak', 'blue')}` : ''}${s.mine ? html` ${badge('This browser', 'brand')}` : ''}</td>
        <td data-label="Browser">${browserOf(s.agent) || html`<span class="muted">Not known</span>`}</td>
        <td data-label="Address" class="mono">${s.ip || '—'}</td>
        <td data-label="Signed in" class="nowrap">${when(s.createdAt)}</td>
        <td data-label="Last active" class="nowrap">${when(s.lastSeen)}</td>
        <td class="row-actions">${s.mine ? '' : html`<button class="btn sm" data-end="${s.id}" data-name="${s.name}">End</button>`}</td></tr>`)}</tbody></table></div></div>
    <p class="muted small">Sessions are kept in the server's memory: restarting the server signs everyone out.</p>`);
  el.querySelectorAll('[data-end]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api.del(`/api/control/sessions/${b.dataset.end}`);
      toast(`${b.dataset.name} is signed out of that browser.`);
      sessionsView(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  el.querySelector('#end-others')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`End all ${others} other session${others === 1 ? '' : 's'}? Everyone but you is signed out and signs in again. Use it after a suspected break-in, or before maintenance.`, { confirmLabel: 'End them', title: 'End everyone else\'s sessions' }))) return;
    try {
      const r = await api.post('/api/control/sessions/end-others');
      toast(`${r.ended} session${r.ended === 1 ? '' : 's'} ended.`);
      sessionsView(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export async function locksView(el) {
  const list = await api.get('/api/control/locks');
  mount(el, html`
    ${pageHead('Locked sign-ins', 'A username is locked on one network address after too many wrong passwords in a row, and everywhere after ten times as many. Locks open on their own after the minutes set under Sign-in and passwords.')}
    ${list.length ? html`<div class="card flush"><div class="table-scroll"><table class="table">
      <thead><tr><th>Username</th><th>Locked on</th><th>Opens</th><th></th></tr></thead>
      <tbody>${list.map((l) => html`<tr>
        <td data-label="Username">${l.accountId ? html`<a href="#/accounts/${l.accountId}"><strong>${l.name}</strong></a><small class="muted block">${l.username}</small>` : html`<strong>${l.username}</strong><small class="muted block">No such account</small>`}</td>
        <td data-label="Locked on">${l.ip ? html`<span class="mono">${l.ip}</span>` : html`${badge('Every address', 'red')}`}</td>
        <td data-label="Opens" class="nowrap"><time datetime="${l.until}">${fmtDateTime(l.until)}</time></td>
        <td class="row-actions"><button class="btn sm" data-key="${l.key}">Unlock</button></td></tr>`)}</tbody></table></div></div>
      <p class="muted small">Someone you do not recognise trying many usernames from one address? Look it up in the <a href="#/audit?kind=signin&outcome=failed">audit trail</a>.</p>`
    : html`<div class="card empty">${icon('lock', 32)}<p>No username is locked.</p></div>`}`);
  el.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api.post('/api/control/locks/clear', { key: b.dataset.key });
      toast('Unlocked.');
      locksView(el);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}
