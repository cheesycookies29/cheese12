// Clock-in locations (HR Managers and Administrators): where each clock-in was made,
// flagged against the office location, and the office location itself.
import { api } from '../api.js';
import { ctx } from '../state.js';
import { LOCATION_STATUS, fmtDistance, hasOffice } from '/shared/geo.js';
import { html, mount, fmtDate, fmtTime, toast, modal, downloadFile, toCsv, today, addDays } from '../ui.js';
import { locationPill, openLocation, readClockLocation } from '../geo.js';

const FLAGS = { '': 'All clock-ins', outside: 'Outside office', none: 'No location', inside: 'Within office' };
const flagOf = (r) => (r.status !== 'ok' ? 'none' : r.inside === false && !r.remote ? 'outside' : r.inside ? 'inside' : '');

function openOfficeSettings(onSaved) {
  const s = ctx.settings.location;
  const { form } = modal({
    title: 'Office location',
    subtitle: 'Clock-ins farther than the radius are flagged "Outside office". They are never blocked.',
    submitLabel: 'Save',
    body: html`<div class="grid two">
        <label class="field span-2"><span>Name</span><input name="officeLabel" value="${s.officeLabel}" maxlength="60" placeholder="e.g. Makati office" /></label>
        <label class="field"><span>Latitude</span><input name="officeLat" inputmode="decimal" value="${s.officeLat ?? ''}" placeholder="e.g. 14.554729" /></label>
        <label class="field"><span>Longitude</span><input name="officeLng" inputmode="decimal" value="${s.officeLng ?? ''}" placeholder="e.g. 121.024445" /></label>
        <div class="span-2"><button type="button" class="btn small-btn" id="use-here">Use this device's current location</button>
          <small class="muted geo-here">Stand in the office when you use this. Or copy the coordinates from Google Maps (right-click the building).</small></div>
        <label class="field"><span>Radius (metres)</span><input type="number" name="radius" min="20" max="5000" step="10" value="${s.radius}" required />
          <small class="muted">150 m suits most offices; laptops on Wi-Fi can be off by a few hundred metres.</small></label>
        <label class="field"><span>Keep locations for (days)</span><input type="number" name="retentionDays" min="30" max="3650" step="1" value="${s.retentionDays}" required />
          <small class="muted">Older locations are deleted automatically; the attendance record stays.</small></label>
      </div>
      <p class="muted small">Leave latitude and longitude blank to record locations without an office check.</p>`,
    onSubmit: async (f) => {
      ctx.settings.location = await api.put('/api/location-settings', Object.fromEntries(new FormData(f)));
      toast('Office location saved. It applies to clock-ins from now on.');
      onSaved();
    },
  });
  form.querySelector('#use-here').addEventListener('click', async (e) => {
    const hint = form.querySelector('.geo-here');
    e.target.disabled = true;
    hint.textContent = 'Getting this device’s location…';
    const r = await readClockLocation();
    e.target.disabled = false;
    if (!r.location) return (hint.textContent = `${LOCATION_STATUS[r.locationError]}. Enter the coordinates instead.`);
    form.officeLat.value = r.location.lat.toFixed(6);
    form.officeLng.value = r.location.lng.toFixed(6);
    hint.textContent = `Filled in (accuracy ± ${fmtDistance(r.location.accuracy)}).`;
  });
}

export async function clockLocationsView(el, _params, query) {
  const employees = (await api.get('/api/employees')).sort((a, b) => a.lastName.localeCompare(b.lastName));
  const state = { from: query.from || addDays(today(), -6), to: query.to || today(), employeeId: query.employeeId || '', flag: FLAGS[query.flag] ? query.flag : '' };
  let all = [];

  function render() {
    const office = ctx.settings.location;
    const list = all.filter((r) => !state.flag || flagOf(r) === state.flag);
    const count = (f) => all.filter((r) => flagOf(r) === f).length;
    mount(el.querySelector('#office'), html`<div>
        <strong>${hasOffice(office) ? office.officeLabel : 'No office location set'}</strong>
        <span class="muted small">${hasOffice(office) ? `${office.officeLat.toFixed(5)}, ${office.officeLng.toFixed(5)} · radius ${fmtDistance(office.radius)}` : 'Locations are recorded, but not checked against an office.'} · kept ${office.retentionDays} days</span>
      </div><button class="btn small-btn" id="edit-office">${hasOffice(office) ? 'Change' : 'Set office location'}</button>`);
    mount(el.querySelector('#summary'), html`<div class="stats small">
      <div><small>Clock-ins</small><strong>${all.length}</strong></div>
      <div><small>Within office</small><strong>${count('inside')}</strong></div>
      <div><small>Outside office</small><strong>${count('outside')}</strong></div>
      <div><small>No location</small><strong>${count('none')}</strong></div>
    </div>`);
    mount(el.querySelector('#list'), list.length
      ? html`<table class="table">
          <thead><tr><th>Date</th><th>Employee</th><th>Time in</th><th>From</th><th>Location</th><th class="num">Accuracy</th><th></th></tr></thead>
          <tbody>${list.map((r) => html`<tr class="${flagOf(r) === 'outside' ? 'flag-row' : ''}">
            <td>${fmtDate(r.date)}</td>
            <td><strong>${r.name}</strong><small>${r.employeeNo}${r.department ? ` · ${r.department}` : ''}</small></td>
            <td>${fmtTime(r.timeIn)}</td>
            <td>${r.sourceLabel}</td>
            <td>${locationPill(r, { remote: r.remote })}${r.status !== 'ok' ? html`<small>${LOCATION_STATUS[r.status]}</small>` : ''}</td>
            <td class="num">${r.accuracy ? `± ${fmtDistance(r.accuracy)}` : '—'}</td>
            <td class="row-actions"><button class="link" data-open="${r.entryId}">${r.status === 'ok' ? 'View map' : 'Details'}</button></td>
          </tr>`)}</tbody>
        </table>`
      : html`<div class="empty"><p>${all.length ? 'No clock-ins match this filter.' : 'No clock-ins with location in this range. Locations are recorded from the next clock-in on.'}</p></div>`);
  }

  async function load() {
    const qs = new URLSearchParams(Object.entries({ from: state.from, to: state.to, employeeId: state.employeeId }).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/clock-locations?${qs}${state.flag ? `&flag=${state.flag}` : ''}`);
    all = await api.get(`/api/clock-locations?${qs}`);
    render();
  }

  mount(el, html`
    <header class="page-head">
      <div><h1>Clock-in locations</h1><p class="muted">Where each clock-in was made, from the device's location. Visible to HR Managers and Administrators only.</p></div>
      <div class="actions"><button class="btn" id="export">Export CSV</button></div>
    </header>
    <section class="card office-bar" id="office"></section>
    <section class="card">
      <div class="toolbar geo-filters">
        <select id="f-emp" aria-label="Employee"><option value="">All employees</option>${employees.map((e) => html`<option value="${e.id}" ${e.id === state.employeeId ? 'selected' : ''}>${e.lastName}, ${e.firstName}</option>`)}</select>
        <label class="inline">From <input type="date" id="f-from" value="${state.from}" /></label>
        <label class="inline">To <input type="date" id="f-to" value="${state.to}" /></label>
        <select id="f-flag" aria-label="Show">${Object.entries(FLAGS).map(([k, v]) => html`<option value="${k}" ${k === state.flag ? 'selected' : ''}>${v}</option>`)}</select>
      </div>
      <div id="summary"></div>
      <div id="list"></div>
      <p class="muted small">Locations come from each device's browser and are recorded at clock-in only. Phone GPS is usually accurate to 5–30 m; laptops on Wi-Fi can be off by a few hundred metres. A location can be faked with special tools, so treat a flag as a reason to check, not as proof. Approved remote-work days are not flagged.</p>
    </section>`);

  el.querySelector('#office').addEventListener('click', (e) => e.target.closest('#edit-office') && openOfficeSettings(render));
  el.querySelector('#list').addEventListener('click', (e) => {
    const r = all.find((x) => x.entryId === e.target.closest('[data-open]')?.dataset.open);
    if (r) openLocation(r, { name: r.name, date: fmtDate(r.date), timeIn: fmtTime(r.timeIn), remote: r.remote });
  });
  el.querySelector('#f-emp').addEventListener('change', (e) => ((state.employeeId = e.target.value), load()));
  el.querySelector('#f-from').addEventListener('change', (e) => ((state.from = e.target.value), load()));
  el.querySelector('#f-to').addEventListener('change', (e) => ((state.to = e.target.value), load()));
  el.querySelector('#f-flag').addEventListener('change', (e) => ((state.flag = e.target.value), load()));
  el.querySelector('#export').addEventListener('click', () => downloadFile(`clock-in-locations-${state.from}-to-${state.to}.csv`, toCsv([
    ['Date', 'Employee No', 'Employee', 'Department', 'Time In', 'Clocked In From', 'Status', 'Latitude', 'Longitude', 'Accuracy (m)', 'Distance from Office (m)', 'Within Office', 'Remote Day', 'Recorded At'],
    ...all.filter((r) => !state.flag || flagOf(r) === state.flag).map((r) => [r.date, r.employeeNo, r.name, r.department, r.timeIn, r.sourceLabel, LOCATION_STATUS[r.status], r.lat ?? '', r.lng ?? '', r.accuracy ?? '', r.distance ?? '',
      r.inside == null ? '' : r.inside ? 'Yes' : 'No', r.remote ? 'Yes' : 'No', r.at.replace('T', ' ').slice(0, 19)]),
  ])));
  await load();
}
