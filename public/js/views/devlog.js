// Dev log (administrators): release notes for every version, newest first,
// and which build the server is running.
import { api } from '../api.js';
import { ctx } from '../state.js';
import { DEVLOG, DEVLOG_MODULES, CHANGE_TYPES, APP_VERSION, compareVersions } from '/shared/devlog.js';
import { html, mount, fmtDate, badge } from '../ui.js';

const CHANGE_KIND = { new: 'green', improved: 'blue', fixed: 'amber' };
const when = (iso) => new Date(iso).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const isNewer = (a, b) => compareVersions(a, b) > 0;
// '0.2.3-alpha' -> number '0.2.3' and stage 'alpha'
const split = (v) => ({ num: v.split('-')[0], stage: v.split('-')[1] || '' });
const versionLabel = (v) => html`v${split(v).num}${split(v).stage ? html` <span class="stage">${split(v).stage}</span>` : ''}`;

// "Read up to" version per user, kept in this browser. Never visited: only the latest build counts as new.
// (Key renamed when builds were renumbered from 0.0.1-alpha.)
const seenKey = () => `ltdc-devlog-read:${ctx.user?.id}`;
function lastSeen() {
  try {
    return localStorage.getItem(seenKey());
  } catch {
    return null;
  }
}
const isUnseen = (version, seen = lastSeen()) => (seen ? isNewer(version, seen) : version === APP_VERSION);
export const unseenCount = () => DEVLOG.filter((r) => isUnseen(r.version)).length;
function markSeen() {
  try {
    localStorage.setItem(seenKey(), APP_VERSION);
  } catch {}
  window.dispatchEvent(new Event('devlog:seen'));
}

function uptime(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h} h ${mins % 60} min` : `${Math.floor(h / 24)} days`;
}

export async function devlogView(el) {
  const about = await api.get('/api/system/about');
  const seen = lastSeen();
  const unseen = new Set(DEVLOG.filter((r) => isUnseen(r.version, seen)).map((r) => r.version));
  const state = { module: '', q: '' };
  const count = (m) => DEVLOG.filter((r) => r.modules.includes(m)).length;
  const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || html`<span class="muted">—</span>`}</dd></div>`;

  function render() {
    const q = state.q.trim().toLowerCase();
    const list = DEVLOG.map((r) => ({ ...r, changes: r.changes.filter(([, m]) => !state.module || m === state.module) }))
      .filter((r) => r.changes.length)
      .filter((r) => !q || [r.version, r.title, r.notes, ...(r.known || []), ...r.changes.map((c) => c[2])].join(' ').toLowerCase().includes(q));
    el.querySelectorAll('[data-module-filter]').forEach((b) => b.classList.toggle('active', b.dataset.moduleFilter === state.module));
    mount(el.querySelector('#releases'), list.length
      ? list.map((r) => html`<article class="release ${unseen.has(r.version) ? 'unseen' : ''}" id="v${r.version}">
          <aside>
            <p class="rel-version">${versionLabel(r.version)}</p>
            <time datetime="${r.date}">${fmtDate(r.date)}</time>
            <div class="rel-flags">${r.version === about.version ? badge('Installed', 'maroon') : ''}${unseen.has(r.version) ? badge('New', 'amber') : ''}</div>
          </aside>
          <div class="rel-body">
            <h2>${r.title}</h2>
            <p class="rel-notes">${r.notes}</p>
            <p class="rel-modules">${r.modules.map((m) => html`<span class="chip">${DEVLOG_MODULES[m]}</span>`)}</p>
            <ul class="changes">${r.changes.map(([type, m, text]) => html`<li>
              ${badge(CHANGE_TYPES[type], CHANGE_KIND[type])}<span>${text}${r.modules.length > 1 && !state.module ? html` <small class="muted">· ${DEVLOG_MODULES[m]}</small>` : ''}</span></li>`)}</ul>
            ${r.known?.length && !state.module ? html`<div class="known"><h3>Known issues</h3><ul>${r.known.map((k) => html`<li>${k}</li>`)}</ul></div>` : ''}
          </div>
        </article>`)
      : html`<div class="card empty"><p>No changes match.</p></div>`);
  }

  mount(el, html`
    <header class="page-head">
      <div><h1>Dev log</h1><p class="muted">Notes from the dev team on every build of LTDC ERP, newest first: ${DEVLOG.length} builds since ${fmtDate(DEVLOG.at(-1).date)}. Still in alpha, so expect rough edges.</p></div>
    </header>
    <section class="card about-card">
      <div class="card-head"><h2>Installed version</h2>${about.version === APP_VERSION ? badge('Up to date', 'green') : badge(`Server reports ${about.version}`, 'amber')}</div>
      <dl class="info-grid four">
        ${info('Version', html`<strong class="big-version">${versionLabel(about.version)}</strong>`)}
        ${info('Build', about.commit ? html`<span class="mono">${about.commit.slice(0, 7)}</span><small class="muted"> · ${about.channel}</small>` : about.channel)}
        ${info('Installed', about.installedAt ? when(about.installedAt) : '')}
        ${info('Running for', html`${uptime(about.startedAt)}<small class="muted"> · since ${when(about.startedAt)}</small>`)}
      </dl>
    </section>
    <section class="card">
      <div class="toolbar">
        <div class="filter-chips">
          <button type="button" class="chip-filter" data-module-filter="">All builds <em>${DEVLOG.length}</em></button>
          ${Object.entries(DEVLOG_MODULES).map(([k, v]) => html`<button type="button" class="chip-filter" data-module-filter="${k}">${v} <em>${count(k)}</em></button>`)}
        </div>
        <input type="search" id="q" placeholder="Search the log…" />
      </div>
    </section>
    <div id="releases" class="releases"></div>`);

  render();
  el.querySelectorAll('[data-module-filter]').forEach((b) => b.addEventListener('click', () => ((state.module = b.dataset.moduleFilter), render())));
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value), render()));
  markSeen();
}
