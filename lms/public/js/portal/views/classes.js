// My classes, and one class with tabs for each module that is switched on.
import { api } from '../../api.js';
import { html, mount, modal, toast, fmtDateTime, statusBadge, timeAgo, formData, confirmDialog, empty, raw, escape, nowLocal } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { has, isTeacher, classLabel, gradeText } from '../common.js';
import { classTiles } from './home.js';

export async function classesView(el, params, query) {
  const all = query.all === '1';
  const classes = await api.get(`/api/classes${all ? '?termId=all' : ''}`);
  const byTerm = new Map();
  for (const c of classes) byTerm.set(c.term.name, [...(byTerm.get(c.term.name) || []), c]);
  mount(el, html`
    ${pageHead(isTeacher() ? 'My sections' : 'My classes', all ? 'All terms' : 'This term', html`<a class="btn" href="#/classes${all ? '' : '?all=1'}">${all ? 'This term only' : 'Show past terms'}</a>`)}
    ${classes.length ? [...byTerm].map(([term, list]) => html`${all ? html`<h3>${term}</h3>` : ''}${classTiles(list)}`)
      : empty(isTeacher() ? 'No sections assigned' : 'No classes yet', isTeacher() ? 'The registrar assigns sections to teachers.' : has('enrollment') ? raw('Find sections under <a href="#/enroll">Enrollment</a>.') : 'The registrar enrolls you in classes.')}`);
}

// Lessons, announcements and instructions are plain text: keep line breaks, turn URLs into links.
export const richText = (s) => raw(escape(s || '').replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`));

const TABS = [
  ['announcements', 'Announcements', () => has('announcements')],
  ['lessons', 'Lessons', () => has('lessons')],
  ['assignments', 'Assignments', () => has('assignments')],
  ['grades', 'Grades', () => has('grades')],
  ['people', 'Class list', () => isTeacher() && has('enrollment')],
];

export async function classView(el, { id, tab }) {
  const c = await api.get(`/api/classes/${id}`);
  const tabs = TABS.filter(([, , on]) => on());
  const active = tabs.find(([k]) => k === tab)?.[0] || tabs[0]?.[0];
  mount(el, html`
    ${pageHead(classLabel(c), html`${c.course.title} · ${c.schedule}${c.room ? ` · ${c.room}` : ''} · ${c.teacher?.name || 'Teacher to be assigned'} · ${c.term.name}`, '', ['/classes', isTeacher() ? 'My sections' : 'My classes'])}
    ${c.enrollment?.status === 'completed' ? html`<div class="notice"><p>This class is finished. Final grade: ${gradeText(c.enrollment.finalGrade, c.enrollment.passed)}</p></div>` : ''}
    ${tabs.length ? html`<nav class="tabs">${tabs.map(([k, label]) => html`<a href="#/classes/${id}/${k}" class="${k === active ? 'active' : ''}">${label}</a>`)}</nav>` : ''}
    <div id="tab"></div>`);
  const box = el.querySelector('#tab');
  const render = { announcements, lessons, assignments, grades, people }[active];
  if (render) await render(box, c);
  else mount(box, empty('Nothing to show', 'No class modules are switched on for your account yet.'));
}

// ----- Announcements -----
async function announcements(el, c) {
  const list = await api.get(`/api/classes/${c.id}/announcements`);
  const teacher = c.role === 'teacher';
  mount(el, html`
    ${teacher ? html`<form class="card stack tight" id="post">
      <label class="field"><span>New announcement</span><input name="title" placeholder="Title" required /></label>
      <textarea name="body" placeholder="Write to the class…"></textarea>
      <div class="actions end"><button class="btn primary" type="submit">Post</button></div>
    </form>` : ''}
    <div class="posts">${list.length ? list.map((a) => html`<article class="post">
      <header><div><h3>${a.title}</h3><span class="by">${a.authorName} · ${timeAgo(a.createdAt)}</span></div>
        ${teacher ? html`<button class="link danger" data-del="${a.id}">Delete</button>` : ''}</header>
      <p class="pre">${richText(a.body)}</p>
    </article>`) : empty('No announcements yet')}</div>`);
  const redraw = () => announcements(el, c);
  el.querySelector('#post')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/classes/${c.id}/announcements`, formData(e.target));
      toast('Posted.');
      redraw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this announcement?'))) return;
    await api.del(`/api/announcements/${b.dataset.del}`);
    redraw();
  }));
}

// ----- Lessons -----
function lessonDialog(c, lesson, onDone) {
  modal({
    title: lesson ? 'Edit lesson' : 'New lesson',
    wide: true,
    body: html`<div class="stack tight">
      <label class="field"><span>Title<em>*</em></span><input name="title" value="${lesson?.title || ''}" required /></label>
      <label class="field"><span>Lesson</span><textarea name="body" style="min-height:220px">${lesson?.body || ''}</textarea><span class="hint">Plain text. Links are clickable.</span></label>
      <label class="field"><span>Material link (optional)</span><input name="link" value="${lesson?.link || ''}" placeholder="https://…  (slides, video, reading)" /></label>
      <label class="field check"><input type="checkbox" name="published" ${lesson ? (lesson.published ? 'checked' : '') : 'checked'} /> <span>Students can see it</span></label>
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const body = { ...v, published: Boolean(v.published) };
      await (lesson ? api.put(`/api/lessons/${lesson.id}`, body) : api.post(`/api/classes/${c.id}/lessons`, body));
      toast('Saved.');
      onDone();
    },
  });
}

async function lessons(el, c) {
  const list = await api.get(`/api/classes/${c.id}/lessons`);
  const teacher = c.role === 'teacher';
  mount(el, html`
    ${teacher ? html`<div class="actions" style="margin-bottom:12px"><button class="btn primary" id="add">+ New lesson</button></div>` : ''}
    <div class="posts">${list.length ? list.map((l, i) => html`<article class="post ${l.published ? '' : 'draft'}">
      <header><div><h3>${i + 1}. ${l.title}</h3>${!l.published ? html`<span class="by">Draft: students cannot see this yet</span>` : ''}</div>
        ${teacher ? html`<div class="actions">
          <button class="link" data-move="up" data-id="${l.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button class="link" data-move="down" data-id="${l.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <button class="link" data-edit="${l.id}">Edit</button><button class="link danger" data-del="${l.id}">Delete</button></div>` : ''}</header>
      ${l.body ? html`<p class="pre">${richText(l.body)}</p>` : ''}
      ${l.link ? html`<p><a class="btn" href="${l.link}" target="_blank" rel="noopener">Open material ↗</a></p>` : ''}
    </article>`) : empty('No lessons yet')}</div>`);
  const redraw = () => lessons(el, c);
  el.querySelector('#add')?.addEventListener('click', () => lessonDialog(c, null, redraw));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => lessonDialog(c, list.find((l) => l.id === b.dataset.edit), redraw)));
  el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
    const l = list.find((x) => x.id === b.dataset.id);
    await api.put(`/api/lessons/${l.id}`, { ...l, move: b.dataset.move });
    redraw();
  }));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this lesson?'))) return;
    await api.del(`/api/lessons/${b.dataset.del}`);
    redraw();
  }));
}

// ----- Assignments -----
export function assignmentDialog(c, a, onDone) {
  modal({
    title: a ? 'Edit assignment' : 'New assignment',
    wide: true,
    body: html`<div class="grid">
      <label class="field span-3"><span>Title<em>*</em></span><input name="title" value="${a?.title || ''}" required /></label>
      <label class="field span-3"><span>Instructions</span><textarea name="instructions" style="min-height:180px">${a?.instructions || ''}</textarea></label>
      <label class="field"><span>Due</span><input type="datetime-local" name="dueAt" value="${a?.dueAt || ''}" /></label>
      <label class="field"><span>Points<em>*</em></span><input type="number" name="points" min="1" max="1000" value="${a?.points ?? 100}" required /></label>
      <div class="field"><span>&nbsp;</span>
        <label class="field check"><input type="checkbox" name="allowLate" ${a?.allowLate ? 'checked' : ''} /> <span>Accept late work (marked late)</span></label></div>
      <label class="field check span-3"><input type="checkbox" name="published" ${!a || a.published ? 'checked' : ''} /> <span>Students can see it</span></label>
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const body = { ...v, allowLate: Boolean(v.allowLate), published: Boolean(v.published) };
      const saved = await (a ? api.put(`/api/assignments/${a.id}`, body) : api.post(`/api/classes/${c.id}/assignments`, body));
      toast('Saved.');
      onDone(saved);
    },
  });
}

async function assignments(el, c) {
  const list = await api.get(`/api/classes/${c.id}/assignments`);
  const teacher = c.role === 'teacher';
  const status = (a) => {
    if (teacher) return html`${a.submitted}/${a.students} handed in<small>${a.graded} scored${a.published ? '' : ' · draft'}</small>`;
    if (!a.mine) return a.dueAt && a.dueAt < nowLocal() && !a.allowLate ? statusBadge('rejected', 'Missed') : statusBadge('pending', 'To do');
    if (a.mine.score != null) return html`${statusBadge('completed', 'Scored')} <strong>${a.mine.score}/${a.points}</strong>`;
    return html`${statusBadge('enrolled', 'Handed in')}${a.mine.late ? html` ${statusBadge('waitlisted', 'Late')}` : ''}`;
  };
  mount(el, html`
    ${teacher ? html`<div class="actions" style="margin-bottom:12px"><button class="btn primary" id="add">+ New assignment</button></div>` : ''}
    ${list.length ? html`<div class="card scroll-x"><table class="table clickable">
      <thead><tr><th>Assignment</th><th>Due</th><th>Points</th><th>${teacher ? 'Submissions' : 'Status'}</th></tr></thead>
      <tbody>${list.map((a) => html`<tr data-id="${a.id}"><td><strong>${a.title}</strong></td><td>${a.dueAt ? fmtDateTime(a.dueAt) : '—'}${a.allowLate ? html`<small>Late work accepted</small>` : ''}</td><td>${a.points}</td><td>${status(a)}</td></tr>`)}</tbody>
    </table></div>` : empty('No assignments yet')}`);
  el.querySelector('#add')?.addEventListener('click', () => assignmentDialog(c, null, (a) => (location.hash = `#/assignments/${a.id}`)));
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => (location.hash = `#/assignments/${tr.dataset.id}`)));
}

// ----- Grades -----
async function grades(el, c) {
  if (c.role !== 'teacher') {
    const mine = (await api.get('/api/my/grades')).find((g) => g.class.id === c.id);
    const list = has('assignments') ? await api.get(`/api/classes/${c.id}/assignments`) : [];
    mount(el, html`
      <div class="stats small">
        <div><small>Running score</small><strong>${mine?.percent != null ? `${mine.percent}%` : '—'}</strong></div>
        <div><small>Points</small><strong>${mine ? `${mine.earned}/${mine.possible}` : '—'}</strong></div>
        <div><small>Final grade</small><strong>${mine?.finalGrade ?? '—'}</strong></div>
      </div>
      ${list.length ? html`<div class="card scroll-x"><table class="table">
        <thead><tr><th>Assignment</th><th>Score</th><th>Feedback</th></tr></thead>
        <tbody>${list.map((a) => html`<tr><td><a href="#/assignments/${a.id}">${a.title}</a></td><td>${a.mine?.score != null ? `${a.mine.score}/${a.points}` : a.mine ? 'Not scored yet' : '—'}</td><td class="notes">${a.mine?.score != null ? html`<a href="#/assignments/${a.id}">Read</a>` : ''}</td></tr>`)}</tbody>
      </table></div>` : ''}
      <p class="hint">The running score counts scored work only. The final grade is posted by your teacher.</p>`);
    return;
  }
  const book = await api.get(`/api/classes/${c.id}/gradebook`);
  mount(el, html`
    <p class="muted">Running % counts scored work only. Final grades are percentages; ${book.passingGrade} or higher passes. Posting a final grade completes the class for that student and counts toward prerequisites.</p>
    ${book.rows.length ? html`<form id="finals"><div class="card scroll-x"><table class="table gradebook no-stack">
      <thead><tr><th>Student</th>${book.assignments.map((a) => html`<th class="score-cell" title="${a.title}">${a.title.length > 18 ? `${a.title.slice(0, 17)}…` : a.title}<br /><small>/${a.points}</small></th>`)}<th class="score-cell">Running %</th><th class="score-cell">Final grade</th></tr></thead>
      <tbody>${book.rows.map((r) => html`<tr>
        <td><strong>${r.student.name}</strong><small>${r.student.studentNo}</small></td>
        ${book.assignments.map((a) => {
          const s = r.scores[a.id];
          return html`<td class="score-cell">${s.score != null ? s.score : s.submitted ? html`<span class="badge amber">to grade</span>` : html`<span class="muted">—</span>`}</td>`;
        })}
        <td class="score-cell">${r.percent != null ? `${r.percent}%` : '—'}</td>
        <td class="score-cell"><input class="grade-input" type="number" min="0" max="100" step="0.1" name="${r.enrollmentId}" value="${r.finalGrade ?? ''}" data-running="${r.percent ?? ''}" /></td>
      </tr>`)}</tbody>
    </table></div>
    <div class="actions end" style="margin-top:12px"><button type="button" class="btn" id="fill">Fill empty finals from running %</button><button type="submit" class="btn primary">Save final grades</button></div></form>`
      : empty('No students yet')}`);
  el.querySelector('#fill')?.addEventListener('click', () => el.querySelectorAll('.grade-input').forEach((i) => {
    if (i.value === '' && i.dataset.running !== '') i.value = i.dataset.running;
  }));
  el.querySelector('#finals')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const finals = [...e.target.querySelectorAll('.grade-input')].map((i) => ({ enrollmentId: i.name, grade: i.value }));
    try {
      await api.put(`/api/classes/${c.id}/final-grades`, { grades: finals });
      toast('Final grades saved.');
      grades(el, c);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ----- Class list (teachers) -----
async function people(el, c) {
  const roster = await api.get(`/api/classes/${c.id}/roster`);
  const groups = [['enrolled', 'Enrolled'], ['completed', 'Completed'], ['pending', 'Waiting for registrar approval'], ['waitlisted', 'Waitlist']];
  mount(el, html`${roster.length ? groups.map(([status, label]) => {
    const list = roster.filter((r) => r.status === status).sort((a, b) => (status === 'waitlisted' ? a.position - b.position : 0));
    return list.length ? html`<h3>${label} (${list.length})</h3><div class="card scroll-x"><table class="table">
      <thead><tr><th>Student</th><th>Number</th><th>Program</th><th>Email</th>${status === 'waitlisted' ? html`<th>Position</th>` : ''}</tr></thead>
      <tbody>${list.map((r) => html`<tr><td><strong>${r.student.name}</strong></td><td class="mono">${r.student.studentNo}</td><td>${r.student.program} ${r.student.yearLevel ? `· Year ${r.student.yearLevel}` : ''}</td>
        <td>${r.student.email ? html`<a href="mailto:${r.student.email}">${r.student.email}</a>` : '—'}</td>${status === 'waitlisted' ? html`<td>#${r.position}</td>` : ''}</tr>`)}</tbody>
    </table></div>` : '';
  }) : empty('No students yet')}
  <p class="hint">The registrar approves requests and manages the waitlist.</p>`);
}
