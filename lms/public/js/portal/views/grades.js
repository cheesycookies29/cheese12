// A student's grades across terms.
import { api } from '../../api.js';
import { html, mount, empty } from '../../ui.js';
import { pageHead, ctx } from '../../shell.js';
import { gradeText } from '../common.js';

export async function gradesView(el) {
  const list = await api.get('/api/my/grades');
  const byTerm = new Map();
  for (const g of list) byTerm.set(g.class.term.name, [...(byTerm.get(g.class.term.name) || []), g]);
  const passedUnits = list.filter((g) => g.passed).reduce((n, g) => n + g.class.course.units, 0);
  mount(el, html`
    ${pageHead('Grades', `Final grades are percentages; ${ctx.info.passingGrade} or higher passes.`)}
    <div class="stats small"><div><small>Units passed</small><strong>${passedUnits}</strong></div><div><small>Classes completed</small><strong>${list.filter((g) => g.status === 'completed').length}</strong></div></div>
    ${list.length ? [...byTerm].map(([term, rows]) => html`<h3>${term}</h3><div class="card scroll-x"><table class="table clickable">
      <thead><tr><th>Class</th><th>Units</th><th>Running score</th><th>Final grade</th></tr></thead>
      <tbody>${rows.map((g) => html`<tr data-href="/classes/${g.class.id}/grades"><td><strong>${g.class.course.code} ${g.class.name}</strong><small>${g.class.course.title}</small></td><td>${g.class.course.units}</td>
        <td>${g.percent != null ? `${g.percent}%` : '—'}<small>${g.possible ? `${g.earned}/${g.possible} points scored` : ''}</small></td><td>${gradeText(g.finalGrade, g.passed)}</td></tr>`)}</tbody>
    </table></div>`) : empty('No grades yet')}`);
  el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => (location.hash = `#${tr.dataset.href}`)));
}
