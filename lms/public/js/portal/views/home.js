import { api } from '../../api.js';
import { html, mount, fmtDate, timeAgo, dueText } from '../../ui.js';
import { pageHead, ctx } from '../../shell.js';
import { icon } from '../../icons.js';
import { formatTime } from '/shared/schedule.js';
import { has, isTeacher, classLabel } from '../common.js';

const kindIcon = (a) => (a.kind === 'quiz' ? 'quiz' : 'task');
export const activityHref = (a) => (a.kind === 'quiz' ? `#/quizzes/${a.id}` : `#/assignments/${a.id}`);

export function classTiles(classes, progress = {}) {
  return html`<div class="tiles">${classes.map((c) => {
    const p = progress[c.id];
    return html`<a class="tile" href="#/classes/${c.id}">
      <span class="code">${classLabel(c)}</span><strong>${c.course.title}</strong>
      <small>${c.schedule}${c.room ? ` · ${c.room}` : ''}</small>
      ${p && p.total ? html`<div class="progress" title="${p.done} of ${p.total} activities done"><i style="width:${Math.round((p.done / p.total) * 100)}%"></i></div><small>${p.done}/${p.total} activities done${p.percent != null ? ` · ${p.percent}%` : ''}</small>` : ''}
      <span class="meta"><span>${icon('user', 14)} ${isTeacher() ? `${c.taken} student${c.taken === 1 ? '' : 's'}` : c.teacher?.name || 'Teacher to be assigned'}</span><span>${c.course.units} units</span></span>
    </a>`;
  })}</div>`;
}

export const dateBox = (ymd) => {
  const d = new Date(`${ymd}T00:00:00`);
  return html`<div class="date-box"><b>${d.toLocaleDateString('en-PH', { month: 'short' })}</b><span>${d.getDate()}</span></div>`;
};

export const eventWhen = (e) => `${fmtDate(e.startDate)}${e.endDate && e.endDate !== e.startDate ? ` – ${fmtDate(e.endDate)}` : ''}${e.startTime ? ` · ${formatTime(e.startTime)}${e.endTime ? `–${formatTime(e.endTime)}` : ''}` : ''}`;

export async function homeView(el) {
  const d = await api.get('/api/home');
  const first = ctx.user.name.split(' ')[0];
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const teacher = isTeacher();
  const weekday = new Date().getDay();
  const todays = d.classes
    .flatMap((c) => c.meetings.filter((m) => m.day === weekday).map((m) => ({ ...m, c })))
    .sort((a, b) => a.start.localeCompare(b.start));
  const overdue = d.due.filter((a) => a.overdue).length;

  mount(el, html`
    ${pageHead(`${hello}, ${first}`, html`${new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}${d.term ? ` · ${d.term.name}` : ''}`)}
    ${d.requests.length ? html`<div class="notice">${icon('clipboard')}<p><strong>Waiting on enrollment:</strong> ${d.requests.map((e, i) => html`${i ? ', ' : ''}${e.section.course.code} ${e.section.name} (${e.statusLabel.toLowerCase()}${e.position ? `, #${e.position}` : ''})`)}. <a href="#/enroll/mine">See my enrollment</a></p></div>` : ''}

    <div class="cols wide-left">
      <div class="stack">
        ${has('assignments') ? (teacher
          ? html`<section class="card"><div class="card-head"><h2>${icon('inbox')} To grade</h2></div>
              ${d.toGrade.length ? html`<div class="list">${d.toGrade.map((a) => html`<a class="list-item" href="${a.kind === 'quiz' ? `#/quizzes/${a.id}/results` : `#/assignments/${a.id}`}">
                <span class="item-ic warn">${icon(kindIcon(a))}</span><span class="grow"><strong>${a.title}</strong><small>${a.class?.course.code} ${a.class?.name} · ${a.waiting} waiting</small></span>${icon('chevronRight')}</a>`)}</div>`
                : html`<p class="muted">All caught up. Nothing waiting to be scored.</p>`}</section>`
          : html`<section class="card"><div class="card-head"><h2>${icon('checkCircle')} To do ${d.due.length ? html`<span class="badge ${overdue ? 'red' : 'brand'}">${d.due.length}</span>` : ''}</h2></div>
              ${d.due.length ? html`<div class="list">${d.due.map((a) => html`<a class="list-item" href="${activityHref(a)}">
                <span class="item-ic ${a.overdue ? 'danger' : a.kind === 'quiz' ? 'info' : ''}">${icon(kindIcon(a))}</span>
                <span class="grow"><strong>${a.title}</strong><small>${a.class?.course.code} · ${a.kind === 'quiz' ? `Quiz${a.quiz?.timeLimit ? `, ${a.quiz.timeLimit} min` : ''}` : 'Assignment'} · ${a.points} pts</small></span>
                <span class="badge ${a.overdue ? 'red' : 'gray'}">${dueText(a.dueAt, a.kind === 'quiz' ? 'Closes' : 'Due')}</span></a>`)}</div>`
                : html`<p class="muted">You're all caught up. 🎉</p>`}
              ${d.upcoming?.length ? html`<h3>Opening soon</h3><div class="list">${d.upcoming.map((a) => html`<a class="list-item" href="${activityHref(a)}"><span class="item-ic">${icon('clock')}</span><span class="grow"><strong>${a.title}</strong><small>${a.class?.course.code} · opens ${dueText(a.opensAt, '').trim()}</small></span></a>`)}</div>` : ''}
            </section>`) : ''}
        <section>
          <div class="card-head"><h2>${icon('book')} ${teacher ? 'Sections you teach' : 'Your classes'}</h2><a href="#/classes">All ${icon('chevronRight', 14)}</a></div>
          ${d.classes.length ? classTiles(d.classes, d.progress) : html`<div class="card empty">${icon('book', 36)}<p>${teacher ? 'No sections are assigned to you this term yet.' : 'You are not enrolled in any classes this term yet.'}</p>
            ${!teacher && has('enrollment') ? html`<a class="btn primary" href="#/enroll">Browse open sections</a>` : ''}</div>`}
        </section>
      </div>
      <div class="stack">
        <section class="card"><div class="card-head"><h2>${icon('clock')} Today</h2>${has('schedule') ? html`<a href="#/schedule">Week ${icon('chevronRight', 14)}</a>` : ''}</div>
          ${todays.length ? html`<div class="list">${todays.map((m) => html`<a class="list-item" href="#/classes/${m.c.id}"><span class="item-ic">${icon('cap')}</span><span class="grow"><strong>${classLabel(m.c)}</strong><small>${formatTime(m.start)}–${formatTime(m.end)}${m.c.room ? ` · ${m.c.room}` : ''}</small></span></a>`)}</div>`
            : html`<p class="muted">No classes today.</p>`}
        </section>
        ${has('news') ? html`<section class="card"><div class="card-head"><h2>${icon('calendar')} Upcoming events</h2><a href="#/news">All ${icon('chevronRight', 14)}</a></div>
          ${d.events?.length ? html`<div class="list">${d.events.map((e) => html`<div class="list-item">${dateBox(e.startDate)}<span class="grow"><strong>${e.title}</strong><small>${eventWhen(e)}${e.location ? ` · ${e.location}` : ''}</small></span></div>`)}</div>` : html`<p class="muted">No upcoming events.</p>`}
        </section>
        <section class="card"><div class="card-head"><h2>${icon('news')} School news</h2><a href="#/news">All ${icon('chevronRight', 14)}</a></div>
          ${d.news?.length ? html`<div class="list">${d.news.map((n) => html`<a class="list-item" href="#/news"><span class="item-ic">${icon(n.pinned ? 'pin' : 'news')}</span><span class="grow"><strong>${n.title}</strong><small>${n.authorName} · ${timeAgo(n.createdAt)}${n.comments ? ` · ${n.comments} comment${n.comments === 1 ? '' : 's'}` : ''}</small></span></a>`)}</div>` : html`<p class="muted">No news yet.</p>`}
        </section>` : ''}
        ${has('announcements') ? html`<section class="card"><div class="card-head"><h2>${icon('megaphone')} Class announcements</h2></div>
          ${d.announcements.length ? html`<div class="list">${d.announcements.map((a) => html`<a class="list-item" href="#/classes/${a.sectionId}/announcements"><span class="grow"><strong>${a.title}</strong><small>${a.class.course.code} · ${a.authorName} · ${timeAgo(a.createdAt)}</small></span></a>`)}</div>` : html`<p class="muted">No announcements yet.</p>`}
        </section>` : ''}
      </div>
    </div>`);
}
