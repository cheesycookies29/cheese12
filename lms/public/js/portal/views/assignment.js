// One assignment: students hand in text, a file or a link; teachers score it and give feedback,
// stepping from one student to the next.
import { api } from '../../api.js';
import { html, mount, modal, toast, fmtDateTime, statusBadge, timeAgo, formData, confirmDialog, empty, fmtSize, readFile, dueText, initials } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon, CATEGORY_ICON } from '../../icons.js';
import { richText, taskDialog } from './classes.js';
import { classLabel } from '../common.js';

const fileLink = (f) => html`<a class="attach" href="/api/files/${f.id}" target="_blank" rel="noopener">${icon(CATEGORY_ICON[f.category] || 'file', 16)} ${f.name} <span class="muted small">${fmtSize(f.size)}</span></a>`;

export async function assignmentView(el, { id }) {
  const a = await api.get(`/api/assignments/${id}`);
  if (a.kind === 'quiz') return (location.hash = `#/quizzes/${id}`);
  const teacher = 'submissions' in a;
  const back = [['/classes', 'My classes'], [`/classes/${a.class.id}/activities`, classLabel(a.class)]];
  mount(el, html`
    ${pageHead(html`${a.title} ${a.published ? '' : statusBadge('pending', 'Draft')}`, html`${a.class.course.title} · ${dueText(a.dueAt)}${a.allowLate ? ' · late work accepted' : ''} · ${a.points} points`,
      teacher ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit</button><button class="btn danger ghost" id="delete">${icon('trash', 16)} Delete</button>` : '', back)}
    ${a.instructions ? html`<section class="card"><h2>Instructions</h2><p class="pre">${richText(a.instructions)}</p></section>` : ''}
    <div id="work" style="margin-top:16px"></div>`);
  const work = el.querySelector('#work');
  const redraw = () => assignmentView(el, { id });
  if (teacher) {
    teacherPart(work, a, redraw);
    el.querySelector('#edit').addEventListener('click', async () => taskDialog(a.class, a, redraw, await api.get('/api/activity-types')));
    el.querySelector('#delete').addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete “${a.title}” and all ${a.submissions.length} submission(s)?`))) return;
      await api.del(`/api/assignments/${a.id}`);
      location.hash = `#${back[1][0]}`;
    });
  } else studentPart(work, a, redraw);
}

function studentPart(el, a, redraw) {
  const s = a.mine;
  const scored = s?.score != null;
  const canSubmit = !scored && !a.closed;
  let picked = null;
  mount(el, html`
    ${s ? html`<section class="card"><div class="card-head"><h2>Your work</h2><span>${scored ? html`<span class="badge green">Scored ${s.score}/${a.points}</span>` : html`<span class="badge green">Handed in</span>`} ${s.late ? html`<span class="badge amber">Late</span>` : ''}</span></div>
      <p class="muted small">Handed in ${fmtDateTime(s.submittedAt)}${s.attempts > 1 ? ` · attempt ${s.attempts}` : ''}</p>
      ${s.text ? html`<p class="pre">${s.text}</p>` : ''}
      ${s.file ? fileLink(s.file) : ''}
      ${s.link ? html`<p><a href="${s.link}" target="_blank" rel="noopener">${icon('link', 15)} ${s.link}</a></p>` : ''}
      ${s.feedback ? html`<div class="notice info" style="margin-top:12px">${icon('comment')}<p><strong>Feedback${s.gradedBy ? ` from ${s.gradedBy}` : ''}:</strong> ${s.feedback}</p></div>` : ''}
    </section>` : ''}
    ${canSubmit ? html`<form class="card stack tight" id="submit">
      <h2>${s ? 'Hand in again' : 'Hand in your work'}</h2>
      <label class="field"><span>Answer</span><textarea name="text" style="min-height:160px">${s?.text || ''}</textarea></label>
      <div class="field"><span>File (optional, up to 10 MB)</span>
        <div class="dropzone" id="drop">${icon('upload', 20)} <span id="drop-label">${s?.file ? html`Keeping <strong>${s.file.name}</strong>. Drop or <button type="button" class="link" id="pick">choose</button> another file to replace it.` : html`Drop a file here or <button type="button" class="link" id="pick">choose a file</button>`}</span></div>
        <input type="file" id="file" hidden /></div>
      <label class="field"><span>Link to your work (optional)</span><input name="link" value="${s?.link || ''}" placeholder="https://… (document, repository, video)" /></label>
      ${a.dueAt && a.allowLate ? html`<p class="hint">Work handed in after the due date is marked late.</p>` : ''}
      <div class="actions end"><button class="btn primary" type="submit">${icon('upload', 16)} ${s ? 'Replace my work' : 'Hand in'}</button></div>
    </form>` : ''}
    ${!s && a.closed ? empty(a.notOpenYet ? 'Not open yet' : 'Closed', a.notOpenYet ? `Opens ${fmtDateTime(a.opensAt)}.` : 'The due date has passed and this assignment does not accept late work.') : ''}`);
  const form = el.querySelector('#submit');
  if (!form) return;
  const input = el.querySelector('#file');
  const drop = el.querySelector('#drop');
  const choose = (f) => {
    picked = f;
    el.querySelector('#drop-label').textContent = `${f.name} (${fmtSize(f.size)}) will be handed in.`;
  };
  el.querySelector('#pick').addEventListener('click', () => input.click());
  input.addEventListener('change', () => input.files[0] && choose(input.files[0]));
  drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) choose(e.dataTransfer.files[0]);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const body = { ...formData(form), keepFile: Boolean(s?.file) };
      if (picked) body.file = await readFile(picked);
      await api.post(`/api/assignments/${a.id}/submit`, body);
      toast('Handed in.');
      redraw();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
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
        <td><span class="author"><span class="avatar">${initials(s.student.name)}</span><span><strong>${s.student.name}</strong><small>${s.student.studentNo}</small></span></span></td>
        <td>${timeAgo(s.submittedAt)}${s.late ? html` <span class="badge amber">Late</span>` : ''}${s.attempts > 1 ? html`<small>Attempt ${s.attempts}</small>` : ''}</td>
        <td class="notes">${(s.text || '').slice(0, 70)}${(s.text || '').length > 70 ? '…' : ''}${s.file ? html`<small>${icon('file', 13)} ${s.file.name}</small>` : ''}${s.link ? html`<small>${icon('link', 13)} link</small>` : ''}</td>
        <td>${s.score != null ? html`<strong>${s.score}/${a.points}</strong>` : html`<span class="badge amber">To grade</span>`}</td>
        <td class="row-actions"><button class="btn sm ${s.score == null ? 'primary' : ''}" data-grade="${s.id}">${s.score == null ? 'Grade' : 'Change'}</button></td>
      </tr>`)}</tbody>
    </table></div>` : empty('Nothing handed in yet')}
    ${a.missing.length ? html`<h3>Not handed in (${a.missing.length})</h3><p>${a.missing.map((m) => m.name).join(', ')}</p>` : ''}`);

  // Grade one submission; "Save and next" moves to the next one still to grade (like Canvas's SpeedGrader).
  const grade = (s) => {
    const next = () => subs.find((x) => x.id !== s.id && x.score == null);
    modal({
      title: `${s.student.name}: ${a.title}`,
      subtitle: `Handed in ${fmtDateTime(s.submittedAt)}${s.late ? ' (late)' : ''}`,
      wide: true,
      body: html`<div class="stack tight">
        ${s.text ? html`<div class="card" style="background:var(--surface-2)"><p class="pre">${s.text}</p></div>` : ''}
        ${s.file ? html`<div>${fileLink(s.file)}</div>` : ''}
        ${s.file?.category === 'pdf' ? html`<iframe src="/api/files/${s.file.id}" style="width:100%;height:50vh;border:1px solid var(--border);border-radius:8px" title="${s.file.name}"></iframe>` : ''}
        ${s.file?.category === 'image' ? html`<img src="/api/files/${s.file.id}" alt="" style="max-width:100%;border-radius:8px" />` : ''}
        ${s.link ? html`<p><a href="${s.link}" target="_blank" rel="noopener">${s.link}</a></p>` : ''}
        <div class="grid two">
          <label class="field"><span>Score (out of ${a.points})</span><input type="number" name="score" min="0" max="${a.points}" step="0.5" value="${s.score ?? ''}" /></label>
          <label class="field check" style="align-self:end"><input type="checkbox" name="andNext" ${next() ? 'checked' : 'disabled'} /> <span>Then open the next one to grade</span></label>
        </div>
        <span class="hint">Leave the score blank to return the work so the student can hand it in again.</span>
        <label class="field"><span>Feedback</span><textarea name="feedback">${s.feedback || ''}</textarea></label>
      </div>`,
      submitLabel: 'Save',
      async onSubmit(form) {
        const v = formData(form);
        await api.post(`/api/submissions/${s.id}/grade`, v);
        s.score = v.score === '' ? null : Number(v.score);
        toast('Saved.');
        const n = v.andNext && next();
        if (n) setTimeout(() => grade(n), 50);
        else redraw();
      },
    });
  };
  el.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', () => grade(subs.find((x) => x.id === b.dataset.grade))));
}
