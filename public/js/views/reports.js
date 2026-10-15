// Problem reports: employees report malfunctioning, damaged or lost equipment
// assigned to them; IT and administrators review them and reply.
import { api } from '../api.js';
import { can } from '../state.js';
import { ISSUE_TYPES, ISSUE_IMPACT, ISSUE_STATUS, ACTIVE_ISSUE } from '/shared/assets.js';
import { html, mount, fmtDate, badge, toast, modal, downloadFile, toCsv, today } from '../ui.js';
import { statusBadge, issueStatusBadge, impactBadge } from './assets.js';

export const when = (iso) => new Date(iso).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const lastNote = (r) => [...r.updates].reverse().find((u) => u.note)?.note || '';

// Reported, then each status change or note from IT, oldest first.
export const reportTimeline = (r) => html`<ul class="timeline">
  <li class="ev-issue"><time>${when(r.reportedAt)}</time><div><strong>Reported</strong><span>by ${r.reportedBy.name}</span></div></li>
  ${r.updates.map((u) => html`<li class="ev-${u.status || 'note'}"><time>${when(u.at)}</time>
    <div><strong>${u.status ? `Marked ${ISSUE_STATUS[u.status].toLowerCase()}` : 'Note from IT'}</strong><span>by ${u.by}</span>${u.note ? html`<em>“${u.note}”</em>` : ''}</div></li>`)}
</ul>`;

const changed = () => window.dispatchEvent(new Event('reports:changed'));

// ---------- Employee: report a problem ----------

export function openReportProblem(asset, onDone) {
  modal({
    title: `Report a problem: ${asset.assetTag}`,
    submitLabel: 'Send report',
    body: html`<p class="muted small">${asset.name}${asset.serialNumber ? ` · S/N ${asset.serialNumber}` : ''}</p>
      <div class="grid two">
        <label class="field"><span>What's wrong?</span><select name="type" required>${Object.entries(ISSUE_TYPES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
        <label class="field"><span>Noticed on</span><input type="date" name="noticedOn" value="${today()}" max="${today()}" /></label>
        <label class="field span-2"><span>Can you still work on it?</span><select name="impact" required>${Object.entries(ISSUE_IMPACT).map(([k, v]) => html`<option value="${k}" ${k === 'limited' ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label class="field span-2"><span>Describe the problem</span>
          <textarea name="description" rows="5" maxlength="2000" required placeholder="What happens, since when, and what you were doing. Include any error message, e.g. &quot;Screen flickers and goes black after 10 minutes&quot;."></textarea></label>
      </div>
      <p class="muted small">IT is notified in the system and will update you here. For a lost or stolen device, also tell your manager right away.</p>`,
    onSubmit: async (f) => {
      const r = await api.post('/api/me/asset-reports', { assetId: asset.id, ...Object.fromEntries(new FormData(f)) });
      toast(`Report ${r.number} sent to IT.`);
      onDone();
    },
  });
}

// ---------- IT / admin: list ----------

const FILTERS = { active: 'Open (new and being checked)', open: 'New', in_progress: 'Being checked', resolved: 'Resolved', closed: 'Closed', all: 'All reports' };

export async function reportsView(el, _params, query) {
  const reports = await api.get('/api/asset-reports');
  const state = { status: FILTERS[query.status] ? query.status : 'active', type: '', q: '' };
  const counts = Object.fromEntries(Object.keys(ISSUE_STATUS).map((s) => [s, reports.filter((r) => r.status === s).length]));

  const rows = () => {
    const q = state.q.toLowerCase();
    return reports.filter((r) =>
      (state.status === 'all' || (state.status === 'active' ? ACTIVE_ISSUE.includes(r.status) : r.status === state.status)) &&
      (!state.type || r.type === state.type) &&
      (!q || [r.number, r.assetTag, r.assetName, r.reportedBy.name, r.reportedBy.department, r.description].join(' ').toLowerCase().includes(q)));
  };

  function render() {
    const list = rows();
    mount(el.querySelector('#list'), list.length
      ? html`<table class="table clickable">
          <thead><tr><th>No.</th><th>Reported</th><th>Equipment</th><th>Reported by</th><th>Problem</th><th>Can work?</th><th>Status</th></tr></thead>
          <tbody>${list.map((r) => html`<tr data-id="${r.id}">
            <td><a class="mono" href="#/assets/reports/${r.id}">${r.number}</a></td>
            <td>${fmtDate(r.reportedAt.slice(0, 10))}</td>
            <td><span class="mono">${r.assetTag}</span><small>${r.assetName}</small></td>
            <td>${r.reportedBy.name}<small>${r.reportedBy.department}</small></td>
            <td>${ISSUE_TYPES[r.type]}<small class="clip">${r.description}</small></td>
            <td>${impactBadge(r.impact)}</td>
            <td>${issueStatusBadge(r.status)}</td></tr>`)}</tbody>
        </table>`
      : html`<div class="empty"><p>${reports.length ? 'No reports match.' : 'No problem reports yet. Employees report problems from My Assets.'}</p></div>`);
    el.querySelectorAll('#list tbody tr').forEach((tr) => tr.addEventListener('click', (e) => {
      if (!e.target.closest('a')) location.hash = `#/assets/reports/${tr.dataset.id}`;
    }));
  }

  mount(el, html`
    <header class="page-head">
      <div><h1>Problem reports</h1><p class="muted">Malfunctioning, damaged or lost equipment reported by employees: ${counts.open} new, ${counts.in_progress} being checked.</p></div>
      <div class="actions"><button class="btn" id="export">Export CSV</button></div>
    </header>
    <section class="card scroll-x">
      <div class="toolbar pad">
        <input type="search" id="q" placeholder="Search number, tag, employee or text…" />
        <select id="f-status">${Object.entries(FILTERS).map(([k, v]) => html`<option value="${k}" ${k === state.status ? 'selected' : ''}>${v}</option>`)}</select>
        <select id="f-type"><option value="">All problem types</option>${Object.entries(ISSUE_TYPES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
      </div>
      <div id="list"></div>
    </section>`);
  render();
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value), render()));
  el.querySelector('#f-status').addEventListener('change', (e) => ((state.status = e.target.value), render()));
  el.querySelector('#f-type').addEventListener('change', (e) => ((state.type = e.target.value), render()));
  el.querySelector('#export').addEventListener('click', () =>
    downloadFile(`problem-reports-${today()}.csv`, toCsv([
      ['Report No', 'Reported On', 'Asset Tag', 'Equipment', 'Category', 'Serial Number', 'Reported By', 'Employee No', 'Department',
        'Problem Type', 'Can Work?', 'Noticed On', 'Description', 'Status', 'Last Update', 'Latest Note from IT', 'Closed On'],
      ...rows().map((r) => [r.number, r.reportedAt.slice(0, 10), r.assetTag, r.assetName, r.category, r.serialNumber, r.reportedBy.name, r.reportedBy.employeeNo,
        r.reportedBy.department, ISSUE_TYPES[r.type], ISSUE_IMPACT[r.impact], r.noticedOn, r.description, ISSUE_STATUS[r.status],
        r.updatedAt.replace('T', ' ').slice(0, 16), lastNote(r), r.closedAt?.slice(0, 10) || '']),
    ])),
  );
}

// ---------- IT / admin: one report ----------

export async function reportDetailView(el, { id }) {
  const r = await api.get(`/api/asset-reports/${id}`);
  const edit = can('assets.edit');
  const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || html`<span class="muted">—</span>`}</dd></div>`;
  const a = r.asset;

  mount(el, html`
    <header class="page-head">
      <div><a class="back" href="#/assets/reports">← Problem reports</a>
        <p class="tag-line mono">${r.number}</p>
        <h1>${ISSUE_TYPES[r.type]}: ${r.assetName} ${issueStatusBadge(r.status)}</h1>
        <p class="muted">Reported ${when(r.reportedAt)} by ${r.reportedBy.name}</p></div>
      <div class="actions">${a ? html`<a class="btn" href="#/assets/item/${a.id}">Open asset ${a.assetTag}</a>` : ''}</div>
    </header>
    <div class="cols wide-left">
      <section class="card">
        <h2>The problem</h2>
        <p class="report-text">${r.description}</p>
        <dl class="info-grid">${info('Problem type', ISSUE_TYPES[r.type])}${info('Can they work on it?', impactBadge(r.impact))}${info('Noticed on', fmtDate(r.noticedOn))}</dl>
      </section>
      <section class="card">
        <h2>Reported by</h2>
        <p class="holder-name">${r.reportedBy.name}</p>
        <p class="muted">${[r.reportedBy.employeeNo, r.reportedBy.department].filter(Boolean).join(' · ')}</p>
        <h2 class="spaced">Equipment</h2>
        ${a
          ? html`<p><a class="mono" href="#/assets/item/${a.id}">${a.assetTag}</a> ${a.name}</p>
              <dl class="info-grid">${info('Asset status', statusBadge(a.status))}${info('Holder', a.assignedTo?.name)}${info('Serial number', a.serialNumber)}
                ${info('Warranty ends', a.warrantyEnd ? html`${fmtDate(a.warrantyEnd)}${a.warrantyEnd < today() ? html` ${badge('Expired', 'gray')}` : html` ${badge('Under warranty', 'green')}`}` : '')}</dl>`
          : html`<p class="muted">${r.assetTag} ${r.assetName} (no longer in the register)</p>`}
      </section>
    </div>
    ${edit
      ? html`<section class="card">
          <h2>Update the employee</h2>
          <form id="update" class="grid two" novalidate>
            <label class="field"><span>Status</span><select name="status">${Object.entries(ISSUE_STATUS).map(([k, v]) => html`<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`)}</select></label>
            <label class="field span-2"><span>Note to ${r.reportedBy.name.split(' ')[0]} (they see this in My Assets)</span>
              <textarea name="note" rows="3" maxlength="1000" placeholder="e.g. Please bring it to the IT room at 2 pm; a loaner is ready."></textarea></label>
            <p class="form-error span-2" hidden></p>
            <div class="actions span-2"><button class="btn primary" type="submit">Save update</button>
              ${a?.status === 'assigned' ? html`<small class="muted">To take the laptop in for repair, open the asset and use Return → In repair.</small>` : ''}</div>
          </form>
        </section>`
      : ''}
    <section class="card"><h2>Timeline</h2>${reportTimeline(r)}</section>`);

  el.querySelector('#update')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = e.target.querySelector('.form-error');
    try {
      await api.post(`/api/asset-reports/${r.id}/update`, Object.fromEntries(new FormData(e.target)));
      toast('Update saved.');
      changed();
      reportDetailView(el, { id });
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });
}
