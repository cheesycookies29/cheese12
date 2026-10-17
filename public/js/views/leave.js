// Leave & Requests: approvals, leave balances and credits, leave types.
import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { REQUEST_STATUS } from '/shared/leave.js';
import { html, mount, fmtDate, badge, toast, modal, confirmDialog, today } from '../ui.js';

const STATUS_BADGE = { pending: 'amber', approved: 'green', rejected: 'gray', cancelled: 'gray' };
export const statusBadge = (s) => badge(REQUEST_STATUS[s] || s, STATUS_BADGE[s]);
export const kindBadge = (r) => (r.kind === 'remote' ? badge('Remote work', 'blue') : badge(r.typeName, 'maroon-soft'));
export const dateRange = (r) => (r.startDate === r.endDate ? fmtDate(r.startDate) : `${fmtDate(r.startDate, { month: 'short', day: 'numeric' })} – ${fmtDate(r.endDate)}`);

const TABS = [
  ['requests', 'Requests'],
  ['balances', 'Leave balances'],
  ['employee', 'Employee leave', 'leave.adjust'],
  ['types', 'Leave types'],
];

export async function leaveView(el, _params, query) {
  const tabs = TABS.filter(([, , perm]) => !perm || can(perm));
  const tab = tabs.some(([k]) => k === query.tab) ? query.tab : 'requests';
  mount(el, html`
    <header class="page-head">
      <div><h1>Leave &amp; Requests</h1><p class="muted">${can('leave.approve') ? 'Approve leave and remote-work requests, and manage leave credits.' : 'Review requests and manage leave credits. HR Managers and Administrators approve requests.'}</p></div>
    </header>
    <nav class="tabs">${tabs.map(([k, label]) => html`<a href="#/leave?tab=${k}" class="${k === tab ? 'active' : ''}">${label}</a>`)}</nav>
    <div id="tab-body"></div>`);
  const body = el.querySelector('#tab-body');
  if (tab === 'requests') return requestsTab(body, query);
  if (tab === 'balances') return balancesTab(body, query);
  if (tab === 'employee') return employeeLeaveTab(body, query);
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
                  if (!b.offered) return html`<td class="center"><span class="muted small" title="Not offered to this employee">n/a</span></td>`;
                  const low = b.remaining !== null && b.remaining <= 0;
                  return html`<td class="center"><button class="cell-btn ${low ? 'low' : ''} ${b.overridden ? 'override' : ''}" data-emp="${r.employeeId}" data-type="${t.id}">
                    <strong>${b.remaining ?? '∞'}</strong><span>/ ${b.credits == null ? '—' : b.credits + b.adjusted}</span>
                    ${b.used || b.pending ? html`<small>${b.used} used${b.pending ? `, ${b.pending} pending` : ''}</small>` : ''}
                  </button></td>`;
                })}
              </tr>`)}</tbody>
            </table>
            <p class="muted small pad">Used days are counted from leave recorded in the DTR. A gold outline means the credits were changed for that employee; "n/a" means the leave type isn't offered to them.${can('leave.adjust') ? html` To change one person's leave in detail, use <a href="#/leave?tab=employee">Employee leave</a>.` : ''}</p>`
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
        body: html`<p class="muted small">${state.year} · used ${b.used} · pending ${b.pending}${b.adjusted ? ` · adjusted ${b.adjusted > 0 ? '+' : ''}${b.adjusted}` : ''} · default ${type.annualCredits ?? 'no limit'}</p>
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

// ---------- One employee (administrators) ----------

const SOURCE = { request: ['Approved request', 'green'], admin: ['Recorded by admin', 'blue'], attendance: ['Entered in DTR', 'gray'] };
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

async function employeeLeaveTab(el, query) {
  const thisYear = new Date().getFullYear();
  const employees = (await api.get('/api/employees')).sort((a, b) => a.lastName.localeCompare(b.lastName));
  if (!employees.length) return mount(el, html`<div class="card empty"><p>No employees yet.</p></div>`);
  const state = { employeeId: employees.some((e) => e.id === query.employee) ? query.employee : employees.find((e) => e.status === 'Active')?.id || employees[0].id, year: Number(query.year) || thisYear };
  let data;

  const typeOptions = (selected, filter = () => true) => data.balances.filter(filter).map((b) => html`<option value="${b.leaveTypeId}" ${b.leaveTypeId === selected ? 'selected' : ''}>${b.name}</option>`);
  const done = (msg) => (result) => {
    data = result;
    render();
    toast(result.warning ? `${msg} ${result.warning}` : msg, result.warning ? 'error' : 'ok');
  };

  function openCredits(b) {
    const type = ctx.leaveTypes.find((t) => t.id === b.leaveTypeId);
    modal({
      title: `${b.name} credits: ${data.employee.name}`,
      submitLabel: 'Save credits',
      body: html`<label class="field"><span>Credits for ${state.year} (days)</span><input type="number" name="credits" min="0" max="366" step="0.5" value="${b.overridden ? b.credits : ''}" placeholder="${type?.annualCredits ?? 'No limit'}" />
        <small class="muted">The yearly allowance for this person. Leave blank to use the company default (${type?.annualCredits ?? 'no limit'}). For one-off changes like carry-over, use Adjust instead, so there is a reason on record.</small></label>`,
      onSubmit: async (f) => {
        const v = new FormData(f).get('credits');
        await api.put('/api/leave-credits', { employeeId: state.employeeId, year: state.year, leaveTypeId: b.leaveTypeId, credits: v === '' ? null : Number(v) });
        done('Credits saved.')(await api.get(`/api/employees/${state.employeeId}/leave?year=${state.year}`));
      },
    });
  }

  function openAdjust(b) {
    modal({
      title: `Adjust leave: ${data.employee.name}`,
      submitLabel: 'Save adjustment',
      body: html`<div class="grid two">
        <label class="field"><span>Leave type</span><select name="leaveTypeId">${typeOptions(b?.leaveTypeId, (x) => x.offered && x.credits != null)}</select></label>
        <label class="field"><span>Days (use minus to take away)</span><input type="number" name="days" step="0.5" min="-366" max="366" required placeholder="e.g. 2 or -1" /></label>
        <label class="field span-2"><span>Reason</span><input name="reason" maxlength="300" required placeholder="e.g. Carry-over from ${state.year - 1}, offset for weekend work, correction" /></label>
      </div><p class="muted small">Applies to ${state.year}. Each adjustment is kept on record with your name.</p>`,
      onSubmit: async (f) => done('Adjustment saved.')(await api.post(`/api/employees/${state.employeeId}/leave-adjustments`, { ...Object.fromEntries(new FormData(f)), year: state.year })),
    });
  }

  function openRecord(b) {
    const start = state.year === thisYear ? today() : `${state.year}-01-01`;
    modal({
      title: `Record leave: ${data.employee.name}`,
      submitLabel: 'Record leave',
      body: html`<div class="grid two">
        <label class="field span-2"><span>Leave type</span><select name="leaveTypeId">${typeOptions(b?.leaveTypeId, (x) => x.offered && x.active)}</select></label>
        <label class="field"><span>From</span><input type="date" name="startDate" value="${start}" required /></label>
        <label class="field"><span>To</span><input type="date" name="endDate" value="${start}" required /></label>
        <label class="field span-2"><span>Note (optional)</span><input name="note" maxlength="200" placeholder="e.g. Filed on paper, approved by the manager" /></label>
        <label class="field check span-2"><input type="checkbox" name="allowOverdraw" /> <span>Allow going over the balance</span></label>
      </div><p class="muted small">Adds one leave day to the DTR for each scheduled work day in the range. Use this for leave taken outside the system. Days that already have attendance are not overwritten.</p>`,
      onSubmit: async (f) => {
        const fd = new FormData(f);
        const result = await api.post(`/api/employees/${state.employeeId}/leave-days`, { leaveTypeId: fd.get('leaveTypeId'), startDate: fd.get('startDate'), endDate: fd.get('endDate'), note: fd.get('note'), allowOverdraw: fd.has('allowOverdraw') });
        done(`${result.recorded} leave day${result.recorded === 1 ? '' : 's'} recorded.`)(result);
      },
    });
  }

  function render() {
    const e = data.employee;
    const offeredTypes = data.balances.filter((b) => b.offered);
    mount(el, html`
      <section class="card">
        <div class="toolbar">
          <label class="inline">Employee <select id="f-emp">${employees.map((x) => html`<option value="${x.id}" ${x.id === state.employeeId ? 'selected' : ''}>${x.lastName}, ${x.firstName} (${x.employeeNo})${x.status === 'Active' ? '' : ` · ${x.status}`}</option>`)}</select></label>
          <label class="inline">Year <select id="f-year">${[thisYear - 1, thisYear, thisYear + 1].map((y) => html`<option ${y === state.year ? 'selected' : ''}>${y}</option>`)}</select></label>
          <span class="spacer"></span>
          <button class="btn" id="adjust">Adjust balance</button>
          <button class="btn primary" id="record">Record leave</button>
        </div>
        <p class="muted small">${e.name} · ${e.employeeNo}${e.department ? ` · ${e.department}` : ''}${e.hireDate ? ` · hired ${fmtDate(e.hireDate)}` : ''} · ${offeredTypes.length} of ${data.balances.length} leave types offered</p>
      </section>

      <section class="card scroll-x">
        <h2 class="pad">Leave types and balances, ${state.year}</h2>
        <table class="table emp-leave">
          <thead><tr><th>Leave type</th><th>Gets it?</th><th class="num">Credits</th><th class="num">Adjusted</th><th class="num">Used</th><th class="num">Pending</th><th class="num">Remaining</th><th></th></tr></thead>
          <tbody>${data.balances.map((b) => {
            const type = ctx.leaveTypes.find((t) => t.id === b.leaveTypeId) || {};
            const byDefault = type.appliesTo !== 'selected';
            const custom = b.offered !== byDefault;
            return html`<tr class="${b.offered ? '' : 'not-offered'}">
              <td><strong>${b.name}</strong><small>${b.code} · ${b.paid ? 'paid' : 'unpaid'}${b.active ? '' : ' · inactive'}</small></td>
              <td><label class="switch"><input type="checkbox" data-access="${b.leaveTypeId}" ${b.offered ? 'checked' : ''} /><span>${b.offered ? 'Yes' : 'No'}</span></label>
                <small>${custom ? html`set for ${e.name.split(' ')[0]} · <button type="button" class="link" data-reset="${b.leaveTypeId}">use default</button>` : byDefault ? 'everyone gets it' : 'selected employees only'}</small></td>
              ${b.offered
                ? html`<td class="num"><button type="button" class="link" data-credits="${b.leaveTypeId}" title="Change credits">${b.credits ?? 'No limit'}</button>${b.overridden ? html`<small>custom</small>` : ''}</td>
                  <td class="num">${b.adjusted ? signed(b.adjusted) : html`<span class="muted">—</span>`}</td>
                  <td class="num">${b.used}</td><td class="num">${b.pending || html`<span class="muted">—</span>`}</td>
                  <td class="num"><strong class="${b.remaining !== null && b.remaining < 0 ? 'negative' : ''}">${b.remaining ?? '∞'}</strong></td>
                  <td class="row-actions">${b.credits != null ? html`<button class="link" data-adjust="${b.leaveTypeId}">Adjust</button>` : ''}${b.active ? html`<button class="link" data-record="${b.leaveTypeId}">Record</button>` : ''}</td>`
                : html`<td colspan="6" class="muted small">Not offered to ${e.name.split(' ')[0]}${b.used ? ` · ${b.used} day(s) already recorded this year` : ''}</td>`}
            </tr>`;
          })}</tbody>
        </table>
        <p class="muted small pad">Remaining = credits + adjustments − used − pending. Turning a leave type off stops ${e.name.split(' ')[0]} from filing it; days already taken stay in the DTR.</p>
      </section>

      <div class="cols">
        <section class="card">
          <h2>Adjustments in ${state.year}</h2>
          ${data.adjustments.length
            ? html`<table class="table compact"><thead><tr><th>Date</th><th>Leave</th><th class="num">Days</th><th>Reason</th><th></th></tr></thead>
                <tbody>${data.adjustments.map((a) => html`<tr><td>${fmtDate(a.at.slice(0, 10))}<small>by ${a.by}</small></td><td>${a.typeName}</td>
                  <td class="num"><strong class="${a.days < 0 ? 'negative' : ''}">${signed(a.days)}</strong></td><td>${a.reason}</td>
                  <td class="row-actions"><button class="link danger" data-del-adj="${a.id}">Remove</button></td></tr>`)}</tbody></table>`
            : html`<p class="muted">No adjustments. Use <strong>Adjust balance</strong> for carry-over, offsets or corrections.</p>`}
        </section>
        <section class="card">
          <h2>Leave taken in ${state.year}</h2>
          ${data.leaveDays.length
            ? html`<table class="table compact"><thead><tr><th>Date</th><th>Leave</th><th>From</th><th></th></tr></thead>
                <tbody>${data.leaveDays.map((d) => html`<tr><td>${fmtDate(d.date)}</td><td>${d.typeName}${d.paid ? '' : html` <small>unpaid</small>`}</td>
                  <td>${badge(...SOURCE[d.source])}</td>
                  <td class="row-actions">${d.source === 'request' ? html`<a class="link" href="#/leave?tab=requests&status=approved">Cancel via request</a>` : html`<button class="link danger" data-del-day="${d.id}">Remove</button>`}</td></tr>`)}</tbody></table>`
            : html`<p class="muted">No leave recorded this year.</p>`}
        </section>
      </div>`);

    el.querySelector('#f-emp').addEventListener('change', (ev) => load(ev.target.value, state.year));
    el.querySelector('#f-year').addEventListener('change', (ev) => load(state.employeeId, Number(ev.target.value)));
    el.querySelector('#adjust').addEventListener('click', () => openAdjust());
    el.querySelector('#record').addEventListener('click', () => openRecord());
  }

  el.addEventListener('change', async (ev) => {
    const id = ev.target.dataset?.access;
    if (!id) return;
    const type = ctx.leaveTypes.find((t) => t.id === id) || {};
    const want = ev.target.checked;
    // Back to the default when the choice matches it, so a later change to the type applies to this person too.
    const offered = want === (type.appliesTo !== 'selected') ? null : want;
    try {
      done(want ? `${type.name} is now offered to ${data.employee.name}.` : `${type.name} removed for ${data.employee.name}.`)(
        await api.put(`/api/employees/${state.employeeId}/leave-access`, { leaveTypeId: id, offered, year: state.year }));
    } catch (err) {
      toast(err.message, 'error');
      render();
    }
  });
  el.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-reset],[data-credits],[data-adjust],[data-record],[data-del-adj],[data-del-day]');
    if (!t) return;
    const b = (id) => data.balances.find((x) => x.leaveTypeId === id);
    try {
      await act(t, b);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  async function act(t, b) {
    if (t.dataset.reset) return done('Back to the default for this leave type.')(await api.put(`/api/employees/${state.employeeId}/leave-access`, { leaveTypeId: t.dataset.reset, offered: null, year: state.year }));
    if (t.dataset.credits) return openCredits(b(t.dataset.credits));
    if (t.dataset.adjust) return openAdjust(b(t.dataset.adjust));
    if (t.dataset.record) return openRecord(b(t.dataset.record));
    if (t.dataset.delAdj) {
      if (!(await confirmDialog('Remove this adjustment? The balance changes back.', { confirmLabel: 'Remove' }))) return;
      return done('Adjustment removed.')(await api.del(`/api/employees/${state.employeeId}/leave-adjustments/${t.dataset.delAdj}`));
    }
    if (t.dataset.delDay) {
      const d = data.leaveDays.find((x) => x.id === t.dataset.delDay);
      if (!(await confirmDialog(`Remove ${d.typeName} on ${fmtDate(d.date)}? The day is taken out of the DTR and the credit is returned.`, { confirmLabel: 'Remove' }))) return;
      return done('Leave day removed.')(await api.del(`/api/employees/${state.employeeId}/leave-days/${d.id}`));
    }
  }

  async function load(employeeId, year) {
    Object.assign(state, { employeeId, year });
    history.replaceState(null, '', `#/leave?tab=employee&employee=${employeeId}&year=${year}`);
    data = await api.get(`/api/employees/${employeeId}/leave?year=${year}`);
    render();
  }
  await ctx.refreshLeaveTypes();
  await load(state.employeeId, state.year);
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
    <label class="field span-2"><span>Who gets it</span>
      <select name="appliesTo">
        <option value="all" ${t.appliesTo !== 'selected' ? 'selected' : ''}>Every employee (you can remove it for someone)</option>
        <option value="selected" ${t.appliesTo === 'selected' ? 'selected' : ''}>Only employees you add, under Employee leave</option>
      </select></label>
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
          <thead><tr><th>Code</th><th>Name</th><th>Pay</th><th class="num">Annual credits</th><th>Who gets it</th><th>Status</th><th></th></tr></thead>
          <tbody>${types.map((t) => html`<tr>
            <td><strong>${t.code}</strong></td><td>${t.name}</td>
            <td>${t.paid ? badge('Paid', 'green') : badge('Unpaid', 'gray')}</td>
            <td class="num">${t.annualCredits ?? 'No limit'}</td>
            <td>${t.appliesTo === 'selected' ? badge('Selected employees', 'blue') : 'Everyone'}</td>
            <td>${t.active ? badge('Active', 'green') : badge('Inactive', 'gray')}</td>
            <td class="row-actions"><button class="link" data-edit="${t.id}">Edit</button><button class="link danger" data-delete="${t.id}">Delete</button></td>
          </tr>`)}</tbody>
        </table>
        <p class="muted small">Defaults follow common Philippine practice (Service Incentive Leave is at least 5 days under the Labor Code; maternity, paternity and solo parent leave follow RA 11210, RA 8187 and RA 11861). Adjust to company policy.</p>
      </section>`);

    const read = (f) => {
      const fd = new FormData(f);
      return { code: fd.get('code'), name: fd.get('name'), annualCredits: fd.get('annualCredits'), paid: fd.has('paid'), active: fd.has('active'), appliesTo: fd.get('appliesTo') };
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
