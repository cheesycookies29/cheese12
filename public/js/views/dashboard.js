import { api } from '../api.js';
import { ctx } from '../state.js';
import { computeEntry, scheduleFor, dayOfWeek } from '/shared/calc.js';
import { html, mount, money, fmtDate, fmtTime, fullName, badge, today } from '../ui.js';

export async function dashboardView(el) {
  const date = today();
  const [employees, entries, runs] = await Promise.all([
    api.get('/api/employees'),
    api.get(`/api/time-entries?from=${date}&to=${date}`),
    api.get('/api/payroll-runs'),
  ]);
  const active = employees.filter((e) => e.status === 'Active');
  const entryFor = new Map(entries.map((e) => [e.employeeId, e]));

  const rows = active
    .map((emp) => {
      const sched = scheduleFor(emp, ctx.settings);
      const entry = entryFor.get(emp.id);
      const scheduled = sched.workDays.includes(dayOfWeek(date));
      let status;
      if (entry?.type === 'leave') status = badge('On leave', 'blue');
      else if (entry && !entry.timeOut) status = badge('Working', 'green');
      else if (entry) status = badge('Done', 'gray');
      else if (scheduled) status = badge('Not in yet', 'amber');
      else status = badge('Rest day', 'gray');
      const late = entry && entry.type === 'work' ? Math.max(0, computeEntry({ ...entry, timeOut: entry.timeOut || '23:59' }, sched, ctx.settings).lateMinutes) : 0;
      return { emp, entry, status, late, scheduled };
    })
    .sort((a, b) => a.emp.lastName.localeCompare(b.emp.lastName));

  const working = rows.filter((r) => r.entry?.type === 'work' && !r.entry.timeOut).length;
  const onLeave = rows.filter((r) => r.entry?.type === 'leave').length;
  const late = rows.filter((r) => r.late > 0).length;
  const notIn = rows.filter((r) => r.scheduled && !r.entry).length;
  const latest = runs[0];
  const depts = Object.entries(active.reduce((m, e) => ((m[e.department || 'Unassigned'] = (m[e.department || 'Unassigned'] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const maxDept = Math.max(1, ...depts.map((d) => d[1]));

  mount(el, html`
    <header class="page-head">
      <div><h1>Dashboard</h1><p class="muted">${new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p></div>
      <div class="actions"><a class="btn" href="#/clock">Open time clock</a><a class="btn primary" href="#/employees/new">+ Add employee</a></div>
    </header>
    ${employees.length === 0
      ? html`<section class="card empty welcome">
          <h2>Welcome to Sapling HR 🌱</h2>
          <p>Start by setting your company details, then add employees. Or load sample data to explore.</p>
          <div class="actions center"><a class="btn" href="#/settings">Company settings</a><a class="btn primary" href="#/employees/new">Add first employee</a></div>
        </section>`
      : html`
        <div class="stats">
          <a class="card" href="#/employees"><small>Active employees</small><strong>${active.length}</strong></a>
          <a class="card" href="#/clock"><small>Working now</small><strong>${working}</strong></a>
          <a class="card" href="#/dtr"><small>Late today</small><strong>${late}</strong></a>
          <a class="card" href="#/dtr"><small>On leave today</small><strong>${onLeave}</strong></a>
          <a class="card" href="#/dtr"><small>Not in yet</small><strong>${notIn}</strong></a>
        </div>
        <div class="cols wide-left">
          <section class="card">
            <h2>Today's attendance</h2>
            <table class="table compact">
              <thead><tr><th>Employee</th><th>Status</th><th>In</th><th>Out</th><th class="num">Late</th></tr></thead>
              <tbody>${rows.map((r) => html`<tr>
                <td><a href="#/employees/${r.emp.id}">${fullName(r.emp)}</a></td><td>${r.status}</td>
                <td>${r.entry?.type === 'work' ? fmtTime(r.entry.timeIn) : ''}</td>
                <td>${r.entry?.timeOut ? fmtTime(r.entry.timeOut) : ''}</td>
                <td class="num ${r.late ? 'warn' : ''}">${r.late ? `${r.late}m` : ''}</td></tr>`)}</tbody>
            </table>
          </section>
          <div class="stack">
            <section class="card">
              <h2>Latest payroll</h2>
              ${latest
                ? html`<a class="latest-run" href="#/payroll/${latest.id}">
                    <span>${fmtDate(latest.periodStart)} – ${fmtDate(latest.periodEnd)} ${latest.status === 'draft' ? badge('Draft', 'amber') : badge('Finalized', 'green')}</span>
                    <strong>${money(latest.totals.netPay)}</strong><small class="muted">net pay · ${latest.totals.employees} employees · paid ${fmtDate(latest.payDate)}</small>
                  </a>`
                : html`<p class="muted">No payroll runs yet. <a href="#/payroll">Run payroll</a></p>`}
            </section>
            <section class="card">
              <h2>Headcount by department</h2>
              <ul class="bars">${depts.map(([name, n]) => html`<li><span>${name}</span><div class="bar"><i style="width:${Math.round((n / maxDept) * 100)}%"></i></div><b>${n}</b></li>`)}</ul>
            </section>
          </div>
        </div>`}`);
}
