// Work experience in People (PL-023, the work-experience section of PL-017; "Add another entry" at
// the end of the list, PL-032): the list of entries with its form, used on My HR record (the employee
// themselves), My work experience (a job applicant), the employee record (HR) and the applicant
// profile (HR), and the printed Work Experience Sheet (A4, newest first). server/work-experience.js.
import { api } from '../api.js';
import { ctx, pageHead } from '../shell.js';
import { icon } from '../icons.js';
import { html, mount, fmtDate, fmtDateTime, badge, toast, modal, confirmDialog, downloadFile, today } from '../ui.js';
import { brandProduct } from '../brand.js';
import { parseCsv } from '/shared/csv.js';
import { FIELDS, LIMITS, CONFIRM_NOTE, STATUS_SUGGESTIONS, durationText, lengthText, pesos, gradeText, csvTemplate, entriesFromCsv, EARLIEST } from '/shared/work-experience.js';

const label = (k) => FIELDS.find((f) => f.key === k)?.label || k;
const hint = (k) => FIELDS.find((f) => f.key === k)?.hint || '';
const confirmTag = html`<span class="badge amber wx-confirm" title="${CONFIRM_NOTE}">${CONFIRM_NOTE}</span>`;
const localDay = (iso) => today(new Date(iso));

// One entry as the list shows it.
function entryItem(e, i, n, v, opts) {
  const facts = [
    e.supervisor && [label('supervisor'), e.supervisor],
    e.appointmentStatus && [label('appointmentStatus'), e.appointmentStatus],
    [label('government'), e.government ? 'Yes' : 'No'],
    e.salaryGrade && ['Salary grade and step', gradeText(e)],
    e.monthlySalary != null && [label('monthlySalary').replace(' (₱)', ''), pesos(e.monthlySalary)],
  ].filter(Boolean);
  const edit = v.canEdit;
  return html`<li class="wx-entry" data-id="${e.id}">
    <div class="wx-head">
      <div class="grow">
        <strong class="wx-pos">${e.position}</strong>
        <span class="wx-where">${[e.office, e.agency].filter(Boolean).join(' · ')}${e.location ? html` <span class="muted">· ${e.location}</span>` : ''}</span>
        <span class="wx-when">${icon('calendar', 13)} ${durationText(e)} <span class="muted">(${lengthText(e, v.today) || '—'})</span></span>
      </div>
      <span class="wx-badges">${e.verified ? html`<span class="badge green" title="Verified by ${e.verified.by} on ${fmtDate(localDay(e.verified.at))}">${icon('check', 12)} Verified</span>` : badge(e.unverifiedAfterChange ? 'Changed: not verified' : 'Not verified', e.unverifiedAfterChange ? 'amber' : 'gray')}</span>
    </div>
    <dl class="wx-facts">${facts.map(([k, x]) => html`<div><dt>${k}</dt><dd>${x}</dd></div>`)}</dl>
    ${e.duties ? html`<div class="wx-block"><span class="wx-label">${label('duties')}</span><p class="pre">${e.duties}</p></div>` : ''}
    ${e.accomplishments.length ? html`<div class="wx-block"><span class="wx-label">${label('accomplishments')}</span><ul>${e.accomplishments.map((x) => html`<li>${x}</li>`)}</ul></div>` : ''}
    ${edit || v.canVerify ? html`<div class="wx-tools">
      ${edit ? html`<button class="icon-btn" data-up="${e.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${e.position} up" title="Move up">${icon('up', 16)}</button>
        <button class="icon-btn" data-down="${e.id}" ${i === n - 1 ? 'disabled' : ''} aria-label="Move ${e.position} down" title="Move down">${icon('down', 16)}</button>
        <button class="btn sm" data-edit="${e.id}">${icon('edit', 14)} Edit</button>
        <button class="btn sm ghost danger" data-remove="${e.id}">${icon('trash', 14)} Remove</button>` : ''}
      ${v.canVerify && !opts.own ? (e.verified ? html`<button class="btn sm ghost" data-unverify="${e.id}">Mark not verified</button>` : html`<button class="btn sm primary" data-verify="${e.id}">${icon('check', 14)} Verify</button>`) : ''}
    </div>` : ''}
  </li>`;
}

// The card. opts: { base (the API path of the list), own (the person's own list), sheetHref (the
// printed sheet), importable (HR: CSV import), title, intro }.
export async function workExperienceCard(box, opts) {
  const v = await api.get(opts.base);
  const n = v.entries.length;
  const intro = opts.intro ?? (opts.own
    ? 'Your work experience, as on the Personal Data Sheet. The Work Experience Sheet is printed from it, newest first. HR verifies each entry; an entry you change after it was verified waits for HR again.'
    : `${v.owner.name}'s work experience. The Work Experience Sheet is printed from it, newest first.${v.canVerify ? ' Verify each entry against the certificates of employment or service records; an entry changed after it was verified is not verified any more.' : ''}`);
  mount(box, html`
    <div class="card-head"><h2>${icon('briefcase')} ${opts.title || 'Work experience'}</h2>
      <span class="actions">${n ? html`<span class="muted small">${v.verified} of ${n} verified</span>` : ''}
        ${opts.importable && v.canEdit ? html`<button class="btn sm" id="wx-import">${icon('upload', 14)} Import CSV</button>` : ''}
        ${opts.sheetHref ? html`<a class="btn sm" href="#${opts.sheetHref}">${icon('file', 14)} Work Experience Sheet</a>` : ''}</span>
    </div>
    <p class="muted small">${intro}</p>
    ${v.lockedReason ? html`<div class="notice info">${icon('lock', 16)}<p>${v.lockedReason}</p></div>` : ''}
    ${n ? html`<ol class="wx-list">${v.entries.map((e, i) => entryItem(e, i, n, v, opts))}</ol>` : html`<p class="muted wx-empty">No entries yet.${v.canEdit ? ' Add each position held, starting with any one; the sheet puts them newest first.' : ''}</p>`}
    ${v.canEdit ? html`<div class="wx-add"><button class="btn" id="wx-add" ${n >= v.max ? 'disabled' : ''}>${icon('plus', 16)} ${n ? 'Add another entry' : 'Add an entry'}</button>${n >= v.max ? html`<span class="muted small">At most ${v.max} entries.</span>` : ''}</div>` : ''}`);
  const reload = () => workExperienceCard(box, opts);
  const find = (id) => v.entries.find((e) => e.id === id);
  box.querySelector('#wx-add')?.addEventListener('click', () => entryForm(opts.base, null, reload, v.today));
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => entryForm(opts.base, find(b.dataset.edit), reload, v.today)));
  box.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const e = find(b.dataset.remove);
    if (!(await confirmDialog(`Remove ${e.position} (${durationText(e)})?`, { confirmLabel: 'Remove', title: 'Remove an entry' }))) return;
    await api.del(`${opts.base}/${e.id}`);
    toast('Entry removed.');
    reload();
  }));
  const move = async (id, by) => {
    const ids = v.entries.map((e) => e.id);
    const i = ids.indexOf(id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    await api.post(`${opts.base}/order`, { ids });
    reload();
  };
  box.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => move(b.dataset.up, -1)));
  box.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => move(b.dataset.down, 1)));
  const verify = async (id, verified) => {
    try {
      await api.post(`${opts.verifyBase || opts.base}/${id}/verify`, { verified });
      toast(verified ? 'Entry verified.' : 'Entry marked not verified.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  box.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', () => verify(b.dataset.verify, true)));
  box.querySelectorAll('[data-unverify]').forEach((b) => b.addEventListener('click', () => verify(b.dataset.unverify, false)));
  box.querySelector('#wx-import')?.addEventListener('click', () => importDialog(opts.base, v, reload));
}

// The form for one entry: the dates (or Present), the position and where, the PDS columns, the
// duties, and the accomplishments one per line with "Add another accomplishment" at the end.
function entryForm(base, e, done, day) {
  const x = e || { from: '', to: '', present: false, government: true, accomplishments: [] };
  const sg = (k, n, val) => html`<select name="${k}"><option value="">—</option>${Array.from({ length: n }, (_, i) => html`<option value="${i + 1}" ${Number(val) === i + 1 ? 'selected' : ''}>${k === 'salaryGrade' ? `SG ${i + 1}` : `Step ${i + 1}`}</option>`)}</select>`;
  const line = (val = '') => html`<li class="wx-acc"><input name="acc" value="${val}" maxlength="${LIMITS.accomplishment}" aria-label="Accomplishment" /><button type="button" class="icon-btn" data-drop aria-label="Remove this accomplishment">${icon('x', 14)}</button></li>`;
  const { form } = modal({
    title: e ? 'Edit an entry' : 'Add a work experience entry',
    subtitle: e?.verified ? `Verified by ${e.verified.by}. Changing it marks it not verified until HR checks it again.` : 'From, the position title and the agency are needed; the rest as far as you know them.',
    wide: true,
    submitLabel: e ? 'Save' : 'Add',
    body: html`<div class="grid wx-form">
      <label class="field"><span>${label('from')}</span><input type="date" name="from" value="${x.from}" min="${EARLIEST}" max="${day}" required /></label>
      <label class="field"><span>${label('to')}</span><input type="date" name="to" value="${x.to}" min="${EARLIEST}" max="${day}" ${x.present ? 'disabled' : ''} /><span class="hint">${hint('to')}</span></label>
      <label class="field check wx-present"><input type="checkbox" name="present" ${x.present ? 'checked' : ''} /> <span>Present (I hold this position now)</span></label>
      <label class="field span-3"><span>${label('position')}</span><input name="position" value="${x.position || ''}" maxlength="${LIMITS.text}" required /><span class="hint">${hint('position')}</span></label>
      <label class="field"><span>${label('office')}</span><input name="office" value="${x.office || ''}" maxlength="${LIMITS.text}" /><span class="hint">${hint('office')}</span></label>
      <label class="field"><span>${label('agency')}</span><input name="agency" value="${x.agency || ''}" maxlength="${LIMITS.text}" required /><span class="hint">${hint('agency')}</span></label>
      <label class="field"><span>${label('location')}</span><input name="location" value="${x.location || ''}" maxlength="${LIMITS.text}" /><span class="hint">${hint('location')}</span></label>
      <label class="field"><span>${label('supervisor')}</span><input name="supervisor" value="${x.supervisor || ''}" maxlength="${LIMITS.text}" /><span class="hint">${hint('supervisor')}</span></label>
      <label class="field"><span>${label('appointmentStatus')}</span><input name="appointmentStatus" value="${x.appointmentStatus || ''}" maxlength="${LIMITS.text}" list="wx-statuses" /><datalist id="wx-statuses">${STATUS_SUGGESTIONS.map((s) => html`<option value="${s}"></option>`)}</datalist></label>
      <div class="field"><span>${label('government')}</span><span class="seg" role="radiogroup" aria-label="${label('government')}"><label><input type="radio" name="government" value="true" ${x.government ? 'checked' : ''} /> Yes</label><label><input type="radio" name="government" value="false" ${x.government ? '' : 'checked'} /> No</label></span></div>
      <label class="field"><span>${label('salaryGrade')} ${confirmTag}</span>${sg('salaryGrade', 33, x.salaryGrade)}<span class="hint">Optional. Government positions only.</span></label>
      <label class="field"><span>${label('step')}</span>${sg('step', 8, x.step)}</label>
      <label class="field"><span>${label('monthlySalary')}</span><input type="number" name="monthlySalary" min="0" step="0.01" value="${x.monthlySalary ?? ''}" /><span class="hint">Optional.</span></label>
      <label class="field span-3"><span>${label('duties')}</span><textarea name="duties" rows="4" maxlength="${LIMITS.duties}">${x.duties || ''}</textarea><span class="hint">What you actually did in the position, in a few sentences.</span></label>
      <div class="field span-3"><span>${label('accomplishments')}</span>
        <ul class="wx-accs">${(x.accomplishments.length ? x.accomplishments : ['']).map((a) => line(a))}</ul>
        <button type="button" class="btn sm" id="wx-acc-add">${icon('plus', 14)} Add another accomplishment</button>
        <span class="hint">One on each line. Leave it empty if none.</span>
      </div>
    </div>`,
    async onSubmit(f) {
      const fd = new FormData(f);
      const body = {
        from: fd.get('from'), to: fd.get('to') || '', present: f.present.checked, position: fd.get('position'), office: fd.get('office'), agency: fd.get('agency'), location: fd.get('location'),
        supervisor: fd.get('supervisor'), appointmentStatus: fd.get('appointmentStatus'), government: fd.get('government') === 'true', salaryGrade: fd.get('salaryGrade'), step: fd.get('step'),
        monthlySalary: fd.get('monthlySalary'), duties: fd.get('duties'), accomplishments: fd.getAll('acc').map((s) => s.trim()).filter(Boolean),
      };
      if (e) await api.put(`${base}/${e.id}`, body);
      else await api.post(base, body);
      toast(e ? (e.verified ? 'Entry saved. It waits for HR to verify it again.' : 'Entry saved.') : 'Entry added.');
      done();
    },
  });
  const present = form.querySelector('[name=present]');
  const to = form.querySelector('[name=to]');
  present.addEventListener('change', () => {
    to.disabled = present.checked;
    if (present.checked) to.value = '';
  });
  form.querySelector('[name=from]').addEventListener('change', (ev) => (to.min = ev.target.value || EARLIEST));
  const list = form.querySelector('.wx-accs');
  form.querySelector('#wx-acc-add').addEventListener('click', () => {
    if (list.children.length >= LIMITS.accomplishments) return toast(`At most ${LIMITS.accomplishments} accomplishments.`, 'error');
    list.insertAdjacentHTML('beforeend', String(line()));
    list.lastElementChild.querySelector('input').focus();
  });
  list.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-drop]');
    if (!b) return;
    if (list.children.length === 1) b.closest('li').querySelector('input').value = '';
    else b.closest('li').remove();
  });
}

// HR: a long history from a CSV file (all rows or none), with a template to fill in.
function importDialog(base, v, done) {
  let csv = '';
  const { form } = modal({
    title: 'Import work experience from a CSV file',
    subtitle: `${v.owner.name} · added after the ${v.entries.length} entr${v.entries.length === 1 ? 'y' : 'ies'} already there, not verified`,
    submitLabel: 'Import',
    body: html`<p class="small">One row per position. The first row names the columns: <strong>From</strong>, <strong>To</strong> (or <code>Present</code>), <strong>Position title</strong> and <strong>Agency or organization</strong> are needed; the others are optional. Dates as <code>YYYY-MM-DD</code>; accomplishments separated by <code>;</code>.</p>
      <p><button type="button" class="btn sm" id="wx-template">${icon('download', 14)} Download the template</button></p>
      <label class="field"><span>CSV file</span><input type="file" name="file" accept=".csv,text/csv" required /></label>
      <div id="wx-preview" class="small"></div>`,
    async onSubmit() {
      if (!csv) throw new Error('Pick the CSV file.');
      const r = await api.post(`${base}/import`, { csv });
      toast(`${r.imported} entr${r.imported === 1 ? 'y' : 'ies'} imported.`);
      done();
    },
  });
  form.querySelector('#wx-template').addEventListener('click', () => downloadFile('work-experience-template.csv', csvTemplate()));
  form.querySelector('[name=file]').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    const out = form.querySelector('#wx-preview');
    csv = file ? await file.text() : '';
    if (!csv) return mount(out, '');
    const { rows, error } = parseCsv(csv);
    const { entries, errors } = error ? { entries: [], errors: [error] } : entriesFromCsv(rows, v.today);
    mount(out, errors.length
      ? html`<div class="notice bad"><p><strong>Fix these first; nothing is imported until every row is right:</strong></p><ul>${errors.slice(0, 8).map((x) => html`<li>${x}</li>`)}</ul></div>`
      : html`<p class="notice info">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} ready: ${entries.map((x) => x.position).join(', ')}.</p>`);
  });
}

// ----- The Work Experience Sheet (A4, newest first) -----
// opts: { url (the sheet's API path), back (breadcrumbs), edit (where the entries are kept) }.
export async function workExperienceSheetView(el, opts) {
  const s = await api.get(opts.url);
  const logo = ctx.info.branding?.logo || '';
  const entryRow = (e) => html`<tr class="wes-row" data-id="${e.id}"><td>
    <div class="wes-entry">
      <dl>
        <div><dt>Duration</dt><dd>${durationText(e)}</dd></div>
        <div><dt>Position</dt><dd><strong>${e.position}</strong></dd></div>
        <div><dt>Name of office or unit</dt><dd>${e.office || '—'}</dd></div>
        <div><dt>Immediate supervisor</dt><dd>${e.supervisor || '—'}</dd></div>
        <div><dt>Name of agency or organization and location</dt><dd>${[e.agency, e.location].filter(Boolean).join(', ')}</dd></div>
      </dl>
      <div class="wes-sub"><span>List of accomplishments and contributions (if any)</span>${e.accomplishments.length ? html`<ul>${e.accomplishments.map((x) => html`<li>${x}</li>`)}</ul>` : html`<p class="muted">None given.</p>`}</div>
      <div class="wes-sub"><span>Summary of actual duties</span><p class="pre">${e.duties || '—'}</p></div>
    </div>
  </td></tr>`;
  mount(el, html`
    <div class="no-print">
      ${pageHead('Work Experience Sheet', s.person.name, html`<button class="btn primary" id="do-print" ${s.entries.length ? '' : 'disabled'}>${icon('file', 16)} Print</button>`, opts.back)}
      <div class="card toolbar wes-tools">
        <span class="small">Shown as it prints, on A4: newest first, the school's header on every page. Untick an entry to leave it off this copy (for example, work not relevant to the position).</span>
        ${s.entries.length ? html`<div class="wes-picks">${s.entries.map((e) => html`<label class="check-inline"><input type="checkbox" data-pick="${e.id}" checked /> ${e.position} <span class="muted">(${durationText(e)})</span></label>`)}</div>` : ''}
        ${opts.edit ? html`<a class="small" href="#${opts.edit}">${icon('edit', 12)} Change the entries</a>` : ''}
      </div>
    </div>
    ${s.entries.length ? html`<article class="as-doc wes-doc">
      <table class="wes-sheet">
        <thead><tr><td>
          <header class="as-head">${logo ? html`<img src="${logo}" alt="" />` : ''}<div><strong class="as-school">${s.school.name}</strong>${s.school.address ? html`<span>${s.school.address}</span>` : ''}<strong class="as-title">Work Experience Sheet</strong></div></header>
          <div class="wes-name"><span>Name:</span> <strong>${s.person.name}</strong></div>
        </td></tr></thead>
        <tbody>
          ${s.entries.map(entryRow)}
          <tr class="wes-end-row"><td><p class="wes-end">— Nothing follows —</p></td></tr>
          <tr class="wes-sign-row"><td>
            <div class="wes-signs">
              <div class="as-sign"><span class="as-sign-line">${s.person.name}</span><span class="as-sign-title">Signature over printed name</span></div>
              <div class="as-sign wes-date"><span class="as-sign-line"></span><span class="as-sign-title">Date</span></div>
            </div>
            <p class="as-foot">Work Experience Sheet from ${brandProduct('People')}, printed ${fmtDateTime(s.printedAt)} by ${s.printedBy}. Layout to confirm against CSC's current form.</p>
          </td></tr>
        </tbody>
      </table>
    </article>` : html`<div class="card empty">${icon('briefcase', 40)}<h2>No work experience yet</h2><p>Add the entries first${opts.edit ? html`: <a href="#${opts.edit}">open them</a>` : ''}.</p></div>`}`);
  el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('change', () => {
    el.querySelector(`.wes-row[data-id="${b.dataset.pick}"]`).hidden = !b.checked;
    el.querySelector('#do-print').disabled = !el.querySelector('[data-pick]:checked');
  }));
  el.querySelector('#do-print')?.addEventListener('click', () => window.print());
}

// People → My work experience (a job applicant).
export async function myWorkExperienceView(el) {
  mount(el, html`${pageHead('My work experience', 'The positions you have held, for the Personal Data Sheet and the Work Experience Sheet HR reads with your applications.')}<section class="card" id="wx"></section>`);
  await workExperienceCard(el.querySelector('#wx'), { base: '/api/hris/me/work-experience', own: true, sheetHref: '/jobs/experience/sheet' });
}
