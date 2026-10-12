import { api } from '../api.js';
import { ctx } from '../state.js';
import { computeEntry, scheduleFor, currentPeriod } from '/shared/calc.js';
import { html, mount, fmtDate, fmtTime, fmtMinutes, fullName, badge, toast, modal, confirmDialog, downloadFile, toCsv, today, WEEKDAYS } from '../ui.js';

// ---------- Time clock (kiosk) ----------

export async function clockView(el) {
  const employees = (await api.get('/api/employees')).filter((e) => e.status === 'Active').sort((a, b) => a.lastName.localeCompare(b.lastName));
  const byId = new Map(employees.map((e) => [e.id, e]));

  mount(el, html`
    <header class="page-head"><div><h1>Time Clock</h1><p class="muted">Employees clock in and out here. Times use this computer's clock.</p></div></header>
    <div class="cols clock-cols">
      <section class="card clock-card">
        <div class="clock-time" id="clock-time"></div>
        <div class="clock-date" id="clock-date"></div>
        ${employees.length
          ? html`<label class="field"><span>Employee</span>
              <select id="clock-emp"><option value="">Select your name…</option>${employees.map((e) => html`<option value="${e.id}">${e.lastName}, ${e.firstName} (${e.employeeNo})</option>`)}</select>
            </label>
            <div class="clock-status" id="clock-status"></div>
            <div class="clock-buttons">
              <button class="btn primary big" id="btn-in" disabled>Clock in</button>
              <button class="btn big" id="btn-out" disabled>Clock out</button>
            </div>`
          : html`<p class="muted">Add employees first to use the time clock.</p>`}
      </section>
      <section class="card">
        <h2>Today</h2>
        <div id="today-list"></div>
      </section>
    </div>`);

  const tick = () => {
    const now = new Date();
    el.querySelector('#clock-time').textContent = now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    el.querySelector('#clock-date').textContent = now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };
  tick();
  const timer = setInterval(tick, 1000);
  if (!employees.length) return () => clearInterval(timer);

  let entries = [];
  const select = el.querySelector('#clock-emp');
  const btnIn = el.querySelector('#btn-in');
  const btnOut = el.querySelector('#btn-out');

  async function refresh() {
    entries = await api.get('/api/time-entries');
    const todays = entries.filter((e) => e.date === today() && byId.has(e.employeeId));
    mount(el.querySelector('#today-list'), todays.length
      ? html`<table class="table compact"><thead><tr><th>Employee</th><th>In</th><th>Out</th></tr></thead><tbody>
          ${todays.sort((a, b) => (b.timeIn || '').localeCompare(a.timeIn || '')).map((e) => html`<tr>
            <td>${fullName(byId.get(e.employeeId))}</td>
            <td>${e.type === 'leave' ? badge('On leave', 'blue') : fmtTime(e.timeIn)}</td>
            <td>${e.type === 'leave' ? '' : e.timeOut ? fmtTime(e.timeOut) : badge('Working', 'green')}</td></tr>`)}
        </tbody></table>`
      : html`<p class="muted">No one has clocked in yet today.</p>`);
    updateButtons();
  }

  function updateButtons() {
    const id = select.value;
    const statusEl = el.querySelector('#clock-status');
    if (!id) {
      btnIn.disabled = btnOut.disabled = true;
      statusEl.textContent = '';
      return;
    }
    const open = entries.find((e) => e.employeeId === id && e.type === 'work' && !e.timeOut);
    const done = entries.find((e) => e.employeeId === id && e.date === today() && !open);
    btnIn.disabled = Boolean(open || done);
    btnOut.disabled = !open;
    statusEl.textContent = open
      ? `Clocked in since ${open.date === today() ? '' : fmtDate(open.date) + ' '}${fmtTime(open.timeIn)}`
      : done
        ? done.type === 'leave' ? 'On leave today.' : `Done for today (${fmtTime(done.timeIn)} – ${fmtTime(done.timeOut)}).`
        : 'Not clocked in.';
  }

  async function clock(action) {
    try {
      const res = await api.post('/api/clock', { employeeId: select.value, action });
      toast(res.message);
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  select.addEventListener('change', updateButtons);
  btnIn.addEventListener('click', () => clock('in'));
  btnOut.addEventListener('click', () => clock('out'));
  await refresh();
  return () => clearInterval(timer);
}

// ---------- Attendance / DTR ----------

function entryForm(entry, employees) {
  const type = entry.type || 'work';
  return html`
    <div class="grid two">
      <label class="field span-2"><span>Employee</span>
        <select name="employeeId" ${entry.id ? 'disabled' : ''}>${employees.map((e) => html`<option value="${e.id}" ${e.id === entry.employeeId ? 'selected' : ''}>${e.lastName}, ${e.firstName}</option>`)}</select>
      </label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${entry.date || today()}" required /></label>
      <label class="field"><span>Type</span>
        <select name="type"><option value="work" ${type === 'work' ? 'selected' : ''}>Work</option><option value="leave" ${type === 'leave' ? 'selected' : ''}>Paid leave</option></select>
      </label>
      <label class="field work-only"><span>Time in</span><input type="time" name="timeIn" value="${entry.timeIn || ''}" /></label>
      <label class="field work-only"><span>Time out</span><input type="time" name="timeOut" value="${entry.timeOut || ''}" /><small class="muted">Leave blank if still working.</small></label>
      <label class="field check span-2 work-only"><input type="checkbox" name="otApproved" ${entry.otApproved ? 'checked' : ''} /> <span>Overtime / rest-day work approved</span></label>
      <label class="field span-2"><span>Notes</span><input name="notes" value="${entry.notes || ''}" /></label>
    </div>`;
}

function openEntryModal(entry, employees, onSaved) {
  const { form } = modal({
    title: entry.id ? 'Edit attendance record' : 'Add attendance record',
    body: entryForm(entry, employees),
    onSubmit: async (f) => {
      const fd = new FormData(f);
      const body = {
        employeeId: entry.employeeId || fd.get('employeeId'),
        date: fd.get('date'),
        type: fd.get('type'),
        timeIn: fd.get('timeIn'),
        timeOut: fd.get('timeOut'),
        otApproved: fd.has('otApproved'),
        notes: fd.get('notes'),
      };
      if (entry.id) await api.put(`/api/time-entries/${entry.id}`, body);
      else await api.post('/api/time-entries', body);
      toast('Attendance saved.');
      onSaved();
    },
  });
  const typeSel = form.querySelector('[name=type]');
  const sync = () => form.querySelectorAll('.work-only').forEach((n) => (n.hidden = typeSel.value === 'leave'));
  typeSel.addEventListener('change', sync);
  sync();
}

export async function dtrView(el, _params, query) {
  const employees = (await api.get('/api/employees')).sort((a, b) => a.lastName.localeCompare(b.lastName));
  const byId = new Map(employees.map((e) => [e.id, e]));
  const period = currentPeriod(today(), ctx.settings.payFrequency);
  const state = { employeeId: query.employeeId || '', from: query.from || period.start, to: query.to || period.end };
  let rows = [];

  mount(el, html`
    <header class="page-head">
      <div><h1>Attendance (DTR)</h1><p class="muted">Daily time records, with late, undertime and overtime computed from each employee's schedule.</p></div>
      <div class="actions"><button class="btn" id="export">Export CSV</button><button class="btn primary" id="add" ${employees.length ? '' : 'disabled'}>+ Add record</button></div>
    </header>
    <section class="card">
      <div class="toolbar">
        <select id="f-emp"><option value="">All employees</option>${employees.map((e) => html`<option value="${e.id}" ${e.id === state.employeeId ? 'selected' : ''}>${e.lastName}, ${e.firstName}</option>`)}</select>
        <label class="inline">From <input type="date" id="f-from" value="${state.from}" /></label>
        <label class="inline">To <input type="date" id="f-to" value="${state.to}" /></label>
      </div>
      <div id="summary"></div>
      <div id="dtr-table"></div>
    </section>`);

  async function load() {
    const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v)).toString();
    const entries = await api.get(`/api/time-entries?${qs}`);
    rows = entries
      .filter((e) => byId.has(e.employeeId))
      .map((e) => {
        const emp = byId.get(e.employeeId);
        return { entry: e, emp, calc: computeEntry(e, scheduleFor(emp, ctx.settings), ctx.settings) };
      });
    render();
  }

  function render() {
    const total = (k) => rows.reduce((a, r) => a + r.calc[k], 0);
    mount(el.querySelector('#summary'), html`<div class="stats small">
      <div><small>Records</small><strong>${rows.length}</strong></div>
      <div><small>Hours worked</small><strong>${fmtMinutes(total('workedMinutes'))}</strong></div>
      <div><small>Late</small><strong>${fmtMinutes(total('lateMinutes'))}</strong></div>
      <div><small>Undertime</small><strong>${fmtMinutes(total('undertimeMinutes'))}</strong></div>
      <div><small>Overtime</small><strong>${fmtMinutes(total('overtimeMinutes'))}</strong></div>
      <div><small>Leave days</small><strong>${rows.filter((r) => r.calc.leave).length}</strong></div>
    </div>`);

    mount(el.querySelector('#dtr-table'), rows.length
      ? html`<table class="table">
          <thead><tr><th>Date</th><th>Employee</th><th>In</th><th>Out</th><th class="num">Worked</th><th class="num">Late</th><th class="num">Undertime</th><th class="num">Overtime</th><th>Notes</th><th></th></tr></thead>
          <tbody>${rows.map(({ entry: e, emp, calc: c }) => html`<tr>
            <td><strong>${fmtDate(e.date, { month: 'short', day: 'numeric' })}</strong> <small class="muted">${WEEKDAYS[new Date(e.date + 'T00:00').getDay()]}</small>${c.restDay ? html` ${badge('Rest day', 'gray')}` : ''}</td>
            <td>${fullName(emp)}</td>
            ${c.leave
              ? html`<td colspan="2">${badge('Paid leave', 'blue')}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>`
              : html`<td>${fmtTime(e.timeIn)}</td>
                <td>${c.open ? badge('Open', 'amber') : fmtTime(e.timeOut)}</td>
                <td class="num">${fmtMinutes(c.workedMinutes)}</td>
                <td class="num ${c.lateMinutes ? 'warn' : ''}">${fmtMinutes(c.lateMinutes)}</td>
                <td class="num ${c.undertimeMinutes ? 'warn' : ''}">${fmtMinutes(c.undertimeMinutes)}</td>
                <td class="num">${c.overtimeMinutes ? html`${fmtMinutes(c.overtimeMinutes)} ${e.otApproved ? badge('Approved', 'green') : html`<button class="link" data-approve="${e.id}">Approve</button>`}` : '—'}</td>`}
            <td class="notes">${e.notes}</td>
            <td class="row-actions"><button class="link" data-edit="${e.id}">Edit</button><button class="link danger" data-delete="${e.id}">Delete</button></td>
          </tr>`)}</tbody>
        </table>`
      : html`<div class="empty"><p>No attendance records in this range.</p></div>`);
  }

  const onFilter = () => {
    state.employeeId = el.querySelector('#f-emp').value;
    state.from = el.querySelector('#f-from').value;
    state.to = el.querySelector('#f-to').value;
    load();
  };
  ['#f-emp', '#f-from', '#f-to'].forEach((s) => el.querySelector(s).addEventListener('change', onFilter));

  el.querySelector('#add').addEventListener('click', () =>
    openEntryModal({ employeeId: state.employeeId || employees.find((e) => e.status === 'Active')?.id }, employees.filter((e) => e.status === 'Active'), load),
  );

  el.querySelector('#dtr-table').addEventListener('click', async (ev) => {
    const t = ev.target;
    const find = (id) => rows.find((r) => r.entry.id === id).entry;
    if (t.dataset.edit) openEntryModal(find(t.dataset.edit), employees, load);
    if (t.dataset.approve) {
      await api.put(`/api/time-entries/${t.dataset.approve}`, { ...find(t.dataset.approve), otApproved: true });
      toast('Overtime approved.');
      load();
    }
    if (t.dataset.delete && (await confirmDialog('Delete this attendance record?'))) {
      await api.del(`/api/time-entries/${t.dataset.delete}`);
      toast('Record deleted.');
      load();
    }
  });

  el.querySelector('#export').addEventListener('click', () => {
    const data = [
      ['Date', 'Employee No', 'Employee', 'Type', 'Time In', 'Time Out', 'Worked (min)', 'Late (min)', 'Undertime (min)', 'Overtime (min)', 'OT Approved', 'Notes'],
      ...rows.map(({ entry: e, emp, calc: c }) => [e.date, emp.employeeNo, fullName(emp), e.type, e.timeIn, e.timeOut, c.workedMinutes, c.lateMinutes, c.undertimeMinutes, c.overtimeMinutes, e.otApproved ? 'Yes' : 'No', e.notes]),
    ];
    downloadFile(`dtr-${state.from}-to-${state.to}.csv`, toCsv(data));
  });

  await load();
}
