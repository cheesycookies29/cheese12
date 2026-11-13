// Project Management screens: the portfolio (its templates, and milestones with the billing
// forecast), a project's Overview, Board, List (bulk edit, import), Timeline and Time tabs (Time
// only on a project that tracks time), the task page (size, watchers, files), My work (with "For
// you" and the daily digest), the weekly Timesheet and the Projects setup.
// Effort is a task's size (XS to XL), never hours; hours only exist where a project tracks time.
// Built for dated,
// contract-bound delivery: milestones (some are deliverables the client accepts), a board of
// tasks, and what is late. Everything a project shows is worked out by the server from its tasks
// (shared/projects.js); nothing here stores a percentage or a health colour.
import { api } from '../api.js';
import { ctx, can, roleLabel } from '../state.js';
import { html, mount, badge, toast, modal, confirmDialog, fmtDate, today, downloadFile, toCsv, money } from '../ui.js';
import { icon } from '../icons.js';
import { defaultDay, dayTotals } from '../phone.js';
import { ACCEPT, prepareUpload, sizeLabel } from '../attachments.js';
import {
  PROJECT_STATUS, OPEN_PROJECT, CATEGORIES, PRIORITY, MEMBER_ROLES, HEALTH, STATUS_COLORS, MY_WORK_GROUPS,
  addDays, weekStart, isoWeek, daysBetween, workCalendar, isWorkDay, mentionParts, taskCsvRows, byRank,
  QUICK_FILTERS, parseFilters, taskMatches, VIEW_TABS, groupNotifications,
  billingForecast, forecastCsvRows, IMPORT_FIELDS, IMPORT_TEMPLATE, IMPORT_MAX_ROWS, DIGEST_MAX,
  SIZES, SIZE_KEYS, sizeName, sizeEffort, LIST_SORTS,
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

// ---------- List size ----------
// The project lists (Projects, Milestones, a project's List, My work) come comfortable (the default:
// the key and details on their own line under each title) or compact (one line a row, tighter
// spacing, for scanning long lists). The choice is kept in this browser, like the theme.
const DENSITY_KEY = 'core-pm-density';
export const DENSITIES = { comfortable: 'Comfortable', compact: 'Compact' };
export function listDensity() {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}
const applyDensity = (d = listDensity()) => document.body.classList.toggle('pm-compact', d === 'compact');
// fold: on phones the switch folds into the list's Filters button with the other list controls.
const densitySwitch = (fold = true) => {
  const d = listDensity();
  return html`<div class="seg-btns pm-density" role="group" aria-label="List size" ${fold ? 'data-fold' : ''}>${Object.entries(DENSITIES).map(([k, label]) => html`<button type="button" data-density="${k}" class="${d === k ? 'active' : ''}" aria-pressed="${d === k ? 'true' : 'false'}" title="${k === 'compact' ? 'One line a row, more rows on screen' : 'More room, details under each title'}">${label}</button>`)}</div>`;
};
function wireDensity(el) {
  applyDensity();
  el.querySelectorAll('[data-density]').forEach((b) => b.addEventListener('click', () => {
    const d = b.dataset.density;
    try {
      localStorage.setItem(DENSITY_KEY, d);
    } catch {}
    applyDensity(d);
    el.querySelectorAll('[data-density]').forEach((x) => {
      x.classList.toggle('active', x.dataset.density === d);
      x.setAttribute('aria-pressed', String(x.dataset.density === d));
    });
  }));
}

// ---------- Badges and chips ----------
const PROJECT_BADGE = { planning: 'blue', active: 'green', on_hold: 'amber', completed: 'gray', cancelled: 'gray' };
const projectBadge = (s) => badge(PROJECT_STATUS[s] || s, PROJECT_BADGE[s]);
// Health is a word and a shape as well as a colour (not colour alone).
export const healthChip = (v, title = '') => (v ? html`<span class="pm-health ${v}" title="${title}"><i aria-hidden="true"></i>${HEALTH[v]}</span>` : html`<span class="muted small">—</span>`);
const statusChip = (s) => html`<span class="pm-st pm-c-${s?.color || 'gray'}"><i aria-hidden="true"></i>${s?.name || '—'}</span>`;
const progressBar = (pr) => (pr?.percent == null ? html`<span class="muted small">No tasks yet</span>`
  : html`<span class="pm-progress" title="${pr.basis === 'size' ? 'Weighted by the tasks\' sizes' : 'By number of tasks'}"><span class="progress"><i style="width:${pr.percent}%"></i></span><b>${pr.percent}%</b></span>`);
// A task's size: the letters, with the name and what it means for screen readers and on hover.
// notes: the company's wording of the sizes (meta().sizes).
const sizeChip = (s, notes) => (SIZES[s] ? html`<span class="pm-size pm-size-${s}" title="Size ${sizeName(s)}: ${sizeEffort(s, notes)}"><span aria-hidden="true">${s}</span><span class="sr-only">Size ${sizeName(s)}</span></span>` : '');
// short: "M · Medium" without what it means (in a table cell).
const sizeOptions = (selected, notes, none = 'No size', short = false) => html`<option value="">${none}</option>${SIZE_KEYS.map((k) => option(k, short ? sizeName(k) : `${sizeName(k)} (${sizeEffort(k, notes)})`, selected))}`;
const sizeHint = 'A rough idea of the effort, not a promise. It weighs the task in progress and the burn-up.';
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

// The number next to My work: tasks overdue or due today, and unread "For you" notifications.
export async function myWorkBadge() {
  const [g, n] = await Promise.all([
    can('pm.view') || ctx.user.inProjects ? api.get('/api/pm/my-work') : null,
    api.get('/api/pm/notifications/summary').catch(() => ({ unread: 0 })),
  ]);
  return (g ? g.overdue.length + g.today.length : 0) + n.unread;
}

// ---------- Menus ----------
// A small menu under a button (Views; the board's Move to has its own): arrow keys move, Escape
// closes and gives focus back. items: { label, sub, onPick, current, disabled } | { heading } | { sep }.
function popMenu(btn, items, label) {
  document.querySelector('.pm-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'menu-pop pm-pop';
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', label);
  mount(pop, html`${items.map((it, i) => (it.sep ? html`<div class="menu-sep" role="separator"></div>`
    : it.heading ? html`<div class="menu-label">${it.heading}</div>`
      : html`<button type="button" role="menuitem" data-i="${i}" ${it.disabled ? 'disabled' : ''} ${it.current ? 'aria-current="true" class="on"' : ''}><span class="grow">${it.label}${it.sub ? html`<small class="muted">${it.sub}</small>` : ''}</span></button>`))}`);
  document.body.appendChild(pop);
  const place = () => {
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    pop.style.top = `${r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  };
  place();
  btn.setAttribute('aria-expanded', 'true');
  const buttons = [...pop.querySelectorAll('button:not([disabled])')];
  buttons[0]?.focus();
  const close = (refocus = true) => {
    pop.remove();
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outside, true);
    removeEventListener('scroll', place, true);
    removeEventListener('resize', place);
    removeEventListener('hashchange', gone);
    if (refocus && btn.isConnected) btn.focus();
  };
  const outside = (e) => !pop.contains(e.target) && e.target !== btn && close(false);
  const gone = () => close(false);
  setTimeout(() => document.addEventListener('click', outside, true));
  addEventListener('scroll', place, true);
  addEventListener('resize', place);
  addEventListener('hashchange', gone);
  pop.addEventListener('keydown', (e) => {
    const k = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close());
    else if (e.key === 'ArrowDown') (e.preventDefault(), buttons[(k + 1) % buttons.length]?.focus());
    else if (e.key === 'ArrowUp') (e.preventDefault(), buttons[(k - 1 + buttons.length) % buttons.length]?.focus());
    else if (e.key === 'Home') (e.preventDefault(), buttons[0]?.focus());
    else if (e.key === 'End') (e.preventDefault(), buttons.at(-1)?.focus());
    else if (e.key === 'Tab') close(false);
  });
  pop.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
    close(false);
    items[Number(b.dataset.i)].onPick?.();
  }));
  return close;
}

// ---------- Files (tasks and milestones) ----------
// A file opens as a download (the server sends it as an attachment to save), never in the page.
// base: the files' address, e.g. /api/pm/tasks/<id>/attachments.
const MAX_FILES = 5;
function fileBlock(list, base, canAdd) {
  return html`${list.length ? html`<ul class="pm-files">${list.map((a) => html`<li>
      <span class="pm-file-ic" aria-hidden="true">${icon(a.type === 'application/pdf' ? 'file' : 'image', 16)}</span>
      <span class="grow"><a href="${base}/${a.id}" download="${a.name}">${a.name}</a><small>${sizeLabel(a.size)} · ${a.byName} · ${when(a.uploadedAt)}</small></span>
      ${a.canDelete ? html`<button type="button" class="icon-btn danger" data-del-file="${a.id}" aria-label="Remove ${a.name}">${icon('trash', 16)}</button>` : ''}</li>`)}</ul>`
    : html`<p class="muted small">No files yet.</p>`}
    ${canAdd ? (list.length < MAX_FILES ? html`<div class="pm-file-add"><label class="btn">${icon('upload', 16)} Add files<input type="file" class="sr-only" accept="${ACCEPT}" multiple data-add-file /></label>
        <small class="muted">PDF or photos (JPEG, PNG, WebP), up to 5 MB each; at most ${MAX_FILES}.</small></div>`
      : html`<p class="muted small">${MAX_FILES} files, the most there can be. Remove one to add another.</p>`) : ''}`;
}
// Uploads what was picked (up to the room left) and removes on request; done(list) gets the new list.
function wireFiles(root, base, list, done) {
  root.querySelector('[data-add-file]')?.addEventListener('change', guard(async (e) => {
    const input = e.target;
    const picked = [...input.files].slice(0, MAX_FILES - list.length);
    if (input.files.length > picked.length) toast(`Only ${picked.length} more file${picked.length === 1 ? '' : 's'} can be added here.`, 'error');
    input.disabled = true;
    let out = null;
    try {
      for (const f of picked) out = await api.post(base, { file: await prepareUpload(f) });
    } finally {
      input.disabled = false;
      if (out) {
        toast(`${plural(picked.length, 'file')} added.`);
        await done(out.attachments);
      }
    }
  }, () => done(null)));
  root.querySelectorAll('[data-del-file]').forEach((b) => b.addEventListener('click', guard(async () => {
    const a = list.find((x) => x.id === b.dataset.delFile);
    if (!(await confirmDialog(`Remove the file "${a.name}"?`, { title: 'Remove file', confirmLabel: 'Remove' }))) return;
    const out = await api.del(`${base}/${a.id}`);
    toast('File removed.');
    await done(out.attachments);
  }, () => done(null))));
}

// ---------- Forms ----------
// New project (from scratch or from a template: `templateId` picks one) or Edit project.
async function editProject(rec = {}, after, { templateId = '' } = {}) {
  const [m, templates] = await Promise.all([meta(true), !rec.id && can('pm.edit') ? api.get('/api/pm/templates') : []]);
  const crm = m.crm;
  const people = m.people.length ? m.people : [{ id: ctx.user.id, name: ctx.user.name }];
  const blank = (cls = '') => `pm-blank-only ${cls}`;
  const { form } = modal({
    title: rec.id ? (rec.isTemplate ? 'Edit template' : 'Edit project') : 'New project', wide: true, subtitle: rec.id ? rec.code : 'The statuses of the board come from the Projects setup, or from the template; change them later under Board → Edit columns.',
    body: html`<div class="grid two">
      ${templates.length ? html`<label class="field span-2"><span>Start from</span><select name="from"><option value="">A blank project</option>${options(templates.map((t) => [t.id, `Template: ${t.name}`]), templateId)}</select>
        <small class="hint" id="from-hint">A template brings its board statuses, milestones (with deliverables and billing %), tasks, subtasks, checklists and sizes, and whether it tracks time, with the dates moved to your start date in working days. No assignees, time or comments.</small></label>` : ''}
      <label class="field span-2"><span>Project name<em>*</em></span><input name="name" value="${rec.name || ''}" required /></label>
      <label class="field ${blank()}"><span>Type</span><select name="type">${options([...new Set([...m.types, ...(rec.type ? [rec.type] : [])])].map((t) => [t, t]), rec.type || m.types[0])}</select></label>
      <label class="field ${blank()}"><span>Status</span><select name="status">${options(Object.entries(PROJECT_STATUS), rec.status || 'planning')}</select></label>
      <label class="field"><span>Start<em>*</em></span><input type="date" name="startDate" value="${rec.startDate || today()}" required /></label>
      <label class="field ${blank()}"><span>End</span><input type="date" name="endDate" value="${rec.endDate || ''}" /></label>
      <label class="field"><span>Project manager</span><select name="managerId">${options(people.map((x) => [x.id, x.name]), rec.managerId || ctx.user.id)}</select></label>
      <div class="field span-2 pm-track ${blank()}"><label class="check"><input type="checkbox" name="timeTracking" ${rec.timeTracking ? 'checked' : ''} aria-describedby="track-hint" /><span>Track time on this project</span></label>
        <small class="hint" id="track-hint">For time-and-materials work, or when the client asks for a timesheet. Members then log hours on its tasks and on their Timesheet. Off: no hours anywhere in the project${rec.id ? '; turning it off hides the hours logged, it does not delete them' : ''}.</small></div>
      <label class="field ${blank()} pm-budget"><span>Budget (hours)</span><input type="number" name="budgetHours" min="0" step="1" inputmode="decimal" value="${rec.budgetHours ?? ''}" /><small class="hint">Optional: the hours logged are shown against it.</small></label>
      ${crm ? html`
        <label class="field"><span>Client</span><select name="accountId"><option value="">None (internal)</option>${options(crm.accounts.map((a) => [a.id, a.name]), rec.accountId)}</select></label>
        <label class="field"><span>Deal</span><select name="dealId"></select></label>
        <label class="field span-2"><span>Contract</span><select name="contractId"></select><small class="hint">Deliverables due after the contract's end date are flagged.</small></label>` : ''}
      <label class="field span-2 ${blank()}"><span>Description</span><textarea name="description" rows="3">${rec.description || ''}</textarea></label>
      ${rec.id && may(rec.access, 'manage') ? html`<label class="field check span-2"><input type="checkbox" name="isTemplate" ${rec.isTemplate ? 'checked' : ''} /><span>Use as a template: hidden from the portfolio and My work; <strong>+ New project</strong> can start from it</span></label>` : ''}
    </div>`,
    onSubmit: async (f) => {
      const v = Object.fromEntries(new FormData(f));
      if (!crm) for (const k of ['accountId', 'dealId', 'contractId']) delete v[k];
      let saved;
      if (v.from) {
        const pick = (keys) => Object.fromEntries(keys.filter((k) => k in v).map((k) => [k, v[k]]));
        saved = await api.post(`/api/pm/projects/${v.from}/copy`, pick(['name', 'startDate', 'managerId', 'accountId', 'dealId', 'contractId']));
      } else {
        delete v.from;
        v.timeTracking = f.timeTracking.checked;
        if (!v.timeTracking) delete v.budgetHours;
        if (rec.id && may(rec.access, 'manage')) v.isTemplate = f.isTemplate.checked;
        saved = rec.id ? await api.put(`/api/pm/projects/${rec.id}`, { ...v, version: rec.version }) : await api.post('/api/pm/projects', v);
      }
      toast(rec.id ? 'Saved.' : `Project ${saved.code} created${v.from ? ' from the template' : ''}.`);
      changed();
      after?.(saved);
    },
  });
  // From a template: only the fields a template does not bring. The budget only with time tracking.
  const from = form.elements.from;
  const sync = () => {
    form.querySelectorAll('.pm-blank-only').forEach((x) => (x.hidden = Boolean(from?.value)));
    form.querySelector('.pm-budget').hidden = Boolean(from?.value) || !form.elements.timeTracking.checked;
  };
  from?.addEventListener('change', sync);
  form.elements.timeTracking.addEventListener('change', sync);
  sync();
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
  const [assignees, m] = await Promise.all([assigneeOptions(p, p.access, preset.assigneeId), meta()]);
  modal({
    title: preset.parentId ? 'New subtask' : 'New task', wide: true, submitLabel: 'Add task',
    body: html`<div class="grid two">
      <label class="field span-2"><span>Title<em>*</em></span><input name="title" required /></label>
      <label class="field"><span>Status</span><select name="statusId">${options(p.statuses.filter((s) => s.category !== 'cancelled').map((s) => [s.id, s.name]), preset.statusId)}</select></label>
      <label class="field"><span>Priority</span><select name="priority">${options(Object.entries(PRIORITY), 'normal')}</select></label>
      <label class="field"><span>Assignee</span><select name="assigneeId">${assignees}</select></label>
      <label class="field"><span>Size</span><select name="size" aria-describedby="new-size-hint">${sizeOptions('', m.sizes)}</select><small class="hint" id="new-size-hint">${sizeHint}</small></label>
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
// Projects, and Milestones (with the billing forecast) across them.
const portfolioTabs = (on) => html`<nav class="tabs pm-tabs" aria-label="Portfolio views">${[['projects', '/projects', 'Projects', 'folder'], ['milestones', '/projects/milestones', 'Milestones', 'flag']].map(([k, href, label, ic]) => html`<a href="#${href}" class="${k === on ? 'active' : ''}" ${k === on ? 'aria-current="page"' : ''}>${icon(ic, 16)} ${label}</a>`)}</nav>`;
export async function portfolioView(el, _params, query) {
  const [ov, m] = await Promise.all([api.get('/api/pm/overview'), meta()]);
  const state = { status: query.status || 'open', type: query.type || '', manager: query.manager || '', mine: query.mine === '1', q: query.q || '' };
  const managers = [...new Map(ov.projects.filter((p) => p.managerId).map((p) => [p.managerId, p.managerName])).entries()];
  const stat = (label, value, sub, cls = '', href = '') => html`<${href ? 'a' : 'div'} class="card ${cls}" ${href ? html`href="${href}"` : ''}><small>${label}</small><strong>${value}</strong>${sub ? html`<span class="muted small">${sub}</span>` : ''}</${href ? 'a' : 'div'}>`;
  mount(el, html`
    ${head('Projects', can('pm.view') ? 'Every project: progress, health and the next milestone.' : 'The projects you are a member of.', can('pm.edit') ? html`<button class="btn primary" id="new">+ New project</button>` : '')}
    ${portfolioTabs('projects')}
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
        <select id="f-status" aria-label="Status">${options([['open', 'Open projects'], ...Object.entries(PROJECT_STATUS), ['all', 'All'], ...(ov.templates.length ? [['templates', `Templates (${ov.templates.length})`]] : [])], state.status)}</select>
        <select id="f-type" aria-label="Type"><option value="">All types</option>${options(m.types.map((t) => [t, t]), state.type)}</select>
        <select id="f-manager" aria-label="Project manager"><option value="">All managers</option>${options(managers, state.manager)}</select>
        <label class="field check inline"><input type="checkbox" id="f-mine" ${state.mine ? 'checked' : ''} /><span>Mine</span></label>
        ${densitySwitch()}
      </div>
      <div id="list"></div>
    </section>`);
  wireDensity(el);
  // Templates: their own list, with "Use" to start a project from one.
  const drawTemplates = (q) => {
    const rows = ov.templates.filter((t) => (!state.type || t.type === state.type) && (!q || [t.name, t.code, t.description].some((f) => String(f || '').toLowerCase().includes(q))));
    mount(el.querySelector('#list'), html`<p class="muted small pad pm-tpl-note">Templates are left out of the other lists and My work. <strong>+ New project</strong> can start from one; open a template to change its milestones and tasks.</p>
      ${rows.length ? html`<table class="table clickable pm-portfolio pm-templates">
      <thead><tr><th>Template</th><th>Type</th><th class="num">Milestones</th><th class="num">Deliverables</th><th class="num">Tasks</th><th></th></tr></thead>
      <tbody>${rows.map((t) => html`<tr data-href="#/projects/${t.id}">
        <td><a href="#/projects/${t.id}"><strong>${t.name}</strong></a><small><span class="mono">${t.code}</span>${t.starter ? ' · starter template' : ''}</small></td>
        <td>${t.type}</td>
        <td class="num">${t.milestones}</td>
        <td class="num">${t.deliverables || '—'}</td>
        <td class="num">${t.tasks}</td>
        <td class="row-actions">${can('pm.edit') ? html`<button type="button" class="btn small-btn" data-use="${t.id}">Use template</button>` : ''}</td>
      </tr>`)}</tbody></table>` : html`<div class="empty"><p>No template matches.</p></div>`}`);
    el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a, button') && (location.hash = tr.dataset.href)));
    el.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => editProject({}, (p) => (location.hash = `#/projects/${p.id}`), { templateId: b.dataset.use })));
  };
  const draw = () => {
    const q = state.q.toLowerCase();
    if (state.status === 'templates' && !ov.templates.length) state.status = 'open';
    const qs = new URLSearchParams(Object.entries({ status: state.status === 'open' ? '' : state.status, type: state.type, manager: state.manager, mine: state.mine ? '1' : '', q: state.q }).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/projects${qs ? `?${qs}` : ''}`);
    if (state.status === 'templates') return drawTemplates(q);
    const rows = ov.projects.filter((p) => (state.status === 'all' || (state.status === 'open' ? OPEN_PROJECT.includes(p.status) : p.status === state.status))
      && (!state.type || p.type === state.type) && (!state.manager || p.managerId === state.manager)
      && (!state.mine || p.managerId === ctx.user.id || p.members.some((x) => x.userId === ctx.user.id))
      && (!q || [p.name, p.code, p.accountName].some((f) => String(f || '').toLowerCase().includes(q))));
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

// Milestones of every project you can open: due, health, deliverable, submitted and accepted.
// With Sales & CRM access, each deliverable's amount (its billing % of the contract, or of the
// deal without a contract) and the billing forecast by month; the server leaves the amounts out
// for everyone else.
const monthLabel = (ym) => fmtDate(`${ym}-01`, { month: 'long', year: 'numeric' });
export async function portfolioMilestonesView(el, _params, query) {
  const data = await api.get('/api/pm/milestones');
  const state = { show: query.show === 'all' ? 'all' : 'open', month: String(query.month || ''), client: String(query.client || ''), health: String(query.health || ''), deliverables: query.deliverables === '1' };
  const clientOf = (r) => r.accountName || 'Internal';
  const months = [...new Set(data.rows.map((r) => r.dueDate.slice(0, 7)))].sort();
  const clients = [...new Set(data.rows.map(clientOf))].sort((a, b) => a.localeCompare(b));
  if (!months.includes(state.month)) state.month = '';
  if (!clients.includes(state.client)) state.client = '';
  mount(el, html`
    ${head('Projects', 'Milestones and deliverables across the projects you can open, soonest first.')}
    ${portfolioTabs('milestones')}
    <section class="card scroll-x">
      <div class="toolbar pad pm-filterbar">
        <select id="f-show" aria-label="Which milestones">${options([['open', 'Upcoming and overdue'], ['all', 'All, accepted and done too']], state.show)}</select>
        <select id="f-month" aria-label="Month due"><option value="">Every month</option>${options(months.map((m) => [m, monthLabel(m)]), state.month)}</select>
        <select id="f-client" aria-label="Client"><option value="">Every client</option>${options(clients.map((c) => [c, c]), state.client)}</select>
        <select id="f-health" aria-label="Health"><option value="">Any health</option>${options([...Object.entries(HEALTH), ['done', 'Accepted or done']], state.health)}</select>
        <label class="field check inline"><input type="checkbox" id="f-deliv" ${state.deliverables ? 'checked' : ''} /><span>Deliverables only</span></label>
        ${densitySwitch()}
      </div>
      <div id="ms-list"></div>
    </section>
    ${data.amounts ? html`<section class="card pm-forecast" aria-labelledby="fc-h"><div class="card-head"><h2 id="fc-h">${icon('chart')} Billing forecast</h2><button type="button" class="btn" id="fc-csv">${icon('download', 16)} Export CSV</button></div><div id="fc"></div></section>` : ''}`);
  wireDensity(el);
  const shown = () => data.rows.filter((r) => (state.show === 'all' || !r.finished) && (!state.month || r.dueDate.startsWith(state.month)) && (!state.client || clientOf(r) === state.client)
    && (!state.health || (state.health === 'done' ? r.finished : r.health === state.health)) && (!state.deliverables || r.deliverable));
  // The forecast follows the client and the month; it always counts accepted deliverables as earned.
  const forecast = () => billingForecast(data.rows.filter((r) => r.deliverable && Number(r.billingPercent) > 0 && (!state.client || clientOf(r) === state.client)), data.today);
  const statusOf = (r) => (r.acceptedAt ? badge(`Accepted ${short(r.acceptedAt)}`, 'green') : r.submittedAt ? badge(`Submitted ${short(r.submittedAt)}`, 'blue') : r.finished ? badge('Work done', 'green') : '');
  const draw = () => {
    const qs = new URLSearchParams(Object.entries({ show: state.show === 'all' ? 'all' : '', month: state.month, client: state.client, health: state.health, deliverables: state.deliverables ? '1' : '' }).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/projects/milestones${qs ? `?${qs}` : ''}`);
    const rows = shown();
    mount(el.querySelector('#ms-list'), rows.length ? html`<table class="table clickable pm-milestones">
      <thead><tr><th>Milestone</th><th>Client</th><th>Due</th><th>Health</th><th>Deliverable</th><th>Submitted / accepted</th>${data.amounts ? html`<th class="num">Amount</th>` : ''}</tr></thead>
      <tbody>${rows.map((r) => html`<tr data-href="#/projects/${r.projectId}" class="${r.overdue ? 'pm-late' : ''}">
        <td><span class="pm-diamond ${r.deliverable ? 'deliverable' : ''}" aria-hidden="true"></span><a href="#/projects/${r.projectId}"><strong>${r.name}</strong></a><small><span class="mono">${r.projectCode}</span> · ${r.projectName}${r.files ? html` · ${icon('paperclip', 12)} ${plural(r.files, 'file')}` : ''}</small></td>
        <td>${clientOf(r)}</td>
        <td class="nowrap">${r.overdue ? html`<span class="crm-due bad">${icon('calendar', 12)} Overdue · ${fmtDate(r.dueDate)}</span>` : fmtDate(r.dueDate)}</td>
        <td>${r.finished ? html`<span class="muted small">Done</span>` : healthChip(r.health, r.reason || '')}${r.reason && !r.finished ? html`<small>${r.reason}</small>` : ''}</td>
        <td>${r.deliverable ? `Yes${r.billingPercent != null ? `, ${r.billingPercent}%` : ''}` : '—'}</td>
        <td>${statusOf(r) || '—'}</td>
        ${data.amounts ? html`<td class="num">${r.amount != null ? money(r.amount) : '—'}${r.amount != null ? html`<small class="block">${r.acceptedAt ? 'earned' : r.overdue ? 'overdue' : 'expected'}</small>` : ''}</td>` : ''}
      </tr>`)}</tbody></table>`
      : html`<div class="empty"><p>${data.rows.length ? 'No milestone matches the filters.' : 'No milestones yet in the projects you can open.'}</p></div>`);
    el.querySelectorAll('#ms-list tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a') && (location.hash = tr.dataset.href)));
    const fcBox = el.querySelector('#fc');
    if (!fcBox) return;
    const f = forecast();
    const t = f.total;
    mount(fcBox, html`<p class="muted small">What the deliverables bill, by month: each one's billing % of the linked contract's value (of the deal's when there is no contract). Expected: not yet accepted, by the month it is due; earned: accepted, by the month of acceptance.${state.client ? ` Only ${state.client}.` : ''}</p>
      ${f.months.length ? html`<div class="scroll-x"><table class="table pm-forecast-table"><thead><tr><th>Month</th><th class="num">Expected</th><th class="num">Of which overdue</th><th class="num">Earned (accepted)</th><th class="num">Deliverables</th></tr></thead>
        <tbody>${f.months.map((m) => html`<tr class="${m.month === data.today.slice(0, 7) ? 'pm-this-month' : ''}"><td><strong>${monthLabel(m.month)}</strong></td><td class="num">${m.expected ? money(m.expected) : '—'}</td><td class="num ${m.overdue ? 'bad' : ''}">${m.overdue ? html`${icon('alert', 12)} ${money(m.overdue)}` : '—'}</td><td class="num">${m.earned ? money(m.earned) : '—'}</td><td class="num">${m.count}${m.noValue ? html`<small class="block">${m.noValue} without a value</small>` : ''}</td></tr>`)}</tbody>
        <tfoot><tr><td><strong>Total</strong></td><td class="num"><strong>${money(t.expected)}</strong></td><td class="num">${t.overdue ? money(t.overdue) : '—'}</td><td class="num"><strong>${money(t.earned)}</strong></td><td class="num">${t.count}</td></tr></tfoot></table></div>
        ${t.noValue ? html`<p class="muted small">${plural(t.noValue, 'deliverable')} ${t.noValue === 1 ? 'has' : 'have'} no amount: the project has no contract or deal with a value.</p>` : ''}`
      : html`<p class="muted">No deliverables with a billing % yet.</p>`}`);
  };
  el.querySelector('#f-show').addEventListener('change', (e) => ((state.show = e.target.value), draw()));
  el.querySelector('#f-month').addEventListener('change', (e) => ((state.month = e.target.value), draw()));
  el.querySelector('#f-client').addEventListener('change', (e) => ((state.client = e.target.value), draw()));
  el.querySelector('#f-health').addEventListener('change', (e) => ((state.health = e.target.value), draw()));
  el.querySelector('#f-deliv').addEventListener('change', (e) => ((state.deliverables = e.target.checked), draw()));
  el.querySelector('#fc-csv')?.addEventListener('click', () => downloadFile(`billing-forecast-${today()}.csv`, toCsv(forecastCsvRows(forecast()))));
  draw();
}

// ---------- A project: header and tabs ----------
// Time: only on a project that tracks time.
const TABS = [['', 'Overview', 'dashboard'], ['board', 'Board', 'grid'], ['list', 'List', 'table'], ['timeline', 'Timeline', 'calendar'], ['time', 'Time', 'clock']];
function projectHeader(p, tab, actions = '') {
  return html`
    <header class="page-head pm-head">
      <div><a class="back" href="#/projects${p.isTemplate ? '?status=templates' : ''}">← ${p.isTemplate ? 'Templates' : 'Projects'}</a>
        <h1>${p.name} ${p.isTemplate ? badge('Template', 'blue') : projectBadge(p.status)}</h1>
        <p class="muted"><span class="mono">${p.code}</span> · ${p.type}${p.accountName ? ` · ${p.accountName}` : ''} · ${fmtDate(p.startDate)} – ${p.endDate ? fmtDate(p.endDate) : 'no end date'}${p.managerName ? ` · ${p.managerName}` : ''}</p></div>
      ${actions ? html`<div class="actions">${actions}</div>` : ''}
    </header>
    <nav class="tabs pm-tabs" aria-label="Project views">${TABS.filter(([k]) => k !== 'time' || p.timeTracking).map(([k, label, ic]) => html`<a href="#/projects/${p.id}${k ? `/${k}` : ''}" class="${k === tab ? 'active' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${icon(ic, 16)} ${label}</a>`)}</nav>`;
}
const loadProject = (id) => api.get(`/api/pm/projects/${id}`);

// ---------- Overview ----------
export async function projectOverviewView(el, { id }) {
  const p = await loadProject(id);
  const manage = may(p.access, 'manage');
  const override = p.healthOverride;
  const tpl = p.isTemplate;
  // A template's dates are a pattern: no health, overdue or blocked counts on it.
  const msCard = (m) => html`<li class="pm-ms ${tpl ? '' : m.value || ''}">
      <div class="pm-ms-top"><span class="pm-diamond ${m.deliverable ? 'deliverable' : ''}" aria-hidden="true"></span><strong>${m.name}</strong>
        ${manage ? html`<button type="button" class="icon-btn" data-ms="${m.id}" aria-label="Edit ${m.name}">${icon('edit', 15)}</button>` : ''}</div>
      <span class="muted small">Due ${fmtDate(m.dueDate)}${m.deliverable ? ` · Deliverable${m.billingPercent != null ? `, ${m.billingPercent}% billing` : ''}` : ''}</span>
      ${tpl ? '' : progressBar(m.progress)}
      ${tpl ? '' : html`<div class="pm-ms-foot">${m.acceptedAt ? badge(`Accepted ${short(m.acceptedAt)}`, 'green') : m.submittedAt ? badge(`Submitted ${short(m.submittedAt)}`, 'blue') : m.finished ? badge('Work done', 'green') : healthChip(m.value, m.reasons.join('; '))}</div>
      ${m.reasons?.length && !m.acceptedAt ? html`<small class="pm-ms-why">${m.reasons[0]}</small>` : ''}`}
      ${m.afterContract ? html`<small class="crm-due bad">${icon('alert', 12)} After the contract ends (${fmtDate(p.contract.endDate)})</small>` : ''}
      ${tpl ? '' : html`<button type="button" class="link pm-ms-files" data-ms-files="${m.id}">${icon('paperclip', 14)} ${m.attachments.length ? (m.deliverable ? `Acceptance document and files (${m.attachments.length})` : plural(m.attachments.length, 'file')) : m.deliverable ? 'Acceptance document' : 'Files'}</button>
        ${m.deliverable && m.acceptedAt && !m.attachments.length ? html`<small class="crm-due warn">${icon('alert', 12)} Accepted: attach the signed document</small>` : ''}`}
    </li>`;
  const taskLine = (t) => html`<li><span class="grow"><a href="#/projects/${p.id}/tasks/${t.id}"><strong>${t.title}</strong></a><small><span class="mono">${t.key}</span> · ${t.statusName}${t.assigneeName ? ` · ${t.assigneeName}` : ' · unassigned'}</small></span>${dueChip(t)}</li>`;
  const act = (a) => {
    const what = a.field === 'comment' ? html`commented: “${a.to}”` : a.field === 'created' ? (a.project ? 'created the project' : html`added the task${a.to ? ` (${a.to})` : ''}`) : html`${a.field}: ${a.from || '—'} → ${a.to || '—'}`;
    return html`<li><span class="grow"><strong>${a.byName}</strong> ${what}${a.key ? html` <a href="#/projects/${p.id}/tasks/${a.taskId}" class="mono">${a.key}</a>` : ''}<small>${when(a.at)}</small></span></li>`;
  };
  mount(el, html`
    ${projectHeader(p, '', html`
      ${tpl ? (can('pm.edit') ? html`<button class="btn primary" id="use">${icon('copy', 16)} New project from this template</button>` : '') : html`<button class="btn" id="print">${icon('file', 16)} Print status report</button>`}
      ${manage ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit</button>` : ''}
      ${can('pm.edit') && !tpl ? html`<button class="btn" id="copy">${icon('copy', 16)} Copy</button>` : ''}
      ${can('pm.manage') ? html`<button class="btn danger ghost" id="del">Delete</button>` : ''}`)}
    ${tpl ? html`<p class="notice pm-tpl-notice">${icon('layers', 16)} <span>This is a template: it is not in the portfolio or My work, and has no health. Change its milestones and tasks here; <strong>New project from this template</strong> copies them with the dates moved to the new start in working days.${manage ? ' To make it a project again, untick Use as a template under Edit.' : ''}</span></p>` : html`
    <section class="card pm-healthbar">
      <div><small class="muted">Health (worked out from the tasks)</small><div class="pm-health-line">${healthChip(p.health)} <span class="muted small">${p.healthReasons.length ? p.healthReasons.join(' · ') : p.health ? 'Nothing late or behind.' : 'The project is closed.'}</span></div></div>
      ${override ? html`<div><small class="muted">Project manager's reading</small><div class="pm-health-line">${healthChip(override.value)} <span class="small">“${override.note}”</span> <span class="muted small">${override.byName}, ${when(override.at)}</span></div></div>` : ''}
      ${manage ? html`<button class="btn small-btn" id="health">${override ? 'Change' : 'Set'} health</button>` : ''}
    </section>`}
    ${tpl ? html`<div class="stats">
      <div class="card"><small>Milestones</small><strong>${p.milestones.length}</strong><span class="muted small">${plural(p.milestones.filter((m) => m.deliverable).length, 'deliverable')}</span></div>
      <a class="card" href="#/projects/${p.id}/list?show=all"><small>Tasks</small><strong>${p.counts.tasks}</strong><span class="muted small">subtasks included</span></a>
      ${effortCard(p)}
    </div>` : html`<div class="stats">
      <div class="card"><small>Progress</small><strong>${p.progress.percent == null ? '—' : `${p.progress.percent}%`}</strong><span class="muted small">${p.progress.total ? `${p.progress.done} of ${plural(p.progress.total, 'task')} done${p.progress.basis === 'size' ? ', weighed by size' : ''}` : 'no tasks yet'}</span>${p.progress.percent != null ? html`<span class="progress"><i style="width:${p.progress.percent}%"></i></span>` : ''}</div>
      <a class="card ${p.counts.overdue ? 'attention' : ''}" href="#/projects/${p.id}/list?f=overdue"><small>Overdue tasks</small><strong>${p.counts.overdue}</strong><span class="muted small">${p.counts.dueSoon} due within 3 working days</span></a>
      <a class="card" href="#/projects/${p.id}/board?f=blocked"><small>Blocked</small><strong>${p.counts.blocked}</strong><span class="muted small">waiting for another task</span></a>
      ${effortCard(p)}
      ${p.time ? html`<a class="card" href="#/projects/${p.id}/time"><small>Time</small><strong>${hrs(p.time.logged)}</strong><span class="muted small">logged${p.time.budget ? ` of a ${hrs(p.time.budget)} budget` : ''}</span>${p.time.budget ? html`<span class="progress ${p.time.logged > p.time.budget ? 'over' : ''}"><i style="width:${Math.min(100, Math.round((p.time.logged / p.time.budget) * 100))}%"></i></span>` : ''}</a>` : ''}
    </div>`}
    <section class="card">
      <div class="card-head"><h2>${icon('flag')} Milestones</h2>${manage ? html`<button class="btn small-btn" id="add-ms">+ Milestone</button>` : ''}</div>
      ${p.milestones.length ? html`<ol class="pm-ms-strip">${p.milestones.map(msCard)}</ol>` : html`<p class="muted">No milestones yet. Add the deliverables from the contract or terms of reference, with their billing %.</p>`}
    </section>
    ${p.milestones.length && !tpl ? html`<section class="card pm-burnup">
      <div class="card-head"><h2>${icon('chart')} Milestone burn-up</h2>
        <select id="bu-ms" aria-label="Milestone for the burn-up">${options(p.milestones.map((m) => [m.id, m.name]), (p.nextMilestone || p.milestones.find((m) => !m.finished) || p.milestones.at(-1)).id)}</select></div>
      <div id="bu-body" aria-live="polite"><p class="muted small">Loading…</p></div>
    </section>` : ''}
    <div class="cols wide-left">
      <div class="stack">
        ${tpl ? '' : html`<section class="card"><div class="card-head"><h2>${icon('alert')} Overdue</h2><a href="#/projects/${p.id}/list?f=overdue">In the list</a></div>
          ${p.overdue.length ? html`<ul class="crm-mini">${p.overdue.slice(0, 8).map(taskLine)}</ul>` : html`<p class="muted">Nothing overdue.</p>`}</section>`}
        ${p.blockedList.length && !tpl ? html`<section class="card"><h2>${icon('lock')} Blocked</h2><ul class="crm-mini">${p.blockedList.map(taskLine)}</ul></section>` : ''}
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
  el.querySelector('#print')?.addEventListener('click', () => printReport(p));
  el.querySelector('#use')?.addEventListener('click', () => editProject({}, (n) => (location.hash = `#/projects/${n.id}`), { templateId: p.id }));
  el.querySelector('#edit')?.addEventListener('click', () => editProject(p, (saved) => {
    if (saved.isTemplate !== Boolean(p.isTemplate)) toast(saved.isTemplate ? 'It is a template now: Overview → Templates.' : 'It is a project again, back in the portfolio.');
    reload();
  }));
  const buSel = el.querySelector('#bu-ms');
  if (buSel) {
    const show = guard(async () => {
      const box = el.querySelector('#bu-body');
      const data = await api.get(`/api/pm/projects/${id}/milestones/${buSel.value}/burnup`);
      if (box.isConnected) mount(box, burnupChart(data));
    });
    buSel.addEventListener('change', show);
    show();
  }
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
  el.querySelectorAll('[data-ms-files]').forEach((b) => b.addEventListener('click', () => milestoneFiles(p, p.milestones.find((m) => m.id === b.dataset.msFiles), reload)));
  el.querySelector('#members')?.addEventListener('click', () => editMembers(p, reload));
}

// How many of the tasks have a size (progress weighs by size from 60%), and their effort points.
function effortCard(p) {
  const e = p.effort;
  const share = e.tasks ? Math.round((e.sized / e.tasks) * 100) : 0;
  return html`<a class="card" href="#/projects/${p.id}/list?show=all&sort=size&dir=desc"><small>Sized tasks</small><strong>${e.sized} of ${e.tasks}</strong>
    <span class="muted small">${!e.tasks ? 'no tasks yet' : share >= 60 ? `${e.points} effort points; progress weighs by size` : 'under 60%: progress counts tasks, not sizes'}</span></a>`;
}

// A milestone's files; for a deliverable, the place for the client's signed acceptance document.
function milestoneFiles(p, m, after) {
  const base = `/api/pm/projects/${p.id}/milestones/${m.id}/attachments`;
  let list = m.attachments;
  let touched = false;
  const { form } = modal({
    title: m.deliverable ? 'Acceptance document and files' : 'Milestone files', subtitle: `${m.name}. ${m.deliverable ? 'Attach the certificate of acceptance the client signed (a PDF, or a photo of it), and anything else that goes with this deliverable.' : 'Files that go with this milestone.'}`,
    submitLabel: null, body: html`<div id="mf"></div>`, onClose: () => touched && after?.(),
  });
  const box = form.querySelector('#mf');
  const draw = () => {
    mount(box, fileBlock(list, base, may(p.access, 'work')));
    wireFiles(box, base, list, async (next) => {
      touched = true;
      if (next) list = next;
      else list = (await api.get(`/api/pm/projects/${p.id}`)).milestones.find((x) => x.id === m.id)?.attachments || [];
      draw();
      box.querySelector('[data-add-file]')?.focus();
    });
  };
  draw();
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
      <p class="span-2 notice small pm-accept-hint" hidden>${icon('paperclip', 16)} <span>Accepted: attach the signed acceptance document with <strong>Acceptance document</strong> on the milestone card, so it is with the deliverable when an auditor asks.</span></p>
      ${m.id ? html`<p class="span-2"><button type="button" class="link danger" id="del-ms">Delete this milestone</button> <span class="muted small">Its tasks stay, without a milestone.</span></p>` : ''}
    </div>`,
    onSubmit: async (f) => {
      const v = { name: f.name.value, dueDate: f.dueDate.value, deliverable: f.deliverable.checked, billingPercent: f.billingPercent.value, submittedAt: f.submittedAt.value || null, acceptedAt: f.acceptedAt.value || null, acceptanceNote: f.acceptanceNote.value };
      if (m.id) await api.put(`/api/pm/projects/${p.id}/milestones/${m.id}`, { ...v, version: m.version });
      else await api.post(`/api/pm/projects/${p.id}/milestones`, v);
      // Accepted without a document yet: say where it goes.
      toast(v.deliverable && v.acceptedAt && !m.attachments?.length ? 'Milestone saved. Attach the signed acceptance document from the milestone card.' : 'Milestone saved.');
      after?.();
    },
  });
  // Setting "Accepted on" for a deliverable without a document suggests attaching one.
  const hint = form.querySelector('.pm-accept-hint');
  const syncHint = () => (hint.hidden = !(form.deliverable.checked && form.acceptedAt.value && !m.attachments?.length));
  form.acceptedAt.addEventListener('change', syncHint);
  form.deliverable.addEventListener('change', syncHint);
  syncHint();
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
    title: 'Project members', wide: true, subtitle: `Managers change the project; members work on tasks${p.timeTracking ? ' and log time' : ''}; viewers read and comment. Anyone on the list can open the project.`,
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

// Milestone burn-up: scope (what the milestone holds), done and the expected line, one point per
// working day. Inline SVG drawn on a 100 × 100 box stretched to the card (lines keep their width);
// the labels are HTML around it, so they stay readable on a phone. The text under it says the same.
function burnupChart(b) {
  const bySize = b.basis === 'size';
  const fmt = (n) => plural(Math.round(n * 10) / 10, bySize ? 'effort point' : 'task');
  const pts = b.points;
  if (pts.length < 2 || !pts.some((x) => x.scope > 0)) return html`<p class="muted small">No tasks to chart in this milestone yet${pts.length < 2 ? ', or its due date is before its first task starts' : ''}.</p>`;
  const top = Math.max(1, ...pts.map((x) => Math.max(x.scope, x.expected || 0))) * 1.08;
  const X = (i) => Math.round((i / (pts.length - 1)) * 10000) / 100;
  const Y = (v) => Math.round((100 - (v / top) * 100) * 100) / 100;
  const line = (key) => pts.map((x, i) => (x[key] == null ? null : `${X(i)},${Y(x[key])}`)).filter(Boolean).join(' ');
  const at = (date) => {
    const i = pts.findLastIndex((x) => x.date <= date);
    return i < 0 ? null : X(i);
  };
  const todayX = b.today >= pts[0].date && b.today <= pts.at(-1).date ? at(b.today) : null;
  const dueX = at(b.due);
  const pct = b.scope ? Math.round((b.done / b.scope) * 100) : 0;
  const summary = `${b.name}: scope ${fmt(b.scope)}${b.added ? `, of which ${fmt(b.added)} added after ${fmtDate(b.start)}` : ''}. Done ${fmt(b.done)} (${pct}%)${b.today <= b.end ? ' by today' : ''}${b.expected != null && !b.finished ? `; expected by now ${fmt(b.expected)}` : ''}. Due ${fmtDate(b.due)}.`;
  return html`<div class="pm-bu">
      <div class="pm-bu-y" aria-hidden="true"><span>${Math.round(top)}</span><span class="pm-bu-unit">${bySize ? 'effort points' : 'tasks'}</span><span>0</span></div>
      <div class="pm-bu-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Burn-up chart. ${summary}" focusable="false">
          ${[25, 50, 75].map((y) => html`<line class="pm-bu-grid" x1="0" x2="100" y1="${y}" y2="${y}" />`)}
          ${dueX != null && dueX < 100 ? html`<line class="pm-bu-due" x1="${dueX}" x2="${dueX}" y1="0" y2="100" />` : ''}
          ${todayX != null ? html`<line class="pm-bu-today" x1="${todayX}" x2="${todayX}" y1="0" y2="100" />` : ''}
          <polyline class="pm-bu-expected" points="${line('expected')}" />
          <polyline class="pm-bu-scope" points="${line('scope')}" />
          <polyline class="pm-bu-done" points="${line('done')}" />
        </svg>
        ${todayX != null ? html`<span class="pm-bu-mark" style="left:${todayX}%">Today</span>` : ''}
      </div>
      <div class="pm-bu-x" aria-hidden="true"><span>${short(pts[0].date)}</span>${dueX != null && dueX < 100 ? html`<span class="pm-bu-duelabel" style="left:${dueX}%">Due ${short(b.due)}</span>` : ''}<span>${dueX === 100 ? 'Due ' : ''}${short(pts.at(-1).date)}</span></div>
    </div>
    <ul class="pm-bu-legend" aria-hidden="true"><li><i class="scope"></i>Scope</li><li><i class="done"></i>Done</li><li><i class="expected"></i>Expected (straight line in working days)</li><li><i class="today"></i>Today</li></ul>
    <p class="small pm-bu-text">${summary}</p>
    <details class="pm-bu-method"><summary>How this is worked out</summary><p class="muted small">In ${bySize ? `effort points, as the milestone's progress is: 60% or more of its tasks have a size, and each counts its weight (${SIZE_KEYS.map((k) => `${k} ${SIZES[k].weight}`).join(', ')}; a task without one, the average)` : 'tasks, as the milestone\'s progress is: fewer than 60% of them have a size'}. Worked out from when tasks were added, their status changes and when they were done. Deleted tasks are not kept, so they do not show; a task moved from another milestone counts here from the day it was added.</p></details>`;
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
      <div><small>Progress</small><strong>${p.progress.percent == null ? '—' : `${p.progress.percent}%`}</strong><span>${p.progress.done} of ${plural(p.progress.total, 'task')} done${p.progress.basis === 'size' ? ', weighed by size' : ''}</span></div>
      <div><small>Dates</small><strong>${short(p.startDate)} – ${p.endDate ? short(p.endDate) : '…'}</strong><span>Manager: ${p.managerName || '—'}</span></div>
      ${p.time ? html`<div><small>Time</small><strong>${hrs(p.time.logged)}</strong><span>logged${p.time.budget ? ` of a ${hrs(p.time.budget)} budget` : ''}</span></div>`
        : html`<div><small>Open tasks</small><strong>${p.counts.open}</strong><span>${p.counts.overdue} overdue · ${p.counts.blocked} blocked</span></div>`}
    </section>
    <h2>Milestones</h2>
    <table><thead><tr><th>Milestone</th><th>Due</th><th>Progress</th><th>Status</th></tr></thead><tbody>${ms.map((m) => html`<tr><td>${m.name}${m.deliverable ? html` <em>(deliverable${m.billingPercent != null ? `, ${m.billingPercent}%` : ''})</em>` : ''}</td><td>${fmtDate(m.dueDate)}</td><td>${m.progress.percent == null ? '—' : `${m.progress.percent}%`}</td><td>${m.acceptedAt ? `Accepted ${fmtDate(m.acceptedAt)}${m.attachments?.length ? ' (document attached)' : ''}` : m.submittedAt ? `Submitted ${fmtDate(m.submittedAt)}` : HEALTH[m.value] || ''}</td></tr>`)}</tbody></table>
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

// ---------- Quick filters and saved views (Board and List) ----------
// The chips: toggle buttons; their state is in the address (f=mine,overdue), like the other filters.
const chipBar = (on) => html`<div class="chips pm-chips" role="group" aria-label="Quick filters">${Object.entries(QUICK_FILTERS).map(([k, label]) => html`<button type="button" class="chip ${on.includes(k) ? 'on' : ''}" data-chip="${k}" aria-pressed="${on.includes(k) ? 'true' : 'false'}">${label}</button>`)}</div>`;
function wireChips(el, state, after) {
  el.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.chip;
    state.f = state.f.includes(k) ? state.f.filter((x) => x !== k) : [...state.f, k];
    b.classList.toggle('on', state.f.includes(k));
    b.setAttribute('aria-pressed', String(state.f.includes(k)));
    after();
  }));
}
// A person or milestone a filter names that is no longer in the project: the filter shows all.
const knownWho = (p, who) => (!who || who === 'me' || who === 'none' || p.members.some((m) => m.userId === who) ? who : '');
const knownMs = (p, ms) => (!ms || ms === 'none' || p.milestones.some((m) => m.id === ms) ? ms : '');
const currentQuery = () => location.hash.split('?')[1] || '';
// The Views menu: the saved views of this tab (shared with the project, then mine), Save view… and
// Delete a view…. Choosing a view opens the tab with its filters.
const viewsButton = (views, tab) => {
  const on = views.find((v) => v.tab === tab && v.query === currentQuery());
  return html`<button type="button" class="btn pm-views-btn" id="views" aria-haspopup="menu" aria-expanded="false">${icon('layers', 16)} <span>${on ? on.name : 'Views'}</span>${icon('chevronDown', 14)}</button>`;
};
function wireViews(el, p, tab) {
  const btn = el.querySelector('#views');
  btn?.addEventListener('click', guard(async () => {
    const views = (await api.get(`/api/pm/projects/${p.id}/views`)).filter((v) => v.tab === tab);
    const go = (v) => (location.hash = `#/projects/${p.id}/${tab}${v.query ? `?${v.query}` : ''}`);
    const item = (v) => ({ label: v.name, current: v.query === currentQuery(), onPick: () => go(v) });
    const shared = views.filter((v) => v.shared);
    const mine = views.filter((v) => !v.shared);
    popMenu(btn, [
      { label: `All tasks (no filters)`, current: !currentQuery(), onPick: () => go({ query: '' }) },
      ...(shared.length ? [{ heading: 'Shared with the project' }, ...shared.map(item)] : []),
      ...(mine.length ? [{ heading: 'Mine' }, ...mine.map(item)] : []),
      { sep: true },
      { label: 'Save this view…', onPick: () => saveView(p, tab) },
      ...(views.some((v) => v.canDelete) ? [{ label: 'Delete a view…', onPick: () => deleteViews(p, views.filter((v) => v.canDelete)) }] : []),
    ], `${VIEW_TABS[tab]} views`);
  }));
}
function saveView(p, tab) {
  const manage = may(p.access, 'manage');
  modal({
    title: 'Save this view', subtitle: `The ${VIEW_TABS[tab].toLowerCase()}'s filters as they are now, under a name. Pick it later from Views.`, submitLabel: 'Save view',
    body: html`<label class="field"><span>Name<em>*</em></span><input name="name" maxlength="60" required placeholder="e.g. Overdue for the client" /></label>
      ${manage ? html`<fieldset class="field pm-radio"><legend>Who sees it</legend>
        <label class="check"><input type="radio" name="shared" value="" checked /><span>Just me</span></label>
        <label class="check"><input type="radio" name="shared" value="1" /><span>Everyone on the project</span></label></fieldset>` : html`<p class="muted small">Only you see it. A project manager can save views for everyone on the project.</p>`}`,
    onSubmit: async (f) => {
      const v = await api.post(`/api/pm/projects/${p.id}/views`, { tab, name: f.name.value, query: currentQuery(), shared: Boolean(f.shared?.value) });
      toast(`View "${v.name}" saved${v.shared ? ' for everyone on the project' : ''}.`);
      reloadPage();
    },
  });
}
function deleteViews(p, views) {
  const { form, close } = modal({
    title: 'Delete a view', subtitle: 'Your own views, and the shared ones you saved (a project manager can delete any shared view).', submitLabel: null,
    body: html`<ul class="crm-mini">${views.map((v) => html`<li><span class="grow"><strong>${v.name}</strong><small>${v.shared ? 'Shared with the project' : 'Just me'}</small></span><button type="button" class="btn small-btn danger ghost" data-del-view="${v.id}" aria-label="Delete the view ${v.name}">Delete</button></li>`)}</ul>`,
  });
  form.querySelectorAll('[data-del-view]').forEach((b) => b.addEventListener('click', guard(async () => {
    const v = views.find((x) => x.id === b.dataset.delView);
    if (!(await confirmDialog(`Delete the view "${v.name}"?${v.shared ? ' Everyone on the project loses it.' : ''}`, { title: 'Delete view' }))) return;
    await api.del(`/api/pm/projects/${p.id}/views/${v.id}`);
    toast('View deleted.');
    close();
    reloadPage();
  })));
}

// ---------- Board ----------
export async function boardView(el, { id }, query) {
  const [p, all, views, m] = await Promise.all([loadProject(id), api.get(`/api/pm/projects/${id}/tasks`), api.get(`/api/pm/projects/${id}/views`), meta()]);
  let tasks = all;
  const work = may(p.access, 'work');
  const state = { who: knownWho(p, query.who || ''), ms: knownMs(p, query.ms || ''), cancelled: query.cancelled === '1', f: parseFilters(query.f), q: String(query.q || '').slice(0, 100) };
  mount(el, html`
    ${projectHeader(p, 'board', may(p.access, 'manage') ? html`<button class="btn" id="cols">${icon('settings', 16)} Edit columns</button>` : '')}
    <div class="toolbar pm-filterbar">
      <input type="search" id="q" placeholder="Search key or title…" aria-label="Search tasks on the board" value="${state.q}" maxlength="100" />
      <select id="f-who" aria-label="Assignee"><option value="">Everyone</option>${options([['me', 'Mine'], ['none', 'Unassigned'], ...p.members.filter((m) => m.role !== 'viewer').map((m) => [m.userId, m.name])], state.who)}</select>
      <select id="f-ms" aria-label="Milestone"><option value="">All milestones</option>${options([['none', 'No milestone'], ...p.milestones.map((m) => [m.id, m.name])], state.ms)}</select>
      <label class="field check inline"><input type="checkbox" id="f-cancelled" ${state.cancelled ? 'checked' : ''} /><span>Show cancelled</span></label>
      ${viewsButton(views, 'board')}
    </div>
    <div class="pm-chips-line">${chipBar(state.f)}<span class="muted small" id="count" aria-live="polite"></span></div>
    <div id="board"></div>
    ${work ? html`<p class="muted small pm-board-note">${icon('grip', 14)} Drag a card to another column or place, or use its ${icon('chevronDown', 14)} <strong>Move to</strong> menu (keyboard and phones).</p>` : ''}`);
  const shown = () => tasks.filter((t) => (!state.who || (state.who === 'me' ? t.assigneeId === ctx.user.id : state.who === 'none' ? !t.assigneeId : t.assigneeId === state.who))
    && (!state.ms || (state.ms === 'none' ? !t.milestoneIdEffective : t.milestoneIdEffective === state.ms))
    && taskMatches(t, { chips: state.f, q: state.q }, { today: today(), userId: ctx.user.id }));
  const columns = () => p.statuses.filter((s) => s.category !== 'cancelled' || state.cancelled);
  const card = (t) => html`<article class="pm-card ${t.overdue ? 'is-overdue' : ''}" data-id="${t.id}" draggable="${work ? 'true' : 'false'}">
      <div class="pm-card-top"><span class="mono">${t.key}</span>${priorityBadge(t.priority)}${t.blocked ? html`<span class="pm-blocked" title="Blocked: waiting for another task">${icon('lock', 13)} Blocked</span>` : ''}
        ${work ? html`<button type="button" class="icon-btn pm-move-btn" data-move="${t.id}" aria-haspopup="menu" aria-label="Move ${t.key} to…" title="Move to…">${icon('chevronDown', 16)}</button>` : ''}</div>
      <a class="pm-card-title" href="#/projects/${p.id}/tasks/${t.id}">${t.title}</a>
      ${t.parentId ? html`<small class="muted">Subtask of ${tasks.find((x) => x.id === t.parentId)?.key || ''}</small>` : ''}
      <div class="pm-card-foot">${sizeChip(t.size, m.sizes)}${dueChip(t)}${t.checklist.length ? html`<span class="pm-meta" title="Checklist">${icon('check', 12)} ${t.checklistDone}/${t.checklist.length}</span>` : ''}${t.subtasks ? html`<span class="pm-meta" title="Subtasks">${icon('layers', 12)} ${t.subtasks}</span>` : ''}${t.ticket ? html`<span class="pm-meta" title="Service desk ticket ${t.ticket.ref}">${icon('ticket', 12)}</span>` : ''}<span class="spacer"></span>${avatar(t.assigneeName)}</div>
    </article>`;
  function draw(focusId) {
    const list = shown();
    mount(el.querySelector('#count'), `${plural(list.length, 'task')}`);
    // A filtered column says how many of its tasks are shown; the limit always counts them all.
    const countLabel = (shownN, all, limit) => (shownN === all ? (limit ? `${all} / ${limit}` : `${all}`) : `${shownN} of ${all}${limit ? ` · limit ${limit}` : ''}`);
    const cols = columns();
    mount(el.querySelector('#board'), html`<div class="pm-board" style="--cols:${cols.length}">${cols.map((s) => {
      const inCol = list.filter((t) => t.statusId === s.id).sort(byRank);
      const all = tasks.filter((t) => t.statusId === s.id).length;
      const over = s.wipLimit && all > s.wipLimit;
      return html`<section class="pm-col pm-c-${s.color}" data-status="${s.id}" aria-label="${s.name}">
        <header><strong>${s.name}</strong><span class="pm-col-count ${over ? 'over' : ''}" title="${s.wipLimit ? `Work-in-progress limit ${s.wipLimit}` : ''}">${countLabel(inCol.length, all, s.wipLimit)}</span>
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
      const t = await api.post(`/api/pm/projects/${id}/tasks`, { title, statusId: f.dataset.quick, position: 'top', milestoneId: state.ms && state.ms !== 'none' ? state.ms : null, assigneeId: state.who === 'me' || (state.f.includes('mine') && !state.f.includes('unassigned')) ? ctx.user.id : null });
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
    const qs = new URLSearchParams(Object.entries({ f: state.f.join(','), q: state.q, who: state.who, ms: state.ms, cancelled: state.cancelled ? '1' : '' }).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/projects/${id}/board${qs ? `?${qs}` : ''}`);
    const label = el.querySelector('#views span');
    if (label) label.textContent = views.find((v) => v.tab === 'board' && v.query === qs)?.name || 'Views';
    draw();
  };
  wireChips(el, state, setQuery);
  wireViews(el, p, 'board');
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value.trim()), setQuery()));
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
  const [p, all, views, m] = await Promise.all([loadProject(id), api.get(`/api/pm/projects/${id}/tasks`), api.get(`/api/pm/projects/${id}/views`), meta()]);
  let tasks = all;
  const work = may(p.access, 'work');
  // "overdue=1" (older links) is the Overdue chip.
  const f = parseFilters([query.f, query.overdue === '1' ? 'overdue' : ''].filter(Boolean).join(','));
  // An address from before 0.17 may sort by the estimate (now the size) or the hours left (gone).
  const sortBy = query.sort === 'estimate' ? 'size' : query.sort;
  const state = { q: String(query.q || '').slice(0, 100), group: query.group === 'status' ? 'status' : 'milestone', who: knownWho(p, query.who || ''), show: ['open', 'done', 'all'].includes(query.show) ? query.show : 'open', f, sort: LIST_SORTS.includes(sortBy) ? sortBy : 'rank', dir: query.dir === 'desc' && LIST_SORTS.includes(sortBy) ? -1 : 1, sel: new Set() };
  const people = await assigneeOptions(p, p.access, null);
  const queue = saveQueue();
  const manage = may(p.access, 'manage');
  mount(el, html`
    ${projectHeader(p, 'list', html`<button class="btn" id="export">${icon('download', 16)} Export CSV</button>${manage ? html`<button class="btn" id="import">${icon('upload', 16)} Import tasks</button>` : ''}${work ? html`<button class="btn primary" id="new">+ Task</button>` : ''}`)}
    <section class="card scroll-x">
      <div class="toolbar pad pm-filterbar">
        <input type="search" id="q" placeholder="Search key, title or assignee…" aria-label="Search tasks" value="${state.q}" maxlength="100" />
        <select id="f-group" aria-label="Group by">${options([['milestone', 'Group by milestone'], ['status', 'Group by status']], state.group)}</select>
        <select id="f-who" aria-label="Assignee"><option value="">Everyone</option>${options([['me', 'Mine'], ['none', 'Unassigned'], ...p.members.filter((m) => m.role !== 'viewer').map((m) => [m.userId, m.name])], state.who)}</select>
        <select id="f-show" aria-label="Which tasks">${options([['open', 'Open tasks'], ['done', 'Done'], ['all', 'All tasks']], state.show)}</select>
        <select id="f-sort" class="pm-phone-only" aria-label="Sort by">${options([['rank', 'Board order'], ['due', 'Sort by due date'], ['priority', 'Sort by priority'], ['assignee', 'Sort by assignee'], ['status', 'Sort by status'], ['title', 'Sort by title'], ['size', 'Sort by size']], state.sort)}</select>
        ${viewsButton(views, 'list')}
        ${densitySwitch()}
      </div>
      <div class="pm-chips-row">${chipBar(state.f)}</div>
      <div id="list"></div>
    </section>
    ${work ? html`<div class="pm-bulk" id="bulk" role="region" aria-label="Change the selected tasks" hidden></div>` : ''}`);
  wireDensity(el);
  const SORTS = {
    rank: byRank, key: (a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }), title: (a, b) => a.title.localeCompare(b.title),
    status: (a, b) => p.statuses.findIndex((s) => s.id === a.statusId) - p.statuses.findIndex((s) => s.id === b.statusId),
    assignee: (a, b) => (a.assigneeName || '~').localeCompare(b.assigneeName || '~'), due: (a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'),
    priority: (a, b) => Object.keys(PRIORITY).indexOf(b.priority) - Object.keys(PRIORITY).indexOf(a.priority),
    size: (a, b) => (SIZES[a.size]?.weight ?? 0) - (SIZES[b.size]?.weight ?? 0),
  };
  const match = (t) => taskMatches(t, { chips: state.f, q: state.q }, { today: today(), userId: ctx.user.id })
    && (!state.who || (state.who === 'me' ? t.assigneeId === ctx.user.id : state.who === 'none' ? !t.assigneeId : t.assigneeId === state.who))
    && (state.show === 'all' || (state.show === 'done' ? !['todo', 'active'].includes(t.category) : ['todo', 'active'].includes(t.category)));
  // Shown rows: matching tasks, each subtask under its parent (the parent is shown when a subtask matches).
  function rows(group) {
    const cmp = (a, b) => SORTS[state.sort](a, b) * state.dir || byRank(a, b);
    const hits = group.filter(match);
    const parents = group.filter((t) => !t.parentId && (hits.includes(t) || hits.some((s) => s.parentId === t.id))).sort(cmp);
    const orphans = hits.filter((t) => t.parentId && !group.some((x) => x.id === t.parentId)).sort(cmp);
    return [...parents.flatMap((t) => [t, ...hits.filter((s) => s.parentId === t.id).sort(cmp)]), ...orphans];
  }
  const th = (k, label, cls = '') => html`<th class="${cls}" ${state.sort === k ? html`aria-sort="${state.dir === 1 ? 'ascending' : 'descending'}"` : ''}><button type="button" class="pm-sort ${state.sort === k ? (state.dir === 1 ? 'on asc' : 'on desc') : ''}" data-sort="${k}" aria-label="Sort by ${label}">${label}</button></th>`;
  // The title and its key line. With a checkbox, both sit in their own column beside it, so a title
  // that wraps never runs under the checkbox.
  const title = (t) => html`<a href="#/projects/${id}/tasks/${t.id}"><strong>${t.title}</strong></a><small><span class="mono">${t.key}</span>${t.blocked ? html` · ${icon('lock', 12)} blocked` : ''}${t.subtasks ? ` · ${plural(t.subtasks, 'subtask')}` : ''}${t.checklist.length ? ` · ${t.checklistDone}/${t.checklist.length} checked` : ''}</small>`;
  const row = (t) => html`<tr data-href="#/projects/${id}/tasks/${t.id}" class="${t.parentId ? 'pm-sub' : ''} ${t.overdue ? 'pm-late' : ''} ${state.sel.has(t.id) ? 'pm-selected' : ''}">
      <td>${work ? html`<div class="pm-row-title"><label class="pm-sel-hit"><input type="checkbox" class="pm-sel" data-sel="${t.id}" aria-label="Select ${t.key} ${t.title}" ${state.sel.has(t.id) ? 'checked' : ''} /></label><span>${title(t)}</span></div>` : title(t)}</td>
      <td>${work ? html`<select data-f="statusId" data-id="${t.id}" aria-label="Status of ${t.key}">${options(p.statuses.map((s) => [s.id, s.name]), t.statusId)}</select>` : statusChip(p.statuses.find((s) => s.id === t.statusId))}</td>
      <td>${work ? html`<select data-f="assigneeId" data-id="${t.id}" aria-label="Assignee of ${t.key}">${people}</select>` : t.assigneeName || '—'}</td>
      <td>${work ? html`<input type="date" data-f="dueDate" data-id="${t.id}" value="${t.dueDate || ''}" aria-label="Due date of ${t.key}" class="${t.overdue ? 'bad' : ''}" />` : t.dueDate ? dueChip(t, { long: true }) : '—'}</td>
      <td>${priorityBadge(t.priority) || PRIORITY[t.priority]}</td>
      <td class="pm-size-cell">${work ? html`<select data-f="size" data-id="${t.id}" aria-label="Size of ${t.key}" class="pm-size-select" title="${t.size ? `${sizeName(t.size)}: ${sizeEffort(t.size, m.sizes)}` : 'No size'}">${sizeOptions(t.size, m.sizes, '—', true)}</select>` : sizeChip(t.size, m.sizes) || html`<span class="muted">—</span>`}${p.timeTracking && t.loggedHours ? html`<small>${hrs(t.loggedHours)} logged</small>` : ''}</td>
    </tr>`;
  function groups() {
    if (state.group === 'status') return p.statuses.map((s) => ({ key: s.id, title: html`${statusChip(s)}`, list: tasks.filter((t) => t.statusId === s.id) }));
    return [...p.milestones.map((m) => ({ key: m.id, title: html`<span class="pm-diamond ${m.deliverable ? 'deliverable' : ''}" aria-hidden="true"></span>${m.name} <small class="muted">due ${fmtDate(m.dueDate)}</small>`, list: tasks.filter((t) => t.milestoneIdEffective === m.id) })),
      { key: 'none', title: 'No milestone', list: tasks.filter((t) => !t.milestoneIdEffective || !p.milestones.some((m) => m.id === t.milestoneIdEffective)) }];
  }
  function draw() {
    // The same order of keys as a saved view (shared/projects.js VIEW_KEYS), so a view is recognized.
    const qs = new URLSearchParams(Object.entries({ f: state.f.join(','), q: state.q, group: state.group === 'status' ? 'status' : '', who: state.who, show: state.show === 'open' ? '' : state.show, sort: state.sort === 'rank' ? '' : state.sort, dir: state.dir === -1 ? 'desc' : '' }).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/projects/${id}/list${qs ? `?${qs}` : ''}`);
    const label = el.querySelector('#views span');
    if (label) label.textContent = views.find((v) => v.tab === 'list' && v.query === qs)?.name || 'Views';
    const gs = groups().map((g) => ({ ...g, rows: rows(g.list) })).filter((g) => g.rows.length);
    // The selection keeps only tasks still shown: a bulk change applies to what you see.
    const shownIds = gs.flatMap((g) => g.rows.map((t) => t.id));
    for (const x of [...state.sel]) if (!shownIds.includes(x)) state.sel.delete(x);
    mount(el.querySelector('#list'), gs.length ? html`${work ? html`<div class="pm-selall pad"><label class="check"><input type="checkbox" id="sel-all" /><span>Select all ${plural(shownIds.length, 'task')} shown</span></label></div>` : ''}<table class="table clickable pm-list ${work ? 'pm-selectable' : ''}">
      <thead><tr>${th('title', 'Task')}${th('status', 'Status')}${th('assignee', 'Assignee')}${th('due', 'Due')}${th('priority', 'Priority')}${th('size', 'Size')}</tr></thead>
      ${gs.map((g) => html`<tbody><tr class="pm-group"><th colspan="6" scope="rowgroup">${g.title} <span class="muted small">${plural(g.rows.length, 'task')}</span></th></tr>${g.rows.map(row)}</tbody>`)}
    </table>` : html`<div class="empty"><p>${tasks.length ? 'No task matches the filters.' : work ? 'No tasks yet. Add one with + Task, or on the board.' : 'No tasks yet.'}</p></div>`);
    el.querySelectorAll('select[data-f="assigneeId"]').forEach((s) => (s.value = tasks.find((t) => t.id === s.dataset.id)?.assigneeId || ''));
    el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a, select, input, button, label') && (location.hash = tr.dataset.href)));
    // Selecting rows for a bulk change.
    const syncSel = () => {
      const all = el.querySelector('#sel-all');
      if (all) {
        const n = shownIds.filter((x) => state.sel.has(x)).length;
        all.checked = n > 0 && n === shownIds.length;
        all.indeterminate = n > 0 && n < shownIds.length;
      }
      drawBulk();
    };
    el.querySelectorAll('[data-sel]').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) state.sel.add(cb.dataset.sel);
      else state.sel.delete(cb.dataset.sel);
      cb.closest('tr').classList.toggle('pm-selected', cb.checked);
      syncSel();
    }));
    el.querySelector('#sel-all')?.addEventListener('change', (e) => {
      for (const x of shownIds) if (e.target.checked) state.sel.add(x);
      else state.sel.delete(x);
      el.querySelectorAll('[data-sel]').forEach((cb) => ((cb.checked = state.sel.has(cb.dataset.sel)), cb.closest('tr').classList.toggle('pm-selected', cb.checked)));
      syncSel();
    });
    syncSel();
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
  // ----- Bulk change of the selected tasks -----
  const reloadList = async () => {
    tasks = await api.get(`/api/pm/projects/${id}/tasks`);
    draw();
  };
  const bulk = async (body) => {
    const r = await api.post(`/api/pm/projects/${id}/tasks/bulk`, { ids: [...state.sel], ...body });
    toast(r.removed != null ? `${plural(r.removed, 'task')} deleted.` : `${plural(r.changed, 'task')} changed.`);
    state.sel.clear();
    changed();
    await reloadList();
    el.querySelector('#sel-all')?.focus();
  };
  const members = p.members.filter((m) => m.role !== 'viewer' && m.active);
  const BULK = {
    status: ['Status', () => html`<label class="field"><span>New status</span><select name="v">${options(p.statuses.map((s) => [s.id, s.name]))}</select></label>`, (f) => bulk({ set: { statusId: f.v.value } })],
    assignee: ['Assignee', () => html`<label class="field"><span>Assign to</span><select name="v"><option value="">Nobody (unassigned)</option>${options(members.map((m) => [m.userId, m.name]))}</select><small class="hint">Members of the project only. Add someone under Members first.</small></label>`, (f) => bulk({ set: { assigneeId: f.v.value || null } })],
    milestone: ['Milestone', () => html`<label class="field"><span>Milestone</span><select name="v"><option value="">None</option>${options(p.milestones.map((m) => [m.id, `${m.name} (${short(m.dueDate)})`]))}</select></label>`, (f) => bulk({ set: { milestoneId: f.v.value || null } })],
    priority: ['Priority', () => html`<label class="field"><span>Priority</span><select name="v">${options(Object.entries(PRIORITY), 'normal')}</select></label>`, (f) => bulk({ set: { priority: f.v.value } })],
    size: ['Size', () => html`<label class="field"><span>Size</span><select name="v">${sizeOptions('M', m.sizes, 'No size')}</select><small class="hint">${sizeHint}</small></label>`, (f) => bulk({ set: { size: f.v.value || null } })],
    dates: ['Move dates', () => html`<label class="field"><span>Move the start and due dates by (working days)</span><input type="number" name="v" min="-260" max="260" step="1" value="5" inputmode="numeric" required data-msg="Enter how many working days to move the dates, such as 5 or -3." /><small class="hint">A negative number moves them earlier. Weekends and the holidays in CORE's calendar are skipped; tasks without dates keep none.</small></label>`,
      (f) => {
        const n = Number(f.v.value);
        if (!Number.isInteger(n) || !n) throw new Error('Enter a whole number of working days, such as 5 or -3.');
        return bulk({ shiftDays: n });
      }],
    watchers: ['Watchers', () => html`${manage ? html`<label class="field"><span>Person</span><select name="who">${options(p.members.filter((m) => m.active).map((m) => [m.userId, m.userId === ctx.user.id ? `${m.name} (you)` : m.name]), ctx.user.id)}</select></label>` : ''}
        <fieldset class="field pm-radio"><legend>${manage ? 'Watching these tasks' : 'You'}</legend>
          <label class="check"><input type="radio" name="how" value="add" checked /><span>${manage ? 'Add as a watcher' : 'Watch these tasks'}</span></label>
          <label class="check"><input type="radio" name="how" value="remove" /><span>${manage ? 'Remove as a watcher' : 'Stop watching these tasks'}</span></label></fieldset>
        <p class="muted small">Watchers hear of comments and of the task being done or cancelled.${manage ? '' : ' A project manager can add others.'}</p>`,
      (f) => {
        const who = f.who?.value || ctx.user.id;
        return bulk({ watchers: f.how.value === 'add' ? { add: [who] } : { remove: [who] } });
      }],
  };
  function drawBulk() {
    const bar = el.querySelector('#bulk');
    if (!bar) return;
    const n = state.sel.size;
    bar.hidden = !n;
    if (!n) return mount(bar, '');
    mount(bar, html`<div class="pm-bulk-in">
      <strong class="pm-bulk-count" aria-live="polite">${plural(n, 'task')} selected</strong>
      <div class="pm-bulk-actions">${Object.entries(BULK).map(([k, [label]]) => html`<button type="button" class="btn small-btn" data-bulk="${k}">${label}</button>`)}
        <button type="button" class="btn small-btn danger ghost" data-bulk-del>Delete</button></div>
      <button type="button" class="btn small-btn ghost" data-bulk-clear>Clear selection</button>
      <button type="button" class="btn primary pm-bulk-menu" data-bulk-menu aria-haspopup="dialog">${icon('edit', 16)} Actions</button>
      <button type="button" class="icon-btn pm-bulk-x" data-bulk-x aria-label="Clear selection">${icon('x', 18)}</button></div>`);
    // Phones: one Actions button opens the same changes as a list (the bar has room for no more).
    bar.querySelector('[data-bulk-menu]').addEventListener('click', () => {
      const { form, close } = modal({
        title: `Change ${plural(state.sel.size, 'selected task')}`, submitLabel: null, cancelLabel: 'Close',
        body: html`<div class="pm-bulk-sheet">${Object.entries(BULK).map(([k, [label]]) => html`<button type="button" class="btn" data-pick="${k}">${label}</button>`)}
          <button type="button" class="btn danger ghost" data-pick-del>Delete</button></div>`,
      });
      form.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick], [data-pick-del]');
        if (!b) return;
        close();
        bar.querySelector(b.dataset.pick ? `[data-bulk="${b.dataset.pick}"]` : '[data-bulk-del]').click();
      });
    });
    bar.querySelector('[data-bulk-x]').addEventListener('click', () => bar.querySelector('[data-bulk-clear]').click());
    bar.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => {
      const [label, body, apply] = BULK[b.dataset.bulk];
      modal({ title: `${label}: ${plural(state.sel.size, 'task')}`, subtitle: 'Every selected task is checked first: if one cannot take the change, nothing is changed and CORE says which.', submitLabel: 'Apply', body: body(), onSubmit: (f) => apply(f) });
    }));
    bar.querySelector('[data-bulk-del]').addEventListener('click', guard(async () => {
      const subs = tasks.filter((t) => state.sel.has(t.parentId) && !state.sel.has(t.id)).length;
      if (!(await confirmDialog(`Delete ${plural(state.sel.size, 'selected task')}${subs ? ` and ${plural(subs, 'subtask')} under them` : ''}? Their comments and files go too; time logged on them stays on the project. Only a project manager, or the person who added a task, can delete it: if one of them is not yours, nothing is deleted.`, { title: 'Delete tasks' }))) return;
      await bulk({ delete: true });
    }, reloadList));
    bar.querySelector('[data-bulk-clear]').addEventListener('click', () => {
      state.sel.clear();
      draw();
      el.querySelector('#sel-all')?.focus();
    });
  }
  // An import may add milestones: the whole List is loaded again.
  el.querySelector('#import')?.addEventListener('click', () => importTasks(p, () => listView(el, { id }, query)));
  el.querySelector('#q').addEventListener('input', (e) => ((state.q = e.target.value.trim()), draw()));
  el.querySelector('#f-group').addEventListener('change', (e) => ((state.group = e.target.value), draw()));
  el.querySelector('#f-who').addEventListener('change', (e) => ((state.who = e.target.value), draw()));
  el.querySelector('#f-show').addEventListener('change', (e) => ((state.show = e.target.value), draw()));
  wireChips(el, state, draw);
  wireViews(el, p, 'list');
  el.querySelector('#f-sort').addEventListener('change', (e) => ((state.sort = e.target.value), (state.dir = 1), draw()));
  el.querySelector('#new')?.addEventListener('click', () => newTask(p, tasks, {}, async () => ((tasks = await api.get(`/api/pm/projects/${id}/tasks`)), draw())));
  el.querySelector('#export').addEventListener('click', () => {
    const shown = groups().flatMap((g) => rows(g.list));
    downloadFile(`${p.code}-tasks-${today()}.csv`, toCsv(taskCsvRows(shown, p.milestones, { time: p.timeTracking })));
  });
  draw();
}

// Import tasks from a CSV file (project managers): choose the file, match its columns, check every
// row (nothing is saved), then import all of them or none. The file is read by the server.
function importTasks(p, after) {
  const st = { csv: null, name: '', preview: null, check: null };
  const { form, close } = modal({ title: 'Import tasks', wide: true, submitLabel: null, subtitle: `Into ${p.code} ${p.name}. From a CSV file saved from Excel or Google Sheets, with a header row: up to ${IMPORT_MAX_ROWS.toLocaleString('en-PH')} tasks and 2 MB.`, body: html`<div id="imp" aria-live="polite"></div>` });
  const box = form.querySelector('#imp');
  const colOptions = (sel) => html`<option value="">Not in the file</option>${st.preview.headers.map((h, i) => option(i, h || `Column ${i + 1}`, sel))}`;
  const mapping = () => Object.fromEntries([...box.querySelectorAll('[data-map]')].filter((x) => x.value !== '').map((x) => [x.dataset.map, Number(x.value)]));
  const send = (dryRun) => api.post(`/api/pm/projects/${p.id}/import`, { csv: st.csv, fileName: st.name, mapping: st.mapping, createMilestones: st.createMs, dryRun });
  const step1 = () => {
    mount(box, html`<ol class="pm-steps"><li class="on">Choose the file</li><li>Match the columns</li><li>Check and import</li></ol>
      <label class="field"><span>CSV file</span><input type="file" id="imp-file" accept=".csv,text/csv" /></label>
      <p class="small">Columns CORE reads (by their header; you can match them on the next step): <strong>Title</strong> (required), Description, Status (its name on the board), Assignee (a member's username or full name), Start and Due (2026-12-01 or 01/12/2026, day first), Size (XS, S, M, L, XL or their names: Extra small … Extra large), Priority, Milestone (by name), Parent (another row's number, the header being row 1, or its title; one level) and Checklist (items separated by ;). A file with an <strong>Estimate (h)</strong> column instead of sizes still works: up to 2 h becomes XS, up to 8 h S, up to 24 h M, up to 48 h L, more XL.</p>
      <p><button type="button" class="link" id="imp-tpl">${icon('download', 14)} Download the template</button></p>`);
    box.querySelector('#imp-tpl').addEventListener('click', () => downloadFile('core-tasks-template.csv', toCsv(IMPORT_TEMPLATE)));
    box.querySelector('#imp-file').addEventListener('change', guard(async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) throw new Error(`The file is ${sizeLabel(file.size)}; the limit is 2 MB. Split it into smaller files.`);
      st.csv = await file.text();
      st.name = file.name;
      st.preview = await api.post(`/api/pm/projects/${p.id}/import/preview`, { csv: st.csv });
      step2();
      box.querySelector('[data-map]')?.focus();
    }));
  };
  const step2 = () => {
    const pv = st.preview;
    mount(box, html`<ol class="pm-steps"><li>Choose the file</li><li class="on">Match the columns</li><li>Check and import</li></ol>
      <p><strong>${st.name}</strong>: ${plural(pv.count, 'row')} under the header.</p>
      <div class="grid two pm-imp-map">${Object.entries(IMPORT_FIELDS).map(([k, f]) => html`<label class="field"><span>${f.label}${f.required ? html`<em>*</em>` : ''}</span><select data-map="${k}">${colOptions(pv.mapping[k])}</select></label>`)}</div>
      <label class="field check"><input type="checkbox" id="imp-ms" /><span>Create the milestones that are missing (due on the latest due date of their tasks, or the project's end date)</span></label>
      ${pv.sample.length ? html`<details><summary>The first rows of the file</summary><div class="scroll-x"><table class="table compact no-stack pm-imp-sample"><thead><tr>${pv.headers.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody>${pv.sample.map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody></table></div></details>` : ''}
      <div class="actions pm-imp-actions"><button type="button" class="btn" id="imp-back">Choose another file</button><span class="spacer"></span><button type="button" class="btn primary" id="imp-check">Check the file</button></div>`);
    box.querySelector('#imp-back').addEventListener('click', step1);
    box.querySelector('#imp-check').addEventListener('click', guard(async (e) => {
      e.target.disabled = true;
      st.mapping = mapping();
      st.createMs = box.querySelector('#imp-ms').checked;
      try {
        st.check = await send(true);
        step3();
      } finally {
        e.target.disabled = false;
      }
    }));
  };
  const step3 = () => {
    const c = st.check;
    const bad = c.rows.filter((r) => r.errors.length);
    const warn = c.rows.filter((r) => !r.errors.length && r.warnings.length);
    mount(box, html`<ol class="pm-steps"><li>Choose the file</li><li>Match the columns</li><li class="on">Check and import</li></ol>
      ${bad.length ? html`<p class="notice bad">${icon('alert', 16)} <span>${plural(bad.length, 'row')} of ${c.tasks} ${bad.length === 1 ? 'has' : 'have'} problems, so nothing can be imported yet. Correct the file and choose it again, or change how the columns are matched.</span></p>`
        : html`<p class="notice ok">${icon('checkCircle', 16)} <span>All ${plural(c.tasks, 'row')} can be imported: ${plural(c.tasks - c.subtasks, 'task')} and ${plural(c.subtasks, 'subtask')}${c.newMilestones.length ? `, and ${plural(c.newMilestones.length, 'new milestone')}` : ''}. Nothing is saved until you click Import.</span></p>`}
      ${c.newMilestones.length ? html`<p class="small">New milestones: ${c.newMilestones.map((m) => `${m.name} (due ${m.dueDate ? fmtDate(m.dueDate) : 'no date'})`).join('; ')}.</p>` : ''}
      ${c.fromHours ? html`<p class="notice small">${icon('help', 16)} <span>${plural(c.fromHours, 'row')} ${c.fromHours === 1 ? 'takes its' : 'take their'} size from the <strong>Estimate (h)</strong> column: up to 2 h XS, up to 8 h S, up to 24 h M, up to 48 h L, more XL. Each one is listed below.</span></p>` : ''}
      ${bad.length || warn.length ? html`<div class="scroll-x"><table class="table compact pm-imp-rows"><thead><tr><th class="num">Row</th><th>Title</th><th>What to fix</th></tr></thead><tbody>
        ${[...bad, ...warn].slice(0, 200).map((r) => html`<tr class="${r.errors.length ? 'pm-late' : ''}"><td class="num">Row ${r.row}</td><td>${r.title || html`<span class="muted">(no title)</span>`}</td><td>${[...r.errors, ...r.warnings].map((x) => html`<span class="pm-imp-msg ${r.errors.includes(x) ? 'bad' : ''}">${x}</span>`)}</td></tr>`)}
      </tbody></table></div>${bad.length + warn.length > 200 ? html`<p class="muted small">The first 200 rows with problems are listed.</p>` : ''}` : ''}
      <div class="actions pm-imp-actions"><button type="button" class="btn" id="imp-back">Back to the columns</button><span class="spacer"></span>${bad.length ? '' : html`<button type="button" class="btn primary" id="imp-go">Import ${plural(c.tasks, 'task')}</button>`}</div>`);
    box.querySelector('#imp-back').addEventListener('click', () => {
      step2();
      box.querySelectorAll('[data-map]').forEach((x) => (x.value = st.mapping[x.dataset.map] ?? ''));
      box.querySelector('#imp-ms').checked = st.createMs;
    });
    box.querySelector('#imp-go')?.addEventListener('click', guard(async (e) => {
      e.target.disabled = true;
      try {
        const r = await send(false);
        toast(`${plural(r.imported, 'task')} imported${r.milestones ? `, with ${plural(r.milestones, 'new milestone')}` : ''}.`);
        changed();
        close();
        await after?.();
      } finally {
        e.target.disabled = false;
      }
    }));
    (box.querySelector('#imp-go') || box.querySelector('#imp-back')).focus();
  };
  step1();
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
  let [t, m] = await Promise.all([api.get(`/api/pm/tasks/${id}`), meta()]);
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
        <div class="actions">${p.isTemplate ? '' : html`<button class="btn pm-watch ${t.watching ? 'on' : ''}" id="watch" aria-pressed="${t.watching ? 'true' : 'false'}" title="${t.watching ? 'You hear of its comments and when it is done or cancelled. Click to stop.' : 'Hear of its comments and when it is done or cancelled.'}">${icon('eye', 16)} ${t.watching ? 'Watching' : 'Watch'} <span class="pm-watch-n" aria-label="${plural(t.watcherList.length, 'watcher')}">${t.watcherList.length}</span></button>`}${work ? html`<button class="btn" id="edit">${icon('edit', 16)} Edit title and description</button>` : ''}${canDelete ? html`<button class="btn danger ghost" id="del">Delete</button>` : ''}</div>
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
          <section class="card" id="files-card"><div class="card-head"><h2>${icon('paperclip')} Files</h2><span class="muted small">${t.attachments.length ? `${t.attachments.length} of ${t.maxFiles}` : ''}</span></div>
            <div id="files">${fileBlock(t.attachments, `/api/pm/tasks/${t.id}/attachments`, work)}</div></section>
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
              <label class="field"><span>Size</span><select name="size" aria-describedby="size-hint" ${work ? '' : 'disabled'}>${sizeOptions(t.size, m.sizes)}</select></label>
              <small class="hint" id="size-hint">${t.size ? `${sizeName(t.size)}: ${sizeEffort(t.size, m.sizes)}. ` : ''}${sizeHint}${t.subtasks ? ' Its subtasks count instead of it.' : ''}</small>
              <label class="field"><span>Milestone</span><select name="milestoneId" ${work ? '' : 'disabled'}><option value="">${t.parentId && t.milestoneIdEffective ? 'As its parent' : 'None'}</option>${options(t.milestones.map((m) => [m.id, `${m.name} (${short(m.dueDate)})`]), t.milestoneId)}</select></label>
              ${t.subtasks ? '' : html`<label class="field"><span>Subtask of</span><select name="parentId" ${work ? '' : 'disabled'}><option value="">None (a task)</option>${options(t.others.filter((x) => !x.parentId).map((x) => [x.id, `${x.key} · ${x.title}`]), t.parentId)}</select></label>`}
            </form>
          </section>
          <section class="card"><h2>${icon('lock')} Blocked by</h2>
            ${t.blockedByList.length ? html`<ul class="crm-mini">${t.blockedByList.map((b) => html`<li><span class="grow"><a href="#/projects/${p.id}/tasks/${b.id}"><strong>${b.key}</strong> ${b.title}</a><small>${b.statusName}${b.category === 'done' ? ' · done' : ''}</small></span>${work ? html`<button type="button" class="icon-btn" data-unblock="${b.id}" aria-label="Not blocked by ${b.key}">${icon('x', 14)}</button>` : ''}</li>`)}</ul>` : html`<p class="muted small">Not waiting for another task.</p>`}
            ${work && blockedChoices.length ? html`<div class="crm-add-item"><select id="block-pick" aria-label="Task this one waits for"><option value="">Waits for…</option>${options(blockedChoices.map((x) => [x.id, `${x.key} · ${x.title}`]))}</select><button type="button" class="btn" id="block-add">Add</button></div>` : ''}
            ${t.blocking.length ? html`<p class="small muted">${t.blocking.map((b) => b.key).join(', ')} ${t.blocking.length === 1 ? 'waits' : 'wait'} for this task.</p>` : ''}
          </section>
          ${p.isTemplate ? '' : html`<section class="card"><h2>${icon('eye')} Watchers</h2>
            ${t.watcherList.length ? html`<ul class="pm-watchers">${t.watcherList.map((w) => html`<li>${avatar(w.name)}<span>${w.name}${w.userId === ctx.user.id ? ' (you)' : ''}</span></li>`)}</ul>` : html`<p class="muted small">Nobody is watching this task.</p>`}
            <p class="muted small">Watchers hear of comments and when the task is done or cancelled. Who added it, its assignee and whoever comments watch it.</p></section>`}
          ${t.ticket ? html`<section class="card"><h2>${icon('ticket')} Service desk ticket</h2><p>${can('helpdesk.agent') ? html`<a href="#/helpdesk/tickets/${t.ticket.id}" class="mono">${t.ticket.ref}</a>` : html`<span class="mono">${t.ticket.ref}</span>`} ${badge(t.ticket.statusName, ['resolved', 'closed'].includes(t.ticket.status) ? 'green' : 'blue')}</p><p class="muted small">Closing one does not close the other.</p></section>` : ''}
          ${t.time ? html`<section class="card"><div class="card-head"><h2>${icon('clock')} Time</h2><span class="muted small">${hrs(t.loggedHours)} logged</span></div>
            ${t.time.length ? html`<ul class="crm-mini">${t.time.slice(0, 8).map((x) => html`<li><span class="grow"><strong>${hrs(x.hours)}</strong> ${x.userName}<small>${fmtDate(x.date)}${x.note ? ` · ${x.note}` : ''}</small></span></li>`)}</ul>` : html`<p class="muted small">No time logged on this task.</p>`}
            ${work ? html`<form id="log" class="pm-log-mini"><input type="date" name="date" value="${today()}" max="${today()}" aria-label="Date" /><input type="number" name="hours" min="0.25" max="24" step="0.25" inputmode="decimal" placeholder="Hours" aria-label="Hours" />
              <input name="note" maxlength="500" placeholder="Note" aria-label="Note" /><button class="btn" type="submit">Log</button></form>
              <p class="muted small">Or a whole week at once on your <a href="#/projects/timesheet">Timesheet</a>.</p>` : ''}
          </section>` : ''}
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
      toast(r.warning || `${hrs(r.hours)} logged.`);
      await reload('#log [name=hours]');
    }, () => reload()));
    el.querySelector('#watch')?.addEventListener('click', guard(async () => {
      const r = await api.put(`/api/pm/tasks/${id}/watch`, { watching: !t.watching });
      toast(r.watching ? `You are watching ${t.key}.` : `You stopped watching ${t.key}.`);
      await reload('#watch');
    }, () => reload()));
    const filesBox = el.querySelector('#files');
    if (filesBox) wireFiles(filesBox, `/api/pm/tasks/${id}/attachments`, t.attachments, async () => reload('#files [data-add-file]'));
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
      if (!(await confirmDialog(`Delete ${t.key} ${t.title}?${t.subtasks ? ` Its ${plural(t.subtasks, 'subtask')} go with it.` : ''} Comments and files go too; time logged on it stays on the project.`, { title: 'Delete task' }))) return;
      await api.del(`/api/pm/tasks/${id}`).then(() => {
        toast('Task deleted.');
        changed();
        location.replace(`#/projects/${p.id}/board`);
      }, (err) => toast(err.message, 'error'));
    });
  }
  await render();
}

// ---------- Time tab (a project that tracks time) ----------
export async function projectTimeView(el, { id }) {
  const p = await loadProject(id);
  if (!p.timeTracking) {
    return mount(el, html`${projectHeader(p, 'time')}
      <div class="card empty">${icon('clock', 40)}<h2>This project does not track time</h2>
        <p>Its tasks have sizes, not hours. ${may(p.access, 'manage') ? html`To log hours on it (for time-and-materials work, or a client who asks for a timesheet), tick <strong>Track time on this project</strong> under <strong>Edit</strong> on the Overview.` : 'A project manager can turn time tracking on when the client needs hours.'}</p>
        <p><a class="btn" href="#/projects/${id}">Back to the overview</a></p></div>`);
  }
  const data = await api.get(`/api/pm/projects/${id}/time`);
  const work = may(p.access, 'work');
  const manage = may(p.access, 'manage');
  const flag = (x) => (x.overAttended ? html`<span class="crm-due warn" title="${x.dayTotal} h logged that day; ${x.attended} h in the DTR. For information only.">${icon('alert', 12)} More than attended (${x.attended} h)</span>` : '');
  const entryRow = (x) => html`<tr><td>${fmtDate(x.date)}</td><td>${x.userName}</td><td>${x.taskKey ? html`<a href="#/projects/${id}/tasks/${x.taskId}">${x.taskKey}</a> ${x.taskTitle}` : html`<span class="muted">Project work</span>`}${x.note ? html`<small>${x.note}</small>` : ''}</td><td class="num">${hrs(x.hours)}</td><td>${flag(x) || ''}</td>
    <td class="row-actions">${x.canDelete ? html`<button type="button" class="icon-btn danger" data-del="${x.id}" aria-label="Delete this entry">${icon('trash', 16)}</button>` : ''}</td></tr>`;
  const mineTotal = data.mine.reduce((n, x) => n + x.hours, 0);
  mount(el, html`
    ${projectHeader(p, 'time', work ? html`<a class="btn" href="#/projects/timesheet">${icon('calendar', 16)} My timesheet</a>` : '')}
    <div class="stats">
      <div class="card"><small>Logged</small><strong>${hrs(data.total)}</strong><span class="muted small">${data.budget ? `of a ${hrs(data.budget)} budget` : 'no budget in hours set'}</span>${data.budget ? html`<span class="progress ${data.total > data.budget ? 'over' : ''}"><i style="width:${Math.min(100, Math.round((data.total / data.budget) * 100))}%"></i></span>` : ''}</div>
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
            <div class="actions span-2"><small class="muted">Separate from attendance: a day with more hours here than in your DTR is only flagged.</small><span class="spacer"></span><button class="btn primary" type="submit">Log time</button></div>
          </form></section>` : ''}
        <section class="card scroll-x"><h2>${work ? 'My entries this week' : 'Entries'}</h2>
          ${(work ? data.mine : data.entries).length ? html`<table class="table"><thead><tr><th>Date</th><th>Who</th><th>Task</th><th class="num">Hours</th><th>Check</th><th></th></tr></thead><tbody>${(work ? data.mine : data.entries.slice(0, 50)).map(entryRow)}</tbody></table>` : html`<p class="muted pad">Nothing logged${work ? ' this week' : ''} yet.</p>`}
        </section>
        ${work && data.entries.length ? html`<section class="card scroll-x"><details><summary><h2>All entries (${data.entries.length})</h2></summary><table class="table"><thead><tr><th>Date</th><th>Who</th><th>Task</th><th class="num">Hours</th><th>Check</th><th></th></tr></thead><tbody>${data.entries.map(entryRow)}</tbody></table></details></section>` : ''}
      </div>
      <div class="stack">
        <section class="card scroll-x"><h2>By person</h2>${data.byPerson.length ? html`<table class="table"><thead><tr><th>Person</th><th class="num">Hours</th></tr></thead><tbody>${data.byPerson.map((x) => html`<tr><td>${manage && x.member ? html`<a href="#/projects/timesheet?user=${x.userId}" title="Open ${x.name}'s timesheet">${x.name}</a>` : x.name}</td><td class="num">${hrs(x.hours)}</td></tr>`)}</tbody></table>${manage ? html`<p class="muted small pad">Open a member's name for their weekly timesheet.</p>` : ''}` : html`<p class="muted pad">No time logged yet.</p>`}</section>
        <section class="card scroll-x"><h2>By task</h2>${data.byTask.length ? html`<table class="table"><thead><tr><th>Task</th><th>Size</th><th class="num">Logged</th></tr></thead><tbody>${data.byTask.map((x) => html`<tr><td><a href="#/projects/${id}/tasks/${x.taskId}">${x.title}</a><small class="mono">${x.key}</small></td><td>${sizeChip(x.size) || html`<span class="muted">—</span>`}</td><td class="num">${hrs(x.hours)}</td></tr>`)}</tbody></table>` : html`<p class="muted pad">No time logged on tasks yet.</p>`}</section>
      </div>
    </div>`);
  const reload = () => projectTimeView(el, { id });
  el.querySelector('#log')?.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const f = e.target;
    const r = await api.post(`/api/pm/projects/${id}/time`, { date: f.date.value, hours: f.hours.value, taskId: f.taskId.value || null, note: f.note.value });
    toast(r.warning || `${hrs(r.hours)} logged.`);
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
// "For you": what others did that concerns you, similar events on one line ("3 comments on …").
const NOTE_ICON = { assigned: 'user', mentioned: 'comment', commented: 'comment', status: 'checkCircle', added: 'userPlus' };
function noteLine(g) {
  const n = g.latest;
  const who = g.actors.length > 2 ? `${g.actors[0]} and ${g.actors.length - 1} others` : g.actors.join(' and ');
  const task = n.taskKey ? html`<span class="mono">${n.taskKey}</span> ${n.taskTitle}` : '';
  const many = g.count > 1;
  // Several tasks at once (a bulk change or an import): the text names them.
  const what = !n.taskId && (g.kind === 'assigned' || g.kind === 'status') ? html`${who} ${n.text}` : {
    assigned: many ? html`${who} assigned you ${task} (${g.count} times)` : html`${who} assigned you ${task}`,
    mentioned: many ? html`${g.count} mentions of you on ${task}` : html`${who} mentioned you on ${task}`,
    commented: many ? html`${g.count} comments on ${task}` : html`${who} commented on ${task}`,
    status: html`${who} moved ${task} to ${/ to (.+)$/.exec(n.text)?.[1] || 'done'}`,
    added: html`${who} added you to ${n.projectName}`,
  }[g.kind] || n.text;
  const quote = /[:]\s(“.*)$/.exec(n.text)?.[1];
  const href = n.taskId ? `#/projects/${n.projectId}/tasks/${n.taskId}` : `#/projects/${n.projectId}`;
  return html`<li class="pm-note ${g.unread ? 'unread' : ''}">
    <span class="pm-note-ic" aria-hidden="true">${icon(NOTE_ICON[g.kind] || 'activity', 16)}</span>
    <span class="grow"><a href="${href}" data-open="${g.ids.join(',')}">${g.unread ? html`<span class="sr-only">Unread: </span>` : ''}${what}</a>
      <small>${quote && g.kind !== 'status' ? html`${quote} · ` : ''}${many && who && g.kind !== 'assigned' ? `${who} · ` : ''}<span class="mono">${n.projectCode}</span> · ${when(n.at)}</small></span>
    ${g.unread ? html`<button type="button" class="icon-btn pm-note-read" data-read="${g.ids.join(',')}" aria-label="Mark as read" title="Mark as read">${icon('check', 16)}</button>` : ''}
  </li>`;
}

// The daily digest as it would be emailed today, and "Email me a daily digest".
function digestCard(dg) {
  const e = dg.email;
  const line = (t) => html`<li><a href="#/projects/${t.projectId}/tasks/${t.id}"><span class="mono">${t.key}</span> ${t.title}</a><small>${t.projectName} · ${t.dueDate === dg.today ? 'due today' : `due ${fmtDate(t.dueDate)}`}</small></li>`;
  const part = (title, list, item) => (list.length ? html`<h3>${title} <span class="muted small">${list.length}</span></h3><ul class="pm-digest-list">${list.slice(0, DIGEST_MAX).map(item)}</ul>${list.length > DIGEST_MAX ? html`<p class="muted small">and ${list.length - DIGEST_MAX} more</p>` : ''}` : '');
  const status = e.emailing ? `Emailed at ${e.time} ${e.workingDaysOnly ? 'on working days' : 'every day'} to ${e.address}, when there is something in it.` : e.reason;
  return html`<section class="card pm-digest" aria-labelledby="digest-h">
    <div class="card-head"><h2 id="digest-h">${icon('mail')} Daily digest</h2>
      <label class="check pm-digest-pref"><input type="checkbox" id="digest-pref" ${e.preference ? 'checked' : ''} aria-describedby="digest-status" /><span>Email me a daily digest</span></label></div>
    <p class="muted small" id="digest-status">${status}</p>
    ${dg.empty ? html`<p class="small">Nothing today: no task of yours overdue or due within 3 working days, no milestone at risk, and nothing unread.</p>` : html`
    <ul class="pm-digest-sum">
      <li class="${dg.overdue.length ? 'is-bad' : ''}"><strong>${dg.overdue.length}</strong> overdue</li>
      <li class="${dg.dueSoon.length ? 'is-warn' : ''}"><strong>${dg.dueSoon.length}</strong> due within 3 working days</li>
      <li class="${dg.atRisk.length ? 'is-warn' : ''}"><strong>${dg.atRisk.length}</strong> ${dg.atRisk.length === 1 ? 'milestone' : 'milestones'} at risk in projects you manage</li>
      <li><strong>${dg.unread}</strong> unread for you</li></ul>
    <details class="pm-digest-more"><summary>Show today's digest</summary>
      ${part('Overdue', dg.overdue, line)}
      ${part('Due in the next 3 working days', dg.dueSoon, line)}
      ${part('Milestones at risk in projects you manage', dg.atRisk, (m) => html`<li><a href="#/projects/${m.projectId}">${m.name}</a><small><span class="mono">${m.projectCode}</span> ${m.projectName} · ${HEALTH[m.value]} · due ${fmtDate(m.dueDate)}${m.reason ? ` · ${m.reason}` : ''}</small></li>`)}
    </details>`}
  </section>`;
}

export async function myWorkView(el, _params, query = {}) {
  const [g, notes, dg] = await Promise.all([
    can('pm.view') || ctx.user.inProjects ? api.get('/api/pm/my-work') : { overdue: [], today: [], week: [], later: [], none: [] },
    api.get('/api/pm/notifications').catch(() => ({ unread: 0, items: [] })),
    api.get('/api/pm/digest').catch(() => null),
  ]);
  const total = Object.values(g).reduce((n, l) => n + l.length, 0);
  const groups = groupNotifications(notes.items);
  const SHOW = 12;
  const all = query.notes === 'all';
  const row = (t) => html`<li class="${t.overdue ? 'pm-late' : ''}">
      <span class="grow"><a href="#/projects/${t.project.id}/tasks/${t.id}"><strong>${t.title}</strong></a>
        <small><span class="mono">${t.key}</span> · <a href="#/projects/${t.project.id}">${t.project.name}</a>${t.blocked ? ' · blocked' : ''}${t.checklist.length ? ` · ${t.checklistDone}/${t.checklist.length} checked` : ''}</small></span>
      ${dueChip(t)}
      ${may(t.access, 'work') ? html`<select data-status="${t.id}" aria-label="Status of ${t.key}">${options(t.project.statuses.map((s) => [s.id, s.name]), t.statusId)}</select>` : statusChip(t.project.statuses.find((s) => s.id === t.statusId))}
    </li>`;
  mount(el, html`
    ${head('My work', total ? `${plural(total, 'open task')} assigned to you, across your projects.` : 'Tasks assigned to you, across your projects.', total ? densitySwitch(false) : '')}
    <section class="card pm-foryou" aria-labelledby="foryou-h">
      <div class="card-head"><h2 id="foryou-h">${icon('inbox')} For you ${notes.unread ? html`<span class="badge blue">${notes.unread} unread</span>` : ''}</h2>
        ${notes.unread ? html`<button type="button" class="btn small-btn" id="read-all">Mark all read</button>` : ''}</div>
      ${groups.length ? html`<ul class="pm-notes">${(all ? groups : groups.slice(0, SHOW)).map(noteLine)}</ul>
        ${!all && groups.length > SHOW ? html`<p class="pm-notes-more"><a href="#/projects/my-work?notes=all">Show all ${groups.length}</a></p>` : ''}`
        : html`<p class="muted small">Nothing yet. When someone assigns you a task, mentions you, comments on a task of yours or one you watch, finishes or cancels it, or adds you to a project, it shows here.</p>`}
    </section>
    ${dg ? digestCard(dg) : ''}
    ${total ? Object.entries(MY_WORK_GROUPS).filter(([k]) => g[k].length).map(([k, label]) => html`<section class="card pm-mywork ${k}">
        <div class="card-head"><h2>${k === 'overdue' ? icon('alert') : icon('calendar')} ${label} <span class="muted small">${g[k].length}</span></h2></div>
        <ul class="crm-mini">${g[k].map(row)}</ul></section>`)
      : html`<div class="card empty">${icon('task', 40)}<h2>Nothing assigned to you</h2><p>Tasks assigned to you in any project show here, soonest first.</p>${can('pm.view') || ctx.user.inProjects ? html`<p><a class="btn" href="#/projects">Open the projects</a></p>` : ''}</div>`}`);
  wireDensity(el);
  el.querySelectorAll('[data-status]').forEach((s) => s.addEventListener('change', guard(async () => {
    const t = Object.values(g).flat().find((x) => x.id === s.dataset.status);
    const r = await api.put(`/api/pm/tasks/${t.id}/move`, { statusId: s.value });
    toast(`${t.key}: ${r.statusName}.`);
    changed();
    await myWorkView(el, _params, query);
    el.querySelector(`[data-status="${t.id}"]`)?.focus();
  }, () => myWorkView(el, _params, query))));
  el.querySelector('#digest-pref')?.addEventListener('change', guard(async (e) => {
    const r = await api.put('/api/pm/digest/preference', { email: e.target.checked });
    toast(r.preference ? 'You will get the daily digest by email.' : 'No more digest emails. It stays here on My work.');
    el.querySelector('#digest-status').textContent = r.emailing ? `Emailed at ${r.time} ${r.workingDaysOnly ? 'on working days' : 'every day'} to ${r.address}, when there is something in it.` : r.reason;
  }, () => myWorkView(el, _params, query)));
  const markRead = (body) => api.put('/api/pm/notifications/read', body).then(() => changed());
  el.querySelector('#read-all')?.addEventListener('click', guard(async () => {
    await markRead({ all: true });
    toast('All marked as read.');
    await myWorkView(el, _params, query);
    el.querySelector('#foryou-h')?.closest('section')?.querySelector('a, button')?.focus();
  }));
  el.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', guard(async () => {
    const next = b.closest('li')?.nextElementSibling?.querySelector('[data-read]')?.dataset.read;
    await markRead({ ids: b.dataset.read.split(',') });
    await myWorkView(el, _params, query);
    (next && el.querySelector(`[data-read="${next}"]`) || el.querySelector('#read-all') || el.querySelector('.pm-notes a'))?.focus();
  })));
  // Opening one marks it read on the way.
  el.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => {
    if (!a.closest('.unread') || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    markRead({ ids: a.dataset.open.split(',') }).catch(() => {}).finally(() => (location.hash = a.getAttribute('href')));
  }));
}

// ---------- Timesheet ----------
// Your hours on the projects that track time, a week at a time: a row per project (and task, if you
// pick one), Monday to Sunday, in quarter hours. Saving writes one entry per project, task and day.
// It is not attendance: your DTR's hours are shown under it for comparison only, nothing is taken
// from them, and a day with more project hours than clocked in is flagged, never refused. A project
// manager opens their members' timesheets (read only) from the person list or the Time tab.
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const num = (n) => String(Math.round((Number(n) || 0) * 100) / 100);
export async function timesheetView(el, _params, query) {
  const week = weekStart(ymd(query.week) || today());
  const who = String(query.user || '');
  const data = await api.get(`/api/pm/timesheet?week=${week}${who ? `&user=${encodeURIComponent(who)}` : ''}`);
  const edit = data.editable;
  const t0 = data.today;
  const projectOf = (id) => data.projects.find((x) => x.id === id);
  const taskOf = (r) => projectOf(r.projectId)?.tasks.find((x) => x.id === r.taskId);
  // The rows as on screen, and the hours as loaded (to send only what changed).
  const rows = data.rows.map((r) => ({ projectId: r.projectId, taskId: r.taskId, hours: [...r.hours], notes: r.notes }));
  const keyOf = (projectId, taskId, i) => `${projectId}|${taskId || ''}|${data.days[i]}`;
  const loaded = new Map(data.rows.flatMap((r) => r.hours.map((h, i) => [keyOf(r.projectId, r.taskId, i), h])));
  const current = () => {
    const m = new Map();
    for (const r of rows) r.hours.forEach((h, i) => m.set(keyOf(r.projectId, r.taskId, i), (m.get(keyOf(r.projectId, r.taskId, i)) || 0) + (Number(h) || 0)));
    return m;
  };
  const changes = () => {
    const now = current();
    const out = [];
    for (const k of new Set([...loaded.keys(), ...now.keys()])) {
      if (Math.abs((loaded.get(k) || 0) - (now.get(k) || 0)) < 1e-9) continue;
      const [projectId, taskId, date] = k.split('|');
      out.push({ projectId, taskId: taskId || null, date, hours: now.get(k) || 0 });
    }
    return out;
  };
  const range = `${fmtDate(data.days[0], { month: 'short', day: 'numeric' })} – ${fmtDate(data.days[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const who2 = data.self ? 'Your' : `${data.user.name}'s`;
  const taskSelect = (r, i) => {
    const p = projectOf(r.projectId);
    const taken = rows.filter((x, j) => j !== i && x.projectId === r.projectId).map((x) => x.taskId || '');
    return html`<select data-task="${i}" aria-label="Task for this row of ${p.code}"><option value="" ${taken.includes('') ? 'disabled' : ''}>No task (project work)</option>${p.tasks.map((t) => html`<option value="${t.id}" ${r.taskId === t.id ? 'selected' : ''} ${taken.includes(t.id) ? 'disabled' : ''}>${t.title}${t.size ? ` (${t.size})` : ''} · ${t.key}</option>`)}</select>`;
  };
  const rowHead = (r, i) => {
    const p = projectOf(r.projectId);
    const t = taskOf(r);
    return html`<th scope="row"><span class="pm-ts-proj"><span class="mono">${p.code}</span> ${p.name}</span>
      ${edit ? taskSelect(r, i) : html`<span class="pm-ts-task">${t ? html`<a href="#/projects/${p.id}/tasks/${t.id}">${t.key}</a> ${t.title}` : html`<span class="muted">No task (project work)</span>`}</span>`}
      ${r.notes?.length ? html`<small class="muted" title="${r.notes.join('; ')}">${r.notes[0]}${r.notes.length > 1 ? ` and ${r.notes.length - 1} more` : ''}</small>` : ''}</th>`;
  };
  const cell = (r, i, j) => {
    const d = data.days[j];
    const label = `Hours on ${projectOf(r.projectId).code}${taskOf(r) ? ` ${taskOf(r).key}` : ', no task'}, ${DAY_LONG[j]} ${fmtDate(d, { month: 'short', day: 'numeric' })}`;
    if (!edit) return html`<td class="num">${r.hours[j] ? num(r.hours[j]) : html`<span class="muted">·</span>`}</td>`;
    return html`<td class="num"><input type="number" min="0" max="24" step="0.25" inputmode="decimal" data-r="${i}" data-d="${j}" value="${r.hours[j] ? num(r.hours[j]) : ''}" aria-label="${label}" ${d > t0 ? 'disabled title="Time can be logged for today or earlier."' : ''} /></td>`;
  };
  // Phones: one day at a time (the day picker), the same rows and the same saving.
  let day = defaultDay(data.days, t0, query.day ?? null);
  const phoneDay = (byProject, totals, total) => {
    const d = data.days[day];
    const input = (r, i) => {
      const label = `Hours on ${projectOf(r.projectId).code}${taskOf(r) ? ` ${taskOf(r).key}` : ', no task'}, ${DAY_LONG[day]} ${short(d)}`;
      if (!edit) return html`<span class="num"><b>${r.hours[day] ? num(r.hours[day]) : '0'}</b> h</span>`;
      return html`<label class="field"><span class="small muted">Hours</span><input type="number" min="0" max="24" step="0.25" inputmode="decimal" data-r="${i}" data-d="${day}" value="${r.hours[day] ? num(r.hours[day]) : ''}" aria-label="${label}" ${d > t0 ? 'disabled title="Time can be logged for today or earlier."' : ''} /></label>`;
    };
    const dtr = data.attendance?.[day];
    return html`<div class="pm-ts-phone">
      <div class="pm-ts-days" role="tablist" aria-label="Day of the week">${data.days.map((x, j) => html`<button type="button" role="tab" id="ts-day-${j}" data-day="${j}" aria-selected="${j === day ? 'true' : 'false'}" aria-controls="ts-day-panel" tabindex="${j === day ? '0' : '-1'}"
        class="${x === t0 ? 'today' : ''} ${totals[j] > data.maxDay ? 'bad' : ''}" aria-label="${DAY_LONG[j]} ${short(x)}: ${num(totals[j])} hours">${DAY_NAMES[j]}<small>${fmtDate(x, { day: 'numeric' })}</small><b>${totals[j] ? num(totals[j]) : '·'}</b></button>`)}</div>
      <div id="ts-day-panel" role="tabpanel" aria-labelledby="ts-day-${day}">
        <div class="pm-ts-dayhead"><h2>${DAY_LONG[day]}, ${short(d)}</h2><span class="muted small">Week: ${num(total)} h</span></div>
        <ul class="pm-ts-rows">${byProject.map(({ p, list }) => html`${list.map(({ r, i }) => {
          const t = taskOf(r);
          return html`<li><div class="pm-ts-row-head"><span class="pm-ts-proj"><span class="mono">${p.code}</span> ${p.name}</span>
            ${edit ? taskSelect(r, i) : html`<span class="pm-ts-task">${t ? html`<a href="#/projects/${p.id}/tasks/${t.id}">${t.key}</a> ${t.title}` : html`<span class="muted">No task (project work)</span>`}</span>`}
            <small>Week: ${num(r.hours.reduce((n, h) => n + (Number(h) || 0), 0))} h</small></div>${input(r, i)}</li>`;
        })}${edit && list.length <= p.tasks.length ? html`<li class="pm-ts-add-row"><button type="button" class="link" data-add="${p.id}">${icon('plus', 14)} Another task on ${p.code}</button></li>` : ''}`)}</ul>
        <p class="pm-ts-phone-total ${totals[day] > data.maxDay ? 'bad' : ''}"><span>Total, ${DAY_NAMES[day]}</span><b>${num(totals[day])} h</b></p>
        ${data.attendance ? html`<p class="muted small">Clocked in (DTR) that day: ${dtr === null || dtr === undefined ? 'nothing to compare' : `${num(dtr)} h`}. For comparison only.</p>` : ''}
      </div></div>`;
  };
  // After a redraw, focus goes back to the same control in the layout that is showing.
  const refocus = (selector) => [...el.querySelectorAll(selector)].find((x) => x.offsetParent !== null)?.focus();
  function draw() {
    const { days: totals, week: total } = dayTotals(rows, data.days.length);
    const byProject = data.projects.map((p) => ({ p, list: rows.map((r, i) => ({ r, i })).filter((x) => x.r.projectId === p.id) }));
    mount(el.querySelector('#ts'), data.projects.length ? html`<div class="scroll-x pm-ts-scroll"><table class="table no-stack pm-ts">
      <thead><tr><th scope="col">Project and task</th>${data.days.map((d, j) => html`<th scope="col" class="num ${d === t0 ? 'pm-ts-today' : ''}">${DAY_NAMES[j]}<small>${short(d)}</small></th>`)}<th scope="col" class="num">Total</th></tr></thead>
      ${byProject.map(({ p, list }) => html`<tbody>${list.map(({ r, i }) => html`<tr>${rowHead(r, i)}${data.days.map((_, j) => cell(r, i, j))}<td class="num"><b>${num(r.hours.reduce((n, h) => n + (Number(h) || 0), 0))}</b></td></tr>`)}
        ${edit && list.length <= p.tasks.length ? html`<tr class="pm-ts-add"><td colspan="9"><button type="button" class="link" data-add="${p.id}">${icon('plus', 14)} Another task on ${p.code}</button></td></tr>` : ''}</tbody>`)}
      <tfoot><tr class="pm-ts-total"><th scope="row">Total</th>${totals.map((h, j) => html`<td class="num ${h > data.maxDay ? 'bad' : ''}"><b>${h ? num(h) : '0'}</b></td>`)}<td class="num"><b>${num(total)}</b></td></tr>
        ${data.attendance ? html`<tr class="pm-ts-dtr"><th scope="row">Clocked in (DTR)<small>For comparison only</small></th>${data.attendance.map((h, j) => {
          const over = h !== null && totals[j] > h + 1e-9;
          return html`<td class="num">${h === null ? html`<span class="muted" title="No attendance to compare: no employee record, or still clocked in">—</span>` : num(h)}${over ? html`<span class="pm-ts-over" title="More project hours (${num(totals[j])}) than clocked in (${num(h)}). For information only.">${icon('alert', 12)}<span class="sr-only">More project hours than clocked in</span></span>` : ''}</td>`;
        })}<td></td></tr>` : ''}</tfoot>
    </table></div>${phoneDay(byProject, totals, total)}` : html`<div class="empty"><p>${data.self ? `You are not a member of a project that tracks time, so there is nothing to fill in. ${others.length ? 'Pick a member under Timesheet of to see their hours.' : 'A project manager turns time tracking on for a project under Edit.'}` : 'No project that tracks time.'}</p></div>`);
    const n = changes().length;
    const st = el.querySelector('#ts-status');
    if (st) st.textContent = n ? `${plural(n, 'change')} not saved yet` : 'All saved';
    const save = el.querySelector('#ts-save');
    if (save) save.disabled = !n;
    wire();
  }
  function wire() {
    el.querySelectorAll('#ts input[data-r]').forEach((inp) => inp.addEventListener('change', () => {
      const v = inp.value.trim();
      const h = v === '' ? 0 : Number(v);
      if (!Number.isFinite(h) || h < 0 || h > 24) {
        toast('Enter hours from 0 to 24, in quarter hours (0.25, 0.5, 0.75…).', 'error');
        inp.value = rows[Number(inp.dataset.r)].hours[Number(inp.dataset.d)] || '';
        return;
      }
      rows[Number(inp.dataset.r)].hours[Number(inp.dataset.d)] = Math.round(h * 4) / 4;
      const focus = `[data-r="${inp.dataset.r}"][data-d="${inp.dataset.d}"]`;
      draw();
      refocus(focus);
    }));
    el.querySelectorAll('[data-task]').forEach((sel) => sel.addEventListener('change', () => {
      rows[Number(sel.dataset.task)].taskId = sel.value || null;
      draw();
      refocus(`[data-task="${sel.dataset.task}"]`);
    }));
    el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
      const p = projectOf(b.dataset.add);
      const taken = rows.filter((r) => r.projectId === p.id).map((r) => r.taskId || '');
      const free = taken.includes('') ? p.tasks.find((t) => !taken.includes(t.id))?.id : '';
      if (free === undefined) return;
      const at = rows.map((r) => r.projectId).lastIndexOf(p.id) + 1;
      rows.splice(at, 0, { projectId: p.id, taskId: free || null, hours: data.days.map(() => 0), notes: [] });
      draw();
      refocus(`[data-task="${at}"]`);
    }));
    // The day picker: a tab per day; arrow keys move between days.
    el.querySelectorAll('[data-day]').forEach((b) => {
      b.addEventListener('click', () => {
        day = Number(b.dataset.day);
        draw();
        refocus(`[data-day="${day}"]`);
      });
      b.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1, Home: -day, End: data.days.length - 1 - day }[e.key];
        if (step === undefined) return;
        e.preventDefault();
        day = (day + step + data.days.length) % data.days.length;
        draw();
        refocus(`[data-day="${day}"]`);
      });
    });
  }
  const go = async (q) => {
    if (changes().length && !(await confirmDialog('You have hours not saved yet. Leave this week without saving them?', { title: 'Unsaved hours', confirmLabel: 'Leave without saving' }))) return;
    location.hash = `#/projects/timesheet?${new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString()}`;
  };
  // Managers who are not on a project that tracks time still pick themselves first.
  const others = data.people.filter((x) => !x.self);
  const people = data.people.some((x) => x.self) ? data.people : [{ id: ctx.user.id, name: ctx.user.name, self: true }, ...data.people];
  mount(el, html`
    ${head('Timesheet', data.self ? 'Your hours on the projects that track time, a week at a time. It is separate from attendance: the DTR is for pay; this is what each project took.' : `${data.user.name}'s hours on the projects you manage that track time. Read only: only they change their own hours.`)}
    <div class="toolbar pm-ts-bar">
      <button type="button" class="btn" id="prev" aria-label="Previous week">${icon('chevronLeft', 16)} <span class="pm-hide-phone">Previous</span></button>
      <strong class="pm-ts-range">${range} <small class="muted">W${isoWeek(week)}</small></strong>
      <button type="button" class="btn" id="next" aria-label="Next week"><span class="pm-hide-phone">Next</span> ${icon('chevronRight', 16)}</button>
      ${week !== weekStart(t0) ? html`<button type="button" class="btn" id="this">This week</button>` : ''}
      <span class="spacer"></span>
      ${others.length ? html`<label class="field inline pm-ts-who"><span>Timesheet of</span><select id="who">${options(people.map((x) => [x.self ? '' : x.id, x.self ? `${x.name} (you)` : x.name]), data.self ? '' : data.user.id)}</select></label>` : ''}
    </div>
    <section class="card pm-ts-card" id="ts"></section>
    ${edit && data.projects.length ? html`<div class="pm-ts-save"><span class="muted small" id="ts-status" aria-live="polite"></span><button type="button" class="btn primary" id="ts-save" disabled>Save timesheet</button></div>` : ''}
    <p class="muted small pm-ts-note">${icon('help', 14)} Quarter hours, today or earlier, at most 24 hours a day across projects. ${data.attendance && data.projects.length ? `The Clocked in (DTR) row is ${data.self ? 'your' : 'their'} attendance, shown for comparison only: nothing is filled in from it, and a day with more project hours than clocked in is only flagged.` : ''} Only projects that track time are here; the others use sizes, not hours.</p>`);
  draw();
  el.querySelector('#prev').addEventListener('click', () => go({ week: addDays(week, -7), user: data.self ? '' : data.user.id }));
  el.querySelector('#next').addEventListener('click', () => go({ week: addDays(week, 7), user: data.self ? '' : data.user.id }));
  el.querySelector('#this')?.addEventListener('click', () => go({ user: data.self ? '' : data.user.id }));
  el.querySelector('#who')?.addEventListener('change', (e) => go({ week, user: e.target.value }));
  el.querySelector('#ts-save')?.addEventListener('click', guard(async (e) => {
    const cells = changes();
    if (!cells.length) return;
    e.target.disabled = true;
    const r = await api.put('/api/pm/timesheet', { week, cells });
    toast(r.warnings?.length ? r.warnings.join(' ') : `Timesheet saved: ${plural(r.saved, 'change')}.`);
    changed();
    await timesheetView(el, _params, query);
    el.querySelector('#ts-save')?.focus();
  }, () => timesheetView(el, _params, query)));
}

// ---------- Projects setup ----------
export async function pmSettingsView(el, _params, query) {
  const TABS_SET = { statuses: 'Default statuses', types: 'Project types', sizes: 'Effort sizes', digest: 'Daily digest', ...(can('users.manage') ? { access: 'Team access' } : {}) };
  const tab = TABS_SET[query.tab] ? query.tab : 'statuses';
  const s = await api.get('/api/pm/settings');
  mount(el, html`
    ${head('Projects setup', 'How new projects start (the statuses of their board and the project types), what the effort sizes mean, and the daily digest email.')}
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
  } else if (tab === 'sizes') {
    mount(pane, html`<form id="f"><h2>Effort sizes</h2>
      <p class="muted small">Every task can have a size instead of an hour estimate: a rough idea of the effort that nobody has to defend to the hour. The size weighs the task in progress and the burn-up (when at least 60% of the tasks have one) You can reword what each size means for your teams; the sizes and their weights stay as they are, so reports compare across projects.</p>
      <div class="scroll-x"><table class="table compact no-stack pm-size-table"><thead><tr><th>Size</th><th>What it means</th><th class="num">Weight</th></tr></thead>
        <tbody>${SIZE_KEYS.map((k) => html`<tr><td>${sizeChip(k, s.sizes)} <strong>${SIZES[k].label}</strong></td><td><input name="${k}" value="${s.sizes[k]}" maxlength="60" required aria-label="What ${sizeName(k)} means" /></td><td class="num">${SIZES[k].weight}</td></tr>`)}</tbody></table></div>
      <div class="actions end"><button type="button" class="btn ghost" id="sizes-reset">Use the built-in wording</button><button class="btn primary" type="submit">Save sizes</button></div></form>`);
    const f = pane.querySelector('#f');
    pane.querySelector('#sizes-reset').addEventListener('click', () => SIZE_KEYS.forEach((k) => (f.elements[k].value = SIZES[k].effort)));
    f.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      await api.put('/api/pm/settings', { statuses: s.statuses, types: s.types, sizes: Object.fromEntries(SIZE_KEYS.map((k) => [k, f.elements[k].value])) });
      metaCache = null;
      toast('Effort sizes saved.');
      reload();
    }, reload));
  } else if (tab === 'digest') {
    const g = s.digest;
    const last = g.lastRun;
    mount(pane, html`<form id="f"><h2>Daily digest email</h2>
      <p class="muted small">One email a day to each person, only when there is something in it: their overdue tasks, tasks due within 3 working days, milestones at risk in the projects they manage, and how many For you notifications they have not read. It lists only projects the person can open. Everyone can turn it off for themselves on My work, where the same digest is shown.</p>
      ${g.canEmail ? html`<p class="notice ok small">${icon('checkCircle', 16)} <span>Sent through the Service Desk's outgoing email.</span></p>`
        : html`<p class="notice small">${icon('alert', 16)} <span>CORE has no outgoing email set up, so no digest is emailed: people see it on My work. ${can('helpdesk.manage') ? html`Set it up under <a href="#/helpdesk/settings">Service desk settings</a> (sending email).` : 'An administrator sets it up under Service desk settings (sending email).'}</span></p>`}
      <label class="field check"><input type="checkbox" name="enabled" ${g.enabled ? 'checked' : ''} /><span>Email the daily digest</span></label>
      <div class="grid two">
        <label class="field"><span>Send at</span><input type="time" name="time" value="${g.time}" required /><small class="hint">This server's local time (Philippine time on a server set up for the Philippines).</small></label>
      </div>
      <label class="field check"><input type="checkbox" name="workingDaysOnly" ${g.workingDaysOnly ? 'checked' : ''} /><span>Working days only (no weekends or holidays on CORE's calendar)</span></label>
      <p class="muted small">${g.links ? html`Links in the email open CORE at <span class="mono">${g.origin}</span>, the address this page was saved from.` : 'Links in the email open CORE at the address this page is saved from. Save it from the address people use (not localhost) to include them; without one, the email has no links.'}
        If CORE was off at the time, the digest goes when it starts again that day, never twice.</p>
      ${last ? html`<p class="muted small">Last sent ${when(last.at)}: ${plural(last.sent, 'email')}${last.failed ? html`, <span class="crm-due bad">${last.failed} not sent (${last.error || 'the mail server refused'})</span>` : ''}.</p>` : ''}
      <div class="actions end"><button class="btn primary" type="submit">Save</button></div></form>`);
    pane.querySelector('#f').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const f = e.target;
      await api.put('/api/pm/settings/digest', { enabled: f.enabled.checked, time: f.time.value, workingDaysOnly: f.workingDaysOnly.checked });
      toast('Daily digest saved.');
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
