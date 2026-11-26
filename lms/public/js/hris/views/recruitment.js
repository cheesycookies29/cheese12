// Recruitment → Job openings and Applicant accounts (HR, permission hris.recruitment;
// server/recruitment.js): post openings at the campus HR is looking at, move the applications to each
// through the recruitment stages (one at a time or several at once, with a note to the applicant and
// an internal remark; the applicant is told on the bell), and extend or remove the temporary accounts
// of job applicants. Also the Job applicants, Applicant sign-up fields (PL-016) and Recruitment stages
// (PL-015) cards of HR settings.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, money, fmtDate, fmtDateTime, badge, toast, modal, confirmDialog, downloadFile, toCsv, today, option, formData } from '../../ui.js';
import { clickableRows, can } from '../state.js';
import { salaryFor } from '/shared/gov-pay.js';
import {
  AUDIENCES, OPENING_STATUSES, STAGE_LIMITS, openingStatusLabel,
  SIGNUP_FIELDS, FIXED_SIGNUP_FIELDS, FIELD_RULES, SEXES, ADDRESS_MAX, MIN_APPLICANT_AGE, listInWords,
} from '/shared/recruitment.js';
import { applicationBadge, salaryLine, placeLine, qualifications } from './jobs.js';
import { ratingBadge, progressBadge } from './assess.js';
import { panelCard, wirePanel, docsBadge } from './board.js';
import { requirementsEditor } from './documents.js';

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

// query.item: a vacant plantilla item (People → Plantilla → Post a job opening): the form starts with
// its item number, title, salary grade, campus and office, and the opening keeps which item it is.
export async function openingFormView(el, { id } = {}, query = {}) {
  const isNew = !id;
  const fromItem = isNew && query.item ? await api.get(`/api/hris/plantilla/${encodeURIComponent(query.item)}/opening`) : null;
  const o = isNew ? { status: 'draft', audience: 'all', vacancies: 1, closingDate: '', campusId: ctx.info.activeCampusId, ...(fromItem || {}) } : await api.get(`/api/hris/recruitment/openings/${id}`);
  const campuses = ctx.info.campuses || [];
  const [as, docSettings] = await Promise.all([api.get('/api/hris/recruitment/assessment'), api.get('/api/hris/recruitment/documents-settings')]);
  const fixed = Boolean(o.assessment?.frozen);
  const catDefault = (catId) => {
    const c = as.categories.find((x) => x.id === catId);
    const named = as.templates.find((t) => t.id === c?.templateId && !t.retired);
    return named?.id || as.templates.find((t) => t.categoryId === catId && !t.retired)?.id || '';
  };
  const tplOptions = (catId, chosen) => {
    const usable = as.templates.filter((t) => !t.retired || t.id === chosen);
    const mine = usable.filter((t) => t.categoryId === catId);
    const rest = usable.filter((t) => t.categoryId !== catId);
    return html`${option('', 'None yet', !chosen)}${mine.length ? html`<optgroup label="${as.categories.find((c) => c.id === catId)?.label || 'This category'}">${mine.map((t) => option(t.id, t.name, t.id === chosen))}</optgroup>` : ''}${rest.length ? html`<optgroup label="Other templates">${rest.map((t) => option(t.id, t.name, t.id === chosen))}</optgroup>` : ''}`;
  };
  const startCat = o.assessment?.categoryId ?? '';
  const startTpl = o.assessment?.templateId ?? '';
  const salaryHint = (sg) => (sg ? `${money(salaryFor(Number(sg), 1, today()))} a month (step 1, from the salary schedule)` : 'Leave empty if the position has no salary grade.');
  mount(el, html`
    ${pageHead(isNew ? 'New job opening' : `Edit ${o.title}`, isNew ? `At ${ctx.info.campusName || 'this campus'}.` : '', '', isNew ? BACK : [BACK, [`/recruitment/${id}`, o.title]])}
    <form id="opening-form" class="stack" novalidate>
      ${o.plantillaItemId ? html`<input type="hidden" name="plantillaItemId" value="${o.plantillaItemId}" />` : ''}
      ${fromItem ? html`<div class="notice"><p>From the vacant plantilla item <strong>${fromItem.plantillaItem}</strong>: its title, salary grade, campus and office are filled in. Selecting an applicant changes nothing on the item; link the person to it in <a href="#/plantilla/${fromItem.plantillaItemId}">Plantilla</a> when the appointment is made.</p></div>` : ''}
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
      <section class="card" id="assessment-card">
        <h2>Assessment</h2>
        <p class="muted small">How applicants to this opening are rated. The template comes from the position category; you can pick another.${can('hris.settings') ? html` Templates are in <a href="#/settings?section=assessment">HR settings → Assessment templates</a>.` : ''}</p>
        <div class="grid two">
          <label class="field"><span>Position category</span><select name="categoryId" id="categoryId" ${fixed ? 'disabled' : ''}>${option('', 'Not set', !startCat)}${as.categories.map((c) => option(c.id, c.label, c.id === startCat))}</select><span class="hint">For example Faculty or Non-teaching: they have different criteria.</span></label>
          <label class="field"><span>Assessment template</span><select name="templateId" id="templateId" ${fixed ? 'disabled' : ''}>${tplOptions(startCat, startTpl)}</select><span class="hint" id="tpl-hint">${fixed ? `Fixed: applications have been rated (version ${o.assessment.templateVersion}).` : 'The criteria and weights applicants are rated on.'}</span></label>
        </div>
      </section>
      <section class="card" id="requirements-card">
        <div class="card-head"><h2>Documents to upload</h2><button type="button" class="btn sm ghost" id="use-category">${icon('undo', 14)} Use the category's list</button></div>
        <p class="muted small">What applicants upload with their application, each Required or Optional. A new opening starts with its position category's list${can('hris.settings') ? html` (<a href="#/settings?section=documents">HR settings → Applicant documents</a>)` : ''}. Files: ${docSettings.types.length === 4 ? 'PDF, Word, Excel and pictures' : 'as HR settings allow'}, up to ${docSettings.maxMb} MB each, ${docSettings.maxFiles} per application.</p>
        <div id="req-editor"></div>
        <label class="check-row"><input type="checkbox" name="requireDocsBeforeApply" ${o.requireDocsBeforeApply ? 'checked' : ''} /> <span>Required documents must be uploaded before applying<small class="block muted">Off by default: people can apply first and add documents until the closing date.</small></span></label>
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
  // The checklist: the category's list for a new opening (until HR changes it), else the opening's own.
  const listOf = (catId) => (docSettings.checklists[catId] || []).map(({ name, note, required }) => ({ id: '', name, note, required }));
  let edited = !isNew;
  const reqs = requirementsEditor(form.querySelector('#req-editor'), isNew ? listOf(startCat) : o.requirements || [], { onEdit: () => (edited = true) });
  form.querySelector('#use-category').addEventListener('click', () => {
    const cat = form.querySelector('#categoryId').value;
    reqs.set(listOf(cat));
    edited = false;
    toast(cat ? 'The checklist is the category\'s list again.' : 'Pick a position category first.');
  });
  // A new category: its default template, and its checklist if HR has not changed the list.
  form.querySelector('#categoryId').addEventListener('change', (e) => {
    const sel = form.querySelector('#templateId');
    const next = catDefault(e.target.value);
    sel.innerHTML = '';
    sel.insertAdjacentHTML('beforeend', String(tplOptions(e.target.value, next)));
    if (!edited) reqs.set(listOf(e.target.value));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('.form-error');
    try {
      const body = { ...formData(form), requirements: reqs.get(), requireDocsBeforeApply: form.requireDocsBeforeApply.checked };
      const saved = await (isNew ? api.post('/api/hris/recruitment/openings', body) : api.put(`/api/hris/recruitment/openings/${id}`, body));
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
  ['Sex', (a) => a.profile?.sexLabel || ''], ['Date of birth', (a) => a.profile?.birthDate || ''], ['Home address', (a) => a.profile?.address || ''],
  ['Highest educational attainment', (a) => a.profile?.educationLabel || ''], ['Preferred campus', (a) => a.profile?.campusName || ''],
  ['Applied', (a) => localDay(a.createdAt)], ['Stage', (a) => a.stageLabel], ['Last change', (a) => localDay(a.updatedAt)], ['Latest note to the applicant', (a) => a.statusNote],
  ['Weighted total', (a) => (a.rating ? a.rating.total.toFixed(2) : '')], ['Rank', (a) => a.rating?.rank || ''],
  ['Assessors who rated', (a) => (a.assessors?.of ? `${a.assessors.submitted} of ${a.assessors.of}` : '')],
  ['Documents', (a) => (a.documents ? (a.documents.complete ? 'Complete' : `Missing ${a.documents.missing} required`) : '')],
];

// What a job applicant gave at sign-up besides their name, email and mobile (PL-016): one short line,
// and the address on its own. Shown whatever the sign-up asks now: hiding a field deletes nothing.
export function profileLines(p) {
  if (!p) return '';
  const line = [p.sexLabel, p.birthDate ? `Born ${fmtDate(p.birthDate)}` : '', p.educationLabel, p.campusName ? `Prefers ${p.campusName}` : ''].filter(Boolean).join(' · ');
  return html`${line ? html`<small class="block muted applicant-profile">${line}</small>` : ''}${p.address ? html`<small class="block muted applicant-profile">${p.address}</small>` : ''}`;
}

function who(a) {
  if (a.removed) return html`<strong class="muted">Removed applicant</strong><small class="block muted">Account removed; kept for the count</small>`;
  const name = a.userId ? html`<a href="#/recruitment/profile/${a.userId}" title="Applicant profile"><strong>${a.name}</strong></a>` : html`<strong>${a.name}</strong>`;
  if (a.internal && a.employee) return html`${name}<small class="block muted">${a.employee.position || 'Employee'}${a.employee.salaryGrade ? ` · SG ${a.employee.salaryGrade}-${a.employee.step || 1}` : ''} · ${a.employee.campusName}</small>`;
  return html`${name}<small class="block muted">${[a.email, a.phone].filter(Boolean).join(' · ')}${a.accountClosed ? ' · account closed' : ''}</small>${profileLines(a.profile)}`;
}

// The stages and outcomes of the school, in order, with how many of this opening's applications are at each.
function stageCounts(o) {
  const by = o.counts.byStage || {};
  const live = [...o.stages.stages.filter((x) => !x.retired || by[x.id]), ...o.stages.outcomes.filter((x) => !x.retired || by[x.id])];
  return live.map((x) => ({ ...x, kind: o.stages.stages.includes(x) ? 'stage' : 'outcome', count: by[x.id] || 0 }));
}
const stageName = (o, id) => [...o.stages.stages, ...o.stages.outcomes].find((x) => x.id === id)?.label || id;

// Move one application: a later stage, a final outcome, back one stage (with a reason), or a note at
// the same stage. The note goes to the applicant; the internal remark and the reason never do.
function moveDialog(o, a, done) {
  const m = a.moves;
  const forward = m.forward.map((id) => option(id, stageName(o, id), false));
  const outcomes = m.outcomes.map((id) => option(id, stageName(o, id), false));
  const { form } = modal({
    title: 'Move application',
    subtitle: `${a.name} · ${o.title} · now at ${a.stageLabel}`,
    submitLabel: 'Save and tell the applicant',
    body: html`<div class="stack tight">
      <label class="field"><span>Move to</span><select name="stage">
        ${m.forward.length ? html`<optgroup label="Next stages">${forward}</optgroup>` : ''}
        ${m.outcomes.length ? html`<optgroup label="Final outcome">${outcomes}</optgroup>` : ''}
        ${m.back ? html`<optgroup label="Back one stage">${option(m.back, `Back to ${stageName(o, m.back)}`, false)}</optgroup>` : ''}
        <optgroup label="No change">${option(a.stage, `Stay at ${a.stageLabel} (a note only)`, !m.forward.length && !m.outcomes.length)}</optgroup>
      </select><span class="hint">Any later stage, or a final outcome. Going back is one stage at a time, with a reason.</span></label>
      <label class="field" id="reason-field" hidden><span>Reason for moving it back<em>*</em></span><textarea name="reason" maxlength="500" rows="2" placeholder="e.g. Moved by mistake: the interview has not been held yet."></textarea><span class="hint">Kept in the history and the audit log. Not shown to the applicant.</span></label>
      <label class="field"><span>Note to the applicant (optional)</span><textarea name="note" maxlength="1000" rows="3" placeholder="e.g. Your interview is on Monday, 9:00, at the HR office. Please bring a valid ID."></textarea><span class="hint">The applicant reads it on the bell and on their application, from "HR office".</span></label>
      <label class="field internal-field"><span>${icon('lock', 14)} Internal remark (HR only)</span><textarea name="remark" maxlength="1000" rows="2" placeholder="e.g. References checked by phone."></textarea><span class="hint">Never shown to the applicant. Kept in the history for HR.</span></label>
    </div>`,
    async onSubmit(f) {
      await api.put(`/api/hris/recruitment/applications/${a.id}`, formData(f));
      toast('Saved. The applicant was told.');
      done();
    },
  });
  const sync = () => {
    const back = form.stage.value === m.back && m.back !== a.stage;
    form.querySelector('#reason-field').hidden = !back;
  };
  form.stage.addEventListener('change', sync);
  sync();
}

// Move several (ticked) applications to one stage or outcome, with one note.
function bulkDialog(o, picked, done) {
  const targets = [...o.stages.stages.filter((x) => !x.retired), ...o.stages.outcomes.filter((x) => !x.retired && !x.applicantOnly)];
  modal({
    title: `Move ${picked.length} application${picked.length === 1 ? '' : 's'}`,
    subtitle: `${o.title} · ${picked.map((a) => a.name).slice(0, 4).join(', ')}${picked.length > 4 ? ` and ${picked.length - 4} more` : ''}`,
    submitLabel: 'Move and tell the applicants',
    body: html`<div class="stack tight">
      <label class="field"><span>Move to</span><select name="stage">
        <optgroup label="Stages">${o.stages.stages.filter((x) => !x.retired).map((x) => option(x.id, x.label, false))}</optgroup>
        <optgroup label="Final outcome">${targets.filter((x) => !o.stages.stages.includes(x)).map((x) => option(x.id, x.label, false))}</optgroup>
      </select><span class="hint">Each must be at an earlier stage. If one cannot move, none are moved and ATLAS says which. Moving back is one at a time.</span></label>
      <label class="field"><span>Note to the applicants (optional)</span><textarea name="note" maxlength="1000" rows="3" placeholder="e.g. The written examination is on Friday, 9:00, at the Administration Building."></textarea><span class="hint">Each applicant reads the same note, from "HR office".</span></label>
      <label class="field internal-field"><span>${icon('lock', 14)} Internal remark (HR only)</span><textarea name="remark" maxlength="1000" rows="2"></textarea><span class="hint">Never shown to the applicants.</span></label>
    </div>`,
    async onSubmit(f) {
      const r = await api.post(`/api/hris/recruitment/openings/${o.id}/move`, { ids: picked.map((a) => a.id), ...formData(f) });
      toast(`${r.moved} application${r.moved === 1 ? '' : 's'} moved to ${r.stage}. The applicants were told.`);
      done();
    },
  });
}

// Everything that happened to an application, for HR: who, when, the notes, remarks and reasons.
function historyDialog(a) {
  modal({
    title: 'History',
    subtitle: a.name,
    submitLabel: null,
    body: html`<ol class="job-history">${[...a.history].reverse().map((h) => html`<li class="${h.back ? 'back' : ''}">
      <div class="job-note-head"><strong>${h.back ? `Back to ${h.stageLabel}` : h.stageLabel}</strong><span class="muted small">${fmtDateTime(h.at)} · ${h.by || (h.migrated ? 'Carried over from the earlier status' : '')}${h.bulk ? ' · moved with others' : ''}</span></div>
      ${h.reason ? html`<p class="small"><strong>Reason:</strong> ${h.reason}</p>` : ''}
      ${h.note ? html`<p class="small"><strong>Note to the applicant:</strong> ${h.note}</p>` : ''}
      ${h.remark ? html`<p class="small internal-remark">${icon('lock', 12)} <strong>Internal remark:</strong> ${h.remark}</p>` : ''}
    </li>`)}</ol>`,
  });
}

export async function openingView(el, { id }, query = {}) {
  const o = await api.get(`/api/hris/recruitment/openings/${id}`);
  const c = o.counts;
  const counts = stageCounts(o);
  const filter = counts.some((x) => x.id === query.stage) ? query.stage : '';
  const incomplete = query.docs === 'incomplete';
  const hasDocs = (o.requirements || []).length > 0;
  const nIncomplete = o.applications.filter((a) => a.documents && !a.documents.complete && a.status !== 'withdrawn').length;
  const order = new Map(counts.map((x, i) => [x.id, i]));
  const shown = o.applications.filter((a) => (!filter || a.stage === filter) && (!incomplete || (a.documents && !a.documents.complete))).sort((a, b) => (order.get(a.stage) ?? 99) - (order.get(b.stage) ?? 99) || a.createdAt.localeCompare(b.createdAt));
  const movable = (a) => !a.removed && a.status !== 'withdrawn' && !a.own;
  const groups = counts.map((x) => ({ ...x, apps: shown.filter((a) => a.stage === x.id) })).filter((g) => g.apps.length);
  const rateable = Boolean(o.assessment.templateName);
  const row = (a) => html`<tr data-app="${a.id}">
    <td class="pick">${movable(a) ? html`<input type="checkbox" data-pick="${a.id}" aria-label="Choose ${a.name}" />` : ''}</td>
    <td class="job-applicant">${who(a)}${a.inPool ? html` ${badge('In the pool', 'gray')}` : ''}${a.appointment?.confirmed ? html` ${badge('Appointed', 'green')}` : ''}${a.note ? html`<p class="small job-note">“${a.note}”</p>` : ''}${a.removed ? '' : html`<a class="small job-wes" href="#/recruitment/${o.id}/wes/${a.id}">${icon('file', 12)} Work Experience Sheet</a>`}</td>
    <td>${a.internal ? badge('Internal', 'brand') : badge('External', 'blue')}</td>
    <td class="job-applied"><span class="nowrap">${fmtDate(localDay(a.createdAt))}</span><small>Last change ${fmtDate(localDay(a.updatedAt))}</small></td>
    <td class="job-rating">${ratingBadge(a.rating)}${progressBadge(a.assessors)}${hasDocs && a.documents ? html`<a class="job-docs" href="#/recruitment/${o.id}/documents/${a.id}" title="Open the documents">${docsBadge(a.documents)}${a.documents.toCheck || a.documents.needsNew ? html`<small class="block muted">${[a.documents.toCheck ? `${a.documents.toCheck} to check` : '', a.documents.needsNew ? `${a.documents.needsNew} sent back` : ''].filter(Boolean).join(' · ')}</small>` : ''}</a>` : ''}</td>
    <td class="row-actions">${movable(a) ? html`<button class="btn sm" data-move="${a.id}">Move</button>` : a.own ? html`<small class="muted">Your own</small>` : ''}${movable(a) && rateable ? html`<a class="btn sm" href="#/recruitment/${o.id}/rate/${a.id}">${a.rating ? 'Rating' : 'Rate'}</a>` : ''}${a.status === 'selected' && !a.removed && can('hris.appoint') ? html`<a class="btn sm ${a.appointment ? '' : 'primary'}" href="#/recruitment/${o.id}/appoint/${a.id}">${a.appointment ? 'Appointment' : 'Appoint'}</a>` : ''}<button class="btn sm ghost" data-history="${a.id}">History</button></td>
  </tr>`;
  mount(el, html`
    ${pageHead(html`${o.title} ${openingBadge(o.status)}`, placeLine(o), html`
      <button class="btn" id="export" ${o.applications.length ? '' : 'disabled'}>${icon('download', 16)} Export CSV</button>
      <a class="btn" href="#/recruitment/${o.id}/comparative">${icon('table', 16)} Comparative list</a>
      <a class="btn" href="#/recruitment/${o.id}/edit">${icon('edit', 16)} Edit</a>`, BACK)}
    <div class="stats">
      <div class="card"><small>Applications</small><strong>${c.active}</strong></div>
      <div class="card"><small>Internal / external</small><strong>${c.internal} / ${c.external}</strong></div>
      <div class="card"><small>In progress</small><strong>${c.byStatus['in-progress']}</strong></div>
      <div class="card"><small>Selected</small><strong>${c.byStatus.selected} of ${o.vacancies}</strong>${o.filled ? html`<small>${o.filled} appointed</small>` : ''}</div>
    </div>
    <section class="card">
      <div class="card-head"><h2>Applications by stage</h2>${can('hris.settings') ? html`<a class="small" href="#/settings?section=stages">${icon('settings', 14)} Recruitment stages</a>` : ''}</div>
      ${o.applications.length ? html`<div class="stage-strip" role="group" aria-label="Show applications at a stage">
        <a class="stage-count ${filter || incomplete ? '' : 'on'}" href="#/recruitment/${o.id}"><strong>${o.applications.length}</strong><span>All</span></a>
        ${counts.map((x) => html`<a class="stage-count ${x.kind} ${filter === x.id ? 'on' : ''} ${x.count ? '' : 'zero'}" href="#/recruitment/${o.id}?stage=${x.id}" aria-label="${x.label}: ${x.count}"><strong>${x.count}</strong><span>${x.label}</span></a>`)}
        ${hasDocs ? html`<a class="stage-count docs-filter ${incomplete ? 'on' : ''} ${nIncomplete ? '' : 'zero'}" href="#/recruitment/${o.id}?docs=incomplete" aria-label="Incomplete documents: ${nIncomplete}"><strong>${nIncomplete}</strong><span>Incomplete documents</span></a>` : ''}
      </div>` : ''}
      ${o.applications.length
        ? html`<div class="bulk-bar" id="bulk-bar" hidden><span id="bulk-count"></span><button class="btn sm primary" id="bulk-move">${icon('chevronRight', 14)} Move chosen…</button><button class="btn sm ghost" id="bulk-clear">Clear</button></div>
          ${shown.length ? html`<div class="scroll-x"><table class="table job-apps" id="apps">
            <thead><tr><th class="pick"><input type="checkbox" id="pick-all" aria-label="Choose all shown" /></th><th>Applicant and cover note</th><th>Internal / external</th><th>Applied</th><th>${hasDocs ? html`Rating<span class="sr-only"> and documents</span>` : 'Rating'}</th><th></th></tr></thead>
            ${groups.map((g) => html`<tbody>
              <tr class="group-row"><th colspan="6" scope="colgroup">${g.label} <span class="muted">· ${g.apps.length}</span></th></tr>
              ${g.apps.map(row)}
            </tbody>`)}
          </table></div>` : html`<p class="muted">${incomplete ? 'Every application has its required documents.' : `No applications at ${stageName(o, filter)}.`}</p>`}`
        : html`<p class="muted">No applications yet.${o.status === 'draft' ? ' This opening is a draft: open it so people can apply.' : ''}</p>`}
    </section>
    ${panelCard(o)}
    <section class="card">
      <div class="card-head"><h2>The opening</h2><span class="actions">${audienceBadge(o.audience)} <span class="muted small">Closes ${fmtDate(o.closingDate)}</span></span></div>
      <dl class="info info-grid">
        <div><dt>Plantilla item no.</dt><dd>${o.fromItem ? html`<a href="#/plantilla/${o.fromItem.id}">${o.plantillaItem || o.fromItem.itemNo}</a>` : o.plantillaItem || '—'}</dd></div>
        <div><dt>Salary</dt><dd>${salaryLine(o) || '—'}</dd></div>
        <div><dt>Vacancies</dt><dd>${o.vacancies}</dd></div>
        <div><dt>Posted by</dt><dd>${o.createdBy} · ${fmtDate(localDay(o.createdAt))}</dd></div>
        <div><dt>Position category</dt><dd>${o.assessment.categoryLabel || '—'}</dd></div>
        <div><dt>Assessment template</dt><dd>${o.assessment.templateName ? html`${o.assessment.templateName} <small class="muted">v${o.assessment.templateVersion}${o.assessment.frozen ? ' · fixed by the first rating' : ''}</small>${o.assessment.templateExample ? html` ${badge('Example', 'amber')}` : ''}` : html`<span class="muted">None: <a href="#/recruitment/${o.id}/edit">choose one</a> to rate applicants</span>`}</dd></div>
        <div><dt>Documents asked for</dt><dd>${hasDocs ? html`${o.requirements.map((r) => r.name).join(', ')}${o.requireDocsBeforeApply ? html`<small class="block muted">Required documents before applying</small>` : ''}` : html`<span class="muted">None: <a href="#/recruitment/${o.id}/edit">add a checklist</a></span>`}</dd></div>
      </dl>
      ${o.description ? html`<p class="pre" style="margin-top:14px">${o.description}</p>` : ''}
      <h3 style="margin-top:16px">Qualification standards</h3>
      ${qualifications(o)}
    </section>`);
  const reload = () => openingView(el, { id }, query);
  const find = (aid) => o.applications.find((x) => x.id === aid);
  wirePanel(el, o, reload);
  el.querySelector('#export').addEventListener('click', () => downloadFile(`applications-${o.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${today()}.csv`, toCsv([CSV.map(([h]) => h), ...o.applications.map((a) => CSV.map(([, f]) => f(a)))])));
  el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => moveDialog(o, find(b.dataset.move), reload)));
  el.querySelectorAll('[data-history]').forEach((b) => b.addEventListener('click', () => historyDialog(find(b.dataset.history))));
  // Choosing several: the bar with "Move chosen…" shows while any is ticked.
  const picks = [...el.querySelectorAll('[data-pick]')];
  const bar = el.querySelector('#bulk-bar');
  const sync = () => {
    const n = picks.filter((x) => x.checked).length;
    if (bar) {
      bar.hidden = !n;
      el.querySelector('#bulk-count').textContent = `${n} chosen`;
    }
    const all = el.querySelector('#pick-all');
    if (all) {
      all.checked = n > 0 && n === picks.length;
      all.indeterminate = n > 0 && n < picks.length;
    }
  };
  picks.forEach((x) => x.addEventListener('change', sync));
  el.querySelector('#pick-all')?.addEventListener('change', (e) => {
    picks.forEach((x) => (x.checked = e.target.checked));
    sync();
  });
  el.querySelector('#bulk-clear')?.addEventListener('click', () => {
    picks.forEach((x) => (x.checked = false));
    sync();
  });
  el.querySelector('#bulk-move')?.addEventListener('click', () => bulkDialog(o, picks.filter((x) => x.checked).map((x) => find(x.dataset.pick)), reload));
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
            <td><a href="#/recruitment/profile/${u.id}"><strong>${u.name}</strong></a>${u.pool === 'in' ? html` ${badge('In the pool', 'gray')}` : u.pool === 'opted-in' ? html` ${badge('Agreed to the pool', 'gray')}` : ''}<small class="block muted">${[u.email, u.phone].filter(Boolean).join(' · ')}</small>${profileLines(u.profile)}</td>
            <td>${fmtDate(localDay(u.createdAt))}</td>
            <td>${u.status === 'open' ? html`${badge('Open', 'green')} <small class="block muted">until ${fmtDate(localDay(u.expiresAt))}</small>` : html`${badge('Closed', 'gray')} <small class="block muted">${u.removeAfter ? `removed on ${fmtDate(localDay(u.removeAfter))}` : 'kept until removed'}</small>`}</td>
            <td class="num">${u.applications}</td>
            <td class="row-actions"><a class="btn sm ghost" href="#/recruitment/profile/${u.id}">Profile</a><button class="btn sm" data-extend="${u.id}">Extend</button><button class="btn sm danger ghost" data-remove="${u.id}">Remove</button></td>
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
    <label class="field"><span>Keep in the pool of applicants (months)</span><input type="number" name="applicantPoolMonths" min="1" max="36" value="${s.applicantPoolMonths}" /><span class="hint">1 to 36; 12 by default. Only people who ticked it themselves.</span></label>
  </div>
</section>`;

// ----- HR settings → Applicant sign-up fields (PL-016) -----
// What the sign-up asks besides the fixed fields: each optional field Hidden, Optional or Required.
// Saved with the rest of HR settings (settings.people.signupFields).
const FIELD_HINTS = {
  phone: 'So HR can call or text the applicant.',
  sex: `${SEXES.map(([, l]) => l).join(' or ')}, as on the Personal Data Sheet.`,
  birthDate: `Must be a real date in the past; the applicant must be at least ${MIN_APPLICANT_AGE}.`,
  address: `At most ${ADDRESS_MAX} characters.`,
  education: 'Elementary, secondary, vocational, college or graduate studies; can be left blank unless required.',
  campus: 'The "branch": the choices are the school\'s campuses.',
};
export const signupFieldsCard = (s) => html`<section class="card" id="signup-fields">
  <h2>Applicant sign-up fields</h2>
  <p class="muted small">What people outside the school are asked when they sign up to apply. Ask only what HR needs to consider and contact them (Data Privacy Act of 2012): by default only the mobile number is asked, and it is optional. The privacy notice on the sign-up lists exactly the fields asked.</p>
  <p class="small"><strong>Always asked, and required:</strong> ${listInWords(FIXED_SIGNUP_FIELDS.map(([, l]) => l))}.</p>
  <ul class="sf-list">${SIGNUP_FIELDS.map((f) => html`<li>
    <span class="sf-name"><strong id="sf-${f.id}-label">${f.label}</strong><small>${FIELD_HINTS[f.id]}</small></span>
    <span class="seg sf-seg" role="radiogroup" aria-labelledby="sf-${f.id}-label">${FIELD_RULES.map(([k, l]) => html`<label class="rule-${k}"><input type="radio" name="sf-${f.id}" value="${k}" ${s.signupFields?.[f.id] === k ? 'checked' : ''} /> ${l}</label>`)}</span>
  </li>`)}</ul>
  <p class="muted small"><strong>Not offered at sign-up:</strong> document uploads, because documents come with each application; and an employee ID, because employees apply with their own account, not an applicant account.</p>
  <p class="muted small">Hiding a field later deletes nothing applicants already gave: HR still sees it on their applications and in Applicant accounts.</p>
</section>`;
// The field list from the HR settings form.
export const signupFieldsFrom = (fd) => Object.fromEntries(SIGNUP_FIELDS.map((f) => [f.id, fd.get(`sf-${f.id}`) || 'hidden']));

// ----- HR settings → Recruitment stages (PL-015) -----
// The in-progress stages, in order (add, rename, describe, move up or down, retire; a used stage can
// only be retired), and the final outcomes (labels and descriptions only; their meaning is fixed).
export async function recruitmentStagesCard(el) {
  const v = await api.get('/api/hris/recruitment/stages');
  let rows = v.stages.map((x) => ({ ...x }));
  const outcomes = v.outcomes.map((x) => ({ ...x }));
  const stageRow = (x, i) => html`<li class="stage-row ${x.retired ? 'retired' : ''}" data-i="${i}">
    <span class="stage-no" aria-hidden="true">${i + 1}</span>
    <div class="stage-fields">
      <label class="field"><span>Label</span><input name="label" value="${x.label}" maxlength="${STAGE_LIMITS.label}" required /></label>
      <label class="field"><span>What the applicant reads</span><textarea name="description" rows="3" maxlength="${STAGE_LIMITS.description}" placeholder="What happens at this stage, and what the applicant may be asked to do.">${x.description}</textarea></label>
      <small class="muted">${x.used ? `${x.current} at this stage now · used by ${x.used} application${x.used === 1 ? '' : 's'}` : x.id ? 'Not used yet' : 'New'}${x.retired ? ' · retired: no new moves to it' : ''}</small>
    </div>
    <div class="stage-tools">
      <button type="button" class="icon-btn" data-up aria-label="Move ${x.label} up" ${i === 0 ? 'disabled' : ''}>${icon('up', 16)}</button>
      <button type="button" class="icon-btn" data-down aria-label="Move ${x.label} down" ${i === rows.length - 1 ? 'disabled' : ''}>${icon('down', 16)}</button>
      <label class="check-inline"><input type="checkbox" name="retired" ${x.retired ? 'checked' : ''} /> Retired</label>
      ${x.used ? '' : html`<button type="button" class="btn sm danger ghost" data-remove>${icon('trash', 14)} Remove</button>`}
    </div>
  </li>`;
  const draw = () => mount(el, html`<section class="card" id="recruitment-stages">
    <div class="card-head"><h2>Recruitment stages</h2><span class="muted small">Applicants see these on their application</span></div>
    <p class="muted small">The stages a job application goes through, in order. A new application starts at the first stage that is not retired. HR can move an application to any later stage, back one stage with a reason, or to a final outcome. A stage an application has been at cannot be removed, only retired, so every history keeps its meaning.</p>
    <form id="stages-form" novalidate>
      <ol class="stage-list">${rows.map(stageRow)}</ol>
      <p><button type="button" class="btn sm" id="add-stage">${icon('plus', 14)} Add a stage</button></p>
      <h3>Final outcomes</h3>
      <p class="muted small">Fixed: their meaning never changes, so you can rename them and change what the applicant reads.</p>
      <ul class="stage-list outcomes">${outcomes.map((x, i) => html`<li class="stage-row ${x.retired ? 'retired' : ''}" data-o="${i}">
        <span class="stage-no" aria-hidden="true">${icon(x.meaning === 'selected' ? 'star' : x.meaning === 'withdrawn' ? 'undo' : 'flag', 14)}</span>
        <div class="stage-fields">
          <label class="field"><span>Label</span><input name="label" value="${x.label}" maxlength="${STAGE_LIMITS.label}" required /></label>
          <label class="field"><span>What the applicant reads</span><textarea name="description" rows="3" maxlength="${STAGE_LIMITS.description}">${x.description}</textarea></label>
          <small class="muted">Means: <strong>${x.meaningLabel}</strong>${x.applicantOnly ? ' · set only by the applicant' : ''}${x.used ? ` · used by ${x.used}` : ''}</small>
        </div>
        <div class="stage-tools">${x.optional ? html`<label class="check-inline"><input type="checkbox" name="retired" ${x.retired ? 'checked' : ''} /> Not offered</label>` : html`<span class="badge gray">Fixed</span>`}</div>
      </li>`)}</ul>
      <p class="form-error" hidden></p>
      <div class="actions end"><button class="btn primary" type="submit">Save recruitment stages</button></div>
    </form>
  </section>`);
  // Keep what was typed before redrawing (moving, adding, removing).
  const read = () => {
    const form = el.querySelector('#stages-form');
    form.querySelectorAll('[data-i]').forEach((li) => {
      const x = rows[Number(li.dataset.i)];
      x.label = li.querySelector('[name=label]').value;
      x.description = li.querySelector('[name=description]').value;
      x.retired = li.querySelector('[name=retired]').checked;
    });
    form.querySelectorAll('[data-o]').forEach((li) => {
      const x = outcomes[Number(li.dataset.o)];
      x.label = li.querySelector('[name=label]').value;
      x.description = li.querySelector('[name=description]').value;
      x.retired = Boolean(li.querySelector('[name=retired]')?.checked);
    });
  };
  const wire = () => {
    const form = el.querySelector('#stages-form');
    const at = (b) => Number(b.closest('[data-i]').dataset.i);
    const swap = (i, j) => {
      read();
      [rows[i], rows[j]] = [rows[j], rows[i]];
      redraw();
    };
    form.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => swap(at(b), at(b) - 1)));
    form.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => swap(at(b), at(b) + 1)));
    form.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      read();
      rows.splice(at(b), 1);
      redraw();
    }));
    form.querySelector('#add-stage').addEventListener('click', () => {
      read();
      rows.push({ id: '', label: '', description: '', used: 0, current: 0 });
      redraw();
      el.querySelector(`[data-i="${rows.length - 1}"] [name=label]`)?.focus();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      read();
      const errEl = form.querySelector('.form-error');
      try {
        const saved = await api.put('/api/hris/recruitment/stages', {
          stages: rows.map(({ id, label, description, retired }) => ({ ...(id ? { id } : {}), label, description, retired })),
          outcomes: outcomes.map(({ id, label, description, retired }) => ({ id, label, description, retired })),
        });
        rows = saved.stages.map((x) => ({ ...x }));
        saved.outcomes.forEach((x, i) => Object.assign(outcomes[i], x));
        redraw();
        toast('Recruitment stages saved.');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });
  };
  const redraw = () => {
    draw();
    wire();
  };
  redraw();
}
