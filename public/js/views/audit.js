// Audit log: who viewed or changed personal data, payroll and settings, newest first. Entries are
// appended and chained (server/audit.js); the page checks the chain and says if it was altered.
import { api } from '../api.js';
import { AUDIT_AREAS, actionLabel, areaOf } from '/shared/audit.js';
import { html, mount, badge, downloadFile, toCsv, today, addDays } from '../ui.js';

const when = (iso) => new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const AREA_BADGE = { auth: 'gray', user: 'blue', employee: 'maroon-soft', payroll: 'green', data: 'amber', settings: 'blue', attendance: 'gray', leave: 'blue', holiday: 'gray' };

export async function auditView(el, _params, query) {
  const state = { from: query.from || addDays(today(), -30), to: query.to || today(), userId: query.userId || '', area: query.area || '', q: query.q || '' };
  const check = await api.get('/api/audit/verify');
  mount(el, html`
    <header class="page-head">
      <div><h1>Audit log</h1>
        <p class="muted">Who viewed or changed personal data, payroll, attendance, leave and settings, and every sign-in. Entries cannot be edited or deleted, and they are kept when data is restored or erased. Government ID and bank numbers appear masked.</p></div>
      <div class="actions"><button class="btn" id="export">Export CSV</button></div>
    </header>
    ${check.ok
      ? html`<div class="notice ok"><p><strong>Intact.</strong> All ${check.count} entries check out: none was changed, removed or reordered.</p></div>`
      : html`<div class="notice bad"><p><strong>The log was altered.</strong> Entry ${check.brokenAt}${check.at ? ` (${when(check.at)})` : ''} does not match the entries before it: the file was edited outside CORE. Keep a copy and investigate.</p></div>`}
    <section class="card">
      <div class="toolbar">
        <label class="inline">From <input type="date" id="f-from" value="${state.from}" /></label>
        <label class="inline">To <input type="date" id="f-to" value="${state.to}" /></label>
        <select id="f-area"><option value="">All areas</option>${Object.entries(AUDIT_AREAS).map(([k, v]) => html`<option value="${k}" ${k === state.area ? 'selected' : ''}>${v}</option>`)}</select>
        <select id="f-user"><option value="">Everyone</option></select>
        <input type="search" id="f-q" placeholder="Search name, record, change…" value="${state.q}" />
      </div>
      <div id="audit-list" class="scroll-x"></div>
    </section>`);

  let entries = [];
  async function load() {
    const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v)).toString();
    const res = await api.get(`/api/audit?${qs}`);
    entries = res.entries;
    const sel = el.querySelector('#f-user');
    if (sel.options.length === 1) for (const u of res.users) sel.add(new Option(u.name, u.id, false, u.id === state.userId));
    mount(el.querySelector('#audit-list'), entries.length
      ? html`<p class="muted small">${res.total > entries.length ? `Showing the newest ${entries.length} of ${res.total}.` : `${res.total} entr${res.total === 1 ? 'y' : 'ies'}.`}</p>
        <table class="table audit-table stackable">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th></tr></thead>
          <tbody>${entries.map((e) => html`<tr>
            <td>${when(e.at)}<small class="muted">#${e.seq}</small></td>
            <td><strong>${e.userName}</strong>${e.ip ? html`<small class="muted">${e.ip}</small>` : ''}</td>
            <td>${badge(AUDIT_AREAS[areaOf(e.action)] || areaOf(e.action), AREA_BADGE[areaOf(e.action)] || 'gray')} ${actionLabel(e.action)}
              ${e.changes?.length ? html`<ul class="audit-changes">${e.changes.map((c) => html`<li><b>${c.field}</b>: ${c.from || '(empty)'} → ${c.to || '(empty)'}</li>`)}</ul>` : ''}
              ${e.note ? html`<small class="muted">${e.note}</small>` : ''}</td>
            <td>${e.label || html`<span class="muted">—</span>`}</td>
          </tr>`)}</tbody></table>`
      : html`<div class="empty"><p>No entries match.</p></div>`);
  }
  const on = (sel, key, ev = 'change') => el.querySelector(sel).addEventListener(ev, (e) => ((state[key] = e.target.value), load()));
  on('#f-from', 'from');
  on('#f-to', 'to');
  on('#f-area', 'area');
  on('#f-user', 'userId');
  let t;
  el.querySelector('#f-q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => ((state.q = e.target.value), load()), 250);
  });
  el.querySelector('#export').addEventListener('click', () => {
    const rows = [['#', 'When', 'User', 'Role', 'IP address', 'Action', 'Record', 'Changes', 'Note'],
      ...entries.map((e) => [e.seq, e.at, e.userName, e.role, e.ip, actionLabel(e.action), e.label, (e.changes || []).map((c) => `${c.field}: ${c.from} -> ${c.to}`).join('; '), e.note])];
    downloadFile(`audit-log-${state.from}-to-${state.to}.csv`, toCsv(rows));
  });
  await load();
}
