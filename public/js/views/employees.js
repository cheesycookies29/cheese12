import { api } from '../api.js';
import { ctx, can } from '../state.js';
import { html, raw, mount, money, fmtDate, fullName, badge, toast, confirmDialog, downloadFile, toCsv, WEEKDAYS, today } from '../ui.js';

const CSV_COLUMNS = [
  ['Employee No', 'employeeNo'], ['Last Name', 'lastName'], ['First Name', 'firstName'], ['Middle Name', 'middleName'],
  ['Position', 'position'], ['Department', 'department'], ['Employment Status', 'employmentStatus'], ['Status', 'status'],
  ['Hire Date', 'hireDate'], ['Pay Type', 'payType'], ['Rate', 'rate'], ['Allowance', 'allowance'], ['Email', 'email'],
  ['Phone', 'phone'], ['Birth Date', 'birthDate'], ['TIN', 'tin'], ['SSS', 'sssNo'], ['PhilHealth', 'philhealthNo'],
  ['Pag-IBIG', 'pagibigNo'], ['Bank', 'bankName'], ['Account No', 'bankAccount'],
];

export async function employeeListView(el, _params, query) {
  const employees = await api.get('/api/employees');
  const state = { q: query.q || '', dept: '', status: 'Active' };
  const departments = [...new Set(employees.map((e) => e.department).filter(Boolean))].sort();

  function rows() {
    const q = state.q.toLowerCase();
    return employees
      .filter((e) => (!state.status || e.status === state.status) && (!state.dept || e.department === state.dept))
      .filter((e) => !q || [e.employeeNo, e.firstName, e.lastName, e.position, e.email].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
  }

  function renderTable() {
    const list = rows();
    mount(el.querySelector('#emp-table'), list.length
      ? html`<table class="table clickable">
          <thead><tr><th>Employee</th><th>Position</th><th>Department</th><th>Status</th><th>Hired</th><th class="num">Rate</th></tr></thead>
          <tbody>${list.map((e) => html`
            <tr data-href="#/employees/${e.id}">
              <td><div class="person"><span class="avatar">${e.firstName[0]}${e.lastName[0]}</span><div><strong>${e.lastName}, ${e.firstName}</strong><small>${e.employeeNo}</small></div></div></td>
              <td>${e.position}</td>
              <td>${e.department}</td>
              <td>${badge(e.employmentStatus || '—')} ${e.status === 'Inactive' ? badge('Inactive', 'gray') : ''}</td>
              <td>${fmtDate(e.hireDate)}</td>
              <td class="num">${money(e.rate)}<small>/${e.payType === 'daily' ? 'day' : 'month'}</small></td>
            </tr>`)}</tbody>
        </table>`
      : html`<div class="empty"><p>No employees match.</p></div>`);
    el.querySelector('#emp-count').textContent = `${list.length} of ${employees.length}`;
  }

  mount(el, html`
    <header class="page-head">
      <div><h1>Employees</h1><p class="muted" id="emp-count"></p></div>
      <div class="actions">
        <button class="btn" id="export">Export CSV</button>
        ${can('employees.edit') ? html`<a class="btn primary" href="#/employees/new">+ Add employee</a>` : ''}
      </div>
    </header>
    ${employees.length === 0
      ? html`<div class="card empty"><h2>No employees yet</h2><p>Add your first employee, or load demo data from <a href="#/settings">Settings</a>.</p></div>`
      : html`<div class="card">
          <div class="toolbar">
            <input type="search" id="q" placeholder="Search name, number, position…" value="${state.q}" />
            <select id="dept"><option value="">All departments</option>${departments.map((d) => html`<option>${d}</option>`)}</select>
            <select id="status"><option value="Active">Active</option><option value="Inactive">Inactive</option><option value="">All</option></select>
          </div>
          <div id="emp-table"></div>
        </div>`}`);

  if (!employees.length) return;
  renderTable();
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value), renderTable()));
  el.querySelector('#dept').addEventListener('change', (e) => ((state.dept = e.target.value), renderTable()));
  el.querySelector('#status').addEventListener('change', (e) => ((state.status = e.target.value), renderTable()));
  el.querySelector('#emp-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
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
  return html`<label class="field span-${span}"><span>${label}${required ? html`<em>*</em>` : ''}</span>${input}${hint ? html`<small class="muted">${hint}</small>` : ''}</label>`;
}

async function nextEmployeeNo() {
  const employees = await api.get('/api/employees');
  const max = employees.reduce((m, e) => Math.max(m, Number((e.employeeNo.match(/(\d+)$/) || [])[1]) || 0), 0);
  return `EMP-${String(max + 1).padStart(4, '0')}`;
}

export async function employeeFormView(el, { id }) {
  const isNew = !id;
  const s = ctx.settings;
  const emp = isNew
    ? { employeeNo: await nextEmployeeNo(), status: 'Active', employmentStatus: 'Probationary', payType: 'monthly', hireDate: today(), allowance: 0, schedule: s.schedule }
    : await api.get(`/api/employees/${id}`);
  const sched = { ...s.schedule, ...(emp.schedule || {}) };

  mount(el, html`
    <header class="page-head">
      <div><a class="back" href="${isNew ? '#/employees' : `#/employees/${id}`}">← Back</a><h1>${isNew ? 'New employee' : `Edit ${fullName(emp)}`}</h1></div>
    </header>
    <form id="emp-form" class="stack" novalidate>
      <section class="card">
        <h2>Personal information</h2>
        <div class="grid">
          ${field('First name', 'firstName', emp.firstName, { required: true })}
          ${field('Middle name', 'middleName', emp.middleName)}
          ${field('Last name', 'lastName', emp.lastName, { required: true })}
          ${field('Birth date', 'birthDate', emp.birthDate, { type: 'date' })}
          ${field('Gender', 'gender', emp.gender, { options: [['', '—'], 'Female', 'Male', 'Other'] })}
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
          ${field('Position', 'position', emp.position)}
          ${field('Department', 'department', emp.department)}
          ${field('Employment status', 'employmentStatus', emp.employmentStatus, { options: ['Probationary', 'Regular', 'Contractual', 'Project-based', 'Part-time'] })}
          ${field('Date hired', 'hireDate', emp.hireDate, { type: 'date', required: true })}
          ${field('Record status', 'status', emp.status, { options: ['Active', 'Inactive'], hint: 'Inactive employees are excluded from new payroll runs.' })}
        </div>
      </section>
      <section class="card">
        <h2>Compensation</h2>
        <div class="grid">
          ${field('Pay type', 'payType', emp.payType, { options: [['monthly', 'Monthly-rated'], ['daily', 'Daily-rated']] })}
          ${field('Rate (₱)', 'rate', emp.rate, { type: 'number', required: true, attrs: 'min="0" step="0.01"', hint: 'Monthly salary or daily rate, depending on pay type.' })}
          ${field('Monthly allowance (₱)', 'allowance', emp.allowance, { type: 'number', attrs: 'min="0" step="0.01"', hint: 'Non-taxable (de minimis). Split across pay periods.' })}
          <label class="field check span-3"><input type="checkbox" name="minimumWageEarner" ${emp.minimumWageEarner ? 'checked' : ''} /> <span>Minimum wage earner (exempt from withholding tax)</span></label>
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = Object.fromEntries([...fd.entries()].filter(([k]) => !['workDays', 'shiftStart', 'shiftEnd', 'breakMinutes', 'minimumWageEarner'].includes(k)));
    body.minimumWageEarner = fd.has('minimumWageEarner');
    body.schedule = { shiftStart: fd.get('shiftStart'), shiftEnd: fd.get('shiftEnd'), breakMinutes: fd.get('breakMinutes'), workDays: fd.getAll('workDays').map(Number) };
    try {
      const saved = isNew ? await api.post('/api/employees', body) : await api.put(`/api/employees/${id}`, body);
      toast(isNew ? 'Employee created.' : 'Changes saved.');
      location.hash = `#/employees/${saved.id}`;
    } catch (err) {
      const errEl = form.querySelector('.form-error');
      errEl.textContent = err.message;
      errEl.hidden = false;
      errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

function info(label, value) {
  return html`<div class="info"><dt>${label}</dt><dd>${value || html`<span class="muted">—</span>`}</dd></div>`;
}

export async function employeeProfileView(el, { id }) {
  const [emp, runs, assets] = await Promise.all([
    api.get(`/api/employees/${id}`), api.get('/api/payroll-runs'), can('assets.view') ? api.get('/api/assets') : null,
  ]);
  const held = (assets || []).filter((a) => a.status === 'assigned' && a.assignedTo?.type === 'employee' && a.assignedTo.id === id);
  const sched = { ...ctx.settings.schedule, ...(emp.schedule || {}) };
  const relevantRuns = runs.filter((r) => r.employeeIds.includes(id)).slice(0, 6);

  mount(el, html`
    <header class="page-head">
      <div>
        <a class="back" href="#/employees">← Employees</a>
        <div class="person big"><span class="avatar">${emp.firstName[0]}${emp.lastName[0]}</span>
          <div><h1>${emp.firstName} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName}</h1>
          <p class="muted">${emp.position || 'No position'} · ${emp.department || 'No department'} · ${emp.employeeNo} ${emp.status === 'Inactive' ? badge('Inactive', 'gray') : badge(emp.employmentStatus)}</p></div>
        </div>
      </div>
      <div class="actions">
        ${can('attendance.view') ? html`<a class="btn" href="#/dtr?employeeId=${emp.id}">View attendance</a>` : ''}
        ${can('employees.edit') ? html`<a class="btn primary" href="#/employees/${emp.id}/edit">Edit</a>` : ''}
      </div>
    </header>
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
          ${info('Date hired', fmtDate(emp.hireDate))}${info('Employment status', emp.employmentStatus)}
          ${info('Pay type', emp.payType === 'daily' ? 'Daily-rated' : 'Monthly-rated')}
          ${info('Rate', `${money(emp.rate)} / ${emp.payType === 'daily' ? 'day' : 'month'}`)}
          ${info('Allowance', `${money(emp.allowance)} / month`)}
          ${info('Tax', emp.minimumWageEarner ? 'Minimum wage earner (exempt)' : 'Regular withholding')}
          ${info('Schedule', `${sched.shiftStart}–${sched.shiftEnd}, ${sched.workDays.map((d) => WEEKDAYS[d]).join(', ')}`)}
        </dl>
      </section>
      <section class="card">
        <h2>Government IDs &amp; bank</h2>
        <dl class="info-grid">
          ${info('TIN', emp.tin)}${info('SSS', emp.sssNo)}${info('PhilHealth', emp.philhealthNo)}${info('Pag-IBIG', emp.pagibigNo)}
          ${info('Bank', emp.bankName)}${info('Account no.', emp.bankAccount)}
        </dl>
      </section>
      <section class="card">
        <h2>Recent payslips</h2>
        ${relevantRuns.length
          ? html`<ul class="link-list">${relevantRuns.map((r) => html`<li><a href="#/payroll/${r.id}/payslip/${emp.id}">${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}</a> ${r.status === 'draft' ? badge('Draft', 'amber') : ''}</li>`)}</ul>`
          : html`<p class="muted">No payroll runs include this employee yet.</p>`}
      </section>
      ${assets ? html`<section class="card">
        <h2>IT equipment</h2>
        ${held.length
          ? html`<ul class="link-list">${held.map((a) => html`<li><a class="mono" href="#/assets/item/${a.id}">${a.assetTag}</a> ${a.name} <small class="muted">since ${fmtDate(a.assignedAt?.slice(0, 10))}</small></li>`)}</ul>
            ${emp.status === 'Inactive' ? html`<p class="notice small">This employee is inactive but still holds ${held.length} asset${held.length === 1 ? '' : 's'}. Ask IT to collect them.</p>` : ''}`
          : html`<p class="muted">No IT assets assigned.</p>`}
      </section>` : ''}
    </div>
    ${can('employees.edit') ? html`<div class="danger-zone">
      <button class="btn danger ghost" id="delete">Delete employee</button>
      <small class="muted">Tip: set the employee to Inactive instead to keep their records.</small>
    </div>` : ''}`);

  el.querySelector('#delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete ${fullName(emp)} and all of their attendance records? Payslips in past payroll runs are kept.`))) return;
    await api.del(`/api/employees/${id}`);
    toast('Employee deleted.');
    location.hash = '#/employees';
  });
}
