// Quizzes and exams: question validation, attempts, automatic grading.
//
// Question types:
//   single    one correct option          (auto-graded)
//   multiple  every correct option, no wrong ones; partial credit = (right − wrong) / correct, never below 0
//   truefalse true or false               (auto-graded)
//   short     typed answer matching one of the accepted answers (case and spacing ignored)
//   essay     scored by the teacher
// Attempts: the server sets a deadline when the attempt starts (time limit, capped by the close time)
// and refuses answers after it; an attempt left open past its deadline is submitted as it stands.
// The highest-scoring submitted attempt counts.
import { randomUUID } from 'node:crypto';
import { HttpError, text } from './util.js';

const fail = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
export const QUESTION_TYPES = ['single', 'multiple', 'truefalse', 'short', 'essay'];
const round2 = (n) => Math.round(n * 100) / 100;
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function validateQuestions(list) {
  if (!Array.isArray(list) || !list.length) fail('Add at least one question.');
  if (list.length > 200) fail('A quiz can have at most 200 questions.');
  return list.map((q, i) => {
    const n = i + 1;
    const type = QUESTION_TYPES.includes(q.type) ? q.type : fail(`Question ${n}: pick a question type.`);
    const out = { id: q.id || randomUUID(), type, prompt: text(q.prompt, 5000), points: Number(q.points) };
    if (!out.prompt) fail(`Question ${n}: write the question.`);
    if (!(out.points > 0 && out.points <= 100)) fail(`Question ${n}: points must be between 0.5 and 100.`);
    if (type === 'single' || type === 'multiple') {
      out.options = (Array.isArray(q.options) ? q.options : []).map((o) => ({ id: o.id || randomUUID(), text: text(o.text, 1000), correct: Boolean(o.correct) })).filter((o) => o.text);
      if (out.options.length < 2) fail(`Question ${n}: give at least two choices.`);
      const correct = out.options.filter((o) => o.correct).length;
      if (!correct) fail(`Question ${n}: mark the correct answer.`);
      if (type === 'single' && correct > 1) fail(`Question ${n}: only one choice can be correct (use "Several answers" for more).`);
    }
    if (type === 'truefalse') {
      if (typeof q.answer !== 'boolean') fail(`Question ${n}: choose whether the answer is true or false.`);
      out.answer = q.answer;
    }
    if (type === 'short') {
      out.answers = [...new Set((Array.isArray(q.answers) ? q.answers : String(q.answers || '').split('\n')).map((a) => text(a, 200)).filter(Boolean))];
      if (!out.answers.length) fail(`Question ${n}: list at least one accepted answer.`);
    }
    return out;
  });
}

export const quizPoints = (questions = []) => round2(questions.reduce((s, q) => s + q.points, 0));

// What a student may see of a question while answering: no answer key.
export function questionForStudent(q) {
  const out = { id: q.id, type: q.type, prompt: q.prompt, points: q.points };
  if (q.options) out.options = q.options.map((o) => ({ id: o.id, text: o.text }));
  return out;
}

// Points for one answer, or null when a teacher must score it (essays).
export function autoScore(q, answer) {
  if (q.type === 'essay') return null;
  if (answer == null || answer === '') return 0;
  if (q.type === 'single') return q.options.find((o) => o.id === answer)?.correct ? q.points : 0;
  if (q.type === 'truefalse') return answer === q.answer ? q.points : 0;
  if (q.type === 'short') return q.answers.some((a) => norm(a) === norm(answer)) ? q.points : 0;
  if (q.type === 'multiple') {
    const chosen = new Set(Array.isArray(answer) ? answer : []);
    const correct = q.options.filter((o) => o.correct);
    const right = correct.filter((o) => chosen.has(o.id)).length;
    const wrong = q.options.filter((o) => !o.correct && chosen.has(o.id)).length;
    return round2(Math.max(0, (right - wrong) / correct.length) * q.points);
  }
  return 0;
}

function cleanAnswer(q, value) {
  if (q.type === 'multiple') return Array.isArray(value) ? value.filter((v) => q.options.some((o) => o.id === v)) : [];
  if (q.type === 'single') return q.options.some((o) => o.id === value) ? value : null;
  if (q.type === 'truefalse') return typeof value === 'boolean' ? value : null;
  return text(value, q.type === 'essay' ? 20000 : 500);
}

// Recomputes an attempt's score from automatic and teacher scores.
export function scoreAttempt(quiz, attempt) {
  let score = 0;
  let pending = 0;
  attempt.itemScores = {};
  for (const q of quiz.questions) {
    const manual = attempt.manualScores?.[q.id];
    const s = manual ?? autoScore(q, attempt.answers?.[q.id]);
    if (s == null) pending += 1;
    else score += s;
    attempt.itemScores[q.id] = s;
  }
  attempt.score = round2(score);
  attempt.needsGrading = pending;
  attempt.status = attempt.submittedAt ? (pending ? 'submitted' : 'graded') : 'in_progress';
  return attempt;
}

export function bestAttempt(attempts) {
  return attempts.filter((a) => a.submittedAt).sort((a, b) => b.score - a.score || a.submittedAt.localeCompare(b.submittedAt))[0] || null;
}

// When students may see correct answers and their per-question scores.
export function resultsVisible(quiz, nowLocal) {
  const show = quiz.quiz?.showResults || 'after_close';
  if (show === 'immediately') return true;
  if (show === 'after_close') return Boolean(quiz.dueAt && nowLocal > quiz.dueAt);
  return false;
}

export function registerQuizRoutes(route, ctx, { access, findAssignment, isOpen }) {
  const { db, nowLocal } = ctx;
  const nowMs = () => ctx.now().getTime();
  const data = () => db.data;
  // Answers sent just after the deadline still count (network delay); Settings → Learn & uploads.
  const graceMs = () => Math.min(300, Math.max(0, Number(data().settings.learn?.quizGraceSeconds ?? 30))) * 1000;
  const attemptsOf = (quizId, studentId) => data().attempts.filter((a) => a.assignmentId === quizId && (!studentId || a.studentId === studentId)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  // Submit attempts whose time has run out (called before reading attempts).
  function closeExpired(quiz) {
    let changed = false;
    for (const a of attemptsOf(quiz.id)) {
      if (!a.submittedAt && nowMs() > new Date(a.deadline).getTime() + graceMs()) {
        a.submittedAt = a.deadline;
        a.autoSubmitted = true;
        scoreAttempt(quiz, a);
        changed = true;
      }
    }
    if (changed) db.save();
  }

  function studentAttemptView(quiz, a, showAnswers) {
    const out = { id: a.id, startedAt: a.startedAt, deadline: a.deadline, submittedAt: a.submittedAt, autoSubmitted: Boolean(a.autoSubmitted), status: a.status, answers: a.answers };
    if (a.submittedAt && a.status === 'graded') out.score = a.score;
    if (a.submittedAt && showAnswers) {
      out.score = a.score;
      out.itemScores = a.itemScores;
      out.feedback = a.feedback || {};
    }
    return out;
  }

  // Student: quiz overview, own attempts.
  route('GET', '/api/quizzes/:id', 'portal', ({ user, params }) => {
    const quiz = findAssignment(params.id);
    const a = access(user, quiz.sectionId);
    if (quiz.kind !== 'quiz') fail('Not a quiz.', 404);
    if (!a.teacher && !quiz.published) fail('Quiz not found.', 404);
    closeExpired(quiz);
    const base = { ...quiz, questions: undefined, questionCount: quiz.questions.length, open: isOpen(quiz) };
    if (a.teacher) return { ...base, questions: quiz.questions };
    const mine = attemptsOf(quiz.id, user.id);
    const show = resultsVisible(quiz, nowLocal());
    const current = mine.find((x) => !x.submittedAt);
    const submitted = mine.filter((x) => x.submittedAt).length;
    // The answer key is sent only once the student cannot answer again: no attempts left, or the
    // quiz has closed. Before that they see their score and which answers were right, not the key
    // (otherwise a blank first attempt would give away the second).
    const finished = !isOpen(quiz) || (quiz.quiz.attempts > 0 && submitted >= quiz.quiz.attempts);
    return {
      ...base,
      resultsVisible: show,
      attempts: mine.map((x) => studentAttemptView(quiz, x, show)),
      best: (() => { const b = bestAttempt(mine); return b && (show || b.status === 'graded') ? b.score : null; })(),
      attemptsLeft: quiz.quiz.attempts ? Math.max(0, quiz.quiz.attempts - mine.filter((x) => x.submittedAt).length) : null,
      current: current ? { ...studentAttemptView(quiz, current, false), questions: orderFor(quiz, current).map(questionForStudent) } : null,
      // After results are released, the questions with the right answers, for review.
      review: show && submitted && finished ? quiz.questions : null,
      reviewLater: Boolean(show && submitted && !finished), // the key comes when attempts run out or the quiz closes
    };
  }, { module: 'assignments' });

  function orderFor(quiz, attempt) {
    if (!attempt.order) return quiz.questions;
    const byId = new Map(quiz.questions.map((q) => [q.id, q]));
    return attempt.order.map((id) => byId.get(id)).filter(Boolean);
  }

  route('POST', '/api/quizzes/:id/start', 'student', ({ user, params }) => {
    const quiz = findAssignment(params.id);
    const a = access(user, quiz.sectionId);
    if (quiz.kind !== 'quiz' || !quiz.published) fail('Quiz not found.', 404);
    if (a.enrollment.status !== 'enrolled') fail('This class has ended.');
    closeExpired(quiz);
    const mine = attemptsOf(quiz.id, user.id);
    const open = mine.find((x) => !x.submittedAt);
    if (open) return { id: open.id };
    if (!isOpen(quiz)) fail(quiz.opensAt && nowLocal() < quiz.opensAt ? 'This quiz has not opened yet.' : 'This quiz is closed.');
    const done = mine.filter((x) => x.submittedAt).length;
    if (quiz.quiz.attempts && done >= quiz.quiz.attempts) fail('You have used all your attempts.');
    const now = ctx.now();
    let deadline = quiz.quiz.timeLimit ? new Date(now.getTime() + quiz.quiz.timeLimit * 60000) : null;
    if (quiz.dueAt) {
      const close = new Date(`${quiz.dueAt}:00`);
      if (!deadline || close < deadline) deadline = close;
    }
    const attempt = {
      id: randomUUID(), assignmentId: quiz.id, studentId: user.id, startedAt: now.toISOString(),
      deadline: (deadline || new Date(now.getTime() + 24 * 3600000)).toISOString(),
      submittedAt: null, answers: {}, manualScores: {}, feedback: {},
      order: quiz.quiz.shuffle ? quiz.questions.map((q) => q.id).sort(() => Math.random() - 0.5) : null,
    };
    scoreAttempt(quiz, attempt);
    data().attempts.push(attempt);
    db.save();
    return { id: attempt.id };
  }, { module: 'assignments' });

  // Save answers as the student goes (and submit with { submit: true }).
  route('PUT', '/api/attempts/:id', 'student', ({ user, params, body }) => {
    const attempt = data().attempts.find((x) => x.id === params.id && x.studentId === user.id) || fail('Attempt not found.', 404);
    const quiz = findAssignment(attempt.assignmentId);
    access(user, quiz.sectionId);
    if (attempt.submittedAt) fail('This attempt has already been submitted.');
    const late = nowMs() > new Date(attempt.deadline).getTime() + graceMs();
    if (!late) {
      for (const q of quiz.questions) if (body.answers && q.id in body.answers) attempt.answers[q.id] = cleanAnswer(q, body.answers[q.id]);
    }
    if (body.submit || late) {
      attempt.submittedAt = late ? attempt.deadline : ctx.now().toISOString();
      attempt.autoSubmitted = late;
    }
    scoreAttempt(quiz, attempt);
    db.save();
    if (late) fail('Time is up. Your answers saved before the deadline were submitted.', 409);
    return { saved: true, submittedAt: attempt.submittedAt };
  }, { module: 'assignments' });

  // Teacher: every student's best attempt, how each question went.
  route('GET', '/api/quizzes/:id/results', 'teacher', ({ user, params }) => {
    const quiz = findAssignment(params.id);
    const a = access(user, quiz.sectionId);
    closeExpired(quiz);
    const students = data().enrollments.filter((e) => e.sectionId === a.section.id && ['enrolled', 'completed'].includes(e.status)).map((e) => data().users.find((u) => u.id === e.studentId)).filter(Boolean);
    const rows = students.map((s) => {
      const list = attemptsOf(quiz.id, s.id);
      const best = bestAttempt(list);
      return { student: { id: s.id, name: s.name, studentNo: s.studentNo || '' }, attempts: list.length, inProgress: list.some((x) => !x.submittedAt), best: best ? { id: best.id, score: best.score, needsGrading: best.needsGrading, submittedAt: best.submittedAt, autoSubmitted: best.autoSubmitted } : null };
    }).sort((x, y) => x.student.name.localeCompare(y.student.name));
    const bests = rows.map((r) => r.best && data().attempts.find((x) => x.id === r.best.id)).filter(Boolean);
    const items = quiz.questions.map((q) => {
      const scored = bests.map((b) => b.itemScores?.[q.id]).filter((v) => v != null);
      return { id: q.id, prompt: q.prompt, type: q.type, points: q.points, answered: scored.length, average: scored.length ? round2(scored.reduce((s, v) => s + v, 0) / scored.length) : null, correctRate: scored.length ? Math.round((scored.filter((v) => v >= q.points).length / scored.length) * 100) : null };
    });
    const scores = bests.map((b) => b.score);
    return {
      quiz: { id: quiz.id, title: quiz.title, points: quiz.points, sectionId: quiz.sectionId },
      rows,
      items,
      summary: { submitted: scores.length, average: scores.length ? round2(scores.reduce((s, v) => s + v, 0) / scores.length) : null, highest: scores.length ? Math.max(...scores) : null, lowest: scores.length ? Math.min(...scores) : null, toGrade: bests.filter((b) => b.needsGrading).length },
    };
  }, { module: 'assignments' });

  // Teacher: one attempt with answers and the key, to score essays or adjust.
  route('GET', '/api/attempts/:id', 'teacher', ({ user, params }) => {
    const attempt = data().attempts.find((x) => x.id === params.id) || fail('Attempt not found.', 404);
    const quiz = findAssignment(attempt.assignmentId);
    access(user, quiz.sectionId);
    const st = data().users.find((u) => u.id === attempt.studentId);
    return { attempt, quiz: { id: quiz.id, title: quiz.title, points: quiz.points, questions: quiz.questions }, student: { id: st?.id, name: st?.name, studentNo: st?.studentNo } };
  }, { module: 'assignments' });

  route('POST', '/api/attempts/:id/grade', 'teacher', ({ user, params, body }) => {
    const attempt = data().attempts.find((x) => x.id === params.id) || fail('Attempt not found.', 404);
    const quiz = findAssignment(attempt.assignmentId);
    access(user, quiz.sectionId);
    if (!attempt.submittedAt) fail('The student has not submitted this attempt yet.');
    for (const q of quiz.questions) {
      const v = body.scores?.[q.id];
      if (v === undefined) continue;
      if (v === '' || v === null) delete attempt.manualScores[q.id];
      else {
        const n = Number(v);
        if (!(n >= 0 && n <= q.points)) fail(`Scores for "${q.prompt.slice(0, 40)}" must be between 0 and ${q.points}.`);
        attempt.manualScores[q.id] = n;
      }
      if (body.feedback?.[q.id] !== undefined) attempt.feedback[q.id] = text(body.feedback[q.id], 2000);
    }
    attempt.gradedBy = user.name;
    scoreAttempt(quiz, attempt);
    db.save();
    return { score: attempt.score, needsGrading: attempt.needsGrading };
  }, { module: 'assignments' });

  return { attemptsOf, closeExpired };
}
