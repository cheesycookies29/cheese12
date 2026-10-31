// Weekly timetable of a term's classes.
import { api } from '../../api.js';
import { html, mount, option, empty, raw } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { DAYS, toMinutes, formatTime } from '/shared/schedule.js';
import { isTeacher } from '../common.js';

const PX_PER_MIN = 1.1;

export async function scheduleView(el, params, query) {
  const d = await api.get(`/api/schedule${query.termId ? `?termId=${query.termId}` : ''}`);
  const classes = d.classes.filter((c) => c.meetings.length);
  const unscheduled = d.classes.filter((c) => !c.meetings.length);
  const meetings = classes.flatMap((c) => c.meetings.map((m) => ({ ...m, c })));
  // Mon–Fri always; weekend columns only when something meets then.
  const days = [1, 2, 3, 4, 5, ...[6, 0].filter((day) => meetings.some((m) => m.day === day))];
  const from = Math.floor(Math.min(8 * 60, ...meetings.map((m) => toMinutes(m.start))) / 60) * 60;
  const to = Math.ceil(Math.max(17 * 60, ...meetings.map((m) => toMinutes(m.end))) / 60) * 60;
  const height = (to - from) * PX_PER_MIN;
  const hours = [];
  for (let t = from; t <= to; t += 60) hours.push(t);
  const y = (min) => (min - from) * PX_PER_MIN;

  mount(el, html`
    ${pageHead('Schedule', isTeacher() ? 'Sections you teach.' : 'Your enrolled classes; pending requests are dashed.',
      d.terms.length > 1 ? html`<select id="term">${d.terms.filter((t) => t.status !== 'archived').map((t) => option(t.id, t.name, t.id === d.termId))}</select>` : '')}
    ${classes.length ? html`<div class="scroll-x tt-wrap"><div class="timetable" style="--days:${days.length}">
      <div class="tt-head"></div>${days.map((day) => html`<div class="tt-head">${DAYS[day]}</div>`)}
      <div class="tt-hours" style="height:${height}px">${hours.map((t) => html`<span class="tt-hour" style="top:${y(t)}px">${formatTime(`${String(t / 60).padStart(2, '0')}:00`).replace(':00 ', ' ')}</span>`)}</div>
      ${days.map((day) => html`<div class="tt-col" style="height:${height}px">
        ${hours.map((t) => raw(`<span class="tt-line" style="top:${y(t)}px"></span>`))}
        ${meetings.filter((m) => m.day === day).map((m) => html`<a class="tt-block ${m.c.status === 'pending' ? 'pending' : ''}" href="#/classes/${m.c.id}"
          style="top:${y(toMinutes(m.start))}px;height:${(toMinutes(m.end) - toMinutes(m.start)) * PX_PER_MIN - 2}px"
          title="${m.c.course.title}"><b>${m.c.course.code} ${m.c.name}</b>${formatTime(m.start)}–${formatTime(m.end)}<br />${m.c.room}</a>`)}
      </div>`)}
    </div></div>` : empty('Nothing scheduled', 'No classes with meeting times in this term.')}
    ${unscheduled.length ? html`<p class="hint">Times to be arranged: ${unscheduled.map((c) => `${c.course.code} ${c.name}`).join(', ')}.</p>` : ''}`);
  el.querySelector('#term')?.addEventListener('change', (e) => (location.hash = `#/schedule?termId=${e.target.value}`));
}
