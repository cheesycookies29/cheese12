// Document requests (the registrar's queue) and printing issued documents: Transcript of
// Records, Certificate of Grades, of Enrollment, of Registration, good moral, honorable
// dismissal. Every printout carries its code and a QR code to /verify/<code>.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, raw, mount, toast, modal, option, formData, fmtDate, timeAgo, confirmDialog } from '../../ui.js';
import { REQUEST_STATUS, docType, fmtGrade, yearLabel } from '/shared/academic.js';
import { ac, can, requestBadge, gradeText, gwaText, isStudent } from '../state.js';
import qrcode from '../../vendor/qrcode.js';

const NEXT = {
  requested: [['pay', 'Record payment', 'primary']],
  paid: [['process', 'Start processing', 'primary']],
  processing: [['ready', 'Ready for release', 'primary']],
  ready: [['release', 'Release', 'primary']],
};

export async function requestsView(el, _params, query) {
  const status = query.status ?? 'open';
  const list = await api.get(`/api/academic/requests${status ? `?status=${status}` : ''}`);
  const edit = can('academic.records');
  mount(el, html`
    ${pageHead('Document requests', `${ctx.info.campusName || ''} · from students online and at the window. Requested → paid → processing → ready → released.`)}
    <nav class="tabs">${[['open', 'Open'], ['requested', 'Unpaid'], ['ready', 'Ready'], ['released', 'Released'], ['', 'All']].map(([v, l]) => html`<a href="#/requests?status=${v}" class="${v === status ? 'active' : ''}">${l}</a>`)}</nav>
    ${list.length ? html`<div class="card"><table class="table">
      <thead><tr><th>Ref.</th><th>Student</th><th>Document</th><th>Purpose</th><th class="num">Fee</th><th>Status</th>${edit ? html`<th></th>` : ''}</tr></thead>
      <tbody>${list.map((r) => html`<tr>
        <td><strong>${r.refNo}</strong><small>${timeAgo(r.createdAt)}</small></td>
        <td><a href="#/students/${r.student.id}?tab=documents">${r.student.name}</a><small>${r.student.studentNo}</small></td>
        <td>${r.typeLabel}<small>${r.copies} cop${r.copies === 1 ? 'y' : 'ies'}</small></td>
        <td>${r.purpose}</td>
        <td class="num">₱${r.fee}${r.orNo ? html`<small>O.R. ${r.orNo}</small>` : ''}</td>
        <td>${requestBadge(r.status)}${r.releasedTo ? html`<small>To ${r.releasedTo}</small>` : ''}</td>
        ${edit ? html`<td class="row-actions">
          ${['paid', 'processing', 'ready'].includes(r.status) ? html`<button class="btn sm" data-print="${r.id}" data-type="${r.type}" data-student="${r.student.id}">${icon('file', 14)} Print</button>` : ''}
          ${(NEXT[r.status] || []).map(([a, label, kind]) => html`<button class="btn sm ${kind}" data-act="${a}" data-id="${r.id}">${label}</button>`)}
          ${!['released', 'cancelled'].includes(r.status) ? html`<button class="btn sm danger ghost" data-act="cancel" data-id="${r.id}">Cancel</button>` : ''}
        </td>` : ''}
      </tr>`)}</tbody></table></div>` : html`<div class="card empty">${icon('file', 40)}<h2>No requests</h2><p>${status === 'open' ? 'Nothing is open.' : 'None match.'}</p></div>`}`);

  const reload = () => requestsView(el, _params, query);
  el.onclick = async (e) => { // assigned, not added: the view redraws itself into the same element
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.print) {
      try {
        const doc = await api.post('/api/academic/documents', { type: b.dataset.type, studentId: b.dataset.student, requestId: b.dataset.print });
        location.hash = `#/print/${doc.code}`;
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    const { act, id } = b.dataset;
    if (!act) return;
    const put = async (body, msg) => {
      await api.put(`/api/academic/requests/${id}`, { action: act, ...body });
      toast(msg);
      ctx.refreshBadges?.();
      reload();
    };
    const r = list.find((x) => x.id === id);
    if (act === 'pay') {
      return modal({
        title: `Payment for ${r.refNo}`, subtitle: `${r.typeLabel} ×${r.copies} · ₱${r.fee}`, submitLabel: 'Record payment',
        body: html`<label class="field"><span>Official receipt (O.R.) number</span><input name="orNo" required /></label>`,
        onSubmit: (form) => put(formData(form), 'Payment recorded.'),
      });
    }
    if (act === 'release') {
      return modal({
        title: `Release ${r.refNo}`, submitLabel: 'Release',
        body: html`<label class="field"><span>Released to</span><input name="releasedTo" value="${r.student.name}" /><span class="hint">The student, or the person they authorized (with an authorization letter).</span></label>`,
        onSubmit: (form) => put(formData(form), 'Released.'),
      });
    }
    if (act === 'cancel') {
      return modal({
        title: `Cancel ${r.refNo}`, submitLabel: 'Cancel request', cancelLabel: 'Keep it',
        body: html`<label class="field"><span>Reason</span><input name="reason" /></label>`,
        onSubmit: (form) => put(formData(form), 'Request cancelled.'),
      });
    }
    try {
      await put({}, REQUEST_STATUS[{ process: 'processing', ready: 'ready' }[act]]);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ----- Printing a document -----
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const when = (m) => (m || []).map((x) => `${DAYS[x.day]} ${x.start}–${x.end}`).join(', ');
const longDate = (iso) => new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return raw(q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }));
}

function docBody(p, doc) {
  const s = p.student;
  const n = p.names;
  const full = `${n.first} ${n.middle ? `${n.middle} ` : ''}${n.last}`.trim() || s.name;
  const he = p.profile.sex === 'Female' ? 'she' : p.profile.sex === 'Male' ? 'he' : 'they';
  const his = p.profile.sex === 'Female' ? 'her' : p.profile.sex === 'Male' ? 'his' : 'their';
  const info = html`<dl class="doc-info">
    <div><dt>Name</dt><dd>${n.last.toUpperCase()}, ${n.first} ${n.middle}</dd></div>
    <div><dt>Student no.</dt><dd>${s.studentNo || '—'}</dd></div>
    <div><dt>Program</dt><dd>${s.program ? s.program.name : '—'}</dd></div>
    <div><dt>Year level</dt><dd>${yearLabel(s.yearLevel)}</dd></div>
    ${p.type === 'tor' ? html`<div><dt>Sex</dt><dd>${p.profile.sex || '—'}</dd></div><div><dt>Date of birth</dt><dd>${p.profile.birthDate ? fmtDate(p.profile.birthDate) : '—'}</dd></div><div><dt>Address</dt><dd>${p.profile.address || '—'}</dd></div><div><dt>Admission credentials</dt><dd>${p.profile.previousSchool || '—'}</dd></div>` : ''}
  </dl>`;
  if (p.type === 'tor') {
    return html`${info}
      <table class="table compact doc-table"><thead><tr><th>Course code</th><th>Descriptive title</th><th class="num">Final</th><th class="num">Grade</th><th class="num">Units</th></tr></thead>
      <tbody>${p.terms.map((t) => html`<tr class="term-row"><td colspan="5">${t.termName}</td></tr>${t.records.map((r) => html`<tr><td>${r.courseCode}</td><td>${r.courseTitle}${r.from ? html` <em>(credited from ${r.from})</em>` : ''}</td><td class="num">${r.percent ?? ''}</td><td class="num">${gradeText(r)}</td><td class="num">${r.passed === false ? '' : r.units}</td></tr>`)}`)}
      ${!p.terms.length ? html`<tr><td colspan="5">No grades on record.</td></tr>` : ''}</tbody>
      <tfoot><tr><td colspan="3">General weighted average: <strong>${gwaText(p.gwa)}</strong></td><td colspan="2" class="num">Units earned: <strong>${p.earned}</strong></td></tr></tfoot></table>
      <p class="doc-note">*** Nothing follows ***</p>
      <p class="doc-note small">Grading: 1.00 (highest) to ${fmtGrade(ac.settings?.passingGrade ?? 3)} (lowest passing); 5.00 failed; INC incomplete; DRP dropped. Valid only with the registrar's signature and the school's dry seal, or when checked online with the code below.</p>`;
  }
  if (p.type === 'cog') {
    return html`${info}<p>This certifies that the following are the grades of <strong>${full}</strong> in <strong>${p.termName}</strong>:</p>
      <table class="table compact doc-table"><thead><tr><th>Code</th><th>Descriptive title</th><th class="num">Units</th><th class="num">Grade</th><th>Remark</th></tr></thead>
      <tbody>${p.records.map((r) => html`<tr><td>${r.courseCode}</td><td>${r.courseTitle}</td><td class="num">${r.units}</td><td class="num">${gradeText(r)}</td><td>${r.remark === 'inc' ? 'Incomplete' : r.remark.charAt(0).toUpperCase() + r.remark.slice(1)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="3">GWA</td><td class="num"><strong>${gwaText(p.gwa)}</strong></td><td></td></tr></tfoot></table>`;
  }
  if (p.type === 'cor') {
    return html`${info}<p><strong>${p.termName}</strong></p>
      <table class="table compact doc-table"><thead><tr><th>Code</th><th>Descriptive title</th><th>Section</th><th>Schedule</th><th>Room</th><th class="num">Units</th></tr></thead>
      <tbody>${p.classes.map((c) => html`<tr><td>${c.code}</td><td>${c.title}<small>${c.teacher}</small></td><td>${c.section}</td><td>${when(c.meetings) || 'TBA'}</td><td>${c.room}</td><td class="num">${c.units}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="5">Total units</td><td class="num"><strong>${p.units}</strong></td></tr></tfoot></table>
      <p class="doc-note small">The student is officially enrolled in the subjects above. Changes after printing (adding or dropping) need a new certificate.</p>`;
  }
  if (p.type === 'coe') {
    return html`<p class="doc-letter">This is to certify that <strong>${full}</strong>${s.studentNo ? `, with student number ${s.studentNo},` : ''} is officially enrolled as a <strong>${yearLabel(s.yearLevel).toLowerCase()}</strong> student in the <strong>${s.program?.name || 'school'}</strong> program of ${p.school.name}${p.school.campus ? `, ${p.school.campus}` : ''}, for <strong>${p.termName}</strong>, with a load of <strong>${p.units} units</strong>.</p>
      <p class="doc-letter">This certification is issued upon the request of the student for whatever legal purpose it may serve.</p>`;
  }
  if (p.type === 'gmc') {
    return html`<p class="doc-letter">This is to certify that <strong>${full}</strong>${s.program ? `, a student of ${s.program.name},` : ''} is a student of good moral character and has not been found guilty of any violation of the school's rules and regulations while enrolled at ${p.school.name}.</p>
      <p class="doc-letter">This certification is issued upon ${his} request for whatever legal purpose it may serve.</p>`;
  }
  if (p.type === 'hd') {
    return html`<p class="doc-letter">This is to certify that <strong>${full}</strong>${s.studentNo ? ` (${s.studentNo})` : ''}, a student of ${s.program?.name || 'this school'}, is hereby granted <strong>honorable dismissal</strong> from ${p.school.name}. There is no objection to ${his} transfer to any school of ${his} choice.</p>
      <p class="doc-letter">${he.charAt(0).toUpperCase() + he.slice(1)} has no pending obligation with the school. The transcript of records will be sent to the receiving school upon its request.</p>`;
  }
  return '';
}

export async function printView(el, params) {
  const doc = await api.get(`/api/academic/documents/${params.code}`);
  const p = doc.payload;
  const url = `${location.origin}/verify/${doc.code}`;
  mount(el, html`
    <div class="no-print">
      ${pageHead(p.title, html`${p.student.name} · issued ${fmtDate(doc.issuedAt.slice(0, 10))} by ${doc.issuedBy} · code ${doc.code}`, html`<button class="btn primary" id="print">${icon('file', 16)} Print</button>`, isStudent() ? ['/me/registration', 'My registration'] : [`/students/${p.student.id}`, p.student.name])}
      <p class="muted small">Prints on A4. The QR code and the code open <a href="/verify/${doc.code}" target="_blank" rel="noopener">${url}</a>, where anyone can check that this document is genuine.</p>
    </div>
    <article class="document">
      <header class="doc-head">
        ${p.school.logo ? html`<img src="${p.school.logo}" alt="" />` : ''}
        <div><strong>${p.school.name}</strong><span>${p.school.campus || ''}</span><span>Office of the Registrar</span></div>
      </header>
      <h1 class="doc-title">${p.title}</h1>
      ${docBody(p, doc)}
      <footer class="doc-foot">
        <div class="doc-verify">${qrSvg(url)}<div><strong>${doc.code}</strong><span>Check at ${location.host}/verify</span><span>Issued ${longDate(doc.issuedAt)}</span></div></div>
        <div class="doc-sign">${p.type === 'cor' ? html`<span class="line"></span><strong>${p.names.first} ${p.names.last}</strong><span>Student</span>` : html`<span class="line"></span>${p.registrar.name ? html`<strong>${p.registrar.name}</strong>` : ''}<span>${p.registrar.title}</span>`}</div>
      </footer>
    </article>`);
  el.querySelector('#print').addEventListener('click', () => window.print());
}
