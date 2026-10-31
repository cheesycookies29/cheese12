import { api } from '../../api.js';
import { html, mount, modal, toast, statusBadge, timeAgo, fmtDateTime, option, formData, confirmDialog } from '../../ui.js';
import { pageHead, badgesChanged } from '../../shell.js';
import { lookups, termSelect, currentTermId, setQuery, sectionTitle, filterRows } from '../common.js';

const TABS = [['pending', 'Pending approval'], ['waitlisted', 'Waitlisted'], ['enrolled', 'Enrolled'], ['', 'All']];

export function historyList(e) {
  return html`<ul class="timeline">${e.history.slice().reverse().map((h) => html`<li>${statusBadge(h.status)} ${h.note || ''}<br /><small>${h.by} · ${fmtDateTime(h.at)}</small></li>`)}</ul>`;
}

export function showHistory(e) {
  modal({
    title: `${e.student?.name} · ${e.section?.course.code} ${e.section?.name}`,
    subtitle: `${e.section?.course.title} · ${e.section?.schedule}`,
    body: html`<p>${statusBadge(e.status, e.statusLabel)} ${e.position ? html`<span class="muted">#${e.position} on the waitlist</span>` : ''}
      ${e.finalGrade != null ? html` · Final grade <strong>${e.finalGrade}</strong>` : ''}</p>${historyList(e)}`,
    submitLabel: null,
  });
}

// Buttons for one enrollment; after any action, onChange() redraws.
export function enrollmentActions(e) {
  if (e.status === 'pending') return html`<button class="btn primary" data-act="approve" data-id="${e.id}">Approve</button><button class="btn danger ghost" data-act="reject" data-id="${e.id}">Reject</button>`;
  if (e.status === 'waitlisted') return html`<button class="btn" data-act="force" data-id="${e.id}">Enroll over capacity</button><button class="btn danger ghost" data-act="reject" data-id="${e.id}">Reject</button>`;
  if (e.status === 'enrolled') return html`<button class="btn danger ghost" data-act="drop" data-id="${e.id}">Drop</button>`;
  return '';
}

export function wireEnrollmentActions(root, list, onChange) {
  root.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const e = list.find((x) => x.id === btn.dataset.id);
    const act = btn.dataset.act;
    const who = `${e.student?.name} in ${e.section?.course.code} ${e.section?.name}`;
    try {
      if (act === 'approve') {
        await api.post(`/api/admin/enrollments/${e.id}/approve`, {});
        toast(`Enrolled ${who}.`);
      } else if (act === 'force') {
        if (!(await confirmDialog(`Enroll ${who} even though the section is full?`, { confirmLabel: 'Enroll over capacity', danger: false }))) return;
        await api.post(`/api/admin/enrollments/${e.id}/approve`, { force: true });
        toast(`Enrolled ${who} over capacity.`);
      } else {
        const verb = act === 'reject' ? 'Reject' : 'Drop';
        await new Promise((resolve) => modal({
          title: `${verb} ${who}?`,
          body: html`<label class="field"><span>Note for the record (optional)</span><textarea name="note" placeholder="${act === 'reject' ? 'e.g. Missing requirements' : 'e.g. Student asked to drop'}"></textarea></label>
            ${act === 'drop' ? html`<p class="hint">The first student on the waitlist, if any, moves into the freed seat.</p>` : ''}`,
          submitLabel: verb,
          async onSubmit(form) {
            await api.post(`/api/admin/enrollments/${e.id}/${act}`, formData(form));
            toast(`${verb === 'Reject' ? 'Rejected' : 'Dropped'} ${who}.`);
            resolve();
          },
        }));
      }
      badgesChanged();
      onChange();
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}

export function addEnrollmentDialog({ students, sections, studentId = '', sectionId = '' }, onDone) {
  modal({
    title: 'Add a student to a section',
    subtitle: 'Registrar enrollment: no approval step, and the enrollment window does not apply.',
    body: html`<div class="stack tight">
      <label class="field"><span>Student</span><select name="studentId" required>${option('', 'Choose…')}${students.map((s) => option(s.id, `${s.name} (${s.studentNo || 'no number'}${s.program ? `, ${s.program}` : ''})`, s.id === studentId))}</select></label>
      <label class="field"><span>Section</span><select name="sectionId" required>${option('', 'Choose…')}${sections.filter((s) => s.status !== 'cancelled').map((s) => option(s.id, `${s.course.code} ${s.name} · ${s.course.title} · ${s.schedule} · ${s.taken}/${s.capacity}`, s.id === sectionId))}</select></label>
      <label class="field"><span>Note (optional)</span><input name="note" placeholder="e.g. Cross-enrollee" /></label>
      <label class="field check"><input type="checkbox" name="force" /> <span>Override the rules: prerequisites, unit limit, schedule conflicts and a full section</span></label>
      <p class="hint">Without the override, a full section puts the student on its waitlist.</p>
    </div>`,
    submitLabel: 'Add',
    async onSubmit(form) {
      const v = formData(form);
      if (!v.studentId || !v.sectionId) throw new Error('Pick a student and a section.');
      const e = await api.post('/api/admin/enrollments', { ...v, force: Boolean(v.force) });
      toast(`${e.student.name}: ${e.statusLabel.toLowerCase()} in ${e.section.course.code} ${e.section.name}.`);
      badgesChanged();
      onDone();
    },
  });
}

export async function enrollmentQueueView(el, params, query) {
  const { terms } = await lookups('terms');
  const status = query.status ?? 'pending';
  const termId = query.termId ?? currentTermId(terms);
  const qs = new URLSearchParams({ status, termId: status === 'pending' ? '' : termId });
  const list = await api.get(`/api/admin/enrollments?${qs}`);
  mount(el, html`
    ${pageHead('Enrollment requests', 'Approve or reject requests, manage waitlists, and add or drop students.', html`<button class="btn primary" id="add">+ Add a student to a section</button>`)}
    <nav class="tabs">${TABS.map(([s, label]) => html`<a href="#/enrollment?status=${s}${query.termId ? `&termId=${query.termId}` : ''}" class="${s === status ? 'active' : ''}">${label}</a>`)}</nav>
    <div class="toolbar">
      ${status === 'pending' ? html`<span class="muted">All terms</span>` : termSelect(terms, termId)}
      <input type="search" name="q" placeholder="Search student, number or course" />
      <span class="spacer"></span><span class="muted" id="shown">${list.length} shown</span>
    </div>
    <div class="card scroll-x">
      ${list.length ? html`<table class="table">
        <thead><tr><th>Student</th><th>Section</th><th>Schedule</th><th>Status</th><th>Updated</th><th></th></tr></thead>
        <tbody>${list.map((e) => html`<tr>
          <td><strong>${e.student?.name}</strong><small>${e.student?.studentNo} ${e.student?.program ? `· ${e.student.program} ${e.student.yearLevel}` : ''}</small></td>
          <td>${e.section ? sectionTitle(e.section) : ''}<small>${e.section?.term.name}</small></td>
          <td>${e.section?.schedule}<small>${e.section ? `${e.section.taken}/${e.section.capacity} seats` : ''}</small></td>
          <td>${statusBadge(e.status, e.statusLabel)}${e.position ? html`<small>#${e.position} in line</small>` : ''}${e.finalGrade != null ? html`<small>Grade ${e.finalGrade}</small>` : ''}</td>
          <td class="nowrap">${timeAgo(e.updatedAt)}<small>${e.history.at(-1)?.by}</small></td>
          <td class="row-actions">${enrollmentActions(e)}<button class="btn" data-history="${e.id}">History</button></td>
        </tr>`)}</tbody>
      </table>` : html`<div class="empty"><h2>Nothing here</h2><p>${status === 'pending' ? 'No requests are waiting for approval.' : 'No enrollments match.'}</p></div>`}
    </div>`);
  const redraw = () => enrollmentQueueView(el, params, query);
  wireEnrollmentActions(el, list, redraw);
  el.querySelectorAll('[data-history]').forEach((b) => b.addEventListener('click', () => showHistory(list.find((e) => e.id === b.dataset.history))));
  el.querySelector('select[name=termId]')?.addEventListener('change', (e) => setQuery({ termId: e.target.value }));
  filterRows(el);
  el.querySelector('#add').addEventListener('click', async () => {
    const [students, sections] = await Promise.all([api.get('/api/admin/users?role=student&status=active'), api.get(`/api/admin/sections?termId=${termId}`)]);
    addEnrollmentDialog({ students, sections }, redraw);
  });
}
