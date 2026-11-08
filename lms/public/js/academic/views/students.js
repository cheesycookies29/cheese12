// Students: the list (with work filters) and one student record with tabs, replacing the
// UIS's five separate "Student Master File" screens.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, badge, toast, modal, option, initials, fmtDate, timeAgo, downloadFile, toCsv, formData } from '../../ui.js';
import { STUDENT_TYPES, studentTypeLabel, yearLabel, DOCUMENT_TYPES, docType, fmtGrade } from '/shared/academic.js';
import { ac, can, clickableRows, gwaText, requestBadge } from '../state.js';
import { evaluationSummary, evaluationTable, recordTerms, currentTerm } from './parts.js';

const FILTERS = [['', 'All students'], ['no-curriculum', 'No curriculum'], ['requirements', 'Missing requirements'], ['inc', 'With an INC']];

export async function studentListView(el, _params, query) {
  const programs = await api.get('/api/academic/programs');
  const state = { q: query.q || '', programId: query.programId || '', yearLevel: query.yearLevel || '', filter: query.filter || '' };
  mount(el, html`
    ${pageHead('Students', html`<span id="count"></span>`, html`<button class="btn" id="export">${icon('download', 16)} Export CSV</button>`)}
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search name, student no. or email" value="${state.q}" />
      <select id="program" aria-label="Program">${option('', 'All programs')}${programs.map((p) => option(p.id, p.code, p.id === state.programId))}</select>
      <select id="year" aria-label="Year level">${option('', 'All year levels')}${[1, 2, 3, 4, 5].map((y) => option(String(y), yearLabel(y), String(y) === state.yearLevel))}</select>
      <select id="filter" aria-label="Show">${FILTERS.map(([v, l]) => option(v, l, v === state.filter))}</select>
    </div>
    <div class="card" id="list"></div>`);
  let rows = [];
  async function load() {
    const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v));
    rows = await api.get(`/api/academic/students?${qs}`);
    el.querySelector('#count').textContent = `${rows.length} at ${ctx.info.campusName || 'this campus'}`;
    mount(el.querySelector('#list'), rows.length ? html`<table class="table clickable">
      <thead><tr><th>Student</th><th>Program</th><th>Curriculum</th><th>Type</th><th>Requirements</th><th class="num">GWA</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr data-href="#/students/${r.id}">
        <td><div class="person"><span class="avatar">${initials(r.name)}</span><div><strong>${r.name}</strong><small>${r.studentNo || 'No student no.'}${r.inc ? html` · <span class="badge amber">${r.inc} INC</span>` : ''}</small></div></div></td>
        <td>${r.program || html`<span class="muted">—</span>`}<small>${yearLabel(r.yearLevel)}</small></td>
        <td>${r.curriculum || badge('None', 'amber')}</td>
        <td>${studentTypeLabel(r.studentType)}</td>
        <td>${r.requirements.total ? (r.requirements.done === r.requirements.total ? badge('Complete', 'green') : badge(`${r.requirements.done} of ${r.requirements.total}`, 'amber')) : html`<span class="muted">—</span>`}</td>
        <td class="num">${gwaText(r.gwa)}</td>
      </tr>`)}</tbody></table>` : html`<p class="muted">No students match.</p>`);
  }
  clickableRows(el.querySelector('#list'));
  let timer;
  el.querySelector('#q').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 250); });
  el.querySelector('#program').addEventListener('change', (e) => { state.programId = e.target.value; load(); });
  el.querySelector('#year').addEventListener('change', (e) => { state.yearLevel = e.target.value; load(); });
  el.querySelector('#filter').addEventListener('change', (e) => { state.filter = e.target.value; load(); });
  el.querySelector('#export').addEventListener('click', () => downloadFile('students.csv', toCsv([
    ['Student No', 'Name', 'Program', 'Year', 'Curriculum', 'Student type', 'Requirements', 'GWA', 'Email'],
    ...rows.map((r) => [r.studentNo, r.name, r.program, r.yearLevel, r.curriculum, studentTypeLabel(r.studentType), `${r.requirements.done}/${r.requirements.total}`, r.gwa ?? '', r.email]),
  ])));
  await load();
}

const TABS = [['overview', 'Overview', 'user'], ['evaluation', 'Evaluation', 'chart'], ['grades', 'Grades', 'clipboard'], ['documents', 'Documents', 'file'], ['profile', 'Profile', 'edit'], ['history', 'History', 'clock']];

export async function studentRecordView(el, params, query) {
  const tab = TABS.some(([t]) => t === query.tab) ? query.tab : 'overview';
  const [rec, curricula] = await Promise.all([api.get(`/api/academic/students/${params.id}`), api.get('/api/academic/curricula')]);
  const s = rec.student;
  const edit = can('academic.records');
  const counts = { grades: rec.terms.reduce((a, t) => a + t.records.length, 0), documents: rec.requests.length };
  const reload = () => studentRecordView(el, params, query);

  mount(el, html`
    ${pageHead(s.name, html`${s.studentNo || 'No student no.'} · ${s.program ? `${s.program.code} · ` : ''}${yearLabel(s.yearLevel)} · ${studentTypeLabel(rec.profile.studentType)}${s.campus ? ` · ${s.campus}` : ''}`, '', ['/students', 'Students'])}
    <nav class="tabs">${TABS.map(([t, label, ic]) => html`<a href="#/students/${s.id}?tab=${t}" class="${t === tab ? 'active' : ''}">${icon(ic, 16)} ${label}${counts[t] ? html` <span class="count">${counts[t]}</span>` : ''}</a>`)}</nav>
    <div id="tab"></div>`);
  const body = el.querySelector('#tab');

  if (tab === 'overview') {
    const reqDone = rec.requirements.filter((r) => r.submitted).length;
    mount(body, html`
      ${evaluationSummary(rec.evaluation)}
      <div class="cols wide-left">
        <section class="card">
          <div class="card-head"><h2>${icon('calendar')} ${rec.current.termName || 'Current term'}</h2><span class="muted">${rec.current.units} units</span></div>
          ${currentTerm(rec.current)}
        </section>
        <section class="card">
          <div class="card-head"><h2>${icon('inbox')} Requirements</h2><span class="muted">${reqDone} of ${rec.requirements.length}</span></div>
          ${rec.requirements.length ? html`<form id="reqs" class="req-list">${rec.requirements.map((r) => html`<label class="check-row"><input type="checkbox" name="${r.id}" ${r.submitted ? 'checked' : ''} ${edit ? '' : 'disabled'} /><span>${r.name}${r.submitted ? html`<small>Received ${fmtDate(r.at.slice(0, 10))} · ${r.by}</small>` : ''}</span></label>`)}</form>` : html`<p class="muted">None for a ${studentTypeLabel(rec.profile.studentType).toLowerCase()}.</p>`}
        </section>
      </div>`);
    el.querySelector('#reqs')?.addEventListener('change', async (e) => {
      try {
        await api.put(`/api/academic/students/${s.id}/requirements`, { requirements: { [e.target.name]: e.target.checked } });
        toast(e.target.checked ? 'Requirement received.' : 'Requirement removed.');
        reload();
      } catch (err) {
        toast(err.message, 'error');
        e.target.checked = !e.target.checked;
      }
    });
  }

  if (tab === 'evaluation') {
    mount(body, html`${evaluationSummary(rec.evaluation)}
      ${rec.evaluation.curriculum ? html`<div class="toolbar"><span class="muted small">Can take next: ${rec.evaluation.allowed.length ? rec.evaluation.allowed.map((x) => x.code).join(', ') : 'nothing open (prerequisites, or all done)'}</span><span class="spacer"></span><button class="btn" id="print-eval">${icon('file', 16)} Print evaluation</button></div>` : ''}
      ${evaluationTable(rec.evaluation)}`);
    el.querySelector('#print-eval')?.addEventListener('click', () => window.print());
  }

  if (tab === 'grades') {
    mount(body, html`
      ${edit ? html`<div class="toolbar"><span class="muted small">Posted grades are locked. A correction is a grade change: give the reason, and someone with approval rights decides.</span><span class="spacer"></span><button class="btn" id="credit">${icon('plus', 16)} Credit a subject</button></div>` : ''}
      ${recordTerms(rec.terms, edit ? (r) => (r.source === 'credited' ? '' : html`<button class="btn sm" data-change="${r.id}">${r.remark === 'inc' ? 'Complete INC' : 'Change'}</button>`) : null)}
      ${rec.changes.length ? html`<section class="card"><h2>Grade changes</h2><table class="table compact"><thead><tr><th>Subject</th><th>From → to</th><th>Reason</th><th>Status</th></tr></thead>
        <tbody>${rec.changes.map((c) => html`<tr><td><strong>${c.courseCode}</strong><small>${c.termName}</small></td><td>${c.from.remark === 'inc' ? 'INC' : c.from.grade?.toFixed(2)} → ${c.to.remark === 'dropped' ? 'Dropped' : `${c.to.grade.toFixed(2)} (${c.to.percent})`}</td><td>${c.reason}<small>${c.requestedBy} · ${timeAgo(c.createdAt)}</small></td><td>${badge(c.status === 'pending' ? 'Waiting for approval' : c.status === 'approved' ? 'Approved' : 'Rejected', c.status === 'pending' ? 'amber' : c.status === 'approved' ? 'green' : 'red')}${c.decidedBy ? html`<small>${c.decidedBy}</small>` : ''}</td></tr>`)}</tbody></table></section>` : ''}`);
    body.addEventListener('click', (e) => {
      const id = e.target.dataset.change;
      if (!id) return;
      const r = rec.terms.flatMap((t) => t.records).find((x) => x.id === id);
      modal({
        title: `${r.remark === 'inc' ? 'Complete the INC in' : 'Change the grade in'} ${r.courseCode}`,
        subtitle: `${r.termName} · now ${r.remark === 'inc' ? 'INC' : `${r.grade?.toFixed(2)} (${r.percent})`}`,
        submitLabel: 'Ask for approval',
        body: html`<div class="grid two">
          <label class="field"><span>Corrected final grade (%)</span><input name="percent" type="number" min="0" max="100" step="0.01" required /></label>
          <label class="field"><span>Or mark</span><select name="remark">${option('', '— a grade —')}${option('dropped', 'Dropped')}</select></label>
          <label class="field span-2"><span>Reason</span><textarea name="reason" rows="3" required placeholder="e.g. Completed the final requirement; computation error in the grade sheet"></textarea><span class="hint">Kept on the record. Someone other than you approves the change.</span></label>
        </div>`,
        async onSubmit(form) {
          const v = formData(form);
          await api.post(`/api/academic/records/${id}/changes`, v.remark === 'dropped' ? { remark: 'dropped', reason: v.reason } : { percent: v.percent, reason: v.reason });
          toast('Sent for approval.');
          reload();
        },
      });
    });
    el.querySelector('#credit')?.addEventListener('click', async () => {
      const courses = await api.get('/api/academic/courses');
      modal({
        title: 'Credit a subject',
        subtitle: 'A subject passed at another school (or before ATLAS) that counts toward the curriculum.',
        submitLabel: 'Credit',
        body: html`<div class="grid two">
          <label class="field span-2"><span>Subject here</span><select name="courseId" required>${option('', 'Choose…')}${courses.map((c) => option(c.id, `${c.code} · ${c.title} (${c.units} units)`))}</select></label>
          <label class="field span-2"><span>School where it was taken</span><input name="school" required /></label>
          <label class="field"><span>Code there</span><input name="originalCode" /></label>
          <label class="field"><span>Grade (1.00–${fmtGrade(ac.settings?.passingGrade ?? 3)})</span><input name="grade" type="number" min="1" max="${ac.settings?.passingGrade ?? 3}" step="0.25" /><span class="hint">Leave blank if the TOR gives no grade.</span></label>
          <label class="field"><span>Term or year taken</span><input name="termName" placeholder="e.g. 2nd Sem 2024–2025" /></label>
        </div>`,
        async onSubmit(form) {
          await api.post(`/api/academic/students/${s.id}/credits`, formData(form));
          toast('Subject credited.');
          reload();
        },
      });
    });
  }

  if (tab === 'documents') {
    mount(body, html`
      ${edit ? html`<section class="card"><div class="card-head"><h2>${icon('file')} Print a document</h2></div>
        <p class="muted small">Each printout gets a code and a QR code that anyone can check at /verify.</p>
        <div class="doc-buttons">${DOCUMENT_TYPES.map((d) => html`<button class="btn" data-issue="${d.id}">${d.label}</button>`)}</div></section>` : ''}
      <section class="card"><div class="card-head"><h2>Requests</h2>${edit ? html`<button class="btn sm" id="new-req">${icon('plus', 14)} New request</button>` : ''}</div>
        ${rec.requests.length ? html`<table class="table compact"><thead><tr><th>Ref.</th><th>Document</th><th>Purpose</th><th class="num">Fee</th><th>Status</th></tr></thead>
          <tbody>${rec.requests.map((r) => html`<tr><td>${r.refNo}<small>${fmtDate(r.createdAt.slice(0, 10))}</small></td><td>${docType(r.type)?.label} ×${r.copies}</td><td>${r.purpose}</td><td class="num">₱${r.fee}${r.orNo ? html`<small>O.R. ${r.orNo}</small>` : ''}</td><td>${requestBadge(r.status)}</td></tr>`)}</tbody></table>` : html`<p class="muted">No requests.</p>`}
        <p class="muted small"><a href="#/requests">All document requests ${icon('chevronRight', 12)}</a></p>
      </section>`);
    body.addEventListener('click', async (e) => {
      const type = e.target.dataset.issue;
      if (!type) return;
      try {
        const doc = await api.post('/api/academic/documents', { type, studentId: s.id });
        location.hash = `#/print/${doc.code}`;
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    el.querySelector('#new-req')?.addEventListener('click', () => modal({
      title: 'New document request',
      submitLabel: 'Create request',
      body: html`<div class="grid two">
        <label class="field"><span>Document</span><select name="type">${DOCUMENT_TYPES.filter((d) => d.official).map((d) => option(d.id, `${d.label} (₱${ac.settings.fees[d.id]})`))}</select></label>
        <label class="field"><span>Copies</span><input name="copies" type="number" min="1" max="10" value="1" /></label>
        <label class="field span-2"><span>Purpose</span><input name="purpose" required placeholder="e.g. Employment, scholarship, transfer" /></label>
      </div>`,
      async onSubmit(form) {
        await api.post('/api/academic/requests', { ...formData(form), studentId: s.id });
        toast('Request created.');
        reload();
      },
    }));
  }

  if (tab === 'profile') {
    const p = rec.profile;
    const dis = edit ? '' : 'disabled';
    const fit = curricula.filter((c) => c.status === 'posted' && (!s.programId || c.program?.id === s.programId));
    const programs = await api.get('/api/academic/programs');
    const edu = [0, 1, 2, 3].map((i) => p.education?.[i] || { level: ['Elementary', 'High school', 'Senior high school', 'College'][i], school: '', year: '' });
    mount(body, html`<form class="card" id="profile">
      <h2>Program</h2>
      <div class="grid three">
        <label class="field"><span>Program</span><select name="programId" ${dis}>${option('', 'None')}${programs.map((x) => option(x.id, `${x.code} · ${x.name}`, x.id === s.programId))}</select></label>
        <label class="field"><span>Curriculum</span><select name="curriculumId" ${dis}>${option('', 'None')}${fit.map((c) => option(c.id, `${c.code} ${c.series}${c.major ? ` · ${c.major}` : ''}`, c.id === s.curriculumId))}</select><span class="hint">Posted curricula of the student's program.</span></label>
        <label class="field"><span>Year level</span><select name="yearLevel" ${dis}>${[1, 2, 3, 4, 5, 6].map((y) => option(String(y), yearLabel(y), Number(s.yearLevel) === y))}</select></label>
        <label class="field"><span>Student type</span><select name="studentType" ${dis}>${STUDENT_TYPES.map(([k, l]) => option(k, l, k === p.studentType))}</select></label>
      </div>
      <h2>Personal information</h2>
      <div class="grid three">
        <label class="field"><span>Last name</span><input name="lastName" value="${rec.names.last}" ${dis} /></label>
        <label class="field"><span>First name</span><input name="firstName" value="${rec.names.first}" ${dis} /></label>
        <label class="field"><span>Middle name</span><input name="middleName" value="${rec.names.middle}" ${dis} /></label>
        <label class="field"><span>Sex</span><select name="sex" ${dis}>${option('', '—')}${['Male', 'Female'].map((x) => option(x, x, x === p.sex))}</select></label>
        <label class="field"><span>Birth date</span><input type="date" name="birthDate" value="${p.birthDate || ''}" ${dis} /></label>
        <label class="field"><span>LRN</span><input name="lrn" value="${p.lrn || ''}" inputmode="numeric" ${dis} /></label>
        <label class="field"><span>Civil status</span><input name="civilStatus" value="${p.civilStatus || ''}" ${dis} /></label>
        <label class="field"><span>Citizenship</span><input name="citizenship" value="${p.citizenship || ''}" placeholder="Filipino" ${dis} /></label>
        <label class="field"><span>Contact no.</span><input name="contactNo" value="${p.contactNo || ''}" inputmode="tel" ${dis} /></label>
        <label class="field span-3"><span>Home address</span><input name="address" value="${p.address || ''}" ${dis} /></label>
        <label class="field"><span>Parent / guardian</span><input name="guardianName" value="${p.guardianName || ''}" ${dis} /></label>
        <label class="field"><span>Their contact no.</span><input name="guardianContact" value="${p.guardianContact || ''}" ${dis} /></label>
        <label class="field"><span>Previous school</span><input name="previousSchool" value="${p.previousSchool || ''}" ${dis} /></label>
      </div>
      <h2>Educational background</h2>
      <table class="table compact edu"><thead><tr><th>Level</th><th>School</th><th>Year graduated</th></tr></thead>
        <tbody>${edu.map((e, i) => html`<tr><td><input name="edu-level-${i}" value="${e.level}" ${dis} aria-label="Level" /></td><td><input name="edu-school-${i}" value="${e.school}" ${dis} aria-label="School" /></td><td><input name="edu-year-${i}" value="${e.year}" ${dis} aria-label="Year" /></td></tr>`)}</tbody></table>
      ${edit ? html`<div class="actions end"><button class="btn primary" type="submit">Save</button></div>` : ''}
    </form>`);
    el.querySelector('#profile').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formData(e.target);
      const education = [0, 1, 2, 3].map((i) => ({ level: v[`edu-level-${i}`], school: v[`edu-school-${i}`], year: v[`edu-year-${i}`] })).filter((x) => x.school);
      try {
        await api.put(`/api/academic/students/${s.id}`, { ...v, education });
        toast('Saved.');
        reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  if (tab === 'history') {
    mount(body, html`<section class="card"><h2>${icon('clock')} History</h2><p class="muted small">Every change to this record in Academic: who, what and when.</p>
      ${rec.history.length ? html`<div class="list">${rec.history.map((a) => html`<div class="list-item"><span class="item-ic">${icon('edit', 16)}</span><span class="grow"><strong>${a.action}</strong><small>${a.by} · ${new Date(a.at).toLocaleString('en-PH')}</small></span></div>`)}</div>` : html`<p class="muted">Nothing yet.</p>`}</section>`);
  }
}
