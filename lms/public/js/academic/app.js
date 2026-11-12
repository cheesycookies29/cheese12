// ATLAS Academic (/academic/): the student information system. Registrars, deans and
// administrators keep student records, curricula, grade sheets, documents and reports;
// teachers submit their grade sheets; students see their evaluation, grades and registration,
// and request documents. Benchmarked against the CBSUA UIS (docs/ACADEMIC-PLAN.md).
import { ctx, startApp, authScreen } from '../shell.js';
import { systemRoutes, systemNav } from '../system/index.js';
import { html } from '../ui.js';
import { api } from '../api.js';
import { ac, can, isStudent, isTeacher, isStaff } from './state.js';
import { dashboardView } from './views/dashboard.js';
import { studentListView, studentRecordView } from './views/students.js';
import { curriculumListView, curriculumView } from './views/curricula.js';
import { sheetListView, sheetView, changesView } from './views/grades.js';
import { requestsView, printView } from './views/documents.js';
import { reportsView } from './views/reports.js';
import { settingsView } from './views/settings.js';
import { myEvaluationView, myGradesView, myRegistrationView, myRequestsView } from './views/self.js';

const perm = (p) => () => can(p);
const student = () => isStudent();
const sheets = () => isTeacher() || can('academic.view');

const routes = [
  ['/dashboard', dashboardView, perm('academic.view')],
  ['/students', studentListView, perm('academic.view')],
  ['/students/:id', studentRecordView, perm('academic.view')],
  ['/curricula', curriculumListView, () => !isTeacher()],
  ['/curricula/:id', curriculumView, () => !isTeacher()],
  ['/grade-sheets', sheetListView, sheets],
  ['/grade-sheets/:sectionId', sheetView, sheets],
  ['/changes', changesView, perm('academic.view')],
  ['/requests', requestsView, perm('academic.view')],
  ['/reports', reportsView, perm('academic.view')],
  ['/settings', settingsView, () => can('academic.settings') || can('academic.curricula')],
  ['/print/:code', printView, () => isStaff() || isStudent()],
  ['/me', myEvaluationView, student],
  ['/me/grades', myGradesView, student],
  ['/me/registration', myRegistrationView, student],
  ['/me/requests', myRequestsView, student],
  ...systemRoutes(),
];

function nav() {
  if (isStudent()) {
    return [
      { heading: 'My record' },
      { href: '/me', label: 'Evaluation', icon: 'chart', exact: true },
      { href: '/me/grades', label: 'Grades', icon: 'clipboard' },
      { href: '/me/registration', label: 'Registration (COR)', icon: 'calendar' },
      { href: '/me/requests', label: 'Document requests', icon: 'file' },
      { heading: 'Programs' },
      { href: '/curricula', label: 'Curricula', icon: 'layers' },
    ];
  }
  if (isTeacher()) return [{ heading: 'Teaching' }, { href: '/grade-sheets', label: 'Grade sheets', icon: 'clipboard' }];
  return [
    { heading: ctx.user?.role === 'dean' ? 'College' : 'Registrar' },
    { href: '/dashboard', label: 'Dashboard', icon: 'chart' },
    { href: '/students', label: 'Students', icon: 'users' },
    { href: '/grade-sheets', label: 'Grade sheets', icon: 'clipboard', badge: 'sheets' },
    { href: '/changes', label: 'Grade changes', icon: 'edit', badge: 'changes' },
    { href: '/requests', label: 'Document requests', icon: 'file', badge: 'requests' },
    { heading: 'Programs' },
    { href: '/curricula', label: 'Curricula', icon: 'layers' },
    { href: '/reports', label: 'Reports', icon: 'download' },
    (can('academic.settings') || can('academic.curricula')) && { heading: 'Setup' },
    (can('academic.settings') || can('academic.curricula')) && { href: '/settings', label: 'Settings', icon: 'settings' },
    ...systemNav(),
  ].filter(Boolean);
}

const home = () => (isStudent() ? '/me' : isTeacher() ? '/grade-sheets' : '/dashboard');

// Everyone signs in on the ATLAS home page; it sends them back here.
function signedOutView(el, { status }) {
  if (status.deniedUser) {
    return authScreen(el, {}, html`<div class="auth-card"><h2>Academic is for students and the school</h2>
      <p class="muted">You are signed in as ${status.deniedUser.name}. Academic records are for students, teachers and the registrar's office. Your systems are on the ATLAS home page.</p>
      <a class="btn primary block" href="/">Back to ATLAS home</a></div>`);
  }
  location.replace(`/?next=${encodeURIComponent('/academic/')}`);
}

let dash = null;
const dashboard = async () => {
  if (!dash || Date.now() - dash.at > 4000) dash = { at: Date.now(), d: await api.get('/api/academic/dashboard') };
  return dash.d;
};

startApp({
  side: 'academic',
  authBase: '/api/academic/auth',
  product: 'Academic',
  routes,
  nav,
  home,
  signedOutView,
  passwordView: () => location.replace(`/?next=${encodeURIComponent('/academic/')}`),
  async onSignedIn() {
    await ac.refreshSettings();
  },
  badges: {
    sheets: async () => (can('grades.approve') ? (await dashboard()).queue.submitted : can('academic.records') ? (await dashboard()).queue.approved : 0),
    changes: async () => (can('grades.approve') ? (await dashboard()).changesPending : 0),
    requests: async () => (can('academic.records') ? (await dashboard()).requestsOpen : 0),
  },
});
