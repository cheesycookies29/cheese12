// Academic settings: the grading scale, admission requirements by student type, document
// fees and the registrar's signature line, INC and dean's-list rules, and colleges.
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, toast, modal, option, formData, confirmDialog } from '../../ui.js';
import { STUDENT_TYPES, DOCUMENT_TYPES, fmtGrade, DEFAULT_SCALE, DEFAULT_ACADEMIC_SETTINGS } from '/shared/academic.js';
import { ac, can } from '../state.js';

export async function settingsView(el) {
  const [s, colleges, programs] = await Promise.all([api.get('/api/academic/settings'), api.get('/api/academic/colleges'), api.get('/api/academic/programs')]);
  const edit = can('academic.settings');
  const dis = edit ? '' : 'disabled';
  const reload = () => settingsView(el);
  const save = async (body, msg = 'Settings saved.') => {
    try {
      await api.put('/api/academic/settings', body);
      await ac.refreshSettings();
      toast(msg);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const scale = [...s.scale].sort((a, b) => b.min - a.min);
  const pass = fmtGrade(s.passingGrade ?? 3);
  // Learn and Academic must agree on where passing starts.
  const mismatch = s.scalePassing != null && s.learnPassing != null && Number(s.scalePassing) !== Number(s.learnPassing);
  mount(el, html`
    ${pageHead('Academic settings', 'Rules used across Academic. Changes apply from now on; posted grades keep the equivalent they were posted with.')}
    ${!edit ? html`<div class="notice info">${icon('lock')}<p>Only the registrar and administrators change these settings. You can manage colleges below.</p></div>` : ''}
    <div class="cols">
      <form class="card" id="scale">
        <div class="card-head"><h2>${icon('chart')} Grading scale</h2></div>
        <p class="muted small">From the final percentage to the grade on the record. ${pass} is the lowest passing grade; worse grades fail.</p>
        ${mismatch ? html`<div class="notice warn">${icon('flag')}<p>Learn passes a final grade from <strong>${s.learnPassing}%</strong> (Admin panel → Settings), but on this scale passing starts at <strong>${s.scalePassing}%</strong>. Make them the same so Learn and the permanent record agree.</p></div>` : ''}
        <label class="field" style="max-width:220px"><span>Lowest passing grade</span><input type="number" name="passingGrade" value="${pass}" min="1" max="5" step="0.25" ${dis} /></label>
        <table class="table compact"><thead><tr><th>From (%)</th><th>Grade</th><th>Description</th>${edit ? html`<th></th>` : ''}</tr></thead>
          <tbody>${scale.map((b, i) => html`<tr data-i="${i}"><td><input type="number" name="min-${i}" value="${b.min}" min="0" max="100" step="0.01" ${dis} aria-label="From (%)" /></td><td><input type="number" name="grade-${i}" value="${fmtGrade(b.grade)}" min="1" max="5" step="0.25" ${dis} aria-label="Grade" /></td><td><input name="remark-${i}" value="${b.remark}" ${dis} aria-label="Description" /></td>
            ${edit ? html`<td><button type="button" class="icon-btn danger" data-del-band="${i}" aria-label="Remove the band from ${b.min}%">${icon('x', 14)}</button></td>` : ''}</tr>`)}</tbody></table>
        ${edit ? html`<div class="actions"><button type="button" class="btn sm" id="add-band">${icon('plus', 14)} Add a band</button><button type="button" class="btn sm ghost" id="default-scale">Restore the default scale</button><span class="spacer"></span><button class="btn primary" type="submit">Save scale</button></div>` : ''}
      </form>
      <div class="stack">
        <form class="card" id="rules">
          <div class="card-head"><h2>${icon('settings')} Rules and signatory</h2></div>
          <div class="grid two">
            <label class="field"><span>INC deadline (days after posting)</span><input type="number" name="incDays" value="${s.incDays}" min="30" max="1000" ${dis} /></label>
            <label class="field"><span>Dean's list: GWA at most</span><input type="number" name="maxGwa" value="${s.honors.maxGwa}" step="0.05" min="1" max="5" ${dis} /></label>
            <label class="field"><span>No grade lower than</span><input type="number" name="worstGrade" value="${s.honors.worstGrade}" step="0.25" min="1" max="5" ${dis} /></label>
            <label class="field"><span>At least (units)</span><input type="number" name="minUnits" value="${s.honors.minUnits}" min="0" max="60" ${dis} /></label>
            <label class="field"><span>Registrar's name (signature line)</span><input name="regName" value="${s.registrar.name}" ${dis} /></label>
            <label class="field"><span>Title</span><input name="regTitle" value="${s.registrar.title}" ${dis} /></label>
          </div>
          <h3 class="sub-h">Document fees (₱ per copy)</h3>
          <div class="grid three">${DOCUMENT_TYPES.map((d) => html`<label class="field"><span>${d.short} · ${d.label}</span><input type="number" min="0" name="fee-${d.id}" value="${s.fees[d.id]}" ${dis} /></label>`)}</div>
          ${edit ? html`<div class="actions end"><button class="btn primary" type="submit">Save</button></div>` : ''}
        </form>
      </div>
    </div>
    <form class="card" id="reqs">
      <div class="card-head"><h2>${icon('inbox')} Admission requirements</h2>${edit ? html`<button type="button" class="btn sm" id="add-req">${icon('plus', 14)} Add</button>` : ''}</div>
      <p class="muted small">Tick the student types that must submit each one. The registrar checks them off on each student's record.</p>
      <div class="table-scroll"><table class="table compact"><thead><tr><th>Requirement</th>${STUDENT_TYPES.map(([, l]) => html`<th class="center">${l}</th>`)}${edit ? html`<th></th>` : ''}</tr></thead>
        <tbody>${s.requirements.map((r, i) => html`<tr data-i="${i}"><td><input name="name-${i}" value="${r.name}" ${dis} aria-label="Requirement" /><input type="hidden" name="id-${i}" value="${r.id}" /></td>
          ${STUDENT_TYPES.map(([k, l]) => html`<td class="center"><input type="checkbox" name="for-${i}-${k}" ${r.for.includes(k) ? 'checked' : ''} ${dis} aria-label="${l}" /></td>`)}
          ${edit ? html`<td><button type="button" class="icon-btn danger" data-del="${i}" aria-label="Remove">${icon('x', 14)}</button></td>` : ''}</tr>`)}</tbody></table></div>
      ${edit ? html`<div class="actions end"><button class="btn primary" type="submit">Save requirements</button></div>` : ''}
    </form>
    <section class="card">
      <div class="card-head"><h2>${icon('building')} Colleges</h2>${can('academic.curricula') ? html`<button class="btn sm" id="add-college">${icon('plus', 14)} Add college</button>` : ''}</div>
      ${colleges.length ? html`<table class="table compact"><thead><tr><th>Code</th><th>College</th><th>Dean</th><th>Programs</th>${can('academic.curricula') ? html`<th></th>` : ''}</tr></thead>
        <tbody>${colleges.map((c) => html`<tr><td><strong>${c.code}</strong></td><td>${c.name}</td><td>${c.dean || html`<span class="muted">—</span>`}</td><td>${c.programs.join(', ') || html`<span class="muted">None</span>`}</td>
          ${can('academic.curricula') ? html`<td class="row-actions"><button class="btn sm" data-college="${c.id}">Edit</button><button class="btn sm danger ghost" data-remove-college="${c.id}">Remove</button></td>` : ''}</tr>`)}</tbody></table>`
        : html`<p class="muted">No colleges yet. Colleges group programs (e.g. College of Engineering and Food Science: BSABE).</p>`}
    </section>`);

  const scaleForm = el.querySelector('#scale');
  const readScale = () => {
    const v = formData(scaleForm);
    return [...scaleForm.querySelectorAll('tbody tr')].map((tr) => tr.dataset.i).map((i) => ({ min: v[`min-${i}`], grade: v[`grade-${i}`], remark: v[`remark-${i}`] }));
  };
  scaleForm.addEventListener('submit', (e) => {
    e.preventDefault();
    save({ passingGrade: formData(scaleForm).passingGrade, scale: readScale() }, 'Grading scale saved.');
  });
  scaleForm.addEventListener('click', async (e) => {
    const i = e.target.closest('[data-del-band]')?.dataset.delBand;
    if (i != null) e.target.closest('tr').remove();
    if (e.target.closest('#add-band')) {
      const tbody = scaleForm.querySelector('tbody');
      const n = Date.now();
      tbody.insertAdjacentHTML('beforeend', `<tr data-i="${n}"><td><input type="number" name="min-${n}" min="0" max="100" step="0.01" aria-label="From (%)" required /></td><td><input type="number" name="grade-${n}" min="1" max="5" step="0.25" aria-label="Grade" required /></td><td><input name="remark-${n}" aria-label="Description" /></td><td><button type="button" class="icon-btn danger" data-del-band="${n}" aria-label="Remove this band">×</button></td></tr>`);
      tbody.querySelector(`[name=min-${n}]`).focus();
    }
    if (e.target.closest('#default-scale') && (await confirmDialog('Put back the default scale (1.00 from 97% down to 5.00 below 75%, passing at 3.00)? Posted grades keep their equivalent.', { confirmLabel: 'Restore' }))) {
      save({ passingGrade: DEFAULT_ACADEMIC_SETTINGS.passingGrade, scale: DEFAULT_SCALE }, 'Default scale restored.');
    }
  });
  el.querySelector('#rules').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formData(e.target);
    save({
      incDays: v.incDays, honors: { maxGwa: v.maxGwa, worstGrade: v.worstGrade, minUnits: v.minUnits },
      registrar: { name: v.regName, title: v.regTitle }, fees: Object.fromEntries(DOCUMENT_TYPES.map((d) => [d.id, v[`fee-${d.id}`]])),
    });
  });
  const reqForm = el.querySelector('#reqs');
  const readReqs = () => {
    const v = new FormData(reqForm);
    return [...reqForm.querySelectorAll('tbody tr')].map((tr) => {
      const i = tr.dataset.i;
      return { id: v.get(`id-${i}`), name: v.get(`name-${i}`), for: STUDENT_TYPES.map(([k]) => k).filter((k) => v.get(`for-${i}-${k}`)) };
    });
  };
  reqForm.addEventListener('submit', (e) => {
    e.preventDefault();
    save({ requirements: readReqs() }, 'Requirements saved.');
  });
  reqForm.addEventListener('click', (e) => {
    const i = e.target.closest('[data-del]')?.dataset.del;
    if (i != null) save({ requirements: readReqs().filter((_, k) => String(k) !== i) }, 'Requirement removed.');
  });
  el.querySelector('#add-req')?.addEventListener('click', () => modal({
    title: 'Add a requirement', submitLabel: 'Add',
    body: html`<label class="field"><span>Requirement</span><input name="name" required placeholder="e.g. Barangay clearance" /></label>
      <fieldset class="field"><legend>Needed from</legend>${STUDENT_TYPES.map(([k, l]) => html`<label class="check-row"><input type="checkbox" name="${k}" checked /> ${l}</label>`)}</fieldset>`,
    onSubmit: (form) => {
      const v = formData(form);
      return save({ requirements: [...readReqs(), { name: v.name, for: STUDENT_TYPES.map(([k]) => k).filter((k) => v[k]) }] }, 'Requirement added.');
    },
  }));
  const collegeForm = (c = {}) => modal({
    title: c.id ? `Edit ${c.code}` : 'Add a college', submitLabel: c.id ? 'Save' : 'Add',
    body: html`<div class="grid two">
      <label class="field"><span>Code</span><input name="code" value="${c.code || ''}" required ${c.id ? 'disabled' : ''} placeholder="e.g. CEFS" /></label>
      <label class="field"><span>Dean</span><input name="dean" value="${c.dean || ''}" /></label>
      <label class="field span-2"><span>Name</span><input name="name" value="${c.name || ''}" required placeholder="e.g. College of Engineering and Food Science" /></label>
      <fieldset class="field span-2"><legend>Programs</legend>${programs.map((p) => html`<label class="check-row"><input type="checkbox" name="p-${p.id}" ${p.collegeId && p.collegeId === c.id ? 'checked' : ''} /> ${p.code} · ${p.name}${p.collegeId && p.collegeId !== c.id ? html` <small class="muted">(in another college)</small>` : ''}</label>`)}</fieldset>
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const programIds = programs.filter((p) => v[`p-${p.id}`]).map((p) => p.id);
      const saved = c.id ? c : await api.post('/api/academic/colleges', { code: v.code, name: v.name, dean: v.dean });
      await api.put(`/api/academic/colleges/${saved.id}`, { name: v.name, dean: v.dean, programIds });
      toast('College saved.');
      reload();
    },
  });
  el.querySelector('#add-college')?.addEventListener('click', () => collegeForm());
  el.onclick = async (e) => { // assigned, not added: the view redraws itself into the same element
    const id = e.target.dataset.college;
    if (id) collegeForm(colleges.find((c) => c.id === id));
    const rm = e.target.dataset.removeCollege;
    if (rm && (await confirmDialog('Remove this college? Its programs stay, without a college.', { confirmLabel: 'Remove' }))) {
      await api.del(`/api/academic/colleges/${rm}`);
      reload();
    }
  };
}
