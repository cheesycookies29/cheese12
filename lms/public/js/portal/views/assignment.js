// One assignment: students hand in work; teachers score it and give feedback.
import { api } from '../../api.js';
import { html, mount, modal, toast, fmtDateTime, statusBadge, timeAgo, formData, confirmDialog, empty } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { richText, assignmentDialog } from './classes.js';
import { classLabel } from '../common.js';

export async function assignmentView(el, { id }) {
  const a = await api.get(`/api/assignments/${id}`);
  const teacher = 'submissions' in a;
  const back = [`/classes/${a.class.id}/assignments`, classLabel(a.class)];
  const due = a.dueAt ? html`Due ${fmtDateTime(a.dueAt)}${a.allowLate ? ' · late work accepted' : ''}` : 'No due date';
  mount(el, html`
    ${pageHead(html`${a.title} ${a.published ? '' : statusBadge('pending', 'Draft')}`, html`${a.class.course.title} · ${due} · ${a.points} points`,
      teacher ? html`<button class="btn" id="edit">Edit</button><button class="btn danger ghost" id="delete">Delete</button>` : '', back)}
    ${a.instructions ? html`<section class="card"><h2>Instructions</h2><p class="pre">${richText(a.instructions)}</p></section>` : ''}
    <div id="work"></div>`);
  const work = el.querySelector('#work');
  const redraw = () => assignmentView(el, { id });
  if (teacher) {
    teacherPart(work, a, redraw);
    el.querySelector('#edit').addEventListener('click', () => assignmentDialog(a.class, a, redraw));
    el.querySelector('#delete').addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete “${a.title}” and all ${a.submissions.length} submission(s)?`))) return;
      await api.del(`/api/assignments/${a.id}`);
      location.hash = `#${back[0]}`;
    });
  } else studentPart(work, a, redraw);
}

function studentPart(el, a, redraw) {
  const s = a.mine;
  const scored = s?.score != null;
  const canSubmit = !scored && !a.closed;
  mount(el, html`
    ${s ? html`<section class="card"><h2>Your work ${scored ? statusBadge('completed', `Scored ${s.score}/${a.points}`) : statusBadge('enrolled', 'Handed in')} ${s.late ? statusBadge('waitlisted', 'Late') : ''}</h2>
      <p class="muted small">Handed in ${fmtDateTime(s.submittedAt)}${s.attempts > 1 ? ` · attempt ${s.attempts}` : ''}</p>
      ${s.text ? html`<p class="pre">${s.text}</p>` : ''}
      ${s.link ? html`<p><a href="${s.link}" target="_blank" rel="noopener">${s.link}</a></p>` : ''}
      ${s.feedback ? html`<div class="notice"><p><strong>Feedback${s.gradedBy ? ` from ${s.gradedBy}` : ''}:</strong> ${s.feedback}</p></div>` : ''}
    </section>` : ''}
    ${canSubmit ? html`<form class="card stack tight" id="submit">
      <h2>${s ? 'Hand in again' : 'Hand in your work'}</h2>
      <label class="field"><span>Answer</span><textarea name="text" style="min-height:180px">${s?.text || ''}</textarea></label>
      <label class="field"><span>Link to your work (optional)</span><input name="link" value="${s?.link || ''}" placeholder="https://… (document, repository, video)" /></label>
      ${a.dueAt && a.allowLate ? html`<p class="hint">Work handed in after the due date is marked late.</p>` : ''}
      <div class="actions end"><button class="btn primary" type="submit">${s ? 'Replace my work' : 'Hand in'}</button></div>
    </form>` : ''}
    ${!s && a.closed ? empty('Closed', 'The due date has passed and this assignment does not accept late work.') : ''}`);
  el.querySelector('#submit')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/assignments/${a.id}/submit`, formData(e.target));
      toast('Handed in.');
      redraw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function teacherPart(el, a, redraw) {
  const subs = a.submissions;
  mount(el, html`
    <div class="stats small">
      <div><small>Handed in</small><strong>${subs.length}/${subs.length + a.missing.length}</strong></div>
      <div><small>Scored</small><strong>${subs.filter((s) => s.score != null).length}</strong></div>
      <div><small>Late</small><strong>${subs.filter((s) => s.late).length}</strong></div>
    </div>
    ${subs.length ? html`<div class="card scroll-x"><table class="table">
      <thead><tr><th>Student</th><th>Handed in</th><th>Work</th><th>Score</th><th></th></tr></thead>
      <tbody>${subs.map((s) => html`<tr>
        <td><strong>${s.student.name}</strong><small>${s.student.studentNo}</small></td>
        <td>${timeAgo(s.submittedAt)}${s.late ? html` ${statusBadge('waitlisted', 'Late')}` : ''}${s.attempts > 1 ? html`<small>Attempt ${s.attempts}</small>` : ''}</td>
        <td class="notes">${(s.text || '').slice(0, 80)}${(s.text || '').length > 80 ? '…' : ''}${s.link ? html`<small><a href="${s.link}" target="_blank" rel="noopener">Link ↗</a></small>` : ''}</td>
        <td>${s.score != null ? html`<strong>${s.score}/${a.points}</strong>` : html`<span class="badge amber">To grade</span>`}</td>
        <td class="row-actions"><button class="btn ${s.score == null ? 'primary' : ''}" data-grade="${s.id}">${s.score == null ? 'Grade' : 'Change'}</button></td>
      </tr>`)}</tbody>
    </table></div>` : empty('Nothing handed in yet')}
    ${a.missing.length ? html`<h3>Not handed in (${a.missing.length})</h3><p>${a.missing.map((m) => m.name).join(', ')}</p>` : ''}`);
  el.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', () => {
    const s = subs.find((x) => x.id === b.dataset.grade);
    modal({
      title: `${s.student.name}: ${a.title}`,
      subtitle: `Handed in ${fmtDateTime(s.submittedAt)}${s.late ? ' (late)' : ''}`,
      wide: true,
      body: html`<div class="stack tight">
        ${s.text ? html`<div class="card" style="background:#fbfaf9"><p class="pre">${s.text}</p></div>` : ''}
        ${s.link ? html`<p><a href="${s.link}" target="_blank" rel="noopener">${s.link}</a></p>` : ''}
        <label class="field"><span>Score (out of ${a.points})</span><input type="number" name="score" min="0" max="${a.points}" step="0.5" value="${s.score ?? ''}" /><span class="hint">Leave blank to return the work so the student can hand it in again.</span></label>
        <label class="field"><span>Feedback</span><textarea name="feedback">${s.feedback || ''}</textarea></label>
      </div>`,
      submitLabel: 'Save',
      async onSubmit(form) {
        await api.post(`/api/submissions/${s.id}/grade`, formData(form));
        toast('Saved.');
        redraw();
      },
    });
  }));
}
