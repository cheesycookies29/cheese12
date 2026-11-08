// Learning portal (/lms/): Teachers, Students, and Parents & guardians. What each sees
// depends on the modules an administrator has switched on for their account type;
// guardians see only the students linked to them (views/guardian.js).
import { has } from './common.js';
import { ctx, startApp } from '../shell.js';
import { homeView } from './views/home.js';
import { catalogView, myEnrollmentView } from './views/enroll.js';
import { classesView, classView } from './views/classes.js';
import { assignmentView } from './views/assignment.js';
import { scheduleView } from './views/schedule.js';
import { calendarView } from './views/calendar.js';
import { gradesView } from './views/grades.js';
import { quizView, quizResultsView, attemptGradeView, quizEditView } from './views/quiz.js';
import { newsView } from './views/news.js';
import { guardianHomeView, childView, myGuardiansView } from './views/guardian.js';

const student = (u) => u.role === 'student';
const guardian = (u) => u.role === 'guardian';
const learner = (u) => !guardian(u);
const mod = (m, extra = () => true) => (u, info) => info.modules.includes(m) && extra(u);

const routes = [
  ['/home', (el, p, q) => (guardian(ctx.user) ? guardianHomeView(el, p, q) : homeView(el, p, q))],
  ['/children/:id', childView, guardian],
  ['/children/:id/:tab', childView, guardian],
  ['/guardians', myGuardiansView, student],
  ['/enroll', catalogView, mod('enrollment', student)],
  ['/enroll/mine', myEnrollmentView, mod('enrollment', student)],
  ['/classes', classesView, learner],
  ['/classes/:id', classView, learner],
  ['/classes/:id/:tab', classView, learner],
  ['/assignments/:id', assignmentView, mod('assignments', learner)],
  ['/quizzes/new', (el, p, q) => quizEditView(el, { classId: q.class }), mod('assignments', (u) => u.role === 'teacher')],
  ['/quizzes/:id/edit', (el, p) => quizEditView(el, { id: p.id }), mod('assignments', (u) => u.role === 'teacher')],
  ['/quizzes/:id', quizView, mod('assignments', learner)],
  ['/quizzes/:id/results', quizResultsView, mod('assignments', (u) => u.role === 'teacher')],
  ['/attempts/:id', attemptGradeView, mod('assignments', (u) => u.role === 'teacher')],
  ['/news', newsView, mod('news')],
  ['/schedule', scheduleView, mod('schedule', learner)],
  ['/calendar', calendarView, mod('calendar')],
  ['/grades', gradesView, mod('grades', student)],
];

function nav() {
  const isStudent = ctx.user.role === 'student';
  if (guardian(ctx.user)) {
    const kids = ctx.info.children || [];
    return [
      { href: '/home', label: 'Your students', icon: 'home', exact: true },
      kids.length && { heading: 'Students' },
      ...kids.map((c) => ({ href: `/children/${c.id}`, label: c.name, icon: 'user' })),
      (has('news') || has('calendar')) && { heading: 'School' },
      has('calendar') && { href: '/calendar', label: 'School calendar', icon: 'calendar' },
      has('news') && { href: '/news', label: 'News & events', icon: 'megaphone' },
    ].filter(Boolean);
  }
  return [
    { href: '/home', label: 'Home', icon: 'home' },
    { href: '/classes', label: isStudent ? 'My classes' : 'My sections', icon: 'book', also: ['/assignments', '/quizzes', '/attempts'] },
    isStudent && has('enrollment') && { href: '/enroll', label: 'Enrollment', icon: 'clipboard', also: ['/enroll/mine'] },
    has('calendar') && { href: '/calendar', label: 'Calendar', icon: 'calendar' },
    has('schedule') && { href: '/schedule', label: 'Schedule', icon: 'clock' },
    isStudent && has('grades') && { href: '/grades', label: 'Grades', icon: 'chart' },
    has('news') && { href: '/news', label: 'News & events', icon: 'megaphone' },
    isStudent && { href: '/guardians', label: 'Parents & guardians', icon: 'users' },
  ].filter(Boolean);
}

// Everyone signs in once, on the University Portal (/); it sends them back here.
function signedOutView() {
  location.replace(`/?next=${encodeURIComponent('/lms/')}`);
}

startApp({
  side: 'portal',
  authBase: '/api/auth',
  product: 'Learn',
  routes,
  nav,
  home: () => '/home',
  signedOutView,
  badges: {},
});
