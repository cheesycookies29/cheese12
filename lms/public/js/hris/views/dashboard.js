// HR dashboard: headcount, who is in today, requests waiting, upcoming leave, the latest payroll.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, money, fmtDate, fmtTime, fmtMinutes, badge } from '../../ui.js';
import { can, leaveName } from '../state.js';

// Today's status of one employee (from the ERP dashboard).
const STATUS = {
  in: () => badge('Working', 'green'),
  done: () => badge('Done', 'gray'),
  remote: () => badge('Remote work', 'blue'),
  leave: (r) => badge(leaveName(r), 'blue'),
  'not-in': (r) => badge(r.flex ? 'Not in (flexible)' : `Not in · shift ${fmtTime(r.shiftStart)}`, 'amber'),
};

const bars = (rows, total) => html`<ul class="bar-list">${rows.slice(0, 6).map(([label, n]) => html`<li><span>${label}</span><strong>${n}</strong><span class="bar"><span style="width:${Math.round((n / (total || 1)) * 100)}%"></span></span></li>`)}</ul>`;

export async function dashboardView(el) {
  const d = await api.get('/api/hris/dashboard');
  const t = d.today;
  mount(el, html`
    ${pageHead('HR dashboard', `${ctx.info.campusName || ''}${ctx.info.campusName ? ' · ' : ''}${fmtDate(d.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`,
      html`${can('clock.kiosk') ? html`<a class="btn" href="#/clock">${icon('grid', 16)} Open time clock</a>` : ''}${can('employees.edit') ? html`<a class="btn primary" href="#/employees/new">${icon('userPlus', 16)} Add employee</a>` : ''}`)}
    <div class="stats">
      <a class="card" href="#/employees"><small>Active employees</small><strong>${d.headcount}</strong><span class="muted small">${d.teaching} teaching · ${d.headcount - d.teaching} non-teaching</span></a>
      <a class="card" href="#/dtr?from=${d.date}&to=${d.date}"><small>In today</small><strong>${t.present} / ${t.scheduled}</strong><span class="muted small">${t.late} late · ${t.onLeave} on leave</span></a>
      ${can('leave.approve') ? html`<a class="card ${d.pendingRequests ? 'accent' : ''}" href="#/leave"><small>Requests to review</small><strong>${d.pendingRequests}</strong><span class="muted small">leave and remote work</span></a>` : ''}
      ${d.latestRun ? html`<a class="card" href="#/payroll/${d.latestRun.id}"><small>Latest payroll · ${d.latestRun.status}</small><strong>${money(d.latestRun.totals.netPay)}</strong><span class="muted small">net pay, ${fmtDate(d.latestRun.periodStart, { month: 'short', day: 'numeric' })} – ${fmtDate(d.latestRun.periodEnd)}</span></a>` : ''}
    </div>
    ${d.unlinked && can('hris.accounts') ? html`<div class="notice info">${icon('key')}<p><strong>${d.unlinked} active employee${d.unlinked === 1 ? ' has' : 's have'} no sign-in account</strong>, so no self-service yet. Open a record under <a href="#/employees">Employees</a> to link their Learn account or create a sign-in account.</p></div>` : ''}
    <div class="cols">
      <section class="card">
        <div class="card-head"><h2>${icon('clock')} Today at a glance</h2><a href="#/dtr?from=${d.date}&to=${d.date}">Attendance ${icon('chevronRight', 14)}</a></div>
        <div class="today-strip">
          <div><small>Scheduled</small><strong>${t.scheduled}</strong></div>
          <div><small>Clocked in</small><strong>${t.clockedIn}</strong></div>
          <div><small>Late</small><strong>${t.late}</strong></div>
          <div><small>On leave</small><strong>${t.onLeave}</strong></div>
          <div><small>Remote</small><strong>${t.remote}</strong></div>
        </div>
        ${t.notIn.length ? '' : html`<p class="hint-line">${icon('checkCircle', 16)} Everyone scheduled today has a record.</p>`}
      </section>
      <section class="card">
        <div class="card-head"><h2>${icon('calendar')} Leave in the next two weeks</h2>${can('leave.manage') ? html`<a href="#/leave?tab=requests&status=approved">All approved ${icon('chevronRight', 14)}</a>` : ''}</div>
        ${d.upcoming.length ? html`<ul class="link-list">${d.upcoming.map((r) => html`<li><strong>${r.name}</strong> ${badge(r.typeName, r.kind === 'remote' ? 'blue' : 'brand')}<br /><span class="muted small">${fmtDate(r.startDate)}${r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ''} · ${r.days} day${r.days === 1 ? '' : 's'}</span></li>`)}</ul>` : html`<p class="muted">No approved leave coming up.</p>`}
      </section>
      <section class="card span-all">
        <div class="card-head"><h2>${icon('users')} Today's attendance</h2><span class="muted small">${t.rows.length} employee${t.rows.length === 1 ? '' : 's'} scheduled or with a record</span></div>
        ${t.rows.length ? html`<div class="table-scroll today-table"><table class="table compact"><thead><tr><th>Employee</th><th>Status</th><th>In</th><th>Out</th><th class="num">Late</th></tr></thead>
          <tbody>${t.rows.map((r) => html`<tr><td><a href="#/employees/${r.id}"><strong>${r.name}</strong></a><small>${[r.position, r.department].filter(Boolean).join(' · ')}</small></td>
            <td>${STATUS[r.status](r)}</td><td class="nowrap">${r.timeIn ? fmtTime(r.timeIn) : '—'}</td><td class="nowrap">${r.timeOut ? fmtTime(r.timeOut) : '—'}</td>
            <td class="num ${r.lateMinutes ? 'warn' : ''}">${r.lateMinutes ? fmtMinutes(r.lateMinutes) : ''}</td></tr>`)}</tbody></table></div>`
          : html`<p class="muted">No one is scheduled today.</p>`}
      </section>
      <section class="card">
        <h2>${icon('users')} By department</h2>
        ${d.byDepartment.length ? bars(d.byDepartment, d.headcount) : html`<p class="muted">No employees yet.</p>`}
      </section>
      <section class="card">
        <h2>${icon('clipboard')} By employment status</h2>
        ${d.byStatus.length ? bars(d.byStatus, d.headcount) : html`<p class="muted">No employees yet.</p>`}
        ${d.birthdays.length ? html`<h3 style="margin-top:18px">${icon('party', 16)} Birthdays this month</h3><ul class="link-list">${d.birthdays.map((b) => html`<li>${b.name} <span class="muted small">${fmtDate(`2000-${b.day}`, { month: 'short', day: 'numeric' })}</span></li>`)}</ul>` : ''}
      </section>
    </div>`);
}
