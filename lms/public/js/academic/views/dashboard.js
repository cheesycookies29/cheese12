// The registrar's and dean's home: what is waiting for them, then the term at a glance.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, timeAgo } from '../../ui.js';
import { can } from '../state.js';

export async function dashboardView(el) {
  const d = await api.get('/api/academic/dashboard');
  const queue = [
    can('grades.approve') && d.queue.submitted && ['clipboard', `${d.queue.submitted} grade sheet${d.queue.submitted === 1 ? '' : 's'} to approve`, 'Submitted by teachers, waiting for your approval.', '#/grade-sheets?status=submitted'],
    can('academic.records') && d.queue.approved && ['check', `${d.queue.approved} approved grade sheet${d.queue.approved === 1 ? '' : 's'} to post`, 'Posting puts the grades on each student\'s permanent record.', '#/grade-sheets?status=approved'],
    can('grades.approve') && d.changesPending && ['edit', `${d.changesPending} grade change${d.changesPending === 1 ? '' : 's'} to decide`, 'Rectifications and INC completions need a second person to approve.', '#/changes'],
    can('academic.records') && d.requestsOpen && ['file', `${d.requestsOpen} document request${d.requestsOpen === 1 ? '' : 's'} open`, `${d.requestsUnpaid} waiting for payment.`, '#/requests'],
    d.noCurriculum && ['layers', `${d.noCurriculum} student${d.noCurriculum === 1 ? ' has' : 's have'} no curriculum`, 'Assign one so their evaluation and graduation check work.', '#/students?filter=no-curriculum'],
    d.requirementsMissing && ['inbox', `${d.requirementsMissing} student${d.requirementsMissing === 1 ? ' is' : 's are'} missing requirements`, 'PSA, Form 138, good moral and the rest, by student type.', '#/students?filter=requirements'],
    d.inc && ['flag', `${d.inc} student${d.inc === 1 ? ' has' : 's have'} an INC`, 'Each INC must be completed before its deadline.', '#/students?filter=inc'],
  ].filter(Boolean);
  const pct = (n) => (d.sheets.total ? Math.round((n / d.sheets.total) * 100) : 0);
  mount(el, html`
    ${pageHead('Academic dashboard', `${ctx.info.campusName || ''}${d.termName ? ` · ${d.termName}` : ''}`)}
    <div class="stats">
      <a class="card" href="#/students"><small>Students</small><strong>${d.students}</strong><span class="muted small">active at this campus</span></a>
      <a class="card accent" href="#/reports"><small>Enrolled this term</small><strong>${d.enrolled}</strong><span class="muted small">officially enrolled</span></a>
      <a class="card" href="#/grade-sheets"><small>Grade sheets posted</small><strong>${d.sheets.posted} / ${d.sheets.total}</strong><span class="muted small">${pct(d.sheets.posted)}% of this term's classes</span></a>
      <a class="card" href="#/curricula"><small>Curricula</small><strong>${d.curricula.posted}</strong><span class="muted small">posted${d.curricula.draft ? ` · ${d.curricula.draft} draft` : ''}</span></a>
    </div>
    <div class="cols wide-left">
      <section class="card">
        <div class="card-head"><h2>${icon('inbox')} Waiting for you</h2></div>
        ${queue.length
          ? html`<div class="list">${queue.map(([ic, title, text, href]) => html`<a class="list-item" href="${href}"><span class="item-ic">${icon(ic, 16)}</span><span class="grow"><strong>${title}</strong><small>${text}</small></span>${icon('chevronRight', 16)}</a>`)}</div>`
          : html`<div class="notice ok">${icon('checkCircle')}<p>Nothing is waiting for you.</p></div>`}
        <h3 class="sub-h">Grade sheets this term</h3>
        <div class="sheet-bar" role="img" aria-label="Grade sheets by status">
          ${[['posted', 'Posted'], ['approved', 'Approved'], ['submitted', 'Submitted'], ['returned', 'Returned'], ['none', 'Not started']].map(([k, label]) => (d.sheets[k] ? html`<i class="s-${k}" style="flex:${d.sheets[k]}" title="${label}: ${d.sheets[k]}"></i>` : ''))}
        </div>
        <div class="legend">${[['posted', 'Posted'], ['approved', 'Approved'], ['submitted', 'Submitted'], ['returned', 'Returned'], ['none', 'Not started']].map(([k, label]) => html`<span><i class="s-${k}"></i>${label} ${d.sheets[k]}</span>`)}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>${icon('users')} Students by program</h2><a href="#/reports">Reports ${icon('chevronRight', 14)}</a></div>
        ${d.byProgram.length ? html`<table class="table"><thead><tr><th>Program</th><th class="num">Students</th><th class="num">Enrolled</th></tr></thead>
          <tbody>${d.byProgram.map((p) => html`<tr><td><strong>${p.code}</strong></td><td class="num">${p.students}</td><td class="num">${p.enrolled}</td></tr>`)}</tbody></table>` : html`<p class="muted">No students yet.</p>`}
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h2>${icon('clock')} Recent activity</h2></div>
      ${d.recent.length ? html`<div class="list">${d.recent.map((a) => html`<div class="list-item"><span class="item-ic">${icon('edit', 16)}</span><span class="grow"><strong>${a.action}</strong><small>${a.by} · ${timeAgo(a.at)}</small></span>${a.studentId ? html`<a href="#/students/${a.studentId}">Record</a>` : ''}</div>`)}</div>` : html`<p class="muted">Nothing yet.</p>`}
    </section>`);
}
