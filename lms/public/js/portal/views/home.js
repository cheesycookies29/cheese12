import { api } from '../../api.js';
import { html, mount, fmtDate, fmtDateTime, statusBadge, timeAgo } from '../../ui.js';
import { pageHead, ctx } from '../../shell.js';
import { has, isTeacher, classLabel } from '../common.js';

export function classTiles(classes) {
  return html`<div class="tiles">${classes.map((c) => html`<a class="tile" href="#/classes/${c.id}">
    <span class="code">${classLabel(c)}</span><strong>${c.course.title}</strong>
    <small>${c.schedule}${c.room ? ` · ${c.room}` : ''}</small>
    <span class="meta"><span>${isTeacher() ? `${c.taken} student${c.taken === 1 ? '' : 's'}` : c.teacher?.name || 'Teacher to be assigned'}</span><span>${c.course.units} units</span></span>
  </a>`)}</div>`;
}

export async function homeView(el) {
  const d = await api.get('/api/home');
  const first = ctx.user.name.split(' ')[0];
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const teacher = isTeacher();
  mount(el, html`
    ${pageHead(`${hello}, ${first}`, d.term ? html`${d.term.name} · classes ${fmtDate(d.term.startDate)} – ${fmtDate(d.term.endDate)}` : '')}
    ${d.requests.length ? html`<div class="notice"><p><strong>Waiting on enrollment:</strong> ${d.requests.map((e, i) => html`${i ? ', ' : ''}${e.section.course.code} ${e.section.name} (${e.statusLabel.toLowerCase()}${e.position ? `, #${e.position}` : ''})`)}. <a href="#/enroll/mine">See my enrollment</a></p></div>` : ''}
    <div class="cols wide-left">
      <div>
        <h2>${teacher ? 'Sections you teach' : 'Your classes'}</h2>
        ${d.classes.length ? classTiles(d.classes) : html`<div class="card empty"><p>${teacher ? 'No sections are assigned to you this term yet.' : 'You are not enrolled in any classes this term yet.'}</p>
          ${!teacher && has('enrollment') ? html`<a class="btn primary" href="#/enroll">Browse open sections</a>` : ''}</div>`}
      </div>
      <div class="stack">
        ${has('assignments') && !teacher ? html`<section class="card"><h2>Due soon</h2>
          ${d.due.length ? d.due.map((a) => html`<div class="feed-item"><a href="#/assignments/${a.id}"><strong>${a.title}</strong></a>
            <small>${a.class.course.code} · ${a.dueAt ? `due ${fmtDateTime(a.dueAt)}` : 'no due date'}</small></div>`) : html`<p class="muted">Nothing to hand in. 🎉</p>`}
        </section>` : ''}
        ${has('assignments') && teacher ? html`<section class="card"><h2>To grade</h2>
          ${d.toGrade.length ? d.toGrade.map((a) => html`<div class="feed-item"><a href="#/assignments/${a.id}"><strong>${a.title}</strong></a> ${statusBadge('pending', `${a.waiting} waiting`)}
            <small>${a.class.course.code} ${a.class.name}</small></div>`) : html`<p class="muted">All caught up.</p>`}
        </section>` : ''}
        ${has('announcements') ? html`<section class="card"><h2>Announcements</h2>
          ${d.announcements.length ? d.announcements.map((a) => html`<div class="feed-item"><a href="#/classes/${a.sectionId}/announcements"><strong>${a.title}</strong></a>
            <small>${a.class.course.code} · ${a.authorName} · ${timeAgo(a.createdAt)}</small></div>`) : html`<p class="muted">No announcements yet.</p>`}
        </section>` : ''}
      </div>
    </div>`);
}
