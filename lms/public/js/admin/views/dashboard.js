import { api } from '../../api.js';
import { html, mount, fmtDate, statusBadge, timeAgo } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { seatBar, sectionTitle } from '../common.js';

export async function dashboardView(el) {
  const d = await api.get('/api/admin/dashboard');
  const t = d.term;
  const stat = (label, value, href, accent = false) => html`<a class="card ${accent ? 'accent' : ''}" href="#${href}"><small>${label}</small><strong>${value}</strong></a>`;
  mount(el, html`
    ${pageHead('Dashboard', t
      ? html`<strong>${t.name}</strong> · enrollment ${t.open ? 'open' : 'closed'} (${fmtDate(t.enrollStart)} – ${fmtDate(t.enrollEnd)}) · classes ${fmtDate(t.startDate)} – ${fmtDate(t.endDate)}`
      : 'No current term yet.')}
    ${!t ? html`<div class="notice"><p><strong>Getting started:</strong> add a <a href="#/terms">term</a>, <a href="#/courses">courses</a> and <a href="#/sections">sections</a>, then <a href="#/students">students</a> and <a href="#/teachers">teachers</a>. To look around first, load <a href="#/data">demo data</a>.</p></div>` : ''}
    <div class="stats">
      ${stat('Pending approval', d.pending, '/enrollment?status=pending', d.pending > 0)}
      ${stat('Waitlisted', d.waitlisted, '/enrollment?status=waitlisted')}
      ${stat('Seats filled', d.enrolled, '/enrollment?status=enrolled')}
      ${stat('Students enrolled', `${d.enrolledStudents} / ${d.students}`, '/students')}
      ${stat('Applicants', d.applicants, '/applicants', d.applicants > 0)}
      ${stat('Sections this term', d.sections, '/sections')}
      ${stat('Teachers', d.teachers, '/teachers')}
      ${stat('Courses', d.courses, '/courses')}
    </div>
    ${d.unassigned ? html`<div class="notice"><p>${d.unassigned} section${d.unassigned > 1 ? 's have' : ' has'} no teacher yet. <a href="#/sections">Assign teachers</a>.</p></div>` : ''}
    <div class="cols">
      <section class="card scroll-x">
        <h2 style="padding:18px 18px 0">Fullest sections</h2>
        ${d.fullest.length ? html`<table class="table clickable">
          <thead><tr><th>Section</th><th>Teacher</th><th>Seats</th><th>Waitlist</th></tr></thead>
          <tbody>${d.fullest.map((s) => html`<tr data-href="/sections/${s.id}"><td>${sectionTitle(s)}</td><td>${s.teacher?.name || html`<span class="warn">None</span>`}</td><td>${seatBar(s)}</td><td>${s.waitlisted || '—'}</td></tr>`)}</tbody>
        </table>` : html`<p class="muted" style="padding:0 18px 18px">No sections this term.</p>`}
      </section>
      <section class="card">
        <h2>Recent enrollment activity</h2>
        ${d.recent.length ? d.recent.map((e) => html`<div class="feed-item">
          ${statusBadge(e.status, e.statusLabel)} <strong>${e.student?.name}</strong> · ${e.section?.course.code} ${e.section?.name}
          <small>${e.history.at(-1)?.note || ''} · ${timeAgo(e.updatedAt)}</small>
        </div>`) : html`<p class="muted">Nothing yet.</p>`}
      </section>
    </div>`);
  el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => (location.hash = `#${tr.dataset.href}`)));
}
