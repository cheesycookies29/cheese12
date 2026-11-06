// Grade sheets: one per class. Final grades come from the class's gradebook in Learn; the
// teacher submits (marking INC where needed), the dean approves (or returns it with a reason),
// the registrar posts it to each student's permanent record. Grade changes afterwards need a
// reason and a second person's approval.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, toast, modal, option, confirmDialog, formData, timeAgo, badge, fmtDateTime } from '../../ui.js';
import { fmtGrade } from '/shared/academic.js';
import { can, isTeacher, clickableRows, sheetBadge, remarkBadge } from '../state.js';

const STATUS_FILTERS = [['', 'All'], ['none', 'Not started'], ['submitted', 'Waiting for approval'], ['approved', 'Approved'], ['returned', 'Returned'], ['posted', 'Posted']];

export async function sheetListView(el, _params, query) {
  const state = { status: query.status || '', termId: query.termId || '' };
  async function load() {
    const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v));
    const d = await api.get(`/api/academic/grade-sheets?${qs}`);
    mount(el, html`
      ${pageHead(isTeacher() ? 'My grade sheets' : 'Grade sheets', isTeacher() ? 'Give final grades in Learn (class → Grades), then submit each class\'s grade sheet here.' : `${ctx.info.campusName || ''} · classes of the term, from the teacher's submission to posting.`)}
      <div class="toolbar">
        <label class="inline">Term <select id="term">${option('all', 'All terms', !d.termId)}${d.terms.map((t) => option(t.id, t.name, t.id === d.termId))}</select></label>
        <label class="inline">Show <select id="status">${STATUS_FILTERS.map(([v, l]) => option(v, l, v === state.status))}</select></label>
      </div>
      ${d.sheets.length ? html`<div class="card"><table class="table clickable">
        <thead><tr><th>Class</th>${isTeacher() ? '' : html`<th>Teacher</th>`}<th class="num">Final grades</th><th>Status</th><th>Last step</th></tr></thead>
        <tbody>${d.sheets.map((s) => html`<tr data-href="#/grade-sheets/${s.sectionId}">
          <td><strong>${s.code} ${s.section}</strong><small>${s.title}${d.termId ? '' : ` · ${s.termName}`}</small></td>
          ${isTeacher() ? '' : html`<td>${s.teacher || html`<span class="muted">No teacher</span>`}</td>`}
          <td class="num">${s.graded} / ${s.students}</td>
          <td>${sheetBadge(s.status)}</td>
          <td>${s.postedAt ? html`Posted by ${s.postedBy}<small>${timeAgo(s.postedAt)}</small>` : s.approvedAt && s.status === 'approved' ? html`Approved by ${s.approvedBy}<small>${timeAgo(s.approvedAt)}</small>` : s.submittedAt ? html`Submitted by ${s.submittedBy}<small>${timeAgo(s.submittedAt)}</small>` : html`<span class="muted">—</span>`}${s.status === 'returned' ? html`<small class="danger-text">${s.note}</small>` : ''}</td>
        </tr>`)}</tbody></table></div>` : html`<div class="card empty">${icon('clipboard', 40)}<h2>No classes</h2><p>No classes match for this term.</p></div>`}`);
    clickableRows(el);
    el.querySelector('#term').addEventListener('change', (e) => { state.termId = e.target.value; load(); });
    el.querySelector('#status').addEventListener('change', (e) => { state.status = e.target.value; load(); });
  }
  await load();
}

export async function sheetView(el, params) {
  const s = await api.get(`/api/academic/grade-sheets/${params.sectionId}`);
  const reload = () => sheetView(el, params);
  const open = ['none', 'returned'].includes(s.status);
  const canSubmit = open && (isTeacher() || can('academic.records'));
  const missing = s.rows.filter((r) => r.percent == null && !r.inc && r.remark !== 'inc').length;
  const passed = s.rows.filter((r) => r.remark === 'passed').length;
  const failed = s.rows.filter((r) => r.remark === 'failed').length;
  const inc = s.rows.filter((r) => r.remark === 'inc').length;
  const act = async (url, body, msg) => {
    try {
      await api.post(url, body);
      toast(msg);
      ctx.refreshBadges?.();
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  mount(el, html`
    ${pageHead(html`${s.code} ${s.section} ${sheetBadge(s.status)}`, html`${s.title} · ${s.termName} · ${s.units} units${s.teacher ? ` · ${s.teacher}` : ''}${s.room ? ` · ${s.room}` : ''}`, html`
      <button class="btn" id="print">${icon('file', 16)} Print</button>
      ${canSubmit ? html`<button class="btn primary" id="submit" ${missing ? 'disabled' : ''}>${icon('upload', 16)} Submit grade sheet</button>` : ''}
      ${s.status === 'submitted' && can('grades.approve') ? html`<button class="btn" id="return">Return</button><button class="btn primary" id="approve">${icon('check', 16)} Approve</button>` : ''}
      ${s.status === 'approved' && can('academic.records') ? html`${can('grades.approve') ? html`<button class="btn" id="return">Return</button>` : ''}<button class="btn primary" id="post">${icon('check', 16)} Post to records</button>` : ''}`, ['/grade-sheets', isTeacher() ? 'My grade sheets' : 'Grade sheets'])}
    ${s.status === 'returned' ? html`<div class="notice bad">${icon('flag')}<p><strong>Returned:</strong> ${s.note}</p></div>` : ''}
    ${open && missing ? html`<div class="notice">${icon('flag')}<p><strong>${missing} student${missing === 1 ? ' has' : 's have'} no final grade.</strong> Give final grades in Learn (${isTeacher() ? html`<a href="/lms/#/classes/${s.sectionId}/grades">open the class's Grades</a>` : 'the class\'s Grades page'}), or mark them INC below.</p></div>` : ''}
    ${s.status === 'posted' ? html`<div class="notice ok">${icon('checkCircle')}<p>Posted to the students' permanent records${s.postedBy ? ` by ${s.postedBy}` : ''}. Corrections are grade changes on each student's record.</p></div>` : ''}
    <div class="stats small"><div><small>Students</small><strong>${s.rows.length}</strong></div><div><small>Passed</small><strong>${passed}</strong></div><div><small>Failed</small><strong>${failed}</strong></div><div><small>INC</small><strong>${inc}</strong></div></div>
    <div class="card">
      <div class="print-only print-head"><strong>Grade sheet · ${s.code} ${s.section}</strong><span>${s.title} · ${s.termName} · ${s.teacher}</span></div>
      <table class="table compact">
        <thead><tr><th>#</th><th>Student</th><th class="num">Final (%)</th><th class="num">Grade</th><th>Remark</th>${canSubmit ? html`<th class="no-print">INC</th>` : ''}</tr></thead>
        <tbody>${s.rows.map((r, i) => html`<tr>
          <td>${i + 1}</td>
          <td><strong>${r.name}</strong><small>${r.studentNo}</small></td>
          <td class="num">${r.percent ?? '—'}</td>
          <td class="num"><strong>${r.remark === 'inc' ? 'INC' : fmtGrade(r.grade) || '—'}</strong></td>
          <td>${r.remark ? remarkBadge(r.remark) : badge('No grade', 'amber')}</td>
          ${canSubmit ? html`<td class="no-print"><input type="checkbox" data-inc="${r.studentId}" aria-label="Mark ${r.name} INC" ${r.percent == null ? '' : ''} /></td>` : ''}
        </tr>`)}</tbody>
      </table>
      <div class="print-only sign-row"><span>Submitted by: ${s.submittedBy || '________________'}</span><span>Approved by: ${s.approvedBy || '________________'}</span><span>Posted by: ${s.postedBy || '________________'}</span></div>
    </div>
    ${s.trail?.length ? html`<section class="card no-print"><h2>${icon('clock')} Trail</h2><div class="list">${s.trail.map((t) => html`<div class="list-item"><span class="item-ic">${icon(t.action === 'Returned' ? 'flag' : 'check', 16)}</span><span class="grow"><strong>${t.action}</strong><small>${t.by} · ${fmtDateTime(t.at)}${t.note ? ` · ${t.note}` : ''}</small></span></div>`)}</div></section>` : ''}`);

  el.querySelector('#print').addEventListener('click', () => window.print());
  // The submit button waits until every student has a grade or is marked INC.
  const incs = () => [...el.querySelectorAll('[data-inc]:checked')].map((x) => x.dataset.inc);
  el.querySelectorAll('[data-inc]').forEach((box) => box.addEventListener('change', () => {
    const left = s.rows.filter((r) => r.percent == null && !incs().includes(r.studentId)).length;
    const b = el.querySelector('#submit');
    if (b) b.disabled = left > 0;
  }));
  el.querySelector('#submit')?.addEventListener('click', async () => {
    const list = incs();
    if (!(await confirmDialog(`Submit the grade sheet of ${s.code} ${s.section}${list.length ? ` with ${list.length} INC` : ''}? Grades can no longer be changed in this sheet unless it is returned.`, { confirmLabel: 'Submit', danger: false, title: 'Submit grade sheet' }))) return;
    act(`/api/academic/grade-sheets/${s.sectionId}/submit`, { inc: list }, 'Grade sheet submitted.');
  });
  el.querySelector('#approve')?.addEventListener('click', () => act(`/api/academic/grade-sheets/${s.sheetId}/approve`, {}, 'Grade sheet approved.'));
  el.querySelector('#post')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Post ${s.rows.length} grades of ${s.code} ${s.section} to the students' permanent records? Posted grades are locked.`, { confirmLabel: 'Post', danger: false, title: 'Post grades' }))) return;
    act(`/api/academic/grade-sheets/${s.sheetId}/post`, {}, 'Grades posted.');
  });
  el.querySelector('#return')?.addEventListener('click', () => modal({
    title: `Return ${s.code} ${s.section}`,
    submitLabel: 'Return to the teacher',
    body: html`<label class="field"><span>What should be fixed?</span><textarea name="note" rows="3" required></textarea></label>`,
    async onSubmit(form) {
      await api.post(`/api/academic/grade-sheets/${s.sheetId}/return`, formData(form));
      toast('Returned to the teacher.');
      reload();
    },
  }));
}

export async function changesView(el, _params, query) {
  const status = query.status ?? 'pending';
  const list = await api.get(`/api/academic/changes${status ? `?status=${status}` : ''}`);
  mount(el, html`
    ${pageHead('Grade changes', 'Rectifications and INC completions. Each needs a reason, and someone other than the person who asked approves it.')}
    <nav class="tabs">${[['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']].map(([v, l]) => html`<a href="#/changes?status=${v}" class="${v === status ? 'active' : ''}">${l}</a>`)}</nav>
    ${list.length ? html`<div class="card"><table class="table">
      <thead><tr><th>Student</th><th>Subject</th><th>From → to</th><th>Reason</th><th>Status</th>${can('grades.approve') ? html`<th></th>` : ''}</tr></thead>
      <tbody>${list.map((c) => html`<tr>
        <td><a href="#/students/${c.student.id}?tab=grades"><strong>${c.student.name}</strong></a><small>${c.student.studentNo}</small></td>
        <td><strong>${c.courseCode}</strong><small>${c.termName} · ${c.kind === 'inc' ? 'INC completion' : 'Rectification'}</small></td>
        <td>${c.from.remark === 'inc' ? 'INC' : fmtGrade(c.from.grade)} → <strong>${c.to.remark === 'dropped' ? 'Dropped' : `${fmtGrade(c.to.grade)} (${c.to.percent})`}</strong></td>
        <td>${c.reason}<small>Asked by ${c.requestedBy} · ${timeAgo(c.createdAt)}</small></td>
        <td>${badge(c.status === 'pending' ? 'Waiting' : c.status === 'approved' ? 'Approved' : 'Rejected', c.status === 'pending' ? 'amber' : c.status === 'approved' ? 'green' : 'red')}${c.decidedBy ? html`<small>${c.decidedBy}${c.note ? ` · ${c.note}` : ''}</small>` : ''}</td>
        ${can('grades.approve') ? html`<td class="row-actions">${c.status === 'pending' ? (c.requestedById === ctx.user.id ? html`<small class="muted">Your request</small>` : html`<button class="btn sm primary" data-approve="${c.id}">Approve</button><button class="btn sm" data-reject="${c.id}">Reject</button>`) : ''}</td>` : ''}
      </tr>`)}</tbody></table></div>` : html`<div class="card empty">${icon('checkCircle', 40)}<h2>Nothing here</h2><p>${status === 'pending' ? 'No grade changes are waiting.' : 'No grade changes.'}</p></div>`}`);
  el.onclick = async (e) => { // assigned, not added: the view redraws itself into the same element
    const id = e.target.dataset.approve || e.target.dataset.reject;
    if (!id) return;
    const decision = e.target.dataset.approve ? 'approve' : 'reject';
    try {
      await api.post(`/api/academic/changes/${id}/${decision}`, {});
      toast(decision === 'approve' ? 'Change approved; the record is updated.' : 'Change rejected.');
      ctx.refreshBadges?.();
      changesView(el, _params, query);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
