// Employee self-service: own clock, attendance, requests, payslips and profile.
import { api } from '../api.js';
import { ctx, leaveName } from '../state.js';
import { computeEntry, scheduleFor, currentPeriod } from '/shared/calc.js';
import { html, mount, money, fmtDate, fmtTime, fmtMinutes, badge, toast, today, WEEKDAYS, modal, confirmDialog } from '../ui.js';
import { statusBadge, kindBadge, dateRange, certificateCell } from './leave.js';
import { workDates, needsCertificate } from '/shared/leave.js';
import { ACCEPT, prepareUpload, viewAttachment } from '../attachments.js';
import { payslipCard } from './payroll.js';
import { openChangePassword } from './login.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function attendanceRows(entries, emp) {
  const schedule = scheduleFor(emp, ctx.settings);
  return entries.map((e) => ({ entry: e, calc: computeEntry(e, schedule, ctx.settings) }));
}

function summary(rows) {
  const total = (k) => rows.reduce((a, r) => a + r.calc[k], 0);
  return html`<div class="stats small">
    <div><small>Days worked</small><strong>${rows.filter((r) => r.entry.type === 'work').length}</strong></div>
    <div><small>Hours worked</small><strong>${fmtMinutes(total('workedMinutes'))}</strong></div>
    <div><small>Late</small><strong>${fmtMinutes(total('lateMinutes'))}</strong></div>
    <div><small>Undertime</small><strong>${fmtMinutes(total('undertimeMinutes'))}</strong></div>
    <div><small>Overtime</small><strong>${fmtMinutes(rows.filter((r) => r.entry.otApproved).reduce((a, r) => a + r.calc.overtimeMinutes, 0))}</strong></div>
    <div><small>Leave days</small><strong>${rows.filter((r) => r.calc.leave).length}</strong></div>
  </div>`;
}

export async function meHomeView(el) {
  const emp = await api.get('/api/me/profile');
  const period = currentPeriod(today(), ctx.settings.payFrequency);

  async function render() {
    const [all, payslips, requests, balances] = await Promise.all([
      api.get('/api/me/time-entries'), api.get('/api/me/payslips'), api.get('/api/me/requests'), api.get('/api/me/leave-balances'),
    ]);
    const entries = all.filter((e) => e.date >= period.start && e.date <= period.end);
    const open = all.find((e) => e.type === 'work' && e.timeIn && !e.timeOut);
    const todays = all.find((e) => e.date === today());
    const remoteToday = todays?.remote && !todays.timeIn;
    const pending = requests.filter((r) => r.status === 'pending');
    const upcoming = requests.filter((r) => r.status === 'approved' && r.endDate >= today()).slice(0, 3);
    const latest = payslips[0];
    const status = open
      ? html`${badge('Working', 'green')} since ${open.date === today() ? '' : fmtDate(open.date) + ' '}${fmtTime(open.timeIn)}`
      : todays?.type === 'leave'
        ? badge(`On ${leaveName(todays)} today`, 'blue')
        : remoteToday
          ? html`${badge('Remote work today', 'blue')} Clock in to record your hours, or leave it as a full day.`
        : todays
          ? html`${badge('Done for today', 'gray')} ${fmtTime(todays.timeIn)} – ${fmtTime(todays.timeOut)}`
          : badge('Not clocked in', 'amber');

    mount(el, html`
      <header class="page-head">
        <div><h1>${greeting()}, ${emp.firstName}</h1><p class="muted">${emp.position || 'Employee'} · ${emp.employeeNo}</p></div>
      </header>
      <div class="cols">
        <section class="card clock-card">
          <div class="clock-time" id="clock-time"></div>
          <div class="clock-date" id="clock-date"></div>
          <div class="clock-status">${status}</div>
          <div class="clock-buttons">
            <button class="btn primary big" id="btn-in" ${open || (todays && !remoteToday) ? 'disabled' : ''}>Clock in</button>
            <button class="btn big" id="btn-out" ${open ? '' : 'disabled'}>Clock out</button>
          </div>
        </section>
        <div class="stack">
          <section class="card">
            <h2>This pay period</h2>
            <p class="muted small">${fmtDate(period.start)} – ${fmtDate(period.end)}</p>
            ${summary(attendanceRows(entries, emp))}
            <a href="#/me/attendance">View my attendance →</a>
          </section>
          <section class="card">
            <h2>Leave &amp; requests</h2>
            <div class="balance-chips">${balances.filter((b) => b.credits != null).slice(0, 4).map((b) => html`<div><strong>${b.remaining}</strong><span>${b.name}</span></div>`)}</div>
            ${pending.length ? html`<p>${badge(`${pending.length} pending`, 'amber')} waiting for approval</p>` : ''}
            ${upcoming.length ? html`<ul class="link-list">${upcoming.map((r) => html`<li>${kindBadge(r)} ${dateRange(r)}</li>`)}</ul>` : ''}
            <div class="actions"><a class="btn primary" href="#/me/requests?new=1">File a request</a><a class="btn" href="#/me/requests">My requests</a></div>
          </section>
          <section class="card">
            <h2>Latest payslip</h2>
            ${latest
              ? html`<a class="latest-run" href="#/me/payslips/${latest.runId}">
                  <span>${fmtDate(latest.periodStart)} – ${fmtDate(latest.periodEnd)}</span>
                  <strong>${money(latest.netPay)}</strong><small class="muted">net pay · paid ${fmtDate(latest.payDate)}</small></a>`
              : html`<p class="muted">No payslips yet. They appear here once payroll is finalized.</p>`}
          </section>
        </div>
      </div>`);

    const clock = async (action) => {
      try {
        const res = await api.post('/api/me/clock', { action });
        toast(res.message.replace(emp.firstName, 'You'));
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    el.querySelector('#btn-in').addEventListener('click', () => clock('in'));
    el.querySelector('#btn-out').addEventListener('click', () => clock('out'));
    tick();
  }

  const tick = () => {
    const t = el.querySelector('#clock-time');
    if (!t) return;
    const now = new Date();
    t.textContent = now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    el.querySelector('#clock-date').textContent = now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };
  const timer = setInterval(tick, 1000);
  await render();
  return () => clearInterval(timer);
}

export async function meAttendanceView(el, _params, query) {
  const emp = await api.get('/api/me/profile');
  const period = currentPeriod(today(), ctx.settings.payFrequency);
  const state = { from: query.from || period.start, to: query.to || period.end };

  mount(el, html`
    <header class="page-head"><div><h1>My Attendance</h1><p class="muted">Your daily time records. Ask HR if something needs correcting.</p></div></header>
    <section class="card">
      <div class="toolbar">
        <label class="inline">From <input type="date" id="f-from" value="${state.from}" /></label>
        <label class="inline">To <input type="date" id="f-to" value="${state.to}" /></label>
      </div>
      <div id="me-dtr"></div>
    </section>`);

  async function load() {
    const rows = attendanceRows(await api.get(`/api/me/time-entries?from=${state.from}&to=${state.to}`), emp);
    mount(el.querySelector('#me-dtr'), html`${summary(rows)}${rows.length
      ? html`<table class="table">
          <thead><tr><th>Date</th><th>In</th><th>Out</th><th class="num">Worked</th><th class="num">Late</th><th class="num">Undertime</th><th class="num">Overtime</th><th>Notes</th></tr></thead>
          <tbody>${rows.map(({ entry: e, calc: c }) => html`<tr>
            <td><strong>${fmtDate(e.date, { month: 'short', day: 'numeric' })}</strong> <small class="muted">${WEEKDAYS[new Date(e.date + 'T00:00').getDay()]}</small>${c.restDay ? html` ${badge('Rest day', 'gray')}` : ''}</td>
            ${c.leave
              ? html`<td colspan="2">${badge(leaveName(e), c.paidLeave ? 'blue' : 'gray')}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>`
              : e.remote && !e.timeIn
              ? html`<td colspan="2">${badge('Remote work', 'blue')} <small class="muted">full day</small></td><td class="num">${fmtMinutes(c.workedMinutes)}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>`
              : html`<td>${fmtTime(e.timeIn)}${e.remote ? html` ${badge('Remote', 'blue')}` : ''}</td><td>${c.open ? badge('Open', 'amber') : fmtTime(e.timeOut)}</td>
                <td class="num">${fmtMinutes(c.workedMinutes)}</td>
                <td class="num ${c.lateMinutes ? 'warn' : ''}">${fmtMinutes(c.lateMinutes)}</td>
                <td class="num ${c.undertimeMinutes ? 'warn' : ''}">${fmtMinutes(c.undertimeMinutes)}</td>
                <td class="num">${c.overtimeMinutes ? html`${fmtMinutes(c.overtimeMinutes)} ${e.otApproved ? badge('Approved', 'green') : badge('Pending', 'amber')}` : '—'}</td>`}
            <td class="notes">${e.notes}</td>
          </tr>`)}</tbody>
        </table>`
      : html`<div class="empty"><p>No attendance records in this range.</p></div>`}`);
  }

  ['#f-from', '#f-to'].forEach((s) => el.querySelector(s).addEventListener('change', () => {
    state.from = el.querySelector('#f-from').value;
    state.to = el.querySelector('#f-to').value;
    load();
  }));
  await load();
}

export async function mePayslipsView(el) {
  const payslips = await api.get('/api/me/payslips');
  mount(el, html`
    <header class="page-head"><div><h1>My Payslips</h1><p class="muted">Payslips appear here once payroll for the period is finalized.</p></div></header>
    <section class="card">
      ${payslips.length
        ? html`<table class="table clickable">
            <thead><tr><th>Pay period</th><th>Pay date</th><th class="num">Gross pay</th><th class="num">Deductions</th><th class="num">Net pay</th></tr></thead>
            <tbody>${payslips.map((p) => html`<tr data-href="#/me/payslips/${p.runId}">
              <td><strong>${fmtDate(p.periodStart)} – ${fmtDate(p.periodEnd)}</strong></td><td>${fmtDate(p.payDate)}</td>
              <td class="num">${money(p.grossPay)}</td><td class="num">${money(p.totalDeductions)}</td><td class="num"><strong>${money(p.netPay)}</strong></td>
            </tr>`)}</tbody>
          </table>`
        : html`<div class="empty"><p>No payslips yet.</p></div>`}
    </section>`);
  el.querySelector('tbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
}

export async function mePayslipView(el, { runId }) {
  const { run, payslip } = await api.get(`/api/me/payslips/${runId}`);
  mount(el, html`
    <header class="page-head no-print">
      <div><a class="back" href="#/me/payslips">← My Payslips</a><h1>Payslip</h1></div>
      <div class="actions"><button class="btn primary" id="print">Print / Save as PDF</button></div>
    </header>
    <div class="payslips">${payslipCard(run, payslip, ctx.settings)}</div>`);
  el.querySelector('#print').addEventListener('click', () => window.print());
}

const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || html`<span class="muted">—</span>`}</dd></div>`;

export async function meProfileView(el) {
  const emp = await api.get('/api/me/profile');
  const sched = scheduleFor(emp, ctx.settings);
  mount(el, html`
    <header class="page-head">
      <div class="person big"><span class="avatar">${emp.firstName[0]}${emp.lastName[0]}</span>
        <div><h1>${emp.firstName} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName}</h1>
        <p class="muted">${emp.position || 'Employee'} · ${emp.department || '—'} · ${emp.employeeNo}</p></div></div>
      <div class="actions"><button class="btn" id="change-pw">Change password</button></div>
    </header>
    <div class="cols">
      <section class="card"><h2>Personal</h2><dl class="info-grid">
        ${info('Birth date', fmtDate(emp.birthDate))}${info('Gender', emp.gender)}${info('Civil status', emp.civilStatus)}
        ${info('Email', emp.email)}${info('Mobile', emp.phone)}${info('Address', emp.address)}
        ${info('Emergency contact', [emp.emergencyContactName, emp.emergencyContactPhone].filter(Boolean).join(' · '))}
      </dl></section>
      <section class="card"><h2>Employment</h2><dl class="info-grid">
        ${info('Date hired', fmtDate(emp.hireDate))}${info('Employment status', emp.employmentStatus)}
        ${info('Department', emp.department)}${info('Position', emp.position)}
        ${info('Schedule', `${fmtTime(sched.shiftStart)} – ${fmtTime(sched.shiftEnd)}, ${sched.workDays.map((d) => WEEKDAYS[d]).join(', ')}`)}
      </dl></section>
      <section class="card"><h2>Government IDs &amp; bank</h2><dl class="info-grid">
        ${info('TIN', emp.tin)}${info('SSS', emp.sssNo)}${info('PhilHealth', emp.philhealthNo)}${info('Pag-IBIG', emp.pagibigNo)}
        ${info('Bank', emp.bankName)}${info('Account no.', emp.bankAccount)}
      </dl></section>
    </div>
    <p class="muted small">Need to update your details? Contact HR.</p>`);
  el.querySelector('#change-pw').addEventListener('click', openChangePassword);
}

export async function meRequestsView(el, _params, query) {
  const emp = await api.get('/api/me/profile');
  const year = new Date().getFullYear();

  async function render() {
    const [requests, balances] = await Promise.all([api.get('/api/me/requests'), api.get(`/api/me/leave-balances?year=${year}`)]);
    mount(el, html`
      <header class="page-head">
        <div><h1>My Requests</h1><p class="muted">File leave or remote work. HR or an administrator approves it, and approved days appear in your attendance.</p></div>
        <div class="actions"><button class="btn primary" id="new-request">+ File a request</button></div>
      </header>
      <section class="card">
        <h2>Leave balances ${year}</h2>
        <div class="balance-grid">${balances.map((b) => html`<div class="balance ${b.remaining !== null && b.remaining <= 0 ? 'low' : ''}">
          <span>${b.name}${b.paid ? '' : html` <small class="muted">(unpaid)</small>`}</span>
          <strong>${b.remaining ?? '—'}</strong>
          <small class="muted">${b.credits == null ? 'No set limit' : `of ${b.credits + (b.adjusted || 0)} · ${b.used} used${b.pending ? ` · ${b.pending} pending` : ''}`}</small>
        </div>`)}</div>
      </section>
      <section class="card">
        <h2>My requests</h2>
        ${requests.length
          ? html`<table class="table">
              <thead><tr><th>Request</th><th>Dates</th><th class="num">Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
              <tbody>${requests.map((r) => html`<tr>
                <td>${kindBadge(r)}${certificateCell(r, `/api/me/requests/${r.id}/attachment`)}</td>
                <td>${dateRange(r)}<small>Filed ${fmtDate(r.filedAt.slice(0, 10))}</small></td>
                <td class="num">${r.days}</td>
                <td class="notes">${r.reason}</td>
                <td>${statusBadge(r.status)}${r.decidedByName ? html`<small>by ${r.decidedByName}${r.decisionNote ? html`: “${r.decisionNote}”` : ''}</small>` : ''}</td>
                <td class="row-actions">${r.status === 'pending' && r.kind === 'leave' ? html`<button class="link" data-attach="${r.id}">${r.attachment ? 'Replace certificate' : 'Attach certificate'}</button>` : ''}${r.status === 'pending' ? html`<button class="link danger" data-withdraw="${r.id}">Withdraw</button>` : ''}</td>
              </tr>`)}</tbody>
            </table>`
          : html`<div class="empty"><p>You haven't filed any requests yet.</p></div>`}
      </section>`);

    el.querySelector('#new-request').addEventListener('click', () => openForm(balances));
    el.querySelector('tbody')?.addEventListener('click', async (e) => {
      const cert = e.target.closest('[data-cert-url]');
      if (cert) return viewAttachment(cert.dataset.certUrl).catch((err) => toast(err.message, 'error'));
      if (e.target.dataset.attach) return attachTo(e.target.dataset.attach);
      const id = e.target.dataset.withdraw;
      if (!id || !(await confirmDialog('Withdraw this request?', { confirmLabel: 'Withdraw' }))) return;
      await api.post(`/api/me/requests/${id}/cancel`);
      toast('Request withdrawn.');
      render();
    });
  }

  function attachTo(id) {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: ACCEPT });
    input.addEventListener('change', async () => {
      if (!input.files[0]) return;
      try {
        await api.put(`/api/me/requests/${id}/attachment`, { attachment: await prepareUpload(input.files[0]) });
        toast('Medical certificate attached.');
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    input.click();
  }

  function openForm(balances) {
    // Only the leave types this employee gets (the server sends balances for those).
    const offered = new Set(balances.map((b) => b.leaveTypeId));
    const types = ctx.leaveTypes.filter((t) => t.active && offered.has(t.id));
    const tomorrow = today(new Date(Date.now() + 86400000));
    const { form } = modal({
      title: 'File a request',
      submitLabel: 'Submit for approval',
      body: html`<div class="grid two">
        <label class="field span-2"><span>Request</span>
          <select name="what">
            <optgroup label="Leave">${types.map((t) => html`<option value="leave:${t.id}">${t.name}${t.paid ? '' : ' (unpaid)'}</option>`)}</optgroup>
            <optgroup label="Work arrangement"><option value="remote">Remote work (work from home)</option></optgroup>
          </select>
        </label>
        <label class="field"><span>From</span><input type="date" name="startDate" value="${tomorrow}" required /></label>
        <label class="field"><span>To</span><input type="date" name="endDate" value="${tomorrow}" required /></label>
        <p class="span-2 request-preview muted small"></p>
        <label class="field span-2"><span>Reason</span><textarea name="reason" rows="3" maxlength="500" placeholder="Optional, but helps your approver"></textarea></label>
        <label class="field span-2 cert-field"><span class="cert-label">Medical certificate (optional)</span>
          <input type="file" name="certificate" accept="${ACCEPT}" />
          <small class="muted cert-hint">PDF or a photo, up to 5 MB. Photos are resized automatically.</small></label>
      </div>`,
      onSubmit: async (f) => {
        const fd = new FormData(f);
        const what = fd.get('what');
        const file = f.certificate.files[0];
        const { required, type } = certificateRule();
        if (required && !file) throw new Error(`${type.name} of more than ${type.certificateAfterDays} day${type.certificateAfterDays === 1 ? '' : 's'} needs a medical certificate. Attach it to continue.`);
        await api.post('/api/me/requests', {
          kind: what === 'remote' ? 'remote' : 'leave',
          leaveTypeId: what.startsWith('leave:') ? what.slice(6) : null,
          startDate: fd.get('startDate'), endDate: fd.get('endDate'), reason: fd.get('reason'),
          attachment: what !== 'remote' && file ? await prepareUpload(file) : undefined,
        });
        toast('Request submitted for approval.');
        render();
      },
    });
    // Whether the chosen leave and dates need a medical certificate.
    const certificateRule = () => {
      const fd = new FormData(form);
      const what = fd.get('what');
      const type = what.startsWith('leave:') && ctx.leaveTypes.find((t) => t.id === what.slice(6));
      const start = fd.get('startDate');
      const end = fd.get('endDate');
      const days = start && end && end >= start ? workDates(emp, ctx.settings, start, end).length : 0;
      return { type, leave: Boolean(type), required: Boolean(type) && needsCertificate(type, days) };
    };
    const preview = () => {
      const rule = certificateRule();
      const field = form.querySelector('.cert-field');
      field.hidden = !rule.leave;
      field.classList.toggle('required', rule.required);
      form.querySelector('.cert-label').textContent = rule.required ? 'Medical certificate (required)' : 'Medical certificate (optional)';
      form.querySelector('.cert-hint').textContent = rule.required
        ? `Required: ${rule.type.name} longer than ${rule.type.certificateAfterDays} day${rule.type.certificateAfterDays === 1 ? '' : 's'}. PDF or a photo, up to 5 MB.`
        : `${rule.type?.certificateAfterDays != null ? `Required for ${rule.type.name} longer than ${rule.type.certificateAfterDays} day${rule.type.certificateAfterDays === 1 ? '' : 's'}. ` : ''}PDF or a photo, up to 5 MB.`;
      const fd = new FormData(form);
      const start = fd.get('startDate');
      const end = fd.get('endDate');
      const el2 = form.querySelector('.request-preview');
      if (!start || !end || end < start) return (el2.textContent = 'Pick a valid date range.');
      const days = workDates(emp, ctx.settings, start, end).length;
      const what = fd.get('what');
      const bal = what.startsWith('leave:') && balances.find((b) => b.leaveTypeId === what.slice(6));
      el2.textContent = `${days} work day${days === 1 ? '' : 's'} (rest days are not counted)` + (bal && bal.remaining !== null ? ` · ${bal.remaining} day(s) of ${bal.name} left` : '');
    };
    form.addEventListener('input', preview);
    form.addEventListener('change', (e) => {
      if (e.target.name === 'startDate' && form.endDate.value < e.target.value) form.endDate.value = e.target.value;
      preview();
    });
    preview();
  }

  await render();
  if (query.new) {
    history.replaceState(null, '', '#/me/requests');
    el.querySelector('#new-request').click();
  }
}
