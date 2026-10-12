import { ctx } from './state.js';
import { html, mount } from './ui.js';
import { dashboardView } from './views/dashboard.js';
import { employeeListView, employeeFormView, employeeProfileView } from './views/employees.js';
import { clockView, dtrView } from './views/time.js';
import { payrollListView, payrollRunView, payslipView } from './views/payroll.js';
import { settingsView } from './views/settings.js';

const routes = [
  ['/dashboard', dashboardView],
  ['/employees', employeeListView],
  ['/employees/new', employeeFormView],
  ['/employees/:id/edit', employeeFormView],
  ['/employees/:id', employeeProfileView],
  ['/clock', clockView],
  ['/dtr', dtrView],
  ['/payroll', payrollListView],
  ['/payroll/:id/payslip/:employeeId', payslipView],
  ['/payroll/:id', payrollRunView],
  ['/settings', settingsView],
].map(([pattern, view]) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  return { re, keys, view, section: pattern.split('/')[1] };
});

let cleanup = null;

async function navigate() {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/dashboard';
  const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  const match = routes.find((r) => r.re.test(path));
  if (!match) return (location.hash = '#/dashboard');

  const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(path.match(match.re)[i + 1])]));
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.section === match.section));

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const el = document.getElementById('app');
  el.scrollTop = 0;
  window.scrollTo(0, 0);
  try {
    if (!ctx.settings) await ctx.refreshSettings();
    cleanup = await match.view(el, params, query);
  } catch (err) {
    mount(el, html`<div class="empty"><h2>Something went wrong</h2><p>${err.message}</p><p class="muted">Is the server still running? Check the terminal window.</p></div>`);
  }
}

window.addEventListener('hashchange', navigate);
navigate();
