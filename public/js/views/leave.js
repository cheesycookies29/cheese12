// Leave & Requests: approvals, leave balances and credits, leave types.
import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { REQUEST_STATUS } from '/shared/leave.js';
import { html, mount, fmtDate, badge, toast, modal, confirmDialog } from '../ui.js';

const STATUS_BADGE = { pending: 'amber', approved: 'green', rejected: 'gray', cancelled: 'gray' };
export const statusBadge = (s) => badge(REQUEST_STATUS[s] || s, STATUS_BADGE[s]);
export const kindBadge = (r) => (r.kind === 'remote' ? badge('Remote work', 'blue') : badge(r.typeName, 'maroon-soft'));
export const dateRange = (r) => (r.startDate === r.endDate ? fmtDate(r.startDate) : `${fmtDate(r.startDate, { month: 'short', day: 'numeric' })} – ${fmtDate(r.endDate)}`);

const TABS = [
  ['requests', 'Requests'],
  ['balances', 'Leave balances'],
  ['types', 'Leave types'],
];

export async function leaveView(el, _params, query) {
  const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'requests';
  mount(el, html`
    <header class="page-head">
      <div><h1>Leave &amp; Requests</h1><p class="muted">${can('leave.approve') ? 'Approve leave and remote-work requests, and manage leave credits.' : 'Review requests and manage leave credits. HR Managers and Administrators approve requests.'}</p></div>
    </header>
    <nav class="tabs">${TABS.map(([k, label]) => html`<a href="#/leave?tab=${k}" class="${k === tab ? 'active' : ''}">${label}</a>`)}</nav>
    <div id="tab-body"></div>`);
  const body = el.querySelector('#tab-body');
  if (tab === 'requests') return requestsTab(body, query);
  if (tab === 'balances') return balancesTab(body, query);
  return typesTab(body);
}

// ---------- Requests ----------

async function requestsTab(el, query) {
  const state = { status: query.status ?? 'pending' };

  async function load() {
    const list = await api.get(`/api/requests${state.status ? `?status=${state.status}` : ''}`);
    mount(el, html`
      <section class="card">
        <div class="toolbar">
          <select id="f-status">
            ${[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['', 'All']].map(([v, l]) => html`<option value="${v}" ${v === state.status ? 'selected' : ''}>${l}</option>`)}
          </select>
          <span class="muted small">${list.length} request${list.length === 1 ? '' : 's'}</span>
        </div>
        ${list.length
          ? html`<table class="table">
              <thead><tr><th>Employee</th><th>Request</th><th>Dates</th><th class="num">Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
              <tbody>${list.map((r) => html`<tr>
                <td><strong>${r.employeeName}</strong><small>${r.employeeNo}</small></td>
                <td>${kindBadge(r)}</td>
                <td>${dateRange(r)}<small>Filed ${fmtDate(r.filedAt.slice(0, 10))}</small></td>
                <td class="num">${r.days}</td>
                <td class="notes">${r.reason}</td>
                <td>${statusBadge(r.status)}${r.decidedByName ? html`<small>by ${r.decidedByName}${r.decisionNote ? html`: “${r.decisionNote}”` : ''}</small>` : ''}${r.cancelledByName ? html`<small>cancelled by ${r.cancelledByName}</small>` : ''}</td>
                <td class="row-actions">${can('leave.approve')
                  ? r.status === 'pending'
                    ? html`<button class="btn primary small-btn" data-approve="${r.id}">Approve</button> <button class="btn small-btn" data-reject="${r.id}">Reject</button>`
                    : r.status === 'approved' ? html`<button class="link danger" data-cancel="${r.id}">Cancel</button>` : ''
                  : ''}</td>
              </tr>`)}</tbody>
            </table>`
          : html`<div class="empty"><p>${state.status === 'pending' ? 'No requests waiting for approval.' : 'No requests.'}</p></div>`}
      </section>`);

    el.querySelector('#f-status').addEventListener('change', (e) => {
      state.status = e.target.value;
      load();
    });
    el.querySelector('tbody')?.addEventListener('click', (e) => {
      const t = e.target;
      const r = list.find((x) => x.id === (t.dataset.approve || t.dataset.reject || t.dataset.cancel));
      if (!r) return;
      const action = t.dataset.approve ? 'approve' : t.dataset.reject ? 'reject' : 'cancel';
      const what = `${r.employeeName}: ${r.typeName}, ${dateRange(r)} (${r.days} day${r.days === 1 ? '' : 's'})`;
      const { form } = modal({
        title: { approve: 'Approve request', reject: 'Reject request', cancel: 'Cancel approved request' }[action],
        submitLabel: { approve: 'Approve', reject: 'Reject', cancel: 'Cancel request' }[action],
        body: html`<p><strong>${what}</strong></p>
          ${r.reason ? html`<p class="muted">“${r.reason}”</p>` : ''}
          <p class="muted small">${{
            approve: r.kind === 'remote' ? 'Each work day in the range is marked as remote work in the DTR and counts as a full day.' : 'Each work day in the range is recorded as leave in the DTR and deducted from the balance.',
            reject: 'The employee will see the rejection and your note.',
            cancel: 'The leave or remote-work days this request added to the DTR are removed, and leave credits are returned.',
          }[action]}</p>
          <label class="field"><span>Note to the employee (optional)</span><input name="note" maxlength="500" /></label>`,
        onSubmit: async (f) => {
          await api.post(`/api/requests/${r.id}/${action}`, { note: new FormData(f).get('note') });
          toast({ approve: 'Request approved.', reject: 'Request rejected.', cancel: 'Request cancelled.' }[action]);
          window.dispatchEvent(new Event('requests:changed'));
          load();
        },
      });
      if (action !== 'approve') form.querySelector('[type=submit]').classList.add('danger');
    });
  }
  await load();
}

// ---------- Balances ----------

async function balancesTab(el, query) {
  const thisYear = new Date().getFullYear();
  const state = { year: Number(query.year) || thisYear };

  async function load() {
    const rows = await api.get(`/api/leave-balances?year=${state.year}`);
    // Show leave types that have a limit for someone this year, plus all tracked active ones.
    const types = ctx.leaveTypes.filter((t) => t.active && (t.annualCredits != null || rows.some((r) => r.balances.find((b) => b.leaveTypeId === t.id)?.overridden)));
    mount(el, html`
      <section class="card scroll-x">
        <div class="toolbar pad">
          <label class="inline">Year <select id="f-year">${[thisYear - 1, thisYear, thisYear + 1].map((y) => html`<option ${y === state.year ? 'selected' : ''}>${y}</option>`)}</select></label>
          <span class="muted small">Remaining of credits. Click a cell to change an employee's credits for the year.</span>
        </div>
        ${rows.length
          ? html`<table class="table balances">
              <thead><tr><th>Employee</th>${types.map((t) => html`<th class="center" title="${t.name}">${t.code}<small>${t.annualCredits ?? '—'} / yr</small></th>`)}</tr></thead>
              <tbody>${rows.map((r) => html`<tr>
                <td><strong>${r.name}</strong><small>${r.employeeNo}</small></td>
                ${types.map((t) => {
                  const b = r.balances.find((x) => x.leaveTypeId === t.id);
                  const low = b.remaining !== null && b.remaining <= 0;
                  return html`<td class="center"><button class="cell-btn ${low ? 'low' : ''} ${b.overridden ? 'override' : ''}" data-emp="${r.employeeId}" data-type="${t.id}">
                    <strong>${b.remaining ?? '∞'}</strong><span>/ ${b.credits ?? '—'}</span>
                    ${b.used || b.pending ? html`<small>${b.used} used${b.pending ? `, ${b.pending} pending` : ''}</small>` : ''}
                  </button></td>`;
                })}
              </tr>`)}</tbody>
            </table>
            <p class="muted small pad">Used days are counted from leave recorded in the DTR. A gold outline means the credits were changed for that employee.</p>`
          : html`<div class="empty"><p>No active employees.</p></div>`}
      </section>`);

    el.querySelector('#f-year').addEventListener('change', (e) => {
      state.year = Number(e.target.value);
      load();
    });
    el.querySelector('tbody')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-emp]');
      if (!btn) return;
      const row = rows.find((r) => r.employeeId === btn.dataset.emp);
      const b = row.balances.find((x) => x.leaveTypeId === btn.dataset.type);
      const type = ctx.leaveTypes.find((t) => t.id === b.leaveTypeId);
      modal({
        title: `${b.name}: ${row.name}`,
        submitLabel: 'Save credits',
        body: html`<p class="muted small">${state.year} · used ${b.used} · pending ${b.pending} · default ${type.annualCredits ?? 'no limit'}</p>
          <label class="field"><span>Credits for ${state.year} (days)</span><input type="number" name="credits" min="0" max="366" step="0.5" value="${b.overridden ? b.credits : ''}" placeholder="${type.annualCredits ?? 'No limit'}" />
          <small class="muted">Leave blank to use the default for ${b.name}. Use this for carry-over, prorated new hires or adjustments.</small></label>`,
        onSubmit: async (f) => {
          const v = new FormData(f).get('credits');
          await api.put('/api/leave-credits', { employeeId: row.employeeId, year: state.year, leaveTypeId: b.leaveTypeId, credits: v === '' ? null : Number(v) });
          toast('Leave credits updated.');
          load();
        },
      });
    });
  }
  await load();
}

// ---------- Types ----------

function typeForm(t = {}) {
  return html`<div class="grid two">
    <label class="field"><span>Code</span><input name="code" value="${t.code || ''}" maxlength="8" placeholder="e.g. BL" required /></label>
    <label class="field"><span>Name</span><input name="name" value="${t.name || ''}" placeholder="e.g. Birthday Leave" required /></label>
    <label class="field"><span>Annual credits (days)</span><input type="number" name="annualCredits" min="0" max="366" step="0.5" value="${t.annualCredits ?? ''}" /><small class="muted">Blank = no limit (not tracked).</small></label>
    <div class="field"><span>Pay</span>
      <label class="check"><input type="checkbox" name="paid" ${t.paid === false ? '' : 'checked'} /> Paid leave</label>
      <small class="muted">Unpaid leave is deducted like an absence.</small></div>
    <label class="field check span-2"><input type="checkbox" name="active" ${t.active === false ? '' : 'checked'} /> <span>Active (employees can file it)</span></label>
  </div>`;
}

async function typesTab(el) {
  async function load() {
    await ctx.refreshLeaveTypes();
    const types = ctx.leaveTypes;
    mount(el, html`
      <section class="card">
        <div class="toolbar"><button class="btn primary" id="add-type">+ Add leave type</button></div>
        <table class="table">
          <thead><tr><th>Code</th><th>Name</th><th>Pay</th><th class="num">Annual credits</th><th>Status</th><th></th></tr></thead>
          <tbody>${types.map((t) => html`<tr>
            <td><strong>${t.code}</strong></td><td>${t.name}</td>
            <td>${t.paid ? badge('Paid', 'green') : badge('Unpaid', 'gray')}</td>
            <td class="num">${t.annualCredits ?? 'No limit'}</td>
            <td>${t.active ? badge('Active', 'green') : badge('Inactive', 'gray')}</td>
            <td class="row-actions"><button class="link" data-edit="${t.id}">Edit</button><button class="link danger" data-delete="${t.id}">Delete</button></td>
          </tr>`)}</tbody>
        </table>
        <p class="muted small">Defaults follow common Philippine practice (Service Incentive Leave is at least 5 days under the Labor Code; maternity, paternity and solo parent leave follow RA 11210, RA 8187 and RA 11861). Adjust to company policy.</p>
      </section>`);

    const read = (f) => {
      const fd = new FormData(f);
      return { code: fd.get('code'), name: fd.get('name'), annualCredits: fd.get('annualCredits'), paid: fd.has('paid'), active: fd.has('active') };
    };
    el.querySelector('#add-type').addEventListener('click', () =>
      modal({ title: 'Add leave type', body: typeForm(), submitLabel: 'Add', onSubmit: async (f) => { await api.post('/api/leave-types', read(f)); toast('Leave type added.'); load(); } }),
    );
    el.querySelector('tbody').addEventListener('click', async (e) => {
      const t = types.find((x) => x.id === (e.target.dataset.edit || e.target.dataset.delete));
      if (!t) return;
      if (e.target.dataset.edit) {
        modal({ title: `Edit ${t.name}`, body: typeForm(t), onSubmit: async (f) => { await api.put(`/api/leave-types/${t.id}`, read(f)); toast('Leave type saved.'); load(); } });
      } else if (await confirmDialog(`Delete ${t.name}? Types that were already used can only be made inactive.`)) {
        try {
          await api.del(`/api/leave-types/${t.id}`);
          toast('Leave type deleted.');
          load();
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    });
  }
  await load();
}
