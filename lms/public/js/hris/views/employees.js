// Employees: the list, the record form and the profile, with the employee's sign-in
// account. From the Lancaster ERP (public/js/views/employees.js there); for the school,
// records belong to a campus, are teaching or non-teaching, and link to the person's
// LMS account (teachers, registrars) or an HRIS account (staff, HR, payroll).
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, raw, mount, money, fmtDate, fullName, badge, toast, modal, confirmDialog, downloadFile, toCsv, WEEKDAYS, today, initials, timeAgo, formData } from '../../ui.js';
import { hr, can, clickableRows } from '../state.js';

const CSV_COLUMNS = [
  ['Employee No', 'employeeNo'], ['Last Name', 'lastName'], ['First Name', 'firstName'], ['Middle Name', 'middleName'],
  ['Category', 'category'], ['Position', 'position'], ['Department', 'department'], ['Employment Status', 'employmentStatus'], ['Status', 'status'],
  ['Hire Date', 'hireDate'], ['Pay Type', 'payType'], ['Rate', 'rate'], ['Allowance', 'allowance'], ['Email', 'email'],
  ['Phone', 'phone'], ['Birth Date', 'birthDate'], ['TIN', 'tin'], ['SSS', 'sssNo'], ['PhilHealth', 'philhealthNo'],
  ['Pag-IBIG', 'pagibigNo'], ['Bank', 'bankName'], ['Account No', 'bankAccount'],
];
const CATEGORY = { teaching: 'Teaching', 'non-teaching': 'Non-teaching' };
const accountBadge = (a) => (a ? badge(a.roleLabel, a.status === 'active' ? 'green' : 'gray') : badge('No account', 'amber'));

export async function employeeListView(el, _params, query) {
  const employees = await api.get('/api/hris/employees');
  const state = { q: query.q || '', dept: '', status: 'Active', category: '' };
  const departments = [...new Set(employees.map((e) => e.department).filter(Boolean))].sort();

  function rows() {
    const q = state.q.toLowerCase();
    return employees
      .filter((e) => (!state.status || e.status === state.status) && (!state.dept || e.department === state.dept) && (!state.category || e.category === state.category))
      .filter((e) => !q || [e.employeeNo, e.firstName, e.lastName, e.position, e.email, e.account?.username].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
  }

  function renderTable() {
    const list = rows();
    mount(el.querySelector('#emp-table'), list.length
      ? html`<table class="table clickable">
          <thead><tr><th>Employee</th><th>Position</th><th>Department</th><th>Status</th><th>Sign-in</th><th>Hired</th>${can('payroll.view') || can('employees.edit') ? html`<th class="num">Rate</th>` : ''}</tr></thead>
          <tbody>${list.map((e) => html`
            <tr data-href="#/employees/${e.id}">
              <td><div class="person"><span class="avatar">${initials(`${e.firstName} ${e.lastName}`)}</span><div><strong>${e.lastName}, ${e.firstName}</strong><small>${e.employeeNo} · ${CATEGORY[e.category] || ''}${e.flexTime ? html` · <span class="flex-tag">FLEX</span>` : ''}</small></div></div></td>
              <td>${e.position}</td>
              <td>${e.department}</td>
              <td>${badge(e.employmentStatus || '—')} ${e.status === 'Inactive' ? badge('Inactive', 'gray') : ''}</td>
              <td>${accountBadge(e.account)}${e.account ? html`<small>${e.account.username}</small>` : ''}</td>
              <td>${fmtDate(e.hireDate)}</td>
              ${can('payroll.view') || can('employees.edit') ? html`<td class="num">${money(e.rate)}<small>/${e.payType === 'daily' ? 'day' : 'month'}</small></td>` : ''}
            </tr>`)}</tbody>
        </table>`
      : html`<p class="muted" style="margin-top:12px">No employees match.</p>`);
    el.querySelector('#emp-count').textContent = `${list.length} of ${employees.length} at ${ctx.info.campusName || 'this campus'}`;
  }

  mount(el, html`
    ${pageHead('Employees', html`<span id="emp-count"></span>`, html`
      <button class="btn" id="export">${icon('download', 16)} Export CSV</button>
      ${can('employees.edit') ? html`<a class="btn primary" href="#/employees/new">${icon('userPlus', 16)} Add employee</a>` : ''}`)}
    ${employees.length === 0
      ? html`<div class="card empty">${icon('users', 40)}<h2>No employees at this campus yet</h2><p>Add the first employee record. Teachers and registrars can be linked to their ATLAS Learn account, so they use the same sign-in.</p></div>`
      : html`<div class="card">
          <div class="toolbar">
            <input type="search" id="q" placeholder="Search name, number, position…" value="${state.q}" />
            <select id="category"><option value="">Teaching and non-teaching</option><option value="teaching">Teaching</option><option value="non-teaching">Non-teaching</option></select>
            <select id="dept"><option value="">All departments</option>${departments.map((d) => html`<option>${d}</option>`)}</select>
            <select id="status"><option value="Active">Active</option><option value="Inactive">Inactive</option><option value="">All</option></select>
          </div>
          <div id="emp-table" class="scroll-x"></div>
        </div>`}`);

  if (!employees.length) return;
  renderTable();
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value), renderTable()));
  el.querySelector('#category').addEventListener('change', (e) => ((state.category = e.target.value), renderTable()));
  el.querySelector('#dept').addEventListener('change', (e) => ((state.dept = e.target.value), renderTable()));
  el.querySelector('#status').addEventListener('change', (e) => ((state.status = e.target.value), renderTable()));
  clickableRows(el.querySelector('#emp-table'));
  el.querySelector('#export').addEventListener('click', () => {
    const data = [CSV_COLUMNS.map((c) => c[0]), ...rows().map((e) => CSV_COLUMNS.map(([, k]) => e[k]))];
    downloadFile(`employees-${today()}.csv`, toCsv(data));
  });
}

function field(label, name, value, { type = 'text', required = false, options, attrs = '', span = 1, hint } = {}) {
  const input = options
    ? html`<select name="${name}" ${required ? 'required' : ''}>${options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return html`<option value="${v}" ${String(value ?? '') === String(v) ? 'selected' : ''}>${l}</option>`;
      })}</select>`
    : html`<input type="${type}" name="${name}" value="${value ?? ''}" ${required ? 'required' : ''} ${raw(attrs)} />`;
  return html`<label class="field span-${span}"><span>${label}${required ? html`<em>*</em>` : ''}</span>${input}${hint ? html`<span class="hint">${hint}</span>` : ''}</label>`;
}

function nextEmployeeNo(employees) {
  const max = employees.reduce((m, e) => Math.max(m, Number((String(e.employeeNo).match(/(\d+)$/) || [])[1]) || 0), 0);
  return `EMP-${String(max + 1).padStart(4, '0')}`;
}

export async function employeeFormView(el, { id }) {
  const isNew = !id;
  const s = hr.settings;
  const [emp, linkable] = await Promise.all([
    isNew ? api.get('/api/hris/employees').then((list) => ({ employeeNo: nextEmployeeNo(list), status: 'Active', employmentStatus: 'Probationary', category: 'non-teaching', payType: 'monthly', hireDate: today(), allowance: 0, schedule: s.schedule }))
      : api.get(`/api/hris/employees/${id}`),
    isNew && can('hris.accounts') ? api.get('/api/hris/accounts/linkable') : [],
  ]);
  const sched = { ...s.schedule, ...(emp.schedule || {}) };
  const campuses = ctx.info.campuses || [];
  const back = isNew ? ['/employees', 'Employees'] : [['/employees', 'Employees'], [`/employees/${id}`, fullName(emp)]];

  mount(el, html`
    ${pageHead(isNew ? 'New employee' : `Edit ${fullName(emp)}`, isNew ? `At ${ctx.info.campusName || 'this campus'}.` : '', '', back)}
    <form id="emp-form" class="stack" novalidate>
      ${isNew && linkable.length ? html`<section class="card">
        <h2>${icon('link')} Already has an account?</h2>
        <p class="muted small">Teachers and registrars already sign in to ATLAS Learn. Pick their account to fill in what it knows and link it, so they use the same sign-in for ATLAS People.</p>
        <label class="field"><span>Link to an account</span><select name="linkUserId"><option value="">No, or add the account later</option>${linkable.map((u) => html`<option value="${u.id}">${u.name} · ${u.roleLabel} · ${u.username}</option>`)}</select></label>
      </section>` : ''}
      <section class="card">
        <h2>Personal information</h2>
        <div class="grid">
          ${field('First name', 'firstName', emp.firstName, { required: true })}
          ${field('Middle name', 'middleName', emp.middleName)}
          ${field('Last name', 'lastName', emp.lastName, { required: true })}
          ${field('Birth date', 'birthDate', emp.birthDate, { type: 'date' })}
          ${field('Gender', 'gender', emp.gender, { options: [['', '—'], 'Female', 'Male', 'Other'], hint: 'Used for maternity and paternity leave.' })}
          ${field('Civil status', 'civilStatus', emp.civilStatus, { options: [['', '—'], 'Single', 'Married', 'Widowed', 'Separated'] })}
          ${field('Email', 'email', emp.email, { type: 'email' })}
          ${field('Mobile number', 'phone', emp.phone, { type: 'tel' })}
          ${field('Address', 'address', emp.address, { span: 3 })}
          ${field('Emergency contact', 'emergencyContactName', emp.emergencyContactName)}
          ${field('Emergency contact no.', 'emergencyContactPhone', emp.emergencyContactPhone, { type: 'tel' })}
        </div>
      </section>
      <section class="card">
        <h2>Employment</h2>
        <div class="grid">
          ${field('Employee no.', 'employeeNo', emp.employeeNo, { required: true })}
          ${field('Category', 'category', emp.category, { options: Object.entries(CATEGORY) })}
          ${field('Position', 'position', emp.position, { hint: 'e.g. Instructor I, Assistant Professor II, Librarian' })}
          ${field('Department / office', 'department', emp.department)}
          ${field('Employment status', 'employmentStatus', emp.employmentStatus, { options: ['Probationary', 'Regular', 'Contractual', 'Part-time', 'Job order'] })}
          ${field('Date hired', 'hireDate', emp.hireDate, { type: 'date', required: true })}
          ${campuses.length > 1 ? field('Campus', 'campusId', emp.campusId || ctx.info.activeCampusId, { options: campuses.map((c) => [c.id, c.name]) }) : ''}
          ${field('Record status', 'status', emp.status, { options: ['Active', 'Inactive'], hint: 'Inactive employees are left out of new payroll runs.' })}
        </div>
      </section>
      <section class="card">
        <h2>Compensation</h2>
        <div class="grid">
          ${field('Pay type', 'payType', emp.payType, { options: [['monthly', 'Monthly-rated'], ['daily', 'Daily-rated']] })}
          ${field('Rate (₱)', 'rate', emp.rate, { type: 'number', required: true, attrs: 'min="0" step="0.01"', hint: 'Monthly salary or daily rate, depending on pay type.' })}
          ${field('Monthly allowance (₱)', 'allowance', emp.allowance, { type: 'number', attrs: 'min="0" step="0.01"', hint: 'Non-taxable (de minimis). Split across pay periods.' })}
          <label class="field check span-3"><input type="checkbox" name="minimumWageEarner" ${emp.minimumWageEarner ? 'checked' : ''} /> <span>Minimum wage earner (exempt from withholding tax)</span></label>
          <label class="field check span-3"><input type="checkbox" name="flexTime" ${emp.flexTime ? 'checked' : ''} /> <span>Flexible time (FLEX): clock-in and clock-out times do not affect pay. No late or undertime deductions; absences and approved overtime still count.</span></label>
        </div>
      </section>
      <section class="card">
        <h2>Work schedule</h2>
        <div class="grid">
          ${field('Shift start', 'shiftStart', sched.shiftStart, { type: 'time', required: true })}
          ${field('Shift end', 'shiftEnd', sched.shiftEnd, { type: 'time', required: true })}
          ${field('Unpaid break (minutes)', 'breakMinutes', sched.breakMinutes, { type: 'number', attrs: 'min="0" step="5"' })}
          <div class="field span-3"><span>Work days</span>
            <div class="days">${WEEKDAYS.map((d, i) => html`<label><input type="checkbox" name="workDays" value="${i}" ${sched.workDays.includes(i) ? 'checked' : ''} /> ${d}</label>`)}</div>
          </div>
        </div>
      </section>
      <section class="card">
        <h2>Government IDs &amp; bank</h2>
        <div class="grid">
          ${field('TIN', 'tin', emp.tin)}
          ${field('SSS no.', 'sssNo', emp.sssNo)}
          ${field('PhilHealth no.', 'philhealthNo', emp.philhealthNo)}
          ${field('Pag-IBIG MID no.', 'pagibigNo', emp.pagibigNo)}
          ${field('Bank', 'bankName', emp.bankName)}
          ${field('Account no.', 'bankAccount', emp.bankAccount)}
        </div>
      </section>
      <p class="form-error" hidden></p>
      <div class="actions end">
        <a class="btn" href="${isNew ? '#/employees' : `#/employees/${id}`}">Cancel</a>
        <button class="btn primary" type="submit">${isNew ? 'Create employee' : 'Save changes'}</button>
      </div>
    </form>`);

  const form = el.querySelector('#emp-form');
  // Picking an account fills in what it knows.
  form.linkUserId?.addEventListener('change', () => {
    const u = linkable.find((x) => x.id === form.linkUserId.value);
    if (!u) return;
    const [first, ...rest] = u.name.split(' ');
    if (!form.firstName.value) form.firstName.value = rest.length ? first : u.name;
    if (!form.lastName.value) form.lastName.value = rest.join(' ');
    if (!form.email.value) form.email.value = u.email;
    if (u.department && !form.department.value) form.department.value = u.department;
    if (u.role === 'teacher') form.category.value = 'teaching';
    if (u.employeeNo) form.employeeNo.value = u.employeeNo;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = Object.fromEntries([...fd.entries()].filter(([k]) => !['workDays', 'shiftStart', 'shiftEnd', 'breakMinutes', 'minimumWageEarner', 'flexTime'].includes(k)));
    body.minimumWageEarner = fd.has('minimumWageEarner');
    body.flexTime = fd.has('flexTime');
    body.schedule = { shiftStart: fd.get('shiftStart'), shiftEnd: fd.get('shiftEnd'), breakMinutes: fd.get('breakMinutes'), workDays: fd.getAll('workDays').map(Number) };
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const saved = isNew ? await api.post('/api/hris/employees', body) : await api.put(`/api/hris/employees/${id}`, body);
      toast(isNew ? 'Employee created.' : 'Changes saved.');
      if (saved.campusId !== ctx.info.activeCampusId) {
        toast(`Saved. ${fullName(saved)} is now at ${saved.campusName}.`);
        location.hash = '#/employees';
      } else location.hash = `#/employees/${saved.id}`;
    } catch (err) {
      btn.disabled = false;
      const errEl = form.querySelector('.form-error');
      errEl.textContent = err.message;
      errEl.hidden = false;
      errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || html`<span class="muted">—</span>`}</dd></div>`;

// The sign-in account card on the profile.
function accountCard(emp) {
  const a = emp.account;
  const manage = can('hris.accounts');
  if (!a) {
    return html`<section class="card">
      <h2>${icon('key')} Sign-in account</h2>
      <p class="muted">${emp.firstName} has no account linked, so no self-service (time clock, leave requests, payslips) yet.</p>
      ${manage ? html`<div class="actions"><button class="btn primary" id="acct-create">${icon('userPlus', 16)} Create an ATLAS People account</button><button class="btn" id="acct-link">${icon('link', 16)} Link an existing account</button></div>
        <p class="hint-line">Teachers and registrars: link their ATLAS Learn account. Non-teaching staff: create an ATLAS People account.</p>` : ''}
    </section>`;
  }
  return html`<section class="card">
    <h2>${icon('key')} Sign-in account</h2>
    <dl class="info-grid">
      ${info('Username', a.username)}${info('Account type', a.roleLabel)}
      ${info('Status', a.status === 'active' ? badge('Active', 'green') : badge('Disabled', 'gray'))}${info('Last sign-in', a.lastLoginAt ? timeAgo(a.lastLoginAt) : 'Never')}
    </dl>
    <p class="hint-line">${a.hrisOnly ? 'An ATLAS People account: signs in on the ATLAS home page and uses ATLAS People.' : `Their ${a.roleLabel.toLowerCase()} account for ATLAS Learn; the same sign-in opens ATLAS People self-service. Password and status are managed in the ATLAS Learn admin panel.`}</p>
    ${manage ? html`<div class="actions" style="margin-top:12px">
      ${a.hrisOnly ? html`<button class="btn" id="acct-edit">${icon('settings', 16)} Change type or status</button><button class="btn" id="acct-reset">${icon('key', 16)} Reset password</button>` : ''}
      <button class="btn danger ghost" id="acct-unlink">Unlink</button>
    </div>` : ''}
  </section>`;
}

const ACCOUNT_TYPES = [['staff', 'Staff: self-service only'], ['hr', 'HR Manager: employees, attendance, leave approvals'], ['payroll', 'Payroll Officer: payroll runs and setup']];

function wireAccount(el, emp, reload) {
  const done = (msg) => () => {
    toast(msg);
    reload();
  };
  el.querySelector('#acct-create')?.addEventListener('click', () => {
    const suggested = `${emp.firstName}.${emp.lastName}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
    modal({
      title: `ATLAS People account for ${fullName(emp)}`,
      submitLabel: 'Create account',
      body: html`<div class="stack tight">
        <label class="field"><span>Account type</span><select name="role">${ACCOUNT_TYPES.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></label>
        <label class="field"><span>Username</span><input name="username" value="${suggested}" required /><span class="hint">3–40 lowercase letters, numbers, dots, dashes or underscores.</span></label>
        <label class="field"><span>Temporary password (at least 8 characters)</span><input name="password" type="text" required autocomplete="off" /><span class="hint">They are asked to choose their own when they first sign in.</span></label>
      </div>`,
      async onSubmit(form) {
        await api.post(`/api/hris/employees/${emp.id}/account`, formData(form));
        done('Account created. Give them the username and temporary password.')();
      },
    });
  });
  el.querySelector('#acct-link')?.addEventListener('click', async () => {
    const list = await api.get('/api/hris/accounts/linkable');
    modal({
      title: `Link an account to ${fullName(emp)}`,
      submitLabel: 'Link',
      body: list.length
        ? html`<label class="field"><span>Account at ${ctx.info.campusName}</span><select name="userId">${list.map((u) => html`<option value="${u.id}" ${u.name.toLowerCase() === `${emp.firstName} ${emp.lastName}`.toLowerCase() ? 'selected' : ''}>${u.name} · ${u.roleLabel} · ${u.username}</option>`)}</select></label>`
        : html`<p class="muted">Every teacher, registrar and ATLAS People account at this campus is already linked to an employee record.</p>`,
      async onSubmit(form) {
        if (!list.length) return;
        await api.post(`/api/hris/employees/${emp.id}/account`, formData(form));
        done('Account linked.')();
      },
    });
  });
  el.querySelector('#acct-edit')?.addEventListener('click', () => modal({
    title: `${emp.account.username}: type and status`,
    body: html`<div class="stack tight">
      <label class="field"><span>Account type</span><select name="role">${ACCOUNT_TYPES.map(([v, l]) => html`<option value="${v}" ${emp.account.role === v ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label class="field"><span>Status</span><select name="status"><option value="active" ${emp.account.status === 'active' ? 'selected' : ''}>Active: can sign in</option><option value="disabled" ${emp.account.status === 'disabled' ? 'selected' : ''}>Disabled: cannot sign in</option></select></label>
    </div>`,
    async onSubmit(form) {
      await api.put(`/api/hris/employees/${emp.id}/account`, formData(form));
      done('Account updated.')();
    },
  }));
  el.querySelector('#acct-reset')?.addEventListener('click', () => modal({
    title: `New password for ${emp.account.username}`,
    submitLabel: 'Set password',
    body: html`<label class="field"><span>Temporary password (at least 8 characters)</span><input name="password" type="text" required autocomplete="off" /><span class="hint">They are signed out everywhere and choose their own at the next sign-in.</span></label>`,
    async onSubmit(form) {
      await api.put(`/api/hris/employees/${emp.id}/account`, formData(form));
      done('Password reset.')();
    },
  }));
  el.querySelector('#acct-unlink')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Unlink ${emp.account.username} from ${fullName(emp)}? The account stays, but loses ATLAS People self-service until it is linked again.`, { confirmLabel: 'Unlink' }))) return;
    await api.del(`/api/hris/employees/${emp.id}/account`);
    done('Account unlinked.')();
  });
}

export async function employeeProfileView(el, { id }) {
  const [emp, runs] = await Promise.all([api.get(`/api/hris/employees/${id}`), can('payroll.view') ? api.get('/api/hris/payroll-runs') : []]);
  const sched = { ...hr.settings.schedule, ...(emp.schedule || {}) };
  const relevantRuns = runs.filter((r) => r.employeeIds.includes(id)).slice(0, 6);

  mount(el, html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/employees">Employees</a>${icon('chevronRight', 14)}<span class="cur">${fullName(emp)}</span></nav>
    <div class="page-head">
      <div class="person big"><span class="avatar">${initials(`${emp.firstName} ${emp.lastName}`)}</span>
        <div><h1>${emp.firstName} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName}</h1>
        <p class="muted">${emp.position || 'No position'} · ${emp.department || 'No department'} · ${emp.employeeNo} ${emp.status === 'Inactive' ? badge('Inactive', 'gray') : badge(emp.employmentStatus || 'Employee', 'brand')} ${badge(CATEGORY[emp.category] || 'Non-teaching', 'gray')}</p></div>
      </div>
      <div class="actions">
        ${can('attendance.view') ? html`<a class="btn" href="#/dtr?employeeId=${emp.id}">${icon('clock', 16)} Attendance</a>` : ''}
        ${can('leave.adjust') ? html`<a class="btn" href="#/leave?tab=employee&employee=${emp.id}">${icon('inbox', 16)} Leave</a>` : ''}
        ${can('employees.edit') ? html`<a class="btn primary" href="#/employees/${emp.id}/edit">${icon('edit', 16)} Edit</a>` : ''}
      </div>
    </div>
    <div class="cols">
      <section class="card">
        <h2>Personal</h2>
        <dl class="info-grid">
          ${info('Birth date', fmtDate(emp.birthDate))}${info('Gender', emp.gender)}${info('Civil status', emp.civilStatus)}
          ${info('Email', emp.email)}${info('Mobile', emp.phone)}${info('Address', emp.address)}
          ${info('Emergency contact', [emp.emergencyContactName, emp.emergencyContactPhone].filter(Boolean).join(' · '))}
        </dl>
      </section>
      <section class="card">
        <h2>Employment &amp; pay</h2>
        <dl class="info-grid">
          ${info('Campus', emp.campusName)}${info('Date hired', fmtDate(emp.hireDate))}${info('Employment status', emp.employmentStatus)}
          ${info('Pay type', emp.payType === 'daily' ? 'Daily-rated' : 'Monthly-rated')}
          ${info('Rate', `${money(emp.rate)} / ${emp.payType === 'daily' ? 'day' : 'month'}`)}
          ${info('Allowance', `${money(emp.allowance)} / month`)}
          ${info('Tax', emp.minimumWageEarner ? 'Minimum wage earner (exempt)' : 'Regular withholding')}
          ${info('Schedule', `${sched.shiftStart}–${sched.shiftEnd}, ${sched.workDays.map((d) => WEEKDAYS[d]).join(', ')}`)}
          ${info('Time', emp.flexTime ? html`${badge('FLEX', 'blue')} Flexible time: no late or undertime deductions` : 'Fixed schedule')}
        </dl>
      </section>
      ${accountCard(emp)}
      <section class="card">
        <h2>Government IDs &amp; bank</h2>
        <dl class="info-grid">
          ${info('TIN', emp.tin)}${info('SSS', emp.sssNo)}${info('PhilHealth', emp.philhealthNo)}${info('Pag-IBIG', emp.pagibigNo)}
          ${info('Bank', emp.bankName)}${info('Account no.', emp.bankAccount)}
        </dl>
      </section>
      ${can('payroll.view') ? html`<section class="card">
        <h2>Recent payslips</h2>
        ${relevantRuns.length
          ? html`<ul class="link-list">${relevantRuns.map((r) => html`<li><a href="#/payroll/${r.id}/payslip/${emp.id}">${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}</a> ${r.status === 'draft' ? badge('Draft', 'amber') : ''}</li>`)}</ul>`
          : html`<p class="muted">No payroll runs include this employee yet.</p>`}
      </section>` : ''}
    </div>
    ${can('employees.edit') ? html`<div class="danger-zone">
      <button class="btn danger ghost" id="delete">${icon('trash', 16)} Delete employee</button>
      <span class="muted small">Tip: set the employee to Inactive instead to keep their records.</span>
    </div>` : ''}`);

  wireAccount(el, emp, () => employeeProfileView(el, { id }));
  el.querySelector('#delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete ${fullName(emp)} and all of their attendance and leave records? Payslips in past payroll runs are kept, and their sign-in account is only unlinked.`))) return;
    await api.del(`/api/hris/employees/${id}`);
    toast('Employee deleted.');
    location.hash = '#/employees';
  });
}
