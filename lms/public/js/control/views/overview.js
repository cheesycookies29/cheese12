// Control → Overview: accounts, who is signed in now, today's sign-ins and refusals, a security
// checklist, and the latest entries of the audit trail.
import { api } from '../../api.js';
import { html, mount } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { trailHead, trailRow } from '../common.js';

export async function overviewView(el) {
  const d = await api.get('/api/control/overview');
  const due = d.checks.filter((c) => !c.ok && !c.optional);
  mount(el, html`
    ${pageHead('Control', 'Access to every system, every account and who is signed in, and the audit trail. Only administrators see this.', html`<a class="btn" href="#/audit">${icon('search', 16)} Audit trail</a> <a class="btn primary" href="#/accounts">${icon('users', 16)} Accounts</a>`)}
    <div class="stats">
      <a class="card" href="#/accounts?status=active"><small>Active accounts</small><strong>${d.accounts.active.toLocaleString()}</strong></a>
      <a class="card" href="#/sessions"><small>Signed in now</small><strong>${d.sessions.people.toLocaleString()}</strong></a>
      <a class="card" href="#/audit?kind=signin&outcome=ok"><small>Sign-ins, last 24 hours</small><strong>${d.today.signIns.toLocaleString()}</strong></a>
      <a class="card ${d.today.failedSignIns ? 'accent' : ''}" href="#/audit?kind=signin&outcome=failed"><small>Failed sign-ins, last 24 hours</small><strong>${d.today.failedSignIns.toLocaleString()}</strong></a>
      <a class="card ${d.locks ? 'accent' : ''}" href="#/locks"><small>Locked usernames</small><strong>${d.locks}</strong></a>
      <a class="card ${d.today.refused ? 'accent' : ''}" href="#/audit?outcome=refused"><small>Refused requests, last 24 hours</small><strong>${d.today.refused.toLocaleString()}</strong></a>
    </div>
    <div class="cols wide-left">
      <section class="card">
        <div class="card-head"><h2>${icon('shield')} Security checklist</h2><span class="muted small">${due.length ? `${due.length} to look at` : 'All clear'}</span></div>
        <ul class="checklist">${d.checks.map((c) => html`<li class="${c.ok ? 'ok' : c.optional ? 'maybe' : 'todo'}">
          <span class="check-ic" aria-hidden="true">${icon(c.ok ? 'checkCircle' : c.optional ? 'circle' : 'flag', 18)}</span>
          <div><strong>${c.label}</strong><span class="sr-only">${c.ok ? ': done' : c.optional ? ': optional' : ': to do'}</span><small class="muted block">${c.detail}</small></div>
          ${!c.ok && c.fix ? html`<a class="btn sm" href="${c.fix}">Fix</a>` : ''}</li>`)}</ul>
      </section>
      <div class="stack">
        <section class="card"><h2>${icon('users')} Accounts by type</h2>
          <table class="table compact no-stack"><tbody>${d.accounts.byRole.filter((r) => r.count).map((r) => html`<tr><td><a href="#/accounts?role=${r.role}">${r.label}</a></td><td class="num">${r.count.toLocaleString()}</td></tr>`)}</tbody></table>
          <p class="muted small">${d.accounts.disabled} disabled · ${d.accounts.pending} applicants waiting · ${d.accounts.mustChange} to change their password · ${d.accounts.sso} linked to Keycloak</p>
        </section>
        <section class="card"><h2>${icon('laptop')} Signed in now</h2>
          <table class="table compact no-stack"><tbody>${d.sessions.bySide.map((s) => html`<tr><td>${s.label}</td><td class="num">${s.count}</td></tr>`)}</tbody></table>
          <p class="muted small">${d.sessions.total} session${d.sessions.total === 1 ? '' : 's'} for ${d.sessions.people} ${d.sessions.people === 1 ? 'person' : 'people'}. A restart of the server signs everyone out.</p>
        </section>
      </div>
    </div>
    <section class="card">
      <div class="card-head"><h2>${icon('clock')} Latest in the audit trail</h2><a href="#/audit">See all</a></div>
      ${d.recent.length ? html`<div class="table-scroll"><table class="table compact trail">${trailHead()}<tbody>${d.recent.map((e) => trailRow(e))}</tbody></table></div>` : html`<p class="muted">Nothing yet.</p>`}
    </section>`);
}
