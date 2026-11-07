// The shared time clock and clock-in locations, from the Lancaster ERP (public/js/views/time.js
// and locations.js there).
//  - Time clock: one computer at the campus (the HR office, the faculty room); employees pick
//    their name and clock in or out. Times are the server's.
//  - Clock-in locations: where each clock-in at this campus was made, flagged against the
//    campus location; and the campus location itself. HR managers and administrators only.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { LOCATION_STATUS, fmtDistance, hasOffice } from '/shared/geo.js';
import { html, mount, fmtDate, fmtTime, badge, toast, modal, downloadFile, toCsv, today, addDays } from '../../ui.js';
import { hr, can, leaveName } from '../state.js';
import { readClockLocation, LOCATION_NOTICE, locationPill, openLocation } from '../geo.js';

// ---------- Time clock ----------

export async function clockView(el) {
  let state = await api.get('/api/hris/clock');
  const people = state.people;
  const byId = new Map(people.map((e) => [e.id, e]));
  const seeLocation = can('attendance.location');

  mount(el, html`
    ${pageHead('Time clock', `Employees of ${ctx.info.campusName || 'this campus'} clock in and out here. Times are the server's, not this computer's.`)}
    <div class="cols clock-cols">
      <section class="card clock-card">
        <div class="clock-time" id="clock-time" aria-live="off"></div>
        <div class="clock-date" id="clock-date"></div>
        ${people.length
          ? html`<label class="field"><span>Employee</span>
              <select id="clock-emp"><option value="">Select your name…</option>${people.map((e) => html`<option value="${e.id}">${e.name} (${e.employeeNo})</option>`)}</select>
            </label>
            <div class="clock-status" id="clock-status" role="status"></div>
            <div class="clock-buttons">
              <button class="btn primary big" id="btn-in" disabled>${icon('clock', 18)} Clock in</button>
              <button class="btn big" id="btn-out" disabled>Clock out</button>
            </div>
            <p class="geo-notice">${LOCATION_NOTICE}</p>`
          : html`<p class="muted">There are no active employees at this campus yet. Add them under Employees first.</p>`}
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
  if (!people.length) return () => clearInterval(timer);

  const select = el.querySelector('#clock-emp');
  const btnIn = el.querySelector('#btn-in');
  const btnOut = el.querySelector('#btn-out');
  el.querySelector('#today-list').addEventListener('click', (ev) => {
    const e = state.entries.find((x) => x.id === ev.target.closest('[data-geo]')?.dataset.geo);
    if (e) openLocation(e.clockInLocation, { name: byId.get(e.employeeId)?.name || '', date: fmtDate(e.date), timeIn: fmtTime(e.timeIn), remote: e.remote });
  });

  function render() {
    const todays = state.entries.filter((e) => e.date === state.date && byId.has(e.employeeId));
    mount(el.querySelector('#today-list'), todays.length
      ? html`<div class="table-scroll"><table class="table compact"><thead><tr><th>Employee</th><th>In</th><th>Out</th>${seeLocation ? html`<th>Location</th>` : ''}</tr></thead><tbody>
          ${todays.sort((a, b) => (b.timeIn || '').localeCompare(a.timeIn || '')).map((e) => html`<tr>
            <td>${byId.get(e.employeeId).name}</td>
            <td>${e.type === 'leave' ? badge(leaveName(e), 'blue') : e.remote && !e.timeIn ? badge('Remote work', 'blue') : fmtTime(e.timeIn)}</td>
            <td>${e.type === 'leave' || !e.timeIn ? '' : e.timeOut ? fmtTime(e.timeOut) : badge('Working', 'green')}</td>
            ${seeLocation ? html`<td>${e.clockInLocation ? html`<button type="button" class="link geo-link" data-geo="${e.id}" aria-label="Clock-in location of ${byId.get(e.employeeId).name}">${locationPill(e.clockInLocation, { remote: e.remote })}</button>` : ''}</td>` : ''}</tr>`)}
        </tbody></table></div>`
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
    const open = state.entries.find((e) => e.employeeId === id && e.type === 'work' && e.timeIn && !e.timeOut);
    const todays = state.entries.find((e) => e.employeeId === id && e.date === state.date);
    const remoteDay = todays?.remote && !todays.timeIn; // approved remote day: clocking in records hours
    const done = !open && !remoteDay && todays;
    btnIn.disabled = Boolean(open || done);
    btnOut.disabled = !open;
    statusEl.textContent = open
      ? `Clocked in since ${open.date === state.date ? '' : `${fmtDate(open.date)} `}${fmtTime(open.timeIn)}.`
      : done
        ? done.type === 'leave' ? `On ${leaveName(done)} today.` : `Done for today (${fmtTime(done.timeIn)} – ${fmtTime(done.timeOut)}).`
        : remoteDay ? 'Approved for remote work today.' : 'Not clocked in.';
  }

  async function clock(action) {
    const btn = action === 'in' ? btnIn : btnOut;
    const label = btn.innerHTML;
    btnIn.disabled = btnOut.disabled = true;
    try {
      if (action === 'in') btn.textContent = 'Getting location…';
      const where = action === 'in' ? await readClockLocation() : {};
      const res = await api.post('/api/hris/clock', { employeeId: select.value, action, ...where });
      toast(res.message + (where.locationError ? ' The location could not be read on this computer; recorded without it.' : ''));
      // Ready for the next person.
      select.value = '';
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.innerHTML = label;
    state = await api.get('/api/hris/clock');
    render();
  }

  select.addEventListener('change', updateButtons);
  btnIn.addEventListener('click', () => clock('in'));
  btnOut.addEventListener('click', () => clock('out'));
  render();
  // Other people clock in from their phones too: keep "Today" current.
  const poll = setInterval(async () => {
    if (document.hidden) return;
    state = await api.get('/api/hris/clock').catch(() => state);
    render();
  }, 60000);
  return () => {
    clearInterval(timer);
    clearInterval(poll);
  };
}

// ---------- Clock-in locations ----------

const FLAGS = { '': 'All clock-ins', outside: 'Away from campus', none: 'No location', inside: 'On campus' };
const flagOf = (r) => (r.status !== 'ok' ? 'none' : r.inside === false && !r.remote ? 'outside' : r.inside ? 'inside' : '');

function openCampusLocation(onSaved) {
  const s = hr.settings.location;
  const { form } = modal({
    title: 'Campus location',
    subtitle: `${ctx.info.campusName || 'This campus'}. Clock-ins farther than the radius are flagged "Away from campus". They are never blocked.`,
    submitLabel: 'Save',
    body: html`<div class="grid two">
        <label class="field span-2"><span>Name</span><input name="officeLabel" value="${s.officeLabel}" maxlength="60" placeholder="e.g. Main campus" /></label>
        <label class="field"><span>Latitude</span><input name="officeLat" inputmode="decimal" value="${s.officeLat ?? ''}" placeholder="e.g. 13.587652" /></label>
        <label class="field"><span>Longitude</span><input name="officeLng" inputmode="decimal" value="${s.officeLng ?? ''}" placeholder="e.g. 123.283431" /></label>
        <div class="span-2"><button type="button" class="btn sm" id="use-here">${icon('mapPin', 14)} Use this device's current location</button>
          <span class="hint geo-here" role="status">Stand on campus when you use this. Or copy the coordinates from Google Maps (right-click the main building).</span></div>
        <label class="field"><span>Radius (metres)</span><input type="number" name="radius" min="20" max="5000" step="10" value="${s.radius}" required />
          <span class="hint">300 m covers most campuses; laptops on Wi-Fi can be off by a few hundred metres.</span></label>
        <label class="field"><span>Keep locations for (days)</span><input type="number" name="retentionDays" min="30" max="3650" step="1" value="${s.retentionDays}" required />
          <span class="hint">Older locations are deleted automatically; the attendance record stays.</span></label>
      </div>
      <p class="muted small">Leave latitude and longitude blank to record locations without a campus check.</p>`,
    onSubmit: async (f) => {
      hr.settings.location = await api.put('/api/hris/location-settings', Object.fromEntries(new FormData(f)));
      toast('Campus location saved. It applies to clock-ins from now on.');
      onSaved();
    },
  });
  form.querySelector('#use-here').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const hint = form.querySelector('.geo-here');
    btn.disabled = true;
    hint.textContent = 'Getting this device’s location…';
    const r = await readClockLocation();
    btn.disabled = false;
    if (!r.location) return (hint.textContent = `${LOCATION_STATUS[r.locationError]}. Enter the coordinates instead.`);
    form.officeLat.value = r.location.lat.toFixed(6);
    form.officeLng.value = r.location.lng.toFixed(6);
    hint.textContent = `Filled in (accuracy ± ${fmtDistance(r.location.accuracy)}).`;
  });
}

export async function clockLocationsView(el, _params, query) {
  const employees = (await api.get('/api/hris/employees')).sort((a, b) => a.lastName.localeCompare(b.lastName));
  const state = { from: query.from || addDays(today(), -6), to: query.to || today(), employeeId: query.employeeId || '', flag: FLAGS[query.flag] ? query.flag : '' };
  let all = [];

  function render() {
    const office = hr.settings.location;
    const list = all.filter((r) => !state.flag || flagOf(r) === state.flag);
    const count = (f) => all.filter((r) => flagOf(r) === f).length;
    mount(el.querySelector('#office'), html`<div>
        <strong>${hasOffice(office) ? office.officeLabel : 'No campus location set'}</strong>
        <span class="muted small">${hasOffice(office) ? `${office.officeLat.toFixed(5)}, ${office.officeLng.toFixed(5)} · radius ${fmtDistance(office.radius)}` : 'Locations are recorded, but not checked against the campus.'} · kept ${office.retentionDays} days</span>
      </div><button class="btn" id="edit-office">${icon('mapPin', 16)} ${hasOffice(office) ? 'Change' : 'Set campus location'}</button>`);
    mount(el.querySelector('#summary'), html`<div class="stats small">
      <div><small>Clock-ins</small><strong>${all.length}</strong></div>
      <div><small>On campus</small><strong>${count('inside')}</strong></div>
      <div><small>Away from campus</small><strong>${count('outside')}</strong></div>
      <div><small>No location</small><strong>${count('none')}</strong></div>
    </div>`);
    mount(el.querySelector('#list'), list.length
      ? html`<div class="table-scroll"><table class="table">
          <thead><tr><th>Date</th><th>Employee</th><th>Time in</th><th>From</th><th>Location</th><th class="num">Accuracy</th><th></th></tr></thead>
          <tbody>${list.map((r) => html`<tr class="${flagOf(r) === 'outside' ? 'flag-row' : ''}">
            <td class="nowrap">${fmtDate(r.date)}</td>
            <td><strong>${r.name}</strong><small>${r.employeeNo}${r.department ? ` · ${r.department}` : ''}</small></td>
            <td class="nowrap">${fmtTime(r.timeIn)}</td>
            <td>${r.sourceLabel}</td>
            <td>${locationPill(r, { remote: r.remote })}${r.status !== 'ok' ? html`<small>${LOCATION_STATUS[r.status]}</small>` : ''}</td>
            <td class="num">${r.accuracy ? `± ${fmtDistance(r.accuracy)}` : '—'}</td>
            <td class="row-actions"><button class="btn sm" data-open="${r.entryId}">${r.status === 'ok' ? 'View map' : 'Details'}</button></td>
          </tr>`)}</tbody>
        </table></div>`
      : html`<div class="empty"><p>${all.length ? 'No clock-ins match this filter.' : 'No clock-ins with a location in this range. Locations are recorded from the next clock-in on.'}</p></div>`);
  }

  async function load() {
    const qs = new URLSearchParams(Object.entries({ from: state.from, to: state.to, employeeId: state.employeeId }).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/clock-locations?${qs}${state.flag ? `&flag=${state.flag}` : ''}`);
    all = await api.get(`/api/hris/clock-locations?${qs}`);
    render();
  }

  mount(el, html`
    ${pageHead('Clock-in locations', `Where each clock-in at ${ctx.info.campusName || 'this campus'} was made, from the device's location. Only HR managers and administrators see this.`, html`<button class="btn" id="export">${icon('download', 16)} Export CSV</button>`)}
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

  el.querySelector('#office').addEventListener('click', (e) => e.target.closest('#edit-office') && openCampusLocation(render));
  el.querySelector('#list').addEventListener('click', (e) => {
    const r = all.find((x) => x.entryId === e.target.closest('[data-open]')?.dataset.open);
    if (r) openLocation(r, { name: r.name, date: fmtDate(r.date), timeIn: fmtTime(r.timeIn), remote: r.remote });
  });
  el.querySelector('#f-emp').addEventListener('change', (e) => ((state.employeeId = e.target.value), load()));
  el.querySelector('#f-from').addEventListener('change', (e) => ((state.from = e.target.value), load()));
  el.querySelector('#f-to').addEventListener('change', (e) => ((state.to = e.target.value), load()));
  el.querySelector('#f-flag').addEventListener('change', (e) => ((state.flag = e.target.value), load()));
  el.querySelector('#export').addEventListener('click', () => downloadFile(`clock-in-locations-${state.from}-to-${state.to}.csv`, toCsv([
    ['Date', 'Employee No', 'Employee', 'Department', 'Time In', 'Clocked In From', 'Status', 'Latitude', 'Longitude', 'Accuracy (m)', 'Distance from Campus (m)', 'On Campus', 'Remote Day', 'Recorded At'],
    ...all.filter((r) => !state.flag || flagOf(r) === state.flag).map((r) => [r.date, r.employeeNo, r.name, r.department, r.timeIn, r.sourceLabel, LOCATION_STATUS[r.status], r.lat ?? '', r.lng ?? '', r.accuracy ?? '', r.distance ?? '',
      r.inside == null ? '' : r.inside ? 'Yes' : 'No', r.remote ? 'Yes' : 'No', r.at.replace('T', ' ').slice(0, 19)]),
  ])));
  await load();
}
