// Recruitment → Job openings and Applicant accounts (HR, permission hris.recruitment;
// server/recruitment.js): post openings at the campus HR is looking at, follow the applications to
// each with a simple status (the applicant is told on the bell), and extend or remove the temporary
// accounts of job applicants.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, money, fmtDate, badge, toast, modal, confirmDialog, downloadFile, toCsv, today, option, formData } from '../../ui.js';
import { clickableRows } from '../state.js';
import { salaryFor } from '/shared/gov-pay.js';
import { AUDIENCES, OPENING_STATUSES, HR_STATUSES, applicationStatusLabel, openingStatusLabel } from '/shared/recruitment.js';
import { applicationBadge, salaryLine, placeLine, qualifications } from './jobs.js';

const OPENING_KIND = { draft: 'gray', open: 'green', closed: 'gray' };
const openingBadge = (s) => badge(openingStatusLabel(s), OPENING_KIND[s]);
const audienceBadge = (a) => (a === 'internal' ? badge('Internal only', 'brand') : badge('Open to all', 'blue'));
const localDay = (iso) => today(new Date(iso));
const BACK = ['/recruitment', 'Job openings'];

export async function openingsView(el) {
  const list = await api.get('/api/hris/recruitment/openings');
  mount(el, html`
    ${pageHead('Job openings', `At ${ctx.info.campusName || 'this campus'}. Post an opening, open it for applications, then follow the applications to it.`, html`
      <a class="btn" href="#/recruitment/applicants">${icon('users', 16)} Applicant accounts</a>
      <a class="btn primary" href="#/recruitment/new">${icon('plus', 16)} New opening</a>`)}
    ${list.length
      ? html`<section class="card scroll-x" id="openings"><table class="table clickable">
          <thead><tr><th>Position</th><th>Place of assignment</th><th>Salary</th><th>Who may apply</th><th>Closes</th><th>Status</th><th class="num">Applications</th></tr></thead>
          <tbody>${list.map((o) => html`<tr data-href="#/recruitment/${o.id}">
            <td><strong>${o.title}</strong>${o.plantillaItem ? html`<small class="block muted">Item no. ${o.plantillaItem}</small>` : ''}</td>
            <td>${o.office || '—'}</td>
            <td>${salaryLine(o) || '—'}</td>
            <td>${audienceBadge(o.audience)}</td>
            <td>${fmtDate(o.closingDate)}${o.status === 'open' && !o.accepting ? html` ${badge('Passed', 'amber')}` : ''}</td>
            <td>${openingBadge(o.status)}</td>
            <td class="num"><strong>${o.counts.active}</strong>${o.counts.byStatus.withdrawn ? html`<small class="block muted">+${o.counts.byStatus.withdrawn} withdrawn</small>` : ''}</td>
          </tr>`)}</tbody></table></section>`
      : html`<div class="card empty">${icon('briefcase', 40)}<h2>No job openings at this campus yet</h2><p>Post the first one. People outside the school see an opening that is Open to all on the home page, and employees see it in People.</p><p><a class="btn primary" href="#/recruitment/new">${icon('plus', 16)} New opening</a></p></div>`}`);
  const table = el.querySelector('#openings');
  if (table) clickableRows(table);
}

const field = (label, name, value, { type = 'text', required = false, span = 1, hint = '', attrs = '' } = {}) => html`<label class="field span-${span}"><span>${label}${required ? html`<em>*</em>` : ''}</span>
  ${type === 'textarea' ? html`<textarea name="${name}" rows="3" ${required ? 'required' : ''}>${value ?? ''}</textarea>` : html`<input type="${type}" name="${name}" value="${value ?? ''}" ${required ? 'required' : ''} ${attrs} />`}
  ${hint ? html`<span class="hint">${hint}</span>` : ''}</label>`;

export async function openingFormView(el, { id } = {}) {
  const isNew = !id;
  const o = isNew ? { status: 'draft', audience: 'all', vacancies: 1, closingDate: '', campusId: ctx.info.activeCampusId } : await api.get(`/api/hris/recruitment/openings/${id}`);
  const campuses = ctx.info.campuses || [];
  const salaryHint = (sg) => (sg ? `${money(salaryFor(Number(sg), 1, today()))} a month (step 1, from the salary schedule)` : 'Leave empty if the position has no salary grade.');
  mount(el, html`
    ${pageHead(isNew ? 'New job opening' : `Edit ${o.title}`, isNew ? `At ${ctx.info.campusName || 'this campus'}.` : '', '', isNew ? BACK : [BACK, [`/recruitment/${id}`, o.title]])}
    <form id="opening-form" class="stack" novalidate>
      <section class="card">
        <h2>The position</h2>
        <div class="grid">
          ${field('Position title', 'title', o.title, { required: true, span: 2, attrs: 'maxlength="160" placeholder="e.g. Instructor I"' })}
          ${field('Plantilla item no.', 'plantillaItem', o.plantillaItem, { hint: 'As DBM issued it.', attrs: 'maxlength="80"' })}
          <label class="field"><span>Salary grade</span><select name="salaryGrade" id="sg">${option('', 'None')}${Array.from({ length: 33 }, (_, i) => option(i + 1, `SG ${i + 1}`, Number(o.salaryGrade) === i + 1))}</select><span class="hint" id="sg-hint">${salaryHint(o.salaryGrade)}</span></label>
          ${campuses.length > 1 ? html`<label class="field"><span>Campus</span><select name="campusId">${campuses.map((c) => option(c.id, c.name, c.id === o.campusId))}</select></label>` : ''}
          ${field('Office', 'office', o.office, { hint: 'The college or office of assignment.', attrs: 'maxlength="160" placeholder="e.g. College of Computing"' })}
          ${field('Number of vacancies', 'vacancies', o.vacancies, { type: 'number', attrs: 'min="1" max="999"' })}
          ${field('Description (optional)', 'description', o.description, { type: 'textarea', span: 3 })}
        </div>
      </section>
      <section class="card">
        <h2>Qualification standards</h2>
        <p class="muted small">As the CSC qualification standards for the position say; at least one before the opening is opened.</p>
        <div class="grid two">
          ${field('Education', 'education', o.education, { type: 'textarea' })}
          ${field('Training', 'training', o.training, { type: 'textarea' })}
          ${field('Experience', 'experience', o.experience, { type: 'textarea' })}
          ${field('Eligibility', 'eligibility', o.eligibility, { type: 'textarea' })}
        </div>
      </section>
      <section class="card">
        <h2>Applications</h2>
        <div class="grid">
          ${field('Closing date', 'closingDate', o.closingDate, { type: 'date', required: true, hint: 'Applications are taken through this day.' })}
          <label class="field"><span>Who may apply</span><select name="audience">${AUDIENCES.map(([k, l]) => option(k, l, k === o.audience))}</select><span class="hint">Internal only: employees, from People. Open to all: job applicants too.</span></label>
          <label class="field"><span>Status</span><select name="status">${OPENING_STATUSES.map(([k, l]) => option(k, l, k === o.status))}</select><span class="hint">Applicants see it only while Open, until the closing date.</span></label>
        </div>
      </section>
      <p class="form-error" hidden></p>
      <div class="actions end">
        ${!isNew && !o.counts.total ? html`<button type="button" class="btn danger ghost" id="delete">${icon('trash', 16)} Delete</button>` : ''}
        <a class="btn" href="#${isNew ? '/recruitment' : `/recruitment/${id}`}">Cancel</a>
        <button class="btn primary" type="submit">${isNew ? 'Save opening' : 'Save changes'}</button>
      </div>
    </form>`);
  const form = el.querySelector('#opening-form');
  form.querySelector('#sg').addEventListener('change', (e) => (form.querySelector('#sg-hint').textContent = salaryHint(e.target.value)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('.form-error');
    try {
      const saved = await (isNew ? api.post('/api/hris/recruitment/openings', formData(form)) : api.put(`/api/hris/recruitment/openings/${id}`, formData(form)));
      toast(isNew ? 'Job opening saved.' : 'Changes saved.');
      location.hash = `#/recruitment/${saved.id}`;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });
  form.querySelector('#delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete the opening ${o.title}? It has no applications.`))) return;
    await api.del(`/api/hris/recruitment/openings/${id}`);
    toast('Job opening deleted.');
    location.hash = '#/recruitment';
  });
}

const CSV = [
  ['Name', (a) => a.name], ['Internal or external', (a) => (a.internal ? 'Internal' : 'External')], ['Email', (a) => a.email], ['Mobile', (a) => a.phone],
  ['Current position', (a) => a.employee?.position || ''], ['Salary grade', (a) => (a.employee?.salaryGrade ? `${a.employee.salaryGrade}-${a.employee.step || 1}` : '')], ['Campus', (a) => a.employee?.campusName || ''],
  ['Applied', (a) => localDay(a.createdAt)], ['Status', (a) => applicationStatusLabel(a.status)], ['Last change', (a) => localDay(a.updatedAt)], ['Note to the applicant', (a) => a.statusNote],
];

function who(a) {
  if (a.removed) return html`<strong class="muted">Removed applicant</strong><small class="block muted">Account removed; kept for the count</small>`;
  if (a.internal && a.employee) return html`<strong>${a.name}</strong><small class="block muted">${a.employee.position || 'Employee'}${a.employee.salaryGrade ? ` · SG ${a.employee.salaryGrade}-${a.employee.step || 1}` : ''} · ${a.employee.campusName}</small>`;
  return html`<strong>${a.name}</strong><small class="block muted">${[a.email, a.phone].filter(Boolean).join(' · ')}${a.accountClosed ? ' · account closed' : ''}</small>`;
}

export async function openingView(el, { id }) {
  const o = await api.get(`/api/hris/recruitment/openings/${id}`);
  const c = o.counts;
  mount(el, html`
    ${pageHead(html`${o.title} ${openingBadge(o.status)}`, placeLine(o), html`
      <button class="btn" id="export" ${o.applications.length ? '' : 'disabled'}>${icon('download', 16)} Export CSV</button>
      <a class="btn" href="#/recruitment/${o.id}/edit">${icon('edit', 16)} Edit</a>`, BACK)}
    <div class="stats">
      <div class="card"><small>Applications</small><strong>${c.active}</strong></div>
      <div class="card"><small>Internal / external</small><strong>${c.internal} / ${c.external}</strong></div>
      <div class="card"><small>Shortlisted</small><strong>${c.byStatus.shortlisted}</strong></div>
      <div class="card"><small>Selected</small><strong>${c.byStatus.selected} of ${o.vacancies}</strong></div>
    </div>
    <section class="card">
      <h2>Applications</h2>
      ${o.applications.length
        ? html`<div class="scroll-x"><table class="table" id="apps">
            <thead><tr><th>Applicant and cover note</th><th>Internal / external</th><th>Applied</th><th>Status</th><th>Last change</th><th></th></tr></thead>
            <tbody>${o.applications.map((a) => html`<tr>
              <td class="job-applicant">${who(a)}${a.note ? html`<p class="small job-note">“${a.note}”</p>` : ''}</td>
              <td>${a.internal ? badge('Internal', 'brand') : badge('External', 'blue')}</td>
              <td class="nowrap">${fmtDate(localDay(a.createdAt))}</td>
              <td>${applicationBadge(a.status)}</td>
              <td class="nowrap">${fmtDate(localDay(a.updatedAt))}</td>
              <td class="row-actions">${a.removed || a.status === 'withdrawn' ? '' : html`<button class="btn sm" data-status="${a.id}">Change status</button>`}</td>
            </tr>`)}</tbody></table></div>`
        : html`<p class="muted">No applications yet.${o.status === 'draft' ? ' This opening is a draft: open it so people can apply.' : ''}</p>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>The opening</h2><span class="actions">${audienceBadge(o.audience)} <span class="muted small">Closes ${fmtDate(o.closingDate)}</span></span></div>
      <dl class="info info-grid">
        <div><dt>Plantilla item no.</dt><dd>${o.plantillaItem || '—'}</dd></div>
        <div><dt>Salary</dt><dd>${salaryLine(o) || '—'}</dd></div>
        <div><dt>Vacancies</dt><dd>${o.vacancies}</dd></div>
        <div><dt>Posted by</dt><dd>${o.createdBy} · ${fmtDate(localDay(o.createdAt))}</dd></div>
      </dl>
      ${o.description ? html`<p class="pre" style="margin-top:14px">${o.description}</p>` : ''}
      <h3 style="margin-top:16px">Qualification standards</h3>
      ${qualifications(o)}
    </section>`);
  el.querySelector('#export').addEventListener('click', () => downloadFile(`applications-${o.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${today()}.csv`, toCsv([CSV.map(([h]) => h), ...o.applications.map((a) => CSV.map(([, f]) => f(a)))])));
  el.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
    const a = o.applications.find((x) => x.id === b.dataset.status);
    modal({
      title: 'Change status',
      subtitle: `${a.name} · ${o.title}`,
      submitLabel: 'Save and tell the applicant',
      body: html`<div class="stack tight">
        <label class="field"><span>Status</span><select name="status">${HR_STATUSES.map((s) => option(s, applicationStatusLabel(s), s === a.status))}</select></label>
        <label class="field"><span>Note to the applicant (optional)</span><textarea name="note" maxlength="500" rows="3" placeholder="e.g. Interview on Monday, 9:00, at the HR office."></textarea><span class="hint">The applicant sees it on the bell and in My applications.</span></label>
      </div>`,
      async onSubmit(form) {
        await api.put(`/api/hris/recruitment/applications/${a.id}`, formData(form));
        toast('Status saved. The applicant was told.');
        openingView(el, { id });
      },
    });
  }));
}

export async function applicantsView(el) {
  const { applicants, settings } = await api.get('/api/hris/recruitment/applicants');
  const purge = settings.applicantPurgeDays;
  mount(el, html`
    ${pageHead('Applicant accounts', `People outside the school who signed up to apply. An account closes ${settings.applicantAccountDays} days after sign-up; ${purge ? `it is removed ${purge} days after it closes, and its applications stay as "removed applicant".` : 'a closed account is kept until you remove it.'}`, '', BACK)}
    ${applicants.length
      ? html`<section class="card scroll-x"><table class="table">
          <thead><tr><th>Applicant</th><th>Signed up</th><th>Account</th><th class="num">Applications</th><th></th></tr></thead>
          <tbody>${applicants.map((u) => html`<tr>
            <td><strong>${u.name}</strong><small class="block muted">${[u.email, u.phone].filter(Boolean).join(' · ')}</small></td>
            <td>${fmtDate(localDay(u.createdAt))}</td>
            <td>${u.status === 'open' ? html`${badge('Open', 'green')} <small class="block muted">until ${fmtDate(localDay(u.expiresAt))}</small>` : html`${badge('Closed', 'gray')} <small class="block muted">${u.removeAfter ? `removed on ${fmtDate(localDay(u.removeAfter))}` : 'kept until removed'}</small>`}</td>
            <td class="num">${u.applications}</td>
            <td class="row-actions"><button class="btn sm" data-extend="${u.id}">Extend</button><button class="btn sm danger ghost" data-remove="${u.id}">Remove</button></td>
          </tr>`)}</tbody></table></section>`
      : html`<div class="card empty">${icon('users', 40)}<h2>No applicant accounts</h2><p>People sign up from Job openings on the home page while an opening is Open to all.</p></div>`}`);
  const find = (id) => applicants.find((u) => u.id === id);
  el.querySelectorAll('[data-extend]').forEach((b) => b.addEventListener('click', () => {
    const u = find(b.dataset.extend);
    modal({
      title: 'Extend applicant account',
      subtitle: `${u.name} · ${u.status === 'open' ? `open until ${fmtDate(localDay(u.expiresAt))}` : 'closed'}`,
      submitLabel: 'Extend',
      body: html`<label class="field"><span>Days to add</span><input type="number" name="days" min="1" max="1095" value="30" required /><span class="hint">Added to the closing date (or to today, if it has passed). The applicant is told on the bell.</span></label>`,
      async onSubmit(form) {
        const r = await api.post(`/api/hris/recruitment/applicants/${u.id}/extend`, { days: Number(form.days.value) });
        toast(`${u.name}'s account is open until ${fmtDate(localDay(r.expiresAt))}.`);
        applicantsView(el);
      },
    });
  }));
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const u = find(b.dataset.remove);
    if (!(await confirmDialog(`Remove ${u.name}'s account and the personal details in their applications? Their applications stay as "removed applicant" so the counts stay true. This cannot be undone.`, { confirmLabel: 'Remove', title: 'Remove applicant account' }))) return;
    await api.del(`/api/hris/recruitment/applicants/${u.id}`);
    toast('Applicant account removed.');
    applicantsView(el);
  }));
}

// For the HR settings screen: how long applicant accounts last.
export const recruitmentSettingsCard = (s) => html`<section class="card" id="job-applicants">
  <h2>Job applicants</h2>
  <p class="muted small">The temporary accounts of people outside the school who sign up to apply (Recruitment). A new length applies to accounts made after the change; HR can extend one account.</p>
  <div class="grid">
    <label class="field"><span>Applicant accounts last (days)</span><input type="number" name="applicantAccountDays" min="30" max="1095" value="${s.applicantAccountDays}" /><span class="hint">30 to 1095; 365 by default.</span></label>
    <label class="field"><span>Warn before closing (days)</span><input type="number" name="applicantWarnDays" min="1" max="90" value="${s.applicantWarnDays}" /><span class="hint">A notice on the applicant's bell, once.</span></label>
    <label class="field"><span>Remove after closing (days)</span><input type="number" name="applicantPurgeDays" min="0" max="365" value="${s.applicantPurgeDays}" /><span class="hint">0 = keep until HR removes it.</span></label>
  </div>
</section>`;
