// The school calendar screen, shared by ATLAS Learn (students, teachers, parents & guardians) and the
// Admin panel (School calendar). Month, week and list views; filters by kind of entry; a parent's
// student picker; the day and entry details; keyboard use of the month grid (WAI-ARIA date grid:
// arrows, Home/End, Page Up/Down, Enter); subscribing from another calendar app.
// Patterns from FullCalendar (+N more, list view), Moodle (filter types) and Schedule-X (agenda on phones).
import { api } from './api.js';
import { html, mount, modal, toast, confirmDialog, today } from './ui.js';
import { icon } from './icons.js';
import { pageHead } from './shell.js';
import { formatTime } from '/shared/schedule.js';
import { addDays, weekday, eachDay, daysBetween } from '/shared/calendar.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_CHIPS = 3;
const STATE = { done: ['Handed in', 'green'], missing: ['Missing', 'red'], overdue: ['Overdue', 'amber'], due: ['To do', 'blue'] };
const FILTER_KEY = 'atlas.calendar.hidden';

const asDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const longDate = (s) => asDate(s).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (s) => asDate(s).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
const monthTitle = (s) => asDate(s).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
const firstOfMonth = (s) => `${s.slice(0, 7)}-01`;
const addMonths = (s, n) => {
  const d = asDate(firstOfMonth(s));
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const weekStart = (s) => addDays(s, -weekday(s));
const lastOfMonth = (s) => addDays(addMonths(s, 1), -1);
export const entryTime = (e) => (e.startTime ? (e.dueTime ? `Due ${formatTime(e.startTime)}` : `${formatTime(e.startTime)}${e.endTime ? `–${formatTime(e.endTime)}` : ''}`) : e.endDate && e.endDate !== e.date ? `${shortDate(e.date)} – ${shortDate(e.endDate)}` : 'All day');
// "9am", "11:59pm": short times for the month and week.
const shortTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
};
const onDay = (e, day) => e.date <= day && (e.endDate || e.date) >= day;
// Multi-day bars first (in the same order every day, so they line up), then all-day, then by time.
const span1 = (e) => (e.endDate || e.date) !== e.date;
const order = (a, b) => Number(span1(b)) - Number(span1(a)) || (span1(a) && span1(b) ? a.date.localeCompare(b.date) || a.id.localeCompare(b.id) : 0)
  || Number(Boolean(a.startTime && !span1(a))) - Number(Boolean(b.startTime && !span1(b))) || (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title);

function readHidden() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FILTER_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function keepHidden(set) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify([...set]));
  } catch {}
}

// opts: { title, subtitle, endpoint, query (route query), hashBase ('#/calendar'), subscribe (bool),
//         admin: { onAdd(date), onEdit(entry), onDelete(entry) } }
export async function calendarScreen(el, opts) {
  const q = opts.query || {};
  const phone = window.matchMedia('(max-width: 720px)').matches;
  const state = {
    view: ['month', 'week', 'list'].includes(q.v) ? q.v : phone ? 'list' : 'month',
    date: /^\d{4}-\d{2}-\d{2}$/.test(q.d || '') ? q.d : today(), // the server's "today" replaces it below
    child: q.child || '',
    hidden: readHidden(),
    focus: null, // the focused day in the month grid
  };
  let data = null;
  const cache = new Map();

  const span = () => {
    if (state.view === 'week') {
      const s = weekStart(state.date);
      return { start: s, end: addDays(s, 6) };
    }
    const first = firstOfMonth(state.date);
    if (state.view === 'list') return { start: first, end: lastOfMonth(first) };
    const s = weekStart(first); // six weeks, so every month has the same shape
    return { start: s, end: addDays(s, 41) };
  };
  const title = () => {
    if (state.view !== 'week') return monthTitle(state.date);
    const { start, end } = span();
    return `${asDate(start).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${asDate(end).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };
  const keepUrl = () => {
    const p = new URLSearchParams({ v: state.view, d: state.date, ...(state.child ? { child: state.child } : {}) });
    history.replaceState(null, '', `${opts.hashBase}?${p}`);
  };
  async function load() {
    const { start, end } = span();
    const key = `${start}|${end}|${state.child}`;
    if (!cache.has(key)) cache.set(key, api.get(`${opts.endpoint}?start=${start}&end=${end}${state.child ? `&child=${encodeURIComponent(state.child)}` : ''}`));
    try {
      data = await cache.get(key);
    } catch (err) {
      cache.delete(key);
      throw err;
    }
    if (data.child && !state.child) state.child = data.child;
  }
  const visible = () => (data?.entries || []).filter((e) => !state.hidden.has(e.kind));

  // ----- Pieces -----
  const who = (e) => (e.childName ? `${e.childName}: ` : '');
  const multiDay = (e) => (e.endDate || e.date) !== e.date;
  const allDay = (e) => !e.startTime || multiDay(e);
  // A month entry. All-day and multi-day entries are bars (joined across the days they cover);
  // timed ones are a coloured dot, the time and the title, as in most calendar apps.
  const chip = (e, day) => {
    const name = `${who(e)}${e.title}`;
    if (allDay(e)) {
      const starts = e.date === day;
      const ends = (e.endDate || e.date) === day;
      const label = starts || weekday(day) === 0 || !multiDay(e);
      // The title runs along the bar to the end of the week (or of the event).
      const run = label && multiDay(e) ? Math.min(6 - weekday(day), daysBetween(day, e.endDate)) + 1 : 1;
      return html`<button type="button" class="cal-bar k-${e.kind} ${starts ? '' : 'cont-l'} ${ends ? '' : 'cont-r'} ${run > 1 ? 'runs' : ''}" style="${run > 1 ? `--run:${run}` : ''}" data-entry="${e.id}" title="${name}" ${label ? '' : html`aria-label="${name} (continued)"`}>
        <span class="cal-title">${label ? name : ''}</span></button>`;
    }
    return html`<button type="button" class="cal-item k-${e.kind} ${e.state ? `s-${e.state}` : ''}" data-entry="${e.id}" title="${name}${e.sub ? ` · ${e.sub}` : ''}">
      <span class="cal-dot" aria-hidden="true"></span><span class="cal-time">${shortTime(e.startTime)}</span>
      <span class="cal-title">${name}</span>${e.state === 'done' ? html`<span class="cal-done" role="img" aria-label="handed in">${icon('check', 12)}</span>` : e.state === 'missing' ? html`<span class="cal-missing" role="img" aria-label="missing">!</span>` : ''}</button>`;
  };
  const stateBadge = (e) => (e.state && STATE[e.state] ? html`<span class="badge ${STATE[e.state][1]}">${STATE[e.state][0]}</span>` : '');
  const meta = (e) => [kindLabel(e), e.sub, e.location].filter(Boolean).join(' · ');
  // A row in the week, the list and a day's details.
  const row = (e) => html`<li><button type="button" class="cal-row k-${e.kind} ${e.state ? `s-${e.state}` : ''}" data-entry="${e.id}">
      <span class="cal-row-time">${allDay(e) ? (multiDay(e) ? `${shortDate(e.date).replace(/^\w+, /, '')} – ${shortDate(e.endDate).replace(/^\w+, /, '')}` : 'All day') : e.dueTime ? `Due ${shortTime(e.startTime)}` : `${shortTime(e.startTime)}${e.endTime ? ` – ${shortTime(e.endTime)}` : ''}`}</span>
      <span class="cal-dot" aria-hidden="true"></span>
      <span class="cal-row-main"><span class="cal-row-title">${who(e)}${e.title}</span><small>${meta(e)}</small></span>
      ${stateBadge(e)}</button></li>`;
  const kindLabel = (e) => (e.categoryLabel && e.kind !== 'term' ? e.categoryLabel : e.kind === 'due' ? (e.activityKind === 'quiz' ? 'Quiz closes' : 'Activity due') : data.kinds.find((k) => k.id === e.kind)?.one || '');

  function monthGrid() {
    const { start } = span();
    const month = state.date.slice(0, 7);
    const days = eachDay(start, addDays(start, 41));
    const list = visible();
    state.focus = state.focus && days.includes(state.focus) ? state.focus : days.includes(data.today) && data.today.startsWith(month) ? data.today : firstOfMonth(state.date);
    const weeks = [0, 1, 2, 3, 4, 5].map((w) => days.slice(w * 7, w * 7 + 7));
    return html`<div class="cal-month-wrap"><table class="cal-month" role="grid" aria-labelledby="cal-title">
      <thead><tr>${WEEKDAYS.map((d) => html`<th scope="col" abbr="${d}"><span aria-hidden="true">${d.slice(0, 3)}</span></th>`)}</tr></thead>
      <tbody>${weeks.map((w) => html`<tr>${w.map((day) => {
        const items = list.filter((e) => onDay(e, day)).sort(order);
        const holiday = items.find((e) => e.kind === 'holiday');
        const out = !day.startsWith(month);
        const label = `${longDate(day)}${out ? ' (another month)' : ''}${day === data.today ? ', today' : ''}, ${items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'nothing'}${holiday ? `, ${holiday.title}` : ''}`;
        return html`<td role="gridcell" class="cal-day ${out ? 'out' : ''} ${day === data.today ? 'today' : ''} ${holiday ? 'no-classes' : ''}"
          data-date="${day}" tabindex="${day === state.focus ? 0 : -1}" aria-label="${label}" ${day === data.today ? 'aria-current="date"' : ''}>
          <span class="cal-num" aria-hidden="true">${asDate(day).getDate() === 1 ? asDate(day).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : asDate(day).getDate()}</span>
          <div class="cal-chips">${items.slice(0, MAX_CHIPS).map((e) => chip(e, day))}
            ${items.length > MAX_CHIPS ? html`<button type="button" class="cal-more" data-day="${day}" aria-label="Show all ${items.length} items for ${longDate(day)}">${items.length - MAX_CHIPS} more</button>` : ''}</div></td>`;
      })}</tr>`)}</tbody></table></div>`;
  }

  // The week: one grid of seven days, all-day entries on top, then the day's entries by time.
  function weekView() {
    const { start } = span();
    const list = visible();
    return html`<div class="cal-week">${eachDay(start, addDays(start, 6)).map((day) => {
      const items = list.filter((e) => onDay(e, day)).sort(order);
      const bars = items.filter(allDay);
      const timed = items.filter((e) => !allDay(e));
      return html`<section class="cal-week-day ${day === data.today ? 'today' : ''} ${items.some((e) => e.kind === 'holiday') ? 'no-classes' : ''}" aria-label="${longDate(day)}">
        <h3><button type="button" class="cal-week-date" data-day="${day}" aria-label="${longDate(day)}: show the day"><span class="dow">${WEEKDAYS[weekday(day)].slice(0, 3)}</span><span class="num">${asDate(day).getDate()}</span></button></h3>
        ${bars.length ? html`<div class="cal-week-bars">${bars.map((e) => chip(e, day))}</div>` : ''}
        ${timed.length ? html`<ul class="cal-week-items">${timed.map((e) => html`<li><button type="button" class="cal-block k-${e.kind} ${e.state ? `s-${e.state}` : ''}" data-entry="${e.id}">
          <span class="cal-block-time">${e.dueTime ? `Due ${shortTime(e.startTime)}` : `${shortTime(e.startTime)}${e.endTime ? ` – ${shortTime(e.endTime)}` : ''}`}</span>
          <span class="cal-block-title">${who(e)}${e.title}</span>
          ${e.sub ? html`<span class="cal-block-sub">${e.kind === 'class' ? [e.sub, e.location].filter(Boolean).join(' · ') : e.sub}</span>` : ''}
          ${e.state && STATE[e.state] ? html`<span class="cal-block-state">${STATE[e.state][0]}</span>` : ''}</button></li>`)}</ul>` : ''}
        ${!items.length ? html`<p class="cal-empty">Free</p>` : ''}
        ${opts.admin ? html`<button type="button" class="cal-add" data-add="${day}" aria-label="Add an event on ${longDate(day)}">${icon('plus', 14)} Add</button>` : ''}</section>`;
    })}</div>`;
  }

  // The list (agenda): only the days with something on them, the date on the left.
  function listView() {
    const { start, end } = span();
    const list = visible();
    const days = eachDay(start, end).map((day) => ({ day, items: list.filter((e) => onDay(e, day)).sort(order) })).filter((x) => x.items.length);
    return days.length ? html`<div class="cal-agenda">${days.map(({ day, items }) => html`<section class="cal-ag-day ${day === data.today ? 'today' : ''}" aria-label="${longDate(day)}">
        <div class="cal-ag-date" aria-hidden="true"><span class="num">${asDate(day).getDate()}</span><span class="dow">${asDate(day).toLocaleDateString('en-PH', { weekday: 'short' })}${day === data.today ? ' · Today' : ''}</span></div>
        <ul class="cal-rows">${items.map(row)}</ul></section>`)}</div>`
      : html`<div class="card empty">${icon('calendar', 32)}<p>Nothing on the calendar in ${monthTitle(state.date)}${state.hidden.size ? ' with these filters' : ''}.</p></div>`;
  }

  function draw() {
    const counts = Object.fromEntries(data.kinds.map((k) => [k.id, (data.entries || []).filter((e) => e.kind === k.id).length]));
    const unit = state.view === 'week' ? 'week' : 'month';
    mount(el, html`
      ${pageHead(opts.title, opts.subtitle || '', html`${opts.subscribe ? html`<button class="btn" id="cal-subscribe">${icon('link', 16)} Subscribe</button>` : ''}
          <button class="btn ghost" id="cal-print">${icon('file', 16)} Print</button>${opts.admin ? html`<button class="btn primary" id="cal-new">${icon('plus', 16)} New event</button>` : ''}`)}
      <div class="cal-shell">
        <div class="cal-toolbar">
          <div class="cal-nav">
            <h2 id="cal-title" aria-live="polite">${title()}</h2>
            <div class="cal-arrows"><button class="icon-btn" id="cal-prev" aria-label="Previous ${unit}">${icon('chevronLeft', 18)}</button><button class="icon-btn" id="cal-next" aria-label="Next ${unit}">${icon('chevronRight', 18)}</button></div>
            <button class="btn sm" id="cal-today">Today</button>
          </div>
          <div class="cal-tools">
            ${data.children?.length ? html`<label class="cal-child"><span class="sr-only">Student</span><select id="cal-child">${data.children.length > 1 ? html`<option value="all" ${state.child === 'all' ? 'selected' : ''}>All my students</option>` : ''}${data.children.map((c) => html`<option value="${c.id}" ${state.child === c.id ? 'selected' : ''}>${c.name}</option>`)}</select></label>` : ''}
            <div class="seg cal-seg" role="group" aria-label="View">${[['month', 'Month'], ['week', 'Week'], ['list', 'List']].map(([v, l]) => html`<button type="button" data-view="${v}" class="${state.view === v ? 'on' : ''}" aria-pressed="${state.view === v}">${l}</button>`)}</div>
          </div>
        </div>
        <div class="cal-legend" role="group" aria-label="Show on the calendar">${data.kinds.map((k) => html`<button type="button" class="cal-key k-${k.id} ${state.hidden.has(k.id) ? '' : 'on'}" data-kind="${k.id}" aria-pressed="${!state.hidden.has(k.id)}">
          <span class="cal-swatch" aria-hidden="true">${icon('check', 11)}</span>${k.label}<span class="count">${counts[k.id]}</span></button>`)}</div>
        ${state.view === 'month' ? monthGrid() : state.view === 'week' ? weekView() : listView()}
      </div>`);
  }

  async function go(changes = {}, { focus = false } = {}) {
    Object.assign(state, changes);
    keepUrl();
    try {
      await load();
    } catch (err) {
      return toast(err.message, 'error');
    }
    draw();
    if (focus) el.querySelector(`.cal-day[data-date="${state.focus}"]`)?.focus();
  }

  // ----- Details -----
  const byId = (id) => data.entries.find((e) => e.id === id);
  function showEntry(e) {
    const st = e.state && STATE[e.state];
    const fact = (ic, content) => html`<li><span class="cal-fact-ic" aria-hidden="true">${icon(ic, 16)}</span><span>${content}</span></li>`;
    const forWhom = e.audience?.length ? e.audience.map((a) => ({ student: 'Students', teacher: 'Teachers', guardian: 'Parents & guardians' })[a]).join(', ') : 'Everyone';
    const m = modal({
      title: `${who(e)}${e.title}`, submitLabel: null, className: `cal-entry k-${e.kind}`,
      subtitle: html`<span class="cal-dot" aria-hidden="true"></span> ${kindLabel(e)}${st ? html` · ${st[0]}` : ''}`,
      body: html`<ul class="cal-facts">
        ${fact('calendar', html`${multiDay(e) ? `${longDate(e.date)} to ${longDate(e.endDate)}` : longDate(e.date)}${e.startTime && !multiDay(e) ? html`<small>${entryTime(e)}</small>` : html`<small>All day</small>`}`)}
        ${e.sub ? fact(e.kind === 'class' || e.kind === 'due' ? 'book' : 'calendar', e.sub) : ''}
        ${e.location ? fact('mapPin', e.location) : ''}
        ${e.campusName ? fact('building', e.campusName) : ''}
        ${e.noClasses ? fact('flag', `No classes${multiDay(e) ? ' on these days' : ' this day'}`) : ''}
        ${opts.admin && e.audience ? fact('users', `For: ${forWhom}`) : ''}
      </ul>
      ${e.description ? html`<p class="cal-desc pre">${e.description}</p>` : ''}
      ${(e.href && !opts.admin) || (opts.admin && e.eventId) ? html`<div class="actions cal-entry-actions">${e.href && !opts.admin ? html`<a class="btn primary" href="${e.href}">${e.kind === 'class' ? 'Open the class' : e.kind === 'due' ? `Open the ${e.activityKind === 'quiz' ? 'quiz' : 'activity'}` : 'Open'}</a>` : ''}
        ${opts.admin && e.eventId ? html`<button type="button" class="btn" data-edit>${icon('edit', 15)} Edit</button><button type="button" class="btn danger ghost" data-delete>${icon('trash', 15)} Delete</button>` : ''}</div>` : ''}`,
    });
    const form = m?.form || document.querySelector('.modal-backdrop:last-child form');
    form?.querySelector('[data-edit]')?.addEventListener('click', () => {
      form.querySelector('[data-close]').click();
      opts.admin.onEdit(e, refresh);
    });
    form?.querySelector('[data-delete]')?.addEventListener('click', async () => {
      form.querySelector('[data-close]').click();
      if (!(await confirmDialog(`Delete "${e.title}" from the calendar?`, { confirmLabel: 'Delete' }))) return;
      await opts.admin.onDelete(e);
      refresh();
    });
  }
  function showDay(day) {
    const items = visible().filter((e) => onDay(e, day)).sort(order);
    const m = modal({
      title: longDate(day), submitLabel: null,
      body: html`${items.length ? html`<ul class="cal-rows">${items.map(row)}</ul>` : html`<p class="muted">Nothing on the calendar this day.</p>`}
        ${opts.admin ? html`<div class="actions"><button type="button" class="btn primary" data-add-day>${icon('plus', 15)} Add an event on this day</button></div>` : ''}`,
    });
    const form = m?.form || document.querySelector('.modal-backdrop:last-child form');
    form?.addEventListener('click', (ev) => {
      const id = ev.target.closest('[data-entry]')?.dataset.entry;
      if (id) {
        form.querySelector('[data-close]').click();
        showEntry(byId(id));
      }
      if (ev.target.closest('[data-add-day]')) {
        form.querySelector('[data-close]').click();
        opts.admin.onAdd(day, refresh);
      }
    });
  }
  async function refresh() {
    cache.clear();
    await go();
  }

  function subscribeDialog() {
    let current = null;
    const body = () => html`<p>Add your ATLAS calendar to Google Calendar, Outlook or your phone's calendar. It updates on its own every few hours, and shows the same as here, from a month ago to six months ahead.</p>
      ${current ? html`<label class="field"><span>Your private calendar address</span><input id="ics-url" value="${current}" readonly /></label>
        <div class="actions"><button type="button" class="btn primary" id="ics-copy">${icon('link', 15)} Copy address</button><a class="btn" href="${current.replace(/^https?:/, 'webcal:')}">Open in my calendar app</a></div>
        <ul class="small muted cal-help-list"><li><strong>Google Calendar:</strong> Other calendars → + → From URL, and paste the address.</li><li><strong>iPhone:</strong> Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.</li><li><strong>Outlook:</strong> Add calendar → Subscribe from web.</li></ul>
        <p class="small">Anyone with this address can see your calendar. If you shared it by mistake, get a new one: the old one stops working.</p>
        <div class="actions"><button type="button" class="btn sm" id="ics-new">Get a new address</button><button type="button" class="btn sm danger ghost" id="ics-stop">Stop sharing</button></div>`
        : html`<div class="actions"><button type="button" class="btn primary" id="ics-make">${icon('link', 15)} Make my calendar address</button></div>`}`;
    const m = modal({ title: 'Subscribe from another calendar', submitLabel: null, body: html`<div id="ics-body">${body()}</div>` });
    const form = m?.form || document.querySelector('.modal-backdrop:last-child form');
    const redraw = () => mount(form.querySelector('#ics-body'), body());
    api.get('/api/calendar/subscription').then((r) => {
      current = r.url;
      redraw();
    });
    form.addEventListener('click', async (ev) => {
      if (ev.target.closest('#ics-make') || ev.target.closest('#ics-new')) {
        if (ev.target.closest('#ics-new') && !(await confirmDialog('Get a new address? Calendars using the old one stop updating.', { confirmLabel: 'Get a new one', danger: false }))) return;
        current = (await api.post('/api/calendar/subscription')).url;
        redraw();
      } else if (ev.target.closest('#ics-stop')) {
        current = (await api.del('/api/calendar/subscription')).url;
        redraw();
        toast('Calendar address removed.');
      } else if (ev.target.closest('#ics-copy')) {
        const input = form.querySelector('#ics-url');
        try {
          await navigator.clipboard.writeText(input.value);
          toast('Address copied.');
        } catch {
          input.select();
          toast('Select the address and copy it.');
        }
      }
    });
  }

  // ----- Events -----
  el.onclick = (e) => {
    const t = e.target;
    const entry = t.closest('[data-entry]');
    if (entry && byId(entry.dataset.entry)) return showEntry(byId(entry.dataset.entry));
    const more = t.closest('[data-day]');
    if (more) return showDay(more.dataset.day);
    const add = t.closest('[data-add]');
    if (add) return opts.admin.onAdd(add.dataset.add, refresh);
    const kind = t.closest('[data-kind]');
    if (kind) {
      state.hidden[state.hidden.has(kind.dataset.kind) ? 'delete' : 'add'](kind.dataset.kind);
      keepHidden(state.hidden);
      return draw();
    }
    const view = t.closest('[data-view]');
    if (view) return go({ view: view.dataset.view });
    if (t.closest('#cal-today')) return go({ date: data.today, focus: data.today });
    if (t.closest('#cal-prev') || t.closest('#cal-next')) {
      const n = t.closest('#cal-prev') ? -1 : 1;
      return go({ date: state.view === 'week' ? addDays(state.date, 7 * n) : addMonths(state.date, n), focus: null });
    }
    if (t.closest('#cal-subscribe')) return subscribeDialog();
    if (t.closest('#cal-print')) return window.print();
    if (t.closest('#cal-new')) return opts.admin.onAdd(state.focus && state.view === 'month' ? state.focus : data.today, refresh);
    const cell = t.closest('.cal-day');
    if (cell && !t.closest('button')) {
      state.focus = cell.dataset.date;
      el.querySelectorAll('.cal-day').forEach((c) => c.setAttribute('tabindex', c === cell ? '0' : '-1'));
      return showDay(cell.dataset.date);
    }
  };
  el.onchange = (e) => {
    if (e.target.id === 'cal-child') go({ child: e.target.value });
  };
  // The month grid from the keyboard (one cell is in the Tab order; arrows move between days).
  el.onkeydown = (e) => {
    const cell = e.target.closest?.('.cal-day');
    if (!cell || e.target !== cell) return;
    const day = cell.dataset.date;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday(day), End: 6 - weekday(day) };
    let next = null;
    if (e.key in moves) next = addDays(day, moves[e.key]);
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const n = (e.key === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1);
      const target = addMonths(day, n);
      next = `${target.slice(0, 8)}${String(Math.min(asDate(day).getDate(), asDate(lastOfMonth(target)).getDate())).padStart(2, '0')}`;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      return showDay(day);
    }
    if (!next) return;
    e.preventDefault();
    if (next.slice(0, 7) !== state.date.slice(0, 7)) return go({ date: next, focus: next }, { focus: true });
    state.focus = next;
    el.querySelectorAll('.cal-day').forEach((c) => c.setAttribute('tabindex', c.dataset.date === next ? '0' : '-1'));
    el.querySelector(`.cal-day[data-date="${next}"]`)?.focus();
  };

  await go();
}
