// Project Management: statuses, labels and the calculations behind progress, health, board
// order and workload. Shared by the server (validation, reports) and the browser (labels,
// badges), so no Node or DOM APIs here. Everything computed here is worked out when it is read,
// never stored.
//
// A project has milestones (some are contract deliverables) and tasks. Each task has a status
// from the project's own list; every status belongs to one of four fixed categories, which is
// what progress, "overdue" and the reports go by. Subtasks are one level deep.

import { TICKET_PRIORITY } from './helpdesk.js';
import { isDayOff } from './holidays.js';

export const PROJECT_STATUS = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled' };
export const OPEN_PROJECT = ['planning', 'active', 'on_hold'];
export const CATEGORIES = { todo: 'To do', active: 'In progress', done: 'Done', cancelled: 'Cancelled' };
export const OPEN_CATEGORY = ['todo', 'active'];
export const PRIORITY = TICKET_PRIORITY; // low, normal, high, urgent: the same words as the Service Desk
export const MEMBER_ROLES = { manager: 'Manager', member: 'Member', viewer: 'Viewer' };
export const HEALTH = { green: 'On track', amber: 'At risk', red: 'Off track' };
// Colours a status can have: names, drawn from the theme's tokens (never a raw CSS value).
export const STATUS_COLORS = { gray: 'Grey', blue: 'Blue', teal: 'Teal', amber: 'Amber', violet: 'Violet', green: 'Green', red: 'Red' };

export const DEFAULT_STATUSES = [
  { id: 'todo', name: 'To do', category: 'todo', color: 'gray' },
  { id: 'doing', name: 'In progress', category: 'active', color: 'blue' },
  { id: 'waiting', name: 'Waiting on client', category: 'active', color: 'amber' },
  { id: 'review', name: 'For review', category: 'active', color: 'violet' },
  { id: 'done', name: 'Done', category: 'done', color: 'green' },
  { id: 'cancelled', name: 'Cancelled', category: 'cancelled', color: 'gray' },
];
export const DEFAULT_TYPES = ['Client', 'Government', 'Internal'];
export const DEFAULT_PM = { statuses: DEFAULT_STATUSES, types: DEFAULT_TYPES };

export const HOURS_PER_DAY = 8; // capacity of a working day, unless the person's schedule says otherwise
export const DUE_SOON_DAYS = 3; // working days
export const BEHIND_POINTS = 15; // progress this far below the expected line makes a milestone at risk
export const ESTIMATE_SHARE = 0.6; // weigh progress by hours when this share of tasks has an estimate

// ---------- Dates (local YYYY-MM-DD strings, counted in whole days) ----------
const utc = (ymd) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
export const addDays = (ymd, n) => new Date(utc(ymd) + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / 86400000);
export const weekday = (ymd) => new Date(utc(ymd)).getUTCDay();
// The Monday of the ISO week a date is in: the key of that week.
export const weekStart = (ymd) => addDays(ymd, -((weekday(ymd) + 6) % 7));
// ISO week number (weeks start on Monday; week 1 holds the year's first Thursday).
export function isoWeek(ymd) {
  const thursday = addDays(weekStart(ymd), 3);
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(daysBetween(jan1, thursday) / 7) + 1;
}

// The company's working days: the week days of the default schedule, minus holidays that are
// days off (regular holidays and special non-working days on CORE's holiday calendar).
export function workCalendar(settings = {}, holidays = []) {
  const workDays = Array.isArray(settings.schedule?.workDays) && settings.schedule.workDays.length ? settings.schedule.workDays.map(Number) : [1, 2, 3, 4, 5];
  return { workDays, off: new Set(holidays.filter(isDayOff).map((h) => h.date)) };
}
export const isWorkDay = (ymd, cal) => cal.workDays.includes(weekday(ymd)) && !cal.off.has(ymd);
// Working days after `from` up to and including `to` (0 when `to` is not after `from`).
export function workDaysBetween(from, to, cal) {
  let n = 0;
  for (let d = addDays(from, 1), i = 0; d <= to && i < 3700; d = addDays(d, 1), i++) if (isWorkDay(d, cal)) n++;
  return n;
}
// Working days from `from` to `to`, both included.
export function workDatesIn(from, to, cal) {
  const out = [];
  for (let d = from, i = 0; d <= to && i < 3700; d = addDays(d, 1), i++) if (isWorkDay(d, cal)) out.push(d);
  return out;
}
// The date `n` working days after `ymd` (before it when n is negative); `ymd` itself when n is 0.
export function addWorkDays(ymd, n, cal) {
  let d = ymd;
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(n), i = 0; left > 0 && i < 3700; i++) {
    d = addDays(d, step);
    if (isWorkDay(d, cal)) left--;
  }
  return d;
}
// A date moved with its project: it keeps its place in working days from the old start, counted
// from the new start (a date on a weekend or holiday lands on the working day before it).
export function shiftWorkDays(ymd, oldStart, newStart, cal) {
  if (!ymd) return null;
  const n = ymd >= oldStart ? workDaysBetween(oldStart, ymd, cal) : -workDaysBetween(ymd, oldStart, cal);
  return addWorkDays(newStart, n, cal);
}

// ---------- Statuses and tasks ----------
export const statusOf = (project, statusId) => project.statuses.find((s) => s.id === statusId) || null;
export const categoryOf = (project, task) => statusOf(project, task.statusId)?.category || 'todo';
export const isOpenCategory = (cat) => cat === 'todo' || cat === 'active';
export const firstStatus = (statuses, category) => statuses.find((s) => s.category === category) || null;

// Rules for a project's list of statuses (the board's columns). Returns the first problem, or null.
export function statusSetProblem(statuses) {
  if (!Array.isArray(statuses) || statuses.length < 2) return 'Keep at least two statuses.';
  if (statuses.length > 12) return 'A project can have at most 12 statuses.';
  if (!statuses.some((s) => s.category === 'todo')) return 'Keep at least one status in the "To do" category: new tasks start there.';
  if (!statuses.some((s) => s.category === 'done')) return 'Keep at least one status in the "Done" category.';
  const names = statuses.map((s) => s.name.trim().toLowerCase());
  if (names.some((n) => !n)) return 'Name every status.';
  if (new Set(names).size !== names.length) return 'Two statuses have the same name.';
  return null;
}

// Flags shown on a task. tasksById: the project's tasks by id (for "blocked").
export function taskFlags(task, project, tasksById, today, cal) {
  const cat = categoryOf(project, task);
  const open = isOpenCategory(cat);
  const overdue = open && Boolean(task.dueDate) && task.dueDate < today;
  const dueSoon = open && !overdue && Boolean(task.dueDate) && workDaysBetween(today, task.dueDate, cal) <= DUE_SOON_DAYS;
  const blockers = (task.blockedBy || []).map((id) => tasksById.get(id)).filter((t) => t && categoryOf(project, t) !== 'done' && categoryOf(project, t) !== 'cancelled');
  return { category: cat, open, overdue, dueSoon, blocked: open && blockers.length > 0, blockers: blockers.map((t) => t.id) };
}

// A subtask counts in its parent's milestone unless it has its own.
export function milestoneOfTask(task, tasksById) {
  if (task.milestoneId) return task.milestoneId;
  const parent = task.parentId && tasksById.get(task.parentId);
  return parent?.milestoneId || null;
}

// The tasks progress is measured on: subtasks count, and a task that has subtasks does not
// (they stand for it). Cancelled tasks are left out.
export function leafTasks(tasks, project) {
  const parents = new Set(tasks.filter((t) => t.parentId).map((t) => t.parentId));
  return tasks.filter((t) => !parents.has(t.id) && categoryOf(project, t) !== 'cancelled');
}

// Progress of a set of leaf tasks, 0–100 (null when there is nothing to measure). Weighted by
// estimated hours when at least 60% of the tasks have an estimate (the others count at the
// average estimate); otherwise every task counts the same.
export function progressOf(leaves, project) {
  if (!leaves.length) return { percent: null, basis: 'count', done: 0, total: 0 };
  const done = leaves.filter((t) => categoryOf(project, t) === 'done');
  const estimated = leaves.filter((t) => Number(t.estimateHours) > 0);
  if (estimated.length >= ESTIMATE_SHARE * leaves.length) {
    const avg = estimated.reduce((s, t) => s + Number(t.estimateHours), 0) / estimated.length;
    const w = (t) => (Number(t.estimateHours) > 0 ? Number(t.estimateHours) : avg);
    const all = leaves.reduce((s, t) => s + w(t), 0);
    return { percent: Math.round((done.reduce((s, t) => s + w(t), 0) / all) * 100), basis: 'hours', done: done.length, total: leaves.length };
  }
  return { percent: Math.round((done.length / leaves.length) * 100), basis: 'count', done: done.length, total: leaves.length };
}

// Where progress should be by today on a straight line from `start` to `due`, counted in working
// days (0–100).
export function expectedPercent(start, due, today, cal) {
  if (!start || !due || due <= start) return today >= due ? 100 : 0;
  if (today <= start) return 0;
  if (today >= due) return 100;
  const total = workDaysBetween(start, due, cal);
  if (!total) return 100;
  return Math.round((workDaysBetween(start, today, cal) / total) * 100);
}

const RANK = { green: 0, amber: 1, red: 2 };
export const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);

// Health of a milestone (green / amber / red) with the reasons, worst rule first.
// ctx: { project, tasks (all the project's), tasksById, today, cal }
export function milestoneStatus(m, { project, tasks, tasksById, today, cal }) {
  const mine = tasks.filter((t) => milestoneOfTask(t, tasksById) === m.id);
  const leaves = leafTasks(mine, project);
  const progress = progressOf(leaves, project);
  const open = leaves.filter((t) => isOpenCategory(categoryOf(project, t)));
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const late = open.filter((t) => t.dueDate && m.dueDate && t.dueDate > m.dueDate);
  const starts = mine.map((t) => t.startDate).filter(Boolean).sort();
  const start = starts[0] || project.startDate;
  const expected = m.dueDate ? expectedPercent(start, m.dueDate, today, cal) : null;
  const reasons = [];
  let value = 'green';
  const finished = Boolean(m.acceptedAt) || (leaves.length > 0 && open.length === 0);
  if (!finished && m.dueDate && m.dueDate < today && (open.length || !leaves.length)) {
    value = 'red';
    reasons.push(open.length ? `Past its date with ${open.length} open task${open.length === 1 ? '' : 's'}` : 'Past its date');
  }
  if (!finished) {
    if (overdue.length) (value = worse(value, 'amber')), reasons.push(`${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`);
    if (late.length) (value = worse(value, 'amber')), reasons.push(`${late.length} task${late.length === 1 ? ' is' : 's are'} due after the milestone`);
    if (expected !== null && progress.percent !== null && progress.percent < expected - BEHIND_POINTS && value === 'green') {
      value = 'amber';
      reasons.push(`${progress.percent}% done; ${expected}% expected by now`);
    }
  }
  return { value, reasons, progress, expected, finished, openTasks: open.length, overdueTasks: overdue.length };
}

// Health of the project: its worst milestone, and at risk while any task is overdue. Past the
// end date with work still open, it is off track. A manager's override is shown next to it
// (see the project's healthOverride); the computed value is always kept.
export function projectStatus(project, milestones, tasks, today, cal) {
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const ctx = { project, tasks, tasksById, today, cal };
  const ms = milestones.map((m) => ({ id: m.id, ...milestoneStatus(m, ctx) }));
  const leaves = leafTasks(tasks, project);
  const progress = progressOf(leaves, project);
  const open = leaves.filter((t) => isOpenCategory(categoryOf(project, t)));
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const blocked = tasks.filter((t) => taskFlags(t, project, tasksById, today, cal).blocked);
  let value = 'green';
  const reasons = [];
  for (const m of milestones) {
    const s = ms.find((x) => x.id === m.id);
    if (s.value !== 'green') {
      value = worse(value, s.value);
      reasons.push(`${m.name}: ${s.reasons[0]}`);
    }
  }
  if (overdue.length) {
    value = worse(value, 'amber');
    reasons.push(`${overdue.length} of ${open.length} open task${open.length === 1 ? '' : 's'} ${overdue.length === 1 ? 'is' : 'are'} overdue`);
  }
  if (project.endDate && project.endDate < today && open.length) {
    value = 'red';
    reasons.unshift('Past the end date with work still open');
  }
  const closed = project.status === 'completed' || project.status === 'cancelled';
  return { value: closed ? null : value, reasons: closed ? [] : reasons, progress, milestones: ms, openTasks: open.length, overdueTasks: overdue.length, blockedTasks: blocked.length };
}

// ---------- Board order ----------
// Where a card lands in a column. `column`: the column's other tasks, sorted by rank. The card
// goes after `beforeId` (the card above it) or, failing that, before `afterId` (the card below);
// with neither (or ids no longer in the column), at the bottom. Returns its new rank, and the
// whole column renumbered (1024, 2048, …) when the gap has become too small to split.
export const RANK_STEP = 1024;
export function placeInColumn(column, beforeId, afterId) {
  const bi = beforeId ? column.findIndex((t) => t.id === beforeId) : -1;
  const ai = afterId ? column.findIndex((t) => t.id === afterId) : -1;
  const pos = bi >= 0 ? bi + 1 : ai >= 0 ? ai : column.length;
  const prev = column[pos - 1];
  const next = column[pos];
  let rank;
  if (prev && next) rank = (prev.rank + next.rank) / 2;
  else if (prev) rank = prev.rank + RANK_STEP;
  else if (next) rank = next.rank - RANK_STEP;
  else rank = RANK_STEP;
  const tight = (prev && rank - prev.rank < 1e-6) || (next && next.rank - rank < 1e-6) || !Number.isFinite(rank);
  if (!tight) return { rank, position: pos, renumber: null };
  // Renumber: every card of the column in order, the moved one at its place.
  const order = [...column.slice(0, pos).map((t) => t.id), null, ...column.slice(pos).map((t) => t.id)];
  const renumber = new Map(order.map((id, i) => [id, (i + 1) * RANK_STEP]));
  return { rank: renumber.get(null), position: pos, renumber };
}
export const byRank = (a, b) => (a.rank ?? 0) - (b.rank ?? 0) || String(a.key || '').localeCompare(String(b.key || ''), undefined, { numeric: true });

// ---------- Blocked-by links ----------
// Would `taskId` being blocked by `blockedBy` make a loop (A waits for B, which waits for A)?
export function makesCycle(tasksById, taskId, blockedBy) {
  const seen = new Set();
  const stack = [...blockedBy];
  while (stack.length) {
    const id = stack.pop();
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(tasksById.get(id)?.blockedBy || []));
  }
  return false;
}

// ---------- My work ----------
export const MY_WORK_GROUPS = { overdue: 'Overdue', today: 'Today', week: 'This week', later: 'Later', none: 'No date' };
export function myWorkGroup(task, today) {
  if (!task.dueDate) return 'none';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  if (task.dueDate <= addDays(weekStart(today), 6)) return 'week';
  return 'later';
}

// ---------- Remaining hours ----------
// What is left of a task: 0 once it is done or cancelled; the "hours left" someone working on it
// set (remainingHours, null when not set); otherwise its estimate less the time logged on it, never
// below 0. null when there is neither an estimate nor hours left to go by. Progress stays weighed by
// estimates (progressOf), so logging time does not move it.
export function remainingOf(task, loggedHours, category) {
  if (category === 'done' || category === 'cancelled') return 0;
  if (task.remainingHours != null && Number.isFinite(Number(task.remainingHours))) return Math.round(Number(task.remainingHours) * 100) / 100;
  if (!(Number(task.estimateHours) > 0)) return null;
  return Math.round(Math.max(0, Number(task.estimateHours) - (Number(loggedHours) || 0)) * 100) / 100;
}
// Hours left: 0 to 9999, in quarter hours.
export const validRemaining = (h) => Number.isFinite(h) && h >= 0 && h <= 9999 && Math.abs(h * 4 - Math.round(h * 4)) < 1e-9;
// The hours Workload plans for a task: what is left of it (`remaining`, worked out by the caller),
// or its estimate when the caller did not say.
const hoursToPlan = (task) => Number(task.remaining !== undefined ? task.remaining : task.estimateHours) || 0;

// ---------- Workload ----------
// The hours of an open task, by day: what is left of it spread evenly over the working days from
// its start (or `from`, if later) to its due date, or all on the due date (no start, or no working
// day in between). A task already overdue counts on `from`: it is still to be done. Tasks without
// a due date are not planned.
export function plannedDays(task, cal, from) {
  const hours = hoursToPlan(task);
  if (!hours || !task.dueDate) return [];
  if (task.dueDate < from) return [{ date: from, hours }];
  const start = task.startDate && task.startDate <= task.dueDate ? (task.startDate < from ? from : task.startDate) : null;
  const days = start ? workDatesIn(start, task.dueDate, cal) : [];
  if (!days.length) return [{ date: task.dueDate, hours }];
  return days.map((date) => ({ date, hours: hours / days.length }));
}

// Capacity of a person in a week, in hours: their working days that are not holidays, minus
// approved leave (leave: Map date → days off, 1 or 0.5), times their hours per day.
export function weekCapacity(week, person, cal) {
  const pcal = { workDays: person.workDays || cal.workDays, off: cal.off };
  const perDay = person.hoursPerDay || HOURS_PER_DAY;
  let days = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(week, i);
    if (!isWorkDay(d, pcal)) continue;
    days += 1 - Math.min(1, person.leave?.get(d) || 0);
  }
  return Math.round(days * perDay * 100) / 100;
}

// Person × week grid. people: [{ id, name, workDays?, hoursPerDay?, leave? }]; tasks: open tasks
// with assigneeId, estimateHours, remaining (hours left), startDate, dueDate (plus whatever the
// caller wants back). Work is planned from `from` on: days of the first week before it are past.
export function workload({ people, tasks, from, weeks, cal }) {
  const first = weekStart(from);
  const keys = Array.from({ length: weeks }, (_, i) => addDays(first, i * 7));
  const end = addDays(first, weeks * 7 - 1);
  const rows = people.map((p) => {
    const cells = keys.map((week) => ({ week, capacity: weekCapacity(week, p, cal), planned: 0, tasks: [] }));
    let unscheduled = 0;
    const unscheduledTasks = [];
    for (const t of tasks.filter((x) => x.assigneeId === p.id)) {
      if (!t.dueDate) {
        if (hoursToPlan(t) > 0) (unscheduled += hoursToPlan(t)), unscheduledTasks.push(t);
        continue;
      }
      const byWeek = new Map();
      for (const { date, hours } of plannedDays(t, cal, from > first ? from : first)) {
        if (date > end) continue;
        const k = weekStart(date);
        byWeek.set(k, (byWeek.get(k) || 0) + hours);
      }
      for (const [k, hours] of byWeek) {
        const cell = cells.find((c) => c.week === k);
        if (!cell) continue;
        cell.planned += hours;
        cell.tasks.push({ ...t, hours: Math.round(hours * 100) / 100 });
      }
    }
    for (const c of cells) {
      c.planned = Math.round(c.planned * 100) / 100;
      c.over = c.planned > c.capacity;
    }
    return { ...p, leave: undefined, cells, unscheduled: Math.round(unscheduled * 100) / 100, unscheduledTasks };
  });
  return { weeks: keys, rows };
}

// ---------- Comments ----------
// Splits a comment into text and @mentions of the given usernames, for highlighting.
export function mentionParts(body, usernames) {
  const known = new Set(usernames.map((u) => u.toLowerCase()));
  const parts = [];
  let last = 0;
  for (const m of String(body).matchAll(/@([a-z0-9._-]{3,32})/gi)) {
    const name = m[1].replace(/[.]+$/, '');
    if (!known.has(name.toLowerCase())) continue;
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    parts.push({ mention: name });
    last = m.index + 1 + name.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

// The usernames a comment mentions, of those given (the project's members), in lower case.
export function mentionedUsernames(body, usernames) {
  return [...new Set(mentionParts(String(body || ''), usernames).filter((x) => x.mention).map((x) => x.mention.toLowerCase()))];
}

// ---------- Time ----------
export const validHours = (h) => Number.isFinite(h) && h >= 0.25 && h <= 24 && Math.abs(h * 4 - Math.round(h * 4)) < 1e-9;

// CSV rows of a project's tasks (the List's Export CSV). Pass them to toCsv, which makes cells
// that start like a formula safe.
export function taskCsvRows(tasks, milestones = []) {
  const ms = new Map(milestones.map((m) => [m.id, m.name]));
  return [
    ['Key', 'Task', 'Parent', 'Status', 'Priority', 'Assignee', 'Milestone', 'Start', 'Due', 'Estimate (h)', 'Logged (h)', 'Left (h)', 'Checklist', 'Overdue', 'Blocked'],
    ...tasks.map((t) => [t.key, t.title, tasks.find((x) => x.id === t.parentId)?.key || '', t.statusName, PRIORITY[t.priority] || t.priority, t.assigneeName || '', ms.get(t.milestoneIdEffective || t.milestoneId) || '', t.startDate || '', t.dueDate || '', t.estimateHours ?? '', t.loggedHours ?? '', t.remaining ?? '', t.checklist?.length ? `${t.checklistDone}/${t.checklist.length}` : '', t.overdue ? 'Yes' : '', t.blocked ? 'Yes' : '']),
  ];
}

// ---------- Quick filters and saved views (Board and List) ----------
// A few fixed filters, combined: Mine and Unassigned widen each other (either one); the others
// narrow (all of them). Deliberately few: configurable filters turn into a query language.
export const QUICK_FILTERS = { mine: 'Mine', unassigned: 'Unassigned', overdue: 'Overdue', week: 'Due this week', blocked: 'Blocked', high: 'High & urgent' };
export const parseFilters = (v) => [...new Set(String(v || '').split(',').map((x) => x.trim()).filter((x) => Object.hasOwn(QUICK_FILTERS, x)))];
// Does a task (as the server sends it: category, overdue, blocked) match the chips and the search
// text (its key, title or assignee)? "Due this week": open and due Monday to Sunday of this week,
// like My work's "This week".
export function taskMatches(t, { chips = [], q = '' } = {}, { today, userId } = {}) {
  const on = new Set(chips);
  const open = t.category === 'todo' || t.category === 'active';
  if ((on.has('mine') || on.has('unassigned')) && !((on.has('mine') && t.assigneeId === userId) || (on.has('unassigned') && !t.assigneeId))) return false;
  if (on.has('overdue') && !t.overdue) return false;
  if (on.has('week') && !(open && t.dueDate && today && t.dueDate >= weekStart(today) && t.dueDate <= addDays(weekStart(today), 6))) return false;
  if (on.has('blocked') && !t.blocked) return false;
  if (on.has('high') && t.priority !== 'high' && t.priority !== 'urgent') return false;
  const text = String(q || '').trim().toLowerCase();
  return !text || `${t.key || ''} ${t.title || ''} ${t.assigneeName || ''}`.toLowerCase().includes(text);
}

// A saved view keeps the filters in a tab's address. Only these keys are kept, each value short
// and the chips known ones; a filter that names a person or milestone no longer there shows all.
export const VIEW_TABS = { board: 'Board', list: 'List' };
export const VIEW_KEYS = { board: ['f', 'q', 'who', 'ms', 'cancelled'], list: ['f', 'q', 'group', 'who', 'show', 'sort', 'dir'] };
export function cleanViewQuery(tab, query) {
  const keys = VIEW_KEYS[tab] || [];
  const src = new URLSearchParams(typeof query === 'string' ? query.replace(/^\?/, '').slice(0, 2000) : '');
  const out = new URLSearchParams();
  for (const k of keys) {
    let v = String(src.get(k) || '').trim().slice(0, 100);
    if (k === 'f') v = parseFilters(v).join(',');
    if (v) out.set(k, v);
  }
  return out.toString().slice(0, 500);
}

// ---------- Notifications ("For you" on My work) ----------
export const NOTIFY_KINDS = { assigned: 'Assigned to you', mentioned: 'Mentioned you', commented: 'Comment', status: 'Done or cancelled', added: 'Added to a project' };
export const NOTIFY_KEEP = 200; // per person, newest kept
export const NOTIFY_DAYS = 60; // older ones are removed

// Similar events shown as one line: the same kind on the same task (or project), read or not.
// items: newest first, each { id, kind, taskId, projectId, readAt, actorName, … }. Returns groups,
// newest first: { key, kind, ids, count, unread, latest, actors }.
export function groupNotifications(items) {
  const groups = new Map();
  for (const n of items) {
    const key = `${n.kind}|${n.taskId || n.projectId}|${n.readAt ? 'read' : 'unread'}`;
    if (!groups.has(key)) groups.set(key, { key, kind: n.kind, ids: [], count: 0, unread: !n.readAt, latest: n, actors: [] });
    const g = groups.get(key);
    g.ids.push(n.id);
    g.count++;
    if (n.actorName && !g.actors.includes(n.actorName)) g.actors.push(n.actorName);
  }
  return [...groups.values()];
}

// ---------- Milestone burn-up ----------
// Scope and work done in a milestone, day by day (working days), with the expected line, on the
// same basis as its progress: hours when 60% of its leaf tasks have an estimate, else tasks.
// Worked out from what the tasks remember: when each was added (createdAt), its status changes
// (history) and when it was done (completedAt). Deleted tasks are not remembered, and a task moved
// to another milestone counts in its current one throughout.
// ctx: { project, tasks (all the project's), tasksById, today, cal }; dayOf(iso) → local YYYY-MM-DD.
export function milestoneBurnup(m, { project, tasks, tasksById, today, cal }, dayOf = (iso) => String(iso || '').slice(0, 10)) {
  const parents = new Set(tasks.filter((t) => t.parentId).map((t) => t.parentId));
  const leaves = tasks.filter((t) => milestoneOfTask(t, tasksById) === m.id && !parents.has(t.id));
  const current = leaves.filter((t) => categoryOf(project, t) !== 'cancelled');
  const estimated = current.filter((t) => Number(t.estimateHours) > 0);
  const byHours = current.length > 0 && estimated.length >= ESTIMATE_SHARE * current.length;
  const avg = estimated.length ? estimated.reduce((s, t) => s + Number(t.estimateHours), 0) / estimated.length : 1;
  const weight = (t) => (byHours ? (Number(t.estimateHours) > 0 ? Number(t.estimateHours) : avg) : 1);
  // Each task's category over time: [date, category] from its status changes, the last one being
  // where it is now (its current spell in Done starting on completedAt).
  const catOf = new Map(project.statuses.map((s) => [s.name, s.category]));
  const lives = leaves.map((t) => {
    const events = (t.history || []).filter((h) => h.field === 'status' && h.at).sort((a, b) => a.at.localeCompare(b.at)).map((h) => [dayOf(h.at), catOf.get(h.to) || null, catOf.get(h.from) || null]);
    const first = events.find((e) => e[2])?.[2] || 'todo';
    const steps = events.filter((e) => e[1]).map(([date, cat]) => [date, cat]);
    const now = categoryOf(project, t);
    const last = steps.at(-1);
    const since = now === 'done' && t.completedAt ? dayOf(t.completedAt) : last?.[0] || dayOf(t.updatedAt || t.createdAt);
    if (last && last[1] === now) last[0] = now === 'done' && t.completedAt ? since : last[0];
    else steps.push([since, now]);
    return { created: dayOf(t.createdAt), first, steps, w: weight(t) };
  });
  const catOn = (life, date) => {
    let cat = life.first;
    for (const [d, c] of life.steps) if (d <= date) cat = c;
    return cat;
  };
  // The same start as the milestone's health line: its first task's start, or the project's.
  const starts = tasks.filter((t) => milestoneOfTask(t, tasksById) === m.id).map((t) => t.startDate).filter(Boolean).sort();
  const start = starts[0] || project.startDate || today;
  const due = m.dueDate || today;
  const finished = Boolean(m.acceptedAt) || (current.length > 0 && current.every((t) => categoryOf(project, t) === 'done'));
  const lastDone = lives.flatMap((l) => l.steps.filter((s) => s[1] === 'done').map((s) => s[0])).sort().at(-1);
  let end = due;
  if (!finished && today > end) end = today;
  if (finished && lastDone && lastDone > end) end = lastDone;
  let dates = start <= end ? workDatesIn(start, end, cal) : [];
  if (!dates.length || dates[0] !== start) dates = [start, ...dates.filter((d) => d > start)];
  if (dates.at(-1) !== end && end > start) dates.push(end);
  // At most 260 points: a long milestone is sampled, keeping its first and last day.
  if (dates.length > 260) {
    const step = Math.ceil(dates.length / 260);
    dates = dates.filter((d, i) => i % step === 0 || i === dates.length - 1);
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const points = dates.map((date) => {
    let scope = 0;
    let done = 0;
    for (const l of lives) {
      if (l.created > date) continue;
      const cat = catOn(l, date);
      if (cat === 'cancelled') continue;
      scope += l.w;
      if (cat === 'done') done += l.w;
    }
    return { date, scope: r2(scope), done: date <= today ? r2(done) : null, expected: r2((expectedPercent(start, due, date, cal) / 100) * scope) };
  });
  const atStart = points[0]?.scope || 0;
  const peak = points.reduce((n, p) => Math.max(n, p.scope), 0);
  const upTo = points.filter((p) => p.date <= today).at(-1) || points[0];
  return {
    milestoneId: m.id, basis: byHours ? 'hours' : 'count', start, due, end, today, finished, points,
    scope: points.at(-1)?.scope || 0, scopeAtStart: atStart, added: r2(Math.max(0, peak - atStart)),
    done: upTo?.done || 0, expected: upTo?.expected ?? null, tasks: current.length,
  };
}
