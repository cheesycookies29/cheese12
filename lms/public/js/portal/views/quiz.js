// Quizzes and exams: the teacher's question builder, the student's timed quiz
// (answers save as they go; it submits itself when time runs out), results with
// per-question analysis, and scoring essays.
import { api } from '../../api.js';
import { html, mount, toast, fmtDateTime, confirmDialog, empty, raw, escape, dueText, downloadFile, toCsv, initials } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { classLabel } from '../common.js';
import { richText } from './classes.js';

const TYPE_LABELS = { single: 'One answer', multiple: 'Several answers', truefalse: 'True or false', short: 'Short answer', essay: 'Essay (you score it)' };
const SHOW_LABELS = { immediately: 'Right after they submit', after_close: 'After the quiz closes', never: 'Never (score only)' };
const crumbs = (cls, extra = []) => [['/classes', 'My classes'], [`/classes/${cls.id}/activities`, classLabel(cls)], ...extra];

// ----- Builder -----
const blankQuestion = (type) => ({
  type, prompt: '', points: type === 'essay' ? 5 : 1,
  options: type === 'single' || type === 'multiple' ? [{ text: '', correct: true }, { text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }] : undefined,
  answer: type === 'truefalse' ? true : undefined,
  answers: type === 'short' ? [] : undefined,
});

export async function quizEditView(el, { id, classId }) {
  const types = await api.get('/api/activity-types');
  const existing = id ? await api.get(`/api/quizzes/${id}`) : null;
  const cls = existing ? { id: existing.sectionId } : { id: classId };
  const info = await api.get(`/api/classes/${cls.id}`);
  const q = existing || { title: '', instructions: '', typeId: 'short-quiz', opensAt: '', dueAt: '', published: false, quiz: { timeLimit: 30, attempts: 1, shuffle: false, showResults: 'after_close' }, questions: [blankQuestion('single')] };
  const state = structuredClone(q.questions);
  const total = () => state.reduce((s, x) => s + (Number(x.points) || 0), 0);

  mount(el, html`
    ${pageHead(existing ? `Edit ${existing.title}` : 'New quiz or exam', html`${info.course.title} · answers are graded automatically, essays by you`, '', crumbs(info))}
    <form id="quiz" class="stack">
      <section class="card"><h2>Details</h2><div class="grid">
        <label class="field span-2"><span>Title<em>*</em></span><input name="title" value="${q.title}" placeholder="e.g. Quiz 1: Classes and objects" required /></label>
        <label class="field"><span>Type</span><select name="typeId">${types.filter((t) => t.active !== false).map((t) => html`<option value="${t.id}" ${t.id === q.typeId ? 'selected' : ''}>${t.name}${t.weight ? ` (${t.weight}% of grade)` : ''}</option>`)}</select></label>
        <label class="field span-3"><span>Instructions</span><textarea name="instructions" style="min-height:80px" placeholder="What students should know before they start">${q.instructions}</textarea></label>
        <label class="field"><span>Opens</span><input type="datetime-local" name="opensAt" value="${q.opensAt}" /><span class="hint">Blank: open as soon as it is published.</span></label>
        <label class="field"><span>Closes</span><input type="datetime-local" name="dueAt" value="${q.dueAt}" /><span class="hint">Attempts in progress are submitted at this time.</span></label>
        <label class="field"><span>Time limit (minutes)</span><input type="number" name="timeLimit" min="0" max="600" value="${q.quiz.timeLimit}" /><span class="hint">0 = no limit. The server keeps the time, not the student's computer.</span></label>
        <label class="field"><span>Attempts allowed</span><input type="number" name="attempts" min="0" max="20" value="${q.quiz.attempts}" /><span class="hint">0 = unlimited. The highest score counts.</span></label>
        <label class="field"><span>Students see answers</span><select name="showResults">${Object.entries(SHOW_LABELS).map(([k, l]) => html`<option value="${k}" ${k === q.quiz.showResults ? 'selected' : ''}>${l}</option>`)}</select></label>
        <div class="field"><span>Options</span>
          <label class="field check"><input type="checkbox" name="shuffle" ${q.quiz.shuffle ? 'checked' : ''} /> <span>Shuffle question order for each student</span></label>
          <label class="field check"><input type="checkbox" name="published" ${q.published ? 'checked' : ''} /> <span>Published (students can see it)</span></label></div>
      </div></section>
      <div class="card-head"><h2>Questions <span class="badge brand" id="count"></span></h2><span class="muted" id="total"></span></div>
      <div id="questions"></div>
      <section class="card"><div class="actions"><strong>Add a question:</strong>${Object.entries(TYPE_LABELS).map(([t, l]) => html`<button type="button" class="btn sm" data-add="${t}">${icon('plus', 14)} ${l.replace(' (you score it)', '')}</button>`)}</div></section>
      <div class="actions end"><a class="btn" href="#/classes/${cls.id}/activities">Cancel</a><button class="btn primary" type="submit">${existing ? 'Save changes' : 'Create quiz'}</button></div>
    </form>`);

  const box = el.querySelector('#questions');
  function render() {
    el.querySelector('#count').textContent = state.length;
    el.querySelector('#total').textContent = `${total()} points in all`;
    mount(box, html`${state.map((x, i) => html`<section class="q-card q-edit" data-i="${i}">
      <header><span class="qn">Q${i + 1}</span>
        <select data-f="type" style="width:auto">${Object.entries(TYPE_LABELS).map(([t, l]) => html`<option value="${t}" ${t === x.type ? 'selected' : ''}>${l}</option>`)}</select>
        <label class="inline">Points <input type="number" data-f="points" min="0.5" max="100" step="0.5" value="${x.points}" style="width:80px" /></label>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up', 16)}</button>
        <button type="button" class="icon-btn" data-act="down" ${i === state.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down', 16)}</button>
        <button type="button" class="icon-btn" data-act="copy" title="Duplicate">${icon('layers', 16)}</button>
        <button type="button" class="icon-btn danger" data-act="del" aria-label="Delete">${icon('trash', 16)}</button>
      </header>
      <textarea data-f="prompt" placeholder="Question" style="min-height:64px">${x.prompt}</textarea>
      <div style="margin-top:10px">${
        x.type === 'single' || x.type === 'multiple'
          ? html`${x.options.map((o, j) => html`<div class="opt-row">
              <input type="${x.type === 'single' ? 'radio' : 'checkbox'}" name="correct-${i}" data-opt="${j}" data-f="correct" ${o.correct ? 'checked' : ''} title="Correct answer" />
              <input data-opt="${j}" data-f="text" value="${o.text}" placeholder="Choice ${j + 1}" />
              <button type="button" class="icon-btn danger" data-act="del-opt" data-opt="${j}" ${x.options.length <= 2 ? 'disabled' : ''} aria-label="Remove choice">${icon('x', 15)}</button></div>`)}
            <button type="button" class="link" data-act="add-opt">${icon('plus', 14)} Add a choice</button>
            <p class="hint">Tick the correct ${x.type === 'single' ? 'answer' : 'answers'}.${x.type === 'multiple' ? ' Partial credit: each right pick adds, each wrong pick takes away.' : ''}</p>`
          : x.type === 'truefalse'
            ? html`<div class="days"><label><input type="radio" name="tf-${i}" data-f="answer" value="true" ${x.answer === true ? 'checked' : ''} /> True</label><label><input type="radio" name="tf-${i}" data-f="answer" value="false" ${x.answer === false ? 'checked' : ''} /> False</label></div>`
            : x.type === 'short'
              ? html`<label class="field"><span>Accepted answers, one per line</span><textarea data-f="answers" style="min-height:60px">${(x.answers || []).join('\n')}</textarea><span class="hint">Capital letters and extra spaces are ignored.</span></label>`
              : html`<p class="hint">Students write freely; you score it from the results page.</p>`
      }</div>
    </section>`)}`);
  }
  render();

  box.addEventListener('input', (e) => {
    const card = e.target.closest('[data-i]');
    if (!card) return;
    const x = state[Number(card.dataset.i)];
    const f = e.target.dataset.f;
    const j = e.target.dataset.opt;
    if (f === 'prompt') x.prompt = e.target.value;
    else if (f === 'points') {
      x.points = Number(e.target.value);
      el.querySelector('#total').textContent = `${total()} points in all`;
    } else if (f === 'text') x.options[j].text = e.target.value;
    else if (f === 'answers') x.answers = e.target.value.split('\n');
  });
  box.addEventListener('change', (e) => {
    const card = e.target.closest('[data-i]');
    if (!card) return;
    const i = Number(card.dataset.i);
    const x = state[i];
    const f = e.target.dataset.f;
    if (f === 'type') {
      const fresh = blankQuestion(e.target.value);
      state[i] = { ...fresh, id: x.id, prompt: x.prompt, points: x.points, options: fresh.options && x.options ? x.options.map((o, k) => ({ ...o, correct: e.target.value === 'single' ? k === x.options.findIndex((y) => y.correct) : o.correct })) : fresh.options };
      render();
    } else if (f === 'correct') {
      if (x.type === 'single') x.options.forEach((o, k) => (o.correct = String(k) === e.target.dataset.opt));
      else x.options[e.target.dataset.opt].correct = e.target.checked;
    } else if (f === 'answer') x.answer = e.target.value === 'true';
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = Number(b.closest('[data-i]').dataset.i);
    const x = state[i];
    const act = b.dataset.act;
    if (act === 'up' || act === 'down') {
      const j = act === 'up' ? i - 1 : i + 1;
      [state[i], state[j]] = [state[j], state[i]];
    } else if (act === 'copy') state.splice(i + 1, 0, { ...structuredClone(x), id: undefined, options: x.options?.map((o) => ({ text: o.text, correct: o.correct })) });
    else if (act === 'del') {
      if (state.length === 1) return toast('A quiz needs at least one question.', 'error');
      state.splice(i, 1);
    } else if (act === 'add-opt') x.options.push({ text: '', correct: false });
    else if (act === 'del-opt') x.options.splice(Number(b.dataset.opt), 1);
    render();
  });
  el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    state.push(blankQuestion(b.dataset.add));
    render();
    box.lastElementChild?.querySelector('textarea')?.focus();
  }));

  el.querySelector('#quiz').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const v = Object.fromEntries(new FormData(f));
    const body = {
      kind: 'quiz', title: v.title, typeId: v.typeId, instructions: v.instructions, opensAt: v.opensAt, dueAt: v.dueAt, published: Boolean(v.published),
      quiz: { timeLimit: v.timeLimit, attempts: v.attempts, shuffle: Boolean(v.shuffle), showResults: v.showResults },
      questions: state.map((x) => ({ ...x, options: x.options?.filter((o) => o.text.trim()) })),
    };
    try {
      const saved = existing ? await api.put(`/api/assignments/${existing.id}`, body) : await api.post(`/api/classes/${cls.id}/assignments`, body);
      toast(existing ? 'Quiz saved.' : 'Quiz created.');
      location.hash = `#/quizzes/${saved.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ----- Quiz page -----
export async function quizView(el, { id }) {
  const q = await api.get(`/api/quizzes/${id}`);
  const cls = await api.get(`/api/classes/${q.sectionId}`);
  if (q.questions) return teacherQuiz(el, q, cls);
  if (q.current) return takeQuiz(el, q, cls);
  return quizIntro(el, q, cls);
}

const detailsList = (q) => html`<dl class="info-grid">
  <div class="info"><dt>Questions</dt><dd>${q.questionCount}</dd></div>
  <div class="info"><dt>Points</dt><dd>${q.points}</dd></div>
  <div class="info"><dt>Time limit</dt><dd>${q.quiz.timeLimit ? `${q.quiz.timeLimit} minutes` : 'None'}</dd></div>
  <div class="info"><dt>Attempts</dt><dd>${q.quiz.attempts || 'Unlimited'}${q.attemptsLeft != null ? ` (${q.attemptsLeft} left)` : ''}</dd></div>
  <div class="info"><dt>Opens</dt><dd>${q.opensAt ? fmtDateTime(q.opensAt) : 'Now'}</dd></div>
  <div class="info"><dt>Closes</dt><dd>${q.dueAt ? fmtDateTime(q.dueAt) : 'No closing time'}</dd></div>
</dl>`;

function teacherQuiz(el, q, cls) {
  mount(el, html`
    ${pageHead(html`${q.title} ${q.published ? html`<span class="badge green">Published</span>` : html`<span class="badge amber">Draft</span>`}`, `${cls.course.title} · ${dueText(q.dueAt, 'Closes')}`,
      html`<a class="btn primary" href="#/quizzes/${q.id}/results">${icon('chart', 16)} Results</a><a class="btn" href="#/quizzes/${q.id}/edit">${icon('edit', 16)} Edit</a><button class="btn danger ghost" id="delete">${icon('trash', 16)} Delete</button>`, crumbs(cls))}
    <section class="card">${detailsList(q)}${q.instructions ? html`<p class="pre" style="margin-top:14px">${richText(q.instructions)}</p>` : ''}</section>
    <h3>Questions and answers</h3>
    ${q.questions.map((x, i) => questionReview(x, i, null))}`);
  el.querySelector('#delete').addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete “${q.title}” and every attempt at it?`))) return;
    await api.del(`/api/assignments/${q.id}`);
    location.hash = `#/classes/${q.sectionId}/activities`;
  });
}

// A question with the right answer marked; with `answer`, also the student's answer and score.
function questionReview(x, i, attempt) {
  const a = attempt?.answers?.[x.id];
  const score = attempt?.itemScores?.[x.id];
  const fb = attempt?.feedback?.[x.id];
  const answered = (o) => (x.type === 'multiple' ? (a || []).includes(o.id) : a === o.id);
  return html`<section class="q-card">
    <header><span class="qn">Q${i + 1}</span><span class="badge gray">${TYPE_LABELS[x.type]}</span><span class="spacer"></span>
      ${attempt ? html`<strong>${score == null ? 'Not scored yet' : `${score}/${x.points}`}</strong>` : html`<span class="muted">${x.points} pt${x.points === 1 ? '' : 's'}</span>`}</header>
    <p class="q-prompt">${x.prompt}</p>
    ${x.options ? x.options.map((o) => html`<div class="opt ${o.correct ? 'right' : attempt && answered(o) ? 'wrong' : ''}">${icon(o.correct ? 'checkCircle' : attempt && answered(o) ? 'x' : 'circle', 16)} ${o.text}${attempt && answered(o) ? html` <span class="badge gray">${attempt.student ? 'their answer' : 'your answer'}</span>` : ''}</div>`) : ''}
    ${x.type === 'truefalse' ? html`<p>Answer: <strong>${x.answer ? 'True' : 'False'}</strong>${attempt ? html` · ${attempt.student ? 'They' : 'You'} said <strong>${a == null ? '—' : a ? 'True' : 'False'}</strong>` : ''}</p>` : ''}
    ${x.type === 'short' ? html`<p>Accepted: <strong>${x.answers.join(' · ')}</strong>${attempt ? html`<br />Answer given: <strong>${a || '—'}</strong>` : ''}</p>` : ''}
    ${x.type === 'essay' && attempt ? html`<div class="card" style="background:var(--surface-2)"><p class="pre">${a || '(no answer)'}</p></div>` : ''}
    ${fb ? html`<div class="notice info" style="margin:10px 0 0">${icon('comment')}<p>${fb}</p></div>` : ''}
  </section>`;
}

function quizIntro(el, q, cls) {
  const submitted = q.attempts.filter((a) => a.submittedAt);
  const canStart = q.open && (q.attemptsLeft == null || q.attemptsLeft > 0);
  const best = submitted.length ? submitted.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0] : null;
  mount(el, html`
    ${pageHead(q.title, `${cls.course.title} · ${q.points} points`, '', crumbs(cls))}
    <div class="cols wide-left">
      <div class="stack">
        <section class="card">
          ${q.instructions ? html`<p class="pre" style="margin-bottom:16px">${richText(q.instructions)}</p>` : ''}
          ${detailsList(q)}
          <div class="actions" style="margin-top:18px">
            ${canStart ? html`<button class="btn primary big" id="start">${icon('play', 18)} ${submitted.length ? 'Start another attempt' : 'Start quiz'}</button>` : ''}
            ${!q.open ? html`<span class="badge ${q.opensAt && !submitted.length ? 'gray' : 'red'}">${q.opensAt && new Date(`${q.opensAt}:00`) > new Date() ? `Opens ${fmtDateTime(q.opensAt)}` : 'Closed'}</span>` : ''}
            ${q.open && q.attemptsLeft === 0 ? html`<span class="badge gray">No attempts left</span>` : ''}
          </div>
          ${canStart && q.quiz.timeLimit ? html`<p class="hint" style="margin-top:10px">The clock starts when you press Start and keeps running if you close the page. Answers save as you go, and the quiz submits itself when time is up.</p>` : ''}
        </section>
        ${q.review && best ? html`<h3>Your best attempt, with answers</h3>${q.review.map((x, i) => questionReview(x, i, best))}` : ''}
      </div>
      <section class="card"><h2>Your attempts</h2>
        ${submitted.length ? html`<div class="list">${submitted.map((a, i) => html`<div class="list-item"><span class="item-ic ${a.score != null ? 'ok' : ''}">${icon(a.score != null ? 'checkCircle' : 'clock')}</span>
          <span class="grow"><strong>Attempt ${i + 1}${a.autoSubmitted ? ' (time ran out)' : ''}</strong><small>${fmtDateTime(a.submittedAt)}</small></span>
          <strong>${a.score != null ? `${a.score}/${q.points}` : a.status === 'submitted' ? 'Waiting for teacher' : q.quiz.showResults === 'never' ? 'Hidden' : 'After it closes'}</strong></div>`)}</div>`
          : html`<p class="muted">You haven't taken this quiz yet.</p>`}
        ${q.best != null ? html`<p style="margin-top:12px">Counts toward your grade: <strong>${q.best}/${q.points}</strong></p>` : ''}
      </section>
    </div>`);
  el.querySelector('#start')?.addEventListener('click', async () => {
    try {
      await api.post(`/api/quizzes/${q.id}/start`);
      quizView(el, { id: q.id });
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function takeQuiz(el, q, cls) {
  const at = q.current;
  const answers = { ...at.answers };
  const qs = at.questions;
  const isAnswered = (x) => {
    const v = answers[x.id];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '';
  };
  const deadline = new Date(at.deadline).getTime();
  const timed = Boolean(q.quiz.timeLimit || q.dueAt);
  mount(el, html`
    ${pageHead(q.title, `${cls.course.title} · ${q.questionCount} questions · ${q.points} points`, '', crumbs(cls))}
    <div class="quiz-layout">
      <form id="answers">${qs.map((x, i) => html`<section class="q-card" id="q-${i}" data-q="${x.id}">
        <header><span class="qn">Question ${i + 1}</span><span class="badge gray">${x.points} pt${x.points === 1 ? '' : 's'}</span>${x.type === 'multiple' ? html`<span class="hint">Choose all that apply.</span>` : ''}</header>
        <p class="q-prompt">${x.prompt}</p>
        ${x.type === 'single' || x.type === 'multiple' ? x.options.map((o) => html`<label class="opt"><input type="${x.type === 'single' ? 'radio' : 'checkbox'}" name="${x.id}" value="${o.id}" ${x.type === 'single' ? (answers[x.id] === o.id ? 'checked' : '') : (answers[x.id] || []).includes(o.id) ? 'checked' : ''} /> ${o.text}</label>`) : ''}
        ${x.type === 'truefalse' ? html`<label class="opt"><input type="radio" name="${x.id}" value="true" ${answers[x.id] === true ? 'checked' : ''} /> True</label><label class="opt"><input type="radio" name="${x.id}" value="false" ${answers[x.id] === false ? 'checked' : ''} /> False</label>` : ''}
        ${x.type === 'short' ? html`<input name="${x.id}" value="${answers[x.id] || ''}" placeholder="Your answer" autocomplete="off" />` : ''}
        ${x.type === 'essay' ? html`<textarea name="${x.id}" style="min-height:180px" placeholder="Write your answer">${answers[x.id] || ''}</textarea>` : ''}
      </section>`)}</form>
      <aside class="quiz-side card">
        ${timed ? html`<small class="muted">Time left</small><div class="timer" id="timer">--:--</div>` : html`<small class="muted">No time limit</small>`}
        <p class="save-state" id="save-state">All answers saved.</p>
        <h3 style="margin-top:14px">Questions</h3>
        <div class="q-nav" id="qnav">${qs.map((x, i) => html`<a href="#q-${i}" data-jump="${i}" class="${isAnswered(x) ? 'done' : ''}">${i + 1}</a>`)}</div>
        <button class="btn primary block" id="submit" style="margin-top:16px">${icon('check', 16)} Submit</button>
      </aside>
    </div>`);

  const form = el.querySelector('#answers');
  const saveState = el.querySelector('#save-state');
  let pending = null;
  let saving = Promise.resolve();
  let done = false;
  const read = (x) => {
    if (x.type === 'multiple') return [...form.querySelectorAll(`input[name="${x.id}"]:checked`)].map((i) => i.value);
    if (x.type === 'truefalse') {
      const v = form.querySelector(`input[name="${x.id}"]:checked`)?.value;
      return v == null ? null : v === 'true';
    }
    if (x.type === 'single') return form.querySelector(`input[name="${x.id}"]:checked`)?.value ?? null;
    return form.querySelector(`[name="${x.id}"]`).value;
  };
  const save = (submit = false) => {
    clearTimeout(pending);
    for (const x of qs) answers[x.id] = read(x);
    saveState.textContent = submit ? 'Submitting…' : 'Saving…';
    saving = saving.then(() => api.put(`/api/attempts/${at.id}`, { answers, submit })).then(
      () => (saveState.textContent = 'All answers saved.'),
      (err) => {
        saveState.textContent = err.message;
        if (/Time is up|already been submitted/.test(err.message)) finish(err.message);
        else throw err;
      },
    );
    return saving;
  };
  const finish = (message) => {
    if (done) return;
    done = true;
    clearInterval(tick);
    toast(message || 'Submitted.');
    quizView(el, { id: q.id });
  };
  form.addEventListener('input', () => {
    el.querySelectorAll('#qnav a').forEach((a, i) => a.classList.toggle('done', (() => {
      const v = read(qs[i]);
      return Array.isArray(v) ? v.length > 0 : v !== null && v !== '';
    })()));
    saveState.textContent = 'Unsaved changes…';
    clearTimeout(pending);
    pending = setTimeout(() => save(), 900);
  });
  el.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    el.querySelector(`#q-${a.dataset.jump}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  el.querySelector('#submit').addEventListener('click', async () => {
    const left = qs.filter((x) => {
      const v = read(x);
      return Array.isArray(v) ? !v.length : v === null || v === '';
    }).length;
    if (!(await confirmDialog(left ? `${left} question${left === 1 ? ' is' : 's are'} unanswered. Submit anyway?` : 'Submit your answers? You cannot change them afterwards.', { confirmLabel: 'Submit', danger: false, title: 'Submit quiz' }))) return;
    await save(true).then(() => finish('Submitted. Well done!'), (err) => toast(err.message, 'error'));
  });
  const timer = el.querySelector('#timer');
  const tick = setInterval(() => {
    if (!timer) return;
    const ms = deadline - Date.now();
    if (ms <= 0) {
      timer.textContent = '0:00';
      save(true).then(() => finish('Time is up. Your answers were submitted.'), () => finish('Time is up.'));
      return clearInterval(tick);
    }
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    timer.textContent = `${h ? `${h}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
    timer.classList.toggle('low', ms < 60000);
  }, 1000);
  const beforeUnload = (e) => {
    if (saveState.textContent !== 'All answers saved.') e.preventDefault();
  };
  window.addEventListener('beforeunload', beforeUnload);
  return () => {
    clearInterval(tick);
    window.removeEventListener('beforeunload', beforeUnload);
    if (!done) save(); // leaving the page keeps the answers
  };
}

// ----- Results (teacher) -----
export async function quizResultsView(el, { id }) {
  const r = await api.get(`/api/quizzes/${id}/results`);
  const cls = await api.get(`/api/classes/${r.quiz.sectionId}`);
  const s = r.summary;
  mount(el, html`
    ${pageHead(`Results: ${r.quiz.title}`, `${cls.course.title} · ${r.quiz.points} points`, html`<a class="btn" href="#/quizzes/${id}">${icon('quiz', 16)} Quiz</a><button class="btn" id="csv">${icon('download', 15)} Export CSV</button>`, crumbs(cls, [[`/quizzes/${id}`, r.quiz.title]]))}
    <div class="stats">
      <div class="card"><small>Submitted</small><strong>${s.submitted}/${r.rows.length}</strong></div>
      <div class="card"><small>Average</small><strong>${s.average ?? '—'}</strong></div>
      <div class="card"><small>Highest</small><strong>${s.highest ?? '—'}</strong></div>
      <div class="card"><small>Lowest</small><strong>${s.lowest ?? '—'}</strong></div>
      <div class="card ${s.toGrade ? 'accent' : ''}"><small>Essays to score</small><strong>${s.toGrade}</strong></div>
    </div>
    <div class="cols wide-left">
      <section class="card scroll-x"><h2>Students</h2><table class="table">
        <thead><tr><th>Student</th><th>Attempts</th><th>Best score</th><th></th></tr></thead>
        <tbody>${r.rows.map((x) => html`<tr><td><span class="author"><span class="avatar">${initials(x.student.name)}</span><span><strong>${x.student.name}</strong><small>${x.student.studentNo}</small></span></span></td>
          <td>${x.attempts}${x.inProgress ? html` <span class="badge blue">taking it now</span>` : ''}</td>
          <td>${x.best ? html`<strong>${x.best.score}/${r.quiz.points}</strong>${x.best.needsGrading ? html` <span class="badge amber">${x.best.needsGrading} to score</span>` : ''}${x.best.autoSubmitted ? html`<small>Time ran out</small>` : ''}` : html`<span class="muted">Not taken</span>`}</td>
          <td class="row-actions">${x.best ? html`<a class="btn sm ${x.best.needsGrading ? 'primary' : ''}" href="#/attempts/${x.best.id}">${x.best.needsGrading ? 'Score' : 'Review'}</a>` : ''}</td></tr>`)}</tbody>
      </table></section>
      <section class="card"><h2>How each question went</h2>
        ${r.items.map((it, i) => html`<div class="feed-item"><strong>Q${i + 1}.</strong> ${it.prompt.length > 70 ? `${it.prompt.slice(0, 69)}…` : it.prompt}
          <div class="progress" style="margin:6px 0"><i style="width:${it.correctRate ?? 0}%;background:${it.correctRate != null && it.correctRate < 50 ? 'var(--danger)' : 'var(--brand)'}"></i></div>
          <small>${it.correctRate != null ? `${it.correctRate}% full marks · average ${it.average}/${it.points}` : 'No answers yet'}${it.type === 'essay' ? ' · essay' : ''}</small></div>`)}
        <p class="hint" style="margin-top:8px">Questions in red were missed by most of the class: worth going over again.</p>
      </section>
    </div>`);
  el.querySelector('#csv').addEventListener('click', () => downloadFile(`quiz-${r.quiz.title.replace(/\W+/g, '-')}.csv`, toCsv([['Student', 'Student no.', 'Attempts', `Best score (/${r.quiz.points})`], ...r.rows.map((x) => [x.student.name, x.student.studentNo, x.attempts, x.best?.score ?? ''])])));
}

// ----- Scoring one attempt (teacher) -----
export async function attemptGradeView(el, { id }) {
  const { attempt, quiz, student } = await api.get(`/api/attempts/${id}`);
  const cls = await api.get(`/api/classes/${(await api.get(`/api/quizzes/${quiz.id}`)).sectionId}`);
  mount(el, html`
    ${pageHead(`${student.name}: ${quiz.title}`, html`Submitted ${fmtDateTime(attempt.submittedAt)}${attempt.autoSubmitted ? ' (time ran out)' : ''} · <strong>${attempt.score}/${quiz.points}</strong>${attempt.needsGrading ? ` · ${attempt.needsGrading} to score` : ''}`, '',
      crumbs(cls, [[`/quizzes/${quiz.id}/results`, 'Results']]))}
    <form id="grade">${quiz.questions.map((x, i) => html`${questionReview(x, i, { ...attempt, student, feedback: {} })}
      <div class="card" style="margin:-6px 0 14px;padding:12px 16px"><div class="grid">
        <label class="field"><span>Score for Q${i + 1} (out of ${x.points})</span><input type="number" name="s-${x.id}" min="0" max="${x.points}" step="0.5" value="${attempt.manualScores?.[x.id] ?? attempt.itemScores?.[x.id] ?? ''}" placeholder="${x.type === 'essay' ? 'Score this answer' : ''}" /></label>
        <label class="field span-2"><span>Feedback</span><input name="f-${x.id}" value="${attempt.feedback?.[x.id] || ''}" /></label>
      </div></div>`)}
      <div class="actions end"><a class="btn" href="#/quizzes/${quiz.id}/results">Back</a><button class="btn primary" type="submit">Save scores</button></div>
    </form>`);
  el.querySelector('#grade').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    const scores = {};
    const feedback = {};
    for (const x of quiz.questions) {
      const auto = attempt.itemScores?.[x.id];
      const given = v[`s-${x.id}`];
      // Only send a score when the teacher set or changed it, so automatic scores stay automatic.
      if (given !== '' && Number(given) !== auto) scores[x.id] = given;
      else if (attempt.manualScores?.[x.id] != null && given === '') scores[x.id] = '';
      feedback[x.id] = v[`f-${x.id}`];
    }
    try {
      const res = await api.post(`/api/attempts/${id}/grade`, { scores, feedback });
      toast(`Saved: ${res.score}/${quiz.points}${res.needsGrading ? `, ${res.needsGrading} still to score` : ''}.`);
      location.hash = `#/quizzes/${quiz.id}/results`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export { raw, escape };
