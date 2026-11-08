// Attendance (DTR): daily time records for the campus, with late, undertime and overtime
// computed from each employee's schedule. From the Lancaster ERP (public/js/views/time.js).
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { computeEntry, scheduleFor, currentPeriod } from '/shared/calc.js';
import { html, mount, fmtDate, fmtTime, fmtMinutes, fullName, toast, modal, confirmDialog, downloadFile, toCsv, today } from '../../ui.js';
import { hr, can, leaveName } from '../state.js';
import { dtrCells, dayCell } from './self.js';
import { locationPill, openLocation } from '../geo.js';
import { LOCATION_STATUS, fmtDistance } from '/shared/geo.js';

// Where a clock-in was made, for the CSV (HR managers and administrators only).
const whereLabel = (e) => {
  const g = e.clockInLocation;
  return !g ? '' : g.status !== 'ok' ? LOCATION_STATUS[g.status] : g.inside == null ? 'Recorded' : g.inside ? 'Within campus radius' : e.remote ? 'Remote day' : `Away from campus (${fmtDistance(g.distance)})`;
};

function entryForm(entry, employees) {
  const type = entry.type === 'leave' ? `leave:${entry.leaveTypeId || ''}` : entry.remote ? 'remote' : 'work';
  const leaveTypes = hr.leaveTypes.filter((t) => t.active || t.id === entry.leaveTypeId);
  return html`
    <div class="grid two">
      <label class="field span-2"><span>Employee</span>
        <select name="employeeId" ${entry.id ? 'disabled' : ''}>${employees.map((e) => html`<option value="${e.id}" ${e.id === entry.employeeId ? 'selected' : ''}>${e.lastName}, ${e.firstName}</option>`)}</select>
      </label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${entry.date || today()}" required /></label>
      <label class="field"><span>Type</span>
        <select name="type">
          <option value="work" ${type === 'work' ? 'selected' : ''}>Work (on site)</option>
          <option value="remote" ${type === 'remote' ? 'selected' : ''}>Remote work</option>
          <optgroup label="Leave">${leaveTypes.map((t) => html`<option value="leave:${t.id}" ${type === `leave:${t.id}` ? 'selected' : ''}>${t.name}${t.paid ? '' : ' (unpaid)'}</option>`)}
          ${type === 'leave:' ? html`<option value="leave:" selected>Paid leave (no type)</option>` : ''}</optgroup>
        </select>
      </label>
      <label class="field work-only"><span>Time in</span><input type="time" name="timeIn" value="${entry.timeIn || ''}" /></label>
      <label class="field work-only"><span>Time out</span><input type="time" name="timeOut" value="${entry.timeOut || ''}" /><span class="hint">Leave blank if still working. For a full remote day, leave both times blank.</span></label>
      <label class="field check span-2 work-only"><input type="checkbox" name="otApproved" ${entry.otApproved ? 'checked' : ''} /> <span>Overtime / rest-day work approved</span></label>
      <label class="field span-2"><span>Notes</span><input name="notes" value="${entry.notes || ''}" maxlength="300" /></label>
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
        type: fd.get('type').startsWith('leave:') ? 'leave' : 'work',
        remote: fd.get('type') === 'remote',
        leaveTypeId: fd.get('type').startsWith('leave:') ? fd.get('type').slice(6) || null : null,
        timeIn: fd.get('timeIn'),
        timeOut: fd.get('timeOut'),
        otApproved: fd.has('otApproved'),
        notes: fd.get('notes'),
      };
      if (entry.id) await api.put(`/api/hris/time-entries/${entry.id}`, body);
      else await api.post('/api/hris/time-entries', body);
      toast('Attendance saved.');
      onSaved();
    },
  });
  const typeSel = form.querySelector('[name=type]');
  const sync = () => form.querySelectorAll('.work-only').forEach((n) => (n.hidden = typeSel.value.startsWith('leave:')));
  typeSel.addEventListener('change', sync);
  sync();
}

export async function dtrView(el, _params, query) {
  const employees = (await api.get('/api/hris/employees')).sort((a, b) => a.lastName.localeCompare(b.lastName));
  const byId = new Map(employees.map((e) => [e.id, e]));
  const period = currentPeriod(today(), hr.settings.payFrequency);
  const state = { employeeId: query.employeeId || '', from: query.from || period.start, to: query.to || period.end };
  const edit = can('attendance.edit');
  let rows = [];

  mount(el, html`
    ${pageHead('Attendance (DTR)', 'Daily time records, with late, undertime and overtime computed from each employee’s schedule.',
      html`<button class="btn" id="export">${icon('download', 16)} Export CSV</button>${edit ? html`<button class="btn primary" id="add" ${employees.length ? '' : 'disabled'}>${icon('plus', 16)} Add record</button>` : ''}`)}
    <section class="card">
      <div class="toolbar">
        <select id="f-emp"><option value="">All employees</option>${employees.map((e) => html`<option value="${e.id}" ${e.id === state.employeeId ? 'selected' : ''}>${e.lastName}, ${e.firstName}</option>`)}</select>
        <label class="inline">From <input type="date" id="f-from" value="${state.from}" /></label>
        <label class="inline">To <input type="date" id="f-to" value="${state.to}" /></label>
      </div>
      <div id="summary"></div>
      <div id="dtr-table" class="scroll-x"></div>
    </section>`);

  async function load() {
    const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v)).toString();
    const entries = await api.get(`/api/hris/time-entries?${qs}`);
    rows = entries.filter((e) => byId.has(e.employeeId)).map((e) => {
      const emp = byId.get(e.employeeId);
      return { entry: e, emp, calc: computeEntry(e, scheduleFor(emp, hr.settings), hr.settings) };
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
    const approve = edit ? (e) => html`<button class="link" data-approve="${e.id}">Approve</button>` : null;
    const seeLocation = can('attendance.location');
    mount(el.querySelector('#dtr-table'), rows.length
      ? html`<table class="table">
          <thead><tr><th>Date</th><th>Employee</th><th>In</th><th>Out</th><th class="num">Worked</th><th class="num">Late</th><th class="num">Undertime</th><th class="num">Overtime</th>${seeLocation ? html`<th>Clock-in location</th>` : ''}<th>Notes</th><th></th></tr></thead>
          <tbody>${rows.map(({ entry: e, emp, calc: c }) => html`<tr>
            ${dayCell(e, c)}
            <td><a href="#/employees/${emp.id}">${fullName(emp)}</a>${emp.flexTime ? html` <span class="flex-tag" title="Flexible time: no late or undertime">FLEX</span>` : ''}</td>
            ${dtrCells(e, c, { overtimeAction: approve })}
            ${seeLocation ? html`<td>${e.clockInLocation ? html`<button type="button" class="link geo-link" data-geo="${e.id}" aria-label="Clock-in location, ${fullName(emp)}, ${e.date}">${locationPill(e.clockInLocation, { remote: e.remote })}</button>` : html`<span class="muted small">${e.timeIn ? 'Entered in DTR' : '—'}</span>`}</td>` : ''}
            <td class="notes">${e.notes}</td>
            <td class="row-actions">${edit ? html`<button class="link" data-edit="${e.id}">Edit</button><button class="link danger" data-delete="${e.id}">Delete</button>` : ''}</td>
          </tr>`)}</tbody>
        </table>`
      : html`<p class="muted" style="margin-top:12px">No attendance records in this range.</p>`);
  }

  const onFilter = () => {
    state.employeeId = el.querySelector('#f-emp').value;
    state.from = el.querySelector('#f-from').value;
    state.to = el.querySelector('#f-to').value;
    load();
  };
  ['#f-emp', '#f-from', '#f-to'].forEach((s) => el.querySelector(s).addEventListener('change', onFilter));

  el.querySelector('#add')?.addEventListener('click', () =>
    openEntryModal({ employeeId: state.employeeId || employees.find((e) => e.status === 'Active')?.id }, employees.filter((e) => e.status === 'Active'), load));

  el.querySelector('#dtr-table').addEventListener('click', async (ev) => {
    const t = ev.target;
    const find = (id) => rows.find((r) => r.entry.id === id).entry;
    const geo = t.closest('[data-geo]')?.dataset.geo;
    if (geo) {
      const { entry: e, emp } = rows.find((r) => r.entry.id === geo);
      return openLocation(e.clockInLocation, { name: fullName(emp), date: fmtDate(e.date), timeIn: fmtTime(e.timeIn), remote: e.remote });
    }
    try {
      if (t.dataset.edit) openEntryModal(find(t.dataset.edit), employees, load);
      if (t.dataset.approve) {
        await api.put(`/api/hris/time-entries/${t.dataset.approve}`, { ...find(t.dataset.approve), otApproved: true });
        toast('Overtime approved.');
        load();
      }
      if (t.dataset.delete && (await confirmDialog('Delete this attendance record?'))) {
        await api.del(`/api/hris/time-entries/${t.dataset.delete}`);
        toast('Record deleted.');
        load();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  el.querySelector('#export').addEventListener('click', () => {
    const seeLoc = can('attendance.location');
    const data = [
      ['Date', 'Employee No', 'Employee', 'Type', 'Time In', 'Time Out', 'Worked (min)', 'Late (min)', 'Undertime (min)', 'Overtime (min)', 'OT Approved',
        ...(seeLoc ? ['Clock-in Location', 'Latitude', 'Longitude', 'Accuracy (m)', 'Distance from Campus (m)'] : []), 'Notes'],
      ...rows.map(({ entry: e, emp, calc: c }) => [e.date, emp.employeeNo, fullName(emp), e.type === 'leave' ? leaveName(e) : e.remote ? 'Remote work' : 'Work', e.timeIn, e.timeOut, c.workedMinutes, c.lateMinutes, c.undertimeMinutes, c.overtimeMinutes, e.otApproved ? 'Yes' : 'No',
        ...(seeLoc ? [whereLabel(e), e.clockInLocation?.lat ?? '', e.clockInLocation?.lng ?? '', e.clockInLocation?.accuracy ?? '', e.clockInLocation?.distance ?? ''] : []), e.notes]),
    ];
    downloadFile(`dtr-${state.from}-to-${state.to}.csv`, toCsv(data));
  });

  await load();
}
