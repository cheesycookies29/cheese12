// Project Management: statuses, labels and the calculations behind progress, health and board
// order. Shared by the server (validation, reports) and the browser (labels,
// badges), so no Node or DOM APIs here. Everything computed here is worked out when it is read,
// never stored.
//
// A project has milestones (some are contract deliverables) and tasks. Each task has a status
// from the project's own list; every status belongs to one of four fixed categories, which is
// what progress, "overdue" and the reports go by. Subtasks are one level deep.
//
// Effort is a task's size (XS to XL), not hours: a rough idea that is honest about being rough.
// Hours exist only on projects that track time (timeTracking), as a record of what was spent.

import { TICKET_PRIORITY } from './helpdesk.js';
import { isDayOff } from './holidays.js';
import { userCan } from './roles.js';

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

// A project's icon, shown beside its name: a picture from CORE's icon set on a coloured tile.
// Without one, the tile shows the first letter of the name in a colour taken from the project's code,
// so every project still has a recognizable mark.
export const PROJECT_ICONS = {
  folder: 'Folder', building: 'Building', laptop: 'Laptop', code: 'Code', database: 'Database', shield: 'Shield',
  chart: 'Chart', dashboard: 'Dashboard', cap: 'School', book: 'Book', users: 'People', headset: 'Support',
  ticket: 'Ticket', box: 'Box', wallet: 'Money', receipt: 'Invoice', megaphone: 'Campaign', calendar: 'Calendar',
  flag: 'Flag', sparkle: 'Idea', heart: 'Heart', mapPin: 'Place', mail: 'Mail', layers: 'Layers',
  clipboard: 'Checklist', settings: 'Settings', key: 'Key', video: 'Video', slides: 'Slides', activity: 'Health',
};
export const PROJECT_ICON_COLORS = { gray: 'Grey', blue: 'Blue', teal: 'Teal', green: 'Green', amber: 'Amber', red: 'Red', violet: 'Violet', brand: 'Maroon' };
// null (the letter tile) or { glyph, color }. Anything else is refused with a message (an HttpError
// on the server: Error with a status is made by the caller).
export function parseProjectIcon(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('Pick the icon from the list.');
  const glyph = typeof v.glyph === 'string' && Object.hasOwn(PROJECT_ICONS, v.glyph) ? v.glyph : null;
  const color = typeof v.color === 'string' && Object.hasOwn(PROJECT_ICON_COLORS, v.color) ? v.color : null;
  if (!glyph) throw new Error('Pick the icon from the list.');
  if (!color) throw new Error('Pick the icon\'s colour from the list.');
  return { glyph, color };
}
// The letter tile of a project without an icon: its first letter or digit, and a colour from its code.
export function letterTile(name, code) {
  const letter = (String(name || '').match(/[\p{L}\p{N}]/u)?.[0] || '?').toLocaleUpperCase();
  const keys = Object.keys(PROJECT_ICON_COLORS).filter((k) => k !== 'gray');
  let h = 0;
  for (const ch of String(code || name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return { letter, color: keys[h % keys.length] };
}
export const DEFAULT_PM = { statuses: DEFAULT_STATUSES, types: DEFAULT_TYPES };

export const DUE_SOON_DAYS = 3; // working days
export const BEHIND_POINTS = 15; // progress this far below the expected line makes a milestone at risk
export const ESTIMATE_SHARE = 0.6; // weigh progress by size when this share of the tasks has a size

// ---------- Effort sizes ----------
// A task's size: how much work it is, roughly. The weight counts in progress and the burn-up (a
// Large task is worth five Extra small ones). The Projects setup may reword the descriptions
// ("about a day"), never the weights.
export const SIZES = {
  XS: { label: 'Extra small', effort: 'under half a day', weight: 1 },
  S: { label: 'Small', effort: 'about a day', weight: 2 },
  M: { label: 'Medium', effort: 'a few days', weight: 3 },
  L: { label: 'Large', effort: 'about a week', weight: 5 },
  XL: { label: 'Extra large', effort: 'two weeks or more', weight: 8 },
};
export const SIZE_KEYS = Object.keys(SIZES);
export const DEFAULT_SIZE_NOTES = Object.fromEntries(SIZE_KEYS.map((k) => [k, SIZES[k].effort]));
export const isSize = (v) => typeof v === 'string' && Object.hasOwn(SIZES, v);
// "M · Medium"; '' for no size.
export const sizeName = (s) => (isSize(s) ? `${s} · ${SIZES[s].label}` : '');
// What a size means: the company's wording (Projects setup) or the built-in one.
export const sizeEffort = (s, notes) => (isSize(s) ? (typeof notes?.[s] === 'string' && notes[s].trim()) || SIZES[s].effort : '');
export const sizeWeight = (s) => (isSize(s) ? SIZES[s].weight : 0);
// The size an hour estimate becomes (the 0.17 migration and "Estimate (h)" in an import):
// up to 2 h XS, up to 8 h S, up to 24 h M, up to 48 h L, more XL. No estimate: no size.
export function sizeFromHours(h) {
  const n = Number(h);
  if (h == null || h === '' || !Number.isFinite(n) || n <= 0) return null;
  return n <= 2 ? 'XS' : n <= 8 ? 'S' : n <= 24 ? 'M' : n <= 48 ? 'L' : 'XL';
}
// A size as people write it: XS…XL, the label ("Medium", "extra large"), or "M · Medium" as CORE
// exports it. null when empty; undefined when it is not a size.
export function parseSize(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const key = s.split('·')[0].trim().toUpperCase();
  if (isSize(key)) return key;
  const norm = (x) => x.toLowerCase().replace(/[^a-z]/g, '');
  return SIZE_KEYS.find((k) => norm(SIZES[k].label) === norm(s)) || undefined;
}
// The descriptions the Projects setup may change: one short line per size. Returns them, or a
// problem in words.
export function cleanSizeNotes(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { problem: 'Send a description for each size.' };
  const out = {};
  for (const k of SIZE_KEYS) {
    const text = typeof v[k] === 'string' ? v[k].trim() : '';
    if (!text) return { problem: `Describe size ${k} (${SIZES[k].label}), e.g. "${SIZES[k].effort}".` };
    if (text.length > 60) return { problem: `Keep the description of ${k} to 60 characters.` };
    out[k] = text;
  }
  return { notes: out };
}

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

// How tasks weigh in progress and the burn-up: by size when at least 60% of them have one (the
// others count at the average weight of those that do), otherwise every task the same.
export function sizeBasis(tasks) {
  const sized = tasks.filter((t) => sizeWeight(t.size));
  const bySize = tasks.length > 0 && sized.length >= ESTIMATE_SHARE * tasks.length;
  const avg = sized.length ? sized.reduce((s, t) => s + sizeWeight(t.size), 0) / sized.length : 1;
  return { bySize, sized: sized.length, weight: (t) => (bySize ? sizeWeight(t.size) || avg : 1) };
}

// Progress of a set of leaf tasks, 0–100 (null when there is nothing to measure). Weighted by
// size when at least 60% of the tasks have one (the others at the average weight); otherwise
// every task counts the same. basis: 'size' or 'count'.
export function progressOf(leaves, project) {
  if (!leaves.length) return { percent: null, basis: 'count', done: 0, total: 0, sized: 0 };
  const done = leaves.filter((t) => categoryOf(project, t) === 'done');
  const b = sizeBasis(leaves);
  const all = leaves.reduce((s, t) => s + b.weight(t), 0);
  const percent = Math.round((done.reduce((s, t) => s + b.weight(t), 0) / all) * 100);
  return { percent, basis: b.bySize ? 'size' : 'count', done: done.length, total: leaves.length, sized: b.sized };
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

// ---------- Time (projects that track time) ----------
export const validHours = (h) => Number.isFinite(h) && h >= 0.25 && h <= 24 && Math.abs(h * 4 - Math.round(h * 4)) < 1e-9;
export const MAX_DAY_HOURS = 24; // per person and day, across projects

// CSV rows of a project's tasks (the List's Export CSV). Pass them to toCsv, which makes cells
// that start like a formula safe. time: the project tracks time (a Logged column).
export function taskCsvRows(tasks, milestones = [], { time = false } = {}) {
  const ms = new Map(milestones.map((m) => [m.id, m.name]));
  return [
    ['Key', 'Task', 'Parent', 'Status', 'Priority', 'Assignee', 'Milestone', 'Start', 'Due', 'Size', ...(time ? ['Logged (h)'] : []), 'Checklist', 'Overdue', 'Blocked'],
    ...tasks.map((t) => [t.key, t.title, tasks.find((x) => x.id === t.parentId)?.key || '', t.statusName, PRIORITY[t.priority] || t.priority, t.assigneeName || '', ms.get(t.milestoneIdEffective || t.milestoneId) || '', t.startDate || '', t.dueDate || '', sizeName(t.size), ...(time ? [t.loggedHours ?? ''] : []), t.checklist?.length ? `${t.checklistDone}/${t.checklist.length}` : '', t.overdue ? 'Yes' : '', t.blocked ? 'Yes' : '']),
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
// The List's columns it can be sorted by (rank, board order, is the default).
export const LIST_SORTS = ['rank', 'key', 'title', 'status', 'assignee', 'due', 'priority', 'size'];
export function cleanViewQuery(tab, query) {
  const keys = VIEW_KEYS[tab] || [];
  const src = new URLSearchParams(typeof query === 'string' ? query.replace(/^\?/, '').slice(0, 2000) : '');
  // Views saved before 0.17 sorted by the estimate (now the size) or the hours left (gone).
  if (tab === 'list' && src.get('sort') === 'estimate') src.set('sort', 'size');
  if (tab === 'list' && src.has('sort') && !LIST_SORTS.includes(src.get('sort'))) (src.delete('sort'), src.delete('dir'));
  const out = new URLSearchParams();
  for (const k of keys) {
    let v = String(src.get(k) || '').trim().slice(0, 100);
    if (k === 'f') v = parseFilters(v).join(',');
    if (k === 'dir' && v !== 'desc') v = '';
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
// same basis as its progress: effort points (size weights) when 60% of its leaf tasks have a
// size, else tasks.
// Worked out from what the tasks remember: when each was added (createdAt), its status changes
// (history) and when it was done (completedAt). Deleted tasks are not remembered, and a task moved
// to another milestone counts in its current one throughout.
// ctx: { project, tasks (all the project's), tasksById, today, cal }; dayOf(iso) → local YYYY-MM-DD.
export function milestoneBurnup(m, { project, tasks, tasksById, today, cal }, dayOf = (iso) => String(iso || '').slice(0, 10)) {
  const parents = new Set(tasks.filter((t) => t.parentId).map((t) => t.parentId));
  const leaves = tasks.filter((t) => milestoneOfTask(t, tasksById) === m.id && !parents.has(t.id));
  const current = leaves.filter((t) => categoryOf(project, t) !== 'cancelled');
  // Weighed like the milestone's progress: on the tasks it holds now (not cancelled).
  const basis = sizeBasis(current);
  const weight = basis.weight;
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
    milestoneId: m.id, basis: basis.bySize ? 'size' : 'count', start, due, end, today, finished, points,
    scope: points.at(-1)?.scope || 0, scopeAtStart: atStart, added: r2(Math.max(0, peak - atStart)),
    done: upTo?.done || 0, expected: upTo?.expected ?? null, tasks: current.length,
  };
}

// ---------- Watchers and the daily digest ----------
// The digest lists at most this many lines per part; the rest are counted ("and 4 more").
export const DIGEST_MAX = 15;
export const DIGEST_DEFAULTS = { enabled: false, time: '07:30', workingDaysOnly: true };
export const validDigestTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
// Is a digest due for `day` at `time` (local HH:MM)? On or after the send time, and on a working
// day when the company says so. A day already sent is the caller's to check (one per person per day).
export function digestDue(settings, day, time, cal) {
  if (!settings?.enabled) return false;
  if (time < (validDigestTime(settings.time) ? settings.time : DIGEST_DEFAULTS.time)) return false;
  return !(settings.workingDaysOnly !== false && !isWorkDay(day, cal));
}
// One person's digest. tasks: their open tasks (dueDate, key, title, project …); milestones: those
// not finished in open projects they manage, with their health (`value`). unread: their unread For
// you count. Overdue: due before today; due soon: today or within DUE_SOON_DAYS working days.
export function digestFor({ tasks = [], milestones = [], unread = 0, today, cal }) {
  const byDue = (a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || String(a.key || a.name).localeCompare(String(b.key || b.name), undefined, { numeric: true });
  const dated = tasks.filter((t) => t.dueDate);
  const overdue = dated.filter((t) => t.dueDate < today).sort(byDue);
  const dueSoon = dated.filter((t) => t.dueDate >= today && workDaysBetween(today, t.dueDate, cal) <= DUE_SOON_DAYS).sort(byDue);
  const atRisk = milestones.filter((m) => m.value === 'amber' || m.value === 'red').sort((a, b) => RANK[b.value] - RANK[a.value] || byDue(a, b));
  return { today, overdue, dueSoon, atRisk, unread: Number(unread) || 0, empty: !overdue.length && !dueSoon.length && !atRisk.length && !unread };
}

// ---------- Billing forecast (deliverables across projects) ----------
// What a deliverable bills: its billing % of the contract's value (or the deal's, without a
// contract). null when there is no % or no value to apply it to.
export function billingAmount(m, value) {
  const pct = Number(m.billingPercent);
  if (!m.deliverable || !(pct > 0) || !(Number(value) > 0)) return null;
  return Math.round(Number(value) * pct) / 100;
}
// By month: expected (not yet accepted, by due month), earned (accepted, by month of acceptance)
// and, of the expected, what is overdue. rows: { dueDate, acceptedAt, amount }. Months ascending.
export function billingForecast(rows, today) {
  const months = new Map();
  const at = (k) => {
    if (!months.has(k)) months.set(k, { month: k, expected: 0, earned: 0, overdue: 0, count: 0, noValue: 0 });
    return months.get(k);
  };
  for (const r of rows) {
    const accepted = Boolean(r.acceptedAt);
    const m = at(String(accepted ? r.acceptedAt : r.dueDate).slice(0, 7));
    m.count++;
    if (r.amount == null) {
      m.noValue++;
      continue;
    }
    if (accepted) m.earned += r.amount;
    else {
      m.expected += r.amount;
      if (r.dueDate < today) m.overdue += r.amount;
    }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const list = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, expected: r2(m.expected), earned: r2(m.earned), overdue: r2(m.overdue) }));
  const sum = (k) => r2(list.reduce((n, m) => n + m[k], 0));
  return { months: list, total: { expected: sum('expected'), earned: sum('earned'), overdue: sum('overdue'), count: list.reduce((n, m) => n + m.count, 0), noValue: list.reduce((n, m) => n + m.noValue, 0) } };
}
// The forecast as CSV rows (pass them to toCsv, which keeps cells that look like formulas as text).
export function forecastCsvRows(f) {
  return [
    ['Month', 'Expected', 'Of which overdue', 'Earned (accepted)', 'Deliverables', 'Without a value'],
    ...f.months.map((m) => [m.month, m.expected, m.overdue, m.earned, m.count, m.noValue]),
    ['Total', f.total.expected, f.total.overdue, f.total.earned, f.total.count, f.total.noValue],
  ];
}

// ---------- Importing tasks from a CSV file ----------
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
// The fields a column can fill, with the header names each is recognized by (compared without
// case, spaces or punctuation).
export const IMPORT_FIELDS = {
  title: { label: 'Title', required: true, names: ['title', 'task', 'taskname', 'name', 'summary'] },
  description: { label: 'Description', names: ['description', 'details', 'notes'] },
  status: { label: 'Status', names: ['status', 'state'] },
  assignee: { label: 'Assignee', names: ['assignee', 'assignedto', 'owner', 'responsible', 'username'] },
  start: { label: 'Start', names: ['start', 'startdate', 'begin', 'from'] },
  due: { label: 'Due', names: ['due', 'duedate', 'deadline', 'end', 'enddate', 'finish', 'to'] },
  size: { label: 'Size', names: ['size', 'tshirtsize', 'effort', 'effortsize'] },
  // Files from before sizes, or from other tools: an hour estimate becomes a size (sizeFromHours).
  estimate: { label: 'Estimate (h)', names: ['estimate', 'estimateh', 'estimatehours', 'estimatedhours', 'hours'] },
  priority: { label: 'Priority', names: ['priority'] },
  milestone: { label: 'Milestone', names: ['milestone', 'phase', 'deliverable'] },
  parent: { label: 'Parent', names: ['parent', 'parenttask', 'subtaskof'] },
  checklist: { label: 'Checklist', names: ['checklist', 'checklistitems', 'items'] },
};
const normHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Which column fills which field: { field: column index }, from the header names.
export function guessImportMapping(headers) {
  const out = {};
  const used = new Set();
  for (const [field, { names }] of Object.entries(IMPORT_FIELDS)) {
    const i = headers.findIndex((h, k) => !used.has(k) && names.includes(normHeader(h)));
    if (i >= 0) (out[field] = i), used.add(i);
  }
  return out;
}
// The template file: the headers, and two example rows.
export const IMPORT_TEMPLATE = [
  ['Title', 'Description', 'Status', 'Assignee', 'Start', 'Due', 'Size', 'Priority', 'Milestone', 'Parent', 'Checklist'],
  ['Requirements workshop', 'With the client\'s department heads', 'To do', '', '2026-12-01', '2026-12-03', 'S', 'Normal', 'Design sign-off', '', 'Book the room; Send the agenda'],
  ['Workshop minutes', '', 'To do', '', '', '04/12/2026', 'Extra small', 'High', 'Design sign-off', '2', ''],
];

// A date as YYYY-MM-DD, or DD/MM/YYYY (also D/M/YYYY, with / - or .). null when empty;
// undefined when it is not a date.
export function parseImportDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let y;
  let m;
  let d;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (hit) [, y, m, d] = hit;
  else if ((hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [, d, m, y] = hit;
  else return undefined;
  const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === ymd ? ymd : undefined;
}
// Hours: 0 to 9999, with a dot or a decimal comma ("1,5").
function parseImportHours(v) {
  const s = String(v ?? '').trim().replace(/\s*h(ours?|rs?)?$/i, '');
  if (!s) return null;
  if (!/^\d+([.,]\d+)?$/.test(s)) return undefined;
  const n = Number(s.replace(',', '.'));
  return n >= 0 && n <= 9999 ? Math.round(n * 100) / 100 : undefined;
}

// Works out what an import would create, without changing anything. rows: the file's rows after
// the header (arrays of cells); mapping: { field: column }. ctx: { project (with statuses and
// endDate), members: [{ userId, username, name, role, active }], milestones: [{ id, name }],
// createMilestones }. Every row's problems are listed; nothing may be imported while one has any.
// Returns { rows: [{ row, title, errors, warnings, parent, fromHours }], tasks, newMilestones,
// errorCount, fromHours } (fromHours: how many rows took their size from an hour estimate).
// `row` is the row number a spreadsheet shows (the header is row 1); Parent may give that number
// or another row's title.
export function importPlan(rows, mapping, { project, members = [], milestones = [], createMilestones = false }) {
  const cell = (r, field) => (mapping[field] == null || mapping[field] === '' ? '' : String(r[Number(mapping[field])] ?? '').trim());
  const statusByName = new Map(project.statuses.map((s) => [s.name.trim().toLowerCase(), s]));
  const defaultStatus = firstStatus(project.statuses, 'todo');
  const prio = new Map(Object.entries(PRIORITY).flatMap(([k, label]) => [[k, k], [label.toLowerCase(), k]]));
  const msByName = new Map(milestones.map((m) => [m.name.trim().toLowerCase(), m]));
  const people = members.filter((m) => m.active);
  const findPerson = (v) => {
    const s = v.toLowerCase().replace(/^@/, '');
    return people.find((m) => m.username.toLowerCase() === s) || people.filter((m) => m.name.toLowerCase() === s).at(0) || null;
  };
  const out = [];
  const tasks = [];
  const newMs = new Map();
  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const errors = [];
    const warnings = [];
    let title = cell(r, 'title');
    if (!title) errors.push('The title is empty.');
    if (title.length > 200) (title = title.slice(0, 200)), warnings.push('The title was cut to 200 characters.');
    let description = cell(r, 'description');
    if (description.length > 8000) (description = description.slice(0, 8000)), warnings.push('The description was cut to 8,000 characters.');
    const st = cell(r, 'status');
    const status = st ? statusByName.get(st.toLowerCase()) : defaultStatus;
    if (!status) errors.push(`No status "${st}" in this project (${project.statuses.map((s) => s.name).join(', ')}).`);
    const who = cell(r, 'assignee');
    let assigneeId = null;
    if (who) {
      const person = findPerson(who);
      if (!person) errors.push(`"${who}" is not a member of this project (give the username or the full name).`);
      else if (person.role === 'viewer') errors.push(`${person.name} is a viewer on this project; only members can be assigned.`);
      else assigneeId = person.userId;
    }
    const startDate = parseImportDate(cell(r, 'start'));
    const dueDate = parseImportDate(cell(r, 'due'));
    if (startDate === undefined) errors.push(`Start "${cell(r, 'start')}" is not a date (use YYYY-MM-DD or DD/MM/YYYY).`);
    if (dueDate === undefined) errors.push(`Due "${cell(r, 'due')}" is not a date (use YYYY-MM-DD or DD/MM/YYYY).`);
    if (startDate && dueDate && dueDate < startDate) errors.push('The due date is before the start date.');
    // Size: XS to XL or the label; an "Estimate (h)" column fills it when the row has no size.
    let size = parseSize(cell(r, 'size'));
    if (size === undefined) errors.push(`Size "${cell(r, 'size')}": use ${SIZE_KEYS.join(', ')} or ${SIZE_KEYS.map((k) => SIZES[k].label).join(', ')}.`);
    const estimateHours = parseImportHours(cell(r, 'estimate'));
    let fromHours = false;
    if (estimateHours === undefined) errors.push(`Estimate "${cell(r, 'estimate')}" is not a number of hours from 0 to 9999.`);
    else if (estimateHours > 0 && size === null) {
      size = sizeFromHours(estimateHours);
      fromHours = true;
      warnings.push(`Size ${sizeName(size)}, from the estimate of ${estimateHours} h.`);
    } else if (estimateHours > 0 && size) warnings.push(`The estimate of ${estimateHours} h is left out: the row has a size (${size}).`);
    const pr = cell(r, 'priority');
    const priority = pr ? prio.get(pr.toLowerCase()) : 'normal';
    if (!priority) errors.push(`Priority "${pr}": use ${Object.values(PRIORITY).join(', ')}.`);
    const msName = cell(r, 'milestone');
    let milestone = null;
    if (msName) {
      milestone = msByName.get(msName.toLowerCase()) || null;
      if (!milestone && !createMilestones) errors.push(`No milestone "${msName}" in this project. Add it first, or tick "Create the milestones that are missing".`);
      if (!milestone && createMilestones) {
        const key = msName.toLowerCase();
        if (!newMs.has(key)) newMs.set(key, { name: msName.slice(0, 160), dueDate: null, rows: [] });
        milestone = newMs.get(key);
        milestone.rows.push(rowNo);
        if (dueDate && (!milestone.dueDate || dueDate > milestone.dueDate)) milestone.dueDate = dueDate;
      }
    }
    const items = cell(r, 'checklist').split(';').map((x) => x.trim()).filter(Boolean);
    if (items.length > 50) errors.push('A checklist has at most 50 items.');
    out.push({ row: rowNo, title, errors, warnings, parent: null, fromHours });
    tasks.push({
      row: rowNo, title, description, statusId: status?.id || null, priority: priority || 'normal', assigneeId, startDate: startDate || null, dueDate: dueDate || null,
      size: size || null, milestone, checklist: items.slice(0, 50).map((x) => x.slice(0, 300)), parentRef: cell(r, 'parent'), parentRow: null,
    });
  });
  // Parents: a row number or a title in the file, one level deep.
  const byTitle = new Map();
  for (const t of tasks) if (t.title && !byTitle.has(t.title.toLowerCase())) byTitle.set(t.title.toLowerCase(), t);
  for (const [i, t] of tasks.entries()) {
    if (!t.parentRef) continue;
    const ref = t.parentRef;
    const parent = /^\d+$/.test(ref) ? tasks.find((x) => x.row === Number(ref)) : byTitle.get(ref.toLowerCase());
    if (!parent) out[i].errors.push(`Parent "${ref}" is not a row of this file (give its row number, the header being row 1, or its title).`);
    else if (parent === t) out[i].errors.push('A task cannot be its own parent.');
    else {
      t.parentRow = parent.row;
      out[i].parent = parent.row;
    }
  }
  for (const [i, t] of tasks.entries()) {
    const parent = t.parentRow && tasks.find((x) => x.row === t.parentRow);
    if (parent?.parentRow) out[i].errors.push(`Row ${parent.row} is itself a subtask. Subtasks are one level deep.`);
  }
  // A milestone to create needs a due date: its tasks' latest, or the project's end date.
  for (const m of newMs.values()) {
    if (!m.dueDate) m.dueDate = project.endDate || null;
    if (!m.dueDate) for (const row of m.rows) out[tasks.findIndex((t) => t.row === row)].errors.push(`The new milestone "${m.name}" needs a due date: give its tasks a due date, or give the project an end date.`);
  }
  return { rows: out, tasks, newMilestones: [...newMs.values()].map(({ name, dueDate, rows: r }) => ({ name, dueDate, tasks: r.length })), errorCount: out.filter((x) => x.errors.length).length, fromHours: out.filter((x) => x.fromHours).length };
}

// What someone may do on a project: manage | work | comment | read, or null (it does not exist for them).
// A project is for the people on its member list, each by their role (manager, member, viewer).
// Administrators open every project, so none can become unreachable. Nobody else sees a project they
// are not on, whatever their account type: Project Managers and Sales Managers included.
// Templates are patterns to start from: anyone who may create projects (pm.edit) reads them.
export function projectAccess(p, u) {
  if (!p || !u) return null;
  if (u.role === 'admin') return 'manage';
  const m = p.members.find((x) => x.userId === u.id);
  if (m?.role === 'manager') return 'manage';
  if (m?.role === 'member') return 'work';
  if (m?.role === 'viewer') return 'comment';
  if (p.isTemplate && userCan(u, 'pm.edit')) return 'read';
  return null;
}
