// A project's Automations tab: its recurring tasks (tasks CORE makes on a schedule, 0.61), its rules
// ("When a task … If … Then …", 0.62) and the run log (each time an automation ran: what it did,
// or why it skipped or failed). Anyone who can open the project reads it; its managers set them up.
// Server: server/pm-automation.js.
import { api } from '../api.js';
import { html, raw, mount, badge, toast, modal, confirmDialog, fmtDate, today } from '../ui.js';
import { icon } from '../icons.js';
import { PRIORITY, SIZES, sizeName } from '/shared/projects.js';
import { FREQS, WEEKDAYS, MAX_EVERY, MAX_DUE_IN, cleanSchedule, upcoming, describeSchedule } from '/shared/pm-recurring.js';
import { RULE_EVENTS, RULE_FIELDS, FIELD_OPS, OPS, TASK_KINDS, RULE_ACTIONS, WHO, NOTIFY_TO, MAX_CONDITIONS, MAX_ACTIONS } from '/shared/pm-rules.js';
import { projectHeader, loadProject, guard, options, plural, may, sizeChip, when, short, popMenu } from './projects.js';

const RESULT = { done: ['Made', 'green'], warning: ['Made, with a note', 'amber'], skipped: ['Skipped', 'gray'], failed: ['Failed', 'red'] };
const resultOf = (x) => (x.kind === 'rule' && x.result === 'done' ? ['Ran', 'green'] : RESULT[x.result] || [x.result, 'gray']);
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

  const ruleCard = (r) => html`<li class="pm-rec pm-rule ${r.active ? '' : 'paused'}" data-rule="${r.id}">
      <span class="pm-rec-ic pm-rule-ic" aria-hidden="true">${icon('bolt', 18)}</span>
      <div class="pm-rec-main">
        <div class="pm-rec-top"><strong class="pm-rec-title">${r.name}</strong>${r.active ? '' : badge('Off', 'gray')}</div>
        <ol class="pm-rule-steps">
          <li><span class="pm-rule-k">When</span><span>${r.text.when.replace(/^When /, '')}</span></li>
          ${r.text.conditions.length ? html`<li><span class="pm-rule-k">If</span><span>${r.text.conditions.join(', and ')}</span></li>` : ''}
          <li><span class="pm-rule-k">Then</span><span>${r.text.actions.join(', then ')}</span></li>
        </ol>
        <p class="muted small">${r.runs ? `Ran ${plural(r.runs, 'time')}, last ${when(r.lastRunAt)}` : 'Has not run yet'} · by ${r.createdByName}</p>
      </div>
      ${manage ? html`<div class="pm-rec-actions">
        <label class="switch" title="${r.active ? 'On' : 'Off'}"><input type="checkbox" data-rule-toggle="${r.id}" ${r.active ? 'checked' : ''} aria-label="${r.active ? 'Turn off' : 'Turn on'} the rule “${r.name}”" /></label>
        <button type="button" class="icon-btn" data-rule-more="${r.id}" aria-haspopup="menu" aria-expanded="false" aria-label="More for “${r.name}”" title="More">${icon('more', 18)}</button>
      </div>` : ''}
    </li>`;

  const runRow = (x) => {
    const [label, tone] = resultOf(x);
    return html`<tr>
      <td class="nowrap">${when(x.at)}</td>
      <td>${icon(x.kind === 'rule' ? 'bolt' : 'repeat', 13)} ${x.name}<small class="muted">${x.kind === 'rule' ? 'Rule' : 'Recurring task'}${x.day ? ` · for ${dayLabel(x.day)}` : ''}${x.byName !== 'CORE' ? ` · by ${x.byName}` : ''}</small></td>
      <td>${badge(label, tone)}</td>
      <td>${x.taskId ? html`<a href="#/projects/${id}/tasks/${x.taskId}" class="mono">${x.taskKey}</a>` : x.taskKey ? html`<span class="mono muted" title="Deleted">${x.taskKey}</span>` : html`<span class="muted">—</span>`}</td>
      <td class="pm-run-note">${x.note || html`<span class="muted">—</span>`}</td>
    </tr>`;
  };
  const runsCard = () => {
    const list = data.runs.filter((x) => !filter || x.result === filter || x.kind === filter);
    return html`<section class="card scroll-x" id="pm-runs">
      <div class="card-head"><h2>${icon('activity')} Run log</h2>
        <label class="field inline"><span class="sr-only">Show</span><select id="run-filter">${options([['', 'All runs'], ['recurring', 'Recurring tasks'], ['rule', 'Rules'], ['skipped', 'Skipped'], ['failed', 'Failed']], filter)}</select></label></div>
      <p class="muted small pad">Each time an automation ran, newest first: the project's last 200 runs, for 90 days. A failure is also sent to the project's managers.</p>
      ${list.length ? html`<table class="table pm-runs"><thead><tr><th>When</th><th>Automation</th><th>Result</th><th>Task</th><th>Note</th></tr></thead><tbody>${list.slice(0, 50).map(runRow)}</tbody></table>
        ${list.length > 50 ? html`<details class="pad"><summary>${plural(list.length - 50, 'older run')}</summary><table class="table pm-runs"><tbody>${list.slice(50).map(runRow)}</tbody></table></details>` : ''}`
    : html`<p class="muted pad">${data.runs.length ? 'No runs of this kind.' : 'Nothing has run yet.'}</p>`}
    </section>`;
  };

  const draw = () => mount(el, html`
    ${projectHeader(p, 'automations', manage ? html`<button type="button" class="btn" id="rule-new" ${data.rules.length >= data.maxRules ? 'disabled' : ''}>${icon('bolt', 16)} New rule</button><button type="button" class="btn primary" id="rec-new" ${data.recurring.length >= data.max ? 'disabled' : ''}>${icon('plus', 16)} New recurring task</button>` : '')}
    ${notice}
    <section class="card" id="pm-recurring">
      <h2>${icon('repeat')} Recurring tasks</h2>
      <p class="muted small pad">Tasks CORE makes on a schedule, such as a weekly report or a month-end check, with the same title, assignee, checklist and due date each time. ${manage ? '' : 'The project\'s managers set them up.'}</p>
      ${data.recurring.length ? html`<ul class="pm-recs">${data.recurring.map(card)}</ul>` : html`<div class="empty small">${icon('repeat', 32)}<p>No recurring tasks yet.${manage ? ' Add one for work that comes back on a schedule.' : ''}</p></div>`}
    </section>
    <section class="card" id="pm-rules">
      <h2>${icon('bolt')} Rules</h2>
      <p class="muted small pad">When something happens to a task, CORE does the rest: <em>when a task moves to Done, tell the managers</em>; <em>when a task is overdue, raise its priority</em>. Rules run at once, as CORE.${manage ? '' : ' The project\'s managers set them up.'}</p>
      ${data.rules.length ? html`<ul class="pm-recs">${data.rules.map(ruleCard)}</ul>` : html`<div class="empty small">${icon('bolt', 32)}<p>No rules yet.${manage ? ' Add one, or start from an example.' : ''}</p></div>`}
    </section>
    ${runsCard()}`);

  const wire = () => {
    el.querySelector('#rec-new')?.addEventListener('click', () => editRecurring(p, data, cal, null, reload));
    el.querySelector('#rule-new')?.addEventListener('click', () => editRule(p, data, null, reload));
    el.querySelectorAll('[data-rule-toggle]').forEach((b) => b.addEventListener('change', guard(async () => {
      const r = data.rules.find((x) => x.id === b.dataset.ruleToggle);
      const out = await api.put(`/api/pm/projects/${id}/rules/${r.id}`, { active: b.checked, version: r.version });
      toast(out.active ? 'Rule on.' : 'Rule off.');
      await reload();
    }, reload)));
    el.querySelectorAll('[data-rule-more]').forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-expanded') === 'true') return;
      const r = data.rules.find((x) => x.id === b.dataset.ruleMore);
      popMenu(b, [
        { label: 'Edit…', onPick: () => editRule(p, data, r, reload) },
        { label: 'Duplicate…', sub: 'A copy to change', disabled: data.rules.length >= data.maxRules, onPick: () => editRule(p, data, { ...r, id: null, name: `${r.name} (copy)` }, reload) },
        { sep: true },
        { label: 'Delete…', onPick: guard(async () => {
          if (!(await confirmDialog(`Delete the rule “${r.name}”? What it already did stays.`, { title: 'Delete rule' }))) return;
          await api.del(`/api/pm/projects/${id}/rules/${r.id}`);
          toast('Deleted.');
          await reload();
        }, reload) },
      ], `More for ${r.name}`);
    }));
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

// ---------- Rules (0.62) ----------
// Examples to start from: each fills the form, to change before saving.
function examples(p) {
  const st = (cat, fallback) => p.statuses.find((x) => x.category === cat && x.id !== 'cancelled')?.id || fallback;
  const review = p.statuses.find((x) => /review/i.test(x.name))?.id || st('active', p.statuses[0].id);
  const done = st('done', p.statuses[0].id);
  return [
    { name: 'Tell the managers when a task is done', when: { event: 'status', statusId: done }, conditions: [], actions: [{ type: 'notify', to: 'managers', text: 'it is done' }] },
    { name: 'Raise overdue tasks', when: { event: 'overdue' }, conditions: [], actions: [{ type: 'priority', priority: 'high' }, { type: 'notify', to: 'assignee', text: 'it is overdue: finish it or agree a new due date' }] },
    { name: 'New tasks without an assignee go to the project manager', when: { event: 'created' }, conditions: [{ field: 'assignee', op: 'empty', value: null }], actions: [{ type: 'assign', to: 'manager' }] },
    { name: 'Parent to review when its subtasks are done', when: { event: 'subtasksDone' }, conditions: [], actions: [{ type: 'status', statusId: review }] },
    { name: 'Review checklist', when: { event: 'status', statusId: review }, conditions: [{ field: 'kind', op: 'is', value: 'top' }], actions: [{ type: 'checklist', items: ['Tested', 'Notes for the client written'] }, { type: 'watch', to: 'manager' }] },
    { name: 'Urgent tasks are watched by the manager', when: { event: 'created' }, conditions: [{ field: 'priority', op: 'is', value: 'urgent' }], actions: [{ type: 'watch', to: 'manager' }, { type: 'due', days: 1 }] },
  ];
}

function editRule(p, data, rec, after) {
  const members = p.members.filter((m) => m.active !== false);
  const takers = members.filter((m) => m.role !== 'viewer');
  const blank = { name: '', when: { event: 'status', statusId: p.statuses.find((x) => x.category === 'done')?.id || null }, conditions: [], actions: [{ type: 'notify', to: 'managers', text: '' }] };
  let r = structuredClone(rec ? { name: rec.name, when: rec.when, conditions: rec.conditions, actions: rec.actions } : blank);
  const ex = examples(p);
  const sel = (name, pairs, value, label, extra = '') => html`<select name="${name}" aria-label="${label}" ${raw(extra)}>${options(pairs, value ?? '')}</select>`;
  const statusPairs = p.statuses.map((x) => [x.id, x.name]);
  const people = (list) => list.map((m) => [m.userId, m.name]);
  const whoPairs = [...Object.entries(WHO), ...people(takers)];

  const condRow = (c, i) => {
    const ops = FIELD_OPS[c.field];
    const needs = c.op === 'is' || c.op === 'isNot' || c.op === 'contains' || c.op === 'notContains';
    const value = !needs ? '' : c.field === 'title' ? html`<input name="c-value" data-i="${i}" value="${c.value || ''}" maxlength="100" placeholder="words" aria-label="Words" />`
      : sel('c-value', ({ priority: Object.entries(PRIORITY), size: Object.keys(SIZES).map((k) => [k, `${k} · ${sizeName(k)}`]), kind: Object.entries(TASK_KINDS), status: statusPairs, milestone: data.milestones.map((m) => [m.id, m.name]), assignee: people(members) })[c.field], c.value, 'Value', `data-i="${i}"`);
    return html`<li class="pm-rule-row" data-i="${i}">
      ${sel('c-field', Object.entries(RULE_FIELDS), c.field, 'What', `data-i="${i}"`)}
      ${sel('c-op', ops.map((o) => [o, c.field === 'kind' ? (o === 'is' ? 'is' : 'is not') : OPS[o]]), c.op, 'Test', `data-i="${i}"`)}
      ${value}
      <button type="button" class="icon-btn danger" data-del-cond="${i}" aria-label="Remove this condition">${icon('x', 16)}</button></li>`;
  };
  const actRow = (a, i) => {
    const v = {
      status: () => sel('a-statusId', statusPairs, a.statusId, 'Status', `data-i="${i}"`),
      assign: () => sel('a-to', [['none', 'Nobody (unassign)'], ...whoPairs], a.to, 'Assign to', `data-i="${i}"`),
      priority: () => sel('a-priority', Object.entries(PRIORITY), a.priority, 'Priority', `data-i="${i}"`),
      due: () => html`<span class="pm-rec-due"><input type="number" name="a-days" data-i="${i}" min="0" max="60" value="${a.days ?? 0}" aria-label="Working days" /><span>working days after the rule runs</span></span>`,
      watch: () => sel('a-to', [['manager', WHO.manager], ['creator', WHO.creator], ...people(members)], a.to, 'Watcher', `data-i="${i}"`),
      notify: () => html`${sel('a-to', [...Object.entries(NOTIFY_TO), ...people(members)], a.to, 'Who', `data-i="${i}"`)}<input name="a-text" data-i="${i}" value="${a.text || ''}" maxlength="120" placeholder="Message, e.g. it is ready for review" aria-label="Message" class="pm-rule-wide" />`,
      comment: () => html`<textarea name="a-text" data-i="${i}" rows="2" maxlength="1000" placeholder="The comment CORE adds" aria-label="Comment" class="pm-rule-wide">${a.text || ''}</textarea>`,
      checklist: () => html`<textarea name="a-items" data-i="${i}" rows="2" placeholder="One item per line" aria-label="Checklist items" class="pm-rule-wide">${(a.items || []).join('\n')}</textarea>`,
      task: () => html`<input name="a-title" data-i="${i}" value="${a.title || ''}" maxlength="200" placeholder="Title of the new task" aria-label="New task title" class="pm-rule-wide" />
        ${sel('a-to', [['', 'Unassigned'], ...whoPairs], a.to || '', 'Assign the new task to', `data-i="${i}"`)}
        <span class="pm-rec-due"><input type="number" name="a-dueIn" data-i="${i}" min="0" max="60" value="${a.dueIn ?? ''}" placeholder="—" aria-label="Due after working days" /><span>days to do it</span></span>
        <label class="check"><input type="checkbox" name="a-subtask" data-i="${i}" ${a.subtask ? 'checked' : ''} /><span>As a subtask</span></label>`,
    }[a.type]();
    return html`<li class="pm-rule-row" data-i="${i}">${sel('a-type', Object.entries(RULE_ACTIONS), a.type, 'Action', `data-i="${i}"`)}${v}
      <button type="button" class="icon-btn danger" data-del-act="${i}" aria-label="Remove this action" ${r.actions.length === 1 ? 'disabled' : ''}>${icon('x', 16)}</button></li>`;
  };
  const DEFAULT_ACT = { status: () => ({ statusId: statusPairs[0][0] }), assign: () => ({ to: 'manager' }), priority: () => ({ priority: 'high' }), due: () => ({ days: 1 }), watch: () => ({ to: 'manager' }), notify: () => ({ to: 'assignee', text: '' }), comment: () => ({ text: '' }), checklist: () => ({ items: [] }), task: () => ({ title: '', to: '', dueIn: null, subtask: false }) };
  const DEFAULT_VALUE = { priority: 'high', size: 'M', kind: 'top', status: statusPairs[0][0], milestone: data.milestones[0]?.id || '', assignee: members[0]?.userId || '', title: '' };

  const { form } = modal({
    title: rec?.id ? 'Edit rule' : 'New rule', wide: true, className: 'pm-rule-form', subtitle: `${p.code} · CORE does this, at once, each time it happens`,
    submitLabel: rec?.id ? 'Save' : 'Add rule',
    body: html`<div class="stack">
      ${rec?.id ? '' : html`<label class="field"><span>Start from an example</span><select name="example"><option value="">A blank rule</option>${options(ex.map((x, i) => [String(i), x.name]))}</select></label>`}
      <label class="field"><span>Name<em>*</em></span><input name="name" value="${r.name}" maxlength="120" required placeholder="e.g. Tell the managers when a task is done" /></label>
      <div id="rule-parts"></div>
    </div>`,
    onSubmit: async () => {
      read();
      const body = { name: form.name.value, when: r.when, conditions: r.conditions, actions: r.actions, ...(rec?.id ? { version: rec.version, active: rec.active } : {}) };
      if (rec?.id) await api.put(`/api/pm/projects/${p.id}/rules/${rec.id}`, body);
      else await api.post(`/api/pm/projects/${p.id}/rules`, body);
      toast(rec?.id ? 'Rule saved.' : 'Rule added. It runs from now on.');
      await after();
    },
  });
  const parts = form.querySelector('#rule-parts');
  function draw() {
    mount(parts, html`
      <fieldset class="pm-rule-part"><legend><span class="pm-rule-k">When</span></legend>
        <div class="pm-rule-row">${sel('w-event', Object.entries(RULE_EVENTS), r.when.event, 'When')}
          ${r.when.event === 'status' ? sel('w-status', [['', 'any status'], ...statusPairs], r.when.statusId || '', 'Status') : ''}</div>
        ${r.when.event === 'overdue' ? html`<small class="hint">Once a day, for each open task whose due date has just passed (not tasks already late when the rule is added).</small>` : ''}
        ${r.when.event === 'subtasksDone' ? html`<small class="hint">When the last open subtask of a task is done or cancelled (at least one done).</small>` : ''}
      </fieldset>
      <fieldset class="pm-rule-part"><legend><span class="pm-rule-k">If</span> <span class="muted small">(optional: all must hold)</span></legend>
        ${r.conditions.length ? html`<ol class="pm-rule-rows">${r.conditions.map(condRow)}</ol>` : html`<p class="muted small">Every task.</p>`}
        ${r.conditions.length < MAX_CONDITIONS ? html`<button type="button" class="btn small-btn ghost" id="add-cond">${icon('plus', 14)} Add a condition</button>` : ''}
      </fieldset>
      <fieldset class="pm-rule-part"><legend><span class="pm-rule-k">Then</span> <span class="muted small">(in this order)</span></legend>
        <ol class="pm-rule-rows">${r.actions.map(actRow)}</ol>
        ${r.actions.length < MAX_ACTIONS ? html`<button type="button" class="btn small-btn ghost" id="add-act">${icon('plus', 14)} Add an action</button>` : ''}
      </fieldset>`);
  }
  // The form's values into `r` (before a redraw or saving).
  function read() {
    const f = form;
    const val = (name, i) => f.querySelector(`[name="${name}"][data-i="${i}"]`);
    if (f['w-event']) r.when = { event: f['w-event'].value, statusId: f['w-event'].value === 'status' ? f['w-status']?.value || null : null };
    r.conditions = r.conditions.map((c, i) => ({ field: val('c-field', i)?.value || c.field, op: val('c-op', i)?.value || c.op, value: val('c-value', i) ? val('c-value', i).value : null }));
    r.actions = r.actions.map((a, i) => {
      const type = val('a-type', i)?.value || a.type;
      const x = { type };
      for (const k of ['statusId', 'to', 'priority', 'text', 'title']) if (val(`a-${k}`, i)) x[k] = val(`a-${k}`, i).value;
      if (val('a-days', i)) x.days = Number(val('a-days', i).value);
      if (val('a-dueIn', i)) x.dueIn = val('a-dueIn', i).value === '' ? null : Number(val('a-dueIn', i).value);
      if (val('a-items', i)) x.items = val('a-items', i).value.split('\n').map((y) => y.trim()).filter(Boolean);
      if (val('a-subtask', i)) x.subtask = val('a-subtask', i).checked;
      return x;
    });
  }
  form.addEventListener('change', (e) => {
    const n = e.target.name;
    if (n === 'example') {
      const x = ex[Number(e.target.value)];
      if (!x) return;
      r = structuredClone(x);
      form.name.value = x.name;
      return draw();
    }
    if (!['w-event', 'c-field', 'c-op', 'a-type'].includes(n)) return;
    read();
    const i = Number(e.target.dataset.i);
    if (n === 'c-field') r.conditions[i] = { field: r.conditions[i].field, op: FIELD_OPS[r.conditions[i].field][0], value: DEFAULT_VALUE[r.conditions[i].field] };
    if (n === 'a-type') r.actions[i] = { type: r.actions[i].type, ...DEFAULT_ACT[r.actions[i].type]() };
    draw();
    form.querySelector(`[name="${n}"]${Number.isNaN(i) ? '' : `[data-i="${i}"]`}`)?.focus();
  });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'add-cond') (read(), r.conditions.push({ field: 'priority', op: 'is', value: 'high' }), draw(), form.querySelector(`[name="c-field"][data-i="${r.conditions.length - 1}"]`)?.focus());
    else if (b.id === 'add-act') (read(), r.actions.push({ type: 'notify', to: 'assignee', text: '' }), draw(), form.querySelector(`[name="a-type"][data-i="${r.actions.length - 1}"]`)?.focus());
    else if (b.dataset.delCond) (read(), r.conditions.splice(Number(b.dataset.delCond), 1), draw());
    else if (b.dataset.delAct) (read(), r.actions.splice(Number(b.dataset.delAct), 1), draw());
  });
  draw();
}
