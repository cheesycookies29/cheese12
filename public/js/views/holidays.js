// Holidays: the calendar payroll uses for holiday pay. National holidays are loaded per year as
// proclaimed; HR adds Eid'l Fitr and Eid'l Adha when they are proclaimed, and local holidays.
import { api } from '../api.js';
import { ctx } from '../state.js';
import { HOLIDAY_TYPES } from '/shared/holidays.js';
import { html, mount, modal, toast, confirmDialog, fmtDate, badge, WEEKDAYS } from '../ui.js';

const TYPE_BADGE = { regular: 'maroon-soft', special: 'amber', 'special-working': 'gray' };
export const holidayBadge = (h) => badge(HOLIDAY_TYPES[h.type] || h.type, TYPE_BADGE[h.type]);
// Holidays on one date, from the calendar loaded at sign-in (for computeEntry and DTR badges).
export const holidaysOn = (date) => ctx.holidays.filter((h) => h.date === date);
// The badge beside a DTR date: the holiday (with the rest day if both), or "Rest day".
export function dayTag(c) {
  if (c.holiday) return html` ${badge(c.holiday, c.dayType.startsWith('special') ? 'amber' : 'maroon-soft')}${c.restDay ? html` ${badge('Rest day', 'gray')}` : ''}`;
  return c.restDay ? html` ${badge('Rest day', 'gray')}` : '';
}
const weekday = (ymd) => WEEKDAYS[new Date(`${ymd}T00:00`).getDay()];

function holidayForm(h = {}) {
  const opt = (v, label, cur) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  return html`<div class="grid">
    <label class="field"><span>Date</span><input type="date" name="date" value="${h.date || ''}" required /></label>
    <label class="field"><span>Name</span><input name="name" value="${h.name || ''}" maxlength="120" placeholder="e.g. Eid'l Fitr" required /></label>
    <label class="field"><span>Type</span><select name="type">${Object.entries(HOLIDAY_TYPES).map(([v, l]) => opt(v, l, h.type || 'regular'))}</select></label>
    <label class="field"><span>Applies to</span><select name="scope">${opt('national', 'The whole country', h.scope || 'national')}${opt('local', 'One city or province', h.scope)}</select></label>
    <label class="field place-field" ${h.scope === 'local' ? '' : 'hidden'}><span>Where</span><input name="place" value="${h.place || ''}" maxlength="80" placeholder="e.g. Taguig City" /></label>
    <label class="field"><span>Basis (optional)</span><input name="basis" value="${h.basis || ''}" maxlength="160" placeholder="e.g. Proclamation No. 1427, s. 2026" /></label>
  </div>
  <p class="muted small">Regular holidays are paid even when not worked, and 200% when worked. Special non-working days pay 130% when worked. A special working day is an ordinary day. Rates are in Payroll Setup.</p>`;
}

function openForm(h, after) {
  const { form } = modal({
    title: h ? `Edit ${h.name}` : 'Add a holiday',
    body: holidayForm(h || {}),
    submitLabel: h ? 'Save' : 'Add holiday',
    onSubmit: async (f) => {
      const body = { date: f.date.value, name: f.name.value, type: f.type.value, scope: f.scope.value, place: f.place.value, basis: f.basis.value };
      if (h) await api.put(`/api/holidays/${h.id}`, body);
      else await api.post('/api/holidays', body);
      toast(h ? 'Holiday saved.' : 'Holiday added. Recompute draft payroll runs that cover it.');
      after();
    },
  });
  form.scope.addEventListener('change', () => (form.querySelector('.place-field').hidden = form.scope.value !== 'local'));
}

export async function holidaysView(el, _params, query) {
  const presets = await api.get('/api/holidays/presets');
  const thisYear = new Date().getFullYear();
  const all = await api.get('/api/holidays');
  const years = [...new Set([thisYear, thisYear + 1, ...presets.map((p) => p.year), ...all.map((h) => Number(h.date.slice(0, 4)))])].sort();
  const year = years.includes(Number(query.year)) ? Number(query.year) : years.includes(thisYear + 1) && new Date().getMonth() >= 10 ? thisYear + 1 : thisYear;

  async function load() {
    const list = await api.get(`/api/holidays?year=${year}`);
    await ctx.refreshHolidays();
    const preset = presets.find((p) => p.year === year);
    const fresh = await api.get('/api/holidays/presets');
    const missing = preset ? preset.count - fresh.find((p) => p.year === year).loaded : 0;
    const count = (t) => list.filter((h) => h.type === t).length;
    mount(el, html`
      <header class="page-head">
        <div><h1>Holidays</h1>
          <p class="muted">The calendar payroll uses for holiday pay, and that leave and work-from-home requests skip. National holidays are loaded as proclaimed; add Eid'l Fitr and Eid'l Adha when they are proclaimed, and any local holiday.</p></div>
        <div class="actions"><button class="btn primary" id="add">+ Add holiday</button></div>
      </header>
      <nav class="tabs">${years.map((y) => html`<a href="#/holidays?year=${y}" class="${y === year ? 'active' : ''}">${y}</a>`)}</nav>
      ${missing > 0 ? html`<div class="notice">
          <p><strong>${missing} proclaimed holiday${missing === 1 ? ' is' : 's are'} not on the ${year} calendar.</strong> ${preset.basis} lists ${preset.count}.</p>
          <button class="btn" id="load">Load the ${year} national holidays</button></div>`
        : !preset ? html`<div class="notice"><p>CORE has no proclaimed list for ${year} yet. Add the holidays from the proclamation when it is out (usually in September of the year before).</p></div>` : ''}
      <div class="stats">
        <div class="card"><small>Regular holidays</small><strong>${count('regular')}</strong></div>
        <div class="card"><small>Special non-working days</small><strong>${count('special')}</strong></div>
        <div class="card"><small>Special working days</small><strong>${count('special-working')}</strong></div>
      </div>
      <section class="card scroll-x">
        ${list.length ? html`<table class="table stackable">
          <thead><tr><th>Date</th><th>Holiday</th><th>Type</th><th>Applies to</th><th>Basis</th><th></th></tr></thead>
          <tbody>${list.map((h) => html`<tr>
            <td><strong>${fmtDate(h.date, { month: 'short', day: 'numeric' })}</strong> <small class="muted">${weekday(h.date)}</small></td>
            <td>${h.name}</td>
            <td>${holidayBadge(h)}</td>
            <td>${h.scope === 'local' ? h.place : 'Nationwide'}</td>
            <td><small class="muted">${h.basis || '—'}</small></td>
            <td class="row-actions"><button class="link" data-edit="${h.id}">Edit</button><button class="link danger" data-delete="${h.id}">Delete</button></td>
          </tr>`)}</tbody></table>`
        : html`<div class="empty"><p>No holidays on the ${year} calendar yet.</p></div>`}
      </section>`);
    el.querySelector('#add').addEventListener('click', () => openForm(null, load));
    el.querySelector('#load')?.addEventListener('click', async () => {
      const res = await api.post('/api/holidays/load', { year });
      toast(`${res.added} holiday${res.added === 1 ? '' : 's'} added. Recompute draft payroll runs that cover them.`);
      load();
    });
    el.querySelector('tbody')?.addEventListener('click', async (e) => {
      const id = e.target.dataset.edit || e.target.dataset.delete;
      const h = id && list.find((x) => x.id === id);
      if (!h) return;
      if (e.target.dataset.edit) return openForm(h, load);
      if (!(await confirmDialog(`Remove ${h.name} (${fmtDate(h.date)}) from the calendar? Draft payroll runs change when recomputed; finalized runs do not.`, { confirmLabel: 'Remove' }))) return;
      await api.del(`/api/holidays/${h.id}`);
      toast('Holiday removed.');
      load();
    });
  }
  await load();
}
