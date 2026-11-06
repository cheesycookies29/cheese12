// Pieces shared by the registrar's student record and the student's own pages:
// the evaluation (curriculum checklist), the permanent record by term, the current registration.
import { html } from '../../ui.js';
import { icon } from '../../icons.js';
import { termLabel, yearLabel, fmtGrade } from '/shared/academic.js';
import { subjectBadge, remarkBadge, gradeText, gwaText } from '../state.js';

export function evaluationSummary(ev) {
  if (!ev.curriculum) return html`<div class="notice info">${icon('layers')}<p><strong>No curriculum assigned.</strong> The evaluation compares the record with a curriculum (the prospectus); the registrar assigns one.</p></div>`;
  const t = ev.totals;
  return html`<div class="stats small">
    <div><small>Curriculum</small><strong>${ev.curriculum.code} ${ev.curriculum.series}</strong><span class="muted small">${ev.curriculum.major || ev.curriculum.program}</span></div>
    <div><small>Units earned</small><strong>${t.earned} / ${t.required}</strong><span class="progress block"><i style="width:${t.percent}%"></i></span></div>
    <div><small>Taking now</small><strong>${t.inProgress}</strong><span class="muted small">units</span></div>
    <div><small>Still to take</small><strong>${t.remainingSubjects}</strong><span class="muted small">${t.remaining} units</span></div>
    <div><small>GWA</small><strong>${gwaText(ev.gwa)}</strong><span class="muted small">general weighted average</span></div>
  </div>`;
}

// The curriculum, term by term, with each subject's status for this student.
export function evaluationTable(ev) {
  if (!ev.curriculum) return '';
  return html`
    ${ev.back.length ? html`<div class="notice">${icon('flag')}<p><strong>${ev.back.length} back subject${ev.back.length === 1 ? '' : 's'}:</strong> ${ev.back.map((s) => s.code).join(', ')}. These are from an earlier year level and still to be taken or retaken.</p></div>` : ''}
    <div class="prospectus">${ev.blocks.map((b) => html`
      <section class="pro-term">
        <header><strong>${yearLabel(b.year)} · ${termLabel(b.term)}</strong><span class="muted">${b.units} units</span></header>
        <table class="table compact">
          <thead><tr><th>Subject</th><th class="num">Units</th><th>Prerequisite</th><th class="num">Grade</th><th>Status</th></tr></thead>
          <tbody>${b.subjects.map((s) => html`<tr class="sub-${s.status}${s.back ? ' back' : ''}">
            <td><strong>${s.code}</strong><small>${s.title}</small></td>
            <td class="num">${s.units}${s.labUnits ? html`<small>${s.labUnits} lab</small>` : ''}</td>
            <td>${s.prereqs.length ? s.prereqs.map((p) => html`<span class="pre ${p.met ? 'met' : ''}" title="${p.met ? 'Passed' : 'Not passed yet'}">${p.met ? icon('check', 12) : ''}${p.code}</span> `) : html`<span class="muted">None</span>`}</td>
            <td class="num">${s.grade != null ? fmtGrade(s.grade) : s.status === 'inc' ? 'INC' : '—'}</td>
            <td>${subjectBadge(s)}${s.termName ? html`<small>${s.termName}</small>` : ''}</td>
          </tr>`)}</tbody>
        </table>
      </section>`)}</div>
    ${ev.others.length ? html`<section class="card"><h2>Other subjects on the record</h2><p class="muted small">Taken or credited, but not part of this curriculum (electives, an earlier curriculum).</p>
      <table class="table compact"><thead><tr><th>Subject</th><th>Term</th><th class="num">Units</th><th class="num">Grade</th><th>Remark</th></tr></thead>
      <tbody>${ev.others.map((r) => html`<tr><td><strong>${r.courseCode}</strong><small>${r.courseTitle}</small></td><td>${r.termName}</td><td class="num">${r.units}</td><td class="num">${gradeText(r)}</td><td>${remarkBadge(r.remark)}</td></tr>`)}</tbody></table></section>` : ''}`;
}

// The permanent record, term by term. actions(r): extra cell content per record (staff).
export function recordTerms(terms, actions = null) {
  if (!terms.length) return html`<div class="card empty">${icon('clipboard', 40)}<h2>No posted grades yet</h2><p>Grades appear here once the registrar posts a term's grade sheets.</p></div>`;
  return terms.map((t) => html`<section class="card term-card">
    <div class="card-head"><h2>${t.termName}</h2><span class="muted">GWA <strong>${gwaText(t.gwa)}</strong> · ${t.units} units earned</span></div>
    <table class="table compact">
      <thead><tr><th>Subject</th><th class="num">Units</th><th class="num">Final</th><th class="num">Grade</th><th>Remark</th>${actions ? html`<th></th>` : ''}</tr></thead>
      <tbody>${t.records.map((r) => html`<tr>
        <td><strong>${r.courseCode}</strong><small>${r.courseTitle}${r.school ? ` · credited from ${r.school}` : ''}</small></td>
        <td class="num">${r.units}</td>
        <td class="num">${r.percent != null ? r.percent : '—'}</td>
        <td class="num"><strong>${gradeText(r)}</strong></td>
        <td>${remarkBadge(r.remark)}${r.incDeadline ? html`<small>Complete by ${r.incDeadline}</small>` : ''}${r.history?.length ? html`<small title="${r.history.map((h) => `${h.at.slice(0, 10)}: ${h.from.remark === 'inc' ? 'INC' : fmtGrade(h.from.grade)} → ${fmtGrade(h.to.grade) || h.to.remark} (${h.reason}; approved by ${h.approvedBy})`).join('\n')}">Changed ${r.history.length}×</small>` : ''}</td>
        ${actions ? html`<td class="row-actions">${actions(r)}</td>` : ''}
      </tr>`)}</tbody>
    </table>
  </section>`);
}

export function currentTerm(cur) {
  if (!cur.classes.length) return html`<p class="muted">Not enrolled in ${cur.termName || 'the current term'}.</p>`;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const when = (m) => m.map((x) => `${DAYS[x.day]} ${x.start}–${x.end}`).join(', ');
  return html`<table class="table compact"><thead><tr><th>Subject</th><th>Section</th><th>Schedule</th><th class="num">Units</th><th>Status</th></tr></thead>
    <tbody>${cur.classes.map((c) => html`<tr><td><strong>${c.code}</strong><small>${c.title}</small></td><td>${c.section}${c.room ? html`<small>${c.room}</small>` : ''}</td><td>${when(c.meetings) || html`<span class="muted">To be arranged</span>`}${c.teacher ? html`<small>${c.teacher}</small>` : ''}</td><td class="num">${c.units}</td><td>${c.status === 'pending' ? remarkBadge('pending') : c.status === 'completed' ? html`<span class="badge green">Graded</span>` : html`<span class="badge brand">Enrolled</span>`}</td></tr>`)}</tbody>
    <tfoot><tr><td colspan="3"><strong>Total</strong></td><td class="num"><strong>${cur.units}</strong></td><td></td></tr></tfoot></table>`;
}
