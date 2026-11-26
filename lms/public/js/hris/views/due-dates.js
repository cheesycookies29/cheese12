// People → Due dates (PL-053; server/due-dates.js, shared/due-dates.js): every employee with an
// upcoming or overdue renewal, probation evaluation, step increment or retirement, with Mark done
// and Snooze; HR settings → Alerts and due dates; and the employee's own upcoming date on My HR record.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { icon } from '../../icons.js';
import { html, mount, fmtDate, badge, toast, modal, option, downloadFile, toCsv, today } from '../../ui.js';
import { WINDOWS, LIMITS, parseLeadDays, whenText } from '/shared/due-dates.js';

const FILTER_KEYS = ['rule', 'campusId', 'office', 'window', 'q', 'closed'];
const longDate = (ymd) => (ymd ? fmtDate(ymd, { month: 'long', day: 'numeric', year: 'numeric' }) : '—');
const sgText = (e) => (e.salaryGrade ? `SG ${e.salaryGrade}-${e.step || 1}` : '');
const daysBadge = (n) => (n < 0 ? badge(`Overdue ${-n} day${n === -1 ? '' : 's'}`, 'red') : n === 0 ? badge('Today', 'red') : badge(`${n} day${n === 1 ? '' : 's'}`, n <= 30 ? 'amber' : 'gray'));
const NOTE_HINT = {
  renewal: 'e.g. Renewed with a new appointment until June 30, 2027',
  probation: 'e.g. Evaluated: satisfactory performance rating',
  step: 'e.g. Step increment granted; NOSI issued',
  retirement: 'e.g. Retirement papers filed with GSIS',
  optionalRetirement: 'e.g. Told of the option; not retiring yet',
};

// ----- The list -----
export async function dueDatesView(el, _params = {}, query = {}) {
  const res = await api.get('/api/hris/due-dates');
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, query[k] || '']));
  if (!WINDOWS.some(([k]) => k === f.window)) f.window = '90';
  const rulesOn = res.rules.filter((r) => r.on);
  const offices = [...new Set(res.rows.map((r) => r.employee.office).filter(Boolean))].sort();
  const multiCampus = res.campuses.length > 1;
  const reload = () => dueDatesView(el, _params, f);

  const pick = () => {
    const q = f.q.trim().toLowerCase();
    return res.rows.filter((r) => (f.closed ? true : r.state === 'open')
      && (!f.rule || r.kind === f.rule)
      && (!f.campusId || r.employee.campusId === f.campusId)
      && (!f.office || r.employee.office === f.office)
      && (f.window === 'overdue' ? r.daysLeft < 0 : r.daysLeft <= Number(f.window))
      && (!q || `${r.employee.name} ${r.employee.employeeNo} ${r.employee.position}`.toLowerCase().includes(q)));
  };
  const who = (e) => (e.campusId === ctx.info.activeCampusId ? html`<a href="#/employees/${e.id}"><strong>${e.name}</strong></a>` : html`<strong>${e.name}</strong>`);
  const stateLine = (r) => {
    if (!r.mark || r.state === 'open') return '';
    if (r.state === 'done') return html`<small class="block due-state">${icon('checkCircle', 12)} Done ${fmtDate(r.mark.on)} · ${r.mark.auto ? 'by itself: ' : `${r.mark.by}${r.mark.note ? ': ' : ''}`}${r.mark.note}</small>`;
    return html`<small class="block due-state">${icon('clock', 12)} Snoozed until ${fmtDate(r.mark.until)} · ${r.mark.by}${r.mark.note ? `: ${r.mark.note}` : ''}</small>`;
  };
  const actions = (r) => (r.state === 'done'
    ? html`<button class="btn sm ghost" data-reopen="${r.key}">${icon('undo', 14)} Reopen</button>`
    : html`<button class="btn sm primary" data-done="${r.key}">${icon('check', 14)} Mark done</button>${r.state === 'snoozed' ? html`<button class="btn sm ghost" data-reopen="${r.key}">Reopen</button>` : html`<button class="btn sm" data-snooze="${r.key}">${icon('clock', 14)} Snooze</button>`}`);
  const rowHtml = (r) => html`<tr class="${r.state !== 'open' ? 'muted-row' : ''}">
    <td><div class="cell-v">${who(r.employee)}<small class="block muted">${r.employee.employeeNo}</small></div></td>
    <td data-label="What"><div class="cell-v"><strong>${r.ruleName}</strong><small class="block muted">${r.detail}</small>${stateLine(r)}</div></td>
    <td data-label="Due"><div class="cell-v"><span class="nowrap">${fmtDate(r.due)}</span><span class="block">${daysBadge(r.daysLeft)}</span></div></td>
    <td data-label="Appointment"><div class="cell-v">${r.employee.position || '—'}<small class="block muted">${[r.employee.status, sgText(r.employee)].filter(Boolean).join(' · ') || 'No status'}</small></div></td>
    <td data-label="Office and campus"><div class="cell-v">${r.employee.office || '—'}<small class="block muted">${r.employee.campusName}</small></div></td>
    <td class="row-actions no-print">${actions(r)}</td>
  </tr>`;

  function render() {
    const list = pick();
    const open = res.rows.filter((r) => r.state === 'open' && (!f.campusId || r.employee.campusId === f.campusId));
    mount(el.querySelector('#due-stats'), html`
      <button type="button" class="card ${open.some((r) => r.daysLeft < 0) ? 'accent' : ''}" data-window="overdue"><small>Overdue</small><strong>${open.filter((r) => r.daysLeft < 0).length}</strong></button>
      <button type="button" class="card" data-window="30"><small>Due in the next 30 days</small><strong>${open.filter((r) => r.daysLeft >= 0 && r.daysLeft <= 30).length}</strong></button>
      <button type="button" class="card" data-window="90"><small>In 31 to 90 days</small><strong>${open.filter((r) => r.daysLeft > 30 && r.daysLeft <= 90).length}</strong></button>
      <div class="card"><small>Snoozed</small><strong>${res.rows.filter((r) => r.state === 'snoozed').length}</strong></div>`);
    mount(el.querySelector('#due-table'), list.length
      ? html`<table class="table due-table">
          <thead><tr><th>Employee</th><th>What</th><th>Due</th><th>Appointment</th><th>Office and campus</th><th class="no-print"></th></tr></thead>
          <tbody>${list.map(rowHtml)}</tbody>
        </table>`
      : html`<div class="empty due-empty">${icon('checkCircle', 32)}<h2>${f.window === 'overdue' ? 'Nothing overdue' : 'Nothing due'}${f.rule || f.campusId || f.office || f.q ? ' that matches' : ''}</h2>
          <p class="muted">${f.window === 'overdue' ? 'Every date has been marked done, snoozed, or is still to come.' : `Nothing is due in the ${WINDOWS.find(([k]) => k === f.window)[1].toLowerCase()}${f.closed ? '' : ' that is not marked done or snoozed'}.`}</p>
          ${f.rule || f.campusId || f.office || f.q || f.window !== '365' ? html`<p><button type="button" class="btn" id="widen">Show everything in the next 12 months</button></p>` : ''}</div>`);
    el.querySelector('#due-count').textContent = `${list.length} shown · ${longDate(res.today)}`;
    el.querySelector('#print-filters').textContent = [rulesOn.find((r) => r.kind === f.rule)?.name || 'Every rule', res.campuses.find((c) => c.id === f.campusId)?.name || (multiCampus ? 'All my campuses' : ''), f.office, WINDOWS.find(([k]) => k === f.window)[1], f.closed ? 'with snoozed and done' : ''].filter(Boolean).join(' · ');
    const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && !(k === 'window' && v === '90'))).toString();
    history.replaceState(null, '', `#/due-dates${qs ? `?${qs}` : ''}`);
    el.querySelector('#widen')?.addEventListener('click', () => {
      Object.assign(f, { rule: '', campusId: '', office: '', q: '', window: '365' });
      for (const k of ['rule', 'campusId', 'office', 'q', 'window']) if (el.querySelector(`#f-${k}`)) el.querySelector(`#f-${k}`).value = f[k];
      render();
    });
  }

  const missing = res.missing.filter((m) => rulesOn.some((r) => r.kind === m.kind));
  const ruleName = (kind) => res.rules.find((r) => r.kind === kind)?.name || kind;
  // Grouped by rule and reason: "Step increment: no date of last step increment or appointment (28)".
  const groups = [...missing.reduce((m, x) => m.set(`${x.kind}|${x.reason}`, [...(m.get(`${x.kind}|${x.reason}`) || []), x]), new Map())];
  mount(el, html`
    ${pageHead('Due dates', html`<span id="due-count"></span>`, html`
      <button class="btn no-print" id="export">${icon('download', 16)} Export CSV</button>
      <button class="btn no-print" id="print">${icon('file', 16)} Print</button>
      ${res.canSettings ? html`<a class="btn no-print" href="#/settings?section=due-dates">${icon('settings', 16)} Alert settings</a>` : ''}`)}
    <p class="print-only muted small" id="print-filters"></p>
    ${!rulesOn.length ? html`<div class="card empty">${icon('bell', 40)}<h2>Every due-date rule is off</h2><p>Turn rules on under HR settings → Alerts and due dates.</p>${res.canSettings ? html`<p><a class="btn primary" href="#/settings?section=due-dates">Open the settings</a></p>` : ''}</div>` : html`
    <div class="stats due-stats no-print" id="due-stats"></div>
    <section class="card">
      <div class="toolbar no-print">
        <input type="search" id="f-q" placeholder="Search name, number, position…" value="${f.q}" aria-label="Search" />
        <select id="f-rule" aria-label="Rule"><option value="">Every rule</option>${rulesOn.map((r) => option(r.kind, r.name, f.rule === r.kind))}</select>
        ${multiCampus ? html`<select id="f-campusId" aria-label="Campus"><option value="">All my campuses</option>${res.campuses.map((c) => option(c.id, c.name, f.campusId === c.id))}</select>` : ''}
        <select id="f-office" aria-label="Office"><option value="">All offices</option>${offices.map((o) => option(o, o, f.office === o))}</select>
        <select id="f-window" aria-label="When">${WINDOWS.map(([k, l]) => option(k, k === 'overdue' ? l : `Overdue and ${l.toLowerCase()}`, f.window === k))}</select>
        <label class="check-inline"><input type="checkbox" id="f-closed" ${f.closed ? 'checked' : ''} /> Show snoozed and done</label>
      </div>
      <div id="due-table" class="scroll-x"></div>
    </section>
    ${missing.length ? html`<details class="card due-missing no-print">
      <summary><strong>${missing.length} date${missing.length === 1 ? ' is' : 's are'} missing</strong> <span class="muted small">· ${rulesOn.filter((r) => missing.some((m) => m.kind === r.kind)).map((r) => `${r.name} ${missing.filter((m) => m.kind === r.kind).length}`).join(' · ')}</span></summary>
      <p class="muted small">These employees are left out of a rule until the date is on their record (Employees → Edit → Dates for due-date alerts). ATLAS never guesses a date.</p>
      ${groups.map(([k, list]) => html`<h3 class="due-missing-h">${ruleName(k.split('|')[0])}: ${list[0].reason.charAt(0).toLowerCase()}${list[0].reason.slice(1)} (${list.length})</h3>
        <p class="small">${list.map((m, i) => html`${i ? ', ' : ''}${m.name}${multiCampus ? html` <span class="muted">(${m.campusName})</span>` : ''}`)}</p>`)}
    </details>` : ''}`}`);
  if (!rulesOn.length) return;

  for (const k of FILTER_KEYS) {
    const input = el.querySelector(`#f-${k}`);
    input?.addEventListener(k === 'q' ? 'input' : 'change', () => ((f[k] = k === 'closed' ? (input.checked ? '1' : '') : input.value), render()));
  }
  el.querySelector('#due-stats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-window]');
    if (!b) return;
    f.window = b.dataset.window;
    el.querySelector('#f-window').value = f.window;
    render();
  });
  el.querySelector('#print').addEventListener('click', () => window.print());
  el.querySelector('#export').addEventListener('click', () => {
    const rows = pick().map((r) => [r.employee.employeeNo, r.employee.name, r.ruleName, r.due, r.daysLeft, r.employee.position, r.employee.status, sgText(r.employee), r.employee.office, r.employee.campusName,
      r.state === 'open' ? 'Open' : r.state === 'done' ? `Done ${r.mark.on}` : `Snoozed until ${r.mark.until}`, r.mark?.note || '', r.detail]);
    downloadFile(`due-dates-${today()}.csv`, toCsv([['Employee No', 'Employee', 'What', 'Due date', 'Days left', 'Position', 'Status of appointment', 'Salary grade', 'Office', 'Campus', 'State', 'Note', 'Details'], ...rows]));
  });
  el.querySelector('#due-table').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-done], button[data-snooze], button[data-reopen]');
    if (!b) return;
    const r = res.rows.find((x) => x.key === (b.dataset.done || b.dataset.snooze || b.dataset.reopen));
    if (b.dataset.done) doneDialog(r, res, reload);
    else if (b.dataset.snooze) snoozeDialog(r, reload);
    else reopen(r, reload);
  });
  render();
}

function doneDialog(r, res, reload) {
  const step = r.kind === 'step';
  modal({
    title: `Mark done: ${r.ruleName}`,
    subtitle: `${r.employee.name} · due ${longDate(r.due)}`,
    submitLabel: 'Mark done',
    body: html`<label class="field"><span>Done on</span><input type="date" name="on" value="${today()}" max="${today()}" required /></label>
      <label class="field"><span>Note</span><textarea name="note" rows="2" maxlength="${LIMITS.note}" placeholder="${NOTE_HINT[r.kind] || ''}"></textarea><span class="hint">Kept with the date and in the audit log.</span></label>
      ${step ? html`<label class="check-inline"><input type="checkbox" name="recordStep" ${res.canEdit ? 'checked' : 'disabled'} /> Record this date on the employee record as the date of last step increment</label>
        <p class="muted small">The next step increment then counts from it. The step and the salary are not changed: edit the record for that.</p>` : ''}
      ${r.kind === 'renewal' ? html`<p class="muted small">Confirming a new appointment for ${r.employee.name} marks this done by itself.</p>` : ''}`,
    async onSubmit(form) {
      const fd = new FormData(form);
      await api.post('/api/hris/due-dates/done', { key: r.key, on: fd.get('on'), note: fd.get('note'), recordStep: step && fd.has('recordStep') });
      toast(`${r.ruleName} for ${r.employee.name} marked done.`);
      reload();
    },
  });
}
function snoozeDialog(r, reload) {
  modal({
    title: `Snooze: ${r.ruleName}`,
    subtitle: `${r.employee.name} · due ${longDate(r.due)}`,
    submitLabel: 'Snooze',
    body: html`<label class="field"><span>Snooze for</span><select name="days">${[7, 14, 30, 60, 90].map((d) => option(d, `${d} days (until ${fmtDate(addDaysLocal(today(), d))})`, d === 7))}</select><span class="hint">It leaves the list and the bell until then, and comes back by itself.</span></label>
      <label class="field"><span>Note</span><textarea name="note" rows="2" maxlength="${LIMITS.note}" placeholder="e.g. Waiting for the performance rating from the office"></textarea></label>`,
    async onSubmit(form) {
      const fd = new FormData(form);
      const out = await api.post('/api/hris/due-dates/snooze', { key: r.key, days: Number(fd.get('days')), note: fd.get('note') });
      toast(`Snoozed until ${fmtDate(out.until)}.`);
      reload();
    },
  });
}
async function reopen(r, reload) {
  await api.post('/api/hris/due-dates/reopen', { key: r.key });
  toast('Reopened.');
  reload();
}
const addDaysLocal = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + n);
  return today(d);
};

// ----- HR settings → Alerts and due dates -----
export async function dueSettingsCard(box) {
  const s = await api.get('/api/hris/due-dates/settings');
  const tag = html`<span class="badge amber" title="${s.confirmNote}">To confirm</span>`;
  mount(box, html`<form class="card" id="due-dates" novalidate>
    <div class="card-head"><h2>${icon('bell')} Alerts and due dates ${tag}</h2>${s.updatedAt ? html`<span class="muted small">Changed by ${s.updatedBy}, ${fmtDate(s.updatedAt.slice(0, 10))}</span>` : ''}</div>
    <p class="muted small">People → <a href="#/due-dates">Due dates</a> lists every employee with one of these dates coming up, and the bell tells people once at each lead day (days before the date). <strong>HR</strong> means the accounts with the Due dates permission at the employee's campus (the HR Manager by default). The rules and numbers are defaults. ${s.confirmNote}.</p>
    ${s.kinds.map((k) => {
      const r = s.rules[k.kind];
      return html`<fieldset class="due-rule" data-kind="${k.kind}">
        <legend><label class="check-inline"><input type="checkbox" name="on" ${r.on ? 'checked' : ''} /> <strong>${k.label}</strong></label></legend>
        <p class="muted small">${k.explain}</p>
        <div class="grid">
          <label class="field"><span>Name on the list and the bell</span><input name="name" value="${r.name}" maxlength="${LIMITS.name}" required /></label>
          <label class="field"><span>Lead days</span><input name="leadDays" value="${r.leadDays.join(', ')}" inputmode="numeric" required /><span class="hint">Days before the date, e.g. 60, 30, 7 (at most ${LIMITS.leadDays}); 0 is the day itself.</span></label>
          ${k.param ? html`<label class="field"><span>${k.param.label}</span><input type="number" name="${k.param.key}" value="${r[k.param.key]}" min="${k.param.min}" max="${k.param.max}" required /></label>` : html`<span></span>`}
          ${k.kind === 'renewal' ? html`<div class="field span-3"><span>Statuses of appointment</span><div class="days">${s.statuses.filter((x) => !['Permanent', 'Regular'].includes(x) || r.statuses.includes(x)).map((x) => html`<label><input type="checkbox" name="statuses" value="${x}" ${r.statuses.includes(x) ? 'checked' : ''} /> ${x}</label>`)}</div><span class="hint">Only an appointment with an end date on the employee record is counted.</span></div>` : ''}
          <div class="field span-3"><span>Who is told on the bell</span><div class="days">
            <label><input type="checkbox" name="tellHr" ${r.tellHr ? 'checked' : ''} /> HR</label>
            ${k.employee ? html`<label><input type="checkbox" name="tellEmployee" ${r.tellEmployee ? 'checked' : ''} /> The employee (also shown on their My HR record)</label>` : ''}
          </div></div>
        </div>
      </fieldset>`;
    })}
    <p class="muted small">${icon('alert', 12)} ATLAS does not link an employee to a head of office or supervisor, so it cannot tell them. Step increments are reminders only: they never change a step or a salary.</p>
    <p class="form-error" hidden></p>
    <div class="actions end"><button class="btn primary" type="submit">Save alert settings</button></div>
  </form>`);
  const form = box.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('.form-error');
    const body = {};
    for (const fs of form.querySelectorAll('fieldset[data-kind]')) {
      const k = s.kinds.find((x) => x.kind === fs.dataset.kind);
      const val = (n) => fs.querySelector(`[name="${n}"]`);
      const lead = parseLeadDays(val('leadDays').value);
      body[k.kind] = {
        on: val('on').checked, name: val('name').value, leadDays: lead || val('leadDays').value, tellHr: val('tellHr').checked, tellEmployee: Boolean(val('tellEmployee')?.checked),
        ...(k.param ? { [k.param.key]: Number(val(k.param.key).value) } : {}),
        ...(k.kind === 'renewal' ? { statuses: [...fs.querySelectorAll('[name="statuses"]:checked')].map((x) => x.value) } : {}),
      };
    }
    try {
      await api.put('/api/hris/due-dates/settings', body);
      errEl.hidden = true;
      toast('Alert settings saved.');
      dueSettingsCard(box);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });
}

// ----- My HR record → Coming up (only the rules HR set to tell the employee) -----
export async function myDueDatesCard(box) {
  const { items } = await api.get('/api/hris/me/due-dates');
  box.hidden = !items.length;
  if (!items.length) return;
  mount(box, html`<div class="card-head"><h2>${icon('calendar')} Coming up</h2></div>
    <ul class="link-list due-mine">${items.map((x) => html`<li><strong>${x.text} ${longDate(x.due)}</strong> <span class="muted small">(${whenText(x.daysLeft)})</span></li>`)}</ul>
    <p class="muted small">From your HR record. If a date is wrong, or to ask about the next steps, contact HR.</p>`);
}
