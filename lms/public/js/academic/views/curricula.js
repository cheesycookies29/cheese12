// Curricula: each program's prospectus by series, built year by year and term by term from
// the course catalog. Drafts are edited; posting locks a curriculum so students' evaluations
// stay stable; a new series starts as a copy.
import { api } from '../../api.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, badge, toast, modal, option, confirmDialog, formData, fmtDate } from '../../ui.js';
import { TERMS, termLabel, termOrder, yearLabel } from '/shared/academic.js';
import { can, clickableRows, isStudent } from '../state.js';

const STATUS = { draft: ['Draft', 'amber'], posted: ['Posted', 'green'], retired: ['Retired', 'gray'] };
const statusBadge = (s) => badge(...STATUS[s]);

export async function curriculumListView(el) {
  const [list, programs] = await Promise.all([api.get('/api/academic/curricula'), api.get('/api/academic/programs')]);
  const edit = can('academic.curricula');
  mount(el, html`
    ${pageHead('Curricula', isStudent() ? 'The posted curriculum (prospectus) of each program.' : 'Each program\'s prospectus by series. Students are evaluated against the curriculum assigned to them.', edit ? html`<button class="btn primary" id="new">${icon('plus', 16)} New curriculum</button>` : '')}
    ${list.length ? html`<div class="card"><table class="table clickable">
      <thead><tr><th>Curriculum</th><th>Program</th><th>College</th><th class="num">Subjects</th><th class="num">Units</th><th class="num">Students</th><th>Status</th></tr></thead>
      <tbody>${list.map((c) => html`<tr data-href="#/curricula/${c.id}">
        <td><strong>${c.code} ${c.series}</strong>${c.major ? html`<small>${c.major}</small>` : ''}</td>
        <td>${c.program?.code}<small>${c.program?.name}</small></td>
        <td>${c.college || html`<span class="muted">—</span>`}</td>
        <td class="num">${c.subjects}</td><td class="num">${c.units}</td><td class="num">${c.students}</td>
        <td>${statusBadge(c.status)}${c.postedAt ? html`<small>${fmtDate(c.postedAt.slice(0, 10))}</small>` : ''}</td>
      </tr>`)}</tbody></table></div>`
      : html`<div class="card empty">${icon('layers', 40)}<h2>No curricula yet</h2><p>${edit ? 'Create the first one: pick a program and a series (e.g. 2026), then add subjects term by term.' : 'None are posted yet.'}</p></div>`}`);
  clickableRows(el);
  el.querySelector('#new')?.addEventListener('click', () => modal({
    title: 'New curriculum',
    submitLabel: 'Create',
    body: html`<div class="grid two">
      <label class="field span-2"><span>Program</span><select name="programId" required>${option('', 'Choose…')}${programs.map((p) => option(p.id, `${p.code} · ${p.name}`))}</select></label>
      <label class="field"><span>Series</span><input name="series" required placeholder="e.g. 2026" /><span class="hint">The year it takes effect.</span></label>
      <label class="field"><span>Code</span><input name="code" placeholder="Same as the program" /></label>
      <label class="field"><span>Major (optional)</span><input name="major" /></label>
      <label class="field"><span>Years</span><input name="years" type="number" min="1" max="6" value="4" /></label>
      <label class="field span-2"><span>Start from</span><select name="copyFrom">${option('', 'Empty terms')}${list.map((c) => option(c.id, `A copy of ${c.code} ${c.series}${c.major ? ` · ${c.major}` : ''}`))}</select></label>
    </div>`,
    async onSubmit(form) {
      const c = await api.post('/api/academic/curricula', formData(form));
      toast('Curriculum created as a draft.');
      location.hash = `#/curricula/${c.id}`;
    },
  }));
}

export async function curriculumView(el, params) {
  const [c, courses] = await Promise.all([api.get(`/api/academic/curricula/${params.id}`), can('academic.curricula') ? api.get('/api/academic/courses') : []]);
  const draft = c.status === 'draft' && can('academic.curricula');
  const terms = c.terms.map((t) => ({ year: t.year, term: t.term, courseIds: t.courses.map((x) => x.id) }));
  const used = new Set(terms.flatMap((t) => t.courseIds));
  const reload = () => curriculumView(el, params);
  async function saveTerms(next) {
    try {
      await api.put(`/api/academic/curricula/${c.id}`, { terms: next });
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  const forProgram = courses.filter((x) => !used.has(x.id)).sort((a, b) => Number(b.programIds.includes(c.program?.id)) - Number(a.programIds.includes(c.program?.id)) || a.code.localeCompare(b.code));
  const years = [...new Set(c.terms.map((t) => t.year))];
  const totalLab = c.terms.reduce((a, t) => a + t.courses.reduce((b, x) => b + x.labUnits, 0), 0);

  mount(el, html`
    ${pageHead(html`${c.code} ${c.series} ${statusBadge(c.status)}`, html`${c.program?.name || ''}${c.major ? ` · ${c.major}` : ''}${c.college ? ` · ${c.college}` : ''} · ${c.subjects} subjects · ${c.units} units${totalLab ? ` (${totalLab} lab)` : ''}`, html`
      <button class="btn" id="print">${icon('file', 16)} Print prospectus</button>
      ${can('academic.curricula') && c.status !== 'draft' ? html`<button class="btn" id="copy">${icon('layers', 16)} New series from this</button>` : ''}
      ${can('academic.curricula') && c.status === 'posted' ? html`<button class="btn danger ghost" id="retire">Retire</button>` : ''}
      ${draft ? html`<button class="btn danger ghost" id="delete">${icon('trash', 16)} Delete draft</button><button class="btn primary" id="post">${icon('check', 16)} Post</button>` : ''}`, ['/curricula', 'Curricula'])}
    ${draft ? html`<div class="notice info no-print">${icon('edit')}<p><strong>Draft.</strong> Add subjects to each term. Posting locks the curriculum so student evaluations stay stable; later changes go into a new series.</p></div>` : ''}
    ${c.warnings?.length ? html`<div class="notice bad">${icon('flag')}<div><strong>Check the order of prerequisites</strong><ul class="tight">${c.warnings.map((w) => html`<li>${w}</li>`)}</ul></div></div>` : ''}
    <div class="print-only print-head"><strong>${c.program?.name}</strong><span>Curriculum ${c.code} ${c.series}${c.major ? ` · Major in ${c.major}` : ''}</span></div>
    <div class="prospectus">${years.map((y) => c.terms.filter((t) => t.year === y).map((t, i) => html`
      <section class="pro-term">
        <header><strong>${yearLabel(t.year)} · ${termLabel(t.term)}</strong><span class="muted">${t.courses.reduce((a, x) => a + x.units, 0)} units</span>
          ${draft && !t.courses.length ? html`<button class="icon-btn no-print" data-drop-term="${t.year}-${t.term}" aria-label="Remove this term">${icon('x', 14)}</button>` : ''}</header>
        <table class="table compact">
          <thead><tr><th>Code</th><th>Descriptive title</th><th class="num">Units</th><th class="num">Lab</th><th>Prerequisite</th>${draft ? html`<th class="no-print"></th>` : ''}</tr></thead>
          <tbody>${t.courses.map((x) => html`<tr>
            <td><strong>${x.code}</strong></td><td>${x.title}</td><td class="num">${x.units}</td>
            <td class="num">${can('academic.curricula') ? html`<input class="lab-in no-print" type="number" min="0" max="${x.units}" step="1" value="${x.labUnits}" data-lab="${x.id}" aria-label="Laboratory units of ${x.code}" /><span class="print-only">${x.labUnits || ''}</span>` : x.labUnits || ''}</td>
            <td>${x.prereqs.length ? x.prereqs.map((p) => html`<span class="pre ${p.ok ? 'met' : 'bad'}">${p.code}</span> `) : html`<span class="muted">None</span>`}</td>
            ${draft ? html`<td class="no-print"><button class="icon-btn danger" data-remove="${x.id}" aria-label="Remove ${x.code}">${icon('x', 14)}</button></td>` : ''}
          </tr>`)}
          ${!t.courses.length ? html`<tr><td colspan="${draft ? 6 : 5}" class="muted">No subjects yet.</td></tr>` : ''}</tbody>
        </table>
        ${draft ? html`<div class="add-sub no-print"><select data-add="${t.year}-${t.term}" aria-label="Add a subject to ${yearLabel(t.year)}, ${termLabel(t.term)}">${option('', '+ Add a subject…')}${forProgram.map((x) => option(x.id, `${x.code} · ${x.title} (${x.units})`))}</select></div>` : ''}
      </section>`))}</div>
    ${draft ? html`<div class="card no-print add-term"><strong>Add a term</strong>
      <select id="new-year" aria-label="Year level">${[1, 2, 3, 4, 5, 6].map((y) => option(String(y), yearLabel(y)))}</select>
      <select id="new-term" aria-label="Term">${TERMS.map((t) => option(t.id, t.label))}</select>
      <button class="btn" id="add-term">${icon('plus', 16)} Add</button></div>` : ''}`);

  el.querySelector('#print').addEventListener('click', () => window.print());
  el.onchange = async (e) => { // assigned, not added: the view redraws itself into the same element
    if (e.target.dataset.add) {
      const [y, t] = e.target.dataset.add.split('-');
      saveTerms(terms.map((x) => (String(x.year) === y && x.term === t ? { ...x, courseIds: [...x.courseIds, e.target.value] } : x)));
    }
    if (e.target.dataset.lab) {
      try {
        await api.put(`/api/academic/courses/${e.target.dataset.lab}`, { labUnits: e.target.value });
        toast('Laboratory units saved.');
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  };
  el.onclick = async (e) => { // assigned, not added: the view redraws itself into the same element
    const rm = e.target.closest('[data-remove]')?.dataset.remove;
    if (rm) saveTerms(terms.map((x) => ({ ...x, courseIds: x.courseIds.filter((id) => id !== rm) })));
    const drop = e.target.closest('[data-drop-term]')?.dataset.dropTerm;
    if (drop) saveTerms(terms.filter((x) => `${x.year}-${x.term}` !== drop));
  };
  el.querySelector('#add-term')?.addEventListener('click', () => {
    const year = Number(el.querySelector('#new-year').value);
    const term = el.querySelector('#new-term').value;
    if (terms.some((t) => t.year === year && t.term === term)) return toast(`${yearLabel(year)}, ${termLabel(term)} is already there.`, 'error');
    saveTerms([...terms, { year, term, courseIds: [] }].sort((a, b) => a.year - b.year || termOrder(a.term) - termOrder(b.term)));
  });
  el.querySelector('#post')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Post ${c.code} ${c.series}? It is locked once posted; changes later go into a new series.${c.warnings?.length ? ` There ${c.warnings.length === 1 ? 'is 1 prerequisite warning' : `are ${c.warnings.length} prerequisite warnings`}.` : ''}`, { confirmLabel: 'Post', danger: false, title: 'Post curriculum' }))) return;
    try {
      await api.post(`/api/academic/curricula/${c.id}/post`);
      toast('Curriculum posted.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#retire')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Retire ${c.code} ${c.series}? Students already on it keep it; it can no longer be assigned.`, { confirmLabel: 'Retire' }))) return;
    await api.post(`/api/academic/curricula/${c.id}/retire`);
    reload();
  });
  el.querySelector('#delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete the draft ${c.code} ${c.series}?`))) return;
    try {
      await api.del(`/api/academic/curricula/${c.id}`);
      location.hash = '#/curricula';
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#copy')?.addEventListener('click', () => modal({
    title: `New series from ${c.code} ${c.series}`,
    submitLabel: 'Create draft',
    body: html`<label class="field"><span>New series</span><input name="series" required placeholder="e.g. ${Number(c.series) ? Number(c.series) + 1 : '2027'}" /></label>`,
    async onSubmit(form) {
      const n = await api.post('/api/academic/curricula', { programId: c.program.id, code: c.code, major: c.major, series: formData(form).series, copyFrom: c.id });
      location.hash = `#/curricula/${n.id}`;
    },
  }));
}
