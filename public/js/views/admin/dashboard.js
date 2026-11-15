// Admin panel → Dashboard: a read-only overview of the system, each part linking to its page. The
// server sends each part only to those who may open that page.
import { api } from '../../api.js';
import { can } from '../../state.js';
import { html, mount, badge } from '../../ui.js';
import { icon } from '../../icons.js';
import { MODULES, SWITCHABLE } from '/shared/modules.js';
import { unseenCount } from '../devlog.js';
import { pageHead, fmtDateTime, timeAgo, bytes, plural } from './common.js';

const stat = (label, value, href, { accent = false, warn = false, note = '' } = {}) => html`<a class="card ${accent ? 'accent' : ''} ${warn ? 'attention' : ''}" href="#${href}"><small>${label}</small><strong>${value}</strong>${note ? html`<span class="muted small block">${note}</span>` : ''}</a>`;

export async function adminDashboardView(el) {
  const [d, devlogNew] = await Promise.all([api.get('/api/admin/dashboard'), can('devlog.view') ? unseenCount().catch(() => 0) : 0]);
  const p = d.people;
  const s = d.security;
  const offModules = d.modules ? SWITCHABLE.filter((id) => d.modules[id] === false) : [];
  const backupAge = d.data?.lastBackupAt ? (Date.now() - new Date(d.data.lastBackupAt)) / 86400000 : Infinity;

  mount(el, html`
    ${pageHead('Dashboard', html`CORE <strong>${d.version}</strong>${d.build ? html` · ${d.build.channel}${d.build.commit ? html` · <code>${d.build.commit.slice(0, 7)}</code>` : ''} · Node ${d.build.node} · running since ${fmtDateTime(d.build.startedAt)}` : ''}`)}

    ${p ? html`<section class="dash-section" aria-labelledby="dash-people">
      <div class="card-head"><h2 id="dash-people">${icon('users')} People</h2><a href="#/admin/users" class="small">Users &amp; Access ${icon('chevronRight', 14)}</a></div>
      <div class="stats">
        ${stat('Active accounts', p.active, '/admin/users', { note: p.disabled ? `${p.disabled} disabled` : '' })}
        ${stat('Signed in now', p.signedIn, '/admin/users')}
        ${stat('2-step verification on', `${p.twoFactor.on} of ${p.active}`, '/admin/security', { note: p.twoFactor.required ? `${p.twoFactor.required} required but not set up` : `${p.twoFactor.off} not set up` , warn: p.twoFactor.required > 0 })}
        ${stat('Temporary passwords not changed', p.tempPasswords, '/admin/users', { warn: p.tempPasswords > 0 })}
      </div>
      <div class="card"><h3 class="dash-sub">Active accounts by account type</h3>
        <div class="dash-roles">${p.byRole.map((r) => html`<span class="dash-role"><strong>${r.count}</strong> ${r.label}</span>`)}</div></div>
    </section>` : ''}

    ${s ? html`<section class="dash-section" aria-labelledby="dash-security">
      <div class="card-head"><h2 id="dash-security">${icon('shield')} Security, last 24 hours</h2><a href="#/admin/audit?area=auth" class="small">Audit log ${icon('chevronRight', 14)}</a></div>
      <div class="stats">
        ${stat('Failed sign-ins', s.failedSignIns, '/admin/audit?area=auth', { warn: s.failedSignIns >= 10 })}
        ${stat('Wrong 2-step codes', s.wrongCodes, '/admin/audit?area=auth')}
        ${stat('Usernames locked', s.locks, '/admin/audit?area=auth', { warn: s.locks > 0 })}
        <a class="card ${s.chain.ok ? '' : 'attention'}" href="#/admin/audit"><small>Audit log check</small><strong class="${s.chain.ok ? 'ok-text' : 'bad-text'}">${s.chain.ok ? 'Intact' : 'Altered'}</strong>
          <span class="muted small block">${s.chain.ok ? `${plural(s.chain.count, 'entry', 'entries')}, none changed` : `At entry ${s.chain.brokenAt}`}</span></a>
      </div>
    </section>` : ''}

    <div class="cols">
      ${d.modules ? html`<section class="card" aria-labelledby="dash-modules">
        <div class="card-head"><h2 id="dash-modules">${icon('grid')} Modules</h2><a href="#/admin/modules" class="small">Modules ${icon('chevronRight', 14)}</a></div>
        <ul class="dash-list">${MODULES.filter((m) => SWITCHABLE.includes(m.id)).map((m) => html`<li><span class="mod-ic">${icon(m.glyph, 16)}</span> ${m.name} <span class="spacer"></span>${d.modules[m.id] === false ? badge('Off', 'gray') : badge('On', 'green')}</li>`)}</ul>
        ${offModules.length ? html`<p class="muted small">Only administrators see a module that is off.</p>` : ''}
      </section>` : ''}

      ${d.feedback || can('devlog.view') ? html`<section class="card" aria-labelledby="dash-records">
        <div class="card-head"><h2 id="dash-records">${icon('message')} Waiting for you</h2></div>
        <ul class="dash-list">
          ${d.feedback ? html`<li><a href="#/admin/feedback">Feedback awaiting a reply</a><span class="spacer"></span><strong>${d.feedback.awaiting}</strong></li>` : ''}
          ${can('devlog.view') ? html`<li><a href="#/admin/devlog">Dev log releases you have not opened</a><span class="spacer"></span><strong>${devlogNew}</strong></li>` : ''}
          ${d.settingsChanged !== undefined ? html`<li><a href="#/admin/config?tab=history">Last settings change</a><span class="spacer"></span><span class="muted">${d.settingsChanged ? timeAgo(d.settingsChanged) : 'None yet'}</span></li>` : ''}
        </ul>
      </section>` : ''}

      ${d.data ? html`<section class="card" aria-labelledby="dash-data">
        <div class="card-head"><h2 id="dash-data">${icon('database')} Data</h2><a href="#/admin/data" class="small">Backup &amp; restore ${icon('chevronRight', 14)}</a></div>
        <ul class="dash-list">
          <li>Data file (db.json)<span class="spacer"></span><strong>${bytes(d.data.dbBytes)}</strong></li>
          <li>Attached files<span class="spacer"></span><strong>${bytes(d.data.attachmentsBytes)}</strong><span class="muted small">&nbsp;(${plural(d.data.attachments, 'file')})</span></li>
          <li>Audit log file<span class="spacer"></span><strong>${bytes(d.data.auditBytes)}</strong></li>
          <li>Last backup downloaded<span class="spacer"></span>${d.data.lastBackupAt ? html`<span class="${backupAge > 7 ? 'warn' : ''}">${timeAgo(d.data.lastBackupAt)}${d.data.lastBackupBy ? `, by ${d.data.lastBackupBy}` : ''}</span>` : html`<span class="warn">Never</span>`}</li>
          <li><a href="#/admin/demo">Demo data</a><span class="spacer"></span>${d.data.demo ? badge('Loaded', 'amber') : html`<span class="muted">Not loaded</span>`}</li>
        </ul>
        ${backupAge > 7 ? html`<p class="muted small">${d.data.lastBackupAt ? 'The last backup is more than a week old.' : 'No backup has been downloaded from this server yet.'} <a href="#/admin/data">Download one</a>.</p>` : ''}
      </section>` : ''}
    </div>`);
}
