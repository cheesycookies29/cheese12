// Project Management screens: the portfolio, a project's Overview, Board, List, Timeline and
// Time tabs, the task page, My work, Workload and the Projects setup. Built for dated,
// contract-bound delivery: milestones (some are deliverables the client accepts), a board of
// tasks, and what is late. Everything a project shows is worked out by the server from its tasks
// (shared/projects.js); nothing here stores a percentage or a health colour.
import { api } from '../api.js';
import { ctx, can, roleLabel } from '../state.js';
import { html, mount, badge, toast, modal, confirmDialog, fmtDate, today, downloadFile, toCsv } from '../ui.js';
import { icon } from '../icons.js';
import {
  PROJECT_STATUS, OPEN_PROJECT, CATEGORIES, PRIORITY, MEMBER_ROLES, HEALTH, STATUS_COLORS, MY_WORK_GROUPS,
  addDays, weekStart, isoWeek, daysBetween, workCalendar, isWorkDay, mentionParts, taskCsvRows, byRank,
} from '/shared/projects.js';

// ---------- Small helpers ----------
const changed = () => window.dispatchEvent(new Event('pm:changed'));
const plural = (n, w, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
const hrs = (n) => `${Math.round((Number(n) || 0) * 100) / 100} h`;
const short = (ymd) => (ymd ? fmtDate(ymd, { month: 'short', day: 'numeric' }) : '');
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const initials = (name) => (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const reloadPage = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
// An inline action: a refusal is shown, then `after` redraws so the screen matches what was saved.
const guard = (fn, after) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    toast(err.message, 'error');
    if (err.status === 409) return reloadPage();
    try {
      await after?.();
    } catch {
      reloadPage();
    }
  }
};
const option = (value, label, selected) => html`<option value="${value}" ${String(selected ?? '') === String(value) ? 'selected' : ''}>${label}</option>`;
const options = (pairs, selected) => pairs.map(([v, l]) => option(v, l, selected));
const info = (label, value) => html`<div class="info"><dt>${label}</dt><dd>${value || value === 0 ? value : html`<span class="muted">—</span>`}</dd></div>`;
const head = (title, sub, actions = '', back = '') => html`
  <header class="page-head">
    <div>${back ? html`<a class="back" href="#${back[0]}">← ${back[1]}</a>` : ''}<h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>
    ${actions ? html`<div class="actions">${actions}</div>` : ''}
  </header>`;
const LEVEL = { read: 1, comment: 2, work: 3, manage: 4 };
// Edits saved as you go: one save at a time, each with the version the one before returned, and a
// date once it has stopped changing (typing a year changes a date field several times).
function saveQueue() {
  let chain = Promise.resolve();
  const timers = new Map();
  return (key, job, delay = 0) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      chain = chain.then(job).catch(() => {});
    }, delay));
  };
}
const may = (access, level) => LEVEL[access] >= LEVEL[level];

// ---------- Badges and chips ----------
const PROJECT_BADGE = { planning: 'blue', active: 'green', on_hold: 'amber', completed: 'gray', cancelled: 'gray' };
const projectBadge = (s) => badge(PROJECT_STATUS[s] || s, PROJECT_BADGE[s]);
// Health is a word and a shape as well as a colour (not colour alone).
export const healthChip = (v, title = '') => (v ? html`<span class="pm-health ${v}" title="${title}"><i aria-hidden="true"></i>${HEALTH[v]}</span>` : html`<span class="muted small">—</span>`);
const statusChip = (s) => html`<span class="pm-st pm-c-${s?.color || 'gray'}"><i aria-hidden="true"></i>${s?.name || '—'}</span>`;
const progressBar = (pr) => (pr?.percent == null ? html`<span class="muted small">No tasks yet</span>`
  : html`<span class="pm-progress" title="${pr.basis === 'hours' ? 'Weighted by estimated hours' : 'By number of tasks'}"><span class="progress"><i style="width:${pr.percent}%"></i></span><b>${pr.percent}%</b></span>`);
const priorityBadge = (p) => (p === 'urgent' ? badge('Urgent', 'red') : p === 'high' ? badge('High', 'amber') : '');
function dueChip(t, { long = false } = {}) {
  if (!t.dueDate) return '';
  const text = long ? fmtDate(t.dueDate) : short(t.dueDate);
  if (t.overdue) return html`<span class="crm-due bad">${icon('calendar', 12)} Overdue · ${text}</span>`;
  if (t.dueSoon) return html`<span class="crm-due warn">${icon('calendar', 12)} ${t.dueDate === today() ? 'Today' : text}</span>`;
  return html`<span class="crm-due">${icon('calendar', 12)} ${text}</span>`;
}
const avatar = (name) => (name ? html`<span class="avatar xs" title="${name}">${initials(name)}</span>` : html`<span class="avatar xs pm-nobody" title="Unassigned">?</span>`);

// ---------- Data ----------
let metaCache = null;
async function meta(fresh = false) {
  if (!metaCache || fresh) metaCache = await api.get('/api/pm/meta');
  return metaCache;
}
// The people who can be assigned in a project: its members (not viewers); for a manager also
// everyone else, who joins the project as a member when assigned.
async function assigneeOptions(p, access, selected) {
  const members = p.members.filter((m) => m.role !== 'viewer' && (m.active || m.userId === selected));
  const others = may(access, 'manage') ? (await meta()).people.filter((x) => !p.members.some((m) => m.userId === x.id)) : [];
  return html`<option value="">Unassigned</option>${members.map((m) => option(m.userId, m.name, selected))}
    ${others.length ? html`<optgroup label="Add to the project">${others.map((x) => option(x.id, x.name, selected))}</optgroup>` : ''}`;
}

export async function myWorkBadge() {
  if (!can('pm.view') && !ctx.user.inProjects) return 0;
  const g = await api.get('/api/pm/my-work');
  return g.overdue.length + g.today.length;
}

// ---------- Forms ----------
async function editProject(rec = {}, after) {
  const m = await meta(true);
  const crm = m.crm;
  const people = m.people.length ? m.people : [{ id: ctx.user.id, name: ctx.user.name }];
  const { form } = modal({
    title: rec.id ? 'Edit project' : 'New project', wide: true, subtitle: rec.id ? rec.code : 'The statuses of the board come from the Projects setup; change them later under Board → Edit columns.',
    body: html`<div class="grid two">
      <label class="field span-2"><span>Project name<em>*</em></span><input name="name" value="${rec.name || ''}" required /></label>
      <label class="field"><span>Type</span><select name="type">${options([...new Set([...m.types, ...(rec.type ? [rec.type] : [])])].map((t) => [t, t]), rec.type || m.types[0])}</select></label>
      <label class="field"><span>Status</span><select name="status">${options(Object.entries(PROJECT_STATUS), rec.status || 'planning')}</select></label>
      <label class="field"><span>Start<em>*</em></span><input type="date" name="startDate" value="${rec.startDate || today()}" required /></label>
      <label class="field"><span>End</span><input type="date" name="endDate" value="${rec.endDate || ''}" /></label>
      <label class="field"><span>Project manager</span><select name="managerId">${options(people.map((x) => [x.id, x.name]), rec.managerId || ctx.user.id)}</select></label>
      <label class="field"><span>Budget (hours)</span><input type="number" name="budgetHours" min="0" step="1" inputmode="decimal" value="${rec.budgetHours ?? ''}" /></label>
      ${crm ? html`
        <label class="field"><span>Client</span><select name="accountId"><option value="">None (internal)</option>${options(crm.accounts.map((a) => [a.id, a.name]), rec.accountId)}</select></label>
        <label class="field"><span>Deal</span><select name="dealId"></select></label>
        <label class="field span-2"><span>Contract</span><select name="contractId"></select><small class="hint">Deliverables due after the contract's end date are flagged.</small></label>` : ''}
      <label class="field span-2"><span>Description</span><textarea name="description" rows="3">${rec.description || ''}</textarea></label>
    </div>`,
    onSubmit: async (f) => {
      const v = Object.fromEntries(new FormData(f));
      if (!crm) for (const k of ['accountId', 'dealId', 'contractId']) delete v[k];
      const saved = rec.id ? await api.put(`/api/pm/projects/${rec.id}`, { ...v, version: rec.version }) : await api.post('/api/pm/projects', v);
      toast(rec.id ? 'Project saved.' : `Project ${saved.code} created.`);
      changed();
      after?.(saved);
    },
  });
  // The deal and contract lists show the chosen client's.
  if (crm) {
    const fill = (name, list, label) => {
      const sel = form.elements[name];
      const keep = sel.value || rec[name] || '';
      sel.innerHTML = '';
      sel.add(new Option('None', ''));
      for (const x of list.filter((y) => y.accountId === form.elements.accountId.value)) sel.add(new Option(label(x), x.id, false, x.id === keep));
    };
    const refill = () => {
      fill('dealId', crm.deals, (x) => `${x.code} · ${x.title}`);
      fill('contractId', crm.contracts, (x) => `${x.code} · ${x.title}${x.endDate ? ` (ends ${fmtDate(x.endDate)})` : ''}`);
    };
    form.elements.accountId.addEventListener('change', refill);
    refill();
  }
}

// From Sales & CRM: "Start project" on a won deal or a contract.
export async function startProject(kind, rec) {
  const m = await meta(true);
  const sector = m.crm?.accounts.find((a) => a.id === rec.accountId)?.sector;
  const guess = sector === 'government' && m.types.includes('Government') ? 'Government' : m.types.includes('Client') ? 'Client' : m.types[0];
  const go = (v, force = false) => api.post(`/api/pm/projects/from-${kind}/${rec.id}`, { ...v, force });
  modal({
    title: 'Start a project', subtitle: `${rec.code} · ${rec.title}. The project is linked to the client, the deal and the contract.`, submitLabel: 'Start project',
    body: html`<div class="grid two">
      <label class="field span-2"><span>Project name</span><input name="name" value="${rec.title}" /></label>
      <label class="field"><span>Type</span><select name="type">${options(m.types.map((t) => [t, t]), guess)}</select></label>
      <label class="field"><span>Project manager</span><select name="managerId">${options((m.people.length ? m.people : [{ id: ctx.user.id, name: ctx.user.name }]).map((x) => [x.id, x.name]), ctx.user.id)}</select></label>
      <label class="field"><span>Start</span><input type="date" name="startDate" value="${rec.startDate && rec.startDate > today() ? rec.startDate : today()}" /></label>
      <label class="field"><span>End</span><input type="date" name="endDate" value="${rec.endDate || ''}" /></label>
    </div>`,
    onSubmit: async (f) => {
      const v = Object.fromEntries(new FormData(f));
      let p;
      try {
        p = await go(v);
      } catch (err) {
        if (err.status !== 409) throw err;
        if (!(await confirmDialog(`${err.message}`, { title: 'There is already a project', confirmLabel: 'Start another', danger: false }))) throw new Error('Not started. Open the existing project from the list on this page.');
        p = await go(v, true);
      }
      toast(`Project ${p.code} started.`);
      changed();
      location.hash = `#/projects/${p.id}`;
    },
  });
}

// From the Service Desk: "Add to a project" on a ticket.
export async function addTicketToProject(ticket, after) {
  const list = (await api.get('/api/pm/projects')).filter((p) => may(p.access, 'work') && OPEN_PROJECT.includes(p.status));
  if (!list.length) return toast('You are not a member of an open project. A project manager can add you.', 'error');
  modal({
    title: 'Add to a project', subtitle: `${ticket.ref} · ${ticket.subject}. It becomes a task; the task and the ticket link to each other.`, submitLabel: 'Add task',
    body: html`<label class="field"><span>Project</span><select name="projectId">${options(list.map((p) => [p.id, `${p.code} · ${p.name}`]))}</select></label>`,
    onSubmit: async (f) => {
      const t = await api.post(`/api/pm/tasks/from-ticket/${ticket.id}`, { projectId: f.projectId.value });
      toast(t.existing ? `${ticket.ref} is already task ${t.key} of that project.` : `Task ${t.key} added.`);
      changed();
      after?.(t);
    },
  });
}

// New task (List, Overview), with the project's statuses, members and milestones.
async function newTask(p, tasks, preset = {}, after) {
  const top = tasks.filter((t) => !t.parentId);
  const assignees = await assigneeOptions(p, p.access, preset.assigneeId);
  modal({
    title: preset.parentId ? 'New subtask' : 'New task', wide: true, submitLabel: 'Add task',
    body: html`<div class="grid two">
      <label class="field span-2"><span>Title<em>*</em></span><input name="title" required /></label>
      <label class="field"><span>Status</span><select name="statusId">${options(p.statuses.filter((s) => s.category !== 'cancelled').map((s) => [s.id, s.name]), preset.statusId)}</select></label>
      <label class="field"><span>Priority</span><select name="priority">${options(Object.entries(PRIORITY), 'normal')}</select></label>
      <label class="field"><span>Assignee</span><select name="assigneeId">${assignees}</select></label>
      <label class="field"><span>Estimate (hours)</span><input type="number" name="estimateHours" min="0" step="0.25" inputmode="decimal" /></label>
      <label class="field"><span>Start</span><input type="date" name="startDate" /></label>
      <label class="field"><span>Due</span><input type="date" name="dueDate" /></label>
      <label class="field"><span>Milestone</span><select name="milestoneId"><option value="">None</option>${options(p.milestones.map((m) => [m.id, `${m.name} (${short(m.dueDate)})`]), preset.milestoneId)}</select></label>
      <label class="field"><span>Subtask of</span><select name="parentId"><option value="">None (a task)</option>${options(top.map((t) => [t.id, `${t.key} · ${t.title}`]), preset.parentId)}</select></label>
      <label class="field span-2"><span>Description</span><textarea name="description" rows="3"></textarea></label>
    </div>`,
    onSubmit: async (f) => {
      const t = await api.post(`/api/pm/projects/${p.id}/tasks`, Object.fromEntries(new FormData(f)));
      toast(`Task ${t.key} added.`);
      changed();
      after?.(t);
    },
  });
}

// ---------- Portfolio ----------
export async function portfolioView(el, _params, query) {
  const [ov, m] = await Promise.all([api.get('/api/pm/overview'), meta()]);
  const state = { status: query.status || 'open', type: query.type || '', manager: query.manager || '', mine: query.mine === '1', q: query.q || '' };
  const managers = [...new Map(ov.projects.filter((p) => p.managerId).map((p) => [p.managerId, p.managerName])).entries()];
  const stat = (label, value, sub, cls = '', href = '') => html`<${href ? 'a' : 'div'} class="card ${cls}" ${href ? html`href="${href}"` : ''}><small>${label}</small><strong>${value}</strong>${sub ? html`<span class="muted small">${sub}</span>` : ''}</${href ? 'a' : 'div'}>`;
  mount(el, html`
    ${head('Projects', can('pm.view') ? 'Every project: progress, health and the next milestone.' : 'The projects you are a member of.', can('pm.edit') ? html`<button class="btn primary" id="new">+ New project</button>` : '')}
    <div class="stats">
      ${stat('Open projects', ov.counts.open, `${ov.counts.active} active`)}
      ${stat('At risk', ov.counts.amber, 'amber: watch these', ov.counts.amber ? 'attention' : '')}
      ${stat('Off track', ov.counts.red, 'red: act on these', ov.counts.red ? 'attention' : '')}
      ${stat('Overdue tasks', ov.counts.overdueTasks, 'in open projects')}
      ${stat('My open tasks', ov.counts.myOpen, ov.counts.myOverdue ? `${ov.counts.myOverdue} overdue` : 'none overdue', ov.counts.myOverdue ? 'attention' : '', '#/projects/my-work')}
    </div>
    <section class="card scroll-x">
      <div class="toolbar pad">
        <input type="search" id="q" placeholder="Search name, code or client…" aria-label="Search projects" value="${state.q}" />
        <select id="f-status" aria-label="Status">${options([['open', 'Open projects'], ...Object.entries(PROJECT_STATUS), ['all', 'All']], state.status)}</select>
        <select id="f-type" aria-label="Type"><option value="">All types</option>${options(m.types.map((t) => [t, t]), state.type)}</select>
        <select id="f-manager" aria-label="Project manager"><option value="">All managers</option>${options(managers, state.manager)}</select>
        <label class="field check inline"><input type="checkbox" id="f-mine" ${state.mine ? 'checked' : ''} /><span>Mine</span></label>
      </div>
      <div id="list"></div>
    </section>`);
  const draw = () => {
    const q = state.q.toLowerCase();
    const rows = ov.projects.filter((p) => (state.status === 'all' || (state.status === 'open' ? OPEN_PROJECT.includes(p.status) : p.status === state.status))
      && (!state.type || p.type === state.type) && (!state.manager || p.managerId === state.manager)
      && (!state.mine || p.managerId === ctx.user.id || p.members.some((x) => x.userId === ctx.user.id))
      && (!q || [p.name, p.code, p.accountName].some((f) => String(f || '').toLowerCase().includes(q))));
    const qs = new URLSearchParams(Object.entries({ status: state.status === 'open' ? '' : state.status, type: state.type, manager: state.manager, mine: state.mine ? '1' : '', q: state.q }).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/projects${qs ? `?${qs}` : ''}`);
    mount(el.querySelector('#list'), rows.length ? html`<table class="table clickable pm-portfolio">
      <thead><tr><th>Project</th><th>Client</th><th>Manager</th><th>Dates</th><th>Progress</th><th>Health</th><th>Next milestone</th></tr></thead>
      <tbody>${rows.map((p) => html`<tr data-href="#/projects/${p.id}">
        <td><a href="#/projects/${p.id}"><strong>${p.name}</strong></a><small><span class="mono">${p.code}</span> · ${p.type} · ${PROJECT_STATUS[p.status]}</small></td>
        <td>${p.accountName || html`<span class="muted">Internal</span>`}</td>
        <td>${p.managerName || '—'}</td>
        <td class="nowrap">${short(p.startDate)} – ${p.endDate ? short(p.endDate) : '…'}</td>
        <td>${progressBar(p.progress)}</td>
        <td>${healthChip(p.health, p.healthReasons.join('; '))}${p.healthOverride ? html`<small>Manager: ${HEALTH[p.healthOverride.value]}</small>` : ''}${p.overdueTasks ? html`<small>${plural(p.overdueTasks, 'overdue task')}</small>` : ''}</td>
        <td>${p.nextMilestone ? html`${p.nextMilestone.deliverable ? html`<span class="pm-diamond deliverable" aria-hidden="true"></span>` : html`<span class="pm-diamond" aria-hidden="true"></span>`}${p.nextMilestone.name}<small>${fmtDate(p.nextMilestone.dueDate)}${p.nextMilestone.deliverable ? ' · deliverable' : ''}</small>` : '—'}</td>
      </tr>`)}</tbody></table>`
      : html`<div class="empty"><p>${ov.projects.length ? 'No project matches the filters.' : can('pm.edit') ? 'No projects yet. Start one with New project, or from a won deal in Sales & CRM.' : 'You are not on any project yet.'}</p></div>`);
    el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a') && (location.hash = tr.dataset.href)));
  };
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value.trim()), draw()));
  el.querySelector('#f-status').addEventListener('change', (e) => ((state.status = e.target.value), draw()));
  el.querySelector('#f-type').addEventListener('change', (e) => ((state.type = e.target.value), draw()));
  el.querySelector('#f-manager').addEventListener('change', (e) => ((state.manager = e.target.value), draw()));
  el.querySelector('#f-mine').addEventListener('change', (e) => ((state.mine = e.target.checked), draw()));
  el.querySelector('#new')?.addEventListener('click', () => editProject({}, (p) => (location.hash = `#/projects/${p.id}`)));
  draw();
}

// ---------- A project: header and tabs ----------
const TABS = [['', 'Overview', 'dashboard'], ['board', 'Board', 'grid'], ['list', 'List', 'table'], ['timeline', 'Timeline', 'calendar'], ['time', 'Time', 'clock']];
function projectHeader(p, tab, actions = '') {
  return html`
    <header class="page-head pm-head">
      <div><a class="back" href="#/projects">← Projects</a>
        <h1>${p.name} ${projectBadge(p.status)}</h1>
        <p class="muted"><span class="mono">${p.code}</span> · ${p.type}${p.accountName ? ` · ${p.accountName}` : ''} · ${fmtDate(p.startDate)} – ${p.endDate ? fmtDate(p.endDate) : 'no end date'}${p.managerName ? ` · ${p.managerName}` : ''}</p></div>
      ${actions ? html`<div class="actions">${actions}</div>` : ''}
    </header>
    <nav class="tabs pm-tabs" aria-label="Project views">${TABS.map(([k, label, ic]) => html`<a href="#/projects/${p.id}${k ? `/${k}` : ''}" class="${k === tab ? 'active' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${icon(ic, 16)} ${label}</a>`)}</nav>`;
}
const loadProject = (id) => api.get(`/api/pm/projects/${id}`);

// ---------- Overview ----------
export async function projectOverviewView(el, { id }) {
  const p = await loadProject(id);
  const manage = may(p.access, 'manage');
  const override = p.healthOverride;
  const msCard = (m) => html`<li class="pm-ms ${m.value || ''}">
      <div class="pm-ms-top"><span class="pm-diamond ${m.deliverable ? 'deliverable' : ''}" aria-hidden="true"></span><strong>${m.name}</strong>
        ${manage ? html`<button type="button" class="icon-btn" data-ms="${m.id}" aria-label="Edit ${m.name}">${icon('edit', 15)}</button>` : ''}</div>
      <span class="muted small">Due ${fmtDate(m.dueDate)}${m.deliverable ? ` · Deliverable${m.billingPercent != null ? `, ${m.billingPercent}% billing` : ''}` : ''}</span>
      ${progressBar(m.progress)}
      <div class="pm-ms-foot">${m.acceptedAt ? badge(`Accepted ${short(m.acceptedAt)}`, 'green') : m.submittedAt ? badge(`Submitted ${short(m.submittedAt)}`, 'blue') : m.finished ? badge('Work done', 'green') : healthChip(m.value, m.reasons.join('; '))}</div>
      ${m.reasons?.length && !m.acceptedAt ? html`<small class="pm-ms-why">${m.reasons[0]}</small>` : ''}
      ${m.afterContract ? html`<small class="crm-due bad">${icon('alert', 12)} After the contract ends (${fmtDate(p.contract.endDate)})</small>` : ''}
    </li>`;
  const taskLine = (t) => html`<li><span class="grow"><a href="#/projects/${p.id}/tasks/${t.id}"><strong>${t.title}</strong></a><small><span class="mono">${t.key}</span> · ${t.statusName}${t.assigneeName ? ` · ${t.assigneeName}` : ' · unassigned'}</small></span>${dueChip(t)}</li>`;
  const act = (a) => {
    const what = a.field === 'comment' ? html`commented: “${a.to}”` : a.field === 'created' ? (a.project ? 'created the project' : html`added the task${a.to ? ` (${a.to})` : ''}`) : html`${a.field}: ${a.from || '—'} → ${a.to || '—'}`;
    return html`<li><span class="grow"><strong>${a.byName}</strong> ${what}${a.key ? html` <a href="#/projects/${p.id}/tasks/${a.taskId}" class="mono">${a.key}</a>` : ''}<small>${when(a.at)}</small></span></li>`;
  };
  mount(el, html`
    ${projectHeader(p, '', html`
      <button class="btn" id="print">${icon('file', 16)} Print status report</button>
      ${manage ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit</button>` : ''}
      ${can('pm.edit') ? html`<button class="btn" id="copy">${icon('copy', 16)} Copy</button>` : ''}
      ${can('pm.manage') ? html`<button class="btn danger ghost" id="del">Delete</button>` : ''}`)}
    <section class="card pm-healthbar">
      <div><small class="muted">Health (worked out from the tasks)</small><div class="pm-health-line">${healthChip(p.health)} <span class="muted small">${p.healthReasons.length ? p.healthReasons.join(' · ') : p.health ? 'Nothing late or behind.' : 'The project is closed.'}</span></div></div>
      ${override ? html`<div><small class="muted">Project manager's reading</small><div class="pm-health-line">${healthChip(override.value)} <span class="small">“${override.note}”</span> <span class="muted small">${override.byName}, ${when(override.at)}</span></div></div>` : ''}
      ${manage ? html`<button class="btn small-btn" id="health">${override ? 'Change' : 'Set'} health</button>` : ''}
    </section>
    <div class="stats">
      <div class="card"><small>Progress</small><strong>${p.progress.percent == null ? '—' : `${p.progress.percent}%`}</strong><span class="muted small">${p.progress.total ? `${p.progress.done} of ${plural(p.progress.total, 'task')} done${p.progress.basis === 'hours' ? ', by hours' : ''}` : 'no tasks yet'}</span>${p.progress.percent != null ? html`<span class="progress"><i style="width:${p.progress.percent}%"></i></span>` : ''}</div>
      <a class="card ${p.counts.overdue ? 'attention' : ''}" href="#/projects/${p.id}/list?overdue=1"><small>Overdue tasks</small><strong>${p.counts.overdue}</strong><span class="muted small">${p.counts.dueSoon} due within 3 working days</span></a>
      <div class="card"><small>Blocked</small><strong>${p.counts.blocked}</strong><span class="muted small">waiting for another task</span></div>
      <a class="card" href="#/projects/${p.id}/time"><small>Hours logged</small><strong>${hrs(p.hours.logged)}</strong><span class="muted small">of ${hrs(p.hours.estimate)} estimated${p.budgetHours ? ` · budget ${hrs(p.budgetHours)}` : ''}</span></a>
    </div>
    <section class="card">
      <div class="card-head"><h2>${icon('flag')} Milestones</h2>${manage ? html`<button class="btn small-btn" id="add-ms">+ Milestone</button>` : ''}</div>
      ${p.milestones.length ? html`<ol class="pm-ms-strip">${p.milestones.map(msCard)}</ol>` : html`<p class="muted">No milestones yet. Add the deliverables from the contract or terms of reference, with their billing %.</p>`}
    </section>
    <div class="cols wide-left">
      <div class="stack">
        <section class="card"><div class="card-head"><h2>${icon('alert')} Overdue</h2><a href="#/projects/${p.id}/list?overdue=1">In the list</a></div>
          ${p.overdue.length ? html`<ul class="crm-mini">${p.overdue.slice(0, 8).map(taskLine)}</ul>` : html`<p class="muted">Nothing overdue.</p>`}</section>
        ${p.blockedList.length ? html`<section class="card"><h2>${icon('lock')} Blocked</h2><ul class="crm-mini">${p.blockedList.map(taskLine)}</ul></section>` : ''}
        <section class="card"><h2>${icon('activity')} Recent activity</h2>${p.activity.length ? html`<ul class="crm-mini pm-activity">${p.activity.map(act)}</ul>` : html`<p class="muted">Nothing yet.</p>`}</section>
      </div>
      <div class="stack">
        <section class="card"><div class="card-head"><h2>${icon('users')} Members</h2>${manage ? html`<button class="btn small-btn" id="members">Manage</button>` : ''}</div>
          <ul class="crm-mini">${p.members.map((x) => html`<li>${avatar(x.name)}<span class="grow"><strong>${x.name}</strong><small>${MEMBER_ROLES[x.role]}${x.active ? '' : ' · account disabled'}</small></span></li>`)}</ul></section>
        <section class="card"><h2>${icon('link')} Links</h2><dl class="info-grid">
          ${info('Client', p.accountName ? (can('crm.view') ? html`<a href="#/crm/accounts/${p.accountId}">${p.accountName}</a>` : p.accountName) : 'Internal')}
          ${info('Deal', p.deal ? (can('crm.view') ? html`<a href="#/crm/deals/${p.deal.id}">${p.deal.code} · ${p.deal.title}</a>` : `${p.deal.code} · ${p.deal.title}`) : '')}
          ${info('Contract', p.contract ? html`${can('crm.view') ? html`<a href="#/crm/contracts/${p.contract.id}">${p.contract.code} · ${p.contract.title}</a>` : `${p.contract.code} · ${p.contract.title}`}${p.contract.endDate ? html`<small class="muted"> ends ${fmtDate(p.contract.endDate)}</small>` : ''}` : '')}
        </dl>${p.description ? html`<p class="pre small crm-desc">${p.description}</p>` : ''}</section>
        ${p.tickets ? html`<section class="card"><h2>${icon('ticket')} Open service desk tickets</h2>
          ${p.tickets.length ? html`<ul class="crm-mini">${p.tickets.map((t) => html`<li><span class="grow"><a href="#/helpdesk/tickets/${t.id}"><strong>${t.subject}</strong></a><small><span class="mono">${t.ref}</span> · ${t.statusName}${t.linked ? ' · linked to a task' : ''}</small></span></li>`)}</ul>` : html`<p class="muted small">None from this client.</p>`}</section>` : ''}
      </div>
    </div>`);
  const reload = () => projectOverviewView(el, { id });
  el.querySelector('#print').addEventListener('click', () => printReport(p));
  el.querySelector('#edit')?.addEventListener('click', () => editProject(p, reload));
  el.querySelector('#copy')?.addEventListener('click', () => modal({
    title: 'Copy as a new project', subtitle: 'Copies the statuses, milestones and tasks, with their dates moved to the new start. No people, time, comments or client links.', submitLabel: 'Copy',
    body: html`<div class="grid two"><label class="field span-2"><span>New project name</span><input name="name" value="${p.name} (copy)" /></label><label class="field"><span>New start date</span><input type="date" name="startDate" value="${today()}" /></label></div>`,
    onSubmit: async (f) => {
      const n = await api.post(`/api/pm/projects/${p.id}/copy`, { name: f.name.value, startDate: f.startDate.value });
      toast(`Copied as ${n.code}.`);
      location.hash = `#/projects/${n.id}`;
    },
  }));
  el.querySelector('#del')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete ${p.code} ${p.name}? Its milestones, tasks, comments and logged time go with it. This cannot be undone.`, { title: 'Delete project' }))) return;
    await api.del(`/api/pm/projects/${p.id}`).then(() => {
      toast('Project deleted.');
      changed();
      location.replace('#/projects');
    }, (err) => toast(err.message, 'error'));
  });
  el.querySelector('#health')?.addEventListener('click', () => modal({
    title: 'Project health', subtitle: 'Your reading is shown next to the one worked out from the tasks, which stays visible.', submitLabel: 'Save',
    body: html`<div class="grid two">
      <label class="field span-2"><span>Health</span><select name="value"><option value="">As worked out (no reading of mine)</option>${options(Object.entries(HEALTH), override?.value)}</select></label>
      <label class="field span-2"><span>Why, in one line</span><input name="note" maxlength="200" value="${override?.note || ''}" placeholder="e.g. Client delayed the UAT schedule by a week" /></label></div>`,
    onSubmit: async (f) => {
      await api.put(`/api/pm/projects/${p.id}/health`, { value: f.value.value || null, note: f.note.value });
      toast('Health saved.');
      reload();
    },
  }));
  el.querySelector('#add-ms')?.addEventListener('click', () => editMilestone(p, {}, reload));
  el.querySelectorAll('[data-ms]').forEach((b) => b.addEventListener('click', () => editMilestone(p, p.milestones.find((m) => m.id === b.dataset.ms), reload)));
  el.querySelector('#members')?.addEventListener('click', () => editMembers(p, reload));
}

function editMilestone(p, m, after) {
  const { form } = modal({
    title: m.id ? 'Edit milestone' : 'New milestone', subtitle: 'A deliverable is something the client accepts, often with a share of the contract price.', wide: true,
    body: html`<div class="grid two">
      <label class="field span-2"><span>Name<em>*</em></span><input name="name" value="${m.name || ''}" /></label>
      <label class="field"><span>Due<em>*</em></span><input type="date" name="dueDate" value="${m.dueDate || ''}" /></label>
      <label class="field check"><input type="checkbox" name="deliverable" ${m.deliverable ? 'checked' : ''} /><span>Contract deliverable</span></label>
      <label class="field"><span>Billing % of the contract</span><input type="number" name="billingPercent" min="0" max="100" step="0.01" value="${m.billingPercent ?? ''}" /></label>
      <label class="field"><span>Submitted to the client on</span><input type="date" name="submittedAt" value="${m.submittedAt || ''}" /></label>
      <label class="field"><span>Accepted on</span><input type="date" name="acceptedAt" value="${m.acceptedAt || ''}" /></label>
      <label class="field span-2"><span>Acceptance note</span><input name="acceptanceNote" maxlength="500" value="${m.acceptanceNote || ''}" placeholder="e.g. Certificate of acceptance signed by the VP" /></label>
      ${m.id ? html`<p class="span-2"><button type="button" class="link danger" id="del-ms">Delete this milestone</button> <span class="muted small">Its tasks stay, without a milestone.</span></p>` : ''}
    </div>`,
    onSubmit: async (f) => {
      const v = { name: f.name.value, dueDate: f.dueDate.value, deliverable: f.deliverable.checked, billingPercent: f.billingPercent.value, submittedAt: f.submittedAt.value || null, acceptedAt: f.acceptedAt.value || null, acceptanceNote: f.acceptanceNote.value };
      if (m.id) await api.put(`/api/pm/projects/${p.id}/milestones/${m.id}`, { ...v, version: m.version });
      else await api.post(`/api/pm/projects/${p.id}/milestones`, v);
      toast('Milestone saved.');
      after?.();
    },
  });
  form.querySelector('#del-ms')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete the milestone "${m.name}"?`, { title: 'Delete milestone' }))) return;
    await api.del(`/api/pm/projects/${p.id}/milestones/${m.id}`).then(() => {
      form.closest('.modal-backdrop')?.remove();
      toast('Milestone deleted.');
      after?.();
    }, (err) => toast(err.message, 'error'));
  });
}

async function editMembers(p, after) {
  const m = await meta(true);
  const list = p.members.map((x) => ({ ...x }));
  const { form } = modal({
    title: 'Project members', wide: true, subtitle: 'Managers change the project; members work on tasks and log time; viewers read and comment. Anyone on the list can open the project.',
    body: html`<div id="mem"></div>`,
    onSubmit: async () => {
      const r = await api.put(`/api/pm/projects/${p.id}/members`, { version: p.version, members: list.map(({ userId, role }) => ({ userId, role })) });
      toast(r.unassigned ? `Members saved. Open tasks of people taken off were unassigned.` : 'Members saved.');
      after?.();
    },
  });
  const box = form.querySelector('#mem');
  const draw = () => {
    const others = m.people.filter((x) => !list.some((y) => y.userId === x.id));
    mount(box, html`<table class="table compact no-stack pm-members"><thead><tr><th>Person</th><th>Role</th><th></th></tr></thead><tbody>${list.map((x, i) => html`<tr>
        <td><strong>${x.name}</strong>${x.userId === p.managerId ? html`<small>Project manager</small>` : ''}</td>
        <td><select data-role="${i}" aria-label="Role of ${x.name}" ${x.userId === p.managerId ? 'disabled' : ''}>${options(Object.entries(MEMBER_ROLES), x.role)}</select></td>
        <td class="row-actions">${x.userId === p.managerId ? '' : html`<button type="button" class="icon-btn danger" data-rm="${i}" aria-label="Take ${x.name} off the project">${icon('trash', 16)}</button>`}</td></tr>`)}</tbody></table>
      ${others.length ? html`<div class="pm-add-member"><select id="who" aria-label="Person to add">${options(others.map((x) => [x.id, `${x.name} · ${roleLabel(x.role)}`]))}</select><select id="as" aria-label="Role">${options(Object.entries(MEMBER_ROLES), 'member')}</select><button type="button" class="btn" id="add">Add</button></div>` : ''}`);
    box.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', () => (list[Number(s.dataset.role)].role = s.value)));
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => (list.splice(Number(b.dataset.rm), 1), draw())));
    box.querySelector('#add')?.addEventListener('click', () => {
      const who = m.people.find((x) => x.id === box.querySelector('#who').value);
      list.push({ userId: who.id, name: who.name, role: box.querySelector('#as').value });
      draw();
      box.querySelector('#who')?.focus();
    });
  };
  draw();
}

// Print status report: one page, from the project as loaded. Printed from a copy placed outside the
// app, so the page's own layout is not printed.
function printReport(p) {
  document.getElementById('pm-report')?.remove();
  const div = document.createElement('div');
  div.id = 'pm-report';
  div.className = 'pm-report';
  const ms = p.milestones;
  mount(div, html`
    <header><div><h1>${p.name}</h1><p>${p.code} · ${p.type}${p.accountName ? ` · ${p.accountName}` : ''} · ${PROJECT_STATUS[p.status]}</p></div>
      <p class="pm-r-date">Status report<br />${fmtDate(today(), { month: 'long', day: 'numeric', year: 'numeric' })}</p></header>
    <section class="pm-r-head">
      <div><small>Health</small><strong>${p.health ? HEALTH[p.health] : PROJECT_STATUS[p.status]}</strong>${p.healthOverride ? html`<span>Manager: ${HEALTH[p.healthOverride.value]}. ${p.healthOverride.note}</span>` : html`<span>${p.healthReasons.join('; ') || 'Nothing late or behind.'}</span>`}</div>
      <div><small>Progress</small><strong>${p.progress.percent == null ? '—' : `${p.progress.percent}%`}</strong><span>${p.progress.done} of ${plural(p.progress.total, 'task')} done</span></div>
      <div><small>Dates</small><strong>${short(p.startDate)} – ${p.endDate ? short(p.endDate) : '…'}</strong><span>Manager: ${p.managerName || '—'}</span></div>
      <div><small>Hours</small><strong>${hrs(p.hours.logged)}</strong><span>of ${hrs(p.hours.estimate)} estimated</span></div>
    </section>
    <h2>Milestones</h2>
    <table><thead><tr><th>Milestone</th><th>Due</th><th>Progress</th><th>Status</th></tr></thead><tbody>${ms.map((m) => html`<tr><td>${m.name}${m.deliverable ? html` <em>(deliverable${m.billingPercent != null ? `, ${m.billingPercent}%` : ''})</em>` : ''}</td><td>${fmtDate(m.dueDate)}</td><td>${m.progress.percent == null ? '—' : `${m.progress.percent}%`}</td><td>${m.acceptedAt ? `Accepted ${fmtDate(m.acceptedAt)}` : m.submittedAt ? `Submitted ${fmtDate(m.submittedAt)}` : HEALTH[m.value] || ''}</td></tr>`)}</tbody></table>
    <h2>Overdue (${p.overdue.length})</h2>
    ${p.overdue.length ? html`<table><tbody>${p.overdue.slice(0, 10).map((t) => html`<tr><td>${t.key}</td><td>${t.title}</td><td>${t.assigneeName || 'Unassigned'}</td><td>Due ${fmtDate(t.dueDate)}</td></tr>`)}</tbody></table>` : html`<p>Nothing overdue.</p>`}
    <h2>Next two weeks</h2>
    ${p.upcoming.length ? html`<table><tbody>${p.upcoming.slice(0, 12).map((t) => html`<tr><td>${t.key}</td><td>${t.title}</td><td>${t.assigneeName || 'Unassigned'}</td><td>${fmtDate(t.dueDate)}</td></tr>`)}</tbody></table>` : html`<p>No tasks due.</p>`}
    <footer>${ctx.settings.companyName} · CORE Project Management</footer>`);
  document.body.appendChild(div);
  document.body.classList.add('pm-printing');
  const done = () => {
    document.body.classList.remove('pm-printing');
    div.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

// ---------- Board ----------
export async function boardView(el, { id }, query) {
  const [p, all] = await Promise.all([loadProject(id), api.get(`/api/pm/projects/${id}/tasks`)]);
  let tasks = all;
  const work = may(p.access, 'work');
  const state = { who: query.who || '', ms: query.ms || '', cancelled: query.cancelled === '1' };
  mount(el, html`
    ${projectHeader(p, 'board', may(p.access, 'manage') ? html`<button class="btn" id="cols">${icon('settings', 16)} Edit columns</button>` : '')}
    <div class="toolbar">
      <select id="f-who" aria-label="Assignee"><option value="">Everyone</option>${options([['me', 'Mine'], ['none', 'Unassigned'], ...p.members.filter((m) => m.role !== 'viewer').map((m) => [m.userId, m.name])], state.who)}</select>
      <select id="f-ms" aria-label="Milestone"><option value="">All milestones</option>${options([['none', 'No milestone'], ...p.milestones.map((m) => [m.id, m.name])], state.ms)}</select>
      <label class="field check inline"><input type="checkbox" id="f-cancelled" ${state.cancelled ? 'checked' : ''} /><span>Show cancelled</span></label>
      <span class="spacer"></span><span class="muted small" id="count"></span>
    </div>
    <div id="board"></div>
    ${work ? html`<p class="muted small pm-board-note">${icon('grip', 14)} Drag a card to another column or place, or use its ${icon('chevronDown', 14)} <strong>Move to</strong> menu (keyboard and phones).</p>` : ''}`);
  const shown = () => tasks.filter((t) => (!state.who || (state.who === 'me' ? t.assigneeId === ctx.user.id : state.who === 'none' ? !t.assigneeId : t.assigneeId === state.who))
    && (!state.ms || (state.ms === 'none' ? !t.milestoneIdEffective : t.milestoneIdEffective === state.ms)));
  const columns = () => p.statuses.filter((s) => s.category !== 'cancelled' || state.cancelled);
  const card = (t) => html`<article class="pm-card ${t.overdue ? 'is-overdue' : ''}" data-id="${t.id}" draggable="${work ? 'true' : 'false'}">
      <div class="pm-card-top"><span class="mono">${t.key}</span>${priorityBadge(t.priority)}${t.blocked ? html`<span class="pm-blocked" title="Blocked: waiting for another task">${icon('lock', 13)} Blocked</span>` : ''}
        ${work ? html`<button type="button" class="icon-btn pm-move-btn" data-move="${t.id}" aria-haspopup="menu" aria-label="Move ${t.key} to…" title="Move to…">${icon('chevronDown', 16)}</button>` : ''}</div>
      <a class="pm-card-title" href="#/projects/${p.id}/tasks/${t.id}">${t.title}</a>
      ${t.parentId ? html`<small class="muted">Subtask of ${tasks.find((x) => x.id === t.parentId)?.key || ''}</small>` : ''}
      <div class="pm-card-foot">${dueChip(t)}${t.checklist.length ? html`<span class="pm-meta" title="Checklist">${icon('check', 12)} ${t.checklistDone}/${t.checklist.length}</span>` : ''}${t.subtasks ? html`<span class="pm-meta" title="Subtasks">${icon('layers', 12)} ${t.subtasks}</span>` : ''}${t.ticket ? html`<span class="pm-meta" title="Service desk ticket ${t.ticket.ref}">${icon('ticket', 12)}</span>` : ''}<span class="spacer"></span>${avatar(t.assigneeName)}</div>
    </article>`;
  function draw(focusId) {
    const list = shown();
    mount(el.querySelector('#count'), `${plural(list.length, 'task')}`);
    const cols = columns();
    mount(el.querySelector('#board'), html`<div class="pm-board" style="--cols:${cols.length}">${cols.map((s) => {
      const inCol = list.filter((t) => t.statusId === s.id).sort(byRank);
      const all = tasks.filter((t) => t.statusId === s.id).length;
      const over = s.wipLimit && all > s.wipLimit;
      return html`<section class="pm-col pm-c-${s.color}" data-status="${s.id}" aria-label="${s.name}">
        <header><strong>${s.name}</strong><span class="pm-col-count ${over ? 'over' : ''}" title="${s.wipLimit ? `Work-in-progress limit ${s.wipLimit}` : ''}">${s.wipLimit ? `${all} / ${s.wipLimit}` : all}</span>
          ${over ? html`<small class="crm-due bad">${icon('alert', 12)} Over its limit of ${s.wipLimit}</small>` : ''}</header>
        ${work && s.category !== 'cancelled' ? html`<form class="pm-quick" data-quick="${s.id}"><input name="title" placeholder="+ Add a task" aria-label="New task in ${s.name}" maxlength="200" /></form>` : ''}
        <div class="pm-col-body">${inCol.length ? inCol.map(card) : html`<p class="crm-col-empty">${work ? 'Drop tasks here' : 'No tasks'}</p>`}</div>
      </section>`;
    })}</div>`);
    wire();
    if (focusId) el.querySelector(`[data-move="${focusId}"]`)?.focus();
  }
  const reloadTasks = async (focusId) => {
    tasks = await api.get(`/api/pm/projects/${id}/tasks`);
    draw(focusId);
  };
  async function move(t, statusId, beforeId, afterId, focus) {
    try {
      const r = await api.put(`/api/pm/tasks/${t.id}/move`, { statusId, beforeId: beforeId || null, afterId: afterId || null });
      if (r.wipWarning) toast(r.wipWarning, 'error');
      else if (statusId !== t.statusId) toast(`${t.key} moved to ${p.statuses.find((s) => s.id === statusId)?.name}.`);
      changed();
    } catch (err) {
      toast(err.message, 'error');
    }
    await reloadTasks(focus ? t.id : null);
  }
  function wire() {
    el.querySelectorAll('.pm-quick').forEach((f) => f.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const title = f.title.value.trim();
      if (!title) return;
      f.title.disabled = true;
      const t = await api.post(`/api/pm/projects/${id}/tasks`, { title, statusId: f.dataset.quick, position: 'top', milestoneId: state.ms && state.ms !== 'none' ? state.ms : null, assigneeId: state.who === 'me' ? ctx.user.id : null });
      toast(`Task ${t.key} added.`);
      changed();
      await reloadTasks();
      el.querySelector(`[data-quick="${f.dataset.quick}"] input`)?.focus();
    }, reloadTasks)));
    el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      moveMenu(b, tasks.find((t) => t.id === b.dataset.move));
    }));
    if (!work) return;
    // Pointer drag (HTML5): the drop place is worked out from where the pointer is in the column.
    let dragId = null;
    const marker = document.createElement('div');
    marker.className = 'pm-drop-line';
    el.querySelectorAll('.pm-card').forEach((c) => {
      c.addEventListener('dragstart', (e) => {
        dragId = c.dataset.id;
        e.dataTransfer.setData('text/plain', dragId);
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => c.classList.add('dragging'));
      });
      c.addEventListener('dragend', () => {
        c.classList.remove('dragging');
        marker.remove();
        el.querySelectorAll('.pm-col.over').forEach((x) => x.classList.remove('over'));
      });
    });
    const placeIn = (col, y) => {
      const cards = [...col.querySelectorAll('.pm-card:not(.dragging)')];
      const next = cards.find((c) => y < c.getBoundingClientRect().top + c.offsetHeight / 2);
      return { next, prev: next ? cards[cards.indexOf(next) - 1] : cards.at(-1) };
    };
    el.querySelectorAll('.pm-col').forEach((col) => {
      const body = col.querySelector('.pm-col-body');
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('over');
        const { next } = placeIn(col, e.clientY);
        if (next) body.insertBefore(marker, next);
        else body.appendChild(marker);
      });
      col.addEventListener('dragleave', (e) => !col.contains(e.relatedTarget) && (col.classList.remove('over'), marker.remove()));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('over');
        marker.remove();
        const t = tasks.find((x) => x.id === (e.dataTransfer.getData('text/plain') || dragId));
        if (!t) return;
        const { next, prev } = placeIn(col, e.clientY);
        const beforeId = prev?.dataset.id === t.id ? null : prev?.dataset.id;
        const afterId = next?.dataset.id === t.id ? null : next?.dataset.id;
        move(t, col.dataset.status, beforeId, afterId);
      });
    });
  }
  // "Move to": every status, and up or down in the column. Works with the keyboard and on phones.
  function moveMenu(btn, t) {
    document.querySelector('.pm-move-pop')?.remove();
    const col = tasks.filter((x) => x.statusId === t.statusId).sort(byRank);
    const i = col.findIndex((x) => x.id === t.id);
    const pop = document.createElement('div');
    pop.className = 'menu-pop pm-move-pop';
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', `Move ${t.key}`);
    mount(pop, html`<div class="menu-label">Move ${t.key} to</div>
      ${p.statuses.map((s) => html`<button type="button" role="menuitem" data-to="${s.id}" ${s.id === t.statusId ? 'disabled aria-current="true"' : ''}>${statusChip(s)}${s.id === t.statusId ? html`<small class="muted">now</small>` : ''}</button>`)}
      <div class="menu-sep"></div>
      <button type="button" role="menuitem" data-up ${i <= 0 ? 'disabled' : ''}>${icon('up', 16)} Move up</button>
      <button type="button" role="menuitem" data-down ${i < 0 || i >= col.length - 1 ? 'disabled' : ''}>${icon('down', 16)} Move down</button>`);
    // Placed on the page (not in the column, which scrolls), under the button, inside the window.
    el.appendChild(pop);
    const place = () => {
      const r = btn.getBoundingClientRect();
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      pop.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
      pop.style.top = `${r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
    };
    place();
    const items = [...pop.querySelectorAll('button:not([disabled])')];
    items[0]?.focus();
    const close = (refocus = true) => {
      pop.remove();
      document.removeEventListener('click', outside, true);
      removeEventListener('scroll', place, true);
      removeEventListener('resize', place);
      if (refocus && btn.isConnected) btn.focus();
    };
    // It follows its card when the page or the board scrolls.
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    const outside = (e) => !pop.contains(e.target) && close(false);
    setTimeout(() => document.addEventListener('click', outside, true));
    pop.addEventListener('keydown', (e) => {
      const k = items.indexOf(document.activeElement);
      if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close());
      else if (e.key === 'ArrowDown') (e.preventDefault(), items[(k + 1) % items.length]?.focus());
      else if (e.key === 'ArrowUp') (e.preventDefault(), items[(k - 1 + items.length) % items.length]?.focus());
      else if (e.key === 'Tab') close(false);
    });
    pop.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', () => {
      close(false);
      const target = tasks.filter((x) => x.statusId === b.dataset.to).sort(byRank);
      move(t, b.dataset.to, target.at(-1)?.id, null, true);
    }));
    pop.querySelector('[data-up]')?.addEventListener('click', () => (close(false), move(t, t.statusId, col[i - 2]?.id, col[i - 1].id, true)));
    pop.querySelector('[data-down]')?.addEventListener('click', () => (close(false), move(t, t.statusId, col[i + 1].id, col[i + 2]?.id, true)));
  }
  const setQuery = () => {
    const qs = new URLSearchParams(Object.entries({ who: state.who, ms: state.ms, cancelled: state.cancelled ? '1' : '' }).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/projects/${id}/board${qs ? `?${qs}` : ''}`);
    draw();
  };
  el.querySelector('#f-who').addEventListener('change', (e) => ((state.who = e.target.value), setQuery()));
  el.querySelector('#f-ms').addEventListener('change', (e) => ((state.ms = e.target.value), setQuery()));
  el.querySelector('#f-cancelled').addEventListener('change', (e) => ((state.cancelled = e.target.checked), setQuery()));
  el.querySelector('#cols')?.addEventListener('click', () => editStatuses({ statuses: p.statuses, counts: Object.fromEntries(p.statuses.map((s) => [s.id, tasks.filter((t) => t.statusId === s.id).length])), title: 'Board columns',
    save: (statuses, moveTo) => api.put(`/api/pm/projects/${id}/statuses`, { statuses, moveTo, version: p.version }), after: () => boardView(el, { id }, query) }));
  draw();
}

// Statuses editor: Edit columns on a project's board, and the defaults in the Projects setup.
// counts: tasks per status (a removed status that has tasks asks where they go).
function editStatuses({ statuses, counts = {}, title, save, after }) {
  const list = statuses.map((s) => ({ ...s }));
  const removed = [];
  const { form } = modal({
    title, wide: true, subtitle: 'The columns of the board, left to right. Each belongs to a category: progress and "overdue" go by the category. Keep one To do and one Done status. A WIP limit only warns.',
    body: html`<div id="st"></div>`,
    onSubmit: async (f) => {
      read();
      const moveTo = Object.fromEntries(removed.filter((s) => counts[s.id]).map((s) => [s.id, f.querySelector(`[data-moveto="${s.id}"]`)?.value]));
      await save(list.map((s) => ({ id: s.id, name: s.name, category: s.category, color: s.color, wipLimit: s.wipLimit || null })), moveTo);
      toast('Statuses saved.');
      changed();
      after?.();
    },
  });
  const box = form.querySelector('#st');
  const read = () => box.querySelectorAll('tbody tr').forEach((tr, i) => Object.assign(list[i], { name: tr.querySelector('[name=n]').value, category: tr.querySelector('[name=c]').value, color: tr.querySelector('[name=k]').value, wipLimit: tr.querySelector('[name=w]').value }));
  const draw = () => {
    mount(box, html`<table class="table compact no-stack pm-status-table"><thead><tr><th>Status</th><th>Category</th><th>Colour</th><th class="num">WIP limit</th><th></th></tr></thead><tbody>${list.map((s, i) => html`<tr>
        <td><input name="n" value="${s.name}" maxlength="40" aria-label="Status name" /></td>
        <td><select name="c" aria-label="Category">${options(Object.entries(CATEGORIES), s.category)}</select></td>
        <td><select name="k" aria-label="Colour">${options(Object.entries(STATUS_COLORS), s.color)}</select></td>
        <td class="num"><input name="w" type="number" min="1" max="99" value="${s.wipLimit || ''}" aria-label="WIP limit" /></td>
        <td class="row-actions"><button type="button" class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${s.name} left">${icon('up', 16)}</button><button type="button" class="icon-btn" data-down="${i}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move ${s.name} right">${icon('down', 16)}</button><button type="button" class="icon-btn danger" data-rm="${i}" aria-label="Remove ${s.name}">${icon('trash', 16)}</button></td></tr>`)}</tbody></table>
      <p><button type="button" class="btn" id="add-st">+ Status</button></p>
      ${removed.filter((s) => counts[s.id]).map((s) => html`<label class="field"><span>${plural(counts[s.id], 'task')} in “${s.name}” move to</span><select data-moveto="${s.id}">${options(list.filter((x) => x.id).map((x) => [x.id, x.name]))}</select></label>`)}`);
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      read();
      const [s] = list.splice(Number(b.dataset.rm), 1);
      if (s.id) removed.push(s);
      draw();
    }));
    box.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
      read();
      const i = Number(b.dataset.up);
      [list[i - 1], list[i]] = [list[i], list[i - 1]];
      draw();
    }));
    box.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => {
      read();
      const i = Number(b.dataset.down);
      [list[i + 1], list[i]] = [list[i], list[i + 1]];
      draw();
    }));
    box.querySelector('#add-st').addEventListener('click', () => {
      read();
      list.splice(Math.max(0, list.findIndex((s) => s.category === 'done')), 0, { name: 'New status', category: 'active', color: 'blue' });
      draw();
      box.querySelectorAll('[name=n]')[Math.max(0, list.findIndex((s) => !s.id))]?.select();
    });
  };
  draw();
}

// ---------- List ----------
export async function listView(el, { id }, query) {
  const [p, all] = await Promise.all([loadProject(id), api.get(`/api/pm/projects/${id}/tasks`)]);
  let tasks = all;
  const work = may(p.access, 'work');
  const state = { q: query.q || '', group: query.group === 'status' ? 'status' : 'milestone', who: query.who || '', show: query.show || 'open', overdue: query.overdue === '1', sort: query.sort || 'rank', dir: query.dir === 'desc' ? -1 : 1 };
  const people = await assigneeOptions(p, p.access, null);
  const queue = saveQueue();
  mount(el, html`
    ${projectHeader(p, 'list', html`<button class="btn" id="export">${icon('download', 16)} Export CSV</button>${work ? html`<button class="btn primary" id="new">+ Task</button>` : ''}`)}
    <section class="card scroll-x">
      <div class="toolbar pad">
        <input type="search" id="q" placeholder="Search tasks…" aria-label="Search tasks" value="${state.q}" />
        <select id="f-group" aria-label="Group by">${options([['milestone', 'Group by milestone'], ['status', 'Group by status']], state.group)}</select>
        <select id="f-who" aria-label="Assignee"><option value="">Everyone</option>${options([['me', 'Mine'], ['none', 'Unassigned'], ...p.members.filter((m) => m.role !== 'viewer').map((m) => [m.userId, m.name])], state.who)}</select>
        <select id="f-show" aria-label="Which tasks">${options([['open', 'Open tasks'], ['done', 'Done'], ['all', 'All tasks']], state.show)}</select>
        <label class="field check inline"><input type="checkbox" id="f-overdue" ${state.overdue ? 'checked' : ''} /><span>Overdue only</span></label>
        <select id="f-sort" class="pm-phone-only" aria-label="Sort by">${options([['rank', 'Board order'], ['due', 'Sort by due date'], ['priority', 'Sort by priority'], ['assignee', 'Sort by assignee'], ['status', 'Sort by status'], ['title', 'Sort by title']], state.sort)}</select>
      </div>
      <div id="list"></div>
    </section>`);
  const SORTS = {
    rank: byRank, key: (a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }), title: (a, b) => a.title.localeCompare(b.title),
    status: (a, b) => p.statuses.findIndex((s) => s.id === a.statusId) - p.statuses.findIndex((s) => s.id === b.statusId),
    assignee: (a, b) => (a.assigneeName || '~').localeCompare(b.assigneeName || '~'), due: (a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'),
    priority: (a, b) => Object.keys(PRIORITY).indexOf(b.priority) - Object.keys(PRIORITY).indexOf(a.priority),
  };
  const match = (t) => (!state.q || `${t.key} ${t.title} ${t.assigneeName || ''}`.toLowerCase().includes(state.q.toLowerCase()))
    && (!state.who || (state.who === 'me' ? t.assigneeId === ctx.user.id : state.who === 'none' ? !t.assigneeId : t.assigneeId === state.who))
    && (state.show === 'all' || (state.show === 'done' ? !['todo', 'active'].includes(t.category) : ['todo', 'active'].includes(t.category))) && (!state.overdue || t.overdue);
  // Shown rows: matching tasks, each subtask under its parent (the parent is shown when a subtask matches).
  function rows(group) {
    const cmp = (a, b) => SORTS[state.sort](a, b) * state.dir || byRank(a, b);
    const hits = group.filter(match);
    const parents = group.filter((t) => !t.parentId && (hits.includes(t) || hits.some((s) => s.parentId === t.id))).sort(cmp);
    const orphans = hits.filter((t) => t.parentId && !group.some((x) => x.id === t.parentId)).sort(cmp);
    return [...parents.flatMap((t) => [t, ...hits.filter((s) => s.parentId === t.id).sort(cmp)]), ...orphans];
  }
  const th = (k, label) => html`<th ${state.sort === k ? html`aria-sort="${state.dir === 1 ? 'ascending' : 'descending'}"` : ''}><button type="button" class="pm-sort ${state.sort === k ? (state.dir === 1 ? 'on asc' : 'on desc') : ''}" data-sort="${k}" aria-label="Sort by ${label}">${label}</button></th>`;
  const row = (t) => html`<tr data-href="#/projects/${id}/tasks/${t.id}" class="${t.parentId ? 'pm-sub' : ''} ${t.overdue ? 'pm-late' : ''}">
      <td><a href="#/projects/${id}/tasks/${t.id}"><strong>${t.title}</strong></a><small><span class="mono">${t.key}</span>${t.blocked ? html` · ${icon('lock', 12)} blocked` : ''}${t.subtasks ? ` · ${plural(t.subtasks, 'subtask')}` : ''}${t.checklist.length ? ` · ${t.checklistDone}/${t.checklist.length} checked` : ''}</small></td>
      <td>${work ? html`<select data-f="statusId" data-id="${t.id}" aria-label="Status of ${t.key}">${options(p.statuses.map((s) => [s.id, s.name]), t.statusId)}</select>` : statusChip(p.statuses.find((s) => s.id === t.statusId))}</td>
      <td>${work ? html`<select data-f="assigneeId" data-id="${t.id}" aria-label="Assignee of ${t.key}">${people}</select>` : t.assigneeName || '—'}</td>
      <td>${work ? html`<input type="date" data-f="dueDate" data-id="${t.id}" value="${t.dueDate || ''}" aria-label="Due date of ${t.key}" class="${t.overdue ? 'bad' : ''}" />` : t.dueDate ? dueChip(t, { long: true }) : '—'}</td>
      <td>${priorityBadge(t.priority) || PRIORITY[t.priority]}</td>
      <td class="num">${t.estimateHours != null ? hrs(t.estimateHours) : '—'}</td>
    </tr>`;
  function groups() {
    if (state.group === 'status') return p.statuses.map((s) => ({ key: s.id, title: html`${statusChip(s)}`, list: tasks.filter((t) => t.statusId === s.id) }));
    return [...p.milestones.map((m) => ({ key: m.id, title: html`<span class="pm-diamond ${m.deliverable ? 'deliverable' : ''}" aria-hidden="true"></span>${m.name} <small class="muted">due ${fmtDate(m.dueDate)}</small>`, list: tasks.filter((t) => t.milestoneIdEffective === m.id) })),
      { key: 'none', title: 'No milestone', list: tasks.filter((t) => !t.milestoneIdEffective) }];
  }
  function draw() {
    const qs = new URLSearchParams(Object.entries({ q: state.q, group: state.group === 'status' ? 'status' : '', who: state.who, show: state.show === 'open' ? '' : state.show, overdue: state.overdue ? '1' : '', sort: state.sort === 'rank' ? '' : state.sort, dir: state.dir === -1 ? 'desc' : '' }).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/projects/${id}/list${qs ? `?${qs}` : ''}`);
    const gs = groups().map((g) => ({ ...g, rows: rows(g.list) })).filter((g) => g.rows.length);
    mount(el.querySelector('#list'), gs.length ? html`<table class="table clickable pm-list">
      <thead><tr>${th('title', 'Task')}${th('status', 'Status')}${th('assignee', 'Assignee')}${th('due', 'Due')}${th('priority', 'Priority')}<th class="num">Estimate</th></tr></thead>
      ${gs.map((g) => html`<tbody><tr class="pm-group"><th colspan="6" scope="rowgroup">${g.title} <span class="muted small">${plural(g.rows.length, 'task')}</span></th></tr>${g.rows.map(row)}</tbody>`)}
    </table>` : html`<div class="empty"><p>${tasks.length ? 'No task matches the filters.' : work ? 'No tasks yet. Add one with + Task, or on the board.' : 'No tasks yet.'}</p></div>`);
    el.querySelectorAll('select[data-f="assigneeId"]').forEach((s) => (s.value = tasks.find((t) => t.id === s.dataset.id)?.assigneeId || ''));
    el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a, select, input, button') && (location.hash = tr.dataset.href)));
    el.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      if (state.sort === b.dataset.sort) state.dir = -state.dir;
      else (state.sort = b.dataset.sort), (state.dir = 1);
      draw();
      el.querySelector(`[data-sort="${b.dataset.sort}"]`)?.focus();
    }));
    el.querySelectorAll('[data-f]').forEach((input) => input.addEventListener('change', () => {
      const value = input.value || null;
      queue(`${input.dataset.id}:${input.dataset.f}`, guard(async () => {
        const t = tasks.find((x) => x.id === input.dataset.id);
        const saved = await api.put(`/api/pm/tasks/${t.id}`, { [input.dataset.f]: value, version: t.version });
        tasks = tasks.map((x) => (x.id === saved.id ? saved : x));
        toast(`${saved.key} saved.`);
        changed();
        const focused = document.activeElement?.matches?.('[data-f]') && document.activeElement !== input;
        draw();
        if (!focused) el.querySelector(`[data-f="${input.dataset.f}"][data-id="${saved.id}"]`)?.focus();
      }, async () => ((tasks = await api.get(`/api/pm/projects/${id}/tasks`)), draw())), input.type === 'date' ? 700 : 0);
    }));
  }
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value.trim()), draw()));
  el.querySelector('#f-group').addEventListener('change', (e) => ((state.group = e.target.value), draw()));
  el.querySelector('#f-who').addEventListener('change', (e) => ((state.who = e.target.value), draw()));
  el.querySelector('#f-show').addEventListener('change', (e) => ((state.show = e.target.value), draw()));
  el.querySelector('#f-overdue').addEventListener('change', (e) => ((state.overdue = e.target.checked), draw()));
  el.querySelector('#f-sort').addEventListener('change', (e) => ((state.sort = e.target.value), (state.dir = 1), draw()));
  el.querySelector('#new')?.addEventListener('click', () => newTask(p, tasks, {}, async () => ((tasks = await api.get(`/api/pm/projects/${id}/tasks`)), draw())));
  el.querySelector('#export').addEventListener('click', () => {
    const shown = groups().flatMap((g) => rows(g.list));
    downloadFile(`${p.code}-tasks-${today()}.csv`, toCsv(taskCsvRows(shown, p.milestones)));
  });
  if (state.overdue) state.show = 'open';
  draw();
}

// ---------- Timeline ----------
// Read-only, built with CSS grid: a column per day, weeks across the top, milestones as diamonds,
// tasks with a start and due date as bars (only a due date: a dot). On a phone, a dated list.
export async function timelineView(el, { id }) {
  const [p, tasks] = await Promise.all([loadProject(id), api.get(`/api/pm/projects/${id}/tasks`)]);
  const cal = workCalendar(ctx.settings, ctx.holidays);
  const t0 = today();
  const dates = [p.startDate, p.endDate, t0, ...p.milestones.map((m) => m.dueDate), ...tasks.flatMap((t) => [t.startDate, t.dueDate])].filter(Boolean).sort();
  const first = weekStart(dates[0]);
  let last = addDays(weekStart(dates.at(-1)), 6);
  const MAX = 52 * 7;
  const capped = daysBetween(first, last) + 1 > MAX;
  if (capped) last = addDays(first, MAX - 1);
  const days = daysBetween(first, last) + 1;
  const col = (ymd) => Math.min(days, Math.max(1, daysBetween(first, ymd) + 1));
  const within = (ymd) => ymd >= first && ymd <= last;
  const weeks = Array.from({ length: days / 7 }, (_, i) => addDays(first, i * 7));
  const off = Array.from({ length: days }, (_, i) => addDays(first, i)).map((d, i) => (!isWorkDay(d, cal) ? i + 1 : 0)).filter(Boolean);
  const groups = [...p.milestones.map((m) => ({ m, list: tasks.filter((t) => t.milestoneIdEffective === m.id) })), { m: null, list: tasks.filter((t) => !t.milestoneIdEffective) }].filter((g) => g.m || g.list.length);
  const order = (list) => list.filter((t) => !t.parentId).sort((a, b) => (a.startDate || a.dueDate || '9').localeCompare(b.startDate || b.dueDate || '9') || byRank(a, b)).flatMap((t) => [t, ...list.filter((s) => s.parentId === t.id).sort(byRank)]).concat(list.filter((t) => t.parentId && !list.some((x) => x.id === t.parentId)));
  const bar = (t) => {
    if (!t.dueDate || !within(t.dueDate) && !(t.startDate && within(t.startDate))) return '';
    const label = `${t.key} ${t.title}: ${t.startDate ? `${fmtDate(t.startDate)} – ` : 'due '}${fmtDate(t.dueDate)} · ${t.statusName}`;
    if (!t.startDate) return html`<span class="pm-tl-dot cat-${t.category} ${t.overdue ? 'late' : ''}" style="grid-column:${col(t.dueDate)}" title="${label}" role="img" aria-label="${label}"></span>`;
    return html`<span class="pm-tl-bar cat-${t.category} ${t.overdue ? 'late' : ''}" style="grid-column:${col(t.startDate)} / ${col(t.dueDate) + 1}" title="${label}" role="img" aria-label="${label}"></span>`;
  };
  const taskRow = (t) => html`<div class="pm-tl-row ${t.parentId ? 'sub' : ''}"><div class="pm-tl-label"><a href="#/projects/${id}/tasks/${t.id}" title="${t.title}">${t.title}</a><small class="mono">${t.key}</small></div><div class="pm-tl-track">${bar(t)}</div></div>`;
  const msRow = (m) => html`<div class="pm-tl-row ms"><div class="pm-tl-label"><strong>${m.name}</strong><small>${m.deliverable ? 'Deliverable · ' : ''}due ${fmtDate(m.dueDate)}</small></div><div class="pm-tl-track">${within(m.dueDate) ? html`<span class="pm-tl-ms ${m.deliverable ? 'deliverable' : ''} ${m.value || ''}" style="grid-column:${col(m.dueDate)}" title="${m.name}: due ${fmtDate(m.dueDate)}" role="img" aria-label="Milestone ${m.name}, due ${fmtDate(m.dueDate)}"></span>` : ''}</div></div>`;
  const dated = [...tasks.filter((t) => t.dueDate).map((t) => ({ date: t.dueDate, t })), ...p.milestones.map((m) => ({ date: m.dueDate, m }))].sort((a, b) => a.date.localeCompare(b.date) || (a.m ? -1 : 1));
  mount(el, html`
    ${projectHeader(p, 'timeline')}
    <section class="card pm-tl-card">
      <div class="pm-tl-legend muted small"><span><span class="pm-tl-swatch cat-todo"></span>To do</span><span><span class="pm-tl-swatch cat-active"></span>In progress</span><span><span class="pm-tl-swatch cat-done"></span>Done</span><span><span class="pm-tl-swatch late"></span>Overdue</span><span><span class="pm-diamond"></span>Milestone</span><span><span class="pm-diamond deliverable"></span>Deliverable</span><span><span class="pm-tl-swatch off"></span>Weekend or holiday</span></div>
      ${capped ? html`<p class="notice small">${icon('alert', 16)} <span>The project runs longer than a year; the timeline shows its first 52 weeks.</span></p>` : ''}
      <div class="pm-tl-scroll" tabindex="0" aria-label="Timeline, scrolls sideways">
        <div class="pm-tl" style="--days:${days}">
          <div class="pm-tl-bg" aria-hidden="true">${off.map((c) => html`<i style="grid-column:${c}"></i>`)}${within(t0) ? html`<b class="pm-tl-today" style="grid-column:${col(t0)}" title="Today"></b>` : ''}</div>
          <div class="pm-tl-row head"><div class="pm-tl-label"><strong>Task</strong></div><div class="pm-tl-track weeks">${weeks.map((w, i) => html`<span style="grid-column:${i * 7 + 1} / span 7"><b>${short(w)}</b> <small>W${isoWeek(w)}</small></span>`)}</div></div>
          ${groups.map((g) => html`${g.m ? msRow(g.m) : html`<div class="pm-tl-row ms"><div class="pm-tl-label"><strong>No milestone</strong></div><div class="pm-tl-track"></div></div>`}${order(g.list).map(taskRow)}`)}
        </div>
      </div>
      <ol class="pm-tl-list">${dated.map(({ date, t, m }) => html`<li class="${m ? 'ms' : ''}"><span class="pm-tl-date">${short(date)}</span>${m ? html`<span class="grow"><span class="pm-diamond ${m.deliverable ? 'deliverable' : ''}" aria-hidden="true"></span><strong>${m.name}</strong><small>${m.deliverable ? 'Deliverable · ' : 'Milestone · '}${m.acceptedAt ? `accepted ${short(m.acceptedAt)}` : m.finished ? 'work done' : HEALTH[m.value] || ''}</small></span>`
        : html`<span class="grow"><a href="#/projects/${id}/tasks/${t.id}"><strong>${t.title}</strong></a><small><span class="mono">${t.key}</span> · ${t.statusName}${t.startDate ? ` · from ${short(t.startDate)}` : ''}${t.assigneeName ? ` · ${t.assigneeName}` : ''}</small></span>${t.overdue ? badge('Overdue', 'red') : ''}`}</li>`)}</ol>
      ${dated.length ? '' : html`<p class="muted">No dated tasks or milestones yet.</p>`}
    </section>`);
  // Open on today.
  const scroller = el.querySelector('.pm-tl-scroll');
  const todayMark = el.querySelector('.pm-tl-today');
  if (scroller && todayMark && within(t0)) scroller.scrollLeft = Math.max(0, todayMark.offsetLeft - scroller.clientWidth / 2);
}

// ---------- Task ----------
export async function taskView(el, { projectId, id }) {
  let t = await api.get(`/api/pm/tasks/${id}`);
  const queue = saveQueue();
  if (t.projectId !== projectId) return (location.hash = `#/projects/${t.projectId}/tasks/${t.id}`);
  const p = t.project;
  async function render() {
    const comments = await api.get(`/api/pm/tasks/${id}/comments`);
    const work = may(t.access, 'work');
    const status = p.statuses.find((s) => s.id === t.statusId);
    const usernames = p.members.map((m) => m.username).filter(Boolean);
    const assignees = await assigneeOptions({ ...p, milestones: [] }, t.access, t.assigneeId);
    const canDelete = may(t.access, 'manage') || (work && t.createdBy === ctx.user.id);
    const blockedChoices = t.others.filter((x) => !t.blockedBy.includes(x.id));
    const hist = (h) => html`<li><strong>${h.byName}</strong> ${h.field === 'created' ? html`added the task${h.to ? ` (${h.to})` : ''}` : html`${h.field}: ${h.from || '—'} → ${h.to || '—'}`}<small class="muted">${when(h.at)}</small></li>`;
    const comment = (c) => html`<li class="pm-comment"><span class="avatar xs">${initials(c.userName)}</span><div class="grow"><div><strong>${c.userName}</strong> <small class="muted">${when(c.createdAt)}</small>
      ${c.canDelete ? html`<button type="button" class="icon-btn danger" data-del-c="${c.id}" aria-label="Delete comment">${icon('trash', 14)}</button>` : ''}</div>
      <p class="pre">${mentionParts(c.body, usernames).map((x) => (x.mention ? html`<mark class="pm-mention">@${x.mention}</mark>` : x.text))}</p></div></li>`;
    mount(el, html`<div class="pm-task-page">
      <header class="page-head">
        <div><a class="back" href="#/projects/${p.id}/board">← ${p.code} · ${p.name}</a>
          <p class="tag-line mono">${t.key}${t.parent ? html` · subtask of <a href="#/projects/${p.id}/tasks/${t.parent.id}">${t.parent.key}</a>` : ''}</p>
          <h1>${t.title} ${statusChip(status)}</h1>
          <p class="muted">${t.overdue ? html`${badge('Overdue', 'red')} ` : ''}${t.blocked ? html`${badge('Blocked', 'amber')} ` : ''}${priorityBadge(t.priority)} Added ${when(t.createdAt)}</p></div>
        <div class="actions">${work ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit title and description</button>` : ''}${canDelete ? html`<button class="btn danger ghost" id="del">Delete</button>` : ''}</div>
      </header>
      <div class="pm-task">
        <div class="stack">
          <section class="card"><h2>Description</h2>${t.description ? html`<p class="pre">${t.description}</p>` : html`<p class="muted">No description.</p>`}</section>
          <section class="card"><div class="card-head"><h2>${icon('check')} Checklist</h2><span class="muted small">${t.checklist.length ? `${t.checklistDone}/${t.checklist.length} done` : ''}</span></div>
            ${t.checklist.length ? html`<ul class="crm-checklist">${t.checklist.map((i) => html`<li class="${i.done ? 'done' : ''}"><label><input type="checkbox" data-item="${i.id}" ${i.done ? 'checked' : ''} ${work ? '' : 'disabled'} /><span>${i.text}</span></label>${work ? html`<button type="button" class="icon-btn" data-rm-item="${i.id}" aria-label="Remove ${i.text}">${icon('x', 14)}</button>` : ''}</li>`)}</ul>` : html`<p class="muted small">No checklist.</p>`}
            ${work ? html`<form id="add-item" class="crm-add-item"><input name="text" maxlength="300" placeholder="Add a checklist item…" aria-label="Checklist item" /><button class="btn" type="submit">Add</button></form>` : ''}</section>
          ${t.parentId ? '' : html`<section class="card"><div class="card-head"><h2>${icon('layers')} Subtasks</h2><span class="muted small">${t.subtaskList.length ? `${t.subtaskList.filter((s) => s.category === 'done').length}/${t.subtaskList.length} done` : ''}</span></div>
            ${t.subtaskList.length ? html`<ul class="crm-mini">${t.subtaskList.map((s) => html`<li><span class="grow"><a href="#/projects/${p.id}/tasks/${s.id}"><strong>${s.title}</strong></a><small><span class="mono">${s.key}</span> · ${s.statusName}${s.assigneeName ? ` · ${s.assigneeName}` : ''}</small></span>${dueChip(s)}</li>`)}</ul>` : html`<p class="muted small">No subtasks. A subtask counts for progress instead of this task.</p>`}
            ${work ? html`<form id="add-sub" class="crm-add-item"><input name="title" maxlength="200" placeholder="Add a subtask…" aria-label="Subtask title" /><button class="btn" type="submit">Add</button></form>` : ''}</section>`}
          <section class="card"><h2>${icon('comment')} Comments</h2>
            ${comments.length ? html`<ul class="pm-comments">${comments.map(comment)}</ul>` : html`<p class="muted small">No comments yet.</p>`}
            ${may(t.access, 'comment') ? html`<form id="comment" class="pm-composer"><textarea name="body" rows="3" maxlength="4000" placeholder="Write a comment. Mention someone with @ and their username." aria-label="Comment"></textarea>
              <div class="crm-composer-foot"><small class="muted">${usernames.length ? `On this project: ${usernames.map((u) => `@${u}`).join(', ')}` : ''}</small><span class="spacer"></span><button class="btn primary" type="submit">Comment</button></div></form>` : ''}
          </section>
          <section class="card"><details><summary><h2>${icon('activity')} History</h2></summary><ul class="pm-history">${[...t.history].reverse().map(hist)}</ul></details></section>
        </div>
        <aside class="stack">
          <section class="card"><h2>Details</h2>
            <form id="props" class="hd-props">
              <label class="field"><span>Status</span><select name="statusId" ${work ? '' : 'disabled'}>${options(p.statuses.map((s) => [s.id, s.name]), t.statusId)}</select></label>
              <label class="field"><span>Priority</span><select name="priority" ${work ? '' : 'disabled'}>${options(Object.entries(PRIORITY), t.priority)}</select></label>
              <label class="field"><span>Assignee</span><select name="assigneeId" ${work ? '' : 'disabled'}>${assignees}</select></label>
              <div class="grid two"><label class="field"><span>Start</span><input type="date" name="startDate" value="${t.startDate || ''}" ${work ? '' : 'disabled'} /></label>
                <label class="field"><span>Due</span><input type="date" name="dueDate" value="${t.dueDate || ''}" ${work ? '' : 'disabled'} /></label></div>
              <label class="field"><span>Estimate (hours)</span><input type="number" name="estimateHours" min="0" step="0.25" value="${t.estimateHours ?? ''}" ${work ? '' : 'disabled'} /></label>
              <label class="field"><span>Milestone</span><select name="milestoneId" ${work ? '' : 'disabled'}><option value="">${t.parentId && t.milestoneIdEffective ? 'As its parent' : 'None'}</option>${options(t.milestones.map((m) => [m.id, `${m.name} (${short(m.dueDate)})`]), t.milestoneId)}</select></label>
              ${t.subtasks ? '' : html`<label class="field"><span>Subtask of</span><select name="parentId" ${work ? '' : 'disabled'}><option value="">None (a task)</option>${options(t.others.filter((x) => !x.parentId).map((x) => [x.id, `${x.key} · ${x.title}`]), t.parentId)}</select></label>`}
            </form>
          </section>
          <section class="card"><h2>${icon('lock')} Blocked by</h2>
            ${t.blockedByList.length ? html`<ul class="crm-mini">${t.blockedByList.map((b) => html`<li><span class="grow"><a href="#/projects/${p.id}/tasks/${b.id}"><strong>${b.key}</strong> ${b.title}</a><small>${b.statusName}${b.category === 'done' ? ' · done' : ''}</small></span>${work ? html`<button type="button" class="icon-btn" data-unblock="${b.id}" aria-label="Not blocked by ${b.key}">${icon('x', 14)}</button>` : ''}</li>`)}</ul>` : html`<p class="muted small">Not waiting for another task.</p>`}
            ${work && blockedChoices.length ? html`<div class="crm-add-item"><select id="block-pick" aria-label="Task this one waits for"><option value="">Waits for…</option>${options(blockedChoices.map((x) => [x.id, `${x.key} · ${x.title}`]))}</select><button type="button" class="btn" id="block-add">Add</button></div>` : ''}
            ${t.blocking.length ? html`<p class="small muted">${t.blocking.map((b) => b.key).join(', ')} ${t.blocking.length === 1 ? 'waits' : 'wait'} for this task.</p>` : ''}
          </section>
          ${t.ticket ? html`<section class="card"><h2>${icon('ticket')} Service desk ticket</h2><p>${can('helpdesk.agent') ? html`<a href="#/helpdesk/tickets/${t.ticket.id}" class="mono">${t.ticket.ref}</a>` : html`<span class="mono">${t.ticket.ref}</span>`} ${badge(t.ticket.statusName, ['resolved', 'closed'].includes(t.ticket.status) ? 'green' : 'blue')}</p><p class="muted small">Closing one does not close the other.</p></section>` : ''}
          <section class="card"><div class="card-head"><h2>${icon('clock')} Time</h2><span class="muted small">${hrs(t.loggedHours)} logged${t.estimateHours != null ? ` of ${hrs(t.estimateHours)}` : ''}</span></div>
            ${t.time.length ? html`<ul class="crm-mini">${t.time.slice(0, 8).map((x) => html`<li><span class="grow"><strong>${hrs(x.hours)}</strong> ${x.userName}<small>${fmtDate(x.date)}${x.note ? ` · ${x.note}` : ''}</small></span></li>`)}</ul>` : html`<p class="muted small">No time logged on this task.</p>`}
            ${work ? html`<form id="log" class="pm-log-mini"><input type="date" name="date" value="${today()}" max="${today()}" aria-label="Date" /><input type="number" name="hours" min="0.25" max="24" step="0.25" placeholder="Hours" aria-label="Hours" /><input name="note" maxlength="500" placeholder="Note" aria-label="Note" /><button class="btn" type="submit">Log</button></form>` : ''}
          </section>
        </aside>
      </div></div>`);
    wire();
  }
  const reload = async (focus) => {
    t = await api.get(`/api/pm/tasks/${id}`);
    await render();
    if (focus) el.querySelector(focus)?.focus();
  };
  function wire() {
    el.querySelector('#props')?.addEventListener('change', (e) => {
      const { name, type } = e.target;
      const value = e.target.value || null;
      queue(name, guard(async () => {
        await api.put(`/api/pm/tasks/${id}`, { [name]: value, version: t.version });
        toast('Saved.');
        changed();
        await reload(`#props [name="${name}"]`);
      }, () => reload()), type === 'date' ? 700 : 0);
    });
    el.querySelectorAll('[data-item]').forEach((cb) => cb.addEventListener('change', guard(async () => {
      await api.put(`/api/pm/tasks/${id}/checklist`, { itemId: cb.dataset.item, done: cb.checked });
      await reload(`[data-item="${cb.dataset.item}"]`);
    }, () => reload())));
    el.querySelectorAll('[data-rm-item]').forEach((b) => b.addEventListener('click', guard(async () => {
      await api.put(`/api/pm/tasks/${id}/checklist`, { itemId: b.dataset.rmItem, remove: true });
      await reload('#add-item input');
    }, () => reload())));
    el.querySelector('#add-item')?.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      if (!e.target.text.value.trim()) return;
      await api.put(`/api/pm/tasks/${id}/checklist`, { add: e.target.text.value });
      await reload('#add-item input');
    }, () => reload()));
    el.querySelector('#add-sub')?.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const title = e.target.title.value.trim();
      if (!title) return;
      const s = await api.post(`/api/pm/projects/${p.id}/tasks`, { title, parentId: id, milestoneId: null, assigneeId: t.assigneeId });
      toast(`Subtask ${s.key} added.`);
      changed();
      await reload('#add-sub input');
    }, () => reload()));
    el.querySelector('#block-add')?.addEventListener('click', guard(async () => {
      const pick = el.querySelector('#block-pick').value;
      if (!pick) return;
      await api.put(`/api/pm/tasks/${id}`, { blockedBy: [...t.blockedBy, pick], version: t.version });
      toast('Saved.');
      await reload('#block-pick');
    }, () => reload()));
    el.querySelectorAll('[data-unblock]').forEach((b) => b.addEventListener('click', guard(async () => {
      await api.put(`/api/pm/tasks/${id}`, { blockedBy: t.blockedBy.filter((x) => x !== b.dataset.unblock), version: t.version });
      toast('Saved.');
      await reload();
    }, () => reload())));
    el.querySelector('#comment')?.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      if (btn.disabled || !e.target.body.value.trim()) return;
      btn.disabled = true;
      await api.post(`/api/pm/tasks/${id}/comments`, { body: e.target.body.value });
      await reload('#comment textarea');
    }, () => reload()));
    el.querySelectorAll('[data-del-c]').forEach((b) => b.addEventListener('click', guard(async () => {
      if (!(await confirmDialog('Delete this comment?', { title: 'Delete comment' }))) return;
      await api.del(`/api/pm/comments/${b.dataset.delC}`);
      await reload();
    }, () => reload())));
    el.querySelector('#log')?.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const f = e.target;
      const r = await api.post(`/api/pm/projects/${p.id}/time`, { date: f.date.value, hours: f.hours.value, note: f.note.value, taskId: id });
      toast(r.warning || `${hrs(r.hours)} logged.`, r.warning ? 'error' : 'ok');
      await reload('#log [name=hours]');
    }, () => reload()));
    el.querySelector('#edit')?.addEventListener('click', () => modal({
      title: `Edit ${t.key}`, wide: true,
      body: html`<div class="grid two"><label class="field span-2"><span>Title</span><input name="title" maxlength="200" value="${t.title}" /></label><label class="field span-2"><span>Description</span><textarea name="description" rows="8">${t.description || ''}</textarea></label></div>`,
      onSubmit: async (f) => {
        await api.put(`/api/pm/tasks/${id}`, { title: f.title.value, description: f.description.value, version: t.version });
        toast('Saved.');
        await reload();
      },
    }));
    el.querySelector('#del')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete ${t.key} ${t.title}?${t.subtasks ? ` Its ${plural(t.subtasks, 'subtask')} go with it.` : ''} Comments go too; time logged on it stays on the project.`, { title: 'Delete task' }))) return;
      await api.del(`/api/pm/tasks/${id}`).then(() => {
        toast('Task deleted.');
        changed();
        location.replace(`#/projects/${p.id}/board`);
      }, (err) => toast(err.message, 'error'));
    });
  }
  await render();
}

// ---------- Time tab ----------
export async function projectTimeView(el, { id }) {
  const [p, data] = await Promise.all([loadProject(id), api.get(`/api/pm/projects/${id}/time`)]);
  const work = may(p.access, 'work');
  const flag = (x) => (x.overAttended ? html`<span class="crm-due bad" title="${x.dayTotal} h logged that day; ${x.attended} h in the DTR">${icon('alert', 12)} Over attended (${x.attended} h)</span>` : '');
  const entryRow = (x) => html`<tr><td>${fmtDate(x.date)}</td><td>${x.userName}</td><td>${x.taskKey ? html`<a href="#/projects/${id}/tasks/${x.taskId}">${x.taskKey}</a> ${x.taskTitle}` : html`<span class="muted">Project work</span>`}${x.note ? html`<small>${x.note}</small>` : ''}</td><td class="num">${hrs(x.hours)}</td><td>${flag(x) || ''}</td>
    <td class="row-actions">${x.canDelete ? html`<button type="button" class="icon-btn danger" data-del="${x.id}" aria-label="Delete this entry">${icon('trash', 16)}</button>` : ''}</td></tr>`;
  const mineTotal = data.mine.reduce((n, x) => n + x.hours, 0);
  mount(el, html`
    ${projectHeader(p, 'time')}
    <div class="stats">
      <div class="card"><small>Logged</small><strong>${hrs(data.total)}</strong><span class="muted small">of ${hrs(data.estimate)} estimated${p.budgetHours ? ` · budget ${hrs(p.budgetHours)}` : ''}</span>${data.estimate ? html`<span class="progress"><i style="width:${Math.min(100, Math.round((data.total / data.estimate) * 100))}%"></i></span>` : ''}</div>
      <div class="card"><small>My hours this week</small><strong>${hrs(mineTotal)}</strong><span class="muted small">since ${fmtDate(weekStart(today()))}</span></div>
      <div class="card"><small>Not on a task</small><strong>${hrs(data.noTask)}</strong><span class="muted small">meetings and project work</span></div>
    </div>
    <div class="cols wide-left">
      <div class="stack">
        ${work ? html`<section class="card"><h2>${icon('clock')} Log time</h2>
          <form id="log" class="grid two">
            <label class="field"><span>Date</span><input type="date" name="date" value="${today()}" max="${today()}" /></label>
            <label class="field"><span>Hours</span><input type="number" name="hours" min="0.25" max="24" step="0.25" inputmode="decimal" placeholder="e.g. 1.5" /></label>
            <label class="field span-2"><span>Task</span><select name="taskId"><option value="">No task (project work, meetings)</option>${options(data.tasks.map((x) => [x.id, `${x.key} · ${x.title}`]))}</select></label>
            <label class="field span-2"><span>Note</span><input name="note" maxlength="500" placeholder="What you did (optional)" /></label>
            <div class="actions span-2"><small class="muted">Hours above your attendance in the DTR for that day are flagged, not refused.</small><span class="spacer"></span><button class="btn primary" type="submit">Log time</button></div>
          </form></section>` : ''}
        <section class="card scroll-x"><h2>${work ? 'My entries this week' : 'Entries'}</h2>
          ${(work ? data.mine : data.entries).length ? html`<table class="table"><thead><tr><th>Date</th><th>Who</th><th>Task</th><th class="num">Hours</th><th>Check</th><th></th></tr></thead><tbody>${(work ? data.mine : data.entries.slice(0, 50)).map(entryRow)}</tbody></table>` : html`<p class="muted pad">Nothing logged${work ? ' this week' : ''} yet.</p>`}
        </section>
        ${work && data.entries.length ? html`<section class="card scroll-x"><details><summary><h2>All entries (${data.entries.length})</h2></summary><table class="table"><thead><tr><th>Date</th><th>Who</th><th>Task</th><th class="num">Hours</th><th>Check</th><th></th></tr></thead><tbody>${data.entries.map(entryRow)}</tbody></table></details></section>` : ''}
      </div>
      <div class="stack">
        <section class="card scroll-x"><h2>By person</h2>${data.byPerson.length ? html`<table class="table"><thead><tr><th>Person</th><th class="num">Hours</th></tr></thead><tbody>${data.byPerson.map((x) => html`<tr><td>${x.name}</td><td class="num">${hrs(x.hours)}</td></tr>`)}</tbody></table>` : html`<p class="muted pad">No time logged yet.</p>`}</section>
        <section class="card scroll-x"><h2>By task: estimate and logged</h2>${data.byTask.length ? html`<table class="table"><thead><tr><th>Task</th><th class="num">Estimate</th><th class="num">Logged</th></tr></thead><tbody>${data.byTask.map((x) => html`<tr><td><a href="#/projects/${id}/tasks/${x.taskId}">${x.title}</a><small class="mono">${x.key}</small></td><td class="num">${x.estimate != null ? hrs(x.estimate) : '—'}</td><td class="num ${x.estimate != null && x.hours > x.estimate ? 'warn' : ''}">${hrs(x.hours)}</td></tr>`)}</tbody></table>` : html`<p class="muted pad">No estimates or time yet.</p>`}</section>
      </div>
    </div>`);
  const reload = () => projectTimeView(el, { id });
  el.querySelector('#log')?.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const f = e.target;
    const r = await api.post(`/api/pm/projects/${id}/time`, { date: f.date.value, hours: f.hours.value, taskId: f.taskId.value || null, note: f.note.value });
    toast(r.warning || `${hrs(r.hours)} logged.`, r.warning ? 'error' : 'ok');
    await reload();
    el.querySelector('#log [name=hours]')?.focus();
  }, reload));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', guard(async () => {
    if (!(await confirmDialog('Delete this time entry?', { title: 'Delete time' }))) return;
    await api.del(`/api/pm/projects/${id}/time/${b.dataset.del}`);
    toast('Deleted.');
    await reload();
  }, reload)));
}

// ---------- My work ----------
export async function myWorkView(el) {
  const g = await api.get('/api/pm/my-work');
  const total = Object.values(g).reduce((n, l) => n + l.length, 0);
  const row = (t) => html`<li class="${t.overdue ? 'pm-late' : ''}">
      <span class="grow"><a href="#/projects/${t.project.id}/tasks/${t.id}"><strong>${t.title}</strong></a>
        <small><span class="mono">${t.key}</span> · <a href="#/projects/${t.project.id}">${t.project.name}</a>${t.blocked ? ' · blocked' : ''}${t.checklist.length ? ` · ${t.checklistDone}/${t.checklist.length} checked` : ''}</small></span>
      ${dueChip(t)}
      ${may(t.access, 'work') ? html`<select data-status="${t.id}" aria-label="Status of ${t.key}">${options(t.project.statuses.map((s) => [s.id, s.name]), t.statusId)}</select>` : statusChip(t.project.statuses.find((s) => s.id === t.statusId))}
    </li>`;
  mount(el, html`
    ${head('My work', total ? `${plural(total, 'open task')} assigned to you, across your projects.` : 'Tasks assigned to you, across your projects.')}
    ${total ? Object.entries(MY_WORK_GROUPS).filter(([k]) => g[k].length).map(([k, label]) => html`<section class="card pm-mywork ${k}">
        <div class="card-head"><h2>${k === 'overdue' ? icon('alert') : icon('calendar')} ${label} <span class="muted small">${g[k].length}</span></h2></div>
        <ul class="crm-mini">${g[k].map(row)}</ul></section>`)
      : html`<div class="card empty">${icon('task', 40)}<h2>Nothing assigned to you</h2><p>Tasks assigned to you in any project show here, soonest first.</p>${can('pm.view') || ctx.user.inProjects ? html`<p><a class="btn" href="#/projects">Open the projects</a></p>` : ''}</div>`}`);
  el.querySelectorAll('[data-status]').forEach((s) => s.addEventListener('change', guard(async () => {
    const t = Object.values(g).flat().find((x) => x.id === s.dataset.status);
    const r = await api.put(`/api/pm/tasks/${t.id}/move`, { statusId: s.value });
    toast(`${t.key}: ${r.statusName}.`);
    changed();
    await myWorkView(el);
    el.querySelector(`[data-status="${t.id}"]`)?.focus();
  }, () => myWorkView(el))));
}

// ---------- Workload ----------
export async function workloadView(el, _params, query) {
  const state = { from: query.from || today(), weeks: Number(query.weeks) || 6 };
  const data = await api.get(`/api/pm/workload?from=${encodeURIComponent(state.from)}&weeks=${state.weeks}`);
  mount(el, html`
    ${head('Workload', 'Planned hours of open tasks against each person\'s capacity: working days, less holidays and approved leave. An estimate is spread over the task\'s working days from start to due.')}
    <div class="toolbar">
      <label class="field inline"><span>From the week of</span><input type="date" id="from" value="${state.from}" /></label>
      <select id="weeks" aria-label="Number of weeks">${options([[4, '4 weeks'], [6, '6 weeks'], [8, '8 weeks'], [12, '12 weeks']], state.weeks)}</select>
      <span class="spacer"></span><span class="muted small">${icon('alert', 14)} Red: more planned than capacity</span>
    </div>
    <section class="card scroll-x">${data.rows.length ? html`<table class="table matrix pm-load-table">
      <thead><tr><th>Person</th>${data.weeks.map((w) => html`<th class="center">${short(w)}<small>W${isoWeek(w)}</small></th>`)}<th class="center">No due date</th></tr></thead>
      <tbody>${data.rows.map((r) => html`<tr><th scope="row">${r.name}${r.leaveDays ? html`<small>${r.leaveDays} day${r.leaveDays === 1 ? '' : 's'} of leave</small>` : ''}</th>
        ${r.cells.map((c, i) => html`<td><button type="button" class="pm-load ${c.over ? 'over' : ''} ${c.planned ? '' : 'empty'}" data-r="${r.id}" data-c="${i}" aria-label="${r.name}, week of ${short(c.week)}: ${c.planned} of ${c.capacity} hours${c.over ? ', over capacity' : ''}">
          <span><b>${Math.round(c.planned)}</b> / ${Math.round(c.capacity)} h</span><span class="progress"><i style="width:${c.capacity ? Math.min(100, Math.round((c.planned / c.capacity) * 100)) : c.planned ? 100 : 0}%"></i></span></button></td>`)}
        <td class="center">${r.unscheduled ? html`<button type="button" class="link" data-un="${r.id}">${hrs(r.unscheduled)}</button>` : html`<span class="muted">—</span>`}</td></tr>`)}</tbody></table>`
      : html`<div class="empty"><p>No one has open tasks in open projects.</p></div>`}</section>`);
  const go = () => (location.hash = `#/projects/workload?from=${state.from}&weeks=${state.weeks}`);
  el.querySelector('#from').addEventListener('change', (e) => e.target.value && ((state.from = e.target.value), go()));
  el.querySelector('#weeks').addEventListener('change', (e) => ((state.weeks = Number(e.target.value)), go()));
  const list = (title, sub, tasks, hoursOf) => modal({
    title, subtitle: sub, submitLabel: null,
    body: tasks.length ? html`<ul class="crm-mini">${tasks.map((t) => html`<li><span class="grow"><a href="#/projects/${t.projectId}/tasks/${t.id}"><strong>${t.title}</strong></a><small><span class="mono">${t.key}</span> · ${t.projectName}${t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ''}</small></span><strong>${hrs(hoursOf(t))}</strong></li>`)}</ul>` : html`<p class="muted">No planned work this week.</p>`,
  });
  el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
    const r = data.rows.find((x) => x.id === b.dataset.r);
    const c = r.cells[Number(b.dataset.c)];
    list(`${r.name}: week of ${fmtDate(c.week)}`, `${hrs(c.planned)} planned of ${hrs(c.capacity)} capacity`, c.tasks, (t) => t.hours);
  }));
  el.querySelectorAll('[data-un]').forEach((b) => b.addEventListener('click', () => {
    const r = data.rows.find((x) => x.id === b.dataset.un);
    list(`${r.name}: no due date`, 'Estimated tasks without a due date are not planned into a week.', r.unscheduledTasks, (t) => t.estimateHours);
  }));
}

// ---------- Projects setup ----------
export async function pmSettingsView(el, _params, query) {
  const TABS_SET = { statuses: 'Default statuses', types: 'Project types', ...(can('users.manage') ? { access: 'Team access' } : {}) };
  const tab = TABS_SET[query.tab] ? query.tab : 'statuses';
  const s = await api.get('/api/pm/settings');
  mount(el, html`
    ${head('Projects setup', 'How new projects start: the statuses of their board and the project types.')}
    <nav class="tabs">${Object.entries(TABS_SET).map(([k, v]) => html`<a href="#/projects/settings?tab=${k}" class="${k === tab ? 'active' : ''}">${v}</a>`)}</nav>
    <section class="card" id="pane"></section>`);
  const pane = el.querySelector('#pane');
  const reload = () => pmSettingsView(el, _params, query);
  if (tab === 'statuses') {
    mount(pane, html`<h2>Statuses for new projects</h2><p class="muted small">Each new project copies these as the columns of its board; a project manager can change a project's own under Board → Edit columns. Progress, overdue and health go by each status's category, so reports work whatever the names.</p>
      <table class="table compact no-stack pm-status-table"><thead><tr><th>Status</th><th>Category</th><th class="num">WIP limit</th></tr></thead><tbody>${s.statuses.map((x) => html`<tr><td>${statusChip(x)}</td><td>${CATEGORIES[x.category]}</td><td class="num">${x.wipLimit || '—'}</td></tr>`)}</tbody></table>
      <div class="actions pm-after-table"><button class="btn primary" id="edit">Edit statuses</button></div>`);
    pane.querySelector('#edit').addEventListener('click', () => editStatuses({ statuses: s.statuses, title: 'Statuses for new projects', save: (statuses) => api.put('/api/pm/settings', { statuses, types: s.types }), after: reload }));
  } else if (tab === 'types') {
    mount(pane, html`<form id="f"><h2>Project types</h2><p class="muted small">Shown on the portfolio and used to filter it. Projects keep a type that is removed here.</p>
      <label class="field"><span>Types, one per line</span><textarea name="types" rows="8">${s.types.join('\n')}</textarea></label>
      <div class="actions end"><button class="btn primary" type="submit">Save types</button></div></form>`);
    pane.querySelector('#f').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      await api.put('/api/pm/settings', { statuses: s.statuses, types: e.target.types.value.split('\n').map((x) => x.trim()).filter(Boolean) });
      toast('Project types saved.');
      reload();
    }, reload));
  } else {
    const draw = async () => {
      const people = await api.get('/api/pm/access');
      mount(pane, html`<h2>Who can use Projects</h2><p class="muted small">Project Managers see and edit every project by their account type, and Sales Managers see every project. Give or remove access for anyone else here: access lets them see every project and start and edit projects. Members of a project open it whatever their access. Administrators always have it.</p>
        <table class="table stackable"><thead><tr><th>Account</th><th>Account type</th><th>Access</th><th>Projects</th><th></th></tr></thead><tbody>${people.map((x) => html`<tr>
          <td><strong>${x.name}</strong><small>${x.username}</small></td><td>${roleLabel(x.role)}</td>
          <td>${x.canEdit ? badge('View and edit', 'green') : x.hasAccess ? badge('View', 'blue') : badge('Own projects only', 'gray')}${x.override !== null ? html`<small>${x.override ? 'given here' : 'removed here'}</small>` : x.byRole ? html`<small>by account type</small>` : ''}</td>
          <td>${x.projects ? `Member of ${x.projects}` : html`<span class="muted">—</span>`}</td>
          <td class="row-actions">${x.role === 'admin' ? html`<span class="muted small">Always</span>` : html`
            ${!x.canEdit ? html`<button class="btn small-btn" data-set="${x.id}" data-v="true">Give access</button>` : html`<button class="btn small-btn" data-set="${x.id}" data-v="false">Remove</button>`}
            ${x.override !== null ? html`<button class="link" data-set="${x.id}" data-v="null">Follow account type</button>` : ''}`}</td></tr>`)}</tbody></table>`);
      pane.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', guard(async () => {
        await api.put(`/api/pm/access/${b.dataset.set}`, { access: JSON.parse(b.dataset.v) });
        toast('Access updated.');
        draw();
      }, draw)));
    };
    await draw();
  }
}
