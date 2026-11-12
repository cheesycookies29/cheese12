// System → Audit log, after CORE ERP's (public/js/views/audit.js at the repository root): every
// sign-in and failed sign-in, every change by staff in any system (field by field where it can
// say), refused requests, and the Settings, Finance and Academic logs, newest first. Entries are
// appended and chained (server/audit.js); the page checks the chain and says if it was altered.
import { api } from '../api.js';
import { html, mount, badge, option, today, addDays } from '../ui.js';
import { icon } from '../icons.js';

const when = (iso) => new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const KIND_BADGE = { signin: 'gray', signout: 'gray', password: 'amber', account: 'blue', access: 'maroon', session: 'gray', settings: 'blue', change: 'green', refused: 'red', data: 'amber' };

export async function auditView(el, params, query) {
  const state = {
    from: query.from ?? addDays(today(), -30), to: query.to ?? today(), kind: query.kind || '', system: query.system || '',
    outcome: query.outcome || '', source: query.source || '', userId: query.userId || '', q: query.q || '', page: query.page || '',
  };
  const filters = () => Object.fromEntries(Object.entries(state).filter(([k, v]) => v && k !== 'page'));
  mount(el, html`
    <header class="page-head">
      <div><h1>Audit log</h1>
        <p class="muted">Who signed in and who failed to, every change by staff in every system, requests that were refused, and the Settings, Finance and Academic logs. Entries cannot be edited or deleted, and they are kept when a backup is restored. Passwords and what people type into forms are never recorded.</p></div>
      <div class="actions"><a class="btn" id="export" download>Export CSV</a></div>
    </header>
    <div id="check"></div>
    <section class="card">
      <form class="toolbar" id="filter">
        <label class="inline">From <input type="date" name="from" value="${state.from}" /></label>
        <label class="inline">To <input type="date" name="to" value="${state.to}" /></label>
        <select name="kind" aria-label="Area"></select>
        <select name="system" aria-label="System"></select>
        <select name="outcome" aria-label="Outcome">${[['', 'Any outcome'], ['ok', 'Done'], ['failed', 'Failed'], ['refused', 'Refused']].map(([k, l]) => option(k, l, state.outcome === k))}</select>
        <input type="search" name="q" placeholder="Search name, record, change, address…" value="${state.q}" />
      </form>
      <div id="audit-list" class="scroll-x"></div>
    </section>`);

  const form = el.querySelector('#filter');
  async function load() {
    const res = await api.get(`/api/system/audit?${new URLSearchParams({ ...filters(), ...(state.page ? { page: state.page } : {}) })}`);
    el.querySelector('#export').href = `/api/system/audit?${new URLSearchParams({ ...filters(), format: 'csv' })}`;
    const kindSel = form.querySelector('[name=kind]');
    if (!kindSel.options.length) {
      kindSel.innerHTML = [['', 'All areas'], ...Object.entries(res.labels.kinds)].map(([k, l]) => `<option value="${k}" ${k === state.kind ? 'selected' : ''}>${l}</option>`).join('');
      const seen = new Set();
      form.querySelector('[name=system]').innerHTML = [['', 'All systems'], ...Object.entries(res.labels.systems).filter(([k, l]) => k !== 'control' && !seen.has(l) && seen.add(l))].map(([k, l]) => `<option value="${k}" ${k === state.system ? 'selected' : ''}>${l}</option>`).join('');
    }
    mount(el.querySelector('#check'), res.check.ok
      ? html`<div class="notice ok">${icon('checkCircle')}<p><strong>Intact.</strong> All ${res.check.count.toLocaleString()} entries check out: none was changed, removed or reordered.</p></div>`
      : html`<div class="notice bad">${icon('flag')}<p><strong>The log was altered.</strong> Entry ${res.check.brokenAt}${res.check.at ? ` (${when(res.check.at)})` : ''} does not match the entries before it: the file was edited outside ATLAS. Keep a copy of <code>audit-log.jsonl</code> and investigate.</p></div>`);
    mount(el.querySelector('#audit-list'), res.entries.length
      ? html`<p class="muted small">${res.user ? html`For <strong>${res.user.name}</strong> (what they did, and what was done to their account). <a href="#/system/audit">Everyone</a> · ` : ''}${res.total > res.entries.length ? `Showing ${res.entries.length} of ${res.total.toLocaleString()}, newest first.` : `${res.total.toLocaleString()} entr${res.total === 1 ? 'y' : 'ies'}.`}</p>
        <table class="table audit-table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th></tr></thead>
          <tbody>${res.entries.map((e) => html`<tr class="${e.outcome !== 'ok' ? 'trail-bad' : ''}">
            <td data-label="When" class="nowrap">${when(e.at)}${e.seq ? html`<small class="muted block">#${e.seq}</small>` : ''}</td>
            <td data-label="Who"><strong>${e.actor || 'Not signed in'}</strong>${e.ip ? html`<small class="muted block mono">${e.ip}</small>` : ''}</td>
            <td data-label="What">${badge(res.labels.kinds[e.kind] || e.kind, KIND_BADGE[e.kind] || 'gray')} ${e.action}
              ${e.outcome !== 'ok' ? html` ${badge(e.outcome === 'refused' ? 'Refused' : 'Failed', 'red')}` : ''}
              ${e.changes?.length ? html`<ul class="audit-changes">${e.changes.map((c) => html`<li><b>${c.field}</b>: ${c.from || '(empty)'} → ${c.to || '(empty)'}</li>`)}</ul>` : ''}
              ${e.detail ? html`<small class="muted block">${e.detail}</small>` : ''}
              <small class="muted block">${res.labels.systems[e.system] || e.system}${e.source !== 'trail' ? ` · ${res.labels.sources[e.source]}` : ''}</small></td>
            <td data-label="Record">${e.target || html`<span class="muted">—</span>`}</td>
          </tr>`)}</tbody></table>
        ${res.pages > 1 ? html`<nav class="pager" aria-label="Pages">
          ${res.page > 1 ? html`<button type="button" class="btn sm" data-page="${res.page - 1}">${icon('chevronLeft', 14)} Newer</button>` : html`<span></span>`}
          <span class="muted small">Page ${res.page} of ${res.pages}</span>
          ${res.page < res.pages ? html`<button type="button" class="btn sm" data-page="${res.page + 1}">Older ${icon('chevronRight', 14)}</button>` : html`<span></span>`}</nav>` : ''}`
      : html`<div class="empty"><p>No entries match.</p></div>`);
    el.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
      state.page = b.dataset.page;
      load();
    }));
  }
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('change', (e) => {
    if (!e.target.name || e.target.name === 'q') return;
    state[e.target.name] = e.target.value;
    state.page = '';
    load();
  });
  let t;
  form.querySelector('[name=q]').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => ((state.q = e.target.value), (state.page = ''), load()), 250);
  });
  await load();
}
