// Admin: parent and guardian accounts, the students each is linked to, and what each
// link lets them see. Also the "Parents & guardians" card on a student's record.
import { api } from '../../api.js';
import { html, mount, modal, toast, statusBadge, timeAgo, fmtDate, option, formData, confirmDialog, empty, badge } from '../../ui.js';
import { pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { GUARDIAN_VIEWS, RELATIONSHIPS } from '/shared/guardians.js';
import { userDialog, resetPasswordDialog } from './people.js';
import { filterRows } from '../common.js';

const VIEW = Object.fromEntries(GUARDIAN_VIEWS.map((v) => [v.id, v]));
const sees = (views) => {
  const on = GUARDIAN_VIEWS.filter((v) => views?.[v.id]);
  return on.length === GUARDIAN_VIEWS.length ? 'Everything' : on.length ? on.map((v) => v.label).join(', ') : 'Nothing yet';
};
const viewChecks = (views = null) => html`<fieldset class="field span-3" style="border:0;padding:0;margin:0"><span>What they can see</span>
  <div class="view-checks">${GUARDIAN_VIEWS.map((v) => html`<label><input type="checkbox" name="view:${v.id}" ${!views || views[v.id] ? 'checked' : ''} /><span><strong>${v.label}</strong><small>${v.description}</small></span></label>`)}</div>
  <span class="hint">Each also needs its module on for parents & guardians under Modules. Students see who is linked to them and what each can see.</span></fieldset>`;
const readViews = (form) => Object.fromEntries(GUARDIAN_VIEWS.map((v) => [v.id, Boolean(form.querySelector(`[name="view:${v.id}"]`)?.checked)]));
const relationshipSelect = (value = 'Mother') => html`<label class="field"><span>Relationship</span><select name="relationship">${RELATIONSHIPS.map((r) => option(r, r, r === value))}</select></label>`;
const studentsAtCampus = async () => (await api.get('/api/admin/users?role=student')).filter((s) => s.status === 'active');
const studentSelect = (students, selected = '') => html`<label class="field span-2"><span>Student<em>*</em></span><select name="studentId" required>${option('', 'Choose a student…')}${students.map((s) => option(s.id, `${s.name} · ${s.studentNo}${s.program ? ` · ${s.program}` : ''}`, s.id === selected))}</select></label>`;

// A new parent or guardian account, linked to a student (fixed, or chosen from the campus).
export async function newGuardianDialog({ student = null } = {}, onDone) {
  const students = student ? [] : await studentsAtCampus();
  modal({
    title: student ? `Add a parent or guardian for ${student.name}` : 'Add a parent or guardian',
    wide: true,
    body: html`<div class="grid">
      ${student ? '' : studentSelect(students)}
      ${relationshipSelect()}
      <label class="field span-2"><span>Full name<em>*</em></span><input name="name" required /></label>
      <label class="field"><span>Username<em>*</em></span><input name="username" autocapitalize="none" spellcheck="false" required /></label>
      <label class="field span-2"><span>Email</span><input type="email" name="email" /></label>
      <label class="field"><span>Mobile number</span><input type="tel" name="phone" /></label>
      <label class="field"><span>Temporary password<em>*</em></span><input name="password" minlength="8" required /><span class="hint">At least 8 characters. They choose their own at the first sign-in.</span></label>
      ${viewChecks()}
    </div>`,
    submitLabel: 'Add and link',
    async onSubmit(form) {
      const v = formData(form);
      const g = await api.post('/api/admin/guardians', { ...v, studentId: student?.id || v.studentId, views: readViews(form), mustChangePassword: true });
      toast(`${g.name} added. They sign in on the ATLAS home page with the username ${g.username}.`);
      onDone(g);
    },
  });
}

// Link an existing guardian to a student; one side is fixed, the other is picked.
async function linkDialog({ guardian = null, student = null }, onDone) {
  const [guardians, students] = await Promise.all([guardian ? [] : api.get('/api/admin/guardians'), student ? [] : studentsAtCampus()]);
  const free = guardian ? students.filter((s) => !guardian.children.some((c) => c.student.id === s.id)) : guardians.filter((g) => !g.children.some((c) => c.student.id === student.id));
  modal({
    title: guardian ? `Link a student to ${guardian.name}` : `Link a parent or guardian to ${student.name}`,
    wide: true,
    body: free.length ? html`<div class="grid">
      ${guardian ? studentSelect(free) : html`<label class="field span-2"><span>Parent or guardian<em>*</em></span><select name="guardianId" required>${option('', 'Choose…')}${free.map((g) => option(g.id, `${g.name} · ${g.username}${g.children.length ? ` · ${g.children.map((c) => c.student.name).join(', ')}` : ''}`))}</select></label>`}
      ${relationshipSelect()}
      ${viewChecks()}
    </div>` : html`<p class="muted">${guardian ? 'Every active student at this campus is already linked.' : 'There are no other parent or guardian accounts at this campus yet. Use “New parent or guardian” instead.'}</p>`,
    submitLabel: free.length ? 'Link' : null,
    async onSubmit(form) {
      const v = formData(form);
      await api.post('/api/admin/guardian-links', { guardianId: guardian?.id || v.guardianId, studentId: student?.id || v.studentId, relationship: v.relationship, views: readViews(form) });
      toast('Linked.');
      onDone();
    },
  });
}

function editLinkDialog(link, { guardianName, studentName }, onDone) {
  modal({
    title: `${guardianName} → ${studentName}`,
    wide: true,
    body: html`<div class="grid">
      ${relationshipSelect(link.relationship)}
      <label class="field"><span>Access</span><select name="status">${option('active', 'On: they can see what is ticked', link.status === 'active')}${option('paused', 'Paused: they see nothing for now', link.status === 'paused')}</select></label>
      ${viewChecks(link.views)}
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      await api.put(`/api/admin/guardian-links/${link.id}`, { relationship: v.relationship, status: v.status, views: readViews(form) });
      toast('Saved.');
      onDone();
    },
  });
}

async function removeLink(link, names, onDone) {
  if (!(await confirmDialog(`Unlink ${names.guardianName} from ${names.studentName}? They will no longer see this student. Their account stays.`, { confirmLabel: 'Unlink' }))) return;
  await api.del(`/api/admin/guardian-links/${link.id}`);
  toast('Unlinked.');
  onDone();
}

export async function guardiansView(el) {
  const list = await api.get('/api/admin/guardians');
  mount(el, html`
    ${pageHead('Parents & guardians', 'Accounts for parents and guardians, the students each one follows, and what each can see. They sign in on the ATLAS home page and open ATLAS Learn.', html`<button class="btn primary" id="add">${icon('userPlus', 16)} Add parent or guardian</button>`)}
    ${list.length ? html`<input type="search" placeholder="Search name, username or student" style="margin-bottom:12px" />
      <div class="card scroll-x"><table class="table clickable">
      <thead><tr><th>Parent or guardian</th><th>Students</th><th>Contact</th><th>Status</th><th>Last sign-in</th></tr></thead>
      <tbody>${list.map((g) => html`<tr data-id="${g.id}">
        <td><strong>${g.name}</strong><small>${g.username}</small></td>
        <td>${g.children.length ? g.children.map((c) => html`<div>${c.student.name} <span class="muted small">· ${c.relationship}${c.status === 'paused' ? ' · paused' : ''}</span></div>`) : html`<span class="muted">None linked</span>`}</td>
        <td>${g.phone || g.email || '—'}${g.phone && g.email ? html`<small>${g.email}</small>` : ''}</td>
        <td>${statusBadge(g.status)}</td>
        <td>${g.lastLoginAt ? timeAgo(g.lastLoginAt) : 'Never'}</td></tr>`)}</tbody>
    </table></div>`
      : empty('No parents or guardians yet', 'Add a parent or guardian and link them to a student. You can also do it from a student’s record.')}`);
  if (list.length) filterRows(el);
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => (location.hash = `#/guardians/${tr.dataset.id}`)));
  el.querySelector('#add').addEventListener('click', () => newGuardianDialog({}, (g) => (location.hash = `#/guardians/${g.id}`)));
}

export async function guardianView(el, { id }) {
  const g = await api.get(`/api/admin/guardians/${id}`);
  const redraw = () => guardianView(el, { id });
  const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || '—'}</dd></div>`;
  mount(el, html`
    ${pageHead(html`${g.name} ${statusBadge(g.status)}`, `Parent / guardian · ${g.username}`, html`
      <button class="btn primary" id="link">${icon('link', 16)} Link a student</button>
      <button class="btn" id="edit">Edit</button><button class="btn" id="reset">Reset password</button>`, ['/guardians', 'Parents & guardians'])}
    <section class="card"><dl class="info-grid">
      ${info('Mobile', g.phone)}${info('Email', g.email)}${info('Campus', g.campusNames.join(', '))}
      ${info('Last sign-in', g.lastLoginAt ? timeAgo(g.lastLoginAt) : 'Never')}${info('Account created', fmtDate(g.createdAt?.slice(0, 10)))}
    </dl></section>
    <h3>Students</h3>
    ${g.children.length ? html`<div class="card scroll-x"><table class="table">
      <thead><tr><th>Student</th><th>Relationship</th><th>Can see</th><th>Last looked</th><th></th></tr></thead>
      <tbody>${g.children.map((c) => html`<tr>
        <td><strong>${c.reachable ? html`<a href="#/people/${c.student.id}">${c.student.name}</a>` : c.student.name}</strong><small>${c.student.studentNo} · ${c.student.campusName}</small></td>
        <td>${c.relationship}</td>
        <td>${c.status === 'paused' ? badge('Paused', 'gray') : sees(c.views)}${c.status === 'active' && c.allowed.length < Object.values(c.views).filter(Boolean).length ? html`<small>Some views are off under Modules.</small>` : ''}</td>
        <td>${c.lastViewedAt ? timeAgo(c.lastViewedAt) : 'Not yet'}</td>
        <td class="row-actions">${c.reachable ? html`<button class="btn sm" data-edit="${c.id}">Change</button><button class="btn sm danger ghost" data-del="${c.id}">Unlink</button>` : html`<span class="muted small">Other campus</span>`}</td></tr>`)}</tbody>
    </table></div>` : empty('No students linked', 'Link the students this person may follow.')}`);
  const names = (c) => ({ guardianName: g.name, studentName: c.student.name });
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const c = g.children.find((x) => x.id === b.dataset.edit);
    editLinkDialog(c, names(c), redraw);
  }));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const c = g.children.find((x) => x.id === b.dataset.del);
    removeLink(c, names(c), redraw);
  }));
  el.querySelector('#link').addEventListener('click', () => linkDialog({ guardian: g }, redraw));
  el.querySelector('#edit').addEventListener('click', () => userDialog({ user: { ...g, role: 'guardian' } }, redraw));
  el.querySelector('#reset').addEventListener('click', () => resetPasswordDialog(g));
}

// The card on a student's record (people.js).
export async function studentGuardiansCard(box, student) {
  const links = await api.get(`/api/admin/students/${student.id}/guardians`);
  const redraw = () => studentGuardiansCard(box, student);
  mount(box, html`
    <div class="card-head" style="margin-top:22px"><h3 style="margin:0">Parents & guardians</h3>
      <div class="actions"><button class="btn sm" id="g-link">${icon('link', 15)} Link existing</button><button class="btn sm primary" id="g-new">${icon('userPlus', 15)} New parent or guardian</button></div></div>
    ${links.length ? html`<div class="card scroll-x"><table class="table">
      <thead><tr><th>Parent or guardian</th><th>Relationship</th><th>Can see</th><th>Last looked</th><th></th></tr></thead>
      <tbody>${links.map((l) => html`<tr>
        <td><strong><a href="#/guardians/${l.guardian.id}">${l.guardian.name}</a></strong><small>${l.guardian.phone || l.guardian.email || l.guardian.username}</small></td>
        <td>${l.relationship}</td>
        <td>${l.status === 'paused' ? badge('Paused', 'gray') : sees(l.views)}</td>
        <td>${l.lastViewedAt ? timeAgo(l.lastViewedAt) : 'Not yet'}</td>
        <td class="row-actions"><button class="btn sm" data-edit="${l.id}">Change</button><button class="btn sm danger ghost" data-del="${l.id}">Unlink</button></td></tr>`)}</tbody>
    </table></div>` : html`<div class="card"><p class="muted" style="margin:0">No parent or guardian is linked to ${student.name}.</p></div>`}`);
  const names = (l) => ({ guardianName: l.guardian.name, studentName: student.name });
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const l = links.find((x) => x.id === b.dataset.edit);
    editLinkDialog(l, names(l), redraw);
  }));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const l = links.find((x) => x.id === b.dataset.del);
    removeLink(l, names(l), redraw);
  }));
  box.querySelector('#g-link').addEventListener('click', () => linkDialog({ student }, redraw));
  box.querySelector('#g-new').addEventListener('click', () => newGuardianDialog({ student }, redraw));
}

