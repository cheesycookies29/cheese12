import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, seed } from './support.js';
import { autoScore, validateQuestions } from '../server/quiz.js';

// A class (PROG1 A, teacher teach1) with stud1 and stud2 enrolled.
async function classroom(env) {
  const s = await seed(env);
  for (const st of [s.students.s1, s.students.s2]) await s.admin.post('/api/admin/enrollments', { studentId: st.id, sectionId: s.sections.prog1.id, force: true });
  return { ...s, t1: await s.login('teach1'), s1: await s.login('stud1'), s2: await s.login('stud2'), sec: s.sections.prog1 };
}

const QUESTIONS = [
  { type: 'single', prompt: '2 + 2?', points: 2, options: [{ text: '3' }, { text: '4', correct: true }] },
  { type: 'multiple', prompt: 'Even numbers?', points: 4, options: [{ text: '2', correct: true }, { text: '3' }, { text: '6', correct: true }] },
  { type: 'truefalse', prompt: 'The sky is green.', points: 1, answer: false },
  { type: 'short', prompt: 'Capital of the Philippines?', points: 2, answers: ['Manila', 'City of Manila'] },
  { type: 'essay', prompt: 'Explain recursion.', points: 5 },
];

test('question scoring', () => {
  const [single, multiple, tf, short, essay] = validateQuestions(QUESTIONS);
  assert.equal(autoScore(single, single.options[1].id), 2);
  assert.equal(autoScore(single, single.options[0].id), 0);
  assert.equal(autoScore(multiple, [multiple.options[0].id, multiple.options[2].id]), 4);
  assert.equal(autoScore(multiple, [multiple.options[0].id]), 2, 'half the right answers, half the points');
  assert.equal(autoScore(multiple, [multiple.options[0].id, multiple.options[1].id]), 0, 'a wrong pick cancels a right one');
  assert.equal(autoScore(tf, false), 1);
  assert.equal(autoScore(short, '  manila '), 2, 'case and spaces are ignored');
  assert.equal(autoScore(essay, 'anything'), null, 'essays wait for the teacher');
  assert.throws(() => validateQuestions([{ type: 'single', prompt: 'x', points: 1, options: [{ text: 'a', correct: true }, { text: 'b', correct: true }] }]), /only one choice/);
});

test('quiz: hidden answer key, attempts, auto and essay grading, results release', async () => {
  const env = setup();
  const { t1, s1, s2, sec } = await classroom(env);
  const quiz = await t1.post(`/api/classes/${sec.id}/assignments`, {
    kind: 'quiz', title: 'Quiz 1', typeId: 'short-quiz', published: true, dueAt: '2026-08-20T23:59',
    quiz: { timeLimit: 30, attempts: 2, showResults: 'after_close' }, questions: QUESTIONS,
  });
  assert.equal(quiz.points, 14);

  // Students never receive the answer key.
  const list = await s1.get(`/api/classes/${sec.id}/assignments`);
  assert.equal(JSON.stringify(list).includes('"correct"'), false);
  const { id } = await s1.post(`/api/quizzes/${quiz.id}/start`);
  const view = await s1.get(`/api/quizzes/${quiz.id}`);
  assert.equal(view.current.questions.length, 5);
  assert.equal(JSON.stringify(view).includes('"correct"'), false);
  assert.equal(JSON.stringify(view).includes('Manila'), false);
  assert.equal(view.review, null);

  const q = Object.fromEntries(view.current.questions.map((x) => [x.type, x]));
  const opt = (type, label) => q[type].options.find((o) => o.text === label).id;
  await s1.put(`/api/attempts/${id}`, { answers: { [q.single.id]: opt('single', '4'), [q.multiple.id]: [opt('multiple', '2')] } });
  await s1.put(`/api/attempts/${id}`, { answers: { [q.truefalse.id]: false, [q.short.id]: 'manila', [q.essay.id]: 'A function calling itself.' }, submit: true });

  // Essay still to be scored: the teacher sees it waiting; no score yet for the student.
  let results = await t1.get(`/api/quizzes/${quiz.id}/results`);
  const row = results.rows.find((r) => r.student.name === 'stud1');
  assert.equal(row.best.score, 7); // 2 + 2 (half of multiple) + 1 + 2
  assert.equal(results.summary.toGrade, 1);
  assert.equal((await s1.get(`/api/quizzes/${quiz.id}`)).best, null);

  await t1.post(`/api/attempts/${row.best.id}/grade`, { scores: { [q.essay.id]: 4 }, feedback: { [q.essay.id]: 'Good.' } });
  results = await t1.get(`/api/quizzes/${quiz.id}/results`);
  assert.equal(results.rows.find((r) => r.student.name === 'stud1').best.score, 11);
  // Results are released only after the quiz closes ('after_close'): no per-question scores yet.
  const mine = await s1.get(`/api/quizzes/${quiz.id}`);
  assert.equal(mine.best, 11, 'a fully graded score is shown');
  assert.equal(mine.attempts[0].itemScores, undefined);
  assert.equal(mine.attemptsLeft, 1);

  // The gradebook counts the quiz (weighted: only quizzes scored so far → 11/14).
  const book = await t1.get(`/api/classes/${sec.id}/gradebook`);
  assert.equal(book.rows.find((r) => r.student.name === 'stud1').percent, 78.6);

  // Second attempt, then no more.
  const second = await s1.post(`/api/quizzes/${quiz.id}/start`);
  await s1.put(`/api/attempts/${second.id}`, { answers: {}, submit: true });
  await assert.rejects(s1.post(`/api/quizzes/${quiz.id}/start`), /used all your attempts/);
  assert.equal((await t1.get(`/api/quizzes/${quiz.id}/results`)).rows.find((r) => r.student.name === 'stud1').best.score, 11, 'the highest attempt counts');

  // Another student cannot touch this attempt.
  await assert.rejects(s2.put(`/api/attempts/${id}`, { answers: {} }), /Attempt not found/);
});

test('quiz time limit: answers after the deadline are refused and the attempt is submitted', async () => {
  const env = setup();
  const { t1, s1, sec } = await classroom(env);
  const quiz = await t1.post(`/api/classes/${sec.id}/assignments`, { kind: 'quiz', title: 'Timed', published: true, quiz: { timeLimit: 5 }, questions: QUESTIONS.slice(0, 1) });
  const { id } = await s1.post(`/api/quizzes/${quiz.id}/start`);
  env.db.data.attempts.find((a) => a.id === id).deadline = new Date(new Date('2026-08-10T10:00:00').getTime() - 60000).toISOString();
  await assert.rejects(s1.put(`/api/attempts/${id}`, { answers: {} }), /Time is up/);
  const view = await s1.get(`/api/quizzes/${quiz.id}`);
  assert.equal(view.attempts[0].autoSubmitted, true);
  assert.equal(view.current, null);
});

test('quiz window: not open yet, closed', async () => {
  const env = setup(); // today is 2026-08-10
  const { t1, s1, sec } = await classroom(env);
  const later = await t1.post(`/api/classes/${sec.id}/assignments`, { kind: 'quiz', title: 'Later', published: true, opensAt: '2026-08-12T08:00', questions: QUESTIONS.slice(0, 1) });
  const past = await t1.post(`/api/classes/${sec.id}/assignments`, { kind: 'quiz', title: 'Past', published: true, dueAt: '2026-08-01T08:00', questions: QUESTIONS.slice(0, 1) });
  await assert.rejects(s1.post(`/api/quizzes/${later.id}/start`), /not opened yet/);
  await assert.rejects(s1.post(`/api/quizzes/${past.id}/start`), /closed/);
  const home = await s1.get('/api/home');
  assert.deepEqual(home.upcoming.map((x) => x.title), ['Later']);
});

test('weighted running grade by activity type', async () => {
  const env = setup();
  const { admin, t1, s1, sec } = await classroom(env);
  await assert.rejects(admin.put('/api/admin/activity-types', { types: [{ name: 'Assignment', id: 'task', weight: 60 }, { name: 'Short Quiz', id: 'short-quiz', weight: 30 }] }), /add up to 90%/);
  await admin.put('/api/admin/activity-types', { types: [{ id: 'task', name: 'Assignment', weight: 50 }, { id: 'short-quiz', name: 'Short Quiz', weight: 50 }, { id: 'long-quiz', name: 'Long Quiz', weight: 0 }, { id: 'exam', name: 'Examination', weight: 0 }] });
  const task = await t1.post(`/api/classes/${sec.id}/assignments`, { title: 'Essay', points: 20, published: true, typeId: 'task' });
  const sub = await s1.post(`/api/assignments/${task.id}/submit`, { text: 'done' });
  await t1.post(`/api/submissions/${sub.id}/grade`, { score: 10 });
  const quiz = await t1.post(`/api/classes/${sec.id}/assignments`, { kind: 'quiz', title: 'Q', typeId: 'short-quiz', published: true, questions: QUESTIONS.slice(2, 3) });
  const { id } = await s1.post(`/api/quizzes/${quiz.id}/start`);
  const qid = (await s1.get(`/api/quizzes/${quiz.id}`)).current.questions[0].id;
  await s1.put(`/api/attempts/${id}`, { answers: { [qid]: false }, submit: true });
  const [g] = await s1.get('/api/my/grades');
  assert.equal(g.percent, 75, '50% of the 50% task weight + 100% of the 50% quiz weight');
  assert.equal(g.earned, 11);
});

test('task with an attached file; classmates cannot open it', async () => {
  const env = setup();
  const { t1, s1, s2, sec } = await classroom(env);
  const task = await t1.post(`/api/classes/${sec.id}/assignments`, { title: 'Upload', points: 10, published: true });
  const sub = await s1.post(`/api/assignments/${task.id}/submit`, { file: { name: 'work.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') } });
  assert.equal(sub.file.name, 'work.pdf');
  const res = await env.api({ method: 'GET', headers: { cookie: '' } }, new URL(`http://localhost/api/files/${sub.file.id}`), {}).catch((e) => e);
  assert.match(res.message, /sign in/);
  await assert.rejects(s2.get(`/api/files/${sub.file.id}`), /File not found/);
  const book = await t1.get(`/api/assignments/${task.id}`);
  assert.equal(book.submissions[0].file.id, sub.file.id);
});

test('resources: files are served safely, drafts hidden from students', async () => {
  const env = setup();
  const { t1, s1, sec } = await classroom(env);
  const pdf = await t1.post(`/api/classes/${sec.id}/resources`, { file: { name: 'notes.pdf', type: 'application/pdf', data: Buffer.from('%PDF').toString('base64') } });
  assert.equal(pdf.category, 'pdf');
  assert.equal(pdf.title, 'notes.pdf');
  const page = await t1.post(`/api/classes/${sec.id}/resources`, { title: 'Page', file: { name: 'x.html', type: 'text/html', data: Buffer.from('<script>alert(1)</script>').toString('base64') } });
  await t1.post(`/api/classes/${sec.id}/resources`, { url: 'https://youtu.be/abc', published: false });
  await assert.rejects(t1.post(`/api/classes/${sec.id}/resources`, { url: 'javascript:alert(1)' }), /http/);
  const list = await s1.get(`/api/classes/${sec.id}/resources`);
  assert.equal(list.length, 2, 'the unpublished link is hidden');

  // Call the API as stud1 for raw responses.
  const cookieOf = async () => {
    const r = await env.api({ method: 'POST', headers: {} }, new URL('http://localhost/api/auth/login'), { username: 'stud1', password: 'password123' });
    return r.headers['Set-Cookie'].split(';')[0];
  };
  const cookie = await cookieOf();
  const inline = await env.api({ method: 'GET', headers: { cookie } }, new URL(`http://localhost/api/files/${pdf.file.id}`), {});
  assert.equal(inline.type, 'application/pdf');
  assert.match(inline.headers['Content-Disposition'], /^inline/);
  assert.doesNotMatch(inline.headers['Content-Security-Policy'], /sandbox/, 'PDFs must open in the browser viewer');
  const html = await env.api({ method: 'GET', headers: { cookie } }, new URL(`http://localhost/api/files/${page.file.id}`), {});
  assert.equal(html.type, 'application/octet-stream', 'web pages are never served as web pages');
  assert.match(html.headers['Content-Disposition'], /^attachment/);
  assert.match(html.headers['Content-Security-Policy'], /sandbox/);
  await assert.rejects(t1.post(`/api/classes/${sec.id}/resources`, { file: { name: 'big.bin', data: Buffer.alloc(11 * 1024 * 1024).toString('base64') } }), /10 MB/);
});

test('attendance', async () => {
  const env = setup();
  const { t1, s1, students, sec } = await classroom(env);
  await assert.rejects(t1.put(`/api/classes/${sec.id}/attendance/2026-08-11`, { records: {} }), /future/);
  await t1.put(`/api/classes/${sec.id}/attendance/2026-08-03`, { records: { [students.s1.id]: 'present', [students.s2.id]: 'absent' } });
  await t1.put(`/api/classes/${sec.id}/attendance/2026-08-05`, { records: { [students.s1.id]: 'late', [students.s2.id]: 'excused' } });
  await t1.put(`/api/classes/${sec.id}/attendance/2026-08-07`, { records: { [students.s1.id]: 'absent' } });
  await assert.rejects(t1.put(`/api/classes/${sec.id}/attendance/2026-08-07`, { records: { [students.s3.id]: 'present' } }), /not in this class/);
  const sheet = await t1.get(`/api/classes/${sec.id}/attendance?month=2026-08`);
  assert.equal(sheet.days.length, 3);
  const mine = await s1.get(`/api/classes/${sec.id}/attendance/mine`);
  assert.deepEqual([mine.summary.present, mine.summary.late, mine.summary.absent, mine.summary.rate], [1, 1, 1, 67]);
});

test('news and events: post, react, comment, module switch', async () => {
  const env = setup();
  const { admin, s1, t1 } = await classroom(env);
  const post = await admin.post('/api/admin/news', { title: 'Enrollment opens', body: 'Monday.', pinned: true });
  await admin.post('/api/admin/events', { title: 'Intramurals', startDate: '2026-08-15', endDate: '2026-08-17', startTime: '08:00', endTime: '17:00' });
  await assert.rejects(admin.post('/api/admin/events', { title: 'Bad', startDate: '2026-08-15', endDate: '2026-08-14' }), /end on or after/);
  let [p] = await s1.get('/api/news');
  assert.equal(p.title, 'Enrollment opens');
  p = await s1.post(`/api/news/${post.id}/react`, { reaction: 'like' });
  assert.deepEqual([p.reactions.like, p.mine], [1, ['like']]);
  p = await s1.post(`/api/news/${post.id}/react`, { reaction: 'like' });
  assert.equal(p.reactions.like, 0, 'reacting again takes it back');
  p = await t1.post(`/api/news/${post.id}/comments`, { body: 'See you there' });
  await assert.rejects(s1.del(`/api/news/${post.id}/comments/${p.comments[0].id}`), /own comments/);
  assert.equal((await s1.get('/api/events')).length, 1);
  assert.equal((await s1.get('/api/home')).events.length, 1);
  const { config } = await admin.get('/api/admin/modules');
  config.news.student = false;
  await admin.put('/api/admin/modules', { config });
  await assert.rejects(s1.get('/api/news'), /News & events is switched off for students/);
});

test('branding', async () => {
  const env = setup();
  const { admin } = await seed(env);
  await assert.rejects(admin.put('/api/admin/settings', { branding: { theme: 'custom', color: 'red' } }), /Pick a colour/);
  await assert.rejects(admin.put('/api/admin/settings', { branding: { theme: 'green', logo: 'data:image/svg+xml;base64,PHN2Zz4=' } }), /PNG, JPEG or WebP/);
  await admin.put('/api/admin/settings', { branding: { theme: 'custom', color: '#166534', logo: 'data:image/png;base64,iVBORw0KGgo=' } });
  const status = await env.client().get('/api/auth/status');
  assert.equal(status.branding.brand, '#166534');
  assert.equal(status.branding.logo, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(status.branding.termName, 'First Semester');
});
