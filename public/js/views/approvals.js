// Approval Center: requests waiting for this account (as an immediate supervisor, a named approver
// or HR), the ones it already decided, and its team's requests. Approve one or many at once;
// reject or return for revision with remarks, which the employee sees.
import { api } from '../api.js';
import { ctx } from '../state.js';
import { html, mount, modal, toast, fmtDate, badge } from '../ui.js';
import { statusBadge, kindBadge, dateRange, certificateCell } from './leave.js';
import { requestDetail, progressText, daysText } from '../requests.js';
import { viewAttachment } from '../attachments.js';

const TABS = { pending: 'For my approval', processed: 'Processed', team: 'My team' };
const changed = () => window.dispatchEvent(new Event('requests:changed'));

// Approve, reject or return one request; remarks are required to reject or return.
export function decide(r, action, after) {
  const label = { approve: 'Approve', reject: 'Reject', return: 'Return for revision' }[action];
  modal({
    title: `${label}: ${r.typeName}`,
    subtitle: `${r.employeeName} · ${r.startDate === r.endDate ? fmtDate(r.startDate) : `${fmtDate(r.startDate)} to ${fmtDate(r.endDate)}`} · ${daysText(r.days)}`,
    submitLabel: label,
    body: html`<div class="stack tight">
      ${r.hrOverride && action === 'approve' ? html`<p class="notice small">It is not your turn on this request's route. As HR, approving it now decides it for every level still to come.</p>` : ''}
      ${r.overflowDays && action === 'approve' ? html`<p class="notice small">${daysText(r.overflowDays)} of this leave ${r.overflowDays === 1 ? 'is' : 'are'} beyond the remaining credits and will be recorded as Leave Without Pay.</p>` : ''}
      <label class="field"><span>${action === 'approve' ? 'Remarks (optional)' : action === 'reject' ? 'Reason for rejecting (the employee sees this)' : 'What should the employee change?'}</span>
        <textarea name="note" rows="3" maxlength="500" ${action === 'approve' ? '' : 'required'}></textarea></label>
    </div>`,
    onSubmit: async (f) => {
      const res = await api.post(`/api/approvals/${r.id}/${action}`, { note: f.note.value });
      toast(action === 'approve' ? (res.status === 'approved' ? 'Approved. The days are in the attendance record.' : `Approved. Now waiting on ${res.waitingOn.join(' or ')}.`) : action === 'reject' ? 'Rejected.' : 'Returned to the employee.');
      changed();
      after?.();
    },
  });
}

export async function approvalsView(el, _params, query) {
  const tab = TABS[query.tab] ? query.tab : 'pending';
  const summary = await api.get('/api/approvals/summary');
  mount(el, html`
    <header class="page-head">
      <div><h1>Approvals</h1><p class="muted">Leave, work-from-home and official-business requests${summary.team ? ` for your team of ${summary.team}` : ''}. Requests come to you in the order set by the approval flow.</p></div>
    </header>
    <nav class="tabs">${Object.entries(TABS).map(([k, v]) => html`<a href="#/approvals?tab=${k}" class="${k === tab ? 'active' : ''}">${v}${k === 'pending' && summary.pending ? html` <span class="count">${summary.pending}</span>` : ''}</a>`)}</nav>
    <section class="card scroll-x">
      <div class="toolbar pad"><input type="search" id="q" placeholder="Search name or request…" /><span class="spacer"></span>
        ${tab === 'pending' ? html`<button class="btn" id="bulk" disabled>Approve selected</button>` : ''}</div>
      <div id="list"></div>
    </section>`);
  let rows = [];
  let q = '';
  const selected = new Set();
  async function load() {
    rows = await api.get(`/api/approvals?tab=${tab}`);
    draw();
  }
  function draw() {
    const shown = rows.filter((r) => !q || `${r.employeeName} ${r.typeName} ${r.reason}`.toLowerCase().includes(q));
    const bulk = el.querySelector('#bulk');
    if (bulk) {
      bulk.disabled = !selected.size;
      bulk.textContent = selected.size ? `Approve ${selected.size} selected` : 'Approve selected';
    }
    mount(el.querySelector('#list'), shown.length ? html`<table class="table clickable stackable appr-table">
      <thead><tr>${tab === 'pending' ? html`<th class="check"><input type="checkbox" id="all" aria-label="Select all" ${selected.size && selected.size === shown.length ? 'checked' : ''} /></th>` : ''}<th>Employee</th><th>Request</th><th>Dates</th><th class="num">Days</th><th>Status</th><th></th></tr></thead>
      <tbody>${shown.map((r) => html`<tr data-open="${r.id}">
        ${tab === 'pending' ? html`<td class="check"><input type="checkbox" data-pick="${r.id}" ${selected.has(r.id) ? 'checked' : ''} aria-label="Select ${r.employeeName}" /></td>` : ''}
        <td><strong>${r.employeeName}</strong><small>${[r.employeeNo, r.department].filter(Boolean).join(' · ')}</small></td>
        <td>${kindBadge(r)}${r.destination ? html`<small>${r.destination}</small>` : ''}${certificateCell(r, `/api/approvals/${r.id}/attachment`)}</td>
        <td>${dateRange(r)}<small>Filed ${fmtDate(r.filedAt.slice(0, 10))}</small></td>
        <td class="num">${r.days}${r.overflowDays ? html`<small>${r.overflowDays} unpaid</small>` : ''}</td>
        <td>${statusBadge(r.status)}${r.status === 'pending' && r.yourTurn ? html`<small>${badge('Your turn', 'amber')}</small>` : progressText(r)}</td>
        <td class="row-actions">${r.status === 'pending' && r.canDecide ? html`<button class="btn small-btn primary" data-act="approve" data-id="${r.id}">Approve</button><button class="link" data-act="return" data-id="${r.id}">Return</button><button class="link danger" data-act="reject" data-id="${r.id}">Reject</button>` : ''}</td>
      </tr>`)}</tbody></table>`
      : html`<div class="empty"><p>${tab === 'pending' ? 'Nothing is waiting for your approval.' : tab === 'team' ? 'No requests from your team yet.' : 'You have not decided any requests yet.'}</p></div>`);
  }
  el.querySelector('#q').addEventListener('input', (e) => ((q = e.target.value.trim().toLowerCase()), draw()));
  el.querySelector('#list').addEventListener('change', (e) => {
    if (e.target.id === 'all') {
      selected.clear();
      if (e.target.checked) rows.forEach((r) => r.canDecide && selected.add(r.id));
      return draw();
    }
    const id = e.target.dataset.pick;
    if (!id) return;
    if (e.target.checked) selected.add(id);
    else selected.delete(id);
    draw();
  });
  el.querySelector('#list').addEventListener('click', async (e) => {
    const cert = e.target.closest('[data-cert-url]');
    if (cert) return viewAttachment(cert.dataset.certUrl).catch((err) => toast(err.message, 'error'));
    const btn = e.target.closest('[data-act]');
    const byId = (id) => rows.find((r) => r.id === id);
    if (btn) return decide(byId(btn.dataset.id), btn.dataset.act, load);
    const row = e.target.closest('tr[data-open]');
    if (!row || e.target.closest('input, button, a')) return;
    const r = await api.get(`/api/approvals/${row.dataset.open}`);
    const { close } = requestDetail({ ...r, hrOverride: byId(r.id)?.hrOverride }, {
      certUrl: `/api/approvals/${r.id}/attachment`, balance: r.balance,
      actions: r.status === 'pending' && r.canDecide ? html`<button type="button" class="btn danger ghost" data-d="reject">Reject</button><button type="button" class="btn" data-d="return">Return for revision</button><button type="button" class="btn primary" data-d="approve">Approve</button>` : '',
    });
    document.querySelectorAll('.req-modal [data-d]').forEach((b) => b.addEventListener('click', () => (close(), decide({ ...r, hrOverride: byId(r.id)?.hrOverride }, b.dataset.d, load))));
  });
  el.querySelector('#bulk')?.addEventListener('click', () => {
    const ids = [...selected];
    modal({
      title: `Approve ${ids.length} request${ids.length === 1 ? '' : 's'}`, submitLabel: 'Approve all',
      body: html`<label class="field"><span>Remarks (optional)</span><textarea name="note" rows="2"></textarea></label>`,
      onSubmit: async (f) => {
        const res = await api.post('/api/approvals/bulk', { ids, note: f.note.value });
        selected.clear();
        toast(res.failed.length ? `${res.approved} approved; ${res.failed.length} could not be: ${res.failed[0].error}` : `${res.approved} approved.`, res.failed.length ? 'error' : 'ok');
        changed();
        load();
      },
    });
  });
  if (!ctx.user) return;
  await load();
}
