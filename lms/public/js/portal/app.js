// Learning portal (/lms/): Teachers and Students. What each sees depends on the
// modules an administrator has switched on for their account type.
import { has } from './common.js';
import { ctx, startApp } from '../shell.js';
import { homeView } from './views/home.js';
import { catalogView, myEnrollmentView } from './views/enroll.js';
import { classesView, classView } from './views/classes.js';
import { assignmentView } from './views/assignment.js';
import { scheduleView } from './views/schedule.js';
import { gradesView } from './views/grades.js';
import { quizView, quizResultsView, attemptGradeView, quizEditView } from './views/quiz.js';
import { newsView } from './views/news.js';

const student = (u) => u.role === 'student';
const mod = (m, extra = () => true) => (u, info) => info.modules.includes(m) && extra(u);

const routes = [
  ['/home', homeView],
  ['/enroll', catalogView, mod('enrollment', student)],
  ['/enroll/mine', myEnrollmentView, mod('enrollment', student)],
  ['/classes', classesView],
  ['/classes/:id', classView],
  ['/classes/:id/:tab', classView],
  ['/assignments/:id', assignmentView, mod('assignments')],
  ['/quizzes/new', (el, p, q) => quizEditView(el, { classId: q.class }), mod('assignments', (u) => u.role === 'teacher')],
  ['/quizzes/:id/edit', (el, p) => quizEditView(el, { id: p.id }), mod('assignments', (u) => u.role === 'teacher')],
  ['/quizzes/:id', quizView, mod('assignments')],
  ['/quizzes/:id/results', quizResultsView, mod('assignments', (u) => u.role === 'teacher')],
  ['/attempts/:id', attemptGradeView, mod('assignments', (u) => u.role === 'teacher')],
  ['/news', newsView, mod('news')],
  ['/schedule', scheduleView, mod('schedule')],
  ['/grades', gradesView, mod('grades', student)],
];

function nav() {
  const isStudent = ctx.user.role === 'student';
  return [
    { href: '/home', label: 'Home', icon: 'home' },
    { href: '/classes', label: isStudent ? 'My classes' : 'My sections', icon: 'book', also: ['/assignments', '/quizzes', '/attempts'] },
    isStudent && has('enrollment') && { href: '/enroll', label: 'Enrollment', icon: 'clipboard', also: ['/enroll/mine'] },
    has('schedule') && { href: '/schedule', label: 'Schedule', icon: 'calendar' },
    isStudent && has('grades') && { href: '/grades', label: 'Grades', icon: 'chart' },
    has('news') && { href: '/news', label: 'News & events', icon: 'megaphone' },
  ].filter(Boolean);
}

// Everyone signs in once, on the University Portal (/); it sends them back here.
function signedOutView() {
  location.replace(`/?next=${encodeURIComponent('/lms/')}`);
}

startApp({
  side: 'portal',
  authBase: '/api/auth',
  appName: 'Learning Management System',
  routes,
  nav,
  home: () => '/home',
  signedOutView,
  badges: {},
});
