// Sections: a course offered in a term, with a teacher, meeting times and seats.
import { api } from '../../api.js';
import { html, mount, modal, toast, statusBadge, option, formData, confirmDialog, empty } from '../../ui.js';
import { pageHead, ctx, badgesChanged } from '../../shell.js';
import { can } from '/shared/roles.js';
import { DAYS } from '/shared/schedule.js';
import { lookups, termSelect, currentTermId, setQuery, seatBar, sectionTitle, filterRows } from '../common.js';
import { enrollmentActions, wireEnrollmentActions, showHistory, addEnrollmentDialog } from './enrollment.js';

const mayEdit = () => can(ctx.user.role, 'catalog.manage');

// Meetings are entered as days + one time range (the common case). Sections whose
// days have different times keep them unless the days/times are changed here.
function meetingFields(meetings = []) {
  const first = meetings[0] || { start: '09:00', end: '10:30' };
  const days = new Set(meetings.map((m) => m.day));
  const uniform = meetings.every((m) => m.start === first.start && m.end === first.end);
  return html`
    <fieldset class="field span-3" style="border:0;padding:0;margin:0"><span>Meets on</span>
      <div class="days">${DAYS.map((d, i) => html`<label><input type="checkbox" name="day" value="${i}" ${days.has(i) ? 'checked' : ''} /> ${d}</label>`)}</div>
      ${!uniform ? html`<span class="hint">This section has different times on different days; saving applies the times below to every day ticked.</span>` : ''}
    </fieldset>
    <label class="field"><span>From</span><input type="time" name="start" value="${first.start}" /></label>
    <label class="field"><span>To</span><input type="time" name="end" value="${first.end}" /></label>`;
}

export function sectionDialog({ section = null, terms, courses, teachers, termId }, onDone) {
  modal({
    title: section ? `Edit ${section.course.code} ${section.name}` : 'Add a section',
    wide: true,
    body: html`<div class="grid">
      <label class="field span-2"><span>Course<em>*</em></span><select name="courseId" required>${option('', 'Choose…')}${courses.filter((c) => c.status !== 'retired' || c.id === section?.courseId).map((c) => option(c.id, `${c.code} · ${c.title} (${c.units} units)`, c.id === section?.courseId))}</select></label>
      <label class="field"><span>Section<em>*</em></span><input name="name" value="${section?.name || ''}" placeholder="e.g. A" required /></label>
      <label class="field span-2"><span>Term<em>*</em></span>${termSelect(terms, section?.termId || termId)}</label>
      <label class="field"><span>Capacity<em>*</em></span><input type="number" name="capacity" min="1" max="1000" value="${section?.capacity ?? 30}" required /></label>
      <label class="field span-2"><span>Teacher</span><select name="teacherId">${option('', 'Not assigned yet')}${teachers.filter((t) => t.status === 'active' || t.id === section?.teacherId).map((t) => option(t.id, `${t.name}${t.department ? ` · ${t.department}` : ''}`, t.id === section?.teacherId))}</select></label>
      <label class="field"><span>Room</span><input name="room" value="${section?.room || ''}" /></label>
      ${meetingFields(section?.meetings)}
      <label class="field"><span>Status</span><select name="status">
        ${option('open', 'Open for enrollment', !section || section.status === 'open')}
        ${option('closed', 'Closed (registrar only)', section?.status === 'closed')}
        ${option('cancelled', 'Cancelled (drops everyone)', section?.status === 'cancelled')}
      </select></label>
      <label class="field span-2"><span>Enrollment key</span><input name="enrollmentKey" value="${section?.enrollmentKey || ''}" placeholder="Leave blank for none" /><span class="hint">When set, students must type this key to request the section (like Moodle's self-enrolment key).</span></label>
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const days = [...form.querySelectorAll('[name=day]:checked')].map((i) => Number(i.value));
      const body = { ...v, meetings: days.map((day) => ({ day, start: v.start, end: v.end })) };
      if (section && section.status !== 'cancelled' && v.status === 'cancelled') {
        if (!(await confirmDialog(`Cancel ${section.course.code} ${section.name}? Everyone enrolled, pending or waitlisted is dropped.`, { confirmLabel: 'Cancel section' }))) return;
      }
      const saved = await (section ? api.put(`/api/admin/sections/${section.id}`, body) : api.post('/api/admin/sections', body));
      toast('Saved.');
      badgesChanged();
      onDone(saved);
    },
  });
}

export async function sectionsView(el, params, query) {
  const { terms, courses, teachers } = await lookups('terms', 'courses', 'teachers');
  const termId = query.termId || currentTermId(terms);
  const sections = termId ? await api.get(`/api/admin/sections?termId=${termId}`) : [];
  mount(el, html`
    ${pageHead('Sections', 'Courses offered this term: teacher, schedule, seats and waitlist.', mayEdit() && terms.length && courses.length ? html`<button class="btn primary" id="add">+ Add section</button>` : '')}
    ${!terms.length || !courses.length ? html`<div class="notice"><p>Add a <a href="#/terms">term</a> and some <a href="#/courses">courses</a> first.</p></div>` : ''}
    <div class="toolbar">${terms.length ? termSelect(terms, termId) : ''}<input type="search" placeholder="Search course, teacher or room" /><span class="spacer"></span><span class="muted" id="shown">${sections.length} shown</span></div>
    ${sections.length ? html`<div class="card scroll-x"><table class="table clickable">
      <thead><tr><th>Section</th><th>Teacher</th><th>Schedule</th><th>Seats</th><th>Waitlist</th><th>Status</th></tr></thead>
      <tbody>${sections.map((s) => html`<tr data-id="${s.id}"><td>${sectionTitle(s)}</td><td>${s.teacher?.name || html`<span class="warn">Not assigned</span>`}</td>
        <td>${s.schedule}<small>${s.room}</small></td><td>${seatBar(s)}</td><td>${s.waitlisted || '—'}</td>
        <td>${statusBadge(s.status)}${s.enrollmentKey ? html`<small>Key: <span class="mono">${s.enrollmentKey}</span></small>` : ''}</td></tr>`)}</tbody>
    </table></div>` : empty('No sections in this term')}`);
  filterRows(el);
  el.querySelector('select[name=termId]')?.addEventListener('change', (e) => setQuery({ termId: e.target.value }));
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => (location.hash = `#/sections/${tr.dataset.id}`)));
  el.querySelector('#add')?.addEventListener('click', () => sectionDialog({ terms, courses, teachers, termId }, (s) => (location.hash = `#/sections/${s.id}`)));
}

export async function sectionView(el, { id }) {
  const s = await api.get(`/api/admin/sections/${id}`);
  const enrollManage = can(ctx.user.role, 'enrollment.manage');
  const groups = [['enrolled', 'Enrolled'], ['pending', 'Pending approval'], ['waitlisted', 'Waitlist (in order)'], ['completed', 'Completed'], ['dropped', 'Dropped or rejected']];
  const inGroup = (key) => s.roster.filter((e) => (key === 'dropped' ? ['dropped', 'rejected'].includes(e.status) : e.status === key)).sort((a, b) => (key === 'waitlisted' ? a.position - b.position : a.student.name.localeCompare(b.student.name)));
  mount(el, html`
    ${pageHead(html`${s.course.code} ${s.name} ${statusBadge(s.status)}`, html`${s.course.title} · ${s.term.name} · ${s.course.units} units`, html`
      ${enrollManage && s.status !== 'cancelled' ? html`<button class="btn primary" id="enroll">+ Add a student</button>` : ''}
      ${mayEdit() ? html`<button class="btn" id="edit">Edit section</button><button class="btn danger ghost" id="delete">Delete</button>` : ''}`, ['/sections', 'Sections'])}
    <div class="stats">
      <div class="card"><small>Seats</small><strong>${s.taken}/${s.capacity}</strong></div>
      <div class="card"><small>Waitlist</small><strong>${s.waitlisted}</strong></div>
      <div class="card"><small>Teacher</small><strong style="font-size:20px">${s.teacher?.name || 'Not assigned'}</strong></div>
      <div class="card"><small>Schedule</small><strong style="font-size:18px">${s.schedule}</strong><small>${s.room}</small></div>
    </div>
    ${s.enrollmentKey ? html`<div class="notice"><p>Students need the enrollment key <strong class="mono">${s.enrollmentKey}</strong> to request this section.</p></div>` : ''}
    ${s.course.prerequisites.length ? html`<p class="prereq">Prerequisites: ${s.course.prerequisites.join(', ')}</p>` : ''}
    ${groups.map(([key, label]) => {
      const list = inGroup(key);
      if (!list.length) return '';
      return html`<h3>${label} (${list.length})</h3><div class="card scroll-x"><table class="table">
        <thead><tr><th>Student</th><th>Number</th><th>Program</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map((e) => html`<tr><td><a href="#/people/${e.student.id}"><strong>${e.student.name}</strong></a></td><td class="mono">${e.student.studentNo}</td>
          <td>${e.student.program} ${e.student.yearLevel ? `· Year ${e.student.yearLevel}` : ''}</td>
          <td>${statusBadge(e.status, e.statusLabel)}${e.position ? html`<small>#${e.position}</small>` : ''}${e.finalGrade != null ? html`<small>Grade ${e.finalGrade}</small>` : ''}</td>
          <td class="row-actions">${enrollManage ? enrollmentActions(e) : ''}<button class="btn" data-history="${e.id}">History</button></td></tr>`)}</tbody>
      </table></div>`;
    })}
    ${!s.roster.length ? empty('Nobody has enrolled yet') : ''}`);
  const redraw = () => sectionView(el, { id });
  wireEnrollmentActions(el, s.roster, redraw);
  el.querySelectorAll('[data-history]').forEach((b) => b.addEventListener('click', () => showHistory(s.roster.find((e) => e.id === b.dataset.history))));
  el.querySelector('#edit')?.addEventListener('click', async () => {
    const { terms, courses, teachers } = await lookups('terms', 'courses', 'teachers');
    sectionDialog({ section: s, terms, courses, teachers }, redraw);
  });
  el.querySelector('#delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete ${s.course.code} ${s.name}? Its lessons, announcements and assignments are deleted too.`))) return;
    try {
      await api.del(`/api/admin/sections/${s.id}`);
      location.hash = '#/sections';
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#enroll')?.addEventListener('click', async () => {
    const students = await api.get('/api/admin/users?role=student&status=active');
    addEnrollmentDialog({ students, sections: [s], sectionId: s.id }, redraw);
  });
}
