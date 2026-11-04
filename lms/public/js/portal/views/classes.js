// My classes, and one class: a header card (course, schedule, teacher) and a tab for
// each module that is switched on: announcements, lessons, resources, activities,
// attendance, grades, class list.
import { api } from '../../api.js';
import {
  html, mount, modal, toast, fmtDate, fmtDateTime, statusBadge, timeAgo, formData, confirmDialog, empty, raw, escape,
  initials, fmtSize, readFile, dueText, today, downloadFile, toCsv, nowLocal,
} from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon, CATEGORY_ICON } from '../../icons.js';
import { has, isTeacher, classLabel, gradeText } from '../common.js';
import { classTiles, activityHref } from './home.js';

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

// Plain text: keep line breaks, turn URLs into links.
export const richText = (s) => raw(escape(s || '').replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`));

const TABS = [
  ['announcements', 'Announcements', 'megaphone', () => has('announcements')],
  ['lessons', 'Lessons', 'book', () => has('lessons')],
  ['resources', 'Resources', 'folder', () => has('resources')],
  ['activities', 'Activities', 'task', () => has('assignments')],
  ['attendance', 'Attendance', 'calendar', () => has('attendance')],
  ['grades', 'Grades', 'chart', () => has('grades')],
  ['people', 'Class list', 'users', () => isTeacher() && has('enrollment')],
];

export function classHeader(c) {
  const t = c.teacher;
  return html`<section class="card class-head">
    <div class="main">
      <span class="code">${c.course.code} · Section ${c.name}</span>
      <h1>${c.course.title}</h1>
      <div class="meta">
        <span>${icon('clock', 15)} ${c.schedule}</span>
        ${c.room ? html`<span>${icon('mapPin', 15)} ${c.room}</span>` : ''}
        <span>${icon('book', 15)} ${c.course.units} units</span>
        <span>${icon('calendar', 15)} ${c.term.name}</span>
        <span>${icon('users', 15)} ${c.students} student${c.students === 1 ? '' : 's'}</span>
      </div>
    </div>
    <div class="teacher">
      <span class="avatar lg">${t ? initials(t.name) : '?'}</span>
      <div><small>Teacher</small><strong>${t?.name || 'To be assigned'}</strong>${t?.email ? html`<a href="mailto:${t.email}">${icon('mail', 14)} ${t.email}</a>` : ''}</div>
    </div>
  </section>`;
}

export async function classView(el, { id, tab }) {
  const c = await api.get(`/api/classes/${id}`);
  const tabs = TABS.filter(([, , , on]) => on());
  const active = tabs.find(([k]) => k === tab || (tab === 'assignments' && k === 'activities'))?.[0] || tabs[0]?.[0];
  mount(el, html`
    <nav class="crumbs"><a href="#/classes">${isTeacher() ? 'My sections' : 'My classes'}</a>${icon('chevronRight', 14)}<span class="cur">${classLabel(c)}</span></nav>
    ${classHeader(c)}
    ${c.enrollment?.status === 'completed' ? html`<div class="notice ok">${icon('checkCircle')}<p>This class is finished. Final grade: ${gradeText(c.enrollment.finalGrade, c.enrollment.passed)}</p></div>` : ''}
    ${tabs.length ? html`<nav class="tabs">${tabs.map(([k, label, ic]) => html`<a href="#/classes/${id}/${k}" class="${k === active ? 'active' : ''}">${icon(ic, 16)} ${label}</a>`)}</nav>` : ''}
    <div id="tab"></div>`);
  const box = el.querySelector('#tab');
  const render = { announcements, lessons, resources, activities, attendance, grades, people }[active];
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
      <div class="actions end"><button class="btn primary" type="submit">${icon('megaphone', 16)} Post</button></div>
    </form>` : ''}
    <div class="posts" style="margin-top:12px">${list.length ? list.map((a) => html`<article class="post">
      <header><div class="author"><span class="avatar">${initials(a.authorName)}</span><div><strong>${a.title}</strong><span class="by">${a.authorName} · ${timeAgo(a.createdAt)}</span></div></div>
        ${teacher ? html`<button class="icon-btn danger" data-del="${a.id}" aria-label="Delete">${icon('trash')}</button>` : ''}</header>
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
      <label class="field"><span>Lesson</span><textarea name="body" style="min-height:220px">${lesson?.body || ''}</textarea><span class="hint">Plain text. Links become clickable. Put files under Resources.</span></label>
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
    ${teacher ? html`<div class="actions" style="margin-bottom:12px"><button class="btn primary" id="add">${icon('plus', 16)} New lesson</button></div>` : ''}
    <div class="posts">${list.length ? list.map((l, i) => html`<article class="post ${l.published ? '' : 'draft'}">
      <header><div><h3><span class="badge brand">${i + 1}</span> ${l.title}</h3>${!l.published ? html`<span class="by">Draft: students cannot see this yet</span>` : html`<span class="by">${fmtDate((l.updatedAt || l.createdAt).slice(0, 10))}</span>`}</div>
        ${teacher ? html`<div class="actions">
          <button class="icon-btn" data-move="up" data-id="${l.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up', 16)}</button>
          <button class="icon-btn" data-move="down" data-id="${l.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down', 16)}</button>
          <button class="icon-btn" data-edit="${l.id}" aria-label="Edit">${icon('edit', 16)}</button><button class="icon-btn danger" data-del="${l.id}" aria-label="Delete">${icon('trash', 16)}</button></div>` : ''}</header>
      ${l.body ? html`<p class="pre">${richText(l.body)}</p>` : ''}
      ${l.link ? html`<a class="attach" href="${l.link}" target="_blank" rel="noopener">${icon('link', 16)} Open material ${icon('external', 14)}</a>` : ''}
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

// ----- Resources -----
const CATS = [['', 'All'], ['pdf', 'PDF'], ['document', 'Documents'], ['presentation', 'Slides'], ['spreadsheet', 'Spreadsheets'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio'], ['link', 'Links']];
const fileUrl = (f, download) => `/api/files/${f.id}${download ? '?download=1' : ''}`;

function preview(r) {
  if (!r) return html`<div class="empty">${icon('folder', 40)}<p>Pick a resource to preview it here.</p></div>`;
  const f = r.file;
  let body = '';
  if (r.kind === 'link') {
    const yt = r.url.match(/(?:youtu\.be\/|v=)([\w-]{6,})/);
    body = yt ? html`<iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" allowfullscreen title="${r.title}"></iframe>` : html`<p><a class="btn primary" href="${r.url}" target="_blank" rel="noopener">${icon('external', 16)} Open link</a></p><p class="muted small">${r.url}</p>`;
  } else if (f.category === 'pdf') body = html`<iframe src="${fileUrl(f)}" title="${f.name}"></iframe>`;
  else if (f.category === 'image' && /png|jpeg|gif|webp/.test(f.mime)) body = html`<img src="${fileUrl(f)}" alt="${r.title}" />`;
  else if (f.category === 'video') body = html`<video src="${fileUrl(f)}" controls></video>`;
  else if (f.category === 'audio') body = html`<audio src="${fileUrl(f)}" controls style="width:100%"></audio>`;
  else body = html`<div class="empty">${icon(CATEGORY_ICON[f.category], 40)}<p>No preview for this kind of file.</p></div>`;
  return html`<div class="card-head"><h2>${r.title}</h2>${f ? html`<a class="btn sm" href="${fileUrl(f, true)}">${icon('download', 15)} Download</a>` : ''}</div>
    ${r.description ? html`<p class="pre muted" style="margin-bottom:12px">${r.description}</p>` : ''}${body}
    <p class="hint" style="margin-top:10px">${f ? `${f.name} · ${fmtSize(f.size)} · ` : ''}Added ${fmtDate(r.createdAt.slice(0, 10))}${r.createdBy ? ` by ${r.createdBy}` : ''}</p>`;
}

async function resources(el, c, state = { cat: '', sel: null }) {
  const list = await api.get(`/api/classes/${c.id}/resources`);
  const teacher = c.role === 'teacher';
  const shown = list.filter((r) => !state.cat || r.category === state.cat || (state.cat === 'document' && r.category === 'other'));
  const sel = list.find((r) => r.id === state.sel) || shown[0] || null;
  const present = new Set(list.map((r) => r.category));
  mount(el, html`
    ${teacher ? html`<div class="dropzone" id="drop">${icon('upload', 22)}<div><strong>Drop files here</strong> or <button type="button" class="link" id="pick">choose files</button> · up to 10 MB each · or <button type="button" class="link" id="add-link">add a link</button></div><input type="file" id="files" multiple hidden /></div><div style="height:14px"></div>` : ''}
    <div class="chips" style="margin-bottom:14px">${CATS.filter(([k]) => !k || present.has(k)).map(([k, label]) => html`<button type="button" class="chip ${state.cat === k ? 'on' : ''}" data-cat="${k}">${label}</button>`)}</div>
    ${shown.length ? html`<div class="res-layout">
      <div>${shown.map((r, i) => html`<div class="res-item ${r === sel ? 'sel' : ''}" data-id="${r.id}">
        <span class="item-ic">${icon(CATEGORY_ICON[r.category] || 'file')}</span>
        <span class="grow"><strong>${r.title}</strong><small>${r.kind === 'link' ? r.url.replace(/^https?:\/\//, '').slice(0, 50) : `${r.category.toUpperCase()} · ${fmtSize(r.file?.size)}`}${r.published ? '' : ' · hidden from students'}</small></span>
        ${teacher ? html`<span class="actions">
          <button class="icon-btn" data-move="up" data-rid="${r.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up', 15)}</button>
          <button class="icon-btn" data-toggle="${r.id}" title="${r.published ? 'Hide from students' : 'Show to students'}">${icon(r.published ? 'checkCircle' : 'x', 15)}</button>
          <button class="icon-btn danger" data-del="${r.id}" aria-label="Delete">${icon('trash', 15)}</button></span>` : ''}
      </div>`)}</div>
      <section class="card preview">${preview(sel)}</section>
    </div>` : empty(list.length ? 'Nothing of this kind' : 'No resources yet', teacher ? 'Upload slides, PDFs, videos or links for the class.' : '')}`);

  const redraw = (next = state) => resources(el, c, next);
  el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => redraw({ cat: b.dataset.cat, sel: null })));
  el.querySelectorAll('.res-item').forEach((row) => row.addEventListener('click', (e) => !e.target.closest('button') && redraw({ ...state, sel: row.dataset.id })));
  if (!teacher) return;
  const upload = async (fileList) => {
    for (const file of fileList) {
      try {
        toast(`Uploading ${file.name}…`);
        await api.post(`/api/classes/${c.id}/resources`, { file: await readFile(file) });
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    toast('Uploaded.');
    redraw();
  };
  const input = el.querySelector('#files');
  const drop = el.querySelector('#drop');
  el.querySelector('#pick').addEventListener('click', () => input.click());
  input.addEventListener('change', () => upload([...input.files]));
  drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    upload([...e.dataTransfer.files]);
  });
  el.querySelector('#add-link').addEventListener('click', () => modal({
    title: 'Add a link',
    body: html`<div class="stack tight"><label class="field"><span>Address<em>*</em></span><input name="url" placeholder="https://" required /></label>
      <label class="field"><span>Title</span><input name="title" /></label><label class="field"><span>Description</span><textarea name="description" style="min-height:70px"></textarea></label>
      <p class="hint">YouTube links play right in the preview.</p></div>`,
    async onSubmit(form) {
      await api.post(`/api/classes/${c.id}/resources`, formData(form));
      redraw();
    },
  }));
  el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const r = list.find((x) => x.id === b.dataset.toggle);
    await api.put(`/api/resources/${r.id}`, { published: !r.published });
    redraw();
  }));
  el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
    await api.put(`/api/resources/${b.dataset.rid}`, { move: 'up' });
    redraw();
  }));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this resource?'))) return;
    await api.del(`/api/resources/${b.dataset.del}`);
    redraw({ ...state, sel: null });
  }));
}

// ----- Activities: tasks and quizzes -----
export function taskDialog(c, a, onDone, types) {
  modal({
    title: a ? 'Edit assignment' : 'New assignment',
    subtitle: 'Students hand in text, a file or a link; you score it and give feedback.',
    wide: true,
    body: html`<div class="grid">
      <label class="field span-2"><span>Title<em>*</em></span><input name="title" value="${a?.title || ''}" required /></label>
      <label class="field"><span>Type</span><select name="typeId">${types.filter((t) => t.active !== false).map((t) => html`<option value="${t.id}" ${t.id === (a?.typeId || 'task') ? 'selected' : ''}>${t.name}</option>`)}</select></label>
      <label class="field span-3"><span>Instructions</span><textarea name="instructions" style="min-height:160px">${a?.instructions || ''}</textarea></label>
      <label class="field"><span>Opens (optional)</span><input type="datetime-local" name="opensAt" value="${a?.opensAt || ''}" /></label>
      <label class="field"><span>Due</span><input type="datetime-local" name="dueAt" value="${a?.dueAt || ''}" /></label>
      <label class="field"><span>Points<em>*</em></span><input type="number" name="points" min="1" max="1000" value="${a?.points ?? 100}" required /></label>
      <label class="field check span-3"><input type="checkbox" name="allowLate" ${a?.allowLate ? 'checked' : ''} /> <span>Accept late work (marked late)</span></label>
      <label class="field check span-3"><input type="checkbox" name="published" ${!a || a.published ? 'checked' : ''} /> <span>Students can see it</span></label>
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const body = { ...v, kind: 'task', allowLate: Boolean(v.allowLate), published: Boolean(v.published) };
      const saved = await (a ? api.put(`/api/assignments/${a.id}`, body) : api.post(`/api/classes/${c.id}/assignments`, body));
      toast('Saved.');
      onDone(saved);
    },
  });
}

async function activities(el, c) {
  const [list, types] = await Promise.all([api.get(`/api/classes/${c.id}/assignments`), api.get('/api/activity-types')]);
  const teacher = c.role === 'teacher';
  const typeName = (id) => types.find((t) => t.id === id)?.name || 'Activity';
  const status = (a) => {
    if (teacher) return html`<strong>${a.submitted}/${a.students}</strong> done${a.toGrade ? html` · <span class="badge amber">${a.toGrade} to grade</span>` : ''}`;
    const m = a.mine;
    if (m?.inProgress && !m.submitted) return html`<span class="badge blue">In progress</span>`;
    if (!m) return a.open ? html`<span class="badge brand">To do</span>` : a.dueAt && a.dueAt < nowLocal() ? html`<span class="badge red">Missed</span>` : html`<span class="badge gray">Not open yet</span>`;
    if (m.score != null) return html`<span class="badge green">Scored</span> <strong>${m.score}/${a.points}</strong>`;
    if (m.toGrade) return html`<span class="badge amber">Waiting for score</span>`;
    return html`<span class="badge green">Handed in</span>${m.late ? html` <span class="badge amber">Late</span>` : ''}`;
  };
  mount(el, html`
    ${teacher ? html`<div class="actions" style="margin-bottom:12px"><button class="btn primary" id="new-quiz">${icon('quiz', 16)} New quiz or exam</button><button class="btn" id="new-task">${icon('task', 16)} New assignment</button></div>` : ''}
    ${list.length ? html`<div class="card scroll-x"><table class="table clickable">
      <thead><tr><th>Activity</th><th>Type</th><th>Window</th><th>Points</th><th>${teacher ? 'Progress' : 'Status'}</th></tr></thead>
      <tbody>${list.map((a) => html`<tr data-href="${activityHref(a)}">
        <td><span style="display:flex;gap:10px;align-items:center"><span class="item-ic ${a.kind === 'quiz' ? 'info' : ''}">${icon(a.kind === 'quiz' ? 'quiz' : 'task')}</span><span><strong>${a.title}</strong><small>${a.kind === 'quiz' ? `${a.questionCount} question${a.questionCount === 1 ? '' : 's'}${a.quiz?.timeLimit ? ` · ${a.quiz.timeLimit} min` : ' · no time limit'}${a.quiz?.attempts ? ` · ${a.quiz.attempts} attempt${a.quiz.attempts === 1 ? '' : 's'}` : ' · unlimited attempts'}` : a.allowLate ? 'Late work accepted' : 'Assignment'}${a.published ? '' : ' · draft'}</small></span></span></td>
        <td><span class="badge brand">${typeName(a.typeId)}</span></td>
        <td>${a.opensAt ? html`<small>Opens ${fmtDateTime(a.opensAt)}</small>` : ''}${a.dueAt ? dueText(a.dueAt, a.kind === 'quiz' ? 'Closes' : 'Due') : 'No due date'}</td>
        <td>${a.points}</td><td>${status(a)}</td></tr>`)}</tbody>
    </table></div>` : empty('No activities yet', teacher ? 'Create an assignment, or a quiz or exam with automatic grading.' : '')}`);
  el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => (location.hash = tr.dataset.href)));
  el.querySelector('#new-task')?.addEventListener('click', () => taskDialog(c, null, (a) => (location.hash = `#/assignments/${a.id}`), types));
  el.querySelector('#new-quiz')?.addEventListener('click', () => (location.hash = `#/quizzes/new?class=${c.id}`));
}

// ----- Attendance -----
const STATUSES = [['present', 'P', 'Present'], ['late', 'L', 'Late'], ['absent', 'A', 'Absent'], ['excused', 'E', 'Excused']];
const dot = (s) => (s ? html`<span class="att-dot ${s}" title="${s}">${STATUSES.find((x) => x[0] === s)[1]}</span>` : html`<span class="muted">·</span>`);

async function attendance(el, c, state = {}) {
  if (c.role !== 'teacher') {
    const mine = await api.get(`/api/classes/${c.id}/attendance/mine`);
    const s = mine.summary;
    mount(el, html`
      <div class="stats small"><div><small>Attendance rate</small><strong>${s.rate != null ? `${s.rate}%` : '—'}</strong></div>${STATUSES.map(([k, , label]) => html`<div><small>${label}</small><strong>${s[k]}</strong></div>`)}</div>
      ${mine.days.length ? html`<div class="card scroll-x"><table class="table"><thead><tr><th>Date</th><th>Status</th></tr></thead>
        <tbody>${mine.days.map((d) => html`<tr><td>${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</td><td>${dot(d.status)} ${STATUSES.find((x) => x[0] === d.status)[2]}</td></tr>`)}</tbody></table></div>`
        : empty('No attendance yet')}
      <p class="hint">Late counts as attended; excused days are left out of the rate.</p>`);
    return;
  }
  const month = state.month || today().slice(0, 7);
  const date = state.date || today();
  const sheet = await api.get(`/api/classes/${c.id}/attendance?month=${month}`);
  // Early in a month the grid would be empty: show the latest month that has attendance instead.
  if (!state.month && !sheet.days.length && sheet.lastDate && !sheet.lastDate.startsWith(month)) return attendance(el, c, { ...state, month: sheet.lastDate.slice(0, 7) });
  const dayRec = sheet.days.find((d) => d.date === date)?.records || (date.startsWith(month) ? null : (await api.get(`/api/classes/${c.id}/attendance?month=${date.slice(0, 7)}`)).days.find((d) => d.date === date)?.records) || {};
  const [y, m] = month.split('-').map(Number);
  const days = sheet.days.map((d) => d.date);
  const shift = (n) => {
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  mount(el, html`
    <section class="card">
      <div class="card-head"><h2>${icon('check')} Take attendance</h2>
        <div class="actions"><input type="date" id="date" value="${date}" max="${sheet.today}" style="width:auto" /><button class="btn sm" id="all-present">Mark everyone present</button></div></div>
      ${sheet.students.length ? html`<form id="take"><div class="scroll-x"><table class="table no-stack att-take">
        <thead><tr><th>Student</th><th>Status</th><th>Overall</th></tr></thead>
        <tbody>${sheet.students.map((s) => html`<tr><td><strong>${s.name}</strong><small>${s.studentNo}</small></td>
          <td><div class="seg">${STATUSES.map(([k, , label]) => html`<label class="${k}"><input type="radio" name="${s.id}" value="${k}" ${dayRec[s.id] === k ? 'checked' : ''} />${label}</label>`)}</div></td>
          <td>${s.summary.rate != null ? `${s.summary.rate}%` : '—'}<small>${s.summary.absent} absent · ${s.summary.late} late</small></td></tr>`)}</tbody>
      </table></div>
      <div class="actions end" style="margin-top:12px"><span class="hint">${days.includes(date) ? `Saved for ${fmtDate(date)}. Saving again replaces it.` : `Not taken yet for ${fmtDate(date)}.`}</span><button class="btn primary" type="submit">Save attendance</button></div></form>`
        : html`<p class="muted">No students yet.</p>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('calendar')} ${new Date(y, m - 1, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</h2>
        <div class="actions"><button class="btn sm" id="prev">${icon('chevronLeft', 14)} Previous</button><button class="btn sm" id="next">Next ${icon('chevronRight', 14)}</button><button class="btn sm" id="csv">${icon('download', 15)} Export CSV</button></div></div>
      ${days.length ? html`<div class="scroll-x"><table class="table att-table">
        <thead><tr><th>Student</th>${days.map((d) => html`<th class="att">${Number(d.slice(8))}</th>`)}<th class="att">Rate</th></tr></thead>
        <tbody>${sheet.students.map((s) => html`<tr><td class="nowrap">${s.name}</td>${sheet.days.map((d) => html`<td class="att">${dot(d.records[s.id])}</td>`)}<td class="att">${s.summary.rate != null ? `${s.summary.rate}%` : '—'}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="muted">No attendance taken this month.</p>`}
      <div class="legend" style="margin-top:10px">${STATUSES.map(([k, , label]) => html`<span>${dot(k)} ${label}</span>`)}</div>
    </section>`);
  const redraw = (next) => attendance(el, c, { month, date, ...next });
  el.querySelector('#date').addEventListener('change', (e) => redraw({ date: e.target.value, month: e.target.value.slice(0, 7) }));
  el.querySelector('#prev').addEventListener('click', () => redraw({ month: shift(-1) }));
  el.querySelector('#next').addEventListener('click', () => redraw({ month: shift(1) }));
  el.querySelector('#all-present')?.addEventListener('click', () => el.querySelectorAll('#take input[value=present]').forEach((i) => (i.checked = true)));
  el.querySelector('#take')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const records = Object.fromEntries(sheet.students.map((s) => [s.id, e.target.querySelector(`input[name="${s.id}"]:checked`)?.value || '']));
    try {
      await api.put(`/api/classes/${c.id}/attendance/${date}`, { records });
      toast(`Attendance saved for ${fmtDate(date)}.`);
      redraw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#csv').addEventListener('click', () => {
    const rows = [['Student', 'Student no.', ...days, 'Rate %'], ...sheet.students.map((s) => [s.name, s.studentNo, ...sheet.days.map((d) => d.records[s.id] || ''), s.summary.rate ?? ''])];
    downloadFile(`attendance-${c.course.code}-${c.name}-${month}.csv`, toCsv(rows));
  });
}

// ----- Grades -----
async function grades(el, c) {
  if (c.role !== 'teacher') {
    const mine = (await api.get('/api/my/grades')).find((g) => g.class.id === c.id);
    const list = has('assignments') ? await api.get(`/api/classes/${c.id}/assignments`) : [];
    mount(el, html`
      <div class="stats small">
        <div><small>Running grade</small><strong>${mine?.percent != null ? `${mine.percent}%` : '—'}</strong></div>
        <div><small>Points scored</small><strong>${mine ? `${mine.earned}/${mine.possible}` : '—'}</strong></div>
        <div><small>Activities done</small><strong>${mine ? `${mine.done}/${mine.total}` : '—'}</strong></div>
        <div><small>Final grade</small><strong>${mine?.finalGrade ?? '—'}</strong></div>
      </div>
      ${list.length ? html`<div class="card scroll-x"><table class="table clickable">
        <thead><tr><th>Activity</th><th>Score</th></tr></thead>
        <tbody>${list.map((a) => html`<tr data-href="${activityHref(a)}"><td><strong>${a.title}</strong><small>${a.kind === 'quiz' ? 'Quiz' : 'Assignment'}</small></td><td>${a.mine?.score != null ? `${a.mine.score}/${a.points}` : a.mine?.toGrade ? 'Waiting for score' : a.mine?.submitted ? 'Handed in' : '—'}</td></tr>`)}</tbody>
      </table></div>` : ''}
      <p class="hint">${mine?.weighted ? 'Each activity type counts by its weight, as set by the school. ' : ''}The running grade counts scored work only. Your teacher posts the final grade.</p>`);
    el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => (location.hash = tr.dataset.href)));
    return;
  }
  const book = await api.get(`/api/classes/${c.id}/gradebook`);
  const weights = book.types.filter((t) => t.weight > 0);
  mount(el, html`
    <p class="muted">${weights.length ? html`Weighted: ${weights.map((t, i) => html`${i ? ', ' : ''}${t.name} ${t.weight}%`)}. ` : ''}Running % counts scored work only. Final grades are percentages; ${book.passingGrade} or higher passes and completes the class for prerequisites.</p>
    ${book.rows.length ? html`<form id="finals"><div class="card scroll-x"><table class="table gradebook">
      <thead><tr><th>Student</th>${book.assignments.map((a) => html`<th class="score-cell" title="${a.title}">${a.title.length > 18 ? `${a.title.slice(0, 17)}…` : a.title}<br /><small>/${a.points}</small></th>`)}<th class="score-cell">Running %</th><th class="score-cell">Final grade</th></tr></thead>
      <tbody>${book.rows.map((r) => html`<tr>
        <td><strong>${r.student.name}</strong><small>${r.student.studentNo}</small></td>
        ${book.assignments.map((a) => {
          const s = r.scores[a.id];
          return html`<td class="score-cell">${s.score != null ? s.score : s.toGrade ? html`<span class="badge amber">to grade</span>` : s.submitted ? html`<span class="badge gray">handed in</span>` : html`<span class="muted">—</span>`}</td>`;
        })}
        <td class="score-cell"><strong>${r.percent != null ? `${r.percent}%` : '—'}</strong></td>
        <td class="score-cell"><input class="grade-input" type="number" min="0" max="100" step="0.1" name="${r.enrollmentId}" value="${r.finalGrade ?? ''}" data-running="${r.percent ?? ''}" /></td>
      </tr>`)}</tbody>
    </table></div>
    <div class="actions end" style="margin-top:12px"><button type="button" class="btn" id="csv">${icon('download', 15)} Export CSV</button><button type="button" class="btn" id="fill">Fill empty finals from running %</button><button type="submit" class="btn primary">Save final grades</button></div></form>`
      : empty('No students yet')}`);
  el.querySelector('#fill')?.addEventListener('click', () => el.querySelectorAll('.grade-input').forEach((i) => {
    if (i.value === '' && i.dataset.running !== '') i.value = i.dataset.running;
  }));
  el.querySelector('#csv')?.addEventListener('click', () => {
    const rows = [['Student', 'Student no.', ...book.assignments.map((a) => `${a.title} (/${a.points})`), 'Running %', 'Final grade'], ...book.rows.map((r) => [r.student.name, r.student.studentNo, ...book.assignments.map((a) => r.scores[a.id].score ?? ''), r.percent ?? '', r.finalGrade ?? ''])];
    downloadFile(`grades-${c.course.code}-${c.name}.csv`, toCsv(rows));
  });
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
      <tbody>${list.map((r) => html`<tr><td><span class="author"><span class="avatar">${initials(r.student.name)}</span><strong>${r.student.name}</strong></span></td><td class="mono">${r.student.studentNo}</td><td>${r.student.program} ${r.student.yearLevel ? `· Year ${r.student.yearLevel}` : ''}</td>
        <td>${r.student.email ? html`<a href="mailto:${r.student.email}">${r.student.email}</a>` : '—'}</td>${status === 'waitlisted' ? html`<td>#${r.position}</td>` : ''}</tr>`)}</tbody>
    </table></div>` : '';
  }) : empty('No students yet')}
  <p class="hint">The registrar approves requests and manages the waitlist.</p>`);
}

export { statusBadge };
