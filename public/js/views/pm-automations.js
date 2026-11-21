// A project's Automations tab (0.61): its recurring tasks (tasks CORE makes on a schedule) and the
// run log (each time an automation ran: made a task, skipped, or failed). Anyone who can open the
// project reads it; its managers set the recurring tasks up. Server: server/pm-automation.js.
import { api } from '../api.js';
import { html, mount, badge, toast, modal, confirmDialog, fmtDate, today } from '../ui.js';
import { icon } from '../icons.js';
import { PRIORITY, SIZES, sizeName } from '/shared/projects.js';
import { FREQS, WEEKDAYS, MAX_EVERY, MAX_DUE_IN, cleanSchedule, upcoming, describeSchedule } from '/shared/pm-recurring.js';
import { projectHeader, loadProject, guard, options, plural, may, sizeChip, when, short, popMenu } from './projects.js';

const RESULT = { done: ['Made', 'green'], warning: ['Made, with a note', 'amber'], skipped: ['Skipped', 'gray'], failed: ['Failed', 'red'] };
const dayLabel = (ymd) => (ymd ? fmtDate(ymd, { weekday: 'short', month: 'short', day: 'numeric' }) : '');
const MONTH_DAYS = [...Array.from({ length: 31 }, (_, i) => [String(i + 1), `Day ${i + 1}`]), ['first-work', 'First working day'], ['last-work', 'Last working day']];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
// A new weekly schedule starts on today's weekday (Monday on a weekend).
const weekdayOrMonday = (ymd) => {
  const d = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6 ? 1 : d;
};

export async function automationsView(el, { id }) {
  const [p, data] = await Promise.all([loadProject(id), api.get(`/api/pm/projects/${id}/automations`)]);
  const manage = data.canManage;
  const reload = () => automationsView(el, { id });
  const cal = { workDays: data.calendar.workDays, off: new Set(data.calendar.off) };
  let filter = '';

  const notice = p.isTemplate
    ? html`<p class="notice info">${icon("layers", 16)} A template is a pattern: its recurring tasks are copied, without assignees, into each project made from it, and start there.</p>`
    : !data.open ? html`<p class="notice">${icon('alert', 16)} This project is ${data.projectStatus}: no recurring tasks are made until it is Planning or Active again. The days in between are passed over, not made later.</p>` : '';

  const nextLine = (r) => {
    if (!r.active) return html`<span class="muted">Paused: nothing is made until it is turned back on.</span>`;
    if (r.ended) return html`<span class="muted">Ended: no dates left before its end date.</span>`;
    return html`Next: <strong>${dayLabel(r.nextOn)}</strong>${r.upcoming.length > 1 ? html`<span class="muted"> · then ${r.upcoming.filter((x) => x !== r.nextOn).slice(0, 2).map(short).join(', ')}</span>` : ''}`;
  };
  const card = (r) => html`<li class="pm-rec ${r.active ? '' : 'paused'}" data-rec="${r.id}">
      <span class="pm-rec-ic" aria-hidden="true">${icon('repeat', 18)}</span>
      <div class="pm-rec-main">
        <div class="pm-rec-top"><strong class="pm-rec-title">${r.title}</strong>${r.active ? '' : badge('Paused', 'gray')}${r.ended ? badge('Ended', 'gray') : ''}</div>
        <p class="pm-rec-when">${icon('calendar', 14)}<span>${r.scheduleText}${r.schedule.until ? html`<span class="muted">, until ${fmtDate(r.schedule.until)}</span>` : ''}</span></p>
        <p class="pm-rec-next">${nextLine(r)}</p>
        <p class="pm-rec-meta muted small">
          ${r.assigneeName ? html`<span class="${r.assigneeOk ? '' : 'pm-rec-warn'}" title="${r.assigneeOk ? '' : 'Not a member who can take tasks any more: the tasks are made unassigned.'}">${icon('user', 13)} ${r.assigneeName}</span>` : html`<span>${icon('user', 13)} Unassigned</span>`}
          <span>${r.statusName}</span>
          ${r.dueIn == null ? html`<span>No due date</span>` : html`<span>Due ${r.dueIn === 0 ? 'the same day' : `${plural(r.dueIn, 'working day')} later`}</span>`}
          ${r.priority !== 'normal' ? html`<span>${PRIORITY[r.priority]} priority</span>` : ''}
          ${r.size ? sizeChip(r.size) : ''}
          ${r.checklist.length ? html`<span>${icon('checkSquare', 13)} ${plural(r.checklist.length, 'checklist item')}</span>` : ''}
          ${r.skipIfOpen ? html`<span title="Nothing is made while the task from last time is still open.">Skips while the last one is open</span>` : ''}
        </p>
        ${r.lastTask ? html`<p class="small">Last made: <a href="#/projects/${id}/tasks/${r.lastTask.id}"><span class="mono">${r.lastTask.key}</span> ${r.lastTask.title}</a> ${r.lastTask.open ? badge('Open', 'blue') : badge('Closed', 'gray')} <span class="muted">· ${plural(r.made, 'task')} so far</span></p>` : html`<p class="small muted">Nothing made yet.</p>`}
      </div>
      ${manage ? html`<div class="pm-rec-actions">
        <label class="switch" title="${r.active ? 'On: tasks are made on schedule' : 'Paused'}"><input type="checkbox" data-toggle="${r.id}" ${r.active ? 'checked' : ''} aria-label="${r.active ? 'Pause' : 'Turn on'} “${r.title}”" /></label>
        <button type="button" class="icon-btn" data-more="${r.id}" aria-haspopup="menu" aria-expanded="false" aria-label="More for “${r.title}”" title="More">${icon('more', 18)}</button>
      </div>` : ''}
    </li>`;

  const runRow = (x) => {
    const [label, tone] = RESULT[x.result] || [x.result, 'gray'];
    return html`<tr>
      <td class="nowrap">${when(x.at)}</td>
      <td>${icon('repeat', 13)} ${x.name}${x.day ? html`<small class="muted">for ${dayLabel(x.day)}${x.byName !== 'CORE' ? ` · by ${x.byName}` : ''}</small>` : ''}</td>
      <td>${badge(label, tone)}</td>
      <td>${x.taskId ? html`<a href="#/projects/${id}/tasks/${x.taskId}" class="mono">${x.taskKey}</a>` : x.taskKey ? html`<span class="mono muted" title="Deleted">${x.taskKey}</span>` : html`<span class="muted">—</span>`}</td>
      <td class="pm-run-note">${x.note || html`<span class="muted">—</span>`}</td>
    </tr>`;
  };
  const runsCard = () => {
    const list = data.runs.filter((x) => !filter || x.result === filter || (filter === 'done' && x.result === 'warning'));
    return html`<section class="card scroll-x" id="pm-runs">
      <div class="card-head"><h2>${icon('activity')} Run log</h2>
        <label class="field inline"><span class="sr-only">Show</span><select id="run-filter">${options([['', 'All runs'], ['done', 'Made a task'], ['skipped', 'Skipped'], ['failed', 'Failed']], filter)}</select></label></div>
      <p class="muted small pad">Each time an automation ran, newest first: the project's last 200 runs, for 90 days. A failure is also sent to the project's managers.</p>
      ${list.length ? html`<table class="table pm-runs"><thead><tr><th>When</th><th>Automation</th><th>Result</th><th>Task</th><th>Note</th></tr></thead><tbody>${list.slice(0, 50).map(runRow)}</tbody></table>
        ${list.length > 50 ? html`<details class="pad"><summary>${plural(list.length - 50, 'older run')}</summary><table class="table pm-runs"><tbody>${list.slice(50).map(runRow)}</tbody></table></details>` : ''}`
    : html`<p class="muted pad">${data.runs.length ? 'No runs of this kind.' : 'Nothing has run yet.'}</p>`}
    </section>`;
  };

  const draw = () => mount(el, html`
    ${projectHeader(p, 'automations', manage ? html`<button type="button" class="btn primary" id="rec-new" ${data.recurring.length >= data.max ? 'disabled' : ''}>${icon('plus', 16)} New recurring task</button>` : '')}
    ${notice}
    <section class="card" id="pm-recurring">
      <h2>${icon('repeat')} Recurring tasks</h2>
      <p class="muted small pad">Tasks CORE makes on a schedule, such as a weekly report or a month-end check, with the same title, assignee, checklist and due date each time. ${manage ? '' : 'The project\'s managers set them up.'}</p>
      ${data.recurring.length ? html`<ul class="pm-recs">${data.recurring.map(card)}</ul>` : html`<div class="empty small">${icon('repeat', 32)}<p>No recurring tasks yet.${manage ? ' Add one for work that comes back on a schedule.' : ''}</p></div>`}
    </section>
    ${runsCard()}`);

  const wire = () => {
    el.querySelector('#rec-new')?.addEventListener('click', () => editRecurring(p, data, cal, null, reload));
    wireFilter();
    el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('change', guard(async () => {
      const r = data.recurring.find((x) => x.id === b.dataset.toggle);
      const out = await api.put(`/api/pm/projects/${id}/recurring/${r.id}`, { active: b.checked, version: r.version });
      toast(out.active ? `On. ${out.madeTask ? `Made ${out.madeTask.taskKey} for today.` : out.nextOn ? `Next: ${dayLabel(out.nextOn)}.` : ''}` : 'Paused.');
      await reload();
    }, reload)));
    el.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-expanded') === 'true') return;
      const r = data.recurring.find((x) => x.id === b.dataset.more);
      popMenu(b, [
        { label: 'Edit…', onPick: () => editRecurring(p, data, cal, r, reload) },
        { label: 'Make one now', sub: 'A task for today, whatever the schedule', disabled: p.isTemplate, onPick: guard(async () => {
          const out = await api.post(`/api/pm/projects/${id}/recurring/${r.id}/run`, {});
          toast(`Made ${out.madeTask.taskKey}.`);
          await reload();
        }, reload) },
        { sep: true },
        { label: 'Delete…', onPick: guard(async () => {
          if (!(await confirmDialog(`Delete the recurring task “${r.title}”? Tasks it already made stay.`, { title: 'Delete recurring task' }))) return;
          await api.del(`/api/pm/projects/${id}/recurring/${r.id}`);
          toast('Deleted.');
          await reload();
        }, reload) },
      ], `More for ${r.title}`);
    }));
  };
  // The filter redraws only the log.
  function wireFilter() {
    el.querySelector('#run-filter')?.addEventListener('change', (e) => {
      filter = e.target.value;
      el.querySelector('#pm-runs').outerHTML = String(runsCard());
      wireFilter();
      el.querySelector('#run-filter')?.focus();
    });
  }
  draw();
  wire();
}

// New or Edit recurring task. The next dates are shown as the schedule is filled in.
function editRecurring(p, data, cal, rec, after) {
  const r = rec || { title: '', description: '', schedule: { freq: 'weekly', every: 1, days: [weekdayOrMonday(today())], monthDay: Number(today().slice(8, 10)), workingDays: true, start: today(), until: null }, assigneeId: '', statusId: '', priority: 'normal', size: null, dueIn: null, checklist: [], skipIfOpen: true };
  const s = r.schedule;
  const takers = p.members.filter((m) => m.role !== 'viewer' && m.active);
  const unit = { daily: ['day', 'days'], weekly: ['week', 'weeks'], monthly: ['month', 'months'] };
  const { form } = modal({
    title: rec ? 'Edit recurring task' : 'New recurring task', wide: true, className: 'pm-rec-form',
    subtitle: rec ? `${p.code} · changes apply to the tasks made from now on` : `${p.code} · CORE makes this task on the schedule you set`,
    submitLabel: rec ? 'Save' : 'Add recurring task',
    body: html`<div class="grid two">
      <label class="field span-2"><span>Task title<em>*</em></span><input name="title" value="${r.title}" maxlength="200" required placeholder="e.g. Weekly status report" /></label>
      <fieldset class="field span-2 pm-rec-sched"><legend>Repeats</legend>
        <div class="pm-rec-row">
          <label class="field"><span>How often</span><select name="freq">${options(Object.entries(FREQS), s.freq)}</select></label>
          <label class="field pm-rec-every"><span>Every</span><span class="pm-rec-every-in"><input type="number" name="every" min="1" max="${MAX_EVERY[s.freq]}" value="${s.every || 1}" inputmode="numeric" /><span id="every-unit">${(s.every || 1) === 1 ? unit[s.freq][0] : unit[s.freq][1]}</span></span></label>
          <label class="field pm-rec-month" ${s.freq === 'monthly' ? '' : 'hidden'}><span>On</span><select name="monthDay">${options(MONTH_DAYS, String(s.monthDay ?? Number(today().slice(8, 10))))}</select></label>
        </div>
        <div class="pm-rec-days" role="group" aria-label="On these days" ${s.freq === 'weekly' ? '' : 'hidden'}>
          ${WEEK_ORDER.map((d) => html`<label class="pm-day"><input type="checkbox" name="days" value="${d}" ${(s.days || []).includes(d) ? 'checked' : ''} /><span>${WEEKDAYS[d]}</span></label>`)}
        </div>
        <label class="check"><input type="checkbox" name="workingDays" ${s.workingDays !== false ? 'checked' : ''} /><span id="wd-label"></span></label>
        <div class="pm-rec-row">
          <label class="field"><span>Starts</span><input type="date" name="start" value="${s.start}" required /></label>
          <label class="field"><span>Ends</span><input type="date" name="until" value="${s.until || ''}" /><small class="hint">Optional: leave empty to keep going.</small></label>
        </div>
        <p class="pm-rec-preview" id="rec-preview" aria-live="polite"></p>
      </fieldset>
      <label class="field"><span>Assignee</span><select name="assigneeId"><option value="">Unassigned</option>${options(takers.map((m) => [m.userId, m.name]), r.assigneeId || '')}</select></label>
      <label class="field"><span>Status</span><select name="statusId"><option value="">${p.statuses.find((x) => x.category === 'todo')?.name || 'To do'} (first column)</option>${options(p.statuses.filter((x) => !['done', 'cancelled'].includes(x.category)).map((x) => [x.id, x.name]), r.statusId || '')}</select></label>
      <label class="field"><span>Priority</span><select name="priority">${options(Object.entries(PRIORITY), r.priority || 'normal')}</select></label>
      <label class="field"><span>Size</span><select name="size"><option value="">None</option>${options(Object.keys(SIZES).map((k) => [k, `${k} · ${sizeName(k)}`]), r.size || '')}</select></label>
      <label class="field"><span>Due</span><span class="pm-rec-due"><input type="number" name="dueIn" min="0" max="${MAX_DUE_IN}" value="${r.dueIn ?? ''}" inputmode="numeric" placeholder="—" aria-describedby="due-hint" /><span>working days after it is made</span></span><small class="hint" id="due-hint">0: due the same day. Empty: no due date.</small></label>
      <div class="field"><span class="label">When the last one is still open</span><label class="check"><input type="checkbox" name="skipIfOpen" ${r.skipIfOpen !== false ? 'checked' : ''} /><span>Skip: make nothing until it is done</span></label></div>
      <label class="field span-2"><span>Description</span><textarea name="description" rows="3" maxlength="8000" placeholder="Copied into each task (optional)">${r.description || ''}</textarea></label>
      <label class="field span-2"><span>Checklist</span><textarea name="checklist" rows="3" placeholder="One item per line (optional)">${(r.checklist || []).join('\n')}</textarea><small class="hint">Each task gets the list, unticked.</small></label>
    </div>`,
    onSubmit: async (f) => {
      const body = {
        title: f.title.value, description: f.description.value, schedule: schedule(f), assigneeId: f.assigneeId.value || null, statusId: f.statusId.value || null,
        priority: f.priority.value, size: f.size.value || null, dueIn: f.dueIn.value === '' ? null : Number(f.dueIn.value), skipIfOpen: f.skipIfOpen.checked,
        checklist: f.checklist.value.split('\n').map((x) => x.trim()).filter(Boolean), ...(rec ? { version: rec.version, active: rec.active } : {}),
      };
      const out = rec ? await api.put(`/api/pm/projects/${p.id}/recurring/${rec.id}`, body) : await api.post(`/api/pm/projects/${p.id}/recurring`, body);
      toast(out.madeTask ? `Saved. Today's is made: ${out.madeTask.taskKey}.` : out.nextOn ? `Saved. The next is made on ${dayLabel(out.nextOn)}.` : 'Saved.');
      await after();
    },
  });
  // The schedule as the form has it.
  function schedule(f) {
    return {
      freq: f.freq.value, every: Number(f.every.value) || 1, days: [...f.querySelectorAll('[name=days]:checked')].map((x) => Number(x.value)),
      monthDay: /^\d+$/.test(f.monthDay.value) ? Number(f.monthDay.value) : f.monthDay.value, workingDays: f.workingDays.checked, start: f.start.value, until: f.until.value || null,
    };
  }
  const preview = form.querySelector('#rec-preview');
  function update() {
    const freq = form.freq.value;
    form.every.max = MAX_EVERY[freq];
    form.querySelector('#every-unit').textContent = Number(form.every.value) === 1 ? unit[freq][0] : unit[freq][1];
    form.querySelector('.pm-rec-days').hidden = freq !== 'weekly';
    form.querySelector('.pm-rec-month').hidden = freq !== 'monthly';
    form.querySelector('#wd-label').textContent = freq === 'daily' ? 'Skip weekends and holidays' : 'A date on a weekend or holiday moves to the next working day';
    const c = cleanSchedule(schedule(form));
    if (c.error) {
      preview.className = 'pm-rec-preview muted';
      preview.textContent = c.error;
      return;
    }
    const from = c.schedule.start > today() ? c.schedule.start : today();
    const next = upcoming(c.schedule, from, 4, cal);
    preview.className = 'pm-rec-preview';
    mount(preview, html`${icon('calendar', 14)} <strong>${describeSchedule(c.schedule)}.</strong> ${next.length ? html`Next: ${next.map(dayLabel).join(', ')}${next[0] === today() ? ' (today’s is made as soon as you save)' : ''}.` : html`<span class="muted">No dates left before the end date.</span>`}`);
  }
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
}
