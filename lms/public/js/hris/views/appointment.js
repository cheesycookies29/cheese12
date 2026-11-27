// Appointing a selected applicant and the appointment papers (PL-025; server/appointment.js):
//  - the Appoint page of an application (People → Recruitment → an opening → Appoint): the details,
//    pre-filled and checked by HR; Issue papers; Confirm the appointment (the person becomes an
//    employee, or their record is updated); the date of assumption and its certificate;
//  - a paper, shown as it prints on A4 from the snapshot taken when it was issued (a reprint says so);
//  - HR settings → Appointment papers: the signatories, the agency and place, the wording with its
//    merge fields, and form numbers (printed only when typed);
//  - the employee record's Appointment history, and My HR record → Appointment papers.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, money, fmtDate, fmtDateTime, badge, toast, modal, confirmDialog, today } from '../../ui.js';
import { can } from '../state.js';
import { brandProduct } from '../../brand.js';
import { NATURES, natureLabel, paperLabel, CONFIRM_NOTE, NEEDS_ACCOUNTS_NOTE, SIGNATORIES } from '/shared/appointment.js';
import { ROLES } from '/shared/roles.js';

const BACK = ['/recruitment', 'Job openings'];
const localDay = (iso) => today(new Date(iso));
const longDate = (ymd) => (ymd ? fmtDate(ymd, { month: 'long', day: 'numeric', year: 'numeric' }) : '—');
const nameOf = (f) => [f.firstName, f.middleName, f.lastName].filter(Boolean).join(' ') + (f.suffix ? ` ${f.suffix}` : '');
const confirmTag = html`<span class="badge amber" title="${CONFIRM_NOTE}">To confirm</span>`;
const paperStatus = (p) => (p.status === 'issued' ? badge('Issued', 'green') : badge('Cancelled', 'gray'));

// ----- The Appoint page -----
export async function appointView(el, { id, appId }) {
  const v = await api.get(`/api/hris/recruitment/applications/${appId}/appointment`);
  const appt = v.appointment;
  const f = appt ? appt.fields : v.draft;
  const c = v.choices;
  const locked = Boolean(appt?.locked);
  const issued = (k) => appt?.papers.find((p) => p.kind === k && p.status === 'issued');
  const step = !appt ? 1 : !issued('appointment') ? 2 : !appt.confirmed ? 3 : !issued('assumption') ? 4 : 5;
  const steps = [['Details', 'Check every field'], ['Papers', 'Issue the appointment form and the oath'], ['Confirm', appt?.confirmed ? (appt.confirmed.created ? 'Made an employee' : 'Employee record updated') : v.plan.kind === 'create' ? 'Make them an employee' : 'Update the employee record'], ['Assumption', 'Record the date; issue the certificate']];
  const opt = (val, lbl, sel) => html`<option value="${val}" ${String(sel ?? '') === String(val) ? 'selected' : ''}>${lbl}</option>`;
  const input = (name, lbl, value, { type = 'text', req = false, hintText = '', span = '', attrs = '' } = {}) => html`<label class="field ${span}"><span>${lbl}</span><input type="${type}" name="${name}" value="${value ?? ''}" ${req ? 'required' : ''} ${locked ? 'disabled' : ''} ${attrs} />${hintText ? html`<span class="hint">${hintText}</span>` : ''}</label>`;
  const itemChoices = c.items.filter((i) => i.status === 'vacant' || i.id === f.plantillaItemId || i.incumbentId === v.plan.employee?.id);
  const defaults = c.papers.filter((p) => p.defaultWording);
  // Making an external applicant an employee changes their sign-in account: that needs hris.accounts.
  const noAccounts = v.plan.kind === 'create' && !c.mayMakeAccounts;
  mount(el, html`
    ${pageHead(html`Appointment ${appt?.confirmed ? badge('Confirmed', 'green') : appt ? badge('In progress', 'blue') : ''}`, `${v.application.name} · ${v.opening.title} · ${v.application.internal ? 'Internal' : 'External'} applicant`, '', [BACK, [`/recruitment/${id}`, v.opening.title]])}
    <ol class="ap-steps" aria-label="Steps">${steps.map(([t, s], i) => html`<li class="${i + 1 < step ? 'done' : i + 1 === step ? 'current' : ''}"><span class="ap-n">${i + 1 < step ? icon('check', 14) : i + 1}</span><span><strong>${t}</strong><small>${s}</small></span></li>`)}</ol>
    ${defaults.length ? html`<div class="notice">${icon('alert', 18)}<p><strong>The built-in wording is in use</strong> for ${defaults.map((p) => p.label).join(', ')}. ${c.defaultNote}${can('hris.settings') ? html` <a href="#/settings?section=appointment-papers">HR settings → Appointment papers</a>` : ''}</p></div>` : ''}
    <form class="card" id="ap-form" novalidate>
      <div class="card-head"><h2>${icon('clipboard')} 1. The details</h2>${locked ? html`<span class="muted small">${icon('lock', 12)} Papers are issued: to change a detail, use <strong>Cancel and reissue</strong> on the paper.</span>` : html`<span class="muted small">Pre-filled from the application, the opening and the plantilla item. Check every field.</span>`}</div>
      <h3 class="ap-h">The person</h3>
      <div class="grid">
        ${input('lastName', 'Last name', f.lastName, { req: true })}
        ${input('firstName', 'First name', f.firstName, { req: true })}
        ${input('middleName', 'Middle name', f.middleName)}
        ${input('suffix', 'Name extension', f.suffix, { hintText: 'Jr., Sr., III' })}
        ${input('address', 'Home address', f.address, { span: 'span-2', hintText: 'Printed on the oath of office.' })}
      </div>
      <h3 class="ap-h">Position and pay</h3>
      <div class="grid">
        ${input('position', 'Position title', f.position, { req: true })}
        <label class="field"><span>Plantilla item</span><select name="plantillaItemId" ${locked ? 'disabled' : ''}>${opt('', 'None from the register', f.plantillaItemId)}${itemChoices.map((i) => opt(i.id, `${i.itemNo} · ${i.positionTitle} (SG ${i.salaryGrade})${i.status !== 'vacant' ? ` · ${i.status}` : ''}`, f.plantillaItemId))}</select><span class="hint">A vacant item, or the person's own. The opening's item comes first.</span></label>
        ${input('itemNo', 'Item no. (when not in the register)', f.plantillaItemId ? '' : f.itemNo, { attrs: f.plantillaItemId ? 'disabled' : '' })}
        ${c.government ? html`
          <label class="field"><span>Salary grade</span><select name="salaryGrade" required ${locked ? 'disabled' : ''}>${Array.from({ length: 33 }, (_, i) => opt(i + 1, `SG ${i + 1}`, f.salaryGrade))}</select></label>
          <label class="field"><span>Step</span><select name="step" required ${locked ? 'disabled' : ''}>${Array.from({ length: 8 }, (_, i) => opt(i + 1, `Step ${i + 1}`, f.step || 1))}</select></label>
          <div class="field"><span>Monthly salary</span><output id="ap-salary" class="sg-out">${money(f.monthlySalary)}</output><span class="hint">From the salary schedule on the effective date.</span></div>`
          : input('monthlySalary', 'Monthly salary (₱)', f.monthlySalary, { type: 'number', req: true, attrs: 'min="0" step="0.01"' })}
      </div>
      <h3 class="ap-h">Nature and status ${confirmTag}</h3>
      <div class="grid">
        <label class="field"><span>Nature of appointment</span><select name="nature" required ${locked ? 'disabled' : ''}>${NATURES.map(([k, l]) => opt(k, l, f.nature))}</select></label>
        <label class="field"><span>Status of appointment</span><select name="status" required ${locked ? 'disabled' : ''}>${opt('', 'Pick the status…', f.status)}${c.statuses.map((s) => opt(s, s, f.status))}</select><span class="hint">Never filled in for you: a plantilla item does not make an appointment permanent.</span></label>
        <span></span>
        ${input('vice', 'Vice (the person it replaces)', f.vice, { hintText: 'From the item\'s previous incumbent, when ATLAS knows it.' })}
        <label class="field"><span>Why the position is vacant</span><input name="viceReason" value="${f.viceReason || ''}" list="ap-reasons" ${locked ? 'disabled' : ''} /><datalist id="ap-reasons">${c.viceReasons.map((r) => html`<option value="${r}"></option>`)}</datalist><span class="hint">As in "vice …, who retired" or "who was promoted".</span></label>
        <input type="hidden" name="viceEmployeeId" value="${f.viceEmployeeId || ''}" />
      </div>
      <h3 class="ap-h">Where</h3>
      <div class="grid">
        <label class="field"><span>Campus</span><select name="campusId" ${locked ? 'disabled' : ''}>${c.campuses.map((x) => opt(x.id, x.name, f.campusId))}</select></label>
        ${input('office', 'Office, department or unit', f.office, { req: true })}
        ${input('agency', 'Agency', f.agency)}
        ${input('place', 'Place', f.place, { hintText: 'For "Done this … in …" and the oath.' })}
      </div>
      <h3 class="ap-h">Dates</h3>
      <div class="grid">
        ${input('dateSigned', 'Date of signing', f.dateSigned, { type: 'date', req: true })}
        ${input('effectiveDate', 'Effective date', f.effectiveDate, { type: 'date', req: true, hintText: 'Also the date hired on a new employee record.' })}
        <div class="field"><span>Date of assumption</span><output class="sg-out">${f.assumptionDate ? longDate(f.assumptionDate) : 'Recorded later (step 4)'}</output></div>
        ${input('endDate', 'Appointment ends on', f.endDate, { type: 'date', hintText: 'Only for a temporary, casual, contractual, substitute or coterminous appointment with an end date. People → Due dates reminds HR before it ends.' })}
        ${input('publicationFrom', 'Published or posted from', f.publicationFrom, { type: 'date' })}
        ${input('publicationTo', 'Published or posted until', f.publicationTo, { type: 'date' })}
        ${input('publicationPlace', 'Where it was published or posted', f.publicationPlace)}
        ${input('deliberationDate', 'Deliberation of the selection board', f.deliberationDate, { type: 'date' })}
      </div>
      <h3 class="ap-h">Signatories</h3>
      <div class="grid ap-sigs">${SIGNATORIES.map((s) => html`
        <label class="field"><span>${s.label}</span><input name="sig-${s.key}-name" ${s.key === 'appointingOfficer' || s.key === 'hrmo' ? 'required' : ''} value="${f.signatories?.[s.key]?.name || ''}" ${locked ? 'disabled' : ''} placeholder="Name" /></label>
        <label class="field"><span>Title</span><input name="sig-${s.key}-title" value="${f.signatories?.[s.key]?.title || ''}" ${locked ? 'disabled' : ''} placeholder="${s.defaultTitle}" /></label>`)}</div>
      <p class="muted small">From HR settings → Appointment papers; a change here is for this appointment only.</p>
      <p class="form-error" hidden></p>
      ${locked ? '' : html`<div class="actions end">${appt && !appt.papers.length ? html`<button type="button" class="btn ghost danger" id="ap-discard">Discard the draft</button>` : ''}<button class="btn primary" type="submit">${appt ? 'Save the details' : 'Save and continue'}</button></div>`}
    </form>
    ${appt ? html`
    <section class="card">
      <div class="card-head"><h2>${icon('file')} 2. Papers</h2><button class="btn primary" id="ap-issue">${icon('plus', 16)} Issue papers</button></div>
      <p class="muted small">Issuing freezes each paper: its text, the wording's version and the signatories as printed, with its own number. Every later print is marked as a reprint of what was issued.</p>
      ${appt.papers.length ? html`<div class="scroll-x"><table class="table ap-papers">
        <thead><tr><th>Paper</th><th>Number</th><th>Issued</th><th>Status</th><th></th></tr></thead>
        <tbody>${appt.papers.map((p) => html`<tr>
          <td><strong>${p.label}</strong>${p.defaultWording ? html`<small class="block muted">Built-in wording</small>` : ''}</td>
          <td class="nowrap">${p.refNo}${p.replaces ? html`<small class="block muted">replaces ${p.replaces}</small>` : ''}</td>
          <td>${fmtDate(p.issuedOn)}<small class="block muted">${p.issuedBy}${p.prints ? ` · printed ${p.prints}×` : ''}</small></td>
          <td>${paperStatus(p)}${p.status === 'cancelled' ? html`<small class="block muted">${p.cancelReason}${p.replacedBy ? ` · replaced by ${p.replacedBy}` : ''}</small>` : ''}</td>
          <td class="row-actions"><a class="btn sm" href="#/appointments/${appt.id}/paper/${p.id}">${icon('eye', 14)} ${p.status === 'issued' ? 'View and print' : 'View'}</a>${p.status === 'issued' ? html`<button class="btn sm ghost" data-reissue="${p.id}">Cancel and reissue</button>` : ''}</td>
        </tr>`)}</tbody></table></div>` : html`<p class="muted">No paper issued yet. Issue the appointment form and the oath of office; the certificate of assumption comes once the person assumes.</p>`}
    </section>
    <section class="card" id="ap-confirm-card">
      <div class="card-head"><h2>${icon('userPlus')} 3. Confirm the appointment</h2>${appt.confirmed ? badge(`Confirmed ${fmtDate(localDay(appt.confirmed.at))}`, 'green') : ''}</div>
      ${appt.confirmed ? html`<p>Confirmed by ${appt.confirmed.by}. ${appt.confirmed.created ? html`A new employee record (${appt.confirmed.employeeNo}) was made; the applicant account is now a ${ROLES[appt.confirmed.role]?.label || appt.confirmed.role} account with the same sign-in.` : 'The employee record has the new position, salary grade, step and status, with a row in the appointment history.'}${appt.confirmed.itemNo ? ` Plantilla item ${appt.confirmed.itemNo} is Filled.` : ''}${appt.confirmed.releasedItem ? ` Item ${appt.confirmed.releasedItem} was released.` : ''}</p>
        ${can('employees.view') ? html`<p><a class="btn sm" href="#/employees/${appt.confirmed.employeeId}">${icon('user', 14)} Open the employee record</a></p>` : ''}`
        : html`<ul class="ap-plan">
          ${v.plan.kind === 'create'
            ? html`<li>A <strong>new employee record</strong> from the details above, the applicant's account and sign-up details, and their work experience (which moves to the record). Date hired: <strong>${longDate(f.effectiveDate)}</strong>.</li>
              <li>The applicant account <strong>${v.plan.account?.username}</strong> becomes a staff account: the same username and password; it no longer closes or is removed.</li>`
            : html`<li><strong>${v.plan.employee.name}'s record</strong> (${v.plan.employee.employeeNo}) gets the new position, salary grade, step and status, and a dated row in the appointment history; the earlier rows stay.</li>`}
          <li>${v.plan.item ? html`Plantilla item <strong>${v.plan.item.itemNo}</strong> is linked to them (Filled).` : 'No plantilla item.'}</li>
          <li>The opening has ${v.plan.vacancies} vacanc${v.plan.vacancies === 1 ? 'y' : 'ies'}, ${v.plan.filled} filled; after this, ${v.plan.leftAfter} left.</li>
        </ul>
        ${v.plan.warnings.map((w) => html`<div class="notice">${icon('alert', 16)}<p>${w}</p></div>`)}
        ${noAccounts ? html`<div class="notice" id="ap-needs-accounts">${icon('lock', 16)}<p>${NEEDS_ACCOUNTS_NOTE}</p></div>` : ''}
        <div class="actions ap-confirm">
          ${v.plan.kind === 'create' && !noAccounts ? html`<label class="field"><span>Account type</span><select id="ap-role">${c.roles.map((r) => opt(r.id, r.label, 'staff'))}</select></label>` : ''}
          <button class="btn primary" id="ap-confirm" ${issued('appointment') && !noAccounts ? '' : 'disabled'}>${icon('check', 16)} Confirm the appointment</button>
          ${issued('appointment') ? '' : html`<span class="muted small">Issue the appointment form first.</span>`}
        </div>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('calendar')} 4. Assumption to duty</h2>${f.assumptionDate ? badge(`Assumed ${longDate(f.assumptionDate)}`, 'green') : ''}</div>
      ${f.assumptionDate
        ? (issued('assumption') ? html`<p>The certificate of assumption is issued (${issued('assumption').refNo}).</p>` : html`<p>Recorded. <button class="btn sm primary" id="ap-issue-assumption">${icon('file', 14)} Issue the certificate of assumption</button></p>`)
        : html`<p class="muted small">When the person assumes the duties of the position, record the date: it fills the Certificate of Assumption to Duty, which you can issue then.</p>
          <div class="actions ap-assume"><label class="field"><span>Date of assumption</span><input type="date" id="ap-assumed" max="${today()}" min="${f.dateSigned}" value="" /></label>
          <label class="check-inline"><input type="checkbox" id="ap-assume-issue" checked /> Issue the certificate now</label>
          <button class="btn" id="ap-assume">${icon('check', 16)} Record the date of assumption</button></div>`}
    </section>` : ''}`);

  const reload = () => appointView(el, { id, appId });
  const form = el.querySelector('#ap-form');
  const collect = () => {
    const fd = new FormData(form);
    const body = Object.fromEntries(['lastName', 'firstName', 'middleName', 'suffix', 'address', 'position', 'plantillaItemId', 'itemNo', 'salaryGrade', 'step', 'monthlySalary', 'nature', 'status', 'vice', 'viceEmployeeId', 'viceReason', 'campusId', 'office', 'agency', 'place', 'dateSigned', 'effectiveDate', 'endDate', 'publicationFrom', 'publicationTo', 'publicationPlace', 'deliberationDate'].map((k) => [k, fd.get(k) ?? '']));
    if (body.vice !== (f.vice || '')) body.viceEmployeeId = '';
    body.assumptionDate = f.assumptionDate || '';
    body.signatories = Object.fromEntries(SIGNATORIES.map((s) => [s.key, { name: fd.get(`sig-${s.key}-name`) || '', title: fd.get(`sig-${s.key}-title`) || '' }]));
    return body;
  };
  // The monthly salary follows the grade and step (the salary schedule on the effective date).
  const salary = async () => {
    const out = el.querySelector('#ap-salary');
    if (!out) return;
    const sg = form.salaryGrade.value;
    const r = await api.get(`/api/hris/appointments/salary?sg=${sg}&date=${form.effectiveDate.value}`);
    out.textContent = money(r.salaries[(Number(form.step.value) || 1) - 1] || 0);
  };
  if (!locked) {
    for (const n of ['salaryGrade', 'step', 'effectiveDate']) form[n]?.addEventListener('change', salary);
    form.plantillaItemId.addEventListener('change', () => {
      const it = c.items.find((i) => i.id === form.plantillaItemId.value);
      form.itemNo.disabled = Boolean(it);
      if (it && form.salaryGrade) {
        form.salaryGrade.value = it.salaryGrade;
        salary();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('.form-error');
      try {
        if (appt) await api.put(`/api/hris/appointments/${appt.id}`, collect());
        else await api.post(`/api/hris/recruitment/applications/${appId}/appointment`, collect());
        toast(appt ? 'Details saved.' : 'Saved. Now issue the papers.');
        reload();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
    el.querySelector('#ap-discard')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Discard this draft appointment? Nothing was issued.', { confirmLabel: 'Discard' }))) return;
      await api.del(`/api/hris/appointments/${appt.id}`);
      toast('Draft discarded.');
      reload();
    });
  }
  if (!appt) return;
  el.querySelector('#ap-issue').addEventListener('click', () => {
    const open = c.papers.filter((p) => !issued(p.id));
    modal({
      title: 'Issue papers',
      subtitle: `${nameOf(f)} · ${f.position}`,
      submitLabel: 'Issue',
      body: open.length ? html`<p class="small">Each paper gets its number and is frozen as it is now.</p>
        <ul class="ap-pick">${open.map((p) => html`<li><label class="check-inline"><input type="checkbox" name="kind" value="${p.id}" ${p.id === 'assumption' && !f.assumptionDate ? 'disabled' : ['appointment', 'oath-fil'].includes(p.id) ? 'checked' : ''} /> ${p.label}${p.defaultWording ? html` <span class="badge amber">Built-in wording</span>` : ''}${p.id === 'assumption' && !f.assumptionDate ? html` <span class="muted small">(after the date of assumption is recorded)</span>` : ''}</label></li>`)}</ul>`
        : html`<p>Every paper is issued. To change one, use <strong>Cancel and reissue</strong>.</p>`,
      async onSubmit(fm) {
        const kinds = [...fm.querySelectorAll('[name=kind]:checked')].map((x) => x.value);
        await api.post(`/api/hris/appointments/${appt.id}/issue`, { kinds });
        toast(`${kinds.length} paper${kinds.length === 1 ? '' : 's'} issued.`);
        reload();
      },
    });
  });
  el.querySelectorAll('[data-reissue]').forEach((b) => b.addEventListener('click', () => reissueDialog(appt, appt.papers.find((p) => p.id === b.dataset.reissue), c, reload)));
  el.querySelector('#ap-confirm')?.addEventListener('click', async () => {
    const role = el.querySelector('#ap-role')?.value;
    const what = v.plan.kind === 'create' ? `Make ${nameOf(f)} an employee, and turn their applicant account into a ${c.roles.find((r) => r.id === role)?.label || 'Staff'} account with the same sign-in?` : `Update ${v.plan.employee.name}'s employee record with this appointment?`;
    if (!(await confirmDialog(what, { confirmLabel: 'Confirm the appointment', danger: false, title: 'Confirm the appointment' }))) return;
    try {
      const r = await api.post(`/api/hris/appointments/${appt.id}/confirm`, { role });
      toast(v.plan.kind === 'create' ? `${nameOf(f)} is an employee now.` : 'The employee record is updated.');
      if (r.offerClose && (await confirmDialog(`Every vacancy of ${v.opening.title} is filled. Close the opening? It takes no more applications; nothing is removed.`, { confirmLabel: 'Close the opening', danger: false, title: 'All vacancies filled' }))) {
        await api.put(`/api/hris/recruitment/openings/${v.opening.id}`, { status: 'closed' });
        toast('The opening is closed.');
      }
      reload();
    } catch (ex) {
      toast(ex.message, 'error');
    }
  });
  el.querySelector('#ap-assume')?.addEventListener('click', async () => {
    const date = el.querySelector('#ap-assumed').value;
    try {
      await api.post(`/api/hris/appointments/${appt.id}/assumption`, { date, issue: el.querySelector('#ap-assume-issue').checked });
      toast('Date of assumption recorded.');
      reload();
    } catch (ex) {
      toast(ex.message, 'error');
    }
  });
  el.querySelector('#ap-issue-assumption')?.addEventListener('click', async () => {
    await api.post(`/api/hris/appointments/${appt.id}/issue`, { kinds: ['assumption'] });
    toast('Certificate of assumption issued.');
    reload();
  });
}

// Cancel a paper with the reason, change what needs changing, and issue it again (a new number).
function reissueDialog(appt, p, c, done) {
  const f = appt.fields;
  const fieldsFor = {
    appointment: [['position', 'Position title'], ['office', 'Office or unit'], ['effectiveDate', 'Effective date', 'date'], ['endDate', 'Appointment ends on', 'date'], ['dateSigned', 'Date of signing', 'date'], ['viceReason', 'Why the position is vacant']],
    'oath-fil': [['address', 'Home address'], ['place', 'Place']],
    'oath-en': [['address', 'Home address'], ['place', 'Place']],
    assumption: [['assumptionDate', 'Date of assumption', 'date'], ['place', 'Place']],
  }[p.kind] || [];
  modal({
    title: `Cancel and reissue: ${p.label}`,
    subtitle: `${p.refNo}, issued ${fmtDate(p.issuedOn)}. The cancelled paper is kept, marked cancelled.`,
    submitLabel: 'Cancel and reissue',
    wide: true,
    body: html`<label class="field"><span>Reason</span><textarea name="reason" rows="2" maxlength="500" required placeholder="e.g. The middle name was misspelled."></textarea><span class="hint">Kept with the paper and in the audit log.</span></label>
      <div class="grid">
        ${[['lastName', 'Last name'], ['firstName', 'First name'], ['middleName', 'Middle name'], ...fieldsFor].map(([k, l, type]) => html`<label class="field"><span>${l}</span><input name="${k}" type="${type || 'text'}" value="${f[k] || ''}" /></label>`)}
        ${p.kind === 'appointment' ? html`<label class="field"><span>Status of appointment</span><select name="status">${c.statuses.map((s) => html`<option value="${s}" ${s === f.status ? 'selected' : ''}>${s}</option>`)}</select></label>
          <label class="field"><span>Nature of appointment</span><select name="nature">${NATURES.map(([k, l]) => html`<option value="${k}" ${k === f.nature ? 'selected' : ''}>${l}</option>`)}</select></label>
          ${c.government ? html`<label class="field"><span>Step</span><select name="step">${Array.from({ length: 8 }, (_, i) => html`<option value="${i + 1}" ${Number(f.step) === i + 1 ? 'selected' : ''}>Step ${i + 1}</option>`)}</select></label>` : ''}` : ''}
      </div>
      <p class="muted small">Other papers already issued keep what they say; reissue each one that must change. If the change affects the employee record (for example the step), edit the record too.</p>`,
    async onSubmit(fm) {
      const fd = new FormData(fm);
      const fields = {};
      for (const [k, val] of fd.entries()) if (k !== 'reason') fields[k] = val;
      await api.post(`/api/hris/appointments/${appt.id}/papers/${p.id}/cancel`, { reason: fd.get('reason'), reissue: true, fields });
      toast(`${p.refNo} cancelled and reissued.`);
      done();
    },
  });
}

// ----- A paper, as it prints (A4), from its snapshot -----
const pieces = (paras) => paras.map((para) => html`<p>${para.map((x) => (x.f ? html`<span class="pp-fill">${x.v || ' '.repeat(18)}</span>` : x.t))}</p>`);
const sigBlock = (sig, caption = '', under = '') => html`<div class="as-sign pp-sign">${caption ? html`<span class="as-sign-cap">${caption}</span>` : ''}<span class="as-sign-line">${(sig?.name || '').toUpperCase()}</span><span class="as-sign-title">${sig?.title || ''}</span>${under ? html`<span class="as-sign-title muted">${under}</span>` : ''}</div>`;
export function paperDoc(p, { logo = '', copyLine = '' } = {}) {
  const s = p.snapshot;
  const sig = s.signatories || {};
  const fil = s.lang === 'fil';
  const head = html`<header class="pp-head">
    ${s.formNo ? html`<span class="pp-formno">${s.formNo}</span>` : ''}<span class="pp-ref">No. ${p.refNo}</span>
    <div class="as-head">${logo ? html`<img src="${logo}" alt="" />` : ''}<div><span>Republic of the Philippines</span><strong class="as-school">${s.header.agency || s.header.schoolName}</strong>${s.header.address ? html`<span>${s.header.address}</span>` : ''}</div></div>
  </header>`;
  let body;
  if (p.kind === 'appointment') {
    body = html`<h2 class="pp-title">${s.title}</h2>
      <p class="pp-to"><strong>${s.values.name.toUpperCase()}</strong><br />${s.values.address || ''}</p>
      <div class="pp-text">${pieces(s.parts.body)}${pieces(s.parts.effectivity)}</div>
      <div class="pp-signs-right">${sigBlock(sig.appointingOfficer, 'Very truly yours,', 'Appointing Officer / Authority')}<p class="pp-date">Date of signing: <span class="pp-fill">${s.values.date_signed}</span></p></div>
      <div class="pp-cert-grid">
        <section class="pp-cert"><h3>Certification</h3>${pieces(s.parts.hrmoCertification)}${sigBlock(sig.hrmo)}</section>
        <section class="pp-cert"><h3>Certification</h3>${pieces(s.parts.boardCertification)}${sigBlock(sig.boardChair)}</section>
      </div>
      <section class="pp-box"><h3>For use of the Civil Service Commission</h3><div class="pp-box-space"></div></section>
      <section class="pp-ack"><h3>Acknowledgement</h3><p>Received the original or a copy of this appointment on <span class="pp-fill">${' '.repeat(24)}</span>.</p>${sigBlock({ name: s.values.name, title: 'Appointee' })}</section>`;
  } else if (p.kind === 'assumption') {
    body = html`<h2 class="pp-title">${s.title}</h2>
      <div class="pp-text">${pieces(s.parts.body)}${pieces(s.parts.closing)}</div>
      <div class="pp-signs-right">${sigBlock(sig.headOfOffice, '', 'Head of Office / Department / Unit')}</div>
      <div class="pp-signs-left">${sigBlock(sig.hrmo, 'Attested by:')}</div>`;
  } else {
    body = html`<h2 class="pp-title">${s.title}</h2>
      <div class="pp-text pp-oath">${pieces(s.parts.body)}</div>
      <div class="pp-signs-right">${sigBlock({ name: s.values.name, title: fil ? 'Lagda ng Nanunumpa' : 'Affiant' })}</div>
      <div class="pp-text">${pieces(s.parts.jurat)}</div>
      <dl class="pp-id"><div><dt>${fil ? 'ID na ipinakita' : 'Government-issued ID'}</dt><dd></dd></div><div><dt>${fil ? 'Numero ng ID' : 'ID number'}</dt><dd></dd></div><div><dt>${fil ? 'Petsa at lugar ng pagkakaloob' : 'Date and place issued'}</dt><dd></dd></div></dl>
      <div class="pp-signs-right">${sigBlock(sig.appointingOfficer, '', fil ? 'Opisyal na nangasiwa sa panunumpa' : 'Person administering the oath')}</div>`;
  }
  return html`<article class="as-doc pp-doc ${p.status === 'cancelled' ? 'pp-cancelled' : ''}" data-kind="${p.kind}">
    ${p.status === 'cancelled' ? html`<div class="pp-stamp">Cancelled${p.replacedBy ? ` · replaced by ${p.replacedBy}` : ''}</div>` : ''}
    ${head}${body}
    <p class="as-foot pp-foot">No. ${p.refNo} · issued ${longDate(p.issuedOn)} · ${brandProduct('People')}<span class="pp-copy">${copyLine}</span></p>
  </article>`;
}

async function paperPage(el, { url, printUrl, back, self = false }) {
  const p = await api.get(url);
  const logo = p.logo || '';
  const reprintText = (r) => (self ? `Copy of the document issued on ${longDate(p.issuedOn)}, printed on ${longDate(localDay(r.printedAt))} by ${r.printedBy}.` : `Reprint of the document issued on ${longDate(p.issuedOn)}, reprinted on ${longDate(localDay(r.printedAt))} by ${r.printedBy}.`);
  const willReprint = self || p.prints > 0 || today() !== p.issuedOn;
  mount(el, html`
    <div class="no-print">
      ${pageHead(p.label, `No. ${p.refNo} · issued ${longDate(p.issuedOn)} by ${p.issuedBy}`, p.status === 'issued' ? html`<button class="btn primary" id="do-print">${icon('file', 16)} Print</button>` : '', back)}
      <div class="card toolbar">
        <span class="small">Shown as it prints, on A4, from the copy kept when it was issued: later changes to the wording, signatories or the school's details do not change it.${willReprint ? ' This print is marked as a reprint.' : ''}</span>
        ${p.snapshot.template.defaultWording ? html`<span class="badge amber">Built-in wording</span>` : ''}
        ${p.printLog.length ? html`<span class="muted small">Printed ${p.printLog.length}×, last ${fmtDateTime(p.printLog.at(-1).at)} by ${p.printLog.at(-1).by}</span>` : ''}
      </div>
      ${p.snapshot.template.defaultWording && !self ? html`<div class="notice">${icon('alert', 18)}<p>Issued with the built-in wording. Replace it with the wording of the CSC form your office uses (HR settings → Appointment papers), then use Cancel and reissue.</p></div>` : ''}
    </div>
    ${paperDoc(p, { logo, copyLine: willReprint ? ` · ${reprintText({ printedAt: new Date().toISOString(), printedBy: ctx.user?.name || '' })}` : '' })}`);
  el.querySelector('#do-print')?.addEventListener('click', async () => {
    try {
      const r = await api.post(printUrl);
      el.querySelector('.pp-copy').textContent = r.reprint ? ` · ${reprintText(r)}` : '';
      window.print();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
export async function paperView(el, { apptId, paperId }) {
  const p = await api.get(`/api/hris/appointments/${apptId}/papers/${paperId}`);
  await paperPage(el, { url: `/api/hris/appointments/${apptId}/papers/${paperId}`, printUrl: `/api/hris/appointments/${apptId}/papers/${paperId}/print`, back: [BACK, [`/recruitment/${p.openingId}/appoint/${p.applicationId}`, 'Appointment']] });
}
export async function myPaperView(el, { paperId }) {
  await paperPage(el, { url: `/api/hris/me/appointment-papers/${paperId}`, printUrl: `/api/hris/me/appointment-papers/${paperId}/print`, back: [['/me/profile', 'My HR record']], self: true });
}

// ----- The appointment history (employee record, My HR record) -----
const historyTable = (rows) => (rows.length ? html`<div class="scroll-x"><table class="table compact ap-history">
  <thead><tr><th>From</th><th>To</th><th>Position</th><th>SG-step</th><th class="num">Monthly salary</th><th>Status</th><th>Nature</th><th>Item no.</th></tr></thead>
  <tbody>${rows.map((r) => html`<tr><td class="nowrap">${fmtDate(r.from)}</td><td class="nowrap">${r.to ? fmtDate(r.to) : 'Present'}</td><td>${r.position}<small class="block muted">${[r.office, r.campusName].filter(Boolean).join(' · ')}</small></td><td>${r.salaryGrade ? `${r.salaryGrade}-${r.step || 1}` : '—'}</td><td class="num">${r.monthlySalary != null ? money(r.monthlySalary) : '—'}</td><td>${r.status || '—'}</td><td>${r.natureLabel || (r.source === 'record' ? html`<span class="muted">From the record</span>` : '—')}</td><td>${r.itemNo || '—'}</td></tr>`)}</tbody></table></div>`
  : html`<p class="muted">No appointments recorded in ATLAS yet. Each appointment confirmed in People adds a dated row here; the rows are never overwritten.</p>`);
export async function employeeAppointmentsCard(box, emp) {
  const v = await api.get(`/api/hris/employees/${emp.id}/appointments`);
  mount(box, html`<div class="card-head"><h2>${icon('layers')} Appointment history</h2></div>
    <p class="muted small">The start of the service record: one row per appointment, with the dates.</p>
    ${historyTable(v.history)}
    ${v.appointments.length ? html`<h3 class="ap-h">Appointment papers</h3><ul class="link-list">${v.appointments.map((a) => html`<li><a href="#/recruitment/${a.openingId}/appoint/${a.applicationId}">${a.title}</a> <span class="muted small">· ${a.papers.filter((p) => p.status === 'issued').map((p) => `${paperLabel(p.kind)} ${p.refNo}`).join(', ') || 'no paper issued'}</span></li>`)}</ul>` : ''}`);
}
export async function myAppointmentPapersCard(box) {
  const v = await api.get('/api/hris/me/appointment-papers');
  mount(box, html`<div class="card-head"><h2>${icon('file')} Appointment papers</h2></div>
    ${v.appointments.length ? v.appointments.map((a) => html`<div class="ap-mine">
      <p><strong>${a.position}</strong>${a.itemNo ? html` <span class="muted small">· item ${a.itemNo}</span>` : ''}<small class="block muted">Effective ${longDate(a.effectiveDate)}${a.assumptionDate ? ` · assumed ${longDate(a.assumptionDate)}` : ''}</small></p>
      <ul class="link-list">${a.papers.map((p) => html`<li>${p.status === 'issued' ? html`<a href="#/me/papers/${p.id}">${p.label}</a>` : html`<span class="muted">${p.label}</span>`} <span class="muted small">· ${p.refNo} · ${fmtDate(p.issuedOn)}</span> ${p.status === 'cancelled' ? badge(`Cancelled${p.replacedBy ? `, see ${p.replacedBy}` : ''}`, 'gray') : ''}</li>`)}</ul>
    </div>`) : html`<p class="muted">No appointment papers yet. When HR issues your appointment papers in People, they appear here for you to print.</p>`}
    <h3 class="ap-h">Appointment history</h3>${historyTable(v.history)}`);
}

// ----- HR settings → Appointment papers -----
export async function appointmentPapersCard(box) {
  const s = await api.get('/api/hris/appointment-papers/settings');
  const editable = can('hris.settings');
  const dis = editable ? '' : 'disabled';
  mount(box, html`<form class="card" id="appointment-papers" novalidate>
    <div class="card-head"><h2>${icon('file')} Appointment papers</h2></div>
    <p class="muted small">The appointment form, the Oath of Office (Panunumpa sa Katungkulan, in Filipino, and in English) and the Certificate of Assumption to Duty, made when HR appoints a selected applicant. Their layout follows the structure of the CSC forms; they are not the official forms, and no form number prints unless you type the one on your office's copy.</p>
    <h3 class="ap-h">Appointment signatories</h3>
    <p class="muted small">Filled in on each new appointment, where HR can change them for that appointment. An issued paper keeps the names it was issued with.</p>
    <div class="grid ap-sigs">${s.signatoryList.map((x) => html`
      <label class="field"><span>${x.label}</span><input name="sig-${x.key}-name" value="${s.signatories[x.key].name}" maxlength="120" placeholder="Name" ${dis} /></label>
      <label class="field"><span>Title</span><input name="sig-${x.key}-title" value="${s.signatories[x.key].title}" maxlength="160" placeholder="${x.defaultTitle}" ${dis} /></label>`)}</div>
    <div class="grid">
      <label class="field"><span>Agency on the papers</span><input name="agency" value="${s.agency}" maxlength="200" placeholder="${s.agencyDefault}" ${dis} /><span class="hint">Blank: ${s.agencyDefault}.</span></label>
      <label class="field span-2"><span>Place</span><input name="place" value="${s.place}" maxlength="200" placeholder="${s.placeDefault || 'e.g. the town and province'}" ${dis} /><span class="hint">For "Done this … in …" and where oaths are sworn. Blank: the employer address.</span></label>
    </div>
    <h3 class="ap-h">Wording</h3>
    <p class="small">Write merge fields in braces; a field ATLAS does not know is refused. Each change makes a new version; papers already issued keep theirs.</p>
    <details class="ap-fields"><summary>Merge fields (${s.mergeFields.length})</summary><ul class="chips">${s.mergeFields.map(([k, l]) => html`<li class="chip static" title="${l}"><code>{${k}}</code> ${l}</li>`)}</ul></details>
    ${s.papers.map((p) => html`<details class="ap-tpl" ${p.defaultWording ? '' : 'open'}>
      <summary><strong>${p.label}</strong> <span class="muted small">version ${s.templates[p.id].version}${s.templates[p.id].updatedBy ? ` · ${s.templates[p.id].updatedBy}, ${fmtDate(localDay(s.templates[p.id].updatedAt))}` : ''}</span> ${p.defaultWording ? html`<span class="badge amber">Built-in wording</span>` : ''}</summary>
      ${p.defaultWording ? html`<p class="notice small">${icon('alert', 14)} ${s.defaultNote}</p>` : ''}
      ${p.parts.map((part) => html`<label class="field"><span>${part.label}</span><textarea name="tpl-${p.id}-${part.key}" rows="${part.key === 'body' ? 7 : 3}" maxlength="4000" data-default="${part.default}" ${dis}>${s.templates[p.id].parts[part.key]}</textarea></label>`)}
      <div class="grid"><label class="field"><span>Form number to print</span><input name="form-${p.id}" value="${s.formNumbers[p.id]}" maxlength="60" placeholder="Blank: none printed" ${dis} /><span class="hint">Only as on your office's copy of the CSC form.</span></label></div>
      ${editable ? html`<button type="button" class="btn sm ghost" data-restore="${p.id}">${icon('undo', 14)} Put back the built-in wording</button>` : ''}
    </details>`)}
    <p class="form-error" hidden></p>
    ${editable ? html`<div class="actions end"><button class="btn primary" type="submit">Save appointment papers</button></div>` : ''}
  </form>`);
  const form = box.querySelector('form');
  box.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => {
    for (const t of form.querySelectorAll(`[name^="tpl-${b.dataset.restore}-"]`)) t.value = t.dataset.default;
    toast('The built-in wording is back in the boxes. Save to keep it.');
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    const fd = new FormData(form);
    try {
      await api.put('/api/hris/appointment-papers/settings', {
        agency: fd.get('agency'), place: fd.get('place'),
        signatories: Object.fromEntries(s.signatoryList.map((x) => [x.key, { name: fd.get(`sig-${x.key}-name`), title: fd.get(`sig-${x.key}-title`) }])),
        formNumbers: Object.fromEntries(s.papers.map((p) => [p.id, fd.get(`form-${p.id}`)])),
        templates: Object.fromEntries(s.papers.map((p) => [p.id, { parts: Object.fromEntries(p.parts.map((part) => [part.key, fd.get(`tpl-${p.id}-${part.key}`)])) }])),
      });
      err.hidden = true;
      toast('Appointment papers saved.');
      appointmentPapersCard(box);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
}
export { natureLabel };
