// Students' own Academic pages: the evaluation against their curriculum (what is done, what is
// next), grades by term, the Certificate of Registration they print themselves, and requests
// for official documents from the registrar.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, toast, modal, option, formData, fmtDate, confirmDialog } from '../../ui.js';
import { DOCUMENT_TYPES, yearLabel, studentTypeLabel } from '/shared/academic.js';
import { ac, requestBadge } from '../state.js';
import { evaluationSummary, evaluationTable, recordTerms, currentTerm } from './parts.js';

const sub = (rec) => `${rec.student.studentNo || ''}${rec.student.program ? ` · ${rec.student.program.code}` : ''} · ${yearLabel(rec.student.yearLevel)} · ${studentTypeLabel(rec.profile.studentType)}`;

export async function myEvaluationView(el) {
  const rec = await api.get('/api/academic/my/record');
  const ev = rec.evaluation;
  const missing = rec.requirements.filter((r) => !r.submitted);
  mount(el, html`
    ${pageHead(`Hello, ${ctx.user.name.split(' ')[0]}`, sub(rec), ev.curriculum ? html`<button class="btn" id="print">${icon('file', 16)} Print</button>` : '')}
    ${missing.length ? html`<div class="notice">${icon('inbox')}<p><strong>The registrar is still waiting for:</strong> ${missing.map((r) => r.name).join('; ')}.</p></div>` : ''}
    ${evaluationSummary(ev)}
    ${ev.curriculum ? html`<section class="card">
      <div class="card-head"><h2>${icon('flag')} What you can take next</h2></div>
      ${ev.allowed.length ? html`<p class="muted small">Subjects of your curriculum whose prerequisites you have passed. Request them under Enrollment in Learn when enrollment opens.</p>
        <div class="chips">${ev.allowed.slice(0, 16).map((s) => html`<span class="chip ${s.back ? 'back' : ''}" title="${s.title}"><strong>${s.code}</strong> ${s.units}u${s.back ? ' · back subject' : ''}</span>`)}</div>`
        : html`<p class="muted">Nothing open right now: you are taking what remains, or the next subjects wait for prerequisites.</p>`}
    </section>` : ''}
    ${evaluationTable(ev)}`);
  el.querySelector('#print')?.addEventListener('click', () => window.print());
}

export async function myGradesView(el) {
  const rec = await api.get('/api/academic/my/record');
  mount(el, html`
    ${pageHead('My grades', html`General weighted average: <strong>${rec.evaluation.gwa == null ? '—' : rec.evaluation.gwa.toFixed(4).replace(/0{1,2}$/, '')}</strong> · posted grades only`)}
    ${recordTerms(rec.terms)}
    <p class="muted small">Grades still in your teacher's gradebook are in Learn until the registrar posts them. For an official copy, request a Certificate of Grades or a Transcript of Records.</p>`);
}

export async function myRegistrationView(el) {
  const rec = await api.get('/api/academic/my/record');
  const enrolled = rec.current.classes.some((c) => c.status !== 'pending');
  mount(el, html`
    ${pageHead('My registration', rec.current.termName || '', enrolled ? html`<button class="btn primary" id="cor">${icon('file', 16)} Print my COR</button>` : '')}
    ${enrolled ? html`<div class="notice info">${icon('checkCircle')}<p>Your Certificate of Registration (COR) lists the subjects you are officially enrolled in, with a code anyone can check online.</p></div>`
      : html`<div class="notice">${icon('flag')}<p>You are not officially enrolled in ${rec.current.termName || 'the current term'} yet. Request your sections under Enrollment in Learn; your COR is ready once the registrar enrolls you.</p></div>`}
    <section class="card"><div class="card-head"><h2>${icon('calendar')} Subjects</h2><span class="muted">${rec.current.units} units</span></div>${currentTerm(rec.current)}</section>`);
  el.querySelector('#cor')?.addEventListener('click', async () => {
    try {
      const doc = await api.post('/api/academic/my/cor');
      location.hash = `#/print/${doc.code}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export async function myRequestsView(el) {
  const list = await api.get('/api/academic/my/requests');
  const official = DOCUMENT_TYPES.filter((d) => d.official);
  const reload = () => myRequestsView(el);
  mount(el, html`
    ${pageHead('Document requests', 'Request official documents from the registrar and follow each one until you pick it up.', html`<button class="btn primary" id="new">${icon('plus', 16)} Request a document</button>`)}
    ${list.length ? html`<div class="card"><table class="table">
      <thead><tr><th>Ref.</th><th>Document</th><th>Purpose</th><th class="num">Fee</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((r) => html`<tr><td><strong>${r.refNo}</strong><small>${fmtDate(r.createdAt.slice(0, 10))}</small></td><td>${r.typeLabel}<small>${r.copies} cop${r.copies === 1 ? 'y' : 'ies'}</small></td><td>${r.purpose}</td><td class="num">₱${r.fee}</td>
        <td>${requestBadge(r.status)}<small>${{ requested: 'Pay at the cashier, then the registrar prepares it.', paid: 'Paid. The registrar prepares it.', processing: 'Being prepared.', ready: 'Ready: bring your ID to the registrar.', released: `Released${r.releasedTo ? ` to ${r.releasedTo}` : ''}.`, cancelled: r.cancelReason || 'Cancelled.' }[r.status]}</small></td>
        <td>${r.status === 'requested' ? html`<button class="btn sm danger ghost" data-cancel="${r.id}">Withdraw</button>` : ''}</td></tr>`)}</tbody></table></div>`
      : html`<div class="card empty">${icon('file', 40)}<h2>No requests yet</h2><p>Request a Transcript of Records, a Certificate of Grades, of Enrollment, of Good Moral Character, or Honorable Dismissal.</p></div>`}`);
  el.querySelector('#new').addEventListener('click', () => modal({
    title: 'Request a document', submitLabel: 'Send request',
    body: html`<div class="grid two">
      <label class="field span-2"><span>Document</span><select name="type">${official.map((d) => option(d.id, `${d.label} · ₱${ac.settings.fees[d.id]} a copy`))}</select></label>
      <label class="field"><span>Copies</span><input type="number" name="copies" min="1" max="10" value="1" /></label>
      <label class="field"><span>Purpose</span><input name="purpose" required placeholder="e.g. Employment, scholarship" /></label>
    </div><p class="muted small">Pay at the cashier with your reference number. Your Certificate of Registration you print yourself, under My registration.</p>`,
    async onSubmit(form) {
      const r = await api.post('/api/academic/my/requests', formData(form));
      toast(`Request ${r.refNo} sent.`);
      reload();
    },
  }));
  el.onclick = async (e) => { // assigned, not added: the view redraws itself into the same element
    const id = e.target.dataset.cancel;
    if (!id || !(await confirmDialog('Withdraw this request?', { confirmLabel: 'Withdraw' }))) return;
    await api.post(`/api/academic/my/requests/${id}/cancel`);
    reload();
  };
}
