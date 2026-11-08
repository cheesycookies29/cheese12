// Courses, terms and programs.
import { api } from '../../api.js';
import { html, mount, modal, toast, statusBadge, fmtDate, option, formData, confirmDialog, empty } from '../../ui.js';
import { pageHead, ctx } from '../../shell.js';
import { can } from '/shared/roles.js';
import { lookups, filterRows } from '../common.js';

const mayEdit = () => can(ctx.user.role, 'catalog.manage');

function wireCrud(el, { list, edit, del, redraw }) {
  el.querySelector('#add')?.addEventListener('click', () => edit(null));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => edit(list.find((x) => x.id === b.dataset.edit))));
  el.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
    const item = list.find((x) => x.id === b.dataset.delete);
    if (!(await confirmDialog(`Delete ${item.code || item.name}?`))) return;
    try {
      await api.del(`${del}/${item.id}`);
      toast('Deleted.');
      redraw();
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}

const rowActions = (x) => (mayEdit() ? html`<td class="row-actions"><button class="btn" data-edit="${x.id}">Edit</button><button class="btn danger ghost" data-delete="${x.id}">Delete</button></td>` : html`<td></td>`);

// ----- Courses -----
export async function coursesView(el) {
  const { courses, programs } = await lookups('courses', 'programs');
  const redraw = () => coursesView(el);
  mount(el, html`
    ${pageHead('Courses', 'The catalog. A course is offered in a term through one or more sections.', mayEdit() ? html`<button class="btn primary" id="add">+ Add course</button>` : '')}
    ${courses.length ? html`
      <div class="toolbar"><input type="search" placeholder="Search code or title" /><span class="spacer"></span><span class="muted" id="shown">${courses.length} shown</span></div>
      <div class="card scroll-x"><table class="table">
        <thead><tr><th>Course</th><th>Units</th><th>Prerequisites</th><th>Sections this term</th><th>Status</th><th></th></tr></thead>
        <tbody>${courses.map((c) => html`<tr><td><strong class="mono">${c.code}</strong> ${c.title}<small>${c.description}</small></td><td>${c.units}</td>
          <td>${c.prerequisiteCodes.length ? c.prerequisiteCodes.join(', ') : '—'}</td><td>${c.sections || '—'}</td><td>${statusBadge(c.status === 'retired' ? 'archived' : 'active', c.status)}</td>${rowActions(c)}</tr>`)}</tbody>
      </table></div>` : empty('No courses yet', 'Add the subjects your school offers, with their units and prerequisites.')}`);
  filterRows(el);
  wireCrud(el, {
    list: courses,
    del: '/api/admin/courses',
    redraw,
    edit: (c) => modal({
      title: c ? `Edit ${c.code}` : 'Add a course',
      wide: true,
      body: html`<div class="grid">
        <label class="field"><span>Code<em>*</em></span><input name="code" value="${c?.code || ''}" placeholder="e.g. IT101" required /></label>
        <label class="field span-2"><span>Title<em>*</em></span><input name="title" value="${c?.title || ''}" required /></label>
        <label class="field"><span>Units<em>*</em></span><input type="number" name="units" min="0.5" max="12" step="0.5" value="${c?.units ?? 3}" required /></label>
        <label class="field"><span>Status</span><select name="status">${option('active', 'Offered', c?.status !== 'retired')}${option('retired', 'Retired (no new sections)', c?.status === 'retired')}</select></label>
        <label class="field span-3"><span>Description</span><textarea name="description">${c?.description || ''}</textarea></label>
        <fieldset class="field span-3" style="border:0;padding:0;margin:0"><span>Prerequisites (must be passed first)</span>
          <div class="days">${courses.filter((x) => x.id !== c?.id).map((x) => html`<label><input type="checkbox" name="prereq" value="${x.id}" ${c?.prerequisites?.includes(x.id) ? 'checked' : ''} /> ${x.code}</label>`)}</div>
          ${courses.length <= (c ? 1 : 0) ? html`<span class="hint">Add more courses to pick prerequisites.</span>` : ''}
        </fieldset>
        ${programs.length ? html`<fieldset class="field span-3" style="border:0;padding:0;margin:0"><span>Programs that take this course</span>
          <div class="days">${programs.map((p) => html`<label><input type="checkbox" name="program" value="${p.id}" ${c?.programIds?.includes(p.id) ? 'checked' : ''} /> ${p.code}</label>`)}</div></fieldset>` : ''}
      </div>`,
      async onSubmit(form) {
        const v = formData(form);
        const body = { ...v, prerequisites: [...form.querySelectorAll('[name=prereq]:checked')].map((i) => i.value), programIds: [...form.querySelectorAll('[name=program]:checked')].map((i) => i.value) };
        await (c ? api.put(`/api/admin/courses/${c.id}`, body) : api.post('/api/admin/courses', body));
        toast('Saved.');
        redraw();
      },
    }),
  });
}

// ----- Terms -----
export async function termsView(el) {
  const terms = await api.get('/api/admin/terms');
  const redraw = () => termsView(el);
  mount(el, html`
    ${pageHead('Terms', 'Semesters or quarters. Students can request sections only while a term’s enrollment window is open.', mayEdit() ? html`<button class="btn primary" id="add">+ Add term</button>` : '')}
    ${terms.length ? html`<div class="card scroll-x"><table class="table">
      <thead><tr><th>Term</th><th>Enrollment window</th><th>Drop deadline</th><th>Classes</th><th>Sections</th><th></th></tr></thead>
      <tbody>${terms.map((t) => html`<tr><td><strong>${t.name}</strong> ${t.current ? statusBadge('enrolled', 'Current') : ''} ${t.status === 'archived' ? statusBadge('archived') : ''}</td>
        <td>${fmtDate(t.enrollStart)} – ${fmtDate(t.enrollEnd)} ${t.open ? statusBadge('open', 'Open now') : ''}</td><td>${t.dropDeadline ? fmtDate(t.dropDeadline) : '—'}</td>
        <td>${fmtDate(t.startDate)} – ${fmtDate(t.endDate)}</td><td>${t.sections}</td>${rowActions(t)}</tr>`)}</tbody>
    </table></div>` : empty('No terms yet', 'Add a term with its enrollment window and class dates.')}`);
  wireCrud(el, {
    list: terms,
    del: '/api/admin/terms',
    redraw,
    edit: (t) => modal({
      title: t ? `Edit ${t.name}` : 'Add a term',
      wide: true,
      body: html`<div class="grid">
        <label class="field span-2"><span>Name<em>*</em></span><input name="name" value="${t?.name || ''}" placeholder="e.g. 1st Semester 2026–2027" required /></label>
        <label class="field"><span>Status</span><select name="status">${option('active', 'Active', t?.status !== 'archived')}${option('archived', 'Archived (hidden from students)', t?.status === 'archived')}</select></label>
        <label class="field"><span>Enrollment opens<em>*</em></span><input type="date" name="enrollStart" value="${t?.enrollStart || ''}" required /></label>
        <label class="field"><span>Enrollment closes<em>*</em></span><input type="date" name="enrollEnd" value="${t?.enrollEnd || ''}" required /></label>
        <label class="field"><span>Drop deadline</span><input type="date" name="dropDeadline" value="${t?.dropDeadline || ''}" /><span class="hint">After this, students cannot drop enrolled classes themselves.</span></label>
        <label class="field"><span>Classes start<em>*</em></span><input type="date" name="startDate" value="${t?.startDate || ''}" required /></label>
        <label class="field"><span>Classes end<em>*</em></span><input type="date" name="endDate" value="${t?.endDate || ''}" required /></label>
        <label class="field check"><input type="checkbox" name="makeCurrent" ${t?.current || !terms.length ? 'checked' : ''} /> <span>Current term</span></label>
      </div>`,
      async onSubmit(form) {
        const v = formData(form);
        const body = { ...v, makeCurrent: Boolean(v.makeCurrent) };
        await (t ? api.put(`/api/admin/terms/${t.id}`, body) : api.post('/api/admin/terms', body));
        toast('Saved.');
        redraw();
      },
    }),
  });
}

// ----- Programs -----
export async function programsView(el) {
  const programs = await api.get('/api/admin/programs');
  const redraw = () => programsView(el);
  mount(el, html`
    ${pageHead('Programs', 'Degree or strand a student belongs to, e.g. BS Information Technology.', mayEdit() ? html`<button class="btn primary" id="add">+ Add program</button>` : '')}
    ${programs.length ? html`<div class="card scroll-x"><table class="table">
      <thead><tr><th>Program</th><th>Active students</th><th></th></tr></thead>
      <tbody>${programs.map((p) => html`<tr><td><strong class="mono">${p.code}</strong> ${p.name}<small>${p.description}</small></td><td>${p.students}</td>${rowActions(p)}</tr>`)}</tbody>
    </table></div>` : empty('No programs yet')}`);
  wireCrud(el, {
    list: programs,
    del: '/api/admin/programs',
    redraw,
    edit: (p) => modal({
      title: p ? `Edit ${p.code}` : 'Add a program',
      body: html`<div class="stack tight">
        <label class="field"><span>Code<em>*</em></span><input name="code" value="${p?.code || ''}" placeholder="e.g. BSIT" required /></label>
        <label class="field"><span>Name<em>*</em></span><input name="name" value="${p?.name || ''}" required /></label>
        <label class="field"><span>Description</span><textarea name="description">${p?.description || ''}</textarea></label>
      </div>`,
      async onSubmit(form) {
        await (p ? api.put(`/api/admin/programs/${p.id}`, formData(form)) : api.post('/api/admin/programs', formData(form)));
        toast('Saved.');
        redraw();
      },
    }),
  });
}
