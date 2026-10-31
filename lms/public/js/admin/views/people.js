// Students, applicants, teachers and admin-panel staff.
import { api } from '../../api.js';
import { html, mount, modal, toast, statusBadge, timeAgo, fmtDate, option, formData, confirmDialog, empty } from '../../ui.js';
import { pageHead, badgesChanged, ctx } from '../../shell.js';
import { can, ROLES, roleLabel } from '/shared/roles.js';
import { lookups, filterRows, sectionTitle } from '../common.js';
import { enrollmentActions, wireEnrollmentActions, showHistory, addEnrollmentDialog } from './enrollment.js';

const KINDS = {
  student: { title: 'Students', role: 'student', url: '/api/admin/users?role=student', manage: 'students.manage', sub: 'Student accounts sign in on the learning portal.' },
  applicant: { title: 'Applicants', role: 'student', url: '/api/admin/users?role=student&status=pending', manage: 'students.manage', sub: 'People who applied from the learning portal. Admitting gives them a student number and lets them sign in.' },
  teacher: { title: 'Teachers', role: 'teacher', url: '/api/admin/users?role=teacher', manage: 'teachers.manage', sub: 'Teacher accounts sign in on the learning portal and see the sections assigned to them.' },
  staff: { title: 'Admins & registrars', role: 'registrar', url: '/api/admin/users?role=staff', manage: 'admins.manage', sub: 'These accounts sign in here, on the admin panel.' },
};

export function userDialog({ user = null, role, programs = [] }, onDone) {
  const r = user?.role || role;
  const staff = ROLES[r]?.side === 'admin';
  modal({
    title: user ? `Edit ${user.name}` : `Add ${staff ? 'an admin-panel account' : `a ${roleLabel(r).toLowerCase()}`}`,
    wide: true,
    body: html`<div class="grid">
      ${staff && !user ? html`<label class="field"><span>Account type</span><select name="role">${['registrar', 'admin'].map((x) => option(x, ROLES[x].label, x === r))}</select><span class="hint">Registrars run enrollment; administrators can do everything.</span></label>` : ''}
      <label class="field ${staff && !user ? '' : 'span-2'}"><span>Full name<em>*</em></span><input name="name" value="${user?.name || ''}" required /></label>
      <label class="field"><span>Username<em>*</em></span><input name="username" value="${user?.username || ''}" autocapitalize="none" spellcheck="false" required /></label>
      <label class="field span-2"><span>Email</span><input type="email" name="email" value="${user?.email || ''}" /></label>
      ${r === 'student' ? html`
        <label class="field"><span>Student number</span><input name="studentNo" value="${user?.studentNo || ''}" placeholder="Leave blank to number automatically" /></label>
        <label class="field"><span>Program</span><select name="programId">${option('', 'None')}${programs.map((p) => option(p.id, `${p.code} · ${p.name}`, p.id === user?.programId))}</select></label>
        <label class="field"><span>Year level</span><select name="yearLevel">${[1, 2, 3, 4, 5, 6].map((y) => option(y, `Year ${y}`, y === (user?.yearLevel || 1)))}</select></label>` : ''}
      ${r === 'teacher' ? html`
        <label class="field span-2"><span>Department</span><input name="department" value="${user?.department || ''}" /></label>
        <label class="field"><span>Employee number</span><input name="employeeNo" value="${user?.employeeNo || ''}" /></label>` : ''}
      ${user
        ? (user.status === 'active' || user.status === 'disabled') && html`<label class="field"><span>Status</span><select name="status">${option('active', 'Active', user.status === 'active')}${option('disabled', 'Disabled (cannot sign in)', user.status === 'disabled')}</select></label>`
        : html`<label class="field"><span>Temporary password<em>*</em></span><input name="password" minlength="8" required /><span class="hint">At least 8 characters. Give it to the person.</span></label>
          <label class="field check span-2"><input type="checkbox" name="mustChangePassword" checked /> <span>Ask them to choose their own password when they first sign in</span></label>`}
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const body = { ...v, role: v.role || r, mustChangePassword: Boolean(v.mustChangePassword) };
      const saved = user ? await api.put(`/api/admin/users/${user.id}`, body) : await api.post('/api/admin/users', body);
      toast(user ? 'Saved.' : `${saved.name} added${saved.studentNo ? ` as ${saved.studentNo}` : ''}.`);
      onDone(saved);
    },
  });
}

function resetPasswordDialog(user) {
  modal({
    title: `Reset ${user.name}'s password`,
    body: html`<label class="field"><span>New temporary password</span><input name="password" minlength="8" required /></label><p class="hint">They will be signed out and asked to choose their own password at their next sign-in.</p>`,
    submitLabel: 'Reset password',
    async onSubmit(form) {
      await api.post(`/api/admin/users/${user.id}/reset-password`, formData(form));
      toast('Password reset.');
    },
  });
}

export async function peopleView(el, { kind }) {
  const k = KINDS[kind];
  const mayManage = can(ctx.user.role, k.manage);
  const [list, { programs }] = await Promise.all([api.get(k.url), lookups('programs')]);
  const rows = kind === 'student' ? list.filter((u) => u.status === 'active' || u.status === 'disabled') : list;

  const columns = {
    student: () => html`<thead><tr><th>Student</th><th>Number</th><th>Program</th><th>Units this term</th><th>Status</th><th>Last sign-in</th></tr></thead>
      <tbody>${rows.map((u) => html`<tr data-id="${u.id}"><td><strong>${u.name}</strong><small>${u.username}${u.email ? ` · ${u.email}` : ''}</small></td><td class="mono">${u.studentNo}</td><td>${u.program || '—'}${u.program ? html`<small>Year ${u.yearLevel}</small>` : ''}</td><td>${u.currentUnits || '—'}</td><td>${statusBadge(u.status)}</td><td>${u.lastLoginAt ? timeAgo(u.lastLoginAt) : '—'}</td></tr>`)}</tbody>`,
    applicant: () => html`<thead><tr><th>Applicant</th><th>Program</th><th>Applied</th><th>Note</th><th></th></tr></thead>
      <tbody>${rows.map((u) => html`<tr><td><strong>${u.name}</strong><small>${u.username} · ${u.email}</small></td><td>${u.program || '—'}${u.program ? html`<small>Year ${u.yearLevel}</small>` : ''}</td><td>${fmtDate((u.appliedAt || u.createdAt).slice(0, 10))}</td><td class="notes">${u.applicationNote || '—'}</td>
        <td class="row-actions">${mayManage ? html`<button class="btn primary" data-admit="${u.id}">Admit</button><button class="btn danger ghost" data-decline="${u.id}">Decline</button>` : ''}</td></tr>`)}</tbody>`,
    teacher: () => html`<thead><tr><th>Teacher</th><th>Department</th><th>Sections this term</th><th>Status</th><th>Last sign-in</th></tr></thead>
      <tbody>${rows.map((u) => html`<tr data-id="${u.id}"><td><strong>${u.name}</strong><small>${u.username}${u.email ? ` · ${u.email}` : ''}</small></td><td>${u.department || '—'}</td><td>${u.sections || '—'}</td><td>${statusBadge(u.status)}</td><td>${u.lastLoginAt ? timeAgo(u.lastLoginAt) : '—'}</td></tr>`)}</tbody>`,
    staff: () => html`<thead><tr><th>Name</th><th>Account type</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody>${rows.map((u) => html`<tr><td><strong>${u.name}</strong>${u.id === ctx.user.id ? html` <span class="you muted">(you)</span>` : ''}<small>${u.username}${u.email ? ` · ${u.email}` : ''}</small></td><td>${roleLabel(u.role)}</td><td>${statusBadge(u.status)}</td><td>${u.lastLoginAt ? timeAgo(u.lastLoginAt) : '—'}</td>
        <td class="row-actions"><button class="btn" data-edit="${u.id}">Edit</button><button class="btn" data-reset="${u.id}">Reset password</button>${u.id !== ctx.user.id ? html`<button class="btn danger ghost" data-delete="${u.id}">Delete</button>` : ''}</td></tr>`)}</tbody>`,
  };

  mount(el, html`
    ${pageHead(k.title, k.sub, mayManage && kind !== 'applicant' ? html`<button class="btn primary" id="add">+ Add ${kind === 'staff' ? 'account' : roleLabel(k.role).toLowerCase()}</button>` : '')}
    ${kind === 'applicant' ? html`<p class="hint" style="margin-bottom:12px">Turn the portal's "Apply as a student" form on or off under <a href="#/settings">Settings → Student applications</a>.</p>` : ''}
    ${rows.length ? html`
      <div class="toolbar"><input type="search" placeholder="Search" /><span class="spacer"></span><span class="muted" id="shown">${rows.length} shown</span></div>
      <div class="card scroll-x"><table class="table ${kind === 'student' || kind === 'teacher' ? 'clickable' : ''}">${columns[kind]()}</table></div>`
      : empty(kind === 'applicant' ? 'No applications waiting' : `No ${k.title.toLowerCase()} yet`, kind === 'applicant' ? 'New applications from the learning portal appear here.' : '')}`);

  const redraw = () => peopleView(el, { kind });
  filterRows(el);
  el.querySelector('#add')?.addEventListener('click', () => userDialog({ role: k.role, programs }, (u) => (kind === 'staff' ? redraw() : (location.hash = `#/people/${u.id}`))));
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => (location.hash = `#/people/${tr.dataset.id}`)));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => userDialog({ user: rows.find((u) => u.id === b.dataset.edit) }, redraw)));
  el.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => resetPasswordDialog(rows.find((u) => u.id === b.dataset.reset))));
  el.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
    const u = rows.find((x) => x.id === b.dataset.delete);
    if (!(await confirmDialog(`Delete ${u.name}'s account?`))) return;
    await api.del(`/api/admin/users/${u.id}`).then(redraw, (err) => toast(err.message, 'error'));
  }));
  el.querySelectorAll('[data-admit]').forEach((b) => b.addEventListener('click', () => {
    const u = rows.find((x) => x.id === b.dataset.admit);
    modal({
      title: `Admit ${u.name}`,
      body: html`<label class="field"><span>Program</span><select name="programId">${option('', 'None')}${programs.map((p) => option(p.id, `${p.code} · ${p.name}`, p.id === u.programId))}</select></label><p class="hint">They get a student number and can sign in to the learning portal right away.</p>`,
      submitLabel: 'Admit',
      async onSubmit(form) {
        const s = await api.post(`/api/admin/users/${u.id}/approve`, formData(form));
        toast(`${s.name} admitted as ${s.studentNo}.`);
        badgesChanged();
        redraw();
      },
    });
  }));
  el.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => {
    const u = rows.find((x) => x.id === b.dataset.decline);
    modal({
      title: `Decline ${u.name}'s application?`,
      body: html`<label class="field"><span>Reason (kept on record)</span><textarea name="note"></textarea></label>`,
      submitLabel: 'Decline',
      async onSubmit(form) {
        await api.post(`/api/admin/users/${u.id}/reject`, formData(form));
        badgesChanged();
        redraw();
      },
    });
  }));
}

export async function personView(el, { id }) {
  const u = await api.get(`/api/admin/users/${id}`);
  const manage = can(ctx.user.role, u.role === 'student' ? 'students.manage' : 'teachers.manage');
  const back = u.role === 'student' ? ['/students', 'Students'] : ['/teachers', 'Teachers'];
  const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || '—'}</dd></div>`;
  const enrollments = u.enrollments || [];
  mount(el, html`
    ${pageHead(html`${u.name} ${statusBadge(u.status)}`, `${roleLabel(u.role)} · ${u.username}`, manage ? html`
      ${u.role === 'student' && u.status === 'active' && can(ctx.user.role, 'enrollment.manage') ? html`<button class="btn primary" id="enroll">+ Add to a section</button>` : ''}
      <button class="btn" id="edit">Edit</button><button class="btn" id="reset">Reset password</button>` : '', back)}
    <section class="card"><dl class="info-grid">
      ${u.role === 'student' ? html`${info('Student number', html`<span class="mono">${u.studentNo}</span>`)}${info('Program', u.program ? `${u.program.code} · ${u.program.name}` : '')}${info('Year level', `Year ${u.yearLevel || 1}`)}` : ''}
      ${u.role === 'teacher' ? html`${info('Department', u.department)}${info('Employee number', u.employeeNo)}` : ''}
      ${info('Email', u.email)}
      ${info('Last sign-in', u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never')}
      ${info('Account created', fmtDate(u.createdAt.slice(0, 10)))}
    </dl></section>
    ${u.role === 'student' ? html`
      <h3>Enrollment record</h3>
      <div class="card scroll-x">${enrollments.length ? html`<table class="table">
        <thead><tr><th>Section</th><th>Term</th><th>Units</th><th>Status</th><th>Final grade</th><th></th></tr></thead>
        <tbody>${enrollments.map((e) => html`<tr><td>${sectionTitle(e.section)}</td><td>${e.section.term.name}</td><td>${e.section.course.units}</td>
          <td>${statusBadge(e.status, e.statusLabel)}${e.position ? html`<small>#${e.position} in line</small>` : ''}</td>
          <td>${e.finalGrade != null ? html`<strong>${e.finalGrade}</strong> ${e.passed ? statusBadge('enrolled', 'Passed') : statusBadge('rejected', 'Failed')}` : '—'}</td>
          <td class="row-actions">${can(ctx.user.role, 'enrollment.manage') ? enrollmentActions(e) : ''}<button class="btn" data-history="${e.id}">History</button></td></tr>`)}</tbody>
      </table>` : html`<p class="muted" style="padding:18px">No enrollments yet.</p>`}</div>` : ''}
    ${u.role === 'teacher' ? html`
      <h3>Sections</h3>
      <div class="card scroll-x">${u.sections.length ? html`<table class="table clickable">
        <thead><tr><th>Section</th><th>Term</th><th>Schedule</th><th>Students</th></tr></thead>
        <tbody>${u.sections.map((s) => html`<tr data-href="/sections/${s.id}"><td>${sectionTitle(s)}</td><td>${s.term.name}</td><td>${s.schedule}</td><td>${s.taken}/${s.capacity}</td></tr>`)}</tbody>
      </table>` : html`<p class="muted" style="padding:18px">No sections assigned. Assign one under <a href="#/sections">Sections</a>.</p>`}</div>` : ''}`);

  const redraw = () => personView(el, { id });
  wireEnrollmentActions(el, enrollments, redraw);
  el.querySelectorAll('[data-history]').forEach((b) => b.addEventListener('click', () => showHistory(enrollments.find((e) => e.id === b.dataset.history))));
  el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => (location.hash = `#${tr.dataset.href}`)));
  el.querySelector('#edit')?.addEventListener('click', async () => userDialog({ user: u, programs: (await lookups('programs')).programs }, redraw));
  el.querySelector('#reset')?.addEventListener('click', () => resetPasswordDialog(u));
  el.querySelector('#enroll')?.addEventListener('click', async () => {
    const { settings } = await lookups('settings');
    const sections = await api.get(`/api/admin/sections?termId=${settings.currentTermId || ''}`);
    addEnrollmentDialog({ students: [{ ...u, program: u.program?.code }], sections, studentId: u.id }, redraw);
  });
}
