// Reports: the CHED enrollment list and the FHE (UniFAST Form 2) billing details, the
// enrollment summary by program, year and sex, failing grades and INCs, the dean's list,
// and candidates for graduation. Every report prints on A4 and exports to CSV.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, option, downloadFile, toCsv, badge } from '../../ui.js';
import { yearLabel, studentTypeLabel, STUDENT_TYPES, fmtGrade } from '/shared/academic.js';
import { gwaText } from '../state.js';

const REPORTS = [
  ['list', 'Enrollment list', 'users'],
  ['summary', 'Summary', 'chart'],
  ['failing', 'Failing & INC', 'flag'],
  ['honors', "Dean's list", 'sparkle'],
  ['graduation', 'Graduation', 'cap'],
];

export async function reportsView(el, _params, query) {
  const r = REPORTS.some(([k]) => k === query.r) ? query.r : 'list';
  const programs = await api.get('/api/academic/programs');
  const terms = (await api.get('/api/academic/grade-sheets')).terms;
  const f = { termId: query.termId || ctx.info.currentTermId || '', programId: query.programId || '', yearLevel: query.yearLevel || '', sex: query.sex || '', studentType: query.studentType || '' };
  const qs = (extra = {}) => new URLSearchParams(Object.entries({ r, ...f, ...extra }).filter(([, v]) => v)).toString();
  const go = (extra) => (location.hash = `#/reports?${qs(extra)}`);
  const termPick = html`<label class="inline">Term <select id="f-term">${terms.map((t) => option(t.id, t.name, t.id === f.termId))}</select></label>`;

  mount(el, html`
    <div class="no-print">${pageHead('Reports', `${ctx.info.campusName || ''} · print on A4 or export to CSV.`)}
    <nav class="tabs">${REPORTS.map(([k, label, ic]) => html`<a href="#/reports?${new URLSearchParams({ r: k, termId: f.termId })}" class="${k === r ? 'active' : ''}">${icon(ic, 16)} ${label}</a>`)}</nav></div>
    <div id="report"></div>`);
  const out = el.querySelector('#report');
  const head = (title, sub) => html`<div class="print-only print-head"><strong>${title}</strong><span>${ctx.info.branding?.schoolName || ''} · ${ctx.info.campusName || ''} · ${sub}</span></div>`;

  if (r === 'list') {
    const d = await api.get(`/api/academic/reports/enrollment-list?${qs()}`);
    const lab = d.rows.reduce((a, x) => a + x.labUnits, 0);
    mount(out, html`
      <div class="toolbar no-print">${termPick}
        <select id="f-program" aria-label="Program">${option('', 'All programs')}${programs.map((p) => option(p.id, p.code, p.id === f.programId))}</select>
        <select id="f-year" aria-label="Year level">${option('', 'All years')}${[1, 2, 3, 4, 5].map((y) => option(String(y), yearLabel(y), String(y) === f.yearLevel))}</select>
        <select id="f-sex" aria-label="Sex">${option('', 'Male and female')}${['Male', 'Female'].map((x) => option(x, x, x === f.sex))}</select>
        <select id="f-type" aria-label="Student type">${option('', 'All student types')}${STUDENT_TYPES.map(([k, l]) => option(k, l, k === f.studentType))}</select>
        <span class="spacer"></span>
        <button class="btn" id="csv-ched">${icon('download', 16)} CHED list CSV</button>
        <button class="btn" id="csv-fhe">${icon('download', 16)} FHE billing CSV</button>
        <button class="btn" id="print">${icon('file', 16)} Print</button>
      </div>
      <div class="card">${head('Enrollment list', d.termName)}
        <p class="muted small">${d.rows.length} officially enrolled · ${d.rows.reduce((a, x) => a + x.units, 0)} units (${lab} laboratory). The FHE CSV follows UniFAST Form 2 (billing details) with lecture and laboratory units in separate columns.</p>
        ${d.rows.length ? html`<table class="table compact"><thead><tr><th>#</th><th>Student no.</th><th>Last name</th><th>First name</th><th>Middle name</th><th>Sex</th><th>Program</th><th>Year</th><th>Subjects</th><th class="num">Units</th></tr></thead>
          <tbody>${d.rows.map((x, i) => html`<tr><td>${i + 1}</td><td>${x.studentNo}</td><td>${x.lastName}</td><td>${x.firstName}</td><td>${x.middleName}</td><td>${x.sex || html`<span class="badge amber">?</span>`}</td><td>${x.program}</td><td>${x.yearLevel}</td><td class="small">${x.subjects}</td><td class="num">${x.units}${x.labUnits ? html`<small>${x.labUnits} lab</small>` : ''}</td></tr>`)}</tbody></table>`
        : html`<p class="muted">Nobody is enrolled with these filters.</p>`}
      </div>`);
    const base = (x, i) => [i + 1, x.studentNo, x.lastName, x.firstName, x.middleName, x.sex, x.program, x.yearLevel];
    el.querySelector('#csv-ched').addEventListener('click', () => downloadFile(`ched-enrollment-list-${d.termName}.csv`, toCsv([
      ['No.', 'Student Number', 'Last Name', 'First Name', 'Middle Name', 'Sex', 'Program', 'Year Level', 'Student Type', 'Subjects Enrolled', 'No. of Units'],
      ...d.rows.map((x, i) => [...base(x, i), studentTypeLabel(x.studentType), x.subjects, x.units]),
    ])));
    el.querySelector('#csv-fhe').addEventListener('click', () => downloadFile(`fhe-billing-form2-${d.termName}.csv`, toCsv([
      ['Seq', 'Student ID', 'Last Name', 'Given Name', 'Middle Name', 'Sex', 'Degree Program', 'Year Level', 'Lecture Units', 'Laboratory Units', 'Total Units'],
      ...d.rows.map((x, i) => [...base(x, i), x.lecUnits, x.labUnits, x.units]),
    ])));
    for (const [id, key] of [['#f-program', 'programId'], ['#f-year', 'yearLevel'], ['#f-sex', 'sex'], ['#f-type', 'studentType']]) el.querySelector(id).addEventListener('change', (e) => go({ [key]: e.target.value }));
  }

  if (r === 'summary') {
    const d = await api.get(`/api/academic/reports/summary?${qs()}`);
    mount(out, html`
      <div class="toolbar no-print">${termPick}<span class="spacer"></span><button class="btn" id="csv">${icon('download', 16)} CSV</button><button class="btn" id="print">${icon('file', 16)} Print</button></div>
      <div class="card">${head('Overall enrollment summary', d.termName)}
        <div class="stats small"><div><small>Total</small><strong>${d.total}</strong></div><div><small>Male</small><strong>${d.male}</strong></div><div><small>Female</small><strong>${d.female}</strong></div>${d.unknownSex ? html`<div><small>Sex not recorded</small><strong>${d.unknownSex}</strong></div>` : ''}</div>
        ${d.table.length ? html`<div class="table-scroll"><table class="table compact summary-table"><thead><tr><th rowspan="2">Program</th>${d.years.map((y) => html`<th colspan="3" class="num">${yearLabel(y)}</th>`)}<th colspan="3" class="num">Total</th></tr>
          <tr>${[...d.years, 't'].map(() => html`<th class="num">M</th><th class="num">F</th><th class="num">All</th>`)}</tr></thead>
          <tbody>${d.table.map((p) => html`<tr><td><strong>${p.program}</strong></td>${p.years.map((y) => html`<td class="num">${y.male}</td><td class="num">${y.female}</td><td class="num"><strong>${y.total}</strong></td>`)}<td class="num">${p.male}</td><td class="num">${p.female}</td><td class="num"><strong>${p.total}</strong></td></tr>`)}</tbody></table></div>` : html`<p class="muted">Nobody is enrolled in this term.</p>`}
      </div>`);
    el.querySelector('#csv').addEventListener('click', () => downloadFile(`enrollment-summary-${d.termName}.csv`, toCsv([
      ['Program', ...d.years.flatMap((y) => [`${yearLabel(y)} M`, `${yearLabel(y)} F`, `${yearLabel(y)} Total`]), 'Male', 'Female', 'Total'],
      ...d.table.map((p) => [p.program, ...p.years.flatMap((y) => [y.male, y.female, y.total]), p.male, p.female, p.total]),
    ])));
  }

  if (r === 'failing') {
    const d = await api.get(`/api/academic/reports/failing?${qs()}`);
    mount(out, html`
      <div class="toolbar no-print">${termPick}<span class="spacer"></span><button class="btn" id="csv">${icon('download', 16)} CSV</button><button class="btn" id="print">${icon('file', 16)} Print</button></div>
      <div class="card">${head('Failing grades and incompletes', d.termName)}
        <p class="muted small">From posted grade sheets. Guidance and advisers use this list to reach students early.</p>
        ${d.rows.length ? html`<table class="table compact"><thead><tr><th>Student</th><th>Program</th><th>Subject</th><th class="num">Grade</th><th>Remark</th></tr></thead>
          <tbody>${d.rows.map((x) => html`<tr><td><a href="#/students/${x.studentId}?tab=grades">${x.name}</a><small>${x.studentNo}</small></td><td>${x.program} ${x.yearLevel}</td><td><strong>${x.courseCode}</strong><small>${x.courseTitle}</small></td><td class="num">${x.remark === 'inc' ? 'INC' : fmtGrade(x.grade)}</td><td>${x.remark === 'inc' ? html`${badge('INC', 'amber')}<small>Complete by ${x.incDeadline}</small>` : badge('Failed', 'red')}</td></tr>`)}</tbody></table>` : html`<p class="muted">No failing grades or INCs posted for this term.</p>`}
      </div>`);
    el.querySelector('#csv').addEventListener('click', () => downloadFile(`failing-and-inc-${d.termName}.csv`, toCsv([['Student No', 'Name', 'Program', 'Year', 'Subject', 'Title', 'Grade', 'Remark', 'INC deadline'], ...d.rows.map((x) => [x.studentNo, x.name, x.program, x.yearLevel, x.courseCode, x.courseTitle, x.remark === 'inc' ? 'INC' : fmtGrade(x.grade), x.remark, x.incDeadline || ''])])));
  }

  if (r === 'honors') {
    const d = await api.get(`/api/academic/reports/honors?${qs()}`);
    mount(out, html`
      <div class="toolbar no-print">${termPick}<span class="spacer"></span><button class="btn" id="csv">${icon('download', 16)} CSV</button><button class="btn" id="print">${icon('file', 16)} Print</button></div>
      <div class="card">${head("Dean's list", d.termName)}
        <p class="muted small">GWA of ${d.rules.maxGwa.toFixed(2)} or better, no grade lower than ${d.rules.worstGrade.toFixed(2)}, no INC, dropped or failed subject, and at least ${d.rules.minUnits} units (Settings).</p>
        ${d.rows.length ? html`<table class="table compact"><thead><tr><th>#</th><th>Student</th><th>Program</th><th class="num">Units</th><th class="num">GWA</th></tr></thead>
          <tbody>${d.rows.map((x, i) => html`<tr><td>${i + 1}</td><td><a href="#/students/${x.studentId}?tab=grades">${x.name}</a><small>${x.studentNo}</small></td><td>${x.program} ${x.yearLevel}</td><td class="num">${x.units}</td><td class="num"><strong>${gwaText(x.gwa)}</strong></td></tr>`)}</tbody></table>` : html`<p class="muted">Nobody qualifies yet (grades must be posted).</p>`}
      </div>`);
    el.querySelector('#csv').addEventListener('click', () => downloadFile(`deans-list-${d.termName}.csv`, toCsv([['Rank', 'Student No', 'Name', 'Program', 'Year', 'Units', 'GWA'], ...d.rows.map((x, i) => [i + 1, x.studentNo, x.name, x.program, x.yearLevel, x.units, x.gwa])])));
  }

  if (r === 'graduation') {
    const d = await api.get('/api/academic/reports/graduation');
    mount(out, html`
      <div class="toolbar no-print"><span class="muted small">Students whose curriculum is complete, or who are taking their last subjects now.</span><span class="spacer"></span><button class="btn" id="csv">${icon('download', 16)} CSV</button><button class="btn" id="print">${icon('file', 16)} Print</button></div>
      <div class="card">${head('Candidates for graduation', 'from each student\'s evaluation')}
        ${d.rows.length ? html`<table class="table compact"><thead><tr><th>Student</th><th>Program</th><th>Curriculum</th><th class="num">GWA</th><th>Subjects</th><th>Requirements</th></tr></thead>
          <tbody>${d.rows.map((x) => html`<tr><td><a href="#/students/${x.studentId}?tab=evaluation">${x.name}</a><small>${x.studentNo}</small></td><td>${x.program}</td><td>${x.curriculum}</td><td class="num">${gwaText(x.gwa)}</td><td>${x.complete ? badge('All passed', 'green') : badge(`${x.remaining} being taken`, 'blue')}</td><td>${x.requirementsDone ? badge('Complete', 'green') : badge('Missing', 'amber')}</td></tr>`)}</tbody></table>` : html`<p class="muted">No candidates yet. Students need a curriculum, and all its subjects passed or being taken.</p>`}
      </div>`);
    el.querySelector('#csv').addEventListener('click', () => downloadFile('graduation-candidates.csv', toCsv([['Student No', 'Name', 'Program', 'Curriculum', 'GWA', 'Status', 'Requirements'], ...d.rows.map((x) => [x.studentNo, x.name, x.program, x.curriculum, x.gwa ?? '', x.complete ? 'All passed' : `${x.remaining} being taken`, x.requirementsDone ? 'Complete' : 'Missing'])])));
  }

  el.querySelector('#f-term')?.addEventListener('change', (e) => go({ termId: e.target.value }));
  el.querySelector('#print')?.addEventListener('click', () => window.print());
}
